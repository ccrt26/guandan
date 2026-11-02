/** NAV-R11 mechanical source inventory + existing B07 six-layout queue producer.
 * No match/action/model/teacher/update is executed. Reserved deal families are
 * ancestry metadata, NEVER additional independent training roots. Existing
 * H/TC authorization and runtime admission remain mandatory after this step. */
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,writeFileSync,linkSync,unlinkSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import {createMatch,startGame,buildDeck,DEFAULT_RULES} from '@gd/engine';
import {deriveSeed} from '@gd/ai';
import {indexedDealSeed} from '../review6/match-play';
import {engineDealFamily} from '../review6/capability-lineage';
import {validatePolicyRegistry} from '../review6/policy-registry';
import {digest,fixedReference,referenceOf,strictObject,validateIdentifier,validateSourceFamily} from './task-schema.mjs';
import {validateMatchRules,assertFrozenRoundPlan,firstRoundS0PolicyId,freezeFirstRoundQueueLayouts} from './match-consumer';
import {validateFirstRoundParentEnvelope} from './first-round-parent';
import {validateFirstRoundRegistryPolicy} from './first-round-registry-policy';
import {resolveCandidateReleaseRef} from '../../packages/ai/src/policy/candidate-release';
import {resolveStudentCandidatePolicy} from '../../packages/ai/src/hybrid/student';
import {validateStudentScorerDescriptor} from '../../packages/ai/src/policy/resolve';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {planFirstRoundConfirmation,planCommonViewConfirmation} from './first-round-evaluation';
import {COMMON_VIEW_SOURCE_SCHEMA,readCommonViewProtocol,sourceStageWorkload} from './first-round-source-batch.mjs';
import {acquireSourceWriter} from './writer-lock';

