/** Direct bridge inside the existing capture-freeze fixed case. Deadline is
 * already expired: legal world sampling runs, no continuation move is played. */
import assert from 'node:assert/strict';
import {firstRoundContinuation,freezeFirstRoundScreenPlan,executeFirstRoundScreenBranch,summarizeFirstRoundScreen} from '../first-round-screen-runtime';
import {PublicTracker} from '../../../packages/ai/src/nn/schema';
import {checkFirstRoundScreenMeter} from './first-round-screen-meter-smoke';
export async function checkFirstRoundRuntime({snapshot,identity,encoder,policy,student,highId,directory,decide}:any){
 const proposal={identity,encoder,candidatePolicy:policy,createDecider:(seat:number)=>({seat,tracker:new PublicTracker(),newGame(){this.tracker.reset();},observe(events:any){this.tracker.observe(events);},decide})},parent={basePolicyIdentity:identity,scorer:student.scorer,network:student.network,parentPath:student.scorer.weightsPathOrUrl.nodePath,studentCapture:student};
 const continuation=firstRoundContinuation({actor:0,proposalRef:'fixture-B-prime@sha256:'+'1'.repeat(64),parentRef:student.studentParentRef,proposal,parent,otherPolicies:[null,{policyId:'fixture-O1',kind:'heuristic',difficulty:0},{policyId:'fixture-partner',kind:'heuristic',difficulty:0},{policyId:'fixture-O2',kind:'heuristic',difficulty:0}]}),worlds=[31,41,59,67].map((seed,i)=>({worldId:'fixed-world-'+i,seed}));
 const frozen=freezeFirstRoundScreenPlan({snapshot,proposalActionId:highId,worlds,continuation});
 assert(frozen.plan.actions.some((a:any)=>a.actionId===highId));assert(frozen.plan.actions.length>=2&&frozen.plan.actions.length<=3);
 const row=executeFirstRoundScreenBranch({root:frozen.root,plan:frozen.plan,continuation,worldId:worlds[0].worldId,actionId:highId,deadlineMonotonicMs:0});
 assert.equal(row.result.complete,false);assert.equal(row.result.W,null);assert.equal(row.result.decisions,0);assert.equal(row.result.incompleteReason,'deadline');assert.deepEqual(row.result.policyIds,frozen.plan.policyIds);assert.equal(summarizeFirstRoundScreen(frozen.plan,[row]).status,'incomplete');
 const bad={...continuation,forWorld:(seed:number)=>{const actual=continuation.forWorld(seed);return {...actual,seatFactory:(spec:any,seat:number)=>({...actual.seatFactory(spec,seat),policyId:'wrong'})};}};
 assert.throws(()=>executeFirstRoundScreenBranch({root:frozen.root,plan:frozen.plan,continuation:bad,worldId:worlds[0].worldId,actionId:highId,deadlineMonotonicMs:0}),/actual continuation driver differs/);
 const actor=continuation.forWorld(worlds[0].seed).seatFactory(continuation.profile.seats[0].policy,0);actor.newGame(snapshot.state,snapshot.history.steps);const choice=actor.decide(snapshot.state);assert(choice.pass===true||choice.combo,'actual423 continuation returns a legal move');
 const metering=await checkFirstRoundScreenMeter({directory,root:frozen.root,plan:frozen.plan,continuation});
 return {metering,actualSampler:true,actualTeacherBranch:true,actualSeatFactory:true,actualActor423Decide:true,profileIdentityRejected:true,frozenActualC:true,fullContinuationCapsUnchanged:true,incompleteNull:true,continuationMoves:0,completedMatches:0};
}

import {runCompleteMatchAsync} from '../match-play-async';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export async function checkFirstRoundMatchRuntime({root,identity,encoder,policy,student,decide}:any){
 const controller=new AbortController();let boundaries=0;
 const seats=[0,1,2,3].map(seat=>{const tracker=new PublicTracker();return {policyId:seat===0?identity.policyId:'fake',source:'B' as const,mode:'local' as const,decider:{seat,tracker,newGame(){tracker.reset();},observe(events:any){tracker.observe(events);},decide:(state:any)=>{assert.equal(seat,0,'fixed stop must precede other actor work');return decide(state);}},...(seat===0?{encoder,policyIdentity:identity,candidatePolicy:policy,studentCapture:student}:{})};});
 const identityRecord=root.recorder.snapshot().record;
 const result=await runCompleteMatchAsync({...identityRecord,generation:'fixed-first-round-runtime',seed:1,dealNamespace:'fixed-engineering',maxGames:1,maxMovesPerGame:2500,actor:0,signal:controller.signal,deadlineMonotonicMs:performance.now()+5000,recorder:root.recorder,resume:root.recorder.snapshot(),seats,afterBoundary:async()=>{boundaries++;controller.abort('user_stop');}});
 assert.equal(boundaries,1);assert.equal(result.complete,false);
 const saved=root.recorder.snapshot().record.decisions.at(-1)!;assert.equal(saved.key.actorSeat,0);assert.equal(saved.executionKind,'confirmed');assert.equal(saved.actualSource,'B');assert.equal(saved.policyId,identity.policyId);
 const captured=JSON.parse(readFileSync(join(root.store.ref().directory,`decision-${saved.key.requestSeq}.private.json`),'utf8'));assert.equal(captured.schema,'ohuo-decision-input-first-round-v3');assert.equal(captured.studentInputs.inputDim,423);assert.equal(captured.studentInputs.studentParentRef,student.studentParentRef);assert.deepEqual(captured.studentInputs.rawQ,[...student.network.forward(new Float32Array(captured.studentInputs.candidateFeatures.flat()),captured.studentInputs.candidateIds.length)]);
 return {actualAsyncDriver:true,BActingPreserved:true,S0CaptureActual:true,confirmedSingleActorAction:true,completeMatches:0,providerRequests:0};
}
