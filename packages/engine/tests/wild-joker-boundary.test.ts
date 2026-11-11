import { describe, expect, it } from 'vitest';
import { bestResponse, buildDeck, classify, DEFAULT_RULES, makeLevelCtx } from '../src';

const deck = buildDeck();
const jokers = (rank: number) => deck.filter(card => card.suit === 'J' && card.rank === rank);

describe('wildcards never substitute for jokers', () => {
  // Removing the non-joker-only pair classification boundary makes these fail:
  // classify used to emit both joker pairs for the two physical heart-level cards.
  it.each([2, 5, 14])('two heart level-%i cards stay ordinary-rank pairs', (level) => {
    const ctx = makeLevelCtx([level, 2], 'stage', 0);
    const wilds = deck.filter(card => card.suit === 'H' && card.rank === level);
    const choices = classify(wilds, ctx, DEFAULT_RULES);
    expect(choices).toHaveLength(13);
    expect(choices.every(combo => combo.kind === 'pair' && combo.mainRank >= 2 && combo.mainRank <= 14
      && combo.wildAs.every(assignment => assignment.asRank >= 2 && assignment.asRank <= 14))).toBe(true);
    expect(bestResponse(wilds, null, ctx, DEFAULT_RULES)?.mainRank).toBe(level);
    for (const rank of [16, 17]) {
      const target = classify(jokers(rank), ctx, DEFAULT_RULES)[0];
      expect(bestResponse(wilds, target, ctx, DEFAULT_RULES)).toBeNull();
    }
  });

  it.each([16, 17])('preserves natural joker pair %i and rejects one joker plus a wildcard', (rank) => {
    const ctx = makeLevelCtx([5, 2], 'stage', 0);
    const pair = jokers(rank);
    const [combo] = classify(pair, ctx, DEFAULT_RULES);
    expect(combo).toMatchObject({ kind: 'pair', mainRank: rank, cards: pair, wildAs: [] });
    const wild = deck.find(card => card.suit === 'H' && card.rank === 5)!;
    expect(classify([pair[0], wild], ctx, DEFAULT_RULES)).toEqual([]);
  });

  it('preserves the four-joker bomb and rejects a mixed joker pair', () => {
    const ctx = makeLevelCtx([5, 2], 'stage', 0);
    expect(classify([...jokers(16), ...jokers(17)], ctx, DEFAULT_RULES)).toMatchObject([
      { kind: 'joker_bomb', size: 4, wildAs: [] },
    ]);
    expect(classify([jokers(16)[0], jokers(17)[0]], ctx, DEFAULT_RULES)).toEqual([]);
  });
});
