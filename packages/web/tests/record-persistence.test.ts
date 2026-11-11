import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDeck, DEFAULT_RULES, type GameRecord } from '@gd/engine';
import { clearCurrentMatch, listRecords, loadRecord, saveRecord } from '../src/game/storage';

const data = new Map<string, string>();
let failKey: string | null = null;
let failRemove = false;
function record(id: string): GameRecord {
  const deck = buildDeck();
  return { id, matchId: 'storage-test', createdAt: 1, ruleOpts: DEFAULT_RULES, levelsBefore: [2, 2],
    leader: 0, humanSeat: 0, difficulties: [null, 1, 1, 1],
    initialHands: [deck.slice(0, 27), deck.slice(27, 54), deck.slice(54, 81), deck.slice(81)], moves: [],
    result: { finishOrder: [0, 2, 1, 3], winnerTeam: 0, doubleUp: true, levelsAfter: [5, 2], upgrade: 3, passedA: false } };
}
beforeEach(() => {
  data.clear(); failKey = null; failRemove = false;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (key === failKey) throw Error('quota'); data.set(key, value); },
    removeItem: (key: string) => { if (failRemove) throw Error('storage blocked'); data.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('record persistence commit order', () => {
  function seedForty(): Map<string, string> {
    for (let n = 0; n < 40; n++) {
      saveRecord(record(`old-${n}`));
      data.set(`gd_report_v2_old-${n}`, `report-${n}`);
    }
    return new Map(data);
  }
  it.each(['gd_record_new', 'gd_records_index'])('keeps every old record and report when %s fails', (key) => {
    const before = seedForty();
    failKey = key;
    expect(saveRecord(record('new'))).toBe(false);
    for (const [oldKey, value] of before) expect(data.get(oldKey)).toBe(value);
    expect(listRecords().some(meta => meta.id === 'new')).toBe(false);
    expect(listRecords().every(meta => loadRecord(meta.id) !== null)).toBe(true);
  });
  it('retries an unindexed body and trims only after the new record is visible', () => {
    seedForty();
    failKey = 'gd_records_index';
    expect(saveRecord(record('new'))).toBe(false);
    expect(loadRecord('new')?.id).toBe('new');
    failKey = null;
    expect(saveRecord(record('new'))).toBe(true);
    expect(listRecords()).toHaveLength(40);
    expect(listRecords()[0].id).toBe('new');
    expect(loadRecord('old-0')).toBeNull();
    expect(data.has('gd_report_v2_old-0')).toBe(false);
  });
  it('does not overwrite an unreadable index or lose an existing favorite on retry', () => {
    data.set('gd_records_index', '{broken');
    expect(saveRecord(record('new'))).toBe(false);
    expect(data.get('gd_records_index')).toBe('{broken');
    expect(data.has('gd_record_new')).toBe(false);
    data.set('gd_records_index', '[]');
    expect(saveRecord(record('new'))).toBe(true);
    const index = listRecords(); index[0].favorite = true;
    data.set('gd_records_index', JSON.stringify(index));
    expect(saveRecord(record('new'))).toBe(true);
    expect(listRecords()[0].favorite).toBe(true);
  });
  it('treats post-commit pruning failure as saved, without destructive quota retries', () => {
    seedForty(); failRemove = true;
    expect(saveRecord(record('new'))).toBe(true);
    expect(listRecords()[0].id).toBe('new');
    expect(loadRecord('new')?.id).toBe('new');
    expect(loadRecord('old-0')?.id).toBe('old-0');
  });
  it('reports a failed final-match clear instead of claiming completion', () => {
    data.set('gd_match_current', 'previous'); failRemove = true;
    expect(clearCurrentMatch()).toBe(false);
    expect(data.get('gd_match_current')).toBe('previous');
    failRemove = false;
    expect(clearCurrentMatch()).toBe(true);
    expect(data.has('gd_match_current')).toBe(false);
  });
});
