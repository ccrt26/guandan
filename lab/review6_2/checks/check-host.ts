/** Actual fixed CLI boundary fixture. Every asset is synthetic; no consumer is
 * allowed to reach prepare/run, and these files confer no research authority. */
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync,symlinkSync,lstatSync,realpathSync,readdirSync,openSync,closeSync,fstatSync,ftruncateSync,writeSync,constants} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {FixedHostFiles,HOST_SOURCE_FILES} from '../ohuo-host-files';
import {canonical,referenceOf,validateTask,digest} from '../task-schema.mjs';
const selector=process.argv.slice(2);
assert.ok(selector.length===2&&selector[0]==='--case'&&['fixed-host-boundaries','acceptance-wiring'].includes(selector[1]),'exact --case fixed-host-boundaries|acceptance-wiring required');
const ROOT=resolve(fileURLToPath(new URL('../../../',import.meta.url))),CONFIG=join(ROOT,'deliverables/ohuo-runtime/host.json');
assert.ok(!existsSync(CONFIG),'never overwrite an existing operator host configuration');
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex'),req=createRequire(import.meta.url);
mkdirSync(join(ROOT,'lab/out/M0-H-development'),{recursive:true});mkdirSync(join(ROOT,'deliverables/ohuo-runtime'),{recursive:true});
const evidence:any[]=[],markers:string[]=[];
function cli(args:string[],reason?:string,env?:NodeJS.ProcessEnv){const r=spawnSync(process.execPath,['--import','tsx','lab/review6_2/ohuo-host.ts',...args],{cwd:ROOT,encoding:'utf8',timeout:15000,maxBuffer:1024*1024,...(env?{env}:{})});if(env)evidence.push({argv:args,fullArgv:[process.execPath,'--import','tsx','lab/review6_2/ohuo-host.ts',...args],cwd:ROOT,exitCode:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr,result:(()=>{try{return JSON.parse(r.stdout?.trim());}catch{return null;}})()});assert.ifError(r.error);assert.ok(!r.signal,r.stderr);const result=JSON.parse(r.stdout.trim());if(reason){assert.equal(result.reason,reason,JSON.stringify({args,result,stderr:r.stderr}));assert.equal(r.status,2);}else assert.equal(r.status,0,JSON.stringify(result));if(!env)evidence.push({argv:args,exitCode:r.status,result});return result;}
function fixture(options?:{baseCommit:string;writeConfig:(bytes:string)=>void}){
 const dir=mkdtempSync(join(ROOT,'lab/out/M0-H-development/fixture-')),root=join(dir,'control');mkdirSync(root);const refs=new Map<string,any>();let seq=0;
 const file=(name:string,value:any)=>{const p=join(dir,name),bytes=typeof value==='string'?value:canonical(value);writeFileSync(p,bytes,{mode:0o600});return{path:relative(ROOT,p),sha256:sha(bytes)};};
 const references:any[]=[],evidenceFiles:any[]=[];
 const ref=(id:string,value:any)=>{const r=referenceOf(id,value);refs.set(r,value);references.push({ref:r,file:file(`ref-${++seq}.json`,value)});return r;};
 const artifact=(id:string,value:any)=>{const f=file(`evidence-${++seq}.json`,value);evidenceFiles.push({id,file:f});return{id,sha256:f.sha256};};
 const fixed=ref('fixed',{purpose:'synthetic engineering only'}),planRef=ref('plan',{planVersion:1,purpose:'synthetic boundary check only'}),authorizationRef=ref('authorization',{purpose:'synthetic local materialization, NOT real user research authority'});
 const limits={maxProviderRequests:0,maxOptimizerSteps:0,maxMatchAttempts:1,maxLabelDecisions:0,maxRunSeconds:3};
 const budgetRef=ref('budget',{researchBatchId:'fixture',authorizationRef,planRef,controlRoot:root,limits});
 const sourceRevision=ref('source',{baseCommit:options?.baseCommit??'305ea0f87c0398d845e0b5ebc3744dc9b1520ed7',files:HOST_SOURCE_FILES.map(path=>({path,sha256:sha(readFileSync(join(ROOT,path)))}))});
 const runtimeRef=ref('runtime',{node:process.version,platform:process.platform,arch:process.arch,tsx:req('tsx/package.json').version,python:null});
 const sourceIndexFile=file('source-index.json',{version:1,families:{fixture:{split:'fixture'}}});
 const sourceIndexRef=ref('source-index',{schema:'ohuo-source-index-ref-v1',namespace:'M0H-synthetic',fileSHA256:sourceIndexFile.sha256});
 const capabilityRef=ref('capability',{id:'B07.complete-match.v1',kind:'evaluate',mode:'research'});
 const task:any={schemaVersion:1,taskId:'fixture-task',experimentId:'fixture',attemptId:'a01',planVersion:1,planRef,parentTaskId:null,retryReasonRef:null,researchBatchId:'fixture',budgetRef,authorizationRef,taskKind:'evaluate',capabilityRef,sourceRevision,runtimeRef,parentPolicyRef:fixed,releaseRefs:[fixed],rulesRef:fixed,sourcePlan:{namespace:'M0H-synthetic',sourceIndexRef,familyIds:['fixture'],split:'fixture'},splitRefs:[fixed],seatLayoutPlan:fixed,actorSampleRule:'evaluated-seat-only',datasetRefs:[],labelPolicyRef:fixed,promptRef:fixed,scientificContract:{question:'fixed CLI reject only',primaryMetricRef:fixed,analysisUnit:'complete-source-block',analysisMethodRef:fixed,comparisonRef:fixed,selectionRuleRef:fixed,readoutRuleRef:fixed,decisionRuleRef:fixed},planScope:{clauseRef:fixed,branchRef:null,prerequisiteRefs:[fixed]},learnerRecipe:null,operationScope:{localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false},limits,allowedBranches:[],stopPolicy:fixed,outputSpec:{artifactKinds:['synthetic-no-execution'],releaseStatus:'development'},outputRoot:join(root,'runs/fixture-run'),runId:'fixture-run',taskStatus:'ready',unresolved:[]};validateTask(task);
 let taskRef=ref('task',task);
 const counters={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0};
 const initial={schemaVersion:1,rootInstanceId:relative(ROOT,dir).split('/').at(-1),initialBudgetRef:budgetRef,tasks:{},runs:{},budgets:{[budgetRef]:{researchBatchId:'fixture',authorizationRef,planRef,limits,used:counters,reservations:{},activeRunId:null,elapsedSeconds:0,accountingMode:'research'}},batches:{fixture:{budgetRef,authorizationRef,planRef}}};
 const initialStateRef=ref('initial-ledger',initial),proof=artifact('local-program-proof',{synthetic:true,result:'met'});
 const receipt:any={schema:'ohuo-prerequisite-receipt-v1',planRef,planVersion:1,requirementRef:fixed,kind:'student-selection',decision:'met',evidence_refs:[proof],analysisRef:null,numerical:null};
 const grant:any={schema:'ohuo-local-research-grant-v1',authorizationRef,planRef,planVersion:1,controlRoot:relative(ROOT,root),rootInstanceId:initial.rootInstanceId,initialStateRef,initialization:'new-control-root',mode:'research',allowedTaskKinds:['evaluate'],allowedCapabilityIds:['B07.complete-match.v1'],scope:task.operationScope,limits,tasks:[{taskRef,prerequisiteReceipts:[{requirementRef:fixed,receiptRef:ref('prerequisite',receipt)}]}],approvalEvidence:file('synthetic-approval.json',{synthetic:true,warning:'not a user research approval'})};
 const closeout:any={schema:'ohuo-plan-closeout-v1',planRef,planVersion:1,status:'incomplete',inputPackageRef:null,inputManifestSHA:null,analysisRef:null,actions:[{clauseRef:fixed,branchRef:null,plannedTaskIds:[task.taskId],taskFileRefs:[taskRef],runRefs:[],status:'not_executed',evidence_refs:[],ruleRef:null,unresolved:[]}],evidence_refs:[],unresolved:[]};
 const manifest:any={schema:'ohuo-fixed-host-v1',controlRoot:relative(ROOT,root),rootInstanceId:initial.rootInstanceId,initialStateRef,references,evidenceFiles,grantFile:null,planCloseoutFile:relative(ROOT,join(dir,'current-closeout.json')),inputBindings:[{taskRef,sourceIndexFile,confirmedRecordRoots:[],datasetDirectory:null,studentReleaseFiles:[],seed:null,trainingPhase:null,numericalRestartReceiptRef:null}],profileStorePath:null,pythonPath:null};
 let revision=1;
 const write=()=>{manifest.grantFile=file('grant.json',grant);if(options)options.writeConfig(canonical(manifest));else{writeFileSync(CONFIG,canonical(manifest),{mode:0o600});chmodSync(CONFIG,0o600);}};
 const pointer=()=>{const f=file(`closeout-${++seq}.json`,closeout);file('current-closeout.json',{schema:'ohuo-current-plan-closeout-v1',planRef,planVersion:1,revision,closeout:{ref:referenceOf('closeout',closeout),file:f}});write();};
 const updateTask=()=>{taskRef=ref(`task-${seq}`,task);grant.tasks[0].taskRef=taskRef;manifest.inputBindings[0].taskRef=taskRef;closeout.actions[0].taskFileRefs=[taskRef];closeout.actions[0].plannedTaskIds=[task.taskId];revision++;pointer();};
 const updateReceipt=()=>{grant.tasks[0].prerequisiteReceipts[0].receiptRef=ref(`prerequisite-${seq}`,receipt);write();};
 const state=()=>JSON.parse(readFileSync(join(root,'state.json'),'utf8'));
 const closed=(status:string,bad=false)=>{closeout.status=status;closeout.inputPackageRef=artifact('input-package',{synthetic:true});closeout.inputManifestSHA=closeout.inputPackageRef.sha256;
  const analysis:any={decision_id:'synthetic',evidence_refs:[],finding:'synthetic boundary only',alternative_explanations:[],scientific_status:'未决',next_question:null,next_plan_delta:null,fixed_items:[],allowed_branches:[],limits_needed:[],stop_conditions:[],authorization_needed:[],analysisId:'synthetic-analysis',inputPackageRef:bad?proof:closeout.inputPackageRef,inputManifestSHA:bad?proof.sha256:closeout.inputManifestSHA,planRef,priorDecisionRef:null,requiredEvidenceStatus:'synthetic',allowedPlanClause:fixed,allowedBranchRef:null,orderedActions:[],taskFileRefs:[taskRef],remainingScope:[],remainingBudget:{},nextEvidenceBoundary:null,disposition:'STOP_AND_DISCUSS_NEW_PLAN'};
  closeout.analysisRef=artifact('final-analysis',analysis);closeout.actions[0].status=status==='completed'?'completed':'blocked';closeout.actions[0].evidence_refs=[proof];closeout.actions[0].unresolved=status==='terminated'?['synthetic stopped']:[];revision++;pointer();};
 pointer();markers.push(new FixedHostFiles(ROOT).genesisPath());
 return{dir,root,task,refs,ref,file,artifact,grant,manifest,receipt,closeout,initial,initialStateRef,proof,write,pointer,updateTask,updateReceipt,state,closed,get taskRef(){return taskRef;},setRevision(n:number){revision=n;pointer();}};
}
/** First finite acceptance wiring, not research authority or a reused M9 receipt.
 * The legacy matrix below is intentionally a separate, unexecuted branch. */
