import {buildCommonTeacherView,normalizedCommonDecisionIdentity} from './first-round-common-view';
import {necessaryDeclarationKey} from '../review6/action-effect';
/** Read an originally captured decision, never re-enumerate/rescore a pool.
 * Replay reconstructs only prior confirmed history; teacher choices never step. */
import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {loadMatchStore,replayConfirmedMatch,hashJSON,type MatchStoreRef,type MatchRecord,captureStudentCandidateInputs} from './match-record';
import {PublicTracker} from '../../packages/ai/src/nn/schema';
import {buildObservation} from '../../packages/ai/src/hybrid/observation';
import {canonicalActionId,resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import {freezeCopy,type DecisionBundle,type DecisionKey,type PublicHistoryPrefix} from '../../packages/ai/src/hybrid/protocol';
import {selectRemoteDecision,type RemoteRequest,type ProjectRulesTeacherRequestView} from '../../packages/ai/src/hybrid/remote-selector';
import {prepareOfflineLabel,type DecisionInput,type DatasetIdentities} from './distill-data';
import {candidatePolicyForBundle,resolveCandidatePolicy,FIRST_TARGET_CANDIDATE_SPEC} from '../../packages/ai/src/candidate-spec';
/** Shared by recorded reload and offline population selection; no enumeration. */
export function validateCapturedCandidateContract(input:DecisionInput,bundle:DecisionBundle){
 const student=input.schema==='ohuo-decision-input-first-round-v3',policy=candidatePolicyForBundle(bundle),fresh=policy.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC,c=input.candidateInputs;
 if(input.schema!==(student?'ohuo-decision-input-first-round-v3':fresh?'ohuo-decision-input-candidate-v2':'ohuo-decision-input-v1')||input.candidateSpec!==policy.candidateSpec||!c||!isDeepStrictEqual(c.candidateIds,bundle.initialCandidateIds)||!isDeepStrictEqual(input.initialCandidateIds,bundle.initialCandidateIds)||c.candidateIds.length<1||c.candidateIds.length>(fresh?12:8)||new Set(c.candidateIds).size!==c.candidateIds.length)throw Error('captured candidate schema/order/limit mismatch');
 if(fresh&&(!isDeepStrictEqual(input.enumSpec,policy.enumSpec)||resolveCandidatePolicy(c.candidatePolicy as any)!==policy||bundle.expansionCount!==0||!isDeepStrictEqual(bundle.offeredIds,bundle.initialCandidateIds)))throw Error('captured candidate complete policy mismatch');
 if(student&&(!fresh||!input.studentInputs||input.studentInputs.inputDim!==423||!isDeepStrictEqual(input.studentInputs.candidateIds,bundle.initialCandidateIds)))throw Error('captured student schema/order mismatch');
 if(!fresh&&(input.enumSpec!==undefined||c.candidatePolicy!==undefined))throw Error('legacy captured candidate metadata changed');
 return policy;
}
export interface SelectedRecordedDecision {blockFamilyId?:string;recordRef:MatchStoreRef;recordRoot:string;key:DecisionKey;inputSHA256:string;familyId:string;split:'train'|'dev'|'confirm';actorSeat:number}
export function readOfflineSnapshot(row:SelectedRecordedDecision,cache=new Map<string,ReturnType<typeof loadMatchStore>>(),options?:{purpose:'first-round-new-test'}){
 const cacheKey=hashJSON([row.recordRef,row.recordRoot]);let store=cache.get(cacheKey);if(!store){store=loadMatchStore(row.recordRef,row.recordRoot);cache.set(cacheKey,store);}
 const {record,privateSources}=store.recorder.snapshot(),decision=record.decisions.find(d=>isDeepStrictEqual(d.key,row.key)),game=record.games.find(g=>g.gameNo===row.key.gameNo);
 if(!decision||decision.executionKind!=='confirmed'||!['selected','fallback'].includes(decision.status)||!game||game.sourceFamilyId!==row.familyId||record.split!==row.split||record.evaluatedActor!==row.actorSeat||row.key.actorSeat!==row.actorSeat||!(options?.purpose==='first-round-new-test'?row.split==='confirm':['train','dev'].includes(row.split))||decision.trainingInputSHA256!==row.inputSHA256)throw Error('offline source/actor/family/confirmed-decision mismatch');
 const path=join(row.recordRef.directory,`decision-${row.key.requestSeq}.private.json`);if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||(lstatSync(path).mode&0o777)!==0o600)throw Error('private decision requires exact 0600 regular file');
 const input=JSON.parse(readFileSync(path,'utf8')) as DecisionInput&{selectionBundle?:DecisionBundle};
 if(hashJSON(input)!==row.inputSHA256||!isDeepStrictEqual(input.key,row.key)||!input.selectionBundle)throw Error('missing original complete selection bundle or input identity');
 const bundle=freezeCopy(input.selectionBundle);
 validateCapturedCandidateContract(input,bundle);
 if(!isDeepStrictEqual(bundle.key,row.key)||bundle.decisionId!==input.observation.decisionId||bundle.expansionCount!==0||bundle.candidateSpec!==input.candidateSpec||!isDeepStrictEqual(bundle.observation,input.observation)||!isDeepStrictEqual(bundle.pool,input.pool)||!isDeepStrictEqual(bundle.initialCandidateIds,input.initialCandidateIds)||!isDeepStrictEqual(bundle.offeredIds,input.initialCandidateIds)||!bundle.initialCandidateIds.includes(bundle.fallbackActionId)||typeof bundle.isUniqueLegalAction!=='boolean'||!bundle.pool.length)throw Error('original bundle/candidate provenance differs');
 const earlier=record.decisions.filter(d=>d.key.gameNo<row.key.gameNo||d.key.gameNo===row.key.gameNo&&d.key.requestSeq<row.key.requestSeq);
 const prefixRecord:MatchRecord={...record,games:record.games.filter(g=>g.gameNo<=row.key.gameNo),decisions:earlier,summary:null};
 const replay=replayConfirmedMatch(prefixRecord,{...privateSources,games:privateSources.games.filter(g=>g.gameNo<=row.key.gameNo)}),state=replay.state;
 if(replay.executionUnknown||!state||state.over||state.moveNo!==row.key.moveNo||state.turn!==row.actorSeat||state.match.gameNo!==row.key.gameNo)throw Error('offline confirmed causal origin unavailable');
 const history:PublicHistoryPrefix={matchId:row.key.matchId,gameNo:row.key.gameNo,throughMoveNo:row.key.moveNo,steps:earlier.filter(d=>d.key.gameNo===row.key.gameNo&&d.executionKind==='confirmed').map(d=>({priorTarget:d.priorTarget,events:d.events}))};
 if(!isDeepStrictEqual(buildObservation({state,actorSeat:row.actorSeat,matchId:row.key.matchId,decisionId:bundle.decisionId,history}),input.observation))throw Error('offline original observation differs');
 for(const candidate of bundle.pool){resolveLegalMove(state,candidate.canonical===null?{pass:true}:{pass:false,combo:candidate.canonical});if(canonicalActionId(candidate.canonical,state.ctx)!==candidate.canonicalId)throw Error('offline original canonical differs');}
 if(input.schema==='ohuo-decision-input-first-round-v3'){
  const captured=input.studentInputs!;if(!Array.isArray(captured.rawQ)||captured.rawQ.length!==bundle.initialCandidateIds.length||captured.rawQ.some(q=>!Number.isFinite(q)))throw Error('offline student scores malformed');
  const tracker=new PublicTracker();for(const step of history.steps)tracker.observe([...step.events]);
  // This reconstructs only capture/features/memory and S0 top from the stored
  // scores. Actual scorer weights/forward provenance is separately bound by
  // the fixed source producer and host S0 migration resolver, never inferred here.
  const reconstructed=captureStudentCandidateInputs({bundle,state,tracker,candidateInputs:input.candidateInputs as any,student:{studentParentRef:captured.studentParentRef,scorer:captured.scorer,network:{inputDim:423,forward:()=>Float32Array.from(captured.rawQ)} as any}});
  if(!isDeepStrictEqual(reconstructed,captured))throw Error('offline student capture/memory replay differs');
 }
 return {row,record,decision,input,bundle,state,history};
}
export type OfflineSnapshot=ReturnType<typeof readOfflineSnapshot>;
/** Causal learner-input core shared by recorded and designed sources. Source
 * admission stays with their own readers; no record/decision is synthesized. */
