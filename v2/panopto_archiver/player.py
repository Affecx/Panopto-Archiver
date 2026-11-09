"""Prepare visible player controls, independently of discovery/export permission."""
import asyncio
import re
import time
from urllib.parse import urlsplit, parse_qs

MEDIA_STATE = """() => {
 const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
 const media=roots.flatMap(r=>Array.from(r.querySelectorAll('video,audio')));
 return {count:media.length,playing:media.some(m=>!m.paused&&!m.ended),encrypted:media.some(m=>!!m.mediaKeys)};
}"""


def is_viewer(candidate, target):
    a, b = urlsplit(candidate), urlsplit(target)
    return (a.scheme, a.netloc) == (b.scheme, b.netloc) and bool(re.fullmatch(r'/Panopto/Pages/(Viewer|Embed)\.aspx', a.path, re.I)) and parse_qs(a.query).get('id') == parse_qs(b.query).get('id')


async def visible_click(frame, role, name, title=False):
    locator = frame.get_by_role(role)
    locator = locator.and_(frame.get_by_title(name, exact=True)) if title else frame.get_by_role(role, name=name, exact=True)
    candidates = []
    for item in await locator.all():
        if await item.is_visible() and await item.is_enabled():
            candidates.append(item)
    # Never guess among ambiguous matching controls.
    if len(candidates) != 1:
        return False
    item = candidates[0]
    if await item.get_attribute('aria-selected') == 'true' or await item.get_attribute('aria-pressed') == 'true':
        return True
    await item.click(timeout=1500)
    return True


async def prepare_player(context, target, timeout=300, progress=lambda _: None):
    """Wait across sign-in redirects/popups; act only inside the requested viewer."""
    deadline = time.monotonic()+timeout
    while time.monotonic() < deadline:
        if not context.pages:
            raise ValueError('Lecture browser was closed')
        for page in list(context.pages):
            for frame in list(page.frames):
                if not is_viewer(frame.url, target):
                    continue
                try:
                    state = await frame.evaluate(MEDIA_STATE)
                    if not state['count']:
                        continue
                    # Controls can appear after the media nodes; allow bounded loading time.
                    available = False
                    for role, name, title in [('tab', 'Captions', False), ('tab', 'Transcript', False),
                                              ('button', 'Play', False), ('button', 'Play', True),
                                              ('button', 'Pause', False), ('button', 'Pause', True)]:
                        loc = frame.get_by_role(role).and_(frame.get_by_title(name, exact=True)) if title else frame.get_by_role(role, name=name, exact=True)
                        if await loc.count():
                            available = True
                    if not available:
                        continue
                    return await _prepare(frame, page, progress)
                except ValueError:
                    raise
                except Exception:
                    # Detached frame/navigation during sign-in: rediscover fresh controls.
                    continue
        await asyncio.sleep(.3)
    raise ValueError('Timed out waiting for the requested lecture player; sign in and retry')


async def _prepare(frame, page, progress):
    progress('Lecture detected. Starting playback and opening captions…')
    warnings = []
    state = await frame.evaluate(MEDIA_STATE)
    played = state['playing']
    if not played:
        for name, title in [('Play', False), ('Play', True), ('Play video', False), ('Play recording', False)]:
            if await visible_click(frame, 'button', name, title):
                break
        try:
            await frame.wait_for_function("() => Array.from(document.querySelectorAll('video,audio')).some(m=>!m.paused&&!m.ended)", timeout=5000)
            played = True
        except Exception:
            warnings.append('Playback did not start automatically. Press Play in the browser if discovery is incomplete.')
    captions = False
    for role, name in [('tab', 'Captions'), ('tab', 'Transcript'), ('button', 'Captions'), ('button', 'Transcript')]:
        if await visible_click(frame, role, name):
            captions = True
            break
    # Only explicit enable controls. Never click Hide captions or toggle an unknown state.
    enabled = False
    for name in ('Show captions', 'Enable captions'):
        if await visible_click(frame, 'button', name):
            enabled = True
            break
    if not captions and not enabled:
        warnings.append('No supported visible caption control was found. Open captions manually if needed.')
    for message in warnings:
        progress(message)
    return page, {'playback_started': played, 'caption_panel_opened': captions,
                  'caption_enable_clicked': enabled, 'warnings': warnings}
