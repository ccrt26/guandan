/** Thin connection of legacy J: N+level2 versus O+the same level2, role paired. */
import{isMainThread,parentPort,workerData,threadId}from'node:worker_threads';
import{existsSync,mkdirSync}from'node:fs';import{join,resolve}from'node:path';
import{createMatch,startGame,DEFAULT_RULES}from'@gd/engine';import{deriveSeed,LEVEL_CAPS}from'@gd/ai';
import{runCompleteMatch,indexedDealSeed,type PolicySpec}from'../review6/match-play';
import{engineDealFamily}from'../review6/capability-lineage';import{dealtFamilyBeforeExchange}from'../review6/training-ancestry';
import{runFrozenPool}from'../review6/compute-pool.mjs';
import{HOME,ROOT,json,hash,fileHash,atomicJson,event,readRegistry,validatePolicy,bindFamilies,excludedFamilies}from'./protocol';
import{bootstrapColumns}from'./evaluate';

export function jLayouts(candidate:PolicySpec,old:PolicySpec){
 const h:PolicySpec={policyId:'legacy-J-partner-heuristic-level2',kind:'heuristic',difficulty:2};
 return[0,1].map(side=>({id:'J-side'+side,actor:side,side,metric:'J',rngMode:'legacy-per-game' as const,policies:side===0?[candidate,old,h,h]:[old,candidate,h,h]}));
}
export function jOutcome(rows:any[],layouts:any[]){
 if(rows.length!==2||new Set(rows.map(r=>r.id)).size!==2)throw Error('complete J paired block required');
 for(const l of layouts){const r=rows.find(r=>r.id===l.id);if(!r||r.complete!==true||![0,1].includes(r.winner)||r.actor!==l.actor||r.side!==l.side||r.metric!==l.metric||r.rngMode!==l.rngMode||JSON.stringify(r.policyIds)!==JSON.stringify(l.policies.map((p:any)=>p.policyId)))throw Error('J frozen role/identity mismatch');}
 return rows.reduce((n,r)=>n+Number(r.winner===r.actor%2),0)/2;
}
export function jSource(config:any,ordinal:number){
 const seed=deriveSeed('review6-2-evaluation-source-v1',config.seed,ordinal,'dev:J'),dealNamespace='review6-2-dev-J-deals-v1';
 return{seed,dealNamespace,familyId:engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(dealNamespace,seed,0))).hands)};
}
export function validateJBlock(block:any,layouts:any[],config:any,ordinal:number){
 const source=jSource(config,ordinal);
 if(block.ordinal!==ordinal||JSON.stringify(block.source)!==JSON.stringify(source)||block.matches.some((r:any)=>r.roundBaseFamilies?.[0]!==source.familyId)||block.J!==jOutcome(block.matches,layouts))throw Error('J cached ordinal/source/aggregate mismatch');
}
if(!isMainThread&&workerData.role==='J'){
 parentPort!.postMessage({kind:'ready',threadId});parentPort!.on('message',m=>{
  if(m.kind==='stop'){process.exit(0);return;}if(m.kind!=='task')return;const begin=performance.now();
  try{
   const task=m.task,rows:any[]=[],excluded=new Set(workerData.excludedFamilies);
   for(const l of task.layouts){
    const families:string[]=[],seen=new Set<number>();
    const r=runCompleteMatch({seed:task.source.seed,policies:l.policies,actingSeat:l.actor,rngMode:l.rngMode,dealMode:'indexed-deal-v1',dealNamespace:task.source.dealNamespace,inferenceExecution:'exact-prefix-v1',maxGames:80,maxMovesPerGame:2500,deadlineMonotonicMs:performance.now()+workerData.deadlineEpochMs-Date.now(),onBeforeDecision({state}){
     if(seen.has(state.match.gameNo))return;seen.add(state.match.gameNo);const f=dealtFamilyBeforeExchange(state);if(excluded.has(f))throw Error('J source split collision');families.push(f);
    }});
    if(!r.complete)throw Error('incomplete J match: '+r.incompleteReason);
    rows.push({...l,policies:undefined,policyIds:l.policies.map((p:any)=>p.policyId),complete:true,winner:r.winner,games:r.games,traceSHA256:r.traceSHA256,roundBaseFamilies:families});
   }
   parentPort!.postMessage({kind:'result',taskId:task.id,value:{ordinal:task.ordinal,source:task.source,matches:rows,J:jOutcome(rows,task.layouts)},threadId,rssBytes:process.memoryUsage().rss,activeSeconds:(performance.now()-begin)/1000});
  }catch(e){parentPort!.postMessage({kind:'error',taskId:m.task.id,error:(e as Error).stack});}
 });
}
export async function evaluateJ(config:any,candidate:PolicySpec,output:string,n=32){
 validatePolicy(candidate);if(!Number.isSafeInteger(n)||n<2)throw Error('J requires at least2 blocks');
 const registry=readRegistry(config),old=registry.policies.find(p=>p.policyId===registry.oldCompletePolicy)!,layouts=jLayouts(candidate,old),start=performance.now(),deadline=start+config.windowSeconds*1000;
 mkdirSync(output,{recursive:true});
 const identity=hash(JSON.stringify({candidate,layouts,n,seed:config.seed,caps:LEVEL_CAPS[2],code:[fileHash(resolve(HOME,'j-evaluate.ts')),fileHash(resolve(ROOT,'lab/review6/match-play.ts')),fileHash(resolve(ROOT,'packages/ai/src/player.ts'))]}));
 if(existsSync(join(output,'manifest.json'))){if(json(join(output,'manifest.json')).identity!==identity)throw Error('J manifest changed');}
 else atomicJson(join(output,'manifest.json'),{identity,candidate,layouts,n,scope:'auxiliary development J, same legacy matchup/level2 caps and per-game RNG; fresh REVIEW6.2 source list',formalAttempt:false});
 const tasks=[];
 for(let ordinal=0;ordinal<n;ordinal++){
  if(existsSync(join(output,'block-'+ordinal+'.json')))continue;
  const source=jSource(config,ordinal);bindFamilies(config.sourceIndexRef,[source.familyId],'dev','J-'+ordinal);tasks.push({id:'J-'+ordinal,ordinal,layouts,source});
 }
 let resource:any=null;
 if(tasks.length){resource=await runFrozenPool({entryPath:resolve(HOME,'j-evaluate.ts'),workers:config.workers,workerData:{role:'J',deadlineEpochMs:Date.now()+deadline-performance.now(),excludedFamilies:excludedFamilies(config.sourceIndexRef,'dev')},tasks,deadlineMonotonicMs:deadline-12000,execArgv:['--import','tsx'],onResult(task:any,m:any){
  if(m.rssBytes>config.maxProcessRSSBytes)throw Error('J memory limit');bindFamilies(config.sourceIndexRef,m.value.matches.flatMap((r:any)=>r.roundBaseFamilies),'dev',task.id);atomicJson(join(output,'block-'+task.ordinal+'.json'),{...m.value,identity});
 }});event(output,{kind:'J_resource_window',identity,resource});if(!resource.complete){const r={status:'window_expired',output,identity,resource};atomicJson(join(output,'summary.json'),r);return r;}}
 const blocks=Array.from({length:n},(_,i)=>{const b=json(join(output,'block-'+i+'.json'));if(b.identity!==identity)throw Error('J cache identity changed');validateJBlock(b,layouts,config,i);return b;});
 const saved=existsSync(join(output,'report.json'))?json(join(output,'report.json')):null;
 const stats=bootstrapColumns(config,output,'J',blocks,{J:blocks.map(b=>b.J)},[.0125,.9875]),report={status:'completed',candidate,J:stats.columns.J,independentBlocks:n,physicalCompleteMatches:2*n,wallSeconds:(performance.now()-start)/1000,resource:resource??saved?.resource??null,currentInvocationResource:resource,resourceHistoryRef:join(output,'events.jsonl'),scope:'development diagnostic only; no formal gate or human-compatibility claim',output};
 atomicJson(join(output,'report.json'),report);atomicJson(join(output,'summary.json'),report);return report;
}
