/** §44.4 explicit designed-source collection in the original TaskController.
 * This consumer does not admit sources, label decisions, execute target moves,
 * register families or authorize itself. Original H grants the fixed capability,
 * full source closure, public-gap prerequisite receipt and input-workload resource policy.
 * Complete source responses stay in owned private files, never TC status text. */
import {readFileSync,writeFileSync,lstatSync,realpathSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {createTaskController} from './task-control.mjs';
import {verifyDesignedFamilyReservationLink} from './designed-family-reservation';
import {canonical,digest,strictObject,fixedReference,validateTask,isInputWorkloadLimits} from './task-schema.mjs';
import {createMeteredRemote} from './match-consumer';
import {createProfileDesigner,prepareDesignedSourceRequest,queryDesignedSource,type DesignedSourceRequest,type DesignedRequestCheckpoint,type DesignedRemoteResult} from './designed-source-request';
import {DESIGNED_FIRST_GAME_V2_SCHEMA} from './designed-source';
import {PROJECT_RULES_DESIGN_PROMPT_ID,PROJECT_RULES_DESIGN_SYSTEM_SHA256} from '../../packages/web/server/llm-project-rules-v541.mjs';
import {freezeCopy} from '../../packages/ai/src/hybrid/protocol';

export const DESIGNED_SOURCE_CAPABILITY={id:'B07.designed-source.v1',kind:'collect',mode:'research'} as const;
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const scope=(apiCalls=false)=>({localExecution:true,apiCalls,parameterUpdates:false,deployment:false});
const need=(ok:unknown,why:string)=>{if(!ok)throw Error('designer_'+why);};
const hex=(x:any)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const integer=(x:any)=>Number.isSafeInteger(x)&&x>=0;
interface PrivateRef {relativePath:string;sha256:string}
interface PublicQuery {questionId:string;requestSHA256:string;phase:'requesting'|'terminal'|'unresolved';privateRef:PrivateRef}
interface Checkpoint {schema:'ohuo-designed-source-run-v1';binding:any;cursor:number;active:PublicQuery|null;rows:any[];executionUnknown:boolean}
interface Prepared {contract:any;familyReservation?:ReturnType<typeof verifyDesignedFamilyReservationLink>;requests:readonly DesignedSourceRequest[];reference:any;publicProfile:any;sourceIndexPath:string;sourceIndexSHA256:string;store?:any}
const binding=(task:any,p:Prepared)=>({taskSHA256:digest(task),sourceRevision:task.sourceRevision,runtimeRef:task.runtimeRef,contractRef:task.scientificContract.decisionRuleRef,inventoryRef:task.datasetRefs[0],configurationRef:p.contract.configurationRef,promptRef:task.promptRef,sourceIndexRef:task.sourcePlan.sourceIndexRef,profileRevisionRef:p.reference,requestOrder:p.requests.map(r=>({questionId:r.questionId,requestSHA256:digest(r)}))});
const validCandidate=(v:any)=>{strictObject(v,'candidateSourceFile',['relativePath','sha256']);return hex(v.sha256)&&v.relativePath===`designer-private/source-${v.sha256}.json`;};
const validPrivate=(v:any)=>{strictObject(v,'privateRef',['relativePath','sha256']);return hex(v.sha256)&&v.relativePath===`designer-private/query-${v.sha256}.json`;};
function validateCheckpoint(c:Checkpoint):boolean {
 try{
  strictObject(c,'designer.run',['schema','binding','cursor','active','rows','executionUnknown']);
  strictObject(c.binding,'designer.binding',['taskSHA256','sourceRevision','runtimeRef','contractRef','inventoryRef','configurationRef','promptRef','sourceIndexRef','profileRevisionRef','requestOrder']);
  if(c.schema!=='ohuo-designed-source-run-v1'||!hex(c.binding.taskSHA256)||!integer(c.cursor)||!Array.isArray(c.rows)||c.rows.length!==c.cursor||typeof c.executionUnknown!=='boolean'||!Array.isArray(c.binding.requestOrder)||c.cursor>c.binding.requestOrder.length)return false;
  for(const k of ['sourceRevision','runtimeRef','contractRef','inventoryRef','configurationRef','promptRef','sourceIndexRef'])fixedReference(c.binding[k],k);
  strictObject(c.binding.profileRevisionRef,'profileRef',['profileId','revision','snapshotHash']);
  if(typeof c.binding.profileRevisionRef.profileId!=='string'||!c.binding.profileRevisionRef.profileId||!integer(c.binding.profileRevisionRef.revision)||c.binding.profileRevisionRef.revision<1||!hex(c.binding.profileRevisionRef.snapshotHash))return false;
  const ids=new Set<string>();for(const row of c.binding.requestOrder){strictObject(row,'requestOrder',['questionId','requestSHA256']);if(typeof row.questionId!=='string'||!row.questionId||ids.has(row.questionId)||!hex(row.requestSHA256))return false;ids.add(row.questionId);}
  if(c.active!==null){strictObject(c.active,'active',['questionId','requestSHA256','phase','privateRef']);if(!equal({questionId:c.active.questionId,requestSHA256:c.active.requestSHA256},c.binding.requestOrder[c.cursor])||!['requesting','terminal','unresolved'].includes(c.active.phase)||!validPrivate(c.active.privateRef))return false;}
  for(const [i,row] of c.rows.entries()){
   strictObject(row,'designer.row',['questionId','requestSHA256','status','reason','requestCount','usage','privateRef','candidateSourceFile','sourceAccepted']);
   if(!equal({questionId:row.questionId,requestSHA256:row.requestSHA256},c.binding.requestOrder[i])||!['response','remote_failure','cancelled','execution_uncertain'].includes(row.status)||![0,1,null].includes(row.requestCount)||!validPrivate(row.privateRef)||row.sourceAccepted!==false||row.status==='response'&&(row.reason!==null||row.requestCount!==1)||row.status!=='response'&&typeof row.reason!=='string')return false;
   if(!row.usage||typeof row.usage!=='object'||Array.isArray(row.usage)||Object.values(row.usage).some(n=>!(typeof n==='number'&&Number.isFinite(n)&&n>=0)&&!(n&&typeof n==='object'&&!Array.isArray(n)&&Object.values(n).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))))return false;
   if((row.status==='execution_uncertain')!==(row.requestCount===null)||row.status==='response'&&!validCandidate(row.candidateSourceFile)||row.status!=='response'&&row.candidateSourceFile!==null)return false;
  }
  return true;
 }catch{return false;}
}
// Original H uses this same strict public checkpoint validator for prior runs.
export {validateCheckpoint as isDesignedSourceCheckpoint};
/** Pure fixed-input verification. It cannot supply original H authorization or
 * prove public-gap evidence authenticity. H resolves the listed prerequisite
 * against its accepted plan/authority before this consumer can be launched.
 * Task prerequisiteRefs remain requirement refs, not coverage approval documents. */
