/** Actual finite recorder/capture ingress; synthetic source and network only. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {MLP} from '../../../packages/ai/src/nn/mlp';
import {PublicTracker} from '../../../packages/ai/src/nn/schema';
import {STUDENT_SCORER_ENCODER} from '../../../packages/ai/src/policy/descriptor';
import {DEFAULT_RULES,legalCombos,makeLevelCtx,classify,canPass,buildDeck,sortHand,applyMove,type Card,type Combo,type GameState} from '@gd/engine';
import {resolveLegalMove} from '../../../packages/ai/src/hybrid/legality';
import {createDecisionBundle} from '../../../packages/ai/src/hybrid/candidates';
import {dedupCandidates,type NeuralDecision} from '../../../packages/ai/src/nn/neuralSeat';
import {captureInitialCandidateInputs,captureStudentCandidateInputs,createMatchStore} from '../match-record';
import {freezeDataset,loadFrozenDataset,prepareOfflineLabel,dataHash,type DatasetPlan,type ExportRow} from '../distill-data';
import {readOfflineSnapshot} from '../offline-label-source';
import {selectRemoteDecision} from '../../../packages/ai/src/hybrid/remote-selector';
import {rerankStudent423InitialCandidates} from '../../../packages/ai/src/hybrid/student';
import {referenceOf} from '../task-schema.mjs';
import {checkFirstRoundRuntime,checkFirstRoundMatchRuntime} from './first-round-runtime-smoke';
import {checkFirstRoundBlindRuntime} from './first-round-blind-runtime-smoke';
import {checkFirstRoundEvidence} from './first-round-evidence-smoke';
assert.deepEqual(process.argv.slice(2),['--case','training.capture-freeze-smoke']);
const fixtureRoot=fileURLToPath(new URL('../../out/S35-candidate-same-set/',import.meta.url));mkdirSync(fixtureRoot,{recursive:true});const fixtureAssets=mkdtempSync(join(fixtureRoot,'S35-capture-packet-'));
const policy={candidateSpec:'first-target-offer12-v1',enumSpec:{id:'full-house-attachment-ranks-v1',enumerationMode:'all_supported_attachment_ranks'}} as const,mode=policy.enumSpec.enumerationMode;
function cards(ranks: number[], start = 0): Card[] {
  const counts = new Map<number, number>();
  return ranks.map((rank, i) => { const n = counts.get(rank) ?? 0; counts.set(rank, n + 1); return {id: start + i, rank, suit: rank > 14 ? 'J' : ['S','D','C','H','S','D','C','H'][n] as Card['suit']}; });
}
function fixture(ranks = [3,3,3,8,8,14,14], level = 10): GameState {
  const ctx = makeLevelCtx([level,level], 'stage', 0);
  const target = classify(cards([2,2,2,6,6], 90), ctx).find(c => c.kind === 'trio_pair')!;
  return {match:{opts:DEFAULT_RULES,levels:[level,level],gameNo:1,winner:null,rngState:1,lastHead:null,lastResult:null},ctx,levelsBefore:[level,level],stageTeam:0,hands:[cards(ranks),cards([5],70),cards([6],75),cards([7],80)],turn:0,leader:2,lastCombo:target,lastPlayer:2,passCount:0,trickPlays:[],finished:[],over:false,result:null,moveNo:17,tribute:null,pendingReturns:[]};
}
function legacyFixture():GameState { const s=fixture();s.lastCombo=null;s.lastPlayer=-1;s.leader=0;return s; }
function syntheticDecision(s: GameState, useNew = false, ordered?: Array<Combo|null>): NeuralDecision {
  const cands = ordered ?? dedupCandidates(legalCombos(s, useNew ? mode : 'legacy_best_pair'), canPass(s)).map(x=>x.combo);
  return { move:cands[0] ? {pass:false,combo:cands[0]} : {pass:true}, nCands:cands.length,explored:false,
    ranking:cands.map((combo,idx)=>({combo,idx,score:cands.length-idx})), ...(useNew ? {candidatePolicy:policy}: {}) };
}
function recordedTargetFixture(policyIdentity:any,suffix='train-target',ordinary=false,split='train') {
  const available=buildDeck();
  const take=(rank:number,n:number,naturalOnly=false)=>Array.from({length:n},()=>{
    const at=available.findIndex(c=>c.rank===rank&&(!naturalOnly||c.suit!=='H'));assert(at>=0);return available.splice(at,1)[0];
  });
  const own=[...take(3,4),...take(4,3),...take(8,2),...take(9,2),...take(11,2),...take(12,2),...take(13,2),...take(14,2),...take(5,2),...take(7,2),...take(10,2,true),...take(16,1),...take(17,1)];
  const targetCards=[...take(2,3),...take(11,2)];
  const state=fixture();state.hands=ordinary?[own,[...targetCards,...available.splice(0,22)],available.splice(0,27),available.splice(0,27)]:[own,available.splice(0,27),[...targetCards,...available.splice(0,22)],available.splice(0,27)];
  state.hands.forEach(sortHand);state.turn=ordinary?1:2;state.leader=state.turn;state.lastPlayer=state.turn;state.lastCombo=null;state.moveNo=0;
  const matchId='S35-fixed-'+suffix;
  const outRoot=fileURLToPath(new URL('../../out/S35-candidate-same-set/',import.meta.url));mkdirSync(outRoot,{recursive:true});const runDir=mkdtempSync(join(fixtureAssets,'root-'));
  const store=createMatchStore(runDir,{runId:'S35-finite',matchId,sourceRef:'fixed-synthetic-108',layoutRef:'seat0',policyIds:[policyIdentity.policyId,'fake','fake','fake'],rules:DEFAULT_RULES,seatSnapshots:[{policyIdentity,firstRoundCapture:captureMetadata},{},{},{}],evaluatedActor:0,split});const recorder=store.recorder;
  recorder.beginGame(state,'S35-fixed-'+split+'-family');const tracker=new PublicTracker();
  for(const move of [{pass:false as const,combo:classify(targetCards,state.ctx).find(c=>c.kind==='trio_pair')!},...Array.from({length:ordinary?2:1},()=>({pass:true as const}))]) {
    const key={controllerOrRunnerGeneration:1,matchId,gameNo:1,moveNo:state.moveNo,actorSeat:state.turn,requestSeq:state.moveNo};
    recorder.beginDecision({key,policyId:'synthetic-prefix',initialCandidateIds:['prefix'],offeredIds:['prefix']});
    const priorTarget=state.lastCombo;resolveLegalMove(state,move);const events=applyMove(state,move);tracker.observe(events);
    recorder.confirmAction({key,move,events,priorTarget,actionId:'prefix',requestedActionId:'prefix',source:'synthetic-prefix',status:'selected'});
  }
  assert.equal(state.turn,0);assert.equal(state.moveNo,ordinary?3:2);
  const raw=dedupCandidates(legalCombos(state,mode),true).map(x=>x.combo);
  const low=raw.find(c=>c?.kind==='trio_pair'&&c.mainRank===3&&c.pairRanks[0]===8)!;
  const high=(c:Combo|null)=>c?.kind==='trio_pair'&&c.mainRank===3&&c.pairRanks[0]===14;
  const ordered=[low,...raw.filter(c=>c!==low&&!high(c)),...raw.filter(high)];
  let calls=0;
  const key={controllerOrRunnerGeneration:1,matchId,gameNo:1,moveNo:state.moveNo,actorSeat:0,requestSeq:state.moveNo};
  const bundle=createDecisionBundle({state,actorSeat:0,decisionId:'S35-recorded-'+suffix,matchId,history:recorder.history(1),key,candidatePolicy:policy,decider:{seat:0,decide:(_state,opts)=>{calls++;assert.deepEqual(opts?.candidatePolicy,policy);return syntheticDecision(state,true,ordered);}}});
  assert.equal(calls,1);
  const highId=ordinary?bundle.initialCandidateIds[0]:bundle.coverage!.witnesses.find(w=>w.slot==='C')!.actionId!;
  if(!ordinary)assert(!bundle.coverage!.baseInitialCandidateIds.includes(highId));
  return {state,tracker,recorder,bundle,key,store,runDir,highId,history:recorder.history(1)};
}

const identity={policyId:'S35-synthetic-B-ranking',modelVersion:'fixed-index-score',weightsSHA256:'0'.repeat(64),inputDim:399,encoderVersion:'gd-lab-schema-v4',candidateVersion:'cand-suit-v3',passEncoding:'action64' as const,candidateCompat:undefined,architectureId:'synthetic-ranking-no-network',weightsLayoutVersion:'none',epsilon:0,tieBreakId:'first-candidate-v1',tierSpecId:'none'};
const network=new MLP(7,423),bytes=new Uint8Array(network.getWeights().buffer),scorer={schema:'ohuo-student-scorer-v1',policyId:'S35-synthetic-S0',modelVersion:'fixed-synthetic',architectureId:'mlp-tanh-256x256-scalar-v1',weightsLayoutVersion:'f32le-layer-w-row-major-then-b-v1',parameterCount:174593,inputDim:423,weightsPathOrUrl:{nodePath:relative(fileURLToPath(new URL('../../../',import.meta.url)),join(fixtureAssets,'weights.f32'))},weightsSHA256:createHash('sha256').update(bytes).digest('hex'),encoder:STUDENT_SCORER_ENCODER,tieBreakId:'first-candidate-v1'} as const;
const studentParentRef=referenceOf('synthetic-S0',{scorer}),student={studentParentRef,scorer,network};
const migrationReceiptRef={id:'synthetic-migration',sha256:dataHash({synthetic:true})},captureMetadata={studentParentRef,scorer,migrationReceiptRef};
const f=recordedTargetFixture(identity),encoder={schema:'v2',ctxFill:'rule-context',passEncoding:'action64'} as const;
const candidateInputs=captureInitialCandidateInputs({bundle:f.bundle,state:f.state,tracker:f.tracker,encoder,policyIdentity:identity});
const K=candidateInputs.candidateIds.length;assert(K>8&&K<=12,'actual added rows beyond eight, not opaque action labels');assert(f.bundle.initialCandidateIds.indexOf(f.highId)>=8);
const studentInputs=captureStudentCandidateInputs({bundle:f.bundle,state:f.state,tracker:f.tracker,candidateInputs,student});
assert.equal(studentInputs.inputDim,423);assert.equal(studentInputs.candidateFeatures.length,K);assert(studentInputs.candidateFeatures.every(x=>x.length===423&&x[405]===.25),'partner physical J2 enters every candidate row');
assert.deepEqual(studentInputs.rawQ,[...network.forward(new Float32Array(studentInputs.candidateFeatures.flat()),K)]);assert.notDeepEqual(studentInputs.rawQ,candidateInputs.rawQ,'S0 scores are separately computed, never B pool reused');
for(let i=0;i<K;i++)assert.deepEqual(studentInputs.candidateFeatures[i].slice(0,399),candidateInputs.candidateFeatures[i]);
f.recorder.beginDecision({key:f.key,policyId:identity.policyId,initialCandidateIds:f.bundle.initialCandidateIds,offeredIds:f.bundle.offeredIds,bundle:f.bundle,candidateInputs,studentInputs});
const disk=JSON.parse(readFileSync(join(f.store.ref().directory,'decision-2.private.json'),'utf8'));
assert.equal(disk.schema,'ohuo-decision-input-first-round-v3');assert.deepEqual(disk.studentInputs,JSON.parse(JSON.stringify(studentInputs)));assert.deepEqual(disk.candidateInputs.rawQ,candidateInputs.rawQ);
assert.equal(disk.studentInputs.candidateIds[K-1],f.bundle.initialCandidateIds[K-1]);
assert.throws(()=>captureStudentCandidateInputs({bundle:f.bundle,state:f.state,tracker:f.tracker,candidateInputs:{...candidateInputs,candidateIds:[...candidateInputs.candidateIds].reverse()},student}),/student capture identities/);
const changed=structuredClone(candidateInputs);changed.candidateFeatures[8][0]+=1;assert.throws(()=>captureStudentCandidateInputs({bundle:f.bundle,state:f.state,tracker:f.tracker,candidateInputs:changed,student}),/legacy segment differs/);
// The same real captured inserted row now crosses the original offline teacher,
// recorder reload and freezer. Other rows are fresh bounded synthetic roots.
writeFileSync(join(fixtureAssets,'weights.f32'),bytes);
const fakeSummary={profileId:'S35-fake-only',revision:1,snapshotHash:'0'.repeat(64),credentialRevision:0,protocol:'openai-chat-completions',requestedModel:'fake-only',returnedModel:'fake-only',requestCount:1,elapsedMs:0,upstreamChunks:0,upstreamEvents:0,contentEvents:0,keepaliveEvents:0,firstUpstreamMs:null,firstContentMs:null,usage:{}} as const;
const teacher={releaseRef:'S35-fake-teacher',promptRef:'S35-choose-only-fixture',profileSnapshot:Object.fromEntries(['profileId','revision','snapshotHash','credentialRevision','protocol','requestedModel'].map(k=>[k,(fakeSummary as any)[k]]))};
const roots=[{f,split:'train',kind:'demo',privateInput:disk},{f:recordedTargetFixture(identity,'train-keep',true),split:'train',kind:'keep'},{f:recordedTargetFixture(identity,'dev-target',false,'dev'),split:'dev',kind:'demo'},{f:recordedTargetFixture(identity,'dev-keep',true,'dev'),split:'dev',kind:'keep'}];
const rows:ExportRow[]=[];const validationRef={id:'S35-synthetic-hard-screen-only',sha256:dataHash({synthetic:true,realTraining:false})};
for(const root of roots){
 const x=root.f;let input:any=root.privateInput;
 if(!input){const base=captureInitialCandidateInputs({bundle:x.bundle,state:x.state,tracker:x.tracker,encoder,policyIdentity:identity}),captured=captureStudentCandidateInputs({bundle:x.bundle,state:x.state,tracker:x.tracker,candidateInputs:base,student});x.recorder.beginDecision({key:x.key,policyId:identity.policyId,initialCandidateIds:x.bundle.initialCandidateIds,offeredIds:x.bundle.offeredIds,bundle:x.bundle,candidateInputs:base,studentInputs:captured});input=JSON.parse(readFileSync(join(x.store.ref().directory,`decision-${x.key.requestSeq}.private.json`),'utf8'));}
 const action=x.bundle.pool[0],move=action.canonical?{pass:false as const,combo:action.canonical}:{pass:true as const},events=applyMove(structuredClone(x.state),move);
 x.recorder.confirmAction({key:x.key,move,events,priorTarget:x.state.lastCombo,actionId:action.actionId,requestedActionId:action.actionId,source:'B',status:'selected'});
 const match=JSON.parse(JSON.stringify(x.recorder.snapshot().record)),record=match.decisions.find((d:any)=>d.key.requestSeq===x.key.requestSeq);
 const reloaded=readOfflineSnapshot({recordRef:x.store.ref(),recordRoot:x.runDir,key:x.key,inputSHA256:record.trainingInputSHA256,familyId:'S35-fixed-'+root.split+'-family',split:root.split,actorSeat:0});assert.deepEqual(reloaded.input,input);
 let label:any;
 if(root.kind==='demo'){const remote=await selectRemoteDecision({bundle:x.bundle,signal:new AbortController().signal,request:async view=>{assert.deepEqual(view.candidates.map(c=>c.actionId),x.bundle.initialCandidateIds);return{status:'response' as const,response:{kind:'choose' as const,decisionId:x.bundle.decisionId,actionId:x.highId},summary:fakeSummary};}});label=prepareOfflineLabel({input,remote,state:x.state,history:x.history,teacher});}
 rows.push({sampleKind:root.kind as 'demo'|'keep',sampleClass:root.kind==='demo'?'target':'ordinary',match,record,privateInput:input,...(label?{offlineLabel:label,firstRoundValidation:{evidenceGrade:'provisional_screened' as const,direction:'takeover' as const,validationRef}}:{})});
}
const index={version:1,families:{'S35-fixed-train-family':{split:'train'},'S35-fixed-dev-family':{split:'dev'}}},indexBytes=JSON.stringify(index),indexPath=join(f.runDir,'source-index.json');writeFileSync(indexPath,indexBytes);
const queue={schema:'ohuo-complete-match-queue-v1',sourceIndexRef:'fixed-synthetic-108',rows:roots.map(x=>({matchId:x.f.key.matchId,roundFamilyIds:['S35-fixed-'+x.split+'-family'],split:x.split,actor:0}))};
const identities={basePolicy:JSON.parse(JSON.stringify(identity)),teacher,encoderVersion:'student-input399plus24-v1',encoderConfig:STUDENT_SCORER_ENCODER,proposalEncoderConfig:encoder,candidateSpecRef:policy.candidateSpec,candidatePolicy:policy,promptRef:teacher.promptRef,studentParentRef,studentScorer:scorer,migrationReceiptRef};
const plan:DatasetPlan={schema:'ohuo-distill-plan-first-round-v3',datasetId:'S35-captured-K10-423-fixture',purpose:'engineering_fixture',sourceIndexRef:'fixed-synthetic-108',sourceIndexSHA256:createHash('sha256').update(indexBytes).digest('hex'),queueRef:'seat0',queueSHA256:dataHash(queue),samplingRef:'S35-fixed-engineering',identities,families:['train','dev'].map(split=>({sourceFamily:'S35-fixed-'+split+'-family',split:split as 'train'|'dev',sourceRefs:['synthetic-'+split]})),games:roots.map(x=>({matchId:x.f.key.matchId,gameNo:1,sourceFamily:'S35-fixed-'+x.split+'-family',split:x.split as 'train'|'dev',sourceRef:'synthetic-'+x.split,sourceSHA256:x.f.recorder.snapshot().record.games[0].sourceSHA256,actorSeat:0}))};
const dataset=freezeDataset({plan,sourceIndexPath:indexPath,sourceQueue:queue,rows,outputDir:join(f.runDir,'frozen')}),loaded=loadFrozenDataset(dataset,{expectedIdentities:identities});
assert.equal(loaded.samples.length,4,JSON.stringify(loaded.manifest.exclusions));assert.equal(loaded.manifest.qualification.eligible,false);assert.equal(loaded.manifest.qualification.Ndemo,1);assert.equal(loaded.manifest.qualification.Nkeep,1);
const inserted=loaded.samples.find(x=>x.decisionId===f.bundle.decisionId)!;assert.deepEqual(inserted.candidateIds,f.bundle.initialCandidateIds);assert.deepEqual((inserted as any).targetIds,[f.highId]);assert.equal(inserted.candidateFeatures[8].length,423);assert.deepEqual(inserted.rawQ,studentInputs.rawQ);assert.deepEqual(inserted.proposalRawQ,candidateInputs.rawQ);
const selected=rerankStudent423InitialCandidates(f.bundle,disk.studentInputs,{inputDim:423,forward:(_x:Float32Array,n:number)=>Float32Array.from({length:n},(_,i)=>i===8?1:0)} as MLP);assert.equal(selected.actionId,f.highId,'same real inserted row reaches S rerank');
// Same fixed roots also prove freezer exclusion of an observed strong conflict,
// not merely a pure qualification flag. This second artifact remains engineering-only.
const conflictRows=structuredClone(rows),devRoot=roots[2].f,devInput=conflictRows[2].privateInput;
const passId=devRoot.bundle.pool.find(c=>c.canonical===null)!.actionId;
const passRemote=await selectRemoteDecision({bundle:devRoot.bundle,signal:new AbortController().signal,request:async()=>({status:'response' as const,response:{kind:'choose' as const,decisionId:devRoot.bundle.decisionId,actionId:passId},summary:fakeSummary})});
conflictRows[2].offlineLabel=prepareOfflineLabel({input:devInput,remote:passRemote,state:devRoot.state,history:devRoot.history,teacher});
for(const i of [0,2])conflictRows[i].firstRoundValidation={evidenceGrade:'strong_supported',direction:i===0?'takeover':'pass',validationRef};
const conflictFrozen=freezeDataset({plan,sourceIndexPath:indexPath,sourceQueue:queue,rows:conflictRows,outputDir:join(f.runDir,'conflict-frozen')}),conflictLoaded=loadFrozenDataset(conflictFrozen);
assert.equal(conflictLoaded.manifest.labelConflicts.length,1);assert.equal(conflictLoaded.samples.filter(s=>s.sampleKind==='demo').length,0);assert.equal(conflictLoaded.manifest.exclusions.filter((e:any)=>e.reason==='student_information_gap/label_conflict').length,2);assert.equal(conflictLoaded.manifest.counts.attempted,4);assert.equal(conflictLoaded.manifest.qualification.eligible,false);
const runtimeSnapshot=readOfflineSnapshot({recordRef:f.store.ref(),recordRoot:f.runDir,key:f.key,inputSHA256:rows[0].record.trainingInputSHA256,familyId:'S35-fixed-train-family',split:'train',actorSeat:0});
const runtimeChecks=await checkFirstRoundRuntime({directory:f.runDir,snapshot:runtimeSnapshot,identity,encoder,policy,student,highId:f.highId,decide:(state:GameState)=>syntheticDecision(state,true)});
const matchRuntimeChecks=await checkFirstRoundMatchRuntime({root:recordedTargetFixture(identity,'runtime'),identity,encoder,policy,student,decide:(state:GameState)=>syntheticDecision(state,true)});
const blindRuntimeChecks=await checkFirstRoundBlindRuntime({snapshot:runtimeSnapshot,directory:f.runDir});
const evidenceChecks=checkFirstRoundEvidence({row:rows[0],plan,snapshot:runtimeSnapshot,root:f.runDir});
const wrapper={schema:'ohuo-first-round-python-fixture-v1',datasetEligible:false,realTraining:false,dataset:{directory:relative(fixtureAssets,dataset.directory),manifestSHA256:dataset.manifestSHA256},parentWeightsPath:'weights.f32',parentWeightsSHA256:scorer.weightsSHA256,targetDecisionId:f.bundle.decisionId,targetActionId:f.highId,expectedCandidateIds:[...f.bundle.initialCandidateIds]},wrapperPath=join(fixtureAssets,'python-fixture.json'),wrapperBytes=JSON.stringify(wrapper)+'\n';writeFileSync(wrapperPath,wrapperBytes);
console.log(JSON.stringify({case:'training.capture-freeze-smoke',status:'PARTIAL_SOURCE_PASS',actualK:K,insertedRowIndex:8,actualInputDim:423,nonzeroMemoryIndex:405,privateInputSchema:disk.schema,S0ActualForward:true,BProposalScoresPreserved:true,recordReplayVerified:true,actualFreezerConflictExclusion:true,runtimeChecks,matchRuntimeChecks,blindRuntimeChecks,evidenceChecks,newFrozenSchema:loaded.manifest.schema,actualFrozenRows:loaded.samples.length,fixturePath:wrapperPath,fixtureSHA256:createHash('sha256').update(wrapperBytes).digest('hex'),pending:['research qualification on actual source runs','Python actual same-capture finite-step/reload','Mac typecheck/acceptance'],providerRequests:0,optimizerSteps:0}));
