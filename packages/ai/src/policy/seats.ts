/** One public release catalog; new supported weights need registration, not seat branches.
 * A release fixes behavior; private assets remain solely in the B01 model index. */
import catalog from './releases.json';
import type { NeuralTier } from '../nn/tiered';
import type { ResolvedPolicy } from './resolve';
import { CANDIDATE_SPEC, OBSERVATION_SCHEMA, freezeCopy } from '../hybrid/protocol';
export interface ProfileRevisionRef { profileId:string; revision:number; snapshotHash:string }
export type SeatAssignment = {controller:'human'} | {controller:'ai';releaseRef:string;mode:'local'|'hybrid';profileRevisionRef?:ProfileRevisionRef};
export interface ReleaseDescriptor {
 releaseRef:string;label:string;proposalPolicyRef:string;mode:'local'|'hybrid';tier:NeuralTier;
 status:'adopted'|'candidate'|'development';parentRelease:string|null;
 remoteFallbackPolicyRef:string;localSelector:'proposal';candidateSpecRef:string;observationSchema:string;promptRef:string;
}
export const RELEASES:readonly ReleaseDescriptor[]=freezeCopy(catalog.releases.map(r=>({...r,
 remoteFallbackPolicyRef:r.proposalPolicyRef,localSelector:'proposal',candidateSpecRef:CANDIDATE_SPEC,
 observationSchema:OBSERVATION_SCHEMA,promptRef:'ohuo-engine-rules-v1/choose-expand-v1'})) as ReleaseDescriptor[]);
export function defaultSeatAssignments(tier:NeuralTier):readonly SeatAssignment[] {
 return freezeCopy(catalog.legacyProductLayouts[tier].map(ref=>ref==='human'?{controller:'human' as const}:{controller:'ai' as const,releaseRef:ref,mode:'local' as const}));
}
export interface FrozenAISeat {
 controller:'ai';releaseRef:string;mode:'local'|'hybrid';release:ReleaseDescriptor;
 policyIdentity:ResolvedPolicy['identity'];profileRevisionRef?:ProfileRevisionRef;
 /** Full validated public snapshot, never a credential or browser default. */
 profileSnapshot?:unknown;
}
export interface SeatSnapshot {schemaVersion:2;seats:readonly ({controller:'human'}|FrozenAISeat)[]}
