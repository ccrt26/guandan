#!/bin/bash
# REVIEW5 T6：六 run 顺序执行（每 run ≤1200 更新或 30 分钟，六 run 合计 ≤180 分钟）
cd /Users/ccrt/game/guandan
set -u
for pair in 1 2 3; do
  for arm in control treatment; do
    echo "=== pair $pair $arm start $(date +%H:%M:%S) ==="
    npx tsx lab/src/review5train.ts --pair "$pair" --arm "$arm" --max-updates 1200 --max-active-min 30 || echo "FAIL $pair $arm exit $?"
  done
done
echo "=== ALL DONE $(date +%H:%M:%S) ==="
