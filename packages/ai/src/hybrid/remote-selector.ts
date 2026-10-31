/** B04 browser-neutral selector. No fs, credentials, network defaults,
 * model forward, move execution or fallback-policy selection. */
import { decisionRequestView, expandDecisionCandidates, selectOfferedAction } from './candidates';
import { CANDIDATE_SPEC, type DecisionBundle, type DecisionKey } from './protocol';

export type RemoteSelectionResponse =
  | { kind: 'choose'; decisionId: string; actionId: string; note?: string }
  | { kind: 'expand'; decisionId: string; groupId: string };
export interface RemoteRequestSummary {
  profileId: string; revision: number; snapshotHash: string; credentialRevision: number;
  protocol: string; requestedModel: string; returnedModel: string | null;
  requestCount: 0 | 1 | null; httpStatus?: number; elapsedMs: number;
  upstreamChunks: number; upstreamEvents: number; contentEvents: number; keepaliveEvents: number;
  firstUpstreamMs: number | null; firstContentMs: number | null;
  usage: Record<string, number | Record<string, number>>;
}
export type RemoteRequestResult =
  | { status: 'response'; response: RemoteSelectionResponse; summary: RemoteRequestSummary }
  | { status: 'remote_failure'; reason: string; summary: RemoteRequestSummary }
  | { status: 'cancelled'; reason: string; summary: RemoteRequestSummary };
/** Transport must resolve cancellation with its actual send-count summary. */
export type RemoteRequest = (view: ReturnType<typeof decisionRequestView>, signal: AbortSignal) => Promise<RemoteRequestResult>;
interface TerminalCommon { decisionKey: DecisionKey; offeredIds: readonly string[]; requestCount: number | null; elapsedMs: number; attempts: readonly RemoteRequestSummary[] }
export type RemoteDecisionResult = TerminalCommon & (
  | { status: 'selected'; actionId: string; inInitialCandidateSet: boolean }
  | { status: 'remote_failure' | 'halted' | 'cancelled'; reason: string }
);
const cancelReasons = new Set(['user_stop','pause','new_game','lost_ownership','run_boundary','local_override']);
const cancelReason = (signal: AbortSignal) => typeof signal.reason === 'string' && cancelReasons.has(signal.reason) ? signal.reason : 'cancelled';
function frozen(value: unknown): boolean {
  return !value || typeof value !== 'object' || Object.isFrozen(value) && Object.values(value).every(frozen);
}
function validBundle(b: DecisionBundle): boolean {
  if (!b || !frozen(b) || b.candidateSpec !== CANDIDATE_SPEC || b.expansionCount !== 0 || !b.pool?.length || !b.initialCandidateIds?.length || b.initialCandidateIds.length > 8 || b.offeredIds.length !== b.initialCandidateIds.length) return false;
  if (b.observation?.decisionId !== b.decisionId || b.key?.matchId !== b.observation.matchId || b.key?.gameNo !== b.observation.gameNo || b.key?.moveNo !== b.observation.moveNo || b.key?.actorSeat !== b.observation.actorSeat) return false;
  const ids = new Set(b.pool.map(c => c.actionId));
  return ids.size === b.pool.length && new Set(b.initialCandidateIds).size === b.initialCandidateIds.length && b.initialCandidateIds.every((id,i) => ids.has(id) && b.offeredIds[i] === id) && ids.has(b.fallbackActionId);
}
/** One initial request, optional B02 expansion, one final choose. Returned
 * selected is NOT authority to step: M4 must recheck ownership/key/legal move. */
export async function selectRemoteDecision({bundle,request,signal}: {bundle: DecisionBundle; request: RemoteRequest; signal: AbortSignal}): Promise<RemoteDecisionResult> {
  const startedAt = performance.now();
  let current = bundle;
  const attempts: RemoteRequestSummary[] = [];
  const common = (): TerminalCommon => ({ decisionKey: bundle.key, offeredIds: current.offeredIds, requestCount: attempts.some(a=>a.requestCount===null) ? null : attempts.reduce((n,a)=>n+a.requestCount!,0), elapsedMs: performance.now()-startedAt, attempts: [...attempts] });
  const cancelled = (): RemoteDecisionResult => ({...common(),status:'cancelled',reason:cancelReason(signal)});
  if (signal.aborted) return cancelled();
  try { if (!validBundle(bundle)) return {...common(),status:'halted',reason:'invalid_frozen_bundle'}; }
  catch { return {...common(),status:'halted',reason:'invalid_frozen_bundle'}; }
  for (let round=0; round<2; round++) {
    if (signal.aborted) return cancelled();
    let view: ReturnType<typeof decisionRequestView>;
    try { view = decisionRequestView(current); }
    catch { return {...common(),status:'halted',reason:'candidate_projection_conflict'}; }
    let result: RemoteRequestResult;
    try { result = await request(view,signal); }
    catch { return signal.aborted ? cancelled() : {...common(),status:'remote_failure',reason:'request_failed'}; }
    attempts.push(result.summary);
    if (signal.aborted || result.status === 'cancelled') return cancelled();
    if (result.status === 'remote_failure') return {...common(),status:'remote_failure',reason:result.reason};
    const response = result.response;
    const fields = response?.kind === 'choose' ? ['kind','decisionId','actionId','note'] : response?.kind === 'expand' ? ['kind','decisionId','groupId'] : [];
    if (!response || !fields.length || Object.keys(response).some(k=>!fields.includes(k)) || ('note' in response && (typeof response.note !== 'string' || response.note.length > 240))) return {...common(),status:'remote_failure',reason:'invalid_response_shape'};
    try {
      if (response.kind === 'choose') {
        const choice = selectOfferedAction(current,response.decisionId,response.actionId);
        if (choice.status === 'remote_failure') return {...common(),...choice};
        if (signal.aborted) return cancelled();
        return {...common(),status:'selected',actionId:choice.actionId,inInitialCandidateSet:choice.inInitialCandidateSet};
      }
      if (round !== 0) return {...common(),status:'remote_failure',reason:'expansion_already_used'};
      const expanded = expandDecisionCandidates(current,response.decisionId,response.groupId);
      if (expanded.status === 'remote_failure') return {...common(),...expanded};
      current = expanded.bundle;
      // No await or re-enumeration/re-score between same-pool expansion and next check.
    } catch { return {...common(),status:'halted',reason:'candidate_mapping_conflict'}; }
  }
  return {...common(),status:'remote_failure',reason:'missing_final_choose'};
}
