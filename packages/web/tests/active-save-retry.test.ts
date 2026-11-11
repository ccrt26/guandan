import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatch, DEFAULT_RULES, legalCombos, pickReturnCard, startGame, type Move } from '@gd/engine';
import { MatchController } from '../src/game/controller';
import { loadCurrentMatch } from '../src/game/storage';

// Cold-start wiring needs player objects, never actual policies/model decisions.
vi.mock('@gd/ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('@gd/ai')>(),
  createAI: () => ({ reset() {}, observe() {}, decide() { throw Error('unexpected AI decision'); } }),
}));
const controllers: MatchController[] = [];
const data = new Map<string, string>();
let failRead = false, failWrite = false;
let readCount = 0, failOnRead = 0;
const internals = (c: MatchController) => c as unknown as {
  beginPlay(): void; savedRevision: string | null; step(move: Move): boolean;
  executionState: 'confirmed' | 'applying' | 'execution_uncertain';
};
function makeController(): MatchController {
  const c = new MatchController({ difficulty: 1, rules: DEFAULT_RULES, aiDelayMs: 10 });
  controllers.push(c); return c;
}
function atActiveGame(): MatchController {
  const c = makeController(); c.match = createMatch(DEFAULT_RULES, 123);
  c.state = startGame(c.match); c.state.turn = c.state.leader = c.state.lastPlayer = 0;
  internals(c).beginPlay(); internals(c).savedRevision = 'fixture-revision';
  data.set('gd_match_current', JSON.stringify(c.matchSavePoint())); return c;
}
beforeEach(() => {
  vi.useFakeTimers(); data.clear(); failRead = failWrite = false; readCount = failOnRead = 0;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => { if (key === 'gd_match_current' && (++readCount === failOnRead || failRead)) throw Error('unreadable'); return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (failWrite && key === 'gd_match_current') throw Error('quota'); data.set(key, value); },
    removeItem: (key: string) => data.delete(key),
  });
});
afterEach(() => {
  controllers.forEach(c => c.destroy()); controllers.length = 0;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('ordinary active game save retry', () => {
  it('pauses after one applied move and retries only its snapshot', () => {
    const c = atActiveGame(); failWrite = true;
    const before = data.get('gd_match_current');
    c.humanPlay(legalCombos(c.state!)[0]);
    expect(c.state!.moveNo).toBe(1); expect(c.saveError).toBeTruthy();
    expect(c.thinking).toBe(false); expect(vi.getTimerCount()).toBe(0);
    expect(c.humanTurn).toBe(false); expect(data.get('gd_match_current')).toBe(before);
    const moved = JSON.stringify(c.state);
    expect(internals(c).step({ pass: true })).toBe(false);
    expect(JSON.stringify(c.state)).toBe(moved);
    failWrite = false;
    expect(c.retryGameSave()).toBe(true); expect(c.saveError).toBeNull();
    expect(c.state!.moveNo).toBe(1); expect(JSON.stringify(c.state)).toBe(moved);
    expect(loadCurrentMatch()?.activeGame?.moves).toHaveLength(1);
    expect(c.thinking).toBe(true); // Existing delayed scheduling resumes; fake timer is not executed.
  });
  it('gates the initial snapshot before any AI decision or human input', () => {
    const c = makeController(); failWrite = true; c.startGame();
    expect(c.state?.moveNo).toBe(0); expect(c.saveError).toBeTruthy();
    expect(c.humanTurn).toBe(false); expect(c.thinking).toBe(false); expect(vi.getTimerCount()).toBe(0);
    const game = c.state; failWrite = false;
    expect(c.retryGameSave()).toBe(true); expect(c.state).toBe(game);
    expect(c.state?.moveNo).toBe(0); expect(loadCurrentMatch()?.activeGame?.moves).toEqual([]);
  });
  it('does not overwrite another page after the first snapshot write failed', () => {
    const c = makeController(); failWrite = true; c.startGame();
    expect(c.saveError).toBeTruthy();
    data.set('gd_match_current', JSON.stringify({ ...c.matchSavePoint(), matchId: 'other-match', snapshotRevision: 'other-page' }));
    const other = data.get('gd_match_current'); failWrite = false;
    expect(c.retryGameSave()).toBe(false);
    expect(c.exchangeError).toContain('其他页面');
    expect(data.get('gd_match_current')).toBe(other);
  });
  it('does not start a game if its initial ownership baseline cannot be read', () => {
    const c = makeController(); failRead = true;
    c.startGame();
    expect(c.state).toBeNull(); expect(c.exchangeError).toContain('本地存储不可读');
    expect(data.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('allows retrying a deliberate new game while the observed old snapshot is unchanged', () => {
    const c = makeController();
    data.set('gd_match_current', JSON.stringify({ ...c.matchSavePoint(), matchId: 'old-match', snapshotRevision: 'old-page' }));
    const before = data.get('gd_match_current'); failWrite = true; c.startGame();
    expect(c.saveError).toBeTruthy(); expect(data.get('gd_match_current')).toBe(before);
    failWrite = false;
    expect(c.retryGameSave()).toBe(true);
    expect(loadCurrentMatch()?.matchId).toBe(c.matchSavePoint().matchId);
    expect(loadCurrentMatch()?.matchId).not.toBe('old-match');
  });
  it('treats a snapshot read failure after apply as recoverable without reapplying', () => {
    const c = atActiveGame(); failOnRead = 3;
    c.humanPlay(legalCombos(c.state!)[0]);
    expect(c.state!.moveNo).toBe(1); expect(c.saveError).toContain('读取');
    expect(c.exchangeError).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    failOnRead = 0;
    expect(c.retryGameSave()).toBe(true); expect(c.state!.moveNo).toBe(1);
    expect(c.saveError).toBeNull(); expect(loadCurrentMatch()?.activeGame?.moves).toHaveLength(1);
  });
  it('keeps completed exchanges in memory without redoing returns or bypassing acknowledgement', () => {
    const c = makeController(); c.match = createMatch(DEFAULT_RULES, 4242);
    c.match.levels = [5, 3]; c.match.gameNo = 1; c.match.lastHead = 0;
    c.match.lastResult = { finishOrder: [0, 1, 2, 3], winnerTeam: 0, doubleUp: false, levelsAfter: [5, 3], upgrade: 2, passedA: false };
    c.state = startGame(c.match, [0], Array.from({ length: 4 }, (_, seat) => Array.from({ length: 27 }, (_, n) => seat * 27 + n)));
    expect(c.state.pendingReturns.length).toBeGreaterThan(0);
    failWrite = true;
    while (c.state.pendingReturns.length) c.submitReturn(pickReturnCard(c.state, c.state.pendingReturns[0].from));
    expect(c.saveError).toBeTruthy(); expect(c.exchangeAckPending).toBe(true);
    const hands = JSON.stringify(c.state.hands), exchange = c.exchangeResult()!.version;
    expect(c.acknowledgeExchange(exchange)).toBe(false);
    failWrite = false;
    expect(c.retryGameSave()).toBe(true); expect(c.state.moveNo).toBe(0);
    expect(JSON.stringify(c.state.hands)).toBe(hands);
    expect(c.exchangeAckPending).toBe(true); expect(c.thinking).toBe(false);
    expect(c.acknowledgeExchange(exchange)).toBe(true);
  });
  it('recovers temporary read failure during retry but cannot clear a real ownership loss', () => {
    const c = atActiveGame(); failWrite = true; c.humanPlay(legalCombos(c.state!)[0]);
    failWrite = false; failRead = true;
    expect(c.retryGameSave()).toBe(false); expect(c.exchangeError).toBeNull();
    failRead = false;
    const previous = data.get('gd_match_current')!;
    data.set('gd_match_current', JSON.stringify({ ...JSON.parse(previous), snapshotRevision: 'other-page' }));
    expect(c.retryGameSave()).toBe(false); expect(c.exchangeError).toContain('其他页面');
    data.set('gd_match_current', previous);
    expect(c.retryGameSave()).toBe(false); expect(c.saveError).toBeTruthy();
    expect(data.get('gd_match_current')).toBe(previous);
  });
  it.each(['applying', 'execution_uncertain'] as const)('does not repair %s through ordinary save retry', (status) => {
    const c = atActiveGame(); failWrite = true; c.humanPlay(legalCombos(c.state!)[0]); failWrite = false;
    internals(c).executionState = status;
    const before = new Map(data);
    expect(c.retryGameSave()).toBe(false); expect(data).toEqual(before);
    expect(c.state!.moveNo).toBe(1);
  });
});