type F={id:string;sha256:string};
type File={path:string;sha256:string};
export interface FirstRoundSourceInputs {specRef:string;repositoryRoot:string;references:ReadonlyMap<string,any>;evidenceFiles:ReadonlyMap<string,File>}
const STAGES=['pilot','formal','newTest','variancePilot','confirmation'] as const;
const sha=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const bytes=(x:any)=>JSON.stringify(x)+'\n';
const plain=(x:any)=>JSON.parse(JSON.stringify(x));
const need=(x:any,reason:string)=>{if(!x)throw Error('first_round_source_'+reason);};
const hex=(x:any)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const order=(a:string,b:string)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
function evidenceRef(f:any):asserts f is F {strictObject(f,'sourceEvidence',['id','sha256']);need(typeof f.id==='string'&&f.id.length>0&&!/(^|[/:_-])latest($|[/:@_-])/i.test(f.id)&&hex(f.sha256),'evidence_reference');}
function local(root:string,path:string){need(typeof path==='string'&&!isAbsolute(path)&&path.split(/[\\/]/).every(x=>x&&x!=='.'&&x!=='..'),'relative_path');const full=resolve(root,path);need(relative(root,full)&&!relative(root,full).startsWith('..'),'path_escape');return full;}
function regular(root:string,path:string){const full=local(root,path);need(realpathSync(full)===full,'symlink');for(let p=full;p!==root;p=dirname(p))need(!lstatSync(p).isSymbolicLink(),'symlink');const st=lstatSync(full);need(st.isFile()&&st.size<=32*1024*1024,'regular_bounded_file');return readFileSync(full);}
function readContext(t:FirstRoundSourceInputs){
 need(t&&realpathSync(t.repositoryRoot)===t.repositoryRoot&&t.references instanceof Map&&t.evidenceFiles instanceof Map,'trusted_inputs');
 const get=(ref:string)=>{fixedReference(ref,'sourceReference');const value=t.references.get(ref);need(value!==undefined&&digest(value)===ref.split(':').at(-1),'reference_identity');return structuredClone(value);};
 const evidence=(f:F)=>{evidenceRef(f);const file=t.evidenceFiles.get(f.id);need(file&&file.sha256===f.sha256,'evidence_catalog');strictObject(file,'sourceFile',['path','sha256']);const raw=regular(t.repositoryRoot,file!.path);need(sha(raw)===f.sha256,'evidence_hash');return raw;};
 return {get,evidence};
}
function validateSpec(spec:any,get:(ref:string)=>any){
 const commonView=spec?.schema===COMMON_VIEW_SOURCE_SCHEMA;
 strictObject(spec,'firstRoundSourceSpec',['schema','purpose','outputId','reservationRef','planRef','rulesRef','seed','registryRef','partnerPolicyIds','opponentPolicyId','comparisonRef','bindings','stages','confirmationPlanningRef','exclusionIndexRefs',...(commonView?['protocolRef']:[])]);
 need((commonView||spec.schema==='ohuo-first-round-source-spec-v1')&&['first-round-source-plan','engineering_fixture'].includes(spec.purpose),'schema');validateIdentifier(spec.outputId,'outputId');if(spec.reservationRef!==null)evidenceRef(spec.reservationRef);
 if(commonView)readCommonViewProtocol(spec.protocolRef,get);
 for(const r of [spec.planRef,spec.rulesRef,spec.comparisonRef])get(r);need(Number.isSafeInteger(spec.seed)&&spec.seed>=0&&spec.seed<=0xffffffff,'seed');evidenceRef(spec.registryRef);
 need(Array.isArray(spec.partnerPolicyIds)&&spec.partnerPolicyIds.length===3&&new Set(spec.partnerPolicyIds).size===3&&spec.partnerPolicyIds.every((x:any)=>typeof x==='string'&&x.length)&&typeof spec.opponentPolicyId==='string'&&spec.opponentPolicyId.length,'fixed_three_partners');
 strictObject(spec.bindings,'sourceBindings',['partnerRefs','opponentRef','s0Ref','s1Ref','s1ReleaseFileRef']);
 need(Array.isArray(spec.bindings.partnerRefs)&&spec.bindings.partnerRefs.length===3&&new Set(spec.bindings.partnerRefs).size===3,'fixed_three_partner_refs');for(const r of [...spec.bindings.partnerRefs,spec.bindings.opponentRef])get(r);
 for(const key of ['s0Ref','s1Ref'])if(spec.bindings[key]!==null)get(spec.bindings[key]);
 need((spec.bindings.s1Ref===null)===(spec.bindings.s1ReleaseFileRef===null),'s1_actual_file_required');if(spec.bindings.s1ReleaseFileRef!==null)evidenceRef(spec.bindings.s1ReleaseFileRef);
 strictObject(spec.stages,'sourceStages',[...STAGES]);const namespaces:string[]=[];
 for(const stage of STAGES){const s=spec.stages[stage];strictObject(s,'sourceStage',['namespace','dealNamespace','activeCount',...(commonView?['reservedCount','devCount']:[])]);for(const k of ['namespace','dealNamespace']){validateIdentifier(s[k],k);namespaces.push(s[k]);}const workload=sourceStageWorkload(spec,stage);need(s.activeCount===null||Number.isSafeInteger(s.activeCount)&&s.activeCount>=0&&s.activeCount<=workload.reservedCount,'stage_workload');if(!commonView&&['pilot','formal'].includes(stage))need(s.activeCount===null||s.activeCount===0||s.activeCount===workload.reservedCount,'fixed_source_count');}
 need(new Set(namespaces).size===namespaces.length,'distinct_namespace_required');
 need(Array.isArray(spec.exclusionIndexRefs)&&spec.exclusionIndexRefs.length>=1&&spec.exclusionIndexRefs.length<=1000&&new Set(spec.exclusionIndexRefs.map((f:F)=>f.id)).size===spec.exclusionIndexRefs.length,'original_exclusion_indexes_required');spec.exclusionIndexRefs.forEach(evidenceRef);
 if(spec.confirmationPlanningRef!==null){const p=get(spec.confirmationPlanningRef);strictObject(p,'sourceConfirmationPlanning',['schema','inputs','planning']);strictObject(p.inputs,'sourceConfirmationPlanningInputs',commonView?['pilotBlocks','sPlan','varianceEvidenceRef']:['pilotBlocks','sPlan','reservedSeconds','slowestBlockSeconds','remainingMatchAttempts']);need(p.schema===(commonView?'ohuo-common-view-source-confirmation-planning-r2':'ohuo-first-round-source-confirmation-planning-v1')&&equal(p.planning,commonView?planCommonViewConfirmation(p.inputs):planFirstRoundConfirmation(p.inputs)),'confirmation_planning');if(commonView)get(p.inputs.varianceEvidenceRef);need(spec.stages.confirmation.activeCount===p.planning.N,'confirmation_prefrozen_N');}
 if(spec.stages.confirmation.activeCount>0)need(spec.confirmationPlanningRef!==null,'confirmation_planning_required');
}
function validatePolicies(spec:any,t:FirstRoundSourceInputs,get:(ref:string)=>any,evidence:(f:F)=>Buffer){
 const registry=validatePolicyRegistry(JSON.parse(evidence(spec.registryRef).toString()));need(registry.schemaVersion==='r6-no-H-policy-registry-v1'&&registry.selectedExperiment==='direct_teacher_no_h','original_no_h_registry');
 need(equal(spec.partnerPolicyIds,registry.developmentPartners)||equal(spec.partnerPolicyIds,registry.confirmationPartners),'one_unchanged_partner_pool');need(spec.opponentPolicyId===registry.oldCompletePolicy,'fixed_O_opponent');
 const peers=spec.bindings.partnerRefs.map((r:string,i:number)=>{const envelope=get(r);need(equal(envelope.registryRef,spec.registryRef)&&envelope.policyId===spec.partnerPolicyIds[i],'partner_role_binding');return validateFirstRoundRegistryPolicy({envelope,readEvidence:evidence,repositoryRoot:t.repositoryRoot,role:'partner'});});
 const opponent=get(spec.bindings.opponentRef);need(equal(opponent.registryRef,spec.registryRef)&&opponent.policyId===spec.opponentPolicyId,'opponent_role_binding');validateFirstRoundRegistryPolicy({envelope:opponent,readEvidence:evidence,repositoryRoot:t.repositoryRoot,role:'opponent'});
 const comparison=get(spec.comparisonRef);strictObject(comparison,'sourceComparison',['schema','proposalRef','studentParentRef']);need(comparison.schema==='ohuo-first-round-comparison-v1','comparison');
 const proposer=resolveCandidateReleaseRef(get(comparison.proposalRef),get,RELEASES),parent=validateFirstRoundParentEnvelope({parentRef:comparison.studentParentRef,envelope:get(comparison.studentParentRef),readEvidence:evidence});
 need(proposer.candidatePolicy?.candidateSpec==='first-target-offer12-v1'&&proposer.release.mode==='local'&&proposer.release.tier==='hard'&&equal(proposer.policyIdentity,parent.basePolicyIdentity),'actual_Bprime_S0');
 if(spec.bindings.s0Ref!==null){const s=get(spec.bindings.s0Ref);strictObject(s,'sourceS0',['schema','policyId','proposalRef','studentParentRef']);need(s.schema==='ohuo-first-round-s0-release-ref-v1'&&s.proposalRef===comparison.proposalRef&&s.studentParentRef===comparison.studentParentRef&&s.policyId===firstRoundS0PolicyId(comparison.proposalRef,comparison.studentParentRef),'S0_composite');}
 if(spec.bindings.s1Ref!==null){const s=get(spec.bindings.s1Ref);strictObject(s,'sourceS1',['schema','policyId','releaseSHA256']);need(s.schema==='ohuo-student-task-release-v1'&&s.releaseSHA256===spec.bindings.s1ReleaseFileRef.sha256,'S1_reference');const release=JSON.parse(evidence(spec.bindings.s1ReleaseFileRef).toString());
  strictObject(release,'sourceS1Release',['schema','trainingKind','policyId','proposer','proposalRef','learningParent','scorer','candidateSpecRef','candidatePolicy','tieBreakId','checkpoint','dataset','recipe','selection']);
  const scorer=validateStudentScorerDescriptor(release.scorer);need(release.schema==='ohuo-student-release-first-round-v3'&&release.trainingKind==='supervised_rerank'&&release.policyId===s.policyId&&release.proposalRef===comparison.proposalRef&&release.learningParent?.ref===comparison.studentParentRef&&equal(release.learningParent.scorer,parent.scorer)&&equal(release.learningParent.migrationReceiptRef,parent.migrationReceiptRef)&&equal(release.proposer?.identity,proposer.policyIdentity)&&scorer.policyId!==parent.scorer.policyId&&release.recipe?.id===(spec.schema===COMMON_VIEW_SOURCE_SCHEMA?'first-round-common-view-learning-v2':'first-round-partner-control-fixed64-v1')&&equal(resolveStudentCandidatePolicy(release),proposer.candidatePolicy),'S1_actual_composite');
 }
 return {comparison,peers};
}
/** Exported producer used by CLI and the original H preparation layer. All
 * names/counts/refs come from a hash-fixed spec; no seed search or default. */
