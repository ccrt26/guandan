import modelIndex from 'virtual:gd-model-index';
import type { ResolvedPolicy } from '@gd/ai';
import { resolveBrowserPolicy, resolveSavedBrowserPolicy, resolveRecordedBrowserPolicy } from '../../../ai/src/policy/browser';

/** Every call resolves a fresh immutable instance. Existing games retain theirs. */
export function loadWebPolicy(ref = modelIndex.defaultPolicyRef): Promise<ResolvedPolicy> {
  return resolveBrowserPolicy(ref, modelIndex);
}
export async function loadSavedWebPolicy(aiPolicy: string | undefined): Promise<{ policy: ResolvedPolicy | undefined; tier: 'easy' | 'standard' | 'hard' }> {
  return resolveSavedBrowserPolicy(aiPolicy, modelIndex);
}

export function loadRecordedWebPolicy(aiPolicies: readonly string[] | undefined): Promise<{ policy: ResolvedPolicy; referenceOnly: boolean }> {
  return resolveRecordedBrowserPolicy(aiPolicies, modelIndex);
}

import { RELEASES, type SeatAssignment, type SeatSnapshot } from '../../../ai/src/policy/seats';
import { resolveFourSeats, savedAssignments, assertSavedSeats } from './seats';
import { createProfileClient } from './llm-profiles';
/** Existing public descriptors; product intent validates them without duplicating registry data. */
export const webPolicyDescriptors = modelIndex.policies;
export const webReleaseChoices = RELEASES.map(release => ({ release,
  available: !!modelIndex.policies.find(policy => policy.policyId === release.proposalPolicyRef)?.weightsPathOrUrl.assetUrl,
}));
export async function loadWebSeats(assignments: readonly SeatAssignment[], saved?: SeatSnapshot) {
  const profiles = assignments.some(s => s.controller === 'ai' && s.mode === 'hybrid')
    ? await createProfileClient({storage: localStorage, fetchImpl: fetch}).refresh() : [];
  const seats = await resolveFourSeats(assignments, loadWebPolicy, profiles);
  if (saved) assertSavedSeats(saved, seats.snapshot);
  return seats;
}
export function loadSavedWebSeats(saved: SeatSnapshot) { return loadWebSeats(savedAssignments(saved), saved); }
