import { describe, expect, it } from 'vitest';
import { applyMove, beats, buildDeck, classify, completeReturn, createMatch, DEFAULT_RULES, legalCombos, makeLevelCtx, pickReturnCard, startGame, type GameState } from '@gd/engine';
import { NeuralDecider } from '../../packages/ai/src/nn/neuralSeat';
import type { MLP } from '../../packages/ai/src/nn/mlp';
import { freezeDecisionCandidates } from '../../packages/ai/src/hybrid/candidates';
import { resolveLegalMove } from '../../packages/ai/src/hybrid/legality';
import { candidatePolicyForBundle, CURRENT_CANDIDATE_SPEC, FIRST_TARGET_CANDIDATE_POLICY } from '../../packages/ai/src/candidate-spec';
import { readExchange, restoreInitialGame, snapshotInitialGame } from '../../packages/web/src/game/exchange';
import { assertRootHistory, type PublicStep } from '../review6/match-play';
import { sampleVisibleWorld, toVisibleRoot } from '../review6/visible-world';
import { MatchController } from '../../packages/web/src/game/controller';
import { buildGameTableVM } from '../../packages/web/src/ui/gt/viewmodel';

const deck = buildDeck();
const faces = (names: string[]) => names.map(name => deck.find(c => c.suit === name[0] && c.rank === Number(name.slice(1)))!);

describe('5.4.3 sequence consumer chain', () => {
  it.each([
    ['straight', ['S3','C4','D5','S6','C7'], ['S2','C3','D4','S5','C6']],
    ['flush', ['S3','S4','S5','S6','S7'], ['S2','S3','S4','S5','S6']],
    ['pair_seq', ['S4','C4','S5','D5','S6','C6'], ['S3','C3','S4','D4','S5','C5']],
    ['trio_seq', ['S4','D4','C4','S5','D5','C5'], ['S3','D3','C3','S4','D4','C4']],
  ])('%s reaches strict legality, beats and frozen C under both candidate modes', (kind, own, lower) => {
    const state = startGame(createMatch(DEFAULT_RULES, 42));
    state.ctx = makeLevelCtx([5, 2], 'stage', 0);
    state.levelsBefore = state.match.levels = [5, 2];
    state.turn = state.leader = 0;
    state.hands[0] = faces(own as string[]);
    const combo = legalCombos(state).find(c => c.kind === kind && c.size === state.hands[0].length)!;
    const target = classify(faces(lower as string[]), state.ctx).find(c => c.kind === kind)!;
    expect(combo).toBeDefined();
    expect(beats(combo, target)).toBe(true);
    expect(beats(target, combo)).toBe(false);
    expect(resolveLegalMove(state, { pass: false, combo }).combo).toBe(combo);
    const scorer = { forward: (_x: Float32Array, n: number) => new Float32Array(n) } as MLP;
    for (const candidatePolicy of [undefined, FIRST_TARGET_CANDIDATE_POLICY]) {
      const decision = new NeuralDecider(0, scorer, 0, () => 0).decide(state, { wantRanking: true, candidatePolicy });
      const frozen = freezeDecisionCandidates({ state, actorSeat: 0, decisionId: 'v543', decision, candidatePolicy });
      expect(frozen.pool.some(row => row.canonical?.kind === kind && row.canonical.size === combo.size)).toBe(true);
      expect(candidatePolicyForBundle(frozen).candidateSpec).toBe(candidatePolicy?.candidateSpec ?? CURRENT_CANDIDATE_SPEC);
    }
    const repeated = { ...combo, cards: combo.cards.map((c, i) => i === 1 ? combo.cards[0] : c) };
    expect(() => resolveLegalMove(state, { pass: false, combo: repeated })).toThrow(/duplicate/);
  });
});

function doubleTribute(interactive: number[]): GameState {
  const high = [...deck.filter(c => c.rank === 17), ...deck.filter(c => c.rank >= 11 && c.rank <= 14).slice(0, 25)];
  const rest = deck.filter(c => !high.some(h => h.id === c.id));
  const initial = [high, rest.slice(27, 54), rest.slice(0, 27), rest.slice(54)];
  const match = createMatch(DEFAULT_RULES, 7);
  match.levels = [14, 2]; match.gameNo = 1; match.lastHead = 0;
  match.lastResult = { finishOrder: [0,2,1,3], winnerTeam: 0, doubleUp: true, levelsAfter: [14,2], upgrade: 3, passedA: false };
  return startGame(match, interactive, initial.map(hand => hand.map(c => c.id)));
}