export function verifyDesignedSourceInputs({task:inputTask,refs,inputs}:any):Prepared {
 const task=validateTask(inputTask),catalog=inputs?.designerCatalog;
 need(refs instanceof Map&&catalog instanceof Map,'inputs_missing');
 const cache=new Map<string,any>();
 const read=(ref:string):any=>{fixedReference(ref,'designer.ref');if(cache.has(ref))return cache.get(ref);const values=[...(refs.has(ref)?[refs.get(ref)]:[]),...(catalog.has(ref)?[catalog.get(ref)]:[])];need(values.length&&values.every(v=>digest(v)===ref.split(':').at(-1)),'reference_identity');const value=freezeCopy(values[0]);cache.set(ref,value);return value;};
 const schema=(ref:string,name:string,keys:string[])=>{const v=read(ref);strictObject(v,name,['schema',...keys]);need(v.schema===name,'schema_identity');return v;};
 need(equal(read(task.capabilityRef),DESIGNED_SOURCE_CAPABILITY)&&task.taskKind==='collect'&&equal(task.operationScope,scope(true))&&task.sourcePlan.split==='train'&&task.datasetRefs.length===1&&task.allowedBranches.length===0,'scope');
 const contract=schema(task.scientificContract.decisionRuleRef,'ohuo-designed-source-contract-v1',['sourceIndexRef','requestInventoryRef','configurationRef','promptRef','rulesRef','sourceRevision','coverageApprovalRef']);
 for(const k of ['sourceIndexRef','requestInventoryRef','configurationRef','promptRef','rulesRef','sourceRevision','coverageApprovalRef'])read(contract[k]);
 need(contract.sourceIndexRef===task.sourcePlan.sourceIndexRef&&contract.requestInventoryRef===task.datasetRefs[0]&&contract.configurationRef===task.labelPolicyRef&&contract.promptRef===task.promptRef&&contract.rulesRef===task.rulesRef&&contract.sourceRevision===task.sourceRevision,'contract_binding');
 const inventory=schema(contract.requestInventoryRef,'ohuo-designed-source-inventory-v1',['requests']);need(Array.isArray(inventory.requests)&&inventory.requests.length>0,'inventory');
 const requests=inventory.requests.map((r:any)=>prepareDesignedSourceRequest(r));
 need(new Set(requests.map(r=>r.questionId)).size===requests.length&&requests.every(r=>r.engineSourceRef===task.sourceRevision&&r.rulesRef===task.rulesRef&&equal(r.ruleOptions,read(task.rulesRef))),'request_binding');
 need(isInputWorkloadLimits(task.limits)&&task.limits.maxProviderRequests===requests.length&&['maxOptimizerSteps','maxMatchAttempts','maxLabelDecisions'].every(k=>task.limits[k]===0),'input_workload');
 const families=[...new Set(requests.map(r=>r.designFamilyId))].sort();need(equal([...task.sourcePlan.familyIds].sort(),families),'family_scope');
 const approval=schema(contract.coverageApprovalRef,'ohuo-designed-public-coverage-approval-v1',['planRef','sourceIndexRef','rulesRef','coverageCells','evidenceRef']);read(approval.evidenceRef);
 need(approval.planRef===task.planRef&&approval.rulesRef===task.rulesRef&&Array.isArray(approval.coverageCells)&&approval.coverageCells.length>0,'coverage_approval');
 const familyReservation=approval.sourceIndexRef===contract.sourceIndexRef?null:verifyDesignedFamilyReservationLink({task,contract,repositoryRoot:inputs.designerRepositoryRoot,references:new Map([...catalog,...refs]),evidenceFiles:inputs.designerEvidenceFiles,sourceIndexPath:inputs.sourceIndexPath});
 const approved=new Set<string>();for(const coverage of approval.coverageCells){prepareDesignedSourceRequest({...inventory.requests[0],coverage});const key=digest(coverage);need(!approved.has(key),'duplicate_coverage');approved.add(key);}
 need(requests.every(r=>approved.has(digest(r.coverage))),'coverage_not_approved');
 const prompt=schema(task.promptRef,'ohuo-designed-source-prompt-v1',['promptId','systemPromptSHA256']);need(prompt.promptId===PROJECT_RULES_DESIGN_PROMPT_ID&&prompt.systemPromptSHA256===PROJECT_RULES_DESIGN_SYSTEM_SHA256,'prompt_identity');
 const config=schema(contract.configurationRef,'ohuo-designed-source-configuration-v1',['profileRevisionRef','publicProfileRef']),pub=read(config.publicProfileRef);
 strictObject(config.profileRevisionRef,'profileRevisionRef',['profileId','revision','snapshotHash']);strictObject(pub,'publicProfile',['profileId','nickname','protocol','baseUrl','requestedModel','supportedReasoningOptions','requestOptions','revision','snapshotHash']);
 const {snapshotHash,...publicFields}=pub;need(snapshotHash===digest(publicFields)&&equal(config.profileRevisionRef,{profileId:pub.profileId,revision:pub.revision,snapshotHash:pub.snapshotHash}),'profile_identity');
 strictObject(inputs.designerProfile,'designerProfile',['configurationRef','reference','publicProfile']);need(equal(inputs.designerProfile,{configurationRef:contract.configurationRef,reference:config.profileRevisionRef,publicProfile:pub}),'host_profile_binding');
 need(inputs.sourceIdentity===contract.sourceIndexRef&&typeof inputs.sourceIndexPath==='string'&&equal(inputs.confirmedRecordRoots,[])&&equal(inputs.studentReleasePaths,{})&&inputs.datasetDirectory===null&&inputs.seed===null,'host_input_binding');
 const source=schema(contract.sourceIndexRef,'ohuo-source-index-ref-v1',['namespace','fileSHA256']),path=inputs.sourceIndexPath,st=lstatSync(path);need(st.isFile()&&!st.isSymbolicLink()&&realpathSync(path)===path,'source_path');
 const bytes=readFileSync(path),index=JSON.parse(bytes.toString('utf8'));need(source.namespace===task.sourcePlan.namespace&&source.fileSHA256===sha(bytes)&&index.version===1&&index.families&&typeof index.families==='object','source_index_identity');
 // Only explicit registered design-family ancestry is admitted; missing design
 // roots cannot silently become new train roots. Original H owns full history.
 for(const id of families){const own=index.families[id];need(own?.split==='train'&&typeof own.rootFamilyId==='string'&&Array.isArray(own.parentFamilyIds),'design_family_ownership');const root=own.rootFamilyId,seen=new Set<string>(),walk=(at:string)=>{need(!seen.has(at),'family_cycle');seen.add(at);const row=index.families[at];need(row?.split==='train','family_split');if(at===root){need((row.rootFamilyId===undefined||row.rootFamilyId===root)&&(!row.parentFamilyIds||row.parentFamilyIds.length===0),'family_root');}else{need(row.rootFamilyId===root&&Array.isArray(row.parentFamilyIds)&&row.parentFamilyIds.length>0,'family_edge');for(const parent of row.parentFamilyIds)walk(parent);}seen.delete(at);};walk(id);}
 return {contract,...(familyReservation?{familyReservation}:{}),requests:freezeCopy(requests),reference:freezeCopy(config.profileRevisionRef),publicProfile:pub,sourceIndexPath:path,sourceIndexSHA256:source.fileSHA256};
}
function privateDirectory(task:any){const root=realpathSync(task.outputRoot);need(root===task.outputRoot,'output_root');const dir=join(root,'designer-private');if(!existsSync(dir))mkdirSync(dir,{mode:0o700});const st=lstatSync(dir);need(st.isDirectory()&&!st.isSymbolicLink()&&realpathSync(dir)===dir&&(st.mode&0o077)===0,'private_directory');return dir;}
function storePrivate(task:any,value:DesignedRequestCheckpoint):PrivateRef {const bytes=canonical(value),hash=sha(bytes),dir=privateDirectory(task),relativePath=`designer-private/query-${hash}.json`,path=join(dir,`query-${hash}.json`);if(existsSync(path)){readPrivate(task,{relativePath,sha256:hash});}else writeFileSync(path,bytes,{flag:'wx',mode:0o600});return {relativePath,sha256:hash};}
function readPrivate(task:any,ref:PrivateRef):DesignedRequestCheckpoint {need(validPrivate(ref),'private_reference');privateDirectory(task);const path=join(task.outputRoot,ref.relativePath),st=lstatSync(path);need(st.isFile()&&!st.isSymbolicLink()&&realpathSync(path)===path&&(st.mode&0o077)===0,'private_file');const bytes=readFileSync(path);need(sha(bytes)===ref.sha256,'private_identity');return JSON.parse(bytes.toString('utf8'));}
function storeCandidate(task:any,result:DesignedRemoteResult):PrivateRef {const bytes=result.response?.schema===DESIGNED_FIRST_GAME_V2_SCHEMA?result.privateResponseText:canonical(result.response);need(typeof bytes==='string','candidate_raw_response_required');const hash=sha(bytes!),dir=privateDirectory(task),ref={relativePath:`designer-private/source-${hash}.json`,sha256:hash},path=join(dir,`source-${hash}.json`);if(existsSync(path))readCandidate(task,ref);else writeFileSync(path,bytes!,{flag:'wx',mode:0o600});return ref;}
function readCandidate(task:any,ref:PrivateRef){need(validCandidate(ref),'candidate_file_reference');privateDirectory(task);const path=join(task.outputRoot,ref.relativePath),st=lstatSync(path);need(st.isFile()&&!st.isSymbolicLink()&&realpathSync(path)===path&&(st.mode&0o077)===0,'candidate_private_file');const bytes=readFileSync(path);need(sha(bytes)===ref.sha256,'candidate_file_identity');return bytes;}
export function createDesignedSourceConsumer({profileStore,fetchImpl}:{profileStore:any;fetchImpl?:typeof fetch}) {
 need(profileStore&&typeof profileStore.resolve==='function'&&(fetchImpl===undefined||typeof fetchImpl==='function'),'profile_store_required');
 const prepare=async(input:any):Promise<Prepared>=>{const p=verifyDesignedSourceInputs(input),reference=structuredClone(p.reference),record=structuredClone(profileStore.resolve(reference));const store={resolve:(r:any)=>{need(equal(r,reference),'profile_binding');return structuredClone(record);}};const publicProfile=createProfileDesigner({store,reference,fetchImpl:()=>{throw Error('prepare cannot send');}}).profile;need(equal(publicProfile,p.publicProfile),'resolved_profile_identity');return {...p,reference,store,publicProfile};};
 const run=async(ctx:any)=>{
  const {task,signal,executionInputs:p}=ctx as {task:any;signal:AbortSignal;executionInputs:Prepared};
  need(ctx.executionBoundary?.mode==='input-workload-only','original_resource_boundary_required');
  const expected=binding(task,p);let cp:Checkpoint=ctx.checkpoint?structuredClone(ctx.checkpoint):{schema:'ohuo-designed-source-run-v1',binding:expected,cursor:0,active:null,rows:[],executionUnknown:false};let sequence=ctx.checkpointSequence,apiInvoked=false;
  const meters:Array<{drain:()=>Promise<void>}>=[];
  const save=async()=>{need(validateCheckpoint(cp),'checkpoint_invalid');await ctx.saveCheckpoint(structuredClone(cp),sequence+1);sequence++;};
  const summary=()=>{const value={schema:'ohuo-designed-source-summary-v1',taskId:task.taskId,runId:task.runId,binding:cp.binding,requestCount:p.requests.length,cursor:cp.cursor,active:cp.active,rows:cp.rows,executionUnknown:cp.executionUnknown,consumption:ctx.getConsumption(),sourceAccepted:false,interpretation:'Structured designer output only. Original engine replay, source-index registration, train-root/used identity and teaching gates remain required.'};const bytes=canonical(value),path=join(task.outputRoot,`designer-summary-${sha(bytes)}.json`);if(existsSync(path))need(readFileSync(path,'utf8')===bytes,'summary_identity');else writeFileSync(path,bytes,{flag:'wx',mode:0o600});return {path,sha256:sha(bytes),purpose:'public designer request terminals; private source bytes are not included'};};
  try{
   need(validateCheckpoint(cp)&&equal(cp.binding,expected),'checkpoint_binding');
   if(cp.executionUnknown)throw Error('execution_uncertain: pending designer request cannot be repeated');
   for(const [i,row] of cp.rows.entries()){
    const q=readPrivate(task,row.privateRef);need(q.phase==='terminal','completed_query_phase');
    const reused=await queryDesignedSource({input:p.requests[i],signal,checkpoint:q,request:async()=>{throw Error('completed request cannot send');},onCheckpoint:async()=>{throw Error('completed request cannot rewrite');}}),r=reused.checkpoint.result!;
    need(r.status===row.status&&r.summary.requestCount===row.requestCount&&equal(r.summary.usage??{},row.usage),'completed_query_identity');
    if(row.candidateSourceFile){const raw=readCandidate(task,row.candidateSourceFile);need(equal(JSON.parse(raw.toString('utf8')),r.response),'candidate_source_identity');if(r.response?.schema===DESIGNED_FIRST_GAME_V2_SCHEMA)need(raw.equals(Buffer.from(r.privateResponseText!,'utf8')),'candidate_raw_response_identity');}
   }
   while(cp.cursor<p.requests.length){
    if(signal.aborted)break;need(sha(readFileSync(p.sourceIndexPath))===p.sourceIndexSHA256,'source_index_changed');
    const input=p.requests[cp.cursor];const prior=cp.active?readPrivate(task,cp.active.privateRef):null;
    if(prior)need(prior.phase===cp.active!.phase&&prior.questionId===cp.active!.questionId&&prior.requestSHA256===cp.active!.requestSHA256,'private_checkpoint_binding');
    const local=new AbortController(),abort=()=>local.abort(signal.reason??'user_stop');signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    const meter=createMeteredRemote({role:'designer',store:p.store,reference:p.reference,keyPrefix:`designer-${cp.cursor}-${ctx.executionId}`,ownerSignal:signal,onSent:()=>{apiInvoked=true;},cancel:(reason:string)=>local.abort(reason),reserve:ctx.reserve,settleReservation:ctx.settleReservation,fetchImpl:(url:any,init:any)=>{apiInvoked=true;return (fetchImpl??globalThis.fetch)(url,init);}});meters.push(meter);
    let result;
    try{result=await queryDesignedSource({request:meter.request,input,signal:local.signal,checkpoint:prior,onCheckpoint:async(q)=>{const privateRef=storePrivate(task,q);cp.active={questionId:q.questionId,requestSHA256:q.requestSHA256,phase:q.phase,privateRef};await save();}});await meter.drain();}
    finally{signal.removeEventListener('abort',abort);}
    const q=result.checkpoint,r=q.result;need(cp.active!==null,'checkpoint_missing');
    if(result.status==='execution_uncertain'){cp.executionUnknown=true;await save();break;}
    need(q.phase==='terminal'&&r&&r.summary.requestCount!==null,'terminal_missing');
    cp.rows.push({questionId:input.questionId,requestSHA256:digest(input),status:r!.status,reason:r!.status==='response'?null:r!.reason??'remote_failure',requestCount:r!.summary.requestCount,usage:r!.summary.usage??{},privateRef:cp.active.privateRef,candidateSourceFile:r!.status==='response'?storeCandidate(task,r!):null,sourceAccepted:false});cp.cursor++;cp.active=null;await save();
    // A known failure remains recorded, never retried in this inventory.
    if(local.signal.aborted)break;
   }
   return {completed:cp.cursor===p.requests.length&&!cp.executionUnknown,cleanupConfirmed:true,actualScope:scope(apiInvoked),stopReason:cp.executionUnknown?'execution_uncertain':signal.aborted?String(signal.reason??'user_stop'):'input_workload_complete',artifactRefs:[summary()]};
  }catch(error){
   await Promise.allSettled(meters.map(m=>m.drain()));
   // A persisted pending request is never reset on failure. The original TC
   // ledger/owner reconciliation decides recovery, not this consumer.
   if((error as any)?.requestCount===0&&(error as any)?.executionUnknown===false&&cp.active){
    // The request was never invoked. Preserve the known-zero terminal.
    const q:DesignedRequestCheckpoint={schema:'ohuo-designed-source-query-v1',questionId:cp.active.questionId,requestSHA256:cp.active.requestSHA256,phase:'terminal',result:{status:'remote_failure',reason:'checkpoint_write_failed',summary:{requestCount:0}}};
    try{cp.active={...cp.active,phase:'terminal',privateRef:storePrivate(task,q)};}catch{}
   }else if(cp.active?.phase==='requesting'||cp.active?.phase==='unresolved'||(error as any)?.executionUnknown)cp.executionUnknown=true;
   try{await save();}catch{}let artifactRefs:any[]=[];try{artifactRefs=[summary()];}catch{}
   Object.assign(error as object,{cleanupConfirmed:true,actualScope:scope(apiInvoked),artifactRefs});throw error;
  }
 };
 return {...DESIGNED_SOURCE_CAPABILITY,prepare,validateCheckpoint,run};
}
/** Uses the original controller and authority adapter; constructing it grants
 * no authority. Production CLI must register this exact named consumer. */
export function createDesignedSourceTaskHost({root,adapter,...options}:{root:string;adapter:any;profileStore:any;fetchImpl?:typeof fetch}) {return (createTaskController as any)({root,adapter,consumers:[createDesignedSourceConsumer(options)]});}
