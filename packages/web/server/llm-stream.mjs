/** B04 framing/terminal reader shared by decision selection and M coach text.
 * Import is inert. No credential reads, listeners or upstream requests here. */
import {SelectionWireError,fail,plain,MAX_RESPONSE_BYTES} from './llm-selection-wire.mjs';

const encoder=new TextEncoder();
const MAX_EVENT_BYTES=128*1024, MAX_STREAM_BYTES=8*1024*1024;
export const cancelError=()=>new SelectionWireError('cancelled');
export const abortCheck=signal=>{if(signal.aborted)throw cancelError();};
export function discard(body) {try {Promise.resolve(body?.cancel()).catch(()=>{});}catch{/* no upstream text */}}
/** Race even transports that fail to honour signal. Late responses are disposed. */
export function cancellable(promise,signal,onLate) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const abort=()=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);reject(cancelError());};
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    Promise.resolve(promise).then(value=>{if(settled){onLate?.(value);return;}settled=true;signal.removeEventListener('abort',abort);resolve(value);},error=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);reject(error);});
  });
}
const usageKeys=['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens','input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'];
function recordUsage(source,target) {
  if(!plain(source))return;
  for(const k of usageKeys)if(Number.isSafeInteger(source[k])&&source[k]>=0)target[k]=source[k];
  for(const [key,fields] of [['prompt_tokens_details',['cached_tokens']],['completion_tokens_details',['reasoning_tokens']]])if(plain(source[key]))for(const k of fields)if(Number.isSafeInteger(source[key][k])&&source[key][k]>=0)(target[key]??={})[k]=source[key][k];
}
/** Shared SSE framing: UTF-8 byte chunks, LF/CRLF/CR, multiline data. A partial
 * event at EOF is never promoted to a completion event. No text/CoT log. */
