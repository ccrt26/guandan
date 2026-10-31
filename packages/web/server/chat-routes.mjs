/** M/E09 ordinary coach/connection adapter. Import is inert. Named profiles only;
 * no environment/header config, protocol guessing, automatic retry or selection parsing. */
import {createProfileStore,ProfileError} from './llm-profiles.mjs';
import {SelectionWireError,fail,plain} from './llm-selection-wire.mjs';
import {abortCheck,cancellable,discard,consumeText} from './llm-stream.mjs';

const MAX_CHAT_INPUT_BYTES=1024*1024, MAX_CHAT_TEXT_BYTES=256*1024;
const encoder=new TextEncoder();
const loopback=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
const exact=(value,keys)=>plain(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function freeze(value) {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function json(res,status,body) {
  if(res.destroyed||res.writableEnded)return;
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(body));
}
function validateCommand(value) {
  if(!exact(value,['reference','messages']))fail('invalid_chat_request');
  const ref=value.reference;
  if(!exact(ref,['profileId','revision','snapshotHash'])||typeof ref.profileId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(ref.profileId)||!Number.isSafeInteger(ref.revision)||ref.revision<1||typeof ref.snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(ref.snapshotHash))fail('invalid_profile_reference');
  // These two operations send one user message, optionally preceded by one system
  // message. No history, tools, client options or hidden alternative configuration.
  const messages=value.messages;
  if(!Array.isArray(messages)||messages.length<1||messages.length>2)fail('invalid_chat_request');
  for(let index=0;index<messages.length;index++) {
    const message=messages[index],role=index===0&&messages.length===2?'system':'user';
    if(!exact(message,['role','content'])||message.role!==role||typeof message.content!=='string'||!message.content.trim())fail('invalid_chat_request');
  }
  return freeze(structuredClone(value));
}
async function readCommand(req,signal) {
  const chunks=[];let bytes=0,done=false;
  const iterator=req[Symbol.asyncIterator]();
  try {
    for(;;) {
      abortCheck(signal);const item=await cancellable(iterator.next(),signal);abortCheck(signal);
      if(item.done){done=true;break;}
      if(!(item.value instanceof Uint8Array))fail('invalid_chat_request');
      bytes+=item.value.byteLength;if(bytes>MAX_CHAT_INPUT_BYTES)fail('input_too_large');chunks.push(item.value);
    }
    let command;try{command=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail('invalid_json');}
    return validateCommand(command);
  } finally {
    // Abort may outpace a stalled iterator. Cleanup must not await peer ack.
    if(!done)try{Promise.resolve(iterator.return?.()).catch(()=>{});}catch{/* request already ended */}
  }
}
const streamErrors=new Set(['cancelled','missing_body','protocol_error','response_too_large','upstream_error','missing_completion','invalid_stream_json','unsupported_response','output_truncated','unsupported_stream_event','network_error','invalid_utf8','unexpected_eof','http_error','unexpected_content_type','empty_response','invalid_returned_model']);
const inputErrors=new Set(['invalid_json','invalid_chat_request','invalid_profile_reference','input_too_large']);
const profileErrors=new Set(['invalid_profile_reference','profile_not_found','revision_conflict','unsupported_protocol']);
function publicFailure(error) {
  if(error instanceof ProfileError)return profileErrors.has(error.code)?{status:error.code==='revision_conflict'?409:error.code==='profile_not_found'?404:400,code:error.code}:{status:503,code:'profile_service_unavailable'};
  if(error instanceof SelectionWireError) {
    if(inputErrors.has(error.code))return {status:error.code==='input_too_large'?413:400,code:error.code};
    if(streamErrors.has(error.code))return {status:error.code==='cancelled'?499:502,code:error.code};
  }
  return {status:502,code:'network_error'};
}

export function createChatRoutes({store=createProfileStore(),port=8787,uiPort=5180,fetchImpl=globalThis.fetch,importZcodePlan}={}) {
  // Same fixed loopback Host/project Origin sets as profiles/play; unlike public
  // profile GET, these two sensitive operations NEVER accept a missing Origin.
  const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
  const origins=new Set([`http://localhost:${uiPort}`,`http://127.0.0.1:${uiPort}`,...[...hosts].map(host=>`http://${host}`)]);
  return async function handleChat(req,res) {
    if(!['/api/chat','/api/import-zcode'].includes(req.url))return false;
    const abort=new AbortController();let disconnected=false;
    const close=()=>{if(!res.writableEnded){disconnected=true;abort.abort('user_stop');}};
    req.on('aborted',close);res.on('close',close);
    try {
      if(req.aborted||res.destroyed)close();abortCheck(abort.signal);
      if(!loopback(req.socket?.remoteAddress)||!hosts.has(req.headers.host)||!origins.has(req.headers.origin)||req.headers['sec-fetch-site']==='cross-site') {json(res,403,{status:'failed',error:'local_same_origin_required'});return true;}
      if(req.method!=='POST') {json(res,405,{status:'failed',error:'method_not_allowed'});return true;}
      if(req.url==='/api/import-zcode') {
        // Only this explicitly invoked, guarded branch may call the private reader.
        let draft;try{if(typeof importZcodePlan!=='function')throw Error();draft=await cancellable(Promise.resolve(importZcodePlan()),abort.signal);}catch{if(disconnected)return true;json(res,503,{status:'failed',error:'import_unavailable'});return true;}
        abortCheck(abort.signal);
        if(!draft)json(res,404,{status:'failed',error:'import_not_found'});
        else json(res,200,draft); // Whole legacy source is an unverified draft, never saved/tested here.
        return true;
      }
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')) {json(res,415,{status:'failed',error:'json_required'});return true;}
      const command=await readCommand(req,abort.signal);abortCheck(abort.signal);
      let profile;
      try {profile=freeze(structuredClone(store.resolve(command.reference)));}
      catch(error){if(error instanceof ProfileError)throw error;throw new ProfileError('profile_service_unavailable');}
      if(!['openai-chat-completions','anthropic-messages'].includes(profile.protocol))throw new ProfileError('unsupported_protocol');
      // Store's existing exact revision/hash validation is the authority. Freeze its
      // one whole returned record before deriving URL/body/headers, with no fallback.
      const base=profile.baseUrl.replace(/\/$/,''),isOpenAI=profile.protocol==='openai-chat-completions';
      const url=isOpenAI?`${base}/chat/completions`:`${base}${base.endsWith('/v1')?'':'/v1'}/messages`;
      const common={...profile.requestOptions,model:profile.requestedModel,stream:true};
      const system=command.messages.find(message=>message.role==='system')?.content;
      const body=JSON.stringify(isOpenAI?{...common,messages:command.messages}:{...common,...(system?{system}:{}),messages:command.messages.filter(message=>message.role==='user')});
      if(encoder.encode(body).length>MAX_CHAT_INPUT_BYTES)fail('input_too_large');
      const headers=isOpenAI?{'content-type':'application/json',authorization:`Bearer ${profile.secret}`}:{'content-type':'application/json','x-api-key':profile.secret,'anthropic-version':'2023-06-01'};
      const start=performance.now(),metrics={upstreamChunks:0,upstreamEvents:0,contentEvents:0,keepaliveEvents:0,firstUpstreamMs:null,firstContentMs:null,usage:{},returnedModel:null};
      abortCheck(abort.signal);
      const upstream=await cancellable(fetchImpl(url,{method:'POST',headers,body,signal:abort.signal,redirect:'error'}),abort.signal,late=>discard(late?.body));
      if(abort.signal.aborted){discard(upstream?.body);abortCheck(abort.signal);}
      if(!upstream.ok){discard(upstream.body);fail('http_error');}
      if(!/^text\/event-stream(?:\s*;|$)/i.test(upstream.headers?.get('content-type')??'')){discard(upstream.body);fail('unexpected_content_type');}
      const text=await consumeText(upstream,profile.protocol,abort.signal,metrics,start,{maxResponseBytes:MAX_CHAT_TEXT_BYTES});
      abortCheck(abort.signal);if(!text.trim())fail('empty_response');
      if(metrics.returnedModel!==null&&metrics.returnedModel.includes(profile.secret))fail('invalid_returned_model');
      const summary={profileId:profile.profileId,revision:profile.revision,snapshotHash:command.reference.snapshotHash,protocol:profile.protocol,requestedModel:profile.requestedModel,returnedModel:metrics.returnedModel,requestCount:1};
      json(res,200,{status:'completed',text,summary});
    } catch(error) {
      if(!disconnected&&!res.destroyed&&!res.writableEnded) {
        const {status,code}=publicFailure(error);
        // If writing itself fails on a disappearing peer, finalize without another
        // write/rejected async callback. No upstream error/message is echoed.
        try{json(res,status,{status:'failed',error:code});}catch{/* peer gone */}
      }
    } finally {req.off('aborted',close);res.off('close',close);}
    return true;
  };
}
