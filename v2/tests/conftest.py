"""Generate fictional audiovisual fixtures without the browser extension."""
import os
from pathlib import Path
import shutil
import subprocess

import pytest


@pytest.fixture(scope='session')
def av_tools():
    return (
        os.environ.get('FFMPEG_PATH') or shutil.which('ffmpeg'),
        os.environ.get('FFPROBE_PATH') or shutil.which('ffprobe'),
    )


@pytest.fixture(scope='session')
def hls_media(av_tools, tmp_path_factory):
    ffmpeg, ffprobe = av_tools
    if not ffmpeg or not ffprobe:
        return None
    if os.environ.get('V2_TEST_MEDIA'):
        return Path(os.environ['V2_TEST_MEDIA']).resolve()
    folder = tmp_path_factory.mktemp('fictional-hls')
    subprocess.run([
        ffmpeg, '-v', 'error',
        '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
        '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-g', '10', '-sc_threshold', '0', '-c:a', 'aac',
        '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod',
        '-hls_segment_filename', 'part%02d.ts', 'video.m3u8',
    ], cwd=folder, check=True)
    return folder
