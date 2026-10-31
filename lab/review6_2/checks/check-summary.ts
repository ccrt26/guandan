import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=resolve(new URL('../../../',import.meta.url).pathname);
const selected=process.argv[process.argv.indexOf('--case')+1];
assert(['paired-counts','missing-block','plan-closeout'].includes(selected),'explicit --case paired-counts|missing-block|plan-closeout required');
const review=process.argv.includes('--review')?process.argv[process.argv.indexOf('--review')+1]:null;
assert(review===null||['R1','R2','R3','R4','R5'].includes(review),'unknown review regression');
const section=process.argv.includes('--section')?process.argv[process.argv.indexOf('--section')+1]:null;
assert(section===null||selected==='missing-block'&&['context-bindings','distribution-ref'].includes(section),'unknown check section');
const modulePath=join(root,'lab/review6_2/paired-summary.ts');
let mod:any;try{mod=await import(modulePath);}catch(e:any){assert.fail('paired summary implementation required: '+e.code);}
const evidence=await import('../research-evidence');
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
const ref=(id:string)=>({id,sha256:sha(id)});
function fixture(){
 const families=['family-a','family-b'];
 const plan:any={schema:'ohuo-paired-plan-v1',comparison:'H-B',variantB:'B',variantCandidate:'H',familyIds:families,split:'dev',metric:'cooperation',seed:123,statisticName:'cooperation',analysisUnit:'complete-source-block',analysisMethod:'r6-paired-percentile-type7-20k-v1',question:'teacher_increment',layoutIdentitySHA256:{},refs:Object.fromEntries(['plan','queue','sourceIndex','conditions','selectionHistory','authorization','budget','parentPackage'].map(id=>[id,ref(id)]))};
 const queue:any={schema:'ohuo-complete-match-queue-v1',namespace:'fixture',sourceIndexRef:'sourceIndex',rows:[]};
 const index:any={version:1,families:{}};const attempts:any[]=[];
 for(const [f,family]of families.entries()){
  index.families[family]={split:'dev'};
  for(let group=0;group<3;group++)for(let side=0;side<2;side++)for(const variant of ['B','H']){
   const matchId=`${family}-${group}-${side}-${variant}`;
   const row:any={matchId,layoutId:`${group}-${side}-${variant}`,sourceFamilyId:family,split:'dev',seed:42+f,dealNamespace:'fixture',roundFamilyIds:[family],actor:side,metric:'cooperation',group,side,variant,maxGames:1,maxMovesPerGame:1,seats:Array.from({length:4},(_,i)=>({releaseRef:i===side?variant:i===(side+2)%4?'partner-'+group:'O',mode:i===side&&variant==='H'?'hybrid':'local',profileRevisionRef:i===side&&variant==='H'?{id:'profile',revision:1}:null}))};queue.rows.push(row);plan.layoutIdentitySHA256[row.layoutId]=sha(row.layoutId);
   attempts.push({runId:'run',matchId,sourceRef:'sourceIndex',layoutRef:'queue',state:'completed',complete:true,winner:variant==='H'&&f===0?side:1-side,incompleteReason:null,recordVerified:true,actualRoundFamilies:[family],activeMatchLoopMs:50,identitySHA256:sha(row.layoutId),resultIdentity:Object.fromEntries(['layoutId','sourceFamilyId','actor','metric','group','side','variant'].map(k=>[k,row[k]])),recordRef:ref(matchId),wallMs:100,decisions:[{id:matchId+':0',status:'selected',executionKind:'confirmed',elapsedMs:2,requests:variant==='H'?[{requestCount:1}]:[]}],issues:[]});
  }
 }
 return{plan,queue,index,attempts};
}
if(section||selected==='plan-closeout'){await closeoutChecks();process.exit(0);}
const f=fixture();
if(selected==='paired-counts'){
 const s=mod.summarizePaired(f.plan,f.queue,f.index,f.attempts);
 assert.equal(s.actual.completeBlocks,2);assert.equal(s.primary.point,.5);assert.deepEqual(s.blocks.map((x:any)=>x.difference),[1,0]);
 assert.deepEqual(s.primary.input.columns,{macro:[1,0],group0:[1,0],group1:[1,0],group2:[1,0]});
 const copied=structuredClone(f.attempts);for(const a of copied)a.decisions.push(...structuredClone(a.decisions));
 const again=mod.summarizePaired(f.plan,f.queue,f.index,copied);assert.equal(again.actual.completeBlocks,2);assert.equal(again.primary.point,.5);assert.equal(again.cost.confirmedActions,24);
 assert.equal(s.cost.decisionWaitMs.total,48);assert.equal(s.cost.upstreamRequests.total,12);assert.equal(s.cost.matchWallMs.total,2400);
 const output=resolve(process.env.GD_TASK_OUTPUT_ROOT??join(root,'lab/out','b08-'+selected+'-'+Date.now()+'-'+process.pid));mkdirSync(output,{recursive:true});
 const stats=mod.runFrozenInterval(s.primary.input,output,process.env.B08_PYTHON??'python3');assert.equal(stats.independentUnits,2);assert.equal(stats.columns.macro.point,.5);assert.equal(stats.seed,s.primary.input.seed);assert.deepEqual(stats.probabilities,[.025,.975]);assert.equal(stats.replicates,20000);
 assert.deepEqual(JSON.parse(readFileSync(join(output,'paired-stats-input.json'),'utf8')),s.primary.input);
 console.log(JSON.stringify({case:selected,scope:'direct-development',completeBlocks:2,point:.5,seed:stats.seed,interval:stats.columns.macro.quantiles,statsSourceSHA256:stats.sourceSHA256}));
}else{
 f.plan.familyIds.push('family-c');f.index.families['family-c']={split:'dev'};
 const rows=f.queue.rows.filter((x:any)=>x.sourceFamilyId==='family-a').map((r:any)=>({...structuredClone(r),matchId:r.matchId.replace('family-a','family-c'),sourceFamilyId:'family-c',seed:44,roundFamilyIds:['family-c']}));f.queue.rows.push(...rows);
 f.attempts[0].decisions.push({id:'failure',status:'fallback',executionKind:'confirmed',elapsedMs:5,requests:[{requestCount:1},{requestCount:null}]});
 f.attempts.push({runId:'run',matchId:rows[0].matchId,sourceRef:'sourceIndex',layoutRef:'queue',state:'stopped',complete:false,winner:null,incompleteReason:'user_stop',recordVerified:true,recordRef:ref('stopped'),wallMs:null,decisions:[{id:'pending',status:'cancelled',executionKind:'none',elapsedMs:null,requests:[{requestCount:null}]}],issues:[]});
 const s=mod.summarizePaired(f.plan,f.queue,f.index,f.attempts);assert.equal(s.actual.completeBlocks,2);assert.equal(s.actual.incompleteBlocks,1);assert.equal(s.actual.notStartedMatches,11);assert.equal(s.blocks[2].difference,null);assert.equal(s.primary.point,.5);assert.equal(s.cost.upstreamRequests.total,null);assert.equal(s.cost.upstreamRequests.known,13);assert.equal(s.cost.upstreamRequests.unknown,2);assert.equal(s.cost.decisionWaitMs.total,null);assert.equal(s.cost.decisionWaitMs.known,53);assert.equal(s.cost.fallbackDecisions,1);assert.equal(s.cost.cancelledDecisions,1);
 // Duplicate attempts must remain visible, never select the better one.
 const duplicate=mod.summarizePaired(f.plan,f.queue,f.index,[...f.attempts,structuredClone(f.attempts[0])]);assert.equal(duplicate.actual.completeBlocks,1);assert(duplicate.blocks[0].issues.some((i:string)=>i.includes('multiple_attempts')));
 const bad=structuredClone(f);bad.queue.rows[1].seed=99;const mismatch=mod.summarizePaired(bad.plan,bad.queue,bad.index,bad.attempts);assert.equal(mismatch.actual.completeBlocks,1);
 const wrongAncestry=structuredClone(f);wrongAncestry.attempts[0].actualRoundFamilies=['wrong-family'];assert.equal(mod.summarizePaired(wrongAncestry.plan,wrongAncestry.queue,wrongAncestry.index,wrongAncestry.attempts).actual.completeBlocks,1);
 const facts:any={packageId:'fixture-package',question:'teacher_increment',background:{goal:'fixture only',stage:'3',changes:['none'],completed:['fixtures'],remaining:['Mac read-only rebuild'],forbidden:['new matches','model calls']},requiredEvidence:[{id:'conditions',source:f.plan.refs.conditions,mandatory:true,status:'NOT_TRANSFERRED',checkedLocations:['Mac fixed ref'],owner:'Sol',authorizationRef:f.plan.refs.authorization.id,dependencies:['existing fixed file'],prerequisitesMet:null}],files:[]};
 const pack=evidence.buildEvidencePackage(f.plan,s,facts);assert(pack.missingItems.some((i:any)=>i.evidenceId==='conditions'&&i.missingKind==='NOT_TRANSFERRED'));assert.notEqual(pack.completeness,'complete');assert.equal(pack.researchQualified,null);assert.notEqual(pack.transportStatus,'READY');
 assert.throws(()=>evidence.buildEvidencePackage(f.plan,s,{...facts,background:{...facts.background,apiKey:'secret'}}),/unknown|forbidden/);
 // Read a tiny synthetic B07 journal without ever opening private files.
 const output=resolve(process.env.GD_TASK_OUTPUT_ROOT??join(root,'lab/out','b08-'+selected+'-'+Date.now()+'-'+process.pid));const runDir=join(output,'source-run'),matchDir=join(runDir,'matches','one');mkdirSync(matchDir,{recursive:true});
 const identity={runId:'source-run',matchId:'one',sourceRef:'sourceIndex',layoutRef:'queue',policyIds:['B','O','partner','O'],rules:{fixture:true},seatSnapshots:[{releaseRef:'B'},{releaseRef:'O'},{releaseRef:'partner'},{releaseRef:'O'}],privateNeverExport:'not shared'};
 const idBytes=JSON.stringify(identity);writeFileSync(join(matchDir,'identity.json'),idBytes);
 const key={matchId:'one',gameNo:1,moveNo:0,actorSeat:0,requestSeq:0,controllerOrRunnerGeneration:'fixture'};
 const pending={key,status:'pending',executionKind:'none',elapsedMs:null,requests:[]};const confirmed={...pending,status:'selected',executionKind:'confirmed',elapsedMs:2,actualMove:{pass:true},requests:[{requestCount:1,usage:{total_tokens:3}}]};
 const terminal={complete:true,winner:0,incompleteReason:null};const journal=[{type:'game',value:{gameNo:1,sourceFamilyId:'family-a'}},{type:'decision',value:pending},{type:'decision',value:confirmed},{type:'decision',value:confirmed},{type:'summary',value:terminal}].map(x=>JSON.stringify(x)+'\n').join('');writeFileSync(join(matchDir,'events.jsonl'),journal);
 const recordRef={directory:matchDir,identitySHA256:sha(idBytes),journalSHA256:sha(journal),journalBytes:Buffer.byteLength(journal)};
 const run={schema:'ohuo-match-summary-v1',runId:'source-run',taskId:'task',taskSHA256:sha('task'),queueRef:'queue',matches:[{matchId:'one',recordRef,result:{...terminal,wallSeconds:.125}}],activeMatch:null,executionUnknown:false,consumption:{}};
 const runBytes=JSON.stringify(run);const runPath=join(runDir,'summary.json');writeFileSync(runPath,runBytes);const read=mod.readB07Run(runPath,sha(runBytes));assert.equal(read.attempts[0].decisions.length,1);assert.equal(read.attempts[0].complete,true);assert.equal(read.attempts[0].wallMs,null);assert.equal(read.attempts[0].activeMatchLoopMs,125);assert.deepEqual(read.attempts[0].actualRoundFamilies,['family-a']);
 assert.equal(readFileSync(join(matchDir,'events.jsonl'),'utf8'),journal);assert(!JSON.stringify(read).includes('privateNeverExport'));
 // R1: an interrupted B07 match appends another summary after resume.
 const readJournalVariant=(events:any[])=>{const bytes=events.map(x=>JSON.stringify(x)+'\n').join('');writeFileSync(join(matchDir,'events.jsonl'),bytes);const variant=structuredClone(run);variant.matches[0].recordRef.journalSHA256=sha(bytes);variant.matches[0].recordRef.journalBytes=Buffer.byteLength(bytes);const json=JSON.stringify(variant);writeFileSync(runPath,json);return mod.readB07Run(runPath,sha(json)).attempts[0];};
 const resumedKey={...key,moveNo:1,requestSeq:1,controllerOrRunnerGeneration:'resumed'},resumedPending={...pending,key:resumedKey},resumedConfirmed={...confirmed,key:resumedKey};
 const priorEvents=[{type:'game',value:{gameNo:1,sourceFamilyId:'family-a'}},{type:'decision',value:pending},{type:'decision',value:confirmed},{type:'summary',value:{complete:false,winner:null,incompleteReason:'user_stop'}}];
 const resumedEvents=[...priorEvents,{type:'decision',value:resumedPending},{type:'decision',value:resumedConfirmed},{type:'summary',value:terminal}];
 assert.equal(readJournalVariant(resumedEvents).complete,true,'stopped then resumed complete journal is a valid B07 evolution');
 assert.equal(readJournalVariant([...resumedEvents,{type:'summary',value:{...terminal,winner:1}}]).recordVerified,false);
 assert.equal(readJournalVariant([...resumedEvents,{type:'decision',value:resumedConfirmed}]).recordVerified,false);
 assert.equal(readJournalVariant([...priorEvents,{type:'summary',value:terminal}]).recordVerified,false,'cannot manufacture a winner without resumed confirmed action');
 writeFileSync(join(matchDir,'events.jsonl'),journal);writeFileSync(runPath,runBytes);
 // One changed byte cannot be used as a new winning outcome.
 writeFileSync(join(matchDir,'events.jsonl'),journal+' ');const invalid=mod.readB07Run(runPath,sha(runBytes));assert.equal(invalid.attempts[0].complete,false);assert.equal(invalid.attempts[0].recordVerified,false);writeFileSync(join(matchDir,'events.jsonl'),journal);
 const manifest=evidence.writeEvidencePackage(join(output,'package'),f.plan,s,facts,[read.run]);assert.equal(manifest.transportStatus,'LOCAL_ONLY');for(const file of manifest.files)assert.equal(sha(readFileSync(join(output,'package',file.artifact),'utf8')),file.sha256);
 assert(!readFileSync(join(output,'package','summary.json'),'utf8').includes('privateNeverExport'));assert.throws(()=>evidence.writeEvidencePackage(join(output,'package'),f.plan,s,facts),/new package/);
 // End-to-end local rebuild preserves missing ledger values as unknown.
 const store=(name:string,value:any)=>{const bytes=JSON.stringify(value),path=join(output,name);writeFileSync(path,bytes);return {path,sha256:sha(bytes)};};
 const qref=store('queue.json',f.queue),iref=store('index.json',f.index);const localPlan=structuredClone(f.plan);localPlan.refs.queue.sha256=qref.sha256;localPlan.refs.sourceIndex.sha256=iref.sha256;
 const pref=store('plan.json',localPlan),inventory=store('inventory.json',{schema:'ohuo-run-inventory-v1',runs:[{runId:'source-run',sha256:sha(runBytes)}]});
 const rebuilt=evidence.rebuildEvidence({plan:pref,queue:qref,sourceIndex:iref,runInventory:inventory,runs:[{path:runPath,sha256:sha(runBytes)}],facts},join(output,'rebuild'),'not-executed-no-complete-blocks');
 assert.equal(rebuilt.summary.cost.requestReconciliation.ledgerConfirmed,null);assert.equal(rebuilt.summary.cost.upstreamRequests.total,null);assert.equal(rebuilt.summary.actual.unplannedAttempts,1);assert.equal(rebuilt.manifest.sourceInputs.analysisPlan.sha256,pref.sha256);
 const missingInventory=store('missing-inventory.json',{schema:'ohuo-run-inventory-v1',runs:[{runId:'missing-run',sha256:sha('missing')}]});
 const missingRun=evidence.rebuildEvidence({plan:pref,queue:qref,sourceIndex:iref,runInventory:missingInventory,runs:[{path:join(output,'unavailable-summary.json'),sha256:sha('missing')}],facts},join(output,'missing-run-package'),'not-executed');
 assert.equal(missingRun.summary.actual.notStartedMatches,null);assert.equal(missingRun.summary.cost.upstreamRequests.total,null);assert.equal(missingRun.summary.actual.completeBlocks,0);assert(JSON.parse(readFileSync(join(output,'missing-run-package','missing-items.json'),'utf8')).some((i:any)=>i.evidenceId==='run:missing-run'&&i.missingKind==='UNLOCATED'));
 // R2: the entire missing run contributes unknown, not zero, to every cost.
 for(const metric of ['decisionWaitMs','matchWallMs','activeMatchLoopMs','upstreamRequests','mainRequests','expansionRequests']){assert.equal(missingRun.summary.cost[metric].total,null,metric+' total must remain unknown');assert(missingRun.summary.cost[metric].unknown>0,metric+' requires missing-source count');assert.equal(missingRun.summary.cost[metric].known,0);}
 for(const value of Object.values(missingRun.summary.cost.usage) as any[]){assert.equal(value.total,null);assert(value.unknown>0);}
 const missingIndex=JSON.parse(readFileSync(join(output,'missing-run-package','evidence-index.json'),'utf8'));assert(missingIndex.unresolved.unknownCosts.waiting>0);assert(missingIndex.unresolved.unknownCosts.wall>0);
 console.log(JSON.stringify({case:selected,scope:'direct-development',completeBlocks:2,incompleteBlocks:1,unstarted:11,missing:pack.missingItems.length,unknownRequests:2}));
}

