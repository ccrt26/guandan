import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
const schemaURL=new URL('../task-schema.mjs',import.meta.url), controlURL=new URL('../task-control.mjs',import.meta.url);
assert.ok(existsSync(schemaURL),'B06 strict task-schema must be implemented');
assert.ok(existsSync(controlURL),'B06 persistent task control must be implemented');
const {validateTask,canonical,referenceOf}=await import(schemaURL);
const {createTaskController}=await import(controlURL);
const {simulatedConsumer}=await import('./fixtures/task-consumer.mjs');
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const args=process.argv.slice(2);
assert.equal(args.length,2,'only --case <fixed-selector>');assert.equal(args[0],'--case');
const caseId=args[1];assert.ok(['task-lifecycle','task-conflict','unsupported-field','shared-budget'].includes(caseId),'unknown case');
const evidence=[];
const record=(label,value)=>{evidence.push({label,...value});};
const sha=x=>createHash('sha256').update(x).digest('hex');
async function fixture(options={}){
 mkdirSync(join(ROOT,'lab/out'),{recursive:true});
 const root=mkdtempSync(join(ROOT,'lab/out/B06-control-'));
 const refs=new Map();const ref=(id,value)=>{const r=referenceOf(id,value);refs.set(r,value);return r;};
 const sourceFiles=['lab/review6_2/task-schema.mjs','lab/review6_2/task-control.mjs','lab/review6_2/task-consumer.mjs','lab/review6_2/ohuo-run.mjs','lab/review6_2/writer-lock.ts','lab/review6/owned-process-group.mjs','lab/review6_2/checks/fixtures/task-consumer.mjs'];
 const sourceRevision=ref('source',{baseCommit:'47a7ec3cec0a1efd9729c62ad8ad230b765d26c6',files:sourceFiles.map(path=>({path,sha256:sha(readFileSync(join(ROOT,path)))}))});
 const runtimeRef=ref('runtime',{node:process.version,platform:process.platform,arch:process.arch});
 const fixed=ref('fixed',{purpose:'B06 fixture only; no scientific content'});
 const authorizationRef=ref('authorization',{mode:'offline_synthetic',controlRoot:root,origin:'B06 approved synthetic engineering check, not research authorization'});
 const planRef=ref('plan',{planVersion:1,mode:'offline_synthetic'});
 const budgetRef=ref('budget',{researchBatchId:'fixture-batch',authorizationRef,planRef,controlRoot:root,limits:{maxProviderRequests:options.budgetRequests??7,maxOptimizerSteps:0,maxMatchAttempts:0,maxLabelDecisions:0,maxRunSeconds:20}});
 const capabilityRef=ref('capability',{id:'B06.synthetic-probe.v1',kind:'probe',mode:'offline_synthetic'});
 const sourcePath=join(root,'source-index.json');writeFileSync(sourcePath,JSON.stringify({version:1,families:{fixture:{split:'fixture',firstSource:'B06'}}}));
 const sourceIndexRef=ref('source-index',{namespace:'B06-fixture',familyIds:['fixture'],split:'fixture',indexSHA256:sha(readFileSync(sourcePath))});
 const task={schemaVersion:1,taskId:'task-1',experimentId:'experiment-1',attemptId:'a01',planVersion:1,planRef,parentTaskId:null,retryReasonRef:null,researchBatchId:'fixture-batch',budgetRef,authorizationRef,
 taskKind:'probe',capabilityRef,sourceRevision,runtimeRef,parentPolicyRef:fixed,releaseRefs:[fixed],rulesRef:fixed,
 sourcePlan:{namespace:'B06-fixture',sourceIndexRef,familyIds:['fixture'],split:'fixture'},splitRefs:[fixed],seatLayoutPlan:fixed,actorSampleRule:'evaluated-seat-only',datasetRefs:[],labelPolicyRef:fixed,promptRef:fixed,
 scientificContract:{question:'Synthetic task control only; no science inference',primaryMetricRef:fixed,analysisUnit:'complete-source-block',analysisMethodRef:fixed,comparisonRef:fixed,selectionRuleRef:fixed,readoutRuleRef:fixed,decisionRuleRef:fixed},
 planScope:{clauseRef:fixed,branchRef:null,prerequisiteRefs:[fixed]},learnerRecipe:null,
 operationScope:{localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false},limits:{maxProviderRequests:3,maxOptimizerSteps:0,maxMatchAttempts:0,maxLabelDecisions:0,maxRunSeconds:10},allowedBranches:[],stopPolicy:fixed,
 outputSpec:{artifactKinds:['synthetic-checkpoint'],releaseStatus:'development'},outputRoot:join(root,'runs/run-1'),runId:'run-1',taskStatus:'ready',unresolved:[]};
 const counters={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0};
 writeFileSync(join(root,'state.json'),JSON.stringify({schemaVersion:1,tasks:{},runs:{},budgets:{[budgetRef]:{researchBatchId:'fixture-batch',authorizationRef,planRef,limits:refs.get(budgetRef).limits,used:counters,reservations:{},activeRunId:null,elapsedSeconds:0}},batches:{'fixture-batch':{budgetRef,authorizationRef,planRef}}}));
 const planStatusPath=join(root,'plan-closeout.json');writeFileSync(planStatusPath,JSON.stringify({planRef,planVersion:1,status:'incomplete',eligible:true,missing:[]}));
 let authorized=true,identity=true,calls=0;
 const raw=simulatedConsumer(options);
 const consumer={...raw,async run(x){calls++;return raw.run(x);}};
 const adapter={resolveRef:async r=>{if(!refs.has(r))throw Error('fixed reference unavailable');return refs.get(r);},
  checkAuthorization:async t=>authorized?{authorizationRef:t.authorizationRef,controlRoot:root,scope:{...t.operationScope},mode:'offline_synthetic'}:null,
  checkPlan:async t=>{const p=JSON.parse(readFileSync(planStatusPath));return p.planRef===t.planRef&&p.planVersion===t.planVersion?p:null;},
  verifyInputs:async t=>{const source=refs.get(t.sourceRevision),runtime=refs.get(t.runtimeRef),index=refs.get(t.sourcePlan.sourceIndexRef);
   if(!identity||runtime.node!==process.version||source.files.some(f=>sha(readFileSync(join(ROOT,f.path)))!==f.sha256)||sha(readFileSync(sourcePath))!==index.indexSHA256)return null;
   const actual=JSON.parse(readFileSync(sourcePath));if(t.sourcePlan.familyIds.some(id=>actual.families[id]?.split!=='fixture'))return null;
   return {sourceIndexPath:sourcePath,sourceIdentity:sourceIndexRef};}};
 const controller=()=>createTaskController({root,adapter,consumers:[consumer]});let c=controller();
 const submit=async(t=task,instance=c)=>instance.dispatchOhuo('start',{taskRef:ref(`task-${refs.size}`,t)});
 const status=()=>c.dispatchOhuo('status',{runId:task.runId});
 const until=async(predicate,maxPolls=200)=>{for(let n=0;n<maxPolls;n++){const s=await status();if(predicate(s))return s;await new Promise(r=>setTimeout(r,10));}throw Error('fixture state deadline exceeded');};
 const stop=()=>c.dispatchOhuo('stop',{runId:task.runId});
 const read=()=>JSON.parse(readFileSync(join(root,'state.json'),'utf8'));
 return {root,task,refs,ref,submit,status,until,stop,read,get c(){return c;},restart(){c=controller();},closed(x){const p=JSON.parse(readFileSync(planStatusPath));p.status=x?'completed':'incomplete';writeFileSync(planStatusPath,JSON.stringify(p));},eligible(x){const p=JSON.parse(readFileSync(planStatusPath));p.eligible=x;p.missing=x?[]:['teacher_qualification'];writeFileSync(planStatusPath,JSON.stringify(p));},authorized(x){authorized=x;},identity(x){identity=x;},calls:()=>calls,controller};
}
if(caseId==='task-lifecycle'){
 const f=await fixture();validateTask(f.task);
 const [started,concurrent]=await Promise.all([f.submit(),f.submit()]);assert.equal(started.status,'running');assert.equal(concurrent.runId,started.runId);
 const sentinel=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/task-consumer.mjs',import.meta.url)),'--fixed-child'],{stdio:['ignore','ignore','ignore','ipc']});
 try{
 const repeated=await f.submit();assert.equal(repeated.runId,started.runId);assert.equal(f.calls(),1);
 await f.until(s=>s.checkpoint?.cursor===1);
 const stopped=await f.stop();assert.equal(stopped.status,'interrupted');assert.equal(stopped.checkpoint.cursor,1);assert.doesNotThrow(()=>process.kill(sentinel.pid,0),'stop must not touch a non-owned process');
 assert.equal(f.read().budgets[f.task.budgetRef].used.providerRequests,1);
 assert.equal((await f.stop()).status,'interrupted');
 f.restart();assert.equal((await f.status()).checkpoint.cursor,1);
 const {runCli}=await import('../ohuo-run.mjs');assert.equal((await runCli(['status','--state-root',f.root,'--run',f.task.runId])).checkpoint.cursor,1);
 f.closed(true);assert.equal((await f.c.dispatchOhuo('resume',{runId:f.task.runId})).reason,'plan_closed');assert.equal((await f.status()).status,'interrupted');
 const fresh={...f.task,taskId:'closed-new',runId:'closed-new',attemptId:'a02',parentTaskId:f.task.taskId,retryReasonRef:f.task.planScope.clauseRef,outputRoot:join(f.root,'runs/closed-new')};
 assert.equal((await f.submit(fresh)).reason,'plan_closed');
 f.closed(false);f.eligible(false);assert.equal((await f.c.dispatchOhuo('resume',{runId:f.task.runId})).reason,'prerequisites_missing');
 f.eligible(true);const resumed=await f.c.dispatchOhuo('resume',{runId:f.task.runId});assert.equal(resumed.status,'running');
 const finished=await f.until(s=>s.status==='completed');assert.equal(finished.checkpoint.cursor,3);assert.deepEqual(finished.checkpoint.committedIds,['step-1','step-2','step-3']);
 assert.equal(f.read().budgets[f.task.budgetRef].used.providerRequests,3);assert.equal(f.calls(),2);
 assert.equal(sha(Buffer.from(canonical(JSON.parse(readFileSync(finished.checkpointRef,'utf8'))))),finished.checkpointSHA256);
 assert.equal((await f.c.dispatchOhuo('resume',{runId:f.task.runId})).status,'completed');
 assert.equal(readdirSync(f.root).some(p=>p.endsWith('.writer-lock')),false);
 const crashed=await fixture({exitBeforeReply:true});await crashed.submit();
 const failed=await crashed.until(s=>s.status==='failed',400);assert.match(failed.failureReason,/fixture child/);assert.equal(failed.cleanupConfirmed,true);assert.equal(failed.ownedCleanup.confirmedBy,'owned-child-exit-no-descendants');
 assert.equal((await crashed.stop()).status,'failed');assert.doesNotThrow(()=>process.kill(sentinel.pid,0),'failed child cleanup must not touch unrelated process');
 record('actual start, stop, committed resume', {root:f.root,started,stopped,finished,unrelatedProcessSurvived:true,earlyChildExit:{root:crashed.root,terminal:failed}});
 }finally{const exited=new Promise(r=>sentinel.once('exit',r));sentinel.kill('SIGTERM');await exited;}
}
if(caseId==='task-conflict'){
 const f=await fixture();await f.submit();
 assert.equal((await f.submit({...f.task,limits:{...f.task.limits,maxProviderRequests:2}})).reason,'task_conflict');assert.equal(f.calls(),1);
 await f.until(s=>s.checkpoint?.cursor===1);await f.stop();f.identity(false);
 assert.equal((await f.c.dispatchOhuo('resume',{runId:f.task.runId})).reason,'input_identity_unverified');
 const changed={...f.task,taskId:'task-2',runId:'run-2',attemptId:'a02',parentTaskId:f.task.taskId,retryReasonRef:f.task.planScope.clauseRef,budgetRef:f.ref('other-budget',{wrong:true}),outputRoot:join(f.root,'runs/run-2')};
 f.identity(true);assert.equal((await f.submit(changed)).reason,'budget_binding_conflict');
 assert.equal((await f.c.dispatchOhuo('status',{runId:'absent'})).reason,'unknown_run');
 for(const action of ['status','stop','resume'])assert.equal((await f.c.dispatchOhuo(action,{runId:['run-1']})).reason,'invalid_field');
 const persisted=f.read();persisted.runs['run-1'].checkpoint.cursor=2;writeFileSync(join(f.root,'state.json'),JSON.stringify(persisted));
 assert.equal((await f.c.dispatchOhuo('resume',{runId:f.task.runId})).reason,'checkpoint_identity_mismatch');
 record('conflicts refused before extra consumer', {root:f.root,consumerCalls:f.calls(),terminal:await f.status()});
}
if(caseId==='unsupported-field'){
 const cliURL=new URL('../ohuo-run.mjs',import.meta.url);assert.ok(existsSync(cliURL),'fixed import-safe CLI required');
 const {runCli}=await import(cliURL);assert.equal((await runCli(['start','--cmd','echo-nope'])).reason,'invalid_cli');
 const f=await fixture();
 const mutations=[{...f.task,max_updates_rule:'eval(100)'},{...f.task,limits:{...f.task.limits,arbitrary:1}},{...f.task,taskKind:'rl_continue'},{...f.task,sourceRevision:null},{...f.task,limits:{...f.task.limits,maxRunSeconds:null}},{...f.task,learnerRecipe:{recipeId:'shell',command:'echo nope'}}];
 for(const t of mutations){const r=await f.submit(t);assert.equal(r.status,'rejected');}
 assert.equal((await f.submit({...f.task,taskKind:'collect'})).reason,'capability_planned');
 const training={...f.task,taskKind:'supervised_training',outputSpec:{trainingKind:'supervised_rerank',proposalPolicyRef:f.task.parentPolicyRef,releaseStatus:'development'},datasetRefs:[f.task.parentPolicyRef],operationScope:{...f.task.operationScope,parameterUpdates:true},learnerRecipe:{recipeId:'supervised-rerank-v1',optimizer:'RMSprop',alpha:.9,eps:.00001,momentum:0,centered:false,weightDecay:0,learningRate:.0001,temperature:1,keepWeight:1,demoBatch:32,keepBatch:32,maxEpochs:3,initialization:'fixed-parent-new-optimizer'}};
 assert.equal((await f.submit(training)).reason,'capability_planned');
 assert.equal((await f.submit({...f.task,operationScope:{...f.task.operationScope,localExecution:false}})).reason,'scope_not_supported');
 f.authorized(false);assert.equal((await f.submit()).reason,'authorization_unverified');f.authorized(true);
 f.eligible(false);assert.equal((await f.submit()).reason,'prerequisites_missing');f.eligible(true);
 const unknown=f.ref('missing-later',{x:1});f.refs.delete(unknown);assert.equal((await f.submit({...f.task,parentPolicyRef:unknown})).reason,'reference_unavailable');
 const taskFile=join(f.root,'input-task.json');writeFileSync(taskFile,canonical(f.task));
 const command=[fileURLToPath(cliURL),'start','--state-root',f.root,'--task-file',taskFile,'--sha256',sha(readFileSync(taskFile))];
 const cli=spawnSync(process.execPath,command,{encoding:'utf8',shell:false});assert.equal(cli.status,2);assert.equal(JSON.parse(cli.stdout).reason,'capability_planned');
 assert.equal((await runCli(['resume','--state-root',f.root,'--run','run-1','--updates','100'])).reason,'invalid_cli');
 assert.equal(f.calls(),0);assert.deepEqual(f.read().runs,{});
 record('strict rejection without consumers',{root:f.root,consumerCalls:f.calls(),variants:mutations.length+7});
}
if(caseId==='shared-budget'){
 const f=await fixture();await f.submit();
 const child={...f.task,taskId:'task-2',runId:'run-2',attemptId:'a02',parentTaskId:f.task.taskId,retryReasonRef:f.task.planScope.clauseRef,outputRoot:join(f.root,'runs/run-2')};
 assert.equal((await f.submit(child)).reason,'budget_busy');
 await f.until(s=>s.checkpoint?.cursor===1);await f.stop();const before=f.read().budgets[f.task.budgetRef].used.providerRequests;
 const second=await f.submit(child);assert.equal(second.sharedBudget.used.providerRequests,before);
 const stopped=await f.c.dispatchOhuo('stop',{runId:'run-2'});assert.equal(stopped.status,'interrupted');
 const g=await fixture({holdReserved:true});await g.submit();
 for(let i=0;i<100&&!Object.keys(g.read().budgets[g.task.budgetRef].reservations).length;i++)await new Promise(r=>setTimeout(r,10));
 await g.stop();const ledger=g.read().budgets[g.task.budgetRef];assert.equal(ledger.used.providerRequests,0);assert.equal(Object.values(ledger.reservations)[0].status,'reserved_unknown');
 assert.equal((await g.c.dispatchOhuo('resume',{runId:g.task.runId})).reason,'execution_uncertain');
 const h=await fixture({budgetRequests:1});await h.submit();const boundary=await h.until(s=>s.status==='interrupted'||s.status==='failed');
 assert.equal(boundary.status,'interrupted');assert.equal(boundary.stopReason,'run_boundary');assert.equal(boundary.sharedBudget.used.providerRequests,1);assert.equal(boundary.sharedBudget.remaining.providerRequests,0);
 assert.equal((await h.c.dispatchOhuo('resume',{runId:h.task.runId})).reason,'run_boundary');
 record('shared budget preserved and unknown occupancy held',{root:f.root,before,after:f.read().budgets[f.task.budgetRef],unknownRoot:g.root,unknownLedger:ledger});
}
console.log(JSON.stringify({caseId,status:'passed',inputRef:{path:'lab/review6_2/checks/check-task.mjs',sha256:sha(readFileSync(fileURLToPath(import.meta.url)))},evidence}));
