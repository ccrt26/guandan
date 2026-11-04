// Synthetic fixed-controller boundaries only: no provider, model or match.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join,resolve} from 'node:path';
import {canonical,referenceOf} from '../task-schema.mjs';
const original={read:fs.readFileSync,write:fs.writeFileSync,rename:fs.renameSync};
const stopAtLaunch=process.argv.at(-1)==='stop';
let watched='',reads=0,writes=0,launchReads=0,launchWindow=false;
fs.readFileSync=function(path,...args){if(String(path)===watched){reads++;if(launchWindow)launchReads++;}return original.read.call(this,path,...args);};
fs.writeFileSync=function(path,...args){if(String(path).startsWith(watched+'.tmp-'))writes++;return original.write.call(this,path,...args);};
fs.renameSync=function(from,to){const value=original.rename.call(this,from,to);if(String(to)===watched&&JSON.parse(original.read(watched,'utf8')).runs['run-1']?.status==='running'){launchWindow=true;launchReads=0;if(stopAtLaunch)queueMicrotask(()=>{const s=JSON.parse(original.read(watched,'utf8'));s.runs['run-1'].status='stopping';original.write(watched,canonical(s));});}return value;};
syncBuiltinESMExports();
const {createTaskController}=await import('../task-control.mjs');
const root=fs.realpathSync(fs.mkdtempSync(resolve('lab/out/v542-tc-smoke-'))),refs=new Map();
const ref=(id,value)=>{const r=referenceOf(id,value);refs.set(r,value);return r;};
const fixed=ref('fixed',{engineeringFixture:true}),planRef=ref('plan',{version:1}),authorizationRef=ref('auth',{engineeringFixture:true});
const limits={maxProviderRequests:2,maxOptimizerSteps:0,maxMatchAttempts:0,maxLabelDecisions:0,maxRunSeconds:20};
const budgetRef=ref('budget',{researchBatchId:'fixture-batch',authorizationRef,planRef,controlRoot:root,limits});
const capabilityRef=ref('capability',{id:'B06.synthetic-probe.v1',kind:'probe',mode:'offline_synthetic'});
const sourcePath=join(root,'source-index.json');original.write(sourcePath,'{}');
const task={schemaVersion:1,taskId:'task-1',experimentId:'experiment-1',attemptId:'a01',planVersion:1,planRef,parentTaskId:null,retryReasonRef:null,researchBatchId:'fixture-batch',budgetRef,authorizationRef,taskKind:'probe',capabilityRef,sourceRevision:fixed,runtimeRef:fixed,parentPolicyRef:fixed,releaseRefs:[fixed],rulesRef:fixed,sourcePlan:{namespace:'fixture',sourceIndexRef:fixed,familyIds:['fixture'],split:'fixture'},splitRefs:[fixed],seatLayoutPlan:fixed,actorSampleRule:'evaluated-seat-only',datasetRefs:[],labelPolicyRef:fixed,promptRef:fixed,scientificContract:{question:'Synthetic control boundaries',primaryMetricRef:fixed,analysisUnit:'complete-source-block',analysisMethodRef:fixed,comparisonRef:fixed,selectionRuleRef:fixed,readoutRuleRef:fixed,decisionRuleRef:fixed},planScope:{clauseRef:fixed,branchRef:null,prerequisiteRefs:[fixed]},learnerRecipe:null,operationScope:{localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false},limits,allowedBranches:[],stopPolicy:fixed,outputSpec:{artifactKinds:['synthetic-checkpoint'],releaseStatus:'development'},outputRoot:join(root,'runs/run-1'),runId:'run-1',taskStatus:'ready',unresolved:[]};
const zeros={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0};
watched=join(root,'state.json');
original.write(watched,canonical({schemaVersion:1,tasks:{},runs:{},budgets:{[budgetRef]:{researchBatchId:'fixture-batch',authorizationRef,planRef,limits,used:zeros,reservations:{},activeRunId:null,elapsedSeconds:0}},batches:{'fixture-batch':{budgetRef,authorizationRef,planRef}}}));
let revision=1,closeoutSHA256='a'.repeat(64),status='incomplete',runArgs;
const adapter={productionPlanClosure:true,resolveRef:r=>refs.get(r),checkAuthorization:async()=>({authorizationRef,controlRoot:root,scope:task.operationScope,mode:'offline_synthetic'}),checkPlan:async()=>({status,eligible:true,hostObservation:{planRef,planVersion:1,revision,closeoutSHA256,status}}),verifyInputs:async()=>({sourceIdentity:fixed,sourceIndexPath:sourcePath})};
const consumer={id:'B06.synthetic-probe.v1',kind:'probe',mode:'offline_synthetic',validateCheckpoint:()=>true,async run(ctx){runArgs=ctx;launchWindow=false;assert.equal(launchReads,1,'consumer argument construction must use one fresh state snapshot');assert.equal(ctx.checkpoint,null);assert.equal(ctx.checkpointSequence,0);assert.equal(typeof ctx.executionId,'string');assert.equal(ctx.signal.aborted,stopAtLaunch);assert(ctx.deadlineMonotonicMs>performance.now());return{completed:!ctx.signal.aborted,cleanupConfirmed:true,actualScope:task.operationScope};}};
const c=createTaskController({root,adapter,consumers:[consumer]});
try{
 if(process.argv.at(-1)==='plan'){
  await c.assertCurrentPlan(task);assert.equal(writes,1);
  reads=0;writes=0;await c.assertCurrentPlan(task);
  assert.equal(writes,0,'same observation must not rewrite the ledger');assert.equal(reads,3,'remove only the discarded pre-lock full read');
  revision=2;closeoutSHA256='b'.repeat(64);await c.assertCurrentPlan(task);assert.equal(writes,1);
  revision=1;await assert.rejects(c.assertCurrentPlan(task),e=>e.reason==='plan_state_conflict');assert.equal(writes,1,'rollback refusal has no persistent mutation');
  revision=3;status='completed';await assert.rejects(c.assertCurrentPlan(task),e=>e.reason==='plan_closed');assert.equal(writes,2,'new closed observation remains durable');
  status='incomplete';await assert.rejects(c.assertCurrentPlan(task),e=>e.reason==='plan_closed');
  const valid=original.read(watched);fs.unlinkSync(watched);await assert.rejects(c.assertCurrentPlan(task),e=>e.reason==='budget_state_missing');original.write(watched,valid);
  const target=join(root,'real-state.json');original.rename(watched,target);fs.symlinkSync(target,watched);await assert.rejects(c.assertCurrentPlan(task),e=>e.reason==='state_invalid');fs.unlinkSync(watched);original.rename(target,watched);
  const state=JSON.parse(valid);state.hostPlanObservations={};original.write(watched,canonical(state));revision=4;
  const {acquireSourceWriter}=await import('../writer-lock.ts');const release=acquireSourceWriter(watched);try{await assert.rejects(c.assertCurrentPlan(task),e=>e.reason==='control_busy');}finally{release();}
  await c.assertCurrentPlan(task);assert(!fs.existsSync(watched+'.writer-lock'));
  const current=JSON.parse(original.read(watched,'utf8'));current.hostPlanObservations=1;original.write(watched,canonical(current));await assert.rejects(c.assertCurrentPlan(task),TypeError);assert(!fs.existsSync(watched+'.writer-lock'),'callback exception must release the lock');
  current.hostPlanObservations={};current.unrelatedConcurrentFixture={preserved:true};original.write(watched,canonical(current));await c.assertCurrentPlan(task);assert.deepEqual(JSON.parse(original.read(watched,'utf8')).unrelatedConcurrentFixture,{preserved:true});
  console.log(JSON.stringify({status:'passed',unchangedWrites:0,stateReads:3,changedAndClosedPersisted:true,rollbackMissingSymlinkBusyRejected:true}));
 }else{
  const result=await c.dispatchOhuo('start',{taskRef:ref('task',task)});assert(['running','stopping','interrupted'].includes(result.status));const end=await c.waitForRun(task.runId);assert.equal(end.status,stopAtLaunch?'interrupted':'completed',JSON.stringify(end));assert(runArgs);assert.equal(end.cleanupConfirmed,true);assert.equal(end.sharedBudget.used.providerRequests,0);console.log(JSON.stringify({status:'passed',launchStateReads:launchReads,stopObserved:stopAtLaunch,cleanup:true,providerRequests:0}));
 }
}finally{fs.readFileSync=original.read;fs.writeFileSync=original.write;fs.renameSync=original.rename;syncBuiltinESMExports();fs.rmSync(root,{recursive:true,force:true});}
