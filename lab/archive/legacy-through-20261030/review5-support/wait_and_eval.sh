#!/bin/bash
# 等待 P 六 run 全部 train-end，然后自动执行 T7 开发评测（32 块）
cd /Users/ccrt/game/guandan
while true; do
  done_runs=$(grep -l '"phase":"train-end"' lab/review5/artifacts/runs/r5-p*/runtime_ledger.jsonl 2>/dev/null | wc -l | tr -d ' ')
  echo "$(date +%H:%M:%S) 完成 run 数: $done_runs/6"
  if [ "$done_runs" -ge 6 ]; then break; fi
  sleep 120
done
echo "=== 六 run 全部完成，开始 T7 评测 $(date +%H:%M:%S) ==="
npx tsx lab/src/review5eval.ts --blocks 32 > lab/review5/artifacts/eval/t7-dev.log 2>&1
echo "T7 评测退出码 $? $(date +%H:%M:%S)"
