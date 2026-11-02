/** Async sibling of the preserved synchronous complete-match loop. Network is
 * outside CPU workers; every apply crosses B05's one-consumed-commit boundary. */
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {fixedReference,strictObject} from './task-schema.mjs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createMatch,startGame,applyMove,teamOf,type GameState,type GameResult} from '@gd/engine';
import {deriveSeed,type NeuralDecider,type EncoderOpts} from '@gd/ai';
import {createDecisionBundle} from '../../packages/ai/src/hybrid/candidates';
import {PendingDecision} from '../../packages/ai/src/hybrid/decide';
import {freezeCopy,type DecisionBundle} from '../../packages/ai/src/hybrid/protocol';
import {type RemoteRequest} from '../../packages/ai/src/hybrid/remote-selector';
import {resourceEffectKey} from '../review6/data-replay';
import type {CandidatePolicySpec} from '../../packages/ai/src/candidate-spec';
import type {ResolvedPolicy} from '../../packages/ai/src/policy/resolve';
import {MatchRecorder,replayConfirmedMatch,captureInitialCandidateInputs,captureStudentCandidateInputs,type StudentCapture,type StudentCandidateInputs,type RecordIdentity,type MatchRecord,type PrivateSources,type CandidateInputs} from './match-record';

export interface AsyncSeat {studentCapture?:StudentCapture;candidatePolicy?:CandidatePolicySpec;policyId:string;source:'B'|'S'|'O';mode:'local'|'hybrid';decider:Pick<NeuralDecider,'seat'|'decide'|'newGame'|'observe'>&Partial<Pick<NeuralDecider,'tracker'>>;encoder?:Readonly<EncoderOpts>;policyIdentity?:ResolvedPolicy['identity'];localSelector?:(input:{bundle:DecisionBundle;candidateInputs:CandidateInputs;studentInputs?:StudentCandidateInputs})=>string}
export interface AsyncMatchOptions extends RecordIdentity {
 generation:string;seed:number;dealNamespace:string;maxGames:number;maxMovesPerGame:number;actor:number;
 seats:AsyncSeat[];signal:AbortSignal;deadlineMonotonicMs?:number;executionBoundary?:{mode:'input-workload-only';resourcePolicyRef:string};recorder:MatchRecorder;
 resume?:{record:MatchRecord;privateSources:PrivateSources};
 requestForDecision?:(seat:number,bundle:DecisionBundle,cancel:(reason:string)=>void)=>RemoteRequest;
 beforeGame?:(state:GameState)=>string|void;
 afterBoundary?:()=>Promise<void>;
 drain?:()=>Promise<void>;
}
export async function runCompleteMatchAsync(o:AsyncMatchOptions){
 const matchStartedAt=performance.now(),inputWorkload=o.executionBoundary?.mode==='input-workload-only';
 if(inputWorkload){strictObject(o.executionBoundary,'executionBoundary',['mode','resourcePolicyRef']);fixedReference(o.executionBoundary!.resourcePolicyRef,'executionBoundary.resourcePolicyRef');if(Object.hasOwn(o,'deadlineMonotonicMs'))throw Error('input-workload match cannot carry an artificial deadline');}
 else if(o.executionBoundary!==undefined)throw Error('unsupported match execution boundary');
 if(o.seats.length!==4||!Number.isSafeInteger(o.seed)||!inputWorkload&&!Number.isFinite(o.deadlineMonotonicMs)||![o.maxGames,o.maxMovesPerGame].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isInteger(o.actor)||o.actor<0||o.actor>3)throw Error('finite fixed match inputs required');
 if(o.seats.some((s,i)=>s.policyId!==o.policyIds[i]||s.decider.seat!==i||s.mode==='hybrid'&&!o.requestForDecision||!!s.localSelector!==(s.source==='S')||s.localSelector&&s.mode!=='local'))throw Error('seat policy/mode identity mismatch');
 let state:GameState|null=null,match=createMatch({...o.rules},o.seed),stopReason:string|null=null,rootRoundResult:GameResult|null=null,pending:PendingDecision|null=null;
 if(o.resume){const replay=replayConfirmedMatch(o.resume.record,o.resume.privateSources);if(replay.executionUnknown||!replay.state||replay.complete)throw Error('nonrecoverable match checkpoint');state=replay.state;match=state.match;rootRoundResult=o.resume.record.decisions.flatMap(d=>d.events).find(e=>e.type==='gameEnd')?.result??null;if(state.over)state=null;}
 let requestSeq=o.recorder.snapshot().record.decisions.length;
 const expired=()=>!inputWorkload&&performance.now()>=o.deadlineMonotonicMs!;
 const stop=()=>pending?.cancel(typeof o.signal.reason==='string'?o.signal.reason:'user_stop');
 o.signal.addEventListener('abort',stop);const timer=inputWorkload?null:setTimeout(()=>pending?.cancel('run_boundary'),Math.max(0,o.deadlineMonotonicMs!-performance.now()));
 try{
  while(match.winner===null&&match.gameNo<o.maxGames+(state?1:0)){
   if(o.signal.aborted||expired()){stopReason=o.signal.aborted?(typeof o.signal.reason==='string'?o.signal.reason:'user_stop'):'run_boundary';break;}
   if(!state){match.rngState=deriveSeed(o.dealNamespace,o.seed,match.gameNo,'independent-future-deal');state=startGame(match);const family=o.beforeGame?.(state);o.recorder.beginGame(state,typeof family==='string'?family:undefined);await o.afterBoundary?.();}
   const prefix=o.recorder.history(state.match.gameNo);o.seats.forEach(s=>{s.decider.newGame();for(const step of prefix.steps)s.decider.observe([...step.events]);});
   while(!state.over&&state.moveNo<o.maxMovesPerGame){
    if(o.signal.aborted||expired()){stopReason=o.signal.aborted?(typeof o.signal.reason==='string'?o.signal.reason:'user_stop'):'run_boundary';break;}
    const seat=state.turn,key={controllerOrRunnerGeneration:o.generation,matchId:o.matchId,gameNo:match.gameNo,moveNo:state.moveNo,actorSeat:seat,requestSeq:requestSeq++};
    const bundle=createDecisionBundle({key,state,actorSeat:seat,decisionId:`${o.matchId}-g${match.gameNo}-m${state.moveNo}-q${key.requestSeq}`,matchId:o.matchId,history:o.recorder.history(match.gameNo),decider:o.seats[seat].decider,...(o.seats[seat].candidatePolicy?{candidatePolicy:o.seats[seat].candidatePolicy}:{})});
    const runtime=o.seats[seat],candidateInputs=runtime.encoder&&runtime.policyIdentity&&runtime.decider.tracker?captureInitialCandidateInputs({bundle,state,tracker:runtime.decider.tracker,encoder:runtime.encoder,policyIdentity:runtime.policyIdentity}):undefined;
    const studentInputs=runtime.studentCapture&&candidateInputs&&runtime.decider.tracker?captureStudentCandidateInputs({bundle,state,tracker:runtime.decider.tracker,candidateInputs,student:runtime.studentCapture}):undefined;
    if(runtime.studentCapture&&!studentInputs)throw Error('first-round capture unavailable');
    o.recorder.beginDecision({key,policyId:runtime.policyId,initialCandidateIds:bundle.initialCandidateIds,offeredIds:bundle.offeredIds,bundle,...(candidateInputs?{candidateInputs}:{}),...(studentInputs?{studentInputs}:{})});
    const started=performance.now();let localActionId:string|undefined;
    if(runtime.localSelector){
     try{
      if(!candidateInputs||candidateInputs.inputDim!==399||!isDeepStrictEqual(candidateInputs.policyIdentity,runtime.policyIdentity)||!isDeepStrictEqual(candidateInputs.candidateIds,bundle.initialCandidateIds))throw Error('S requires the exact B initial-C inputs');
      localActionId=bundle.isUniqueLegalAction?bundle.fallbackActionId:runtime.localSelector({bundle,candidateInputs:freezeCopy(candidateInputs),...(studentInputs?{studentInputs:freezeCopy(studentInputs)}:{})});
      if(!bundle.initialCandidateIds.includes(localActionId))throw Error('S must choose initial C');
     }catch{stopReason='local_selector_invalid';o.recorder.finishDecision({key,status:'halted',reason:stopReason,elapsedMs:performance.now()-started,offeredIds:bundle.offeredIds,requests:[]});await o.afterBoundary?.();break;}
    }
    pending=new PendingDecision({bundle,...(localActionId?{localActionId}:{}),owner:{state:()=>state,isCurrent:k=>!o.signal.aborted&&!expired()&&k.controllerOrRunnerGeneration===o.generation&&k.matchId===o.matchId&&k.gameNo===state?.match.gameNo&&k.moveNo===state.moveNo&&k.actorSeat===state.turn,
     apply(move,outcome){
      const priorTarget=structuredClone(state!.lastCombo),events=applyMove(state!,move);
      o.recorder.confirmAction({key,move,events,priorTarget,actionId:outcome.actionId!,requestedActionId:outcome.source==='remote'?outcome.actionId!:null,source:outcome.source==='local'?o.seats[seat].source:outcome.source==='remote_failure'?'fallback':outcome.source!,status:outcome.status as 'selected'|'fallback'});
      o.seats.forEach(s=>s.decider.observe(events));
     }},...(o.seats[seat].mode==='hybrid'?{request:o.requestForDecision!(seat,bundle,reason=>pending?.cancel(reason))}:{})});
    if(o.signal.aborted||expired())pending.cancel(expired()?'run_boundary':'user_stop');
    const outcome=await pending.start();let remote;
    try{remote=await pending.remoteSettled;await o.drain?.();}catch{stopReason='execution_uncertain';o.recorder.finishDecision({key,status:'halted',reason:stopReason,elapsedMs:performance.now()-started,offeredIds:outcome.offeredIds,requests:[{requestCount:null}]});break;}
    const reason=outcome.reason==='stale'&&expired()?'run_boundary':outcome.reason??null;
    o.recorder.finishDecision({key,status:outcome.status,reason,elapsedMs:performance.now()-started,offeredIds:outcome.offeredIds,requests:(remote?.attempts??[]).map(a=>({...a}))});
    await o.afterBoundary?.();pending=null;
    if(outcome.status==='cancelled'||outcome.status==='halted'){stopReason=reason??outcome.status;break;}
    // Local/unique microtasks must not starve the owner's stop/status timer.
    await yieldTurn();
   }
   if(stopReason)break;
   if(!state.result){stopReason='round_move_cap';break;}
   rootRoundResult??=state.result;state=null;
  }
 }finally{try{pending?.cancel(stopReason??'run_boundary');if(pending)await pending.remoteSettled.catch(()=>{stopReason='execution_uncertain';});await o.drain?.();}finally{if(timer!==null)clearTimeout(timer);o.signal.removeEventListener('abort',stop);}}
 const snap=o.recorder.snapshot();let confirmedTerminal=false;try{const replay=replayConfirmedMatch(snap.record,snap.privateSources);confirmedTerminal=replay.complete&&!replay.executionUnknown&&replay.winner===match.winner;}catch{stopReason='execution_uncertain';}
 const complete=match.winner!==null&&confirmedTerminal,team=teamOf(o.actor),g=rootRoundResult?(rootRoundResult.winnerTeam===team?rootRoundResult.upgrade:-rootRoundResult.upgrade):null;
 o.recorder.finish({complete,winner:complete?match.winner:null,incompleteReason:complete?null:stopReason??'match_game_cap'});
 const trace=createHash('sha256');for(const d of snap.record.decisions)if(d.executionKind==='confirmed')trace.update(JSON.stringify({gameNo:d.key.gameNo,seat:d.key.actorSeat,move:resourceEffectKey(d.actualMove!.pass?null:d.actualMove!.combo!)}));
 return {wallSeconds:(performance.now()-matchStartedAt)/1000,complete,winner:complete?match.winner:null,games:snap.record.games.length,decisions:snap.record.decisions.filter(d=>d.executionKind==='confirmed').length,incompleteReason:complete?null:stopReason??'match_game_cap',rootRoundResult,rootG:g,finalW:complete?(match.winner===team?1:-1):null,rootTeamTarget:complete&&g!==null?g+(match.winner===team?1:-1):null,policyIds:o.policyIds,traceSchema:'ohuo-canonical-actions-v1',traceSHA256:trace.digest('hex')};
}
