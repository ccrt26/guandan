/** Fixed R16 read-only host join. Original queues/records/Task ledger are read;
 * nothing here starts a source match, teacher, new ledger or training. The
 * facade is constructed only by FixedHostFiles code, never by Task JSON. */
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {digest,fixedReference,strictObject} from './task-schema.mjs';
import {loadMatchStore} from './match-record';
import {readOfflineSnapshot} from './offline-label-source';
import {classifyFirstRoundTarget,FIRST_ROUND_TARGET_DEFINITION} from './first-round-target';
import {prepareFirstRoundComparison,firstRoundS0PolicyId} from './match-consumer';
import {resolveFirstRoundParent} from './first-round-parent';
import {resolveNodePolicy} from './policy-loader';
import {loadStudentRelease} from './distill-policy';
import {validatePolicyRegistry} from '../review6/policy-registry';
import {verifyFirstRoundRecordedPeer} from './first-round-registry-policy';
import {firstRoundContinuation,validateCommonViewWorldBatch} from './first-round-screen-runtime';
import {selectFirstRoundNewQuestions} from './first-round-evaluation.ts';
import {validateFirstRoundNewTestTask,freezeFirstRoundNewTestRoot} from './first-round-evaluation-consumer.ts';
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const hex=(s:any)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const need=(ok:unknown,why:string)=>{if(!ok)throw Error('first_round_new_test_'+why);};
const text=(s:any)=>typeof s==='string'&&s.length>0;
const unique=(xs:any)=>Array.isArray(xs)&&xs.every(text)&&new Set(xs).size===xs.length;
const json=(bytes:Uint8Array)=>JSON.parse(Buffer.from(bytes).toString());
export interface FirstRoundEvaluationHostFacade {
 repositoryRoot:string;root:string;
 resolveRef:(ref:string)=>any;evidenceBytes:(ref:{id:string;sha256:string})=>Uint8Array;
 checkExistingRoot:()=>any;
 /** Bound H.checkAuthorization + original readApprovedAction/prerequisites +
  * assertActionTaskLineage; not a boolean passed by a Task. */
 verifySourceTask:(task:any)=>Promise<void>;
 /** Entire original approved same-plan source Task catalog, not TC top refs. */
 sourceTasksForPlan:(planRef:string)=>Array<{ref:string;task:any}>;
 /** Original H.studentSelectionCompletion/selection recomputation, not a
  * caller's ready/accepted boolean or a new model forward. */
 verifySelectedStudent:(task:any,studentRef:string)=>Promise<void>;
}
function fixedHost(host:any){need(host&&text(host.repositoryRoot)&&text(host.root)&&['resolveRef','evidenceBytes','checkExistingRoot','verifySourceTask','verifySelectedStudent','sourceTasksForPlan'].every(k=>typeof host[k]==='function'),'fixed_host_required');}
function ref(host:FirstRoundEvaluationHostFacade,id:string){fixedReference(id,'newTestReference');const value=host.resolveRef(id);need(digest(value)===id.split(':').at(-1),'fixed_reference_bytes');return value;}
function evidence(host:FirstRoundEvaluationHostFacade,f:any){strictObject(f,'newTestEvidence',['id','sha256']);need(text(f.id)&&hex(f.sha256),'evidence_reference');const b=host.evidenceBytes(f);need(sha(b)===f.sha256,'evidence_bytes');return json(b);}
function regular(path:string,root:string){const p=resolve(path),base=realpathSync(root),rel=relative(base,p);need(rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel)&&realpathSync(p)===p&&lstatSync(p).isFile()&&!lstatSync(p).isSymbolicLink(),'original_file_path');return readFileSync(p);}
/** Root block and actual per-game ancestry are deliberately separate. */
export function firstRoundSourceLineageFacts(record:any,q:any){
 need(record?.sourceFamilyId===q?.sourceFamilyId&&Array.isArray(record.games)&&Array.isArray(q.roundFamilyIds),'actual_round_source_identity');
 const facts=record.games.map((g:any,i:number)=>{need(g.gameNo===i+1&&g.sourceFamilyId===q.roundFamilyIds[i]&&hex(g.sourceSHA256),'actual_round_source_identity');return{familyId:g.sourceFamilyId,sourceSHA256:g.sourceSHA256};});
 return{blockFamilyId:q.sourceFamilyId,facts};
}
function settledRun(run:any,state:any,host:FirstRoundEvaluationHostFacade){
 need(run&&run.taskSHA256===digest(run.task)&&run.taskRef?.split(':').at(-1)===run.taskSHA256&&['completed','failed','interrupted'].includes(run.status)&&run.cleanupConfirmed===true&&run.executionUnknown!==true&&run.observationStatus!=='unknown'&&run.stopReason!=='execution_uncertain'&&run.failureReason!=='execution_uncertain','source_run_not_settled');
 const ledger=state.budgets?.[run.task.budgetRef];need(ledger&&ledger.activeRunId!==run.runId&&!Object.values(ledger.reservations??{}).some((r:any)=>r.runId===run.runId&&['reserved','reserved_unknown'].includes(r.status)),'source_reservations_unsettled');
 const output=resolve(run.task.outputRoot),rel=relative(realpathSync(host.repositoryRoot),output);need(rel.startsWith('lab/out/')&&!rel.startsWith('..')&&!isAbsolute(rel)&&realpathSync(output)===output,'original_source_output_root');
 const cp=run.checkpoint;
 if(cp){need(cp.taskSHA256===run.taskSHA256&&cp.active===null&&cp.executionUnknown===false&&run.checkpointSHA256===digest(cp)&&run.checkpointRef===join(run.task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)&&equal(json(regular(run.checkpointRef,host.repositoryRoot)),cp),'source_checkpoint_identity');}
 if(cp?.schema==='ohuo-match-run-v1'){
  need(Array.isArray(cp.matches)&&cp.cursor===cp.matches.length,'source_checkpoint_matches');
  const starts=Object.values(ledger.reservations??{}).filter((r:any)=>r.runId===run.runId&&['consumed','committed'].includes(r.status)).reduce((n:number,r:any)=>n+(r.cost?.matchAttempts??0),0);need(starts>=cp.matches.length,'source_start_accounting');
 }
 return cp;
}

