/** The NAV-R16 branch phase uses the original Task context/ledger and original
 * legal-world full-match evaluator. Host preparation is a fixed code closure,
 * never a Task-supplied module; source/selected-release evidence joins belong to
 * the existing host. No teacher calls, training, new ledger or orchestration. */
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {summarizeFirstRoundNewRoot,summarizeFirstRoundNewTest} from './first-round-evaluation.ts';
const sha=(x:Uint8Array|string)=>createHash('sha256').update(x).digest('hex');
const hex=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fixed=(x:unknown)=>typeof x==='string'&&/^.+@sha256:[a-f0-9]{64}$/.test(x);
const unique=(x:unknown)=>Array.isArray(x)&&x.every(v=>typeof v==='string'&&v.length)&&new Set(x).size===x.length;
const questionBinding=(plan:any)=>({questionId:plan.questionId,familyId:plan.familyId,inputSHA256:plan.inputSHA256,featuresSHA256:plan.featuresSHA256,sourceRowSHA256:plan.sourceRowSHA256});
const scope={localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false};
const zero={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0};
export function validateFirstRoundNewTestTask(task:any,c:any,mode:'research'|'offline_synthetic'){
 const commonView=c?.schema==='ohuo-common-view-new-test-contract-r2';
 if(commonView&&(c.protocolRef!==task.scientificContract.analysisMethodRef||!fixed(c.protocolRef)))throw Error('new_test_protocol_binding');
 if((!commonView&&c?.schema!=='ohuo-first-round-new-test-contract-v1')||!['selectionRef','comparisonRef','sourceIndexRef','s0Ref','s1Ref'].every(k=>fixed(c[k]))||c.s0Ref===c.s1Ref||!unique(c.familyIds)||c.familyIds.length<1||!commonView&&c.familyIds.length>2||!unique(c.questionIds)||!commonView&&c.questionIds.length>8*c.familyIds.length||!Array.isArray(c.questions)||c.questions.length!==c.questionIds.length||c.questions.some((q:any,i:number)=>q?.questionId!==c.questionIds[i]||!c.familyIds.includes(q.familyId)||!['inputSHA256','featuresSHA256','sourceRowSHA256'].every(k=>hex(q[k])))||!commonView&&(c.familyIds.some((f:string)=>c.questions.filter((q:any)=>q.familyId===f).length>8)||!Number.isSafeInteger(c.maxBranchStarts)||c.maxBranchStarts<0||c.maxBranchStarts>8*c.questionIds.length||c.maxBranchStarts>128)||task.taskKind!=='evaluate'||!equal(task.operationScope,scope)||task.limits.maxProviderRequests!==0||task.limits.maxOptimizerSteps!==0||task.limits.maxLabelDecisions!==0||!commonView&&task.limits.maxMatchAttempts!==c.maxBranchStarts||task.sourcePlan.sourceIndexRef!==c.sourceIndexRef||!equal(task.sourcePlan.familyIds,c.familyIds)||!equal(task.datasetRefs,[c.selectionRef])||task.scientificContract.comparisonRef!==c.comparisonRef||task.parentPolicyRef!==c.s0Ref||!task.releaseRefs.includes(c.s0Ref)||!task.releaseRefs.includes(c.s1Ref)||
   (mode==='research'?(c.purpose!=='first-round-independent-new-test'||task.sourcePlan.split!=='confirm'):(mode!=='offline_synthetic'||c.purpose!=='engineering_fixture'||task.sourcePlan.split!=='fixture')))
  throw Error('first_round_new_test_task_identity_or_bound');
 return c;
}
export function firstRoundEvaluationCheckpoint(c:any){return !!c&&c.schema==='ohuo-first-round-new-test-run-v1'&&hex(c.taskSHA256)&&fixed(c.selectionRef)&&fixed(c.contractRef)&&Number.isSafeInteger(c.rootCursor)&&c.rootCursor>=0&&Array.isArray(c.plans)&&Array.isArray(c.attempts)&&typeof c.executionUnknown==='boolean';}

/** Called inside the owned timed run after authentic S0/S1 bytes are loaded.
 * Snapshot is readOfflineSnapshot(row, cache, {purpose:'first-round-new-test'}).
 * New questions use both actual heads on the SAME original C/423 input. */
