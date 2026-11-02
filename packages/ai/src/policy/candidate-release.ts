/** Research-only candidate program envelope. Never registers a product release. */
import {freezeCopy} from '../hybrid/protocol';
import {FIRST_TARGET_CANDIDATE_SPEC,LEGACY_CANDIDATE_SPEC,resolveCandidatePolicy,type CandidatePolicySpec} from '../candidate-spec';
import type {ReleaseDescriptor} from './seats';
import type {ResolvedPolicy} from './resolve';
export const CANDIDATE_RESEARCH_RELEASE_SCHEMA='ohuo-candidate-research-release-ref-v1';
export const CANDIDATE_CHOOSE_PROMPT='ohuo-engine-rules-v1/choose-only-v2';
const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
const text=(v:any)=>typeof v==='string'&&v.length>0&&v===v.trim();
function same(a:any,b:any):boolean {
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
}
export interface CandidateRelease {release:ReleaseDescriptor;policyIdentity:ResolvedPolicy['identity'];candidatePolicy?:CandidatePolicySpec}
/** `lookup` must use the caller's already hash-verified immutable references. */
export function resolveCandidateReleaseRef(value:any,lookup:(ref:string)=>unknown,catalog:readonly ReleaseDescriptor[]):CandidateRelease {
 if(value?.schema==='ohuo-release-ref-v1'){
  if(!exact(value,['schema','release','policyIdentity'])||!catalog.some(r=>same(r,value.release)))throw Error('legacy release identity mismatch');
  return freezeCopy({release:value.release,policyIdentity:value.policyIdentity});
 }
 if(value?.schema!==CANDIDATE_RESEARCH_RELEASE_SCHEMA||!exact(value,['schema','parentRef','release','policyIdentity','candidatePolicy'])||typeof value.parentRef!=='string'||!/^.+@sha256:[a-f0-9]{64}$/.test(value.parentRef)||/(^|[/:\-])latest($|[/:@\-])/i.test(value.parentRef))throw Error('candidate research release envelope required');
 const rawParent:any=lookup(value.parentRef);
 if(rawParent?.schema!=='ohuo-release-ref-v1')throw Error('candidate research parent must be original legacy release');
 const parent=resolveCandidateReleaseRef(rawParent,lookup,catalog),policy=resolveCandidatePolicy(value.candidatePolicy),r=value.release;
 if(policy.candidateSpec!==FIRST_TARGET_CANDIDATE_SPEC||parent.release.candidateSpecRef!==LEGACY_CANDIDATE_SPEC||parent.release.tier!=='hard'||parent.release.localSelector!=='proposal'||parent.policyIdentity?.inputDim!==399||!same(value.policyIdentity,parent.policyIdentity))throw Error('candidate research parent/policy identity mismatch');
 if(!r||!text(r.releaseRef)||!text(r.label)||catalog.some(x=>x.releaseRef===r.releaseRef))throw Error('new research release identity required');
 const expected={...parent.release,releaseRef:r.releaseRef,label:r.label,status:'development',parentRelease:parent.release.releaseRef,candidateSpecRef:policy.candidateSpec,promptRef:CANDIDATE_CHOOSE_PROMPT};
 if(!same(r,expected))throw Error('candidate research release changes outside candidate program');
 return freezeCopy({release:r,policyIdentity:value.policyIdentity,candidatePolicy:policy});
}
