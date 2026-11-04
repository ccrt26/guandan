import {assertScreenRevalidationContext} from './screen-revalidation.mjs';
import {readFirstRoundAllocation,firstRoundStageRemaining} from './first-round-budget.mjs';
import {isFirstRoundRecipe,FIRST_ROUND_RECIPE} from './first-round-contract.mjs';
import {readFileSync,writeFileSync,renameSync,realpathSync,existsSync,mkdirSync,lstatSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {TaskError,fail,canonical,digest,fixedReference,strictObject,validateIdentifier,validateTask,taskReferences,COUNTERS,LIMITS,validateLimits,validateCost,isWorkloadLimits,isScientificObservationLimits,validateResourcePolicy} from './task-schema.mjs';
import {selectConsumer} from './task-consumer.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const activeStatuses=['preparing','running','stopping'];
const zeros=()=>Object.fromEntries(COUNTERS.map(k=>[k,0]));
const stateVersion=1;
function safeRoot(path){
 const root=resolve(path),base=resolve(ROOT,'lab/out'),rel=relative(base,root);
 if(!rel||rel.startsWith('..')||rel.includes(`..${sep}`)||!existsSync(root)||realpathSync(root)!==root)fail('invalid_output_root','stateRoot','existing nonsymlink directory below project lab/out required');
 return root;
}
function atomic(path,value){
 const temporary=`${path}.tmp-${process.pid}-${randomUUID()}`;
 writeFileSync(temporary,`${canonical(value)}\n`,{flag:'wx'});renameSync(temporary,path);
}
function checkStateFile(path){
 if(existsSync(path)&&lstatSync(path).isSymbolicLink())fail('state_invalid','stateRoot','ledger symlink forbidden');
 if(!existsSync(path))fail('budget_state_missing','stateRoot','pre-existing verified root ledger required; missing consumption is never initialized to zero');
}
function readState(path){
 checkStateFile(path);
 let state;try{state=JSON.parse(readFileSync(path,'utf8'));}catch(e){fail('state_invalid','stateRoot',e.message);}
 if(state?.schemaVersion!==stateVersion||!state.tasks||!state.runs||!state.budgets||!state.batches)fail('state_invalid','stateRoot','incomplete committed state');
 return state;
}
function ledgerFor(state,task){
 const binding=state.batches[task.researchBatchId];
 if(!binding||binding.budgetRef!==task.budgetRef||binding.authorizationRef!==task.authorizationRef||binding.planRef!==task.planRef)fail('budget_binding_conflict','budgetRef','batch must use original budget and authorization');
 const ledger=state.budgets[task.budgetRef];
 if(!ledger||ledger.researchBatchId!==task.researchBatchId||ledger.authorizationRef!==task.authorizationRef||ledger.planRef!==task.planRef)fail('budget_state_missing','budgetRef','original shared ledger is unavailable');
 validateLimits(ledger.limits,'budget.limits');validateCost(ledger.used);
 if(!ledger.reservations||typeof ledger.reservations!=='object'||!Object.hasOwn(ledger,'activeRunId')||!Number.isFinite(ledger.elapsedSeconds)||ledger.elapsedSeconds<0)fail('state_invalid','budgetRef','missing occupancy/time/ownership');
 for(const r of Object.values(ledger.reservations)){validateCost(r.cost);if(!['reserved','reserved_unknown','committed','consumed','released'].includes(r.status)||typeof r.runId!=='string')fail('state_invalid','budget.reservations','invalid reservation');}
 return ledger;
}
function budgetView(ledger,limits=ledger.limits,resourcePolicy=null){
 const reserved=zeros(),reservedUnknown=zeros(),released=zeros();
 for(const r of Object.values(ledger.reservations))for(const k of COUNTERS){if(r.status==='reserved_unknown')reservedUnknown[k]+=r.cost[k];else if(r.status==='reserved')reserved[k]+=r.cost[k];else if(r.status==='released')released[k]+=r.cost[k];}
 if(resourcePolicy)return {accountingMode:ledger.accountingMode??'offline_synthetic',counterMeaning:ledger.accountingMode==='research'?'confirmed local operations/upstream invocations; not provider billing':'synthetic control events, not real upstream calls or scientific work',resourcePolicy,originalBudgetLimits:ledger.limits,used:ledger.used,reserved,reservedUnknown,released,elapsedSeconds:ledger.elapsedSeconds};
 for(const k of COUNTERS)if(ledger.used[k]+reserved[k]+reservedUnknown[k]>ledger.limits[LIMITS[k]])fail('state_invalid','budget','recorded consumption exceeds approved allocation');
 return {accountingMode:ledger.accountingMode??'offline_synthetic',counterMeaning:ledger.accountingMode==='research'?'confirmed local operations/upstream invocations; not provider billing':'synthetic control events, not real upstream calls or scientific work',approvedTotal:limits,used:ledger.used,reserved,reservedUnknown,released,remaining:Object.fromEntries(COUNTERS.map(k=>[k,ledger.limits[LIMITS[k]]-ledger.used[k]-reserved[k]-reservedUnknown[k]])),elapsedSeconds:ledger.elapsedSeconds};
}
function runConsumption(ledger,runId){
 const result={confirmed:zeros(),reserved:zeros(),reservedUnknown:zeros(),released:zeros()};
 for(const reservation of Object.values(ledger.reservations))if(reservation.runId===runId){
  const target=['committed','consumed'].includes(reservation.status)?result.confirmed:reservation.status==='released'?result.released:reservation.status==='reserved_unknown'?result.reservedUnknown:result.reserved;
  for(const key of COUNTERS)target[key]+=reservation.cost[key];
 }
 return result;
}
const errorResult=e=>({status:'rejected',reason:e.reason??'control_error',field:e.field??null,detail:e.message});

/** Explicit host construction performs no I/O until dispatch. No arbitrary
 * execution path, shell text, legacy CLI import or auto-zero budget exists.
 * adapter is trusted host code, never deserialized from TaskFile:
 * resolveRef -> exact JSON content, checkAuthorization -> independently verified
 * original authorization, checkPlan -> current closeout + prerequisites/branch,
 * verifyInputs -> actual code/runtime/policy/data/source identities and path.
 */
export function createTaskController({root,adapter=null,consumers=[],screenRevalidation=null}){
 const handles=new Map();let normalized;
 const location=()=>{normalized??=safeRoot(root);return normalized;};
 if(screenRevalidation)assertScreenRevalidationContext(screenRevalidation,screenRevalidation.task,location());
 const storage=()=>screenRevalidation?safeRoot(screenRevalidation.storageRoot):location();
 const output=task=>screenRevalidation?screenRevalidation.outputRoot:task.outputRoot;
 const statePath=()=>join(storage(),'state.json');
 const allocationFor=(ledger,budgetRef)=>readFirstRoundAllocation({root:location(),budgetRef,ledger});
 const limitsFor=(ledger,budgetRef)=>allocationFor(ledger,budgetRef)?.effectiveLimits??ledger.limits;
 const policyFor=(ledger,budgetRef,state,pending=null)=>{
  if(!Object.hasOwn(ledger,'resourcePolicy')){if(Object.hasOwn(ledger,'resourcePolicyContinuations'))fail('resource_policy_conflict','resourcePolicyContinuations','original policy cannot be removed');return null;}
  const scoped=policy=>{const p=validateResourcePolicy(policy),v=p.value;if(v.planRef!==ledger.planRef||v.budgetRef!==budgetRef||v.authorizationRef!==ledger.authorizationRef||v.controlRoot!==location())fail('resource_policy_conflict','resourcePolicy','registered policy must retain the original root/plan/budget/authority');return p;};
  let current=scoped(ledger.resourcePolicy);const seen=new Set([current.ref]);
  if(Object.hasOwn(ledger,'resourcePolicyContinuations')){
   if(!Array.isArray(ledger.resourcePolicyContinuations))fail('resource_policy_conflict','resourcePolicyContinuations','original ordered continuation records required');
   for(const row of ledger.resourcePolicyContinuations){strictObject(row,'resourcePolicyContinuation',['previousPolicyRef','policy','admittedTaskRef','admittedRunId','previousLedgerSHA256']);fixedReference(row.admittedTaskRef,'admittedTaskRef');validateIdentifier(row.admittedRunId,'admittedRunId');const next=scoped(row.policy);
    if(row.previousPolicyRef!==current.ref||seen.has(next.ref)||typeof row.previousLedgerSHA256!=='string'||!/^[a-f0-9]{64}$/.test(row.previousLedgerSHA256))fail('resource_policy_conflict','resourcePolicyContinuations','one append-only original policy chain required');const run=state.runs[row.admittedRunId],t=run?.task??(row===ledger.resourcePolicyContinuations.at(-1)&&pending?.task.runId===row.admittedRunId?pending.task:null),taskRef=run?.taskRef??pending?.taskRef;
    if(!t||taskRef!==row.admittedTaskRef||digest(t)!==row.admittedTaskRef.split(':').at(-1)||t.runId!==row.admittedRunId||t.budgetRef!==budgetRef||t.planRef!==ledger.planRef||t.authorizationRef!==ledger.authorizationRef||t.scientificContract.analysisMethodRef!==next.value.protocolRevisionRef||run&&(run.taskSHA256!==digest(t)||state.tasks[t.taskId]!==run.runId)||!run&&state.tasks[t.taskId]!==undefined)fail('resource_policy_conflict','resourcePolicyContinuations','continuation must retain its actual admitted immutable Task');
    seen.add(next.ref);current=next;
   }
  }
  if(ledger.firstRoundAllocation)fail('resource_policy_conflict','allocation','record-only policy cannot reinterpret an existing allocation receipt');return current;
 };
 async function transact(fn,writeWhen=null){
  const path=statePath();checkStateFile(path);
  let release;try{const {acquireSourceWriter}=await import('./writer-lock.ts');release=acquireSourceWriter(path);}catch(e){if(e instanceof TaskError)throw e;fail('control_busy','stateRoot',e.message);}
  try{const s=readState(path);const result=fn(s);if(result instanceof Promise)fail('control_error','','state transaction must remain synchronous');if(writeWhen===null||writeWhen(result))atomic(path,s);return result;}finally{release();}
 }
 function snapshot(runId){
  const s=readState(statePath()),r=s.runs[runId];if(!r)fail('unknown_run','runId','run is not registered');
   const ledger=ledgerFor(s,r.task),policy=policyFor(ledger,r.task.budgetRef,s);const copy=JSON.parse(canonical(r));
   return {...copy,observationStatus:r.cleanupConfirmed===false||(activeStatuses.includes(r.status)&&!handles.has(runId))?'unknown':'confirmed',sharedBudget:budgetView(ledger,policy?ledger.limits:limitsFor(ledger,r.task.budgetRef),policy),consumption:runConsumption(ledger,runId),artifactRefs:[{path:statePath(),purpose:'current committed state and shared budget'},...(r.checkpointRef?[{path:r.checkpointRef,purpose:'immutable committed consumer checkpoint',sha256:r.checkpointSHA256}]:[]),...(r.consumerArtifactRefs??[])]};
 }
 async function resolveReference(ref){
  fixedReference(ref,'reference');if(!adapter?.resolveRef)fail('reference_unavailable','reference','no fixed-reference adapter installed');
  let value;try{value=await adapter.resolveRef(ref);}catch(e){fail('reference_unavailable',ref,e.message);}
  if(value===undefined||digest(value)!==ref.slice(ref.lastIndexOf(':')+1))fail('reference_identity_mismatch',ref,'content does not match frozen SHA256');return value;
 }
 async function preflight(task){
  if(screenRevalidation?.observationOnly)fail('revalidation_observation_only','action','status/stop context cannot execute');
  if(screenRevalidation)assertScreenRevalidationContext(screenRevalidation,task,location());
  if(task.taskStatus!=='ready'||task.unresolved.length)fail('task_not_ready','taskStatus','draft/blocked/unresolved cannot execute');
  const capability=await resolveReference(task.capabilityRef),consumer=selectConsumer(task,capability,consumers);
  const refs=new Map();for(const ref of new Set(taskReferences(task)))refs.set(ref,await resolveReference(ref));
  if(!adapter?.checkAuthorization)fail('authorization_unverified','authorizationRef','independent authorization verifier required');
  let authorization;try{authorization=await adapter.checkAuthorization(task,refs);}catch(e){fail('authorization_unverified','authorizationRef',e.message);}
  if(!authorization||authorization.authorizationRef!==task.authorizationRef||authorization.controlRoot!==location()||authorization.mode!==consumer.mode)fail('authorization_unverified','authorizationRef','TaskFile is not an authorization grant');
  for(const [k,v] of Object.entries(task.operationScope))if(v&&authorization.scope?.[k]!==true)fail('scope_not_authorized',`operationScope.${k}`,'requested operation not independently authorized');
  await planCheck(task,refs);
  if(!adapter?.verifyInputs)fail('input_identity_unverified','sourceRevision','code/runtime/policy/dataset/source verification missing');
  let inputs;try{inputs=await adapter.verifyInputs(task,refs);}catch(e){fail('input_identity_unverified','sourceRevision',e.message);}
  if(!inputs||inputs.sourceIdentity!==task.sourcePlan.sourceIndexRef||!inputs.sourceIndexPath||!existsSync(inputs.sourceIndexPath))fail('input_identity_unverified','sourcePlan','actual source index or frozen execution inputs unavailable');
  // verifyInputs owns semantic source-family/split validation using the existing
  // source-index interface. B06 only locks the real verified index; it never
  // imports protocol.ts (which loads research dependencies) or invents an index.
  let resourcePolicy=null;
  if(isWorkloadLimits(task.limits)){
   resourcePolicy=validateResourcePolicy(authorization.resourcePolicy);const v=resourcePolicy.value;
   if(v.planRef!==task.planRef||v.budgetRef!==task.budgetRef||v.authorizationRef!==task.authorizationRef||v.controlRoot!==location()||v.protocolRevisionRef!==task.scientificContract.analysisMethodRef)fail('resource_policy_conflict','resourcePolicy','new Task must bind the exact approved method and original scope');
  }else if(authorization.resourcePolicy)fail('resource_policy_conflict','limits','record-only authority cannot reinterpret a legacy Task as new work');
  const budget=refs.get(task.budgetRef);
  if(budget.controlRoot!==location()||budget.authorizationRef!==task.authorizationRef||budget.researchBatchId!==task.researchBatchId||budget.planRef!==task.planRef)fail('budget_binding_conflict','budgetRef','budget reference does not bind original root/batch/authorization');
  validateLimits(budget.limits,'budget.limits');
  const allocation=allocationFor(ledgerFor(readState(statePath()),task),task.budgetRef);
  if(typeof adapter?.resolveFirstRoundAllocation==='function'){if(canonical(await adapter.resolveFirstRoundAllocation(task,budget))!==canonical(allocation))fail('authorization_unverified','allocation','fixed host must verify original allocation facts and grant');}else if(allocation)fail('authorization_unverified','allocation','allocated research requires the fixed host verifier');
  if(resourcePolicy&&allocation)fail('resource_policy_conflict','allocation','new protocol does not freeze or reuse a legacy allocation');
  const effectiveLimits=allocation?.effectiveLimits??budget.limits;
  if(!resourcePolicy&&isFirstRoundRecipe(task.learnerRecipe)&&budget.limits.maxOptimizerSteps>FIRST_ROUND_RECIPE.maxSharedOptimizerSteps)fail('budget_binding_conflict','budget.limits.maxOptimizerSteps','first-round attempts share at most 130 submitted or unknown updates');
  if(resolve(task.outputRoot)!==join(location(),'runs',task.runId))fail('invalid_output_root','outputRoot','run output must be this root/runs/runId');
  const prepareStarted=performance.now(),executionInputs=consumer.prepare?await consumer.prepare({task,refs,inputs}):null;screenRevalidation?.recordTiming?.('consumer.prepare',prepareStarted);
  if(resourcePolicy){
   if(inputs.inputWorkload!==undefined&&executionInputs?.inputWorkload!==undefined&&canonical(inputs.inputWorkload)!==canonical(executionInputs.inputWorkload))fail('input_identity_unverified','inputWorkload','host and fixed consumer workload differ');
   const w=inputs.inputWorkload??executionInputs?.inputWorkload;
   if(isScientificObservationLimits(task.limits)){strictObject(w,'inputWorkload',['mode','providerRequests','matchAttempts','labelDecisions']);if(w.mode!=='scientific-observation-v1'||['providerRequests','matchAttempts','labelDecisions'].some(k=>w[k]!==0))fail('input_identity_unverified','inputWorkload','trusted scientific learner scope required');}
   else{validateCost(w);for(const k of COUNTERS)if(w[k]!==task.limits[LIMITS[k]])fail('input_identity_unverified','inputWorkload','Task counts must equal the actually verified frozen inputs');}
  }
  return {consumer,refs,authorization,inputs,budget,effectiveLimits,allocation,executionInputs,resourcePolicy};
 }
 async function planCheck(task,refs){
  const timingStarted=performance.now();
  if(adapter?.productionPlanClosure===true){const prior=readState(statePath()).hostPlanObservations?.[canonical([task.planRef,task.planVersion])];if(prior&&['completed','terminated'].includes(prior.status))fail('plan_closed','planScope','original plan has a durable closed observation');}
  if(!adapter?.checkPlan)fail('plan_unverified','planScope','current closeout and prerequisites verifier required');
  let plan;try{plan=await adapter.checkPlan(task,refs);}catch(e){if(adapter?.productionPlanClosure===true&&e instanceof TaskError)throw e;fail('plan_unverified','planRef',e.message);}
  if(!plan||!['incomplete','completed','terminated'].includes(plan.status))fail('plan_unverified','planRef','known planCloseout required');
  if(adapter?.productionPlanClosure===true){
   const o=plan.hostObservation;strictObject(o,'hostObservation',['planRef','planVersion','revision','closeoutSHA256','status']);
   if(o.planRef!==task.planRef||o.planVersion!==task.planVersion||o.status!==plan.status||!Number.isSafeInteger(o.revision)||o.revision<1||!/^[a-f0-9]{64}$/.test(o.closeoutSHA256))fail('plan_unverified','hostObservation','current fixed plan identity differs');
   const {status:result}=await transact(s=>{
    const key=canonical([task.planRef,task.planVersion]),prior=s.hostPlanObservations?.[key];
    if(prior&&['completed','terminated'].includes(prior.status))return {status:'closed',changed:false};
    if(prior&&(o.revision<prior.revision||o.revision===prior.revision&&o.closeoutSHA256!==prior.closeoutSHA256))return {status:'rollback',changed:false};
    const changed=!prior||prior.revision!==o.revision||prior.closeoutSHA256!==o.closeoutSHA256||prior.status!==o.status;
    if(changed)(s.hostPlanObservations??={})[key]={revision:o.revision,closeoutSHA256:o.closeoutSHA256,status:o.status};
    return {status:o.status==='incomplete'?null:'closed',changed};
   },result=>result.changed);
   if(result==='closed')fail('plan_closed','planScope','original plan is closed');if(result==='rollback')fail('plan_state_conflict','planScope','current closeout revision cannot roll back or change in place');
  }
  if(plan.status!=='incomplete')fail('plan_closed','planRef','closed plan cannot start/resume new computation');
  if(plan.eligible!==true)fail('prerequisites_missing','planScope',JSON.stringify(plan.missing??['eligibility not verified']));
  screenRevalidation?.recordTiming?.('planCheck',timingStarted);
 }
 function checkAdmissions(task,state,pre,pending=null){
  if(screenRevalidation)assertScreenRevalidationContext(screenRevalidation,task,location());
  let pilotRemainingSeconds;
  const registered=policyFor(ledgerFor(state,task),task.budgetRef,state,pending);
  if(pre.resourcePolicy){if(!registered||canonical(registered)!==canonical(pre.resourcePolicy))fail('resource_policy_conflict','resourcePolicy','every new work boundary requires the same registered policy');if(Object.values(ledgerFor(state,task).reservations).some(r=>r.status==='reserved_unknown'))fail('execution_uncertain','budgetRef','unresolved invocation or update must not be bypassed by another revised Task');}
  else if(registered)fail('resource_policy_conflict','limits','legacy execution cannot restart under the revised record-only policy');
  if(pre.inputs.firstRoundPilotContext||pre.refs.get(task.scientificContract.selectionRuleRef)?.schema==='ohuo-offline-selection-first-round-pilot-rule-v1'){
   if(pre.resourcePolicy)fail('resource_policy_conflict','pilot','old pilot cannot be restarted as revised work');
   if(!pre.inputs.firstRoundPilotContext||typeof adapter?.checkFirstRoundPilotAdmission!=='function')fail('input_identity_unverified','firstRoundPilotContext','named pilot requires the fixed synchronous host admission adapter');
   const result=adapter.checkFirstRoundPilotAdmission(task,state,pre.inputs.firstRoundPilotContext);
   if(!result||typeof result.then==='function'||!Number.isFinite(result.remainingSeconds)||result.remainingSeconds<0||result.remainingSeconds>3600)fail('input_identity_unverified','firstRoundPilotContext','original finite cumulative pilot remainder required');
   if(result.remainingSeconds<=0)fail('run_boundary','firstRoundPilotContext','the original 3600 active-second pilot allowance is exhausted');
   pilotRemainingSeconds=result.remainingSeconds;
  }
  const numeric=pre.inputs.numericalRecoveryContext;
  if(numeric||pre.inputs.numericalRestart?.schema==='ohuo-verified-numerical-recovery-v1'){
   if(!numeric||typeof adapter?.checkBranchAdmission!=='function')fail('branch_evidence_unverified','numericalRecoveryContext','fixed synchronous host role adapter required');
   const result=adapter.checkBranchAdmission(task,state,numeric);
   if(result&&typeof result.then==='function')fail('control_error','checkBranchAdmission','locked role admission must be synchronous');
   if(result?.admitted!==true)fail(result?.branch?.reason??'numerical_role_not_admitted','numericalRecoveryContext','role admission is separate from global branch status');
  }
  if(pre.inputs.probeAdmissionContext){
   if(typeof adapter?.checkProbeAdmission!=='function')fail('input_identity_unverified','probeAdmissionContext','fixed probe inventory adapter required');
   const result=adapter.checkProbeAdmission(task,state,pre.inputs.probeAdmissionContext);if(result!==true)fail('probe_configuration_conflict','probeAdmissionContext','locked original probe inventory not admitted');
  }
  if(pre.inputs.offlineSelection||pre.inputs.offlineSelectionAdmissionContext){
   if(!pre.inputs.offlineSelectionAdmissionContext||typeof adapter?.checkOfflineSelectionAdmission!=='function')fail('input_identity_unverified','offlineSelectionAdmissionContext','fixed synchronous selection binding adapter required');
   const result=adapter.checkOfflineSelectionAdmission(task,state,pre.inputs.offlineSelectionAdmissionContext);if(result!==true)fail('selection_task_binding','offlineSelectionAdmissionContext','locked original selection binding not admitted');
  }
  if(pre.allocation){const current=allocationFor(ledgerFor(state,task),task.budgetRef);if(canonical(current)!==canonical(pre.allocation))fail('budget_identity_mismatch','allocation','allocation changed after fixed preflight');const remaining=firstRoundStageRemaining({state,task,receipt:current});if(remaining<=0)fail('run_boundary','stageSeconds','original stage cumulative allowance exhausted');pilotRemainingSeconds=Math.min(pilotRemainingSeconds??Infinity,remaining);}
  return pilotRemainingSeconds;
 }
 function validateResume(r,consumer){
  if(r.checkpoint!==null&&(digest(r.checkpoint)!==r.checkpointSHA256||consumer.validateCheckpoint(r.checkpoint)!==true||r.checkpointRef!==join(output(r.task),`checkpoint-${r.checkpointSHA256}.json`)||!existsSync(r.checkpointRef)||lstatSync(r.checkpointRef).isSymbolicLink()||digest(JSON.parse(readFileSync(r.checkpointRef,'utf8')))!==r.checkpointSHA256))fail('checkpoint_identity_mismatch','checkpoint','complete committed consumer checkpoint required');
  if(r.checkpoint===null&&r.committed.length)fail('checkpoint_missing','checkpoint','cannot restore committed progress from weights/defaults');
  if(digest(r.task)!==r.taskSHA256||r.taskRef.slice(r.taskRef.lastIndexOf(':')+1)!==r.taskSHA256||!existsSync(join(output(r.task),'task.json'))||digest(JSON.parse(readFileSync(join(output(r.task),'task.json'),'utf8')))!==r.taskSHA256)fail('task_conflict','task','persisted frozen TaskFile changed');
 }
 async function launch(task,taskRef,taskSHA256,pre,resuming){
  const {acquireSourceWriter}=await import('./writer-lock.ts');
  let releaseSource,reuseRunId=null,reconcileOnly=false,reconciliationBaseline=null,pilotRemainingSeconds=Infinity;
  const mirrorRefs=()=>Object.fromEntries(['latest.json','status.json','summary.json'].map(name=>{const path=join(output(task),name);if(!existsSync(path))return[name,null];if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())fail('recovery_mirror_invalid','mirror','regular original-run mirror required');return[name,{path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}];}));
  const researchBoundary=(r,ledger)=>({used:ledger.used,reservations:ledger.reservations,committed:r.committed,checkpoint:r.checkpoint,checkpointSHA256:r.checkpointSHA256,checkpointRef:r.checkpointRef,checkpointSequence:r.checkpointSequence??null,runElapsedSeconds:r.elapsedSeconds,budgetElapsedSeconds:ledger.elapsedSeconds});
  try{
   await transact(s=>{
    const existing=s.runs[s.tasks[task.taskId]];
    if(!resuming&&existing){if(existing.taskSHA256!==taskSHA256)fail('task_conflict','taskId','same ID has different content');reuseRunId=existing.runId;return;}
    if(resuming&&existing&&activeStatuses.includes(existing.status)){reuseRunId=existing.runId;return;}
    const ledger=ledgerFor(s,task);
    if(pre.resourcePolicy){const current=policyFor(ledger,task.budgetRef,s);if(!current){if(resuming||allocationFor(ledger,task.budgetRef))fail('resource_policy_conflict','resourcePolicy','only the first newly admitted Task can register the approved policy');ledger.resourcePolicy=JSON.parse(canonical(pre.resourcePolicy));}else if(canonical(current)!==canonical(pre.resourcePolicy)){
     // Continue the approved method on this original ledger, never reset it or
     // reinterpret a persisted Task. The initial policy remains byte-identical.
     if(resuming||screenRevalidation||typeof adapter?.checkResourcePolicyContinuation!=='function')fail('resource_policy_conflict','resourcePolicy','only a new Task with original host continuation verification may advance policy');
     if(ledger.activeRunId!==null||Object.values(ledger.reservations).some(r=>['reserved','reserved_unknown'].includes(r.status))||Object.values(s.runs).some(r=>r.task?.budgetRef===task.budgetRef&&(activeStatuses.includes(r.status)||r.cleanupConfirmed===false||r.executionUnknown===true||r.observationStatus==='unknown'||r.stopReason==='execution_uncertain'||r.failureReason==='execution_uncertain')))fail('execution_uncertain','resourcePolicy','all original ownership and uncertain work must remain reconciled');
     if(s.runs[task.runId]||Object.values(s.runs).some(r=>r.task.experimentId===task.experimentId&&r.task.attemptId===task.attemptId))fail('resource_policy_conflict','resourcePolicy','continuation must be attached to a genuinely new original Task attempt');
     const verified=adapter.checkResourcePolicyContinuation(task,s,current,pre.resourcePolicy);if(verified!==true)fail('resource_policy_conflict','resourcePolicy','synchronous original host method continuation required');
     const previousLedgerSHA256=digest(ledger);(ledger.resourcePolicyContinuations??=[]).push({previousPolicyRef:current.ref,policy:JSON.parse(canonical(pre.resourcePolicy)),admittedTaskRef:taskRef,admittedRunId:task.runId,previousLedgerSHA256});
    }}
    const pilotRemaining=checkAdmissions(task,s,pre,resuming?null:{task,taskRef});if(pilotRemaining!==undefined)pilotRemainingSeconds=pilotRemaining;
    if(ledger.accountingMode&&ledger.accountingMode!==pre.consumer.mode)fail('budget_mode_conflict','budgetRef','cannot mix research and synthetic accounting');ledger.accountingMode=pre.consumer.mode;if(canonical(ledger.limits)!==canonical(pre.budget.limits))fail('budget_identity_mismatch','budgetRef','ledger limits differ from frozen approved allocation');
    if(ledger.activeRunId!==null)fail('budget_busy','budgetRef','active ownership has not reached confirmed terminal/release');
    let r=s.runs[task.runId];
    if(!resuming){
     if(s.tasks[task.taskId])fail('task_conflict','taskId','another start already registered this task; retry same intent');
     if(r)fail('run_conflict','runId','run identity already exists');
     if(Object.values(s.runs).some(x=>x.task.experimentId===task.experimentId&&x.task.attemptId===task.attemptId))fail('attempt_conflict','attemptId','attempt identity cannot be reused');
     if(task.parentTaskId!==null){
      const parent=s.runs[s.tasks[task.parentTaskId]];if(!parent)fail('parent_task_missing','parentTaskId','registered prior attempt required');
      for(const k of ['researchBatchId','budgetRef','authorizationRef'])if(parent.task[k]!==task[k])fail('budget_binding_conflict',k,'retry must inherit original root scope');
      if(parent.task.attemptId===task.attemptId)fail('attempt_conflict','attemptId','derived retry needs a distinct attempt');
      const science=t=>Object.fromEntries(['parentPolicyRef','releaseRefs','rulesRef','sourcePlan','splitRefs','seatLayoutPlan','actorSampleRule','datasetRefs','labelPolicyRef','promptRef','scientificContract','learnerRecipe'].map(k=>[k,t[k]]));
      if(parent.task.experimentId===task.experimentId&&canonical(science(parent.task))!==canonical(science(task)))fail('experiment_identity_conflict','experimentId','changed scientific conditions need a new identity and verified plan scope');
     }
     const runsDir=join(storage(),'runs');if(existsSync(runsDir)&&lstatSync(runsDir).isSymbolicLink())fail('invalid_output_root','outputRoot','symlink forbidden');
     if(existsSync(output(task)))fail('output_exists','outputRoot','cannot overwrite prior output');
     r={runId:task.runId,taskRef,taskSHA256,task,...(screenRevalidation?{engineeringRevalidation:{requestSHA256:screenRevalidation.requestSHA256,executionSourceRef:screenRevalidation.sourceRef,purpose:'engineering-only-no-scientific-reuse',physicalOutputRoot:output(task)}}:{}),status:'preparing',resolvedScope:pre.authorization.scope,actualScope:null,checkpoint:null,checkpointSHA256:null,checkpointRef:null,committed:[],elapsedSeconds:0,stopReason:null,failureReason:null,owner:{token:randomUUID(),pid:process.pid},createdAt:new Date().toISOString()};
    }else{
     if(!r)fail('unknown_run','runId','registered original run required');validateResume(r,pre.consumer);
     if(Object.values(ledger.reservations).some(x=>x.runId===task.runId&&['reserved','reserved_unknown'].includes(x.status)))fail('execution_uncertain','budgetRef','unknown occupancy cannot be refunded/replayed');
    }
    const remaining=pre.resourcePolicy?null:budgetView(ledger);
    const timeExhausted=!pre.resourcePolicy&&(r.elapsedSeconds>=task.limits.maxRunSeconds||ledger.elapsedSeconds>=limitsFor(ledger,task.budgetRef).maxRunSeconds);
    const allowanceExhausted=remaining!==null&&!Object.entries(remaining.remaining).some(([k,v])=>v>0&&task.limits[LIMITS[k]]>0);
    const supervised=pre.consumer.id==='B10.supervised-rerank.v1'&&pre.consumer.kind==='supervised_training'&&task.taskKind==='supervised_training';
    const confirmedSteps=runConsumption(ledger,task.runId).confirmed.optimizerSteps;
    const taskStepsExhausted=supervised&&!isScientificObservationLimits(task.limits)&&confirmedSteps>=task.limits.maxOptimizerSteps;
    if(timeExhausted&&isFirstRoundRecipe(task.learnerRecipe))fail('run_boundary','limits.maxRunSeconds','first-round active time is exhausted; mirror repair cannot launch computation');
    if(timeExhausted||allowanceExhausted||taskStepsExhausted){
     // REC-1 repairs mirrors of this already committed run only. It is not an
     // extension of training/API/time allowance or a generic resume escape.
     reconcileOnly=Boolean(resuming&&supervised&&r.cleanupConfirmed===true&&r.checkpoint?.schema==='ohuo-supervised-run-v1'&&r.checkpoint.taskSHA256===taskSHA256&&r.checkpoint.optimizerSteps===confirmedSteps&&!Object.values(ledger.reservations).some(x=>['reserved','reserved_unknown'].includes(x.status)));
     if(!reconcileOnly)fail('run_boundary',timeExhausted?'limits.maxRunSeconds':'limits','original cumulative allowance exhausted');
    }
    try{releaseSource=acquireSourceWriter(pre.inputs.sourceIndexPath);}catch(e){fail('source_busy','sourcePlan.sourceIndexRef',e.message);}
    if(!resuming){mkdirSync(output(task),{recursive:true});writeFileSync(join(output(task),'task.json'),canonical(task),{flag:'wx'});s.tasks[task.taskId]=task.runId;s.runs[task.runId]=r;}
    if(reconcileOnly)reconciliationBaseline={boundary:JSON.parse(canonical(researchBoundary(r,ledger))),consumption:runConsumption(ledger,task.runId),mirrors:mirrorRefs()};
    r.status='running';r.stopReason=null;r.failureReason=null;r.owner={token:randomUUID(),pid:process.pid};r.lastStartedAt=new Date().toISOString();ledger.activeRunId=task.runId;
   });
  }catch(e){releaseSource?.();throw e;}
  if(reuseRunId)return snapshot(reuseRunId);
  const abort=new AbortController(),started=performance.now();
  const handle={abort,done:null};handles.set(task.runId,handle);
  const assertMutable=()=>{if(reconcileOnly)fail('reconcile_read_only','consumer','checkpoint mirror reconciliation cannot reserve, commit, settle or save new state');};
  const reserve=async(key,cost)=>{
   assertMutable();
   if(abort.signal.aborted)fail('run_boundary','stop','run is stopping');
   await planCheck(task,pre.refs);
   return transact(s=>{
    checkAdmissions(task,s,pre);
    const r=s.runs[task.runId],ledger=ledgerFor(s,task);
    if(r.status!=='running'||ledger.activeRunId!==task.runId)fail('run_boundary','runId','run no longer owns active budget');
    if(!pre.resourcePolicy&&(r.elapsedSeconds+(performance.now()-started)/1000>=task.limits.maxRunSeconds||ledger.elapsedSeconds+(performance.now()-started)/1000>=limitsFor(ledger,task.budgetRef).maxRunSeconds||(performance.now()-started)/1000>=pilotRemainingSeconds))fail('run_boundary','limits.maxRunSeconds','wall-clock boundary reached before new work');
    validateCost(cost);if(typeof key!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(key))fail('invalid_reservation','reservationId','stable bounded consumer key required');
    const reservationId=`${task.runId}:${key}`;if(ledger.reservations[reservationId])fail('duplicate_reservation','reservationId','cannot resend an already reserved/committed action');
    const all=Object.values(ledger.reservations),view=pre.resourcePolicy?null:budgetView(ledger);
    for(const k of COUNTERS){const runUsed=all.filter(x=>x.runId===task.runId&&x.status!=='released').reduce((n,x)=>n+x.cost[k],0);if(view&&cost[k]>view.remaining[k]||!(isScientificObservationLimits(task.limits)&&k==='optimizerSteps')&&runUsed+cost[k]>task.limits[LIMITS[k]])fail('run_boundary',`limits.${LIMITS[k]}`,'task input workload or legacy shared budget exhausted');}
    ledger.reservations[reservationId]={runId:task.runId,key,cost,status:'reserved',at:new Date().toISOString()};return reservationId;
   });
  };
  const commit=async(reservationId,newCheckpoint)=>{assertMutable();return transact(s=>{
   const r=s.runs[task.runId],ledger=ledgerFor(s,task),reservation=ledger.reservations[reservationId];
   if(!reservation||reservation.runId!==task.runId)fail('reservation_missing','reservationId','must reserve before consumer action');
   const checkpointSHA256=digest(newCheckpoint);
   if(reservation.status==='committed'){if(reservation.checkpointSHA256!==checkpointSHA256)fail('checkpoint_conflict','checkpoint','duplicate commit with different content');return;}
   if(reservation.status!=='reserved'||!['running','stopping'].includes(r.status))fail('execution_uncertain','reservationId','cannot commit unknown execution');
   if(pre.consumer.validateCheckpoint(newCheckpoint)!==true)fail('checkpoint_invalid','checkpoint','consumer rejected incomplete state');
   const checkpointRef=join(output(task),`checkpoint-${checkpointSHA256}.json`);
   if(existsSync(checkpointRef)){if(lstatSync(checkpointRef).isSymbolicLink()||readFileSync(checkpointRef,'utf8')!==canonical(newCheckpoint))fail('checkpoint_conflict','checkpoint','immutable checkpoint artifact changed');}
   else writeFileSync(checkpointRef,canonical(newCheckpoint),{flag:'wx'});
   reservation.status='committed';reservation.checkpointSHA256=checkpointSHA256;for(const k of COUNTERS)ledger.used[k]+=reservation.cost[k];
   r.checkpoint=JSON.parse(canonical(newCheckpoint));r.checkpointSHA256=checkpointSHA256;r.checkpointRef=checkpointRef;r.committed.push(reservationId);
  });};
  // B07 separates confirmed consumption from a committed recovery boundary.
  // Every transition is persisted under the same existing source/budget owner.
  const settleReservation=async(reservationId,settlement)=>{assertMutable();return transact(s=>{
   strictObject(settlement,'settlement',['disposition','evidence']);
   if(!['consumed','not_sent','unknown'].includes(settlement.disposition))fail('invalid_settlement','disposition','fixed disposition required');
   strictObject(settlement.evidence,'settlement.evidence',['kind']);
   const allowed={consumed:['upstream_invoked','match_started'],not_sent:['confirmed_not_sent'],unknown:['execution_unknown']};
   if(!allowed[settlement.disposition].includes(settlement.evidence.kind))fail('invalid_settlement','evidence','explicit matching evidence required');
   const r=s.runs[task.runId],ledger=ledgerFor(s,task),reservation=ledger.reservations[reservationId];
   if(!reservation||reservation.runId!==task.runId)fail('reservation_missing','reservationId','owned reservation required');
   const status={consumed:'consumed',not_sent:'released',unknown:'reserved_unknown'}[settlement.disposition];
   if(reservation.status!=='reserved'){
    if(reservation.status===status&&canonical(reservation.settlement)===canonical(settlement))return;
    fail('settlement_conflict','reservationId','a settled or unknown operation cannot be refunded/replayed');
   }
   if(!['running','stopping'].includes(r.status)||ledger.activeRunId!==task.runId)fail('ownership_unconfirmed','reservationId','only the active owner can settle');
   reservation.status=status;reservation.settlement=JSON.parse(canonical(settlement));
   if(status==='consumed'){for(const k of COUNTERS)ledger.used[k]+=reservation.cost[k];r.committed.push(reservationId);}
  });};
  const saveCheckpoint=async(newCheckpoint,sequence)=>{assertMutable();return transact(s=>{
   const r=s.runs[task.runId],ledger=ledgerFor(s,task),sha=digest(newCheckpoint),previous=r.checkpointSequence??0;
   if(!Number.isSafeInteger(sequence)||sequence<1)fail('checkpoint_conflict','sequence','positive integer required');
   if(sequence===previous){if(r.checkpointSHA256===sha)return;fail('checkpoint_conflict','checkpoint','same sequence differs');}
   if(sequence!==previous+1||!['running','stopping'].includes(r.status)||ledger.activeRunId!==task.runId)fail('checkpoint_conflict','sequence','only the current owner may append one boundary');
   if(pre.consumer.validateCheckpoint(newCheckpoint)!==true)fail('checkpoint_invalid','checkpoint','consumer rejected incomplete state');
   const checkpointRef=join(output(task),`checkpoint-${sha}.json`);
   if(existsSync(checkpointRef)){if(lstatSync(checkpointRef).isSymbolicLink()||readFileSync(checkpointRef,'utf8')!==canonical(newCheckpoint))fail('checkpoint_conflict','checkpoint','immutable checkpoint changed');}
   else writeFileSync(checkpointRef,canonical(newCheckpoint),{flag:'wx'});
   r.checkpoint=JSON.parse(canonical(newCheckpoint));r.checkpointSHA256=sha;r.checkpointRef=checkpointRef;r.checkpointSequence=sequence;
  });};
  const timer=setInterval(()=>{
   try{const s=readState(statePath()),r=s.runs[task.runId],ledger=ledgerFor(s,task);if(pre.resourcePolicy&&canonical(policyFor(ledger,task.budgetRef,s))!==canonical(pre.resourcePolicy))throw Error('registered resource policy changed');if(r.status==='stopping')abort.abort('user_stop');else if(!pre.resourcePolicy&&(r.elapsedSeconds+(performance.now()-started)/1000>=task.limits.maxRunSeconds||ledger.elapsedSeconds+(performance.now()-started)/1000>=limitsFor(ledger,task.budgetRef).maxRunSeconds||(performance.now()-started)/1000>=pilotRemainingSeconds))abort.abort('run_boundary');}catch{abort.abort('lost_ownership');}
  },25);
  handle.done=(async()=>{
   let outcome,error;try{
    const startState=readState(statePath()),run=startState.runs[task.runId],ledger=startState.budgets[task.budgetRef];
    if(run.status==='stopping')abort.abort('user_stop');
    outcome=await pre.consumer.run({task:JSON.parse(canonical(task)),outputRoot:output(task),...(screenRevalidation?{engineeringRevalidation:{requestSHA256:screenRevalidation.requestSHA256,executionSourceRef:screenRevalidation.sourceRef,purpose:'engineering-only-no-scientific-reuse'}}:{}),checkpoint:run.checkpoint,checkpointSequence:run.checkpointSequence??0,executionId:run.owner.token,signal:abort.signal,reconcileOnly,reserve,commit,settleReservation,saveCheckpoint,executionInputs:pre.executionInputs,getConsumption:()=>snapshot(task.runId).consumption,...(pre.resourcePolicy?{executionBoundary:{mode:'input-workload-only',resourcePolicyRef:pre.resourcePolicy.ref}}:{deadlineMonotonicMs:started+1000*Math.min(task.limits.maxRunSeconds-run.elapsedSeconds,pre.effectiveLimits.maxRunSeconds-ledger.elapsedSeconds,pilotRemainingSeconds)})});if(outcome?.cleanupConfirmed!==true)fail('ownership_unconfirmed','consumer','consumer did not confirm owned-process cleanup');
   }catch(e){error=e;}
   clearInterval(timer);
   const cleanupConfirmed=outcome?.cleanupConfirmed===true||error?.cleanupConfirmed===true;
   try{
    await transact(s=>{
     const r=s.runs[task.runId],ledger=ledgerFor(s,task),seconds=(performance.now()-started)/1000;
     if(reconcileOnly){
      if(canonical(researchBoundary(r,ledger))!==canonical(reconciliationBaseline.boundary))fail('recovery_research_mutation','consumer','mirror-only path changed historical research boundary');
      const directory=join(output(task),'recovery-receipts');if(existsSync(directory)&&(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()))fail('recovery_receipt_invalid','outputRoot','owned regular receipt directory required');mkdirSync(directory,{recursive:true,mode:0o700});
      // Legacy mirror repair retains its historical immutable-time contract.
      // First-round repair is still active owned computation: charge it even
      // on failure, without changing optimizer/reservation/checkpoint facts.
      const activeTimeCharged=isFirstRoundRecipe(task.learnerRecipe);
      if(activeTimeCharged){r.elapsedSeconds+=seconds;ledger.elapsedSeconds+=seconds;}
      const receiptId=randomUUID(),path=join(directory,`${r.checkpointSHA256}-${receiptId}.json`),afterConsumption=runConsumption(ledger,task.runId);
      const receipt={schema:activeTimeCharged?'ohuo-checkpoint-reconciliation-first-round-v1':'ohuo-checkpoint-reconciliation-v1',...(activeTimeCharged?{activeTimeCharged:true}:{}),receiptId,runId:task.runId,taskRef:r.taskRef,taskSHA256:r.taskSHA256,checkpointRef:r.checkpointRef,checkpointSHA256:r.checkpointSHA256,sourceRevision:task.sourceRevision,runtimeRef:task.runtimeRef,planRef:task.planRef,planVersion:task.planVersion,recoveryWallSeconds:seconds,mirrorsBefore:reconciliationBaseline.mirrors,mirrorsAfter:mirrorRefs(),consumptionBefore:reconciliationBaseline.consumption,consumptionAfter:afterConsumption,researchBoundaryBeforeSHA256:digest(reconciliationBaseline.boundary),researchBoundaryAfterSHA256:digest(researchBoundary(r,ledger)),optimizerStepIncrement:afterConsumption.confirmed.optimizerSteps-reconciliationBaseline.consumption.confirmed.optimizerSteps,providerRequestIncrement:afterConsumption.confirmed.providerRequests-reconciliationBaseline.consumption.confirmed.providerRequests,cleanupConfirmed,status:error?'failed':cleanupConfirmed?'reconciled':'cleanup_unknown',reason:error?.reason??error?.message??null};
      const bytes=canonical(receipt);writeFileSync(path,bytes,{flag:'wx',mode:0o600});r.recoveryReceiptRefs=[...(r.recoveryReceiptRefs??[]),{path,sha256:createHash('sha256').update(bytes).digest('hex')}];
     }else{
      r.elapsedSeconds+=seconds;ledger.elapsedSeconds+=seconds;
      for(const v of Object.values(ledger.reservations))if(v.runId===task.runId&&v.status==='reserved')v.status='reserved_unknown';
     }
     const boundary=error&&['run_boundary','plan_closed','prerequisites_missing'].includes(error.reason),unknown=Object.values(ledger.reservations).some(v=>v.runId===task.runId&&v.status==='reserved_unknown');
     r.status=error?(boundary?'interrupted':'failed'):outcome.completed&&!unknown?'completed':'interrupted';r.failureReason=error&&!boundary?error.reason??error.message:null;
     r.stopReason=boundary?error.reason:error?null:unknown?'execution_uncertain':outcome.completed?null:r.stopReason??outcome.stopReason??'run_boundary';const actual=outcome?.actualScope??error?.actualScope??null;r.actualScope=actual?Object.fromEntries(Object.keys(task.operationScope).map(k=>[k,Boolean(actual[k]||r.actualScope?.[k])])):r.actualScope??null;r.consumerArtifactRefs=outcome?.artifactRefs??r.consumerArtifactRefs??[];r.endedAt=new Date().toISOString();r.cleanupConfirmed=cleanupConfirmed;r.ownedCleanup=outcome?.ownedCleanup??error?.ownedCleanup??null;
     if(cleanupConfirmed){releaseSource();ledger.activeRunId=null;}
    });
   }finally{handles.delete(task.runId);}
  })();
  // Keep settlement failures observable. Never reclaim an unknown active owner.
  handle.done.catch(()=>{});
  return snapshot(task.runId);
 }
 async function dispatchOhuo(action,request){
  try{
   if(!['start','status','stop','resume'].includes(action))fail('unsupported_action','action','only start/status/stop/resume');
   strictObject(request,'request',[action==='start'?'taskRef':'runId']);
   if(action!=='start')validateIdentifier(request.runId,'request.runId');
   if(action==='start'){
    const task=validateTask(await resolveReference(request.taskRef)),taskSHA256=digest(task);
    if(task.taskStatus!=='ready'||task.unresolved.length)fail('task_not_ready','taskStatus','draft/blocked/unresolved cannot execute');
    if(!consumers.length)fail('capability_planned','capabilityRef','B06 CLI has no scientific consumers or trusted research authorization/input adapters; no work started');
    const s=readState(statePath()),existing=s.runs[s.tasks[task.taskId]];
    if(existing){if(existing.taskSHA256!==taskSHA256)fail('task_conflict','taskId','same taskId carries different frozen content');return snapshot(existing.runId);}
    // Bind before preflight so a new task/attempt cannot swap budgets to reset consumption.
    allocationFor(ledgerFor(s,task),task.budgetRef);const pre=await preflight(task);return await launch(task,request.taskRef,taskSHA256,pre,false);
   }
   const current=snapshot(request.runId);
   if(action==='status')return current;
   if(action==='stop'){
    if(!activeStatuses.includes(current.status))return current;
    await transact(s=>{const r=s.runs[request.runId];if(activeStatuses.includes(r.status)){r.status='stopping';r.stopReason='requested_stop';}});
    const handle=handles.get(request.runId);if(handle){handle.abort.abort('user_stop');await handle.done;}
    return snapshot(request.runId);
   }
   if(current.status==='completed')return current;
   if(activeStatuses.includes(current.status))return current;
   const task=validateTask(current.task),pre=await preflight(task);validateResume(current,pre.consumer);
   return await launch(task,current.taskRef,current.taskSHA256,pre,true);
  }catch(e){return errorResult(e);}
 }
 // Fixed production CLI checks closure before constructing model/worker hosts.
 // Not a TaskFile action; ordinary/synthetic controllers cannot use this hook.
 const assertCurrentPlan=async task=>{if(adapter?.productionPlanClosure!==true)fail('host_adapter_missing','plan','fixed production adapter required');validateTask(task);allocationFor(ledgerFor(readState(statePath()),task),task.budgetRef);await planCheck(task,new Map());};
 const waitForRun=async runId=>{if(handles.has(runId))await handles.get(runId).done;return snapshot(runId);};
 return {dispatchOhuo,assertCurrentPlan,waitForRun};
}
