import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRecordIntegrity, DEFAULT_RULES, legalCombos, pickReturnCard, type Move } from '@gd/engine';
import { MatchController } from '../src/game/controller';
import { loadCurrentMatch, type MatchSave } from '../src/game/storage';

const controllers: MatchController[] = [];
function controller(order = [1, 2, 3, 0], seed = 4242): MatchController {
  const c = new MatchController({
    difficulty: 1, rules: DEFAULT_RULES, aiDelayMs: 10,
    resumeMatch: {
      levels: [5, 3], gameNo: 1, lastHead: order[0], rngState: seed,
      lastResult: { finishOrder: order, winnerTeam: (order[0] % 2) as 0 | 1, doubleUp: order[0] % 2 === order[1] % 2, levelsAfter: [5, 3], upgrade: 2, passedA: false },
      ruleOpts: DEFAULT_RULES, difficulty: 1, savedAt: 1,
    },
  });
  controllers.push(c);
  c.startGame();
  while (c.state!.pendingReturns.length) c.submitReturn(pickReturnCard(c.state!, c.state!.pendingReturns[0].from));
  return c;
}
function restore(save: MatchSave): MatchController {
  const c = new MatchController({ difficulty: save.difficulty, rules: save.ruleOpts, resumeMatch: save, aiDelayMs: 10 });
  controllers.push(c);
  c.startGame();
  return c;
}
const step = (c: MatchController, move: Move) => (c as unknown as { step(move: Move): void }).step(move);

