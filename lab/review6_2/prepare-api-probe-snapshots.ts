/** Fixed existing-capture preparation, never a probe runtime dependency.
 * Extract may replay already-confirmed history only after trusted preparation
 * admission. Finalize consumes public JSON only and cannot authorize research.
 */
import {relative, isAbsolute, resolve, join, dirname, basename} from 'node:path';
import {readFileSync,writeFileSync,lstatSync,realpathSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {projectRoot} from '../../scripts/project-paths.mjs';
import {pathToFileURL} from 'node:url';
import {canonical,digest,referenceOf,strictObject,fixedReference,validateIdentifier,validateTask} from './task-schema.mjs';
import {freezeCopy,publicCombo,CANDIDATE_SPEC,type DecisionBundle,type DecisionKey,type PublicHistoryPrefix} from '../../packages/ai/src/hybrid/protocol';
import {buildObservation,describeRules} from '../../packages/ai/src/hybrid/observation';
import {canonicalActionId,resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import {decisionRequestView} from '../../packages/ai/src/hybrid/candidates';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {freezeRequestView} from '../../packages/web/server/llm-selection-wire.mjs';
import {loadMatchStore,replayConfirmedMatch,hashJSON,type MatchStoreRef,type MatchRecord} from './match-record';

type R = string;
type P = {path:string;sha256:string};
type Capture = {snapshotId:string;sourceRef:R;recordRef:MatchStoreRef;recordRoot:string;key:DecisionKey;inputSHA256:string;generationInvocationRef:R};
type ExtractInput = {schema:'ohuo-probe-capture-extract-v1';planRef:R;clauseRef:R;authorizationRef:R;sourceIndexRef:R;rulesRef:R;parentPolicyRef:R;candidateRef:R;promptRef:R;producerSourceRevision:R;classificationRuleRef:R;coverageRuleRef:R;captures:Capture[];outputId:string};
type FinalizeInput = {schema:'ohuo-probe-public-finalize-v1';planRef:R;clauseRef:R;authorizationRef:R;extractionRef:R;reviewInputRef:R;outputId:string};
const extractRefs=['planRef','clauseRef','authorizationRef','sourceIndexRef','rulesRef','parentPolicyRef','candidateRef','promptRef','producerSourceRevision','classificationRuleRef','coverageRuleRef'] as const;
const finalizeRefs=['planRef','clauseRef','authorizationRef','extractionRef','reviewInputRef'] as const;
function need(ok:unknown,reason:string):asserts ok{if(!ok)throw Error(reason);}
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
function shaShape(value:unknown){need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'invalid_sha');}
function pathShape(value:unknown):asserts value is string{
 need(typeof value==='string'&&value.length>0&&!isAbsolute(value)&&!value.includes('\\')&&!value.includes('\0')&&!value.split('/').some(p=>!p||p==='.'||p==='..'),'invalid_path');
}
function sourcePathShape(value:unknown):asserts value is string{
 need(typeof value==='string'&&value.length>0,'invalid_path');
 pathShape(isAbsolute(value)?value.slice(1):value);
}
function keyShape(key:DecisionKey){
 need(key&&typeof key==='object','invalid_key');
 strictObject(key,'key',['controllerOrRunnerGeneration','matchId','gameNo','moveNo','actorSeat','requestSeq',...('ownership'in key?['ownership']:[]),...('snapshotRevision'in key?['snapshotRevision']:[])]);
 need((typeof key.controllerOrRunnerGeneration==='string'&&key.controllerOrRunnerGeneration.length>0||typeof key.controllerOrRunnerGeneration==='number'&&Number.isFinite(key.controllerOrRunnerGeneration))&&typeof key.matchId==='string'&&key.matchId.length>0&&integer(key.gameNo,1)&&integer(key.moveNo)&&integer(key.actorSeat,0,3)&&integer(key.requestSeq)&&(!('ownership'in key)||typeof key.ownership==='string')&&(!('snapshotRevision'in key)||integer(key.snapshotRevision)),'invalid_key');
}
function inputShape(input:any):ExtractInput|FinalizeInput{
 need(input?.schema==='ohuo-probe-capture-extract-v1'||input?.schema==='ohuo-probe-public-finalize-v1','unsupported_schema');
 const extract=input.schema==='ohuo-probe-capture-extract-v1',refs=extract?extractRefs:finalizeRefs;
 strictObject(input,'preparationInput',['schema',...refs,...(extract?['captures']:[]),'outputId']);
 for(const key of refs)fixedReference(input[key],key);validateIdentifier(input.outputId,'outputId');
 if(extract){
  need(input.candidateRef===input.parentPolicyRef,'candidate_binding');need(Array.isArray(input.captures)&&input.captures.length===12,'capture_count');
  const ids=new Set<string>(),keys=new Set<string>();
  for(const row of input.captures as Capture[]){
   strictObject(row,'capture',['snapshotId','sourceRef','recordRef','recordRoot','key','inputSHA256','generationInvocationRef']);
   validateIdentifier(row.snapshotId,'snapshotId');fixedReference(row.sourceRef,'sourceRef');fixedReference(row.generationInvocationRef,'generationInvocationRef');shaShape(row.inputSHA256);keyShape(row.key);
   need(!ids.has(row.snapshotId),'duplicate_snapshot');ids.add(row.snapshotId);const key=digest(row.key);need(!keys.has(key),'duplicate_decision');keys.add(key);
   strictObject(row.recordRef,'recordRef',['directory','identitySHA256','journalBytes','journalSHA256']);shaShape(row.recordRef.identitySHA256);shaShape(row.recordRef.journalSHA256);need(integer(row.recordRef.journalBytes),'invalid_journal');sourcePathShape(row.recordRoot);sourcePathShape(row.recordRef.directory);
   const rel=relative(row.recordRoot,row.recordRef.directory);need(!!rel&&!rel.startsWith('..')&&!isAbsolute(rel),'record_root');
  }
 }
 return input;
}

function cliArguments(args:string[]){
 need(args.length===6,'invalid_cli');const values=new Map<string,string>();
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];need(['--input','--sha256','--output'].includes(key)&&!values.has(key)&&typeof value==='string'&&!value.startsWith('--'),'invalid_cli');values.set(key,value);}
 const input=values.get('--input')!,sha256=values.get('--sha256')!,output=values.get('--output')!;
 pathShape(input);shaShape(sha256);pathShape(output);need(output.startsWith('lab/out/')&&output.split('/').length>2,'invalid_output');return {input,sha256,output};
}
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const array=(v:any,name:string,min=0,max=10000):any[]=>{need(Array.isArray(v)&&v.length>=min&&v.length<=max,'invalid_array:'+name);return v;};
const fileRef=(f:any)=>{strictObject(f,'fileRef',['path','sha256']);pathShape(f.path);shaShape(f.sha256);return f as P;};
const schema=(v:any,name:string,keys:string[])=>{strictObject(v,name,['schema',...keys]);need(v.schema===name,'invalid_schema:'+name);return v;};
const contained=(root:string,path:string,allowEqual=false)=>{const r=relative(root,path);return (allowEqual||!!r)&&r!=='..'&&!r.startsWith('../')&&!isAbsolute(r);};
const overlap=(a:string,b:string)=>contained(a,b,true)||contained(b,a,true);
const sourceFiles=['lab/review6_2/prepare-api-probe-snapshots.ts','scripts/project-paths.mjs','lab/review6_2/task-schema.mjs','lab/review6_2/match-record.ts','packages/ai/src/hybrid/candidates.ts','packages/ai/src/hybrid/observation.ts','packages/ai/src/hybrid/legality.ts','packages/ai/src/hybrid/protocol.ts','packages/ai/src/nn/schema.ts','packages/ai/src/policy/seats.ts','packages/ai/src/policy/releases.json','packages/web/server/llm-selection-wire.mjs',...['index','types','rank','rng','deck','combo','game','record'].map(n=>`packages/engine/src/${n}.ts`)];
const producerPath='packages/ai/src/hybrid/candidates.ts';
const rowChecks=['source-task-binding','record-prefix','source-family-split','actor-policy-rules','original-capture','public-observation','canonical-legality','nonunique'];
const rowLimits={historicalInvocationSemantics:'pending-original-P-review',newForward:0,newGameActions:0,teacherCalls:0};
const extractionLimits={privateReads:'extract-only',historicalReplay:'confirmed-only',newForward:0,newGameActions:0,teacherCalls:0,scientificQualification:'not-produced'};
const extKeys=['inputRef','sourceIndexRef','rulesRef','parentPolicyRef','candidateRef','promptRef','producerSourceRevision','classificationRuleRef','coverageRuleRef','rows','extractionEvidenceRef'];
const aggregateKeys=['inputRef','planRef','clauseRef','authorizationRef','outputId','preparerSourceRevision','producerSourceRevision','bindingBytesSHA256','approvalEvidenceSHA256','observations','rows','limits'];
const rowEvidenceKeys=['snapshotId','sourceTaskRef','generationInvocationRef','sourceRef','producerSourceRevision','producerEntry','key','inputSHA256','recordIdentitySHA256','journalBytes','journalSHA256','captureBytesSHA256','bundleRef','captureForm','checks','limits'];
function sourceManifest(v:any){
 strictObject(v,'sourceRevision',['baseCommit','files']);need(typeof v.baseCommit==='string'&&/^[a-f0-9]{40}$/.test(v.baseCommit),'source_revision');
 const entries=new Map<string,P>();for(const f of array(v.files,'source.files',1)){fileRef(f);need(!entries.has(f.path),'duplicate_source_path');entries.set(f.path,f);}return entries;
}
function rulesShape(v:any){
 strictObject(v,'rules',['levelMode','passA','pairSeqMin','pairSeqMax','trioSeqMin','trioSeqMax','flushLen','straightLen']);
 need(['stage','both','high'].includes(v.levelMode)&&['head','head3','double'].includes(v.passA)&&['pairSeqMin','pairSeqMax','trioSeqMin','trioSeqMax','flushLen','straightLen'].every(k=>integer(v[k],1))&&v.pairSeqMin<=v.pairSeqMax&&v.trioSeqMin<=v.trioSeqMax,'invalid_rules');return v;
}
function safePath(root:string,value:string,missing=false){
 sourcePathShape(value);const full=resolve(root,value);need(contained(root,full),'path_outside_repository');
 let current=root;need(lstatSync(root).isDirectory()&&realpathSync(root)===root,'repository_symlink');
 for(const part of relative(root,full).split('/')){current=join(current,part);if(!existsSync(current)){try{lstatSync(current);}catch(e:any){if(e.code==='ENOENT'&&missing)continue;throw e;}}const stat=lstatSync(current);need(!stat.isSymbolicLink(),'symlink_forbidden');if(current!==full)need(stat.isDirectory(),'invalid_path_ancestor');}
 return full;
}
function regularBytes(root:string,value:string,privateFile=false){
 const path=safePath(root,value),st=lstatSync(path);need(st.isFile()&&st.size<=32*1024*1024&&(!privateFile||(st.mode&0o777)===0o600),'invalid_regular_file');
 const bytes=readFileSync(path);need(realpathSync(path)===path&&bytes.length===st.size,'file_changed');return bytes;
}
function parse(bytes:Buffer){try{return JSON.parse(bytes.toString('utf8'));}catch{throw Error('invalid_json');}}
function abort(signal?:AbortSignal){need(!signal?.aborted,'preparation_cancelled');}
class PreparationContext {
 readonly repoRoot=projectRoot;readonly binding:any;readonly bindingBytes:Buffer;readonly approvalBytes:Buffer;readonly outputRoot:string;readonly extractInputRef:P;
 readonly sourceBindings:Array<{snapshotId:string;sourceTaskRef:R;recordRoot:string;task:any}>=[];
 readonly observedSourceBytes=new Map<string,string>();readonly resolvedPublicReferences=new Set<R>();readonly resolvedPrivilegedReferences=new Set<R>();readonly forbiddenPublicPaths=new Set<string>();readonly preparerFiles:P[]=[];
 readonly inputRef:P;readonly references=new Map<R,P>();readonly evidence=new Map<string,P>();readonly host:any;readonly hostBytes:Buffer;readonly index:any;
 constructor(readonly input:ExtractInput|FinalizeInput,inputRef:P,output:string,readonly signal:AbortSignal){
  this.inputRef=fileRef(inputRef);this.hostBytes=regularBytes(this.repoRoot,'deliverables/ohuo-runtime/host.json');this.host=parse(this.hostBytes);
  for(const r of array(this.host.references,'host.references',1)){strictObject(r,'reference',['ref','file']);fixedReference(r.ref,'reference');fileRef(r.file);need(!this.references.has(r.ref),'duplicate_reference');this.references.set(r.ref,r.file);}
  for(const e of array(this.host.evidenceFiles,'host.evidenceFiles')){strictObject(e,'evidenceFile',['id','file']);need(typeof e.id==='string'&&e.id.length>0&&!this.evidence.has(e.id),'invalid_evidence_mapping');fileRef(e.file);this.evidence.set(e.id,e.file);}
  pathShape(this.host.controlRoot);pathShape(this.host.planCloseoutFile);
  this.bindingBytes=regularBytes(this.repoRoot,'deliverables/ohuo-runtime/probe-preparation.json',true);this.binding=parse(this.bindingBytes);const b=this.binding;
  schema(b,'ohuo-probe-preparation-binding-v1',['inputRef','extractInputRef','planRef','clauseRef','authorizationRef','approvalEvidence','sourceIndexFile','sourceBindings','outputRoot','preparerSourceRevision']);
  fileRef(b.inputRef);fileRef(b.extractInputRef);fileRef(b.approvalEvidence);this.extractInputRef=b.extractInputRef;
  need(equal(b.inputRef,inputRef)&&equal(parse(this.readP(inputRef)),input),'input_identity');
  for(const name of ['planRef','clauseRef','authorizationRef'] as const){fixedReference(b[name],name);need(b[name]===input[name],'preparation_binding');this.resolvePrivilegedRef(b[name]);}
  fixedReference(b.preparerSourceRevision,'preparerSourceRevision');
  pathShape(output);pathShape(b.outputRoot);need(output===b.outputRoot&&output===`lab/out/${input.outputId}`,'output_binding');this.outputRoot=safePath(this.repoRoot,output,true);
  if(existsSync(this.outputRoot)){need(lstatSync(this.outputRoot).isDirectory(),'invalid_output_directory');need(readdirSync(this.outputRoot).every(name=>artifactNames(true).includes(name)||name==='manifest.json'||name==='evidence'||name==='public-review'),'output_namespace_conflict');}
  for(const path of [inputRef.path,b.extractInputRef.path,b.approvalEvidence.path,'deliverables/ohuo-runtime/host.json','deliverables/ohuo-runtime/probe-preparation.json',this.host.planCloseoutFile,join(this.host.controlRoot,'state.json'),join(this.outputRoot,'evidence/preparation-binding-extract.private.json'),join(this.outputRoot,'evidence/preparation-binding-finalize.private.json')])this.forbiddenPublicPaths.add(resolve(this.repoRoot,path));
  this.approvalBytes=this.readP(b.approvalEvidence);
  if(input.schema==='ohuo-probe-capture-extract-v1'){
   need(equal(inputRef,b.extractInputRef),'extract_input_binding');fileRef(b.sourceIndexFile);
   const ix=schema(this.resolveRef(input.sourceIndexRef),'ohuo-source-index-ref-v1',['namespace','fileSHA256']);const bytes=this.readP(b.sourceIndexFile);need(sha(bytes)===ix.fileSHA256,'source_index_sha');this.index=parse(bytes);need(this.index.version===1&&this.index.families&&typeof this.index.families==='object','source_index_shape');
   const rows=array(b.sourceBindings,'sourceBindings',12,12);
   for(const [i,row] of rows.entries()){
    strictObject(row,'sourceBinding',['snapshotId','sourceTaskRef','recordRoot']);fixedReference(row.sourceTaskRef,'sourceTaskRef');const capture=input.captures[i];need(row.snapshotId===capture.snapshotId&&row.recordRoot===capture.recordRoot,'source_binding_order');
    const task=validateTask(this.resolveRef(row.sourceTaskRef));need(['collect','evaluate'].includes(task.taskKind)&&task.sourceRevision===input.producerSourceRevision&&task.parentPolicyRef===input.parentPolicyRef&&task.rulesRef===input.rulesRef&&task.sourcePlan.sourceIndexRef===input.sourceIndexRef&&task.sourcePlan.namespace===ix.namespace,'source_task_binding');
    const split=task.sourcePlan.split==='confirm'?'sealed':task.sourcePlan.split;need(task.sourcePlan.familyIds.every((id:string)=>this.index.families[id]?.split===split),'source_plan_split');
    const root=safePath(this.repoRoot,row.recordRoot,true),taskRoot=safePath(this.repoRoot,task.outputRoot,true);need((!existsSync(root)||lstatSync(root).isDirectory())&&contained(taskRoot,root,true),'record_root_binding');
    const directory=safePath(this.repoRoot,capture.recordRef.directory,true);need(contained(root,directory)&&(!existsSync(directory)||lstatSync(directory).isDirectory()),'record_directory_binding');this.sourceBindings.push({...row,recordRoot:root,task});
   }
  }else{need(b.sourceIndexFile===null&&Array.isArray(b.sourceBindings)&&b.sourceBindings.length===0,'finalize_private_binding');this.index=null;}
 }
 readP=(f:P)=>{fileRef(f);const bytes=regularBytes(this.repoRoot,f.path);need(sha(bytes)===f.sha256,'file_sha_mismatch');return bytes;};
 /** A catalog mapping is not a public-read grant. Check the consuming role
  * before every open (and before any future cache lookup), even for the same R
  * already used by current plan/approval validation. Never inspect old inputs
  * or source Tasks to discover a forbidden source directory. */
 private publicReferencePath(file:P){
  fileRef(file);const path=resolve(this.repoRoot,file.path);need(!this.forbiddenPublicPaths.has(path),'public_reference_forbidden');
  const rel=relative(this.outputRoot,path),parts=rel.split('/'),reserved=[...artifactNames(true),'manifest.json'];
  const generated=parts.length===1&&reserved.includes(parts[0]);
  const review=parts.length===2&&parts[0]==='public-review'&&!reserved.includes(parts[1])&&!['evidence','private'].includes(parts[1])&&!parts[1].endsWith('.private.json');
  need(generated||review,'public_reference_namespace');const real=safePath(this.repoRoot,file.path);need(lstatSync(real).isFile(),'public_reference_not_regular');
 }
 private readReference(ref:R,role:'public'|'privileged'){
  fixedReference(ref,'reference');const file=this.references.get(ref);need(file,'preparation_context_pending:reference_unavailable');
  if(role==='public')this.publicReferencePath(file!);else need(!file!.path.endsWith('.private.json'),'private_reference_forbidden');
  const value=parse(this.readP(file!));need(digest(value)===ref.slice(ref.lastIndexOf(':')+1),'reference_sha_mismatch');
  (role==='public'?this.resolvedPublicReferences:this.resolvedPrivilegedReferences).add(ref);return value;
 }
 resolveRef=(ref:R)=>this.readReference(ref,this.input.schema==='ohuo-probe-public-finalize-v1'?'public':'privileged');
 resolvePrivilegedRef=(ref:R)=>this.readReference(ref,'privileged');
 verifyPreparerSource=()=>{const source=sourceManifest(this.resolveRef(this.binding.preparerSourceRevision));for(const name of sourceFiles){const file=source.get(name);need(file,'preparer_source_missing:'+name);this.readP(file!);this.preparerFiles.push(file!);}};
 readSource=(path:string)=>{need(this.input.schema==='ohuo-probe-capture-extract-v1','finalize_private_read_forbidden');const bytes=regularBytes(this.repoRoot,path,true),actual=sha(bytes),prior=this.observedSourceBytes.get(path);need(prior===undefined||prior===actual,'source_changed_before_publish');this.observedSourceBytes.set(path,actual);return bytes;};
 evidenceBytes=(e:any)=>{strictObject(e,'evidenceRef',['id','sha256']);shaShape(e.sha256);const file=this.evidence.get(e.id);need(file&&file.sha256===e.sha256,'preparation_context_pending:evidence_unavailable');this.forbiddenPublicPaths.add(resolve(this.repoRoot,file!.path));return this.readP(file!);};
 observe=(phase:'before-read'|'before-publish')=>{
  abort(this.signal);need(equal(regularBytes(this.repoRoot,'deliverables/ohuo-runtime/host.json'),this.hostBytes)&&equal(regularBytes(this.repoRoot,'deliverables/ohuo-runtime/probe-preparation.json',true),this.bindingBytes),'preparation_context_changed');this.readP(this.inputRef);this.readP(this.binding.approvalEvidence);
  const pointer=parse(regularBytes(this.repoRoot,this.host.planCloseoutFile));schema(pointer,'ohuo-current-plan-closeout-v1',['planRef','planVersion','revision','closeout']);strictObject(pointer.closeout,'closeoutRef',['ref','file']);fixedReference(pointer.closeout.ref,'closeout.ref');
  fileRef(pointer.closeout.file);this.forbiddenPublicPaths.add(resolve(this.repoRoot,pointer.closeout.file.path));
  const bytes=this.readP(pointer.closeout.file),c=parse(bytes);schema(c,'ohuo-plan-closeout-v1',['planRef','planVersion','status','inputPackageRef','inputManifestSHA','analysisRef','actions','evidence_refs','unresolved']);
  need(digest(c)===pointer.closeout.ref.slice(pointer.closeout.ref.lastIndexOf(':')+1)&&pointer.planRef===this.input.planRef&&c.planRef===this.input.planRef&&integer(pointer.planVersion,1)&&c.planVersion===pointer.planVersion&&integer(pointer.revision,1),'plan_identity');
  need(c.status==='incomplete','plan_closed');array(c.unresolved,'plan.unresolved');for(const e of array(c.evidence_refs,'plan.evidence_refs'))this.evidenceBytes(e);
  if(c.inputPackageRef===null)need(c.inputManifestSHA===null,'plan_input_identity');else{this.evidenceBytes(c.inputPackageRef);need(c.inputManifestSHA===c.inputPackageRef.sha256,'plan_input_identity');}
  if(c.analysisRef!==null){const analysis=parse(this.evidenceBytes(c.analysisRef));need(analysis.planRef===c.planRef&&equal(analysis.inputPackageRef,c.inputPackageRef)&&analysis.inputManifestSHA===c.inputManifestSHA&&['CONTINUE_APPROVED_PLAN','BLOCKED','INCOMPLETE','PROPOSE_CHANGE_ONLY','STOP_AND_DISCUSS_NEW_PLAN'].includes(analysis.disposition),'plan_analysis_identity');for(const e of array(analysis.evidence_refs,'analysis.evidence_refs'))this.evidenceBytes(e);}
  const matches:any[]=[];for(const a of array(c.actions,'plan.actions')){strictObject(a,'planAction',['clauseRef','branchRef','plannedTaskIds','taskFileRefs','runRefs','status','evidence_refs','ruleRef','unresolved']);fixedReference(a.clauseRef,'clauseRef');if(a.branchRef!==null)fixedReference(a.branchRef,'branchRef');for(const id of array(a.plannedTaskIds,'plannedTaskIds'))validateIdentifier(id,'taskId');for(const ref of array(a.taskFileRefs,'taskFileRefs'))fixedReference(ref,'taskRef');for(const e of [...array(a.runRefs,'runRefs'),...array(a.evidence_refs,'action.evidence_refs')])this.evidenceBytes(e);array(a.unresolved,'action.unresolved');if(a.ruleRef!==null)this.resolvePrivilegedRef(a.ruleRef);need(['completed','not_executed','skipped_with_rule','blocked'].includes(a.status),'plan_action_status');if(a.clauseRef===this.input.clauseRef)matches.push(a);}
  need(matches.length===1&&matches[0].status==='not_executed'&&matches[0].unresolved.length===0,'preparation_action_pending');
  const stateBytes=regularBytes(this.repoRoot,join(this.host.controlRoot,'state.json')),state=parse(stateBytes);need(state&&state.runs&&state.tasks&&state.budgets,'control_state_missing');
  const uncertain=(run:any)=>!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||run.stopReason==='execution_uncertain'||run.failureReason==='execution_uncertain'||Object.values(state.budgets).some((ledger:any)=>ledger.activeRunId===run.runId||Object.values(ledger.reservations??{}).some((r:any)=>r.runId===run.runId&&['reserved','reserved_unknown'].includes(r.status)));
  for(const [id,run] of Object.entries(state.runs) as any){need(run.runId===id&&run.task&&typeof run.task.outputRoot==='string','control_state_identity');if(uncertain(run)){const runRoot=resolve(this.repoRoot,run.task.outputRoot);need(!overlap(runRoot,this.outputRoot),'output_writer_pending');}}
  for(const b of this.sourceBindings){const task=b.task,run=state.runs[task.runId],ledger=state.budgets[task.budgetRef];need(ledger&&Object.hasOwn(ledger,'activeRunId')&&(ledger.activeRunId===null||typeof ledger.activeRunId==='string')&&ledger.reservations&&typeof ledger.reservations==='object'&&!Array.isArray(ledger.reservations),'source_ledger_missing');need(run&&state.tasks[task.taskId]===task.runId&&run.taskRef===b.sourceTaskRef&&run.taskSHA256===digest(task)&&equal(run.task,task),'source_run_identity');need(!uncertain(run),'source_run_pending');}
  if(phase==='before-publish'){for(const file of this.preparerFiles)this.readP(file);for(const ref of this.resolvedPrivilegedReferences)this.resolvePrivilegedRef(ref);for(const ref of this.resolvedPublicReferences)this.readReference(ref,'public');if(this.input.schema==='ohuo-probe-capture-extract-v1'){this.readP(this.binding.sourceIndexFile);for(const [path,expected] of this.observedSourceBytes)need(sha(regularBytes(this.repoRoot,path,true))===expected,'source_changed_before_publish');}}
  return {phase,planCloseoutSHA256:sha(bytes),controlStateSHA256:sha(stateBytes)};
 };
}

