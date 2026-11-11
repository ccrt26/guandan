/** Public-only projection. Complete current-game history is a mandatory input;
 * GameState/trickPlays alone cannot reconstruct it. No full-state serialization. */
import { buildDeck, makeLevelCtx, stageTeamOf, teammateOf, type Card, type Combo, type GameResult, type GameState, type RuleOptions, type EngineEvent } from '@gd/engine';
import { necessaryDeclarationKey } from './legality';
import { OBSERVATION_SCHEMA, DecisionHaltedError, faceCounts, freezeCopy, halt, publicCombo, type FaceCount, type Observation, type PublicEvent, type PublicHistoryPrefix, type PublicTransfer } from './protocol';

import { buildPublicHighCardMemory, type PublicHighCardMemory } from '../nn/publicMemory';

export function assertActiveActor(state: GameState, actorSeat: number): void {
  if (!Number.isInteger(actorSeat) || actorSeat < 0 || actorSeat > 3 || actorSeat !== state.turn) halt('actor must equal active turn');
  if (state.over || state.result !== null || state.match.winner !== null || state.pendingReturns.length) halt('observation requires active play after returns');
  if (state.finished.includes(actorSeat) || state.hands.length !== 4 || state.hands[actorSeat].length === 0) halt('active actor has no hand');
  if (!Number.isSafeInteger(state.moveNo) || state.moveNo < 0 || !Number.isSafeInteger(state.match.gameNo) || state.match.gameNo < 1) halt('invalid game/move identity');
}
function seat(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 3) halt('invalid public seat');
  return value;
}
function rulesCopy(r: RuleOptions): RuleOptions {
  if (!['stage', 'both', 'high'].includes(r.levelMode) || !['head', 'head3', 'double'].includes(r.passA)) halt('invalid rule options');
  const out = { levelMode: r.levelMode, passA: r.passA, pairSeqMin: r.pairSeqMin, pairSeqMax: r.pairSeqMax,
    trioSeqMin: r.trioSeqMin, trioSeqMax: r.trioSeqMax, flushLen: r.flushLen, straightLen: r.straightLen };
  for (const n of [out.pairSeqMin, out.pairSeqMax, out.trioSeqMin, out.trioSeqMax, out.flushLen, out.straightLen]) {
    if (!Number.isSafeInteger(n) || n < 1) halt('invalid rule length');
  }
  if (out.pairSeqMin > out.pairSeqMax || out.trioSeqMin > out.trioSeqMax) halt('invalid rule range');
  return out;
}
import { describeRules } from '../../../engine/src/rules-text.mjs';
export { RULES_TEXT_VERSION, describeRules } from '../../../engine/src/rules-text.mjs';

function resultCopy(r: GameResult | null): GameResult | null {
  if (r === null) return null;
  if (r.passedA) halt('previous game already ended match');
  return { finishOrder: r.finishOrder.map(seat), winnerTeam: r.winnerTeam, doubleUp: r.doubleUp,
    levelsAfter: [r.levelsAfter[0], r.levelsAfter[1]], upgrade: r.upgrade, passedA: r.passedA };
}
const faceKey = (c: Pick<Card, 'suit' | 'rank'>) => `${c.suit}:${c.rank}`;
function transferCopy(t: { from: number; to: number; card: Card }): PublicTransfer {
  if (t.from === t.to) halt('public transfer to same seat');
  return { from: seat(t.from), to: seat(t.to), card: { suit: t.card.suit, rank: t.card.rank } };
}
export interface ObservationInput {
  state: GameState;
  actorSeat: number;
  decisionId: string;
  matchId: string;
  history: PublicHistoryPrefix;
}
export function buildObservation(input: ObservationInput): Observation {
  try { return projectObservation(input); }
  catch (error) {
    if (error instanceof DecisionHaltedError) throw error;
    halt(`public observation/state conflict: ${String(error)}`);
  }
}
/** Explicit new opt-in envelope; never add memory keys to the strict historical
 * ohuo-public-observation-v1 wire object. S33/S35 must select this new contract.
 * The memory sees only the validated public projection, never the input state. */
export interface ObservationWithPublicMemory {
  readonly schema: 'ohuo-public-observation-memory-v1';
  readonly observation: Observation;
  readonly publicHighCardMemory: PublicHighCardMemory;
}
export function buildObservationWithPublicMemory(input: ObservationInput): ObservationWithPublicMemory {
  const observation = buildObservation(input);
  const { matchId, gameNo, moveNo, publicPrefix, effectiveLevelRanks } = observation;
  const publicHighCardMemory = buildPublicHighCardMemory(
    { matchId, gameNo, throughMoveNo: moveNo, steps: publicPrefix },
    { matchId, gameNo }, effectiveLevelRanks);
  return Object.freeze({ schema: 'ohuo-public-observation-memory-v1', observation, publicHighCardMemory });
}

