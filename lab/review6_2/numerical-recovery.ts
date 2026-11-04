import {validateFirstRoundDatasetMetadata,validateFirstRoundParentEnvelope} from './first-round-parent';
import {firstRoundCoverage} from './first-round-qualification.mjs';
import {isFirstRoundRecipe,isFirstRoundR2Recipe,FIRST_ROUND_R2_STOPPING_RULE,firstRoundTrainingShape,firstRoundRecoveryTriggerAllowed} from './first-round-contract.mjs';
/** §36C common, read-only producer. No I/O, model, dispatch, permission minting or
 * budget algorithm. Admission below is ONLY the numerical-branch role gate;
 * original host authorization/plan checks and locked TC budgetView/reserve remain
 * mandatory. All parsed bindings are supplied by trusted fixed-file host code. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {posix} from 'node:path';
import {canonical,digest,fail,fixedReference,strictObject,validateIdentifier,validateTask,validateLimits,validateCost} from './task-schema.mjs';

export type R=string;
export interface F {id:string;sha256:string}
export interface FixedJSON<T=Record<string,any>> {ref:R;value:T}
export interface EvidenceBytes {ref:F;bytes:string|Uint8Array}
export type RecoveryRole='calibration_recovery'|'formal_continuation'|'formal_recovery';
export type RecoveryCase='failed_calibration'|'failed_formal';
export interface RoleSpec {role:RecoveryRole;taskId:string;attemptId:string;runId:string;experimentId:string;clauseRef:R;branchRef:R;phase:'calibration'|'formal'}
export interface NumericalRecoverySpec {schema:'ohuo-numerical-recovery-spec-v1';branchId:string;branchRef:R;originalRuleRef:R;planRef:R;budgetRef:R;researchBatchId:string;originExperimentId:string;failedTaskRef:R;failedRunId:string;case:RecoveryCase;roles:RoleSpec[]}
export interface NumericalRecoveryAssignment {schema:'ohuo-numerical-recovery-assignment-v1';specRef:R;receiptRef:R;roles:Array<{role:RecoveryRole;taskRef:R}>}
export interface ApprovedAction {clauseRef:R;branchRef:R|null;plannedTaskIds:string[];dependencyRefs:R[];expectedArtifactKinds:string[];acceptanceRuleRef:R;skipRuleRef:R|null;stopRuleRef:R|null}
export interface InputBinding {taskRef:R;sourceIndexFile:{path:string;sha256:string};confirmedRecordRoots:string[];datasetDirectory:string|null;studentReleaseFiles:Array<{ref:R;file:{path:string;sha256:string}}>;seed:number|null;trainingPhase:'calibration'|'formal'|null;numericalRestartReceiptRef:R|null}
export type CheckName='input'|'mask'|'stableLogSoftmax'|'loss'|'totalGradient'|'parameterChange';
export interface DiagnosticCheck {status:'passed'|'failed'|'unknown';evidence_refs:F[]}
export interface CalibrationQualificationDiagnostic {schema:'ohuo-calibration-qualification-v1';taskRef:R;runId:string;summaryRef:F;controlStateRef:F;checkpointFactsRefs:F[];checks:Record<CheckName,DiagnosticCheck>;issues:string[]}
export interface CalibrationQualificationInput {
 task:FixedJSON;inputBinding:InputBinding;dataset:FixedJSON;datasetManifest:EvidenceBytes;samples:EvidenceBytes;
 controlState:EvidenceBytes;summary:EvidenceBytes;
 checkpoints:Array<{controlCheckpoint:EvidenceBytes|null;manifest:EvidenceBytes;facts:EvidenceBytes}>;
 /** Human/source diagnostic judgments, each anchored to actual pre-read bytes.
  * No inference that a boolean or receipt kind establishes these semantics. */
 checks:Record<CheckName,DiagnosticCheck>;evidence:EvidenceBytes[];
}
export interface RecoverySourceBindings {
 references:FixedJSON[];inputBindings:InputBinding[];controlRoot:string;rootInstanceId:string;
 actionTaskRefs:Array<{clauseRef:R;branchRef:R|null;taskRef:R}>;
 /** All configured host-v2 assignment files, not merely the requested one. */
 assignmentFiles:EvidenceBytes[];datasetManifest:EvidenceBytes;evidence:EvidenceBytes[];
 calibrationQualifications:Array<{receiptRef:R;input:CalibrationQualificationInput}>;
 failureDiagnoses:Array<{runId:string;evidenceRef:F;metricsRef:F|null}>;
}
export interface RecoveryBindings extends RecoverySourceBindings {specRef:R;receiptRef:R;grant:Record<string,any>}
export type BranchStatus='not_started'|'calibration_active'|'calibration_qualified'|'formal_active'|'completed'|'stopped_numerical'|'blocked_unknown'|'blocked_diagnosis'|'stopped_by_original_rule';
export interface BranchView {key:string;status:BranchStatus;reason:string|null;branchUsesBefore:0|1;roles:Array<{role:RecoveryRole;taskId:string;runId:string;status:string}>}
export interface VerifiedNumericalRecovery {schema:'ohuo-verified-numerical-recovery-v1';verified:true;specRef:R;receiptRef:R;case:RecoveryCase;role:RecoveryRole;failedTaskId:string;parentTaskId:string;taskRef:R;datasetRef:R;parentPolicyRef:R;seed:number;restartFrom:'fixed-parent';branchUsesBefore:0|1}
export type RecoveryAdmission={admitted:true;numericalRestart:VerifiedNumericalRecovery;branch:BranchView}|{admitted:false;numericalRestart:null;branch:BranchView};
export interface VerifyNumericalRecoveryInput {task:Record<string,any>;receipt:Record<string,any>;spec:NumericalRecoverySpec;assignment:NumericalRecoveryAssignment;approvedActions:ApprovedAction[];state:Record<string,any>;bindings:RecoveryBindings}
export type BindNumericalRecoveryInput=
 |{stage:'spec';spec:NumericalRecoverySpec;approvedActions:ApprovedAction[];state:Record<string,any>;bindings:RecoverySourceBindings}
 |{stage:'assignment';spec:NumericalRecoverySpec;receipt:Record<string,any>;taskRefs:R[];approvedActions:ApprovedAction[];state:Record<string,any>;bindings:RecoveryBindings};

/** Public historical evidence never carries private samples or a permission. */
export interface PublicCalibrationEvidence {
 receiptRef:R;request:FixedJSON;production:EvidenceBytes;diagnostic:EvidenceBytes;
 producerAcceptance:EvidenceBytes;producerExecution:EvidenceBytes;
 task:FixedJSON;inputBinding:InputBinding;dataset:FixedJSON;datasetManifest:EvidenceBytes;
 controlState:EvidenceBytes;summary:EvidenceBytes;checkpoints:CalibrationQualificationInput['checkpoints'];evidence:EvidenceBytes[];
}
export interface PublicRecoveryBindings extends Omit<RecoveryBindings,'calibrationQualifications'> {calibrationEvidence:PublicCalibrationEvidence[]}
export interface PublicRecoveryEvidenceInput extends Omit<VerifyNumericalRecoveryInput,'bindings'> {bindings:PublicRecoveryBindings}
export interface PublicRecoveryEvidenceView {
 branch:BranchView;
 roleLineage:Array<{role:RecoveryRole;taskRef:R;parentTaskRef:R;clauseRef:R;branchRef:R;status:'verified-history'|'incomplete';qualificationDiagnosticRef:F|null}>;
 issues:string[];
}
type CommonSourceBindings=Omit<RecoverySourceBindings,'calibrationQualifications'>;
type CommonBindings=Omit<RecoveryBindings,'calibrationQualifications'>;
type BoundInput=Omit<VerifyNumericalRecoveryInput,'task'|'bindings'>&{bindings:CommonBindings};
type CalibrationPublicFacts=Omit<CalibrationQualificationInput,'samples'>;

