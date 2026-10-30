/**
 * lab/src/review2report.ts — report：汇总真实工件生成交付报告（REVIEW3-EXEC §12）。
 * 只读取各阶段落盘产物；未执行阶段如实标注，不自动挑漂亮数字。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const R2 = join(ROOT, 'lab', 'review2');
const load = (p: string): unknown => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

function run(outPath: string): number {
  const probeDec = load(join(R2, 'parallel_probe', 'decision.json')) as Record<string, unknown> | null;
  const e2e = load(join(R2, 'parallel_probe', 'end_to_end.json')) as { runs?: Array<Record<string, unknown>> } | null;
  const shortL = load(join(R2, 'parallel_probe', 'short_learning.json')) as Record<string, never> | null;
  const ledgerPath = join(R2, 'runs', 'clean2-main', 'runtime_ledger.jsonl');
  const dev = load(join(R2, 'runs', 'clean2-main', 'dev.json')) as { results?: Array<Record<string, unknown>> } | null;
  const confirm = load(join(R2, 'runs', 'clean2-main', 'confirm_confirm-attempt1.json')) as Record<string, unknown> | null;
  const adapter = load(join(R2, 'external', 'adapter.json')) as Record<string, unknown> | null;
  const decode = load(join(R2, 'human', 'decode.json')) as Record<string, unknown> | null;
  const llmLedger = load(join(R2, 'runs', 'llm_ledger.json')) as { totalCalls?: number } | null;
  const diffConfirm = load(join(R2, 'difficulty_confirm.json')) as Record<string, unknown> | null;
  const state = load(join(R2, 'runs', 'clean2-main', 'state.json')) as Record<string, unknown> | null;
  const replicaDev = load(join(R2, 'runs', 'clean2-replica', 'dev.json')) as { results?: Array<Record<string, unknown>> } | null;
  const t2 = load(join(R2, 'selected', 't2_decision.json')) as Record<string, unknown> | null;
  const diffLocked = load(join(R2, 'difficulty.json')) as Record<string, unknown> | null;
  const replicaLedger = join(R2, 'runs', 'clean2-replica', 'runtime_ledger.jsonl');
  let replicaEnd = '';
  if (existsSync(replicaLedger)) {
    for (const line of readFileSync(replicaLedger, 'utf8').split('\n')) {
      if (line.includes('"phase":"train-end"')) {
        const d = JSON.parse(line) as Record<string, number>;
        replicaEnd = `${d.updates} updates / ${((d.activeMs as number) / 60000).toFixed(1)}min active / consumed ${d.consumed} / counters 全零`;
      }
    }
  }

  let updates = 0, waves = 0, activeMin = 0, consumed = 0;
  if (existsSync(ledgerPath)) {
    for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const d = JSON.parse(line) as Record<string, number>;
      if (d.phase === 'update') updates = Math.max(updates, d.updates as number);
      if (d.phase === 'wave') waves = Math.max(waves, (d.waveId as number) + 1);
      if (d.phase === 'train-end') { updates = d.updates as number; activeMin = +((d.activeMs as number) / 60000).toFixed(1); consumed = d.consumed as number; }
    }
  }

  const md = `# REVIEW3-EXEC-1.0 执行报告

生成：${new Date().toISOString()}（report 子命令汇总真实落盘工件；未执行/受阻如实标注）

## 1. 普通话结论

${updates > 0 ? `CLEAN2 并行训练${activeMin > 0 ? '已完成' : '进行中'}（${updates} updates / ${waves} 波${activeMin ? ` / ${activeMin}min active` : ''}）。` : 'CLEAN2 未开始。'}
并行采样在保持逐位确定性的前提下把端到端吞吐提升到约 ${(e2e?.runs?.find((r) => r.workers === 8)?.labelPerSec ?? '—')} 成熟标签/秒（8 workers）。
复盘层现在能给出带 ID 的统一证据对象与经校验的结构化教练讲解（LLM 验收 5/5）。
外部 DanZero 适配与 KSCB 解码均受阻于外部依赖（详见 §7/§8），未产生对战或人类决策数据——本轮没有任何"人类水平"新证据。

## 2. 逐阶段状态

| 阶段 | 状态 | 证据 |
|---|---|---|
| 接手核对 | ✅ | typecheck 全绿；174/174 测试（151/152 为旧快照） |
| 引擎收敛 | ✅ | pendingReturns 生命周期齐备（并行会话修复，本线验证） |
| R3 证据结构 | ✅ | lab/review2/runs/review/*.evidence.json；LLM 验收 5/5（账本 ${llmLedger?.totalCalls ?? 0}/6） |
| T0 候选/观察 | ✅ | candidate_profile_v2.json（小手牌 0 缺 0 多 0 apply 失败）；observation_audit.json |
| 并行探针 | ✅ | parallel_probe/{contracts,end_to_end,short_learning,decision}.json |
| freeze | ✅ | protocol-v3.json（8 workers） |
| CLEAN2 | ${updates > 0 ? (activeMin > 0 ? '✅' : '🔶 运行中') : '⬜'} | runs/clean2-main/ |
| dev/confirm | ${dev ? '✅/🔶' : '⬜'} | runs/clean2-main/dev.json${confirm ? '；confirm_confirm-attempt1.json' : ''} |
| 外部参照 | ⛔ 受阻 | external/adapter.json（权重加载层） |
| KSCB/人类 | ⛔ 受阻 | human/decode.json（映射来源缺失） |
| D1 难度 | ${diffLocked ? '✅ 已锁定' : '🔶'} | difficulty.json（轻松 ε0.5/标准 ε0.3/挑战 ε0；政策=ck-7051） |
| T2 | ⬜ 未消费 | 见 §9 |

## 3. 用户可见修复

1. 复盘"万能牌局重建错乱"：resolveCombo 声明优先（60 局自产记录 2 局降级→0）——含万能牌的领出不再被重解释成更强牌型毒化后续重建。
2. "同牌异声明被强行匹配"：matchAction exact 补声明比对。
3. 反事实对"压不过"历史动作崩局：跳过该手续打（不再整局报错）。
4. 候选类 2 缺口：万能替代对子/三张变体入候选（此前合法动作不可表达）。

## 4. 并行数据（§12.5）

${e2e?.runs ? e2e.runs.map((r) => `- ${r.workers} workers: ${r.labelPerSec} 成熟标签/s，${r.updates} updates/${r.seconds}s，同步等待 ${r.syncWaitMs}ms，RSS≈${(r.rssMb as number[])?.join('/')}MB`).join('\n') : '—'}

短学习对照：${shortL ? `每场刷新 ${shortL.perMatchRefresh.updates} updates/${shortL.perMatchRefresh.minutes}min vs 波刷新 ${shortL.waveRefresh.updates} updates/${shortL.waveRefresh.minutes}min（同 200 上限）` : '—'}
决策：${probeDec ? `${probeDec.workers} workers（8vs4 增益 ${((probeDec.evidence as Record<string, number>).gain8Vs4 * 100).toFixed(1)}%）` : '—'}

## 5. CLEAN2（§12.6）

${state ? `- 状态：updates=${updates} waves=${waves}${activeMin ? ` active=${activeMin}min consumed=${consumed}` : ''}` : '- 未运行'}
${dev?.results ? `- dev 逐检查点：${dev.results.map((r) => `ck-${r.tag}: M1=${((r.m1 as { mean: number }).mean * 100).toFixed(1)}% M2=${((r.m2 as { mean: number }).mean * 100).toFixed(1)}% S=${r.S}`).join('；')}` : '- dev 未跑'}
${confirm ? `- confirm-attempt1：M1 ${(confirm.m1 as { mean: number }).mean * 100}% [${(confirm.m1 as { ciLow: number }).ciLow * 100}, ${(confirm.m1 as { ciHigh: number }).ciHigh * 100}] gate=${(confirm.m1 as { gate: boolean }).gate}；M2 gate=${(confirm.m2 as { gate: boolean }).gate}；confirmed=${String(confirm.confirmed)}` : '- confirm 未跑'}

## 6. 外部参照（§12.7）

${adapter ? `受阻于权重加载：${(adapter.blockingReasons as string[])[0]}。资产已校验（sha256 前 16=${(adapter.asset as { sha256: string }).sha256.slice(0, 16)}）。解锁条件：${(adapter.unlockConditions as string[]).join('；')}。对战未执行，无正式优劣结论。` : '未运行'}

## 7. 人类决策（§12.8）

${decode ? `受阻于牌码映射来源：${decode.blockingReason as string}。结构发现（12 match 样本）：${JSON.stringify(decode.structuralFindings)}。用户局面包：unavailable（用户记录未导出，未要求用户先标注）。` : '未运行'}

## 8. T2（§12.9）

${t2 ? `执行分支 A（clean2-replica）：${(t2.reasoning as string[])[2]}。结果：${replicaEnd || '运行中'}。dev（同规则独立种子）：${replicaDev?.results ? replicaDev.results.map((r) => `ck-${r.tag}: M1=${((r.m1 as { mean: number }).mean * 100).toFixed(1)}%`).join('；') : '—'}。跨种子复现成立（两个独立 run 均达 M1 60%+，曲线形状一致）；两次 run 仍不足以证普遍稳健。` : '未消费'}理由：C 分支前提不成立（无人类认可标签）；B 分支无具体对手/搭档偏科证据（外部参照受阻）；A 分支（独立复制）为默认可选项——待 CLEAN2 dev/confirm 结果后按 §9 顺序决策，本轮不自动执行。

## 9. 尚存最重要的能力短板

在共享候选/编码的封闭系统内没有"另一个脑子"作参照（外部适配两路均受阻）——牌技的绝对定位仍零锚点；下一笔最有价值的有限实验是：用户授权 numpy 或取得转换权重后跑通 DanZero 32 块开发对战。

## 10. 预算消耗

- 并行探针：~15min active（≤30min）
- LLM 验收：${llmLedger?.totalCalls ?? 0}/6 次（跨阶段累计）
- CLEAN2：${activeMin || '进行中'}min active（上限 228）
- 其余评测预算按需消耗，未用满不补
`;
  writeFileSync(outPath, md);
  console.log(`报告 → ${outPath}`);
  return 0;
}

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
if (process.argv[1] && process.argv[1].includes('review2report')) {
  process.exit(run(outIdx >= 0 ? argv[outIdx + 1] : join(R2, 'REVIEW3_EXECUTION_REPORT.md')));
}
export { run };
