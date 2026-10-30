import {isMainThread,parentPort,workerData,threadId} from 'node:worker_threads';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createMatch,startGame,DEFAULT_RULES} from '@gd/engine';
import {deriveSeed} from '@gd/ai';
import {runFrozenPool} from '../review6/compute-pool.mjs';
import {pilotSourceRows,collectPilotSourceRoot,PILOT_SOURCE_DEAL_NAMESPACE,rootCandidates} from '../review6/teacher-roots';
import {indexedDealSeed} from '../review6/match-play';
import {engineDealFamily} from '../review6/capability-lineage';
import {sampleVisibleWorld} from '../review6/visible-world';
import {scoreVisibleCandidates,evaluateTeacherBranch} from '../review6/teacher-engine';
import {HOME,ROOT,json,hash,fileHash,atomicJson,event,rootKey,readRegistry,validatePolicy,bindFamilies,excludedFamilies,assertTrainingLabels} from './protocol';
import {assertTeachingEvidence}from'./teaching-evidence';

if(!isMainThread&&workerData.role==='teacher'){
 parentPort!.postMessage({kind:'ready',threadId});
 parentPort!.on('message',m=>{
  if(m.kind==='stop'){process.exit(0);return;}if(m.kind!=='task')return;const begin=performance.now();
  try{
   const deadline=performance.now()+workerData.deadlineEpochMs-Date.now();let value:any;
   if(m.task.mode==='source'){
    const raw=collectPilotSourceRoot(m.task.row,m.task.policy,{deadlineMonotonicMs:deadline,publicStage:m.task.publicStage});
    const r=raw.root;
    value={...raw,root:r?{rootId:r.rootId,sourceFamilyId:r.sourceFamilyId,sourceRootRoundFamilyId:r.sourceRootRoundFamilyId,category:r.category,caseThresholds:r.caseThresholds,observedBefore:r.observedBefore,allCandidates:r.allCandidates}:null};
   }else{
    value=evaluateTeacherBranch(m.task.root??workerData.root,m.task.registry??workerData.registry,m.task.profile,m.task.world,m.task.actionId,null,deadline,m.task.inferenceExecution??'exact-prefix-v1');
   }
   parentPort!.postMessage({kind:'result',taskId:m.task.id,value,threadId,rssBytes:process.memoryUsage().rss,activeSeconds:(performance.now()-begin)/1000});
  }catch(e){parentPort!.postMessage({kind:'error',taskId:m.task.id,error:(e as Error).stack});}
 });
}

