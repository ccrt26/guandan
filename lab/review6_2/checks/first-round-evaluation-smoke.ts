/** training.round-contract-smoke R16 extension: fixed synthetic summaries only;
 * no source acquisition, model weights, API, optimizer or real match. */
import assert from 'node:assert/strict';
import {existsSync,realpathSync} from 'node:fs';
const moduleURL=new URL('../first-round-evaluation.ts',import.meta.url);
assert.ok(existsSync(moduleURL),'R16 independent union/normalized paired readout implementation is missing');
const {selectFirstRoundNewQuestions,summarizeFirstRoundNewTest,summarizeFirstRoundNewRoot,planFirstRoundConfirmation}=await import(moduleURL.href);
const hash=(s:string)=>s.repeat(64).slice(0,64),ref=(s:string)=>s+'@sha256:'+hash('a');
const plan={schema:'ohuo-first-round-new-test-selection-v1',purpose:'engineering_fixture',sourceIndexRef:ref('new-index'),comparisonRef:ref('comparison'),s0Ref:ref('S0'),s1Ref:ref('S1'),selectionSalt:'fixed-before-labels',familyIds:['new-a','new-b'],excludedFamilyIds:['train-a'],excludedSourceSHA256:[hash('e')],maxQuestionsPerFamily:8};
const row=(familyId:string,id:string)=>({questionId:id,familyId,contextSHA256:hash(id==='shared'?'b':'c'),inputSHA256:hash('d'),candidateSpec:'first-target-offer12-v1',candidatePolicy:{candidateSpec:'first-target-offer12-v1',enumSpec:{id:'full-house-attachment-ranks-v1',enumerationMode:'all_supported_attachment_ranks'}},candidateIds:['p','t'],canonicalIds:['pass','takeover'],features423:[Array(423).fill(0),Array(423).fill(1)],proposalFeatures399:[Array(399).fill(0),Array(399).fill(1)],eligibility:'eligible',exclusionReason:null});
const inventory=plan.familyIds.flatMap(familyId=>['S0','S1'].flatMap(reachedBy=>[0,1,2].flatMap(group=>[0,1].map(side=>({familyId,reachedBy,group,side,status:'completed',sourceSHA256:hash(familyId==='new-a'?'a':'f'),sourceFacts:[{familyId:familyId+'-future',sourceSHA256:hash(familyId==='new-a'?'1':'2')}],rows:group===0&&side===0?[row(familyId,'shared')]:[]})))));
const selection=selectFirstRoundNewQuestions(plan,inventory);
assert.equal(selection.qualification.eligible,false);assert.equal(selection.trainingEligible,false);assert.equal(selection.questions.length,2);assert.deepEqual(selection.questions[0].reachedBy,['S0','S1']);assert.deepEqual(selection,selectFirstRoundNewQuestions(plan,[...inventory].reverse()));
assert.throws(()=>selectFirstRoundNewQuestions({...plan,familyIds:['train-a']},inventory),/independence/);
assert.throws(()=>selectFirstRoundNewQuestions(plan,inventory.map((r:any,i:number)=>i? r:{...r,sourceSHA256:hash('e')})),/independence/);
assert.throws(()=>selectFirstRoundNewQuestions(plan,inventory.map((r:any,i:number)=>i?r:{...r,sourceFacts:[{familyId:'train-a',sourceSHA256:hash('9')}]})),/independence/);
assert.throws(()=>selectFirstRoundNewQuestions(plan,inventory.map((r:any)=>({...r,rows:r.rows.map((q:any)=>({...q,candidatePolicy:{...q.candidatePolicy,enumSpec:{id:'legacy'}}}))}))),/candidate_identity/);
const incomplete=selectFirstRoundNewQuestions(plan,inventory.slice(1));assert.equal(incomplete.verification,'incomplete');assert.equal(incomplete.qualification.eligible,false);
const branchPlan={schema:'ohuo-first-round-new-root-v1',familyId:'new-a',questionId:'q1',inputSHA256:hash('d'),s0ActionId:'p',s1ActionId:'t',actions:[{actionId:'p',canonicalId:'pass',direction:'pass'},{actionId:'t',canonicalId:'takeover',direction:'takeover'}],worlds:[1,2,3,4].map(seed=>({worldId:'new-'+seed,seed})),profileSHA256:hash('a'),policyIds:['s0','p','o1','o2']};
const results=branchPlan.worlds.flatMap(w=>branchPlan.actions.map(a=>({worldId:w.worldId,actionId:a.actionId,result:{seed:w.seed,forcedActionId:a.actionId,complete:true,W:a.actionId==='t'?1:-1,g:0,y:a.actionId==='t'?1:-1,initialWorldSHA256:hash(String(w.seed)),profileSHA256:branchPlan.profileSHA256,policyIds:branchPlan.policyIds,ownPlanSummary:null}})));
const root=summarizeFirstRoundNewRoot(branchPlan,results);assert.equal(root.meanDeltaY,1);assert.equal(root.direction,'pass_to_takeover');assert.equal(root.teacherAgreementMeaning,'demonstration_transfer_not_correctness');
assert.equal(summarizeFirstRoundNewRoot(branchPlan,results.slice(1)).meanDeltaY,null);
assert.throws(()=>summarizeFirstRoundNewRoot(branchPlan,results.map((r:any,i:number)=>i?r:{...r,result:{...r.result,W:0}})),/metric/);
const report=summarizeFirstRoundNewTest({purpose:'engineering_fixture',familyIds:['new-a','new-b'],questionIds:['q1','q2']},[root,{...root,familyId:'new-b',questionId:'q2'}]);assert.equal(report.meanFamilyDeltaY,1);assert.equal(report.directionalSupport,'unverified_direction');assert.equal(report.directionGroups.takeover_to_pass.meanFamilyDeltaY,null);assert.equal(report.trainingEligible,false);
const planning=planFirstRoundConfirmation({sPlan:null,reservedSeconds:1000,slowestBlockSeconds:100,remainingMatchAttempts:96,pilotBlocks:4});assert.equal(planning.sPlan,1);assert.equal(planning.N,8);assert.equal(planning.exploratory,true);assert.equal(planning.h,0.05);assert.throws(()=>planFirstRoundConfirmation({sPlan:0.1,reservedSeconds:1000,slowestBlockSeconds:100,remainingMatchAttempts:96,pilotBlocks:5}),/pilot/);
console.log(JSON.stringify({checkId:'training.round-contract-smoke',scope:'R16 fixed synthetic union/new-question normalized Y/precision only',engineeringFixture:true,eligible:false,passed:true}));
const consumerURL=new URL('../first-round-evaluation-consumer.ts',import.meta.url);
assert.ok(existsSync(consumerURL),'R16 needs its actual metered branch consumer, not only a descriptive helper');
const {validateFirstRoundNewTestTask,firstRoundEvaluationCheckpoint}=await import(consumerURL.href);
const contract={schema:'ohuo-first-round-new-test-contract-v1',purpose:'engineering_fixture',selectionRef:ref('selection'),comparisonRef:ref('comparison'),sourceIndexRef:ref('new-index'),s0Ref:ref('S0'),s1Ref:ref('S1'),familyIds:['new-a','new-b'],questionIds:['q1','q2'],questions:['q1','q2'].map((questionId,i)=>({questionId,familyId:i?'new-b':'new-a',inputSHA256:hash('d'),featuresSHA256:hash('f'),sourceRowSHA256:hash('a')})),maxBranchStarts:16};
const task={taskKind:'evaluate',parentPolicyRef:contract.s0Ref,releaseRefs:[contract.s0Ref,contract.s1Ref],sourcePlan:{split:'fixture',sourceIndexRef:contract.sourceIndexRef,familyIds:contract.familyIds},datasetRefs:[contract.selectionRef],scientificContract:{comparisonRef:contract.comparisonRef},operationScope:{localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false},limits:{maxProviderRequests:0,maxOptimizerSteps:0,maxLabelDecisions:0,maxMatchAttempts:16}};
assert.doesNotThrow(()=>validateFirstRoundNewTestTask(task,contract,'offline_synthetic'));
assert.throws(()=>validateFirstRoundNewTestTask(task,{...contract,questions:contract.questions.map((q,i)=>i?q:{...q,questionId:'not-the-selected-question'})},'offline_synthetic'),/new_test_task/);
assert.throws(()=>validateFirstRoundNewTestTask({...task,sourcePlan:{...task.sourcePlan,split:'train'}},contract,'offline_synthetic'),/new_test_task/);
assert.throws(()=>validateFirstRoundNewTestTask(task,{...contract,maxBranchStarts:129},'offline_synthetic'),/new_test_task/);
assert.equal(firstRoundEvaluationCheckpoint({schema:'ohuo-first-round-new-test-run-v1',taskSHA256:hash('a'),selectionRef:ref('selection'),contractRef:ref('contract'),rootCursor:0,plans:[],attempts:[],active:null,executionUnknown:false}),true);
// The existing runtime may be imported, but aborted engineering checks never
// sample a world or start a match. All files remain in the isolated task tmp.
const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
const {runFirstRoundNewTest}=await import(consumerURL.href),{digest}=await import('../task-schema.mjs');
const out=mkdtempSync(join(tmpdir(),'S35-R16-smoke-'));
try{
 const t={...task,outputRoot:out,scientificContract:{...task.scientificContract,decisionRuleRef:ref('new-test-contract')}};
 const c={...contract,questionIds:['q1'],questions:contract.questions.slice(0,1),maxBranchStarts:8};t.limits={...task.limits,maxMatchAttempts:8};
 const controller=new AbortController();controller.abort('engineering_no_execution');let reservations=0;
 const ctx={task:t,executionInputs:{contract:c,mode:'offline_synthetic',prepareRoot(){throw Error('no root execution authorized in fixture');}},signal:controller.signal,checkpointSequence:0,deadlineMonotonicMs:performance.now()+1000,executionId:'fixture',async saveCheckpoint(){},getConsumption:()=>zeroConsumption,async reserve(){reservations++;throw Error('unexpected reservation');}};
 const zeroConsumption={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0};
 const stopped=await runFirstRoundNewTest(ctx);assert.equal(stopped.completed,false);assert.equal(reservations,0);
 await assert.rejects(runFirstRoundNewTest({...ctx,checkpoint:{schema:'ohuo-first-round-new-test-run-v1',taskSHA256:digest(t),selectionRef:c.selectionRef,contractRef:t.scientificContract.decisionRuleRef,rootCursor:1,plans:[],attempts:[],active:null,executionUnknown:false}}),/checkpoint.*prefix/);
}finally{rmSync(out,{recursive:true,force:true});}
console.log(JSON.stringify({checkId:'training.round-contract-smoke',extension:'R16 actual-consumer abort/resume boundary',realMatches:0,providerRequests:0,parameterUpdates:0,eligible:false,passed:true}));
const ev=await import(moduleURL.href);
assert.equal(typeof ev.summarizeFirstRoundMatches,'function','R16 must reuse B08 complete-block projection');
const familyIds=['match-a','match-b'],pairRef=(id:string)=>({id,sha256:hash('a')});
const pairedPlan:any={schema:'ohuo-paired-plan-v1',comparison:'S-B',variantB:'S0',variantCandidate:'S1',familyIds,split:'confirm',metric:'team_complete_match_Y',seed:123,statisticName:'first-round-S1-minus-S0',analysisUnit:'complete-source-block',analysisMethod:'r6-paired-percentile-type7-20k-v1',question:'student_match',layoutIdentitySHA256:{},refs:Object.fromEntries(['plan','queue','sourceIndex','conditions','selectionHistory','authorization','budget','parentPackage'].map(id=>[id,pairRef(id)]))};
const queue:any={schema:'ohuo-complete-match-queue-v1',sourceIndexRef:'sourceIndex',rows:[]},index:any={version:1,families:{}},attempts:any[]=[];
for(const [f,familyId]of familyIds.entries()){
 index.families[familyId]={split:'sealed'};
 for(let group=0;group<3;group++)for(let side=0;side<2;side++)for(const variant of ['S0','S1']){
  const id=`${familyId}-${group}-${side}-${variant}`,q:any={matchId:id,layoutId:id,sourceFamilyId:familyId,split:'confirm',seed:f,dealNamespace:'fixture',roundFamilyIds:[familyId],actor:side,metric:pairedPlan.metric,group,side,variant,maxGames:80,maxMovesPerGame:2500,seats:Array.from({length:4},(_,i)=>({releaseRef:i===side?ref(variant):ref(i===(side+2)%4?'partner'+group:'opponent'),mode:'local',profileRevisionRef:null}))};queue.rows.push(q);pairedPlan.layoutIdentitySHA256[id]=hash('a');
  attempts.push({runId:'fixture',matchId:id,sourceRef:'sourceIndex',layoutRef:'queue',state:'completed',complete:true,winner:variant==='S1'&&f===0?side:1-side,incompleteReason:null,recordVerified:true,actualRoundFamilies:[familyId],activeMatchLoopMs:1,identitySHA256:hash('a'),resultIdentity:Object.fromEntries(['layoutId','sourceFamilyId','actor','metric','group','side','variant'].map(k=>[k,q[k]])),recordRef:pairRef(id),wallMs:1,decisions:[],issues:[]});
 }
}
const matchContract={schema:'ohuo-first-round-confirmation-v1',purpose:'engineering_fixture',s0Ref:ref('S0'),s1Ref:ref('S1'),partnerRefs:[0,1,2].map(i=>ref('partner'+i)),familyIds,pilotFamilyIds:['pilot-a'],excludedFamilyIds:['training-a'],excludedSourceSHA256:[hash('e')],sourceFacts:familyIds.map((f,i)=>({blockFamilyId:f,sourceFamilyId:f,sourceSHA256:hash(i?'b':'c')})),planningInputs:{sPlan:null,reservedSeconds:200,slowestBlockSeconds:100,remainingMatchAttempts:24,pilotBlocks:1},planning:planFirstRoundConfirmation({sPlan:null,reservedSeconds:200,slowestBlockSeconds:100,remainingMatchAttempts:24,pilotBlocks:1}),necessaryBehaviorStatus:'accepted'};
const paired=await ev.summarizeFirstRoundMatches(matchContract,pairedPlan,queue,index,attempts);assert.deepEqual(paired.paired.blocks.map((b:any)=>b.difference),[1,0]);assert.equal(paired.paired.primary.point,.5);assert.equal(paired.paired.actual.completeBlocks,2);assert.equal(paired.strengthConfirmed,false);assert.equal(paired.trainingEligible,false);
const missing=await ev.summarizeFirstRoundMatches(matchContract,pairedPlan,queue,index,attempts.slice(1));assert.equal(missing.paired.actual.incompleteBlocks,1);assert.equal(missing.paired.blocks[0].difference,null);
const wrongScale=structuredClone(attempts);wrongScale[0].winner=-1;assert.equal((await ev.summarizeFirstRoundMatches(matchContract,pairedPlan,queue,index,wrongScale)).paired.actual.completeBlocks,1);
await assert.rejects(ev.summarizeFirstRoundMatches({...matchContract,pilotFamilyIds:['match-a']},pairedPlan,queue,index,attempts),/independence/);
console.log(JSON.stringify({checkId:'training.round-contract-smoke',extension:'R16 actual B08 twelve-game complete-family Y projection',point:.5,blockDifferences:[1,0],kernelExecuted:false,realMatches:0,eligible:false,passed:true}));
const pythonAt=process.argv.indexOf('--python');
if(pythonAt!==-1){
 assert.equal(process.argv.length,pythonAt+2,'one explicit existing Python interpreter required');
 const output=new URL('../../out/S35-R16-statistics-smoke-'+Date.now()+'-'+process.pid,import.meta.url).pathname;
 const interval=await ev.runFirstRoundMatchInterval(paired,output,process.argv[pythonAt+1]);
 assert.equal(interval.interval.independentUnits,2);assert.equal(interval.interval.columns.macro.point,.5);assert.deepEqual(interval.interval.columns.macro.quantiles,[0,1]);assert.equal(interval.interval.replicates,20000);assert.equal(interval.strengthConfirmed,false);assert.equal(interval.adoptionGateSatisfied,null);assert.equal(interval.qualification,'unresolved_not_equivalent');
 console.log(JSON.stringify({checkId:'training.round-contract-smoke',extension:'R16 unchanged B08 20k/type7 kernel',output,kernelSHA256:interval.interval.sourceSHA256,replicates:20000,interval:[0,1],realMatches:0,eligible:false,passed:true}));
}
assert.equal(typeof ev.summarizeFirstRoundTeacherTransfer,'function','independent teacher agreement must be explicitly non-ground-truth');
const teacherTransfer=ev.summarizeFirstRoundTeacherTransfer({questionIds:['q1','q2']},[{questionId:'q1',inputSHA256:hash('a'),candidateIds:['p','t'],s0ActionId:'p',s1ActionId:'t',teacherActionId:'t',status:'provisional',labelTerminalRef:pairRef('label1'),hardCheckRef:pairRef('hard1')}]);
assert.equal(teacherTransfer.plannedQuestions,2);assert.equal(teacherTransfer.provisionalQuestions,1);assert.equal(teacherTransfer.unknownQuestions,1);assert.equal(teacherTransfer.S0.agreements,0);assert.equal(teacherTransfer.S1.agreements,1);assert.equal(teacherTransfer.meaning,'demonstration_transfer_not_correctness');assert.equal(teacherTransfer.trainingEligible,false);
// Cross-language mean reduction can vary by last bits; identity/units/scale
// remain exact. This is a fake interval contract fixture, not a kernel run.
const {createHash}=await import('node:crypto'),hashBytes=(s:string)=>createHash('sha256').update(s).digest('hex');
const fakeStats={implementation:'r6-paired-percentile-type7-20k-v1',method:'percentile',interpolation:'R_type_7_linear',sharedResamplingIndicesAcrossColumns:true,replicates:20000,independentUnits:2,seed:paired.paired.primary.input.seed,probabilities:[.025,.975],sourceSHA256:'839cef71e9ebdf527a383098700e29b857134e5545d5094e330dbd258d529049',inputSHA256:hashBytes(JSON.stringify(paired.paired.primary.input)+'\n'),unitIdsSHA256:hashBytes(JSON.stringify([...paired.paired.primary.input.unitIds].sort())),columns:{macro:{point:.5+Number.EPSILON,quantiles:[0,1]}}};
assert.equal(ev.attachFirstRoundMatchInterval(paired,fakeStats).strengthConfirmed,false);
assert.throws(()=>ev.attachFirstRoundMatchInterval(paired,{...fakeStats,columns:{macro:{point:.6,quantiles:[0,1]}}}),/interval_identity/);

