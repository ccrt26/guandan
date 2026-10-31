import { describe,it,expect } from 'vitest';
import { applyMove,createMatch,startGame,DEFAULT_RULES,legalCombos,canPass } from '@gd/engine';
import { createDecisionBundle } from '../src/hybrid/candidates';
import { dedupCandidates } from '../src/nn/neuralSeat';
import { PendingDecision } from '../src/hybrid/decide';
import type { RemoteRequest,RemoteRequestResult } from '../src/hybrid/remote-selector';
function fixture() {
 const state=startGame(createMatch({...DEFAULT_RULES},1234));
 const rows=dedupCandidates(legalCombos(state),canPass(state)).map((r,idx)=>({...r,idx,score:1000-idx}));
 const bundle=createDecisionBundle({state,actorSeat:state.turn,decisionId:'b05',matchId:'m',history:{matchId:'m',gameNo:1,throughMoveNo:0,steps:[]},key:{controllerOrRunnerGeneration:1,matchId:'m',gameNo:1,moveNo:0,actorSeat:state.turn,requestSeq:1},decider:{seat:state.turn,decide:()=>({move:{pass:false,combo:rows[0].combo!},nCands:rows.length,explored:false,ranking:rows})}});
 let calls=0,commits=0,valid=true,resolve!:(r:RemoteRequestResult)=>void;
 const request:RemoteRequest=()=>{calls++;return new Promise(r=>{resolve=r;});};
 const owner={state:()=>state,isCurrent:()=>valid,apply:(move:any)=>{commits++;applyMove(state,move);}};
 const pending=new PendingDecision({bundle,owner,request});
 const summary:any={requestCount:1,elapsedMs:0};
 return {state,bundle,pending,owner,request,summary,calls:()=>calls,commits:()=>commits,stale:()=>{valid=false;},respond:(r:any)=>resolve({...r,summary})};
}
describe('B05 shared exactly-once boundary',()=>{
 it('pending_once: repeated start reuses one unresolved request',async()=>{const f=fixture();const p=f.pending.start();expect(f.pending.start()).toBe(p);expect(f.calls()).toBe(1);expect(f.commits()).toBe(0);f.respond({status:'response',response:{kind:'choose',decisionId:'b05',actionId:f.bundle.offeredIds[1]}});const out=await p;expect(out.status).toBe('selected');expect(out.actionId).toBe(f.bundle.offeredIds[1]);expect(f.commits()).toBe(1);await f.pending.start();expect(f.commits()).toBe(1);});
 it('failure_once: explicit failure submits frozen B once',async()=>{const f=fixture();const p=f.pending.start();f.respond({status:'remote_failure',reason:'http_error'});const out=await p;expect(out.status).toBe('fallback');expect(out.actionId).toBe(f.bundle.fallbackActionId);expect(f.commits()).toBe(1);await f.pending.start();expect(f.commits()).toBe(1);});
 it('cancel_late: cancellation or lost ownership submits zero',async()=>{for(const cancel of [true,false]){const f=fixture();const p=f.pending.start();if(cancel)f.pending.cancel('new_game');else f.stale();f.respond({status:'remote_failure',reason:'http_error'});expect((await p).status).toBe('cancelled');expect(f.commits()).toBe(0);}});
 it('cancel_late: abort before expansion response never sends second',async()=>{const f=fixture();const p=f.pending.start();f.pending.cancel('pause');f.respond({status:'response',response:{kind:'expand',decisionId:'b05',groupId:f.bundle.pool.at(-1)!.groupId}});expect((await p).status).toBe('cancelled');expect(f.calls()).toBe(1);expect((await f.pending.remoteSettled)?.requestCount).toBe(1);});
 it('local override aborts remote then commits cached B once',async()=>{const f=fixture();const p=f.pending.start();expect(f.pending.useLocal().status).toBe('fallback');f.respond({status:'remote_failure',reason:'http_error'});await p;expect(f.commits()).toBe(1);});
 it('execution_uncertain: mutation then throw halts with no fallback',async()=>{const f=fixture();f.owner.apply=()=>{f.state.moveNo++;throw Error('after mutation');};const p=f.pending.start();f.respond({status:'remote_failure',reason:'http_error'});expect(await p).toMatchObject({status:'halted',reason:'execution_uncertain'});expect(f.state.moveNo).toBe(1);expect(f.pending.useLocal().status).toBe('halted');});
 it('missing receipt propagates unknown aggregate rather than inventing zero',async()=>{const f=fixture();f.summary.requestCount=null;const p=f.pending.start();f.respond({status:'remote_failure',reason:'network_error'});const out=await p;expect(out.remote?.requestCount).toBeNull();});
 it('profile conflict pauses instead of B fallback',async()=>{for(const reason of ['revision_conflict','local_same_origin_required','invalid_play_request']){const f=fixture();const p=f.pending.start();f.respond({status:'remote_failure',reason});expect(await p).toMatchObject({status:'halted',reason});expect(f.commits()).toBe(0);}});
});
