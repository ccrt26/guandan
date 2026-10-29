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

const storageMod = () => import('../src/game/storage');
const controllerMod = () => import('../src/game/controller');
const RULES = { levelMode: 'both', passA: 'head3', straightLen: 5, pairSeqMin: 3, pairSeqMax: 3, trioSeqMin: 2, trioSeqMax: 2, flushLen: 5 } as never;

describe('比赛进度存档（存档点=每局打完）', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).localStorage = makeLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('存/取/清比赛存档', async () => {
    const s = await storageMod();
    expect(s.loadCurrentMatch()).toBeNull();
    s.saveCurrentMatch({ levels: [5, 3], gameNo: 2, lastResult: null, lastHead: 0, rngState: 123, ruleOpts: RULES, difficulty: 1, savedAt: 1 });
    const loaded = s.loadCurrentMatch();
    expect(loaded?.levels).toEqual([5, 3]);
    expect(loaded?.gameNo).toBe(2);
    s.clearCurrentMatch();
    expect(s.loadCurrentMatch()).toBeNull();
  });

  it('坏档返回 null（不硬续）', async () => {
    const s = await storageMod();
    (globalThis as Record<string, unknown>).localStorage.setItem('gd_match_current', '{oops');
    expect(s.loadCurrentMatch()).toBeNull();
    (globalThis as Record<string, unknown>).localStorage.setItem('gd_match_current', JSON.stringify({ levels: 'x' }));
    expect(s.loadCurrentMatch()).toBeNull();
  });

  it('从存档恢复：级数/局数/种子进 controller，下一局正常开', async () => {
    const { MatchController } = await controllerMod();
    const s = await storageMod();
    s.saveCurrentMatch({ levels: [7, 4], gameNo: 3, lastResult: null, lastHead: 2, rngState: 777, ruleOpts: RULES, difficulty: 1, savedAt: 1 });
    const c = new MatchController({ difficulty: 1, rules: RULES, resumeMatch: s.loadCurrentMatch()! });
    expect([...c.match.levels]).toEqual([7, 4]);
    expect(c.match.gameNo).toBe(3);
    c.startGame();
    expect(c.match.gameNo).toBe(4);
    expect(c.state?.levelsBefore).toEqual([7, 4]);
    expect(c.state?.hands.every((h) => h.length === 27)).toBe(true);
  });

  it('真实对局驱动：第 1 局打完自动写存档（级数推进、gameNo=1、lastResult 驱动进贡）', async () => {
    const { MatchController } = await controllerMod();
    const s = await storageMod();
    expect(s.loadCurrentMatch()).toBeNull();
    const c = new MatchController({ difficulty: 1, rules: RULES, autopilot: true });
    c.startGame();
    // 同步驱动整局：绕过计时器，直接执行调度核心（等价 autopilot，但确定性）
    const anyC = c as unknown as {
      state: { over: boolean; turn: number; result: unknown };
      players: Map<number, { decide(st: unknown): { pass: boolean; combo?: unknown } }>;
      step(mv: { pass: boolean; combo?: unknown }): void;
    };
    let guard = 0;
    while (!anyC.state.over && guard++ < 2000) {
      const p = anyC.players.get(anyC.state.turn)!;
      anyC.step(p.decide(anyC.state));
    }
    expect(anyC.state.over).toBe(true);
    const save = s.loadCurrentMatch();
    expect(save).not.toBeNull();
    expect(save!.gameNo).toBe(1);
    // 级数至少一方推进（2→更高），且与引擎结算一致
    const advanced = save!.levels[0] > 2 || save!.levels[1] > 2;
    expect(advanced).toBe(true);
    expect(save!.lastResult).not.toBeNull();
    expect(save!.difficulty).toBe(1);
  });

  it('人类还贡交互：收贡挂起→自选提交→整局打完，记录完整且还牌落在贡方初始手牌', async () => {
    const { MatchController } = await controllerMod();
    const { checkRecordIntegrity, pickReturnCard } = await import('@gd/engine');
    const { createAI } = await import('@gd/ai');
    const s = await storageMod();
    // 上局 0 头游 1 二游 2 三游 3 末游 → 本局 3 单贡给 0，0 须自选还贡
    s.saveCurrentMatch({
      levels: [5, 3], gameNo: 1, lastHead: 0, rngState: 4242,
      lastResult: { finishOrder: [0, 1, 2, 3], winnerTeam: 0, doubleUp: false, levelsAfter: [5, 3], upgrade: 2, passedA: false },
      ruleOpts: RULES, difficulty: 1, savedAt: 1,
    });
    const c = new MatchController({ difficulty: 1, rules: RULES, resumeMatch: s.loadCurrentMatch()! });
    c.startGame();
    expect(c.state!.pendingReturns).toEqual([{ from: 0, to: 3 }]);
    expect(c.humanReturning).toBe(true);
    expect(c.humanTurn).toBe(false); // 还贡阶段不能出牌
    expect(c.returnHint()).not.toBeNull();
    // 未还贡不开记录（initialHands 口径=还贡后手牌）
    expect((c as unknown as { recorder: unknown }).recorder).toBeNull();
    const back = pickReturnCard(c.state!, 0);
    c.submitReturn(back);
    expect(c.state!.pendingReturns).toHaveLength(0);
    expect(c.state!.turn).toBe(3); // 末游先出
    expect((c as unknown as { recorder: unknown }).recorder).not.toBeNull();
    c.acknowledgeExchange(c.exchangeResult()!.version);
    // 给人类座位挂一个 AI（仅测试驱动用，等价 autopilot 通路），同步打完整局
    (c as unknown as { players: Map<number, { decide(st: unknown): unknown }> })
      .players.set(0, createAI(0, 1, 7));
    const anyC = c as unknown as {
      state: { over: boolean; turn: number };
      players: Map<number, { decide(st: unknown): { pass: boolean; combo?: unknown } }>;
      step(mv: { pass: boolean; combo?: unknown }): void;
    };
    let guard = 0;
    while (!anyC.state.over && guard++ < 2000) {
      const p = anyC.players.get(anyC.state.turn)!;
      anyC.step(p.decide(anyC.state));
    }
    expect(anyC.state.over).toBe(true);
    const rec = c.record;
    expect(rec).not.toBeNull();
    expect(checkRecordIntegrity(rec!)).toEqual([]);
    expect(rec!.initialHands[3].some((x) => x.id === back.id)).toBe(true);
  });
});
