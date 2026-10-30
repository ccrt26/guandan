/** Pure deal-family preflight, before any candidate score or match outcome. */
import{existsSync,mkdirSync,readFileSync,writeFileSync,truncateSync}from'node:fs';import{join,resolve}from'node:path';import{randomUUID}from'node:crypto';
import{createMatch,startGame,DEFAULT_RULES}from'@gd/engine';import{deriveSeed}from'@gd/ai';
import{indexedDealSeed}from'../review6/match-play';import{engineDealFamily}from'../review6/capability-lineage';
import{HOME,ROOT,PROTOCOL,json,hash,fileHash,atomicJson,bindFamilies}from'./protocol';
const METRICS=['cooperation','M1','M2'];const COUNTS={cooperation:2695,M1:262,M2:1047};
export const confirmationSeed=(attempt:number)=>deriveSeed('review6-2-confirmation-attempt-v1',2026102901,attempt,PROTOCOL);
export function queueSource(attempt:number,metric:string,trial:number){
 const seed=deriveSeed('review6-2-evaluation-source-v1',confirmationSeed(attempt),trial,'sealed:'+metric),dealNamespace='review6-2-sealed-'+metric+'-deals-v1';
 const familyId=engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(dealNamespace,seed,0))).hands);return{seed,dealNamespace,familyId};
}
function roundFamilies(source:any){return Array.from({length:80},(_,i)=>engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(source.dealNamespace,source.seed,i))).hands));}
function generatorIdentity(){return hash(JSON.stringify(['lab/review6_2/match-queue.ts','lab/review6/match-play.ts','lab/review6/capability-lineage.ts','lab/review6/data-provenance.ts','lab/src/review5_tuning/kscbReplay.ts','packages/ai/src/nn/wave.ts',...['game','deck','rng','rank','types'].map(p=>'packages/engine/src/'+p+'.ts')].map(p=>[p,fileHash(resolve(ROOT,p))])));}
function committedJournal(path:string){
 if(!existsSync(path))return[];
 const bytes=readFileSync(path),committed=bytes.lastIndexOf(10)+1;
 if(committed<bytes.length){writeFileSync(path+'.uncommitted-'+randomUUID(),bytes.subarray(committed),{flag:'wx'});truncateSync(path,committed);}
 return bytes.subarray(0,committed).toString('utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s));
}
function checkSpec(spec:any){
 if(!Number.isSafeInteger(spec.attempt)||spec.attempt<1||spec.attempt>3||METRICS.some(k=>!Number.isSafeInteger(spec.counts[k])||spec.counts[k]<2))throw Error('valid fixed queue counts/attempt required');
 if(!spec.fixture&&(JSON.stringify(spec.counts)!==JSON.stringify(COUNTS)||spec.examFiles?.length!==2))throw Error('formal queue needs full fixed counts and both frozen exams');
 for(const f of spec.examFiles??[])if(fileHash(f.path)!==f.sha256)throw Error('queue exam file changed');
}
function reserve(config:any,q:any){
 const index=json(config.sourceIndexRef),families=[...new Set(q.sources.flatMap((s:any)=>s.roundFamilies))]as string[];
 for(const f of families){const old=index.families[f];if(old&&(old.split!=='sealed'||old.firstSource!==q.reservationTag))throw Error('finalized queue reservation collision; do not replace sources after opening');}
 if(families.some(f=>!index.families[f]))bindFamilies(config.sourceIndexRef,families,'sealed',q.reservationTag);
}
export function prepareMatchQueue(config:any,output:string,spec:any){
 checkSpec(spec);const begin=performance.now(),deadline=begin+config.windowSeconds*1000;mkdirSync(output,{recursive:true});
 const baseIdentity=hash(JSON.stringify({spec,index:resolve(config.sourceIndexRef),generator:generatorIdentity()})),manifestPath=join(output,'manifest.json'),journal=join(output,'proposals.jsonl'),queuePath=join(output,'queue.json');
 let manifest:any;
 if(existsSync(manifestPath)){manifest=json(manifestPath);if(manifest.baseIdentity!==baseIdentity)throw Error('queue preparation identity changed');}
 else{const indexBeforeSHA256=fileHash(config.sourceIndexRef);manifest={baseIdentity,indexBeforeSHA256,identity:hash(baseIdentity+indexBeforeSHA256),spec,generatorSHA256:generatorIdentity()};atomicJson(manifestPath,manifest);}
 const done=(q:any)=>{reserve(config,q);const r={status:'prepared',queueRef:resolve(queuePath),queueSHA256:fileHash(queuePath),potentialRoundFamilies:new Set(q.sources.flatMap((s:any)=>s.roundFamilies)).size,physicalMatchesAdded:0,candidatePolicyRead:false,wallSeconds:(performance.now()-begin)/1000};atomicJson(join(output,'summary.json'),r);return r;};
 if(existsSync(queuePath)){const q=json(queuePath);if(q.identity!==manifest.identity||q.generatorSHA256!==generatorIdentity()||q.journalSHA256!==fileHash(journal))throw Error('final queue identity changed');return done(q);}
 if(fileHash(config.sourceIndexRef)!==manifest.indexBeforeSHA256)throw Error('index changed during unopened queue preparation; preserve this version and explicitly prelock a new version');
 const used=new Set(Object.keys(json(config.sourceIndexRef).families)),sources:any[]=[],counts:any={cooperation:0,M1:0,M2:0},trials:any={cooperation:0,M1:0,M2:0};let rejectedTrials=0;
 const acceptRecord=(r:any,calculatedFamilies?:string[])=>{
  if(!METRICS.includes(r.metric)||r.trial!==trials[r.metric]||r.ordinal!==counts[r.metric]||JSON.stringify(r.source)!==JSON.stringify(queueSource(spec.attempt,r.metric,r.trial)))throw Error('queue journal proposal order/source changed');
  const families=calculatedFamilies??roundFamilies(r.source),collisions=families.filter(f=>used.has(f)),accepted=collisions.length===0&&new Set(families).size===80;
  if(r.accepted!==accepted||JSON.stringify(r.collisions)!==JSON.stringify(collisions)||accepted&&JSON.stringify(r.roundFamilies)!==JSON.stringify(families))throw Error('queue journal collision/ancestry changed');
  trials[r.metric]++;if(accepted){counts[r.metric]++;sources.push(r);families.forEach(f=>used.add(f));}else rejectedTrials++;
 };
 for(const r of committedJournal(journal))acceptRecord(r);
 for(const metric of METRICS)while(counts[metric]<spec.counts[metric]){
  if(performance.now()>=deadline-1000){const r={status:'window_expired',output,identity:manifest.identity,acceptedCounts:counts,rejectedTrials,physicalMatchesAdded:0};atomicJson(join(output,'summary.json'),r);return r;}
  const source=queueSource(spec.attempt,metric,trials[metric]),families=roundFamilies(source),collisions=families.filter(f=>used.has(f)),accepted=collisions.length===0&&new Set(families).size===80;
  const r={metric,ordinal:counts[metric],trial:trials[metric],source,accepted,collisions,...(accepted?{roundFamilies:families}:{})};
  writeFileSync(journal,JSON.stringify(r)+'\n',{flag:'a'});acceptRecord(r,families);
 }
 const q={schema:spec.fixture?'fixture-match-source-queue-v1':'formal-match-source-queue-v1',identity:manifest.identity,generatorSHA256:manifest.generatorSHA256,attempt:spec.attempt,evaluationSeed:confirmationSeed(spec.attempt),counts:spec.counts,examFiles:spec.examFiles,candidateScoresUsed:false,indexBeforeSHA256:manifest.indexBeforeSHA256,sourceIndexRef:resolve(config.sourceIndexRef),reservationTag:'formal-match-queue:'+spec.attempt+':'+manifest.identity,journalRef:resolve(journal),journalSHA256:fileHash(journal),sources,rejectedTrials,maximumGamesPerSource:80,scope:'potential ancestry reservation only; no strategy matches or outcomes'};
 atomicJson(queuePath,q);return done(q);
}
export function validateMatchQueue(config:any,path:string,examFiles:any[],allowFixture=false){
 const q=json(path);if(q.schema!=='formal-match-source-queue-v1'&&!allowFixture)throw Error('fixture cannot serve as formal match queue');
 checkSpec({attempt:q.attempt,fixture:allowFixture,counts:q.counts,examFiles:q.examFiles});
 if(q.generatorSHA256!==generatorIdentity()||JSON.stringify(q.examFiles)!==JSON.stringify(examFiles)||q.candidateScoresUsed!==false||q.evaluationSeed!==confirmationSeed(q.attempt)||resolve(q.sourceIndexRef)!==resolve(config.sourceIndexRef)||fileHash(q.journalRef)!==q.journalSHA256)throw Error('fixed queue identity/exams changed');
 const index=json(config.sourceIndexRef),seen=new Set(),lookup:any={cooperation:[],M1:[],M2:[]};
 for(const r of q.sources){
  if(!METRICS.includes(r.metric)||r.ordinal!==lookup[r.metric].length||JSON.stringify(r.source)!==JSON.stringify(queueSource(q.attempt,r.metric,r.trial))||JSON.stringify(r.roundFamilies)!==JSON.stringify(roundFamilies(r.source)))throw Error('fixed queue source/round ancestry changed');
  for(const f of r.roundFamilies){if(seen.has(f)||index.families[f]?.split!=='sealed'||index.families[f]?.firstSource!==q.reservationTag)throw Error('queue source is shared, unreserved or foreign');seen.add(f);}
  lookup[r.metric].push(r);
 }
 if(METRICS.some(k=>lookup[k].length!==q.counts[k]))throw Error('incomplete fixed queue');
 return{queue:q,lookup,sha256:fileHash(path)};
}