export function normalizeTeachingCards(cards:any[],index:any,expectedSplit='train'){
 const groups=new Map<string,any[]>(),rejected:any[]=[],explicitConflicts=new Set<string>();
 for(const card of cards)try{
  if(card.split!==expectedSplit||index.families?.[card.sourceFamilyId]?.split!==expectedSplit)throw Error('source split mismatch');
  if(!['human','llm','rule','rollout'].includes(card.sourceKind))throw Error('teacher source kind required');
  if(card.preference==='conflict'){
   if(!card.rootRef||fileHash(card.rootRef)!==card.rootSHA256)throw Error('conflict root provenance changed');
   const root=json(card.rootRef);if(root.sourceFamilyId!==card.sourceFamilyId)throw Error('conflict root identity changed');
   explicitConflicts.add(rootKey(root));rejected.push({labelId:card.labelId,reason:'conflict'});continue;
  }
  if(['tie','abstain'].includes(card.preference)){rejected.push({labelId:card.labelId,reason:card.preference});continue;}
  if(card.preference!=='prefer'||!card.rationale)throw Error('explicit directional preference and rationale required');
  if(fileHash(card.rootRef)!==card.rootSHA256)throw Error('root provenance changed');
  const root=json(card.rootRef),obs=root.observedBefore;
  if(root.sourceFamilyId!==card.sourceFamilyId||obs.representationGaps.length)throw Error('root identity/representation_gap');
  const sampled=sampleVisibleWorld(obs,deriveSeed('review6-2-card-legal-world-v1',20261029,0,obs.observationSHA256));
  const candidates=rootCandidates(sampled.state),plus=candidates.find(c=>c.actionId===card.preferredActionId),minus=candidates.find(c=>c.actionId===card.otherActionId);
  if(!plus||!minus||plus.actionId===minus.actionId)throw Error('proposed action outside legal visible set');
  if(card.evidenceTier==='strong')assertTeachingEvidence(card,root,rootKey(root),index,expectedSplit);
  if(!['weak','strong'].includes(card.evidenceTier))throw Error('label tier invalid');
  const key=rootKey(root),rows=groups.get(key)??[];
  rows.push({...card,rootKey:key,plus:[...obs.modelState331,...plus.features68],minus:[...obs.modelState331,...minus.features68]});groups.set(key,rows);
 }catch(e){rejected.push({labelId:card.labelId,reason:(e as Error).message});}
 const labels:any[]=[];
 for(const[key,all]of groups){
  if(explicitConflicts.has(key)){rejected.push({rootKey:key,reason:'conflict'});continue;}
  const directions=new Set(all.map(c=>c.preferredActionId+'>'+c.otherActionId));
  if(all.some(c=>directions.has(c.otherActionId+'>'+c.preferredActionId))){rejected.push({rootKey:key,reason:'conflict'});continue;}
  const strong=all.filter(c=>c.evidenceTier==='strong'),rows=strong.length?strong:all;
  if(new Set(rows.map(c=>c.evidenceKind??'rollout')).size!==1){rejected.push({rootKey:key,reason:'mixed teaching evidence kinds'});continue;}
  const unique=[...new Map(rows.map(c=>[c.preferredActionId+'>'+c.otherActionId,c])).values()];
  const first=unique[0];
  if(unique.some(c=>c.evidenceKind!==first.evidenceKind)||(first.evidenceKind&&unique.length!==1)){rejected.push({rootKey:key,reason:'mixed or multi-pair bound proof'});continue;}
  labels.push({labelId:'r62-label:'+key,rootKey:key,sourceFamilyId:first.sourceFamilyId,split:expectedSplit,scope:'main',evidenceTier:first.evidenceTier,weight:first.evidenceTier==='strong'?1:.25,
   sourceKind:first.sourceKind,rootRef:first.rootRef,rootSHA256:first.rootSHA256,statisticsRef:first.statisticsRef??null,statisticsSHA256:first.statisticsSHA256??null,statisticsRefs:first.evidenceTier==='strong'&&!first.evidenceKind?unique.map(c=>({path:c.statisticsRef,sha256:c.statisticsSHA256})):undefined,
   ...(first.evidenceKind?{evidenceKind:first.evidenceKind,proofRef:first.proofRef,proofSHA256:first.proofSHA256}:{}),
   pairs:unique.map(c=>({preferredActionId:c.preferredActionId,otherActionId:c.otherActionId})),plus:unique.map(c=>c.plus),minus:unique.map(c=>c.minus),
   proposalIds:all.map(c=>c.labelId),rationales:unique.map(c=>c.rationale),claim:first.evidenceTier==='strong'?'conditional complete g+W evidence':'unverified preference; not strategic correctness'});
 }
 return{labels,rejected,inputCards:cards.length,uniqueLabeledRoots:labels.length};
}

