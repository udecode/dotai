#!/usr/bin/env python3
"""Package only the reviewed manifest, never the surrounding checkout."""
import argparse
import hashlib
import json
from pathlib import Path
import stat
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'workflow-manifest.json').read_text())
files = dict(manifest['files'])
files['workflow-manifest.json'] = {
    'sha256': hashlib.sha256((root / 'workflow-manifest.json').read_bytes()).hexdigest(),
    'mode': 0o644,
}
output = Path(args.output).resolve()
if output.exists():
    raise SystemExit('Output already exists; choose a new artifact path.')
for name, info in files.items():
    path = root / name
    if path.is_symlink() or '..' in Path(name).parts or Path(name).is_absolute():
        raise SystemExit('Invalid bundle entry: ' + name)
    if hashlib.sha256(path.read_bytes()).hexdigest() != info['sha256']:
        raise SystemExit('Stale manifest: ' + name)
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    for name, info in sorted(files.items()):
        item = zipfile.ZipInfo('dotai-workflow/' + name)
        item.external_attr = (stat.S_IFREG | info['mode']) << 16
        item.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(item, (root / name).read_bytes())
print(json.dumps({'archive': str(output), 'skills': len(manifest['skills']), 'files': len(files), 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}, indent=2))
