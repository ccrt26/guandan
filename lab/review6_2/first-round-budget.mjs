/** NAV-R11 mechanical one-time allocation. No new budget, authority or runner. */
import {readFileSync,writeFileSync,renameSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {canonical,digest,fixedReference,strictObject,validateLimits,fail} from './task-schema.mjs';
const need=(ok,detail)=>{if(!ok)fail('first_round_allocation_invalid','allocation',detail);};
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const nonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// llm-select awaits complete consumeText before these parseSelection refusals.
// They are completed operations, not successful labels; transport/cancel stay out.
const completedSelectionRefusals=new Set(['invalid_response_json','invalid_response_shape','decision_id_mismatch','action_id_not_offered','expansion_disabled_for_candidate_spec','expansion_already_used','group_id_not_expandable']);
const stages=['pilot','data','training','newTest','variancePilot','confirmation'];
export const firstRoundAllocationPath=root=>join(root,'first-round-allocation.json');
export function firstRoundAllocationSeconds(costs){
 strictObject(costs,'costs',['match','branch','glm','ds','step']);need(Object.values(costs).every(positive),'all five completed costs must be finite positive, never missing/zero');
 const {match:m,branch:b,glm:g,ds:d,step:s}=costs,ceil=Math.ceil;
 const result={maxRunSeconds:ceil(3600+2*(192*m+512*b+48*g+8*d+130*s)),stages:{pilot:3600,data:ceil(2*(24*m+384*b+32*g+4*d)),training:ceil(2*130*s),newTest:ceil(2*(24*m+128*b+16*g+4*d)),variancePilot:ceil(2*48*m),confirmation:ceil(2*96*m)}};
 need(Number.isSafeInteger(result.maxRunSeconds)&&Object.values(result.stages).every(Number.isSafeInteger),'computed finite seconds exceed safe integer');return result;
}
function regular(path){need(existsSync(path)&&lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink()&&realpathSync(path)===path,'original regular nonsymlink allocation artifact required');return readFileSync(path);}
function stageMap(stageClauses){
 strictObject(stageClauses,'stageClauses',stages);const map=new Map();
 for(const stage of stages){need(Array.isArray(stageClauses[stage])&&stageClauses[stage].length>0&&stageClauses[stage].length<=100,'bounded original action clauses required');for(const ref of stageClauses[stage]){fixedReference(ref,'stageClause');need(!map.has(ref),'one original action belongs to one resource stage');map.set(ref,stage);}}
 return map;
}
export function readFirstRoundAllocation({root,budgetRef,ledger}){
 const path=firstRoundAllocationPath(root),pointer=ledger.firstRoundAllocation;
 if(!pointer){if(existsSync(path))fail('first_round_allocation_pending','allocation','immutable freeze exists without pointer; reconcile same request before work');return null;}
 strictObject(pointer,'allocationPointer',['requestRef','sha256']);fixedReference(pointer.requestRef,'requestRef');const bytes=regular(path);need(sha(bytes)===pointer.sha256,'immutable receipt bytes differ from original ledger pointer');
 const receipt=JSON.parse(bytes);strictObject(receipt,'allocationReceipt',['schema','requestRef','ruleRef','planRef','planVersion','budgetRef','authorizationRef','researchBatchId','controlRoot','rootInstanceId','approvalEvidence','beforeStateSHA256','baselineLimits','effectiveLimits','costs','stageSeconds','stageClauses','evidence']);
 need(receipt.schema==='ohuo-first-round-budget-allocation-v1'&&receipt.requestRef===pointer.requestRef&&receipt.budgetRef===budgetRef&&receipt.controlRoot===root&&receipt.planRef===ledger.planRef&&receipt.authorizationRef===ledger.authorizationRef&&receipt.researchBatchId===ledger.researchBatchId&&equal(receipt.baselineLimits,ledger.limits),'original allocation scope/baseline differs');
 validateLimits(receipt.baselineLimits);validateLimits(receipt.effectiveLimits);const calculated=firstRoundAllocationSeconds(receipt.costs);stageMap(receipt.stageClauses);
 need(receipt.baselineLimits.maxRunSeconds===3600&&equal(receipt.effectiveLimits,{...receipt.baselineLimits,maxRunSeconds:calculated.maxRunSeconds})&&equal(receipt.stageSeconds,calculated.stages),'only original fixed formula can allocate time');return receipt;
}
export function firstRoundStageRemaining({state,task,receipt}){
 if(!receipt)return Infinity;
 need(state.rootInstanceId===receipt.rootInstanceId&&task.planRef===receipt.planRef&&task.planVersion===receipt.planVersion&&task.budgetRef===receipt.budgetRef&&task.authorizationRef===receipt.authorizationRef&&task.researchBatchId===receipt.researchBatchId,'original allocated Task/root required');
 const map=stageMap(receipt.stageClauses),stage=map.get(task.planScope.clauseRef);need(stage&&stage!=='pilot','pilot is ended and only frozen original stage clauses may run');let elapsed=0;
 for(const run of Object.values(state.runs).sort((a,b)=>a.runId<b.runId?-1:a.runId>b.runId?1:0)){
  const t=run.task;if(t?.planRef!==task.planRef&&t?.budgetRef!==task.budgetRef&&t?.researchBatchId!==task.researchBatchId)continue;
  need(t.planRef===task.planRef&&t.budgetRef===task.budgetRef&&t.authorizationRef===task.authorizationRef&&t.researchBatchId===task.researchBatchId&&run.taskSHA256===digest(t)&&run.taskRef?.split(':').at(-1)===digest(t)&&state.tasks[t.taskId]===run.runId&&run.runId===t.runId&&nonnegative(run.elapsedSeconds),'original stage history/elapsed cannot disappear or become unknown');
  const original=map.get(t.planScope.clauseRef);need(original,'all original tasks must retain their frozen stage');if(original===stage)elapsed+=run.elapsedSeconds;
 }
 need(task.limits.maxRunSeconds<=receipt.stageSeconds[stage],'Task cannot exceed its fixed stage allocation');need(nonnegative(elapsed),'stage cumulative elapsed must remain known');return Math.max(0,receipt.stageSeconds[stage]-elapsed);
}
export function assertFirstRoundAllocationStopped(state,budgetRef){
 const ledger=state.budgets?.[budgetRef];need(ledger&&ledger.activeRunId===null,'original shared owner must be released');need(Object.values(ledger.reservations??{}).every(r=>!['reserved','reserved_unknown'].includes(r.status)),'all reserved/unknown occupancy must be reconciled');
 for(const run of Object.values(state.runs??{}))need(['completed','failed','interrupted'].includes(run.status)&&run.cleanupConfirmed===true&&run.executionUnknown!==true&&run.observationStatus!=='unknown'&&run.checkpoint?.executionUnknown!==true&&run.checkpoint?.active==null&&nonnegative(run.elapsedSeconds)&&run.stopReason!=='execution_uncertain'&&run.failureReason!=='execution_uncertain','all original runs must be safely stopped with known active time');
 need(nonnegative(ledger.elapsedSeconds),'shared elapsed must remain known');return ledger;
}
/** host supplies only its verified fixed files/proof; this function owns the
 * original state lock and pointer transaction, not a second ledger. */
export async function freezeFirstRoundBudget(host,requestRef){
 fixedReference(requestRef,'requestRef');
 const observed=host.checkExistingRoot(),intent=host.resolveRef(requestRef),prior=observed.budgets?.[intent.budgetRef];
 if(prior?.firstRoundAllocation){const receipt=readFirstRoundAllocation({root:host.root,budgetRef:intent.budgetRef,ledger:prior});need(receipt.requestRef===requestRef,'a different second allocation request is forbidden');await host.verifyFirstRoundBudgetAllocation(receipt,observed);return {status:'reused',receipt,path:firstRoundAllocationPath(host.root)};}
 const {acquireSourceWriter}=await import('./writer-lock.ts'),path=join(host.root,'state.json'),release=acquireSourceWriter(path);
 try{
  const state=host.checkExistingRoot(),request=host.resolveRef(requestRef),ledger=state.budgets?.[request.budgetRef];need(ledger,'original budget required');
  if(ledger.firstRoundAllocation){const receipt=readFirstRoundAllocation({root:host.root,budgetRef:request.budgetRef,ledger});need(receipt.requestRef===requestRef,'a different second allocation request is forbidden');await host.verifyFirstRoundBudgetAllocation(receipt,state);return {status:'reused',receipt,path:firstRoundAllocationPath(host.root)};}
  assertFirstRoundAllocationStopped(state,request.budgetRef);
  const receipt=await host.prepareFirstRoundBudgetAllocation(requestRef,state),receiptPath=firstRoundAllocationPath(host.root),bytes=canonical(receipt);
  // Every validation above is read-only. An orphan receipt can only complete
  // the same exact request with the same pre-state; it can never be replaced.
  if(existsSync(receiptPath))need(regular(receiptPath).toString()===bytes,'pending original receipt/request/pre-state differs');
  else writeFileSync(receiptPath,bytes,{flag:'wx',mode:0o600});
  ledger.firstRoundAllocation={requestRef,sha256:sha(bytes)};
  const temporary=path+'.tmp-'+process.pid+'-'+randomUUID();writeFileSync(temporary,canonical(state),{flag:'wx',mode:0o600});renameSync(temporary,path);
  return {status:'allocated',receipt,path:receiptPath};
 }finally{release();}
}

/** Explicitly permitted B10 finite one-step check, not arbitrary JSON values. */
export function firstRoundFiniteStepSeconds({accepted,checks,checksSHA256}){
 need(accepted.schemaVersion===1&&accepted.kind==='functional-acceptance'&&accepted.functionalStatus==='accepted'&&accepted.batchId==='S35'&&accepted.revision===3&&checks.schemaVersion===1&&checks.batchId==='S35'&&checks.revision===3&&checks.status==='passed'&&accepted.checkReceiptRefs?.some(r=>r.sha256===checksSHA256)&&equal(accepted.acceptedCodeRef,checks.sourceRef),'original accepted S35/B10 finite check must bind exact source/check receipt');
 const matches=checks.results?.filter(r=>r.checkId==='S35.training.finite-step-reload'&&r.caseId==='training.finite-step-reload')??[];need(matches.length===1,'one original finite-step check required');const r=matches[0];
 need(r.executionMode==='executed'&&r.status==='passed'&&r.exitCode===0&&r.actual?.error===null&&r.actual?.signal===null,'successful actually executed finite check required');
 let report;try{report=JSON.parse(r.actual.stdout.trim());}catch{need(false,'one original finite-check stdout JSON required');}
 need(report.checkId==='training.finite-step-reload'&&report.status==='passed'&&report.sameCaptureFixture===true&&report.realAPI===false&&report.realTraining===false&&report.python?.caseId==='training.finite-step-reload'&&report.python.finiteUpdates===1&&report.python.datasetEligible===false&&report.python.realTraining===false&&report.python.optimizerExact===true&&report.python.fullCheckpointExact===true&&report.python.resumeNextBatchExact===true,'accepted one-step save/reload fixture identity required');
 const seconds=(Date.parse(r.endedAt)-Date.parse(r.startedAt))/1000;need(positive(seconds),'original finite-check timestamps required');return seconds;
}
export async function prepareFirstRoundBudgetAllocation(host,requestRef,state,verifyExisting=false){
 const request=host.resolveRef(requestRef),{grant,rule}=host.readFirstRoundBudgetAuthority(request,verifyExisting),budget=host.resolveRef(request.budgetRef),savedBytes=host.evidenceBytes(request.controlStateRef),saved=JSON.parse(savedBytes.toString());
 need(equal(saved,state),'frozen pre-state must equal the original locked live ledger/history');const ledger=assertFirstRoundAllocationStopped(state,request.budgetRef);
 need(state.rootInstanceId===host.manifest.rootInstanceId&&budget.controlRoot===host.root&&budget.planRef===request.planRef&&budget.authorizationRef===grant.authorizationRef&&equal(budget.limits,ledger.limits)&&ledger.accountingMode==='research'&&equal(state.batches?.[budget.researchBatchId],{budgetRef:request.budgetRef,authorizationRef:budget.authorizationRef,planRef:budget.planRef}),'one original research root/budget/batch binding required');
 need(Object.keys(state.budgets).length===1&&ledger.limits.maxRunSeconds===3600&&ledger.limits.maxProviderRequests<=76&&ledger.limits.maxMatchAttempts<=908&&ledger.limits.maxOptimizerSteps<=130,'original pilot baseline and unchanged round count caps required');
 const proof=await host.readFirstRoundPilotProduction(request.pilotSelectionRef),queue=host.resolveRef(proof.spec.queueRef),pilotRule=host.resolveRef(rule.pilotSelectionRuleRef),costRule=host.resolveRef(rule.pilotReadoutRuleRef);
 need(proof.production.verification==='reproduced'&&proof.budgetRef===request.budgetRef&&proof.spec.planRef===request.planRef&&proof.spec.selectionRuleRef===rule.pilotSelectionRuleRef&&pilotRule.schema==='ohuo-offline-selection-first-round-pilot-rule-v1'&&costRule.schema==='ohuo-first-round-pilot-cost-contract-v1'&&costRule.selectionRuleRef===rule.pilotSelectionRuleRef&&costRule.summaryRule==='maximum-completed-operation-wall-seconds'&&costRule.maxActiveSeconds===3600,'original reproduced pilot selection/cost proof required');
 const inventory=proof.sourceInventory;need(Array.isArray(inventory)&&inventory.length===12&&inventory.every(r=>r.status==='completed')&&queue.rows?.length===12,'original two-family six-layout complete source production required');
 const families=new Map();for(const row of queue.rows){const layouts=families.get(row.sourceFamilyId)??new Set();need(!layouts.has(row.layoutId),'pilot source layout duplicated');layouts.add(row.layoutId);families.set(row.sourceFamilyId,layouts);}need(families.size===2&&[...families.values()].every(s=>s.size===6),'exact original two families times six layouts required');
 const samples={match:[],branch:[],glm:[],ds:[]},evidence={controlStateRef:request.controlStateRef,pilotSelectionRef:request.pilotSelectionRef,checkpoints:[],labelTerminals:[],stepFallback:request.stepFallback,dsFallback:request.dsFallback,initialGrantRef:request.initialGrantRef};let elapsed=0;
 const map=stageMap(rule.stageClauses);
 for(const run of Object.values(state.runs).sort((a,b)=>a.runId<b.runId?-1:a.runId>b.runId?1:0)){
  const task=run.task;need(task&&task.planRef===request.planRef&&task.planVersion===request.planVersion&&task.budgetRef===request.budgetRef&&task.authorizationRef===grant.authorizationRef&&task.researchBatchId===budget.researchBatchId&&map.get(task.planScope.clauseRef)==='pilot'&&task.scientificContract.selectionRuleRef===rule.pilotSelectionRuleRef&&task.scientificContract.readoutRuleRef===rule.pilotReadoutRuleRef&&task.sourcePlan.sourceIndexRef===proof.spec.sourceIndexRef&&task.seatLayoutPlan===proof.spec.queueRef&&run.taskSHA256===digest(task)&&run.taskRef?.split(':').at(-1)===digest(task)&&equal(host.resolveRef(run.taskRef),task)&&state.tasks[task.taskId]===run.runId&&task.runId===run.runId&&task.outputRoot===join(host.root,'runs',run.runId),'only unchanged original pilot Tasks may precede freeze');
  need(digest(JSON.parse(regular(join(task.outputRoot,'task.json'))))===digest(task),'original immutable Task file differs');elapsed+=run.elapsedSeconds;
  const context=host.firstRoundPilotContext(task);need(context,'authenticated original pilot context required');host.checkFirstRoundPilotHistory(task,state,context);
  const cp=run.checkpoint;if(!cp)continue;need(run.checkpointSHA256===digest(cp)&&run.checkpointRef===join(task.outputRoot,'checkpoint-'+digest(cp)+'.json')&&digest(JSON.parse(regular(run.checkpointRef)))===digest(cp)&&cp.taskSHA256===digest(task),'original committed pilot checkpoint required');evidence.checkpoints.push({runId:run.runId,path:run.checkpointRef,sha256:sha(regular(run.checkpointRef))});
  const capability=host.resolveRef(task.capabilityRef),decision=host.resolveRef(task.scientificContract.decisionRuleRef);
  const confirmed={providerRequests:0,matchAttempts:0};for(const reservation of Object.values(ledger.reservations))if(reservation.runId===run.runId&&['consumed','committed'].includes(reservation.status))for(const key of Object.keys(confirmed))confirmed[key]+=reservation.cost[key];
  if(capability.id==='B07.complete-match.v1'){
   need(cp.schema==='ohuo-match-run-v1'&&cp.queueRef===proof.spec.queueRef&&cp.matches.length<=confirmed.matchAttempts,'original metered natural-match checkpoint required');for(const m of cp.matches)if(m.result.complete===true){need(positive(m.result.wallSeconds),'completed natural match timing missing');samples.match.push(m.result.wallSeconds);}
  }else if(decision.schema==='ohuo-first-round-screen-contract-v1'){
   need(cp.schema==='ohuo-first-round-screen-run-v1'&&cp.selectionRef===request.pilotSelectionRef&&cp.attempts.length<=confirmed.matchAttempts,'original metered screen checkpoint required');for(const a of cp.attempts)if(a.row.result.complete===true){need(positive(a.row.result.activeSeconds),'completed branch timing missing');samples.branch.push(a.row.result.activeSeconds);}
  }else{
   need(capability.id==='B07.offline-label.v1'&&cp.schema==='ohuo-offline-label-run-v1'&&cp.selectionRef===request.pilotSelectionRef,'original teacher checkpoint required');const role=task.labelPolicyRef===costRule.primaryLabelPolicyRef?'glm':task.labelPolicyRef===costRule.secondaryLabelPolicyRef?'ds':null;need(role,'original explicit teacher role required');
   let completedRequests=0;for(let i=0;i<cp.rows.length;i++){const row=cp.rows[i],path=join(task.outputRoot,'labels','q'+i+'.json');need(row.resultRef.path===path,'original teacher terminal path required');const bytes=regular(path);need(sha(bytes)===row.resultRef.sha256,'original teacher terminal SHA differs');const terminal=JSON.parse(bytes);need(terminal.schema==='ohuo-offline-label-result-v1'&&terminal.selectionRef===request.pilotSelectionRef&&terminal.inputSHA256===row.inputSHA256&&equal(terminal.key,row.key)&&terminal.status===row.status&&terminal.teacher.releaseRef===host.resolveRef(task.labelPolicyRef).releaseRef,'original terminal/selection/teacher binding required');evidence.labelTerminals.push({path,sha256:sha(bytes)});
    const remote=terminal.remote,completedRefusal=remote?.status==='remote_failure'&&completedSelectionRefusals.has(remote.reason)&&Number.isInteger(remote.attempts?.[0]?.httpStatus)&&remote.attempts[0].httpStatus>=200&&remote.attempts[0].httpStatus<300;
    if(remote?.status==='selected'||completedRefusal){need(remote.requestCount===1&&remote.attempts?.length===1&&remote.attempts[0].requestCount===1&&positive(remote.attempts[0].elapsedMs),'one completed original request with actual elapsed required');samples[role].push(remote.attempts[0].elapsedMs/1000);completedRequests++;}
   }
   need(completedRequests<=confirmed.providerRequests,'completed teacher samples must be metered in the original ledger');
  }
 }
 need(nonnegative(elapsed)&&elapsed<=ledger.elapsedSeconds&&elapsed<=3600,'original pilot cumulative active time must remain in 3600-second bound');
 strictObject(request.stepFallback,'stepFallback',['kind','acceptedRef','checksRef']);need(request.stepFallback.kind==='accepted-S35-finite-step-reload','only explicitly permitted accepted finite check fallback');const step=firstRoundFiniteStepSeconds({accepted:JSON.parse(host.evidenceBytes(request.stepFallback.acceptedRef).toString()),checks:JSON.parse(host.evidenceBytes(request.stepFallback.checksRef).toString()),checksSHA256:request.stepFallback.checksRef.sha256});
 // A missing historical DS duration never becomes a caller-supplied estimate.
 if(!samples.ds.length)fail('first_round_cost_unavailable','t_DS','no completed pilot DS request or supported original successful timed receipt');need(request.dsFallback===null,'unused DS fallback must be null');
 for(const key of Object.keys(samples))need(samples[key].length>0,'completed original '+key+' cost unavailable');
 const costs={match:Math.max(...samples.match),branch:Math.max(...samples.branch),glm:Math.max(...samples.glm),ds:Math.max(...samples.ds),step},calculated=firstRoundAllocationSeconds(costs),effectiveLimits={...ledger.limits,maxRunSeconds:calculated.maxRunSeconds};
 need(equal(grant.limits,effectiveLimits),'original independently materialized grant must match actual computed finite limits');
 return {schema:'ohuo-first-round-budget-allocation-v1',requestRef,ruleRef:request.ruleRef,planRef:request.planRef,planVersion:request.planVersion,budgetRef:request.budgetRef,authorizationRef:budget.authorizationRef,researchBatchId:budget.researchBatchId,controlRoot:host.root,rootInstanceId:state.rootInstanceId,approvalEvidence:grant.approvalEvidence,beforeStateSHA256:sha(savedBytes),baselineLimits:structuredClone(ledger.limits),effectiveLimits,costs,stageSeconds:calculated.stages,stageClauses:rule.stageClauses,evidence};
}
export async function verifyFirstRoundBudgetAllocation(host,receipt,state){
 const request=host.resolveRef(receipt.requestRef),before=JSON.parse(host.evidenceBytes(request.controlStateRef).toString());
 const expected=await prepareFirstRoundBudgetAllocation(host,receipt.requestRef,before,true);need(equal(receipt,expected),'immutable allocation no longer matches original facts/authority');
 const old=before.budgets[receipt.budgetRef],current=state.budgets[receipt.budgetRef];need(current&&current.elapsedSeconds>=old.elapsedSeconds&&equal(current.limits,old.limits)&&equal(state.batches,before.batches)&&state.rootInstanceId===before.rootInstanceId,'original shared cumulative boundary cannot reset');for(const k of Object.keys(old.used))need(current.used[k]>=old.used[k],'pilot counters cannot reset');
 for(const [id,value] of Object.entries(old.reservations))need(equal(current.reservations[id],value),'settled pilot reservation cannot be altered');for(const [id,value] of Object.entries(before.runs))need(equal(state.runs[id],value)&&state.tasks[value.task.taskId]===id,'original pilot run/history cannot be altered');return receipt;
}
