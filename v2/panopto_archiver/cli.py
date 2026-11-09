import argparse
import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright
from .models import safe_url
from .discovery import Discovery
from .transport import Transport
from .hls import expand
from .exporter import export_archive
from .player import prepare_player


async def run(args):
    if not safe_url(args.url):
        raise ValueError('Use an HTTP(S) viewer URL without embedded credentials')
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=args.headless)
        context = await browser.new_context()
        discovery = Discovery(context)
        transport = None
        try:
            page = await context.new_page()
            await page.goto(args.url, wait_until='domcontentloaded', timeout=60000)
            if not args.headless:
                print('Sign in in the browser. The lecture will start and captions will open automatically.')
                page, preparation = await prepare_player(context, args.url, progress=print)
            await page.wait_for_timeout(args.capture_seconds * 1000)
            await discovery.snapshot(page)
            transport = Transport(context, await page.evaluate('navigator.userAgent'))
            resources = list(discovery.resources.values())
            if args.include_playback:
                resources = await expand(resources, transport)
            for resource in resources:
                if not args.include_playback and resource.source != 'rendered download link':
                    resource.status = 'restricted'
                    resource.warning = 'Use --include-playback only for recordings you are authorised to export.'
            print(f'Lecture: {discovery.title}')
            for i, resource in enumerate(resources, 1):
                print(f'{i:>3}. {resource.kind:10} {resource.format:8} {resource.status:12} {resource.language} {resource.warning}')
            print(f'Unparsed JSON responses: {discovery.stats["json_responses_unparsed"]}. These require a verified adapter; no transcript is fabricated.')
            selected = set()
            if args.export:
                selected = {r.id for r in resources if r.status == 'available' and (not args.kind or r.kind in args.kind)}
            path, report = await export_archive(discovery.title, resources, transport, args.output,
                                              discovery.chapters, discovery.stats, selected=selected,
                                              archive=args.zip, ffmpeg=args.ffmpeg)
            print(f'{"Partial export" if report["partial"] else "Export" if args.export else "Inspection report"}: {path}')
            if args.export and not selected:
                print('No supported selectable resources found. See the safe inspection report.')
                return 2
            return 2 if report['partial'] else 0
        finally:
            if transport:
                await transport.close()
            await context.close()
            await browser.close()


def main():
    parser = argparse.ArgumentParser(description='Panopto Archiver v2 — local browser-driven discovery and export')
    parser.add_argument('url', nargs='?', help='Lecture URL (or enter at the private prompt)')
    parser.add_argument('--output', type=Path, default=Path('archives-v2'))
    parser.add_argument('--export', action='store_true', help='Export supported resources; default is a safe inspection report')
    parser.add_argument('--include-playback', action='store_true', help='Include observed playback media/captions you are authorised to export')
    parser.add_argument('--kind', action='append', choices=['video', 'audio', 'captions', 'attachment'])
    parser.add_argument('--zip', action='store_true')
    parser.add_argument('--ffmpeg', type=Path, help='Optional installed FFmpeg executable for local MPEG-TS to MP4 remuxing')
    parser.add_argument('--headless', action='store_true', help='Skip interactive sign-in; intended for mock/public sessions')
    parser.add_argument('--capture-seconds', type=float, default=5)
    args = parser.parse_args()
    if not args.url:
        from getpass import getpass
        args.url = getpass('Lecture URL (not echoed or saved to shell history): ')
    if not 0 <= args.capture_seconds <= 300:
        parser.error('capture-seconds must be between 0 and 300')
    try:
        raise SystemExit(asyncio.run(run(args)))
    except KeyboardInterrupt:
        print('Stopped. Incomplete media files are excluded from completed output.', file=sys.stderr)
        raise SystemExit(130)
    except Exception:
        print('Browser/discovery failed. Check browser installation, sign-in and connectivity. No private exception details were logged.', file=sys.stderr)
        raise SystemExit(1)
