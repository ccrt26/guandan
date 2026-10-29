/**
 * 掼蛋引擎基础类型。
 *
 * Rank 采用数字：2..14 表示普通牌点（11=J, 12=Q, 13=K, 14=A），
 * 16=小王，17=大王。级牌不是独立 rank，而是「本局双方级数对应的 rank」，
 * 其比较权重由 rankOrder() 结合本局级牌动态计算。
 */

export type Suit = 'S' | 'H' | 'D' | 'C' | 'J'; // 黑桃 红桃 方块 梅花 王

export type Rank = number;

export interface Card {
  /** 0..107 全局唯一 id，便于 UI 选中与反事实重放 */
  id: number;
  suit: Suit;
  rank: Rank;
}

export const SMALL_JOKER = 16;
export const BIG_JOKER = 17;
export const RANK_A = 14;
export const RANK_2 = 2;

export const RANK_NAME: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
  9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
  16: '小王', 17: '大王',
};

export const SUIT_GLYPH: Record<Suit, string> = {
  S: '♠', H: '♥', D: '♦', C: '♣', J: '🃏',
};

/** 牌型种类 */
export type ComboKind =
  | 'single'      // 单张
  | 'pair'        // 对子
  | 'trio'        // 三张
  | 'trio_pair'   // 三带二
  | 'straight'    // 顺子（≥5 连续单牌，3..A，不含 2 与级牌）
  | 'pair_seq'    // 三连对
  | 'trio_seq'    // 钢板（二连三），可带两对
  | 'bomb'        // 炸弹（同点 ≥4 张）
  | 'flush'       // 同花顺（同花色 5 张连续）
  | 'joker_bomb'; // 天王炸（4 王）

/** 逢人配代入记录：某张万能牌被当作哪张牌使用 */
export interface WildAssign {
  cardId: number;
  asRank: Rank;
  asSuit: Suit;
}

export interface Combo {
  kind: ComboKind;
  /** 实际打出的牌 */
  cards: Card[];
  size: number;
  /** 主牌力比较值（rankOrder 后），炸弹为牌点、顺子为最大牌点 */
  keyRank: number;
  /** 序列组数：顺子=张数，连对=对数，钢板=三张组数；其余=1 */
  length: number;
  /** 三带二所带对子 / 钢板所带对子（原始 rank） */
  pairRanks: Rank[];
  /** 主 rank 原始值（非 rankOrder） */
  mainRank: Rank;
  /** 钢板/同花顺的花色（同花顺用） */
  suit?: Suit;
  wildAs: WildAssign[];
}

export interface RuleOptions {
  /**
   * 级牌模式：
   * - stage（官方《掼牌（掼蛋）竞赛规则》/江苏口径）：每副牌全场唯一级牌=台上一方（上副上游方）
   *   所打级数，共 8 张；红心级牌 ×2 为逢人配。不上台一方的级数只是自己的进度，不是级牌。
   * - both / high：旧版错误口径，仅为历史记录回放保留，不再产生新对局。
   */
  levelMode: 'stage' | 'both' | 'high';
  /** 过 A 条件：head=拿头游即可；head3=头游且同伴非末游（官方竞技口径）；double=双上游 */
  passA: 'head' | 'head3' | 'double';
  /** 三连对允许长度范围 */
  pairSeqMin: number; // 默认 3
  pairSeqMax: number; // 默认 3
  /** 钢板允许的三张组数范围 */
  trioSeqMin: number; // 默认 2
  trioSeqMax: number; // 默认 2
  /** 同花顺张数（官方 5） */
  flushLen: number;
  /** 顺子固定张数（官方 5，不可超过） */
  straightLen: number;
}

export const DEFAULT_RULES: RuleOptions = {
  levelMode: 'stage',
  passA: 'head3',
  pairSeqMin: 3,
  pairSeqMax: 3,
  trioSeqMin: 2,
  trioSeqMax: 2,
  flushLen: 5,
  /** 顺子固定张数（官方规则：五张，不可超过） */
  straightLen: 5,
};

export interface TrickPlay {
  player: number;
  combo: Combo | null; // null = 过
}

export interface GameResult {
  /** 出完牌顺序：头游、二游、三游、末游 */
  finishOrder: number[];
  winnerTeam: 0 | 1;
  /** 赢方是否双上游 */
  doubleUp: boolean;
  /** 本局结束后双方级数 */
  levelsAfter: [number, number];
  /** 本局赢方升级数 */
  upgrade: number;
  /** 是否过 A（比赛结束） */
  passedA: boolean;
}

export type EngineEvent =
  | { type: 'deal'; hands: Card[][] }
  | { type: 'play'; player: number; combo: Combo }
  | { type: 'pass'; player: number }
  | { type: 'finish'; player: number; order: number }
  | { type: 'trickEnd'; nextLeader: number }
  | { type: 'gameEnd'; result: GameResult };
