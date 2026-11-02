import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfileStore } from '../server/llm-profiles.mjs';
import { createProfileRoutes } from '../server/llm-profile-routes.mjs';
import * as stateModule from '../server/llm-provider-state.mjs';

// No listening server, browser, default credential store, or provider network.
globalThis.fetch = () => { throw Error('provider_network_forbidden_in_fixture'); };
const fixtureProfile = (provider, suffix='one') => ({profileId:`fixture-${provider}-${suffix}`,nickname:provider,
  protocol:provider==='glm'?'anthropic-messages':'openai-chat-completions',
  baseUrl:provider==='glm'?'https://open.bigmodel.cn/api/anthropic':'https://api.deepseek.com',
  requestedModel:provider==='glm'?'glm-5.3':'deepseek-flash',
  supportedReasoningOptions:provider==='glm'?{thinking:['enabled'],output_config_effort:['low','high','max']}:{thinking:['enabled'],reasoning_effort:['low','high','max']},
  requestOptions:provider==='glm'?{thinking:{type:'enabled'},output_config:{effort:'max'},max_tokens:32768}:{thinking:{type:'enabled'},reasoning_effort:'max'},
  secret:`SYNTHETIC_ONLY_${provider}_${suffix}`});
function setup(){const root=mkdtempSync(join(tmpdir(),'ohuo-provider-state-'));const profilePath=join(root,'fake-private.json'),receiptPath=join(root,'fake-receipts.json');return {root,profilePath,receiptPath,store:createProfileStore({filePath:profilePath}),cleanup:()=>rmSync(root,{recursive:true,force:true})};}
const ref=p=>({profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash});
function request(url='/api/llm-profiles?view=providers',method='GET',origin='http://localhost:15180'){return {url,method,headers:{host:'127.0.0.1:18787',origin,'sec-fetch-site':'same-origin'},socket:{remoteAddress:'127.0.0.1'}};}
function response(){return {status:0,body:null,headers:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=JSON.parse(body);}};}
test('new provider view uses saved profiles without any browser binding',async()=>{
  const f=setup();try{const glm=f.store.save({profile:fixtureProfile('glm'),expectedRevision:null});const ds=f.store.save({profile:fixtureProfile('deepseek'),expectedRevision:null});
    const route=createProfileRoutes({store:f.store,port:18787,uiPort:15180,receiptPath:f.receiptPath});const res=response();
    assert.equal(await route(request(),res),true,'existing handler must recognise the explicit read-only providers view');
    assert.equal(res.status,200);assert.equal(res.headers['cache-control'],'no-store');
    assert.equal(res.body.schema,'ohuo-provider-state-v1');
    assert.deepEqual(res.body.providers.glm.reference,ref(glm));assert.deepEqual(res.body.providers.deepseek.reference,ref(ds));
    assert.equal(res.body.providers.glm.availability,'ready');assert.equal(res.body.providers.glm.connection.state,'untested');
    assert(!JSON.stringify(res.body).includes('SYNTHETIC_ONLY'));assert(!JSON.stringify(res.body).includes('credentialRevision'));
  }finally{f.cleanup();}
});
const sha=b=>createHash('sha256').update(b).digest('hex');
const state=f=>stateModule.buildProviderState({store:f.store,receiptPath:f.receiptPath});
function probeSource(f,provider,p){
 const out={provider,status:'completed',requestCount:1,reference:ref(p),url:provider==='glm'?'https://open.bigmodel.cn/api/anthropic/v1/messages':'https://api.deepseek.com/chat/completions',protocol:p.protocol,requestedModel:p.requestedModel,returnedModel:p.requestedModel,max_tokens:1024,stream:false,httpStatus:200,stopReason:provider==='glm'?'end_turn':'stop',textNonempty:true,complete:true,truncated:false};
 const raw=JSON.stringify({intentAt:'2026-10-31T18:58:21.714877+00:00',endedAt:'2026-10-31T18:58:22.528252+00:00',exitCode:0,stdout:JSON.stringify(out),stderr:''});
 const path=join(f.root,`${provider}-probe.json`);writeFileSync(path,raw);return {path,sha256:sha(raw),provider};
}
function importSources(f,sources){assert.equal(typeof stateModule.importLegacyReceipts,'function','reviewed importer must exist');return stateModule.importLegacyReceipts({profilePath:f.profilePath,receiptPath:f.receiptPath,sources});}
test('exact original native receipt records its original time and is idempotent',()=>{
 const f=setup();try{const p=f.store.save({profile:fixtureProfile('glm'),expectedRevision:null}),source=probeSource(f,'glm',p),before=readFileSync(f.profilePath);
  importSources(f,[source]);const a=state(f);assert.equal(a.providers.glm.connection.state,'passed');assert.equal(a.providers.glm.connection.testedAt,'2026-10-31T18:58:22.528252Z');assert.equal(a.providers.glm.connection.scope,'native-connection-probe');
  const saved=readFileSync(f.receiptPath);importSources(f,[source]);assert.deepEqual(readFileSync(f.receiptPath),saved);assert.deepEqual(readFileSync(f.profilePath),before);assert.deepEqual(a.profiles,[p]);
  assert(!JSON.stringify(a).includes('credentialRevision'));assert(!JSON.stringify(a).includes('SYNTHETIC_ONLY'));
 }finally{f.cleanup();}
});
test('key-only change makes a recorded pass stale while keeping the exact public reference',()=>{
 const f=setup();try{const p=f.store.save({profile:fixtureProfile('deepseek'),expectedRevision:null}),source=probeSource(f,'deepseek',p);importSources(f,[source]);
  const changed=f.store.save({profile:{...fixtureProfile('deepseek'),secret:'SYNTHETIC_ROTATED'},expectedRevision:p.revision,expectedSnapshotHash:p.snapshotHash});assert.deepEqual(changed,p);
  assert.equal(state(f).providers.deepseek.connection.state,'stale');assert.equal(JSON.parse(readFileSync(f.receiptPath)).receipts[0].testedCredentialRevision,1);
  importSources(f,[source]);assert.equal(state(f).providers.deepseek.connection.state,'stale');
 }finally{f.cleanup();}
});
test('first import after a key change never signs the current credential version',()=>{
 const f=setup();try{const p=f.store.save({profile:fixtureProfile('deepseek'),expectedRevision:null}),source=probeSource(f,'deepseek',p);
  f.store.save({profile:{...fixtureProfile('deepseek'),secret:'SYNTHETIC_ROTATED'},expectedRevision:p.revision,expectedSnapshotHash:p.snapshotHash});importSources(f,[source]);
  assert.equal(JSON.parse(readFileSync(f.receiptPath)).receipts[0].testedCredentialRevision,null);assert.equal(state(f).providers.deepseek.connection.state,'stale');
 }finally{f.cleanup();}
});
test('changed public configuration retains original history but never binds it to new ref',()=>{
 const f=setup();try{const p=f.store.save({profile:fixtureProfile('glm'),expectedRevision:null}),source=probeSource(f,'glm',p);
  const changed=f.store.save({profile:{...fixtureProfile('glm'),nickname:'new-label'},expectedRevision:p.revision,expectedSnapshotHash:p.snapshotHash});importSources(f,[source]);
  assert.notDeepEqual(ref(changed),ref(p));const saved=JSON.parse(readFileSync(f.receiptPath)).receipts[0];assert.deepEqual(saved.originalReference,ref(p));assert.equal(saved.testedCredentialRevision,null);assert.equal(state(f).providers.glm.connection.state,'stale');
 }finally{f.cleanup();}
});
test('R3: model, options, and changed route keep stale history when their saved provider becomes incompatible',()=>{
 for(const change of [{requestedModel:'glm-old'},{requestOptions:{thinking:{type:'enabled'},output_config:{effort:'high'},max_tokens:32768}},{baseUrl:'https://fixture.invalid'}]){
  const f=setup();try{const p=f.store.save({profile:fixtureProfile('glm'),expectedRevision:null});importSources(f,[probeSource(f,'glm',p)]);
   f.store.save({profile:{...fixtureProfile('glm'),...change},expectedRevision:p.revision,expectedSnapshotHash:p.snapshotHash});const current=state(f).providers.glm;
   assert.equal(current.availability,'incompatible');assert.equal(current.reference,null);assert.equal(current.connection.state,'stale');assert.equal(current.connection.testedAt,'2026-10-31T18:58:22.528252Z');
  }finally{f.cleanup();}
 }
});
test('R3: ambiguous active profiles never expose one candidate as a passed current connection',()=>{
 const f=setup();try{const p=f.store.save({profile:fixtureProfile('glm'),expectedRevision:null});importSources(f,[probeSource(f,'glm',p)]);f.store.save({profile:fixtureProfile('glm','second'),expectedRevision:null});
  assert.equal(state(f).providers.glm.availability,'ambiguous');assert.equal(state(f).providers.glm.connection.state,'unknown');assert.equal(state(f).providers.glm.reference,null);
 }finally{f.cleanup();}
});
test('only multiple valid current candidates are ambiguous, and untested profiles remain ready',()=>{
 const f=setup();try{const a=f.store.save({profile:fixtureProfile('glm'),expectedRevision:null});f.store.save({profile:{...fixtureProfile('glm','old'),requestedModel:'glm-old'},expectedRevision:null});
  assert.equal(state(f).providers.glm.availability,'ready');assert.deepEqual(state(f).providers.glm.reference,ref(a));
  f.store.save({profile:fixtureProfile('glm','second'),expectedRevision:null});assert.equal(state(f).providers.glm.availability,'ambiguous');assert.equal(state(f).providers.glm.reference,null);
 }finally{f.cleanup();}
});
test('saved reviewed endpoint with incompatible protocol remains incompatible, not absent',()=>{
 const f=setup();try{f.store.save({profile:{...fixtureProfile('deepseek'),protocol:'anthropic-messages',supportedReasoningOptions:{thinking:['enabled'],output_config_effort:['low','high','max']},requestOptions:{thinking:{type:'enabled'},output_config:{effort:'max'},max_tokens:32768}},expectedRevision:null});
  assert.equal(state(f).providers.deepseek.availability,'incompatible');assert.equal(state(f).providers.deepseek.reference,null);
 }finally{f.cleanup();}
});
test('failure and incomplete historical receipts remain failure and incomplete, never passed',()=>{
 for(const result of ['failed','connected_incomplete']){const f=setup();try{const p=f.store.save({profile:fixtureProfile('deepseek'),expectedRevision:null}),source=probeSource(f,'deepseek',p);
  const wrapper=JSON.parse(readFileSync(source.path)),out=JSON.parse(wrapper.stdout);Object.assign(out,{status:result,httpStatus:result==='failed'?401:200,complete:false,truncated:result!=='failed',textNonempty:false,stopReason:result==='failed'?null:'length',returnedModel:result==='failed'?null:p.requestedModel});wrapper.stdout=JSON.stringify(out);const raw=JSON.stringify(wrapper);writeFileSync(source.path,raw);source.sha256=sha(raw);
  importSources(f,[source]);assert.equal(state(f).providers.deepseek.connection.state,result==='failed'?'failed':'incomplete');
 }finally{f.cleanup();}}
});
test('a forged completed 200 with no final text is rejected rather than imported as passed',()=>{
 const f=setup();try{const p=f.store.save({profile:fixtureProfile('glm'),expectedRevision:null}),source=probeSource(f,'glm',p),wrapper=JSON.parse(readFileSync(source.path)),out=JSON.parse(wrapper.stdout);
  out.textNonempty=false;wrapper.stdout=JSON.stringify(out);const raw=JSON.stringify(wrapper);writeFileSync(source.path,raw);source.sha256=sha(raw);
  assert.throws(()=>importSources(f,[source]),/receipt_source_invalid/);assert.equal(state(f).providers.glm.connection.state,'untested');
 }finally{f.cleanup();}
});
test('malformed receipt store does not turn into a success or block saved provider availability',()=>{
 const f=setup();try{f.store.save({profile:fixtureProfile('glm'),expectedRevision:null});writeFileSync(f.receiptPath,'not json',{mode:0o600});
  assert.equal(state(f).providers.glm.availability,'ready');assert.equal(state(f).providers.glm.connection.state,'unknown');
 }finally{f.cleanup();}
});
test('import refuses a wrong source digest, unsafe target, and busy profile store without modifying data',()=>{
 const f=setup();try{const p=f.store.save({profile:fixtureProfile('glm'),expectedRevision:null}),source=probeSource(f,'glm',p),before=readFileSync(f.profilePath);
  assert.throws(()=>importSources(f,[{...source,sha256:'0'.repeat(64)}]),/receipt_source_mismatch/);
  writeFileSync(f.profilePath+'.lock','fixture',{mode:0o600});assert.throws(()=>importSources(f,[source]),/profile_store_busy/);rmSync(f.profilePath+'.lock');
  symlinkSync(source.path,f.receiptPath);assert.throws(()=>importSources(f,[source]),/receipt_store_unavailable/);assert.deepEqual(readFileSync(f.profilePath),before);
 }finally{f.cleanup();}
});
test('provider view preserves local origin guard, rejects POST and does not alter original GET',async()=>{
 const f=setup();try{const p=f.store.save({profile:fixtureProfile('glm'),expectedRevision:null});const route=createProfileRoutes({store:f.store,port:18787,uiPort:15180,receiptPath:f.receiptPath});
  const wrong=response();await route(request(undefined,'GET','https://evil.invalid'),wrong);assert.equal(wrong.status,403);
  const post=response();await route(request(undefined,'POST'),post);assert.equal(post.status,405);
  const old=response();await route(request('/api/llm-profiles'),old);assert.deepEqual(old.body,[p]);
  const second=response();await route(request(undefined,'GET','http://127.0.0.1:15180'),second);assert.deepEqual(second.body,state(f));
 }finally{f.cleanup();}
});
test('production importer CLI refuses an unapproved invocation before any store write',()=>{
 const script=new URL('../../../deliverables/ohuo-batches/S31-PROVIDER-STATE/tools/import-connection-receipts.mjs',import.meta.url);
 assert(existsSync(script),'fixed production importer must be supplied');
 const result=spawnSync(process.execPath,[script.pathname],{encoding:'utf8'});assert.equal(result.status,0);assert.equal(result.stderr,'');
 assert.deepEqual(JSON.parse(result.stdout),{status:'guard_refused_no_write',providerRequests:0});
});
test('both fixed real historical receipts parse against identical public profiles in a synthetic-only store',()=>{
 const f=setup();try{
  const inputs=new URL('../../../deliverables/ohuo-batches/S31-PROVIDER-STATE/inputs/',import.meta.url),sources=[];
  for(const provider of ['glm','deepseek']){
   const path=new URL(`probe-${provider}.actual.json`,inputs),bytes=readFileSync(path),wrapper=JSON.parse(bytes),evidence=JSON.parse(wrapper.stdout);
   const p=f.store.save({profile:{...fixtureProfile(provider),profileId:evidence.reference.profileId,nickname:provider==='glm'?'GLM':'DeepSeek'},expectedRevision:null});
   assert.deepEqual(ref(p),evidence.reference,'only fake credentials; exact historical public snapshot reconstructed');sources.push({path:path.pathname,provider,sha256:sha(bytes)});
  }
  importSources(f,sources);const result=state(f);assert.equal(result.providers.glm.connection.state,'passed');assert.equal(result.providers.deepseek.connection.state,'passed');
  assert.equal(result.providers.glm.connection.testedAt,'2026-10-31T18:58:35.463806Z');assert.equal(result.providers.deepseek.connection.testedAt,'2026-10-31T18:58:22.528252Z');
 }finally{f.cleanup();}
});
