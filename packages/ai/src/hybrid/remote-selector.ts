import type {RuleOptions} from '@gd/engine';
/** B04 browser-neutral selector. No fs, credentials, network defaults,
 * model forward, move execution or fallback-policy selection. */
import { decisionRequestView, expandDecisionCandidates, selectOfferedAction } from './candidates';
import { type DecisionBundle, type DecisionKey } from './protocol';
import { candidatePolicyForBundle, FIRST_TARGET_CANDIDATE_SPEC } from '../candidate-spec';

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
/** Public terminal receipt shape. No count or proof is invented for a missing receipt. */
export function isRemoteRequestSummary(value:unknown):value is RemoteRequestSummary {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>,fields=['profileId','revision','snapshotHash','credentialRevision','protocol','requestedModel','returnedModel','requestCount','elapsedMs','upstreamChunks','upstreamEvents','contentEvents','keepaliveEvents','firstUpstreamMs','firstContentMs','usage'];
  if(fields.some(k=>!Object.prototype.hasOwnProperty.call(v,k))||Object.keys(v).some(k=>!fields.includes(k)&&k!=='httpStatus'))return false;
  const nonnegative=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  if(typeof v.profileId!=='string'||!v.profileId||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||typeof v.snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(v.snapshotHash)||!Number.isSafeInteger(v.credentialRevision)||Number(v.credentialRevision)<0)return false;
  if(typeof v.protocol!=='string'||!['openai-chat-completions','anthropic-messages','unavailable'].includes(v.protocol)||typeof v.requestedModel!=='string'||!v.requestedModel||!(v.returnedModel===null||typeof v.returnedModel==='string'&&v.returnedModel.length<=200)||![0,1,null].includes(v.requestCount as 0|1|null))return false;
  if(!nonnegative(v.elapsedMs)||['upstreamChunks','upstreamEvents','contentEvents','keepaliveEvents'].some(k=>!Number.isSafeInteger(v[k])||Number(v[k])<0)||['firstUpstreamMs','firstContentMs'].some(k=>v[k]!==null&&!nonnegative(v[k])))return false;
  if(v.httpStatus!==undefined&&(!Number.isSafeInteger(v.httpStatus)||Number(v.httpStatus)<100||Number(v.httpStatus)>599))return false;
  if(!v.usage||typeof v.usage!=='object'||Array.isArray(v.usage))return false;
  return Object.values(v.usage).every(n=>nonnegative(n)||!!n&&typeof n==='object'&&!Array.isArray(n)&&Object.values(n).every(nonnegative));
}
export type RemoteRequestResult =
  | { status: 'response'; response: RemoteSelectionResponse; summary: RemoteRequestSummary }
  | { status: 'remote_failure'; reason: string; summary: RemoteRequestSummary }
  | { status: 'cancelled'; reason: string; summary: RemoteRequestSummary };
/** Transport must resolve cancellation with its actual send-count summary. */
export interface CommonTeacherRequestView {schema:'ohuo-common-view-request-r2';decisionId:string;modelPayloadBytes:string;addressMap:readonly {address:string;actionId:string;equivalentActionIds:readonly string[]}[]}
export interface ProjectRulesTeacherRequestView extends Omit<CommonTeacherRequestView,'schema'> {schema:'ohuo-common-view-project-rules-request-v1';promptId:string;systemPromptSHA256:string;ruleOptions:Readonly<RuleOptions>}
export type CommonTeacherRequestProjection=CommonTeacherRequestView|ProjectRulesTeacherRequestView;
export type RemoteRequestView = ReturnType<typeof decisionRequestView>|CommonTeacherRequestProjection;
export type RemoteRequest = (view: RemoteRequestView, signal: AbortSignal) => Promise<RemoteRequestResult>;
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
  if (!b || !frozen(b)) return false;
  const policy = candidatePolicyForBundle(b);
  const initialLimit = policy.candidateSpec === FIRST_TARGET_CANDIDATE_SPEC ? 12 : 8;
  if (b.expansionCount !== 0 || !b.pool?.length || !b.initialCandidateIds?.length || b.initialCandidateIds.length > initialLimit || b.offeredIds.length !== b.initialCandidateIds.length) return false;
  if (b.observation?.decisionId !== b.decisionId || b.key?.matchId !== b.observation.matchId || b.key?.gameNo !== b.observation.gameNo || b.key?.moveNo !== b.observation.moveNo || b.key?.actorSeat !== b.observation.actorSeat) return false;
  const ids = new Set(b.pool.map(c => c.actionId));
  return ids.size === b.pool.length && new Set(b.initialCandidateIds).size === b.initialCandidateIds.length && b.initialCandidateIds.every((id,i) => ids.has(id) && b.offeredIds[i] === id) && ids.has(b.fallbackActionId);
}
/** One initial request, optional B02 expansion, one final choose. Returned
 * selected is NOT authority to step: M4 must recheck ownership/key/legal move. */
