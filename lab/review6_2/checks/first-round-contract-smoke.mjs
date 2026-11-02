await import('./first-round-budget-smoke.mjs');
await import('./first-round-source-action-scope-smoke.mjs');
import {checkFirstRoundNewTestFreeze} from './first-round-new-test-freeze-smoke.ts';
import {checkFirstRoundNewTestCaller} from './first-round-new-test-caller-smoke.ts';
import {checkFirstRoundPilot} from './first-round-pilot-smoke.ts';
/** One fixed round-contract case, supplemental sub-seams only until full join. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIRST_ROUND_RECIPE,isFirstRoundRecipe,validateFirstRoundRecipe,firstRoundTrainingShape,firstRoundRecoveryTriggerAllowed} from '../first-round-contract.mjs';
import {validateTask,referenceOf,digest} from '../task-schema.mjs';
import {createTaskController} from '../task-control.mjs';
import {selectFirstRoundCheckpoint} from '../first-round-selection.mjs';
import {bindNumericalRecoveryBranch} from '../numerical-recovery.ts';
import {createHash} from 'node:crypto';
import {screenFirstRoundBranches} from '../first-round-screen.mjs';
import {checkFirstRoundScreenActions} from './first-round-screen-actions-smoke.ts';
import {checkFirstRoundQualification} from './first-round-qualification-smoke.mjs';
import {checkFirstRoundHost} from './first-round-host-smoke.ts';
import {checkFirstRoundHostAdmission} from './first-round-host-admission-smoke.ts';
let taskTemplate;

assert(isFirstRoundRecipe(FIRST_ROUND_RECIPE));validateFirstRoundRecipe(FIRST_ROUND_RECIPE);
assert.deepEqual(firstRoundTrainingShape(FIRST_ROUND_RECIPE,'formal',16,16),{Uepoch:1,maxOptimizerSteps:64,milestoneUpdates:[0,16,32,64]});
assert.deepEqual(firstRoundTrainingShape(FIRST_ROUND_RECIPE,'calibration',4,4),{Uepoch:1,maxOptimizerSteps:1,milestoneUpdates:[0,1]});
for(const edit of [{maxUpdates:65},{checkpointUpdates:[0,1,16,32,64]},{maxSharedOptimizerSteps:131},{maxEpochs:3},{learningRate:1e-3}])assert.throws(()=>validateFirstRoundRecipe({...FIRST_ROUND_RECIPE,...edit}),/unsupported_first_round_recipe/);
for(const counts of [[0,0],[17,17],[4,3]])assert.throws(()=>firstRoundTrainingShape(FIRST_ROUND_RECIPE,'formal',...counts),/first_round_sample_count/);
validateFirstRoundRecipe({...FIRST_ROUND_RECIPE,learningRate:3e-5});
const legacy={recipeId:'supervised-rerank-v1',optimizer:'RMSprop',alpha:.9,eps:1e-5,momentum:0,centered:false,weightDecay:0,learningRate:1e-4,temperature:1,keepWeight:1,demoBatch:32,keepBatch:32,maxEpochs:3,initialization:'fixed-parent-new-optimizer'};
const base=fileURLToPath(new URL('../../out/S35-round-contract/',import.meta.url));mkdirSync(base,{recursive:true});
async function budgetCase(firstRound,sharedOptimizerCap=130,repairFailure=false){
 const root=mkdtempSync(join(base,firstRound?'first-':'legacy-')),refs=new Map();
 const ref=(id,value)=>{const r=referenceOf(id,value);refs.set(r,value);return r;};
 const fixed=ref('fixed',{synthetic:true}),planRef=ref('plan',{status:'incomplete'}),authorizationRef=ref('auth',{scope:'fixture'}),limits={maxProviderRequests:0,maxOptimizerSteps:1,maxMatchAttempts:0,maxLabelDecisions:0,maxRunSeconds:30};
 const budgetLimits={...limits,maxOptimizerSteps:sharedOptimizerCap};
 const budgetRef=ref('budget',{researchBatchId:'fixture',authorizationRef,planRef,controlRoot:root,limits:budgetLimits});
 const task={schemaVersion:1,taskId:'task',experimentId:'experiment',attemptId:'a1',planVersion:1,planRef,parentTaskId:null,retryReasonRef:null,researchBatchId:'fixture',budgetRef,authorizationRef,taskKind:'supervised_training',capabilityRef:ref('cap',{id:'B10.supervised-rerank.v1',kind:'supervised_training',mode:'offline_synthetic'}),sourceRevision:fixed,runtimeRef:fixed,parentPolicyRef:fixed,releaseRefs:[fixed],rulesRef:fixed,sourcePlan:{namespace:'fixture',sourceIndexRef:fixed,familyIds:['family'],split:'fixture'},splitRefs:[fixed],seatLayoutPlan:fixed,actorSampleRule:'evaluated-seat-only',datasetRefs:[fixed],labelPolicyRef:fixed,promptRef:fixed,scientificContract:{question:'fixed control-summary fixture, no learner',primaryMetricRef:fixed,analysisUnit:'decision',analysisMethodRef:fixed,comparisonRef:fixed,selectionRuleRef:fixed,readoutRuleRef:fixed,decisionRuleRef:fixed},planScope:{clauseRef:fixed,branchRef:null,prerequisiteRefs:[]},learnerRecipe:firstRound?FIRST_ROUND_RECIPE:legacy,operationScope:{localExecution:true,apiCalls:false,parameterUpdates:true,deployment:false},limits,allowedBranches:[],stopPolicy:fixed,outputSpec:{trainingKind:'supervised_rerank',proposalPolicyRef:fixed,releaseStatus:'development'},outputRoot:join(root,'runs/run'),runId:'run',taskStatus:'ready',unresolved:[]};
 validateTask(task);taskTemplate??=structuredClone(task);assert.throws(()=>validateTask({...task,extraRoundField:true}),e=>e.reason==='unknown_field');
 if(firstRound)assert.throws(()=>validateTask({...task,limits:{...limits,maxOptimizerSteps:65}}),e=>e.reason==='unsupported_recipe');
 const zeros={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0};
 const statePath=join(root,'state.json'),sourceIndexPath=join(root,'source-index.json');writeFileSync(sourceIndexPath,'{}');
 writeFileSync(statePath,JSON.stringify({schemaVersion:1,tasks:{},runs:{},budgets:{[budgetRef]:{researchBatchId:'fixture',authorizationRef,planRef,limits:budgetLimits,used:zeros,reservations:{},activeRunId:null,elapsedSeconds:0}},batches:{fixture:{budgetRef,authorizationRef,planRef}}}));
 let computations=0;
 const consumer={id:'B10.supervised-rerank.v1',kind:'supervised_training',mode:'offline_synthetic',validateCheckpoint:c=>c?.schema==='ohuo-supervised-run-v1',run:async ctx=>{
  computations++;
  if(!ctx.reconcileOnly){const cp={schema:'ohuo-supervised-run-v1',taskSHA256:digest(task),optimizerSteps:1,studentCheckpoint:{schema:'ohuo-supervised-pointer-v1',optimizerSteps:1},milestones:[]};const r=await ctx.reserve('fixed-step',{...zeros,optimizerSteps:1});await ctx.commit(r,cp);throw Object.assign(Error('fixed-postcommit-fault'),{cleanupConfirmed:true,actualScope:task.operationScope});}
  await assert.rejects(ctx.reserve('forbidden',zeros),e=>e.reason==='reconcile_read_only');
  await new Promise(resolve=>setTimeout(resolve,12));
  if(repairFailure)throw Object.assign(Error('fixed-repair-failure'),{cleanupConfirmed:true,actualScope:{...task.operationScope,parameterUpdates:false}});
  return{completed:true,cleanupConfirmed:true,actualScope:{...task.operationScope,parameterUpdates:false}};
 }};
 let closed=false;const adapter={resolveRef:async r=>refs.get(r),checkAuthorization:async()=>({authorizationRef,controlRoot:root,mode:'offline_synthetic',scope:task.operationScope}),checkPlan:async()=>({status:closed?'completed':'incomplete',eligible:true}),verifyInputs:async()=>({sourceIdentity:fixed,sourceIndexPath})};
 const host=createTaskController({root,adapter,consumers:[consumer]}),taskRef=ref('task',task);
 const terminal=async()=>{for(let n=0;n<100;n++){const s=await host.dispatchOhuo('status',{runId:'run'});if(['completed','failed','interrupted'].includes(s.status))return s;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('fixed fixture terminal timeout');};
 const started=await host.dispatchOhuo('start',{taskRef});if(sharedOptimizerCap>130){assert.equal(started.reason,'budget_binding_conflict');assert.equal(computations,0);return{over130Rejected:true};}assert.equal(started.status,'running',JSON.stringify(started));assert.equal((await terminal()).status,'failed');
 const before=JSON.parse(readFileSync(statePath));assert.equal((await host.dispatchOhuo('resume',{runId:'run'})).status,'running');assert.equal((await terminal()).status,repairFailure?'failed':'completed');
 const after=JSON.parse(readFileSync(statePath));
 for(const key of ['checkpoint','checkpointSHA256','checkpointRef','committed'])assert.deepEqual(after.runs.run[key],before.runs.run[key]);
 for(const key of ['used','reservations'])assert.deepEqual(after.budgets[budgetRef][key],before.budgets[budgetRef][key]);
 const receipt=JSON.parse(readFileSync(after.runs.run.recoveryReceiptRefs.at(-1).path));
 if(firstRound){assert(after.runs.run.elapsedSeconds>before.runs.run.elapsedSeconds,'active mirror computation must be counted');assert.equal(after.runs.run.elapsedSeconds-before.runs.run.elapsedSeconds,after.budgets[budgetRef].elapsedSeconds-before.budgets[budgetRef].elapsedSeconds);assert.equal(receipt.schema,'ohuo-checkpoint-reconciliation-first-round-v1');assert.equal(receipt.activeTimeCharged,true);}
 else {assert.equal(after.runs.run.elapsedSeconds,before.runs.run.elapsedSeconds);assert.equal(after.budgets[budgetRef].elapsedSeconds,before.budgets[budgetRef].elapsedSeconds);assert.equal(receipt.schema,'ohuo-checkpoint-reconciliation-v1');}
 if(firstRound){
  // The fixture does not authorize extra work: mark this same synthetic run
  // interrupted solely to exercise original resume admission with exhausted time.
  after.runs.run.status='interrupted';after.runs.run.elapsedSeconds=30;writeFileSync(statePath,JSON.stringify(after));
  const beforeComputations=computations,result=await host.dispatchOhuo('resume',{runId:'run'});assert.equal(result.status,'rejected');assert.equal(result.reason,'run_boundary');assert.equal(computations,beforeComputations);assert.equal(JSON.parse(readFileSync(statePath)).budgets[budgetRef].activeRunId,null);
  closed=true;assert.equal((await host.dispatchOhuo('resume',{runId:'run'})).reason,'plan_closed');
 }
 return{firstRound,optimizerWork:0,simulatedCommittedSteps:1,activeMirrorTime:firstRound?'charged':'legacy-unchanged',root};
}
// Fixed R15 source contract only. These are synthetic dev measurements, not
// data qualification or a completed real learner trajectory.
const directions=(passCE=1,takeoverCE=1)=>({pass:{demoCE:passCE,count:3,greedyAgreementCount:1,sourceFamilyIds:['dev-a','dev-b']},takeover:{demoCE:takeoverCE,count:3,greedyAgreementCount:2,sourceFamilyIds:['dev-a','dev-b']}});
const milestones=[0,16,32,64].map((step,i)=>({checkpoint:{optimizerSteps:step,manifestSHA256:String(i+1).repeat(64)},metrics:{demoCE:i?0.8:1,keepKL:i?0.2:0,keepDriftRate:i?.9:0,greedyChangedCount:i?2:0,directionMetrics:directions(i?.8:1,i?.8:1)}}));
const reviews=milestones.slice(1).map(m=>({checkpointSHA256:m.checkpoint.manifestSHA256,status:'accepted'}));
assert.equal(selectFirstRoundCheckpoint(milestones,reviews).selected.optimizerSteps,16,'ties choose earlier and 90% drift is report-only');
const lowerKL=structuredClone(milestones);lowerKL[2].metrics.keepKL=.1;assert.equal(selectFirstRoundCheckpoint(lowerKL,reviews).selected.optimizerSteps,32);
const lowerCE=structuredClone(lowerKL);lowerCE[3].metrics.demoCE=.7;lowerCE[3].metrics.directionMetrics=directions(.7,.7);assert.equal(selectFirstRoundCheckpoint(lowerCE,reviews).selected.optimizerSteps,64);
const wrongDirection=structuredClone(milestones);for(const m of wrongDirection.slice(1))m.metrics.directionMetrics=directions(1.1,.5);assert.equal(selectFirstRoundCheckpoint(wrongDirection,reviews).status,'no_candidate');
const missingDirection=structuredClone(milestones);delete missingDirection[0].metrics.directionMetrics.takeover;assert.equal(selectFirstRoundCheckpoint(missingDirection,reviews).status,'no_candidate');
const oneFamily=structuredClone(milestones);oneFamily[0].metrics.directionMetrics.pass.sourceFamilyIds=['dev-a'];assert.equal(selectFirstRoundCheckpoint(oneFamily,reviews).status,'no_candidate');
const mismatchedCounts=structuredClone(milestones);for(const m of mismatchedCounts.slice(1))m.metrics.directionMetrics.pass.count=4;assert.equal(selectFirstRoundCheckpoint(mismatchedCounts,reviews).status,'no_candidate');
assert.equal(selectFirstRoundCheckpoint(milestones.slice(0,3),reviews).status,'no_candidate');
assert.equal(selectFirstRoundCheckpoint([...milestones,milestones[1]],reviews).status,'no_candidate');
assert.equal(selectFirstRoundCheckpoint(milestones,[]).status,'pending_behavior_review');
assert.equal(selectFirstRoundCheckpoint(milestones,reviews.map(r=>({...r,status:'rejected'}))).status,'no_candidate');
const equalCE=structuredClone(milestones);for(const m of equalCE.slice(1)){m.metrics.demoCE=1;m.metrics.directionMetrics=directions(1,1);}assert.equal(selectFirstRoundCheckpoint(equalCE,reviews).status,'no_candidate','update0 cannot win itself');
const noChange=structuredClone(milestones);for(const m of noChange.slice(1))m.metrics.greedyChangedCount=0;assert.equal(selectFirstRoundCheckpoint(noChange,reviews).selected.optimizerSteps,16,'probability-only is reportable, not a new scientific veto');
assert(firstRoundRecoveryTriggerAllowed(FIRST_ROUND_RECIPE,'diagnosed_numerical_divergence'));
assert.equal(firstRoundRecoveryTriggerAllowed(FIRST_ROUND_RECIPE,'first_epoch_demo_and_keep_increase'),false);
assert(firstRoundRecoveryTriggerAllowed(legacy,'first_epoch_demo_and_keep_increase'));
assert.equal(firstRoundRecoveryTriggerAllowed(legacy,'poor_play'),false);
const checks=[await budgetCase(true),await budgetCase(false),await budgetCase(true,131),await budgetCase(true,130,true)];
function originalRecoveryGate(recipe,trigger){
 const references=[],values=new Map(),ref=(id,value)=>{const r=referenceOf(id,value);references.push({ref:r,value});values.set(r,value);return r;};
 const fixed=ref('fixed',{synthetic:true}),branchRef=ref('branch',{once:true}),ruleRef=ref('rule',{numerical:true}),auth=ref('auth',{synthetic:true}),rootClause=ref('root-clause',{}),calClause=ref('cal-clause',{}),formalClause=ref('formal-clause',{});
 const action=(clauseRef,taskId)=>({clauseRef,branchRef,plannedTaskIds:[taskId],dependencyRefs:[],expectedArtifactKinds:[],acceptanceRuleRef:fixed,skipRuleRef:null,stopRuleRef:null});
 const actions=[action(rootClause,'origin'),action(calClause,'cal-recovery'),action(formalClause,'formal-continuation')],planRef=ref('plan',{planVersion:1,actions}),controlRoot=taskTemplate.outputRoot+'/recovery-fixture';
 const limits={...taskTemplate.limits,maxOptimizerSteps:130},budgetRef=ref('budget',{controlRoot,planRef,researchBatchId:'fixture',authorizationRef:auth,limits});
 const ev=(id,value)=>{const bytes=JSON.stringify(value);return{ref:{id,sha256:createHash('sha256').update(bytes).digest('hex')},bytes};};
 const datasetManifest=ev('manifest',{qualification:{Ndemo:4,Nkeep:4}}),dataRef=ref('dataset',{schema:'ohuo-frozen-dataset-ref-v1',manifestSHA256:datasetManifest.ref.sha256});
 const branch={branchId:'numeric-once',conditionRef:ruleRef,evidenceRef:fixed,change:{learningRate:3e-5},maxUses:1,restartFrom:'fixed-parent',inheritBudgetRef:true};
 const make=(taskId,clauseRef,phase)=>({...structuredClone(taskTemplate),taskId,runId:taskId,experimentId:taskId,attemptId:taskId,planRef,budgetRef,authorizationRef:auth,parentPolicyRef:fixed,datasetRefs:[dataRef],releaseRefs:[fixed],learnerRecipe:recipe,planScope:{clauseRef,branchRef,prerequisiteRefs:[]},allowedBranches:[branch],limits:{...taskTemplate.limits,maxOptimizerSteps:phase==='formal'?(isFirstRoundRecipe(recipe)?64:3):1},outputRoot:controlRoot+'/runs/'+taskId});
 const origin=make('origin',rootClause,'calibration'),cal=make('cal-recovery',calClause,'calibration'),formal=make('formal-continuation',formalClause,'formal');
 for(const t of [origin,cal,formal])validateTask(t);
 const rootRef=ref('origin-task',origin),calRef=ref('cal-task',cal),formalRef=ref('formal-task',formal),roles=[{role:'calibration_recovery',taskId:cal.taskId,attemptId:cal.attemptId,runId:cal.runId,experimentId:cal.experimentId,clauseRef:calClause,branchRef,phase:'calibration'},{role:'formal_continuation',taskId:formal.taskId,attemptId:formal.attemptId,runId:formal.runId,experimentId:formal.experimentId,clauseRef:formalClause,branchRef,phase:'formal'}];
 const spec={schema:'ohuo-numerical-recovery-spec-v1',branchId:'numeric-once',branchRef,originalRuleRef:ruleRef,planRef,budgetRef,researchBatchId:'fixture',originExperimentId:origin.experimentId,failedTaskRef:rootRef,failedRunId:origin.runId,case:'failed_calibration',roles};
 const zero={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0},run={runId:origin.runId,taskRef:rootRef,taskSHA256:digest(origin),task:origin,status:'failed',cleanupConfirmed:true},state={schemaVersion:1,rootInstanceId:'synthetic-root',tasks:{origin:origin.runId},runs:{origin:run},budgets:{[budgetRef]:{researchBatchId:'fixture',authorizationRef:auth,planRef,limits,used:zero,reservations:{},activeRunId:null,elapsedSeconds:0}},batches:{fixture:{budgetRef,authorizationRef:auth,planRef}},hostPlanObservations:{[JSON.stringify([planRef,1])]:{status:'incomplete',revision:1,closeoutSHA256:'1'.repeat(64)}}};
 const diagnosis=ev('diagnosis',{failedTaskId:origin.taskId,datasetRef:dataRef,parentPolicyRef:fixed,seed:1,inputsCorrect:true,implementationCorrect:true,trigger,numericalDivergence:trigger==='diagnosed_numerical_divergence'}),metrics=ev('metrics',{failedTaskId:origin.taskId,datasetRef:dataRef,seed:1,update0:{sampleSetSHA256:'2'.repeat(64),demoCE:1,keepKL:0},firstEpoch:{sampleSetSHA256:'2'.repeat(64),demoCE:2,keepKL:1}});
 const binding=(taskRef,phase)=>({taskRef,sourceIndexFile:{path:'synthetic.json',sha256:'3'.repeat(64)},confirmedRecordRoots:[],datasetDirectory:'synthetic',studentReleaseFiles:[],seed:1,trainingPhase:phase,numericalRestartReceiptRef:null});
 return bindNumericalRecoveryBranch({stage:'spec',spec,approvedActions:actions,state,bindings:{references,inputBindings:[binding(rootRef,'calibration'),binding(calRef,'calibration'),binding(formalRef,'formal')],controlRoot,rootInstanceId:'synthetic-root',actionTaskRefs:[{clauseRef:calClause,branchRef,taskRef:calRef},{clauseRef:formalClause,branchRef,taskRef:formalRef}],assignmentFiles:[],datasetManifest,evidence:[diagnosis,metrics],calibrationQualifications:[],failureDiagnoses:[{runId:origin.runId,evidenceRef:diagnosis.ref,metricsRef:metrics.ref}]}});
}
assert.equal(originalRecoveryGate(FIRST_ROUND_RECIPE,'diagnosed_numerical_divergence').case,'failed_calibration');
assert.throws(()=>originalRecoveryGate(FIRST_ROUND_RECIPE,'first_epoch_demo_and_keep_increase'),e=>e.reason==='branch_evidence_unverified'&&e.field==='diagnosis');
assert.equal(originalRecoveryGate(legacy,'first_epoch_demo_and_keep_increase').case,'failed_calibration');
const screenInput={proposalActionId:'G',actions:[{actionId:'G',canonicalId:'takeover'},{actionId:'B',canonicalId:'pass'}],worlds:[0,1,2,3].map(i=>({worldId:'world-'+i,seed:i+1})),profileSHA256:'a'.repeat(64),policyIds:['S0-composite','O','partner','O'],results:[]};
for(const world of screenInput.worlds)for(const a of screenInput.actions)screenInput.results.push({worldId:world.worldId,actionId:a.actionId,result:{seed:world.seed,forcedActionId:a.actionId,profileSHA256:screenInput.profileSHA256,policyIds:screenInput.policyIds,initialWorldSHA256:String(world.seed).repeat(64),complete:true,g:1,W:1,y:2,ownPlanSummary:null}});
const screened=screenFirstRoundBranches(screenInput);assert.equal(screened.status,'provisional_screened');assert.equal(screened.actionSummaries[0].meanY,1,'legacy y=2 is not Y');assert.equal(screened.evidenceGrade,'provisional_screened','four wins never upgrade strong');
const lowerY=structuredClone(screenInput);for(const x of lowerY.results)if(x.actionId==='G'){x.result.W=-1;x.result.y=0;}assert.equal(screenFirstRoundBranches(lowerY).status,'screen_adverse');
const higherYLowerGW=structuredClone(screenInput);for(const x of higherYLowerGW.results){x.result.W=x.actionId==='G'?1:-1;x.result.g=x.actionId==='G'?-3:3;x.result.y=x.result.g+x.result.W;}assert.equal(screenFirstRoundBranches(higherYLowerGW).status,'screen_adverse','Y better but g+W lower is adverse under the frozen rule');
const incomplete=structuredClone(screenInput);incomplete.results[0].result={...incomplete.results[0].result,complete:false,W:null,y:null,incompleteReason:'deadline'};assert.equal(screenFirstRoundBranches(incomplete).status,'incomplete');assert.equal(screenFirstRoundBranches(incomplete).actionSummaries[0].meanY,null);
assert.equal(screenFirstRoundBranches({...screenInput,results:screenInput.results.slice(1)}).status,'incomplete');
assert.throws(()=>screenFirstRoundBranches({...screenInput,results:[...screenInput.results.slice(1),screenInput.results[1]]}),/duplicate_branch/);
const wrongWorld=structuredClone(screenInput);wrongWorld.results[1].result.initialWorldSHA256='f'.repeat(64);assert.throws(()=>screenFirstRoundBranches(wrongWorld),/paired_world_identity/);
const wrongPolicy=structuredClone(screenInput);wrongPolicy.results[0].result.policyIds=['B','O','partner','O'];assert.throws(()=>screenFirstRoundBranches(wrongPolicy),/branch_identity/);
const wrongW=structuredClone(screenInput);wrongW.results[0].result.W=0;assert.throws(()=>screenFirstRoundBranches(wrongW),/complete_metric/);
assert.throws(()=>screenFirstRoundBranches({...screenInput,worlds:[...screenInput.worlds,{worldId:'extra',seed:9}]}),/fixed_four_worlds/);
const screenActionChecks=checkFirstRoundScreenActions(),qualificationChecks=checkFirstRoundQualification(),hostChecks=await checkFirstRoundHost(),hostAdmissionChecks=await checkFirstRoundHostAdmission();
const pilotChecks=await checkFirstRoundPilot(),newTestCallerChecks=await checkFirstRoundNewTestCaller(),newTestFreezeChecks=await checkFirstRoundNewTestFreeze();
await import('./first-round-evaluation-smoke.ts');
await (await import('./first-round-public-readout-smoke.ts')).checkFirstRoundPublicReadout();
const peerChecks=await (await import('./first-round-peer-smoke.ts')).checkFirstRoundPeers();
const sourceChecks=await (await import('./first-round-source-smoke.ts')).checkFirstRoundSources();
console.log(JSON.stringify({case:'training.round-contract-smoke',status:'PARTIAL_SOURCE_PASS',covered:['strict_fixed64_recipe','actual_task_schema_dispatch','actual_controller_mirror_active_time','walltime_exhaustion_no_launch','legacy_contract_unchanged','closed_plan_stays_closed','shared_optimizer_cap_130','active_repair_failure_charged','two_direction_selection','no_drift_veto','fixed_milestones_only','numerical_only_recovery_trigger','actual_original_recovery_spec_gate','fixed_four_world_screen_result_contract','fixed_screen_action_selection','first_round_coverage_and_information_conflicts'],pending:['Mac actual same-capture Python finite-step/reload','Mac typecheck and source acceptance','actual research source/evidence qualification'],sourceChecks,peerChecks,pilotChecks,newTestCallerChecks,newTestFreezeChecks,checks,screenActionChecks,qualificationChecks,hostChecks,hostAdmissionChecks,realOptimizerSteps:0,providerRequests:0}));
