/** Shared M4 boundary: one owner, one frozen B, one synchronous consumed commit.
 * A selected result is evidence of a confirmed apply, not merely HTTP success. */
import type { GameState, Move } from '@gd/engine';
import { resolveLegalMove } from './legality';
import { freezeCopy, type DecisionBundle, type DecisionKey } from './protocol';
import { selectRemoteDecision, isRemoteRequestSummary, type RemoteDecisionResult, type RemoteRequest } from './remote-selector';

export interface DecisionOutcome {
  status: 'selected' | 'fallback' | 'cancelled' | 'halted';
  decisionKey: DecisionKey;
  offeredIds: readonly string[];
  actionId?: string;
  actualMove?: Move;
  reason?: string;
  source?: 'remote' | 'local' | 'local_unique' | 'local_override' | 'remote_failure';
  remote?: RemoteDecisionResult;
}
export interface DecisionOwner {
  state(): GameState | null;
  /** Includes generation, match/game/move/seat, ownership AND snapshot revision. */
  isCurrent(key: DecisionKey): boolean;
  apply(move: Move, outcome: DecisionOutcome): void;
}
export interface PendingDecisionOptions {
  bundle: DecisionBundle; owner: DecisionOwner; request?: RemoteRequest;
  /** Local mode may choose a preserved product-tier action; hybrid B is immutable. */
  localActionId?: string;
}
const completedExternalFailures=new Set(['upstream_error','output_truncated','unexpected_eof','missing_completion',
  'invalid_response_json','invalid_response_shape','decision_id_mismatch','action_id_not_offered','group_id_not_expandable','expansion_already_used']);
/** Only producer-classified external terminal failures with a real safe receipt may use frozen B. */
export function confirmedRemoteFailure(remote:RemoteDecisionResult):boolean {
  if(remote.status!=='remote_failure'||!Array.isArray(remote.attempts)||!remote.attempts.length||!remote.attempts.every(isRemoteRequestSummary)||!Number.isFinite(remote.elapsedMs)||remote.elapsedMs<0||!(remote.requestCount===null||Number.isSafeInteger(remote.requestCount)&&remote.requestCount>=0))return false;
  const receipt=remote.attempts[remote.attempts.length-1];
  if(remote.reason==='transport_failed')return receipt.requestCount===null||receipt.requestCount===1;
  if(receipt.requestCount!==1||receipt.httpStatus===undefined)return false;
  if(remote.reason==='http_error')return receipt.httpStatus>=400&&receipt.httpStatus<=599;
  return completedExternalFailures.has(remote.reason)&&receipt.httpStatus>=200&&receipt.httpStatus<=299;
}
export class PendingDecision {
  readonly abort = new AbortController();
  private begun = false;
  private consumed = false;
  private terminal: DecisionOutcome | null = null;
  private settle!: (outcome: DecisionOutcome) => void;
  readonly result: Promise<DecisionOutcome>;
  /** Independent drain/accounting: cancellation settles result immediately, but
   * this waits for all invoked B04 requests. null means no remote was started.
   * A selector exception rejects (unknown accounting), never fabricates zero. */
  readonly remoteSettled: Promise<RemoteDecisionResult | null>;
  private settleRemote!: (result: RemoteDecisionResult | null) => void;
  private rejectRemote!: (error: unknown) => void;
  constructor(readonly options: PendingDecisionOptions) {
    this.result = new Promise(resolve => { this.settle = resolve; });
    this.remoteSettled = new Promise((resolve,reject) => { this.settleRemote = resolve; this.rejectRemote = reject; });
    // Consumer may only care about the immediate action terminal. Awaiting the
    // original promise still exposes an accounting exception to a runner.
    void this.remoteSettled.catch(() => {});
  }
  get pending(): boolean { return this.begun && this.terminal === null; }
  start(): Promise<DecisionOutcome> {
    if (this.begun || this.terminal) return this.result;
    this.begun = true;
    const {bundle,request,localActionId}=this.options;
    if (!request || bundle.isUniqueLegalAction) {
      this.settleRemote(null);
      this.commit(localActionId ?? bundle.fallbackActionId,'selected',bundle.isUniqueLegalAction?'local_unique':'local',bundle.offeredIds);
    } else {
      void selectRemoteDecision({bundle,request,signal:this.abort.signal}).then(remote=>{
        this.settleRemote(remote);
        if(this.terminal)return;
        if(remote.status==='cancelled'||!this.options.owner.isCurrent(bundle.key)) {this.cancel(remote.status==='cancelled'?remote.reason:'stale');return;}
        if(remote.status==='halted') {this.finish({status:'halted',reason:remote.reason,remote});return;}
        if(remote.status==='remote_failure') {
          if(!confirmedRemoteFailure(remote))this.finish({status:'halted',reason:remote.reason,remote});
          else this.commit(bundle.fallbackActionId,'fallback','remote_failure',remote.offeredIds,remote.reason,remote);
        } else if (remote.status==='selected') this.commit(remote.actionId,'selected','remote',remote.offeredIds,undefined,remote);
      }).catch(error=>{this.rejectRemote(error);if(!this.terminal)this.finish({status:'halted',reason:'decision_internal_error'});});
    }
    return this.result;
  }
  cancel(reason: string): DecisionOutcome {
    if(this.terminal)return this.terminal;
    if(!this.begun)this.settleRemote(null);
    this.abort.abort(reason);
    return this.finish({status:'cancelled',reason});
  }
  private finish(value: Pick<DecisionOutcome,'status'> & Partial<DecisionOutcome>): DecisionOutcome {
    if(this.terminal)return this.terminal;
    this.terminal=freezeCopy({decisionKey:this.options.bundle.key,offeredIds:this.options.bundle.offeredIds,...value});
    this.settle(this.terminal);return this.terminal;
  }
  private commit(actionId:string,status:'selected'|'fallback',source:DecisionOutcome['source'],offeredIds:readonly string[],reason?:string,remote?:RemoteDecisionResult): DecisionOutcome {
    if(this.terminal)return this.terminal;
    const {bundle,owner}=this.options;
    // No await from current/ownership check through consumption and original step.
    if(this.consumed)return this.finish({status:'halted',reason:'already_consumed'});
    if(!owner.isCurrent(bundle.key))return this.cancel('stale');
    const state=owner.state();
    if(!state||state.over||state.pendingReturns.length||state.turn!==bundle.key.actorSeat||state.moveNo!==bundle.key.moveNo||state.match.gameNo!==bundle.key.gameNo)return this.cancel('stale');
    const candidate=bundle.pool.find(c=>c.actionId===actionId);
    if(!offeredIds.includes(actionId)||!candidate)return this.finish({status:'halted',reason:'candidate_mapping_conflict'});
    const move:Move=candidate.canonical===null?{pass:true}:{pass:false,combo:structuredClone(candidate.canonical)};
    try {resolveLegalMove(state,move);} catch {return this.finish({status:'halted',reason:'canonical_legality_conflict'});}
    const outcome:DecisionOutcome={status,decisionKey:bundle.key,offeredIds,actionId,actualMove:move,source,...(reason?{reason}:{}),...(remote?{remote}:{})};
    this.consumed=true;
    try {owner.apply(move,freezeCopy(outcome));}
    catch {return this.finish({status:'halted',reason:'execution_uncertain',actionId,source,...(remote?{remote}:{})});}
    return this.finish(outcome);
  }
}