export async function consumeText(response,protocol,signal,summary,start,{maxResponseBytes=MAX_RESPONSE_BYTES}={}) {
  if(!response.body||typeof response.body.getReader!=='function')fail('missing_body');
  const reader=response.body.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
  let line='',data=[],eventName='',skipLF=false,eventBytes=0,streamBytes=0,content='',contentBytes=0,stopped=false,complete=false;
  let messageStarted=false,activeBlock=null,textBlocks=0;
  const append=text=>{
    if(typeof text!=='string')fail('protocol_error');if(!text)return;
    const n=encoder.encode(text).length;contentBytes+=n;if(contentBytes>maxResponseBytes)fail('response_too_large');
    content+=text;summary.contentEvents++;summary.firstContentMs??=performance.now()-start;
  };
  const model=value=>{if(typeof value==='string'&&value.length<=200)summary.returnedModel=value;};
  function dispatch() {
    const payload=data.join('\n'), name=eventName;data=[];eventName='';eventBytes=0;
    if(!payload){if(name==='error')fail('upstream_error');return;}
    summary.upstreamEvents++;
    if(name==='error')fail('upstream_error');
    if(protocol==='openai-chat-completions'&&payload==='[DONE]') {if(!stopped)fail('missing_completion');complete=true;return;}
    let v;try{v=JSON.parse(payload);}catch{fail('invalid_stream_json');}
    if(!plain(v))fail('protocol_error');if(Object.hasOwn(v,'error')||v.type==='error')fail('upstream_error');
    if(protocol==='openai-chat-completions') {
      if(name&&name!=='message')fail('protocol_error');model(v.model);recordUsage(v.usage,summary.usage);
      if(!Array.isArray(v.choices)||v.choices.length>1)fail('protocol_error');
      if(!v.choices.length){if(!v.usage)fail('protocol_error');return;}
      const choice=v.choices[0];if(!plain(choice)||choice.index!==0||!plain(choice.delta))fail('protocol_error');
      if(choice.delta.tool_calls||choice.delta.function_call||choice.delta.refusal)fail('unsupported_response');
      if(stopped&&choice.delta.content)fail('protocol_error');
      if(choice.delta.content!==undefined&&choice.delta.content!==null)append(choice.delta.content);
      // reasoning_content / reasoning are deliberately ignored, never stored.
      if(choice.finish_reason!==null&&choice.finish_reason!==undefined) {
        if(choice.finish_reason!=='stop')fail(['length','content_filter'].includes(choice.finish_reason)?'output_truncated':'unsupported_response');
        if(stopped)fail('protocol_error');stopped=true;
      }
      return;
    }
    if(name&&name!==v.type)fail('protocol_error');
    switch(v.type) {
      case 'ping': summary.keepaliveEvents++;return;
      case 'message_start':
        if(messageStarted||!plain(v.message)||!Array.isArray(v.message.content)||v.message.content.length)fail('protocol_error');
        messageStarted=true;model(v.message.model);recordUsage(v.message.usage,summary.usage);return;
      case 'content_block_start':
        if(!messageStarted||stopped||activeBlock!==null||!Number.isSafeInteger(v.index)||!plain(v.content_block))fail('protocol_error');
        if(!['text','thinking','redacted_thinking'].includes(v.content_block.type))fail('unsupported_response');
        activeBlock={index:v.index,type:v.content_block.type};
        if(activeBlock.type==='text'){if(++textBlocks>1)fail('unsupported_response');append(v.content_block.text);}
        return;
      case 'content_block_delta':
        if(!activeBlock||v.index!==activeBlock.index||!plain(v.delta)||stopped)fail('protocol_error');
        if(v.delta.type==='text_delta'&&activeBlock.type==='text')append(v.delta.text);
        else if(!(['thinking_delta','signature_delta'].includes(v.delta.type)&&activeBlock.type==='thinking'))fail('unsupported_response');
        return;
      case 'content_block_stop': if(!activeBlock||v.index!==activeBlock.index)fail('protocol_error');activeBlock=null;return;
      case 'message_delta':
        if(!messageStarted||activeBlock!==null||!plain(v.delta)||stopped)fail('protocol_error');
        recordUsage(v.usage,summary.usage);
        if(v.delta.stop_reason!==null&&v.delta.stop_reason!==undefined){if(v.delta.stop_reason!=='end_turn')fail(v.delta.stop_reason==='max_tokens'?'output_truncated':'unsupported_response');stopped=true;}
        return;
      case 'message_stop': if(!messageStarted||activeBlock!==null||!stopped)fail('missing_completion');complete=true;return;
      default: fail('unsupported_stream_event');
    }
  }
  function endLine() {
    if(line==='')dispatch();
    else if(line.startsWith(':'))summary.keepaliveEvents++;
    else {
      const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon);let value=colon<0?'':line.slice(colon+1);if(value.startsWith(' '))value=value.slice(1);
      if(field==='data')data.push(value);else if(field==='event')eventName=value;
      else if(!['id','retry'].includes(field))fail('protocol_error');
    }
    line='';
  }
  try {
    while(!complete) {
      abortCheck(signal);let item;
      try{item=await cancellable(reader.read(),signal);}catch(error){if(error instanceof SelectionWireError)throw error;fail('network_error');}
      abortCheck(signal);
      if(item.done){try{decoder.decode();}catch{fail('invalid_utf8');}fail('unexpected_eof');}
      if(!(item.value instanceof Uint8Array))fail('protocol_error');streamBytes+=item.value.byteLength;if(streamBytes>MAX_STREAM_BYTES)fail('response_too_large');
      summary.upstreamChunks++;summary.firstUpstreamMs??=performance.now()-start;
      let text;try{text=decoder.decode(item.value,{stream:true});}catch{fail('invalid_utf8');}
      for(const ch of text) {
        if(skipLF){skipLF=false;if(ch==='\n')continue;}
        eventBytes+=encoder.encode(ch).length;if(eventBytes>MAX_EVENT_BYTES)fail('response_too_large');
        if(ch==='\r'||ch==='\n'){endLine();if(ch==='\r')skipLF=true;}else line+=ch;
        if(complete)break;
      }
    }
    abortCheck(signal);return content;
  } finally {
    // Do not wait for a peer's socket-close/cancel acknowledgement.
    try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{/* already closed */}
    try{reader.releaseLock();}catch{/* pending read released on abort */}
  }
}
