"""Prepare bounded local reference images; never interpret a feed as slides by default."""
import concurrent.futures
import hashlib
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path


def local(root, relative):
    target = (root / relative).resolve()
    target.relative_to(root.resolve())
    if not target.is_file():
        raise ValueError('Missing archive asset')
    return target


def prepare(options):
    root = Path(options['folder']).resolve()
    manifest = json.loads(local(root, 'metadata/resources.json').read_text())
    destination = root/'learning'
    destination.resolve().relative_to(root)
    destination.mkdir(exist_ok=True)
    (destination/'frames').resolve().relative_to(root)
    (destination/'frames').mkdir(exist_ok=True)
    ffmpeg = options.get('ffmpeg') or shutil.which('ffmpeg')
    ffprobe = options.get('ffprobe') or shutil.which('ffprobe')
    anchors = sorted({round(float(v), 2) for v in options.get('anchors', []) if isinstance(v, (float, int)) and math.isfinite(v) and 0 <= v <= 86400})[:64]
    feeds, frames, warnings = [], [], []
    if not ffmpeg or not ffprobe:
        warnings.append('Reference frame extraction requires configured FFmpeg and FFprobe. Original local videos remain available.')
    jobs = []
    seen = set()
    for resource in manifest.get('resources', []):
        if resource.get('outcome') != 'success':
            continue
        for relative in resource.get('files', []):
            if Path(relative).suffix.lower() not in ('.mp4', '.webm') or relative in seen:
                continue
            file = local(root, relative)
            seen.add(relative)
            if len(feeds) >= 4:
                warnings.append('Only the first four local video feeds are indexed.')
                break
            duration, audio = None, None
            if ffprobe:
                probe = subprocess.run([ffprobe, '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', str(file)], capture_output=True, timeout=30)
                if probe.returncode == 0:
                    info = json.loads(probe.stdout)
                    duration = float(info.get('format', {}).get('duration', 0))
                    if not math.isfinite(duration) or duration <= 0:
                        duration = None
                    audio = any(s['codec_type'] == 'audio' for s in info.get('streams', []))
            feed = {'id': f'F{len(feeds)+1}', 'label': f'Recording view {len(feeds)+1}', 'path': relative,
                    'duration': duration, 'hasAudio': audio, 'role': 'unclassified', 'alignment': 'unverified'}
            feeds.append(feed)
            if ffmpeg and duration:
                # Reserve half the budget for actual cited moments, half for whole-feed coverage.
                uniform = [duration*i/31 for i in range(32)]
                candidates = sorted(set([0.0]+anchors+uniform))
                selected = []
                for at in candidates:
                    if at < duration-.15 and (not selected or at-selected[-1] >= 2):
                        selected.append(at)
                # Bounded to 96 images per feed. Frames are nominal timestamps, not scene coverage.
                for at in selected[:96]:
                    key = hashlib.sha256(f'{relative}|{file.stat().st_size}|{file.stat().st_mtime_ns}|{at:.2f}|v1'.encode()).hexdigest()[:20]
                    target = destination/'frames'/f'{key}.jpg'
                    frame = {'id': f'{feed["id"]}-{key}', 'feed': feed['id'], 'time': round(at, 2),
                             'path': f'frames/{key}.jpg', 'origin': 'actual recording frame', 'role': 'unclassified'}
                    jobs.append((file, at, target, frame))
    def extract(job):
        source, at, target, frame = job
        if target.exists() and target.stat().st_size > 0:
            return frame
        part = target.with_suffix('.part.jpg')
        try:
            result = subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-y', '-ss', str(at), '-i', str(source),
                                     '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', str(part)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45)
            if result.returncode == 0 and part.exists() and part.stat().st_size:
                part.replace(target)
                return frame
        finally:
            part.unlink(missing_ok=True)
        return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for frame in pool.map(extract, jobs):
            if frame:
                frames.append(frame)
    if len(frames) != len(jobs):
        warnings.append('Some reference images could not be extracted; use the original recordings for those moments.')
    if not feeds:
        warnings.append('No supported local video was exported. This page cannot verify visual examples; import authorised videos to add original references.')
    report = {'version': 1, 'feeds': feeds, 'frames': frames, 'warnings': warnings,
              'visual_interpretation': 'unverified', 'slide_similarity': 'not measured; images come from actual recordings',
              'sampling': 'At most 96 sampled/cited frames per feed. Short events can be missed. Full videos remain the reference.'}
    (destination/'media.json').write_text(json.dumps(report, indent=2))
    return report


def main():
    try:
        options = json.loads(sys.stdin.readline(1024*1024))
        print(json.dumps(prepare(options)))
    except Exception:
        print(json.dumps({'error':'Could not prepare local reference media. Check archive files and FFmpeg paths.'}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