const CHECKS:CheckName[]=['input','mask','stableLogSoftmax','loss','totalGradient','parameterChange'];
const ACTIVE=['preparing','running','stopping'];
const IDENTITY=['planRef','planVersion','budgetRef','authorizationRef','researchBatchId','sourceRevision','runtimeRef','parentPolicyRef','releaseRefs','rulesRef','sourcePlan','splitRefs','seatLayoutPlan','actorSampleRule','datasetRefs','labelPolicyRef','promptRef','operationScope','stopPolicy'];
const SCIENCE=['parentPolicyRef','releaseRefs','rulesRef','sourcePlan','splitRefs','seatLayoutPlan','actorSampleRule','datasetRefs','labelPolicyRef','promptRef','scientificContract','learnerRecipe'];
const SPEC_KEYS=['schema','branchId','branchRef','originalRuleRef','planRef','budgetRef','researchBatchId','originExperimentId','failedTaskRef','failedRunId','case','roles'];
const ROLE_KEYS=['role','taskId','attemptId','runId','experimentId','clauseRef','branchRef','phase'];
const ACTION_KEYS=['clauseRef','branchRef','plannedTaskIds','dependencyRefs','expectedArtifactKinds','acceptanceRuleRef','skipRuleRef','stopRuleRef'];
const RECEIPT_KEYS=['schema','planRef','planVersion','requirementRef','kind','decision','evidence_refs','analysisRef','numerical','calibration','recoveryRef'];
const NUMERICAL_KEYS=['failedTaskId','failedRunId','datasetRef','parentPolicyRef','seed','trigger','inputImplementationReviewRef','metricsRef'];
const BINDING_KEYS=['taskRef','sourceIndexFile','confirmedRecordRoots','datasetDirectory','studentReleaseFiles','seed','trainingPhase','numericalRestartReceiptRef'];
const sha=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
const copy=<T>(v:T):T=>JSON.parse(canonical(v));
const hash=(s:any)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const text=(s:any)=>typeof s==='string'&&s.trim().length>0;
const int=(n:any,min=0)=>Number.isSafeInteger(n)&&n>=min;
const need=(condition:any,reason:string,field:string,detail:string)=>{if(!condition)fail(reason,field,detail);};
function list(v:any,p:string){need(Array.isArray(v)&&v.length<=10000,'invalid_field',p,'bounded explicit array required');return v as any[];}
function refs(v:any,p:string){const a=list(v,p);a.forEach((x,i)=>fixedReference(x,`${p}[${i}]`));need(new Set(a).size===a.length,'duplicate_reference',p,'duplicate fixed reference');return a;}
function sameSet(a:any[],b:any[]){return a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(x=>b.includes(x));}
function fref(f:any){strictObject(f,'evidenceRef',['id','sha256']);need(text(f.id)&&!/(^|[/:-])latest($|[/:-])/i.test(f.id)&&hash(f.sha256),'invalid_reference','evidenceRef','immutable byte evidence identity required');return f as F;}
function evidenceJSON(e:EvidenceBytes){fref(e.ref);need(typeof e.bytes==='string'||e.bytes instanceof Uint8Array,'invalid_field','evidence.bytes','pre-read bytes required');need(sha(e.bytes)===e.ref.sha256,'reference_identity_mismatch',e.ref.id,'evidence bytes changed');try{return JSON.parse(Buffer.from(e.bytes).toString('utf8'));}catch{fail('invalid_field',e.ref.id,'JSON evidence required');}}
function evidenceMap(es:EvidenceBytes[]){const m=new Map<string,EvidenceBytes>();for(const e of list(es,'evidence')){fref(e.ref);need(sha(e.bytes)===e.ref.sha256,'reference_identity_mismatch',e.ref.id,'evidence bytes changed');const k=canonical(e.ref);need(!m.has(k),'duplicate_reference','evidence','duplicate exact evidence');m.set(k,e);}return m;}
function readEvidence(m:Map<string,EvidenceBytes>,f:F){fref(f);const e=m.get(canonical(f));need(e,'evidence_unavailable',f.id,'pre-read fixed evidence is absent');return evidenceJSON(e!);}
function fixedValue(f:FixedJSON){fixedReference(f.ref,'reference');need(digest(f.value)===f.ref.slice(f.ref.lastIndexOf(':')+1),'reference_identity_mismatch',f.ref,'canonical fixed content changed');return f.value;}
function catalog(b:CommonSourceBindings){const m=new Map<R,any>();for(const f of list(b.references,'references')){need(!m.has(f.ref),'duplicate_reference','references','duplicate fixed catalog entry');m.set(f.ref,fixedValue(f));}return (r:R)=>{fixedReference(r,'reference');need(m.has(r),'reference_unavailable',r,'fixed catalog entry absent');return m.get(r);};}
function inputBinding(b:CommonSourceBindings,ref:R){const matches=list(b.inputBindings,'inputBindings').filter(x=>x.taskRef===ref);need(matches.length===1,'input_identity_unverified','inputBindings','one exact fixed input binding required');const x=matches[0];strictObject(x,'inputBinding',BINDING_KEYS);need(int(x.seed)&&['calibration','formal'].includes(x.trainingPhase),'input_identity_unverified','inputBinding','explicit phase and sampling seed required');return x as InputBinding;}
function actionFor(actions:ApprovedAction[],clauseRef:R,branchRef:R|null){const xs=actions.filter(a=>a.clauseRef===clauseRef&&a.branchRef===branchRef);need(xs.length===1,'original_action_conflict','approvedActions','one original action required');return xs[0];}
function sameIdentity(a:any,b:any){if(isFirstRoundRecipe(a.learnerRecipe)||isFirstRoundRecipe(b.learnerRecipe))need(equal(a.outputSpec,b.outputSpec),'branch_identity_conflict','outputSpec','same original first-round proposal identity required');for(const key of IDENTITY)need(equal(a[key],b[key]),'branch_identity_conflict',key,'original frozen scientific identity/scope changed');need(equal({...a.learnerRecipe,learningRate:1e-4},{...b.learnerRecipe,learningRate:1e-4}),'branch_identity_conflict','learnerRecipe','only original learning-rate change allowed');}
function science(t:any){return Object.fromEntries(SCIENCE.map(k=>[k,t[k]]));}
function recipeAt(t:any){return {...t,learnerRecipe:{...t.learnerRecipe,learningRate:3e-5}};}
function validateSpec(s:NumericalRecoverySpec){
 strictObject(s,'spec',SPEC_KEYS);need(s.schema==='ohuo-numerical-recovery-spec-v1','unsupported_schema','spec.schema','numerical spec v1 required');
 for(const k of ['branchRef','originalRuleRef','planRef','budgetRef','failedTaskRef'])fixedReference((s as any)[k],`spec.${k}`);
 for(const k of ['branchId','researchBatchId','originExperimentId','failedRunId'])validateIdentifier((s as any)[k],`spec.${k}`);
 need(['failed_calibration','failed_formal'].includes(s.case),'unsupported_value','spec.case','two original cases only');
 const expected=s.case==='failed_calibration'?['calibration_recovery','formal_continuation']:['formal_recovery'];
 need(list(s.roles,'spec.roles').length===expected.length&&sameSet(s.roles.map(r=>r.role),expected),'branch_role_conflict','spec.roles','exact original role set required');
 for(const r of s.roles){strictObject(r,'role',ROLE_KEYS);for(const k of ['taskId','attemptId','runId','experimentId'])validateIdentifier((r as any)[k],`role.${k}`);fixedReference(r.clauseRef,'role.clauseRef');fixedReference(r.branchRef,'role.branchRef');need(r.branchRef===s.branchRef&&r.phase===(r.role==='calibration_recovery'?'calibration':'formal'),'branch_role_conflict','role','exact branch and phase required');}
 need(new Set(s.roles.map(r=>r.taskId)).size===s.roles.length&&new Set(s.roles.map(r=>r.runId)).size===s.roles.length,'branch_role_conflict','roles','distinct role task/run identities required');
}
function validateReceipt(r:any){
 strictObject(r,'receipt',RECEIPT_KEYS);need(r.schema==='ohuo-prerequisite-receipt-v2','unsupported_schema','receipt.schema','v2 required; legacy parsing belongs to unchanged v1 owner');
 for(const k of ['planRef','requirementRef'])fixedReference(r[k],k);need(int(r.planVersion,1)&&r.analysisRef===null,'branch_evidence_unverified','receipt','fixed plan and explicit null analysis required');
 need(['met','not_met','unknown'].includes(r.decision),'branch_evidence_unverified','decision','known receipt decision required');list(r.evidence_refs,'evidence_refs').forEach(fref);
 if(r.kind==='numerical-restart'){need(r.calibration===null&&r.recoveryRef!==null,'branch_evidence_unverified','receipt','mutually exclusive numerical shape required');fixedReference(r.recoveryRef,'recoveryRef');strictObject(r.numerical,'numerical',NUMERICAL_KEYS);}
 else if(r.kind==='calibration-qualification'){need(r.numerical===null&&r.recoveryRef===null,'branch_evidence_unverified','receipt','mutually exclusive calibration shape required');strictObject(r.calibration,'calibration',['taskRef','runId','summaryRef','controlStateRef','checkpointFactsRefs','diagnosticRef']);fixedReference(r.calibration.taskRef,'calibration.taskRef');validateIdentifier(r.calibration.runId,'calibration.runId');[r.calibration.summaryRef,r.calibration.controlStateRef,r.calibration.diagnosticRef,...list(r.calibration.checkpointFactsRefs,'checkpointFactsRefs')].forEach(fref);}
 else fail('unsupported_value','receipt.kind','only two v2 shapes');
}
function assignmentShape(a:NumericalRecoveryAssignment,s:NumericalRecoverySpec){strictObject(a,'assignment',['schema','specRef','receiptRef','roles']);need(a.schema==='ohuo-numerical-recovery-assignment-v1','unsupported_schema','assignment.schema','assignment v1 required');fixedReference(a.specRef,'assignment.specRef');fixedReference(a.receiptRef,'assignment.receiptRef');for(const x of list(a.roles,'assignment.roles')){strictObject(x,'assignment.role',['role','taskRef']);fixedReference(x.taskRef,'assignment.taskRef');}need(sameSet(a.roles.map(x=>x.role),s.roles.map(x=>x.role))&&new Set(a.roles.map(x=>x.taskRef)).size===a.roles.length,'branch_role_conflict','assignment.roles','one exact Task per original role required');}
function checkRun(state:any,t:any,ref:R){const r=state.runs[t.runId],mapped=state.tasks[t.taskId];if(!r&&!mapped)return null;need(r&&mapped===t.runId&&r.runId===t.runId&&r.taskRef===ref&&r.taskSHA256===digest(t)&&equal(r.task,t),'state_history_conflict','run','exact persisted Task/run mapping required');return r;}
function ledger(state:any,t:any,b:CommonSourceBindings){
 need(state?.schemaVersion===1&&state.rootInstanceId===b.rootInstanceId&&state.tasks&&state.runs&&state.budgets&&state.batches,'state_history_conflict','state','original complete control-root ledger required');
 const l=state.budgets[t.budgetRef],batch=state.batches[t.researchBatchId];need(l&&batch&&batch.budgetRef===t.budgetRef&&[l,batch].every(x=>x.planRef===t.planRef&&x.authorizationRef===t.authorizationRef)&&l.researchBatchId===t.researchBatchId,'budget_binding_conflict','state','original shared budget/batch required');
 validateLimits(l.limits);validateCost(l.used);need(l.reservations&&Object.hasOwn(l,'activeRunId')&&Number.isFinite(l.elapsedSeconds)&&l.elapsedSeconds>=0,'state_history_conflict','budget','original occupancy/time fields required');
 for(const x of Object.values(l.reservations) as any[]){validateCost(x.cost);need(['reserved','reserved_unknown','committed','consumed','released'].includes(x.status)&&state.runs[x.runId],'state_history_conflict','reservations','known reservation and original run required');}
 return l;
}
// Original accounting conservation only; never computes an available budget.
function ledgerConsumptionConsistent(l:any){
 const confirmed=(Object.values(l?.reservations??{}) as any[]).filter(r=>['committed','consumed'].includes(r.status));
 return ['providerRequests','optimizerSteps','matchAttempts','labelDecisions'].every(counter=>int(l?.used?.[counter])&&!confirmed.some(r=>!int(r.cost?.[counter]))&&confirmed.reduce((sum,r)=>sum+(r.cost?.[counter]??0),0)===l?.used?.[counter]);
}
function occupied(l:any,runId:string){return Object.values(l.reservations).some((x:any)=>x.runId===runId&&['reserved','reserved_unknown'].includes(x.status));}
function unknown(r:any,l:any,currentId:string|null){return r&&((ACTIVE.includes(r.status)&&l.activeRunId!==r.runId)||(!ACTIVE.includes(r.status)&&occupied(l,r.runId))||r.executionUnknown===true||r.observationStatus==='unknown'||Object.values(l.reservations).some((x:any)=>x.runId===r.runId&&x.status==='reserved_unknown')||r.runId!==currentId&&(r.cleanupConfirmed!==true||ACTIVE.includes(r.status)||l.activeRunId===r.runId)||r.runId===currentId&&!ACTIVE.includes(r.status)&&r.cleanupConfirmed!==true);}
function base(s:NumericalRecoverySpec,actions:ApprovedAction[],state:any,b:CommonSourceBindings){
 validateSpec(s);const get=catalog(b),root=validateTask(get(s.failedTaskRef)),binding=inputBinding(b,s.failedTaskRef);const l=ledger(state,root,b);const run=checkRun(state,root,s.failedTaskRef);need(run,'branch_evidence_unverified','failedRunId','original failed run must exist');
 need(root.runId===s.failedRunId&&root.experimentId===s.originExperimentId&&root.planRef===s.planRef&&root.budgetRef===s.budgetRef&&root.researchBatchId===s.researchBatchId&&root.planScope.branchRef===s.branchRef&&root.learnerRecipe?.learningRate===1e-4&&binding.trainingPhase===(s.case==='failed_calibration'?'calibration':'formal'),'branch_identity_conflict','failedTask','original 1e-4 failure anchor/phase required');
 need(s.roles.every(r=>r.taskId!==root.taskId&&r.runId!==root.runId),'branch_role_conflict','roles','roles cannot reuse failure-root identities');
 const branches=root.allowedBranches.filter((x:any)=>x.branchId===s.branchId&&x.conditionRef===s.originalRuleRef);need(branches.length===1,'branch_evidence_unverified','originalRuleRef','original approved once branch required');
 const plan=get(s.planRef),original=plan.actions??get(plan.actionsRef).actions;need(plan.planVersion===root.planVersion&&equal(original,actions),'original_action_conflict','approvedActions','actions must come unchanged from original fixed plan');
 for(const a of list(actions,'approvedActions')){strictObject(a,'action',ACTION_KEYS);fixedReference(a.clauseRef,'action.clauseRef');if(a.branchRef!==null)fixedReference(a.branchRef,'action.branchRef');refs(a.dependencyRefs,'action.dependencyRefs');list(a.plannedTaskIds,'plannedTaskIds').forEach((id:any)=>validateIdentifier(id,'plannedTaskIds'));need(new Set(a.plannedTaskIds).size===a.plannedTaskIds.length,'original_action_conflict','plannedTaskIds','unique original planned Tasks required');}
 actionFor(actions,root.planScope.clauseRef,s.branchRef);
 const templates=new Map<RecoveryRole,any>();
 for(const role of s.roles){const action=actionFor(actions,role.clauseRef,role.branchRef),entries=b.actionTaskRefs.filter(x=>x.clauseRef===role.clauseRef&&x.branchRef===role.branchRef);need(entries.length===1,'original_action_conflict','actionTaskRefs','one frozen original action template required');const template=validateTask(get(entries[0].taskRef));need(action.plannedTaskIds.includes(template.taskId)&&template.planScope.clauseRef===role.clauseRef&&template.planScope.branchRef===role.branchRef&&sameSet(template.planScope.prerequisiteRefs,action.dependencyRefs),'original_action_conflict','actionTaskRefs','template must be original planned Task for exact action');sameIdentity(template,root);const ib=inputBinding(b,entries[0].taskRef);need(ib.trainingPhase===role.phase&&ib.seed===binding.seed,'branch_identity_conflict','template.phase','fixed original phase/seed required');templates.set(role.role,template);}
 for(const role of s.roles){const template=recipeAt(templates.get(role.role)),pr=role.role==='formal_continuation'?s.roles.find(r=>r.role==='calibration_recovery')!:null,parent=pr?recipeAt(templates.get(pr.role)):root,parentExperiment=pr?.experimentId??root.experimentId,parentAttempt=pr?.attemptId??root.attemptId;need(role.attemptId!==parentAttempt,'attempt_conflict','attemptId','derived role must use distinct attempt');need(role.experimentId!==parentExperiment||equal(science(template),science(parent)),'experiment_identity_conflict','experimentId','preserve original TC scientific identity guard');}
 const declared=get(root.budgetRef);need(declared.controlRoot===b.controlRoot&&declared.planRef===s.planRef&&declared.researchBatchId===s.researchBatchId&&declared.authorizationRef===root.authorizationRef&&equal(declared.limits,l.limits),'budget_binding_conflict','budgetRef','original root and allocation cannot change');
 const data=get(root.datasetRefs[0]),manifest=evidenceJSON(b.datasetManifest);need(data.schema==='ohuo-frozen-dataset-ref-v1'&&data.manifestSHA256===b.datasetManifest.ref.sha256&&int(manifest.qualification?.Ndemo,1),'input_identity_unverified','datasetManifest','original frozen Ndemo required');
 return {get,root,binding,run,l,templates,manifest};
}
function taskGrant(t:any,ref:R,a:ApprovedAction,b:CommonBindings){
 const g=b.grant;strictObject(g,'grant',['schema','authorizationRef','planRef','planVersion','controlRoot','rootInstanceId','initialStateRef','initialization','mode','allowedTaskKinds','allowedCapabilityIds','scope','limits','tasks','approvalEvidence']);
 need(g.schema==='ohuo-local-research-grant-v1'&&g.mode==='research'&&g.authorizationRef===t.authorizationRef&&g.planRef===t.planRef&&g.planVersion===t.planVersion&&g.controlRoot===b.controlRoot&&g.rootInstanceId===b.rootInstanceId&&g.allowedTaskKinds.includes(t.taskKind)&&g.allowedCapabilityIds.includes('B10.supervised-rerank.v1'),'authorization_unverified','grant','original independently supplied grant binding required');
 const matches=list(g.tasks,'grant.tasks').filter(x=>x.taskRef===ref);need(matches.length===1,'authorization_unverified','taskRef','exact Task must be independently granted');const entry=matches[0];strictObject(entry,'taskGrant',['taskRef','prerequisiteReceipts']);const ps=list(entry.prerequisiteReceipts,'prerequisiteReceipts');for(const p of ps){strictObject(p,'prerequisite',['requirementRef','receiptRef']);fixedReference(p.requirementRef,'requirementRef');fixedReference(p.receiptRef,'receiptRef');}need(sameSet(ps.map(p=>p.requirementRef),a.dependencyRefs)&&sameSet(t.planScope.prerequisiteRefs,a.dependencyRefs),'original_dependency_conflict','prerequisiteRefs','Task/grant/original action sets must agree');
 need(Object.entries(t.operationScope).every(([k,v])=>!v||g.scope[k]===true),'authorization_unverified','scope','original grant scope required');validateLimits(g.limits);need(Object.keys(g.limits).every(k=>t.limits[k]<=g.limits[k]),'authorization_unverified','limits','role cannot increase original authorization');return entry;
}
function validateBound(input:BoundInput,checkAllAssignments:boolean){
 const {spec:s,receipt:r,assignment:a,approvedActions:actions,state,bindings:b}=input,c=base(s,actions,state,b);assignmentShape(a,s);validateReceipt(r);
 need(digest(s)===b.specRef.slice(b.specRef.lastIndexOf(':')+1)&&digest(r)===b.receiptRef.slice(b.receiptRef.lastIndexOf(':')+1)&&a.specRef===b.specRef&&a.receiptRef===b.receiptRef&&r.recoveryRef===b.specRef,'reference_identity_mismatch','recovery','spec -> receipt -> assignment must bind exact hashes');
 need(r.kind==='numerical-restart'&&r.planRef===s.planRef&&r.planVersion===c.root.planVersion,'branch_evidence_unverified','receipt','original numerical receipt required');
 const n=r.numerical;need(n.failedTaskId===c.root.taskId&&n.failedRunId===s.failedRunId&&n.datasetRef===c.root.datasetRefs[0]&&n.parentPolicyRef===c.root.parentPolicyRef&&n.seed===c.binding.seed&&firstRoundRecoveryTriggerAllowed(c.root.learnerRecipe,n.trigger),'branch_evidence_unverified','numerical','original failure and fixed inputs required');
 fref(n.inputImplementationReviewRef);if(n.metricsRef!==null)fref(n.metricsRef);
 need(r.evidence_refs.some((f:F)=>equal(f,n.inputImplementationReviewRef))&&(n.metricsRef===null||r.evidence_refs.some((f:F)=>equal(f,n.metricsRef))),'branch_evidence_unverified','evidence_refs','diagnostic/metrics sources must be listed');
 const tasks=new Map<RecoveryRole,{task:any;ref:R;binding:InputBinding;grant:any;run:any}>();
 for(const role of s.roles){const ref=a.roles.find(x=>x.role===role.role)!.taskRef,t=validateTask(c.get(ref)),ib=inputBinding(b,ref);sameIdentity(t,c.root);const expectedParent=role.role==='formal_continuation'?s.roles.find(x=>x.role==='calibration_recovery')!.taskId:c.root.taskId;
  need(['taskId','runId','attemptId','experimentId'].every(k=>t[k]===(role as any)[k])&&t.planScope.clauseRef===role.clauseRef&&t.planScope.branchRef===role.branchRef&&t.parentTaskId===expectedParent&&t.retryReasonRef===b.receiptRef&&t.learnerRecipe.learningRate===3e-5&&equal(t.scientificContract,c.templates.get(role.role).scientificContract),'branch_role_conflict','task','exact spec role, direct parent and approved recipe/phase science required');
  need(t.allowedBranches.length===1&&equal(t.allowedBranches[0],{...c.root.allowedBranches.find((x:any)=>x.branchId===s.branchId),evidenceRef:b.receiptRef}),'branch_role_conflict','allowedBranches','same single original branch; receipt is evidence only');
  need(ib.seed===c.binding.seed&&ib.trainingPhase===role.phase&&ib.numericalRestartReceiptRef===b.receiptRef,'branch_identity_conflict','inputBindings','exact role phase/seed/restart evidence required');
  const entry=taskGrant(t,ref,actionFor(actions,role.clauseRef,role.branchRef),b);need(entry.prerequisiteReceipts.some((p:any)=>p.receiptRef===b.receiptRef&&p.requirementRef===r.requirementRef),'authorization_unverified','receipt','numerical requirement must be independently bound');
  const run=checkRun(state,t,ref);if(run?.checkpoint)need(run.checkpoint.taskSHA256===digest(t)&&run.checkpoint.datasetSHA256===c.get(t.datasetRefs[0]).manifestSHA256&&run.checkpointSHA256===digest(run.checkpoint),'checkpoint_identity_mismatch','checkpoint','same Task resume only; never inherit calibration checkpoint');tasks.set(role.role,{task:t,ref,binding:ib,grant:entry,run});
 }
 const allowed=new Set(a.roles.map(x=>x.taskRef));
 for(const [id,run] of Object.entries(state.runs) as any){need(run.runId===id&&state.tasks[run.task?.taskId]===id&&run.taskSHA256===digest(run.task)&&run.taskRef.endsWith('@sha256:'+run.taskSHA256),'state_history_conflict','runs','complete exact persisted history required');if(run.task.planRef===s.planRef&&run.task.planScope?.branchRef===s.branchRef&&run.task.learnerRecipe?.learningRate===3e-5)need(allowed.has(run.taskRef)&&s.roles.some(role=>role.taskId===run.task.taskId&&role.runId===id),'branch_history_conflict','runs','old/new same-plan/branch 3e-5 history occupies the sole recovery');}
 for(const [id,runId] of Object.entries(state.tasks))need(state.runs[runId as string]?.task.taskId===id,'state_history_conflict','tasks','missing run is not an unused allowance');
 if(checkAllAssignments){let exact=0;const allTasks=new Set<string>(),allBranches=new Set<string>();for(const doc of list(b.assignmentFiles,'assignmentFiles')){const other=evidenceJSON(doc);const os=c.get(other.specRef);validateSpec(os);assignmentShape(other,os);const key=canonical([os.planRef,os.branchRef]);need(!allBranches.has(key),'branch_history_conflict','assignments','two specs/assignments cannot own the same original branch');allBranches.add(key);for(const role of other.roles){need(!allTasks.has(role.taskRef),'branch_role_conflict','assignments','two assignments claim same Task');allTasks.add(role.taskRef);}if(equal(other,a))exact++;}need(exact===1,'branch_evidence_unverified','assignmentFiles','exact assignment must be independently loaded once');}
 return {...c,tasks};
}
function diagnosisEstablished(n:any,root:any,seed:number,em:Map<string,EvidenceBytes>){
 if(!firstRoundRecoveryTriggerAllowed(root.learnerRecipe,n.trigger)||!em.has(canonical(n.inputImplementationReviewRef)))return false;const d=readEvidence(em,n.inputImplementationReviewRef);if(d.failedTaskId!==root.taskId||d.datasetRef!==root.datasetRefs[0]||d.parentPolicyRef!==root.parentPolicyRef||d.seed!==seed||d.inputsCorrect!==true||d.implementationCorrect!==true||d.trigger!==n.trigger)return false;
 if(n.trigger==='diagnosed_numerical_divergence')return d.numericalDivergence===true;
 if(n.metricsRef===null||!em.has(canonical(n.metricsRef)))return false;const m=readEvidence(em,n.metricsRef);return m.failedTaskId===root.taskId&&m.datasetRef===root.datasetRefs[0]&&m.seed===seed&&hash(m.update0?.sampleSetSHA256)&&m.update0.sampleSetSHA256===m.firstEpoch?.sampleSetSHA256&&[m.update0.demoCE,m.update0.keepKL,m.firstEpoch.demoCE,m.firstEpoch.keepKL].every(Number.isFinite)&&m.firstEpoch.demoCE>m.update0.demoCE&&m.firstEpoch.keepKL>m.update0.keepKL;
}
function privateQualificationBindings(b:RecoverySourceBindings){need(b&&Array.isArray(b.calibrationQualifications)&&!Object.hasOwn(b,'calibrationEvidence'),'private_qualification_required','bindings','public historical evidence is not an admission input');}
function qualificationIdentity(s:NumericalRecoverySpec,current:any,b:CommonSourceBindings,c:any,input:CalibrationPublicFacts,receipt:any){
 if(receipt.kind!=='calibration-qualification'||receipt.decision!=='met'||receipt.planRef!==s.planRef||receipt.planVersion!==current.task.planVersion||!current.grant.prerequisiteReceipts.some((p:any)=>p.receiptRef===c.qualificationReceiptRef&&p.requirementRef===receipt.requirementRef))return false;
 const task=validateTask(fixedValue(input.task));if(s.case==='failed_calibration'&&task.taskId!==s.roles.find(x=>x.role==='calibration_recovery')!.taskId)return false;
 if(task.taskId===current.task.taskId||task.runId===current.task.runId)return false;sameIdentity(task,current.task);
 if(task.learnerRecipe.learningRate!==(s.case==='failed_formal'?1e-4:3e-5)||!equal(task.learnerRecipe,{...current.task.learnerRecipe,learningRate:s.case==='failed_formal'?1e-4:3e-5})||input.inputBinding.seed!==current.binding.seed)return false;
 const prior=checkRun(c.state,task,input.task.ref);
 if(!prior||prior.status!=='completed'||prior.cleanupConfirmed!==true||c.l.activeRunId===prior.runId||occupied(c.l,prior.runId))return false;
 const snapshot=evidenceJSON(input.controlState);return snapshot.rootInstanceId===b.rootInstanceId&&equal(snapshot.runs[task.runId],prior);
}
function qualificationReceiptMatches(input:CalibrationPublicFacts,receipt:any,diagnosticRef:F){
 const task=input.task.value,expected={taskRef:input.task.ref,runId:task.runId,summaryRef:input.summary.ref,controlStateRef:input.controlState.ref,checkpointFactsRefs:input.checkpoints.map(x=>x.facts.ref),diagnosticRef};
 return equal(receipt.calibration,expected)&&receipt.evidence_refs.some((f:F)=>equal(f,diagnosticRef));
}
function qualification(s:NumericalRecoverySpec,current:any,b:RecoverySourceBindings,c:any){
 const options=b.calibrationQualifications.filter(x=>current.grant.prerequisiteReceipts.some((p:any)=>p.receiptRef===x.receiptRef));
 for(const q of options){const receipt=c.get(q.receiptRef);validateReceipt(receipt);const input=q.input;
  if(!qualificationIdentity(s,current,b,{...c,qualificationReceiptRef:q.receiptRef},input,receipt))continue;
  const d=buildCalibrationQualification(input);if(d.issues.length||CHECKS.some(k=>d.checks[k].status!=='passed'))continue;
  const raw=readEvidence(evidenceMap(b.evidence),receipt.calibration.diagnosticRef);if(!equal(raw,d))continue;
  if(qualificationReceiptMatches(input,receipt,receipt.calibration.diagnosticRef))return true;
 }
 return false;
}

