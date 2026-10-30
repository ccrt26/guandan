/** Two prelocked development pairs, original actor versus frozen P6 actor. */
import{existsSync,mkdirSync,readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';
import{deriveSeed}from'@gd/ai';import{createMatch,startGame,DEFAULT_RULES}from'@gd/engine';
import{indexedDealSeed}from'../review6/match-play';import{engineDealFamily}from'../review6/capability-lineage';import{resolveContinuationProfile}from'../review6/policy-registry';import{runFrozenPool}from'../review6/compute-pool.mjs';
import{HOME,json,hash,fileHash,atomicJson,readRegistry,bindFamilies,excludedFamilies}from'./protocol';import{policyForRun,scoreRoot}from'./evaluate';

export async function diagnoseDevSensitivity(config:any,output:string){
 const registry=readRegistry(config),registrySHA=fileHash(config.registryPath),candidate=policyForRun(config,'r62-p6-natural'),control=policyForRun(config,'r62-p5-continuation');
 if(candidate.policyId!=='r62-p6-natural-u400-greedy'||control.policyId!=='r62-p5-continuation-u400-greedy')throw Error('fixed400 policies required');
 const current=structuredClone(registry);current.policies.push(candidate);current.trainingPool.push(candidate.policyId);
 for(const profile of Object.values(current.profiles))profile.actingPolicyId=candidate.policyId;
 const registries:any={original:registry,current},rootsManifest=json(join(HOME,'data/dev-roots-001/manifest.json'));
 const pairs=['r62-dev-root-23','r62-dev-root-18'].map(id=>{
  const ref=rootsManifest.roots.find((r:any)=>r.rootId===id);if(!ref||fileHash(ref.rootRef)!==ref.rootSHA256)throw Error('fixed dev source changed');
  const root=json(ref.rootRef),A=scoreRoot(candidate,root),B=scoreRoot(id.endsWith('23')?control:policyForRun(config,'U0'),root);
  if(A.actionId===B.actionId)throw Error('prelocked actions no longer differ');
  if(id.endsWith('23')){const a=JSON.parse(A.actionKey),b=JSON.parse(B.actionKey);if(a.kind!=='bomb'||b.kind!=='bomb'||a.mainRank!==3||b.mainRank!==3||a.size!==5||b.size!==4)throw Error('fixed five3/four3 mismatch');}
  else if(JSON.parse(A.actionKey).kind!=='single'||B.actionKey!=='pass')throw Error('fixed single/PASS mismatch');
  if(json(config.sourceIndexRef).families[root.sourceFamilyId]?.split!=='dev')throw Error('development-only source required');
  return{rootRef:ref.rootRef,rootSHA256:ref.rootSHA256,root,A:{actionId:A.actionId,actionKey:A.actionKey},B:{actionId:B.actionId,actionKey:B.actionKey}};
 });
 const specification={seedRule:'public-dev-actor-sensitivity-v1',candidate,control,originalRegistrySHA256:registrySHA,profiles:registries,pairs:pairs.map(({root,...p})=>p),counts:{primary:32,secondary:16},physicalBranches:384,independentWorlds:96,code:fileHash(join(HOME,'dev-sensitivity.ts')),engine:fileHash(join(HOME,'../review6/teacher-engine.ts'))};
 const identity=hash(JSON.stringify(specification));mkdirSync(output,{recursive:true});const manifest=join(output,'manifest.json');
 if(existsSync(manifest)){if(json(manifest).identity!==identity)throw Error('sensitivity identity changed');}else atomicJson(manifest,{identity,...specification,scope:'dev exploration only, no labels, training or formal attempt'});
 const deadline=performance.now()+config.windowSeconds*1000,reports:any[]=[],resources:any[]=[];
 const finish=(status:string)=>{if(fileHash(config.registryPath)!==registrySHA)throw Error('production registry mutated');const r={status,identity,reports,resourceEvents:resources,measuredCPUSeconds:null,externalPaidCost:0,mainUpdates:0};atomicJson(join(output,'summary.json'),r);return r;};
 for(const pair of pairs){
  const root=pair.root,dir=join(output,root.rootId);mkdirSync(dir,{recursive:true});
  const worlds=['primary','secondary'].flatMap(profile=>Array.from({length:profile==='primary'?32:16},(_,i)=>({profile,worldId:root.rootId+':'+profile+':'+i,seed:deriveSeed('review6-2-dev-actor-sensitivity-v1',config.seed,0,root.observedBefore.observationSHA256+':'+profile+':'+i)})));
  if(new Set(worlds.map(w=>w.seed)).size!==48)throw Error('world seed collision');
  const potentials=[...new Set(worlds.flatMap(w=>Array.from({length:79},(_,i)=>engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed('review6-teacher-paired-future-deal-v1',w.seed,root.observedBefore.matchPublic.gameNo+i))).hands))))];
  const foreign=new Set(excludedFamilies(config.sourceIndexRef,'dev'));if(potentials.some(f=>foreign.has(f))){reports.push({rootId:root.rootId,status:'rejected_preflight_foreign_family',results:null});continue;}
  bindFamilies(config.sourceIndexRef,potentials,'dev','sensitivity-potential:'+root.rootId);atomicJson(join(dir,'worlds.json'),worlds);
  const tasks=worlds.flatMap(w=>['original','current'].flatMap(setting=>['A','B'].map(arm=>({id:w.worldId+':'+setting+':'+arm,mode:'branch',world:w,profile:w.profile,setting,arm,actionId:pair[arm as'A'|'B'].actionId,root,registry:registries[setting]}))));
  const expected=new Map(tasks.map(t=>[t.id,t])),journal=join(dir,'branches.jsonl'),done=new Map<string,any>();
  const validate=(t:any,v:any)=>{if(v.seed!==t.world.seed||v.forcedActionId!==t.actionId||v.firstActionKey!==pair[t.arm as'A'|'B'].actionKey||v.profileSHA256!==resolveContinuationProfile(registries[t.setting],t.profile,root.observedBefore.actor).profileSHA256||v.futureFamilies.some((f:string)=>!potentials.includes(f)))throw Error('sensitivity branch provenance changed');};
  if(existsSync(journal))for(const line of readFileSync(journal,'utf8').trim().split('\n').filter(Boolean)){const row=JSON.parse(line),t=expected.get(row.id);if(row.identity!==identity||!t||done.has(row.id))throw Error('cached sensitivity branch mismatch');validate(t,row.value);done.set(row.id,row.value);}
  const pending=tasks.filter(t=>!done.has(t.id));
  if(pending.length){
   if(performance.now()>=deadline-20000)return finish('window_expired');
   const resource=await runFrozenPool({entryPath:join(HOME,'teacher.ts'),workers:config.workers,workerData:{role:'teacher',deadlineEpochMs:Date.now()+deadline-performance.now()},tasks:pending,deadlineMonotonicMs:deadline-12000,execArgv:['--import','tsx'],onResult(t:any,m:any){
    if(m.rssBytes>config.maxProcessRSSBytes)throw Error('sensitivity memory limit');validate(t,m.value);writeFileSync(journal,JSON.stringify({identity,id:t.id,value:m.value})+'\n',{flag:'a'});done.set(t.id,m.value);
   }});resources.push({rootId:root.rootId,...resource});if(!resource.complete)return finish('window_expired');
  }
  const valid=tasks.every(t=>{const v=done.get(t.id);return v?.complete===true&&[-3,-2,-1,1,2,3].includes(v.g)&&[-1,1].includes(v.W)&&v.y===v.g+v.W;});
  const result:any={rootId:root.rootId,status:valid?'complete':'invalid_or_incomplete',actualCompleteBranches:[...done.values()].filter(v=>v.complete).length,physicalBranches:done.size,results:null};
  if(valid){result.results={};for(const profile of['primary','secondary']){
   const rows=worlds.filter(w=>w.profile===profile).map(w=>{const vals=['original:A','original:B','current:A','current:B'].map(s=>done.get(w.worldId+':'+s));if(new Set(vals.map(v=>v.initialWorldSHA256)).size!==1)throw Error('four-branch world mismatch');return{worldId:w.worldId,original:(vals[0].y-vals[1].y)/8,current:(vals[2].y-vals[3].y)/8};});
   result.results[profile]={worlds:rows.length,originalMean:rows.reduce((s,r)=>s+r.original,0)/rows.length,currentMean:rows.reduce((s,r)=>s+r.current,0)/rows.length,pairedActorSensitivityMean:rows.reduce((s,r)=>s+r.current-r.original,0)/rows.length,pairedRows:rows};
  }}reports.push(result);atomicJson(join(dir,'report.json'),result);console.log(JSON.stringify({rootId:root.rootId,status:result.status,actualCompleteBranches:result.actualCompleteBranches}));finish('in_progress');
 }
 return finish('completed');
}