export async function collectRoots(config:any,split:string,output:string,limit=16,offset=0,maxAttempts=48){
 if(!['train','dev','sealed'].includes(split)||!Number.isSafeInteger(limit)||limit<1||existsSync(output))throw Error('new output and valid source split required');
 if(config.rootSourcePolicy&&split!=='train')throw Error('current-candidate source override is training-only');
 if(config.rootPublicStage&&(split!=='train'||JSON.stringify(config.rootPublicStage)!=='{"minOwnCards":8,"maxOwnCards":20,"minMoveNo":20}'))throw Error('only reviewed public midgame source stage allowed');
 mkdirSync(output,{recursive:true});const registry=readRegistry(config),student=config.rootSourcePolicy??registry.policies.find((p:any)=>p.policyId===registry.cleanStudent)!;validatePolicy(student);
 const deadline=performance.now()+config.windowSeconds*1000,templates=pilotSourceRows(),roots:any[]=[],sources:any[]=[],start=performance.now(),resourceEvents:any[]=[];
 const exclusions=new Set(excludedFamilies(config.sourceIndexRef,split));
 for(let first=offset;first<offset+maxAttempts&&roots.length<limit;first+=4){
  const tasks=Array.from({length:Math.min(4,offset+maxAttempts-first)},(_,j)=>{
   const ordinal=first+j+1,template=templates[(ordinal-1)%templates.length],seed=deriveSeed('review6-2-teaching-source-v1',config.seed,ordinal,split);
   const familyId=engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(PILOT_SOURCE_DEAL_NAMESPACE,seed,0))).hands);
   const row={...template,slot:ordinal,sourceSeed:seed,familyId,rootId:`r62-${split}-root-${ordinal}`,sourceMatchId:`r62-${split}-source-${ordinal}`,sourceKind:'student_trajectory' as const};
   if(config.rootPublicStage){
    const potential=Array.from({length:80},(_,g)=>engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(PILOT_SOURCE_DEAL_NAMESPACE,seed,g))).hands));
    if(potential.some(f=>exclusions.has(f))){sources.push({ordinal,familyId,resultCode:'rejected_potential_foreign_family',complete:false,sampled:false});return null;}
    bindFamilies(config.sourceIndexRef,potential,'train','midgame-potential:'+ordinal);
   }else if(exclusions.has(familyId))throw Error('source family collision; keep prelocked attempt as rejected');
   return{id:row.rootId,ordinal,mode:'source',row,policy:student,publicStage:config.rootPublicStage};
  }).filter(Boolean);
  const rows:any[]=[];
  if(tasks.length)resourceEvents.push(await runFrozenPool({entryPath:resolve(HOME,'teacher.ts'),workers:config.workers,workerData:{role:'teacher',deadlineEpochMs:Date.now()+deadline-performance.now()},tasks,deadlineMonotonicMs:deadline-12000,execArgv:['--import','tsx'],onResult(task:any,m:any){if(m.rssBytes>config.maxProcessRSSBytes)throw Error('teacher memory limit');rows.push({task,value:m.value});}}));
  rows.sort((a,b)=>a.task.ordinal-b.task.ordinal);
  for(const{task,value}of rows){
   bindFamilies(config.sourceIndexRef,[task.row.familyId,...value.sourceCompletion.roundFamilies.map((r:any)=>r.familyId)],split,task.id);
   sources.push({ordinal:task.ordinal,familyId:task.row.familyId,resultCode:value.resultCode,complete:value.sourceCompletion.complete});
   if(!value.root||roots.length>=limit)continue;
   const root={...value.root,slot:task.ordinal},scored=scoreVisibleCandidates({...root,actualActionId:root.allCandidates[0].actionId},student);
   root.actualActionId=scored.preferredActionId;const path=join(output,root.rootId+'.json');atomicJson(path,root);
   roots.push({rootId:root.rootId,sourceFamilyId:root.sourceFamilyId,category:root.category,rootRef:path,rootSHA256:fileHash(path),split,studentPreferredActionId:scored.preferredActionId,studentScores:scored.scores});
  }
  console.log(JSON.stringify({stage:'collect-roots',split,roots:roots.length,sources:sources.length,target:limit}));
 }
 const manifest={schemaVersion:'r62-root-manifest-v1',split,sourcePolicyId:student.policyId,sourcePolicy:student,seed:config.seed,offset,maxAttempts,limit,roots,sources,wallSeconds:(performance.now()-start)/1000,resourceEvents,measuredCPUSeconds:null,externalPaidCost:0,...(config.rootPublicStage?{publicStage:config.rootPublicStage,potentialReservationsAreNotGames:true}:{}),proposerSees:'own/public only; hidden source state stripped in worker',scope:split==='sealed'?'fixed prospective question sources; no candidate scores':'development_or_training_sources'};
 atomicJson(join(output,'manifest.json'),manifest);return manifest;
}