/** The sole lifecycle derivation, shared by admission and read-only history. */
function deriveBranch(s:NumericalRecoverySpec,r:any,state:any,b:CommonBindings,c:any,qualify:(formal:any)=>boolean):{branch:BranchView;qualified:boolean;terminal:boolean}{
 const uses:Array<any>=[...c.tasks.values()].filter(x=>x.run);const branch:BranchView={key:canonical([s.planRef,s.branchRef]),status:'not_started',reason:null,branchUsesBefore:uses.length?1:0,roles:s.roles.map(x=>({role:x.role,taskId:x.taskId,runId:x.runId,status:c.tasks.get(x.role)!.run?.status??'not_started'}))};
 let qualified=false;
 const blocked=(status:BranchStatus,reason:string)=>({branch:{...branch,status,reason},qualified,terminal:true});
 const observation=state.hostPlanObservations?.[canonical([s.planRef,c.root.planVersion])];if(!observation||!['incomplete','completed','terminated'].includes(observation.status)||!int(observation.revision,1)||!hash(observation.closeoutSHA256))return blocked('blocked_unknown','plan_observation_unavailable');if(['completed','terminated'].includes(observation.status))return blocked('stopped_by_original_rule','plan_closed');
 const em=evidenceMap(b.evidence);
 // Known second numerical failure remains terminal even if a status was renamed.
 for(const x of uses){const records=b.failureDiagnoses.filter(d=>d.runId===x.task.runId);need(records.length<=1,'branch_evidence_unverified','failureDiagnoses','one fixed diagnosis per run');if(records.length){const d=readEvidence(em,records[0].evidenceRef);if(diagnosisEstablished({trigger:d.trigger,inputImplementationReviewRef:records[0].evidenceRef,metricsRef:records[0].metricsRef},x.task,x.binding.seed!,em))return blocked('stopped_numerical','second_numerical_failure');}}
 if(unknown(c.run,c.l,null)||occupied(c.l,c.run.runId))return blocked('blocked_unknown','origin_execution_unsettled');
 if(!['failed','interrupted'].includes(c.run.status)||r.decision!=='met'||!diagnosisEstablished(r.numerical,c.root,c.binding.seed!,em))return blocked('blocked_diagnosis','original_numerical_diagnosis_unverified');
 // Lifecycle is a branch-wide view. A legitimate active sibling is known
 // ownership, not unknown execution merely because another role was queried.
 for(const x of uses){if(unknown(x.run,c.l,c.l.activeRunId))return blocked('blocked_unknown','role_execution_unsettled');if(x.run.status==='failed'||x.run.failureReason!==null&&x.run.failureReason!==undefined)return blocked('blocked_diagnosis','role_failure_requires_diagnosis');}
 if(c.l.activeRunId!==null&&!uses.some(x=>x.task.runId===c.l.activeRunId))return blocked('blocked_unknown','original_budget_owned_by_another_run');
 const calibration=c.tasks.get('calibration_recovery'),formal=c.tasks.get(s.case==='failed_calibration'?'formal_continuation':'formal_recovery')!;
 const needsQualification=s.case==='failed_formal'||calibration?.run?.status==='completed'||Boolean(formal.run);
 qualified=needsQualification&&qualify(formal);
 if(needsQualification&&!qualified)return blocked('blocked_diagnosis','calibration_qualification_missing');
 if(formal.run?.status==='completed'){
  const steps=isFirstRoundRecipe(formal.task.learnerRecipe)?firstRoundTrainingShape(formal.task.learnerRecipe,'formal',c.manifest.qualification.Ndemo,c.manifest.qualification.Nkeep).maxOptimizerSteps:3*Math.ceil(c.manifest.qualification.Ndemo/32),committed=list(formal.run.committed,'run.committed'),reservations=Object.entries(c.l.reservations).filter(([,x]:any)=>x.runId===formal.task.runId&&['committed','consumed'].includes(x.status));
  const exactCommitment=new Set(committed).size===committed.length&&sameSet(committed,reservations.map(([id])=>id))&&reservations.every(([,x]:any)=>x.status==='committed')&&reservations.reduce((sum,[,x]:any)=>sum+x.cost.optimizerSteps,0)===steps;
  if(formal.run.checkpoint?.schema==='ohuo-supervised-run-v1'&&formal.run.checkpoint?.optimizerSteps===steps&&formal.run.checkpoint.studentCheckpoint?.optimizerSteps===steps&&formal.run.actualScope?.parameterUpdates===true&&c.l.accountingMode==='research'&&exactCommitment)return blocked('completed','role_already_completed');
  return blocked('blocked_diagnosis','formal_completion_facts_incomplete');
 }
 branch.status=formal.run?'formal_active':calibration?.run?.status==='completed'?'calibration_qualified':calibration?.run?'calibration_active':'not_started';
 return {branch,qualified,terminal:false};
}

