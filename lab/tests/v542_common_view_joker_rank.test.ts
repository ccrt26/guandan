import {describe, expect, it} from 'vitest';
import {buildDeck, classify, makeLevelCtx} from '@gd/engine';
import {encodeAction} from '../../packages/ai/src/nn/schema';
import {buildCommonTeacherView} from '../review6_2/first-round-common-view';
import {COMMON_VIEW_WIRE_SCHEMA, freezeCommonViewRequest} from '../../packages/web/server/llm-selection-wire.mjs';

const jokerBomb = classify(buildDeck().filter(c => c.suit === 'J'), makeLevelCtx([2, 2], 'stage', 0))[0];
const encodedAction = new Float32Array(68);
encodeAction(jokerBomb, encodedAction, 'action64');
const fixture = () => {
  const input = Array(423).fill(0);
  input.splice(331, 68, ...encodedAction);
  return input;
};
const view = (input: number[]) => buildCommonTeacherView([{actionId: 'a-joker', input423: input}], {inputDim: 423, passEncoding: 'action64'});
const wire = (payload: ReturnType<typeof view>['modelPayload']) => freezeCommonViewRequest({schema: COMMON_VIEW_WIRE_SCHEMA, decisionId: 'fixture', modelPayloadBytes: JSON.stringify(payload), addressMap: [{address: 'c0', actionId: 'a-joker', equivalentActionIds: ['a-joker']}]});

describe('common view preserves the engine joker-bomb rank sentinel', () => {
  it('decodes the original Float32 action encoding and passes the wire boundary', () => {
    expect(jokerBomb.kind).toBe('joker_bomb');
    expect(jokerBomb.keyRank).toBe(99);
    const actual = view(fixture());
    expect(actual.modelPayload.candidates[0].action.comparisonRank).toBe(99);
    expect(wire(actual.modelPayload).modelPayloadBytes).toBe(actual.modelPayloadBytes);
  });

  it('preserves the same sentinel in target and recent public history', () => {
    const input = fixture();
    input[174] = 1; input[175] = Math.fround(99 / 41); input[176] = Math.fround(4 / 10);
    input[195] = 1; input[197] = Math.fround(99 / 41); input[198] = Math.fround(4 / 10);
    const actual = view(input);
    expect(actual.modelPayload.state.currentTarget.comparisonRank).toBe(99);
    expect(actual.modelPayload.state.recentMoves.partner[0].comparisonRank).toBe(99);
    expect(wire(actual.modelPayload).modelPayloadBytes).toBe(actual.modelPayloadBytes);
  });

  it('continues rejecting non-sentinel overflow and a sentinel paired with another kind', () => {
    for (const [kindIndex, rank] of [[9, 42], [9, 98], [9, 100], [9, 99.25], [0, 99], [9, Infinity]]) {
      const input = fixture(); input.fill(0, 385, 395); input[385 + kindIndex] = 1; input[396] = Math.fround(rank / 41);
      expect(() => view(input)).toThrow();
    }
    for (const location of ['action', 'target', 'recent'] as const) {
      for (const [kind, comparisonRank] of [['joker_bomb', 42], ['joker_bomb', 98], ['joker_bomb', 100], ['single', 99]] as const) {
        const payload = view(fixture()).modelPayload;
        const value = location === 'action' ? payload.candidates[0].action : location === 'target' ? payload.state.currentTarget : payload.state.recentMoves.partner[0];
        value.kind = kind; value.comparisonRank = comparisonRank;
        expect(() => wire(payload)).toThrow('invalid_request');
      }
    }
  });
});
