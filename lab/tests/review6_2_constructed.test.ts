import{it,expect}from'vitest';
import{buildConstructedRoot,replayConstructedProof,proposeFromPublic}from'../review6_2/constructed';
it('constructs and replays a native deal without editing hands or counts',()=>{
 const r=buildConstructedRoot('takeover',2026102901,0,10000,new Set());
 expect(r.root).not.toBeNull();expect(r.root.observedBefore.counts).toEqual([2,1,1,1]);
 expect(replayConstructedProof(r.proof).observationSHA256).toBe(r.root.observedBefore.observationSHA256);
 const proposal=proposeFromPublic(r.root.observedBefore,r.root.allCandidates);expect(proposal.preference).toBe('prefer');
 const changed=structuredClone(r.proof);changed.moves[0].actor=(changed.moves[0].actor+1)%4;
 expect(()=>replayConstructedProof(changed)).toThrow(/actor/);
});