async function acceptanceWiring(){
 const allowed=['PATH','LANG','LC_ALL','LC_CTYPE','TZ'];
 const env=Object.fromEntries(allowed.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]!])),ownedMarkers=new Map<string,any>();
 let ownedConfig:any=null,pureInputs:any=null,error:any=null,cleanup:any=null;
 const roots:any[]=[],configHistory:any[]=[];
 const identity=(path:string)=>{const s=lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&realpathSync(path)===path,'regular real owned file required');return{path,sha256:sha(readFileSync(path)),bytes:s.size,dev:s.dev,ino:s.ino,mode:s.mode};};
 const unchanged=(expected:any)=>{try{return canonical(identity(expected.path))===canonical(expected);}catch{return false;}};
 const assertConfig=()=>assert.ok(ownedConfig&&unchanged(ownedConfig),'temporary host config identity conflict; preserve other writer');
 const writeConfig=(bytes:string)=>{
  const first=ownedConfig===null;if(!first)assertConfig();
  const fd=openSync(CONFIG,first?constants.O_CREAT|constants.O_EXCL|constants.O_RDWR:constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  try{
   if(!first){const s=fstatSync(fd);assert.ok(s.dev===ownedConfig.dev&&s.ino===ownedConfig.ino&&sha(readFileSync(fd))===ownedConfig.sha256,'temporary host config identity conflict; preserve other writer');assertConfig();}
   ftruncateSync(fd,0);writeSync(fd,bytes,0,'utf8');
   const s=fstatSync(fd),actual=identity(CONFIG);assert.ok(s.dev===actual.dev&&s.ino===actual.ino&&actual.sha256===sha(bytes),'temporary host config identity conflict; preserve other writer');ownedConfig=actual;configHistory.push(actual);
  }finally{closeSync(fd);}
 };
 const inventory=(dir:string):any[]=>readdirSync(dir,{withFileTypes:true}).flatMap(x=>{const p=join(dir,x.name);assert.ok(!x.isSymbolicLink(),'fixture cannot contain symlinks');return x.isDirectory()?inventory(p):[identity(p)];});
 const snapshot=(f:ReturnType<typeof fixture>)=>({root:realpathSync(f.root),state:existsSync(join(f.root,'state.json'))?{identity:identity(join(f.root,'state.json')),value:f.state()}:null,files:inventory(f.root)});
 const noExecution=(f:ReturnType<typeof fixture>)=>{
  const s=f.state();assert.deepEqual(s.budgets,f.initial.budgets,'no new budget/counter/reservation or elapsed increment');
  assert.ok(!existsSync(join(f.root,'runs')),'no consumer/run outputs');
  for(const r of Object.values(s.runs) as any[]){assert.equal(r.status,'interrupted');assert.equal(r.cleanupConfirmed,true);assert.deepEqual(r.committed,[]);assert.equal(r.checkpoint,null);assert.equal(r.checkpointRef,null);assert.equal(r.elapsedSeconds,0);}
 };
 const call=(f:ReturnType<typeof fixture>,args:string[],reason?:string)=>{
  assertConfig();const before=snapshot(f),n=evidence.length;
  try{
   const result=cli(args,reason,env);assert.equal(result.status,reason?'rejected':args[0]==='init'?'initialized':'interrupted');
   if(args[0]==='init'){
    const marker=new FixedHostFiles(ROOT).genesisPath();assert.equal(result.genesisRef.path,marker);const id=identity(marker);assert.equal(id.sha256,result.genesisRef.sha256);ownedMarkers.set(marker,id);
   }
   assertConfig();noExecution(f);return result;
  }finally{if(evidence.length>n)Object.assign(evidence[n],{before,after:snapshot(f)});}
 };
 const interrupted=(f:ReturnType<typeof fixture>)=>{const s=f.state();s.tasks[f.task.taskId]=f.task.runId;s.runs[f.task.runId]={task:f.task,taskRef:f.taskRef,taskSHA256:digest(f.task),runId:f.task.runId,status:'interrupted',cleanupConfirmed:true,checkpoint:null,checkpointRef:null,committed:[],elapsedSeconds:0};writeFileSync(join(f.root,'state.json'),canonical(s));};
 const closedObservation=(f:ReturnType<typeof fixture>,status:string)=>{
  const pointer=JSON.parse(readFileSync(join(ROOT,f.manifest.planCloseoutFile),'utf8'));
  assert.deepEqual(f.state().hostPlanObservations?.[canonical([f.task.planRef,f.task.planVersion])],{revision:pointer.revision,closeoutSHA256:pointer.closeout.file.sha256,status},'original TC must durably record the actual closed revision');
 };
 const withoutGrant=(f:ReturnType<typeof fixture>,run:()=>void)=>{
  const path=join(ROOT,f.manifest.grantFile.path);assert.ok(path.startsWith(f.dir+'/'),'only this synthetic fixture grant');const original=identity(path),bytes=readFileSync(path);rmSync(path);
  try{run();}finally{assert.ok(!existsSync(path),'synthetic grant identity conflict; do not overwrite');writeFileSync(path,bytes,{flag:'wx',mode:0o600});assert.equal(identity(path).sha256,original.sha256);}
 };
 let runtime:any=null,sources:any[]=[];
 try{
  assert.deepEqual(Object.keys(process.env).sort(),Object.keys(env).sort(),'parent must be launched with only approved environment keys; child cleanup cannot sanitize parent startup');
  runtime={node:{path:realpathSync(process.execPath),version:process.version,sha256:sha(readFileSync(realpathSync(process.execPath))),platform:process.platform,arch:process.arch},tsx:{path:realpathSync(req.resolve('tsx')),package:identity(realpathSync(req.resolve('tsx/package.json'))),version:req('tsx/package.json').version},parentEnvironment:env,childEnvironment:env,python:null};
  sources=[...new Set([...HOST_SOURCE_FILES,'lab/review6_2/checks/check-host.ts','package.json','package-lock.json','tsconfig.json','tsconfig.base.json'])].map(path=>({path,sha256:sha(readFileSync(join(ROOT,path)))}));
  const options={baseCommit:'47a7ec3cec0a1efd9729c62ad8ad230b765d26c6',writeConfig};
  const a=fixture(options);roots.push(a);call(a,['init','--state',a.initialStateRef]);
  assertConfig();const inputBefore=snapshot(a),inputs=await new FixedHostFiles(ROOT).verifyInputs(a.task,a.refs);assert.deepEqual(snapshot(a),inputBefore,'pure verifyInputs cannot mutate state');pureInputs={status:'passed',result:inputs,sourceRevision:a.refs.get(a.task.sourceRevision),runtime:a.refs.get(a.task.runtimeRef),before:inputBefore,after:snapshot(a)};
  withoutGrant(a,()=>{call(a,['start','--task',a.taskRef],'fixed_host_error');});
  a.closed('completed');const correctAnalysisRef=a.closeout.analysisRef,correctAnalysisFile=a.manifest.evidenceFiles.find((x:any)=>x.id===correctAnalysisRef.id).file;
  const correctAnalysis=JSON.parse(readFileSync(join(ROOT,correctAnalysisFile.path),'utf8')),otherInput=a.artifact('other-input-package',{synthetic:true,identity:'independent-input-package'});
  a.closeout.analysisRef=a.artifact('wrong-analysis',{...correctAnalysis,analysisId:'synthetic-wrong-analysis',inputPackageRef:otherInput,inputManifestSHA:otherInput.sha256});a.setRevision(3);
  call(a,['start','--task',a.taskRef],'plan_closeout_unverified');
  assert.equal(sha(readFileSync(join(ROOT,correctAnalysisFile.path))),correctAnalysisRef.sha256,'original valid analysis remains frozen');
  a.closeout.analysisRef=correctAnalysisRef;a.setRevision(4);interrupted(a);
  call(a,['start','--task',a.taskRef],'plan_closed');closedObservation(a,'completed');
  call(a,['resume','--run',a.task.runId],'plan_closed');closedObservation(a,'completed');
  const beforeStatus=readFileSync(join(a.root,'state.json'));
  withoutGrant(a,()=>{call(a,['status','--run',a.task.runId]);assert.deepEqual(readFileSync(join(a.root,'state.json')),beforeStatus,'status without grant must preserve whole state bytes');});
  const b=fixture(options);roots.push(b);assert.notEqual(a.root,b.root);call(b,['init','--state',b.initialStateRef]);
  b.closed('terminated');interrupted(b);call(b,['start','--task',b.taskRef],'plan_closed');closedObservation(b,'terminated');
  call(b,['resume','--run',b.task.runId],'plan_closed');closedObservation(b,'terminated');
  assert.equal(evidence.length,9);for(const f of roots)noExecution(f);
 }catch(e){const x=e as any;error={name:x.name,reason:x.reason??null,message:x.message};}
 finally{
  const conflicts=[...(ownedConfig&&!unchanged(ownedConfig)?[CONFIG]:[]),...Array.from(ownedMarkers.values()).filter(x=>!unchanged(x)).map(x=>x.path)];
  if(conflicts.length){cleanup={status:'conflict-preserved',conflicts};error??={message:'temporary file identity conflict; preserve other writer'};}
  else{
   const removed:any[]=[];if(ownedConfig){assertConfig();rmSync(CONFIG);removed.push(ownedConfig);}
   for(const id of ownedMarkers.values()){assert.ok(unchanged(id),'genesis marker identity conflict');rmSync(id.path);removed.push(id);}
   cleanup={status:'removed-owned-identities',removed};
  }
 }
 console.log(JSON.stringify({schema:'ohuo-direct-development-check-v1',caseId:'acceptance-wiring',status:error?'rejected':'passed',notResearchPermission:true,formalReceiptReuse:false,runtime,sources,pureInputs,evidence,roots:roots.map(f=>({directory:realpathSync(f.dir),root:realpathSync(f.root),initialStateRef:f.initialStateRef,final:snapshot(f)})),configHistory,genesisMarkers:Array.from(ownedMarkers.values()),cleanup,...(error?{error}:{})},null,2));
 if(error)process.exitCode=1;
}

