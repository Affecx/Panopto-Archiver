import json
import subprocess
import zipfile
from pathlib import Path
from .models import filename
from .captions import parse, srt
from .hls import assemble


async def export_archive(title, resources, transport, output, chapters=None, stats=None,
                         selected=None, archive=False, ffmpeg=None, progress=print):
    root = Path(output) / filename(title)
    # Never overwrite an earlier archive or mix retry output with an old manifest.
    candidate, suffix = root, 2
    while candidate.exists() or candidate.with_name(candidate.name + '.zip').exists():
        candidate = root.with_name(root.name + f'_{suffix}')
        suffix += 1
    root = candidate
    root.mkdir(parents=True)
    outcomes = []
    for index, resource in enumerate(resources, 1):
        outcome = {**resource.public(), 'outcome': 'skipped', 'files': []}
        outcomes.append(outcome)
        if resource.status != 'available' or (selected is not None and resource.id not in selected):
            continue
        folder = 'transcripts' if resource.kind == 'captions' else 'attachments' if resource.kind == 'attachment' else 'media'
        ext = 'ts' if resource.format == 'hls' else resource.format
        target = root / folder / f'{index:03}_{resource.kind}.{ext}'
        target.parent.mkdir(exist_ok=True)
        part = target.with_name(target.name + '.part')
        try:
            progress(f'Exporting {resource.kind} {index}/{len(resources)}')
            if resource.data is not None:
                part.write_text(resource.data, encoding='utf-8')
            elif resource.format == 'hls':
                await assemble(resource, transport, part, progress)
            elif resource.kind == 'captions':
                part.write_text(await transport.text(resource.url), encoding='utf-8')
            else:
                await transport.save(resource.url, part)
            part.replace(target)
            outcome['files'].append(str(target.relative_to(root)))
            if resource.kind == 'captions' and resource.format in ('vtt', 'srt'):
                cues = parse(target.read_text(encoding='utf-8'))
                if not cues:
                    raise ValueError('No timed cues; original preserved')
                for extension, text in [('txt', '\n'.join(c['text'] for c in cues)), ('json', json.dumps(cues, ensure_ascii=False, indent=2)), ('srt', srt(cues))]:
                    derivative = target.with_suffix('.' + extension)
                    if derivative == target:
                        continue
                    derivative.write_text(text, encoding='utf-8')
                    outcome['files'].append(str(derivative.relative_to(root)))
            if resource.format == 'hls' and ffmpeg:
                remuxed = target.with_suffix('.mp4')
                result = subprocess.run([str(ffmpeg), '-nostdin', '-v', 'error', '-y', '-i', str(target), '-c', 'copy', str(remuxed)],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if result.returncode:
                    remuxed.unlink(missing_ok=True)
                    raise ValueError('MP4 remux failed; MPEG-TS file preserved')
                outcome['files'].append(str(remuxed.relative_to(root)))
            outcome['outcome'] = 'success'
        except Exception:
            outcome['outcome'] = 'failed'
            outcome['error'] = 'Export failed: access, format, network or conversion error. Rediscover and retry; partial original files are listed.'
        finally:
            part.unlink(missing_ok=True)
    metadata = root / 'metadata'
    metadata.mkdir(exist_ok=True)
    report = {'version': 2, 'title': title, 'resources': outcomes, 'diagnostics': stats or {},
              'warnings': ['Playback visibility does not establish export rights.', 'Loaded caption/DOM snapshots may be incomplete.',
                           'No proprietary Panopto JSON schema was assumed.'],
              'partial': any(r['outcome'] == 'failed' for r in outcomes)}
    (metadata / 'resources.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    if chapters:
        (metadata / 'chapters-snapshot.json').write_text(json.dumps(chapters, ensure_ascii=False, indent=2), encoding='utf-8')
    (root / 'README.md').write_text('Local Panopto Archiver v2 export. Consult metadata/resources.json for omissions, failures and incomplete snapshots.\n', encoding='utf-8')
    if archive:
        zipped = root.with_name(root.name + '.zip')
        temp = zipped.with_name(zipped.name + '.part')
        try:
            with zipfile.ZipFile(temp, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as writer:
                for file in root.rglob('*'):
                    if file.is_file():
                        writer.write(file, str(file.relative_to(root)))
            temp.replace(zipped)
        finally:
            temp.unlink(missing_ok=True)
        return zipped, report
    return root, report
