import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadScreenRevalidation,compareScreenRevalidationResults} from './screen-revalidation.mjs';
/** Fixed local command, never a task-supplied executable adapter. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FixedHostFiles} from './ohuo-host-files';
import {createTaskController} from './task-control.mjs';
import {validateTask,fixedReference,validateIdentifier,taskReferences,digest,fail} from './task-schema.mjs';
const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export async function runFixedHost(argv:string[]){
 try{
  if(['revalidate-screen','revalidation-status','revalidation-stop'].includes(argv[0])){if(argv.length!==3||argv[1]!=='--request')fail('invalid_cli','argv','exact revalidation action --request path@sha256 required');return await runScreenRevalidation(argv[0],argv[2]);}
  const [action,flag,value,...extra]=argv;if(extra.length||!value||!['init','start','status','stop','resume','qualify-calibration','finalize-student','freeze-first-round-budget','accept-designed-sources','prepare-designed-source-families'].includes(action)||flag!==(action==='init'?'--state':action==='start'?'--task':['qualify-calibration','finalize-student','freeze-first-round-budget','accept-designed-sources','prepare-designed-source-families'].includes(action)?'--request':'--run'))fail('invalid_cli','argv','exact fixed command/flag/value required');
  if(['init','start','qualify-calibration','finalize-student','freeze-first-round-budget','accept-designed-sources','prepare-designed-source-families'].includes(action))fixedReference(value,'reference');else validateIdentifier(value,'runId');
  const adapter=new FixedHostFiles(ROOT);
  if(action==='init')return await adapter.initialize(value);
  if(action==='prepare-designed-source-families'){const {prepareDesignedSourceFamilies}=await import('./designed-source-acceptance');return await prepareDesignedSourceFamilies({host:adapter,specRef:value});}
  if(action==='accept-designed-sources'){const {acceptDesignedSources}=await import('./designed-source-acceptance');return await acceptDesignedSources({host:adapter,specRef:value});}
  if(action==='freeze-first-round-budget')return await adapter.freezeFirstRoundBudget(value);
  if(action==='qualify-calibration')return await adapter.qualifyCalibration(value);
  if(action==='finalize-student'){const policy:any=await import('./distill-policy');if(typeof policy.finalizeStudentFromHost!=='function')fail('capability_planned','finalizeStudentFromHost','fixed reviewed finalization entry is absent');return await policy.finalizeStudentFromHost(value,adapter);}
  const state=adapter.checkExistingRoot();
  if(action==='status'||action==='stop')return await (createTaskController as any)({root:adapter.root}).dispatchOhuo(action,{runId:value});
  const task=action==='start'?validateTask(adapter.resolveRef(value)):validateTask(state.runs[value]?.task??fail('unknown_run','runId','original run not registered'));
  // Closed/missing authority is rejected before loading profile or model hosts.
  await adapter.checkAuthorization(task);
  const existing=state.runs[state.tasks[task.taskId]];
  if(existing&&existing.taskSHA256!==digest(task))fail('task_conflict','taskId','same ID has different fixed Task content');
  if(existing&&(action==='start'||['completed','preparing','running','stopping'].includes(existing.status))){
   // No new execution: preserve original idempotent status behavior without
   // treating a completed numerical role as a newly admitted role. Still use
   // the original durable closeout transaction; closed plans never reopen.
   const observationAdapter={productionPlanClosure:true,checkPlan:async()=>{const c=adapter.readCloseout();if(c.entity.planRef!==task.planRef||c.entity.planVersion!==task.planVersion)fail('plan_unverified','plan','current plan identity differs');return {status:c.entity.status,eligible:true,missing:[],hostObservation:c.observation};}};
   await (createTaskController as any)({root:adapter.root,adapter:observationAdapter}).assertCurrentPlan(task);
   return await (createTaskController as any)({root:adapter.root}).dispatchOhuo('status',{runId:existing.runId});
  }
  await (createTaskController as any)({root:adapter.root,adapter}).assertCurrentPlan(task);
  const capability=adapter.resolveRef(task.capabilityRef);let host:any;
  if(capability.id==='B04.api-probe.v1'||capability.id==='B07.complete-match.v1'||capability.id==='B07.offline-label.v1'||capability.id==='B07.designed-source.v1'){
   // Public source/coverage/configuration identity and shared ordinal checks must
   // finish before opening the same private B03 store. No private replay.
   if(capability.id==='B04.api-probe.v1'||capability.id==='B07.offline-label.v1'||capability.id==='B07.designed-source.v1'){const refs=new Map(taskReferences(task).map((ref:string)=>[ref,adapter.resolveRef(ref)]));await adapter.verifyInputs(task,refs);}
   const path=adapter.profilePath();let profileStore:any;
   if(path){const {createProfileStore}=await import('../../packages/web/server/llm-profiles.mjs');profileStore=createProfileStore({filePath:path});}
   if(capability.id==='B04.api-probe.v1'){if(!profileStore)fail('profile_not_configured','profileStorePath','explicit private store required');const {createApiProbeTaskHost}=await import('./api-probe-consumer');host=createApiProbeTaskHost({root:adapter.root,adapter,profileStore});}
   else if(capability.id==='B07.complete-match.v1'){const {createMatchTaskHost}=await import('./match-consumer');host=createMatchTaskHost({root:adapter.root,adapter,policyRepositoryRoot:ROOT,profileStore});}
   else if(capability.id==='B07.designed-source.v1'){if(!profileStore)fail('profile_not_configured','profileStorePath','explicit private store required');const {createDesignedSourceTaskHost}=await import('./designed-source-consumer');host=createDesignedSourceTaskHost({root:adapter.root,adapter,profileStore});}
   else{if(!profileStore)fail('profile_not_configured','profileStorePath','explicit private store required');const {createOfflineLabelTaskHost}=await import('./offline-label-consumer');host=createOfflineLabelTaskHost({root:adapter.root,adapter,profileStore,mode:'research'});}
  }else if(capability.id==='B10.supervised-rerank.v1'){
   if(!adapter.manifest.pythonPath)fail('runtime_not_configured','pythonPath','explicit approved interpreter required');const {createDistillTaskHost}=await import('./distill-consumer');host=createDistillTaskHost({root:adapter.root,adapter,pythonPath:adapter.manifest.pythonPath,policyRepositoryRoot:ROOT,mode:'research'});
  }else fail('capability_planned','capabilityRef','only fixed reviewed production consumers are installed');
  return await host.dispatchOhuo(action,action==='start'?{taskRef:value}:{runId:value});
 }catch(e){const error=e as any;return{status:'rejected',reason:error.reason??'fixed_host_error',field:error.field??null,detail:error.message};}
}
/** Reuses the original H/TC/consumer path; engineering storage is explicit. */
async function runScreenRevalidation(action:string,requestReference:string){
 const started=performance.now(),startedAt=new Date().toISOString(),observing=action!=='revalidate-screen',context:any=loadScreenRevalidation(ROOT,requestReference,{initialize:!observing,observationOnly:observing});
 if(observing)return await (createTaskController as any)({root:context.canonicalRoot,screenRevalidation:context}).dispatchOhuo(action==='revalidation-stop'?'stop':'status',{runId:context.task.runId});
 const adapter=new FixedHostFiles(ROOT,context),task=context.task,state=adapter.checkExistingRoot();
 await adapter.checkAuthorization(task);
 if(state.runs[state.tasks[task.taskId]]){
  const path=join(context.storageRoot,'verification-result.json');
  if(existsSync(path)){const prior=JSON.parse(readFileSync(path,'utf8'));if(prior.requestSHA256!==context.requestSHA256)fail('revalidation_result_conflict','result','saved verification belongs to another request');return {...prior,reusedExisting:true};}
  return {status:'verification_not_recorded',engineeringOnly:true,reusedExisting:true,runStatus:state.runs[state.tasks[task.taskId]].status,detail:'Existing execution retained; no new branches started. Saved comparison verdict is absent.',storageRoot:context.storageRoot};
 }
 await (createTaskController as any)({root:adapter.root,adapter,screenRevalidation:context}).assertCurrentPlan(task);
 const capability=adapter.resolveRef(task.capabilityRef);if(capability.id!=='B07.offline-label.v1')fail('revalidation_scope','capability','only original offline screen consumer allowed');
 const refs=new Map(taskReferences(task).map((ref:string)=>[ref,adapter.resolveRef(ref)])),verifyStarted=performance.now();await adapter.verifyInputs(task,refs);context.recordTiming('host.verifyInputs',verifyStarted);
 // Preserve original lazy profile-store startup, without asking it for a
 // credential or constructing any request. screenOnly rejects teacher prepare.
 const profilePath=adapter.profilePath();if(!profilePath)fail('profile_not_configured','profileStorePath','original configured store required');
 const {createProfileStore}=await import('../../packages/web/server/llm-profiles.mjs'),profileStore=createProfileStore({filePath:profilePath});
 const {createOfflineLabelTaskHost}=await import('./offline-label-consumer');
 const host:any=createOfflineLabelTaskHost({root:adapter.root,adapter,screenRevalidation:context,profileStore,screenOnly:true,mode:'research'});
 const stop=()=>{void host.dispatchOhuo('stop',{runId:task.runId});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let terminal:any;
 try{const initial=await host.dispatchOhuo('start',{taskRef:context.taskRef});if(initial.status==='rejected')return initial;terminal=await host.waitForRun(task.runId);}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
 let comparison:any=null,comparisonError:string|null=null;
 if(terminal.status==='completed'){try{const summary=JSON.parse(readFileSync(join(context.outputRoot,'first-round-screen-summary.json'),'utf8'));comparison=compareScreenRevalidationResults(context.baseline,summary);}catch(e){comparisonError=String(e);}}
 const consumed=terminal.consumption?.confirmed,zeroExternal=!!consumed&&consumed.providerRequests===0&&consumed.labelDecisions===0&&consumed.optimizerSteps===0,completeAccounting=consumed?.matchAttempts===24&&['reserved','reservedUnknown'].every(kind=>Object.values(terminal.consumption?.[kind]??{unknown:1}).every(v=>v===0));
 let originalAuthorityUnchanged=true,preservationError:string|null=null;try{context.assertLive();}catch(e){originalAuthorityUnchanged=false;preservationError=String(e);}
 const status=terminal.status==='completed'&&comparison?.equal&&zeroExternal&&completeAccounting&&terminal.cleanupConfirmed===true&&originalAuthorityUnchanged?'completed':'verification_failed';
 const result={schema:'ohuo-screen-revalidation-result-v1',purpose:'engineering-only-no-scientific-reuse',requestSHA256:context.requestSHA256,historicalTaskSHA256:context.taskSHA256,historicalSourceRevision:task.sourceRevision,actualExecutionSourceRef:context.sourceRef,storageRoot:context.storageRoot,startedAt,endedAt:new Date().toISOString(),internalWallSeconds:(performance.now()-started)/1000,outerCommandWall:'record by the invoking shell; includes module startup',timings:context.timings,status,runStatus:terminal.status,comparison,comparisonError,zeroExternal,completeAccounting,consumption:terminal.consumption,cleanupConfirmed:terminal.cleanupConfirmed,originalAuthorityUnchanged,preservationError,eligibleForScientificReuse:false,sourceIndexLock:'original temporary writer lock retained; original source bytes unchanged'};
 writeFileSync(join(context.storageRoot,'verification-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const result=await runFixedHost(process.argv.slice(2));console.log(JSON.stringify(result));if(['rejected','verification_failed','verification_not_recorded'].includes(result.status))process.exitCode=2;}
