/** NAV-R11's one optional cost pilot. Derive its sublimits from the ORIGINAL
 * ledger/run times; do not create another ledger, attempt or timing service.
 * H authenticates context with its private WeakSet before this synchronous
 * function is called inside the existing TC locked admission transaction. */
import {isDeepStrictEqual as equal} from 'node:util';
import {digest,fixedReference,strictObject,fail} from './task-schema.mjs';
const need=(ok:any,reason:string,detail:string)=>{if(!ok)fail('pilot_'+reason,'firstRoundPilotContext',detail);};
const finite=(x:any)=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const int=(x:any)=>Number.isSafeInteger(x)&&x>=0;
const zero=()=>({providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0});
const counters=['providerRequests','optimizerSteps','matchAttempts','labelDecisions'];
const limitKeys={providerRequests:'maxProviderRequests',optimizerSteps:'maxOptimizerSteps',matchAttempts:'maxMatchAttempts',labelDecisions:'maxLabelDecisions'};
const caps={natural:{providerRequests:0,optimizerSteps:0,matchAttempts:12,labelDecisions:0},glm:{providerRequests:16,optimizerSteps:0,matchAttempts:0,labelDecisions:16},ds:{providerRequests:4,optimizerSteps:0,matchAttempts:0,labelDecisions:4},screen:{providerRequests:0,optimizerSteps:0,matchAttempts:192,labelDecisions:0}};
type Segment=keyof typeof caps;
export const checkFirstRoundPilotAdmission=(input:any)=>checkFirstRoundPilot(input,true);
/** Read original settled history without treating an old Task grant as a new
 * request for remaining allowance. All identity/cumulative caps still apply. */
