import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULES, type GameRecord } from '@gd/engine';
import { loadStats, updateStats } from '../src/game/storage';

const data = new Map<string, string>();
let failRead = false, failWrite = false;
const record = (id = 'last', matchId = 'match'): GameRecord => ({ id, matchId, createdAt: 1,
  ruleOpts: DEFAULT_RULES, levelsBefore: [2, 2], leader: 0, humanSeat: 0,
  difficulties: [null, 1, 1, 1], initialHands: [], moves: [],
  result: { finishOrder: [0, 2, 1, 3], winnerTeam: 0, doubleUp: true, levelsAfter: [5, 2], upgrade: 3, passedA: false } });
beforeEach(() => {
  data.clear(); failRead = failWrite = false;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => { if (failRead) throw Error('unreadable'); return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (failWrite) throw Error('quota'); data.set(key, value); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('latest completed record statistics retry', () => {
  it('does not recount the same completed record loaded again from JSON', () => {
    const first = record(); updateStats(first);
    const committed = data.get('gd_stats');
    // A reloaded controller receives new objects with the same saved recorder identity.
    updateStats(JSON.parse(JSON.stringify(first)) as GameRecord);
    expect(data.get('gd_stats')).toBe(committed);
    expect(loadStats()).toMatchObject({ games: 1, wins: 1, headFinish: 1,
      byDifficulty: { 1: { games: 1, wins: 1 } }, lastCountedRecord: { matchId: 'match', recordId: 'last' } });
  });
  it('counts the next record and keeps match identity in the duplicate guard', () => {
    updateStats(record()); updateStats(record('next')); updateStats(record('next', 'another-match'));
    expect(loadStats().games).toBe(3);
    updateStats(record('next', 'another-match'));
    expect(loadStats().games).toBe(3);
  });
  it('commits the marker and counters together, so a failed write can be retried once', () => {
    updateStats(record('first'));
    const before = data.get('gd_stats'); failWrite = true;
    expect(() => updateStats(record('second'))).toThrow('quota');
    expect(data.get('gd_stats')).toBe(before);
    failWrite = false; updateStats(record('second')); updateStats(record('second'));
    expect(loadStats().games).toBe(2);
  });
  it.each(['unreadable', 'invalid-json'])('does not replace existing statistics with zeros after %s', (failure) => {
    updateStats(record('first'));
    if (failure === 'invalid-json') data.set('gd_stats', '{bad');
    else failRead = true;
    const before = data.get('gd_stats');
    expect(() => updateStats(record('second'))).toThrow();
    expect(data.get('gd_stats')).toBe(before);
  });
  it('preserves legacy totals and excludes spectator-only records', () => {
    data.set('gd_stats', JSON.stringify({ games: 10, wins: 4, headFinish: 3, byDifficulty: { 1: { games: 10, wins: 4 } } }));
    updateStats(record()); updateStats(record());
    expect(loadStats()).toMatchObject({ games: 11, wins: 5, headFinish: 4, byDifficulty: { 1: { games: 11, wins: 5 } } });
    const before = data.get('gd_stats'); updateStats({ ...record('spectator'), humanSeat: null });
    expect(data.get('gd_stats')).toBe(before);
  });
});
