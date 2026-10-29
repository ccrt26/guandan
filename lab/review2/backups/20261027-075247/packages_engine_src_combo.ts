import {
  DEFAULT_RULES, RANK_NAME, SUIT_GLYPH,
  type Card, type Combo, type ComboKind, type Rank, type RuleOptions, type Suit, type WildAssign,
} from './types';
import { BIG_JOKER, SMALL_JOKER } from './types';
import { contiguousRuns, isJoker, rankOrder, type LevelCtx } from './rank';

/** 红心级牌 = 逢人配（万能牌） */
export function isWild(card: Card, ctx: LevelCtx): boolean {
  return card.suit === 'H' && !isJoker(card.rank) && ctx.ranks.has(card.rank);
}

export function powerClass(c: Combo): number {
  switch (c.kind) {
    case 'joker_bomb': return 5;
    case 'bomb': return c.size >= 6 ? 4 : c.size === 5 ? 2 : 1;
    case 'flush': return 3;
    default: return 0;
  }
}

/** a 是否压得过 b（b 为 null 表示领出，任何牌型可出） */
export function beats(a: Combo, b: Combo | null): boolean {
  if (!b) return true;
  const pa = powerClass(a);
  const pb = powerClass(b);
  if (pa !== pb) return pa > pb;
  if (pa === 5) return false;
  if (pa === 4) return a.size !== b.size ? a.size > b.size : a.keyRank > b.keyRank;
  if (pa >= 1) return a.keyRank > b.keyRank; // 同级炸弹 / 同花顺比主牌
  return a.kind === b.kind && a.size === b.size && a.length === b.length && a.keyRank > b.keyRank;
}

/** 牌型唯一标识（用于去重 / React key） */
export function comboKey(c: Combo): string {
  const pairs = c.pairRanks.length ? `+${c.pairRanks.map((r) => RANK_NAME[r]).join('')}` : '';
  return `${c.kind}:${c.mainRank}:${c.length}:${c.size}${pairs}`;
}

export function describeCombo(c: Combo): string {
  switch (c.kind) {
    case 'single': return `单张 ${RANK_NAME[c.mainRank]}`;
    case 'pair': return `对子 ${RANK_NAME[c.mainRank]}${RANK_NAME[c.mainRank]}`;
    case 'trio': return `三张 ${RANK_NAME[c.mainRank]}${RANK_NAME[c.mainRank]}${RANK_NAME[c.mainRank]}`;
    case 'trio_pair': return `三带二 ${RANK_NAME[c.mainRank]}³+${c.pairRanks.map((r) => RANK_NAME[r] + RANK_NAME[r]).join('')}`;
    case 'straight': return `顺子 ${describeCards(c)}`;
    case 'pair_seq': return `三连对 ${describeCards(c)}`;
    case 'trio_seq': return `钢板 ${describeCards(c)}`;
    case 'bomb': return `${c.size}张炸弹 ${RANK_NAME[c.mainRank].repeat(c.size)}`;
    case 'flush': return `同花顺 ${SUIT_GLYPH[c.suit ?? 'S']} ${describeCards(c)}`;
    case 'joker_bomb': return '天王炸 🃏🃏🃏🃏';
  }
}

export function cardLabel(card: Card): string {
  if (card.suit === 'J') return RANK_NAME[card.rank];
  return `${SUIT_GLYPH[card.suit]}${RANK_NAME[card.rank]}`;
}

export function describeCards(c: Combo): string {
  return [...c.cards]
    .map((card) => {
      const wild = c.wildAs.find((w) => w.cardId === card.id);
      return wild ? `${RANK_NAME[wild.asRank]}↩` : cardLabel(card);
    })
    .sort(byLabel)
    .join(' ');
}

function byLabel(a: string, b: string): number {
  // 展示排序：↩（配牌）放在最后
  const wa = a.includes('↩') ? 1 : 0;
  const wb = b.includes('↩') ? 1 : 0;
  return wa - wb;
}

