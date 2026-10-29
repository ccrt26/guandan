import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameRecord, GameResult } from '@gd/engine';

/** 手写 localStorage 替身（vitest node 环境无 DOM，零依赖方案） */
function makeLocalStorage(limit = Infinity) {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (map.size >= limit && !map.has(k)) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, v);
    },
    removeItem: (k: string) => { map.delete(k); },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    clear: () => map.clear(),
  } as Storage;
}

const storageMod = () => import('../src/game/storage');

function fakeRecord(id: string): GameRecord {
  const result: GameResult = {
    winnerTeam: 0,
    finishOrder: [0, 3, 1, 2],
    upgrade: 3,
    passA: false,
    doubleUp: true,
  } as unknown as GameResult;
  return {
    id,
    matchId: 'm',
    createdAt: 1,
    ruleOpts: { levelMode: 'both', passA: 'head3', straightLen: 5, pairSeqMin: 3, pairSeqMax: 3, trioSeqMin: 2, trioSeqMax: 2, flushLen: 5 },
    levelsBefore: [2, 2],
    leader: 0,
    humanSeat: 0,
    difficulties: [null, 1, 1, 1],
    initialHands: [[], [], [], []],
    moves: [],
    result,
  } as unknown as GameRecord;
}

describe('教练报告持久化（localStorage，与记录同生命周期）', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).localStorage = makeLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('保存/读取/删除报告', async () => {
    const s = await storageMod();
    s.saveReport('a1', '# 报告内容');
    expect(s.loadReport('a1')).toBe('# 报告内容');
    s.removeReport('a1');
    expect(s.loadReport('a1')).toBeNull();
  });

  it('删除对局记录时联动删除报告（此前泄漏点）', async () => {
    const s = await storageMod();
    s.saveRecord(fakeRecord('r1'));
    s.saveReport('r1', '讲解放这里');
    expect(s.loadReport('r1')).toBe('讲解放这里');
    s.deleteRecord('r1');
    expect(s.loadReport('r1')).toBeNull();
    expect(s.loadRecord('r1')).toBeNull();
  });

  it('pruneOrphanReports 清掉记录已不存在的报告，保留在册报告', async () => {
    const s = await storageMod();
    s.saveRecord(fakeRecord('r2'));
    s.saveReport('r2', '有效报告');
    s.saveReport('ghost', '孤儿报告');
    s.pruneOrphanReports();
    expect(s.loadReport('r2')).toBe('有效报告');
    expect(s.loadReport('ghost')).toBeNull();
  });

  it('配额不足时兜底：清掉其他报告后重试成功', async () => {
    (globalThis as Record<string, unknown>).localStorage = makeLocalStorage(1);
    const s = await storageMod();
    s.saveReport('old1', 'x');
    s.saveReport('new1', 'y'.repeat(10)); // 触发配额 → 清 old1 → 重试成功
    expect(s.loadReport('new1')).toBe('y'.repeat(10));
    expect(s.loadReport('old1')).toBeNull();
  });
});
