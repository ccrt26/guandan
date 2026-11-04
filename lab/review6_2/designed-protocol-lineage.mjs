/** Pure, narrow compatibility proof for historical common-view evidence.
 * No grant, execution, state, receipt creation, sample conversion or I/O. H must
 * still verify the actual immutable old Task/policy before reading history and
 * the current grant before current actions. This result never starts old Tasks. */
import {isDeepStrictEqual as equal} from 'node:util';
import {fail,strictObject,fixedReference,digest,validateIdentifier,validateResourcePolicy} from './task-schema.mjs';
import {commonViewProtocol} from './first-round-protocol.mjs';
import {validateProjectRulesPrompt} from '../../packages/web/server/llm-project-rules-v541.mjs';

const PROTOCOL_FIELDS=['schema','protocolId','planRef','planVersion','budgetRef','scientificDocument','authorizationEvidence','originalMethods','actions'];
const METHOD_FIELDS=['sourceSpecRef','sourceReservationRuleRef','primaryTeacherRef','independentTeacherRef','commonViewPromptRef'];
const ACTION_FIELDS=['clauseRef','branchRef','plannedTaskIds','dependencyRefs','expectedArtifactKinds','acceptanceRuleRef','skipRuleRef','stopRuleRef'];
const RULE_FIELDS=['schema','stage','phase','purpose','originalRuleRef','requiredKinds'];
const REQUIREMENT_FIELDS=['schema','stage','phase','kind','sourceRuleRef'];
const OWNER_KINDS=['designed-public-train-gap','student-visibility-and-initial-c','budget-scope'];
const SOURCE_ARTIFACTS=['ohuo-designed-family-reservation-v1','ohuo-designed-source-acceptance-v1'];
const conflict=(field,detail)=>fail('designed_protocol_lineage_conflict',field,detail);
const need=(condition,field,detail)=>{if(!condition)conflict(field,detail);};
function list(value,field,validate=(v,p)=>need(typeof v==='string'&&!!v.trim(),p,'nonempty string required')){
 need(Array.isArray(value)&&value.length<=10000,field,'bounded explicit array required');
 value.forEach((v,i)=>validate(v,`${field}[${i}]`));
 need(new Set(value).size===value.length,field,'duplicate entries are not supported');return value;
}
const retained=(old,current,field)=>need(old.every(value=>current.includes(value)),field,'all original values must be retained');
function evidence(value,field){strictObject(value,field,['id','sha256']);need(typeof value.id==='string'&&!!value.id.trim()&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256),field,'explicit evidence identity required; H verifies its bytes');}
function protocol(value,field){
 strictObject(value,field,PROTOCOL_FIELDS);need(commonViewProtocol(value),field,'original common-view v2 protocol required');
 fixedReference(value.planRef,`${field}.planRef`);fixedReference(value.budgetRef,`${field}.budgetRef`);
 need(Number.isSafeInteger(value.planVersion)&&value.planVersion>0,`${field}.planVersion`,'positive original plan version required');
 evidence(value.scientificDocument,`${field}.scientificDocument`);
 need(Array.isArray(value.authorizationEvidence)&&value.authorizationEvidence.length>0&&value.authorizationEvidence.length<=10000,`${field}.authorizationEvidence`,'explicit evidence required');
 value.authorizationEvidence.forEach((v,i)=>evidence(v,`${field}.authorizationEvidence[${i}]`));
}
function actions(values,field){
 need(Array.isArray(values)&&values.length>0&&values.length<=10000,field,'complete original actions required');
 const byKey=new Map(),tasks=new Set();
 for(const [index,action]of values.entries()){
  const path=`${field}[${index}]`;strictObject(action,path,ACTION_FIELDS);
  fixedReference(action.clauseRef,`${path}.clauseRef`);
  for(const key of ['branchRef','skipRuleRef','stopRuleRef'])if(action[key]!==null)fixedReference(action[key],`${path}.${key}`);
  fixedReference(action.acceptanceRuleRef,`${path}.acceptanceRuleRef`);
  list(action.plannedTaskIds,`${path}.plannedTaskIds`,validateIdentifier);list(action.dependencyRefs,`${path}.dependencyRefs`,fixedReference);list(action.expectedArtifactKinds,`${path}.expectedArtifactKinds`);
  const key=JSON.stringify([action.clauseRef,action.branchRef]);need(!byKey.has(key),path,'duplicate clause/branch');byKey.set(key,action);
  for(const id of action.plannedTaskIds){need(!tasks.has(id),`${path}.plannedTaskIds`,'a Task cannot move or occupy two action roles');tasks.add(id);}
 }
 return byKey;
}
function rule(value,field){
 strictObject(value,field,RULE_FIELDS);need(value.schema==='ohuo-stage-action-rule-v1',field,'original stage action rule required');
 fixedReference(value.originalRuleRef,`${field}.originalRuleRef`);list(value.requiredKinds,`${field}.requiredKinds`);
}
function requirements(refs,actionRule,read,field){
 const byKind=new Map();
 for(const ref of refs){
  const value=read(ref,field);strictObject(value,field,REQUIREMENT_FIELDS);
  need(value.schema==='ohuo-stage-prerequisite-v1'&&value.stage===actionRule.stage&&(value.phase===null||value.phase===actionRule.phase)&&typeof value.kind==='string'&&!!value.kind.trim(),field,'original stage, phase and kind required');
  fixedReference(value.sourceRuleRef,`${field}.sourceRuleRef`);need(!byKind.has(value.kind),field,'one actual requirement per kind required');byKind.set(value.kind,value);
 }
 need(actionRule.requiredKinds.every(kind=>byKind.has(kind)),field,'each original required kind must have an actual requirement');
 return byKind;
}

