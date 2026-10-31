/** B08 read-only projection. No engine, model, task controller or network import.
 * The unit is one complete frozen family, never a decision or physical match. */
import {readFileSync,writeFileSync,existsSync,mkdirSync,realpathSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual as same} from 'node:util';
import {deriveSeed} from '../../packages/ai/src/nn/wave';
import {checkedOutput} from '../../scripts/project-paths.mjs';
export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export interface FixedRef {id:string;sha256:string}
export interface PairedPlan {
 schema:'ohuo-paired-plan-v1';comparison:'H-B'|'S-B';variantB:string;variantCandidate:string;
 familyIds:string[];split:'dev'|'confirm';metric:string;seed:number;statisticName:string;
 analysisUnit:'complete-source-block';analysisMethod:'r6-paired-percentile-type7-20k-v1';
 question:'teacher_increment'|'student_match';layoutIdentitySHA256:Record<string,string>;refs:Record<'plan'|'queue'|'sourceIndex'|'conditions'|'selectionHistory'|'authorization'|'budget'|'parentPackage',FixedRef>;
}
export interface DecisionFact {id:string;status:string;executionKind:string;elapsedMs:number|null;requests:Array<{requestCount:number|null;usage?:Record<string,unknown>}>}
export interface AttemptFact {
 runId:string;matchId:string;sourceRef:string;layoutRef:string;state:string;complete:boolean;winner:0|1|null;incompleteReason:string|null;
 recordVerified:boolean;actualRoundFamilies:string[];activeMatchLoopMs:number|null;identitySHA256:string|null;resultIdentity:Record<string,unknown>|null;recordRef:FixedRef|null;wallMs:number|null;decisions:DecisionFact[]|null;issues:string[];
}
const numeric=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function fixedRef(ref:any):asserts ref is FixedRef {
 if(!ref||Object.keys(ref).sort().join(',')!=='id,sha256'||typeof ref.id!=='string'||!ref.id||ref.id.startsWith('/')||/(^|[/:-])latest($|[/:-])/i.test(ref.id)||! /^[a-f0-9]{64}$/.test(ref.sha256))throw Error('immutable fixed reference required');
}
function planValid(p:PairedPlan){
 const keys=['schema','comparison','variantB','variantCandidate','familyIds','split','metric','seed','statisticName','analysisUnit','analysisMethod','question','layoutIdentitySHA256','refs'];
 if(!p||Object.keys(p).some(k=>!keys.includes(k))||!p.refs||Object.keys(p.refs).sort().join(',')!==['plan','queue','sourceIndex','conditions','selectionHistory','authorization','budget','parentPackage'].sort().join(','))throw Error('unknown paired plan or reference field');
 if(p.schema!=='ohuo-paired-plan-v1'||!['H-B','S-B'].includes(p.comparison)||p.question!==(p.comparison==='H-B'?'teacher_increment':'student_match')||!['dev','confirm'].includes(p.split)||p.analysisUnit!=='complete-source-block'||p.analysisMethod!=='r6-paired-percentile-type7-20k-v1'||!Number.isSafeInteger(p.seed)||p.seed<0||!p.metric||!p.statisticName||p.variantB===p.variantCandidate||!p.variantB||!p.variantCandidate)throw Error('fixed paired analysis contract required');
 if(!Array.isArray(p.familyIds)||!p.familyIds.length||new Set(p.familyIds).size!==p.familyIds.length||p.familyIds.some(x=>typeof x!=='string'||!x))throw Error('unique frozen source families required');
 for(const k of ['plan','queue','sourceIndex','conditions','selectionHistory','authorization','budget','parentPackage'])fixedRef(p.refs?.[k]);
}
function measure(values:unknown[],unknownExtra=0){const known=values.filter(numeric).reduce((s,v)=>s+v,0),unknown=values.length-values.filter(numeric).length+unknownExtra;return {known,unknown,total:unknown?null:known};}
function cost(attempts:AttemptFact[]){
 const decisions:DecisionFact[]=[],issues:string[]=[];let missingDecisions=0;
 for(const a of attempts){if(!a.decisions){missingDecisions++;continue;}const byId=new Map<string,DecisionFact>();for(const d of a.decisions){if(byId.has(d.id)&&!same(byId.get(d.id),d)){issues.push('conflicting_decision:'+a.matchId);missingDecisions++;}else byId.set(d.id,d);}decisions.push(...byId.values());}
 const requests=decisions.flatMap(d=>d.requests??[]),main=decisions.flatMap(d=>(d.requests??[]).slice(0,1)),expansion=decisions.flatMap(d=>(d.requests??[]).slice(1));
 const pending=decisions.filter(d=>d.status==='pending'||d.executionKind==='unknown').length;
 const count=(rows:any[])=>measure(rows.map(r=>Number.isSafeInteger(r.requestCount)&&r.requestCount>=0?r.requestCount:null),missingDecisions+pending);
 const usageFields=['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'];
 return {attempts:attempts.length,recordUnknown:missingDecisions,decisionQueries:decisions.filter(d=>d.requests?.length).length,confirmedActions:decisions.filter(d=>d.executionKind==='confirmed').length,
  pendingDecisions:decisions.filter(d=>d.status==='pending').length,executionUnknown:decisions.filter(d=>d.executionKind==='unknown').length,
  fallbackDecisions:decisions.filter(d=>d.status==='fallback').length,cancelledDecisions:decisions.filter(d=>d.status==='cancelled').length,haltedDecisions:decisions.filter(d=>d.status==='halted').length,
  decisionWaitMs:measure(decisions.map(d=>d.elapsedMs),missingDecisions),matchWallMs:measure(attempts.map(a=>a.wallMs)),activeMatchLoopMs:measure(attempts.map(a=>a.activeMatchLoopMs)),activeMatchLoopTimingScope:'B07 consumer accumulated active match loops across clean resumes; includes API wait and persistence, excludes pause intervals and initial policy loading',upstreamRequests:count(requests),mainRequests:count(main),expansionRequests:count(expansion),
  usage:Object.fromEntries(usageFields.map(k=>[k,measure(requests.map(r=>r.usage?.[k]),missingDecisions+pending)])),actualFees:null,feesStatus:'not_recorded_in_public_match_journal',issues};
}
/** Queue and index are frozen inputs, not regenerated or written by B08. */
export function summarizePaired(p:PairedPlan,queue:any,index:any,attempts:AttemptFact[]){
 planValid(p);
 if(queue?.schema!=='ohuo-complete-match-queue-v1'||!Array.isArray(queue.rows)||queue.sourceIndexRef!==p.refs.sourceIndex.id||index?.version!==1||!index.families)throw Error('frozen queue/source index required');
 const rows=queue.rows,knownIds=new Set(rows.map((r:any)=>r.matchId));
 if(knownIds.size!==rows.length)throw Error('duplicate planned match identity');
 if(!p.layoutIdentitySHA256||rows.some((r:any)=>! /^[a-f0-9]{64}$/.test(p.layoutIdentitySHA256[r.layoutId])))throw Error('frozen full layout identities required');
 const extraRows=rows.filter((r:any)=>!p.familyIds.includes(r.sourceFamilyId)||r.metric!==p.metric);
 const allIssues:string[]=extraRows.length?['queue_outside_fixed_comparison']:[];
 const blocks=p.familyIds.map((family,ordinal)=>{
  const blockRows=rows.filter((r:any)=>r.sourceFamilyId===family&&r.metric===p.metric),issues:string[]=[...allIssues];const differences:number[]=[];const matches:any[]=[];
  if(index.families[family]?.split!==(p.split==='confirm'?'sealed':p.split))issues.push('source_split_mismatch');
  if(blockRows.length!==12)issues.push('expected_twelve_matches_six_paired_layouts');
  // No supposedly independent blocks may share actual ancestral deal families.
  const own=new Set(blockRows.flatMap((r:any)=>r.roundFamilyIds??[]));
  for(const other of rows)if(other.sourceFamilyId!==family&&(other.roundFamilyIds??[]).some((f:string)=>own.has(f)))issues.push('ancestry_overlap_other_block');
  for(let group=0;group<3;group++)for(let side=0;side<2;side++){
   const pair=[p.variantB,p.variantCandidate].map(variant=>blockRows.filter((r:any)=>r.group===group&&r.side===side&&r.variant===variant));
   if(pair.some(r=>r.length!==1)){issues.push(`missing_or_duplicate_layout:${group}:${side}`);continue;}
   const [b,c]=pair.map(r=>r[0]);
   if(!same([b.seed,b.dealNamespace,b.roundFamilyIds,b.actor,b.maxGames,b.maxMovesPerGame],[c.seed,c.dealNamespace,c.roundFamilyIds,c.actor,c.maxGames,c.maxMovesPerGame])||b.actor!==side||!Array.isArray(b.roundFamilyIds)||!b.roundFamilyIds.length||b.roundFamilyIds[0]!==family||b.split!==p.split||c.split!==p.split)issues.push(`pair_source_layout_mismatch:${group}:${side}`);
   if(!Array.isArray(b.seats)||!Array.isArray(c.seats)||b.seats.length!==4||c.seats.length!==4||b.seats.some((s:any,i:number)=>i!==side&&!same(s,c.seats[i])))issues.push(`pair_policy_mismatch:${group}:${side}`);
   if((b.roundFamilyIds??[]).some((f:string)=>index.families[f]?.split!==(p.split==='confirm'?'sealed':p.split)))issues.push('round_source_split_mismatch');
   const values:number[]=[];
   for(const row of [b,c]){
    const found=attempts.filter(a=>a.matchId===row.matchId);
    if(found.length!==1)issues.push(`${found.length?'multiple_attempts':'not_started'}:${row.matchId}`);
    const a=found.length===1?found[0]:null;
    const identityKeys=['layoutId','sourceFamilyId','actor','metric','group','side','variant'];
    const identityMatches=!!a&&a.identitySHA256===p.layoutIdentitySHA256[row.layoutId]&&!!a.resultIdentity&&identityKeys.every(k=>a.resultIdentity![k]===row[k]);
    const ancestryMatches=!!a&&Array.isArray(a.actualRoundFamilies)&&a.actualRoundFamilies.length>0&&same(a.actualRoundFamilies,row.roundFamilyIds?.slice(0,a.actualRoundFamilies.length));
    const valid=!!a&&ancestryMatches&&identityMatches&&a.recordVerified&&a.sourceRef===p.refs.sourceIndex.id&&a.layoutRef===p.refs.queue.id&&a.complete===true&&[0,1].includes(a.winner as number)&&!a.issues.length;
    if(a&&!valid)issues.push(`incomplete_or_invalid:${row.matchId}`);
    matches.push({matchId:row.matchId,variant:row.variant,group,side,attemptCount:found.length,complete:valid,winner:valid?a!.winner:null,state:a?.state??(found.length?'ambiguous_attempts':'not_started'),recordRefs:found.map(x=>x.recordRef)});
    if(valid)values.push(Number(a!.winner===side));
   }
   if(values.length===2)differences.push(values[1]-values[0]);
  }
  const complete=issues.length===0&&differences.length===6;
  return {blockId:'block-'+String(ordinal).padStart(6,'0'),sourceFamilyId:family,ordinal,complete,difference:complete?differences.reduce((s,x)=>s+x,0)/6:null,groupDifferences:complete?[0,1,2].map(g=>(differences[2*g]+differences[2*g+1])/2):null,matches,issues:[...new Set(issues)]};
 });
 const complete=blocks.filter(b=>b.complete),unplanned=attempts.filter(a=>!knownIds.has(a.matchId));
 const columns={macro:complete.map(b=>b.difference!),...Object.fromEntries([0,1,2].map(g=>['group'+g,complete.map(b=>b.groupDifferences![g])]))};
 const input={unitIds:complete.map(b=>b.blockId),columns,seed:deriveSeed('review6-2-bootstrap-v1',p.seed,0,p.statisticName),probabilities:[.025,.975]};
 return {schema:'ohuo-paired-summary-v1',comparison:p.comparison,analysisUnit:p.analysisUnit,refs:p.refs,
  plan:{sourceBlocks:p.familyIds.length,pairedLayoutsPerBlock:6,matches:p.familyIds.length*12,seed:p.seed,statisticName:p.statisticName,split:p.split},
  actual:{completeBlocks:complete.length,incompleteBlocks:blocks.length-complete.length,recordedAttempts:attempts.length,completeMatches:attempts.filter(a=>a.recordVerified&&a.complete&&[0,1].includes(a.winner as number)&&!a.issues.length).length,incompleteAttempts:attempts.filter(a=>!a.complete||!a.recordVerified||a.issues.length).length,notStartedMatches:rows.filter((r:any)=>!attempts.some(a=>a.matchId===r.matchId)).length,unplannedAttempts:unplanned.length},
  blocks,attempts:attempts.map(a=>({runId:a.runId,matchId:a.matchId,state:a.state,complete:a.complete&&a.recordVerified,winner:a.complete&&a.recordVerified?a.winner:null,incompleteReason:a.incompleteReason,recordVerified:a.recordVerified,recordRef:a.recordRef,issues:a.issues})),
  cost:cost(attempts),primary:{point:complete.length?columns.macro.reduce((s,x)=>s+x,0)/complete.length:null,independentBlocks:complete.length,input,intervalStatus:complete.length<2?'insufficient_complete_blocks':'pending_frozen_kernel',method:p.analysisMethod,limitedEvidence:true},
  deviations:[...allIssues,...unplanned.map(a=>'unplanned_attempt:'+a.matchId)],engineeringStatus:'summary_generated_only',absorptionStatus:'not_inferred_from_matches',researchQualified:null,
  limits:['Incomplete blocks excluded only from paired estimate and retained in inventory.','A positive point or interval does not authorize selection, extra samples or deployment.','Block counts are not independent training seeds.','Transport readiness is not scientific qualification.']};
}
/** Exact existing paired_stats.py kernel; no evaluatePolicy/model import. */
export function runFrozenInterval(input:any,output:string,pythonPath:string){
 if(input.unitIds.length<2)throw Error('at least two complete blocks required');
 if(!same(input.probabilities,[.025,.975]))throw Error('frozen 95% probabilities required');
 output=checkedOutput(output);mkdirSync(output,{recursive:true});const inPath=join(output,'paired-stats-input.json'),outPath=join(output,'paired-stats.json'),kernel=join(ROOT,'lab/review6/paired_stats.py');
 if(existsSync(inPath)||existsSync(outPath))throw Error('new statistics output required; do not overwrite prior evidence');
 writeFileSync(inPath,JSON.stringify(input)+'\n',{flag:'wx'});
 const result=spawnSync(pythonPath,[kernel,'paired','--input',inPath,'--output',outPath],{cwd:ROOT,encoding:'utf8',timeout:120000,env:{...process.env,OMP_NUM_THREADS:'2',PYTHONDONTWRITEBYTECODE:'1'}});
 if(result.status!==0)throw Error('frozen kernel failed; preserve input and inspect local stderr: '+result.stderr);
 const stats=JSON.parse(readFileSync(outPath,'utf8'));
 if(stats.inputSHA256!==sha256(readFileSync(inPath))||stats.sourceSHA256!==sha256(readFileSync(kernel))||stats.seed!==input.seed||stats.independentUnits!==input.unitIds.length||stats.implementation!=='r6-paired-percentile-type7-20k-v1'||stats.replicates!==20000||!same(stats.probabilities,input.probabilities))throw Error('frozen interval identity mismatch');
 return stats;
}
export function readFixedJSON(path:string,expectedSHA256:string){const bytes=readFileSync(path);if(sha256(bytes)!==expectedSHA256)throw Error('fixed input SHA mismatch');return JSON.parse(bytes.toString());}
/** Read ONLY public identity/journal bytes. Never load replay/private files or
 * execute replay, and never repair/append the source. SHA-bound B07 snapshots
 * are facts, not proof that an untrusted caller produced a legal engine game. */
