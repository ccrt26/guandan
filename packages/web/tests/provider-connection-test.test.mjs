import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { importLegacyReceipts } from '../server/llm-provider-state.mjs';
import { createProfileStore } from '../server/llm-profiles.mjs';
import { createProfileRoutes } from '../server/llm-profile-routes.mjs';

// Every credential, transport and store in this file is synthetic. Never listen or contact a provider.
globalThis.fetch=()=>{throw Error('real_network_forbidden');};
const profile=(provider='glm',protocol='anthropic-messages')=>({profileId:`fixture-${provider}`,nickname:provider,protocol,
 baseUrl:provider==='deepseek'?'https://api.deepseek.com':protocol==='anthropic-messages'?'https://open.bigmodel.cn/api/anthropic':'https://open.bigmodel.cn/api/paas/v4',requestedModel:provider==='glm'?'glm-5.3':'deepseek-flash',
 supportedReasoningOptions:protocol==='anthropic-messages'?{thinking:['enabled'],output_config_effort:['low','high','max']}:{thinking:['enabled'],reasoning_effort:['low','high','max']},
 requestOptions:protocol==='anthropic-messages'?{thinking:{type:'enabled'},output_config:{effort:'max'},max_tokens:32768}:{thinking:{type:'enabled'},reasoning_effort:'max'},secret:'SYNTHETIC_PRIVATE_KEY'});
