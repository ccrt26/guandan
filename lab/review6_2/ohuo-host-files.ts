/** Explicit local production data adapter. No Task-supplied code, network,
 * credentials, model reads, or implicit zero ledger. See frozen M0-H card. */
import {readFileSync,writeFileSync,lstatSync,statSync,realpathSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,relative,join,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {fail,strictObject,fixedReference,validateIdentifier,validateLimits,validateTask,digest,canonical,taskReferences} from './task-schema.mjs';
import {acquireSourceWriter} from './writer-lock';
import {buildPythonEnvironment} from './python-environment';
import {buildCalibrationQualification,verifyNumericalRecoveryRole} from './numerical-recovery';
import {verifyProbeSnapshots} from './api-probe-consumer';
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const req=createRequire(import.meta.url);
const KINDS=['probe','collect','evaluate','supervised_training'],CAPS=['B04.api-probe.v1','B07.complete-match.v1','B07.offline-label.v1','B10.supervised-rerank.v1'];
const freezeJSON=(value:any):any=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freezeJSON(v);Object.freeze(value);}return value;};
const sameRefs=(a:any[],b:any[])=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(x=>b.includes(x));
const string=(v:any)=>typeof v==='string'&&v.trim().length>0;
const hash=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:any,min=0)=>Number.isSafeInteger(v)&&v>=min;
const array=(v:any,name:string)=>{if(!Array.isArray(v)||v.length>10000)fail('invalid_host_field',name,'bounded explicit array required');return v;};
const strings=(v:any,name:string)=>{const a=array(v,name);if(a.some((x:any)=>!string(x))||new Set(a).size!==a.length)fail('invalid_host_field',name,'unique nonempty strings required');return a;};
const scope=(s:any)=>{strictObject(s,'scope',['localExecution','apiCalls','parameterUpdates','deployment']);if(Object.values(s).some(v=>typeof v!=='boolean')||s.deployment)fail('scope_not_authorized','scope','explicit fixed nondeployment scope required');};
export class FixedHostFiles {
 readonly manifest:any;readonly root:string;readonly productionPlanClosure=true;
 private references=new Map<string,any>();private evidence=new Map<string,any>();private bindings=new Map<string,any>();
 private recoveryContexts=new WeakSet<object>();private probeContexts=new WeakSet<object>();private selectionContexts=new WeakSet<object>();
 constructor(readonly repositoryRoot:string){
  if(realpathSync(repositoryRoot)!==repositoryRoot)fail('invalid_host_path','repositoryRoot','real repository required');
  const path=join(repositoryRoot,'deliverables/ohuo-runtime/host.json');if(!existsSync(path))fail('fixed_host_missing','host.json','fixed local host configuration is absent');
  this.manifest=this.jsonBytes(this.regular(path,true));const m=this.manifest;
  if(!['ohuo-fixed-host-v1','ohuo-fixed-host-v2'].includes(m.schema))fail('unsupported_host_schema','schema','fixed host v1 or v2 required');
  strictObject(m,'host',['schema','controlRoot','rootInstanceId','initialStateRef','references','evidenceFiles','grantFile','planCloseoutFile','inputBindings','profileStorePath','pythonPath',...(m.schema==='ohuo-fixed-host-v2'?['numericalRecoveryAssignments']:[])]);
  if(m.schema==='ohuo-fixed-host-v2'){const paths=new Set();for(const f of array(m.numericalRecoveryAssignments,'numericalRecoveryAssignments')){this.fileShape(f);if(paths.has(f.path))fail('duplicate_reference','numericalRecoveryAssignments','assignment file repeated');paths.add(f.path);}}
  validateIdentifier(m.rootInstanceId,'rootInstanceId');fixedReference(m.initialStateRef,'initialStateRef');
  this.root=this.directory(m.controlRoot);if(!relative(join(repositoryRoot,'lab/out'),this.root)||relative(join(repositoryRoot,'lab/out'),this.root).startsWith('..'))fail('invalid_output_root','controlRoot','existing control root below lab/out required');
  for(const r of array(m.references,'references')){strictObject(r,'reference',['ref','file']);fixedReference(r.ref,'reference');if(this.references.has(r.ref))fail('duplicate_reference','references','fixed reference repeated');this.fileShape(r.file);this.references.set(r.ref,r.file);}
  for(const e of array(m.evidenceFiles,'evidenceFiles')){strictObject(e,'evidenceFile',['id','file']);if(!string(e.id)||this.evidence.has(e.id))fail('duplicate_reference','evidenceFiles','unique artifact ID required');this.fileShape(e.file);this.evidence.set(e.id,e.file);}
  this.fileShape(m.grantFile);this.relativePath(m.planCloseoutFile);
  if(m.profileStorePath!==null)this.relativePath(m.profileStorePath);if(m.pythonPath!==null&&(!string(m.pythonPath)||!isAbsolute(m.pythonPath)))fail('invalid_host_path','pythonPath','explicit absolute interpreter path or null');
  for(const b of array(m.inputBindings,'inputBindings')){strictObject(b,'inputBinding',['taskRef','sourceIndexFile','confirmedRecordRoots','datasetDirectory','studentReleaseFiles','seed','trainingPhase','numericalRestartReceiptRef']);fixedReference(b.taskRef,'taskRef');if(this.bindings.has(b.taskRef))fail('duplicate_reference','inputBindings','one binding per exact task');this.fileShape(b.sourceIndexFile);strings(b.confirmedRecordRoots,'confirmedRecordRoots');for(const r of array(b.studentReleaseFiles,'studentReleaseFiles')){strictObject(r,'studentReleaseFile',['ref','file']);fixedReference(r.ref,'studentReleaseFile.ref');this.fileShape(r.file);}this.bindings.set(b.taskRef,b);}
  if(m.schema==='ohuo-fixed-host-v2'){
   const branches=new Set(),tasks=new Set();for(const file of m.numericalRecoveryAssignments){const a=this.readJSON(file);strictObject(a,'numericalRecoveryAssignment',['schema','specRef','receiptRef','roles']);if(a.schema!=='ohuo-numerical-recovery-assignment-v1')fail('unsupported_host_schema','assignment.schema','fixed assignment v1 required');fixedReference(a.specRef,'specRef');fixedReference(a.receiptRef,'receiptRef');const spec=this.resolveRef(a.specRef);strictObject(spec,'numericalRecoverySpec',['schema','branchId','branchRef','originalRuleRef','planRef','budgetRef','researchBatchId','originExperimentId','failedTaskRef','failedRunId','case','roles']);if(spec.schema!=='ohuo-numerical-recovery-spec-v1')fail('unsupported_host_schema','spec.schema','fixed numerical spec required');fixedReference(spec.planRef,'spec.planRef');fixedReference(spec.branchRef,'spec.branchRef');const key=canonical([spec.planRef,spec.branchRef]);if(branches.has(key))fail('branch_history_conflict','assignments','same original branch cannot have two assignments/specs');branches.add(key);const roles=new Set();for(const row of array(a.roles,'assignment.roles')){strictObject(row,'assignment.role',['role','taskRef']);fixedReference(row.taskRef,'taskRef');if(!['calibration_recovery','formal_continuation','formal_recovery'].includes(row.role)||roles.has(row.role)||tasks.has(row.taskRef))fail('branch_role_conflict','assignments','one Task per role and one assignment per Task required');roles.add(row.role);tasks.add(row.taskRef);}if(roles.size<1||roles.size>2)fail('branch_role_conflict','assignments','only fixed one/two-role assignment supported');}
  }

 }
 private relativePath(p:any){if(!string(p)||isAbsolute(p)||p.split(/[\\/]/).some((s:string)=>!s||s==='.'||s==='..'))fail('invalid_host_path','path','explicit repo-relative nonsymlink path required');return resolve(this.repositoryRoot,p);}
 private regular(path:string,privateFile=false){const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||realpathSync(path)!==path||privateFile&&(st.mode&0o777)!==0o600||st.size>32*1024*1024)fail('invalid_host_file','path','bounded regular nonsymlink file with required privacy mode');return readFileSync(path);}
 private jsonBytes(b:Buffer){try{return JSON.parse(b.toString('utf8'));}catch{fail('invalid_host_json','file','valid JSON required');}}
 private fileShape(f:any){strictObject(f,'fileRef',['path','sha256']);this.relativePath(f.path);if(!hash(f.sha256))fail('invalid_reference','fileRef.sha256','bytes SHA required');}
 directory(p:string){const full=this.relativePath(p);if(!lstatSync(full).isDirectory()||realpathSync(full)!==full)fail('invalid_host_path','directory','existing real directory required');return full;}
 readFile(f:any,privateFile=false){this.fileShape(f);const bytes=this.regular(this.relativePath(f.path),privateFile);if(sha(bytes)!==f.sha256)fail('reference_identity_mismatch',f.path,'frozen file bytes changed');return bytes;}
 readJSON(f:any,privateFile=false){return this.jsonBytes(this.readFile(f,privateFile));}
 resolveRef=(ref:string)=>{fixedReference(ref,'reference');const f=this.references.get(ref);if(!f)fail('reference_unavailable',ref,'reference not in fixed host catalog');const value=this.readJSON(f);if(digest(value)!==ref.slice(ref.lastIndexOf(':')+1))fail('reference_identity_mismatch',ref,'canonical JSON digest differs');return value;};
 evidenceBytes(ref:any){strictObject(ref,'evidenceRef',['id','sha256']);const f=this.evidence.get(ref.id);if(!f||f.sha256!==ref.sha256)fail('evidence_unavailable','evidenceRef','fixed artifact mapping unavailable');return this.readFile(f);}
 private evidenceList(refs:any){for(const ref of array(refs,'evidence_refs'))this.evidenceBytes(ref);}
 private taskEntry(task:any,g:any){const matches=g.tasks.filter((t:any)=>t.taskRef.endsWith('@sha256:'+digest(task)));if(matches.length!==1)fail('authorization_unverified','taskRef','exact TaskFile not independently granted');return matches[0];}
 readGrant(){
  const g=this.readJSON(this.manifest.grantFile,true);
  strictObject(g,'grant',['schema','authorizationRef','planRef','planVersion','controlRoot','rootInstanceId','initialStateRef','initialization','mode','allowedTaskKinds','allowedCapabilityIds','scope','limits','tasks','approvalEvidence']);
  if(g.schema!=='ohuo-local-research-grant-v1'||g.mode!=='research'||g.controlRoot!==this.manifest.controlRoot||g.rootInstanceId!==this.manifest.rootInstanceId||g.initialStateRef!==this.manifest.initialStateRef||!integer(g.planVersion,1)||!['new-control-root','existing-control-root'].includes(g.initialization))fail('authorization_unverified','grant','fixed local original approval binding required');
  for(const k of ['authorizationRef','planRef','initialStateRef'])fixedReference(g[k],k);scope(g.scope);validateLimits(g.limits);
  if(strings(g.allowedTaskKinds,'allowedTaskKinds').some((k:string)=>!KINDS.includes(k))||strings(g.allowedCapabilityIds,'allowedCapabilityIds').some((k:string)=>!CAPS.includes(k)))fail('authorization_unverified','grant','unsupported capability scope');
  const seen=new Set();for(const t of array(g.tasks,'tasks')){strictObject(t,'taskGrant',['taskRef','prerequisiteReceipts']);fixedReference(t.taskRef,'taskRef');if(seen.has(t.taskRef))fail('duplicate_reference','taskGrant','duplicate task');seen.add(t.taskRef);const requirements=new Set();for(const p of array(t.prerequisiteReceipts,'prerequisiteReceipts')){strictObject(p,'prerequisite',['requirementRef','receiptRef']);fixedReference(p.requirementRef,'requirementRef');fixedReference(p.receiptRef,'receiptRef');if(requirements.has(p.requirementRef))fail('duplicate_reference','prerequisite','duplicate requirement');requirements.add(p.requirementRef);}}
  // This is an independently materialized approval record, not a permission
  // minted by this program. Tool/OS/user authority remains independently needed.
  this.readFile(g.approvalEvidence,true);this.resolveRef(g.authorizationRef);this.resolveRef(g.planRef);return g;
 }
 checkAuthorization=async(task:any)=>{
  const g=this.readGrant(),c=this.resolveRef(task.capabilityRef);strictObject(c,'capability',['id','kind','mode']);this.taskEntry(task,g);
  if(task.authorizationRef!==g.authorizationRef||task.planRef!==g.planRef||task.planVersion!==g.planVersion||!g.allowedTaskKinds.includes(task.taskKind)||!g.allowedCapabilityIds.includes(c.id)||c.kind!==task.taskKind||c.mode!=='research')fail('authorization_unverified','task','task/plan/kind binding differs');
  for(const k of Object.keys(task.operationScope))if(task.operationScope[k]&&!g.scope[k])fail('scope_not_authorized',k,'operation outside independent grant');
  const budget=this.resolveRef(task.budgetRef);if(budget.authorizationRef!==g.authorizationRef||budget.planRef!==g.planRef||budget.controlRoot!==this.root)fail('budget_binding_conflict','budgetRef','original root/authorization/plan required');
  validateLimits(task.limits);validateLimits(budget.limits);for(const k of Object.keys(g.limits))if(task.limits[k]>g.limits[k]||budget.limits[k]>g.limits[k])fail('scope_not_authorized',k,'task/shared budget exceeds grant');
  return {authorizationRef:g.authorizationRef,controlRoot:this.root,scope:g.scope,mode:'research'};
 };
 readCloseout(){
  const pointer=this.jsonBytes(this.regular(this.relativePath(this.manifest.planCloseoutFile)));
  strictObject(pointer,'currentCloseout',['schema','planRef','planVersion','revision','closeout']);strictObject(pointer.closeout,'closeoutRef',['ref','file']);
  if(pointer.schema!=='ohuo-current-plan-closeout-v1'||!integer(pointer.planVersion,1)||!integer(pointer.revision,1))fail('plan_closeout_unverified','pointer','fixed current closeout identity required');fixedReference(pointer.planRef,'planRef');fixedReference(pointer.closeout.ref,'closeout.ref');
  const c=this.readJSON(pointer.closeout.file);if(digest(c)!==pointer.closeout.ref.split(':').at(-1))fail('plan_closeout_unverified','closeout','canonical identity differs');
  strictObject(c,'planCloseout',['schema','planRef','planVersion','status','inputPackageRef','inputManifestSHA','analysisRef','actions','evidence_refs','unresolved']);
  if(c.schema!=='ohuo-plan-closeout-v1'||c.planRef!==pointer.planRef||c.planVersion!==pointer.planVersion||!['incomplete','completed','terminated'].includes(c.status))fail('plan_closeout_unverified','closeout','plan/version/status differs');
  strings(c.unresolved,'unresolved');this.evidenceList(c.evidence_refs);
  if(c.inputPackageRef===null){if(c.inputManifestSHA!==null)fail('plan_closeout_unverified','inputManifestSHA','input identity cannot be partial');}else{this.evidenceBytes(c.inputPackageRef);if(c.inputManifestSHA!==c.inputPackageRef.sha256)fail('plan_closeout_unverified','inputManifestSHA','must bind original pre-analysis input');}
  if(c.analysisRef!==null){
   const a=this.jsonBytes(this.evidenceBytes(c.analysisRef));
   const required=['decision_id','evidence_refs','finding','alternative_explanations','scientific_status','next_question','next_plan_delta','fixed_items','allowed_branches','limits_needed','stop_conditions','authorization_needed','analysisId','inputPackageRef','inputManifestSHA','planRef','priorDecisionRef','requiredEvidenceStatus','allowedPlanClause','allowedBranchRef','orderedActions','taskFileRefs','remainingScope','remainingBudget','nextEvidenceBoundary','disposition'];
   if(!a||typeof a!=='object'||required.some(k=>!Object.hasOwn(a,k))||!string(a.analysisId)||!string(a.decision_id)||a.planRef!==c.planRef||!equal(a.inputPackageRef,c.inputPackageRef)||a.inputManifestSHA!==c.inputManifestSHA||!['支持继续有限探索','未决','拒绝本候选','可建议进入采用程序'].includes(a.scientific_status)||!['CONTINUE_APPROVED_PLAN','BLOCKED','INCOMPLETE','PROPOSE_CHANGE_ONLY','STOP_AND_DISCUSS_NEW_PLAN'].includes(a.disposition)||c.status!=='incomplete'&&a.disposition==='CONTINUE_APPROVED_PLAN')fail('plan_closeout_unverified','analysisRef','original section 3 analysis fields and actual frozen input binding required');
   this.evidenceList(a.evidence_refs);array(a.orderedActions,'orderedActions');strings(a.taskFileRefs,'taskFileRefs').forEach((r:string)=>fixedReference(r,'taskFileRef'));
  }
  if(c.status!=='incomplete'&&(c.inputPackageRef===null||c.analysisRef===null))fail('plan_closeout_unverified','closed','final saved input and analysis required');
  const actions=new Set();for(const a of array(c.actions,'actions')){
   strictObject(a,'closeoutAction',['clauseRef','branchRef','plannedTaskIds','taskFileRefs','runRefs','status','evidence_refs','ruleRef','unresolved']);fixedReference(a.clauseRef,'clauseRef');if(a.branchRef!==null)fixedReference(a.branchRef,'branchRef');const key=canonical([a.clauseRef,a.branchRef]);if(actions.has(key))fail('plan_closeout_unverified','actions','original action repeated');actions.add(key);
   strings(a.plannedTaskIds,'plannedTaskIds').forEach((id:string)=>validateIdentifier(id,'taskId'));strings(a.taskFileRefs,'taskFileRefs').forEach((ref:string)=>fixedReference(ref,'taskFileRef'));strings(a.unresolved,'unresolved');this.evidenceList(a.runRefs);this.evidenceList(a.evidence_refs);if(a.ruleRef!==null)this.resolveRef(a.ruleRef);
   if(!['completed','not_executed','skipped_with_rule','blocked'].includes(a.status)||a.status==='completed'&&!a.evidence_refs.length||a.status==='skipped_with_rule'&&a.ruleRef===null)fail('plan_closeout_unverified','actions','actual completion/skip evidence required');
  }
  if(c.status==='completed'&&(c.unresolved.length||c.actions.some((a:any)=>!['completed','skipped_with_rule'].includes(a.status)||a.unresolved.length)))fail('plan_closeout_unverified','completed','unresolved or unexecuted actions cannot be all-completed');
  return {entity:c,observation:{planRef:c.planRef,planVersion:c.planVersion,revision:pointer.revision,closeoutSHA256:pointer.closeout.file.sha256,status:c.status}};
 }
 readApprovedAction(task:any){
  const original=this.resolveRef(task.planRef);if(original.planVersion!==task.planVersion)fail('original_action_conflict','planVersion','original approved plan version differs');
  const actions=array(original.actions??this.resolveRef(original.actionsRef).actions,'approvedActions');
  const seen=new Set();for(const a of actions){strictObject(a,'approvedAction',['clauseRef','branchRef','plannedTaskIds','dependencyRefs','expectedArtifactKinds','acceptanceRuleRef','skipRuleRef','stopRuleRef']);fixedReference(a.clauseRef,'clauseRef');if(a.branchRef!==null)fixedReference(a.branchRef,'branchRef');const key=canonical([a.clauseRef,a.branchRef]);if(seen.has(key))fail('original_action_conflict','actions','duplicate original action');seen.add(key);strings(a.plannedTaskIds,'plannedTaskIds').forEach((id:string)=>validateIdentifier(id,'taskId'));strings(a.dependencyRefs,'dependencyRefs').forEach((r:string)=>fixedReference(r,'dependencyRef'));strings(a.expectedArtifactKinds,'expectedArtifactKinds');for(const k of ['acceptanceRuleRef','skipRuleRef','stopRuleRef'])if(a[k]!==null)this.resolveRef(a[k]);}
  const matches=actions.filter((a:any)=>a.clauseRef===task.planScope.clauseRef&&a.branchRef===task.planScope.branchRef);if(matches.length!==1)fail('original_action_conflict','planScope','one original clause/branch required');return {action:matches[0],actions};
 }
 private priorPlanObservation(scope:any,current:any,state:any){
  if(current.entity.planRef!==scope.planRef||current.entity.planVersion!==scope.planVersion)fail('plan_unverified','plan','current original plan identity differs');
  const prior=state.hostPlanObservations?.[canonical([scope.planRef,scope.planVersion])]??null;
  if(prior){strictObject(prior,'priorHostObservation',['revision','closeoutSHA256','status']);if(!integer(prior.revision,1)||!hash(prior.closeoutSHA256)||!['incomplete','completed','terminated'].includes(prior.status))fail('plan_unverified','priorHostObservation','original recorded observation invalid');if(current.observation.revision<prior.revision||current.observation.revision===prior.revision&&current.observation.closeoutSHA256!==prior.closeoutSHA256)fail('plan_state_conflict','planScope','current closeout revision cannot roll back or change in place');}
  return prior;
 }
 readNonrunnerAction(input:any,purpose:'offline-selection'|'student-finalization'){
  if(purpose==='offline-selection'){
   strictObject(input,'selectionSpec',['schema','planRef','clauseRef','branchRef','sourceIndexRef','queueRef','sourceRunRefs','targetDefinitionRef','selectionRuleRef','quotaBasisRef','purpose','actingReleaseRef','outputId']);
   if(input.schema!=='ohuo-offline-selection-spec-v1'||!['b_training_source','distribution_diagnostic'].includes(input.purpose))fail('unsupported_schema','selectionSpec','original fixed selection spec required');validateIdentifier(input.outputId,'outputId');
   for(const key of ['sourceIndexRef','queueRef','targetDefinitionRef','selectionRuleRef','actingReleaseRef'])fixedReference(input[key],key);for(const f of array(input.sourceRunRefs,'sourceRunRefs'))this.evidenceBytes(f);
  }else if(purpose==='student-finalization'){
   strictObject(input,'studentFinalizationRequest',['schema','planRef','planVersion','clauseRef','branchRef','trainingTaskRef','trainingRunId','summaryRef','reviewRef','parentPolicyRef','policyId','outputPath']);
   if(input.schema!=='ohuo-student-finalization-request-v1'||!integer(input.planVersion,1))fail('unsupported_schema','studentFinalizationRequest','original fixed finalization request required');fixedReference(input.trainingTaskRef,'trainingTaskRef');validateIdentifier(input.trainingRunId,'trainingRunId');validateIdentifier(input.policyId,'policyId');
  }else fail('unsupported_value','nonrunnerPurpose','only the two original fixed artifact purposes');
  fixedReference(input.planRef,'planRef');fixedReference(input.clauseRef,'clauseRef');if(input.branchRef!==null)fixedReference(input.branchRef,'branchRef');
  const grant=this.readGrant(),plan=this.resolveRef(input.planRef),planVersion=purpose==='offline-selection'?plan.planVersion:input.planVersion;
  if(!integer(planVersion,1)||plan.planVersion!==planVersion||grant.planRef!==input.planRef||grant.planVersion!==planVersion)fail('authorization_unverified','planRef','original approved plan/version must bind this artifact operation');if(grant.scope.localExecution!==true)fail('scope_not_authorized','localExecution','original local artifact operation scope required');
  // The original approval bytes and exact approved action are facts, not a new
  // permission certificate. Tool/user authority and the owner's interpretation
  // of that original approval remain external; no natural-language scope is
  // silently promoted to an approved=true field here.
  const scope={planRef:input.planRef,planVersion,planScope:{clauseRef:input.clauseRef,branchRef:input.branchRef}},action=this.readApprovedAction(scope).action,closeout=this.readCloseout(),priorObservation=this.priorPlanObservation(scope,closeout,this.checkExistingRoot());
  const observed=closeout.entity.actions.filter((a:any)=>a.clauseRef===action.clauseRef&&a.branchRef===action.branchRef&&equal(a.plannedTaskIds,action.plannedTaskIds));if(observed.length!==1)fail('original_action_conflict','closeoutAction','one unchanged original nonrunner action required');
  const rule=this.resolveRef(action.acceptanceRuleRef);strictObject(rule,'nonrunnerStageRule',['schema','stage','phase','purpose','originalRuleRef','requiredKinds']);this.resolveRef(rule.originalRuleRef);
  const stage=purpose==='student-finalization'?5:input.purpose==='b_training_source'?4:6,phase=purpose==='student-finalization'?'formal':null,artifacts=purpose==='student-finalization'?['ohuo-student-finalization-receipt-v1']:['ohuo-offline-selection-production-v1','ohuo-offline-label-selection-v2'];
  if(rule.schema!=='ohuo-stage-action-rule-v1'||rule.stage!==stage||rule.phase!==phase||!string(rule.purpose)||artifacts.some(k=>!action.expectedArtifactKinds.includes(k)))fail('stage_mapping_unverified','nonrunnerAction','original exact stage/phase/output purpose required, not a generic future action');
  const required=stage===4?['teacher-transferability','student-visibility-and-initial-c','frozen-source-layout','budget-scope']:stage===6?['student-selection','frozen-comparison-conditions','new-source-isolation','budget-scope']:['complete-formal-training','frozen-behavior-review','allowed-checkpoints','budget-scope'],declared=strings(rule.requiredKinds,'requiredKinds');
  if(required.some(k=>!declared.includes(k))||purpose==='offline-selection'&&declared.includes('selection-production')||purpose==='student-finalization'&&declared.includes('student-selection'))fail('prerequisites_missing','requiredKinds','original minimum and no future-self prerequisite required');
  const prerequisites:any[]=[],kinds=new Set<string>();for(const requirementRef of action.dependencyRefs){
   const requirement=this.resolveRef(requirementRef);strictObject(requirement,'nonrunnerRequirement',['schema','stage','phase','kind','sourceRuleRef']);this.resolveRef(requirement.sourceRuleRef);
   if(requirement.schema!=='ohuo-stage-prerequisite-v1'||requirement.stage!==stage||requirement.phase!==null&&requirement.phase!==phase||!string(requirement.kind)||kinds.has(requirement.kind)||purpose==='offline-selection'&&requirement.kind==='selection-production'||purpose==='student-finalization'&&requirement.kind==='student-selection')fail('prerequisites_missing','requirement','original unique matching stage/kind and no self cycle required');kinds.add(requirement.kind);
   let candidates=[...new Set(grant.tasks.flatMap((t:any)=>t.prerequisiteReceipts.filter((p:any)=>p.requirementRef===requirementRef).map((p:any)=>p.receiptRef)))] as string[];
   if(!candidates.length)candidates=[...this.references.keys()].filter(ref=>{const r=this.resolveRef(ref);return ['ohuo-prerequisite-receipt-v1','ohuo-prerequisite-receipt-v2'].includes(r?.schema)&&r.planRef===input.planRef&&r.planVersion===planVersion&&r.requirementRef===requirementRef;});
   if(candidates.length!==1)fail(candidates.length?'prerequisites_ambiguous':'prerequisites_missing','receipt','one original receipt; never choose latest or filter out an old unknown');
   const receiptRef=candidates[0],receipt=this.prerequisiteReceipt(receiptRef,scope,requirementRef),specific:any={'teacher-transferability':'scientific-decision','screening-conclusion':'scientific-decision','dataset-qualification':'dataset-qualification','student-selection':'student-selection','numerical-restart':'numerical-restart','calibration-qualification':'calibration-qualification'};
   if(specific[requirement.kind]&&receipt.kind!==specific[requirement.kind])fail('prerequisites_missing','receipt.kind','original specialized evidence category required');prerequisites.push({requirementRef,receiptRef,requirement,receipt});
  }
  if([...required,...declared].some(k=>!kinds.has(k)))fail('prerequisites_missing','dependencyRefs','all original required kinds need actual unambiguous receipts');
  const byKind=(kind:string)=>prerequisites.find(p=>p.requirement.kind===kind).receipt,hasFile=(kind:string,f:any)=>byKind(kind).evidence_refs.some((x:any)=>equal(x,f)),hasJSON=(kind:string,ref:string)=>byKind(kind).evidence_refs.some((f:any)=>{const bytes=this.evidenceBytes(f);try{return digest(this.jsonBytes(bytes))===ref.split(':').at(-1);}catch{return false;}});
  if(purpose==='student-finalization'){
   const task=validateTask(this.resolveRef(input.trainingTaskRef)),summary=this.jsonBytes(this.evidenceBytes(input.summaryRef)),review=this.jsonBytes(this.evidenceBytes(input.reviewRef));
   if(task.planRef!==input.planRef||task.planVersion!==planVersion||task.runId!==input.trainingRunId||summary.schema!=='ohuo-supervised-summary-v1'||summary.taskSHA256!==digest(task)||summary.runId!==task.runId||review.schema!=='ohuo-distill-behavior-review-v1'||review.taskSHA256!==digest(task)||!Array.isArray(summary.selection?.allowedCheckpoints)||!hasFile('complete-formal-training',input.summaryRef)||!hasFile('allowed-checkpoints',input.summaryRef)||!hasFile('frozen-behavior-review',input.reviewRef)||!hasJSON('budget-scope',task.budgetRef))fail('prerequisite_input_mismatch','studentFinalization','original summary/review/allowed checkpoints and budget evidence must bind this Task/run, not another met receipt');
  }else{
   const quota=this.jsonBytes(this.evidenceBytes(input.quotaBasisRef));strictObject(quota,'quotaBasis',['schema','planRef','budgetRef','controlStateRef','stage2Stage3AccountingRefs','originalQuotas','frozenQuotas','reasonRef','freezeEvidenceRef']);fixedReference(quota.budgetRef,'budgetRef');const budget=this.resolveRef(quota.budgetRef),index=this.resolveRef(input.sourceIndexRef),layoutKind=stage===4?'frozen-source-layout':'new-source-isolation';
   if(quota.schema!=='ohuo-selection-quota-basis-v1'||quota.planRef!==input.planRef||budget.planRef!==input.planRef||budget.controlRoot!==this.root||budget.authorizationRef!==grant.authorizationRef||!hasJSON('budget-scope',quota.budgetRef)||!hasJSON(layoutKind,input.queueRef)||!byKind(layoutKind).evidence_refs.some((f:any)=>f.sha256===index.fileSHA256))fail('prerequisite_input_mismatch','offlineSelection','original queue/index and quota budget evidence must bind this exact full population');
   if(stage===4&&!hasJSON('student-visibility-and-initial-c',input.actingReleaseRef)||stage===6&&!hasJSON('frozen-comparison-conditions',input.actingReleaseRef))fail('prerequisite_input_mismatch','actingReleaseRef','original acting release evidence required');
   if(stage===6){const acting=this.resolveRef(input.actingReleaseRef),files=[...this.bindings.values()].flatMap((b:any)=>b.studentReleaseFiles).filter((f:any)=>f.ref===input.actingReleaseRef),unique=[...new Map(files.map((f:any)=>[canonical(f.file),f])).values()] as any[];if(acting.schema!=='ohuo-student-task-release-v1'||unique.length!==1)fail('prerequisites_missing','student-selection','one original already-selected student release required');const release=this.readJSON(unique[0].file),selection=this.jsonBytes(this.evidenceBytes(release.selection));if(acting.releaseSHA256!==unique[0].file.sha256||acting.policyId!==release.policyId||selection.schema!=='ohuo-student-selection-v1'||selection.status!=='selected'||selection.selected?.manifestSHA256!==release.checkpoint?.sha256||!hasFile('student-selection',release.selection))fail('prerequisite_input_mismatch','student-selection','original actual S selection must bind the acting release; not this future selection output');this.studentSelectionCompletion(input.planRef,planVersion,byKind('student-selection'),unique[0].file,release,selection);}
  }
  return {grant,plan,action,rule,closeout,priorObservation,prerequisites};
 }
 private studentSelectionCompletion(planRef:string,planVersion:number,prerequisite:any,releaseFile:any,release:any,selection:any){
  const completions=array(prerequisite.evidence_refs,'student-selection.evidence_refs').flatMap((f:any)=>{const b=this.evidenceBytes(f);let v:any;try{v=JSON.parse(b.toString('utf8'));}catch{return [];}return v?.schema==='ohuo-student-finalization-receipt-v1'?[v]:[];});
  if(completions.length!==1)fail('student_completion_unverified','student-selection','one explicitly cited original finalization completion receipt required');const completion=completions[0];
  strictObject(completion,'studentCompletion',['schema','requestRef','trainingTaskRef','trainingRunId','summaryRef','reviewRef','status','selectionRef','releaseRef','issues']);
  if(completion.status!=='selected'||!Array.isArray(completion.issues)||completion.issues.length||!equal(completion.selectionRef,release.selection)||!equal(completion.summaryRef,selection.summary)||!equal(completion.reviewRef,selection.behaviorReview)||completion.releaseRef?.sha256!==releaseFile.sha256)fail('student_completion_unverified','receipt','selected original receipt must bind exact selection/summary/review/release');
  const request=this.resolveRef(completion.requestRef);strictObject(request,'studentFinalizationRequest',['schema','planRef','planVersion','clauseRef','branchRef','trainingTaskRef','trainingRunId','summaryRef','reviewRef','parentPolicyRef','policyId','outputPath']);
  const training=validateTask(this.resolveRef(completion.trainingTaskRef)),state=this.checkExistingRoot(),run=state.runs[completion.trainingRunId],ledger=state.budgets[training.budgetRef],binding=this.bindings.get(completion.trainingTaskRef),summary=this.jsonBytes(this.evidenceBytes(completion.summaryRef)),review=this.jsonBytes(this.evidenceBytes(completion.reviewRef)),parent=this.resolveRef(training.parentPolicyRef);
  if(request.schema!=='ohuo-student-finalization-request-v1'||request.planRef!==planRef||request.planVersion!==planVersion||training.planRef!==planRef||training.planVersion!==planVersion||request.trainingTaskRef!==completion.trainingTaskRef||request.trainingRunId!==completion.trainingRunId||training.runId!==completion.trainingRunId||training.taskKind!=='supervised_training'||binding?.trainingPhase!=='formal'||!equal(request.summaryRef,completion.summaryRef)||!equal(request.reviewRef,completion.reviewRef)||request.policyId!==release.policyId||parent.schema!=='ohuo-parent-policy-ref-v1'||request.parentPolicyRef!==parent.policyRef||release.proposer?.policyRef!==parent.policyRef||request.outputPath!==relative(this.repositoryRoot,join(training.outputRoot,'student-release.json'))||releaseFile.path!==request.outputPath||completion.releaseRef?.id!==request.outputPath||completion.selectionRef?.id!==request.policyId+'-dev-selection')fail('student_completion_unverified','request','exact original finalization request/Task/run/parent/output identity required');
  if(!run||run.taskRef!==completion.trainingTaskRef||run.taskSHA256!==digest(training)||!equal(run.task,training)||state.tasks[training.taskId]!==run.runId||run.status!=='completed'||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.checkpoint?.executionUnknown===true||run.checkpoint?.active!=null||ledger?.activeRunId===run.runId||Object.values(ledger?.reservations??{}).some((r:any)=>r.runId===run.runId&&['reserved','reserved_unknown'].includes(r.status))||summary.runId!==run.runId||summary.taskSHA256!==run.taskSHA256||summary.plan?.phase!=='formal'||summary.actual?.realTraining!==true||summary.actual.optimizerSteps!==3*summary.plan.Uepoch||review.taskSHA256!==run.taskSHA256||selection.status!=='selected'||selection.selected?.manifestSHA256!==release.checkpoint?.sha256||release.checkpoint?.path!==relative(this.repositoryRoot,join(training.outputRoot,selection.selected.path,'manifest.json')))fail('student_completion_unverified','trainingRun','original complete known formal run and selected checkpoint must match receipt, not another same-plan run');
  if(!equal(this.jsonBytes(this.evidenceBytes(completion.releaseRef)),release)||!equal(this.jsonBytes(this.evidenceBytes(completion.selectionRef)),selection))fail('student_completion_unverified','artifact','original completion F bytes must equal actual acting S artifacts');
  this.readNonrunnerAction(request,'student-finalization');return completion;
 }
 async readStudentFinalizationTraining(task:any){
  this.currentProducerSource();await this.checkAuthorization(task);const grant=this.readGrant(),grantEntry=this.taskEntry(task,grant),action=this.readApprovedAction(task).action,inputBinding=this.bindings.get(grantEntry.taskRef);
  if(task.taskKind!=='supervised_training'||inputBinding?.trainingPhase!=='formal')fail('input_identity_unverified','trainingTask','original formal training input required');this.prerequisites(task,grant,action);return {grantEntry,action,inputBinding};
 }
 private selectionCommit(spec:any,directory:string){
  const id='offline-selection/'+spec.outputId+'/manifest.json',path=join(directory,'manifest.json'),catalog=this.evidence.get(id);
  if(!existsSync(path)&&!catalog)return null;const bytes=existsSync(path)?this.regular(path):this.readFile(catalog),commit=this.jsonBytes(bytes);if(catalog&&catalog.sha256!==sha(bytes))fail('artifact_conflict','selectionCommit','fixed manifest bytes differ');
  strictObject(commit,'selectionCommit',['schema','specRef','selectionRef','productionRef','files']);if(commit.schema!=='ohuo-offline-selection-commit-v1'||commit.specRef!==`offline-selection-spec/${spec.outputId}@sha256:${digest(spec)}`)fail('artifact_conflict','selectionCommit','only the same original spec commit is reusable');
  const names=['spec.json','source-inventory.jsonl','population.jsonl','selected-metadata.jsonl','exclusions.jsonl','production.json','selection.json'],contents=new Map<string,Buffer>();if(array(commit.files,'selectionCommit.files').length!==names.length)fail('artifact_conflict','selectionCommit','original complete seven-file commit required');
  for(const [i,name] of names.entries()){const row=commit.files[i];strictObject(row,'selectionCommitFile',['id','file']);this.fileShape(row.file);if(row.id!==`offline-selection/${spec.outputId}/${name}`||row.file.path!==relative(this.repositoryRoot,join(directory,name)))fail('artifact_conflict','selectionCommit','original fixed output identities required');const destination=this.relativePath(row.file.path),source=this.evidence.get(row.id),b=existsSync(destination)?this.regular(destination):source?.sha256===row.file.sha256?this.readFile(source):fail('evidence_unavailable','selectionCommit','missing original bytes cannot be re-enumerated after closeout');if(sha(b)!==row.file.sha256)fail('artifact_conflict','selectionCommit','original committed bytes differ');contents.set(name,b);}
  const saved=this.jsonBytes(contents.get('spec.json')!),selection=this.jsonBytes(contents.get('selection.json')!),production=this.jsonBytes(contents.get('production.json')!);
  if(!equal(saved,spec)||commit.selectionRef!==`offline-label-selection/${spec.outputId}@sha256:${digest(selection)}`||commit.productionRef!==`offline-selection-production/${spec.outputId}@sha256:${digest(production)}`||selection.productionRef!==commit.productionRef||production.specRef!==commit.specRef)fail('artifact_conflict','selectionCommit','exact spec/selection/production identities required');return commit;
 }
 async offlineSelectionHostInputs(spec:any,options:any){
  this.currentProducerSource();strictObject(options,'offlineSelectionOptions',['phase',...(Object.hasOwn(options,'task')?['task']:[]),...(Object.hasOwn(options,'outputDir')?['outputDir']:[])]);if(!['freeze','label-start','label-resume','dataset'].includes(options.phase))fail('unsupported_value','phase','fixed offline selection phase required');
  const facts=this.readNonrunnerAction(spec,'offline-selection'),outputDir=join(this.repositoryRoot,'lab/out',spec.outputId),state=this.checkExistingRoot();
  if(options.outputDir!==undefined&&resolve(options.outputDir)!==outputDir)fail('invalid_output_root','offlineSelection','only original repository lab/out/outputId allowed');
  for(const path of [join(this.repositoryRoot,'lab/out'),outputDir])if(existsSync(path)&&(!lstatSync(path).isDirectory()||realpathSync(path)!==path))fail('invalid_output_root','offlineSelection','real original artifact root required');
  const observed=facts.closeout.entity.actions.find((a:any)=>a.clauseRef===facts.action.clauseRef&&a.branchRef===facts.action.branchRef),closed=facts.closeout.entity.status!=='incomplete'||['completed','terminated'].includes(facts.priorObservation?.status),commit=options.phase==='freeze'?this.selectionCommit(spec,outputDir):null;
  if(options.phase==='freeze'&&!commit&&(closed||observed.status!=='not_executed'||observed.unresolved.length))fail(closed?'plan_closed':'original_action_conflict','offlineSelection','new freeze requires original available nonrunner action; only actual fixed commit permits recovery');
  this.assertDiagnosticWriteIntersection(state,outputDir);
  const references=new Map<string,any>();for(const [ref] of this.references)references.set(ref,freezeJSON(this.resolveRef(ref)));const evidenceFiles=new Map(this.evidence),tasks=[...references].filter(([,t])=>t?.schemaVersion===1&&t.planRef===spec.planRef&&['collect','evaluate'].includes(t.taskKind)&&t.seatLayoutPlan===spec.queueRef&&t.sourcePlan?.sourceIndexRef===spec.sourceIndexRef&&references.get(t.capabilityRef)?.id==='B07.complete-match.v1').map(([taskRef,value])=>({taskRef,task:validateTask(value)}));
  // A whole source action with missing Task definitions must not disappear just
  // because no run exists. This is the producer's existing actual artifact
  // schema, not a fabricated task type or future label Task requirement.
  const allActions=facts.plan.actions??references.get(facts.plan.actionsRef)?.actions;
  for(const action of allActions)if(action.expectedArtifactKinds.includes('ohuo-match-summary-v1')||tasks.some(x=>x.task.planScope.clauseRef===action.clauseRef&&x.task.planScope.branchRef===action.branchRef))for(const id of action.plannedTaskIds){const matches=[...references].filter(([,t])=>t?.schemaVersion===1&&t.planRef===spec.planRef&&t.taskId===id);if(matches.length!==1)fail('planned_source_task_unavailable','plannedTaskIds','all original source Task definitions must be fixed uniquely, including not executed');}
  const index=this.resolveRef(spec.sourceIndexRef),indexBindings=[...this.bindings.values()].filter((b:any)=>{const t=references.get(b.taskRef);return t?.planRef===spec.planRef&&t.sourcePlan?.sourceIndexRef===spec.sourceIndexRef&&b.sourceIndexFile.sha256===index.fileSHA256;});
  const indices=[...new Map(indexBindings.map((b:any)=>[canonical(b.sourceIndexFile),b.sourceIndexFile])).values()] as any[];if(indices.length!==1)fail('input_identity_unverified','sourceIndexFile','one actual original index path/bytes binding required');const sourceIndexPath=this.relativePath(indices[0].path);this.readFile(indices[0]);
  const confirmedRecordRoots:string[]=[];for(const f of spec.sourceRunRefs){const run=this.jsonBytes(this.evidenceBytes(f)),original=state.runs?.[run.runId],row:any=tasks.find(t=>t.taskRef===run.taskRef);
   if(!row||!original||run.taskSHA256!==digest(row.task)||!equal(run.task,row.task)||state.tasks[row.task.taskId]!==run.runId||['taskRef','taskSHA256','checkpoint','checkpointSHA256','checkpointRef','status','cleanupConfirmed'].some(k=>!equal(run[k],original[k])))fail('state_history_conflict','sourceRunRefs','fixed original source Task/run state required');
   if(row.task.outputRoot!==join(this.root,'runs',row.task.runId))fail('invalid_output_root','sourceRun','original controlled run output required');
   const ledger=state.budgets[row.task.budgetRef],settled=['completed','failed','interrupted'].includes(run.status)&&run.cleanupConfirmed===true&&run.executionUnknown!==true&&run.observationStatus!=='unknown'&&original.executionUnknown!==true&&original.observationStatus!=='unknown'&&original.checkpoint?.executionUnknown!==true&&original.checkpoint?.active==null&&ledger?.activeRunId!==run.runId&&!Object.values(ledger?.reservations??{}).some((r:any)=>r.runId===run.runId&&['reserved','reserved_unknown'].includes(r.status))&&run.stopReason!=='execution_uncertain'&&run.failureReason!=='execution_uncertain'&&original.stopReason!=='execution_uncertain'&&original.failureReason!=='execution_uncertain';
   if(!settled||commit)continue;await this.checkAuthorization(row.task);const action=this.readApprovedAction(row.task).action;this.prerequisites(row.task,facts.grant,action);this.assertActionTaskLineage(row.task,action,state);
   if(!row.task.releaseRefs.includes(spec.actingReleaseRef)||row.task.seatLayoutPlan!==spec.queueRef||row.task.sourcePlan.sourceIndexRef!==spec.sourceIndexRef)fail('input_identity_unverified','sourceTask','same original full queue/index/acting release required');
   // A missing original fixed root remains in inventory; never recreate it or
   // replace its source. Existing unsafe parents/root (even dangling links)
   // are rejection, not 'missing'. Authorization above is still mandatory.
   for(const path of [join(this.root,'runs'),row.task.outputRoot]){const st=lstatSync(path,{throwIfNoEntry:false});if(st&&(!st.isDirectory()||st.isSymbolicLink()||realpathSync(path)!==path))fail('invalid_host_path','sourceRun','existing source root/parents must be real directories');}
   if(existsSync(row.task.outputRoot))confirmedRecordRoots.push(this.directory(relative(this.repositoryRoot,row.task.outputRoot)));
  }
  if(options.task){const task=options.task;if(task.planRef!==spec.planRef||task.sourcePlan.sourceIndexRef!==spec.sourceIndexRef||task.seatLayoutPlan!==spec.queueRef)fail('selection_task_binding','task','same original full population required');}
  const labelTerminalRefs=options.phase==='dataset'?await this.datasetLabelTerminals(spec,references,state,facts.grant):null;
  return {repositoryRoot:this.repositoryRoot,references,evidenceFiles,sourceIndexPath,confirmedRecordRoots:[...new Set(confirmedRecordRoots)],controlRoot:this.root,mode:'research' as const,phase:options.phase,...(options.task?{task:options.task}:{}),...(options.phase==='freeze'?{outputDir}:{}),...(labelTerminalRefs?{labelTerminalRefs}:{})};
 }
 private async datasetLabelTerminals(spec:any,references:Map<string,any>,state:any,grant:any){
  // Assemble every original committed terminal (including failed/unknown), not
  // a caller's chosen successes. D still independently verifies full selection
  // and terminal semantics; this only resolves original ledger P to catalog F.
  if(spec.purpose!=='b_training_source')fail('selection_dataset_purpose','purpose','B09 consumes original B training selection only');
  const candidates=[...references].filter(([,s])=>s?.schema==='ohuo-offline-label-selection-v2'&&references.get(s.productionRef)?.schema==='ohuo-offline-selection-production-v1'&&equal(references.get(references.get(s.productionRef)?.specRef),spec));
  if(candidates.length!==1)fail('selection_dataset_identity_unverified','selectionRef','one complete fixed selection for this original spec required');const [selectionRef]=candidates[0],quota=this.jsonBytes(this.evidenceBytes(spec.quotaBasisRef)),out:any[]=[];
  for(const run of Object.values(state.runs) as any[]){const task=run.task;if(task?.planRef!==spec.planRef||!equal(task.datasetRefs,[selectionRef]))continue;validateTask(task);
   const capability=references.get(task.capabilityRef);if(run.taskSHA256!==digest(task)||references.get(run.taskRef)===undefined||!equal(references.get(run.taskRef),task)||run.runId!==task.runId||state.tasks[task.taskId]!==run.runId||task.outputRoot!==join(this.root,'runs',task.runId)||capability?.id!=='B07.offline-label.v1'||task.budgetRef!==quota.budgetRef||task.sourcePlan.sourceIndexRef!==spec.sourceIndexRef||task.seatLayoutPlan!==spec.queueRef||task.parentPolicyRef!==spec.actingReleaseRef||!task.releaseRefs.includes(spec.actingReleaseRef))fail('label_checkpoint_identity_unverified','run','original exact label Task/run/full selection required');
   await this.checkAuthorization(task);const action=this.readApprovedAction(task).action;this.prerequisites(task,grant,action);this.assertActionTaskLineage(task,action,state);
   const cp=run.checkpoint;if(cp===null||cp===undefined){if(run.checkpointSHA256!=null||run.checkpointRef!=null)fail('label_checkpoint_identity_unverified','checkpoint','no partial checkpoint identity');continue;}
   if(cp.schema!=='ohuo-offline-label-run-v1'||cp.taskSHA256!==run.taskSHA256||cp.selectionRef!==selectionRef||!integer(cp.cursor)||!Array.isArray(cp.rows)||cp.rows.length!==cp.cursor||digest(cp)!==run.checkpointSHA256||run.checkpointRef!==join(task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)||!equal(this.jsonBytes(this.regular(run.checkpointRef)),cp))fail('label_checkpoint_identity_unverified','checkpoint','original immutable committed checkpoint bytes required');
   for(const [index,row] of cp.rows.entries()){const p=row.resultRef;if(!p||Object.keys(p).sort().join(',')!=='path,sha256'||p.path!==join(task.outputRoot,'labels',`q${index}.json`)||!hash(p.sha256))fail('label_checkpoint_identity_unverified','resultRef','original fixed label terminal path/bytes required');
    const mappings=[...this.evidence].filter(([,f])=>this.relativePath(f.path)===p.path&&f.sha256===p.sha256);if(mappings.length!==1)fail(mappings.length?'label_terminal_catalog_ambiguous':'label_terminal_catalog_unavailable','resultRef','every committed terminal requires one original fixed F mapping');
    const [id,file]=mappings[0],terminal=this.readJSON(file);if(terminal.schema!=='ohuo-offline-label-result-v1'||terminal.purpose!=='b_training_source'||terminal.selectionRef!==selectionRef||terminal.index!==index||!equal(terminal.key,row.key)||terminal.inputSHA256!==row.inputSHA256||terminal.status!==row.status||terminal.labelKind!==row.labelKind)fail('label_checkpoint_identity_unverified','terminal','terminal must equal its original committed row');out.push({id,sha256:file.sha256});
   }
  }
  return out;

 }
 private prerequisiteReceipt(ref:string,task:any,requirementRef:string,requireMet=true){
  const r=this.resolveRef(ref),v2=r.schema==='ohuo-prerequisite-receipt-v2';
  strictObject(r,'prerequisiteReceipt',['schema','planRef','planVersion','requirementRef','kind','decision','evidence_refs','analysisRef','numerical',...(v2?['calibration','recoveryRef']:[])]);
  if(!['ohuo-prerequisite-receipt-v1','ohuo-prerequisite-receipt-v2'].includes(r.schema)||r.planRef!==task.planRef||r.planVersion!==task.planVersion||r.requirementRef!==requirementRef||!['met','not_met','unknown'].includes(r.decision)||requireMet&&r.decision!=='met'||!array(r.evidence_refs,'evidence_refs').length)fail('prerequisites_missing','receipt','fixed prerequisite not established');
  if(!(v2?['calibration-qualification','numerical-restart']:['engineering-acceptance','scientific-decision','dataset-qualification','student-selection','numerical-restart']).includes(r.kind))fail('prerequisites_missing','receipt.kind','unsupported version/kind');
  this.resolveRef(requirementRef);this.evidenceList(r.evidence_refs);
  if(r.kind==='scientific-decision'&&r.analysisRef===null||v2&&r.analysisRef!==null)fail('prerequisites_missing','analysisRef','scientific and mechanical receipt shapes differ');if(r.analysisRef!==null)this.evidenceBytes(r.analysisRef);
  if(r.kind==='numerical-restart'){strictObject(r.numerical,'numerical',['failedTaskId','failedRunId','datasetRef','parentPolicyRef','seed','trigger','inputImplementationReviewRef','metricsRef']);if(v2){if(r.calibration!==null)fail('prerequisites_missing','calibration','mutually exclusive numerical receipt');fixedReference(r.recoveryRef,'recoveryRef');this.resolveRef(r.recoveryRef);}}
  else if(r.numerical!==null)fail('prerequisites_missing','numerical','not applicable');
  if(v2&&r.kind==='calibration-qualification'){if(r.recoveryRef!==null)fail('prerequisites_missing','recoveryRef','not applicable');strictObject(r.calibration,'calibration',['taskRef','runId','summaryRef','controlStateRef','checkpointFactsRefs','diagnosticRef']);fixedReference(r.calibration.taskRef,'calibration.taskRef');validateIdentifier(r.calibration.runId,'runId');for(const f of [r.calibration.summaryRef,r.calibration.controlStateRef,r.calibration.diagnosticRef,...array(r.calibration.checkpointFactsRefs,'checkpointFactsRefs')])this.evidenceBytes(f);}
  return r;
 }
 private prerequisites(task:any,g:any,action:any){
  const entry=this.taskEntry(task,g),actual=entry.prerequisiteReceipts.map((p:any)=>p.requirementRef);
  if(!sameRefs(action.dependencyRefs,task.planScope.prerequisiteRefs)||!sameRefs(action.dependencyRefs,actual))fail('original_dependency_conflict','prerequisites','original action, Task and grant dependency sets must agree');
  const rule=this.resolveRef(action.acceptanceRuleRef);strictObject(rule,'stageActionRule',['schema','stage','phase','purpose','originalRuleRef','requiredKinds']);
  if(rule.schema!=='ohuo-stage-action-rule-v1'||!string(rule.purpose)||!([0,1,2,3,4,5,6,'closeout'] as any[]).includes(rule.stage)||![null,'calibration','formal'].includes(rule.phase))fail('stage_mapping_unverified','acceptanceRuleRef','fixed original stage/phase/purpose mapping required');this.resolveRef(rule.originalRuleRef);
  const cap=this.resolveRef(task.capabilityRef),b=this.bindings.get(entry.taskRef);let required:string[]=[];
  if(rule.stage===2&&cap.id==='B04.api-probe.v1'&&task.taskKind==='probe'&&rule.phase===null)required=['stage1-acceptance','probe-snapshot-manifest','api-connection-and-scope','budget-scope'];
  else if(rule.stage===3&&cap.id==='B07.complete-match.v1'&&task.taskKind==='evaluate'&&rule.phase===null)required=['screening-conclusion','frozen-comparison-conditions','source-and-layout-isolation','budget-scope'];
  else if(rule.stage===4&&task.taskKind==='collect'&&rule.phase===null&&['B07.complete-match.v1','B07.offline-label.v1'].includes(cap.id))required=['teacher-transferability','student-visibility-and-initial-c','frozen-source-layout','budget-scope',...(cap.id==='B07.offline-label.v1'?['selection-production']:[])];
  else if(rule.stage===5&&task.taskKind==='supervised_training'&&cap.id==='B10.supervised-rerank.v1'&&b&&rule.phase===b.trainingPhase&&['calibration','formal'].includes(rule.phase))required=['teacher-transferability','dataset-qualification','fixed-parent-recipe','budget-scope',...(rule.phase==='formal'?['calibration-qualification']:[])];
  else if(rule.stage===6&&rule.phase===null&&['B07.complete-match.v1','B07.offline-label.v1'].includes(cap.id)&&['evaluate','collect'].includes(task.taskKind))required=['student-selection','frozen-comparison-conditions','new-source-isolation','budget-scope',...(cap.id==='B07.offline-label.v1'?['selection-production']:[]),...(task.sourcePlan.split==='confirm'?['confirmation-isolation']:[])];
  else fail('stage_mapping_unverified','stage','capability/phase has no original fixed stage mapping');
  if(b?.numericalRestartReceiptRef!==null&&b?.numericalRestartReceiptRef!==undefined)required.push('numerical-restart');
  const kinds=strings(rule.requiredKinds,'requiredKinds');if(required.some(k=>!kinds.includes(k)))fail('prerequisites_missing','requiredKinds','original stage minimum cannot be omitted');
  const actualKinds=new Set<string>();for(const p of entry.prerequisiteReceipts){const requirement=this.resolveRef(p.requirementRef);strictObject(requirement,'stagePrerequisite',['schema','stage','phase','kind','sourceRuleRef']);if(requirement.schema!=='ohuo-stage-prerequisite-v1'||requirement.stage!==rule.stage||requirement.phase!==null&&requirement.phase!==rule.phase||!string(requirement.kind)||actualKinds.has(requirement.kind))fail('prerequisites_missing','requirement','exact original stage/kind/phase required');this.resolveRef(requirement.sourceRuleRef);actualKinds.add(requirement.kind);const r=this.prerequisiteReceipt(p.receiptRef,task,p.requirementRef);const specific:any={'teacher-transferability':'scientific-decision','screening-conclusion':'scientific-decision','dataset-qualification':'dataset-qualification','student-selection':'student-selection','numerical-restart':'numerical-restart','calibration-qualification':'calibration-qualification'};if(specific[requirement.kind]&&r.kind!==specific[requirement.kind])fail('prerequisites_missing','receipt.kind','original specialized prerequisite required');}
  if(kinds.some((k:string)=>!actualKinds.has(k)))fail('prerequisites_missing','requiredKinds','original required kind lacks a real receipt');
 }
 assertActionTaskLineage(task:any,action:any,state:any,numerical:any=null){
  if(numerical?.schema==='ohuo-verified-numerical-recovery-v1'){if(numerical.verified!==true||numerical.taskRef!==this.taskEntry(task,this.readGrant()).taskRef)fail('branch_evidence_unverified','lineage','only actual verified exact role permits the designated parent chain');return;}
  let current=task;const seen=new Set();while(!action.plannedTaskIds.includes(current.taskId)){
   if(seen.has(current.taskId)||current.parentTaskId===null)fail('original_action_conflict','parentTaskId','retry must lead to original planned Task without cycle');seen.add(current.taskId);
   const parent=state.runs[state.tasks[current.parentTaskId]];if(!parent||parent.taskSHA256!==digest(parent.task)||parent.taskRef?.split(':').at(-1)!==digest(parent.task)||parent.runId!==parent.task.runId||state.tasks[parent.task.taskId]!==parent.runId||!['failed','interrupted'].includes(parent.status)||parent.cleanupConfirmed!==true||parent.executionUnknown===true||parent.observationStatus==='unknown')fail('original_action_conflict','parentTaskId','known stopped failed/interrupted original parent required');
   for(const k of ['planRef','planVersion','budgetRef','researchBatchId','authorizationRef'])if(parent.task[k]!==task[k])fail('original_action_conflict',k,'retry cannot change original scope');
   if(parent.task.planScope.clauseRef!==action.clauseRef||parent.task.planScope.branchRef!==action.branchRef||current.retryReasonRef!==action.acceptanceRuleRef&&!parent.task.allowedBranches.some((x:any)=>x.evidenceRef===current.retryReasonRef))fail('original_action_conflict','retryReasonRef','same original action and approved retry reason required');
   if(parent.task.learnerRecipe?.learningRate===3e-5)fail('branch_evidence_unverified','parentTaskId','a new ordinary retry cannot restart the consumed numerical branch');
   const ledger=state.budgets[parent.task.budgetRef];if(ledger?.activeRunId===parent.runId||Object.values(ledger?.reservations??{}).some((r:any)=>r.runId===parent.runId&&['reserved','reserved_unknown'].includes(r.status)))fail('execution_uncertain','parentTaskId','parent work is not reconciled');current=parent.task;
  }
 }
 checkPlan=async(task:any)=>{
  await this.checkAuthorization(task);const g=this.readGrant(),c=this.readCloseout();if(c.entity.planRef!==task.planRef||c.entity.planVersion!==task.planVersion)fail('plan_unverified','plan','current plan identity differs');
  if(c.entity.status!=='incomplete')return {status:c.entity.status,eligible:false,missing:[],hostObservation:c.observation};
  const {action}=this.readApprovedAction(task);this.prerequisites(task,g,action);const state=this.checkExistingRoot(),entry=this.taskEntry(task,g),b=this.bindings.get(entry.taskRef);
  const numerical=task.taskKind==='supervised_training'?this.numericalRestart(task,entry,b):null;
  this.assertActionTaskLineage(task,action,state,numerical?.numericalRestart??numerical);
  const matches=c.entity.actions.filter((a:any)=>a.clauseRef===action.clauseRef&&a.branchRef===action.branchRef&&equal(a.plannedTaskIds,action.plannedTaskIds)&&a.taskFileRefs.includes(entry.taskRef));
  if(matches.length!==1||matches[0].status!=='not_executed'||matches[0].unresolved.length)return {status:'incomplete',eligible:false,missing:['original_action_not_available'],hostObservation:c.observation};
  const run=state.runs[state.tasks[task.taskId]];if(run?.status==='completed')fail('closeout_run_state_conflict','run','completed run requires original closeout reconciliation, not a fresh execution');
  if(task.taskKind==='supervised_training'&&b?.trainingPhase==='formal')this.verifyCalibrationPrerequisite(task,entry,b,state,numerical?.numericalRestart??numerical);
  return {status:'incomplete',eligible:true,missing:[],hostObservation:c.observation};
 };
 genesisPath(){return join(this.repositoryRoot,'deliverables/ohuo-runtime/initializations',sha(this.manifest.controlRoot)+'.json');}
 checkExistingRoot(){
  const marker=this.genesisPath(),statePath=join(this.root,'state.json');if(!existsSync(statePath))fail('budget_state_missing','stateRoot','existing consumption is required, never initialize implicitly');
  if(!existsSync(marker))fail('genesis_identity_missing','controlRoot','original root genesis receipt required');const genesis=this.jsonBytes(this.regular(marker,true)),state=this.jsonBytes(this.regular(statePath));
  if(genesis.schema!=='ohuo-control-root-genesis-v1'||genesis.rootInstanceId!==this.manifest.rootInstanceId||genesis.controlRoot!==this.manifest.controlRoot||genesis.initialStateRef!==this.manifest.initialStateRef||state.rootInstanceId!==genesis.rootInstanceId)fail('genesis_identity_mismatch','controlRoot','root identity differs');
  if(existsSync(join(this.root,'runs'))&&readdirSync(join(this.root,'runs')).length&&(!Object.keys(state.tasks??{}).length||!Object.keys(state.runs??{}).length))fail('state_history_conflict','stateRoot','old runs cannot accompany a zero ledger');return state;
 }
 async initialize(initialStateRef:string){
  const g=this.readGrant();if(g.initialization!=='new-control-root'||initialStateRef!==g.initialStateRef)fail('initialization_not_authorized','initialStateRef','explicit original new-root grant required');
  const c=this.readCloseout();if(c.entity.planRef!==g.planRef||c.entity.planVersion!==g.planVersion)fail('plan_unverified','plan','initial plan differs');if(c.entity.status!=='incomplete')fail('plan_closed','plan','closed plan cannot initialize work');
  const release=acquireSourceWriter(this.root);try{
   const marker=this.genesisPath();if(existsSync(marker))fail('init_already_consumed','controlRoot','genesis marker exists; missing state is not new zero scope');if(readdirSync(this.root).length)fail('initialization_not_empty','controlRoot','explicit new empty control root required');
   const state=this.resolveRef(initialStateRef);strictObject(state,'initialState',['schemaVersion','rootInstanceId','initialBudgetRef','tasks','runs','budgets','batches']);
   const budget=this.resolveRef(state.initialBudgetRef),keys=Object.keys(state.budgets??{});if(state.schemaVersion!==1||state.rootInstanceId!==g.rootInstanceId||!equal(state.tasks,{})||!equal(state.runs,{})||keys.length!==1||keys[0]!==state.initialBudgetRef||Object.keys(state.batches??{}).length!==1)fail('initialization_invalid','state','one explicit virgin batch required');
   strictObject(budget,'budget',['researchBatchId','authorizationRef','planRef','controlRoot','limits']);validateLimits(budget.limits);if(budget.planRef!==g.planRef||budget.authorizationRef!==g.authorizationRef||budget.controlRoot!==this.root||Object.keys(g.limits).some(k=>budget.limits[k]>g.limits[k]))fail('initialization_invalid','budget','approved original budget binding differs');
   const zero={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0};const expected={researchBatchId:budget.researchBatchId,authorizationRef:g.authorizationRef,planRef:g.planRef,limits:budget.limits,used:zero,reservations:{},activeRunId:null,elapsedSeconds:0,accountingMode:'research'};
   if(!equal(state.budgets[state.initialBudgetRef],expected)||!equal(state.batches,{[budget.researchBatchId]:{budgetRef:state.initialBudgetRef,authorizationRef:g.authorizationRef,planRef:g.planRef}}))fail('initialization_invalid','state','only explicit approved genesis values accepted');
   const bytes=canonical(state),genesis={schema:'ohuo-control-root-genesis-v1',rootInstanceId:g.rootInstanceId,controlRoot:g.controlRoot,grantFileSHA256:this.manifest.grantFile.sha256,initialStateRef,initialStateBytesSHA256:sha(bytes),purpose:'genesis-not-resume-checkpoint'};
   mkdirSync(dirname(marker),{recursive:true,mode:0o700});if(realpathSync(dirname(marker))!==dirname(marker))fail('invalid_host_path','genesis','symlink parent forbidden');writeFileSync(marker,canonical(genesis),{flag:'wx',mode:0o600});const statePath=join(this.root,'state.json');writeFileSync(statePath,bytes,{flag:'wx',mode:0o600});
   return {status:'initialized',rootInstanceId:g.rootInstanceId,stateRef:{path:statePath,sha256:sha(bytes)},genesisRef:{path:marker,sha256:sha(readFileSync(marker))}};
  }finally{release();}
 }
 private probeInputs(task:any,refs:Map<string,any>,result:any){
  const b=this.bindings.get(this.taskEntry(task,this.readGrant()).taskRef);
  if(b.confirmedRecordRoots.length||b.studentReleaseFiles.length||b.datasetDirectory!==null||b.seed!==null||b.trainingPhase!==null||b.numericalRestartReceiptRef!==null)fail('input_identity_unverified','probeInputBinding','public probe never reads private record roots or training inputs');
  const catalog=new Map<string,any>(),load=(ref:string)=>{if(catalog.has(ref))return catalog.get(ref);const value=freezeJSON(this.resolveRef(ref));catalog.set(ref,value);return value;};
  // Only these documented R edges are followed. Reports/source records are
  // opaque public JSON leaves: never recurse through their paths or execute a
  // producerEntry, private recorder, game replay or model.
  for(const ref of taskReferences(task))load(ref);
  if(task.datasetRefs.length!==1)fail('input_identity_unverified','probe','one fixed probe spec required');
  const spec=load(task.datasetRefs[0]);strictObject(spec,'probeSpec',['schema','screeningPlanRef','snapshotSetRef','configurationRef','configurationOrdinal']);
  const plan=load(spec.screeningPlanRef);strictObject(plan,'screeningPlan',['schema','snapshotSetRef','configurationRefs','budgetRef','rulesRef','candidateRef','promptRef','phaseReviewRef']);
  for(const k of ['snapshotSetRef','budgetRef','rulesRef','candidateRef','promptRef','phaseReviewRef'])load(plan[k]);
  for(const ref of array(plan.configurationRefs,'configurationRefs')){const c=load(ref);strictObject(c,'probeConfiguration',['schema','releaseRef','profileRevisionRef','publicProfileRef']);load(c.releaseRef);load(c.publicProfileRef);}
  const set=load(spec.snapshotSetRef);strictObject(set,'probeSnapshots',['schema','sourceIndexRef','rulesRef','parentPolicyRef','candidateRef','promptRef','snapshots']);
  for(const k of ['sourceIndexRef','rulesRef','parentPolicyRef','candidateRef','promptRef'])load(set[k]);
  for(const row of array(set.snapshots,'snapshots')){
   strictObject(row,'snapshot',['snapshotId','phase','phaseEvidenceRef','bundleRef','generationEvidenceRef','publicSourceRef']);load(row.bundleRef);
   for(const [ref,keys,fields] of [[row.generationEvidenceRef,['bundleRef','sourceIndexRef','sourceRef','parentPolicyRef','candidateRef','promptRef','rulesRef','producerSourceRevision','invocationEvidenceRef','reviewEvidenceRef'],['schema','snapshotId','bundleRef','sourceIndexRef','sourceRef','parentPolicyRef','candidateRef','promptRef','rulesRef','producerSourceRevision','producerEntry','invocationEvidenceRef','reviewEvidenceRef']],[row.publicSourceRef,['bundleRef','sourceIndexRef','sourceRef','visibilityReviewRef'],['schema','snapshotId','bundleRef','sourceIndexRef','sourceRef','visibilityReviewRef']],[row.phaseEvidenceRef,['bundleRef','classificationRuleRef','reviewEvidenceRef'],['schema','snapshotId','bundleRef','phase','classificationRuleRef','reviewEvidenceRef']]] as any[]){const e=load(ref);strictObject(e,'probeEvidence',fields);for(const k of keys)load(e[k]);}
  }
  const review=load(plan.phaseReviewRef);strictObject(review,'phaseReview',['schema','classificationRuleRef','coverageRuleRef','rows','requiredResourceClassIds','resourceWitnesses','passWitnesses','reviewEvidenceRef']);for(const k of ['classificationRuleRef','coverageRuleRef','reviewEvidenceRef'])load(review[k]);
  for(const row of array(review.rows,'phaseReview.rows')){strictObject(row,'phaseReviewRow',['snapshotId','bundleRef','phaseEvidenceRef']);load(row.bundleRef);load(row.phaseEvidenceRef);}
  const configuration=load(spec.configurationRef);
  result.probeProfile=freezeJSON({configurationRef:spec.configurationRef,releaseRef:configuration.releaseRef,reference:configuration.profileRevisionRef,publicProfile:load(configuration.publicProfileRef)});
  result.probeCatalog=catalog;verifyProbeSnapshots({task,refs,inputs:result});
  // Keep all independently granted/recorded probe identities, not just this
  // Task's spec. This inventory is rechecked against locked state at launch and
  // reserve; a renamed Task/plan/spec cannot refresh an ordinal or budget.
  const g=this.readGrant(),state=this.checkExistingRoot(),tasks=new Map<string,any>();
  for(const entry of g.tasks){const t=validateTask(this.resolveRef(entry.taskRef));if(t.taskKind==='probe'&&this.resolveRef(t.capabilityRef).id==='B04.api-probe.v1')tasks.set(entry.taskRef,t);}
  for(const run of Object.values(state.runs) as any[])if(run.task?.taskKind==='probe'&&(run.task.planRef===task.planRef||run.task.budgetRef===task.budgetRef||run.task.researchBatchId===task.researchBatchId)){if(run.taskSHA256!==digest(run.task)||state.tasks[run.task.taskId]!==run.runId)fail('state_history_conflict','probe','original Task/run history differs');tasks.set(run.taskRef,validateTask(run.task));}
  const context:any={tasks:[...tasks].map(([taskRef,value])=>({taskRef,value})),references:[]};
  for(const [ref,t] of tasks){if(t.datasetRefs.length!==1)fail('probe_configuration_conflict','datasetRefs','one original spec required');load(t.capabilityRef);const sp=load(t.datasetRefs[0]);load(sp.screeningPlanRef);load(sp.configurationRef);}
  context.references=[...catalog].map(([ref,value])=>({ref,value}));freezeJSON(context);this.probeContexts.add(context);this.checkProbeAdmission(task,state,context);result.probeAdmissionContext=context;
  for(const method of ['set','delete','clear'])Object.defineProperty(catalog,method,{value:()=>fail('input_identity_unverified','probeCatalog','read-only public catalog'),writable:false});Object.freeze(catalog);
 }
 checkProbeAdmission(task:any,state:any,context:any){
  if(!context||!this.probeContexts.has(context))fail('input_identity_unverified','probeAdmissionContext','host-built fixed inventory required');
  const references=new Map(context.references.map((x:any)=>[x.ref,x.value])),get=(ref:string):any=>{const value=references.get(ref);if(!value||digest(value)!==ref?.split(':').at(-1))fail('reference_unavailable','probeHistory','original fixed probe reference absent');return value;};
  const all=new Map<string,any>();for(const x of context.tasks)all.set(x.taskRef,x.value);
  for(const run of Object.values(state.runs) as any[])if(run.task?.taskKind==='probe'&&(run.task.planRef===task.planRef||run.task.budgetRef===task.budgetRef||run.task.researchBatchId===task.researchBatchId)){if(run.taskSHA256!==digest(run.task)||state.tasks[run.task.taskId]!==run.runId||run.taskRef?.split(':').at(-1)!==digest(run.task))fail('state_history_conflict','probeHistory','original fixed Task/run history required');all.set(run.taskRef,run.task);}
  const current=get(task.datasetRefs[0]),plan=get(current.screeningPlanRef),ordinals=new Map(),configurations=new Set(),taskIds=new Set();
  for(const [ref,t] of all){if(t.planRef!==task.planRef&&t.researchBatchId!==task.researchBatchId&&t.budgetRef!==task.budgetRef)continue;const cap=get(t.capabilityRef);if(cap.id!=='B04.api-probe.v1')continue;
   if(t.planRef!==task.planRef||t.researchBatchId!==task.researchBatchId||t.budgetRef!==task.budgetRef||t.authorizationRef!==task.authorizationRef||t.datasetRefs.length!==1||t.limits.maxProviderRequests>24||['maxOptimizerSteps','maxMatchAttempts','maxLabelDecisions'].some(k=>t.limits[k]!==0))fail('probe_configuration_conflict','task','same original plan/batch/budget and bounded probe scope required');
   const spec=get(t.datasetRefs[0]);if(spec.schema!=='ohuo-api-probe-spec-v1'||spec.screeningPlanRef!==current.screeningPlanRef||spec.snapshotSetRef!==current.snapshotSetRef||![0,1].includes(spec.configurationOrdinal)||plan.configurationRefs[spec.configurationOrdinal]!==spec.configurationRef||ordinals.has(spec.configurationOrdinal)||configurations.has(spec.configurationRef)||taskIds.has(t.taskId)||ref.split(':').at(-1)!==digest(t))fail('probe_configuration_conflict','configurationOrdinal','one exact Task per original configuration ordinal; same frozen screening/snapshots');
   ordinals.set(spec.configurationOrdinal,ref);configurations.add(spec.configurationRef);taskIds.add(t.taskId);
  }
  if(!ordinals.size||ordinals.size>2||!Array.isArray(plan.configurationRefs)||plan.configurationRefs.length>2||plan.budgetRef!==task.budgetRef)fail('probe_configuration_conflict','screeningPlan','original maximum two configurations required');
  const ledger=state.budgets[task.budgetRef];if(!ledger||ledger.limits.maxProviderRequests>48||['maxOptimizerSteps','maxMatchAttempts','maxLabelDecisions'].some(k=>ledger.limits[k]!==0))fail('budget_binding_conflict','probe','original shared 48-or-smaller provider budget required');return true;
 }
 private selectionAdmissionContext(task:any,selection:any,spec:any,references:ReadonlyMap<string,any>){
  const context={selectionRef:task.datasetRefs[0],selection,spec,capabilities:[...references].filter(([,v])=>v&&equal(Object.keys(v).sort(),['id','kind','mode'])).map(([ref,value])=>({ref,value}))};freezeJSON(context);this.selectionContexts.add(context);return context;
 }
 private async offlineSelectionInputs(task:any,refs:Map<string,any>,result:any){
  if(task.datasetRefs.length!==1)fail('selection_task_binding','datasetRefs','one original full selection required');const selection=refs.get(task.datasetRefs[0]);if(selection?.schema!=='ohuo-offline-label-selection-v2')fail('selection_production_required','datasetRefs','research labels require the fixed v2 production proof');
  const production=this.resolveRef(selection.productionRef),spec=this.resolveRef(production.specRef),state=this.checkExistingRoot(),run=state.runs[state.tasks[task.taskId]],phase=run?.checkpoint?'label-resume':'label-start',trusted=await this.offlineSelectionHostInputs(spec,{phase,task}),quota=this.jsonBytes(this.evidenceBytes(spec.quotaBasisRef));
  const entry=this.taskEntry(task,this.readGrant()),receipts=entry.prerequisiteReceipts.filter((p:any)=>this.resolveRef(p.requirementRef).kind==='selection-production');if(receipts.length!==1)fail('prerequisites_missing','selection-production','one independently bound original production prerequisite required');const receipt=this.prerequisiteReceipt(receipts[0].receiptRef,task,receipts[0].requirementRef),productionFile=this.references.get(selection.productionRef);
  const bindsProduction=receipt.evidence_refs.some((f:any)=>{const file=this.evidence.get(f.id);if(productionFile&&file?.path===productionFile.path&&f.sha256===productionFile.sha256)return true;const bytes=this.evidenceBytes(f);let value:any;try{value=JSON.parse(bytes.toString('utf8'));}catch{return false;}return value.schema==='ohuo-offline-selection-commit-v1'&&value.specRef===production.specRef&&value.productionRef===selection.productionRef&&value.selectionRef===task.datasetRefs[0];});
  const rule=this.resolveRef(this.readApprovedAction(task).action.acceptanceRuleRef),expectedStage=spec.purpose==='b_training_source'?4:6;
  if(!bindsProduction||task.budgetRef!==quota.budgetRef||rule.stage!==expectedStage||selection.purpose!==spec.purpose||spec.purpose==='b_training_source'&&task.parentPolicyRef!==spec.actingReleaseRef||spec.purpose==='distribution_diagnostic'&&!task.releaseRefs.includes(spec.actingReleaseRef))fail('selection_task_binding','selection-production','this original label action/budget/purpose/acting identity must bind the actual full production, not the freeze action or another receipt');
  const {verifyOfflineSelection}=await import('./offline-selection'),proof=verifyOfflineSelection(selection,trusted);
  if(proof.production.verification!=='reproduced')fail('selection_production_incomplete','production','the entire approved population must be accounted for before labels');
  if(result.confirmedRecordRoots.some((root:string)=>!trusted.confirmedRecordRoots.includes(root)))fail('input_identity_unverified','confirmedRecordRoots','label roots must be original granted settled source runs');
  result.offlineSelection=trusted;result.offlineSelectionAdmissionContext=this.selectionAdmissionContext(task,selection,spec,trusted.references);this.checkOfflineSelectionAdmission(task,state,result.offlineSelectionAdmissionContext);
 }
 checkOfflineSelectionAdmission(task:any,state:any,context:any){
  if(!context||!this.selectionContexts.has(context))fail('input_identity_unverified','offlineSelectionAdmissionContext','fixed host verified complete selection context required');
  const {selectionRef,selection,spec}=context;if(state.rootInstanceId!==this.manifest.rootInstanceId||selection.schema!=='ohuo-offline-label-selection-v2'||digest(selection)!==selectionRef.split(':').at(-1)||!equal(task.datasetRefs,[selectionRef])||task.planRef!==spec.planRef)fail('selection_task_binding','selectionRef','exact original full selection and control root required');
  const owned=(t:any)=>new Set(selection.rows.filter((row:any)=>row.split===t.sourcePlan.split&&t.sourcePlan.familyIds.includes(row.familyId)).map((row:any)=>canonical(row.key))),currentKeys=owned(task),caps=new Map(context.capabilities.map((x:any)=>[x.ref,x.value]));
  if(!currentKeys.size)fail('selection_task_binding','sourcePlan','nonempty original deterministic split/family projection required');
  for(const run of Object.values(state.runs) as any[]){const t=run.task;if(t?.planRef!==task.planRef||t?.budgetRef!==task.budgetRef)continue;const cap:any=caps.get(t.capabilityRef);if(!cap)fail('reference_unavailable','selectionHistory','new history capability was absent from fixed preflight catalog');if(cap.id!=='B07.offline-label.v1')continue;
   if(t.researchBatchId!==task.researchBatchId||t.authorizationRef!==task.authorizationRef||run.runId!==t.runId||state.tasks[t.taskId]!==run.runId||run.taskSHA256!==digest(t)||run.taskRef?.split(':').at(-1)!==digest(t))fail('state_history_conflict','selectionHistory','same original Task/run/batch/authorization required');
   const ledger=state.budgets[task.budgetRef],reservations=Object.values(ledger?.reservations??{}).filter((r:any)=>r.runId===run.runId) as any[],cp=run.checkpoint,active=cp?.active!==null&&cp?.active!==undefined;
   const exposed=active||cp?.executionUnknown===true||(cp?.rows??[]).some((r:any)=>r.requestCount===null||r.requestCount>0)||reservations.some(r=>r.cost?.providerRequests>0&&r.status!=='released');
   if(run.runId===task.runId){if(run.taskSHA256!==digest(task)||cp&&cp.selectionRef!==selectionRef)fail('selection_resume_binding','checkpoint','same immutable Task and full selection required');if(run.executionUnknown===true||run.observationStatus==='unknown'||cp?.executionUnknown===true||reservations.some(r=>r.status==='reserved_unknown')||active&&(!['preparing','running','stopping'].includes(run.status)||ledger?.activeRunId!==run.runId))fail('selection_execution_uncertain','checkpoint','unknown request cannot resume or be resent');}
   if(!exposed)continue;
   if(!equal(t.datasetRefs,[selectionRef]))fail('selection_changed_after_label_exposure','datasetRefs','original full selection cannot change after sent or unknown query');
   if(run.runId!==task.runId&&[...owned(t)].some(key=>currentKeys.has(key)))fail('selection_owned_rows_already_exposed','sourcePlan','new Task cannot query an already exposed selected decision; disjoint split/family projections remain allowed');
  }
  return true;
 }
 private evidenceDocument(ref:any){return {ref,bytes:this.evidenceBytes(ref).toString('utf8')};}
 private boundDocument(path:string,expectedSHA?:string){
  const relativePath=relative(this.repositoryRoot,path),bytes=this.regular(this.relativePath(relativePath));if(expectedSHA&&sha(bytes)!==expectedSHA)fail('reference_identity_mismatch',relativePath,'original fixed bytes changed');
  const registered=[...this.evidence].filter(([,f])=>f.path===relativePath&&f.sha256===sha(bytes));if(registered.length>1)fail('duplicate_reference','evidenceFiles','one immutable artifact identity required');
  return {ref:{id:registered[0]?.[0]??relativePath,sha256:sha(bytes)},bytes:bytes.toString('utf8')};
 }
 private calibrationFacts(c:any,checks:any){
  const task=validateTask(this.resolveRef(c.taskRef)),binding=this.bindings.get(c.taskRef);if(!binding||binding.trainingPhase!=='calibration'||c.runId!==task.runId||task.outputRoot!==join(this.root,'runs',task.runId))fail('prerequisites_missing','calibration','fixed same-root calibration Task/binding required');
  const summary=this.evidenceDocument(c.summaryRef),controlState=this.evidenceDocument(c.controlStateRef),saved=this.jsonBytes(Buffer.from(controlState.bytes)),run=saved.runs?.[task.runId];
  if(!run||saved.rootInstanceId!==this.manifest.rootInstanceId||run.taskRef!==c.taskRef||run.taskSHA256!==digest(task)||!equal(run.task,task))fail('prerequisites_missing','calibration.controlState','exact original Task/run snapshot required');
  const dataset={ref:task.datasetRefs[0],value:this.resolveRef(task.datasetRefs[0])};if(task.datasetRefs.length!==1||dataset.value.schema!=='ohuo-frozen-dataset-ref-v1'||binding.datasetDirectory===null)fail('prerequisites_missing','dataset','original fixed dataset required');
  const directory=this.directory(binding.datasetDirectory),datasetManifest=this.boundDocument(join(directory,'manifest.json'),dataset.value.manifestSHA256),manifest=this.jsonBytes(Buffer.from(datasetManifest.bytes));
  if(manifest.samples?.path!=='samples.jsonl'||!hash(manifest.samples.sha256))fail('prerequisites_missing','samples','original fixed sample file required');const samples=this.boundDocument(join(directory,'samples.jsonl'),manifest.samples.sha256);
  strictObject(checks,'checks',['input','mask','stableLogSoftmax','loss','totalGradient','parameterChange']);
  const evidence=new Map<string,any>();for(const check of Object.values(checks) as any[]){strictObject(check,'check',['status','evidence_refs']);if(!['passed','failed','unknown'].includes(check.status))fail('prerequisites_missing','check.status','original explicit semantic status required');for(const f of array(check.evidence_refs,'check.evidence_refs'))evidence.set(canonical(f),this.evidenceDocument(f));}
  const controls=new Map<number,any>();for(const id of array(run.committed,'committed')){const reservation=saved.budgets?.[task.budgetRef]?.reservations?.[id];if(!reservation||reservation.runId!==run.runId||reservation.status!=='committed'||!hash(reservation.checkpointSHA256))fail('prerequisites_missing','committed','original committed calibration checkpoint required');const doc=this.boundDocument(join(task.outputRoot,'checkpoint-'+reservation.checkpointSHA256+'.json')),cp=this.jsonBytes(Buffer.from(doc.bytes));if(digest(cp)!==reservation.checkpointSHA256||controls.has(cp.optimizerSteps))fail('prerequisites_missing','controlCheckpoint','exact unique committed checkpoint required');controls.set(cp.optimizerSteps,{doc,cp});}
  const checkpoints=array(c.checkpointFactsRefs,'checkpointFactsRefs').map((f:any,index:number)=>{
   const facts=this.evidenceDocument(f),value=this.jsonBytes(Buffer.from(facts.bytes));if(value.optimizerSteps!==index)fail('prerequisites_missing','checkpointFactsRefs','ordered original update0 and every committed update required');
   const zero=array(run.checkpoint?.milestones,'milestones').filter((m:any)=>m.checkpoint?.optimizerSteps===0),control=index===0?null:controls.get(index);if(index===0&&zero.length!==1||index>0&&!control)fail('prerequisites_missing','controlCheckpoint','original complete pointer required');
   const pointer=index===0?zero[0].checkpoint:control.cp.studentCheckpoint;strictObject(pointer,'studentCheckpoint',['schema','path','optimizerSteps','manifestSHA256']);
   if(pointer.schema!=='ohuo-supervised-pointer-v1'||pointer.optimizerSteps!==index||!hash(pointer.manifestSHA256)||typeof pointer.path!=='string'||!/^checkpoints\/[^/]+$/.test(pointer.path)||pointer.path.endsWith('.tmp'))fail('prerequisites_missing','studentCheckpoint','original immutable checkpoint pointer required');
   const checkpointDirectory=this.directory(relative(this.repositoryRoot,join(task.outputRoot,pointer.path))),factsFile=this.evidence.get(f.id);
   if(factsFile?.path!==relative(this.repositoryRoot,join(checkpointDirectory,'state.json')))fail('prerequisites_missing','checkpointFactsRefs','facts must be original pointer state.json, not a detached copy');
   return {controlCheckpoint:control?.doc??null,manifest:this.boundDocument(join(checkpointDirectory,'manifest.json'),pointer.manifestSHA256),facts};
  });
  return {task:{ref:c.taskRef,value:task},inputBinding:binding,dataset,datasetManifest,samples,controlState,summary,checkpoints,checks,evidence:[...evidence.values()]};
 }
 private calibrationInput(receipt:any){
  const c=receipt.calibration,diagnostic=this.jsonBytes(this.evidenceBytes(c.diagnosticRef));strictObject(diagnostic,'calibrationDiagnostic',['schema','taskRef','runId','summaryRef','controlStateRef','checkpointFactsRefs','checks','issues']);
  if(diagnostic.schema!=='ohuo-calibration-qualification-v1'||diagnostic.taskRef!==c.taskRef||diagnostic.runId!==c.runId||!equal(diagnostic.summaryRef,c.summaryRef)||!equal(diagnostic.controlStateRef,c.controlStateRef)||!equal(diagnostic.checkpointFactsRefs,c.checkpointFactsRefs))fail('prerequisites_missing','diagnostic','original qualification diagnostic binding differs');
  return this.calibrationFacts(c,diagnostic.checks);
 }
 private currentProducerSource(){
  for(const name of ['ai','engine','review'])if(realpathSync(req.resolve('@gd/'+name))!==join(this.repositoryRoot,'packages',name,'src/index.ts'))fail('input_identity_unverified','workspace','actual workspace import resolves outside fixed source tree');
  const matches:string[]=[];for(const [ref] of this.references){const value=this.resolveRef(ref);if(!value||!equal(Object.keys(value).sort(),['baseCommit','files'])||!Array.isArray(value.files))continue;
   if(!/^[a-f0-9]{40}$/.test(value.baseCommit)||value.files.length>10000)continue;
   const paths=new Set<string>();let current=true;for(const f of value.files){this.fileShape(f);if(paths.has(f.path))fail('input_identity_unverified','source.files','duplicate source');paths.add(f.path);const path=this.relativePath(f.path);if(!existsSync(path)||sha(this.regular(path))!==f.sha256)current=false;}
   if(current&&HOST_SOURCE_FILES.every(p=>paths.has(p)))matches.push(ref);
  }
  if(matches.length!==1)fail('input_identity_unverified','producerSourceRevision','one fixed actual full producer source manifest required; acceptance remains original external evidence');return matches[0];
 }
 private assertDiagnosticWriteIntersection(state:any,directory:string){
  const intersects=(a:string,b:string)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
  for(const run of Object.values(state.runs) as any[]){const ledger=state.budgets?.[run.task?.budgetRef],uncertain=['preparing','running','stopping'].includes(run.status)||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||ledger?.activeRunId===run.runId||Object.values(ledger?.reservations??{}).some((r:any)=>r.runId===run.runId&&['reserved','reserved_unknown'].includes(r.status));if(!uncertain)continue;
   if(!run.task||run.taskSHA256!==digest(run.task)||run.taskRef?.split(':').at(-1)!==digest(run.task)||!isAbsolute(run.task.outputRoot))fail('active_source_unknown','registeredRuns','unknown registered execution scope is not an empty intersection');
   if(intersects(directory,run.task.outputRoot))fail('active_write_intersection','outputRoot','registered active/unknown output intersects diagnostic write');
   const source=this.resolveRef(run.task.sourceRevision);strictObject(source,'registeredRunSource',['baseCommit','files']);for(const f of array(source.files,'source.files')){this.fileShape(f);if(intersects(directory,this.relativePath(f.path)))fail('active_write_intersection','sourceRevision','registered active/unknown execution source intersects diagnostic write');}
  }
 }
 async qualifyCalibration(requestRef:string){
  const request=this.resolveRef(requestRef);strictObject(request,'qualificationRequest',['schema','taskRef','runId','summaryRef','controlStateRef','checkpointFactsRefs','checks']);
  if(request.schema!=='ohuo-calibration-qualification-request-v1')fail('unsupported_schema','qualificationRequest','fixed calibration request v1 required');fixedReference(request.taskRef,'taskRef');validateIdentifier(request.runId,'runId');
  const task=validateTask(this.resolveRef(request.taskRef)),g=this.readGrant(),entry=this.taskEntry(task,g),binding=this.bindings.get(request.taskRef);
  if(entry.taskRef!==request.taskRef||task.taskKind!=='supervised_training'||binding?.trainingPhase!=='calibration'||task.runId!==request.runId||task.outputRoot!==join(this.root,'runs',task.runId))fail('input_identity_unverified','qualificationRequest','exact original same-root calibration identity required');
  await this.checkAuthorization(task);const {action}=this.readApprovedAction(task);this.prerequisites(task,g,action);
  const runtime=this.resolveRef(task.runtimeRef);strictObject(runtime,'runtimeRef',['node','platform','arch','tsx','python']);if(runtime.node!==process.version||runtime.platform!==process.platform||runtime.arch!==process.arch||runtime.tsx!==req('tsx/package.json').version)fail('input_identity_unverified','runtimeRef','actual producer Node/platform/tsx differs; no Python is launched');
  const producerSourceRevision=this.currentProducerSource(),outputRoot=this.directory(relative(this.repositoryRoot,task.outputRoot)),requestSHA=requestRef.split(':').at(-1)!,directory=join(outputRoot,'calibration-qualification',requestSHA);
  const releaseState=acquireSourceWriter(join(this.root,'state.json'));let releaseOutput:(()=>void)|undefined;
  try{releaseOutput=acquireSourceWriter(outputRoot);const state=this.checkExistingRoot(),input=this.calibrationFacts(request,request.checks),saved=this.jsonBytes(Buffer.from(input.controlState.bytes)),run=state.runs?.[task.runId],ledger=state.budgets?.[task.budgetRef];
   if(state.tasks[task.taskId]!==task.runId||!equal(run,saved.runs?.[task.runId])||!['completed','failed','interrupted'].includes(run?.status)||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.checkpoint?.executionUnknown===true||run.stopReason==='execution_uncertain'||run.failureReason==='execution_uncertain'||ledger?.activeRunId===task.runId)fail('execution_uncertain','calibrationRun','original ended, reconciled calibration and fixed snapshot required');
   const reservations=(l:any)=>Object.fromEntries(Object.entries(l?.reservations??{}).filter(([,r]:any)=>r.runId===task.runId));if(!equal(reservations(ledger),reservations(saved.budgets?.[task.budgetRef]))||Object.values(reservations(ledger)).some((r:any)=>['reserved','reserved_unknown'].includes(r.status)))fail('execution_uncertain','calibrationLedger','original committed chain and released ownership required');
   // Validate the original role binding without confusing a completed role's
   // admission=false with invalid history. No execution permission is emitted.
   if(binding.numericalRestartReceiptRef!==null){const receipt=this.resolveRef(binding.numericalRestartReceiptRef);if(receipt.schema==='ohuo-prerequisite-receipt-v2')this.checkBranchAdmission(task,state,this.numericalContext(task,entry,binding,receipt));else this.numericalRestart(task,entry,binding);}
   else this.assertActionTaskLineage(task,action,state);
   this.assertDiagnosticWriteIntersection(state,directory);const closeout=this.readCloseout(),observation=this.priorPlanObservation(task,closeout,state);
   const diagnostic=buildCalibrationQualification(input),diagnosticBytes=canonical(diagnostic),diagnosticPath=join(directory,'diagnostic.json'),idBase=relative(this.repositoryRoot,directory),diagnosticRef={id:idBase+'/diagnostic.json',sha256:sha(diagnosticBytes)};
   const established=existsSync(diagnosticPath)&&sha(this.regular(diagnosticPath))===diagnosticRef.sha256||[...this.evidence.values()].some(f=>f.path===relative(this.repositoryRoot,diagnosticPath)&&f.sha256===diagnosticRef.sha256);
   const manifest=this.jsonBytes(Buffer.from(input.datasetManifest.bytes)),summary=this.jsonBytes(Buffer.from(input.summary.bytes)),parent=this.resolveRef(task.parentPolicyRef);strictObject(parent,'parentPolicy',['schema','policyRef','policyIdentity']);if(parent.schema!=='ohuo-parent-policy-ref-v1'||!equal(parent.policyIdentity,manifest.plan?.identities?.basePolicy)||!equal(parent.policyIdentity,summary.frozenRefs?.parentIdentity)||!hash(parent.policyIdentity?.weightsSHA256))fail('input_identity_unverified','parentPolicyRef','original fixed parent metadata must match dataset and summary; weights are not read');
   const production={schema:'ohuo-calibration-qualification-production-v1',requestRef,taskRef:request.taskRef,runId:task.runId,producerSourceRevision,diagnosticRef,summaryRef:request.summaryRef,controlStateRef:request.controlStateRef,checkpointFactsRefs:request.checkpointFactsRefs,datasetRef:task.datasetRefs[0],datasetManifestSHA256:input.datasetManifest.ref.sha256,samplesSHA256:input.samples.ref.sha256,parentPolicyRef:task.parentPolicyRef,parentWeightsSHA256:parent.policyIdentity.weightsSHA256},productionBytes=canonical(production),productionPath=join(directory,'production.json'),productionRef={id:idBase+'/production.json',sha256:sha(productionBytes)};
   if((closeout.entity.status!=='incomplete'||['completed','terminated'].includes(observation?.status))&&!established&&!(existsSync(productionPath)&&this.regular(productionPath).toString('utf8')===productionBytes))fail('plan_closed','qualificationRequest','closed plan permits only fixed established diagnostic reconstruction, not a new judgment');
   // Check both destinations before creating either; never overwrite a conflict.
   for(const [path,bytes] of [[diagnosticPath,diagnosticBytes],[productionPath,productionBytes]])if(existsSync(path)&&this.regular(path).toString('utf8')!==bytes)fail('artifact_conflict',relative(this.repositoryRoot,path),'immutable diagnostic artifact differs');
   for(const path of [dirname(directory),directory]){if(!existsSync(path))mkdirSync(path,{mode:0o700});if(!lstatSync(path).isDirectory()||realpathSync(path)!==path)fail('invalid_host_path','qualificationDirectory','real approved output path required');}
   for(const [path,bytes] of [[diagnosticPath,diagnosticBytes],[productionPath,productionBytes]])if(!existsSync(path))writeFileSync(path,bytes,{flag:'wx',mode:0o600});
   return {requestRef,taskRef:request.taskRef,runId:task.runId,producerSourceRevision,diagnosticRef,productionRef};
  }finally{releaseOutput?.();releaseState();}
 }
 verifyCalibrationPrerequisite(task:any,entry:any,b:any,state:any,numerical:any=null){
  if(b?.trainingPhase!=='formal')return undefined;
  const candidates=entry.prerequisiteReceipts.map((p:any)=>({ref:p.receiptRef,value:this.prerequisiteReceipt(p.receiptRef,task,p.requirementRef)})).filter((x:any)=>x.value.schema==='ohuo-prerequisite-receipt-v2'&&x.value.kind==='calibration-qualification');
  if(candidates.length!==1)fail('prerequisites_missing','calibration','one actual qualified calibration receipt required');
  const {value:receipt}=candidates[0],input=this.calibrationInput(receipt),prior=input.task.value,run=state.runs?.[prior.runId],saved=this.jsonBytes(Buffer.from(input.controlState.bytes)),ledger=state.budgets?.[task.budgetRef];
  if(prior.taskId===task.taskId||prior.runId===task.runId||state.tasks[prior.taskId]!==prior.runId||!equal(run,saved.runs?.[prior.runId])||run?.status!=='completed'||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||ledger?.activeRunId===prior.runId)fail('prerequisites_missing','calibration','original same-root completed and released run required');
  const priorReservations=(l:any)=>Object.fromEntries(Object.entries(l?.reservations??{}).filter(([,r]:any)=>r.runId===prior.runId));
  if(!equal(priorReservations(ledger),priorReservations(saved.budgets?.[task.budgetRef]))||Object.values(priorReservations(ledger)).some((r:any)=>['reserved','reserved_unknown'].includes(r.status)))fail('prerequisites_missing','calibration','calibration ledger differs or has unresolved work');
  for(const k of ['planRef','planVersion','budgetRef','authorizationRef','researchBatchId','sourceRevision','runtimeRef','parentPolicyRef','releaseRefs','rulesRef','sourcePlan','splitRefs','seatLayoutPlan','actorSampleRule','datasetRefs','labelPolicyRef','promptRef','operationScope','stopPolicy'])if(!equal(prior[k],task[k]))fail('prerequisites_missing',k,'formal must retain original calibration identity');
  const formalRecovery=numerical?.schema==='ohuo-verified-numerical-recovery-v1'&&numerical.case==='failed_formal'&&numerical.role==='formal_recovery';
  if(!equal(prior.learnerRecipe,{...task.learnerRecipe,...(formalRecovery?{learningRate:1e-4}:{})})||input.inputBinding.seed!==b.seed||prior.learnerRecipe.initialization!=='fixed-parent-new-optimizer')fail('prerequisites_missing','recipe','same B/data/seed/complete recipe; only original formal-recovery LR exception');
  if(numerical?.role==='formal_continuation'&&prior.taskId!==task.parentTaskId)fail('prerequisites_missing','calibration','formal continuation requires this exact recovery calibration');
  const actual=buildCalibrationQualification(input),recorded=this.jsonBytes(this.evidenceBytes(receipt.calibration.diagnosticRef));
  if(!equal(actual,recorded)||actual.issues.length||Object.values(actual.checks).some((x:any)=>x.status!=='passed')||!receipt.evidence_refs.some((f:any)=>equal(f,receipt.calibration.diagnosticRef)))fail('prerequisites_missing','calibration','complete original facts and genuine diagnostic must agree');
  return freezeJSON({verified:true,taskRef:entry.taskRef,datasetRef:task.datasetRefs[0],parentPolicyRef:task.parentPolicyRef,seed:b.seed,recipe:task.learnerRecipe});
 }
 private numericalContext(task:any,entry:any,b:any,receipt:any){
  if(this.manifest.schema!=='ohuo-fixed-host-v2')fail('unsupported_host_schema','numericalRecoveryAssignments','new numerical roles require strict host v2');
  const references=[...this.references].map(([ref])=>({ref,value:this.resolveRef(ref)})),get=(ref:string)=>{const value=references.find(x=>x.ref===ref)?.value;if(!value)fail('reference_unavailable',ref,'fixed reference required');return value;};
  const assignmentFiles=this.manifest.numericalRecoveryAssignments.map((file:any)=>({ref:{id:file.path,sha256:file.sha256},bytes:this.readFile(file).toString('utf8')})),assignments=assignmentFiles.map((doc:any)=>this.jsonBytes(Buffer.from(doc.bytes)));
  const matches=assignments.filter((a:any)=>array(a.roles,'assignment.roles').some((r:any)=>r.taskRef===entry.taskRef));if(matches.length!==1)fail('branch_role_conflict','assignment','one complete fixed assignment for exact Task required');
  const assignment=matches[0],spec=get(receipt.recoveryRef);if(assignment.specRef!==receipt.recoveryRef||assignment.receiptRef!==b.numericalRestartReceiptRef)fail('branch_evidence_unverified','assignment','exact spec/receipt chain required');
  const {actions:approvedActions}=this.readApprovedAction(task),actionTaskRefs:any[]=[];
  for(const role of spec.roles){const action=approvedActions.find((a:any)=>a.clauseRef===role.clauseRef&&a.branchRef===role.branchRef);if(!action)fail('original_action_conflict','role','original approved role action missing');const candidates=references.filter(x=>action.plannedTaskIds.includes(x.value?.taskId)&&x.value?.planRef===task.planRef&&x.value?.planScope?.clauseRef===role.clauseRef&&x.value?.planScope?.branchRef===role.branchRef&&this.bindings.get(x.ref)?.trainingPhase===role.phase);if(candidates.length!==1)fail('original_action_conflict','actionTaskRefs','one exact original role template; ambiguity is not permission');actionTaskRefs.push({clauseRef:role.clauseRef,branchRef:role.branchRef,taskRef:candidates[0].ref});}
  const grant=this.readGrant(),evidence=new Map<string,any>(),calibrationQualifications:any[]=[];
  for(const grantEntry of grant.tasks){const gt=get(grantEntry.taskRef);for(const p of grantEntry.prerequisiteReceipts){const r=this.prerequisiteReceipt(p.receiptRef,gt,p.requirementRef,false);for(const f of r.evidence_refs)evidence.set(canonical(f),this.evidenceDocument(f));if(r.numerical){for(const f of [r.numerical.inputImplementationReviewRef,...(r.numerical.metricsRef?[r.numerical.metricsRef]:[])]){const doc=this.evidenceDocument(f);this.jsonBytes(Buffer.from(doc.bytes));evidence.set(canonical(f),doc);}}if(r.kind==='calibration-qualification'&&r.schema==='ohuo-prerequisite-receipt-v2'&&r.decision==='met'&&!calibrationQualifications.some(x=>x.receiptRef===p.receiptRef)){const input=this.calibrationInput(r);calibrationQualifications.push({receiptRef:p.receiptRef,input});evidence.set(canonical(r.calibration.diagnosticRef),this.evidenceDocument(r.calibration.diagnosticRef));}}}
  const docs=[...evidence.values()].flatMap(doc=>{let value:any;try{value=JSON.parse(doc.bytes);}catch{return [];}return value&&typeof value==='object'&&!Array.isArray(value)?[{doc,value}]:[];}),failureDiagnoses:any[]=[{runId:receipt.numerical.failedRunId,evidenceRef:receipt.numerical.inputImplementationReviewRef,metricsRef:receipt.numerical.metricsRef}];
  for(const role of spec.roles){const candidates=docs.filter(x=>x.value.failedTaskId===role.taskId&&['diagnosed_numerical_divergence','first_epoch_demo_and_keep_increase'].includes(x.value.trigger)&&Object.hasOwn(x.value,'inputsCorrect')&&Object.hasOwn(x.value,'implementationCorrect'));if(candidates.length>1)fail('branch_evidence_unverified','failureDiagnoses','ambiguous role diagnosis; preserve unresolved state');if(candidates.length){const d=candidates[0],metrics=docs.filter(x=>x.value.failedTaskId===role.taskId&&x.value.update0&&x.value.firstEpoch);if(d.value.trigger==='first_epoch_demo_and_keep_increase'&&metrics.length!==1)fail('branch_evidence_unverified','failureDiagnoses','unique original same-sample metrics required');failureDiagnoses.push({runId:role.runId,evidenceRef:d.doc.ref,metricsRef:d.value.trigger==='first_epoch_demo_and_keep_increase'?metrics[0].doc.ref:null});}}
  const rootBinding=this.bindings.get(spec.failedTaskRef),failed=get(spec.failedTaskRef);if(!rootBinding?.datasetDirectory)fail('input_identity_unverified','failedTask','original dataset directory required');const dataset=get(failed.datasetRefs[0]);
  const bindings={specRef:assignment.specRef,receiptRef:assignment.receiptRef,references,inputBindings:[...this.bindings.values()],grant:{...grant,controlRoot:this.root},controlRoot:this.root,rootInstanceId:this.manifest.rootInstanceId,actionTaskRefs,assignmentFiles,datasetManifest:this.boundDocument(join(this.directory(rootBinding.datasetDirectory),'manifest.json'),dataset.manifestSHA256),evidence:[...evidence.values()],calibrationQualifications,failureDiagnoses};
  const context={spec,assignment,receipt,approvedActions,bindings,referenceDigests:references.map(x=>({ref:x.ref,sha256:digest(x.value)}))};freezeJSON(context);this.recoveryContexts.add(context);return context;
 }
 checkBranchAdmission(task:any,state:any,verifiedContext:any){
  if(!verifiedContext||!this.recoveryContexts.has(verifiedContext))fail('branch_evidence_unverified','numericalRecoveryContext','only this fixed host may construct role context');
  strictObject(verifiedContext,'numericalRecoveryContext',['spec','assignment','receipt','approvedActions','bindings','referenceDigests']);
  for(const x of verifiedContext.referenceDigests)if(x.sha256!==x.ref.split(':').at(-1))fail('reference_identity_mismatch','numericalRecoveryContext','fixed metadata digest differs');
  // Synchronous and I/O-free inside TC's original transaction. The supplied
  // state is the current locked ledger, never a separately read state.json.
  const {spec,assignment,receipt,approvedActions,bindings}=verifiedContext;
  if(bindings.calibrationQualifications.some((q:any)=>!q.input||!q.input.samples||Object.keys(q).some(k=>!['receiptRef','input'].includes(k))))fail('branch_evidence_unverified','calibrationQualifications','execution admission requires original full qualification facts, never evidence-only view');
  return verifyNumericalRecoveryRole({task,state,spec,assignment,receipt,approvedActions,bindings});
 }
 private numericalRestart(task:any,entry:any,b:any){
  if(b.numericalRestartReceiptRef===null){if(task.retryReasonRef!==null&&this.resolveRef(task.retryReasonRef).kind==='numerical-restart')fail('branch_evidence_unverified','retryReasonRef','numerical receipt cannot authorize an ordinary baseline retry');if(task.taskKind==='supervised_training'&&task.learnerRecipe.learningRate!==1e-4)fail('branch_evidence_unverified','recipe','numerical restart proof absent');return undefined;}
  const grantReceipt=entry.prerequisiteReceipts.find((x:any)=>x.receiptRef===b.numericalRestartReceiptRef),r=this.resolveRef(b.numericalRestartReceiptRef),n=r.numerical;
  if(!grantReceipt||r.kind!=='numerical-restart'||r.decision!=='met'||!n)fail('branch_evidence_unverified','receipt','original approved numerical prerequisite required');
  if(r.schema==='ohuo-prerequisite-receipt-v2'){const numericalRecoveryContext=this.numericalContext(task,entry,b,r),admission=this.checkBranchAdmission(task,this.checkExistingRoot(),numericalRecoveryContext);if(admission.admitted!==true)fail(admission.branch.reason??'numerical_role_not_admitted','numericalRecoveryContext','original numerical role not admitted');return {numericalRestart:admission.numericalRestart,numericalRecoveryContext};}
  if(r.schema!=='ohuo-prerequisite-receipt-v1')fail('branch_evidence_unverified','receipt.schema','strict legacy v1 or new v2 required');
  strictObject(n,'numerical',['failedTaskId','failedRunId','datasetRef','parentPolicyRef','seed','trigger','inputImplementationReviewRef','metricsRef']);
  if(task.taskKind!=='supervised_training'||task.learnerRecipe.learningRate!==3e-5||task.parentTaskId!==n.failedTaskId||task.retryReasonRef!==b.numericalRestartReceiptRef||task.planScope.branchRef===null||task.allowedBranches.length!==1||task.allowedBranches[0].evidenceRef!==task.retryReasonRef||n.datasetRef!==task.datasetRefs[0]||n.parentPolicyRef!==task.parentPolicyRef||n.seed!==b.seed||!['diagnosed_numerical_divergence','first_epoch_demo_and_keep_increase'].includes(n.trigger))fail('branch_evidence_unverified','branch','fixed parent/data/seed/rule binding differs');
  const diagnosis=this.jsonBytes(this.evidenceBytes(n.inputImplementationReviewRef));
  // Concrete facts from the local implementation diagnosis, not a Task bool.
  if(diagnosis.failedTaskId!==n.failedTaskId||diagnosis.datasetRef!==n.datasetRef||diagnosis.parentPolicyRef!==n.parentPolicyRef||diagnosis.seed!==n.seed||diagnosis.inputsCorrect!==true||diagnosis.implementationCorrect!==true||diagnosis.trigger!==n.trigger)fail('branch_evidence_unverified','diagnosis','input and implementation diagnosis not established');
  if(n.trigger==='first_epoch_demo_and_keep_increase'){
   if(n.metricsRef===null)fail('branch_evidence_unverified','metrics','same-train-set recomputation evidence required');const m=this.jsonBytes(this.evidenceBytes(n.metricsRef));
   if(m.failedTaskId!==n.failedTaskId||m.datasetRef!==n.datasetRef||m.seed!==n.seed||!hash(m.update0?.sampleSetSHA256)||m.update0.sampleSetSHA256!==m.firstEpoch?.sampleSetSHA256||![m.update0.demoCE,m.update0.keepKL,m.firstEpoch.demoCE,m.firstEpoch.keepKL].every(Number.isFinite)||m.firstEpoch.demoCE<=m.update0.demoCE||m.firstEpoch.keepKL<=m.update0.keepKL)fail('branch_evidence_unverified','metrics','original two numerical conditions not met');
  }else if(diagnosis.numericalDivergence!==true)fail('branch_evidence_unverified','diagnosis','diagnosed optimization divergence required');
  const state=this.checkExistingRoot(),failed=state.runs[n.failedRunId];if(!failed||failed.task.taskId!==n.failedTaskId||state.tasks[n.failedTaskId]!==n.failedRunId||!['failed','interrupted'].includes(failed.status)||failed.cleanupConfirmed!==true||failed.task.planRef!==task.planRef||failed.task.budgetRef!==task.budgetRef||failed.task.parentPolicyRef!==n.parentPolicyRef||!equal(failed.task.datasetRefs,[n.datasetRef]))fail('branch_evidence_unverified','parent','original stopped failed run not established');
  const priorBinding=failed&&this.bindings.get(failed.taskRef);if(!priorBinding||priorBinding.seed!==n.seed||failed.task.learnerRecipe?.learningRate!==1e-4)fail('branch_evidence_unverified','parent','original failed task sampling seed and baseline recipe must be fixed');
  const uses=Object.values(state.runs).filter((v:any)=>v.task.runId!==task.runId&&v.task.planRef===task.planRef&&v.task.planScope?.branchRef===task.planScope.branchRef&&v.task.learnerRecipe?.learningRate===3e-5).length;
  if(uses!==0)fail('branch_evidence_unverified','branch','one original numerical restart already used');
  return {verified:true,usesBefore:0,restartFrom:'fixed-parent',evidenceRef:task.retryReasonRef,failedTaskId:n.failedTaskId,datasetRef:n.datasetRef,parentPolicyRef:n.parentPolicyRef,seed:n.seed};
 }
 verifyInputs=async(task:any,refs:Map<string,any>)=>{
  const g=this.readGrant(),entry=this.taskEntry(task,g),b=this.bindings.get(entry.taskRef);if(!b)fail('input_identity_unverified','inputBindings','exact task input binding missing');this.checkExistingRoot();
  const source=refs.get(task.sourceRevision);strictObject(source,'sourceRevision',['baseCommit','files']);if(typeof source.baseCommit!=='string'||!/^[a-f0-9]{40}$/.test(source.baseCommit))fail('input_identity_unverified','sourceRevision','explicit base commit plus actual content SHA required');
  const files=new Map<string,string>();for(const f of array(source.files,'source.files')){strictObject(f,'sourceFile',['path','sha256']);if(files.has(f.path))fail('input_identity_unverified','sourceRevision','duplicate source');this.readFile(f);files.set(f.path,f.sha256);}
  for(const name of ['ai','engine','review'])if(realpathSync(req.resolve('@gd/'+name))!==join(this.repositoryRoot,'packages',name,'src/index.ts'))fail('input_identity_unverified','workspace','actual workspace import resolves outside fixed source tree');
  const needed=[...HOST_SOURCE_FILES,...(task.taskKind==='supervised_training'?TRAINING_SOURCE_FILES:[])];if(needed.some(p=>!files.has(p)))fail('input_identity_unverified','sourceRevision','fixed execution dependency missing from actual source manifest');
  const runtime=refs.get(task.runtimeRef);strictObject(runtime,'runtimeRef',['node','platform','arch','tsx','python']);
  if(runtime.node!==process.version||runtime.platform!==process.platform||runtime.arch!==process.arch||runtime.tsx!==req('tsx/package.json').version)fail('input_identity_unverified','runtimeRef','actual Node/platform/tsx differ');
  if(task.taskKind==='supervised_training'){
   strictObject(runtime.python,'runtime.python',['executablePath','executableSHA256','version','numpyVersion','torchVersion']);const python=this.manifest.pythonPath;
   if(!python||runtime.python.executablePath!==python||!statSync(python).isFile()||sha(readFileSync(realpathSync(python)))!==runtime.python.executableSHA256)fail('input_identity_unverified','python','approved interpreter identity differs');
   const facts=JSON.parse(execFileSync(python,['-c','import json,sys,numpy,torch; print(json.dumps({"version":sys.version.split()[0],"numpyVersion":numpy.__version__,"torchVersion":torch.__version__}))'],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024,env:buildPythonEnvironment()}));
   if(['version','numpyVersion','torchVersion'].some(k=>facts[k]!==runtime.python[k]))fail('input_identity_unverified','python','actual scientific runtime differs');
  }else if(runtime.python!==null)fail('input_identity_unverified','runtime.python','nontraining Python runtime is not applicable');
  const indexBytes=this.readFile(b.sourceIndexFile),index=this.jsonBytes(indexBytes),indexRef=refs.get(task.sourcePlan.sourceIndexRef),split=task.sourcePlan.split==='confirm'?'sealed':task.sourcePlan.split;
  if(indexRef?.schema!=='ohuo-source-index-ref-v1'||indexRef.namespace!==task.sourcePlan.namespace||indexRef.fileSHA256!==sha(indexBytes)||index.version!==1||task.sourcePlan.familyIds.some((id:string)=>index.families?.[id]?.split!==split))fail('input_identity_unverified','sourcePlan','actual source bytes/families/splits differ');
  const cap=refs.get(task.capabilityRef);if(cap.id==='B04.api-probe.v1'&&(b.confirmedRecordRoots.length||b.studentReleaseFiles.length||b.datasetDirectory!==null||b.seed!==null||b.trainingPhase!==null||b.numericalRestartReceiptRef!==null))fail('input_identity_unverified','probeInputBinding','public-only probe inputs required');const studentReleasePaths:any={};for(const s of b.studentReleaseFiles){if(Object.hasOwn(studentReleasePaths,s.ref)||!task.releaseRefs.includes(s.ref))fail('input_identity_unverified','studentReleaseFiles','student reference not fixed or repeated');const release=this.readJSON(s.file),ref=refs.get(s.ref);if(ref?.schema!=='ohuo-student-task-release-v1'||ref.releaseSHA256!==s.file.sha256||ref.policyId!==release.policyId)fail('input_identity_unverified','studentRelease','student file differs');const selection=this.jsonBytes(this.evidenceBytes(release.selection));
   if(selection.schema!=='ohuo-student-selection-v1'||selection.rule!=='section-15-unique-checkpoint'||selection.status!=='selected'||selection.selected?.manifestSHA256!==release.checkpoint?.sha256)fail('input_identity_unverified','studentSelection','actual original selection must bind the acting checkpoint');
   const summary=this.jsonBytes(this.evidenceBytes(selection.summary)),review=this.jsonBytes(this.evidenceBytes(selection.behaviorReview));
   if(summary.schema!=='ohuo-supervised-summary-v1'||summary.plan?.phase!=='formal'||summary.actual?.realTraining!==true||summary.actual.optimizerSteps!==3*summary.plan.Uepoch||review.schema!=='ohuo-distill-behavior-review-v1'||review.taskSHA256!==summary.taskSHA256||!Array.isArray(review.reviews))fail('input_identity_unverified','studentSelection','original complete formal run and behavior review required');
   for(const item of review.reviews)this.evidenceBytes(item.evidence);
   const {selectDistillCheckpoint}=await import('./distill-policy');const actual=selectDistillCheckpoint(summary.selection.allowedCheckpoints,review.reviews);
   if(!equal(actual,(({status,selected,reason,eligible})=>({status,selected,reason,eligible}))(selection)))fail('input_identity_unverified','studentSelection','fixed program selection differs');
   const selectionReceipts=entry.prerequisiteReceipts.filter((p:any)=>this.resolveRef(p.requirementRef).kind==='student-selection');if(selectionReceipts.length!==1)fail('student_completion_unverified','student-selection','one original acting S prerequisite required');const original=selectionReceipts[0],receipt=this.prerequisiteReceipt(original.receiptRef,task,original.requirementRef);this.studentSelectionCompletion(task.planRef,task.planVersion,receipt,s.file,release,selection);
   studentReleasePaths[s.ref]=this.relativePath(s.file.path);}
  if(cap.id==='B07.complete-match.v1'&&(b.confirmedRecordRoots.length||b.datasetDirectory!==null)||task.taskKind!=='supervised_training'&&(b.seed!==null||b.trainingPhase!==null||b.numericalRestartReceiptRef!==null))fail('input_identity_unverified','inputBinding','unexpected input mode');
  const result:any={sourceIdentity:task.sourcePlan.sourceIndexRef,sourceIndexPath:this.relativePath(b.sourceIndexFile.path),confirmedRecordRoots:b.confirmedRecordRoots.map((r:string)=>this.directory(r)),studentReleasePaths};
  if(task.taskKind==='supervised_training'){
   if(b.confirmedRecordRoots.length||b.studentReleaseFiles.length||b.datasetDirectory===null||!integer(b.seed)||!['calibration','formal'].includes(b.trainingPhase))fail('input_identity_unverified','supervised','explicit finite training input required');
   const datasetRef=refs.get(task.datasetRefs[0]);if(task.datasetRefs.length!==1||datasetRef?.schema!=='ohuo-frozen-dataset-ref-v1')fail('input_identity_unverified','dataset','frozen dataset reference required');
   const {loadFrozenDataset}=await import('./distill-data');result.datasetDirectory=this.directory(b.datasetDirectory);loadFrozenDataset({directory:result.datasetDirectory,manifestSHA256:datasetRef.manifestSHA256},{requireTrainingEligible:true});
   result.seed=b.seed;result.trainingPhase=b.trainingPhase;const numerical=this.numericalRestart(task,entry,b);result.numericalRestart=numerical?.numericalRestart??numerical;if(numerical?.numericalRecoveryContext)result.numericalRecoveryContext=numerical.numericalRecoveryContext;result.calibrationQualification=this.verifyCalibrationPrerequisite(task,entry,b,this.checkExistingRoot(),result.numericalRestart);
  }else if(b.datasetDirectory!==null)fail('input_identity_unverified','datasetDirectory','not applicable to fixed match/label producer');
  if(cap.id==='B04.api-probe.v1')this.probeInputs(task,refs,result);
  if(cap.id==='B07.offline-label.v1')await this.offlineSelectionInputs(task,refs,result);
  return result;
 };
 profilePath(){
  if(this.manifest.profileStorePath===null)return null;
  const path=this.relativePath(this.manifest.profileStorePath),st=lstatSync(path);
  // Metadata only: reject symlink ancestors/escape and permissions before B03
  // ever reads credentials. Do not load the private bytes during host validation.
  if(!st.isFile()||st.isSymbolicLink()||realpathSync(path)!==path||(st.mode&0o777)!==0o600)fail('invalid_host_file','profileStorePath','private in-repo nonsymlink regular profile store required');
  return path;
 }
}
/** Fixed D CLI resolver. Never imports code or a repository path from spec. */
export async function createOfflineSelectionHostInputs(spec:any,options:any){
 strictObject(options,'offlineSelectionCLIOptions',['phase','outputDir']);if(options.phase!=='freeze')fail('unsupported_value','phase','fixed CLI freeze only');
 const repositoryRoot=resolve(fileURLToPath(new URL('../../',import.meta.url)));return new FixedHostFiles(repositoryRoot).offlineSelectionHostInputs(spec,options);
}
/** Fixed original B09 API adapter, not a new CLI or selection authority. The
 * original freezeDataset reader re-verifies the complete proof before rows. */