export function readB07Run(path:string,expectedSHA256:string){
 const run=readFixedJSON(path,expectedSHA256);if(run.schema!=='ohuo-match-summary-v1'||!Array.isArray(run.matches))throw Error('B07 fixed run summary required');
 for(const k of ['runId','taskId','queueRef'])if(typeof run[k]!=='string'||!run[k]||run[k].length>240)throw Error('bounded run identity required');
 if(! /^[a-f0-9]{64}$/.test(run.taskSHA256)||typeof run.executionUnknown!=='boolean')throw Error('fixed run identity and execution status required');
 const runRoot=realpathSync(dirname(path)),attempts:AttemptFact[]=[];
 const entries=[...run.matches,...(run.activeMatch?[{matchId:run.activeMatch.matchId,recordRef:run.activeMatch.recordRef,result:run.activeMatch.partialResult,active:true}]:[])];
 for(const entry of entries)attempts.push(readB07PublicRecord(runRoot,run,entry));
 return {attempts,run:{runId:run.runId,taskId:run.taskId,taskSHA256:run.taskSHA256,queueRef:run.queueRef,executionUnknown:run.executionUnknown,consumption:run.consumption,source:{id:run.runId+'/summary',sha256:expectedSHA256}}};
}

/** The same public journal projection for a stored engineering parity record.
 * No Task/run summary is fabricated; this does not certify engine legality. */
