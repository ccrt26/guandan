import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fail} from './task-schema.mjs';

/** Fixed host-code capabilities, never a TaskFile command/plugin loader.
 * B06 synthetic behavior remains available. B07 installs only complete-match
 * collect/evaluate consumers, each with an independently verified mode/scope.
 * CLI without a trusted host still cannot execute research. */
export function selectConsumer(task,capability,consumers){
 const synthetic=task.taskKind==='probe'&&capability.id==='B06.synthetic-probe.v1'&&capability.kind==='probe'&&capability.mode==='offline_synthetic';
 const probe=task.taskKind==='probe'&&capability.id==='B04.api-probe.v1'&&capability.kind==='probe'&&capability.mode==='research';
 const match=['collect','evaluate'].includes(task.taskKind)&&capability.id==='B07.complete-match.v1'&&capability.kind===task.taskKind&&['research','offline_synthetic'].includes(capability.mode);
 const offlineLabel=task.taskKind==='collect'&&capability.id==='B07.offline-label.v1'&&capability.kind==='collect'&&['research','offline_synthetic'].includes(capability.mode);
 const supervised=task.taskKind==='supervised_training'&&capability.id==='B10.supervised-rerank.v1'&&capability.kind==='supervised_training'&&['research','offline_synthetic'].includes(capability.mode);
 if(!synthetic&&!match&&!offlineLabel&&!supervised&&!probe)fail('capability_planned','capabilityRef','only fixed implemented B04/B06/B07/B10 capabilities are connected');
 const consumer=consumers.find(c=>c.id===capability.id&&c.kind===task.taskKind&&c.mode===capability.mode);
 if(!consumer||typeof consumer.run!=='function'||typeof consumer.validateCheckpoint!=='function')fail('capability_planned','capabilityRef','no implemented fixed consumer registered by this host');
 if(supervised){
  // Fixed reviewed consumer source, not a TaskFile path/module or self-hash.
  const file=new URL('./distill-consumer.ts',import.meta.url);let valid=false;
  try{valid=lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink()&&createHash('sha256').update(readFileSync(file)).digest('hex')==='5cc406e00823326b2a6b81252f116cfd4920b86978f0070a1f37572cbc100f50';}catch{}
  if(!valid)fail('consumer_source_mismatch','capabilityRef','fixed reviewed B10 consumer source missing or changed');
 }
 if(task.operationScope.localExecution!==true)fail('scope_not_supported','operationScope.localExecution','explicit local execution request and authorization required');
 if(probe&&(!task.operationScope.apiCalls||task.operationScope.parameterUpdates))fail('scope_not_supported','operationScope','research probe requires only local execution and API calls');
 if(task.operationScope.parameterUpdates&&!supervised||supervised&&(!task.operationScope.parameterUpdates||task.operationScope.apiCalls)||task.operationScope.deployment||capability.mode==='offline_synthetic'&&task.operationScope.apiCalls||task.taskKind==='collect'&&!offlineLabel&&task.operationScope.apiCalls)fail('scope_not_supported','operationScope','this fixed consumer cannot perform the requested operations');
 return consumer;
}
