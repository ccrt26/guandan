import {isMainThread,parentPort,workerData,threadId} from 'node:worker_threads';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createMatch,startGame,DEFAULT_RULES} from '@gd/engine';
import {deriveSeed,MLP,NeuralDecider} from '@gd/ai';
import {runCompleteMatch,indexedDealSeed,type PolicySpec} from '../review6/match-play';
import {varianceMatchLayout} from '../review6/variance-layout';
import {dealtFamilyBeforeExchange} from '../review6/training-ancestry';
import {engineDealFamily} from '../review6/capability-lineage';
import {sampleVisibleWorld} from '../review6/visible-world';
import {rootCandidates} from '../review6/teacher-roots';
import {necessaryDeclarationKey} from '../review6/action-effect';
import {installInferenceExecution} from '../review6/exact-inference';
import {runFrozenPool} from '../review6/compute-pool.mjs';
import {ROOT,HOME,json,hash,fileHash,atomicJson,event,readRegistry,validatePolicy,readCheckpoint,runDirectory,excludedFamilies,bindFamilies} from './protocol';
import{validateMatchQueue}from'./match-queue';

export function evaluationLayouts(registry:any,candidate:PolicySpec,phase='dev'){
 const copy={...registry,policies:[...registry.policies.filter((p:any)=>p.policyId!==candidate.policyId),candidate],cleanStudent:candidate.policyId,
  developmentPartners:phase==='sealed'?registry.confirmationPartners:registry.developmentPartners};
 return varianceMatchLayout(copy,registry.oldCompletePolicy);
}
export function outcomeBlock(rows:any[],layouts:any[]){
 if(rows.length!==layouts.length||new Set(rows.map(r=>r.id)).size!==layouts.length||layouts.some(l=>!rows.some(r=>r.id===l.id))||rows.some(r=>r.complete!==true||![0,1].includes(r.winner)))throw Error('complete fixed evaluation block required');
 for(const l of layouts){const r=rows.find(r=>r.id===l.id);if(['metric','group','side','actor','variant','rngMode'].some(k=>r[k]!==l[k])||JSON.stringify(r.policyIds??r.policies?.map((p:any)=>p.policyId))!==JSON.stringify(l.policies.map((p:any)=>p.policyId)))throw Error('evaluation role/layout identity mismatch');}
 const win=(selected:any[])=>{
  if(selected.length!==2||new Set(selected.map(r=>r.side)).size!==2)throw Error('complete paired role block required');
  return selected.reduce((n,r)=>n+Number(r.winner===r.actor%2),0)/2;
 };
 const groups=rows.some(r=>r.metric==='cooperation')?[0,1,2].map(g=>win(rows.filter(r=>r.metric==='cooperation'&&r.group===g&&r.variant==='U0'))-win(rows.filter(r=>r.metric==='cooperation'&&r.group===g&&r.variant==='probe'))):null;
 return{groupDifferences:groups,macroDifference:groups?groups.reduce((a,b)=>a+b,0)/3:null,M1:rows.some(r=>r.metric==='M1')?win(rows.filter(r=>r.metric==='M1')):null,M2:rows.some(r=>r.metric==='M2')?win(rows.filter(r=>r.metric==='M2')):null};
}
if(!isMainThread&&workerData.role==='evaluation'){
 parentPort!.postMessage({kind:'ready',threadId});
 parentPort!.on('message',m=>{
  if(m.kind==='stop'){process.exit(0);return;}if(m.kind!=='task')return;const begin=performance.now();
  try{
   const task=m.task,rows=[],deadline=performance.now()+workerData.deadlineEpochMs-Date.now(),excluded=new Set(workerData.excludedFamilies);
   for(const layout of task.layouts){
    const source=task.sources[layout.metric],families:string[]=[],seen=new Set(),start=performance.now();
    const result=runCompleteMatch({seed:source.seed,policies:layout.policies,actingSeat:layout.actor,rngMode:layout.rngMode,dealMode:'indexed-deal-v1',dealNamespace:source.dealNamespace,inferenceExecution:'exact-prefix-v1',maxGames:80,maxMovesPerGame:2500,deadlineMonotonicMs:deadline,
     onBeforeDecision({state}){if(!seen.has(state.match.gameNo)){seen.add(state.match.gameNo);const family=dealtFamilyBeforeExchange(state);if(excluded.has(family))throw Error('evaluation source family split collision');if(task.expectedRoundFamilies&&task.expectedRoundFamilies[layout.metric][state.match.gameNo-1]!==family)throw Error('formal source differs from locked gameNo ancestry');families.push(family);}}
    });
    if(!result.complete)throw Error('incomplete evaluation match: '+result.incompleteReason);
    rows.push({...layout,policies:undefined,policyIds:layout.policies.map((p:any)=>p.policyId),complete:result.complete,winner:result.winner,activeSeconds:(performance.now()-start)/1000,traceSHA256:result.traceSHA256,games:result.games,roundBaseFamilies:families});
   }
   parentPort!.postMessage({kind:'result',taskId:task.id,value:{ordinal:task.ordinal,sources:task.sources,matches:rows,...outcomeBlock(rows,task.layouts)},threadId,rssBytes:process.memoryUsage().rss,activeSeconds:(performance.now()-begin)/1000});
  }catch(e){parentPort!.postMessage({kind:'error',taskId:m.task.id,error:(e as Error).stack});}
 });
}