/** Approved B08 r3 synthetic fixtures only. No controller, kernel, model or API. */
async function closeoutChecks(){
 const {canonical,digest,referenceOf,validateTask}=await import('../task-schema.mjs');
 const output=resolve(process.env.GD_TASK_OUTPUT_ROOT??join(root,'lab/out','b08-r3-'+(section??selected)+'-'+Date.now()+'-'+process.pid));mkdirSync(output,{recursive:true});
 const evidenceLog:any[]=[];let sequence=0;
 function setup(variant='normal'){
  const dir=join(output,String(sequence++)+'-'+variant);mkdirSync(dir,{recursive:true});const files:any[]=[],requirements:any[]=[],values=new Map<string,any>();
  const put=(id:string,value:any,artifact=id+'.json')=>{const bytes=JSON.stringify(value,null,2)+'\n',path=join(dir,id.replaceAll('/','_')+'.json');writeFileSync(path,bytes);const r={id,sha256:sha(bytes)};files.push({...r,version:1,artifact,purpose:id,publicShareable:true,libraryFileId:null,localPath:path});values.set(id,value);return r;};
  const cr=(id:string,value:any)=>{put(id,value);return referenceOf(id,value);};
  const require=(id:string,source:any,status='received')=>requirements.push({id,source,mandatory:true,status,checkedLocations:['fixed fixture catalog'],owner:'Sol',authorizationRef:'fixture-approval',dependencies:[],prerequisitesMet:true});
  const fixed=cr('fixed',{fixture:true});const rule=cr('readout-rule',{kind:'original-execution-readout',failureAllowed:true});const skipRule=cr('skip-rule',{kind:'original-conditional-branch',condition:'not selected'});const stopRule=cr('stop-rule',{kind:'original-hard-stop',reason:['nonrunner-branch-stop','unproved-branch-stop'].includes(variant)?'no_candidate':'budget_exhausted'});
  const clause=cr('clause',{action:'trial'}),later=cr('later',{action:'later'}),branch=cr('conditional',{action:'conditional'});
  const original:any={planVersion:1,firstRound:false,controlRoots:['fixture-root'],stopPolicy:stopRule,actions:[
   {clauseRef:clause,branchRef:null,plannedTaskIds:['t1'],dependencyRefs:[],expectedArtifactKinds:['trial-result'],acceptanceRuleRef:rule,skipRuleRef:null,stopRuleRef:stopRule},
   {clauseRef:later,branchRef:null,plannedTaskIds:['later'],dependencyRefs:[],expectedArtifactKinds:['trial-result'],acceptanceRuleRef:rule,skipRuleRef:null,stopRuleRef:stopRule},
   {clauseRef:branch,branchRef:skipRule,plannedTaskIds:[],dependencyRefs:[],expectedArtifactKinds:['branch-decision'],acceptanceRuleRef:rule,skipRuleRef:variant==='no-skip-rule'?null:skipRule,stopRuleRef:stopRule}
  ]};
  if(['complete','science-lost','unexecuted-planned','stage-optional','teacher-stage'].includes(variant))original.actions.splice(1,1);
  if(['nonrunner-stop','nonrunner-branch-stop','unproved-branch-stop'].includes(variant))original.actions[1].plannedTaskIds=[];
  if(variant==='unexecuted-planned')original.actions[0].plannedTaskIds.push('required-second');
  if(variant==='no-actions')delete original.actions;
  const planBytes=put('approved-plan',original),planRef=referenceOf('approved-plan',original),parent=put('parent-package',{packageId:'parent-package',planRef,purpose:'prior-stage'});
  const source={baseCommit:'a'.repeat(40),files:[{path:'lab/review6_2/example.ts',sha256:sha('accepted source')}]},sourceRef=cr('source',source),otherSource=cr('other-source',{...source,files:[{...source.files[0],sha256:sha('other source')}]});
  const runtime=cr('runtime',{node:process.version,platform:process.platform,arch:process.arch}),capability=cr('capability',{id:'fixture.probe',kind:'probe',mode:'offline_synthetic'});
  const index=put('source-index',{version:1,families:{'family-a':{split:variant==='confirmation-selection'?'sealed':'dev',ancestors:[]},...(variant==='producer-summary'?{'family-b':{split:'dev',ancestors:[]}}:{})}});const sourceIndex=cr('source-index-ref',{schema:'ohuo-source-index-ref-v1',namespace:'fixture',fileSHA256:index.sha256});
  const counters=(n=0)=>({providerRequests:n,optimizerSteps:0,matchAttempts:0,labelDecisions:0});const limits={maxProviderRequests:['terminated','nonrunner-stop'].includes(variant)?2:10,maxOptimizerSteps:0,maxMatchAttempts:0,maxLabelDecisions:0,maxRunSeconds:100};
  const budget=cr('budget',{researchBatchId:'batch',authorizationRef:fixed,planRef,controlRoot:'fixture-root',limits});
  const makeTask=(id:string,parentTaskId:string|null=null)=>({schemaVersion:1,taskId:id,experimentId:'experiment',attemptId:id,planVersion:1,planRef,parentTaskId,retryReasonRef:parentTaskId?rule:null,researchBatchId:'batch',budgetRef:budget,authorizationRef:fixed,taskKind:'probe',capabilityRef:capability,sourceRevision:variant==='accepted-mismatch'?otherSource:sourceRef,runtimeRef:runtime,parentPolicyRef:fixed,releaseRefs:[fixed],rulesRef:fixed,sourcePlan:{namespace:'fixture',sourceIndexRef:sourceIndex,familyIds:['family-a'],split:'dev'},splitRefs:[fixed],seatLayoutPlan:fixed,actorSampleRule:'evaluated-seat-only',datasetRefs:[],labelPolicyRef:fixed,promptRef:fixed,scientificContract:{question:'context binding fixture',primaryMetricRef:fixed,analysisUnit:'complete-source-block',analysisMethodRef:fixed,comparisonRef:fixed,selectionRuleRef:rule,readoutRuleRef:rule,decisionRuleRef:rule},planScope:{clauseRef:clause,branchRef:null,prerequisiteRefs:[]},learnerRecipe:null,operationScope:{localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false},limits,allowedBranches:[],stopPolicy:stopRule,outputSpec:{artifactKinds:['trial-result'],releaseStatus:'development'},outputRoot:'lab/out/fixture/'+id,runId:'run-'+id,taskStatus:'ready',unresolved:[]});
  let producerQueueRef:string|null=null;let indexEvidence=index;
  if(variant==='producer-summary'){const queue=fixture().queue;queue.sourceIndexRef=sourceIndex;producerQueueRef=cr('producer-queue',queue);const qfile=files.find(f=>f.id==='producer-queue');files.push({...qfile,id:producerQueueRef});const ifile=files.find(f=>f.id===index.id);files.push({...ifile,id:sourceIndex});indexEvidence={id:sourceIndex,sha256:index.sha256};}
  const tasks:any[]=[makeTask('t1'),makeTask('t2','t1')];if(producerQueueRef)tasks.forEach(t=>{t.seatLayoutPlan=producerQueueRef;t.sourcePlan.familyIds=['family-a','family-b'];});if(variant==='extra-task')tasks.push({...makeTask('extra'),planScope:{clauseRef:fixed,branchRef:null,prerequisiteRefs:[]}});
  if(section==='distribution-ref'){
   const studentSelection=put('student-selection',{schema:'ohuo-student-selection-v1',rule:'section-15-unique-checkpoint',status:'selected',selected:{manifestSHA256:sha('checkpoint')}});
   const student=put('student-release',{schema:'ohuo-student-release-v1',trainingKind:'supervised_rerank',policyId:'S',scorer:{weightsSHA256:sha('weights')},checkpoint:{path:'checkpoint.json',sha256:sha('checkpoint')},proposer:{identity:{policyId:'B'}},selection:studentSelection});
   const studentRef=cr('student-task-ref',{schema:'ohuo-student-task-release-v1',policyId:'S',releaseSHA256:student.sha256});
   const proposer=cr('proposer',{schema:'ohuo-release-ref-v1',policyIdentity:{policyId:'B'}}),teacher=cr('teacher',{schema:'ohuo-offline-teacher-ref-v1',releaseRef:fixed,profileRevisionRef:{id:'teacher',revision:1}});
   const key={matchId:'m',gameNo:1,moveNo:0,actorSeat:0,requestSeq:0,controllerOrRunnerGeneration:'fixture'};
   const queue=cr('diagnostic-queue',{schema:'ohuo-complete-match-queue-v1',namespace:'fixture',sourceIndexRef:sourceIndex,rows:[{matchId:'m',actor:0,split:'dev',roundFamilyIds:['family-a'],seats:[{releaseRef:studentRef,mode:'local',profileRevisionRef:null}]}]});
   const selection=cr('diagnostic-selection',{schema:'ohuo-offline-label-selection-v1',sourceIndexRef:sourceIndex,queueRef:queue,purpose:'distribution_diagnostic',selectedCount:1,quotas:[{familyId:'family-a',count:1}],rows:[{recordRef:{directory:'private-original',identitySHA256:sha('identity')},recordRoot:'private-original',key,inputSHA256:sha('input'),familyId:'family-a',split:'dev',actorSeat:0}]});
   const t=tasks[1];Object.assign(t,{taskKind:'collect',datasetRefs:[selection],seatLayoutPlan:queue,parentPolicyRef:proposer,labelPolicyRef:teacher,releaseRefs:[studentRef,fixed]});
   const offline=put('offline-summary',{schema:'ohuo-offline-label-summary-v1',runId:t.runId,taskSHA256:digest(t),selectionRef:selection,purpose:'distribution_diagnostic',cursor:1,total:1,rows:[{key,inputSHA256:sha('input'),familyId:'family-a',split:'dev',actorSeat:0,actingPolicyId:'S',proposalPolicyIdentity:{policyId:'B'},actingReleaseRef:studentRef,studentReleaseSHA256:student.sha256,scorerWeightsSHA256:sha('weights'),studentCheckpointSHA256:sha(variant==='distribution-mismatch'?'wrong-checkpoint':'checkpoint'),actualActionId:'move-a',teacherActionId:'move-b',teacherReleaseRef:fixed,inInitialCandidateSet:true,actionAgreement:false,status:'selected',reason:null,labelKind:'offline_suggested',requestCount:1,resultRef:{path:'/private/original/labels/q0.json',sha256:sha('private-not-read')} }],executionUnknown:false,consumption:{confirmed:counters(1),reserved:counters(),reservedUnknown:counters(),released:counters()},interpretation:'teacher suggestions only, never executed; no strength or training qualification claim'});require('newDistribution',offline);
   if(variant==='private-label'){const privateRef={id:'private-label',sha256:sha('not-read')};files.push({...privateRef,version:1,artifact:'labels/q0.json',purpose:'private offline label',publicShareable:true,libraryFileId:null,localPath:join(dir,'absent-private-label.json')});}
  }
  if(variant==='confirmation-selection')tasks.forEach(t=>t.sourcePlan.split='confirm');
  if(['stage-optional','teacher-stage'].includes(variant))tasks.forEach(t=>{t.taskKind='evaluate';t.scientificContract.question=variant==='stage-optional'?'student_match':'teacher_increment';});
  tasks.forEach(validateTask);const taskRefs=tasks.map(t=>cr('task-'+t.taskId,t));
  const artifacts=tasks.map(t=>put('result-'+t.taskId,{kind:'trial-result',taskId:t.taskId,runId:t.runId,outcome:t.taskId==='t1'?'failed':'completed'}));
  const runs:any={},reservations:any={};tasks.forEach((t,i)=>{const checkpoint={cursor:1},checkpointRef=put('checkpoint-'+t.taskId,checkpoint);const reservationId=t.runId+':step';reservations[reservationId]={runId:t.runId,key:'step',cost:counters(1),status:'committed'};runs[t.runId]={runId:t.runId,taskRef:taskRefs[i],taskSHA256:digest(t),task:t,status:i===0?'failed':'completed',committed:[reservationId],checkpoint,checkpointSHA256:digest(checkpoint),checkpointRef:'checkpoint-'+t.taskId+'.json',consumerArtifactRefs:[{path:'result-'+t.taskId+'.json',sha256:artifacts[i].sha256,purpose:'trial-result'}],elapsedSeconds:1,stopReason:['terminated','nonrunner-stop'].includes(variant)&&i===1?'budget_exhausted':null,failureReason:i===0?'synthetic_failed_attempt':null,cleanupConfirmed:true};});
  if(variant==='active-unknown'){runs['run-t2'].status='running';runs['run-t2'].cleanupConfirmed=false;reservations['run-t2:pending']={runId:'run-t2',key:'pending',cost:counters(1),status:'reserved_unknown'};}
  const state:any={schemaVersion:1,rootInstanceId:'fixture-root',tasks:Object.fromEntries(tasks.map(t=>[t.taskId,t.runId])),runs,budgets:{[budget]:{researchBatchId:'batch',authorizationRef:fixed,planRef,limits,used:counters(tasks.length),reservations,activeRunId:variant==='active-unknown'?'run-t2':null,elapsedSeconds:tasks.length}},batches:{batch:{budgetRef:budget,authorizationRef:fixed,planRef}}};
  if(variant==='missing-run')delete state.runs['run-t2'];
  if(section==='distribution-ref'){const f=files.find(f=>f.id==='offline-summary');state.runs['run-t2'].consumerArtifactRefs.push({path:f.artifact,sha256:f.sha256,purpose:'original public diagnostic'});}
  const runRefs=tasks.filter(t=>runs[t.runId]).map(t=>{const consumption={confirmed:counters(1),reserved:counters(),reservedUnknown:counters(variant==='active-unknown'&&t.taskId==='t2'?1:0),released:counters()};return put('run-snapshot-'+t.taskId,variant==='producer-summary'?{schema:'ohuo-match-summary-v1',runId:t.runId,taskId:t.taskId,taskSHA256:digest(t),queueRef:t.seatLayoutPlan,matches:[],activeMatch:null,executionUnknown:false,consumption}:{...runs[t.runId],consumption});});
  if(variant==='producer-summary')for(const t of tasks){const r=runRefs.find(r=>values.get(r.id).runId===t.runId),file=files.find(f=>f.id===r.id);state.runs[t.runId].consumerArtifactRefs.push({path:file.artifact,sha256:r.sha256,purpose:'actual public match summary'});}
  const stateRef=put('control-state',state);
  const inventory=put('run-inventory',{schema:'ohuo-run-inventory-v1',runs:tasks.map((t,i)=>({runId:t.runId,sha256:runRefs[i]?.sha256??sha('missing-run')}))});
  const allRuns=put('all-runs',{planRef,controlStateRefs:[stateRef],runInventoryRef:inventory,runRefs});require('allTaskRuns',allRuns);
  const prior=put('prior-analysis',{analysisId:'analysis-prior',decision_id:'decision-prior',inputPackageRef:variant==='empty-prior'?null:variant==='parent-conflict'?{id:'other-parent',sha256:sha('other')}:parent,inputManifestSHA:parent.sha256,planRef:variant==='plan-conflict'?fixed:planRef,priorDecisionRef:null,allowedPlanClause:clause,allowedBranchRef:null,orderedActions:[{clauseRef:clause,branchRef:null,taskFileRefs:taskRefs}],taskFileRefs:taskRefs,disposition:'CONTINUE_APPROVED_PLAN',evidence_refs:[parent]});require('priorDecision',prior);
  const receipt=put('accepted-code',{schemaVersion:1,kind:'functional-acceptance',functionalStatus:'accepted',batchId:'B08-fixture',revision:1,acceptedCodeRef:source,checkReceiptRefs:[{path:'checks.json',sha256:sha('{}\n')}]});put('checks',{},'checks.json');
  // Existing M9 shape: delivery-state acceptanceRef and engineering-batch sourceRef.
  const delivery=put('delivery-state',{acceptanceRef:variant==='candidate-unaccepted'?null:{path:'accepted-code.json',sha256:receipt.sha256}}),engineering=put('engineering-batch',{batchId:'B08-fixture',revision:1,baseCommit:source.baseCommit,acceptedParentRef:{commit:source.baseCommit},dependsOn:[],checkPlan:{sourceRef:source}});
  const accepted=put('accepted-program',{deliveryStateRef:delivery,engineeringBatchRef:engineering});require('acceptedProgram',accepted);
  const history=put('selection-history',{planRef,selectionRuleRef:rule,readoutRuleRef:rule,entries:tasks.map((t,i)=>({kind:'development',taskFileRef:taskRefs[i],runId:t.runId,checkpointRef:'checkpoint-'+t.taskId+'.json',selected:t.taskId==='t2',excludedReasonRef:t.taskId==='t1'?rule:null})),selectedTeacherRef:tasks[1].labelPolicyRef,selectedStudentRef:section==='distribution-ref'?tasks[1].releaseRefs[0]:null});
  if(variant==='science-lost')require('selectionHistory',history,'LOST_IRRECOVERABLE');else if(variant!=='missing-history')require('selectionHistory',history);
  const context=put('plan-context',{planRef,planVersion:1,firstRound:false,firstRoundRuleRef:null,parentPackageRefs:[parent],priorDecisionRef:prior,taskFileRefs:taskRefs});require('planContext',context);require('sourceIndex',indexEvidence);
  const acceptance=put('action-acceptance',{planRef,clauseRef:clause,branchRef:null,ruleRef:rule,outcome:'completed',taskFileRefs:taskRefs.filter((_:any,i:number)=>tasks[i].taskId!=='extra'),runIds:['run-t1','run-t2'],evidence_refs:artifacts.slice(0,2)});
  const skip=put('skip-receipt',{planRef,clauseRef:branch,branchRef:skipRule,ruleRef:skipRule,outcome:'skipped_with_rule',triggerEvidenceRefs:[parent]});
  const accounting=put('stage-accounting',{planRef,actions:[{clauseRef:clause,branchRef:null,acceptanceRef:acceptance,skipRef:null},{clauseRef:branch,branchRef:skipRule,acceptanceRef:null,skipRef:skip}]});require('stageAccounting',accounting);
  const terminalAnalysis=variant==='nonrunner-branch-stop'?put('terminal-analysis',{...values.get('prior-analysis'),analysisId:'terminal-analysis',decision_id:'terminal-decision',priorDecisionRef:prior,allowedPlanClause:later,allowedBranchRef:null,orderedActions:[],disposition:'STOP_AND_DISCUSS_NEW_PLAN',scientific_status:'未决',finding:'Original no-candidate branch reached',stop_conditions:[stopRule]}):null;
  const stop=variant==='unproved-branch-stop'?put('stop-receipt',{planRef,ruleRef:stopRule,trigger:'no_candidate',runIds:[],evidence_refs:[parent]}):terminalAnalysis?put('stop-receipt',{planRef,ruleRef:stopRule,trigger:'no_candidate',runIds:[],evidence_refs:[terminalAnalysis]}):['terminated','nonrunner-stop'].includes(variant)?put('stop-receipt',{planRef,ruleRef:stopRule,trigger:'budget_exhausted',runIds:['run-t2'],evidence_refs:[artifacts[1]]}):null;const budgetStop=put('budget-stop',{planRef,stopRef:stop});require('budgetStop',budgetStop);
  const facts:any={packageId:'fixture-'+variant,question:'plan_closeout',background:{goal:'synthetic binding check',stage:'C01',changes:['no scientific change'],completed:['synthetic original trial'],remaining:['no new execution'],forbidden:['model calls','training','matches']},requiredEvidence:requirements,files};
  const local=(r:any)=>{const f=files.find(f=>f.id===r.id);return {path:f.localPath,sha256:f.sha256};};
  const stoppedAnalysis=put('stopped-analysis',{...values.get('prior-analysis'),analysisId:'analysis-rejected',decision_id:'decision-rejected',priorDecisionRef:prior,orderedActions:[],disposition:'BLOCKED'});
  const spec={plan:local(planBytes),controlStates:[local(stateRef)],taskFiles:taskRefs.map(r=>local(files.find(f=>r.startsWith(f.id+'@')))),packageManifests:[local(parent)],analyses:[local(prior),local(stoppedAnalysis),...(terminalAnalysis?[local(terminalAnalysis)]:[])],facts};
  const pairedPlan:any={...fixture().plan,refs:{...fixture().plan.refs,plan:planBytes,parentPackage:parent,sourceIndex:indexEvidence,selectionHistory:history,...(producerQueueRef?{queue:{id:producerQueueRef,sha256:files.find(f=>f.id===producerQueueRef).sha256}}:{})},question:'teacher_increment'};
  return {dir,put,require,files,facts,spec,inventory,plan:original,planRef,pairedPlan,state,stateRef,taskRefs,runRefs,summary:{sourceInputs:{runInventory:{sha256:inventory.sha256},runs:values.get('run-inventory').runs},runFacts:runRefs.map(r=>{const value=values.get(r.id);return {runId:value.runId,taskId:value.taskId??value.task.taskId,taskSHA256:value.taskSHA256,source:r};}),engineeringStatus:null,absorptionStatus:null,blocks:[],deviations:[],cost:{upstreamRequests:{unknown:0},decisionWaitMs:{unknown:0},matchWallMs:{unknown:0}}}};
 }
 if(review){
  if(review==='R1'&&section==='distribution-ref'){
   const f=setup('normal');f.facts.question='teacher_increment';for(const id of evidence.QUESTION_EVIDENCE.teacher_increment)if(!f.facts.requiredEvidence.some((r:any)=>r.id===id)){const r=f.put('required-'+id,{planRef:f.planRef});f.require(id,r);}
   const current=f.files.find((x:any)=>x.id==='offline-summary'),good=evidence.buildEvidencePackage(f.pairedPlan,f.summary,f.facts);assert.equal(good.completeness,'complete',JSON.stringify(good.missingItems));
   const alternate=JSON.parse(readFileSync(current.localPath,'utf8'));alternate.rows[0].teacherActionId=alternate.rows[0].actualActionId;alternate.rows[0].actionAgreement=true;
   const alternateRef=f.put('alternate-offline-summary',alternate);f.facts.requiredEvidence.find((r:any)=>r.id==='newDistribution').source=alternateRef;
   const bad=evidence.buildEvidencePackage(f.pairedPlan,f.summary,f.facts);assert.equal(bad.completeness,'incomplete');assert(bad.missingItems.some((x:any)=>x.evidenceId==='newDistribution'&&x.issues.includes('distribution_summary_state_artifact_conflict')),'independent diagnostic bytes must be committed by the same frozen run, even with identical run/task/selection/counts');
   assert.equal(sha(readFileSync(current.localPath,'utf8')),current.sha256,'original summary remains readable and unchanged');evidenceLog.push({review,section,current:{id:current.id,sha256:current.sha256},stateConsumerArtifactRefs:f.state.runs['run-t2'].consumerArtifactRefs,alternateRef,modifiedOnly:'teacherActionId move-b -> move-a; actionAgreement false -> true',good:good.completeness,bad:bad.completeness,missing:bad.missingItems});
  }else if(review==='R1'){
   const f=setup('producer-summary');f.facts.question='teacher_increment';for(const id of evidence.QUESTION_EVIDENCE.teacher_increment)if(!f.facts.requiredEvidence.some((r:any)=>r.id===id)){const r=f.put('required-'+id,{planRef:f.planRef});f.require(id,r);}
   const q=fixture().queue;q.sourceIndexRef=f.pairedPlan.refs.sourceIndex.id;const qr=f.put('queue',q);f.pairedPlan.refs.queue={id:f.pairedPlan.refs.queue.id,sha256:qr.sha256};const pr=f.put('paired-plan',f.pairedPlan);const index=f.files.find((x:any)=>x.id==='source-index');
   const local=(r:any)=>{const file=f.files.find((x:any)=>x.id===r.id);return {path:file.localPath,sha256:r.sha256};};
   const input={plan:local(pr),queue:local(qr),sourceIndex:{path:index.localPath,sha256:index.sha256},runInventory:local(f.inventory),runs:f.runRefs.map(local),facts:f.facts};
   const unrelated=setup('normal');unrelated.facts.question='teacher_increment';evidence.rebuildEvidence({...input,facts:unrelated.facts},join(unrelated.dir,'actual-disconnected'),'NO_KERNEL_ALLOWED');
   assert(JSON.parse(readFileSync(join(unrelated.dir,'actual-disconnected/missing-items.json'),'utf8')).some((x:any)=>x.evidenceId==='allTaskRuns'),'actual spec run hashes must match background allTaskRuns, not merely internal background consistency');
   const good=evidence.rebuildEvidence(input,join(f.dir,'paired-good'),'NO_KERNEL_ALLOWED');const goodIndex=JSON.parse(readFileSync(join(f.dir,'paired-good/evidence-index.json'),'utf8'));
   assert(!JSON.parse(readFileSync(join(f.dir,'paired-good/missing-items.json'),'utf8')).some((x:any)=>x.evidenceId==='allTaskRuns'),'real B07 public shape must bind without fictitious M0 fields');
   const wrong=f.put('actual-other-inventory',{schema:'ohuo-run-inventory-v1',runs:[{runId:'run-t1',sha256:f.runRefs[0].sha256}]});const bad=evidence.rebuildEvidence({...input,runInventory:local(wrong),runs:[input.runs[0]]},join(f.dir,'paired-mismatch'),'NO_KERNEL_ALLOWED');
   const missing=JSON.parse(readFileSync(join(f.dir,'paired-mismatch/missing-items.json'),'utf8'));assert(missing.some((x:any)=>x.evidenceId==='allTaskRuns'),'actual spec inventory cannot differ from background');assert.notEqual(bad.manifest.completeness,'complete');assert.equal(bad.summary.actual.notStartedMatches,null);assert(bad.summary.cost.upstreamRequests.unknown>0);
   const currentFile=f.files.find((x:any)=>x.id===f.runRefs[0].id),staleValue=JSON.parse(readFileSync(currentFile.localPath,'utf8'));staleValue.consumption.confirmed.providerRequests=0;
   const staleRef=f.put('same-run-old-summary',staleValue),staleRuns=[staleRef,f.runRefs[1]],staleInventory=f.put('same-run-old-inventory',{schema:'ohuo-run-inventory-v1',runs:staleRuns.map(r=>({runId:JSON.parse(readFileSync(local(r).path,'utf8')).runId,sha256:r.sha256}))});
   const staleAll=f.put('same-run-old-all-runs',{planRef:f.planRef,controlStateRefs:[f.stateRef],runInventoryRef:staleInventory,runRefs:staleRuns}),staleFacts=structuredClone(f.facts);staleFacts.requiredEvidence.find((x:any)=>x.id==='allTaskRuns').source=staleAll;
   const stale=evidence.rebuildEvidence({...input,runInventory:local(staleInventory),runs:staleRuns.map(local),facts:staleFacts},join(f.dir,'paired-stale-same-identity'),'NO_KERNEL_ALLOWED'),staleMissing=JSON.parse(readFileSync(join(f.dir,'paired-stale-same-identity/missing-items.json'),'utf8'));
   assert(staleMissing.some((x:any)=>x.evidenceId==='allTaskRuns'&&x.issues.includes('run_snapshot_state_conflict')),'same run/task identity does not authorize stale summary bytes absent from frozen consumerArtifactRefs');assert.notEqual(stale.manifest.completeness,'complete');
   evidenceLog.push({review,good:good.manifest.completeness,goodRequired:goodIndex.required,bad:bad.manifest.completeness,missing,stale:stale.manifest.completeness,staleMissing});
  }else if(review==='R2'){
   for(const variant of ['stage-optional','teacher-stage']){const f=setup(variant);for(const id of ['pairing','confirmationIsolation','waiting','behaviorRegression'])f.facts.requiredEvidence.push({id,source:null,mandatory:false,status:'UNLOCATED',checkedLocations:[],owner:'DOT',authorizationRef:'fixture',dependencies:[],prerequisitesMet:null});
    const r=evidence.rebuildPlanCloseout(f.spec,join(f.dir,'package'));assert.equal(r.closeout.status,'completed');assert.equal(r.manifest.completeness,'incomplete');const required=JSON.parse(readFileSync(join(f.dir,'package/evidence-index.json'),'utf8')).required;
    if(variant==='stage-optional')for(const id of ['pairing','confirmationIsolation','waiting','behaviorRegression']){assert(required.includes(id));assert(r.summary.scientificUnresolved.some((m:any)=>m.evidenceId===id));}
    else for(const id of ['dataset','training','newDistribution','behaviorRegression','confirmationIsolation'])assert(!required.includes(id),'teacher stage cannot acquire student-only requirements: '+id);
    evidenceLog.push({review,variant,status:r.closeout.status,required,scientificUnresolved:r.summary.scientificUnresolved});
   }
  }else if(review==='R3'){
   for(const variant of ['nonrunner-stop','nonrunner-branch-stop','unproved-branch-stop']){const f=setup(variant),r=evidence.rebuildPlanCloseout(f.spec,join(f.dir,'package'));assert.equal(r.closeout.status,variant==='unproved-branch-stop'?'incomplete':'terminated');const pending=r.closeout.actions.find((a:any)=>a.plannedTaskIds.length===0&&a.branchRef===null);assert(pending&&!['completed','skipped_with_rule'].includes(pending.status));if(variant==='unproved-branch-stop')assert(r.summary.execution.unknownCount>0);else assert.equal(r.summary.execution.unknownCount,0);evidenceLog.push({review,variant,status:r.closeout.status,actions:r.closeout.actions,execution:r.summary.execution});}
  }else if(review==='R4'){
   const f=setup('normal');f.facts.question='teacher_increment';assert(!evidence.buildEvidencePackage(f.pairedPlan,f.summary,f.facts).missingItems.some((x:any)=>x.evidenceId==='newDistribution'),'same-run public consumption positive must pass');const file=f.files.find((x:any)=>x.id==='offline-summary'),value=JSON.parse(readFileSync(file.localPath,'utf8'));value.consumption.confirmed.providerRequests=99;const bytes=JSON.stringify(value,null,2)+'\n';writeFileSync(file.localPath,bytes);file.sha256=sha(bytes);f.facts.requiredEvidence.find((x:any)=>x.id==='newDistribution').source.sha256=file.sha256;
   const pack=evidence.buildEvidencePackage(f.pairedPlan,f.summary,f.facts),missing=pack.missingItems.filter((x:any)=>x.evidenceId==='newDistribution');assert(missing.some((x:any)=>x.issues.some((s:string)=>s.includes('consumption'))),'public summary must reconcile the same-run original ledger');evidenceLog.push({review,missing});
  }else if(review==='R5'){
   const f=setup('confirmation-selection');f.facts.question='teacher_increment';const r=evidence.validateHandoffBindings(f.pairedPlan,f.summary,f.facts);assert(r.issues.some((x:any)=>x.evidenceId==='selectionHistory'&&x.reason.includes('confirmation')),'original confirm split cannot be relabeled development for selection');evidenceLog.push({review,issues:r.issues});
  }
 }else if(section==='context-bindings'){
  // Removing semantic validation would let the five SHA-correct conflicts pass.
  assert.equal(typeof evidence.validateHandoffBindings,'function','G1 validateHandoffBindings must be implemented');
  for(const variant of ['normal','missing-history','empty-prior','plan-conflict','parent-conflict','accepted-mismatch','candidate-unaccepted']){const f=setup(variant);f.facts.question='teacher_increment';
   for(const id of evidence.QUESTION_EVIDENCE.teacher_increment)if(!f.facts.requiredEvidence.some((r:any)=>r.id===id)&&id!=='selectionHistory'){const r=f.put('required-'+id,{planRef:f.planRef});f.require(id,r);}
   const pack=evidence.buildEvidencePackage(f.pairedPlan,f.summary,f.facts);
   if(variant==='normal')assert.equal(pack.completeness,'complete',JSON.stringify(pack.missingItems));else {assert.equal(pack.completeness,'incomplete');assert(pack.missingItems.some((r:any)=>r.evidenceId===({ 'missing-history':'selectionHistory','empty-prior':'priorDecision','plan-conflict':'priorDecision','parent-conflict':'priorDecision','accepted-mismatch':'acceptedProgram','candidate-unaccepted':'acceptedProgram'} as any)[variant]));}
   if(variant==='candidate-unaccepted')assert(pack.missingItems.some((r:any)=>r.evidenceId==='acceptedProgram'&&r.missingKind==='NOT_YET_EXECUTED'&&r.recoveryStatus==='NOT_DUE'));
   evidenceLog.push({variant,completeness:pack.completeness,missing:pack.missingItems});
  }
 }else if(section==='distribution-ref'){
  assert.equal(typeof evidence.validateHandoffBindings,'function','G3 public distribution binding must be implemented');
  for(const variant of ['normal','distribution-mismatch','private-label']){const f=setup(variant);f.facts.question='teacher_increment';
   const pack=evidence.buildEvidencePackage(f.pairedPlan,f.summary,f.facts),missing=pack.missingItems.filter((r:any)=>r.evidenceId==='newDistribution'||r.evidenceId.startsWith('private:'));
   if(variant==='normal')assert.equal(missing.length,0,JSON.stringify(missing));else assert(missing.length>0);
   assert(!pack.files.some((x:any)=>x.id==='private-label'));assert(!JSON.stringify(pack).includes('/private/original'));
   evidenceLog.push({variant,distributionMissing:missing,publicFiles:pack.files.map((f:any)=>f.id)});
  }
 }else{
  assert.equal(typeof evidence.rebuildPlanCloseout,'function','G2 closeout entry must be implemented');
  for(const variant of ['normal','complete','science-lost','terminated','missing-run','active-unknown','no-skip-rule','extra-task','no-actions','unexecuted-planned']){
   const f=setup(variant),r=evidence.rebuildPlanCloseout(f.spec,join(f.dir,'package'));const close=r.closeout;
   assert.deepEqual(Object.keys(close).sort(),['schema','planRef','planVersion','status','inputPackageRef','inputManifestSHA','analysisRef','actions','evidence_refs','unresolved'].sort());
   for(const a of close.actions)assert.deepEqual(Object.keys(a).sort(),['clauseRef','branchRef','plannedTaskIds','taskFileRefs','runRefs','status','evidence_refs','ruleRef','unresolved'].sort());
   assert.equal(close.schema,'ohuo-plan-closeout-v1');assert.equal(close.planRef,f.planRef);assert.equal(close.inputPackageRef,null);assert.equal(close.analysisRef,null);
   assert.equal(close.status,['complete','science-lost'].includes(variant)?'completed':variant==='terminated'?'terminated':'incomplete');
   if(variant!=='no-actions'){const a=close.actions.find((a:any)=>a.plannedTaskIds.includes('t1'));assert.equal(a.taskFileRefs.length,2);assert.equal(a.runRefs.length,variant==='missing-run'?1:2);}
   if(variant==='normal'){assert.equal(close.actions.length,3);assert.equal(close.actions[1].status,'not_executed');assert.equal(close.actions[2].status,'skipped_with_rule');assert.equal(r.summary.attempts.length,2);assert.equal(r.summary.attempts[0].failureReason,'synthetic_failed_attempt');assert.equal(r.summary.budgets[0].confirmed.providerRequests.total,2);}
   if(['missing-run','active-unknown','no-skip-rule','extra-task'].includes(variant))assert(r.summary.execution.unknownCount>0,variant+' cannot erase unresolved execution');
   if(variant==='science-lost'){assert.equal(close.unresolved.length,0);assert(r.summary.scientificUnresolved.some((x:any)=>x.evidenceId==='selectionHistory'));assert.equal(r.manifest.completeness,'incomplete');}
   if(variant==='terminated')assert(r.summary.termination.ruleRef);
   if(variant==='extra-task')assert(r.summary.attempts.some((a:any)=>a.taskId==='extra'));
   for(const file of r.manifest.files.filter((x:any)=>x.generated))assert.equal(sha(readFileSync(join(f.dir,'package',file.artifact),'utf8')),file.sha256);
   assert(r.manifest.files.some((f:any)=>f.artifact==='plan-closeout.json'));assert(r.manifest.readOrder.every((id:string)=>r.manifest.files.some((f:any)=>f.id===id)));
   assert.throws(()=>evidence.rebuildPlanCloseout(f.spec,join(f.dir,'package')),/new package|overwrite/);
   if(variant==='normal'){assert(r.summary.analyses.some((a:any)=>a.disposition==='BLOCKED'));
    const input=join(f.dir,'closeout-inputs.json');writeFileSync(input,JSON.stringify(f.spec));const before=f.files.map((f:any)=>sha(readFileSync(f.localPath,'utf8')));
    const cli=join(root,'lab/review6_2/research-evidence.ts'),args=[...process.execArgv,cli,'--mode','closeout','--input',input,'--output',join(f.dir,'cli-package')],result=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'incomplete');
    for(const bad of [[...process.execArgv,cli,'--mode','unregistered','--input',input,'--output',join(f.dir,'invalid-package')],[...args,'--python','forbidden']]){const rejected=spawnSync(process.execPath,bad,{encoding:'utf8'});assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/usage/);}
    assert.deepEqual(f.files.map((f:any)=>sha(readFileSync(f.localPath,'utf8'))),before,'input snapshots remain byte-identical');
    const duplicated=structuredClone(f.spec);duplicated.controlStates.push(duplicated.controlStates[0]);const d=evidence.rebuildPlanCloseout(duplicated,join(f.dir,'duplicate-package'));assert.equal(d.summary.budgets[0].confirmed.providerRequests.total,2,'same immutable snapshot/reference never double counts');}
   evidenceLog.push({variant,status:close.status,actions:close.actions,execution:r.summary.execution,budgets:r.summary.budgets,scientificUnresolved:r.summary.scientificUnresolved});
  }
 }
 const result={checkId:'B08-r3-'+(review??section??selected),case:selected,section,review,authorization:'approved B08_R3_C01_minimal_implementation_card.md lines 178-184; synthetic only',sourceSHA256:{implementation:sha(readFileSync(join(root,'lab/review6_2/research-evidence.ts'),'utf8')),checks:sha(readFileSync(join(root,'lab/review6_2/checks/check-summary.ts'),'utf8'))},scope:'no models/API/runner/kernel/host writes',status:'passed',evidence:evidenceLog};
 writeFileSync(join(output,'check-receipt.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
