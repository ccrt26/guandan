import {isFirstRoundRecipe,isFirstRoundR2Recipe,FIRST_ROUND_RECIPE,FIRST_ROUND_R2_RECIPE,firstRoundTrainingShape,decideFirstRoundR2Learning,FIRST_ROUND_R2_STOPPING_RULE} from './first-round-contract.mjs';
import {validateFirstRoundParentEnvelope,resolveFirstRoundParent,validateFirstRoundDatasetMetadata} from './first-round-parent';
import {resolveCandidateReleaseRef} from '../../packages/ai/src/policy/candidate-release';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {resolveCandidatePolicy} from '../../packages/ai/src/candidate-spec';
/** Explicit M7 consumer on the existing host. No second runner or authorization. */
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync,renameSync,realpathSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {loadFrozenDataset} from './distill-data';
import {resolveNodePolicy,POLICY_REPOSITORY_ROOT} from './policy-loader';
import {createTaskController} from './task-control.mjs';
import {digest,fixedReference,strictObject,validateIdentifier} from './task-schema.mjs';
import type {VerifiedNumericalRecovery} from './numerical-recovery';
import {buildPythonEnvironment} from './python-environment';
export const DISTILL_RECIPE=Object.freeze({recipeId:'supervised-rerank-v1',optimizer:'RMSprop',alpha:.9,eps:1e-5,momentum:0,centered:false,weightDecay:0,learningRate:1e-4,temperature:1,keepWeight:1,demoBatch:32,keepBatch:32,maxEpochs:3,initialization:'fixed-parent-new-optimizer'});
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const json=(v:any)=>JSON.parse(JSON.stringify(v));
const scope={localExecution:true,apiCalls:false,parameterUpdates:true,deployment:false};
const SCRIPT=fileURLToPath(new URL('./distill_learner.py',import.meta.url));
interface Options {pythonPath:string;policyRepositoryRoot?:string;mode?:'research'|'offline_synthetic';physicalDecisions?:number}
interface Checkpoint {schema:'ohuo-supervised-run-v1';taskSHA256:string;datasetSHA256:string;optimizerSteps:number;studentCheckpoint:any;milestones:Array<{checkpoint:any;metrics:any}>;lastStep?:any}
const stopped=(signal:AbortSignal)=>Object.assign(new Error(String(signal.reason??'run_boundary')),{name:'AbortError',reason:signal.reason==='lost_ownership'?'lost_ownership':'run_boundary'});
class OwnedPython {
 child:ChildProcessWithoutNullStreams;queue:any[]=[];waiters:Array<{resolve:(v:any)=>void;reject:(e:Error)=>void}>=[];ended=false;failure:Error|null=null;exit:Promise<number|null>;stderr='';closing:Promise<boolean>|null=null;
 constructor(python:string,readonly signal:AbortSignal){
  this.child=spawn(python,['-u',SCRIPT],{cwd:dirname(SCRIPT),env:buildPythonEnvironment(),stdio:['pipe','pipe','pipe']});
  this.child.stderr.on('data',b=>{this.stderr=(this.stderr+String(b)).slice(-8000);});
  createInterface({input:this.child.stdout}).on('line',line=>{if(this.failure||this.ended)return;try{const value=JSON.parse(line),waiter=this.waiters.shift();if(waiter)waiter.resolve(value);else if(!this.queue.length)this.queue.push(value);else this.fail(Error('unexpected learner response'));}catch{this.fail(Error('invalid learner response'));}});
  this.child.on('error',e=>this.fail(e));
  this.child.stdin.on('error',e=>this.fail(e));
  this.exit=new Promise(r=>this.child.once('close',code=>{this.ended=true;if(code!==0)this.fail(Error('learner exit '+code+': '+this.stderr));else if(this.waiters.length)this.fail(Error('learner closed before reply'));r(code);}));
 }
 fail(error:Error){this.failure??=error;this.queue.length=0;for(const w of this.waiters.splice(0))w.reject(this.failure);}
 next():Promise<any>{
  if(this.signal.aborted)this.fail(stopped(this.signal));
  if(this.failure)return Promise.reject(this.failure);if(this.ended)return Promise.reject(Error('learner exited'));
  if(this.waiters.length)return Promise.reject(Error('learner request already pending'));
  if(this.queue.length)return Promise.resolve(this.queue.shift());
  return new Promise((resolve,reject)=>{
   const onAbort=()=>this.fail(stopped(this.signal));
   const finish=()=>this.signal.removeEventListener('abort',onAbort);
   this.waiters.push({resolve:value=>{finish();resolve(value);},reject:error=>{finish();reject(error);}});
   this.signal.addEventListener('abort',onAbort,{once:true});
   if(this.signal.aborted)onAbort();
  });
 }
 async request(command:any){
  if(this.signal.aborted)this.fail(stopped(this.signal));
  if(this.ended||this.failure)throw this.failure??Error('learner exited');
  // A response belongs to exactly one command. Never send a second command
  // while an earlier waiter/unsolicited response could consume its reply.
  if(this.waiters.length||this.queue.length)throw Error('learner request already pending');
  const reply=this.next();
  try{this.child.stdin.write(JSON.stringify(command)+'\n',error=>{if(error)this.fail(error);});}catch(error){this.fail(error as Error);}
  const value=await reply;if(value.kind==='error')throw Error(value.reason);return value;
 }
 close(){return this.closing??=this.finishClose();}
 private async finishClose(){
  // Timer begins before waiting for close reply: an unresponsive child cannot
  // strand ownership. Signals target only the process created by this instance.
  const term=setTimeout(()=>{if(!this.ended)this.child.kill('SIGTERM');},5000);
  const kill=setTimeout(()=>{if(!this.ended)this.child.kill('SIGKILL');},7000);
  try{
   if(this.signal.aborted)this.fail(stopped(this.signal));
   if(this.waiters.length)this.fail(Error('learner closed with pending request'));
   // A cancelled/failed FIFO is unusable: do not send close behind an unknown
   // reply. Signal only this owned handle, then confirm the real close event.
   if(!this.ended){if(this.failure)this.child.kill('SIGTERM');else try{await this.request({kind:'close'});}catch{if(!this.ended)this.child.kill('SIGTERM');}}
   this.child.stdin.end();await this.exit;return this.ended;
  }
  finally{clearTimeout(term);clearTimeout(kill);}
 }
}
/** New recipe runtime facts come from the already-owned learner handshake,
 * not an extra unmetered preflight Python/Torch process. Null NumPy is an
 * explicit frozen absence, never a wildcard or an installation request. */