export function firstRoundNewTestSelectionReadiness(selection:any){
 need(selection?.plan?.purpose==='first-round-independent-new-test'&&selection.verification==='reproduced'&&selection.trainingEligible===false&&Array.isArray(selection.qualification?.reasons),'original_source_union_incomplete');
 if(selection.qualification.eligible===true&&selection.qualification.reasons.length===0)return 'cross_source_diagnostic';
 need(selection.plan.familyIds.length===1&&equal(selection.qualification.reasons,['single_source_diagnostic_only']),'original_source_union_incomplete');return 'single_source_diagnostic';
}

/** Reproduces the exact original independent union for GLM, DS and branches.
 * No branch Task shape is required here and no model bytes are loaded. */
export async function reproduceFirstRoundNewTestSources({host,task,binding,refs,inputs,sourceSpecRef}:any){
 fixedHost(host);const h=host as FirstRoundEvaluationHostFacade,spec=ref(h,sourceSpecRef),scope=task?{planRef:task.planRef,budgetRef:task.budgetRef,comparisonRef:task.scientificContract.comparisonRef,sourceIndexRef:task.sourcePlan.sourceIndexRef,namespace:task.sourcePlan.namespace}:binding;strictObject(scope,'newTestNonrunnerBinding',['planRef','budgetRef','comparisonRef','sourceIndexRef','namespace']);
 const commonView=spec.schema==='ohuo-common-view-new-test-source-r2';
 strictObject(spec,'newTestSourceSpec',['schema','planRef','budgetRef','queueRef','sourceIndexRef','comparisonRef','s0Ref','s1Ref','selectionPlanRef','sourceTaskRefs','sourceRunRefs',...(commonView?['protocolRef']:[])]);
 need((commonView||spec.schema==='ohuo-first-round-new-test-source-v1')&&spec.planRef===scope.planRef&&spec.budgetRef===scope.budgetRef&&spec.comparisonRef===scope.comparisonRef&&spec.sourceIndexRef===scope.sourceIndexRef&&unique(spec.sourceTaskRefs)&&spec.sourceTaskRefs.length>0&&Array.isArray(spec.sourceRunRefs),'source_spec_binding');
 if(commonView){const protocol=ref(h,spec.protocolRef);need(protocol.schema==='ohuo-first-round-protocol-revision-v2'&&protocol.protocolId==='first-round-common-view-r2'&&(!task||task.scientificContract.analysisMethodRef===spec.protocolRef),'source_protocol_binding');}
 const plan=ref(h,spec.selectionPlanRef),queue=ref(h,spec.queueRef),indexRef=ref(h,spec.sourceIndexRef),state=h.checkExistingRoot();
 need((!commonView||plan.schema==='ohuo-common-view-new-test-selection-r2'&&plan.protocolRef===spec.protocolRef)&&plan.purpose==='first-round-independent-new-test'&&plan.sourceIndexRef===spec.sourceIndexRef&&plan.comparisonRef===spec.comparisonRef&&plan.s0Ref===spec.s0Ref&&plan.s1Ref===spec.s1Ref&&queue.schema==='ohuo-complete-match-queue-v1'&&queue.sourceIndexRef===spec.sourceIndexRef&&queue.namespace===scope.namespace&&Array.isArray(queue.rows)&&queue.rows.length===plan.familyIds.length*12,'source_plan_queue');
 const indexBytes=regular(inputs.sourceIndexPath,h.repositoryRoot),sourceIndex=json(indexBytes);need(indexRef.schema==='ohuo-source-index-ref-v1'&&indexRef.namespace===queue.namespace&&indexRef.fileSHA256===sha(indexBytes)&&sourceIndex.version===1,'source_index_actual_bytes');
 const comparison=prepareFirstRoundComparison(ref(h,spec.comparisonRef),refs,{...inputs,readFirstRoundReference:(r:string)=>ref(h,r),readFirstRoundEvidence:(f:any)=>h.evidenceBytes(f)},ref(h,spec.sourceTaskRefs[0]));
 const s0=ref(h,spec.s0Ref),s1=ref(h,spec.s1Ref);need(s0.schema==='ohuo-first-round-s0-release-ref-v1'&&s0.proposalRef===comparison.proposalRef&&s0.studentParentRef===comparison.studentParentRef&&s0.policyId===firstRoundS0PolicyId(comparison.proposalRef,comparison.studentParentRef)&&s1.schema==='ohuo-student-task-release-v1'&&hex(s1.releaseSHA256),'source_composite_identities');
 await h.verifySelectedStudent(task??binding,spec.s1Ref);
 const sourceTasks=spec.sourceTaskRefs.map((r:string)=>({ref:r,task:ref(h,r)}));
 for(const x of sourceTasks){need(x.task.taskKind==='evaluate'&&x.task.planRef===spec.planRef&&x.task.budgetRef===spec.budgetRef&&x.task.seatLayoutPlan===spec.queueRef&&x.task.sourcePlan.sourceIndexRef===spec.sourceIndexRef&&x.task.sourcePlan.split==='confirm'&&x.task.scientificContract.comparisonRef===spec.comparisonRef&&ref(h,x.task.capabilityRef).id==='B07.complete-match.v1','original_source_task');await h.verifySourceTask(x.task);}
 const expectedRuns=Object.values(state.runs??{}).filter((r:any)=>spec.sourceTaskRefs.includes(r.taskRef)) as any[],declaredRuns=new Map();
 for(const f of spec.sourceRunRefs){const run=evidence(h,f),actual=state.runs?.[run.runId];need(actual&&!declaredRuns.has(run.runId)&&['task','taskRef','taskSHA256','checkpoint','checkpointSHA256','checkpointRef','status','cleanupConfirmed'].every(k=>equal(run[k],actual[k])),'source_run_original_snapshot');declaredRuns.set(run.runId,actual);}
 need(expectedRuns.length===declaredRuns.size&&expectedRuns.every(r=>declaredRuns.has(r.runId))&&sourceTasks.every((x:any)=>expectedRuns.some(r=>r.taskRef===x.ref)),'source_run_inventory_incomplete');
 for(const run of expectedRuns)settledRun(run,state,h);
 const excludedFamilies=new Set<string>(),excludedSources=new Set<string>(),screenWorlds:any[]=[];
 // Original same-plan reserved families cannot be relabelled "new" merely
 // because a previous task did not finish. Actual game SHA facts are also kept.
 const catalog=h.sourceTasksForPlan(spec.planRef);need(Array.isArray(catalog)&&new Set(catalog.map(x=>x.ref)).size===catalog.length&&spec.sourceTaskRefs.every((r:string)=>catalog.some(x=>x.ref===r)),'original_source_task_catalog');
 for(const x of catalog){const value=ref(h,x.ref);need(equal(value,x.task)&&value.schemaVersion===1&&value.planRef===spec.planRef&&['collect','evaluate'].includes(value.taskKind)&&ref(h,value.capabilityRef).id==='B07.complete-match.v1','original_source_task_catalog');if(!spec.sourceTaskRefs.includes(x.ref))for(const f of value.sourcePlan.familyIds)excludedFamilies.add(f);}
 for(const run of Object.values(state.runs??{}) as any[]){
  if(run.task?.planRef!==spec.planRef||spec.sourceTaskRefs.includes(run.taskRef)||!run.checkpoint)continue;
  if(!['ohuo-match-run-v1','ohuo-first-round-screen-run-v1'].includes(run.checkpoint.schema))continue;
  const cp=settledRun(run,state,h);
  if(cp.schema==='ohuo-first-round-screen-run-v1'){for(const p of cp.plans??[])for(const w of p.plan?.worlds??[])screenWorlds.push(structuredClone(w));continue;}
  const oldQueue=ref(h,run.task.seatLayoutPlan);
  for(const m of cp.matches){const q=oldQueue.rows.find((r:any)=>r.matchId===m.matchId);need(q,'prior_source_queue');const rec=loadMatchStore(m.recordRef,run.task.outputRoot).recorder.snapshot().record;for(const f of firstRoundSourceLineageFacts(rec,q).facts){excludedFamilies.add(f.familyId);excludedSources.add(f.sourceSHA256);}}
 }
 need([...excludedFamilies].every(f=>plan.excludedFamilyIds.includes(f))&&[...excludedSources].every(f=>plan.excludedSourceSHA256.includes(f)),'prior_exposure_inventory_not_covered');
 const inventory:any[]=[],sourceRows:any[]=[],cache=new Map(),queueIds=new Set(),roundOwners=new Map();
 for(const q of queue.rows){
  need(text(q.matchId)&&!queueIds.has(q.matchId)&&plan.familyIds.includes(q.sourceFamilyId)&&q.split==='confirm'&&q.actor===q.side&&[0,1].includes(q.side)&&[0,1,2].includes(q.group)&&['S0','S1'].includes(q.variant)&&q.maxGames===80&&q.maxMovesPerGame===2500&&Array.isArray(q.roundFamilyIds)&&q.roundFamilyIds.length===80&&q.roundFamilyIds[0]===q.sourceFamilyId&&q.seats?.length===4&&q.seats.every((s:any)=>s.mode==='local'&&s.profileRevisionRef===null)&&q.seats[q.actor].releaseRef===(q.variant==='S0'?spec.s0Ref:spec.s1Ref),'source_queue_fixed_layout');queueIds.add(q.matchId);
  for(const family of q.roundFamilyIds){need(sourceIndex.families?.[family]?.split==='sealed'&&!plan.excludedFamilyIds.includes(family)&&(!roundOwners.has(family)||roundOwners.get(family)===q.sourceFamilyId),'source_round_independence');roundOwners.set(family,q.sourceFamilyId);}
  const owners=sourceTasks.filter((x:any)=>x.task.sourcePlan.familyIds.includes(q.sourceFamilyId));need(owners.length===1&&q.roundFamilyIds.every((f:string)=>owners[0].task.sourcePlan.familyIds.includes(f)),'source_task_block_projection');
  const matches=expectedRuns.flatMap(run=>(run.checkpoint?.matches??[]).filter((m:any)=>m.matchId===q.matchId).map((m:any)=>({run,m})));need(matches.length<=1,'source_multiple_attempts_not_selectable');
  const base={familyId:q.sourceFamilyId,reachedBy:q.variant,group:q.group,side:q.side};
  if(!matches.length){inventory.push({...base,status:'missing',sourceSHA256:null,sourceFacts:[],rows:[]});continue;}
  const {run,m}=matches[0];need(run.taskRef===owners[0].ref&&run.checkpoint.queueRef===spec.queueRef&&run.task.outputRoot===owners[0].task.outputRoot&&realpathSync(run.task.outputRoot)===run.task.outputRoot,'source_record_root_binding');
  const record=loadMatchStore(m.recordRef,run.task.outputRoot).recorder.snapshot().record,lineage=firstRoundSourceLineageFacts(record,q),seat:any=record.seatSnapshots?.[q.actor];
  need(record.matchId===q.matchId&&record.runId===run.runId&&record.sourceRef===spec.sourceIndexRef&&record.layoutRef===spec.queueRef&&record.split==='confirm'&&record.evaluatedActor===q.actor&&seat?.releaseRef===q.seats[q.actor].releaseRef&&record.policyIds[q.actor]===(q.variant==='S0'?s0.policyId:s1.policyId)&&equal(seat.firstRoundCapture,{studentParentRef:comparison.studentParentRef,scorer:comparison.envelope.scorer,migrationReceiptRef:comparison.envelope.migrationReceiptRef})&&equal(seat.policyIdentity,comparison.proposer.policyIdentity)&&(q.variant==='S0'?equal(seat.s0Release,s0):seat.studentReleaseSHA256===s1.releaseSHA256&&seat.studentRelease?.policyId===s1.policyId&&seat.studentRelease?.schema==='ohuo-student-release-first-round-v3'),'original_actual_composite_record');
  need(m.result&&['layoutId','sourceFamilyId','actor','metric','group','side','variant'].every(k=>m.result[k]===q[k])&&record.summary?.complete===m.result.complete&&record.summary?.winner===m.result.winner,'original_result_record_binding');
  const rows:any[]=[];
  for(const d of record.decisions){
   if(d.key.actorSeat!==q.actor||d.executionKind!=='confirmed')continue;need(d.policyId===record.policyIds[q.actor]&&d.actualSource==='S','actual_composite_decision_source');
   const family=q.roundFamilyIds[d.key.gameNo-1];need(family,'actual_round_source_identity');
   const row={blockFamilyId:q.sourceFamilyId,recordRef:m.recordRef,recordRoot:run.task.outputRoot,key:d.key,inputSHA256:d.trainingInputSHA256,familyId:family,split:'confirm' as const,actorSeat:q.actor};
   const snapshot=readOfflineSnapshot(row,cache,{purpose:'first-round-new-test'}),p=snapshot.input,captured=p.studentInputs;
   need(p.schema==='ohuo-decision-input-first-round-v3'&&captured?.studentParentRef===comparison.studentParentRef&&equal(captured.scorer,comparison.envelope.scorer)&&equal(p.candidateInputs?.policyIdentity,comparison.proposer.policyIdentity),'original_actual423_capture');
   const target=classifyFirstRoundTarget({state:snapshot.state,actorSeat:q.actor,candidateCombos:snapshot.bundle.initialCandidateIds.map(id=>snapshot.bundle.pool.find(c=>c.actionId===id)!.canonical),originalWitnessCombos:snapshot.bundle.pool.filter(c=>!snapshot.bundle.initialCandidateIds.includes(c.actionId)&&c.canonical!==null).map(c=>c.canonical!)},FIRST_ROUND_TARGET_DEFINITION);
   const {decisionId:_,matchId:__,...causal}=p.observation,canonicalIds=snapshot.bundle.initialCandidateIds.map(id=>snapshot.bundle.pool.find(c=>c.actionId===id)!.canonicalId),contextSHA256=digest([q.sourceFamilyId,causal,canonicalIds]);
   const reason=target.sampleClass!=='target'?target.reason:target.coverage!=='covered'?'candidate_coverage_'+target.coverage:snapshot.bundle.isUniqueLegalAction?'unique_legal_action':null;
   rows.push({questionId:snapshot.bundle.decisionId,familyId:q.sourceFamilyId,contextSHA256,inputSHA256:row.inputSHA256,candidateSpec:p.candidateSpec,candidatePolicy:captured!.candidatePolicy,candidateIds:[...snapshot.bundle.initialCandidateIds],canonicalIds,features423:captured!.candidateFeatures,proposalFeatures399:p.candidateInputs!.candidateFeatures,eligibility:reason?'excluded':'eligible',exclusionReason:reason});
   const origin={decisionId:snapshot.bundle.decisionId,row,blockFamilyId:q.sourceFamilyId,contextSHA256};sourceRows.push(origin);
  }
  inventory.push({...base,status:run.status==='completed'&&m.result?.complete===true&&record.summary?.complete===true?'completed':'incomplete',sourceSHA256:lineage.facts[0]?.sourceSHA256??null,sourceFacts:lineage.facts,rows});
 }
 const selection=selectFirstRoundNewQuestions(plan,inventory);firstRoundNewTestSelectionReadiness(selection);
 const questionSources=selection.questions.map((q:any)=>{const o=q.origins[0],matches=sourceRows.filter(r=>r.blockFamilyId===q.familyId&&r.decisionId===o.questionId&&r.row.inputSHA256===o.inputSHA256&&r.contextSHA256===q.contextSHA256);need(matches.length===1,'selected_original_question_source');return{questionId:q.questionId,...matches[0]};});
 return{selection,questionSources,sourceSpec:spec,queue,sourceIndex,comparison,namespace:queue.namespace,sourceRows,screenWorlds};
}

