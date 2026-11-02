/** NAV-R11/R13: three named DS diagnostic allocations, not a teacher vote.
 * Called only with the original host-verified selection. Existing H/TC remains
 * the authority for references, admission, immutable evidence and reservations.
 * This module never requests a model, loads weights, samples or changes a label.
 */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {canonical,digest,fixedReference,strictObject} from './task-schema.mjs';
const sha=(x:Uint8Array|string)=>createHash('sha256').update(x).digest('hex');
const need=(yes:any,reason:string)=>{if(!yes)throw Error('blind_review_'+reason);};
const integer=(x:any)=>Number.isSafeInteger(x)&&x>=0;
const hash=(x:any)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const key=(x:any)=>canonical(x);
const family=(r:any)=>r.blockFamilyId??r.familyId;
const text=(x:any)=>typeof x==='string'&&x.trim().length>0;
const ordered=(rows:any[])=>[...rows].sort((a,b)=>Buffer.compare(Buffer.from(sha(a.decisionId)),Buffer.from(sha(b.decisionId)))||Buffer.compare(Buffer.from(a.decisionId,'utf8'),Buffer.from(b.decisionId,'utf8'))||Buffer.compare(Buffer.from(key(a.key)),Buffer.from(key(b.key))));
const PURPOSE='first_round_blind_diagnostic';
const CONTRACT='ohuo-first-round-blind-review-contract-v1';
function readReference(ref:string,refs:ReadonlyMap<string,any>,inputs:any){
 fixedReference(ref,'blindReviewReference');const value=refs.get(ref)??inputs.readFirstRoundReference?.(ref)??inputs.offlineSelection?.references?.get(ref);
 need(value!==undefined&&digest(value)===ref.split(':').at(-1),'fixed_reference_identity');return value;
}
function readEvidence(ref:any,inputs:any){
 strictObject(ref,'blindReviewEvidence',['id','sha256']);need(text(ref.id)&&hash(ref.sha256)&&typeof inputs.readFirstRoundEvidence==='function','evidence_adapter');
 const bytes=Buffer.from(inputs.readFirstRoundEvidence(ref));need(sha(bytes)===ref.sha256,'evidence_identity');return JSON.parse(bytes.toString('utf8'));
}
export function blindReviewBatchId(task:any,selectionRef:string,batch='formal-data'){
 return 'first-round-'+batch+'-'+digest({planRef:task.planRef,selectionRef,sourceIndexRef:task.sourcePlan.sourceIndexRef,queueRef:task.seatLayoutPlan}).slice(0,24);
}
function contractValue(task:any,refs:ReadonlyMap<string,any>,inputs:any){
 const c=readReference(task.scientificContract.decisionRuleRef,refs,inputs);
 strictObject(c,'blindReviewContract',['schema','comparisonRef','selectionRef','primaryLabelPolicyRef','secondaryLabelPolicyRef','batch','batchId','selectionPolicy','maxRequests','criticalReviewRef','selected',...(c?.batch==='new-test'?['sourceSpecRef']:[])]);
 need(c.schema===CONTRACT&&['cost-pilot','formal-data','new-test'].includes(c.batch)&&c.batchId===blindReviewBatchId(task,c.selectionRef,c.batch),'batch_identity');
 need(c.selectionPolicy==='critical2-hash-independent2-v1'&&c.maxRequests===4&&Array.isArray(c.selected)&&c.selected.length>=1&&c.selected.length<=4,'fixed_allocation');
 for(const r of [c.selectionRef,c.comparisonRef,c.primaryLabelPolicyRef,c.secondaryLabelPolicyRef,...(c.batch==='new-test'?[c.sourceSpecRef]:[])])fixedReference(r,'blindReviewContract');
 need(c.comparisonRef===task.scientificContract.comparisonRef&&equal(task.datasetRefs,[c.selectionRef])&&task.labelPolicyRef===c.secondaryLabelPolicyRef&&c.secondaryLabelPolicyRef!==c.primaryLabelPolicyRef,'task_contract');
 const comparison=readReference(c.comparisonRef,refs,inputs),primary=readReference(c.primaryLabelPolicyRef,refs,inputs),secondary=readReference(c.secondaryLabelPolicyRef,refs,inputs);
 for(const teacher of [primary,secondary]){strictObject(teacher,'blindReviewTeacher',['schema','releaseRef','profileRevisionRef']);need(teacher.schema==='ohuo-offline-teacher-ref-v1','teacher_identity');fixedReference(teacher.releaseRef,'teacherRelease');need(teacher.profileRevisionRef&&typeof teacher.profileRevisionRef==='object'&&text(teacher.profileRevisionRef.profileId)&&Number.isSafeInteger(teacher.profileRevisionRef.revision)&&teacher.profileRevisionRef.revision>=1&&hash(teacher.profileRevisionRef.snapshotHash),'profile_identity');}
 need(comparison.schema==='ohuo-first-round-comparison-v1'&&comparison.proposalRef===task.parentPolicyRef&&!equal(primary.profileRevisionRef,secondary.profileRevisionRef)&&task.releaseRefs.includes(secondary.releaseRef),'independent_teacher_identity');
 return {contract:c,primary,secondary};
}
/** The critical pool is an independently authored, fixed reviewer judgement,
 * not an inferred truth/strength certificate. Existing hard-check/initial-screen
 * evidence is bound, not rerun. H must admit these immutable evidence artifacts
 * through its normal original-root provenance checks before calling prepare.
 */