export interface OfflineSnapshotCore {
 row:Pick<SelectedRecordedDecision,'key'|'inputSHA256'|'familyId'|'split'|'actorSeat'|'blockFamilyId'>;
 input:OfflineSnapshot['input'];bundle:OfflineSnapshot['bundle'];
 state:OfflineSnapshot['state'];history:OfflineSnapshot['history'];
}
/** Exactly the captured learner input, never raw observation/history or Q values. */
export function commonViewForSnapshot(snapshot:OfflineSnapshotCore){
 const captured=snapshot.input.studentInputs;
 if(snapshot.input.schema!=='ohuo-decision-input-first-round-v3'||!captured||captured.inputDim!==423||!isDeepStrictEqual(captured.candidateIds,snapshot.bundle.initialCandidateIds)||captured.candidateFeatures.length!==captured.candidateIds.length)throw Error('common_view_capture_identity');
 return buildCommonTeacherView(captured.candidateIds.map((actionId,index)=>{
  const candidate=snapshot.bundle.pool.find(c=>c.actionId===actionId);if(!candidate)throw Error('common_view_candidate_identity');
  const move=resolveLegalMove(snapshot.state,candidate.canonical===null?{pass:true}:{pass:false,combo:candidate.canonical});
  if(canonicalActionId(move.pass?null:move.combo!,snapshot.state.ctx)!==candidate.canonicalId)throw Error('common_view_canonical_identity');
  return {actionId,input423:captured.candidateFeatures[index],equivalenceKey:necessaryDeclarationKey(move.pass?null:move.combo!,snapshot.state.ctx)};
 }),{inputDim:423,passEncoding:'action64'});
}
export type CommonTeacherView=ReturnType<typeof commonViewForSnapshot>;
/** Used history must come from the original host catalog/selection chain. This
 * helper only reconstructs one normalized public decision; a supplied digest
 * or list is not a completeness proof for that history. */
