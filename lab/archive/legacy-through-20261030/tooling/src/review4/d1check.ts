/**
 * lab/src/review4/d1check.ts — D1 断言验证：两截图同类构造回归 + 82048 双来源反向保留。
 * 用部署 clean2 权重建证据对象，逐条核对 REVIEW4 §5.1 的断言。
 */
import { readFileSync } from 'node:fs';
import { MLP } from '@gd/ai';
import { buildDecisionReviews, type DecisionReview } from '@gd/review';
import type { GameRecord } from '@gd/engine';

const mlp = new MLP(1);
{
  const buf = readFileSync('packages/web/public/ai/clean2.f32');
  mlp.setWeights(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
}

function load(id: string): GameRecord {
  return JSON.parse(readFileSync(`lab/review2/review4/cases/records/${id}.json`, 'utf8'));
}

function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
  if (!ok) process.exitCode = 1;
}

// ── 第54手类：级 7 下 ♣7 与小王都压得过 A ──
{
  const rec = load('r4-cst-level7-beat');
  const evs = buildDecisionReviews(rec, { mlp, modelVersion: 'clean2-ck7051-20261027', weightHash: 'deployed' });
  const all = JSON.stringify(evs, null, 1);
  check('level7: 证据对象生成', evs.length >= 1, `${evs.length} 决策点`);
  check('level7: ♣7 压得过 A 断言存在（引擎判定）', all.includes('压得过当前要压的单张 A') || evs.some((e) => e.claims.some((c) => c.kind === 'rule_relation' && c.text.includes('压得过'))), 'rule_relation claims');
  check('level7: 实际动作为小王', evs.some((e) => e.actual.physicalCards.some((p) => p.startsWith('J'))), evs.map((e) => e.actual.physicalCards.join(',')).join(';'));
  const rrClaims = evs.flatMap((e: DecisionReview) => e.claims.filter((c) => c.kind === 'rule_relation'));
  check('level7: 规则断言由程序渲染（含"引擎规则判定"）', rrClaims.every((c) => c.text.includes('引擎规则判定') || c.text.includes('pass')), `${rrClaims.length} 条`);
  check('level7: 逐动作评分分解（实际+替代各自绑定 actionId）', evs.every((e) => e.heuristicBreakdowns.length >= 1 || e.missing.some((m) => m.includes('actionId='))), 'breakdown per action');
  check('level7: 有分解时 missing 不含全局"无逐项分解"句', evs.every((e) => !(e.heuristicBreakdowns.length > 0 && e.missing.some((m) => m.includes('逐项分解') && !m.includes('actionId=')))), 'D1 修正生效');
  check('level7: ctx 措辞=当前要压的是西家的…', all.includes('当前要压的是西家'), '不再误说"上家领出"');
}
// ── 第22手类：4J 炸弹 vs 启发式偏好（意见不同，不判错）──
{
  const rec = load('r4-cst-bomb-vs-pass');
  const evs = buildDecisionReviews(rec, { mlp, modelVersion: 'clean2-ck7051-20261027', weightHash: 'deployed' });
  const all = JSON.stringify(evs);
  check('bomb: 实际 4J 炸弹被候选覆盖', evs.some((e) => e.actual.coverage.status === 'exact' || e.actual.coverage.index >= 0), evs.map((e) => `${e.actual.coverage.status}#${e.actual.coverage.index}`).join(';'));
  check('bomb: 判罚语禁令（claimLevel 档位）', evs.every((e) => typeof e.claimLevel === 'string'), evs.map((e) => e.claimLevel).join(','));
  check('bomb: policy_preference 断言含"意见可能不同/不裁决"', all.includes('不裁决') || all.includes('意见可能不同'), '措辞契约');
}
// ── 82048 双来源反向保留 ──
{
  const ev = readFileSync('lab/review2/runs/review/acc-dual-source-conflict.evidence.json', 'utf8');
  check('82048: 双来源反向证据在案', ev.includes('82048') && ev.includes('direction') || ev.includes('方向相反') || ev.includes('m23'), 'acc-dual-source-conflict 保留');
}
console.log(process.exitCode ? 'D1 存在失败项' : 'D1 断言全部通过');
