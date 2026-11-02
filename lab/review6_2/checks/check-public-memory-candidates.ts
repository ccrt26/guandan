/** S32 fixed finite fixtures only: no model, API, user game or completed match. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { applyMove, buildDeck, classify, createMatch, DEFAULT_RULES, startGame, type Card, type Combo, type GameState } from '@gd/engine';
import { buildObservation } from '../../../packages/ai/src/hybrid/observation';
import type { Observation, PublicHistoryPrefix } from '../../../packages/ai/src/hybrid/protocol';

const deck = buildDeck();
const card = (rank: number, suit: Card['suit'], copy = 0) => deck.filter(c => c.rank === rank && c.suit === suit)[copy];
const zeros = [[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]];
function fixture(level = 7, reserved: Card[][] = [[],[],[],[]]) {
  const used = new Set(reserved.flat().map(c => c.id));
  assert.equal(used.size, reserved.flat().length);
  const hands = reserved.map(h => h.map(c => c.id));
  const rest = deck.filter(c => !used.has(c.id));
  for (const hand of hands) while (hand.length < 27) hand.push(rest.shift()!.id);
  const match = createMatch({ ...DEFAULT_RULES }, 1234);
  match.levels = [level, level]; match.lastHead = 0;
  const state = startGame(match, [], hands);
  const history: PublicHistoryPrefix = { matchId: 's32-synthetic', gameNo: state.match.gameNo, throughMoveNo: 0, steps: [] };
  return { state, history };
}
function step(f: ReturnType<typeof fixture>, cards: Card[] | null, select?: (c: Combo) => boolean) {
  const priorTarget = structuredClone(f.state.lastCombo);
  const combo = cards === null ? null : classify(cards, f.state.ctx, f.state.match.opts).find(select ?? (() => true));
  assert.ok(cards === null || combo, 'fixed physical fixture must have a legal declared combo');
  const events = applyMove(f.state, combo == null ? { pass: true } : { pass: false, combo });
  f.history = { ...f.history, throughMoveNo: f.state.moveNo, steps: [...f.history.steps, { events: structuredClone(events), priorTarget }] };
}
const args = (f: ReturnType<typeof fixture>) => ({ ...f, matchId: f.history.matchId, actorSeat: f.state.turn, decisionId: `s32-decision-${f.state.moveNo}` });
const prefix = (o: Observation) => ({ matchId: o.matchId, gameNo: o.gameNo, throughMoveNo: o.moveNo, steps: o.publicPrefix });
const deal = (o: Observation) => ({ matchId: o.matchId, gameNo: o.gameNo });
function physicalFixture() {
  const js = [card(11,'C'),card(11,'C',1)], qs = [card(12,'C'),card(12,'C',1)];
  const ks = [card(13,'C'),card(13,'C',1)], levels = [card(7,'H'),card(7,'C')];
  const sj = [card(16,'J'),card(16,'J',1)], bj = [card(17,'J'),card(17,'J',1)];
  const house = [card(11,'H'),card(11,'D'),card(7,'H',1),card(12,'H'),card(12,'D')];
  const f = fixture(7, [[...js,...sj],[...qs,...bj,...house],ks,levels]);
  const expectedByPlay = [
    [[2,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]],
    [[2,0,0,0,0,0],[0,2,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]],
    [[2,0,0,0,0,0],[0,2,0,0,0,0],[0,0,2,0,0,0],[0,0,0,0,0,0]],
    [[2,0,0,0,0,0],[0,2,0,0,0,0],[0,0,2,0,0,0],[0,0,0,2,0,0]],
    [[2,0,0,0,2,0],[0,2,0,0,0,0],[0,0,2,0,0,0],[0,0,0,2,0,0]],
    [[2,0,0,0,2,0],[0,2,0,0,0,2],[0,0,2,0,0,0],[0,0,0,2,0,0]],
  ];
  const observations: Observation[] = [];
  for (const cards of [js,qs,ks,levels,sj,bj]) { step(f,cards); observations.push(buildObservation(args(f))); }
  step(f,null); step(f,null); step(f,null);
  step(f,house,c => c.kind === 'trio_pair' && c.mainRank === 11 && c.pairRanks[0] === 12);
  observations.push(buildObservation(args(f)));
  expectedByPlay.push([[2,0,0,0,2,0],[2,4,0,1,0,2],[0,0,2,0,0,0],[0,0,0,2,0,0]]);
  return { f, observations, expectedByPlay };
}

export async function runPublicMemoryCase(caseId: string) {
  // The first RED run asserts the actual missing observation integration, rather
  // than relying on a missing-module/syntax error as a passing regression test.
  const observationModule = await import('../../../packages/ai/src/hybrid/observation');
  assert.equal(typeof (observationModule as any).buildObservationWithPublicMemory, 'function', 'S32 observation memory integration is required');
  const { buildObservationWithPublicMemory } = observationModule;
  const { buildPublicHighCardMemory, projectPublicHighCardMemory } = await import('../../../packages/ai/src/nn/publicMemory');
  const read = (o: Observation) => buildPublicHighCardMemory(prefix(o), deal(o), o.effectiveLevelRanks);
  if (caseId === 'memory.physical-counts') {
    const { f, observations, expectedByPlay } = physicalFixture();
    const actualByPlay = observations.map(o => read(o).countsBySeat);
    assert.deepEqual(actualByPlay, expectedByPlay);
    const last = observations.at(-1)!;
    assert.deepEqual(last.publicPrefix.at(-1)!.events[0].type, 'play');
    const j = fixture(11, [[card(11,'C'),card(11,'C',1)],[],[],[]]);
    step(j,[card(11,'C'),card(11,'C',1)]);
    const jm = read(buildObservation(args(j)));
    assert.deepEqual(jm.countsBySeat, [[2,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]]);
    assert.deepEqual(jm.levelPlayedBySeat, [2,0,0,0]);
    assert.equal(jm.countsBySeat.flat().reduce((a,b) => a+b,0),2);
    const bad = prefix(observations[0]);
    const conflict = structuredClone(bad.steps[0]);
    (conflict.events[0] as any).combo.mainRank = 12;
    assert.throws(() => buildPublicHighCardMemory({ ...bad, steps:[...bad.steps,conflict] },deal(last),[7]), /identity conflict/);
    const tooMany = structuredClone(bad);
    (tooMany.steps[0].events[0] as any).combo.resources = [{suit:'S',rank:11,count:2},{suit:'H',rank:11,count:2},{suit:'D',rank:11,count:2},{suit:'C',rank:11,count:3}];
    (tooMany.steps[0].events[0] as any).combo.size = 9;
    assert.throws(() => buildPublicHighCardMemory(tooMany,deal(last),[7]), /capacity/);
    (tooMany.steps[0].events[0] as any).combo.resources = [{suit:'J',rank:17,count:3}];
    (tooMany.steps[0].events[0] as any).combo.size = 3;
    assert.throws(() => buildPublicHighCardMemory(tooMany,deal(last),[7]), /capacity/);
    assert.deepEqual(buildObservationWithPublicMemory(args(f)).publicHighCardMemory,read(last));
    return { inputs: observations.map(o => ({ throughMoveNo:o.moveNo,publicPrefix:o.publicPrefix })), expectedByPlay, actualByPlay, levelJ:jm, rejected:['identity conflict','ordinary rank capacity','joker capacity'], engineApplyMoves:11, realTraining:false };
  }
  if (caseId === 'memory.prefix-reset') {
    const f = fixture(7, [[card(11,'C'),card(11,'C',1)],[],[],[]]);
    step(f,[card(11,'C')]); step(f,null); step(f,null); step(f,null); step(f,[card(11,'C',1)]);
    const o = buildObservation(args(f)), p = prefix(o), first = read(o);
    assert.deepEqual(first.countsBySeat, [[2,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]]);
    assert.deepEqual(read(o),first);
    assert.deepEqual(buildPublicHighCardMemory({...p,steps:[...p.steps,p.steps[0]]},deal(o),[7]),first);
    const nextDeal = {matchId:o.matchId,gameNo:o.gameNo+1};
    const next = buildPublicHighCardMemory({...nextDeal,throughMoveNo:0,steps:[]},nextDeal,[7]);
    assert.deepEqual(next.countsBySeat,zeros); assert.equal(next.throughEvent,null);
    assert.throws(() => buildPublicHighCardMemory({...p,throughMoveNo:4},deal(o),[7]), /future|cutoff/);
    assert.throws(() => buildPublicHighCardMemory({...p,steps:p.steps.slice(1)},deal(o),[7]), /complete|contiguous/);
    assert.throws(() => buildPublicHighCardMemory(p,nextDeal,[7]), /deal identity/);
    // Real engine tribute/return facts exist before play; they are not plays.
    const gift=card(17,'J'), twin=card(17,'J',1);
    const transfer=fixture(7,[[twin],[],[],[gift]]);
    const m=createMatch({...DEFAULT_RULES},1234); m.gameNo=1;m.lastHead=0;m.levels=[7,7];
    m.lastResult={finishOrder:[0,1,2,3],winnerTeam:0,doubleUp:false,levelsAfter:[7,7],upgrade:1,passedA:false};
    transfer.state=startGame(m,[],transfer.state.hands.map(h=>h.map(c=>c.id)));
    transfer.history={matchId:'s32-transfer',gameNo:2,throughMoveNo:0,steps:[]};
    const initial=buildObservationWithPublicMemory(args(transfer));
    assert.ok(initial.observation.tribute!.tributes.length);
    assert.deepEqual(initial.publicHighCardMemory.countsBySeat,zeros);
    step(transfer,[transfer.state.hands[3].find(c=>c.rank===2)!]);
    step(transfer,[gift]);
    const after=buildObservationWithPublicMemory(args(transfer));
    assert.deepEqual(after.publicHighCardMemory.countsBySeat,[[0,0,0,0,0,1],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]]);
    assert.equal(after.observation.knownOtherHands.find(s=>s.seat===0)!.cards.some(c=>c.rank===17),false);
    return { prefix:p, samePrefix:first, newDeal:next, transfer:initial.observation.tribute, beforeTransferPlay:initial.publicHighCardMemory, afterTransferPlay:after.publicHighCardMemory, rejected:['future/current action beyond cutoff','missing prefix','foreign deal'], engineApplyMoves:7, realTraining:false };
  }
  if (caseId === 'memory.seat-rotation') {
    const { observations }=physicalFixture(), memory=read(observations.at(-1)!);
    const a0=projectPublicHighCardMemory(memory,0), a1=projectPublicHighCardMemory(memory,1);
    assert.deepEqual(a0,[2,0,0,0,2,0, 0,0,2,0,0,0, 0,0,0,2,0,0, 2,4,0,1,0,2]);
    assert.deepEqual(a1,[2,4,0,1,0,2, 0,0,0,2,0,0, 2,0,0,0,2,0, 0,0,2,0,0,0]);
    assert.deepEqual(memory.countsBySeat,[[2,0,0,0,2,0],[2,4,0,1,0,2],[0,0,2,0,0,0],[0,0,0,2,0,0]]);
    assert.throws(()=>projectPublicHighCardMemory(memory,4),/seat/);
    return { countsBySeat:memory.countsBySeat,a0,a1,fixedDisplayByEngine:[1,4,2,3],modelNormalization:'S33: divide J/Q/K/LEVEL_OTHER by 8 and jokers by 2; not implemented here',engineApplyMoves:10 };
  }
  if (caseId === 'memory.public-only') {
    const { f }=physicalFixture(), input=args(f), first=buildObservationWithPublicMemory(input);
    const hidden=structuredClone(f.state), others=[0,1,2,3].filter(s=>s!==hidden.turn);
    [hidden.hands[others[0]][0],hidden.hands[others[1]][0]]=[hidden.hands[others[1]][0],hidden.hands[others[0]][0]];
    hidden.match.rngState=777; (hidden as any).futureResult='SECRET';
    const noisy=structuredClone(f.history);
    (noisy.steps[0].events[0] as any).privateDebug='SECRET';
    (noisy.steps[0].events as any[]).unshift({type:'deal',hands:hidden.hands});
    assert.deepEqual(buildObservationWithPublicMemory({...input,state:hidden,history:noisy}),first);
    assert.deepEqual(first.observation,buildObservation(input));
    assert.equal('publicHighCardMemory' in first.observation,false);
    assert.equal(first.observation.schema,'ohuo-public-observation-v1');
    assert.equal(JSON.stringify(first).includes('SECRET'),false);
    assert.ok(Object.isFrozen(first.publicHighCardMemory.countsBySeat[0]));
    const both=fixture(); both.state.match.opts.levelMode='both';both.state.match.levels=[7,11];both.state.levelsBefore=[7,11];both.state.ctx={ranks:new Set([7,11]),levels:[7,11]};
    assert.deepEqual(buildObservation(args(both)).effectiveLevelRanks,[7,11]);
    assert.throws(()=>buildObservationWithPublicMemory(args(both)),/single effective level/);
    return { publicMemory:first.publicHighCardMemory,hiddenEquivalent:true,legacyWireUnchanged:true,multiLevelExplicitlyRejected:true,engineApplyMoves:10,realTraining:false };
  }
  throw Error(`unknown case: ${caseId}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==4||process.argv[2]!=='--case')throw Error('Expected --case <registered selector>');
  const caseId=process.argv[3],startedAt=new Date().toISOString();
  try{const actual=await runPublicMemoryCase(caseId);console.log(JSON.stringify({caseId,startedAt,completedAt:new Date().toISOString(),status:'passed',actual}));}
  catch(error){console.error(JSON.stringify({caseId,startedAt,completedAt:new Date().toISOString(),status:'failed',error:String(error)}));process.exitCode=1;}
}