export function prepareFirstRoundSources(t:FirstRoundSourceInputs){
 const {get,evidence}=readContext(t),spec=get(t.specRef);validateSpec(spec,get);
 const anchor=t.evidenceFiles.get(spec.exclusionIndexRefs[0].id)!;evidence(spec.exclusionIndexRefs[0]);const unlock=acquireSourceWriter(local(t.repositoryRoot,anchor.path));
 try{
  validatePolicies(spec,t,get,evidence);let reservation:any=null;
  if(spec.reservationRef!==null){reservation=JSON.parse(evidence(spec.reservationRef).toString());need(reservation.schema==='ohuo-first-round-source-production-v1','original_reservation');const original=get(reservation.specRef);validateSpec(original,get);for(const k of ['schema',...(spec.schema===COMMON_VIEW_SOURCE_SCHEMA?['protocolRef']:[]),'purpose','planRef','rulesRef','seed','registryRef','partnerPolicyIds','opponentPolicyId','comparisonRef','exclusionIndexRefs'])need(equal(spec[k],original[k]),'reservation_identity');need(equal(spec.bindings.partnerRefs,original.bindings.partnerRefs)&&spec.bindings.opponentRef===original.bindings.opponentRef,'reservation_policy_roles');for(const stage of STAGES){need(equal(sourceStageWorkload(spec,stage),sourceStageWorkload(original,stage)),'reservation_workload');need(spec.stages[stage].namespace===original.stages[stage].namespace&&spec.stages[stage].dealNamespace===original.stages[stage].dealNamespace,'reservation_namespace');if(original.stages[stage].activeCount!==null)need(spec.stages[stage].activeCount===original.stages[stage].activeCount,'reservation_active_count');}for(const key of ['s0Ref','s1Ref','s1ReleaseFileRef'])if(original.bindings[key]!==null)need(equal(spec.bindings[key],original.bindings[key]),'reservation_policy_binding');if(original.confirmationPlanningRef!==null)need(spec.confirmationPlanningRef===original.confirmationPlanningRef,'reservation_planning');}
  const rules=validateMatchRules(get(spec.rulesRef));need(equal(rules,DEFAULT_RULES),'unchanged_original_rules');
  const comparison=get(spec.comparisonRef),excluded=new Set<string>(),exclusionSources:any[]=[];
  for(const f of spec.exclusionIndexRefs){const raw=evidence(f),index=JSON.parse(raw.toString());need(index.version===1&&index.families&&typeof index.families==='object'&&!Array.isArray(index.families),'exclusion_index_schema');const ids=Object.keys(index.families);need(ids.length>0,'original_exclusion_inventory_empty');for(const id of ids){validateSourceFamily(id,'excludedFamily');need(['train','dev','sealed','fixture','historical_diagnostic','holdout','unusable'].includes(index.families[id]?.split),'exclusion_index_split');excluded.add(id);}exclusionSources.push({ref:f,families:ids.length});}
  const owner=new Map<string,string>(),seeds=new Set<number>(),deckIds=buildDeck().map(c=>c.id).sort((a,b)=>a-b),artifacts:Array<{name:string;value:any;id:string}>=[],references:any[]=[{ref:t.specRef,value:spec}],stages:any[]=[];
  for(const stage of STAGES){const s=spec.stages[stage],workload=sourceStageWorkload(spec,stage),reservedRoots:any[]=[];
   for(let slot=0;slot<workload.reservedCount;slot++){
    const seed=deriveSeed(s.namespace,spec.seed,slot,'source-match');need(!seeds.has(seed),'source_seed_collision_no_replacement');seeds.add(seed);const deals:any[]=[];
    for(let i=0;i<80;i++){
     const dealSeed=indexedDealSeed(s.dealNamespace,seed,i),state=startGame(createMatch({...rules},dealSeed)),ids=state.hands.map(h=>h.map(c=>c.id).sort((a,b)=>a-b));need(ids.every(h=>h.length===27)&&equal(ids.flat().sort((a,b)=>a-b),deckIds),'physical_108_deal');
     const familyId=engineDealFamily(state.hands);need(!excluded.has(familyId)&&!owner.has(familyId),'family_collision_no_replacement');owner.set(familyId,stage+':'+slot);
     deals.push({gameNo:i+1,dealSeed,familyId,canonicalDealSHA256:sha(JSON.stringify(ids))});
    }
    reservedRoots.push({slot:slot+1,familyId:deals[0].familyId,seed,dealNamespace:s.dealNamespace,split:stage==='formal'?'pending':stage==='pilot'?'train':'confirm',roundFamilyIds:deals.map(d=>d.familyId),deals});
   }
   if(stage==='formal'){const ordered=[...reservedRoots].sort((a,b)=>order(sha(a.familyId),sha(b.familyId))||order(a.familyId,b.familyId));ordered.forEach((r,i)=>r.split=i<workload.devCount?'dev':'train');}
   const index={version:1,families:Object.fromEntries(reservedRoots.flatMap(r=>r.roundFamilyIds.map((f:string)=>[f,{split:r.split==='confirm'?'sealed':r.split}])))};
   const sourceIndexValue={schema:'ohuo-source-index-ref-v1',namespace:s.namespace,fileSHA256:sha(bytes(index))},sourceIndexRef=referenceOf(s.namespace+'-source-index',sourceIndexValue);references.push({ref:sourceIndexRef,value:sourceIndexValue});artifacts.push({name:stage+'-source-index.json',value:index,id:spec.outputId+'-'+stage+'-source-index'});
   const active=reservedRoots.slice(0,s.activeCount??0),paired=!['pilot','formal'].includes(stage),pending:string[]=[];
   if(s.activeCount===null)pending.push('active_count_not_frozen');if(paired&&spec.bindings.s0Ref===null)pending.push('S0_composite_not_frozen');if(paired&&spec.bindings.s1Ref===null)pending.push('S1_not_selected');
   const rows:any[]=[];
   if(!pending.length&&active.length)for(const root of active)for(let group=0;group<3;group++)for(const side of [0,1])for(const variant of paired?['S0','S1']:['B-prime']){
    const actorRef=paired?spec.bindings[variant==='S0'?'s0Ref':'s1Ref']:comparison.proposalRef,seats=Array.from({length:4},(_,seat)=>({releaseRef:seat===side?actorRef:seat===(side+2)%4?spec.bindings.partnerRefs[group]:spec.bindings.opponentRef,mode:'local',profileRevisionRef:null}));
    const row={matchId:`${stage}-r${root.slot}-g${group}-s${side}-${variant}`,layoutId:`${stage}-g${group}-s${side}-${variant}`,sourceFamilyId:root.familyId,split:root.split,seed:root.seed,dealNamespace:root.dealNamespace,roundFamilyIds:[...root.roundFamilyIds],actor:side,metric:paired?'team_complete_match_Y':'source_collection',group,side,variant,maxGames:80,maxMovesPerGame:2500,seats};validateIdentifier(row.matchId,'matchId');validateIdentifier(row.layoutId,'layoutId');assertFrozenRoundPlan(row,row.roundFamilyIds,index,root.split==='confirm'?'sealed':root.split);rows.push(row);
   }
   const queue=rows.length?{schema:'ohuo-complete-match-queue-v1',namespace:s.namespace,sourceIndexRef,rows}:null,queueRef=queue?referenceOf(s.namespace+'-queue',queue):null;if(queue){references.push({ref:queueRef,value:queue});artifacts.push({name:stage+'-queue.json',value:queue,id:spec.outputId+'-'+stage+'-queue'});}
   const taskProjections=queue?[...new Set(rows.map(r=>r.split))].map(split=>({sourcePlan:{namespace:s.namespace,sourceIndexRef,split,familyIds:[...new Set(rows.filter(r=>r.split===split).flatMap(r=>r.roundFamilyIds))]},seatLayoutPlan:queueRef,rootFamilyIds:active.filter(r=>r.split===split).map(r=>r.familyId),plannedMatchAttempts:rows.filter(r=>r.split===split).length})):[];
   const layoutPreparation=queue?freezeFirstRoundQueueLayouts({queue,queueRef,comparisonRef:spec.comparisonRef,rules,readReference:get,readEvidence:evidence,repositoryRoot:t.repositoryRoot,studentReleaseFileRef:spec.bindings.s1ReleaseFileRef}):null;
   if(layoutPreparation)need(layoutPreparation.modelLoads===0&&layoutPreparation.observedMatches===0,'metadata_only_layout_preparation');
   const queueLayoutSHA256=Object.fromEntries(rows.map(r=>[r.layoutId,digest({actor:r.actor,group:r.group,side:r.side,variant:r.variant,seats:r.seats})]));
   stages.push({stage,namespace:s.namespace,dealNamespace:s.dealNamespace,reservedRoots,activeCount:s.activeCount,status:pending.length?'pending':!active.length?'not_requested':'queue_prepared_not_executed',pending,sourceIndexRef,sourceIndexValue,queueRef,queue,taskProjections,queueLayoutSHA256,layoutIdentitySHA256:layoutPreparation?.layoutIdentitySHA256??null,layoutIdentityStatus:layoutPreparation?'frozen_original_prepared_seat_snapshot':'pending_unbound_queue'});
  }
  if(reservation)for(let i=0;i<STAGES.length;i++)need(equal(stages[i].reservedRoots,reservation.stages[i]?.reservedRoots)&&stages[i].sourceIndexRef===reservation.stages[i]?.sourceIndexRef,'reservation_ancestry_changed');
  // Recheck every original exclusion file immediately before publication.
  for(const f of spec.exclusionIndexRefs)evidence(f);evidence(spec.registryRef);
  const outputRoot=join(t.repositoryRoot,'lab/out',spec.outputId),outputRelative=relative(t.repositoryRoot,outputRoot);need(realpathSync(dirname(outputRoot))===dirname(outputRoot),'output_parent_required');
  const files=artifacts.map(a=>({id:a.id,file:{path:outputRelative+'/'+a.name,sha256:sha(bytes(a.value))}}));
  const manifest={schema:'ohuo-first-round-source-production-v1',...(spec.schema===COMMON_VIEW_SOURCE_SCHEMA?{protocolRef:spec.protocolRef,workloadMeaning:'frozen_this_batch_inputs_not_lifetime_quota'}:{}),specRef:t.specRef,reservationRef:spec.reservationRef,purpose:spec.purpose,planRef:spec.planRef,rulesRef:spec.rulesRef,seed:spec.seed,comparisonRef:spec.comparisonRef,registryRef:spec.registryRef,partnerPolicyIds:spec.partnerPolicyIds,opponentPolicyId:spec.opponentPolicyId,bindings:spec.bindings,confirmationPlanningRef:spec.confirmationPlanningRef,exclusionSources,exclusionFamilyCount:excluded.size,independentUnit:'reserved_initial_match_root_block',futureAncestryUnit:'actual_indexed_deal_not_independent_training_root',seedRule:'deriveSeed(stage.namespace,seed,slot0,source-match); indexedDealSeed(dealNamespace,sourceSeed,gameIndex0)',canonicalDealSHA256Meaning:'original_runCompleteMatch_pre_exchange_physical_sorted_hand_ids_JSON_SHA256_not_private_state_SHA',stages,references,files,qualification:{eligible:false,reasons:['mechanical_source_plan_not_dataset_or_completed_research']},actualMatches:0,modelForwardCalls:0,providerRequests:0,optimizerSteps:0,privateHandsEmitted:false,taskReady:false};
  const manifestBytes=bytes(manifest),manifestPath=join(outputRoot,'manifest.json');
  if(existsSync(outputRoot)){need(lstatSync(outputRoot).isDirectory()&&!lstatSync(outputRoot).isSymbolicLink()&&realpathSync(outputRoot)===outputRoot&&existsSync(manifestPath),'existing_output_conflict');need(regular(t.repositoryRoot,outputRelative+'/manifest.json').equals(Buffer.from(manifestBytes)),'existing_output_conflict');for(const f of files)need(sha(regular(t.repositoryRoot,f.file.path))===f.file.sha256,'existing_output_conflict');return {status:'unchanged',outputRoot,manifest,files,manifestSHA256:sha(manifestBytes),manifestRef:{id:spec.outputId+'-source-production',sha256:sha(manifestBytes)},manifestFile:{path:outputRelative+'/manifest.json',sha256:sha(manifestBytes)}};}
  mkdirSync(outputRoot,{mode:0o700});for(const a of artifacts)writeFileSync(join(outputRoot,a.name),bytes(a.value),{flag:'wx',mode:0o600});
  // Exclusive link publishes the complete manifest last and cannot clobber an
  // existing result. Partial failures preserve their new output for inspection.
  const temp=join(outputRoot,'manifest.pending');writeFileSync(temp,manifestBytes,{flag:'wx',mode:0o600});linkSync(temp,manifestPath);unlinkSync(temp);
  return {status:'written',outputRoot,manifest,files,manifestSHA256:sha(manifestBytes),manifestRef:{id:spec.outputId+'-source-production',sha256:sha(manifestBytes)},manifestFile:{path:outputRelative+'/manifest.json',sha256:sha(manifestBytes)}};
 }finally{unlock();}
}
/** Bind only previously unresolved later-stage roles/counts in a NEW directory.
 * The original reservation and its frozen spec are read, never hand-copied or
 * edited. Its namespace, seed, order, all 80 ancestries, and earlier queues stay
 * unchanged. An actual S1 file is required; no candidate is invented here. */