export function assertFirstRoundNewTestExposure({state,planRef,sourceSpec,sourceSpecRef,selectionRef,resolveRef}:any){
 for(const run of Object.values(state.runs??{}) as any[]){
  if(run.task?.planRef!==planRef||!run.task.scientificContract?.decisionRuleRef)continue;
  const rule=resolveRef(run.task.scientificContract.decisionRuleRef);if(!rule.sourceSpecRef)continue;
  const prior=resolveRef(rule.sourceSpecRef);if(!['ohuo-first-round-new-test-source-v1','ohuo-common-view-new-test-source-r2'].includes(prior.schema))continue;
  // Canonical queue identity survives aliases of the reference ID. A different
  // sourceSpec/selectionPlan cannot launder the same exposed question batch.
  const sameQueue=prior.queueRef?.split(':').at(-1)===sourceSpec.queueRef?.split(':').at(-1),sameIndex=prior.sourceIndexRef?.split(':').at(-1)===sourceSpec.sourceIndexRef?.split(':').at(-1);
  if(!sameQueue&&!sameIndex)continue;
  const ledger=state.budgets?.[run.task.budgetRef],exposed=run.checkpoint?.active||run.checkpoint?.executionUnknown||(run.checkpoint?.rows??[]).some((r:any)=>r.requestCount===null||r.requestCount>0)||(run.checkpoint?.attempts??[]).length||Object.values(ledger?.reservations??{}).some((r:any)=>r.runId===run.runId&&(r.cost?.providerRequests>0||r.cost?.matchAttempts>0)&&r.status!=='released');
  if(exposed)need(rule.sourceSpecRef===sourceSpecRef&&rule.selectionRef===selectionRef&&equal(run.task.datasetRefs,[selectionRef]),'selection_changed_after_exposure');
 }
}
export async function verifyFirstRoundNewTestSources(args:any){
 const proof=await reproduceFirstRoundNewTestSources(args);need(equal(proof.selection,ref(args.host,args.selectionRef)),'original_frozen_union_not_reproduced');
 assertFirstRoundNewTestExposure({state:args.host.checkExistingRoot(),planRef:args.task?.planRef??args.binding.planRef,sourceSpec:proof.sourceSpec,sourceSpecRef:args.sourceSpecRef,selectionRef:args.selectionRef,resolveRef:(r:string)=>ref(args.host,r)});return proof;
}