function verifyDesignedProtocolLink({currentProtocolRef,previousProtocolRef,references}){
 need(references&&typeof references.get==='function','references','read-only fixed-reference map required');
 const read=(ref,field)=>{fixedReference(ref,field);const value=references.get(ref);need(value!==undefined&&digest(value)===ref.split(':').at(-1),field,'registered object with exact canonical digest required');return value;};
 const previous=read(previousProtocolRef,'previousProtocolRef'),current=read(currentProtocolRef,'currentProtocolRef');
 protocol(previous,'previousProtocol');protocol(current,'currentProtocol');
 for(const key of ['protocolId','planRef','planVersion','budgetRef'])need(current[key]===previous[key],key,'original protocol, plan and budget identities cannot change');
 const continued=Object.hasOwn(previous.originalMethods??{},'previousProtocolRef');
 strictObject(previous.originalMethods,'previousProtocol.originalMethods',continued?[...METHOD_FIELDS,'previousProtocolRef','previousResourcePolicyRef']:METHOD_FIELDS);
 strictObject(current.originalMethods,'currentProtocol.originalMethods',[...METHOD_FIELDS,'previousProtocolRef','previousResourcePolicyRef']);
 need(current.originalMethods.previousProtocolRef===previousProtocolRef,'originalMethods.previousProtocolRef','explicit exact predecessor required');
 const previousResourcePolicyRef=current.originalMethods.previousResourcePolicyRef,oldPolicy=validateResourcePolicy({ref:previousResourcePolicyRef,value:read(previousResourcePolicyRef,'previousResourcePolicyRef')});
 need(oldPolicy.value.protocolRevisionRef===previousProtocolRef&&oldPolicy.value.planRef===previous.planRef&&oldPolicy.value.budgetRef===previous.budgetRef,'previousResourcePolicyRef','original policy must bind this exact old protocol, plan and budget');
 for(const key of METHOD_FIELDS){
  const old=read(previous.originalMethods[key],`previousMethods.${key}`),now=read(current.originalMethods[key],`currentMethods.${key}`);
  if(current.originalMethods[key]===previous.originalMethods[key])continue;
  need(key==='commonViewPromptRef','originalMethods','source, candidate and teacher identities cannot change');
  strictObject(old,'previousCommonViewPrompt',['schema','viewSchema','systemPromptSHA256']);
  need(old.schema==='ohuo-common-view-prompt-r2'&&old.viewSchema==='first-round-common-view-r2'&&/^[a-f0-9]{64}$/.test(old.systemPromptSHA256),'commonViewPromptRef','only the original r2 prompt can transition to the exact accepted project-rules prompt');
  validateProjectRulesPrompt(now);
 }
 const oldActions=actions(previous.actions,'previousActions'),currentActions=actions(current.actions,'currentActions');
 need(oldActions.size===currentActions.size,'actions','no original clause/branch may be added or removed');
 for(const [key,oldAction]of oldActions){
  const action=currentActions.get(key);need(action,'actions','every original clause and branch must remain');
  for(const k of ['skipRuleRef','stopRuleRef'])need(action[k]===oldAction[k],`actions.${k}`,'original skip and stop rules cannot change');
  const oldRule=read(oldAction.acceptanceRuleRef,'previousActionRule'),newRule=read(action.acceptanceRuleRef,'currentActionRule');
  for(const ref of [...oldAction.dependencyRefs,...action.dependencyRefs])read(ref,'dependencyRefs');
  const stage4=oldRule.schema==='ohuo-stage-action-rule-v1'&&oldRule.stage===4&&oldRule.phase===null;
  // New queue/index receipts may coexist with the old nonrunner receipts under
  // distinct immutable namespaces. Only their exact old requirement objects,
  // in the same order, may be aliased; no action or acceptance semantics change.
  if(stage4&&oldRule.purpose==='offline-selection'&&oldAction.plannedTaskIds.length===0){
   need(equal({...action,dependencyRefs:oldAction.dependencyRefs},oldAction),'actions','offline selection may change only dependency reference namespaces');
   need(action.dependencyRefs.length===oldAction.dependencyRefs.length&&action.dependencyRefs.every((ref,index)=>equal(read(ref,'currentRequirements'),read(oldAction.dependencyRefs[index],'previousRequirements'))),'dependencyRefs','offline selection aliases must retain every full original requirement in the same order');
   continue;
  }
  const owner=stage4&&oldRule.purpose==='original-mechanical-source-reservation';
  const source=stage4&&oldRule.purpose==='data-complete-natural-source';
  const designer=stage4&&oldRule.purpose==='designed-source';
  const teacher=stage4&&['data-glm','data-screen','data-ds'].includes(oldRule.purpose);
  const training=oldRule.schema==='ohuo-stage-action-rule-v1'&&oldRule.stage===5&&['calibration','formal'].includes(oldRule.phase)&&oldRule.purpose==='supervised-rerank-'+oldRule.phase;
  if(!(owner||source||designer||teacher||training)){
   need(equal(action,oldAction),'actions','only the named stage4 and same-recipe stage5 roles can extend');continue;
  }
  rule(oldRule,'previousActionRule');rule(newRule,'currentActionRule');
  const migrated=source&&newRule.purpose==='designed-source';
  const allowedKinds=owner?OWNER_KINDS:migrated?['designed-public-train-gap']:[];
  for(const k of ['schema','stage','phase','originalRuleRef'])need(equal(newRule[k],oldRule[k]),`actionRule.${k}`,'original rule semantics must remain');
  need(newRule.purpose===oldRule.purpose||migrated,'actionRule.purpose','only the original natural data source can become the explicit designer role');
  retained(oldRule.requiredKinds,newRule.requiredKinds,'actionRule.requiredKinds');
  need(newRule.requiredKinds.every(kind=>oldRule.requiredKinds.includes(kind)||allowedKinds.includes(kind)),'actionRule.requiredKinds','only the existing source-owner/designer requirements may be added');
  const oldRequirements=requirements(oldAction.dependencyRefs,oldRule,read,'previousRequirements'),currentRequirements=requirements(action.dependencyRefs,newRule,read,'currentRequirements');
  for(const [kind,value]of oldRequirements)need(equal(currentRequirements.get(kind),value),'dependencyRefs','replacement namespace refs must resolve to the full unchanged original requirement JSON');
  for(const [kind,value]of currentRequirements)if(!oldRequirements.has(kind))need(allowedKinds.includes(kind)&&newRule.requiredKinds.includes(kind)&&value.phase===null&&value.sourceRuleRef===oldRule.originalRuleRef,'dependencyRefs','only named source requirements with the original rule identity may be added');
  retained(oldAction.plannedTaskIds,action.plannedTaskIds,'plannedTaskIds');
  if(!(migrated||designer||teacher||training))need(equal(action.plannedTaskIds,oldAction.plannedTaskIds),'plannedTaskIds','source-owner and unchanged natural-source actions cannot gain Task roles');
  retained(oldAction.expectedArtifactKinds,action.expectedArtifactKinds,'expectedArtifactKinds');
  const addedArtifacts=action.expectedArtifactKinds.filter(kind=>!oldAction.expectedArtifactKinds.includes(kind));
  const allowedArtifacts=owner?SOURCE_ARTIFACTS:migrated?['ohuo-designed-source-summary-v1']:[];
  need(addedArtifacts.every(kind=>allowedArtifacts.includes(kind)),'expectedArtifactKinds','only exact source-owner or designer artifacts can be added to their own role');
  if(migrated)need(newRule.requiredKinds.includes('designed-public-train-gap'),'actionRule.requiredKinds','designer source retains the existing scientific gap requirement');
  if(owner&&addedArtifacts.length)need(OWNER_KINDS.every(kind=>newRule.requiredKinds.includes(kind)),'actionRule.requiredKinds','source-owner artifacts retain all existing source-owner prerequisite kinds');
 }
 return {currentProtocolRef,previousProtocolRef,previousResourcePolicyRef};
}

