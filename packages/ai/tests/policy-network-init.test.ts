import { describe, expect, it, vi } from 'vitest';
import { resolvePolicy, resolveStudentScorer, STUDENT_SCORER_ENCODER } from '../src/policy/resolve';

describe('resolved network initialization', () => {
  it.each([[385, 164865], [399, 168449], [423, 174593]] as const)(
    'loads isolated %i-input networks without random initialization', async (inputDim, parameterCount) => {
      const bytes = new Uint8Array(parameterCount * 4);
      new DataView(bytes.buffer).setFloat32(bytes.byteLength - 4, 0.5, true);
      const common = {
        policyId: 'synthetic-fixture', modelVersion: 'synthetic-fixture-v1',
        architectureId: 'mlp-tanh-256x256-scalar-v1',
        weightsLayoutVersion: 'f32le-layer-w-row-major-then-b-v1',
        weightsSHA256: 'a'.repeat(64), inputDim, parameterCount,
        weightsPathOrUrl: { nodePath: 'fixtures/synthetic.bin' }, tieBreakId: 'first-candidate-v1',
      };
      const runtime = { site: 'node' as const, readWeights: async () => bytes, sha256: () => 'a'.repeat(64) };
      const policy = inputDim === 423
        ? await resolveStudentScorer({ ...common, schema: 'ohuo-student-scorer-v1', encoder: STUDENT_SCORER_ENCODER }, runtime)
        : await resolvePolicy(common.policyId, { ...runtime, registry: {
          schemaVersion: 'gd-model-index-v1', defaultPolicyRef: common.policyId,
          policies: [{ ...common, epsilon: 0, tierSpecId: 'none', candidateSpecId: 'cand-dedup-v2', encoder: {
            schema: inputDim === 385 ? 'v1' : 'v2', ctxFill: inputDim === 385 ? 'none' : 'rule-context',
            passEncoding: 'action64', encoderVersion: inputDim === 385 ? 'gd-lab-schema-v3' : 'gd-lab-schema-v4',
          } }],
        } });
      const gaussian = vi.spyOn(Math, 'log').mockImplementation(() => { throw Error('random initialization ran'); });
      try {
        const first = policy.createNetwork();
        const second = policy.createNetwork();
        expect(first.inputDim).toBe(inputDim);
        expect(first.paramCount).toBe(parameterCount);
        expect(first.forward(new Float32Array(inputDim), 1)[0]).toBe(0.5);
        first.b[2][0] = -7;
        bytes.fill(255);
        expect(second.forward(new Float32Array(inputDim), 1)[0]).toBe(0.5);
        expect(policy.createNetwork().forward(new Float32Array(inputDim), 1)[0]).toBe(0.5);
      } finally {
        gaussian.mockRestore();
      }
    },
  );
});