/** Same finite B02 public invariants as the probe boundary; no reader or send. */
function validatePublicBundle(b:DecisionBundle,rules:any,candidateSpec:string){
 strictObject(b,'bundle',['candidateSpec','decisionId','pool','initialCandidateIds','offeredIds','fallbackActionId','expansionCount','isUniqueLegalAction','observation','key']);
 strictObject(b.key,'decisionKey',['controllerOrRunnerGeneration','matchId','gameNo','moveNo','actorSeat','requestSeq',...('ownership'in b.key?['ownership']:[]),...('snapshotRevision'in b.key?['snapshotRevision']:[])]);
 if(b.candidateSpec!==CANDIDATE_SPEC||b.candidateSpec!==candidateSpec||b.isUniqueLegalAction!==false||b.expansionCount!==0||!Array.isArray(b.pool)||b.pool.length<2||!Array.isArray(b.initialCandidateIds)||!b.initialCandidateIds.length||b.initialCandidateIds.length>8||!equal(b.initialCandidateIds,b.offeredIds)||b.fallbackActionId!==b.pool[0].actionId||new Set(b.initialCandidateIds).size!==b.initialCandidateIds.length||b.decisionId!==b.observation?.decisionId||!equal(b.observation.ruleOptions,rules)||b.observation.rulesText!==describeRules(rules)||b.key.matchId!==b.observation.matchId||b.key.gameNo!==b.observation.gameNo||b.key.moveNo!==b.observation.moveNo||b.key.actorSeat!==b.observation.actorSeat||!integer(b.key.requestSeq))throw Error('probe_bundle_identity');
 if(!['string','number'].includes(typeof b.key.controllerOrRunnerGeneration)||'ownership'in b.key&&typeof b.key.ownership!=='string'||'snapshotRevision'in b.key&&!integer(b.key.snapshotRevision))throw Error('probe_decision_key');
 const ids=new Set<string>(),canonicalIds=new Set<string>(),indices=new Set<number>(),groups=new Map<string,string>();
 for(const [rank,c] of b.pool.entries()){
  strictObject(c,'candidate',['actionId','canonicalId','canonical','originalIndex','rank','rawQ','groupId','groupKey','remainingHand']);validateIdentifier(c.actionId,'actionId');validateIdentifier(c.groupId,'groupId');
  if(ids.has(c.actionId)||canonicalIds.has(c.canonicalId)||indices.has(c.originalIndex)||!integer(c.originalIndex,0,b.pool.length-1)||c.rank!==rank||!Number.isFinite(c.rawQ)||rank>0&&(c.rawQ>b.pool[rank-1].rawQ||c.rawQ===b.pool[rank-1].rawQ&&c.originalIndex<b.pool[rank-1].originalIndex))throw Error('probe_pool_identity');
  ids.add(c.actionId);canonicalIds.add(c.canonicalId);indices.add(c.originalIndex);
  if(c.canonical!==null){
   const combo=c.canonical;strictObject(combo,'canonical',['kind','cards','size','keyRank','length','pairRanks','mainRank','wildAs',...('suit'in combo?['suit']:[])]);
   if(!Array.isArray(combo.cards)||combo.cards.length!==combo.size||new Set(combo.cards.map((card:{id:number})=>card.id)).size!==combo.cards.length||!Array.isArray(combo.wildAs))throw Error('probe_canonical_resources');
   for(const card of combo.cards){strictObject(card,'card',['id','suit','rank']);if(!integer(card.id,0,107))throw Error('probe_card_identity');}
   for(const a of combo.wildAs)strictObject(a,'wildAssignment',['cardId','asRank',...('asSuit'in a?['asSuit']:[])]);
  }else if(b.observation.target===null)throw Error('probe_pass_without_target');
  const ctx={ranks:new Set(b.observation.effectiveLevelRanks),levels:b.observation.levelsBefore} as any;
  if(canonicalActionId(c.canonical,ctx)!==c.canonicalId)throw Error('probe_canonical_identity');
  const wild=c.canonical?.cards.filter((card:{suit:string;rank:number})=>card.suit==='H'&&b.observation.effectiveLevelRanks.includes(card.rank)).length??0;
  const groupKey=`${c.canonical?.kind??'pass'}:${c.canonical?.size??0}:${wild}`;
  if(!groups.has(groupKey))groups.set(groupKey,`g${String(groups.size+1).padStart(2,'0')}`);
  if(c.groupKey!==groupKey||c.groupId!==groups.get(groupKey))throw Error('probe_group_identity');
  const projected=publicCombo(c.canonical),remaining=b.observation.ownHand.map(f=>({...f}));
  for(const resource of projected?.resources??[]){const own=remaining.find(f=>f.suit===resource.suit&&f.rank===resource.rank);if(!own||own.count<resource.count)throw Error('probe_resource_not_owned');own.count-=resource.count;}
  if(!equal(c.remainingHand,remaining.filter(f=>f.count>0)))throw Error('probe_remaining_hand');
  freezeRequestView(decisionRequestView({...b,offeredIds:[c.actionId],expansionCount:1}));
 }
 if(b.initialCandidateIds.some(id=>!ids.has(id)))throw Error('probe_offered_identity');
 freezeRequestView(decisionRequestView(b));
}