/** Branch-role admission, NOT whole research authorization or budget admission. */
export function verifyNumericalRecoveryRole(input:VerifyNumericalRecoveryInput):RecoveryAdmission {
 privateQualificationBindings(input.bindings);
 const {spec:s,receipt:r,assignment:a,bindings:b,state}=input,c=validateBound(input,true),row=s.roles.find(x=>x.taskId===input.task.taskId);need(row,'branch_role_conflict','taskId','requested Task is not assigned');const current=c.tasks.get(row!.role)!;need(equal(input.task,current.task),'branch_role_conflict','task','request must be exact fixed assigned Task');
 const {branch,qualified,terminal}=deriveBranch(s,r,state,b,c,formal=>qualification(s,formal,b,{...c,state}));
 if(terminal)return {admitted:false,numericalRestart:null,branch};
 const formal=c.tasks.get(s.case==='failed_calibration'?'formal_continuation':'formal_recovery')!;
 // Role admission is separate from the shared view: M8 needs no second state
 // derivation, and a denied sibling request must not relabel known activity.
 if(current.run?.status==='completed'||c.l.activeRunId!==null&&c.l.activeRunId!==current.task.runId||row!.phase==='formal'&&!qualified||row!.phase==='calibration'&&formal.run)return {admitted:false,numericalRestart:null,branch};
 return {admitted:true,numericalRestart:{schema:'ohuo-verified-numerical-recovery-v1',verified:true,specRef:b.specRef,receiptRef:b.receiptRef,case:s.case,role:row!.role,failedTaskId:c.root.taskId,parentTaskId:current.task.parentTaskId,taskRef:current.ref,datasetRef:current.task.datasetRefs[0],parentPolicyRef:current.task.parentPolicyRef,seed:current.binding.seed!,restartFrom:'fixed-parent',branchUsesBefore:branch.branchUsesBefore},branch};
}

