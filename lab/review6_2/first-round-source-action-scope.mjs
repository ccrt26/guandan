/** NAV-R11: keep the whole CURRENT source action in inventory without requiring
 * future S1/cost-bound Tasks before their artifacts exist. No run or sampling. */
import {fixedReference,strictObject,validateIdentifier,fail} from './task-schema.mjs';
const stages=['pilot','formal','newTest','variancePilot','confirmation'];
const need=(ok,detail)=>{if(!ok)fail('planned_source_task_unavailable','plannedTaskIds',detail);};
const sameAction=(t,a)=>t.planScope?.clauseRef===a.clauseRef&&t.planScope?.branchRef===a.branchRef;
export function verifySourceActionInventory({spec,references,actions,tasks}){
 const rule=references.get(spec.selectionRuleRef);
 const commonView=rule?.schema==='ohuo-offline-selection-common-view-r2',firstRound=['ohuo-offline-selection-common-view-r2','ohuo-offline-selection-first-round-rule-v1','ohuo-offline-selection-first-round-pilot-rule-v1'].includes(rule?.schema);
 const candidates=id=>[...references].filter(([,t])=>t?.schemaVersion===1&&t.planRef===spec.planRef&&t.taskId===id);
 if(!firstRound){
  // Exact pre-existing all-plan rule for every legacy selector.
  for(const action of actions)if(action.expectedArtifactKinds.includes('ohuo-match-summary-v1')||tasks.some(x=>sameAction(x.task,action)))for(const id of action.plannedTaskIds)need(candidates(id).length===1,'all original source Task definitions must be fixed uniquely, including not executed');
  return actions;
 }
 const inventories=[...references.values()].filter(v=>['ohuo-first-round-source-spec-v1','ohuo-first-round-source-spec-common-view-r2'].includes(v?.schema)&&v.planRef===spec.planRef&&v.reservationRef===null&&v.purpose==='first-round-source-plan');
 const protocol=commonView?references.get(rule.protocolRef):null;
 if(commonView){need(protocol?.schema==='ohuo-first-round-protocol-revision-v2'&&protocol.protocolId==='first-round-common-view-r2','approved common-view protocol required');fixedReference(protocol.originalMethods?.sourceSpecRef,'protocolSourceSpecRef');}
 const sourceSpecs=commonView?inventories.filter(v=>v===references.get(protocol.originalMethods.sourceSpecRef)):inventories.filter(v=>v.schema==='ohuo-first-round-source-spec-v1');
 need(sourceSpecs.length===1,'one original frozen source namespace inventory required');
 const sourceSpec=sourceSpecs[0],index=references.get(spec.sourceIndexRef),queue=references.get(spec.queueRef);
 need(index?.schema==='ohuo-source-index-ref-v1'&&queue?.schema==='ohuo-complete-match-queue-v1'&&queue.sourceIndexRef===spec.sourceIndexRef&&queue.namespace===index.namespace,'current original index/queue namespace required');
 need(stages.every(s=>typeof sourceSpec.stages?.[s]?.namespace==='string')&&new Set(stages.map(s=>sourceSpec.stages[s].namespace)).size===5,'five distinct pre-frozen namespaces required');
 let currentActions=0;
 for(const action of actions){
  if(!action.expectedArtifactKinds.includes('ohuo-match-summary-v1')&&!tasks.some(x=>sameAction(x.task,action)))continue;
  const scope=references.get(action.clauseRef);
  strictObject(scope,'firstRoundSourceActionScope',['schema','originalRuleRef','namespace','stageName']);
  need(scope.schema==='ohuo-first-round-source-action-scope-v1'&&stages.includes(scope.stageName),'named original source action scope required');
  fixedReference(scope.originalRuleRef,'originalRuleRef');need(references.has(scope.originalRuleRef),'original source rule unavailable');validateIdentifier(scope.namespace,'sourceNamespace');
  need(commonView?inventories.some(v=>v.stages?.[scope.stageName]?.namespace===scope.namespace):scope.namespace===sourceSpec.stages[scope.stageName].namespace,'source action cannot relabel original current namespace as future');
  if(commonView&&scope.namespace===index.namespace)need(sourceSpec.stages[scope.stageName].namespace===scope.namespace,'current source namespace must belong to this protocol batch');
  const current=scope.namespace===index.namespace;if(current)currentActions++;
  need(action.plannedTaskIds.length>0,'a source action cannot hide an empty planned inventory');
  for(const id of action.plannedTaskIds){
   const matches=candidates(id);need(matches.length<=1&&(!current||matches.length===1),'every current source Task must be fixed uniquely; future Tasks may only be absent');
   for(const [,task] of matches){
    const ti=references.get(task.sourcePlan?.sourceIndexRef),tq=references.get(task.seatLayoutPlan),cap=references.get(task.capabilityRef);
    need(sameAction(task,action)&&['collect','evaluate'].includes(task.taskKind)&&cap?.id==='B07.complete-match.v1'&&task.sourcePlan?.namespace===scope.namespace&&ti?.schema==='ohuo-source-index-ref-v1'&&ti.namespace===scope.namespace&&tq?.schema==='ohuo-complete-match-queue-v1'&&tq.namespace===scope.namespace&&tq.sourceIndexRef===task.sourcePlan.sourceIndexRef,'present source Task must match its original action/namespace/index/queue');
    if(current)need(task.sourcePlan.sourceIndexRef===spec.sourceIndexRef&&task.seatLayoutPlan===spec.queueRef,'all current source Tasks must bind this exact index and queue');
   }
  }
 }
 need(currentActions>0,'current source action cannot disappear from original plan');
 // Actual retry lineage is checked by the unchanged H assertActionTaskLineage
 // below this inventory gate. Do not require a retry ID to equal its root ID.
 for(const {task} of tasks)need(actions.some(a=>sameAction(task,a)&&references.get(a.clauseRef)?.namespace===index.namespace),'current actual source Task must belong to a planned current action');
 return actions.filter(a=>(a.expectedArtifactKinds.includes('ohuo-match-summary-v1')||tasks.some(x=>sameAction(x.task,a)))&&references.get(a.clauseRef)?.namespace===index.namespace);
}
