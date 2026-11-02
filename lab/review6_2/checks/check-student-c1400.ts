/** NAV-S33 local-only finite C1400 migration. Uses existing local assets only.
 * No training, API, whole games, registry/default changes, or public release.
 * Run only the frozen student.same-input-smoke check after S32/Q01 prerequisites.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyMove, buildDeck, classify, createMatch, DEFAULT_RULES, startGame } from '@gd/engine';
import { resolveNodePolicy, POLICY_REPOSITORY_ROOT } from '../policy-loader';
import { STUDENT_SCORER_ENCODER, validateStudentScorerDescriptor, resolveStudentScorer } from '../../../packages/ai/src/policy/resolve';
import { PublicTracker, encodeStateV2, encodeAction, encodeStudentInput399Plus24, remapLegacy399WeightsToStudent423 } from '../../../packages/ai/src/nn/schema';
import { buildObservationWithPublicMemory } from '../../../packages/ai/src/hybrid/observation';
import { resolveLegalMove, canonicalActionId } from '../../../packages/ai/src/hybrid/legality';

const digest = (b:Uint8Array) => createHash('sha256').update(b).digest('hex');
export const EXPECTED_C1400 = Object.freeze({
  architectureId:'mlp-tanh-256x256-scalar-v1',weightsLayoutVersion:'f32le-layer-w-row-major-then-b-v1',epsilon:0,tieBreakId:'first-candidate-v1',
  policyId:'r62-p8c-control-u1400-greedy',modelVersion:'r62-p8c-control-u001400-41c9a38f',parameterCount:168449,inputDim:399,
  weightsPathOrUrl:{nodePath:'lab/review6_2/runs/r62-p8c-control/checkpoints/u001400-41c9a38f/weights.f32',assetUrl:'ai/ohuo/ohuo-1030-b-v1/weights.f32'},
  weightsSHA256:'d05c52bbd28883760da11f042be2d110fd3b3a9affd97edd7aed43c9421eb081',
  encoder:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64',encoderVersion:'gd-lab-schema-v4'},candidateSpecId:'cand-suit-v3',tierSpecId:'none',
});
/** Three fixed independently legal actions at one synthetic public decision.
 * The actual old/new C1400 networks, not any synthetic substitute, score them. */