// ---------------------------------------------------------------------------
// 手牌统计
// ---------------------------------------------------------------------------

export interface HandInfo {
  /** 非万能牌按 rank 分桶（保持手牌顺序） */
  byRank: Map<Rank, Card[]>;
  /** 万能牌（红心级牌） */
  wilds: Card[];
  /** 非万能牌按 花色×rank 分桶（同花顺用） */
  bySuit: Map<Suit, Map<Rank, Card[]>>;
}

export function analyzeHand(hand: Card[], ctx: LevelCtx): HandInfo {
  const byRank = new Map<Rank, Card[]>();
  const bySuit = new Map<Suit, Map<Rank, Card[]>>();
  const wilds: Card[] = [];
  for (const card of hand) {
    if (isWild(card, ctx)) {
      wilds.push(card);
      continue;
    }
    let bucket = byRank.get(card.rank);
    if (!bucket) byRank.set(card.rank, (bucket = []));
    bucket.push(card);
    if (card.suit !== 'J') {
      let suitMap = bySuit.get(card.suit);
      if (!suitMap) bySuit.set(card.suit, (suitMap = new Map()));
      let sBucket = suitMap.get(card.rank);
      if (!sBucket) suitMap.set(card.rank, (sBucket = []));
      sBucket.push(card);
    }
  }
  return { byRank, wilds, bySuit };
}

/** 从手牌里取 n 张 rank 为 r 的真实牌（优先真实牌，万能牌由调用方补） */
function takeReal(info: HandInfo, r: Rank, n: number): { cards: Card[]; deficit: number } {
  const have = info.byRank.get(r) ?? [];
  const take = have.slice(0, n);
  return { cards: take, deficit: n - take.length };
}

interface BuildArgs {
  kind: ComboKind;
  ctx: LevelCtx;
  /** 主体需求：rank → 张数 */
  need: Array<[Rank, number]>;
  /** 附加对子需求 */
  pairNeed?: Array<[Rank, number]>;
  mainRank: Rank;
  length: number;
  suit?: Suit;
  /** 覆写比较权重（A 作 1 的特例牌型用，1 = 小于一切正常序列） */
  keyRankOverride?: number;
}

/** 按 need 组装具体牌与万能牌代入（真实牌优先），返回 null 表示不可成型 */
function build(info: HandInfo, args: BuildArgs): { cards: Card[]; wildAs: WildAssign[] } | null {
  const cards: Card[] = [];
  const wildAs: WildAssign[] = [];
  let wildLeft = info.wilds.length;
  const wildSuitFor = (r: Rank): Suit => {
    if (r === SMALL_JOKER || r === BIG_JOKER) return 'J';
    return args.suit ?? 'S';
  };
  const fill = (r: Rank, n: number, suit?: Suit): boolean => {
    const have = suit
      ? (info.bySuit.get(suit)?.get(r) ?? [])
      : (info.byRank.get(r) ?? []);
    const take = have.slice(0, n);
    for (const c of take) cards.push(c);
    const deficit = n - take.length;
    if (deficit > wildLeft) return false;
    for (let i = 0; i < deficit; i++) {
      const wild = info.wilds[info.wilds.length - wildLeft];
      wildLeft--;
      wildAs.push({ cardId: wild.id, asRank: r, asSuit: suit ?? wildSuitFor(r) });
      cards.push(wild);
    }
    return true;
  };
  for (const [r, n] of args.need) if (!fill(r, n, args.suit)) return null;
  if (args.pairNeed) for (const [r, n] of args.pairNeed) if (!fill(r, n)) return null;
  return { cards, wildAs };
}