export function bindFirstRoundSources(t:Omit<FirstRoundSourceInputs,'specRef'>&{bindingRef:string}){
 const context=readContext({...t,specRef:t.bindingRef}),request=context.get(t.bindingRef);
 strictObject(request,'sourceBinding',['schema','reservationRef','outputId','s0Ref','s1Ref','s1ReleaseFileRef','activeCounts','confirmationPlanningRef']);need(request.schema==='ohuo-first-round-source-binding-v1','binding_schema');evidenceRef(request.reservationRef);validateIdentifier(request.outputId,'outputId');
 strictObject(request.activeCounts,'sourceBindingCounts',['newTest','variancePilot','confirmation']);
 const prior=JSON.parse(context.evidence(request.reservationRef).toString());need(prior.schema==='ohuo-first-round-source-production-v1'&&Array.isArray(prior.files),'original_reservation');
 for(const entry of prior.files){strictObject(entry,'reservationFile',['id','file']);strictObject(entry.file,'reservationFileIdentity',['path','sha256']);need(sha(regular(t.repositoryRoot,entry.file.path))===entry.file.sha256,'reservation_file_hash');}
 const original=context.get(prior.specRef);validateSpec(original,context.get);need(original.outputId!==request.outputId,'binding_requires_new_output');
 const spec=structuredClone(original);spec.outputId=request.outputId;spec.reservationRef=request.reservationRef;spec.bindings.s0Ref=request.s0Ref;spec.bindings.s1Ref=request.s1Ref;spec.bindings.s1ReleaseFileRef=request.s1ReleaseFileRef;spec.confirmationPlanningRef=request.confirmationPlanningRef;
 for(const stage of ['newTest','variancePilot','confirmation'])spec.stages[stage].activeCount=request.activeCounts[stage];
 const specRef=referenceOf(request.outputId+'-source-spec',spec),references=new Map(t.references);references.set(specRef,spec);return prepareFirstRoundSources({...t,specRef,references});
}

