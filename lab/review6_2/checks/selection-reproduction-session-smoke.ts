/** One finite original-selector session check. Twelve tiny synthetic engine
 * terminal matches only; not natural research sources, models or API. */
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {buildDeck,classify,DEFAULT_RULES,makeLevelCtx,applyMove,type GameState,type Combo} from '@gd/engine';
import {PublicTracker} from '../../../packages/ai/src/nn/schema';
import {STUDENT_SCORER_ENCODER} from '../../../packages/ai/src/policy/descriptor';
import {RELEASES} from '../../../packages/ai/src/policy/seats';
import {createDecisionBundle} from '../../../packages/ai/src/hybrid/candidates';
import {captureInitialCandidateInputs,captureStudentCandidateInputs,createMatchStore,replayConfirmedMatch} from '../match-record';
import * as selector from '../offline-selection';
import {prepareOfflineSelection,verifyOfflineSelection,type OfflineSelectionSpec} from '../offline-selection';
import {resolveLegalMove} from '../../../packages/ai/src/hybrid/legality';
import {FIRST_ROUND_TARGET_DEFINITION} from '../first-round-target';
import {referenceOf,digest} from '../task-schema.mjs';
assert.deepEqual(process.argv.slice(2),['--case','training.selection-reproduction-session']);
assert.equal(typeof selector.createOfflineSelectionReproductionSession,'function','session API must exist before the finite original-source fixture');
async function runFixture(){
const pilot=true;
const root=fileURLToPath(new URL('../../../',import.meta.url)).replace(/\/$/,'');mkdirSync(join(root,'lab/out'),{recursive:true});
const runRoot=mkdtempSync(join(root,'lab/out/S35-selection-session-')),controlRoot=join(runRoot,'control');mkdirSync(controlRoot);
const sha=(x:string)=>createHash('sha256').update(x).digest('hex'),plain=(x:any)=>JSON.parse(JSON.stringify(x));
let enumerations=0;class ObservedMap extends Map<string,any>{values(){enumerations++;return super.values();}}
const references=new ObservedMap(),evidenceFiles=new Map<string,any>();
const ref=(id:string,x:any)=>{const r=referenceOf(id,x);references.set(r,plain(x));return r;};
const evidence=(id:string,x:any)=>{const path=join(runRoot,id+'.json'),bytes=JSON.stringify(x)+'\n';writeFileSync(path,bytes);const f={id,sha256:sha(bytes)};evidenceFiles.set(id,{path:relative(root,path),sha256:f.sha256});return f;};
const policy={candidateSpec:'first-target-offer12-v1',enumSpec:{id:'full-house-attachment-ranks-v1',enumerationMode:'all_supported_attachment_ranks'}} as const;
const baseEncoder={schema:'v2',ctxFill:'rule-context',passEncoding:'action64',encoderVersion:'gd-lab-schema-v4'} as const;
const source={policyId:'synthetic-B',modelVersion:'fixture-only',architectureId:'mlp-tanh-256x256-scalar-v1',weightsLayoutVersion:'f32le-layer-w-row-major-then-b-v1',parameterCount:168449,weightsPathOrUrl:{nodePath:'lab/out/not-a-real-model.f32'},weightsSHA256:sha('synthetic-B-metadata-only'),inputDim:399,encoder:baseEncoder,candidateSpecId:'cand-suit-v3',epsilon:0,tierSpecId:'none',tieBreakId:'first-candidate-v1'};
const identity={policyId:source.policyId,modelVersion:source.modelVersion,weightsSHA256:source.weightsSHA256,inputDim:399,encoderVersion:baseEncoder.encoderVersion,candidateVersion:source.candidateSpecId,passEncoding:baseEncoder.passEncoding,architectureId:source.architectureId,weightsLayoutVersion:source.weightsLayoutVersion,epsilon:0,tieBreakId:source.tieBreakId,tierSpecId:'none'};
const legacy=RELEASES.find(x=>x.releaseRef==='ohuo-1030-b-v1')!,legacyRef=ref('fixture-legacy-B',{schema:'ohuo-release-ref-v1',release:legacy,policyIdentity:identity});
const actingReleaseRef=ref('fixture-B-prime',{schema:'ohuo-candidate-research-release-ref-v1',parentRef:legacyRef,release:{...legacy,releaseRef:'fixture-B-prime',label:'Fixture B prime',status:'development',parentRelease:legacy.releaseRef,candidateSpecRef:policy.candidateSpec,promptRef:'ohuo-engine-rules-v1/choose-only-v2'},policyIdentity:identity,candidatePolicy:policy});
const scorer={schema:'ohuo-student-scorer-v1',policyId:'synthetic-S0',modelVersion:'fixture-only',architectureId:source.architectureId,weightsLayoutVersion:source.weightsLayoutVersion,parameterCount:174593,inputDim:423,weightsPathOrUrl:{nodePath:'lab/out/not-a-real-student.f32'},weightsSHA256:sha('synthetic-S0-metadata-only'),encoder:STUDENT_SCORER_ENCODER,tieBreakId:'first-candidate-v1'};
const migrationReceiptRef=evidence('migration-fixture',{schema:'ohuo-student-migration-receipt-v1',parentRef:source,target:scorer,sourceRegistryRef:{path:'fixture-registry.json',sha256:sha('fixture-registry')},migration:{ruleId:'legacy399-append24-zero-w1-columns-v1',sourceSHA256:source.weightsSHA256,targetSHA256:scorer.weightsSHA256,sourceEncoder:baseEncoder,targetEncoder:STUDENT_SCORER_ENCODER,newColumnsZero:6144,parameters:174593,bytes:698372,initialization:'cross-input-migration-fresh-optimizer',strictResume:false,codeRefs:[{path:'fixture-only.ts',sha256:sha('fixture-only')}]}});
const studentParentRef=ref('fixture-S0',{schema:'ohuo-student-parent-ref-v1',scorer,migrationReceiptRef,basePolicyIdentity:identity});
const comparisonRef=ref('fixture-first-round-comparison',{schema:'ohuo-first-round-comparison-v1',proposalRef:actingReleaseRef,studentParentRef});
const namespace=pilot?'fixture-pilot-only':'fixture-formal-only';
const families=(pilot?['pilot-block-A','pilot-block-B']:['fixture-family-A','fixture-family-B','fixture-family-C','fixture-family-D']).sort((a,b)=>sha(a).localeCompare(sha(b))||a.localeCompare(b));
const quotas=families.map((familyId,i)=>({familyId,split:pilot?'train':i<2?'dev':'train',count:2}));
const secondDealFamily=families[0]+'-game2';
const index={version:1,families:Object.fromEntries([...quotas.map(q=>[q.familyId,{split:q.split}]),[secondDealFamily,{split:quotas[0].split}]])},sourceIndexPath=join(runRoot,'source-index.json'),indexBytes=JSON.stringify(index)+'\n';writeFileSync(sourceIndexPath,indexBytes);
const sourceIndexRef=ref('fixture-index',{schema:'ohuo-source-index-ref-v1',namespace,fileSHA256:sha(indexBytes)});
const clauseRef=ref('fixture-selection-clause',{id:'fixture-selection-clause'}),sourceClauseRef=ref('fixture-source-clause',{schema:'ohuo-first-round-source-action-scope-v1',originalRuleRef:ref('fixture-original-rule',{fixture:true}),namespace,stageName:'pilot'});
const planRef=ref('fixture-plan',{actions:[{clauseRef:sourceClauseRef,branchRef:null,expectedArtifactKinds:['ohuo-match-summary-v1'],plannedTaskIds:pilot?['fixture-source-train']:['fixture-source-train','fixture-source-dev']}]});
ref('fixture-source-spec',{schema:'ohuo-first-round-source-spec-v1',planRef,reservationRef:null,purpose:'first-round-source-plan',stages:Object.fromEntries(['pilot','formal','newTest','variancePilot','confirmation'].map(stage=>[stage,{namespace:stage==='pilot'?namespace:'fixture-'+stage}]))});
const authorizationRef=ref('fixture-authorization',{datasetEligible:false,realTraining:false});
const budget={planRef,controlRoot,researchBatchId:'fixture-batch',authorizationRef,limits:{maxProviderRequests:quotas.length*2,maxLabelDecisions:quotas.length*2,maxOptimizerSteps:0,maxMatchAttempts:0}},budgetRef=ref('fixture-budget',budget);
const queueRows=quotas.flatMap((q,i)=>Array.from({length:6},(_,layout)=>({matchId:`fixture-m${i}-${layout}`,layoutId:`fixture-layout-${layout}`,sourceFamilyId:q.familyId,split:q.split,seed:i*100+layout,dealNamespace:'fixture-only',roundFamilyIds:[q.familyId],actor:layout%2,metric:'fixture-only',group:Math.floor(layout/2),side:layout%2,variant:'fixture-only',maxGames:1,maxMovesPerGame:512,seats:Array.from({length:4},()=>({releaseRef:actingReleaseRef,mode:'local',profileRevisionRef:null}))})));
const queueRef=ref('fixture-queue',{schema:'ohuo-complete-match-queue-v1',namespace,sourceIndexRef,rows:queueRows});
const capabilityRef=ref('fixture-match-capability',{id:'B07.complete-match.v1'});
const tasks=(pilot?['train']:['train','dev']).map(split=>{const task={schemaVersion:1,taskId:'fixture-source-'+split,runId:'fixture-run-'+split,planRef,budgetRef,taskKind:'collect',capabilityRef,parentPolicyRef:actingReleaseRef,scientificContract:{comparisonRef},sourcePlan:{namespace,sourceIndexRef,split,familyIds:[...new Set(queueRows.filter(q=>q.split===split).flatMap(q=>q.roundFamilyIds))]},seatLayoutPlan:queueRef,planScope:{clauseRef:sourceClauseRef,branchRef:null},outputRoot:join(runRoot,'records-'+split)};mkdirSync(task.outputRoot);return{task,taskRef:ref(task.taskId,task)};});
const encoder={schema:'v2',ctxFill:'rule-context',passEncoding:'action64'} as const;
let actualActions=0;
function record(q:any,fixtureIndex:number){
 const task=tasks[0].task,deck=buildDeck(),take=(rank:number)=>deck.splice(deck.findIndex(card=>card.rank===rank),1)[0],actor=q.actor,partner=(actor+2)%4,after=(actor+3)%4,enemy=(actor+1)%4;
 const hands:any=[[],[],[],[]];const ownHigh=take(10+Math.floor(fixtureIndex/6)),target=take(3);hands[actor]=[ownHigh,...deck.splice(0,26)];hands[partner]=[target,...deck.splice(0,26)];hands[after]=deck.splice(0,27);hands[enemy]=deck.splice(0,27);
 const ctx=makeLevelCtx([14,14],'stage',0),state:GameState={match:{opts:DEFAULT_RULES,levels:[14,14],gameNo:1,winner:null,rngState:fixtureIndex+1,lastHead:null,lastResult:null},ctx,levelsBefore:[14,14],stageTeam:0,hands,turn:partner,leader:partner,lastCombo:null,lastPlayer:partner,passCount:0,trickPlays:[],finished:[],over:false,result:null,moveNo:0,tribute:null,pendingReturns:[]};
 const capture={studentParentRef,scorer,migrationReceiptRef},store=createMatchStore(task.outputRoot,{runId:task.runId,matchId:q.matchId,sourceRef:sourceIndexRef,layoutRef:queueRef,policyIds:Array.from({length:4},(_,seat)=>seat===actor?identity.policyId:'fixture-prefix'),rules:DEFAULT_RULES,seatSnapshots:Array.from({length:4},(_,seat)=>seat===actor?{policyIdentity:identity,releaseRef:actingReleaseRef,firstRoundCapture:capture}:{}),evaluatedActor:actor,split:'train'}),recorder=store.recorder,tracker=new PublicTracker();
 recorder.beginGame(state,q.sourceFamilyId);
 const confirm=(move:any,captured=false)=>{
  const key={controllerOrRunnerGeneration:1,matchId:q.matchId,gameNo:1,moveNo:state.moveNo,actorSeat:state.turn,requestSeq:state.moveNo};
  let actionId='fixture-prefix';
  if(captured){
   const cover=classify([ownHigh],ctx,DEFAULT_RULES).find(combo=>combo.kind==='single')!;
   const bundle=createDecisionBundle({state,actorSeat:actor,decisionId:'session-decision-'+fixtureIndex,matchId:q.matchId,history:recorder.history(1),key,candidatePolicy:policy,decider:{seat:actor,decide:()=>({move:{pass:false,combo:cover},nCands:2,explored:false,candidatePolicy:policy,ranking:[{combo:cover,idx:0,score:1},{combo:null,idx:1,score:0}]})}});
   const candidateInputs=captureInitialCandidateInputs({bundle,state,tracker,encoder,policyIdentity:identity as any}),studentInputs=captureStudentCandidateInputs({bundle,state,tracker,candidateInputs,student:{studentParentRef,scorer:scorer as any,network:{inputDim:423,forward:(_x:any,n:number)=>new Float32Array(n)} as any}});
   recorder.beginDecision({key,policyId:identity.policyId,initialCandidateIds:bundle.initialCandidateIds,offeredIds:bundle.initialCandidateIds,bundle,candidateInputs,studentInputs});actionId=bundle.pool.find(candidate=>candidate.canonical===null)!.actionId;
  }else recorder.beginDecision({key,policyId:'fixture-prefix',initialCandidateIds:['fixture-prefix'],offeredIds:['fixture-prefix']});
  const priorTarget=state.lastCombo,events=applyMove(state,move);tracker.observe(events);recorder.confirmAction({key,move,events,priorTarget,actionId,requestedActionId:actionId,source:captured?'B':'fixture-prefix',status:'selected'});actualActions++;
 };
 confirm({pass:false,combo:classify([target],ctx,DEFAULT_RULES).find(combo=>combo.kind==='single')!});confirm({pass:true});assert.equal(state.turn,actor);confirm({pass:true},q.group===0&&q.side===0);
 for(let n=0;n<512&&!state.over;n++){
  let move:any={pass:true};for(const card of state.hands[state.turn]){const combo=classify([card],state.ctx,DEFAULT_RULES).find(candidate=>candidate.kind==='single');if(combo)try{move=resolveLegalMove(state,{pass:false,combo});break;}catch{}}
  if(state.turn%2!==actor%2)try{move=resolveLegalMove(state,{pass:true});}catch{}
  confirm(move);
 }
 assert(state.over&&state.match.winner!==null,'finite original engine terminal required: '+JSON.stringify({over:state.over,winner:state.match.winner,result:state.result}));recorder.finish({complete:true,winner:state.match.winner,incompleteReason:null});
 const snapshot=recorder.snapshot(),replayed=replayConfirmedMatch(snapshot.record,snapshot.privateSources);assert.equal(replayed.complete,true);assert.equal(replayed.winner,state.match.winner);
 return {matchId:q.matchId,recordRef:store.ref(),result:{complete:true,winner:state.match.winner,incompleteReason:null}};
}
const matches=queueRows.map(record),runs=tasks.map(({task,taskRef})=>{
 const checkpoint={schema:'ohuo-match-run-v1',taskSHA256:digest(task),queueRef,matches,active:null,executionUnknown:false,cursor:matches.length},checkpointSHA256=digest(checkpoint),checkpointRef=join(task.outputRoot,`checkpoint-${checkpointSHA256}.json`);writeFileSync(checkpointRef,JSON.stringify(checkpoint));return {runId:task.runId,task,taskRef,taskSHA256:digest(task),checkpoint,checkpointSHA256,checkpointRef,status:'completed',cleanupConfirmed:true};
});
const ledger={planRef,authorizationRef,researchBatchId:'fixture-batch',limits:budget.limits,used:{providerRequests:0,labelDecisions:0,optimizerSteps:0,matchAttempts:0},reservations:{},activeRunId:null},state={schemaVersion:1,tasks:Object.fromEntries(runs.map(run=>[run.task.taskId,run.runId])),runs:Object.fromEntries(runs.map(run=>[run.runId,run])),budgets:{[budgetRef]:ledger},batches:{'fixture-batch':{budgetRef,planRef,authorizationRef}}},statePath=join(controlRoot,'state.json');
writeFileSync(statePath,JSON.stringify(state));const controlStateRef=evidence('control-state',state),freezeEvidenceRef=evidence('freeze-evidence',{schema:'ohuo-selection-prequery-v1',planRef,clauseRef,branchRef:null,budgetRef,controlRoot,controlStateRef}),quotaBasisRef=evidence('quota-basis',{schema:'ohuo-selection-quota-basis-v1',planRef,budgetRef,controlStateRef,stage2Stage3AccountingRefs:[],originalQuotas:quotas,frozenQuotas:quotas,reasonRef:evidence('quota-reason',{fixture:true,datasetEligible:false}),freezeEvidenceRef});
const targetDefinitionRef=ref('fixture-target-definition',FIRST_ROUND_TARGET_DEFINITION),rule={schema:'ohuo-offline-selection-first-round-pilot-rule-v1',purpose:'cost-pilot-only',pilotNamespace:namespace,targetDefinitionRef,comparisonRef,layoutOrder:[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]],hashAlgorithm:'sha256',hashInput:'decisionId-utf8-no-normalization',hashTieBreak:'decisionId-utf8-bytes-then-canonical-DecisionKey',targetQuotaRounding:'all-target-up-to-frozen-quota',ordinaryShortfall:'not-demo',keepRule:'none-cost-pilot-only',familySplitRule:'pilot-train-only-no-training-admission',postValidationKeepRule:'none-cost-pilot-only'},selectionRuleRef=ref('fixture-selection-rule',rule);
const spec:OfflineSelectionSpec={schema:'ohuo-offline-selection-spec-v1',planRef,clauseRef,branchRef:null,sourceIndexRef,queueRef,sourceRunRefs:runs.map((run,i)=>evidence('source-run-'+i,run)),targetDefinitionRef,selectionRuleRef,quotaBasisRef,purpose:'b_training_source',actingReleaseRef,outputId:runRoot.split('/').at(-1)!+'-selection'},trusted={repositoryRoot:root,references,evidenceFiles,sourceIndexPath,confirmedRecordRoots:tasks.map(row=>row.task.outputRoot),controlRoot,mode:'research' as const,phase:'freeze' as const};
const produced=prepareOfflineSelection(spec,trusted);assert.equal(produced.production.verification,'reproduced');assert(produced.selection.rows.length>0,'use actual original target snapshots, not an empty proof stub');
for(const row of produced.files)evidenceFiles.set(row.id,row.file);references.set(produced.specRef,plain(spec));references.set(produced.productionRef,plain(produced.production));
const labelCapability=ref('fixture-label-capability',{id:'B07.offline-label.v1'}),labelTask={schemaVersion:1,taskId:'fixture-label',runId:'fixture-label-run',taskKind:'collect',capabilityRef:labelCapability,planRef,budgetRef,datasetRefs:[produced.selectionRef],sourcePlan:{namespace,sourceIndexRef,split:'train',familyIds:families},seatLayoutPlan:queueRef,releaseRefs:[actingReleaseRef],parentPolicyRef:actingReleaseRef};
const makeSession=()=>selector.createOfflineSelectionReproductionSession({references,evidenceFiles}),session=makeSession(),labelInputs={...trusted,phase:'label-start' as const,task:labelTask,reproductionSession:session};
const count=()=>enumerations,before=count(),cold=verifyOfflineSelection(produced.selection,labelInputs),coldTraversals=count()-before;assert(coldTraversals>0,'cold must traverse the real original source inventory');
const hitBefore=count(),hit=verifyOfflineSelection(produced.selection,labelInputs);assert.equal(count(),hitBefore,'same session must skip enumerate, not only duplicate its result');assert.deepEqual(hit,cold);
const retained=plain(cold);cold.population[0].inputSHA256='caller-mutation';assert.deepEqual(verifyOfflineSelection(produced.selection,{...labelInputs}),retained,'returned proof must not alias the frozen cache');
const checkCold=(inputs:any)=>{const n=count();const value=verifyOfflineSelection(produced.selection,inputs);assert(count()>n,'distinct/no session must execute original enumerate');assert.deepEqual(value,retained);};
checkCold({...labelInputs,reproductionSession:{}});checkCold({...labelInputs,reproductionSession:makeSession()});checkCold({...labelInputs,reproductionSession:undefined});checkCold({...labelInputs,task:{...labelTask,taskId:'other-label',runId:'other-label-run'}});checkCold({...labelInputs,phase:'dataset'});
const alternateReferences=new ObservedMap(references);alternateReferences.set(ref('catalog-extra',{fixture:'different-fixed-view'}),{fixture:'different-fixed-view'});checkCold({...labelInputs,references:alternateReferences});references.delete([...references.keys()].find(key=>key.startsWith('catalog-extra@'))!);
const exposure=plain(state),prior={...labelTask,taskId:'earlier',runId:'earlier-run',datasetRefs:[referenceOf('different-selection',{fixture:true})]};exposure.runs[prior.runId]={runId:prior.runId,task:prior,checkpoint:{rows:[{requestCount:1}],active:null,executionUnknown:false}};writeFileSync(statePath,JSON.stringify(exposure));
const beforeReject=count();assert.throws(()=>verifyOfflineSelection(produced.selection,labelInputs),/selection_changed_after_label_exposure/);assert.equal(count(),beforeReject,'live exposure rejection must remain outside a cache hit');
const resumeState=plain(state);resumeState.runs[labelTask.runId]={runId:labelTask.runId,task:labelTask,taskSHA256:digest(labelTask),checkpoint:{selectionRef:produced.selectionRef,rows:[],active:null,executionUnknown:false}};writeFileSync(statePath,JSON.stringify(resumeState));
const resumeInputs={...labelInputs,phase:'label-resume' as const};checkCold(resumeInputs);resumeState.runs[labelTask.runId].checkpoint.executionUnknown=true;writeFileSync(statePath,JSON.stringify(resumeState));const beforeUnknown=count();assert.throws(()=>verifyOfflineSelection(produced.selection,resumeInputs),/selection_resume_binding/);assert.equal(count(),beforeUnknown,'unknown resume must still reject on cache hit');
writeFileSync(statePath,JSON.stringify(state));
return {schema:'ohuo-selection-reproduction-session-check-v1',case:'training.selection-reproduction-session',status:'passed',fixtureRoot:runRoot,completeSyntheticMiniMatches:matches.length,syntheticConfirmedActions:actualActions,selectedFixtureRows:produced.selection.rows.length,coldTraversals,identicalColdHit:true,independentFrozenCopy:true,opaqueBrandTaskPhaseCatalogIsolation:true,liveExposureAndUnknownRejected:true,providerRequests:0,modelLoads:0,optimizerSteps:0,naturalResearchMatches:0,datasetEligible:false};
}
console.log(JSON.stringify(await runFixture()));
