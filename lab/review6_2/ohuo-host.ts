/** Fixed local command, never a task-supplied executable adapter. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FixedHostFiles} from './ohuo-host-files';
import {createTaskController} from './task-control.mjs';
import {validateTask,fixedReference,validateIdentifier,taskReferences,digest,fail} from './task-schema.mjs';
const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export async function runFixedHost(argv:string[]){
 try{
  const [action,flag,value,...extra]=argv;if(extra.length||!value||!['init','start','status','stop','resume','qualify-calibration','finalize-student'].includes(action)||flag!==(action==='init'?'--state':action==='start'?'--task':['qualify-calibration','finalize-student'].includes(action)?'--request':'--run'))fail('invalid_cli','argv','exact fixed command/flag/value required');
  if(['init','start','qualify-calibration','finalize-student'].includes(action))fixedReference(value,'reference');else validateIdentifier(value,'runId');
  const adapter=new FixedHostFiles(ROOT);
  if(action==='init')return await adapter.initialize(value);
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
  if(capability.id==='B04.api-probe.v1'||capability.id==='B07.complete-match.v1'||capability.id==='B07.offline-label.v1'){
   // Public source/coverage/configuration identity and shared ordinal checks must
   // finish before opening the same private B03 store. No private replay.
   if(capability.id==='B04.api-probe.v1'||capability.id==='B07.offline-label.v1'){const refs=new Map(taskReferences(task).map((ref:string)=>[ref,adapter.resolveRef(ref)]));await adapter.verifyInputs(task,refs);}
   const path=adapter.profilePath();let profileStore:any;
   if(path){const {createProfileStore}=await import('../../packages/web/server/llm-profiles.mjs');profileStore=createProfileStore({filePath:path});}
   if(capability.id==='B04.api-probe.v1'){if(!profileStore)fail('profile_not_configured','profileStorePath','explicit private store required');const {createApiProbeTaskHost}=await import('./api-probe-consumer');host=createApiProbeTaskHost({root:adapter.root,adapter,profileStore});}
   else if(capability.id==='B07.complete-match.v1'){const {createMatchTaskHost}=await import('./match-consumer');host=createMatchTaskHost({root:adapter.root,adapter,policyRepositoryRoot:ROOT,profileStore});}
   else{if(!profileStore)fail('profile_not_configured','profileStorePath','explicit private store required');const {createOfflineLabelTaskHost}=await import('./offline-label-consumer');host=createOfflineLabelTaskHost({root:adapter.root,adapter,profileStore,mode:'research'});}
  }else if(capability.id==='B10.supervised-rerank.v1'){
   if(!adapter.manifest.pythonPath)fail('runtime_not_configured','pythonPath','explicit approved interpreter required');const {createDistillTaskHost}=await import('./distill-consumer');host=createDistillTaskHost({root:adapter.root,adapter,pythonPath:adapter.manifest.pythonPath,policyRepositoryRoot:ROOT,mode:'research'});
  }else fail('capability_planned','capabilityRef','only fixed reviewed production consumers are installed');
  return await host.dispatchOhuo(action,action==='start'?{taskRef:value}:{runId:value});
 }catch(e){const error=e as any;return{status:'rejected',reason:error.reason??'fixed_host_error',field:error.field??null,detail:error.message};}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const result=await runFixedHost(process.argv.slice(2));console.log(JSON.stringify(result));if(result.status==='rejected')process.exitCode=2;}
