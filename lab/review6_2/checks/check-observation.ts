/** B02 finite synthetic cases; no model weights, network, services or games. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { applyMove, buildDeck, classify, createMatch, DEFAULT_RULES, legalCombos, canPass, startGame, type Combo, type GameState } from '@gd/engine';
import { dedupCandidates } from '../../../packages/ai/src/nn/neuralSeat';
import { policyPositions } from './check-policy';
const deck = buildDeck();
const card = (rank: number, suit: string, copy = 0) => deck.filter(c => c.rank === rank && c.suit === suit)[copy];
const ranking = (state: GameState) => {
  const rows = dedupCandidates(legalCombos(state), canPass(state)).map((r, idx) => ({ ...r, idx, score: 1000 - idx }));
  return { move: rows[0].combo === null ? { pass: true as const } : { pass: false as const, combo: rows[0].combo }, nCands: rows.length, explored: false, ranking: rows };
};
function gameFixture() {
  const state = startGame(createMatch({ ...DEFAULT_RULES }, 1234));
  const history = { matchId: 'synthetic-match', gameNo: state.match.gameNo, throughMoveNo: 0, steps: [] as Array<{ events: ReturnType<typeof applyMove>; priorTarget: Combo | null }> };
  return { state, history };
}
function step(f: ReturnType<typeof gameFixture>, combo: Combo | null) {
  const priorTarget = structuredClone(f.state.lastCombo);
  const events = applyMove(f.state, combo === null ? { pass: true } : { pass: false, combo });
  f.history.steps.push({ events: structuredClone(events), priorTarget });
  f.history.throughMoveNo = f.state.moveNo;
}
export async function runObservationCase(caseId: string) {
  const obs = await import('../../../packages/ai/src/hybrid/observation');
  const candidates = await import('../../../packages/ai/src/hybrid/candidates');
  const legality = await import('../../../packages/ai/src/hybrid/legality');
  if (caseId === 'rules-text') {
    const text = obs.describeRules({ ...DEFAULT_RULES });
    for (const fragment of [
      'ohuo-engine-rules-v1', '两副牌108张',
      'single', 'pair', 'trio', 'trio_pair', 'straight', 'pair_seq', 'trio_seq', 'bomb', 'flush', 'joker_bomb',
      '天王炸 > 6—8张炸弹 > 同花顺 > 5张炸弹 > 4张炸弹 > 普通牌型',
      '序列剔除所有当前有效级牌', 'A可处于最低位置1或最高位置14',
      '万能牌不能代王', '实际花色/点数资源', '必要声明',
      '单张万能牌按当前有效级牌的最大rank', '钢板不带对子',
      '过牌不证明没有能压牌', '最后出牌者已出完',
      '末游贡给头游并由末游先出', '自动还贡', '无可还的≤10非万能牌',
      '第三名出完时结算本副', '3/2/1级', '本副开始已在A',
      '当前生效级牌以effectiveLevelRanks数组为准',
      'straightLen=5', 'flushLen=5', 'pairSeqMin=3,pairSeqMax=3', 'trioSeqMin=2,trioSeqMax=2',
    ]) assert.ok(text.includes(fragment), `missing rule text: ${fragment}`);
    const alternate = obs.describeRules({ levelMode: 'both', passA: 'double', pairSeqMin: 2, pairSeqMax: 4, trioSeqMin: 3, trioSeqMax: 4, flushLen: 6, straightLen: 6 });
    for (const fragment of ['历史both模式', '双上游', 'straightLen=6', '本版本B枚举只在straightLen=5时提案顺子', 'flushLen=6', 'pairSeqMin=2,pairSeqMax=4', 'trioSeqMin=3,trioSeqMax=4']) assert.ok(alternate.includes(fragment), fragment);
    assert.ok(obs.describeRules({ ...DEFAULT_RULES, levelMode: 'high', passA: 'head' }).includes('历史high模式'));
    assert.ok(text.length < 5000);
    return { rulesVersion: 'ohuo-engine-rules-v1', allEightOptionsRendered: true, kinds: 10, actualExecutionTributeTie: 'last finisher to head / last finisher leads', realEngineChanges: false, engineApplyMoves: 0 };
  }
  if (caseId === 'public-equivalence') {
    const f = gameFixture(); step(f, legalCombos(f.state).find(c => c.kind === 'single')!);
    const actorSeat = f.state.turn;
    const args = { ...f, actorSeat, decisionId: 'decision-public', matchId: f.history.matchId };
    const first = obs.buildObservation(args);
    const hidden = structuredClone(f.state); const others = [0, 1, 2, 3].filter(s => s !== actorSeat);
    [hidden.hands[others[0]][0], hidden.hands[others[1]][0]] = [hidden.hands[others[1]][0], hidden.hands[others[0]][0]];
    hidden.match.rngState = 777; (hidden as any).futureResult = 'SECRET_FUTURE';
    const noisyHistory = structuredClone(f.history);
    (noisyHistory.steps[0].events[0] as any).privateDebug = 'SECRET_HISTORY';
    noisyHistory.steps[0].events.unshift({ type: 'deal', hands: hidden.hands });
    assert.deepEqual(obs.buildObservation({ ...args, state: hidden, history: noisyHistory }), first);
    assert.equal(JSON.stringify(first).includes('SECRET'), false);
    assert.equal(JSON.stringify(first).includes('rngState'), false);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.publicPrefix), true);
    let calls = 0;
    const bundle = candidates.createDecisionBundle({ ...args, key: { controllerOrRunnerGeneration: 'fixture-gen', matchId: args.matchId, gameNo: f.state.match.gameNo, moveNo: f.state.moveNo, actorSeat, requestSeq: 1 },
      decider: { seat: actorSeat, decide(state, options) { calls++; assert.deepEqual(options, { wantRanking: true }); return ranking(state); } } });
    assert.equal(calls, 1);
    const request = candidates.decisionRequestView(bundle);
    assert.deepEqual(request.observation, first);
    assert.deepEqual(Object.keys(request).sort(), ['candidateSpec','candidates','expandableGroups','expansionCount','observation']);
    assert.equal(JSON.stringify(request).includes('physicalCardIds'), false);
    const saved = JSON.stringify(first); f.history.steps[0].events.splice(0); f.state.hands[actorSeat].splice(0);
    assert.equal(JSON.stringify(first), saved);
    const valid = gameFixture(); step(valid, legalCombos(valid.state)[0]);
    const a = { ...valid, matchId: valid.history.matchId, actorSeat: valid.state.turn, decisionId: 'missing-prefix' };
    assert.throws(() => obs.buildObservation({ ...a, history: { ...a.history, steps: [] } }), /history|prefix/);
    assert.throws(() => obs.buildObservation({ ...a, history: { ...a.history, gameNo: 99 } }), /history|game/);
    assert.throws(() => obs.buildObservation({ ...a, history: { ...a.history, throughMoveNo: a.state.moveNo + 1 } }), /history|prefix/);
    const badDeclaration = structuredClone(a.history); const badPlay = badDeclaration.steps[0].events.find(e => e.type === 'play')!;
    if (badPlay.type !== 'play') throw Error('missing fixture play');
    badPlay.combo.wildAs = [{ cardId: badPlay.combo.cards[0].id, asRank: 0, asSuit: 'S' }];
    assert.throws(() => obs.buildObservation({ ...a, history: badDeclaration }), (error: any) => error.status === 'halted');
    const wrongContext = structuredClone(a.state); wrongContext.stageTeam = 1;
    assert.throws(() => obs.buildObservation({ ...a, state: wrongContext }), /level|stage|context/);
    const futureEvent = structuredClone(a.history); futureEvent.steps[0].events.push({ type: 'gameEnd', result: { finishOrder: [0,1,2,3], winnerTeam: 0, doubleUp: false, levelsAfter: [3,2], upgrade: 1, passedA: false } });
    assert.throws(() => obs.buildObservation({ ...a, history: futureEvent }), /future|terminal/);
    assert.throws(() => obs.buildObservation({ ...a, actorSeat: (a.actorSeat + 1) % 4 }), /actor|turn/);
    const pending = structuredClone(a.state); pending.pendingReturns = [{ from: pending.turn, to: (pending.turn + 1) % 4 }];
    assert.throws(() => obs.buildObservation({ ...a, state: pending }), /play|return/);
    const sequence = gameFixture(); step(sequence, legalCombos(sequence.state).find(c => c.kind === 'single')!); step(sequence, null); step(sequence, null);
    const badOrder = structuredClone(sequence.history);
    (badOrder.steps[1].events[0] as { player: number }).player = (badOrder.steps[2].events[0] as { player: number }).player;
    const badState = structuredClone(sequence.state); badState.trickPlays[1].player = badState.trickPlays[2].player;
    assert.throws(() => obs.buildObservation({ state: badState, history: badOrder, matchId: badOrder.matchId, decisionId: 'wrong-turn-prefix', actorSeat: badState.turn }), /history.*turn|history.*actor/);
    return { hiddenEquivalence: true, immutable: true, singleDeciderCall: calls, rejectedMissingOrForeignOrFuturePrefix: true, engineApplyMoves: 5 };
  }
  if (caseId === 'canonical-roundtrip') {
    const legacy = await import('../../review6/match-play');
    const oldIdentity = await import('../../review6/action-effect');
    const result = [];
    for (const { name, state } of await policyPositions()) {
      const decision = ranking(state);
      const pool = candidates.freezeDecisionCandidates({ state, actorSeat: 0, decisionId: `roundtrip-${name}`, decision });
      for (const id of pool.initialCandidateIds) {
        const selected = candidates.selectOfferedAction(pool, pool.decisionId, id);
        assert.equal(selected.status, 'selected');
        if (selected.status !== 'selected') throw Error('selection not selected');
        const entry = pool.pool.find(x => x.actionId === id)!;
        assert.deepEqual(selected.canonical, entry.canonical);
        const move = selected.canonical === null ? { pass: true } : { pass: false, combo: selected.canonical };
        assert.deepEqual(legacy.resolveLegalMove(state, move), legality.resolveLegalMove(state, move));
        assert.equal(oldIdentity.necessaryDeclarationKey(selected.canonical, state.ctx), legality.necessaryDeclarationKey(selected.canonical, state.ctx));
        assert.equal(entry.canonicalId, legality.canonicalActionId(selected.canonical, state.ctx));
      }
      const pass = pool.pool.find(x => x.canonical === null);
      if (pass) assert.deepEqual(candidates.selectOfferedAction(pool, pool.decisionId, pass.actionId), { status: 'selected', actionId: pass.actionId, canonical: null, inInitialCandidateSet: true });
      if (name === 'wild') {
        assert.ok(pool.pool.some(x => x.canonical?.wildAs.length));
        assert.equal(pool.initialCandidateIds[0], pool.fallbackActionId);
        const declared = pool.pool.find(x => x.canonical?.wildAs.length)!.canonical!;
        const wrong = structuredClone(declared); wrong.wildAs[0].asRank = 8;
        assert.notEqual(legality.canonicalActionId(wrong, state.ctx), legality.canonicalActionId(declared, state.ctx));
        assert.throws(() => legality.resolveLegalMove(state, { pass: false, combo: wrong }), /identity mismatch/);
      }
      if (name === 'ordinary') {
        const single = classify([card(3,'C')], state.ctx, state.match.opts)[0];
        assert.equal(legality.necessaryDeclarationKey(single, state.ctx), '{"kind":"single","mainRank":3,"keyRank":3,"length":1,"size":1,"resources":[67],"wildAs":[],"pairRanks":[]}');
      }
      result.push({ name, nCands: pool.pool.length });
    }
    return { cases: result, modelForward: false, engineApplyMoves: 0 };
  }
  if (caseId === 'expand-stability') {
    const { state } = (await policyPositions())[0];
    state.hands[0] = [card(3,'C'),card(3,'D'),card(3,'S'),card(4,'C'),card(4,'D'),card(5,'S'),card(5,'D'),card(6,'S'),card(7,'S'),card(2,'H')];
    const decision = ranking(state);
    const pool = candidates.freezeDecisionCandidates({ state, actorSeat: 0, decisionId: 'expansion', decision });
    assert.equal(pool.initialCandidateIds.length, 8); assert.ok(pool.pool.length > 8);
    assert.deepEqual(pool.initialCandidateIds, ['a001','a002','a003','a010','a011','a014','a025','a026']);
    assert.ok(Object.isFrozen(pool.pool[0].canonical!.cards[0]));
    const publicInitial = candidates.offeredCandidateView(pool);
    const group = publicInitial.expandableGroups[0]; assert.ok(group);
    const hidden = pool.pool.find(c => !pool.offeredIds.includes(c.actionId))!;
    assert.equal(candidates.selectOfferedAction(pool, pool.decisionId, hidden.actionId).status, 'remote_failure');
    const expanded = candidates.expandDecisionCandidates(pool, pool.decisionId, group.groupId);
    assert.equal(expanded.status, 'expanded'); if (expanded.status !== 'expanded') throw Error('not expanded');
    const next = expanded.bundle;
    assert.deepEqual(next.initialCandidateIds, pool.initialCandidateIds); assert.equal(next.fallbackActionId, pool.fallbackActionId);
    assert.strictEqual(next.pool, pool.pool); assert.ok(next.offeredIds.length > 8 && next.offeredIds.length <= 12);
    assert.equal(pool.offeredIds.length, 8); assert.equal(next.expansionCount, 1);
    assert.equal(candidates.expandDecisionCandidates(next, next.decisionId, group.groupId).status, 'remote_failure');
    assert.equal(candidates.selectOfferedAction(next, 'stale', next.offeredIds[0]).status, 'remote_failure');
    assert.deepEqual(candidates.offeredCandidateView(next).expandableGroups, []);
    const newId = next.offeredIds.find(id => !pool.initialCandidateIds.includes(id))!;
    assert.equal(candidates.selectOfferedAction(next, next.decisionId, newId).inInitialCandidateSet, false);
    assert.ok(!JSON.stringify(publicInitial).includes('rawQ'));
    assert.ok(!JSON.stringify(publicInitial).includes(hidden.actionId));
    // Pin finish/pass promotion and actual wildcard group resource counting.
    const finishState = (await policyPositions())[2].state;
    const fd = ranking(finishState); fd.ranking.reverse(); fd.ranking.forEach((r, i) => { r.score = 100 - i; }); fd.move = { pass: true };
    const promoted = candidates.freezeDecisionCandidates({ state: finishState, actorSeat: 0, decisionId: 'finish-pass', decision: fd });
    assert.equal(promoted.pool[0].canonical, null);
    assert.ok(promoted.initialCandidateIds.some(id => promoted.pool.find(c => c.actionId === id)!.canonical?.cards.length === 2));
    assert.ok(promoted.pool.some(c => c.groupKey === 'pair:2:1'));
    const before = JSON.stringify(pool); decision.ranking[0].score = -999; state.hands[0][0] = card(14,'H');
    assert.equal(JSON.stringify(pool), before);
    return { initial: 8, expanded: next.offeredIds.length, pool: next.pool.length, immutableRankingAndFallback: true, engineApplyMoves: 0 };
  }
  if (caseId === 'pool-conflict') {
    const { state } = (await policyPositions())[0]; const good = ranking(state);
    const freeze = (decision: any) => candidates.freezeDecisionCandidates({ state, actorSeat: 0, decisionId: 'conflict', decision });
    const bad = [
      { ...good, nCands: good.nCands - 1 },
      { ...good, ranking: good.ranking.map((r, i) => i === 1 ? { ...r, idx: 0 } : r) },
      { ...good, ranking: good.ranking.map((r, i) => i === 0 ? { ...r, score: NaN } : r) },
      { ...good, move: { pass: true } },
      { ...good, ranking: good.ranking.map((r, i) => i === 0 ? { ...r, combo: { ...r.combo!, cards: [card(17,'J')] } } : r) },
    ];
    for (const d of bad) assert.throws(() => freeze(d), (e: any) => e.status === 'halted');
    const sliced = freeze({ ...good, nCands: 1, ranking: good.ranking.slice(0, 1) });
    assert.equal(sliced.isUniqueLegalAction, false);
    const only = (await policyPositions())[1].state; const sole = candidates.freezeDecisionCandidates({ state: only, actorSeat: 0, decisionId: 'sole', decision: ranking(only) });
    assert.equal(sole.pool.length, 1); assert.equal(sole.isUniqueLegalAction, true); assert.equal(sole.pool[0].canonical, null);
    return { haltedBadPools: bad.length, truncatedPoolNeverUnique: true, passSingletonVerified: true, engineApplyMoves: 0 };
  }
  if (caseId === 'public-accounting') {
    // One deterministic synthetic deal and a synthetic previous-public result.
    // startGame itself applies the real engine tribute/return rules, not a hand-
    // written transfer ledger. This is not a completed research game/match.
    const hands = [0, 1, 2, 3].map(s => deck.slice(s * 27, (s + 1) * 27).map(c => c.id));
    const gift = card(17, 'J', 0), twin = card(17, 'J', 1);
    const place = (id: number, destination: number) => {
      const source = hands.findIndex(h => h.includes(id)); if (source === destination) return;
      const at = hands[source].indexOf(id); const replacement = hands[destination].find(x => x !== gift.id && x !== twin.id)!;
      const j = hands[destination].indexOf(replacement); hands[source][at] = replacement; hands[destination][j] = id;
    };
    place(gift.id, 3); place(twin.id, 0);
    const match = createMatch({ ...DEFAULT_RULES }, 1234); match.gameNo = 1; match.lastHead = 0; match.levels = [3, 2];
    match.lastResult = { finishOrder: [0, 1, 2, 3], winnerTeam: 0, doubleUp: false, levelsAfter: [3, 2], upgrade: 1, passedA: false };
    const state = startGame(match, [], hands);
    const f = { state, history: { matchId: 'synthetic-exchange', gameNo: state.match.gameNo, throughMoveNo: 0, steps: [] as Array<{ events: ReturnType<typeof applyMove>; priorTarget: Combo | null }> } };
    const args = () => ({ ...f, matchId: f.history.matchId, actorSeat: f.state.turn, decisionId: `accounting-${f.state.moveNo}` });
    assert.equal(state.turn, 3); assert.equal(state.tribute!.resist, false);
    assert.equal(state.tribute!.tributes[0].card.id, gift.id);
    const initial = obs.buildObservation(args());
    const initialKnown = initial.knownOtherHands.find(r => r.seat === 0)!;
    assert.deepEqual(initialKnown.cards, [{ suit: 'J', rank: 17, count: 1 }]);
    const total = (o: typeof initial) => o.ownHand.reduce((n, c) => n + c.count, 0) + o.playedCards.reduce((n, c) => n + c.count, 0) + o.knownOtherHands.reduce((n, s) => n + s.cards.reduce((a, c) => a + c.count, 0), 0) + o.unseenPool.reduce((n, c) => n + c.count, 0);
    assert.equal(total(initial), 108);
    step(f, legalCombos(state).find(c => c.kind === 'single')!);
    assert.equal(state.turn, 0);
    step(f, classify([twin], state.ctx, state.match.opts)[0]);
    assert.ok(state.hands[0].some(c => c.id === gift.id));
    const before = obs.buildObservation(args());
    const lower = before.knownOtherHands.find(r => r.seat === 0)!;
    assert.equal(lower.cards.some(r => r.suit === 'J' && r.rank === 17), false);
    assert.deepEqual(before.effectiveLevelRanks, [...state.ctx.ranks]);
    assert.equal(Object.keys(before.ruleOptions).length, 8);
    assert.ok(Array.isArray(JSON.parse(JSON.stringify(before)).effectiveLevelRanks));
    assert.equal(total(before), 108);
    const passingSeat = state.turn; step(f, null);
    const after = obs.buildObservation(args());
    assert.deepEqual(after.knownOtherHands.find(r => r.seat === 0), lower);
    assert.ok(after.publicPrefix.some(s => s.events.some(e => e.type === 'pass' && e.player === passingSeat)));
    assert.ok(!JSON.stringify(after).includes('cannotBeat'));
    assert.ok(!JSON.stringify(after.tribute).includes('"id"'));
    assert.equal(total(after), 108);
    return { ruleFields: 8, ranksArray: true, initialKnownTransferredFaceCount: 1, lowerBoundAfterOtherCopyPlay: 0, transferNotDoubleCounted: true, passDoesNotInferAbsence: true, engineApplyMoves: 3, engineStartGameWithExchange: 1, fixture: 'fixed synthetic full deal + explicit synthetic previous result, real engine transfer events' };
  }
  throw Error(`unknown case: ${caseId}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--case') throw Error('Expected --case <registered selector>');
  const caseId = process.argv[3], startedAt = new Date().toISOString();
  try { const actual = await runObservationCase(caseId); console.log(JSON.stringify({ caseId, startedAt, completedAt: new Date().toISOString(), status: 'passed', actual })); }
  catch (error) { console.error(JSON.stringify({ caseId, startedAt, completedAt: new Date().toISOString(), status: 'failed', error: String(error) })); process.exitCode = 1; }
}
