import {verifyDesignedProtocolLineage} from './designed-protocol-lineage.mjs';
import {verifyDesignedFamilyReservationLink} from './designed-family-reservation';
import {isDesignedSourceCheckpoint,verifyDesignedSourceInputs} from './designed-source-consumer';
import {assertScreenRevalidationContext} from './screen-revalidation.mjs';
import {PROJECT_RULES_TEACHER_PROMPT_SCHEMA,validateProjectRulesPrompt,assertProjectRuleOptions} from '../../packages/web/server/llm-project-rules-v541.mjs';
import {DESIGNED_SELECTION_SPEC_SCHEMA,DESIGNED_SELECTION_RULE_SCHEMA,createDesignedSelectionSession,readDesignedSelectionHistory,readUsedCommonSelectionRows,readUsedCommonSelectionRowsAtCommit,verifyDesignedSourceIndexSuccessor,verifyOfflineSelection,verifyCommonViewRoundAdmission,verifyTrainCoverageRevision,withCoverageEligibilityScope,createCommonViewRoundProofSession} from './offline-selection';
import {knownUnsentWorldPreparationFailure} from './first-round-prequery-failure.mjs';
import {COMMON_VIEW_SYSTEM_PROMPT_SHA256} from '../../packages/web/server/llm-selection-wire.mjs';
import {commonViewProtocol,verifyCommonViewProtocol,inputWorkloadForQueue} from './first-round-protocol.mjs';
import {verifySourceActionInventory} from './first-round-source-action-scope.mjs';
import {freezeFirstRoundBudget,prepareFirstRoundBudgetAllocation,verifyFirstRoundBudgetAllocation,readFirstRoundAllocation,firstRoundStageRemaining} from './first-round-budget.mjs';
import {checkFirstRoundPilotAdmission as verifyFirstRoundPilotAdmission,checkFirstRoundPilotHistory as verifyFirstRoundPilotHistory} from './first-round-pilot';
import {prepareBlindReviewProjection,checkFirstRoundBlindReviewAdmission} from './first-round-blind-review';
import {validateFirstRoundParentEnvelope,validateFirstRoundDatasetMetadata} from './first-round-parent';
import {verifyStudentFinalizationFacts,selectDistillCheckpoint} from './distill-policy';
import {resolveCandidateReleaseRef} from '../../packages/ai/src/policy/candidate-release';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {isFirstRoundRecipe,isFirstRoundR2Recipe,isFirstRoundR2DatasetPlan,firstRoundTrainingShape,firstRoundRecoveryTriggerAllowed} from './first-round-contract.mjs';
/** Explicit local production data adapter. No Task-supplied code, network,
 * credentials, model reads, or implicit zero ledger. See frozen M0-H card. */