function criticalPool(c:any,primary:any,metadata:any[],refs:ReadonlyMap<string,any>,inputs:any,task:any){
 if(c.criticalReviewRef===null)return [];
 const review=readEvidence(c.criticalReviewRef,inputs);strictObject(review,'blindCriticalReview',['schema','selectionRef','primaryLabelPolicyRef','reviewerRef','cases']);
 need(review.schema==='ohuo-first-round-critical-review-v1'&&review.selectionRef===c.selectionRef&&review.primaryLabelPolicyRef===c.primaryLabelPolicyRef&&Array.isArray(review.cases)&&review.cases.length<=32,'critical_review_binding');
 const reviewer=readReference(review.reviewerRef,refs,inputs);strictObject(reviewer,'blindReviewer',['schema','role','planRef']);
 need(reviewer.schema==='ohuo-first-round-reviewer-v1'&&reviewer.role==='independent-hard-check-reviewer'&&reviewer.planRef===task.planRef&&![c.primaryLabelPolicyRef,c.secondaryLabelPolicyRef].includes(review.reviewerRef),'independent_reviewer');
 const seen=new Set<string>();return review.cases.map((entry:any)=>{
  strictObject(entry,'blindCriticalCase',['key','inputSHA256','decisionId','reason','labelTerminalRef','hardCheckRef','screenSummaryRef']);
  const m=metadata.find(m=>equal(m.key,entry.key));need(m&&m.inputSHA256===entry.inputSHA256&&m.decisionId===entry.decisionId&&!seen.has(key(entry.key)),'critical_original_target');seen.add(key(entry.key));
  const terminal=readEvidence(entry.labelTerminalRef,inputs),hard=readEvidence(entry.hardCheckRef,inputs);
  need(terminal.schema==='ohuo-offline-label-result-v1'&&terminal.selectionRef===c.selectionRef&&terminal.purpose===(c.batch==='new-test'?'distribution_diagnostic':'b_training_source')&&terminal.inputSHA256===m.inputSHA256&&terminal.decisionId===m.decisionId&&equal(terminal.key,m.key)&&terminal.teacher?.releaseRef===primary.releaseRef&&terminal.remote?.status==='selected'&&terminal.offlineLabel?.legality==='validated','critical_original_primary');
  need(['profileId','revision','snapshotHash'].every(k=>terminal.teacher?.profileSnapshot?.[k]===primary.profileRevisionRef[k]),'critical_primary_profile');
  need(hard.schema==='ohuo-first-round-hard-check-v1'&&hard.inputSHA256===m.inputSHA256&&equal(hard.labelTerminalRef,entry.labelTerminalRef)&&hard.reviewerRef===review.reviewerRef&&hard.checks?.canonicalLegal==='passed'&&hard.checks?.inFrozenC==='passed','critical_hard_check');
  const response=terminal.teacherResponses;need(Array.isArray(response)&&response.length===1&&response[0].kind==='choose'&&response[0].decisionId===m.decisionId&&response[0].actionId===terminal.remote.actionId&&response[0].note===hard.rationale,'critical_original_response');
  if(entry.reason==='public_fact_conflict')need(hard.decision==='diagnostic'&&hard.checks.publicFacts==='failed'&&entry.screenSummaryRef===null,'critical_public_fact_conflict');
  else{
   need(entry.reason==='strategy_disagreement_inconclusive'&&terminal.acting?.actionId!==terminal.remote.actionId&&hard.decision==='admitted'&&Object.values(hard.checks).every(v=>v==='passed')&&entry.screenSummaryRef!==null,'critical_strategy_disagreement');
   const summary=readEvidence(entry.screenSummaryRef,inputs);
   if(c.batch==='new-test'){const roots=summary.plans?.filter((p:any)=>p.plan?.inputSHA256===m.inputSHA256&&p.plan?.questionId===m.questionId);need(summary.schema==='ohuo-first-round-new-test-summary-v1'&&summary.selectionRef===c.selectionRef&&summary.active===null&&summary.executionUnknown===false&&roots?.length===1&&['incomplete','complete'].includes(roots[0].status),'critical_initial_consequence');}
   else {const roots=summary.plans?.filter((p:any)=>p.inputSHA256===m.inputSHA256&&equal(p.labelTerminalRef,entry.labelTerminalRef)&&equal(p.hardCheckRef,entry.hardCheckRef));need(summary.schema==='ohuo-first-round-screen-summary-v1'&&summary.selectionRef===c.selectionRef&&summary.active===null&&summary.executionUnknown===false&&roots?.length===1&&['incomplete','screen_adverse','provisional_screened'].includes(roots[0].status),'critical_initial_consequence');}
  }
  return m;
 });
}
function sourceProjection(task:any,c:any,refs:ReadonlyMap<string,any>,inputs:any,proof:any){
 const full=proof?.selection;
 if(c.batch==='new-test'){
  need(proof===inputs.firstRoundNewTest&&full?.schema==='ohuo-first-round-new-test-selection-result-v1'&&digest(full)===c.selectionRef.split(':').at(-1)&&full.verification==='reproduced'&&full.trainingEligible===false&&full.returnToTraining===false&&full.plan?.purpose==='first-round-independent-new-test'&&full.plan.comparisonRef===c.comparisonRef&&full.plan.sourceIndexRef===task.sourcePlan.sourceIndexRef&&Array.isArray(proof.questionSources),'verified_new_test_selection');
  const sourceSpec=readReference(c.sourceSpecRef,refs,inputs);strictObject(sourceSpec,'newTestSourceSpec',['schema','planRef','budgetRef','queueRef','sourceIndexRef','comparisonRef','s0Ref','s1Ref','selectionPlanRef','sourceTaskRefs','sourceRunRefs']);need(sourceSpec.schema==='ohuo-first-round-new-test-source-v1'&&equal(full.plan,readReference(sourceSpec.selectionPlanRef,refs,inputs))&&equal(sourceSpec,proof.sourceSpec)&&sourceSpec.planRef===task.planRef&&sourceSpec.budgetRef===task.budgetRef&&sourceSpec.sourceIndexRef===task.sourcePlan.sourceIndexRef&&sourceSpec.queueRef===task.seatLayoutPlan&&sourceSpec.comparisonRef===c.comparisonRef&&task.sourcePlan.split==='confirm','new_test_source_spec');
  need(proof.questionSources.length===full.questions.length,'new_test_source_count');
  const rows:any[]=[],metadata=full.questions.map((q:any)=>{const matches=proof.questionSources.filter((s:any)=>s.questionId===q.questionId);need(matches.length===1,'new_test_source_question');const source=matches[0],row=source.row;need(source.blockFamilyId===q.familyId&&source.contextSHA256===q.contextSHA256&&row.split==='confirm'&&family(row)===q.familyId&&q.origins.some((o:any)=>o.questionId===source.decisionId&&o.inputSHA256===row.inputSHA256),'new_test_original_origin');rows.push(row);return{key:row.key,inputSHA256:row.inputSHA256,decisionId:source.decisionId,questionId:q.questionId};});
  return {full,rows,metadata,sourcePurpose:'distribution_diagnostic'};
 }
 need(full?.schema==='ohuo-offline-label-selection-v2'&&digest(full)===c.selectionRef.split(':').at(-1)&&full.purpose==='b_training_source'&&proof.production?.verification==='reproduced'&&proof.spec?.planRef===task.planRef&&proof.spec.actingReleaseRef===task.parentPolicyRef&&full.sourceIndexRef===task.sourcePlan.sourceIndexRef&&full.queueRef===task.seatLayoutPlan,'verified_original_selection');
 const selectionRule=readReference(proof.production.selectionRuleRef,refs,inputs);need(selectionRule.schema===(c.batch==='cost-pilot'?'ohuo-offline-selection-first-round-pilot-rule-v1':'ohuo-offline-selection-first-round-rule-v1')&&selectionRule.comparisonRef===c.comparisonRef,'formal_selection_rule');
 if(c.batch==='cost-pilot'){const index=readReference(full.sourceIndexRef,refs,inputs),queue=readReference(full.queueRef,refs,inputs);need(selectionRule.purpose==='cost-pilot-only'&&text(selectionRule.pilotNamespace)&&selectionRule.pilotNamespace===index.namespace&&selectionRule.pilotNamespace===queue.namespace&&selectionRule.keepRule==='none-cost-pilot-only'&&selectionRule.familySplitRule==='pilot-train-only-no-training-admission'&&selectionRule.postValidationKeepRule==='none-cost-pilot-only'&&full.rows.every((r:any)=>r.split==='train'),'pilot_selection_rule');}
 need(Array.isArray(proof.selectedMetadata)&&Array.isArray(full.rows),'selected_metadata');
 const metadata=proof.selectedMetadata.filter((m:any)=>m.sampleKind==='demo');need(metadata.length===full.rows.length&&metadata.every((m:any)=>m.sampleClass==='target'&&full.rows.some((r:any)=>equal(r.key,m.key)&&r.inputSHA256===m.inputSHA256)),'original_target_metadata');
 return {full,rows:full.rows,metadata,sourcePurpose:'b_training_source'};
}
export function prepareBlindReviewProjection(task:any,refs:ReadonlyMap<string,any>,inputs:any,verifiedSelection:any){
 const {contract:c,primary}=contractValue(task,refs,inputs),proof=c.batch==='new-test'?inputs.firstRoundNewTest:verifiedSelection;
 const source=sourceProjection(task,c,refs,inputs,proof),{full,metadata}=source;
 need(task.taskKind==='collect'&&task.operationScope.apiCalls===true&&task.operationScope.parameterUpdates===false&&task.operationScope.deployment===false&&task.limits.maxOptimizerSteps===0&&task.limits.maxMatchAttempts===0&&(c.batch==='new-test'?task.sourcePlan.split==='confirm':['train','dev'].includes(task.sourcePlan.split)),'diagnostic_scope');
 need(metadata.every((m:any)=>text(m.decisionId)&&hash(m.inputSHA256))&&new Set(metadata.map((m:any)=>key(m.key))).size===metadata.length&&new Set(metadata.map((m:any)=>m.decisionId)).size===metadata.length,'original_target_metadata');
 const all=ordered(metadata),independent=all.slice(0,2),critical=ordered(criticalPool(c,primary,metadata,refs,inputs,task)).slice(0,2);
 const selected=all.filter(m=>independent.includes(m)||critical.includes(m)).map(m=>({key:m.key,inputSHA256:m.inputSHA256,decisionId:m.decisionId,...(c.batch==='new-test'?{questionId:m.questionId}:{}),roles:[...(critical.includes(m)?['critical']:[]),...(independent.includes(m)?['independent']:[])]}));
 need(equal(c.selected,selected),'deterministic_allocation');
 const rows=selected.flatMap(s=>source.rows.filter((r:any)=>equal(r.key,s.key)&&r.split===task.sourcePlan.split)),families=[...new Set(rows.map((r:any)=>family(r)))].sort();
 need(rows.length>0&&equal([...task.sourcePlan.familyIds].sort(),families)&&integer(task.limits.maxProviderRequests)&&task.limits.maxProviderRequests>0&&task.limits.maxProviderRequests<=rows.length&&task.limits.maxLabelDecisions===rows.length,'split_projection_limits');
 const quotas=families.map(familyId=>({familyId,count:rows.filter((r:any)=>family(r)===familyId).length}));
 return {kind:'first-round-blind-review',purpose:PURPOSE,contractRef:task.scientificContract.decisionRuleRef,contract:structuredClone(c),globalSelected:structuredClone(selected),selection:{...structuredClone(full),purpose:source.sourcePurpose,rows:structuredClone(rows),quotas,selectedCount:rows.length},checkpointBinding:{contractRef:task.scientificContract.decisionRuleRef,batchId:c.batchId,purpose:PURPOSE}};
}
/** H calls this only from its WeakSet-authenticated selection context, both at
 * preflight and each existing TC reservation. Per-batch split allocation caps
 * sum to <=4, while original consumed/reserved/unknown ledger entries persist.
 * A replacement task/contract is not a new allowance, even if no API was sent.
 */
