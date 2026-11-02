/** One bounded extension of training.target-selector through the real producer.
 * Synthetic prefixes plus one three-play mini-game to reach an actual second deal; no completed matches, datasets or models. */
import assert from 'node:assert/strict';
import {checkFirstRoundBlockFreezer} from './first-round-block-freezer-smoke';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {buildDeck,classify,DEFAULT_RULES,makeLevelCtx,applyMove,type GameState,type Combo} from '@gd/engine';
import {PublicTracker} from '../../../packages/ai/src/nn/schema';
import {STUDENT_SCORER_ENCODER} from '../../../packages/ai/src/policy/descriptor';
import {RELEASES} from '../../../packages/ai/src/policy/seats';
import {createDecisionBundle} from '../../../packages/ai/src/hybrid/candidates';
import {captureInitialCandidateInputs,captureStudentCandidateInputs,createMatchStore} from '../match-record';
import {prepareOfflineSelection,verifyOfflineSelection,classifyApprovedTarget,type OfflineSelectionSpec} from '../offline-selection';
import {FIRST_ROUND_TARGET_DEFINITION} from '../first-round-target';
import {referenceOf,digest} from '../task-schema.mjs';
assert.deepEqual(process.argv.slice(2),['--case','training.target-selector']);
async function runFixture(pilot:boolean){
const root=fileURLToPath(new URL('../../../',import.meta.url)).replace(/\/$/,'');mkdirSync(join(root,'lab/out'),{recursive:true});
const runRoot=mkdtempSync(join(root,pilot?'lab/out/S35-selector-pilot-':'lab/out/S35-selector-formal-')),controlRoot=join(runRoot,'control');mkdirSync(controlRoot);
const sha=(x:string)=>createHash('sha256').update(x).digest('hex'),plain=(x:any)=>JSON.parse(JSON.stringify(x));
const references=new Map<string,any>(),evidenceFiles=new Map<string,any>();
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
const clauseRef=ref('fixture-selection-clause',{id:'fixture-selection-clause'}),sourceClauseRef=ref('fixture-source-clause',{id:'fixture-source-clause'});
const planRef=ref('fixture-plan',{actions:[{clauseRef:sourceClauseRef,branchRef:null,expectedArtifactKinds:['ohuo-match-summary-v1'],plannedTaskIds:pilot?['fixture-source-train']:['fixture-source-train','fixture-source-dev']}]});
const authorizationRef=ref('fixture-authorization',{datasetEligible:false,realTraining:false});
const budget={planRef,controlRoot,researchBatchId:'fixture-batch',authorizationRef,limits:{maxProviderRequests:quotas.length*2,maxLabelDecisions:quotas.length*2,maxOptimizerSteps:0,maxMatchAttempts:0}},budgetRef=ref('fixture-budget',budget);
const queueRows=quotas.flatMap((q,i)=>Array.from({length:6},(_,layout)=>({matchId:`fixture-m${i}-${layout}`,layoutId:`fixture-layout-${layout}`,sourceFamilyId:q.familyId,split:q.split,seed:i*100+layout,dealNamespace:'fixture-only',roundFamilyIds:i===0&&layout===0?[q.familyId,secondDealFamily]:[q.familyId],actor:layout%2,metric:'fixture-only',group:Math.floor(layout/2),side:layout%2,variant:'fixture-only',maxGames:i===0&&layout===0?2:1,maxMovesPerGame:8,seats:Array.from({length:4},()=>({releaseRef:actingReleaseRef,mode:'local',profileRevisionRef:null}))})));
const queueRef=ref('fixture-queue',{schema:'ohuo-complete-match-queue-v1',namespace,sourceIndexRef,rows:queueRows});
const capabilityRef=ref('fixture-match-capability',{id:'B07.complete-match.v1'});
const tasks=(pilot?['train']:['train','dev']).map(split=>{const task={schemaVersion:1,taskId:'fixture-source-'+split,runId:'fixture-run-'+split,planRef,budgetRef,taskKind:'collect',capabilityRef,parentPolicyRef:actingReleaseRef,scientificContract:{comparisonRef},sourcePlan:{sourceIndexRef,split,familyIds:[...new Set(queueRows.filter(q=>q.split===split).flatMap(q=>q.roundFamilyIds))]},seatLayoutPlan:queueRef,planScope:{clauseRef:sourceClauseRef,branchRef:null},outputRoot:join(runRoot,'records-'+split)};mkdirSync(task.outputRoot);return{task,taskRef:ref(task.taskId,task)};});
const encoder={schema:'v2',ctxFill:'rule-context',passEncoding:'action64'} as const;
function record(q:any,kind:'target'|'ordinary'|'gap'|'unknown',familyIndex:number){
 const task=tasks.find(x=>x.task.sourcePlan.split===q.split)!.task,deck=buildDeck();
 // Distinct synthetic sources across families; never claim six layouts independent.
 const take=(rank:number)=>deck.splice(deck.findIndex(c=>c.rank===rank),1)[0],ownHigh=take(10+familyIndex),target=take(3+familyIndex),ctx=makeLevelCtx([9,9],'stage',0);
 const hands=[[],[],[],[]] as any;hands[0]=[ownHigh,...deck.splice(0,26)];const leader=kind==='ordinary'?1:2;hands[leader]=[target,...deck.splice(0,26)];for(let a=0;a<4;a++)if(!hands[a].length)hands[a]=deck.splice(0,27);
 const state:GameState={match:{opts:DEFAULT_RULES,levels:[9,9],gameNo:1,winner:null,rngState:familyIndex+1,lastHead:null,lastResult:null},ctx,levelsBefore:[9,9],stageTeam:0,hands,turn:leader,leader,lastCombo:null,lastPlayer:leader,passCount:0,trickPlays:[],finished:[],over:false,result:null,moveNo:0,tribute:null,pendingReturns:[]};
 const firstRoundCapture={studentParentRef,scorer,migrationReceiptRef};
 const store=createMatchStore(task.outputRoot,{runId:task.runId,matchId:q.matchId,sourceRef:sourceIndexRef,layoutRef:queueRef,policyIds:[identity.policyId,'fixture','fixture','fixture'],rules:DEFAULT_RULES,seatSnapshots:[{policyIdentity:identity,releaseRef:actingReleaseRef,firstRoundCapture},{},{},{}],evaluatedActor:0,split:q.split});const recorder=store.recorder;
 // Real recorder/replay chain: first tiny synthetic game actually reaches over,
 // then game2 captures a distinct actual deal ID under the same root block.
 if(q.roundFamilyIds.length===2){
  const tinyDeck=buildDeck(),one=(rank:number)=>[tinyDeck.splice(tinyDeck.findIndex(c=>c.rank===rank),1)[0]];
  const first:GameState={...structuredClone(state),match:{...structuredClone(state.match),levels:[9,7]},ctx:makeLevelCtx([9,7],'stage',0),levelsBefore:[9,7],hands:[one(8),one(2),one(3),one(4)],turn:1,leader:1,lastPlayer:1};
  recorder.beginGame(first,q.roundFamilyIds[0]);
  for(let n=0;n<3;n++){
   const actor=first.turn,combo=classify(first.hands[actor],first.ctx,DEFAULT_RULES).find(c=>c.kind==='single')!,move={pass:false as const,combo},key={controllerOrRunnerGeneration:1,matchId:q.matchId,gameNo:1,moveNo:first.moveNo,actorSeat:actor,requestSeq:first.moveNo};
   recorder.beginDecision({key,policyId:'fixture-prefix',initialCandidateIds:['prefix'],offeredIds:['prefix']});const priorTarget=first.lastCombo,events=applyMove(first,move);recorder.confirmAction({key,move,events,priorTarget,actionId:'prefix',requestedActionId:'prefix',source:'fixture-prefix',status:'selected'});
  }
  assert(first.over);assert.equal(first.match.winner,null);assert.deepEqual(first.result!.levelsAfter,[9,9]);
  state.match.gameNo=2;state.match.lastResult=structuredClone(first.result);state.match.lastHead=first.match.lastHead;state.stageTeam=first.result!.winnerTeam;state.ctx=makeLevelCtx([9,9],'stage',state.stageTeam);
 }
 const gameNo=state.match.gameNo;recorder.beginGame(state,q.roundFamilyIds[gameNo-1]);const tracker=new PublicTracker();
 const targetCombo=classify([target],ctx,DEFAULT_RULES).find(c=>c.kind==='single')!;
 for(const move of [{pass:false as const,combo:targetCombo},...Array.from({length:kind==='ordinary'?2:1},()=>({pass:true as const}))]){const key={controllerOrRunnerGeneration:1,matchId:q.matchId,gameNo,moveNo:state.moveNo,actorSeat:state.turn,requestSeq:(gameNo-1)*100+state.moveNo};recorder.beginDecision({key,policyId:'fixture-prefix',initialCandidateIds:['prefix'],offeredIds:['prefix']});const priorTarget=state.lastCombo,events=applyMove(state,move);tracker.observe(events);recorder.confirmAction({key,move,events,priorTarget,actionId:'prefix',requestedActionId:'prefix',source:'fixture-prefix',status:'selected'});}
 assert.equal(state.turn,0);const cover=classify([ownHigh],ctx,DEFAULT_RULES).find(c=>c.kind==='single')!,key={controllerOrRunnerGeneration:1,matchId:q.matchId,gameNo,moveNo:state.moveNo,actorSeat:0,requestSeq:(gameNo-1)*100+state.moveNo};
 let bundle:any=createDecisionBundle({state,actorSeat:0,decisionId:`fixture-decision-${familyIndex}-${kind}`,matchId:q.matchId,history:recorder.history(gameNo),key,candidatePolicy:policy,decider:{seat:0,decide:()=>({move:{pass:false,combo:cover},nCands:2,explored:false,candidatePolicy:policy,ranking:[{combo:cover,idx:0,score:1},{combo:null,idx:1,score:0}]})}});
 if(kind==='gap'||kind==='unknown'){bundle=plain(bundle);const pass=bundle.pool.find((x:any)=>x.canonical===null);bundle.initialCandidateIds=[pass.actionId];bundle.offeredIds=[pass.actionId];bundle.fallbackActionId=pass.actionId;bundle.isUniqueLegalAction=false;if(kind==='unknown')bundle.pool=[pass];}
 const candidateInputs=captureInitialCandidateInputs({bundle,state,tracker,encoder,policyIdentity:identity as any}),studentInputs=captureStudentCandidateInputs({bundle,state,tracker,candidateInputs,student:{studentParentRef,scorer:scorer as any,network:{inputDim:423,forward:(_x:any,n:number)=>new Float32Array(n)} as any}});
 recorder.beginDecision({key,policyId:identity.policyId,initialCandidateIds:bundle.initialCandidateIds,offeredIds:bundle.offeredIds,bundle,candidateInputs,studentInputs});const move={pass:true as const},priorTarget=state.lastCombo,events=applyMove(state,move);recorder.confirmAction({key,move,events,priorTarget,actionId:bundle.pool.find((x:any)=>x.canonical===null).actionId,requestedActionId:null,source:'B',status:'selected'});recorder.finish({complete:false,winner:null,incompleteReason:'finite engineering prefix only'});
 return {matchId:q.matchId,recordRef:store.ref(),result:{complete:false,incompleteReason:'finite engineering prefix only'}};
}
// Eight normal roots + two explicit coverage exclusions; all use side0 actor0.
const matches=quotas.flatMap((q,i)=>[record(queueRows[i*6],'target',i),...(pilot?[]:[record(queueRows[i*6+2],'ordinary',i)])]);
if(!pilot)matches.push(record(queueRows[4],'gap',0),record(queueRows[10],'unknown',1));
const runs=tasks.map(({task,taskRef})=>{const checkpoint={schema:'ohuo-match-run-v1',taskSHA256:digest(task),queueRef,matches:matches.filter(m=>queueRows.find(q=>q.matchId===m.matchId)!.split===task.sourcePlan.split),active:null,executionUnknown:false,cursor:0};checkpoint.cursor=checkpoint.matches.length;const checkpointSHA256=digest(checkpoint),checkpointRef=join(task.outputRoot,`checkpoint-${checkpointSHA256}.json`);writeFileSync(checkpointRef,JSON.stringify(checkpoint));return{runId:task.runId,task,taskRef,taskSHA256:digest(task),checkpoint,checkpointSHA256,checkpointRef,status:'interrupted',cleanupConfirmed:true};});
const ledger={planRef,authorizationRef,researchBatchId:'fixture-batch',limits:budget.limits,used:{providerRequests:0,labelDecisions:0,optimizerSteps:0,matchAttempts:0},reservations:{},activeRunId:null};
const state={schemaVersion:1,tasks:{},runs:Object.fromEntries(runs.map(x=>[x.runId,x])),budgets:{[budgetRef]:ledger},batches:{'fixture-batch':{budgetRef,planRef,authorizationRef}}};
const statePath=join(controlRoot,'state.json');writeFileSync(statePath,JSON.stringify(state));const controlStateRef=evidence('control-state',state);
const freezeEvidenceRef=evidence('freeze-evidence',{schema:'ohuo-selection-prequery-v1',planRef,clauseRef,branchRef:null,budgetRef,controlRoot,controlStateRef});
const quotaBasisRef=evidence('quota-basis',{schema:'ohuo-selection-quota-basis-v1',planRef,budgetRef,controlStateRef,stage2Stage3AccountingRefs:[],originalQuotas:quotas,frozenQuotas:quotas,reasonRef:evidence('quota-reason',{datasetEligible:false,realTraining:false}),freezeEvidenceRef});
const targetDefinitionRef=ref('fixture-target-definition',FIRST_ROUND_TARGET_DEFINITION);
const rule={schema:pilot?'ohuo-offline-selection-first-round-pilot-rule-v1':'ohuo-offline-selection-first-round-rule-v1',...(pilot?{purpose:'cost-pilot-only',pilotNamespace:namespace}:{}),targetDefinitionRef,comparisonRef,layoutOrder:[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]],hashAlgorithm:'sha256',hashInput:'decisionId-utf8-no-normalization',hashTieBreak:'decisionId-utf8-bytes-then-canonical-DecisionKey',targetQuotaRounding:'all-target-up-to-frozen-quota',ordinaryShortfall:'not-demo',keepRule:pilot?'none-cost-pilot-only':'same-count-ordinary-disjoint-context',familySplitRule:pilot?'pilot-train-only-no-training-admission':'sha256-familyId-utf8-first-two-dev',postValidationKeepRule:pilot?'none-cost-pilot-only':'same-split-frozen-rank-prefix-equal-valid-demo'};
const selectionRuleRef=ref('fixture-selection-rule',rule);
const spec:OfflineSelectionSpec={schema:'ohuo-offline-selection-spec-v1',planRef,clauseRef,branchRef:null,sourceIndexRef,queueRef,sourceRunRefs:runs.map((r,i)=>evidence('source-run-'+i,r)),targetDefinitionRef,selectionRuleRef,quotaBasisRef,purpose:'b_training_source',actingReleaseRef,outputId:runRoot.split('/').at(-1)!+'-selection'};
const trusted={repositoryRoot:root,references,evidenceFiles,sourceIndexPath,confirmedRecordRoots:tasks.map(x=>x.task.outputRoot),controlRoot,mode:'research' as const,phase:'freeze' as const};
const produced=prepareOfflineSelection(spec,trusted);
assert.equal(produced.selection.rows.length,quotas.length,'one real target per family, not old floor-half ordinary mixtures');assert.equal(produced.production.counts.keep,pilot?0:4);assert.equal(produced.production.verification,'incomplete','finite prefixes never masquerade as completed research sources');
for(const f of produced.files)evidenceFiles.set(f.id,f.file);references.set(produced.specRef,plain(spec));references.set(produced.productionRef,plain(produced.production));
const verified=verifyOfflineSelection(produced.selection,{...trusted,phase:'dataset'});
assert.deepEqual(verified.selectionRule,rule,'proof exposes cost-pilot-only identity without granting dataset eligibility');
assert(verified.selectedMetadata.filter(x=>x.sampleKind==='demo').every(x=>x.sampleClass==='target'));assert(verified.selectedMetadata.filter(x=>x.sampleKind==='keep').every(x=>x.sampleClass==='ordinary'));
assert.equal(verified.exclusions.filter(x=>x.reason==='candidate_coverage_gap').length,pilot?0:1);assert.equal(verified.exclusions.filter(x=>x.reason==='candidate_coverage_unknown').length,pilot?0:1);assert.equal(verified.population.filter(x=>x.sampleClass==='target').length,pilot?2:5);
assert.equal(verified.exclusions.filter(x=>x.reason==='target_shortfall').length,quotas.length);assert.equal(verified.population.length,pilot?2:10);assert.deepEqual(prepareOfflineSelection(spec,trusted),produced,'manifest-last same-byte reuse, no reselect');
for(const split of (pilot?['train']:['train','dev'])){const byId=new Map(verified.population.map(x=>[x.decisionId,x]));const rows=verified.selectedMetadata.filter(x=>byId.get(x.decisionId)!.split===split);assert.equal(rows.filter(x=>x.sampleKind==='demo').length,2);assert.equal(rows.filter(x=>x.sampleKind==='keep').length,pilot?0:2);assert.equal(new Set(rows.map(x=>x.contextSHA256)).size,pilot?2:4);}
const second=verified.population.find(x=>x.key.gameNo===2)!;
assert(second,'real second game was replayed');assert.equal(second.familyId,secondDealFamily);assert.equal(second.blockFamilyId,families[0]);
assert.equal(produced.selection.quotas.find(x=>x.familyId===families[0])!.count,1,'second-deal target consumes its root quota');
assert.equal(produced.selection.quotas.length,quotas.length,'future actual deal is not another independent family');
assert(verified.selectedMetadata.every(x=>families.includes(x.blockFamilyId!)),'metadata preserves root block');
assert(produced.selection.rows.some(x=>x.key.gameNo===2&&x.familyId===secondDealFamily&&x.blockFamilyId===families[0]));
// Rebind an internally consistent, unexecuted source proof with one conflicting
// future deal; failure must be ancestry, not a stale queue/run hash.
const conflictingQueue=plain(references.get(queueRef));const otherBlock=pilot?1:2;conflictingQueue.rows[otherBlock*6].roundFamilyIds.push(secondDealFamily);conflictingQueue.rows[otherBlock*6].maxGames++;
const conflictingQueueRef=ref('fixture-conflicting-queue',conflictingQueue),conflictRefs=new Map(references);
for(const entry of tasks){conflictRefs.delete(entry.taskRef);const changed=plain(entry.task);changed.seatLayoutPlan=conflictingQueueRef;changed.sourcePlan.familyIds=[...new Set(conflictingQueue.rows.filter((q:any)=>q.split===changed.sourcePlan.split).flatMap((q:any)=>q.roundFamilyIds))];conflictRefs.set(referenceOf(changed.taskId,changed),changed);}
const emptyState={...plain(state),runs:{}},emptyControlStateRef=evidence('conflict-state',emptyState),conflictFreezeRef=evidence('conflict-freeze',{schema:'ohuo-selection-prequery-v1',planRef,clauseRef,branchRef:null,budgetRef,controlRoot,controlStateRef:emptyControlStateRef});
const conflictQuota=JSON.parse(readFileSync(join(runRoot,'quota-basis.json'),'utf8'));conflictQuota.controlStateRef=emptyControlStateRef;conflictQuota.freezeEvidenceRef=conflictFreezeRef;
const conflictSpec={...spec,queueRef:conflictingQueueRef,sourceRunRefs:[],quotaBasisRef:evidence('conflict-quota',conflictQuota),outputId:spec.outputId+'-ancestry-conflict'};
writeFileSync(statePath,JSON.stringify(emptyState));assert.throws(()=>prepareOfflineSelection(conflictSpec,{...trusted,references:conflictRefs}),/selection_first_round_deal_block_leakage/);writeFileSync(statePath,JSON.stringify(state));
const checkReject=(name:string,change:(spec:any)=>void,pattern:RegExp)=>{const s=plain(spec);s.outputId+='-'+name;change(s);assert.throws(()=>prepareOfflineSelection(s,trusted),pattern);};
checkReject('legacy-rule',s=>{const {comparisonRef:_,familySplitRule:__,...legacyRule}=rule;s.selectionRuleRef=ref('fixture-legacy-rule',{...legacyRule,schema:'ohuo-offline-selection-rule-v1',targetQuotaRounding:'floor-half',ordinaryShortfall:'report-no-extra-target'});},/target_definition_unimplemented|selection_rule_unimplemented/);
checkReject('quota-over',s=>{const bad=JSON.parse(readFileSync(join(runRoot,'quota-basis.json'),'utf8'));bad.originalQuotas[0].count=9;bad.frozenQuotas[0].count=9;s.quotaBasisRef=evidence('quota-over',bad);},/selection_first_round_(pilot_)?family_coverage/);
checkReject('split',s=>{const bad=JSON.parse(readFileSync(join(runRoot,'quota-basis.json'),'utf8'));for(const q of [...bad.originalQuotas,...bad.frozenQuotas])q.split=q.split==='train'?'dev':'train';s.quotaBasisRef=evidence('quota-wrong-split',bad);},/selection_first_round_family_split|selection_first_round_pilot_family_coverage/);
checkReject('budget',s=>{const bad=JSON.parse(readFileSync(join(runRoot,'quota-basis.json'),'utf8'));for(const q of [...bad.originalQuotas,...bad.frozenQuotas])q.count=3;s.quotaBasisRef=evidence('quota-underfunded',bad);},/selection_budget_cannot_cover_frozen_quotas/);
checkReject('source-proof',s=>{const bad=plain(runs[0]);bad.checkpoint.cursor++;s.sourceRunRefs[0]=evidence('source-run-tampered',bad);},/selection_source_run_identity/);
if(pilot)checkReject('pilot-namespace',s=>{s.selectionRuleRef=ref('wrong-pilot-namespace',{...rule,pilotNamespace:'not-the-frozen-pilot-namespace'});},/selection_pilot_namespace/);
const syntheticDefinition={schema:'ohuo-approved-public-target-v1',id:'synthetic-own-rank-2-v1',scope:'offline_synthetic',field:'ownHand',rule:'contains-rank-2'};
assert.deepEqual(classifyApprovedTarget({ownHand:[{rank:2,count:1}]},syntheticDefinition,'offline_synthetic'),{sampleClass:'target'});assert.deepEqual(classifyApprovedTarget({ownHand:[]},syntheticDefinition,'offline_synthetic'),{sampleClass:'ordinary'});assert.throws(()=>classifyApprovedTarget({ownHand:[]},syntheticDefinition,'research'),/target_definition_unimplemented/);
const blockFreezerChecks=pilot?null:await checkFirstRoundBlockFreezer(verified,trusted);
return {blockFreezerChecks,purpose:pilot?'cost-pilot-only':'formal-first-round',datasetEligible:false,realTraining:false,counts:produced.production.counts,sourceVerification:produced.production.verification,secondGame:{gameNo:second.key.gameNo,actualFamilyId:second.familyId,blockFamilyId:second.blockFamilyId},checks:{secondDealReplay:true,rootQuotaOnce:true,ancestryReuseRejected:true,targetOnly:true,ordinaryKeepSameSplit:!pilot,pilotNoKeep:pilot,sourceProofReproduction:true,actualBudgetPreflight:true},providerRequests:0,optimizerSteps:0,completeMatches:0,syntheticMiniGamesCompleted:1,fixtureRoot:runRoot};
}
const formal=await runFixture(false),pilot=await runFixture(true);
console.log(JSON.stringify({case:'training.target-selector',status:'PASS',scope:'supplemental cloud synthetic producer proof; not research eligibility or Mac acceptance',formal,pilot}));
