# 守卫缺陷诊断脚本（存档）
运行方式：拷回 lab/src/ 后 `npx tsx lab/src/_xxx.ts`（脚本内相对导入 `./seat` 等）。
- _whichcode.ts：判定昨晚结果由哪版守卫产生（旧守卫逐字段复现存档）
- _noopcheck.ts：守卫触发率 vs 语义改变率（44.1%/61.0%）
- _sanity.ts：修复后神经行为合理性（0 非法）
- _position.ts：armA_end vs 初级、真中级 vs 真初级（24/24 测试台验证）