/** Freezes proposed IDs, not permission. Does not create receipt/Task/grant. */
export function bindNumericalRecoveryBranch(input:BindNumericalRecoveryInput):NumericalRecoverySpec|NumericalRecoveryAssignment {
 privateQualificationBindings(input.bindings);
 if(input.stage==='spec'){
  const c=base(input.spec,input.approvedActions,input.state,input.bindings),s=input.spec,b=input.bindings;
  const observation=input.state.hostPlanObservations?.[canonical([s.planRef,c.root.planVersion])];need(observation&&['incomplete','completed','terminated'].includes(observation.status)&&int(observation.revision,1)&&hash(observation.closeoutSHA256),'plan_unverified','planRef','original current plan observation required');need(!['completed','terminated'].includes(observation.status),'plan_closed','planRef','original closed plan cannot bind new recovery');
  const em=evidenceMap(b.evidence),records=b.failureDiagnoses.filter(x=>x.runId===s.failedRunId);need(records.length===1,'branch_evidence_unverified','diagnosis','one original diagnosed failure required before spec');
  const d=readEvidence(em,records[0].evidenceRef);need(diagnosisEstablished({trigger:d.trigger,inputImplementationReviewRef:records[0].evidenceRef,metricsRef:records[0].metricsRef},c.root,c.binding.seed!,em),'branch_evidence_unverified','diagnosis','original numerical trigger and input/implementation diagnosis must be established');
  for(const file of b.assignmentFiles){const assigned=evidenceJSON(file),other=c.get(assigned.specRef);if(other.planRef===s.planRef&&other.branchRef===s.branchRef)need(equal(other,s),'branch_history_conflict','assignments','already-bound original branch cannot gain a different spec');}
  if(s.case==='failed_formal'){const prior={task:recipeAt(c.root),binding:c.binding,grant:{prerequisiteReceipts:b.calibrationQualifications.map(q=>({receiptRef:q.receiptRef,requirementRef:c.get(q.receiptRef).requirementRef}))}};need(qualification(s,prior,b,{...c,state:input.state}),'branch_evidence_unverified','calibration','formal recovery needs original qualified 1e-4 calibration');}
  need(['failed','interrupted'].includes(c.run.status)&&!unknown(c.run,c.l,null)&&c.run.cleanupConfirmed===true&&!occupied(c.l,c.run.runId)&&c.l.activeRunId!==c.run.runId,'branch_evidence_unverified','failedRunId','failed writer must be resolved before binding');
  for(const r of Object.values(input.state.runs) as any[])need(!(r.task.planRef===input.spec.planRef&&r.task.planScope?.branchRef===input.spec.branchRef&&r.task.learnerRecipe?.learningRate===3e-5),'branch_history_conflict','runs','original branch already has recovery history');
  return copy(input.spec);
 }
 need(input.stage==='assignment','unsupported_value','stage','spec or assignment only');const get=catalog(input.bindings),s=input.spec;refs(input.taskRefs,'taskRefs');
 const assignment:NumericalRecoveryAssignment={schema:'ohuo-numerical-recovery-assignment-v1',specRef:input.bindings.specRef,receiptRef:input.bindings.receiptRef,roles:s.roles.map(role=>{const xs=input.taskRefs.filter(ref=>get(ref).taskId===role.taskId);need(xs.length===1,'branch_role_conflict','taskRefs','one already-fixed Task per role required');return {role:role.role,taskRef:xs[0]};})};
 need(input.taskRefs.length===s.roles.length,'branch_role_conflict','taskRefs','no extra recovery roles');validateBound({...input,assignment},false);return copy(assignment);
}

/** Read-only §36C diagnostic producer. Never emits a met receipt. Missing facts
 * produce explicit issues/unknown checks; byte identity conflicts throw. */
