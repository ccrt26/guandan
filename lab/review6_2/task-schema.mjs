import {isFirstRoundRecipe,validateFirstRoundRecipe} from './first-round-contract.mjs';
import * as firstRoundContract from './first-round-contract.mjs';
import {createHash} from 'node:crypto';

export class TaskError extends Error {
 constructor(reason,field,detail){super(`${reason}${field?` at ${field}`:''}: ${detail}`);this.reason=reason;this.field=field;}
}
export const fail=(reason,field,detail)=>{throw new TaskError(reason,field,detail);};
export function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
 fail('invalid_value','','JSON values must be finite and explicit');
}
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export const referenceOf=(id,value)=>`${id}@sha256:${digest(value)}`;
export function fixedReference(value,path){
 if(typeof value!=='string'||!/^[-a-zA-Z0-9._/:]+@sha256:[a-f0-9]{64}$/.test(value)||/(^|[./:_-])latest([./:_-]|@)/i.test(value))fail('invalid_reference',path,'immutable id@sha256:<64 lower-case hex> required');
 return value;
}
export function strictObject(value,path,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('invalid_field',path,'object required');
 for(const k of Object.keys(value))if(!keys.includes(k))fail('unknown_field',`${path}.${k}`,'field not supported');
 for(const k of keys)if(!Object.hasOwn(value,k))fail('missing_field',`${path}.${k}`,'explicit field required');
 return value;
}
const text=(x,p)=>{if(typeof x!=='string'||!x.trim())fail('invalid_field',p,'nonempty string required');};
export const validateIdentifier=(x,p)=>{if(typeof x!=='string'||(!/^[-a-zA-Z0-9_]{1,100}$/.test(x)||['__proto__','prototype','constructor'].includes(x)))fail('invalid_field',p,'bounded stable identifier required');};
// Canonical engine source-family keys contain a colon; ordinary Task IDs do not.
export const validateSourceFamily=(x,p)=>{if(typeof x==='string'&&/^first-deal-family:[a-f0-9]{64}$/.test(x))return;validateIdentifier(x,p);};
const id=validateIdentifier;
const integer=(x,p,min=0)=>{if(!Number.isSafeInteger(x)||x<min)fail('invalid_limit',p,`finite integer >= ${min} required`);};
const list=(x,p,fn,min=0)=>{if(!Array.isArray(x)||x.length<min||x.length>10000)fail('invalid_field',p,'bounded array required');x.forEach((v,i)=>fn(v,`${p}[${i}]`));};
const enumeration=(x,p,allowed)=>{if(!allowed.includes(x))fail('unsupported_value',p,`supported values: ${allowed.join(', ')}`);};
export const COUNTERS=['providerRequests','optimizerSteps','matchAttempts','labelDecisions'];
export const LIMITS={providerRequests:'maxProviderRequests',optimizerSteps:'maxOptimizerSteps',matchAttempts:'maxMatchAttempts',labelDecisions:'maxLabelDecisions'};
export function validateLimits(limits,path='limits'){
 strictObject(limits,path,[...Object.values(LIMITS),'maxRunSeconds']);
 for(const k of Object.values(LIMITS))integer(limits[k],`${path}.${k}`);
 integer(limits.maxRunSeconds,`${path}.maxRunSeconds`,1);
}
export const isInputWorkloadLimits=limits=>limits?.mode==='input-derived-workload-v1';
export const isScientificObservationLimits=limits=>limits?.mode==='scientific-observation-v1';
export const isWorkloadLimits=limits=>isInputWorkloadLimits(limits)||isScientificObservationLimits(limits);
export function validateWorkloadLimits(limits,path='limits'){
 const observing=isScientificObservationLimits(limits);
 if(!isWorkloadLimits(limits))fail('unsupported_schema',path,'explicit input workload or scientific observation required');
 strictObject(limits,path,['mode',...Object.values(LIMITS).filter(k=>!observing||k!=='maxOptimizerSteps')]);
 for(const k of Object.values(LIMITS).filter(k=>!observing||k!=='maxOptimizerSteps')){integer(limits[k],`${path}.${k}`);if(observing&&limits[k]!==0)fail('unsupported_scope',`${path}.${k}`,'learning observation cannot make provider, label or match operations');}
}
export function validateResourcePolicy(policy){
 strictObject(policy,'resourcePolicy',['ref','value']);fixedReference(policy.ref,'resourcePolicy.ref');
 const v=policy.value;strictObject(v,'resourcePolicy.value',['schema','mode','protocolRevisionRef','planRef','budgetRef','authorizationRef','controlRoot']);
 if(v.schema!=='ohuo-round-resource-policy-v1'||v.mode!=='input-workload-only')fail('resource_policy_invalid','resourcePolicy','only the named record-only round policy is supported');
 for(const k of ['protocolRevisionRef','planRef','budgetRef','authorizationRef'])fixedReference(v[k],`resourcePolicy.${k}`);text(v.controlRoot,'resourcePolicy.controlRoot');
 if(policy.ref.split(':').at(-1)!==digest(v))fail('resource_policy_invalid','resourcePolicy.ref','exact canonical policy identity required');
 return policy;
}
export function validateCost(cost){strictObject(cost,'cost',COUNTERS);for(const k of COUNTERS)integer(cost[k],`cost.${k}`);}
const TOP=['schemaVersion','taskId','experimentId','attemptId','planVersion','planRef','parentTaskId','retryReasonRef','researchBatchId','budgetRef','authorizationRef','taskKind','capabilityRef','sourceRevision','runtimeRef','parentPolicyRef','releaseRefs','rulesRef','sourcePlan','splitRefs','seatLayoutPlan','actorSampleRule','datasetRefs','labelPolicyRef','promptRef','scientificContract','planScope','learnerRecipe','operationScope','limits','allowedBranches','stopPolicy','outputSpec','outputRoot','runId','taskStatus','unresolved'];
const SIMPLE_REFS=['planRef','budgetRef','authorizationRef','capabilityRef','sourceRevision','runtimeRef','parentPolicyRef','rulesRef','seatLayoutPlan','labelPolicyRef','promptRef','stopPolicy'];
export function taskReferences(t){
 return [...SIMPLE_REFS.map(k=>t[k]),...t.releaseRefs,...t.splitRefs,...t.datasetRefs,t.sourcePlan.sourceIndexRef,...Object.entries(t.scientificContract).filter(([k])=>k.endsWith('Ref')).map(([,v])=>v),t.planScope.clauseRef,...t.planScope.prerequisiteRefs,...(t.planScope.branchRef?[t.planScope.branchRef]:[]),...(t.retryReasonRef?[t.retryReasonRef]:[]),...t.allowedBranches.flatMap(b=>[b.conditionRef,b.evidenceRef]),...(t.taskKind==='supervised_training'?[t.outputSpec.proposalPolicyRef]:[])];
}
export function validateTask(t){
 strictObject(t,'task',TOP);if(t.schemaVersion!==1)fail('unsupported_schema','schemaVersion','only version 1');
 for(const k of ['taskId','experimentId','attemptId','researchBatchId','runId'])id(t[k],k);
 integer(t.planVersion,'planVersion',1);for(const k of SIMPLE_REFS)fixedReference(t[k],k);
 enumeration(t.taskKind,'taskKind',['probe','collect','evaluate','supervised_training']);
 if(t.parentTaskId===null){if(t.retryReasonRef!==null)fail('invalid_field','retryReasonRef','first task must use null');}
 else{id(t.parentTaskId,'parentTaskId');fixedReference(t.retryReasonRef,'retryReasonRef');if(t.parentTaskId===t.taskId)fail('invalid_field','parentTaskId','must name prior task');}
 for(const k of ['releaseRefs','splitRefs'])list(t[k],k,fixedReference,1);
 list(t.datasetRefs,'datasetRefs',fixedReference,t.taskKind==='supervised_training'?1:0);
 strictObject(t.sourcePlan,'sourcePlan',['namespace','sourceIndexRef','familyIds','split']);text(t.sourcePlan.namespace,'sourcePlan.namespace');fixedReference(t.sourcePlan.sourceIndexRef,'sourcePlan.sourceIndexRef');list(t.sourcePlan.familyIds,'sourcePlan.familyIds',validateSourceFamily,1);
 if(new Set(t.sourcePlan.familyIds).size!==t.sourcePlan.familyIds.length)fail('invalid_field','sourcePlan.familyIds','duplicate family');
 enumeration(t.sourcePlan.split,'sourcePlan.split',['train','dev','confirm','fixture']);
 enumeration(t.actorSampleRule,'actorSampleRule',['evaluated-seat-only']);
 strictObject(t.scientificContract,'scientificContract',['question','primaryMetricRef','analysisUnit','analysisMethodRef','comparisonRef','selectionRuleRef','readoutRuleRef','decisionRuleRef']);
 text(t.scientificContract.question,'scientificContract.question');text(t.scientificContract.analysisUnit,'scientificContract.analysisUnit');
 for(const [k,v] of Object.entries(t.scientificContract))if(k.endsWith('Ref'))fixedReference(v,`scientificContract.${k}`);
 strictObject(t.planScope,'planScope',['clauseRef','branchRef','prerequisiteRefs']);fixedReference(t.planScope.clauseRef,'planScope.clauseRef');if(t.planScope.branchRef!==null)fixedReference(t.planScope.branchRef,'planScope.branchRef');list(t.planScope.prerequisiteRefs,'planScope.prerequisiteRefs',fixedReference);
 strictObject(t.operationScope,'operationScope',['localExecution','apiCalls','parameterUpdates','deployment']);
 for(const [k,v] of Object.entries(t.operationScope))if(typeof v!=='boolean')fail('invalid_field',`operationScope.${k}`,'boolean required');
 if(t.operationScope.deployment)fail('unsupported_scope','operationScope.deployment','M0 cannot deploy');
 if(isWorkloadLimits(t.limits))validateWorkloadLimits(t.limits);else validateLimits(t.limits);
 if(isScientificObservationLimits(t.limits)&&t.taskKind!=='supervised_training')fail('unsupported_scope','limits.mode','only the named r2 learner can use scientific stopping');
 list(t.allowedBranches,'allowedBranches',(b,p)=>{
  strictObject(b,p,['branchId','conditionRef','evidenceRef','change','maxUses','restartFrom','inheritBudgetRef']);id(b.branchId,`${p}.branchId`);fixedReference(b.conditionRef,`${p}.conditionRef`);fixedReference(b.evidenceRef,`${p}.evidenceRef`);
  strictObject(b.change,`${p}.change`,['learningRate']);if(b.change.learningRate!==.00003||b.maxUses!==1||b.restartFrom!=='fixed-parent'||b.inheritBudgetRef!==true)fail('unsupported_branch',p,'only frozen single numerical branch shape is recognized, not authorized');
 });
 if(t.taskKind==='supervised_training'){
  if(isWorkloadLimits(t.limits)){
   if(typeof firstRoundContract.isFirstRoundR2Recipe!=='function'||typeof firstRoundContract.validateFirstRoundR2Recipe!=='function'||!firstRoundContract.isFirstRoundR2Recipe(t.learnerRecipe))fail('unsupported_recipe','learnerRecipe','reviewed r2 scientific learning recipe required');
   try{firstRoundContract.validateFirstRoundR2Recipe(t.learnerRecipe);}catch{fail('unsupported_recipe','learnerRecipe','exact r2 scientific stopping recipe required');}
   if(isInputWorkloadLimits(t.limits)&&t.limits.maxOptimizerSteps!==1)fail('unsupported_recipe','limits.maxOptimizerSteps','the finite r2 calibration is one numerical check; formal learning uses scientific-observation');
  }else if(firstRoundContract.isFirstRoundR2Recipe?.(t.learnerRecipe)){
   fail('unsupported_recipe','limits.mode','r2 learning requires the approved explicit workload mode');
  }else if(isFirstRoundRecipe(t.learnerRecipe)){
   try{validateFirstRoundRecipe(t.learnerRecipe);}catch{fail('unsupported_recipe','learnerRecipe','exact first-round fixed64 recipe required');}
   if(![1,64].includes(t.limits.maxOptimizerSteps))fail('unsupported_recipe','limits.maxOptimizerSteps','first-round calibration1 or formal64 bound required; host binds the phase');
  }else{
  const expected={recipeId:'supervised-rerank-v1',optimizer:'RMSprop',alpha:.9,eps:.00001,momentum:0,centered:false,weightDecay:0,temperature:1,keepWeight:1,demoBatch:32,keepBatch:32,maxEpochs:3,initialization:'fixed-parent-new-optimizer'};
  strictObject(t.learnerRecipe,'learnerRecipe',[...Object.keys(expected),'learningRate']);
  for(const [k,v] of Object.entries(expected))if(t.learnerRecipe[k]!==v)fail('unsupported_recipe',`learnerRecipe.${k}`,'only frozen v5.2 recipe can be described; learner remains planned');
  if(![.0001,.00003].includes(t.learnerRecipe.learningRate))fail('unsupported_recipe','learnerRecipe.learningRate','unapproved recipe value');
  }
  if(!t.operationScope.parameterUpdates)fail('invalid_field','operationScope.parameterUpdates','training must explicitly request updates');
 }else if(t.learnerRecipe!==null||t.operationScope.parameterUpdates)fail('forbidden_field','learnerRecipe','non-training tasks cannot imply a learner');
 if(t.taskKind==='supervised_training'){strictObject(t.outputSpec,'outputSpec',['trainingKind','proposalPolicyRef','releaseStatus']);enumeration(t.outputSpec.trainingKind,'outputSpec.trainingKind',['supervised_rerank']);fixedReference(t.outputSpec.proposalPolicyRef,'outputSpec.proposalPolicyRef');}
 else{strictObject(t.outputSpec,'outputSpec',['artifactKinds','releaseStatus']);list(t.outputSpec.artifactKinds,'outputSpec.artifactKinds',text,1);}
 enumeration(t.outputSpec.releaseStatus,'outputSpec.releaseStatus',['development']);text(t.outputRoot,'outputRoot');
 enumeration(t.taskStatus,'taskStatus',['draft','blocked','ready']);list(t.unresolved,'unresolved',text);
 // A defensive JSON copy removes aliases; callers cannot mutate an already-resolved task.
 return JSON.parse(canonical(t));
}
