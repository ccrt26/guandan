import {isMainThread,parentPort,workerData,threadId} from 'node:worker_threads';
import {readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createMatch,startGame,DEFAULT_RULES} from '@gd/engine';
import {deriveSeed} from '@gd/ai';
import {sampleCurrentMatch} from '../review6/mature-match';
import {MatureQueues} from '../review6/mature-queues';
import {NO_H_QUOTAS,type NoHBucket} from '../review6/training-samples';
import {engineDealFamily} from '../review6/capability-lineage';
import {indexedDealSeed} from '../review6/match-play';
import {runFrozenPool} from '../review6/compute-pool.mjs';
import {startPythonRPC} from '../review6/python-rpc.mjs';
import {ROOT,HOME,PROTOCOL,json,hash,fileHash,atomicJson,event,readRegistry,assertTrainingLabels,codeIdentity,commitCheckpoint,readCheckpoint,runDirectory,excludedFamilies,bindFamilies,checkExecutionPolicy,assertCompleteSamplingWave} from './protocol';
import{assertBoundContinuationInputs,continuationUpgrade,continuationPartnerReplacement,assertRuntimeMigration}from'./curriculum';
import{scheduledTeacherIds}from'./teacher-schedule';
import{continuationAnchorReplacement}from'./anchor-coverage';

if(!isMainThread){
 parentPort!.postMessage({kind:'ready',threadId});
 parentPort!.on('message',m=>{
  if(m.kind==='stop'){process.exit(0);return;}
  if(m.kind!=='task')return;const begin=performance.now();
  try{
   const value=sampleCurrentMatch({...m.task.options,deadlineMonotonicMs:performance.now()+Math.max(0,workerData.deadlineEpochMs-Date.now())});
   parentPort!.postMessage({kind:'result',taskId:m.task.id,value,threadId,rssBytes:process.memoryUsage().rss,activeSeconds:(performance.now()-begin)/1000});
  }catch(e){parentPort!.postMessage({kind:'error',taskId:m.task.id,error:(e as Error).stack});}
 });
}

export function sourceSpec(config:any,bucket:string,ordinal:number,split='train'){
 const seed=deriveSeed('review6-2-source-v1',config.seed,ordinal,split+':'+bucket);
 const dealNamespace='review6-2-'+split+'-'+bucket+'-deals-v1';
 const firstFamilyId=engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(dealNamespace,seed,0))).hands);
 return{seed,dealNamespace,firstFamilyId};
}

