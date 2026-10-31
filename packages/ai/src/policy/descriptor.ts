/** Pure registration schema. No model/engine runtime imports: safe in Vite config. */
import type { EncoderOpts } from '../nn/neuralSeat';

export interface PolicyDescriptor {
  readonly policyId: string;
  readonly modelVersion: string;
  readonly architectureId: 'mlp-tanh-256x256-scalar-v1';
  readonly weightsLayoutVersion: 'f32le-layer-w-row-major-then-b-v1';
  readonly parameterCount: number;
  readonly weightsPathOrUrl: { readonly nodePath?: string; readonly assetUrl?: string };
  readonly weightsSHA256: string;
  readonly inputDim: number;
  readonly encoder: {
    readonly schema: 'v1' | 'v2';
    readonly ctxFill: 'none' | 'zero' | 'rule-context';
    readonly passEncoding: 'legacy-phys10' | 'action64';
    readonly encoderVersion: string;
  };
  readonly candidateSpecId: 'cand-dedup-v2' | 'cand-suit-v3';
  readonly epsilon: 0;
  /** Product-only compatibility layer; none keeps registered greedy behavior. */
  readonly tierSpecId: 'none' | 'legacy-near-tie-v1';
  readonly tieBreakId: 'first-candidate-v1';
}
export interface PolicyIndex {
  readonly schemaVersion: 'gd-model-index-v1';
  readonly defaultPolicyRef: string;
  readonly policies: readonly PolicyDescriptor[];
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`invalid ${label}`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw Error(`unsupported ${label} field`);
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw Error(`invalid ${label}`);
}
function relativeLocation(value: unknown, label: string): void {
  text(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(value) || value.split('/').some(p => p === '..' || p === '.' || p === '')) throw Error(`invalid registered ${label}`);
}
/** Fixed supported adapter: 385/399 → 256 → 256 → 1, W(out×in), then b. */
export function policyParameterCount(inputDim: number): number {
  if (inputDim !== 385 && inputDim !== 399) throw Error('unsupported input dimension');
  const sizes = [inputDim, 256, 256, 1];
  return sizes.slice(1).reduce((n, out, i) => n + sizes[i] * out + out, 0);
}
export function validatePolicyDescriptor(value: unknown): PolicyDescriptor {
  const d = object(value, 'policy descriptor');
  keys(d, ['policyId', 'modelVersion', 'architectureId', 'weightsLayoutVersion', 'parameterCount', 'weightsPathOrUrl', 'weightsSHA256', 'inputDim', 'encoder', 'candidateSpecId', 'epsilon', 'tierSpecId', 'tieBreakId'], 'descriptor');
  text(d.policyId, 'policyId'); text(d.modelVersion, 'modelVersion');
  if (d.architectureId !== 'mlp-tanh-256x256-scalar-v1') throw Error('unsupported architecture');
  if (d.weightsLayoutVersion !== 'f32le-layer-w-row-major-then-b-v1') throw Error('unsupported weights layout');
  const e = object(d.encoder, 'encoder');
  keys(e, ['schema', 'ctxFill', 'passEncoding', 'encoderVersion'], 'encoder');
  if (d.inputDim === 385 ? e.schema !== 'v1' || e.ctxFill !== 'none'
    : d.inputDim === 399 ? e.schema !== 'v2' || !['zero', 'rule-context'].includes(String(e.ctxFill)) : true) throw Error('input dimension / encoder mismatch');
  if (!['legacy-phys10', 'action64'].includes(String(e.passEncoding))) throw Error('unsupported pass encoder');
  const version = e.passEncoding === 'action64' ? (e.schema === 'v1' ? 'gd-lab-schema-v3' : 'gd-lab-schema-v4')
    : (e.schema === 'v1' ? 'gd-lab-schema-v1' : 'gd-lab-schema-v2');
  if (e.encoderVersion !== version) throw Error('encoder version / semantics mismatch');
  if (d.parameterCount !== policyParameterCount(d.inputDim as number)) throw Error('parameter count / architecture mismatch');
  if (typeof d.weightsSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(d.weightsSHA256)) throw Error('invalid weights SHA256');
  if (!['cand-dedup-v2', 'cand-suit-v3'].includes(String(d.candidateSpecId))) throw Error('unsupported candidate specification');
  if (!['none', 'legacy-near-tie-v1'].includes(String(d.tierSpecId))) throw Error('unsupported product tier specification');
  if (d.epsilon !== 0) throw Error('unsupported evaluation epsilon (must be 0)');
  if (d.tieBreakId !== 'first-candidate-v1') throw Error('unsupported tie-break');
  const location = object(d.weightsPathOrUrl, 'weights location');
  keys(location, ['nodePath', 'assetUrl'], 'weights location');
  if (location.nodePath !== undefined) relativeLocation(location.nodePath, 'nodePath');
  if (location.assetUrl !== undefined) relativeLocation(location.assetUrl, 'assetUrl');
  // An empty public location is valid metadata, but cannot be loaded in browser.
  return Object.freeze({ ...d, encoder: Object.freeze({ ...e }), weightsPathOrUrl: Object.freeze({ ...location }) }) as unknown as PolicyDescriptor;
}
export function validatePolicyIndex(value: unknown): PolicyIndex {
  const index = object(value, 'model index');
  keys(index, ['schemaVersion', 'defaultPolicyRef', 'policies'], 'model index');
  if (index.schemaVersion !== 'gd-model-index-v1' || !Array.isArray(index.policies)) throw Error('unsupported model index');
  text(index.defaultPolicyRef, 'defaultPolicyRef');
  const policies = index.policies.map(validatePolicyDescriptor);
  const ids = policies.map(d => d.policyId);
  if (new Set(ids).size !== ids.length) throw Error('duplicate policyId');
  if (!ids.includes(index.defaultPolicyRef)) throw Error('unknown default policy');
  return Object.freeze({ schemaVersion: 'gd-model-index-v1', defaultPolicyRef: index.defaultPolicyRef, policies: Object.freeze(policies) });
}
export function policyEncoder(d: PolicyDescriptor): Readonly<EncoderOpts> {
  return Object.freeze({ schema: d.encoder.schema, ...(d.encoder.ctxFill !== 'none' ? { ctxFill: d.encoder.ctxFill } : {}),
    passEncoding: d.encoder.passEncoding, ...(d.candidateSpecId === 'cand-dedup-v2' ? { candidateCompat: 'v2' as const } : {}) });
}
