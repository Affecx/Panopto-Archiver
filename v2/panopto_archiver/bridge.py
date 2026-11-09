"""Private JSON-lines stdio bridge. Never print auth state, URLs or raw errors."""
import asyncio
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright
from .models import safe_url
from .session_store import SessionStore
from .discovery import Discovery
from .transport import Transport
from .hls import expand
from .exporter import export_archive
from .player import prepare_player


def emit(event):
    print(json.dumps(event), flush=True)


def read():
    line = sys.stdin.readline(1024 * 1024)
    if not line:
        raise ValueError('Input closed')
    return json.loads(line)


async def archive(options, output=emit, receive=read, store_factory=SessionStore):
    url = options.get('url', '')
    if not safe_url(url):
        raise ValueError('Invalid lecture URL')
    name = options.get('sessionName', 'panopto-study')
    store = store_factory() if options.get('rememberLogin') or options.get('op') == 'forget' else None
    if options.get('op') == 'forget':
        store.forget(name, url)
        output({'type': 'result', 'folder': '', 'title': '', 'partial': False, 'transcripts': []})
        return
    state = store.load(name, url) if store else None
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=bool(options.get('headless', False)))
        context = await browser.new_context(storage_state=state) if state else await browser.new_context()
        discovery = Discovery(context)
        transport = None
        try:
            page = await context.new_page()
            await page.goto(url, wait_until='domcontentloaded', timeout=60000)
            if options.get('autoPrepare'):
                output({'type': 'login', 'message': 'Sign in in the browser. Playback and captions will be prepared automatically.'})
                page, preparation = await prepare_player(context, url, progress=lambda message: output({'type': 'progress', 'message': message}))
            else:
                # Retain the explicit Continue protocol for older helper clients.
                output({'type': 'login', 'message': 'Sign in in the browser, then click Continue. Playback and captions will be prepared automatically.'})
                decision = await asyncio.to_thread(receive)
                if decision.get('op') != 'continue':
                    raise ValueError('Cancelled')
                if not options.get('headless'):
                    page, preparation = await prepare_player(context, url, timeout=30, progress=lambda message: output({'type': 'progress', 'message': message}))
            await page.wait_for_timeout(min(max(float(options.get('captureSeconds', 3)), 0), 30) * 1000)
            await discovery.snapshot(page)
            # Explicitly approved OS-keychain persistence: capture post-load iframe/SSO cookies.
            if store:
                store.save(name, url, await context.storage_state())
            transport = Transport(context, await page.evaluate('navigator.userAgent'))
            resources = list(discovery.resources.values())
            kinds = options.get('kinds')
            if kinds is not None and (not isinstance(kinds, list) or any(k not in ('captions', 'video', 'audio', 'attachment', 'slides', 'chapters') for k in kinds)):
                raise ValueError('Invalid resource selection')
            if options.get('includePlayback') and (kinds is None or any(k in ('video', 'audio') for k in kinds)):
                resources = await expand(resources, transport)
            selected = {r.id for r in resources if r.status == 'available' and
                        (options.get('includePlayback') or r.source == 'rendered download link') and
                        (kinds is None or r.kind in kinds)}
            folder, report = await export_archive(discovery.title, resources, transport, Path(options['output']),
                                                 discovery.chapters, discovery.stats, selected=selected,
                                                 progress=lambda _: output({'type': 'progress', 'message': 'Downloading selected lecture resources…'}))
            transcripts = [{'path': str(folder / file), 'warning': resource.get('warning', ''), 'source': resource.get('source', '')}
                           for resource in report['resources'] if resource['kind'] == 'captions'
                           for file in resource['files'] if file.endswith('.txt')]
            output({'type': 'result', 'folder': str(folder), 'title': discovery.title,
                    'partial': report['partial'], 'transcripts': transcripts})
        finally:
            if transport:
                await transport.close()
            await context.close()
            await browser.close()


def main():
    try:
        options = read()
        asyncio.run(archive(options))
    except Exception:
        emit({'type': 'error', 'message': 'Local archiver failed. Check browser setup, OS keychain access, sign-in and resource availability.'})
        raise SystemExit(1)


if __name__ == '__main__':
    main()
