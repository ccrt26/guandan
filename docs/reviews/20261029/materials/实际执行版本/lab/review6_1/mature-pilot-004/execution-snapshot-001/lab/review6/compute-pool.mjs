import{Worker}from'node:worker_threads';
/** One frozen window. Deadline includes worker startup; all failure paths wait
 * for every worker to terminate. There is no next-root/window scheduler. */
export async function runFrozenPool({entryPath,workers,workerData,tasks,deadlineMonotonicMs,onResult,execArgv=[]}){
 if(![1,2,4].includes(workers)||!Array.isArray(tasks)||new Set(tasks.map(t=>t.id)).size!==tasks.length||!Number.isFinite(deadlineMonotonicMs))throw Error('invalid bounded compute pool');
 const begin=performance.now(),records=Array.from({length:workers},(_,index)=>({index,threadId:null,startedMs:null,endedMs:null,tasks:0,taskSeconds:0,peakRSSBytes:0})),children=[],jobs=[],starters=[];let cursor=0,completed=0,stopped=false,failure=null;
 const abort=error=>{if(!failure)failure=error;stopped=true;for(const child of children)if(child.threadId!==-1)child.terminate().catch(()=>{});};
 const timer=setTimeout(()=>abort(Error('compute pool deadline exceeded including startup/ready')),Math.max(0,deadlineMonotonicMs-performance.now()));
 try{for(const record of records){let worker;try{record.startedMs=performance.now();worker=new Worker(entryPath,{workerData:{...workerData,workerIndex:record.index,parentPerformanceTimeOrigin:performance.timeOrigin},execArgv});children.push(worker);}catch(error){abort(error);break;}
  jobs.push(new Promise(done=>{let active=null,taskStarted=0,stopSent=false,ready=false;const stop=()=>{stopSent=true;worker.postMessage({kind:'stop'});};const dispatch=()=>{if(stopped||cursor>=tasks.length||performance.now()+1000>=deadlineMonotonicMs){stop();return;}active=tasks[cursor++];taskStarted=performance.now();worker.postMessage({kind:'task',task:active});};
   worker.on('message',message=>{try{if(stopped)return;if(message.kind==='ready'){if(ready)throw Error('duplicate worker ready');ready=true;record.threadId=message.threadId;starters.push(dispatch);if(starters.length===workers)starters.forEach(start=>start());}else if(message.kind==='result'){if(!active||message.taskId!==active.id)throw Error('worker task identity changed');const task=active;active=null;record.tasks++;record.taskSeconds+=(performance.now()-taskStarted)/1000;record.peakRSSBytes=Math.max(record.peakRSSBytes,message.rssBytes??0);onResult(task,message);completed++;dispatch();}else if(message.kind==='error')abort(Error(message.error));}catch(error){abort(error);}});
   worker.on('error',abort);worker.on('exit',code=>{record.endedMs=performance.now();if(!stopped&&(code!==0||!stopSent))abort(Error('frozen worker exited before explicit stop: '+code));done();});
  }));}
  await Promise.all(jobs);
 }finally{clearTimeout(timer);if(failure)await Promise.all(children.filter(w=>w.threadId!==-1).map(w=>w.terminate().catch(()=>{})));}
 if(failure)throw failure;
 return{complete:completed===tasks.length,completedTasks:completed,plannedTasks:tasks.length,deviceWallSeconds:(performance.now()-begin)/1000,workerTaskSeconds:records.reduce((n,r)=>n+r.taskSeconds,0),workerLifetimeSeconds:records.reduce((n,r)=>n+(r.startedMs===null?0:((r.endedMs??performance.now())-r.startedMs)/1000),0),workerRecords:records};
}
