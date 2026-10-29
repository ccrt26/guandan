import { BIG_JOKER, SMALL_JOKER, type Rank } from './types';

export type LevelMode = 'stage' | 'both' | 'high';

/**
 * 本局级牌上下文。stage（官方）模式下全场唯一级牌 = 台上一方（上副上游方）所打级数。
 */
export interface LevelCtx {
  /** 级牌 rank 集合（原始值）；stage 恒为单元素 */
  ranks: Set<Rank>;
  /** 双方级数（team0, team1），各自记进度用；不上台一方的级数不是级牌 */
  levels: [number, number];
}

export function makeLevelCtx(levels: [number, number], mode: 'stage', stageTeam: 0 | 1): LevelCtx;
export function makeLevelCtx(levels: [number, number], mode: 'both' | 'high'): LevelCtx;
export function makeLevelCtx(levels: [number, number], mode: LevelMode, stageTeam: 0 | 1 = 0): LevelCtx {
  if (mode === 'stage') {
    return { ranks: new Set([levels[stageTeam]]), levels: [levels[0], levels[1]] };
  }
  if (mode === 'both') {
    return { ranks: new Set(levels), levels: [levels[0], levels[1]] };
  }
  const hi = Math.max(levels[0], levels[1]);
  return { ranks: new Set([hi]), levels: [levels[0], levels[1]] };
}

export function isJoker(rank: Rank): boolean {
  return rank === SMALL_JOKER || rank === BIG_JOKER;
}

/**
 * 牌点比较权重（分段刻度，保证 普通牌 < 级牌 < 小王 < 大王）：
 * 2..14 → 2..14；级牌 → 20+级数（级高者大）；小王 40；大王 41。
 */
export function rankOrder(rank: Rank, ctx: LevelCtx): number {
  if (rank === SMALL_JOKER) return 40;
  if (rank === BIG_JOKER) return 41;
  if (ctx.ranks.has(rank)) return 20 + rank;
  return rank;
}

/** 级牌有效 rank（用于 UI 标记、逢人配判断等） */
export function isLevelRank(rank: Rank, ctx: LevelCtx): boolean {
  return !isJoker(rank) && ctx.ranks.has(rank);
}

/**
 * 序列位置模型（官方规则：A 在顺子/三连对/二连三/同花顺中既可作 1 也可作 K+1）。
 * 位置 1 = A 作 1；位置 2..14 = 2..K、A(14)。
 * 级牌对应位置剔除（级牌是主牌不入这些牌型）；A 非级牌时位置 1 与 14 同时可用。
 * 连续段在位置域上计算；段最大位置即牌型比较权重（A2345=5 < 23456=6 < ... < 10JQKA=14）。
 */
export interface SeqSlot {
  pos: number;
  rank: Rank;
}

export function seqSlots(ctx: LevelCtx): SeqSlot[] {
  const out: SeqSlot[] = [];
  for (let pos = 1; pos <= 14; pos++) {
    const rank: Rank = pos === 1 ? 14 : pos;
    if (ctx.ranks.has(rank)) continue;
    out.push({ pos, rank });
  }
  return out;
}

/** 把 seqSlots 展开成最大连续段（位置域） */
export function contiguousRuns(values: number[]): Array<{ from: number; len: number }> {
  const runs: Array<{ from: number; len: number }> = [];
  let i = 0;
  while (i < values.length) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    runs.push({ from: values[i], len: j - i + 1 });
    i = j + 1;
  }
  return runs;
}
