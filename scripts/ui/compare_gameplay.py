#!/usr/bin/env python3
"""整页截图 vs 批准真值 分区对比：approved-v4-2560.png 为第一真值。
输出：分区误差表(json+text)、全页热图、每区域并排裁切图。
输出可用 GD_TASK_ID / GD_TASK_OUTPUT_ROOT 指定，默认新建 lab/out/<任务>。
用法: python3 compare.py <shot.png> [tag]"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'packages').is_dir() and (p/'package.json').is_file())
sys.path.insert(0, str(ROOT/'scripts'))
from project_paths import task_output
REF = ROOT / 'deliverables/ui/reference-20261030/ui_full_gameplay_handoff/reference/approved-v4-2560.png'
OUT = task_output('ui-gp-compare')
OUT.mkdir(parents=True, exist_ok=True)

shot_path = Path(sys.argv[1])
tag = sys.argv[2] if len(sys.argv) > 2 else shot_path.stem

ref = Image.open(REF).convert('RGB')
shot = Image.open(shot_path).convert('RGB')
assert ref.size == shot.size == (2560, 1440), f'size mismatch {ref.size} vs {shot.size}'

a = np.asarray(ref, dtype=np.int16)
b = np.asarray(shot, dtype=np.int16)
diff = np.abs(a - b).max(axis=2)  # 每像素最大通道差

REGIONS = {
    'topbar_nav':    (0, 0, 2560, 96),
    'toolbar':       (0, 96, 2560, 108),
    'notice':        (0, 204, 2560, 48),
    'table_frame':   (5, 250, 2550, 984),
    'player_north':  (1143, 290, 276, 118),
    'player_west':   (46, 631, 312, 123),
    'player_east':   (2202, 631, 312, 123),
    'pass_north':    (1176, 440, 210, 100),
    'pass_west':     (630, 650, 210, 100),
    'played_east':   (1580, 540, 620, 320),
    'played_self':   (1010, 650, 520, 330),
    'hand_row':      (440, 920, 1800, 300),
    'hand_tag':      (40, 1110, 500, 120),
    'actions_bar':   (24, 1246, 2512, 163),
    'outside_table': (0, 0, 2560, 1440),
}

def region_stats(x, y, w, h, mask=None):
    d = diff[y:y+h, x:x+w] if mask is None else (diff * mask)[y:y+h, x:x+w]
    return {
        'mean': round(float(d.mean()), 2),
        'p99': int(np.percentile(d, 99)),
        'gt30_pct': round(float((d > 30).mean() * 100), 2),
        'gt8_pct': round(float((d > 8).mean() * 100), 2),
    }

report = {'shot': str(shot_path), 'ref': str(REF), 'tag': tag, 'regions': {}}
for name, (x, y, w, h) in REGIONS.items():
    if name == 'outside_table':
        continue
    report['regions'][name] = region_stats(x, y, w, h)
report['overall'] = region_stats(0, 0, 2560, 1440)

# 热图：diff>8 起热
heat = np.zeros((1440, 2560, 3), dtype=np.uint8)
heat[..., 0] = np.clip(diff * 3, 0, 255)
heat[..., 1] = np.clip((diff - 20) * 4, 0, 255) * (diff > 20)
heat[..., 2] = np.clip((diff - 60) * 6, 0, 255) * (diff > 60)
Image.fromarray(heat).save(OUT / f'heat_{tag}.png')

# 每区域上下并排（ref 上 / shot 下）
for name, (x, y, w, h) in REGIONS.items():
    if name == 'outside_table':
        continue
    crop_r = ref.crop((x, y, x + w, y + h))
    crop_s = shot.crop((x, y, x + w, y + h))
    canvas = Image.new('RGB', (w, h * 2 + 6), (255, 0, 255))
    canvas.paste(crop_r, (0, 0))
    canvas.paste(crop_s, (0, h + 6))
    canvas.save(OUT / f'crop_{tag}_{name}.png')

(OUT / f'compare_{tag}.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf8')
lines = [f"{'region':<14}{'mean':>8}{'p99':>6}{'>30 %':>9}{'>8 %':>9}"]
for name, s in report['regions'].items():
    lines.append(f"{name:<14}{s['mean']:>8}{s['p99']:>6}{s['gt30_pct']:>9}{s['gt8_pct']:>9}")
lines.append(f"{'OVERALL':<14}{report['overall']['mean']:>8}{report['overall']['p99']:>6}{report['overall']['gt30_pct']:>9}{report['overall']['gt8_pct']:>9}")
(OUT / f'compare_{tag}.txt').write_text('\n'.join(lines), encoding='utf8')
print('\n'.join(lines))
print('heatmap:', OUT / f'heat_{tag}.png')
