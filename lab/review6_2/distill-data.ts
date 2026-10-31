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
import type {RemoteDecisionResult} from '../../packages/ai/src/hybrid/remote-selector';
import {verifyOfflineSelection,type OfflineSelectionTrustedInputs} from './offline-selection';
import {readOfflineSnapshot} from './offline-label-source';
import {canonical,digest,referenceOf} from './task-schema.mjs';

export const DATASET_SCHEMA='ohuo-distill-dataset-v2' as const;
export const SAMPLE_SCHEMA='ohuo-distill-decision-v2' as const;
type Split='train'|'dev';
type Ref={id:string;sha256:string};
type BaseIdentity={policyId:string;weightsSHA256?:string;encoderVersion:string;inputDim:number;[key:string]:unknown};
export interface DatasetIdentities {basePolicy:BaseIdentity;teacher:{releaseRef:string;promptRef:string;profileSnapshot:Record<string,unknown>};encoderVersion:string;encoderConfig:Record<string,unknown>;candidateSpecRef:string;promptRef:string}
export interface FamilyBinding {sourceFamily:string;split:Split;sourceRefs:string[]}
export interface GameBinding {matchId:string;gameNo:number;sourceFamily:string;split:Split;sourceRef:string;sourceSHA256:string;actorSeat:number}
export interface DatasetPlan {schema:'ohuo-distill-plan-v1';datasetId:string;purpose:'engineering_fixture'|'stage4';sourceIndexRef:string;sourceIndexSHA256:string;queueRef:string;queueSHA256:string;samplingRef:string;identities:DatasetIdentities;families:FamilyBinding[];games:GameBinding[]}
/** Exact B07 JSON boundary; candidateInputs is materialized by its owner from
 * each initial-C action, not reconstructed here from features or rankings. */
