import {
  type Card, type Combo, comboKey, enumerateCombos, type LevelCtx, rankOrder,
} from '@gd/engine';

/**
 * 手牌拆解：把整手牌近似最优地分解为一组出牌（越少手数越好）。
 * 贪心策略：每轮选出「性价比最高」的牌型（长、低、少用万能牌），移除后继续。
 */
export interface Plan {
  combos: Combo[];
  hands: number;
  /** 平均牌力（越小越先出） */
  avgRank: number;
}

export function decompose(hand: Card[], ctx: LevelCtx): Plan {
  const remaining = [...hand];
  const combos: Combo[] = [];
  const order = (r: number) => rankOrder(r, ctx);

  while (remaining.length > 0) {
    const candidates = enumerateCombos(remaining, ctx);
    let best: Combo | null = null;
    let bestScore = -Infinity;
    for (const combo of candidates) {
      const avgKey = combo.cards.reduce((s, c) => s + order(c.rank), 0) / combo.size;
      let score = combo.size * 1.0 - avgKey * 0.12;
      // 万能牌是宝贵资源，组合里少用
      score -= combo.wildAs.length * 0.9;
      // 炸弹作为一手保留（除非很长）
      if (combo.kind === 'bomb' || combo.kind === 'flush' || combo.kind === 'joker_bomb') score += 1.2;
      // 长顺子/连对优先（倾倒更多牌）
      if (combo.kind === 'straight' || combo.kind === 'pair_seq' || combo.kind === 'trio_seq') score += 0.6;
      // 单张/对子尽量压低
      if (combo.kind === 'single') score -= 0.3;
      if (combo.kind === 'pair') score -= 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = combo;
      }
    }
    if (!best) break;
    combos.push(best);
    const ids = new Set(best.cards.map((c) => c.id));
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (ids.has(remaining[i].id)) remaining.splice(i, 1);
    }
  }

  const totalCards = combos.reduce((s, c) => s + c.size, 0);
  const avgRank = combos.length
    ? combos.reduce((s, c) => s + c.keyRank * c.size, 0) / Math.max(1, totalCards)
    : 0;
  return { combos, hands: combos.length, avgRank };
}

/** 打出 combo 后的手数（规划能力开启时精确拆解，否则粗略估计） */
export function handsAfter(hand: Card[], ctx: LevelCtx, played: Combo | null, planning: boolean): number {
  const rest = played
    ? hand.filter((c) => !played.cards.some((p) => p.id === c.id))
    : [...hand];
  if (!planning) return rest.length <= 2 ? 1 : Math.ceil(rest.length / 4);
  return decompose(rest, ctx).hands;
}

/** combo 是否在当前拆解方案里（保持结构奖励） */
export function inPlan(plan: Plan, combo: Combo): boolean {
  const key = comboKey(combo);
  return plan.combos.some((c) => comboKey(c) === key);
}
