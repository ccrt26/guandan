/** Pure, environment-independent policy loading. Registration supplies identity;
 * runtime adapters supply only registered bytes and SHA-256, never fallback. */
import { MLP } from '../nn/mlp';
import { NeuralDecider, type EncoderOpts } from '../nn/neuralSeat';
import { validatePolicyIndex, validateStudentScorerDescriptor, policyEncoder, type PolicyDescriptor } from './descriptor';
export * from './descriptor';

export interface PolicyRuntime {
  readonly registry: unknown;
  readonly site: 'node' | 'browser';
  readWeights(location: string): Promise<Uint8Array>;
  sha256(bytes: Uint8Array): string | Promise<string>;
}
export interface ResolvedPolicy {
  readonly descriptor: PolicyDescriptor;
  readonly encoder: Readonly<EncoderOpts>;
  readonly identity: Readonly<{
    policyId: string; modelVersion: string; weightsSHA256: string; inputDim: number;
    encoderVersion: string; candidateVersion: string;
    passEncoding: 'legacy-phys10' | 'action64'; candidateCompat: 'v2' | undefined;
    architectureId: string; weightsLayoutVersion: string; epsilon: number; tieBreakId: string; tierSpecId: string;
  }>;
  /** Isolated copy for legacy ranking consumers; mutating it cannot change policy. */
  createNetwork(): MLP;
  createDecider(seat: number): NeuralDecider;
}
const resolvedInstances = new WeakSet<object>();
export function isResolvedPolicy(value: unknown): value is ResolvedPolicy {
  return typeof value === 'object' && value !== null && resolvedInstances.has(value);
}
export async function resolvePolicy(ref: string, runtime: PolicyRuntime): Promise<ResolvedPolicy> {
  const index = validatePolicyIndex(runtime.registry);
  const descriptor = index.policies.find(p => p.policyId === ref);
  if (!descriptor) throw Error(`unknown policy: ${ref}`);
  if (runtime.site !== 'node' && runtime.site !== 'browser') throw Error('unsupported policy runtime');
  const location = runtime.site === 'node' ? descriptor.weightsPathOrUrl.nodePath : descriptor.weightsPathOrUrl.assetUrl;
  if (!location) throw Error(`policy ${ref} has no registered ${runtime.site} weights location`);
  // Copy immediately: neither asynchronous digest nor future registration edits
  // can race the bytes that are verified and retained by this instance.
  const bytes = new Uint8Array(await runtime.readWeights(location));
  if (bytes.byteLength !== descriptor.parameterCount * 4) throw Error(`weights byte length ${bytes.byteLength} != ${descriptor.parameterCount * 4}`);
  if (await runtime.sha256(bytes) !== descriptor.weightsSHA256) throw Error(`weights SHA256 mismatch: ${ref}`);
  const weights = new Float32Array(descriptor.parameterCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < weights.length; i++) {
    const v = view.getFloat32(i * 4, true);
    if (!Number.isFinite(v)) throw Error(`non-finite weight at ${i}`);
    weights[i] = v;
  }
  const encoder = policyEncoder(descriptor);
  const identity = Object.freeze({ policyId: descriptor.policyId, modelVersion: descriptor.modelVersion,
    weightsSHA256: descriptor.weightsSHA256, inputDim: descriptor.inputDim,
    encoderVersion: descriptor.encoder.encoderVersion, candidateVersion: descriptor.candidateSpecId,
    passEncoding: descriptor.encoder.passEncoding, candidateCompat: encoder.candidateCompat,
    architectureId: descriptor.architectureId, weightsLayoutVersion: descriptor.weightsLayoutVersion,
    epsilon: descriptor.epsilon, tieBreakId: descriptor.tieBreakId, tierSpecId: descriptor.tierSpecId });
  const createNetwork = (): MLP => MLP.fromWeights(weights, descriptor.inputDim);
  const result: ResolvedPolicy = Object.freeze({ descriptor, identity, encoder, createNetwork,
    createDecider: (seat: number) => new NeuralDecider(seat, createNetwork(), descriptor.epsilon, () => 0, encoder) });
  resolvedInstances.add(result);
  return result;
}

/** Historical save mapping is explicit and independent of the current default. */
export const LEGACY_O_MODEL_VERSION = 'clean2-ck7051-20261027';
export const LEGACY_O_POLICY_REF = 'frozenChampion-clean2-ck7051-encv1-candv2';
export function resolveLegacySavedPolicy(aiPolicy: string | undefined): string | null {
  if (aiPolicy === undefined || /^heuristic:L[012]$/.test(aiPolicy)) return null;
  if (/^neural-tier:(easy|standard|hard)$/.test(aiPolicy)) return LEGACY_O_POLICY_REF;
  throw Error(`unsupported saved policy: ${aiPolicy}`);
}

