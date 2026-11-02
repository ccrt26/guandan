import assert from 'node:assert/strict';
import {verifySourceActionInventory as check} from '../first-round-source-action-scope.mjs';
import {referenceOf} from '../task-schema.mjs';
const refs=new Map();const add=(id,v)=>{const r=referenceOf(id,v);refs.set(r,v);return r;};
const planRef=add('plan',{}),originalRuleRef=add('original-rule',{nav:'NAV-R11'}),cap=add('cap',{id:'B07.complete-match.v1'}),selectionRuleRef=add('pilot-rule',{schema:'ohuo-offline-selection-first-round-pilot-rule-v1'});
add('source-spec',{schema:'ohuo-first-round-source-spec-v1',planRef,reservationRef:null,purpose:'first-round-source-plan',stages:Object.fromEntries(['pilot','formal','newTest','variancePilot','confirmation'].map(s=>[s,{namespace:'frozen-'+s}]))});
const index=stage=>add(stage+'-index',{schema:'ohuo-source-index-ref-v1',namespace:'frozen-'+stage});
const pi=index('pilot'),pq=add('pilot-queue',{schema:'ohuo-complete-match-queue-v1',namespace:'frozen-pilot',sourceIndexRef:pi});
const action=stage=>({clauseRef:add(stage+'-clause',{schema:'ohuo-first-round-source-action-scope-v1',originalRuleRef,namespace:'frozen-'+stage,stageName:stage}),branchRef:null,plannedTaskIds:[stage+'-source'],expectedArtifactKinds:['ohuo-match-summary-v1']});
const pilot=action('pilot'),future=action('confirmation');
const task={schemaVersion:1,planRef,taskId:'pilot-source',taskKind:'collect',capabilityRef:cap,planScope:{clauseRef:pilot.clauseRef,branchRef:null},sourcePlan:{namespace:'frozen-pilot',sourceIndexRef:pi},seatLayoutPlan:pq};
const tr=add('pilot-task',task),spec={planRef,selectionRuleRef,sourceIndexRef:pi,queueRef:pq};
const input=()=>({spec,references:new Map(refs),actions:[pilot,future],tasks:[{taskRef:tr,task}]});
assert.deepEqual(check(input()),[pilot]); // consumer receives only the complete current source actions, never fabricated future Tasks.
const retry={...task,taskId:'pilot-source-retry',parentTaskId:'pilot-source'};const retryInput=input();retryInput.tasks.push({taskRef:'actual-retry',task:retry});check(retryInput); // unchanged H validates its actual stopped-parent lineage.
let x=input();x.references.delete(tr);x.tasks=[];assert.throws(()=>check(x),/planned_source_task_unavailable/);
x=input();x.actions=[future];x.tasks=[];assert.throws(()=>check(x),/planned_source_task_unavailable/);
x=input();x.references.set(pilot.clauseRef,{...refs.get(pilot.clauseRef),namespace:'frozen-confirmation'});assert.throws(()=>check(x),/planned_source_task_unavailable/);
x=input();x.references.set(tr,{...task,seatLayoutPlan:'wrong'});assert.throws(()=>check(x),/planned_source_task_unavailable/);
x=input();x.references.set('duplicate-task',task);assert.throws(()=>check(x),/planned_source_task_unavailable/);
x=input();x.references.set('future-task',{...task,taskId:'confirmation-source',planScope:{clauseRef:future.clauseRef,branchRef:null}});assert.throws(()=>check(x),/planned_source_task_unavailable/);
x=input();x.references.set(selectionRuleRef,{schema:'ohuo-offline-selection-rule-v1'});assert.throws(()=>check(x),/planned_source_task_unavailable/); // legacy still demands the future definition.
console.log(JSON.stringify({case:'first-round-source-action-inventory',passed:true,currentWholeActionRequired:true,futureTaskNotFabricated:true,wrongNamespaceIndexQueueRejected:true,legacyAllPlanUnchanged:true,actualMatches:0,providerRequests:0,optimizerSteps:0}));
