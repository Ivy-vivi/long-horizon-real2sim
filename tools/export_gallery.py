#!/usr/bin/env python3
"""Export the gallery to docs/ without writing to the source application.

Only explicitly allowed display fields and recompressed images are published.
The local catalog, media map, and source paths stay in ignored .local/.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from PIL import Image, ImageOps, ImageDraw

BASE = Path(__file__).resolve().parents[1]
LIMIT = 10


def read(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return {} if default is None else default


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


def uniform_indices(length, count=LIMIT):
    if length <= count:
        return list(range(length))
    return [round(i * (length - 1) / (count - 1)) for i in range(count)]


def pose_selection(poses, count):
    """Deterministic maximin selection over position, direction and sequence."""
    n = len(poses)
    if n <= count:
        return list(range(n))
    diagonal = math.sqrt(sum((max(p[0][k] for p in poses) - min(p[0][k] for p in poses)) ** 2 for k in range(3))) or 1
    def distance(i, j):
        p, d = poses[i]
        q, e = poses[j]
        spatial = math.sqrt(sum((a - b) ** 2 for a, b in zip(p, q))) / diagonal
        angle = math.acos(max(-1, min(1, sum(a * b for a, b in zip(d, e))))) / math.pi
        return 0.45 * spatial + 0.45 * angle + 0.10 * abs(i - j) / (n - 1)
    selected = [0, n - 1]
    while len(selected) < count:
        selected.append(max((i for i in range(n) if i not in selected), key=lambda i: (min(distance(i, j) for j in selected), -i)))
    return sorted(selected)


def camera_poses(root, kind, scene, images, files):
    if kind not in ('scenes', '2k') or not images:
        return None
    run = root / 'runs' / ('2K' if kind == '2k' else 'stage1') / scene['id']
    source = Path(files.get(images[0]['id'], ''))
    match = re.search(r'(?:^|/)(round_\d+)(?:/|$)', str(source))
    archive = root / 'comparison' / ('2K' if kind == '2k' else '') / scene['id']
    snapshot = read(archive / 'manifest.json').get('comparison_snapshot')
    if match:
        snapshot = 'snapshots/' + match[1]
    if not snapshot:
        rounds = read(run / 'state.json').get('rounds', [])
        snapshot = rounds[-1].get('snapshot') if rounds else None
    if not isinstance(snapshot, str) or not re.fullmatch(r'snapshots/round_\d+', snapshot):
        return None
    delivery = read(run / snapshot / 'delivery.json')
    camera_file = delivery.get('cameras_file', 'final/cameras.json')
    if Path(camera_file).is_absolute() or '..' in Path(camera_file).parts:
        return None
    cameras = read(run / snapshot / camera_file)
    frames = cameras.get('frames', cameras.get('cameras', [])) if isinstance(cameras, dict) else cameras
    if not isinstance(frames, list):
        return None
    lookup = {str(c.get('reference_id')): c for c in frames if isinstance(c, dict)}
    evidence = delivery.get('evidence', [])
    poses = []
    for im in images:
        m = re.fullmatch(r'comparison_(\d+)\.(?:png|jpe?g|webp)', Path(files.get(im['id'], im['name'])).name)
        if not m or not 0 <= int(m[1]) - 1 < len(evidence):
            return None
        ref = str(evidence[int(m[1]) - 1].get('reference_id'))
        c = lookup.get(ref, {})
        matrix = c.get('blender_c2w')
        if not isinstance(matrix, list) or len(matrix) != 4:
            return None
        try:
            pos = [float(matrix[i][3]) for i in range(3)]
            direction = [-float(matrix[i][2]) for i in range(3)]
            norm = math.sqrt(sum(x * x for x in direction))
            if not norm or not all(math.isfinite(x) for x in pos + direction):
                return None
            poses.append((pos, [x / norm for x in direction]))
        except (ValueError, TypeError, IndexError):
            return None
    return poses


def comparisons(images):
    """Keep comparison panels, excluding nested render/detail duplicates."""
    direct = [i for i in images if '/' not in i['name'].split(' · ', 1)[-1]]
    candidates = direct or [i for i in images if re.search(r'(对照|对比)/', i['name'])]
    panels = [i for i in candidates if re.search(r'(comparison_\d+|view_\d+|ref_\d+)', i['name'], re.I)]
    return panels or candidates


def status_for(scene):
    generation = scene.get('generation', {})
    raw = generation.get('status', scene.get('status', 'waiting'))
    if raw == 'accepted':
        return 'complete', '审核通过'
    if raw == 'maxturns_reached':
        return 'complete', '迭代结束 · 轮数上限'
    if raw in ('available', 'ready', 'partial'):
        return 'available', '已有结果'
    if generation.get('running') or raw == 'running':
        return 'running', '构建中'
    if raw in ('needs_attention', 'interrupted', 'failed', 'error'):
        return 'attention', '需复核 / 已中断'
    return 'waiting', '等待结果'


def export_image(task, files, out):
    sources = task.pop('_sources')
    fingerprint = hashlib.sha256('|'.join(i['url'] for i in sources).encode()).hexdigest()[:20]
    name = fingerprint + '.webp'
    target = out / 'media' / name
    thumb = out / 'media' / (fingerprint + '-sm.webp')
    if target.exists() and thumb.exists():
        with Image.open(target) as im:
            size = im.size
    else:
        originals = []
        for source in sources:
            path = Path(files[source['id']])
            if path.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp') or path.is_symlink():
                raise ValueError('Invalid source image')
            with Image.open(path) as im:
                originals.append(ImageOps.exif_transpose(im).convert('RGB'))
        if len(originals) == 2:
            height = min(max(im.height for im in originals), 900)
            panels = [im.resize((round(im.width * height / im.height), height), Image.Resampling.LANCZOS) for im in originals]
            merged = Image.new('RGB', (sum(im.width for im in panels) + 8, height + 30), '#f6f7f3')
            draw = ImageDraw.Draw(merged)
            x = 0
            for panel, label in zip(panels, ('SCENE REFERENCE', 'SHELL')):
                merged.paste(panel, (x, 30)); draw.text((x + 10, 8), label, fill='#315c46'); x += panel.width + 8
            im = merged
        else:
            im = originals[0]
        # Keep original comparison headers and both sides in the public image.
        im.thumbnail((1920, 1440), Image.Resampling.LANCZOS)
        im.save(target, 'WEBP', quality=84, method=4)
        size = im.size
        im.thumbnail((480, 360), Image.Resampling.LANCZOS)
        im.save(thumb, 'WEBP', quality=75, method=4)
    task.update(src='media/' + name, thumb='media/' + thumb.name, width=size[0], height=size[1])
    return task


def build_scene(kind, scene, root, files, jobs):
    state, label = status_for(scene)
    row = {k: scene[k] for k in ('id', 'name', 'number') if k in scene}
    row.update(state=state, status_label=label, images=[], source_count=len(scene.get('images', [])))
    gen = scene.get('generation', {})
    row['rounds'] = int(gen.get('rounds', 0))
    row['max_rounds'] = int(gen.get('max_rounds', 0))
    row['versions'] = [{'name': r['name'], 'incomplete': bool(r.get('incomplete')), 'accepted': bool(r.get('accepted'))} for r in scene.get('rounds', scene.get('versions', []))]
    if kind == 'zican':
        row['version'] = scene.get('latest_round') or '等待归档'
    elif kind == 'shells':
        row['version'] = scene.get('display_version', {}).get('label', '当前版本')
    else:
        row['version'] = f"第 {row['rounds']} 轮" if row['rounds'] else '已有结果'
    images = scene.get('images', [])
    if kind == 'shells':
        overview = [i for i in images if '整体' in i['name']]
        for i in overview[:1]:
            row['images'].append({'label': '整体剖视', '_sources': [i]})
        for n in range(1, 6):
            pair = [next((i for i in images if prefix in i['name'] and i['name'].endswith(f'{n:02d}')), None) for prefix in ('场景视角', 'Shell 视角')]
            if all(pair):
                row['images'].append({'label': f'室内视角 {n:02d} · 场景 / Shell', '_sources': pair})
        row['selection'] = 'paired'
    else:
        if kind == 'zican':
            images = comparisons(images)
        # Explicit successful revisions on the original page remain visible.
        revisions = [j for j in jobs if kind == 'scenes' and j.get('scene') == scene['id'] and j.get('status') == 'succeeded' and j.get('images') and j.get('kind', 'scene') == 'scene']
        revision = max(revisions, key=lambda j: j.get('created', 0)) if revisions else None
        revised = revision.get('images', [])[:LIMIT] if revision else []
        budget = LIMIT - len(revised)
        poses = camera_poses(root, kind, scene, images, files) if budget > 1 else None
        indices = (pose_selection(poses, budget) if poses and budget >= 2 else uniform_indices(len(images), budget) if budget >= 2 else [0] if budget and images else [])
        row['selection'] = 'camera' if poses else 'sequence'
        for i in indices:
            im = images[i]
            row['images'].append({'label': im['name'], 'source_index': i + 1, '_sources': [im]})
        for i, im in enumerate(revised):
            row['images'].append({'label': f'修订结果 · {i + 1:02d}', '_sources': [im]})
        if revision:
            row['version'] += ' · 含已完成修订'
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--source-url', help='Running gallery origin; only GET endpoints are read')
    parser.add_argument('--cached', action='store_true', help='Use the snapshot already in .local/')
    args = parser.parse_args()
    root = args.source_root.resolve()
    local = BASE / '.local'; local.mkdir(exist_ok=True)
    out = BASE / 'docs'; (out / 'media').mkdir(parents=True, exist_ok=True)
    if not args.cached:
        if not args.source_url:
            parser.error('--source-url is required without --cached')
        for target, endpoint in [('catalog', '/api/catalog'), ('stats-scene', '/api/generation-stats'), ('stats-2k', '/api/generation-stats?kind=2k')]:
            with urlopen(args.source_url.rstrip('/') + endpoint, timeout=45) as response:
                save(local / (target + '.json'), json.load(response))
        app = root / 'web_distillation_result'
        cache_id = hashlib.sha256(str(app).encode()).hexdigest()[:16]
        save(local / 'files.json', read(Path.home() / '.cache/grase-gallery' / cache_id / 'catalog.json')['files'])
    catalog = read(local / 'catalog.json'); files = read(local / 'files.json')
    groups = [
        ('scenes', '场景生成', '从实拍到可重建的三维空间', catalog['scenes']),
        ('2k', '2K 场景', '独立场景集合与生成进度', catalog.get('two_k', {}).get('scenes', [])),
        ('shells', 'Shell 蒸馏', '完整场景与空间结构的配对对照', [s for b in catalog.get('shells', []) for s in b['scenes']]),
        ('zican', 'zican', '归档场景与最新迭代结果', catalog.get('zican', {}).get('scenes', [])),
    ]
    result = {'schema_version': 1, 'published_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'), 'view_limit': LIMIT, 'collections': [], 'stats': {}}
    for kind, name, description, scenes in groups:
        print(f'Preparing {kind}: {len(scenes)} scenes', flush=True)
        with ThreadPoolExecutor(max_workers=4) as pool:
            rows = list(pool.map(lambda s: build_scene(kind, s, root, files, catalog.get('jobs', [])), scenes))
        result['collections'].append({'id': kind, 'name': name, 'description': description, 'scenes': rows})
    tasks = [im for group in result['collections'] for scene in group['scenes'] for im in scene['images']]
    print(f'Exporting {len(tasks)} selected comparison panels', flush=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(export_image, task, files, out) for task in tasks]
        for n, future in enumerate(as_completed(futures), 1):
            future.result()
            if n % 100 == 0 or n == len(tasks):
                print(f'Images {n}/{len(tasks)}', flush=True)
    for kind, key in [('scenes', 'scene'), ('2k', '2k')]:
        stats = read(local / f'stats-{key}.json')
        result['stats'][kind] = {k: stats.get(k) for k in ('total', 'today', 'estimated_total')}
        result['stats'][kind]['days'] = [{k: d[k] for k in ('date', 'count', 'scene_ids', 'estimated_scene_ids', 'finalized') if k in d} for d in stats.get('days', [])]
    # Commit metadata only after every selected asset has been exported.
    save(out / 'data.json', result)
    referenced = {im[k] for group in result['collections'] for s in group['scenes'] for im in s['images'] for k in ('src', 'thumb')}
    for path in (out / 'media').glob('*.webp'):
        if str(path.relative_to(out)) not in referenced:
            path.unlink()
    print(json.dumps({'scenes': sum(len(c['scenes']) for c in result['collections']), 'panels': len(tasks), 'size_mib': round(sum(p.stat().st_size for p in out.rglob('*') if p.is_file()) / 1048576, 1)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
