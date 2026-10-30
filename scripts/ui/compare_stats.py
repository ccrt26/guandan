#!/usr/bin/env python3
"""战绩页截图 vs design-truth-1672x941 分区对比 + 关键元素 bbox 测量。
目标：主要块 ±2px、行列 ±1px。
输出可用 GD_TASK_ID / GD_TASK_OUTPUT_ROOT 指定，默认新建 lab/out/<任务>。
用法: python3 compare_sp.py <shot.png> [tag]"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'packages').is_dir() and (p/'package.json').is_file())
sys.path.insert(0, str(ROOT/'scripts'))
from project_paths import task_output
REF = ROOT / 'deliverables/ui/reference-20261030/results_ui_handoff/reference/design-truth-1672x941.png'
OUT = task_output('ui-sp-compare')
OUT.mkdir(parents=True, exist_ok=True)

shot_path = Path(sys.argv[1])
tag = sys.argv[2] if len(sys.argv) > 2 else shot_path.stem
ref = Image.open(REF).convert('RGB')
shot = Image.open(shot_path).convert('RGB')
assert ref.size == shot.size == (1672, 941), f'size mismatch {ref.size} vs {shot.size}'
a = np.asarray(ref, dtype=np.int16)
b = np.asarray(shot, dtype=np.int16)
lr = np.asarray(ref.convert('L'), dtype=np.uint8)
ls = np.asarray(shot.convert('L'), dtype=np.uint8)
diff = np.abs(a - b).max(axis=2)

REGIONS = {
    'header': (0, 0, 1672, 57),
    'title': (60, 60, 500, 130),
    'summary_box': (40, 190, 1600, 185),
    'hero_dark': (54, 204, 465, 154),
    'metrics': (555, 220, 700, 110),
    'recent6': (1255, 235, 330, 100),
    'records_heading': (55, 378, 420, 58),
    'table': (54, 441, 1114, 437),
    'aside': (1180, 372, 460, 520),
    'footer': (30, 893, 1612, 48),
    'decor': (1400, 57, 272, 142),
}

def region_stats(x, y, w, h):
    d = diff[y:y+h, x:x+w]
    return {'mean': round(float(d.mean()), 2), 'p99': int(np.percentile(d, 99)),
            'gt30': round(float((d > 30).mean() * 100), 2), 'gt8': round(float((d > 8).mean() * 100), 2)}

def dark_bbox(img, x, y, w, h, thr=110):
    reg = img[y:y+h, x:x+w]
    ys, xs = np.where(reg < thr)
    if len(xs) == 0: return None
    return [int(x+xs.min()), int(y+ys.min()), int(x+xs.max()), int(ys.max()+y)]

def light_bbox(img, x, y, w, h, thr=170):
    reg = img[y:y+h, x:x+w]
    ys, xs = np.where(reg > thr)
    if len(xs) == 0: return None
    return [int(x+xs.min()), int(y+ys.min()), int(x+xs.max()), int(ys.max()+y)]

def hline_ys(img, x0, x1, y0, y1, thr=215):
    """在竖直区间内找横向分隔线（整行明显变暗）"""
    band = img[y0:y1, x0:x1].mean(axis=1)
    ys = [int(y0+i) for i, v in enumerate(band) if v < thr]
    groups = []
    for y in ys:
        if groups and y - groups[-1][-1] <= 2: groups[-1].append(y)
        else: groups.append([y])
    return [g[0] for g in groups]

def green_centers(x0, y0, w, h):
    """绿色圆点行：返回每列绿像素重心x"""
    rgb = a[y0:y0+h, x0:x0+w]
    gr = (rgb[...,1].astype(int) - rgb[...,0].astype(int) > 25) & (rgb[...,1] > 70)
    gs = np.asarray(shot.convert('RGB'), dtype=np.int16)[y0:y0+h, x0:x0+w]
    grs = (gs[...,1] - gs[...,0] > 25) & (gs[...,1] > 70)
    def centers(mask):
        cols = np.where(mask.any(axis=0))[0]
        out = []
        for c in cols:
            if out and c - out[-1][-1] <= 3: out[-1].append(c)
            else: out.append([c])
        return [round(np.mean(g)) + x0 for g in out]
    return centers(gr), centers(grs)

report = {'shot': str(shot_path), 'regions': {}}
lines = [f"{'region':<16}{'mean':>8}{'p99':>6}{'>30%':>8}{'>8%':>8}"]
for name, (x, y, w, h) in REGIONS.items():
    s = region_stats(x, y, w, h)
    report['regions'][name] = s
    lines.append(f"{name:<16}{s['mean']:>8}{s['p99']:>6}{s['gt30']:>8}{s['gt8']:>8}")

# ---- 关键元素测量 ----
m = {}
m['brand_icon  ref(70,15,~96,43)'] = (dark_bbox(lr, 55, 5, 60, 47), dark_bbox(ls, 55, 5, 60, 47))
m['nav_underline ref(~1365,52,57,4)'] = (dark_bbox(lr, 1330, 42, 130, 15, thr=100), dark_bbox(ls, 1330, 42, 130, 15, thr=100))
m['title ref(75,86,~345,152)'] = (dark_bbox(lr, 60, 62, 520, 110), dark_bbox(ls, 60, 62, 520, 110))
m['hero ref(54,204,519,358)'] = (dark_bbox(lr, 40, 196, 500, 170, thr=90), dark_bbox(ls, 40, 196, 500, 170, thr=90))
m['hero_100% light ref(~101,224)'] = (light_bbox(lr, 80, 210, 260, 95), light_bbox(ls, 80, 210, 260, 95))
m['digit6 ref(~574,236)'] = (dark_bbox(lr, 555, 225, 130, 85), dark_bbox(ls, 555, 225, 130, 85))
m['digit5 brass ref(~798,236)'] = (dark_bbox(lr, 785, 225, 130, 85, thr=160), dark_bbox(ls, 785, 225, 130, 85, thr=160))
m['digit4 ref(~1038,236)'] = (dark_bbox(lr, 1025, 225, 130, 85), dark_bbox(ls, 1025, 225, 130, 85, thr=130))
m['win1 ref(~332,507,59,40)'] = (dark_bbox(lr, 320, 495, 90, 55, thr=90), dark_bbox(ls, 320, 495, 90, 55, thr=90))
m['time1 ref(~92,520)'] = (dark_bbox(lr, 85, 508, 210, 35, thr=150), dark_bbox(ls, 85, 508, 210, 35, thr=150))
m['footer ref(~59,902)'] = (dark_bbox(lr, 40, 893, 700, 45, thr=150), dark_bbox(ls, 40, 893, 700, 45, thr=150))
m['table_hlines ref(441,493,558,621,684,747,810)'] = (
    hline_ys(lr, 1108, 1140, 435, 890, thr=225),
    hline_ys(ls, 1108, 1140, 435, 890, thr=225),
)
m['settings ref(1565,6,47,47)'] = (dark_bbox(lr, 1548, 0, 124, 57, thr=215), dark_bbox(ls, 1548, 0, 124, 57, thr=215))
m['aside_cards ref(445/573..588/720..735)'] = (
    hline_ys(lr, 1250, 1550, 435, 880, thr=225),
    hline_ys(ls, 1250, 1550, 435, 880, thr=225),
)
m['circle_centers ref(1290..1550 step52)'] = green_centers(1260, 275, 320, 50)
def green_bbox(img_rgb, x, y, w, h):
    reg = img_rgb[y:y+h, x:x+w]
    mask = (reg[..., 1].astype(int) - reg[..., 0].astype(int) > 25) & (reg[..., 1] > 70)
    ys, xs = np.where(mask)
    if len(xs) == 0: return None
    return [int(x+xs.min()), int(y+ys.min()), int(x+xs.max()), int(y+ys.max())]
m['track_green(中级fill) ref(~1233,666,1584,677)'] = (
    green_bbox(a, 1225, 650, 370, 30), green_bbox(b, 1225, 650, 370, 30))
m['time1 ref(~94,520,263,532)'] = (dark_bbox(lr, 85, 508, 210, 35, thr=150), dark_bbox(ls, 85, 508, 210, 35, thr=150))
m['digit5 ref(~802,244)'] = (dark_bbox(lr, 785, 225, 130, 85, thr=160), dark_bbox(ls, 785, 225, 130, 85, thr=160))
m['title ref(78,92,323,171)'] = (dark_bbox(lr, 60, 62, 520, 110), dark_bbox(ls, 60, 62, 520, 110))

lines.append('--- elements (ref vs shot bbox [x0,y0,x1,y1]) ---')
for k, (r, s) in m.items():
    lines.append(f"{k:<42} ref={r} shot={s}")

report['elements'] = {k: {'ref': r, 'shot': s} for k, (r, s) in m.items()}
(OUT / f'compare_{tag}.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf8')
print('\n'.join(lines))

# 热图
heat = np.zeros((941, 1672, 3), dtype=np.uint8)
heat[..., 0] = np.clip(diff * 3, 0, 255)
heat[..., 1] = np.clip((diff - 20) * 4, 0, 255) * (diff > 20)
heat[..., 2] = np.clip((diff - 60) * 6, 0, 255) * (diff > 60)
Image.fromarray(heat).save(OUT / f'heat_{tag}.png')
print('heatmap:', OUT / f'heat_{tag}.png')
