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
/** Reuse the original protocol projection for a complete public data snapshot. */
export function projectReleaseCatalog(value:unknown):readonly ReleaseDescriptor[] {
 const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>plain(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
 const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v===v.trim();
 if(!exact(value,['schemaVersion','releases','legacyProductLayouts'])||value.schemaVersion!=='ohuo-release-index-v1'||!Array.isArray(value.releases)||!value.releases.length)throw Error('invalid_release_catalog');
 const refs=new Set<string>();
 const releases=value.releases.map(raw=>{
  if(!exact(raw,['releaseRef','label','proposalPolicyRef','mode','tier','status','parentRelease'])||!text(raw.releaseRef)||!text(raw.label)||!text(raw.proposalPolicyRef)
   ||!['local','hybrid'].includes(raw.mode as string)||!['easy','standard','hard'].includes(raw.tier as string)||!['adopted','candidate','development'].includes(raw.status as string)
   ||raw.parentRelease!==null&&!text(raw.parentRelease)||refs.has(raw.releaseRef))throw Error('invalid_release_descriptor');
  refs.add(raw.releaseRef);
  return {...raw,remoteFallbackPolicyRef:raw.proposalPolicyRef,localSelector:'proposal',candidateSpecRef:CANDIDATE_SPEC,
   observationSchema:OBSERVATION_SCHEMA,promptRef:'ohuo-engine-rules-v1/choose-expand-v1'} as unknown as ReleaseDescriptor;
 });
 if(!exact(value.legacyProductLayouts,['easy','standard','hard']))throw Error('invalid_legacy_product_layouts');
 for(const layout of Object.values(value.legacyProductLayouts))if(!Array.isArray(layout)||layout.length!==4||layout[0]!=='human'||layout.slice(1).some(ref=>typeof ref!=='string'||!refs.has(ref)))throw Error('invalid_legacy_product_layouts');
 for(const release of releases)if(release.parentRelease!==null&&!refs.has(release.parentRelease))throw Error('release_parent_unavailable');
 return freezeCopy(releases);
}
export const RELEASES:readonly ReleaseDescriptor[]=projectReleaseCatalog(catalog);
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
