#!/usr/bin/env python3
"""gt 两状态 vs 参考图：区域误差 + 上下并排 + 热图。
输出可用 GD_TASK_ID / GD_TASK_OUTPUT_ROOT 指定，默认新建 lab/out/<任务>。
用法: python3 gt_compare.py tribute <shot.png>"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

PROJECT = next(p for p in Path(__file__).resolve().parents if (p/'packages').is_dir() and (p/'package.json').is_file())
sys.path.insert(0, str(PROJECT/'scripts'))
from project_paths import task_output
ROOT = PROJECT/'deliverables/ui/reference-20261030/ui_play_tribute_handoff'
OUT = task_output('ui-gt-compare')
OUT.mkdir(parents=True, exist_ok=True)

REFS = {
    'tribute': ROOT / 'references/03_贡还结果_按钮继续_当前.png',
    'normal': ROOT / 'references/01_正常牌桌_布局参考.png',
}
REGIONS = {
    'header': (0, 0, 1800, 66),
    'table_north': (0, 66, 1800, 250),
    'table_mid': (0, 300, 1800, 260),
    'panel': (528, 167, 745, 372),
    'hand': (100, 570, 1600, 220),
    'footer': (0, 789, 1800, 85),
}

def main():
    kind, shot_path = sys.argv[1], Path(sys.argv[2])
    ref = Image.open(REFS[kind]).convert('RGB')
    shot = Image.open(shot_path).convert('RGB')
    assert ref.size == shot.size == (1800, 874), f'{ref.size} vs {shot.size}'
    a = np.asarray(ref, dtype=np.int16); b = np.asarray(shot, dtype=np.int16)
    diff = np.abs(a - b).max(axis=2)
    lines = [f'== {kind} ==', f"{'region':<12}{'mean':>8}{'>30%':>8}{'>8%':>8}"]
    for name, (x, y, w, h) in REGIONS.items():
        d = diff[y:y+h, x:x+w]
        lines.append(f"{name:<12}{d.mean():>8.1f}{(d>30).mean()*100:>8.2f}{(d>8).mean()*100:>8.2f}")
    print('\n'.join(lines))
    heat = np.zeros((874, 1800, 3), dtype=np.uint8)
    heat[..., 0] = np.clip(diff * 3, 0, 255)
    heat[..., 1] = np.clip((diff - 20) * 4, 0, 255) * (diff > 20)
    Image.fromarray(heat).save(OUT / f'heat_{kind}.png')
    canvas = Image.new('RGB', (1800, 874 * 2 + 6), (255, 0, 255))
    canvas.paste(ref, (0, 0)); canvas.paste(shot, (0, 880))
    canvas.save(OUT / f'sbs_{kind}.png')
    print('saved', OUT / f'heat_{kind}.png', OUT / f'sbs_{kind}.png')

if __name__ == '__main__':
    main()
