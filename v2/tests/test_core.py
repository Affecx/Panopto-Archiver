import pytest
from panopto_archiver.models import classify, filename, safe_url, Resource
from panopto_archiver.captions import parse, seconds, srt
from panopto_archiver.discovery import html_resources
from panopto_archiver.hls import playlist
from panopto_archiver.exporter import export_archive


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'blob:https://example.com/x', 'https://user:pass@example.com/a'])
def test_unsafe(url):
    assert not safe_url(url)


@pytest.mark.parametrize('mime,kind,fmt', [('text/vtt','captions','vtt'), ('audio/mp4','audio','m4a'), ('video/mp4','video','mp4')])
def test_response_mime_works_for_opaque_urls(mime, kind, fmt):
    r = classify('https://example.com/opaque?token=secret', mime)
    assert (r.kind, r.format) == (kind, fmt)
    assert 'secret' not in str(r.public())
    assert 'secret' not in repr(r)


def test_captions():
    cues = parse('WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nExisting <b>words</b>\n')
    assert cues == [dict(start=1.25, end=3.5, text='Existing words')]
    assert '00:00:01,250 --> 00:00:03,500' in srt(cues)
    assert parse('no timing') == []
    with pytest.raises(ValueError):
        seconds('00:99:00')


def test_html_snapshots():
    resources, chapters = html_resources('<a download href="/audio.m4a">Audio</a><div data-start="10">Chapter</div>', 'https://example.com/viewer')
    assert resources[0].kind == 'audio'
    assert chapters == [dict(start=10, text='Chapter')]
    assert '/' not in filename('../Lecture/Title')


@pytest.mark.parametrize('tag', ['#EXT-X-KEY:METHOD=AES-128,URI="secret"', '#EXT-X-MAP:URI="init.mp4"', '#EXT-X-DISCONTINUITY', '#EXT-X-BYTERANGE:1@0'])
def test_reject_unsupported_hls(tag):
    with pytest.raises(ValueError):
        playlist('#EXTM3U\n'+tag+'\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST', 'https://example.com/v.m3u8')


def test_master_audio():
    variants, tracks, segments = playlist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8",LANGUAGE="en"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8', 'https://example.com/master.m3u8')
    assert tracks == [('AUDIO', 'https://example.com/audio.m3u8', 'en')]
    assert variants == ['https://example.com/video.m3u8']
    assert not segments


async def test_failed_exports_leave_no_partial_media(tmp_path):
    class Broken:
        async def save(self, url, target):
            target.write_bytes(b'partial')
            raise ValueError('secret source URL must not leak')
    resources = [Resource('video', 'mp4', 'test', url='https://example.com/?token=secret')]
    path, report = await export_archive('Lecture', resources, Broken(), tmp_path, progress=lambda _: None)
    assert report['partial']
    assert not list(path.rglob('*.part'))
    assert not list(path.rglob('*.mp4'))
    assert 'secret' not in (path / 'metadata/resources.json').read_text()


def test_semantic_caption_panel_preserves_text_without_invented_timing():
    resources, _ = html_resources('<button id="cap">Captions</button><section role="tabpanel" aria-labelledby="cap">Existing words without timing</section>', 'https://example.com/viewer')
    assert resources[0].format == 'txt'
    assert resources[0].data == 'Existing words without timing'
    assert 'incomplete' in resources[0].warning
