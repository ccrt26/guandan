/** Same-origin foreground transport only. Never sends a key or reads legacy config. */
import {isRemoteRequestSummary,type RemoteRequest,type RemoteRequestResult,type RemoteRequestSummary} from '../../../ai/src/hybrid/remote-selector';
import type {ProfileRevisionRef} from '../../../ai/src/policy/seats';
import {freezeCopy} from '../../../ai/src/hybrid/protocol';
const safeErrors=new Set(['revision_conflict','profile_not_found','invalid_profile_reference','private_store_unavailable','private_store_requires_0600_regular_file','invalid_private_store','unsupported_protocol','profile_service_unavailable','input_too_large','local_same_origin_required','invalid_play_request','invalid_json','json_required']);
export function createRemotePlayRequest(input:ProfileRevisionRef,fetchImpl:typeof fetch=globalThis.fetch.bind(globalThis)):RemoteRequest {
 const reference=freezeCopy(input);
 return async(view,signal):Promise<RemoteRequestResult>=>{
  const start=performance.now();
  const summary:RemoteRequestSummary={...reference,credentialRevision:0,protocol:'unavailable',requestedModel:'unavailable',returnedModel:null,requestCount:0,elapsedMs:0,upstreamChunks:0,upstreamEvents:0,contentEvents:0,keepaliveEvents:0,firstUpstreamMs:null,firstContentMs:null,usage:{}};
  const failed=(reason:string,requestCount:0|null=null):RemoteRequestResult=>({status:signal?.aborted?'cancelled':'remote_failure',reason:signal?.aborted?'cancelled':reason,summary:{...summary,requestCount,elapsedMs:performance.now()-start}});
  if(signal?.aborted)return failed('cancelled',0);
  let options:RequestInit;
  try {
   if(typeof fetchImpl!=='function'||!signal||typeof signal.addEventListener!=='function')return failed('invalid_signal',0);
   options={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference,view}),signal};
   // Validate native parameters before entering the actual I/O catch; forward original values unchanged.
   const validationURL=new URL('/api/llm-play',globalThis.location?.href??'http://localhost');
   new Headers(options.headers);new Request(validationURL,options);
  }catch{return failed('invalid_play_request',0);}
  let pending:Promise<Response>;
  try {pending=fetchImpl('/api/llm-play',options);}catch{return failed('request_internal_error');}
  let response:Response;
  try {response=await pending;}catch{return failed('transport_failed');}
  if(signal.aborted)return failed('cancelled');
  if(!response||typeof response.ok!=='boolean'||!Number.isSafeInteger(response.status)||response.status<100||response.status>599||typeof response.text!=='function')return failed('invalid_profile_response');
  if(response.bodyUsed||response.body?.locked)return failed('invalid_profile_response');
  let reading:Promise<string>;
  try {reading=response.text();}catch{return failed('invalid_profile_response');}
  let text:string;
  try {text=await reading;}catch{return failed('transport_failed');}
  if(signal.aborted)return failed('cancelled');
  let data:unknown;
  try {data=JSON.parse(text);}catch{return failed('invalid_profile_response');}
  if(!data||typeof data!=='object'||Array.isArray(data))return failed('invalid_profile_response');
  const envelope=data as Record<string,unknown>;
  if(!response.ok)return failed(safeErrors.has(String(envelope.error))?String(envelope.error):'profile_service_unavailable',safeErrors.has(String(envelope.error))?0:null);
  if(typeof envelope.status!=='string'||!['response','remote_failure','cancelled'].includes(envelope.status)||!isRemoteRequestSummary(envelope.summary)||envelope.summary.profileId!==reference.profileId||envelope.summary.revision!==reference.revision||envelope.summary.snapshotHash!==reference.snapshotHash||Object.keys(envelope).some(k=>!['status','response','reason','summary'].includes(k)))return failed('invalid_profile_response');
  if(envelope.status!=='response'&&typeof envelope.reason!=='string')return failed('invalid_profile_response');
  return data as RemoteRequestResult;
 };
}
