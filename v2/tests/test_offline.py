"""Offline component checks and generated-media decoding."""
import json
import subprocess
import tempfile
import unittest
import zipfile
import pytest
from panopto_archiver.models import Resource, classify, safe_url, filename
from panopto_archiver.captions import parse, srt
from panopto_archiver.hls import playlist
from panopto_archiver.exporter import export_archive


class CoreTests(unittest.TestCase):
    def test_mime_discovery_opaque_endpoints_and_redaction(self):
        for mime, kind, fmt in [('text/vtt','captions','vtt'),('audio/mp4','audio','m4a'),('video/mp4','video','mp4')]:
            with self.subTest(mime=mime):
                resource = classify('https://example.com/opaque?signature=private', mime)
                self.assertEqual((resource.kind, resource.format), (kind, fmt))
                self.assertNotIn('private', json.dumps(resource.public()))
                self.assertNotIn('private', repr(resource))

    def test_caption_accuracy(self):
        cues = parse('WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nExisting <b>caption</b>\n')
        self.assertEqual(cues, [dict(start=1.25, end=3.5, text='Existing caption')])
        self.assertIn('00:00:01,250 --> 00:00:03,500', srt(cues))
        self.assertEqual(parse('Words with no timings'), [])
        with self.assertRaises(ValueError):
            parse('00:00:03.000 --> 00:00:01.000\nInvalid')

    def test_url_and_filename_safety(self):
        for url in ['javascript:alert(1)', 'https://user:pass@example.com/a', 'blob:https://example.com/a']:
            self.assertFalse(safe_url(url))
        self.assertNotIn('/', filename('../Bad/Title'))
        self.assertTrue(filename('CON').startswith('_'))

    def test_hls_permissions_and_layouts(self):
        for tag in ['#EXT-X-KEY:METHOD=AES-128,URI="key"','#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"','#EXT-X-MAP:URI="init.mp4"','#EXT-X-DISCONTINUITY','#EXT-X-BYTERANGE:1@0']:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                playlist('#EXTM3U\n'+tag+'\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST','https://example.com/video.m3u8')
        with self.assertRaises(ValueError):
            playlist('#EXTM3U\n#EXTINF:1,\na.ts','https://example.com/video.m3u8')

    def test_hls_renditions(self):
        variants, tracks, segments = playlist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8",LANGUAGE="en"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8','https://example.com/master.m3u8?signature=private')
        self.assertEqual(variants, ['https://example.com/video.m3u8'])
        self.assertEqual(tracks, [('AUDIO', 'https://example.com/audio.m3u8', 'en')])
        self.assertEqual(segments, [])


class ExportTests(unittest.IsolatedAsyncioTestCase):
    async def test_actual_zip_captions_and_failures(self):
        class Broken:
            async def save(self, url, target):
                target.write_bytes(b'incomplete')
                raise ValueError('private URL must not leak')
        with tempfile.TemporaryDirectory() as directory:
            resources = [Resource('captions','vtt','loaded browser cues',data='WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nExisting caption\n'),
                         Resource('video','mp4','observed response',url='https://example.com/media?signature=private')]
            path, report = await export_archive('Lecture',resources,Broken(),directory,archive=True,progress=lambda _: None)
            self.assertTrue(report['partial'])
            with zipfile.ZipFile(path) as archive:
                self.assertTrue(any('Existing caption' in archive.read(n).decode() for n in archive.namelist() if n.endswith('.txt')))
                self.assertFalse(any(n.endswith(('.part','.mp4')) for n in archive.namelist()))
                manifest = archive.read('metadata/resources.json').decode()
                self.assertNotIn('private',manifest)
                self.assertNotIn('signature',manifest)

async def test_real_generated_video_assembly_and_remux(av_tools, hls_media, tmp_path):
    ffmpeg, ffprobe = av_tools
    if hls_media is None:
        pytest.skip('FFmpeg and FFprobe are required for video decode validation')

    class Files:
        async def text(self, url, limit=0):
            return (hls_media / url.rsplit('/', 1)[-1]).read_text()

        async def chunks(self, url):
            with (hls_media / url.rsplit('/', 1)[-1]).open('rb') as handle:
                while True:
                    chunk = handle.read(4096)
                    if not chunk:
                        break
                    yield chunk

    resource = Resource('video', 'hls', 'observed response', url='https://example.com/video.m3u8')
    root, report = await export_archive(
        'Video', [resource], Files(), tmp_path, ffmpeg=ffmpeg, progress=lambda _: None,
    )
    assert not report['partial']
    video = next(root.rglob('*.mp4'))
    probe = subprocess.run(
        [ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(video)],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(probe.stdout)
    assert float(info['format']['duration']) > 3.9
    assert {stream['codec_type'] for stream in info['streams']} == {'audio', 'video'}
    decoded = subprocess.run(
        [ffmpeg, '-v', 'error', '-i', str(video), '-f', 'null', '-'], capture_output=True,
    )
    assert decoded.returncode == 0, decoded.stderr


if __name__ == '__main__':
    unittest.main()