export async function runTraining(config:any,resume=false){
 delete process.env.NODE_DEBUG;
 if(config.protocolId!==PROTOCOL||config.updateTarget<0||!Number.isSafeInteger(config.updateTarget)||!['A','B'].includes(config.arm))throw Error('invalid reviewed training config');
 const directory=runDirectory(config.runId),lease=join(directory,'active.json');
 if(!resume&&existsSync(join(directory,'manifest.json')))throw Error('run exists; use resume');
 if(resume&&!existsSync(join(directory,'manifest.json')))throw Error('unknown run');
 mkdirSync(directory,{recursive:true});
 if(existsSync(lease)){const old=json(lease);try{process.kill(old.pid,0);throw Error('run already active PID '+old.pid);}catch(e){if((e as any).code!=='ESRCH')throw e;unlinkSync(lease);}}
 writeFileSync(lease,JSON.stringify({pid:process.pid,at:new Date().toISOString()}),{flag:'wx'});
 const start=performance.now(),deadline=start+config.windowSeconds*1000,registry=readRegistry(config),parent=registry.policies.find((p:any)=>p.policyId===registry.cleanStudent)!;
 const policy=checkExecutionPolicy(config),labels=assertTrainingLabels(json(config.teacherSetRef),config.smoke===true,json(config.sourceIndexRef));
 assertBoundContinuationInputs(config);
 if(config.teacherSchedule)scheduledTeacherIds(labels,config.teacherSchedule.fromUpdate+1,config.teacherSchedule);
 if(config.arm==='B'&&!labels.length)throw Error('B requires nonempty legal teacher set');
 const identity=hash(JSON.stringify({protocol:PROTOCOL,seed:config.seed,arm:config.arm,parent,labelsSHA256:fileHash(config.teacherSetRef),registrySHA256:fileHash(config.registryPath),code:codeIdentity(),policy,smoke:config.smoke===true,...(config.learningRate===undefined?{}:{learningRate:config.learningRate}),...(config.preferenceMode===undefined?{}:{preferenceMode:config.preferenceMode}),...(config.teacherSchedule?{teacherSchedule:config.teacherSchedule}:{}),...(config.anchorSetRef?{anchorSetSHA256:fileHash(config.anchorSetRef)}:{})}));
 let queues=new MatureQueues(),cursors:any={self:0,frozen_opponent:0,other_partner:0},update=0,current={...parent,policyId:`review6-2-current-${config.seed}-u0`,epsilon:.05},anchors:any[]=[],restore:any=null,sourceMatches=0;
 let rpc:any=null,workerSeconds=0,sourceWallSeconds=0,learnerWallSeconds=0,transactionInFlight=false;
 const sourcePartners=new Map<string,string>();
 if(resume){
  const manifest=json(join(directory,'manifest.json'));if(manifest.identity!==identity)throw Error('resume configuration/source identity changed');
  restore=readCheckpoint(directory);const state=restore.state;
  if(state.identity!==identity)throw Error('checkpoint source identity changed');
  queues=MatureQueues.restore(state.queues);cursors=state.cursors;update=state.absoluteUpdate;
  current={...state.current,weightsPath:join(restore.path,'weights.f32')};sourceMatches=state.sourceMatches;
  anchors=json(join(directory,'anchors.json'));
  if(state.anchorsSHA256!==fileHash(join(directory,'anchors.json')))throw Error('checkpoint anchor content changed');
  event(directory,{kind:'resume',update,recoveredFrom:restore.recoveredFrom});
 }else{
  let upstream:any=null;
  if(config.fromRun){
   if(config.fromRun===config.runId)throw Error('new runtime continuation needs a new run');
   const source=runDirectory(config.fromRun),old=json(join(source,'manifest.json'));
   restore=readCheckpoint(source);const state=restore.state;
   const curriculum=continuationUpgrade(config,old,restore.path,state),partners=continuationPartnerReplacement(config,old,restore.path,state),anchorReplacement=continuationAnchorReplacement(config,old,restore.path,state),oldTeacherSHA256=curriculum?.oldTeacherSHA256??fileHash(config.teacherSetRef);let runtimeMigration:any=null;
   const expected=hash(JSON.stringify({protocol:PROTOCOL,seed:config.seed,arm:config.arm,parent,labelsSHA256:oldTeacherSHA256,registrySHA256:partners?.oldRegistrySHA256??fileHash(config.registryPath),code:old.codeIdentity,policy,smoke:config.smoke===true,...(config.learningRate===undefined?{}:{learningRate:config.learningRate}),...(config.preferenceMode===undefined?{}:{preferenceMode:config.preferenceMode}),...(old.config.teacherSchedule?{teacherSchedule:old.config.teacherSchedule}:{}),...(old.config.anchorSetRef?{anchorSetSHA256:old.config.anchorSetSHA256}:{})}));
   if(old.identity!==expected||state.identity!==old.identity||old.scope!==(config.smoke?'fixture_only':'main_training')||state.teacherSetSHA256!==oldTeacherSHA256)throw Error('upstream training semantics/scope changed');
   if(old.codeIdentity!==codeIdentity()){
    if(config.runtimeMigrationRef)runtimeMigration=assertRuntimeMigration(config,old.codeIdentity);
    else{
    const allowed=json(join(HOME,'versions/runtime-v1/record.json'));
    if(old.codeIdentity!==allowed.codeIdentity||allowed.semantics.some((r:any)=>fileHash(resolve(ROOT,r.path))!==r.sha256))throw Error('unreviewed runtime continuation/changed training semantics');
    }
   }
   if(state.anchorsSHA256!==fileHash(join(source,'anchors.json')))throw Error('upstream anchor content changed');
   copyFileSync(anchorReplacement?.newRef??join(source,'anchors.json'),join(directory,'anchors.json'));
   anchors=json(join(directory,'anchors.json'));queues=MatureQueues.restore(state.queues);cursors=state.cursors;update=state.absoluteUpdate;sourceMatches=state.sourceMatches;
   current={...state.current,weightsPath:join(restore.path,'weights.f32')};
   upstream={runId:config.fromRun,checkpoint:restore.path,checkpointManifestSHA256:fileHash(join(restore.path,'manifest.json')),manifestSHA256:fileHash(join(source,'manifest.json')),identity:old.identity,absoluteUpdate:update,...(curriculum?{curriculum}:{}),...(partners?{partnerReplacement:partners}:{}),...(runtimeMigration?{runtimeMigration}:{}),...(anchorReplacement?{anchorReplacement}:{})};
   event(directory,{kind:curriculum?'curriculum_continuation':'new_runtime_continuation',upstream,resetTrainingState:false});
  }
  atomicJson(join(directory,'manifest.json'),{protocolId:PROTOCOL,runId:config.runId,arm:config.arm,seed:config.seed,identity,config,codeIdentity:codeIdentity(),parent,upstream,createdAt:new Date().toISOString(),scope:config.smoke?'fixture_only':'main_training',targets:'complete own-round g + final-match W'});
 }
 const pool=async(tasks:any[])=>{
  const rows:any[]=[],resource=await runFrozenPool({entryPath:resolve(HOME,'train.ts'),workers:config.workers,workerData:{deadlineEpochMs:Date.now()+deadline-performance.now()},tasks,deadlineMonotonicMs:deadline-12000,execArgv:['--import','tsx'],onResult(task:any,message:any){
   if(message.rssBytes>config.maxProcessRSSBytes)throw Error('training memory limit exceeded');
   rows.push({task,value:message.value});
  }});
  workerSeconds+=resource.workerTaskSeconds;sourceWallSeconds+=resource.deviceWallSeconds;
  assertCompleteSamplingWave(resource,deadline-12000);
  rows.sort((a,b)=>a.task.ordinal-b.task.ordinal);
  for(const row of rows){
   if(!row.value.result.complete)throw Error('incomplete match: '+row.value.result.incompleteReason);
   bindFamilies(config.sourceIndexRef,row.value.roundBaseFamilies.map((r:any)=>r.familyId),'train',row.task.id);
   if(row.value.bucket==='other_partner'){sourcePartners.set(row.value.matchId,row.value.otherPartnerPolicyId);event(directory,{kind:'other_partner_source',matchId:row.value.matchId,otherPartnerPolicyId:row.value.otherPartnerPolicyId,policyIds:row.value.policyIds,currentSeats:row.value.currentSeats,currentDecisionsSeen:row.value.currentDecisionsSeen,traceSHA256:row.value.result.traceSHA256,complete:true});}
  }
  return rows;
 };
 const task=(bucket:NoHBucket,ordinal:number,anchorLimit=0)=>{
  const source=sourceSpec(config,anchorLimit?'anchor':bucket,ordinal);
  bindFamilies(config.sourceIndexRef,[source.firstFamilyId],'train',`seed:${config.seed}:${bucket}:${ordinal}`);
  const matchId=`${config.runId}:${anchorLimit?'anchor':bucket}:${ordinal}`;
  return{id:matchId,ordinal,options:{...source,matchId,bucket,registry,current,opponentPolicyId:registry.oldCompletePolicy,actor:ordinal%4,otherOrdinal:ordinal,excludedFamilyIds:excludedFamilies(config.sourceIndexRef,'train'),anchorLimit}};
 };
 const checkpoint=async()=>{
  const state={identity,absoluteUpdate:update,queues:queues.snapshot(),cursors,current,sourceMatches,pendingTasks:[],randomness:'counter-derived from seed, source cursor, absolute update; no wallclock RNG',teacherSetSHA256:fileHash(config.teacherSetRef),anchorsSHA256:fileHash(join(directory,'anchors.json'))};
  const path=await commitCheckpoint(directory,update,state,async p=>{
   const saved=await rpc.request({kind:'save',path:join(p,'learner.pt'),weightsPath:join(p,'weights.f32')});
   if(saved.update!==update)throw Error('learner checkpoint update mismatch');
  });
  event(directory,{kind:'checkpoint',update,path});return path;
 };
 try{
  if(resume&&update>=config.updateTarget){const result={runId:config.runId,update,target:config.updateTarget,status:'already_at_target',checkpoint:restore.path};atomicJson(join(directory,'summary.json'),result);return result;}
  if(!resume&&!restore){
   const wave=await pool([task('self',0,64)]);anchors=wave[0].value.anchors;
   if(anchors.length!==64)throw Error('anchor source did not yield64 roots');
   atomicJson(join(directory,'anchors.json'),anchors);
  }
  rpc=startPythonRPC(config.pythonPath,[join(HOME,config.teacherSchedule||config.anchorUpgradeRef?'curriculum_learner.py':'learner.py')],{cwd:ROOT,env:{...process.env,NODE_DEBUG:'',OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2',PYTHONDONTWRITEBYTECODE:'1',R62_CURRICULUM_UPGRADE_REF:config.curriculumUpgradeRef??'',R62_CURRICULUM_UPGRADE_SHA256:config.curriculumUpgradeSHA256??'',R62_ANCHOR_UPGRADE_REF:config.anchorUpgradeRef??'',R62_ANCHOR_UPGRADE_SHA256:config.anchorUpgradeSHA256??''},deadlineMonotonicMs:deadline-5000});
  const ready=await rpc.ready();if(ready.threads!==2||ready.interop!==1)throw Error('learner CPU configuration changed');
  await rpc.request({kind:'init',parentPath:parent.weightsPath,parentSHA256:parent.weightsSHA256,arm:config.arm,seed:config.seed,anchorsPath:join(directory,'anchors.json'),labelsPath:config.teacherSetRef,identity,learningRate:config.learningRate??.001,preferenceMode:config.preferenceMode??'softplus'});
  if(restore){const r=await rpc.request({kind:'restore',path:join(restore.path,'learner.pt'),...(!resume?{expectedIdentity:restore.state.identity}:{})});if(r.update!==update)throw Error('learner restore update mismatch');if(!resume)await checkpoint();}
  else await checkpoint();
  while(update<config.updateTarget&&performance.now()<deadline-30000){
   while(!queues.ready()){
    if(performance.now()>=deadline-15000)throw Error('review6-2 normal sampling window expiry');
    const bucket=(Object.keys(NO_H_QUOTAS)as NoHBucket[]).find(b=>queues.counts()[b]<NO_H_QUOTAS[b])!;
    const tasks=Array.from({length:4},(_,i)=>task(bucket,cursors[bucket]+i+1)),wave=await pool(tasks);
    for(const row of wave){queues.appendMatch(bucket,row.task.id,row.value.mature);sourceMatches++;}
    cursors[bucket]+=4;
   }
   transactionInFlight=true;
   const next=update+1,batch=queues.consumeGroup(deriveSeed('review6-2-gradient-v1',config.seed,next,'same-paired-arm-stream'));
   const x=new Float32Array(1024*399),metadata=batch.selected.map((row:any,i:number)=>{x.set(row.features399,i*399);const{features399,...rest}=row;return{...rest,split:'train',complete:true};});
   const featuresPath=join(directory,'batch.f32'),metadataPath=join(directory,'batch.json'),weightsPath=join(directory,'working-weights.f32');
   writeFileSync(featuresPath,Buffer.from(x.buffer));atomicJson(metadataPath,metadata);
   const labelIds=config.arm==='A'?[]:scheduledTeacherIds(labels,next,config.teacherSchedule);
   const before=performance.now(),result=await rpc.request({kind:'step',update:next,featuresPath,metadataPath,labelIds,weightsPath});learnerWallSeconds+=(performance.now()-before)/1000;
   if(result.update!==next||fileHash(weightsPath)!==result.weightsSHA256)throw Error('actual updated weights mismatch');
   update=next;current={...current,policyId:`review6-2-current-${config.seed}-u${update}`,weightsPath,weightsSHA256:result.weightsSHA256};
   transactionInFlight=false;
   const otherPartnerGradientCounts:Record<string,number>={};for(const r of metadata)if(r.bucket==='other_partner'){const id=sourcePartners.get(r.matchId)??'upstream_or_prior_window_unlogged';otherPartnerGradientCounts[id]=(otherPartnerGradientCounts[id]??0)+1;}
   event(directory,{kind:'update',...result,matureConsumed:2048,gradientSlots:1024,sourceMatches,otherPartnerGradientCounts});
   if(update%config.checkpointEveryUpdates===0||update===config.updateTarget)await checkpoint();
   console.log(JSON.stringify({runId:config.runId,arm:config.arm,update,target:config.updateTarget,sourceMatches,teacherRoots:labelIds.length}));
  }
  const path=await checkpoint();await rpc.request({kind:'close'});await rpc.finish();rpc=null;
  const result={runId:config.runId,arm:config.arm,update,target:config.updateTarget,checkpoint:path,status:update===config.updateTarget?'target_reached':'window_expired',sourceMatches,metrics:{wallSeconds:(performance.now()-start)/1000,workerTaskSeconds:workerSeconds,samplingWallSeconds:sourceWallSeconds,learnerWallSeconds,externalPaidCalls:0},mainTraining:!config.smoke,playingPolicyUpdated:false};
  atomicJson(join(directory,'summary.json'),result);return result;
 }catch(e){
  const message=(e as Error).message;
  const normal=['review6-2 normal sampling window expiry','compute pool deadline exceeded including startup/ready','Python bounded protocol deadline','Python bounded protocol deadline before send'].includes(message);
  if(normal&&existsSync(join(directory,'latest.json'))){
   if(!transactionInFlight&&rpc&&performance.now()<deadline-6500)await checkpoint();
   const cp=readCheckpoint(directory);event(directory,{kind:'window_expired',uncommittedUpdate:update,committedUpdate:cp.state.absoluteUpdate,reason:message});
   const result={runId:config.runId,arm:config.arm,update:cp.state.absoluteUpdate,target:config.updateTarget,status:'window_expired',checkpoint:cp.path,mainTraining:!config.smoke,playingPolicyUpdated:false};
   atomicJson(join(directory,'summary.json'),result);return result;
  }
  event(directory,{kind:'error',message:(e as Error).stack,lastCommitted:existsSync(join(directory,'latest.json'))?json(join(directory,'latest.json')):null});throw e;
 }
 finally{if(rpc)await rpc.stop();if(existsSync(lease))unlinkSync(lease);}
}