export function commonDecisionIdentityForSnapshot(snapshot:OfflineSnapshotCore){
 const view=commonViewForSnapshot(snapshot),effects=new Map<string,string>();
 for(const id of snapshot.bundle.initialCandidateIds){const candidate=snapshot.bundle.pool.find(c=>c.actionId===id);if(!candidate)throw Error('common_view_candidate_identity');effects.set(id,necessaryDeclarationKey(candidate.canonical,snapshot.state.ctx));}
 return normalizedCommonDecisionIdentity(view,snapshot.state.match.opts,snapshot.bundle.candidateSpec,effects);
}
/** Selection only: no PendingDecision, owner.apply, policy forward or fallback.
 * This guard is explicit because B04's pure selector does not skip unique. */
export async function queryOfflineTeacher({snapshot,teacher,request,signal,commonView,projectRulesPrompt}:{snapshot:OfflineSnapshotCore;projectRulesPrompt?:Pick<ProjectRulesTeacherRequestView,'schema'|'promptId'|'systemPromptSHA256'|'ruleOptions'>;commonView?:CommonTeacherView;teacher:DatasetIdentities['teacher'];request:RemoteRequest;signal:AbortSignal}){
 if(snapshot.bundle.isUniqueLegalAction)return {status:'excluded_unique' as const,remote:null,offlineLabel:null};
 const projection=commonView?commonViewForSnapshot(snapshot):undefined;
 if(commonView&&!isDeepStrictEqual(projection,commonView))throw Error('common_view_projection_changed');
 if(projectRulesPrompt&&(!projection||projectRulesPrompt.schema!=='ohuo-common-view-project-rules-request-v1'||!isDeepStrictEqual(snapshot.state.match.opts,projectRulesPrompt.ruleOptions)))throw Error('project_rules_source_options');
 const remote=await selectRemoteDecision({bundle:snapshot.bundle,request,signal,...(projection?{requestProjection:()=>({...(projectRulesPrompt?{schema:projectRulesPrompt.schema,promptId:projectRulesPrompt.promptId,systemPromptSHA256:projectRulesPrompt.systemPromptSHA256,ruleOptions:projectRulesPrompt.ruleOptions}:{schema:'ohuo-common-view-request-r2' as const}),decisionId:snapshot.bundle.decisionId,modelPayloadBytes:projection.modelPayloadBytes,addressMap:projection.addressMap})}:{})});
 const offlineLabel=prepareOfflineLabel({input:snapshot.input,remote,state:snapshot.state,history:snapshot.history,teacher});
 return {status:remote.status,remote,offlineLabel};
}