function commonReferences(input:any,ctx:PreparationContext){
 const base=schema(ctx.resolveRef(input.parentPolicyRef),'ohuo-release-ref-v1',['release','policyIdentity']),known=RELEASES.find(r=>r.releaseRef===base.release?.releaseRef);
 need(known&&equal(known,base.release)&&known.mode==='local'&&known.tier==='hard'&&known.localSelector==='proposal'&&input.candidateRef===input.parentPolicyRef,'parent_policy_binding');
 const prompt=schema(ctx.resolveRef(input.promptRef),'ohuo-prompt-ref-v1',['promptRef']);need(typeof prompt.promptRef==='string'&&prompt.promptRef.length>0,'prompt_binding');
 const rules=rulesShape(ctx.resolveRef(input.rulesRef)),source=sourceManifest(ctx.resolveRef(input.producerSourceRevision)),producer=source.get(producerPath);
 need(producer&&source.has('lab/review6_2/match-record.ts'),'producer_source_missing');need(producer!.sha256===sha(regularBytes(ctx.repoRoot,producerPath)),'B02_source_identity');
 ctx.resolveRef(input.classificationRuleRef);ctx.resolveRef(input.coverageRuleRef);ctx.resolveRef(input.sourceIndexRef);
 return {base,prompt,rules,source,producerEntry:{file:producer!,exportName:'createDecisionBundle'}};
}
function historicalReport(ref:R,ctx:PreparationContext){const value=ctx.resolveRef(ref);need(!['ohuo-probe-extraction-row-evidence-v1','ohuo-probe-extraction-evidence-v1','ohuo-probe-capture-extraction-v1','ohuo-probe-preparation-manifest-v1'].includes(value?.schema),'historical_report_substitution');return value;}
function readCapturedProbeDecision(row:Capture,binding:PreparationContext['sourceBindings'][number],input:ExtractInput,ctx:PreparationContext,common:ReturnType<typeof commonReferences>,cache:Map<string,any>){
 const task=binding.task,root=binding.recordRoot,directory=safePath(ctx.repoRoot,row.recordRef.directory);need(contained(root,directory),'record_root_binding');
 const identityBytes=ctx.readSource(join(directory,'identity.json')),journalBytes=ctx.readSource(join(directory,'events.jsonl'));
 need(sha(identityBytes)===row.recordRef.identitySHA256&&journalBytes.length===row.recordRef.journalBytes&&sha(journalBytes)===row.recordRef.journalSHA256,'record_byte_identity');
 historicalReport(row.generationInvocationRef,ctx);ctx.resolveRef(row.sourceRef);
 const queue=schema(ctx.resolveRef(task.seatLayoutPlan),'ohuo-complete-match-queue-v1',['namespace','sourceIndexRef','rows']);need(queue.namespace===task.sourcePlan.namespace&&queue.sourceIndexRef===input.sourceIndexRef,'queue_identity');
 const rows=array(queue.rows,'queue.rows',1).filter(q=>q.matchId===row.key.matchId);need(rows.length===1,'source_queue_match');const q=rows[0];
 need(q.actor===row.key.actorSeat&&q.split===task.sourcePlan.split&&Array.isArray(q.roundFamilyIds)&&Array.isArray(q.seats)&&q.seats.length===4,'source_queue_binding');
 const caller=q.seats.some((s:any)=>s.mode==='hybrid')?'lab/review6_2/match-play-async.ts':'lab/review6_2/match-local-worker.ts';need(common.source.has(caller),'original_caller_source_missing');
 // Validate every journal-named private file before the original loader reads
 // it; the loader still independently checks the actual hash and full replay.
 need(journalBytes.length===0||journalBytes.toString('utf8').endsWith('\n'),'partial_record_journal');
 for(const line of journalBytes.toString('utf8').split('\n').filter(Boolean)){
  const event=JSON.parse(line);strictObject(event,'recordEvent',['type','value']);
  if(event.type==='game'){need(integer(event.value.gameNo,1),'record_game_number');ctx.readSource(join(directory,`game-${event.value.gameNo}.private.json`));}
  else if(event.type==='decision'){keyShape(event.value.key);if(event.value.trainingInputSHA256!==null){shaShape(event.value.trainingInputSHA256);ctx.readSource(join(directory,`decision-${event.value.key.requestSeq}.private.json`));}}
  else need(event.type==='summary','record_event_unknown');
 }
 const cacheKey=digest([row.recordRef,root]);let saved=cache.get(cacheKey);
 if(!saved){const store=loadMatchStore({...row.recordRef,directory},root);saved=store.recorder.snapshot();need(!replayConfirmedMatch(saved.record,saved.privateSources).executionUnknown,'record_execution_unknown');cache.set(cacheKey,saved);}
 const {record,privateSources}=saved as ReturnType<ReturnType<typeof loadMatchStore>['recorder']['snapshot']>;
 const decisions=record.decisions.filter(d=>equal(d.key,row.key)),games=record.games.filter(g=>g.gameNo===row.key.gameNo);need(decisions.length===1&&games.length===1,'record_decision_identity');const decision=decisions[0],game=games[0];
 const split=task.sourcePlan.split==='confirm'?'sealed':task.sourcePlan.split;
 need(record.runId===task.runId&&record.matchId===row.key.matchId&&record.sourceRef===input.sourceIndexRef&&record.layoutRef===task.seatLayoutPlan&&record.sourceFamilyId===q.sourceFamilyId&&record.split===task.sourcePlan.split&&record.evaluatedActor===row.key.actorSeat&&task.sourcePlan.familyIds.includes(record.sourceFamilyId)&&task.sourcePlan.familyIds.includes(game.sourceFamilyId)&&q.roundFamilyIds[row.key.gameNo-1]===game.sourceFamilyId&&ctx.index.families[game.sourceFamilyId!]?.split===split&&equal(record.rules,common.rules),'source_family_actor_rules');
 need(decision.executionKind==='confirmed'&&['selected','fallback'].includes(decision.status)&&decision.trainingInputSHA256===row.inputSHA256,'capture_not_confirmed');
 const seat=record.seatSnapshots?.[row.key.actorSeat] as any;need(seat&&task.releaseRefs.includes(seat.releaseRef)&&q.seats[row.key.actorSeat]?.releaseRef===seat.releaseRef&&equal(seat.policyIdentity,common.base.policyIdentity)&&decision.policyId===record.policyIds[row.key.actorSeat],'source_seat_policy');
 const release=schema(ctx.resolveRef(seat.releaseRef),'ohuo-release-ref-v1',['release','policyIdentity']),known=RELEASES.find(r=>r.releaseRef===release.release?.releaseRef);
 need(known&&equal(known,release.release)&&equal(seat.release,known)&&equal(release.policyIdentity,common.base.policyIdentity)&&known.proposalPolicyRef===common.base.release.proposalPolicyRef&&known.candidateSpecRef===common.base.release.candidateSpecRef&&known.localSelector==='proposal'&&known.mode===q.seats[row.key.actorSeat].mode,'source_release_binding');
 if(known.mode==='hybrid')need(known.promptRef===common.prompt.promptRef&&task.promptRef===input.promptRef,'historical_prompt_binding');
 const captureBytes=ctx.readSource(join(directory,`decision-${row.key.requestSeq}.private.json`)),capture=parse(captureBytes);
 strictObject(capture,'captureInput',['schema','key','policyId','observation','candidateSpec','initialCandidateIds','pool','candidateInputs',...(Object.hasOwn(capture,'selectionBundle')?['selectionBundle']:[])]);
 need(capture.schema==='ohuo-decision-input-v1'&&hashJSON(capture)===row.inputSHA256&&equal(capture.key,row.key)&&capture.policyId===decision.policyId&&equal(capture.initialCandidateIds,decision.initialCandidateIds),'capture_input_identity');
 if(capture.candidateInputs!==null)need(equal(capture.candidateInputs.policyIdentity,common.base.policyIdentity)&&capture.candidateInputs.policyId===common.base.policyIdentity.policyId&&equal(capture.candidateInputs.candidateIds,capture.initialCandidateIds),'candidate_policy_binding');
 need(Array.isArray(capture.pool)&&capture.pool.length>1,'nonunique_capture_required');
 const shell={key:capture.key,observation:capture.observation,decisionId:capture.observation?.decisionId,candidateSpec:capture.candidateSpec,pool:capture.pool,initialCandidateIds:capture.initialCandidateIds,offeredIds:capture.initialCandidateIds,fallbackActionId:capture.pool[0]?.actionId,expansionCount:0,isUniqueLegalAction:false};
 const captureForm=Object.hasOwn(capture,'selectionBundle')?'original-selection-bundle':'derived-original-capture-shell';
 if(captureForm==='original-selection-bundle')need(equal(capture.selectionBundle,shell),'original_selection_bundle_differs');
 else need(common.source.get('lab/review6_2/match-record.ts')?.sha256==='acacc17159dcbd719ada2150b1be3ad43374c503bf3be9618d72650b7f39240d','old_capture_generation_chain_pending');
 const bundle=freezeCopy(captureForm==='original-selection-bundle'?capture.selectionBundle:shell) as DecisionBundle;validatePublicBundle(bundle,common.rules,common.base.release.candidateSpecRef);
 const position=record.decisions.indexOf(decision),earlier=record.decisions.slice(0,position);need(earlier.every(d=>d.key.gameNo<row.key.gameNo||d.key.gameNo===row.key.gameNo&&d.key.moveNo<=row.key.moveNo&&d.key.requestSeq<row.key.requestSeq),'record_prefix_order');
 const prefixRecord:MatchRecord={...record,games:record.games.filter(g=>g.gameNo<=row.key.gameNo),decisions:earlier,summary:null};
 const replay=replayConfirmedMatch(prefixRecord,{...privateSources,games:privateSources.games.filter(g=>g.gameNo<=row.key.gameNo)}),state=replay.state;
 need(!replay.executionUnknown&&state&&!state.over&&state.moveNo===row.key.moveNo&&state.turn===row.key.actorSeat&&state.match.gameNo===row.key.gameNo,'confirmed_prefix_unavailable');
 const previous=earlier.filter(d=>d.key.gameNo===row.key.gameNo&&d.executionKind==='confirmed');need(previous.length===row.key.moveNo&&previous.every((d,i)=>d.key.moveNo===i),'complete_causal_prefix_required');
 const history:PublicHistoryPrefix={matchId:row.key.matchId,gameNo:row.key.gameNo,throughMoveNo:row.key.moveNo,steps:previous.map(d=>({priorTarget:d.priorTarget,events:d.events}))};
 need(equal(buildObservation({state:state!,actorSeat:row.key.actorSeat,matchId:row.key.matchId,decisionId:bundle.decisionId,history}),capture.observation),'original_public_observation_differs');
 for(const c of bundle.pool){resolveLegalMove(state!,c.canonical===null?{pass:true}:{pass:false,combo:c.canonical});need(canonicalActionId(c.canonical,state!.ctx)===c.canonicalId,'original_canonical_legality');}
 return {bundle,captureForm,evidence:{schema:'ohuo-probe-extraction-row-evidence-v1',snapshotId:row.snapshotId,sourceTaskRef:binding.sourceTaskRef,generationInvocationRef:row.generationInvocationRef,sourceRef:row.sourceRef,producerSourceRevision:input.producerSourceRevision,producerEntry:common.producerEntry,key:row.key,inputSHA256:row.inputSHA256,recordIdentitySHA256:sha(identityBytes),journalBytes:journalBytes.length,journalSHA256:sha(journalBytes),captureBytesSHA256:sha(captureBytes),bundleRef:referenceOf(`${input.outputId}/bundle-${String(input.captures.indexOf(row)+1).padStart(2,'0')}`,bundle),captureForm,checks:rowChecks,limits:rowLimits}};
}
interface Artifact {name:string;fileRef:P;reference:R}
const artifactNames=(final=false)=>[...Array.from({length:12},(_,i)=>[`bundle-${String(i+1).padStart(2,'0')}.json`,`extraction-row-evidence-${String(i+1).padStart(2,'0')}.json`]).flat(),'extraction-evidence.json','extraction.json',...(final?[...Array.from({length:12},(_,i)=>[`generation-${String(i+1).padStart(2,'0')}.json`,`public-source-${String(i+1).padStart(2,'0')}.json`,`phase-${String(i+1).padStart(2,'0')}.json`]).flat(),'phase-review.json','snapshot-set.json']:[])];
function localArtifact(ctx:PreparationContext,name:string){need(artifactNames(true).includes(name)||name==='manifest.json','unsupported_artifact');const path=join(ctx.outputRoot,name);if(!existsSync(path))return null;const bytes=regularBytes(ctx.repoRoot,path),value=parse(bytes);need(bytes.toString('utf8')===canonical(value)+'\n','artifact_byte_conflict');return {name,value,bytes,reference:referenceOf(`${ctx.input.outputId}/${name.slice(0,-5)}`,value),fileRef:{path:name,sha256:sha(bytes)}};}
function writeExclusive(ctx:PreparationContext,path:string,bytes:Buffer|string,privateFile=false){
 abort(ctx.signal);safePath(ctx.repoRoot,path,true);const parent=dirname(path);if(!existsSync(parent))mkdirSync(parent,{recursive:true,mode:0o700});safePath(ctx.repoRoot,parent);
 try{writeFileSync(path,bytes,{flag:'wx',mode:0o600});}catch(error:any){if(error.code!=='EEXIST')throw error;need(equal(regularBytes(ctx.repoRoot,path,privateFile),Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes)),'output_conflict');}
}
function publish(ctx:PreparationContext,name:string,value:any):Artifact{
 need(artifactNames(true).includes(name)||name==='manifest.json','unsupported_artifact');const bytes=canonical(value)+'\n';writeExclusive(ctx,join(ctx.outputRoot,name),bytes);return {name,fileRef:{path:name,sha256:sha(bytes)},reference:referenceOf(`${ctx.input.outputId}/${name.slice(0,-5)}`,value)};
}
function retainBinding(ctx:PreparationContext,stage:'extract'|'finalize'){writeExclusive(ctx,join(ctx.outputRoot,`evidence/preparation-binding-${stage}.private.json`),ctx.bindingBytes,true);}
function extractionShape(ext:any,input:any,ctx:PreparationContext){
 schema(ext,'ohuo-probe-capture-extraction-v1',extKeys);fileRef(ext.inputRef);need(equal(ext.inputRef,ctx.extractInputRef),'extraction_input_binding');
 for(const key of ['sourceIndexRef','rulesRef','parentPolicyRef','candidateRef','promptRef','producerSourceRevision','classificationRuleRef','coverageRuleRef','extractionEvidenceRef'])fixedReference(ext[key],key);
 if(input.schema==='ohuo-probe-capture-extract-v1')for(const key of ['sourceIndexRef','rulesRef','parentPolicyRef','candidateRef','promptRef','producerSourceRevision','classificationRuleRef','coverageRuleRef'])need(input[key]===ext[key],'extraction_reference_binding');
 array(ext.rows,'extraction.rows',12,12);const ids=new Set<string>(),refs=new Set<string>();
 for(const row of ext.rows){strictObject(row,'extractionRow',['snapshotId','bundleRef','sourceRef','generationInvocationRef','captureForm','extractionRowEvidenceRef']);validateIdentifier(row.snapshotId,'snapshotId');for(const key of ['bundleRef','sourceRef','generationInvocationRef','extractionRowEvidenceRef'])fixedReference(row[key],key);need(['original-selection-bundle','derived-original-capture-shell'].includes(row.captureForm)&&!ids.has(row.snapshotId)&&!refs.has(row.bundleRef),'extraction_row_identity');ids.add(row.snapshotId);refs.add(row.bundleRef);}
}
function aggregateShape(a:any,ext:any,ctx:PreparationContext){
 schema(a,'ohuo-probe-extraction-evidence-v1',aggregateKeys);need(equal(a.inputRef,ctx.extractInputRef)&&a.planRef===ctx.input.planRef&&a.clauseRef===ctx.input.clauseRef&&a.authorizationRef===ctx.input.authorizationRef&&a.outputId===ctx.input.outputId&&a.preparerSourceRevision===ctx.binding.preparerSourceRevision&&a.producerSourceRevision===ext.producerSourceRevision&&equal(a.rows,ext.rows.map((r:any)=>r.extractionRowEvidenceRef))&&equal(a.limits,extractionLimits),'extraction_evidence_binding');
 shaShape(a.bindingBytesSHA256);shaShape(a.approvalEvidenceSHA256);need(a.approvalEvidenceSHA256===sha(ctx.approvalBytes),'extraction_approval_binding');
 const observations=array(a.observations,'observations',2,2);for(const [i,o] of observations.entries()){strictObject(o,'observation',['phase','planCloseoutSHA256','controlStateSHA256']);need(o.phase===(i===0?'before-read':'before-publish'),'extraction_observation_order');shaShape(o.planCloseoutSHA256);shaShape(o.controlStateSHA256);}
 const privateBindingPath=join(ctx.outputRoot,'evidence/preparation-binding-extract.private.json');
 // Finalize cannot open the old private sidecar either. Its published digest is
 // an identity binding, not an invitation to follow its old source paths.
 if(ctx.input.schema==='ohuo-probe-capture-extract-v1'){need(a.bindingBytesSHA256===sha(ctx.bindingBytes),'extraction_sidecar_binding');if(existsSync(privateBindingPath))need(equal(regularBytes(ctx.repoRoot,privateBindingPath,true),ctx.bindingBytes),'extraction_retained_binding');}
}
function checkRowEvidence(e:any,row:any,bundle:DecisionBundle,ext:any,ctx:PreparationContext,index:number,common:ReturnType<typeof commonReferences>){
 schema(e,'ohuo-probe-extraction-row-evidence-v1',rowEvidenceKeys);keyShape(e.key);for(const k of ['sourceTaskRef','generationInvocationRef','sourceRef','producerSourceRevision','bundleRef'])fixedReference(e[k],k);for(const k of ['inputSHA256','recordIdentitySHA256','journalSHA256','captureBytesSHA256'])shaShape(e[k]);need(integer(e.journalBytes),'row_journal_bytes');
 need(e.snapshotId===row.snapshotId&&e.bundleRef===row.bundleRef&&e.sourceRef===row.sourceRef&&e.generationInvocationRef===row.generationInvocationRef&&e.captureForm===row.captureForm&&e.producerSourceRevision===ext.producerSourceRevision&&equal(e.producerEntry,common.producerEntry)&&equal(e.key,bundle.key)&&equal(e.checks,rowChecks)&&equal(e.limits,rowLimits),'row_evidence_binding');
 if(ctx.input.schema==='ohuo-probe-capture-extract-v1'){const c=ctx.input.captures[index],binding=ctx.sourceBindings[index];need(c.snapshotId===e.snapshotId&&c.sourceRef===e.sourceRef&&c.generationInvocationRef===e.generationInvocationRef&&binding.sourceTaskRef===e.sourceTaskRef&&equal(c.key,e.key)&&c.inputSHA256===e.inputSHA256&&c.recordRef.identitySHA256===e.recordIdentitySHA256&&c.recordRef.journalBytes===e.journalBytes&&c.recordRef.journalSHA256===e.journalSHA256,'resumed_capture_binding');}
}
function preflightOutputs(ctx:PreparationContext,docs:Array<[string,any]>){for(const [name,value] of docs){const old=localArtifact(ctx,name);if(old)need(old.bytes.toString('utf8')===canonical(value)+'\n','output_conflict');}}
function validateExtractionLocal(ext:any,ctx:PreparationContext,common:ReturnType<typeof commonReferences>){
 extractionShape(ext,ctx.input,ctx);const aggregate=localArtifact(ctx,'extraction-evidence.json');need(aggregate&&aggregate.reference===ext.extractionEvidenceRef,'extraction_artifact_missing');aggregateShape(aggregate!.value,ext,ctx);
 const snapshots:DecisionBundle[]=[],artifacts:Artifact[]=[],keys=new Set<string>();
 for(const [i,row] of ext.rows.entries()){
  const suffix=String(i+1).padStart(2,'0'),bundle=localArtifact(ctx,`bundle-${suffix}.json`),evidence=localArtifact(ctx,`extraction-row-evidence-${suffix}.json`);need(bundle&&evidence&&bundle.reference===row.bundleRef&&evidence.reference===row.extractionRowEvidenceRef,'extraction_artifact_missing');
  validatePublicBundle(bundle!.value,common.rules,common.base.release.candidateSpecRef);checkRowEvidence(evidence!.value,row,bundle!.value,ext,ctx,i,common);const key=digest(bundle!.value.key);need(!keys.has(key),'duplicate_decision');keys.add(key);snapshots.push(bundle!.value);
  artifacts.push({name:bundle!.name,fileRef:bundle!.fileRef,reference:bundle!.reference},{name:evidence!.name,fileRef:evidence!.fileRef,reference:evidence!.reference});
 }
 const extraction=localArtifact(ctx,'extraction.json');need(extraction&&equal(extraction.value,ext),'extraction_artifact_missing');artifacts.push({name:aggregate!.name,fileRef:aggregate!.fileRef,reference:aggregate!.reference},{name:extraction!.name,fileRef:extraction!.fileRef,reference:extraction!.reference});
 return {snapshots,artifacts,aggregate:aggregate!.value};
}
async function extractStage(input:ExtractInput,ctx:PreparationContext,before:any){
 const common=commonReferences(input,ctx),completed=localArtifact(ctx,'extraction.json');
 const retained=join(ctx.outputRoot,'evidence/preparation-binding-extract.private.json');if(artifactNames(false).some(name=>existsSync(join(ctx.outputRoot,name)))){need(existsSync(retained),'extraction_retained_binding_missing');need(equal(regularBytes(ctx.repoRoot,retained,true),ctx.bindingBytes),'extraction_retained_binding');}
 if(completed){const checked=validateExtractionLocal(completed.value,ctx,common);ctx.observe('before-publish');return {status:'extracted',extractionRef:completed.reference,artifacts:checked.artifacts};}
 const captured:any[]=[],rows:any[]=[],cache=new Map<string,any>(),docs:Array<[string,any]>=[],keys=new Set<string>();
 const ext:any={schema:'ohuo-probe-capture-extraction-v1',inputRef:ctx.inputRef};for(const key of ['sourceIndexRef','rulesRef','parentPolicyRef','candidateRef','promptRef','producerSourceRevision','classificationRuleRef','coverageRuleRef'])ext[key]=(input as any)[key];
 for(const [i,row] of input.captures.entries()){
  abort(ctx.signal);const suffix=String(i+1).padStart(2,'0'),bundleName=`bundle-${suffix}.json`,evidenceName=`extraction-row-evidence-${suffix}.json`,savedBundle=localArtifact(ctx,bundleName),savedEvidence=localArtifact(ctx,evidenceName);let value:any;
  if(savedBundle&&savedEvidence){
   const evidence=savedEvidence.value,oldRow={snapshotId:row.snapshotId,bundleRef:savedBundle.reference,sourceRef:row.sourceRef,generationInvocationRef:row.generationInvocationRef,captureForm:evidence.captureForm,extractionRowEvidenceRef:savedEvidence.reference};
   validatePublicBundle(savedBundle.value,common.rules,common.base.release.candidateSpecRef);checkRowEvidence(evidence,oldRow,savedBundle.value,ext,ctx,i,common);historicalReport(row.generationInvocationRef,ctx);ctx.resolveRef(row.sourceRef);value={bundle:savedBundle.value,captureForm:evidence.captureForm,evidence};
  }else value=readCapturedProbeDecision(row,ctx.sourceBindings[i],input,ctx,common,cache);
  const key=digest(value.bundle.key);need(!keys.has(key),'duplicate_decision');keys.add(key);captured.push(value);docs.push([bundleName,value.bundle],[evidenceName,value.evidence]);
  rows.push({snapshotId:row.snapshotId,bundleRef:referenceOf(`${input.outputId}/bundle-${suffix}`,value.bundle),sourceRef:row.sourceRef,generationInvocationRef:row.generationInvocationRef,captureForm:value.captureForm,extractionRowEvidenceRef:referenceOf(`${input.outputId}/extraction-row-evidence-${suffix}`,value.evidence)});
  await new Promise<void>(done=>setImmediate(done));
 }
 ext.rows=rows;const after=ctx.observe('before-publish'),savedAggregate=localArtifact(ctx,'extraction-evidence.json');
 const aggregate=savedAggregate?.value??{schema:'ohuo-probe-extraction-evidence-v1',inputRef:ctx.inputRef,planRef:input.planRef,clauseRef:input.clauseRef,authorizationRef:input.authorizationRef,outputId:input.outputId,preparerSourceRevision:ctx.binding.preparerSourceRevision,producerSourceRevision:input.producerSourceRevision,bindingBytesSHA256:sha(ctx.bindingBytes),approvalEvidenceSHA256:sha(ctx.approvalBytes),observations:[before,after],rows:rows.map(r=>r.extractionRowEvidenceRef),limits:extractionLimits};
 aggregateShape(aggregate,ext,ctx);ext.extractionEvidenceRef=referenceOf(`${input.outputId}/extraction-evidence`,aggregate);extractionShape(ext,input,ctx);
 docs.push(['extraction-evidence.json',aggregate],['extraction.json',ext]);preflightOutputs(ctx,docs);retainBinding(ctx,'extract');const artifacts=docs.map(([name,value])=>publish(ctx,name,value));
 return {status:'extracted',extractionRef:referenceOf(`${input.outputId}/extraction`,ext),artifacts};
}
function finalizeStage(input:FinalizeInput,ctx:PreparationContext){
 const ext=ctx.resolveRef(input.extractionRef);extractionShape(ext,input,ctx);const common=commonReferences(ext,ctx),checked=validateExtractionLocal(ext,ctx,common);
 need(input.extractionRef===referenceOf(`${input.outputId}/extraction`,ext),'finalize_extraction_identity');
 need(equal(ctx.resolveRef(ext.extractionEvidenceRef),checked.aggregate),'extraction_catalog_binding');
 const review=schema(ctx.resolveRef(input.reviewInputRef),'ohuo-probe-preparation-review-v1',['extractionRef','classificationRuleRef','coverageRuleRef','rows','requiredResourceClassIds','resourceWitnesses','passWitnesses','reviewEvidenceRef']);
 need(review.extractionRef===input.extractionRef&&review.classificationRuleRef===ext.classificationRuleRef&&review.coverageRuleRef===ext.coverageRuleRef,'review_extraction_binding');historicalReport(review.reviewEvidenceRef,ctx);array(review.rows,'review.rows',12,12);
 const phases={early:0,middle:0,late:0},docs:Array<[string,any]>=[],snapshotRows:any[]=[],phaseRows:any[]=[];
 for(const [i,row] of review.rows.entries()){
  strictObject(row,'reviewRow',['snapshotId','bundleRef','phase','generationReviewRef','visibilityReviewRef','phaseReviewEvidenceRef']);const extractionRow=ext.rows[i];
  need(row.snapshotId===extractionRow.snapshotId&&row.bundleRef===extractionRow.bundleRef&&['early','middle','late'].includes(row.phase),'review_row_binding');phases[row.phase as keyof typeof phases]++;
  for(const key of ['generationReviewRef','visibilityReviewRef','phaseReviewEvidenceRef'])historicalReport(row[key],ctx);historicalReport(extractionRow.generationInvocationRef,ctx);ctx.resolveRef(extractionRow.sourceRef);
  need(equal(ctx.resolveRef(row.bundleRef),checked.snapshots[i]),'bundle_catalog_binding');const suffix=String(i+1).padStart(2,'0');
  const generation={schema:'ohuo-probe-generation-evidence-v1',snapshotId:row.snapshotId,bundleRef:row.bundleRef,sourceIndexRef:ext.sourceIndexRef,sourceRef:extractionRow.sourceRef,parentPolicyRef:ext.parentPolicyRef,candidateRef:ext.candidateRef,promptRef:ext.promptRef,rulesRef:ext.rulesRef,producerSourceRevision:ext.producerSourceRevision,producerEntry:common.producerEntry,invocationEvidenceRef:extractionRow.generationInvocationRef,reviewEvidenceRef:row.generationReviewRef};
  const source={schema:'ohuo-probe-public-source-v1',snapshotId:row.snapshotId,bundleRef:row.bundleRef,sourceIndexRef:ext.sourceIndexRef,sourceRef:extractionRow.sourceRef,visibilityReviewRef:row.visibilityReviewRef};
  const phase={schema:'ohuo-probe-phase-evidence-v1',snapshotId:row.snapshotId,bundleRef:row.bundleRef,phase:row.phase,classificationRuleRef:review.classificationRuleRef,reviewEvidenceRef:row.phaseReviewEvidenceRef};
  docs.push([`generation-${suffix}.json`,generation],[`public-source-${suffix}.json`,source],[`phase-${suffix}.json`,phase]);
  const phaseEvidenceRef=referenceOf(`${input.outputId}/phase-${suffix}`,phase);snapshotRows.push({snapshotId:row.snapshotId,phase:row.phase,phaseEvidenceRef,bundleRef:row.bundleRef,generationEvidenceRef:referenceOf(`${input.outputId}/generation-${suffix}`,generation),publicSourceRef:referenceOf(`${input.outputId}/public-source-${suffix}`,source)});phaseRows.push({snapshotId:row.snapshotId,bundleRef:row.bundleRef,phaseEvidenceRef});
 }
 need(Object.values(phases).every(n=>n===4),'phase_counts');
 const required=array(review.requiredResourceClassIds,'requiredResourceClassIds',1);for(const id of required)validateIdentifier(id,'resourceClassId');need(new Set(required).size===required.length,'duplicate_resource_class');
 const witness=(w:any)=>{const i=ext.rows.findIndex((r:any)=>r.snapshotId===w.snapshotId);need(i>=0&&ext.rows[i].bundleRef===w.bundleRef,'coverage_snapshot_binding');const c=checked.snapshots[i].pool.find(c=>c.actionId===w.actionId);need(c,'coverage_action_binding');return c!;};
 const covered=new Set<string>();for(const w of array(review.resourceWitnesses,'resourceWitnesses',1)){strictObject(w,'resourceWitness',['snapshotId','bundleRef','actionId','classId','resources','wildAs']);const actual=publicCombo(witness(w).canonical);need(required.includes(w.classId)&&actual&&equal(actual.resources,w.resources)&&equal(actual.wildAs,w.wildAs),'resource_witness_binding');covered.add(w.classId);}
 need(required.every(id=>covered.has(id)),'resource_class_missing');for(const w of array(review.passWitnesses,'passWitnesses',1)){strictObject(w,'passWitness',['snapshotId','bundleRef','actionId']);need(witness(w).canonical===null,'pass_witness_binding');}
 const phaseReview={schema:'ohuo-probe-phase-review-v1',classificationRuleRef:review.classificationRuleRef,coverageRuleRef:review.coverageRuleRef,rows:phaseRows,requiredResourceClassIds:required,resourceWitnesses:review.resourceWitnesses,passWitnesses:review.passWitnesses,reviewEvidenceRef:review.reviewEvidenceRef};
 const set={schema:'ohuo-api-probe-snapshots-v1',sourceIndexRef:ext.sourceIndexRef,rulesRef:ext.rulesRef,parentPolicyRef:ext.parentPolicyRef,candidateRef:ext.candidateRef,promptRef:ext.promptRef,snapshots:snapshotRows};docs.push(['phase-review.json',phaseReview],['snapshot-set.json',set]);
 const expectedArtifacts=docs.map(([name,value])=>({name,fileRef:{path:name,sha256:sha(canonical(value)+'\n')},reference:referenceOf(`${input.outputId}/${name.slice(0,-5)}`,value)}));
 const manifest={schema:'ohuo-probe-preparation-manifest-v1',stage:'finalize',status:'complete-public-artifacts',inputRef:ctx.inputRef,extractInputRef:ctx.extractInputRef,extractionRef:input.extractionRef,reviewInputRef:input.reviewInputRef,outputId:input.outputId,preparerSourceRevision:ctx.binding.preparerSourceRevision,artifacts:[...checked.artifacts,...expectedArtifacts]};
 preflightOutputs(ctx,[...docs,['manifest.json',manifest]]);ctx.observe('before-publish');retainBinding(ctx,'finalize');for(const [name,value] of docs)publish(ctx,name,value);const artifact=publish(ctx,'manifest.json',manifest);
 return {status:'complete-public-artifacts',snapshotSetRef:referenceOf(`${input.outputId}/snapshot-set`,set),phaseReviewRef:referenceOf(`${input.outputId}/phase-review`,phaseReview),manifest:artifact};
}
/** The sole public entry. A trusted caller supplies an already constructed
 * preparation context; CLI always constructs it from the fixed on-disk facts.
 * This return value is not a research qualification or an authorization. */