/** Walk only the actual immutable predecessor links. The requested ancestor may
 * be the immediate policy for TC or an older frozen dataset's protocol. Every
 * link back to the original method is checked; this does not grant execution. */
export function verifyDesignedProtocolLineage({currentProtocolRef,previousProtocolRef,references}){
 need(references&&typeof references.get==='function','references','read-only fixed-reference map required');
 fixedReference(currentProtocolRef,'currentProtocolRef');fixedReference(previousProtocolRef,'previousProtocolRef');
 need(currentProtocolRef!==previousProtocolRef,'previousProtocolRef','a distinct actual predecessor required');
 const seen=new Set();let cursor=currentProtocolRef,previousResourcePolicyRef=null;
 while(true){
  need(!seen.has(cursor),'previousProtocolRef','cyclic protocol lineage');seen.add(cursor);
  const value=references.get(cursor);need(value!==undefined&&digest(value)===cursor.split(':').at(-1),'previousProtocolRef','registered object with exact canonical digest required');protocol(value,'lineageProtocol');
  if(!Object.hasOwn(value.originalMethods??{},'previousProtocolRef')){strictObject(value.originalMethods,'originalMethods',METHOD_FIELDS);break;}
  const parent=value.originalMethods.previousProtocolRef,result=verifyDesignedProtocolLink({currentProtocolRef:cursor,previousProtocolRef:parent,references});
  if(parent===previousProtocolRef)previousResourcePolicyRef=result.previousResourcePolicyRef;
  cursor=parent;
 }
 need(previousResourcePolicyRef!==null,'previousProtocolRef','requested previous protocol must occur on the actual predecessor chain');
 return {currentProtocolRef,previousProtocolRef,previousResourcePolicyRef};
}
