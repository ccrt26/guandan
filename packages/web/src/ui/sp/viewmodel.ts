import type { RecordMeta } from '../../game/storage';

/**
 * 战绩页 view model（只读映射，docs：不修改存储策略与统计口径以外的任何业务）。
 * 统计全部由 listRecords() 的记录列表推导（不读增量累计的 gd_stats，
 * 避免「记录列表」与「累计器」漂移时两处数字不一致；头游=humanRank===1，
 * 双上游取胜=doubleUp 且本方获胜——与名次解耦，与原 StatsPage 口径一致）。
 * 0 场时 winRate=null 显示「—」：分母为 0 不得报告 0%。
 */

export interface StatsRowVM {
  id: string;
  /** 已格式化的本地时间字符串（19字符，tabular-nums；fixture 直接用原记录字符串，不做时区换算） */
  time: string;
  result: '胜' | '负';
  rank: string;
  special: string | null;
  difficulty: string;
  hands: number | null;
  win: boolean;
}

export interface DifficultyVM {
  name: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

export interface StatsVM {
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
  firstPlace: number;
  doubleUpper: number;
  /** 最近 6 场胜负（旧→新），最多 6 个点 */
  recent: boolean[];
  rows: StatsRowVM[];
  difficulty: DifficultyVM[];
}

const teamOf = (seat: number) => (seat % 2 === 0 ? 0 : 1);
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 2026/10/27 07:53:38 —— 固定格式，不随运行环境 locale 漂移 */
export function formatTime(createdAt: number): string {
  const d = new Date(createdAt);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function difficultyName(d: 0 | 1 | 2): string {
  return ['初级', '中级', '高级'][d];
}

export function buildStatsVM(records: RecordMeta[]): StatsVM {
  const rows: StatsRowVM[] = [...records]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => {
      const win = teamOf(m.humanSeat) === m.winnerTeam;
      const diff = (m.difficulties.find((d) => d !== null) ?? 1) as 0 | 1 | 2;
      return {
        id: m.id,
        time: formatTime(m.createdAt),
        result: win ? '胜' : '负',
        rank: `第${['一', '二', '三', '四'][m.humanRank - 1] ?? '?'}名`,
        special: m.doubleUp && win ? '双上游' : null,
        difficulty: difficultyName(diff),
        hands: m.moves,
        win,
      };
    });

  const games = rows.length;
  const wins = rows.filter((r) => r.win).length;
  // 头游次数 = 个人排名第一的次数（规格§11，不问队伍胜负；与旧累计器 finishOrder[0]===humanSeat 同口径）
  const firstPlace = rows.filter((r) => r.rank === '第一名').length;
  const doubleUpper = rows.filter((r) => r.special === '双上游').length;

  const byDiff = new Map<string, { games: number; wins: number }>();
  for (const name of ['初级', '中级', '高级']) byDiff.set(name, { games: 0, wins: 0 });
  for (const r of rows) {
    const slot = byDiff.get(r.difficulty);
    if (!slot) continue;
    slot.games += 1;
    if (r.win) slot.wins += 1;
  }

  return {
    games,
    wins,
    losses: games - wins,
    winRate: games > 0 ? wins / games : null,
    firstPlace,
    doubleUpper,
    recent: [...rows].reverse().slice(-6).map((r) => r.win),
    rows,
    difficulty: ['初级', '中级', '高级'].map((name) => {
      const s = byDiff.get(name)!;
      return { name, games: s.games, wins: s.wins, losses: s.games - s.wins, winRate: s.games > 0 ? s.wins / s.games : null };
    }),
  };
}