export function readB07PublicRecord(runRoot:string,run:{runId:string;queueRef:string},entry:any):AttemptFact {
  const a:AttemptFact={runId:run.runId,matchId:entry.matchId,sourceRef:'',layoutRef:run.queueRef,state:entry.active?'active':'unknown',complete:false,winner:null,incompleteReason:entry.result?.incompleteReason??null,recordVerified:false,actualRoundFamilies:[],activeMatchLoopMs:numeric(entry.result?.wallSeconds)?entry.result.wallSeconds*1000:null,identitySHA256:null,resultIdentity:entry.result?Object.fromEntries(['layoutId','sourceFamilyId','actor','metric','group','side','variant'].map(k=>[k,entry.result[k]])):null,recordRef:null,wallMs:null,decisions:null,issues:[]};
  try{
   const ref=entry.recordRef;if(!ref)throw Error('public_record_missing');const dir=resolve(ref.directory);
   if(!dir.startsWith(runRoot+'/matches/')||realpathSync(dir)!==dir)throw Error('public_record_path_invalid');
   const idPath=join(dir,'identity.json'),eventsPath=join(dir,'events.jsonl');if(realpathSync(idPath)!==idPath||realpathSync(eventsPath)!==eventsPath)throw Error('public_record_symlink');
   const idBytes=readFileSync(idPath),bytes=readFileSync(eventsPath);if(sha256(idBytes)!==ref.identitySHA256||bytes.length!==ref.journalBytes||sha256(bytes)!==ref.journalSHA256)throw Error('public_record_identity_mismatch');
   a.recordRef={id:`${run.runId}/${entry.matchId}/events`,sha256:ref.journalSHA256};
   const identity=JSON.parse(idBytes.toString());if(identity.matchId!==a.matchId||identity.runId!==a.runId)throw Error('public_record_run_mismatch');a.sourceRef=identity.sourceRef;a.layoutRef=identity.layoutRef;
   if(!Array.isArray(identity.policyIds)||identity.policyIds.length!==4||!Array.isArray(identity.seatSnapshots)||identity.seatSnapshots.length!==4||!identity.rules)throw Error('full_frozen_policy_identity_missing');
   a.identitySHA256=sha256(JSON.stringify({sourceRef:identity.sourceRef,layoutRef:identity.layoutRef,policyIds:identity.policyIds,rules:identity.rules,seatSnapshots:identity.seatSnapshots}));
   if(bytes.length&&!bytes.toString().endsWith('\n'))throw Error('partial_public_record');
   const decisions=new Map<string,any>();let terminal:any=null,confirmedAtSummary=0;
   const resumableReasons=new Set(['user_stop','requested_stop','pause','run_boundary','lost_ownership','stale','cancelled']);
   for(const line of bytes.toString().split('\n').filter(Boolean)){
    const event=JSON.parse(line);
    if(terminal?.complete&&event.type!=='summary')throw Error('event_after_complete_summary');
    if(terminal&&!terminal.complete&&event.type!=='summary'&&!resumableReasons.has(terminal.incompleteReason))throw Error('event_after_nonresumable_summary');
    if(event.type==='game'){if(event.value.gameNo!==a.actualRoundFamilies.length+1||typeof event.value.sourceFamilyId!=='string'||!event.value.sourceFamilyId)throw Error('actual_round_ancestry_missing_or_out_of_order');a.actualRoundFamilies.push(event.value.sourceFamilyId);continue;}
    if(event.type==='summary'){
     const next=event.value,confirmed=[...decisions.values()].filter(d=>d.executionKind==='confirmed').length;
     if(typeof next?.complete!=='boolean'||next.complete&&(![0,1].includes(next.winner)||next.incompleteReason!==null)||!next.complete&&(next.winner!==null||typeof next.incompleteReason!=='string'))throw Error('invalid_terminal_summary');
     if(terminal?.complete&&!same(terminal,next))throw Error('conflicting_terminal_summary');
     if(terminal&&!terminal.complete&&!same(terminal,next)&&(!resumableReasons.has(terminal.incompleteReason)||next.complete&&confirmed<=confirmedAtSummary))throw Error('invalid_resumed_summary');
     terminal=next;confirmedAtSummary=confirmed;continue;
    }
    if(event.type!=='decision')throw Error('unknown_public_event');const d=event.value,key=JSON.stringify(d.key);
    if(d.key?.matchId!==a.matchId)throw Error('public_decision_identity_mismatch');const previous=decisions.get(key);
    if(!previous&&d.status!=='pending')throw Error('missing_decision_intent');
    if(previous&&['cancelled','halted'].includes(previous.status)&&!same(previous,d))throw Error('conflicting_terminal_decision');
    if(previous?.executionKind==='confirmed'&&(!same(previous.actualMove,d.actualMove)||d.executionKind!=='confirmed'))throw Error('conflicting_confirmed_action');
    decisions.set(key,d);
   }
   a.decisions=[...decisions.entries()].map(([id,d])=>({id,status:d.status,executionKind:d.executionKind,elapsedMs:numeric(d.elapsedMs)?d.elapsedMs:null,requests:(d.requests??[]).map((r:any)=>({requestCount:Number.isSafeInteger(r.requestCount)&&r.requestCount>=0?r.requestCount:null,usage:r.usage}))}));
   if(terminal?.complete&&(![0,1].includes(terminal.winner)||a.decisions.some(d=>d.status==='pending'||d.executionKind==='unknown')))throw Error('uncertain_terminal_winner');
   if(entry.result&&terminal&&['complete','winner','incompleteReason'].some(k=>entry.result[k]!==terminal[k]))throw Error('run_terminal_journal_mismatch');
   a.recordVerified=true;a.complete=terminal?.complete===true;a.winner=a.complete?terminal.winner:null;a.incompleteReason=terminal?.incompleteReason??a.incompleteReason;a.state=a.complete?'completed':entry.active?'active':'incomplete';
   // B07 may not record physical wall time. It remains unknown, not a sum of decisions.
   a.wallMs=null; // Whole task wall time is not recorded; active match loop timing is a separate metric.
  }catch(e){a.issues.push((e as Error).message.match(/^[a-z_]+$/)?.[0]??'public_record_unreadable_or_invalid');a.complete=false;a.winner=null;}
 return a;
}