export function policyForRun(config:any,id:string){
 const registry=readRegistry(config);
 if(id==='U0')return registry.policies.find((p:any)=>p.policyId===registry.cleanStudent)!;
 if(id==='O')return registry.policies.find((p:any)=>p.policyId===registry.oldCompletePolicy)!;
 const directory=runDirectory(id),manifest=json(join(directory,'manifest.json')),cp=readCheckpoint(directory);
 if(manifest.scope!=='main_training')throw Error('smoke checkpoint is not a research candidate');
 const policy={...cp.state.current,policyId:`${id}-u${cp.state.absoluteUpdate}-greedy`,weightsPath:join(cp.path,'weights.f32'),epsilon:0};
 validatePolicy(policy);return policy;
}

export function scoreRoot(policy:PolicySpec,root:any){
 validatePolicy(policy);if(policy.kind!=='neural')throw Error('neural root scorer required');
 const raw=readFileSync(policy.weightsPath!),flat=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),net=new MLP(1,policy.inputDim);net.setWeights(flat);installInferenceExecution(net,'exact-prefix-v1');
 const obs=root.observedBefore,world=sampleVisibleWorld(obs,deriveSeed('review6-2-policy-root-eval-v1',20261029,0,obs.observationSHA256)),decider=new NeuralDecider(obs.actor,net,0,()=>0,policy.encoder);
 decider.newGame();for(const h of obs.history)decider.observe(h.events);
 const decision=decider.decide(world.state,{wantRanking:true}),candidates=rootCandidates(world.state),key=necessaryDeclarationKey(decision.move.pass?null:decision.move.combo!,world.state.ctx),chosen=candidates.find(c=>c.actionKey===key);
 if(!chosen)throw Error('actual policy choice missing from complete legal action set');
 return{policyId:policy.policyId,actionId:chosen.actionId,actionKey:key,ranking:decision.ranking!.map(r=>({actionKey:necessaryDeclarationKey(r.combo,world.state.ctx),score:r.score})),strategicCorrectness:null};
}

function evalSource(config:any,phase:string,metric:string,ordinal:number){
 const seed=deriveSeed('review6-2-evaluation-source-v1',config.seed,ordinal,phase+':'+metric),dealNamespace=`review6-2-${phase}-${metric}-deals-v1`;
 return{seed,dealNamespace,familyId:engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(dealNamespace,seed,0))).hands)};
}
export function bootstrapColumns(config:any,output:string,name:string,blocks:any[],columns:any,probabilities:number[]){
 const input=join(output,name+'-stats-input.json'),path=join(output,name+'-stats.json');
 const data={unitIds:blocks.map(b=>'block-'+String(b.ordinal).padStart(6,'0')),columns,seed:deriveSeed('review6-2-bootstrap-v1',config.seed,0,name),probabilities};
 if(existsSync(path)){
  if(JSON.stringify(json(input))!==JSON.stringify(data))throw Error('cached statistics differ from current blocks/input; preserve old output and explicitly rebuild statistics');
  const cached=json(path);if(cached.inputSHA256!==fileHash(input)||cached.sourceSHA256!==fileHash(resolve(ROOT,'lab/review6/paired_stats.py')))throw Error('cached statistics identity changed');return cached;
 }
 atomicJson(input,data);
 const r=spawnSync(config.pythonPath,[resolve(ROOT,'lab/review6/paired_stats.py'),'paired','--input',input,'--output',path],{cwd:ROOT,encoding:'utf8',timeout:120000,env:{...process.env,OMP_NUM_THREADS:'2',PYTHONDONTWRITEBYTECODE:'1'}});
 if(r.status!==0)throw Error('paired statistics failed: '+r.stderr);return json(path);
}

