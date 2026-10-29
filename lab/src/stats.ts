/**
 * lab/src/stats.ts — §7.1 种子块统计（独立模块，无副作用）。
 * 块 = 一个 seed 的两边（X_s∈[0,1]，A 队视角胜负均值）；比较版本/模型时同 seed
 * 相关结果一起抽样。普通区间 = seed 块 bootstrap 10000 次、固定统计随机种子；
 * 全胜/全败零方差时普通 bootstrap 会给出零宽区间，改用 Hoeffding 保守界并标注。
 * 97.5% 双侧区间用于两个主相邻比较（Bonferroni 校正后名义联合覆盖 95%）；
 * 其余探索诊断常规 95%。
 */
import { mulberry32 } from '@gd/ai';

export interface BlockEst {
  mean: number; ciLow: number; ciHigh: number; method: string;
}
export function blockStats(
  xs: number[], ciLevel: 0.975 | 0.95, nBoot = 10_000, seed = 20261027,
): BlockEst {
  const n = xs.length;
  if (n === 0) return { mean: NaN, ciLow: NaN, ciHigh: NaN, method: 'empty' };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const alpha = 1 - ciLevel;
  if (xs.every((x) => x === xs[0])) {
    const half = Math.min(1, Math.sqrt(Math.log(2 / alpha) / (2 * n)));
    return { mean, ciLow: Math.max(0, mean - half), ciHigh: Math.min(1, mean + half), method: 'hoeffding' };
  }
  const rnd = mulberry32(seed);
  const means: number[] = [];
  for (let i = 0; i < nBoot; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += xs[(rnd() * n) | 0];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const q = (p: number): number => means[Math.min(means.length - 1, Math.max(0, Math.ceil(p * means.length) - 1))];
  return { mean, ciLow: q(alpha / 2), ciHigh: q(1 - alpha / 2), method: 'seedblock-bootstrap' };
}

export interface PairedEst {
  diff: number; ciLow: number; ciHigh: number; method: string;
}
/** 配对差值（同 seed 块相关一起抽样）：dx_s = x_s(A) - x_s(B)，D∈[-1,1] */
export function pairedBlockStats(
  a: number[], b: number[], ciLevel: 0.975 | 0.95 = 0.95, nBoot = 10_000, seed = 20261027,
): PairedEst {
  if (a.length !== b.length) throw new Error('配对样本长度不一致');
  const dx = a.map((v, i) => v - b[i]);
  const n = dx.length;
  const diff = dx.reduce((s, x) => s + x, 0) / n;
  const alpha = 1 - ciLevel;
  if (dx.every((x) => x === dx[0])) {
    const half = Math.min(2, 2 * Math.sqrt(Math.log(2 / alpha) / (2 * n)));
    return { diff, ciLow: Math.max(-1, diff - half), ciHigh: Math.min(1, diff + half), method: 'hoeffding' };
  }
  const rnd = mulberry32(seed ^ 0x5A5A);
  const diffs: number[] = [];
  for (let i = 0; i < nBoot; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += dx[(rnd() * n) | 0];
    diffs.push(s / n);
  }
  diffs.sort((x, y) => x - y);
  const q = (p: number): number => diffs[Math.min(diffs.length - 1, Math.max(0, Math.ceil(p * diffs.length) - 1))];
  return { diff, ciLow: q(alpha / 2), ciHigh: q(1 - alpha / 2), method: 'seedblock-bootstrap' };
}
