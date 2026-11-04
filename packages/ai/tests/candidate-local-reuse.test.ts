import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDeck, classify, createMatch, DEFAULT_RULES, legalCombos, startGame, type GameState } from '@gd/engine';
import { freezeDecisionCandidates } from '../src/hybrid/candidates';
import { canonicalActionId, resolveLegalMove } from '../src/hybrid/legality';
import { NeuralDecider, type EncoderOpts, type NeuralDecision } from '../src/nn/neuralSeat';
import type { MLP } from '../src/nn/mlp';
import { FIRST_TARGET_CANDIDATE_POLICY, type CandidatePolicySpec } from '../src/candidate-spec';

// Count real local work; neither enumeration nor legality is replaced by a stub.
vi.mock('@gd/engine', async importOriginal => {
  const actual = await importOriginal<typeof import('@gd/engine')>();
  return { ...actual, legalCombos: vi.fn(actual.legalCombos) };
});
vi.mock('../src/hybrid/legality', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/hybrid/legality')>();
  return { ...actual, resolveLegalMove: vi.fn(actual.resolveLegalMove), canonicalActionId: vi.fn(actual.canonicalActionId) };
});

function fixture(ranks = [3, 4], followRank?: number): GameState {
  const state = startGame(createMatch({ ...DEFAULT_RULES }, 42));
  const deck = buildDeck();
  state.hands[0] = ranks.map(rank => deck.find(c => c.suit === 'S' && c.rank === rank)!);
  state.turn = state.leader = 0;
  state.lastCombo = followRank === undefined ? null : classify([deck.find(c => c.suit === 'D' && c.rank === followRank)!], state.ctx)[0];
  state.lastPlayer = followRank === undefined ? 0 : 1;
  return state;
}
function decide(state: GameState, encoder: EncoderOpts = {}, candidatePolicy?: CandidatePolicySpec): NeuralDecision {
  // Synthetic equal scores exercise the real enumerator/encoder and stable tie.
  const scorer = { forward: (_x: Float32Array, n: number) => new Float32Array(n) } as MLP;
  return new NeuralDecider(0, scorer, 0, () => 0, encoder).decide(state, { wantRanking: true, candidatePolicy });
}
function freeze(state: GameState, decision: NeuralDecision, candidatePolicy?: CandidatePolicySpec) {
  return freezeDecisionCandidates({ state, actorSeat: 0, decisionId: 'local-reuse', decision, candidatePolicy });
}

