import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir}from'node:os';import{join}from'node:path';
import{createMatch,startGame,DEFAULT_RULES}from'@gd/engine';
import{toVisibleRoot}from'../review6/visible-world';import{rootCandidates}from'../review6/teacher-roots';
import{atomicJson,fileHash}from'../review6_2/protocol';
import{normalizeTeachingCards,admitStrongProposals}from'../review6_2/teacher';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'r62-teacher-')),state=startGame(createMatch({...DEFAULT_RULES},4129));
 const root={rootId:'test-root',sourceFamilyId:'test-family',observedBefore:toVisibleRoot(state,[])};
 const path=join(dir,'root.json');atomicJson(path,root);const candidates=rootCandidates(state);
 const card:any={labelId:'suggestion-one',rootRef:path,rootSHA256:fileHash(path),sourceFamilyId:root.sourceFamilyId,split:'train',sourceKind:'llm',evidenceTier:'weak',preference:'prefer',preferredActionId:candidates[0].actionId,otherActionId:candidates[1].actionId,rationale:'an explicitly uncertain direct proposal'};
 return{dir,card,index:{families:{'test-family':{split:'train'}}}};
}
it('accepts a legal direct weak preference without requiring a rollout',()=>{
 const f=fixture();try{const r=normalizeTeachingCards([f.card],f.index);expect(r.labels).toHaveLength(1);expect(r.labels[0].weight).toBe(.25);expect(r.labels[0].sourceKind).toBe('llm');}finally{rmSync(f.dir,{recursive:true});}
});
it('merges duplicate suggestions instead of doubling root weight',()=>{
 const f=fixture();try{const r=normalizeTeachingCards([f.card,{...f.card,labelId:'another-proposer'}],f.index);expect(r.labels).toHaveLength(1);expect(r.labels[0].plus).toHaveLength(1);}finally{rmSync(f.dir,{recursive:true});}
});
it('quarantines contradictory advice and abstention without inventing a preference',()=>{
 const f=fixture();try{const reverse={...f.card,labelId:'reverse',preferredActionId:f.card.otherActionId,otherActionId:f.card.preferredActionId};const r=normalizeTeachingCards([f.card,reverse],f.index);expect(r.labels).toHaveLength(0);expect(r.rejected.some((v:any)=>v.reason==='conflict')).toBe(true);expect(normalizeTeachingCards([{...f.card,preference:'abstain'}],f.index).labels).toHaveLength(0);}finally{rmSync(f.dir,{recursive:true});}
});
it('checks the source index rather than trusting a train label',()=>{
 const f=fixture();try{const r=normalizeTeachingCards([f.card],{families:{'test-family':{split:'dev'}}});expect(r.labels).toHaveLength(0);expect(r.rejected[0].reason).toMatch(/split/);}finally{rmSync(f.dir,{recursive:true});}
});
it('quarantines a whole root when an explicit conflict record accompanies advice',()=>{
 const f=fixture();try{const r=normalizeTeachingCards([f.card,{...f.card,labelId:'reported-conflict',preference:'conflict'}],f.index);expect(r.labels).toHaveLength(0);expect(r.rejected.some((v:any)=>v.reason==='conflict')).toBe(true);}finally{rmSync(f.dir,{recursive:true});}
});
it('does not promote a supported boolean into a strong strategy certificate',()=>{
 const f=fixture();try{
  const stats=join(f.dir,'invented-stats.json');atomicJson(stats,{supported:true});
  const r=normalizeTeachingCards([{...f.card,evidenceTier:'strong',statisticsRef:stats,statisticsSHA256:fileHash(stats)}],f.index);
  expect(r.labels).toHaveLength(0);expect(r.rejected[0].reason).toMatch(/strong|evidence|contract/);
 }finally{rmSync(f.dir,{recursive:true});}
});
it('keeps whole-root conflict quarantine at the actual strong-producer entry',()=>{
 const f=fixture();try{
  const r=admitStrongProposals([f.card,{...f.card,labelId:'conflict',preference:'conflict'}],f.index);
  expect(r.cards).toHaveLength(0);expect(r.rejected.some(r=>r.reason==='conflict')).toBe(true);
 }finally{rmSync(f.dir,{recursive:true});}
});
it('rejects duplicate roots before the one-pair producer can reuse another pair cache',()=>{
 const f=fixture();try{
  const r=admitStrongProposals([f.card,{...f.card,labelId:'second-pair'}],f.index);
  expect(r.cards).toHaveLength(0);expect(r.rejected.some(r=>/duplicate root/.test(r.reason))).toBe(true);
 }finally{rmSync(f.dir,{recursive:true});}
});