function mkCombo(args: BuildArgs, built: { cards: Card[]; wildAs: WildAssign[] }): Combo {
  const size = [...args.need, ...(args.pairNeed ?? [])].reduce((s, [, n]) => s + n, 0);
  return {
    kind: args.kind,
    cards: built.cards,
    size,
    keyRank: args.keyRankOverride ?? rankOrder(args.mainRank, args.ctx),
    length: args.length,
    pairRanks: (args.pairNeed ?? []).map(([r]) => r),
    mainRank: args.mainRank,
    suit: args.suit,
    wildAs: built.wildAs,
  };
}

// ---------------------------------------------------------------------------
// 枚举：给定整手牌，列出所有可出的牌型（canonical 去重）
// ---------------------------------------------------------------------------

export function enumerateCombos(hand: Card[], ctx: LevelCtx, rules: RuleOptions = DEFAULT_RULES): Combo[] {
  const info = analyzeHand(hand, ctx);
  const out: Combo[] = [];
  const seen = new Set<string>();
  const push = (c: Combo | null) => {
    if (!c) return;
    const k = comboKey(c);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };
  const w = info.wilds.length;
  const order = (r: Rank) => rankOrder(r, ctx);
  const pushBuilt = (args: BuildArgs) => {
    const b = build(info, args);
    if (b) push(mkCombo(args, b));
  };

  // --- 单张（含王）---
  for (const [r, cards] of info.byRank) {
    push(mkCombo({ kind: 'single', ctx, need: [[r, 1]], mainRank: r, length: 1 }, { cards: [cards[0]], wildAs: [] }));
  }
  if (w > 0) {
    // 万能牌当级牌单张（自身即级牌）
    for (const lr of ctx.ranks) {
      if (isJoker(lr)) continue;
      pushBuilt({ kind: 'single', ctx, need: [[lr, 1]], mainRank: lr, length: 1 });
    }
  }

  // --- 对子 / 三张（官方：对子含对大王或对小王；王不成三张）---
  const pairable = (r: Rank): number | null => {
    const c = info.byRank.get(r)?.length ?? 0;
    if (isJoker(r)) return c >= 2 ? 0 : null; // 王对：两小王或两大王
    if (c >= 2) return 0;
    if (c === 1 && w >= 1) return 1;
    if (c === 0 && w >= 2 && ctx.ranks.has(r)) return 2; // 双配凑对仅级牌（对子只需最强）
    return null;
  };
  for (const r of allNonJokerRanks(ctx)) {
    if (pairable(r) === null) continue;
    pushBuilt({ kind: 'pair', ctx, need: [[r, 2]], mainRank: r, length: 1 });
  }
  // 王对（官方：对子含对大王或对小王，牌力仅次于天王炸）
  for (const r of [SMALL_JOKER, BIG_JOKER]) {
    if ((info.byRank.get(r)?.length ?? 0) >= 2) {
      pushBuilt({ kind: 'pair', ctx, need: [[r, 2]], mainRank: r, length: 1 });
    }
  }
  for (const r of allNonJokerRanks(ctx)) {
    const c = info.byRank.get(r)?.length ?? 0;
    if (c >= 1) {
      if (c + Math.min(w, 3 - c) < 3) continue;
      pushBuilt({ kind: 'trio', ctx, need: [[r, 3]], mainRank: r, length: 1 });
    } else if (w >= 3 && ctx.ranks.has(r)) {
      // 纯万能牌凑级牌三张（双级模式可有 4 张万能牌）
      pushBuilt({ kind: 'trio', ctx, need: [[r, 3]], mainRank: r, length: 1 });
    }
  }

  // --- 三带二 ---
  for (const r of allNonJokerRanks(ctx)) {
    const c = info.byRank.get(r)?.length ?? 0;
    if (c === 0) continue;
    const trioCost = Math.max(0, 3 - c);
    if (trioCost > w) continue;
    const wLeft = w - trioCost;
    // 找最小的可带对子（真实优先、rank 升序）
    let bestS: Rank | null = null;
    let bestKey = Infinity;
    for (const s of allNonJokerRanks(ctx)) {
      if (s === r) continue;
      const cs = info.byRank.get(s)?.length ?? 0;
      let cost: number;
      if (cs >= 2) cost = 0;
      else if (cs === 1 && wLeft >= 1) cost = 1;
      else if (cs === 0 && wLeft >= 2 && ctx.ranks.has(s)) cost = 2;
      else continue;
      const key = cost * 100 + order(s);
      if (key < bestKey) {
        bestKey = key;
        bestS = s;
      }
    }
    if (bestS === null) continue;
    pushBuilt({ kind: 'trio_pair', ctx, need: [[r, 3]], pairNeed: [[bestS, 2]], mainRank: r, length: 1 });
  }

  // --- 序列牌型：顺子 / 三连对 / 钢板（位置域统一模型）---
  // 官方规则：A 可作 1（A2345 最小）也可作 K+1（10JQKA 最大）；2 参与序列（23456/223344/222333 均合法）。
  // 级牌对应位置剔除。段最大位置即比较权重：A2345=5 < 23456=6 < … < 10JQKA=14。
  const runs = posRuns(ctx);
  for (const run of runs) {
    if (rules.straightLen === 5 && run.len >= 5) {
      const L = rules.straightLen;
      for (let start = 0; start + L <= run.len; start++) {
        const from = run.from + start;
        const need: Array<[Rank, number]> = [];
        let deficit = 0;
        for (let p = from; p < from + L; p++) {
          const r = rankAtPos(p);
          need.push([r, 1]);
          deficit += Math.max(0, 1 - (info.byRank.get(r)?.length ?? 0));
        }
        if (deficit > w) continue;
        pushBuilt({ kind: 'straight', ctx, need, mainRank: rankAtPos(from + L - 1), length: L, keyRankOverride: from + L - 1 });
      }
    }
    for (let L = rules.pairSeqMin; L <= Math.min(rules.pairSeqMax, run.len); L++) {
      for (let start = 0; start + L <= run.len; start++) {
        const from = run.from + start;
        const need: Array<[Rank, number]> = [];
        let deficit = 0;
        for (let p = from; p < from + L; p++) {
          const r = rankAtPos(p);
          need.push([r, 2]);
          deficit += Math.max(0, 2 - (info.byRank.get(r)?.length ?? 0));
        }
        if (deficit > w) continue;
        pushBuilt({ kind: 'pair_seq', ctx, need, mainRank: rankAtPos(from + L - 1), length: L, keyRankOverride: from + L - 1 });
      }
    }
    for (let L = rules.trioSeqMin; L <= Math.min(rules.trioSeqMax, run.len); L++) {
      for (let start = 0; start + L <= run.len; start++) {
        const from = run.from + start;
        const need: Array<[Rank, number]> = [];
        let deficit = 0;
        for (let p = from; p < from + L; p++) {
          const r = rankAtPos(p);
          need.push([r, 3]);
          deficit += Math.max(0, 3 - (info.byRank.get(r)?.length ?? 0));
        }
        if (deficit > w) continue;
        // 钢板：仅光板（官方牌型，无带对版本）
        pushBuilt({ kind: 'trio_seq', ctx, need, mainRank: rankAtPos(from + L - 1), length: L, keyRankOverride: from + L - 1 });
      }
    }
  }

  // --- 炸弹（官方上限八炸：两副牌同点最多 8 张，万能牌补足亦不可超 8）---
  for (const r of allNonJokerRanks(ctx)) {
    const c = info.byRank.get(r)?.length ?? 0;
    const maxN = c >= 1 ? Math.min(c + w, 8) : w >= 4 && ctx.ranks.has(r) ? Math.min(w, 8) : 0;
    for (let n = 4; n <= maxN; n++) {
      pushBuilt({ kind: 'bomb', ctx, need: [[r, n]], mainRank: r, length: 1 });
    }
  }

  // --- 同花顺 ---
  for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
    const suitMap = info.bySuit.get(suit);
    if (!suitMap) continue;
    for (const run of posRuns(ctx)) {
      for (let start = 0; start + rules.flushLen <= run.len; start++) {
        const from = run.from + start;
        let deficit = 0;
        const need: Array<[Rank, number]> = [];
        for (let p = from; p < from + rules.flushLen; p++) {
          const r = rankAtPos(p);
          need.push([r, 1]);
          deficit += Math.max(0, 1 - (suitMap.get(r)?.length ?? 0));
        }
        if (deficit > w) continue;
        pushBuilt({ kind: 'flush', ctx, need, mainRank: rankAtPos(from + rules.flushLen - 1), length: rules.flushLen, suit, keyRankOverride: from + rules.flushLen - 1 });
      }
    }
  }

  // --- 天王炸 ---
  const smalls = info.byRank.get(SMALL_JOKER)?.length ?? 0;
  const bigs = info.byRank.get(BIG_JOKER)?.length ?? 0;
  if (smalls >= 2 && bigs >= 2) {
    const cards = [...(info.byRank.get(SMALL_JOKER) ?? []).slice(0, 2), ...(info.byRank.get(BIG_JOKER) ?? []).slice(0, 2)];
    out.push({
      kind: 'joker_bomb', cards, size: 4, keyRank: 99, length: 1,
      pairRanks: [], mainRank: BIG_JOKER, wildAs: [],
    });
  }

  // --- 万能牌当自然牌变体（2026-10-26 窄修复：已知漏招，CLEAN1 冻结）---
  // 主枚举按"真实牌优先"每个声明只产出一个物理实现，漏掉"万能牌按其自然点数
  // （级牌身份）编入集合、保留等量自然级牌"的合法变体（如级 5 手 ♠5♠5♥5 的
  // {♠5,♥5} 对 5）。仅对级牌纯集合（单张/对子/三张/炸弹）与三带二级牌主体补充，
  // 变体只花与该级牌同点数的万能牌（当自然=自然身份，非代入）。战略上通常劣于
  // 保留万能牌，但合法不得漏。去重键 = 声明 + 物理牌张（同声明不同物理实现共存）。
  if (w > 0) {
    const physOf = (cards: Card[]): string => cards.map((c) => c.id).sort((a, b) => a - b).join(',');
    const offered = new Set<string>();
    for (const o of out) offered.add(`${comboKey(o)}|${physOf(o.cards)}`);
    const pushVariant = (v: Combo): void => {
      const k = `${comboKey(v)}|${physOf(v.cards)}`;
      if (offered.has(k)) return;
      offered.add(k);
      out.push(v);
    };
    for (const lr of ctx.ranks) {
      if (isJoker(lr)) continue;
      const naturals = info.byRank.get(lr) ?? [];
      if (naturals.length === 0) continue; // 无自然级牌时主枚举已花万能牌补足
      const lrWilds = info.wilds.filter((wc) => wc.rank === lr); // 同点万能牌（自然身份）
      const wildAs = (j: number): WildAssign[] =>
        lrWilds.slice(0, j).map((wc) => ({ cardId: wc.id, asRank: lr, asSuit: 'S' }));
      // 纯级牌集合：单张 1 / 对子 2 / 三张 3 / 炸弹 4..8
      for (const [n, kind] of [[1, 'single'], [2, 'pair'], [3, 'trio'], [4, 'bomb'], [5, 'bomb'], [6, 'bomb'], [7, 'bomb'], [8, 'bomb']] as const) {
        if (naturals.length + w < n) continue;
        const deficit = Math.max(0, n - naturals.length);
        for (let j = deficit + 1; j <= Math.min(lrWilds.length, n); j++) {
          pushVariant({
            kind, cards: [...naturals.slice(0, n - j), ...lrWilds.slice(0, j)],
            size: n, keyRank: rankOrder(lr, ctx), length: 1,
            pairRanks: [], mainRank: lr, suit: undefined, wildAs: wildAs(j),
          });
        }
      }
      // 三带二（级牌主体）：带对全自然时同规则补主体变体（带对需花万能则不重算最优带对，跳过）
      {
        let bestS: Rank | null = null;
        let bestKey = Infinity;
        for (const s of allNonJokerRanks(ctx)) {
          if (s === lr) continue;
          if ((info.byRank.get(s)?.length ?? 0) >= 2) { // 仅 cost=0（全自然带对）
            const key = order(s);
            if (key < bestKey) { bestKey = key; bestS = s; }
          }
        }
        if (bestS !== null) {
          const deficit = Math.max(0, 3 - naturals.length);
          for (let j = deficit + 1; j <= Math.min(lrWilds.length, 3); j++) {
            const pairCards = (info.byRank.get(bestS) ?? []).slice(0, 2);
            pushVariant({
              kind: 'trio_pair', cards: [...naturals.slice(0, 3 - j), ...lrWilds.slice(0, j), ...pairCards],
              size: 5, keyRank: rankOrder(lr, ctx), length: 1,
              pairRanks: [bestS], mainRank: lr, suit: undefined, wildAs: wildAs(j),
            });
          }
        }
      }
    }
  }

  return out;
}