export interface DecisionInput {schema:'ohuo-decision-input-v1';key:DecisionKey;policyId:string;observation:{decisionId:string;matchId:string;gameNo:number;moveNo:number;actorSeat:number;[key:string]:unknown};candidateSpec:string;initialCandidateIds:string[];pool:FrozenCandidate[];candidateInputs:null|{encoderVersion:string;policyId:string;inputDim:number;candidateIds:string[];candidateFeatures:number[][];rawQ:number[];policyIdentity:BaseIdentity;encoder:Record<string,unknown>;[key:string]:unknown}}
export interface DecisionRecord {key:DecisionKey;policyId:string;initialCandidateIds:string[];offeredIds:string[];requestedActionId:string|null;actualActionId:string|null;actualMove:any;actualSource:string|null;status:string;reason:string|null;executionKind:string;trainingInputSHA256:string|null;requests:Array<Record<string,unknown>>;[key:string]:unknown}
export interface MatchInput {schema:'ohuo-confirmed-match-v1';matchId:string;sourceRef:string;seatSnapshots?:any[];decisions:DecisionRecord[];[key:string]:unknown}
export interface OfflineLabel {schema:'ohuo-offline-choose-v1';inputSHA256:string;key:DecisionKey;remote:RemoteDecisionResult;teacher:DatasetIdentities['teacher'];canonicalId:string|null;legality:'validated'|'not-selected'}
export interface ExportRow {sampleKind:'demo'|'keep';sampleClass:'target'|'ordinary';match:MatchInput;record:DecisionRecord;privateInput:DecisionInput;offlineLabel?:OfflineLabel}
interface SampleBase {schema:typeof SAMPLE_SCHEMA;sampleKind:'demo'|'keep';sampleClass:'target'|'ordinary';decisionId:string;sourceFamily:string;sourceRef:string;split:Split;key:DecisionKey;observationRef:Ref;contextSHA256:string;encoderVersion:string;candidateSpecRef:string;candidateIds:string[];candidateOriginalIndices:number[];candidateCanonicalIds:string[];candidateFeatures:number[][];rawQ:number[];baseActionId:string;basePolicyRef:Ref;qualityFlags:string[];provenance:{inputSHA256:string;recordSHA256:string;matchSHA256:string;samplingRef:string}}
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
function validatePlan(plan:DatasetPlan,index?:any){
 if(plan?.schema!=='ohuo-distill-plan-v1'||!nonempty(plan.datasetId)||!['engineering_fixture','stage4'].includes(plan.purpose)||!nonempty(plan.sourceIndexRef)||!sha(plan.sourceIndexSHA256)||!nonempty(plan.queueRef)||!sha(plan.queueSHA256)||!nonempty(plan.samplingRef))reject('plan_identity');
 const ids=plan.identities,b=ids?.basePolicy,t=ids?.teacher;
 if(!b||b.inputDim!==399||!nonempty(b.policyId)||(plan.purpose==='stage4'?!sha(b.weightsSHA256):b.weightsSHA256!==undefined&&!sha(b.weightsSHA256))||b.encoderVersion!==ids.encoderVersion||!nonempty(ids.encoderVersion)||ids.encoderConfig?.schema!=='v2'||!['zero','rule-context'].includes(ids.encoderConfig.ctxFill as string)||!['action64','legacy-phys10'].includes(ids.encoderConfig.passEncoding as string)||(b.passEncoding!==undefined?ids.encoderConfig.passEncoding!==b.passEncoding:plan.purpose==='stage4')||!nonempty(ids.candidateSpecRef)||!nonempty(ids.promptRef)||!t||!nonempty(t.releaseRef)||t.promptRef!==ids.promptRef||!t.profileSnapshot||PROFILE_FIELDS.some(k=>t.profileSnapshot[k]===undefined))reject('frozen_policy_identity');
 if(!Array.isArray(plan.families)||!plan.families.length||!Array.isArray(plan.games))reject('source_bindings');
 const families=new Map<string,FamilyBinding>(),sources=new Map<string,string>();
 for(const family of plan.families){
  if(!nonempty(family.sourceFamily)||families.has(family.sourceFamily)||!['train','dev'].includes(family.split)||!uniqueStrings(family.sourceRefs))reject('family_split_conflict');
  if(index&&(index.version!==1||index.families?.[family.sourceFamily]?.split!==family.split))reject('source_index_split');
  for(const source of family.sourceRefs){if(sources.has(source)&&sources.get(source)!==family.sourceFamily)reject('source_family_alias');sources.set(source,family.sourceFamily);}
  families.set(family.sourceFamily,family);
 }
 const games=new Set<string>();
 for(const game of plan.games){const family=families.get(game.sourceFamily),id=JSON.stringify([game.matchId,game.gameNo]);
  if(!family||game.split!==family.split||!family.sourceRefs.includes(game.sourceRef)||!sha(game.sourceSHA256)||!nonempty(game.matchId)||!Number.isSafeInteger(game.gameNo)||game.gameNo<1||!Number.isInteger(game.actorSeat)||game.actorSeat<0||game.actorSeat>3||games.has(id))reject('game_family_binding');games.add(id);
 }
}
function admit(row:ExportRow,plan:DatasetPlan):DistillSample {
 const {record:d,privateInput:p,match}=row;
 if(!row||!['demo','keep'].includes(row.sampleKind)||!['target','ordinary'].includes(row.sampleClass)||row.sampleKind==='keep'&&row.sampleClass!=='ordinary')reject('sample_kind');
 if(match?.schema!=='ohuo-confirmed-match-v1'||!d?.key||match.matchId!==d.key.matchId||match.sourceRef!==plan.sourceIndexRef||match.layoutRef!==plan.queueRef||!Array.isArray(match.games)||!Array.isArray(match.decisions)||!match.decisions.some(r=>equal(r,d)))reject('record_identity');
 const binding=plan.games.find(g=>g.matchId===d.key.matchId&&g.gameNo===d.key.gameNo);
 if(!binding||binding.actorSeat!==d.key.actorSeat||match.evaluatedActor!==binding.actorSeat||match.split!==binding.split||(match.games as Array<any>)?.find(g=>g.gameNo===d.key.gameNo)?.sourceSHA256!==binding.sourceSHA256||(match.games as Array<any>)?.find(g=>g.gameNo===d.key.gameNo)?.sourceFamilyId!==binding.sourceFamily)reject('sample_actor_or_family');
 if(p?.schema!=='ohuo-decision-input-v1'||!equal(p.key,d.key)||!sha(d.trainingInputSHA256)||dataHash(p)!==d.trainingInputSHA256)reject('private_input_identity');
 const obs=p.observation,ids=plan.identities,seat=match.seatSnapshots?.[d.key.actorSeat];
 if(!obs||!nonempty(obs.decisionId)||obs.matchId!==d.key.matchId||obs.gameNo!==d.key.gameNo||obs.moveNo!==d.key.moveNo||obs.actorSeat!==d.key.actorSeat)reject('observation_identity');
 if(!equal(seat?.policyIdentity,ids.basePolicy)||d.policyId!==ids.basePolicy.policyId||p.policyId!==ids.basePolicy.policyId||p.candidateSpec!==ids.candidateSpecRef)reject('base_policy_identity');
 const x=p.candidateInputs;
 if(!x||x.inputDim!==399||x.encoderVersion!==ids.encoderVersion||x.policyId!==ids.basePolicy.policyId||!equal(x.policyIdentity,ids.basePolicy)||!equal(x.encoder,ids.encoderConfig))reject('candidate_input_identity');
 if(!uniqueStrings(p.initialCandidateIds)||p.initialCandidateIds.length>8||!equal(p.initialCandidateIds,d.initialCandidateIds)||!equal(p.initialCandidateIds,x.candidateIds))reject('initial_c_alignment');
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
 const baseAction=p.pool.reduce((best,a)=>a.rawQ>best.rawQ||a.rawQ===best.rawQ&&a.originalIndex<best.originalIndex?a:best);
 if(!x.candidateIds.includes(baseAction.actionId))reject('base_action_outside_c');
 const {decisionId:_decision,matchId:_match,...causalObservation}=obs;
 const common:SampleBase={schema:SAMPLE_SCHEMA,sampleKind:row.sampleKind,sampleClass:row.sampleClass,decisionId:obs.decisionId,sourceFamily:binding.sourceFamily,sourceRef:binding.sourceRef,split:binding.split,key:structuredClone(d.key),observationRef:ref(obs.decisionId,obs),contextSHA256:dataHash([binding.sourceFamily,causalObservation,actions.map(a=>a.action.canonicalId)]),encoderVersion:ids.encoderVersion,candidateSpecRef:ids.candidateSpecRef,candidateIds:actions.map(a=>a.action.actionId),candidateOriginalIndices:actions.map(a=>a.action.originalIndex),candidateCanonicalIds:actions.map(a=>a.action.canonicalId),candidateFeatures:actions.map(a=>a.features),rawQ:actions.map(a=>a.rawQ),baseActionId:baseAction.actionId,basePolicyRef:ref(ids.basePolicy.policyId,ids.basePolicy),qualityFlags:[],provenance:{inputSHA256:dataHash(p),recordSHA256:dataHash(d),matchSHA256:dataHash(match),samplingRef:plan.samplingRef}};
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
 return {...common,sampleKind:'demo',targetIds:[target],teacherPolicyRef:ref(ids.teacher.releaseRef,ids.teacher),labelKind:'teacher_action',executionKind,labelSourceRef:ref(obs.decisionId+':teacher',labelSource)};
}
function validateSample(s:any,plan:DatasetPlan){
 const keys=['schema','sampleKind','sampleClass','decisionId','sourceFamily','sourceRef','split','key','observationRef','contextSHA256','encoderVersion','candidateSpecRef','candidateIds','candidateOriginalIndices','candidateCanonicalIds','candidateFeatures','rawQ','baseActionId','basePolicyRef','qualityFlags','provenance'];
 if(s?.sampleKind==='demo')keys.push('targetIds','teacherPolicyRef','labelKind','executionKind','labelSourceRef');
 if(!s||Object.keys(s).sort().join()!==keys.sort().join()||s.schema!==SAMPLE_SCHEMA||!['demo','keep'].includes(s.sampleKind)||!['target','ordinary'].includes(s.sampleClass)||s.sampleKind==='keep'&&s.sampleClass!=='ordinary')reject('sample_schema');
 const g=plan.games.find(g=>g.matchId===s.key?.matchId&&g.gameNo===s.key?.gameNo);
 if(!g||s.key.actorSeat!==g.actorSeat||s.sourceFamily!==g.sourceFamily||s.sourceRef!==g.sourceRef||s.split!==g.split||!nonempty(s.decisionId)||!sha(s.contextSHA256))reject('sample_source');
 if(s.encoderVersion!==plan.identities.encoderVersion||s.candidateSpecRef!==plan.identities.candidateSpecRef||!equal(s.basePolicyRef,ref(plan.identities.basePolicy.policyId,plan.identities.basePolicy)))reject('sample_identity');
 const k=s.candidateIds?.length;
 if(!Array.isArray(s.candidateOriginalIndices)||s.candidateOriginalIndices.length!==k||s.candidateOriginalIndices.some((i:unknown)=>!Number.isSafeInteger(i)||(i as number)<0)||new Set(s.candidateOriginalIndices).size!==k)reject('sample_original_indices');
 if(!uniqueStrings(s.candidateIds)||k>8||!uniqueStrings(s.candidateCanonicalIds)||s.candidateCanonicalIds.length!==k||!s.candidateIds.includes(s.baseActionId)||!Array.isArray(s.rawQ)||s.rawQ.length!==k||!s.rawQ.every(finite)||!Array.isArray(s.candidateFeatures)||s.candidateFeatures.length!==k||!s.candidateFeatures.every((f:unknown)=>Array.isArray(f)&&f.length===399&&f.every(finite)))reject('sample_vectors');
 if(!Array.isArray(s.qualityFlags)||s.qualityFlags.some((q:unknown)=>!nonempty(q))||!sha(s.observationRef?.sha256)||s.observationRef.id!==s.decisionId||s.provenance?.samplingRef!==plan.samplingRef||!['inputSHA256','recordSHA256','matchSHA256'].every(k=>sha(s.provenance[k])))reject('sample_provenance');
 if(s.sampleKind==='demo'&&(!uniqueStrings(s.targetIds)||s.targetIds.some((id:string)=>!s.candidateIds.includes(id))||s.labelKind!=='teacher_action'||!['committed','offline_suggested'].includes(s.executionKind)||!equal(s.teacherPolicyRef,ref(plan.identities.teacher.releaseRef,plan.identities.teacher))||!sha(s.labelSourceRef?.sha256)||!nonempty(s.labelSourceRef?.id)))reject('sample_teacher');
}
function summarize(samples:DistillSample[],exclusions:Exclusion[],plan:DatasetPlan){
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
function selectedRows(plan:DatasetPlan,rows:ExportRow[],selectionProof:DatasetSelectionProof){
 const t=selectionProof.resolvedInputs;if(plan.purpose==='stage4'&&t.mode!=='research')reject('synthetic_selection_not_stage4_evidence');if(t.phase!=='dataset')reject('selection_dataset_phase_required');
 const verified=verifyOfflineSelection(selectionProof.selection,t),{production,selection,spec,budgetRef,selectedMetadata,population}=verified;
 if(!equal(production,selectionProof.production)||production.verification!=='reproduced'||selection.purpose!=='b_training_source'||spec.purpose!=='b_training_source'||plan.samplingRef!==selection.productionRef||plan.sourceIndexRef!==spec.sourceIndexRef||plan.queueRef!==spec.queueRef)reject('stage4_selection_production_binding');
 const byKey=new Map<string,ExportRow>();for(const row of rows){const k=canonical(row.record?.key??null);if(byKey.has(k))reject('selection_duplicate_export_row');byKey.set(k,row);}if(rows.length!==selectedMetadata.length)reject('selection_full_preselected_rows_required');
 const terminals=new Map<string,any>(),selectionRef=referenceOf(`offline-label-selection/${spec.outputId}`,selection),control=JSON.parse(readFileSync(join(t.controlRoot,'state.json'),'utf8'));
 if(control.schemaVersion!==1||!control.runs)reject('selection_label_ledger_missing');
 for(const f of t.labelTerminalRefs??[]){
  if(!f||Object.keys(f).sort().join(',')!=='id,sha256'||typeof f.id!=='string'||!f.id||!sha(f.sha256))reject('selection_terminal_catalog');const mapped=t.evidenceFiles.get(f.id);if(!mapped||Object.keys(mapped).sort().join(',')!=='path,sha256'||mapped.sha256!==f.sha256||isAbsolute(mapped.path)||mapped.path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))reject('selection_terminal_catalog');const path=resolve(t.repositoryRoot,mapped.path);if(realpathSync(path)!==path||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())reject('selection_terminal_file');const bytes=readFileSync(path);if(hash(bytes)!==f.sha256)reject('selection_terminal_file');const terminal=JSON.parse(bytes.toString()),k=canonical(terminal.key);
  const original=selection.rows.find((r:any)=>canonical(r.key)===k);
  if(terminals.has(k)||terminal.schema!=='ohuo-offline-label-result-v1'||terminal.purpose!=='b_training_source'||terminal.selectionRef!==selectionRef||!original||!equal(terminal.source,original)||terminal.inputSHA256!==original.inputSHA256)reject('selection_terminal_identity');const ledgerRows=Object.values(control.runs).flatMap((r:any)=>r.taskSHA256===digest(r.task)&&r.checkpointSHA256===digest(r.checkpoint)&&typeof r.checkpointRef==='string'&&r.checkpointRef===join(r.task.outputRoot,`checkpoint-${r.checkpointSHA256}.json`)&&realpathSync(r.checkpointRef)===r.checkpointRef&&digest(JSON.parse(readFileSync(r.checkpointRef,'utf8')))===r.checkpointSHA256&&equal(r.task.datasetRefs,[selectionRef])&&r.task.planRef===spec.planRef&&r.task.budgetRef===budgetRef&&r.task.sourcePlan?.sourceIndexRef===spec.sourceIndexRef&&r.task.seatLayoutPlan===spec.queueRef&&r.task.parentPolicyRef===spec.actingReleaseRef&&r.task.releaseRefs?.includes(spec.actingReleaseRef)&&r.checkpoint?.schema==='ohuo-offline-label-run-v1'&&r.checkpoint.taskSHA256===r.taskSHA256&&r.checkpoint.selectionRef===selectionRef?(r.checkpoint.rows??[]).filter((q:any)=>terminal.index===selection.rows.filter((p:any)=>p.split===r.task.sourcePlan.split&&r.task.sourcePlan.familyIds.includes(p.familyId)).findIndex((p:any)=>canonical(p.key)===k)&&canonical(q.key)===k&&q.inputSHA256===original.inputSHA256&&q.resultRef?.path===path&&q.resultRef.sha256===f.sha256):[]);
  if(ledgerRows.length!==1||ledgerRows[0].status!==terminal.status||ledgerRows[0].labelKind!==terminal.labelKind)reject('selection_terminal_not_committed_in_label_ledger');terminals.set(k,terminal);
 }
 for(const r of Object.values(control.runs) as any[])if(equal(r.task?.datasetRefs,[selectionRef])&&r.task?.planRef===spec.planRef){for(const committed of r.checkpoint?.rows??[])if(!terminals.has(canonical(committed.key)))reject('selection_committed_terminal_omitted');}
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
 return {rows:normalized,missing,terminals};
}
export function freezeDataset({plan,sourceIndexPath,sourceQueue,rows,outputDir,selectionProof}:{plan:DatasetPlan;sourceIndexPath:string;sourceQueue:any;rows:ExportRow[];outputDir:string;selectionProof?:DatasetSelectionProof}):FrozenDatasetRef {
 if(plan?.purpose==='stage4'&&!selectionProof)reject('stage4_selection_proof_required');
 const selectionRows=selectionProof?selectedRows(plan,rows,selectionProof):null;if(selectionRows)rows=selectionRows.rows;
 const indexBytes=readFileSync(sourceIndexPath);if(hash(indexBytes)!==plan.sourceIndexSHA256)reject('source_index_identity');validatePlan(plan,JSON.parse(indexBytes.toString()));
 if(dataHash(sourceQueue)!==plan.queueSHA256||sourceQueue?.schema!=='ohuo-complete-match-queue-v1'||sourceQueue.sourceIndexRef!==plan.sourceIndexRef||!Array.isArray(sourceQueue.rows))reject('source_queue_identity');
 for(const game of plan.games){const q=sourceQueue.rows.find((r:any)=>r.matchId===game.matchId);if(!q||q.roundFamilyIds?.[game.gameNo-1]!==game.sourceFamily||q.split!==game.split||q.actor!==game.actorSeat)reject('source_queue_game_binding');}
 const admitted:Array<{row:ExportRow;sample:DistillSample}>=[],exclusions:Exclusion[]=[];
 for(const row of rows){try{if(selectionRows?.missing.has(canonical(row.record.key)))reject('preselected_label_missing');admitted.push({row,sample:admit(row,plan)});}catch(e){if(!(e instanceof Rejected))throw e;const item=exclusion(row,e.reason,plan),terminal=selectionRows?.terminals.get(canonical(row.record.key));if(terminal){item.terminalStatus=terminal.status;item.terminalReason=terminal.remote?.reason??(terminal.status==='execution_uncertain'?'execution_uncertain':null);item.executionKind='offline_suggested';}else if(selectionRows?.missing.has(canonical(row.record.key))){item.terminalStatus=null;item.terminalReason='preselected_label_missing';item.executionKind=null;}exclusions.push(item);}}
 const contextCounts=new Map<string,number>(),decisionCounts=new Map<string,number>();
 for(const {sample} of admitted){contextCounts.set(sample.contextSHA256,(contextCounts.get(sample.contextSHA256)??0)+1);decisionCounts.set(sample.decisionId,(decisionCounts.get(sample.decisionId)??0)+1);}
 const samples:DistillSample[]=[];
 for(const a of admitted){if(contextCounts.get(a.sample.contextSHA256)!>1||decisionCounts.get(a.sample.decisionId)!>1)exclusions.push(exclusion(a.row,'duplicate_causal_context',plan));else{validateSample(a.sample,plan);samples.push(a.sample);}}
 // Create a fresh directory. Manifest is the last file: a partial write has no
 // usable reference and is never mistaken for a committed frozen dataset.
 const directory=resolve(outputDir),outputRoot=resolve(new URL('../out/',import.meta.url).pathname),outputRelative=relative(outputRoot,directory);if(!outputRelative||isAbsolute(outputRelative)||outputRelative.startsWith('..'))reject('output_not_task_directory');if(existsSync(directory))reject('output_exists');
 const parent=resolve(directory,'..');mkdirSync(parent,{recursive:true});if(realpathSync(parent)!==parent)reject('output_symlink');mkdirSync(directory,{mode:0o700});
 const bytes=samples.map(s=>JSON.stringify(s)).join('\n')+(samples.length?'\n':'');
 writeFileSync(join(directory,'samples.jsonl'),bytes,{flag:'wx',mode:0o600});
 const manifest={schema:DATASET_SCHEMA,datasetId:plan.datasetId,plan:structuredClone(plan),identityRefs:{basePolicy:ref(plan.identities.basePolicy.policyId,plan.identities.basePolicy),teacher:ref(plan.identities.teacher.releaseRef,plan.identities.teacher)},samples:{path:'samples.jsonl',sha256:hash(bytes),bytes:Buffer.byteLength(bytes),decisions:samples.length},...summarize(samples,exclusions,plan),exclusions};
 const manifestBytes=JSON.stringify(manifest)+'\n';writeFileSync(join(directory,'manifest.json'),manifestBytes,{flag:'wx',mode:0o600});
 return {directory,manifestSHA256:hash(manifestBytes)};
}
export function loadFrozenDataset(reference:FrozenDatasetRef,options:{expectedIdentities?:DatasetIdentities;requireTrainingEligible?:boolean}={}){
 const directory=resolve(reference.directory);if(!sha(reference.manifestSHA256)||realpathSync(directory)!==directory)reject('manifest_identity');
 const path=join(directory,'manifest.json');if(!existsSync(path)||lstatSync(path).isSymbolicLink())reject('manifest_missing');const bytes=readFileSync(path);if(hash(bytes)!==reference.manifestSHA256)reject('manifest_identity');
 const manifest=JSON.parse(bytes.toString());if(manifest.schema!==DATASET_SCHEMA||manifest.datasetId!==manifest.plan?.datasetId)reject('manifest_schema');validatePlan(manifest.plan);
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
