import { describe, expect, it } from 'vitest';
import { buildDeck, classify, completeReturn, createMatch, DEFAULT_RULES, enumerateCombos, legalReturnCards, makeLevelCtx, pickReturnCard, rankOrder, seqSlots, startGame, type Card, type GameState } from '../src/index';

const deck = buildDeck();
const cards = (faces: string[]) => faces.map(face => deck.find(c => c.suit === face[0] && c.rank === Number(face.slice(1)))!);
const pending = (hand: Card[], level = 5): GameState => {
  const state = startGame(createMatch(DEFAULT_RULES, 1));
  state.ctx = makeLevelCtx([level, 2], 'stage', 0);
  state.hands[0] = hand;
  state.pendingReturns = [{ from: 0, to: 3 }];
  state.tribute = { resist: false, tributes: [], returns: [], leader: 3 };
  state.turn = 0;
  return state;
};

describe('5.4.3 natural level sequences', () => {
  it.each([
    ['straight', ['S3','C4','D5','S6','C7'], 7],
    ['flush', ['S3','S4','S5','S6','S7'], 7],
    ['pair_seq', ['S4','C4','S5','D5','S6','C6'], 6],
    ['trio_seq', ['S4','D4','C4','S5','D5','C5'], 5],
  ] as const)('classifies and enumerates %s across natural level 5', (kind, faces, keyRank) => {
    const hand = cards([...faces]), ctx = makeLevelCtx([5, 2], 'stage', 0);
    expect(classify(hand, ctx).some(c => c.kind === kind && c.keyRank === keyRank)).toBe(true);
    expect(enumerateCombos(hand, ctx).some(c => c.kind === kind && c.keyRank === keyRank && c.cards.length === hand.length)).toBe(true);
    expect(rankOrder(5, ctx)).toBe(25);
  });
  it.each([2, 5, 14])('retains low/high A and all positions at level %i', level => {
    const ctx = makeLevelCtx([level, 2], 'stage', 0);
    expect(seqSlots(ctx).map(s => s.pos)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    for (const [faces, keyRank] of [[['S14','S2','C3','D4','C5'], 5], [['S10','C11','D12','S13','C14'],14]] as const) {
      expect(classify(cards([...faces]), ctx).some(c => c.kind === 'straight' && c.keyRank === keyRank)).toBe(true);
    }
  });
  it('preserves natural and substitute hearts, missing-rank and joker rejection', () => {
    const ctx = makeLevelCtx([5, 2], 'stage', 0);
    expect(classify(cards(['S3','C4','H5','S6','C7']), ctx).some(c => c.kind === 'straight' && c.keyRank === 7)).toBe(true);
    expect(classify(cards(['S6','C7','H5','S8','C9']), ctx).some(c => c.kind === 'straight' && c.keyRank === 10)).toBe(true);
    expect(classify(cards(['S3','C4','D6','S7','C8']), ctx)).toEqual([]);
    expect(classify(cards(['S3','C4','J16','S6','C7']), ctx)).toEqual([]);
  });
});

describe('5.4.3 shared return legality', () => {
  it('AI and human accept every tied minimum non-wild when no small card exists', () => {
    const hand = cards(['S11','C11','D12','H5']);
    const state = pending(hand);
    expect(legalReturnCards(hand, state.ctx).map(c => c.id)).toEqual(hand.slice(0, 2).map(c => c.id));
    expect(pickReturnCard(state, 0)).toBe(hand[0]);
    expect(() => completeReturn(state, hand[2])).toThrow(/还贡/);
    expect(() => completeReturn(state, hand[3])).toThrow(/还贡/);
    for (const card of hand.slice(0, 2)) {
      const copy = pending([...hand]);
      completeReturn(copy, card);
      expect(copy.tribute!.returns[0].card).toBe(card);
      expect(copy.turn).toBe(3);
    }
  });
  it('small natural level cards remain eligible and high fallback cannot bypass them', () => {
    const state = pending(cards(['S5','S11','H5']));
    expect(legalReturnCards(state.hands[0], state.ctx)).toEqual([state.hands[0][0]]);
    expect(() => completeReturn(state, state.hands[0][1])).toThrow(/还贡/);
    expect(() => completeReturn(state, { ...state.hands[0][0], rank: 4 })).toThrow(/实体/);
    expect(() => completeReturn(state, cards(['D3'])[0])).toThrow(/手中/);
  });
});
