/** Small shared r2 source/selector contract. Finite input lists describe THIS
 * frozen batch; they are not lifetime quotas or a source of execution authority. */
export const COMMON_VIEW_PROTOCOL_ID='first-round-common-view-r2';
export const COMMON_VIEW_SOURCE_SCHEMA='ohuo-first-round-source-spec-common-view-r2';
export const COMMON_VIEW_SELECTION_SCHEMA='ohuo-offline-selection-common-view-r2';
export const COMMON_VIEW_SOURCE_BASIS_SCHEMA='ohuo-selection-source-batch-basis-r2';
const caps={pilot:2,formal:4,newTest:2,variancePilot:4,confirmation:8};
const need=(ok,reason)=>{if(!ok)throw Error('source_batch_'+reason);};
const count=n=>Number.isSafeInteger(n)&&n>=0;
export function readCommonViewProtocol(ref,get){
 need(typeof ref==='string'&&/^[-a-zA-Z0-9._/:]+@sha256:[a-f0-9]{64}$/.test(ref),'protocol_ref');
 const p=get(ref);need(p?.schema==='ohuo-first-round-protocol-revision-v2'&&p.protocolId===COMMON_VIEW_PROTOCOL_ID,'protocol_identity');return p;
}
export function sourceStageWorkload(spec,stage){
 need(Object.hasOwn(caps,stage),'stage');
 if(spec.schema!==COMMON_VIEW_SOURCE_SCHEMA)return{reservedCount:caps[stage],devCount:stage==='formal'?2:0};
 const s=spec.stages[stage];need(s&&count(s.reservedCount)&&count(s.devCount)&&s.devCount<=s.reservedCount&&(stage==='formal'||s.devCount===0)&&(s.activeCount===null||count(s.activeCount)&&s.activeCount<=s.reservedCount),'frozen_counts');
 return{reservedCount:s.reservedCount,devCount:s.devCount};
}
export function readCommonViewSourceFamilies(rows){
 need(Array.isArray(rows)&&rows.length>0,'families');const seen=new Set();
 for(const r of rows){need(r&&Object.keys(r).sort().join(',')==='familyId,split'&&typeof r.familyId==='string'&&/^first-deal-family:[a-f0-9]{64}$/.test(r.familyId)&&['train','dev'].includes(r.split)&&!seen.has(r.familyId),'family_identity');seen.add(r.familyId);}
 return rows.map(r=>({...r,count:null})).sort((a,b)=>a.familyId<b.familyId?-1:a.familyId>b.familyId?1:0);
}
/** Four public dimensions only; these relationships never assert opponents
 * can play their remaining cards or that a rare cell has natural frequency. */
export function commonViewCoverageCell(view){
 const state=view?.state,target=state?.currentTarget,other=state?.otherSeats;
 need(typeof target?.kind==='string'&&Number.isSafeInteger(target.size)&&target.size>0&&other&&Array.isArray(view.candidates),'public_cell_input');
 const opponentCounts=['lower','upper'].map(k=>other[k]?.remainingCards);need(opponentCounts.every(count)&&count(other.partner?.remainingCards),'public_cell_counts');
 const active=opponentCounts.filter(n=>n>0),minimum=active.length?Math.min(...active):null;
 return{targetKind:target.kind,opponentSizeRelation:minimum===null?'none-active':minimum<target.size?'<':minimum===target.size?'=':'>',hasOrdinaryTakeover:view.candidates.some(c=>c.action?.pass===false&&!['bomb','flush','joker_bomb'].includes(c.action.kind)),partnerZero:other.partner.remainingCards===0};
}
/** This rollout freezes the initial representative round in a fresh source
 * namespace. It does not silently authorize relabeling an already exposed pool;
 * later same-pool rounds require their own explicit unused-prefix admission. */
export function selectCommonViewRepresentatives(hashOrderedRows,representativeRound){
 need(representativeRound===0,'initial_representative_round_required');const cells=new Map(),selected=[],deferred=[],order=[];
 for(const [sourceHashRank,row] of hashOrderedRows.entries()){need(row.commonViewCell&&typeof row.commonViewCell==='object','public_cell_missing');const key=JSON.stringify(row.commonViewCell),prior=cells.get(key);order.push({row,sourceHashRank,cellRank:prior?.eligible??0,selected:!prior});
  if(prior){prior.eligible++;prior.deferred++;deferred.push(row);}else{cells.set(key,{cell:structuredClone(row.commonViewCell),eligible:1,selected:1,deferred:0});selected.push(row);}}
 return{selected,deferred,cells:[...cells.values()],order};
}
