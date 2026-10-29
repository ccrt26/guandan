import type { GameRecord, GameResult, Move, RuleOptions } from '@gd/engine';
import type { Difficulty } from '@gd/ai';
import type { ExchangeHistoryEntry, InitialGameSnapshot } from './exchange';

/**
 * 本地持久化：对局记录 + 战绩统计（localStorage）。
 * 记录只保留最近 40 局，避免超出 5MB 配额。
 */

export interface RecordMeta {
  id: string;
  matchId: string;
  createdAt: number;
  humanSeat: number;
  difficulties: (0 | 1 | 2 | null)[];
  winnerTeam: 0 | 1;
  doubleUp: boolean;
  humanRank: number; // 人类名次 1..4
  levelsBefore: [number, number];
  moves: number;
  /** 收藏的重要复盘 */
  favorite?: boolean;
}

const INDEX_KEY = 'gd_records_index';
const RECORD_PREFIX = 'gd_record_';
const REPORT_PREFIX = 'gd_report_v2_';
const SCOPED_REPORT_PREFIX = 'gd_report_v3_';
const STATS_KEY = 'gd_stats';
const INDEX_LIMIT = 40;

// ---------- 教练报告持久化（与对局记录同生命周期） ----------

function reportKey(recordId:string,viewerSeat?:number):string {
  if(viewerSeat===undefined)return REPORT_PREFIX+recordId;
  if(!Number.isInteger(viewerSeat)||viewerSeat<0||viewerSeat>3)throw new Error('invalid report viewer');
  return `${SCOPED_REPORT_PREFIX}${encodeURIComponent(recordId)}__v${viewerSeat}`;
}
function reportOwner(key:string):string|null {
  if(key.startsWith(REPORT_PREFIX))return key.slice(REPORT_PREFIX.length);
  if(key.startsWith(SCOPED_REPORT_PREFIX)){
    const match=key.slice(SCOPED_REPORT_PREFIX.length).match(/^(.*)__v[0-3]$/);
    if(match){try{return decodeURIComponent(match[1]);}catch{return null;}}
  }
  return null;
}
export function loadReport(recordId: string,viewerSeat?:number): string | null {
  try { return localStorage.getItem(reportKey(recordId,viewerSeat)); } catch { return null; }
}

export function saveReport(recordId: string, report: string,viewerSeat?:number): void {
  const key=reportKey(recordId,viewerSeat);
  try {
    localStorage.setItem(key, report);
  } catch {
    // 配额兜底：删掉其他报告键腾位并重试一次；再失败只放弃持久化（当前页面仍能看）
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && reportOwner(k)!==null && k !== key && reportOwner(k)!==recordId) {
          localStorage.removeItem(k); i -= 1;
        }
      }
      localStorage.setItem(key, report);
    } catch {
      console.warn('[storage] 报告持久化失败（localStorage 配额不足）');
    }
  }
}

export function removeReport(recordId: string): void {
  try {
    localStorage.removeItem(REPORT_PREFIX+recordId);
    for(let viewer=0;viewer<4;viewer++)localStorage.removeItem(reportKey(recordId,viewer));
  } catch { /* ignore */ }
}

/** 清理"对局记录已不存在"的孤儿报告（App 挂载时跑一次，幂等） */
let orphanPruned = false;
export function pruneOrphanReports(): void {
  if (orphanPruned) return;
  orphanPruned = true;
  try {
    const ids = new Set(listRecords().map((m) => m.id));
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && reportOwner(k)!==null && !ids.has(reportOwner(k)!)) {
        localStorage.removeItem(k);
        i -= 1;
      }
    }
  } catch { /* ignore */ }
}

export function listRecords(): RecordMeta[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as RecordMeta[];
  } catch {
    return [];
  }
}

export function saveRecord(record: GameRecord): void {
  if (!record.result) return;
  const humanSeat = record.humanSeat ?? 0;
  const meta: RecordMeta = {
    id: record.id,
    matchId: record.matchId,
    createdAt: record.createdAt,
    humanSeat,
    difficulties: record.difficulties,
    winnerTeam: record.result.winnerTeam,
    doubleUp: record.result.doubleUp,
    humanRank: record.result.finishOrder.indexOf(humanSeat) + 1,
    levelsBefore: record.levelsBefore,
    moves: record.moves.length,
  };
  const index = listRecords().filter((m) => m.id !== meta.id);
  index.unshift(meta);
  const trimmed = index.slice(0, INDEX_LIMIT);
  // 清掉被裁剪记录的正文与报告（报告与记录同生命周期）
  for (const m of index.slice(INDEX_LIMIT)) {
    localStorage.removeItem(RECORD_PREFIX + m.id);
    removeReport(m.id);
  }
  localStorage.setItem(INDEX_KEY, JSON.stringify(trimmed));
  localStorage.setItem(RECORD_PREFIX + meta.id, JSON.stringify(record));
}

export function loadRecord(id: string): GameRecord | null {
  try {
    return JSON.parse(localStorage.getItem(RECORD_PREFIX + id) ?? 'null') as GameRecord | null;
  } catch {
    return null;
  }
}

export function setRecordFavorite(id: string, fav: boolean): void {
  const index = listRecords();
  const m = index.find((x) => x.id === id);
  if (!m) return;
  if (fav) m.favorite = true; else delete m.favorite;
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); } catch { /* ignore */ }
}

