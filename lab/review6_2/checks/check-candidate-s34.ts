/** NAV-S34 four named checks only. Synthetic scoring is not C1400 evidence. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { MLP } from '../../../packages/ai/src/nn/mlp';
import { PublicTracker } from '../../../packages/ai/src/nn/schema';
import { rerankInitialCandidates } from '../../../packages/ai/src/hybrid/student';
import * as studentContract from '../../../packages/ai/src/hybrid/student';
import { captureInitialCandidateInputs, createMatchStore } from '../match-record';
import { freezeDataset, loadFrozenDataset, prepareOfflineLabel, dataHash, type DatasetPlan } from '../distill-data';
import * as studentPolicy from '../distill-policy';
import { freezeRequestView, responseContract, parseSelection } from '../../../packages/web/server/llm-selection-wire.mjs';
import { DEFAULT_RULES, legalCombos, makeLevelCtx, classify, canPass, buildDeck, applyMove, type Card, type Combo, type GameState } from '@gd/engine';
import { canonicalActionId, resolveLegalMove } from '../../../packages/ai/src/hybrid/legality';
import { freezeDecisionCandidates, expandDecisionCandidates, offeredCandidateView, selectOfferedAction, createDecisionBundle, decisionRequestView } from '../../../packages/ai/src/hybrid/candidates';
import { dedupCandidates, NeuralDecider, type NeuralDecision } from '../../../packages/ai/src/nn/neuralSeat';
import { selectRemoteDecision, type RemoteSelectionResponse, type RemoteRequestSummary } from '../../../packages/ai/src/hybrid/remote-selector';
import { freezeCopy, faceCounts, publicCombo, type CandidateBundle, type DecisionBundle } from '../../../packages/ai/src/hybrid/protocol';

const policy = { candidateSpec: 'first-target-offer12-v1', enumSpec: { id: 'full-house-attachment-ranks-v1', enumerationMode: 'all_supported_attachment_ranks' } } as const;
const legacyPolicy = { candidateSpec: 'ohuo-frozen-c8-expand4-v1', enumSpec: { id: 'cand-suit-v3', enumerationMode: 'legacy_best_pair' } } as const;
const mode = policy.enumSpec.enumerationMode;
let c1400:MLP|undefined;
const c1400Identity={"architectureId":"mlp-tanh-256x256-scalar-v1","weightsLayoutVersion":"f32le-layer-w-row-major-then-b-v1","epsilon":0,"tieBreakId":"first-candidate-v1","policyId":"r62-p8c-control-u1400-greedy","modelVersion":"r62-p8c-control-u001400-41c9a38f","parameterCount":168449,"inputDim":399,"weightsPathOrUrl":{"nodePath":"lab/review6_2/runs/r62-p8c-control/checkpoints/u001400-41c9a38f/weights.f32","assetUrl":"ai/ohuo/ohuo-1030-b-v1/weights.f32"},"weightsSHA256":"d05c52bbd28883760da11f042be2d110fd3b3a9affd97edd7aed43c9421eb081","encoder":{"schema":"v2","ctxFill":"rule-context","passEncoding":"action64","encoderVersion":"gd-lab-schema-v4"},"candidateSpecId":"cand-suit-v3","tierSpecId":"none"} as const;
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
function legacyDecision(s:GameState,explicit=false):NeuralDecision { return c1400 ? new NeuralDecider(0,c1400,0,()=>0,c1400Identity.encoder).decide(s,{wantRanking:true,...(explicit?{candidatePolicy:legacyPolicy}:{})}) : syntheticDecision(s); }
function snapshot(s: GameState, explicit=false) {
  const d = legacyDecision(s,explicit); const b = freezeDecisionCandidates({state:s,actorSeat:0,decisionId:'fixed-333-88-AA',decision:d,...(explicit?{candidatePolicy:legacyPolicy}:{})});
  const group = offeredCandidateView(b).expandableGroups[0];
  const ex = group ? expandDecisionCandidates(b,b.decisionId,group.groupId) : null;
  return { scoringIdentity:c1400?c1400Identity:{kind:'synthetic-index-ranking'},pool:b.pool.map(c=>({canonicalId:c.canonicalId,rank:c.rank,originalIndex:c.originalIndex,rawQ:c.rawQ})), initial:[...b.initialCandidateIds], expansion:ex, selected:selectOfferedAction(b,b.decisionId,b.fallbackActionId) };
}
function remoteBundle(s:GameState,b:CandidateBundle):DecisionBundle {
  return freezeCopy({...b,key:{controllerOrRunnerGeneration:1,matchId:'synthetic-wire',gameNo:s.match.gameNo,moveNo:s.moveNo,actorSeat:0,requestSeq:0},
    observation:{schema:'ohuo-public-observation-v1',decisionId:b.decisionId,matchId:'synthetic-wire',actorSeat:0,partnerSeat:2,phase:'play',ruleOptions:DEFAULT_RULES,rulesText:'synthetic protocol fixture; not replay/capture evidence',levelsBefore:s.levelsBefore,stageTeam:0,effectiveLevelRanks:[...s.ctx.ranks],gameNo:s.match.gameNo,moveNo:s.moveNo,previousGameResult:null,ownHand:faceCounts(s.hands[0]),seats:s.hands.map((h,seat)=>({seat,remaining:h.length,finishOrder:null})),target:publicCombo(s.lastCombo),leader:s.leader,lastPlayer:s.lastPlayer,passCount:0,currentTrick:[],publicPrefix:[],tribute:null,knownOtherHands:[],playedCards:[],unseenPool:[],informationBoundary:'own-hand-and-public-prefix; pass-does-not-prove-inability'}});
}
function recordedTargetFixture(policyIdentity:any) {
  const available=buildDeck();
  const take=(rank:number,n:number,naturalOnly=false)=>Array.from({length:n},()=>{
    const at=available.findIndex(c=>c.rank===rank&&(!naturalOnly||c.suit!=='H'));assert(at>=0);return available.splice(at,1)[0];
  });
  const own=[...take(3,4),...take(4,3),...take(8,2),...take(9,2),...take(11,2),...take(12,2),...take(13,2),...take(14,2),...take(5,2),...take(7,2),...take(10,2,true),...take(16,1),...take(17,1)];
  const targetCards=[...take(2,3),...take(6,2)];
  const state=fixture();state.hands=[own,available.splice(0,27),[...targetCards,...available.splice(0,22)],available.splice(0,27)];
  state.turn=2;state.leader=2;state.lastPlayer=2;state.lastCombo=null;state.moveNo=0;
  const matchId='S34-fixed-two-step-engineering';
  const outRoot=fileURLToPath(new URL('../../out/S34-candidate-same-set/',import.meta.url));mkdirSync(outRoot,{recursive:true});const runDir=mkdtempSync(join(outRoot,'S34-same-set-'));
  const store=createMatchStore(runDir,{runId:'S34-finite',matchId,sourceRef:'fixed-synthetic-108',layoutRef:'seat0',policyIds:[policyIdentity.policyId,'fake','fake','fake'],rules:DEFAULT_RULES,seatSnapshots:[{policyIdentity},{},{},{}],evaluatedActor:0,split:'train'});const recorder=store.recorder;
  recorder.beginGame(state,'S34-fixed-family');const tracker=new PublicTracker();
  for(const move of [{pass:false as const,combo:classify(targetCards,state.ctx).find(c=>c.kind==='trio_pair')!},{pass:true as const}]) {
    const key={controllerOrRunnerGeneration:1,matchId,gameNo:1,moveNo:state.moveNo,actorSeat:state.turn,requestSeq:state.moveNo};
    recorder.beginDecision({key,policyId:'synthetic-prefix',initialCandidateIds:['prefix'],offeredIds:['prefix']});
    const priorTarget=state.lastCombo;resolveLegalMove(state,move);const events=applyMove(state,move);tracker.observe(events);
    recorder.confirmAction({key,move,events,priorTarget,actionId:'prefix',requestedActionId:'prefix',source:'synthetic-prefix',status:'selected'});
  }
  assert.equal(state.turn,0);assert.equal(state.moveNo,2);
  const raw=dedupCandidates(legalCombos(state,mode),true).map(x=>x.combo);
  const low=raw.find(c=>c?.kind==='trio_pair'&&c.mainRank===3&&c.pairRanks[0]===8)!;
  const high=(c:Combo|null)=>c?.kind==='trio_pair'&&c.mainRank===3&&c.pairRanks[0]===14;
  const ordered=[low,...raw.filter(c=>c!==low&&!high(c)),...raw.filter(high)];
  let calls=0;
  const key={controllerOrRunnerGeneration:1,matchId,gameNo:1,moveNo:2,actorSeat:0,requestSeq:2};
  const bundle=createDecisionBundle({state,actorSeat:0,decisionId:'S34-recorded-target',matchId,history:recorder.history(1),key,candidatePolicy:policy,decider:{seat:0,decide:(_state,opts)=>{calls++;assert.deepEqual(opts?.candidatePolicy,policy);return syntheticDecision(state,true,ordered);}}});
  assert.equal(calls,1);
  const highId=bundle.coverage!.witnesses.find(w=>w.slot==='C')!.actionId!;
  assert(!bundle.coverage!.baseInitialCandidateIds.includes(highId));
  return {state,tracker,recorder,bundle,key,store,runDir,highId,history:recorder.history(1)};
}
const fakeSummary:RemoteRequestSummary={profileId:'fake-only',revision:1,snapshotHash:'0'.repeat(64),credentialRevision:0,protocol:'openai-chat-completions',requestedModel:'fake-only',returnedModel:null,requestCount:0,elapsedMs:0,upstreamChunks:0,upstreamEvents:0,contentEvents:0,keepaliveEvents:0,firstUpstreamMs:null,firstContentMs:null,usage:{}};
async function fakeRemote(bundle:DecisionBundle,response:RemoteSelectionResponse,summary=fakeSummary) {
  let called=0;
  const result=await selectRemoteDecision({bundle,signal:new AbortController().signal,request:async(view)=>{
    called++;assert.deepEqual(view.candidates.map(c=>c.actionId),bundle.initialCandidateIds);
    return {status:'response',response,summary};
  }});
  return {result,called};
}
const caseAt=process.argv.indexOf('--case');
const deliveryCase=caseAt>=0?process.argv[caseAt+1]:undefined;
const which=deliveryCase??process.argv[2];
const baselineAt=process.argv.indexOf('--baseline');
const baselinePath=baselineAt>=0?process.argv[baselineAt+1]:deliveryCase?'lab/out/S34-candidate-legacy-before/legacy-c1400-before.json':process.argv[3];
const weightsAt=process.argv.indexOf('--weights');
const weightsPath=weightsAt>=0?process.argv[weightsAt+1]:deliveryCase==='candidate.legacy-spec-smoke'?'lab/review6_2/runs/r62-p8c-control/checkpoints/u001400-41c9a38f/weights.f32':undefined;
if(weightsPath) {
  // Local L only. DOT never supplies this flag or reads weights.
  const bytes=readFileSync(weightsPath);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),c1400Identity.weightsSHA256,'original C1400 identity required');
  assert.equal(bytes.length,c1400Identity.parameterCount*4);
  const values=Float32Array.from({length:c1400Identity.parameterCount},(_,i)=>bytes.readFloatLE(i*4));
  c1400=new MLP(0,399);c1400.setWeights(values);
}
if(which==='candidate.legacy-spec-smoke') {
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot(legacyFixture()))),JSON.parse(readFileSync(baselinePath,'utf8')));
  const s=legacyFixture();const explicit=freezeDecisionCandidates({state:s,actorSeat:0,decisionId:'fixed-333-88-AA',decision:legacyDecision(s,true),candidatePolicy:legacyPolicy});
  assert.deepEqual(explicit.initialCandidateIds,snapshot(s).initial);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot(s,true))),JSON.parse(readFileSync(baselinePath,'utf8')));
  assert.deepEqual(legalCombos(s).map(c=>canonicalActionId(c,s.ctx)),legalCombos(s,'legacy_best_pair').map(c=>canonicalActionId(c,s.ctx)));
  const decider = new NeuralDecider(0,c1400??({forward:(_x:Float32Array,n:number)=>Float32Array.from({length:n},(_,i)=>-i)} as any),0,()=>0,c1400Identity.encoder);
  const old = decider.decide(s,{wantRanking:true}); const fresh = decider.decide(s,{wantRanking:true,candidatePolicy:policy});
  assert.equal(old.ranking!.filter(x=>x.combo?.kind==='trio_pair').some(x=>x.combo?.pairRanks[0]===14),false);
  assert.equal(fresh.ranking!.some(x=>x.combo?.kind==='trio_pair'&&x.combo.pairRanks[0]===14),true);
  const oldChoice=canonicalActionId(old.move.pass?null:old.move.combo,s.ctx),newChoice=canonicalActionId(fresh.move.pass?null:fresh.move.combo,s.ctx);
  console.log(JSON.stringify({checkId:which,status:c1400?'passed':'partial',syntheticDispatch:c1400?'not_used':'passed',C1400:c1400?'verified_original_weights':'not_run_original_weights_required',scoringIdentity:c1400?c1400Identity:null,before:old.nCands,after:fresh.nCands,choiceChanged:c1400?oldChoice!==newChoice:null,oldChoice:c1400?oldChoice:null,newChoice:c1400?newChoice:null}));
}
else if(which==='candidate.full-house-pairs') {
  const results=[];
  for (const ranks of [[3,3,3,8,8,14,14],[3,3,3,8,8,8,8,14,14]]) {
    const s=fixture(ranks); const a=legalCombos(s,mode).filter(c=>c.kind==='trio_pair'&&c.mainRank===3);
    assert.deepEqual([...new Set(a.map(c=>c.pairRanks[0]))],[8,14],'both original-search attachment ranks must be generated');
    for(const c of a) resolveLegalMove(s,{pass:false,combo:c}); results.push(a.length);
  }
  // One wild is needed by the trio and cannot be reused to pair the lone eight.
  const s=fixture([3,3,8,14,14]); s.hands[0].push({id:20,suit:'H',rank:10});
  const a=legalCombos(s,mode).filter(c=>c.kind==='trio_pair'&&c.mainRank===3);
  assert(a.some(c=>c.pairRanks[0]===14));assert(!a.some(c=>c.pairRanks[0]===8));
  for(const c of legalCombos(s,mode)) { assert.equal(new Set(c.cards.map(x=>x.id)).size,c.cards.length); resolveLegalMove(s,{pass:false,combo:c}); }
  const levelTrio=fixture([10,10,10,8,8,14,14]);levelTrio.hands[0].push({id:21,suit:'H',rank:10});
  const naturalWild=legalCombos(levelTrio,mode).filter(c=>c.kind==='trio_pair'&&c.mainRank===10&&c.cards.some(x=>x.id===21));
  assert.deepEqual([...new Set(naturalWild.map(c=>c.pairRanks[0]))],[8,14]);
  for(const c of naturalWild) resolveLegalMove(levelTrio,{pass:false,combo:c});
  console.log(JSON.stringify({checkId:which,status:'passed',fullHouseCounts:results,coverage:'supported attachment ranks only, not all legal combinations'}));
}
else if(which==='candidate.offer12'||which==='candidate.same-set-smoke') {
  const s=fixture([3,3,3,3,4,4,4,8,8,9,9,11,11,12,12,13,13,14,14]);
  const tb=performance.now();const legacyLegal=legalCombos(s);const legacyRaw=dedupCandidates(legacyLegal,true);const legacyEnumMs=performance.now()-tb;
  const tls=performance.now();const legacyRanked=syntheticDecision(s,false,legacyRaw.map(x=>x.combo));const legacySyntheticScoreMs=performance.now()-tls;
  const tlc=performance.now();const legacyOffered=freezeDecisionCandidates({state:s,actorSeat:0,decisionId:'fixed-offer12-before',decision:legacyRanked});const legacyConstructMs=performance.now()-tlc;
  const t0=performance.now();const newLegal=legalCombos(s,mode);const raw=dedupCandidates(newLegal,true).map(x=>x.combo);const enumMs=performance.now()-t0;
  const low=raw.find(c=>c?.kind==='trio_pair'&&c.mainRank===3&&c.pairRanks[0]===8)!;
  const high=raw.find(c=>c?.kind==='trio_pair'&&c.mainRank===3&&c.pairRanks[0]===14)!;
  const isHigh=(c:Combo|null)=>c?.kind==='trio_pair'&&c.mainRank===3&&c.pairRanks[0]===14;
  const ordered=[low,...raw.filter(c=>c!==low&&!isHigh(c)),...raw.filter(isHigh)];
  const t1=performance.now();const decision=syntheticDecision(s,true,ordered);const syntheticScoreMs=performance.now()-t1;
  const input={state:s,actorSeat:0,decisionId:'fixed-offer12',decision,candidatePolicy:policy};
  const tc=performance.now();const b=freezeDecisionCandidates(input);const constructMs=performance.now()-tc;assert.ok(b.coverage);assert(raw.length>12);assert(b.offeredIds.length<=12);
  const lowId=b.pool.find(c=>c.canonical===null?false:canonicalActionId(c.canonical,s.ctx)===canonicalActionId(low,s.ctx))!.actionId;
  const highId=b.pool.find(c=>c.canonical===null?false:canonicalActionId(c.canonical,s.ctx)===canonicalActionId(high,s.ctx))!.actionId;
  assert(b.initialCandidateIds.includes(lowId));assert(b.initialCandidateIds.includes(highId),'high attachment outside base eight must be initially offered');
  assert(b.coverage.baseInitialCandidateIds.includes(lowId));assert(!b.coverage.baseInitialCandidateIds.includes(highId));
  assert.deepEqual(b.initialCandidateIds,b.offeredIds);assert(b.offeredIds.includes(b.fallbackActionId));assert(b.offeredIds.some(id=>b.pool.find(c=>c.actionId===id)!.canonical===null));
  assert.deepEqual(freezeDecisionCandidates(input),b);assert.equal(b.coverage.focusFamily,'trio_pair:3');
  assert(b.coverage.poolNotOfferedCount>0);assert.equal(b.coverage.legalButUnenumeratedCount,null);
  assert(b.coverage.nonFocusFamilies.some(f=>f.family==='trio_pair:4'));
  const A=b.coverage.witnesses.find(w=>w.slot==='A')!;assert.equal(A.actionId,lowId);assert.equal(A.status,'already_covered');
  const B=b.coverage.witnesses.find(w=>w.slot==='B')!;assert.equal(B.status,'already_covered');
  const C=b.coverage.witnesses.find(w=>w.slot==='C')!;assert.equal(C.actionId,highId);assert.equal(C.status,'added');
  // Explicit hand arithmetic: using three of the four 3s loses all four native-bomb cards.
  const D=b.coverage.witnesses.find(w=>w.slot==='D')!;assert.deepEqual(D.cost,[0,0,0]);
  const opp={...s,lastPlayer:1};assert.equal(freezeDecisionCandidates({...input,state:opp}).initialCandidateIds.length,8);
  const allEarly=[low,high,...ordered.filter(c=>c!==low&&c!==high)];
  const covered=freezeDecisionCandidates({...input,decision:syntheticDecision(s,true,allEarly)});
  assert.equal(covered.coverage!.witnesses.find(w=>w.slot==='C')!.status,'already_covered');
  assert.equal(covered.initialCandidateIds.length,covered.coverage!.baseInitialCandidateIds.length+covered.coverage!.witnesses.filter(w=>w.status==='added').length);
  const family4=ordered.find(c=>c?.kind==='trio_pair'&&c.mainRank===4)!;
  const reordered=[family4,...ordered.filter(c=>c!==family4)];
  const otherFocus=freezeDecisionCandidates({...input,decision:syntheticDecision(s,true,reordered)});
  assert.equal(otherFocus.coverage!.focusFamily,'trio_pair:4');
  const lowest=otherFocus.pool.find(c=>c.actionId===otherFocus.coverage!.witnesses.find(w=>w.slot==='A')!.actionId)!;
  assert.equal(lowest.canonical!.mainRank,3,'A compares beats, not the top-ranked stronger main');
  // Every formula case is a small literal legal hand, not a parallel rule implementation.
  for(const [ranks,want] of [ [[3,3,3,3,8,8,8,8],[4,0,0]], [[3,3,3,8,8,8],[0,1,0]], [[11,11,11,8,8],[0,0,3]] ] as const) {
    const f=fixture([...ranks],11), decision=syntheticDecision(f,true);
    const got=freezeDecisionCandidates({...input,state:f,decision});
    assert.deepEqual(got.coverage!.witnesses.find(w=>w.slot==='D')!.cost,[...want]);
  }
  const five=fixture([3,3,3,3,3,8,8,8,8]);five.lastCombo=classify(cards([2],95),five.ctx)[0];
  const fiveBundle=freezeDecisionCandidates({...input,state:five,decision:syntheticDecision(five,true)});
  assert.deepEqual(fiveBundle.coverage!.witnesses.find(w=>w.slot==='D')!.cost,[1,0,0]);
  const noBranch=fixture([3,3,3,8,8]);
  const noBranchBundle=freezeDecisionCandidates({...input,state:noBranch,decision:syntheticDecision(noBranch,true)});
  assert.equal(noBranchBundle.coverage!.focusFamily,null);
  assert.deepEqual(noBranchBundle.coverage!.witnesses.filter(w=>w.slot==='B'||w.slot==='C').map(w=>w.status),['absent','absent']);
  assert.throws(()=>freezeDecisionCandidates({...input,candidatePolicy:{...policy,enumSpec:legacyPolicy.enumSpec} as any}));
  assert.throws(()=>freezeDecisionCandidates({...input,decision:{...decision,candidatePolicy:undefined}}));

  if(which==='candidate.same-set-smoke') {
    const chosen=selectOfferedAction(b,b.decisionId,highId);assert.equal(chosen.status,'selected');assert.equal(chosen.inInitialCandidateSet,true);
    if(chosen.status==='selected')resolveLegalMove(s,chosen.canonical?{pass:false,combo:chosen.canonical}:{pass:true});
    assert.equal(expandDecisionCandidates(b,b.decisionId,'g01').status,'remote_failure');assert.deepEqual(offeredCandidateView(b).expandableGroups,[]);
    assert.equal(selectOfferedAction(b,b.decisionId,'a9999').status,'remote_failure');
    const rb=remoteBundle(s,b);
    const syntheticIdentity={policyId:'S34-engineering-synthetic-ranking',modelVersion:'fixed-index-score',weightsSHA256:'0'.repeat(64),inputDim:399,encoderVersion:'gd-lab-schema-v4',candidateVersion:'cand-suit-v3',passEncoding:'action64' as const,candidateCompat:undefined,architectureId:'synthetic-ranking-no-network',weightsLayoutVersion:'none',epsilon:0,tieBreakId:'first-candidate-v1',tierSpecId:'none'};
    const inputs=captureInitialCandidateInputs({bundle:rb,state:s,tracker:new PublicTracker(),encoder:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'},policyIdentity:syntheticIdentity});
    assert.deepEqual(inputs.candidateIds,b.initialCandidateIds);assert.equal(inputs.candidateFeatures.length,b.initialCandidateIds.length);
    const fakeScorer={inputDim:399,forward:(_x:Float32Array,n:number)=>Float32Array.from({length:n},(_,i)=>i===inputs.candidateIds.indexOf(highId)?1:0)} as MLP;
    assert.equal(rerankInitialCandidates(rb,inputs,fakeScorer).actionId,highId,'actual student must consume captured new initial ID');
    assert.deepEqual(inputs.candidatePolicy,policy);
    const recorded=recordedTargetFixture(syntheticIdentity);
    const researchRelease=await import('../../../packages/ai/src/policy/candidate-release');
    const parentDescriptor={releaseRef:'S34-fixture-parent',label:'fixture only',proposalPolicyRef:syntheticIdentity.policyId,mode:'local',tier:'hard',status:'development',parentRelease:null,remoteFallbackPolicyRef:syntheticIdentity.policyId,localSelector:'proposal',candidateSpecRef:legacyPolicy.candidateSpec,observationSchema:'ohuo-public-observation-v1',promptRef:'ohuo-engine-rules-v1/choose-expand-v1'} as any;
    const parentEnvelope={schema:'ohuo-release-ref-v1',release:parentDescriptor,policyIdentity:syntheticIdentity};
    const parentRef='S34-fixture-parent@sha256:'+'0'.repeat(64);
    const envelope={schema:'ohuo-candidate-research-release-ref-v1',parentRef,release:{...parentDescriptor,releaseRef:'S34-fixture-B-prime',label:'fixture B-prime',parentRelease:parentDescriptor.releaseRef,candidateSpecRef:policy.candidateSpec,promptRef:'ohuo-engine-rules-v1/choose-only-v2'},policyIdentity:syntheticIdentity,candidatePolicy:policy};
    const lookup=(ref:string)=>{assert.equal(ref,parentRef);return parentEnvelope;};
    assert.deepEqual(researchRelease.resolveCandidateReleaseRef(envelope,lookup,[parentDescriptor]).candidatePolicy,policy);
    assert.equal(researchRelease.resolveCandidateReleaseRef(parentEnvelope,lookup,[parentDescriptor]).candidatePolicy,undefined);
    assert.throws(()=>researchRelease.resolveCandidateReleaseRef({...envelope,policyIdentity:{...syntheticIdentity,weightsSHA256:'1'.repeat(64)}},lookup,[parentDescriptor]));
    assert.throws(()=>researchRelease.resolveCandidateReleaseRef({...envelope,candidatePolicy:undefined},lookup,[parentDescriptor]));

    const wireView=decisionRequestView(recorded.bundle);
    assert.doesNotThrow(()=>freezeRequestView(wireView),'real strict backend wire must accept complete new enum+K');
    assert.deepEqual(parseSelection(JSON.stringify({kind:'choose',decisionId:recorded.bundle.decisionId,actionId:recorded.highId}),freezeRequestView(wireView)).actionId,recorded.highId);
    assert.throws(()=>parseSelection(JSON.stringify({kind:'expand',decisionId:recorded.bundle.decisionId,groupId:'g01'}),wireView),/expansion_disabled_for_candidate_spec/);
    assert(responseContract(wireView).startsWith('ohuo-choose-only-v2'));
    const {createProfileSelector}=await import('../../../packages/web/server/llm-select.mjs');
    let transportCalls=0;
    const profile={profileId:'S34-fake-profile',revision:1,protocol:'openai-chat-completions',baseUrl:'https://s34.invalid/v1',requestedModel:'synthetic-no-provider',requestOptions:{},secret:'synthetic-not-a-credential',credentialRevision:1};
    const profileSelector=createProfileSelector({store:{resolve:()=>profile},reference:{profileId:profile.profileId,revision:1,snapshotHash:'0'.repeat(64)},fetchImpl:async(_url:string,options:any)=>{
      transportCalls++;const body=JSON.parse(options.body),sent=JSON.parse(body.messages[1].content);
      assert.deepEqual(sent.candidates.map((c:any)=>c.actionId),recorded.bundle.initialCandidateIds);
      assert.deepEqual(sent.enumSpec,policy.enumSpec);assert(body.messages[0].content.includes('ohuo-choose-only-v2'));
      const event={model:'synthetic-no-provider',choices:[{index:0,delta:{content:JSON.stringify({kind:'choose',decisionId:recorded.bundle.decisionId,actionId:recorded.highId})},finish_reason:'stop'}]};
      return new Response('data: '+JSON.stringify(event)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    }});
    const wireRemote=await selectRemoteDecision({bundle:recorded.bundle,request:profileSelector.request,signal:new AbortController().signal});
    assert.equal(wireRemote.status,'selected');if(wireRemote.status==='selected')assert.equal(wireRemote.actionId,recorded.highId);assert.equal(transportCalls,1);


    const captured=captureInitialCandidateInputs({bundle:recorded.bundle,state:recorded.state,tracker:recorded.tracker,encoder:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'},policyIdentity:syntheticIdentity});
    recorded.recorder.beginDecision({key:recorded.key,policyId:syntheticIdentity.policyId,initialCandidateIds:recorded.bundle.initialCandidateIds,offeredIds:recorded.bundle.offeredIds,bundle:recorded.bundle,candidateInputs:captured});
    const recordedInput=JSON.parse(readFileSync(join(recorded.store.ref().directory,'decision-2.private.json'),'utf8'));
    assert.equal(recordedInput.schema,'ohuo-decision-input-candidate-v2');
    const offlineSource=await import('../offline-label-source');
    assert.deepEqual(offlineSource.validateCapturedCandidateContract(recordedInput,recorded.bundle),policy);
    assert.throws(()=>offlineSource.validateCapturedCandidateContract({...recordedInput,enumSpec:undefined},recorded.bundle));
    assert.throws(()=>offlineSource.validateCapturedCandidateContract({...recordedInput,candidateInputs:{...recordedInput.candidateInputs,candidatePolicy:undefined}},recorded.bundle));
    assert.deepEqual(studentContract.resolveStudentCandidatePolicy({schema:'ohuo-student-release-candidate-v2',candidateSpecRef:policy.candidateSpec,candidatePolicy:policy} as any),policy);
    assert.deepEqual(studentContract.resolveStudentCandidatePolicy({schema:'ohuo-student-release-v1',candidateSpecRef:legacyPolicy.candidateSpec} as any),legacyPolicy);
    assert.throws(()=>studentContract.resolveStudentCandidatePolicy({schema:'ohuo-student-release-v1',candidateSpecRef:policy.candidateSpec,candidatePolicy:policy} as any));
    assert.throws(()=>studentContract.resolveStudentCandidatePolicy({schema:'ohuo-student-release-candidate-v2',candidateSpecRef:policy.candidateSpec} as any));
    assert.deepEqual(studentPolicy.verifyFrozenCandidatePolicy({candidate:policy.candidateSpec,candidatePolicy:policy},{candidate:policy.candidateSpec,candidatePolicy:policy}),policy);
    assert.throws(()=>studentPolicy.verifyFrozenCandidatePolicy({candidate:policy.candidateSpec,candidatePolicy:policy},{candidate:policy.candidateSpec,candidatePolicy:legacyPolicy}));
    assert.throws(()=>studentPolicy.verifyFrozenCandidatePolicy({candidate:policy.candidateSpec,candidatePolicy:policy},{candidate:'different-frozen-reference',candidatePolicy:policy}));
    assert.throws(()=>studentPolicy.verifyFrozenCandidatePolicy({candidate:policy.candidateSpec},{candidate:policy.candidateSpec}));
    assert.deepEqual(studentPolicy.verifyFrozenCandidatePolicy({candidate:legacyPolicy.candidateSpec},{candidate:legacyPolicy.candidateSpec}),legacyPolicy);
    assert.deepEqual(recordedInput.enumSpec,policy.enumSpec);assert.deepEqual(recordedInput.candidateInputs.candidateIds,recorded.bundle.initialCandidateIds);
    const recTeacher=await fakeRemote(recorded.bundle,{kind:'choose',decisionId:recorded.bundle.decisionId,actionId:recorded.highId});assert.equal(recTeacher.result.status,'selected');
    const recordedScorer={inputDim:399,forward:(_x:Float32Array,n:number)=>Float32Array.from({length:n},(_,i)=>i===captured.candidateIds.indexOf(recorded.highId)?1:0)} as MLP;
    assert.equal(rerankInitialCandidates(recorded.bundle,captured,recordedScorer).actionId,recorded.highId);
    assert.throws(()=>rerankInitialCandidates(recorded.bundle,{...captured,candidatePolicy:undefined},recordedScorer));
    assert.throws(()=>rerankInitialCandidates(recorded.bundle,{...captured,candidateIds:[...captured.candidateIds].reverse()},recordedScorer));
    assert.throws(()=>captureInitialCandidateInputs({bundle:{...recorded.bundle,offeredIds:[...recorded.bundle.offeredIds].reverse()},state:recorded.state,tracker:recorded.tracker,encoder:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'},policyIdentity:syntheticIdentity}));
    // Confirm only the fixed local B action; fake teacher remains offline and does not step.
    const actual=recorded.bundle.pool[0],move=actual.canonical?{pass:false as const,combo:actual.canonical}:{pass:true as const};
    const events=applyMove(structuredClone(recorded.state),move);
    recorded.recorder.confirmAction({key:recorded.key,move,events,priorTarget:recorded.state.lastCombo,actionId:actual.actionId,requestedActionId:actual.actionId,source:'synthetic-local-B',status:'selected'});
    const match=JSON.parse(JSON.stringify(recorded.recorder.snapshot().record)),record=match.decisions.find((d:any)=>d.key.requestSeq===2)!;
    const teacher={releaseRef:'S34-fake-teacher',promptRef:'S34-choose-only-fixture',profileSnapshot:Object.fromEntries(['profileId','revision','snapshotHash','credentialRevision','protocol','requestedModel'].map(k=>[k,(fakeSummary as any)[k]]))};
    const teacherResult=await fakeRemote(recorded.bundle,{kind:'choose',decisionId:recorded.bundle.decisionId,actionId:recorded.highId},{...fakeSummary,requestCount:1});
    const label=prepareOfflineLabel({input:recordedInput,remote:teacherResult.result,state:recorded.state,history:recorded.history,teacher});
    const runDir=recorded.runDir;
    const reloadedSnapshot=offlineSource.readOfflineSnapshot({recordRef:recorded.store.ref(),recordRoot:runDir,key:recorded.key,inputSHA256:record.trainingInputSHA256,familyId:'S34-fixed-family',split:'train',actorSeat:0});
    assert.deepEqual(reloadedSnapshot.bundle.initialCandidateIds,recorded.bundle.initialCandidateIds);
    assert.deepEqual(reloadedSnapshot.input,recordedInput);
    const index={version:1,families:{'S34-fixed-family':{split:'train'}}},indexBytes=JSON.stringify(index);const indexPath=join(runDir,'source-index.json');writeFileSync(indexPath,indexBytes);
    const queue={schema:'ohuo-complete-match-queue-v1',sourceIndexRef:match.sourceRef,rows:[{matchId:match.matchId,roundFamilyIds:['S34-fixed-family'],split:'train',actor:0}]};
    const identities={basePolicy:JSON.parse(JSON.stringify(syntheticIdentity)),teacher,encoderVersion:syntheticIdentity.encoderVersion,encoderConfig:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'},candidateSpecRef:policy.candidateSpec,candidatePolicy:policy,promptRef:teacher.promptRef};
    const plan={schema:'ohuo-distill-plan-candidate-v2',datasetId:'S34-fixed-dataset',purpose:'engineering_fixture',sourceIndexRef:match.sourceRef,sourceIndexSHA256:createHash('sha256').update(indexBytes).digest('hex'),queueRef:match.layoutRef,queueSHA256:dataHash(queue),samplingRef:'S34-fixed-no-research',identities,families:[{sourceFamily:'S34-fixed-family',split:'train',sourceRefs:[match.sourceRef]}],games:[{matchId:match.matchId,gameNo:1,sourceFamily:'S34-fixed-family',split:'train',sourceRef:match.sourceRef,sourceSHA256:match.games[0].sourceSHA256,actorSeat:0}]} as DatasetPlan;
    const dataset=freezeDataset({plan,sourceIndexPath:indexPath,sourceQueue:queue,rows:[{sampleKind:'demo',sampleClass:'target',match,record,privateInput:recordedInput,offlineLabel:label}],outputDir:join(runDir,'frozen')});
    const loaded=loadFrozenDataset(dataset,{expectedIdentities:identities});assert.equal(loaded.samples.length,1,'new initial slot must freeze through actual exporter');
    assert.equal(loaded.manifest.qualification.eligible,false);assert.deepEqual(loaded.samples[0].candidateIds,recorded.bundle.initialCandidateIds);assert.deepEqual(loaded.samples[0].targetIds,[recorded.highId]);
    assert.equal(rerankInitialCandidates(recorded.bundle,loaded.samples[0],recordedScorer).actionId,recorded.highId);
    writeFileSync(join(runDir,'python-input.json'),JSON.stringify({dataset,identities,target:recorded.highId}));



    const remote=await fakeRemote(rb,{kind:'choose',decisionId:b.decisionId,actionId:highId});
    assert.equal(remote.result.status,'selected','new frozen initial K must pass the real remote selector');assert.equal(remote.called,1);
    const expanded=await fakeRemote(rb,{kind:'expand',decisionId:b.decisionId,groupId:'g01'});
    assert.equal(expanded.result.status,'halted');assert.equal(expanded.called,1);
    const outside=await fakeRemote(rb,{kind:'choose',decisionId:b.decisionId,actionId:'a9999'});assert.equal(outside.result.status,'halted');
    const tooMany=freezeCopy({...rb,initialCandidateIds:rb.pool.slice(0,13).map(c=>c.actionId),offeredIds:rb.pool.slice(0,13).map(c=>c.actionId)});
    assert.equal((await fakeRemote(tooMany,{kind:'choose',decisionId:b.decisionId,actionId:lowId})).called,0);
    const badEnum=freezeCopy({...rb,enumSpec:legacyPolicy.enumSpec});assert.equal((await fakeRemote(badEnum,{kind:'choose',decisionId:b.decisionId,actionId:lowId})).called,0);
    const oldState=legacyFixture();const oldBundle=freezeDecisionCandidates({state:oldState,actorSeat:0,decisionId:'legacy-wire',decision:syntheticDecision(oldState)});
    assert.equal((await fakeRemote(remoteBundle(oldState,oldBundle),{kind:'choose',decisionId:oldBundle.decisionId,actionId:oldBundle.fallbackActionId})).result.status,'selected');
    let python:any=null;
    if(deliveryCase){
      // Unique local L's verified existing runtime. No install, environment probe,
      // model/weight read, optimization step, or API call is performed here.
      const executable=resolve('lab/.venv/bin/python3');
      const argv=[fileURLToPath(new URL('./check-candidate-s34-python.py',import.meta.url)),join(runDir,'python-input.json')];
      const result=spawnSync(executable,argv,{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
      if(result.stderr)process.stderr.write(result.stderr);
      assert.equal(result.status,0,'fixed existing Python same-set leg failed: '+String(result.error??result.stdout));
      python=JSON.parse(result.stdout.trim().split('\n').at(-1)!);
      assert.equal(python.status,'passed');assert.deepEqual(python.candidateIds,recorded.bundle.initialCandidateIds);assert.deepEqual(python.targetIds,[recorded.highId]);
    }
    console.log(JSON.stringify({checkId:which,status:python?'passed':'partial',scope:'S34_candidate_dimension_engineering399',candidateProtocol:'passed',captureAndStudent:'passed_actual_399_candidate_dimension',recordReloadAndFreeze:'passed_actual_store_and_dataset',strictWire:'passed_actual_profile_selector_fake_SSE',releaseContracts:'passed',selected:recorded.highId,K:recorded.bundle.initialCandidateIds.length,python:python??'not_run_in_DOT_existing_local_torch_required',datasetEligible:false,runDir,realTraining:false,realAPI:false}));
  } else console.log(JSON.stringify({checkId:which,status:'passed',beforePool:legacyRaw.length,pool:raw.length,K:b.offeredIds.length,legacyEnumeratedCombos:legacyLegal.length,enumeratedCombos:newLegal.length,legacyK:legacyOffered.initialCandidateIds.length,legacyEnumMs,enumMs,legacySyntheticScoreMs,syntheticScoreMs,legacyConstructMs,constructMs,scoringKind:'synthetic_index_ranking_no_model',timingScope:'one_fixed_fixture_not_a_benchmark',coverage:b.coverage}));
}
else throw new Error('Unknown or absent S34 checkId');
