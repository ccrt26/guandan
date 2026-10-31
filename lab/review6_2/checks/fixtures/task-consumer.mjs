// Synthetic control fixture only. Never imported or selected by the production CLI.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {terminateOwnedGroup} from '../../../review6/owned-process-group.mjs';
const self=fileURLToPath(import.meta.url);
const pause=(ms,signal)=>new Promise(resolve=>{
 const timer=setTimeout(done,ms);function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();}
 signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done();
});
export function simulatedConsumer({holdReserved=false,exitBeforeReply=false}={}){
 return {id:'B06.synthetic-probe.v1',kind:'probe',mode:'offline_synthetic',validateCheckpoint(c){return Number.isSafeInteger(c?.cursor)&&c.cursor>=0&&c.cursor<=3&&JSON.stringify(c.committedIds)===JSON.stringify(Array.from({length:c.cursor},(_,i)=>`step-${i+1}`));},async run({checkpoint,signal,reserve,commit}){
  const child=spawn(process.execPath,[self,exitBeforeReply?'--fixed-child-exit':'--fixed-child'],{detached:true,stdio:['ignore','ignore','pipe','ipc'],shell:false});
  let failure,exitObserved=false;
  const exited=new Promise(resolve=>child.once('exit',()=>{exitObserved=true;resolve();}));
  child.once('error',e=>{failure=e;});
  let cursor=checkpoint?.cursor??0,result,runError;
  try{
   while(cursor<3&&!signal.aborted){
    const reservation=await reserve(`step-${cursor+1}`,{providerRequests:1,optimizerSteps:0,matchAttempts:0,labelDecisions:0});
    if(holdReserved){await pause(5000,signal);break;}
    const value=await new Promise((resolve,reject)=>{
     const timeout=setTimeout(()=>reject(Error('fixture child timed out')),2000);
     child.once('message',m=>{clearTimeout(timeout);resolve(m);});child.send({cursor:cursor+1});
    });
    if(failure)throw failure;
    if(value.cursor!==cursor+1)throw Error('fixture cursor mismatch');
    cursor++;
    await commit(reservation,{cursor,committedIds:Array.from({length:cursor},(_,i)=>`step-${i+1}`)});
    await pause(150,signal);
   }
   result={cleanupConfirmed:true,completed:cursor===3,checkpoint:{cursor,committedIds:Array.from({length:cursor},(_,i)=>`step-${i+1}`)},actualScope:{localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false}};
  }catch(e){runError=e;}finally{
   // This exact PGID came from our own detached spawn; never read a PID from TaskFile/state.
   // The fixed child never creates descendants. A directly observed exit is
   // sufficient here; do not signal a possibly reused PID after that exit.
   const cleanup=exitObserved?{pgid:child.pid,termSent:false,killSent:false,remaining:false,confirmedBy:'owned-child-exit-no-descendants'}:await terminateOwnedGroup(child.pid);
   await exited;if(result)result.ownedCleanup=cleanup;
   if(runError){runError.cleanupConfirmed=true;runError.ownedCleanup=cleanup;}
  }
  if(runError)throw runError;return result;
 }};
}
if(process.argv[1]===self){
 if(process.argv.length!==3||!['--fixed-child','--fixed-child-exit'].includes(process.argv[2]))throw Error('fixed fixture invocation only');
 process.on('message',m=>{if(process.argv[2]==='--fixed-child-exit')process.exit(17);if(!Number.isSafeInteger(m?.cursor)||m.cursor<1||m.cursor>3)process.exit(2);process.send({cursor:m.cursor});});
}
