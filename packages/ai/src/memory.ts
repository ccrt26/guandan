import {
  BIG_JOKER, SMALL_JOKER, buildDeck,
  type Card, type Combo, type EngineEvent, type GameState, type LevelCtx, RNG,
} from '@gd/engine';

/**
 * 记牌器 + 对手行为推断。
 * 只依赖公共信息：所有已出的牌、各家剩余张数、各家对哪些牌让过。
 */
export class PlayMemory {
  /** 每个牌点已出张数（按牌的自然点数计，含万能牌本体） */
  private seen = new Map<number, number>();
  /** 已出牌的具体 id（发牌采样用） */
  seenIds = new Set<number>();
  /** 各家当前手牌张数（公共信息） */
  handCounts = [27, 27, 27, 27];
  /** 已出完的玩家 */
  finished: number[] = [];
  /**
   * 行为推断：passBounds[p][kind] = 该玩家曾对某同型牌让过的最大 keyRank。
   * 若对更高 rank 让过，则大概率压不过更低 rank 的同型牌。
   */
  private passBounds = new Map<number, Map<string, number>>();

  constructor(public ctx: LevelCtx) {}

  static fromStart(ctx: LevelCtx): PlayMemory {
    return new PlayMemory(ctx);
  }

  /** 从对局状态同步公共信息（每步调用） */
  syncState(state: GameState): void {
    for (let p = 0; p < 4; p++) this.handCounts[p] = state.hands[p].length;
    this.finished = [...state.finished];
  }

  observeEvents(events: EngineEvent[], toBeat: Combo | null): void {
    for (const ev of events) {
      if (ev.type === 'play') this.recordPlay(ev.player, ev.combo);
      else if (ev.type === 'pass') this.recordPass(ev.player, toBeat);
    }
  }

  recordPlay(player: number, combo: Combo): void {
    for (const card of combo.cards) {
      this.seen.set(card.rank, (this.seen.get(card.rank) ?? 0) + 1);
      this.seenIds.add(card.id);
    }
    this.handCounts[player] -= combo.size;
  }

  recordPass(player: number, toBeat: Combo | null): void {
    if (!toBeat || toBeat.kind === 'bomb' || toBeat.kind === 'flush' || toBeat.kind === 'joker_bomb') return;
    const bound = this.passBounds.get(player) ?? new Map<string, number>();
    const prev = bound.get(toBeat.kind) ?? -1;
    if (toBeat.keyRank > prev) bound.set(toBeat.kind, toBeat.keyRank);
    this.passBounds.set(player, bound);
  }

  /** 推断：player 是否大概率压不过 combo（曾对同型更高牌让过） */
  likelyCannotBeat(player: number, combo: Combo): boolean {
    if (combo.kind === 'bomb' || combo.kind === 'flush' || combo.kind === 'joker_bomb') return false;
    const bound = this.passBounds.get(player)?.get(combo.kind);
    return bound !== undefined && bound >= combo.keyRank;
  }

  /** 某牌点全副剩余（普通牌 8 张，王各 2 张） */
  remainingOfRank(rank: number): number {
    const total = rank === SMALL_JOKER || rank === BIG_JOKER ? 2 : 8;
    return Math.max(0, total - (this.seen.get(rank) ?? 0));
  }

  jokersRemaining(): number {
    return this.remainingOfRank(SMALL_JOKER) + this.remainingOfRank(BIG_JOKER);
  }

  /** 除我之外，场上潜在的炸弹数（同点剩余 ≥4） */
  bombsRemaining(myHand: Card[]): number {
    const myRanks = new Set(myHand.map((c) => c.rank));
    let count = 0;
    for (let r = 2; r <= 14; r++) {
      if (myRanks.has(r)) continue;
      if (this.remainingOfRank(r) >= 4) count += 1;
    }
    return count;
  }

  /**
   * 蒙特卡洛发牌：把「我未见过的牌」随机分给其他活人（rollout 用，保证 AI 不作弊）。
   * knownHands 传入时直接使用（复盘反事实：真实手牌已知）。
   */
  sampleHiddenHands(
    mySeat: number,
    myHand: Card[],
    rng: RNG,
    knownHands?: Card[][],
  ): Card[][] {
    if (knownHands) return knownHands.map((h) => [...h]);
    const known = new Set<number>(myHand.map((c) => c.id));
    const pool = rng.shuffle(buildDeck().filter((c) => !known.has(c.id) && !this.seenIds.has(c.id)));
    const hands: Card[][] = [[], [], [], []];
    hands[mySeat] = [...myHand];
    let idx = 0;
    for (let p = 0; p < 4; p++) {
      if (p === mySeat || this.finished.includes(p)) continue;
      for (let i = 0; i < this.handCounts[p]; i++) {
        hands[p].push(pool[idx++]);
      }
    }
    return hands;
  }
}
