/** One ledger for skills, severe cases and fixed-N matches; no outcomes at ready. */
import{existsSync,mkdirSync,realpathSync}from'node:fs';import{join,resolve}from'node:path';
import{deriveSeed}from'@gd/ai';import{evaluatePolicy,policyForRun}from'./evaluate';
import{validateFormalShape,assertFrozenExamEvidence,scoreLockedExam,CATEGORIES}from'./exam';
import{HOME,ROOT,PROTOCOL,json,hash,fileHash,atomicJson,readRegistry,validatePolicy,readCheckpoint,runDirectory}from'./protocol';
import{prepareMatchQueue,validateMatchQueue,confirmationSeed}from'./match-queue';
export const FORMAL_COUNTS={cooperation:2695,M1:262,M2:1047};
export const LEDGER_PATH=join(HOME,'confirmation/ledger.json');
const POLICY_PATH=resolve(ROOT,'deliverables/review6-2-audit-20261029/execution-policy.json');
const ledger=()=>existsSync(LEDGER_PATH)?json(LEDGER_PATH):{protocolId:PROTOCOL,attempts:[]};
const EXECUTION_FILES=[
 'lab/review6_2/confirmation.ts','lab/review6_2/exam.ts','lab/review6_2/evaluate.ts','lab/review6_2/evidence.ts','lab/review6_2/teaching-evidence.ts','lab/review6_2/terminal-proof.ts','lab/review6_2/declared-proof.ts','lab/review6_2/match-queue.ts','lab/review6_2/protocol.ts','lab/review6_2/run.ts','lab/review6_2/writer-lock.ts','lab/review6_2/anchor-coverage.ts',
 'lab/review6/match-play.ts','lab/review6/data-replay.ts','lab/review6/variance-layout.ts','lab/review6/paired_stats.py','lab/review6/exact-inference.ts','lab/review6/policy-registry.ts',
 'lab/review6/visible-world.ts','lab/review6/visible-schema.ts','lab/review6/teacher-roots.ts','lab/review6/action-effect.ts','lab/review6/training-ancestry.ts','lab/review6/capability-lineage.ts','lab/review6/data-provenance.ts','lab/review6/product-artifacts.ts','lab/src/review5_tuning/kscbReplay.ts',
 ...['combo','deck','game','index','rank','rng','types'].map(p=>'packages/engine/src/'+p+'.ts'),
 ...['index','legal','player','heuristic','planner','memory','sim','types','nn/neuralSeat','nn/nnplayer','nn/schema','nn/mlp','nn/wave'].map(p=>'packages/ai/src/'+p+'.ts'),
];
const executionFiles=()=>EXECUTION_FILES.map(path=>({path,sha256:fileHash(resolve(ROOT,path))}));
const implementation=()=>hash(JSON.stringify(executionFiles()));
export function assertFrozenExecution(candidate:any){if(candidate.confirmationImplementation!==implementation())throw Error('frozen policy execution source changed');}
export function attemptBinding(a:any,l:any,weights:string,policy:string,exam:string,examSHA:string){
 if(a.status!=='opened')throw Error('opened shared attempt required');
 const record=l.attempts.find((r:any)=>r.number===a.number);
 if(!record||JSON.stringify(record)!==JSON.stringify(a))throw Error('authoritative shared ledger binding required');
 if(a.candidateSHA256!==weights||a.policySHA256!==policy||!a.examFiles.some((r:any)=>r.path===exam&&r.sha256===examSHA))throw Error('shared candidate/policy/exam binding changed');
}
export function releaseVerdict(skills:any,old:any,severe:any,matches:any){
 const completeSkills=skills?.kind==='skills60'&&skills.families?.length===60&&skills.decisions?.length===75;
 const completeOld=old?.kind==='skills60'&&old.families?.length===60&&old.decisions?.length===75;
 const fullMatches=matches?.phase==='sealed'&&JSON.stringify(matches.counts)===JSON.stringify(FORMAL_COUNTS)&&matches.physicalCompleteMatches===34958;
 const upper=(s:any)=>s.possiblePassedFamilies??s.passedFamilies+s.unknownFamilies;
 const threshold=(lo:number,hi:number,n:number)=>lo>=n?true:hi<n?false:null;
 const baseline=completeSkills&&completeOld?(skills.passedFamilies>=upper(old)?true:upper(skills)<old.passedFamilies?false:null):null;
 const categoryGates=completeSkills?CATEGORIES.map(c=>threshold(skills.categories[c],skills.possibleCategories?.[c]??skills.categories[c]+skills.families.filter((f:any)=>f.category===c&&f.unknown&&f.possiblePass!==false).length,12)):[];
 const gates:any={skillsTotal:completeSkills?threshold(skills.passedFamilies,upper(skills),51):null,skillsCategories:completeSkills?(categoryGates.includes(false)?false:categoryGates.includes(null)?null:true):null,atLeastOld:baseline,
  skillsLegal:completeSkills?skills.illegalDecisions===0:null,noNewConfirmedSevere:completeSkills?(skills.severeErrors>0?false:skills.severityUnknownFamilies>0?null:true):null,
  severeComplete:severe?.kind==='severe24-v2'&&severe.families?.length===24&&severe.fullyAdjudicated===true?true:null,
  severeZero:severe?.severeErrors>0||severe?.illegalDecisions>0?false:severe?.kind==='severe24-v2'&&severe.fullyAdjudicated===true?true:null,
  fixedMatches:fullMatches?true:null,cooperation:fullMatches?matches.cooperation.macro.point>=.03&&matches.cooperation.macro.quantiles[0]>0:null,
  partnerGroups:fullMatches?[0,1,2].every(i=>matches.cooperation['group'+i].quantiles[0]>-.03):null,
  M1:fullMatches?matches.M1.point>=.55&&matches.M1.quantiles[0]>.5:null,M2:fullMatches?matches.M2.quantiles[0]>.45:null};
 return{status:Object.values(gates).includes(false)?'failed':Object.values(gates).includes(null)?'incomplete':'qualified_candidate',gates,scope:'REVIEW6.2/severe24-v2; original24 and human compatibility not certified'};
}
export function freezeCandidate(config:any,id:string,checkpoint?:string){
 const directory=runDirectory(id),m=json(join(directory,'manifest.json')),cp=readCheckpoint(directory);
 if(m.scope!=='main_training'||checkpoint&&resolve(checkpoint)!==cp.path)throw Error('explicit current main checkpoint required');
 const policy=policyForRun(config,id),path=join(HOME,'confirmation/candidates',policy.policyId+'.json');
 const files=executionFiles();
 const record={schema:'r62-fixed-candidate-v1',status:'frozen_unqualified',runId:id,policy,policySHA256:hash(JSON.stringify(policy)),checkpoint:cp.path,checkpointSHA256:fileHash(join(cp.path,'manifest.json')),trainingManifestRef:join(directory,'manifest.json'),trainingManifestSHA256:fileHash(join(directory,'manifest.json')),trainingCodeIdentity:m.codeIdentity,registryPath:config.registryPath,registrySHA256:fileHash(config.registryPath),executionPolicySHA256:fileHash(POLICY_PATH),executionFiles:files,confirmationImplementation:hash(JSON.stringify(files))};
 if(existsSync(path)){if(JSON.stringify(json(path))!==JSON.stringify(record))throw Error('frozen candidate changed');}else atomicJson(path,record);
 return{path,...record};
}
export function prepareFormalQueue(config:any,skillsPath:string,severePath:string,attempt:number,output:string){
 if(realpathSync(config.sourceIndexRef)!==realpathSync(join(HOME,'data/source-index.json')))throw Error('formal queue requires canonical project index');
 const examFiles=[[skillsPath,'skills60'],[severePath,'severe24-v2']].map(([path,kind])=>{
  const m=json(path);if(m.kind!==kind||!validateFormalShape(m).ready||realpathSync(m.sourceIndexRef)!==realpathSync(config.sourceIndexRef))throw Error('complete frozen exams required before formal queue');assertFrozenExamEvidence(m);return{path:resolve(path),sha256:fileHash(path),kind};
 });
 return prepareMatchQueue(config,output,{attempt,counts:FORMAL_COUNTS,fixture:false,examFiles});
}
export function confirmationReady(config:any,candidatePath:string,skillsPath:string,severePath:string,queuePath?:string){
 const reasons:string[]=[],examFiles:any[]=[],familyIds=new Set<string>();let candidate:any=null,matchQueue:any=null;
 try{
  if(realpathSync(config.sourceIndexRef)!==realpathSync(join(HOME,'data/source-index.json')))throw Error('shared formal ledger requires canonical project source index');
  candidate=json(candidatePath);validatePolicy(candidate.policy);
  assertFrozenExecution(candidate);
  if(candidate.schema!=='r62-fixed-candidate-v1'||candidate.policySHA256!==hash(JSON.stringify(candidate.policy))||candidate.registrySHA256!==fileHash(config.registryPath)||candidate.executionPolicySHA256!==fileHash(POLICY_PATH)||candidate.checkpointSHA256!==fileHash(join(candidate.checkpoint,'manifest.json'))||candidate.trainingManifestSHA256!==fileHash(candidate.trainingManifestRef))throw Error('frozen candidate/implementation/registry binding changed');
  readRegistry(config);
 }catch(e){reasons.push('candidate: '+(e as Error).message);}
 for(const[path,kind]of[[skillsPath,'skills60'],[severePath,'severe24-v2']])try{
  const exam=json(path),shape=validateFormalShape(exam);
  if(exam.kind!==kind||!shape.ready)throw Error('wrong/incomplete '+kind+': '+shape.reasons.join('; '));
  if(resolve(exam.sourceIndexRef)!==resolve(config.sourceIndexRef))throw Error('source index differs from controlled index');
  assertFrozenExamEvidence(exam);exam.families.forEach((f:any)=>familyIds.add(f.sourceFamilyId));examFiles.push({path:resolve(path),sha256:fileHash(path),kind});
 }catch(e){reasons.push(kind+': '+(e as Error).message);}
 try{if(!queuePath)throw Error('fixed formal match source queue missing');matchQueue=validateMatchQueue(config,queuePath,examFiles);}catch(e){reasons.push('matchQueue: '+(e as Error).message);}
 const l=ledger(),policy=json(POLICY_PATH);
 if(l.protocolId!==PROTOCOL)reasons.push('formal ledger protocol changed');
 const counts=policy.release.formalDefaultN;
 if(counts.cooperationBlocks!==2695||counts.M1Blocks!==262||counts.M2Blocks!==1047||counts.physicalMatches!==34958)reasons.push('fixed formal match plan changed');
 return{ready:reasons.length===0,reasons,candidate,examFiles,matchQueue,familyIds:[...familyIds],counts:FORMAL_COUNTS,ledger:l};
}
export async function runConfirmation(config:any,candidatePath:string,skillsPath:string,severePath:string,number:number,queuePath:string){
 const ready=confirmationReady(config,candidatePath,skillsPath,severePath,queuePath);if(!ready.ready)throw Error('confirmation not ready: '+ready.reasons.join('\n'));
 if(ready.matchQueue.queue.attempt!==number)throw Error('fixed queue belongs to another shared attempt');
 const l=ready.ledger,c=ready.candidate,limit=json(POLICY_PATH),inherited=limit.historicalRecord.formalAttemptsOpened;
 let a=l.attempts.find((r:any)=>r.number===number);
 const output=join(HOME,'confirmation','attempt-'+number),attemptPath=join(output,'attempt.json');
 if(a){
  if(a.candidateFileSHA256!==fileHash(candidatePath)||JSON.stringify(a.examFiles)!==JSON.stringify(ready.examFiles)||a.matchQueueSHA256!==ready.matchQueue.sha256)throw Error('same attempt requires identical candidate, exams and source queue');
  if(a.status==='completed'){if(fileHash(a.resultRef)!==a.resultSHA256)throw Error('completed formal result changed');return json(a.resultRef);}
 }else{
  if(!Number.isSafeInteger(number)||number!==inherited+l.attempts.length+1||number>limit.release.maximumFormalAttempts||l.attempts.some((r:any)=>r.status==='opened'))throw Error('formal attempt count/order exceeded; resume the same open attempt');
  const used=new Set(l.attempts.flatMap((r:any)=>r.examFamilyIds));if(ready.familyIds.some(f=>used.has(f)))throw Error('used formal exam families cannot be presented as new');
  a={number,status:'opened',openedAt:new Date().toISOString(),candidateRef:resolve(candidatePath),candidateFileSHA256:fileHash(candidatePath),candidateSHA256:c.policy.weightsSHA256,policySHA256:c.policySHA256,examFiles:ready.examFiles,examFamilyIds:ready.familyIds,counts:FORMAL_COUNTS,
   evaluationSeed:confirmationSeed(number),matchQueueRef:resolve(queuePath),matchQueueSHA256:ready.matchQueue.sha256,matchOutput:join(output,'matches'),policySHA256AtOpen:fileHash(POLICY_PATH)};
  l.attempts.push(a);atomicJson(LEDGER_PATH,l); // Authoritative commit before any score.
 }
 mkdirSync(output,{recursive:true});atomicJson(attemptPath,a);
 const registry=readRegistry(config),old=registry.policies.find(p=>p.policyId===registry.oldCompletePolicy)!;
 const score=(policy:any,exam:string,name:string)=>{
  const result=scoreLockedExam(policy,exam,attemptPath,policy.policyId===old.policyId);
  atomicJson(join(output,name+'.json'),result);return result;
 };
 const skills=score(c.policy,skillsPath,'skills'),oldSkills=score(old,skillsPath,'old-skills'),severe=score(c.policy,severePath,'severe');
 const matches=await evaluatePolicy({...config,seed:a.evaluationSeed,matchQueueRef:a.matchQueueRef,formalExamFiles:a.examFiles,formalAttempt:number},c.policy,a.matchOutput,FORMAL_COUNTS,'sealed');
 if(matches.status==='window_expired'){const summary={status:'window_expired',attempt:number,output};atomicJson(join(output,'summary.json'),summary);return summary;}
 const result={...releaseVerdict(skills,oldSkills,severe,matches),attempt:number,candidate:c.policy,skills,oldSkills,severe,matches,playingPolicyUpdated:false};
 const resultPath=join(output,'result.json');atomicJson(resultPath,result);
 Object.assign(a,{status:'completed',resultRef:resultPath,resultSHA256:fileHash(resultPath)});atomicJson(LEDGER_PATH,l);atomicJson(attemptPath,a);atomicJson(join(output,'summary.json'),result);return result;
}
