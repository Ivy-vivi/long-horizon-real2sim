#!/usr/bin/env python3
"""Verify the public artifact, every asset reference, and publication limits."""
import json
from pathlib import Path
import re
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'docs'
data = json.loads((root / 'data.json').read_text())
raw = (root / 'data.json').read_text()
assert not re.search(r'/storage/|/home/|10\.28\.|thread_id|thread_cwd|admin_token|access_token|execution_prompt|review_requests|gh[o-p]_', raw)
assert data['view_limit'] == 10
assert [c['id'] for c in data['collections']] == ['scenes','2k','shells','zican']
referenced = set()
for group in data['collections']:
    assert len({s['id'] for s in group['scenes']}) == len(group['scenes'])
    for scene in group['scenes']:
        assert len(scene['images']) <= 10, scene['id']
        for image in scene['images']:
            assert 0 < image['width'] <= 1920 and 0 < image['height'] <= 1440
            for key in ('src','thumb'):
                path = image[key]
                assert re.fullmatch(r'media/[0-9a-f]{20}(?:-sm)?\.webp', path), path
                referenced.add(path)
for path in referenced:
    with Image.open(root / path) as im:
        im.verify()
for group in data['stats'].values():
    assert sum(d['count'] for d in group['days']) == group['total']
assert referenced == {str(p.relative_to(root)) for p in (root / 'media').glob('*.webp')}
assert sum(p.stat().st_size for p in root.rglob('*') if p.is_file()) < 900 * 1024 ** 2
print(f"OK: {sum(len(c['scenes']) for c in data['collections'])} scenes; {len(referenced)} valid media files; 10-panel limit; relative paths; public metadata")
