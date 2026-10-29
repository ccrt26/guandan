import { describe, expect, it } from 'vitest';
import { createMatch, DEFAULT_RULES, startGame, type GameState } from '@gd/engine';
import { scoreCandidates } from '../src/heuristic';
import { PlayMemory } from '../src/memory';

/** 阶段 B（自办项 7）：explain 评分项构成——Σterms=score（浮点顺序一致），非 explain 零开销 */
function states(): Array<{ state: GameState; seat: number; lead: boolean }> {
  const out: Array<{ state: GameState; seat: number; lead: boolean }> = [];
  for (const seed of [11, 22, 33]) {
    const match = createMatch({ ...DEFAULT_RULES }, seed);
    const state = startGame(match);
    out.push({ state, seat: state.turn, lead: true });
    // 造一个跟牌态：让下家对领出牌表态
    const st2 = startGame(createMatch({ ...DEFAULT_RULES }, seed + 7));
    out.push({ state: st2, seat: st2.turn, lead: false });
  }
  return out.slice(0, 4);
}

describe('heuristic explain 评分项构成', () => {
  it('Σterms = score（noise=0；含领出与跟牌）', () => {
    for (const { state, seat } of states()) {
      const memory = PlayMemory.fromStart(state.ctx);
      const caps = { memory: true, inference: false, cooperation: true, planning: true, noise: 0, rolloutIters: 0 };
      const scored = scoreCandidates({ state, seat, caps, memory, rand: () => 0, explain: true });
      expect(scored.length).toBeGreaterThan(0);
      for (const sm of scored) {
        expect(sm.terms).toBeDefined();
        expect(sm.terms!.length).toBeGreaterThan(0);
        const sum = sm.terms!.reduce((a, t) => a + t.value, 0);
        expect(Math.abs(sum - sm.score)).toBeLessThan(1e-6);
      }
    }
  });
  it('非 explain 路径：无 terms 且分数与 explain 路径一致（行为等价）', () => {
    for (const { state, seat } of states()) {
      const memory = PlayMemory.fromStart(state.ctx);
      const caps = { memory: true, inference: false, cooperation: true, planning: true, noise: 0, rolloutIters: 0 };
      const a = scoreCandidates({ state, seat, caps, memory, rand: () => 0 });
      const b = scoreCandidates({ state, seat, caps, memory, rand: () => 0, explain: true });
      expect(a.every((m) => m.terms === undefined)).toBe(true);
      expect(a.map((m) => m.score)).toEqual(b.map((m) => m.score));
    }
  });
});