export async function selectRemoteDecision({bundle,request,signal,requestProjection}: {bundle: DecisionBundle; request: RemoteRequest; signal: AbortSignal; requestProjection?:(bundle:DecisionBundle)=>CommonTeacherRequestProjection}): Promise<RemoteDecisionResult> {
  const startedAt = performance.now();
  let current = bundle,accountingUnknown=false;
  const attempts: RemoteRequestSummary[] = [];
  const common = (): TerminalCommon => ({ decisionKey: bundle.key, offeredIds: current.offeredIds, requestCount: accountingUnknown||attempts.some(a=>a.requestCount===null) ? null : attempts.reduce((n,a)=>n+a.requestCount!,0), elapsedMs: performance.now()-startedAt, attempts: [...attempts] });
  const cancelled = (): RemoteDecisionResult => ({...common(),status:'cancelled',reason:cancelReason(signal)});
  if (signal.aborted) return cancelled();
  try { if (!validBundle(bundle)) return {...common(),status:'halted',reason:'invalid_frozen_bundle'}; }
  catch { return {...common(),status:'halted',reason:'invalid_frozen_bundle'}; }
  for (let round=0; round<2; round++) {
    if (signal.aborted) return cancelled();
    let view: RemoteRequestView;
    try { view = requestProjection?requestProjection(current):decisionRequestView(current); }
    catch { return {...common(),status:'halted',reason:'candidate_projection_conflict'}; }
    let result: RemoteRequestResult;
    try { result = await request(view,signal); }
    catch { accountingUnknown=true;return signal.aborted ? cancelled() : {...common(),status:'halted',reason:'request_internal_error'}; }
    if(!result||!isRemoteRequestSummary(result.summary)){accountingUnknown=true;return signal.aborted?cancelled():{...common(),status:'halted',reason:'invalid_profile_response'};}
    attempts.push(result.summary);
    if(!['response','remote_failure','cancelled'].includes(result.status))return {...common(),status:'halted',reason:'invalid_profile_response'};
    if (signal.aborted || result.status === 'cancelled') return cancelled();
    if (result.status === 'remote_failure') return {...common(),status:'remote_failure',reason:result.reason};
    const response = result.response;
    const projectRules='schema' in view&&view.schema==='ohuo-common-view-project-rules-request-v1';
    if(projectRules&&(response?.kind!=='choose'||typeof response.note!=='string'||!response.note.trim()))return {...common(),status:'halted',reason:'invalid_response_shape'};
    const fields = response?.kind === 'choose' ? ['kind','decisionId','actionId','note'] : response?.kind === 'expand' ? ['kind','decisionId','groupId'] : [];
    if (!response || !fields.length || Object.keys(response).some(k=>!fields.includes(k)) || ('note' in response && (typeof response.note !== 'string' || !projectRules && response.note.length > 240))) return {...common(),status:'halted',reason:'invalid_response_shape'};
    try {
      if (response.kind === 'choose') {
        const choice = selectOfferedAction(current,response.decisionId,response.actionId);
        if (choice.status === 'remote_failure') return {...common(),status:'halted',reason:choice.reason};
        if (signal.aborted) return cancelled();
        return {...common(),status:'selected',actionId:choice.actionId,inInitialCandidateSet:choice.inInitialCandidateSet};
      }
      if(requestProjection)return {...common(),status:'halted',reason:'expansion_disabled_for_common_view'};
      if (round !== 0) return {...common(),status:'halted',reason:'expansion_already_used'};
      const expanded = expandDecisionCandidates(current,response.decisionId,response.groupId);
      if (expanded.status === 'remote_failure') return {...common(),status:'halted',reason:expanded.reason};
      current = expanded.bundle;
      // No await or re-enumeration/re-score between same-pool expansion and next check.
    } catch { return {...common(),status:'halted',reason:'candidate_mapping_conflict'}; }
  }
  return {...common(),status:'halted',reason:'missing_final_choose'};
}