assert.throws(()=>validateFirstRoundNewTestTask({...task,limits:{...task.limits,maxMatchAttempts:72}},{...contract,questionIds:Array.from({length:9},(_,i)=>'q'+i),questions:Array.from({length:9},(_,i)=>({...contract.questions[0],questionId:'q'+i})),maxBranchStarts:72},'offline_synthetic'),/new_test_task/);
await assert.rejects(ev.summarizeFirstRoundMatches({...matchContract,partnerRefs:[ref('same'),ref('same'),ref('same')]},pairedPlan,queue,index,attempts),/confirmation_fixed_partners/);


assert.throws(()=>selectFirstRoundNewQuestions(plan,inventory.map((r:any)=>({...r,sourceFacts:[{familyId:'same-actual-future',sourceSHA256:hash(r.familyId==='new-a'?'7':'8')}]}))),/future_source_independence/);
const positive=ev.attachFirstRoundMatchInterval({...paired,planning:{...paired.planning,exploratory:false}},{...fakeStats,columns:{macro:{point:.5,quantiles:[.1,.9]}}});assert.equal(positive.qualification,'pending_endpoint_review');assert.equal(positive.adoptionGateSatisfied,null);assert.equal(positive.automaticDeploymentAllowed,false);
const hostURL=new URL('../first-round-evaluation-host.ts',import.meta.url);assert.ok(existsSync(hostURL),'R16 must have a fixed trusted source and loader adapter');
const {firstRoundSourceLineageFacts,prepareFirstRoundNewTestHost}=await import(hostURL.href);
const sourceFacts=firstRoundSourceLineageFacts({sourceFamilyId:'root-a',games:[{gameNo:1,sourceFamilyId:'root-a',sourceSHA256:hash('1')},{gameNo:2,sourceFamilyId:'actual-future-2',sourceSHA256:hash('2')}]},{sourceFamilyId:'root-a',roundFamilyIds:['root-a','actual-future-2']});assert.equal(sourceFacts.blockFamilyId,'root-a');assert.deepEqual(sourceFacts.facts.map((f:any)=>f.familyId),['root-a','actual-future-2']);assert.throws(()=>firstRoundSourceLineageFacts({sourceFamilyId:'root-a',games:[{gameNo:2,sourceFamilyId:'root-a',sourceSHA256:hash('1')}]},{sourceFamilyId:'root-a',roundFamilyIds:['root-a','actual-future-2']}),/actual_round/);
await assert.rejects(prepareFirstRoundNewTestHost({host:{},task,refs:new Map(),inputs:{}}),/fixed_host/);

