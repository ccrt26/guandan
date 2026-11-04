/** One finite private-cache boundary check; no model, provider or match.
 * Cloud --boundary-only uses the real engine ctx/deck, not a sampler stub.
 * Native default additionally samples one real original visible root. */
import assert from 'node:assert/strict';
import {makeLevelCtx,rankOrder} from '../../../packages/engine/src/rank';
import {buildDeck,sortHand} from '../../../packages/engine/src/deck';
import {DEFAULT_RULES} from '../../../packages/engine/src/types';
import {canonical,digest} from '../task-schema.mjs';
import {knownUnsentWorldPreparationFailure} from '../first-round-prequery-failure.mjs';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const args=process.argv.slice(2);
assert.equal(args[0],'--case');assert.equal(args[1],'training.world-cache-serialization');
assert(args.slice(2).every(x=>['--boundary-only','--before-boundary'].includes(x)));
const before=args.includes('--before-boundary'),boundaryOnly=args.includes('--boundary-only');
const deck=buildDeck(),hands=Array.from({length:4},(_,seat)=>deck.slice(seat*27,seat*27+27));hands.forEach(sortHand);
const state={match:{opts:{...DEFAULT_RULES},levels:[2,2] as [number,number],gameNo:1,winner:null,rngState:0,lastHead:null,lastResult:null},ctx:makeLevelCtx([2,2],'stage',0),levelsBefore:[2,2] as [number,number],stageTeam:0 as const,hands,turn:0,leader:0,lastCombo:null,lastPlayer:0,passCount:0,trickPlays:[],finished:[],over:false,result:null,moveNo:0,tribute:null,pendingReturns:[]};
let sample:any={state,attempts:1,seed:701,observationSHA256:digest({fixture:'cache-boundary-only'}),hiddenLayoutSHA256:digest(hands.slice(1))};
let visible:any=null,toVisibleRoot:any=null;
if(!boundaryOnly){
 await import('../ohuo-host-files'); // Native integration import; no H method or research replay.
 const original=await import('../../review6/visible-world');toVisibleRoot=original.toVisibleRoot;
 visible=toVisibleRoot(state,[]);sample=original.sampleVisibleWorld(visible,701,4096);
}
const original=structuredClone(sample);
assert(sample.state.ctx.ranks instanceof Set);
assert.deepEqual(JSON.parse(JSON.stringify(sample)).state.ctx.ranks,{},'raw JSON would silently lose level membership');
assert.throws(()=>digest(sample),/invalid_value/,'original raw engine sample is not canonical JSON');
// This is precisely the unfixed persistence boundary: digest the raw sample.
// It is an explicit RED reproduction, NOT a full runtime/sampler import claim.
let cached:any=sample,restore:(x:any)=>any=(x:any)=>x,serialize:(x:any)=>any=(x:any)=>x;
if(!before){
 const codec=await import('../first-round-world-cache');
 serialize=codec.serializeCommonViewWorldSample;restore=codec.restoreCommonViewWorldSample;
 cached=serialize(sample);
}
assert.doesNotThrow(()=>digest(cached),'private world cache must use explicit finite JSON before hashing');
const sampleSHA256=digest(cached),persisted=JSON.parse(JSON.stringify(cached));
assert.equal(digest(persisted),sampleSHA256,'resume/evidence hash the same plain sample');
assert.deepEqual(persisted.state.ctx,{ranks:[2],levels:[2,2]});
const restored=restore(persisted);
assert(restored.state.ctx.ranks instanceof Set);
assert.equal(restored.state.ctx.ranks.has(2),true);assert.equal(restored.state.ctx.ranks.has(3),false);
assert.equal(rankOrder(2,restored.state.ctx),22);assert.equal(rankOrder(3,restored.state.ctx),3);
assert.deepEqual(restored,original,'all sampled state, hand order, seeds and observation identity survive JSON');
assert.deepEqual(sample,original,'serialization must not mutate sampled engine state');
assert.equal(digest(serialize(restored)),sampleSHA256,'prepare/resume/screen/evidence share one sample identity');
if(visible)assert.equal(toVisibleRoot(restored.state,visible.history).observationSHA256,visible.observationSHA256);
const corrupt=structuredClone(persisted);corrupt.state.ctx.ranks=[3];assert.throws(()=>restore(corrupt),/common_view_world_context/);
const dropped=structuredClone(persisted);dropped.state.ctx.ranks={};assert.throws(()=>restore(dropped),/common_view_world_context/);
const altered=structuredClone(persisted);altered.state.ctx.levels=[3,3];assert.throws(()=>restore(altered),/common_view_world_context/);
const invalid=structuredClone(persisted);invalid.state.extra=new Set([2]);assert.throws(()=>restore(invalid),/invalid_value/,'do not relax global canonical or silently discard another non-JSON field');
const mutated=restore(persisted);mutated.state.ctx.ranks.clear();mutated.state.hands[0].reverse();assert.deepEqual(persisted,JSON.parse(JSON.stringify(cached)),'branch state must not alias cached sample');
// Known local failure is classified read-only, never cleared or resent blindly.
const tmp=realpathSync(mkdtempSync(join(tmpdir(),'ohuo-prequery-cache-')));
try{
 const refs=new Map<string,any>(),ref=(name:string,value:any)=>{const id=name+'@sha256:'+digest(value);refs.set(id,value);return id;};
 const protocolRef=ref('protocol',{schema:'ohuo-first-round-protocol-revision-v2',protocolId:'first-round-common-view-r2'});
 const routingRef=ref('routing',{schema:'ohuo-common-view-teacher-routing-r2',role:'primary'});
 const selectionRef=ref('selection',{schema:'ohuo-offline-label-selection-v2',rows:[{key:{decision:0},split:'train',familyId:'f',inputSHA256:'a'.repeat(64)}]});
 const contractRef=ref('contract',{schema:'ohuo-common-view-teacher-contract-r2',protocolRef,selectionRef,routingRef});
 const outputRoot=join(tmp,'runs','failed'),task={taskId:'failed',runId:'failed',outputRoot,budgetRef:'b',datasetRefs:[selectionRef],sourcePlan:{split:'train',familyIds:['f']},scientificContract:{decisionRuleRef:contractRef,analysisMethodRef:protocolRef}};
 const taskSHA256=digest(task),checkpoint={schema:'ohuo-offline-label-run-v1',taskSHA256,selectionRef,cursor:0,rows:[],executionUnknown:true,active:{phase:'world-preparation',index:0,inputSHA256:'a'.repeat(64),worldPreparation:null}},checkpointSHA256=digest(checkpoint);
 const run:any={runId:'failed',task,taskSHA256,taskRef:'task@sha256:'+taskSHA256,status:'failed',failureReason:'invalid_value',cleanupConfirmed:true,ownedCleanup:null,actualScope:{apiCalls:false,parameterUpdates:false,deployment:false,localExecution:true},committed:[],consumerArtifactRefs:[],checkpoint,checkpointSHA256,checkpointRef:join(outputRoot,`checkpoint-${checkpointSHA256}.json`)};
 mkdirSync(outputRoot,{recursive:true});writeFileSync(join(outputRoot,'task.json'),canonical(task));writeFileSync(run.checkpointRef,canonical(checkpoint));
 const control:any={tasks:{failed:'failed'},budgets:{b:{activeRunId:null,reservations:{}}}},beforeState=canonical({run,control}),classify=(r=run,s=control)=>knownUnsentWorldPreparationFailure(r,s,tmp,(id:string)=>refs.get(id));
 assert.equal(classify(),true);assert.equal(canonical({run,control}),beforeState,'old unknown checkpoint and ledger remain unchanged');
 for(const mutate of [(r:any)=>r.actualScope.apiCalls=true,(r:any)=>r.checkpoint.active.phase='provider',(r:any)=>r.checkpoint.rows.push({requestCount:0}),(r:any)=>r.checkpoint.active.inputSHA256='b'.repeat(64),(r:any)=>r.checkpoint.active.worldPreparation={id:'partial'},(r:any)=>r.taskSHA256='0'.repeat(64),(r:any)=>r.executionUnknown=true,(r:any)=>r.observationStatus='unknown']){const r=structuredClone(run);mutate(r);assert.equal(classify(r),false);}
 for(const status of ['reserved','reserved_unknown','consumed','released']){const s=structuredClone(control);s.budgets.b.reservations.x={runId:'failed',status,cost:{providerRequests:0}};assert.equal(classify(run,s),false,'any reservation excludes this exact zero-meter failure');}
 const absent=structuredClone(control);delete absent.budgets.b.reservations;assert.equal(classify(run,absent),false,'missing reservation evidence is not empty');
 const consumerSource=readFileSync(new URL('../offline-label-consumer.ts',import.meta.url),'utf8'),expression=consumerSource.match(/const beforeFirstProvider=([^;]+);/)![1].replace('(cp.active as any)','cp.active');
 const beforeProvider=new Function('worldPreparationEntered','r2','apiInvoked','meters','cp','return '+expression);
 assert.equal(beforeProvider(false,true,false,[],checkpoint),false,'entry unknown guard cannot clear historical unknown');
 assert.equal(beforeProvider(true,true,false,[],checkpoint),true);assert.equal(beforeProvider(true,true,true,[],checkpoint),false);assert.equal(beforeProvider(true,true,false,[{}],checkpoint),false);
 const changed=structuredClone(control);changed.budgets.b.activeRunId='failed';assert.equal(classify(run,changed),false);
 writeFileSync(run.checkpointRef,canonical({...checkpoint,cursor:1}));assert.equal(classify(),false,'native checkpoint bytes must match original state identity');
}finally{rmSync(tmp,{recursive:true,force:true});}

console.log(JSON.stringify({case:'training.world-cache-serialization',status:'passed',scope:boundaryOnly?'real-engine-cache-boundary-only':'original-visible-world-sampler-and-cache-boundary',originalSamplerCalls:boundaryOnly?0:1,modelLoads:0,providerRequests:0,matchAttempts:0,optimizerSteps:0,datasetEligible:false,sampleSHA256,losslessJSONRoundtrip:true,originalLevelHas:true,corruptContextRejected:true}));
