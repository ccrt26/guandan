/** Section 36B fixed public-snapshot probe. No model load, game execution,
 * optimizer, label writer, shell, listener or alternative LLM transport. */
import {readFileSync,writeFileSync,renameSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {createTaskController} from './task-control.mjs';
import {digest,strictObject,fixedReference,validateTask,validateIdentifier,validateLimits} from './task-schema.mjs';
import {createMeteredRemote,validateMatchRules} from './match-consumer';
import {createProfileSelector} from '../../packages/web/server/llm-select.mjs';
import {selectRemoteDecision} from '../../packages/ai/src/hybrid/remote-selector';
import {freezeCopy,publicCombo,CANDIDATE_SPEC,type DecisionBundle} from '../../packages/ai/src/hybrid/protocol';
import {resolveCandidateReleaseRef} from '../../packages/ai/src/policy/candidate-release';
import {candidatePolicyForBundle,resolveCandidatePolicy,FIRST_TARGET_CANDIDATE_SPEC} from '../../packages/ai/src/candidate-spec';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {decisionRequestView} from '../../packages/ai/src/hybrid/candidates';
import {canonicalActionId} from '../../packages/ai/src/hybrid/legality';
import {describeRules} from '../../packages/ai/src/hybrid/observation';
import {freezeRequestView} from '../../packages/web/server/llm-selection-wire.mjs';
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const scope=(apiCalls=false)=>({localExecution:true,apiCalls,parameterUpdates:false,deployment:false});
interface Snapshot {snapshotId:string;phase:'early'|'middle'|'late';bundleRef:string;bundle:DecisionBundle}
interface Prepared {spec:any;plan:any;snapshots:Snapshot[];reference:any;publicProfile:any;store:any;sourceIndexPath:string;sourceIndexSHA256:string}
interface Checkpoint {schema:'ohuo-api-probe-run-v1';binding:any;cursor:number;active:null|{index:number;snapshotId:string;bundleRef:string};rows:any[];executionUnknown:boolean}
const integer=(v:any,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const number=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const count=(v:any)=>v===null||integer(v,0,1);
const binding=(task:any,p:Prepared)=>({taskSHA256:digest(task),sourceRevision:task.sourceRevision,runtimeRef:task.runtimeRef,specRef:task.datasetRefs[0],screeningPlanRef:p.spec.screeningPlanRef,snapshotSetRef:p.spec.snapshotSetRef,configurationRef:p.spec.configurationRef,configurationOrdinal:p.spec.configurationOrdinal,profileRevisionRef:p.reference,snapshotOrder:p.snapshots.map(s=>({snapshotId:s.snapshotId,bundleRef:s.bundleRef}))});
function validateCheckpoint(c:Checkpoint):boolean{
 try{
  strictObject(c,'checkpoint',['schema','binding','cursor','active','rows','executionUnknown']);
  strictObject(c.binding,'binding',['taskSHA256','sourceRevision','runtimeRef','specRef','screeningPlanRef','snapshotSetRef','configurationRef','configurationOrdinal','profileRevisionRef','snapshotOrder']);
  if(c.schema!=='ohuo-api-probe-run-v1'||!/^[a-f0-9]{64}$/.test(c.binding.taskSHA256)||![0,1].includes(c.binding.configurationOrdinal)||!integer(c.cursor,0,12)||!Array.isArray(c.rows)||c.rows.length!==c.cursor||typeof c.executionUnknown!=='boolean'||!Array.isArray(c.binding.snapshotOrder)||c.binding.snapshotOrder.length!==12)return false;
  for(const key of ['sourceRevision','runtimeRef','specRef','screeningPlanRef','snapshotSetRef','configurationRef'])fixedReference(c.binding[key],key);
  if(c.active!==null){strictObject(c.active,'active',['index','snapshotId','bundleRef']);if(c.active.index!==c.cursor||!equal({snapshotId:c.active.snapshotId,bundleRef:c.active.bundleRef},c.binding.snapshotOrder[c.cursor]))return false;}
  for(const [i,r] of c.rows.entries()){
   strictObject(r,'row',['snapshotId','phase','bundleRef','status','reason','actionId','inInitialCandidateSet','mainRequests','expansionRequests','startedAt','terminalAt','elapsedMs','attempts']);
   if(!equal({snapshotId:r.snapshotId,bundleRef:r.bundleRef},c.binding.snapshotOrder[i])||!['early','middle','late'].includes(r.phase)||!['selected','remote_failure','cancelled','halted','execution_uncertain'].includes(r.status)||!count(r.mainRequests)||!count(r.expansionRequests)||!number(r.startedAt)||!number(r.terminalAt)||r.terminalAt<r.startedAt||!number(r.elapsedMs)||!Array.isArray(r.attempts)||r.attempts.length>2)return false;
   if(r.status==='selected'&&(typeof r.actionId!=='string'||typeof r.inInitialCandidateSet!=='boolean'||r.reason!==null)||r.status!=='selected'&&(r.actionId!==null||r.inInitialCandidateSet!==null||typeof r.reason!=='string'))return false;
   for(const [j,a] of r.attempts.entries()){
    strictObject(a,'attempt',['stage','status','reason','startedAt','terminalAt','usageStatus','summary']);
    if(!['reported','unknown'].includes(a.usageStatus)||a.usageStatus!==(a.summary?.usage&&Object.keys(a.summary.usage).length?'reported':'unknown')||a.stage!==(j===0?'main':'expansion')||!['response','remote_failure','cancelled','unknown'].includes(a.status)||!number(a.startedAt)||!number(a.terminalAt)||a.terminalAt<a.startedAt||!a.summary||!count(a.summary.requestCount))return false;
   }
   if(r.mainRequests!==(r.attempts[0]?.summary.requestCount??(r.attempts.length?null:0))||r.expansionRequests!==(r.attempts[1]?.summary.requestCount??(r.attempts.length>1?null:0)))return false;
  }
  return true;
 }catch{return false;}
}
/** Verify the public catalog only. Original generation/visibility/phase truth is
 * established by the original scientific prerequisite, not by hashes or shape.
 * Never follows private report paths or executes the declared producer. */
export function verifyProbeSnapshots({task:inputTask,refs,inputs}:any):Omit<Prepared,'store'>{
 const task=validateTask(inputTask),catalog=inputs?.probeCatalog;
 if(!(refs instanceof Map)||!(catalog instanceof Map)||!inputs?.probeProfile)throw Error('probe_inputs_missing: verified public catalog/profile required');
 const cache=new Map<string,any>();
 const read=(ref:string):any=>{
  fixedReference(ref,'probeReference');if(cache.has(ref))return cache.get(ref);
  const values=[...(refs.has(ref)?[refs.get(ref)]:[]),...(catalog.has(ref)?[catalog.get(ref)]:[])];
  if(!values.length||values.some(v=>digest(v)!==ref.slice(ref.lastIndexOf(':')+1)))throw Error('probe_reference_identity: missing or changed public reference');
  const value=freezeCopy(values[0]);cache.set(ref,value);return value;
 };
 const schema=(v:any,name:string,keys:string[])=>{strictObject(v,name,['schema',...keys]);if(v.schema!==name)throw Error('probe_schema_identity: '+name);return v;};
 const refsOf=(v:any,keys:string[])=>{for(const k of keys)read(v[k]);};
 const list=(v:any,name:string,min=0)=>{if(!Array.isArray(v)||v.length<min)throw Error('probe_array_invalid: '+name);return v;};
 const profileRef=(r:any)=>{strictObject(r,'profileRevisionRef',['profileId','revision','snapshotHash']);if(typeof r.profileId!=='string'||!r.profileId||!integer(r.revision,1)||!/^[a-f0-9]{64}$/.test(r.snapshotHash))throw Error('probe_profile_identity');};
 const release=(ref:string,mode:string)=>{const value=resolveCandidateReleaseRef(read(ref),read,RELEASES),known=value.release;if(known.mode!==mode||known.tier!=='hard'||known.localSelector!=='proposal')throw Error('probe_release_identity');return value;};
 const capability=read(task.capabilityRef);strictObject(capability,'capability',['id','kind','mode']);
 if(!equal(capability,{id:'B04.api-probe.v1',kind:'probe',mode:'research'})||task.taskKind!=='probe'||!equal(task.operationScope,scope(true))||task.datasetRefs.length!==1||task.allowedBranches.length||task.limits.maxProviderRequests>24||['maxOptimizerSteps','maxMatchAttempts','maxLabelDecisions'].some(k=>task.limits[k]!==0))throw Error('probe_scope_or_limit');
 const spec=schema(read(task.datasetRefs[0]),'ohuo-api-probe-spec-v1',['screeningPlanRef','snapshotSetRef','configurationRef','configurationOrdinal']);refsOf(spec,['screeningPlanRef','snapshotSetRef','configurationRef']);
 const plan=schema(read(spec.screeningPlanRef),'ohuo-api-screening-plan-v1',['snapshotSetRef','configurationRefs','budgetRef','rulesRef','candidateRef','promptRef','phaseReviewRef']);refsOf(plan,['snapshotSetRef','budgetRef','rulesRef','candidateRef','promptRef','phaseReviewRef']);
 if(!integer(spec.configurationOrdinal,0,1)||!Array.isArray(plan.configurationRefs)||plan.configurationRefs.length<1||plan.configurationRefs.length>2||new Set(plan.configurationRefs).size!==plan.configurationRefs.length||plan.configurationRefs[spec.configurationOrdinal]!==spec.configurationRef||spec.snapshotSetRef!==plan.snapshotSetRef||plan.budgetRef!==task.budgetRef||plan.rulesRef!==task.rulesRef||plan.promptRef!==task.promptRef||plan.candidateRef!==task.parentPolicyRef)throw Error('probe_plan_identity');
 const budget=read(task.budgetRef);strictObject(budget,'budget',['researchBatchId','authorizationRef','planRef','controlRoot','limits']);validateLimits(budget.limits);
 if(budget.researchBatchId!==task.researchBatchId||budget.authorizationRef!==task.authorizationRef||budget.planRef!==task.planRef||budget.limits.maxProviderRequests>48||['maxOptimizerSteps','maxMatchAttempts','maxLabelDecisions'].some(k=>budget.limits[k]!==0))throw Error('probe_shared_budget_identity');
 const base=release(task.parentPolicyRef,'local'),prompt=schema(read(task.promptRef),'ohuo-prompt-ref-v1',['promptRef']),rules=validateMatchRules(read(task.rulesRef));
 const configurations=plan.configurationRefs.map((r:string)=>{
  const c=schema(read(r),'ohuo-api-probe-configuration-v1',['releaseRef','profileRevisionRef','publicProfileRef']);profileRef(c.profileRevisionRef);
  const h=release(c.releaseRef,'hybrid'),pub=read(c.publicProfileRef);strictObject(pub,'publicProfile',['profileId','nickname','protocol','baseUrl','requestedModel','supportedReasoningOptions','requestOptions','revision','snapshotHash']);
  const {snapshotHash,...publicFields}=pub;
  if(resolveCandidatePolicy(h.candidatePolicy)!==resolveCandidatePolicy(base.candidatePolicy)||!equal(h.policyIdentity,base.policyIdentity)||h.release.proposalPolicyRef!==base.release.proposalPolicyRef||h.release.candidateSpecRef!==base.release.candidateSpecRef||prompt.promptRef!==h.release.promptRef||snapshotHash!==digest(publicFields)||!equal(c.profileRevisionRef,{profileId:pub.profileId,revision:pub.revision,snapshotHash:pub.snapshotHash}))throw Error('probe_configuration_identity');
  return {configurationRef:r,...c,publicProfile:pub};
 });
 const config=configurations[spec.configurationOrdinal];
 strictObject(inputs.probeProfile,'probeProfile',['configurationRef','releaseRef','reference','publicProfile']);
 if(!equal(task.releaseRefs,[config.releaseRef])||!equal(inputs.probeProfile,{configurationRef:spec.configurationRef,releaseRef:config.releaseRef,reference:config.profileRevisionRef,publicProfile:config.publicProfile}))throw Error('probe_profile_binding');
 const set=schema(read(spec.snapshotSetRef),'ohuo-api-probe-snapshots-v1',['sourceIndexRef','rulesRef','parentPolicyRef','candidateRef','promptRef','snapshots']);refsOf(set,['sourceIndexRef','rulesRef','parentPolicyRef','candidateRef','promptRef']);
 if(set.sourceIndexRef!==task.sourcePlan.sourceIndexRef||set.rulesRef!==task.rulesRef||set.parentPolicyRef!==task.parentPolicyRef||set.candidateRef!==set.parentPolicyRef||set.promptRef!==task.promptRef||!Array.isArray(set.snapshots)||set.snapshots.length!==12)throw Error('probe_snapshot_set_identity');
 const sourceRef=schema(read(set.sourceIndexRef),'ohuo-source-index-ref-v1',['namespace','fileSHA256']);
 if(inputs.sourceIdentity!==set.sourceIndexRef||typeof inputs.sourceIndexPath!=='string'||!equal(inputs.confirmedRecordRoots,[])||!equal(inputs.studentReleasePaths,{}))throw Error('probe_host_input_binding');
 const sourcePath=inputs.sourceIndexPath,st=lstatSync(sourcePath);if(!st.isFile()||st.isSymbolicLink()||realpathSync(sourcePath)!==sourcePath)throw Error('probe_source_index_path');
 const sourceBytes=readFileSync(sourcePath),source=JSON.parse(sourceBytes.toString('utf8')),split=task.sourcePlan.split==='confirm'?'sealed':task.sourcePlan.split;
 if(sourceRef.namespace!==task.sourcePlan.namespace||sourceRef.fileSHA256!==sha(sourceBytes)||source.version!==1||!source.families||task.sourcePlan.familyIds.some((id:string)=>source.families[id]?.split!==split))throw Error('probe_source_index_identity');
 const review=schema(read(plan.phaseReviewRef),'ohuo-probe-phase-review-v1',['classificationRuleRef','coverageRuleRef','rows','requiredResourceClassIds','resourceWitnesses','passWitnesses','reviewEvidenceRef']);refsOf(review,['classificationRuleRef','coverageRuleRef','reviewEvidenceRef']);
 if(!Array.isArray(review.rows)||review.rows.length!==12)throw Error('probe_phase_review_rows');
 const ids=new Set<string>(),bundleRefs=new Set<string>(),keys=new Set<string>(),phases={early:0,middle:0,late:0},snapshots:Snapshot[]=[];
 for(const [index,row] of set.snapshots.entries()){
  strictObject(row,'snapshot',['snapshotId','phase','phaseEvidenceRef','bundleRef','generationEvidenceRef','publicSourceRef']);validateIdentifier(row.snapshotId,'snapshotId');refsOf(row,['phaseEvidenceRef','bundleRef','generationEvidenceRef','publicSourceRef']);
  if(ids.has(row.snapshotId)||bundleRefs.has(row.bundleRef)||!['early','middle','late'].includes(row.phase))throw Error('probe_snapshot_identity');ids.add(row.snapshotId);bundleRefs.add(row.bundleRef);phases[row.phase as keyof typeof phases]++;
  const b=read(row.bundleRef) as DecisionBundle;validatePublicBundle(b,rules,base.release.candidateSpecRef);
  const key=digest(b.key);if(keys.has(key))throw Error('probe_duplicate_decision_key');keys.add(key);
  const generation=schema(read(row.generationEvidenceRef),'ohuo-probe-generation-evidence-v1',['snapshotId','bundleRef','sourceIndexRef','sourceRef','parentPolicyRef','candidateRef','promptRef','rulesRef','producerSourceRevision','producerEntry','invocationEvidenceRef','reviewEvidenceRef']);
  refsOf(generation,['bundleRef','sourceIndexRef','sourceRef','parentPolicyRef','candidateRef','promptRef','rulesRef','producerSourceRevision','invocationEvidenceRef','reviewEvidenceRef']);
  if(generation.snapshotId!==row.snapshotId||generation.bundleRef!==row.bundleRef||generation.sourceIndexRef!==set.sourceIndexRef||generation.parentPolicyRef!==set.parentPolicyRef||generation.candidateRef!==set.candidateRef||generation.promptRef!==set.promptRef||generation.rulesRef!==set.rulesRef)throw Error('probe_generation_binding');
  strictObject(generation.producerEntry,'producerEntry',['file','exportName']);strictObject(generation.producerEntry.file,'producerFile',['path','sha256']);
  const producer=read(generation.producerSourceRevision);strictObject(producer,'producerSourceRevision',['baseCommit','files']);
  if(typeof producer.baseCommit!=='string'||!/^[a-f0-9]{40}$/.test(producer.baseCommit)||generation.producerEntry.file.path!=='packages/ai/src/hybrid/candidates.ts'||generation.producerEntry.exportName!=='createDecisionBundle'||!/^[a-f0-9]{64}$/.test(generation.producerEntry.file.sha256))throw Error('probe_producer_identity');
  const filePaths=new Set<string>();for(const f of list(producer.files,'producer.files',1)){strictObject(f,'producerSourceFile',['path','sha256']);if(typeof f.path!=='string'||filePaths.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('probe_producer_source_manifest');filePaths.add(f.path);}
  if(producer.files.filter((f:any)=>equal(f,generation.producerEntry.file)).length!==1)throw Error('probe_producer_source_binding');
  const pub=schema(read(row.publicSourceRef),'ohuo-probe-public-source-v1',['snapshotId','bundleRef','sourceIndexRef','sourceRef','visibilityReviewRef']);refsOf(pub,['bundleRef','sourceIndexRef','sourceRef','visibilityReviewRef']);
  if(pub.snapshotId!==row.snapshotId||pub.bundleRef!==row.bundleRef||pub.sourceIndexRef!==set.sourceIndexRef||pub.sourceRef!==generation.sourceRef)throw Error('probe_public_source_binding');
  const phase=schema(read(row.phaseEvidenceRef),'ohuo-probe-phase-evidence-v1',['snapshotId','bundleRef','phase','classificationRuleRef','reviewEvidenceRef']);refsOf(phase,['bundleRef','classificationRuleRef','reviewEvidenceRef']);
  if(phase.snapshotId!==row.snapshotId||phase.bundleRef!==row.bundleRef||phase.phase!==row.phase||phase.classificationRuleRef!==review.classificationRuleRef)throw Error('probe_phase_binding');
  strictObject(review.rows[index],'phaseReviewRow',['snapshotId','bundleRef','phaseEvidenceRef']);if(!equal(review.rows[index],{snapshotId:row.snapshotId,bundleRef:row.bundleRef,phaseEvidenceRef:row.phaseEvidenceRef}))throw Error('probe_phase_review_binding');
  snapshots.push(freezeCopy({...row,bundle:b}));
 }
 if(Object.values(phases).some(n=>n!==4))throw Error('probe_phase_counts');
 const required=list(review.requiredResourceClassIds,'requiredResourceClassIds',1);required.forEach((id:string)=>validateIdentifier(id,'resourceClassId'));if(new Set(required).size!==required.length)throw Error('probe_duplicate_resource_class');
 const witness=(w:any)=>{const s=snapshots.find(s=>s.snapshotId===w.snapshotId);if(!s||s.bundleRef!==w.bundleRef)throw Error('probe_coverage_snapshot_binding');const c=s.bundle.pool.find(c=>c.actionId===w.actionId);if(!c)throw Error('probe_coverage_action_binding');return c;};
 const covered=new Set<string>();for(const w of list(review.resourceWitnesses,'resourceWitnesses',1)){
  strictObject(w,'resourceWitness',['snapshotId','bundleRef','actionId','classId','resources','wildAs']);const c=witness(w),actual=publicCombo(c.canonical);
  if(!required.includes(w.classId)||!actual||!equal(actual.resources,w.resources)||!equal(actual.wildAs,w.wildAs))throw Error('probe_resource_coverage');covered.add(w.classId);
 }
 if(required.some((id:string)=>!covered.has(id)))throw Error('probe_missing_resource_class');
 for(const w of list(review.passWitnesses,'passWitnesses',1)){strictObject(w,'passWitness',['snapshotId','bundleRef','actionId']);if(witness(w).canonical!==null)throw Error('probe_pass_coverage');}
 return {spec,plan,snapshots:freezeCopy(snapshots),reference:config.profileRevisionRef,publicProfile:config.publicProfile,sourceIndexPath:sourcePath,sourceIndexSHA256:sourceRef.fileSHA256};
}
/** Pure B02/public-shape verification. No game reconstruction or forward. The
 * original producer evidence establishes legal provenance; all candidates,
 * including unoffered expansion entries, are checked at the same wire boundary. */
function validatePublicBundle(b:DecisionBundle,rules:any,candidateSpec:string){
 const fresh=candidatePolicyForBundle(b).candidateSpec===FIRST_TARGET_CANDIDATE_SPEC;
 strictObject(b,'bundle',[...(fresh?['enumSpec','coverage']:[]),'candidateSpec','decisionId','pool','initialCandidateIds','offeredIds','fallbackActionId','expansionCount','isUniqueLegalAction','observation','key']);
 strictObject(b.key,'decisionKey',['controllerOrRunnerGeneration','matchId','gameNo','moveNo','actorSeat','requestSeq',...('ownership'in b.key?['ownership']:[]),...('snapshotRevision'in b.key?['snapshotRevision']:[])]);
 if(b.candidateSpec!==candidateSpec||b.isUniqueLegalAction!==false||b.expansionCount!==0||!Array.isArray(b.pool)||b.pool.length<2||!Array.isArray(b.initialCandidateIds)||!b.initialCandidateIds.length||b.initialCandidateIds.length>(fresh?12:8)||!equal(b.initialCandidateIds,b.offeredIds)||b.fallbackActionId!==b.pool[0].actionId||new Set(b.initialCandidateIds).size!==b.initialCandidateIds.length||b.decisionId!==b.observation?.decisionId||!equal(b.observation.ruleOptions,rules)||b.observation.rulesText!==describeRules(rules)||b.key.matchId!==b.observation.matchId||b.key.gameNo!==b.observation.gameNo||b.key.moveNo!==b.observation.moveNo||b.key.actorSeat!==b.observation.actorSeat||!integer(b.key.requestSeq))throw Error('probe_bundle_identity');
 if(!['string','number'].includes(typeof b.key.controllerOrRunnerGeneration)||'ownership'in b.key&&typeof b.key.ownership!=='string'||'snapshotRevision'in b.key&&!integer(b.key.snapshotRevision))throw Error('probe_decision_key');
 const ids=new Set<string>(),canonicalIds=new Set<string>(),indices=new Set<number>(),groups=new Map<string,string>();
 for(const [rank,c] of b.pool.entries()){
  strictObject(c,'candidate',['actionId','canonicalId','canonical','originalIndex','rank','rawQ','groupId','groupKey','remainingHand']);validateIdentifier(c.actionId,'actionId');validateIdentifier(c.groupId,'groupId');
  if(ids.has(c.actionId)||canonicalIds.has(c.canonicalId)||indices.has(c.originalIndex)||!integer(c.originalIndex,0,b.pool.length-1)||c.rank!==rank||!Number.isFinite(c.rawQ)||rank>0&&(c.rawQ>b.pool[rank-1].rawQ||c.rawQ===b.pool[rank-1].rawQ&&c.originalIndex<b.pool[rank-1].originalIndex))throw Error('probe_pool_identity');
  ids.add(c.actionId);canonicalIds.add(c.canonicalId);indices.add(c.originalIndex);
  if(c.canonical!==null){
   const combo=c.canonical;strictObject(combo,'canonical',['kind','cards','size','keyRank','length','pairRanks','mainRank','wildAs',...('suit'in combo?['suit']:[])]);
   if(!Array.isArray(combo.cards)||combo.cards.length!==combo.size||new Set(combo.cards.map((card:{id:number})=>card.id)).size!==combo.cards.length||!Array.isArray(combo.wildAs))throw Error('probe_canonical_resources');
   for(const card of combo.cards){strictObject(card,'card',['id','suit','rank']);if(!integer(card.id,0,107))throw Error('probe_card_identity');}
   for(const a of combo.wildAs)strictObject(a,'wildAssignment',['cardId','asRank',...('asSuit'in a?['asSuit']:[])]);
  }else if(b.observation.target===null)throw Error('probe_pass_without_target');
  const ctx={ranks:new Set(b.observation.effectiveLevelRanks),levels:b.observation.levelsBefore} as any;
  if(canonicalActionId(c.canonical,ctx)!==c.canonicalId)throw Error('probe_canonical_identity');
  const wild=c.canonical?.cards.filter((card:{suit:string;rank:number})=>card.suit==='H'&&b.observation.effectiveLevelRanks.includes(card.rank)).length??0;
  const groupKey=`${c.canonical?.kind??'pass'}:${c.canonical?.size??0}:${wild}`;
  if(!groups.has(groupKey))groups.set(groupKey,`g${String(groups.size+1).padStart(2,'0')}`);
  if(c.groupKey!==groupKey||c.groupId!==groups.get(groupKey))throw Error('probe_group_identity');
  const projected=publicCombo(c.canonical),remaining=b.observation.ownHand.map(f=>({...f}));
  for(const resource of projected?.resources??[]){const own=remaining.find(f=>f.suit===resource.suit&&f.rank===resource.rank);if(!own||own.count<resource.count)throw Error('probe_resource_not_owned');own.count-=resource.count;}
  if(!equal(c.remainingHand,remaining.filter(f=>f.count>0)))throw Error('probe_remaining_hand');
  freezeRequestView(decisionRequestView({...b,offeredIds:[c.actionId],expansionCount:fresh?0:1}));
 }
 if(b.initialCandidateIds.some(id=>!ids.has(id)))throw Error('probe_offered_identity');
 freezeRequestView(decisionRequestView(b));
}

export function createApiProbeConsumer({profileStore,fetchImpl}:{profileStore:any;fetchImpl?:typeof fetch}){
 if(!profileStore||typeof profileStore.resolve!=='function'||fetchImpl!==undefined&&typeof fetchImpl!=='function')throw Error('explicit named profile store required');
 const prepare=async(input:any):Promise<Prepared>=>{
  const p=verifyProbeSnapshots(input);
  const reference=structuredClone(p.reference),record=structuredClone(profileStore.resolve(reference));
  const store={resolve:(r:any)=>{if(!equal(reference,r))throw Error('profile identity differs');return structuredClone(record);}};
  const publicProfile=createProfileSelector({store,reference,fetchImpl:()=>{throw Error('prepare cannot send');}}).profile;
  if(!equal(publicProfile,p.publicProfile))throw Error('profile public revision identity differs');return {...p,reference,store,publicProfile};
 };
 const run=async(ctx:any)=>{
  const {task,signal,executionInputs:p}=ctx as {task:any;signal:AbortSignal;executionInputs:Prepared};
  const expected=binding(task,p);let cp:Checkpoint=ctx.checkpoint?structuredClone(ctx.checkpoint):{schema:'ohuo-api-probe-run-v1',binding:expected,cursor:0,active:null,rows:[],executionUnknown:false};
  let sequence=ctx.checkpointSequence,apiInvoked=false;const meters:Array<{drain:()=>Promise<void>}>=[];
  const save=async()=>{if(!validateCheckpoint(cp))throw Error('invalid probe checkpoint');await ctx.saveCheckpoint(cp,++sequence);};
  const summary=()=>{
   const value={schema:'ohuo-api-probe-summary-v1',taskId:task.taskId,runId:task.runId,binding:cp.binding,configurationHistory:p.plan.configurationRefs.map((ref:string,ordinal:number)=>({configurationRef:ref,configurationOrdinal:ordinal,selectedForThisTask:ref===p.spec.configurationRef})),profile:p.publicProfile,snapshotCount:12,cursor:cp.cursor,active:cp.active,rows:cp.rows,remainingSnapshots:p.snapshots.slice(cp.cursor).map((s,i)=>({snapshotId:s.snapshotId,phase:s.phase,bundleRef:s.bundleRef,status:cp.active&&i===0?'pending_unknown':'not_sent',mainRequests:cp.active&&i===0?null:0,expansionRequests:cp.active&&i===0?null:0})),executionUnknown:cp.executionUnknown,consumption:ctx.getConsumption(),interpretation:'API compatibility/experience screening only; selected means a legal frozen offered ID, never game execution or strength qualification'};
   const path=join(task.outputRoot,'probe-summary.json'),tmp=`${path}.tmp-${process.pid}-${sequence}`;writeFileSync(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(tmp,path);return {path,sha256:sha(readFileSync(path)),purpose:'fixed snapshot probe terminals and actual metered requests'};
  };
  try{
   if(!validateCheckpoint(cp)||!equal(cp.binding,expected))throw Error('checkpoint input identity differs');
   if(cp.executionUnknown||cp.active!==null)throw Error('execution_uncertain: cannot repeat pending or unknown probe');
   for(const [i,row] of cp.rows.entries())if(row.phase!==p.snapshots[i].phase)throw Error('checkpoint snapshot identity differs');
   while(cp.cursor<p.snapshots.length){
    if(signal.aborted||performance.now()>=ctx.deadlineMonotonicMs)break;
    if(sha(readFileSync(p.sourceIndexPath))!==p.sourceIndexSHA256)throw Error('source index identity changed');
    const s=p.snapshots[cp.cursor];cp.active={index:cp.cursor,snapshotId:s.snapshotId,bundleRef:s.bundleRef};await save();
    const local=new AbortController(),abort=()=>local.abort(signal.reason??'user_stop');signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    const timer=setTimeout(()=>local.abort('run_boundary'),Math.max(0,ctx.deadlineMonotonicMs-performance.now()));
    let reserveOrdinal=0;const attempts:any[]=[];let remote:any=null,unknown=false;const startedAt=Date.now(),started=performance.now();
    const meter=createMeteredRemote({store:p.store,reference:p.reference,keyPrefix:`p${cp.cursor}-${ctx.executionId}`,ownerSignal:signal,onSent:()=>{apiInvoked=true;},cancel:(reason:string)=>local.abort(reason),settleReservation:ctx.settleReservation,
     // B07 meter counts a first label for matches/teaching. A probe never emits
     // a label: retain the exact provider reserve/settle chain, with zero other
     // counters. Reject any future meter cost change rather than erase it.
     reserve:(key:string,cost:any)=>{strictObject(cost,'meterCost',['providerRequests','optimizerSteps','matchAttempts','labelDecisions']);const ordinal=++reserveOrdinal;if(ordinal>2||!equal(cost,{providerRequests:1,optimizerSteps:0,matchAttempts:0,labelDecisions:ordinal===1?1:0}))throw Error('unexpected B04 meter cost');return ctx.reserve(key,{providerRequests:1,optimizerSteps:0,matchAttempts:0,labelDecisions:0});},fetchImpl:(input:any,init:any)=>{apiInvoked=true;return (fetchImpl??globalThis.fetch)(input,init);}});meters.push(meter);
    try{
     remote=await selectRemoteDecision({bundle:s.bundle,signal:local.signal,request:async(view,requestSignal)=>{
      const stage=attempts.length===0?'main':'expansion',begin=Date.now();
      try{const r=await meter.request(view,requestSignal);attempts.push({stage,status:r.status,reason:'reason'in r?r.reason:null,startedAt:begin,terminalAt:Date.now(),usageStatus:Object.keys(r.summary.usage??{}).length?'reported':'unknown',summary:r.summary});return r;}
      catch(e){attempts.push({stage,status:'unknown',reason:'execution_uncertain',startedAt:begin,terminalAt:Date.now(),usageStatus:'unknown',summary:{requestCount:null}});unknown=true;throw e;}
     }});await meter.drain();unknown ||= local.signal.reason==='execution_uncertain'||attempts.some(a=>a.summary.requestCount===null);
    }catch{unknown=true;try{await meter.drain();}catch{}}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
    const mainRequests=attempts.length?(attempts[0].summary.requestCount):0,expansionRequests=attempts.length>1?attempts[1].summary.requestCount:0;
    // Only a confirmed unsent cancellation is resumable at the same snapshot.
    if(!unknown&&mainRequests===0&&expansionRequests===0&&local.signal.aborted){cp.active=null;await save();break;}
    const selected=!unknown&&remote?.status==='selected';
    cp.rows.push({snapshotId:s.snapshotId,phase:s.phase,bundleRef:s.bundleRef,status:unknown?'execution_uncertain':remote.status,reason:unknown?'execution_uncertain':selected?null:remote.reason,actionId:selected?remote.actionId:null,inInitialCandidateSet:selected?remote.inInitialCandidateSet:null,mainRequests,expansionRequests,startedAt,terminalAt:Date.now(),elapsedMs:performance.now()-started,attempts});cp.cursor++;cp.active=null;cp.executionUnknown=unknown;await save();
    if(unknown)break; // Return a registered summary; the original ledger blocks resume.
    if(local.signal.aborted||remote?.status==='halted')break;
   }
   return {completed:cp.cursor===p.snapshots.length&&!cp.executionUnknown,cleanupConfirmed:true,actualScope:scope(apiInvoked),stopReason:cp.executionUnknown?'execution_uncertain':signal.aborted?String(signal.reason??'user_stop'):'run_boundary',artifactRefs:[summary()]};
  }catch(error){
   cp.executionUnknown=true;await Promise.allSettled(meters.map(m=>m.drain()));try{await save();}catch{};let artifactRefs:any[]=[];try{artifactRefs=[summary()];}catch{}
   Object.assign(error as object,{cleanupConfirmed:true,actualScope:scope(apiInvoked),artifactRefs});throw error;
  }
 };
 return {id:'B04.api-probe.v1',kind:'probe',mode:'research',prepare,validateCheckpoint,run};
}
/** Requires the single fixed host's reviewed capability registry and authority
 * adapter; constructing this function neither authorizes nor starts research. */
export function createApiProbeTaskHost({root,adapter,...options}:{root:string;adapter:any;profileStore:any;fetchImpl?:typeof fetch}){
 return (createTaskController as any)({root,adapter,consumers:[createApiProbeConsumer(options)]});
}