assert.equal((await import(hostURL.href)).firstRoundNewTestSelectionReadiness(selectFirstRoundNewQuestions({...plan,purpose:'first-round-independent-new-test',familyIds:['new-a']},inventory.filter((r:any)=>r.familyId==='new-a'))),'single_source_diagnostic');


assert.equal(typeof ev.rebuildFirstRoundEvidence,'function','R16 requires a concrete opt-in readout entry reusing original B08');await assert.rejects(ev.rebuildFirstRoundEvidence({},'unused','unused'),/readout_input/);
const exposure=(await import(hostURL.href)).assertFirstRoundNewTestExposure;assert.equal(typeof exposure,'function');
const oldSpecRef=ref('old-spec'),newSpecRef=ref('new-spec'),oldSelectionRef=ref('old-selection'),stableSource={schema:'ohuo-first-round-new-test-source-v1',queueRef:ref('same-queue'),sourceIndexRef:ref('same-index'),comparisonRef:ref('same-comparison')};
assert.throws(()=>exposure({state:{runs:{r:{runId:'r',task:{planRef:ref('plan'),budgetRef:ref('budget'),scientificContract:{decisionRuleRef:ref('old-rule')},datasetRefs:[oldSelectionRef]},checkpoint:{rows:[{requestCount:1}]}}},budgets:{}},planRef:ref('plan'),sourceSpec:stableSource,sourceSpecRef:newSpecRef,selectionRef:ref('new-selection'),resolveRef:(r:string)=>r===ref('old-rule')?{sourceSpecRef:oldSpecRef,selectionRef:oldSelectionRef}:stableSource}),/selection_changed_after_exposure/);