export function studentParityFixture() {
  const deck=buildDeck(), card=(rank:number)=>deck.find(c=>c.suit==='C'&&c.rank===rank)!;
  const [j,q,k]=[11,12,13].map(card), reserved=[[j],[q,k],[],[]];
  const used=new Set(reserved.flat().map(c=>c.id)),rest=deck.filter(c=>!used.has(c.id));
  const hands=reserved.map(cards=>cards.map(c=>c.id));for(const hand of hands)while(hand.length<27)hand.push(rest.shift()!.id);
  const match=createMatch({...DEFAULT_RULES},3301);match.levels=[7,7];match.lastHead=0;
  const state=startGame(match,[],hands), tracker=new PublicTracker();
  const played=classify([j],state.ctx,state.match.opts)[0];resolveLegalMove(state,{pass:false,combo:played});
  const events=applyMove(state,{pass:false,combo:played});tracker.observe(events);
  const history={matchId:'s33-c1400-engineering-only',gameNo:state.match.gameNo,throughMoveNo:state.moveNo,steps:[{events,priorTarget:null}]};
  const envelope=buildObservationWithPublicMemory({state,history,matchId:history.matchId,actorSeat:state.turn,decisionId:'s33-three-candidates'});
  const key={matchId:history.matchId,gameNo:state.match.gameNo,moveNo:state.moveNo,actorSeat:state.turn};
  const candidates=[null,...[q,k].map(c=>classify([c],state.ctx,state.match.opts)[0])];
  for(const combo of candidates)resolveLegalMove(state,combo?{pass:false,combo}:{pass:true});
  const oldRows=candidates.map(combo=>{const x=new Float32Array(399);encodeStateV2(state,state.turn,tracker,x.subarray(0,331),'rule-context');encodeAction(combo,x.subarray(331),'action64');return x;});
  const newRows=candidates.map(combo=>encodeStudentInput399Plus24(state,tracker,combo,key,envelope.publicHighCardMemory));
  newRows.forEach((x,i)=>assert.deepEqual(x.slice(0,399),oldRows[i]));
  return {oldRows,newRows,candidateIds:candidates.map(c=>canonicalActionId(c,state.ctx)),memory:envelope.publicHighCardMemory,key};
}
export async function writeExactNew(path:string, bytes:Uint8Array) {
  try { await writeFile(path,bytes,{flag:'wx',mode:0o600}); }
  catch(error:any) { if(error.code!=='EEXIST')throw error;assert.deepEqual(new Uint8Array(await readFile(path)),new Uint8Array(bytes),'existing migration output differs; no overwrite'); }
}
async function run() {
  assert.equal(process.argv.length,4,'one exact --case only');assert.equal(process.argv[2],'--case');assert.equal(process.argv[3],'student.same-input-smoke');
  const parent=await resolveNodePolicy(EXPECTED_C1400.policyId);
  assert.deepEqual(parent.descriptor,EXPECTED_C1400,'entire actual C1400 descriptor must match frozen parent');
  const parentPath=resolve(POLICY_REPOSITORY_ROOT,EXPECTED_C1400.weightsPathOrUrl.nodePath);
  const sourceBytes=new Uint8Array(await readFile(parentPath));assert.equal(digest(sourceBytes),EXPECTED_C1400.weightsSHA256);
  const oldNet=parent.createNetwork(), oldFlat=oldNet.getWeights(), migrated=remapLegacy399WeightsToStudent423(oldFlat);
  for(let h=0;h<256;h++) {assert.deepEqual(migrated.slice(h*423,h*423+399),oldFlat.slice(h*399,(h+1)*399));assert(migrated.slice(h*423+399,(h+1)*423).every(v=>v===0));}
  assert.deepEqual(migrated.slice(108288),oldFlat.slice(102144));assert.equal(migrated.length,174593);
  const bytes=new Uint8Array(migrated.byteLength),view=new DataView(bytes.buffer);migrated.forEach((v,i)=>view.setFloat32(i*4,v,true));
  const targetSHA256=digest(bytes),relativeRoot='lab/out/S33-student-migration';
  const descriptor=validateStudentScorerDescriptor({schema:'ohuo-student-scorer-v1',policyId:`s0-untrained-memory24-${targetSHA256.slice(0,12)}`,modelVersion:`s0-untrained-memory24-${targetSHA256.slice(0,12)}`,
    architectureId:EXPECTED_C1400.architectureId,weightsLayoutVersion:EXPECTED_C1400.weightsLayoutVersion,inputDim:423,parameterCount:174593,
    weightsPathOrUrl:{nodePath:relativeRoot+'/weights.f32'},weightsSHA256:targetSHA256,encoder:STUDENT_SCORER_ENCODER,tieBreakId:EXPECTED_C1400.tieBreakId});
  const scorer=await resolveStudentScorer(descriptor,{site:'node',readWeights:async()=>bytes,sha256:digest});
  const fixture=studentParityFixture();
  const oldScores=oldNet.forward(new Float32Array(fixture.oldRows.flatMap(r=>[...r])),3);
  const newScores=scorer.createNetwork().forward(new Float32Array(fixture.newRows.flatMap(r=>[...r])),3);
  for(let i=0;i<3;i++)assert(Number.isFinite(oldScores[i])&&Number.isFinite(newScores[i])&&Math.abs(oldScores[i]-newScores[i])<=1e-6*(1+Math.max(Math.abs(oldScores[i]),Math.abs(newScores[i]))),'fixed tolerance exceeded; do not widen');
  const pick=(s:Float32Array)=>{let p=0;for(let i=1;i<s.length;i++)if(s[i]>s[p])p=i;return p;};assert.equal(pick(oldScores),pick(newScores),'first-candidate selection changed');
  assert.equal(digest(new Uint8Array(await readFile(parentPath))),EXPECTED_C1400.weightsSHA256,'parent file changed');
  const codePaths=['packages/ai/src/nn/schema.ts','packages/ai/src/nn/mlp.ts','packages/ai/src/nn/publicMemory.ts','packages/ai/src/policy/descriptor.ts','packages/ai/src/policy/resolve.ts','lab/review6_2/policy-loader.ts','lab/review6_2/checks/check-student-c1400.ts'];
  const codeRefs=await Promise.all(codePaths.map(async path=>({path,sha256:digest(new Uint8Array(await readFile(resolve(POLICY_REPOSITORY_ROOT,path))))})));
  const receipt={schema:'ohuo-student-migration-receipt-v1',parentRef:parent.descriptor,sourceRegistryRef:{path:'lab/model-index.json',sha256:digest(new Uint8Array(await readFile(resolve(POLICY_REPOSITORY_ROOT,'lab/model-index.json'))))},target:descriptor,
    migration:{ruleId:'legacy399-append24-zero-w1-columns-v1',codeRefs,sourceSHA256:EXPECTED_C1400.weightsSHA256,targetSHA256,
      sourceEncoder:parent.descriptor.encoder,targetEncoder:descriptor.encoder,offsets:{W1:0,b1:108288,W2:108544,b2:174080,W3:174336,b3:174592},newColumnsZero:6144,
      parameters:174593,bytes:698372,initialization:'cross-input-migration-fresh-optimizer',strictResume:false},
    finiteEvidence:{checkId:'student.same-input-smoke',candidateIds:fixture.candidateIds,oldScores:[...oldScores],newScores:[...newScores],selected:fixture.candidateIds[pick(oldScores)],
      tolerance:'abs(diff)<=1e-6*(1+max(abs(q_old),abs(q_new)))',memory:fixture.memory,key:fixture.key,parentFileUnchanged:true},
    datasetEligible:false,realTraining:false,learningImprovementClaimed:false,publicRelease:false,acceptance:'pending-Q02'};
  const root=resolve(POLICY_REPOSITORY_ROOT,relativeRoot);await mkdir(root,{recursive:true});assert.equal(await realpath(root),root,'migration output symlink forbidden');
  await writeExactNew(resolve(root,'weights.f32'),bytes);
  await writeExactNew(resolve(root,'scorer-descriptor.json'),Buffer.from(JSON.stringify(descriptor,null,2)+'\n'));
  const diskScorer=await resolveStudentScorer(descriptor,{site:'node',readWeights:async location=>new Uint8Array(await readFile(resolve(POLICY_REPOSITORY_ROOT,location))),sha256:digest});
  assert.deepEqual(diskScorer.createNetwork().getWeights(),migrated);
  await writeExactNew(resolve(root,'migration-receipt.json'),Buffer.from(JSON.stringify(receipt,null,2)+'\n'));
  console.log(JSON.stringify({checkId:'student.same-input-smoke',sourceSHA256:EXPECTED_C1400.weightsSHA256,targetSHA256,parameters:migrated.length,bytes:bytes.byteLength,oldScores:[...oldScores],newScores:[...newScores],selected:fixture.candidateIds[pick(oldScores)],outputRoot:relativeRoot,realTraining:false,publicRelease:false}));
}
// Importing the fixture for synthetic verification never reads real model assets.
if(process.argv[1] && new URL(import.meta.url).pathname===resolve(process.argv[1])) await run();