describe('candidate same-decision local reuse', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates and identifies the shared first choice once, preserving equal-score order and C', () => {
    const state = fixture();
    const decision = decide(state);
    const bundle = freeze(state, decision);
    expect(resolveLegalMove).toHaveBeenCalledTimes(2);
    expect(canonicalActionId).toHaveBeenCalledTimes(2);
    expect(bundle.pool.map(c => [c.actionId, c.originalIndex, c.canonical?.mainRank, c.rawQ])).toEqual([
      ['a001', 0, 3, 0], ['a002', 1, 4, 0],
    ]);
    expect(bundle.initialCandidateIds).toEqual(['a001', 'a002']);
    expect(bundle.offeredIds).toEqual(['a001', 'a002']);
    expect(bundle.fallbackActionId).toBe('a001');
    expect(bundle.isUniqueLegalAction).toBe(false);
  });

  it.each([undefined, FIRST_TARGET_CANDIDATE_POLICY])('uses only the original enumeration for a real singleton (%j)', candidatePolicy => {
    const state = fixture([3]);
    const bundle = freeze(state, decide(state, {}, candidatePolicy), candidatePolicy);
    expect(legalCombos).toHaveBeenCalledTimes(1);
    expect(resolveLegalMove).toHaveBeenCalledTimes(1);
    expect(canonicalActionId).toHaveBeenCalledTimes(1);
    expect(bundle.pool).toHaveLength(1);
    expect(bundle.isUniqueLegalAction).toBe(true);
  });

  it('preserves a PASS singleton and the full follow pool including PASS', () => {
    const state = fixture([3], 14);
    const bundle = freeze(state, decide(state));
    expect(legalCombos).toHaveBeenCalledTimes(1);
    expect(resolveLegalMove).toHaveBeenCalledTimes(1);
    expect(bundle.pool.map(c => c.canonical)).toEqual([null]);
    expect(bundle.isUniqueLegalAction).toBe(true);

    const follow = fixture([3, 4], 3);
    const full = freeze(follow, decide(follow));
    expect(full.pool.map(c => c.canonical?.mainRank ?? 'PASS')).toEqual([4, 'PASS']);
    expect(full.initialCandidateIds).toEqual(['a001', 'a002']);
    expect(full.isUniqueLegalAction).toBe(false);
  });

  it('does not mistake an injected singleton for the original complete legal pool', () => {
    const state = fixture();
    const decision = decide(state, { faultDropComboKeyPrefix: ['single:4:'] });
    expect(decision.nCands).toBe(1);
    expect(freeze(state, decision).isUniqueLegalAction).toBe(false);
    expect(legalCombos).toHaveBeenCalledTimes(1);
  });

  it('cold-enumerates external, cloned and already consumed singleton decisions', () => {
    const state = fixture([3]);
    const decision = decide(state);
    expect(freeze(state, structuredClone(decision)).isUniqueLegalAction).toBe(true);
    expect(legalCombos).toHaveBeenCalledTimes(2);
    expect(freeze(state, decision).isUniqueLegalAction).toBe(true);
    expect(legalCombos).toHaveBeenCalledTimes(2);
    expect(freeze(state, decision).isUniqueLegalAction).toBe(true);
    expect(legalCombos).toHaveBeenCalledTimes(3);

    const external = structuredClone(decision);
    Object.assign(external, { originalLegalActionCount: 1 });
    state.hands[0].push(buildDeck().find(c => c.suit === 'S' && c.rank === 4)!);
    expect(freeze(state, external).isUniqueLegalAction).toBe(false);
    expect(legalCombos).toHaveBeenCalledTimes(4);
  });

  it('cold-enumerates after changing the same state, replacing state, ranking or move', () => {
    for (const change of ['hand', 'state', 'ranking', 'move'] as const) {
      vi.clearAllMocks();
      let state = fixture([3]);
      const decision = decide(state);
      if (change === 'hand') state.hands[0].push(buildDeck().find(c => c.suit === 'S' && c.rank === 4)!);
      if (change === 'state') state = structuredClone(state);
      if (change === 'ranking') decision.ranking = [...decision.ranking!];
      if (change === 'move') decision.move = structuredClone(decision.move);
      expect(freeze(state, decision).isUniqueLegalAction).toBe(change !== 'hand');
      expect(legalCombos).toHaveBeenCalledTimes(2);
    }
  });

  it('still fully validates a separately supplied first move and rejects a false physical identity', () => {
    const state = fixture();
    const decision = decide(state);
    decision.move = structuredClone(decision.move);
    expect(freeze(state, decision).fallbackActionId).toBe('a001');
    expect(resolveLegalMove).toHaveBeenCalledTimes(3);
    expect(canonicalActionId).toHaveBeenCalledTimes(3);
    if (!decision.move.pass) decision.move.combo.cards[0].suit = 'D';
    expect(() => freeze(state, decision)).toThrow(/physical-card identity/);
  });

  it('rejects a non-pass move with a null combo even when the validated first row is PASS', () => {
    const state = fixture([3], 14);
    const decision = decide(state);
    decision.move = { pass: false, combo: null } as unknown as NeuralDecision['move'];
    expect(() => freeze(state, decision)).toThrow(/illegal empty declared move/);
  });

  it('retains full pool rejection for ties, duplicate actions, illegal declarations and physical cards', () => {
    for (const fault of ['tie', 'duplicate', 'declaration', 'physical', 'fallback'] as const) {
      const state = fixture();
      const decision = decide(state);
      if (fault === 'tie') decision.ranking!.reverse();
      if (fault === 'duplicate') decision.ranking![1].combo = decision.ranking![0].combo;
      if (fault === 'declaration') decision.ranking![1].combo!.kind = 'pair';
      if (fault === 'physical') {
        decision.ranking![1].combo = structuredClone(decision.ranking![1].combo);
        decision.ranking![1].combo!.cards[0].id = -1;
      }
      if (fault === 'fallback') decision.move = { pass: false, combo: decision.ranking![1].combo! };
      expect(() => freeze(state, decision), fault).toThrow();
    }
  });
});