export type SavedLocalPolicy = { policyRef: string; weightsSHA256?: string; tier: 'easy' | 'standard' | 'hard' } | null;
/** Minimal single-local-policy bridge until B05's four-seat save format exists. */
export function resolveSavedLocalPolicy(aiPolicy: string | undefined): SavedLocalPolicy {
  if (aiPolicy?.startsWith('neural-policy:')) {
    const match = /^neural-policy:v1:([^:]+):([a-f0-9]{64}):(easy|standard|hard)$/.exec(aiPolicy);
    if (!match) throw Error('unsupported saved policy identity');
    let policyRef: string;
    try { policyRef = decodeURIComponent(match[1]); } catch { throw Error('unsupported saved policy reference'); }
    if (!policyRef || policyRef.trim() !== policyRef) throw Error('invalid saved policy reference');
    return { policyRef, weightsSHA256: match[2], tier: match[3] as 'easy' | 'standard' | 'hard' };
  }
  const policyRef = resolveLegacySavedPolicy(aiPolicy);
  return policyRef ? { policyRef, tier: aiPolicy!.split(':')[1] as 'easy' | 'standard' | 'hard' } : null;
}
export function serializeSavedLocalPolicy(policy: ResolvedPolicy, tier: 'easy' | 'standard' | 'hard'): string {
  if (!isResolvedPolicy(policy) || !['easy', 'standard', 'hard'].includes(tier)) throw Error('invalid saved policy');
  return `neural-policy:v1:${encodeURIComponent(policy.identity.policyId)}:${policy.identity.weightsSHA256}:${tier}`;
}

/** Resolve recorded local identity, never today's default. Old heuristic-only
 * records retain an explicit fixed O reference analysis, not a historical claim. */
export function resolveRecordedPolicy(aiPolicies: readonly string[] | undefined): NonNullable<SavedLocalPolicy> & { referenceOnly: boolean } {
  if (aiPolicies !== undefined && (!Array.isArray(aiPolicies) || aiPolicies.some(p => typeof p !== 'string'))) throw Error('unsupported recorded policies');
  let selected: NonNullable<SavedLocalPolicy> | null = null;
  for (const value of aiPolicies ?? []) {
    if (/^(human|heuristic(?::L[012])?(?:\(fallback\))?|autopilot:L[012])$/.test(value)) continue;
    let policy: NonNullable<SavedLocalPolicy>;
    if (value.startsWith('neural-policy:')) policy = resolveSavedLocalPolicy(value)!;
    else if (value === `neural:${LEGACY_O_MODEL_VERSION}` || ['easy', 'standard', 'hard'].some(tier => value === `neural-tier:${tier}:${LEGACY_O_MODEL_VERSION}`)) {
      policy = { policyRef: LEGACY_O_POLICY_REF, tier: 'hard' };
    } else throw Error(`unsupported recorded policy: ${value}`);
    if (selected && (selected.policyRef !== policy.policyRef || selected.weightsSHA256 && policy.weightsSHA256 && selected.weightsSHA256 !== policy.weightsSHA256)) throw Error('multiple recorded policies require explicit analysis selection');
    const previous = selected as NonNullable<SavedLocalPolicy> | null;
    selected = { ...policy, weightsSHA256: policy.weightsSHA256 ?? previous?.weightsSHA256, tier: 'hard' };
    if (!selected.weightsSHA256) delete selected.weightsSHA256;
  }
  return selected ? { ...selected, referenceOnly: false } : { policyRef: LEGACY_O_POLICY_REF, tier: 'hard', referenceOnly: true };
}

/** Explicit scorer-only load: no registry default, proposal enumeration, tier,
 * product release or createDecider. New/old dimensional identities never coerce. */
export interface ResolvedStudentScorer {
  readonly descriptor: import('./descriptor').StudentScorerDescriptor;
  createNetwork(): MLP;
}
export async function resolveStudentScorer(value: unknown, runtime: Omit<PolicyRuntime, 'registry'>): Promise<ResolvedStudentScorer> {
  const descriptor = validateStudentScorerDescriptor(value);
  if (runtime.site !== 'node' && runtime.site !== 'browser') throw Error('unsupported student runtime');
  const location = runtime.site === 'node' ? descriptor.weightsPathOrUrl.nodePath : descriptor.weightsPathOrUrl.assetUrl;
  if (!location) throw Error(`student has no registered ${runtime.site} weights location`);
  const bytes = new Uint8Array(await runtime.readWeights(location));
  if (bytes.byteLength !== descriptor.parameterCount * 4) throw Error('student weights byte length mismatch');
  if (await runtime.sha256(bytes) !== descriptor.weightsSHA256) throw Error('student weights SHA256 mismatch');
  const flat = new Float32Array(descriptor.parameterCount), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < flat.length; i++) {
    flat[i] = view.getFloat32(i * 4, true);
    if (!Number.isFinite(flat[i])) throw Error(`non-finite student weight at ${i}`);
  }
  return Object.freeze({ descriptor, createNetwork: () => MLP.fromWeights(flat, descriptor.inputDim) });
}
