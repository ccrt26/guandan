import { describe, expect, it } from 'vitest';
import { createMatch, DEFAULT_RULES, startGame } from '../src/index';

describe('双贡实体牌转移', () => {
  it('末游贡牌较大时，两位贡方仍各移动自己手中的实体牌，108 张保持唯一', () => {
    let covered = false;
    for (let seed = 1; seed <= 20; seed++) {
      const match = createMatch(DEFAULT_RULES, seed);
      match.lastHead = 0;
      match.lastResult = {
        finishOrder: [0, 2, 1, 3], winnerTeam: 0, doubleUp: true,
        levelsAfter: [5, 2], upgrade: 3, passedA: false,
      };
      const state = startGame(match);
      if (state.tribute!.resist || state.tribute!.leader !== 3) continue;
      covered = true;
      expect(state.hands.map((h) => h.length)).toEqual([27, 27, 27, 27]);
      expect(new Set(state.hands.flat().map((c) => c.id)).size).toBe(108);
      for (const t of state.tribute!.tributes) {
        expect(state.hands[t.to].some((c) => c.id === t.card.id)).toBe(true);
        expect(state.hands[t.from].some((c) => c.id === t.card.id)).toBe(false);
      }
    }
    expect(covered).toBe(true);
  });
});