export function buildCalibrationQualification(input:CalibrationQualificationInput):CalibrationQualificationDiagnostic {
 need(input&&Object.hasOwn(input,'samples')&&input.samples,'private_samples_required','samples','complete original private sample bytes required by admission builder');
 return calibrationFacts(input,input.samples);
}
function calibrationFacts(input:CalibrationPublicFacts,sampleBytes:EvidenceBytes|null):CalibrationQualificationDiagnostic {
 const task=validateTask(fixedValue(input.task)),summary=evidenceJSON(input.summary),state=evidenceJSON(input.controlState),dataset=fixedValue(input.dataset),manifest=evidenceJSON(input.datasetManifest),em=evidenceMap(input.evidence),issues:string[]=[];
 const checks=copy(input.checks);strictObject(checks,'checks',CHECKS);
 const issue=(s:string,names:CheckName[]=CHECKS,status:'failed'|'unknown'='unknown')=>{if(!issues.includes(s))issues.push(s);for(const k of names)if(checks[k].status!=='failed')checks[k].status=status;};
 for(const k of CHECKS){strictObject(checks[k],`checks.${k}`,['status','evidence_refs']);need(['passed','failed','unknown'].includes(checks[k].status),'invalid_field',`checks.${k}.status`,'explicit diagnostic status required');const es=list(checks[k].evidence_refs,`checks.${k}.evidence_refs`);es.forEach(fref);if(!es.length||es.some((f:F)=>!em.has(canonical(f))))issue('diagnostic_evidence_missing:'+k,[k]);if(checks[k].status!=='passed'&&!issues.includes('diagnostic_not_passed:'+k))issues.push('diagnostic_not_passed:'+k);}
 const ib=input.inputBinding;strictObject(ib,'inputBinding',BINDING_KEYS);if(ib.taskRef!==input.task.ref||ib.trainingPhase!=='calibration'||!int(ib.seed)||task.taskKind!=='supervised_training'||task.learnerRecipe.initialization!=='fixed-parent-new-optimizer')issue('calibration_identity_conflict');
 const firstRound=isFirstRoundRecipe(task.learnerRecipe),r2=isFirstRoundR2Recipe(task.learnerRecipe);let firstShape:any=null;
 if(firstRound){try{validateFirstRoundDatasetMetadata(manifest,'research');firstShape=firstRoundTrainingShape(task.learnerRecipe,'calibration',manifest.qualification?.Ndemo,manifest.qualification?.Nkeep);}catch{issue('frozen_dataset_not_training_eligible');}}
 else if(manifest.schema!=='ohuo-distill-dataset-v2'||manifest.plan?.purpose!=='stage4'||manifest.qualification?.eligible!==true)issue('frozen_dataset_not_training_eligible');
 const Ndemo=manifest.qualification?.Ndemo,Uepoch=firstRound?(firstShape?.Uepoch??null):int(Ndemo,1)?Math.ceil(Ndemo/32):null,maxSteps=firstRound?(firstShape?.maxOptimizerSteps??null):Uepoch===null?null:Math.min(8,Uepoch);
 if(dataset.schema!=='ohuo-frozen-dataset-ref-v1'||dataset.manifestSHA256!==input.datasetManifest.ref.sha256||task.datasetRefs.length!==1||input.dataset.ref!==task.datasetRefs[0]||Uepoch===null)issue('frozen_dataset_identity_or_Ndemo_missing');
 if(summary.schema!=='ohuo-supervised-summary-v1'||summary.trainingKind!=='supervised_rerank'||summary.runId!==task.runId||summary.taskSHA256!==digest(task)||summary.plan?.phase!=='calibration'||summary.actual?.realTraining!==true||summary.actual.optimizerSteps!==maxSteps||summary.plan.Uepoch!==Uepoch||(!r2&&summary.plan.maxOptimizerSteps!==maxSteps)||!equal(summary.plan.recipe,task.learnerRecipe))issue('calibration_incomplete_or_summary_conflict');
 const fr=summary.frozenRefs,ids=manifest.plan?.identities;
 if(!fr||fr.dataset!==input.dataset.ref||fr.manifestSHA256!==input.datasetManifest.ref.sha256||fr.B!==(firstRound?task.outputSpec.proposalPolicyRef:task.parentPolicyRef)||fr.teacher!==task.labelPolicyRef||fr.prompt!==task.promptRef||!equal(fr.recipe,task.learnerRecipe)||fr.seed!==ib.seed||fr.phase!=='calibration'||fr.sourceRevision!==task.sourceRevision||fr.runtimeRef!==task.runtimeRef||!equal(fr.parentIdentity,firstRound?ids?.studentScorer:ids?.basePolicy)||fr.encoder!==ids?.encoderVersion||fr.candidate!==ids?.candidateSpecRef)issue('calibration_frozen_identity_conflict');
 const expectedFirstRoundPlan=r2?{recipe:task.learnerRecipe,phase:'calibration',Uepoch,stoppingRule:FIRST_ROUND_R2_STOPPING_RULE,observationEveryUpdates:Uepoch,effectiveBatch:2*Math.min(task.learnerRecipe.demoBatch,Ndemo)}:{recipe:task.learnerRecipe,phase:'calibration',Uepoch:1,maxUpdates:64,maxOptimizerSteps:1,effectiveBatch:2*Ndemo,milestoneUpdates:[0,1]};
 if(firstRound&&(!equal(summary.plan,expectedFirstRoundPlan)||fr?.parent!==task.parentPolicyRef||fr?.parent!==ids?.studentParentRef||fr?.B===fr?.parent||!equal(fr?.proposalIdentity,ids?.basePolicy)||!equal(fr?.inputContract,ids?.encoderConfig)||!equal(fr?.candidatePolicy,ids?.candidatePolicy)))issue('calibration_first_round_identity_conflict');
 const run=state.runs?.[task.runId],l=state.budgets?.[task.budgetRef];
 if(state.schemaVersion!==1||!state.rootInstanceId||state.tasks?.[task.taskId]!==task.runId||!run||run.taskRef!==input.task.ref||run.taskSHA256!==digest(task)||!equal(run.task,task)||run.status!=='completed'||run.cleanupConfirmed!==true||!l||l.accountingMode!=='research'||l.activeRunId===task.runId||occupied(l,task.runId)||run.executionUnknown===true||run.observationStatus==='unknown')issue('calibration_control_state_unsettled');
 const sampleMap=new Map<string,any>();let sampleRows:any[]=[];
 if(sampleBytes!==null){
  fref(sampleBytes.ref);need(sha(sampleBytes.bytes)===sampleBytes.ref.sha256,'reference_identity_mismatch','samples','frozen sample bytes changed');
  if(manifest.samples?.sha256!==sampleBytes.ref.sha256||manifest.samples.bytes!==Buffer.byteLength(Buffer.from(sampleBytes.bytes)))issue('sample_manifest_binding_conflict',['input']);
  else{try{sampleRows=Buffer.from(sampleBytes.bytes).toString('utf8').trimEnd().split('\n').map(x=>JSON.parse(x));for(const x of sampleRows){if(sampleMap.has(x.decisionId))throw Error('duplicate');sampleMap.set(x.decisionId,x);}}catch{issue('frozen_samples_unreadable',['input']);}}
  if(sampleRows.filter(x=>x.sampleKind==='demo'&&x.split==='train').length!==Ndemo)issue('frozen_demo_count_conflict',['input']);
  if(firstRound){try{const q=firstRoundCoverage(sampleRows,manifest.plan.families,r2?manifest.plan.researchProtocol:undefined);if(!q.eligible||q.Ndemo!==Ndemo||q.Nkeep!==manifest.qualification.Nkeep)issue('frozen_first_round_coverage_conflict',['input']);}catch{issue('frozen_first_round_coverage_conflict',['input']);}}
 }
 const checkpoints=list(input.checkpoints,'checkpoints'),steps=new Set<number>(),demoSeen=new Set<string>(),exposures={demo:new Map<string,number>(),keep:new Map<string,number>()};let lastFacts:any=null;
 if(maxSteps===null||checkpoints.length!==maxSteps+1)issue('committed_checkpoint_sequence_incomplete');
 const committed=new Set(run?.committed??[]);let counted=0;
 for(const [index,doc] of checkpoints.entries()){const cm=evidenceJSON(doc.manifest)??{},facts=evidenceJSON(doc.facts)??{},n=facts.optimizerSteps;steps.add(n);if(n!==index)issue('committed_checkpoint_order_conflict');
  if(cm.schema!=='ohuo-supervised-commit-v1'||facts.schema!==(firstRound?'ohuo-supervised-checkpoint-first-round-v2':'ohuo-supervised-checkpoint-v1')||facts.trainingKind!=='supervised_rerank'||cm.optimizerSteps!==n||cm.files?.['state.json']!==doc.facts.ref.sha256||cm.files?.['weights.f32']!==facts.weightsSHA256||!hash(cm.files?.['learner.pt'])||!equal(facts.frozenRefs,fr)||!equal(facts.recipe,task.learnerRecipe)||firstRound&&(!equal(facts.inputContract,ids.encoderConfig)||facts.completedEpochs!==(r2?Math.floor(n/Uepoch!):n)))issue('checkpoint_facts_identity_conflict');
  let pointer:any=null;
  if(n===0){pointer=run?.checkpoint?.milestones?.find((x:any)=>x.checkpoint?.optimizerSteps===0)?.checkpoint;const zero=facts.facts?.metrics?.find((m:any)=>m.kind==='update0'),eq=zero?.equivalence;if(!eq||eq.greedyIdentical!==true||eq.atol!==1e-5||!Number.isFinite(eq.maximumRawQAbsoluteDifference)||eq.maximumRawQAbsoluteDifference<0||eq.maximumRawQAbsoluteDifference>eq.atol||eq.decisions!==(sampleBytes===null?manifest.samples?.decisions:sampleRows.length))issue('update0_equivalence_missing',['input','mask','stableLogSoftmax']);}
  else if(doc.controlCheckpoint){const cp=evidenceJSON(doc.controlCheckpoint);pointer=cp.studentCheckpoint;
   if(cp.schema!=='ohuo-supervised-run-v1'||cp.taskSHA256!==digest(task)||cp.datasetSHA256!==input.datasetManifest.ref.sha256||cp.optimizerSteps!==n||!equal(cp.lastStep,facts.facts?.step))issue('control_checkpoint_identity_conflict');
   const matches=Object.entries(l?.reservations??{}).filter(([id,x]:any)=>x.runId===task.runId&&x.status==='committed'&&x.checkpointSHA256===digest(cp)&&committed.has(id));
   if(matches.length!==1||(matches[0][1] as any).cost.optimizerSteps!==1)issue('checkpoint_not_committed_in_original_ledger');else counted++;
  }else issue('control_checkpoint_missing');
  if(pointer?.schema!=='ohuo-supervised-pointer-v1'||pointer.optimizerSteps!==n||pointer.manifestSHA256!==doc.manifest.ref.sha256)issue('checkpoint_pointer_conflict');
  if(n>0){const step=facts.facts?.step;if(!step||step.optimizerSteps!==n)issue('step_facts_missing');else{
    if(![step.demo,step.keep,step.total].every(Number.isFinite))issue('nonfinite_loss',['loss'],'failed');if((!Number.isFinite(step.gradientNorm)||step.gradientNorm<0))issue('nonfinite_total_gradient',['totalGradient'],'failed');if((!Number.isFinite(step.parameterDeltaNorm)||step.parameterDeltaNorm<0))issue('nonfinite_parameter_change',['parameterChange'],'failed');
    const expected=r2?Math.min(task.learnerRecipe.demoBatch,Ndemo):firstRound?Ndemo:int(Ndemo,1)&&int(n,1)?Math.min(32,Ndemo-32*(n-1)):null;
    if(firstRound&&(step.epochEnded!==(r2?Ndemo<=task.learnerRecipe.demoBatch:true)||step.milestone!==true||step.completedEpochs!==(r2?Math.floor(n/Uepoch!):1)))issue('first_round_calibration_milestone_conflict',['input']);
    if(!Array.isArray(step.demoIds)||!Array.isArray(step.keepIds)||step.demoIds.length!==expected||step.keepIds.length!==expected||step.decisions!==2*expected!)issue('step_exposure_counts_conflict',['input']);
    else for(const kind of ['demo','keep'] as const)for(const id of step[kind+'Ids']){if(sampleBytes!==null){const sample=sampleMap.get(id);if(sample?.split!=='train'||sample?.sampleKind!==kind)issue('step_id_outside_frozen_training_data',['input']);}else if(!text(id))issue('step_id_invalid',['input']);else if(r2&&!Object.hasOwn(evidenceJSON(checkpoints[0].facts).perDecisionExposure?.[kind]??{},id))issue('step_id_outside_frozen_training_data',['input']);if(kind==='demo'){if(demoSeen.has(id))issue('demo_repeated_within_calibration_epoch',['input']);demoSeen.add(id);}exposures[kind].set(id,(exposures[kind].get(id)??0)+1);}
   }}
  for(const kind of ['demo','keep'] as const){const values=[...exposures[kind].values()],e={unique:values.length,total:values.reduce((a,b)=>a+b,0),repeats:values.reduce((a,b)=>a+Math.max(0,b-1),0)};if(!equal(facts.exposure?.[kind],e))issue('checkpoint_actual_exposure_conflict',['input']);}
  if(firstRound){const expectedIds=Object.fromEntries(['demo','keep'].map(kind=>[kind,sampleBytes!==null?sampleRows.filter(row=>row.sampleKind===kind&&row.split==='train').map(row=>row.decisionId):r2?Object.keys(evidenceJSON(checkpoints[0].facts).perDecisionExposure?.[kind]??{}):run?.checkpoint?.lastStep?.[kind+'Ids']]));
   if(['demo','keep'].some(kind=>!Array.isArray(expectedIds[kind])||expectedIds[kind].length!==Ndemo||new Set(expectedIds[kind]).size!==Ndemo))issue('first_round_frozen_exposure_ids_missing',['input']);
   else{const expected=Object.fromEntries(['demo','keep'].map(kind=>[kind,Object.fromEntries(expectedIds[kind].map((id:string)=>[id,r2?(exposures[kind as 'demo'|'keep'].get(id)??0):n]))]));if(!equal(facts.perDecisionExposure,expected))issue('first_round_per_decision_exposure_conflict',['input']);}
  }
  lastFacts=facts;
 }
 if(maxSteps===null||steps.size!==maxSteps+1||Array.from({length:(maxSteps??0)+1},(_,i)=>i).some(i=>!steps.has(i))||counted!==maxSteps)issue('committed_checkpoint_sequence_incomplete');
 if(run?.checkpoint?.optimizerSteps!==maxSteps||run?.checkpointSHA256!==digest(run?.checkpoint??null)||!equal(summary.actual?.latestCompleteCheckpoint,run?.checkpoint?.studentCheckpoint)||!equal(summary.actual?.exposure,lastFacts?.exposure)||!equal(summary.actual?.lastCommittedStep,lastFacts?.facts?.step))issue('final_calibration_checkpoint_conflict');
 // Conservation check only, not a replacement budgetView or allowance calculation.
 if(!ledgerConsumptionConsistent(l))issue('original_ledger_consumption_conflict');
 const runReservations=Object.entries(l?.reservations??{}).filter(([,r]:any)=>r.runId===task.runId&&['committed','consumed'].includes(r.status));
 if(runReservations.reduce((sum,[,r]:any)=>sum+r.cost.optimizerSteps,0)!==maxSteps||runReservations.some(([id])=>!committed.has(id))||[...committed].some(id=>!runReservations.some(([key])=>key===id)))issue('calibration_actual_steps_not_fully_accounted');
 return {schema:'ohuo-calibration-qualification-v1',taskRef:input.task.ref,runId:task.runId,summaryRef:copy(input.summary.ref),controlStateRef:copy(input.controlState.ref),checkpointFactsRefs:checkpoints.map(x=>copy(x.facts.ref)),checks,issues};
}

