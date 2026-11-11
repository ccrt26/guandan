/** Browser/Node-neutral B02 data boundary. Local bundles are NOT request bodies. */
import type { Card, Combo, ComboKind, EngineEvent, GameResult, RuleOptions, Suit } from '@gd/engine';
import type { CandidatePolicySpec, EnumSpec } from '../candidate-spec';
import type { CandidateCoverage } from './candidateCoverage';

export const OBSERVATION_SCHEMA = 'ohuo-public-observation-v1' as const;
export { CURRENT_CANDIDATE_SPEC as CANDIDATE_SPEC } from '../candidate-spec';
export class DecisionHaltedError extends Error {
  readonly status = 'halted' as const;
  constructor(message: string) { super(message); this.name = 'DecisionHaltedError'; }
}
export function halt(message: string): never { throw new DecisionHaltedError(message); }
export function freezeCopy<T>(value: T): T { return deepFreeze(structuredClone(value)); }
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export interface PublicStep { events: readonly EngineEvent[]; priorTarget: Combo | null }
/** Required provenance supplied by the recording owner, never fabricated from
 * trickPlays. throughMoveNo counts engine applyMove actions, not event count. */
export interface PublicHistoryPrefix {
  matchId: string;
  gameNo: number;
  throughMoveNo: number;
  steps: readonly PublicStep[];
}
export interface DecisionKey {
  controllerOrRunnerGeneration: string | number;
  matchId: string;
  gameNo: number;
  moveNo: number;
  actorSeat: number;
  requestSeq: number;
  ownership?: string;
  snapshotRevision?: number;
}
export interface FaceCount { suit: Suit; rank: number; count: number }
export interface PublicCombo {
  kind: ComboKind;
  size: number;
  mainRank: number;
  keyRank: number;
  length: number;
  pairRanks: number[];
  suit?: Suit;
  resources: FaceCount[];
  wildAs: Array<{ card: { suit: Suit; rank: number }; asRank: number; asSuit?: Suit }>;
}
export type PublicEvent =
  | { type: 'play'; player: number; combo: PublicCombo }
  | { type: 'pass'; player: number }
  | { type: 'finish'; player: number; order: number }
  | { type: 'trickEnd'; nextLeader: number };
export interface PublicTransfer { from: number; to: number; card: { suit: Suit; rank: number } }
export interface Observation {
  schema: typeof OBSERVATION_SCHEMA;
  decisionId: string;
  matchId: string;
  actorSeat: number;
  partnerSeat: number;
  phase: 'play';
  ruleOptions: RuleOptions;
  rulesText: string;
  levelsBefore: [number, number];
  stageTeam: 0 | 1;
  effectiveLevelRanks: number[];
  gameNo: number;
  moveNo: number;
  previousGameResult: GameResult | null;
  ownHand: FaceCount[];
  seats: Array<{ seat: number; remaining: number; finishOrder: number | null }>;
  target: PublicCombo | null;
  leader: number;
  lastPlayer: number;
  passCount: number;
  currentTrick: Array<{ player: number; combo: PublicCombo | null }>;
  publicPrefix: Array<{ moveNo: number; priorTarget: PublicCombo | null; events: PublicEvent[] }>;
  tribute: { resist: boolean; tributes: PublicTransfer[]; returns: PublicTransfer[]; leader: number } | null;
  knownOtherHands: Array<{ seat: number; cards: FaceCount[] }>;
  playedCards: FaceCount[];
  /** Deck minus own current hand, public plays, and other-seat public lower
   * bounds. Transfers are not additionally subtracted. No seat attribution. */
  unseenPool: FaceCount[];
  informationBoundary: 'own-hand-and-public-prefix; pass-does-not-prove-inability';
}
export interface FrozenCandidate {
  actionId: string;
  canonicalId: string;
  canonical: Combo | null;
  originalIndex: number;
  rank: number;
  rawQ: number;
  groupId: string;
  groupKey: string;
  remainingHand: FaceCount[];
}
export interface CandidateBundle {
  candidateSpec: CandidatePolicySpec['candidateSpec'];
  /** New contract requires explicit enum identity; absent on historical bundles. */
  enumSpec?: EnumSpec;
  coverage?: CandidateCoverage;
  decisionId: string;
  pool: readonly FrozenCandidate[];
  initialCandidateIds: readonly string[];
  offeredIds: readonly string[];
  fallbackActionId: string;
  expansionCount: 0 | 1;
  /** Means unique in the current engine enumeration, not a theorem that the
   * enumerator covers every mathematically legal declaration. */
  isUniqueLegalAction: boolean;
}
export interface DecisionBundle extends CandidateBundle {
  key: DecisionKey;
  observation: Observation;
}
export interface OfferedCandidateView {
  candidates: Array<{ actionId: string; action: PublicCombo | null; remainingHand: FaceCount[] }>;
  expandableGroups: Array<{ groupId: string; kind: ComboKind | 'pass'; size: number; wildConsumption: number; remainingCount: number }>;
}
export type SelectionResult =
  | { status: 'selected'; actionId: string; canonical: Combo | null; inInitialCandidateSet: boolean }
  | { status: 'remote_failure'; reason: string; inInitialCandidateSet?: never };
export type ExpansionResult<T extends CandidateBundle = CandidateBundle> =
  | { status: 'expanded'; bundle: T }
  | { status: 'remote_failure'; reason: string };

export function faceCounts(cards: readonly Pick<Card, 'suit' | 'rank'>[]): FaceCount[] {
  const counts = new Map<string, FaceCount>();
  for (const c of cards) {
    const key = `${c.suit}:${c.rank}`, prior = counts.get(key);
    if (prior) prior.count++;
    else counts.set(key, { suit: c.suit, rank: c.rank, count: 1 });
  }
  return [...counts.values()].sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
}
/** Whitelist every nested object; never stringify an EngineEvent/Combo/state. */
export function publicCombo(combo: Combo | null): PublicCombo | null {
  if (combo === null) return null;
  return {
    kind: combo.kind, size: combo.size, mainRank: combo.mainRank, keyRank: combo.keyRank,
    length: combo.length, pairRanks: [...combo.pairRanks].sort((a, b) => a - b),
    ...(combo.kind === 'flush' ? { suit: combo.suit } : {}),
    resources: faceCounts(combo.cards),
    wildAs: combo.wildAs.map(a => {
      const card = combo.cards.find(c => c.id === a.cardId);
      if (!card) halt('public wildcard resource absent');
      return { card: { suit: card.suit, rank: card.rank }, asRank: a.asRank,
        ...(combo.kind === 'flush' ? { asSuit: a.asSuit } : {}) };
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}
