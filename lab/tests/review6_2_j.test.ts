import{it,expect}from'vitest';import{jLayouts,jOutcome,jSource,validateJBlock,evaluateJ}from'../review6_2/j-evaluate';
it('preserves legacy J level2 on both partnerships and pairs the physical actor',()=>{
 const n:any={policyId:'N'},o:any={policyId:'O'},l=jLayouts(n,o);
 expect(l.map(r=>r.policies.map(p=>p.policyId))).toEqual([['N','O','legacy-J-partner-heuristic-level2','legacy-J-partner-heuristic-level2'],['O','N','legacy-J-partner-heuristic-level2','legacy-J-partner-heuristic-level2']]);
 const rows=l.map(r=>({...r,policyIds:r.policies.map(p=>p.policyId),complete:true,winner:r.actor}));expect(jOutcome(rows,l)).toBe(1);
 rows[0].actor=1;expect(()=>jOutcome(rows,l)).toThrow(/role/);
});
it('rejects a copied source or ordinal before resampling independent blocks',()=>{
 const layouts=jLayouts({policyId:'N'}as any,{policyId:'O'}as any),config={seed:42},source=jSource(config,0);
 const matches=layouts.map(l=>({...l,policyIds:l.policies.map(p=>p.policyId),complete:true,winner:l.actor,roundBaseFamilies:[source.familyId]}));
 const block={ordinal:0,source,matches,J:1};expect(()=>validateJBlock(block,layouts,config,0)).not.toThrow();
 expect(()=>validateJBlock({...block,ordinal:1},layouts,config,0)).toThrow(/ordinal/);
 expect(()=>validateJBlock({...block,source:jSource(config,1)},layouts,config,0)).toThrow(/source/);
});
it('rejects one-block bootstrap jobs before performing matches',async()=>{
 await expect(evaluateJ({},{kind:'heuristic',policyId:'N',difficulty:0},'/unused',1)).rejects.toThrow(/at least2/);
});
