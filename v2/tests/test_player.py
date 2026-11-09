"""Fictional UI contracts, including the verified title-only Play control shape."""
import asyncio
import json
from pathlib import Path
import pytest
from playwright.async_api import async_playwright
from panopto_archiver.player import prepare_player, is_viewer
from panopto_archiver.bridge import archive

URL = 'https://fictional.invalid/Panopto/Pages/Viewer.aspx?id=fictional'
# Real media state is supplied by a tiny synthetic, browser-created captureStream.
PLAYER = '''<title>Fictional prepared lecture</title><video id="media" muted></video>
<button title="Play" onclick="window.starts++;media.play();this.title='Pause'"> </button>
<button role="tab" aria-selected="false" onclick="this.setAttribute('aria-selected','true');document.getElementById('panel').hidden=false;window.opens++">Captions</button>
<button aria-label="Show captions" onclick="this.setAttribute('aria-label','Hide captions');window.enables++">CC</button>
<section id="panel" role="region" aria-label="Captions" hidden>0:01\nFictional automatically opened caption words</section>
<script>window.starts=0;window.opens=0;window.enables=0;const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
const ctx=canvas.getContext('2d');setInterval(()=>{ctx.fillStyle='red';ctx.fillRect(0,0,32,32)},30);media.srcObject=canvas.captureStream(10);</script>'''


def test_requested_viewer_scope():
    assert is_viewer(URL, URL)
    assert not is_viewer(URL.replace('id=fictional', 'id=other'), URL)
    assert not is_viewer(URL.replace('fictional.invalid', 'login.invalid'), URL)
    assert not is_viewer('https://fictional.invalid/login', URL)


async def test_delayed_signin_popup_controls_and_idempotence():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        await context.route('https://fictional.invalid/**', lambda route: route.fulfill(body=PLAYER, content_type='text/html'))
        page = await context.new_page()
        await page.set_content('<button onclick="window.loginClicked=true">Play</button>')
        async def finish_signin():
            await asyncio.sleep(.4)
            popup = await context.new_page()
            await popup.goto(URL)
        task = asyncio.create_task(finish_signin())
        chosen, result = await prepare_player(context, URL, timeout=10)
        await task
        assert result['playback_started'] and result['caption_panel_opened']
        assert result['caption_enable_clicked'] and not result['warnings']
        assert await chosen.get_by_role('region', name='Captions').is_visible()
        assert await page.evaluate('window.loginClicked') is None
        _, second = await prepare_player(context, URL, timeout=3)
        assert second['playback_started']
        assert await chosen.evaluate('[window.starts,window.opens,window.enables]') == [1, 1, 1]
        await browser.close()


async def test_auto_bridge_inspects_actual_exported_transcript(tmp_path):
    # Route a complete real Chromium helper run without real authentication.
    import panopto_archiver.bridge as bridge
    original = bridge.async_playwright
    async with original() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        await context.route('https://fictional.invalid/**', lambda route: route.fulfill(body=PLAYER, content_type='text/html'))
        class Browser:
            async def new_context(self): return context
            async def close(self): await browser.close()
        class Chromium:
            async def launch(self, **kwargs): return Browser()
        class Manager:
            async def __aenter__(self):
                self.chromium = Chromium()
                return self
            async def __aexit__(self, *args): pass
        from unittest.mock import patch
        events=[]
        def no_continue(): raise AssertionError('Automatic mode must not request Continue')
        with patch.object(bridge, 'async_playwright', Manager):
            await archive({'url':URL, 'headless':True, 'autoPrepare':True, 'includePlayback':True,
                           'kinds':['captions'], 'captureSeconds':.1, 'output':str(tmp_path)},
                          output=events.append, receive=no_continue)
        result=events[-1]
        assert result['type']=='result' and result['transcripts']
        assert any('Fictional automatically opened caption words' in Path(t['path']).read_text() for t in result['transcripts'])
        assert not list(tmp_path.rglob('*.mp4'))
        assert 'fictional.invalid' not in json.dumps(events)


async def test_timeout_does_not_click_login_or_wrong_lecture():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page=await context.new_page()
        await context.route('https://fictional.invalid/**', lambda route: route.fulfill(body=PLAYER, content_type='text/html'))
        await page.goto(URL.replace('id=fictional','id=other'))
        with pytest.raises(ValueError, match='Timed out'):
            await prepare_player(context, URL, timeout=.5)
        assert await page.evaluate('window.starts') == 0
        await browser.close()
