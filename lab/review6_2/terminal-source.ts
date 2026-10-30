/** Native self-play source search; the proposition sees only own/public data. */
import{isMainThread,parentPort,workerData,threadId}from'node:worker_threads';import{existsSync,mkdirSync}from'node:fs';import{join,resolve}from'node:path';
import{deriveSeed}from'@gd/ai';import{createMatch,startGame,DEFAULT_RULES,teamOf}from'@gd/engine';
import{runCompleteMatch,indexedDealSeed}from'../review6/match-play';import{dealtFamilyBeforeExchange}from'../review6/training-ancestry';import{engineDealFamily}from'../review6/capability-lineage';import{toVisibleRoot}from'../review6/visible-world';import{rootCandidates}from'../review6/teacher-roots';import{necessaryDeclarationKey}from'../review6/action-effect';import{runFrozenPool}from'../review6/compute-pool.mjs';
import{HOME,ROOT,json,hash,fileHash,atomicJson,readRegistry,validatePolicy,rootKey,bindFamilies,excludedFamilies}from'./protocol';import{publicTerminalPair,deriveTerminalBound}from'./terminal-proof';
const NAMESPACE='review6-2-terminal-native-deals-v1';
export function assertTerminalSourceScope(config:any,split:string){if(!['train','sealed'].includes(split))throw Error('native source split must be train or sealed');if(split==='sealed'&&(config.rootSourcePolicy!==undefined&&config.rootSourcePolicy!==null))throw Error('sealed source forbids candidate policy override');if(split==='sealed'&&fileHash(config.registryPath)!=='d34a08fbc5db833ca5580670ef87e11cda03bd215eb1de2c318e04dd1e236202')throw Error('sealed source requires frozen original U0 registry');}
export function terminalSourceSpec(config:any,ordinal:number,split='train'){assertTerminalSourceScope(config,split);const seed=deriveSeed('review6-2-terminal-native-source-v1',config.seed,ordinal,split);const potentialFamilies=Array.from({length:80},(_,g)=>engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(NAMESPACE,seed,g))).hands));return{seed,dealNamespace:NAMESPACE,potentialFamilies,split};}
if(!isMainThread&&workerData.role==='terminal-source'){
 parentPort!.postMessage({kind:'ready',threadId});parentPort!.on('message',m=>{
  if(m.kind==='stop'){process.exit(0);return;}if(m.kind!=='task')return;const begin=performance.now();
  try{
   const t=m.task,moves:any[]=[],families:string[]=[],seen=new Set<number>();let captured:any=null,captureAt=-1;
   const result=runCompleteMatch({seed:t.seed,dealNamespace:t.dealNamespace,dealMode:'indexed-deal-v1',rngMode:'counter-per-decision',policies:[workerData.policy,workerData.policy,workerData.policy,workerData.policy],inferenceExecution:'exact-prefix-v1',maxGames:80,maxMovesPerGame:2500,deadlineMonotonicMs:performance.now()+workerData.deadlineEpochMs-Date.now(),
    onBeforeDecision({state,seat,history}){
     if(!seen.has(state.match.gameNo)){seen.add(state.match.gameNo);const f=dealtFamilyBeforeExchange(state);if(f!==t.potentialFamilies[state.match.gameNo-1])throw Error('native source differs from pre-reserved gameNo');families.push(f);}
     if(captured||state.finished.length!==2||state.hands[seat].length!==1||state.levelsBefore[teamOf(seat)]!==14)return;
     const observedBefore=toVisibleRoot(state,history),allCandidates=rootCandidates(state),pair=publicTerminalPair(observedBefore,allCandidates);if(!pair)return;
     const root={rootId:'r62-terminal-'+(t.split??'train')+'-'+t.ordinal,sourceFamilyId:families[0],sourceRootRoundFamilyId:families.at(-1),slot:t.ordinal,category:'cooperation_urgent',caseThresholds:{minimumOpponentCount:1,urgentOpponentMaximum:3},observedBefore,allCandidates,sourceKind:'native_complete_selfplay',generationPolicyId:workerData.policy.policyId,sourcePrivateStateExposedToProposal:false};
     captured={root,pair,prefix:{schema:'native-terminal-prefix-v1',sourceSeed:t.seed,dealNamespace:t.dealNamespace,sourceFamilyId:families[0],rootGameNo:state.match.gameNo,moves:structuredClone(moves),rootObservationSHA256:observedBefore.observationSHA256}};captureAt=moves.length;
    },onAfterDecision({state,seat,move}){
     if(captured&&moves.length===captureAt){const key=necessaryDeclarationKey(move.pass?null:move.combo!,state.ctx);captured.root.actualActionId=captured.root.allCandidates.find((c:any)=>c.actionKey===key)?.actionId;}
     moves.push({gameNo:state.match.gameNo,actor:seat,move:structuredClone(move)});
    }});
   const receipt={complete:result.complete,winner:result.winner,games:result.games,decisions:result.decisions,incompleteReason:result.incompleteReason,traceSHA256:result.traceSHA256,actualRoundFamilies:families};
   parentPort!.postMessage({kind:'result',taskId:t.id,value:{receipt,captured:result.complete?captured:null},threadId,rssBytes:process.memoryUsage().rss,activeSeconds:(performance.now()-begin)/1000});
  }catch(e){parentPort!.postMessage({kind:'error',taskId:m.task.id,error:(e as Error).stack});}
 });
}
export async function collectTerminalSources(config:any,output:string,limit=1,maxSources=16,offset=0,split='train'){
 assertTerminalSourceScope(config,split);
 if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(maxSources)||maxSources<1)throw Error('valid terminal source batch required');
 const registry=readRegistry(config),policy=registry.policies.find(p=>p.policyId===registry.cleanStudent)!;validatePolicy(policy);mkdirSync(output,{recursive:true});
 const identity=hash(JSON.stringify({limit,maxSources,offset,split,seed:config.seed,policy,code:[fileHash(join(HOME,'terminal-source.ts')),fileHash(join(HOME,'terminal-proof.ts')),fileHash(resolve(ROOT,'lab/review6/match-play.ts'))]}));
 const manifest=join(output,'manifest.json');if(existsSync(manifest)){if(json(manifest).identity!==identity)throw Error('terminal source identity changed');}else atomicJson(manifest,{identity,limit,maxSources,offset,split,policy,scope:split+' native source only; no candidate score or model-strength claim'});
 const started=performance.now(),deadline=started+config.windowSeconds*1000,roots:any[]=[],sources:any[]=[],resourcePath=join(output,'resource-events.json'),resourceEvents:any[]=existsSync(resourcePath)?json(resourcePath):[];
 const resourceEvent=(v:any)=>{resourceEvents.push(v);atomicJson(resourcePath,resourceEvents);};
 const finish=(status:string)=>{const r={status,identity,split,roots,sources,completeSourceMatches:sources.filter(s=>s.complete).length,potentialReservationsAreNotGames:true,invocationWallSeconds:(performance.now()-started)/1000,resourceEvents,measuredCPUSeconds:null,externalPaidCost:0};atomicJson(join(output,'summary.json'),r);return r;};
 for(let first=offset;first<offset+maxSources&&roots.length<limit;first+=4){
  const tasks:any[]=[],foreign=new Set(excludedFamilies(config.sourceIndexRef,split));
  for(let j=first;j<Math.min(offset+maxSources,first+4);j++){
   const ordinal=j+1,path=join(output,'source-'+ordinal+'.json');if(existsSync(path))continue;
   const s=terminalSourceSpec(config,ordinal,split);if(s.potentialFamilies.some(f=>foreign.has(f))){atomicJson(path,{identity,ordinal,resultCode:'rejected-potential-foreign-family',complete:false});continue;}
   bindFamilies(config.sourceIndexRef,s.potentialFamilies,split,'terminal-potential:'+ordinal);tasks.push({id:'terminal-source-'+ordinal,ordinal,...s});
  }
  if(tasks.length){
   if(performance.now()>=deadline-20000)return finish('window_expired');
   try{const resource=await runFrozenPool({entryPath:join(HOME,'terminal-source.ts'),workers:config.workers,workerData:{role:'terminal-source',policy,deadlineEpochMs:Date.now()+deadline-performance.now()},tasks,deadlineMonotonicMs:deadline-12000,execArgv:['--import','tsx'],onResult(task:any,m:any){
    if(m.rssBytes>config.maxProcessRSSBytes)throw Error('terminal source memory limit');
    bindFamilies(config.sourceIndexRef,m.value.receipt.actualRoundFamilies,split,task.id);atomicJson(join(output,'source-'+task.ordinal+'.json'),{identity,ordinal:task.ordinal,...m.value});
   }});resourceEvent({at:new Date().toISOString(),...resource});if(!resource.complete)return finish('window_expired');}
   catch(e){resourceEvent({at:new Date().toISOString(),complete:false,workerTaskSeconds:null,reason:(e as Error).message});if((e as Error).message==='compute pool deadline exceeded including startup/ready'&&performance.now()>=deadline-13000)return finish('window_expired');throw e;}
  }
  for(let j=first;j<Math.min(offset+maxSources,first+4);j++){
   const path=join(output,'source-'+(j+1)+'.json'),r=json(path);if(r.identity!==identity)throw Error('terminal source record changed');sources.push({ordinal:j+1,complete:r.receipt?.complete===true,resultCode:r.resultCode??'sampled',actualGames:r.receipt?.games??0});
   if(!r.captured||roots.length>=limit)continue;
   const dir=join(output,'root-'+(j+1));mkdirSync(dir,{recursive:true});atomicJson(join(dir,'root.json'),r.captured.root);atomicJson(join(dir,'native-prefix.json'),r.captured.prefix);atomicJson(join(dir,'source-receipt.json'),r.receipt);
   const bound=deriveTerminalBound(r.captured.prefix);if(bound.observationSHA256!==r.captured.root.observedBefore.observationSHA256)throw Error('native terminal proposition binding failed');
   atomicJson(join(dir,'bound.json'),{evidenceKind:'full-target-interval-bound-v1',rootKey:rootKey(r.captured.root),rootSHA256:fileHash(join(dir,'root.json')),nativePrefixRef:join(dir,'native-prefix.json'),nativePrefixSHA256:fileHash(join(dir,'native-prefix.json')),sourceReceiptRef:join(dir,'source-receipt.json'),sourceReceiptSHA256:fileHash(join(dir,'source-receipt.json')),sourceIndexRef:config.sourceIndexRef,bound,claim:'producer/checker prototype only; consumer admission not yet connected'});
   roots.push({rootRef:join(dir,'root.json'),boundRef:join(dir,'bound.json'),prefixMoves:r.captured.prefix.moves.length,sourceFamilyId:r.captured.root.sourceFamilyId});
  }
 }
 return finish('completed');
}
