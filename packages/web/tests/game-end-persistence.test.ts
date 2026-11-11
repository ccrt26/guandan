import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDeck, createMatch, DEFAULT_RULES, legalCombos, Recorder, startGame } from '@gd/engine';
import { MatchController } from '../src/game/controller';
import { loadCurrentMatch, loadRecord, loadStats } from '../src/game/storage';

const controllers: MatchController[] = [];
const data = new Map<string, string>();
let failKey: string | null = null;
let failClear = false;
let failRead = false;

// One finite synthetic final move. No controller.startGame, AI player/decider,
// model, self-play, production storage, network, or real timer is used.
function atFinalMove(matchEnds = false): MatchController {
  const c = new MatchController({ difficulty: 1, rules: DEFAULT_RULES });
  controllers.push(c);
  const match = createMatch(DEFAULT_RULES, 123);
  if (matchEnds) match.levels = [2, 14];
  const state = startGame(match);
  const deck = buildDeck();
  state.hands = [[deck[0]], [], deck.slice(1), []];
  state.finished = [1, 3];
  state.turn = state.leader = state.lastPlayer = 0;
  state.lastCombo = null;
  c.match = match; c.state = state;
  const internals = c as unknown as { recorder: Recorder; savedRevision: string | null };
  internals.savedRevision = 'fixture-revision';
  internals.recorder = new Recorder({ id: 'finished', matchId: 'synthetic', createdAt: 1,
    ruleOpts: match.opts, levelsBefore: state.levelsBefore, leader: 0, humanSeat: 0,
    difficulties: [null, 1, 1, 1], initialHands: state.hands.map(hand => [...hand]) });
  data.set('gd_match_current', JSON.stringify(c.matchSavePoint()));
  return c;
}
function finish(c: MatchController): void { c.humanPlay(legalCombos(c.state!)[0]); }

beforeEach(() => {
  vi.useFakeTimers(); data.clear(); failKey = null; failClear = false; failRead = false;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => { if (failRead && key === 'gd_match_current') throw Error('temporarily unreadable'); return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (key === failKey) throw Error('quota'); data.set(key, value); },
    removeItem: (key: string) => { if (failClear && key === 'gd_match_current') throw Error('blocked'); data.delete(key); },
  });
});
afterEach(() => {
  controllers.forEach(c => c.destroy()); controllers.length = 0;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('game-end persistence gate', () => {
  it.each(['gd_record_finished', 'gd_stats', 'gd_match_current'])('pauses on %s failure and retries only storage, not the final move', (key) => {
    const c = atFinalMove(); failKey = key;
    const before = data.get('gd_match_current');
    const notified = vi.fn(); c.subscribe(notified);
    expect(() => finish(c)).not.toThrow();
    expect(c.state!.over).toBe(true);
    expect(c.state!.moveNo).toBe(1);
    expect(c.record?.id).toBe('finished');
    expect(c.saveError).toBeTruthy();
    expect(c.canAdvanceAfterGame).toBe(false);
    expect(notified).toHaveBeenCalled();
    expect(data.get('gd_match_current')).toBe(before);
    const game = c.state;
    c.startGame();
    expect(c.state).toBe(game);
    failKey = null;
    expect(c.retryFinishedGameSave()).toBe(true);
    expect(c.saveError).toBeNull();
    expect(c.canAdvanceAfterGame).toBe(true);
    expect(c.state).toBe(game);
    expect(c.state!.moveNo).toBe(1);
    expect(loadRecord('finished')?.result).toEqual(c.state!.result);
    expect(loadStats().games).toBe(1);
    expect(loadCurrentMatch()?.lastResult).toEqual(c.state!.result);
    expect(c.retryFinishedGameSave()).toBe(true);
    expect(loadStats().games).toBe(1);
  });
  it('does not auto-exit a completed match until its old snapshot is cleared', () => {
    const c = atFinalMove(true); failClear = true;
    finish(c);
    expect(c.match.winner).not.toBeNull();
    expect(c.canAdvanceAfterGame).toBe(false);
    expect(c.saveError).toBeTruthy();
    expect(data.has('gd_match_current')).toBe(true);
    failClear = false;
    expect(c.retryFinishedGameSave()).toBe(true);
    expect(data.has('gd_match_current')).toBe(false);
    expect(c.canAdvanceAfterGame).toBe(true);
    expect(loadStats().games).toBe(1);
  });
  it('recovers a temporary snapshot read failure without leaving a permanent ownership error', () => {
    const c = atFinalMove(); failKey = 'gd_record_finished'; finish(c);
    failKey = null; failRead = true;
    const before = new Map(data);
    expect(c.retryFinishedGameSave()).toBe(false);
    expect(c.saveError).toContain('读取');
    expect(c.canAdvanceAfterGame).toBe(false);
    expect(data).toEqual(before);
    failRead = false;
    expect(c.retryFinishedGameSave()).toBe(true);
    expect(c.saveError).toBeNull();
    expect(c.exchangeError).toBeNull();
    expect(c.canAdvanceAfterGame).toBe(true);
    expect(c.state!.moveNo).toBe(1);
    expect(loadStats().games).toBe(1);
  });
  it('keeps a real ownership loss terminal, even if the old snapshot later reappears', () => {
    const c = atFinalMove(); failKey = 'gd_record_finished'; finish(c); failKey = null;
    const previous = data.get('gd_match_current')!;
    data.set('gd_match_current', JSON.stringify({ ...JSON.parse(previous), snapshotRevision: 'other-page' }));
    const changed = new Map(data);
    expect(c.retryFinishedGameSave()).toBe(false);
    expect(c.exchangeError).toContain('其他页面');
    expect(c.canAdvanceAfterGame).toBe(false);
    expect(data).toEqual(changed);
    data.set('gd_match_current', previous);
    const restored = new Map(data);
    expect(c.retryFinishedGameSave()).toBe(false);
    expect(c.saveError).toBeTruthy();
    expect(c.canAdvanceAfterGame).toBe(false);
    expect(data).toEqual(restored);
  });
  it('does not bypass an applying or unknown decision by retrying storage', () => {
    const c = atFinalMove(); failKey = 'gd_record_finished'; finish(c);
    failKey = null;
    const internals = c as unknown as { executionState: 'confirmed' | 'applying' | 'execution_uncertain' };
    for (const status of ['applying', 'execution_uncertain'] as const) {
      internals.executionState = status;
      const before = new Map(data);
      expect(c.retryFinishedGameSave()).toBe(false);
      expect(c.canAdvanceAfterGame).toBe(false);
      expect(data).toEqual(before);
    }
    internals.executionState = 'confirmed';
    expect(c.retryFinishedGameSave()).toBe(true);
  });
});
