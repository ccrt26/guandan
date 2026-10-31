/** Frozen local B proposal/C and explicit offered boundary. No API, execution,
 * rescoring, or reconstruction of moves from remote text. */
import { canPass, isWild, legalCombos, type GameState } from '@gd/engine';
import type { NeuralDecider, NeuralDecision } from '../nn/neuralSeat';
import { assertActiveActor, buildObservation, type ObservationInput } from './observation';
import { canonicalActionId, resolveLegalMove } from './legality';
import { CANDIDATE_SPEC, deepFreeze, faceCounts, freezeCopy, halt, publicCombo, type CandidateBundle, type DecisionBundle, type DecisionKey, type ExpansionResult, type FrozenCandidate, type OfferedCandidateView, type SelectionResult } from './protocol';

export interface FreezeCandidatesInput { state: GameState; actorSeat: number; decisionId: string; decision: NeuralDecision }
export function freezeDecisionCandidates({ state, actorSeat, decisionId, decision }: FreezeCandidatesInput): CandidateBundle {
  assertActiveActor(state, actorSeat);
  if (typeof decisionId !== 'string' || !decisionId.trim()) halt('decision identity required');
  const rows = decision.ranking;
  if (!rows?.length || rows.length !== decision.nCands || decision.explored) halt('full greedy B ranking required');
  const seenIndices = new Set<number>(), seenActions = new Set<string>();
  const groups = new Map<string, string>();
  const pool: FrozenCandidate[] = [];
  try {
    for (const [rank, row] of rows.entries()) {
      if (!Number.isSafeInteger(row.idx) || row.idx < 0 || row.idx >= rows.length || seenIndices.has(row.idx)) halt('pool original index conflict');
      if (!Number.isFinite(row.score)) halt('pool score must be finite');
      if (rank && (row.score > rows[rank - 1].score || row.score === rows[rank - 1].score && row.idx < rows[rank - 1].idx)) halt('pool ranking/tie-break conflict');
      seenIndices.add(row.idx);
      const move = row.combo === null ? { pass: true } : { pass: false, combo: row.combo };
      resolveLegalMove(state, move);
      const canonicalId = canonicalActionId(row.combo, state.ctx);
      if (seenActions.has(canonicalId)) halt('duplicate canonical pool action');
      seenActions.add(canonicalId);
      const wildConsumption = row.combo?.cards.filter(c => isWild(c, state.ctx)).length ?? 0;
      const groupKey = `${row.combo?.kind ?? 'pass'}:${row.combo?.size ?? 0}:${wildConsumption}`;
      if (!groups.has(groupKey)) groups.set(groupKey, `g${String(groups.size + 1).padStart(2, '0')}`);
      const ids = new Set(row.combo?.cards.map(c => c.id) ?? []);
      pool.push({ actionId: `a${String(rank + 1).padStart(3, '0')}`, canonicalId, canonical: row.combo,
        originalIndex: row.idx, rank, rawQ: row.score, groupId: groups.get(groupKey)!, groupKey,
        remainingHand: faceCounts(state.hands[actorSeat].filter(c => !ids.has(c.id))) });
    }
    resolveLegalMove(state, decision.move);
    const fallbackId = canonicalActionId(decision.move.pass ? null : decision.move.combo, state.ctx);
    if (fallbackId !== pool[0].canonicalId) halt('B choice differs from frozen greedy ranking');
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 'halted') throw error;
    halt(`pool/canonical legality conflict: ${String(error)}`);
  }
  const initialCandidateIds: string[] = [];
  const add = (candidate: FrozenCandidate | undefined) => {
    if (candidate && initialCandidateIds.length < 8 && !initialCandidateIds.includes(candidate.actionId)) initialCandidateIds.push(candidate.actionId);
  };
  add(pool[0]);
  pool.slice(0, 3).forEach(add);
  add(pool.find(c => c.canonical !== null && c.canonical.cards.length === state.hands[actorSeat].length));
  add(pool.find(c => c.canonical === null));
  // Only groups not already represented need coverage; then fill by old rank.
  for (const groupId of groups.values()) if (!initialCandidateIds.some(id => pool.find(c => c.actionId === id)!.groupId === groupId)) add(pool.find(c => c.groupId === groupId));
  pool.forEach(add);
  // Exception: a singleton ranking is not proof of a singleton original legal
  // enumeration (e.g. old compatibility folding or a truncated injected pool).
  // Verify only that shortcut, without scoring/reranking or changing B/C.
  const isUniqueLegalAction = pool.length === 1 && legalCombos(state).length + (canPass(state) ? 1 : 0) === 1;
  return freezeCopy({ candidateSpec: CANDIDATE_SPEC, decisionId, pool, initialCandidateIds,
    offeredIds: [...initialCandidateIds], fallbackActionId: pool[0].actionId, expansionCount: 0, isUniqueLegalAction });
}

