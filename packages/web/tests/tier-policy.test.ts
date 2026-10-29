import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function makeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    clear: () => map.clear(),
  } as Storage;
}

import { MatchController } from '../src/game/controller';
import { DEFAULT_RULES } from '@gd/engine';
import { loadCurrentMatch, saveCurrentMatch, type MatchSave } from '../src/game/storage';
import { NEURAL_MODEL_VERSION, NEURAL_TIERS } from '@gd/ai';

/** 阶段 A（自办项 2/3）：D1 三档席位语义 + 继续比赛按存档口径恢复 */
const weights = (): ArrayBuffer => new Float32Array(164865).buffer;

describe('难度三档（D1）席位语义', () => {
  beforeEach(() => { (globalThis as Record<string, unknown>).localStorage = makeLocalStorage(); });
  afterEach(() => { delete (globalThis as Record<string, unknown>).localStorage; });
  it('easy 档：对手席带 tier 标记、队友席固定满血贪心', () => {
    const c = new MatchController({ difficulty: 1, rules: { ...DEFAULT_RULES }, autopilot: true, neuralOpponents: weights(), neuralTier: 'easy' });
    c.startGame();
    expect(c.currentPolicies).toEqual([
      'autopilot:L1',
      `neural-tier:easy:${NEURAL_MODEL_VERSION}`,
      `neural:${NEURAL_MODEL_VERSION}`,
      `neural-tier:easy:${NEURAL_MODEL_VERSION}`,
    ]);
  });

  it('standard 档：档位常量为 D1 锁定值', () => {
    expect(NEURAL_TIERS).toEqual({ easy: 0.5, standard: 0.3, hard: 0 });
    const c = new MatchController({ difficulty: 1, rules: { ...DEFAULT_RULES }, autopilot: true, neuralOpponents: weights(), neuralTier: 'standard' });
    c.startGame();
    expect(c.currentPolicies[1]).toBe(`neural-tier:standard:${NEURAL_MODEL_VERSION}`);
    expect(c.currentPolicies[2]).toBe(`neural:${NEURAL_MODEL_VERSION}`);
  });

  it('存档记录 aiPolicy=neural-tier（继续比赛据此恢复）', () => {
    const c = new MatchController({ difficulty: 1, rules: { ...DEFAULT_RULES }, autopilot: true, neuralOpponents: weights(), neuralTier: 'easy' });
    c.startGame();
    const sp = c.matchSavePoint();
    expect(sp.aiPolicy).toBe('neural-tier:easy');
  });

  it('旧档（无 aiPolicy 字段）形状校验仍通过（按旧难度启发式恢复）', () => {
    const legacy = {
      levels: [2, 2] as [number, number], gameNo: 1, lastResult: null, lastHead: null,
      rngState: 42, ruleOpts: { ...DEFAULT_RULES }, difficulty: 1, savedAt: Date.now(),
    } as MatchSave;
    saveCurrentMatch(legacy);
    const loaded = loadCurrentMatch();
    expect(loaded).not.toBeNull();
    expect(loaded!.aiPolicy).toBeUndefined();
  });
});