it('same no-small double-tribute fixture survives AI/human, exchange, resume and visible replay', () => {
  const auto = doubleTribute([]), manual = doubleTribute([0,2]);
  expect(manual.hands[0].every(c => c.rank > 10)).toBe(true);
  expect(() => completeReturn(manual, manual.hands[0].find(c => c.rank === 12)!)).toThrow(/还贡/);
  while (manual.pendingReturns.length) completeReturn(manual, pickReturnCard(manual, manual.pendingReturns[0].from));
  expect(manual.tribute).toEqual(auto.tribute);
  expect(manual.hands).toEqual(auto.hands);
  const exchange = readExchange(manual, 'v543')!;
  expect(exchange.pairs.find(p => p.ret.from === 0)!.ret.card.rank).toBe(11);
  const restored = restoreInitialGame(snapshotInitialGame(manual), structuredClone(manual.match));
  expect(readExchange(restored, 'v543')).toEqual(exchange);
  assertRootHistory(restored, []);

  // Bring the high-only recipient to act, so its own hand remains known to the
  // legal-world sampler; no research game/teacher or external transport runs.
  const history: PublicStep[] = [];
  while (restored.turn !== 0) {
    const priorTarget = restored.lastCombo;
    const combo = priorTarget === null ? legalCombos(restored).find(c => c.kind === 'single')! : null;
    history.push({ priorTarget, events: applyMove(restored, combo ? { pass: false, combo } : { pass: true }) });
  }
  const observation = toVisibleRoot(restored, history);
  const world = sampleVisibleWorld(observation, 17, 64);
  expect(toVisibleRoot(world.state, history)).toEqual(observation);
  const invalid = structuredClone(manual);
  const transfer = invalid.tribute!.returns.find(r => r.from === 0)!;
  const higher = invalid.hands[0].find(c => c.rank === 12)!;
  const original = transfer.card;
  invalid.hands[0].splice(invalid.hands[0].findIndex(c => c.id === higher.id), 1, original);
  invalid.hands[transfer.to].splice(invalid.hands[transfer.to].findIndex(c => c.id === original.id), 1, higher);
  transfer.card = higher;
  expect(() => readExchange(invalid, 'v543')).toThrow(/合法集合/);
  expect(() => assertRootHistory(invalid, [])).toThrow(/还贡/);
});

it('actual controller hint/submission, table prompt and old history display share the corrected return path', () => {
  const state = doubleTribute([0,2]);
  const controller = new MatchController({ difficulty: 1, rules: DEFAULT_RULES });
  controller.match = state.match; controller.state = state;
  try {
    const hint = controller.returnHint()!;
    expect(hint.rank).toBe(11);
    const vm = buildGameTableVM(controller, state, { selection: new Set(), validCombo: null, returnCard: null });
    expect(vm.phase).toBe('return-pick');
    expect(vm.actions.message).toContain('最小的非万能牌');
    expect(vm.actions.message).not.toContain('选一张不大于 10');
    controller.submitReturn(hint);
    expect(state.tribute!.returns[0].card).toEqual(hint);
    // Remaining return is still pending; no AI/game move is executed here.
    expect(state.moveNo).toBe(0);
    expect(state.pendingReturns[0].from).toBe(2);
  } finally { controller.destroy(); }

  const auto = doubleTribute([]), exchange = readExchange(auto, 'v543-history')!;
  const historical = new MatchController({ difficulty: 1, rules: DEFAULT_RULES, resumeMatch: {
    ...auto.match, ruleOpts: DEFAULT_RULES, difficulty: 1, savedAt: 1, matchId: 'v543-history',
    exchangeHistory: [{ ...exchange, confirmedAt: null }],
  } });
  try {
    expect(historical.exchangeHistory).toHaveLength(1);
    expect(historical.exchangeHistory[0].pairs.find(p => p.ret.from === 0)!.ret.card.rank).toBe(11);
  } finally { historical.destroy(); }
});

it('existing active-save version binds corrected rules; old saves pause without mutation', () => {
  const controller = new MatchController({ difficulty: 1, rules: DEFAULT_RULES });
  const state = doubleTribute([0,2]);
  controller.state = state; controller.match = state.match;
  let save: ReturnType<MatchController['matchSavePoint']>;
  try {
    while (state.pendingReturns.length) controller.submitReturn(pickReturnCard(state, state.pendingReturns[0].from));
    save = controller.matchSavePoint();
    expect(save.activeGame?.schemaVersion).toBe(2);
  } finally { controller.destroy(); }
  for (const schemaVersion of [undefined, 1]) {
    const old = structuredClone(save!);
    Object.assign(old.activeGame!, { schemaVersion });
    const before = JSON.stringify(old);
    const restored = new MatchController({ difficulty: 1, rules: DEFAULT_RULES, resumeMatch: old });
    try {
      restored.startGame();
      expect(restored.state).toBeNull();
      expect(restored.exchangeError).toContain('旧规则活动存档');
      restored.startGame();
      expect(restored.state).toBeNull();
      expect(JSON.stringify(old)).toBe(before);
    } finally { restored.destroy(); }
  }
  const current = new MatchController({ difficulty: 1, rules: DEFAULT_RULES, resumeMatch: save! });
  try {
    current.startGame();
    expect(current.state?.hands).toEqual(state.hands);
    expect(current.state?.moveNo).toBe(0);
  } finally { current.destroy(); }
});
