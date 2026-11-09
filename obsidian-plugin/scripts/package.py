"""Package only the three Obsidian runtime files, under the manifest ID."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
manifest = json.loads((dist / 'manifest.json').read_text())
files = ('main.js', 'manifest.json', 'styles.css')
for name in files:
    if not (dist / name).is_file():
        raise SystemExit('Build the plugin first')
archive = dist / (manifest['id'] + '.zip')
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as writer:
    for name in files:
        writer.write(dist / name, manifest['id'] + '/' + name)
with zipfile.ZipFile(archive) as reader:
    assert set(reader.namelist()) == {manifest['id'] + '/' + name for name in files}
    assert reader.testzip() is None
print('Packaged:', archive)
