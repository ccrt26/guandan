import {it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
// @ts-expect-error Node helper intentionally JS
import {createPlayRoutes} from '../server/play-routes.mjs';
import {createRemotePlayRequest} from '../src/game/remote-play';
import {ProfileError} from '../server/llm-profiles.mjs';
import {decisionRequestView} from '../../ai/src/hybrid/candidates';
import {transportBundle} from '../../../lab/review6_2/checks/fixtures/transport-fixture';
const reference={profileId:'fake',revision:1,snapshotHash:'0'.repeat(64)};
const profile={...reference,nickname:'fake',protocol:'openai-chat-completions',baseUrl:'https://invalid.test',requestedModel:'fake',supportedReasoningOptions:{},requestOptions:{max_tokens:100},secret:'not-a-real-key',credentialRevision:1};
function pair(body:any){const req=new EventEmitter() as any;Object.assign(req,{url:'/api/llm-play',method:'POST',headers:{host:'localhost:8787',origin:'http://localhost:5180','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}});const res=new EventEmitter() as any;Object.assign(res,{writableEnded:false,writeHead(status:number){this.status=status;},end(body:string){this.body=JSON.parse(body);this.writableEnded=true;}});return {req,res};}
it('same-origin route rejects changed frozen reference before any upstream',async()=>{let sends=0;const handler=createPlayRoutes({store:{resolve(){throw new ProfileError('revision_conflict');}},fetchImpl:()=>{sends++;}});const {req,res}=pair({reference,view:decisionRequestView(transportBundle())});await handler(req,res);expect(res.body.error).toBe('revision_conflict');expect(sends).toBe(0);});
it('route abort propagates into exact B04 request and discards late output',async()=>{let signal:AbortSignal|undefined,resolve!:(v:any)=>void;const handler=createPlayRoutes({store:{resolve:()=>profile},fetchImpl:(_:any,init:any)=>{signal=init.signal;return new Promise(r=>{resolve=r;});}});const {req,res}=pair({reference,view:decisionRequestView(transportBundle())});const pending=handler(req,res);for(let i=0;i<8&&!signal;i++)await Promise.resolve();expect(signal).toBeDefined();res.emit('close');expect(signal!.aborted).toBe(true);await pending;expect(res.body).toBeUndefined();resolve(new Response(''));});
it('browser propagates AbortSignal and frozen profile ref without secret',async()=>{let init:RequestInit|undefined;const request=createRemotePlayRequest(reference,async(_url,options)=>{init=options;return new Response(JSON.stringify({error:'revision_conflict'}),{status:409});});const abort=new AbortController();const result=await request(decisionRequestView(transportBundle()),abort.signal);expect(init!.signal).toBe(abort.signal);expect(JSON.parse(init!.body as string).reference).toEqual(reference);expect(init!.body).not.toContain('secret');expect(result).toMatchObject({status:'remote_failure',reason:'revision_conflict',summary:{requestCount:0}});});
it('browser lost proxy receipt reports unknown count, not zero sends',async()=>{
 const request=createRemotePlayRequest(reference,async()=>{throw Error('disconnected after server send');});
 const result=await request(decisionRequestView(transportBundle()),new AbortController().signal);
 expect(result.summary.requestCount).toBeNull();expect(result).toMatchObject({status:'remote_failure',reason:'transport_failed'});
});

it('terminal-origin: transport versus invalid envelope',async()=>{
 const bundle=transportBundle(),view=decisionRequestView(bundle);
 const receipt={...reference,credentialRevision:1,protocol:'openai-chat-completions',requestedModel:'fake',returnedModel:null,requestCount:1,httpStatus:503,elapsedMs:0,upstreamChunks:0,upstreamEvents:0,contentEvents:0,keepaliveEvents:0,firstUpstreamMs:null,firstContentMs:null,usage:{}};
 for(const [kind,fetcher,reason] of [
  ['fetch',async()=>{throw Error('synthetic closed fetch');},'transport_failed'],
  ['read',async()=>new Response(new ReadableStream({start(c){c.error(Error('synthetic closed body'));}})),'transport_failed'],
  ['used',async()=>{const response=new Response('{}');await response.text();return response;},'invalid_profile_response'],
  ['json',async()=>new Response('{bad'),'invalid_profile_response'],
  ['ref',async()=>new Response(JSON.stringify({status:'remote_failure',reason:'http_error',summary:{...receipt,revision:2}})),'invalid_profile_response'],
 ] as const){const request=createRemotePlayRequest(reference,fetcher);const result=await request(view,new AbortController().signal);expect(result).toMatchObject({reason});expect(result.summary.requestCount).toBeNull();
  // The pure eligibility gate is checked here; actual engine apply/legality remains in decide-b05.
  const {confirmedRemoteFailure}=await import('../../ai/src/hybrid/decide');expect(confirmedRemoteFailure({status:'remote_failure',reason:(result as any).reason,decisionKey:bundle.key,offeredIds:bundle.offeredIds,requestCount:result.summary.requestCount,elapsedMs:result.summary.elapsedMs,attempts:[result.summary]})).toBe(kind==='fetch'||kind==='read');
 }
});
