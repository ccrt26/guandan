import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {TaskError,fail,referenceOf,validateTask} from './task-schema.mjs';
import {createTaskController} from './task-control.mjs';

export async function dispatchOhuo(action,request,host){
 if(!host)return {status:'rejected',reason:'host_adapter_missing',detail:'Use the fixed host integration; TaskFile cannot supply authorization or executable adapters.'};
 return host.dispatchOhuo(action,request);
}

/** Fixed CLI adapter; importing this file never reads files, writes state,
 * imports a research CLI, starts a child or listens on a port. No --cmd, script,
 * updates, shell, environment-derived execution mode or default legacy resume.
 */
export async function runCli(argv){
 try{
  const [action,...rest]=argv;if(!['start','status','stop','resume'].includes(action))fail('invalid_cli','action','start/status/stop/resume required');
  const keys=action==='start'?['--state-root','--task-file','--sha256']:['--state-root','--run'];
  if(rest.length!==keys.length*2)fail('invalid_cli','','exact fixed flags required');
  const values={};for(let i=0;i<rest.length;i+=2){if(!keys.includes(rest[i])||Object.hasOwn(values,rest[i])||!rest[i+1]||rest[i+1].startsWith('--'))fail('invalid_cli',rest[i],'unknown, repeated or missing flag');values[rest[i]]=rest[i+1];}
  for(const k of keys)if(!Object.hasOwn(values,k))fail('invalid_cli',k,'required');
  const root=resolve(values['--state-root']);let adapter=null,request={runId:values['--run']};
  if(action==='start'){
   const file=resolve(values['--task-file']),rel=relative(root,file);
   if(!rel||rel.startsWith('..')||realpathSync(file)!==file||statSync(file).size>1024*1024)fail('invalid_task_file','--task-file','readable nonsymlink TaskFile below state-root, <= 1 MiB required');
   const bytes=readFileSync(file),sha=createHash('sha256').update(bytes).digest('hex');
   if(sha!==values['--sha256'])fail('task_file_identity_mismatch','--sha256','TaskFile bytes differ from requested fixed SHA256');
   const task=validateTask(JSON.parse(bytes.toString('utf8'))),taskRef=referenceOf('task-file',task);request={taskRef};
   adapter={resolveRef:async ref=>{if(ref!==taskRef)throw Error('reference adapter unavailable');return task;}};
  }
  const host=createTaskController({root,adapter});return await dispatchOhuo(action,request,host);
 }catch(e){return {status:'rejected',reason:e instanceof TaskError?e.reason:'invalid_cli',field:e.field??null,detail:e.message};}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await runCli(process.argv.slice(2));console.log(JSON.stringify(result));if(result.status==='rejected')process.exitCode=2;
}
