import type { Card, Combo, EngineEvent, GameResult, RuleOptions, TrickPlay } from './types';
import { BIG_JOKER, RANK_A } from './types';
import { deal, dealInitialHands } from './deck';
import { RNG, randomSeed } from './rng';
import { beats, enumerateCombos, removeCards } from './combo';
import { makeLevelCtx, rankOrder, type LevelCtx } from './rank';

export const TEAM_OF: readonly [0, 1, 0, 1] = [0, 1, 0, 1];
export function teamOf(player: number): 0 | 1 {
  return TEAM_OF[player & 3] as 0 | 1;
}
export function teammateOf(player: number): number {
  return (player + 2) & 3;
}

export interface MatchState {
  opts: RuleOptions;
  /** 双方当前级数（2..14，14=A） */
  levels: [number, number];
  gameNo: number;
  /** 过 A 获胜的队伍 */
  winner: 0 | 1 | null;
  rngState: number;
  /** 上一局头游（下局先出），null = 首局 */
  lastHead: number | null;
  /** 上一局结果（进贡还贡判定用） */
  lastResult: GameResult | null;
}

export function createMatch(opts: RuleOptions, seed = randomSeed()): MatchState {
  return { opts, levels: [2, 2], gameNo: 0, winner: null, rngState: seed, lastHead: null, lastResult: null };
}

export interface GameState {
  match: MatchState;
  ctx: LevelCtx;
  /** 本局起始级数（结算用） */
  levelsBefore: [number, number];
  /** 本局台上的一方（其级数为本局唯一级牌）；首局双方均打 2，取 0 */
  stageTeam: 0 | 1;
  hands: Card[][];
  turn: number;
  /** 本轮首个出牌者 */
  leader: number;
  /** 当前需要压制的牌（null = 领出） */
  lastCombo: Combo | null;
  lastPlayer: number;
  passCount: number;
  trickPlays: TrickPlay[];
  /** 出完牌的顺序 */
  finished: number[];
  over: boolean;
  result: GameResult | null;
  moveNo: number;
  /** 本局进贡还贡记录（首局为 null） */
  tribute: TributeInfo | null;
  /** 待还贡席位（非空 = 还贡阶段，turn=待还方，不得出牌）；还贡完成后清空 */
  pendingReturns: PendingReturn[];
}

/** 进贡还贡记录（官方规则，供 UI 展示与复盘） */
export interface TributeInfo {
  /** 是否抗贡 */
  resist: boolean;
  /** 进贡流转：from 贡给 to 一张 card */
  tributes: Array<{ from: number; to: number; card: Card }>;
  /** 还贡流转（含还贡阶段逐步完成的） */
  returns: Array<{ from: number; to: number; card: Card }>;
  /** 本局首出者 */
  leader: number;
}

/** 一笔待还的贡牌：from 须任选一张不大于 10 的牌还给 to */
export interface PendingReturn {
  from: number;
  to: number;
}

/** 台上一方 = 上副上游所在队（官方：每副牌全场唯一级牌＝台上那方所打级数）；首局双方都在 2，取 0 */
export function stageTeamOf(match: MatchState): 0 | 1 {
  return match.lastResult ? teamOf(match.lastResult.finishOrder[0]) : 0;
}

export function startGame(match: MatchState, interactiveSeats: readonly number[] = [], initialIds?: readonly (readonly number[])[]): GameState {
  const rng = new RNG(match.rngState);
  const hands = initialIds === undefined ? deal(rng) : dealInitialHands(initialIds);
  match.rngState = rng.state;
  const leader = match.lastHead ?? rng.int(4);
  match.gameNo += 1;
  const levelsBefore: [number, number] = [match.levels[0], match.levels[1]];
  const stageTeam = stageTeamOf(match);
  const ctx = match.opts.levelMode === 'stage'
    ? makeLevelCtx(levelsBefore, 'stage', stageTeam)
    : makeLevelCtx(levelsBefore, match.opts.levelMode);
  const state: GameState = {
    match,
    ctx,
    levelsBefore,
    stageTeam,
    hands,
    turn: leader,
    leader,
    lastCombo: null,
    lastPlayer: leader,
    passCount: 0,
    trickPlays: [],
    finished: [],
    over: false,
    result: null,
    moveNo: 0,
    tribute: null,
    pendingReturns: [],
  };
  // 官方进贡还贡（第二副起），首出权随之确定；interactiveSeats 中的还贡挂起，交还牌方自选
  const tribute = applyTribute(state, interactiveSeats);
  if (tribute) {
    state.tribute = tribute;
    state.turn = state.pendingReturns.length > 0 ? state.pendingReturns[0].from : tribute.leader;
    state.leader = tribute.leader;
    state.lastPlayer = tribute.leader;
  }
  return state;
}

