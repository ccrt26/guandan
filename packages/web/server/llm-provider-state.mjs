/** Shared provider catalog and safe receipts. No fetch, environment import, or browser binding. */
import { lstatSync, readFileSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProfileStore, DEFAULT_PROFILE_PATH } from './llm-profiles.mjs';
export const DEFAULT_RECEIPT_PATH=fileURLToPath(new URL('../../../.env.llm-connection-receipts.json',import.meta.url));
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>plain(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const set=(v,values)=>Array.isArray(v)&&v.length===values.length&&new Set(v).size===values.length&&values.every(x=>v.includes(x));
const equal=(a,b)=>a?.profileId===b?.profileId&&a?.revision===b?.revision&&a?.snapshotHash===b?.snapshotHash;
const reference=p=>({profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const validRef=r=>exact(r,['profileId','revision','snapshotHash'])&&typeof r.profileId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(r.profileId)&&Number.isSafeInteger(r.revision)&&r.revision>0&&typeof r.snapshotHash==='string'&&/^[a-f0-9]{64}$/.test(r.snapshotHash);
const validTime=t=>typeof t==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(t)&&Number.isFinite(Date.parse(t));
const safeModel=m=>typeof m==='string'&&m.length>0&&m.length<=200&&/^[A-Za-z0-9_.:/\[\]-]+$/.test(m);
const receiptKeys=['provider','originalReference','protocol','url','requestedModel','returnedModel','testedAt','originalResult','httpStatus','complete','truncated','textNonempty','stopReason','receiptSHA256','testedCredentialRevision'];
export const CONNECTION_ERROR_CATEGORIES=Object.freeze(['authentication_rejected','billing_or_balance','authorization_rejected','rate_or_capacity','quota_plan_or_rate_limit','content_rejected','request_or_model_rejected','endpoint_not_found','provider_failure','http_rejected','response_too_large','invalid_json_response','invalid_protocol_response','timeout_unknown','network_error']);
const validUUID=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const fail=code=>{throw Error(code);};
const nativeContract=provider=>provider==='glm'?{protocol:'anthropic-messages',baseUrl:'https://open.bigmodel.cn/api/anthropic',url:'https://open.bigmodel.cn/api/anthropic/v1/messages',model:'glm-5.3'}:
  provider==='deepseek'?{protocol:'openai-chat-completions',baseUrl:'https://api.deepseek.com',url:'https://api.deepseek.com/chat/completions',model:'deepseek-flash'}:null;
const isProviderSource=(provider,p)=>provider==='glm'?['https://open.bigmodel.cn/api/anthropic','https://open.bigmodel.cn/api/paas/v4'].includes(p.baseUrl):p.baseUrl==='https://api.deepseek.com';
function validReceipt(r){
  if(r?.source==='explicit-user-test')return validExplicitReceipt(r);
  const c=nativeContract(r?.provider);
  if(!c||!exact(r,receiptKeys)||!validRef(r.originalReference)||r.protocol!==c.protocol||r.url!==c.url||r.requestedModel!==c.model||
    !(r.returnedModel===null||safeModel(r.returnedModel))||!validTime(r.testedAt)||!['completed','failed','connected_incomplete'].includes(r.originalResult)||
    !(r.httpStatus===null||(Number.isInteger(r.httpStatus)&&r.httpStatus>=100&&r.httpStatus<=599))||
    !['complete','truncated','textNonempty'].every(k=>typeof r[k]==='boolean')||
    !(r.stopReason===null||['end_turn','stop_sequence','max_tokens','tool_use','pause_turn','refusal','stop','length','content_filter','tool_calls','insufficient_system_resource'].includes(r.stopReason))||
    typeof r.receiptSHA256!=='string'||!/^[a-f0-9]{64}$/.test(r.receiptSHA256)||!(r.testedCredentialRevision===1||r.testedCredentialRevision===null))return false;
  // A 200 response alone is never a successful connection diagnostic.
  if(r.originalResult==='completed'&&!(r.httpStatus>=200&&r.httpStatus<300&&r.complete&&!r.truncated&&r.textNonempty&&r.returnedModel===c.model&&
    (r.provider==='glm'?['end_turn','stop_sequence'].includes(r.stopReason):r.stopReason==='stop')))return false;
  if(r.originalResult!=='completed'&&r.complete)return false;
  return true;
}
function validExplicitReceipt(r){
  if(!exact(r,[...receiptKeys,'source','requestId','baseUrl','errorCategory'])||!['glm','deepseek'].includes(r.provider)||
    !validUUID(r.requestId)||!validRef(r.originalReference)||!providerRoute(r.provider,r)||
    r.requestedModel!==(r.provider==='glm'?'glm-5.3':'deepseek-flash')||
    r.url!==r.baseUrl+(r.protocol==='anthropic-messages'?'/v1/messages':'/chat/completions')||
    !(r.returnedModel===null||safeModel(r.returnedModel))||!validTime(r.testedAt)||
    !Number.isSafeInteger(r.testedCredentialRevision)||r.testedCredentialRevision<1||
    !(r.errorCategory===null||CONNECTION_ERROR_CATEGORIES.includes(r.errorCategory))||
    !['completed','failed','connected_incomplete'].includes(r.originalResult)||
    !(r.httpStatus===null||(Number.isInteger(r.httpStatus)&&r.httpStatus>=100&&r.httpStatus<=599))||
    !['complete','truncated','textNonempty'].every(k=>typeof r[k]==='boolean')||
    !(r.stopReason===null||(r.protocol==='anthropic-messages'?['end_turn','stop_sequence','max_tokens','tool_use','pause_turn','refusal']:['stop','length','content_filter','tool_calls','insufficient_system_resource']).includes(r.stopReason)))return false;
  const {receiptSHA256,...evidence}=r;
  if(typeof receiptSHA256!=='string'||receiptSHA256!==hash(JSON.stringify(evidence)))return false;
  if(r.originalResult==='completed')return r.httpStatus>=200&&r.httpStatus<300&&r.complete&&!r.truncated&&r.textNonempty&&safeModel(r.returnedModel)&&r.errorCategory===null&&
    (r.protocol==='anthropic-messages'?['end_turn','stop_sequence'].includes(r.stopReason):r.stopReason==='stop');
  if(r.complete)return false;
  if(r.originalResult==='connected_incomplete')return r.httpStatus>=200&&r.httpStatus<300&&safeModel(r.returnedModel)&&r.stopReason!==null&&r.errorCategory===null;
  return CONNECTION_ERROR_CATEGORIES.includes(r.errorCategory);
}
function readReceipts(file){
  let stat;try{stat=lstatSync(file);}catch(error){return {status:error.code==='ENOENT'?'missing':'invalid',receipts:[]};}
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||stat.size>128*1024)return {status:'invalid',receipts:[]};
  try{
    const data=JSON.parse(readFileSync(file,'utf8'));
    if(!exact(data,['schema','receipts'])||data.schema!=='ohuo-connection-receipts-v1'||!Array.isArray(data.receipts)||data.receipts.length>100||
      !data.receipts.every(validReceipt)||new Set(data.receipts.map(r=>r.receiptSHA256)).size!==data.receipts.length)return {status:'invalid',receipts:[]};
    return {status:'ready',receipts:data.receipts};
  }catch{return {status:'invalid',receipts:[]};}
}
function summary(provider,row,receiptState){
  if(receiptState.status==='invalid')return {state:'unknown',reason:'receipt_unavailable'};
  const candidates=receiptState.receipts.filter(r=>r.provider===provider&&r.originalReference.profileId===row.profile.profileId);
  if(!candidates.length)return {state:'untested',reason:'no_receipt'};
  const r=candidates.find(r=>r.source==='explicit-user-test')??[...candidates].sort((a,b)=>Date.parse(b.testedAt)-Date.parse(a.testedAt))[0],c=r.source==='explicit-user-test'?r:nativeContract(provider),p=row.profile;
  const details={testedAt:r.testedAt,scope:'native-connection-probe',...(r.httpStatus!==null?{httpStatus:r.httpStatus}:{}),...(r.returnedModel!==null?{returnedModel:r.returnedModel}:{}),...(r.errorCategory?{errorCategory:r.errorCategory}:{})};
  if(r.testedCredentialRevision===null)return {state:'stale',...details,reason:'historical_credential_unknown'};
  if(!equal(p,r.originalReference)||p.protocol!==r.protocol||p.baseUrl!==c.baseUrl||p.requestedModel!==r.requestedModel||row.credentialRevision!==r.testedCredentialRevision)
    return {state:'stale',...details,reason:'credential_or_profile_changed'};
  return {state:r.originalResult==='completed'?'passed':r.originalResult==='failed'?'failed':'incomplete',...details};
}
export function providerRoute(provider,p){
  return provider==='glm'?(p.baseUrl==='https://open.bigmodel.cn/api/anthropic'&&p.protocol==='anthropic-messages')||
    (p.baseUrl==='https://open.bigmodel.cn/api/paas/v4'&&p.protocol==='openai-chat-completions'):
    provider==='deepseek'&&p.baseUrl==='https://api.deepseek.com'&&p.protocol==='openai-chat-completions';
}
export function matchesProviderPreset(provider,p){
  if(!providerRoute(provider,p)||p.requestedModel!==(provider==='glm'?'glm-5.3':'deepseek-flash'))return false;
  const s=p.supportedReasoningOptions,o=p.requestOptions,anthropic=p.protocol==='anthropic-messages';
  const effort=anthropic?'output_config_effort':'reasoning_effort';
  return exact(s,['thinking',effort])&&set(s.thinking,['enabled'])&&set(s[effort],['low','high','max'])&&
    exact(o,anthropic?['thinking','output_config','max_tokens']:['thinking','reasoning_effort'])&&exact(o.thinking,['type'])&&o.thinking.type==='enabled'&&
    (anthropic?exact(o.output_config,['effort'])&&o.output_config.effort==='max'&&o.max_tokens===32768:o.reasoning_effort==='max');
}
export function buildProviderState({store,receiptPath=DEFAULT_RECEIPT_PATH}){
  const rows=store.metadata(),profiles=rows.map(row=>row.profile),providers={},receipts=readReceipts(receiptPath);
  for(const provider of ['glm','deepseek']){
    const related=rows.filter(row=>isProviderSource(provider,row.profile));
    const candidates=related.filter(row=>matchesProviderPreset(provider,row.profile));
    // A verified original profile id can retain stale history after its route/model/options change.
    // It never supplies a playable reference or resolves ambiguity among current candidates.
    const historicalIds=new Set(receipts.receipts.filter(r=>r.provider===provider).map(r=>r.originalReference.profileId));
    const historicalRows=rows.filter(row=>historicalIds.has(row.profile.profileId));
    const availability=candidates.length===1?'ready':candidates.length>1?'ambiguous':related.length||historicalRows.length?'incompatible':'missing';
    let connection={state:'unknown',reason:'provider_not_ready'};
    if(availability==='ready')connection=summary(provider,candidates[0],receipts);
    else if(availability==='incompatible'&&historicalRows.length===1){
      const history=summary(provider,historicalRows[0],receipts);
      if(history.testedAt)connection={...history,state:'stale',reason:history.reason??'credential_or_profile_changed'};
    }
    providers[provider]={availability,reference:availability==='ready'?reference(candidates[0].profile):null,connection};
  }
  return {schema:'ohuo-provider-state-v1',profiles,providers};
}

function legacyReceipt(source,rows){
  let bytes;
  try{const stat=lstatSync(source.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)fail('receipt_source_invalid');bytes=readFileSync(source.path);}
  catch{fail('receipt_source_invalid');}
  if(typeof source.sha256!=='string'||hash(bytes)!==source.sha256)fail('receipt_source_mismatch');
  let wrapper,data;try{wrapper=JSON.parse(bytes);data=JSON.parse(wrapper.stdout);}catch{fail('receipt_source_invalid');}
  const c=nativeContract(source.provider),testedAt=typeof wrapper.endedAt==='string'?wrapper.endedAt.replace(/\+00:00$/,'Z'):null;
  if(!c||!plain(wrapper)||wrapper.exitCode!==0||wrapper.stderr!==''||!plain(data)||data.provider!==source.provider||data.requestCount!==1||data.max_tokens!==1024||data.stream!==false||
    !validTime(testedAt)||!Number.isFinite(Date.parse(wrapper.intentAt))||Date.parse(wrapper.intentAt)>Date.parse(testedAt)||
    data.protocol!==c.protocol||data.url!==c.url||data.requestedModel!==c.model||!validRef(data.reference))fail('receipt_source_invalid');
  const current=rows.find(row=>equal(row.profile,data.reference)),p=current?.profile;
  const testedCredentialRevision=current?.credentialRevision===1&&p.protocol===c.protocol&&p.baseUrl===c.baseUrl&&p.requestedModel===c.model?1:null;
  const receipt={provider:source.provider,originalReference:{...data.reference},protocol:c.protocol,url:c.url,requestedModel:c.model,
    returnedModel:data.returnedModel??null,testedAt,originalResult:data.status,httpStatus:data.httpStatus??null,
    complete:data.complete??false,truncated:data.truncated??false,textNonempty:data.textNonempty??false,stopReason:data.stopReason??null,
    receiptSHA256:source.sha256,testedCredentialRevision};
  if(!validReceipt(receipt))fail('receipt_source_invalid');
  return receipt;
}
/** Local controlled import only; no public HTTP writer, provider call, or credential update. */
export function importLegacyReceipts({profilePath=DEFAULT_PROFILE_PATH,receiptPath=DEFAULT_RECEIPT_PATH,sources}){
  if(!Array.isArray(sources)||!sources.length||sources.length>2||new Set(sources.map(s=>s.provider)).size!==sources.length)fail('receipt_source_invalid');
  const privateFile=resolve(profilePath),receiptFile=resolve(receiptPath);
  if(privateFile===receiptFile)fail('receipt_store_unavailable');
  const lock=`${privateFile}.lock`;let fd,temp;
  try{fd=openSync(lock,'wx',0o600);}catch(error){fail(error.code==='EEXIST'?'profile_store_busy':'receipt_store_unavailable');}
  try{
    const rows=createProfileStore({filePath:privateFile}).metadata(),prior=readReceipts(receiptFile);
    if(prior.status==='invalid')fail('receipt_store_unavailable');
    const incoming=sources.map(source=>legacyReceipt(source,rows)),next=[...prior.receipts];let imported=0;
    for(const r of incoming){
      const old=next.find(item=>item.receiptSHA256===r.receiptSHA256);
      if(old){const {testedCredentialRevision:oldVersion,...oldEvidence}=old,{testedCredentialRevision:newVersion,...newEvidence}=r;
        if(JSON.stringify(oldEvidence)!==JSON.stringify(newEvidence))fail('receipt_conflict');
        continue; // Preserve original 1/null binding; reimport never upgrades historical evidence.
      }
      if(next.some(item=>item.provider===r.provider&&item.originalReference.profileId===r.originalReference.profileId&&item.testedAt===r.testedAt))fail('receipt_conflict');
      next.push(r);imported++;
    }
    if(next.length>100)fail('receipt_store_unavailable');
    if(imported){
      temp=join(dirname(receiptFile),`.env.llm-connection-receipts-${randomUUID()}.tmp`);
      const out=openSync(temp,'wx',0o600);
      try{writeFileSync(out,JSON.stringify({schema:'ohuo-connection-receipts-v1',receipts:next},null,2)+'\n');fsyncSync(out);}finally{closeSync(out);}
      renameSync(temp,receiptFile);temp=undefined;
    }
    return {status:'completed',imported,unchanged:incoming.length-imported,providerRequests:0};
  }catch(error){
    if(['receipt_source_invalid','receipt_source_mismatch','receipt_store_unavailable','receipt_conflict'].includes(error?.message))throw error;
    fail('receipt_store_unavailable');
  }finally{
    if(temp)try{unlinkSync(temp);}catch{/* Retain no private content in errors. */}
    closeSync(fd);unlinkSync(lock);
  }
}

/** Construct only allowlisted evidence. Private key, raw content/headers and private version never leave the server. */
export function explicitReceipt({provider,reference,record,requestId,result,testedAt}){
  const evidence={provider,originalReference:{...reference},protocol:record.protocol,url:record.baseUrl+(record.protocol==='anthropic-messages'?'/v1/messages':'/chat/completions'),requestedModel:record.requestedModel,
    returnedModel:result.returnedModel??null,testedAt,originalResult:result.status,httpStatus:result.httpStatus??null,
    complete:result.complete??false,truncated:result.truncated??false,textNonempty:result.textNonempty??false,stopReason:result.stopReason??null,
    testedCredentialRevision:record.credentialRevision,source:'explicit-user-test',requestId,baseUrl:record.baseUrl,errorCategory:result.errorCategory??null};
  const receipt={...evidence,receiptSHA256:hash(JSON.stringify(evidence))};
  if(!validExplicitReceipt(receipt))fail('invalid_test_result');
  return receipt;
}
export function summarizeExplicitReceipt(receipt,rows){
  const row=rows.find(row=>row.profile.profileId===receipt.originalReference.profileId);
  if(!row)return {connection:{state:'stale',testedAt:receipt.testedAt,scope:'native-connection-probe',reason:'credential_or_profile_changed'},profileUnchanged:false};
  const connection=summary(receipt.provider,row,{status:'ready',receipts:[receipt]});
  return {connection,profileUnchanged:equal(row.profile,receipt.originalReference)&&row.credentialRevision===receipt.testedCredentialRevision};
}
/** Called only after an explicit POST's one network request finishes. Save and receipt writes share this lock. */
export function persistExplicitReceipt({store,receiptPath=DEFAULT_RECEIPT_PATH,receipt}){
  if(!validExplicitReceipt(receipt))fail('invalid_test_result');
  return store.withLock(rows=>{
    const prior=readReceipts(receiptPath);if(prior.status==='invalid')fail('receipt_store_unavailable');
    const old=prior.receipts.find(r=>r.source==='explicit-user-test'&&r.requestId===receipt.requestId);
    if(old&&JSON.stringify(old)!==JSON.stringify(receipt))fail('receipt_conflict');
    const next=prior.receipts.filter(r=>!(r.source==='explicit-user-test'&&r.originalReference.profileId===receipt.originalReference.profileId));
    next.push(receipt);if(next.length>100)fail('receipt_store_unavailable');
    let temp;
    try{
      temp=join(dirname(receiptPath),`.env.llm-connection-receipts-${randomUUID()}.tmp`);
      const fd=openSync(temp,'wx',0o600);
      try{writeFileSync(fd,JSON.stringify({schema:'ohuo-connection-receipts-v1',receipts:next},null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
      renameSync(temp,receiptPath);temp=undefined;
      return summarizeExplicitReceipt(receipt,rows);
    }finally{if(temp)try{unlinkSync(temp);}catch{/* Safe errors only. */}}
  });
}
