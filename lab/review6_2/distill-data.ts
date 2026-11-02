/** M6: one immutable manifest + grouped JSONL. Never calls a model, enumerates
 * candidates, repairs a label, runs a match, or updates parameters. */
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {canonicalActionId,resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import type {GameState} from '@gd/engine';
import {buildObservation} from '../../packages/ai/src/hybrid/observation';
import type {DecisionKey,FrozenCandidate,PublicHistoryPrefix} from '../../packages/ai/src/hybrid/protocol';
import {resolveCandidatePolicy,FIRST_TARGET_CANDIDATE_SPEC,type CandidatePolicySpec,type EnumSpec} from '../../packages/ai/src/candidate-spec';
import type {RemoteDecisionResult} from '../../packages/ai/src/hybrid/remote-selector';
import {verifyOfflineSelection,type OfflineSelectionTrustedInputs} from './offline-selection';
import {readOfflineSnapshot} from './offline-label-source';
import {STUDENT_SCORER_ENCODER,validateStudentScorerDescriptor} from '../../packages/ai/src/policy/descriptor';
import {isFirstRoundR2DatasetPlan,isFirstRoundTeachingTerminalFor,firstRoundOwnedLabelRows} from './first-round-contract.mjs';
import {firstRoundCoverage,findFirstRoundLabelConflicts} from './first-round-qualification.mjs';
import type {StudentCandidateInputs} from './match-record';
import {canonical,digest,referenceOf} from './task-schema.mjs';
import {verifyFirstRoundDemoEvidence} from './first-round-evidence';

export const DATASET_SCHEMA='ohuo-distill-dataset-v2' as const;
export const SAMPLE_SCHEMA='ohuo-distill-decision-v2' as const;
export const CANDIDATE_DATASET_SCHEMA='ohuo-distill-dataset-candidate-v3' as const;
export const FIRST_ROUND_DATASET_SCHEMA='ohuo-distill-dataset-first-round-v4' as const;
export const FIRST_ROUND_SAMPLE_SCHEMA='ohuo-distill-decision-first-round-v4' as const;
const isFirstRoundPlan=(p:any)=>p?.schema==='ohuo-distill-plan-first-round-v3';
export const CANDIDATE_SAMPLE_SCHEMA='ohuo-distill-decision-candidate-v3' as const;
type Split='train'|'dev';
type Ref={id:string;sha256:string};
type BaseIdentity={policyId:string;weightsSHA256?:string;encoderVersion:string;inputDim:number;[key:string]:unknown};
export interface DatasetIdentities {proposalEncoderConfig?:Record<string,unknown>;studentParentRef?:string;studentScorer?:any;migrationReceiptRef?:Ref;candidatePolicy?:CandidatePolicySpec;basePolicy:BaseIdentity;teacher:{releaseRef:string;promptRef:string;profileSnapshot:Record<string,unknown>};encoderVersion:string;encoderConfig:Record<string,unknown>;candidateSpecRef:string;promptRef:string}
export interface FamilyBinding {sourceFamily:string;split:Split;sourceRefs:string[]}
export interface GameBinding {actualSourceFamily?:string;matchId:string;gameNo:number;sourceFamily:string;split:Split;sourceRef:string;sourceSHA256:string;actorSeat:number}
export interface DatasetPlan {researchProtocol?:{id:'first-round-common-view-r2';revisionRef:string};schema:'ohuo-distill-plan-v1'|'ohuo-distill-plan-candidate-v2'|'ohuo-distill-plan-first-round-v3';datasetId:string;purpose:'engineering_fixture'|'stage4'|'first-round-partner-control';sourceIndexRef:string;sourceIndexSHA256:string;queueRef:string;queueSHA256:string;samplingRef:string;identities:DatasetIdentities;families:FamilyBinding[];games:GameBinding[]}
/** Exact B07 JSON boundary; candidateInputs is materialized by its owner from
 * each initial-C action, not reconstructed here from features or rankings. */
export interface DecisionInput {schema:'ohuo-decision-input-v1'|'ohuo-decision-input-candidate-v2'|'ohuo-decision-input-first-round-v3';studentInputs?:StudentCandidateInputs;enumSpec?:EnumSpec;key:DecisionKey;policyId:string;observation:{decisionId:string;matchId:string;gameNo:number;moveNo:number;actorSeat:number;[key:string]:unknown};candidateSpec:string;initialCandidateIds:string[];pool:FrozenCandidate[];candidateInputs:null|{encoderVersion:string;policyId:string;inputDim:number;candidateIds:string[];candidateFeatures:number[][];rawQ:number[];policyIdentity:BaseIdentity;encoder:Record<string,unknown>;[key:string]:unknown}}
export interface DecisionRecord {key:DecisionKey;policyId:string;initialCandidateIds:string[];offeredIds:string[];requestedActionId:string|null;actualActionId:string|null;actualMove:any;actualSource:string|null;status:string;reason:string|null;executionKind:string;trainingInputSHA256:string|null;requests:Array<Record<string,unknown>>;[key:string]:unknown}
export interface MatchInput {schema:'ohuo-confirmed-match-v1';matchId:string;sourceRef:string;seatSnapshots?:any[];decisions:DecisionRecord[];[key:string]:unknown}
export interface OfflineLabel {schema:'ohuo-offline-choose-v1';inputSHA256:string;key:DecisionKey;remote:RemoteDecisionResult;teacher:DatasetIdentities['teacher'];canonicalId:string|null;legality:'validated'|'not-selected'}
export interface ExportRow {firstRoundValidation?:{evidenceGrade:'provisional_screened'|'strong_supported';direction:'pass'|'takeover';validationRef:Ref};sampleKind:'demo'|'keep';sampleClass:'target'|'ordinary';match:MatchInput;record:DecisionRecord;privateInput:DecisionInput;offlineLabel?:OfflineLabel}
interface SampleBase {schema:typeof SAMPLE_SCHEMA|typeof CANDIDATE_SAMPLE_SCHEMA|typeof FIRST_ROUND_SAMPLE_SCHEMA;proposalRawQ?:number[];studentParentRef?:string;evidenceGrade?:string;direction?:string;validationRef?:Ref;candidatePolicy?:CandidatePolicySpec;sampleKind:'demo'|'keep';sampleClass:'target'|'ordinary';decisionId:string;sourceFamily:string;sourceRef:string;split:Split;key:DecisionKey;observationRef:Ref;contextSHA256:string;encoderVersion:string;candidateSpecRef:string;candidateIds:string[];candidateOriginalIndices:number[];candidateCanonicalIds:string[];candidateFeatures:number[][];rawQ:number[];baseActionId:string;basePolicyRef:Ref;qualityFlags:string[];provenance:{inputSHA256:string;recordSHA256:string;matchSHA256:string;samplingRef:string}}
export type DistillSample=(SampleBase&{sampleKind:'demo';targetIds:string[];teacherPolicyRef:Ref;labelKind:'teacher_action';executionKind:'committed'|'offline_suggested';labelSourceRef:Ref})|(SampleBase&{sampleKind:'keep'});
export interface FrozenDatasetRef {directory:string;manifestSHA256:string}
export interface Exclusion {decisionId:string|null;sampleKind:string;sourceFamily:string|null;reason:string;terminalStatus:string|null;terminalReason:string|null;executionKind:string|null;recordSHA256:string}
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export const dataHash=(v:unknown)=>hash(JSON.stringify(v));
const ref=(id:string,value:unknown):Ref=>({id,sha256:dataHash(value)});
class Rejected extends Error {constructor(readonly reason:string){super(reason);}}
function reject(reason:string):never {throw new Rejected(reason);}
const nonempty=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const uniqueStrings=(v:unknown):v is string[]=>Array.isArray(v)&&v.length>0&&v.every(nonempty)&&new Set(v).size===v.length;
const equal=isDeepStrictEqual;
const PROFILE_FIELDS=['profileId','revision','snapshotHash','credentialRevision','protocol','requestedModel'] as const;
function checkTeacher(teacher:DatasetIdentities['teacher'],requests:Array<Record<string,unknown>>){
 if(!Array.isArray(requests)||!requests.length||requests.some(r=>r.requestCount!==1||PROFILE_FIELDS.some(k=>r[k]!==teacher.profileSnapshot[k])))reject('teacher_request_identity');
}
/** Read-only adapter for the shared selector's final result. The caller must
 * supply the original unmodified state. This is NOT a collect/label runner. */
export function prepareOfflineLabel({input,remote,state,history,teacher}:{input:DecisionInput;remote:RemoteDecisionResult;state:GameState;history:PublicHistoryPrefix;teacher:DatasetIdentities['teacher']}):OfflineLabel {
 if(!equal(input.key,remote.decisionKey)||state.match.gameNo!==input.key.gameNo||state.moveNo!==input.key.moveNo||state.turn!==input.key.actorSeat)reject('offline_context_identity');
 if(!equal(buildObservation({state,actorSeat:input.key.actorSeat,decisionId:input.observation.decisionId,matchId:input.key.matchId,history}),input.observation))reject('offline_observation_identity');
 let canonicalId:string|null=null;
 if(remote.status==='selected'){
  checkTeacher(teacher,[...remote.attempts] as unknown as Array<Record<string,unknown>>);
  const action=input.pool.find(c=>c.actionId===remote.actionId);
  if(!action||!remote.offeredIds.includes(action.actionId))reject('unknown_target');
  resolveLegalMove(state,action.canonical===null?{pass:true}:{pass:false,combo:action.canonical});
  canonicalId=canonicalActionId(action.canonical,state.ctx);
  if(canonicalId!==action.canonicalId||remote.inInitialCandidateSet!==input.initialCandidateIds.includes(action.actionId))reject('canonical_identity');
 }
 return structuredClone({schema:'ohuo-offline-choose-v1',inputSHA256:dataHash(input),key:input.key,remote,teacher,canonicalId,legality:remote.status==='selected'?'validated':'not-selected'});
}
/** Named candidate-only adaptation. It grants no new research qualification. */
function planCandidatePolicy(plan:DatasetPlan):CandidatePolicySpec {
 const policy=resolveCandidatePolicy(plan.identities?.candidatePolicy);
 if(isFirstRoundPlan(plan)){
  if(policy.candidateSpec!==FIRST_TARGET_CANDIDATE_SPEC||plan.identities.candidateSpecRef!==policy.candidateSpec||!['first-round-partner-control','engineering_fixture'].includes(plan.purpose))reject('first_round_plan_identity');
 }else if(plan.schema==='ohuo-distill-plan-candidate-v2'){
  if(policy.candidateSpec!==FIRST_TARGET_CANDIDATE_SPEC||plan.identities.candidateSpecRef!==policy.candidateSpec)reject('candidate_plan_identity');
  if(plan.purpose!=='engineering_fixture')reject('candidate_research_contract_not_yet_qualified');
 }else if(plan.identities?.candidatePolicy!==undefined||plan.identities?.candidateSpecRef===FIRST_TARGET_CANDIDATE_SPEC)reject('candidate_plan_schema');
 return policy;
}
function validatePlan(plan:DatasetPlan,index?:any){
 if(plan?.researchProtocol!==undefined){if(!isFirstRoundPlan(plan))reject('r2_protocol_requires_first_round_plan');isFirstRoundR2DatasetPlan(plan);}
 if(!isFirstRoundPlan(plan)&&!['engineering_fixture','stage4'].includes(plan?.purpose))reject('plan_identity');
 if(!['ohuo-distill-plan-v1','ohuo-distill-plan-candidate-v2','ohuo-distill-plan-first-round-v3'].includes(plan?.schema)||!nonempty(plan.datasetId)||!['engineering_fixture','stage4','first-round-partner-control'].includes(plan.purpose)||!nonempty(plan.sourceIndexRef)||!sha(plan.sourceIndexSHA256)||!nonempty(plan.queueRef)||!sha(plan.queueSHA256)||!nonempty(plan.samplingRef))reject('plan_identity');
 planCandidatePolicy(plan);
 const ids=plan.identities,b=ids?.basePolicy,t=ids?.teacher,firstRound=isFirstRoundPlan(plan),encoder=firstRound?ids?.proposalEncoderConfig:ids?.encoderConfig;
 if(firstRound){const scorer=validateStudentScorerDescriptor(ids.studentScorer);if(b?.encoderVersion!=='gd-lab-schema-v4'||!equal(encoder,{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'}))reject('first_round_proposal_encoder_identity');if(ids.encoderVersion!=='student-input399plus24-v1'||!equal(ids.encoderConfig,STUDENT_SCORER_ENCODER)||!nonempty(ids.studentParentRef)||!/@sha256:[a-f0-9]{64}$/.test(ids.studentParentRef!)||!sha(ids.migrationReceiptRef?.sha256)||!nonempty(ids.migrationReceiptRef?.id)||scorer.inputDim!==423)reject('first_round_parent_identity');}
 if(!b||b.inputDim!==399||!nonempty(b.policyId)||(plan.purpose==='stage4'?!sha(b.weightsSHA256):b.weightsSHA256!==undefined&&!sha(b.weightsSHA256))||(!firstRound&&b.encoderVersion!==ids.encoderVersion)||!nonempty(ids.encoderVersion)||encoder?.schema!=='v2'||!['zero','rule-context'].includes(encoder!.ctxFill as string)||!['action64','legacy-phys10'].includes(encoder!.passEncoding as string)||(b.passEncoding!==undefined?encoder!.passEncoding!==b.passEncoding:plan.purpose==='stage4')||!nonempty(ids.candidateSpecRef)||!nonempty(ids.promptRef)||!t||!nonempty(t.releaseRef)||t.promptRef!==ids.promptRef||!t.profileSnapshot||PROFILE_FIELDS.some(k=>t.profileSnapshot[k]===undefined))reject('frozen_policy_identity');
 if(!Array.isArray(plan.families)||!plan.families.length||!Array.isArray(plan.games))reject('source_bindings');
 const families=new Map<string,FamilyBinding>(),sources=new Map<string,string>();
 for(const family of plan.families){
  if(!nonempty(family.sourceFamily)||families.has(family.sourceFamily)||!['train','dev'].includes(family.split)||!uniqueStrings(family.sourceRefs))reject('family_split_conflict');
  if(index&&(index.version!==1||index.families?.[family.sourceFamily]?.split!==family.split))reject('source_index_split');
  for(const source of family.sourceRefs){if(sources.has(source)&&sources.get(source)!==family.sourceFamily)reject('source_family_alias');sources.set(source,family.sourceFamily);}
  families.set(family.sourceFamily,family);
 }
 const games=new Set<string>(),dealOwners=new Map<string,string>();
 for(const game of plan.games){const family=families.get(game.sourceFamily),id=JSON.stringify([game.matchId,game.gameNo]);
  if(firstRound){const actual=game.actualSourceFamily??game.sourceFamily;if(plan.purpose==='first-round-partner-control'&&!nonempty(game.actualSourceFamily))reject('first_round_actual_deal_family_required');if(index&&index.families?.[actual]?.split!==game.split)reject('source_index_split');for(const identity of (plan.purpose==='first-round-partner-control'?[actual,game.sourceSHA256]:[])){const owner=dealOwners.get(identity);if(owner&&owner!==game.sourceFamily)reject('first_round_deal_cross_block');dealOwners.set(identity,game.sourceFamily);}}
  if(!family||game.split!==family.split||!family.sourceRefs.includes(game.sourceRef)||!sha(game.sourceSHA256)||!nonempty(game.matchId)||!Number.isSafeInteger(game.gameNo)||game.gameNo<1||!Number.isInteger(game.actorSeat)||game.actorSeat<0||game.actorSeat>3||games.has(id))reject('game_family_binding');games.add(id);
 }
}
function admit(row:ExportRow,plan:DatasetPlan):DistillSample {
 const {record:d,privateInput:p,match}=row;
 const firstRound=isFirstRoundPlan(plan),candidatePolicy=planCandidatePolicy(plan),newSpec=candidatePolicy.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC;
 if(!row||!['demo','keep'].includes(row.sampleKind)||!['target','ordinary'].includes(row.sampleClass)||row.sampleKind==='keep'&&row.sampleClass!=='ordinary')reject('sample_kind');
 if(match?.schema!=='ohuo-confirmed-match-v1'||!d?.key||match.matchId!==d.key.matchId||match.sourceRef!==plan.sourceIndexRef||match.layoutRef!==plan.queueRef||!Array.isArray(match.games)||!Array.isArray(match.decisions)||!match.decisions.some(r=>equal(r,d)))reject('record_identity');
 const binding=plan.games.find(g=>g.matchId===d.key.matchId&&g.gameNo===d.key.gameNo);
 if(!binding||binding.actorSeat!==d.key.actorSeat||match.evaluatedActor!==binding.actorSeat||match.split!==binding.split||(match.games as Array<any>)?.find(g=>g.gameNo===d.key.gameNo)?.sourceSHA256!==binding.sourceSHA256||(match.games as Array<any>)?.find(g=>g.gameNo===d.key.gameNo)?.sourceFamilyId!==(firstRound?(binding.actualSourceFamily??binding.sourceFamily):binding.sourceFamily))reject('sample_actor_or_family');
 if(p?.schema!==(firstRound?'ohuo-decision-input-first-round-v3':newSpec?'ohuo-decision-input-candidate-v2':'ohuo-decision-input-v1')||!equal(p.key,d.key)||!sha(d.trainingInputSHA256)||dataHash(p)!==d.trainingInputSHA256)reject('private_input_identity');
 const obs=p.observation,ids=plan.identities,seat=match.seatSnapshots?.[d.key.actorSeat];
 if(!obs||!nonempty(obs.decisionId)||obs.matchId!==d.key.matchId||obs.gameNo!==d.key.gameNo||obs.moveNo!==d.key.moveNo||obs.actorSeat!==d.key.actorSeat)reject('observation_identity');
 if(!equal(seat?.policyIdentity,ids.basePolicy)||d.policyId!==ids.basePolicy.policyId||p.policyId!==ids.basePolicy.policyId||p.candidateSpec!==ids.candidateSpecRef)reject('base_policy_identity');
 if(firstRound&&(!equal((seat as any)?.firstRoundCapture,{studentParentRef:ids.studentParentRef,scorer:ids.studentScorer,migrationReceiptRef:ids.migrationReceiptRef})||match.policyIds[d.key.actorSeat]!==ids.basePolicy.policyId||d.actualSource!=='B'))reject('first_round_source_capture_identity');
 const x=p.candidateInputs;
 if(newSpec&&(!equal(p.enumSpec,candidatePolicy.enumSpec)||resolveCandidatePolicy(x?.candidatePolicy as CandidatePolicySpec|undefined)!==candidatePolicy||!equal(d.offeredIds,p.initialCandidateIds)))reject('candidate_contract_alignment');
 if(!newSpec&&(p.enumSpec!==undefined||x?.candidatePolicy!==undefined))reject('candidate_legacy_schema');
 if(!x||x.inputDim!==399||x.encoderVersion!==(firstRound?ids.basePolicy.encoderVersion:ids.encoderVersion)||x.policyId!==ids.basePolicy.policyId||!equal(x.policyIdentity,ids.basePolicy)||!equal(x.encoder,firstRound?ids.proposalEncoderConfig:ids.encoderConfig))reject('candidate_input_identity');
 if(!uniqueStrings(p.initialCandidateIds)||p.initialCandidateIds.length>(newSpec?12:8)||!equal(p.initialCandidateIds,d.initialCandidateIds)||!equal(p.initialCandidateIds,x.candidateIds))reject('initial_c_alignment');
 if(!Array.isArray(p.pool)||p.pool.some(c=>!c||typeof c!=='object')||!uniqueStrings(p.pool.map(c=>c.actionId))||p.pool.some(c=>!finite(c.rawQ)||!Number.isSafeInteger(c.originalIndex)||c.originalIndex<0||c.originalIndex>=p.pool.length)||new Set(p.pool.map(c=>c.originalIndex)).size!==p.pool.length)reject('candidate_pool');
 if(!Array.isArray(x.rawQ)||x.rawQ.length!==x.candidateIds.length)reject('rawq_length');
 if(!Array.isArray(x.candidateFeatures)||x.candidateFeatures.length!==x.candidateIds.length)reject('feature_shape');
 // One action lookup supplies its identity and rawQ, alongside the B07 vector
 // explicitly keyed by that ID. No independently sorted numeric columns.
 const actions=x.candidateIds.map((id,i)=>{
  const action=p.pool.find(c=>c.actionId===id);if(!action)reject('candidate_missing');
  let canonical:string;try{canonical=canonicalActionId(action.canonical);}catch{reject('canonical_identity');}
  if(canonical!==action.canonicalId)reject('canonical_identity');
  if(!finite(action.rawQ)||!finite(x.rawQ[i])||action.rawQ!==x.rawQ[i])reject('rawq_action_alignment');
  if(!Array.isArray(x.candidateFeatures[i])||x.candidateFeatures[i].length!==399||!x.candidateFeatures[i].every(finite))reject('feature_shape');
  return {action,features:[...x.candidateFeatures[i]],rawQ:action.rawQ};
 });
 const student=p.studentInputs;
 if(firstRound){if(!student||student.schema!=='ohuo-student-candidate-input-v1'||student.inputDim!==423||student.studentParentRef!==ids.studentParentRef||!equal(student.scorer,ids.studentScorer)||!equal(student.inputContract,STUDENT_SCORER_ENCODER)||!equal(student.candidatePolicy,candidatePolicy)||!equal(student.candidateIds,x.candidateIds)||student.candidateFeatures.length!==actions.length||student.rawQ.length!==actions.length||student.rawQ.some(q=>!finite(q))||student.candidateFeatures.some((f,i)=>f.length!==423||f.some(v=>!finite(v)||Math.fround(v)!==v)||!equal(f.slice(0,399),actions[i].features)))reject('first_round_student_capture_identity');}
 const baseAction=p.pool.reduce((best,a)=>a.rawQ>best.rawQ||a.rawQ===best.rawQ&&a.originalIndex<best.originalIndex?a:best);
 if(!x.candidateIds.includes(baseAction.actionId))reject('base_action_outside_c');
 const {decisionId:_decision,matchId:_match,...causalObservation}=obs;
 const common:SampleBase={schema:firstRound?FIRST_ROUND_SAMPLE_SCHEMA:newSpec?CANDIDATE_SAMPLE_SCHEMA:SAMPLE_SCHEMA,...(newSpec?{candidatePolicy}:{}),sampleKind:row.sampleKind,sampleClass:row.sampleClass,decisionId:obs.decisionId,sourceFamily:binding.sourceFamily,sourceRef:binding.sourceRef,split:binding.split,key:structuredClone(d.key),observationRef:ref(obs.decisionId,obs),contextSHA256:dataHash([binding.sourceFamily,causalObservation,actions.map(a=>a.action.canonicalId)]),encoderVersion:ids.encoderVersion,candidateSpecRef:ids.candidateSpecRef,candidateIds:actions.map(a=>a.action.actionId),candidateOriginalIndices:actions.map(a=>a.action.originalIndex),candidateCanonicalIds:actions.map(a=>a.action.canonicalId),candidateFeatures:firstRound?student!.candidateFeatures:actions.map(a=>a.features),rawQ:firstRound?student!.rawQ:actions.map(a=>a.rawQ),baseActionId:firstRound?student!.baseActionId:baseAction.actionId,...(firstRound?{proposalRawQ:actions.map(a=>a.rawQ),studentParentRef:ids.studentParentRef}:{} ),basePolicyRef:ref(ids.basePolicy.policyId,ids.basePolicy),qualityFlags:[],provenance:{inputSHA256:dataHash(p),recordSHA256:dataHash(d),matchSHA256:dataHash(match),samplingRef:plan.samplingRef}};
 if(row.sampleKind==='keep'){
  if(row.offlineLabel)reject('keep_has_teacher_label');
  return {...common,sampleKind:'keep'};
 }
 let target:string,executionKind:'committed'|'offline_suggested',labelSource:unknown;
 if(row.offlineLabel){
  const label=row.offlineLabel;
  if(!label.remote||label.schema!=='ohuo-offline-choose-v1'||label.inputSHA256!==d.trainingInputSHA256||!equal(label.key,d.key)||!equal(label.remote.decisionKey,d.key)||!equal(label.teacher,ids.teacher))reject('offline_label_identity');
  if(label.remote.status!=='selected'||label.legality!=='validated')reject('not_final_teacher_choose');
  target=label.remote.actionId;executionKind='offline_suggested';labelSource=label;
  checkTeacher(ids.teacher,[...label.remote.attempts] as unknown as Array<Record<string,unknown>>);
  const action=p.pool.find(c=>c.actionId===target);
  if(!action||!label.remote.offeredIds.includes(target))reject('unknown_target');
  if(newSpec&&!equal(label.remote.offeredIds,p.initialCandidateIds))reject('candidate_teacher_set_alignment');
  if(action.canonicalId!==label.canonicalId||label.remote.inInitialCandidateSet!==p.initialCandidateIds.includes(target))reject('canonical_identity');
 }else{
  if(d.status!=='selected'||d.actualSource!=='remote'||d.executionKind!=='confirmed')reject('not_final_teacher_choose');
  if(seat.releaseRef!==ids.teacher.releaseRef||seat.release?.promptRef!==ids.promptRef||!equal(seat.profileSnapshot,ids.teacher.profileSnapshot))reject('teacher_snapshot_identity');
  checkTeacher(ids.teacher,d.requests);target=d.actualActionId!;executionKind='committed';labelSource=d;
  const action=p.pool.find(c=>c.actionId===target);
  if(!action)reject('unknown_target');
  if(d.requestedActionId!==target||!d.offeredIds.includes(target)||!equal(d.actualMove,action.canonical===null?{pass:true}:{pass:false,combo:action.canonical}))reject('canonical_identity');
 }
 if(!common.candidateIds.includes(target))reject('target_outside_initial_c');
 if(firstRound){const v=row.firstRoundValidation;if(!v||Object.keys(v).sort().join(',')!=='direction,evidenceGrade,validationRef'||!['provisional_screened','strong_supported'].includes(v.evidenceGrade)||!sha(v.validationRef?.sha256)||!nonempty(v.validationRef?.id)||v.direction!==(actions.find(a=>a.action.actionId===target)!.action.canonical===null?'pass':'takeover'))reject('first_round_validation_missing');Object.assign(common,v);}
 return {...common,sampleKind:'demo',targetIds:[target],teacherPolicyRef:ref(ids.teacher.releaseRef,ids.teacher),labelKind:'teacher_action',executionKind,labelSourceRef:ref(obs.decisionId+':teacher',labelSource)};
}
function validateSample(s:any,plan:DatasetPlan){
 const firstRound=isFirstRoundPlan(plan),candidatePolicy=planCandidatePolicy(plan),newSpec=candidatePolicy.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC;
 const keys=['schema','sampleKind','sampleClass','decisionId','sourceFamily','sourceRef','split','key','observationRef','contextSHA256','encoderVersion','candidateSpecRef','candidateIds','candidateOriginalIndices','candidateCanonicalIds','candidateFeatures','rawQ','baseActionId','basePolicyRef','qualityFlags','provenance'];
 if(newSpec)keys.push('candidatePolicy');if(firstRound)keys.push('proposalRawQ','studentParentRef');
 if(s?.sampleKind==='demo'){keys.push('targetIds','teacherPolicyRef','labelKind','executionKind','labelSourceRef');if(firstRound)keys.push('evidenceGrade','direction','validationRef');}
 if(!s||Object.keys(s).sort().join()!==keys.sort().join()||s.schema!==(firstRound?FIRST_ROUND_SAMPLE_SCHEMA:newSpec?CANDIDATE_SAMPLE_SCHEMA:SAMPLE_SCHEMA)||!['demo','keep'].includes(s.sampleKind)||!['target','ordinary'].includes(s.sampleClass)||s.sampleKind==='keep'&&s.sampleClass!=='ordinary')reject('sample_schema');
 if(newSpec&&resolveCandidatePolicy(s.candidatePolicy)!==candidatePolicy)reject('sample_candidate_identity');
 const g=plan.games.find(g=>g.matchId===s.key?.matchId&&g.gameNo===s.key?.gameNo);
 if(!g||s.key.actorSeat!==g.actorSeat||s.sourceFamily!==g.sourceFamily||s.sourceRef!==g.sourceRef||s.split!==g.split||!nonempty(s.decisionId)||!sha(s.contextSHA256))reject('sample_source');
 if(s.encoderVersion!==plan.identities.encoderVersion||s.candidateSpecRef!==plan.identities.candidateSpecRef||!equal(s.basePolicyRef,ref(plan.identities.basePolicy.policyId,plan.identities.basePolicy)))reject('sample_identity');
 const k=s.candidateIds?.length;
 if(!Array.isArray(s.candidateOriginalIndices)||s.candidateOriginalIndices.length!==k||s.candidateOriginalIndices.some((i:unknown)=>!Number.isSafeInteger(i)||(i as number)<0)||new Set(s.candidateOriginalIndices).size!==k)reject('sample_original_indices');
 if(!uniqueStrings(s.candidateIds)||k>(newSpec?12:8)||!uniqueStrings(s.candidateCanonicalIds)||s.candidateCanonicalIds.length!==k||!s.candidateIds.includes(s.baseActionId)||!Array.isArray(s.rawQ)||s.rawQ.length!==k||!s.rawQ.every(finite)||!Array.isArray(s.candidateFeatures)||s.candidateFeatures.length!==k||!s.candidateFeatures.every((f:unknown)=>Array.isArray(f)&&f.length===(firstRound?423:399)&&f.every(finite)))reject('sample_vectors');
 if(firstRound){
  if(s.studentParentRef!==plan.identities.studentParentRef||!Array.isArray(s.proposalRawQ)||s.proposalRawQ.length!==k||!s.proposalRawQ.every(finite)||s.candidateFeatures.some((f:number[])=>f.some(v=>Math.fround(v)!==v)))reject('first_round_sample_identity');
  let best=0;for(let i=1;i<k;i++)if(s.rawQ[i]>s.rawQ[best]||s.rawQ[i]===s.rawQ[best]&&s.candidateOriginalIndices[i]<s.candidateOriginalIndices[best])best=i;if(s.baseActionId!==s.candidateIds[best])reject('first_round_S0_top_identity');
  if(s.sampleKind==='demo'&&(!['provisional_screened','strong_supported'].includes(s.evidenceGrade)||!['pass','takeover'].includes(s.direction)||!sha(s.validationRef?.sha256)||!nonempty(s.validationRef?.id)||s.targetIds?.some((id:string)=>(s.candidateCanonicalIds[s.candidateIds.indexOf(id)]==='pass'?'pass':'takeover')!==s.direction)))reject('first_round_demo_evidence_identity');
 }
 if(!Array.isArray(s.qualityFlags)||s.qualityFlags.some((q:unknown)=>!nonempty(q))||!sha(s.observationRef?.sha256)||s.observationRef.id!==s.decisionId||s.provenance?.samplingRef!==plan.samplingRef||!['inputSHA256','recordSHA256','matchSHA256'].every(k=>sha(s.provenance[k])))reject('sample_provenance');
 if(s.sampleKind==='demo'&&(!uniqueStrings(s.targetIds)||s.targetIds.some((id:string)=>!s.candidateIds.includes(id))||s.labelKind!=='teacher_action'||!['committed','offline_suggested'].includes(s.executionKind)||!equal(s.teacherPolicyRef,ref(plan.identities.teacher.releaseRef,plan.identities.teacher))||!sha(s.labelSourceRef?.sha256)||!nonempty(s.labelSourceRef?.id)))reject('sample_teacher');
}
function summarize(samples:DistillSample[],exclusions:Exclusion[],plan:DatasetPlan){
 if(isFirstRoundPlan(plan)){const qualification=firstRoundCoverage(samples,plan.families,plan.researchProtocol);if(plan.purpose==='engineering_fixture'){qualification.eligible=false;qualification.reasons.push('engineering_fixture_not_training');}const byReason:Record<string,number>={};for(const e of exclusions)byReason[e.reason]=(byReason[e.reason]??0)+1;return{counts:{attempted:samples.length+exclusions.length,valid:{demo:qualification.counts.train.demo+qualification.counts.dev.demo,keep:qualification.counts.train.keep+qualification.counts.dev.keep,...qualification.counts},excluded:exclusions.length,byReason},familyCounts:qualification.familyCounts,qualification};}
 const valid={demo:0,keep:0,train:{demo:0,keep:0},dev:{demo:0,keep:0}},byReason:Record<string,number>={};
 const families=plan.families.map(f=>({...f,demo:0,keep:0,target:0,ordinary:0,targetDisagreements:0}));
 for(const row of samples){valid[row.sampleKind]++;valid[row.split][row.sampleKind]++;const f=families.find(f=>f.sourceFamily===row.sourceFamily)!;f[row.sampleKind]++;
  if(row.sampleKind==='demo'){f[row.sampleClass]++;if(row.sampleClass==='target'&&!row.targetIds.includes(row.baseActionId))f.targetDisagreements++;}
 }
 for(const e of exclusions)byReason[e.reason]=(byReason[e.reason]??0)+1;
 const reasons:string[]=[];if(plan.purpose!=='stage4')reasons.push('engineering_fixture_not_training');
 if(families.filter(f=>f.split==='train').length!==16||families.filter(f=>f.split==='dev').length!==4)reasons.push('requires_16_train_4_dev_families');
 if(families.some(f=>f.target<1||f.ordinary<1))reasons.push('family_target_or_ordinary_missing');
 if(families.some(f=>f.demo>32))reasons.push('family_demo_quota_exceeded');
 const train=families.filter(f=>f.split==='train'),dev=families.filter(f=>f.split==='dev');
 if(train.reduce((n,f)=>n+f.targetDisagreements,0)<32)reasons.push('train_target_disagreements_below_32');
 if(dev.reduce((n,f)=>n+f.targetDisagreements,0)<8||dev.filter(f=>f.targetDisagreements>0).length<2)reasons.push('dev_target_disagreements_coverage');
 if(valid.train.demo<32)reasons.push('train_ndemo_below_32');
 if(!valid.train.keep||!valid.dev.keep)reasons.push('keep_split_missing');
 return {counts:{attempted:samples.length+exclusions.length,valid,excluded:exclusions.length,byReason},familyCounts:families,qualification:{eligible:reasons.length===0,reasons,Ndemo:valid.train.demo,scope:'section-14 engineering coverage only; no teacher-strength or training authorization claim'}};
}
function exclusion(row:ExportRow,reason:string,plan:DatasetPlan):Exclusion{return {decisionId:row.privateInput?.observation?.decisionId??null,sampleKind:row.sampleKind,sourceFamily:plan.games.find(g=>g.matchId===row.record?.key?.matchId&&g.gameNo===row.record?.key?.gameNo)?.sourceFamily??null,reason,terminalStatus:row.record?.status??null,terminalReason:row.record?.reason??null,executionKind:row.record?.executionKind??null,recordSHA256:dataHash(row.record??null)};}
export interface DatasetSelectionProof {selection:any;production:any;resolvedInputs:OfflineSelectionTrustedInputs}
/** Only the fixed host supplies this proof. Roles and original input bytes are
 * reproduced from the full selection, never inferred from successful labels. */
function originalLabelTerminalIndex(run:any,selection:any,key:string,t:OfflineSelectionTrustedInputs,plan:DatasetPlan){
 let routing:any=undefined;
 if(isFirstRoundR2DatasetPlan(plan)){
  const ruleRef=run.task.scientificContract?.decisionRuleRef,rule=t.references.get(ruleRef);
  if(rule?.schema!=='ohuo-common-view-teacher-contract-r2'||digest(rule)!==ruleRef?.split(':').at(-1)||rule.protocolRef!==plan.researchProtocol!.revisionRef)reject('r2_label_task_rule_identity');
  routing=t.references.get(rule.routingRef);
  if(!routing||routing.schema!=='ohuo-common-view-teacher-routing-r2'||digest(routing)!==rule.routingRef.split(':').at(-1)||routing.protocolRef!==rule.protocolRef||!['primary','independent-review','model-substitution'].includes(routing.role))reject('r2_label_task_routing_identity');
 }
 return firstRoundOwnedLabelRows(selection.rows,run.task.sourcePlan,routing).findIndex((p:any)=>canonical(p.key)===key);
}
function selectedRows(plan:DatasetPlan,rows:ExportRow[],selectionProof:DatasetSelectionProof){
 const t=selectionProof.resolvedInputs;if((plan.purpose==='stage4'||plan.purpose==='first-round-partner-control')&&t.mode!=='research')reject('synthetic_selection_not_stage4_evidence');if(t.phase!=='dataset')reject('selection_dataset_phase_required');
 const verified=verifyOfflineSelection(selectionProof.selection,t),{production,selection,spec,budgetRef,selectedMetadata,population}=verified;
 if(!equal(production,selectionProof.production)||production.verification!=='reproduced'||selection.purpose!=='b_training_source'||spec.purpose!=='b_training_source'||plan.samplingRef!==selection.productionRef||plan.sourceIndexRef!==spec.sourceIndexRef||plan.queueRef!==spec.queueRef)reject('stage4_selection_production_binding');
 if(plan.purpose==='first-round-partner-control'){const rule=t.references.get(production.selectionRuleRef);if((isFirstRoundR2DatasetPlan(plan)?rule?.schema!=='ohuo-offline-selection-common-view-r2'||rule.protocolRef!==plan.researchProtocol!.revisionRef:rule?.schema!=='ohuo-offline-selection-first-round-rule-v1')||rule.postValidationKeepRule!=='same-split-frozen-rank-prefix-equal-valid-demo')reject('first_round_formal_selection_required');}
 const byKey=new Map<string,ExportRow>();for(const row of rows){const k=canonical(row.record?.key??null);if(byKey.has(k))reject('selection_duplicate_export_row');byKey.set(k,row);}if(rows.length!==selectedMetadata.length)reject('selection_full_preselected_rows_required');
 const teacherAttemptDiagnostics:any[]=[],terminals=new Map<string,any>(),selectionRef=referenceOf(`offline-label-selection/${spec.outputId}`,selection),control=JSON.parse(readFileSync(join(t.controlRoot,'state.json'),'utf8'));
 if(control.schemaVersion!==1||!control.runs)reject('selection_label_ledger_missing');
 for(const f of t.labelTerminalRefs??[]){
  if(!f||Object.keys(f).sort().join(',')!=='id,sha256'||typeof f.id!=='string'||!f.id||!sha(f.sha256))reject('selection_terminal_catalog');const mapped=t.evidenceFiles.get(f.id);if(!mapped||Object.keys(mapped).sort().join(',')!=='path,sha256'||mapped.sha256!==f.sha256||isAbsolute(mapped.path)||mapped.path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))reject('selection_terminal_catalog');const path=resolve(t.repositoryRoot,mapped.path);if(realpathSync(path)!==path||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())reject('selection_terminal_file');const bytes=readFileSync(path);if(hash(bytes)!==f.sha256)reject('selection_terminal_file');const terminal=JSON.parse(bytes.toString()),k=canonical(terminal.key);
  const original=selection.rows.find((r:any)=>canonical(r.key)===k);
  if(terminal.schema!=='ohuo-offline-label-result-v1'||terminal.purpose!=='b_training_source'||terminal.selectionRef!==selectionRef||!original||!equal(terminal.source,original)||terminal.inputSHA256!==original.inputSHA256)reject('selection_terminal_identity');const ledgerRows=Object.values(control.runs).flatMap((r:any)=>r.taskSHA256===digest(r.task)&&r.checkpointSHA256===digest(r.checkpoint)&&typeof r.checkpointRef==='string'&&r.checkpointRef===join(r.task.outputRoot,`checkpoint-${r.checkpointSHA256}.json`)&&realpathSync(r.checkpointRef)===r.checkpointRef&&digest(JSON.parse(readFileSync(r.checkpointRef,'utf8')))===r.checkpointSHA256&&equal(r.task.datasetRefs,[selectionRef])&&r.task.planRef===spec.planRef&&r.task.budgetRef===budgetRef&&r.task.sourcePlan?.sourceIndexRef===spec.sourceIndexRef&&r.task.seatLayoutPlan===spec.queueRef&&r.task.parentPolicyRef===spec.actingReleaseRef&&r.task.releaseRefs?.includes(spec.actingReleaseRef)&&r.checkpoint?.schema==='ohuo-offline-label-run-v1'&&r.checkpoint.taskSHA256===r.taskSHA256&&r.checkpoint.selectionRef===selectionRef?(r.checkpoint.rows??[]).filter((q:any)=>terminal.index===originalLabelTerminalIndex(r,selection,k,t,plan)&&canonical(q.key)===k&&q.inputSHA256===original.inputSHA256&&q.resultRef?.path===path&&q.resultRef.sha256===f.sha256):[]);
  if(ledgerRows.length!==1||ledgerRows[0].status!==terminal.status||ledgerRows[0].labelKind!==terminal.labelKind)reject('selection_terminal_not_committed_in_label_ledger');
  if(isFirstRoundR2DatasetPlan(plan)&&!isFirstRoundTeachingTerminalFor(terminal,plan.identities.teacher)){teacherAttemptDiagnostics.push({terminalRef:f,key:terminal.key,status:terminal.status,teacherReleaseRef:terminal.teacher?.releaseRef??null,reason:terminal.commonView?.routingRole==='independent-review'?'independent_review_not_training_label':'non_selected_teacher_terminal',terminalReason:terminal.remote?.reason??null});continue;}
  if(terminals.has(k))reject('selection_duplicate_teacher_terminal');terminals.set(k,terminal);
 }
 for(const r of Object.values(control.runs) as any[])if(equal(r.task?.datasetRefs,[selectionRef])&&r.task?.planRef===spec.planRef){const blind=t.references.get(r.task.scientificContract?.decisionRuleRef);
  if(isFirstRoundR2DatasetPlan(plan)&&blind?.schema==='ohuo-common-view-teacher-contract-r2'){
   const routing=t.references.get(blind.routingRef);
   if(routing?.role==='independent-review'){
    if(digest(blind)!==r.task.scientificContract.decisionRuleRef.split(':').at(-1)||digest(routing)!==blind.routingRef.split(':').at(-1)||routing.schema!=='ohuo-common-view-teacher-routing-r2'||blind.protocolRef!==plan.researchProtocol!.revisionRef||routing.protocolRef!==blind.protocolRef||blind.selectionRef!==selectionRef||r.taskSHA256!==digest(r.task)||r.checkpointSHA256!==digest(r.checkpoint)||r.checkpoint?.schema!=='ohuo-offline-label-run-v1'||r.checkpoint.selectionRef!==selectionRef||!Array.isArray(routing.selected)||r.checkpoint.rows.some((q:any)=>q.labelKind!==null||!routing.selected.some((x:any)=>equal(x.key,q.key)&&x.inputSHA256===q.inputSHA256)))reject('r2_independent_review_terminal_binding');
    continue;
   }
  }
  if(blind?.schema==='ohuo-first-round-blind-review-contract-v1'){if(blind.batch!=='formal-data'||blind.selectionRef!==selectionRef||blind.secondaryLabelPolicyRef!==r.task.labelPolicyRef||r.task.scientificContract.decisionRuleRef.split(':').at(-1)!==digest(blind)||r.taskSHA256!==digest(r.task)||r.checkpointSHA256!==digest(r.checkpoint)||r.checkpoint?.schema!=='ohuo-offline-label-run-v1'||!equal(r.checkpoint.blindReview,{contractRef:r.task.scientificContract.decisionRuleRef,batchId:blind.batchId,purpose:'first_round_blind_diagnostic'})||r.checkpoint.rows.some((q:any)=>q.labelKind!==null))reject('first_round_blind_terminal_binding');continue;}for(const committed of r.checkpoint?.rows??[])if(!terminals.has(canonical(committed.key))&&!teacherAttemptDiagnostics.some(d=>canonical(d.key)===canonical(committed.key)))reject('selection_committed_terminal_omitted');}
 const normalized:ExportRow[]=[],missing=new Set<string>(),cache=new Map();
 for(const meta of selectedMetadata){
  const k=canonical(meta.key),row=byKey.get(k),source=population.find(p=>canonical(p.key)===k&&p.inputSHA256===meta.inputSHA256);if(!row||!source||row.privateInput?.observation?.decisionId!==meta.decisionId||dataHash(row.privateInput)!==meta.inputSHA256)reject('selection_export_row_identity');
  const s=readOfflineSnapshot(source,cache);if(!equal(row.match,s.record)||!equal(row.record,s.decision)||!equal(row.privateInput,s.input))reject('selection_original_record_identity');
  // Ignore no caller override: a disagreement is an error, while the value
  // actually written below is derived from the fixed metadata.
  if(row.sampleClass!==meta.sampleClass||row.sampleKind!==meta.sampleKind)reject('selection_export_role_mismatch');
  if(meta.sampleKind==='keep'){if(row.offlineLabel||terminals.has(k))reject('selection_keep_has_teacher');normalized.push({...row,sampleKind:'keep',sampleClass:'ordinary'});continue;}
  const terminal=terminals.get(k);if(!terminal){if(row.offlineLabel)reject('selection_unbound_label');missing.add(k);normalized.push({...row,sampleKind:'demo',sampleClass:meta.sampleClass});continue;}
  if(terminal.decisionId!==meta.decisionId||terminal.inputSHA256!==meta.inputSHA256||!equal(terminal.teacher,plan.identities.teacher)||!equal(terminal.offlineLabel??undefined,row.offlineLabel))reject('selection_label_terminal_binding');
  normalized.push({...row,sampleKind:'demo',sampleClass:meta.sampleClass});
 }
 return {rows:normalized,missing,terminals,selectedMetadata,teacherAttemptDiagnostics};
}
export function freezeDataset({plan,sourceIndexPath,sourceQueue,rows,outputDir,selectionProof}:{plan:DatasetPlan;sourceIndexPath:string;sourceQueue:any;rows:ExportRow[];outputDir:string;selectionProof?:DatasetSelectionProof}):FrozenDatasetRef {
 const firstRoundResearch=isFirstRoundPlan(plan)&&plan.purpose==='first-round-partner-control';
 if(firstRoundResearch&&!selectionProof)reject('first_round_selection_and_screen_proof_required');
 if(plan?.purpose==='stage4'&&!selectionProof)reject('stage4_selection_proof_required');
 const selectionRows=selectionProof?selectedRows(plan,rows,selectionProof):null;if(selectionRows)rows=selectionRows.rows;
 const indexBytes=readFileSync(sourceIndexPath);if(hash(indexBytes)!==plan.sourceIndexSHA256)reject('source_index_identity');validatePlan(plan,JSON.parse(indexBytes.toString()));
 if(dataHash(sourceQueue)!==plan.queueSHA256||sourceQueue?.schema!=='ohuo-complete-match-queue-v1'||sourceQueue.sourceIndexRef!==plan.sourceIndexRef||!Array.isArray(sourceQueue.rows))reject('source_queue_identity');
 for(const game of plan.games){const q=sourceQueue.rows.find((r:any)=>r.matchId===game.matchId);if(!q||q.roundFamilyIds?.[game.gameNo-1]!==(isFirstRoundPlan(plan)?(game.actualSourceFamily??game.sourceFamily):game.sourceFamily)||isFirstRoundPlan(plan)&&q.sourceFamilyId!==undefined&&q.sourceFamilyId!==game.sourceFamily||q.split!==game.split||q.actor!==game.actorSeat)reject('source_queue_game_binding');}
 const admitted:Array<{row:ExportRow;sample:DistillSample}>=[],exclusions:Exclusion[]=[];
 for(const row of rows){try{if(selectionRows?.missing.has(canonical(row.record.key)))reject('preselected_label_missing');if(firstRoundResearch&&row.sampleKind==='demo'){try{row.firstRoundValidation=verifyFirstRoundDemoEvidence({row,plan,proof:selectionProof});}catch(error){reject(error instanceof Error?error.message:'first_round_evidence_unverified');}}admitted.push({row,sample:admit(row,plan)});}catch(e){if(!(e instanceof Rejected))throw e;const item=exclusion(row,e.reason,plan),terminal=selectionRows?.terminals.get(canonical(row.record.key));if(terminal){item.terminalStatus=terminal.status;item.terminalReason=terminal.remote?.reason??(terminal.status==='execution_uncertain'?'execution_uncertain':null);item.executionKind='offline_suggested';}else if(selectionRows?.missing.has(canonical(row.record.key))){item.terminalStatus=null;item.terminalReason='preselected_label_missing';item.executionKind=null;}exclusions.push(item);}}
 const conflicts=isFirstRoundPlan(plan)?findFirstRoundLabelConflicts(admitted.map(a=>a.sample)):[],conflictedIds=new Set(conflicts.flatMap(c=>c.decisionIds));
 const contextCounts=new Map<string,number>(),decisionCounts=new Map<string,number>();
 for(const {sample} of admitted){contextCounts.set(sample.contextSHA256,(contextCounts.get(sample.contextSHA256)??0)+1);decisionCounts.set(sample.decisionId,(decisionCounts.get(sample.decisionId)??0)+1);}
 let samples:DistillSample[]=[];
 for(const a of admitted){if(conflictedIds.has(a.sample.decisionId))exclusions.push(exclusion(a.row,'student_information_gap/label_conflict',plan));else if(contextCounts.get(a.sample.contextSHA256)!>1||decisionCounts.get(a.sample.decisionId)!>1)exclusions.push(exclusion(a.row,'duplicate_causal_context',plan));else{validateSample(a.sample,plan);samples.push(a.sample);}}
 if(firstRoundResearch){const balanced=balanceFirstRoundFrozenKeep(samples,selectionRows!.selectedMetadata);samples=balanced.samples;for(const unused of balanced.unused){const original=admitted.find(a=>a.sample.decisionId===unused.decisionId)!;exclusions.push(exclusion(original.row,'ordinary_keep_not_used_after_demo_validation',plan));}}
 // Create a fresh directory. Manifest is the last file: a partial write has no
 // usable reference and is never mistaken for a committed frozen dataset.
 const directory=resolve(outputDir),outputRoot=resolve(new URL('../out/',import.meta.url).pathname),outputRelative=relative(outputRoot,directory);if(!outputRelative||isAbsolute(outputRelative)||outputRelative.startsWith('..'))reject('output_not_task_directory');if(existsSync(directory))reject('output_exists');
 const parent=resolve(directory,'..');mkdirSync(parent,{recursive:true});if(realpathSync(parent)!==parent)reject('output_symlink');mkdirSync(directory,{mode:0o700});
 const bytes=samples.map(s=>JSON.stringify(s)).join('\n')+(samples.length?'\n':'');
 writeFileSync(join(directory,'samples.jsonl'),bytes,{flag:'wx',mode:0o600});
 const manifest={schema:isFirstRoundPlan(plan)?FIRST_ROUND_DATASET_SCHEMA:planCandidatePolicy(plan).candidateSpec===FIRST_TARGET_CANDIDATE_SPEC?CANDIDATE_DATASET_SCHEMA:DATASET_SCHEMA,datasetId:plan.datasetId,plan:structuredClone(plan),identityRefs:{basePolicy:ref(plan.identities.basePolicy.policyId,plan.identities.basePolicy),teacher:ref(plan.identities.teacher.releaseRef,plan.identities.teacher)},samples:{path:'samples.jsonl',sha256:hash(bytes),bytes:Buffer.byteLength(bytes),decisions:samples.length},...summarize(samples,exclusions,plan),exclusions,...(isFirstRoundR2DatasetPlan(plan)?{teacherAttemptDiagnostics:selectionRows?.teacherAttemptDiagnostics??[]}:{}),...(isFirstRoundPlan(plan)?{labelConflicts:conflicts}:{})};
 const manifestBytes=JSON.stringify(manifest)+'\n';writeFileSync(join(directory,'manifest.json'),manifestBytes,{flag:'wx',mode:0o600});
 return {directory,manifestSHA256:hash(manifestBytes)};
}
export function loadFrozenDataset(reference:FrozenDatasetRef,options:{expectedIdentities?:DatasetIdentities;requireTrainingEligible?:boolean}={}){
 const directory=resolve(reference.directory);if(!sha(reference.manifestSHA256)||realpathSync(directory)!==directory)reject('manifest_identity');
 const path=join(directory,'manifest.json');if(!existsSync(path)||lstatSync(path).isSymbolicLink())reject('manifest_missing');const bytes=readFileSync(path);if(hash(bytes)!==reference.manifestSHA256)reject('manifest_identity');
 const manifest=JSON.parse(bytes.toString());if(manifest.schema!==(isFirstRoundPlan(manifest.plan)?FIRST_ROUND_DATASET_SCHEMA:planCandidatePolicy(manifest.plan).candidateSpec===FIRST_TARGET_CANDIDATE_SPEC?CANDIDATE_DATASET_SCHEMA:DATASET_SCHEMA)||manifest.datasetId!==manifest.plan?.datasetId)reject('manifest_schema');validatePlan(manifest.plan);
 if(!equal(manifest.identityRefs,{basePolicy:ref(manifest.plan.identities.basePolicy.policyId,manifest.plan.identities.basePolicy),teacher:ref(manifest.plan.identities.teacher.releaseRef,manifest.plan.identities.teacher)}))reject('manifest_identity_refs');
 if(options.expectedIdentities&&!equal(options.expectedIdentities,manifest.plan.identities))reject('dataset_identity_changed');
 if(manifest.samples?.path!=='samples.jsonl')reject('sample_file_path');const samplePath=join(directory,manifest.samples.path),rel=relative(directory,samplePath);
 if(isAbsolute(rel)||rel.startsWith('..')||!existsSync(samplePath)||lstatSync(samplePath).isSymbolicLink())reject('sample_file_missing');
 const sampleBytes=readFileSync(samplePath);if(hash(sampleBytes)!==manifest.samples.sha256||sampleBytes.byteLength!==manifest.samples.bytes)reject('sample_file_identity');
 const text=sampleBytes.toString();if(text&&!text.endsWith('\n'))reject('frozen_bad_row');
 let samples:DistillSample[];try{samples=text?text.slice(0,-1).split('\n').map((line:string)=>JSON.parse(line)):[];for(const sample of samples)validateSample(sample,manifest.plan);}catch(e){throw Error('frozen_bad_row: '+(e instanceof Error?e.message:String(e)));}
 if(samples.length!==manifest.samples.decisions||new Set(samples.map(s=>s.decisionId)).size!==samples.length||new Set(samples.map(s=>s.contextSHA256)).size!==samples.length||!Array.isArray(manifest.exclusions)||manifest.exclusions.some((e:any)=>!nonempty(e.reason)||!sha(e.recordSHA256)))reject('frozen_counts_or_duplicates');
 const summary=summarize(samples,manifest.exclusions,manifest.plan);
 for(const key of ['counts','familyCounts','qualification'] as const)if(!equal(summary[key],manifest[key]))reject('frozen_counts_or_qualification');
 if(options.requireTrainingEligible&&!manifest.qualification.eligible)reject('dataset_diagnostic_only');
 return {manifest,samples};
}

/** Predeclared new-rule post-validation prefix only. No new sampling/label/
 * outcome or optimization result can enter this deterministic keep choice. */
export function balanceFirstRoundFrozenKeep(samples:DistillSample[],selectedMetadata:any[]){
 const ranks=new Map<string,number>();for(const m of selectedMetadata){if(m.sampleKind!=='keep')continue;if(ranks.has(m.decisionId)||!Number.isSafeInteger(m.rank)||m.rank<0)reject('first_round_frozen_keep_rank');ranks.set(m.decisionId,m.rank);}
 const keep=new Set<string>();for(const split of ['train','dev']){const count=samples.filter(s=>s.split===split&&s.sampleKind==='demo').length,rows=samples.filter(s=>s.split===split&&s.sampleKind==='keep');if(rows.some(s=>!ranks.has(s.decisionId))||new Set(rows.map(s=>ranks.get(s.decisionId))).size!==rows.length)reject('first_round_frozen_keep_rank');rows.sort((a,b)=>ranks.get(a.decisionId)!-ranks.get(b.decisionId)!);for(const row of rows.slice(0,count))keep.add(row.decisionId);}
 return {samples:samples.filter(s=>s.sampleKind!=='keep'||keep.has(s.decisionId)),unused:samples.filter(s=>s.sampleKind==='keep'&&!keep.has(s.decisionId))};
}

/** B09 narrow rows producer: fixed original population, never caller-selected
 * successes. The ordinary freezer independently re-verifies this entire join. */
export function materializeFirstRoundDatasetRows({selectionProof,plan}:{selectionProof:DatasetSelectionProof;plan?:DatasetPlan}):ExportRow[]{
 const t=selectionProof.resolvedInputs;if(t.mode!=='research'||t.phase!=='dataset')reject('first_round_dataset_host_proof_required');
 const verified=verifyOfflineSelection(selectionProof.selection,t),rule=t.references.get(verified.production.selectionRuleRef);
 if(verified.production.verification!=='reproduced'||!equal(verified.production,selectionProof.production)||!['ohuo-offline-selection-first-round-rule-v1','ohuo-offline-selection-common-view-r2'].includes(rule?.schema)||rule.postValidationKeepRule!=='same-split-frozen-rank-prefix-equal-valid-demo')reject('first_round_formal_selection_required');
 const r2=rule.schema==='ohuo-offline-selection-common-view-r2';
 if(r2&&(!plan||!isFirstRoundR2DatasetPlan(plan)||rule.protocolRef!==plan.researchProtocol!.revisionRef))reject('r2_dataset_plan_teacher_required');
 return materializeFirstRoundOriginalRows(verified,t,r2?plan!.identities.teacher:undefined);
}
/** Same-case direct seam; this does not grant qualification. freezeDataset
 * rechecks fixed production, original terminal ledger and every screen proof. */
export function materializeFirstRoundOriginalRows(verified:any,t:OfflineSelectionTrustedInputs,teacher?:DatasetIdentities['teacher']):ExportRow[]{
 const read=(f:Ref)=>{const mapped=t.evidenceFiles.get(f.id);if(!mapped||mapped.sha256!==f.sha256||isAbsolute(mapped.path)||mapped.path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))reject('first_round_rows_fixed_file');const path=resolve(t.repositoryRoot,mapped.path);if(realpathSync(path)!==path||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())reject('first_round_rows_regular_file');const bytes=readFileSync(path);if(hash(bytes)!==f.sha256)reject('first_round_rows_file_hash');return JSON.parse(bytes.toString());};
 const terminals=new Map<string,any>();for(const f of t.labelTerminalRefs??[]){const value=read(f),k=canonical(value.key);if(teacher&&!isFirstRoundTeachingTerminalFor(value,teacher))continue;if(terminals.has(k))reject('first_round_rows_duplicate_terminal');terminals.set(k,value);}
 const state=JSON.parse(readFileSync(join(t.controlRoot,'state.json'),'utf8')),selectionRef=referenceOf(`offline-label-selection/${verified.spec.outputId}`,verified.selection),screens=new Map<string,Ref>();
 for(const run of Object.values(state.runs??{}) as any[]){if(run.task?.planRef!==verified.spec.planRef||!equal(run.task.datasetRefs,[selectionRef])||run.checkpoint?.schema!=='ohuo-first-round-screen-run-v1')continue;
  for(const artifact of run.consumerArtifactRefs??[]){const mappings=[...t.evidenceFiles].filter(([,f])=>resolve(t.repositoryRoot,f.path)===artifact.path&&f.sha256===artifact.sha256);if(mappings.length!==1)reject('first_round_rows_screen_catalog');const f={id:mappings[0][0],sha256:artifact.sha256},value=read(f);if(value.schema!=='ohuo-first-round-screen-summary-v1'||value.selectionRef!==selectionRef)reject('first_round_rows_screen_identity');
   for(const r of value.plans??[]){if(screens.has(r.inputSHA256))reject('first_round_rows_duplicate_screen');screens.set(r.inputSHA256,f);}
  }
 }
 const cache=new Map();return verified.selectedMetadata.map((meta:any)=>{const source=verified.population.find((r:any)=>equal(r.key,meta.key)&&r.inputSHA256===meta.inputSHA256);if(!source)reject('first_round_rows_original_source');const s=readOfflineSnapshot(source,cache),row:ExportRow={sampleKind:meta.sampleKind,sampleClass:meta.sampleClass,match:s.record as MatchInput,record:s.decision as DecisionRecord,privateInput:s.input as DecisionInput};
  if(meta.sampleKind==='demo'){const terminal=terminals.get(canonical(meta.key));if(terminal?.offlineLabel)row.offlineLabel=structuredClone(terminal.offlineLabel);const validationRef=screens.get(meta.inputSHA256),action=s.bundle.pool.find(c=>c.actionId===terminal?.remote?.actionId);if(validationRef&&action)row.firstRoundValidation={evidenceGrade:'provisional_screened',direction:action.canonical===null?'pass':'takeover',validationRef};}
  return row;
 });
}
export async function freezeFirstRoundDatasetFromHost({planRef,selectionRef,outputDir}:{planRef:string;selectionRef:string;outputDir:string}){
 const {createOfflineSelectionDatasetProof}=await import('./ohuo-host-files'),selectionProof=await createOfflineSelectionDatasetProof(selectionRef),t=selectionProof.resolvedInputs,plan=t.references.get(planRef) as DatasetPlan;
 if(!plan||digest(plan)!==planRef.split(':').at(-1)||plan.schema!=='ohuo-distill-plan-first-round-v3'||plan.purpose!=='first-round-partner-control')reject('first_round_fixed_plan_required');
 if(resolve(outputDir)!==join(t.repositoryRoot,'lab/out',plan.datasetId))reject('first_round_fixed_dataset_output');
 const rows=materializeFirstRoundDatasetRows({selectionProof,plan}),sourceQueue=t.references.get(plan.queueRef);
 return freezeDataset({plan,sourceIndexPath:t.sourceIndexPath,sourceQueue,rows,outputDir,selectionProof});
}