/**
 * 官方进贡还贡流程（从第二副起）：
 * - 下游方进贡：单贡=末游贡上游；双贡=三游/末游各贡手中最大牌（红心级牌不贡），
 *   较大者给上游、较小者给二游（同点按 finishOrder 顺序）
 * - 收贡方各还一张牌（官方：任选、牌点不得超过 10）
 * - 抗贡：下游方两人合计抓有两大王 → 免贡，上游先出
 * - 首出：单贡=末游先出；双贡=贡牌较大者先出；抗贡=上游先出
 *
 * 还贡是还牌方的自由选择：interactiveSeats 中的收贡方不自动还，
 * 记入 state.pendingReturns，由 completeReturn 逐笔提交；
 * 其余席位按 pickReturnCard 口径当场自动还。
 */
export function applyTribute(state: GameState, interactiveSeats: readonly number[] = []): TributeInfo | null {
  const match = state.match;
  const last = match.lastResult;
  if (!last) return null; // 首局无进贡
  const order = last.finishOrder;
  const head = order[0];
  const second = order[1];
  const third = order[2];
  const lastFin = order[3];
  const loserTeam = teamOf(lastFin);
  const doubleTribute = teamOf(third) === loserTeam;
  const givers = doubleTribute ? [third, lastFin] : [lastFin];

  // 抗贡：下游方合计持有两张大王
  const bigJokers = givers.reduce(
    (s, p) => s + state.hands[p].filter((c) => c.rank === BIG_JOKER).length, 0,
  );
  if (bigJokers >= 2) {
    return { resist: true, tributes: [], returns: [], leader: head };
  }

  const pickTribute = (p: number): Card => {
    const order2 = (r: number) => rankOrder(r, state.ctx);
    const cands = state.hands[p].filter((c) => !isWildCard(c, state.ctx));
    return cands.reduce((best, cur) => (order2(cur.rank) > order2(best.rank) ? cur : best));
  };
  const moveCard = (from: number, to: number, card: Card): void => {
    const h = state.hands[from];
    h.splice(h.findIndex((c) => c.id === card.id), 1);
    state.hands[to].push(card);
  };

  const tributes: TributeInfo['tributes'] = [];
  const returns: TributeInfo['returns'] = [];
  const owed: PendingReturn[] = [];
  let leader: number;

  if (!doubleTribute) {
    const card = pickTribute(lastFin);
    moveCard(lastFin, head, card);
    tributes.push({ from: lastFin, to: head, card });
    owed.push({ from: head, to: lastFin });
    leader = lastFin; // 末游先出
  } else {
    const cThird = pickTribute(third);
    const cLast = pickTribute(lastFin);
    const oThird = rankOrder(cThird.rank, state.ctx);
    const oLast = rankOrder(cLast.rank, state.ctx);
    // 较大者给上游、较小者给二游；同点按 finishOrder（三游大）
    const thirdToHead = oThird > oLast;
    moveCard(third, thirdToHead ? head : second, cThird);
    moveCard(lastFin, thirdToHead ? second : head, cLast);
    tributes.push({ from: third, to: thirdToHead ? head : second, card: cThird });
    tributes.push({ from: lastFin, to: thirdToHead ? second : head, card: cLast });
    owed.push({ from: head, to: thirdToHead ? third : lastFin });
    owed.push({ from: second, to: thirdToHead ? lastFin : third });
    leader = thirdToHead ? third : lastFin; // 贡大牌者先出
  }

  for (const r of owed) {
    if (interactiveSeats.includes(r.from)) {
      state.pendingReturns.push(r);
    } else {
      const back = pickReturnCard(state, r.from);
      moveCard(r.from, r.to, back);
      returns.push({ from: r.from, to: r.to, card: back });
    }
  }
  return { resist: false, tributes, returns, leader };
}

