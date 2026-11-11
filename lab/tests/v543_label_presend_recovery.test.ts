import {expect,it} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createMatch,startGame,DEFAULT_RULES,legalCombos,canPass} from '@gd/engine';
import {dedupCandidates} from '../../packages/ai/src/nn/neuralSeat';
import {createDecisionBundle} from '../../packages/ai/src/hybrid/candidates';
import {buildObservation} from '../../packages/ai/src/hybrid/observation';
import {createProfileSelector} from '../../packages/web/server/llm-select.mjs';
import {frozenTeacherSnapshot} from '../review6_2/teacher-snapshot';
import {createOfflineLabelConsumer} from '../review6_2/offline-label-consumer';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const zero=()=>({providerRequests:0,labelDecisions:0,optimizerSteps:0,matchAttempts:0});
function fixture(behavior:'second-pre-send'|'sent-unknown'|'reservation-unknown'){
 const root=mkdtempSync(join(tmpdir(),'v543-label-')),sourceIndexPath=join(root,'index.json');writeFileSync(sourceIndexPath,'{}');
 const profile={profileId:'fixture',revision:1,credentialRevision:1,protocol:'openai-chat-completions',requestedModel:'fixture',baseUrl:'https://fixture.invalid/v1',secret:'synthetic-not-a-credential',requestOptions:{}},reference={profileId:'fixture',revision:1,snapshotHash:'a'.repeat(64)},store={resolve:()=>structuredClone(profile)},selector=createProfileSelector({store,reference,fetchImpl:()=>{throw Error('prepare cannot fetch');}}),teacher={releaseRef:'fixture-H',promptRef:'fixture-prompt',profileSnapshot:frozenTeacherSnapshot(selector.profile,profile)};
 const snapshots=[0,1].map(i=>{
  const state=startGame(createMatch({...DEFAULT_RULES},1234)),key={controllerOrRunnerGeneration:'fixture',matchId:'q'+i,gameNo:1,moveNo:0,actorSeat:state.turn,requestSeq:0},history={matchId:key.matchId,gameNo:1,throughMoveNo:0,steps:[]},decisionId='decision-'+i;
  const decider={seat:state.turn,decide(s:any){const ranking=dedupCandidates(legalCombos(s),canPass(s)).map((c,idx)=>({...c,idx,score:1000-idx}));return {move:{pass:false as const,combo:ranking[0].combo!},nCands:ranking.length,explored:false,ranking};}};
  const bundle=createDecisionBundle({state,key,actorSeat:state.turn,matchId:key.matchId,decisionId,history,decider}),identity={policyId:'fixture-B',inputDim:399},input:any={schema:'ohuo-decision-input-v1',key,observation:buildObservation({state,actorSeat:state.turn,decisionId,matchId:key.matchId,history}),pool:bundle.pool,initialCandidateIds:bundle.initialCandidateIds,candidateInputs:{policyId:identity.policyId,policyIdentity:identity}};
  return {state,key,history,bundle,input,row:{key,inputSHA256:sha(JSON.stringify(input)),familyId:'family',split:'train',actorSeat:state.turn},record:{seatSnapshots:[]},decision:{policyId:identity.policyId,actualActionId:bundle.fallbackActionId,actualMove:null}};
 });
 let sends=0,saved:any=null;const consumption={confirmed:zero(),reserved:zero(),reservedUnknown:zero(),released:zero()},reservations=new Map<string,any>();
 const fetchImpl:any=(_url:any,init:any)=>{
  sends++;if(behavior==='sent-unknown')throw Error('synthetic invocation outcome unknown');
  const view=JSON.parse(JSON.parse(init.body).messages[1].content),snapshot=snapshots.find(s=>s.bundle.decisionId===view.observation.decisionId)!;
  return Promise.resolve(new Response(`data: ${JSON.stringify({model:'fixture',choices:[{index:0,delta:{content:JSON.stringify({kind:'choose',decisionId:view.observation.decisionId,actionId:snapshot.bundle.initialCandidateIds[0]})},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}}));
 };
 const consumer=createOfflineLabelConsumer({profileStore:store,mode:'offline_synthetic',fetchImpl}),task:any={runId:'fixture',outputRoot:root,datasetRefs:['selection']},ctx:any={task,signal:new AbortController().signal,executionInputs:{selection:{purpose:'b_training_source'},snapshots,teacher,store,reference,sourceIndexPath,sourceIndexSHA256:sha('{}')},checkpoint:null,checkpointSequence:0,executionId:'fixture',deadlineMonotonicMs:performance.now()+60000,
  reserve:async(id:string,cost:any)=>{reservations.set(id,cost);for(const k of Object.keys(cost))consumption.reserved[k]+=cost[k];if(behavior==='reservation-unknown')throw Error('reservation acknowledgement lost');return id;},
  settleReservation:async(id:string,settlement:any)=>{const cost=reservations.get(id);for(const k of Object.keys(cost)){consumption.reserved[k]-=cost[k];consumption[settlement.disposition==='consumed'?'confirmed':settlement.disposition==='unknown'?'reservedUnknown':'released'][k]+=cost[k];}},
  getConsumption:()=>structuredClone(consumption),saveCheckpoint:async(cp:any)=>{saved=structuredClone(cp);if(behavior==='second-pre-send'&&cp.cursor===1)writeFileSync(sourceIndexPath,'changed after q0 settled');}
 };
 return {run:()=>consumer.run(ctx),saved:()=>saved,sends:()=>sends,root,consumption};
}
// The previous run-level predicate marks q1 unknown merely because q0 sent.
it('keeps q0 terminal and classifies q1 local pre-send failure as known after a successful first request',async()=>{
 const f=fixture('second-pre-send');await expect(f.run()).rejects.toThrow('source index changed');
 expect(f.sends()).toBe(1);expect(f.saved().cursor).toBe(1);expect(f.saved().rows[0].status).toBe('selected');expect(f.saved().rows[0].requestCount).toBe(1);expect(f.saved().executionUnknown).toBe(false);expect(f.consumption.reserved.providerRequests).toBe(0);expect(JSON.parse(readFileSync(join(f.root,'labels/q0.json'),'utf8')).status).toBe('selected');
});
it('retains a real invocation-unknown terminal and does not send the second question',async()=>{
 const f=fixture('sent-unknown');await expect(f.run()).rejects.toThrow('execution_uncertain');expect(f.sends()).toBe(1);expect(f.saved().executionUnknown).toBe(true);expect(f.saved().rows[0].requestCount).toBe(null);expect(f.consumption.reservedUnknown.providerRequests).toBe(1);
});
it('does not turn an unacknowledged reservation into a known pre-send failure',async()=>{
 const f=fixture('reservation-unknown');await f.run().catch(()=>{});expect(f.sends()).toBe(0);expect(f.saved().executionUnknown).toBe(true);expect(f.consumption.reserved.providerRequests).toBe(1);
});