/** Owner must keep the decider's public tracker synchronized. This boundary
 * invokes its frozen B decision exactly once and never reads other-seat cards. */
export function createDecisionBundle(input: ObservationInput & { key: DecisionKey; decider: Pick<NeuralDecider, 'seat' | 'decide'> }): DecisionBundle {
  const { key, state, actorSeat, matchId, decider } = input;
  if (key.matchId !== matchId || key.gameNo !== state.match.gameNo || key.moveNo !== state.moveNo || key.actorSeat !== actorSeat || decider.seat !== actorSeat || !Number.isSafeInteger(key.requestSeq) || key.requestSeq < 0 || !['string', 'number'].includes(typeof key.controllerOrRunnerGeneration)) halt('decision key/decider identity mismatch');
  const observation = buildObservation(input);
  const candidates = freezeDecisionCandidates({ ...input, decision: decider.decide(state, { wantRanking: true }) });
  return deepFreeze({ ...candidates, observation, key: freezeCopy({
    controllerOrRunnerGeneration: key.controllerOrRunnerGeneration, matchId: key.matchId, gameNo: key.gameNo,
    moveNo: key.moveNo, actorSeat: key.actorSeat, requestSeq: key.requestSeq,
    ...(key.ownership !== undefined ? { ownership: key.ownership } : {}),
    ...(key.snapshotRevision !== undefined ? { snapshotRevision: key.snapshotRevision } : {}),
  }) });
}

/** Public projection explicitly excludes rawQ, original indices, canonical
 * copy IDs, unoffered actions, state, policy/network and controller handles. */
export function offeredCandidateView(bundle: CandidateBundle): OfferedCandidateView {
  const candidates = bundle.offeredIds.map(id => {
    const c = bundle.pool.find(c => c.actionId === id);
    if (!c) halt('offered ID missing from frozen pool');
    return { actionId: c.actionId, action: publicCombo(c.canonical), remainingHand: c.remainingHand };
  });
  const groups = new Map<string, OfferedCandidateView['expandableGroups'][number]>();
  if (bundle.expansionCount === 0) for (const c of bundle.pool) {
    if (bundle.offeredIds.includes(c.actionId)) continue;
    const [kind, size, wildConsumption] = c.groupKey.split(':');
    const group = groups.get(c.groupId);
    if (group) group.remainingCount++;
    else groups.set(c.groupId, { groupId: c.groupId, kind: kind as 'pass', size: Number(size), wildConsumption: Number(wildConsumption), remainingCount: 1 });
  }
  return freezeCopy({ candidates, expandableGroups: [...groups.values()] });
}
/** Self-contained safe rules/facts/candidate view. B04 transport must also bind
 * its frozen choose/expand response contract. Never send DecisionBundle itself. */
export function decisionRequestView(bundle: DecisionBundle) {
  return deepFreeze({ observation: bundle.observation, candidateSpec: bundle.candidateSpec,
    expansionCount: bundle.expansionCount, ...offeredCandidateView(bundle) });
}
export function selectOfferedAction(bundle: CandidateBundle, decisionId: string, actionId: string): SelectionResult {
  if (decisionId !== bundle.decisionId) return { status: 'remote_failure', reason: 'decision_id_mismatch' };
  if (!bundle.offeredIds.includes(actionId)) return { status: 'remote_failure', reason: 'action_id_not_offered' };
  const selected = bundle.pool.find(c => c.actionId === actionId);
  if (!selected) halt('offered ID missing from frozen pool');
  return { status: 'selected', actionId, canonical: selected.canonical, inInitialCandidateSet: bundle.initialCandidateIds.includes(actionId) };
}
export function expandDecisionCandidates<T extends CandidateBundle>(bundle: T, decisionId: string, groupId: string): ExpansionResult<T> {
  if (decisionId !== bundle.decisionId) return { status: 'remote_failure', reason: 'decision_id_mismatch' };
  if (bundle.expansionCount !== 0) return { status: 'remote_failure', reason: 'expansion_already_used' };
  const extra = bundle.pool.filter(c => c.groupId === groupId && !bundle.offeredIds.includes(c.actionId)).slice(0, 4);
  if (!extra.length) return { status: 'remote_failure', reason: 'group_id_not_expandable' };
  // Keep original pool, B, C and old IDs as the same frozen references.
  return { status: 'expanded', bundle: deepFreeze({ ...bundle, offeredIds: [...bundle.offeredIds, ...extra.map(c => c.actionId)], expansionCount: 1 }) };
}