/** Native CLI consumes a frozen metadata catalog, never hand-edited queue JSON.
 * node --import tsx lab/review6_2/first-round-source.ts --input FILE --sha256 HEX --repository-root ROOT */
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const args=process.argv.slice(2);need(args.length===6&&args[0]==='--input'&&args[2]==='--sha256'&&args[4]==='--repository-root','CLI_exact_arguments');const root=realpathSync(args[5]),input=resolve(args[1]);need(realpathSync(input)===input&&lstatSync(input).isFile()&&lstatSync(input).size<=32*1024*1024,'CLI_regular_input');const raw=readFileSync(input);need(hex(args[3])&&sha(raw)===args[3],'CLI_input_hash');const b=JSON.parse(raw.toString());strictObject(b,'sourceInput',['schema','specRef','references','evidenceFiles']);need(b.schema==='ohuo-first-round-source-input-v1'&&Array.isArray(b.references)&&b.references.length<=10000&&Array.isArray(b.evidenceFiles)&&b.evidenceFiles.length<=10000,'CLI_input_schema');
 const references=new Map(),evidenceFiles=new Map();for(const r of b.references){strictObject(r,'reference',['ref','value']);fixedReference(r.ref,'reference');need(!references.has(r.ref)&&digest(r.value)===r.ref.split(':').at(-1),'CLI_reference_identity');references.set(r.ref,r.value);}for(const f of b.evidenceFiles){strictObject(f,'evidenceFile',['id','file']);need(!evidenceFiles.has(f.id),'CLI_evidence_identity');evidenceFiles.set(f.id,f.file);}
 const target=references.get(b.specRef),r=target?.schema==='ohuo-first-round-source-binding-v1'?bindFirstRoundSources({bindingRef:b.specRef,repositoryRoot:root,references,evidenceFiles}):prepareFirstRoundSources({specRef:b.specRef,repositoryRoot:root,references,evidenceFiles});console.log(JSON.stringify({status:r.status,outputRoot:r.outputRoot,manifestSHA256:r.manifestSHA256,qualification:r.manifest.qualification,actualMatches:0,modelForwardCalls:0}));
}
