import {PROJECT_RULES_TEACHER_WIRE_SCHEMA,serializeProjectRulesChat} from './llm-project-rules-v541.mjs';
/** No import-time I/O, credentials, listeners or fetch. B03 store is explicitly
 * supplied and resolved once; browser code must never import this Node entry. */
import { SelectionWireError, fail, plain, freezeRequestView, responseContract, parseSelection, MAX_INPUT_BYTES, COMMON_VIEW_WIRE_SCHEMA, COMMON_VIEW_RESPONSE_CONTRACT, freezeCommonViewRequest, parseCommonViewSelection, freezeProjectRulesRequest, parseProjectRulesSelection } from './llm-selection-wire.mjs';

import {abortCheck,cancelError,cancellable,discard,consumeText} from './llm-stream.mjs';
import {types as utilTypes} from 'node:util';

const encoder=new TextEncoder();
// Private designer-only projection. Never read message/stack or coerce values.
const diagnosticClasses=new Set(['Error','TypeError','RangeError','AggregateError','AbortError','TimeoutError','ConnectTimeoutError','SocketError']);
const diagnosticCodes=new Set(['ENOTFOUND','EAI_AGAIN','EPERM','EACCES','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','UND_ERR_ABORTED','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID']);
function diagnosticValue(error,key) {
  // Descriptor-only reads skip accessors. Bounds also cover hostile prototypes.
  try {for(let value=error,depth=0;value&&typeof value==='object'&&!utilTypes.isProxy(value)&&depth<4;value=Object.getPrototypeOf(value),depth++){
    const own=Object.getOwnPropertyDescriptor(value,key);if(own)return Object.hasOwn(own,'value')?own.value:undefined;
  }}catch{/* Opaque thrown values remain unknown; diagnostics never change failure. */}
}
function transportDiagnostic(phase,error) {
  const allowed=(values,value)=>values.has(value)?value:'unknown',causeCodes=[];
  for(let cause=diagnosticValue(error,'cause'),depth=0;cause!=null&&depth<4;cause=diagnosticValue(cause,'cause'),depth++)causeCodes.push(allowed(diagnosticCodes,diagnosticValue(cause,'code')));
  return {phase,errorClass:allowed(diagnosticClasses,diagnosticValue(error,'name')),errorCode:allowed(diagnosticCodes,diagnosticValue(error,'code')),causeCodes};
}
function freeze(v) {if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}

/** Explicit B03 private store required. It validates exact revision/hash and
 * returns a copy. This closure freezes that whole resolved record, never env. */
export function createProfileTextTransport({store,reference,fetchImpl=globalThis.fetch},contract) {
  // Trusted code-only contract. Task/profile JSON never supplies serializers or parsers.
  if(typeof contract?.prepare!=='function'||typeof contract?.parse!=='function'||contract.maxResponseBytes!==undefined&&(!Number.isSafeInteger(contract.maxResponseBytes)||contract.maxResponseBytes<1||contract.maxResponseBytes>4*1024*1024))throw new SelectionWireError('invalid_text_contract');
  contract=Object.freeze({...contract});
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
    let privateResponseText,privateTransportDiagnostic;
    try {
      if(!signal||typeof signal.addEventListener!=='function')fail('invalid_signal');abortCheck(signal);
      const {view,body}=contract.prepare(input,publicProfile);if(typeof body!=='string')fail('invalid_request');
      if(encoder.encode(body).length>MAX_INPUT_BYTES)fail('input_too_large');
      const headers=profile.protocol==='openai-chat-completions'?{'content-type':'application/json',authorization:`Bearer ${secret}`}:{'content-type':'application/json','x-api-key':secret,'anthropic-version':'2023-06-01'};
      const options={method:'POST',headers,body,signal,redirect:'error'};
      // Native construction/typing errors are local preparation failures, never transport terminals.
      new URL(url);new Headers(headers);new Request(url,options);
      abortCheck(signal);summary.requestCount=1;
      let upstream;
      try {upstream=fetchImpl(url,options);}catch(error){if(contract.retainPrivateTransportDiagnostic===true)privateTransportDiagnostic=transportDiagnostic('fetch_invoke',error);fail('request_internal_error');}
      let response;
      try {response=await cancellable(upstream,signal,late=>discard(late.body));}
      catch(error) {if(signal.aborted)throw cancelError();if(contract.retainPrivateTransportDiagnostic===true)privateTransportDiagnostic=transportDiagnostic('fetch_await',error);fail('transport_failed');}
      if(signal.aborted){discard(response.body);throw cancelError();}
      summary.httpStatus=response.status;
      if(!response.ok){discard(response.body);fail('http_error');}
      if(!/^text\/event-stream(?:\s*;|$)/i.test(response.headers?.get('content-type')??'')){discard(response.body);fail('unexpected_content_type');}
      if(response.bodyUsed||response.body?.locked)fail('request_internal_error');
      let content;
      try {content=await consumeText(response,profile.protocol,signal,summary,start,{maxResponseBytes:contract.maxResponseBytes});}
      catch(error){if(error instanceof SelectionWireError&&error.code==='network_error')fail('transport_failed');throw error;}
      if(contract.retainPrivateResponse===true)privateResponseText=content;
      const selected=contract.parse(content,view);abortCheck(signal);
      return {status:'response',response:selected,...(privateResponseText!==undefined?{privateResponseText}:{}),summary:{...summary,elapsedMs:performance.now()-start}};
    } catch(error) {
      const reason=signal?.aborted?'cancelled':error instanceof SelectionWireError?error.code:'request_internal_error';
      return {status:reason==='cancelled'?'cancelled':'remote_failure',reason,...(privateTransportDiagnostic!==undefined&&reason!=='cancelled'?{privateTransportDiagnostic}:{}),...(privateResponseText!==undefined?{privateResponseText}:{}),summary:{...summary,elapsedMs:performance.now()-start}};
    }
  }
  return Object.freeze({profile:publicProfile,request});
}

/** Existing selector remains byte/behavior-compatible; designer uses a distinct
 * structured contract over this same transport, never parseSelection. */
export function createProfileSelector(options) {
  return createProfileTextTransport(options,{
    prepare(input,profile) {
      const projectRules=input?.schema===PROJECT_RULES_TEACHER_WIRE_SCHEMA,commonView=projectRules||input?.schema===COMMON_VIEW_WIRE_SCHEMA;
      const view=projectRules?freezeProjectRulesRequest(input):commonView?freezeCommonViewRequest(input):freezeRequestView(input),system=commonView?COMMON_VIEW_RESPONSE_CONTRACT:`${view.observation.rulesText}\n\n${responseContract(view)}`,dynamic=commonView?view.modelPayloadBytes:JSON.stringify(view);
      const common={...profile.requestOptions,model:profile.requestedModel,stream:true};
      const body=projectRules?serializeProjectRulesChat(profile,{role:'teacher',modelPayloadBytes:dynamic}):JSON.stringify(profile.protocol==='openai-chat-completions'?{...common,messages:[{role:'system',content:system},{role:'user',content:dynamic}]}:{...common,system,messages:[{role:'user',content:dynamic}]});
      return {view,body};
    },
    parse(content,view) {
      return view?.schema===PROJECT_RULES_TEACHER_WIRE_SCHEMA?parseProjectRulesSelection(content,view):view?.schema===COMMON_VIEW_WIRE_SCHEMA?parseCommonViewSelection(content,view):parseSelection(content,view);
    },
  });
}