/** H invokes only after its original admission/selected-S1 completion check.
 * prepareRoot is this fixed lazy closure; it is not serializable Task input. */
export async function prepareFirstRoundNewTestHost({host,task,refs,inputs}:any){
 fixedHost(host);const h=host as FirstRoundEvaluationHostFacade,c=ref(h,task.scientificContract.decisionRuleRef);validateFirstRoundNewTestTask(task,c,'research');
 const commonView=c.schema==='ohuo-common-view-new-test-contract-r2',proof=await verifyFirstRoundNewTestSources({host:h,task,refs,inputs,sourceSpecRef:c.sourceSpecRef,selectionRef:c.selectionRef});
 need(c.s0Ref===proof.sourceSpec.s0Ref&&c.s1Ref===proof.sourceSpec.s1Ref&&equal(c.familyIds,proof.selection.plan.familyIds)&&equal(c.questionIds,proof.questionSources.map(q=>q.questionId)),'branch_selection_binding');
 const worldPlan=ref(h,c.worldPlanRef);strictObject(worldPlan,'newTestWorldPlan',['schema','selectionRef','registryRef','roots',...(commonView?['protocolRef']:[])]);need((commonView?worldPlan.schema==='ohuo-common-view-new-test-world-plan-r2'&&worldPlan.protocolRef===c.protocolRef:worldPlan.schema==='ohuo-first-round-new-test-world-plan-v1')&&worldPlan.selectionRef===c.selectionRef&&Array.isArray(worldPlan.roots)&&worldPlan.roots.length===c.questionIds.length,'fixed_new_world_plan');
 const registry=validatePolicyRegistry(evidence(h,worldPlan.registryRef)),snapshotCache=new Map(),worldSeeds=new Set(),worldIds=new Set();
 for(let i=0;i<c.questions.length;i++){
  const q=c.questions[i],source=proof.questionSources[i],snapshot=readOfflineSnapshot(source.row,snapshotCache,{purpose:'first-round-new-test'}),frozen=proof.selection.questions[i],world=worldPlan.roots[i];
  need(equal(q,{questionId:source.questionId,familyId:source.blockFamilyId,inputSHA256:source.row.inputSHA256,featuresSHA256:frozen.featuresSHA256,sourceRowSHA256:digest(source.row)})&&world?.questionId===q.questionId&&world.inputSHA256===q.inputSHA256&&Array.isArray(world.worlds)&&(commonView?world.worlds.length>0:world.worlds.length===4),'exact_selected_question_binding');
  if(commonView){validateCommonViewWorldBatch(world.comparisonBatch,c.protocolRef);need(equal(world.comparisonBatch.worlds,world.worlds),'new_test_world_batch_binding');}
  for(const w of world.worlds){need(Number.isSafeInteger(w.seed)&&w.seed>=0&&text(w.worldId)&&!worldSeeds.has(w.seed)&&!worldIds.has(w.worldId)&&!proof.screenWorlds.some(o=>o.seed===w.seed||o.worldId===w.worldId),'independent_new_world_identity');worldSeeds.add(w.seed);worldIds.add(w.worldId);}
  need(equal(world.otherPolicyIds,snapshot.record.policyIds.map((id:string,seat:number)=>seat===source.row.actorSeat?null:id)),'frozen_original_other_policies');
 }
 let loaded:Promise<any>|undefined;
 const load=()=>loaded??=(async()=>{
  const f=proof.comparison,parent=await resolveFirstRoundParent({parentRef:f.studentParentRef,envelope:f.envelope,readEvidence:(r:any)=>h.evidenceBytes(r),repositoryRoot:h.repositoryRoot}),proposalBase=await resolveNodePolicy(f.proposer.release.proposalPolicyRef,h.repositoryRoot),studentRef=ref(h,c.s1Ref),releasePath=inputs.studentReleasePaths?.[c.s1Ref];
  need(typeof releasePath==='string','selected_student_path');const student=await loadStudentRelease(releasePath,studentRef.releaseSHA256,h.repositoryRoot,{readEvidence:(r:any)=>h.evidenceBytes(r)});
  need(equal(JSON.parse(JSON.stringify(proposalBase.identity)),f.proposer.policyIdentity)&&student.release.policyId===studentRef.policyId&&student.release.schema==='ohuo-student-release-first-round-v3'&&student.release.proposalRef===f.proposalRef&&student.release.learningParent.ref===f.studentParentRef,'loaded_selected_composite_identity');
  return{parent,proposal:{...proposalBase,candidatePolicy:f.proposer.candidatePolicy},student};
 })();
 const prepareRoot=async(i:number,runPreparation?:any)=>{
  need(Number.isSafeInteger(i)&&i>=0&&i<proof.questionSources.length,'prepared_root_index');const source=proof.questionSources[i],world=worldPlan.roots[i],snapshot=readOfflineSnapshot(source.row,new Map(),{purpose:'first-round-new-test'}),{parent,proposal,student}=await load();
  const otherPolicies=world.otherPolicyIds.map((id:any,seat:number)=>seat===source.row.actorSeat?null:registry.policies.find(p=>p.policyId===id));need(otherPolicies.every((p:any,seat:number)=>seat===source.row.actorSeat||p),'original_other_policy_missing');
  for(let seat=0;seat<4;seat++)if(seat!==source.row.actorSeat)verifyFirstRoundRecordedPeer({seatSnapshot:snapshot.record.seatSnapshots?.[seat],policySpec:otherPolicies[seat],registryRef:worldPlan.registryRef,readEvidence:(r:any)=>h.evidenceBytes(r),repositoryRoot:h.repositoryRoot,role:seat===(source.row.actorSeat+2)%4?'partner':'opponent'});
  const continuation=firstRoundContinuation({actor:source.row.actorSeat,proposalRef:proof.comparison.proposalRef,parentRef:proof.comparison.studentParentRef,proposal,parent,otherPolicies});
  return freezeFirstRoundNewTestRoot({snapshot,questionId:source.questionId,familyId:source.blockFamilyId,s0Ref:c.s0Ref,s1Ref:c.s1Ref,studentRelease:student.release,parentNetwork:parent.network,studentSelectInitialAction:student.selectInitialAction,worlds:world.worlds,screenWorlds:proof.screenWorlds,continuation,...(commonView?{comparisonBatch:world.comparisonBatch,...runPreparation}:{})});
 };
 const inputWorkload={providerRequests:0,labelDecisions:0,optimizerSteps:0,matchAttempts:worldPlan.roots.reduce((n:number,r:any)=>n+2*r.worlds.length,0)};
 if(commonView)need(task.limits.maxMatchAttempts===inputWorkload.matchAttempts,'new_test_declared_two_action_slots');
 return{kind:'first-round-new-test',mode:'research',contract:c,prepareRoot,firstRoundNewTest:proof,...(commonView?{inputWorkload}:{})};
}