export async function createOfflineSelectionDatasetProof(selectionRef:string){
 fixedReference(selectionRef,'selectionRef');const repositoryRoot=resolve(fileURLToPath(new URL('../../',import.meta.url))),host=new FixedHostFiles(repositoryRoot),selection=host.resolveRef(selectionRef);
 if(selection.schema!=='ohuo-offline-label-selection-v2')fail('selection_production_required','selectionRef','original full v2 selection required');const production=host.resolveRef(selection.productionRef);if(production.schema!=='ohuo-offline-selection-production-v1')fail('selection_production_required','productionRef','original exact production required');
 const spec=host.resolveRef(production.specRef),resolvedInputs=await host.offlineSelectionHostInputs(spec,{phase:'dataset'});return {selection,production,resolvedInputs};
}
// Fixed execution source closure from reviewed B07/L/B09 contracts. Contains no
// weights or user data. Additional B10 files are required only for that consumer.
export const HOST_SOURCE_FILES:string[]=[
 // Transitive fixed imports/configuration are identity-bound, not merely entrypoints.
 "packages/review/src/actionIdentity.ts",
 "packages/review/src/analyzer.ts",
 "packages/review/src/coach.ts",
 "packages/review/src/coachJson.ts",
 "packages/review/src/counterfactual.ts",
 "packages/review/src/decisionFacts.ts",
 "packages/review/src/decisionReview.ts",
 "packages/review/src/describeAction.ts",
 "packages/review/src/infoset.ts",
 "packages/review/src/knowledge.ts",
 "packages/review/src/nnAdvisor.ts",
 "packages/review/src/replay.ts",
 "packages/review/src/replayStatus.ts",
 "packages/review/src/reviewHeuristic.ts",
 "packages/review/src/seatDisplay.ts",
 "packages/review/src/teach.ts",
 "packages/review/src/teamContext.ts",
 "packages/review/src/teamReview.ts",
 "packages/web/server/llm-stream.mjs",
 "tsconfig.base.json",
 "tsconfig.json",
 "lab/model-index.json",
 "lab/review6_2/api-probe-consumer.ts",
 "lab/review6_2/offline-selection.ts",
 "lab/review6_2/numerical-recovery.ts",
 "lab/review6_2/python-environment.ts",
 "lab/review6/action-effect.ts",
 "lab/review6/capability-lineage.ts",
 "lab/review6/data-provenance.ts",
 "lab/review6/data-replay.ts",
 "lab/review6/exact-inference.ts",
 "lab/review6/match-play.ts",
 "lab/review6/owned-process-group.mjs",
 "lab/review6/plan-dsl.ts",
 "lab/review6/product-artifacts.ts",
 "lab/review6/training-ancestry.ts",
 "lab/review6_2/distill-data.ts",
 "lab/review6_2/distill-policy.ts",
 "lab/review6_2/match-consumer.ts",
 "lab/review6_2/match-local-worker.ts",
 "lab/review6_2/match-play-async.ts",
 "lab/review6_2/match-record.ts",
 "lab/review6_2/offline-label-consumer.ts",
 "lab/review6_2/offline-label-source.ts",
 "lab/review6_2/ohuo-host-files.ts",
 "lab/review6_2/ohuo-host.ts",
 "lab/review6_2/policy-loader.ts",
 "lab/review6_2/task-consumer.mjs",
 "lab/review6_2/task-control.mjs",
 "lab/review6_2/task-schema.mjs",
 "lab/review6_2/teacher-snapshot.ts",
 "lab/review6_2/writer-lock.ts",
 "lab/src/review5_tuning/kscbReplay.ts",
 "package-lock.json",
 "package.json",
 "packages/ai/package.json",
 "packages/ai/src/heuristic.ts",
 "packages/ai/src/hybrid/candidates.ts",
 "packages/ai/src/hybrid/decide.ts",
 "packages/ai/src/hybrid/legality.ts",
 "packages/ai/src/hybrid/observation.ts",
 "packages/ai/src/hybrid/protocol.ts",
 "packages/ai/src/hybrid/remote-selector.ts",
 "packages/ai/src/hybrid/student.ts",
 "packages/ai/src/index.ts",
 "packages/ai/src/legal.ts",
 "packages/ai/src/memory.ts",
 "packages/ai/src/nn/mlp.ts",
 "packages/ai/src/nn/neuralSeat.ts",
 "packages/ai/src/nn/nnplayer.ts",
 "packages/ai/src/nn/observationAudit.ts",
 "packages/ai/src/nn/schema.ts",
 "packages/ai/src/nn/tiered.ts",
 "packages/ai/src/nn/wave.ts",
 "packages/ai/src/planner.ts",
 "packages/ai/src/player.ts",
 "packages/ai/src/policy/descriptor.ts",
 "packages/ai/src/policy/releases.json",
 "packages/ai/src/policy/resolve.ts",
 "packages/ai/src/policy/seats.ts",
 "packages/ai/src/sim.ts",
 "packages/ai/src/types.ts",
 "packages/engine/package.json",
 "packages/engine/src/combo.ts",
 "packages/engine/src/deck.ts",
 "packages/engine/src/game.ts",
 "packages/engine/src/index.ts",
 "packages/engine/src/rank.ts",
 "packages/engine/src/record.ts",
 "packages/engine/src/rng.ts",
 "packages/engine/src/types.ts",
 "packages/review/package.json",
 "packages/review/src/index.ts",
 "packages/web/server/llm-profiles.mjs",
 "packages/web/server/llm-select.mjs",
 "packages/web/server/llm-selection-wire.mjs"
];
export const TRAINING_SOURCE_FILES=['lab/review6_2/distill-consumer.ts','lab/review6_2/distill-policy.ts','lab/review6_2/distill_checkpoint.py','lab/review6_2/distill_learner.py','packages/ai/src/hybrid/student.ts','lab/review6/training_core.py','lab/review6/human_proxy.py'];
