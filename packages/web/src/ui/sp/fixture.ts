import type { StatsVM } from './viewmodel';

/**
 * data.json 截图快照的冻结 view model（results_ui_handoff/data.json）。
 * 仅用于 DEV + ?spfixture=1 的确定性截图对比与数据断言，不进生产构建。
 * 时间为原记录字符串原样呈现（原包注明时区来源未知，不做 UTC 换算）。
 */

const ROWS = [
  { time: '2026/10/27 07:53:38', result: '胜', rank: '第二名', special: '双上游', difficulty: '中级', hands: 103 },
  { time: '2026/10/26 23:48:57', result: '胜', rank: '第一名', special: null, difficulty: '中级', hands: 87 },
  { time: '2026/10/26 22:52:33', result: '胜', rank: '第一名', special: '双上游', difficulty: '中级', hands: 103 },
  { time: '2026/10/25 20:42:52', result: '胜', rank: '第一名', special: '双上游', difficulty: '中级', hands: 94 },
  { time: '2026/10/25 19:41:12', result: '胜', rank: '第一名', special: '双上游', difficulty: '中级', hands: 95 },
  { time: '2026/10/25 10:55:54', result: '胜', rank: '第一名', special: null, difficulty: '中级', hands: 94 },
] as const;

export function fixtureStatsVM(): StatsVM {
  return {
    games: 6,
    wins: 6,
    losses: 0,
    winRate: 1,
    firstPlace: 5,
    doubleUpper: 4,
    recent: [true, true, true, true, true, true],
    rows: ROWS.map((r, i) => ({
      id: `fx-${i}`,
      time: r.time,
      result: r.result as '胜' | '负',
      rank: r.rank,
      special: r.special,
      difficulty: r.difficulty,
      hands: r.hands,
      win: r.result === '胜',
    })),
    difficulty: [
      { name: '初级', games: 0, wins: 0, losses: 0, winRate: null },
      { name: '中级', games: 6, wins: 6, losses: 0, winRate: 1 },
      { name: '高级', games: 0, wins: 0, losses: 0, winRate: null },
    ],
  };
}