export async function evaluatePolicy(config:any,candidate:PolicySpec,output:string,counts={cooperation:32,M1:32,M2:32},phase='dev'){
 const registry=readRegistry(config),layouts=evaluationLayouts(registry,candidate,phase),start=performance.now(),deadline=start+config.windowSeconds*1000;
 if(phase==='sealed'&&!config.matchQueueRef)throw Error('fixed formal match source queue required');
 const locked=phase==='sealed'?validateMatchQueue(config,config.matchQueueRef,config.formalExamFiles):null;
 if(locked&&(locked.queue.attempt!==config.formalAttempt||locked.queue.evaluationSeed!==config.seed||JSON.stringify(locked.queue.counts)!==JSON.stringify(counts)))throw Error('formal queue attempt/seed/counts differ');
 const sourceAt=(metric:string,ordinal:number)=>locked?locked.lookup[metric][ordinal].source:evalSource(config,phase,metric,ordinal);
 const assertAncestry=(rows:any[],ordinal:number)=>{if(locked)for(const r of rows){const expected=locked.lookup[r.metric][ordinal].roundFamilies;if(r.roundBaseFamilies.length!==r.games||r.roundBaseFamilies.some((f:string,i:number)=>f!==expected[i]))throw Error('cached formal round source/gameNo differs from fixed queue');}};
 mkdirSync(output,{recursive:true});const identity=hash(JSON.stringify({candidate,registry:fileHash(config.registryPath),layouts,counts,phase,seed:config.seed,...(locked?{matchQueueSHA256:locked.sha256}:{}),code:[fileHash(resolve(HOME,'evaluate.ts')),fileHash(resolve(ROOT,'lab/review6/match-play.ts')),fileHash(resolve(ROOT,'lab/review6/variance-layout.ts'))]}));
 if(existsSync(join(output,'manifest.json'))){if(json(join(output,'manifest.json')).identity!==identity)throw Error('evaluation manifest changed');}
 else atomicJson(join(output,'manifest.json'),{identity,candidate,counts,phase,seed:config.seed,...(locked?{matchQueueRef:config.matchQueueRef,matchQueueSHA256:locked.sha256}:{}),heldoutPool:phase==='sealed'?registry.confirmationPartners:registry.developmentPartners,rng:'counter-per-decision except legacy M2 per-game',sourceNamespace:'review6-2-evaluation-source-v1',scope:phase==='dev'?'development, selection allowed, no confirm claim':'fixed candidate confirmation'});
 const n=Math.max(...Object.values(counts)),tasks=[];
 for(let ordinal=0;ordinal<n;ordinal++){
  if(existsSync(join(output,`block-${String(ordinal).padStart(5,'0')}.json`)))continue;
  const active=layouts.filter(l=>ordinal<counts[l.metric]),sources:any={};
  for(const metric of new Set(active.map(l=>l.metric))){sources[metric]=sourceAt(metric,ordinal);bindFamilies(config.sourceIndexRef,[sources[metric].familyId],phase,'evaluation-'+metric+'-'+ordinal);}
  tasks.push({id:'evaluation-block-'+ordinal,ordinal,layouts:active,sources,...(locked?{expectedRoundFamilies:Object.fromEntries(Object.keys(sources).map(metric=>[metric,locked.lookup[metric][ordinal].roundFamilies]))}:{})});
 }
 let resource:any=null,expired=false;
 if(tasks.length)try{resource=await runFrozenPool({entryPath:resolve(HOME,'evaluate.ts'),workers:config.workers,workerData:{role:'evaluation',deadlineEpochMs:Date.now()+deadline-performance.now(),excludedFamilies:excludedFamilies(config.sourceIndexRef,phase)},tasks,deadlineMonotonicMs:deadline-12000,execArgv:['--import','tsx'],onResult(task:any,m:any){
  if(m.rssBytes>config.maxProcessRSSBytes)throw Error('evaluation memory limit');
  assertAncestry(m.value.matches,task.ordinal);
  const families=[...new Set(m.value.matches.flatMap((r:any)=>r.roundBaseFamilies))] as string[];
  bindFamilies(config.sourceIndexRef,families,phase,task.id);
  atomicJson(join(output,`block-${String(task.ordinal).padStart(5,'0')}.json`),{...m.value,identity});
  console.log(JSON.stringify({stage:'evaluation',policyId:candidate.policyId,completedBlock:task.ordinal+1,requiredBlocks:n}));
 }});if(!resource.complete){if(performance.now()+1000<deadline-12000)throw Error('incomplete evaluation far from window expiry');expired=true;}}
 catch(e){if((e as Error).message==='compute pool deadline exceeded including startup/ready'&&performance.now()>=deadline-13000)expired=true;else throw e;}
 if(tasks.length)event(output,{kind:'evaluation_resource_window',identity,resource,expired,wallSeconds:(performance.now()-start)/1000});
 if(expired){const summary={status:'window_expired' as const,output,identity,counts,resource,completedBlocks:Array.from({length:n},(_,i)=>existsSync(join(output,`block-${String(i).padStart(5,'0')}.json`))).filter(Boolean).length};atomicJson(join(output,'summary.json'),summary);return summary;}
 const blocks=Array.from({length:n},(_,i)=>{
  const b=json(join(output,`block-${String(i).padStart(5,'0')}.json`)),active=layouts.filter(l=>i<counts[l.metric]),v:any=outcomeBlock(b.matches,active);
  if(b.ordinal!==i||Object.keys(v).some(k=>JSON.stringify(v[k])!==JSON.stringify(b[k]))||[...new Set(active.map(l=>l.metric))].some(metric=>JSON.stringify(b.sources[metric])!==JSON.stringify(sourceAt(metric,i))))throw Error('cached evaluation raw rows/source differ from aggregate');assertAncestry(b.matches,i);
  return b;
 });
 if(blocks.some(b=>b.identity!==identity))throw Error('evaluation checkpoint identity mismatch');
 const coop=blocks.filter(b=>b.macroDifference!==null),m1=blocks.filter(b=>b.M1!==null),m2=blocks.filter(b=>b.M2!==null);
 const stats=bootstrapColumns(config,output,'cooperation',coop,{macro:coop.map(b=>b.macroDifference),group0:coop.map(b=>b.groupDifferences[0]),group1:coop.map(b=>b.groupDifferences[1]),group2:coop.map(b=>b.groupDifferences[2])},[.05/3,1-.05/3]);
 const s1=bootstrapColumns(config,output,'M1',m1,{M1:m1.map(b=>b.M1)},[.0125,.9875]),s2=bootstrapColumns(config,output,'M2',m2,{M2:m2.map(b=>b.M2)},[.0125,.9875]);
 const saved=existsSync(join(output,'report.json'))?json(join(output,'report.json')):null;
 const report={status:'completed' as const,phase,candidate,counts,physicalCompleteMatches:blocks.reduce((n,b)=>n+b.matches.length,0),cooperation:stats.columns,M1:s1.columns.M1,M2:s2.columns.M2,S:.5*s1.columns.M1.point+.5*s2.columns.M2.point,J:null,
  wallSeconds:(performance.now()-start)/1000,resource:resource??saved?.resource??null,currentInvocationResource:resource,resourceHistoryRef:join(output,'events.jsonl'),scope:phase==='dev'?'directional development only; small sample, model selection':'fixed confirmation for registered nonhuman policies',playingPolicyUpdated:false};
 atomicJson(join(output,'report.json'),report);atomicJson(join(output,'summary.json'),report);return report;
}