const PUBLIC_BINDING_KEYS=['references','inputBindings','controlRoot','rootInstanceId','actionTaskRefs','assignmentFiles','datasetManifest','evidence','failureDiagnoses','specRef','receiptRef','grant','calibrationEvidence'];
const PUBLIC_QUALIFICATION_KEYS=['receiptRef','request','production','diagnostic','producerAcceptance','producerExecution','task','inputBinding','dataset','datasetManifest','controlState','summary','checkpoints','evidence'];
const REQUEST_KEYS=['schema','taskRef','runId','summaryRef','controlStateRef','checkpointFactsRefs','checks'];
const PRODUCTION_KEYS=['schema','requestRef','taskRef','runId','producerSourceRevision','diagnosticRef','summaryRef','controlStateRef','checkpointFactsRefs','datasetRef','datasetManifestSHA256','samplesSHA256','parentPolicyRef','parentWeightsSHA256'];
const DIAGNOSTIC_KEYS=['schema','taskRef','runId','summaryRef','controlStateRef','checkpointFactsRefs','checks','issues'];
const PRODUCER_CLOSURE=['lab/review6_2/numerical-recovery.ts','lab/review6_2/ohuo-host.ts','lab/review6_2/ohuo-host-files.ts','lab/review6_2/task-schema.mjs'];
function publicDocument(doc:EvidenceBytes,name:string){need(doc&&doc.ref&&(typeof doc.bytes==='string'||doc.bytes instanceof Uint8Array),'public_evidence_missing',name,'actual fixed public evidence bytes required');return evidenceJSON(doc);}
function producerExecutionMatches(q:PublicCalibrationEvidence,production:any,em:Map<string,EvidenceBytes>,b:PublicRecoveryBindings){
 const execution=publicDocument(q.producerExecution,'producerExecution');strictObject(execution,'producerExecution',['command','exitCode','stdout','stderr','originalToolRef']);
 const command=list(execution.command,'producerExecution.command');need(command.length===7&&command.every(text)&&command[0].startsWith('/')&&/\/node(?:\.exe)?$/.test(command[0])&&equal(command.slice(1),['--import','tsx','lab/review6_2/ohuo-host.ts','qualify-calibration','--request',q.request.ref]),'producer_execution_conflict','command','exact actual Node launcher and fixed qualification argv required');
 need(execution.exitCode===0&&typeof execution.stdout==='string'&&(execution.stderr===null||typeof execution.stderr==='string'),'producer_execution_conflict','result','actual successful exit and faithfully preserved output required');
 fref(execution.originalToolRef);need(em.has(canonical(execution.originalToolRef)),'producer_tool_evidence_missing','originalToolRef','trusted original tool invocation/result bytes are required; production alone is not execution');
 const original=readEvidence(em,execution.originalToolRef);strictObject(original,'originalTool',['tool','input','result']);
 // This is the one actual adapter confirmed by H's tool owner, not a claim that
 // arbitrary tools share a native schema. Other formats remain pending.
 need(original.tool==='exec_command'&&original.input&&original.result,'producer_tool_format_unsupported','originalTool','confirmed exec_command call/result adapter required');
 const quoted=command.map((arg:string)=>"'"+arg.replaceAll("'","'\\''")+"'").join(' '),result=original.result;
 need(original.input.cmd===quoted&&typeof original.input.workdir==='string'&&original.input.workdir.startsWith('/'),'producer_execution_conflict','originalTool.input','exact quoted argv and actual working directory must match');
 // Only these two H-produced F IDs are repository-relative output paths.
 // Reuse H's existing root/run/request layout; other evidence IDs stay opaque.
 // H establishes realpath/no-symlink facts; this pure inspector binds their
 // already-fixed Task/control root to the actual relative CLI invocation.
 const cwd=original.input.workdir,controlRoot=b.controlRoot,task=q.task.value;
 need(posix.resolve(cwd)===cwd&&posix.isAbsolute(controlRoot)&&posix.resolve(controlRoot)===controlRoot,'producer_execution_conflict','repository','canonical original repository and control-root paths required');
 const rootWithin=posix.relative(posix.join(cwd,'lab/out'),controlRoot);
 need(rootWithin!==''&&!rootWithin.startsWith('..')&&!posix.isAbsolute(rootWithin)&&task.outputRoot===posix.join(controlRoot,'runs',task.runId),'producer_execution_conflict','repository','actual relative H entry must own the original same-root Task output');
 const outputDirectory=posix.join(task.outputRoot,'calibration-qualification',q.request.ref.split(':').at(-1)!);
 need(q.diagnostic.ref.id===posix.relative(cwd,posix.join(outputDirectory,'diagnostic.json'))&&q.production.ref.id===posix.relative(cwd,posix.join(outputDirectory,'production.json')),'producer_execution_conflict','repository','both actual H output identities must bind this cwd to the fixed Task and request');
 need(result.exit_code===execution.exitCode&&result.output===execution.stdout&&(Object.hasOwn(result,'stderr')?result.stderr===execution.stderr:execution.stderr===null),'producer_execution_conflict','originalTool.result','normalize actual exit_code/output; absent independent stderr must remain null');
 let stdout:any;try{stdout=JSON.parse(execution.stdout);}catch{fail('producer_execution_conflict','stdout','one exact qualification output object required');}
 strictObject(stdout,'stdout',['requestRef','taskRef','runId','producerSourceRevision','diagnosticRef','productionRef']);
 const expected={requestRef:q.request.ref,taskRef:q.task.ref,runId:q.task.value.runId,producerSourceRevision:production.producerSourceRevision,diagnosticRef:q.diagnostic.ref,productionRef:q.production.ref};
 need(equal(stdout,expected),'producer_execution_conflict','stdout','actual tool output must bind this request/source and both actual artifact byte references');
}
function inspectPublicQualification(q:PublicCalibrationEvidence,s:NumericalRecoverySpec,formal:any,b:PublicRecoveryBindings,c:any):F {
 strictObject(q,'calibrationEvidence',PUBLIC_QUALIFICATION_KEYS);fixedReference(q.receiptRef,'calibrationEvidence.receiptRef');
 const request=fixedValue(q.request);strictObject(request,'qualificationRequest',REQUEST_KEYS);need(request.schema==='ohuo-calibration-qualification-request-v1','unsupported_schema','qualificationRequest.schema','fixed qualification request v1 required');
 const task=validateTask(fixedValue(q.task)),dataset=fixedValue(q.dataset),manifest=publicDocument(q.datasetManifest,'datasetManifest'),summary=publicDocument(q.summary,'summary'),diagnostic=publicDocument(q.diagnostic,'diagnostic'),production=publicDocument(q.production,'production');
 strictObject(diagnostic,'diagnostic',DIAGNOSTIC_KEYS);strictObject(production,'production',PRODUCTION_KEYS);strictObject(request.checks,'checks',CHECKS);
 need(production.schema==='ohuo-calibration-qualification-production-v1'&&diagnostic.schema==='ohuo-calibration-qualification-v1','unsupported_schema','qualificationProducts','original strict diagnostic and production schemas required');
 const expectedRequest={schema:'ohuo-calibration-qualification-request-v1',taskRef:q.task.ref,runId:task.runId,summaryRef:q.summary.ref,controlStateRef:q.controlState.ref,checkpointFactsRefs:q.checkpoints.map(x=>x.facts.ref),checks:request.checks};
 need(equal(request,expectedRequest),'public_qualification_identity_conflict','request','request must bind actual Task/run and original committed facts, without future outputs');
 const expectedProduction={schema:'ohuo-calibration-qualification-production-v1',requestRef:q.request.ref,taskRef:q.task.ref,runId:task.runId,producerSourceRevision:production.producerSourceRevision,diagnosticRef:q.diagnostic.ref,summaryRef:q.summary.ref,controlStateRef:q.controlState.ref,checkpointFactsRefs:q.checkpoints.map(x=>x.facts.ref),datasetRef:q.dataset.ref,datasetManifestSHA256:q.datasetManifest.ref.sha256,samplesSHA256:manifest.samples?.sha256,parentPolicyRef:task.parentPolicyRef,parentWeightsSHA256:summary.frozenRefs?.parentIdentity?.weightsSHA256};
 need(hash(expectedProduction.samplesSHA256)&&hash(expectedProduction.parentWeightsSHA256)&&equal(production,expectedProduction),'public_qualification_identity_conflict','production','fixed dataset/sample/parent/diagnostic facts must agree; no self-reported substitute identity');
 need(dataset.manifestSHA256===q.datasetManifest.ref.sha256&&q.dataset.ref===task.datasetRefs[0]&&equal(c.get(task.labelPolicyRef),manifest.plan?.identities?.teacher)&&c.get(task.promptRef)?.promptRef===manifest.plan?.identities?.promptRef,'public_qualification_identity_conflict','dataset','original dataset, teacher and prompt binding required');
 const parent=c.get(task.parentPolicyRef);let parentMatches=false;
 if(isFirstRoundRecipe(task.learnerRecipe)){const metadata=validateFirstRoundParentEnvelope({parentRef:task.parentPolicyRef,envelope:parent,readEvidence:f=>{const doc=evidenceMap(q.evidence).get(canonical(f));need(doc,'public_evidence_missing','migrationReceipt','original migration evidence required');return Buffer.from(doc!.bytes);}});parentMatches=equal(metadata.parentIdentity,manifest.plan?.identities?.studentScorer)&&equal(metadata.basePolicyIdentity,manifest.plan?.identities?.basePolicy)&&equal(metadata.parentIdentity,summary.frozenRefs?.parentIdentity)&&metadata.scorer.weightsSHA256===production.parentWeightsSHA256;}
 else parentMatches=parent?.schema==='ohuo-parent-policy-ref-v1'&&equal(parent.policyIdentity,manifest.plan?.identities?.basePolicy)&&equal(parent.policyIdentity,summary.frozenRefs?.parentIdentity)&&parent.policyIdentity.weightsSHA256===production.parentWeightsSHA256;
 need(parentMatches&&equal(q.inputBinding,inputBinding(b,q.task.ref)),'public_qualification_identity_conflict','parentOrInputBinding','original frozen parent envelope and exact host input binding must match the public facts');
 const source=c.get(production.producerSourceRevision);strictObject(source,'producerSourceRevision',['baseCommit','files']);need(typeof source.baseCommit==='string'&&/^[a-f0-9]{40}$/.test(source.baseCommit),'producer_acceptance_missing','baseCommit','actual accepted producer source identity required');
 const files=list(source.files,'source.files');for(const file of files){strictObject(file,'source.file',['path','sha256']);need(text(file.path)&&hash(file.sha256),'producer_acceptance_missing','source.files','fixed actual source file SHA required');}
 need(new Set(files.map(f=>f.path)).size===files.length&&(isFirstRoundRecipe(task.learnerRecipe)?[...PRODUCER_CLOSURE,'lab/review6_2/first-round-contract.mjs','lab/review6_2/first-round-parent.ts','lab/review6_2/first-round-qualification.mjs']:PRODUCER_CLOSURE).every(path=>files.some(f=>f.path===path)),'producer_acceptance_missing','source.files','C/H invocation closure must be included in the accepted complete source object');
 const accepted=publicDocument(q.producerAcceptance,'producerAcceptance');
 need(accepted.schemaVersion===1&&accepted.kind==='functional-acceptance'&&accepted.functionalStatus==='accepted'&&equal(accepted.acceptedCodeRef,source)&&list(accepted.checkReceiptRefs,'checkReceiptRefs').length>0,'producer_acceptance_conflict','producerAcceptance','original immutable functional acceptance must bind the complete producer source exactly');
 // E retains its original acceptedProgram parent/dependency/check-receipt chain
 // verification. This check does not invent a new certificate or trust root.
 const em=evidenceMap(q.evidence);producerExecutionMatches(q,production,em,b);
 const facts:CalibrationPublicFacts={task:q.task,inputBinding:q.inputBinding,dataset:q.dataset,datasetManifest:q.datasetManifest,controlState:q.controlState,summary:q.summary,checkpoints:q.checkpoints,checks:request.checks,evidence:q.evidence};
 const receipt=c.get(q.receiptRef);validateReceipt(receipt);
 need(qualificationIdentity(s,formal,b,{...c,qualificationReceiptRef:q.receiptRef},facts,receipt)&&qualificationReceiptMatches(facts,receipt,q.diagnostic.ref),'public_qualification_identity_conflict','calibrationReceipt','exact qualified parent, same root/current committed run, original prerequisite and diagnostic source required');
 // Later formal activity may advance the shared ledger, but cannot rewrite
 // this completed calibration's committed records or consume unaccounted work.
 const snapshot=evidenceJSON(q.controlState),runRecords=(l:any)=>Object.fromEntries(Object.entries(l?.reservations??{}).filter(([,r]:any)=>r.runId===task.runId));
 need(equal(runRecords(snapshot.budgets?.[task.budgetRef]),runRecords(c.l))&&ledgerConsumptionConsistent(c.l),'public_qualification_identity_conflict','currentCalibrationLedger','original completed calibration reservations and current consumption accounting must remain intact');
 const computed=calibrationFacts(facts,null);
 need(equal(diagnostic,computed),'public_diagnostic_conflict','diagnostic','builder output must match request/check evidence and every publicly recheckable committed fact');
 need(diagnostic.issues.length===0&&CHECKS.every(k=>diagnostic.checks[k].status==='passed'),'public_qualification_incomplete','diagnostic','unknown or failed facts cannot support the successful-parent exception');
 return copy(q.diagnostic.ref);
}