const ref=p=>({profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash});
const native=(protocol='anthropic-messages',model='glm-5.3')=>protocol==='anthropic-messages'?{type:'message',role:'assistant',model,content:[{type:'text',text:'OK'}],stop_reason:'end_turn'}:{model,choices:[{message:{role:'assistant',content:'OK'},finish_reason:'stop'}]};
const resJSON=(body,status=200)=>new Response(JSON.stringify(body),{status});
function setup(p=profile(),fetchImpl=async()=>resJSON(native(p.protocol,p.requestedModel)),opts={}){
 const root=mkdtempSync(join(tmpdir(),'ohuo-test-button-')),filePath=join(root,'private.json'),receiptPath=join(root,'receipts.json'),store=createProfileStore({filePath});
 const saved=store.save({profile:p,expectedRevision:null}),route=createProfileRoutes({store,receiptPath,port:18787,uiPort:15180,fetchImpl,...opts});
 return {root,filePath,receiptPath,store,saved,route,p,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
async function call(f,body,method='POST',url='/api/llm-profiles/test',headers={}){
 const req={url,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:18787',origin:'http://localhost:15180','content-type':'application/json','sec-fetch-site':'same-origin',...headers},async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(typeof body==='string'?body:JSON.stringify(body));}};
 const res={status:0,body:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(raw){this.body=JSON.parse(raw);}};
 const handled=await f.route(req,res);assert.equal(handled,true,'named handler must recognize test route');return res;
}
const command=(f,requestId=randomUUID())=>({provider:f.p.nickname,reference:ref(f.saved),requestId});
const view=f=>call(f,undefined,'GET','/api/llm-profiles?view=providers');
const turn=()=>new Promise(r=>setImmediate(r));
test('only explicit POST executes one native request and another context reads persisted timestamp',async()=>{
 let calls=0,seen;const p=profile(),f=setup(p,async(url,init)=>{calls++;seen={url,init};return resJSON(native());});try{
  assert.equal((await view(f)).body.providers.glm.connection.state,'untested');assert.equal(calls,0);
  assert.equal((await call(f,undefined,'GET')).status,405);assert.equal(calls,0);
  const c=command(f),r=await call(f,c);assert.equal(r.status,200);assert.equal(calls,1);assert.equal(r.body.persisted,true);assert.equal(r.body.profileUnchanged,true);assert.equal(r.body.connection.state,'passed');assert.match(r.body.connection.testedAt,/Z$/);
  assert.equal(seen.url,'https://open.bigmodel.cn/api/anthropic/v1/messages');assert.equal(seen.init.redirect,'error');assert.equal(JSON.parse(seen.init.body).max_tokens,1024);assert.equal(JSON.parse(seen.init.body).stream,false);assert.equal(JSON.parse(seen.init.body).output_config.effort,'max');
  assert.equal(statSync(f.receiptPath).mode&0o777,0o600);const second={...f,route:createProfileRoutes({store:createProfileStore({filePath:f.filePath}),receiptPath:f.receiptPath,port:18787,uiPort:15180})};
  assert.deepEqual((await view(second)).body.providers.glm.connection,r.body.connection);assert.equal(calls,1);
  const serialized=JSON.stringify(r.body)+readFileSync(f.receiptPath,'utf8');assert(!serialized.includes(p.secret));assert(!serialized.includes('"text":"OK"'));
 }finally{f.cleanup();}
});
test('ordinary GLM OpenAI and DeepSeek persist lawful returned model aliases without requiring equality',async()=>{
 for(const provider of ['glm','deepseek']){const p=profile(provider,'openai-chat-completions');let calls=0;const f=setup(p,async(url,init)=>{calls++;assert.equal(url,p.baseUrl+'/chat/completions');assert.equal(init.headers.authorization,`Bearer ${p.secret}`);return resJSON(native(p.protocol,'safe-model-alias'));});try{
  const r=await call(f,command(f));assert.equal(r.body.connection.state,'passed');assert.equal(r.body.connection.returnedModel,'safe-model-alias');assert.equal((await view(f)).body.providers[provider].connection.state,'passed');assert.equal(calls,1);
 }finally{f.cleanup();}}
});
test('in-flight same ID shares a request, another ID is busy and cached ID never repeats fetch',async()=>{
 let release,calls=0;const f=setup(profile(),()=>{calls++;return new Promise(resolve=>{release=()=>resolve(resJSON(native()));});});try{
  const c=command(f),first=call(f,c);await turn();const duplicate=call(f,c);await turn();assert.equal(calls,1);
  assert.equal((await call(f,command(f))).body.error,'test_in_progress');
  assert.equal((await call(f,{...c,reference:{...c.reference,revision:2}})).body.error,'request_id_conflict');
  release();const [a,b]=await Promise.all([first,duplicate]);assert.deepEqual(a.body,b.body);assert.deepEqual((await call(f,c)).body,a.body);assert.equal(calls,1);
  f.store.save({profile:{...f.p,secret:'SYNTHETIC_ROTATED'},expectedRevision:f.saved.revision,expectedSnapshotHash:f.saved.snapshotHash});
  const old=await call(f,c);assert.equal(old.body.connection.state,'stale');assert.equal(old.body.profileUnchanged,false);assert.equal(calls,1);
 }finally{f.cleanup();}
});
test('completion after key-only or public revision save cannot sign the new configuration',async()=>{
 for(const change of [{secret:'SYNTHETIC_ROTATED'},{requestedModel:'glm-old'}]){let release;const f=setup(profile(),()=>new Promise(resolve=>{release=()=>resolve(resJSON(native()));}));try{
  const pending=call(f,command(f));await turn();f.store.save({profile:{...f.p,...change},expectedRevision:f.saved.revision,expectedSnapshotHash:f.saved.snapshotHash});release();const result=await pending;
  assert.equal(result.body.profileUnchanged,false);assert.equal(result.body.connection.state,'stale');assert.equal((await view(f)).body.providers.glm.connection.state,'stale');assert.equal(JSON.parse(readFileSync(f.receiptPath)).receipts[0].testedCredentialRevision,1);
 }finally{f.cleanup();}}
});
test('an explicit later test signs credential two and retains only the latest explicit result',async()=>{
 const f=setup();try{
  await call(f,command(f));const before=JSON.parse(readFileSync(f.receiptPath));assert.equal(before.receipts.length,1);
  f.store.save({profile:{...f.p,secret:'SYNTHETIC_ROTATED'},expectedRevision:f.saved.revision,expectedSnapshotHash:f.saved.snapshotHash});
  assert.equal((await view(f)).body.providers.glm.connection.state,'stale');await call(f,command(f));assert.equal((await view(f)).body.providers.glm.connection.state,'passed');
  const after=JSON.parse(readFileSync(f.receiptPath));assert.equal(after.receipts.length,1,'only latest explicit result per profile');assert.equal(after.receipts[0].testedCredentialRevision,2);
 }finally{f.cleanup();}
});
test('HTTP errors, malformed protocol, incomplete final and network failure remain truthful after GET',async()=>{
 const cases=[
  [()=>resJSON({error:{code:'invalid_api_key'}},401),'failed','authentication_rejected'],
  [()=>resJSON({error:{code:'rate_limit_exceeded'}},429),'failed','rate_or_capacity'],
  [()=>resJSON({error:{code:'insufficient_balance'}},402),'failed','billing_or_balance'],
  [()=>resJSON({arbitrary:'body'}),'failed','invalid_protocol_response'],
  [()=>new Response('bad JSON'),'failed','invalid_json_response'],
  [()=>new Response(new ReadableStream({start(controller){controller.error(Error('synthetic disconnected body'));}})),'failed','network_error'],
  [async()=>{const response=resJSON(native());await response.text();return response;},'failed','invalid_json_response'],
  [()=>{const response=resJSON(native());response.body.getReader();return response;},'failed','invalid_json_response'],
  [()=>new Response(new Uint8Array([0xff])),'failed','invalid_json_response'],
  [()=>resJSON({...native(),content:[{type:'thinking',thinking:'private reasoning'}],stop_reason:'max_tokens'}),'incomplete',undefined],
  [()=>{throw Error('raw synthetic secret error');},'failed','network_error'],
 ];
 for(const [transport,state,errorCategory] of cases){let calls=0;const f=setup(profile(),async()=>{calls++;return transport();});try{
  const a=await call(f,command(f));assert.equal(a.body.connection.state,state);assert.equal(a.body.connection.errorCategory,errorCategory);assert.deepEqual((await view(f)).body.providers.glm.connection,a.body.connection);assert.equal(calls,1);assert(!JSON.stringify(a.body).includes('raw synthetic'));
 }finally{f.cleanup();}}
});
test('timeout persists unknown provider processing classification; late transport cannot replace result',async()=>{
 let release,calls=0;const f=setup(profile(),()=>{calls++;return new Promise(resolve=>{release=()=>resolve(resJSON(native()));});},{timeoutMs:10});try{
  const a=await call(f,command(f));assert.equal(a.body.connection.state,'failed');assert.equal(a.body.connection.errorCategory,'timeout_unknown');assert.equal(calls,1);
  release();await turn();assert.deepEqual((await view(f)).body.providers.glm.connection,a.body.connection);assert.equal(calls,1);
 }finally{f.cleanup();}
});
test('receipt persistence failure returns safe unsaved outcome and same ID does not retry provider',async()=>{
 let calls=0;const f=setup(profile(),async()=>{calls++;writeFileSync(f.filePath+'.lock','busy',{mode:0o600});return resJSON(native());});try{
  const c=command(f),r=await call(f,c);assert.equal(r.status,200);assert.equal(r.body.persisted,false);assert.equal(r.body.error,'receipt_persist_failed');assert.equal(r.body.connection.state,'passed');assert.equal((await call(f,c)).body.persisted,false);assert.equal(calls,1);
 }finally{f.cleanup();}
});
test('strict body, stale ref, unsupported profile and origin guards reject with zero provider calls',async()=>{
 let calls=0;const f=setup(profile(),async()=>{calls++;return resJSON(native());});try{
  for(const body of [{...command(f),url:'https://evil.invalid'}, {...command(f),apiKey:'SYNTHETIC'}, {...command(f),requestId:'bad'}, {...command(f),reference:{...ref(f.saved),revision:2}}, 'bad JSON'])assert((await call(f,body)).status>=400);
  assert.equal((await call(f,command(f),'POST',undefined,{origin:'https://evil.invalid'})).status,403);
  const changed=f.store.save({profile:{...f.p,requestedModel:'glm-other'},expectedRevision:f.saved.revision,expectedSnapshotHash:f.saved.snapshotHash});assert.equal((await call(f,{...command(f),reference:ref(changed)})).status,422);assert.equal(calls,0);
 }finally{f.cleanup();}
});

test('legacy null binding remains immutable when a new explicit test signs the actual current credential',async()=>{
 const path=new URL('../../../deliverables/ohuo-batches/S31-PROVIDER-STATE/inputs/probe-glm.actual.json',import.meta.url),bytes=readFileSync(path),original=JSON.parse(JSON.parse(bytes).stdout);
 const f=setup({...profile(),profileId:original.reference.profileId,nickname:'GLM'});f.p.nickname='glm';try{
  assert.deepEqual(ref(f.saved),original.reference);
  f.store.save({profile:{...profile(),profileId:original.reference.profileId,nickname:'GLM',secret:'SYNTHETIC_ROTATED'},expectedRevision:f.saved.revision,expectedSnapshotHash:f.saved.snapshotHash});
  importLegacyReceipts({profilePath:f.filePath,receiptPath:f.receiptPath,sources:[{provider:'glm',path:path.pathname,sha256:createHash('sha256').update(bytes).digest('hex')}]});
  const history=JSON.parse(readFileSync(f.receiptPath)).receipts[0];assert.equal(history.testedCredentialRevision,null);
  assert.equal((await call(f,command(f))).body.connection.state,'passed');
  const records=JSON.parse(readFileSync(f.receiptPath)).receipts;assert.equal(records.length,2);assert.deepEqual(records.find(r=>!r.source),history);assert.equal(records.find(r=>r.source).testedCredentialRevision,2);
 }finally{f.cleanup();}
});
test('response byte budget and secret-bearing model reject safely with no retry',async()=>{
 for(const transport of [()=>new Response('x'.repeat(256*1024+1)),()=>resJSON(native('anthropic-messages','SYNTHETIC_PRIVATE_KEY'))]){
  let calls=0;const f=setup(profile(),async()=>{calls++;return transport();});try{
   const r=await call(f,command(f));assert.equal(r.body.connection.state,'failed');assert(['response_too_large','invalid_protocol_response'].includes(r.body.connection.errorCategory));assert.equal(calls,1);assert(!JSON.stringify(r.body).includes(f.p.secret));assert(!readFileSync(f.receiptPath,'utf8').includes(f.p.secret));
  }finally{f.cleanup();}
 }
});
test('HTTP safety guards and save do not start tests; provider slots are independent and bounded',async()=>{
 let calls=0;const f=setup(profile(),async()=>{calls++;return resJSON(native());});try{
  assert.equal((await call(f,command(f),'POST',undefined,{'content-type':'text/plain'})).status,415);
  assert.equal((await call(f,'x'.repeat(32769))).status,413);
  assert.equal((await call(f,command(f),'POST',undefined,{origin:undefined})).status,403);
  assert.equal((await call(f,{profile:f.p,expectedRevision:f.saved.revision,expectedSnapshotHash:f.saved.snapshotHash},'POST','/api/llm-profiles')).status,200);assert.equal(calls,0);
  const first=command(f);await call(f,first);await call(f,command(f));assert.equal(calls,2);
  // The plan promises no infinite-ID journal. A client must never replay an evicted ID automatically.
  // Only the latest completed attempt remains reusable without another request.
  const latest=command(f);await call(f,latest);await call(f,latest);assert.equal(calls,3);
 }finally{f.cleanup();}
});
test('two providers can each have one explicit in-flight test; cross-provider UUID alias is refused',async()=>{
 const releases=new Map();let calls=0;const f=setup(profile(),(url)=>{calls++;return new Promise(resolve=>releases.set(url,resolve));});try{
  const ds=f.store.save({profile:profile('deepseek','openai-chat-completions'),expectedRevision:null});const a=command(f),pendingGLM=call(f,a);await turn();
  assert.equal((await call(f,{provider:'deepseek',reference:ref(ds),requestId:a.requestId})).body.error,'request_id_conflict');assert.equal(calls,1);
  const pendingDS=call(f,{provider:'deepseek',reference:ref(ds),requestId:randomUUID()});await turn();assert.equal(calls,2);
  releases.get('https://open.bigmodel.cn/api/anthropic/v1/messages')(resJSON(native()));releases.get('https://api.deepseek.com/chat/completions')(resJSON(native('openai-chat-completions','deepseek-flash')));
  const done=await Promise.all([pendingGLM,pendingDS]);assert(done.every(r=>r.body.connection.state==='passed'));assert.equal(calls,2);
 }finally{f.cleanup();}
});
test('unavailable private store returns service unavailable before transport',async()=>{
 let calls=0;const f=setup(profile(),async()=>{calls++;return resJSON(native());});try{
  writeFileSync(f.filePath,'not json');assert.equal((await call(f,command(f))).status,503);assert.equal(calls,0);
 }finally{f.cleanup();}
});