export async function evaluateDevelopment(config:any,runId:string,nBlocks=32){
 const candidate=policyForRun(config,runId),output=join(HOME,'development',candidate.policyId+'-'+nBlocks+'blocks');
 const report=await evaluatePolicy(config,candidate,output,{cooperation:nBlocks,M1:nBlocks,M2:nBlocks},'dev');
 if(report.status==='window_expired')return{...report,output};
 const rootsPath=join(HOME,'data/dev-roots-001/manifest.json');
 if(existsSync(rootsPath)){
  const roots=json(rootsPath),policies=[policyForRun(config,'O'),policyForRun(config,'U0'),candidate];
  const decisions=roots.roots.map((r:any)=>{const root=json(r.rootRef);return{rootId:r.rootId,sourceFamilyId:r.sourceFamilyId,category:r.category,split:'dev',choices:policies.map(p=>scoreRoot(p,root)),supported:null};});
  atomicJson(join(output,'root-decisions.json'),{scope:'unseen source choices; labels not certified, no accuracy claim',decisions});
 }
 if(!['U0','O'].includes(runId))event(runDirectory(runId),{kind:'development',checkpointPolicyId:candidate.policyId,reportPath:join(output,'report.json'),macro:report.cooperation.macro.point,M1:report.M1.point,M2:report.M2.point});
 return{output,...report};
}
