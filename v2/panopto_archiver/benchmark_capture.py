"""Capture only transcript resources for a provider comparison; no video download."""
import asyncio
import getpass
from pathlib import Path
from playwright.async_api import async_playwright
from .models import safe_url
from .session_store import SessionStore
from .discovery import Discovery
from .transport import Transport
from .exporter import export_archive
from .player import prepare_player


async def capture(url):
    if not safe_url(url):
        raise ValueError('Invalid lecture URL')
    state = None
    try:
        state = SessionStore().load('panopto-study', url)
    except Exception:
        print('Saved OS-keychain session unavailable; using a fresh browser.', flush=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(storage_state=state) if state else await browser.new_context()
        discovery = Discovery(context)
        transport = None
        try:
            page = await context.new_page()
            await page.goto(url, wait_until='domcontentloaded', timeout=60000)
            print('BROWSER_READY: sign in only. Playback and captions will be prepared automatically.', flush=True)
            page, preparation = await prepare_player(context, url, progress=lambda message: print(message, flush=True))
            await page.wait_for_timeout(4000)
            await discovery.snapshot(page)
            resources = list(discovery.resources.values())
            selected = {r.id for r in resources if r.kind == 'captions' and r.status == 'available'}
            if not selected:
                raise ValueError('No transcript was found; no model run will be attempted')
            transport = Transport(context, await page.evaluate('navigator.userAgent'))
            folder, report = await export_archive(discovery.title, resources, transport, Path('v2/benchmark-sources'),
                                                 stats=discovery.stats, selected=selected,
                                                 progress=lambda message: print(message, flush=True))
            print('CAPTURE_RESULT:', folder, 'partial:', report['partial'], flush=True)
        finally:
            if transport:
                await transport.close()
            await context.close()
            await browser.close()


def main():
    url = getpass.getpass('Lecture URL (not echoed): ')
    try:
        asyncio.run(capture(url))
    except Exception:
        print('Capture could not complete. Sign-in, transcript availability or network access needs attention; private exception details were not logged.', flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
