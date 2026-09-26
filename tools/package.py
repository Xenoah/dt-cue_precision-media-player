#!/usr/bin/env python3
"""Create reproducible release assets using only the Python standard library."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
OUT = ROOT / 'release-assets'
OUT.mkdir(exist_ok=True)
for pattern in ('dt-cue-v*.zip', 'dt-cue-global-controls-v*.zip', 'dt-cue-*.jpg', 'SHA256SUMS.txt'):
    for previous in OUT.glob(pattern):
        if previous.is_file():
            previous.unlink()


def archive(path, files):
    with ZipFile(path, 'w', ZIP_DEFLATED, compresslevel=9) as z:
        for source, name in sorted(files, key=lambda item: str(item[1])):
            entry = ZipInfo(str(name).replace('\\', '/'), (2026, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            z.writestr(entry, source.read_bytes())
    with ZipFile(path) as z:
        if z.testzip() is not None:
            raise RuntimeError(f'Archive verification failed: {path}')


extension = [(p, p.relative_to(ROOT / 'extension')) for p in (ROOT / 'extension').rglob('*') if p.is_file()]
archive(ROOT / 'site/dtcue-extension.zip', extension)
shutil.copyfile(ROOT / 'site/dtcue-extension.zip', OUT / f'dt-cue-global-controls-v{VERSION}.zip')

excluded = {'.git', '.sites-runtime', 'node_modules', 'release-assets', '__pycache__'}
files = [(p, Path('dt-cue_precision-media-player') / p.relative_to(ROOT)) for p in ROOT.rglob('*')
         if p.is_file() and not any(part in excluded for part in p.relative_to(ROOT).parts)]
archive(OUT / f'dt-cue-v{VERSION}.zip', files)
for p in sorted((ROOT / 'docs').glob('dt-cue-*.jpg')):
    shutil.copyfile(p, OUT / p.name)
digests = [f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}'
           for p in sorted(OUT.iterdir()) if p.is_file() and p.name != 'SHA256SUMS.txt']
(OUT / 'SHA256SUMS.txt').write_text('\n'.join(digests) + '\n')
print(json.dumps({'version': VERSION, 'assets': [p.name for p in sorted(OUT.iterdir())]}, ensure_ascii=False))
