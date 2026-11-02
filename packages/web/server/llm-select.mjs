/** No import-time I/O, credentials, listeners or fetch. B03 store is explicitly
 * supplied and resolved once; browser code must never import this Node entry. */
import { SelectionWireError, fail, plain, freezeRequestView, responseContract, parseSelection, MAX_INPUT_BYTES, COMMON_VIEW_WIRE_SCHEMA, COMMON_VIEW_RESPONSE_CONTRACT, freezeCommonViewRequest, parseCommonViewSelection } from './llm-selection-wire.mjs';

import {abortCheck,cancelError,cancellable,discard,consumeText} from './llm-stream.mjs';

const encoder=new TextEncoder();
function freeze(v) {if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}

/** Explicit B03 private store required. It validates exact revision/hash and
 * returns a copy. This closure freezes that whole resolved record, never env. */
export function createProfileSelector({store,reference,fetchImpl=globalThis.fetch}) {
  reference=freeze(structuredClone(reference));
  const resolved=store.resolve(reference);
  const profile=freeze(structuredClone(resolved));
  if(!['openai-chat-completions','anthropic-messages'].includes(profile.protocol)||typeof fetchImpl!=='function')throw new SelectionWireError('unsupported_protocol');
  const {secret,credentialRevision,...publicFields}=profile;
  const publicProfile=freeze({...publicFields,snapshotHash:reference.snapshotHash});
  const base=profile.baseUrl.replace(/\/$/,'');
  const url=profile.protocol==='openai-chat-completions'?`${base}/chat/completions`:`${base}${base.endsWith('/v1')?'':'/v1'}/messages`;
  async function request(input,signal) {
    const start=performance.now();
    const summary={profileId:profile.profileId,revision:profile.revision,snapshotHash:reference.snapshotHash,credentialRevision,protocol:profile.protocol,requestedModel:profile.requestedModel,returnedModel:null,requestCount:0,upstreamChunks:0,upstreamEvents:0,contentEvents:0,keepaliveEvents:0,firstUpstreamMs:null,firstContentMs:null,usage:{}};
    try {
      if(!signal||typeof signal.addEventListener!=='function')fail('invalid_signal');abortCheck(signal);
      const commonView=input?.schema===COMMON_VIEW_WIRE_SCHEMA;
      const view=commonView?freezeCommonViewRequest(input):freezeRequestView(input),system=commonView?COMMON_VIEW_RESPONSE_CONTRACT:`${view.observation.rulesText}\n\n${responseContract(view)}`,dynamic=commonView?view.modelPayloadBytes:JSON.stringify(view);
      const common={...profile.requestOptions,model:profile.requestedModel,stream:true};
      const body=JSON.stringify(profile.protocol==='openai-chat-completions'?{...common,messages:[{role:'system',content:system},{role:'user',content:dynamic}]}:{...common,system,messages:[{role:'user',content:dynamic}]});
      if(encoder.encode(body).length>MAX_INPUT_BYTES)fail('input_too_large');
      const headers=profile.protocol==='openai-chat-completions'?{'content-type':'application/json',authorization:`Bearer ${secret}`}:{'content-type':'application/json','x-api-key':secret,'anthropic-version':'2023-06-01'};
      const options={method:'POST',headers,body,signal,redirect:'error'};
      // Native construction/typing errors are local preparation failures, never transport terminals.
      new URL(url);new Headers(headers);new Request(url,options);
      abortCheck(signal);summary.requestCount=1;
      let upstream;
      try {upstream=fetchImpl(url,options);}catch{fail('request_internal_error');}
      let response;
      try {response=await cancellable(upstream,signal,late=>discard(late.body));}
      catch {if(signal.aborted)throw cancelError();fail('transport_failed');}
      if(signal.aborted){discard(response.body);throw cancelError();}
      summary.httpStatus=response.status;
      if(!response.ok){discard(response.body);fail('http_error');}
      if(!/^text\/event-stream(?:\s*;|$)/i.test(response.headers?.get('content-type')??'')){discard(response.body);fail('unexpected_content_type');}
      if(response.bodyUsed||response.body?.locked)fail('request_internal_error');
      let content;
      try {content=await consumeText(response,profile.protocol,signal,summary,start);}
      catch(error){if(error instanceof SelectionWireError&&error.code==='network_error')fail('transport_failed');throw error;}
      const selected=commonView?parseCommonViewSelection(content,view):parseSelection(content,view);abortCheck(signal);
      return {status:'response',response:selected,summary:{...summary,elapsedMs:performance.now()-start}};
    } catch(error) {
      const reason=signal?.aborted?'cancelled':error instanceof SelectionWireError?error.code:'request_internal_error';
      return {status:reason==='cancelled'?'cancelled':'remote_failure',reason,summary:{...summary,elapsedMs:performance.now()-start}};
    }
  }
  return Object.freeze({profile:publicProfile,request});
}
