import {it,expect} from 'vitest';
import * as human from '../review6/human-data';
const row=(id:string,match:string,split='train')=>({decisionId:id,sourceMatchId:match,split,usableForH:true,targetRuleLegal:true,sourceDeclarationCount:1,targetEquivalentIndices:[0],candidateCount:2,firstIncompatibleEvent:null});
it('H selection joins fresh split with legal unique covered targets and balances source groups',()=>{
 const api=human as unknown as {selectHumanRows:Function};expect(api.selectHumanRows).toBeTypeOf('function');
 const rows=[...Array.from({length:20},(_,i)=>row(`long-${i}`,'long')),row('short','short'),row('old','old','historical_diagnostic'),{...row('invalid','bad'),usableForH:false},row('dev','dev','dev'),row('held','held','holdout')];
 const selected=api.selectHumanRows(rows,{train:2,dev:1,holdout:1},'prelocked-unit');
 expect(selected.train).toHaveLength(2);expect(new Set(selected.train.map((r:any)=>r.sourceMatchId)).size).toBe(2);expect(selected.dev.map((r:any)=>r.decisionId)).toEqual(['dev']);expect(selected.holdout.map((r:any)=>r.decisionId)).toEqual(['held']);expect(Object.values(selected).flat().some((r:any)=>['old','invalid'].includes(r.decisionId))).toBe(false);
 expect(api.selectHumanRows([...rows].reverse(),{train:2,dev:1,holdout:1},'prelocked-unit')).toEqual(selected);
});
it('malformed usable targets, duplicate decisions and cross-split source groups reject before fitting',()=>{
 const api=human as unknown as {selectHumanRows:Function};expect(api.selectHumanRows).toBeTypeOf('function');
 for(const rows of [[row('same','m'),row('same','m')],[row('a','m','train'),row('b','m','holdout')],[{...row('a','m'),targetEquivalentIndices:[]}],[{...row('a','m'),targetEquivalentIndices:[0,0]}],[{...row('a','m'),firstIncompatibleEvent:{event:1}}]])expect(()=>api.selectHumanRows(rows,{train:1,dev:1,holdout:1},'x')).toThrow();
});
