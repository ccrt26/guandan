/** Bounded weak-label exploration. This never produces strong certificates. */
import{existsSync,mkdirSync,readFileSync,writeFileSync}from'node:fs';import{join,resolve}from'node:path';
import{deriveSeed}from'@gd/ai';import{resolveContinuationProfile}from'../review6/policy-registry';
import{runFrozenPool}from'../review6/compute-pool.mjs';import{admitStrongProposals}from'./teacher';
import{HOME,ROOT,json,hash,fileHash,atomicJson,event,rootKey,readRegistry,bindFamilies,excludedFamilies}from'./protocol';

export function weakDisposition(primary:any[],secondary:any[]){
 const mean=(rows:any[],n:number)=>{
  if(rows.length!==n)throw Error('fixed32/16 exploratory worlds required');
  if(new Set(rows.map(r=>r.worldId)).size!==n)throw Error('unique exploratory worlds required');
  return rows.reduce((sum,r)=>{
   if(r.A?.complete!==true||r.B?.complete!==true||!r.A.initialWorldSHA256||r.A.initialWorldSHA256!==r.B.initialWorldSHA256)throw Error('complete paired information worlds required');
   for(const v of[r.A,r.B])if(![-3,-2,-1,1,2,3].includes(v.g)||![-1,1].includes(v.W)||v.y!==v.g+v.W||!Number.isFinite(v.y))throw Error('complete original g+W required');
   return sum+(r.A.y-r.B.y)/8;
  },0)/n;
 };
 const primaryMean=mean(primary,32),secondaryMean=mean(secondary,16);
 return{accepted:primaryMean>.01&&secondaryMean>.01,primaryMean,secondaryMean,threshold:.01,claim:'exploratory mean filter only; not confidence support or strategic correctness'};
}