function allNonJokerRanks(ctx: LevelCtx): Rank[] {
  // 2..A 全部（含级牌 rank），不含王
  return Array.from({ length: 13 }, (_, i) => i + 2);
}

// ---------------------------------------------------------------------------
// 序列位置域（官方规则）：A 可作 1 也可作 K+1，2 参与序列。
// 位置 1 = A 作 1；位置 2..14 = 2..K、A。级牌位置剔除。
// 段最大位置即牌型比较权重（A2345=5 < 23456=6 < … < 10JQKA=14）。
// ---------------------------------------------------------------------------
function rankAtPos(pos: number): Rank {
  return pos === 1 ? 14 : pos;
}

function posRuns(ctx: LevelCtx): Array<{ from: number; len: number }> {
  const slots: number[] = [];
  for (let pos = 1; pos <= 14; pos++) {
    if (!ctx.ranks.has(rankAtPos(pos))) slots.push(pos);
  }
  return contiguousRuns(slots);
}

// ---------------------------------------------------------------------------
// 校验：玩家实际选牌 → 全部可能解释，选最强
// ---------------------------------------------------------------------------

/** 对玩家选中的一组牌做牌型解释；返回所有合法解释（含万能牌不同代入），已去重 */
export function classify(cards: Card[], ctx: LevelCtx, rules: RuleOptions = DEFAULT_RULES): Combo[] {
  if (cards.length === 0) return [];
  const wilds = cards.filter((c) => isWild(c, ctx));
  const reals = cards.filter((c) => !isWild(c, ctx));
  const c = new Map<Rank, number>();
  for (const card of reals) c.set(card.rank, (c.get(card.rank) ?? 0) + 1);
  const w = wilds.length;
  const out: Combo[] = [];
  const seen = new Set<string>();
  const push = (combo: Combo) => {
    const k = comboKey(combo);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(combo);
    }
  };

  /**
   * 校证一个目标牌型 need（rank→张数，非王）：
   * 每个真实牌的 rank 必须被 need 覆盖，万能牌补差额，王不可配。
   */
  const validate = (need: Map<Rank, number>, suit?: Suit): { cards: Card[]; wildAs: WildAssign[] } | null => {
    for (const [r, n] of c) {
      const nn = need.get(r) ?? 0;
      if (nn < n) return null; // 真实牌（含王）不能变 rank；王只有王对 need 覆盖
    }
    let totalNeed = 0;
    let deficit = 0;
    for (const [r, n] of need) {
      totalNeed += n;
      const usable = suit ? reals.filter((x) => x.rank === r && x.suit === suit).length : (c.get(r) ?? 0);
      deficit += Math.max(0, n - usable);
    }
    if (deficit > w) return null;
    if (totalNeed !== cards.length) return null;
    // 组装：真实牌优先同 rank；同花顺需匹配花色
    const built: Card[] = [];
    const wildAs: WildAssign[] = [];
    let wildUsed = 0;
    for (const [r, n] of need) {
      const have = suit
        ? reals.filter((x) => x.rank === r && x.suit === suit)
        : reals.filter((x) => x.rank === r);
      for (const card of have.slice(0, n)) built.push(card);
      const def = n - Math.min(have.length, n);
      for (let i = 0; i < def; i++) {
        const wild = wilds[wildUsed];
        wildUsed++;
        wildAs.push({ cardId: wild.id, asRank: r, asSuit: suit ?? 'S' });
        built.push(wild);
      }
    }
    if (built.length !== cards.length) return null;
    return { cards: built, wildAs };
  };

  const mk = (kind: ComboKind, need: Map<Rank, number>, mainRank: Rank, length: number, suit?: Suit, pairRanks: Rank[] = [], keyRankOverride?: number): void => {
    const built = validate(need, suit);
    if (!built) return;
    let size = 0;
    for (const n of need.values()) size += n;
    push({
      kind, cards: built.cards, size, keyRank: keyRankOverride ?? rankOrder(mainRank, ctx),
      length, pairRanks, mainRank, suit, wildAs: built.wildAs,
    });
  };

  const size = cards.length;

  // 天王炸
  if (size === 4 && (c.get(SMALL_JOKER) ?? 0) + (c.get(BIG_JOKER) ?? 0) === 4 && w === 0) {
    out.push({
      kind: 'joker_bomb', cards: [...reals], size: 4, keyRank: 99, length: 1,
      pairRanks: [], mainRank: BIG_JOKER, wildAs: [],
    });
    return out;
  }
  if ((c.get(SMALL_JOKER) ?? 0) + (c.get(BIG_JOKER) ?? 0) > 0) {
    // 含王的牌型：单张、王对（两小王/两大王，官方规则）、天王炸
    if (size === 1) {
      const r = cards[0].rank;
      out.push({
        kind: 'single', cards, size: 1, keyRank: rankOrder(r, ctx), length: 1,
        pairRanks: [], mainRank: r, wildAs: [],
      });
    } else if (size === 2 && cards[0].rank === cards[1].rank) {
      const r = cards[0].rank;
      out.push({
        kind: 'pair', cards, size: 2, keyRank: rankOrder(r, ctx), length: 1,
        pairRanks: [], mainRank: r, wildAs: [],
      });
    }
    return out;
  }

  // 单张
  if (size === 1) {
    if (w === 1) {
      // 万能牌单张：当作级牌本身最强
      const lr = Math.max(...[...ctx.ranks]);
      push({
        kind: 'single', cards, size: 1, keyRank: rankOrder(lr, ctx), length: 1,
        pairRanks: [], mainRank: lr, wildAs: [],
      });
    } else {
      mk('single', new Map([[cards[0].rank, 1]]), cards[0].rank, 1);
    }
    return out;
  }

  // 对子（含王对：两小王或两大王）
  if (size === 2) {
    for (const r of allNonJokerRanks(ctx)) {
      mk('pair', new Map([[r, 2]]), r, 1);
    }
    mk('pair', new Map([[SMALL_JOKER, 2]]), SMALL_JOKER, 1);
    mk('pair', new Map([[BIG_JOKER, 2]]), BIG_JOKER, 1);
    return out;
  }

  // 三张
  if (size === 3) {
    for (const r of allNonJokerRanks(ctx)) {
      mk('trio', new Map([[r, 3]]), r, 1);
    }
    return out;
  }

  // 三带二
  if (size === 5) {
    for (const r of allNonJokerRanks(ctx)) {
      for (const s of allNonJokerRanks(ctx)) {
        if (s === r) continue;
        mk('trio_pair', new Map([[r, 3], [s, 2]]), r, 1, undefined, [s]);
      }
    }
  }

  // 炸弹（4..8 张同点，八炸封顶）
  if (size >= 4 && size <= 8) {
    for (const r of allNonJokerRanks(ctx)) {
      mk('bomb', new Map([[r, size]]), r, 1);
    }
  }

  // 顺子（固定 straightLen 张，官方 5 张不可超）
  // 序列牌型（位置域统一模型：A 可作 1 也可作 K+1，2 参与序列，级牌位置剔除）
  const runs = posRuns(ctx);
  if (size === rules.straightLen) {
    for (const run of runs) {
      for (let start = 0; start + rules.straightLen <= run.len; start++) {
        const L = rules.straightLen;
        const need = new Map<Rank, number>();
        for (let p = run.from + start; p < run.from + start + L; p++) need.set(rankAtPos(p), 1);
        mk('straight', need, rankAtPos(run.from + start + L - 1), L, undefined, [], run.from + start + L - 1);
      }
    }
  }

  // 三连对
  for (const run of runs) {
    for (let L = rules.pairSeqMin; L <= Math.min(rules.pairSeqMax, run.len); L++) {
      if (size !== 2 * L) continue;
      for (let start = 0; start + L <= run.len; start++) {
        const need = new Map<Rank, number>();
        for (let p = run.from + start; p < run.from + start + L; p++) need.set(rankAtPos(p), 2);
        mk('pair_seq', need, rankAtPos(run.from + start + L - 1), L, undefined, [], run.from + start + L - 1);
      }
    }
  }

  // 钢板：仅光板（官方牌型无带对版本）
  for (const run of runs) {
    for (let L = rules.trioSeqMin; L <= Math.min(rules.trioSeqMax, run.len); L++) {
      if (size !== 3 * L) continue;
      for (let start = 0; start + L <= run.len; start++) {
        const need = new Map<Rank, number>();
        for (let p = run.from + start; p < run.from + start + L; p++) need.set(rankAtPos(p), 3);
        mk('trio_seq', need, rankAtPos(run.from + start + L - 1), L, undefined, [], run.from + start + L - 1);
      }
    }
  }

  // 同花顺
  if (size === rules.flushLen) {
    for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
      for (const run of runs) {
        for (let start = 0; start + rules.flushLen <= run.len; start++) {
          const need = new Map<Rank, number>();
          for (let p = run.from + start; p < run.from + start + rules.flushLen; p++) need.set(rankAtPos(p), 1);
          mk('flush', need, rankAtPos(run.from + start + rules.flushLen - 1), rules.flushLen, suit, [], run.from + start + rules.flushLen - 1);
        }
      }
    }
  }

  return out;
}

/** 选牌是否构成合法牌型 */
export function isValidPlay(cards: Card[], ctx: LevelCtx, rules: RuleOptions = DEFAULT_RULES): boolean {
  return classify(cards, ctx, rules).length > 0;
}

/** 给定要压的牌，返回能压过的最强解释；无则 null */
export function bestResponse(cards: Card[], toBeat: Combo | null, ctx: LevelCtx, rules: RuleOptions = DEFAULT_RULES): Combo | null {
  const all = classify(cards, ctx, rules).filter((combo) => beats(combo, toBeat));
  if (all.length === 0) return null;
  return all.reduce((best, cur) => (beats(cur, best) ? cur : best));
}

/** 从手牌中移除一手牌（按 id） */
export function removeCards(hand: Card[], combo: Combo): void {
  const ids = new Set(combo.cards.map((c) => c.id));
  for (let i = hand.length - 1; i >= 0; i--) {
    if (ids.has(hand[i].id)) hand.splice(i, 1);
  }
}

/** 手牌是否包含这手牌型的所有牌 */
export function handHasCards(hand: Card[], combo: Combo): boolean {
  const ids = new Set(hand.map((c) => c.id));
  return combo.cards.every((c) => ids.has(c.id));
}