export const checkFirstRoundPilotHistory=(input:any)=>checkFirstRoundPilot(input,false);
function checkFirstRoundPilot({task,state,context}:any,admitting:boolean):{remainingSeconds:number}{
 strictObject(context,'firstRoundPilotContext',['schema','selectionRuleRef','readoutRuleRef','references']);
 need(context.schema==='ohuo-first-round-pilot-context-v1'&&context.selectionRuleRef===task.scientificContract.selectionRuleRef&&context.readoutRuleRef===task.scientificContract.readoutRuleRef&&Array.isArray(context.references)&&context.references.length<=10000,'context_identity','original host built pilot rule/readout references required');
 const refs=new Map<string,any>();for(const entry of context.references){strictObject(entry,'pilotReference',['ref','value']);fixedReference(entry.ref,'pilotReference');need(!refs.has(entry.ref)&&digest(entry.value)===entry.ref.split(':').at(-1),'reference_identity','exact unique immutable catalog values required');refs.set(entry.ref,entry.value);}
 const get=(ref:string)=>{fixedReference(ref,'pilotReference');need(refs.has(ref),'reference_missing','original reference not present in fixed host context');return refs.get(ref);};
 const rule=get(context.selectionRuleRef),cost=get(context.readoutRuleRef);
 need(rule.schema==='ohuo-offline-selection-first-round-pilot-rule-v1'&&rule.purpose==='cost-pilot-only'&&typeof rule.pilotNamespace==='string'&&rule.pilotNamespace.length>0,'rule_identity','only the named optional cost pilot is handled');
 strictObject(cost,'pilotCostContract',['schema','selectionRuleRef','primaryLabelPolicyRef','secondaryLabelPolicyRef','summaryRule','maxActiveSeconds']);
 need(cost.schema==='ohuo-first-round-pilot-cost-contract-v1'&&cost.selectionRuleRef===context.selectionRuleRef&&cost.primaryLabelPolicyRef!==cost.secondaryLabelPolicyRef&&cost.summaryRule==='maximum-completed-operation-wall-seconds'&&cost.maxActiveSeconds===3600,'cost_contract','fixed pilot role identities and 3600 active seconds required');get(cost.primaryLabelPolicyRef);get(cost.secondaryLabelPolicyRef);
 const checkScope=(t:any)=>{
  need(t.planRef===task.planRef&&t.budgetRef===task.budgetRef&&t.authorizationRef===task.authorizationRef&&t.researchBatchId===task.researchBatchId&&t.scientificContract.selectionRuleRef===context.selectionRuleRef&&t.scientificContract.readoutRuleRef===context.readoutRuleRef&&t.sourcePlan.sourceIndexRef===task.sourcePlan.sourceIndexRef&&t.seatLayoutPlan===task.seatLayoutPlan,'original_scope','new plan/budget/namespace/role aliases cannot reset the original pilot');
  const index=get(t.sourcePlan.sourceIndexRef),queue=get(t.seatLayoutPlan);need(index.schema==='ohuo-source-index-ref-v1'&&queue.schema==='ohuo-complete-match-queue-v1'&&queue.sourceIndexRef===t.sourcePlan.sourceIndexRef&&t.sourcePlan.namespace===rule.pilotNamespace&&index.namespace===rule.pilotNamespace&&queue.namespace===rule.pilotNamespace,'namespace','same frozen pilot namespace/index/queue required');
 };
 const classify=(t:any):Segment=>{
  checkScope(t);const cap=get(t.capabilityRef),decision=get(t.scientificContract.decisionRuleRef);let segment:Segment;
  need(t.taskKind==='collect'&&t.operationScope.localExecution===true&&!t.operationScope.parameterUpdates&&!t.operationScope.deployment&&t.learnerRecipe===null,'operation_scope','pilot cannot train/deploy or run another capability');
  if(cap.id==='B07.complete-match.v1')segment='natural';
  else {need(cap.id==='B07.offline-label.v1','capability','only original source/teacher/screen capabilities belong to pilot');
   if(decision.schema==='ohuo-first-round-screen-contract-v1')segment='screen';
   else if(decision.schema==='ohuo-first-round-blind-review-contract-v1'){
    need(decision.batch==='cost-pilot'&&decision.primaryLabelPolicyRef===cost.primaryLabelPolicyRef&&decision.secondaryLabelPolicyRef===cost.secondaryLabelPolicyRef&&t.labelPolicyRef===cost.secondaryLabelPolicyRef,'teacher_role','explicit same pilot DS contract required');segment='ds';
   }else {need(t.labelPolicyRef===cost.primaryLabelPolicyRef,'teacher_role','nonblind labels must use the frozen primary teacher, never inferred by exclusion');segment='glm';}
  }
  need(t.operationScope.apiCalls===(segment==='glm'||segment==='ds'),'operation_scope','actual requested provider scope must match frozen segment');
  for(const k of counters)need(int(t.limits?.[limitKeys[k as keyof typeof limitKeys]]),'task_limits','original finite task operation limits required');
  return segment;
 };
 const currentSegment=classify(task),ledger=state.budgets?.[task.budgetRef];need(ledger&&ledger.planRef===task.planRef&&ledger.authorizationRef===task.authorizationRef&&ledger.researchBatchId===task.researchBatchId&&ledger.reservations,'ledger_identity','same original shared ledger required');
 const pilotRuns=new Map<string,{run:any;segment:Segment}>();let elapsed=0;
 for(const run of Object.values(state.runs??{}) as any[]){const t=run.task;if(!t||t.planRef!==task.planRef&&t.budgetRef!==task.budgetRef&&t.researchBatchId!==task.researchBatchId)continue;
  const priorRule=get(t.scientificContract.selectionRuleRef);if(priorRule.schema!=='ohuo-offline-selection-first-round-pilot-rule-v1'){need(t.sourcePlan.namespace!==rule.pilotNamespace,'untagged_history','an original pilot run cannot hide behind an unrelated selection rule');continue;}
  const segment=classify(t);need(run.runId===t.runId&&state.tasks[t.taskId]===run.runId&&run.taskSHA256===digest(t)&&run.taskRef?.split(':').at(-1)===digest(t)&&finite(run.elapsedSeconds),'run_identity','original immutable Task/run and actual finite cumulative active seconds required');
  if(run.runId===task.runId)need(equal(t,task),'run_identity','same run cannot change its frozen task');
  need(!pilotRuns.has(run.runId),'run_identity','unique original run IDs required');pilotRuns.set(run.runId,{run,segment});elapsed+=run.elapsedSeconds;
 }
 const total={natural:zero(),glm:zero(),ds:zero(),screen:zero()},others={natural:zero(),glm:zero(),ds:zero(),screen:zero()};
 for(const reservation of Object.values(ledger.reservations) as any[]){need(state.runs?.[reservation.runId],'reservation_identity','original reservation run may not disappear');const owner=pilotRuns.get(reservation.runId);if(!owner)continue;
  need(['reserved','reserved_unknown','consumed','committed','released'].includes(reservation.status),'reservation_identity','known original occupancy state required');
  for(const k of counters)need(int(reservation.cost?.[k]),'reservation_identity','finite original operation cost required');if(reservation.status==='released')continue;
  for(const k of counters){total[owner.segment][k as keyof ReturnType<typeof zero>]+=reservation.cost[k];if(reservation.runId!==task.runId)others[owner.segment][k as keyof ReturnType<typeof zero>]+=reservation.cost[k];}
 }
 for(const segment of Object.keys(caps) as Segment[])for(const k of counters)need(total[segment][k as keyof ReturnType<typeof zero>]<=caps[segment][k as keyof ReturnType<typeof zero>],'segment_cap','confirmed/reserved/unknown work consumes the original fixed pilot sublimit');
 if(admitting)for(const k of counters)need(task.limits[limitKeys[k as keyof typeof limitKeys]]<=caps[currentSegment][k as keyof ReturnType<typeof zero>]-others[currentSegment][k as keyof ReturnType<typeof zero>],'segment_cap','new tasks inherit only the segment remainder; same-run cumulative allowance stays with original TC');
 need(finite(elapsed),'elapsed_unknown','unknown elapsed time cannot be estimated as zero');return {remainingSeconds:Math.max(0,3600-elapsed)};
}