function projectObservation({ state, actorSeat, decisionId, matchId, history }: ObservationInput): Observation {
  assertActiveActor(state, actorSeat);
  if (typeof decisionId !== 'string' || !decisionId.trim() || typeof matchId !== 'string' || !matchId.trim()) halt('decision/match identity required');
  if (!history || history.matchId !== matchId || history.gameNo !== state.match.gameNo || history.throughMoveNo !== state.moveNo || !Array.isArray(history.steps)) halt('complete current-game history identity/prefix required');
  const ruleOptions = rulesCopy(state.match.opts);
  if (state.stageTeam !== stageTeamOf(state.match) || JSON.stringify(state.match.levels) !== JSON.stringify(state.levelsBefore)) halt('public stage/level context inconsistent');
  const expected = makeLevelCtx(state.levelsBefore, ruleOptions.levelMode as 'stage', state.stageTeam);
  if (!(state.ctx.ranks instanceof Set) || JSON.stringify([...state.ctx.ranks].sort((a, b) => a - b)) !== JSON.stringify([...expected.ranks].sort((a, b) => a - b)) || JSON.stringify(state.ctx.levels) !== JSON.stringify(state.levelsBefore)) halt('effective level context inconsistent');
  const faces = faceCounts(buildDeck());
  const capacity = new Map(faces.map(c => [faceKey(c), c.count]));
  const own = faceCounts(state.hands[actorSeat]);
  const played: Card[] = [], playedIds = new Set<number>();
  const playedBySeat = [0, 0, 0, 0];
  const finished: number[] = [];
  let target: Combo | null = null, moves = 0, passes = 0;
  let expectedActor: number | null = state.tribute?.leader ?? null;
  let leader = state.tribute?.leader ?? state.leader;
  let lastPlayer = leader;
  const currentTrick: Observation['currentTrick'] = [];
  const publicPrefix: Observation['publicPrefix'] = [];
  for (const row of history.steps) {
    if (!row || !Array.isArray(row.events)) halt('invalid public history row');
    const actions = row.events.filter((e: EngineEvent) => e.type === 'play' || e.type === 'pass');
    if (actions.length !== 1) halt('history row requires one engine action');
    const action = actions[0];
    if (expectedActor !== null && action.player !== expectedActor) halt('history actor turn mismatch');
    if (moves === 0 && state.tribute === null) { leader = action.player; lastPlayer = leader; }
    if (necessaryDeclarationKey(row.priorTarget, state.ctx) !== necessaryDeclarationKey(target, state.ctx)) halt('history prior target mismatch');
    const events: PublicEvent[] = [];
    let actionSeen = false;
    for (const e of row.events) {
      switch (e.type) {
        case 'deal': break; // Explicitly discard ALL four hands, not a spread.
        case 'play': {
          if (actionSeen || finished.includes(seat(e.player))) halt('invalid history action');
          actionSeen = true;
          for (const c of e.combo.cards) {
            if (playedIds.has(c.id)) halt('history repeats a played physical resource');
            playedIds.add(c.id); played.push({ id: c.id, suit: c.suit, rank: c.rank });
          }
          if (!e.combo.cards.length || e.combo.size !== e.combo.cards.length) halt('history play size mismatch');
          playedBySeat[e.player] += e.combo.cards.length;
          target = e.combo; lastPlayer = e.player; passes = 0;
          const combo = publicCombo(e.combo)!;
          events.push({ type: 'play', player: e.player, combo });
          currentTrick.push({ player: e.player, combo });
          break;
        }
        case 'pass':
          if (actionSeen || target === null || finished.includes(seat(e.player))) halt('invalid history pass');
          actionSeen = true; passes++;
          events.push({ type: 'pass', player: e.player }); currentTrick.push({ player: e.player, combo: null });
          break;
        case 'finish':
          if (!actionSeen || action.type !== 'play' || e.player !== action.player || finished.includes(seat(e.player)) || e.order !== finished.length + 1) halt('history finish mismatch');
          finished.push(e.player); events.push({ type: 'finish', player: e.player, order: e.order }); break;
        case 'trickEnd':
          if (!actionSeen || action.type !== 'pass') halt('history trick-end mismatch');
          leader = seat(e.nextLeader); lastPlayer = leader; target = null; passes = 0; currentTrick.length = 0;
          events.push({ type: 'trickEnd', nextLeader: leader }); break;
        case 'gameEnd': halt('terminal/future result in active-game history');
        default: halt('unknown public history event');
      }
    }
    const ended = events.find(e => e.type === 'trickEnd');
    expectedActor = ended?.type === 'trickEnd' ? ended.nextLeader : (action.player + 1) % 4;
    if (!ended) for (let i = 0; i < 4 && finished.includes(expectedActor); i++) expectedActor = (expectedActor + 1) % 4;
    moves++;
    publicPrefix.push({ moveNo: moves, priorTarget: publicCombo(row.priorTarget), events });
  }
  if (moves !== state.moveNo || moves !== history.throughMoveNo) halt('complete causal history prefix missing or includes future moves');
  if (JSON.stringify(finished) !== JSON.stringify(state.finished) || state.hands.some((h, s) => h.length !== 27 - playedBySeat[s])) halt('history/public remaining counts mismatch');
  if (necessaryDeclarationKey(target, state.ctx) !== necessaryDeclarationKey(state.lastCombo, state.ctx) || leader !== state.leader || lastPlayer !== state.lastPlayer || passes !== state.passCount || JSON.stringify(currentTrick) !== JSON.stringify(state.trickPlays.map(t => ({ player: t.player, combo: publicCombo(t.combo) })))) halt('history/current public state mismatch');
  if (expectedActor !== null && expectedActor !== actorSeat) halt('history does not end before current actor turn');
  if ([0, 1, 2, 3].some(s => (playedBySeat[s] === 27) !== finished.includes(s))) halt('history finish/remaining count mismatch');
  const tribute = state.tribute === null ? null : {
    resist: state.tribute.resist, tributes: state.tribute.tributes.map(transferCopy),
    returns: state.tribute.returns.map(transferCopy), leader: seat(state.tribute.leader),
  };
  const known = Array.from({ length: 4 }, () => new Map<string, FaceCount>());
  const decrease = (s: number, c: Pick<Card, 'suit' | 'rank'>) => {
    const value = known[s].get(faceKey(c));
    if (value) { if (value.count === 1) known[s].delete(faceKey(c)); else value.count--; }
  };
  // A transfer moves a known lower bound, it does not create a new deck card.
  for (const t of [...(tribute?.tributes ?? []), ...(tribute?.returns ?? [])]) {
    if (!capacity.has(faceKey(t.card))) halt('unknown public transfer face');
    decrease(t.from, t.card);
    const value = known[t.to].get(faceKey(t.card));
    if (value) value.count++; else known[t.to].set(faceKey(t.card), { ...t.card, count: 1 });
  }
  for (const row of publicPrefix) for (const e of row.events) if (e.type === 'play') {
    for (const c of e.combo.resources) for (let n = 0; n < c.count; n++) decrease(e.player, c);
  }
  const ownCounts = new Map(own.map(c => [faceKey(c), c.count]));
  for (const c of known[actorSeat].values()) if (c.count > (ownCounts.get(faceKey(c)) ?? 0)) halt('own hand conflicts with public transfer lower bound');
  const knownOtherHands = [0, 1, 2, 3].filter(s => s !== actorSeat).map(s => ({ seat: s,
    cards: [...known[s].values()].sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit)) }));
  for (const s of knownOtherHands) if (s.cards.reduce((n, c) => n + c.count, 0) > state.hands[s.seat].length) halt('public lower bound exceeds remaining count');
  const playedCards = faceCounts(played);
  for (const c of [...own, ...playedCards, ...knownOtherHands.flatMap(s => s.cards)]) {
    const available = capacity.get(faceKey(c));
    if (available === undefined || available < c.count) halt('public face accounting exceeds deck');
    capacity.set(faceKey(c), available - c.count);
  }
  const unseenPool = faces.map(c => ({ ...c, count: capacity.get(faceKey(c))! })).filter(c => c.count > 0);
  return freezeCopy({ schema: OBSERVATION_SCHEMA, decisionId, matchId, actorSeat, partnerSeat: teammateOf(actorSeat), phase: 'play',
    ruleOptions, rulesText: describeRules(ruleOptions), levelsBefore: [state.levelsBefore[0], state.levelsBefore[1]], stageTeam: state.stageTeam,
    effectiveLevelRanks: [...state.ctx.ranks].sort((a, b) => a - b), gameNo: state.match.gameNo, moveNo: state.moveNo,
    previousGameResult: resultCopy(state.match.lastResult), ownHand: own,
    seats: [0, 1, 2, 3].map(s => ({ seat: s, remaining: state.hands[s].length, finishOrder: state.finished.includes(s) ? state.finished.indexOf(s) + 1 : null })),
    target: publicCombo(state.lastCombo), leader: state.leader, lastPlayer: state.lastPlayer, passCount: state.passCount,
    currentTrick, publicPrefix, tribute, knownOtherHands, playedCards, unseenPool,
    informationBoundary: 'own-hand-and-public-prefix; pass-does-not-prove-inability' });
}
