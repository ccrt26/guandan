/** Fixed local complete-match worker. Only its B07 parent supplies work; never
 * accepts a task-provided module, shell or model default. One match then exit. */
import {isMainThread,parentPort,workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fixedReference,strictObject} from './task-schema.mjs';
import {DEFAULT_RULES,type GameState} from '@gd/engine';
import {resolveNodePolicy} from './policy-loader';
import {runCompleteMatch,type PolicySpec,type PublicStep} from '../review6/match-play';
import {dealtFamilyBeforeExchange} from '../review6/training-ancestry';
import {createDecisionBundle} from '../../packages/ai/src/hybrid/candidates';
import {type DecisionBundle} from '../../packages/ai/src/hybrid/protocol';
import {LEGACY_O_POLICY_REF} from '../../packages/ai/src/policy/resolve';
import {createMatchStore,captureInitialCandidateInputs,publicMatchOutcome} from './match-record';

if(!isMainThread){
 const job=workerData;
 try{
  const inputWorkload=job?.executionBoundary?.mode==='input-workload-only';
  if(inputWorkload){strictObject(job.executionBoundary,'executionBoundary',['mode','resourcePolicyRef']);fixedReference(job.executionBoundary.resourcePolicyRef,'executionBoundary.resourcePolicyRef');if(Object.hasOwn(job,'deadlineEpochMs'))throw Error('input-workload local match cannot carry an artificial deadline');}
  else if(job?.executionBoundary!==undefined)throw Error('unsupported local match execution boundary');
  if(!job?.row||!Array.isArray(job.row.seats)||job.row.seats.some((s:any)=>s.mode!=='local')||!isDeepStrictEqual(job.identity.rules,DEFAULT_RULES)||!inputWorkload&&!Number.isFinite(job.deadlineEpochMs))throw Error('fixed local job required');
  const policies=await Promise.all(job.policyRefs.map((ref:string)=>resolveNodePolicy(ref,job.policyRepositoryRoot)));
  if(policies.some((p:any,i:number)=>!isDeepStrictEqual(p.identity,job.policyIdentities[i])))throw Error('worker loaded different policy');
  const store=createMatchStore(job.outputRoot,job.identity),specs:PolicySpec[]=policies.map((p:any)=>({policyId:p.identity.policyId,kind:'neural'}));
  let sequence=0,bundle:DecisionBundle|null=null,decisionStarted=0;
  const matchStartedAt=performance.now();const result=runCompleteMatch({seed:job.row.seed,policies:specs,actingSeat:job.row.actor,dealMode:'indexed-deal-v1',dealNamespace:job.row.dealNamespace,rngMode:'counter-per-decision',maxGames:job.row.maxGames,maxMovesPerGame:job.row.maxMovesPerGame,...(inputWorkload?{}:{deadlineMonotonicMs:performance.now()+Math.max(0,job.deadlineEpochMs-Date.now())}),
   seatFactory:(_spec,seat)=>{const decider=policies[seat].createDecider(seat);let history:PublicStep[]=[];
    return{policyId:policies[seat].identity.policyId,newGame(_state,prefix){history=[...prefix];decider.newGame();for(const p of prefix)decider.observe(p.events);},observe(events,priorTarget){history.push({events,priorTarget});decider.observe(events);},decide(state){
     decisionStarted=performance.now();const key={controllerOrRunnerGeneration:job.identity.runId,matchId:job.row.matchId,gameNo:state.match.gameNo,moveNo:state.moveNo,actorSeat:seat,requestSeq:sequence++};
     bundle=createDecisionBundle({key,state,actorSeat:seat,decisionId:`${job.row.matchId}-${key.gameNo}-${key.moveNo}`,matchId:job.row.matchId,history:{matchId:job.row.matchId,gameNo:key.gameNo,throughMoveNo:state.moveNo,steps:history},decider});
     store.recorder.beginDecision({key,policyId:policies[seat].identity.policyId,initialCandidateIds:bundle.initialCandidateIds,offeredIds:bundle.offeredIds,bundle,candidateInputs:captureInitialCandidateInputs({bundle,state,tracker:decider.tracker,encoder:policies[seat].encoder,policyIdentity:policies[seat].identity})});
     const candidate=bundle.pool.find(c=>c.actionId===bundle!.fallbackActionId)!;return candidate.canonical===null?{pass:true}:{pass:false,combo:structuredClone(candidate.canonical)};
    }};},
   onBeforeDecision({state}){
    if(state.moveNo!==0)return;
    const bytes=readFileSync(job.sourceIndexPath),index=JSON.parse(bytes.toString());
    if(createHash('sha256').update(bytes).digest('hex')!==job.sourceIndexSHA256||dealtFamilyBeforeExchange(state)!==job.row.roundFamilyIds[state.match.gameNo-1]||index.families[job.row.roundFamilyIds[state.match.gameNo-1]]?.split!==(job.row.split==='confirm'?'sealed':job.row.split))throw Error('local source ancestry/split mismatch');
    store.recorder.beginGame(state,job.row.roundFamilyIds[state.match.gameNo-1]);
   },
   onAfterDecision({move,events,history}){
    if(!bundle)throw Error('missing before-decision bundle');const b=bundle,step=history.at(-1)!;
    store.recorder.confirmAction({key:b.key,move:move as any,events,priorTarget:step.priorTarget,actionId:b.fallbackActionId,requestedActionId:b.fallbackActionId,source:b.isUniqueLegalAction?'local_unique':policies[b.key.actorSeat].identity.policyId===LEGACY_O_POLICY_REF?'O':'B',status:'selected'});
    store.recorder.finishDecision({key:b.key,status:'selected',reason:null,elapsedMs:performance.now()-decisionStarted,offeredIds:b.offeredIds,requests:[]});bundle=null;
   }});
  store.recorder.finish({complete:result.complete,winner:result.winner,incompleteReason:result.incompleteReason});
  parentPort!.postMessage({kind:'result',result:publicMatchOutcome({...result,wallSeconds:(performance.now()-matchStartedAt)/1000,traceSchema:'review6-engine-move-count-events-v1'}),recordRef:store.ref()});parentPort!.close();
 }catch(error){parentPort!.postMessage({kind:'failure',reason:(error as Error).message});parentPort!.close();process.exitCode=1;}
}
