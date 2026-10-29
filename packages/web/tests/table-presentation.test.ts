import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULES, legalCombos, type Move } from '@gd/engine';
import { MatchController } from '../src/game/controller';

const controllers: MatchController[] = [];
afterEach(() => { controllers.forEach((c) => c.destroy()); controllers.length = 0; vi.useRealTimers(); });

describe('完成轮次的桌面展示', () => {
  it.each([0, 1, 2, 3])('席位 %i 的最后一次不出在订阅通知中保留，新轮首出才清空', (lastPasser) => {
    vi.useFakeTimers();
    const c = new MatchController({ difficulty: 1, rules: DEFAULT_RULES });
    controllers.push(c);
    c.startGame();
    const state = c.state!;
    const leader = (lastPasser + 1) % 4;
    state.turn = state.leader = state.lastPlayer = leader;
    const step = (move: Move) => (c as unknown as { step(move: Move): void }).step(move);
    const first = legalCombos(state).find((combo) => combo.size === 1)!;
    step({ pass: false, combo: first });
    step({ pass: true });
    step({ pass: true });
    const seen: unknown[][] = [];
    c.subscribe(() => seen.push([...c.tableCombos]));
    step({ pass: true });
    expect(state.lastCombo).toBeNull();
    expect(state.turn).toBe(leader);
    expect(seen.at(-1)?.[lastPasser]).toBe('pass');
    expect(c.currentTrick).toHaveLength(4);
    const next = legalCombos(state).find((combo) => combo.size === 1)!;
    step({ pass: false, combo: next });
    expect(c.tableCombos).toEqual([0, 1, 2, 3].map((seat) => seat === leader ? next : null));
    expect(c.currentTrick).toEqual([{ player: leader, item: next }]);
    c.startGame();
    expect(c.tableCombos).toEqual([null, null, null, null]);
    expect(c.currentTrick).toEqual([]);
  });
});
