/** resume-two-step host boundary: four synthetic decisions, no real assets. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createDistillConsumer,DISTILL_RECIPE} from '../../distill-consumer';
import {freezeDataset,dataHash} from '../../distill-data';
import {referenceOf} from '../../task-schema.mjs';
import {createTaskController} from '../../task-control.mjs';
import {resolvePolicy} from '../../../../packages/ai/src/policy/resolve';
import {canonicalActionId} from '../../../../packages/ai/src/hybrid/legality';
const sha=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
const fixtureOutputRoot=process.env.B10_FIXTURE_OUTPUT_ROOT??join(process.cwd(),'lab/out/B10');
mkdirSync(fixtureOutputRoot,{recursive:true});
const root=mkdtempSync(join(fixtureOutputRoot,'host-')),repo=join(root,'repo');mkdirSync(join(repo,'lab/out/synthetic'),{recursive:true});
const weights=new Float32Array(168449);weights[0]=.2;weights[102656]=.2;weights[168192]=.2;
const bytes=new Uint8Array(weights.buffer);writeFileSync(join(repo,'lab/out/synthetic/B.f32'),bytes);
const descriptor:any={policyId:'synthetic-B',modelVersion:'synthetic-v1',architectureId:'mlp-tanh-256x256-scalar-v1',weightsLayoutVersion:'f32le-layer-w-row-major-then-b-v1',parameterCount:168449,inputDim:399,weightsSHA256:sha(bytes),weightsPathOrUrl:{nodePath:'lab/out/synthetic/B.f32'},encoder:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64',encoderVersion:'gd-lab-schema-v4'},candidateSpecId:'cand-suit-v3',epsilon:0,tieBreakId:'first-candidate-v1',tierSpecId:'none'};
const registry={schemaVersion:'gd-model-index-v1',defaultPolicyRef:descriptor.policyId,policies:[descriptor]};writeFileSync(join(repo,'lab/model-index.json'),JSON.stringify(registry));
const b=await resolvePolicy(descriptor.policyId,{registry,site:'node',readWeights:async()=>bytes,sha256:sha}),basePolicy=JSON.parse(JSON.stringify(b.identity));
const refs=new Map<string,any>(),ref=(id:string,value:any)=>{const r=referenceOf(id,value);refs.set(r,value);return r;};
const sourceIndex={version:1,families:{train0:{split:'train'},dev0:{split:'dev'}}},sourceIndexPath=join(root,'source-index.json');writeFileSync(sourceIndexPath,JSON.stringify(sourceIndex));
const sourceRef=ref('source-index',{schema:'ohuo-source-index-ref-v1',namespace:'B10-fixture',fileSHA256:sha(JSON.stringify(sourceIndex))});
const profile={profileId:'synthetic-teacher',revision:1,snapshotHash:'c'.repeat(64),credentialRevision:1,protocol:'openai-chat-completions',requestedModel:'synthetic-no-model'};
const teacher={releaseRef:'synthetic-H',promptRef:'synthetic-prompt',profileSnapshot:profile};
const plan:any={schema:'ohuo-distill-plan-v1',datasetId:'B10-synthetic',purpose:'engineering_fixture',sourceIndexRef:sourceRef,sourceIndexSHA256:sha(JSON.stringify(sourceIndex)),queueRef:'synthetic-layout',queueSHA256:'0'.repeat(64),samplingRef:'synthetic-prequery-selection',identities:{basePolicy,teacher,encoderConfig:b.encoder,encoderVersion:basePolicy.encoderVersion,candidateSpecRef:'ohuo-frozen-c8-expand4-v1',promptRef:teacher.promptRef},families:[{sourceFamily:'train0',split:'train',sourceRefs:['synthetic-train']},{sourceFamily:'dev0',split:'dev',sourceRefs:['synthetic-dev']}],games:[]};
const normal:any={kind:'single',cards:[{id:1,suit:'S',rank:9}],size:1,keyRank:9,length:1,pairRanks:[],mainRank:9,wildAs:[]};
const rows:any[]=[];
for(const split of ['train','dev'])for(const kind of ['demo','keep']){
 const id=`${split}-${kind}`,matchId='match-'+id,key={controllerOrRunnerGeneration:'synthetic',matchId,gameNo:1,moveNo:7,actorSeat:0,requestSeq:0};
 const features=[new Array(399).fill(0),new Array(399).fill(0)];features[0][0]=.5;features[1][0]=1;
 const rawQ=[...b.createNetwork().forward(new Float32Array(features.flat()),2)];
 const pool=[{actionId:'a001',originalIndex:0,canonical:normal,rawQ:rawQ[0]},{actionId:'a002',originalIndex:1,canonical:null,rawQ:rawQ[1]}].map((c,i)=>({...c,canonicalId:canonicalActionId(c.canonical),rank:i,groupId:'g'+i,groupKey:'synthetic',remainingHand:[]}));
 const ids=pool.map(c=>c.actionId),input:any={schema:'ohuo-decision-input-v1',key,policyId:basePolicy.policyId,observation:{decisionId:id,matchId,gameNo:1,moveNo:7,actorSeat:0,synthetic:id},candidateSpec:plan.identities.candidateSpecRef,initialCandidateIds:ids,pool,candidateInputs:{policyIdentity:basePolicy,encoder:b.encoder,encoderVersion:basePolicy.encoderVersion,policyId:basePolicy.policyId,inputDim:399,candidateIds:ids,candidateFeatures:features,rawQ}};
 const record:any={key,policyId:basePolicy.policyId,initialCandidateIds:ids,offeredIds:ids,requestedActionId:'a002',actualActionId:'a002',actualMove:{pass:true},actualSource:kind==='demo'?'remote':'B',status:'selected',reason:null,executionKind:'confirmed',trainingInputSHA256:dataHash(input),requests:kind==='demo'?[{...profile,requestCount:1}]:[],priorTarget:normal,events:[]};
 const match:any={schema:'ohuo-confirmed-match-v1',runId:'synthetic-run',matchId,sourceRef,layoutRef:plan.queueRef,evaluatedActor:0,split,policyIds:[basePolicy.policyId],rules:{},games:[{gameNo:1,sourceSHA256:sha(matchId),sourceFamilyId:split+'0'}],seatSnapshots:[{releaseRef:teacher.releaseRef,release:{promptRef:teacher.promptRef},policyIdentity:basePolicy,profileSnapshot:profile}],decisions:[record]};
 plan.games.push({matchId,gameNo:1,sourceFamily:split+'0',split,sourceRef:'synthetic-'+split,sourceSHA256:sha(matchId),actorSeat:0});
 rows.push({sampleKind:kind,sampleClass:kind==='demo'?'target':'ordinary',match,record,privateInput:input});
}
const sourceQueue={schema:'ohuo-complete-match-queue-v1',sourceIndexRef:sourceRef,rows:plan.games.map((g:any)=>({matchId:g.matchId,roundFamilyIds:[g.sourceFamily],split:g.split,actor:0}))};plan.queueSHA256=dataHash(sourceQueue);
const frozen=freezeDataset({plan,sourceIndexPath,sourceQueue,rows,outputDir:join(root,'dataset')});
const fixed=ref('fixed',{fixture:true}),planRef=ref('plan',{status:'incomplete'}),authorizationRef=ref('authorization',{mode:'offline_synthetic',root});
const limits={maxProviderRequests:0,maxOptimizerSteps:2,maxMatchAttempts:0,maxLabelDecisions:0,maxRunSeconds:30};
const budgetRef=ref('budget',{researchBatchId:'B10-fixture',authorizationRef,planRef,controlRoot:root,limits});
const parentPolicyRef=ref('parent',{schema:'ohuo-parent-policy-ref-v1',policyRef:descriptor.policyId,policyIdentity:basePolicy});
const datasetRef=ref('dataset',{schema:'ohuo-frozen-dataset-ref-v1',manifestSHA256:frozen.manifestSHA256});
const task:any={schemaVersion:1,taskId:'task',experimentId:'experiment',attemptId:'a1',planVersion:1,planRef,parentTaskId:null,retryReasonRef:null,researchBatchId:'B10-fixture',budgetRef,authorizationRef,taskKind:'supervised_training',capabilityRef:ref('capability',{id:'B10.supervised-rerank.v1',kind:'supervised_training',mode:'offline_synthetic'}),sourceRevision:fixed,runtimeRef:fixed,parentPolicyRef,releaseRefs:[parentPolicyRef],rulesRef:fixed,sourcePlan:{namespace:'B10-fixture',sourceIndexRef:sourceRef,familyIds:['train0'],split:'fixture'},splitRefs:[fixed],seatLayoutPlan:fixed,actorSampleRule:'evaluated-seat-only',datasetRefs:[datasetRef],labelPolicyRef:ref('teacher',teacher),promptRef:ref('prompt',{schema:'ohuo-prompt-ref-v1',promptRef:teacher.promptRef}),scientificContract:{question:'synthetic only',primaryMetricRef:fixed,analysisUnit:'decision',analysisMethodRef:fixed,comparisonRef:fixed,selectionRuleRef:fixed,readoutRuleRef:fixed,decisionRuleRef:fixed},planScope:{clauseRef:fixed,branchRef:null,prerequisiteRefs:[]},learnerRecipe:DISTILL_RECIPE,operationScope:{localExecution:true,apiCalls:false,parameterUpdates:true,deployment:false},limits,allowedBranches:[],stopPolicy:fixed,outputSpec:{trainingKind:'supervised_rerank',proposalPolicyRef:parentPolicyRef,releaseStatus:'development'},outputRoot:join(root,'runs/run'),runId:'run',taskStatus:'ready',unresolved:[]};
writeFileSync(join(root,'state.json'),JSON.stringify({schemaVersion:1,tasks:{},runs:{},budgets:{[budgetRef]:{researchBatchId:task.researchBatchId,authorizationRef,planRef,limits,used:{providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0},reservations:{},activeRunId:null,elapsedSeconds:0}},batches:{[task.researchBatchId]:{budgetRef,authorizationRef,planRef}}}));
const inputs={sourceIdentity:sourceRef,sourceIndexPath,datasetDirectory:frozen.directory,seed:7,trainingPhase:'formal'};
const adapter={resolveRef:async(r:string)=>refs.get(r),checkAuthorization:async()=>({authorizationRef,controlRoot:root,mode:'offline_synthetic',scope:task.operationScope}),checkPlan:async()=>({status:'incomplete',eligible:true}),verifyInputs:async()=>inputs};
const python=process.env.B10_TEST_PYTHON!;assert.ok(python,'explicit existing Python required');
const research=createDistillConsumer({pythonPath:python,policyRepositoryRoot:repo});await assert.rejects(research.prepare({task,refs,inputs}),(e:any)=>e.reason==='invalid_field'&&e.field==='calibrationQualification');
const consumer=createDistillConsumer({pythonPath:python,policyRepositoryRoot:repo,mode:'offline_synthetic'}),originalRun=consumer.run;const faultSteps=new Set<number>();let reconciled=false;
// Inject only a stop boundary around the real consumer, not a substitute learner.
consumer.run=async(ctx:any)=>{
 if(ctx.reconcileOnly===true){
  reconciled=true;
  const readOnly=(e:any)=>e.reason==='reconcile_read_only';
  await assert.rejects(ctx.reserve('forbidden',{providerRequests:0,optimizerSteps:1,matchAttempts:0,labelDecisions:0}),readOnly);
  await assert.rejects(ctx.commit('forbidden',ctx.checkpoint),readOnly);
  await assert.rejects(ctx.saveCheckpoint(ctx.checkpoint,999),readOnly);
  await assert.rejects(ctx.settleReservation('forbidden',{disposition:'not_sent',evidence:{kind:'confirmed_not_sent'}}),readOnly);
 }
 const boundary=new AbortController();return originalRun({...ctx,signal:AbortSignal.any([ctx.signal,boundary.signal]),commit:async(id:string,cp:any)=>{await ctx.commit(id,cp);if(!faultSteps.has(cp.optimizerSteps)&&[1,2].includes(cp.optimizerSteps)){faultSteps.add(cp.optimizerSteps);boundary.abort('fixture_committed_boundary');throw Error('fixture_crash_after_commit_before_publish');}}});};
const host=(createTaskController as any)({root,adapter,consumers:[consumer]});
const started=await host.dispatchOhuo('start',{taskRef:ref('task',task)});assert.equal(started.status,'running',JSON.stringify(started));
const terminal=async()=>{for(let i=0;i<300;i++){const status=await host.dispatchOhuo('status',{runId:'run'});if(['completed','failed','interrupted'].includes(status.status))return status;await new Promise(r=>setTimeout(r,50));}throw Error('host fixture terminal timeout');};
let status:any=await terminal();assert.equal(status.status,'failed');assert.equal(status.checkpoint?.optimizerSteps,1,JSON.stringify(status));assert.equal(JSON.parse(readFileSync(join(task.outputRoot,'latest.json'),'utf8')).optimizerSteps,0,'committed-before-publish fault leaves stale mirror');assert.equal(status.checkpoint?.optimizerSteps,1,JSON.stringify(status));assert.equal(status.consumption.confirmed.optimizerSteps,1);assert.equal(status.cleanupConfirmed,true);
const resumed=await host.dispatchOhuo('resume',{runId:'run'});assert.equal(resumed.status,'running',JSON.stringify(resumed));status=await terminal();
assert.equal(status.status,'failed',JSON.stringify(status));assert.equal(status.consumption.confirmed.optimizerSteps,2);
assert.equal(JSON.parse(readFileSync(join(task.outputRoot,'latest.json'),'utf8')).optimizerSteps,1);
// The second successful host commit exhausted the original two-step allowance.
// A third resume may ONLY reconcile that committed pointer, never add budget.
const beforeMirror=JSON.parse(readFileSync(join(root,'state.json'),'utf8'));
const repaired=await host.dispatchOhuo('resume',{runId:'run'});assert.equal(repaired.status,'running',JSON.stringify(repaired));status=await terminal();
assert.notEqual(status.status,'failed',JSON.stringify(status));assert.equal(reconciled,true);
const afterMirror=JSON.parse(readFileSync(join(root,'state.json'),'utf8'));
assert.deepEqual(afterMirror.budgets,beforeMirror.budgets,'mirror repair must not change research ledger or elapsed time');
for(const key of ['task','taskSHA256','taskRef','checkpoint','checkpointSHA256','checkpointRef','checkpointSequence','committed','elapsedSeconds'])assert.deepEqual(afterMirror.runs.run[key],beforeMirror.runs.run[key],`mirror repair changed research field ${key}`);assert.equal(status.consumption.confirmed.optimizerSteps,2);
assert.equal(JSON.parse(readFileSync(join(task.outputRoot,'latest.json'),'utf8')).optimizerSteps,2);
assert.equal(JSON.parse(readFileSync(join(task.outputRoot,'previous.json'),'utf8')).optimizerSteps,1);
assert.equal(JSON.parse(readFileSync(join(task.outputRoot,'status.json'),'utf8')).optimizerSteps,2);assert.equal(status.checkpoint.optimizerSteps,2);assert.equal(status.cleanupConfirmed,true);
assert.equal(afterMirror.runs.run.recoveryReceiptRefs.length,1);
const receiptRef=afterMirror.runs.run.recoveryReceiptRefs[0];
assert.ok(receiptRef.path.startsWith(join(task.outputRoot,'recovery-receipts')+'/'));
const receiptBytes=readFileSync(receiptRef.path);assert.equal(sha(receiptBytes),receiptRef.sha256);
const receipt=JSON.parse(receiptBytes.toString());assert.equal(receipt.schema,'ohuo-checkpoint-reconciliation-v1');
assert.equal(receipt.runId,task.runId);assert.equal(receipt.taskSHA256,afterMirror.runs.run.taskSHA256);
assert.equal(receipt.checkpointSHA256,afterMirror.runs.run.checkpointSHA256);
assert.equal(receipt.checkpointRef,afterMirror.runs.run.checkpointRef);
for(const field of ['sourceRevision','runtimeRef','planRef','planVersion'])assert.equal(receipt[field],task[field]);
assert.equal(receipt.status,'reconciled');assert.equal(receipt.cleanupConfirmed,true);
assert.equal(receipt.optimizerStepIncrement,0);assert.equal(receipt.providerRequestIncrement,0);
assert.deepEqual(receipt.consumptionBefore,receipt.consumptionAfter);
assert.equal(receipt.researchBoundaryBeforeSHA256,receipt.researchBoundaryAfterSHA256);
assert.ok(Number.isFinite(receipt.recoveryWallSeconds)&&receipt.recoveryWallSeconds>=0);
for(const name of ['latest.json','status.json','summary.json']){
 assert.equal(receipt.mirrorsAfter[name].path,join(task.outputRoot,name));
 assert.equal(receipt.mirrorsAfter[name].sha256,sha(readFileSync(join(task.outputRoot,name))));
}
assert.notEqual(receipt.mirrorsBefore['latest.json'].sha256,receipt.mirrorsAfter['latest.json'].sha256);
const summary=JSON.parse(readFileSync(join(task.outputRoot,'summary.json'),'utf8'));assert.equal(summary.actual.optimizerSteps,2);assert.equal(summary.plan.maxEpochs,3);assert.equal(summary.actual.realTraining,false);assert.equal(summary.actual.providerRequests,0);
console.log(JSON.stringify({hostStatus:status.status,committedSteps:2,diagnosticResearchRejected:true,cleanupConfirmed:true,fullConsumerConnected:true,hostSavedOneResumedOne:true,commitBeforePublishFault:true,budgetExhaustedMirrorOnly:true,researchLedgerAndTimeUnchanged:true,fourMutationsRejected:true,recoveryReceiptVerified:true,root,receiptRef}));