export async function freezeFirstRoundNewTestRoot({snapshot:s,questionId,familyId,s0Ref,s1Ref,studentRelease,parentNetwork,studentSelectInitialAction,worlds,screenWorlds,continuation,comparisonBatch,ctx,worldCheckpoint,onWorldCheckpoint}:any){
 const [{firstRoundTeacherRoot,prepareCommonViewWorlds,validateCommonViewWorldBatch},{rerankStudent423InitialCandidates},{digest}]=await Promise.all([import('./first-round-screen-runtime'),import('../../packages/ai/src/hybrid/student'),import('./task-schema.mjs')]);
 const commonView=comparisonBatch?.schema==='ohuo-common-view-world-batch-r2',captured=s.input.studentInputs;
 if(commonView){validateCommonViewWorldBatch(comparisonBatch,ctx?.task?.scientificContract?.analysisMethodRef);if(ctx?.executionBoundary?.mode!=='input-workload-only'||!equal(comparisonBatch.worlds,worlds))throw Error('new_test_owned_world_preparation_required');}
 if(!captured||captured.inputDim!==423||!['confirm','fixture'].includes(s.row.split)||s.input.schema!=='ohuo-decision-input-first-round-v3'||!fixed(s0Ref)||!fixed(s1Ref)||s0Ref===s1Ref||typeof questionId!=='string'||!questionId||studentRelease?.schema!=='ohuo-student-release-first-round-v3'||studentRelease.learningParent?.ref!==captured.studentParentRef||!equal(studentRelease.learningParent?.scorer,captured.scorer)||studentRelease.proposalRef!==continuation.binding.proposalRef||captured.studentParentRef!==continuation.binding.parentRef||!equal(studentRelease.candidatePolicy,captured.candidatePolicy))throw Error('new_test_actual_S0_S1_capture_identity');
 if(!Array.isArray(screenWorlds)||!Array.isArray(worlds)||(commonView?worlds.length<1:worlds.length!==4)||worlds.some(w=>!Number.isSafeInteger(w.seed)||w.seed<0||typeof w.worldId!=='string'||!w.worldId||screenWorlds.some(o=>o.seed===w.seed||o.worldId===w.worldId))||new Set(worlds.map(w=>w.seed)).size!==worlds.length||new Set(worlds.map(w=>w.worldId)).size!==worlds.length)throw Error('new_test_four_independent_worlds_required');
 if(typeof studentSelectInitialAction!=='function')throw Error('new_test_loaded_student_selector_required');
 const s0=rerankStudent423InitialCandidates(s.bundle,captured,parentNetwork),s1={actionId:studentSelectInitialAction({bundle:s.bundle,candidateInputs:s.input.candidateInputs,studentInputs:captured})};
 if(s0.actionId!==captured.baseActionId||!equal(s0.scores,captured.rawQ))throw Error('new_test_reloaded_S0_differs_from_original_capture');
 const prepared=commonView?await prepareCommonViewWorlds(s,{ctx,batchPlan:comparisonBatch,checkpoint:worldCheckpoint,onCheckpoint:onWorldCheckpoint}):null;
 if(prepared&&prepared.status!=='prepared')throw Error('new_test_'+prepared.status+'_legal_world_preparation');
 const root=prepared?.root??firstRoundTeacherRoot(s),actions=[...new Set([s0.actionId,s1.actionId])].map(actionId=>{const c=s.bundle.pool.find((c:any)=>c.actionId===actionId),candidate=root.allCandidates.find((c:any)=>c.actionId===actionId);if(!c||!candidate)throw Error('new_test_actual_action_outside_original_C');return{actionId,canonicalId:c.canonicalId,direction:c.canonical===null?'pass':'takeover',move:candidate.move};});
 const plan={schema:'ohuo-first-round-new-root-v1',...(commonView?{comparisonBatch:structuredClone(comparisonBatch),worldSamples:prepared!.worlds.map((w:any)=>({worldId:w.worldId,sampleSHA256:w.sampleSHA256,hiddenLayoutSHA256:w.sample.hiddenLayoutSHA256}))}:{}),familyId,questionId,sourceFamilyId:s.row.familyId,inputSHA256:s.row.inputSHA256,sourceRowSHA256:digest(s.row),rootId:root.rootId,observationSHA256:root.observedBefore.observationSHA256,s0Ref,s1Ref,s0Scorer:captured.scorer,s1Scorer:studentRelease.scorer,s0ActionId:s0.actionId,s1ActionId:s1.actionId,candidateSpec:s.input.candidateSpec,candidatePolicy:captured.candidatePolicy,candidateIds:s.bundle.initialCandidateIds,featuresSHA256:digest(captured.candidateFeatures),actions,worlds:structuredClone(worlds),continuation:continuation.binding,profileSHA256:continuation.profile.profileSHA256,policyIds:continuation.profile.seats.map((s:any)=>s.policyId)};
 return{root,plan,planSHA256:digest(plan),continuation,...(commonView?{frozenWorlds:prepared!.worlds}:{})};
}