/** 还贡合法性（官方：还牌任选、牌点不得超过 10；红心级牌=万能牌不还） */
export function isReturnableCard(card: Card, ctx: LevelCtx): boolean {
  return card.rank >= 2 && card.rank <= 10 && !isWildCard(card, ctx);
}

/** 还贡自动选牌（AI 席位口径）：可还的牌里"牌力最不要紧"的一张
 * ——按本局牌力序取最小（级牌/大牌自动避开）；极端无牌可还时退回任意非万能最小单张。 */
export function pickReturnCard(state: GameState, seat: number): Card {
  const hand = state.hands[seat];
  const nonWild = hand.filter((c) => !isWildCard(c, state.ctx));
  const pool = nonWild.filter((c) => isReturnableCard(c, state.ctx));
  const cands = pool.length > 0 ? pool : nonWild;
  if (cands.length === 0) throw new Error('还贡方手中无牌可还');
  return cands.reduce((best, cur) => (rankOrder(cur.rank, state.ctx) < rankOrder(best.rank, state.ctx) ? cur : best));
}

/** 还贡阶段提交一笔还牌（人类自选入口；AI 已在 applyTribute 内自动还）。
 * 仍有人未还则轮到下一位，否则 turn 归位本局首出者。 */
export function completeReturn(state: GameState, card: Card): void {
  const pending = state.pendingReturns[0];
  if (!pending || !state.tribute) throw new Error('当前没有待还的贡牌');
  const hand = state.hands[pending.from];
  if (!hand.some((c) => c.id === card.id)) throw new Error('还贡的牌不在还牌方手中');
  if (!isReturnableCard(card, state.ctx)) throw new Error('还贡必须是不大于 10 的非万能牌');
  hand.splice(hand.findIndex((c) => c.id === card.id), 1);
  state.hands[pending.to].push(card);
  state.tribute.returns.push({ from: pending.from, to: pending.to, card });
  state.pendingReturns.shift();
  state.turn = state.pendingReturns.length > 0 ? state.pendingReturns[0].from : state.tribute.leader;
}

function isWildCard(card: Card, ctx: LevelCtx): boolean {
  return card.suit === 'H' && ctx.ranks.has(card.rank) && card.rank < 15;
}

export type Move = { pass: true } | { pass: false; combo: Combo };

/** 当前玩家全部合法动作（不含 Pass） */
export function legalCombos(state: GameState): Combo[] {
  const hand = state.hands[state.turn];
  const all = enumerateCombos(hand, state.ctx, state.match.opts);
  if (!state.lastCombo) return all;
  return all.filter((c) => beats(c, state.lastCombo));
}

/** 是否可以 Pass（领出必须出牌） */
export function canPass(state: GameState): boolean {
  return state.lastCombo !== null;
}

function nextAlive(state: GameState, from: number): number {
  for (let i = 1; i <= 4; i++) {
    const p = (from + i) & 3;
    if (!state.finished.includes(p)) return p;
  }
  return from;
}

export function cloneState(state: GameState): GameState {
  return structuredClone({ ...state, match: { ...state.match } });
}

