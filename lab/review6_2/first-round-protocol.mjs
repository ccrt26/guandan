import {isDeepStrictEqual as equal} from 'node:util';
import {fail,strictObject,fixedReference,digest,validateResourcePolicy} from './task-schema.mjs';
export const COMMON_VIEW_PROTOCOL='first-round-common-view-r2';
export function commonViewProtocol(value){return value?.schema==='ohuo-first-round-protocol-revision-v2'&&value.protocolId===COMMON_VIEW_PROTOCOL;}
/** The revision is data approved with the original plan, never an executable
 * override. Historical actions keep their original interpretation. */
export function verifyCommonViewProtocol({ref,value,policy,grant,plan,state,readEvidence,readReference}){
 fixedReference(ref,'protocolRevisionRef');
 strictObject(value,'protocol',['schema','protocolId','planRef','planVersion','budgetRef','scientificDocument','authorizationEvidence','originalMethods','actions']);
 if(!commonViewProtocol(value)||digest(value)!==ref.split(':').at(-1)||value.planRef!==grant.planRef||value.planVersion!==grant.planVersion||!Array.isArray(value.actions)||!Array.isArray(value.authorizationEvidence)||!value.authorizationEvidence.length)fail('protocol_identity_unverified','protocol','named current revision and original plan required');
 const p=validateResourcePolicy(policy);if(p.value.protocolRevisionRef!==ref||p.value.planRef!==value.planRef||p.value.budgetRef!==value.budgetRef||p.value.authorizationRef!==grant.authorizationRef)fail('resource_policy_conflict','protocol','grant policy must bind the same actual revision');
 readEvidence(value.scientificDocument);for(const e of value.authorizationEvidence)readEvidence(e);
 if(!value.originalMethods||typeof value.originalMethods!=='object'||Array.isArray(value.originalMethods))fail('protocol_identity_unverified','originalMethods','explicit prior methods required');for(const method of Object.values(value.originalMethods)){fixedReference(method,'originalMethod');readReference(method);}
 const old=plan.actions??readReference(plan.actionsRef).actions,key=a=>JSON.stringify([a.clauseRef,a.branchRef]);
 if(!Array.isArray(old)||value.actions.length!==old.length)fail('protocol_action_conflict','actions','one complete original action view required');
 const seen=new Set();for(const a of value.actions){strictObject(a,'approvedAction',['clauseRef','branchRef','plannedTaskIds','dependencyRefs','expectedArtifactKinds','acceptanceRuleRef','skipRuleRef','stopRuleRef']);const k=key(a);if(seen.has(k)||!old.some(o=>key(o)===k))fail('protocol_action_conflict','actions','original clause/branch identities cannot be removed or introduced implicitly');seen.add(k);const original=old.find(o=>key(o)===k);const executed=Object.values(state?.runs??{}).some(r=>r.task?.planRef===value.planRef&&key(r.task.planScope)===k&&!commonViewProtocol(readReference(r.task.scientificContract.analysisMethodRef)));if(executed&&!equal(a,original))fail('protocol_history_changed','actions','executed legacy action must retain original Task and rule');}
 return {ref,value,policy:p};
}
export function inputWorkloadForQueue(queue,task){
 if(!queue||!Array.isArray(queue.rows))fail('input_identity_unverified','queue','frozen actual match list required');
 const matches=queue.rows.filter(m=>m.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(m.sourceFamilyId));
 if(!matches.length)fail('input_identity_unverified','queue','nonempty exact Task source projection required');
 return {providerRequests:0,labelDecisions:0,optimizerSteps:0,matchAttempts:matches.length};
}
