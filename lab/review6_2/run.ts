import {existsSync,readFileSync,mkdirSync,statfsSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {totalmem,freemem} from 'node:os';
import {isMainThread} from 'node:worker_threads';
import {spawnSync} from 'node:child_process';
import {spawnOwnedSync} from '../review6/owned-process-runner.mjs';
import {guardOwnedWindow} from '../review6/owned-window.mjs';
import {HOME,ROOT,PROTOCOL,json,atomicJson,fileHash,readRegistry,runDirectory,readCheckpoint,codeIdentity} from './protocol';
import {runTraining} from './train';
import {collectRoots,importCards,verifyTeachingCards} from './teacher';
import {evaluateDevelopment,policyForRun} from './evaluate';
import{evaluateJ}from'./j-evaluate';
import{constructTeaching}from'./constructed';
import{acquireSourceWriter}from'./writer-lock';
import{exploreWeak}from'./weak-exploration';
import{freezeCandidate,confirmationReady,runConfirmation,prepareFormalQueue}from'./confirmation';
import{collectTerminalSources}from'./terminal-source';
import{diagnoseDevSensitivity}from'./dev-sensitivity';
import{certifyTerminalRoot}from'./teaching-evidence';
import{certifyDeclaredResource}from'./declared-proof';
import{constructResourceCoverage}from'./resource-coverage';
import{constructSealedCondition}from'./sealed-condition';
import{extractSealedAParent}from'./sealed-parent';
import{diagnoseM1Regression}from'./diagnose-m1-regression';
import{buildAnchorCoverage}from'./anchor-coverage';

function args(argv:string[]){
 const command=argv.shift(),options:any={};
 while(argv.length){const key=argv.shift()!;if(!key.startsWith('--'))throw Error('expected --option');options[key.slice(2)]=argv.length&&!argv[0].startsWith('--')?argv.shift():true;}
 return{command,options};
}
export function setupConfig(){
 const path=join(HOME,'config.json');if(existsSync(path))return json(path);
 mkdirSync(join(HOME,'data'),{recursive:true});
 const fixture:any[]=[];
 for(const n of ['03','05','06','20']){
  const p=resolve(ROOT,`lab/review6_1/teacher-pilot-001/root-results/root-${n}/teacher-label.json`),label=json(p),s=json(resolve(ROOT,`lab/review6_1/teacher-pilot-001/root-results/root-${n}/stats-result.json`));
  if(s.supported!==true||label.targetScope!=='root_action_only')throw Error('legacy fixture not supported');
  fixture.push({labelId:label.rootId,rootKey:label.rootId,sourceFamilyId:label.sourceFamilyId,split:'train',scope:'fixture_only',evidenceTier:'strong',weight:1,plus:[label.inputPlus399],minus:[label.inputMinus399],sourceRef:p,sourceSHA256:fileHash(p),creditAsNewRoot:false});
 }
 atomicJson(join(HOME,'data/smoke-fixture.json'),fixture);atomicJson(join(HOME,'data/empty-labels.json'),[]);
 const index:any={version:1,families:{}},collect=(v:any)=>{
  if(typeof v==='string'&&v.startsWith('first-deal-family:'))index.families[v]={split:'historical',firstSource:'existing-consumed-or-reserved-metadata'};
  else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.values(v).forEach(collect);
 };
 // Metadata only: never read sealed question contents or scored outcomes.
 for(const p of ['lab/review6_1/data/consumed-source-ancestry-001.json','lab/review6_1/mature-pilot-004/execution-snapshot-001/inputs/mature-spec.json','lab/review6_1/capability/c2-draft-001/base-lineage-reservation-001.json'])if(existsSync(resolve(ROOT,p)))collect(json(resolve(ROOT,p)));
 atomicJson(join(HOME,'data/source-index.json'),index);
 const memoryQuery=process.platform==='darwin'?spawnSync('/usr/bin/memory_pressure',['-Q'],{encoding:'utf8',timeout:5000}):null;
 const availablePercent=memoryQuery?.status===0?Number(/System-wide memory free percentage:\s*(\d+)%/.exec(memoryQuery.stdout)?.[1]):null;
 const availableBytes=availablePercent?totalmem()*availablePercent/100:freemem();
 const disk=statfsSync(HOME),config={protocolId:PROTOCOL,seed:2026102901,workers:4,windowSeconds:14400,checkpointEveryUpdates:10,
  pythonPath:resolve(ROOT,'lab/.venv/bin/python'),registryPath:resolve(ROOT,'lab/review6_1/data/no-H-policy-registry-001.json'),sourceIndexRef:join(HOME,'data/source-index.json'),teacherSetRef:join(HOME,'data/empty-labels.json'),
  maxProcessRSSBytes:Math.floor(Math.min(totalmem()*.65,availableBytes*.7)),minimumFreeDiskBytes:512*1024*1024,hardwareMeasurement:{totalMemoryBytes:totalmem(),freeMemoryBytes:freemem(),availableMemoryBytes:availableBytes,availablePercent,memorySource:availablePercent?'memory_pressure -Q (reclaimable memory included)':'os.freemem',freeDiskBytes:Number(disk.bavail)*Number(disk.bsize)},
  hardTotalResourceHours:null,externalPaidAPICalls:0,authorization:'2026-10-29 user adopted reviewed plan; substantial departures require discussion'};
 readRegistry(config);atomicJson(path,config);return config;
}

export async function main(argv=process.argv.slice(2)){
 const{command,options}=args([...argv]);
 if(command==='setup'){console.log(JSON.stringify(setupConfig()));return;}
 if(command==='status'){
  const directory=runDirectory(options.run),manifest=json(join(directory,'manifest.json'));
  const cp=existsSync(join(directory,'latest.json'))?readCheckpoint(directory):null;
  const compatible=manifest.codeIdentity===codeIdentity(),eventsPath=join(directory,'events.jsonl'),lastDevelopment=existsSync(eventsPath)?readFileSync(eventsPath,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)).filter(e=>e.kind==='development').at(-1):null;
  console.log(JSON.stringify({runId:options.run,arm:manifest.arm,update:cp?.state.absoluteUpdate??0,checkpoint:cp?.path??null,summary:existsSync(join(directory,'summary.json'))?json(join(directory,'summary.json')):null,lastDevelopment,runtimeCompatible:compatible,resumeCommand:compatible?`node --import tsx lab/review6_2/run.ts resume --run ${options.run} --updates ${Math.max(100,(cp?.state.absoluteUpdate??0)+100)}`:null,resumeUnavailableReason:compatible?null:'runtime changed; preserve run and use reviewed new-version continuation, see progress.md'}));return;
 }
 if(!['train','resume','collect-roots','collect-terminal-source','extract-sealed-parent','build-anchor-coverage','certify-terminal-proof','certify-declared-proof','construct-resource-coverage','construct-sealed-condition','diagnose-dev-sensitivity','diagnose-m1-regression','teach','verify-teaching','weak-explore','evaluate-dev','evaluate-j','construct-teaching','lock-candidate','ready','confirm','prepare-match-queue'].includes(command!))throw Error('unknown review6.2 command');
 let config=command==='resume'?json(join(runDirectory(options.run),'manifest.json')).config:options['from-run']?{...json(join(runDirectory(options['from-run']),'manifest.json')).config,...(options.config?json(resolve(options.config)):{}),fromRun:options['from-run']}:json(resolve(options.config??join(HOME,'config.json')));
 config={...config,runId:options.run,arm:options.arm??config.arm,updateTarget:Number(options.updates??100),smoke:options.smoke===true||config.smoke===true};
 if(options['teacher-set'])config.teacherSetRef=resolve(options['teacher-set']);
 if(options.seed)config.seed=Number(options.seed);
 if(options['source-run']){if(command!=='collect-roots'||(options.split??'train')!=='train')throw Error('source-run only prepares training roots');config.rootSourcePolicy=policyForRun(config,options['source-run']);}
 if(options.midgame){if(command!=='collect-roots'||(options.split??'train')!=='train')throw Error('midgame stage is training-only');config.rootPublicStage={minOwnCards:8,maxOwnCards:20,minMoveNo:20};}
 if(!options['owned-child']){
  const env={...process.env,NODE_DEBUG:'',PYTHONDONTWRITEBYTECODE:'1'};
  let childArgs=[...argv,'--owned-child'];
  for(;;){
   const cleanupPath=['train','resume'].includes(command!)?join(runDirectory(config.runId),'cleanup-last.json'):join(HOME,'receipts',command+'-cleanup-'+Date.now()+'.json');
   let result;
   try{result=spawnOwnedSync(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),...childArgs],{cwd:ROOT,env,stdio:'inherit',timeout:(config.windowSeconds+30)*1000,killSignal:'SIGTERM'});}
   catch(e){if((e as any).ownedGroupCleanupUnconfirmed)atomicJson(cleanupPath,{status:'owned_cleanup_unconfirmed',pgid:(e as any).ownedPID,childExitStatus:(e as any).childResult?.status,reason:(e as Error).message,action:'confirm/clean only this owned group; preserve committed data and do not rerun completed work'});throw e;}
   atomicJson(cleanupPath,result.cleanup);
   if(result.result.status!==0){process.exitCode=result.result.status??1;return;}
   if(['verify-teaching','weak-explore','evaluate-j','evaluate-dev','confirm','prepare-match-queue','collect-terminal-source','diagnose-dev-sensitivity'].includes(command!)){
    const out=['verify-teaching','weak-explore','prepare-match-queue','collect-terminal-source','diagnose-dev-sensitivity'].includes(command!)?resolve(options.out):command==='confirm'?join(HOME,'confirmation','attempt-'+Number(options.attempt)):join(HOME,command==='evaluate-j'?'development-J':'development',policyForRun(config,options.run).policyId+'-'+Number(options.blocks??32)+'blocks');
    if(json(join(out,'summary.json')).status==='window_expired')continue;
    return;
   }
   if(!['train','resume'].includes(command!))return;
   const summary=json(join(runDirectory(config.runId),'summary.json'));
   if(summary.status!=='window_expired')return;
   childArgs=['resume','--run',config.runId,'--updates',String(config.updateTarget),'--owned-child'];
  }
 }
 guardOwnedWindow(process.ppid,performance.now()+(config.windowSeconds+15)*1000);
 config.sourceIndexRef=realpathSync(config.sourceIndexRef);
 const releaseWriter=acquireSourceWriter(config.sourceIndexRef);
 try{
 const disk=statfsSync(HOME);if(Number(disk.bavail)*Number(disk.bsize)<config.minimumFreeDiskBytes)throw Error('insufficient disk space');
 if(command==='lock-candidate'){console.log(JSON.stringify(freezeCandidate(config,options.run,options.checkpoint)));return;}
 if(command==='prepare-match-queue'){console.log(JSON.stringify(prepareFormalQueue(config,resolve(options.skills),resolve(options.severe),Number(options.attempt),resolve(options.out))));return;}
 if(command==='ready'){const r=confirmationReady(config,resolve(options.candidate),resolve(options.skills),resolve(options.severe),options['match-queue']?resolve(options['match-queue']):undefined);console.log(JSON.stringify({ready:r.ready,reasons:r.reasons,counts:r.counts}));return;}
 if(command==='confirm'){console.log(JSON.stringify(await runConfirmation(config,resolve(options.candidate),resolve(options.skills),resolve(options.severe),Number(options.attempt),resolve(options['match-queue']))));return;}
 if(command==='collect-roots'){const r=await collectRoots(config,options.split??'train',resolve(options.out),Number(options.limit??16),Number(options.offset??0),Number(options['max-attempts']??48));console.log(JSON.stringify({output:resolve(options.out),roots:r.roots.length,sources:r.sources.length}));return;}
 if(command==='collect-terminal-source'){const r=await collectTerminalSources(config,resolve(options.out),Number(options.limit??1),Number(options['max-sources']??16),Number(options.offset??0),options.split??'train');console.log(JSON.stringify(r));return;}
 if(command==='certify-terminal-proof'){console.log(JSON.stringify(certifyTerminalRoot(resolve(options['root-dir']),resolve(options.out),config.sourceIndexRef)));return;}
 if(command==='certify-declared-proof'){console.log(JSON.stringify(certifyDeclaredResource(resolve(options['source-dir']),resolve(options.out),config.sourceIndexRef)));return;}
 if(command==='construct-resource-coverage'){const r=constructResourceCoverage(config,resolve(options.parents),resolve(options.out));console.log(JSON.stringify({status:r.status,output:resolve(options.out),familiesAttempted:r.familiesAttempted,acceptedNewFamilies:r.acceptedNewFamilies,newStrongRoots:r.newStrongRoots,actuallyNovelRootVectors:r.actuallyNovelRootVectors,windowWallSeconds:r.windowWallSeconds,measuredCPUSeconds:r.measuredCPUSeconds}));return;}
 if(command==='construct-sealed-condition'){const r=constructSealedCondition(config,resolve(options.parents),resolve(options.out));console.log(JSON.stringify({...r,results:undefined,output:resolve(options.out)}));return;}
 if(command==='extract-sealed-parent'){console.log(JSON.stringify(extractSealedAParent(config,resolve(options.sources),resolve(options.out))));return;}
 if(command==='diagnose-m1-regression'){console.log(JSON.stringify(diagnoseM1Regression(config,resolve(options.out))));return;}
 if(command==='build-anchor-coverage'){const r=buildAnchorCoverage(config,resolve(options.out));console.log(JSON.stringify({...r,records:undefined,output:resolve(options.out)}));return;}
 if(command==='diagnose-dev-sensitivity'){console.log(JSON.stringify(await diagnoseDevSensitivity(config,resolve(options.out))));return;}
 if(command==='construct-teaching'){console.log(JSON.stringify(constructTeaching(config,resolve(options.out),options.kind,Number(options['max-search']??10000),Number(options.offset??0))));return;}
 if(command==='teach'){
  const cards=readFileSync(resolve(options.input),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
  if(options.tier&&cards.some(c=>c.evidenceTier!==options.tier))throw Error('requested tier differs from card evidence');
  const r=importCards(config,resolve(options.input),resolve(options.out));console.log(JSON.stringify({acceptedRoots:r.labels.length,rejected:r.rejected.length,output:resolve(options.out)}));return;
 }
 if(command==='evaluate-dev'){console.log(JSON.stringify(await evaluateDevelopment(config,options.run,Number(options.blocks??32))));return;}
 if(command==='evaluate-j'){const policy=policyForRun(config,options.run);console.log(JSON.stringify(await evaluateJ(config,policy,join(HOME,'development-J',policy.policyId+'-'+Number(options.blocks??32)+'blocks'),Number(options.blocks??32))));return;}
 if(command==='verify-teaching'){const r=await verifyTeachingCards(config,resolve(options.input),resolve(options.out));console.log(JSON.stringify({status:r.status,completedRoots:r.completedRoots,accepted:r.accepted,output:r.output}));return;}
 if(command==='weak-explore'){const r=await exploreWeak(config,resolve(options.input),resolve(options.out));console.log(JSON.stringify({status:r.status,completedRoots:r.completedRoots,accepted:r.accepted,output:r.output}));return;}
 console.log(JSON.stringify(await runTraining(config,command==='resume')));
 }finally{releaseWriter();}
}
if(isMainThread&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.stack);process.exitCode=1;});
