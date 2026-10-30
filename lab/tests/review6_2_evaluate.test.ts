import{it,expect}from'vitest';
import{evaluationLayouts,outcomeBlock,bootstrapColumns}from'../review6_2/evaluate';
import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{atomicJson,fileHash,ROOT}from'../review6_2/protocol';
const p=(policyId:string)=>({policyId,kind:'heuristic',difficulty:0});
const registry:any={policies:['old','n','d1','d2','d3','c1','c2','c3'].map(p),oldCompletePolicy:'old',developmentPartners:['d1','d2','d3'],confirmationPartners:['c1','c2','c3'],legacyM2Partner:p('legacyH')};
it('keeps confirmation partners out of development and places M1/M2 seats correctly',()=>{
 const dev=evaluationLayouts(registry,p('n')as any,'dev');
 expect(dev[0].policies.map(p=>p.policyId)).toEqual(['n','old','d1','old']);
 expect(dev[1].policies.map(p=>p.policyId)).toEqual(['old','n','old','d1']);
 expect(dev.find(r=>r.metric==='M1'&&r.side===0)!.policies.map(p=>p.policyId)).toEqual(['n','old','n','old']);
 expect(dev.find(r=>r.metric==='M2'&&r.side===0)!.policies.map(p=>p.policyId)).toEqual(['n','old','legacyH','legacyH']);
 const formal=evaluationLayouts(registry,p('n')as any,'sealed');
 expect(formal[0].policies.map(p=>p.policyId)).toEqual(['n','old','c1','old']);
});
it('uses paired role wins with complete fixed blocks and rejects missing matches',()=>{
 const layouts=evaluationLayouts(registry,p('n')as any,'dev');
 const rows=layouts.map(l=>({...l,complete:true,winner:l.metric==='cooperation'?(l.variant==='U0'?l.actor:1-l.actor):l.side===0?0:0,activeSeconds:.1}));
 const b=outcomeBlock(rows,layouts);expect(b.macroDifference).toBe(1);expect(b.groupDifferences).toEqual([1,1,1]);expect(b.M1).toBe(.5);expect(b.M2).toBe(.5);
 expect(()=>outcomeBlock(rows.slice(1),layouts)).toThrow(/complete.*block/);
 const wrong=rows.map(r=>({...r}));wrong[0].actor=1-wrong[0].actor;
 expect(()=>outcomeBlock(wrong,layouts)).toThrow(/role|layout/);
});
it('refuses cached statistics when current blocks no longer match the cached input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-stats-'));
 try{
  atomicJson(join(dir,'test-stats-input.json'),{oldData:true});
  atomicJson(join(dir,'test-stats.json'),{inputSHA256:fileHash(join(dir,'test-stats-input.json')),sourceSHA256:fileHash(join(ROOT,'lab/review6/paired_stats.py')),columns:{macro:{point:-1}}});
  expect(()=>bootstrapColumns({seed:19},dir,'test',[{ordinal:0},{ordinal:1}],{macro:[1,1]},[.05,.95])).toThrow(/current.*blocks|current.*input/);
 }finally{rmSync(dir,{recursive:true});}
});
