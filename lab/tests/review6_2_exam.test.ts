import{it,expect}from'vitest';
import{answerPartition,answerChoice,validateFormalShape,severityChoice}from'../review6_2/exam';
import{mkdtempSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{fileHash}from'../review6_2/protocol';
it('keeps a third legal action unverified instead of inventing an error',()=>{
 const a=answerPartition(['a','b','c'],[{preferredActionId:'a',otherActionId:'b'}]);
 expect(answerChoice(a,'a')).toBe('supported');expect(answerChoice(a,'b')).toBe('contradicted');expect(answerChoice(a,'c')).toBe('unverified');expect(answerChoice(a,'foreign')).toBe('illegal');
});
it('rejects24 nominal severe families with no questions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-empty-severe-'));try{
  const families=Array.from({length:24},(_,i)=>({sourceFamilyId:'f'+i,rootKeys:[],severityReason:'test fixture'})),path=join(dir,'queue.json');writeFileSync(path,JSON.stringify({candidateScoresUsed:false,familyIds:families.map(f=>f.sourceFamilyId)}));
  const r=validateFormalShape({kind:'severe24-v2',families,roots:[],sourceQueueRef:path,sourceQueueSHA256:fileHash(path)});expect(r.ready).toBe(false);expect(r.reasons.some(s=>/root|question/.test(s))).toBe(true);
 }finally{rmSync(dir,{recursive:true});}
});
it('rejects a claimed resource quota without actual covered roots',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-fake-coverage-'));try{
  const categories=['cooperation_open','cooperation_urgent','resource_structure','context_sensitive_candidate'],roots:any[]=[],families:any[]=[];
  for(let i=0;i<60;i++){const category=categories[Math.floor(i/15)],sourceFamilyId='f'+i,rootKeys=Array.from({length:i>=45?2:1},(_,j)=>'r'+i+'-'+j);for(const rootKey of rootKeys)roots.push({rootKey,sourceFamilyId,coverage:{four:false,five:false,nonbomb:false}});families.push({sourceFamilyId,category,rootKeys});}
  const path=join(dir,'queue.json');writeFileSync(path,JSON.stringify({candidateScoresUsed:false,familyIds:families.map(f=>f.sourceFamilyId)}));
  const r=validateFormalShape({kind:'skills60',families,roots,resourceCoverage:{four:3,five:3,nonbomb:3},sourceQueueRef:path,sourceQueueSHA256:fileHash(path)});expect(r.ready).toBe(false);expect(r.reasons.some(s=>/resource|coverage/.test(s))).toBe(true);
 }finally{rmSync(dir,{recursive:true});}
});
it('rejects a cycle of allegedly strong preferences',()=>{
 expect(()=>answerPartition(['a','b'],[{preferredActionId:'a',otherActionId:'b'},{preferredActionId:'b',otherActionId:'a'}])).toThrow(/cycle/);
});
it('does not infer non-severity from absence in the severe-error list',()=>{
 const root={partition:answerPartition(['good','bad','other'],[{preferredActionId:'good',otherActionId:'bad'},{preferredActionId:'good',otherActionId:'other'}]),severeErrorActionIds:['bad']};
 expect(severityChoice(root,'good')).toBe('nonsevere');expect(severityChoice(root,'bad')).toBe('confirmed_severe');expect(severityChoice(root,'other')).toBe('unknown');
});
it('does not turn a small real prototype into a complete formal exam',()=>{
 const r=validateFormalShape({kind:'fixture',families:[],roots:[],resourceCoverage:{four:0,five:0,nonbomb:0}});
 expect(r.ready).toBe(false);expect(r.reasons.some(s=>s.includes('60'))).toBe(true);
});
it('rejects a family referring to a root from another source',()=>{
 const r=validateFormalShape({kind:'fixture',families:[{sourceFamilyId:'f1',rootKeys:['r1']}],roots:[{sourceFamilyId:'f2',rootKey:'r1'}]});
 expect(r.reasons.some(s=>/ancestry/.test(s))).toBe(true);
});
