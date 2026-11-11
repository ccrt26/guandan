import { describe, expect, it, vi } from 'vitest';
import { MLP } from '../src/nn/mlp';

const SHAPES = [[385, 164865], [399, 168449], [423, 174593]] as const;

describe('MLP stored-weight construction', () => {
  it.each(SHAPES)('loads %i inputs without random initialization and preserves scoring', (inputDim, parameterCount) => {
    const weights = new Float32Array(parameterCount);
    // One nonzero path through all three layers, including every bias block.
    weights[0] = 0.25;
    weights[inputDim * 256] = 0.1;
    weights[inputDim * 256 + 256] = 0.75;
    weights[inputDim * 256 + 256 + 65536] = -0.2;
    weights[parameterCount - 257] = 0.5;
    weights[parameterCount - 1] = 0.125;
    const legacy = new MLP(1, inputDim);
    legacy.setWeights(weights);

    const gaussian = vi.spyOn(Math, 'log').mockImplementation(() => { throw Error('random initialization ran'); });
    let loaded: MLP;
    try {
      loaded = MLP.fromWeights(weights, inputDim);
    } finally {
      gaussian.mockRestore();
    }
    expect(loaded!).toBeInstanceOf(MLP);
    expect(loaded!.inputDim).toBe(inputDim);
    expect(loaded!.sizes).toEqual([inputDim, 256, 256, 1]);
    expect(loaded!.paramCount).toBe(parameterCount);
    expect(loaded!.getWeights()).toEqual(weights);
    const X = new Float32Array(inputDim * 2);
    X[0] = 2;
    X[inputDim] = -1;
    expect(loaded!.forward(X, 2)).toEqual(legacy.forward(X, 2));
    expect(loaded!.forward(X, 2)[0]).toBeCloseTo(Math.tanh(Math.tanh(0.6) * 0.75 - 0.2) * 0.5 + 0.125, 7);
  });

  it('owns its arrays independently of input and other loaded networks', () => {
    const weights = new Float32Array(164865).fill(0.25);
    const first = MLP.fromWeights(weights);
    const second = MLP.fromWeights(weights);
    weights.fill(9);
    for (const array of [...first.W, ...first.b]) array.fill(-2);
    expect(second.getWeights().every(value => value === 0.25)).toBe(true);
    expect(first.getWeights().every(value => value === -2)).toBe(true);
    expect(weights.every(value => value === 9)).toBe(true);
  });

  it('rejects invalid dimensions, wrong lengths and non-finite weights', () => {
    for (const dim of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => MLP.fromWeights(new Float32Array(0), dim)).toThrow(/input dimension/);
    }
    for (const length of [164864, 164866]) {
      expect(() => MLP.fromWeights(new Float32Array(length))).toThrow(/weights length/);
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      const weights = new Float32Array(164865);
      weights[weights.length - 1] = value;
      expect(() => MLP.fromWeights(weights)).toThrow(/non-finite weights/);
    }
  });

  it('keeps setWeights failures atomic', () => {
    const network = MLP.fromWeights(new Float32Array(164865).fill(0.25));
    const invalid = new Float32Array(164865).fill(3);
    invalid[invalid.length - 1] = NaN;
    expect(() => network.setWeights(invalid)).toThrow(/non-finite weights/);
    expect(() => network.setWeights(new Float32Array(164864))).toThrow(/weights length/);
    expect(network.getWeights().every(value => value === 0.25)).toBe(true);
  });

  it('retains ordinary seeded and default constructor behavior', () => {
    const original = new MLP();
    expect(original.getWeights()).toEqual(new MLP(20261025, 385).getWeights());
    expect(original.W[0].some(value => value !== 0)).toBe(true);
    expect(original.b.every(layer => layer.every(value => value === 0))).toBe(true);
    expect(original.getWeights()).not.toEqual(new MLP(1).getWeights());
  });
});
