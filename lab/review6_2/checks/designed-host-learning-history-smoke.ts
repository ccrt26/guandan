/** Finite original H history check. No training, models or actual permission. */
import assert from 'node:assert/strict';
import {realpathSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {FIRST_ROUND_RECIPE} from '../first-round-contract.mjs';
import {FixedHostFiles} from '../ohuo-host-files';
import {createDesignedConsumerFixture} from './designed-source-consumer-fixture';
import {canonical,digest,referenceOf,validateTask} from '../task-schema.mjs';
const f=createDesignedConsumerFixture(realpathSync(mkdtempSync(join(tmpdir(),'h-designer-')))),root=f.dir,control=join(root,'lab/out/control'),sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const put=(path:string,value:any)=>{const bytes=canonical(value);mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes,{mode:0o600});return {path,sha256:sha(bytes)};};
const ref=(name:string,value:any)=>{const id=referenceOf('synthetic-learning/'+name,value);f.refs.set(id,value);return id;};
try{
 mkdirSync(control,{recursive:true});const descriptor={schema:'ohuo-frozen-dataset-ref-v1',manifestSHA256:'c'.repeat(64)},datasetRef=ref('dataset',descriptor),cap=ref('capability',{id:'B10.supervised-rerank.v1',kind:'supervised_training',mode:'research'});
 const task=validateTask({...f.task,taskKind:'supervised_training',capabilityRef:cap,taskId:'old-learning',runId:'old-learning',datasetRefs:[datasetRef],operationScope:{localExecution:true,apiCalls:false,parameterUpdates:true,deployment:false},outputRoot:join(control,'runs/old-learning'),learnerRecipe:FIRST_ROUND_RECIPE,outputSpec:{trainingKind:'supervised_rerank',proposalPolicyRef:f.fixed,releaseStatus:'development'},limits:{maxProviderRequests:0,maxLabelDecisions:0,maxOptimizerSteps:1,maxMatchAttempts:0,maxRunSeconds:60}}),taskRef=ref('task',task),cp={schema:'ohuo-supervised-run-v1',taskSHA256:digest(task),datasetSHA256:descriptor.manifestSHA256,optimizerSteps:1,studentCheckpoint:{schema:'ohuo-supervised-pointer-v1',optimizerSteps:1},milestones:[]},cpSHA=digest(cp),cpPath=join(task.outputRoot,'checkpoint-'+cpSHA+'.json');put(relative(root,join(task.outputRoot,'task.json')),task);put(relative(root,cpPath),cp);
 const manifest={schema:'ohuo-fixed-host-v1',controlRoot:'lab/out/control',rootInstanceId:'synthetic-learning',initialStateRef:f.fixed,references:[...f.refs].map(([ref,value])=>({ref,file:put('refs/'+sha(ref)+'.json',value)})),evidenceFiles:[],grantFile:put('grant.json',{fixture:true}),planCloseoutFile:'closeout.json',inputBindings:[],profileStorePath:null,pythonPath:null};put('deliverables/ohuo-runtime/host.json',manifest);
 const host:any=new FixedHostFiles(root),scope={planRef:task.planRef,budgetRef:task.budgetRef},state:any={tasks:{[task.taskId]:task.runId},runs:{[task.runId]:{task,taskRef,runId:task.runId,taskSHA256:digest(task),status:'completed',cleanupConfirmed:true,checkpoint:cp,checkpointSHA256:cpSHA,checkpointRef:cpPath}},budgets:{[task.budgetRef]:{activeRunId:null,reservations:{}}}};
 const pins:any[]=[];assert.deepEqual(host.augmentationLearningDatasetRefs(state,scope,pins),[datasetRef]);assert.equal(pins.length,2);
 const oldProtocol=structuredClone(state);oldProtocol.runs[task.runId].task.scientificContract.analysisMethodRef=f.rulesRef;assert.throws(()=>host.augmentationLearningDatasetRefs(oldProtocol,scope,[]),/state_history_conflict/,'changed protocol cannot disappear by filtering');
 for(const patch of [{status:'running'},{executionUnknown:true},{observationStatus:'unknown'},{stopReason:'execution_uncertain'},{failureReason:'execution_uncertain'}]){const bad=structuredClone(state);Object.assign(bad.runs[task.runId],patch);assert.throws(()=>host.augmentationLearningDatasetRefs(bad,scope,[]),/selection_execution_uncertain/);}
 const tamper=structuredClone(state);tamper.runs[task.runId].checkpoint.optimizerSteps=9;assert.throws(()=>host.augmentationLearningDatasetRefs(tamper,scope,[]),/state_history_conflict/);
 const bytes=readFileSync(cpPath);writeFileSync(cpPath,canonical({...cp,datasetSHA256:'d'.repeat(64)}));assert.throws(()=>host.augmentationLearningDatasetRefs(state,scope,[]),/state_history_conflict/);writeFileSync(cpPath,bytes);
 const pending=structuredClone(state);pending.budgets[task.budgetRef].reservations.r={runId:task.runId,status:'reserved_unknown'};assert.throws(()=>host.augmentationLearningDatasetRefs(pending,scope,[]),/selection_execution_uncertain/);
 console.log(JSON.stringify({status:'passed',actualHostHistoryMethod:true,allSameScopeLearnedRefs:true,unfinishedUnknownAndTamperedCheckpointRejected:true,models:0,trainingSteps:0,providerRequests:0,researchAdmission:false}));
}finally{rmSync(root,{recursive:true,force:true});}
