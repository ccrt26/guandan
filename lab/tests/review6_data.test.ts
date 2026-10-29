import {it,expect} from 'vitest';
import {buildDeck,RNG} from '@gd/engine';
import * as provenance from '../review6/data-provenance';

function match(seed:number,id:string){
 const deck=new RNG(seed).shuffle(buildDeck()),bands={S:17,H:33,D:49,C:65,J:0};
 const code=(c:typeof deck[number])=>c.rank>=16?c.rank===16?94:95:bands[c.suit]+(c.rank===14?0:c.rank-1);
 return {sample_id:id,rounds:[{events:[{event_id:1,uid:'P1',tiles:[2]},...[0,1,2,3].map(seat=>({event_id:2,uid:`P${seat+1}`,tiles:deck.slice(seat*27,seat*27+27).map(code)}))]}]};
}
it('source family identity groups renamed, rotated and nonwild-suit variants before splitting',()=>{
 const p=provenance as unknown as {sourceFamilyKey:Function};expect(p.sourceFamilyKey).toBeTypeOf('function');
 const original=match(61,'original'),variant=structuredClone(original);variant.sample_id='renamed';
 const mapping=new Map([[17,49],[49,65],[65,17],[33,33]]);
 for(const e of variant.rounds[0].events){if(e.event_id===2){e.uid=`P${Number(e.uid.slice(1))%4+1}`;e.tiles=e.tiles.map(t=>{if(t>=94)return t;const b=[17,33,49,65].find(v=>t>=v&&t<v+13)!;return mapping.get(b)!+t-b;});}}
 expect(p.sourceFamilyKey(original)).toBe(p.sourceFamilyKey(variant));expect(p.sourceFamilyKey(match(62,'different'))).not.toBe(p.sourceFamilyKey(original));
});
it('a consumed source excludes its whole family and every remaining family has one frozen split',()=>{
 const p=provenance as unknown as {partitionHumanSource:Function};expect(p.partitionHumanSource).toBeTypeOf('function');
 const records=Array.from({length:20},(_,i)=>match(100+i,`match-${i}`)),alias=structuredClone(records[0]);alias.sample_id='unseen-id-same-family';records.push(alias);
 const result=p.partitionHumanSource(records,new Set(['match-0']),'unit-prelocked-v1');
 expect(result.rows).toHaveLength(21);
 expect(result.rows.filter((r:{split:string})=>r.split==='historical_diagnostic').map((r:{sourceMatchId:string})=>r.sourceMatchId).sort()).toEqual(['match-0','unseen-id-same-family']);
 const byFamily=new Map<string,Set<string>>();for(const r of result.rows){if(!byFamily.has(r.familyId))byFamily.set(r.familyId,new Set());byFamily.get(r.familyId)!.add(r.split);}expect([...byFamily.values()].every(s=>s.size===1)).toBe(true);
 const reordered=p.partitionHumanSource([...records].reverse(),new Set(['match-0']),'unit-prelocked-v1');expect(reordered.rows).toEqual(result.rows);
});