// Same synthetic case, now at the actual public B07 byte boundary. No engine
// game is played. The journal has game 2 to retain actual-vs-block ancestry.
assert.equal(typeof ev.readFirstRoundPublicSourceFacts,'function','readout must verify actual game source bytes, not only declared family labels');
// B08 intentionally rejects aliased record paths (e.g. macOS /tmp -> /private/tmp).
// Create fixture references from the physical directory; keep production gates strict.
const journalTmp=realpathSync(mkdtempSync(join(tmpdir(),'S35-R16-public-source-')));
try{
 const {mkdirSync,writeFileSync}=await import('node:fs'),dir=join(journalTmp,'matches','m');mkdirSync(dir,{recursive:true});
 const id={runId:'r',matchId:'m',sourceRef:'sourceIndex',layoutRef:'queue',sourceFamilyId:'match-a',policyIds:['s','p','o','o'],rules:{},seatSnapshots:[{},{},{},{}]};
 const idBytes=JSON.stringify(id)+'\n',events=[{type:'game',value:{gameNo:1,sourceFamilyId:'match-a',sourceSHA256:hash('c')}},{type:'game',value:{gameNo:2,sourceFamilyId:'future-2',sourceSHA256:hash('d')}},{type:'summary',value:{complete:true,winner:0,incompleteReason:null}}].map(x=>JSON.stringify(x)).join('\n')+'\n';
 writeFileSync(join(dir,'identity.json'),idBytes);writeFileSync(join(dir,'events.jsonl'),events);
 const run={schema:'ohuo-match-summary-v1',runId:'r',taskId:'t',taskSHA256:hash('1'),queueRef:'queue',executionUnknown:false,matches:[{matchId:'m',recordRef:{directory:dir,identitySHA256:hashBytes(idBytes),journalSHA256:hashBytes(events),journalBytes:Buffer.byteLength(events)},result:{complete:true,winner:0,incompleteReason:null}}]},runBytes=JSON.stringify(run)+'\n',runPath=join(journalTmp,'summary.json');writeFileSync(runPath,runBytes);
 const sourceQueue={rows:[{matchId:'m',sourceFamilyId:'match-a',roundFamilyIds:['match-a','future-2']}]},declared=[{blockFamilyId:'match-a',sourceFamilyId:'match-a',sourceSHA256:hash('c')},{blockFamilyId:'match-a',sourceFamilyId:'future-2',sourceSHA256:hash('d')}];
 const source=await ev.readFirstRoundPublicSourceFacts(runPath,hashBytes(runBytes),sourceQueue,declared);assert.equal(source.facts.length,2,JSON.stringify({unknownRecords:source.unknownRecords}));assert.equal(source.facts[1].blockFamilyId,'match-a');assert.equal(source.facts[1].sourceFamilyId,'future-2');
 await assert.rejects(ev.readFirstRoundPublicSourceFacts(runPath,hashBytes(runBytes),sourceQueue,declared.map((f,i)=>i?{...f,sourceSHA256:hash('f')}:f)),/actual_source_fact/);
}finally{rmSync(journalTmp,{recursive:true,force:true});}
assert.equal(typeof ev.firstRoundConfirmationRule,'function','fixed conditions must bind pre-outcome planning separately from journal facts');
const frozenRule=ev.firstRoundConfirmationRule(matchContract,pairedPlan);
assert.equal(frozenRule.schema,'ohuo-first-round-confirmation-rule-v1');assert.equal(Object.hasOwn(frozenRule.confirmation,'sourceFacts'),false);assert.equal(Object.hasOwn(frozenRule.confirmation,'necessaryBehaviorStatus'),false);
assert.deepEqual(ev.firstRoundConfirmationRule({...matchContract,sourceFacts:[],necessaryBehaviorStatus:'pending'},pairedPlan),frozenRule);
assert.notDeepEqual(ev.firstRoundConfirmationRule({...matchContract,partnerRefs:[ref('changed'),...matchContract.partnerRefs.slice(1)]},pairedPlan),frozenRule);
assert.notDeepEqual(ev.firstRoundConfirmationRule(matchContract,{...pairedPlan,seed:999}),frozenRule);


