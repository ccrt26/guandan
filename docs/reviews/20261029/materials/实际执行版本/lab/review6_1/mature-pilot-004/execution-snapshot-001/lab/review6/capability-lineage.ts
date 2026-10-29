import{readFileSync,writeFileSync}from'node:fs';
import{resolve}from'node:path';
import{createMatch,startGame,DEFAULT_RULES,type Card}from'@gd/engine';
import{sourceFamilyKey}from'./data-provenance';
import{codeOfCard,DEFAULT_MAPPING}from'../src/review5_tuning/kscbReplay';
import{indexedDealSeed}from'./match-play';
import{fileHash,productCaseIds,verifyProductManifest}from'./product-artifacts';
export const CAPABILITY_BASE_DEAL_NAMESPACE='review6-capability-independent-base-deal-v1';
export function engineDealFamily(hands:Card[][]){return sourceFamilyKey({rounds:[{events:hands.map((hand,seat)=>({event_id:2,uid:`P${seat+1}`,tiles:hand.map(c=>codeOfCard(c,DEFAULT_MAPPING))}))}]} as any);}
export function baseDealDescriptor(row:{sourceBaseMatchId:string;sourceSeed:number}){
 const actualFirstDealSeed=indexedDealSeed(CAPABILITY_BASE_DEAL_NAMESPACE,row.sourceSeed,0),hands=startGame(createMatch({...DEFAULT_RULES},actualFirstDealSeed)).hands;
 return{sourceBaseMatchId:row.sourceBaseMatchId,sourceSeed:row.sourceSeed,actualFirstDealSeed,dealNamespace:CAPABILITY_BASE_DEAL_NAMESPACE,familyId:engineDealFamily(hands),ancestryKind:'fresh_complete_engine_initial_deal',ancestorFamilyId:null};
}
/** Mechanical canonical hashes only. No states, policy calls, labels or scores
 * are emitted; all derived variants must later inherit the base family. */
export function materializeCapabilityQueueLineage(config:any,queuePath:string,expectedHash:string,output:string){
 if(fileHash(queuePath)!==expectedHash)throw new Error('bounded source queue changed');
 const queue=JSON.parse(readFileSync(queuePath,'utf8'));
 if(queue.rows.length!==300||queue.maxSourceAttempts!==300||queue.maxPerCategory!==75||new Set(queue.rows.map((r:any)=>r.sourceBaseMatchId)).size!==300)throw new Error('bounded source queue identity/denominator changed');
 verifyProductManifest(config.product.resultDirectory,config.product.resultManifestHash);
 const lock=JSON.parse(readFileSync(config.data.sourceLockReceipt,'utf8'));if(fileHash(config.data.sourceLockReceipt)!==config.data.sourceLockReceiptHash)throw new Error('human source lock changed');
 for(const f of lock.files)if(fileHash(f.path)!==f.sha256)throw new Error('source lineage evidence changed');
 const splitPath=lock.files.find((f:any)=>f.path.endsWith('split.lock.json')).path,excluded=new Map<string,string[]>();
 const add=(key:string,reason:string)=>excluded.set(key,[...(excluded.get(key)??[]),reason]);
 for(const r of JSON.parse(readFileSync(splitPath,'utf8')).rows)add(r.familyId,'human_source_'+r.split);
 for(const id of productCaseIds()){const {record}=JSON.parse(readFileSync(resolve(config.product.resultDirectory,'records',id+'.json'),'utf8'));add(engineDealFamily(record.initialHands),'open_fact_development:'+id);}
 const baseline=JSON.parse(readFileSync(config.data.developmentBaseline.planPath,'utf8'));for(const seed of new Set<number>(baseline.rows.map((r:any)=>r.matchSeed)))add(engineDealFamily(startGame(createMatch({...DEFAULT_RULES},seed)).hands),'original_development_seed');
 const seen=new Map<string,string>(),rows=queue.rows.map((row:any)=>{const d=baseDealDescriptor(row),reasons=[...(excluded.get(d.familyId)??[])];if(seen.has(d.familyId))reasons.push('same_queued_base_family:'+seen.get(d.familyId));else seen.set(d.familyId,d.sourceBaseMatchId);return{...row,...d,lineageStatus:reasons.length?'rejected_lineage_collision':'base_lineage_reserved_root_not_materialized',lineageRejectionReasons:reasons,qualifiedRoot:false,qualifiedLabel:false};});
 const result={schemaVersion:'r61-mechanical-queue-lineage-v1',at:new Date().toISOString(),inputQueuePath:resolve(queuePath),inputQueueSHA256:expectedHash,maxSourceAttempts:300,baseSourceRows:300,canonicalBaseFamilies:seen.size,lineageRejectedRows:rows.filter((r:any)=>r.lineageRejectionReasons.length).length,reservedBaseRows:rows.filter((r:any)=>!r.lineageRejectionReasons.length).length,qualifiedSkillFamilies:0,qualifiedRootDecisions:0,labels:0,modelForwardCalls:0,formalAttemptsOpened:0,rawSealedStatesEmitted:0,priorKnownExclusionFamilies:excluded.size,sourceFiles:['lab/review6/capability-lineage.ts','lab/review6/data-provenance.ts','lab/review6/match-play.ts'].map(path=>({path:resolve(path),sha256:fileHash(path)})),scope:'Base-deal metadata only, not a sealed exam or independence proof for future variants. Check all actual current training/dev/confirmation ancestries again before production; all variants inherit one base family. Seeds alone are not the lineage test.',rows};
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});return{path:resolve(output),sha256:fileHash(output),baseRows:300,canonicalBaseFamilies:result.canonicalBaseFamilies,lineageRejectedRows:result.lineageRejectedRows,qualifiedSkillFamilies:0,labels:0,modelForwardCalls:0};
}
