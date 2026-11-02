/** Immutable proposal contracts. Only an explicit complete pair selects B-prime;
 * weights, display names and policyId strings never select enumeration behavior. */
import type { EnumerationMode } from '@gd/engine';
export const LEGACY_CANDIDATE_SPEC = 'ohuo-frozen-c8-expand4-v1' as const;
export const FIRST_TARGET_CANDIDATE_SPEC = 'first-target-offer12-v1' as const;
export interface EnumSpec { readonly id: 'cand-suit-v3' | 'full-house-attachment-ranks-v1'; readonly enumerationMode: EnumerationMode }
export interface CandidatePolicySpec {
  readonly candidateSpec: typeof LEGACY_CANDIDATE_SPEC | typeof FIRST_TARGET_CANDIDATE_SPEC;
  readonly enumSpec: EnumSpec;
}
export const LEGACY_CANDIDATE_POLICY: CandidatePolicySpec = Object.freeze({candidateSpec:LEGACY_CANDIDATE_SPEC,
  enumSpec:Object.freeze({id:'cand-suit-v3',enumerationMode:'legacy_best_pair'})});
export const FIRST_TARGET_CANDIDATE_POLICY: CandidatePolicySpec = Object.freeze({candidateSpec:FIRST_TARGET_CANDIDATE_SPEC,
  enumSpec:Object.freeze({id:'full-house-attachment-ranks-v1',enumerationMode:'all_supported_attachment_ranks'})});
export function resolveCandidatePolicy(input?: CandidatePolicySpec): CandidatePolicySpec {
  if (input === undefined) return LEGACY_CANDIDATE_POLICY;
  for (const spec of [LEGACY_CANDIDATE_POLICY,FIRST_TARGET_CANDIDATE_POLICY]) {
    if (input?.candidateSpec === spec.candidateSpec && input?.enumSpec?.id === spec.enumSpec.id &&
      input.enumSpec.enumerationMode === spec.enumSpec.enumerationMode && Object.keys(input).length === 2 && Object.keys(input.enumSpec).length === 2) return spec;
  }
  throw new Error('unknown or inconsistent complete candidate/enum specification');
}
/** Historical bundles omit enumSpec; never infer the new enum from a new name. */
export function candidatePolicyForBundle(bundle: {candidateSpec: CandidatePolicySpec['candidateSpec']; enumSpec?: EnumSpec}): CandidatePolicySpec {
  return resolveCandidatePolicy({candidateSpec:bundle.candidateSpec,
    enumSpec:bundle.enumSpec ?? (bundle.candidateSpec === LEGACY_CANDIDATE_SPEC ? LEGACY_CANDIDATE_POLICY.enumSpec : undefined!)});
}
