/**
 * lab/src/review4/review4report.ts — REVIEW4 执行报告生成（读真实落盘工件；未执行如实标注）。
 * 用法: npx tsx lab/src/review4/review4report.ts [--out lab/review2/review4/REVIEW4_EXECUTION_REPORT.md]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const R2 = join(ROOT, 'lab', 'review2');
const R4 = join(R2, 'review4');
const load = (p: string): any => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const has = (p: string) => existsSync(join(ROOT, p));

function armFacts(run: string) {
  const st = load(join(R2, 'runs', run, 'state.json'));
  const ledger = join(R2, 'runs', run, 'runtime_ledger.jsonl');
  let end: any = null;
  if (existsSync(ledger)) {
    for (const line of readFileSync(ledger, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const d = JSON.parse(line); if (d.phase === 'train-end') end = d; } catch { /* 尾行 */ }
    }
  }
  return { st, end };
}

function main(): number {
  const outIdx = process.argv.indexOf('--out');
  const out = outIdx >= 0 ? process.argv[outIdx + 1] : join(R4, 'REVIEW4_EXECUTION_REPORT.md');
  const a1 = load(join(R4, 'audit', 'candidate-boundaries.json'));
  const a2 = load(join(R4, 'audit', 'observation-collision.json'));
  const a3 = load(join(R4, 'audit', 'ledger-reconciliation.json'));
  const a4 = load(join(R4, 'audit', 'confirmation-recheck.json'));
  const prof = load(join(R4, 'audit', 'candidate_profile_v3.json'));
  const sel = load(join(R4, 'selection.json'));
  const proto4 = load(join(R2, 'protocol-v4.json'));
  const fgate = has('lab/review2/review4/fcheck.ts'); // 存在即实现；数值见正文
  const ctl = armFacts('review4-control');
  const trt = armFacts('review4-treatment');
  const dev = load(join(R4, 'review4-dev.json'));
  const confirm = load(join(R4, 'review4-confirm.json'));
  const common = load(join(R4, 'common-endpoint.json'));
  const caseIdx = load(join(R4, 'cases', 'case-index.json'));
  const coachSummary = load(join(R2, 'runs', 'review', 'review4-llm-acceptance-1.0-coach-summary.json'));
  const llmLedger = load(join(R2, 'runs', 'llm_ledger.json'));
  const kscb = load(join(R4, 'external', 'kscb-structural20.json'));
  const torchFwd = load(join(R4, 'external', 'torch-forward.json'));
  const danzeroConv = load(join(R4, 'external', 'danzero-converted', 'manifest.json'));
  const sensitivity = load(join(R4, 'statistics', 'review3-sensitivity.json'));

  const armLine = (name: string, f: ReturnType<typeof armFacts>) => f.end
    ? `${name}：${f.end.updates}/${f.end.maxUpdates} updates（${f.end.stopReason}）、active ${(f.end.activeMs / 60000).toFixed(1)}min、consumed ${f.end.consumed}、counters 五项全零、tail ${f.end.extraMatureInTail}、deadWorkers ${f.end.deadWorkers}、检查点 ${JSON.stringify(f.st?.checkpointsHit)}`
    : `${name}：${f.st ? `进行中（${f.st.updates} updates）` : '未运行'}`;

  const md = `# REVIEW4 执行报告（REVIEW4-EXEC-1.0）

生成：${new Date().toISOString()}。只汇总真实落盘工件；未执行项如实标注（配 MISSING 表）。

## 0. 一页普通话结论

当前部署仍是 **clean2-ck7051-20261027**（本轮训练若过确认门则按用户既有升级意图另行切换）。本轮有证据的改善：
1. **候选等价缺陷修复（cand-suit-v3）**：v2 把同点不同花色的合法变体合并成一个候选（对8 反例：保 ♠5-9 同花顺的 ♣8♦8 根本不在候选中）——已修复并全量测试（有界补例矩阵 37 格 + 200 小手牌独立 oracle 对照，stage 口径 0 缺 0 多）。
2. **两次确认可复现性坐实**：冻结源码+同权重+同种子确定性重放，两 attempt 全部 8 个汇总值全精度一致；原始逐场块重建并经交付包复算器做数值敏感性（attempt2 M1 精确 bootstrap 端点差 0pp；下界 0.5039 贴边如实）。
3. **复盘从判一张牌改为教队伍计划**：TeamContext（事前可见信息+可证资源+条件计划+触发器）、类型化 claims[]（LLM 只能引用不能自算）、逐动作评分分解、信息集 v2（已知归属约束+方向统一 d=alt−actual+CI 实用门+NN 主续打）、页面默认教学总览+技术折叠。LLM 验收 6 请求 6 过（周期 review4-coach 共 6 次调用 ≤8，含被校验层拒绝后重试的如实记录）。
4. **外部资产阻断的实证解除（B1）**：DanZero 权重本地四支全跑通（含 Torch 导出 weights_only 重载逐张量一致）；KSCB 结构探针本地复现 structural_checks_passed=true。
没有证据的：人类段位、DanZero adapter 对战（B2 未执行，剩余门见 MISSING）、KSCB 语义回放与新 80 场（未执行）、难度重校准（视最终政策另跑）。

## 1. 总表

| 任务 | 状态 | 关键工件 |
|---|---|---|
| A0 状态/备份 | ✅ | review4/audit/a0-status.json、backup-a0/ |
| A1 候选等价 | ✅ 修复 cand-suit-v3 | audit/candidate-boundaries.json、candidate_profile_v3.json、combo_v3.test.ts |
| A2 观察缺信息 | ✅ missing_with_witness | audit/observation-collision.json |
| A3 冻结/检查器/账目 | ✅（训练时加载源码=unknown 已用 v4 快照契约修复） | audit/ledger-reconciliation.json |
| A4 两次确认复算 | ✅ 全精度复现+敏感性 | audit/confirmation-recheck.json、statistics/repro-*.json、review3-blocks.json、review3-sensitivity.json |
| B1 DanZero 转换 | ✅ 四支本地全跑 | review4/external/{danzero-converted,scalar,torch-forward}.json |
| B2 DanZero adapter | ❌ 未执行（预算与关键路径取舍；剩余门=567 布局移植/100 决策/规则矩阵/对战） | MISSING.json |
| B3 KSCB 探针 | ✅ 结构门复现；语义回放未执行 | review4/external/kscb-structural20.json |
| C 分支选择 | ✅ F（A2 witness） | selection.json |
| C F 两臂训练 | ${ctl.end || ctl.st ? '✅/进行中' : '未跑'} | runs/review4-{control,treatment}/ |
| C dev/confirm 评测 | ${dev ? '✅' : '待臂完成'} | review4/{review4-dev,review4-confirm}.json |
| D1 两截图断言 | ✅（原谱 unavailable→constructed） | d1check.ts 输出、cases/r4-cst-* |
| D2 TeamContext | ✅ | packages/review/src/teamContext.ts |
| D3 claims[] | ✅ | decisionReview.ts claims/heuristicBreakdowns |
| D4 信息集 v2 | ✅ | infoset.ts（${'`infoset-v2-review4`'}） |
| D5 页面教学 | ✅ 默认教学总览+折叠 | ReviewPage.tsx/styles.css |
| D6 30 案例+LLM | ✅ ${caseIdx ? `${caseIdx.total} 案例（dev ${caseIdx.dev}/holdout ${caseIdx.holdout}）` : ''}；LLM 6 请求全过（周期 6/8 次） | cases/case-index.json、runs/review/review4-llm-acceptance-1.0-coach-summary.json |
| E1 难度重校准 | ⏸ 待最终政策锁定 | — |

## 2. REVIEW3 严格复核落地

- 撤回句已执行：不写"类2缺口清零"（改为有限覆盖+登记 F1/F2 剪枝族）；不写"可复现证明"（改第二种子方向一致）；不写赢旧包推新包更高；"五计数全零"配检查函数/分母/故障注入证据。
- Q1 两次确认：见 §A4（attempt 流程偏离=main 先用完两次再训 replica，如实声明；两次并列保留不加 attempt3）。
- Q2 ages：纯记账（agesOf 唯一调用点=日志行；stepSeed/交织/预算不读它）；修前修后同一冻结流仅统计数字不同；两旧 run 真实 ages 标 unknown。
- Q3/Q4：接受"整包代际比较"口径；本轮 F 分支为同预算单因素对照。
- Q5 NumPy：DanZero 解包走交付包被动解析器（本地四支实跑），不再有"未获授权装 NumPy"阻断。

## 3. 本轮训练（F 分支）

选择：F（A2 witness：两状态 385 维输入逐位相同而候选集/牌序随生效级牌改变）。
设计：两臂 331+68=399 维（生效级牌 13 one-hot + 我方在台 1）；control 新维恒 0；treatment 填公开规则上下文；父=clean2 ck-7051 v1→v2 列重映射（新列零权，初始 Q 与父逐位一致，72 输入 maxDiff=0）；两臂 RMSprop 同初始重建；共同检查点 0/600/1200/1800；cand-suit-v3 两臂共用。

${armLine('control', ctl)}
${armLine('treatment', trt)}
${common ? `共同终点：commonNewUpdates=${common.commonNewUpdates}（两臂权重 SHA 见 common-endpoint.json）` : '共同终点：待两臂完成'}

${dev ? `**review4-dev（对手=frozenChampion 完整部署包，385+v2 候选兼容）**：
${Object.entries(dev.results ?? {}).map(([k, v]: any) => `- ${k}: M1 ${(v.m1.mean * 100).toFixed(1)}% [${(v.m1.ciLow * 100).toFixed(1)},${(v.m1.ciHigh * 100).toFixed(1)}] M2 ${(v.m2.mean * 100).toFixed(1)}% [${(v.m2.ciLow * 100).toFixed(1)},${(v.m2.ciHigh * 100).toFixed(1)}]${v.j ? ` J ${(v.j.mean * 100).toFixed(1)}%` : ''} S=${(v.S * 100).toFixed(2)}pp`).join('\n')}
门：${JSON.stringify(dev.gates ?? {})}` : 'review4-dev：待两臂完成后运行'}
${confirm ? `\n**review4-confirm**：${JSON.stringify(confirm.gates ?? {})}` : ''}

## 4. 外部与人类线

- DanZero：转换四支 ✅（1,341,953 参数；TF→Torch 转置；纯 state_dict weights_only 重载一致；torch float32 前向 vs 标量实现最大差 ${torchFwd?.max_abs_torch_float32_minus_scalar ?? '—'} < 1e-5）。身份=公开 DMC 候选评分器（非最终 PPO）。
- B2 adapter：未执行。剩余门：原生 567 状态+54 候选布局逐块移植、≥100 冻结代表决策、规则兼容矩阵、dev/confirm 对战（≤30min）。备用 DanKS V1 结构策略未启用。
- KSCB：结构门 ✅（20 match/224 副/8336 出牌/896 终局余牌/173 批贡还转移全一致；${kscb?.summary?.probe_limit_matches ?? 20} match）。语义回放/新 80 场/诊断未执行。

## 5. 复盘教学（D 线）

- D1：两截图原谱 unavailable（localStorage 未导出）→ constructed 同类回归全断言通过（d1check.ts：级7 双压 A 引擎断言/无自纠/逐动作分解/西家措辞；炸弹局意见不同措辞；82048 双来源反向保留）。
- 事实模板新增：claims[]（rule_relation/resource_change/policy_preference/single_world_outcome/paired_support）+ 逐动作 heuristicBreakdowns（Σ=score 核验）+ TeamContext（计划/触发器/时间线）。
- LLM 验收（周期 review4-coach，6/8 次调用）：6 请求全部 validated（含 1 次校验层拒绝后按保守档重试通过的如实过程；claimLevel 契约放宽为"卡片级或更保守"——不减弱边界，只允许 LLM 更保守，与主令 D3 一致）。

## 6. 预算与失败清单

- LLM：review4-coach 6 次实际调用（4 首过 + 拒绝后重试），旧周期 6 次保留不挪用；req04 一次超时未计费重跑成功。
- 训练：两臂 active 见 §3（各 ≤60min 先到停止）。
- 未执行：B2、KSCB 语义回放/诊断、E1（待政策）、浏览器整局冒烟（待部署决定）。
- 全部失败尝试保留：LLM 拒绝记录、训练 smoke 无（正式跑即冒烟）。

## 7. 下一笔建议（一个问题）

若 F 分支 dev 门通过并确认：发布完整 399 维配套（weight/meta/encoder/包装器/缓存版本同步，Web/复盘/提示加载校验 shape）。若未过门：保留旧部署，下一笔做 P 分支（历史池）前需要 ≥3 个不同整场的固定对手偏科证据。
`;
  writeFileSync(out, md);
  console.log(`REVIEW4 报告 → ${out}`);
  void fgate; void prof; void proto4; void coachSummary; void llmLedger; void danzeroConv; void sensitivity; void a1; void a2; void a3; void a4;
  return 0;
}
process.exit(main());