export function deleteRecord(id: string): void {
  localStorage.removeItem(RECORD_PREFIX + id);
  removeReport(id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(listRecords().filter((m) => m.id !== id)));
}

export interface Stats {
  games: number;
  wins: number; // 人类所在队赢
  headFinish: number; // 人类头游次数
  byDifficulty: Record<number, { games: number; wins: number }>;
}

// ---------- 比赛进度：兼容旧局末档；新档在交换完成后保存起点和已执行动作 ----------

export interface ActiveGameSave {
  schemaVersion: 1;
  initial: InitialGameSnapshot;
  recorderMeta: Omit<GameRecord, 'moves' | 'result'>;
  moves: Move[];
  acknowledgedVersion: string | null;
}

export interface MatchSave {
  levels: [number, number];
  /** 引擎局号；有 activeGame 时该局进行中，无 activeGame 的旧档为已完成局数。 */
  gameNo: number;
  /** 上一局结果（驱动进贡还贡与显示） */
  lastResult: GameResult | null;
  lastHead: number | null;
  rngState: number;
  ruleOpts: RuleOptions;
  difficulty: Difficulty;
  /** 对手口径（'neural-tier:easy|standard|hard' 或 'heuristic:L?'）；旧档无此字段=按旧难度恢复 */
  aiPolicy?: string;
  savedAt: number;
  /** 本地比赛稳定身份；不会因刷新、确认或普通通知变化。 */
  matchId?: string;
  /** 本地存档的写入修订，用于拒绝旧页面继续覆盖已更新的存档。 */
  snapshotRevision?: string;
  activeGame?: ActiveGameSave;
  exchangeHistory?: readonly ExchangeHistoryEntry[];
}

const MATCH_KEY = 'gd_match_current';

export function saveCurrentMatch(save: MatchSave): boolean {
  try { localStorage.setItem(MATCH_KEY, JSON.stringify(save)); return true; } catch { return false; }
}

export function loadCurrentMatch(): MatchSave | null {
  try {
    const raw = localStorage.getItem(MATCH_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as MatchSave;
    // 基本形状校验：坏档直接当没有（宁可重开，不带着坏数据硬续）
    if (!Array.isArray(save.levels) || save.levels.length !== 2 || typeof save.gameNo !== 'number' || !save.ruleOpts) return null;
    return save;
  } catch { return null; }
}

export function clearCurrentMatch(): void {
  try { localStorage.removeItem(MATCH_KEY); } catch { /* ignore */ }
}

// ---------- LLM 配置（游戏内设置，存浏览器本地；代理优先读请求头里的这份配置） ----------

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 复盘思考强度：max=最高（深度思考全开），std=标准，off=关闭 */
  effort: 'max' | 'std' | 'off';
}

const LLM_KEY = 'gd_llm_config';

export function loadLLMConfig(): LLMConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(LLM_KEY) ?? 'null') as Partial<LLMConfig> | null;
    if (!c || !c.baseUrl || !c.apiKey || !c.model) return null;
    return { effort: 'max', baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, ...(c.effort ? { effort: c.effort } : {}) };
  } catch {
    return null;
  }
}

export function saveLLMConfig(config: LLMConfig): void {
  localStorage.setItem(LLM_KEY, JSON.stringify(config));
}

export function clearLLMConfig(): void {
  localStorage.removeItem(LLM_KEY);
}

/** 发给本地代理的配置头（Key 只在本机流转：浏览器 → 127.0.0.1 代理 → LLM 服务商） */
export function llmHeaders(): Record<string, string> {
  const c = loadLLMConfig();
  return c ? { 'x-llm-base': c.baseUrl, 'x-llm-key': c.apiKey, 'x-llm-model': c.model } : {};
}

/** 按思考强度构造请求体的思考参数与输出上限
 * 实测（GLM-5.3 · Coding Plan 的 Anthropic 端点）：budget_tokens 会被无视、模型默认就思考，
 * 唯一有效的开关是 thinking.type=disabled（约 6 秒出答案）。最高档=放开思考，约 5~7 分钟。 */
export function thinkingParams(effort: LLMConfig['effort']): { thinking?: unknown; reasoning_effort?: string; maxTokens: number } {
  if (effort === 'off') return { thinking: { type: 'disabled' }, maxTokens: 8192 };
  if (effort === 'std') return { thinking: { type: 'disabled' }, maxTokens: 12288 };
  return { thinking: { type: 'enabled' }, maxTokens: 32768 };
}

export function loadStats(): Stats {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY) ?? '') as Stats;
  } catch {
    return { games: 0, wins: 0, headFinish: 0, byDifficulty: {} };
  }
}

export function updateStats(record: GameRecord): void {
  if (!record.result) return;
  const stats = loadStats();
  const humanSeat = record.humanSeat ?? 0;
  const humanTeamWon = record.result.winnerTeam === (humanSeat % 2 === 0 ? 0 : 1);
  const diff = Math.max(...(record.difficulties.filter((d) => d !== null) as number[]), 0);
  stats.games += 1;
  if (humanTeamWon) stats.wins += 1;
  if (record.result.finishOrder[0] === humanSeat) stats.headFinish += 1;
  const slot = stats.byDifficulty[diff] ?? { games: 0, wins: 0 };
  slot.games += 1;
  if (humanTeamWon) slot.wins += 1;
  stats.byDifficulty[diff] = slot;
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}
