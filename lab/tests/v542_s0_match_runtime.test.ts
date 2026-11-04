import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('../review6_2/task-control.mjs',()=>({createTaskController:(config:any)=>config}));
import {mkdtempSync,realpathSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import * as engine from '@gd/engine';
import {createMatch,startGame,DEFAULT_RULES,legalCombos,canPass,applyMove,type GameState} from '@gd/engine';
import {MLP} from '../../packages/ai/src/nn/mlp';
import {PublicTracker} from '../../packages/ai/src/nn/schema';
import {STUDENT_SCORER_ENCODER} from '../../packages/ai/src/policy/descriptor';
import {dedupCandidates} from '../../packages/ai/src/nn/neuralSeat';
import {createDecisionBundle} from '../../packages/ai/src/hybrid/candidates';
import {rerankStudent423InitialCandidates} from '../../packages/ai/src/hybrid/student';
import {captureInitialCandidateInputs,captureStudentCandidateInputs,MatchRecorder,createMatchStore} from '../review6_2/match-record';
import {createMatchTaskHost} from '../review6_2/match-consumer';
import {digest} from '../review6_2/task-schema.mjs';
import {firstRoundContinuation} from '../review6_2/first-round-screen-runtime';
import {runCompleteMatchAsync} from '../review6_2/match-play-async';
const policy={candidateSpec:'first-target-offer12-v1',enumSpec:{id:'full-house-attachment-ranks-v1',enumerationMode:'all_supported_attachment_ranks'}} as const;
const encoder={schema:'v2',ctxFill:'rule-context',passEncoding:'action64'} as const;
const identity={policyId:'synthetic-B',inputDim:399,encoderVersion:'gd-lab-schema-v4'} as any;
const scorer={schema:'ohuo-student-scorer-v1',policyId:'synthetic-S0',modelVersion:'fixture',architectureId:'mlp-tanh-256x256-scalar-v1',weightsLayoutVersion:'f32le-layer-w-row-major-then-b-v1',parameterCount:174593,inputDim:423,weightsPathOrUrl:{nodePath:'lab/out/synthetic-not-read.f32'},weightsSHA256:'1'.repeat(64),encoder:STUDENT_SCORER_ENCODER,tieBreakId:'first-candidate-v1'} as const;
function setup(){
 const state=startGame(createMatch({...DEFAULT_RULES},43));state.turn=0;state.leader=0;state.lastPlayer=0;
 // Synthetic seeded origin; one decision, no source index, private records or weights.
 const forward=vi.fn((_x:Float32Array,n:number)=>Float32Array.from({length:n},()=>1));
 const network={inputDim:423,forward} as unknown as MLP,student={studentParentRef:'fixture@sha256:'+'2'.repeat(64),scorer,network};
 const decide=(s:GameState)=>{const rows=dedupCandidates(legalCombos(s,policy.enumSpec.enumerationMode),canPass(s));return {move:rows[0].combo?{pass:false as const,combo:rows[0].combo}:{pass:true as const},nCands:rows.length,explored:false,candidatePolicy:policy,ranking:rows.map((r,idx)=>({combo:r.combo,idx,score:rows.length-idx}))};};
 const createDecider=(seat:number)=>{const tracker=new PublicTracker();return {seat,tracker,newGame(){tracker.reset();},observe(events:any){tracker.observe(events);},decide};};
 const bundleFor=(s:GameState,steps:any[]=[])=>createDecisionBundle({state:s,actorSeat:s.turn,key:{controllerOrRunnerGeneration:'fixture',matchId:'fixture',gameNo:1,moveNo:s.moveNo,actorSeat:s.turn,requestSeq:s.moveNo},decisionId:'fixture-'+s.moveNo,matchId:'fixture',history:{matchId:'fixture',gameNo:1,throughMoveNo:s.moveNo,steps},decider:createDecider(s.turn),candidatePolicy:policy});
 return {state,forward,network,student,createDecider,bundleFor};
}
afterEach(()=>vi.restoreAllMocks());
describe('S0 same-decision forward reuse',()=>{
 it('screen continuation uses one forward and preserves original-index tie action',()=>{
  const f=setup(),bundle=f.bundleFor(f.state);
  const proposal={identity,encoder,candidatePolicy:policy,createDecider:f.createDecider},parent={basePolicyIdentity:identity,scorer,network:f.network,parentPath:'synthetic-not-read',studentCapture:f.student};
  const c=firstRoundContinuation({actor:0,proposalRef:'B@sha256:'+'3'.repeat(64),parentRef:f.student.studentParentRef,proposal,parent,otherPolicies:[null,...[1,2,3].map(i=>({policyId:'other'+i,kind:'heuristic',difficulty:0}))]});
  const driver=c.forWorld(1).seatFactory(c.profile.seats[0].policy,0);driver.newGame(f.state,[]);const move=driver.decide(f.state);
  const rows=bundle.initialCandidateIds.map(id=>bundle.pool.find(c=>c.actionId===id)!),best=rows.reduce((a,b)=>a.originalIndex<b.originalIndex?a:b);
  expect(move).toEqual(best.canonical?{pass:false,combo:best.canonical}:{pass:true});
  expect(f.forward).toHaveBeenCalledTimes(1);
 });
 it('reuses only fresh frozen capture; disk clones, new candidates and S1 still forward',()=>{
  const f=setup(),bundle=f.bundleFor(f.state),tracker=new PublicTracker(),base=captureInitialCandidateInputs({bundle,state:f.state,tracker,encoder,policyIdentity:identity});
  const input=captureStudentCandidateInputs({bundle,state:f.state,tracker,candidateInputs:base,student:f.student});
  const fresh=rerankStudent423InitialCandidates(bundle,input,f.network);
  expect(fresh).toEqual({actionId:input.baseActionId,scores:input.rawQ});expect(f.forward).toHaveBeenCalledTimes(1);
  const disk=JSON.parse(JSON.stringify(input));disk.rawQ.fill(999);disk.baseActionId='bad';expect(rerankStudent423InitialCandidates(bundle,disk,f.network)).toEqual(fresh);expect(f.forward).toHaveBeenCalledTimes(2);
  const s1={inputDim:423,forward:vi.fn((_x:Float32Array,n:number)=>Float32Array.from({length:n},(_,i)=>i))} as unknown as MLP;
  const choice=rerankStudent423InitialCandidates(bundle,input,s1);expect(s1.forward).toHaveBeenCalledTimes(1);expect(choice.actionId).toBe(input.candidateIds.at(-1));
  rerankStudent423InitialCandidates(f.bundleFor(f.state),input,f.network);expect(f.forward).toHaveBeenCalledTimes(3);
  rerankStudent423InitialCandidates(bundle,input,f.network);expect(f.forward).toHaveBeenCalledTimes(4); // The capture witness is consumed once.
  expect(Object.isFrozen(input.candidateFeatures[0])).toBe(true);
  expect(()=>rerankStudent423InitialCandidates(bundle,{...disk,candidateIds:[...disk.candidateIds].reverse()},f.network)).toThrow(/order/);
  expect(()=>rerankStudent423InitialCandidates(bundle,{...disk,candidateFeatures:disk.candidateFeatures.map((r:number[],i:number)=>i?r:r.map(()=>NaN))},f.network)).toThrow(/finite/);
 });
 it('actual async local-selector path retains the one-forward capture',async()=>{
  const f=setup(),abort=new AbortController(),id={runId:'fixture',matchId:'fixture',sourceRef:'synthetic',layoutRef:'fixture',policyIds:['S0','B1','B2','B3'],rules:DEFAULT_RULES},recorder=new MatchRecorder(id);recorder.beginGame(f.state);
  const seats=id.policyIds.map((policyId,seat)=>({policyId,source:seat===0?'S' as const:'B' as const,mode:'local' as const,decider:f.createDecider(seat),encoder,policyIdentity:identity,candidatePolicy:policy,...(seat===0?{studentCapture:f.student,localSelector:({bundle,studentInputs}:any)=>rerankStudent423InitialCandidates(bundle,studentInputs,f.network).actionId}:{})}));
  const result=await runCompleteMatchAsync({...id,generation:'fixture',seed:43,dealNamespace:'synthetic',maxGames:1,maxMovesPerGame:8,actor:0,signal:abort.signal,deadlineMonotonicMs:performance.now()+5000,recorder,resume:recorder.snapshot(),seats,afterBoundary:async()=>{abort.abort('user_stop');}});
  expect(result.incompleteReason).toBe('user_stop');expect(recorder.snapshot().record.decisions[0].executionKind).toBe('confirmed');expect(f.forward).toHaveBeenCalledTimes(1);
 });
});

it('preserves a dynamic follow C including PASS and rejects nonfinite or shortened scores',()=>{
 const f=setup(),priorTarget=null,events=applyMove(f.state,{pass:false,combo:legalCombos(f.state)[0]}),tracker=new PublicTracker();tracker.observe(events);const bundle=f.bundleFor(f.state,[{priorTarget,events}]),base=captureInitialCandidateInputs({bundle,state:f.state,tracker,encoder,policyIdentity:identity});
 const passId=bundle.initialCandidateIds.find(id=>bundle.pool.find(c=>c.actionId===id)!.canonical===null);expect(passId).toBeDefined();
 f.forward.mockImplementation((x:Float32Array,n:number)=>Float32Array.from({length:n},(_,i)=>x[i*423+395]));
 const input=captureStudentCandidateInputs({bundle,state:f.state,tracker,candidateInputs:base,student:f.student});expect(input.candidateIds).toEqual(bundle.initialCandidateIds);expect(input.baseActionId).toBe(passId);expect(rerankStudent423InitialCandidates(bundle,input,f.network)).toEqual({actionId:passId,scores:input.rawQ});expect(f.forward).toHaveBeenCalledTimes(1);
 for(const scores of [Float32Array.of(NaN),new Float32Array(0)]){f.forward.mockReturnValue(scores);expect(()=>captureStudentCandidateInputs({bundle,state:f.state,tracker,candidateInputs:base,student:f.student})).toThrow(/nonfinite/);}
});
it('actual consumer resumes its task-bound S0 seat with one capture forward and one initial replay',async()=>{
 const f=setup(),directory=mkdtempSync(join(realpathSync(tmpdir()),'v542-consumer-')),abort=new AbortController(),sourcePath=join(directory,'index.json'),sourceBytes=JSON.stringify({version:1,families:{fixture:{split:'fixture'}}});writeFileSync(sourcePath,sourceBytes);
 const runtimeSeats=[0,1,2,3].map(()=>({policy:{identity,encoder,createDecider:f.createDecider},release:{mode:'local'},candidatePolicy:policy,studentCapture:f.student,s0Release:{policyId:'synthetic-S0'},profileRevisionRef:null})),seats=runtimeSeats.map((_,i)=>({releaseRef:'seat-'+i,mode:'local',profileRevisionRef:null})),recordIdentity={runId:'fixture',matchId:'fixture',sourceRef:'synthetic-index',layoutRef:'synthetic-queue',policyIds:runtimeSeats.map(s=>s.s0Release.policyId),rules:DEFAULT_RULES,sourceFamilyId:'fixture',split:'fixture',evaluatedActor:0,seatSnapshots:runtimeSeats.map((s,i)=>({releaseRef:seats[i].releaseRef,release:s.release,candidatePolicy:s.candidatePolicy,policyIdentity:s.policy.identity,s0Release:s.s0Release,profileRevisionRef:null}))};
 const store=createMatchStore(directory,recordIdentity);store.recorder.beginGame(f.state,'fixture');const key={controllerOrRunnerGeneration:'prefix',matchId:'fixture',gameNo:1,moveNo:0,actorSeat:0,requestSeq:0},move={pass:false as const,combo:legalCombos(f.state)[0]};store.recorder.beginDecision({key,policyId:'synthetic-S0',initialCandidateIds:['prefix'],offeredIds:['prefix']});const events=applyMove(f.state,move);store.recorder.confirmAction({key,move,events,priorTarget:null,actionId:'prefix',requestedActionId:null,source:'S',status:'selected'});store.recorder.finishDecision({key,status:'selected',reason:null,elapsedMs:0,offeredIds:['prefix'],requests:[]});
 const task={runId:'fixture',taskId:'fixture',outputRoot:directory,seatLayoutPlan:'synthetic-queue',sourcePlan:{sourceIndexRef:'synthetic-index'},limits:{}},checkpoint={schema:'ohuo-match-run-v1',taskSHA256:digest(task),queueRef:task.seatLayoutPlan,cursor:0,active:{matchId:'fixture',kind:'hybrid',recordRef:store.ref()},matches:[],executionUnknown:false},row={matchId:'fixture',layoutId:'fixture',sourceFamilyId:'fixture',split:'fixture',actor:0,seed:43,dealNamespace:'fixture',maxGames:1,maxMovesPerGame:8,seats,runtimeSeats};
 const host:any=createMatchTaskHost({root:directory,adapter:{}}),apply=vi.spyOn(engine,'applyMove'),reserve=vi.fn(()=>{throw Error('resume cannot reserve another match');}),saved:any[]=[];
 // A new attempt cannot borrow the verified replay to bypass task identity.
 const changed={...task,runId:'other'},badCheckpoint={...checkpoint,taskSHA256:digest(changed)};await expect(host.consumers[0].run({task:changed,executionInputs:{rows:[row],rules:DEFAULT_RULES,sourceIndexPath:sourcePath,sourceIndexSHA256:createHash('sha256').update(sourceBytes).digest('hex')},checkpoint:badCheckpoint,checkpointSequence:0,signal:new AbortController().signal,deadlineMonotonicMs:performance.now()+5000,reserve,settleReservation:vi.fn(),saveCheckpoint:async()=>{},getConsumption:()=>({})})).rejects.toThrow(/recovery record identity differs/);
 apply.mockClear();
 const result=await host.consumers[0].run({task,executionInputs:{rows:[row],rules:DEFAULT_RULES,sourceIndexPath:sourcePath,sourceIndexSHA256:createHash('sha256').update(sourceBytes).digest('hex')},checkpoint,checkpointSequence:0,executionId:'fixture',signal:abort.signal,deadlineMonotonicMs:performance.now()+5000,reserve,settleReservation:vi.fn(),saveCheckpoint:async(cp:any)=>{saved.push(structuredClone(cp));abort.abort('user_stop');},getConsumption:()=>({})});
 expect(result.completed).toBe(false);expect(reserve).not.toHaveBeenCalled();expect(saved.at(-1).active.recordRef.journalBytes).toBeGreaterThan(store.ref().journalBytes);expect(f.forward).toHaveBeenCalledTimes(1);expect(apply).toHaveBeenCalledTimes(4);

});