assert.equal(typeof ev.validateFirstRoundConfirmationIdentities,'function');
const composite={schema:'ohuo-first-round-s0-release-ref-v1',proposalRef:ref('proposal'),studentParentRef:ref('migrated-parent'),policyId:'first-round-s0-'+digest({proposalRef:ref('proposal'),studentParentRef:ref('migrated-parent')}).slice(0,16)},studentIdentity={schema:'ohuo-student-release-first-round-v3',proposalRef:ref('proposal'),learningParent:{ref:ref('migrated-parent')}};
const ancestryQueue={rows:[{sourceFamilyId:'match-a',roundFamilyIds:['match-a','future-2']},{sourceFamilyId:'match-b',roundFamilyIds:['match-b','future-b']}]},ancestryTask={sourcePlan:{familyIds:['match-a','future-2','match-b','future-b']}};
await ev.validateFirstRoundConfirmationIdentities(matchContract,ancestryQueue,ancestryTask,composite,studentIdentity);
await assert.rejects(ev.validateFirstRoundConfirmationIdentities(matchContract,ancestryQueue,{sourcePlan:{familyIds:['match-a','match-b']}},composite,studentIdentity),/task_ancestry/);
await assert.rejects(ev.validateFirstRoundConfirmationIdentities(matchContract,ancestryQueue,ancestryTask,composite,{...studentIdentity,learningParent:{ref:matchContract.s0Ref}}),/composite/);

console.log(JSON.stringify({checkId:'training.round-contract-smoke',extension:'R16 complete fixed-case result',allAssertionsPassed:true,kernelExecuted:pythonAt!==-1,engineeringFixture:true,eligible:false,realMatches:0,providerRequests:0,parameterUpdates:0}));
