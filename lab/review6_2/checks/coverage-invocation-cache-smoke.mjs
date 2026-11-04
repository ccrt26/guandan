import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {stripTypeScriptTypes} from 'node:module';
const args=process.argv.slice(2),red=args[0]==='red';
if(args[0]==='--case')assert.deepEqual(args,['--case','training.coverage-invocation-cache'],'exact registered case required');
else assert.ok(red?(args.length===1||args.length===2):(args.length===1&&!args[0].startsWith('-')),'expected --case training.coverage-invocation-cache, red [source-path], or source-path');
const path=args[0]==='--case'?'lab/review6_2/offline-selection.ts':red?(args[1]??'lab/review6_2/offline-selection.ts'):args[0],source=readFileSync(path,'utf8');
const begin=source.indexOf('// BEGIN invocation-local coverage reuse'),end=source.indexOf('// END invocation-local coverage reuse');
if(begin<0){
 let replayCount=0;const line=source.slice(source.indexOf(' const coverageReason='),source.indexOf(' const coverageEligible='));
 const admission=new Function('canonical','readOfflineSnapshot','commonViewForSnapshot','trainCoveragePublicReason','fail',stripTypeScriptTypes('const coverageCache=new Map(),publicEligibility=new Map<string,string|null>();'+line, {mode:'strip'})+'return coverageReason;');
 const row={key:{id:1},split:'train',eligibility:'eligible',sampleClass:'target',decisionId:'d',commonViewCell:{targetKind:'pair',partnerZero:false,hasOrdinaryTakeover:true}};
 for(let i=0;i<2;i++)admission(JSON.stringify,()=>{replayCount++;return {bundle:{decisionId:'d'}};},()=>({modelPayload:{}}),()=>null,r=>{throw Error(r)})(row);
 const expectReuse=()=>assert.equal(replayCount,1,'same invocation repeats the original causal prefix instead of reusing verified public predicate');
 if(red){assert.throws(expectReuse,error=>error instanceof assert.AssertionError&&error.code==='ERR_ASSERTION'&&error.actual===2&&error.expected===1);console.log(JSON.stringify({status:'PASS_EXPECTED_BASELINE_RED',actualPrefixReplays:2,expectedReusedReplays:1,notFullNativeAdmission:true}));process.exit(0);}
 expectReuse();process.exit(0);
}
assert.equal(red,false,'red mode requires the original repeated-replay source');
assert.ok(end>begin);
const temp=mkdtempSync(join(tmpdir(),'coverage-cache-')),input={key:{requestSeq:1},publicValue:null},hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const row={recordRef:{directory:temp,identitySHA256:'original',journalSHA256:'original'},recordRoot:temp,key:input.key,inputSHA256:hash(input),decisionId:'d1'};
const file=join(temp,'decision-1.private.json');writeFileSync(file,JSON.stringify(input),{mode:0o600});
let replays=0,loads=0,sourceVersion=1,throwCold=false;
const loadMatchStore=()=>{loads++;const version=sourceVersion;return {recorder:{snapshot:()=>({record:{version},privateSources:{version}})}};};
const readOfflineSnapshot=(r,cache)=>{replays++;if(throwCold)throw Error('synthetic original rejection');const k=hash([r.recordRef,r.recordRoot]);if(!cache.has(k))cache.set(k,loadMatchStore());return {bundle:{decisionId:r.decisionId},payload:{result:null}};};
const code=stripTypeScriptTypes(source.slice(begin,end),{mode:'strip'}).replaceAll('export ','');
const api=new Function('AsyncLocalStorage','digest','hashJSON','readOfflineSnapshot','loadMatchStore','commonViewForSnapshot','trainCoveragePublicReason','lstatSync','readFileSync','join','fail',code+'\nreturn {withCoverageEligibilityScope,cachedCoveragePublicReason};')(AsyncLocalStorage,hash,hash,readOfflineSnapshot,loadMatchStore,s=>({modelPayload:s.payload}),p=>p.result,lstatSync,readFileSync,join,r=>{throw Error(r)});
const call=(identity='state1',r=row)=>api.cachedCoveragePublicReason(r,new Map(),new Map(),identity);
try{
 await api.withCoverageEligibilityScope('task1',async()=>{assert.equal(call(),null);assert.equal(call(),null);assert.equal(replays,1);assert.equal(loads,2);call('state2');assert.equal(replays,2);});
 call();assert.equal(replays,3,'outside scope must replay');
 await api.withCoverageEligibilityScope('task1',async()=>{call();assert.equal(replays,4);writeFileSync(file,JSON.stringify({...input,corrupt:true}));assert.throws(()=>call(),/input identity/);writeFileSync(file,JSON.stringify(input));call();assert.equal(replays,5,'failed hit must evict');});
 await api.withCoverageEligibilityScope('task1',async()=>{call();sourceVersion++;assert.throws(()=>call(),/source_changed/);});
 await assert.rejects(api.withCoverageEligibilityScope('task1',async()=>{throwCold=true;call();}),/synthetic original rejection/);throwCold=false;
 let release;const hold=new Promise(r=>release=r),before=replays;
 await Promise.all([api.withCoverageEligibilityScope('sameTask',async()=>{call();await hold;call();}),api.withCoverageEligibilityScope('sameTask',async()=>{call();release();})]);assert.equal(replays-before,2,'parallel scopes cannot share');
 const beforeTransitions=replays;await api.withCoverageEligibilityScope('task1',async()=>{call('A');call('B');call('A');});assert.equal(replays-beforeTransitions,3,'returning to an earlier state must not revive its cache');
 const beforeRows=replays;await api.withCoverageEligibilityScope('task1',async()=>{call('A');call('A',{...row,decisionId:'d2'});});assert.equal(replays-beforeRows,2,'changed original row must replay');
 let releaseLate,late;const waitLate=new Promise(r=>releaseLate=r),beforeLate=replays;
 await api.withCoverageEligibilityScope('task1',async()=>{call();late=(async()=>{await waitLate;call();})();});releaseLate();await late;assert.equal(replays-beforeLate,2,'async descendant after scope return must replay');
 console.log(JSON.stringify({status:'PASS_FOCUSED_CACHE_SEAM',coldAndHitEquivalent:true,hitOriginalFileChecks:true,stateInvalidation:true,exceptionEviction:true,concurrentIsolation:true,scopeExitInvalidation:true,notFullNativeAdmission:true,noProductionDeployment:true}));
}finally{rmSync(temp,{recursive:true,force:true});}
