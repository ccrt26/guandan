import type { Card, Combo, GameResult, RuleOptions } from './types';
import { buildDeck } from './deck';

/** 单步动作记录（复盘回放的最小单元） */
export interface MoveRecord {
  moveNo: number;
  player: number;
  pass: boolean;
  cards?: Card[];
  comboKind?: Combo['kind'];
  mainRank?: number;
  /** 完整出牌声明。旧记录缺失时只能按可唯一恢复的语义回放，不能补造原声明。 */
  declaration?: Omit<Combo, 'cards'>;
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

const canonicalCards = new Map(buildDeck().map((card) => [card.id, card]));
const isCanonicalCard = (card: Card): boolean => {
  if (!card || !Number.isInteger(card.id)) return false;
  const expected = canonicalCards.get(card.id);
  return expected !== undefined && card.suit === expected.suit && card.rank === expected.rank;
};

/** 记录完整性铁律校验（复盘前必跑；测试里作为记录器的回归门禁）。
 * 1) 四席各 27 张，108 个标准实体 id 各出现一次，id 与牌面对应；
 * 2) 非 Pass 动作非空且无重复实体，牌面真实，所有 id 同属一席尚未打出的手牌；
 * 3) 按"初始手牌 − 已出 id"重建的四席手牌数与完整 handsAfter 逐手一致。
 * 有 schemaVersion 的记录沿既有约定要求 player 与归属一致；无版本旧记录可迁移。
 * 只证明实体资源一致；牌型声明与合法轮次另由严格回放验证。 */
export function checkRecordIntegrity(record: GameRecord): RecordIntegrityIssue[] {
  const issues: RecordIntegrityIssue[] = [];
  if (!Array.isArray(record.initialHands) || record.initialHands.length !== 4
    || [...record.initialHands].some((hand) => !Array.isArray(hand) || hand.length !== 27)) {
    return [{ message: '初始手牌必须为四席各 27 张，共 108 张' }];
  }
  const seen = new Set<number>();
  for (const [seat, hand] of record.initialHands.entries()) {
    for (const card of hand) {
      if (!isCanonicalCard(card)) {
        issues.push({ message: `座位${seat}初始手牌含非法实体牌或 id 与牌面不符` });
      } else if (seen.has(card.id)) {
        issues.push({ message: `初始手牌重复使用实体牌 id=${card.id}` });
      } else seen.add(card.id);
    }
  }
  if (issues.length > 0) return issues;

  const hands = record.initialHands.map((h) => new Set(h.map((c) => c.id)));
  for (const move of record.moves) {
    if (move.pass) {
      if (move.cards !== undefined && (!Array.isArray(move.cards) || move.cards.length > 0)) {
        issues.push({ moveNo: move.moveNo, message: `第 ${move.moveNo} 手 Pass 不能含实体牌` });
        break;
      }
    } else {
      if (!Array.isArray(move.cards) || move.cards.length === 0
        || [...move.cards].some((card) => !isCanonicalCard(card))) {
        issues.push({ moveNo: move.moveNo, message: `第 ${move.moveNo} 手缺少实体牌或 id 与真实牌面不符` });
        break;
      }
      const ids = move.cards.map((card) => card.id);
      if (new Set(ids).size !== ids.length) {
        issues.push({ moveNo: move.moveNo, message: `第 ${move.moveNo} 手重复使用同一实体牌` });
        break;
      }
      const owner = hands.findIndex((hand) => ids.every((id) => hand.has(id)));
      if (owner < 0) {
        issues.push({ moveNo: move.moveNo, message: `第 ${move.moveNo} 手的牌不属于任何一位玩家的手牌` });
        break;
      }
      if (record.schemaVersion !== undefined && move.player !== owner) {
        issues.push({ moveNo: move.moveNo, message: `第 ${move.moveNo} 手 player=${move.player}，但牌张归属座位 ${owner}（记录器回归）` });
        break;
      }
      for (const id of ids) hands[owner].delete(id);
    }
    const sizes = hands.map((h) => h.size);
    if (!Array.isArray(move.handsAfter) || move.handsAfter.length !== 4
      || sizes.some((n, i) => n !== move.handsAfter[i])) {
      issues.push({ moveNo: move.moveNo, message: `第 ${move.moveNo} 手 handsAfter=[${move.handsAfter}] 与牌张重建 [${sizes}] 不符` });
      break;
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
    const combo = move.pass ? null : move.combo;
    this.moves.push({
      moveNo: this.moveNo,
      player,
      pass: move.pass,
      cards: combo?.cards.map((card) => ({ ...card })),
      comboKind: combo?.kind,
      mainRank: combo?.mainRank,
      declaration: combo ? {
        kind: combo.kind, size: combo.size, keyRank: combo.keyRank,
        length: combo.length, mainRank: combo.mainRank, suit: combo.suit,
        pairRanks: [...combo.pairRanks], wildAs: combo.wildAs.map((wild) => ({ ...wild })),
      } : undefined,
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