/** executionInputs.prepareRoot is constructed by the source-reviewed host;
 * it lazy-loads authentic weights inside this run and returns the above object.
 * Host admission binds contractRef/selectionRef to original source/Task ledger,
 * every selected root, held-out namespaces and the single finalized S1. */
export async function runFirstRoundNewTest(ctx:any){
 const [{digest},{executeFirstRoundScreenBranch}]=await Promise.all([import('./task-schema.mjs'),import('./first-round-screen-runtime')]);
 const {task,executionInputs:p,signal}=ctx,c=validateFirstRoundNewTestTask(task,p.contract,p.mode),commonView=c.schema==='ohuo-common-view-new-test-contract-r2';
 if(commonView&&ctx.executionBoundary?.mode!=='input-workload-only')throw Error('new_test_input_workload_boundary_required');
 const expired=()=>!commonView&&performance.now()>=ctx.deadlineMonotonicMs;
 if(typeof p.prepareRoot!=='function')throw Error('new_test_fixed_host_prepare_missing');
 let cp=ctx.checkpoint?structuredClone(ctx.checkpoint):{schema:'ohuo-first-round-new-test-run-v1',taskSHA256:digest(task),selectionRef:c.selectionRef,contractRef:task.scientificContract.decisionRuleRef,...(commonView?{privateWorlds:{}}:{}),rootCursor:0,plans:[],attempts:[],active:null,executionUnknown:false},sequence=ctx.checkpointSequence;
 const save=async()=>ctx.saveCheckpoint(cp,++sequence);
 const summary=()=>{const roots=cp.plans.flatMap((r:any)=>r.readout?[r.readout]:[]),value={schema:'ohuo-first-round-new-test-summary-v1',taskSHA256:digest(task),selectionRef:c.selectionRef,contractRef:cp.contractRef,plans:cp.plans,attempts:cp.attempts,rootCursor:cp.rootCursor,total:c.questionIds.length,active:cp.active,executionUnknown:cp.executionUnknown,readout:summarizeFirstRoundNewTest(c,roots),consumption:ctx.getConsumption()},path=join(task.outputRoot,'first-round-new-test-summary.json'),temporary=path+'.tmp-'+sequence;writeFileSync(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(temporary,path);return{path,sha256:sha(readFileSync(path))};};
 let stopReason='run_boundary';
 try{
  if(!firstRoundEvaluationCheckpoint(cp)||cp.taskSHA256!==digest(task)||cp.selectionRef!==c.selectionRef||cp.contractRef!==task.scientificContract.decisionRuleRef||cp.active||cp.executionUnknown||cp.rootCursor>c.questionIds.length||!commonView&&cp.attempts.length>c.maxBranchStarts)throw Error('execution_uncertain: new-test checkpoint boundary not confirmed');
  if(cp.plans.length<cp.rootCursor||cp.plans.length>Math.min(c.questionIds.length,cp.rootCursor+1))throw Error('new_test_checkpoint_completed_prefix');
  const reservations=new Set();
  for(const a of cp.attempts){const r=cp.plans[a.rootIndex];if(!Number.isSafeInteger(a.rootIndex)||!r||a.reservation===undefined||reservations.has(digest(a.reservation)))throw Error('new_test_checkpoint_attempt_identity');reservations.add(digest(a.reservation));summarizeFirstRoundNewRoot(r.plan,[a.row]);}
  for(let i=0;i<cp.plans.length;i++){
   const r=cp.plans[i];if(r.rootIndex!==i||!equal(questionBinding(r.plan??{}),c.questions[i])||r.plan.s0Ref!==c.s0Ref||r.plan.s1Ref!==c.s1Ref||!c.familyIds.includes(r.plan.familyId)||r.planSHA256!==digest(r.plan))throw Error('new_test_checkpoint_plan_identity');
   const attempts=cp.attempts.filter((a:any)=>a.rootIndex===i),latest=new Map();if(!commonView&&attempts.length>8)throw Error('new_test_checkpoint_root_cap');
   for(const a of attempts){const k=JSON.stringify([a.row.worldId,a.row.actionId]);if(latest.get(k)?.result.complete)throw Error('new_test_checkpoint_completed_branch_restarted');latest.set(k,a.row);}
   const actual=summarizeFirstRoundNewRoot(r.plan,[...latest.values()]);
   if(i<cp.rootCursor&&(actual.status!=='complete'||r.status!=='complete'||!equal(r.readout,actual)))throw Error('new_test_checkpoint_completed_prefix');
  }
  while(cp.rootCursor<c.questionIds.length){
   if(signal.aborted||expired())break;
   const frozen=await p.prepareRoot(cp.rootCursor,commonView?{ctx,worldCheckpoint:cp.privateWorlds?.[cp.rootCursor]??null,onWorldCheckpoint:async(value:any)=>{cp.privateWorlds??={};cp.privateWorlds[cp.rootCursor]=value;await save();}}:undefined),plan=frozen.plan;
   if(!equal(questionBinding(plan??{}),c.questions[cp.rootCursor])||!c.familyIds.includes(plan.familyId)||plan.s0Ref!==c.s0Ref||plan.s1Ref!==c.s1Ref||frozen.planSHA256!==digest(plan))throw Error('new_test_fixed_prepared_root_identity');
   let record=cp.plans.find((r:any)=>r.rootIndex===cp.rootCursor);
   if(record){if(!equal(record.plan,plan)||record.planSHA256!==frozen.planSHA256)throw Error('new_test_prebranch_freeze_changed');}
   else {record={rootIndex:cp.rootCursor,status:'pending',plan,planSHA256:frozen.planSHA256,readout:null};cp.plans.push(record);await save();}
   let paused=false;const results:any[]=[];
   for(const world of plan.worlds)for(const action of plan.actions){
    const attempts=cp.attempts.filter((a:any)=>a.rootIndex===cp.rootCursor&&a.row.worldId===world.worldId&&a.row.actionId===action.actionId),complete=attempts.filter((a:any)=>a.row.result.complete);if(complete.length>1)throw Error('new_test_duplicate_completed_branch');if(complete.length){results.push(complete[0].row);continue;}if(commonView&&attempts.length){results.push(attempts.at(-1).row);paused=true;continue;}
    if(paused||signal.aborted||expired()){paused=true;continue;}
    if(!commonView&&(cp.attempts.length>=c.maxBranchStarts||cp.attempts.filter((a:any)=>a.rootIndex===cp.rootCursor).length>=8)){paused=true;stopReason='new_test_fixed_branch_cap_exhausted';continue;}
    const id='new-test-'+digest({rootCursor:cp.rootCursor,worldId:world.worldId,actionId:action.actionId,attemptCount:cp.attempts.length,executionId:ctx.executionId}),reservation=await ctx.reserve(id,{...zero,matchAttempts:1});
    if(signal.aborted){await ctx.settleReservation(reservation,{disposition:'not_sent',evidence:{kind:'confirmed_not_sent'}});paused=true;continue;}
    cp.active={rootIndex:cp.rootCursor,worldId:world.worldId,actionId:action.actionId,reservation};await save();await ctx.settleReservation(reservation,{disposition:'consumed',evidence:{kind:'match_started'}});
    const row=executeFirstRoundScreenBranch({root:frozen.root,plan,continuation:frozen.continuation,worldId:world.worldId,actionId:action.actionId,deadlineMonotonicMs:ctx.deadlineMonotonicMs,executionBoundary:ctx.executionBoundary,frozenWorlds:frozen.frozenWorlds});cp.attempts.push({rootIndex:cp.rootCursor,reservation,row});cp.active=null;await save();results.push(row);if(!row.result.complete)paused=true;
   }
   record.readout=summarizeFirstRoundNewRoot(plan,results);record.status=record.readout.status;await save();if(paused||record.status==='incomplete')break;cp.rootCursor++;await save();
  }
  return{completed:cp.rootCursor===c.questionIds.length,cleanupConfirmed:true,actualScope:scope,stopReason:signal.aborted?String(signal.reason??'user_stop'):stopReason,artifactRefs:[summary()]};
 }catch(error){if(cp.active)cp.executionUnknown=true;try{await save();}catch{};Object.assign(error as object,{cleanupConfirmed:true,actualScope:scope});throw error;}
}
