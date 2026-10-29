import { describe, expect, it } from 'vitest';
import { buildStatsVM, formatTime, type StatsVM } from '../src/ui/sp/viewmodel';
import { fixtureStatsVM } from '../src/ui/sp/fixture';
import type { RecordMeta } from '../src/game/storage';

/** data.json 快照的语义断言（规格§11：不把个人第一与队伍胜利合并） */
describe('stats fixture VM（data.json 快照）', () => {
  const vm = fixtureStatsVM();

  it('6 场 6 胜 0 负，总胜率 100%', () => {
    expect(vm.games).toBe(6);
    expect(vm.wins).toBe(6);
    expect(vm.losses).toBe(0);
    expect(vm.winRate).toBe(1);
  });

  it('头游 5、双上游 4（第一条第二名仍为胜+双上游，名次与特殊结果解耦）', () => {
    expect(vm.firstPlace).toBe(5);
    expect(vm.doubleUpper).toBe(4);
    expect(vm.rows[0].rank).toBe('第二名');
    expect(vm.rows[0].special).toBe('双上游');
    expect(vm.rows[0].win).toBe(true);
  });

  it('中级 6 场 100%；初级/高级 0 场胜率为 —（分母 0 不报 0%）', () => {
    expect(vm.difficulty[1]).toMatchObject({ name: '中级', games: 6, wins: 6, losses: 0, winRate: 1 });
    for (const d of [vm.difficulty[0], vm.difficulty[2]]) {
      expect(d.games).toBe(0);
      expect(d.winRate).toBeNull();
    }
  });

  it('六行按时间倒序、时间字符串原样（不做时区换算）', () => {
    expect(vm.rows.map((r) => r.time)).toEqual([
      '2026/10/27 07:53:38',
      '2026/10/26 23:48:57',
      '2026/10/26 22:52:33',
      '2026/10/25 20:42:52',
      '2026/10/25 19:41:12',
      '2026/10/25 10:55:54',
    ]);
    expect(vm.rows.map((r) => r.hands)).toEqual([103, 87, 103, 94, 95, 94]);
  });

  it('特殊结果 null 显示 —（special=null 而非空串/0）', () => {
    expect(vm.rows[1].special).toBeNull();
    expect(vm.rows[5].special).toBeNull();
  });
});

/** 真实 RecordMeta → VM 推导口径（storage.listRecords 40 条，新→旧） */
describe('stats live VM（RecordMeta 推导）', () => {
  const base = { matchId: 'm', humanSeat: 0, difficulties: [1, 1, 1] as (0 | 1 | 2 | null)[], levelsBefore: [2, 2] as [number, number] };
  const records: RecordMeta[] = [
    // 新→旧：一场败局 + 双上游的胜局（第二名）+ 普通头游胜局 + 头游但队伍败（头游计数不问胜负）
    { ...base, id: 'a', createdAt: 4, winnerTeam: 1, doubleUp: false, humanRank: 3, moves: 120 },
    { ...base, id: 'd', createdAt: 3, winnerTeam: 1, doubleUp: false, humanRank: 1, moves: 88 },
    { ...base, id: 'b', createdAt: 2, winnerTeam: 0, doubleUp: true, humanRank: 2, moves: 103 },
    { ...base, id: 'c', createdAt: 1, winnerTeam: 0, doubleUp: false, humanRank: 1, moves: 94 },
  ];
  const vm = buildStatsVM(records);

  it('统计：4 场 2 胜 2 负、头游 2（含头游但队伍败的一场）、双上游 1（第二名双上游计入）', () => {
    expect(vm.games).toBe(4);
    expect(vm.wins).toBe(2);
    expect(vm.losses).toBe(2);
    expect(vm.firstPlace).toBe(2);
    expect(vm.doubleUpper).toBe(1);
  });

  it('败局：result=负、无特殊结果、难度取非 null 档', () => {
    expect(vm.rows[0]).toMatchObject({ id: 'a', result: '负', special: null, difficulty: '中级', hands: 120 });
    expect(vm.rows[1]).toMatchObject({ id: 'd', result: '负', rank: '第一名' });
  });

  it('最近6场只取最多6条（旧→新）', () => {
    const many = Array.from({ length: 9 }, (_, i): RecordMeta => ({
      ...base, id: `r${i}`, createdAt: i, winnerTeam: i % 2 === 0 ? 0 : 1, doubleUp: false, humanRank: 1, moves: 50,
    }));
    const vm9 = buildStatsVM(many);
    expect(vm9.recent).toHaveLength(6);
    expect(vm9.games).toBe(9);
  });

  it('空记录：全 0 + 胜率 null + 空态字段', () => {
    const empty = buildStatsVM([]);
    expect(empty).toMatchObject({ games: 0, wins: 0, losses: 0, winRate: null, firstPlace: 0, doubleUpper: 0, recent: [], rows: [] });
    expect(empty.difficulty.every((d) => d.winRate === null && d.games === 0)).toBe(true);
  });

  it('formatTime 输出 19 字符固定格式', () => {
    const t = new Date(2026, 9, 27, 7, 53, 38).getTime();
    expect(formatTime(t)).toBe('2026/10/27 07:53:38');
    expect(formatTime(t)).toHaveLength(19);
  });

  it('40 条口径之外不裁剪（裁剪属于 storage 职责），VM 只如实统计', () => {
    const forty = Array.from({ length: 45 }, (_, i): RecordMeta => ({
      ...base, id: `x${i}`, createdAt: i, winnerTeam: 0, doubleUp: false, humanRank: 1, moves: 10,
    }));
    const vm45 = buildStatsVM(forty);
    expect(vm45.games).toBe(45);
    expect(vm45.rows[0].id).toBe('x44');
  });
});

// 类型级守卫：StatsVM 结构被组件直接消费
describe('stats VM shape', () => {
  it('fixture 与 live VM 字段一致', () => {
    const f: StatsVM = fixtureStatsVM();
    const l: StatsVM = buildStatsVM([]);
    expect(Object.keys(f).sort()).toEqual(Object.keys(l).sort());
  });
});
