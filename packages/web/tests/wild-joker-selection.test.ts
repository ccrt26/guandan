import { expect, it } from 'vitest';
import { buildDeck, createMatch, DEFAULT_RULES, startGame } from '@gd/engine';
import { resolveLegalMove } from '../../ai/src/hybrid/legality';
import { MatchController } from '../src/game/controller';

it('human selection and strict AI legality agree on two heart-level cards before applying', () => {
  const deck = buildDeck();
  const wilds = deck.filter(card => card.suit === 'H' && card.rank === 5);
  const remaining = deck.filter(card => !wilds.some(wild => wild.id === card.id));
  const hands = [[...wilds, ...remaining.slice(0, 25)], remaining.slice(25, 52),
    remaining.slice(52, 79), remaining.slice(79)];
  const match = createMatch(DEFAULT_RULES, 5);
  match.levels = [5, 2];
  const state = startGame(match, [], hands.map(hand => hand.map(card => card.id)));
  state.turn = state.leader = state.lastPlayer = 0;
  const controller = new MatchController({ difficulty: 1, rules: DEFAULT_RULES });
  controller.match = match;
  controller.state = state;
  try {
    // Before the fix validateSelection returned pair-17, which strict legality rejects.
    const combo = controller.validateSelection(wilds)!;
    expect(combo).toMatchObject({ kind: 'pair', mainRank: 5, keyRank: 25 });
    expect(resolveLegalMove(state, { pass: false, combo }).combo).toBe(combo);
    controller.humanPlay(combo);
    expect(state.lastCombo).toBe(combo);
    expect(state.hands[0]).toHaveLength(25);
    expect(state.hands[0].some(card => wilds.some(wild => card.id === wild.id))).toBe(false);
    expect(state.moveNo).toBe(1);
  } finally {
    // Cancel any delayed AI scheduling; this is a single synthetic move, never a game run.
    controller.destroy();
  }
});
