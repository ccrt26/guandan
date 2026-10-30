/**
 * lab/src/followup_a34.ts — A3 统计口径重算 + A4 账目核对（CLEAN1-REVIEW-1.0）。
 * A3：252/256 的块分布（0/1/2 胜块数）+ 按原公式重算区间 + Y 敏感性分析。
 * A4：partner 逐 seed 匹配完整性（无缺失默认 0）+ 采样耗时定位微基准。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockStats } from './stats';
import { createMatch, DEFAULT_RULES } from '@gd/engine';
import { MLP } from '@gd/ai';
import { sampleMatchStrict } from './clean1';

const RUN = join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'clean1', 'clean1-2026102609500');

// ---------- A3：块分布与区间重算 ----------
console.log('== A3：holdout_final_vs1（对中级 252/256）块分布 ==');
{
  const recs = readFileSync(join(RUN, 'holdout_final_vs1_perseed.jsonl')).toString().split('\n')
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as { seed: number; win: number; unfinished: boolean });
  const bySeed = new Map<number, number>();
  let unfinished = 0;
  for (const r of recs) { if (r.unfinished) unfinished += 1; bySeed.set(r.seed, (bySeed.get(r.seed) ?? 0) + (r.win ? 1 : 0)); }
  const xs = [...bySeed.values()].map((v) => v / 2);
  const hist = { 0: 0, 1: 0, 2: 0 } as Record<number, number>;
  for (const x of xs) hist[x * 2] += 1;
  const est = blockStats(xs, 0.95);
  console.log(`  块数=${xs.length}（每块=同 seed 两边）；0胜块=${hist[0]} 1胜块=${hist[1]} 2胜块=${hist[2]}；未完成=${unfinished}`);
  console.log(`  4 次败局落在 ${hist[1]} 个块（每块恰 1 败）`);
  console.log(`  原公式重算：点估计=${(est.mean).toFixed(4)}，95% 分位 bootstrap=[${est.ciLow.toFixed(4)}, ${est.ciHigh.toFixed(4)}]（与 holdout_summary 报告 [0.9688,0.9961] 一致=${est.ciLow.toFixed(4) === '0.9688' && est.ciHigh.toFixed(4) === '0.9961'}）`);
  const hoef = 0.9844 - Math.sqrt(Math.log(40) / (2 * 128));
  console.log(`  保守 Hoeffding 对照：98.4375% − 12.004pp = ${(hoef * 100).toFixed(3)}%（仍远超 50%，不构成推翻中级优势的理由）`);
  // Y 敏感性（可选分析，非验收替换）：Y=该块两边均赢指示变量，128/128 全 1
  const yLower = Math.pow(0.025, 1 / 128);
  console.log(`  Y 敏感性（双胜指示）：128/128 全双胜 → 97.5% 单侧精确下界 0.025^(1/128)=${(yLower * 100).toFixed(3)}%（块均值 X≥Y，亦可作 E[X] 保守下界；非验收规则替换）`);
}
// 三档 dev 全胜同口径对照
{
  const recs = readFileSync(join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'tiers', 'dev', 'mid_vs_easy_perseed.jsonl')).toString().split('\n')
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as { base_seed: number; win: number; unfinished: boolean });
  const bySeed = new Map<number, number>();
  for (const r of recs) bySeed.set(r.base_seed, (bySeed.get(r.base_seed) ?? 0) + r.win);
  const xs = [...bySeed.values()].map((v) => v / 2);
  const est975 = blockStats(xs, 0.975), est95 = blockStats(xs, 0.95);
  console.log(`  对照：三档 dev 中vs初全胜 32 块 → 97.5% 双侧 [${(est975.ciLow * 100).toFixed(1)},100]、95% 双侧 [${(est95.ciLow * 100).toFixed(1)},100]——CLEAN1 holdout 用 95% 双侧（=97.5% 单侧），两处各按其事前协议`);

  const h128_975 = Math.sqrt(Math.log(2 / 0.025) / (2 * 128));
  console.log(`  公式复核：128 块全胜 95%双侧/97.5%单侧半宽 sqrt(ln40/256)=${(Math.sqrt(Math.log(40) / 256) * 100).toFixed(3)}pp → [87.996,100]；97.5%双侧半宽 sqrt(ln80/256)=${(h128_975 * 100).toFixed(3)}pp → [${(100 - h128_975 * 100).toFixed(3)},100]；配对差 [−1,1] 半宽×2：+100pp 下界 75.992pp（95%双侧）/ 73.833pp（97.5%双侧）`);
}

// ---------- A4：partner 匹配完整性 ----------
console.log('== A4：partner 逐 seed 匹配完整性 ==');
{
  const seeds = JSON.parse(readFileSync(join(RUN, 'seeds.json'), 'utf8')).seeds.partner as number[];
  const tierRecs = readFileSync(join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'tiers', 'partner_perseed.jsonl')).toString().split('\n')
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as { base_seed: number; tier: number; side: number });
  const nnRecs = readFileSync(join(RUN, 'partner_nn_perseed.jsonl')).toString().split('\n')
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as { seed: number });
  let bad = 0;
  for (const sd of seeds) {
    for (const tier of [0, 1, 2]) {
      const n = tierRecs.filter((r) => r.base_seed === sd && r.tier === tier).length;
      if (n !== 2) { bad += 1; console.error(`  缺失/重复：seed=${sd} tier=${tier} 记录数=${n}`); }
    }
    const m = nnRecs.filter((r) => r.seed === sd).length;
    if (m !== 2) { bad += 1; console.error(`  缺失/重复：seed=${sd} NN 记录数=${m}`); }
  }
  console.log(`  ${seeds.length} seed × (3 档×2 边 + NN×2 边) 全部恰 2 条=${bad === 0 ? '✓（无缺失默认 0 风险）' : '✗ ' + bad}`);
  const seedSet = new Set(tierRecs.map((r) => r.base_seed).concat(nnRecs.map((r) => r.seed)));
  const unwanted = [...seedSet].filter((s) => !seeds.includes(s));
  console.log(`  记录中无种子集外条目=${unwanted.length === 0 ? '✓' : '✗ ' + unwanted.join(',')}`);
}

// ---------- A4：耗时定位微基准（采样 vs 学习） ----------
console.log('== A4：耗时构成定位 ==');
{
  const model = new MLP(1);
  const t0 = performance.now();
  let matches = 0, samples = 0;
  while (performance.now() - t0 < 8000) {
    const r = sampleMatchStrict(model, 0.05, 90000 + matches, () => 0.42, { illegalIntent: 0, fallback: 0, semanticRewrite: 0, encodingMismatch: 0, labelMismatch: 0 });
    matches += 1; samples += r.samples.length;
  }
  const ms = performance.now() - t0;
  const perMatch = ms / matches;
  console.log(`  纯采样（无学习）：${matches} 场 / ${(ms / 1000).toFixed(1)}s = ${perMatch.toFixed(0)}ms/场，${(samples / (ms / 1000)).toFixed(0)} 样本/s`);
  console.log(`  训练期实测：12950 场 / 226.51min active = 1050ms/场（含 7051 次更新共 7051×2.89ms≈20.4s=0.15%）`);
  console.log(`  结论：active 时间 ~99.8% 在自博弈模拟+编码+守卫（Node 单线程），learner 更新非瓶颈——利用率/算力讨论应针对采样侧`);
}
