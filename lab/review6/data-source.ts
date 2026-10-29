import {createReadStream,readFileSync,writeFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {sourceFamilyKey,partitionHumanMetadata,type SourceSplitRow,type KscbMatch} from './data-provenance';
import {fileHash} from './product-artifacts';

export async function* streamHumanMatches(path:string){
 const lines=createInterface({input:createReadStream(path).pipe(createGunzip()),crlfDelay:Infinity});
 let lineNo=0;
 for await(const line of lines){lineNo++;if(!line.trim()||line.length>16777216)throw new Error('invalid or excessive source record');yield {lineNo,rawLineSHA256:createHash('sha256').update(line).digest('hex'),record:JSON.parse(line) as KscbMatch};}
}
const writeNew=(path:string,data:unknown)=>writeFileSync(path,JSON.stringify(data,null,2)+'\n',{flag:'wx'});

/** Mechanical lineage pass only. No policy, encoder, model or result-scoring call. */
export async function prepareHumanSource(config:{data:{sourcePath:string;sourceSHA256:string;auditDirectory:string;planLock:string;planLockHash:string;historicalConsumptionManifest:string;historicalConsumptionManifestHash:string}}){
 const data=config.data,out=resolve(data.auditDirectory),source=resolve(data.sourcePath);
 if(existsSync(out))throw new Error('source output exists; refuse overwrite');
 if(fileHash(data.planLock)!==data.planLockHash||fileHash(source)!==data.sourceSHA256||fileHash(data.historicalConsumptionManifest)!==data.historicalConsumptionManifestHash)throw new Error('source/plan/consumption hash mismatch');
 const plan=JSON.parse(readFileSync(data.planLock,'utf8')),old=JSON.parse(readFileSync(data.historicalConsumptionManifest,'utf8'));
 if(old.sourceSha!==data.sourceSHA256||plan.sourceSHA256!==data.sourceSHA256||plan.modelScoringBeforeSplitAllowed!==false)throw new Error('source use contract mismatch');
 const used=new Set<string>([...old.train,...old.dev,...old.holdout]);if(used.size!==100)throw new Error('historical consumed-source inventory changed');
 const before=statSync(source),metadata:Array<SourceSplitRow&{rawLineSHA256:string;rounds:number;actions:number;lineNo:number}>=[];
 const uids=new Set<string>();let rounds=0,actions=0;
 for await(const item of streamHumanMatches(source)){
  const record=item.record,roundCount=record.rounds.length,count=record.rounds.reduce((n,r)=>n+r.events.filter(e=>e.event_id===3||e.event_id===4).length,0);let familyId:string,reason:string|undefined;
  try{familyId=sourceFamilyKey(record);}catch(error){familyId='unverifiable:'+item.rawLineSHA256;reason=(error as Error).message;}
  for(const round of record.rounds)for(const event of round.events)if(event.uid)uids.add(event.uid);
  metadata.push({sourceMatchId:record.sample_id,familyId,split:'unusable',...(reason?{reason}:{}),rawLineSHA256:item.rawLineSHA256,rounds:roundCount,actions:count,lineNo:item.lineNo});rounds+=roundCount;actions+=count;
 }
 const after=statSync(source);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||fileHash(source)!==data.sourceSHA256)throw new Error('source changed during mechanical pass');
 if(metadata.length!==1305||used.size!==100||[...used].some(id=>!metadata.some(r=>r.sourceMatchId===id)))throw new Error('actual source or consumption denominator mismatch');
 const split=partitionHumanMetadata(metadata,used,plan.splitNamespace);
 mkdirSync(out,{recursive:false});
 const manifest={schemaVersion:'r6-human-source-manifest-v1',at:new Date().toISOString(),sourcePath:source,sourceSHA256:data.sourceSHA256,actualMatches:metadata.length,actualRounds:rounds,actualRawActions:actions,historicalConsumedMatches:used.size,sourceDocumentation:'https://github.com/Calix-L/CardKS/tree/main/KSCB',documentationVersion:'current descriptive schema; local raw bytes remain pinned to original commit',humanProvenance:'author_reported',skill:'unknown',playerIdentity:{observedUIDs:[...uids].sort(),availability:'seat_aliases_not_verified_cross_match_person_identifiers',playerDisjointness:'unknown'},historicalConsumption: {path:resolve(data.historicalConsumptionManifest),sha256:data.historicalConsumptionManifestHash},modelScoresOpened:false};
 writeNew(resolve(out,'source-manifest.json'),manifest);writeNew(resolve(out,'split.lock.json'),split);
 writeFileSync(resolve(out,'records-manifest.jsonl'),metadata.map(({split,...row})=>JSON.stringify(row)).join('\n')+'\n',{flag:'wx'});
 writeFileSync(resolve(out,'split-use-ledger.jsonl'),split.rows.map(row=>JSON.stringify({...row,phase:'pre_model_mechanical_split_lock',use:row.split==='historical_diagnostic'?'previously_consumed_no_fresh_claim':row.split==='unusable'?'not_consumable':'reserved_'+row.split,policyScoring:false,gradientConsumption:false})).join('\n')+'\n',{flag:'wx'});
 const files=['source-manifest.json','split.lock.json','records-manifest.jsonl','split-use-ledger.jsonl'].map(path=>({path:resolve(out,path),sha256:fileHash(resolve(out,path))}));
 const receipt={schemaVersion:'r6-human-source-lock-v1',sourceSHA256:data.sourceSHA256,planLockHash:data.planLockHash,modelScoring:false,files,sourceFiles:['lab/review6/data-provenance.ts','lab/review6/data-source.ts'].map(path=>({path:resolve(path),sha256:fileHash(path)})),counts:{matches:metadata.length,rounds,rawActions:actions,splits:Object.fromEntries(['historical_diagnostic','train','dev','holdout','unusable'].map(name=>[name,split.rows.filter(row=>row.split===name).length]))}};
 writeNew(resolve(out,'source-lock-receipt.json'),receipt);return receipt;
}
