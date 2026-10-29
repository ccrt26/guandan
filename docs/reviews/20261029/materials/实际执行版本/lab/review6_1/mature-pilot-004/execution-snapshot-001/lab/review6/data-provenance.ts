import type {KscbMatch} from '../src/review5_tuning/kscbReplay';
import {createHash} from 'node:crypto';
export type {KscbMatch};
export interface SourceSplitRow {sourceMatchId:string;familyId:string;split:'historical_diagnostic'|'train'|'dev'|'holdout'|'unusable';reason?:string;}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const bands=[17,33,49,65];
const permutations=[[17,49,65],[17,65,49],[49,17,65],[49,65,17],[65,17,49],[65,49,17]];

/** Conservative grouping before any model result: same initial deal under seat
 * rotation and permutation of the three non-heart suits remains one family. */
export function sourceFamilyKey(record:KscbMatch):string{
 const events=record.rounds[0]?.events??[],hands=Array.from({length:4},(_,seat)=>events.filter(e=>e.event_id===2&&e.uid===`P${seat+1}`));
 if(hands.some(h=>h.length!==1||h[0].tiles?.length!==27))throw new Error('initial deal family identity unverifiable');
 const raw=hands.map(h=>h[0].tiles!),counts=new Map<number,number>();
 for(const code of raw.flat()){
  if(![94,95].includes(code)&&!bands.some(b=>code>=b&&code<b+13))throw new Error('unknown raw card code');
  counts.set(code,(counts.get(code)??0)+1);
 }
 if(counts.size!==54||[...counts.values()].some(n=>n!==2))throw new Error('initial deck multiplicity invalid');
 const variants:string[]=[];
 for(const perm of permutations){
  const map=new Map([[17,perm[0]],[33,33],[49,perm[1]],[65,perm[2]]]);
  const transformed=raw.map(hand=>hand.map(code=>{if(code>=94)return code;const band=bands.find(b=>code>=b&&code<b+13)!;return map.get(band)!+code-band;}).sort((a,b)=>a-b));
  for(let rotation=0;rotation<4;rotation++)variants.push(JSON.stringify(Array.from({length:4},(_,seat)=>transformed[(seat+rotation)%4])));
 }
 return 'first-deal-family:'+digest(variants.sort()[0]);
}

export function partitionHumanSource(records:KscbMatch[],consumedIds:Set<string>,namespace:string){
 if(!namespace||new Set(records.map(r=>r.sample_id)).size!==records.length)throw new Error('missing namespace or duplicate source match ID');
 const rows:SourceSplitRow[]=records.map(record=>{
  try{return {sourceMatchId:record.sample_id,familyId:sourceFamilyKey(record),split:'unusable'};}
  catch(error){return {sourceMatchId:record.sample_id,familyId:'unverifiable:'+digest(JSON.stringify(record.rounds[0]?.events??[])),split:'unusable',reason:(error as Error).message};}
 });
 return partitionHumanMetadata(rows,consumedIds,namespace);
}
export function partitionHumanMetadata(input:SourceSplitRow[],consumedIds:Set<string>,namespace:string){
 if(!namespace||new Set(input.map(r=>r.sourceMatchId)).size!==input.length)throw new Error('missing namespace or duplicate source match ID');
 const rows=input.map(r=>({...r}));
 const seenFamilies=new Set(rows.filter(r=>consumedIds.has(r.sourceMatchId)).map(r=>r.familyId));
 const fresh=[...new Set(rows.filter(r=>!r.reason&&!seenFamilies.has(r.familyId)).map(r=>r.familyId))].sort((a,b)=>digest(`${namespace}:${a}`).localeCompare(digest(`${namespace}:${b}`)));
 const trainEnd=Math.floor(fresh.length*.6),devEnd=trainEnd+Math.floor(fresh.length*.2);
 const splitOf=new Map(fresh.map((id,index)=>[id,index<trainEnd?'train':index<devEnd?'dev':'holdout'] as const));
 for(const row of rows)if(seenFamilies.has(row.familyId))row.split='historical_diagnostic';else if(!row.reason)row.split=splitOf.get(row.familyId)!;
 rows.sort((a,b)=>a.sourceMatchId.localeCompare(b.sourceMatchId));
 return {schemaVersion:'r6-human-family-split-v1',namespace,splitUnit:'whole_source_match_and_initial_deal_family',familyDefinition:'first deal under cyclic seat rotations and nonheart suit permutations; conservative dependence grouping, not proof of human independence',fractions:{train:.6,dev:.2,holdout:.2},freshFamilies:fresh.length,consumedSourceIds:[...consumedIds].sort(),rows};
}
