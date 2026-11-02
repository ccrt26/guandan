/** B04 selected offline cases only. Never fetches, listens or reads real config. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProfileStore } from '../../../packages/web/server/llm-profiles.mjs';
import { decisionRequestView } from '../../../packages/ai/src/hybrid/candidates.ts';
import { transportBundle } from './fixtures/transport-fixture.ts';
const moduleUrl = new URL('../../../packages/web/server/llm-select.mjs', import.meta.url);
const aiUrl = new URL('../../../packages/ai/src/hybrid/remote-selector.ts', import.meta.url);
const profiles = JSON.parse(readFileSync(new URL('./fixtures/profiles.fake.json', import.meta.url))).profiles;
// Even an accidental omitted injection cannot call a real endpoint in this entry.
globalThis.fetch = async () => { throw Error('real_network_forbidden_in_B04_checks'); };
const encoder = new TextEncoder();
const sse = (data, event) => `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
const choice = b => ({ kind: 'choose', decisionId: b.decisionId, actionId: b.offeredIds[0], note: '中文选择' });
const open = (text, finish = 'stop') => sse({ model: 'actual-fixture-model', choices: [{index: 0, delta: {content: text}, finish_reason: null}] }) + sse({choices: [{index: 0, delta: {}, finish_reason: finish}], usage: {prompt_tokens: 40, completion_tokens: 8, total_tokens: 48, prompt_cache_hit_tokens: 12}}) + sse('[DONE]');
const anthropic = (text, finish = 'end_turn') => [
  sse({type:'message_start',message:{model:'actual-fixture-glm',content:[],usage:{input_tokens:40,cache_read_input_tokens:12}}},'message_start'),
  sse({type:'content_block_start',index:0,content_block:{type:'text',text:''}},'content_block_start'),
  sse({type:'content_block_delta',index:0,delta:{type:'text_delta',text}},'content_block_delta'),
  sse({type:'content_block_stop',index:0},'content_block_stop'),
  sse({type:'message_delta',delta:{stop_reason:finish},usage:{output_tokens:8}},'message_delta'),
  sse({type:'message_stop'},'message_stop'),
].join('');
function response(text, { chunks, hold = false, status = 200, type = 'text/event-stream' } = {}) {
  let cancelled = 0;
  const body = new ReadableStream({start(c) { for(const chunk of chunks ?? [encoder.encode(text)]) c.enqueue(chunk); if(!hold)c.close();},cancel(){cancelled++;}});
  return { value: {ok:status>=200&&status<300,status,headers:new Headers({'content-type':type}),body}, get cancelled(){return cancelled;} };
}
async function context(fetchImpl, index=1) {
  assert.ok(existsSync(moduleUrl),'B04 createProfileSelector implementation must exist');
  const { createProfileSelector } = await import(moduleUrl);
  assert.equal(typeof createProfileSelector,'function');
  const root=new URL('../../out/B04/',import.meta.url); mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root.pathname,'transport-fake-'));
  const store=createProfileStore({filePath:join(dir,'fake-private.json')});
  const snapshots=profiles.map(p=>store.save({profile:structuredClone(p),expectedRevision:null}));
  const reference=(({profileId,revision,snapshotHash})=>({profileId,revision,snapshotHash}))(snapshots[index]);
  try {return {selector:createProfileSelector({store,reference,fetchImpl}),store,snapshots,reference,cleanup:()=>rmSync(dir,{recursive:true})};}
  catch(e) {rmSync(dir,{recursive:true});throw e;}
}
async function withSelector(fn, fetchImpl, index=1) {const c=await context(fetchImpl,index);try{return await fn(c);}finally{c.cleanup();}}
async function ai() {assert.ok(existsSync(aiUrl),'B04 selectRemoteDecision implementation must exist'); return import(aiUrl);}
function assertFailure(result, code) {assert.equal(result.status,'remote_failure');if(code)assert.equal(result.reason,code);assert.ok(!JSON.stringify(result).includes('FAKE_SECRET'));}
const cases={
  async 'complete-response'() {
    const b=transportBundle(), view=decisionRequestView(b);
    for(const [idx,wire] of [[1,open(JSON.stringify(choice(b)))],[0,anthropic(JSON.stringify(choice(b)))]]) {
      const hidden=idx===1?sse({choices:[{index:0,delta:{reasoning_content:'PRIVATE_REASONING_SENTINEL'},finish_reason:null}]}):[sse({type:'content_block_start',index:9,content_block:{type:'thinking',thinking:''}},'content_block_start'),sse({type:'content_block_delta',index:9,delta:{type:'thinking_delta',thinking:'PRIVATE_REASONING_SENTINEL'}},'content_block_delta'),sse({type:'content_block_stop',index:9},'content_block_stop')].join('');
      const withHidden=idx===1?hidden+wire:wire.replace('event: content_block_start',hidden+'event: content_block_start');
      const r=response(withHidden,{hold:true});let sends=0;
      await withSelector(async({selector})=>{
        const result=await selector.request(view,new AbortController().signal);
        assert.equal(result.status,'response');assert.deepEqual(result.response,choice(b));assert.equal(result.summary.requestCount,1);assert.ok(!JSON.stringify(result).includes('PRIVATE_REASONING_SENTINEL'));assert.ok(!('thinking' in result.summary));
        assert.equal(result.summary.usage[idx===1?'prompt_cache_hit_tokens':'cache_read_input_tokens'],12);assert.equal(sends,1);assert.equal(r.cancelled,1);
      },async()=>{sends++;return r.value;},idx);
    }
    return {protocols:2,successRequiresMarkers:true,endedBeforeSocketClose:true,readerReleased:true};
  },
  async 'stream-error-or-eof'() {
    const b=transportBundle();const good=JSON.stringify(choice(b));
    const variants=[
      [1,sse({choices:[{index:0,delta:{content:good},finish_reason:null}]})+sse({error:{message:'FAKE_SECRET must never leak'}})+open(good),'upstream_error'],
      [0,anthropic(good).replace(sse({type:'message_stop'},'message_stop'),sse({type:'error',error:{message:'FAKE_SECRET'}},'error')),'upstream_error'],
      [1,sse({choices:[{index:0,delta:{content:good},finish_reason:'stop'}]}),'unexpected_eof'],
      [1,open(good,'length'),'output_truncated'],
      [0,anthropic(good,'max_tokens'),'output_truncated'],
      [1,open(good).replace('data: [DONE]\n\n','data: [DONE]'),'unexpected_eof'],
      [1,open('{"kind":'),'invalid_response_json'],
      [1,sse({choices:[{index:0,delta:{content:good},finish_reason:null}]})+sse('[DONE]'),'missing_completion'],
    ];
    for(const [index,wire,expected] of variants) await withSelector(async({selector})=>assertFailure(await selector.request(decisionRequestView(b),new AbortController().signal),expected),async()=>response(wire).value,index);
    for(const status of [401,429,500]) await withSelector(async({selector})=>{const r=await selector.request(decisionRequestView(b),new AbortController().signal);assertFailure(r,'http_error');assert.equal(r.summary.httpStatus,status);},async()=>response('FAKE_SECRET',{status}).value);
    await withSelector(async({selector})=>assertFailure(await selector.request(decisionRequestView(b),new AbortController().signal),'transport_failed'),async()=>{throw Error('FAKE_SECRET');});
    // A local adapter already consumed this successful body: not an upstream EOF terminal.
    const {selectRemoteDecision}=await ai();const {confirmedRemoteFailure}=await import('../../../packages/ai/src/hybrid/decide.ts');
    await withSelector(async({selector})=>{const result=await selectRemoteDecision({bundle:b,request:selector.request,signal:new AbortController().signal});assert.equal(result.reason,'request_internal_error');assert.equal(result.requestCount,1);assert.equal(confirmedRemoteFailure(result),false);},async()=>{const used=new Response(open(good),{headers:{'content-type':'text/event-stream'}});const reader=used.body.getReader();while(!(await reader.read()).done){}reader.releaseLock();assert.equal(used.bodyUsed,true);assert.equal(used.body.locked,false);return used;});
    return {variants:variants.length,httpStatuses:[401,429,500],networkErrorRedacted:true};
  },
  async 'chunk-boundary'() {
    const b=transportBundle();const json=JSON.stringify(choice(b));
    for(const [idx,wire] of [[1,open(json)],[0,anthropic(json)]]) {
      const multi=wire.replace(/data: \{/g,'data: {\ndata: ').replace(/\n/g,'\r\n');
      const bytes=encoder.encode(': keepalive\r\n\r\n'+multi);const chunks=Array.from(bytes,x=>new Uint8Array([x]));
      await withSelector(async({selector})=>{const r=await selector.request(decisionRequestView(b),new AbortController().signal);assert.equal(r.status,'response');assert.deepEqual(r.response,choice(b));},async()=>response('',{chunks}).value,idx);
    }
    await withSelector(async({selector})=>assertFailure(await selector.request(decisionRequestView(b),new AbortController().signal),'invalid_utf8'),async()=>response('',{chunks:[new Uint8Array([0xff])]}).value);
    return {protocols:2,byteChunks:true,multilineData:true,crlf:true,invalidUtf8Rejected:true};
  },
  async 'cancel-pending'() {
    const b=transportBundle();let resolveFetch;let sends=0;const c=new AbortController();
    await withSelector(async({selector})=>{const pending=selector.request(decisionRequestView(b),c.signal);await Promise.resolve();c.abort('user_stop');const r=await pending;assert.equal(r.status,'cancelled');const late=response(open(JSON.stringify(choice(b))));resolveFetch(late.value);await new Promise(r=>setTimeout(r,0));assert.equal(late.cancelled,1);},()=>{sends++;return new Promise(r=>resolveFetch=r);});
    const c2=new AbortController();const r=response(': heartbeat\n\n',{hold:true});
    await withSelector(async({selector})=>{let settled=false;const p=selector.request(decisionRequestView(b),c2.signal).then(x=>{settled=true;return x;});await new Promise(r=>setTimeout(r,0));assert.equal(settled,false);c2.abort('pause');assert.equal((await p).status,'cancelled');assert.equal(r.cancelled,1);},async()=>r.value);
    const {selectRemoteDecision}=await ai();const c3=new AbortController();let invoked;
    const dispatched=new Promise(r=>invoked=r);
    await withSelector(async({selector})=>{const p=selectRemoteDecision({bundle:b,request:selector.request,signal:c3.signal});await dispatched;c3.abort('user_stop');const terminal=await p;assert.equal(terminal.status,'cancelled');assert.equal(terminal.requestCount,1,'cancellation must retain actual upstream send count');},()=>{invoked();return new Promise(()=>{});});
    return {sends,lateBodyCancelled:true,silentHeartbeatNotSuccessOrTimeout:true,streamCancelled:true,cancelledSendCount:1};
  },
  async 'profile-isolation'() {
    const b=transportBundle();const requests=[];
    for(const idx of [0,1]) await withSelector(async({selector,store,snapshots,reference})=>{
      const snapshot=snapshots[idx];store.save({profile:{...profiles[idx],requestedModel:'changed-after-freeze',secret:'FAKE_ROTATED'},expectedRevision:snapshot.revision,expectedSnapshotHash:snapshot.snapshotHash});
      reference.snapshotHash='0'.repeat(64);
      const returned=await selector.request(decisionRequestView(b),new AbortController().signal);assert.equal(returned.status,'response');assert.equal(returned.summary.snapshotHash,snapshot.snapshotHash,'caller mutation must not change frozen reference');
      const {url,init}=requests.at(-1),body=JSON.parse(init.body);
      assert.equal(body.model,profiles[idx].requestedModel);for(const [k,v] of Object.entries(profiles[idx].requestOptions))assert.deepEqual(body[k],v);
      assert.ok(!init.body.includes('FAKE_SECRET'));for(const forbidden of ['canonicalId','rawQ','rngState','originalIndex','fallbackActionId','initialCandidateIds'])assert.ok(!init.body.includes(forbidden));assert.equal(init.redirect,'error');assert.equal(url,profiles[idx].baseUrl+(idx===0?'/v1/messages':'/chat/completions'));
      assert.equal(init.headers[idx===0?'x-api-key':'authorization'],idx===0?profiles[idx].secret:`Bearer ${profiles[idx].secret}`);
      assert.ok(!JSON.stringify(selector.profile).includes('secret'));assert.ok(!('reasoning_effort' in body)||idx===1);assert.ok(!('thinking' in body)||idx===0);
    },async(url,init)=>{requests.push({url,init});return response((idx===0?anthropic:open)(JSON.stringify(choice(b)))).value;},idx);
    return {profiles:2,frozenWholeRevision:true,exactOptions:true,noEnvironmentReads:true};
  },
  async 'input-boundary'() {
    const b=transportBundle(), v=decisionRequestView(b);let sends=0;const {selectRemoteDecision}=await ai();const {confirmedRemoteFailure}=await import('../../../packages/ai/src/hybrid/decide.ts');
    await withSelector(async({selector,store,reference})=>{
      for(const mutate of [x=>{x.observation.rngState=123;},x=>{x.observation.ownHand[0].physicalId='LEAK';},x=>{x.candidates[0].rawQ=3;},x=>{x.candidates.push(...x.candidates);},x=>{x.observation.rulesText='';}]) {
        const bad=structuredClone(v);mutate(bad);assertFailure(await selector.request(bad,new AbortController().signal),'invalid_request');
      }
      const large=structuredClone(v);large.observation.rulesText='必需规则'.repeat(100000);assertFailure(await selector.request(large,new AbortController().signal),'input_too_large');assert.equal(sends,0);const remote=await selectRemoteDecision({bundle:b,request:(_v,signal)=>selector.request(large,signal),signal:new AbortController().signal});assert.equal(confirmedRemoteFailure(remote),false);assert.equal(remote.requestCount,0);assert.equal(sends,0);
      // Bypass fake-store field validation deliberately: exercise native Headers/Request preparation, not save validation.
      const {createProfileSelector}=await import(moduleUrl);const captured=store.resolve(reference);
      const native=createProfileSelector({store:{resolve:()=>({...captured,secret:'FAKE\nBAD'})},reference,fetchImpl:()=>{sends++;throw Error('native preparation must prevent send');}});
      const preparation=await selectRemoteDecision({bundle:b,request:native.request,signal:new AbortController().signal});
      assert.equal(preparation.reason,'request_internal_error');assert.equal(preparation.requestCount,0);assert.equal(confirmedRemoteFailure(preparation),false);assert.equal(sends,0);
    },async()=>{sends++;throw Error('must not send');});
    return {rejectedExtrasAndLimits:true,upstreamRequests:sends,noTruncation:true};
  },
  async 'expand-and-choose'() {
    const {selectRemoteDecision}=await ai();const b=transportBundle();const first=decisionRequestView(b);assert.ok(first.expandableGroups.length);
    let sends=0;const bodies=[];
    await withSelector(async({selector})=>{
      const result=await selectRemoteDecision({bundle:b,request:selector.request,signal:new AbortController().signal});
      assert.equal(result.status,'selected');assert.equal(result.requestCount,2);assert.ok(result.elapsedMs>=result.attempts.reduce((n,a)=>n+a.elapsedMs,0),'whole-decision elapsed time includes both requests');assert.ok(!b.offeredIds.includes(result.actionId));assert.equal(result.inInitialCandidateSet,false);assert.equal(result.offeredIds.length<=12,true);
      assert.deepEqual(bodies[0].observation,bodies[1].observation);assert.deepEqual(bodies[0].candidates,bodies[1].candidates.slice(0,bodies[0].candidates.length));assert.equal(b.offeredIds.length,8);assert.equal(b.expansionCount,0);
    },async(_u,init)=>{sends++;const payload=JSON.parse(JSON.parse(init.body).messages.at(-1).content);bodies.push(payload);return response(open(JSON.stringify(sends===1?{kind:'expand',decisionId:b.decisionId,groupId:first.expandableGroups[0].groupId}:{kind:'choose',decisionId:b.decisionId,actionId:payload.candidates.at(-1).actionId}))).value;});
    return {sends,initialCount:8,expandedAtMost4:true,fullObservationRepeated:true,noCandidateOrFallbackMutation:true};
  },
  async 'second-expand-rejected'() {
    const {selectRemoteDecision}=await ai();const b=transportBundle();let sends=0;const payload={kind:'expand',decisionId:b.decisionId,groupId:decisionRequestView(b).expandableGroups[0].groupId};
    await withSelector(async({selector})=>{const result=await selectRemoteDecision({bundle:b,request:selector.request,signal:new AbortController().signal});assertFailure(result,'expansion_already_used');assert.equal(sends,2);},async()=>{sends++;return response(open(JSON.stringify(payload))).value;});
    return {sends,secondExpandRejected:true};
  },
  async 'response-identity'() {
    const b=transportBundle();const {selectRemoteDecision}=await ai();const {confirmedRemoteFailure}=await import('../../../packages/ai/src/hybrid/decide.ts');
    const variants=[{kind:'choose',decisionId:'wrong',actionId:b.offeredIds[0]},{kind:'choose',decisionId:b.decisionId,actionId:b.pool.find(x=>!b.offeredIds.includes(x.actionId)).actionId},{kind:'expand',decisionId:b.decisionId,groupId:'unoffered'},{...choice(b),reasoning:'must not accept'}];
    for(const value of variants) await withSelector(async({selector})=>{const r=await selectRemoteDecision({bundle:b,request:selector.request,signal:new AbortController().signal});assertFailure(r);assert.equal(r.requestCount,1);assert.equal(confirmedRemoteFailure(r),true,'completed wire output is unusable, unlike a local consumer contract fault');},async()=>response(open(JSON.stringify(value))).value);
    return {rejectedWrongDecisionUnseenActionUnseenGroupExtraFields:variants.length};
  },
  async 'cancel-before-expand'() {
    const b=transportBundle();const {selectRemoteDecision}=await ai();const c=new AbortController();let sends=0;
    await withSelector(async({selector})=>{const request=async(view,signal)=>{const result=await selector.request(view,signal);c.abort('new_game');return result;};const result=await selectRemoteDecision({bundle:b,request,signal:c.signal});assert.equal(result.status,'cancelled');assert.equal(sends,1);},async()=>{sends++;return response(open(JSON.stringify({kind:'expand',decisionId:b.decisionId,groupId:decisionRequestView(b).expandableGroups[0].groupId}))).value;});
    return {sends,secondRequestBlocked:true};
  },
};
export async function runTransportCase(caseId) {if(!Object.hasOwn(cases,caseId))throw Error('unsupported_case');return cases[caseId]();}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);assert.ok(args.length===2&&args[0]==='--case'&&Object.hasOwn(cases,args[1]),'exactly one known --case required');
  const sources=['packages/web/server/llm-select.mjs','packages/web/server/llm-selection-wire.mjs','packages/ai/src/hybrid/remote-selector.ts','packages/ai/src/hybrid/decide.ts','lab/review6_2/checks/check-transport.mjs','lab/review6_2/checks/fixtures/transport-fixture.ts','lab/review6_2/checks/fixtures/profiles.fake.json','packages/web/server/llm-profiles.mjs','packages/ai/src/hybrid/candidates.ts','packages/ai/src/hybrid/observation.ts','packages/ai/src/hybrid/protocol.ts'];
  const sourceHashes=Object.fromEntries(sources.map(p=>[p,existsSync(p)?createHash('sha256').update(readFileSync(p)).digest('hex'):null]));
  const startedAt=new Date().toISOString();try {const actual=await runTransportCase(args[1]);console.log(JSON.stringify({batchId:'B04',caseId:args[1],status:'passed',startedAt,endedAt:new Date().toISOString(),sourceHashes,actual}));}catch(e){console.error(JSON.stringify({batchId:'B04',caseId:args[1],status:'failed',startedAt,endedAt:new Date().toISOString(),sourceHashes,error:e.message,stack:e.stack}));process.exitCode=1;}
}
