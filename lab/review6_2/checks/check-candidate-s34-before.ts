/** candidate.legacy-spec-smoke before leg; stage alone before product apply. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DEFAULT_RULES,legalCombos,makeLevelCtx,classify,canPass,type Card,type GameState} from '@gd/engine';
import {MLP} from '../../../packages/ai/src/nn/mlp';
import {NeuralDecider,dedupCandidates,type NeuralDecision} from '../../../packages/ai/src/nn/neuralSeat';
import {freezeDecisionCandidates,offeredCandidateView,expandDecisionCandidates,selectOfferedAction} from '../../../packages/ai/src/hybrid/candidates';
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

const root=fileURLToPath(new URL('../../../',import.meta.url));
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const originals:Record<string,string>={
 'packages/engine/src/combo.ts':'9619a3912f757fce8a7e4842559789dbafe54aa1f71763057ae44b6a78035bb2',
 'packages/engine/src/game.ts':'30a383a4f000c934f62748ed9c5f3b0893f787d788a254832829347096a896df',
 'packages/ai/src/nn/neuralSeat.ts':'cb9d0aa9dbfbd66a44c444e8531abf7b633d1c293e9ec6292d1192e9b9d2eb50',
 'packages/ai/src/hybrid/candidates.ts':'0cf53c6d45af4a3a15fb860e8b8939a14654661955195eafdd2ae3c7d33fc580',
 'packages/ai/src/hybrid/protocol.ts':'563b1329aa37bf78bef2f079a540afc2f01c985e699ad944a85f7f044a48046d'};
for(const [path,expected] of Object.entries(originals))assert.equal(sha(readFileSync(resolve(root,path))),expected,'before source must precede S34 apply: '+path);
const synthetic=process.argv[2]==='--synthetic';
assert(synthetic?process.argv.length===4:process.argv.length===2,'fixed local C1400 capture or explicit cloud synthetic only');
const output=synthetic?resolve(process.argv[3]):resolve(root,'lab/out/S34-candidate-legacy-before/legacy-c1400-before.json');
let net:MLP|undefined;
if(!synthetic){
 const bytes=readFileSync(resolve(root,c1400Identity.weightsPathOrUrl.nodePath));
 assert.equal(sha(bytes),c1400Identity.weightsSHA256);assert.equal(bytes.length,c1400Identity.parameterCount*4);
 net=new MLP(0,399);net.setWeights(Float32Array.from({length:c1400Identity.parameterCount},(_,i)=>bytes.readFloatLE(i*4)));
}
const state=legacyFixture();
const combos=dedupCandidates(legalCombos(state),canPass(state)).map(x=>x.combo);
const decision:NeuralDecision=net?new NeuralDecider(0,net,0,()=>0,c1400Identity.encoder).decide(state,{wantRanking:true}):{
 move:combos[0]?{pass:false,combo:combos[0]}:{pass:true},nCands:combos.length,explored:false,
 ranking:combos.map((combo,idx)=>({combo,idx,score:combos.length-idx}))};
const bundle=freezeDecisionCandidates({state,actorSeat:0,decisionId:'fixed-333-88-AA',decision});
const group=offeredCandidateView(bundle).expandableGroups[0];
const snapshot={scoringIdentity:net?c1400Identity:{kind:'synthetic-index-ranking'},
 pool:bundle.pool.map(c=>({canonicalId:c.canonicalId,rank:c.rank,originalIndex:c.originalIndex,rawQ:c.rawQ})),
 initial:[...bundle.initialCandidateIds],expansion:group?expandDecisionCandidates(bundle,bundle.decisionId,group.groupId):null,
 selected:selectOfferedAction(bundle,bundle.decisionId,bundle.fallbackActionId)};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(snapshot,null,2),{flag:'wx'});
console.log(JSON.stringify({checkId:'candidate.legacy-spec-smoke',leg:'before-capture',synthetic,output,sha256:sha(readFileSync(output)),
 weightsRead:!synthetic,scoringIdentity:snapshot.scoringIdentity,sourceHashes:{...originals,
 'packages/ai/src/nn/schema.ts':sha(readFileSync(resolve(root,'packages/ai/src/nn/schema.ts'))),
 'packages/ai/src/nn/mlp.ts':sha(readFileSync(resolve(root,'packages/ai/src/nn/mlp.ts')))}}));
