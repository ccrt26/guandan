/** Fixed offline teacher producer. Same B06 controller/ledger; no action executor,
 * model load, dynamic plugins, or web control. Inputs must predate all labels. */
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,readdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {createTaskController} from './task-control.mjs';
import {digest,strictObject} from './task-schema.mjs';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {createProfileSelector} from '../../packages/web/server/llm-select.mjs';
import {createMeteredRemote,validateMatchRules} from './match-consumer';
import {frozenTeacherSnapshot} from './teacher-snapshot';
import {hashJSON} from './match-record';
import {readOfflineSnapshot,queryOfflineTeacher,type SelectedRecordedDecision,type OfflineSnapshot} from './offline-label-source';
import type {DatasetIdentities} from './distill-data';
import {verifyOfflineSelection} from './offline-selection';
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const scope=(apiCalls=false)=>({localExecution:true,apiCalls,parameterUpdates:false,deployment:false});
const plainFile=(path:string)=>{const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink())throw Error('regular immutable file required');return readFileSync(path);};
interface Prepared {selection:any;snapshots:OfflineSnapshot[];teacher:DatasetIdentities['teacher'];store:any;reference:any;sourceIndexPath:string;sourceIndexSHA256:string}
interface Checkpoint {schema:'ohuo-offline-label-run-v1';taskSHA256:string;selectionRef:string;cursor:number;active:null|{index:number;inputSHA256:string};rows:any[];executionUnknown:boolean}
export function createOfflineLabelConsumer({profileStore,mode='research',fetchImpl}:{profileStore:any;mode?:'research'|'offline_synthetic';fetchImpl?:typeof fetch}){
 if(!profileStore||!['research','offline_synthetic'].includes(mode)||mode==='offline_synthetic'&&typeof fetchImpl!=='function')throw Error('explicit supported profile store/mode/fake transport required');
 const prepare=async({task,refs,inputs}:any):Promise<Prepared>=>{
  if(task.taskKind!=='collect'||task.operationScope.apiCalls!==(mode==='research')||task.datasetRefs.length!==1||task.limits.maxOptimizerSteps!==0||task.limits.maxMatchAttempts!==0)throw Error('offline label scope/limits differ');
  const fullSelection=refs.get(task.datasetRefs[0]);let selection=fullSelection;
  if(fullSelection?.schema==='ohuo-offline-label-selection-v2'){
   if(!inputs.offlineSelection||inputs.offlineSelection.mode!==mode||!['label-start','label-resume'].includes(inputs.offlineSelection.phase))throw Error('fixed offline selection trusted inputs/mode required');
   const proof=verifyOfflineSelection(fullSelection,{...inputs.offlineSelection,task});
   if(proof.production.verification!=='reproduced')throw Error('offline selection population incomplete');
   const families=[...new Set(proof.population.filter(p=>p.split===task.sourcePlan.split).map(p=>p.familyId))].sort();
   if(!task.sourcePlan.familyIds.length||task.sourcePlan.familyIds.some((id:string)=>!families.includes(id)))throw Error('offline selection split projection family scope differs');
   const rows=fullSelection.rows.filter((r:any)=>r.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(r.familyId)),quotas=fullSelection.quotas.filter((q:any)=>task.sourcePlan.familyIds.includes(q.familyId));
   selection={...fullSelection,rows,quotas,selectedCount:rows.length};
  }else if(mode==='research')throw Error('research offline labels require selection v2 production proof');
  strictObject(selection,'selection',['schema','sourceIndexRef','queueRef','purpose','selectedCount','quotas','rows',...(selection.schema==='ohuo-offline-label-selection-v2'?['productionRef']:[])]);
  if(!['ohuo-offline-label-selection-v1','ohuo-offline-label-selection-v2'].includes(selection.schema)||selection.sourceIndexRef!==task.sourcePlan.sourceIndexRef||selection.queueRef!==task.seatLayoutPlan||!['b_training_source','distribution_diagnostic'].includes(selection.purpose)||!Array.isArray(selection.rows)||!selection.rows.length||selection.rows.length>10000||selection.selectedCount!==selection.rows.length||!Array.isArray(selection.quotas))throw Error('frozen selection list required');
  const indexRef=refs.get(task.sourcePlan.sourceIndexRef),sourceIndexPath=realpathSync(inputs.sourceIndexPath),sourceBytes=plainFile(sourceIndexPath),index=JSON.parse(sourceBytes.toString());
  strictObject(indexRef,'sourceIndexRef',['schema','namespace','fileSHA256']);
  if(indexRef.schema!=='ohuo-source-index-ref-v1'||indexRef.namespace!==task.sourcePlan.namespace||sha(sourceBytes)!==indexRef.fileSHA256||index.version!==1||!['train','dev'].includes(task.sourcePlan.split))throw Error('offline source index/split differs');
  const queue=refs.get(task.seatLayoutPlan);if(queue?.schema!=='ohuo-complete-match-queue-v1'||queue.namespace!==task.sourcePlan.namespace||queue.sourceIndexRef!==task.sourcePlan.sourceIndexRef||!Array.isArray(queue.rows))throw Error('original frozen complete-match queue required');
  const rules=validateMatchRules(refs.get(task.rulesRef));
  const proposer=refs.get(task.parentPolicyRef);strictObject(proposer,'parentPolicyRef',['schema','release','policyIdentity']);
  const base=RELEASES.find(r=>r.releaseRef===proposer.release?.releaseRef);
  if(proposer.schema!=='ohuo-release-ref-v1'||!base||!equal(base,proposer.release)||base.mode!=='local'||base.localSelector!=='proposal'||base.tier!=='hard')throw Error('fixed B proposer identity required');
  const teacherRef=refs.get(task.labelPolicyRef);strictObject(teacherRef,'teacher',['schema','releaseRef','profileRevisionRef']);
  if(teacherRef.schema!=='ohuo-offline-teacher-ref-v1'||!task.releaseRefs.includes(teacherRef.releaseRef))throw Error('frozen teacher reference required');
  const releaseRef=refs.get(teacherRef.releaseRef);strictObject(releaseRef,'teacherRelease',['schema','release','policyIdentity']);
  const release=RELEASES.find(r=>r.releaseRef===releaseRef.release?.releaseRef),prompt=refs.get(task.promptRef);strictObject(prompt,'prompt',['schema','promptRef']);
  if(releaseRef.schema!=='ohuo-release-ref-v1'||!release||!equal(release,releaseRef.release)||release.mode!=='hybrid'||release.localSelector!=='proposal'||release.tier!=='hard'||release.proposalPolicyRef!==base.proposalPolicyRef||!equal(releaseRef.policyIdentity,proposer.policyIdentity)||prompt.schema!=='ohuo-prompt-ref-v1'||prompt.promptRef!==release.promptRef)throw Error('teacher/proposer/prompt identity differs');
  const reference=structuredClone(teacherRef.profileRevisionRef),privateRecord=structuredClone(profileStore.resolve(reference));
  const store={resolve:(ref:any)=>{if(!equal(ref,reference))throw Error('frozen teacher profile reference differs');return structuredClone(privateRecord);}};
  const selector=createProfileSelector({store,reference,fetchImpl:()=>{throw Error('prepare cannot send');}});
  const teacher={releaseRef:teacherRef.releaseRef,promptRef:prompt.promptRef,profileSnapshot:frozenTeacherSnapshot(selector.profile,privateRecord)};
  if(!Array.isArray(inputs.confirmedRecordRoots)||!inputs.confirmedRecordRoots.length)throw Error('independently verified original record roots required');
  const roots=inputs.confirmedRecordRoots.map((p:string)=>realpathSync(p)),cache=new Map(),seen=new Set<string>(),counts=new Map<string,number>(),snapshots:OfflineSnapshot[]=[];
  for(const row of selection.rows as SelectedRecordedDecision[]){
   strictObject(row,'selected decision',['recordRef','recordRoot','key','inputSHA256','familyId','split','actorSeat']);
   const id=hashJSON(row.key);if(seen.has(id)||!roots.includes(realpathSync(row.recordRoot))||row.split!==task.sourcePlan.split||!task.sourcePlan.familyIds.includes(row.familyId)||index.families?.[row.familyId]?.split!==row.split)throw Error('selection duplicate/root/family/split differs');seen.add(id);
   const s=readOfflineSnapshot(row,cache),sourceRows=queue.rows.filter((q:any)=>q.matchId===row.key.matchId),q=sourceRows[0];
   if(sourceRows.length!==1||q.actor!==row.actorSeat||q.split!==row.split||q.roundFamilyIds?.[row.key.gameNo-1]!==row.familyId||s.record.sourceRef!==selection.sourceIndexRef||s.record.layoutRef!==selection.queueRef||!equal(s.record.rules,rules))throw Error('original queue/record/actor/game binding differs');
   const x=s.input.candidateInputs,seat=s.record.seatSnapshots?.[row.actorSeat] as any;
   if(!x||!equal(x.policyIdentity,proposer.policyIdentity)||x.policyId!==proposer.policyIdentity.policyId||!equal(x.candidateIds,s.bundle.initialCandidateIds))throw Error('original proposal capture identity differs');
   if(selection.purpose==='b_training_source'&&(s.input.policyId!==proposer.policyIdentity.policyId||s.decision.policyId!==proposer.policyIdentity.policyId||!equal(seat?.policyIdentity,proposer.policyIdentity)||s.decision.actualSource!=='B'))throw Error('B training-source selection cannot relabel other acting policies');
   if(selection.purpose==='distribution_diagnostic'){
    if(selection.rows.length>64)throw Error('S diagnostic limit is 64 fixed decisions, not new training data');
    assertDiagnosticIdentity({snapshot:s,seat,queueSeat:q.seats?.[row.actorSeat],task,refs,inputs,proposer});
   }
   counts.set(row.familyId,(counts.get(row.familyId)??0)+1);snapshots.push(s);
  }
  const quotas=new Map<string,number>();for(const q of selection.quotas){strictObject(q,'quota',['familyId','count']);if(quotas.has(q.familyId)||!Number.isSafeInteger(q.count)||q.count<1)throw Error('frozen family quota invalid');quotas.set(q.familyId,q.count);}
  if(!equal([...counts].sort(),[...quotas].sort()))throw Error('frozen family quota differs');
  if(snapshots.filter(s=>!s.bundle.isUniqueLegalAction).length>task.limits.maxLabelDecisions)throw Error('frozen selection exceeds label quota');
  return {selection:structuredClone(selection),snapshots,teacher,store,reference,sourceIndexPath,sourceIndexSHA256:indexRef.fileSHA256};
 };
 const validateCheckpoint=(c:Checkpoint)=>!!c&&c.schema==='ohuo-offline-label-run-v1'&&typeof c.taskSHA256==='string'&&typeof c.selectionRef==='string'&&Number.isSafeInteger(c.cursor)&&c.cursor>=0&&Array.isArray(c.rows)&&c.rows.length===c.cursor&&typeof c.executionUnknown==='boolean'&&(c.active===null||!!c.active&&c.active.index===c.cursor&&typeof c.active.inputSHA256==='string');
 const run=async(ctx:any)=>{
  const {task,signal,executionInputs:p}=ctx as {task:any;signal:AbortSignal;executionInputs:Prepared};
  let cp:Checkpoint=ctx.checkpoint?structuredClone(ctx.checkpoint):{schema:'ohuo-offline-label-run-v1',taskSHA256:digest(task),selectionRef:task.datasetRefs[0],cursor:0,active:null,rows:[],executionUnknown:false};
  let sequence=ctx.checkpointSequence,apiInvoked=false;const meters:Array<{drain:()=>Promise<void>}>=[],labels=join(task.outputRoot,'labels');mkdirSync(labels,{recursive:true,mode:0o700});
  const save=async()=>ctx.saveCheckpoint(cp,++sequence);
  const summary=()=>{const path=join(task.outputRoot,'offline-summary.json'),value={schema:'ohuo-offline-label-summary-v1',runId:task.runId,taskSHA256:cp.taskSHA256,selectionRef:cp.selectionRef,purpose:p.selection.purpose,cursor:cp.cursor,total:p.snapshots.length,rows:cp.rows,executionUnknown:cp.executionUnknown,consumption:ctx.getConsumption(),interpretation:'teacher suggestions only, never executed; no strength or training qualification claim'},tmp=`${path}.tmp-${process.pid}-${sequence}`;writeFileSync(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(tmp,path);return{path,sha256:sha(readFileSync(path)),purpose:'fixed offline selection terminals; private labels separately hash-bound'};};
  try{
   if(!validateCheckpoint(cp)||cp.taskSHA256!==digest(task)||cp.selectionRef!==task.datasetRefs[0]||cp.executionUnknown||cp.active||cp.cursor>p.snapshots.length)throw Error('execution_uncertain: no clean offline query boundary');
   const files=readdirSync(labels).sort(),expected=cp.rows.map((_:any,i:number)=>`q${i}.json`).sort();if(!equal(files,expected))throw Error('execution_uncertain: uncheckpointed offline result');
   for(let i=0;i<cp.rows.length;i++){const r=cp.rows[i];if(r.resultRef.path!==join(labels,`q${i}.json`)||sha(plainFile(r.resultRef.path))!==r.resultRef.sha256||!equal(r.key,p.snapshots[i].row.key)||r.inputSHA256!==p.snapshots[i].row.inputSHA256)throw Error('offline terminal checkpoint identity differs');}
   while(cp.cursor<p.snapshots.length){
    if(signal.aborted||performance.now()>=ctx.deadlineMonotonicMs)break;
    if(sha(plainFile(p.sourceIndexPath))!==p.sourceIndexSHA256)throw Error('source index changed');
    const s=p.snapshots[cp.cursor];cp.active={index:cp.cursor,inputSHA256:s.row.inputSHA256};await save();
    const local=new AbortController(),abort=()=>local.abort(signal.reason??'user_stop');signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    const timer=setTimeout(()=>local.abort('run_boundary'),Math.max(0,ctx.deadlineMonotonicMs-performance.now()));
    let result:Awaited<ReturnType<typeof queryOfflineTeacher>>|null=null,unknown=false;
    const meter=createMeteredRemote({store:p.store,reference:p.reference,reserve:ctx.reserve,settleReservation:ctx.settleReservation,cancel:(r:string)=>local.abort(r),keyPrefix:`l${cp.cursor}-${ctx.executionId}`,ownerSignal:signal,onSent:()=>{if(mode==='research')apiInvoked=true;},...(fetchImpl?{fetchImpl}:{})});meters.push(meter);
    try{result=await queryOfflineTeacher({snapshot:s,teacher:p.teacher,request:meter.request,signal:local.signal});await meter.drain();unknown=local.signal.reason==='execution_uncertain'||result.remote?.attempts.some(a=>a.requestCount===null)===true;}
    catch{unknown=true;try{await meter.drain();}catch{}}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
    const terminal={schema:'ohuo-offline-label-result-v1',purpose:p.selection.purpose,selectionRef:cp.selectionRef,index:cp.cursor,source:s.row,inputSHA256:s.row.inputSHA256,key:s.row.key,decisionId:s.bundle.decisionId,acting:{policyId:s.decision.policyId,seatSnapshot:s.record.seatSnapshots?.[s.row.actorSeat]??null,actionId:s.decision.actualActionId,move:s.decision.actualMove},proposal:{policyId:s.input.candidateInputs!.policyId,policyIdentity:s.input.candidateInputs!.policyIdentity},teacher:p.teacher,status:unknown?'execution_uncertain':result!.status,labelKind:!unknown&&result?.offlineLabel?.legality==='validated'?'offline_suggested':null,remote:result?.remote??null,offlineLabel:unknown?null:result?.offlineLabel??null};
    const path=join(labels,`q${cp.cursor}.json`),bytes=JSON.stringify(terminal);writeFileSync(path,bytes,{flag:'wx',mode:0o600});
    const selected=!unknown&&result?.remote?.status==='selected'?result.remote:null,seat=s.record.seatSnapshots?.[s.row.actorSeat] as any;
    cp.rows.push({key:s.row.key,inputSHA256:s.row.inputSHA256,familyId:s.row.familyId,split:s.row.split,actorSeat:s.row.actorSeat,actingPolicyId:s.decision.policyId,proposalPolicyIdentity:s.input.candidateInputs!.policyIdentity,actingReleaseRef:seat?.releaseRef??null,studentReleaseSHA256:seat?.studentReleaseSHA256??null,scorerWeightsSHA256:seat?.studentRelease?.scorer?.weightsSHA256??null,studentCheckpointSHA256:seat?.studentRelease?.checkpoint?.sha256??null,actualActionId:s.decision.actualActionId,teacherActionId:selected?.actionId??null,teacherReleaseRef:p.teacher.releaseRef,inInitialCandidateSet:selected?.inInitialCandidateSet??null,actionAgreement:selected?selected.actionId===s.decision.actualActionId:null,status:terminal.status,reason:unknown?'execution_uncertain':result?.remote&&result.remote.status!=='selected'?result.remote.reason:null,labelKind:terminal.labelKind,requestCount:unknown?null:result?.remote?result.remote.requestCount:0,resultRef:{path,sha256:sha(bytes)}});cp.cursor++;cp.active=null;cp.executionUnknown=unknown;await save();
    if(unknown)throw Error('execution_uncertain: offline request result unknown');
    if(local.signal.aborted||result?.status==='halted')break;
    await new Promise<void>(resolve=>setImmediate(resolve));
   }
   return {completed:cp.cursor===p.snapshots.length,cleanupConfirmed:true,actualScope:scope(apiInvoked),stopReason:signal.aborted?String(signal.reason??'user_stop'):'run_boundary',artifactRefs:[summary()]};
  }catch(error){
   cp.executionUnknown=true;await Promise.allSettled(meters.map(m=>m.drain()));try{await save();}catch{}
   Object.assign(error as object,{cleanupConfirmed:true,actualScope:scope(apiInvoked)});throw error;
  }
 };
 return {id:'B07.offline-label.v1',kind:'collect',mode,prepare,validateCheckpoint,run};
}
/** Read-only identity binding, not a second student loader: the trusted source
 * host already produced this confirmed S action. Read only its frozen release
 * JSON, never scorer weights/checkpoints or forward. S stays outside B09 admit. */
export function assertDiagnosticIdentity({snapshot:s,seat,queueSeat,task,refs,inputs,proposer}:any){
 if(!seat||!task.releaseRefs.includes(seat.releaseRef)||queueSeat?.releaseRef!==seat.releaseRef||queueSeat.mode!=='local'||queueSeat.profileRevisionRef!==null)throw Error('diagnostic original acting seat differs');
 const ref=refs.get(seat.releaseRef);strictObject(ref,'studentRef',['schema','policyId','releaseSHA256']);
 const path=inputs.studentReleasePaths?.[seat.releaseRef];if(typeof path!=='string'||realpathSync(path)!==path)throw Error('independently verified fixed student release path required');
 const bytes=plainFile(path),release=JSON.parse(bytes.toString());
 if(ref.schema!=='ohuo-student-task-release-v1'||sha(bytes)!==ref.releaseSHA256||seat.studentReleaseSHA256!==ref.releaseSHA256||!equal(release,seat.studentRelease)||release.schema!=='ohuo-student-release-v1'||release.trainingKind!=='supervised_rerank'||release.policyId!==ref.policyId||release.policyId===proposer.policyIdentity.policyId||s.decision.policyId!==release.policyId||s.input.policyId!==release.policyId||s.record.policyIds[s.row.actorSeat]!==release.policyId||s.decision.actualSource!=='S'||!s.bundle.initialCandidateIds.includes(s.decision.actualActionId))throw Error('diagnostic acting S identity differs');
 if(release.proposer?.policyRef!==proposer.release.proposalPolicyRef||!equal(release.proposer.identity,proposer.policyIdentity)||!equal(seat.policyIdentity,proposer.policyIdentity)||release.candidateSpecRef!==s.bundle.candidateSpec||release.tieBreakId!=='first-candidate-v1'||seat.release?.localSelector!=='student'||seat.release?.mode!=='local')throw Error('diagnostic proposer B identity differs');
 const validSHA=(x:any)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 if(!validSHA(release.scorer?.weightsSHA256)||release.scorer.inputDim!==399||release.scorer.policyId===release.policyId||release.scorer.policyId===proposer.policyIdentity.policyId||!validSHA(release.checkpoint?.sha256)||typeof release.checkpoint.path!=='string'||!release.checkpoint.path||[release.dataset,release.recipe,release.selection].some(r=>!r||typeof r.id!=='string'||!r.id||!validSHA(r.sha256)))throw Error('diagnostic scorer/checkpoint/frozen references missing');
}
/** Explicit trusted adapters only; CLI remains capability_planned without one. */
export function createOfflineLabelTaskHost({root,adapter,...options}:{root:string;adapter:any;profileStore:any;mode?:'research'|'offline_synthetic';fetchImpl?:typeof fetch}){
 return (createTaskController as any)({root,adapter,consumers:[createOfflineLabelConsumer(options)]});
}