function historyRows(task:any,c:any,get:(ref:string)=>any){
 const full=get(c.selectionRef);
 if(c.batch==='new-test'){
  const sourceSpec=get(c.sourceSpecRef);strictObject(sourceSpec,'newTestHistorySourceSpec',['schema','planRef','budgetRef','queueRef','sourceIndexRef','comparisonRef','s0Ref','s1Ref','selectionPlanRef','sourceTaskRefs','sourceRunRefs']);need(sourceSpec.schema==='ohuo-first-round-new-test-source-v1'&&equal(full.plan,get(sourceSpec.selectionPlanRef))&&sourceSpec.planRef===task.planRef&&sourceSpec.budgetRef===task.budgetRef&&sourceSpec.sourceIndexRef===task.sourcePlan.sourceIndexRef&&sourceSpec.queueRef===task.seatLayoutPlan&&sourceSpec.comparisonRef===c.comparisonRef,'new_test_history_source_spec');
  need(full.schema==='ohuo-first-round-new-test-selection-result-v1'&&full.verification==='reproduced'&&full.trainingEligible===false&&full.returnToTraining===false&&full.plan?.purpose==='first-round-independent-new-test'&&full.plan.sourceIndexRef===task.sourcePlan.sourceIndexRef&&full.plan.comparisonRef===c.comparisonRef,'new_test_history_selection');
  return c.selected.map((s:any)=>{const q=full.questions.find((q:any)=>q.questionId===s.questionId);need(q&&q.origins.some((o:any)=>o.questionId===s.decisionId&&o.inputSHA256===s.inputSHA256),'new_test_history_origin');return {...s,blockFamilyId:q.familyId,familyId:q.familyId,split:'confirm'};});
 }
 need(full.schema==='ohuo-offline-label-selection-v2'&&full.sourceIndexRef===task.sourcePlan.sourceIndexRef&&full.queueRef===task.seatLayoutPlan&&full.purpose==='b_training_source','history_selection');
 const production=get(full.productionRef),spec=get(production.specRef),rule=get(production.selectionRuleRef);need(spec.planRef===task.planRef&&spec.actingReleaseRef===task.parentPolicyRef&&rule.comparisonRef===c.comparisonRef,'history_selection_plan');
 if(c.batch==='cost-pilot'){const index=get(full.sourceIndexRef),queue=get(full.queueRef);need(rule.schema==='ohuo-offline-selection-first-round-pilot-rule-v1'&&rule.purpose==='cost-pilot-only'&&text(rule.pilotNamespace)&&rule.pilotNamespace===index.namespace&&rule.pilotNamespace===queue.namespace&&full.rows.every((r:any)=>r.split==='train'),'pilot_history_selection');}
 else need(c.batch==='formal-data'&&rule.schema==='ohuo-offline-selection-first-round-rule-v1','formal_history_selection');
 return c.selected.map((s:any)=>{const rows=full.rows.filter((r:any)=>equal(r.key,s.key)&&r.inputSHA256===s.inputSHA256);need(rows.length===1,'history_selected_row');return rows[0];});
}
function allocation(task:any,c:any,rows:any[]){
 const selected=rows.filter((r:any)=>r.split===task.sourcePlan.split);
 need(selected.length>0&&equal([...task.sourcePlan.familyIds].sort(),[...new Set(selected.map((r:any)=>family(r)))].sort())&&integer(task.limits.maxProviderRequests)&&task.limits.maxProviderRequests>0&&task.limits.maxProviderRequests<=selected.length&&task.limits.maxLabelDecisions===selected.length&&task.limits.maxOptimizerSteps===0&&task.limits.maxMatchAttempts===0&&task.operationScope.apiCalls===true&&!task.operationScope.parameterUpdates&&!task.operationScope.deployment,'split_projection_limits');
 need(c.selected.filter((s:any)=>s.roles?.includes('critical')).length<=2&&c.selected.filter((s:any)=>s.roles?.includes('independent')).length<=2,'history_partition_caps');
 return selected;
}
export function checkFirstRoundBlindReviewAdmission({task,state,projection:p,references}:any){
 const c=p?.contract;need(p?.kind==='first-round-blind-review'&&p.contractRef===task.scientificContract.decisionRuleRef&&c?.schema===CONTRACT&&digest(c)===p.contractRef.split(':').at(-1)&&equal(task.datasetRefs,[c.selectionRef]),'admission_binding');
 const get=(r:string)=>{fixedReference(r,'blindHistoryReference');const v=references.get(r);need(v!==undefined&&digest(v)===r.split(':').at(-1),'history_reference');return v;};
 need(equal(get(p.contractRef),c),'history_contract');allocation(task,c,historyRows(task,c,get));
 const ledger=state.budgets?.[task.budgetRef];need(ledger&&ledger.reservations,'original_ledger');const byStage=new Map<string,{contractRef:string;used:number;slots:Map<string,string>}>();let allDS=0;
 for(const run of Object.values(state.runs??{}) as any[]){const t=run.task;if(!t||t.planRef!==task.planRef&&t.budgetRef!==task.budgetRef&&t.researchBatchId!==task.researchBatchId)continue;const cap=get(t.capabilityRef);if(cap.id!=='B07.offline-label.v1')continue;
  const rule=get(t.scientificContract.decisionRuleRef),isBlind=rule.schema===CONTRACT;if(!isBlind&&t.labelPolicyRef!==c.secondaryLabelPolicyRef)continue;
  need(isBlind&&t.planRef===task.planRef&&t.budgetRef===task.budgetRef&&t.researchBatchId===task.researchBatchId&&t.authorizationRef===task.authorizationRef,'batch_task_reset');
  const prior=contractValue(t,references,{}).contract,rows=historyRows(t,prior,get);allocation(t,prior,rows);
  need(prior.primaryLabelPolicyRef===c.primaryLabelPolicyRef&&prior.secondaryLabelPolicyRef===c.secondaryLabelPolicyRef,'batch_teacher_identity');
  if(prior.batch===c.batch)need(t.scientificContract.decisionRuleRef===p.contractRef&&equal(t.datasetRefs,[c.selectionRef]),'batch_task_reset');
  need(run.runId===t.runId&&state.tasks[t.taskId]===run.runId&&run.taskSHA256===digest(t)&&run.taskRef?.split(':').at(-1)===digest(t),'history_identity');
  const stage=byStage.get(prior.batch)??{contractRef:t.scientificContract.decisionRuleRef,used:0,slots:new Map<string,string>()};need(stage.contractRef===t.scientificContract.decisionRuleRef,'batch_task_reset');byStage.set(prior.batch,stage);
  const split=t.sourcePlan.split;need(!stage.slots.has(split),'split_task_reset');stage.slots.set(split,t.runId);
  if(prior.batch===c.batch&&split===task.sourcePlan.split)need(run.runId===task.runId&&equal(t,task),'split_task_reset');
  const reservations=Object.values(ledger.reservations).filter((r:any)=>r.runId===run.runId) as any[],cp=run.checkpoint;
  need(!run.executionUnknown&&run.observationStatus!=='unknown'&&!cp?.executionUnknown&&!reservations.some(r=>r.status==='reserved_unknown'),'execution_uncertain');
  const binding={contractRef:t.scientificContract.decisionRuleRef,batchId:prior.batchId,purpose:PURPOSE};
  if(cp)need(cp.schema==='ohuo-offline-label-run-v1'&&cp.taskSHA256===digest(t)&&cp.selectionRef===prior.selectionRef&&equal(cp.blindReview,binding),'checkpoint_binding');
  if(cp?.active!==null&&cp?.active!==undefined)need(run.runId===task.runId&&['preparing','running','stopping'].includes(run.status)&&ledger.activeRunId===run.runId,'execution_uncertain');
  if(run.runId!==task.runId)need(['completed','failed','interrupted'].includes(run.status)&&run.cleanupConfirmed===true&&ledger.activeRunId!==run.runId&&!reservations.some(r=>r.status==='reserved'),'execution_uncertain');
  const consumed=reservations.filter(r=>r.status!=='released').reduce((n,r)=>{need(integer(r.cost?.providerRequests),'reservation_cost');return n+r.cost.providerRequests;},0);need(consumed<=t.limits.maxProviderRequests,'request_cap');stage.used+=consumed;allDS+=consumed;need(stage.used<=4,'request_cap');
 }
 need(allDS<=12,'total_request_cap');return true;
}
