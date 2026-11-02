import {it,expect,vi,afterEach} from 'vitest';
import {DEFAULT_RULES} from '@gd/engine';
import {MatchController} from '../src/game/controller';
import {resolveFourSeats} from '../src/game/seats';
import {RELEASES} from '../../ai/src/policy/seats';
import {resolvePolicy} from '../../ai/src/policy/resolve';
import index from '../../../lab/model-index.json';
import {loadCurrentMatch} from '../src/game/storage';
const profile:any={profileId:'fake',revision:1,snapshotHash:'0'.repeat(64),nickname:'fake',protocol:'openai-chat-completions',baseUrl:'https://invalid.test',requestedModel:'fake',supportedReasoningOptions:{},requestOptions:{max_tokens:100}};
const ref={profileId:profile.profileId,revision:1,snapshotHash:profile.snapshotHash};
const controllers:MatchController[]=[];
const receipt=(httpStatus=503)=>({...ref,credentialRevision:1,protocol:'openai-chat-completions',requestedModel:'fake',returnedModel:null,requestCount:1 as const,httpStatus,elapsedMs:0,upstreamChunks:0,upstreamEvents:0,contentEvents:0,keepaliveEvents:0,firstUpstreamMs:null,firstContentMs:null,usage:{}});
const choose=(view:any)=>({status:'response',response:{kind:'choose',decisionId:view.observation.decisionId,actionId:view.candidates[0].actionId}});
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function setup(mode:'local'|'hybrid'='hybrid') {
 vi.useFakeTimers();const map=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)});
 const d={...index.policies[0],weightsSHA256:'0'.repeat(64)};
 const p=await resolvePolicy(d.policyId,{registry:{...index,policies:[d]},site:'browser',readWeights:async()=>new Uint8Array(d.parameterCount*4),sha256:async()=>d.weightsSHA256});
 const r={...RELEASES[0],releaseRef:'synthetic',mode};
 const config=Array.from({length:4},()=>({controller:'ai',releaseRef:'synthetic',mode,...(mode==='hybrid'?{profileRevisionRef:ref}:{})}));
 const seats=await resolveFourSeats(config,async()=>p,[profile],[r]);
 const decisions:string[]=[];const views:any[]=[];let count=0,respond!:(x:any)=>void;
 const c=new MatchController({difficulty:1,rules:{...DEFAULT_RULES},aiDelayMs:1,seats,remoteRequest:(view)=>{decisions.push(view.observation.decisionId);views.push(view);count++;return new Promise(r=>respond=r);}});
 c.match.rngState=1234;controllers.push(c);return {c,seats,decisions,views,count:()=>count,respond:(x:any)=>respond({...x,summary:receipt(x.status==='response'?200:503)})};
}
afterEach(()=>{controllers.forEach(c=>c.destroy());controllers.length=0;vi.useRealTimers();vi.unstubAllGlobals();});
it('real controller pending survives watchdog/revive and destroy gives zero commits',async()=>{
 const f=await setup();f.c.startGame();await vi.advanceTimersByTimeAsync(1);expect(f.count()).toBe(1);expect(f.c.humanTurn).toBe(false);
 for(let i=0;i<3;i++)f.c.reviveIfStalled();await vi.advanceTimersByTimeAsync(16000);expect(f.count()).toBe(1);expect(f.c.state!.moveNo).toBe(0);
 f.c.destroy();f.respond({status:'remote_failure',reason:'http_error'});await Promise.resolve();await Promise.resolve();expect(f.c.state!.moveNo).toBe(0);
});
it('four frozen seats save/restore confirmed state only; applying gap rejects restore',async()=>{
 const f=await setup();f.c.startGame();expect(loadCurrentMatch()!.seatConfig).toEqual(f.seats.snapshot);const save=f.c.matchSavePoint();f.c.destroy();
 expect(()=>new MatchController({difficulty:1,rules:{...DEFAULT_RULES},resumeMatch:{...save,executionState:'applying'},seats:f.seats})).toThrow('execution_uncertain');
 expect(()=>new MatchController({difficulty:1,rules:{...DEFAULT_RULES},resumeMatch:save})).toThrow('four_seat');
 const restored=new MatchController({difficulty:1,rules:{...DEFAULT_RULES},resumeMatch:save,seats:f.seats,remoteRequest:()=>new Promise(()=>{})});controllers.push(restored);restored.startGame();expect(restored.state!.moveNo).toBe(0);expect(restored.thinking).toBe(true);
});
it('manual override unavailable: controller keeps remote authority',async()=>{
 const f=await setup();f.c.startGame();await vi.advanceTimersByTimeAsync(1);expect('useLocalForPending' in f.c).toBe(false);expect(f.c.state!.moveNo).toBe(0);expect(f.c.waitingRemote).toBe(true);
 f.respond(choose(f.views[0]));await settle();expect(f.c.state!.moveNo).toBe(1);expect(f.count()).toBe(1);
 const save=f.c.matchSavePoint();expect(save.activeGame!.decisionRecords).toHaveLength(1);expect(save.activeGame!.decisionRecords![0]).toMatchObject({status:'selected',source:'remote',actionId:f.views[0].candidates[0].actionId});expect(save.executionState).toBe('confirmed');
});
it('missing schema2 execution marker rejects and resumed pending is new generation',async()=>{
 const f=await setup();f.c.startGame();await vi.advanceTimersByTimeAsync(1);const save=f.c.matchSavePoint();f.c.destroy();
 expect(()=>new MatchController({difficulty:1,rules:{...DEFAULT_RULES},seats:f.seats,resumeMatch:{...save,executionState:undefined}})).toThrow('execution_uncertain');
 let restoredId='',restoredView:any,respondRestored!:(value:any)=>void;const restored=new MatchController({difficulty:1,rules:{...DEFAULT_RULES},seats:f.seats,resumeMatch:save,aiDelayMs:1,remoteRequest:view=>{restoredId=view.observation.decisionId;restoredView=view;return new Promise(resolve=>respondRestored=resolve);}});controllers.push(restored);restored.startGame();await vi.advanceTimersByTimeAsync(1);expect(restoredId).not.toBe(f.decisions[0]);f.respond({status:'remote_failure',reason:'http_error'});await settle();expect(restored.state!.moveNo).toBe(0);expect(restored.decisionError).toBeNull();expect(restored.waitingRemote).toBe(true);respondRestored({...choose(restoredView),summary:receipt(200)});await settle();expect(restored.state!.moveNo).toBe(1);expect(restored.lastDecision).toMatchObject({status:'selected',source:'remote'});expect(restored.decisionError).toBeNull();
});
it('configured all-AI returns do not wait for hidden human or exchange acknowledgement',async()=>{
 const f=await setup();const base=f.c.matchSavePoint();f.c.destroy();
 const save={...base,levels:[5,3] as [number,number],gameNo:1,lastHead:0,rngState:4242,lastResult:{finishOrder:[0,1,2,3],winnerTeam:0 as const,doubleUp:false,levelsAfter:[5,3] as [number,number],upgrade:2,passedA:false}};
 const c=new MatchController({difficulty:1,rules:{...DEFAULT_RULES},resumeMatch:save,seats:f.seats,remoteRequest:()=>new Promise(()=>{})});controllers.push(c);c.startGame();expect(c.state!.pendingReturns).toHaveLength(0);expect(c.humanReturning).toBe(false);expect(c.exchangeAckPending).toBe(false);
});
it('default O tiers preserve the old human/hint/first-AI action on one fixed synthetic position',async()=>{
 vi.useFakeTimers();vi.stubGlobal('localStorage',undefined);
 const d={...index.policies[0],weightsSHA256:'0'.repeat(64)};
 const policy=await resolvePolicy(d.policyId,{registry:{...index,policies:[d]},site:'browser',readWeights:async()=>new Uint8Array(d.parameterCount*4),sha256:async()=>d.weightsSHA256});
 const {defaultSeatAssignments}=await import('../../ai/src/policy/seats');
 const seats=await resolveFourSeats(defaultSeatAssignments('standard'),async()=>policy,[]);
 const legacy=new MatchController({difficulty:1,rules:{...DEFAULT_RULES},neuralPolicy:policy,neuralTier:'standard',aiDelayMs:1});
 const configured=new MatchController({difficulty:1,rules:{...DEFAULT_RULES},seats,aiDelayMs:1});controllers.push(legacy,configured);
 for(const c of [legacy,configured]){c.match.rngState=1234;c.startGame();}
 expect(configured.humanTurn).toBe(true);expect(configured.neuralHint()).toEqual(legacy.neuralHint());
 const {legalCombos}=await import('@gd/engine');for(const c of [legacy,configured])c.humanPlay(legalCombos(c.state!)[0]);
 await vi.advanceTimersByTimeAsync(1);expect(configured.state!.moveNo).toBe(2);expect(configured.matchSavePoint().activeGame!.moves).toEqual(legacy.matchSavePoint().activeGame!.moves);
});
it('lost ownership cancels a pending foreground request without fallback',async()=>{
 const f=await setup();f.c.startGame();await vi.advanceTimersByTimeAsync(1);
 const current=loadCurrentMatch()!;localStorage.setItem('gd_match_current',JSON.stringify({...current,snapshotRevision:'other-tab'}));
 f.c.reviveIfStalled();await Promise.resolve();expect(f.c.thinking).toBe(false);expect(f.c.exchangeError).toContain('其他页面');
 f.respond({status:'remote_failure',reason:'http_error'});await Promise.resolve();await Promise.resolve();expect(f.c.state!.moveNo).toBe(0);
});
it('controller execution_uncertain preserves crash marker and never schedules a second action',async()=>{
 const f=await setup();f.c.startGame();await vi.advanceTimersByTimeAsync(1);
 const target=f.c as any;const original=target.step.bind(target);target.step=(...args:any[])=>{original(...args);throw Error('synthetic post-mutation failure');};
 f.respond({status:'remote_failure',reason:'http_error'});await vi.advanceTimersByTimeAsync(1000);
 expect(f.c.state!.moveNo).toBe(1);expect(f.count()).toBe(1);expect(f.c.lastDecision).toMatchObject({status:'halted',reason:'execution_uncertain'});expect(loadCurrentMatch()!.executionState).toBe('execution_uncertain');f.c.reviveIfStalled();await vi.advanceTimersByTimeAsync(1000);expect(f.c.state!.moveNo).toBe(1);expect(f.count()).toBe(1);expect('useLocalForPending' in f.c).toBe(false);
});
it('new restore rejects recorder identity or actual-action ledger disagreement',async()=>{
 const f=await setup();f.c.startGame();await vi.advanceTimersByTimeAsync(1);f.respond(choose(f.views[0]));await settle();const save=f.c.matchSavePoint();f.c.destroy();
 // Synthetic historical shape only: no production manual API creates this record.
 const historical=structuredClone(save);Object.assign(historical.activeGame!.decisionRecords![0],{status:'fallback',source:'local_override'});const old=new MatchController({difficulty:1,rules:{...DEFAULT_RULES},seats:f.seats,resumeMatch:historical,remoteRequest:()=>new Promise(()=>{})});controllers.push(old);old.startGame();expect(old.exchangeError).toBeNull();expect(old.matchSavePoint().activeGame!.decisionRecords![0]).toMatchObject({status:'fallback',source:'local_override'});old.destroy();
 const changed=structuredClone(save);changed.activeGame!.recorderMeta.aiPolicies![0]='human';
 const changedAction=structuredClone(save);changedAction.activeGame!.decisionRecords![0].actualMove={pass:true};
 for(const invalid of [changed,changedAction]){
  // Each invalid restore owns its own synthetic persisted input. Historical restore above advanced its revision.
  const persisted=JSON.stringify(invalid);localStorage.setItem('gd_match_current',persisted);
  const request=vi.fn(async()=>{throw Error('invalid restore must not request');});
  const c=new MatchController({difficulty:1,rules:{...DEFAULT_RULES},seats:f.seats,resumeMatch:invalid,remoteRequest:request});controllers.push(c);
  c.startGame();expect(c.exchangeError).toContain('identity');expect(c.state!.moveNo).toBe(0);expect(c.thinking).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);expect(request).not.toHaveBeenCalled();expect(c.state!.moveNo).toBe(0);
  expect(localStorage.getItem('gd_match_current')).toBe(persisted);c.destroy();
 }
});
