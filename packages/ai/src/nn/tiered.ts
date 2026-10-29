/**
 * packages/ai/src/nn/tiered.ts — 产品难度三档（D1 锁定，REVIEW3 §10）。
 * 机制：ε-greedy 且仅在与 top1 raw Q 差 ≤ nearTie 的 top-K 近并列动作内均匀随机；
 * 无合格替代=top1；ε=0 纯贪心（挑战档）。ε 不作用于均匀乱打——"合法乱打≠像初学者"。
 * 档位值=lab/review2/difficulty.json 锁定值（政策 ck-7051，dev/confirm 实测可区分：
 * 轻松 5.2% / 标准 11.5% / 挑战 44.8% 对同政策贪心）。本文件为唯一权威，lab 侧引用。
 */
import type { Combo, GameState } from '@gd/engine';
import type { NeuralDecider } from './neuralSeat';

export type NeuralTier = 'easy' | 'standard' | 'hard';

/** D1 锁定的 ε 值（改动须经难度确认流程重锁） */
export const NEURAL_TIERS: Record<NeuralTier, number> = { easy: 0.5, standard: 0.3, hard: 0 };
export const NEURAL_TIER_NEAR_TIE = 0.5; // 与 top1 raw Q 差 ≤0.5 视为近并列
export const NEURAL_TIER_TOP_K = 3;

export const NEURAL_TIER_LABELS: Record<NeuralTier, string> = {
  easy: '轻松', standard: '标准', hard: '挑战',
};

/** 近并列 ε-greedy 决策（D1 口径）；返回原始动作（仍须过合法守卫） */
export function decideTiered(
  decider: NeuralDecider, state: GameState, eps: number, rand: () => number,
): { pass: boolean; combo?: Combo } {
  const d = decider.decide(state, { wantRanking: true });
  const ranking = d.ranking!;
  if (eps <= 0 || ranking.length <= 1) return d.move as { pass: boolean; combo?: Combo };
  if (rand() >= eps) return d.move as { pass: boolean; combo?: Combo };
  const top1 = ranking[0];
  const near = ranking.slice(0, NEURAL_TIER_TOP_K).filter((r) => top1.score - r.score <= NEURAL_TIER_NEAR_TIE);
  if (near.length <= 1) return d.move as { pass: boolean; combo?: Combo };
  const pick = near[Math.floor(rand() * near.length) % near.length];
  return pick.combo === null ? { pass: true } : { pass: false, combo: pick.combo };
}
