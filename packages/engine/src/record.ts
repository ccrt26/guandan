import type { Card, Combo, GameResult, RuleOptions } from './types';

/** 单步动作记录（复盘回放的最小单元） */
export interface MoveRecord {
  moveNo: number;
  player: number;
  pass: boolean;
  cards?: Card[];
  comboKind?: Combo['kind'];
  mainRank?: number;
  /** 出牌后各玩家手牌数 */
  handsAfter: number[];
  /** 被压制的牌型主 rank（跟牌上下文） */
  toBeatKind?: Combo['kind'];
  toBeatRank?: number;
}

/** 一局完整记录：初始手牌 + 动作序列可确定性重建任意时刻局面 */
export interface GameRecord {
  /** 数据格式版本：2=出牌人字段正确（此前版本 player 错记为下家，读取时须 normalizeRecord 修正） */
  schemaVersion?: number;
  id: string;
  matchId: string;
  createdAt: number;
  ruleOpts: RuleOptions;
  levelsBefore: [number, number];
  /** 本局台上的一方（stage 口径：其级数为唯一级牌）。旧口径记录缺省，回放按 ruleOpts.levelMode 处理 */
  stageTeam?: 0 | 1;
  leader: number;
  /** 人类玩家座位（复盘主角），AI 对局可为 null */
  humanSeat: number | null;
  /** AI 难度（0=初级 1=中级 2=高级），按座位 */
  difficulties: (0 | 1 | 2 | null)[];
  /** 各席位实际策略版本（可选；与 difficulties 语义互补——神经陪练/回退时以本字段为准：
   *  'human' | 'autopilot:L<d>' | 'heuristic:L<d>' | 'heuristic:L<d>(fallback)' | 'neural:<ver>'） */
  aiPolicies?: string[];
  initialHands: Card[][];
  moves: MoveRecord[];
  /** REVIEW4-A2/D2：本局进贡还贡公开流转（当时全场可见的牌归属转移）。
   * 旧记录无此字段=当时信息未记录（复盘按缺失处理，不得伪造）；引擎 Recorder
   * 从 GameState.tribute 落盘。 */
  tributes?: Array<{
    kind: 'tribute' | 'return';
    from: number;
    to: number;
    card: Card;
    /** 事件时点（进贡还贡发生在本局首手前=0） */
    atMove: number;
  }>;
  result: GameResult | null;
}

export const RECORD_SCHEMA_VERSION = 2;

export interface RecordIntegrityIssue {
  moveNo?: number;
  message: string;
}

const isValidCard = (c: Card) =>
  (c.suit === 'J' && (c.rank === 16 || c.rank === 17)) ||
  (['S', 'H', 'D', 'C'].includes(c.suit) && c.rank >= 2 && c.rank <= 14);

/** 记录完整性铁律校验（复盘前必跑；测试里作为记录器的回归门禁）。
 * 三条铁律，成立则"牌张归属驱动"的回放与真实牌局逐张吻合：
 * 1) 初始牌 108 张且张张合法；
 * 2) 每手牌的所有牌张 id 属于同一玩家当时的手牌（出牌人由归属唯一确定）；
 * 3) 按"初始手牌 − 已出 id"重建的各家手牌数与 handsAfter 逐手一致。
 * schemaVersion>=2 的记录还要求 player 字段与归属一致（旧版本记录允许错位，由 normalizeRecord 修）。 */
export function checkRecordIntegrity(record: GameRecord): RecordIntegrityIssue[] {
  const issues: RecordIntegrityIssue[] = [];
  const total = record.initialHands.reduce((s, h) => s + h.length, 0);
  if (total !== 108) issues.push({ message: `初始牌共 ${total} 张，应为 108` });
  record.initialHands.forEach((h, s) => h.forEach((c) => { if (!isValidCard(c)) issues.push({ message: `座位${s}初始手牌含非法牌 ${c.suit}${c.rank}` }); }));
  if (issues.length > 0) return issues;

  const hands = record.initialHands.map((h) => new Set(h.map((c) => c.id)));
  for (const move of record.moves) {
    if (!move.pass) {
      const ids = (move.cards ?? []).map((c) => c.id);
      if (ids.length > 0) {
        const owner = hands.findIndex((h) => ids.every((id) => h.has(id)));
        if (owner < 0) {
          issues.push({ moveNo: move.moveNo, message: `第 ${move.moveNo} 手的牌不属于任何一位玩家的手牌` });
          continue;
        }
        if (record.schemaVersion !== undefined && move.player !== owner) {
          issues.push({ moveNo: move.moveNo, message: `第 ${move.moveNo} 手 player=${move.player}，但牌张归属座位 ${owner}（记录器回归）` });
        }
        for (const id of ids) hands[owner].delete(id);
      }
    }
    const sizes = hands.map((h) => h.size);
    if (move.handsAfter && move.handsAfter.some((n, i) => n !== sizes[i])) {
      issues.push({ moveNo: move.moveNo, message: `第 ${move.moveNo} 手 handsAfter=[${move.handsAfter}] 与牌张重建 [${sizes}] 不符` });
    }
  }
  return issues;
}

export class Recorder {
  private moves: MoveRecord[] = [];
  private moveNo = 0;

  constructor(
    public meta: Omit<GameRecord, 'moves' | 'result'>,
  ) {}

  record(
    player: number,
    move: { pass: boolean; combo?: Combo | null },
    hands: Card[][],
    toBeat: Combo | null,
  ): void {
    this.moveNo += 1;
    this.moves.push({
      moveNo: this.moveNo,
      player,
      pass: move.pass,
      cards: move.combo?.cards,
      comboKind: move.combo?.kind,
      mainRank: move.combo?.mainRank,
      handsAfter: hands.map((h) => h.length),
      toBeatKind: toBeat?.kind,
      toBeatRank: toBeat?.mainRank,
    });
  }

  finish(result: GameResult): GameRecord {
    const rec: GameRecord = { ...this.meta, moves: this.moves, result };
    if (this.tributes) rec.tributes = this.tributes;
    return rec;
  }

  /** REVIEW4-A2/D2：落盘公开贡还流转（进贡还贡发生在首手前，atMove=0；
   * 抗贡 resist 时引擎 tributes/returns 为空数组=本局无流转，与"未记录"区分） */
  recordTributes(tribute: {
    resist: boolean;
    tributes: Array<{ from: number; to: number; card: Card }>;
    returns: Array<{ from: number; to: number; card: Card }>;
  } | null): void {
    if (!tribute) return;
    this.tributes = [
      ...tribute.tributes.map((t) => ({ kind: 'tribute' as const, from: t.from, to: t.to, card: t.card, atMove: 0 })),
      ...tribute.returns.map((t) => ({ kind: 'return' as const, from: t.from, to: t.to, card: t.card, atMove: 0 })),
    ];
  }
  private tributes?: GameRecord['tributes'];

  get moveCount(): number {
    return this.moves.length;
  }
}

let recordSeq = 0;
export function newRecordId(): string {
  recordSeq += 1;
  return `r${Date.now().toString(36)}${recordSeq.toString(36)}`;
}
