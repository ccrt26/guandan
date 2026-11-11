import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { applyMove, classify, createMatch, DEFAULT_RULES, startGame } from '@gd/engine';
import * as matchPlay from '../review6/match-play';
import { sampleVisibleWorld, toVisibleRoot, type VisibleRoot } from '../review6/visible-world';

function root() {
  const state = startGame(createMatch({ ...DEFAULT_RULES }, 201));
  const priorTarget = state.lastCombo;
  const combo = classify([state.hands[state.turn][0]], state.ctx, state.match.opts)[0];
  const history = [{ events: applyMove(state, { pass: false, combo }), priorTarget }];
  return { state, history };
}

function rehash(obs: VisibleRoot) {
  const { observationSHA256, ...content } = obs;
  obs.observationSHA256 = createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

afterEach(() => vi.restoreAllMocks());

it('samples an unchanged own/public observation with one causal replay per accepted world', () => {
  const { state, history } = root(), obs = toVisibleRoot(state, history);
  const replay = vi.spyOn(matchPlay, 'assertRootHistory'); // Calls through to the real validator.
  const sample = sampleVisibleWorld(obs, 7, 1);
  expect(replay).toHaveBeenCalledTimes(1);
  expect(sample.attempts).toBe(1);
  expect(sample.state.hands[obs.actor]).toEqual(obs.ownCards);
  expect(sample.state.hands.map(hand => hand.length)).toEqual(obs.counts);
  expect(toVisibleRoot(sample.state, history)).toEqual(obs);
});

it('still validates external roots and every rejected sampled history', () => {
  const { state, history } = root(), obs = toVisibleRoot(state, history);
  const invalidState = structuredClone(state);
  invalidState.moveNo++;
  expect(() => toVisibleRoot(invalidState, history)).toThrow(/history prefix/);

  const bad = structuredClone(obs);
  bad.history[0].priorTarget = structuredClone(bad.statePublic.lastCombo);
  rehash(bad);
  const replay = vi.spyOn(matchPlay, 'assertRootHistory');
  expect(() => sampleVisibleWorld(bad, 7, 2)).toThrow(/history prior target mismatch/);
  expect(replay).toHaveBeenCalledTimes(2);
});

it('rejects a rehashed encoding mismatch after the single validation', () => {
  const { state, history } = root(), bad = toVisibleRoot(state, history);
  bad.modelState331[0] += 1;
  rehash(bad);
  const replay = vi.spyOn(matchPlay, 'assertRootHistory');
  expect(() => sampleVisibleWorld(bad, 7, 1)).toThrow(/changed own\/public observation or encoding/);
  expect(replay).toHaveBeenCalledTimes(1);
});
