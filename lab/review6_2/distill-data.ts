/** M6: one immutable manifest + grouped JSONL. Never calls a model, enumerates
 * candidates, repairs a label, runs a match, or updates parameters. */
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {canonicalActionId,resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import type {GameState} from '@gd/engine';
import {buildObservation} from '../../packages/ai/src/hybrid/observation';
import type {DecisionKey,FrozenCandidate,PublicHistoryPrefix} from '../../packages/ai/src/hybrid/protocol';
import {resolveCandidatePolicy,FIRST_TARGET_CANDIDATE_SPEC,type CandidatePolicySpec,type EnumSpec} from '../../packages/ai/src/candidate-spec';
import type {RemoteDecisionResult} from '../../packages/ai/src/hybrid/remote-selector';
import {verifyOfflineSelection,verifyCommonViewRoundAdmission,type OfflineSelectionTrustedInputs} from './offline-selection';
import {readOfflineSnapshot} from './offline-label-source';
import {readSelectionSnapshot,type SelectedDesignedDecision} from './offline-selection';
import {validateDesignedAugmentation,validateDesignedProvenance,validateDesignedEvidence,assertRetainedSamples} from './designed-provenance.mjs';
import {verifyDesignedProtocolLineage} from './designed-protocol-lineage.mjs';
import {STUDENT_SCORER_ENCODER,validateStudentScorerDescriptor} from '../../packages/ai/src/policy/descriptor';
import {isFirstRoundR2DatasetPlan,isFirstRoundTeachingTerminalFor,firstRoundOwnedLabelRows} from './first-round-contract.mjs';
import {firstRoundCoverage,findFirstRoundLabelConflicts} from './first-round-qualification.mjs';
import type {StudentCandidateInputs} from './match-record';
import {canonical,digest,referenceOf,fixedReference} from './task-schema.mjs';
import {verifyFirstRoundDemoEvidence} from './first-round-evidence';

import {validateCumulativeSampling,cumulativeKeepCandidates,assertCumulativeGrowth} from './first-round-cumulative-data.mjs';

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
export interface DatasetPlan {designedAugmentation?:{schema:'ohuo-designed-augmentation-v1';previousDatasetRef:string;selectionRef:string;ordinarySelectionRef:string};cumulativeSampling?:{schema:'ohuo-first-round-cumulative-sampling-r2';protocolRef:string;poolRef:string;selectionRefs:string[];productionRefs:string[];previousDatasetRef:string|null;keepRule:'same-split-frozen-layout-hash-prefix-equal-cumulative-valid-demo'};researchProtocol?:{id:'first-round-common-view-r2';revisionRef:string};schema:'ohuo-distill-plan-v1'|'ohuo-distill-plan-candidate-v2'|'ohuo-distill-plan-first-round-v3';datasetId:string;purpose:'engineering_fixture'|'stage4'|'first-round-partner-control';sourceIndexRef:string;sourceIndexSHA256:string;queueRef:string;queueSHA256:string;samplingRef:string;identities:DatasetIdentities;families:FamilyBinding[];games:GameBinding[]}
/** Exact B07 JSON boundary; candidateInputs is materialized by its owner from
 * each initial-C action, not reconstructed here from features or rankings. */
export interface DecisionInput {schema:'ohuo-decision-input-v1'|'ohuo-decision-input-candidate-v2'|'ohuo-decision-input-first-round-v3';studentInputs?:StudentCandidateInputs;enumSpec?:EnumSpec;key:DecisionKey;policyId:string;observation:{decisionId:string;matchId:string;gameNo:number;moveNo:number;actorSeat:number;[key:string]:unknown};candidateSpec:string;initialCandidateIds:string[];pool:FrozenCandidate[];candidateInputs:null|{encoderVersion:string;policyId:string;inputDim:number;candidateIds:string[];candidateFeatures:number[][];rawQ:number[];policyIdentity:BaseIdentity;encoder:Record<string,unknown>;[key:string]:unknown}}
export interface DecisionRecord {key:DecisionKey;policyId:string;initialCandidateIds:string[];offeredIds:string[];requestedActionId:string|null;actualActionId:string|null;actualMove:any;actualSource:string|null;status:string;reason:string|null;executionKind:string;trainingInputSHA256:string|null;requests:Array<Record<string,unknown>>;[key:string]:unknown}
export interface MatchInput {schema:'ohuo-confirmed-match-v1';matchId:string;sourceRef:string;seatSnapshots?:any[];decisions:DecisionRecord[];[key:string]:unknown}
export interface OfflineLabel {schema:'ohuo-offline-choose-v1';inputSHA256:string;key:DecisionKey;remote:RemoteDecisionResult;teacher:DatasetIdentities['teacher'];canonicalId:string|null;legality:'validated'|'not-selected'}
export interface NaturalExportRow {sourceKind?:'natural-recorded';firstRoundValidation?:{evidenceGrade:'provisional_screened'|'strong_supported';direction:'pass'|'takeover';validationRef:Ref};sampleKind:'demo'|'keep';sampleClass:'target'|'ordinary';match:MatchInput;record:DecisionRecord;privateInput:DecisionInput;offlineLabel?:OfflineLabel}
export interface DesignedExportRow {sourceKind:'designed-synthetic';sampleKind:'demo';sampleClass:'target';source:SelectedDesignedDecision;sourceMetadata:import('./designed-source').DesignedSnapshot['designedSource'];privateInput:DecisionInput;offlineLabel?:OfflineLabel;firstRoundValidation?:NaturalExportRow['firstRoundValidation']}
export type ExportRow=NaturalExportRow;
export type DatasetSourceRow=NaturalExportRow|DesignedExportRow;
type DesignedProvenance={sourceKind:'designed-synthetic';sourceRef:string;sourceIndexRef:string;sourceSHA256:string;replaySHA256:string;inputSHA256:string;samplingRef:string};
const designedRow=(row:DatasetSourceRow):row is DesignedExportRow=>row.sourceKind==='designed-synthetic';
const exportKey=(row:DatasetSourceRow)=>designedRow(row)?row.source.key:row.record.key;
const exportInputHash=(row:DatasetSourceRow)=>designedRow(row)?row.source.inputSHA256:row.record.trainingInputSHA256;
interface SampleBase {schema:typeof SAMPLE_SCHEMA|typeof CANDIDATE_SAMPLE_SCHEMA|typeof FIRST_ROUND_SAMPLE_SCHEMA;proposalRawQ?:number[];studentParentRef?:string;evidenceGrade?:string;direction?:string;validationRef?:Ref;candidatePolicy?:CandidatePolicySpec;sampleKind:'demo'|'keep';sampleClass:'target'|'ordinary';decisionId:string;sourceFamily:string;sourceRef:string;split:Split;key:DecisionKey;observationRef:Ref;contextSHA256:string;encoderVersion:string;candidateSpecRef:string;candidateIds:string[];candidateOriginalIndices:number[];candidateCanonicalIds:string[];candidateFeatures:number[][];rawQ:number[];baseActionId:string;basePolicyRef:Ref;qualityFlags:string[];provenance:{inputSHA256:string;recordSHA256:string;matchSHA256:string;samplingRef:string}|DesignedProvenance}
export type DistillSample=(SampleBase&{sampleKind:'demo';targetIds:string[];teacherPolicyRef:Ref;labelKind:'teacher_action';executionKind:'committed'|'offline_suggested';labelSourceRef:Ref})|(SampleBase&{sampleKind:'keep'});
export interface FrozenDatasetRef {directory:string;manifestSHA256:string}
export interface Exclusion {decisionId:string|null;sampleKind:string;sourceFamily:string|null;reason:string;terminalStatus:string|null;terminalReason:string|null;executionKind:string|null;recordSHA256?:string;sourceKind?:'designed-synthetic';sourceRef?:string;sourceSHA256?:string}
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
 if(plan?.designedAugmentation!==undefined){validateDesignedAugmentation(plan.designedAugmentation);if(!isFirstRoundR2DatasetPlan(plan)||Object.hasOwn(plan,'cumulativeSampling'))reject('designed_augmentation_requires_r2_only');}
 if(plan?.researchProtocol!==undefined){if(!isFirstRoundPlan(plan))reject('r2_protocol_requires_first_round_plan');isFirstRoundR2DatasetPlan(plan);}
 if(!isFirstRoundPlan(plan)&&!['engineering_fixture','stage4'].includes(plan?.purpose))reject('plan_identity');
 if(!['ohuo-distill-plan-v1','ohuo-distill-plan-candidate-v2','ohuo-distill-plan-first-round-v3'].includes(plan?.schema)||!nonempty(plan.datasetId)||!['engineering_fixture','stage4','first-round-partner-control'].includes(plan.purpose)||!nonempty(plan.sourceIndexRef)||!sha(plan.sourceIndexSHA256)||!nonempty(plan.queueRef)||!sha(plan.queueSHA256)||!nonempty(plan.samplingRef))reject('plan_identity');
 if(plan.cumulativeSampling!==undefined){if(!isFirstRoundR2DatasetPlan(plan))reject('cumulative_requires_r2');validateCumulativeSampling(plan.cumulativeSampling,plan.researchProtocol!.revisionRef);fixedReference(plan.samplingRef,'cumulativeSamplingRef');if(plan.samplingRef.split(':').at(-1)!==digest(plan.cumulativeSampling))reject('cumulative_sampling_ref');}
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
function admit(row:DatasetSourceRow,plan:DatasetPlan):DistillSample {
 const p=row.privateInput,key=exportKey(row),inputSHA256=exportInputHash(row),designed=designedRow(row);
 const firstRound=isFirstRoundPlan(plan),candidatePolicy=planCandidatePolicy(plan),newSpec=candidatePolicy.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC;
 if(!row||!['demo','keep'].includes(row.sampleKind)||!['target','ordinary'].includes(row.sampleClass)||row.sampleKind==='keep'&&row.sampleClass!=='ordinary')reject('sample_kind');
 let binding:{sourceFamily:string;sourceRef:string;split:Split},seat:any;
 if(designed){
  if(!plan.designedAugmentation||!firstRound||row.sampleKind!=='demo'||row.sampleClass!=='target'||'record' in row||'match' in row)reject('designed_sample_kind');
  const m=row.sourceMetadata,r=row.source,family=plan.families.find(f=>f.sourceFamily===r.blockFamilyId);
  if(r.sourceKind!=='designed-synthetic'||r.split!=='train'||!family||family.split!=='train'||!family.sourceRefs.includes(r.sourceRef)||m.sourceKind!=='designed-synthetic'||m.sourceRef!==r.sourceRef||m.sourceIndexRef!==plan.sourceIndexRef||m.rootFamilyId!==r.blockFamilyId||m.sourceFamilyId!==r.familyId||m.targetExecuted!==false||m.status!=='replayed-unlabelled'||m.eligibleForTeaching!==false||!sha(m.sourceFile?.sha256)||!sha(m.replaySHA256))reject('designed_sample_source');
  binding={sourceFamily:r.blockFamilyId,sourceRef:r.sourceRef,split:'train'};
 }else{
  const {record:d,match}=row;
  if(match?.schema!=='ohuo-confirmed-match-v1'||!d?.key||match.matchId!==d.key.matchId||match.sourceRef!==plan.sourceIndexRef||match.layoutRef!==plan.queueRef||!Array.isArray(match.games)||!Array.isArray(match.decisions)||!match.decisions.some(r=>equal(r,d)))reject('record_identity');
  const game=plan.games.find(g=>g.matchId===d.key.matchId&&g.gameNo===d.key.gameNo);
  if(!game||game.actorSeat!==d.key.actorSeat||match.evaluatedActor!==game.actorSeat||match.split!==game.split||(match.games as Array<any>)?.find(g=>g.gameNo===d.key.gameNo)?.sourceSHA256!==game.sourceSHA256||(match.games as Array<any>)?.find(g=>g.gameNo===d.key.gameNo)?.sourceFamilyId!==(firstRound?(game.actualSourceFamily??game.sourceFamily):game.sourceFamily))reject('sample_actor_or_family');
  binding=game;seat=match.seatSnapshots?.[d.key.actorSeat];
  if(!equal(seat?.policyIdentity,plan.identities.basePolicy)||d.policyId!==plan.identities.basePolicy.policyId)reject('base_policy_identity');
  if(firstRound&&(!equal((seat as any)?.firstRoundCapture,{studentParentRef:plan.identities.studentParentRef,scorer:plan.identities.studentScorer,migrationReceiptRef:plan.identities.migrationReceiptRef})||match.policyIds[d.key.actorSeat]!==plan.identities.basePolicy.policyId||d.actualSource!=='B'))reject('first_round_source_capture_identity');
 }
 if(p?.schema!==(firstRound?'ohuo-decision-input-first-round-v3':newSpec?'ohuo-decision-input-candidate-v2':'ohuo-decision-input-v1')||!equal(p.key,key)||!sha(inputSHA256)||dataHash(p)!==inputSHA256)reject('private_input_identity');
 const obs=p.observation,ids=plan.identities;
 if(!obs||!nonempty(obs.decisionId)||obs.matchId!==key.matchId||obs.gameNo!==key.gameNo||obs.moveNo!==key.moveNo||obs.actorSeat!==key.actorSeat)reject('observation_identity');
 if(p.policyId!==ids.basePolicy.policyId||p.candidateSpec!==ids.candidateSpecRef)reject('base_policy_identity');
 const x=p.candidateInputs;
 if(newSpec&&(!equal(p.enumSpec,candidatePolicy.enumSpec)||resolveCandidatePolicy(x?.candidatePolicy as CandidatePolicySpec|undefined)!==candidatePolicy||(!designed&&!equal(row.record.offeredIds,p.initialCandidateIds))))reject('candidate_contract_alignment');
 if(!newSpec&&(p.enumSpec!==undefined||x?.candidatePolicy!==undefined))reject('candidate_legacy_schema');
 if(!x||x.inputDim!==399||x.encoderVersion!==(firstRound?ids.basePolicy.encoderVersion:ids.encoderVersion)||x.policyId!==ids.basePolicy.policyId||!equal(x.policyIdentity,ids.basePolicy)||!equal(x.encoder,firstRound?ids.proposalEncoderConfig:ids.encoderConfig))reject('candidate_input_identity');
 if(!uniqueStrings(p.initialCandidateIds)||p.initialCandidateIds.length>(newSpec?12:8)||(!designed&&!equal(p.initialCandidateIds,row.record.initialCandidateIds))||!equal(p.initialCandidateIds,x.candidateIds))reject('initial_c_alignment');
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
 const common:SampleBase={schema:firstRound?FIRST_ROUND_SAMPLE_SCHEMA:newSpec?CANDIDATE_SAMPLE_SCHEMA:SAMPLE_SCHEMA,...(newSpec?{candidatePolicy}:{}),sampleKind:row.sampleKind,sampleClass:row.sampleClass,decisionId:obs.decisionId,sourceFamily:binding.sourceFamily,sourceRef:binding.sourceRef,split:binding.split,key:structuredClone(key),observationRef:ref(obs.decisionId,obs),contextSHA256:dataHash([binding.sourceFamily,causalObservation,actions.map(a=>a.action.canonicalId)]),encoderVersion:ids.encoderVersion,candidateSpecRef:ids.candidateSpecRef,candidateIds:actions.map(a=>a.action.actionId),candidateOriginalIndices:actions.map(a=>a.action.originalIndex),candidateCanonicalIds:actions.map(a=>a.action.canonicalId),candidateFeatures:firstRound?student!.candidateFeatures:actions.map(a=>a.features),rawQ:firstRound?student!.rawQ:actions.map(a=>a.rawQ),baseActionId:firstRound?student!.baseActionId:baseAction.actionId,...(firstRound?{proposalRawQ:actions.map(a=>a.rawQ),studentParentRef:ids.studentParentRef}:{} ),basePolicyRef:ref(ids.basePolicy.policyId,ids.basePolicy),qualityFlags:[],provenance:designed?validateDesignedProvenance({sourceKind:'designed-synthetic',sourceRef:row.source.sourceRef,sourceIndexRef:row.sourceMetadata.sourceIndexRef,sourceSHA256:row.sourceMetadata.sourceFile.sha256,replaySHA256:row.sourceMetadata.replaySHA256,inputSHA256:dataHash(p),samplingRef:plan.samplingRef}):{inputSHA256:dataHash(p),recordSHA256:dataHash(row.record),matchSHA256:dataHash(row.match),samplingRef:plan.samplingRef}};
 if(row.sampleKind==='keep'){
  if(row.offlineLabel)reject('keep_has_teacher_label');
  return {...common,sampleKind:'keep'};
 }
 let target:string,executionKind:'committed'|'offline_suggested',labelSource:unknown;
 if(row.offlineLabel){
  const label=row.offlineLabel;
  if(!label.remote||label.schema!=='ohuo-offline-choose-v1'||label.inputSHA256!==inputSHA256||!equal(label.key,key)||!equal(label.remote.decisionKey,key)||!equal(label.teacher,ids.teacher))reject('offline_label_identity');
  if(label.remote.status!=='selected'||label.legality!=='validated')reject('not_final_teacher_choose');
  target=label.remote.actionId;executionKind='offline_suggested';labelSource=label;
  checkTeacher(ids.teacher,[...label.remote.attempts] as unknown as Array<Record<string,unknown>>);
  const action=p.pool.find(c=>c.actionId===target);
  if(!action||!label.remote.offeredIds.includes(target))reject('unknown_target');
  if(newSpec&&!equal(label.remote.offeredIds,p.initialCandidateIds))reject('candidate_teacher_set_alignment');
  if(action.canonicalId!==label.canonicalId||label.remote.inInitialCandidateSet!==p.initialCandidateIds.includes(target))reject('canonical_identity');
 }else{
  if(designed)reject('designed_offline_teacher_required');const d=row.record;
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
/** Pure numerical row construction seam. This is not a freeze/admission entry:
 * the host freezer independently joins original teacher/screen evidence. */
export function prepareDesignedDatasetSample(row:DesignedExportRow,plan:DatasetPlan):DistillSample {
 validatePlan(plan);if(!plan.designedAugmentation||!designedRow(row))reject('designed_augmentation_required');const sample=admit(row,plan);validateSample(sample,plan);return sample;
}
function validateSample(s:any,plan:DatasetPlan,retainedHashes:ReadonlySet<string>=new Set()){
 const firstRound=isFirstRoundPlan(plan),candidatePolicy=planCandidatePolicy(plan),newSpec=candidatePolicy.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC;
 const keys=['schema','sampleKind','sampleClass','decisionId','sourceFamily','sourceRef','split','key','observationRef','contextSHA256','encoderVersion','candidateSpecRef','candidateIds','candidateOriginalIndices','candidateCanonicalIds','candidateFeatures','rawQ','baseActionId','basePolicyRef','qualityFlags','provenance'];
 if(newSpec)keys.push('candidatePolicy');if(firstRound)keys.push('proposalRawQ','studentParentRef');
 if(s?.sampleKind==='demo'){keys.push('targetIds','teacherPolicyRef','labelKind','executionKind','labelSourceRef');if(firstRound)keys.push('evidenceGrade','direction','validationRef');}
 if(!s||Object.keys(s).sort().join()!==keys.sort().join()||s.schema!==(firstRound?FIRST_ROUND_SAMPLE_SCHEMA:newSpec?CANDIDATE_SAMPLE_SCHEMA:SAMPLE_SCHEMA)||!['demo','keep'].includes(s.sampleKind)||!['target','ordinary'].includes(s.sampleClass)||s.sampleKind==='keep'&&s.sampleClass!=='ordinary')reject('sample_schema');
 if(newSpec&&resolveCandidatePolicy(s.candidatePolicy)!==candidatePolicy)reject('sample_candidate_identity');
 const designed=s.provenance?.sourceKind==='designed-synthetic',retained=retainedHashes.has(dataHash(s));
 if(s.provenance?.sourceKind!==undefined&&!designed)reject('sample_source_kind');
 if(designed){validateDesignedProvenance(s.provenance);const f=plan.families.find(f=>f.sourceFamily===s.sourceFamily);if(!plan.designedAugmentation||s.sampleKind!=='demo'||s.sampleClass!=='target'||s.split!=='train'||s.executionKind!=='offline_suggested'||!f||f.split!=='train'||!f.sourceRefs.includes(s.sourceRef)||s.sourceRef!==s.provenance.sourceRef||!retained&&s.provenance.sourceIndexRef!==plan.sourceIndexRef)reject('designed_sample_source');}
 const g=plan.games.find(g=>g.matchId===s.key?.matchId&&g.gameNo===s.key?.gameNo);
 if(!designed&&(!g||s.key.actorSeat!==g.actorSeat||s.sourceFamily!==g.sourceFamily||s.sourceRef!==g.sourceRef||s.split!==g.split)||!nonempty(s.decisionId)||!sha(s.contextSHA256))reject('sample_source');
 if(s.encoderVersion!==plan.identities.encoderVersion||s.candidateSpecRef!==plan.identities.candidateSpecRef||!equal(s.basePolicyRef,ref(plan.identities.basePolicy.policyId,plan.identities.basePolicy)))reject('sample_identity');
 const k=s.candidateIds?.length;
 if(!Array.isArray(s.candidateOriginalIndices)||s.candidateOriginalIndices.length!==k||s.candidateOriginalIndices.some((i:unknown)=>!Number.isSafeInteger(i)||(i as number)<0)||new Set(s.candidateOriginalIndices).size!==k)reject('sample_original_indices');
 if(!uniqueStrings(s.candidateIds)||k>(newSpec?12:8)||!uniqueStrings(s.candidateCanonicalIds)||s.candidateCanonicalIds.length!==k||!s.candidateIds.includes(s.baseActionId)||!Array.isArray(s.rawQ)||s.rawQ.length!==k||!s.rawQ.every(finite)||!Array.isArray(s.candidateFeatures)||s.candidateFeatures.length!==k||!s.candidateFeatures.every((f:unknown)=>Array.isArray(f)&&f.length===(firstRound?423:399)&&f.every(finite)))reject('sample_vectors');
 if(firstRound){
  if(s.studentParentRef!==plan.identities.studentParentRef||!Array.isArray(s.proposalRawQ)||s.proposalRawQ.length!==k||!s.proposalRawQ.every(finite)||s.candidateFeatures.some((f:number[])=>f.some(v=>Math.fround(v)!==v)))reject('first_round_sample_identity');
  let best=0;for(let i=1;i<k;i++)if(s.rawQ[i]>s.rawQ[best]||s.rawQ[i]===s.rawQ[best]&&s.candidateOriginalIndices[i]<s.candidateOriginalIndices[best])best=i;if(s.baseActionId!==s.candidateIds[best])reject('first_round_S0_top_identity');
  if(s.sampleKind==='demo'&&(!['provisional_screened','strong_supported'].includes(s.evidenceGrade)||!['pass','takeover'].includes(s.direction)||!sha(s.validationRef?.sha256)||!nonempty(s.validationRef?.id)||s.targetIds?.some((id:string)=>(s.candidateCanonicalIds[s.candidateIds.indexOf(id)]==='pass'?'pass':'takeover')!==s.direction)))reject('first_round_demo_evidence_identity');
 }
 if(!Array.isArray(s.qualityFlags)||s.qualityFlags.some((q:unknown)=>!nonempty(q))||!sha(s.observationRef?.sha256)||s.observationRef.id!==s.decisionId||!(retained?typeof s.provenance?.samplingRef==='string'&&/@sha256:[a-f0-9]{64}$/.test(s.provenance.samplingRef):plan.cumulativeSampling&&s.sampleKind==='demo'?plan.cumulativeSampling.productionRefs.includes(s.provenance?.samplingRef):s.provenance?.samplingRef===plan.samplingRef)||!(designed?true:['inputSHA256','recordSHA256','matchSHA256'].every(k=>sha(s.provenance[k]))))reject('sample_provenance');
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
function exclusion(row:DatasetSourceRow,reason:string,plan:DatasetPlan):Exclusion{if(designedRow(row))return {decisionId:row.privateInput?.observation?.decisionId??null,sampleKind:row.sampleKind,sourceFamily:row.source.blockFamilyId,reason,terminalStatus:row.offlineLabel?.remote?.status??null,terminalReason:row.offlineLabel?.remote?.reason??null,executionKind:'offline_suggested',sourceKind:'designed-synthetic',sourceRef:row.source.sourceRef,sourceSHA256:row.sourceMetadata.sourceFile.sha256};return {decisionId:row.privateInput?.observation?.decisionId??null,sampleKind:row.sampleKind,sourceFamily:plan.games.find(g=>g.matchId===row.record?.key?.matchId&&g.gameNo===row.record?.key?.gameNo)?.sourceFamily??null,reason,terminalStatus:row.record?.status??null,terminalReason:row.record?.reason??null,executionKind:row.record?.executionKind??null,recordSHA256:dataHash(row.record??null)};}
export interface DatasetSelectionProof {selection:any;production:any;resolvedInputs:OfflineSelectionTrustedInputs}
/** Only the fixed host supplies this proof. Roles and original input bytes are
 * reproduced from the full selection, never inferred from successful labels. */
export interface DatasetCumulativeSelectionProof {schema:'ohuo-first-round-cumulative-proof-r2';samplingRef:string;rounds:DatasetSelectionProof[];previousDataset:{reference:string;frozen:FrozenDatasetRef}|null}
/** Historical round proof remains historical. No merged selection/terminal is invented. */
function cumulativeSelectedRows(plan:DatasetPlan,proof:DatasetCumulativeSelectionProof){
 const c=validateCumulativeSampling(plan.cumulativeSampling,plan.researchProtocol?.revisionRef);
 if(!isFirstRoundR2DatasetPlan(plan)||!proof||Object.keys(proof).sort().join(',')!=='previousDataset,rounds,samplingRef,schema'||proof?.schema!=='ohuo-first-round-cumulative-proof-r2'||proof.samplingRef!==plan.samplingRef||digest(c)!==plan.samplingRef.split(':').at(-1)||!Array.isArray(proof.rounds)||proof.rounds.length!==c.selectionRefs.length)reject('cumulative_proof_identity');
 const latest=proof.rounds.at(-1)!,t=latest.resolvedInputs,lastSpec=t.references.get(latest.production.specRef),admission=verifyCommonViewRoundAdmission(lastSpec,t);
 if(admission.poolRef!==c.poolRef||admission.pool.protocolRef!==c.protocolRef||!equal([...admission.priorSelectionRefs,c.selectionRefs.at(-1)],c.selectionRefs)||admission.round!==c.selectionRefs.length-1)reject('cumulative_complete_round_chain');
 if(c.previousDatasetRef===null?proof.previousDataset!==null:proof.previousDataset?.reference!==c.previousDatasetRef)reject('cumulative_previous_dataset_binding');
 let previous:any=null;
 if(proof.previousDataset){const priorRef=t.references.get(c.previousDatasetRef);if(priorRef?.schema!=='ohuo-frozen-dataset-ref-v1'||digest(priorRef)!==c.previousDatasetRef.split(':').at(-1)||priorRef.manifestSHA256!==proof.previousDataset.frozen.manifestSHA256)reject('cumulative_previous_dataset_ref');previous=loadFrozenDataset(proof.previousDataset.frozen,{expectedIdentities:plan.identities});const pp=previous.manifest.plan;
  if(!isFirstRoundR2DatasetPlan(pp)||pp.datasetId===plan.datasetId||pp.researchProtocol.revisionRef!==c.protocolRef||pp.sourceIndexRef!==plan.sourceIndexRef||pp.sourceIndexSHA256!==plan.sourceIndexSHA256||pp.queueRef!==plan.queueRef||pp.queueSHA256!==plan.queueSHA256||!equal(pp.families,plan.families)||!equal(pp.games,plan.games))reject('cumulative_previous_dataset_scope');
  const priorProductions=pp.cumulativeSampling?.productionRefs??[pp.samplingRef];if(priorProductions.length>=c.productionRefs.length||!equal(priorProductions,c.productionRefs.slice(0,priorProductions.length)))reject('cumulative_previous_dataset_not_prefix');
 }
 const rows:DatasetSourceRow[]=[],selectedMetadata:any[]=[],missing=new Set<string>(),terminals=new Map<string,any>(),teacherAttemptDiagnostics:any[]=[],contexts=new Map<DatasetSourceRow,{plan:DatasetPlan;proof:DatasetSelectionProof}>(),roundEvidence:any[]=[];
 let base:any=null;const seenDemos=new Set<string>();
 for(const [i,one]of proof.rounds.entries()){
  const ot=one.resolvedInputs;if(ot.mode!=='research'||ot.phase!=='dataset'||ot.repositoryRoot!==t.repositoryRoot||ot.controlRoot!==t.controlRoot||ot.sourceIndexPath!==t.sourceIndexPath)reject('cumulative_round_host_scope');
  const v=verifyOfflineSelection(one.selection,ot),r=ot.references.get(v.production.selectionRuleRef),sr=referenceOf(`offline-label-selection/${v.spec.outputId}`,v.selection);
  if(sr!==c.selectionRefs[i]||v.selection.productionRef!==c.productionRefs[i]||!equal(v.production,one.production)||v.spec.planRef!==admission.pool.planRef||v.spec.sourceIndexRef!==plan.sourceIndexRef||v.spec.queueRef!==plan.queueRef||r?.protocolRef!==c.protocolRef||r.representativeRound!==i)reject('cumulative_round_identity');
  if(!base)base=v;
  const roundPlan={...plan,samplingRef:c.productionRefs[i]};delete roundPlan.cumulativeSampling;
  const materialized=materializeFirstRoundOriginalRows(v,ot,plan.identities.teacher),checked=selectedRows(roundPlan,materialized,one,v);
  const roundDemo=checked.selectedMetadata.filter((m:any)=>m.sampleKind==='demo');
  for(const row of checked.rows){if(row.sampleKind!=='demo')continue;const k=canonical(exportKey(row));if(seenDemos.has(k))reject('cumulative_duplicate_demo');seenDemos.add(k);rows.push(row);contexts.set(row,{plan:roundPlan,proof:one});}
  selectedMetadata.push(...roundDemo.map((m:any)=>({...m,split:v.population.find((p:any)=>equal(p.key,m.key)&&p.inputSHA256===m.inputSHA256)?.split})));
  for(const k of checked.missing)missing.add(k);for(const [k,value]of checked.terminals){if(terminals.has(k))reject('cumulative_duplicate_terminal');terminals.set(k,value);}
  teacherAttemptDiagnostics.push(...checked.teacherAttemptDiagnostics.map((d:any)=>({...d,selectionRef:sr,productionRef:c.productionRefs[i]})));
  roundEvidence.push({selectionRef:sr,productionRef:c.productionRefs[i],populationRef:v.production.populationRef,selectedMetadataRef:v.production.selectedMetadataRef,exclusionsRef:v.production.exclusionsRef,preselectedDemoCount:roundDemo.length,selectedDemoMetadata:structuredClone(roundDemo),preselectedKeepCount:checked.selectedMetadata.length-roundDemo.length,terminalRefs:structuredClone(ot.labelTerminalRefs??[]),missingDemoKeys:[...checked.missing],terminalOutcomes:[...checked.terminals.values()].map((z:any)=>({key:z.key,inputSHA256:z.inputSHA256,status:z.status,labelKind:z.labelKind}))});
 }
 const queue=t.references.get(plan.queueRef),rule=t.references.get(base.production.selectionRuleRef),ordinary=cumulativeKeepCandidates(base.population,selectedMetadata,queue,rule.layoutOrder),cache=new Map();
 for(const [rank,p]of ordinary.entries()){
  const snap=readOfflineSnapshot(p,cache),row:DatasetSourceRow={sampleKind:'keep',sampleClass:'ordinary',match:snap.record as MatchInput,record:snap.decision as DecisionRecord,privateInput:snap.input as DecisionInput};
  rows.push(row);contexts.set(row,{plan,proof:proof.rounds[0]});selectedMetadata.push({decisionId:p.decisionId,key:p.key,inputSHA256:p.inputSHA256,sampleKind:'keep',sampleClass:'ordinary',contextSHA256:p.contextSHA256,split:p.split,rank});
 }
 return {rows,missing,terminals,selectedMetadata,teacherAttemptDiagnostics,contexts,previousSamples:previous?.samples??[],cumulativeEvidence:{schema:'ohuo-first-round-cumulative-evidence-r2',samplingRef:plan.samplingRef,previousDatasetRef:c.previousDatasetRef,previousManifestSHA256:proof.previousDataset?.frozen.manifestSHA256??null,previousValidDemoIdentities:(previous?.samples??[]).filter((z:any)=>z.sampleKind==='demo').map((z:any)=>({sampleKind:'demo',decisionId:z.decisionId,contextSHA256:z.contextSHA256,provenance:{inputSHA256:z.provenance.inputSHA256}})),rounds:roundEvidence,ordinaryPoolRef:base.production.populationRef,ordinaryCandidateCount:ordinary.length,ordinaryCandidateMetadata:selectedMetadata.filter(m=>m.sampleKind==='keep')}};
}
function cumulativeSummary(summary:any,evidence:any,samples:DistillSample[],plan:DatasetPlan){
 if(!plan.cumulativeSampling){if(evidence!==undefined)reject('cumulative_unexpected_evidence');return summary;}
 const c=plan.cumulativeSampling;
 if(evidence?.schema!=='ohuo-first-round-cumulative-evidence-r2'||evidence.samplingRef!==plan.samplingRef||evidence.previousDatasetRef!==c.previousDatasetRef||!Array.isArray(evidence.rounds)||!equal(evidence.rounds.map((r:any)=>r.selectionRef),c.selectionRefs)||!equal(evidence.rounds.map((r:any)=>r.productionRef),c.productionRefs)||!Array.isArray(evidence.previousValidDemoIdentities)||!Array.isArray(evidence.ordinaryCandidateMetadata))reject('cumulative_frozen_evidence');
 if(c.previousDatasetRef===null?(evidence.previousManifestSHA256!==null||evidence.previousValidDemoIdentities.length!==0):!sha(evidence.previousManifestSHA256))reject('cumulative_frozen_previous_identity');
 const demoBindings=new Map<string,any>();for(const r of evidence.rounds){if(!Array.isArray(r.selectedDemoMetadata)||r.preselectedDemoCount!==r.selectedDemoMetadata.length)reject('cumulative_frozen_round_denominator');for(const m of r.selectedDemoMetadata){if(demoBindings.has(m.decisionId))reject('cumulative_frozen_duplicate_demo');demoBindings.set(m.decisionId,{metadata:m,productionRef:r.productionRef});}}
 const keepBindings=new Map(evidence.ordinaryCandidateMetadata.map((m:any)=>[m.decisionId,m]));if(keepBindings.size!==evidence.ordinaryCandidateMetadata.length)reject('cumulative_frozen_duplicate_keep');
 for(const sample of samples){if(sample.sampleKind==='demo'){const b=demoBindings.get(sample.decisionId);if(!b||sample.provenance.samplingRef!==b.productionRef||sample.provenance.inputSHA256!==b.metadata.inputSHA256||!equal(sample.key,b.metadata.key))reject('cumulative_frozen_demo_provenance');}else{const m:any=keepBindings.get(sample.decisionId);if(!m||sample.provenance.samplingRef!==plan.samplingRef||sample.provenance.inputSHA256!==m.inputSHA256||!equal(sample.key,m.key))reject('cumulative_frozen_keep_provenance');}}
 const growth=assertCumulativeGrowth(evidence.previousValidDemoIdentities,samples);if(!equal(growth,evidence.growth))reject('cumulative_frozen_growth');
 if(!growth.hasNewValidDemo){summary.qualification.eligible=false;if(!summary.qualification.reasons.includes('cumulative_no_new_valid_demo'))summary.qualification.reasons.push('cumulative_no_new_valid_demo');}
 return summary;
}
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
function selectedRows(plan:DatasetPlan,rows:DatasetSourceRow[],selectionProof:DatasetSelectionProof,alreadyVerified?:ReturnType<typeof verifyOfflineSelection>){
 const t=selectionProof.resolvedInputs;if((plan.purpose==='stage4'||plan.purpose==='first-round-partner-control')&&t.mode!=='research')reject('synthetic_selection_not_stage4_evidence');if(t.phase!=='dataset')reject('selection_dataset_phase_required');
 const verified=alreadyVerified??verifyOfflineSelection(selectionProof.selection,t),{production,selection,spec,budgetRef,selectedMetadata,population}=verified;
 if(!equal(production,selectionProof.production)||production.verification!=='reproduced'||selection.purpose!=='b_training_source'||spec.purpose!=='b_training_source'||plan.samplingRef!==selection.productionRef||plan.sourceIndexRef!==spec.sourceIndexRef||plan.queueRef!==spec.queueRef)reject('stage4_selection_production_binding');
 if(plan.purpose==='first-round-partner-control'){const rule=t.references.get(production.selectionRuleRef);if((plan.designedAugmentation?rule?.schema!=='ohuo-offline-selection-designed-common-view-v1'||rule.protocolRef!==plan.researchProtocol!.revisionRef:isFirstRoundR2DatasetPlan(plan)?rule?.schema!=='ohuo-offline-selection-common-view-r2'||rule.protocolRef!==plan.researchProtocol!.revisionRef:rule?.schema!=='ohuo-offline-selection-first-round-rule-v1')||!plan.designedAugmentation&&rule.postValidationKeepRule!=='same-split-frozen-rank-prefix-equal-valid-demo')reject('first_round_formal_selection_required');}
 const byKey=new Map<string,DatasetSourceRow>();for(const row of rows){const k=canonical(exportKey(row));if(byKey.has(k))reject('selection_duplicate_export_row');byKey.set(k,row);}if(rows.length!==selectedMetadata.length)reject('selection_full_preselected_rows_required');
 const teacherAttemptDiagnostics:any[]=[],terminals=new Map<string,any>(),selectionRef=referenceOf(`offline-label-selection/${spec.outputId}`,selection),control=JSON.parse(readFileSync(join(t.controlRoot,'state.json'),'utf8'));
 if(control.schemaVersion!==1||!control.runs)reject('selection_label_ledger_missing');
 // One synchronous freeze transaction owns this map. Keep the ledger checks
 // below per terminal; only reuse the parsed file digest while its lightweight
 // identity is unchanged. A later transaction always starts with an empty map.
 const checkpointDigests=new Map<string,{signal:string;sha256:string}>();
 const checkpointDigest=(path:string)=>{
  const st=lstatSync(path,{bigint:true}),signal=[st.dev,st.ino,st.mode,st.size,st.mtimeNs,st.ctimeNs].join('|');
  const cached=checkpointDigests.get(path);if(cached?.signal===signal)return cached.sha256;
  const sha256=digest(JSON.parse(readFileSync(path,'utf8')));checkpointDigests.set(path,{signal,sha256});return sha256;
 };
 for(const f of t.labelTerminalRefs??[]){
  if(!f||Object.keys(f).sort().join(',')!=='id,sha256'||typeof f.id!=='string'||!f.id||!sha(f.sha256))reject('selection_terminal_catalog');const mapped=t.evidenceFiles.get(f.id);if(!mapped||Object.keys(mapped).sort().join(',')!=='path,sha256'||mapped.sha256!==f.sha256||isAbsolute(mapped.path)||mapped.path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))reject('selection_terminal_catalog');const path=resolve(t.repositoryRoot,mapped.path);if(realpathSync(path)!==path||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())reject('selection_terminal_file');const bytes=readFileSync(path);if(hash(bytes)!==f.sha256)reject('selection_terminal_file');const terminal=JSON.parse(bytes.toString()),k=canonical(terminal.key);
  const original=selection.rows.find((r:any)=>canonical(r.key)===k);
  if(terminal.schema!=='ohuo-offline-label-result-v1'||terminal.purpose!=='b_training_source'||terminal.selectionRef!==selectionRef||!original||!equal(terminal.source,original)||terminal.inputSHA256!==original.inputSHA256)reject('selection_terminal_identity');const ledgerRows=Object.values(control.runs).flatMap((r:any)=>r.taskSHA256===digest(r.task)&&r.checkpointSHA256===digest(r.checkpoint)&&typeof r.checkpointRef==='string'&&r.checkpointRef===join(r.task.outputRoot,`checkpoint-${r.checkpointSHA256}.json`)&&realpathSync(r.checkpointRef)===r.checkpointRef&&checkpointDigest(r.checkpointRef)===r.checkpointSHA256&&equal(r.task.datasetRefs,[selectionRef])&&r.task.planRef===spec.planRef&&r.task.budgetRef===budgetRef&&r.task.sourcePlan?.sourceIndexRef===spec.sourceIndexRef&&r.task.seatLayoutPlan===spec.queueRef&&r.task.parentPolicyRef===spec.actingReleaseRef&&r.task.releaseRefs?.includes(spec.actingReleaseRef)&&r.checkpoint?.schema==='ohuo-offline-label-run-v1'&&r.checkpoint.taskSHA256===r.taskSHA256&&r.checkpoint.selectionRef===selectionRef?(r.checkpoint.rows??[]).filter((q:any)=>terminal.index===originalLabelTerminalIndex(r,selection,k,t,plan)&&canonical(q.key)===k&&q.inputSHA256===original.inputSHA256&&q.resultRef?.path===path&&q.resultRef.sha256===f.sha256):[]);
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
 const normalized:DatasetSourceRow[]=[],missing=new Set<string>(),cache=new Map();
 for(const meta of selectedMetadata){
  const k=canonical(meta.key),row=byKey.get(k),source=population.find(p=>canonical(p.key)===k&&p.inputSHA256===meta.inputSHA256);if(!row||!source||row.privateInput?.observation?.decisionId!==meta.decisionId||dataHash(row.privateInput)!==meta.inputSHA256)reject('selection_export_row_identity');
  const s=readSelectionSnapshot(source,t,cache);if(designedRow(row)){if(!('designedSource' in s)||!equal(row.source,s.row)||!equal(row.sourceMetadata,s.designedSource)||!equal(row.privateInput,s.input))reject('selection_original_designed_identity');}else if(!('record' in s)||!equal(row.match,s.record)||!equal(row.record,s.decision)||!equal(row.privateInput,s.input))reject('selection_original_record_identity');
  // Ignore no caller override: a disagreement is an error, while the value
  // actually written below is derived from the fixed metadata.
  if(row.sampleClass!==meta.sampleClass||row.sampleKind!==meta.sampleKind)reject('selection_export_role_mismatch');
  if(meta.sampleKind==='keep'){if(designedRow(row))reject('designed_sample_kind');if(row.offlineLabel||terminals.has(k))reject('selection_keep_has_teacher');normalized.push({...row,sampleKind:'keep',sampleClass:'ordinary'});continue;}
  const terminal=terminals.get(k);if(!terminal){if(row.offlineLabel)reject('selection_unbound_label');missing.add(k);normalized.push(designedRow(row)?row:{...row,sampleKind:'demo',sampleClass:meta.sampleClass});continue;}
  if(terminal.decisionId!==meta.decisionId||terminal.inputSHA256!==meta.inputSHA256||!equal(terminal.teacher,plan.identities.teacher)||!equal(terminal.offlineLabel??undefined,row.offlineLabel))reject('selection_label_terminal_binding');
  normalized.push(designedRow(row)?row:{...row,sampleKind:'demo',sampleClass:meta.sampleClass});
 }
 return {rows:normalized,missing,terminals,selectedMetadata,teacherAttemptDiagnostics};
}
type FreezeDatasetArgs={plan:DatasetPlan;sourceIndexPath:string;sourceQueue:any;rows:DatasetSourceRow[];outputDir:string;selectionProof?:DatasetSelectionProof;cumulativeProof?:DatasetCumulativeSelectionProof};
// Public callers cannot provide an already-verified result. The only producer
// of that private argument is this module's immediate fromHost verification.
export function freezeDataset(args:FreezeDatasetArgs):FrozenDatasetRef {return freezeDatasetInternal(args);}
function freezeDatasetInternal({plan,sourceIndexPath,sourceQueue,rows,outputDir,selectionProof,cumulativeProof}:FreezeDatasetArgs,alreadyVerified?:ReturnType<typeof verifyOfflineSelection>,onReproduced?:(counts:{rounds:number;rows:number})=>void):FrozenDatasetRef {
 if(plan.designedAugmentation)reject('designed_augmentation_host_entry_required');
 const firstRoundResearch=isFirstRoundPlan(plan)&&plan.purpose==='first-round-partner-control';
 if(firstRoundResearch&&!selectionProof&&!cumulativeProof)reject('first_round_selection_and_screen_proof_required');
 if(!!plan.cumulativeSampling!==!!cumulativeProof||cumulativeProof&&selectionProof)reject('cumulative_explicit_proof_required');
 if(plan?.purpose==='stage4'&&!selectionProof)reject('stage4_selection_proof_required');
 const cumulative=cumulativeProof?cumulativeSelectedRows(plan,cumulativeProof):null;
 const selectionRows=cumulative??(selectionProof?selectedRows(plan,rows,selectionProof,alreadyVerified):null);if(selectionRows)rows=selectionRows.rows;
 onReproduced?.({rounds:cumulativeProof?.rounds.length??1,rows:rows.length});
 const indexBytes=readFileSync(sourceIndexPath);if(hash(indexBytes)!==plan.sourceIndexSHA256)reject('source_index_identity');validatePlan(plan,JSON.parse(indexBytes.toString()));
 if(dataHash(sourceQueue)!==plan.queueSHA256||sourceQueue?.schema!=='ohuo-complete-match-queue-v1'||sourceQueue.sourceIndexRef!==plan.sourceIndexRef||!Array.isArray(sourceQueue.rows))reject('source_queue_identity');
 for(const game of plan.games){const q=sourceQueue.rows.find((r:any)=>r.matchId===game.matchId);if(!q||q.roundFamilyIds?.[game.gameNo-1]!==(isFirstRoundPlan(plan)?(game.actualSourceFamily??game.sourceFamily):game.sourceFamily)||isFirstRoundPlan(plan)&&q.sourceFamilyId!==undefined&&q.sourceFamilyId!==game.sourceFamily||q.split!==game.split||q.actor!==game.actorSeat)reject('source_queue_game_binding');}
 const admitted:Array<{row:DatasetSourceRow;sample:DistillSample}>=[],exclusions:Exclusion[]=[];
 for(const row of rows){const rowContext=cumulative?.contexts.get(row),rowPlan=rowContext?.plan??plan,rowProof=rowContext?.proof??selectionProof;try{if(selectionRows?.missing.has(canonical(exportKey(row))))reject('preselected_label_missing');if(firstRoundResearch&&row.sampleKind==='demo'){try{row.firstRoundValidation=verifyFirstRoundDemoEvidence({row,plan:rowPlan,proof:rowProof});}catch(error){reject(error instanceof Error?error.message:'first_round_evidence_unverified');}}admitted.push({row,sample:admit(row,rowPlan)});}catch(e){if(!(e instanceof Rejected))throw e;const item=exclusion(row,e.reason,plan),terminal=selectionRows?.terminals.get(canonical(exportKey(row)));if(terminal){item.terminalStatus=terminal.status;item.terminalReason=terminal.remote?.reason??(terminal.status==='execution_uncertain'?'execution_uncertain':null);item.executionKind='offline_suggested';}else if(selectionRows?.missing.has(canonical(exportKey(row)))){item.terminalStatus=null;item.terminalReason='preselected_label_missing';item.executionKind=null;}exclusions.push(item);}}
 const conflicts=isFirstRoundPlan(plan)?findFirstRoundLabelConflicts(admitted.map(a=>a.sample)):[],conflictedIds=new Set(conflicts.flatMap(c=>c.decisionIds));
 const contextCounts=new Map<string,number>(),decisionCounts=new Map<string,number>();
 for(const {sample} of admitted){contextCounts.set(sample.contextSHA256,(contextCounts.get(sample.contextSHA256)??0)+1);decisionCounts.set(sample.decisionId,(decisionCounts.get(sample.decisionId)??0)+1);}
 let samples:DistillSample[]=[];
 for(const a of admitted){if(conflictedIds.has(a.sample.decisionId))exclusions.push(exclusion(a.row,'student_information_gap/label_conflict',plan));else if(contextCounts.get(a.sample.contextSHA256)!>1||decisionCounts.get(a.sample.decisionId)!>1)exclusions.push(exclusion(a.row,'duplicate_causal_context',plan));else{validateSample(a.sample,plan);samples.push(a.sample);}}
 if(firstRoundResearch){const balanced=balanceFirstRoundFrozenKeep(samples,selectionRows!.selectedMetadata);samples=balanced.samples;for(const unused of balanced.unused){const original=admitted.find(a=>a.sample.decisionId===unused.decisionId)!;exclusions.push(exclusion(original.row,'ordinary_keep_not_used_after_demo_validation',plan));}}
 const cumulativeGrowth=cumulative?assertCumulativeGrowth(cumulative.previousSamples,samples):null,cumulativeEvidence=cumulative?{...cumulative.cumulativeEvidence,growth:cumulativeGrowth}:undefined;
 const frozenSummary=cumulativeSummary(summarize(samples,exclusions,plan),cumulativeEvidence,samples,plan);
 const bytes=samples.map(s=>JSON.stringify(s)).join('\n')+(samples.length?'\n':'');
 const manifest={schema:isFirstRoundPlan(plan)?FIRST_ROUND_DATASET_SCHEMA:planCandidatePolicy(plan).candidateSpec===FIRST_TARGET_CANDIDATE_SPEC?CANDIDATE_DATASET_SCHEMA:DATASET_SCHEMA,datasetId:plan.datasetId,plan:structuredClone(plan),identityRefs:{basePolicy:ref(plan.identities.basePolicy.policyId,plan.identities.basePolicy),teacher:ref(plan.identities.teacher.releaseRef,plan.identities.teacher)},samples:{path:'samples.jsonl',sha256:hash(bytes),bytes:Buffer.byteLength(bytes),decisions:samples.length},...frozenSummary,exclusions,...(cumulative?{cumulativeEvidence}:{}),...(isFirstRoundR2DatasetPlan(plan)?{teacherAttemptDiagnostics:selectionRows?.teacherAttemptDiagnostics??[]}:{}),...(isFirstRoundPlan(plan)?{labelConflicts:conflicts}:{})};
 return publishFrozenDataset(outputDir,bytes,JSON.stringify(manifest)+'\n');
}
/** Publication only, after the original source/teacher/screen checks above.
 * The existing host writer lock remains the owner. We never adopt, remove or
 * repair an unknown old directory. A failed fresh stage stays private evidence;
 * retry can build the same bytes in a new stage at the same final datasetId. */
function publishFrozenDataset(outputDir:string,sampleBytes:string,manifestBytes:string):FrozenDatasetRef {
 const directory=resolve(outputDir),outputRoot=resolve(new URL('../out/',import.meta.url).pathname),outputRelative=relative(outputRoot,directory);
 if(!outputRelative||isAbsolute(outputRelative)||outputRelative.startsWith('..'))reject('output_not_task_directory');
 const parent=resolve(directory,'..');mkdirSync(parent,{recursive:true});if(realpathSync(parent)!==parent)reject('output_symlink');
 const reference={directory,manifestSHA256:hash(manifestBytes)};
 const reuse=()=>{
  if(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()||realpathSync(directory)!==directory)reject('output_conflict');
  for(const [name,bytes]of [['manifest.json',manifestBytes],['samples.jsonl',sampleBytes]]){
   const path=join(directory,name);if(!existsSync(path))reject('output_incomplete_or_conflict');const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||!readFileSync(path).equals(Buffer.from(bytes)))reject('output_identity_conflict');
  }
  return reference;
 };
 if(existsSync(directory))return reuse();
 const temporary=mkdtempSync(directory+'.freeze-');
 writeFileSync(join(temporary,'samples.jsonl'),sampleBytes,{flag:'wx',mode:0o600});
 writeFileSync(join(temporary,'manifest.json'),manifestBytes,{flag:'wx',mode:0o600});
 // Preserve the final identity check even under the existing exclusive writer.
 if(existsSync(directory))return reuse();
 renameSync(temporary,directory);return reference;
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
 const retainedHashes=new Set<string>((manifest.plan.designedAugmentation?manifest.designedEvidence?.retainedSamples??[]:[]).map((r:any)=>r.sampleSHA256));
 let samples:DistillSample[];try{samples=text?text.slice(0,-1).split('\n').map((line:string)=>JSON.parse(line)):[];for(const sample of samples)validateSample(sample,manifest.plan,retainedHashes);}catch(e){throw Error('frozen_bad_row: '+(e instanceof Error?e.message:String(e)));}
 if(samples.length!==manifest.samples.decisions||new Set(samples.map(s=>s.decisionId)).size!==samples.length||new Set(samples.map(s=>s.contextSHA256)).size!==samples.length||!Array.isArray(manifest.exclusions)||manifest.exclusions.some((e:any)=>!nonempty(e.reason)||(e.sourceKind==='designed-synthetic'?(!manifest.plan.designedAugmentation||!sha(e.sourceSHA256)||typeof e.sourceRef!=='string'||'recordSHA256' in e):!sha(e.recordSHA256))))reject('frozen_counts_or_duplicates');
 const summary=designedSummary(cumulativeSummary(summarize(samples,manifest.exclusions,manifest.plan),manifest.cumulativeEvidence,samples,manifest.plan),manifest.designedEvidence,samples,manifest.exclusions,manifest.plan);
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
export function materializeFirstRoundDatasetRows({selectionProof,plan}:{selectionProof:DatasetSelectionProof;plan?:DatasetPlan}):DatasetSourceRow[]{
 const t=selectionProof.resolvedInputs;if(t.mode!=='research'||t.phase!=='dataset')reject('first_round_dataset_host_proof_required');
 const verified=verifyOfflineSelection(selectionProof.selection,t);
 return materializeVerifiedFirstRoundDatasetRows(selectionProof,plan,verified);
}
function materializeVerifiedFirstRoundDatasetRows(selectionProof:DatasetSelectionProof,plan:DatasetPlan|undefined,verified:ReturnType<typeof verifyOfflineSelection>):DatasetSourceRow[]{
 const t=selectionProof.resolvedInputs;if(t.mode!=='research'||t.phase!=='dataset')reject('first_round_dataset_host_proof_required');const rule=t.references.get(verified.production.selectionRuleRef);
 if(verified.production.verification!=='reproduced'||!equal(verified.production,selectionProof.production)||!['ohuo-offline-selection-first-round-rule-v1','ohuo-offline-selection-common-view-r2'].includes(rule?.schema)||rule.postValidationKeepRule!=='same-split-frozen-rank-prefix-equal-valid-demo')reject('first_round_formal_selection_required');
 const r2=rule.schema==='ohuo-offline-selection-common-view-r2';
 if(r2&&(!plan||!isFirstRoundR2DatasetPlan(plan)||rule.protocolRef!==plan.researchProtocol!.revisionRef))reject('r2_dataset_plan_teacher_required');
 return materializeFirstRoundOriginalRows(verified,t,r2?plan!.identities.teacher:undefined);
}
/** Same-case direct seam; this does not grant qualification. freezeDataset
 * rechecks fixed production, original terminal ledger and every screen proof. */
export function materializeFirstRoundOriginalRows(verified:any,t:OfflineSelectionTrustedInputs,teacher?:DatasetIdentities['teacher']):ExportRow[]{
 const rows=materializeFirstRoundSourceRows(verified,t,teacher);if(rows.some(designedRow))reject('original_natural_rows_required');return rows as ExportRow[];
}
export function materializeFirstRoundSourceRows(verified:any,t:OfflineSelectionTrustedInputs,teacher?:DatasetIdentities['teacher']):DatasetSourceRow[]{
 const read=(f:Ref)=>{const mapped=t.evidenceFiles.get(f.id);if(!mapped||mapped.sha256!==f.sha256||isAbsolute(mapped.path)||mapped.path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))reject('first_round_rows_fixed_file');const path=resolve(t.repositoryRoot,mapped.path);if(realpathSync(path)!==path||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())reject('first_round_rows_regular_file');const bytes=readFileSync(path);if(hash(bytes)!==f.sha256)reject('first_round_rows_file_hash');return JSON.parse(bytes.toString());};
 const terminals=new Map<string,any>();for(const f of t.labelTerminalRefs??[]){const value=read(f),k=canonical(value.key);if(teacher&&!isFirstRoundTeachingTerminalFor(value,teacher))continue;if(terminals.has(k))reject('first_round_rows_duplicate_terminal');terminals.set(k,value);}
 const state=JSON.parse(readFileSync(join(t.controlRoot,'state.json'),'utf8')),selectionRef=referenceOf(`offline-label-selection/${verified.spec.outputId}`,verified.selection),screens=new Map<string,Ref>();
 for(const run of Object.values(state.runs??{}) as any[]){if(run.task?.planRef!==verified.spec.planRef||!equal(run.task.datasetRefs,[selectionRef])||run.checkpoint?.schema!=='ohuo-first-round-screen-run-v1')continue;
  for(const artifact of run.consumerArtifactRefs??[]){const mappings=[...t.evidenceFiles].filter(([,f])=>resolve(t.repositoryRoot,f.path)===artifact.path&&f.sha256===artifact.sha256);if(mappings.length!==1)reject('first_round_rows_screen_catalog');const f={id:mappings[0][0],sha256:artifact.sha256},value=read(f);if(value.schema!=='ohuo-first-round-screen-summary-v1'||value.selectionRef!==selectionRef)reject('first_round_rows_screen_identity');
   for(const r of value.plans??[]){if(screens.has(r.inputSHA256))reject('first_round_rows_duplicate_screen');screens.set(r.inputSHA256,f);}
  }
 }
 const cache=new Map();return verified.selectedMetadata.map((meta:any)=>{const source=verified.population.find((r:any)=>equal(r.key,meta.key)&&r.inputSHA256===meta.inputSHA256);if(!source)reject('first_round_rows_original_source');const s=readSelectionSnapshot(source,t,cache),row:DatasetSourceRow='designedSource' in s?{sourceKind:'designed-synthetic',sampleKind:'demo',sampleClass:'target',source:s.row,sourceMetadata:s.designedSource,privateInput:s.input as DecisionInput}:{sampleKind:meta.sampleKind,sampleClass:meta.sampleClass,match:s.record as MatchInput,record:s.decision as DecisionRecord,privateInput:s.input as DecisionInput};if('designedSource' in s&&(meta.sampleKind!=='demo'||meta.sampleClass!=='target'))reject('designed_selected_sample_kind');
  if(meta.sampleKind==='demo'){const terminal=terminals.get(canonical(meta.key));if(terminal?.offlineLabel)row.offlineLabel=structuredClone(terminal.offlineLabel);const validationRef=screens.get(meta.inputSHA256),action=s.bundle.pool.find(c=>c.actionId===terminal?.remote?.actionId);if(validationRef&&action)row.firstRoundValidation={evidenceGrade:'provisional_screened',direction:action.canonical===null?'pass':'takeover',validationRef};}
  return row;
 });
}

/** Named source-kind augmentation. It retains the exact original JSONL rows;
 * new train rows still require the original terminal, hard check and screen. */
function freezeDesignedAugmentationFromHost(inputs:any,outputDir:string,onReproduced:(counts:{rounds:number;rows:number})=>void):FrozenDatasetRef {
 const {plan,selectionProof,cumulativeProof,designedAugmentation:host}=inputs as {plan:DatasetPlan;selectionProof:DatasetSelectionProof;cumulativeProof:null;designedAugmentation:{previousDataset:{reference:string;frozen:FrozenDatasetRef};ordinarySelectionProof:DatasetSelectionProof}},a=validateDesignedAugmentation(plan.designedAugmentation),t=inputs.resolvedInputs;
 if(cumulativeProof!==null||!selectionProof||!host||Object.keys(host).sort().join(',')!=='ordinarySelectionProof,previousDataset'||host.previousDataset?.reference!==a.previousDatasetRef||selectionProof.resolvedInputs!==t||t.mode!=='research'||t.phase!=='dataset')reject('designed_host_proof');
 const predecessor=t.references.get(a.previousDatasetRef);if(predecessor?.schema!=='ohuo-frozen-dataset-ref-v1'||digest(predecessor)!==a.previousDatasetRef.split(':').at(-1)||predecessor.manifestSHA256!==host.previousDataset.frozen.manifestSHA256)reject('designed_previous_dataset_ref');
 const previous=loadFrozenDataset(host.previousDataset.frozen,{expectedIdentities:plan.identities}),pp=previous.manifest.plan;
 if(!isFirstRoundR2DatasetPlan(pp)||pp.purpose!=='first-round-partner-control'||pp.datasetId===plan.datasetId)reject('designed_previous_scope');
 const verifyHistoricalProtocol=(previousProtocolRef:string)=>{if(previousProtocolRef!==plan.researchProtocol?.revisionRef)verifyDesignedProtocolLineage({currentProtocolRef:plan.researchProtocol?.revisionRef,previousProtocolRef,references:t.references});};
 verifyHistoricalProtocol(pp.researchProtocol.revisionRef);
 for(const family of pp.families){const current=plan.families.find(f=>f.sourceFamily===family.sourceFamily);if(!current||current.split!==family.split||family.sourceRefs.some((r:string)=>!current.sourceRefs.includes(r)))reject('designed_previous_family_changed');}
 for(const game of pp.games){if(!plan.games.some(g=>equal(g,game)))reject('designed_previous_game_changed');}
 for(const f of plan.families)if(f.split==='dev'&&!pp.families.some((old:any)=>equal(old,f)))reject('designed_dev_family_changed');
 const indexBytes=readFileSync(t.sourceIndexPath);if(hash(indexBytes)!==plan.sourceIndexSHA256)reject('source_index_identity');validatePlan(plan,JSON.parse(indexBytes.toString()));
 const queue=t.references.get(plan.queueRef);if(dataHash(queue)!==plan.queueSHA256||queue?.schema!=='ohuo-designed-source-queue-v1'||queue.sourceIndexRef!==plan.sourceIndexRef)reject('designed_queue_identity');
 const verified=verifyOfflineSelection(selectionProof.selection,t),selectionRef=referenceOf(`offline-label-selection/${verified.spec.outputId}`,verified.selection);
 if(selectionRef!==a.selectionRef||verified.spec.schema!=='ohuo-offline-selection-spec-designed-v1'||verified.spec.sourceIndexRef!==plan.sourceIndexRef||verified.spec.queueRef!==plan.queueRef||verified.selection.productionRef!==plan.samplingRef)reject('designed_selection_binding');
 const rows=materializeFirstRoundSourceRows(verified,t,plan.identities.teacher),checked=selectedRows(plan,rows,selectionProof,verified);
 if(checked.rows.some(r=>!designedRow(r)))reject('designed_selection_source_kind');onReproduced({rounds:1,rows:rows.length});
 const op=host.ordinarySelectionProof,ot=op.resolvedInputs,ordinary=verifyOfflineSelection(op.selection,ot),ordinaryRef=referenceOf(`offline-label-selection/${ordinary.spec.outputId}`,ordinary.selection),ordinaryRule=ot.references.get(ordinary.production.selectionRuleRef);
 if(ot.mode!=='research'||ot.phase!=='dataset'||ot.repositoryRoot!==t.repositoryRoot||ot.controlRoot!==t.controlRoot||ordinaryRef!==a.ordinarySelectionRef||ordinary.spec.schema==='ohuo-offline-selection-spec-designed-v1'||!equal(ordinary.production,op.production)||ordinary.spec.planRef!==verified.spec.planRef||ordinaryRule?.schema!=='ohuo-offline-selection-common-view-r2'||ordinary.spec.actingReleaseRef!==verified.spec.actingReleaseRef)reject('designed_ordinary_original_pool');
 verifyHistoricalProtocol(ordinaryRule.protocolRef);
 const priorNatural=previous.samples.filter((s:any)=>s.provenance.sourceKind===undefined);
 for(const s of priorNatural){const p=ordinary.population.find(p=>equal(p.key,s.key)&&p.inputSHA256===s.provenance.inputSHA256);if(!p||p.split!==s.split||(p.blockFamilyId??p.familyId)!==s.sourceFamily)reject('designed_ordinary_previous_pool');}
 const retainedHashes=new Set<string>(previous.samples.map((s:any)=>dataHash(s))),exclusions:Exclusion[]=structuredClone(previous.manifest.exclusions),priorIds=new Set(previous.samples.map((s:any)=>s.decisionId)),priorContexts=new Set(previous.samples.map((s:any)=>s.contextSHA256)),candidates:Array<{row:DesignedExportRow;sample:DistillSample}>=[];
 for(const row of checked.rows as DesignedExportRow[]){try{
  if(checked.missing.has(canonical(row.source.key)))reject('preselected_label_missing');
  row.firstRoundValidation=verifyFirstRoundDemoEvidence({row,plan,proof:selectionProof});const sample=admit(row,plan);
  if(priorIds.has(sample.decisionId)||priorContexts.has(sample.contextSHA256))reject('designed_previous_context_alias');validateSample(sample,plan);candidates.push({row,sample});
 }catch(error){if(!(error instanceof Rejected)&&!(error instanceof Error))throw error;const reason=error instanceof Rejected?error.reason:(error as Error).message,item=exclusion(row,reason,plan),terminal=checked.terminals.get(canonical(row.source.key));if(terminal){item.terminalStatus=terminal.status;item.terminalReason=terminal.remote?.reason??null;}exclusions.push(item);}}
 const conflicts=findFirstRoundLabelConflicts([...previous.samples,...candidates.map(c=>c.sample)]),conflictedIds=new Set(conflicts.flatMap((c:any)=>c.decisionIds)),counts=new Map<string,number>();
 for(const {sample}of candidates)counts.set(sample.contextSHA256,(counts.get(sample.contextSHA256)??0)+1);
 const newSamples:DistillSample[]=[];for(const {row,sample}of candidates){if(conflictedIds.has(sample.decisionId))exclusions.push(exclusion(row,'student_information_gap/label_conflict',plan));else if(counts.get(sample.contextSHA256)!>1)exclusions.push(exclusion(row,'duplicate_causal_context',plan));else newSamples.push(sample);}
 // Existing rows cannot be removed to make a conflicting new label pass.
 const demos=[...previous.samples,...newSamples].filter((s:any)=>s.sampleKind==='demo'),naturalQueue=ot.references.get(ordinary.spec.queueRef),ordered=cumulativeKeepCandidates(ordinary.population,demos,naturalQueue,ordinaryRule.layoutOrder).filter((p:any)=>p.split==='train');
 const oldTrainKeep=previous.samples.filter((s:any)=>s.split==='train'&&s.sampleKind==='keep');
 if(!equal(ordered.slice(0,oldTrainKeep.length).map((p:any)=>p.decisionId),oldTrainKeep.map((s:any)=>s.decisionId)))reject('designed_previous_keep_not_frozen_prefix');
 const ordinaryPlan={...plan,sourceIndexRef:ordinary.spec.sourceIndexRef,sourceIndexSHA256:hash(readFileSync(ot.sourceIndexPath)),queueRef:ordinary.spec.queueRef,queueSHA256:dataHash(naturalQueue)};delete ordinaryPlan.designedAugmentation;
 const ordinaryCandidateMetadata:any[]=[],addedKeep:DistillSample[]=[],cache=new Map();
 for(const [rank,p]of ordered.entries()){
  const s=readOfflineSnapshot(p,cache),row:NaturalExportRow={sampleKind:'keep',sampleClass:'ordinary',match:s.record as MatchInput,record:s.decision as DecisionRecord,privateInput:s.input as DecisionInput},sample=admit(row,ordinaryPlan);
  ordinaryCandidateMetadata.push({decisionId:sample.decisionId,key:sample.key,inputSHA256:sample.provenance.inputSHA256,rank,sourceFamily:sample.sourceFamily,sourceRef:sample.sourceRef,contextSHA256:sample.contextSHA256});
  if(priorIds.has(sample.decisionId))continue;
  if(priorContexts.has(sample.contextSHA256)||newSamples.some(x=>x.contextSHA256===sample.contextSHA256)||addedKeep.some(x=>x.contextSHA256===sample.contextSHA256))reject('designed_keep_context_alias');
  validateSample(sample,plan);addedKeep.push(sample);
 }
 const samples:DistillSample[]=[...previous.samples,...newSamples,...addedKeep];assertRetainedSamples(previous.samples,samples);for(const s of samples)validateSample(s,plan,retainedHashes);
 const preselectedDemoMetadata=(checked.rows as DesignedExportRow[]).map(row=>({decisionId:row.privateInput.observation.decisionId,key:row.source.key,inputSHA256:row.source.inputSHA256,sourceRef:row.source.sourceRef,sourceIndexRef:row.sourceMetadata.sourceIndexRef,sourceSHA256:row.sourceMetadata.sourceFile.sha256,replaySHA256:row.sourceMetadata.replaySHA256,sourceFamily:row.source.blockFamilyId}));
 const designedEvidence={schema:'ohuo-designed-augmentation-evidence-v1',previousDatasetRef:a.previousDatasetRef,previousManifestSHA256:host.previousDataset.frozen.manifestSHA256,previousSamplesSHA256:previous.manifest.samples.sha256,retainedSamples:previous.samples.map((s:any)=>({decisionId:s.decisionId,sampleSHA256:dataHash(s)})),selectionRef:a.selectionRef,productionRef:plan.samplingRef,populationRef:verified.production.populationRef,selectedMetadataRef:verified.production.selectedMetadataRef,exclusionsRef:verified.production.exclusionsRef,preselectedDemoMetadata,ordinarySelectionRef:a.ordinarySelectionRef,ordinaryProductionRef:ordinary.selection.productionRef,ordinaryPopulationRef:ordinary.production.populationRef,ordinaryCandidateMetadata,newDemoIds:newSamples.map(s=>s.decisionId),addedKeepIds:addedKeep.map(s=>s.decisionId)};
 validateDesignedEvidence(designedEvidence,plan,samples,exclusions,dataHash);
 const summary=designedSummary(summarize(samples,exclusions,plan),designedEvidence,samples,exclusions,plan);
 const bytes=samples.map(s=>JSON.stringify(s)).join('\n')+(samples.length?'\n':'');
 const manifest={schema:FIRST_ROUND_DATASET_SCHEMA,datasetId:plan.datasetId,plan:structuredClone(plan),identityRefs:{basePolicy:ref(plan.identities.basePolicy.policyId,plan.identities.basePolicy),teacher:ref(plan.identities.teacher.releaseRef,plan.identities.teacher)},samples:{path:'samples.jsonl',sha256:hash(bytes),bytes:Buffer.byteLength(bytes),decisions:samples.length},...summary,exclusions,designedEvidence,teacherAttemptDiagnostics:[...(previous.manifest.teacherAttemptDiagnostics??[]),...checked.teacherAttemptDiagnostics],labelConflicts:conflicts};
 return publishFrozenDataset(outputDir,bytes,JSON.stringify(manifest)+'\n');
}
function designedSummary(summary:any,evidence:any,samples:DistillSample[],exclusions:Exclusion[],plan:DatasetPlan){
 if(!plan.designedAugmentation){if(evidence!==undefined)reject('designed_unexpected_evidence');return summary;}
 const checked=validateDesignedEvidence(evidence,plan,samples,exclusions,dataHash);
 if(!checked.newDemoIds.length){summary.qualification.eligible=false;if(!summary.qualification.reasons.includes('designed_no_new_valid_demo'))summary.qualification.reasons.push('designed_no_new_valid_demo');}
 return summary;
}

export async function freezeFirstRoundDatasetFromHost({planRef,selectionRef,outputDir}:{planRef:string;selectionRef:string;outputDir:string}){
 const started=Date.now(),progress=(stage:string,counts:Record<string,number|boolean>={})=>process.stderr.write(JSON.stringify({stage,elapsedMilliseconds:Date.now()-started,...counts})+'\n');
 progress('dataset_freeze_started');
 try{
 const {createFirstRoundDatasetFreezeInputs}=await import('./ohuo-host-files'),inputs=await createFirstRoundDatasetFreezeInputs(planRef,selectionRef),{plan,selectionProof,cumulativeProof}=inputs,t=inputs.resolvedInputs;
 if(!plan||digest(plan)!==planRef.split(':').at(-1)||plan.schema!=='ohuo-distill-plan-first-round-v3'||plan.purpose!=='first-round-partner-control')reject('first_round_fixed_plan_required');
 if(resolve(outputDir)!==join(t.repositoryRoot,'lab/out',plan.datasetId))reject('first_round_fixed_dataset_output');
 const onReproduced=(counts:{rounds:number;rows:number})=>progress('dataset_selection_reproduced',counts);let result:FrozenDatasetRef;
 if(plan.designedAugmentation){result=freezeDesignedAugmentationFromHost(inputs,outputDir,onReproduced);}
 else if(plan.cumulativeSampling){if(selectionProof!==null||!cumulativeProof)reject('cumulative_host_dispatch');result=freezeDatasetInternal({plan,sourceIndexPath:t.sourceIndexPath,sourceQueue:t.references.get(plan.queueRef),rows:[],outputDir,cumulativeProof},undefined,onReproduced);}
 else{
  if(cumulativeProof!==null||!selectionProof)reject('first_round_host_dispatch');
  const verified=verifyOfflineSelection(selectionProof.selection,t),rows=materializeVerifiedFirstRoundDatasetRows(selectionProof,plan,verified),sourceQueue=t.references.get(plan.queueRef);
  result=freezeDatasetInternal({plan,sourceIndexPath:t.sourceIndexPath,sourceQueue,rows,outputDir,selectionProof},verified,onReproduced);
 }
 progress('dataset_freeze_result',{saved:true});return result;
 }catch(error){progress('dataset_freeze_result',{saved:false});throw error;}
}