beforeEach(() => {
  vi.useFakeTimers();
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
});
afterEach(() => { controllers.forEach((c) => c.destroy()); controllers.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('交换结果验证与版本确认', () => {
  it('人工门控同时阻止人类输入和 AI，确认只释放门，不执行出牌', () => {
    const human = controller();
    expect(human.state!.turn).toBe(0);
    const combo = legalCombos(human.state!)[0];
    expect(human.exchangeAckPending).toBe(true);
    expect(human.humanTurn).toBe(false);
    expect(human.humanLegal()).toEqual([]);
    human.humanPlay(combo);
    human.humanPass();
    expect(human.state!.moveNo).toBe(0);
    const viewed = human.exchangeResult()!;
    expect(typeof viewed.version).toBe('string');
    const hands = JSON.stringify(human.state!.hands);
    expect(human.acknowledgeExchange(viewed.version)).toBe(true);
    expect(human.humanTurn).toBe(true);
    expect(JSON.stringify(human.state!.hands)).toBe(hands);
    expect(human.state!.moveNo).toBe(0);
    const ai = controller([0, 1, 2, 3]);
    vi.advanceTimersByTime(30000);
    expect(ai.state!.moveNo).toBe(0);
    expect(ai.thinking).toBe(false);
    expect(ai.acknowledgeExchange(ai.exchangeResult()!.version)).toBe(true);
    expect(ai.state!.moveNo).toBe(0);
    vi.advanceTimersByTime(10);
    expect(ai.state!.moveNo).toBeGreaterThan(0);
  });

  it('拒绝无版本、旧版本与旧局确认；连点只有一次通知且不重发牌', () => {
    const c = controller();
    const viewed = c.exchangeResult()!;
    expect(c.acknowledgeExchange(undefined as never)).toBe(false);
    expect(c.acknowledgeExchange('old-result')).toBe(false);
    expect(c.exchangeAckPending).toBe(true);
    const notify = vi.fn();
    c.subscribe(notify);
    expect(c.acknowledgeExchange(viewed.version)).toBe(true);
    expect(c.acknowledgeExchange(viewed.version)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    c.startGame();
    expect(c.exchangeResult()!.version).not.toBe(viewed.version);
    expect(c.acknowledgeExchange(viewed.version)).toBe(false);
    expect(c.exchangeAckPending).toBe(true);
  });

  it('同一局结果改变后旧确认失效，无关通知不改变结果版本', () => {
    const c = controller();
    const viewed = c.exchangeResult()!;
    c.reviveIfStalled();
    expect(c.exchangeResult()!.version).toBe(viewed.version);
    c.state!.tribute!.leader = c.state!.leader = c.state!.turn = 2;
    expect(c.acknowledgeExchange(viewed.version)).toBe(false);
    const updated = c.exchangeResult()!;
    expect(updated.version).not.toBe(viewed.version);
    expect(c.exchangeAckPending).toBe(true);
    expect(c.acknowledgeExchange(updated.version)).toBe(true);
  });

  it('未确认时无关手牌发生变化也阻止确认，不能混用结果与另一份手牌', () => {
    const c = controller();
    const viewed = c.exchangeResult()!;
    const exchanged = new Set(viewed.pairs.flatMap((pair) => [pair.tribute.card.id, pair.ret.card.id]));
    const a = c.state!.hands[0].findIndex((card) => !exchanged.has(card.id));
    const b = c.state!.hands[1].findIndex((card) => !exchanged.has(card.id));
    [c.state!.hands[0][a], c.state!.hands[1][b]] = [c.state!.hands[1][b], c.state!.hands[0][a]];
    expect(c.acknowledgeExchange(viewed.version)).toBe(false);
    expect(c.exchangeError).toBeTruthy();
    expect(c.state!.moveNo).toBe(0);
  });

  it('本地确认写入失败仍停留；恢复存储后同一结果可重试且不重新交换', () => {
    const c = controller();
    const viewed = c.exchangeResult()!;
    const hands = JSON.stringify(c.state!.hands);
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(c.acknowledgeExchange(viewed.version)).toBe(false);
    expect(c.exchangeAckPending).toBe(true);
    expect(c.exchangeError).toContain('本地存储');
    expect(c.humanTurn).toBe(false);
    expect(loadCurrentMatch()!.activeGame!.acknowledgedVersion).toBeNull();
    write.mockRestore();
    expect(c.acknowledgeExchange(viewed.version)).toBe(true);
    expect(c.exchangeError).toBeNull();
    expect(JSON.stringify(c.state!.hands)).toBe(hands);
    expect(loadCurrentMatch()!.activeGame!.acknowledgedVersion).toBe(viewed.version);
  });

  it.each(['missing-return', 'duplicate-return', 'wrong-direction', 'duplicate-entity', 'wrong-hand', 'wrong-face'])(
    '异常 %s 不伪造完成，不允许确认或出牌', (kind) => {
      const c = controller();
      const version = c.exchangeResult()!.version;
      const t = c.state!.tribute!;
      if (kind === 'missing-return') t.returns = [];
      if (kind === 'duplicate-return') t.returns.push(t.returns[0]);
      if (kind === 'wrong-direction') t.returns[0].to = t.returns[0].from;
      if (kind === 'duplicate-entity') t.returns[0].card = t.tributes[0].card;
      if (kind === 'wrong-hand') {
        const ret = t.returns[0];
        const hand = c.state!.hands[ret.to];
        const other = c.state!.hands[ret.from];
        const index = hand.findIndex((card) => card.id === ret.card.id);
        [hand[index], other[0]] = [other[0], hand[index]];
      }
      if (kind === 'wrong-face') t.returns[0].card = { ...t.returns[0].card, rank: 100 };
      expect(c.exchangeResult()).toBeNull();
      expect(c.exchangeError).toBeTruthy();
      expect(c.acknowledgeExchange(version)).toBe(false);
      expect(c.exchangeAckPending).toBe(true);
      expect(c.humanTurn).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(c.state!.moveNo).toBe(0);
    },
  );

  it.each([[[1, 2, 3, 0]], [[0, 2, 1, 3]]])('真实单/双贡完整匹配且历史只读（顺序 %j）', (order) => {
    const c = controller(order as number[]);
    const result = c.exchangeResult()!;
    expect(result).not.toBeNull();
    expect(result.pairs).toHaveLength(order[0] % 2 === order[1] % 2 ? 2 : 1);
    for (const pair of result.pairs) {
      expect(pair.ret.from).toBe(pair.tribute.to);
      expect(pair.ret.to).toBe(pair.tribute.from);
      expect(c.state!.hands[pair.ret.to].some((card) => card.id === pair.ret.card.id)).toBe(true);
    }
    c.acknowledgeExchange(result.version);
    const before = c.getSnapshot();
    const history = c.exchangeHistory;
    expect(history.at(-1)?.version).toBe(result.version);
    expect(history.at(-1)?.confirmedAt).not.toBeNull();
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history[0].pairs[0].ret.card)).toBe(true);
    expect(c.getSnapshot()).toBe(before);
    expect(c.exchangeAckPending).toBe(false);
  });

  it('首局及真实抗贡不设确认门、不捏造交换牌；新局清掉旧门', () => {
    const c = controller();
    c.match.lastResult = null;
    c.startGame();
    expect(c.exchangeAckPending).toBe(false);
    expect(c.exchangeResult()).toBeNull();
    let resist: MatchController | undefined;
    for (let seed = 1; seed <= 100; seed++) {
      const candidate = controller([0, 2, 1, 3], seed);
      if (candidate.state!.tribute!.resist) { resist = candidate; break; }
    }
    expect(resist).toBeDefined();
    expect(resist!.exchangeResult()).toBeNull();
    expect(resist!.exchangeAckPending).toBe(false);
  });
});

describe('本地贡还确认刷新恢复', () => {
  it.each(['not-array', 'empty-entry', 'null-entry', 'bad-card', 'bad-version', 'bad-confirmed-at', 'bad-direction', 'future-round'])(
    '损坏历史 %s 不使构造器崩溃，也不影响有效活动牌局的确认状态', (kind) => {
      const c = controller();
      const result = c.exchangeResult()!;
      c.acknowledgeExchange(result.version);
      const save = loadCurrentMatch()!;
      const entry = JSON.parse(JSON.stringify(save.exchangeHistory![0]));
      let history: unknown = [entry];
      if (kind === 'not-array') history = {};
      if (kind === 'empty-entry') history = [{}];
      if (kind === 'null-entry') history = [null];
      if (kind === 'bad-card') entry.pairs[0].ret.card.rank = 99;
      if (kind === 'bad-version') entry.version = 'untrusted-result-version';
      if (kind === 'bad-confirmed-at') entry.confirmedAt = 'not-a-timestamp';
      if (kind === 'bad-direction') entry.pairs[0].ret.to = entry.pairs[0].ret.from;
      if (kind === 'future-round') entry.gameNo = save.gameNo + 1;
      save.exchangeHistory = history as never;
      localStorage.setItem('gd_match_current', JSON.stringify(save));
      c.destroy();
      let resumed: MatchController | undefined;
      expect(() => { resumed = restore(loadCurrentMatch()!); }).not.toThrow();
      expect(resumed!.exchangeError).toBeNull();
      expect(resumed!.exchangeAckPending).toBe(false);
      expect(resumed!.state!.hands).toEqual(c.state!.hands);
      expect(resumed!.state!.moveNo).toBe(0);
      // 丢弃坏的历史元数据；当前结果只能从已验证的引擎快照重新产生。
      expect(resumed!.exchangeHistory).toHaveLength(1);
      expect(resumed!.exchangeHistory[0].version).toBe(result.version);
      expect(resumed!.exchangeHistory[0].pairs).toEqual(result.pairs);
      expect(resumed!.exchangeHistory[0].confirmedAt).toBeNull();
    },
  );

  it('混合历史保留合法确认时间并去重，坏条目不能覆盖合法条目', () => {
    const c = controller();
    c.acknowledgeExchange(c.exchangeResult()!.version);
    const save = loadCurrentMatch()!;
    const valid = save.exchangeHistory![0];
    save.exchangeHistory = [{}, valid, { ...valid, confirmedAt: -1 }, valid] as never;
    localStorage.setItem('gd_match_current', JSON.stringify(save));
    c.destroy();
    const resumed = restore(loadCurrentMatch()!);
    expect(resumed.exchangeHistory).toEqual([valid]);
    expect(Object.isFrozen(resumed.exchangeHistory[0].pairs[0].ret.card)).toBe(true);
    expect(resumed.exchangeAckPending).toBe(false);
  });

  it('待确认刷新恢复相同版本、实体牌和局号，不重发牌或重交换', () => {
    const c = controller();
    const viewed = c.exchangeResult()!;
    const hands = JSON.stringify(c.state!.hands);
    const save = loadCurrentMatch()!;
    c.destroy();
    const resumed = restore(save);
    expect(resumed.match.gameNo).toBe(c.match.gameNo);
    expect(JSON.stringify(resumed.state!.hands)).toBe(hands);
    expect(resumed.state!.ctx.ranks).toBeInstanceOf(Set);
    expect(resumed.exchangeResult()!.version).toBe(viewed.version);
    expect(resumed.exchangeAckPending).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(resumed.state!.moveNo).toBe(0);
  });

  it('已确认刷新不重开门，后续出牌、记牌和记录从已保存动作恢复一次', () => {
    let c = controller();
    const viewed = c.exchangeResult()!;
    c.acknowledgeExchange(viewed.version);
    const initialResume = restore(loadCurrentMatch()!);
    expect(initialResume.exchangeAckPending).toBe(false);
    expect(initialResume.state!.moveNo).toBe(0);
    c.destroy();
    c = initialResume;
    for (let i = 0; i < 5; i++) {
      const combos = legalCombos(c.state!);
      step(c, combos.length ? { pass: false, combo: combos[0] } : { pass: true });
    }
    const save = loadCurrentMatch()!;
    c.destroy();
    const resumed = restore(save);
    expect(resumed.exchangeAckPending).toBe(false);
    expect(resumed.state!.moveNo).toBe(5);
    expect(resumed.state!.hands).toEqual(c.state!.hands);
    expect(resumed.state!.turn).toBe(c.state!.turn);
    expect(resumed.tableCombos).toEqual(c.tableCombos);
    expect(resumed.humanMemory.seenIds).toEqual(c.humanMemory.seenIds);
    expect(resumed.exchangeHistory.at(-1)?.confirmedAt).toBe(c.exchangeHistory.at(-1)?.confirmedAt);
    expect((resumed as unknown as { recorder: { moveCount: number } }).recorder.moveCount).toBe(5);
    expect(JSON.parse(localStorage.getItem('gd_stats') ?? 'null')).toBeNull();
    for (let guard = 0; !resumed.state!.over && guard < 500; guard++) {
      const combos = legalCombos(resumed.state!);
      step(resumed, combos.length ? { pass: false, combo: combos[0] } : { pass: true });
    }
    expect(resumed.state!.over).toBe(true);
    expect(resumed.record!.id).toBe(save.activeGame!.recorderMeta.id);
    expect(checkRecordIntegrity(resumed.record!)).toEqual([]);
    expect(resumed.record!.tributes).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem('gd_stats')!).games).toBe(1);
    expect(JSON.parse(localStorage.getItem('gd_records_index')!)).toHaveLength(1);
    expect(loadCurrentMatch()!.activeGame).toBeUndefined();
  });

  it.each(['bad-hands', 'bad-record', 'pending-move', 'bad-ack'])('损坏的 %s 存档冻结，不重发牌或绕过确认', (kind) => {
    const c = controller();
    const save = loadCurrentMatch()!;
    if (kind === 'bad-hands') save.activeGame!.initial.hands[0][0] = save.activeGame!.initial.hands[1][0];
    if (kind === 'bad-record') save.activeGame!.recorderMeta.initialHands = [];
    if (kind === 'pending-move') save.activeGame!.moves.push({ pass: false, combo: legalCombos(c.state!)[0] });
    if (kind === 'bad-ack') save.activeGame!.acknowledgedVersion = 'another-result';
    c.destroy();
    const resumed = restore(save);
    expect(resumed.exchangeAckPending).toBe(true);
    expect(resumed.humanTurn).toBe(false);
    expect(resumed.match.gameNo).toBe(c.match.gameNo);
    if (kind !== 'bad-ack') expect(resumed.exchangeError).toBeTruthy();
    vi.advanceTimersByTime(1000);
    expect(resumed.state?.moveNo ?? 0).toBe(0);
  });

  it('另一个本地页面恢复后，旧页面的迟到确认和旧存档都不能覆盖新状态', () => {
    const c = controller();
    const version = c.exchangeResult()!.version;
    const oldSave = loadCurrentMatch()!;
    const newer = restore(oldSave);
    expect(c.acknowledgeExchange(version)).toBe(false);
    expect(c.exchangeError).toContain('其他页面');
    expect(newer.acknowledgeExchange(version)).toBe(true);
    const latest = localStorage.getItem('gd_match_current');
    const stale = restore(oldSave);
    expect(stale.exchangeError).toContain('其他页面');
    expect(stale.humanTurn).toBe(false);
    expect(localStorage.getItem('gd_match_current')).toBe(latest);
    step(c, { pass: false, combo: legalCombos(c.state!)[0] });
    expect(c.state!.moveNo).toBe(0);
    expect(localStorage.getItem('gd_match_current')).toBe(latest);
  });
});
