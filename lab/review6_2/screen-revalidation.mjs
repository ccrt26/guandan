import {knownUnsentWorldPreparationFailure} from './first-round-prequery-failure.mjs';
/** One-purpose engineering replay of the preserved round-2 cached screen.
 * It never edits/relabels a historical Task or supplies a substitute executor. */
import {readFileSync,writeFileSync,mkdirSync,lstatSync,statSync,realpathSync,existsSync} from 'node:fs';
import {resolve,relative,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {canonical,digest,strictObject,fail} from './task-schema.mjs';
const contexts=new WeakSet();
const sha=b=>createHash('sha256').update(b).digest('hex');
const RUN='r1-data-screen-train-round-2';
const HASH=/^[a-f0-9]{64}$/;
export function assertScreenRevalidationTask(task){
 if(task.taskId!==RUN||task.runId!==RUN||task.taskKind!=='collect'||!equal(task.operationScope,{localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false})||task.limits.mode!=='input-derived-workload-v1'||task.limits.maxMatchAttempts!==24||['maxProviderRequests','maxLabelDecisions','maxOptimizerSteps'].some(k=>task.limits[k]!==0))fail('revalidation_scope','task','only the original 24 cached screen branches, with no API/labels/updates, are allowed');
}
export function assertScreenRevalidationContext(context,task,root){
 if(!contexts.has(context)||root!==context.canonicalRoot||digest(task)!==context.taskSHA256)fail('revalidation_context','context','fixed verified screen request and canonical root required');
 assertScreenRevalidationTask(task);context.assertLive();return context;
}
export function screenRevalidationStatePath(trusted){
 if(trusted.screenRevalidation===undefined)return join(trusted.controlRoot,'state.json');
 if(trusted.phase==='freeze')fail('revalidation_scope','phase','engineering replay cannot freeze a new selection');
 const c=trusted.screenRevalidation;assertScreenRevalidationContext(c,c.task,trusted.controlRoot);
 if(trusted.task&&digest(trusted.task)!==c.taskSHA256)fail('revalidation_scope','task','historical state view is only for the exact screen Task');
 return join(c.storageRoot,'state.json');
}
const stableSummary=value=>{const s=structuredClone(value);delete s.engineeringRevalidation;delete s.consumption;for(const a of s.attempts){delete a.reservation;delete a.row.result.activeSeconds;delete a.row.result.samplingSeconds;}return s;};
export function compareScreenRevalidationResults(baseline,actual){
 for(const s of [baseline,actual]){if(s.attempts?.length!==24||s.total!==3||s.rootCursor!==3||s.active!==null||s.executionUnknown!==false||s.attempts.some(a=>a.row?.result?.complete!==true)||new Set(s.attempts.map(a=>canonical([a.rootIndex,a.row.worldId,a.row.actionId]))).size!==24)fail('revalidation_incomplete','summary','exactly 24 distinct completed branches and all 3 roots required');}
 const before=stableSummary(baseline),after=stableSummary(actual);
 return {equal:equal(before,after),baselineCanonicalSHA256:digest(before),actualCanonicalSHA256:digest(after),comparedBranches:24,excludedFields:['engineeringRevalidation','attempts[].reservation','attempts[].row.result.activeSeconds','attempts[].row.result.samplingSeconds','consumption'],branchComparisons:before.attempts.map((a,i)=>({rootIndex:a.rootIndex,worldId:a.row.worldId,actionId:a.row.actionId,equal:equal(a,after.attempts[i])})),plansEqual:equal(before.plans,after.plans)};
}
export function loadScreenRevalidation(repositoryRoot,requestReference,{initialize=false,observationOnly=false}={}){
 const match=/^(.+)@sha256:([a-f0-9]{64})$/.exec(requestReference??'');if(!match)fail('revalidation_request','request','repo-relative request path with byte SHA256 required');
 const safe=p=>{if(typeof p!=='string'||!p||isAbsolute(p)||p.split(/[\\/]/).some(v=>!v||v==='.'||v==='..'))fail('revalidation_path','path','explicit repo-relative path required');const full=resolve(repositoryRoot,p);if(!relative(repositoryRoot,full)||relative(repositoryRoot,full).startsWith('..'))fail('revalidation_path','path','path must remain in repository');return full;};
 const regular=p=>{const s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||realpathSync(p)!==p)fail('revalidation_path','file','regular nonsymlink file required');return readFileSync(p);};
 const tracked=new Map();
 const signal=p=>{const s=statSync(p,{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');};
 const file=f=>{strictObject(f,'revalidationFile',['path','sha256']);if(!HASH.test(f.sha256))fail('revalidation_identity','sha256','byte SHA256 required');const p=safe(f.path),b=regular(p);if(sha(b)!==f.sha256)fail('revalidation_identity',f.path,'pinned bytes differ');tracked.set(p,signal(p));return b;};
 const requestBytes=file({path:match[1],sha256:match[2]}),request=JSON.parse(requestBytes);
 strictObject(request,'screenRevalidationRequest',['schema','purpose','historicalHost','historicalState','historicalCloseout','originalTask','originalSummary','executionSource','executionAcceptance','authorizationEvidence','currentAuthority','storageRoot']);
 if(request.schema!=='ohuo-screen-revalidation-request-v1'||request.purpose!=='engineering-only-no-scientific-reuse')fail('revalidation_request','purpose','named engineering-only request required');
 if(observationOnly){
  const storageRoot=safe(request.storageRoot),marker=JSON.parse(regular(join(storageRoot,'revalidation.json'))),canonicalRoot=marker.canonicalRoot;
  if(realpathSync(storageRoot)!==storageRoot||marker.schema!=='ohuo-screen-revalidation-storage-v1'||marker.requestSHA256!==match[2]||marker.storageRoot!==storageRoot||!canonicalRoot.startsWith(join(repositoryRoot,'lab/out')+'/')||storageRoot===canonicalRoot||storageRoot.startsWith(canonicalRoot+'/'))fail('revalidation_storage_conflict','storageRoot','same registered isolated execution required');
  const state=JSON.parse(regular(join(storageRoot,'state.json'))),task=state.runs?.[RUN]?.task??JSON.parse(file(request.originalTask));assertScreenRevalidationTask(task);
  if(digest(task)!==marker.originalTaskSHA256)fail('revalidation_storage_conflict','task','registered Task differs');
  const context=Object.freeze({observationOnly:true,request,requestReference,requestSHA256:match[2],canonicalRoot,storageRoot,outputRoot:join(storageRoot,'runs',RUN),task,taskSHA256:digest(task),sourceRef:'screen-revalidation-execution-source@sha256:'+marker.executionSourceSHA256,assertLive(){},readState(){return JSON.parse(regular(join(storageRoot,'state.json')));}});contexts.add(context);return context;
 }
 const manifest=JSON.parse(file(request.historicalHost)),initialStateBytes=file(request.historicalState),initialState=JSON.parse(initialStateBytes),pointer=JSON.parse(file(request.historicalCloseout)),task=JSON.parse(file(request.originalTask)),baseline=JSON.parse(file(request.originalSummary)),source=JSON.parse(file(request.executionSource)),acceptance=JSON.parse(file(request.executionAcceptance));
 assertScreenRevalidationTask(task);
 const authorization=JSON.parse(file(request.authorizationEvidence));
 if(authorization.schema!=='ohuo-screen-revalidation-authorization-v1'||authorization.purpose!==request.purpose||authorization.originalTaskSHA256!==digest(task)||authorization.executionSourceSHA256!==digest(source)||authorization.storageRoot!==request.storageRoot||typeof authorization.userInstruction!=='string'||!authorization.userInstruction.trim()||typeof authorization.sourceMessageId!=='string'||!authorization.sourceMessageId.trim())fail('revalidation_authorization','authorizationEvidence','explicit independently recorded user instruction bound to task, actual source and isolated destination required');
 if(acceptance.functionalStatus!=='accepted'||!equal(acceptance.acceptedCodeRef,source))fail('revalidation_source_unaccepted','executionAcceptance','actual execution source must be independently accepted');
 strictObject(source,'executionSource',['baseCommit','files']);if(!/^[a-f0-9]{40}$/.test(source.baseCommit)||!Array.isArray(source.files))fail('revalidation_source','executionSource','actual full source descriptor required');
 for(const f of source.files)file(f);
 if(!source.files.some(f=>f.path==='lab/review6_2/screen-revalidation.mjs'))fail('revalidation_source','executionSource','revalidation entry must belong to accepted closure');
 const taskRefs=manifest.references.filter(r=>r.ref.endsWith('@sha256:'+digest(task)));if(taskRefs.length!==1)fail('revalidation_history','originalTask','exact original catalog Task reference required');const taskRef=taskRefs[0].ref;
 const canonicalRoot=safe(manifest.controlRoot),storageRoot=safe(request.storageRoot);
 if(!request.storageRoot.startsWith('lab/out/')||storageRoot===canonicalRoot||storageRoot.startsWith(canonicalRoot+'/')||canonicalRoot.startsWith(storageRoot+'/'))fail('revalidation_path','storageRoot','distinct engineering directory below lab/out required');
 if(task.outputRoot!==join(canonicalRoot,'runs',RUN)||initialState.rootInstanceId!==manifest.rootInstanceId||initialState.tasks?.[RUN]||initialState.runs?.[RUN]||pointer.planRef!==task.planRef||pointer.planVersion!==task.planVersion)fail('revalidation_history','historicalState','exact original pre-screen state and ready context required');
 compareScreenRevalidationResults(baseline,baseline);
 if(baseline.taskSHA256!==digest(task))fail('revalidation_history','originalSummary','baseline does not bind unchanged original Task');
 if(!Array.isArray(request.currentAuthority)||request.currentAuthority.length!==3)fail('revalidation_authority','currentAuthority','current state, host and closeout pointer required');
 const expected=[join(canonicalRoot,'state.json'),join(repositoryRoot,'deliverables/ohuo-runtime/host.json'),safe(manifest.planCloseoutFile)];
 if(!equal(request.currentAuthority.map(f=>safe(f.path)).sort(),expected.sort()))fail('revalidation_authority','currentAuthority','only exact live production authority files are permitted');
 for(const f of request.currentAuthority)file(f);
 const current=JSON.parse(regular(join(canonicalRoot,'state.json'))),old=current.runs?.[RUN];
 if(old?.status!=='completed'||old.cleanupConfirmed!==true||old.taskSHA256!==digest(task)||!old.consumerArtifactRefs?.some(f=>f.path===safe(request.originalSummary.path)&&f.sha256===request.originalSummary.sha256))fail('revalidation_history','originalRun','clean completed original run and committed summary required');
 const readHistoricalReference=ref=>{const entries=manifest.references.filter(r=>r.ref===ref);if(entries.length!==1)fail('revalidation_history','reference','exact historical reference required');const value=JSON.parse(file(entries[0].file));if(digest(value)!==ref.split(':').at(-1))fail('revalidation_history','reference','canonical historical reference differs');return value;};
 const safeState=s=>{
  for(const b of Object.values(s.budgets??{}))if(b.activeRunId!==null||Object.values(b.reservations??{}).some(r=>['reserved','reserved_unknown'].includes(r.status)))fail('revalidation_busy','state','active or unknown production execution cannot be bypassed');
  for(const r of Object.values(s.runs??{}))if(!['completed','failed','interrupted'].includes(r.status)||r.cleanupConfirmed!==true||r.stopReason==='execution_uncertain'||r.failureReason==='execution_uncertain'||r.executionUnknown===true||r.observationStatus==='unknown'||r.checkpoint?.executionUnknown===true||r.checkpoint?.active!=null){
   // Reuse the existing exact proof of the historical pre-meter failure. It
   // verifies original Task/checkpoint bytes and zero committed/reserved work;
   // it does not clear or reinterpret genuine unknown execution.
   if(knownUnsentWorldPreparationFailure(r,s,canonicalRoot,readHistoricalReference)){for(const p of [join(r.task.outputRoot,'task.json'),r.checkpointRef])tracked.set(p,signal(p));continue;}
   fail('revalidation_busy','state','active or unknown production execution cannot be bypassed');
  }
 };
 safeState(current);safeState(initialState);
 // The frozen catalog is read at its original canonical paths. No generic
 // path translation, restored authority, zero ledger or mutable source copy.
 for(const f of [...manifest.references.map(r=>r.file),...manifest.evidenceFiles.map(e=>e.file),manifest.grantFile,...manifest.inputBindings.flatMap(b=>[b.sourceIndexFile,...b.studentReleaseFiles.map(s=>s.file)])]){const p=safe(f.path);if(existsSync(p))tracked.set(p,signal(p));}
 const marker={schema:'ohuo-screen-revalidation-storage-v1',purpose:request.purpose,requestSHA256:match[2],originalTaskSHA256:digest(task),historicalStateSHA256:request.historicalState.sha256,executionSourceSHA256:digest(source),canonicalRoot,storageRoot};
 if(existsSync(storageRoot)){if(!lstatSync(storageRoot).isDirectory()||realpathSync(storageRoot)!==storageRoot||!equal(JSON.parse(regular(join(storageRoot,'revalidation.json'))),marker))fail('revalidation_storage_conflict','storageRoot','existing engineering identity differs; never reset or overwrite');}
 else{if(!initialize)fail('revalidation_not_started','storageRoot','engineering run has not been initialized');const parent=resolve(storageRoot,'..');if(!existsSync(parent)||realpathSync(parent)!==parent)fail('revalidation_path','storageRoot','existing real parent required');mkdirSync(storageRoot,{mode:0o700});writeFileSync(join(storageRoot,'revalidation.json'),canonical(marker),{flag:'wx',mode:0o600});writeFileSync(join(storageRoot,'state.json'),initialStateBytes,{flag:'wx',mode:0o600});}
 const timings=[];
 const context={timings,recordTiming(stage,started){timings.push({stage,seconds:(performance.now()-started)/1000});},request,requestReference,requestSHA256:match[2],manifest,pointer,source,taskRef,sourceRef:'screen-revalidation-execution-source@sha256:'+digest(source),task,taskSHA256:digest(task),baseline,canonicalRoot,storageRoot,outputRoot:join(storageRoot,'runs',RUN),historicalStateSHA256:request.historicalState.sha256,assertLive(){for(const [p,before]of tracked)if(signal(p)!==before)fail('revalidation_input_changed',relative(repositoryRoot,p),'fixed production input or authority changed; preserve current run without automatic replay');},readState(){return JSON.parse(regular(join(storageRoot,'state.json')));}};
 Object.freeze(context);contexts.add(context);context.assertLive();return context;
}