export async function prepareApiProbeSnapshots(input:unknown,trustedContext:unknown){
 const fixed=freezeCopy(inputShape(input));const ctx=trustedContext as PreparationContext;
 need(ctx&&typeof ctx.observe==='function'&&typeof ctx.resolveRef==='function'&&typeof ctx.readP==='function'&&equal(ctx.input,fixed),'preparation_context_pending');
 abort(ctx.signal);const before=ctx.observe('before-read');ctx.verifyPreparerSource();return fixed.schema==='ohuo-probe-capture-extract-v1'?await extractStage(fixed,ctx,before):finalizeStage(fixed,ctx);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const controller=new AbortController(),stop=()=>controller.abort('user_stop');process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{const args=cliArguments(process.argv.slice(2)),inputRef={path:args.input,sha256:args.sha256};const bytes=regularBytes(projectRoot,args.input);need(sha(bytes)===args.sha256,'input_sha_mismatch');const input=inputShape(parse(bytes));const ctx=new PreparationContext(input,inputRef,args.output,controller.signal);const result=await prepareApiProbeSnapshots(input,ctx);process.stdout.write(JSON.stringify(result)+'\n');}
 catch(error:any){const reason=error?.code==='ENOENT'?'preparation_context_pending:missing_file':error instanceof Error?error.message:'preparation_failed';process.stderr.write(reason+'\n');process.exitCode=1;}
 finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
