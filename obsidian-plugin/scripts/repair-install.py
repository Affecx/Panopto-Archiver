"""Repair this project's misplaced installation; preserve source and settings."""
from pathlib import Path
import datetime
import hashlib
import json
import shutil

project = Path(__file__).resolve().parents[1]
dist = project / 'dist'
manifest = json.loads((dist / 'manifest.json').read_text())
if manifest['id'] != 'panopto-study':
    raise SystemExit('Unexpected plugin ID')
config = json.loads((Path.home() / 'Library/Application Support/obsidian/obsidian.json').read_text())
open_vaults = [Path(v['path']) for v in config['vaults'].values() if v.get('open')]
if len(open_vaults) != 1:
    raise SystemExit('Exactly one open vault is required; no files were changed')
obsidian = open_vaults[0] / '.obsidian'
plugins = obsidian / 'plugins'
source = plugins / 'obsidian-plugin'
target = plugins / manifest['id']
if target.exists():
    raise SystemExit('Canonical plugin folder already exists; refusing to overwrite it')
if not source.is_dir() or json.loads((source / 'manifest.json').read_text()).get('id') != manifest['id']:
    raise SystemExit('Expected misplaced installation not found; no files were changed')
for name in ('main.js', 'manifest.json', 'styles.css'):
    if not (dist / name).is_file():
        raise SystemExit('Build is incomplete; no files were changed')
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = obsidian / 'plugin-backups' / ('obsidian-plugin-' + now)
staging = plugins / ('.panopto-study-install-' + now)
if backup.exists() or staging.exists():
    raise SystemExit('Backup or staging folder already exists; refusing to overwrite')
staging.mkdir()
try:
    for name in ('main.js', 'manifest.json', 'styles.css'):
        shutil.copy2(dist / name, staging / name)
        assert hashlib.sha256((staging / name).read_bytes()).digest() == hashlib.sha256((dist / name).read_bytes()).digest()
    if (source / 'data.json').is_file():
        shutil.copy2(source / 'data.json', staging / 'data.json')
    backup.parent.mkdir(exist_ok=True)
    source.rename(backup)
    try:
        staging.rename(target)
    except Exception:
        backup.rename(source)
        raise
except Exception:
    # Keep a failed staging directory for inspection; never delete user data.
    raise
assert (target / 'main.js').is_file()
assert json.loads((target / 'manifest.json').read_text())['id'] == target.name
print('Repaired: canonical plugin folder contains main.js, manifest.json and styles.css.')
print('Preserved misplaced source folder in .obsidian/plugin-backups/' + backup.name)
print('Existing data.json was preserved when present. No enablement settings were changed.')
