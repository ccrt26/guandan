import {isResolvedPolicy,type ResolvedPolicy} from '../../../ai/src/policy/resolve';
import {RELEASES,type SeatAssignment,type SeatSnapshot,type ReleaseDescriptor,type ProfileRevisionRef} from '../../../ai/src/policy/seats';
import {freezeCopy} from '../../../ai/src/hybrid/protocol';
import type {PublicProfile} from './llm-profiles';
export interface RuntimeAISeat {assignment:Extract<SeatAssignment,{controller:'ai'}>;release:ReleaseDescriptor;policy:ResolvedPolicy;profile?:PublicProfile}
export interface ResolvedFourSeats {snapshot:SeatSnapshot;runtime:readonly (RuntimeAISeat|null)[]}
const resolvedSeats = new WeakSet<object>();
export function isResolvedFourSeats(value:unknown):value is ResolvedFourSeats { return !!value && typeof value === 'object' && resolvedSeats.has(value); }
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function freezeSeatAssignments(value:unknown):readonly SeatAssignment[] {
 if(!Array.isArray(value)||value.length!==4)throw Error('four_seats_required');
 const seats=value.map((s,i)=>{
  if(!plain(s))throw Error('invalid_seat');
  if(s.controller==='human'){if(i!==0||Object.keys(s).length!==1)throw Error('human_only_seat_zero');return {controller:'human' as const};}
  if(s.controller!=='ai'||typeof s.releaseRef!=='string'||!s.releaseRef||!['local','hybrid'].includes(String(s.mode))||Object.keys(s).some(k=>!['controller','releaseRef','mode','profileRevisionRef'].includes(k)))throw Error('invalid_ai_seat');
  if(s.mode==='local'&&s.profileRevisionRef!==undefined)throw Error('local_profile_forbidden');
  if(s.mode==='hybrid'){
   const p=s.profileRevisionRef;
   if(!plain(p)||Object.keys(p).sort().join(',')!=='profileId,revision,snapshotHash'||typeof p.profileId!=='string'||!p.profileId||!Number.isSafeInteger(p.revision)||Number(p.revision)<1||typeof p.snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(p.snapshotHash))throw Error('hybrid_profile_required');
  }
  return structuredClone(s) as unknown as SeatAssignment;
 });return freezeCopy(seats);
}
export function profileRef(profile:PublicProfile):ProfileRevisionRef {return {profileId:profile.profileId,revision:profile.revision,snapshotHash:profile.snapshotHash};}
export async function resolveFourSeats(value:unknown,load:(ref:string)=>Promise<ResolvedPolicy>,profiles:readonly PublicProfile[],releases=RELEASES):Promise<ResolvedFourSeats> {
 const assignments=freezeSeatAssignments(value),runtime:(RuntimeAISeat|null)[]=[],seats:SeatSnapshot['seats'][number][]=[];
 const loaded=new Map<string,ResolvedPolicy>();
 for(const assignment of assignments) {
  if(assignment.controller==='human'){runtime.push(null);seats.push(assignment);continue;}
  const release=releases.find(r=>r.releaseRef===assignment.releaseRef);
  if(!release||release.mode!==assignment.mode||release.localSelector!=='proposal'||release.remoteFallbackPolicyRef!==release.proposalPolicyRef||release.mode==='hybrid'&&release.tier!=='hard')throw Error('unsupported_release');
  let policy=loaded.get(release.proposalPolicyRef);
  if(!policy){policy=await load(release.proposalPolicyRef);loaded.set(release.proposalPolicyRef,policy);}
  if(!isResolvedPolicy(policy)||policy.identity.policyId!==release.proposalPolicyRef)throw Error('policy_identity_mismatch');
  if(release.tier!=='hard'&&policy.descriptor.tierSpecId!=='legacy-near-tie-v1')throw Error('unsupported_product_tier');
  const ref=assignment.profileRevisionRef;
  const profile=ref?profiles.find(p=>p.profileId===ref.profileId&&p.revision===ref.revision&&p.snapshotHash===ref.snapshotHash):undefined;
  if(assignment.mode==='hybrid'&&!profile)throw Error('profile_reference_unavailable');
  if(profile && Object.keys(profile).sort().join(',') !== ['profileId','revision','snapshotHash','nickname','protocol','baseUrl','requestedModel','supportedReasoningOptions','requestOptions'].sort().join(',')) throw Error('invalid_public_profile_snapshot');
  const frozenProfile=profile?freezeCopy(profile):undefined;
  runtime.push(Object.freeze({assignment,release:freezeCopy(release),policy,...(frozenProfile?{profile:frozenProfile}:{})}));
  seats.push({controller:'ai',releaseRef:release.releaseRef,mode:assignment.mode,release:freezeCopy(release),policyIdentity:policy.identity,...(ref?{profileRevisionRef:ref,profileSnapshot:frozenProfile}:{})});
 }
 const result = Object.freeze({snapshot:freezeCopy({schemaVersion:2 as const,seats}),runtime:Object.freeze(runtime)});
 resolvedSeats.add(result); return result;
}
export function savedAssignments(saved:SeatSnapshot):readonly SeatAssignment[] {
 if(!saved||saved.schemaVersion!==2)throw Error('unsupported_seat_save');
 return freezeSeatAssignments(saved.seats.map(s=>s.controller==='human'?s:{controller:s.controller,releaseRef:s.releaseRef,mode:s.mode,...(s.profileRevisionRef?{profileRevisionRef:s.profileRevisionRef}:{})}));
}
const canonical=(v:unknown):string=>JSON.stringify(v,(_,x)=>plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export function assertSavedSeats(saved:SeatSnapshot,resolved:SeatSnapshot):void {
 if(canonical(saved)!==canonical(resolved))throw Error('saved_seat_identity_conflict');
}
