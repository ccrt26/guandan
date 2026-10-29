import {createReadStream,readFileSync,writeFileSync,openSync,writeSync,closeSync,mkdirSync,existsSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {applyMove,type GameResult} from '@gd/engine';
import {PublicTracker,encodeAction,remapV1WeightsToV2,migratePassEncoding,INPUT_DIM_V2,STATE_DIM_V2,FROZEN_CHAMPION_IDENTITY} from '@gd/ai';
import {buildSourceRound,inspectSourceAction,resourceEffectKey} from './data-replay';
import {streamHumanMatches} from './data-source';
import {selectHumanRows,type HumanRow} from './human-data';
import {fileHash} from './product-artifacts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const writeNew=(p:string,data:unknown)=>writeFileSync(p,JSON.stringify(data,null,2)+'\n',{flag:'wx'});

export async function prepareHumanFeatures(config:any){
 const data=config.data,out=resolve(data.humanFeatureDirectory),reportPath=resolve(data.replayDirectory,'rule-domain-report.json');
 if(existsSync(out))throw new Error('H feature output exists; refuse overwrite');
 if(fileHash(data.planLock)!==data.planLockHash||fileHash(reportPath)!==data.replayReportHash||fileHash(data.sourceLockReceipt)!==data.sourceLockReceiptHash||fileHash(data.sourcePath)!==data.sourceSHA256)throw new Error('H data source/split/plan/audit anchor mismatch');
 const report=JSON.parse(readFileSync(reportPath,'utf8')),plan=JSON.parse(readFileSync(data.planLock,'utf8'));
 if(report.completedMatches!==1305||report.totals.rawActions!==1217604||report.totals.unexplainedCandidateOmissions!==0||report.modelScoresOpened!==false)throw new Error('strict source gate incomplete');
 if(report.sourceLockReceiptHash!==data.sourceLockReceiptHash)throw new Error('H audit does not use the original split');
 const sourceLock=JSON.parse(readFileSync(data.sourceLockReceipt,'utf8'));
 for(const file of sourceLock.files)if(fileHash(file.path)!==file.sha256)throw new Error('H source/split artifact changed');
 const splitPath=sourceLock.files.find((file:any)=>file.path.endsWith('split.lock.json')).path;
 const splitRows=new Map(JSON.parse(readFileSync(splitPath,'utf8')).rows.map((row:any)=>[row.sourceMatchId,row]));
 for(const f of [...report.files,...report.sourceFiles])if(fileHash(f.path)!==f.sha256)throw new Error('strict audit source or evidence changed');
 const ledger=report.files.find((f:any)=>f.path.endsWith('replay-ledger.jsonl')).path,usable:HumanRow[]=[];
 for await(const line of createInterface({input:createReadStream(ledger),crlfDelay:Infinity})){
  const row=JSON.parse(line);if(!row.usableForH)continue;const locked:any=splitRows.get(row.sourceMatchId);
  if(!locked||row.split!==locked.split||row.familyId!==locked.familyId)throw new Error('actual H consumer split/family mismatch');usable.push(row);
 }
 const namespace='review6-H-balanced-source-v1',selected=selectHumanRows(usable,plan.humanFit.quotaBeforeModelResults,namespace);
 for(const split of ['train','dev','holdout'])if(selected[split].length<1)throw new Error('no usable H split');
 mkdirSync(out,{recursive:false});
 const selection={schemaVersion:'r6-H-selection-v1',at:new Date().toISOString(),namespace,method:'source groups ordered by fixed hash; decisions within groups by fixed hash; deterministic round robin without replacement',sourceReportHash:data.replayReportHash,planLockHash:data.planLockHash,modelScoresOpened:false,
  requested:plan.humanFit.quotaBeforeModelResults,counts:Object.fromEntries(Object.entries(selected).map(([k,v])=>[k,v.length])),selected};
 writeNew(resolve(out,'selection.lock.json'),selection);
 const byMatch=new Map<string,Map<string,HumanRow>>();for(const row of Object.values(selected).flat()){if(!byMatch.has(row.sourceMatchId))byMatch.set(row.sourceMatchId,new Map());byMatch.get(row.sourceMatchId)!.set(row.decisionId,row);}
 const descriptors=Object.fromEntries(['train','dev','holdout'].map(split=>[split,openSync(resolve(out,split+'.f32'),'wx')])),metadata:Record<string,any[]>={train:[],dev:[],holdout:[]};
 let written=0;
 try{
  for await(const item of streamHumanMatches(data.sourcePath)){
   const record=item.record,wanted=byMatch.get(record.sample_id);if(!wanted)continue;
   let previous:GameResult|null=null,prefixHash=hash('initial-public-history');
   for(let roundIndex=0;roundIndex<record.rounds.length&&wanted.size;roundIndex++){
    const round=record.rounds[roundIndex],reconstructed=buildSourceRound(round,roundIndex,previous),tracker=new PublicTracker();
    prefixHash=hash(JSON.stringify([prefixHash,reconstructed.context,reconstructed.knownTransfers]));
    for(let eventIndex=0;eventIndex<round.events.length&&wanted.size;eventIndex++){
     const event=round.events[eventIndex];if(event.event_id!==3&&event.event_id!==4)continue;
     const audit=inspectSourceAction(reconstructed.state,event,tracker,[prefixHash],reconstructed.knownTransfers),key=`${record.sample_id}:${round.sample_id}:e${eventIndex}`,expected=wanted.get(key);
     if(!audit.targetRuleLegal||audit.declarationCount!==1||audit.reasons.some(r=>r!=='enumerator_pruned_resource_variants'))throw new Error('feature replay reached incompatible prefix before a selected target');
     if(expected){
      if(!audit.usableForH||audit.observationHash!==expected.observationHash||hash(JSON.stringify(audit.candidateKeys))!==expected.candidateHash||JSON.stringify(audit.targetIndices)!==JSON.stringify(expected.targetEquivalentIndices))throw new Error('actual H consumer differs from audited observation/candidate/target identity');
      const n=audit.candidateCombos.length,t=audit.targetIndices.length,values=new Float32Array(STATE_DIM_V2+2+t+n*68);values.set(audit.stateFeatures);values[STATE_DIM_V2]=n;values[STATE_DIM_V2+1]=t;values.set(audit.targetIndices,STATE_DIM_V2+2);
      audit.candidateCombos.forEach((combo,index)=>encodeAction(combo,values.subarray(STATE_DIM_V2+2+t+index*68,STATE_DIM_V2+2+t+(index+1)*68),'action64'));
      if(!values.every(Number.isFinite))throw new Error('nonfinite H feature');
      const split=expected.split;writeSync(descriptors[split],Buffer.from(values.buffer));
      metadata[split].push({decisionId:key,sourceMatchId:record.sample_id,familyId:expected.familyId,sourceRoundId:round.sample_id,roundIndex,eventIndex,actorSeat:Number(event.uid.slice(1))-1,nCandidates:n,targetIndices:audit.targetIndices,kinds:audit.candidateCombos.map(c=>c?.kind??'pass'),actualKind:audit.combo?.kind??'pass',strata:expected.strata,representationGaps:audit.representationGaps,observationHash:audit.observationHash,candidateHash:expected.candidateHash});
      wanted.delete(key);written++;
     }
     const events=applyMove(reconstructed.state,event.event_id===4?{pass:true}:{pass:false,combo:audit.combo!});tracker.observe(events);prefixHash=hash(JSON.stringify([prefixHash,{actor:Number(event.uid.slice(1))-1,pass:event.event_id===4,action:resourceEffectKey(audit.combo)}]));
    }
    previous=reconstructed.state.result;
   }
   if(wanted.size)throw new Error('selected H target not reached');
  }
 }finally{for(const descriptor of Object.values(descriptors))closeSync(descriptor);}
 const requested=Object.values(selected).reduce((n,rows)=>n+rows.length,0);if(written!==requested)throw new Error('H selected feature denominator incomplete');
 if(fileHash(data.sourcePath)!==data.sourceSHA256)throw new Error('H source changed during feature replay');
 for(const split of ['train','dev','holdout']){if(metadata[split].length!==selected[split].length)throw new Error('H split consumer count mismatch');writeNew(resolve(out,split+'-metadata.json'),metadata[split]);}
 const oldPath=resolve('packages/web/public/ai/clean2.f32'),raw=readFileSync(oldPath);
 if(fileHash(oldPath)!=='b8badb4b04290110c093c31219cec23880c837c4bc84e3a5828cc201a15dde55')throw new Error('clean old parent identity mismatch');
 const parent=migratePassEncoding(remapV1WeightsToV2(new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength))),INPUT_DIM_V2,STATE_DIM_V2);
 if(parent.length!==168449||!parent.every(Number.isFinite))throw new Error('clean migrated parent malformed');writeFileSync(resolve(out,'clean-parent.f32'),Buffer.from(parent.buffer),{flag:'wx'});
 const files=['selection.lock.json','clean-parent.f32',...['train','dev','holdout'].flatMap(s=>[s+'.f32',s+'-metadata.json'])].map(name=>({path:resolve(out,name),sha256:fileHash(resolve(out,name))}));
 const result={schemaVersion:'r6-H-feature-manifest-v1',at:new Date().toISOString(),sourceReport:reportPath,sourceReportHash:data.replayReportHash,selectionHash:fileHash(resolve(out,'selection.lock.json')),planLockHash:data.planLockHash,counts:selection.counts,files,
  parent:{originPolicyId:FROZEN_CHAMPION_IDENTITY.policyId,originWeightsSHA256:fileHash(oldPath),policyId:'review6-clean2-parent-399-action64-candv3',weightsSHA256:fileHash(resolve(out,'clean-parent.f32')),encoder:'gd-lab-schema-v4',candidateVersion:'cand-dedup-v3',passEncoding:'action64',inputDim:399,updates:0},
  sourceFiles:['lab/review6/data-replay.ts','lab/review6/human-data.ts','lab/review6/human-features.ts'].map(path=>({path:resolve(path),sha256:fileHash(path)})),format:'little-endian f32: state331,nCandidates,targetCount,targetIndices,candidateFeatures(n*68)',binaryRowOrder:'corresponding split metadata order',neuralForwardCalls:0,trainingUpdates:0,
  scope:'fresh matched legal behavior prefixes only; no incompatible future rewards; human skill and person-disjointness unknown; missing public transfer-owner features explicitly retained as representation gaps'};
 writeNew(resolve(out,'H-manifest.json'),result);return result;
}
