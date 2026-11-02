/** Explicit saved-profile tests. No startup I/O, retries, browser binding, or arbitrary endpoint input. */
import { ProfileError } from './llm-profiles.mjs';
import { matchesProviderPreset, explicitReceipt, persistExplicitReceipt, summarizeExplicitReceipt } from './llm-provider-state.mjs';
import { probeCapturedOnce } from './llm-connection-probe.mjs';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>plain(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const validRef=r=>exact(r,['profileId','revision','snapshotHash'])&&typeof r.profileId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(r.profileId)&&Number.isSafeInteger(r.revision)&&r.revision>0&&typeof r.snapshotHash==='string'&&/^[a-f0-9]{64}$/.test(r.snapshotHash);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export class ConnectionTestError extends Error {
  constructor(code,status){super(code);this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new ConnectionTestError(code,status);};
export function createConnectionTester({store,receiptPath,fetchImpl=globalThis.fetch,timeoutMs=60000}){
  // Exactly one in-flight and most recent completed attempt per provider, only in this process.
  const slots=new Map();
  function response(entry){
    let current;try{current=summarizeExplicitReceipt(entry.receipt,store.metadata());}
    catch{current={connection:{state:'unknown',reason:'receipt_unavailable',testedAt:entry.receipt.testedAt,scope:'native-connection-probe'},profileUnchanged:false};}
    return {...entry.command,...current,persisted:entry.persisted,...(!entry.persisted?{error:'receipt_persist_failed'}:{})};
  }
  return async function testProvider(input){
    if(!exact(input,['provider','reference','requestId'])||!['glm','deepseek'].includes(input.provider)||!validRef(input.reference)||!uuid(input.requestId))fail('invalid_test_request',400);
    const command={provider:input.provider,reference:{profileId:input.reference.profileId,revision:input.reference.revision,snapshotHash:input.reference.snapshotHash},requestId:input.requestId.toLowerCase()};
    const identity=JSON.stringify(command);
    // IDs cannot alias different bodies even across the two retained provider slots.
    for(const slot of slots.values())for(const entry of [slot.inFlight,slot.completed])if(entry?.command.requestId===command.requestId){
      if(entry.identity!==identity)fail('request_id_conflict',409);
      return entry.promise?await entry.promise:response(entry);
    }
    const slot=slots.get(command.provider)??{};
    if(slot.inFlight)fail('test_in_progress',409);
    let record;try{record=store.resolve(command.reference);}catch(error){
      if(error instanceof ProfileError&&['revision_conflict','profile_not_found'].includes(error.code))fail(error.code,error.code==='profile_not_found'?404:409);
      fail('profile_service_unavailable',503);
    }
    if(!matchesProviderPreset(command.provider,record))fail('profile_contract_mismatch',422);
    const entry={command,identity};slot.inFlight=entry;slots.set(command.provider,slot);
    entry.promise=(async()=>{
      const result=await probeCapturedOnce({provider:command.provider,reference:command.reference,record,fetchImpl,timeoutMs});
      entry.receipt=explicitReceipt({provider:command.provider,reference:command.reference,record,requestId:command.requestId,result,testedAt:new Date().toISOString()});
      try{persistExplicitReceipt({store,receiptPath,receipt:entry.receipt});entry.persisted=true;}catch{entry.persisted=false;}
      return response(entry);
    })();
    try{return await entry.promise;}
    finally{delete entry.promise;slot.inFlight=undefined;if(entry.receipt)slot.completed=entry;}
  };
}
