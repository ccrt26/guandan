import {it,expect} from 'vitest';
import {freezeSeatAssignments,resolveFourSeats,assertSavedSeats} from '../src/game/seats';
import {RELEASES,defaultSeatAssignments} from '../../ai/src/policy/seats';
import {resolvePolicy} from '../../ai/src/policy/resolve';
import index from '../../../lab/model-index.json';
const descriptor={...index.policies[0],policyId:'fake',weightsSHA256:'0'.repeat(64)};
const fake=()=>resolvePolicy('fake',{registry:{...index,defaultPolicyRef:'fake',policies:[descriptor]},site:'browser',readWeights:async()=>new Uint8Array(descriptor.parameterCount*4),sha256:async()=>descriptor.weightsSHA256});
it('four seats reject nonzero human and local profile, hybrid missing profile',()=>{
 const s=defaultSeatAssignments('standard');expect(s).toHaveLength(4);
 expect(()=>freezeSeatAssignments([s[0],{controller:'human'},s[2],s[3]])).toThrow();
 expect(()=>freezeSeatAssignments([s[0],{...s[1],profileRevisionRef:{profileId:'x',revision:1,snapshotHash:'0'.repeat(64)}},s[2],s[3]])).toThrow();
 expect(()=>freezeSeatAssignments([s[0],{controller:'ai',mode:'hybrid',releaseRef:'ohuo-1030-h-v1'},s[2],s[3]])).toThrow();
});
it('missing referenced policy blocks instead of resolving default',async()=>{
 const seen:string[]=[];await expect(resolveFourSeats(defaultSeatAssignments('hard'),async ref=>{seen.push(ref);throw Error('missing');},[])).rejects.toThrow('missing');expect(seen).toEqual([RELEASES[0].proposalPolicyRef]);
});
it('registered same-shape replacement needs no consumer edits; saved identity cannot drift',async()=>{
 const p=await fake();const release={...RELEASES[0],releaseRef:'fake-release',proposalPolicyRef:'fake',remoteFallbackPolicyRef:'fake'};
 const seats=Array.from({length:4},()=>({controller:'ai' as const,releaseRef:'fake-release',mode:'local' as const}));
 const r=await resolveFourSeats(seats,async()=>p,[],[release]);expect(r.snapshot.seats.every(s=>s.controller==='ai'&&s.policyIdentity.policyId==='fake')).toBe(true);
 expect(Object.isFrozen(r.snapshot.seats[0])).toBe(true);assertSavedSeats(r.snapshot,r.snapshot);
 const drift=structuredClone(r.snapshot);if(drift.seats[0].controller==='ai')drift.seats[0].policyIdentity.weightsSHA256='f'.repeat(64);
 expect(()=>assertSavedSeats(drift,r.snapshot)).toThrow();
});
it('a private profile object cannot become a saved public snapshot',async()=>{
 const p=await fake();const release={...RELEASES[0],releaseRef:'private-test',proposalPolicyRef:'fake',remoteFallbackPolicyRef:'fake',mode:'hybrid' as const};
 const profile:any={profileId:'x',revision:1,snapshotHash:'0'.repeat(64),nickname:'x',protocol:'openai-chat-completions',baseUrl:'https://invalid.test',requestedModel:'x',supportedReasoningOptions:{},requestOptions:{max_tokens:100},secret:'fake-secret'};
 const seats=Array.from({length:4},()=>({controller:'ai',releaseRef:release.releaseRef,mode:'hybrid',profileRevisionRef:{profileId:'x',revision:1,snapshotHash:profile.snapshotHash}}));
 await expect(resolveFourSeats(seats,async()=>p,[profile],[release])).rejects.toThrow('public_profile');
});
