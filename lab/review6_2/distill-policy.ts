/** Node-only composite development candidate. Does not register or deploy S. */
import {readFileSync,realpathSync,writeFileSync,lstatSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {resolvePolicy,validatePolicyDescriptor} from '../../packages/ai/src/policy/resolve';
import {rerankInitialCandidates,type StudentRelease} from '../../packages/ai/src/hybrid/student';
import {resolveNodePolicy,POLICY_REPOSITORY_ROOT} from './policy-loader';
import type {DecisionBundle} from '../../packages/ai/src/hybrid/protocol';
import type {CandidateInputs} from './match-record';
import {canonical,digest,fixedReference,strictObject,validateTask,validateIdentifier,validateCost,validateLimits,fail} from './task-schema.mjs';
import {acquireSourceWriter} from './writer-lock';
const jsonIdentity=(v:unknown)=>JSON.parse(JSON.stringify(v));
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function fixed(ref:any){if(!ref||typeof ref.id!=='string'||!ref.id||/(^|[/:-])latest($|[/:-])/i.test(ref.id)||!/^[a-f0-9]{64}$/.test(ref.sha256))throw Error('fixed student reference required');}
function local(root:string,path:string){if(typeof path!=='string'||isAbsolute(path)||path.split('/').some(x=>x==='..'||x==='.'||!x))throw Error('student relative path required');const full=resolve(root,path);if(realpathSync(full)!==full||relative(root,full).startsWith('..'))throw Error('student path escape/symlink');return full;}
export async function loadStudentRelease(releasePath:string,expectedSHA256:string,repositoryRoot=POLICY_REPOSITORY_ROOT){
 const root=realpathSync(repositoryRoot),path=resolve(releasePath);if(realpathSync(path)!==path||relative(root,path).startsWith('..'))throw Error('student release path escape');
 const bytes=readFileSync(path);if(sha(bytes)!==expectedSHA256)throw Error('student release SHA mismatch');
 const r:StudentRelease=JSON.parse(bytes.toString());
 if(r.schema!=='ohuo-student-release-v1'||r.trainingKind!=='supervised_rerank'||typeof r.policyId!=='string'||!r.policyId||r.candidateSpecRef!=='ohuo-frozen-c8-expand4-v1'||r.tieBreakId!=='first-candidate-v1')throw Error('student release schema');
 for(const f of [r.dataset,r.recipe,r.selection])fixed(f);
 const basePolicy=await resolveNodePolicy(r.proposer.policyRef,root);
 if(!same(jsonIdentity(basePolicy.identity),r.proposer.identity)||basePolicy.identity.inputDim!==399||basePolicy.encoder.schema!=='v2'||basePolicy.encoder.ctxFill!=='rule-context'||basePolicy.encoder.passEncoding!=='action64'||basePolicy.encoder.candidateCompat!==undefined)throw Error('student frozen B identity mismatch');
 const scorer=validatePolicyDescriptor(r.scorer);
 if(scorer.inputDim!==399||scorer.parameterCount!==168449||!same(scorer.encoder,basePolicy.descriptor.encoder)||scorer.candidateSpecId!==basePolicy.descriptor.candidateSpecId||scorer.tierSpecId!=='none'||scorer.epsilon!==0||scorer.tieBreakId!==r.tieBreakId||scorer.policyId===r.policyId||scorer.policyId===basePolicy.identity.policyId||r.policyId===basePolicy.identity.policyId)throw Error('student scorer/proposer contract');
 const cpPath=local(root,r.checkpoint.path),cpBytes=readFileSync(cpPath);if(sha(cpBytes)!==r.checkpoint.sha256)throw Error('student checkpoint SHA');const cp=JSON.parse(cpBytes.toString());
 if(cp.schema!=='ohuo-supervised-commit-v1'||cp.files?.['weights.f32']!==scorer.weightsSHA256||local(root,scorer.weightsPathOrUrl.nodePath!)!==resolve(dirname(cpPath),'weights.f32'))throw Error('student checkpoint/scorer binding');
 const policy=await resolvePolicy(scorer.policyId,{registry:{schemaVersion:'gd-model-index-v1',defaultPolicyRef:scorer.policyId,policies:[scorer]},site:'node',readWeights:async p=>new Uint8Array(readFileSync(local(root,p))),sha256:sha});
 const network=policy.createNetwork(),release=structuredClone(r);
 const selectInitialAction=({bundle,candidateInputs}:{bundle:DecisionBundle;candidateInputs:CandidateInputs})=>{
  if(candidateInputs.policyId!==basePolicy.identity.policyId||!same(jsonIdentity(candidateInputs.policyIdentity),jsonIdentity(basePolicy.identity))||candidateInputs.encoderVersion!==basePolicy.identity.encoderVersion||candidateInputs.inputDim!==399)throw Error('student proposal input identity mismatch');
  return rerankInitialCandidates(bundle,candidateInputs,network).actionId;
 };
 return {release,releaseSHA256:expectedSHA256,basePolicy,selectInitialAction};
}
/** Pure §15 gate: no final match results and no inferred behavior review. */
export function selectDistillCheckpoint(milestones:any[],reviews:Array<{checkpointSHA256:string;status:string}>){
 const baseline=milestones.find(m=>m.checkpoint.optimizerSteps===0)?.metrics;
 if(!baseline||![baseline.demoCE,baseline.targetDisagreementCE].every(Number.isFinite))return {status:'no_candidate',selected:null,reason:'missing_update0_dev',eligible:[]};
 const eligible:any[]=[];let pending=false;
 for(const m of milestones){
  const v=m.metrics,c=m.checkpoint;if(c.optimizerSteps===0)continue;
  if(![v.demoCE,v.keepKL,v.targetDisagreementCE,v.keepDriftRate].every(x=>typeof x==='number'&&Number.isFinite(x))||v.keepDriftRate>.05||v.keepDriftRate<0||v.demoCE>=baseline.demoCE||v.targetDisagreementCE>baseline.targetDisagreementCE)continue;
  const matches=reviews.filter(r=>r.checkpointSHA256===c.manifestSHA256);
  if(matches.length!==1||matches[0].status==='pending'){pending=true;continue;}
  if(matches[0].status==='accepted')eligible.push(m);
 }
 if(pending)return {status:'pending_behavior_review',selected:null,reason:'necessary_behavior_review_missing',eligible:eligible.map(m=>m.checkpoint)};
 eligible.sort((a,b)=>a.metrics.demoCE-b.metrics.demoCE||a.metrics.keepKL-b.metrics.keepKL||a.checkpoint.optimizerSteps-b.checkpoint.optimizerSteps);
 return {status:eligible.length?'selected':'no_candidate',selected:eligible[0]?.checkpoint??null,reason:eligible.length?'section15_dev_only':'no_transferable_absorption_established',eligible:eligible.map(m=>m.checkpoint)};
}
/** Explicit post-review artifact, never called automatically by the learner. */
type CandidateFinalizationInputs={summaryPath:string;summarySHA256:string;reviewPath:string;reviewSHA256:string;parentPolicyRef:string;policyId:string;outputPath:string;repositoryRoot?:string;inputRefs?:{summary:StudentFileRef;review:StudentFileRef};verifyBeforeWrite?:(artifacts:Array<{path:string;bytes:string}>)=>void};
async function prepareStudentCandidate({summaryPath,summarySHA256,reviewPath,reviewSHA256,parentPolicyRef,policyId,outputPath,repositoryRoot=POLICY_REPOSITORY_ROOT,inputRefs}:CandidateFinalizationInputs){
 const root=realpathSync(repositoryRoot),summaryBytes=readFileSync(summaryPath),reviewBytes=readFileSync(reviewPath);
 if(sha(summaryBytes)!==summarySHA256||sha(reviewBytes)!==reviewSHA256)throw Error('selection input SHA mismatch');
 const summary=JSON.parse(summaryBytes.toString()),review=JSON.parse(reviewBytes.toString());
 if(summary.schema!=='ohuo-supervised-summary-v1'||summary.plan.phase!=='formal'||summary.actual.realTraining!==true||summary.actual.optimizerSteps!==3*summary.plan.Uepoch||review.schema!=='ohuo-distill-behavior-review-v1'||review.taskSHA256!==summary.taskSHA256||!Array.isArray(review.reviews))throw Error('complete formal run and frozen behavior review required');
 for(const r of review.reviews){fixed(r.evidence);if(!['accepted','rejected','pending'].includes(r.status))throw Error('behavior review status');}
 const selection=selectDistillCheckpoint(summary.selection.allowedCheckpoints,review.reviews);
 if(!selection.selected)return {selection,release:null};
 const cpPath=resolve(dirname(summaryPath),selection.selected.path,'manifest.json');if(realpathSync(cpPath)!==cpPath)throw Error('selection checkpoint symlink');
 const cpBytes=readFileSync(cpPath);if(sha(cpBytes)!==selection.selected.manifestSHA256)throw Error('selected checkpoint SHA mismatch');const cp=JSON.parse(cpBytes.toString());
 const parent=await resolveNodePolicy(parentPolicyRef,root);if(!policyId||policyId===parent.identity.policyId)throw Error('new S policy ID required');
 const parsed=(ref:string)=>{const marker=ref.lastIndexOf('@sha256:');if(marker<1)throw Error('fixed selection ref');return {id:ref.slice(0,marker),sha256:ref.slice(marker+8)};};
 const stateBytes=readFileSync(resolve(dirname(cpPath),'state.json'));if(sha(stateBytes)!==cp.files['state.json'])throw Error('selected checkpoint facts SHA');const state=JSON.parse(stateBytes.toString());
 if(!same(jsonIdentity(parent.identity),state.frozenRefs.parentIdentity)||state.frozenRefs.B!==summary.frozenRefs.B||state.frozenRefs.manifestSHA256!==summary.frozenRefs.manifestSHA256||state.weightsSHA256!==cp.files['weights.f32'])throw Error('selected checkpoint/run identity');
 const scorer={...parent.descriptor,policyId:policyId+'-scorer',modelVersion:policyId+'-'+selection.selected.optimizerSteps,weightsSHA256:cp.files['weights.f32'],weightsPathOrUrl:{nodePath:relative(root,resolve(dirname(cpPath),'weights.f32'))}};
 validatePolicyDescriptor(scorer);
 const selectionRecord={schema:'ohuo-student-selection-v1',rule:'section-15-unique-checkpoint',summary:inputRefs?.summary??{id:summary.runId+'-summary',sha256:summarySHA256},behaviorReview:inputRefs?.review??{id:policyId+'-behavior-review',sha256:reviewSHA256},...selection};
 const selectionBytes=JSON.stringify(selectionRecord)+'\n';
 const release:StudentRelease={schema:'ohuo-student-release-v1',trainingKind:'supervised_rerank',policyId,proposer:{policyRef:parentPolicyRef,identity:jsonIdentity(parent.identity)},scorer,candidateSpecRef:'ohuo-frozen-c8-expand4-v1',tieBreakId:'first-candidate-v1',checkpoint:{path:relative(root,cpPath),sha256:selection.selected.manifestSHA256},dataset:parsed(summary.frozenRefs.dataset),recipe:{id:'supervised-rerank-v1',sha256:sha(Buffer.from(JSON.stringify(summary.plan.recipe)))},selection:{id:policyId+'-dev-selection',sha256:sha(Buffer.from(selectionBytes))}};
 const target=resolve(outputPath);if(relative(root,target).startsWith('..')||!relative(root,target).startsWith('lab/out/')||realpathSync(dirname(target))!==dirname(target))throw Error('development release output only');
 const artifacts=[{path:target+'.selection.json',bytes:selectionBytes},{path:target,bytes:JSON.stringify(release)+'\n'}];
 if(inputRefs&&(inputRefs.summary.sha256!==summarySHA256||inputRefs.review.sha256!==reviewSHA256))throw Error('selection input refs SHA mismatch');
 return {selection,release:{path:target,sha256:sha(Buffer.from(artifacts[1].bytes))},artifacts};
}

export async function finalizeStudentCandidate(input:CandidateFinalizationInputs){
 const prepared=await prepareStudentCandidate(input);if(!prepared.release)return {selection:prepared.selection,release:null};
 for(const a of prepared.artifacts!)verifyIdenticalIfPresent(a.path,a.bytes);
 input.verifyBeforeWrite?.(prepared.artifacts!);
 for(const a of prepared.artifacts!)writeNewOrVerifyIdentical(a.path,a.bytes);
 return {selection:prepared.selection,release:prepared.release};
}

/** §36E post-training artifact entry. The host is trusted fixed code, not JSON
 * supplied by a request. No learner, network, evaluator or registry write. */
export interface StudentFileRef {id:string;sha256:string}
export interface StudentFinalizationRequest {
 schema:'ohuo-student-finalization-request-v1';planRef:string;planVersion:number;clauseRef:string;branchRef:string|null;
 trainingTaskRef:string;trainingRunId:string;summaryRef:StudentFileRef;reviewRef:StudentFileRef;
 parentPolicyRef:string;policyId:string;outputPath:string;
}
export interface StudentFinalizationReceipt {
 schema:'ohuo-student-finalization-receipt-v1';requestRef:string;trainingTaskRef:string;trainingRunId:string;
 summaryRef:StudentFileRef;reviewRef:StudentFileRef;status:'selected'|'no_candidate'|'pending_behavior_review';
 selectionRef:StudentFileRef|null;releaseRef:StudentFileRef|null;issues:string[];
}
export interface StudentFinalizationHost {
 repositoryRoot:string;root:string;manifest:any;
 resolveRef(ref:string):any;evidenceBytes(ref:StudentFileRef):Uint8Array;
 checkExistingRoot():any;
 readNonrunnerAction(request:StudentFinalizationRequest,purpose:'student-finalization'):{grant:any;plan:any;action:any;rule:any;closeout:{entity:any;observation:any};prerequisites:Array<{requirementRef:string;receiptRef:string;requirement:any;receipt:any}>;priorObservation:any};
 readStudentFinalizationTraining(task:any):Promise<{grantEntry:any;action:any;inputBinding:any}>;
}
const requestKeys=['schema','planRef','planVersion','clauseRef','branchRef','trainingTaskRef','trainingRunId','summaryRef','reviewRef','parentPolicyRef','policyId','outputPath'];
const receiptKeys=['schema','requestRef','trainingTaskRef','trainingRunId','summaryRef','reviewRef','status','selectionRef','releaseRef','issues'];
const requireStudent=(ok:unknown,reason:string,detail:string)=>{if(!ok)fail(reason,'studentFinalization',detail);};
const integer=(n:any,min=0)=>Number.isSafeInteger(n)&&n>=min;
const hash=(s:any)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function list(v:any){requireStudent(Array.isArray(v)&&v.length<=10000,'invalid_field','bounded explicit array required');return v as any[];}
function fileRef(f:any):StudentFileRef {strictObject(f,'evidenceRef',['id','sha256']);fixed(f);requireStudent(f.id.trim().length>0&&!/(^|[./:_-])latest([./:_-]|@|$)/i.test(f.id),'invalid_reference','fixed non-latest evidence required');return f;}
function regularBytes(path:string){const st=lstatSync(path);requireStudent(st.isFile()&&!st.isSymbolicLink()&&realpathSync(path)===path&&st.size<=32*1024*1024,'invalid_host_file','bounded regular nonsymlink file required');return readFileSync(path);}
function verifyIdenticalIfPresent(path:string,bytes:string){if(existsSync(path)||(()=>{try{return lstatSync(path).isSymbolicLink();}catch{return false;}})())requireStudent(regularBytes(path).toString('utf8')===bytes,'artifact_conflict','existing artifact bytes differ: '+path);}
function writeNewOrVerifyIdentical(path:string,bytes:string){verifyIdenticalIfPresent(path,bytes);if(!existsSync(path))writeFileSync(path,bytes,{flag:'wx',mode:0o600});}
function requestShape(r:any):StudentFinalizationRequest {
 strictObject(r,'studentFinalizationRequest',requestKeys);requireStudent(r.schema==='ohuo-student-finalization-request-v1'&&integer(r.planVersion,1),'unsupported_schema','fixed finalization request v1 required');
 for(const k of ['planRef','clauseRef','trainingTaskRef'])fixedReference(r[k],k);if(r.branchRef!==null)fixedReference(r.branchRef,'branchRef');
 validateIdentifier(r.trainingRunId,'trainingRunId');validateIdentifier(r.policyId,'policyId');fileRef(r.summaryRef);fileRef(r.reviewRef);fileRef({id:r.policyId+'-dev-selection',sha256:r.summaryRef.sha256});fileRef({id:r.outputPath,sha256:r.summaryRef.sha256});
 requireStudent(typeof r.parentPolicyRef==='string'&&r.parentPolicyRef.trim().length>0&&!/(^|[./:_-])latest([./:_-]|@|$)/i.test(r.parentPolicyRef),'invalid_reference','fixed Node parent selector required');return r;
}
function evidence(host:StudentFinalizationHost,f:StudentFileRef){fileRef(f);const bytes=Buffer.from(host.evidenceBytes(f));requireStudent(sha(bytes)===f.sha256,'reference_identity_mismatch','evidence bytes differ');return bytes;}
function evidencePath(host:StudentFinalizationHost,f:StudentFileRef){const matches=list(host.manifest.evidenceFiles).filter(e=>e.id===f.id&&e.file?.sha256===f.sha256);requireStudent(matches.length===1,'evidence_unavailable','one fixed evidence file mapping required');return local(host.repositoryRoot,matches[0].file.path);}
function catalog(host:StudentFinalizationHost){const rows=list(host.manifest.references),seen=new Set<string>();return rows.map(row=>{fixedReference(row.ref,'reference');requireStudent(!seen.has(row.ref),'duplicate_reference','duplicate catalog reference');seen.add(row.ref);const value=host.resolveRef(row.ref);requireStudent(digest(value)===row.ref.split(':').at(-1),'reference_identity_mismatch','fixed canonical reference changed');return {ref:row.ref,value};});}
function sameSet(a:any[],b:any[]){return a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(x=>b.includes(x));}
function receiptShape(r:any):StudentFinalizationReceipt {
 strictObject(r,'studentFinalizationReceipt',receiptKeys);requireStudent(r.schema==='ohuo-student-finalization-receipt-v1'&&['selected','no_candidate','pending_behavior_review'].includes(r.status),'artifact_conflict','known strict completion receipt required');
 fixedReference(r.requestRef,'requestRef');fixedReference(r.trainingTaskRef,'trainingTaskRef');validateIdentifier(r.trainingRunId,'trainingRunId');fileRef(r.summaryRef);fileRef(r.reviewRef);list(r.issues).forEach(x=>requireStudent(typeof x==='string','artifact_conflict','explicit issues required'));
 if(r.status==='selected'){fileRef(r.selectionRef);fileRef(r.releaseRef);}else requireStudent(r.selectionRef===null&&r.releaseRef===null,'artifact_conflict','nonselected cannot carry a release');return r;
}
function authority(request:StudentFinalizationRequest,host:StudentFinalizationHost,task:any,allowEstablished=false){
 // H owns the fixed non-runner original-authority / specialized prerequisite
 // reader. This is not start(), and never asks a completed training role to run.
 const facts=host.readNonrunnerAction(request,'student-finalization'),{grant:g,plan,action,rule,closeout,prerequisites,priorObservation}=facts,c=closeout.entity;
 requireStudent(g.mode==='research'&&g.planRef===request.planRef&&g.planVersion===request.planVersion&&g.authorizationRef===task.authorizationRef&&g.rootInstanceId===host.manifest.rootInstanceId&&resolve(host.repositoryRoot,g.controlRoot)===host.root&&g.scope?.localExecution===true&&!g.scope?.deployment,'authorization_unverified','same original independent local grant required');
 requireStudent(digest(plan)===request.planRef.split(':').at(-1)&&plan.planVersion===request.planVersion&&c.planRef===request.planRef&&c.planVersion===request.planVersion,'plan_unverified','original plan/current closeout identity differs');
 const actions=list(plan.actions??host.resolveRef(plan.actionsRef).actions),matches=actions.filter(a=>a.clauseRef===request.clauseRef&&a.branchRef===request.branchRef);
 requireStudent(matches.length===1&&same(action,matches[0]),'original_action_conflict','one original selection action required');
 strictObject(action,'selectionAction',['clauseRef','branchRef','plannedTaskIds','dependencyRefs','expectedArtifactKinds','acceptanceRuleRef','skipRuleRef','stopRuleRef']);
 requireStudent(list(action.expectedArtifactKinds).includes('ohuo-student-finalization-receipt-v1')&&same(rule,host.resolveRef(action.acceptanceRuleRef))&&rule.schema==='ohuo-stage-action-rule-v1'&&rule.stage===5&&rule.phase==='formal','stage_mapping_unverified','original formal finalization artifact purpose required');
 const rows=list(c.actions).filter(a=>a.clauseRef===request.clauseRef&&a.branchRef===request.branchRef&&same(a.plannedTaskIds,action.plannedTaskIds));requireStudent(rows.length===1,'original_action_conflict','one original closeout action required');
 const observation=closeout.observation,prior=host.checkExistingRoot().hostPlanObservations?.[canonical([request.planRef,request.planVersion])]??null;
 requireStudent(same(prior,priorObservation)&&observation?.planRef===request.planRef&&observation.planVersion===request.planVersion&&observation.status===c.status&&integer(observation.revision,1)&&hash(observation.closeoutSHA256),'plan_closeout_unverified','actual current and durable closeout observations required');
 if(prior)requireStudent(observation.revision>=prior.revision&&(observation.revision!==prior.revision||observation.closeoutSHA256===prior.closeoutSHA256),'plan_closeout_unverified','closeout rollback or same-revision replacement');
 if(!allowEstablished)requireStudent(c.status==='incomplete'&&!['completed','terminated'].includes(prior?.status)&&rows[0].status==='not_executed'&&list(rows[0].unresolved).length===0,'plan_closed','new finalization needs original available action and an unclosed plan');
 const dependencies=list(action.dependencyRefs),ps=list(prerequisites),required=['complete-formal-training','frozen-behavior-review','allowed-checkpoints','budget-scope'],kinds=new Set<string>();
 requireStudent(sameSet(dependencies,ps.map(p=>p.requirementRef)),'original_dependency_conflict','the selection action must retain every original dependency');
 for(const p of ps){fixedReference(p.requirementRef,'requirementRef');fixedReference(p.receiptRef,'receiptRef');requireStudent(same(p.requirement,host.resolveRef(p.requirementRef))&&digest(p.receipt)===p.receiptRef.split(':').at(-1)&&p.receipt.requirementRef===p.requirementRef&&p.receipt.planRef===request.planRef&&p.receipt.planVersion===request.planVersion&&p.receipt.decision==='met'&&p.requirement.stage===5&&[null,'formal'].includes(p.requirement.phase)&&!kinds.has(p.requirement.kind)&&p.requirement.kind!=='student-selection','prerequisites_missing','same-input, exact noncircular original prerequisite facts required');kinds.add(p.requirement.kind);requireStudent(list(p.receipt.evidence_refs).length>0,'prerequisites_missing','actual original evidence required');for(const f of p.receipt.evidence_refs)evidence(host,f);if(p.receipt.analysisRef!==null)evidence(host,p.receipt.analysisRef);}
 requireStudent(required.every(k=>list(rule.requiredKinds).includes(k)&&kinds.has(k))&&list(rule.requiredKinds).every(k=>kinds.has(k)),'prerequisites_missing','all original formal finalization kinds required');
 return facts;
}
function formalFacts(r:StudentFinalizationRequest,host:StudentFinalizationHost,task:any,summary:any,state:any){
 requireStudent(state.schemaVersion===1&&state.rootInstanceId===host.manifest.rootInstanceId&&state.tasks&&state.runs&&state.budgets&&state.batches,'state_history_conflict','original complete control ledger required');
 for(const [id,run] of Object.entries(state.runs) as any){requireStudent(run.runId===id&&state.tasks[run.task?.taskId]===id&&run.taskSHA256===digest(run.task)&&run.taskRef?.endsWith('@sha256:'+run.taskSHA256),'state_history_conflict','all original Task/run identities required');}
 for(const [id,runId] of Object.entries(state.tasks))requireStudent(state.runs[runId as string]?.task?.taskId===id,'state_history_conflict','missing attempt history is not zero');
 const run=state.runs[r.trainingRunId],ledger=state.budgets[task.budgetRef],batch=state.batches[task.researchBatchId];
 requireStudent(run&&run.taskRef===r.trainingTaskRef&&same(run.task,task)&&run.taskSHA256===digest(task)&&state.tasks[task.taskId]===r.trainingRunId,'state_history_conflict','exact original training Task/run required');
 requireStudent(digest(JSON.parse(regularBytes(local(host.repositoryRoot,relative(host.repositoryRoot,resolve(task.outputRoot,'task.json')))).toString()))===run.taskSHA256&&run.checkpointSequence===1,'checkpoint_identity_mismatch','original persisted TaskFile and update0 commit sequence required');
 requireStudent(run.status==='completed'&&run.cleanupConfirmed===true&&run.executionUnknown!==true&&run.observationStatus!=='unknown','execution_uncertain','completed reconciled formal run required');
 requireStudent(ledger&&batch&&batch.budgetRef===task.budgetRef&&[ledger,batch].every(x=>x.planRef===task.planRef&&x.authorizationRef===task.authorizationRef)&&ledger.researchBatchId===task.researchBatchId&&ledger.accountingMode==='research'&&Object.hasOwn(ledger,'activeRunId')&&ledger.activeRunId!==run.runId&&ledger.reservations&&Number.isFinite(ledger.elapsedSeconds)&&ledger.elapsedSeconds>=0,'budget_binding_conflict','original shared budget and released ownership required');
 const declaredBudget=host.resolveRef(task.budgetRef);requireStudent(declaredBudget.controlRoot===host.root&&declaredBudget.planRef===task.planRef&&declaredBudget.authorizationRef===task.authorizationRef&&same(declaredBudget.limits,ledger.limits),'budget_binding_conflict','original declared budget limits and root required');
 // J overlap is about this artifact/read scope, not an unrelated shared-budget
 // run's global status. Retained historical owner metadata is not an active lock.
 for(const other of Object.values(state.runs) as any[]){if(other.runId===run.runId)continue;const otherLedger=state.budgets[other.task.budgetRef],unknown=other.cleanupConfirmed!==true||other.executionUnknown===true||other.observationStatus==='unknown'||['preparing','running','stopping'].includes(other.status)||otherLedger?.activeRunId===other.runId||Object.values(otherLedger?.reservations??{}).some((x:any)=>x.runId===other.runId&&['reserved','reserved_unknown'].includes(x.status));if(!unknown)continue;requireStudent(typeof other.task.outputRoot==='string'&&isAbsolute(other.task.outputRoot),'execution_uncertain','unknown writer output scope');const otherOut=resolve(other.task.outputRoot),inside=(a:string,b:string)=>a===b||(!relative(a,b).startsWith('..')&&!isAbsolute(relative(a,b)));requireStudent(!inside(otherOut,task.outputRoot)&&!inside(task.outputRoot,otherOut),'execution_uncertain','active/unknown writer intersects student output');}
 validateLimits(ledger.limits);validateCost(ledger.used);const totals={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0},owned:string[]=[];
 for(const [id,x] of Object.entries(ledger.reservations) as any){validateCost(x.cost);requireStudent(state.runs[x.runId]&&['reserved','reserved_unknown','committed','consumed','released'].includes(x.status),'state_history_conflict','known reservation status and original run required');if(x.runId===run.runId)requireStudent(!['reserved','reserved_unknown'].includes(x.status),'execution_uncertain','original training occupancy must reconcile first');if(['committed','consumed'].includes(x.status))for(const key of Object.keys(totals))totals[key as keyof typeof totals]+=x.cost[key];if(x.runId===run.runId&&x.status!=='released'){requireStudent(x.status==='committed'&&same(x.cost,{providerRequests:0,optimizerSteps:1,matchAttempts:0,labelDecisions:0})&&hash(x.checkpointSHA256),'checkpoint_identity_mismatch','training consumption must bind each committed update');owned.push(id);}}
 requireStudent(same(totals,ledger.used)&&sameSet(list(run.committed),owned),'state_history_conflict','full consumption and committed update list disagree');
 const bindings=list(host.manifest.inputBindings).filter(x=>x.taskRef===r.trainingTaskRef);requireStudent(bindings.length===1&&bindings[0].trainingPhase==='formal'&&integer(bindings[0].seed),'input_identity_unverified','original formal input binding required');const binding=bindings[0];
 const data=host.resolveRef(task.datasetRefs[0]),manifestPath=local(host.repositoryRoot,binding.datasetDirectory+'/manifest.json'),manifestBytes=regularBytes(manifestPath);
 requireStudent(data.schema==='ohuo-frozen-dataset-ref-v1'&&sha(manifestBytes)===data.manifestSHA256,'input_identity_unverified','original frozen dataset manifest required');const manifest=JSON.parse(manifestBytes.toString()),Ndemo=manifest.qualification?.Ndemo,Uepoch=Math.ceil(Ndemo/32),total=3*Uepoch;
 requireStudent(integer(Ndemo,1)&&integer(total,1)&&run.committed.length===total,'incomplete_formal','exact three complete epochs required');
 const parentEnvelope=host.resolveRef(task.parentPolicyRef);strictObject(parentEnvelope,'parentPolicy',['schema','policyRef','policyIdentity']);
 requireStudent(parentEnvelope.schema==='ohuo-parent-policy-ref-v1'&&parentEnvelope.policyRef===r.parentPolicyRef&&same(parentEnvelope.policyIdentity,manifest.plan?.identities?.basePolicy),'input_identity_unverified','Node selector must match original parent envelope/dataset');
 const ids=manifest.plan.identities,frozenRefs={dataset:task.datasetRefs[0],manifestSHA256:data.manifestSHA256,teacher:task.labelPolicyRef,B:task.parentPolicyRef,parentIdentity:parentEnvelope.policyIdentity,encoder:ids.encoderVersion,candidate:ids.candidateSpecRef,prompt:task.promptRef,recipe:task.learnerRecipe,sourceRevision:task.sourceRevision,runtimeRef:task.runtimeRef,phase:'formal',seed:binding.seed};
 requireStudent(same(host.resolveRef(task.labelPolicyRef),ids.teacher)&&host.resolveRef(task.promptRef).promptRef===ids.promptRef,'input_identity_unverified','original teacher/prompt identity required');
 requireStudent(summary.schema==='ohuo-supervised-summary-v1'&&summary.trainingKind==='supervised_rerank'&&summary.runId===run.runId&&summary.taskSHA256===digest(task)&&same(summary.frozenRefs,frozenRefs)&&same(summary.plan,{recipe:task.learnerRecipe,phase:'formal',Uepoch,maxEpochs:3,maxOptimizerSteps:total,effectiveBatch:64})&&summary.actual?.realTraining===true&&summary.actual.optimizerSteps===total&&summary.actual.providerRequests===0,'incomplete_formal','summary must bind the complete original formal run');
 const allowed=list(summary.selection?.allowedCheckpoints);requireStudent(allowed.length===4&&allowed.every((m,i)=>m.checkpoint?.optimizerSteps===i*Uepoch),'checkpoint_identity_mismatch','only update 0 and all three epoch ends allowed');
 const first={schema:'ohuo-supervised-run-v1',taskSHA256:digest(task),datasetSHA256:data.manifestSHA256,optimizerSteps:0,studentCheckpoint:allowed[0].checkpoint,milestones:[allowed[0]]};
 const expectedDigests=[digest(first),...run.committed.map((id:string)=>ledger.reservations[id].checkpointSHA256)],exposureCounts={demo:new Map<string,number>(),keep:new Map<string,number>()},epochIds=new Set<string>();let previous:any=null,finalFacts:any;
 for(let n=0;n<=total;n++){
  const cpSHA=expectedDigests[n],path=local(host.repositoryRoot,relative(host.repositoryRoot,resolve(task.outputRoot,'checkpoint-'+cpSHA+'.json'))),cp=JSON.parse(regularBytes(path).toString());
  requireStudent(digest(cp)===cpSHA&&cp.schema==='ohuo-supervised-run-v1'&&cp.taskSHA256===digest(task)&&cp.datasetSHA256===data.manifestSHA256&&cp.optimizerSteps===n,'checkpoint_identity_mismatch','complete same-task committed update chain required');
  const pointer=cp.studentCheckpoint;strictObject(pointer,'checkpointPointer',['schema','path','optimizerSteps','manifestSHA256']);requireStudent(pointer.schema==='ohuo-supervised-pointer-v1'&&pointer.optimizerSteps===n&&hash(pointer.manifestSHA256)&&/^checkpoints\/[^/.][^/]*$/.test(pointer.path)&&!pointer.path.endsWith('.tmp'),'checkpoint_identity_mismatch','fixed committed student pointer required');
  const cpPath=local(host.repositoryRoot,relative(host.repositoryRoot,resolve(task.outputRoot,pointer.path,'manifest.json'))),bytes=regularBytes(cpPath),cm=JSON.parse(bytes.toString());requireStudent(sha(bytes)===pointer.manifestSHA256&&cm.schema==='ohuo-supervised-commit-v1'&&cm.optimizerSteps===n&&sameSet(Object.keys(cm.files),['learner.pt','weights.f32','state.json'])&&Object.values(cm.files).every(hash),'checkpoint_identity_mismatch','checkpoint manifest identity differs');
  const factsBytes=regularBytes(local(host.repositoryRoot,relative(host.repositoryRoot,resolve(dirname(cpPath),'state.json')))),facts=JSON.parse(factsBytes.toString());
  requireStudent(sha(factsBytes)===cm.files['state.json']&&facts.schema==='ohuo-supervised-checkpoint-v1'&&facts.trainingKind==='supervised_rerank'&&facts.optimizerSteps===n&&facts.completedEpochs===Math.floor(n/Uepoch)&&same(facts.frozenRefs,frozenRefs)&&same(facts.recipe,task.learnerRecipe)&&facts.weightsSHA256===cm.files['weights.f32'],'checkpoint_identity_mismatch','original checkpoint facts/frozen identities differ');
  const milestones=allowed.slice(0,1+Math.floor(n/Uepoch));requireStudent(same(cp.milestones,milestones)&&same(facts.facts?.metrics,milestones.map(m=>m.metrics))&&milestones.every((m,i)=>m.metrics?.optimizerSteps===i*Uepoch&&m.metrics.completedEpochs===i),'checkpoint_identity_mismatch','committed metrics cannot insert or rewrite selection history');
  if(n%Uepoch===0)requireStudent(same(pointer,allowed[n/Uepoch].checkpoint),'checkpoint_identity_mismatch','epoch pointer not in committed chain');
  if(previous)requireStudent(same(cp.milestones.slice(0,previous.milestones.length),previous.milestones),'checkpoint_identity_mismatch','committed selection history changed');
  if(n){const step=facts.facts.step,expectedCount=(n%Uepoch===0?Ndemo-(Uepoch-1)*32:32);requireStudent(step&&same(step,cp.lastStep)&&step.optimizerSteps===n&&step.epochEnded===(n%Uepoch===0)&&step.completedEpochs===Math.floor(n/Uepoch),'checkpoint_identity_mismatch','original committed step facts required');
   for(const kind of ['demo','keep'] as const){const chosen=list(step[kind+'Ids']);requireStudent(chosen.length===expectedCount&&chosen.every(x=>typeof x==='string'&&x.length>0),'exposure_identity_mismatch','exact committed sample exposure required');for(const id of chosen){if(kind==='demo'){requireStudent(!epochIds.has(id),'exposure_identity_mismatch','demo cannot repeat within an epoch');epochIds.add(id);}exposureCounts[kind].set(id,(exposureCounts[kind].get(id)??0)+1);}}
   if(n%Uepoch===0){requireStudent(epochIds.size===Ndemo,'exposure_identity_mismatch','complete without-replacement epoch required');epochIds.clear();}
  }
  const exposure=Object.fromEntries((['demo','keep'] as const).map(kind=>{const values=[...exposureCounts[kind].values()],total=values.reduce((a,b)=>a+b,0);return [kind,{unique:values.length,total,repeats:total-values.length}];}));
  requireStudent(same(facts.exposure,exposure),'exposure_identity_mismatch','all original exposure facts must reconcile');previous=cp;finalFacts=facts;
 }
 requireStudent(exposureCounts.demo.size===Ndemo&&[...exposureCounts.demo.values()].every(n=>n===3),'exposure_identity_mismatch','same frozen demo set must be seen exactly once in each of three epochs');
 requireStudent(same(run.checkpoint,previous)&&run.checkpointSHA256===expectedDigests.at(-1)&&run.checkpointRef===resolve(task.outputRoot,'checkpoint-'+run.checkpointSHA256+'.json')&&same(summary.actual.latestCompleteCheckpoint,previous.studentCheckpoint)&&same(summary.actual.lastCommittedStep,previous.lastStep)&&same(summary.actual.exposure,finalFacts.exposure)&&same(summary.metrics,finalFacts.facts.metrics),'checkpoint_identity_mismatch','summary/latest committed boundary disagreement');
 const summaryPath=evidencePath(host,r.summaryRef);requireStudent(summaryPath===resolve(task.outputRoot,'summary.json')&&list(run.consumerArtifactRefs).some(a=>a.path===summaryPath&&a.sha256===r.summaryRef.sha256),'input_identity_unverified','summary must be the actual completed consumer artifact');
 return {allowed,parentEnvelope};
}
function selectionIssues(selection:any,allowed:any[],reviews:any[]){
 if(selection.status==='selected')return [];
 // Reuse the original mathematical gate to name unresolved viable checkpoints;
 // eliminated checkpoints never acquire a new human-review requirement.
 return [selection.reason,...(selection.status==='pending_behavior_review'?allowed.slice(1).filter(m=>selectDistillCheckpoint([allowed[0],m],reviews).status==='pending_behavior_review').map(m=>'behavior_review_pending:'+m.checkpoint.manifestSHA256):[])];
}
function saveCompletionReceipt(directory:string,path:string,receipt:StudentFinalizationReceipt){mkdirSync(directory,{recursive:true,mode:0o700});requireStudent(realpathSync(directory)===directory,'artifact_conflict','receipt directory must be real');writeNewOrVerifyIdentical(path,canonical(receipt)+'\n');}
function behaviorReview(host:StudentFinalizationHost,ref:StudentFileRef,taskSHA256:string,allowed:any[]){
 const review=JSON.parse(evidence(host,ref).toString());
  strictObject(review,'behaviorReview',['schema','taskSHA256','reviews']);requireStudent(review.schema==='ohuo-distill-behavior-review-v1'&&review.taskSHA256===taskSHA256,'behavior_review_invalid','same-task original behavior review required');const seen=new Set();
  for(const row of list(review.reviews)){strictObject(row,'behaviorReviewRow',['checkpointSHA256','status','evidence']);requireStudent(hash(row.checkpointSHA256)&&!seen.has(row.checkpointSHA256)&&allowed.some(m=>m.checkpoint.manifestSHA256===row.checkpointSHA256)&&['accepted','rejected','pending'].includes(row.status),'behavior_review_invalid','duplicate/unknown checkpoint or review status');seen.add(row.checkpointSHA256);const bytes=evidence(host,row.evidence);requireStudent(bytes.toString('utf8').trim().length>0,'behavior_review_invalid','actual nonempty review evidence required; semantic review remains human');}
 return review;
}
export async function finalizeStudentFromHost(specRef:string,host:StudentFinalizationHost):Promise<StudentFinalizationReceipt>{
 fixedReference(specRef,'requestRef');const request=requestShape(host.resolveRef(specRef));requireStudent(digest(request)===specRef.split(':').at(-1),'reference_identity_mismatch','fixed request identity differs');
 const task=validateTask(host.resolveRef(request.trainingTaskRef));requireStudent(digest(task)===request.trainingTaskRef.split(':').at(-1)&&task.taskKind==='supervised_training'&&task.planRef===request.planRef&&task.planVersion===request.planVersion&&task.runId===request.trainingRunId&&task.datasetRefs.length===1,'input_identity_unverified','exact original training Task required');
 const root=realpathSync(host.repositoryRoot),out=realpathSync(task.outputRoot);requireStudent(root===host.repositoryRoot&&out===task.outputRoot&&out===resolve(host.root,'runs',task.runId)&&relative(root,out).startsWith('lab/out/'),'invalid_output_root','same original task output directory below lab/out required');
 requireStudent(request.outputPath===relative(root,resolve(out,'student-release.json')),'invalid_output_root','fixed original student-release.json destination required');
 const releaseState=acquireSourceWriter(resolve(host.root,'state.json'));let releaseOutput:(()=>void)|undefined;
 try{
  releaseOutput=acquireSourceWriter(out);const historical=await host.readStudentFinalizationTraining(task);requireStudent(historical.grantEntry?.taskRef===request.trainingTaskRef&&historical.inputBinding?.taskRef===request.trainingTaskRef&&historical.inputBinding.trainingPhase==='formal'&&historical.action?.clauseRef===task.planScope.clauseRef&&historical.action.branchRef===task.planScope.branchRef&&sameSet(list(historical.action.dependencyRefs),task.planScope.prerequisiteRefs)&&sameSet(list(historical.grantEntry.prerequisiteReceipts).map(p=>p.requirementRef),task.planScope.prerequisiteRefs),'authorization_unverified','original historical training grant/action/dependency binding required');// Check the original non-runner authority/dependencies before reading full training history.
  host.readNonrunnerAction(request,'student-finalization');const entries=catalog(host),peers=entries.filter(x=>x.value?.schema==='ohuo-student-finalization-request-v1'&&x.value.trainingRunId===request.trainingRunId);
  for(const p of peers){const q=requestShape(p.value);requireStudent(q.trainingTaskRef===request.trainingTaskRef&&q.planRef===request.planRef&&q.planVersion===request.planVersion&&q.clauseRef===request.clauseRef&&q.branchRef===request.branchRef&&q.policyId===request.policyId&&q.outputPath===request.outputPath&&q.parentPolicyRef===request.parentPolicyRef&&same(q.summaryRef,request.summaryRef),'artifact_conflict','same run cannot be rebound to another selection identity');}
  const receiptDirectory=resolve(out,'student-finalization'),receiptPath=resolve(receiptDirectory,specRef.split(':').at(-1)+'.json'),saved=new Map<string,StudentFinalizationReceipt>();
  const remember=(bytes:Buffer,name?:string)=>{const old=receiptShape(JSON.parse(bytes.toString()));requireStudent(bytes.toString()===canonical(old)+'\n','artifact_conflict','completion receipt bytes differ from original encoding');requireStudent(old.trainingRunId===request.trainingRunId&&old.trainingTaskRef===request.trainingTaskRef&&(!name||name===old.requestRef.split(':').at(-1)+'.json'),'artifact_conflict','receipt/request/run binding differs');
   const oldRequest=requestShape(host.resolveRef(old.requestRef));requireStudent(digest(oldRequest)===old.requestRef.split(':').at(-1)&&same(oldRequest.summaryRef,old.summaryRef)&&same(oldRequest.reviewRef,old.reviewRef)&&oldRequest.trainingRunId===request.trainingRunId&&oldRequest.trainingTaskRef===request.trainingTaskRef&&oldRequest.planRef===request.planRef&&oldRequest.planVersion===request.planVersion&&oldRequest.clauseRef===request.clauseRef&&oldRequest.branchRef===request.branchRef&&oldRequest.policyId===request.policyId&&oldRequest.outputPath===request.outputPath,'artifact_conflict','prior request identity differs');const previous=saved.get(old.requestRef);requireStudent(!previous||same(previous,old),'artifact_conflict','completion copies disagree');saved.set(old.requestRef,old);
  };
  if(existsSync(receiptDirectory)){requireStudent(realpathSync(receiptDirectory)===receiptDirectory&&lstatSync(receiptDirectory).isDirectory(),'artifact_conflict','receipt directory must be real');for(const name of readdirSync(receiptDirectory)){requireStudent(/^[a-f0-9]{64}\.json$/.test(name),'artifact_conflict','unexpected completion artifact');remember(regularBytes(resolve(receiptDirectory,name)),name);}}
  // A transferred original receipt may be absent at its output path but remain
  // as an exact F in the fixed host's JSON evidence catalog. Re-read the bytes,
  // never infer completion from a filename/hash mapping or the two S artifacts.
  for(const row of list(host.manifest.evidenceFiles)){if(!row.file?.path?.endsWith('.json'))continue;const f={id:row.id,sha256:row.file.sha256},bytes=Buffer.from(host.evidenceBytes(f));requireStudent(sha(bytes)===f.sha256,'reference_identity_mismatch','registered JSON evidence bytes changed');let value:any;try{value=JSON.parse(bytes.toString());}catch{continue;}if(value?.schema==='ohuo-student-finalization-receipt-v1'&&value.trainingRunId===request.trainingRunId)remember(bytes);}
  const history=[...saved.values()],existing=saved.get(specRef)??null,terminals=history.filter(r=>r.status!=='pending_behavior_review');
  requireStudent(terminals.length<=1&&(existing!==null||terminals.length===0),'artifact_conflict','terminal selection cannot be reopened');
  const state=host.checkExistingRoot(),summary=JSON.parse(evidence(host,request.summaryRef).toString()),review=JSON.parse(evidence(host,request.reviewRef).toString());
  const {allowed}=formalFacts(request,host,task,summary,state);
  behaviorReview(host,request.reviewRef,summary.taskSHA256,allowed);
  for(const old of history){const historical=selectDistillCheckpoint(allowed,behaviorReview(host,old.reviewRef,summary.taskSHA256,allowed).reviews);requireStudent(old.status===historical.status&&same(old.issues,selectionIssues(historical,allowed,behaviorReview(host,old.reviewRef,summary.taskSHA256,allowed).reviews)),'artifact_conflict','saved completion status/issue cannot rewrite original request outcome');}
  authority(request,host,task,existing!==null);
  const observed=state.hostPlanObservations?.[canonical([request.planRef,request.planVersion])];requireStudent(existing!==null||!['completed','terminated'].includes(observed?.status),'plan_closed','durably closed plan cannot select');
  const selected=selectDistillCheckpoint(allowed,review.reviews),target=resolve(root,request.outputPath),selectionPath=target+'.selection.json';
  if(existing){requireStudent(existing.status===selected.status&&same(existing.summaryRef,request.summaryRef)&&same(existing.reviewRef,request.reviewRef),'artifact_conflict','saved receipt differs from exact fixed selection');if(existing.status!=='selected'){saveCompletionReceipt(receiptDirectory,receiptPath,existing);return existing;}
   // Rebuild deterministic bytes through the original parent-identity read path,
   // but do not call finalize again or write anything for an intact receipt.
   const prepared=await prepareStudentCandidate({summaryPath:evidencePath(host,request.summaryRef),summarySHA256:request.summaryRef.sha256,reviewPath:evidencePath(host,request.reviewRef),reviewSHA256:request.reviewRef.sha256,parentPolicyRef:request.parentPolicyRef,policyId:request.policyId,outputPath:target,repositoryRoot:root,inputRefs:{summary:request.summaryRef,review:request.reviewRef}});
   requireStudent(prepared.release&&existing.selectionRef!.id===request.policyId+'-dev-selection'&&existing.releaseRef!.id===request.outputPath&&existing.releaseRef!.sha256===prepared.release.sha256&&existing.selectionRef!.sha256===sha(Buffer.from(prepared.artifacts![0].bytes)),'artifact_conflict','saved receipt must bind original deterministic selection/release bytes');
   for(const a of prepared.artifacts!)verifyIdenticalIfPresent(a.path,a.bytes);
   if(prepared.artifacts!.every(a=>existsSync(a.path))){authority(request,host,task,true);saveCompletionReceipt(receiptDirectory,receiptPath,existing);return existing;}
  }
  let result:any={selection:selected,release:null};
  if(selected.status==='selected')result=await finalizeStudentCandidate({summaryPath:evidencePath(host,request.summaryRef),summarySHA256:request.summaryRef.sha256,reviewPath:evidencePath(host,request.reviewRef),reviewSHA256:request.reviewRef.sha256,parentPolicyRef:request.parentPolicyRef,policyId:request.policyId,outputPath:target,repositoryRoot:root,inputRefs:{summary:request.summaryRef,review:request.reviewRef},verifyBeforeWrite:artifacts=>{authority(request,host,task,existing!==null);requireStudent(same(host.checkExistingRoot(),state),'state_history_conflict','original state changed during finalization');if(existing)for(const a of artifacts){const f=a.path===target?existing.releaseRef!:existing.selectionRef!;requireStudent(sha(Buffer.from(a.bytes))===f.sha256,'artifact_conflict','repair must reconstruct previously completed bytes');}}});
  else requireStudent(!existsSync(target)&&!existsSync(selectionPath),'artifact_conflict','nonselected request cannot ignore partial selected artifacts');
  const receipt:StudentFinalizationReceipt={schema:'ohuo-student-finalization-receipt-v1',requestRef:specRef,trainingTaskRef:request.trainingTaskRef,trainingRunId:request.trainingRunId,summaryRef:request.summaryRef,reviewRef:request.reviewRef,status:result.selection.status,selectionRef:result.release?{id:request.policyId+'-dev-selection',sha256:sha(regularBytes(selectionPath))}:null,releaseRef:result.release?{id:request.outputPath,sha256:result.release.sha256}:null,issues:selectionIssues(result.selection,allowed,review.reviews)};
  if(existing)requireStudent(same(receipt,existing),'artifact_conflict','reconstructed receipt differs');authority(request,host,task,existing!==null);
  saveCompletionReceipt(receiptDirectory,receiptPath,receipt);return receipt;
 }finally{releaseOutput?.();releaseState();}
}