/** 应用一步（出牌或过），返回触发的事件序列 */
export function applyMove(state: GameState, move: Move): EngineEvent[] {
  if (state.over) return [];
  const events: EngineEvent[] = [];
  const player = state.turn;
  state.moveNo += 1;

  if (move.pass) {
    if (!state.lastCombo) throw new Error('领出不能 Pass');
    state.trickPlays.push({ player, combo: null });
    state.passCount += 1;
    events.push({ type: 'pass', player });
    // 其余活人全部让过 → 本轮结束（官方：上游出完且无人接时由对家领出；对家已走则下家）
    const aliveCount = 4 - state.finished.length;
    const needPasses = state.finished.includes(state.lastPlayer) ? aliveCount : aliveCount - 1;
    if (state.passCount >= needPasses) {
      let nextLeader: number;
      if (!state.finished.includes(state.lastPlayer)) {
        nextLeader = state.lastPlayer;
      } else {
        const mate = teammateOf(state.lastPlayer);
        nextLeader = state.finished.includes(mate) ? nextAlive(state, state.lastPlayer) : mate;
      }
      state.trickPlays = [];
      state.leader = nextLeader;
      state.lastCombo = null;
      state.lastPlayer = nextLeader;
      state.passCount = 0;
      state.turn = nextLeader;
      events.push({ type: 'trickEnd', nextLeader });
    } else {
      state.turn = nextAlive(state, player);
    }
    return events;
  }

  const combo = move.combo;
  if (state.lastCombo && !beats(combo, state.lastCombo)) {
    throw new Error(`无法压过：${combo.kind} ${combo.mainRank}`);
  }
  removeCards(state.hands[player], combo);
  state.trickPlays.push({ player, combo });
  state.lastCombo = combo;
  state.lastPlayer = player;
  state.passCount = 0;
  events.push({ type: 'play', player, combo });

  if (state.hands[player].length === 0) {
    state.finished.push(player);
    events.push({ type: 'finish', player, order: state.finished.length });
    if (state.finished.length === 3) {
      const result = settle(state);
      state.over = true;
      state.result = result;
      events.push({ type: 'gameEnd', result });
      return events;
    }
  }
  state.turn = nextAlive(state, player);
  return events;
}

/** 一局结算：名次、升级、过 A（纯函数，便于单测与复盘复算） */
export function computeResult(
  finishOrder: number[],
  levelsBefore: [number, number],
  opts: RuleOptions,
): GameResult {
  const head = finishOrder[0];
  const winnerTeam = teamOf(head);
  const doubleUp = teamOf(finishOrder[1]) === winnerTeam;
  const thirdIsWinnerTeam = teamOf(finishOrder[2]) === winnerTeam;

  // 升级数：双上游 3；头游+三游 2；头游+末游 1
  const upgrade = doubleUp ? 3 : thirdIsWinnerTeam ? 2 : 1;

  // 过 A 判定：赢方当前打 A 且满足过 A 条件
  const levels: [number, number] = [levelsBefore[0], levelsBefore[1]];
  const atA = levels[winnerTeam] === RANK_A;
  let passOK = true;
  if (opts.passA === 'double') passOK = doubleUp;
  else if (opts.passA === 'head3') passOK = doubleUp || thirdIsWinnerTeam;
  const passedA = atA && passOK;

  if (!passedA) {
    levels[winnerTeam] = Math.min(RANK_A, levels[winnerTeam] + upgrade);
  }
  return {
    finishOrder,
    winnerTeam,
    doubleUp,
    levelsAfter: levels,
    upgrade,
    passedA,
  };
}

function settle(state: GameState): GameResult {
  const lastPlayer = [0, 1, 2, 3].find((p) => !state.finished.includes(p))!;
  const finishOrder = [...state.finished, lastPlayer];
  const result = computeResult(finishOrder, state.levelsBefore, state.match.opts);
  if (result.passedA) {
    state.match.winner = result.winnerTeam;
  }
  state.match.levels = [...result.levelsAfter] as [number, number];
  state.match.lastHead = finishOrder[0];
  state.match.lastResult = result;
  return result;
}

/** 排序工具：给 UI 的手牌排序（按本局牌力） */
export function sortedHandCopy(hand: Card[], ctx: LevelCtx): Card[] {
  return [...hand].sort((a, b) => rankOrder(a.rank, ctx) - rankOrder(b.rank, ctx) || a.suit.localeCompare(b.suit));
}