import {readFileSync,writeFileSync,lstatSync,statSync,realpathSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,relative,join,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {fail,strictObject,fixedReference,validateIdentifier,validateSourceFamily,validateLimits,validateWorkloadLimits,isWorkloadLimits,isScientificObservationLimits,validateResourcePolicy,validateTask,digest,canonical,taskReferences} from './task-schema.mjs';
import {acquireSourceWriter} from './writer-lock';
import {buildPythonEnvironment} from './python-environment';
import {buildCalibrationQualification,verifyNumericalRecoveryRole} from './numerical-recovery';
import {verifyProbeSnapshots} from './api-probe-consumer';
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const req=createRequire(import.meta.url);
const KINDS=['probe','collect','evaluate','supervised_training'],CAPS=['B04.api-probe.v1','B07.complete-match.v1','B07.offline-label.v1','B07.designed-source.v1','B10.supervised-rerank.v1'];
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
 private verifiedSourceOwner:string|null=null;
 private verifiedSourceFiles=new Map<string,{signal:string,sha256:string}>();
 #selectionReproductionSession:object|null=null;
 #roundProofSession:object|null=null;
 #roundProofOwner:string|null=null;
 private roundProofSessionFor(task:any):object|undefined{
  if(this.resolveRef(task.capabilityRef)?.id!=='B07.offline-label.v1')return undefined;
  const owner=digest(task);if(this.#roundProofOwner!==null&&this.#roundProofOwner!==owner)return undefined;
  if(!this.#roundProofSession){const references=new Map<string,any>();for(const [ref]of this.references)references.set(ref,this.resolveRef(ref));this.#roundProofSession=createCommonViewRoundProofSession(task,{references,evidenceFiles:new Map(this.evidence)});this.#roundProofOwner=owner;}
  return this.#roundProofSession;
 }
 #cumulativeDatasetHistory:any=null;
 #designedProtocolHistory:any=null;
 private pilotContexts=new WeakSet<object>();private recoveryContexts=new WeakSet<object>();private probeContexts=new WeakSet<object>();private selectionContexts=new WeakSet<object>();
 constructor(readonly repositoryRoot:string,readonly screenRevalidation:any=null){
  if(realpathSync(repositoryRoot)!==repositoryRoot)fail('invalid_host_path','repositoryRoot','real repository required');
  const path=join(repositoryRoot,'deliverables/ohuo-runtime/host.json');if(!existsSync(path))fail('fixed_host_missing','host.json','fixed local host configuration is absent');
  this.manifest=screenRevalidation?structuredClone(screenRevalidation.manifest):this.jsonBytes(this.regular(path,true));const m=this.manifest;
  if(!['ohuo-fixed-host-v1','ohuo-fixed-host-v2'].includes(m.schema))fail('unsupported_host_schema','schema','fixed host v1 or v2 required');
  strictObject(m,'host',['schema','controlRoot','rootInstanceId','initialStateRef','references','evidenceFiles','grantFile','planCloseoutFile','inputBindings','profileStorePath','pythonPath',...(m.schema==='ohuo-fixed-host-v2'?['numericalRecoveryAssignments']:[])]);
  if(m.schema==='ohuo-fixed-host-v2'){const paths=new Set();for(const f of array(m.numericalRecoveryAssignments,'numericalRecoveryAssignments')){this.fileShape(f);if(paths.has(f.path))fail('duplicate_reference','numericalRecoveryAssignments','assignment file repeated');paths.add(f.path);}}
  validateIdentifier(m.rootInstanceId,'rootInstanceId');fixedReference(m.initialStateRef,'initialStateRef');
  this.root=this.directory(m.controlRoot);if(screenRevalidation)assertScreenRevalidationContext(screenRevalidation,screenRevalidation.task,this.root);if(!relative(join(repositoryRoot,'lab/out'),this.root)||relative(join(repositoryRoot,'lab/out'),this.root).startsWith('..'))fail('invalid_output_root','controlRoot','existing control root below lab/out required');
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
 private fixedSourceSignal(path:string){const st=lstatSync(path,{bigint:true});if(!st.isFile()||st.isSymbolicLink()||realpathSync(path)!==path||st.size>32n*1024n*1024n)fail('invalid_host_file','path','bounded regular nonsymlink file with required privacy mode');return [st.dev,st.ino,st.mode,st.size,st.mtimeNs,st.ctimeNs].join(':');}
 private verifyFixedSourceFile(f:any,owner:string){
  this.fileShape(f);if(this.verifiedSourceOwner!==owner){this.verifiedSourceOwner=owner;this.verifiedSourceFiles=new Map();}
  const path=this.relativePath(f.path),signal=this.fixedSourceSignal(path),prior=this.verifiedSourceFiles.get(path);
  if(prior?.signal===signal&&prior.sha256===f.sha256)return;
  this.verifiedSourceFiles.delete(path);this.readFile(f);this.verifiedSourceFiles.set(path,{signal,sha256:f.sha256});
 }
 private jsonBytes(b:Buffer){try{return JSON.parse(b.toString('utf8'));}catch{fail('invalid_host_json','file','valid JSON required');}}
 private fileShape(f:any){strictObject(f,'fileRef',['path','sha256']);this.relativePath(f.path);if(!hash(f.sha256))fail('invalid_reference','fileRef.sha256','bytes SHA required');}
 directory(p:string){const full=this.relativePath(p);if(!lstatSync(full).isDirectory()||realpathSync(full)!==full)fail('invalid_host_path','directory','existing real directory required');return full;}
 readFile(f:any,privateFile=false){this.fileShape(f);const bytes=this.regular(this.relativePath(f.path),privateFile);if(sha(bytes)!==f.sha256)fail('reference_identity_mismatch',f.path,'frozen file bytes changed');return bytes;}
 readJSON(f:any,privateFile=false){return this.jsonBytes(this.readFile(f,privateFile));}
 resolveRef=(ref:string)=>{fixedReference(ref,'reference');if(this.screenRevalidation&&ref===this.screenRevalidation.sourceRef)return structuredClone(this.screenRevalidation.source);const f=this.references.get(ref);if(!f)fail('reference_unavailable',ref,'reference not in fixed host catalog');const value=this.readJSON(f);if(digest(value)!==ref.slice(ref.lastIndexOf(':')+1))fail('reference_identity_mismatch',ref,'canonical JSON digest differs');return value;};
 evidenceBytes(ref:any){strictObject(ref,'evidenceRef',['id','sha256']);const f=this.evidence.get(ref.id);if(!f||f.sha256!==ref.sha256)fail('evidence_unavailable','evidenceRef','fixed artifact mapping unavailable');return this.readFile(f);}
 private evidenceList(refs:any){for(const ref of array(refs,'evidence_refs'))this.evidenceBytes(ref);}
 private taskEntry(task:any,g:any){const matches=g.tasks.filter((t:any)=>t.taskRef.endsWith('@sha256:'+digest(task)));if(matches.length!==1)fail('authorization_unverified','taskRef','exact TaskFile not independently granted');return matches[0];}
 readGrant(){
  const g=this.readJSON(this.manifest.grantFile,true);
  strictObject(g,'grant',['schema','authorizationRef','planRef','planVersion','controlRoot','rootInstanceId','initialStateRef','initialization','mode','allowedTaskKinds','allowedCapabilityIds','scope','limits','tasks','approvalEvidence',...(g.schema==='ohuo-local-research-grant-v2'?['resourcePolicyRef']:[])]);
  if(!['ohuo-local-research-grant-v1','ohuo-local-research-grant-v2'].includes(g.schema)||g.mode!=='research'||g.controlRoot!==this.manifest.controlRoot||g.rootInstanceId!==this.manifest.rootInstanceId||g.initialStateRef!==this.manifest.initialStateRef||!integer(g.planVersion,1)||!['new-control-root','existing-control-root'].includes(g.initialization))fail('authorization_unverified','grant','fixed local original approval binding required');
  for(const k of ['authorizationRef','planRef','initialStateRef'])fixedReference(g[k],k);scope(g.scope);validateLimits(g.limits);
  if(strings(g.allowedTaskKinds,'allowedTaskKinds').some((k:string)=>!KINDS.includes(k))||strings(g.allowedCapabilityIds,'allowedCapabilityIds').some((k:string)=>!CAPS.includes(k)))fail('authorization_unverified','grant','unsupported capability scope');
  const seen=new Set();for(const t of array(g.tasks,'tasks')){strictObject(t,'taskGrant',['taskRef','prerequisiteReceipts']);fixedReference(t.taskRef,'taskRef');if(seen.has(t.taskRef))fail('duplicate_reference','taskGrant','duplicate task');seen.add(t.taskRef);const requirements=new Set();for(const p of array(t.prerequisiteReceipts,'prerequisiteReceipts')){strictObject(p,'prerequisite',['requirementRef','receiptRef']);fixedReference(p.requirementRef,'requirementRef');fixedReference(p.receiptRef,'receiptRef');if(requirements.has(p.requirementRef))fail('duplicate_reference','prerequisite','duplicate requirement');requirements.add(p.requirementRef);}}
  // This is an independently materialized approval record, not a permission
  // minted by this program. Tool/OS/user authority remains independently needed.
  this.readFile(g.approvalEvidence,true);this.resolveRef(g.authorizationRef);this.resolveRef(g.planRef);if(g.schema==='ohuo-local-research-grant-v2'){fixedReference(g.resourcePolicyRef,'resourcePolicyRef');validateResourcePolicy({ref:g.resourcePolicyRef,value:this.resolveRef(g.resourcePolicyRef)});}return g;
 }
 checkAuthorization=async(task:any)=>{
  const g=this.readGrant(),c=this.resolveRef(task.capabilityRef);strictObject(c,'capability',['id','kind','mode']);this.taskEntry(task,g);
  if(task.authorizationRef!==g.authorizationRef||task.planRef!==g.planRef||task.planVersion!==g.planVersion||!g.allowedTaskKinds.includes(task.taskKind)||!g.allowedCapabilityIds.includes(c.id)||c.kind!==task.taskKind||c.mode!=='research')fail('authorization_unverified','task','task/plan/kind binding differs');
  for(const k of Object.keys(task.operationScope))if(task.operationScope[k]&&!g.scope[k])fail('scope_not_authorized',k,'operation outside independent grant');
  const budget=this.resolveRef(task.budgetRef);if(budget.authorizationRef!==g.authorizationRef||budget.planRef!==g.planRef||budget.controlRoot!==this.root)fail('budget_binding_conflict','budgetRef','original root/authorization/plan required');
  const protocol=this.commonViewTaskProtocol(task,g);validateLimits(budget.limits);
  if(protocol)validateWorkloadLimits(task.limits);else{validateLimits(task.limits);for(const k of Object.keys(g.limits))if(task.limits[k]>g.limits[k]||budget.limits[k]>g.limits[k])fail('scope_not_authorized',k,'task/shared budget exceeds grant');}
  return {authorizationRef:g.authorizationRef,controlRoot:this.root,scope:g.scope,mode:'research',...(protocol?{resourcePolicy:protocol.policy}:{})};
 };
 /** A revised method is a canonical, approved business entity on the same
  * original ledger. A Task flag alone never retires the legacy limits. */
 commonViewTaskProtocol(task:any,grant:any=this.readGrant()){
  const ref=task.scientificContract?.analysisMethodRef??task.protocolRevisionRef;if(!ref)return null;
  const value=this.resolveRef(ref);if(!commonViewProtocol(value)){if(isWorkloadLimits(task.limits))fail('protocol_identity_unverified','analysisMethodRef','workload mode requires the approved common-view protocol');return null;}
  if(grant.schema!=='ohuo-local-research-grant-v2'||task.planRef!==value.planRef||task.planVersion!==value.planVersion||task.budgetRef!==undefined&&task.budgetRef!==value.budgetRef)fail('protocol_identity_unverified','grant','exact revised authorization required');
  let policy={ref:grant.resourcePolicyRef,value:this.resolveRef(grant.resourcePolicyRef)};if(policy.value.controlRoot!==this.root)fail('resource_policy_conflict','controlRoot','same actual original control root required');const state=this.checkExistingRoot(),plan=this.resolveRef(value.planRef);
  if(policy.value.protocolRevisionRef!==ref){
   const history=this.#designedProtocolHistory,currentRef=policy.value.protocolRevisionRef;
   if(!history||ref!==history.previousProtocolRef||currentRef!==history.currentProtocolRef||!history.allowedActionKeys.includes(canonical([task.planScope?.clauseRef,task.planScope?.branchRef])))fail('protocol_identity_unverified','historicalProtocol','old protocol is read only inside the original complete augmentation-history preparation');
   if(task.taskId!==undefined){const run=state.runs?.[task.runId];if(!run||run.taskSHA256!==digest(task)||!equal(run.task,task)||!equal(this.resolveRef(run.taskRef),task)||state.tasks[task.taskId]!==task.runId)fail('state_history_conflict','historicalProtocol','only the actual existing immutable old Task may be audited');}
   const references=new Map<string,any>();for(const [r]of this.references)references.set(r,this.resolveRef(r));const lineage=verifyDesignedProtocolLineage({currentProtocolRef:currentRef,previousProtocolRef:ref,references});
   verifyCommonViewProtocol({ref:currentRef,value:references.get(currentRef),policy,grant,plan,state,readEvidence:(f:any)=>this.evidenceBytes(f),readReference:(r:string)=>this.resolveRef(r)});
   policy={ref:lineage.previousResourcePolicyRef,value:this.resolveRef(lineage.previousResourcePolicyRef)};if(policy.value.controlRoot!==this.root)fail('resource_policy_conflict','historicalProtocol','the actual old policy must bind the same root');
  }
  return verifyCommonViewProtocol({ref,value,policy,grant,plan,state,readEvidence:(f:any)=>this.evidenceBytes(f),readReference:(r:string)=>this.resolveRef(r)});
 }
 /** Called only by original TC inside its existing state writer transaction.
  * Pure protocol compatibility is not authority: current grant, original Task,
  * prerequisites and current closeout remain independently verified here. */
 checkResourcePolicyContinuation(task:any,state:any,current:any,next:any){
  if(this.screenRevalidation)fail('resource_policy_conflict','continuation','historical screen verification cannot advance research policy');
  const grant=this.readGrant(),entry=this.taskEntry(task,grant),protocol=this.commonViewTaskProtocol(task,grant),budget=this.resolveRef(task.budgetRef);
  this.assertDesignedLedger(state,task);validateResourcePolicy(current);validateResourcePolicy(next);
  if(!protocol||next.ref!==grant.resourcePolicyRef||!equal(next,protocol.policy)||!equal(this.resolveRef(current.ref),current.value)||!equal(this.resolveRef(next.ref),next.value)||task.authorizationRef!==grant.authorizationRef||task.planRef!==grant.planRef||task.planVersion!==grant.planVersion||budget.authorizationRef!==grant.authorizationRef||budget.controlRoot!==this.root||state.tasks[task.taskId]!==undefined||state.runs[task.runId]!==undefined||entry.taskRef.split(':').at(-1)!==digest(task))fail('resource_policy_conflict','continuation','exact new authorized Task, actual current policy and original ledger required');
  for(const run of Object.values(state.runs) as any[]){if(run.task?.budgetRef!==task.budgetRef)continue;if(knownUnsentWorldPreparationFailure(run,state,this.root,(ref:string)=>this.resolveRef(ref)))continue;
   if(['preparing','running','stopping'].includes(run.status)||run.cleanupConfirmed===false||run.executionUnknown===true||run.observationStatus==='unknown'||run.stopReason==='execution_uncertain'||run.failureReason==='execution_uncertain'||run.checkpoint?.executionUnknown===true||run.checkpoint?.active!=null||(run.checkpoint?.rows??[]).some((row:any)=>row.requestCount===null))fail('execution_uncertain','continuation','original unresolved work cannot be bypassed by a policy revision');
  }
  const references=new Map<string,any>();for(const [ref]of this.references)references.set(ref,this.resolveRef(ref));const lineage=verifyDesignedProtocolLineage({currentProtocolRef:next.value.protocolRevisionRef,previousProtocolRef:current.value.protocolRevisionRef,references});
  if(protocol.value.originalMethods.previousProtocolRef!==current.value.protocolRevisionRef||protocol.value.originalMethods.previousResourcePolicyRef!==current.ref||lineage.previousResourcePolicyRef!==current.ref||['planRef','budgetRef','authorizationRef','controlRoot','mode'].some(k=>current.value[k]!==next.value[k]))fail('resource_policy_conflict','continuation','exact immediate ledger policy and unchanged original accounting scope required');
  const action=this.readApprovedAction(task).action,closeout=this.readCloseout(),prior=this.priorPlanObservation(task,closeout,state);
  if(closeout.entity.status!=='incomplete'||prior&&['completed','terminated'].includes(prior.status))fail('plan_closed','continuation','the original plan must still permit this new work');
  this.prerequisites(task,grant,action);this.assertActionTaskLineage(task,action,state);return true;
 }
 readCloseout(){
  const pointer=this.screenRevalidation?structuredClone(this.screenRevalidation.pointer):this.jsonBytes(this.regular(this.relativePath(this.manifest.planCloseoutFile)));
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
 /** Same-pool continuation proof is parsed before action lookup. It uses only
  * the original immutable catalog/root, never a Task-supplied prior list or a
  * recursive call to readApprovedAction/offlineSelectionHostInputs. */
 private commonViewRoundProof(spec:any,state:any=this.checkExistingRoot()){
  if(spec?.schema!=='ohuo-offline-selection-spec-common-view-round-r2')return null;
  const references=new Map<string,any>();for(const [ref] of this.references)references.set(ref,this.resolveRef(ref));
  const index=references.get(spec.sourceIndexRef),files=[...this.bindings.values()].filter((b:any)=>{const t=references.get(b.taskRef);return t?.planRef===spec.planRef&&t.sourcePlan?.sourceIndexRef===spec.sourceIndexRef&&b.sourceIndexFile.sha256===index?.fileSHA256;}).map((b:any)=>b.sourceIndexFile),unique=[...new Map(files.map((f:any)=>[canonical(f),f])).values()] as any[];
  if(unique.length!==1)fail('input_identity_unverified','roundSourceIndex','same unique original source index required');this.readFile(unique[0]);
  const proof=verifyCommonViewRoundAdmission(spec,{repositoryRoot:this.repositoryRoot,controlRoot:this.root,references,evidenceFiles:new Map(this.evidence),sourceIndexPath:this.relativePath(unique[0].path),confirmedRecordRoots:[],mode:'research',phase:'dataset'},state);
  return {contract:proof.contract,roundContracts:proof.roundContracts,poolRef:proof.poolRef,pool:proof.pool,round:proof.round,parentSelectionRef:proof.parentSelectionRef,priorSelectionRefs:proof.priorSelectionRefs,usedRows:proof.usedRows,historyStateSHA256:this.commonViewRoundStateIdentity(proof,state)};
 }
 private commonViewRoundStateIdentity(proof:any,state:any){
  const prior=new Set(proof.priorSelectionRefs),pool=proof.pool,runs=(Object.values(state.runs??{}) as any[]).filter((run:any)=>{const t=run.task;return t?.planRef===pool.planRef&&t.budgetRef===pool.budgetRef&&(t.datasetRefs?.some((ref:string)=>prior.has(ref))||!t.datasetRefs?.length&&t.sourcePlan?.sourceIndexRef===pool.sourceIndexRef&&t.seatLayoutPlan===pool.queueRef);}).sort((a:any,b:any)=>a.runId.localeCompare(b.runId)),ids=new Set(runs.map((run:any)=>run.runId)),ledger=state.budgets?.[pool.budgetRef];
  return digest({runs:runs.map((run:any)=>({run,taskRunId:state.tasks?.[run.task.taskId]??null})),ledger:ledger?{activePredecessorRunId:ids.has(ledger.activeRunId)?ledger.activeRunId:null,reservations:ledger.reservations&&typeof ledger.reservations==='object'&&!Array.isArray(ledger.reservations)?Object.entries(ledger.reservations).filter(([,r]:any)=>ids.has(r.runId)).sort(([a],[b])=>a.localeCompare(b)):null}:null});
 }
 private assertCommonViewRoundState(context:any,state:any){const proof=context.roundAdmission;if(proof&&proof.historyStateSHA256!==this.commonViewRoundStateIdentity(proof,state))fail('selection_execution_uncertain','roundHistory','verified predecessor run/checkpoint/occupancy changed before locked admission');}
 /** Only explicit next-representative teacher/screen roots are appended. All
  * original IDs/rules/dependencies and the registered TC policy remain intact. */
 private commonViewRoundActions(protocol:any){
  const actions=structuredClone(protocol.value.actions),state=this.checkExistingRoot(),contracts=new Map<string,any>();
  const specs=[...this.references].map(([ref])=>({ref,value:this.resolveRef(ref)})).filter(({value:s})=>s?.schema==='ohuo-offline-selection-spec-common-view-round-r2'&&s.planRef===protocol.value.planRef&&this.resolveRef(s.selectionRuleRef).protocolRef===protocol.ref);
  const historical=this.#designedProtocolHistory?.previousProtocolRef===protocol.ref?this.#designedProtocolHistory:null;
  if(historical){
   // Only a read-only dataset audit gets these already verified committed
   // contracts. It does not re-run an unrelated later-round export mapper or
   // grant a new execution; original role naming below remains unchanged.
   for(const row of historical.roundContracts){const contract=this.resolveRef(row.roundContractRef);if(!equal(contract,row.contract))fail('state_history_conflict','historicalRound','the original committed round contract changed');contracts.set(row.roundContractRef,contract);}
  }else for(const {value:spec}of specs){const proof=this.commonViewRoundProof(spec,state);for(const row of proof!.roundContracts){const prior=contracts.get(row.roundContractRef);if(prior&&!equal(prior,row.contract))fail('state_history_conflict','roundContract','immutable round identity changed');contracts.set(row.roundContractRef,row.contract);}}
  const seen=new Set(actions.flatMap((a:any)=>a.plannedTaskIds));
  for(const [roundRef,contract]of [...contracts].sort((a,b)=>a[1].round-b[1].round||a[0].localeCompare(b[0]))){
   for(const role of contract.plannedTasks){const purpose=role.role==='primary-teacher'?'data-glm':'data-screen',found=actions.filter((a:any)=>this.resolveRef(a.acceptanceRuleRef)?.purpose===purpose);if(found.length!==1)fail('original_action_conflict','roundTaskRole','one original teacher/screen action required');
    const original=protocol.value.actions.find((a:any)=>a.clauseRef===found[0].clauseRef&&a.branchRef===found[0].branchRef),bases=original.plannedTaskIds.filter((id:string)=>id.endsWith('-'+role.split));
    if(bases.length!==1||role.taskId!==bases[0]+'-round-'+contract.round||seen.has(role.taskId))fail('original_action_conflict','roundTaskId','only the exact frozen next-round role ID may extend the original action');seen.add(role.taskId);found[0].plannedTaskIds.push(role.taskId);
   }
  }return actions;
 }
 private assertCommonViewRoundTask(task:any,context:any,state:any){
  const proof=context.roundAdmission;if(!proof)return;
  const decision=this.resolveRef(task.scientificContract.decisionRuleRef),screen=decision.schema==='ohuo-common-view-screen-contract-r2',role=proof.contract.plannedTasks.find((r:any)=>r.split===task.sourcePlan.split&&r.role===(screen?'screen':'primary-teacher'));
  if(task.scientificContract.analysisMethodRef!==proof.contract.protocolRef||task.sourcePlan.sourceIndexRef!==proof.pool.sourceIndexRef||task.seatLayoutPlan!==proof.pool.queueRef||!equal(task.datasetRefs,[context.selectionRef]))fail('selection_task_binding','roundTask','same frozen round role, selection and original source required');
  if(!screen&&context.routing?.role==='independent-review')this.verifyRoundTwoIndependentDiagnosis(task,context,state,decision);
  else{if(!role||!screen&&context.routing?.role!=='primary')fail('selection_task_binding','roundTask','same frozen primary or screen role required');
  if(task.taskId===role.taskId){if(task.parentTaskId!==null||task.retryReasonRef!==null)fail('selection_task_binding','roundTask','a newly planned independent round is not a retry of completed work');}
  else{const actions=this.resolveRef(proof.contract.protocolRef).actions,found=actions.filter((a:any)=>a.clauseRef===task.planScope.clauseRef&&a.branchRef===task.planScope.branchRef);if(found.length!==1)fail('original_action_conflict','roundTask','same original action required');this.assertActionTaskLineage(task,{...found[0],plannedTaskIds:[role.taskId]},state);}}
  const keys=new Set(context.selection.rows.map((r:any)=>canonical(r.key)));if(proof.usedRows.some((r:any)=>keys.has(canonical(r.key))))fail('selection_owned_rows_already_exposed','roundTask','a new round must be disjoint from every previously frozen row');
 }
 /** One reviewed independent opinion, never a replacement training label. */
 private verifyRoundTwoIndependentDiagnosis(task:any,context:any,state:any,decision:any){
  const proof=context.roundAdmission,route=context.routing,protocol=this.resolveRef(proof.contract.protocolRef),selected=route?.selected;
  const namedKey={controllerOrRunnerGeneration:'r1-data-source-train-resume-9459',matchId:'formal-r2-g2-s0-B-prime',gameNo:6,moveNo:17,actorSeat:0,requestSeq:500},inputSHA='b51cfc2352bca35148d00b2b7096f7aae860dace02380eb767fb3871ffc4b3fc';
  const actions=protocol.actions.filter((a:any)=>a.clauseRef===task.planScope.clauseRef&&a.branchRef===task.planScope.branchRef);
  if(task.taskId!=='r1-data-ds-train'||task.runId!==task.taskId||task.parentTaskId!==null||task.retryReasonRef!==null||task.sourcePlan.split!=='train'||proof.round!==2||proof.contract.round!==2||actions.length!==1||!actions[0].plannedTaskIds.includes(task.taskId)||this.resolveRef(actions[0].acceptanceRuleRef)?.purpose!=='data-ds'||task.labelPolicyRef!==protocol.originalMethods.independentTeacherRef||route.schema!=='ohuo-common-view-teacher-routing-r2'||route.protocolRef!==proof.contract.protocolRef||route.role!=='independent-review'||route.primaryLabelPolicyRef!==protocol.originalMethods.primaryTeacherRef||!Array.isArray(selected)||selected.length!==1||!equal(selected[0].key,namedKey)||selected[0].inputSHA256!==inputSHA||selected[0].reasonKind!=='strategy_dispute'||selected[0].evidenceRefs?.length!==1)fail('teacher_routing_unverified','round2Independent','only the reviewed original DS root and single q1 independent diagnosis');
  const n=this.jsonBytes(this.evidenceBytes(selected[0].evidenceRefs[0]));
  strictObject(n,'independentDiagnosisNecessity',['schema','decision','roundContractRef','selectionRef','key','inputSHA256','primaryTaskRef','primaryTerminalRef','screenTaskRef','screenSummaryRef','scientificReviewRef','modelPayloadSHA256','addressMapSHA256','disposition','rationale']);
  if(n.schema!=='ohuo-r2-q1-independent-diagnosis-necessity-v1'||n.decision!=='necessary_independent_diagnosis'||n.roundContractRef!==context.spec.roundContractRef||n.selectionRef!==context.selectionRef||!equal(n.key,namedKey)||n.inputSHA256!==inputSHA||n.disposition!=='diagnostic_only_no_label_replacement'||!string(n.rationale)||context.selection.rows.length!==3||!equal(context.selection.rows[1].key,namedKey)||context.selection.rows[1].inputSHA256!==inputSHA)fail('teacher_routing_unverified','necessity','exact existing full selection and named diagnosis required');
  const settled=(ref:string,id:string)=>{
   const t=this.resolveRef(ref),r=state.runs?.[t.runId],ledger=state.budgets?.[t.budgetRef];
   if(t.taskId!==id||t.runId!==id||!r||r.taskRef!==ref||r.taskSHA256!==digest(t)||!equal(r.task,t)||state.tasks?.[id]!==id||r.status!=='completed'||r.cleanupConfirmed!==true||r.executionUnknown===true||r.observationStatus==='unknown'||r.checkpoint?.executionUnknown===true||r.checkpoint?.active!=null||r.checkpointSHA256!==digest(r.checkpoint)||r.checkpointRef!==join(t.outputRoot,`checkpoint-${r.checkpointSHA256}.json`)||!equal(JSON.parse(this.regular(r.checkpointRef).toString()),r.checkpoint)||!equal(t.datasetRefs,[context.selectionRef])||t.planRef!==task.planRef||t.budgetRef!==task.budgetRef||t.researchBatchId!==task.researchBatchId||t.authorizationRef!==task.authorizationRef||ledger?.activeRunId===id||Object.values(ledger?.reservations??{}).some((x:any)=>x.runId===id&&['reserved','reserved_unknown'].includes(x.status)))fail('selection_execution_uncertain','diagnosisPredecessor','original primary and screen must be exactly completed and safely settled');return {task:t,run:r};
  };
  const primary=settled(n.primaryTaskRef,'r1-data-glm-train-round-2'),screen=settled(n.screenTaskRef,'r1-data-screen-train-round-2');
  if(primary.run.checkpoint.cursor!==3||primary.run.checkpoint.rows?.length!==3||screen.run.checkpoint.rootCursor!==3||primary.task.labelPolicyRef!==route.primaryLabelPolicyRef||task.promptRef!==primary.task.promptRef||task.scientificContract.comparisonRef!==primary.task.scientificContract.comparisonRef||!proof.contract.plannedTasks.some((r:any)=>r.role==='primary-teacher'&&r.split==='train'&&r.taskId===primary.task.taskId)||!proof.contract.plannedTasks.some((r:any)=>r.role==='screen'&&r.split==='train'&&r.taskId===screen.task.taskId))fail('teacher_routing_unverified','diagnosisOriginalRoles','frozen original roles, prompt and comparison remain unchanged');
  const terminalBytes=this.evidenceBytes(n.primaryTerminalRef),terminal=this.jsonBytes(terminalBytes),terminalFile=this.evidence.get(n.primaryTerminalRef.id),terminalRow=primary.run.checkpoint.rows?.[1];
  if(n.primaryTerminalRef.sha256!=='2a5af1ff15c46dd942a5cad315485e97922a72f9d7fb375e85273c376ae644f3'||!terminalFile||terminalRow?.resultRef?.sha256!==n.primaryTerminalRef.sha256||terminalRow.resultRef.path!==this.relativePath(terminalFile.path)||terminal.selectionRef!==context.selectionRef||terminal.index!==1||terminal.status!=='selected'||terminal.inputSHA256!==inputSHA||!equal(terminal.key,namedKey)||typeof terminal.commonView?.modelPayloadBytes!=='string'||sha(terminal.commonView.modelPayloadBytes)!==n.modelPayloadSHA256||digest(terminal.commonView.addressMap)!==n.addressMapSHA256)fail('input_identity_unverified','diagnosisPrimaryTerminal','exact original q1 public bytes and address map required');
  const summary=this.jsonBytes(this.evidenceBytes(n.screenSummaryRef)),summaryFile=this.evidence.get(n.screenSummaryRef.id);
  if(!summaryFile||!screen.run.consumerArtifactRefs?.some((f:any)=>f.sha256===n.screenSummaryRef.sha256&&f.path===this.relativePath(summaryFile.path))||summary.schema!=='ohuo-first-round-screen-summary-v1'||n.screenSummaryRef.sha256!=='8eccc3af03398666b8c2edabb8b61cb9d085cd7262fcc8362d8219015334580c'||summary.taskSHA256!==screen.run.taskSHA256||summary.selectionRef!==context.selectionRef||summary.contractRef!==screen.task.scientificContract.decisionRuleRef||!equal(summary.plans,screen.run.checkpoint.plans)||summary.rootCursor!==3||summary.total!==3||summary.active!==null||summary.executionUnknown!==false||summary.plans?.[1]?.rootIndex!==1||summary.plans[1].status!=='screen_adverse'||summary.plans[1].inputSHA256!==inputSHA||!equal(summary.plans[1].labelTerminalRef,n.primaryTerminalRef))fail('input_identity_unverified','diagnosisScreenSummary','actual completed screen output required');
  const review=this.jsonBytes(this.evidenceBytes(n.scientificReviewRef));strictObject(review,'independentDiagnosisReview',['schema','decision','planRevisionRef','designRef','screenReviewRef','selectionRef','key','inputSHA256','disposition']);
  if(review.schema!=='ohuo-r2-q1-independent-diagnosis-runtime-review-v1'||review.decision!=='PASS_SCIENTIFIC_BINDING_NOT_EXECUTION'||review.selectionRef!==context.selectionRef||!equal(review.key,namedKey)||review.inputSHA256!==inputSHA||review.disposition!==n.disposition||review.designRef.sha256!=='76dee408b493ee23720d3ae5427b52e94dde074dcf97f0177c2dae8249afe995')fail('teacher_routing_unverified','diagnosisScientificReview','actual saved-plan single-question review required');
  this.evidenceBytes(review.designRef);const sr=this.jsonBytes(this.evidenceBytes(review.screenReviewRef));
  if(sr.decision!=='PASS_ACTUAL_EXECUTION_AND_BINDING_NOT_ALL_LABELS'||sr.completeBranches!==24||sr.cleanupConfirmed!==true||!string(sr.naturalCompletedAt)||sr.summarySHA256!==n.screenSummaryRef.sha256||sr.outcomes?.[1]?.rootIndex!==1||sr.outcomes[1].status!=='screen_adverse')fail('teacher_routing_unverified','diagnosisScreenReview','bounded actual q1 dispute is required, not a general negative-score rule');
  const plan=this.jsonBytes(this.evidenceBytes(review.planRevisionRef));
  if(review.planRevisionRef.sha256!=='0f72ffaacc4e00c49bc57a5e861e4dce624b4a9a3eb47f15e54a603969469622'||plan.schema!=='guandan-saved-plan-one-question-ds-diagnosis-v1'||plan.status!=='SAVED_AND_READBACK_BYTE_EXACT'||plan.document?.library_file_id!=='libfile_3f00fde4b97481919c96e65c185d5e4b'||plan.document.business_version!=='5.3.0'||plan.document.version!==33||plan.document.sha256!=='63fc864f5abc1f5d3a4a10bc5886bb8c7bd7b675a75dfa58b8b2ec600110d4dc'||plan.scientific_design?.sha256!==review.designRef.sha256||plan.scientific_review?.sha256!=='f1f58964946af3ffc31f365a6dcd9b60fc28db99f7fda40884cb8c5cb5c16255'||plan.document_text_review?.sha256!=='3fe4ebbb7f5e1a549a34f978654007534b005078f3382cb0322729cd78444aed')fail('teacher_routing_unverified','diagnosisSavedPlan','actual saved main execution plan required');
  const primaryContract=this.resolveRef(primary.task.scientificContract.decisionRuleRef),originalWorlds=this.resolveRef(primaryContract.worldPlansRef),worlds=this.resolveRef(decision.worldPlansRef),originalRow=originalWorlds.rows.filter((r:any)=>r.inputSHA256===inputSHA);
  if(originalRow.length!==1||worlds.protocolRef!==proof.contract.protocolRef||!equal(worlds.rows,originalRow))fail('input_identity_unverified','diagnosisWorldPlan','same original one-row world preparation plan, no extended worlds');
 }

 readApprovedAction(task:any){
  const original=this.resolveRef(task.planRef);if(original.planVersion!==task.planVersion)fail('original_action_conflict','planVersion','original approved plan version differs');
  const protocol=this.commonViewTaskProtocol(task),actions=array(protocol?this.commonViewRoundActions(protocol):original.actions??this.resolveRef(original.actionsRef).actions,'approvedActions');
  const seen=new Set();for(const a of actions){strictObject(a,'approvedAction',['clauseRef','branchRef','plannedTaskIds','dependencyRefs','expectedArtifactKinds','acceptanceRuleRef','skipRuleRef','stopRuleRef']);fixedReference(a.clauseRef,'clauseRef');if(a.branchRef!==null)fixedReference(a.branchRef,'branchRef');const key=canonical([a.clauseRef,a.branchRef]);if(seen.has(key))fail('original_action_conflict','actions','duplicate original action');seen.add(key);strings(a.plannedTaskIds,'plannedTaskIds').forEach((id:string)=>validateIdentifier(id,'taskId'));strings(a.dependencyRefs,'dependencyRefs').forEach((r:string)=>fixedReference(r,'dependencyRef'));strings(a.expectedArtifactKinds,'expectedArtifactKinds');for(const k of ['acceptanceRuleRef','skipRuleRef','stopRuleRef'])if(a[k]!==null)this.resolveRef(a[k]);}
  const matches=actions.filter((a:any)=>a.clauseRef===task.planScope.clauseRef&&a.branchRef===task.planScope.branchRef);if(matches.length!==1)fail('original_action_conflict','planScope','one original clause/branch required');return {action:matches[0],actions};
 }
 private priorPlanObservation(scope:any,current:any,state:any){
  if(current.entity.planRef!==scope.planRef||current.entity.planVersion!==scope.planVersion)fail('plan_unverified','plan','current original plan identity differs');
  const prior=state.hostPlanObservations?.[canonical([scope.planRef,scope.planVersion])]??null;
  if(prior){strictObject(prior,'priorHostObservation',['revision','closeoutSHA256','status']);if(!integer(prior.revision,1)||!hash(prior.closeoutSHA256)||!['incomplete','completed','terminated'].includes(prior.status))fail('plan_unverified','priorHostObservation','original recorded observation invalid');if(current.observation.revision<prior.revision||current.observation.revision===prior.revision&&current.observation.closeoutSHA256!==prior.closeoutSHA256)fail('plan_state_conflict','planScope','current closeout revision cannot roll back or change in place');}
  return prior;
 }
 readNonrunnerAction(input:any,purpose:'offline-selection'|'student-finalization'|'first-round-new-test-selection'|'designed-source-acceptance'|'designed-family-reservation'){
  const newTest=purpose==='first-round-new-test-selection',sourceAcceptance=purpose==='designed-source-acceptance',familyReservation=purpose==='designed-family-reservation';
  if(purpose==='offline-selection'||newTest){
   strictObject(input,'selectionSpec',['schema','planRef','clauseRef','branchRef','sourceIndexRef','queueRef','sourceRunRefs','targetDefinitionRef','selectionRuleRef','quotaBasisRef','purpose','actingReleaseRef','outputId',...(newTest?['sourceSpecRef']:input.schema==='ohuo-offline-selection-spec-common-view-round-r2'?['roundContractRef']:input.schema===DESIGNED_SELECTION_SPEC_SCHEMA?['designedContractRef']:[])]);
   if(!(newTest?input.schema==='ohuo-first-round-new-test-selection-spec-v1':['ohuo-offline-selection-spec-v1','ohuo-offline-selection-spec-common-view-round-r2',DESIGNED_SELECTION_SPEC_SCHEMA].includes(input.schema))||!(newTest?['distribution_diagnostic']:['b_training_source','distribution_diagnostic']).includes(input.purpose))fail('unsupported_schema','selectionSpec','original fixed selection spec required');validateIdentifier(input.outputId,'outputId');
   for(const key of ['sourceIndexRef','queueRef','targetDefinitionRef','selectionRuleRef','actingReleaseRef'])fixedReference(input[key],key);for(const f of array(input.sourceRunRefs,'sourceRunRefs'))this.evidenceBytes(f);if(input.schema===DESIGNED_SELECTION_SPEC_SCHEMA){fixedReference(input.designedContractRef,'designedContractRef');if(input.purpose!=='b_training_source'||input.sourceRunRefs.length)fail('selection_task_binding','designedSource','explicit train design source cannot claim natural source runs');}
  }else if(familyReservation){
   strictObject(input,'designedFamilyReservation',['schema','planRef','clauseRef','branchRef','sourceIndexRef','requestInventoryRef','coverageApprovalRef','budgetRef','comparisonRef','protocolRef','families','outputId']);if(input.schema!=='ohuo-designed-family-reservation-spec-v1')fail('unsupported_schema','designedFamilyReservation','fixed original public family planning required');for(const k of ['sourceIndexRef','requestInventoryRef','coverageApprovalRef','budgetRef','comparisonRef','protocolRef'])fixedReference(input[k],k);validateIdentifier(input.outputId,'outputId');for(const family of array(input.families,'families')){strictObject(family,'designedFamily',['designFamilyId','rootFamilyId','parentFamilyIds']);validateIdentifier(family.designFamilyId,'designFamilyId');validateSourceFamily(family.rootFamilyId,'rootFamilyId');strings(family.parentFamilyIds,'parentFamilyIds').forEach((id:string)=>validateSourceFamily(id,'parentFamilyId'));}
  }else if(sourceAcceptance){
   strictObject(input,'designedSourceAcceptance',['schema','planRef','clauseRef','branchRef','designerTaskRef','sourceIndexRef','comparisonRef','outputId']);if(input.schema!=='ohuo-designed-source-acceptance-spec-v1')fail('unsupported_schema','designedSourceAcceptance','fixed original source-owner request required');for(const k of ['designerTaskRef','sourceIndexRef','comparisonRef'])fixedReference(input[k],k);validateIdentifier(input.outputId,'outputId');
  }else if(purpose==='student-finalization'){
   strictObject(input,'studentFinalizationRequest',['schema','planRef','planVersion','clauseRef','branchRef','trainingTaskRef','trainingRunId','summaryRef','reviewRef','parentPolicyRef','policyId','outputPath']);
   if(input.schema!=='ohuo-student-finalization-request-v1'||!integer(input.planVersion,1))fail('unsupported_schema','studentFinalizationRequest','original fixed finalization request required');fixedReference(input.trainingTaskRef,'trainingTaskRef');validateIdentifier(input.trainingRunId,'trainingRunId');validateIdentifier(input.policyId,'policyId');
  }else fail('unsupported_value','nonrunnerPurpose','only the two original fixed artifact purposes');
  fixedReference(input.planRef,'planRef');fixedReference(input.clauseRef,'clauseRef');if(input.branchRef!==null)fixedReference(input.branchRef,'branchRef');
  const grant=this.readGrant(),plan=this.resolveRef(input.planRef),planVersion=purpose!=='student-finalization'?plan.planVersion:input.planVersion;
  if(!integer(planVersion,1)||plan.planVersion!==planVersion||grant.planRef!==input.planRef||grant.planVersion!==planVersion)fail('authorization_unverified','planRef','original approved plan/version must bind this artifact operation');if(grant.scope.localExecution!==true)fail('scope_not_authorized','localExecution','original local artifact operation scope required');
  // The original approval bytes and exact approved action are facts, not a new
  // permission certificate. Tool/user authority and the owner's interpretation
  // of that original approval remain external; no natural-language scope is
  // silently promoted to an approved=true field here.
  const method=purpose==='student-finalization'?this.resolveRef(input.trainingTaskRef).scientificContract.analysisMethodRef:sourceAcceptance?this.resolveRef(input.designerTaskRef).scientificContract.analysisMethodRef:familyReservation?input.protocolRef:this.resolveRef(input.selectionRuleRef).protocolRef,scope={planRef:input.planRef,planVersion,planScope:{clauseRef:input.clauseRef,branchRef:input.branchRef},...(method?{protocolRevisionRef:method}:{})},action=this.readApprovedAction(scope).action,closeout=this.readCloseout(),priorObservation=this.priorPlanObservation(scope,closeout,this.checkExistingRoot());
  const observed=closeout.entity.actions.filter((a:any)=>a.clauseRef===action.clauseRef&&a.branchRef===action.branchRef&&equal(a.plannedTaskIds,action.plannedTaskIds));if(observed.length!==1)fail('original_action_conflict','closeoutAction','one unchanged original nonrunner action required');
  const rule=this.resolveRef(action.acceptanceRuleRef);strictObject(rule,'nonrunnerStageRule',['schema','stage','phase','purpose','originalRuleRef','requiredKinds']);this.resolveRef(rule.originalRuleRef);
  const stage=purpose==='student-finalization'?5:sourceAcceptance||familyReservation?4:input.purpose==='b_training_source'?4:6,phase=purpose==='student-finalization'?'formal':null,artifacts=purpose==='student-finalization'?['ohuo-student-finalization-receipt-v1']:sourceAcceptance?['ohuo-designed-source-acceptance-v1']:familyReservation?['ohuo-designed-family-reservation-v1']:newTest?['ohuo-first-round-new-test-selection-result-v1','ohuo-first-round-new-test-selection-commit-v1']:['ohuo-offline-selection-production-v1','ohuo-offline-label-selection-v2'];
  if(rule.schema!=='ohuo-stage-action-rule-v1'||rule.stage!==stage||rule.phase!==phase||!string(rule.purpose)||artifacts.some(k=>!action.expectedArtifactKinds.includes(k)))fail('stage_mapping_unverified','nonrunnerAction','original exact stage/phase/output purpose required, not a generic future action');
  const required=sourceAcceptance||familyReservation?['designed-public-train-gap','student-visibility-and-initial-c','budget-scope']:stage===4?['teacher-transferability','student-visibility-and-initial-c','frozen-source-layout','budget-scope']:stage===6?['student-selection','frozen-comparison-conditions','new-source-isolation','budget-scope']:['complete-formal-training','frozen-behavior-review','allowed-checkpoints','budget-scope'],declared=strings(rule.requiredKinds,'requiredKinds');
  if(required.some(k=>!declared.includes(k))||purpose!=='student-finalization'&&declared.includes('selection-production')||purpose==='student-finalization'&&declared.includes('student-selection'))fail('prerequisites_missing','requiredKinds','original minimum and no future-self prerequisite required');
  const prerequisites:any[]=[],kinds=new Set<string>();for(const requirementRef of action.dependencyRefs){
   const requirement=this.resolveRef(requirementRef);strictObject(requirement,'nonrunnerRequirement',['schema','stage','phase','kind','sourceRuleRef']);this.resolveRef(requirement.sourceRuleRef);
   if(requirement.schema!=='ohuo-stage-prerequisite-v1'||requirement.stage!==stage||requirement.phase!==null&&requirement.phase!==phase||!string(requirement.kind)||kinds.has(requirement.kind)||purpose!=='student-finalization'&&requirement.kind==='selection-production'||purpose==='student-finalization'&&requirement.kind==='student-selection')fail('prerequisites_missing','requirement','original unique matching stage/kind and no self cycle required');kinds.add(requirement.kind);
   let candidates=[...new Set(grant.tasks.flatMap((t:any)=>t.prerequisiteReceipts.filter((p:any)=>p.requirementRef===requirementRef).map((p:any)=>p.receiptRef)))] as string[];
   if(!candidates.length)candidates=[...this.references.keys()].filter(ref=>{const r=this.resolveRef(ref);return ['ohuo-prerequisite-receipt-v1','ohuo-prerequisite-receipt-v2'].includes(r?.schema)&&r.planRef===input.planRef&&r.planVersion===planVersion&&r.requirementRef===requirementRef;});
   if(candidates.length!==1)fail(candidates.length?'prerequisites_ambiguous':'prerequisites_missing','receipt','one original receipt; never choose latest or filter out an old unknown');
   const receiptRef=candidates[0],receipt=this.prerequisiteReceipt(receiptRef,scope,requirementRef),specific:any={'teacher-transferability':'scientific-decision','designed-public-train-gap':'scientific-decision','screening-conclusion':'scientific-decision','dataset-qualification':'dataset-qualification','student-selection':'student-selection','numerical-restart':'numerical-restart','calibration-qualification':'calibration-qualification'};
   if(specific[requirement.kind]&&receipt.kind!==specific[requirement.kind])fail('prerequisites_missing','receipt.kind','original specialized evidence category required');prerequisites.push({requirementRef,receiptRef,requirement,receipt});
  }
  if([...required,...declared].some(k=>!kinds.has(k)))fail('prerequisites_missing','dependencyRefs','all original required kinds need actual unambiguous receipts');
  const byKind=(kind:string)=>prerequisites.find(p=>p.requirement.kind===kind).receipt,hasFile=(kind:string,f:any)=>byKind(kind).evidence_refs.some((x:any)=>equal(x,f)),hasJSON=(kind:string,ref:string)=>byKind(kind).evidence_refs.some((f:any)=>{const bytes=this.evidenceBytes(f);try{return digest(this.jsonBytes(bytes))===ref.split(':').at(-1);}catch{return false;}});
  if(purpose==='student-finalization'){
   const task=validateTask(this.resolveRef(input.trainingTaskRef)),summary=this.jsonBytes(this.evidenceBytes(input.summaryRef)),review=this.jsonBytes(this.evidenceBytes(input.reviewRef));
   if(task.planRef!==input.planRef||task.planVersion!==planVersion||task.runId!==input.trainingRunId||summary.schema!=='ohuo-supervised-summary-v1'||summary.taskSHA256!==digest(task)||summary.runId!==task.runId||review.schema!=='ohuo-distill-behavior-review-v1'||review.taskSHA256!==digest(task)||!Array.isArray(summary.selection?.allowedCheckpoints)||!hasFile('complete-formal-training',input.summaryRef)||!hasFile('allowed-checkpoints',input.summaryRef)||!hasFile('frozen-behavior-review',input.reviewRef)||!hasJSON('budget-scope',task.budgetRef))fail('prerequisite_input_mismatch','studentFinalization','original summary/review/allowed checkpoints and budget evidence must bind this Task/run, not another met receipt');
  }else if(familyReservation){
   const coverage=this.resolveRef(input.coverageApprovalRef),inventory=this.resolveRef(input.requestInventoryRef),comparison=this.resolveRef(input.comparisonRef),budget=this.resolveRef(input.budgetRef),index=this.resolveRef(input.sourceIndexRef),hasSpec=byKind('designed-public-train-gap').evidence_refs.some((f:any)=>{try{return digest(this.jsonBytes(this.evidenceBytes(f)))===digest(input);}catch{return false;}});
   if(coverage.schema!=='ohuo-designed-public-coverage-approval-v1'||coverage.planRef!==input.planRef||coverage.sourceIndexRef!==input.sourceIndexRef||inventory.schema!=='ohuo-designed-source-inventory-v1'||!Array.isArray(inventory.requests)||!inventory.requests.length||comparison.schema!=='ohuo-first-round-comparison-v1'||index.schema!=='ohuo-source-index-ref-v1'||budget.planRef!==input.planRef||budget.authorizationRef!==grant.authorizationRef||budget.controlRoot!==this.root||!hasSpec||!hasJSON('designed-public-train-gap',input.requestInventoryRef)||!hasJSON('designed-public-train-gap',input.coverageApprovalRef)||!hasJSON('designed-public-train-gap',coverage.evidenceRef)||!hasJSON('student-visibility-and-initial-c',comparison.proposalRef)||!hasJSON('student-visibility-and-initial-c',input.comparisonRef)||!hasJSON('budget-scope',input.budgetRef))fail('prerequisite_input_mismatch','designedFamilyReservation','exact original public family spec, inventory, coverage, B/comparison and budget evidence required');
  }else if(sourceAcceptance){
   const task=validateTask(this.resolveRef(input.designerTaskRef)),contract=this.resolveRef(task.scientificContract.decisionRuleRef),comparison=this.resolveRef(input.comparisonRef),coverage=this.resolveRef(contract.coverageApprovalRef);
   if(task.planRef!==input.planRef||task.sourcePlan.sourceIndexRef!==input.sourceIndexRef||this.resolveRef(task.capabilityRef)?.id!=='B07.designed-source.v1'||contract.schema!=='ohuo-designed-source-contract-v1'||comparison.schema!=='ohuo-first-round-comparison-v1'||task.scientificContract.comparisonRef!==input.comparisonRef||comparison.proposalRef!==task.parentPolicyRef||!hasJSON('student-visibility-and-initial-c',input.comparisonRef)||!hasJSON('budget-scope',task.budgetRef)||!hasJSON('designed-public-train-gap',contract.coverageApprovalRef)||!hasJSON('designed-public-train-gap',coverage.evidenceRef)||!hasJSON('student-visibility-and-initial-c',comparison.proposalRef))fail('prerequisite_input_mismatch','designedSourceAcceptance','original designer Task, source, public gap, B and budget evidence required');
  }else{
   const quota=this.jsonBytes(this.evidenceBytes(input.quotaBasisRef)),r2quota=quota.schema==='ohuo-selection-source-batch-basis-r2';strictObject(quota,'quotaBasis',['schema','planRef','budgetRef','controlStateRef','stage2Stage3AccountingRefs',...(r2quota?['protocolRef','families']:['originalQuotas','frozenQuotas']),'reasonRef','freezeEvidenceRef']);if(r2quota&&this.commonViewTaskProtocol(scope,grant)?.ref!==quota.protocolRef)fail('protocol_identity_unverified','quotaBasis','same actual protocol required');fixedReference(quota.budgetRef,'budgetRef');const budget=this.resolveRef(quota.budgetRef),index=this.resolveRef(input.sourceIndexRef),layoutKind=stage===4?'frozen-source-layout':'new-source-isolation';
   if(!['ohuo-selection-quota-basis-v1','ohuo-selection-source-batch-basis-r2'].includes(quota.schema)||quota.planRef!==input.planRef||budget.planRef!==input.planRef||budget.controlRoot!==this.root||budget.authorizationRef!==grant.authorizationRef||!hasJSON('budget-scope',quota.budgetRef)||!hasJSON(layoutKind,input.queueRef)||!byKind(layoutKind).evidence_refs.some((f:any)=>f.sha256===index.fileSHA256))fail('prerequisite_input_mismatch','offlineSelection','original queue/index and quota budget evidence must bind this exact full population');
   if(newTest){fixedReference(input.sourceSpecRef,'sourceSpecRef');const source=this.resolveRef(input.sourceSpecRef);if(!['ohuo-first-round-new-test-source-v1','ohuo-common-view-new-test-source-r2'].includes(source.schema)||source.planRef!==input.planRef||source.budgetRef!==quota.budgetRef||source.queueRef!==input.queueRef||source.sourceIndexRef!==input.sourceIndexRef||source.selectionPlanRef!==input.selectionRuleRef||source.s1Ref!==input.actingReleaseRef||!equal(source.sourceRunRefs,input.sourceRunRefs))fail('prerequisite_input_mismatch','newTestSource','exact original new-test scope/source allocation required');}
   if(stage===4&&!hasJSON('student-visibility-and-initial-c',input.actingReleaseRef)||stage===6&&!hasJSON('frozen-comparison-conditions',input.actingReleaseRef))fail('prerequisite_input_mismatch','actingReleaseRef','original acting release evidence required');
   if(stage===6){const acting=this.resolveRef(input.actingReleaseRef),files=[...this.bindings.values()].flatMap((b:any)=>b.studentReleaseFiles).filter((f:any)=>f.ref===input.actingReleaseRef),unique=[...new Map(files.map((f:any)=>[canonical(f.file),f])).values()] as any[];if(acting.schema!=='ohuo-student-task-release-v1'||unique.length!==1)fail('prerequisites_missing','student-selection','one original already-selected student release required');const release=this.readJSON(unique[0].file),selection=this.jsonBytes(this.evidenceBytes(release.selection));if(acting.releaseSHA256!==unique[0].file.sha256||acting.policyId!==release.policyId||selection.schema!=='ohuo-student-selection-v1'||selection.status!=='selected'||selection.selected?.manifestSHA256!==release.checkpoint?.sha256||!hasFile('student-selection',release.selection))fail('prerequisite_input_mismatch','student-selection','original actual S selection must bind the acting release; not this future selection output');this.studentSelectionCompletion(input.planRef,planVersion,byKind('student-selection'),unique[0].file,release,selection);}
  }
  const protocol=this.commonViewTaskProtocol(scope,grant);return {grant,plan,action,rule,closeout,priorObservation,prerequisites,protocol};
 }
 private assertDesignedLedger(state:any,task:any){
  const ledger=state.budgets?.[task.budgetRef],batch=state.batches?.[task.researchBatchId],budget=this.resolveRef(task.budgetRef);
  if(!ledger||!equal(batch,{budgetRef:task.budgetRef,authorizationRef:task.authorizationRef,planRef:task.planRef})||ledger.researchBatchId!==task.researchBatchId||ledger.authorizationRef!==task.authorizationRef||ledger.planRef!==task.planRef||budget.researchBatchId!==task.researchBatchId||budget.planRef!==task.planRef||budget.authorizationRef!==task.authorizationRef||budget.controlRoot!==this.root||!equal(ledger.limits,budget.limits)||ledger.accountingMode!=='research'||!ledger.used||['providerRequests','labelDecisions','matchAttempts','optimizerSteps'].some(k=>!Number.isSafeInteger(ledger.used[k])||ledger.used[k]<0)||!ledger.reservations||typeof ledger.reservations!=='object'||Array.isArray(ledger.reservations)||!(ledger.activeRunId===null||typeof ledger.activeRunId==='string'))fail('budget_identity_unverified','designedLedger','actual original ledger and batch binding required; missing is never empty');
  return ledger;
 }
 async readDesignedFamilyReservation(spec:any){
  this.currentProducerSource();const facts=this.readNonrunnerAction(spec,'designed-family-reservation'),state=this.checkExistingRoot(),budget=this.resolveRef(spec.budgetRef),scope={planRef:spec.planRef,budgetRef:spec.budgetRef,authorizationRef:facts.grant.authorizationRef,researchBatchId:budget.researchBatchId},ledger=this.assertDesignedLedger(state,scope);
  if(ledger.activeRunId!==null||Object.values(ledger.reservations).some((r:any)=>['reserved','reserved_unknown'].includes(r.status)))fail('selection_execution_uncertain','designedFamilyReservation','original account must be settled before immutable source planning');
  const used=await readUsedCommonSelectionRows(this.repositoryRoot),history=this.designedHistoryIdentity(scope,used.selectionRefs,state);this.verifySettledDesignedHistory(history,state,used.selectionRefs,[]);
  const observed=facts.closeout.entity.actions.find((a:any)=>a.clauseRef===facts.action.clauseRef&&a.branchRef===facts.action.branchRef),allowCreate=facts.closeout.entity.status==='incomplete'&&!['completed','terminated'].includes(facts.priorObservation?.status)&&observed?.status==='not_executed'&&observed.unresolved.length===0;
  return {facts,state,allowCreate};
 }
 async readDesignedSourceAcceptance(spec:any){
  this.currentProducerSource();const facts=this.readNonrunnerAction(spec,'designed-source-acceptance'),task=validateTask(this.resolveRef(spec.designerTaskRef));
  await this.checkAuthorization(task);const action=this.readApprovedAction(task).action;this.prerequisites(task,facts.grant,action);const state=this.checkExistingRoot();this.assertActionTaskLineage(task,action,state);
  const run=state.runs?.[task.runId],ledger=this.assertDesignedLedger(state,task),cp=run?.checkpoint;
  if(!run||run.taskRef!==spec.designerTaskRef||run.runId!==task.runId||run.taskSHA256!==digest(task)||!equal(run.task,task)||state.tasks[task.taskId]!==run.runId||task.outputRoot!==join(this.root,'runs',task.runId)||run.status!=='completed'||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.stopReason==='execution_uncertain'||run.failureReason==='execution_uncertain'||ledger.activeRunId!==null||Object.values(ledger.reservations).some((r:any)=>['reserved','reserved_unknown'].includes(r.status))||!isDesignedSourceCheckpoint(cp)||!equal(cp.binding,this.designerCheckpointBinding(task,spec.designerTaskRef))||cp.binding.sourceIndexRef!==spec.sourceIndexRef||cp.cursor!==cp.binding.requestOrder.length||cp.active!==null||cp.executionUnknown||(cp.rows??[]).some((r:any)=>r.requestCount===null))fail('selection_execution_uncertain','designedSourceRun','actual complete settled original designer Task required before source registration');
  const taskBytes=this.regular(join(task.outputRoot,'task.json'));if(sha(taskBytes)!==run.taskSHA256||!equal(this.jsonBytes(taskBytes),task)||run.checkpointSHA256!==digest(cp)||run.checkpointRef!==join(task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)||!equal(this.jsonBytes(this.regular(run.checkpointRef)),cp))fail('state_history_conflict','designedSourceRun','actual original immutable Task/checkpoint bytes required');
  const observed=facts.closeout.entity.actions.find((a:any)=>a.clauseRef===facts.action.clauseRef&&a.branchRef===facts.action.branchRef),allowCreate=facts.closeout.entity.status==='incomplete'&&!['completed','terminated'].includes(facts.priorObservation?.status)&&observed?.status==='not_executed'&&observed.unresolved.length===0;
  return {task,run,state,facts,allowCreate};
 }
 private studentSelectionCompletion(planRef:string,planVersion:number,prerequisite:any,releaseFile:any,release:any,selection:any){
  const completions=array(prerequisite.evidence_refs,'student-selection.evidence_refs').flatMap((f:any)=>{const b=this.evidenceBytes(f);let v:any;try{v=JSON.parse(b.toString('utf8'));}catch{return [];}return v?.schema==='ohuo-student-finalization-receipt-v1'?[v]:[];});
  if(completions.length!==1)fail('student_completion_unverified','student-selection','one explicitly cited original finalization completion receipt required');const completion=completions[0];
  strictObject(completion,'studentCompletion',['schema','requestRef','trainingTaskRef','trainingRunId','summaryRef','reviewRef','status','selectionRef','releaseRef','issues']);
  if(completion.status!=='selected'||!Array.isArray(completion.issues)||completion.issues.length||!equal(completion.selectionRef,release.selection)||!equal(completion.summaryRef,selection.summary)||!equal(completion.reviewRef,selection.behaviorReview)||completion.releaseRef?.sha256!==releaseFile.sha256)fail('student_completion_unverified','receipt','selected original receipt must bind exact selection/summary/review/release');
  const request=this.resolveRef(completion.requestRef);strictObject(request,'studentFinalizationRequest',['schema','planRef','planVersion','clauseRef','branchRef','trainingTaskRef','trainingRunId','summaryRef','reviewRef','parentPolicyRef','policyId','outputPath']);
  const training=validateTask(this.resolveRef(completion.trainingTaskRef)),state=this.checkExistingRoot(),run=state.runs[completion.trainingRunId],ledger=state.budgets[training.budgetRef],binding=this.bindings.get(completion.trainingTaskRef),summary=this.jsonBytes(this.evidenceBytes(completion.summaryRef)),review=this.jsonBytes(this.evidenceBytes(completion.reviewRef)),parent=this.resolveRef(training.parentPolicyRef);
  const firstRound=isFirstRoundRecipe(training.learnerRecipe),expectedProposal=firstRound?resolveCandidateReleaseRef(this.resolveRef(training.outputSpec.proposalPolicyRef),ref=>this.resolveRef(ref),RELEASES):null;
  const expectedParentPolicy=firstRound?expectedProposal!.release.proposalPolicyRef:parent.policyRef;
  if(firstRound){const actualParent=validateFirstRoundParentEnvelope({parentRef:training.parentPolicyRef,envelope:parent,readEvidence:f=>this.evidenceBytes(f)});if(release.schema!=='ohuo-student-release-first-round-v3'||release.proposalRef!==training.outputSpec.proposalPolicyRef||release.learningParent?.ref!==training.parentPolicyRef||!equal(release.learningParent.scorer,actualParent.parentIdentity)||!equal(release.learningParent.migrationReceiptRef,actualParent.migrationReceiptRef)||!equal(release.proposer.identity,expectedProposal!.policyIdentity))fail('student_completion_unverified','parent','same separate B proposal and S0 migration required');}
  if(request.schema!=='ohuo-student-finalization-request-v1'||request.planRef!==planRef||request.planVersion!==planVersion||training.planRef!==planRef||training.planVersion!==planVersion||request.trainingTaskRef!==completion.trainingTaskRef||request.trainingRunId!==completion.trainingRunId||training.runId!==completion.trainingRunId||training.taskKind!=='supervised_training'||binding?.trainingPhase!=='formal'||!equal(request.summaryRef,completion.summaryRef)||!equal(request.reviewRef,completion.reviewRef)||request.policyId!==release.policyId||(!firstRound&&parent.schema!=='ohuo-parent-policy-ref-v1')||request.parentPolicyRef!==expectedParentPolicy||release.proposer?.policyRef!==expectedParentPolicy||request.outputPath!==relative(this.repositoryRoot,join(training.outputRoot,'student-release.json'))||releaseFile.path!==request.outputPath||completion.releaseRef?.id!==request.outputPath||completion.selectionRef?.id!==request.policyId+'-dev-selection')fail('student_completion_unverified','request','exact original finalization request/Task/run/parent/output identity required');
  if(!run||run.taskRef!==completion.trainingTaskRef||run.taskSHA256!==digest(training)||!equal(run.task,training)||state.tasks[training.taskId]!==run.runId||!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.checkpoint?.executionUnknown===true||run.checkpoint?.active!=null||ledger?.activeRunId===run.runId||Object.values(ledger?.reservations??{}).some((r:any)=>r.runId===run.runId&&['reserved','reserved_unknown'].includes(r.status))||summary.runId!==run.runId||summary.taskSHA256!==run.taskSHA256||summary.plan?.phase!=='formal'||summary.actual?.realTraining!==true||(isFirstRoundR2Recipe(summary.plan?.recipe)?!['candidate','diagnostic_stop'].includes(summary.actual.learningObservation?.decision)||!integer(summary.actual.optimizerSteps,1)||summary.actual.optimizerSteps%summary.plan.Uepoch!==0:summary.actual.optimizerSteps!==(firstRound?64:3*summary.plan.Uepoch))||review.taskSHA256!==run.taskSHA256||selection.status!=='selected'||selection.selected?.manifestSHA256!==release.checkpoint?.sha256||release.checkpoint?.path!==relative(this.repositoryRoot,join(training.outputRoot,selection.selected.path,'manifest.json')))fail('student_completion_unverified','trainingRun','original complete known formal run and selected checkpoint must match receipt, not another same-plan run');
  if(!equal(this.jsonBytes(this.evidenceBytes(completion.releaseRef)),release)||!equal(this.jsonBytes(this.evidenceBytes(completion.selectionRef)),selection))fail('student_completion_unverified','artifact','original completion F bytes must equal actual acting S artifacts');
  if(firstRound){const facts=verifyStudentFinalizationFacts(request,this,training,summary,state),actual=selectDistillCheckpoint(facts.allowed,review.reviews,training.learnerRecipe);if(!equal(actual,(({status,selected,reason,eligible})=>({status,selected,reason,eligible}))(selection)))fail('student_completion_unverified','selection','H must recompute the same completed64 directional selection');}
  this.readNonrunnerAction(request,'student-finalization');return completion;
 }
 async readStudentFinalizationTraining(task:any){
  this.currentProducerSource();await this.checkAuthorization(task);const grant=this.readGrant(),grantEntry=this.taskEntry(task,grant),action=this.readApprovedAction(task).action,inputBinding=this.bindings.get(grantEntry.taskRef);
  if(task.taskKind!=='supervised_training'||inputBinding?.trainingPhase!=='formal')fail('input_identity_unverified','trainingTask','original formal training input required');this.prerequisites(task,grant,action);return {grantEntry,action,inputBinding};
 }
 /** Fixed source facade, built only here after original authority admission. */
 firstRoundPilotContext(task:any){
  const rule=this.resolveRef(task.scientificContract.selectionRuleRef);if(rule?.schema!=='ohuo-offline-selection-first-round-pilot-rule-v1')return undefined;
  const context=freezeJSON({schema:'ohuo-first-round-pilot-context-v1',selectionRuleRef:task.scientificContract.selectionRuleRef,readoutRuleRef:task.scientificContract.readoutRuleRef,references:[...this.references.keys()].map(ref=>({ref,value:this.resolveRef(ref)}))});this.pilotContexts.add(context);return context;
 }
 checkFirstRoundPilotAdmission(task:any,state:any,context:any){if(!context||!this.pilotContexts.has(context))fail('input_identity_unverified','firstRoundPilotContext','fixed host pilot context required');return verifyFirstRoundPilotAdmission({task,state,context});}
 checkFirstRoundPilotHistory(task:any,state:any,context:any){if(!context||!this.pilotContexts.has(context))fail('input_identity_unverified','firstRoundPilotContext','fixed host pilot context required');return verifyFirstRoundPilotHistory({task,state,context});}
 firstRoundEvaluationFacade(task:any,nonrunnerFacts?:any){
  const host=this;return {repositoryRoot:this.repositoryRoot,root:this.root,resolveRef:(r:string)=>host.resolveRef(r),evidenceBytes:(f:any)=>host.evidenceBytes(f),checkExistingRoot:()=>host.checkExistingRoot(),
   sourceTasksForPlan:(planRef:string)=>{const plan=host.resolveRef(planRef),protocol=task?host.commonViewTaskProtocol(task):nonrunnerFacts?.protocol,actions=protocol?.value.actions??plan.actions??host.resolveRef(plan.actionsRef).actions;return [...host.references].flatMap(([ref])=>{const t=host.resolveRef(ref);if(t?.schemaVersion!==1||t.planRef!==planRef||!['collect','evaluate'].includes(t.taskKind)||host.resolveRef(t.capabilityRef)?.id!=='B07.complete-match.v1')return [];if(['ohuo-first-round-new-test-contract-v1','ohuo-common-view-new-test-contract-r2'].includes(host.resolveRef(t.scientificContract.decisionRuleRef)?.schema))return [];const action=actions.find((a:any)=>a.clauseRef===t.planScope.clauseRef&&a.branchRef===t.planScope.branchRef);if(!action?.plannedTaskIds.includes(t.taskId))fail('planned_source_task_unavailable','sourceTasksForPlan','actual original action membership required');return [{ref,task:validateTask(t)}];});},
   verifySourceTask:async(sourceTask:any)=>{await host.checkAuthorization(sourceTask);const action=host.readApprovedAction(sourceTask).action;host.prerequisites(sourceTask,host.readGrant(),action);host.assertActionTaskLineage(sourceTask,action,host.checkExistingRoot());},
   verifySelectedStudent:async(_scope:any,studentRef:string)=>{const files=[...host.bindings.values()].flatMap((b:any)=>b.studentReleaseFiles).filter((f:any)=>f.ref===studentRef),unique=[...new Map(files.map((f:any)=>[canonical(f.file),f.file])).values()] as any[];if(unique.length!==1)fail('student_completion_unverified','newTestS1','one actual S1 file binding required');const file=unique[0],release=host.readJSON(file),ref=host.resolveRef(studentRef),selection=host.jsonBytes(host.evidenceBytes(release.selection));if(ref.schema!=='ohuo-student-task-release-v1'||ref.releaseSHA256!==file.sha256||ref.policyId!==release.policyId||release.schema!=='ohuo-student-release-first-round-v3')fail('student_completion_unverified','newTestS1','actual first-round selected release required');
    let prerequisite:any,planRef:string,planVersion:number;if(nonrunnerFacts){prerequisite=nonrunnerFacts.prerequisites.find((p:any)=>p.requirement.kind==='student-selection')?.receipt;planRef=nonrunnerFacts.grant.planRef;planVersion=nonrunnerFacts.grant.planVersion;}else{const entry=host.taskEntry(task,host.readGrant()),rows=entry.prerequisiteReceipts.filter((p:any)=>host.resolveRef(p.requirementRef).kind==='student-selection');if(rows.length!==1)fail('student_completion_unverified','newTestS1','one original selection prerequisite required');prerequisite=host.prerequisiteReceipt(rows[0].receiptRef,task,rows[0].requirementRef);planRef=task.planRef;planVersion=task.planVersion;}host.studentSelectionCompletion(planRef,planVersion,prerequisite,file,release,selection);
   }};
 }
 /** Read-only bridge for the existing metadata producer. The binding request
  * may describe the not-yet-published derived spec; its original reservation,
  * selected student and all actual variance source Tasks remain host-bound. */
 async commonViewConfirmationHost(inputRef:string){
  const input=this.resolveRef(inputRef);let spec=input;
  if(input.schema==='ohuo-first-round-source-binding-v1'){
   strictObject(input,'sourceBinding',['schema','reservationRef','outputId','s0Ref','s1Ref','s1ReleaseFileRef','activeCounts','confirmationPlanningRef']);
   const production=this.jsonBytes(this.evidenceBytes(input.reservationRef)),original=this.resolveRef(production.specRef);
   if(production.schema!=='ohuo-first-round-source-production-v1')fail('input_identity_unverified','sourceReservation','original complete production required');
   spec={...structuredClone(original),outputId:input.outputId,reservationRef:input.reservationRef,bindings:{...structuredClone(original.bindings),s0Ref:input.s0Ref,s1Ref:input.s1Ref,s1ReleaseFileRef:input.s1ReleaseFileRef},confirmationPlanningRef:input.confirmationPlanningRef};
  }
  if(spec.schema!=='ohuo-first-round-source-spec-common-view-r2'||spec.confirmationPlanningRef===null||!string(spec.bindings?.s1Ref))fail('input_identity_unverified','confirmationSpec','explicit r2 confirmation planning and already selected S1 required');
  const planning=this.resolveRef(spec.confirmationPlanningRef),e=this.resolveRef(planning.inputs?.varianceEvidenceRef),history=this.jsonBytes(this.evidenceBytes(e.historyRef));
  if(planning.schema!=='ohuo-common-view-source-confirmation-planning-r2'||e.schema!=='ohuo-common-view-variance-evidence-r2'||history.schema!=='ohuo-common-view-variance-history-r2'||!Array.isArray(history.sourceTaskRefs)||!history.sourceTaskRefs.length||new Set(history.sourceTaskRefs).size!==history.sourceTaskRefs.length)fail('input_identity_unverified','varianceHistory','same original fixed evidence and complete declared Tasks required');
  const tasks=history.sourceTaskRefs.map((ref:string)=>validateTask(this.resolveRef(ref))),task=tasks[0],facade=this.firstRoundEvaluationFacade(task),protocol=this.commonViewTaskProtocol(task);
  if(protocol?.ref!==spec.protocolRef||task.planRef!==spec.planRef||tasks.some((t:any)=>t.planRef!==task.planRef||t.budgetRef!==task.budgetRef||t.scientificContract.analysisMethodRef!==spec.protocolRef))fail('protocol_identity_unverified','confirmationHistory','same actual authorized protocol and ledger required');
  for(const sourceTask of tasks)await facade.verifySourceTask(sourceTask);
  await facade.verifySelectedStudent({planRef:spec.planRef},spec.bindings.s1Ref);
  return facade;
 }
 /** Complete original frozen-dataset inventory. Parsed candidates are never
  * accepted from a request; the original file reader checks manifest and rows. */
 private async registeredFrozenDatasetCatalog(){
  const {loadFrozenDataset}=await import('./distill-data'),candidates:any[]=[],locations=new Map<string,any>(),pins:any[]=[];
  for(const [reference]of this.references){const descriptor=this.resolveRef(reference);if(descriptor?.schema!=='ohuo-frozen-dataset-ref-v1')continue;
   const mapped=[...this.evidence.values()].filter((f:any)=>f.sha256===descriptor.manifestSHA256&&f.path.endsWith('/manifest.json'));
   for(const [taskRef,b]of this.bindings){const task=this.resolveRef(taskRef);if(task.datasetRefs?.includes(reference)&&b.datasetDirectory!==null)mapped.push({path:join(b.datasetDirectory,'manifest.json'),sha256:descriptor.manifestSHA256});}
   const files=[...new Map(mapped.map((f:any)=>[canonical(f),f])).values()] as any[];if(files.length!==1)fail('input_identity_unverified','augmentationDataset','every registered dataset requires one original exact immutable manifest binding');
   this.readFile(files[0]);const frozen={directory:this.directory(dirname(files[0].path)),manifestSHA256:descriptor.manifestSHA256};
   for(const name of ['manifest.json','samples.jsonl']){const path=join(frozen.directory,name);pins.push({path,signal:this.designedFileSignal(path)});}
   const {manifest,samples}=loadFrozenDataset(frozen);candidates.push({reference,descriptor,manifest,samples});locations.set(reference,frozen);
  }
  return {candidates,locations,pins};
 }
 private augmentationLearningDatasetRefs(state:any,scope:any,files:any[]){
  const learnedDatasetRefs:string[]=[];
  for(const run of Object.values(state.runs) as any[]){const t=run.task;if(t?.planRef!==scope.planRef||t.budgetRef!==scope.budgetRef||t.taskKind!=='supervised_training')continue;validateTask(t);
   if(run.taskSHA256!==digest(t)||!equal(this.resolveRef(run.taskRef),t)||run.runId!==t.runId||state.tasks[t.taskId]!==run.runId||t.outputRoot!==join(this.root,'runs',t.runId)||!equal(this.jsonBytes(this.regular(join(t.outputRoot,'task.json'))),t)||sha(this.regular(join(t.outputRoot,'task.json')))!==run.taskSHA256)fail('state_history_conflict','augmentationLearning','complete actual original training Task history required');
   const cp=run.checkpoint,ledger=state.budgets?.[t.budgetRef],reservations=Object.values(ledger?.reservations??{}).filter((r:any)=>r.runId===run.runId) as any[];files.push({path:join(t.outputRoot,'task.json'),signal:this.designedFileSignal(join(t.outputRoot,'task.json'))});
   if(cp!=null){if(cp.schema!=='ohuo-supervised-run-v1'||cp.taskSHA256!==run.taskSHA256||t.datasetRefs.length!==1||cp.datasetSHA256!==this.resolveRef(t.datasetRefs[0]).manifestSHA256||run.checkpointSHA256!==digest(cp)||run.checkpointRef!==join(t.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)||!equal(this.jsonBytes(this.regular(run.checkpointRef)),cp))fail('state_history_conflict','augmentationLearning','actual original training checkpoint and dataset identity required');files.push({path:run.checkpointRef,signal:this.designedFileSignal(run.checkpointRef)});}else if(run.checkpointSHA256!=null||run.checkpointRef!=null)fail('state_history_conflict','augmentationLearning','no partial checkpoint identity');
   if(!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.stopReason==='execution_uncertain'||run.failureReason==='execution_uncertain'||cp?.executionUnknown===true||cp?.active!=null||ledger?.activeRunId===run.runId||reservations.some((r:any)=>['reserved','reserved_unknown'].includes(r.status)))fail('selection_execution_uncertain','augmentationLearning','original learning work must be safely stopped');
   for(const ref of t.datasetRefs){if(this.resolveRef(ref).schema!=='ohuo-frozen-dataset-ref-v1')fail('input_identity_unverified','augmentationLearning','original learned dataset identity cannot disappear');learnedDatasetRefs.push(ref);}
  }
  return [...new Set(learnedDatasetRefs)];
 }
 /** The designed train addition extends the actual latest full dataset. It
  * cannot select an older predecessor or regenerate a smaller old dev set. */
 async designedAugmentationDatasetProof(planRef:string,selectionRef:string){
  this.currentProducerSource();const plan=this.resolveRef(planRef),augmentation=plan.designedAugmentation;
  strictObject(augmentation,'designedAugmentation',['schema','previousDatasetRef','selectionRef','ordinarySelectionRef']);
  if(!isFirstRoundR2DatasetPlan(plan)||plan.purpose!=='first-round-partner-control'||augmentation.schema!=='ohuo-designed-augmentation-v1'||augmentation.selectionRef!==selectionRef||Object.hasOwn(plan,'cumulativeSampling'))fail('input_identity_unverified','designedAugmentation','original research r2 plan and exact designed selection required');
  const selection=this.resolveRef(selectionRef),production=this.resolveRef(selection.productionRef),spec=this.resolveRef(production.specRef),contract=this.designedConsumerContract(spec),ordinarySelection=this.resolveRef(augmentation.ordinarySelectionRef),ordinaryProduction=this.resolveRef(ordinarySelection.productionRef),ordinarySpec=this.resolveRef(ordinaryProduction.specRef),ordinaryRule=this.resolveRef(ordinarySpec.selectionRuleRef);
  if(selection.schema!=='ohuo-offline-label-selection-v2'||production.schema!=='ohuo-offline-selection-production-v1'||plan.samplingRef!==selection.productionRef||plan.sourceIndexRef!==spec.sourceIndexRef||plan.queueRef!==spec.queueRef||plan.researchProtocol.revisionRef!==contract.protocolRef||ordinarySelection.schema!=='ohuo-offline-label-selection-v2'||ordinaryProduction.schema!=='ohuo-offline-selection-production-v1'||ordinarySpec.schema==='ohuo-offline-selection-spec-common-view-round-r2'||ordinarySpec.schema===DESIGNED_SELECTION_SPEC_SCHEMA||ordinarySpec.planRef!==spec.planRef||ordinarySpec.actingReleaseRef!==spec.actingReleaseRef||ordinaryRule.schema!=='ohuo-offline-selection-common-view-r2'||ordinaryRule.representativeRound!==0)fail('input_identity_unverified','designedOrdinaryPool','same original complete round0 natural population and teaching identities required');
  const references=new Map<string,any>();for(const [ref]of this.references)references.set(ref,this.resolveRef(ref));const protocolLineage=ordinaryRule.protocolRef===contract.protocolRef?null:verifyDesignedProtocolLineage({currentProtocolRef:contract.protocolRef,previousProtocolRef:ordinaryRule.protocolRef,references});
  this.commonViewTaskProtocol({planRef:spec.planRef,planVersion:this.resolveRef(spec.planRef).planVersion,budgetRef:contract.budgetRef,protocolRevisionRef:contract.protocolRef});
  const state=this.checkExistingRoot(),stateSHA256=digest(state),budget=this.resolveRef(contract.budgetRef),ledger=this.assertDesignedLedger(state,{planRef:spec.planRef,budgetRef:contract.budgetRef,authorizationRef:this.readGrant().authorizationRef,researchBatchId:budget.researchBatchId});
  if(!ledger||ledger.activeRunId!==null||!ledger.reservations||Object.values(ledger.reservations).some((r:any)=>['reserved','reserved_unknown'].includes(r.status)))fail('selection_execution_uncertain','augmentationLedger','original teaching account must be safely settled before dataset reconstruction');
  // This metadata reader verifies every real committed manifest and actual
  // round-parent chain, including frozen-but-unasked rows; no later export is
  // silently reinterpreted under a different mapper.
  const used=await readUsedCommonSelectionRows(this.repositoryRoot),priorSelectionRefs=used.selectionRefs,historySnapshot=this.designedHistoryIdentity({planRef:spec.planRef,budgetRef:contract.budgetRef},priorSelectionRefs,state),historyFiles:any[]=[];
  this.verifySettledDesignedHistory(historySnapshot,state,priorSelectionRefs,historyFiles);
  const natural=priorSelectionRefs.flatMap((reference:string)=>{const s=this.resolveRef(reference),p=this.resolveRef(s.productionRef),sp=this.resolveRef(p.specRef);if(sp.planRef!==ordinarySpec.planRef||sp.sourceIndexRef!==ordinarySpec.sourceIndexRef||sp.queueRef!==ordinarySpec.queueRef||sp.schema===DESIGNED_SELECTION_SPEC_SCHEMA)return [];const r=this.resolveRef(sp.selectionRuleRef),c=sp.schema==='ohuo-offline-selection-spec-common-view-round-r2'?this.resolveRef(sp.roundContractRef):null;if(r.protocolRef!==ordinaryRule.protocolRef||r.schema!==ordinaryRule.schema)fail('input_identity_unverified','augmentationNaturalChain','same original natural protocol and rule required');return [{reference,productionRef:s.productionRef,round:c?.round??0,parentSelectionRef:c?.parentSelectionRef??null,roundContractRef:c?sp.roundContractRef:null,contract:c}];}).sort((a:any,b:any)=>a.round-b.round);
  if(!natural.length||natural[0].reference!==augmentation.ordinarySelectionRef||natural.some((r:any,i:number)=>r.round!==i||i>0&&r.parentSelectionRef!==natural[i-1].reference))fail('input_identity_unverified','augmentationNaturalChain','complete original round0-to-latest natural chain required');
  const catalog=await this.registeredFrozenDatasetCatalog(),learnedDatasetRefs=this.augmentationLearningDatasetRefs(state,{planRef:spec.planRef,budgetRef:contract.budgetRef},historyFiles);
  const {resolveDesignedAugmentationPredecessor}=await import('./designed-augmentation-history.mjs'),previousRef=resolveDesignedAugmentationPredecessor({plan,ordinaryPool:{selectionRef:augmentation.ordinarySelectionRef,sourceIndexRef:ordinarySpec.sourceIndexRef,queueRef:ordinarySpec.queueRef,productionRefs:natural.map((r:any)=>r.productionRef)},candidates:catalog.candidates,learnedDatasetRefs:[...new Set(learnedDatasetRefs)],references}),previousDataset={reference:previousRef,frozen:catalog.locations.get(previousRef)};
  // Reuse the original read-only cumulative screen-history audit. All included
  // selections have just been resolved from the complete committed catalog and
  // their actual immutable Task/checkpoints verified. This never admits a run.
  const audit={pool:{planRef:spec.planRef,budgetRef:contract.budgetRef,sourceIndexRef:ordinarySpec.sourceIndexRef,queueRef:ordinarySpec.queueRef},priorSelectionRefs,historyStateSHA256:''};audit.historyStateSHA256=this.commonViewRoundStateIdentity(audit,state);
  if(this.#designedProtocolHistory!==null)fail('input_identity_unverified','augmentationHistory','one read-only protocol history scope required');
  if(this.#cumulativeDatasetHistory!==null)fail('input_identity_unverified','augmentationHistory','one original dataset read session required');this.#cumulativeDatasetHistory=audit;
  if(protocolLineage){const oldTaskScopes=(Object.values(state.runs) as any[]).filter((r:any)=>r.task?.planRef===spec.planRef&&r.task?.budgetRef===contract.budgetRef&&r.task?.scientificContract?.analysisMethodRef===protocolLineage.previousProtocolRef).map((r:any)=>canonical([r.task.planScope.clauseRef,r.task.planScope.branchRef]));this.#designedProtocolHistory={...protocolLineage,allowedActionKeys:[...new Set([canonical([ordinarySpec.clauseRef,ordinarySpec.branchRef]),...oldTaskScopes])],roundContracts:natural.filter((r:any)=>r.roundContractRef!==null).map((r:any)=>({roundContractRef:r.roundContractRef,contract:structuredClone(r.contract)}))};}
  try{
   const ordinaryResolved=await this.offlineSelectionHostInputs(ordinarySpec,{phase:'dataset'}),resolvedInputs=await this.offlineSelectionHostInputs(spec,{phase:'dataset'}),ordinarySelectionProof={selection:ordinarySelection,production:ordinaryProduction,resolvedInputs:ordinaryResolved},selectionProof={selection,production,resolvedInputs};
   verifyOfflineSelection(ordinarySelection,ordinaryResolved);verifyOfflineSelection(selection,resolvedInputs);
   if(digest(this.checkExistingRoot())!==stateSHA256||[...historyFiles,...catalog.pins].some((f:any)=>this.designedFileSignal(f.path)!==f.signal))fail('selection_execution_uncertain','augmentationHistory','original state and frozen dataset bytes changed during preparation');
   return {plan,resolvedInputs,selectionProof,cumulativeProof:null,designedAugmentation:{previousDataset,ordinarySelectionProof}};
  }finally{this.#cumulativeDatasetHistory=null;this.#designedProtocolHistory=null;}
 }
 private cumulativePreviousDataset(plan:any,sampling:any,productionRefs:string[],state:any,pool:any){
  // Inventory only original host-bound dataset identities and their exact
  // manifest paths. No filesystem search or caller-selected old samples.
  const datasets:any[]=[];
  for(const [reference]of this.references){const d=this.resolveRef(reference);if(d?.schema!=='ohuo-frozen-dataset-ref-v1')continue;
   const mapped=[...this.evidence.values()].filter((f:any)=>f.sha256===d.manifestSHA256&&f.path.endsWith('/manifest.json'));
   for(const [taskRef,b]of this.bindings){const t=this.resolveRef(taskRef);if(t.datasetRefs?.includes(reference)&&b.datasetDirectory!==null)mapped.push({path:join(b.datasetDirectory,'manifest.json'),sha256:d.manifestSHA256});}
   const files=[...new Map(mapped.map((f:any)=>[canonical(f),f])).values()] as any[];if(files.length!==1)fail('input_identity_unverified','previousDataset','every registered original dataset requires one exact immutable manifest binding');
   const manifest=this.readJSON(files[0]),previous=manifest.plan;if(previous?.sourceIndexRef!==plan.sourceIndexRef||previous.queueRef!==plan.queueRef||previous.researchProtocol?.revisionRef!==sampling.protocolRef)continue;
   if(!equal(previous.identities,plan.identities))fail('input_identity_unverified','previousDataset','cumulative teaching identities cannot silently change');
   const refs=previous.cumulativeSampling?.productionRefs??[previous.samplingRef];if(!Array.isArray(refs)||!refs.length||refs.length>productionRefs.length||refs.some((ref:string,i:number)=>ref!==productionRefs[i]))fail('input_identity_unverified','previousDataset','original dataset must be an actual prefix of this same chain');
   datasets.push({reference,frozen:{directory:this.directory(dirname(files[0].path)),manifestSHA256:d.manifestSHA256},prefix:refs.length});
  }
  for(const run of Object.values(state.runs) as any[]){const t=run.task;if(t?.planRef!==pool.planRef||t.taskKind!=='supervised_training'||t.scientificContract?.analysisMethodRef!==sampling.protocolRef)continue;for(const ref of t.datasetRefs??[]){const d=this.resolveRef(ref);if(d?.schema!=='ohuo-frozen-dataset-ref-v1')fail('input_identity_unverified','previousLearning','original learning dataset identity cannot disappear');}}
  let previousDataset:any=null;
  if(datasets.length){const max=Math.max(...datasets.map(d=>d.prefix)),last=datasets.filter(d=>d.prefix===max),identities=new Set(last.map(d=>canonical(d.frozen))),selected=last.find(d=>d.reference===sampling.previousDatasetRef);if(identities.size!==1||!selected)fail('input_identity_unverified','previousDataset','actual complete maximal frozen predecessor required; null or an older subset cannot reset learning history');previousDataset={reference:selected.reference,frozen:selected.frozen};}
  else if(sampling.previousDatasetRef!==null)fail('input_identity_unverified','previousDataset','no invented earlier dataset');
  return previousDataset;
 }
 /** Cumulative B09 reads original separate commits; it never fabricates a
  * merged selector output or takes a caller supplied predecessor list. */
 async cumulativeOfflineSelectionDatasetProof(planRef:string,latestSelectionRef:string){
  const plan=this.resolveRef(planRef),sampling=plan.cumulativeSampling;
  strictObject(sampling,'cumulativeSampling',['schema','protocolRef','poolRef','selectionRefs','productionRefs','previousDatasetRef','keepRule']);
  if(!isFirstRoundR2DatasetPlan(plan)||sampling.schema!=='ohuo-first-round-cumulative-sampling-r2'||sampling.protocolRef!==plan.researchProtocol.revisionRef||sampling.keepRule!=='same-split-frozen-layout-hash-prefix-equal-cumulative-valid-demo'||!equal(this.resolveRef(plan.samplingRef),sampling))fail('input_identity_unverified','cumulativeSampling','original fixed r2 cumulative entity required');
  const latest=this.resolveRef(latestSelectionRef),production=this.resolveRef(latest.productionRef),spec=this.resolveRef(production.specRef),state=this.checkExistingRoot(),proof=this.commonViewRoundProof(spec,state);
  if(!proof||proof.poolRef!==sampling.poolRef||proof.contract.protocolRef!==sampling.protocolRef||plan.sourceIndexRef!==proof.pool.sourceIndexRef||plan.queueRef!==proof.pool.queueRef)fail('input_identity_unverified','cumulativePool','same complete actual representative pool required');
  const selectionRefs=[...proof.priorSelectionRefs,latestSelectionRef],productionRefs=selectionRefs.map((ref:string)=>this.resolveRef(ref).productionRef);
  if(selectionRefs.length<2||!equal(sampling.selectionRefs,selectionRefs)||!equal(sampling.productionRefs,productionRefs))fail('input_identity_unverified','cumulativeRounds','exact complete round0-to-current chain required');
  const registered=[...this.references.keys()].filter((ref:string)=>{const v=this.resolveRef(ref);return v?.schema==='ohuo-offline-label-selection-v2'&&v.sourceIndexRef===proof.pool.sourceIndexRef&&v.queueRef===proof.pool.queueRef&&this.resolveRef(this.resolveRef(v.productionRef).specRef).planRef===proof.pool.planRef;});
  if(!sameRefs(registered,selectionRefs))fail('input_identity_unverified','cumulativeRounds','cannot omit a registered later round or select an earlier prefix as latest');
  const ledger=state.budgets?.[proof.pool.budgetRef];if(!ledger||ledger.activeRunId!==null||!ledger.reservations||Object.values(ledger.reservations).some((r:any)=>['reserved','reserved_unknown'].includes(r.status)))fail('selection_execution_uncertain','cumulativeLedger','same original account must be safely settled');
  for(const run of Object.values(state.runs) as any[]){const task=run.task;if(task?.planRef!==proof.pool.planRef||task.budgetRef!==proof.pool.budgetRef||!task.datasetRefs?.some((ref:string)=>selectionRefs.includes(ref)))continue;
   if(knownUnsentWorldPreparationFailure(run,state,this.root,(ref:string)=>this.resolveRef(ref)))continue;
   if(run.taskSHA256!==digest(task)||run.taskRef?.split(':').at(-1)!==digest(task)||state.tasks[task.taskId]!==run.runId||run.runId!==task.runId||!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.checkpoint?.executionUnknown===true||run.checkpoint?.active!=null||(run.checkpoint?.rows??[]).some((r:any)=>r.requestCount===null)||['execution_uncertain'].includes(run.stopReason)||['execution_uncertain'].includes(run.failureReason))fail('selection_execution_uncertain','cumulativeHistory','every current and predecessor run remains original and safely settled');
  }
  const previousDataset=this.cumulativePreviousDataset(plan,sampling,productionRefs,state,proof.pool);
  const history={...proof,priorSelectionRefs:selectionRefs,historyStateSHA256:''};history.historyStateSHA256=this.commonViewRoundStateIdentity(history,state);
  const rounds:any[]=[];if(this.#cumulativeDatasetHistory!==null)fail('input_identity_unverified','cumulativeHistory','one original fixed read session required');this.#cumulativeDatasetHistory=history;
  try{for(const ref of selectionRefs){this.assertCommonViewRoundState({roundAdmission:history},this.checkExistingRoot());const selection=this.resolveRef(ref),production=this.resolveRef(selection.productionRef),roundSpec=this.resolveRef(production.specRef),resolvedInputs=await this.offlineSelectionHostInputs(roundSpec,{phase:'dataset'});rounds.push({selection,production,resolvedInputs});}this.assertCommonViewRoundState({roundAdmission:history},this.checkExistingRoot());}
  finally{this.#cumulativeDatasetHistory=null;}
  return {schema:'ohuo-first-round-cumulative-proof-r2',samplingRef:plan.samplingRef,rounds,previousDataset};
 }
 private selectionCommit(spec:any,directory:string){
  const id='offline-selection/'+spec.outputId+'/manifest.json',path=join(directory,'manifest.json'),catalog=this.evidence.get(id);
  if(!existsSync(path)&&!catalog)return null;const bytes=existsSync(path)?this.regular(path):this.readFile(catalog),commit=this.jsonBytes(bytes);if(catalog&&catalog.sha256!==sha(bytes))fail('artifact_conflict','selectionCommit','fixed manifest bytes differ');
  strictObject(commit,'selectionCommit',['schema','specRef','selectionRef','productionRef','files']);if(commit.schema!=='ohuo-offline-selection-commit-v1'||commit.specRef!==`offline-selection-spec/${spec.outputId}@sha256:${digest(spec)}`)fail('artifact_conflict','selectionCommit','only the same original spec commit is reusable');
  const names=['spec.json','source-inventory.jsonl','population.jsonl','selected-metadata.jsonl','exclusions.jsonl',...(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA?['used-catalog.json']:[]),'production.json','selection.json'],contents=new Map<string,Buffer>();if(array(commit.files,'selectionCommit.files').length!==names.length)fail('artifact_conflict','selectionCommit','original exact complete source-kind commit required');
  for(const [i,name] of names.entries()){const row=commit.files[i];strictObject(row,'selectionCommitFile',['id','file']);this.fileShape(row.file);if(row.id!==`offline-selection/${spec.outputId}/${name}`||row.file.path!==relative(this.repositoryRoot,join(directory,name)))fail('artifact_conflict','selectionCommit','original fixed output identities required');const destination=this.relativePath(row.file.path),source=this.evidence.get(row.id),b=existsSync(destination)?this.regular(destination):source?.sha256===row.file.sha256?this.readFile(source):fail('evidence_unavailable','selectionCommit','missing original bytes cannot be re-enumerated after closeout');if(sha(b)!==row.file.sha256)fail('artifact_conflict','selectionCommit','original committed bytes differ');contents.set(name,b);}
  const saved=this.jsonBytes(contents.get('spec.json')!),selection=this.jsonBytes(contents.get('selection.json')!),production=this.jsonBytes(contents.get('production.json')!);
  if(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA){const f=commit.files.find((x:any)=>x.id===`offline-selection/${spec.outputId}/used-catalog.json`);if(!equal(production.usedCatalogRef,{id:f.id,sha256:f.file.sha256}))fail('artifact_conflict','usedCatalogRef','exact original committed used history required');}else if(Object.hasOwn(production,'usedCatalogRef'))fail('artifact_conflict','usedCatalogRef','natural commits cannot claim designed history');
  if(!equal(saved,spec)||commit.selectionRef!==`offline-label-selection/${spec.outputId}@sha256:${digest(selection)}`||commit.productionRef!==`offline-selection-production/${spec.outputId}@sha256:${digest(production)}`||selection.productionRef!==commit.productionRef||production.specRef!==commit.specRef)fail('artifact_conflict','selectionCommit','exact spec/selection/production identities required');return commit;
 }
 private assertOfflineSelectionFreezeAvailable(spec:any,state:any,observed:any,closed:boolean,commit:any){
  if(commit)return; // Existing immutable-commit recovery remains unchanged.
  let later=false;
  if(!closed&&observed.status==='completed'&&observed.unresolved.length===0&&spec.schema==='ohuo-offline-selection-spec-common-view-round-r2'){
   const proof=this.commonViewRoundProof(spec,state);
   later=!!proof&&proof.round>=1;
  }
  if(closed||observed.unresolved.length||observed.status!=='not_executed'&&!later)fail(closed?'plan_closed':'original_action_conflict','offlineSelection','new freeze requires the original available action or a verified settled later-round chain; only actual fixed commit permits recovery');
 }
 async offlineSelectionHostInputs(spec:any,options:any){
  this.currentProducerSource();strictObject(options,'offlineSelectionOptions',['phase',...(Object.hasOwn(options,'task')?['task']:[]),...(Object.hasOwn(options,'outputDir')?['outputDir']:[])]);if(!['freeze','label-start','label-resume','dataset'].includes(options.phase))fail('unsupported_value','phase','fixed offline selection phase required');
  const facts=this.readNonrunnerAction(spec,'offline-selection'),outputDir=join(this.repositoryRoot,'lab/out',spec.outputId),state=this.checkExistingRoot();
  if(options.outputDir!==undefined&&resolve(options.outputDir)!==outputDir)fail('invalid_output_root','offlineSelection','only original repository lab/out/outputId allowed');
  for(const path of [join(this.repositoryRoot,'lab/out'),outputDir])if(existsSync(path)&&(!lstatSync(path).isDirectory()||realpathSync(path)!==path))fail('invalid_output_root','offlineSelection','real original artifact root required');
  const observed=facts.closeout.entity.actions.find((a:any)=>a.clauseRef===facts.action.clauseRef&&a.branchRef===facts.action.branchRef),closed=facts.closeout.entity.status!=='incomplete'||['completed','terminated'].includes(facts.priorObservation?.status),commit=options.phase==='freeze'?this.selectionCommit(spec,outputDir):null;
  if(options.phase==='freeze')this.assertOfflineSelectionFreezeAvailable(spec,state,observed,closed,commit);
  this.assertDiagnosticWriteIntersection(state,outputDir);
  const references=new Map<string,any>();for(const [ref] of this.references)references.set(ref,freezeJSON(this.resolveRef(ref)));const evidenceFiles=new Map(this.evidence);
  if(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA)return this.designedSelectionHostInputs(spec,options,{facts,outputDir,state,references,evidenceFiles});
  const tasks=[...references].filter(([,t])=>t?.schemaVersion===1&&t.planRef===spec.planRef&&['collect','evaluate'].includes(t.taskKind)&&t.seatLayoutPlan===spec.queueRef&&t.sourcePlan?.sourceIndexRef===spec.sourceIndexRef&&references.get(t.capabilityRef)?.id==='B07.complete-match.v1').map(([taskRef,value])=>({taskRef,task:validateTask(value)}));
  // A whole source action with missing Task definitions must not disappear just
  // because no run exists. This is the producer's existing actual artifact
  // schema, not a fabricated task type or future label Task requirement.
  const allActions=facts.protocol?.value.actions??facts.plan.actions??references.get(facts.plan.actionsRef)?.actions;
  verifySourceActionInventory({spec,references,actions:allActions,tasks});
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
  return {repositoryRoot:this.repositoryRoot,references,evidenceFiles,sourceIndexPath,confirmedRecordRoots:[...new Set(confirmedRecordRoots)],controlRoot:this.root,...(this.screenRevalidation?{screenRevalidation:this.screenRevalidation}:{ }),mode:'research' as const,phase:options.phase,...(options.task?{task:options.task,...(options.phase!=='freeze'?{roundProofSession:this.roundProofSessionFor(options.task)}:{})}:{}),...(options.phase==='freeze'?{outputDir}:{}),...(labelTerminalRefs?{labelTerminalRefs}:{})};
 }
 /** Explicit source-kind branch after the unchanged H producer/action gates.
  * Planned roles bind existing actions; this never appends approved Task IDs. */
 private designedConsumerContract(spec:any){
  const contract=this.resolveRef(spec.designedContractRef);
  strictObject(contract,'designedConsumerContract',['schema','planRef','clauseRef','branchRef','budgetRef','protocolRef','comparisonRef','sourceIndexRef','queueRef','selectionRuleRef','targetDefinitionRef','plannedTasks']);
  if(contract.schema!=='ohuo-designed-source-consumer-contract-v1'||spec.schema!==DESIGNED_SELECTION_SPEC_SCHEMA||spec.purpose!=='b_training_source'||spec.sourceRunRefs.length)fail('selection_task_binding','designedContract','explicit designed training source required');
  for(const key of ['planRef','clauseRef','branchRef','sourceIndexRef','queueRef','selectionRuleRef','targetDefinitionRef'])if(contract[key]!==spec[key])fail('selection_task_binding','designedContract','exact original source/spec binding required');
  for(const key of ['budgetRef','protocolRef','comparisonRef'])fixedReference(contract[key],key);
  const seen=new Set<string>();for(const row of array(contract.plannedTasks,'plannedTasks')){strictObject(row,'designedRole',['role','taskId','runId','experimentId']);for(const key of ['taskId','runId','experimentId'])validateIdentifier(row[key],key);if(!['teacher','screen'].includes(row.role)||row.taskId!==row.runId||seen.has(row.taskId))fail('selection_task_binding','designedRole','one exact existing teacher/screen role identity required');seen.add(row.taskId);}
  if(!seen.size)fail('selection_task_binding','designedRole','at least one explicit existing role required');return contract;
 }
 private assertDesignedTaskBinding(task:any,spec:any,contract:any,selectionRef?:string){
  const role=contract.plannedTasks.find((r:any)=>r.taskId===task.taskId),decision=this.resolveRef(task.scientificContract.decisionRuleRef),cap=this.resolveRef(task.capabilityRef),rule=this.resolveRef(spec.selectionRuleRef),quota=this.jsonBytes(this.evidenceBytes(spec.quotaBasisRef));
  if(!role||role.runId!==task.runId||role.experimentId!==task.experimentId||task.taskKind!=='collect'||cap.id!=='B07.offline-label.v1'||task.planRef!==spec.planRef||task.budgetRef!==contract.budgetRef||task.budgetRef!==quota.budgetRef||task.scientificContract.analysisMethodRef!==contract.protocolRef||task.scientificContract.comparisonRef!==contract.comparisonRef||task.sourcePlan.sourceIndexRef!==spec.sourceIndexRef||task.seatLayoutPlan!==spec.queueRef||task.sourcePlan.split!=='train'||!task.sourcePlan.familyIds.length||task.sourcePlan.familyIds.some((id:string)=>!quota.families?.some((f:any)=>f.familyId===id&&f.split==='train'))||task.parentPolicyRef!==spec.actingReleaseRef||!task.releaseRefs.includes(spec.actingReleaseRef)||rule.schema!==DESIGNED_SELECTION_RULE_SCHEMA||rule.protocolRef!==contract.protocolRef||decision.schema!==(role.role==='screen'?'ohuo-common-view-screen-contract-r2':'ohuo-common-view-teacher-contract-r2')||decision.protocolRef!==contract.protocolRef||decision.comparisonRef!==contract.comparisonRef||selectionRef!==undefined&&(!equal(task.datasetRefs,[selectionRef])||decision.selectionRef!==selectionRef))fail('selection_task_binding','designedTask','existing exact granted train role, source, budget, comparison and full selection required');
 }
 private async designedSelectionHostInputs(spec:any,options:any,base:any){
  if(this.screenRevalidation)fail('revalidation_scope','designedSource','the historical screen-only benchmark cannot create or consume new designed sources');
  const {facts,outputDir,state,references,evidenceFiles}=base,contract=this.designedConsumerContract(spec),quota=this.jsonBytes(this.evidenceBytes(spec.quotaBasisRef));
  if(facts.protocol?.ref!==contract.protocolRef||quota.budgetRef!==contract.budgetRef||quota.protocolRef!==contract.protocolRef)fail('selection_task_binding','designedAuthority','same approved common-view protocol and original budget required');
  for(const role of contract.plannedTasks){
   const actions=facts.protocol.value.actions.filter((a:any)=>a.plannedTaskIds.includes(role.taskId));
   if(actions.length!==1)fail('original_action_conflict','designedRole','designed role must already exist in exactly one approved action');
   const action=actions[0],rule=this.resolveRef(action.acceptanceRuleRef),closed=facts.closeout.entity.actions.filter((a:any)=>a.clauseRef===action.clauseRef&&a.branchRef===action.branchRef&&equal(a.plannedTaskIds,action.plannedTaskIds));
   if(rule.stage!==4||rule.phase!==null||!(role.role==='screen'?['data-screen']:['data-glm','data-ds']).includes(rule.purpose)||closed.length!==1)fail('original_action_conflict','designedRole','original teacher/screen action and unchanged closeout role required');
  }
  if(options.task){await this.checkAuthorization(options.task);const action=this.readApprovedAction(options.task).action;this.prerequisites(options.task,facts.grant,action);this.assertActionTaskLineage(options.task,action,state);this.assertDesignedTaskBinding(options.task,spec,contract,options.task.datasetRefs?.[0]);}
  const index=this.resolveRef(spec.sourceIndexRef),files=[...this.bindings.values()].map((b:any)=>b.sourceIndexFile).concat([...this.evidence.values()]).filter((f:any)=>f.sha256===index.fileSHA256),unique=[...new Map(files.map((f:any)=>[f.path,f])).values()] as any[];
  if(index.schema!=='ohuo-source-index-ref-v1'||!unique.length)fail('input_identity_unverified','designedSourceIndex','original catalog-bound actual index bytes required');for(const f of unique)this.readFile(f);unique.sort((a:any,b:any)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
  const committedSelections=[...references].filter(([,v]:any)=>v?.schema==='ohuo-offline-label-selection-v2'&&equal(references.get(references.get(v.productionRef)?.specRef),spec)).map(([ref]:any)=>ref);
  if(committedSelections.length>1||options.phase!=='freeze'&&committedSelections.length!==1)fail('selection_task_binding','designedHistory','one original committed full selection required outside initial freeze');
  const used=committedSelections.length?await readUsedCommonSelectionRowsAtCommit(this.repositoryRoot,committedSelections[0]):await readUsedCommonSelectionRows(this.repositoryRoot),priorSelectionRefs=used.selectionRefs.filter((ref:string)=>!committedSelections.includes(ref)),preRuntime=this.designedHistoryIdentity({planRef:spec.planRef,budgetRef:contract.budgetRef},priorSelectionRefs,state);
  const actualBudget=this.resolveRef(contract.budgetRef);this.assertDesignedLedger(state,{planRef:spec.planRef,budgetRef:contract.budgetRef,authorizationRef:facts.grant.authorizationRef,researchBatchId:actualBudget.researchBatchId});
  this.verifySettledDesignedHistory(preRuntime,state,priorSelectionRefs,[]);
  if(options.task){const current=state.runs?.[options.task.runId],cp=current?.checkpoint;if(current?.executionUnknown===true||current?.observationStatus==='unknown'||cp?.executionUnknown===true||current?.stopReason==='execution_uncertain'||current?.failureReason==='execution_uncertain'||(cp?.rows??[]).some((r:any)=>r.requestCount===null)||Object.values(state.budgets?.[contract.budgetRef]?.reservations??{}).some((r:any)=>r.runId===options.task.runId&&r.status==='reserved_unknown'))fail('selection_execution_uncertain','designedHistory','current unknown run cannot load a fresh source runtime');}
  const sourceIndexPath=this.relativePath(unique[0].path),specRef=`offline-selection-spec/${spec.outputId}@sha256:${digest(spec)}`,designedSession=await createDesignedSelectionSession(this.repositoryRoot,specRef);
  const trusted:any={repositoryRoot:this.repositoryRoot,references,evidenceFiles,sourceIndexPath,confirmedRecordRoots:[],controlRoot:this.root,mode:'research',phase:options.phase,designedSession,...(options.task?{task:options.task}:{}),...(options.phase==='freeze'?{outputDir}:{})};
  // Dataset history uses the very same committed source-kind proof, not a
  // fabricated natural complete-match run or a caller-supplied history list.
  if(options.phase==='dataset')trusted.labelTerminalRefs=await this.datasetLabelTerminals(spec,references,state,facts.grant,trusted);
  return trusted;
 }
 private designedHistoryIdentity(task:any,priorSelectionRefs:string[],state:any){
  const prior=new Set(priorSelectionRefs),runs=(Object.values(state.runs??{}) as any[]).filter(r=>r.task?.planRef===task.planRef&&r.task?.budgetRef===task.budgetRef&&r.task?.datasetRefs?.some((ref:string)=>prior.has(ref))).sort((a:any,b:any)=>a.runId.localeCompare(b.runId)),ids=new Set(runs.map(r=>r.runId)),ledger=state.budgets?.[task.budgetRef];
  return {runs,identity:digest({runs:runs.map(run=>({run,taskRunId:state.tasks?.[run.task.taskId]??null})),ledger:ledger?{activePredecessorRunId:ids.has(ledger.activeRunId)?ledger.activeRunId:null,reservations:Object.entries(ledger.reservations??{}).filter(([,r]:any)=>ids.has(r.runId)).sort(([a],[b])=>a.localeCompare(b))}:null})};
 }
 private designedFileSignal(path:string){const s=lstatSync(path,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||realpathSync(path)!==path)fail('input_identity_unverified','designedHistoryFile','original real file required');return [s.dev,s.ino,s.mode,s.size,s.mtimeNs,s.ctimeNs].join('|');}
 private designedSelectionHistory(task:any,selection:any,spec:any,trusted:any){
  if(!trusted?.designedSession)fail('input_identity_unverified','designedSession','only the original H-created reader session may bind designed history');
  const proof=verifyOfflineSelection(selection,{...trusted,phase:'dataset'}),history=readDesignedSelectionHistory(trusted.designedSession),specRef=`offline-selection-spec/${spec.outputId}@sha256:${digest(spec)}`;
  if(!equal(proof.spec,spec)||history.specRef!==specRef||history.sourceIndexRef!==spec.sourceIndexRef||history.indexSuccessor.sourceIndexRef!==spec.sourceIndexRef)fail('selection_task_binding','designedHistory','complete reproduced selection and original index successor required');
  const state=this.checkExistingRoot(),contract=this.designedConsumerContract(spec),selectionRef=task.datasetRefs[0],priorSelectionRefs=history.usedSelectionRefs.filter((r:string)=>r!==selectionRef),snapshot=this.designedHistoryIdentity(task,priorSelectionRefs,state),files:any[]=[];
  this.assertDesignedTaskBinding(task,spec,contract,selectionRef);
  this.verifySettledDesignedHistory(snapshot,state,priorSelectionRefs,files);
  return {contract,priorSelectionRefs,historyStateSHA256:snapshot.identity,files,session:trusted.designedSession};
 }
 private verifySettledDesignedHistory(snapshot:any,state:any,priorSelectionRefs:string[],files:any[]){
  for(const run of snapshot.runs){
   const t=validateTask(run.task),cp=run.checkpoint,ledger=this.assertDesignedLedger(state,t),reservations=Object.values(ledger?.reservations??{}).filter((r:any)=>r.runId===run.runId) as any[];
   if(run.runId!==t.runId||run.taskSHA256!==digest(t)||!equal(this.resolveRef(run.taskRef),t)||state.tasks[t.taskId]!==run.runId||t.outputRoot!==join(this.root,'runs',t.runId)||!equal(t.datasetRefs,[t.datasetRefs?.[0]])||!priorSelectionRefs.includes(t.datasetRefs[0]))fail('state_history_conflict','designedHistory','actual original immutable prior Task/run required');
   const taskPath=join(t.outputRoot,'task.json'),taskBytes=this.regular(taskPath);if(sha(taskBytes)!==run.taskSHA256||!equal(this.jsonBytes(taskBytes),t))fail('state_history_conflict','designedHistory','actual original Task file differs');files.push({path:taskPath,signal:this.designedFileSignal(taskPath)});
   if(cp!=null){if(run.checkpointSHA256!==digest(cp)||run.checkpointRef!==join(t.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)||!equal(this.jsonBytes(this.regular(run.checkpointRef)),cp))fail('state_history_conflict','designedHistory','actual original checkpoint bytes required');files.push({path:run.checkpointRef,signal:this.designedFileSignal(run.checkpointRef)});}else if(run.checkpointSHA256!=null||run.checkpointRef!=null)fail('state_history_conflict','designedHistory','no partial checkpoint identity');
   if(knownUnsentWorldPreparationFailure(run,state,this.root,(ref:string)=>this.resolveRef(ref)))continue;
   if(!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.stopReason==='execution_uncertain'||run.failureReason==='execution_uncertain'||cp?.executionUnknown===true||cp?.active!=null||(cp?.rows??[]).some((r:any)=>r.requestCount===null)||ledger?.activeRunId===run.runId||reservations.some((r:any)=>['reserved','reserved_unknown'].includes(r.status)))fail('selection_execution_uncertain','designedHistory','used questions stay occupied and every prior actual run must be safely settled');
  }
 }
 private assertDesignedSelectionAdmission(task:any,state:any,context:any){
  if(context.spec.schema!==DESIGNED_SELECTION_SPEC_SCHEMA){if(context.designedHistory)fail('selection_task_binding','designedHistory','no designed history on natural source');return;}
  const history=context.designedHistory;if(!history)fail('input_identity_unverified','designedHistory','original H verified designed history required');
  this.assertDesignedTaskBinding(task,context.spec,history.contract,context.selectionRef);const current=readDesignedSelectionHistory(history.session);
  if(current.specRef!==`offline-selection-spec/${context.spec.outputId}@sha256:${digest(context.spec)}`||!equal(current.usedSelectionRefs.filter((r:string)=>r!==context.selectionRef),history.priorSelectionRefs)||this.designedHistoryIdentity(task,history.priorSelectionRefs,state).identity!==history.historyStateSHA256||history.files.some((f:any)=>this.designedFileSignal(f.path)!==f.signal))fail('selection_execution_uncertain','designedHistory','original used source/checkpoint/occupancy changed before locked admission');
 }
 private async firstRoundBlindDatasetProjection(task:any,spec:any,references:Map<string,any>,selection:any){const trusted=await this.offlineSelectionHostInputs(spec,{phase:'label-start',task}),{verifyOfflineSelection}=await import('./offline-selection'),proof=verifyOfflineSelection(selection,{...trusted,phase:'dataset'});return prepareBlindReviewProjection(task,references,{offlineSelection:trusted,readFirstRoundReference:(r:string)=>this.resolveRef(r),readFirstRoundEvidence:(f:any)=>this.evidenceBytes(f)},proof);}
 private async datasetLabelTerminals(spec:any,references:Map<string,any>,state:any,grant:any,designedTrusted?:any){
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
   const screenContract=references.get(task.scientificContract.decisionRuleRef);
   if(['ohuo-first-round-screen-contract-v1','ohuo-common-view-screen-contract-r2'].includes(screenContract?.schema)){
    const context=this.selectionAdmissionContext(task,candidates[0][1],spec,references,undefined,designedTrusted);this.checkFirstRoundScreenHistory(task,state,context,screenContract);
    if(cp.schema!=='ohuo-first-round-screen-run-v1'||cp.taskSHA256!==run.taskSHA256||cp.selectionRef!==selectionRef||cp.contractRef!==task.scientificContract.decisionRuleRef||!integer(cp.rootCursor)||!Array.isArray(cp.plans)||!Array.isArray(cp.attempts)||cp.active!==null||cp.executionUnknown||!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||digest(cp)!==run.checkpointSHA256||run.checkpointRef!==join(task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)||!equal(this.jsonBytes(this.regular(run.checkpointRef)),cp))fail('label_checkpoint_identity_unverified','screenCheckpoint','original settled screen checkpoint is separate from teacher terminal rows');
    continue; // Actual screen evidence is independently joined by the new freezer.
   }
   const route=screenContract?.routingRef?references.get(screenContract.routingRef):null,independent=route?.schema==='ohuo-common-view-teacher-routing-r2'&&route.role==='independent-review';
   let blindProjection:any=null;
   if(screenContract?.schema==='ohuo-first-round-blind-review-contract-v1'){
    blindProjection=await this.firstRoundBlindDatasetProjection(task,spec,references,candidates[0][1]);
    const context=this.selectionAdmissionContext(task,candidates[0][1],spec,references,blindProjection);this.checkOfflineSelectionAdmission(task,state,context);
    if(!equal(cp.blindReview,blindProjection.checkpointBinding)||cp.cursor>blindProjection.selection.rows.length)fail('label_checkpoint_identity_unverified','blindCheckpoint','exact fixed independent diagnostic allocation required');
   }else if(cp.blindReview!==undefined)fail('label_checkpoint_identity_unverified','blindCheckpoint','no unnamed diagnostic exception');
   if(cp.schema!=='ohuo-offline-label-run-v1'||cp.taskSHA256!==run.taskSHA256||cp.selectionRef!==selectionRef||!integer(cp.cursor)||!Array.isArray(cp.rows)||cp.rows.length!==cp.cursor||digest(cp)!==run.checkpointSHA256||run.checkpointRef!==join(task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)||!equal(this.jsonBytes(this.regular(run.checkpointRef)),cp))fail('label_checkpoint_identity_unverified','checkpoint','original immutable committed checkpoint bytes required');
   for(const [index,row] of cp.rows.entries()){const p=row.resultRef;if(!p||Object.keys(p).sort().join(',')!=='path,sha256'||p.path!==join(task.outputRoot,'labels',`q${index}.json`)||!hash(p.sha256))fail('label_checkpoint_identity_unverified','resultRef','original fixed label terminal path/bytes required');
    const mappings=[...this.evidence].filter(([,f])=>this.relativePath(f.path)===p.path&&f.sha256===p.sha256);if(mappings.length!==1)fail(mappings.length?'label_terminal_catalog_ambiguous':'label_terminal_catalog_unavailable','resultRef','every committed terminal requires one original fixed F mapping');
    const [id,file]=mappings[0],terminal=this.readJSON(file);if(terminal.schema!=='ohuo-offline-label-result-v1'||terminal.purpose!==(blindProjection?'first_round_blind_diagnostic':'b_training_source')||terminal.selectionRef!==selectionRef||terminal.index!==index||!equal(terminal.key,row.key)||terminal.inputSHA256!==row.inputSHA256||terminal.status!==row.status||terminal.labelKind!==row.labelKind)fail('label_checkpoint_identity_unverified','terminal','terminal must equal its original committed row');
    if(blindProjection){const expected=blindProjection.selection.rows[index],teacher=references.get(screenContract.secondaryLabelPolicyRef);if(!expected||!equal(terminal.source,expected)||!equal(terminal.blindReview,blindProjection.checkpointBinding)||terminal.labelKind!==null||terminal.offlineLabel!==null||terminal.teacher?.releaseRef!==teacher.releaseRef||['profileId','revision','snapshotHash'].some(k=>terminal.teacher?.profileSnapshot?.[k]!==teacher.profileRevisionRef[k]))fail('label_checkpoint_identity_unverified','blindTerminal','original secondary profile and diagnostic-only fixed result required');continue;}
    if(independent){if(terminal.commonView?.routingRole!=='independent-review'||terminal.labelKind!==null||terminal.offlineLabel!==null)fail('label_checkpoint_identity_unverified','routingDiagnostic','independent review is not a training suggestion');continue;}
    out.push({id,sha256:file.sha256});
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
  else if(rule.stage===4&&task.taskKind==='collect'&&rule.phase===null&&cap.id==='B07.designed-source.v1'&&rule.purpose==='designed-source')required=['teacher-transferability','student-visibility-and-initial-c','frozen-source-layout','budget-scope','designed-public-train-gap'];
  else if(rule.stage===4&&task.taskKind==='collect'&&rule.phase===null&&['B07.complete-match.v1','B07.offline-label.v1'].includes(cap.id))required=['teacher-transferability','student-visibility-and-initial-c','frozen-source-layout','budget-scope',...(cap.id==='B07.offline-label.v1'?['selection-production']:[])];
  else if(rule.stage===5&&task.taskKind==='supervised_training'&&cap.id==='B10.supervised-rerank.v1'&&b&&rule.phase===b.trainingPhase&&['calibration','formal'].includes(rule.phase))required=['teacher-transferability','dataset-qualification','fixed-parent-recipe','budget-scope',...(rule.phase==='formal'?['calibration-qualification']:[])];
  else if(rule.stage===6&&rule.phase===null&&['B07.complete-match.v1','B07.offline-label.v1'].includes(cap.id)&&['evaluate','collect'].includes(task.taskKind))required=['student-selection','frozen-comparison-conditions','new-source-isolation','budget-scope',...(cap.id==='B07.offline-label.v1'?['selection-production']:[]),...(task.sourcePlan.split==='confirm'?['confirmation-isolation']:[])];
  else fail('stage_mapping_unverified','stage','capability/phase has no original fixed stage mapping');
  if(b?.numericalRestartReceiptRef!==null&&b?.numericalRestartReceiptRef!==undefined)required.push('numerical-restart');
  const kinds=strings(rule.requiredKinds,'requiredKinds');if(required.some(k=>!kinds.includes(k)))fail('prerequisites_missing','requiredKinds','original stage minimum cannot be omitted');
  const actualKinds=new Set<string>();for(const p of entry.prerequisiteReceipts){const requirement=this.resolveRef(p.requirementRef);strictObject(requirement,'stagePrerequisite',['schema','stage','phase','kind','sourceRuleRef']);if(requirement.schema!=='ohuo-stage-prerequisite-v1'||requirement.stage!==rule.stage||requirement.phase!==null&&requirement.phase!==rule.phase||!string(requirement.kind)||actualKinds.has(requirement.kind))fail('prerequisites_missing','requirement','exact original stage/kind/phase required');this.resolveRef(requirement.sourceRuleRef);actualKinds.add(requirement.kind);const r=this.prerequisiteReceipt(p.receiptRef,task,p.requirementRef);const specific:any={'teacher-transferability':'scientific-decision','designed-public-train-gap':'scientific-decision','screening-conclusion':'scientific-decision','dataset-qualification':'dataset-qualification','student-selection':'student-selection','numerical-restart':'numerical-restart','calibration-qualification':'calibration-qualification'};if(specific[requirement.kind]&&r.kind!==specific[requirement.kind])fail('prerequisites_missing','receipt.kind','original specialized prerequisite required');}
  if(kinds.some((k:string)=>!actualKinds.has(k)))fail('prerequisites_missing','requiredKinds','original required kind lacks a real receipt');
 }
 /** One named, evidence-bound correction of the completed u1 diagnostic.
  * This is not a general completed-run retry or a source override. */
 private formalStopCorrection(task:any,state:any){
  if(task.retryReasonRef===null)return null;const proof=this.resolveRef(task.retryReasonRef);
  if(proof?.schema!=='ohuo-r2-formal-stop-correction-v1')return null;
  strictObject(proof,'formalStopCorrection',['schema','taskId','runId','experimentId','parentTaskRef','priorSummaryRef','priorStateRef','diagnosticRef','scientificReviewRef','priorSourceRef','currentSourceRef','acceptedReceiptRef','oldContractFile','newContractFile']);
  const id='r1-training-formal-stop-correction-1';
  if(proof.taskId!==id||proof.runId!==id||proof.experimentId!=='v530-r2-formal-stop-correction-1'||task.taskId!==id||task.runId!==id||task.experimentId!==proof.experimentId||task.parentTaskId!=='r1-training-formal'||task.scientificContract?.decisionRuleRef!==task.retryReasonRef)fail('scientific_revision_unverified','identity','only the named reviewed correction');
  for(const ref of [proof.parentTaskRef,proof.priorSourceRef,proof.currentSourceRef])fixedReference(ref,'correctionReference');
  const parent=validateTask(this.resolveRef(proof.parentTaskRef)),saved=this.jsonBytes(this.evidenceBytes(proof.priorStateRef)),oldRun=state.runs?.[parent.runId],oldLedger=state.budgets?.[parent.budgetRef];
  if(parent.taskId!=='r1-training-formal'||parent.runId!==parent.taskId||task.sourceRevision!==proof.currentSourceRef||parent.sourceRevision!==proof.priorSourceRef||task.sourceRevision===parent.sourceRevision||!equal(oldRun,saved.runs?.[parent.runId])||state.tasks[parent.taskId]!==parent.runId||oldRun?.taskRef!==proof.parentTaskRef||oldRun.taskSHA256!==digest(parent)||!equal(oldRun.task,parent)||oldRun.status!=='completed'||oldRun.cleanupConfirmed!==true||oldRun.executionUnknown===true||oldRun.observationStatus==='unknown'||oldRun.checkpoint?.executionUnknown===true||oldRun.checkpoint?.optimizerSteps!==1||oldLedger?.activeRunId===parent.runId||Object.values(oldLedger?.reservations??{}).some((r:any)=>r.runId===parent.runId&&['reserved','reserved_unknown'].includes(r.status)))fail('scientific_revision_unverified','parent','actual clean completed u1 parent retained');
  const expected={...parent,taskId:id,runId:id,experimentId:proof.experimentId,attemptId:id+'-a1',parentTaskId:parent.taskId,retryReasonRef:task.retryReasonRef,sourceRevision:proof.currentSourceRef,outputRoot:join(this.root,'runs',id),scientificContract:{...parent.scientificContract,decisionRuleRef:task.retryReasonRef}};
  if(!equal(task,expected))fail('scientific_revision_unverified','task','same complete scientific fields; only named revision identities change');
  const summary=this.jsonBytes(this.evidenceBytes(proof.priorSummaryRef)),summaryFile=this.evidence.get(proof.priorSummaryRef.id),diagnostic=this.jsonBytes(this.evidenceBytes(proof.diagnosticRef));
  if(!oldRun.consumerArtifactRefs?.some((f:any)=>f.path===this.relativePath(summaryFile.path)&&f.sha256===summaryFile.sha256)||summary.schema!=='ohuo-supervised-summary-v1'||summary.runId!==parent.runId||summary.taskSHA256!==digest(parent)||summary.plan?.phase!=='formal'||summary.actual?.optimizerSteps!==1||summary.actual?.learningObservation?.decision!=='diagnostic_stop'||summary.actual.learningObservation.reason!=='development_deterioration_risk'||summary.frozenRefs?.sourceRevision!==parent.sourceRevision||summary.frozenRefs.dataset!==parent.datasetRefs[0])fail('scientific_revision_unverified','summary','actual original diagnostic summary required');
  const ms=summary.metrics;if(!Array.isArray(ms)||ms.length!==2||ms[0].optimizerSteps!==0||ms[1].optimizerSteps!==1||!(ms[1].demoCE<ms[0].demoCE)||!(ms[1].train.demoCE<ms[0].train.demoCE)||!['pass','takeover'].some(d=>ms[1].directionMetrics[d].demoCE>ms[0].directionMetrics[d].demoCE))fail('scientific_revision_unverified','observation','specific direction-only diagnostic, not arbitrary completed training');
  if(diagnostic.schema!=='ohuo-r2-fixed-dev-diagnostic-evidence-v1'||diagnostic.status!=='diagnostic_only_not_candidate_not_finalization'||diagnostic.finalizationAuthorized!==false||diagnostic.taskRef!==proof.parentTaskRef||diagnostic.taskSHA256!==digest(parent)||diagnostic.summaryRef?.sha256!==proof.priorSummaryRef.sha256||!equal(diagnostic.learningObservation,summary.actual.learningObservation)||!Array.isArray(diagnostic.rows)||diagnostic.rows.length!==diagnostic.counts.dev||diagnostic.counts.dev!==ms[1].demoCount+ms[1].keepCount)fail('scientific_revision_unverified','diagnostic','actual all-dev diagnostic bound to parent');
  const review=this.jsonBytes(this.evidenceBytes(proof.scientificReviewRef));strictObject(review,'scientificReview',['schema','decision','priorSummaryRef','diagnosticRef','planRevisionRef','fourCaseReviewRef','allowedChangedPaths','rationale']);
  const allowed=['lab/review6_2/first-round-contract.mjs','lab/review6_2/ohuo-host-files.ts','lab/review6_2/checks/formal-stop-correction-smoke.mjs','scripts/ohuo-delivery/checks.mjs'];
  if(review.schema!=='ohuo-formal-stop-correction-scientific-review-v1'||review.decision!=='PASS'||!equal(review.priorSummaryRef,proof.priorSummaryRef)||!equal(review.diagnosticRef,proof.diagnosticRef)||!sameRefs(review.allowedChangedPaths,allowed)||!string(review.rationale))fail('scientific_revision_unverified','review','explicit saved-plan and actual diagnostic review required');
  const savedPlan=this.jsonBytes(this.evidenceBytes(review.planRevisionRef));
  if(review.planRevisionRef.sha256!=='ad7e524a80bf32bfa61b2159b68ed49929093109bcf3fd1aed8151bef772e2f4'||savedPlan.schema!=='guandan-saved-plan-stop-correction-v1'||savedPlan.status!=='SAVED_AND_READBACK_BYTE_EXACT'||savedPlan.document?.library_file_id!=='libfile_3f00fde4b97481919c96e65c185d5e4b'||savedPlan.document.current_version_number!==28||savedPlan.document.business_version!=='5.3.0'||savedPlan.document.sha256!=='c1b17fbd3d2a096cdb6a25152226bc467f87c7e04b916fd8306e0819666cbdc7'||savedPlan.scientific_design_review?.decision!=='PASS_DESIGN_NOT_RUNTIME_ACCEPTANCE'||savedPlan.document_delta_review?.decision!=='PASS_SCIENTIFIC_TEXT_DELTA'||savedPlan.document_delta_review.sha256!=='cbbf8fe083f107892b043c7ac5426513cdd2a840d71f765a6a6c0f3a7430d151'||this.jsonBytes(this.evidenceBytes(review.fourCaseReviewRef)).decision!=='DIAGNOSTIC_EVIDENCE_ACCEPTED_NOT_CANDIDATE')fail('scientific_revision_unverified','planReview','exact saved v28 amendment and four-case independent evidence required');
  const priorSource=this.resolveRef(proof.priorSourceRef),currentSource=this.resolveRef(proof.currentSourceRef),accepted=this.jsonBytes(this.evidenceBytes(proof.acceptedReceiptRef));
  if(accepted.functionalStatus!=='accepted'||!equal(accepted.acceptedCodeRef,currentSource)||priorSource.baseCommit!==currentSource.baseCommit||!Array.isArray(priorSource.files)||!Array.isArray(currentSource.files))fail('scientific_revision_unverified','source','actual accepted version pair required');
  const before=new Map<string,string>(priorSource.files.map((f:any)=>[f.path,f.sha256])),after=new Map<string,string>(currentSource.files.map((f:any)=>[f.path,f.sha256]));if(before.size!==priorSource.files.length||after.size!==currentSource.files.length||!before.size||[...before].some(([p])=>!after.has(p))||[...after].some(([p,h])=>before.get(p)!==h&&!allowed.includes(p)))fail('scientific_revision_unverified','sourceDelta','only this reviewed stop and host integration delta; numerical dependencies unchanged');
  const oldContract=this.evidenceBytes(proof.oldContractFile).toString('utf8'),newContract=this.evidenceBytes(proof.newContractFile).toString('utf8'),oldTerm="if(current.demoCE>previous.demoCE||r2Directions.some(d=>current.directionMetrics[d].demoCE>previous.directionMetrics[d].demoCE))return stop('development_deterioration_risk');",newTerm="if(current.demoCE>previous.demoCE)return stop('development_deterioration_risk');";
  if(proof.oldContractFile.sha256!==before.get(allowed[0])||proof.newContractFile.sha256!==after.get(allowed[0])||oldContract.split(oldTerm).length!==2||oldContract.replace(oldTerm,newTerm)!==newContract)fail('scientific_revision_unverified','contract','exact approved one-term removal only');
  const oldBinding=this.bindings.get(proof.parentTaskRef),newBinding=this.bindings.get(this.taskEntry(task,this.readGrant()).taskRef);if(oldBinding?.trainingPhase!=='formal'||newBinding?.trainingPhase!=='formal'||!equal({...oldBinding,taskRef:newBinding.taskRef},newBinding))fail('scientific_revision_unverified','binding','same seed/dataset/source-index and S0 formal inputs');
  return {schema:'ohuo-verified-formal-stop-correction-v1',priorSourceRef:proof.priorSourceRef,currentSourceRef:proof.currentSourceRef,parentTaskRef:proof.parentTaskRef};
 }
 /** One data-only revision after the actual completed 127-update diagnostic. */
 private trainCoverageLearning(task:any,state:any){
  if(task.retryReasonRef===null)return null;const value=this.resolveRef(task.retryReasonRef);if(!['ohuo-r2-train-coverage-correction-v1','ohuo-r2-train-coverage-correction-v2'].includes(value?.schema))return null;
  const references=new Map<string,any>();for(const [ref]of this.references)references.set(ref,this.resolveRef(ref));
  const proof=verifyTrainCoverageRevision(task.retryReasonRef,{repositoryRoot:this.repositoryRoot,controlRoot:this.root,references,evidenceFiles:new Map(this.evidence)} as any,state),role=proof.learningTasks.find((r:any)=>r.taskId===task.taskId),parent=validateTask(this.resolveRef(proof.priorFormalTaskRef));
  if(!role||task.runId!==role.runId||task.experimentId!==role.experimentId||task.parentTaskId!==parent.taskId||task.attemptId!==role.taskId+'-a1'||task.scientificContract.decisionRuleRef!==task.retryReasonRef||task.outputRoot!==join(this.root,'runs',task.runId))fail('coverage_learning_identity','Task','named new-data learning role only');
  for(const k of ['taskKind','planRef','planVersion','budgetRef','authorizationRef','researchBatchId','capabilityRef','parentPolicyRef','learnerRecipe','releaseRefs','runtimeRef','sourcePlan','seatLayoutPlan','promptRef','rulesRef','labelPolicyRef'])if(!equal(task[k],parent[k]))fail('coverage_learning_identity',k,'same original S0/recipe/scope, no concurrent algorithm change');
  if(task.scientificContract.analysisMethodRef!==parent.scientificContract.analysisMethodRef||task.outputSpec?.proposalPolicyRef!==parent.outputSpec?.proposalPolicyRef||task.datasetRefs?.length!==1||task.datasetRefs[0]===proof.previousDatasetRef)fail('coverage_learning_dataset','Task','one new actual cumulative dataset');
  const entry=this.taskEntry(task,this.readGrant()),binding=this.bindings.get(entry.taskRef),oldBinding=this.bindings.get(proof.priorFormalTaskRef);
  if(binding?.trainingPhase!==role.phase||binding.seed!==oldBinding?.seed||!equal(binding.sourceIndexFile,oldBinding.sourceIndexFile)||(role.phase==='calibration'?task.limits.maxOptimizerSteps!==1:!isScientificObservationLimits(task.limits)))fail('coverage_learning_phase','binding','true new one-update calibration then original formal conditions');
  const load=(ref:string,directory:string)=>{const desc=this.resolveRef(ref);if(desc.schema!=='ohuo-frozen-dataset-ref-v1')fail('coverage_learning_dataset','schema','original frozen dataset');const dir=this.directory(directory),manifest=this.readJSON({path:relative(this.repositoryRoot,join(dir,'manifest.json')),sha256:desc.manifestSHA256});if(manifest.qualification?.eligible!==true)fail('coverage_learning_dataset','qualification','actual eligible dataset');const bytes=this.readFile({path:relative(this.repositoryRoot,join(dir,manifest.samples.path)),sha256:manifest.samples.sha256}),rows=bytes.toString().trim().split('\n').map((line:string)=>JSON.parse(line));return{manifest,rows};};
  const old=load(proof.previousDatasetRef,oldBinding.datasetDirectory),now=load(task.datasetRefs[0],binding.datasetDirectory),sampling=now.manifest.plan?.cumulativeSampling;
  if(now.manifest.cumulativeEvidence?.previousDatasetRef!==proof.previousDatasetRef||now.manifest.cumulativeEvidence?.previousManifestSHA256!==this.resolveRef(proof.previousDatasetRef).manifestSHA256||!equal(now.manifest.plan.identities,old.manifest.plan.identities)||sampling?.selectionRefs?.length!==proof.round+1||sampling.selectionRefs[proof.round-1]!==proof.parentSelectionRef||sampling.previousDatasetRef!==proof.previousDatasetRef)fail('coverage_learning_dataset','prefix','exact old dataset and authorized third selection');
  const selection=this.resolveRef(sampling.selectionRefs[proof.round]),production=this.resolveRef(selection.productionRef),spec=this.resolveRef(production.specRef),contract=this.resolveRef(spec.roundContractRef);
  if(contract.coverageRevisionRef!==task.retryReasonRef||contract.round!==proof.round||!selection.rows.length||selection.rows.some((r:any)=>r.split!=='train'))fail('coverage_learning_dataset','selection','actual train-only authorized round');this.commonViewRoundProof(spec,state);
  const oldRows=new Map(old.rows.map((r:any)=>[r.decisionId,r])),newRows=new Map(now.rows.map((r:any)=>[r.decisionId,r]));if(oldRows.size!==old.rows.length||newRows.size!==now.rows.length)fail('coverage_learning_dataset','duplicates','unique original identities');
  for(const r of old.rows.filter((r:any)=>r.sampleKind==='demo'))if(!equal(newRows.get(r.decisionId),r))fail('coverage_learning_dataset','oldDemo','all valid old demos unchanged');
  if(now.rows.some((r:any)=>r.sampleKind==='demo'&&!oldRows.has(r.decisionId)&&r.split!=='train'))fail('coverage_learning_dataset','newDemo','new demos train only');
  const dev=(rows:any[],oldSampling:string)=>rows.filter((r:any)=>r.split==='dev').map((r:any)=>{const copy=structuredClone(r);if(copy.sampleKind==='keep'){if(copy.provenance?.samplingRef!==oldSampling)fail('coverage_learning_dataset','devSampling','original same-split keep sampling');copy.provenance.samplingRef='same-frozen-dev-sampling';}return copy;}).sort((a:any,b:any)=>a.decisionId.localeCompare(b.decisionId));
  if(!equal(dev(old.rows,old.manifest.plan.samplingRef),dev(now.rows,now.manifest.plan.samplingRef)))fail('coverage_learning_dataset','dev','old dev content unchanged except mechanical keep samplingRef');
  return{schema:'ohuo-verified-train-coverage-learning-v1',phase:role.phase};
 }

 assertActionTaskLineage(task:any,action:any,state:any,numerical:any=null){
  if(this.trainCoverageLearning(task,state))return;
  if(this.formalStopCorrection(task,state))return;
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
 checkPlan=async(task:any)=>withCoverageEligibilityScope(digest(task),()=>this.checkPlanScoped(task),this.roundProofSessionFor(task),"checkPlan");
 private checkPlanScoped=async(task:any)=>{
  if(this.screenRevalidation)assertScreenRevalidationContext(this.screenRevalidation,task,this.root);
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
 readFirstRoundBudgetAuthority(request:any,verifyExisting=false){
  strictObject(request,'allocationRequest',['schema','planRef','planVersion','clauseRef','branchRef','budgetRef','ruleRef','controlStateRef','pilotSelectionRef','stepFallback','dsFallback','initialGrantRef']);
  if(request.schema!=='ohuo-first-round-budget-allocation-request-v1'||!integer(request.planVersion,1)||request.branchRef!==null)fail('first_round_allocation_invalid','request','only original mechanical nonbranch allocation request');
  for(const k of ['planRef','clauseRef','budgetRef','ruleRef','pilotSelectionRef'])fixedReference(request[k],k);
  const grant=this.readGrant(),plan=this.resolveRef(request.planRef),rule=this.resolveRef(request.ruleRef);
  strictObject(rule,'allocationRule',['schema','originalRuleRef','pilotSelectionRuleRef','pilotReadoutRuleRef','stageClauses']);
  if(rule.schema!=='ohuo-first-round-budget-allocation-rule-v1'||grant.planRef!==request.planRef||grant.planVersion!==request.planVersion||plan.planVersion!==request.planVersion||!grant.scope.localExecution)fail('authorization_unverified','allocation','same original plan/grant/local scope required');
  for(const k of ['originalRuleRef','pilotSelectionRuleRef','pilotReadoutRuleRef']){fixedReference(rule[k],k);this.resolveRef(rule[k]);}
  const initialBytes=this.evidenceBytes(request.initialGrantRef),initial=this.jsonBytes(initialBytes),genesis=this.jsonBytes(this.regular(this.genesisPath(),true));
  if(sha(initialBytes)!==genesis.grantFileSHA256||initial.schema!=='ohuo-local-research-grant-v1'||initial.initialization!=='new-control-root'||!equal(initial.approvalEvidence,grant.approvalEvidence)||!equal(initial.limits,this.resolveRef(request.budgetRef).limits)||['authorizationRef','planRef','planVersion','controlRoot','rootInstanceId','initialStateRef','mode','scope','allowedTaskKinds','allowedCapabilityIds'].some(k=>!equal(initial[k],grant[k])))fail('authorization_unverified','initialGrantRef','original genesis grant and exact approval evidence must remain unchanged');
  const scope={planRef:request.planRef,planVersion:request.planVersion,planScope:{clauseRef:request.clauseRef,branchRef:null}},approved=this.readApprovedAction(scope),action=approved.action,closeout=this.readCloseout(),prior=this.priorPlanObservation(scope,closeout,this.checkExistingRoot());
  if(!verifyExisting&&(closeout.entity.status!=='incomplete'||prior&&prior.status!=='incomplete'))fail('plan_closed','allocation','original closed plan cannot allocate');
  const current=closeout.entity.actions.filter((a:any)=>a.clauseRef===action.clauseRef&&a.branchRef===null&&equal(a.plannedTaskIds,action.plannedTaskIds));
  if(action.acceptanceRuleRef!==request.ruleRef||action.plannedTaskIds.length||!equal(action.expectedArtifactKinds,['ohuo-first-round-budget-allocation-v1'])||current.length!==1||!(verifyExisting?['not_executed','completed']:['not_executed']).includes(current[0].status)||current[0].unresolved.length)fail('original_action_conflict','allocation','original named nonrunner action required');
  const stageClauses=Object.values(rule.stageClauses).flat();if(stageClauses.some((clause:any)=>approved.actions.filter((a:any)=>a.clauseRef===clause).length!==1))fail('original_action_conflict','stageClauses','only unique original approved clauses may receive stage time');
  return {grant,rule};
 }
 async readFirstRoundPilotProduction(selectionRef:string){
  const selection=this.resolveRef(selectionRef),production=this.resolveRef(selection.productionRef),spec=this.resolveRef(production.specRef),inputs=await this.offlineSelectionHostInputs(spec,{phase:'dataset'}),{verifyOfflineSelection}=await import('./offline-selection');return verifyOfflineSelection(selection,inputs);
 }
 prepareFirstRoundBudgetAllocation=(requestRef:string,state:any)=>prepareFirstRoundBudgetAllocation(this,requestRef,state);
 verifyFirstRoundBudgetAllocation=(receipt:any,state:any)=>verifyFirstRoundBudgetAllocation(this,receipt,state);
 freezeFirstRoundBudget=(requestRef:string)=>{if(this.readGrant().schema==='ohuo-local-research-grant-v2')fail('obsolete_allocation_operation','requestRef','common-view protocol uses original accounting without a new whole-round quota allocation');return freezeFirstRoundBudget(this,requestRef);};
 async resolveFirstRoundAllocation(task:any,budget:any){
  if(this.commonViewTaskProtocol(task))return null;
  const state=this.checkExistingRoot(),ledger=state.budgets?.[task.budgetRef];if(!ledger)fail('budget_state_missing','budgetRef','original shared ledger required');
  const receipt=readFirstRoundAllocation({root:this.root,budgetRef:task.budgetRef,ledger});
  if(!receipt){const plan=this.resolveRef(task.planRef),actions=plan.actions??this.resolveRef(plan.actionsRef).actions,rules=actions.map((a:any)=>this.resolveRef(a.acceptanceRuleRef)).filter((r:any)=>r.schema==='ohuo-first-round-budget-allocation-rule-v1');if(rules.length&&(rules.length!==1||!rules[0].stageClauses.pilot.includes(task.planScope.clauseRef)))fail('first_round_allocation_required','budgetRef','formal tasks require the original measured-cost freeze');return null;}
  await this.verifyFirstRoundBudgetAllocation(receipt,state);if(!equal(budget.limits,receipt.baselineLimits)||task.planVersion!==receipt.planVersion)fail('budget_identity_mismatch','allocation','original budget/version differs');
  firstRoundStageRemaining({state,task,receipt});return receipt;
 }
 genesisPath(){return join(this.repositoryRoot,'deliverables/ohuo-runtime/initializations',sha(this.manifest.controlRoot)+'.json');}
 checkExistingRoot(){
  const marker=this.genesisPath(),statePath=join(this.screenRevalidation?.storageRoot??this.root,'state.json');if(!existsSync(statePath))fail('budget_state_missing','stateRoot','existing consumption is required, never initialize implicitly');
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
 /** Fixed designer preparation shares H, original receipts and TC admission.
  * The original scientific receipt binds the public request scope; strict
  * serialization sends only public coverage/rules, never the report or labels. */
 private async designerInputs(task:any,refs:Map<string,any>,result:any){
  if(this.screenRevalidation)fail('revalidation_scope','designer','historical local screen benchmark cannot invoke a designer');
  const grant=this.readGrant(),entry=this.taskEntry(task,grant),binding=this.bindings.get(entry.taskRef),action=this.readApprovedAction(task).action;
  await this.checkAuthorization(task);this.prerequisites(task,grant,action);this.assertActionTaskLineage(task,action,this.checkExistingRoot());
  if(!binding||binding.confirmedRecordRoots.length||binding.studentReleaseFiles.length||binding.datasetDirectory!==null||binding.seed!==null||binding.trainingPhase!==null||binding.numericalRestartReceiptRef!==null)fail('input_identity_unverified','designerInputs','public design input cannot acquire natural records, student files or training inputs');
  const catalog=new Map<string,any>();for(const [ref]of this.references)catalog.set(ref,freezeJSON(this.resolveRef(ref)));
  const contract=this.resolveRef(task.scientificContract.decisionRuleRef);strictObject(contract,'designerContract',['schema','sourceIndexRef','requestInventoryRef','configurationRef','promptRef','rulesRef','sourceRevision','coverageApprovalRef']);
  if(contract.schema!=='ohuo-designed-source-contract-v1')fail('input_identity_unverified','designerContract','explicit fixed designer contract required');
  const approval=this.resolveRef(contract.coverageApprovalRef);strictObject(approval,'designerCoverage',['schema','planRef','sourceIndexRef','rulesRef','coverageCells','evidenceRef']);
  if(approval.schema!=='ohuo-designed-public-coverage-approval-v1'||approval.planRef!==task.planRef||approval.rulesRef!==task.rulesRef)fail('prerequisite_input_mismatch','designerCoverage','same original plan/index/rules and exact public scope required');
  if(approval.sourceIndexRef!==task.sourcePlan.sourceIndexRef){const proof=verifyDesignedFamilyReservationLink({task,contract,repositoryRoot:this.repositoryRoot,references:catalog,evidenceFiles:new Map(this.evidence),sourceIndexPath:result.sourceIndexPath});this.readNonrunnerAction(proof.spec,'designed-family-reservation');}
  fixedReference(approval.evidenceRef,'designerCoverage.evidenceRef');const report=this.resolveRef(approval.evidenceRef);
  const requirements=entry.prerequisiteReceipts.filter((p:any)=>this.resolveRef(p.requirementRef).kind==='designed-public-train-gap');if(requirements.length!==1)fail('prerequisites_missing','designed-public-train-gap','one original actual scientific prerequisite required');
  const receipt=this.prerequisiteReceipt(requirements[0].receiptRef,task,requirements[0].requirementRef),hasJSON=(ref:string)=>receipt.evidence_refs.some((f:any)=>{try{return digest(this.jsonBytes(this.evidenceBytes(f)))===ref.split(':').at(-1);}catch{return false;}});
  if(receipt.kind!=='scientific-decision'||receipt.analysisRef===null||!hasJSON(contract.coverageApprovalRef)||!hasJSON(approval.evidenceRef)||!report||typeof report.schema!=='string')fail('prerequisite_input_mismatch','designerCoverage','original scientific decision must cite this exact scope and real public coverage report');
  const config=this.resolveRef(contract.configurationRef);strictObject(config,'designerConfiguration',['schema','profileRevisionRef','publicProfileRef']);if(config.schema!=='ohuo-designed-source-configuration-v1')fail('input_identity_unverified','designerConfiguration','explicit public profile snapshot required');
  result.designerRepositoryRoot=this.repositoryRoot;result.designerEvidenceFiles=new Map(this.evidence);result.designerCatalog=catalog;result.designerProfile={configurationRef:contract.configurationRef,reference:config.profileRevisionRef,publicProfile:this.resolveRef(config.publicProfileRef)};result.datasetDirectory=null;result.seed=null;
  const {verifyDesignedSourceInputs}=await import('./designed-source-consumer'),prepared=verifyDesignedSourceInputs({task,refs,inputs:result});
  if(!this.commonViewTaskProtocol(task,grant))fail('protocol_identity_unverified','designer','original approved input-workload policy required');
  await verifyDesignedSourceIndexSuccessor(this.repositoryRoot,task.sourcePlan.sourceIndexRef);
  result.inputWorkload={providerRequests:prepared.requests.length,labelDecisions:0,matchAttempts:0,optimizerSteps:0};
  const files=[{path:'deliverables/ohuo-runtime/host.json'},this.manifest.grantFile,{path:this.manifest.planCloseoutFile},...this.references.values(),...this.evidence.values(),...this.resolveRef(task.sourceRevision).files],pins=[...new Map(files.map((f:any)=>{const path=this.relativePath(f.path);return [path,{path,signal:this.designedFileSignal(path)}];})).values()];
  const context=freezeJSON({designedSource:true,taskSHA256:digest(task),contractRef:task.scientificContract.decisionRuleRef,coverageApprovalRef:contract.coverageApprovalRef,coverageEvidenceRef:approval.evidenceRef,requestOrder:prepared.requests.map((r:any)=>({questionId:r.questionId,requestSHA256:digest(r)})),pins});this.selectionContexts.add(context);result.offlineSelectionAdmissionContext=context;this.checkDesignedSourceAdmission(task,this.checkExistingRoot(),context);
 }
 /** Historical family evidence is read only for an actual settled designer.
  * This scope never surrounds a Task start/resume or current input admission. */
 private readDesignerFamilyHistory(task:any,spec:any){
  const grant=this.readGrant(),currentProtocolRef=this.resolveRef(grant.resourcePolicyRef).protocolRevisionRef,previousProtocolRef=task.scientificContract.analysisMethodRef;
  if(currentProtocolRef===previousProtocolRef)return this.readNonrunnerAction(spec,'designed-family-reservation');
  const entry=this.taskEntry(task,grant),state=this.checkExistingRoot(),run=state.runs?.[task.runId],cp=run?.checkpoint,ledger=this.assertDesignedLedger(state,task);
  if(this.#designedProtocolHistory!==null||this.resolveRef(task.capabilityRef)?.id!=='B07.designed-source.v1'||spec.protocolRef!==previousProtocolRef||spec.planRef!==task.planRef||spec.budgetRef!==task.budgetRef||!run||run.taskRef!==entry.taskRef||run.taskSHA256!==digest(task)||!equal(run.task,task)||state.tasks[task.taskId]!==task.runId||task.outputRoot!==join(this.root,'runs',task.runId))fail('state_history_conflict','designerFamilyHistory','one actual original designer Task and family protocol required');
  if(!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.stopReason==='execution_uncertain'||run.failureReason==='execution_uncertain'||cp?.executionUnknown===true||cp?.active!=null||(cp?.rows??[]).some((r:any)=>r.requestCount===null)||ledger.activeRunId===run.runId||Object.values(ledger.reservations).some((r:any)=>r.runId===run.runId&&['reserved','reserved_unknown'].includes(r.status)))fail('selection_execution_uncertain','designerFamilyHistory','historical designer must be safely settled');
  if(!isDesignedSourceCheckpoint(cp)||cp.binding.taskSHA256!==digest(task)||run.checkpointSHA256!==digest(cp)||run.checkpointRef!==join(task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)||!equal(this.jsonBytes(this.regular(run.checkpointRef)),cp)||!equal(this.jsonBytes(this.regular(join(task.outputRoot,'task.json'))),task)||sha(this.regular(join(task.outputRoot,'task.json')))!==run.taskSHA256)fail('state_history_conflict','designerFamilyHistory','original immutable Task and checkpoint bytes required');
  const references=new Map<string,any>();for(const [ref]of this.references)references.set(ref,this.resolveRef(ref));const lineage=verifyDesignedProtocolLineage({currentProtocolRef,previousProtocolRef,references});
  this.#designedProtocolHistory={...lineage,allowedActionKeys:[canonical([task.planScope.clauseRef,task.planScope.branchRef]),canonical([spec.clauseRef,spec.branchRef])],roundContracts:[]};
  try{this.commonViewTaskProtocol(task,grant);return this.readNonrunnerAction(spec,'designed-family-reservation');}finally{this.#designedProtocolHistory=null;}
 }
 private designerCheckpointBinding(task:any,taskRef:string){
  const b=this.bindings.get(taskRef);if(!b||!equal(this.resolveRef(taskRef),task))fail('state_history_conflict','designerCheckpoint','original Task input binding required');
  this.readFile(b.sourceIndexFile);const catalog=new Map<string,any>();for(const [ref]of this.references)catalog.set(ref,this.resolveRef(ref));
  const contract=this.resolveRef(task.scientificContract.decisionRuleRef),config=this.resolveRef(contract.configurationRef),inputs={designerRepositoryRoot:this.repositoryRoot,designerEvidenceFiles:new Map(this.evidence),designerCatalog:catalog,designerProfile:{configurationRef:contract.configurationRef,reference:config.profileRevisionRef,publicProfile:this.resolveRef(config.publicProfileRef)},sourceIdentity:task.sourcePlan.sourceIndexRef,sourceIndexPath:this.relativePath(b.sourceIndexFile.path),confirmedRecordRoots:b.confirmedRecordRoots,studentReleasePaths:Object.fromEntries(b.studentReleaseFiles.map((f:any)=>[f.ref,f.file.path])),datasetDirectory:b.datasetDirectory,seed:b.seed};
  if(this.resolveRef(contract.coverageApprovalRef).sourceIndexRef!==task.sourcePlan.sourceIndexRef){const proof=verifyDesignedFamilyReservationLink({task,contract,repositoryRoot:this.repositoryRoot,references:catalog,evidenceFiles:new Map(this.evidence),sourceIndexPath:inputs.sourceIndexPath});this.readDesignerFamilyHistory(task,proof.spec);}
  const p=verifyDesignedSourceInputs({task,refs:catalog,inputs});
  return {taskSHA256:digest(task),sourceRevision:task.sourceRevision,runtimeRef:task.runtimeRef,contractRef:task.scientificContract.decisionRuleRef,inventoryRef:task.datasetRefs[0],configurationRef:p.contract.configurationRef,promptRef:task.promptRef,sourceIndexRef:task.sourcePlan.sourceIndexRef,profileRevisionRef:p.reference,requestOrder:p.requests.map((r:any)=>({questionId:r.questionId,requestSHA256:digest(r)}))};
 }
 private checkDesignedSourceAdmission(task:any,state:any,context:any){
  if(!this.selectionContexts.has(context)||context.designedSource!==true||context.taskSHA256!==digest(task)||context.contractRef!==task.scientificContract.decisionRuleRef||state.rootInstanceId!==this.manifest.rootInstanceId||context.pins.some((f:any)=>this.designedFileSignal(f.path)!==f.signal))fail('input_identity_unverified','designerAdmission','original H-owned exact public inventory and source closure required');
  this.assertDesignedLedger(state,task);
  const current=new Set(context.requestOrder.map((r:any)=>r.requestSHA256)),questionIds=new Set(context.requestOrder.map((r:any)=>r.questionId));
  for(const run of Object.values(state.runs??{}) as any[]){const t=run.task;if(t?.planRef!==task.planRef||t.budgetRef!==task.budgetRef||this.resolveRef(t.capabilityRef)?.id!=='B07.designed-source.v1')continue;
   if(run.runId!==t.runId||run.taskSHA256!==digest(t)||!equal(this.resolveRef(run.taskRef),t)||state.tasks[t.taskId]!==run.runId||t.authorizationRef!==task.authorizationRef||t.researchBatchId!==task.researchBatchId)fail('state_history_conflict','designerHistory','same original Task/run and ledger required');
   const cp=run.checkpoint,reservations=Object.values(state.budgets?.[task.budgetRef]?.reservations??{}).filter((r:any)=>r.runId===run.runId) as any[],active=cp?.active!=null;
   if(t.outputRoot!==join(this.root,'runs',t.runId)||!equal(this.jsonBytes(this.regular(join(t.outputRoot,'task.json'))),t)||sha(this.regular(join(t.outputRoot,'task.json')))!==run.taskSHA256)fail('state_history_conflict','designerTaskFile','original immutable designer Task bytes required');
   if(cp!=null){if(!isDesignedSourceCheckpoint(cp)||run.checkpointSHA256!==digest(cp)||run.checkpointRef!==join(t.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)||!equal(this.jsonBytes(this.regular(run.checkpointRef)),cp))fail('state_history_conflict','designerCheckpoint','strict original checkpoint and actual immutable bytes required');}else if(run.checkpointSHA256!=null||run.checkpointRef!=null)fail('state_history_conflict','designerCheckpoint','no partial checkpoint identity');
   if(run.executionUnknown===true||run.observationStatus==='unknown'||run.stopReason==='execution_uncertain'||run.failureReason==='execution_uncertain'||cp?.executionUnknown===true||(cp?.rows??[]).some((r:any)=>r.requestCount===null)||reservations.some((r:any)=>r.status==='reserved_unknown'))fail('selection_execution_uncertain','designerHistory','unknown original designer request cannot be replayed or treated as empty');
   if(cp&&!equal(cp.binding,this.designerCheckpointBinding(t,run.taskRef)))fail('state_history_conflict','designerCheckpoint','exact original designer checkpoint required');
   if(run.runId===task.runId){if(run.taskSHA256!==context.taskSHA256||cp&&!equal(cp.binding.requestOrder,context.requestOrder)||active&&!(cp.active.phase==='terminal'||cp.active.phase==='requesting'&&['preparing','running','stopping'].includes(run.status)&&state.budgets?.[task.budgetRef]?.activeRunId===run.runId))fail('selection_execution_uncertain','designerCheckpoint','same immutable run, or safe known terminal recovery only');continue;}
   if(active||!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||reservations.some((r:any)=>r.status==='reserved'))fail('selection_execution_uncertain','designerHistory','previous designer owner must be safely settled');
   const exposed=(cp?.rows??[]).filter((r:any)=>r.requestCount>0),sentReservations=reservations.some((r:any)=>r.cost?.providerRequests>0&&r.status!=='released');
   if(exposed.some((r:any)=>current.has(r.requestSHA256)||questionIds.has(r.questionId))||sentReservations&&!cp?.rows?.length)fail('selection_owned_rows_already_exposed','designerHistory','new Task cannot resend the same already sent designer request');
  }return true;
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
 private selectionAdmissionContext(task:any,selection:any,spec:any,references:ReadonlyMap<string,any>,blindProjection?:any,designedTrusted?:any){
  const firstRound=['ohuo-offline-selection-first-round-rule-v1','ohuo-offline-selection-first-round-pilot-rule-v1','ohuo-offline-selection-common-view-r2',DESIGNED_SELECTION_RULE_SCHEMA].includes(references.get(spec.selectionRuleRef)?.schema),decision=references.get(task.scientificContract.decisionRuleRef),routing=decision?.routingRef?references.get(decision.routingRef):null;
  const designedHistory=spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA?this.designedSelectionHistory(task,selection,spec,designedTrusted):null,roundAdmission=this.commonViewRoundProof(spec),datasetHistory=this.#cumulativeDatasetHistory;const context={...(designedHistory?{designedHistory}:{}),selectionRef:task.datasetRefs[0],selection,spec,...(datasetHistory&&datasetHistory.priorSelectionRefs.includes(task.datasetRefs[0])?{datasetHistory}:{}),...(roundAdmission?{roundAdmission}:{}),...(firstRound?{firstRoundNamespace:references.get(spec.sourceIndexRef)?.namespace}:{}),...(routing?{routing,references}:{}),...(blindProjection?{blindProjection,blindReferences:[...references].map(([ref,value])=>({ref,value}))}:{}),screenContracts:[...references].filter(([,v])=>['ohuo-first-round-screen-contract-v1','ohuo-common-view-screen-contract-r2'].includes(v?.schema)).map(([ref,value])=>({ref,value})),capabilities:[...references].filter(([,v])=>v&&equal(Object.keys(v).sort(),['id','kind','mode'])).map(([ref,value])=>({ref,value}))};freezeJSON(context);this.selectionContexts.add(context);return context;
 }
 firstRoundNewTestSourceInputs(sourceSpec:any){
  const files=sourceSpec.sourceTaskRefs.map((ref:string)=>{const b=this.bindings.get(ref);if(!b)fail('input_identity_unverified','newTestSource','original source Task input binding required');return b.sourceIndexFile;}),unique=[...new Map(files.map((f:any)=>[canonical(f),f])).values()] as any[];if(unique.length!==1)fail('input_identity_unverified','newTestSource','one original source index file required');const f=unique[0],index=this.resolveRef(sourceSpec.sourceIndexRef);if(sha(this.readFile(f))!==index.fileSHA256)fail('input_identity_unverified','newTestSource','source index bytes differ');return {sourceIdentity:sourceSpec.sourceIndexRef,sourceIndexFile:structuredClone(f),sourceIndexPath:this.relativePath(f.path),readFirstRoundReference:(r:string)=>this.resolveRef(r),readFirstRoundEvidence:(f:any)=>this.evidenceBytes(f)};
 }
 private firstRoundNewTestCommit(task:any,selectionRef:string,sourceSpecRef:string){
  const entry=this.taskEntry(task,this.readGrant()),rows=entry.prerequisiteReceipts.filter((p:any)=>this.resolveRef(p.requirementRef).kind==='selection-production');if(rows.length!==1)fail('prerequisites_missing','selection-production','one original pre-query new-test selection commit required');const receipt=this.prerequisiteReceipt(rows[0].receiptRef,task,rows[0].requirementRef),commits=receipt.evidence_refs.flatMap((f:any)=>{let value:any;try{value=JSON.parse(this.evidenceBytes(f).toString('utf8'));}catch{return [];}return value?.schema==='ohuo-first-round-new-test-selection-commit-v1'?[value]:[];});if(commits.length!==1)fail('selection_production_required','newTestCommit','one original immutable union commit required');const c=commits[0];strictObject(c,'newTestCommit',['schema','specRef','selectionRef','sourceSpecRef','files']);if(c.selectionRef!==selectionRef||c.sourceSpecRef!==sourceSpecRef)fail('selection_task_binding','newTestCommit','same exact full union/source required');const spec=this.resolveRef(c.specRef),selection=this.resolveRef(selectionRef),dir=join('lab/out',spec.outputId);if(c.files.length!==2||!equal(c.files.map((f:any)=>f.path).sort(),[join(dir,'selection.json'),join(dir,'spec.json')].sort()))fail('selection_task_binding','newTestCommit','only original immutable spec and full selection files required');for(const f of c.files){const v=this.readJSON(f);if(!equal(v,f.path.endsWith('/spec.json')?spec:selection))fail('selection_task_binding','newTestCommit','committed bytes differ');}const facts=this.readNonrunnerAction(spec,'first-round-new-test-selection');if(spec.planRef!==task.planRef||spec.sourceSpecRef!==sourceSpecRef)fail('selection_task_binding','newTestCommit','original action differs');return{spec,selection,facts};
 }
 private async firstRoundNewTestLabelInputs(task:any,refs:Map<string,any>,result:any){
  const c=this.resolveRef(task.scientificContract.decisionRuleRef),revised=c.schema==='ohuo-common-view-teacher-contract-r2',blind=c.schema==='ohuo-first-round-blind-review-contract-v1';if(!blind)strictObject(c,'newTestLabelContract',revised?['schema','protocolRef','sourceSpecRef','selectionRef','comparisonRef','routingRef','worldPlansRef']:['schema','sourceSpecRef','selectionRef','comparisonRef','primaryLabelPolicyRef']);if(revised&&this.commonViewTaskProtocol(task)?.ref!==c.protocolRef)fail('protocol_identity_unverified','newTestTeacher','same actual revision required');
  if(!(blind&&c.batch==='new-test'||revised||c.schema==='ohuo-first-round-new-test-label-contract-v1')||c.selectionRef!==task.datasetRefs[0]||c.comparisonRef!==task.scientificContract.comparisonRef||!blind&&!revised&&c.primaryLabelPolicyRef!==task.labelPolicyRef)fail('selection_task_binding','newTestLabelContract','explicit new-test teacher contract required');
  const committed=this.firstRoundNewTestCommit(task,c.selectionRef,c.sourceSpecRef),{verifyFirstRoundNewTestSources}=await import('./first-round-evaluation-host'),proof=await verifyFirstRoundNewTestSources({host:this.firstRoundEvaluationFacade(task),task,refs,inputs:result,sourceSpecRef:c.sourceSpecRef,selectionRef:c.selectionRef});
  if(task.taskKind!=='collect'||task.sourcePlan.split!=='confirm'||task.operationScope.apiCalls!==true||task.operationScope.parameterUpdates||task.operationScope.deployment||task.limits.maxMatchAttempts!==0||task.limits.maxOptimizerSteps!==0||task.seatLayoutPlan!==proof.sourceSpec.queueRef||task.parentPolicyRef!==proof.comparison.proposalRef)fail('selection_task_binding','newTestLabel','original diagnostic teacher scope required');
  result.firstRoundNewTest=proof;const allRows=proof.questionSources.map((q:any)=>q.row),rows=allRows.filter((r:any)=>task.sourcePlan.familyIds.includes(r.blockFamilyId));if(!rows.length||task.sourcePlan.familyIds.some((f:string)=>!rows.some((r:any)=>r.blockFamilyId===f)))fail('selection_task_binding','newTestFamilies','nonempty exact original block projection required');
  const projection=blind?prepareBlindReviewProjection(task,refs,result,proof):undefined;if(!blind&&!revised&&(rows.length>16||task.limits.maxProviderRequests<1||task.limits.maxProviderRequests>rows.length||task.limits.maxLabelDecisions!==rows.length))fail('selection_task_binding','newTestLabelLimit','fixed at most16 GLM questions including all attempts required');
  if(revised){result.firstRoundNewTestLabel={rows};this.commonViewTeacherInputs(task,refs,result,this.commonViewTaskProtocol(task));}
  const context=freezeJSON({firstRoundNewTest:true,...(revised?{routing:result.commonViewTeacherRouting}:{}),selectionRef:c.selectionRef,selection:proof.selection,spec:committed.spec,sourceSpec:proof.sourceSpec,contract:c,allRows,rows:revised?result.commonViewTeacherRows:projection?.selection.rows??rows,blindProjection:projection??null,references:[...this.references.keys()].map(ref=>({ref,value:this.resolveRef(ref)}))});this.selectionContexts.add(context);result.offlineSelectionAdmissionContext=context;result.firstRoundNewTestLabel={selection:proof.selection,rows:context.rows,sourceSpec:proof.sourceSpec,contract:c,...(projection?{blindReview:projection}:{})};this.checkOfflineSelectionAdmission(task,this.checkExistingRoot(),context);
 }
 private checkFirstRoundNewTestBranchAdmission(task:any,state:any,context:any){
  if(!this.selectionContexts.has(context)||state.rootInstanceId!==this.manifest.rootInstanceId||context.contractRef!==task.scientificContract.decisionRuleRef||!equal(task.datasetRefs,[context.selectionRef]))fail('selection_task_binding','newTestBranch','fixed original branch context required');const refs=new Map(context.references.map((x:any)=>[x.ref,x.value]));for(const run of Object.values(state.runs??{}) as any[]){const t=run.task;if(t?.planRef!==task.planRef||t.budgetRef!==task.budgetRef)continue;const c:any=refs.get(t.scientificContract?.decisionRuleRef);if(!['ohuo-first-round-new-test-contract-v1','ohuo-common-view-new-test-contract-r2'].includes(c?.schema))continue;const overlap=c.questions?.some((q:any)=>context.contract.questions.some((n:any)=>n.sourceRowSHA256===q.sourceRowSHA256));if(!overlap)continue;if(run.taskSHA256!==digest(t)||run.taskRef?.split(':').at(-1)!==digest(t)||state.tasks[t.taskId]!==run.runId||t.authorizationRef!==task.authorizationRef||t.researchBatchId!==task.researchBatchId||c.selectionRef!==context.selectionRef)fail('selection_task_binding','newTestHistory','same original task/union scope required');const cp=run.checkpoint,rs=Object.values(state.budgets[t.budgetRef]?.reservations??{}).filter((r:any)=>r.runId===run.runId) as any[];if(run.executionUnknown||run.observationStatus==='unknown'||cp?.executionUnknown||cp?.active!=null||rs.some(r=>['reserved','reserved_unknown'].includes(r.status)))fail('selection_execution_uncertain','newTestHistory','unknown prior branch cannot restart');if(run.runId===task.runId){if(run.taskSHA256!==digest(task)||cp&&(cp.schema!=='ohuo-first-round-new-test-run-v1'||cp.selectionRef!==context.selectionRef||cp.contractRef!==context.contractRef))fail('selection_resume_binding','newTestBranch','same immutable branch required');}else if(cp?.attempts?.length||rs.some(r=>r.status!=='released'))fail('selection_owned_rows_already_screened','newTestBranch','new Task cannot reset root starts or worlds');}return true;
 }
 private checkFirstRoundNewTestLabelAdmission(task:any,state:any,context:any){
  if(context.contract?.schema==='ohuo-common-view-teacher-contract-r2')return this.checkCommonViewNewTestHistory(task,state,context);
  if(!this.selectionContexts.has(context)||state.rootInstanceId!==this.manifest.rootInstanceId||digest(context.selection)!==context.selectionRef.split(':').at(-1)||!equal(task.datasetRefs,[context.selectionRef])||task.planRef!==context.spec.planRef)fail('selection_task_binding','newTestAdmission','original full union and root required');const refs=new Map(context.references.map((x:any)=>[x.ref,x.value]));if(context.blindProjection)return checkFirstRoundBlindReviewAdmission({task,state,projection:context.blindProjection,references:refs});
  const owned=new Set(context.rows.map((r:any)=>canonical(r.key)));for(const run of Object.values(state.runs??{}) as any[]){const t=run.task;if(t?.planRef!==task.planRef||t.budgetRef!==task.budgetRef||!equal(t.datasetRefs,[context.selectionRef]))continue;const cap:any=refs.get(t.capabilityRef),rule:any=refs.get(t.scientificContract.decisionRuleRef);if(!cap||!rule)fail('reference_unavailable','newTestHistory','original capability/rule absent');if(cap.id!=='B07.offline-label.v1'||rule.schema==='ohuo-first-round-blind-review-contract-v1')continue;if(rule.schema!=='ohuo-first-round-new-test-label-contract-v1'||rule.primaryLabelPolicyRef!==context.contract.primaryLabelPolicyRef||t.labelPolicyRef!==task.labelPolicyRef||run.taskSHA256!==digest(t)||run.taskRef?.split(':').at(-1)!==digest(t)||state.tasks[t.taskId]!==run.runId)fail('selection_task_binding','newTestHistory','immutable original GLM task required');const rs=Object.values(state.budgets[t.budgetRef]?.reservations??{}).filter((r:any)=>r.runId===run.runId) as any[],cp=run.checkpoint,exposed=cp?.active||cp?.executionUnknown||(cp?.rows??[]).some((r:any)=>r.requestCount===null||r.requestCount>0)||rs.some(r=>r.cost?.providerRequests>0&&r.status!=='released');if(run.executionUnknown||run.observationStatus==='unknown'||cp?.executionUnknown||rs.some(r=>r.status==='reserved_unknown'))fail('selection_execution_uncertain','newTestHistory','unknown original query stays occupied');if(run.runId===task.runId){if(run.taskSHA256!==digest(task)||cp&&cp.selectionRef!==context.selectionRef)fail('selection_resume_binding','newTestHistory','same immutable task/union required');}else if(exposed&&context.allRows.some((r:any)=>t.sourcePlan.familyIds.includes(r.blockFamilyId)&&owned.has(canonical(r.key))))fail('selection_owned_rows_already_exposed','newTestHistory','new Task cannot repeat original GLM question');}return true;
 }
 private checkCommonViewNewTestHistory(task:any,state:any,context:any){
  if(!this.selectionContexts.has(context)||state.rootInstanceId!==this.manifest.rootInstanceId||digest(context.selection)!==context.selectionRef.split(':').at(-1)||!equal(task.datasetRefs,[context.selectionRef])||context.contract.protocolRef!==this.commonViewTaskProtocol(task)?.ref)fail('selection_task_binding','newTestAdmission','same current revised full selection required');
  const current=new Set(context.rows.map((r:any)=>canonical(r.key))),route=context.routing;
  for(const run of Object.values(state.runs??{}) as any[]){const t=run.task;if(t?.planRef!==task.planRef||t.budgetRef!==task.budgetRef||!equal(t.datasetRefs,[context.selectionRef]))continue;const cap=this.resolveRef(t.capabilityRef);if(cap.id!=='B07.offline-label.v1')continue;
   if(run.taskSHA256!==digest(t)||run.taskRef?.split(':').at(-1)!==digest(t)||run.runId!==t.runId||state.tasks[t.taskId]!==run.runId||t.authorizationRef!==task.authorizationRef||t.researchBatchId!==task.researchBatchId)fail('selection_task_binding','newTestHistory','original immutable same-scope Task required');
   const rule=this.resolveRef(t.scientificContract.decisionRuleRef);if(rule.schema!=='ohuo-common-view-teacher-contract-r2')fail('selection_task_binding','newTestHistory','same revised teacher contract required');const prior=this.resolveRef(rule.routingRef),cp=run.checkpoint,rs=Object.values(state.budgets[t.budgetRef]?.reservations??{}).filter((r:any)=>r.runId===run.runId) as any[],active=cp?.active!=null;
   if(run.executionUnknown||run.observationStatus==='unknown'||cp?.executionUnknown||(cp?.rows??[]).some((r:any)=>r.requestCount===null)||rs.some(r=>r.status==='reserved_unknown'))fail('selection_execution_uncertain','newTestHistory','unknown invocation cannot be consumed or bypassed');
   if(run.runId===task.runId){if(run.taskSHA256!==digest(task)||cp&&cp.selectionRef!==context.selectionRef)fail('selection_resume_binding','newTestHistory','same immutable query checkpoint required');if(active&&!(cp.active.phase==='world-preparation'&&cp.active.index===cp.cursor&&cp.rows?.length===cp.cursor&&context.rows[cp.cursor]?.inputSHA256===cp.active.inputSHA256&&hash(cp.active.inputSHA256)&&!rs.some(r=>['reserved','reserved_unknown'].includes(r.status))&&['failed','interrupted'].includes(run.status)&&run.cleanupConfirmed===true))fail('selection_execution_uncertain','newTestHistory','only original pre-provider world preparation is safely resumable');continue;}
   const exposed=active||(cp?.rows??[]).some((r:any)=>r.requestCount>0)||rs.some(r=>r.cost?.providerRequests>0&&r.status!=='released');if(!exposed)continue;
   const previous=prior.role==='primary'?context.allRows.filter((r:any)=>t.sourcePlan.familyIds.includes(r.blockFamilyId??r.familyId)):prior.selected;
   if(!previous.some((r:any)=>current.has(canonical(r.key))))continue;
   if(route.role!=='primary'&&prior.role==='primary'&&t.labelPolicyRef===route.primaryLabelPolicyRef&&task.labelPolicyRef!==t.labelPolicyRef){if(!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||active||rs.some(r=>r.status==='reserved'))fail('selection_execution_uncertain','newTestHistory','necessary secondary review requires original primary safely settled');continue;}
   fail('selection_owned_rows_already_exposed','newTestHistory','same revised teacher cannot resend an exposed question');
  }return true;
 }
 private commonViewTeacherInputs(task:any,refs:Map<string,any>,result:any,protocol:any){
  const promptRef=protocol.value.originalMethods.commonViewPromptRef,prompt=this.resolveRef(promptRef);
  if(prompt?.schema===PROJECT_RULES_TEACHER_PROMPT_SCHEMA){
   try{validateProjectRulesPrompt(prompt);assertProjectRuleOptions(this.resolveRef(task.rulesRef));}
   catch{fail('input_identity_unverified','commonViewPrompt','exact versioned project rules and prompt required');}
  }else{
   strictObject(prompt,'commonViewPrompt',['schema','systemPromptSHA256','viewSchema']);
   if(prompt.schema!=='ohuo-common-view-prompt-r2'||prompt.systemPromptSHA256!==COMMON_VIEW_SYSTEM_PROMPT_SHA256||prompt.viewSchema!=='first-round-common-view-r2')fail('input_identity_unverified','commonViewPrompt','exact current model-visible system contract required');
  }
  refs.set(promptRef,prompt);
  const decision=refs.get(task.scientificContract.decisionRuleRef),routing=this.resolveRef(decision.routingRef),worlds=this.resolveRef(decision.worldPlansRef),full=refs.get(task.datasetRefs[0]);
  strictObject(decision,'teacherContract',['schema','protocolRef','selectionRef','comparisonRef','routingRef','worldPlansRef','sourceSpecRef']);if(decision.schema!=='ohuo-common-view-teacher-contract-r2'||decision.protocolRef!==protocol.ref||decision.selectionRef!==task.datasetRefs[0]||decision.comparisonRef!==task.scientificContract.comparisonRef)fail('selection_task_binding','teacherContract','same current actual protocol and selection required');
  strictObject(routing,'teacherRouting',['schema','protocolRef','role','reason','primaryLabelPolicyRef','selected']);
  if(routing.schema!=='ohuo-common-view-teacher-routing-r2'||routing.protocolRef!==protocol.ref||!['primary','independent-review','model-substitution'].includes(routing.role)||routing.primaryLabelPolicyRef!==protocol.value.originalMethods.primaryTeacherRef||!Array.isArray(routing.selected))fail('teacher_routing_unverified','routingRef','actual approved primary teacher and explicit necessity route required');
  const all=result.firstRoundNewTestLabel?.rows??full.rows.filter((r:any)=>r.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(r.blockFamilyId??r.familyId));let rows=all;
  if(routing.role==='primary'){if(routing.reason!==null||routing.selected.length||task.labelPolicyRef!==routing.primaryLabelPolicyRef)fail('teacher_routing_unverified','primary','primary GLM route cannot silently substitute or cherry-pick');}
  else{if(!string(routing.reason)||!routing.selected.length||task.labelPolicyRef!==protocol.value.originalMethods.independentTeacherRef)fail('teacher_routing_unverified','secondary','secondary model requires actual named necessity');const seen=new Set();rows=routing.selected.map((r:any)=>{strictObject(r,'routingSelection',['key','inputSHA256','reasonKind','reason','evidenceRefs']);const k=canonical(r.key);if(seen.has(k)||!['strategy_dispute','model_unsuitable'].includes(r.reasonKind)||!string(r.reason)||!Array.isArray(r.evidenceRefs)||!r.evidenceRefs.length)fail('teacher_routing_unverified','selected','unique necessary existing question and evidence required');seen.add(k);this.evidenceList(r.evidenceRefs);const matches=all.filter((x:any)=>equal(x.key,r.key)&&x.inputSHA256===r.inputSHA256);if(matches.length!==1)fail('teacher_routing_unverified','selected','same actual full selection identity required');return matches[0];});rows=all.filter((x:any)=>routing.selected.some((r:any)=>equal(r.key,x.key)&&r.inputSHA256===x.inputSHA256));}
  strictObject(worlds,'worldPlans',['schema','protocolRef','rows']);if(worlds.schema!=='ohuo-common-view-world-plans-r2'||worlds.protocolRef!==protocol.ref||!Array.isArray(worlds.rows)||worlds.rows.length!==rows.length)fail('input_identity_unverified','worldPlans','same pre-query actual finite world batch required');
  const seen=new Set();for(const r of worlds.rows){strictObject(r,'worldPlanRow',['inputSHA256','batchPlan']);if(seen.has(r.inputSHA256)||!rows.some((x:any)=>x.inputSHA256===r.inputSHA256)||r.batchPlan?.schema!=='ohuo-common-view-world-batch-r2'||r.batchPlan.protocolRef!==protocol.ref||!Array.isArray(r.batchPlan.worlds)||!r.batchPlan.worlds.length)fail('input_identity_unverified','worldPlans','each selected input requires one frozen world plan');seen.add(r.inputSHA256);}
  // These fixed entities are already identity-checked, including indirect refs.
  refs.set(decision.routingRef,routing);refs.set(decision.worldPlansRef,worlds);
  result.commonViewTeacher={protocolRef:protocol.ref,worldPlanDocument:worlds};result.commonViewTeacherRouting=routing;result.commonViewTeacherRows=rows;
  result.inputWorkload={providerRequests:rows.length,labelDecisions:rows.length,matchAttempts:0,optimizerSteps:0};
 }
 private async offlineSelectionInputs(task:any,refs:Map<string,any>,result:any){
  if(task.datasetRefs.length!==1)fail('selection_task_binding','datasetRefs','one original full selection required');const selection=refs.get(task.datasetRefs[0]);if(selection?.schema==='ohuo-first-round-new-test-selection-result-v1')return this.firstRoundNewTestLabelInputs(task,refs,result);if(selection?.schema!=='ohuo-offline-label-selection-v2')fail('selection_production_required','datasetRefs','research labels require the fixed v2 production proof');
  const production=this.resolveRef(selection.productionRef),spec=this.resolveRef(production.specRef),state=this.checkExistingRoot(),run=state.runs[state.tasks[task.taskId]],phase=run?.checkpoint?'label-resume':'label-start',trusted=await this.offlineSelectionHostInputs(spec,{phase,task}),quota=this.jsonBytes(this.evidenceBytes(spec.quotaBasisRef));
  const entry=this.taskEntry(task,this.readGrant()),receipts=entry.prerequisiteReceipts.filter((p:any)=>this.resolveRef(p.requirementRef).kind==='selection-production');if(receipts.length!==1)fail('prerequisites_missing','selection-production','one independently bound original production prerequisite required');const receipt=this.prerequisiteReceipt(receipts[0].receiptRef,task,receipts[0].requirementRef),productionFile=this.references.get(selection.productionRef);
  const bindsProduction=receipt.evidence_refs.some((f:any)=>{const file=this.evidence.get(f.id);if(productionFile&&file?.path===productionFile.path&&f.sha256===productionFile.sha256)return true;const bytes=this.evidenceBytes(f);let value:any;try{value=JSON.parse(bytes.toString('utf8'));}catch{return false;}return value.schema==='ohuo-offline-selection-commit-v1'&&value.specRef===production.specRef&&value.productionRef===selection.productionRef&&value.selectionRef===task.datasetRefs[0];});
  const rule=this.resolveRef(this.readApprovedAction(task).action.acceptanceRuleRef),expectedStage=spec.purpose==='b_training_source'?4:6;
  if(!bindsProduction||task.budgetRef!==quota.budgetRef||rule.stage!==expectedStage||selection.purpose!==spec.purpose||spec.purpose==='b_training_source'&&task.parentPolicyRef!==spec.actingReleaseRef||spec.purpose==='distribution_diagnostic'&&!task.releaseRefs.includes(spec.actingReleaseRef))fail('selection_task_binding','selection-production','this original label action/budget/purpose/acting identity must bind the actual full production, not the freeze action or another receipt');
  const decision=this.resolveRef(task.scientificContract.decisionRuleRef),screen=['ohuo-first-round-screen-contract-v1','ohuo-common-view-screen-contract-r2'].includes(decision?.schema),blind=decision?.schema==='ohuo-first-round-blind-review-contract-v1';
  const {verifyOfflineSelection,createOfflineSelectionReproductionSession}=await import('./offline-selection');
  this.#selectionReproductionSession??=createOfflineSelectionReproductionSession(trusted);
  const routing=decision?.routingRef?this.resolveRef(decision.routingRef):null,secondary=!!this.commonViewTaskProtocol(task)&&routing?.role!=='primary';
  const verifiedInputs={...(screen||blind||secondary||spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA?{...trusted,phase:'dataset' as const}:trusted),reproductionSession:this.#selectionReproductionSession},proof=verifyOfflineSelection(selection,verifiedInputs);
  if(proof.production.verification!=='reproduced')fail('selection_production_incomplete','production','the entire approved population must be accounted for before labels');
  if(result.confirmedRecordRoots.some((root:string)=>!trusted.confirmedRecordRoots.includes(root)))fail('input_identity_unverified','confirmedRecordRoots','label roots must be original granted settled source runs');
  const blindProjection=blind?prepareBlindReviewProjection(task,refs,{...result,offlineSelection:verifiedInputs,readFirstRoundReference:(r:string)=>this.resolveRef(r),readFirstRoundEvidence:(f:any)=>this.evidenceBytes(f)},proof):undefined;
  result.offlineSelection=verifiedInputs;if(blindProjection)result.firstRoundBlindReview=blindProjection;result.offlineSelectionAdmissionContext=this.selectionAdmissionContext(task,selection,spec,trusted.references,blindProjection,verifiedInputs);this.checkOfflineSelectionAdmission(task,state,result.offlineSelectionAdmissionContext);
 }
 checkOfflineSelectionAdmission(task:any,state:any,context:any){
  if(!context||!this.selectionContexts.has(context))fail('input_identity_unverified','offlineSelectionAdmissionContext','fixed host verified complete selection context required');
  if(context.designedSource)return this.checkDesignedSourceAdmission(task,state,context);
  if(context.firstRoundNewTestBranch)return this.checkFirstRoundNewTestBranchAdmission(task,state,context);
  if(context.firstRoundNewTest)return this.checkFirstRoundNewTestLabelAdmission(task,state,context);
  const {selectionRef,selection,spec}=context;this.assertOfflineSelectionTaskBinding(task,state,context);this.assertCommonViewRoundState(context,state);this.assertCommonViewRoundTask(task,context,state);this.assertDesignedSelectionAdmission(task,state,context);
  if(context.blindProjection)return checkFirstRoundBlindReviewAdmission({task,state,projection:context.blindProjection,references:new Map(context.blindReferences.map((r:any)=>[r.ref,r.value]))});
  const screen=context.screenContracts?.find((x:any)=>x.ref===task.scientificContract.decisionRuleRef);if(screen)return this.checkFirstRoundScreenAdmission(task,state,context,screen.value);
  const owned=(t:any)=>{const d=this.resolveRef(t.scientificContract.decisionRuleRef),r=d?.routingRef?this.resolveRef(d.routingRef):null;return new Set((r?.schema==='ohuo-common-view-teacher-routing-r2'&&r.role!=='primary'?r.selected:selection.rows.filter((row:any)=>row.split===t.sourcePlan.split&&t.sourcePlan.familyIds.includes(row.blockFamilyId??row.familyId))).map((row:any)=>canonical(row.key)));},currentKeys=owned(task),caps=new Map(context.capabilities.map((x:any)=>[x.ref,x.value]));
  if(!currentKeys.size)fail('selection_task_binding','sourcePlan','nonempty original deterministic split/family projection required');
  for(const run of Object.values(state.runs) as any[]){const t=run.task;if(t?.planRef!==task.planRef||t?.budgetRef!==task.budgetRef)continue;const cap:any=caps.get(t.capabilityRef);if(!cap)fail('reference_unavailable','selectionHistory','new history capability was absent from fixed preflight catalog');if(cap.id!=='B07.offline-label.v1')continue;
   if(t.researchBatchId!==task.researchBatchId||t.authorizationRef!==task.authorizationRef||run.runId!==t.runId||state.tasks[t.taskId]!==run.runId||run.taskSHA256!==digest(t)||run.taskRef?.split(':').at(-1)!==digest(t))fail('state_history_conflict','selectionHistory','same original Task/run/batch/authorization required');
   if(run.runId!==task.runId&&knownUnsentWorldPreparationFailure(run,state,this.root,(ref:string)=>this.resolveRef(ref)))continue;
   if(context.roundAdmission?.priorSelectionRefs.includes(t.datasetRefs?.[0]))continue; // complete safe/disjoint predecessor proof, not a global namespace bypass
   if(context.designedHistory?.priorSelectionRefs.includes(t.datasetRefs?.[0]))continue; // H rechecked exact settled prior used-history above, not a namespace exception
   const ledger=state.budgets[task.budgetRef],reservations=Object.values(ledger?.reservations??{}).filter((r:any)=>r.runId===run.runId) as any[],cp=run.checkpoint,active=cp?.active!==null&&cp?.active!==undefined;
   if(context.firstRoundNamespace!==undefined&&t.sourcePlan?.namespace!==context.firstRoundNamespace){
    if(!string(context.firstRoundNamespace)||!string(t.sourcePlan?.namespace)||!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.stopReason==='execution_uncertain'||run.failureReason==='execution_uncertain'||cp?.executionUnknown===true||active||(cp?.rows??[]).some((row:any)=>row.requestCount===null)||reservations.some(r=>['reserved','reserved_unknown'].includes(r.status)))fail('selection_execution_uncertain','selectionHistory','prior namespace must be confirmed safely stopped');continue;
   }
   const exposed=active||cp?.executionUnknown===true||(cp?.rows??[]).some((r:any)=>r.requestCount===null||r.requestCount>0)||reservations.some(r=>r.cost?.providerRequests>0&&r.status!=='released');
   const resumeRows=selection.rows.filter((r:any)=>r.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(r.blockFamilyId??r.familyId)&&(context.routing?.role==='primary'||context.routing?.selected.some((x:any)=>equal(x.key,r.key)&&x.inputSHA256===r.inputSHA256))),worldResume=run.runId===task.runId&&cp?.rows?.length===cp.cursor&&resumeRows[cp.cursor]?.inputSHA256===cp?.active?.inputSHA256&&context.routing?.schema==='ohuo-common-view-teacher-routing-r2'&&cp?.active?.phase==='world-preparation'&&cp.active.index===cp.cursor&&hash(cp.active.inputSHA256)&&!reservations.some(r=>['reserved','reserved_unknown'].includes(r.status))&&['failed','interrupted'].includes(run.status)&&run.cleanupConfirmed===true;
   if(run.runId===task.runId){if(run.taskSHA256!==digest(task)||cp&&cp.selectionRef!==selectionRef)fail('selection_resume_binding','checkpoint','same immutable Task and full selection required');if(run.executionUnknown===true||run.observationStatus==='unknown'||cp?.executionUnknown===true||reservations.some(r=>r.status==='reserved_unknown')||active&&!worldResume&&(!['preparing','running','stopping'].includes(run.status)||ledger?.activeRunId!==run.runId))fail('selection_execution_uncertain','checkpoint','unknown request cannot resume or be resent');}
   if(!exposed)continue;
   if(!equal(t.datasetRefs,[selectionRef]))fail('selection_changed_after_label_exposure','datasetRefs','original full selection cannot change after sent or unknown query');
   const necessarySecondary=context.routing?.schema==='ohuo-common-view-teacher-routing-r2'&&context.routing.role!=='primary'&&t.labelPolicyRef===context.routing.primaryLabelPolicyRef&&task.labelPolicyRef!==t.labelPolicyRef;
   if(necessarySecondary){if(!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||run.executionUnknown||run.observationStatus==='unknown'||cp?.executionUnknown||active||(cp?.rows??[]).some((r:any)=>r.requestCount===null)||reservations.some(r=>['reserved','reserved_unknown'].includes(r.status)))fail('selection_execution_uncertain','primaryHistory','necessary review cannot bypass unsettled original primary request');continue;}
   if(run.runId!==task.runId&&[...owned(t)].some(key=>currentKeys.has(key)))fail('selection_owned_rows_already_exposed','sourcePlan','new Task cannot query an already exposed selected decision; disjoint split/family projections remain allowed');
  }
  return true;
 }
 private assertOfflineSelectionTaskBinding(task:any,state:any,context:any){
  const {selectionRef,selection,spec}=context;if(state.rootInstanceId!==this.manifest.rootInstanceId||selection.schema!=='ohuo-offline-label-selection-v2'||digest(selection)!==selectionRef.split(':').at(-1)||!equal(task.datasetRefs,[selectionRef])||task.planRef!==spec.planRef)fail('selection_task_binding','selectionRef','exact original full selection and control root required');
 }
 /** Dataset/budget consumption audits settled artifacts; it does not ask to
  * execute an old Task again. Shared identity and uncertainty checks remain. */
 private checkFirstRoundScreenHistory(task:any,state:any,context:any,contract:any){
  this.assertOfflineSelectionTaskBinding(task,state,context);return this.verifyFirstRoundScreenContext(task,state,context,contract,false);
 }
 checkFirstRoundScreenAdmission(task:any,state:any,context:any,contract:any){this.assertCommonViewRoundTask(task,context,state);return this.verifyFirstRoundScreenContext(task,state,context,contract,true);}
 private verifyFirstRoundScreenContext(task:any,state:any,context:any,contract:any,admitting:boolean){
  if(!this.selectionContexts.has(context)||contract!==context.screenContracts?.find((x:any)=>x.ref===task.scientificContract.decisionRuleRef)?.value)fail('input_identity_unverified','screenAdmission','fixed verified screen context required');
  this.assertCommonViewRoundState(context,state);this.assertDesignedSelectionAdmission(task,state,context);const revised=contract.schema==='ohuo-common-view-screen-contract-r2';strictObject(contract,'firstRoundScreenContract',['schema','comparisonRef','selectionRef','registryRef','reviewerRef','roots',...(revised?['protocolRef']:['maxBranchStarts'])]);if(revised&&this.commonViewTaskProtocol(task)?.ref!==contract.protocolRef)fail('protocol_identity_unverified','screenContract','same actual common-view revision required');
  if(!['ohuo-first-round-screen-contract-v1','ohuo-common-view-screen-contract-r2'].includes(contract.schema)||contract.selectionRef!==context.selectionRef||contract.comparisonRef!==task.scientificContract.comparisonRef||task.operationScope.apiCalls||task.operationScope.parameterUpdates||['maxProviderRequests','maxLabelDecisions','maxOptimizerSteps'].some(k=>task.limits[k]!==0)||!revised&&(!integer(contract.maxBranchStarts,1)||contract.maxBranchStarts>384||task.limits.maxMatchAttempts>contract.maxBranchStarts)||!integer(task.limits.maxMatchAttempts)||task.parentPolicyRef!==context.spec.actingReleaseRef)fail('selection_task_binding','screenContract','read-only teacher phase with bounded metered continuations required');
  const owned=(t:any)=>new Set(context.selection.rows.filter((r:any)=>r.split===t.sourcePlan.split&&t.sourcePlan.familyIds.includes(r.blockFamilyId??r.familyId)).map((r:any)=>canonical(r.key))),current=owned(task),caps=new Map(context.capabilities.map((x:any)=>[x.ref,x.value]));if(!current.size)fail('selection_task_binding','screenPopulation','nonempty same selected projection required');
  for(const run of Object.values(state.runs) as any[]){const t=run.task;if(t?.planRef!==task.planRef||t.budgetRef!==task.budgetRef)continue;const cap:any=caps.get(t.capabilityRef);if(!cap)fail('reference_unavailable','screenHistory','original capability missing');if(cap.id!=='B07.offline-label.v1')continue;
   if(t.researchBatchId!==task.researchBatchId||t.authorizationRef!==task.authorizationRef||run.runId!==t.runId||state.tasks[t.taskId]!==run.runId||run.taskSHA256!==digest(t)||run.taskRef?.split(':').at(-1)!==digest(t))fail('state_history_conflict','screenHistory','same immutable original Task/run required');
   if(run.runId!==task.runId&&knownUnsentWorldPreparationFailure(run,state,this.root,(ref:string)=>this.resolveRef(ref)))continue;
   if(context.roundAdmission?.priorSelectionRefs.includes(t.datasetRefs?.[0]))continue; // complete safe/disjoint predecessor proof, not a global namespace bypass
   if(context.designedHistory?.priorSelectionRefs.includes(t.datasetRefs?.[0]))continue; // H rechecked exact settled prior used-history above, not a namespace exception
   if(!admitting&&context.datasetHistory&&!equal(t.datasetRefs,[context.selectionRef])&&equal(t.datasetRefs,[t.datasetRefs?.[0]])&&context.datasetHistory.priorSelectionRefs.includes(t.datasetRefs[0])){this.assertCommonViewRoundState({roundAdmission:context.datasetHistory},state);continue;} // internal cumulative history only; public new execution remains unchanged
   const reservations=Object.values(state.budgets[task.budgetRef]?.reservations??{}).filter((r:any)=>r.runId===run.runId) as any[],cp=run.checkpoint,overlap=[...owned(t)].some(k=>current.has(k));if(!overlap)continue;
   if(!equal(t.datasetRefs,[context.selectionRef]))fail('selection_changed_after_label_exposure','screenSelection','screen may only read original same selection');
   if(run.executionUnknown||run.observationStatus==='unknown'||cp?.executionUnknown||cp?.active!==null&&cp?.active!==undefined||reservations.some(r=>r.status==='reserved_unknown'||r.status==='reserved'))fail('selection_execution_uncertain','screenHistory','unknown original query/branch cannot be consumed or restarted');
   if(run.runId===task.runId){if(run.taskSHA256!==digest(task)||cp&&(cp.schema!=='ohuo-first-round-screen-run-v1'||cp.selectionRef!==context.selectionRef||cp.contractRef!==task.scientificContract.decisionRuleRef))fail('selection_resume_binding','screenCheckpoint','same screen Task/contract/selection required');}
   else if(admitting&&cp?.schema==='ohuo-first-round-screen-run-v1'&&(cp.attempts?.length||reservations.some(r=>r.cost?.matchAttempts>0&&r.status!=='released')))fail('selection_owned_rows_already_screened','screenHistory','new Task cannot reset/reseed prior branch work');
   else if((cp?.rows??[]).some((r:any)=>r.requestCount===null))fail('selection_execution_uncertain','screenTeacher','unknown query cannot be screened');
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
  if(isFirstRoundRecipe(task.learnerRecipe)){const p=this.resolveRef(task.parentPolicyRef),doc=this.evidenceDocument(p.migrationReceiptRef);evidence.set(canonical(doc.ref),doc);}
  return {task:{ref:c.taskRef,value:task},inputBinding:binding,dataset,datasetManifest,samples,controlState,summary,checkpoints,checks,evidence:[...evidence.values()]};
 }
 private calibrationInput(receipt:any){
  const c=receipt.calibration,diagnostic=this.jsonBytes(this.evidenceBytes(c.diagnosticRef));strictObject(diagnostic,'calibrationDiagnostic',['schema','taskRef','runId','summaryRef','controlStateRef','checkpointFactsRefs','checks','issues']);
  if(diagnostic.schema!=='ohuo-calibration-qualification-v1'||diagnostic.taskRef!==c.taskRef||diagnostic.runId!==c.runId||!equal(diagnostic.summaryRef,c.summaryRef)||!equal(diagnostic.controlStateRef,c.controlStateRef)||!equal(diagnostic.checkpointFactsRefs,c.checkpointFactsRefs))fail('prerequisites_missing','diagnostic','original qualification diagnostic binding differs');
  return this.calibrationFacts(c,diagnostic.checks);
 }
 private currentProducerSource(){
  if(this.screenRevalidation){this.screenRevalidation.assertLive();return this.screenRevalidation.sourceRef;}
  for(const name of ['ai','engine','review'])if(realpathSync(req.resolve('@gd/'+name))!==join(this.repositoryRoot,'packages',name,'src/index.ts'))fail('input_identity_unverified','workspace','actual workspace import resolves outside fixed source tree');
  const actualFiles=new Map<string,{signal:string|null,sha256:string|null}>(),matches:string[]=[];for(const [ref] of this.references){const value=this.resolveRef(ref);if(!value||!equal(Object.keys(value).sort(),['baseCommit','files'])||!Array.isArray(value.files))continue;
   if(!/^[a-f0-9]{40}$/.test(value.baseCommit)||value.files.length>10000)continue;
   const paths=new Set<string>();let current=true;for(const f of value.files){this.fileShape(f);if(paths.has(f.path))fail('input_identity_unverified','source.files','duplicate source');paths.add(f.path);const path=this.relativePath(f.path),signal=existsSync(path)?this.fixedSourceSignal(path):null;let actual=actualFiles.get(path);if(!actual||actual.signal!==signal){actual={signal,sha256:signal===null?null:sha(this.regular(path))};actualFiles.set(path,actual);}if(actual.sha256!==f.sha256)current=false;}
   if(current&&[...HOST_SOURCE_FILES,...FIRST_ROUND_SOURCE_FILES].every(p=>paths.has(p)))matches.push(ref);
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
   const manifest=this.jsonBytes(Buffer.from(input.datasetManifest.bytes)),summary=this.jsonBytes(Buffer.from(input.summary.bytes)),parent=this.resolveRef(task.parentPolicyRef);let parentWeightsSHA256:string;
   if(isFirstRoundRecipe(task.learnerRecipe)){validateFirstRoundDatasetMetadata(manifest,'research');const metadata=validateFirstRoundParentEnvelope({parentRef:task.parentPolicyRef,envelope:parent,readEvidence:f=>this.evidenceBytes(f)});if(!equal(metadata.parentIdentity,manifest.plan.identities.studentScorer)||!equal(metadata.basePolicyIdentity,manifest.plan.identities.basePolicy)||!equal(metadata.parentIdentity,summary.frozenRefs?.parentIdentity)||summary.frozenRefs?.parent!==task.parentPolicyRef||summary.frozenRefs?.B!==task.outputSpec.proposalPolicyRef)fail('input_identity_unverified','parentPolicyRef','exact original S0 and proposal metadata required');parentWeightsSHA256=metadata.scorer.weightsSHA256;}
   else{strictObject(parent,'parentPolicy',['schema','policyRef','policyIdentity']);if(parent.schema!=='ohuo-parent-policy-ref-v1'||!equal(parent.policyIdentity,manifest.plan?.identities?.basePolicy)||!equal(parent.policyIdentity,summary.frozenRefs?.parentIdentity)||!hash(parent.policyIdentity?.weightsSHA256))fail('input_identity_unverified','parentPolicyRef','original fixed parent metadata must match dataset and summary; weights are not read');parentWeightsSHA256=parent.policyIdentity.weightsSHA256;}
   const production={schema:'ohuo-calibration-qualification-production-v1',requestRef,taskRef:request.taskRef,runId:task.runId,producerSourceRevision,diagnosticRef,summaryRef:request.summaryRef,controlStateRef:request.controlStateRef,checkpointFactsRefs:request.checkpointFactsRefs,datasetRef:task.datasetRefs[0],datasetManifestSHA256:input.datasetManifest.ref.sha256,samplesSHA256:input.samples.ref.sha256,parentPolicyRef:task.parentPolicyRef,parentWeightsSHA256},productionBytes=canonical(production),productionPath=join(directory,'production.json'),productionRef={id:idBase+'/production.json',sha256:sha(productionBytes)};
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
  const correction=this.formalStopCorrection(task,state);
  for(const k of ['planRef','planVersion','budgetRef','authorizationRef','researchBatchId','sourceRevision','runtimeRef','parentPolicyRef','releaseRefs','rulesRef','sourcePlan','splitRefs','seatLayoutPlan','actorSampleRule','datasetRefs','labelPolicyRef','promptRef','operationScope','stopPolicy','outputSpec'])if(!equal(prior[k],task[k])&&!(k==='sourceRevision'&&correction&&prior.sourceRevision===correction.priorSourceRef&&task.sourceRevision===correction.currentSourceRef))fail('prerequisites_missing',k,'formal must retain original calibration identity');
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
  if(task.taskKind!=='supervised_training'||task.learnerRecipe.learningRate!==3e-5||task.parentTaskId!==n.failedTaskId||task.retryReasonRef!==b.numericalRestartReceiptRef||task.planScope.branchRef===null||task.allowedBranches.length!==1||task.allowedBranches[0].evidenceRef!==task.retryReasonRef||n.datasetRef!==task.datasetRefs[0]||n.parentPolicyRef!==task.parentPolicyRef||n.seed!==b.seed||!firstRoundRecoveryTriggerAllowed(task.learnerRecipe,n.trigger))fail('branch_evidence_unverified','branch','fixed parent/data/seed/rule binding differs');
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
 verifyInputs=async(task:any,refs:Map<string,any>)=>withCoverageEligibilityScope(digest(task),()=>this.verifyInputsScoped(task,refs),this.roundProofSessionFor(task),"verifyInputs");
 private verifyInputsScoped=async(task:any,refs:Map<string,any>)=>{
  const g=this.readGrant(),entry=this.taskEntry(task,g),b=this.bindings.get(entry.taskRef);if(!b)fail('input_identity_unverified','inputBindings','exact task input binding missing');this.checkExistingRoot();
  const source=this.screenRevalidation?this.resolveRef(this.screenRevalidation.sourceRef):refs.get(task.sourceRevision);strictObject(source,'sourceRevision',['baseCommit','files']);if(typeof source.baseCommit!=='string'||!/^[a-f0-9]{40}$/.test(source.baseCommit))fail('input_identity_unverified','sourceRevision','explicit base commit plus actual content SHA required');
  const sourceOwner=canonical([digest(task),digest(source)]),files=new Map<string,string>();for(const f of array(source.files,'source.files')){strictObject(f,'sourceFile',['path','sha256']);if(files.has(f.path))fail('input_identity_unverified','sourceRevision','duplicate source');this.verifyFixedSourceFile(f,sourceOwner);files.set(f.path,f.sha256);}
  for(const name of ['ai','engine','review'])if(realpathSync(req.resolve('@gd/'+name))!==join(this.repositoryRoot,'packages',name,'src/index.ts'))fail('input_identity_unverified','workspace','actual workspace import resolves outside fixed source tree');
  const needed=[...HOST_SOURCE_FILES,...(task.taskKind==='supervised_training'?TRAINING_SOURCE_FILES:[]),...FIRST_ROUND_SOURCE_FILES];if(needed.some(p=>!files.has(p)))fail('input_identity_unverified','sourceRevision','fixed execution dependency missing from actual source manifest');
  const runtime=refs.get(task.runtimeRef);strictObject(runtime,'runtimeRef',['node','platform','arch','tsx','python']);
  if(runtime.node!==process.version||runtime.platform!==process.platform||runtime.arch!==process.arch||runtime.tsx!==req('tsx/package.json').version)fail('input_identity_unverified','runtimeRef','actual Node/platform/tsx differ');
  if(task.taskKind==='supervised_training'){
   strictObject(runtime.python,'runtime.python',['executablePath','executableSHA256','version','numpyVersion','torchVersion']);const python=this.manifest.pythonPath;
   if(!python||runtime.python.executablePath!==python||!statSync(python).isFile()||sha(readFileSync(realpathSync(python)))!==runtime.python.executableSHA256)fail('input_identity_unverified','python','approved interpreter identity differs');
   if(isFirstRoundRecipe(task.learnerRecipe)){
    if(typeof runtime.python.version!=='string'||!runtime.python.version||typeof runtime.python.torchVersion!=='string'||!runtime.python.torchVersion||runtime.python.numpyVersion!==null&&(typeof runtime.python.numpyVersion!=='string'||!runtime.python.numpyVersion))fail('input_identity_unverified','runtime.python','fixed version strings and explicit nullable NumPy required');
    // Actual imports/version comparison are performed by the single existing
    // learner handshake inside the controller-owned timed run, before init.
   }else{
    const facts=JSON.parse(execFileSync(python,['-c','import json,sys,numpy,torch; print(json.dumps({"version":sys.version.split()[0],"numpyVersion":numpy.__version__,"torchVersion":torch.__version__}))'],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024,env:buildPythonEnvironment()}));
    if(['version','numpyVersion','torchVersion'].some(k=>facts[k]!==runtime.python[k]))fail('input_identity_unverified','python','actual scientific runtime differs');
   }
  }else if(runtime.python!==null)fail('input_identity_unverified','runtime.python','nontraining Python runtime is not applicable');
  const indexBytes=this.readFile(b.sourceIndexFile),index=this.jsonBytes(indexBytes),indexRef=refs.get(task.sourcePlan.sourceIndexRef),split=task.sourcePlan.split==='confirm'?'sealed':task.sourcePlan.split;
  if(indexRef?.schema!=='ohuo-source-index-ref-v1'||indexRef.namespace!==task.sourcePlan.namespace||indexRef.fileSHA256!==sha(indexBytes)||index.version!==1||task.sourcePlan.familyIds.some((id:string)=>index.families?.[id]?.split!==split))fail('input_identity_unverified','sourcePlan','actual source bytes/families/splits differ');
  const cap=refs.get(task.capabilityRef);if(cap.id==='B04.api-probe.v1'&&(b.confirmedRecordRoots.length||b.studentReleaseFiles.length||b.datasetDirectory!==null||b.seed!==null||b.trainingPhase!==null||b.numericalRestartReceiptRef!==null))fail('input_identity_unverified','probeInputBinding','public-only probe inputs required');const studentReleasePaths:any={};for(const s of b.studentReleaseFiles){if(Object.hasOwn(studentReleasePaths,s.ref)||!task.releaseRefs.includes(s.ref))fail('input_identity_unverified','studentReleaseFiles','student reference not fixed or repeated');const release=this.readJSON(s.file),ref=refs.get(s.ref);if(ref?.schema!=='ohuo-student-task-release-v1'||ref.releaseSHA256!==s.file.sha256||ref.policyId!==release.policyId)fail('input_identity_unverified','studentRelease','student file differs');const selection=this.jsonBytes(this.evidenceBytes(release.selection));
   const firstRound=release.schema==='ohuo-student-release-first-round-v3';
   if(selection.schema!=='ohuo-student-selection-v1'||selection.rule!==(isFirstRoundR2Recipe(release.recipe)?'r2-first-dev-behavioral-candidate':firstRound?'nav-r15-first-round-unique-checkpoint':'section-15-unique-checkpoint')||selection.status!=='selected'||selection.selected?.manifestSHA256!==release.checkpoint?.sha256)fail('input_identity_unverified','studentSelection','actual original selection must bind the acting checkpoint');
   const summary=this.jsonBytes(this.evidenceBytes(selection.summary)),review=this.jsonBytes(this.evidenceBytes(selection.behaviorReview));
   if(summary.schema!=='ohuo-supervised-summary-v1'||summary.plan?.phase!=='formal'||summary.actual?.realTraining!==true||(isFirstRoundR2Recipe(summary.plan?.recipe)?!['candidate','diagnostic_stop'].includes(summary.actual.learningObservation?.decision)||!integer(summary.actual.optimizerSteps,1)||summary.actual.optimizerSteps%summary.plan.Uepoch!==0:summary.actual.optimizerSteps!==(firstRound?64:3*summary.plan.Uepoch))||review.schema!=='ohuo-distill-behavior-review-v1'||review.taskSHA256!==summary.taskSHA256||!Array.isArray(review.reviews))fail('input_identity_unverified','studentSelection','original complete formal run and behavior review required');
   for(const item of review.reviews)this.evidenceBytes(item.evidence);
   if(firstRound!==isFirstRoundRecipe(summary.plan?.recipe))fail('input_identity_unverified','studentSelection','release/recipe branch mismatch');
   const actual=selectDistillCheckpoint(summary.selection.allowedCheckpoints,review.reviews,summary.plan.recipe);
   if(!equal(actual,(({status,selected,reason,eligible})=>({status,selected,reason,eligible}))(selection)))fail('input_identity_unverified','studentSelection','fixed program selection differs');
   const selectionReceipts=entry.prerequisiteReceipts.filter((p:any)=>this.resolveRef(p.requirementRef).kind==='student-selection');if(selectionReceipts.length!==1)fail('student_completion_unverified','student-selection','one original acting S prerequisite required');const original=selectionReceipts[0],receipt=this.prerequisiteReceipt(original.receiptRef,task,original.requirementRef);this.studentSelectionCompletion(task.planRef,task.planVersion,receipt,s.file,release,selection);
   studentReleasePaths[s.ref]=this.relativePath(s.file.path);}
  if(cap.id==='B07.complete-match.v1'&&(b.confirmedRecordRoots.length||b.datasetDirectory!==null)||task.taskKind!=='supervised_training'&&(b.seed!==null||b.trainingPhase!==null||b.numericalRestartReceiptRef!==null))fail('input_identity_unverified','inputBinding','unexpected input mode');
  const result:any={readFirstRoundReference:(ref:string)=>this.resolveRef(ref),readFirstRoundEvidence:(ref:any)=>this.evidenceBytes(ref),sourceIdentity:task.sourcePlan.sourceIndexRef,sourceIndexPath:this.relativePath(b.sourceIndexFile.path),confirmedRecordRoots:b.confirmedRecordRoots.map((r:string)=>this.directory(r)),studentReleasePaths};
  if(task.taskKind==='supervised_training'){
   if(b.confirmedRecordRoots.length||b.studentReleaseFiles.length||b.datasetDirectory===null||!integer(b.seed)||!['calibration','formal'].includes(b.trainingPhase))fail('input_identity_unverified','supervised','explicit finite training input required');
   const datasetRef=refs.get(task.datasetRefs[0]);if(task.datasetRefs.length!==1||datasetRef?.schema!=='ohuo-frozen-dataset-ref-v1')fail('input_identity_unverified','dataset','frozen dataset reference required');
   result.datasetDirectory=this.directory(b.datasetDirectory);
   if(isFirstRoundRecipe(task.learnerRecipe)){const bytes=this.regular(join(result.datasetDirectory,'manifest.json'));if(sha(bytes)!==datasetRef.manifestSHA256)fail('input_identity_unverified','dataset','frozen manifest SHA mismatch');const manifest=this.jsonBytes(bytes),ids=validateFirstRoundDatasetMetadata(manifest,'research'),q=manifest.qualification,shape=firstRoundTrainingShape(task.learnerRecipe,b.trainingPhase,q.Ndemo,q.Nkeep),parent=validateFirstRoundParentEnvelope({parentRef:task.parentPolicyRef,envelope:refs.get(task.parentPolicyRef),readEvidence:f=>this.evidenceBytes(f)});if((isFirstRoundR2Recipe(task.learnerRecipe)?!isFirstRoundR2DatasetPlan(manifest.plan)||manifest.plan.researchProtocol.revisionRef!==task.scientificContract.analysisMethodRef||(b.trainingPhase==='formal'?!isScientificObservationLimits(task.limits):task.limits.maxOptimizerSteps!==1):task.limits.maxOptimizerSteps!==shape.maxOptimizerSteps)||ids.studentParentRef!==task.parentPolicyRef||!equal(ids.studentScorer,parent.parentIdentity)||!equal(ids.basePolicy,parent.basePolicyIdentity))fail('input_identity_unverified','trainingPhase','fixed first-round limit and separate parent metadata required');}
   else{const {loadFrozenDataset}=await import('./distill-data');loadFrozenDataset({directory:result.datasetDirectory,manifestSHA256:datasetRef.manifestSHA256},{requireTrainingEligible:true});}
   result.seed=b.seed;result.trainingPhase=b.trainingPhase;const numerical=this.numericalRestart(task,entry,b);result.numericalRestart=numerical?.numericalRestart??numerical;if(numerical?.numericalRecoveryContext)result.numericalRecoveryContext=numerical.numericalRecoveryContext;result.calibrationQualification=this.verifyCalibrationPrerequisite(task,entry,b,this.checkExistingRoot(),result.numericalRestart);
  }else if(b.datasetDirectory!==null)fail('input_identity_unverified','datasetDirectory','not applicable to fixed match/label producer');
  const pilotContext=this.firstRoundPilotContext(task);if(pilotContext){result.firstRoundPilotContext=pilotContext;this.checkFirstRoundPilotAdmission(task,this.checkExistingRoot(),pilotContext);}
  if(cap.id==='B04.api-probe.v1')this.probeInputs(task,refs,result);
  if(cap.id==='B07.designed-source.v1')await this.designerInputs(task,refs,result);
  if(cap.id==='B07.offline-label.v1')await this.offlineSelectionInputs(task,refs,result);
  if(cap.id==='B07.complete-match.v1'&&['ohuo-first-round-new-test-contract-v1','ohuo-common-view-new-test-contract-r2'].includes(this.resolveRef(task.scientificContract.decisionRuleRef)?.schema)){const c=this.resolveRef(task.scientificContract.decisionRuleRef);this.firstRoundNewTestCommit(task,c.selectionRef,c.sourceSpecRef);const {prepareFirstRoundNewTestHost}=await import('./first-round-evaluation-host');result.firstRoundNewTestExecution=await prepareFirstRoundNewTestHost({host:this.firstRoundEvaluationFacade(task),task,refs,inputs:result});const context=freezeJSON({firstRoundNewTestBranch:true,contractRef:task.scientificContract.decisionRuleRef,contract:c,selectionRef:c.selectionRef,references:[...this.references.keys()].map(ref=>({ref,value:this.resolveRef(ref)}))});this.selectionContexts.add(context);result.offlineSelectionAdmissionContext=context;this.checkOfflineSelectionAdmission(task,this.checkExistingRoot(),context);}
  const protocol=this.commonViewTaskProtocol(task,g);
  if(protocol){
   result.protocolRevision={ref:protocol.ref,value:protocol.value};
   if(task.taskKind==='supervised_training')result.inputWorkload=isScientificObservationLimits(task.limits)?{mode:'scientific-observation-v1',providerRequests:0,labelDecisions:0,matchAttempts:0}:{providerRequests:0,labelDecisions:0,matchAttempts:0,optimizerSteps:1};
   else if(cap.id==='B07.complete-match.v1'&&!result.firstRoundNewTestExecution)result.inputWorkload=inputWorkloadForQueue(refs.get(task.seatLayoutPlan),task);
   else if(cap.id==='B07.offline-label.v1'&&!result.commonViewTeacher&&!['ohuo-first-round-screen-contract-v1','ohuo-common-view-screen-contract-r2'].includes(refs.get(task.scientificContract.decisionRuleRef)?.schema))this.commonViewTeacherInputs(task,refs,result,protocol);
  }
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
export async function createFirstRoundConfirmationHost(inputRef:string){fixedReference(inputRef,'sourceInputRef');const repositoryRoot=resolve(fileURLToPath(new URL('../../',import.meta.url)));return new FixedHostFiles(repositoryRoot).commonViewConfirmationHost(inputRef);}
export async function createCumulativeOfflineSelectionDatasetProof(planRef:string,latestSelectionRef:string){fixedReference(planRef,'planRef');fixedReference(latestSelectionRef,'selectionRef');const repositoryRoot=resolve(fileURLToPath(new URL('../../',import.meta.url)));return new FixedHostFiles(repositoryRoot).cumulativeOfflineSelectionDatasetProof(planRef,latestSelectionRef);}
export async function createFirstRoundDatasetFreezeInputs(planRef:string,selectionRef:string){
 fixedReference(planRef,'planRef');fixedReference(selectionRef,'selectionRef');const repositoryRoot=resolve(fileURLToPath(new URL('../../',import.meta.url))),host=new FixedHostFiles(repositoryRoot),plan=host.resolveRef(planRef);
 if(plan?.designedAugmentation)return host.designedAugmentationDatasetProof(planRef,selectionRef);
 if(plan?.cumulativeSampling){const cumulativeProof=await host.cumulativeOfflineSelectionDatasetProof(planRef,selectionRef);return {plan,resolvedInputs:cumulativeProof.rounds.at(-1).resolvedInputs,selectionProof:null,cumulativeProof};}
 const selection=host.resolveRef(selectionRef);if(selection.schema!=='ohuo-offline-label-selection-v2')fail('selection_production_required','selectionRef','original full v2 selection required');const production=host.resolveRef(selection.productionRef);if(production.schema!=='ohuo-offline-selection-production-v1')fail('selection_production_required','productionRef','original exact production required');const spec=host.resolveRef(production.specRef),resolvedInputs=await host.offlineSelectionHostInputs(spec,{phase:'dataset'}),selectionProof={selection,production,resolvedInputs};return {plan,resolvedInputs,selectionProof,cumulativeProof:null};
}
export async function createOfflineSelectionDatasetProof(selectionRef:string){
 fixedReference(selectionRef,'selectionRef');const repositoryRoot=resolve(fileURLToPath(new URL('../../',import.meta.url))),host=new FixedHostFiles(repositoryRoot),selection=host.resolveRef(selectionRef);
 if(selection.schema!=='ohuo-offline-label-selection-v2')fail('selection_production_required','selectionRef','original full v2 selection required');const production=host.resolveRef(selection.productionRef);if(production.schema!=='ohuo-offline-selection-production-v1')fail('selection_production_required','productionRef','original exact production required');
 const spec=host.resolveRef(production.specRef),resolvedInputs=await host.offlineSelectionHostInputs(spec,{phase:'dataset'});return {selection,production,resolvedInputs};
}
// Fixed execution source closure from reviewed B07/L/B09 contracts. Contains no
// weights or user data. Additional B10 files are required only for that consumer.
export const HOST_SOURCE_FILES:string[]=[
 'lab/review6_2/screen-revalidation.mjs',
 'lab/review6_2/first-round-prequery-failure.mjs',
 'lab/review6_2/designed-source.ts',
 'lab/review6_2/designed-source-request.ts',
 'lab/review6_2/designed-source-consumer.ts',
 'lab/review6_2/designed-source-acceptance.ts',
 'lab/review6_2/designed-family-reservation.ts',
 'lab/review6_2/designed-provenance.mjs',
 'lab/review6_2/designed-augmentation-history.mjs',
 'lab/review6_2/designed-protocol-lineage.mjs',
 'lab/review6_2/first-round-budget.mjs',
 'lab/review6_2/first-round-source-action-scope.mjs',
 'lab/review6_2/first-round-contract.mjs',
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
 "lab/review6_2/first-round-cumulative-data.mjs",
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
 "packages/web/server/llm-project-rules-v541.mjs",
 "packages/web/server/llm-select.mjs",
 "packages/web/server/llm-selection-wire.mjs"
];
export const TRAINING_SOURCE_FILES=['lab/review6_2/distill-consumer.ts','lab/review6_2/distill-policy.ts','lab/review6_2/distill_checkpoint.py','lab/review6_2/distill_learner.py','packages/ai/src/hybrid/student.ts','lab/review6/training_core.py','lab/review6/human_proxy.py'];

export const FIRST_ROUND_SOURCE_FILES=['lab/review6_2/first-round-protocol.mjs','lab/review6_2/first-round-common-view.ts','lab/review6_2/first-round-source-batch.mjs','lab/review6_2/first-round-source.ts','lab/review6_2/first-round-registry-policy.ts','lab/review6_2/first-round-new-test-freeze.ts','lab/review6_2/first-round-pilot.ts','lab/review6_2/first-round-evaluation.ts','lab/review6_2/first-round-evaluation-consumer.ts','lab/review6_2/first-round-evaluation-host.ts','lab/review6_2/paired-summary.ts','lab/review6_2/research-evidence.ts','lab/review6/paired_stats.py','scripts/project-paths.mjs','packages/ai/src/nn/wave.ts','lab/review6_2/first-round-contract.mjs','lab/review6_2/first-round-parent.ts','lab/review6_2/first-round-selection.mjs','lab/review6_2/first-round-qualification.mjs','lab/review6_2/first-round-target.ts','lab/review6_2/first-round-screen.mjs','lab/review6_2/first-round-screen-actions.ts','packages/ai/src/candidate-spec.ts','packages/ai/src/policy/candidate-release.ts','packages/ai/src/nn/publicMemory.ts','lab/review6_2/first-round-screen-runtime.ts','lab/review6_2/first-round-screen-consumer.ts','lab/review6_2/first-round-evidence.ts','lab/review6_2/first-round-blind-review.ts','lab/review6/teacher-engine.ts','lab/review6/teacher-roots.ts','lab/review6/visible-world.ts','lab/review6/visible-schema.ts','lab/review6/policy-registry.ts','lab/review6/runtime.mjs'];

/** Named original-stage R16 immutable union producer, never a runner. */
export async function freezeFirstRoundNewTestSelectionFromHost({specRef,outputDir}:{specRef:string;outputDir?:string}){const repositoryRoot=resolve(fileURLToPath(new URL('../../',import.meta.url))),{freezeFirstRoundNewTestSelection}=await import('./first-round-new-test-freeze');return freezeFirstRoundNewTestSelection({host:new FixedHostFiles(repositoryRoot),specRef,outputDir});}