/** Historical evidence only. No disk/private samples, execution or permissions.
 * Fixed metadata conflicts reject; missing/unverified provenance leaves lineage
 * incomplete. Current stop views never erase independently verified history. */
export function inspectNumericalRecoveryEvidence(input:PublicRecoveryEvidenceInput):PublicRecoveryEvidenceView {
 strictObject(input,'publicRecovery',['task','receipt','spec','assignment','approvedActions','state','bindings']);
 const b=input.bindings;strictObject(b,'publicBindings',PUBLIC_BINDING_KEYS);const c=validateBound(input,true),s=input.spec,state=input.state;
 const requested=s.roles.find(role=>role.taskId===input.task.taskId);need(requested&&equal(c.tasks.get(requested.role)?.task,input.task),'branch_role_conflict','task','requested historical Task must be an exact assigned role');
 const issues:string[]=[],add=(reason:string)=>{if(!issues.includes(reason))issues.push(reason);};
 const formal=c.tasks.get(s.case==='failed_calibration'?'formal_continuation':'formal_recovery')!;let diagnosticRef:F|null=null;
 const entries=list(b.calibrationEvidence,'calibrationEvidence'),seen=new Set<string>();
 for(const q of entries){strictObject(q,'calibrationEvidence',PUBLIC_QUALIFICATION_KEYS);fixedReference(q.receiptRef,'calibrationEvidence.receiptRef');need(!seen.has(q.receiptRef),'duplicate_reference','calibrationEvidence','one public source set per fixed qualification receipt');seen.add(q.receiptRef);
  if(!formal.grant.prerequisiteReceipts.some((p:any)=>p.receiptRef===q.receiptRef))continue;
  try{const ref=inspectPublicQualification(q,s,formal,b,{...c,state});need(diagnosticRef===null,'public_qualification_conflict','calibrationEvidence','one exact qualification source for this formal role');diagnosticRef=ref;}
  catch(error:any){add(`qualification:${error.reason??'public_evidence_unavailable'}:${error.field??'source'}`);}
 }
 if(diagnosticRef===null)add('qualification:public_qualification_missing');
 let originHistory=false;
 try{originHistory=['failed','interrupted'].includes(c.run.status)&&!unknown(c.run,c.l,null)&&!occupied(c.l,c.run.runId)&&input.receipt.decision==='met'&&diagnosisEstablished(input.receipt.numerical,c.root,c.binding.seed!,evidenceMap(b.evidence));}
 catch(error:any){add(`origin:${error.reason??'evidence_unavailable'}:${error.field??'source'}`);}
 if(!originHistory)add('origin:numerical_history_unverified');
 const roleLineage:PublicRecoveryEvidenceView['roleLineage']=s.roles.map(role=>{
  const own=c.tasks.get(role.role)!,parent=role.role==='formal_continuation'?c.tasks.get('calibration_recovery')!.ref:s.failedTaskRef;
  const established=originHistory&&(role.role==='calibration_recovery'||diagnosticRef!==null);
  return {role:role.role,taskRef:own.ref,parentTaskRef:parent,clauseRef:role.clauseRef,branchRef:role.branchRef,status:established?'verified-history':'incomplete',qualificationDiagnosticRef:diagnosticRef};
 });
 // Same algorithm as admission, but only after the historical checks above.
 const {branch}=deriveBranch(s,input.receipt,state,b,c,()=>diagnosticRef!==null);
 return {branch,roleLineage,issues};
}
