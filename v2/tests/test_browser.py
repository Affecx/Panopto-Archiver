import asyncio
import json
import os
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from threading import Thread
import subprocess
import zipfile
import pytest
from playwright.async_api import async_playwright
from panopto_archiver.discovery import Discovery
from panopto_archiver.transport import Transport
from panopto_archiver.hls import expand
from panopto_archiver.exporter import export_archive


@pytest.fixture
def server():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = self.path.split('?')[0]
            routes = {
                '/': ('text/html', b'''<title>Fictional v2 lecture</title><iframe src="/frame"></iframe>'''),
                '/frame': ('text/html', b'''<title>Embedded Fictional lecture</title><video id="v"></video>
                  <button role="tab" onclick="fetch('/opaque-caption?signature=private')">Captions</button>
                  <div data-start="1.25">Opening</div>
                  <script>document.cookie='session=fictional;path=/';
                  fetch('/opaque-audio?signature=private');fetch('/unknown-json');
                  const v=document.getElementById('v'),t=v.addTextTrack('captions','English','en');
                  t.mode='hidden';t.addCue(new VTTCue(1.25,3.5,'Loaded browser words'));
                  const root=document.createElement('div');document.body.append(root);root.attachShadow({mode:'open'}).innerHTML='<a download href="/handout.pdf">Handout</a>';
                  </script>'''),
                '/opaque-caption': ('text/vtt', b'WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nExisting fictional transcript\n'),
                '/opaque-audio': ('audio/mp4', b'Fictional audio bytes'),
                '/unknown-json': ('application/json', b'{"unsupportedPrivateSchema":"must not be saved"}'),
                '/handout.pdf': ('application/pdf', b'Fictional attachment bytes'),
                '/blocked': ('text/html', b'<html>Sign in</html>'),
                '/master.m3u8': ('application/vnd.apple.mpegurl', b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8'),
            }
            media = Path(os.environ.get('V2_TEST_MEDIA', '/nonexistent'))
            if path.startswith('/media/'):
                file = media / Path(path).name
                if file.exists():
                    routes[path] = ('application/vnd.apple.mpegurl' if file.suffix == '.m3u8' else 'video/mp2t', file.read_bytes())
            if path == '/opaque-audio' and 'session=fictional' not in self.headers.get('Cookie', ''):
                self.send_response(403); self.end_headers(); return
            if path not in routes:
                self.send_response(404); self.end_headers(); return
            mime, body = routes[path]
            self.send_response(200); self.send_header('Content-Type', mime); self.end_headers(); self.wfile.write(body)
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = Thread(target=httpd.serve_forever, daemon=True); worker.start()
    yield f'http://127.0.0.1:{httpd.server_port}'
    httpd.shutdown(); httpd.server_close(); worker.join()


async def test_real_browser_discovery_and_exports(server, tmp_path):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        discovery = Discovery(context)
        transport = Transport(context, 'Archiver v2 test')
        try:
            page = await context.new_page(); await page.goto(server)
            frame = page.frames[1]
            await frame.get_by_role('tab', name='Captions').click()
            await page.wait_for_timeout(300)
            await discovery.snapshot(page)
            resources = list(discovery.resources.values())
            assert any(r.kind == 'audio' and r.source == 'network response' for r in resources)
            assert any(r.kind == 'captions' and r.url for r in resources)
            assert any(r.source == 'loaded browser cues' for r in resources)
            assert any(r.kind == 'attachment' for r in resources)  # open shadow root HTML
            archive, report = await export_archive(discovery.title, resources, transport, tmp_path, discovery.chapters, discovery.stats, archive=True, progress=lambda _: None)
            assert not report['partial']
            with zipfile.ZipFile(archive) as z:
                texts = [z.read(n).decode() for n in z.namelist() if n.endswith('.txt')]
                assert any('Existing fictional transcript' in t for t in texts)
                assert any('Loaded browser words' in t for t in texts)
                assert any(z.read(n) == b'Fictional audio bytes' for n in z.namelist() if n.endswith('.m4a'))
                manifest = z.read('metadata/resources.json').decode()
                assert 'private' not in manifest and 'signature' not in manifest and 'session=fictional' not in manifest
                assert report['diagnostics']['json_responses_unparsed'] == 1
            with pytest.raises(ValueError):
                await transport.text(server + '/blocked')
        finally:
            await transport.close(); await context.close(); await browser.close()


async def test_assembled_video_decodes(server, tmp_path):
    ffmpeg, ffprobe = os.environ.get('FFMPEG_PATH'), os.environ.get('FFPROBE_PATH')
    if not ffmpeg or not ffprobe or not os.environ.get('V2_TEST_MEDIA'):
        pytest.skip('Set FFMPEG_PATH, FFPROBE_PATH and V2_TEST_MEDIA for real video decode validation')
    from panopto_archiver.models import Resource
    async with async_playwright() as p:
        browser = await p.chromium.launch(); context = await browser.new_context()
        transport = Transport(context, 'Archiver v2 test')
        try:
            resources = [Resource('video', 'hls', 'observed response', url=server+'/media/video.m3u8')]
            root, report = await export_archive('Video decode', resources, transport, tmp_path, ffmpeg=ffmpeg, progress=lambda _: None)
            assert not report['partial']
            video = next(root.rglob('*.mp4'))
            probe = subprocess.run([ffprobe, '-v','error','-show_streams','-show_format','-of','json',str(video)], capture_output=True, text=True)
            assert probe.returncode == 0
            parsed = json.loads(probe.stdout)
            assert float(parsed['format']['duration']) > 3.9
            assert {s['codec_type'] for s in parsed['streams']} == {'video', 'audio'}
            decoded = subprocess.run([ffmpeg,'-v','error','-i',str(video),'-f','null','-'], capture_output=True)
            assert decoded.returncode == 0
        finally:
            await transport.close(); await context.close(); await browser.close()
