/** NAV-R13 actual narrow bridge to the existing legal-world/full-match runner.
 * It never changes source/teacher labels, invents worlds or shortens continuation. */
import {isDeepStrictEqual as equal} from 'node:util';
import {evaluateTeacherBranch,type TeacherRootInput} from '../review6/teacher-engine';
import {toVisibleRoot,sampleVisibleWorld} from '../review6/visible-world';
import {driverFor,type PolicySpec,type SeatDriver,type PublicStep} from '../review6/match-play';
import {necessaryDeclarationKey} from '../review6/action-effect';
import {createDecisionBundle} from '../../packages/ai/src/hybrid/candidates';
import {rerankStudent423InitialCandidates} from '../../packages/ai/src/hybrid/student';
import {canonicalActionId,resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import {captureInitialCandidateInputs,captureStudentCandidateInputs} from './match-record';
import {freezeFirstRoundScreenActions} from './first-round-screen-actions';
import {screenFirstRoundBranches} from './first-round-screen.mjs';
import {firstRoundS0PolicyId} from './match-consumer';
import {digest,strictObject,fixedReference} from './task-schema.mjs';
import type {OfflineSnapshot} from './offline-label-source';
export function firstRoundTeacherRoot(s:OfflineSnapshot):TeacherRootInput{return teacherRoot(s,false);}
export function commonViewTeacherRoot(s:OfflineSnapshot):TeacherRootInput{return teacherRoot(s,true);}
function teacherRoot(s:OfflineSnapshot,commonView:boolean):TeacherRootInput{
 const captured=s.input.studentInputs;if(!captured||captured.inputDim!==423)throw Error('screen original423 capture required');
 const observedBefore=toVisibleRoot(s.state,s.history.steps.map(r=>({events:[...r.events],priorTarget:r.priorTarget})));
 // These old331 gaps are not silently fixed by high-card memory24. An explicit
 // verified hard-check record must not pretend absent tribute information exists.
 if(!commonView&&observedBefore.representationGaps.length)throw Error('student_information_gap');
 const allCandidates=s.bundle.initialCandidateIds.map((actionId,index)=>{const c=s.bundle.pool.find(c=>c.actionId===actionId)!;const move=resolveLegalMove(s.state,c.canonical===null?{pass:true}:{pass:false,combo:c.canonical});if(canonicalActionId(move.pass?null:move.combo!,s.state.ctx)!==c.canonicalId)throw Error('screen frozen canonical mismatch');return {index,actionId,actionKey:necessaryDeclarationKey(move.pass?null:move.combo!,s.state.ctx),move,features68:s.input.candidateInputs!.candidateFeatures[index].slice(331,399)};});
 return {rootId:s.bundle.decisionId,slot:0,observedBefore,allCandidates,actualActionId:s.decision.actualActionId!,category:'first-round-partner-control',caseThresholds:{minimumOpponentCount:0,urgentOpponentMaximum:0}};
}
/** A finite, predeclared input list, not an experimental lifetime ceiling. */
export function validateCommonViewWorldBatch(batch:any,protocolRef:string){
 fixedReference(protocolRef,'commonViewProtocolRef');
 strictObject(batch,'commonViewWorldBatch',['schema','protocolRef','batchId','precisionTarget','worlds']);
 if(batch.schema!=='ohuo-common-view-world-batch-r2'||batch.protocolRef!==protocolRef||typeof batch.batchId!=='string'||!batch.batchId||typeof batch.precisionTarget!=='string'||!batch.precisionTarget||!Array.isArray(batch.worlds)||!batch.worlds.length)throw Error('common_view_world_batch_identity');
 for(const w of batch.worlds){strictObject(w,'commonViewWorld',['worldId','seed']);if(typeof w.worldId!=='string'||!w.worldId||!Number.isSafeInteger(w.seed)||w.seed<0)throw Error('common_view_world_identity');}
 if(new Set(batch.worlds.map((w:any)=>w.worldId)).size!==batch.worlds.length||new Set(batch.worlds.map((w:any)=>w.seed)).size!==batch.worlds.length)throw Error('common_view_world_seed_collision');
 return batch;
}
/** Called ONLY inside the admitted Task run. Legal sampler work is charged to
 * that run's elapsed accounting. The original private checkpoint owns sampled
 * hands; none of this cache is a teacher-visible message. Resume preserves the
 * exact prefix and failure: no seed replacement or true hidden-hand fallback. */
export async function prepareCommonViewWorlds(snapshot:OfflineSnapshot,{ctx,batchPlan,checkpoint=null,onCheckpoint}:any){
 if(ctx.executionBoundary?.mode!=='input-workload-only'||typeof ctx.executionBoundary.resourcePolicyRef!=='string'||typeof onCheckpoint!=='function')throw Error('common_view_world_owned_run_required');
 validateCommonViewWorldBatch(batchPlan,ctx.task.scientificContract.analysisMethodRef);
 const root=commonViewTeacherRoot(snapshot),observationSHA256=root.observedBefore.observationSHA256;
 const cp=checkpoint?structuredClone(checkpoint):{schema:'ohuo-common-view-world-cache-r2',inputSHA256:snapshot.row.inputSHA256,observationSHA256,batchPlan:structuredClone(batchPlan),cursor:0,worlds:[],failure:null};
 strictObject(cp,'commonViewWorldCache',['schema','inputSHA256','observationSHA256','batchPlan','cursor','worlds','failure']);
 if(cp.schema!=='ohuo-common-view-world-cache-r2'||cp.inputSHA256!==snapshot.row.inputSHA256||cp.observationSHA256!==observationSHA256||!equal(cp.batchPlan,batchPlan)||!Array.isArray(cp.worlds)||cp.cursor!==cp.worlds.length||cp.cursor>batchPlan.worlds.length)throw Error('common_view_world_checkpoint_identity');
 for(let i=0;i<cp.worlds.length;i++){const row=cp.worlds[i],w=batchPlan.worlds[i];if(row.worldId!==w.worldId||row.seed!==w.seed||row.sample?.seed!==w.seed||row.sample.observationSHA256!==observationSHA256||digest(row.sample)!==row.sampleSHA256)throw Error('common_view_world_checkpoint_sample');}
 if(cp.failure!==null){strictObject(cp.failure,'commonViewWorldFailure',['worldId','reason']);if(cp.failure.worldId!==batchPlan.worlds[cp.cursor]?.worldId||cp.failure.reason!=='legal_world_unavailable')throw Error('common_view_world_checkpoint_failure');}
 while(cp.cursor<batchPlan.worlds.length&&!cp.failure){
  if(ctx.signal.aborted)break;
  const w=batchPlan.worlds[cp.cursor];let sample;
  try{sample=sampleVisibleWorld(root.observedBefore,w.seed,4096);}catch(error){
   if(!(error instanceof Error)||!error.message.startsWith('bounded legal-world sampler exhausted without substituting true hidden cards: '))throw error;
   cp.failure={worldId:w.worldId,reason:'legal_world_unavailable'};await onCheckpoint(structuredClone(cp));break;
  }
  cp.worlds.push({worldId:w.worldId,seed:w.seed,sample,sampleSHA256:digest(sample)});cp.cursor++;await onCheckpoint(structuredClone(cp));
 }
 return{status:cp.failure?'unavailable':cp.cursor===batchPlan.worlds.length?'prepared':'interrupted',root,checkpoint:cp,worlds:cp.worlds,representationGaps:[...root.observedBefore.representationGaps]};
}
/** All four policy identities are fixed before any branch. Registry membership
 * and receipt/weights verification are host caller obligations, not task code. */
export function firstRoundContinuation({actor,proposalRef,parentRef,proposal,parent,otherPolicies}:any){
 if(!Number.isInteger(actor)||actor<0||actor>3||!equal(JSON.parse(JSON.stringify(proposal.identity)),JSON.parse(JSON.stringify(parent.basePolicyIdentity)))||otherPolicies.length!==4||otherPolicies[actor]!==null)throw Error('first-round continuation identities');
 const policyId=firstRoundS0PolicyId(proposalRef,parentRef),actorPolicy:PolicySpec={policyId,kind:'neural',weightsPath:parent.parentPath,weightsSHA256:parent.scorer.weightsSHA256,inputDim:423,encoder:proposal.encoder,epsilon:0};
 const policies=otherPolicies.map((p:any,i:number)=>i===actor?actorPolicy:p);
 if(policies.some((p:any)=>!p||typeof p.policyId!=='string'))throw Error('four frozen continuation policies required');
 const binding=JSON.parse(JSON.stringify({schema:'ohuo-first-round-continuation-v1',proposalRef,parentRef,proposalIdentity:proposal.identity,scorer:parent.scorer,actor,policies}));
 const profile:any={profileName:'primary',actingSeat:actor,partnerSeat:(actor+2)%4,opponentSeats:[(actor+1)%4,(actor+3)%4],planControlledSeats:[],seats:policies.map((policy:any,seat:number)=>({seat,policyId:policy.policyId,policy})),rngMode:'counter-per-decision',futureDealMode:'indexed-deal-v1',profileSHA256:digest(binding)};
 const forWorld=(seed:number)=>({profile,seatFactory:(spec:PolicySpec,seat:number):SeatDriver=>{
  if(!equal(spec,policies[seat]))throw Error('continuation frozen seat spec differs');
  if(seat!==actor)return driverFor(spec,seat,{seed,policies,rngMode:'counter-per-decision',dealMode:'indexed-deal-v1',dealNamespace:'review6-teacher-paired-future-deal-v1',inferenceExecution:'original'});
  const decider=proposal.createDecider(actor);let history:PublicStep[]=[],sequence=0;
  return {policyId,newGame(_state,prefix){history=structuredClone(prefix);sequence=0;decider.newGame();for(const r of prefix)decider.observe(r.events);},observe(events,priorTarget){history.push({events:structuredClone(events),priorTarget:structuredClone(priorTarget)});decider.observe(events);},decide(state){
   const matchId='first-round-continuation-'+seed,key={controllerOrRunnerGeneration:'first-round-continuation-v1',matchId,gameNo:state.match.gameNo,moveNo:state.moveNo,actorSeat:actor,requestSeq:sequence++},bundle=createDecisionBundle({state,actorSeat:actor,key,decisionId:matchId+'-'+state.match.gameNo+'-'+state.moveNo,matchId,history:{matchId,gameNo:state.match.gameNo,throughMoveNo:state.moveNo,steps:history},decider,candidatePolicy:proposal.candidatePolicy});
   const candidateInputs=captureInitialCandidateInputs({bundle,state,tracker:decider.tracker,encoder:proposal.encoder,policyIdentity:proposal.identity}),inputs=captureStudentCandidateInputs({bundle,state,tracker:decider.tracker,candidateInputs,student:parent.studentCapture}),choice=rerankStudent423InitialCandidates(bundle,inputs,parent.network),c=bundle.pool.find(c=>c.actionId===choice.actionId)!;
   return resolveLegalMove(state,c.canonical===null?{pass:true}:{pass:false,combo:c.canonical});
  }};
 }});
 return {binding,profile,forWorld};
}
export function freezeFirstRoundScreenPlan({snapshot:s,proposalActionId,worlds,continuation,comparisonBatch,frozenWorlds}:any){
 const commonView=comparisonBatch?.schema==='ohuo-common-view-world-batch-r2',root=commonView?commonViewTeacherRoot(s):firstRoundTeacherRoot(s),captured=s.input.studentInputs;
 if(commonView){validateCommonViewWorldBatch(comparisonBatch,comparisonBatch.protocolRef);if(!equal(worlds,comparisonBatch.worlds)||!Array.isArray(frozenWorlds)||frozenWorlds.length!==worlds.length||frozenWorlds.some((x:any,i:number)=>x.worldId!==worlds[i].worldId||x.seed!==worlds[i].seed||x.sample?.observationSHA256!==root.observedBefore.observationSHA256||x.sample?.seed!==x.seed||digest(x.sample)!==x.sampleSHA256))throw Error('screen_prefrozen_actual_worlds_required');}
 if(!Array.isArray(worlds)||(commonView?worlds.length<1:worlds.length!==4)||worlds.some(w=>!Number.isSafeInteger(w.seed)||w.seed<0||typeof w.worldId!=='string')||new Set(worlds.map(w=>w.seed)).size!==worlds.length||new Set(worlds.map(w=>w.worldId)).size!==worlds.length)throw Error('fixed four independent worlds required');
 const candidates=s.bundle.initialCandidateIds.map((id:string)=>s.bundle.pool.find((c:any)=>c.actionId===id)),actions=freezeFirstRoundScreenActions({state:s.state,actorSeat:s.row.actorSeat,candidates,proposalActionId,baselineActionId:captured.baseActionId});
 const plan={schema:'ohuo-first-round-screen-plan-v1',...(commonView?{comparisonBatch:structuredClone(comparisonBatch),worldSamples:frozenWorlds.map((w:any)=>({worldId:w.worldId,sampleSHA256:w.sampleSHA256,hiddenLayoutSHA256:w.sample.hiddenLayoutSHA256}))}:{}),inputSHA256:s.row.inputSHA256,rootId:root.rootId,observationSHA256:root.observedBefore.observationSHA256,proposalActionId,baselineActionId:captured.baseActionId,candidateSpec:s.input.candidateSpec,candidateIds:s.bundle.initialCandidateIds,actions,worlds:structuredClone(worlds),continuation:continuation.binding,profileSHA256:continuation.profile.profileSHA256,policyIds:continuation.profile.seats.map((s:any)=>s.policyId)};
 return {plan,planSHA256:digest(plan),root,...(commonView?{frozenWorlds}:{})};
}
export function executeFirstRoundScreenBranch({root,plan,continuation,worldId,actionId,deadlineMonotonicMs,executionBoundary,frozenWorlds}:any){
 const world=plan.worlds.find((w:any)=>w.worldId===worldId),action=plan.actions.find((a:any)=>a.actionId===actionId),candidate=root.allCandidates.find((c:any)=>c.actionId===actionId);
 if(!world||!action||!candidate||!equal(plan.continuation,continuation.binding)||plan.profileSHA256!==continuation.profile.profileSHA256||!equal(candidate.move,action.move))throw Error('screen branch outside frozen plan');
 // Empty registry cannot affect this explicit trusted continuation overload.
 // The old path still resolves its original registry/profile without changes.
 const commonView=plan.comparisonBatch?.schema==='ohuo-common-view-world-batch-r2',frozen=commonView?frozenWorlds?.find((w:any)=>w.worldId===worldId):null;
 if(commonView&&(executionBoundary?.mode!=='input-workload-only'||!frozen||frozen.sampleSHA256!==plan.worldSamples?.find((w:any)=>w.worldId===worldId)?.sampleSHA256))throw Error('screen_actual_world_or_run_boundary_missing');
 const result=evaluateTeacherBranch(root,{} as any,'primary',world,actionId,null,deadlineMonotonicMs,'original',{...continuation.forWorld(world.seed),...(commonView?{frozenSample:frozen.sample,executionBoundary}:{})});
 if(!equal(result.policyIds,plan.policyIds)||result.profileSHA256!==plan.profileSHA256||result.firstActionKey!==null&&result.firstActionKey!==candidate.actionKey)throw Error('actual forced move/continuation identity differs');
 if(result.complete&&result.firstActionKey!==candidate.actionKey)throw Error('complete branch did not execute forced canonical root');
 return {worldId,actionId,result};
}
export function summarizeFirstRoundScreen(plan:any,results:any[]){return screenFirstRoundBranches({proposalActionId:plan.proposalActionId,actions:plan.actions,worlds:plan.worlds,profileSHA256:plan.profileSHA256,policyIds:plan.policyIds,results,...(plan.comparisonBatch?{comparisonBatch:plan.comparisonBatch}:{})});}
