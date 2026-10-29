import {expect,it} from 'vitest';
import {buildDeck,classify,makeLevelCtx} from '@gd/engine';
import * as review from '../src/index';
it('using a whole four-card resource inside a five bomb is not breaking that resource',()=>{
 const ctx=makeLevelCtx([2,2],'stage',0),cards=buildDeck().filter(c=>c.rank===5).slice(0,5);
 const four=classify(cards.slice(0,4),ctx).find(c=>c.kind==='bomb')!,five=classify(cards,ctx).find(c=>c.kind==='bomb')!;
 const fn=(review as unknown as {resourceSplitTerms?:Function}).resourceSplitTerms;expect(fn).toBeTypeOf('function');
 expect(fn!({combos:[four],hands:1,avgRank:5},five)).toEqual([]);
 const splitting=fn!({combos:[five],hands:1,avgRank:5},four);
 expect(splitting).toEqual([expect.objectContaining({key:'break-bomb',value:-12})]);
});
