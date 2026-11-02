/** Single native connectivity request using a captured saved profile. No retries, redirects or CLI. */
import { matchesProviderPreset } from './llm-provider-state.mjs';
const TIMEOUT_MS=60000, MAX_RESPONSE_BYTES=256*1024;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>plain(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const validRef=r=>exact(r,['profileId','revision','snapshotHash'])&&typeof r.profileId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(r.profileId)&&Number.isSafeInteger(r.revision)&&r.revision>0&&typeof r.snapshotHash==='string'&&/^[a-f0-9]{64}$/.test(r.snapshotHash);
const safeModel=(value,secret)=>typeof value==='string'&&value.length>0&&value.length<=200&&/^[A-Za-z0-9_.:/\[\]-]+$/.test(value)&&!value.includes(secret)?value:null;
const numericCodes=new Set(['1000','1001','1003','1005','1113','1200','1210','1211','1212','1213','1214','1215','1220','1221','1222','1230','1234','1261','1301','1302','1305','1308','1309','1310','1311','1313','1314','1315','1316','1317','1318','1319','1320','1321']);
const stringCodes=new Set(['invalid_api_key','authentication_error','invalid_request_error','insufficient_balance','rate_limit_exceeded','server_error','insufficient_quota']);
function safeBusiness(value,secret){const s=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;return typeof s==='string'&&s.length<=40&&!s.includes(secret)&&(numericCodes.has(s)||stringCodes.has(s))?s:null;}
function errorCategory(status,code){
  if(status===401)return 'authentication_rejected';
  if(status===402||code==='1113'||code==='insufficient_balance')return 'billing_or_balance';
  if(status===403||code==='1220')return 'authorization_rejected';
  if(status===429)return ['1302','1305','rate_limit_exceeded'].includes(code)?'rate_or_capacity':'quota_plan_or_rate_limit';
  if(status===400||status===422)return code==='1301'?'content_rejected':'request_or_model_rejected';
  if(status===404)return 'endpoint_not_found';
  if(status>=500)return 'provider_failure';
  return 'http_rejected';
}
function safeUsage(value){
  if(!plain(value))return {};
  const out={};for(const key of ['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens','input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'])
    if(Number.isSafeInteger(value[key])&&value[key]>=0)out[key]=value[key];
  const reasoning=value.completion_tokens_details?.reasoning_tokens;
  if(Number.isSafeInteger(reasoning)&&reasoning>=0)out.reasoning_tokens=reasoning;
  return out;
}
class ProbeBodyError extends Error {
  constructor(category){super(category);this.category=category;}
}
async function boundedJSON(response,signal){
  // Local body-state/reader errors are not transport failures.
  if(response.bodyUsed||!response.body||response.body.locked)throw new ProbeBodyError('invalid_json_response');
  let reader;try{reader=response.body.getReader();}catch{throw new ProbeBodyError('invalid_json_response');}
  let bytes=0;const chunks=[];
  try{
    for(;;){
      if(signal.aborted)throw new ProbeBodyError('timeout_unknown');
      let pending;try{pending=reader.read();}catch{throw new ProbeBodyError('invalid_json_response');}
      let item;try{item=await pending;}catch{throw new ProbeBodyError(signal.aborted?'timeout_unknown':'network_error');}
      if(item.done)break;
      if(!(item.value instanceof Uint8Array))throw new ProbeBodyError('invalid_json_response');
      bytes+=item.value.byteLength;if(bytes>MAX_RESPONSE_BYTES)throw new ProbeBodyError('response_too_large');chunks.push(item.value);
    }
    // Only completed bytes reach the decoder/parser; their failures stay distinct from read I/O.
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
    catch{throw new ProbeBodyError('invalid_json_response');}
  }catch(error){try{await reader.cancel();}catch{/* never echo errors */}throw error;}
  finally{reader.releaseLock();}
}
export async function probeCapturedOnce({provider,reference,record:p,fetchImpl=globalThis.fetch,timeoutMs=TIMEOUT_MS}){
  const contract=matchesProviderPreset(provider,p??{})?{protocol:p.protocol,baseUrl:p.baseUrl,url:p.baseUrl+(p.protocol==='anthropic-messages'?'/v1/messages':'/chat/completions'),model:p.requestedModel}:null, started=performance.now();
  const result={provider:contract?provider:null,status:'preflight_failed',requestCount:0};
  if(!contract||!validRef(reference)||typeof fetchImpl!=='function')return {...result,errorCategory:'invalid_public_input'};
  const options=p?.requestOptions;
  if(!p||p.profileId!==reference.profileId||p.revision!==reference.revision||p.protocol!==contract.protocol||p.baseUrl!==contract.baseUrl||p.requestedModel!==contract.model||typeof p.secret!=='string'||!p.secret.trim()||!exact(options?.thinking,['type'])||options.thinking.type!=='enabled'||
    (p.protocol==='anthropic-messages'?(!exact(options,['thinking','output_config','max_tokens'])||!exact(options.output_config,['effort'])||options.output_config.effort!=='max'||options.max_tokens!==32768):(!exact(options,['thinking','reasoning_effort'])||options.reasoning_effort!=='max')))
    return {...result,errorCategory:'profile_contract_mismatch'};
  // The real store guarantees secrets are absent from all public fields.
  if(JSON.stringify(reference).includes(p.secret))return {...result,errorCategory:'unsafe_public_reference'};
  Object.assign(result,{reference:{...reference},url:contract.url,protocol:contract.protocol,requestedModel:contract.model,max_tokens:1024,stream:false});
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},timeoutMs);});
  async function request(){
    const body={...structuredClone(options),model:contract.model,messages:[{role:'user',content:'只回复 OK。'}],max_tokens:1024,stream:false};
    const headers=p.protocol==='anthropic-messages'?{'content-type':'application/json','x-api-key':p.secret}:{'content-type':'application/json',authorization:`Bearer ${p.secret}`};
    result.requestCount=1;
    const response=await fetchImpl(contract.url,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
    result.httpStatus=Number.isInteger(response.status)&&response.status>=100&&response.status<=599?response.status:null;
    let data;
    try{data=await boundedJSON(response,controller.signal);}catch(error){
      return {...result,status:'failed',errorCategory:controller.signal.aborted?'timeout_unknown':response.ok?(error instanceof ProbeBodyError?error.category:'invalid_json_response'):errorCategory(response.status,null)};
    }
    if(!response.ok){const code=safeBusiness(data?.error?.code,p.secret);return {...result,status:'failed',businessCode:code,errorCategory:errorCategory(response.status,code)};}
    const model=safeModel(data?.model,p.secret),usage=safeUsage(data?.usage);
    let valid=false,finalText=false,stop=null,truncated=false,normal=false;
    if(p.protocol==='anthropic-messages'){
      valid=plain(data)&&data.type==='message'&&data.role==='assistant'&&Array.isArray(data.content)&&model!==null&&data.content.every(block=>plain(block)&&((block.type==='text'&&typeof block.text==='string')||(block.type==='thinking'&&typeof block.thinking==='string')||(block.type==='redacted_thinking'&&typeof block.data==='string')));
      finalText=valid&&data.content.some(block=>block.type==='text'&&typeof block.text==='string'&&block.text.trim().length>0);
      stop=['end_turn','stop_sequence','max_tokens','tool_use','pause_turn','refusal'].includes(data?.stop_reason)?data.stop_reason:null;
      truncated=stop==='max_tokens';normal=['end_turn','stop_sequence'].includes(stop);
    }else{
      const choice=data?.choices?.[0];valid=plain(data)&&Array.isArray(data.choices)&&data.choices.length===1&&plain(choice)&&plain(choice.message)&&model!==null&&choice.message.role==='assistant'&&(choice.message.content===null||typeof choice.message.content==='string');
      finalText=valid&&typeof choice.message.content==='string'&&choice.message.content.trim().length>0;
      stop=['stop','length','content_filter','tool_calls','insufficient_system_resource'].includes(choice?.finish_reason)?choice.finish_reason:null;
      truncated=stop==='length';normal=stop==='stop';
    }
    valid=valid&&stop!==null;
    const complete=valid&&model!==null&&finalText&&normal;
    return {...result,status:complete?'completed':valid?'connected_incomplete':'failed',returnedModel:model,usage,stopReason:stop,textNonempty:!!finalText,complete,truncated,...(!valid?{errorCategory:'invalid_protocol_response'}:{})};
  }
  try{return {...await Promise.race([request(),timeout]),elapsedMs:Math.round(performance.now()-started)};}
  catch{return {...result,status:'failed',errorCategory:controller.signal.aborted?'timeout_unknown':'network_error',elapsedMs:Math.round(performance.now()-started)};}
  finally{clearTimeout(timer);controller.abort();}
}

