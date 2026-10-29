import { buildDeck, isReturnableCard, makeLevelCtx, type Card, type GameState, type MatchState } from '@gd/engine';

export interface ExchangeTransfer { from: number; to: number; card: Readonly<Card> }
export interface ExchangeResult {
  readonly pairs: readonly { readonly tribute: Readonly<ExchangeTransfer>; readonly ret: Readonly<ExchangeTransfer> }[];
  readonly leader: number;
  /** 独立于 UI 通知次数：本地比赛身份＋局号＋真实结果内容。 */
  readonly version: string;
  readonly gameNo: number;
}
export interface ExchangeHistoryEntry extends ExchangeResult { readonly confirmedAt: number | null }
export type InitialGameSnapshot = Omit<GameState, 'match' | 'ctx'>;

export const copyJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function freezeExchange<T extends ExchangeResult>(result: T): T {
  for (const pair of result.pairs) {
    Object.freeze(pair.tribute.card); Object.freeze(pair.ret.card);
    Object.freeze(pair.tribute); Object.freeze(pair.ret); Object.freeze(pair);
  }
  Object.freeze(result.pairs);
  return Object.freeze(result);
}

const deck = buildDeck();
const seatOK = (seat: number) => Number.isInteger(seat) && seat >= 0 && seat < 4;
const cardOK = (card: Card) => card && Number.isInteger(card.id)
  && deck[card.id]?.suit === card.suit && deck[card.id]?.rank === card.rank;

/** 对实体牌核验；两副相同牌面可以同时存在，只有相同 id 的重复归属不合法。 */
export function validateInitialHands(state: GameState): void {
  if (!Array.isArray(state.hands) || state.hands.length !== 4
    || state.hands.some((hand) => !Array.isArray(hand) || hand.length !== 27)) {
    throw new Error('交换后的各家手牌张数不一致');
  }
  const cards = state.hands.flat();
  if (cards.some((card) => !cardOK(card)) || new Set(cards.map((card) => card.id)).size !== 108) {
    throw new Error('交换后的实体牌缺失、重复或牌面不一致');
  }
}

/** 校验已提交引擎结果；不推导贡牌，不补造缺失还牌，也不重新执行交换。 */
export function readExchange(state: GameState, matchId: string): ExchangeResult | null {
  const tribute = state.tribute;
  if (!tribute || tribute.resist || state.pendingReturns.length > 0) return null;
  validateInitialHands(state);
  const count = tribute.tributes.length;
  if ((count !== 1 && count !== 2) || tribute.returns.length !== count) throw new Error('进贡与还贡记录不完整');
  if (!seatOK(tribute.leader) || tribute.leader !== state.leader || state.turn !== tribute.leader) {
    throw new Error('交换结果与本局首出者不一致');
  }
  const giverSeats = new Set<number>();
  const receiverSeats = new Set<number>();
  const assigned = new Map<number, number>();
  const transferIds = new Set<number>();
  const pairs = tribute.tributes.map((tr) => {
    if (!seatOK(tr.from) || !seatOK(tr.to) || tr.from === tr.to || !cardOK(tr.card)
      || giverSeats.has(tr.from) || receiverSeats.has(tr.to) || transferIds.has(tr.card.id)) {
      throw new Error('进贡方向或实体牌重复分配');
    }
    giverSeats.add(tr.from); receiverSeats.add(tr.to); transferIds.add(tr.card.id);
    const returns = tribute.returns.filter((ret) => ret.from === tr.to && ret.to === tr.from);
    if (returns.length !== 1 || !cardOK(returns[0].card) || !isReturnableCard(returns[0].card, state.ctx)) {
      throw new Error('还贡记录缺失、方向错误或牌张无效');
    }
    const ret = returns[0];
    // 同一张可还贡牌原路退回是引擎允许的流转；跨组重复分配才是异常。
    if (ret.card.id !== tr.card.id && transferIds.has(ret.card.id)) throw new Error('还贡实体牌重复分配');
    transferIds.add(ret.card.id);
    assigned.set(tr.card.id, tr.to); assigned.set(ret.card.id, ret.to);
    return { tribute: copyJson(tr), ret: copyJson(ret) };
  });
  if ([...giverSeats].some((seat) => receiverSeats.has(seat))) throw new Error('进贡与收贡席位关系不一致');
  for (const [id, owner] of assigned) {
    if (!state.hands[owner].some((card) => card.id === id)) throw new Error('交换记录与交换后手牌归属不一致');
  }
  const content = { pairs, leader: tribute.leader };
  return freezeExchange({ ...content, gameNo: state.match.gameNo,
    version: `${matchId}/${state.match.gameNo}/${JSON.stringify(content)}` });
}

export function snapshotInitialGame(state: GameState): InitialGameSnapshot {
  const { match: _match, ctx: _ctx, ...snapshot } = state;
  return copyJson(snapshot);
}

export function restoreInitialGame(snapshot: InitialGameSnapshot, match: MatchState): GameState {
  const state: GameState = {
    ...copyJson(snapshot), match,
    ctx: match.opts.levelMode === 'stage'
      ? makeLevelCtx(snapshot.levelsBefore, 'stage', snapshot.stageTeam)
      : makeLevelCtx(snapshot.levelsBefore, match.opts.levelMode),
  };
  validateInitialHands(state);
  if (state.moveNo !== 0 || state.over || state.lastCombo !== null || state.pendingReturns.length !== 0
    || !seatOK(state.turn) || state.turn !== state.leader || state.finished.length !== 0) {
    throw new Error('本地续局起点无效');
  }
  return state;
}