if(selector[1]==='acceptance-wiring')await acceptanceWiring();else{
try{
 cli(['start','--wrong','x'],'invalid_cli');cli(['status','--run','run'],'fixed_host_missing');
 let f=fixture();f.closed('completed',true);
 assert.throws(()=>new FixedHostFiles(ROOT).readCloseout(),(e:any)=>e.reason==='plan_closeout_unverified','analysis must really bind the frozen input');
 f=fixture();cli(['init','--state',f.initialStateRef]);const before=f.state();cli(['init','--state',f.initialStateRef],'init_already_consumed');
 const adapter=new FixedHostFiles(ROOT);assert.equal((await adapter.checkPlan(f.task)).eligible,true,'fixed program selection requires proof, not extra Astra');
 await adapter.verifyInputs(f.task,f.refs);evidence.push({case:'pure fixed inputs positive',noConsumer:true});
 const privateDir=join(f.dir,'profile-real');mkdirSync(privateDir);writeFileSync(join(privateDir,'store.json'),'synthetic noncredential fixture',{mode:0o600});symlinkSync(privateDir,join(f.dir,'profile-link'),'dir');f.manifest.profileStorePath=relative(ROOT,join(f.dir,'profile-link/store.json'));f.write();
 assert.throws(()=>new FixedHostFiles(ROOT).profilePath(),(e:any)=>e.reason==='invalid_host_file','profile parent symlink must fail before secret bytes are read');f.manifest.profileStorePath=null;f.write();

 // One pure S selection file chain; no student weights or checkpoint are read.
 const c0={optimizerSteps:0,manifestSHA256:'0'.repeat(64)},c1={optimizerSteps:1,manifestSHA256:'1'.repeat(64)};
 const summary=f.artifact('student-summary',{schema:'ohuo-supervised-summary-v1',taskSHA256:'2'.repeat(64),plan:{phase:'formal',Uepoch:1},actual:{realTraining:true,optimizerSteps:3},selection:{allowedCheckpoints:[{checkpoint:c0,metrics:{demoCE:2,targetDisagreementCE:2}},{checkpoint:c1,metrics:{demoCE:1,keepKL:.01,targetDisagreementCE:1,keepDriftRate:.01}}]}});
 const behavior=f.artifact('student-behavior',{schema:'ohuo-distill-behavior-review-v1',taskSHA256:'2'.repeat(64),reviews:[{checkpointSHA256:c1.manifestSHA256,status:'accepted',evidence:f.proof}]});
 const selection=f.artifact('student-selection',{schema:'ohuo-student-selection-v1',rule:'section-15-unique-checkpoint',summary,behaviorReview:behavior,status:'selected',selected:c1,reason:'section15_dev_only',eligible:[c1]});
 const releaseFile=f.file('student-release.json',{policyId:'S-synthetic-not-loaded',selection,checkpoint:{sha256:c1.manifestSHA256}}),studentRef=f.ref('student-release',{schema:'ohuo-student-task-release-v1',releaseSHA256:releaseFile.sha256,policyId:'S-synthetic-not-loaded'});
 f.task.releaseRefs.push(studentRef);f.manifest.inputBindings[0].studentReleaseFiles=[{ref:studentRef,file:releaseFile}];f.updateTask();
 assert.equal(Object.keys((await new FixedHostFiles(ROOT).verifyInputs(f.task,f.refs)).studentReleasePaths).length,1);
 const behaviorFile=join(ROOT,f.manifest.evidenceFiles.find((x:any)=>x.id==='student-behavior').file.path),behaviorBytes=readFileSync(behaviorFile);writeFileSync(behaviorFile,'{}');await assert.rejects(()=>new FixedHostFiles(ROOT).verifyInputs(f.task,f.refs),(e:any)=>e.reason==='reference_identity_mismatch');writeFileSync(behaviorFile,behaviorBytes);
 f.task.releaseRefs.pop();f.manifest.inputBindings[0].studentReleaseFiles=[];f.updateTask();

 f.receipt.decision='unknown';f.updateReceipt();cli(['start','--task',f.taskRef],'prerequisites_missing');
 f.receipt.decision='met';f.receipt.kind='scientific-decision';f.updateReceipt();cli(['start','--task',f.taskRef],'prerequisites_missing');
 f.receipt.kind='student-selection';f.receipt.evidence_refs=[];f.updateReceipt();cli(['start','--task',f.taskRef],'prerequisites_missing');f.receipt.evidence_refs=[f.proof];f.updateReceipt();
 const approvalPath=join(ROOT,f.grant.approvalEvidence.path),approval=readFileSync(approvalPath);writeFileSync(approvalPath,'changed');cli(['start','--task',f.taskRef],'reference_identity_mismatch');writeFileSync(approvalPath,approval);
 f.grant.tasks=[];f.write();cli(['start','--task',f.taskRef],'authorization_unverified');f.grant.tasks=[{taskRef:f.taskRef,prerequisiteReceipts:[{requirementRef:f.task.planScope.clauseRef,receiptRef:f.ref('restored-receipt',f.receipt)}]}];
 f.grant.planVersion=2;f.write();cli(['start','--task',f.taskRef],'authorization_unverified');f.grant.planVersion=1;
 f.grant.scope={...f.task.operationScope,localExecution:false};f.write();cli(['start','--task',f.taskRef],'scope_not_authorized');f.grant.scope=f.task.operationScope;
 f.grant.allowedTaskKinds=['collect'];f.write();cli(['start','--task',f.taskRef],'authorization_unverified');f.grant.allowedTaskKinds=['evaluate'];
 f.grant.limits={...f.task.limits,maxMatchAttempts:0};f.write();cli(['start','--task',f.taskRef],'scope_not_authorized');f.grant.limits=f.task.limits;f.write();
 const source=f.task.sourceRevision;f.task.sourceRevision=f.ref('missing-source',{baseCommit:'0'.repeat(40),files:[]});f.updateTask();cli(['start','--task',f.taskRef],'input_identity_unverified');f.task.sourceRevision=source;
 const runtime=f.task.runtimeRef;f.task.runtimeRef=f.ref('wrong-runtime',{...f.refs.get(runtime),node:'v0.0.0'});f.updateTask();cli(['start','--task',f.taskRef],'input_identity_unverified');f.task.runtimeRef=runtime;f.updateTask();
 const idx=join(ROOT,f.manifest.inputBindings[0].sourceIndexFile.path),idxBytes=readFileSync(idx);writeFileSync(idx,'{}');cli(['start','--task',f.taskRef],'input_identity_unverified');writeFileSync(idx,idxBytes);
 f.setRevision(1);cli(['start','--task',f.taskRef],'plan_state_conflict');

 // Same fixed adapter derives numerical restart facts without Python, models,
 // provider calls, or letting the binding assert verified/usesBefore booleans.
 f=fixture();cli(['init','--state',f.initialStateRef]);const failedTask=structuredClone(f.task);failedTask.taskKind='supervised_training';failedTask.learnerRecipe={learningRate:1e-4};failedTask.datasetRefs=[failedTask.parentPolicyRef];const failedRef=f.ref('failed-task',failedTask);f.manifest.inputBindings.push({...f.manifest.inputBindings[0],taskRef:failedRef,seed:7});
 const fs=f.state();fs.tasks[failedTask.taskId]=failedTask.runId;fs.runs[failedTask.runId]={task:failedTask,taskRef:failedRef,status:'failed',cleanupConfirmed:true};writeFileSync(join(f.root,'state.json'),canonical(fs));
 const diagnosis=f.artifact('diagnosis',{failedTaskId:failedTask.taskId,datasetRef:failedTask.parentPolicyRef,parentPolicyRef:failedTask.parentPolicyRef,seed:7,trigger:'diagnosed_numerical_divergence',inputsCorrect:true,implementationCorrect:true,numericalDivergence:true});
 const n={failedTaskId:failedTask.taskId,failedRunId:failedTask.runId,datasetRef:failedTask.parentPolicyRef,parentPolicyRef:failedTask.parentPolicyRef,seed:7,trigger:'diagnosed_numerical_divergence',inputImplementationReviewRef:diagnosis,metricsRef:null};
 const nr=f.ref('numerical-receipt',{...f.receipt,kind:'numerical-restart',numerical:n});const restart={...failedTask,taskId:'restart',runId:'restart',parentTaskId:failedTask.taskId,retryReasonRef:nr,planScope:{...failedTask.planScope,branchRef:failedTask.planScope.clauseRef},learnerRecipe:{learningRate:3e-5},allowedBranches:[{evidenceRef:nr}]};const binding={seed:7,numericalRestartReceiptRef:nr};const entry={prerequisiteReceipts:[{receiptRef:nr}]};f.write();
 const numerical=()=>(new FixedHostFiles(ROOT) as any).numericalRestart(restart,entry,binding);
 assert.equal(numerical().verified,true);assert.equal(numerical().usesBefore,0);
 binding.seed=8;assert.throws(numerical,(e:any)=>e.reason==='branch_evidence_unverified');binding.seed=7;
 fs.runs.used={task:{...restart,runId:'prior-restart'}};writeFileSync(join(f.root,'state.json'),canonical(fs));assert.throws(numerical,(e:any)=>e.reason==='branch_evidence_unverified');
 evidence.push({case:'original numerical diagnosis and same failed seed, then consumed branch refused',actualPythonStarts:0});
 // Closed new starts and existing-run resumes use the actual production CLI.
 for(const terminal of ['completed','terminated']){
  f=fixture();cli(['init','--state',f.initialStateRef]);const s=f.state();s.tasks[f.task.taskId]=f.task.runId;s.runs[f.task.runId]={task:f.task,taskRef:f.taskRef,taskSHA256:digest(f.task),runId:f.task.runId,status:'interrupted',cleanupConfirmed:true,checkpoint:null,checkpointRef:null,committed:[],elapsedSeconds:0};writeFileSync(join(f.root,'state.json'),canonical(s));
  f.closed(terminal);cli(['start','--task',f.taskRef],'plan_closed');cli(['resume','--run',f.task.runId],'plan_closed');const anchored=f.state();
  f.task.taskId='new-task';f.task.runId='new-run';f.task.outputRoot=join(f.root,'runs/new-run');f.updateTask();cli(['start','--task',f.taskRef],'plan_closed');
  f.closeout.status='incomplete';f.closeout.actions[0].status='not_executed';f.closeout.actions[0].unresolved=[];f.setRevision(1);cli(['start','--task',f.taskRef],'plan_closed');
  const grantPath=join(ROOT,f.manifest.grantFile.path),grantBytes=readFileSync(grantPath);rmSync(grantPath);
  const beforeStatus=readFileSync(join(f.root,'state.json'));assert.equal(cli(['status','--run','fixture-run']).status,'interrupted');assert.equal(cli(['stop','--run','fixture-run']).status,'interrupted');assert.deepEqual(readFileSync(join(f.root,'state.json')),beforeStatus,'status and already-stopped stop do not write');assert.deepEqual(f.state().budgets,anchored.budgets);assert.deepEqual(f.state().hostPlanObservations,anchored.hostPlanObservations);writeFileSync(grantPath,grantBytes,{mode:0o600});
 }
 for(const badFields of [{tasks:null},{runs:[]}]){
  const invalid=fixture(),initialRef=invalid.ref('invalid-genesis',{...invalid.initial,...badFields});invalid.manifest.initialStateRef=initialRef;invalid.grant.initialStateRef=initialRef;invalid.write();
  cli(['init','--state',initialRef],'initialization_invalid');assert.ok(!existsSync(join(invalid.root,'state.json')));assert.ok(!existsSync(new FixedHostFiles(ROOT).genesisPath()),'invalid explicit null/array cannot consume genesis marker');
 }
 f=fixture();cli(['start','--task',f.taskRef],'budget_state_missing');cli(['init','--state',f.initialStateRef]);rmSync(join(f.root,'state.json'));cli(['start','--task',f.taskRef],'budget_state_missing');cli(['init','--state',f.initialStateRef],'init_already_consumed');
 f=fixture();mkdirSync(join(f.root,'runs'));writeFileSync(join(f.root,'runs/old'),'synthetic previous run marker');cli(['init','--state',f.initialStateRef],'initialization_not_empty');
 f=fixture();cli(['init','--state',f.initialStateRef]);mkdirSync(join(f.root,'runs'));writeFileSync(join(f.root,'runs/old'),'synthetic');cli(['start','--task',f.taskRef],'state_history_conflict');
 console.log(JSON.stringify({schema:'ohuo-direct-development-check-v1',caseId:'fixed-host-boundaries',status:'passed',actualConsumerStarts:0,actualRequests:0,actualOptimizerSteps:0,actualMatches:0,evidence},null,2));
}finally{if(existsSync(CONFIG))rmSync(CONFIG);for(const marker of markers)if(existsSync(marker))rmSync(marker);}
}
