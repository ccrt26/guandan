/** Same-origin foreground transport only. Never sends a key or reads legacy config. */
import type {RemoteRequest,RemoteRequestResult,RemoteRequestSummary} from '../../../ai/src/hybrid/remote-selector';
import type {ProfileRevisionRef} from '../../../ai/src/policy/seats';
import {freezeCopy} from '../../../ai/src/hybrid/protocol';
const safeErrors=new Set(['revision_conflict','profile_not_found','invalid_profile_reference','private_store_unavailable','private_store_requires_0600_regular_file','invalid_private_store','unsupported_protocol','profile_service_unavailable','input_too_large','local_same_origin_required','invalid_play_request','invalid_json','json_required']);
export function createRemotePlayRequest(input:ProfileRevisionRef,fetchImpl:typeof fetch=globalThis.fetch.bind(globalThis)):RemoteRequest {
 const reference=freezeCopy(input);
 return async(view,signal):Promise<RemoteRequestResult>=>{
  const start=performance.now();
  const summary:RemoteRequestSummary={...reference,credentialRevision:0,protocol:'unavailable',requestedModel:'unavailable',returnedModel:null,requestCount:0,elapsedMs:0,upstreamChunks:0,upstreamEvents:0,contentEvents:0,keepaliveEvents:0,firstUpstreamMs:null,firstContentMs:null,usage:{}};
  const failed=(reason:string,requestCount:0|null=null):RemoteRequestResult=>({status:signal.aborted?'cancelled':'remote_failure',reason:signal.aborted?'cancelled':reason,summary:{...summary,requestCount,elapsedMs:performance.now()-start}});
  if(signal.aborted)return failed('cancelled',0);
  try {
   const response=await fetchImpl('/api/llm-play',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference,view}),signal});
   const data=await response.json();
   if(signal.aborted)return failed('cancelled');
   if(!response.ok)return failed(safeErrors.has(data?.error)?data.error:'profile_service_unavailable',safeErrors.has(data?.error)?0:null);
   if(!data||!['response','remote_failure','cancelled'].includes(data.status)||!data.summary||data.summary.profileId!==reference.profileId||data.summary.revision!==reference.revision||data.summary.snapshotHash!==reference.snapshotHash||![0,1].includes(data.summary.requestCount))return failed('invalid_profile_response');
   return data as RemoteRequestResult;
  } catch {return failed('network_error');}
 };
}