export function importCards(config:any,input:string,output:string){
 if(existsSync(output))throw Error('output exists');
 const cards=readFileSync(input,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
 const result=normalizeTeachingCards(cards,json(config.sourceIndexRef));
 assertTrainingLabels(result.labels,false,json(config.sourceIndexRef));mkdirSync(output,{recursive:true});
 atomicJson(join(output,'labels.json'),result.labels);atomicJson(join(output,'import-report.json'),{...result,labels:undefined,inputSHA256:fileHash(input),input});return result;
}

export function admitStrongProposals(cards:any[],index:any){
 if(!cards.length)return{cards:[],rejected:[]};
 const split=cards[0].split;if(!['train','dev','sealed'].includes(split)||cards.some(c=>c.split!==split))throw Error('one strong batch needs one declared split');
 const admitted=normalizeTeachingCards(cards,index,split),allowed=new Set(admitted.labels.map(l=>l.rootKey)),seen=new Map<string,number>(),rejected=[...admitted.rejected];
 const prefer=cards.filter(c=>c.preference==='prefer').map(card=>({card,key:rootKey(json(card.rootRef))}));
 for(const{key}of prefer)seen.set(key,(seen.get(key)??0)+1);
 for(const[key,n]of seen)if(n>1){allowed.delete(key);rejected.push({rootKey:key,reason:'strong batch supports one prelocked pair per root; duplicate root quarantined'});}
 return{cards:prefer.filter(r=>allowed.has(r.key)).map(r=>r.card),rejected};
}

/** Fixed pairs and fixed 256/128 worlds. Failed support never flips the pair. */
export async function verifyTeachingCards(config:any,input:string,output:string){
 const admitted=admitStrongProposals(readFileSync(input,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)),json(config.sourceIndexRef)),cards=admitted.cards;
 const registry=readRegistry(config),identity=hash(JSON.stringify({input:fileHash(input),registry:fileHash(config.registryPath),teacher:fileHash(resolve(HOME,'teacher.ts')),engine:fileHash(resolve(ROOT,'lab/review6/teacher-engine.ts')),kernel:fileHash(resolve(ROOT,'lab/review6/paired_stats.py')),worldSeedRule:'public-observation-only-v2',primary:256,secondary:128}));
 mkdirSync(output,{recursive:true});
 if(existsSync(join(output,'manifest.json'))){if(json(join(output,'manifest.json')).identity!==identity)throw Error('strong batch inputs/code changed');}
 else atomicJson(join(output,'manifest.json'),{identity,input,inputSHA256:fileHash(input),roots:cards.map(c=>c.labelId),rejected:admitted.rejected,primaryWorlds:256,secondaryWorlds:128,rootOnly:true,pairSelectedBeforeValidation:true});
 const deadline=performance.now()+config.windowSeconds*1000,reports:any[]=[],accepted:any[]=[];
 for(const card of cards){
  if(fileHash(card.rootRef)!==card.rootSHA256)throw Error('strong root changed');
  const root=json(card.rootRef),key=rootKey(root),directory=join(output,key);mkdirSync(directory,{recursive:true});
  const admission=normalizeTeachingCards([{...card,evidenceTier:'weak'}],json(config.sourceIndexRef),card.split);
  if(admission.labels.length!==1)throw Error('strong proposal source/legal admission failed: '+JSON.stringify(admission.rejected));
  const finalPath=join(directory,'root-report.json');
  if(existsSync(finalPath)){const done=json(finalPath);if(done.identity!==identity)throw Error('completed strong root changed');reports.push(done);if(done.accepted)accepted.push(done.card);continue;}
  const journal=join(directory,'branches.jsonl'),completed=new Map<string,any>();
  if(existsSync(journal))for(const line of readFileSync(journal,'utf8').trim().split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.identity!==identity)throw Error('strong branch identity changed');completed.set(r.id,r);}
  const seedSet=new Set<number>(),worlds:any={};
  for(const[phase,n]of[['primary',256],['secondary',128]]as const)worlds[phase]=Array.from({length:n},(_,i)=>{
   const seed=deriveSeed('review6-2-strong-independent-world-v2',2026102903,0,phase+':'+i+':'+root.observedBefore.observationSHA256);
   if(seedSet.has(seed))throw Error('world seed collision');seedSet.add(seed);return{worldId:key+':'+phase+':'+String(i).padStart(4,'0'),seed,index:i};
  });
  atomicJson(join(directory,'worlds.json'),worlds);
  let lineageValid=true;
  try{
   for(const phase of ['primary','secondary']){
    const tasks=worlds[phase].flatMap((world:any)=>['A','B'].map(arm=>({id:world.worldId+':'+arm,mode:'branch',world,profile:phase,phase,arm,actionId:arm==='A'?card.preferredActionId:card.otherActionId}))).filter((t:any)=>!completed.get(t.id)?.value?.complete);
    if(!tasks.length)continue;
    if(performance.now()>=deadline-20000)throw Error('strong normal window expiry');
    const resource=await runFrozenPool({entryPath:resolve(HOME,'teacher.ts'),workers:config.workers,workerData:{role:'teacher',root,registry,deadlineEpochMs:Date.now()+deadline-performance.now()},tasks,deadlineMonotonicMs:deadline-12000,execArgv:['--import','tsx'],onResult(task:any,m:any){
     if(m.rssBytes>config.maxProcessRSSBytes)throw Error('strong teacher memory limit');
     const row={id:task.id,worldId:task.world.worldId,phase,arm:task.arm,seed:task.world.seed,value:m.value,identity};
     writeFileSync(journal,JSON.stringify(row)+'\n',{flag:'a'});completed.set(task.id,row);
     if(completed.size%64===0)console.log(JSON.stringify({stage:'strong-root',rootId:root.rootId,completedBranches:completed.size,requiredBranches:768}));
    }});
    if(!resource.complete)throw Error('strong normal window expiry');
   }
  }catch(e){
   if((e as Error).message==='strong normal window expiry'||(e as Error).message==='compute pool deadline exceeded including startup/ready'){
    const r={status:'window_expired',identity,completedRoots:reports.length,accepted:accepted.length,output};atomicJson(join(output,'summary.json'),r);return r;
   }throw e;
  }
  const rows=(phase:string)=>worlds[phase].map((w:any)=>{
   const A=completed.get(w.worldId+':A')?.value,B=completed.get(w.worldId+':B')?.value;
   if(!A?.complete||!B?.complete||A.initialWorldSHA256!==B.initialWorldSHA256)throw Error('incomplete/unpaired strong worlds');
   return{worldId:w.worldId,A,B};
  });
  const primary=rows('primary'),secondary=rows('secondary');
  const foreign=new Set(excludedFamilies(config.sourceIndexRef,card.split)),futures=[...new Set([...primary,...secondary].flatMap((r:any)=>[...r.A.futureFamilies,...r.B.futureFamilies]))]as string[];
  if(futures.some(f=>foreign.has(f)))lineageValid=false;
  if(lineageValid)bindFamilies(config.sourceIndexRef,futures,card.split,'teacher:'+root.rootId);
  const statsInput=join(directory,'stats-input.json'),statsPath=join(directory,'stats.json');
  atomicJson(statsInput,{primary,secondary,primarySeed:deriveSeed('review6-2-strong-bootstrap-v2',2026102904,0,'primary:'+root.observedBefore.observationSHA256),secondarySeed:deriveSeed('review6-2-strong-bootstrap-v2',2026102904,0,'secondary:'+root.observedBefore.observationSHA256),expectedPrimaryWorlds:256});
  if(!existsSync(statsPath)){
   const p=spawnSync(config.pythonPath,[resolve(ROOT,'lab/review6/paired_stats.py'),'teacher','--input',statsInput,'--output',statsPath],{cwd:ROOT,encoding:'utf8',timeout:120000,env:{...process.env,OMP_NUM_THREADS:'2',PYTHONDONTWRITEBYTECODE:'1'}});
   if(p.status!==0)throw Error('strong bootstrap failed: '+p.stderr);
  }
  const stats=json(statsPath);if(stats.inputSHA256!==fileHash(statsInput))throw Error('strong statistics input changed');
  const binding={...stats,worldSeedRule:'public-observation-only-v2',rootKey:key,observationSHA256:root.observedBefore.observationSHA256,preferredActionId:card.preferredActionId,otherActionId:card.otherActionId,inputRef:statsInput,registrySHA256:fileHash(config.registryPath),lineageValid};
  atomicJson(statsPath,binding);
  const strong={...card,labelId:card.labelId+':strong',sourceKind:'rollout',proposalSourceKind:card.sourceKind,evidenceTier:'strong',statisticsRef:statsPath,statisticsSHA256:fileHash(statsPath),simulationWorlds:384};
  const report={identity,rootId:root.rootId,accepted:stats.supported===true&&lineageValid,lineageValid,primaryLower:stats.primary?.columns.d.quantiles[0]??null,secondaryLower:stats.secondary?.columns.d.quantiles[0]??null,card:strong,actualCompleteBranchMatches:completed.size};
  atomicJson(finalPath,report);reports.push(report);if(report.accepted)accepted.push(strong);
  atomicJson(join(output,'summary.json'),{status:'in_progress',completedRoots:reports.length,accepted:accepted.length,reports});
 }
 writeFileSync(join(output,'strong-cards.jsonl'),accepted.map(c=>JSON.stringify(c)).join('\n')+(accepted.length?'\n':''));
 const result={status:'completed',identity,completedRoots:reports.length,accepted:accepted.length,rejected:admitted.rejected,reports,output};atomicJson(join(output,'summary.json'),result);return result;
}