export async function exploreWeak(config:any,input:string,output:string){
 // Reuse the existing public/legal/conflict/one-pair admission, not its strong
 // statistics path. Raw inputs must all be unverified weak suggestions.
 const raw=readFileSync(input,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
 if(raw.some(c=>c.evidenceTier!=='weak'||c.split!=='train'))throw Error('weak exploration takes training weak proposals only');
 const admission=admitStrongProposals(raw,json(config.sourceIndexRef)),cards=admission.cards,registry=readRegistry(config);
 const identity=hash(JSON.stringify({input:fileHash(input),registry:fileHash(config.registryPath),counts:[32,16],threshold:.01,seedRule:'public-observation-weak-exploration-v1',code:['weak-exploration.ts','teacher.ts'].map(p=>fileHash(join(HOME,p))),engine:fileHash(resolve(ROOT,'lab/review6/teacher-engine.ts'))}));
 mkdirSync(output,{recursive:true});const manifestPath=join(output,'manifest.json');
 if(existsSync(manifestPath)){if(json(manifestPath).identity!==identity)throw Error('weak exploration identity changed');}
 else atomicJson(manifestPath,{identity,input,inputSHA256:fileHash(input),counts:{primary:32,secondary:16},threshold:.01,admitted:cards.map(c=>c.labelId),rejected:admission.rejected,scope:'weak exploration, no strong or formal claim'});
 const deadline=performance.now()+config.windowSeconds*1000,reports:any[]=[],accepted:any[]=[];
 const finish=(status:string)=>{const r={status,identity,completedRoots:reports.length,accepted:accepted.length,reports,output};atomicJson(join(output,'summary.json'),r);return r;};
 for(const card of cards){
  if(fileHash(card.rootRef)!==card.rootSHA256)throw Error('weak root changed');
  const root=json(card.rootRef),key=rootKey(root),directory=join(output,key);mkdirSync(directory,{recursive:true});
  const finalPath=join(directory,'root-report.json'),journal=join(directory,'branches.jsonl'),completed=new Map<string,any>();
  const worlds:any={},seeds=new Set<number>();
  for(const[phase,n]of[['primary',32],['secondary',16]]as const)worlds[phase]=Array.from({length:n},(_,index)=>{
   const seed=deriveSeed('review6-2-weak-exploration-world-v1',2026102905,0,phase+':'+index+':'+root.observedBefore.observationSHA256);
   if(seeds.has(seed))throw Error('weak world seed collision');seeds.add(seed);return{worldId:key+':'+phase+':'+index,seed,index};
  });
  atomicJson(join(directory,'worlds.json'),worlds);
  const allTasks=['primary','secondary'].flatMap(phase=>worlds[phase].flatMap((world:any)=>['A','B'].map(arm=>({id:world.worldId+':'+arm,mode:'branch',world,profile:phase,arm,actionId:arm==='A'?card.preferredActionId:card.otherActionId}))));
  const expected=new Map(allTasks.map(t=>[t.id,t]));
  if(existsSync(journal))for(const line of readFileSync(journal,'utf8').trim().split('\n').filter(Boolean)){
   const row=JSON.parse(line),t=expected.get(row.id);
   if(row.identity!==identity||!t||row.phase!==t.profile||row.arm!==t.arm||row.worldId!==t.world.worldId||row.seed!==t.world.seed||row.value.seed!==t.world.seed||row.value.forcedActionId!==t.actionId||row.value.profileSHA256!==resolveContinuationProfile(registry,t.profile as any,root.observedBefore.actor).profileSHA256)throw Error('cached weak branch identity changed');
   if(completed.get(row.id)?.value.complete)throw Error('duplicate complete weak branch');completed.set(row.id,row);
  }
  const rows=(phase:string)=>worlds[phase].map((w:any)=>({worldId:w.worldId,A:completed.get(w.worldId+':A')?.value,B:completed.get(w.worldId+':B')?.value}));
  let resource:any=null,expired=false;
  try{
   const tasks=allTasks.filter(t=>!completed.get(t.id)?.value.complete);
   if(tasks.length){
    if(performance.now()>=deadline-20000){expired=true;return finish('window_expired');}
    resource=await runFrozenPool({entryPath:join(HOME,'teacher.ts'),workers:config.workers,workerData:{role:'teacher',root,registry,deadlineEpochMs:Date.now()+deadline-performance.now()},tasks,deadlineMonotonicMs:deadline-12000,execArgv:['--import','tsx'],onResult(task:any,m:any){
     if(m.rssBytes>config.maxProcessRSSBytes)throw Error('weak exploration memory limit');
     if(m.value.seed!==task.world.seed||m.value.forcedActionId!==task.actionId||m.value.profileSHA256!==resolveContinuationProfile(registry,task.profile,root.observedBefore.actor).profileSHA256)throw Error('weak worker branch identity changed');
     const row={id:task.id,worldId:task.world.worldId,phase:task.profile,arm:task.arm,seed:task.world.seed,value:m.value,identity};writeFileSync(journal,JSON.stringify(row)+'\n',{flag:'a'});completed.set(task.id,row);
    }});expired=!resource.complete;
   }
  }catch(e){if((e as Error).message==='compute pool deadline exceeded including startup/ready'&&performance.now()>=deadline-13000)expired=true;else throw e;}
  finally{
   // Reserve even observed prefixes of incomplete branches, without using them
   // as outcomes. One controller merges one root at a time.
   const futures=[...new Set([...completed.values()].flatMap(r=>r.value.futureFamilies??[]))]as string[];
   const foreign=new Set(excludedFamilies(config.sourceIndexRef,'train'));if(futures.some(f=>foreign.has(f)))throw Error('weak exploration future family split collision');
   if(futures.length)bindFamilies(config.sourceIndexRef,futures,'train','weak-exploration:'+root.rootId);
   event(output,{kind:'weak_resource_window',identity,rootKey:key,resource,expired});
  }
  if(expired)return finish('window_expired');
  const decision=weakDisposition(rows('primary'),rows('secondary'));
  const weak={...card,labelId:card.labelId+':exploratory',sourceKind:'rollout',proposalSourceKind:card.sourceKind,evidenceTier:'weak',simulationWorlds:48,explorationRef:finalPath,claim:'prelocked preference retained by32/16 exploratory means; not strong evidence or proven correctness'};
  const report={identity,rootId:root.rootId,...decision,actualCompleteBranchMatches:completed.size,card:weak};
  if(existsSync(finalPath)&&JSON.stringify(json(finalPath))!==JSON.stringify(report))throw Error('cached weak root report changed');
  atomicJson(finalPath,report);reports.push(report);if(decision.accepted)accepted.push(weak);
  console.log(JSON.stringify({stage:'weak-exploration',rootId:root.rootId,...decision,completedRoots:reports.length,requiredRoots:cards.length}));finish('in_progress');
 }
 writeFileSync(join(output,'weak-cards.jsonl'),accepted.map(c=>JSON.stringify(c)).join('\n')+(accepted.length?'\n':''));return finish('completed');
}