export function verifyFirstRoundPythonRuntime(expected:any,ready:any,pythonPath:string){
 strictObject(expected,'firstRoundPythonRuntime',['executablePath','executableSHA256','version','numpyVersion','torchVersion']);
 if(expected.executablePath!==pythonPath||ready?.kind!=='ready'||ready.python!==pythonPath||ready.version!==expected.version||ready.numpyVersion!==expected.numpyVersion||ready.torchVersion!==expected.torchVersion||ready.torch!==expected.torchVersion)throw Error('first-round actual Python runtime mismatch');
}
export function createDistillConsumer({pythonPath,policyRepositoryRoot=POLICY_REPOSITORY_ROOT,mode='research',physicalDecisions=32}:Options){
 if(!['research','offline_synthetic'].includes(mode)||!Number.isSafeInteger(physicalDecisions)||physicalDecisions<1||physicalDecisions>32)throw Error('fixed distill host configuration');
 // Preserve the explicit venv launcher path: dereferencing its symlink would
 // silently run the base interpreter without the requested environment.
 const python=resolve(pythonPath),repo=realpathSync(policyRepositoryRoot);realpathSync(python);
 const prepare=async({task,refs,inputs}:any)=>{
  const firstRound=isFirstRoundRecipe(task.learnerRecipe);
  if(task.taskKind!=='supervised_training'||!same(task.operationScope,scope)||task.datasetRefs.length!==1||task.outputSpec.trainingKind!=='supervised_rerank'||(!firstRound&&task.outputSpec.proposalPolicyRef!==task.parentPolicyRef)||(firstRound&&task.outputSpec.proposalPolicyRef===task.parentPolicyRef))throw Error('supervised task/scope contract');
  // Only trusted host verifyInputs supplies these summaries. Validate phase and
  // exact current-task bindings before reading dataset/policy assets; neither a
  // Task flag nor a numericalRecoveryContext can grant consumer admission.
  const phase=mode==='offline_synthetic'?(inputs.trainingPhase??'formal'):inputs.trainingPhase;
  if(!['calibration','formal'].includes(phase))throw Error('fixed training phase required');
  const seed=inputs.seed;if(!Number.isSafeInteger(seed)||seed<0)throw Error('fixed sampling seed required');
  let restartRef:{id:string;sha256:string}|null=null;const recipe:any={...(isFirstRoundR2Recipe(task.learnerRecipe)?FIRST_ROUND_R2_RECIPE:firstRound?FIRST_ROUND_RECIPE:DISTILL_RECIPE)};
  if(task.learnerRecipe.learningRate===3e-5){
   if(!task.parentTaskId||!task.retryReasonRef||!task.planScope.branchRef||task.allowedBranches.length!==1||task.allowedBranches[0].evidenceRef!==task.retryReasonRef)throw Error('verified single numerical restart branch required');
   const n=inputs.numericalRestart;
   if(n?.schema==='ohuo-verified-numerical-recovery-v1'){
    strictObject(n,'numericalRestart',['schema','verified','specRef','receiptRef','case','role','failedTaskId','parentTaskId','taskRef','datasetRef','parentPolicyRef','seed','restartFrom','branchUsesBefore']);
    const recovery:VerifiedNumericalRecovery=n;
    for(const key of ['specRef','receiptRef','taskRef','datasetRef','parentPolicyRef'] as const)fixedReference(recovery[key],`numericalRestart.${key}`);
    validateIdentifier(recovery.failedTaskId,'numericalRestart.failedTaskId');
    const roleMatches=recovery.case==='failed_calibration'?(recovery.role==='calibration_recovery'&&phase==='calibration'||recovery.role==='formal_continuation'&&phase==='formal'):recovery.case==='failed_formal'&&recovery.role==='formal_recovery'&&phase==='formal';
    if(recovery.verified!==true||!roleMatches||recovery.restartFrom!=='fixed-parent'||![0,1].includes(recovery.branchUsesBefore)||!recovery.taskRef.endsWith('@sha256:'+digest(task))||recovery.receiptRef!==task.retryReasonRef||recovery.parentTaskId!==task.parentTaskId||recovery.failedTaskId===task.taskId||recovery.datasetRef!==task.datasetRefs[0]||recovery.parentPolicyRef!==task.parentPolicyRef||recovery.seed!==seed||(recovery.role==='formal_continuation'?recovery.failedTaskId===recovery.parentTaskId:recovery.failedTaskId!==recovery.parentTaskId))throw Error('numerical recovery role/task binding not independently verified');
   }else{
    // The original v1 result has no schema. Do not reinterpret unknown/new
    // schema objects as legacy, or apply its usesBefore=0 rule to v2 resumes.
    if(n&&Object.hasOwn(n,'schema'))throw Error('unsupported numerical restart schema');
    if(n?.verified!==true||n?.usesBefore!==0||n?.restartFrom!=='fixed-parent'||n?.evidenceRef!==task.retryReasonRef||n?.failedTaskId!==task.parentTaskId||n?.datasetRef!==task.datasetRefs[0]||n?.parentPolicyRef!==task.parentPolicyRef||n?.seed!==seed)throw Error('single restart use not independently verified');
   }
   recipe.learningRate=3e-5;restartRef={id:task.retryReasonRef,sha256:task.retryReasonRef.split(':').at(-1)};
  }
  if(!same(recipe,task.learnerRecipe))throw Error('unsupported supervised recipe');
  if(mode==='research'&&phase==='formal'){
   const q=inputs.calibrationQualification;
   strictObject(q,'calibrationQualification',['verified','taskRef','datasetRef','parentPolicyRef','seed','recipe']);
   fixedReference(q.taskRef,'calibrationQualification.taskRef');
   if(q.verified!==true||!q.taskRef.endsWith('@sha256:'+digest(task))||q.datasetRef!==task.datasetRefs[0]||q.parentPolicyRef!==task.parentPolicyRef||q.seed!==seed||!same(q.recipe,task.learnerRecipe)||inputs.numericalRestart?.schema==='ohuo-verified-numerical-recovery-v1'&&q.taskRef!==inputs.numericalRestart.taskRef)throw Error('formal calibration qualification not independently verified');
  }
  const datasetRef=refs.get(task.datasetRefs[0]);if(datasetRef?.schema!=='ohuo-frozen-dataset-ref-v1')throw Error('fixed dataset reference required');
  const dataset={directory:inputs.datasetDirectory,manifestSHA256:datasetRef.manifestSHA256};
  if(firstRound){
   const runtime=refs.get(task.runtimeRef)?.python;strictObject(runtime,'firstRoundPythonRuntime',['executablePath','executableSHA256','version','numpyVersion','torchVersion']);
   if(runtime.executablePath!==python||!/^[a-f0-9]{64}$/.test(runtime.executableSHA256)||typeof runtime.version!=='string'||!runtime.version||typeof runtime.torchVersion!=='string'||!runtime.torchVersion||runtime.numpyVersion!==null&&(typeof runtime.numpyVersion!=='string'||!runtime.numpyVersion))throw Error('first-round frozen Python runtime metadata required');
   // Hash the small manifest and evidence now, but neither samples nor model
   // weights are loaded before the existing controller owns/times this run.
   const bytes=readFileSync(join(dataset.directory,'manifest.json'));if(sha(bytes)!==dataset.manifestSHA256)throw Error('frozen dataset manifest SHA mismatch');
   const manifest=JSON.parse(bytes.toString()),identities=validateFirstRoundDatasetMetadata(manifest,mode),envelope=refs.get(task.parentPolicyRef);
   if(typeof inputs.readFirstRoundEvidence!=='function')throw Error('fixed migration evidence reader required');
   const migrationBytes=Buffer.from(inputs.readFirstRoundEvidence(envelope?.migrationReceiptRef)),parent=validateFirstRoundParentEnvelope({parentRef:task.parentPolicyRef,envelope,readEvidence:()=>migrationBytes});
   const proposal=resolveCandidateReleaseRef(refs.get(task.outputSpec.proposalPolicyRef),ref=>refs.get(ref),RELEASES);
   if(!proposal.candidatePolicy||!same(json(proposal.policyIdentity),identities.basePolicy)||!same(parent.basePolicyIdentity,identities.basePolicy)||!same(parent.parentIdentity,identities.studentScorer)||identities.studentParentRef!==task.parentPolicyRef||!same(parent.migrationReceiptRef,identities.migrationReceiptRef)||!same(json(proposal.candidatePolicy),identities.candidatePolicy))throw Error('first-round frozen proposal/learning parent mismatch');
   if(!same(refs.get(task.labelPolicyRef),identities.teacher)||refs.get(task.promptRef)?.promptRef!==identities.promptRef)throw Error('frozen teacher/prompt mismatch');
   if(mode==='research'&&task.sourcePlan.split!=='train')throw Error('only training source split may learn');
   const indexBytes=readFileSync(inputs.sourceIndexPath),sourceRef=refs.get(task.sourcePlan.sourceIndexRef);
   if(sourceRef?.fileSHA256!==sha(indexBytes)||manifest.plan.sourceIndexSHA256!==sha(indexBytes)||mode==='research'&&manifest.plan.sourceIndexRef!==task.sourcePlan.sourceIndexRef)throw Error('frozen source bytes/reference mismatch');
   if(!same(manifest.plan.families.filter((f:any)=>f.split==='train').map((f:any)=>f.sourceFamily).sort(),[...task.sourcePlan.familyIds].sort()))throw Error('training family scope mismatch');
   const shape=firstRoundTrainingShape(recipe,phase,manifest.qualification.Ndemo,manifest.qualification.Nkeep);
   const r2=isFirstRoundR2Recipe(recipe),adaptiveLearning=r2&&phase==='formal';
   if(adaptiveLearning?task.limits.mode!=='scientific-observation-v1'||Object.hasOwn(task.limits,'maxOptimizerSteps'):task.limits.maxOptimizerSteps!==shape.maxOptimizerSteps)throw Error('first-round phase work contract');
   if(r2?(!manifest.plan.researchProtocol||manifest.plan.researchProtocol.id!=='first-round-common-view-r2'||manifest.plan.researchProtocol.revisionRef!==task.scientificContract.analysisMethodRef):manifest.plan.researchProtocol!==undefined)throw Error('r2 dataset protocol required');
   return {firstRound:true,r2,adaptiveLearning,runtime,dataset,identities,envelope,migrationBytes,proposal,seed,recipe,restartRef,phase,Uepoch:shape.Uepoch,maxSteps:shape.maxOptimizerSteps,milestoneUpdates:shape.milestoneUpdates,Ndemo:manifest.qualification.Ndemo,
    frozenRefs:{dataset:task.datasetRefs[0],manifestSHA256:dataset.manifestSHA256,teacher:task.labelPolicyRef,B:task.outputSpec.proposalPolicyRef,parent:task.parentPolicyRef,parentIdentity:identities.studentScorer,proposalIdentity:identities.basePolicy,inputContract:identities.encoderConfig,encoder:identities.encoderVersion,candidate:identities.candidateSpecRef,candidatePolicy:resolveCandidatePolicy(identities.candidatePolicy),prompt:task.promptRef,recipe:task.learnerRecipe,sourceRevision:task.sourceRevision,runtimeRef:task.runtimeRef,phase,seed}};
  }
  const loaded=loadFrozenDataset(dataset,{requireTrainingEligible:mode==='research'});
  if(mode==='offline_synthetic'&&loaded.manifest.plan.purpose!=='engineering_fixture')throw Error('explicit synthetic dataset required');
  if(mode==='research'&&task.sourcePlan.split!=='train')throw Error('only training source split may learn');
  const identities=loaded.manifest.plan.identities,parentRef=refs.get(task.parentPolicyRef);
  if(parentRef?.schema!=='ohuo-parent-policy-ref-v1')throw Error('fixed parent policy reference required');
  const parent=await resolveNodePolicy(parentRef.policyRef,repo);
  if(!same(json(parent.identity),parentRef.policyIdentity)||!same(parentRef.policyIdentity,identities.basePolicy)||parent.identity.inputDim!==399||!same(json(parent.encoder),identities.encoderConfig))throw Error('frozen dataset/parent/encoder mismatch');
  if(!same(refs.get(task.labelPolicyRef),identities.teacher)||refs.get(task.promptRef)?.promptRef!==identities.promptRef)throw Error('frozen teacher/prompt mismatch');
  const indexBytes=readFileSync(inputs.sourceIndexPath),sourceRef=refs.get(task.sourcePlan.sourceIndexRef);
  if(sourceRef?.fileSHA256!==sha(indexBytes)||loaded.manifest.plan.sourceIndexSHA256!==sha(indexBytes))throw Error('frozen source bytes mismatch');
  if(mode==='research'&&loaded.manifest.plan.sourceIndexRef!==task.sourcePlan.sourceIndexRef)throw Error('dataset/task source reference mismatch');
  if(!same([...loaded.manifest.plan.families.filter((f:any)=>f.split==='train').map((f:any)=>f.sourceFamily)].sort(),[...task.sourcePlan.familyIds].sort()))throw Error('training family scope mismatch');
  const parentPath=realpathSync(resolve(repo,parent.descriptor.weightsPathOrUrl.nodePath!));if(relative(repo,parentPath).startsWith('..'))throw Error('parent path escape');
  const Uepoch=Math.ceil(loaded.manifest.qualification.Ndemo/32),maxSteps=phase==='calibration'?Math.min(8,Uepoch):3*Uepoch;
  return {dataset,identities,parentPath,parentSHA256:parent.identity.weightsSHA256,seed,recipe,restartRef,phase,Uepoch,maxSteps,
   frozenRefs:{dataset:task.datasetRefs[0],manifestSHA256:dataset.manifestSHA256,teacher:task.labelPolicyRef,B:task.parentPolicyRef,parentIdentity:identities.basePolicy,encoder:identities.encoderVersion,candidate:identities.candidateSpecRef,...(identities.candidatePolicy?{candidatePolicy:resolveCandidatePolicy(identities.candidatePolicy)}:{}),prompt:task.promptRef,recipe:task.learnerRecipe,sourceRevision:task.sourceRevision,runtimeRef:task.runtimeRef,phase,seed}};
 };
 const validateCheckpoint=(cp:Checkpoint)=>!!cp&&cp.schema==='ohuo-supervised-run-v1'&&typeof cp.taskSHA256==='string'&&typeof cp.datasetSHA256==='string'&&Number.isSafeInteger(cp.optimizerSteps)&&cp.optimizerSteps>=0&&cp.studentCheckpoint?.optimizerSteps===cp.optimizerSteps&&cp.studentCheckpoint.schema==='ohuo-supervised-pointer-v1'&&Array.isArray(cp.milestones);
 const run=async(ctx:any)=>{
  const {task,signal}=ctx;let p=ctx.executionInputs;
  if(signal.aborted)throw Object.assign(stopped(signal),{cleanupConfirmed:true,actualScope:{...scope,parameterUpdates:false}});
  if(p.firstRound){
   try{
    const loaded=loadFrozenDataset(p.dataset,{requireTrainingEligible:mode==='research'});validateFirstRoundDatasetMetadata(loaded.manifest,mode);
    if(!same(loaded.manifest.plan.identities,p.identities))throw Error('first-round dataset changed after admission');
    const parent=await resolveFirstRoundParent({parentRef:task.parentPolicyRef,envelope:p.envelope,repositoryRoot:repo,readEvidence:()=>p.migrationBytes}),proposal=await resolveNodePolicy(p.proposal.release.proposalPolicyRef,repo);
    if(!same(json(proposal.identity),p.identities.basePolicy)||!same(json(proposal.encoder),p.identities.proposalEncoderConfig))throw Error('first-round actual B proposal mismatch');
    p={...p,parentPath:parent.parentPath,parentSHA256:parent.scorer.weightsSHA256};
   }catch(error){throw Object.assign(error as object,{cleanupConfirmed:true,actualScope:{...scope,parameterUpdates:false}});}
  }
  if(signal.aborted)throw Object.assign(stopped(signal),{cleanupConfirmed:true,actualScope:{...scope,parameterUpdates:false}});
  if(p.r2){
   if(ctx.executionBoundary?.mode!=='input-workload-only'||!['scientific-observation-v1','input-derived-workload-v1'].includes(task.limits.mode))throw Error('r2 explicit execution boundary required');
   fixedReference(ctx.executionBoundary.resourcePolicyRef,'executionBoundary.resourcePolicyRef');
  }
  const worker=new OwnedPython(python,signal);let cleaned=false,cp:Checkpoint|null=ctx.checkpoint,sequence=ctx.checkpointSequence;
  let metrics:any[]=[],exposure:any=null;
  const learningObservation=()=>{
   if(!p.adaptiveLearning)return null;
   const ms=cp?.milestones??[];
   if(ms.length<2)return{schema:FIRST_ROUND_R2_STOPPING_RULE,decision:'continue',reason:'awaiting_complete_dataset_epoch'};
   const current=ms.at(-1)!.metrics,previous=ms.at(-2)!.metrics,baseline=ms[0].metrics;
   return decideFirstRoundR2Learning({baseline,previous,current,weightsChanged:current.weightsSHA256!==previous.weightsSHA256});
  };
  const workRemains=()=>p.adaptiveLearning?learningObservation()?.decision==='continue':(cp?.optimizerSteps??0)<p.maxSteps;
  const withinExecutionBoundary=()=>p.r2?ctx.executionBoundary?.mode==='input-workload-only':performance.now()<ctx.deadlineMonotonicMs;
  const summary=()=>{
   const value={schema:'ohuo-supervised-summary-v1',trainingKind:'supervised_rerank',runId:task.runId,taskSHA256:digest(task),frozenRefs:p.frozenRefs,
    plan:p.r2?{recipe:p.recipe,phase:p.phase,Uepoch:p.Uepoch,stoppingRule:FIRST_ROUND_R2_STOPPING_RULE,observationEveryUpdates:p.Uepoch,effectiveBatch:2*Math.min(32,p.Ndemo)}:p.firstRound?{recipe:p.recipe,phase:p.phase,Uepoch:p.Uepoch,maxUpdates:64,maxOptimizerSteps:p.maxSteps,effectiveBatch:2*p.Ndemo,milestoneUpdates:p.milestoneUpdates}:{recipe:p.recipe,phase:p.phase,Uepoch:p.Uepoch,maxEpochs:3,maxOptimizerSteps:p.maxSteps,effectiveBatch:64},
    actual:{...(p.adaptiveLearning?{learningObservation:learningObservation()}:{}),optimizerSteps:cp?.optimizerSteps??0,exposure,latestCompleteCheckpoint:cp?.studentCheckpoint??null,lastCommittedStep:cp?.lastStep??null,providerRequests:0,realTraining:mode==='research'},metrics,
    selection:{status:'not_selected',reason:p.phase==='calibration'?'calibration_never_released':'requires_frozen_dev_behavior_review',allowedCheckpoints:cp?.milestones??[]},
    engineeringStatus:'supervised_consumer',absorptionStatus:'not_inferred_from_loss',researchQualified:null};
   const path=join(task.outputRoot,'summary.json'),tmp=path+'.tmp-'+process.pid;writeFileSync(tmp,JSON.stringify(value),{flag:'w',mode:0o600});renameSync(tmp,path);
   return {path,sha256:sha(readFileSync(path)),purpose:'committed supervised facts only; no strength or deployment claim'};
  };
  try{
   if(ctx.reconcileOnly===true&&!cp)throw Error('reconciliation requires committed supervised checkpoint');
   const ready=await worker.next();if(ready.kind!=='ready')throw Error('learner handshake');if(p.firstRound)verifyFirstRoundPythonRuntime(p.runtime,ready,python);
   if(cp&&(cp.taskSHA256!==digest(task)||cp.datasetSHA256!==p.dataset.manifestSHA256))throw Error('supervised checkpoint task/data changed');
   const init=await worker.request({kind:'init',dataset:p.dataset,identities:p.identities,synthetic:mode==='offline_synthetic',...(p.firstRound?{inputContract:p.identities.encoderConfig}:{}),parentPath:p.parentPath,parentSHA256:p.parentSHA256,frozenRefs:p.frozenRefs,seed:p.seed,recipe:p.recipe,restartRef:p.restartRef,runDir:task.outputRoot,checkpoint:cp?.studentCheckpoint??null});
   metrics=init.metrics;exposure=init.exposure;
   // The host's committed pointer is authoritative; latest/status are mirrors.
   // Repair after full fixed-checkpoint validation and before any new reserve,
   // including a resume that cannot take another optimizer step.
   if(cp){await worker.request({kind:'publish',checkpoint:cp.studentCheckpoint});summary();}
   if(!cp){
    const initial=await worker.request({kind:'save'});exposure=initial.exposure;
    cp={schema:'ohuo-supervised-run-v1',taskSHA256:digest(task),datasetSHA256:p.dataset.manifestSHA256,optimizerSteps:0,studentCheckpoint:initial.checkpoint,milestones:[{checkpoint:initial.checkpoint,metrics:metrics[0]}]};
    await ctx.saveCheckpoint(cp,++sequence);await worker.request({kind:'publish',checkpoint:initial.checkpoint});summary();
   }
   while(ctx.reconcileOnly!==true&&workRemains()&&!signal.aborted&&withinExecutionBoundary()){
    let reservation:string;try{reservation=await ctx.reserve(`supervised-step-${cp.optimizerSteps+1}-${ctx.executionId}`,{providerRequests:0,optimizerSteps:1,matchAttempts:0,labelDecisions:0});}catch(e){if((e as any).reason==='run_boundary')break;throw e;}
    if(signal.aborted){await ctx.settleReservation(reservation,{disposition:'not_sent',evidence:{kind:'confirmed_not_sent'}});break;}
    const step=await worker.request({kind:'step',expectedStep:cp.optimizerSteps+1,physicalDecisions});
    if(signal.aborted)throw stopped(signal);
    const next:Checkpoint={...cp,lastStep:step.step,optimizerSteps:step.step.optimizerSteps,studentCheckpoint:step.checkpoint,milestones:(p.firstRound?step.step.milestone:step.step.epochEnded)?[...cp.milestones,{checkpoint:step.checkpoint,metrics:step.metrics.at(-1)}]:cp.milestones};
    // Existing atomic commit binds a complete student transaction to one step;
    // worker latest/status are published only after that commit succeeds.
    await ctx.commit(reservation,next);cp=next;metrics=step.metrics;exposure=step.exposure;
    await worker.request({kind:'publish',checkpoint:step.checkpoint});summary();
   }
   cleaned=await worker.close();return {completed:p.adaptiveLearning?learningObservation()?.decision!=='continue':cp.optimizerSteps===p.maxSteps,cleanupConfirmed:cleaned,actualScope:{...scope,parameterUpdates:ctx.reconcileOnly!==true},stopReason:ctx.reconcileOnly===true?'checkpoint_reconciled':signal.aborted?String(signal.reason):p.adaptiveLearning?'scientific_observation_'+learningObservation()?.decision:'run_boundary',artifactRefs:[summary()]};
  }catch(error){cleaned=await worker.close();if(cp)try{summary();}catch{};throw Object.assign(error as object,{cleanupConfirmed:cleaned,actualScope:scope});}
 };
 return {id:'B10.supervised-rerank.v1',kind:'supervised_training',mode,prepare,validateCheckpoint,run};
}
export function createDistillTaskHost({root,adapter,...options}:Options&{root:string;adapter:any}){
 return (createTaskController as any)({root,adapter,consumers:[createDistillConsumer(options)]});
}
