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

/** Independent scorer contract: it is not a proposal policy or an index entry.
 * Keep this module runtime-free (also imported by configuration tooling). */
export const STUDENT_SCORER_ENCODER = Object.freeze({
  schema: 'student-input399plus24-v1' as const,
  encoderVersion: 'student-input399plus24-v1' as const,
  inputLayout: 'legacy399_then_publicMemory24' as const,
  baseEncoderRef: Object.freeze({ schema: 'v2' as const, ctxFill: 'rule-context' as const,
    passEncoding: 'action64' as const, encoderVersion: 'gd-lab-schema-v4' as const }),
  segments: Object.freeze([
    Object.freeze({ role: 'legacy-state', offset: 0, length: 331 }),
    Object.freeze({ role: 'legacy-action', offset: 331, length: 68 }),
    Object.freeze({ role: 'public-memory', offset: 399, length: 24 }),
  ]),
  memorySchemaId: 'public-high-card-memory-v1' as const,
  relativeSeatOrder: Object.freeze(['self', 'partner', 'upper', 'lower']),
  slotOrder: Object.freeze(['J', 'Q', 'K', 'LEVEL_OTHER', 'SJ', 'BJ']),
  normalizationDivisors: Object.freeze([8, 8, 8, 8, 2, 2]),
});
export interface StudentScorerDescriptor {
  readonly schema: 'ohuo-student-scorer-v1';
  readonly policyId: string;
  readonly modelVersion: string;
  readonly architectureId: 'mlp-tanh-256x256-scalar-v1';
  readonly weightsLayoutVersion: 'f32le-layer-w-row-major-then-b-v1';
  readonly parameterCount: 174593;
  readonly inputDim: 423;
  readonly weightsPathOrUrl: { readonly nodePath?: string; readonly assetUrl?: string };
  readonly weightsSHA256: string;
  readonly encoder: typeof STUDENT_SCORER_ENCODER;
  readonly tieBreakId: 'first-candidate-v1';
}
function exactContract(value: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return value === expected;
  if (!value || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(expected)) return false;
  const actual = value as Record<string, unknown>, want = expected as Record<string, unknown>;
  const names = Object.keys(want);
  return Object.keys(actual).length === names.length && names.every(k => Object.hasOwn(actual, k) && exactContract(actual[k], want[k]));
}
export function validateStudentScorerDescriptor(value: unknown): StudentScorerDescriptor {
  const d = object(value, 'student scorer descriptor');
  keys(d, ['schema','policyId','modelVersion','architectureId','weightsLayoutVersion','parameterCount','inputDim','weightsPathOrUrl','weightsSHA256','encoder','tieBreakId'], 'student descriptor');
  if (d.schema !== 'ohuo-student-scorer-v1' || d.inputDim !== 423 || d.parameterCount !== 174593) throw Error('student schema/dimension/parameter mismatch');
  text(d.policyId, 'student policyId'); text(d.modelVersion, 'student modelVersion');
  if (d.architectureId !== 'mlp-tanh-256x256-scalar-v1' || d.weightsLayoutVersion !== 'f32le-layer-w-row-major-then-b-v1' || d.tieBreakId !== 'first-candidate-v1') throw Error('unsupported student architecture/layout/tie-break');
  if (!exactContract(d.encoder, STUDENT_SCORER_ENCODER)) throw Error('student encoder contract mismatch');
  if (typeof d.weightsSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(d.weightsSHA256)) throw Error('invalid student weights SHA256');
  const location = object(d.weightsPathOrUrl, 'student weights location');
  keys(location, ['nodePath','assetUrl'], 'student weights location');
  if (location.nodePath !== undefined) relativeLocation(location.nodePath, 'nodePath');
  if (location.assetUrl !== undefined) relativeLocation(location.assetUrl, 'assetUrl');
  return Object.freeze({ ...d, encoder: STUDENT_SCORER_ENCODER, weightsPathOrUrl: Object.freeze({ ...location }) }) as unknown as StudentScorerDescriptor;
}
