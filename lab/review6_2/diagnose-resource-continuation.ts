/** Eight train-family current-round leaves; no future sampling or new labels. */
import{join}from'node:path';import{HOME,json,fileHash,atomicJson,codeIdentity}from'./protocol';import{policyForRun}from'./evaluate';import{replayDeclaredPrefix}from'./declared-proof';import{resolveContinuationProfile}from'../review6/policy-registry';import{runCompleteMatch}from'../review6/match-play';import{necessaryDeclarationKey}from'../review6/action-effect';
const config=json(join(HOME,'config.json')),registry=json(config.registryPath),book=json(join(HOME,'data/explicit-resource-book-001/labels.json')),index=json(config.sourceIndexRef),rows:any[]=[];
const policies=['r62-p9c-control','r62-p9c-resource'].map(id=>policyForRun(config,id));if(policies.some(p=>p.epsilon!==0||!p.policyId.endsWith('u1800-greedy')))throw Error('exact greedy1800 students required');
const inputs=[...book.flatMap((l:any)=>{const c=json(l.proofRef);return[l.rootRef,l.proofRef,c.prefixRef];}),...policies.map(p=>p.weightsPath!)],before=Object.fromEntries(inputs.map(p=>[p,fileHash(p)]));
for(const label of book){
 const root=json(label.rootRef),certificate=json(label.proofRef);if(fileHash(label.rootRef)!==label.rootSHA256||fileHash(certificate.prefixRef)!==certificate.prefixSHA256)throw Error('fixed training source changed');
 const r=replayDeclaredPrefix(json(certificate.prefixRef));if(r.observed.observationSHA256!==root.observedBefore.observationSHA256||r.families.some(f=>index.families[f]?.split!=='train'))throw Error('training replay/split mismatch');
 const actor=r.observed.actor,pair=label.pairs[0];
 for(const student of policies){const original=resolveContinuationProfile(registry,'primary',actor),seats=original.seats.map(s=>s.seat===actor?student:s.policy),leaves:any[]=[];
  for(const[actionName,id]of[['preferred',pair.preferredActionId],['other',pair.otherActionId]]){
   const candidate=r.candidates.find(c=>c.actionId===id);if(!candidate)throw Error('fixed root action missing');const decisions:any[]=[];
   const result=runCompleteMatch({seed:2026103009,policies:seats,rngMode:'counter-per-decision',inferenceExecution:'exact-prefix-v1',rootState:r.state,rootHistory:r.history,actingSeat:actor,forcedRootMove:candidate.move,maxGames:1,maxMovesPerGame:2500,onAfterDecision({state,seat,move,control}){decisions.push({actor:seat,actionKey:necessaryDeclarationKey(move.pass?null:move.combo!,state.ctx),control:control.source,counts:state.hands.map(h=>h.length)});}});
   if(result.rootG===null||!result.rootRoundResult)throw Error('diagnostic did not complete current round');
   leaves.push({actionName,actionId:id,completeRound:true,completeMatch:result.complete,g:result.rootG,W:result.finalW,y:result.rootTeamTarget,fullTargetInterval:result.complete?[result.rootTeamTarget,result.rootTeamTarget]:[result.rootG-1,result.rootG+1],finishOrder:result.rootRoundResult.finishOrder,traceSHA256:result.traceSHA256,decisions});
  }
  rows.push({rootId:root.rootId,rootKey:label.rootKey,student,actualPolicyIds:seats.map(p=>p.policyId),profileChange:'actor-only replacement of original primary; original secondary collapses to same live-seat policies, not an independent extra check',originalPrimaryNormalizedLower:certificate.bound.profiles[0].normalizedDifferenceLowerBound,leaves,normalizedDifferenceLowerBound:(leaves[0].fullTargetInterval[0]-leaves[1].fullTargetInterval[1])/8});
 }
}
if(inputs.some(p=>fileHash(p)!==before[p]))throw Error('diagnostic mutated fixed inputs');
const output=join(HOME,'receipts/T4-P9C-student-continuation.json');atomicJson(output,{scope:'train-only frozen greedy student continuation; current round only, not new strong evidence or model accuracy',mainNewUpdates:0,newLabels:0,currentRoundLeaves:8,completeMatchLeaves:rows.flatMap(r=>r.leaves).filter(l=>l.completeMatch).length,mainInputsUnchanged:true,inputSHA256:before,numericalCodeIdentity:codeIdentity(),rows});console.log(JSON.stringify({output,rows:rows.map(r=>({root:r.rootId,policy:r.student.policyId,lower:r.normalizedDifferenceLowerBound,leaves:r.leaves.map((l:any)=>({action:l.actionName,g:l.g,W:l.W,y:l.y}))}))}));
