/** Fixed B07 host integration. No server/listener, arbitrary commands, learner,
 * task-supplied modules, default model, or automatic research authorization. */
import {readFileSync,realpathSync,writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import {DEFAULT_RULES,type GameState,type RuleOptions} from '@gd/engine';
import {createTaskController} from './task-control.mjs';
import {fail,strictObject,digest,validateIdentifier,validateSourceFamily,fixedReference} from './task-schema.mjs';
import {resolveNodePolicy,POLICY_REPOSITORY_ROOT} from './policy-loader';
import {loadStudentRelease} from './distill-policy';
import {frozenTeacherSnapshot} from './teacher-snapshot';
import {RELEASES,type ProfileRevisionRef} from '../../packages/ai/src/policy/seats';
import {LEGACY_O_POLICY_REF,type ResolvedPolicy} from '../../packages/ai/src/policy/resolve';
import {describeRules} from '../../packages/ai/src/hybrid/observation';
import {type DecisionBundle} from '../../packages/ai/src/hybrid/protocol';
import {type RemoteRequest} from '../../packages/ai/src/hybrid/remote-selector';
import {createProfileSelector} from '../../packages/web/server/llm-select.mjs';
import {dealtFamilyBeforeExchange} from '../review6/training-ancestry';
import {runCompleteMatchAsync} from './match-play-async';
import {createMatchStore,loadMatchStore,replayConfirmedMatch,publicMatchOutcome,type MatchStoreRef} from './match-record';

const zeroCost={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0};
const actualScope=(apiCalls=false)=>({localExecution:true,apiCalls,parameterUpdates:false,deployment:false});
const bounded=(v:any,name:string)=>{if(!Number.isSafeInteger(v)||v<1)throw Error(`finite positive ${name} required`);};
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export interface MatchQueueRow {matchId:string;layoutId:string;sourceFamilyId:string;split:string;seed:number;dealNamespace:string;roundFamilyIds:string[];actor:number;metric:string;group:number;side:number;variant:string;maxGames:number;maxMovesPerGame:number;seats:Array<{releaseRef:string;mode:'local'|'hybrid';profileRevisionRef:ProfileRevisionRef|null}>}
interface PreparedSeat {student?:Awaited<ReturnType<typeof loadStudentRelease>>;release:any;policy:ResolvedPolicy;profileRevisionRef:ProfileRevisionRef|null;frozenProfileStore?:any;profileSnapshot?:any}
interface Prepared {queue:any;rows:Array<MatchQueueRow&{runtimeSeats:PreparedSeat[]}>;rules:RuleOptions;sourceIndexPath:string;sourceIndexSHA256:string;sourceIndex:any}
interface RunCheckpoint {schema:'ohuo-match-run-v1';taskSHA256:string;queueRef:string;cursor:number;active:null|{matchId:string;kind:'local'|'hybrid';recordRef:MatchStoreRef|null;partialResult?:any};matches:Array<{matchId:string;recordRef:MatchStoreRef;result:any}>;executionUnknown:boolean}

/** The caller supplies authority/reference adapters, NOT the match algorithm. */
export function createMatchTaskHost({root,adapter,policyRepositoryRoot=POLICY_REPOSITORY_ROOT,profileStore}: {root:string;adapter:any;policyRepositoryRoot?:string;profileStore?:any}){
 const prepare=async({task,refs,inputs}:any):Promise<Prepared>=>{
  const rules=validateMatchRules(refs.get(task.rulesRef));
  const queue=refs.get(task.seatLayoutPlan);strictObject(queue,'matchQueue',['schema','namespace','sourceIndexRef','rows']);
  if(queue.rows?.length>10000||queue.schema!=='ohuo-complete-match-queue-v1'||queue.namespace!==task.sourcePlan.namespace||queue.sourceIndexRef!==task.sourcePlan.sourceIndexRef||!Array.isArray(queue.rows)||!queue.rows.length)throw Error('fixed complete-match queue identity/limit mismatch');
  const sourceRef=refs.get(task.sourcePlan.sourceIndexRef);strictObject(sourceRef,'sourceIndexRef',['schema','namespace','fileSHA256']);
  const sourceBytes=readFileSync(inputs.sourceIndexPath),sourceIndex=JSON.parse(sourceBytes.toString());
  if(sourceRef.schema!=='ohuo-source-index-ref-v1'||sourceRef.namespace!==task.sourcePlan.namespace||sha(sourceBytes)!==sourceRef.fileSHA256||sourceIndex.version!==1||!sourceIndex.families)throw Error('actual frozen source index differs');
  // Validate the entire original queue before projecting or resolving any
  // model/profile. A malformed non-owned partition is not silently skipped.
  const globalIds=new Set<string>();
  for(const row of queue.rows as MatchQueueRow[]){
   strictObject(row,'match',['matchId','layoutId','sourceFamilyId','split','seed','dealNamespace','roundFamilyIds','actor','metric','group','side','variant','maxGames','maxMovesPerGame','seats']);validateIdentifier(row.matchId,'matchId');validateIdentifier(row.layoutId,'layoutId');validateSourceFamily(row.sourceFamilyId,'sourceFamilyId');
   if(globalIds.has(row.matchId)||!['train','dev','confirm','fixture'].includes(row.split)||!Number.isSafeInteger(row.seed)||typeof row.dealNamespace!=='string'||!row.dealNamespace||!Number.isInteger(row.actor)||row.actor<0||row.actor>3||![0,1].includes(row.side)||!Number.isInteger(row.group)||row.group<0||typeof row.metric!=='string'||!row.metric||typeof row.variant!=='string'||!row.variant)throw Error('complete queue metadata/split differs');globalIds.add(row.matchId);bounded(row.maxGames,'maxGames');bounded(row.maxMovesPerGame,'maxMovesPerGame');
   if(!Array.isArray(row.roundFamilyIds))throw Error('complete queue round families missing');row.roundFamilyIds.forEach(id=>validateSourceFamily(id,'roundFamilyId'));assertFrozenRoundPlan(row,row.roundFamilyIds,sourceIndex,row.split==='confirm'?'sealed':row.split);
   if(!Array.isArray(row.seats)||row.seats.length!==4)throw Error('four AI seats required');for(const seat of row.seats){strictObject(seat,'seat',['releaseRef','mode','profileRevisionRef']);fixedReference(seat.releaseRef,'seat.releaseRef');if(!['local','hybrid'].includes(seat.mode)||seat.mode==='local'&&seat.profileRevisionRef!==null)throw Error('complete queue seat metadata differs');if(seat.mode==='hybrid'){strictObject(seat.profileRevisionRef,'profileRevisionRef',['profileId','revision','snapshotHash']);const p=seat.profileRevisionRef!;if(typeof p.profileId!=='string'||!p.profileId||!Number.isSafeInteger(p.revision)||p.revision<1||typeof p.snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(p.snapshotHash))throw Error('complete queue profile metadata differs');}}
  }
  const mixedTraining=queue.rows.every((r:MatchQueueRow)=>['train','dev'].includes(r.split));if(!mixedTraining&&queue.rows.some((r:MatchQueueRow)=>r.split!==task.sourcePlan.split||!task.sourcePlan.familyIds.includes(r.sourceFamilyId)))throw Error('mixed nontraining split queue forbidden');
  const ownedRows=(queue.rows as MatchQueueRow[]).filter(r=>r.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(r.sourceFamilyId));
  if(!ownedRows.length||task.sourcePlan.familyIds.some((id:string)=>!ownedRows.some(r=>r.roundFamilyIds.includes(id))))throw Error('empty queue projection or missing task family ancestry');if(ownedRows.length>task.limits.maxMatchAttempts)throw Error('owned queue projection exceeds task match limit');
  const split=task.sourcePlan.split==='confirm'?'sealed':task.sourcePlan.split,seen=new Set<string>(),policies=new Map<string,ResolvedPolicy>(),rows:Prepared['rows']=[];
  for(const row of ownedRows){
   strictObject(row,'match',['matchId','layoutId','sourceFamilyId','split','seed','dealNamespace','roundFamilyIds','actor','metric','group','side','variant','maxGames','maxMovesPerGame','seats']);
   validateIdentifier(row.matchId,'matchId');validateIdentifier(row.layoutId,'layoutId');
   if(seen.has(row.matchId)||!task.sourcePlan.familyIds.includes(row.sourceFamilyId)||row.split!==task.sourcePlan.split||!Number.isSafeInteger(row.seed)||typeof row.dealNamespace!=='string'||!row.dealNamespace||!Number.isInteger(row.actor)||row.actor<0||row.actor>3||![0,1].includes(row.side)||!Number.isInteger(row.group)||row.group<0||typeof row.metric!=='string'||!row.metric||typeof row.variant!=='string'||!row.variant)throw Error('match/source/layout identity mismatch');seen.add(row.matchId);
   bounded(row.maxGames,'maxGames');bounded(row.maxMovesPerGame,'maxMovesPerGame');
   assertFrozenRoundPlan(row,task.sourcePlan.familyIds,sourceIndex,split);
   if(!Array.isArray(row.seats)||row.seats.length!==4)throw Error('four AI seats required');const runtimeSeats:PreparedSeat[]=[];
   for(const seat of row.seats){
    strictObject(seat,'seat',['releaseRef','mode','profileRevisionRef']);if(!task.releaseRefs.includes(seat.releaseRef))throw Error('seat release not in frozen task');
    const frozen=refs.get(seat.releaseRef);
    if(frozen?.schema==='ohuo-student-task-release-v1'){runtimeSeats.push(await prepareStudentSeat({frozen,releasePath:inputs.studentReleasePaths?.[seat.releaseRef],repositoryRoot:policyRepositoryRoot,seat,taskKind:task.taskKind}));continue;}
    strictObject(frozen,'releaseRef',['schema','release','policyIdentity']);
    const release=RELEASES.find(r=>r.releaseRef===frozen.release?.releaseRef);
    if(frozen.schema!=='ohuo-release-ref-v1'||!release||!isDeepStrictEqual(frozen.release,release)||seat.mode!==release.mode||release.localSelector!=='proposal'||release.tier!=='hard')throw Error('unsupported or changed frozen release');
    if(!policies.has(release.proposalPolicyRef))policies.set(release.proposalPolicyRef,await resolveNodePolicy(release.proposalPolicyRef,policyRepositoryRoot));
    const policy=policies.get(release.proposalPolicyRef)!;if(!isDeepStrictEqual(JSON.parse(JSON.stringify(policy.identity)),frozen.policyIdentity))throw Error('loaded policy identity differs from task');
    let frozenProfileStore:any,profileSnapshot:any;
    const prompt=refs.get(task.promptRef);strictObject(prompt,'promptRef',['schema','promptRef']);if(prompt.schema!=='ohuo-prompt-ref-v1'||prompt.promptRef!==release.promptRef)throw Error('task prompt differs from fixed release');
    if(seat.mode==='hybrid'){
     if(task.taskKind!=='evaluate'||!task.operationScope.apiCalls||!profileStore||!seat.profileRevisionRef)throw Error('hybrid scope/profile missing');
     // Exact revision resolution and supported transport validation before start.
     const record=structuredClone(profileStore.resolve(seat.profileRevisionRef)),reference=structuredClone(seat.profileRevisionRef);
     frozenProfileStore={resolve:(candidate:any)=>{if(!isDeepStrictEqual(candidate,reference))throw Error('profile reference differs');return structuredClone(record);}};
     profileSnapshot=frozenTeacherSnapshot(createProfileSelector({store:frozenProfileStore,reference,fetchImpl:()=>{throw Error('preflight cannot send');}}).profile,record);
    }else if(seat.mode!=='local'||seat.profileRevisionRef!==null)throw Error('local seat cannot hide API settings');
    runtimeSeats.push({release,policy,profileRevisionRef:seat.profileRevisionRef,...(frozenProfileStore?{frozenProfileStore,profileSnapshot}:{})});
   }
   if(!requiresAsyncMatch(runtimeSeats)&&!isDeepStrictEqual(rules,DEFAULT_RULES))throw Error('legacy synchronous path supports exact DEFAULT_RULES only');
   rows.push({...structuredClone(row),runtimeSeats});
  }
  if(task.taskKind==='collect'&&rows.some(r=>r.seats.some(s=>s.mode!=='local')))throw Error('collect generation uses local complete matches only');
  return {queue,rows,rules:structuredClone(rules),sourceIndexPath:realpathSync(inputs.sourceIndexPath),sourceIndexSHA256:sourceRef.fileSHA256,sourceIndex};
 };
 const validateCheckpoint=(c:RunCheckpoint)=>!!c&&c.schema==='ohuo-match-run-v1'&&typeof c.taskSHA256==='string'&&typeof c.queueRef==='string'&&Number.isSafeInteger(c.cursor)&&c.cursor>=0&&Array.isArray(c.matches)&&c.matches.length===c.cursor&&typeof c.executionUnknown==='boolean'&&(c.active===null||!!c.active&&typeof c.active.matchId==='string'&&['local','hybrid'].includes(c.active.kind));
 const run=async(ctx:any)=>{
  const {task,signal,reserve,settleReservation,saveCheckpoint,executionInputs:p,deadlineMonotonicMs}=ctx as {task:any;signal:AbortSignal;reserve:any;settleReservation:any;saveCheckpoint:any;executionInputs:Prepared;deadlineMonotonicMs:number};
  let cp:RunCheckpoint=ctx.checkpoint?structuredClone(ctx.checkpoint):{schema:'ohuo-match-run-v1',taskSHA256:digest(task),queueRef:task.seatLayoutPlan,cursor:0,active:null,matches:[],executionUnknown:false};
  let sequence=ctx.checkpointSequence,apiInvoked=false,cleanupConfirmed=true;
  const writeSummary=()=>{
   const summary={schema:'ohuo-match-summary-v1',runId:task.runId,taskId:task.taskId,taskSHA256:cp.taskSHA256,queueRef:cp.queueRef,checkpointSequence:sequence,attemptsAtBoundary:cp.cursor,activeMatch:cp.active,completedMatches:cp.matches.filter(m=>m.result.complete).length,incompleteMatches:cp.matches.filter(m=>!m.result.complete).length,optimizerSteps:0,consumption:ctx.getConsumption(),matches:cp.matches,executionUnknown:cp.executionUnknown,metricStatus:'raw complete-match outcomes only; paired statistics belong to B08'};
   const path=join(task.outputRoot,'summary.json'),temporary=`${path}.tmp-${process.pid}-${sequence}`;writeFileSync(temporary,JSON.stringify(summary),{flag:'wx',mode:0o600});renameSync(temporary,path);
   return {path,sha256:sha(readFileSync(path)),purpose:'actual confirmed match outcomes and counters, not scientific qualification'};
  };
  const checkpoint=async()=>{await saveCheckpoint(cp,++sequence);writeSummary();};
  const meters:Array<{drain:()=>Promise<void>}>=[];
  const drain=async()=>{for(const meter of meters)await meter.drain();};
  try{
   if(cp.taskSHA256!==digest(task)||cp.queueRef!==task.seatLayoutPlan||cp.executionUnknown||cp.cursor>p.rows.length||cp.active&&(cp.active.matchId!==p.rows[cp.cursor]?.matchId||cp.active.kind==='local'||cp.active.recordRef===null))throw Error('execution_uncertain: incomplete or mismatched recovery boundary');
   for(const past of cp.matches)loadMatchStore(past.recordRef,task.outputRoot);
   for(;cp.cursor<p.rows.length;){
    if(signal.aborted||performance.now()>=deadlineMonotonicMs)break;
    if(sha(readFileSync(p.sourceIndexPath))!==p.sourceIndexSHA256)throw Error('source index changed after freeze');
    const row=p.rows[cp.cursor],hybrid=requiresAsyncMatch(row.runtimeSeats);
    const identity={runId:task.runId,matchId:row.matchId,sourceRef:task.sourcePlan.sourceIndexRef,layoutRef:task.seatLayoutPlan,policyIds:row.runtimeSeats.map(actualSeatPolicyId),rules:p.rules,sourceFamilyId:row.sourceFamilyId,split:row.split,evaluatedActor:row.actor,seatSnapshots:row.runtimeSeats.map((s,i)=>({releaseRef:row.seats[i].releaseRef,release:s.release,policyIdentity:JSON.parse(JSON.stringify(s.policy.identity)),...(s.student?{studentRelease:s.student.release,studentReleaseSHA256:s.student.releaseSHA256}:{}),profileRevisionRef:s.profileRevisionRef,...(s.profileSnapshot?{profileSnapshot:s.profileSnapshot}:{})}))};
    let store:any;
    if(cp.active){store=loadMatchStore(cp.active.recordRef!,task.outputRoot);const saved=store.recorder.snapshot();for(const field of ['runId','matchId','sourceRef','layoutRef','policyIds','rules','seatSnapshots','sourceFamilyId','split','evaluatedActor'] as const)if(!isDeepStrictEqual(saved.record[field],identity[field]))throw Error('recovery record identity differs');const replay=replayConfirmedMatch(saved.record,saved.privateSources);if(replay.executionUnknown||!replay.state)throw Error('execution_uncertain: no confirmed replay origin');}
    else{
     const reservation=await reserve(`match-${cp.cursor}-${ctx.executionId}`,{...zeroCost,matchAttempts:1});
     if(signal.aborted){await settleReservation(reservation,{disposition:'not_sent',evidence:{kind:'confirmed_not_sent'}});break;}
     if(hybrid)store=createMatchStore(task.outputRoot,identity);
     cp.active={matchId:row.matchId,kind:hybrid?'hybrid':'local',recordRef:store?.ref()??null};await checkpoint();
     await settleReservation(reservation,{disposition:'consumed',evidence:{kind:'match_started'}});
    }
    let result:any,recordRef:MatchStoreRef;
    if(!hybrid){
     const value=await runOwnedLocalMatch({row,identity,policyRepositoryRoot,sourceIndexPath:p.sourceIndexPath,sourceIndexSHA256:p.sourceIndexSHA256,policyIdentities:row.runtimeSeats.map(s=>s.policy.identity),policyRefs:row.runtimeSeats.map(s=>s.release.proposalPolicyRef),outputRoot:task.outputRoot,deadlineEpochMs:Date.now()+Math.max(0,deadlineMonotonicMs-performance.now())});
     result=value.result;recordRef=value.recordRef;
    }else{
     const requestForDecision=(seat:number,bundle:DecisionBundle,cancel:(reason:string)=>void):RemoteRequest=>{
      const meter=createMeteredRemote({store:row.runtimeSeats[seat].frozenProfileStore,reference:row.runtimeSeats[seat].profileRevisionRef,reserve,settleReservation,cancel,keyPrefix:`m${cp.cursor}-q${bundle.key.requestSeq}`,ownerSignal:signal,onSent:()=>{apiInvoked=true;}});
      meters.push(meter);
      return meter.request;
     };
     const snapshot=store.recorder.snapshot();
     result=await runCompleteMatchAsync({...identity,generation:`${task.runId}-resume-${sequence}`,seed:row.seed,dealNamespace:row.dealNamespace,maxGames:row.maxGames,maxMovesPerGame:row.maxMovesPerGame,actor:row.actor,signal,deadlineMonotonicMs,recorder:store.recorder,
      ...(snapshot.record.games.length?{resume:snapshot}:{}),seats:row.runtimeSeats.map(s=>({policyId:actualSeatPolicyId(s),source:s.student?'S' as const:s.policy.identity.policyId===LEGACY_O_POLICY_REF?'O' as const:'B' as const,mode:s.release.mode,decider:s.policy.createDecider(row.runtimeSeats.indexOf(s)),encoder:s.policy.encoder,policyIdentity:s.policy.identity,...(s.student?{localSelector:s.student.selectInitialAction}:{})})),requestForDecision,
      beforeGame:state=>assertFrozenRound(row,state,p.sourceIndex,p.sourceIndexPath,p.sourceIndexSHA256),
      afterBoundary:async()=>{cp.active!.recordRef=store.ref();await checkpoint();},drain});
     recordRef=store.ref();
    }
    if(hybrid&&cp.active?.partialResult)result.wallSeconds+=cp.active.partialResult.wallSeconds;
    result=publicMatchOutcome(result);
    const disposition=matchEndDisposition(result);
    if(hybrid&&disposition!=='finished_attempt'){
     cp.active!.recordRef=recordRef;cp.active!.partialResult=result;
     if(disposition==='halt'){cp.executionUnknown=true;await checkpoint();throw Error(`execution_uncertain: ${result.incompleteReason}`);}
     await checkpoint();break; // same source/match resumes; no second match attempt.
    }
    cp.matches.push({matchId:row.matchId,recordRef,result:{...result,layoutId:row.layoutId,sourceFamilyId:row.sourceFamilyId,actor:row.actor,metric:row.metric,group:row.group,side:row.side,variant:row.variant}});cp.cursor++;cp.active=null;await checkpoint();
    if(signal.aborted||performance.now()>=deadlineMonotonicMs||result.incompleteReason==='execution_uncertain')break;
   }
   return {completed:cp.cursor===p.rows.length,cleanupConfirmed,actualScope:actualScope(apiInvoked),stopReason:signal.aborted?(typeof signal.reason==='string'?signal.reason:'user_stop'):'run_boundary',artifactRefs:[writeSummary(),...cp.matches.map(m=>m.recordRef)]};
  }catch(error){
   cp.executionUnknown=true;try{await drain();}catch{};try{await checkpoint();}catch{};
   Object.assign(error as object,{cleanupConfirmed,actualScope:actualScope(apiInvoked)});throw error;
  }
 };
 return (createTaskController as any)({root,adapter,consumers:['collect','evaluate'].map(kind=>({id:'B07.complete-match.v1',kind,mode:'research',prepare,validateCheckpoint,run}))});
}
export function assertFrozenRound(row:MatchQueueRow,state:GameState,index:any,indexPath:string,indexSHA256:string){
 if(sha(readFileSync(indexPath))!==indexSHA256||dealtFamilyBeforeExchange(state)!==row.roundFamilyIds[state.match.gameNo-1]||index.families[row.roundFamilyIds[state.match.gameNo-1]]?.split!==(row.split==='confirm'?'sealed':row.split))throw Error('actual round ancestry/source split differs');
 return row.roundFamilyIds[state.match.gameNo-1];
}
/** One owned worker, no pool. stop is intentionally a match-boundary operation;
 * the existing sync runner enforces its own deadline and caps. */
export async function runOwnedLocalMatch(job:any){
 return awaitOwnedMatchWorker(new Worker(new URL('./match-local-worker.ts',import.meta.url),{workerData:job,execArgv:['--import','tsx']}));
}
export async function awaitOwnedMatchWorker(worker:Worker){
 let result:any,error:Error|null=null;
 await new Promise<void>(resolve=>{
  worker.on('message',message=>{if(message.kind==='result')result=message;else if(message.kind==='failure')error=Error(message.reason);else error=Error('unknown owned worker response');});
  worker.on('error',e=>{error=e instanceof Error?e:Error(String(e));});worker.once('exit',code=>{if(code!==0&&!error)error=Error(`owned worker exited ${code}`);resolve();});
 });
 if(error||!result)throw Object.assign(error??Error('execution_uncertain: worker exited without confirmed result'),{cleanupConfirmed:true});
 return {result:result.result,recordRef:result.recordRef};
}

/** Actual Node send boundary, distinct from B04's adapter-invocation count.
 * Injected fetch exists only as a trusted host/test dependency, never TaskFile. */
export function createMeteredRemote({store,reference,reserve,settleReservation,cancel,keyPrefix,ownerSignal,onSent=()=>{},fetchImpl=globalThis.fetch}:any):{request:RemoteRequest;drain:()=>Promise<void>}{
 const active=new Set<Promise<unknown>>();let accountingError:unknown=null,ordinal=0;
 const drain=async()=>{while(active.size)await Promise.allSettled([...active]);if(accountingError)throw accountingError;};
 const request:RemoteRequest=async(view,signal)=>{
  const requestNumber=++ordinal;let sent:0|1|null=0;
  const selector=createProfileSelector({store,reference,fetchImpl:(...args:any[])=>{
   const work=(async()=>{
    let reservation:string;
    try{reservation=await reserve(`${keyPrefix}-r${requestNumber}`,{...zeroCost,providerRequests:1,labelDecisions:requestNumber===1?1:0});}
    catch(error){cancel((error as any)?.reason==='run_boundary'?'run_boundary':'lost_ownership');throw error;}
    if(signal.aborted||ownerSignal.aborted){try{await settleReservation(reservation,{disposition:'not_sent',evidence:{kind:'confirmed_not_sent'}});}catch(error){accountingError=error;}throw Error('cancelled before upstream');}
    let response:Promise<Response>;
    try{response=fetchImpl(args[0],args[1]);sent=1;onSent();}
    catch(error){sent=null;try{await settleReservation(reservation,{disposition:'unknown',evidence:{kind:'execution_unknown'}});}catch(settlementError){accountingError=settlementError;}cancel('execution_uncertain');throw error;}
    const observed=Promise.resolve(response).then(value=>({value}),error=>({error}));
    try{await settleReservation(reservation,{disposition:'consumed',evidence:{kind:'upstream_invoked'}});}catch(error){accountingError=error;cancel('execution_uncertain');throw error;}
    return {observed}; // Local ownership waits for settlement, not a peer/socket.
   })();active.add(work);void work.finally(()=>active.delete(work)).catch(()=>{});
   return work.then(async({observed})=>{const outcome=await observed;if('error'in outcome)throw outcome.error;return outcome.value;});
  }});
  const result=await selector.request(view,signal);await drain();return {...result,summary:{...result.summary,requestCount:sent}} as any;
 };
 return {request,drain};
}

export function matchEndDisposition(result:{complete:boolean;incompleteReason:string|null}):'finished_attempt'|'pause'|'halt'{
 if(result.complete||['round_move_cap','match_game_cap','deadline'].includes(result.incompleteReason??''))return 'finished_attempt';
 return ['user_stop','requested_stop','pause','run_boundary','lost_ownership','stale','cancelled'].includes(result.incompleteReason??'')?'pause':'halt';
}

export function validateMatchRules(value:any):RuleOptions{
 strictObject(value,'rules',['levelMode','passA','pairSeqMin','pairSeqMax','trioSeqMin','trioSeqMax','flushLen','straightLen']);
 if(!['stage','both','high'].includes(value.levelMode)||!['head','head3','double'].includes(value.passA)||['pairSeqMin','pairSeqMax','trioSeqMin','trioSeqMax','flushLen','straightLen'].some(k=>!Number.isSafeInteger(value[k])||value[k]<1)||value.pairSeqMin>value.pairSeqMax||value.trioSeqMin>value.trioSeqMax)throw Error('invalid actual match rules');
 return structuredClone(value);
}

export function assertFrozenRoundPlan(row:Pick<MatchQueueRow,'roundFamilyIds'|'maxGames'|'sourceFamilyId'>,familyIds:string[],index:any,split:string){
 if(!Array.isArray(row.roundFamilyIds)||row.roundFamilyIds.length!==row.maxGames||row.roundFamilyIds[0]!==row.sourceFamilyId||row.roundFamilyIds.some(id=>!familyIds.includes(id)||index.families[id]?.split!==split))throw Error('frozen round ancestry/split missing');
}

/** Complete S identity is separate from its fixed B proposal identity. */
export async function prepareStudentSeat({frozen,releasePath,repositoryRoot,seat,taskKind}:any):Promise<PreparedSeat>{
 strictObject(frozen,'studentRelease',['schema','policyId','releaseSHA256']);
 if(frozen.schema!=='ohuo-student-task-release-v1'||taskKind!=='evaluate'||seat.mode!=='local'||seat.profileRevisionRef!==null||typeof releasePath!=='string')throw Error('student requires explicit local evaluation release');
 const student=await loadStudentRelease(releasePath,frozen.releaseSHA256,repositoryRoot);
 if(student.release.policyId!==frozen.policyId)throw Error('student actual policy identity mismatch');
 const release={releaseRef:seat.releaseRef,mode:'local',proposalPolicyRef:student.basePolicy.identity.policyId,localSelector:'student',candidateSpecRef:student.release.candidateSpecRef,tier:'hard',status:'development'};
 return {student,release,policy:student.basePolicy,profileRevisionRef:null};
}
export function requiresAsyncMatch(seats:Array<{release:{mode:string};student?:unknown}>){return seats.some(s=>s.release.mode==='hybrid'||!!s.student);}
function actualSeatPolicyId(seat:PreparedSeat){return seat.student?.release.policyId??seat.policy.identity.policyId;}
