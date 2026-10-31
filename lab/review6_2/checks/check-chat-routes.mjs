/** M/E09 finite direct-handler tests. No server, private files, real fetch or models. */
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {ProfileError} from '../../../packages/web/server/llm-profiles.mjs';
const moduleUrl=new URL('../../../packages/web/server/chat-routes.mjs',import.meta.url);
globalThis.fetch=async()=>{throw Error('real_network_forbidden_in_M_checks');};
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/profiles.fake.json',import.meta.url))).profiles;
const encoder=new TextEncoder(), tick=()=>new Promise(r=>setImmediate(r));
const reference={profileId:'fixture-deepseek',revision:3,snapshotHash:'1'.repeat(64)};
const messages=[{role:'system',content:'只讲证据。'},{role:'user',content:'请返回完整中文说明。'}];
const command=()=>({reference:structuredClone(reference),messages:structuredClone(messages)});
const sse=(data,event)=>`${event?`event: ${event}\n`:''}data: ${typeof data==='string'?data:JSON.stringify(data)}\n\n`;
const open=(text,finish='stop')=>sse({model:'actual-fixture-model',choices:[{index:0,delta:{content:text},finish_reason:null}]})+sse({choices:[{index:0,delta:{},finish_reason:finish}]})+sse('[DONE]');
const anthropic=(text,finish='end_turn')=>[
 sse({type:'message_start',message:{model:'actual-fixture-glm',content:[],usage:{input_tokens:40}}},'message_start'),
 sse({type:'content_block_start',index:0,content_block:{type:'text',text:''}},'content_block_start'),
 sse({type:'content_block_delta',index:0,delta:{type:'text_delta',text}},'content_block_delta'),
 sse({type:'content_block_stop',index:0},'content_block_stop'),
 sse({type:'message_delta',delta:{stop_reason:finish}},'message_delta'),
 sse({type:'message_stop'},'message_stop'),
].join('');
function upstream(text,{chunks,hold=false,status=200,type='text/event-stream'}={}) {
 let cancellations=0;
 const body=new ReadableStream({start(c){for(const chunk of chunks??[encoder.encode(text)])c.enqueue(chunk);if(!hold)c.close();},cancel(){cancellations++;}});
 return {response:{ok:status>=200&&status<300,status,headers:new Headers({'content-type':type}),body},get cancellations(){return cancellations;}};
}
function request({url='/api/chat',method='POST',headers={},address='127.0.0.1',payload=command(),raw,aborted=false,iterator}={}) {
 const req=new EventEmitter();req.url=url;req.method=method;req.socket={remoteAddress:address};req.aborted=aborted;
 req.headers={host:'127.0.0.1:8787',origin:'http://localhost:5180','content-type':'application/json',...headers};
 req[Symbol.asyncIterator]=iterator??(async function*(){yield Buffer.from(raw??JSON.stringify(payload));});
 return req;
}
function response() {
 const res=new EventEmitter();res.status=null;res.headers={};res.writableEnded=false;res.destroyed=false;res.writes=0;
 res.writeHead=(status,headers)=>{res.status=status;Object.assign(res.headers,headers);res.writes++;return res;};
 res.end=text=>{res.raw=text;res.body=text?JSON.parse(text):null;res.writableEnded=true;return res;};
 return res;
}
async function setup({fetchImpl=async()=>upstream(open('完整中文说明')).response,index=1,store,importer=()=>({baseUrl:'https://fake.invalid/v1',apiKey:'FAKE_IMPORTED_KEY',model:'fake-imported',extra:{preserve:'whole draft'}})}={}) {
 const {createChatRoutes}=await import(moduleUrl);let resolved=0,imports=0,sends=0;
 const profile={...structuredClone(fixtures[index]),profileId:reference.profileId,revision:reference.revision,credentialRevision:7};
 const selectedStore=store??{resolve(ref){resolved++;assert.deepEqual(ref,reference);return profile;}};
 const handler=createChatRoutes({store:selectedStore,fetchImpl:(...args)=>{sends++;return fetchImpl(...args);},importZcodePlan:()=>{imports++;return importer();}});
 return {handler,profile,get resolved(){return resolved;},get imports(){return imports;},get sends(){return sends;}};
}
async function invoke(context,options={}) {const req=request(options),res=response();assert.equal(await context.handler(req,res),true);assert.equal(req.listenerCount('aborted'),0);assert.equal(res.listenerCount('close'),0);return {req,res};}
function failure(res,code){assert.ok(res.status>=400);assert.deepEqual(res.body,{status:'failed',error:code});assert.ok(!res.raw.includes('FAKE_SECRET'));assert.ok(!res.raw.includes('PRIVATE_REASONING'));assert.equal(res.headers['Access-Control-Allow-Origin'],undefined);}
const cases={
 async 'complete-and-profile'(){
  for(const index of [0,1]) {
   const wire=(index?open:anthropic)('完整中文说明，不是选择JSON。');const remote=upstream(wire,{hold:true});let sent;
   const c=await setup({index,fetchImpl:async(url,init)=>{sent={url,init};return remote.response;}});
   const {res}=await invoke(c,{headers:{'x-llm-base':'https://wrong.invalid','x-llm-key':'WRONG_HEADER_KEY','x-llm-model':'wrong-header-model'}});
   assert.equal(res.status,200);assert.equal(res.body.status,'completed');assert.equal(res.body.text,'完整中文说明，不是选择JSON。');
   assert.deepEqual(Object.keys(res.body).sort(),['status','summary','text']);
   const summary=res.body.summary;assert.equal(summary.profileId,reference.profileId);assert.equal(summary.revision,reference.revision);assert.equal(summary.snapshotHash,reference.snapshotHash);assert.equal(summary.protocol,fixtures[index].protocol);assert.equal(summary.requestedModel,fixtures[index].requestedModel);assert.equal(summary.returnedModel,index?'actual-fixture-model':'actual-fixture-glm');assert.equal(summary.requestCount,1);
   assert.equal(c.resolved,1);assert.equal(c.sends,1);assert.equal(remote.cancellations,1);assert.equal(remote.response.body.locked,false);
   const body=JSON.parse(sent.init.body);for(const [k,v]of Object.entries(fixtures[index].requestOptions))assert.deepEqual(body[k],v);
   assert.equal(body.model,fixtures[index].requestedModel);assert.equal(body.stream,true);assert.equal(sent.init.redirect,'error');assert.ok(sent.init.signal instanceof AbortSignal);
   assert.equal(sent.url,fixtures[index].baseUrl+(index?'/chat/completions':'/v1/messages'));
   assert.equal(sent.init.headers[index?'authorization':'x-api-key'],index?`Bearer ${fixtures[index].secret}`:fixtures[index].secret);
   if(index)assert.deepEqual(body.messages,messages);else{assert.equal(body.system,messages[0].content);assert.deepEqual(body.messages,[messages[1]]);}
   assert.ok(!JSON.stringify(summary).includes('secret'));assert.ok(!res.raw.includes('FAKE_SECRET'));
  }
  return {protocols:2,wholeNamedProfile:true,resolveCountEach:1,requestCountEach:1,completeTextNotSelection:true};
 },
 async 'terminal-and-framing'(){
  for(const index of [0,1]) {
   const raw=(index?open:anthropic)('中文分块');const multi=raw.replace(/data: \{/g,'data: {\ndata: ').replace(/\n/g,'\r\n');
   const chunks=Array.from(encoder.encode(': keepalive\r\n\r\n'+multi),x=>new Uint8Array([x]));
   const c=await setup({index,fetchImpl:async()=>upstream('',{chunks}).response});assert.equal((await invoke(c)).res.body.text,'中文分块');
  }
  const good='{"summary":"valid JSON is not protocol completion"}';
  const variants=[
   [1,sse({choices:[{index:0,delta:{content:good},finish_reason:null}]})+sse({error:{message:'FAKE_SECRET'}}),'upstream_error'],
   [0,anthropic(good).replace(sse({type:'message_stop'},'message_stop'),sse({type:'error',error:{message:'FAKE_SECRET'}},'error')),'upstream_error'],
   [1,sse({choices:[{index:0,delta:{content:good},finish_reason:'stop'}]}),'unexpected_eof'],
   [0,anthropic(good).replace(sse({type:'message_stop'},'message_stop'),''),'unexpected_eof'],
   [1,open(good).replace('data: [DONE]\n\n','data: [DONE]'),'unexpected_eof'],
   [1,sse({choices:[{index:0,delta:{content:good},finish_reason:null}]})+sse('[DONE]'),'missing_completion'],
   [1,open(good,'length'),'output_truncated'],[0,anthropic(good,'max_tokens'),'output_truncated'],
   [1,'data: {bad JSON}\n\n','invalid_stream_json'],[1,'','unexpected_eof'],
  ];
  for(const [index,wire,code]of variants){const c=await setup({index,fetchImpl:async()=>upstream(wire).response});failure((await invoke(c)).res,code);assert.equal(c.sends,1);}
  const bad=await setup({fetchImpl:async()=>upstream('',{chunks:[new Uint8Array([0xff])]}).response});failure((await invoke(bad)).res,'invalid_utf8');
  const hidden=sse({choices:[{index:0,delta:{reasoning_content:'PRIVATE_REASONING'},finish_reason:null}]})+open('safe text');
  const c=await setup({fetchImpl:async()=>upstream(hidden).response});const {res}=await invoke(c);assert.equal(res.body.text,'safe text');assert.ok(!res.raw.includes('PRIVATE_REASONING'));
  return {protocols:2,byteChunks:true,multilineCRLF:true,terminalFailures:variants.length,invalidUtf8:true,reasoningDiscarded:true};
 },
 async 'invalid-request-and-config'(){
  const variants=[{...command(),model:'forbidden'}, {...command(),requestOptions:{}}, {...command(),secret:'forbidden'}, {...command(),messages:[]}, {...command(),messages:[{role:'assistant',content:'forbidden'}]}, {...command(),messages:[{role:'user',content:'ok',thinking:'forbidden'}]}, {...command(),messages:[{role:'user',content:''}]}, {messages}, {...command(),reference:{...reference,secret:'forbidden'}}, {...command(),reference:{...reference,revision:0}}, {...command(),reference:{...reference,snapshotHash:'bad'}}];
  for(const payload of variants){const c=await setup();const {res}=await invoke(c,{payload});assert.ok(res.status>=400);assert.equal(c.sends,0);assert.equal(c.resolved,0);}
  for(const code of ['revision_conflict','profile_not_found','invalid_profile_reference']){let resolves=0;const c=await setup({store:{resolve(){resolves++;throw new ProfileError(code);}}});failure((await invoke(c)).res,code);assert.equal(resolves,1);assert.equal(c.sends,0);}
  let c=await setup();failure((await invoke(c,{raw:'{bad json'})).res,'invalid_json');assert.equal(c.sends,0);
  c=await setup();failure((await invoke(c,{headers:{'content-type':'text/plain'}})).res,'json_required');
  c=await setup();const {res}=await invoke(c,{raw:' '.repeat(1024*1024+1)});failure(res,'input_too_large');assert.equal(c.sends,0);
  c=await setup({store:{resolve(){throw Error('FAKE_SECRET private store path');}}});failure((await invoke(c)).res,'profile_service_unavailable');
  return {malformedCommands:variants.length,noSendOrResolveOnShapeError:true,staleBeforeSend:true,storeErrorsRedacted:true};
 },
 async 'single-send-and-rejection'(){
  for(const status of [401,404,429,500]){const remote=upstream('FAKE_SECRET upstream body',{status});const c=await setup({fetchImpl:async()=>remote.response});failure((await invoke(c)).res,'http_error');assert.equal(c.sends,1);assert.equal(remote.cancellations,1);}
  const c=await setup({fetchImpl:async()=>{throw Error('FAKE_SECRET fetch failed');}});failure((await invoke(c)).res,'network_error');assert.equal(c.sends,1);
  const wrong=await setup({fetchImpl:async()=>upstream('FAKE_SECRET',{type:'application/json'}).response});failure((await invoke(wrong)).res,'unexpected_content_type');
  return {httpStatuses:[401,404,429,500],noProtocolRetry:true,rejectedFetchCaught:true,noRawErrorEcho:true};
 },
 async 'cancel-owned-operation'(){
  let c=await setup(),req=request({aborted:true}),res=response();await c.handler(req,res);assert.equal(c.sends,0);assert.equal(res.writes,0);assert.equal(req.listenerCount('aborted'),0);
  let resolveFetch,signal; c=await setup({fetchImpl:(_url,init)=>{signal=init.signal;return new Promise(resolve=>resolveFetch=resolve);}});req=request();res=response();let done=false;
  let pending=c.handler(req,res).then(()=>{done=true;});await tick();assert.equal(done,false);res.emit('close');await pending;assert.equal(signal.aborted,true);assert.equal(res.writes,0);const late=upstream(open('late'));resolveFetch(late.response);await tick();assert.equal(late.cancellations,1);assert.equal(req.listenerCount('aborted'),0);assert.equal(res.listenerCount('close'),0);
  let reads=0,cancels=0,releases=0;
  c=await setup({fetchImpl:async()=>({ok:true,status:200,headers:new Headers({'content-type':'text/event-stream'}),body:{getReader(){return {read(){reads++;return new Promise(()=>{});},cancel(){cancels++;return new Promise(()=>{});},releaseLock(){releases++;}};}}})});
  req=request();res=response();pending=c.handler(req,res);await tick();assert.equal(reads,1);req.emit('aborted');await pending;assert.equal(res.writes,0);assert.equal(cancels,1);assert.equal(releases,1);assert.equal(req.listenerCount('aborted'),0);assert.equal(res.listenerCount('close'),0);
  let returned=0;c=await setup();req=request({iterator:()=>({next:()=>new Promise(()=>{}),return:()=>{returned++;return new Promise(()=>{});}})});res=response();pending=c.handler(req,res);await tick();req.emit('aborted');await pending;assert.equal(c.sends,0);assert.equal(res.writes,0);assert.equal(returned,1);
  return {alreadyAbortedNoSend:true,lateFetchDisposed:true,stalledReadReleased:true,noWaitForCancelAck:true,bodyReadCancelled:true,zeroLateResponses:true};
 },
 async 'import-guard'(){
  const rejected=[{method:'GET'},{method:'OPTIONS'},{method:'PUT'},{headers:{origin:undefined}},{headers:{origin:'http://evil.invalid'}},{headers:{origin:'http://localhost:5180.evil.invalid'}},{headers:{host:'evil.invalid'}},{headers:{'sec-fetch-site':'cross-site'}},{address:'192.0.2.1'}];
  for(const options of rejected){const c=await setup();const {res}=await invoke(c,{url:'/api/import-zcode',...options});assert.ok(res.status>=400);assert.equal(c.imports,0);assert.equal(c.resolved,0);assert.equal(c.sends,0);assert.ok(!Object.keys(res.headers).some(k=>k.toLowerCase()==='access-control-allow-origin'));}
  const c=await setup();const {res}=await invoke(c,{url:'/api/import-zcode'});assert.equal(res.status,200);assert.equal(res.body.apiKey,'FAKE_IMPORTED_KEY');assert.deepEqual(res.body.extra,{preserve:'whole draft'});assert.equal(c.imports,1);assert.equal(c.sends,0);assert.equal(c.resolved,0);assert.equal(res.headers['cache-control'],'no-store');assert.ok(!Object.keys(res.headers).some(k=>k.toLowerCase()==='access-control-allow-origin'));
  const missing=await setup({importer:()=>null});failure((await invoke(missing,{url:'/api/import-zcode'})).res,'import_not_found');
  const thrown=await setup({importer:()=>{throw Error('FAKE_SECRET');}});failure((await invoke(thrown,{url:'/api/import-zcode'})).res,'import_unavailable');
  const chat=await setup();failure((await invoke(chat,{headers:{origin:undefined}})).res,'local_same_origin_required');assert.equal(chat.resolved,0);
  return {rejectedBeforeImport:rejected.length,explicitPostOnly:true,wholeDraftUnchanged:true,noCors:true,noAutoSaveOrTest:true};
 },
};
export async function runChatCase(id){assert.ok(Object.hasOwn(cases,id),'known finite case required');return cases[id]();}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2);assert.ok(args.length===2&&args[0]==='--case'&&Object.hasOwn(cases,args[1]),'exactly one known --case required');
 const startedAt=new Date().toISOString();try{const actual=await runChatCase(args[1]);console.log(JSON.stringify({caseId:args[1],status:'passed',startedAt,endedAt:new Date().toISOString(),actual}));}catch(error){console.error(JSON.stringify({caseId:args[1],status:'failed',startedAt,endedAt:new Date().toISOString(),error:error.message,stack:error.stack}));process.exitCode=1;}
}
