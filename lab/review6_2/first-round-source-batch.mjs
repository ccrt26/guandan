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

/** Explicit later-round branch; round0 above remains byte-for-byte unchanged. */
export const COMMON_VIEW_ROUND_SPEC_SCHEMA='ohuo-offline-selection-spec-common-view-round-r2';
export const COMMON_VIEW_ROUND_CONTRACT_SCHEMA='ohuo-common-view-representative-round-r2';
export const COMMON_VIEW_POOL_SCHEMA='ohuo-common-view-representative-pool-r2';
export function commonViewDecisionKey(key){
 need(key&&typeof key==='object'&&!Array.isArray(key),'decision_key');
 return JSON.stringify(Object.keys(key).sort().map(k=>[k,key[k]]));
}
export function commonViewRowIdentity(row){need(typeof row.inputSHA256==='string'&&/^[a-f0-9]{64}$/.test(row.inputSHA256),'input_sha');return commonViewDecisionKey(row.key)+'|'+row.inputSHA256;}
export function selectNextCommonViewRepresentatives(hashOrderedRows,representativeRound,usedRows){
 need(Number.isSafeInteger(representativeRound)&&representativeRound>0,'later_round_required');need(Array.isArray(usedRows),'verified_used_rows_required');
 const used=new Map();for(const r of usedRows){const k=commonViewDecisionKey(r.key);need(!used.has(k)||used.get(k)===r.inputSHA256,'used_input_changed');used.set(k,r.inputSHA256);}
 const cells=new Map(),selected=[],deferred=[],previouslySelected=[],order=[];
 for(const [sourceHashRank,row]of hashOrderedRows.entries()){
  commonViewRowIdentity(row);need(row.commonViewCell&&typeof row.commonViewCell==='object','public_cell_missing');const key=JSON.stringify(row.commonViewCell);
  let cell=cells.get(key);if(!cell){cell={cell:structuredClone(row.commonViewCell),eligible:0,selected:0,deferred:0,previouslySelected:0,exhausted:false};cells.set(key,cell);}
  const decisionKey=commonViewDecisionKey(row.key),old=used.has(decisionKey);if(old)need(used.get(decisionKey)===row.inputSHA256,'used_input_changed');
  const choose=!old&&cell.selected===0;order.push({row,sourceHashRank,cellRank:cell.eligible,selected:choose,previouslySelected:old});cell.eligible++;
  if(old){cell.previouslySelected++;previouslySelected.push(row);}else if(choose){cell.selected++;selected.push(row);}else{cell.deferred++;deferred.push(row);}
 }
 for(const c of cells.values())c.exhausted=c.selected===0&&c.deferred===0;
 return{selected,deferred,previouslySelected,cells:[...cells.values()],order};
}
/** Inputs here are resolved from the entire fixed host catalog by the original
 * offline selector. There is deliberately no caller prior[] admission surface. */
export function validateCommonViewRoundTasks(contract){
 const coverage=contract?.coverageRevisionRef!==undefined;if(coverage)need(Number.isSafeInteger(contract.round)&&contract.round>=2&&typeof contract.coverageRevisionRef==='string'&&/^.+@sha256:[a-f0-9]{64}$/.test(contract.coverageRevisionRef),'coverage_named_round');
 const expected=coverage?[['primary-teacher','train'],['screen','train']]:[['primary-teacher','train'],['primary-teacher','dev'],['screen','train'],['screen','dev']],ids=new Set();
 need(Array.isArray(contract?.plannedTasks)&&contract.plannedTasks.length===expected.length,'round_tasks');
 contract.plannedTasks.forEach((t,i)=>{need(t&&Object.keys(t).sort().join(',')==='role,split,taskId'&&t.role===expected[i][0]&&t.split===expected[i][1]&&typeof t.taskId==='string'&&t.taskId.length>0&&!ids.has(t.taskId),'round_task_identity');ids.add(t.taskId);});return contract.plannedTasks;
}
export function validateCommonViewRoundChain(contract,entries){
 validateCommonViewRoundTasks(contract);
 need(contract?.schema===COMMON_VIEW_ROUND_CONTRACT_SCHEMA&&Number.isSafeInteger(contract.round)&&contract.round>0,'round_contract');
 need(Array.isArray(entries)&&entries.length>=contract.round,'predecessor_chain_missing');
 const chain=[...entries].sort((a,b)=>a.round-b.round),refs=new Set(),usedKeys=new Map(),usedRows=[];
 for(let i=0;i<chain.length;i++){
  const e=chain[i];need(e.round===i&&!refs.has(e.selectionRef),'predecessor_chain_gap_or_fork');refs.add(e.selectionRef);
  need(Array.isArray(e.rows)&&e.rows.length>0,'frozen_round_empty');
  if(i===0)need(e.parentSelectionRef===null,'round_zero_parent');else need(e.parentSelectionRef===chain[i-1].selectionRef,'predecessor_parent');
  if(i===contract.round)need(e.parentSelectionRef===contract.parentSelectionRef,'current_parent');
  for(const r of e.rows){const k=commonViewDecisionKey(r.key);commonViewRowIdentity(r);need(!usedKeys.has(k),'frozen_selection_repeated');usedKeys.set(k,r.inputSHA256);if(i<contract.round)usedRows.push(structuredClone(r));}
 }
 need(contract.parentSelectionRef===chain[contract.round-1].selectionRef,'latest_predecessor');
 return{chain,priorSelectionRefs:chain.slice(0,contract.round).map(e=>e.selectionRef),usedRows};
}
/** A failed response is a completed attempt, never a reason to reuse its row.
 * Host/selector must have checked original Task/CP/terminal SHA before calling.
 * Known zero-send prequery failures are omitted ONLY by the original strict
 * knownUnsentWorldPreparationFailure reader, never by a supplied boolean. */
export function assertCommonViewRoundTerminalsSettled(priorSelections,runs){
 const needed=new Map(priorSelections.map(s=>[s.selectionRef,new Map(s.rows.map(r=>[commonViewRowIdentity(r),r]))])),done=new Map([...needed].map(([k])=>[k,new Set()]));
 for(const run of runs){
  need(['completed','failed','interrupted'].includes(run.status)&&run.cleanupConfirmed===true&&run.executionUnknown!==true&&run.observationStatus!=='unknown'&&run.stopReason!=='execution_uncertain'&&run.failureReason!=='execution_uncertain','related_run_unsettled');
  const cp=run.checkpoint;need(cp&&cp.executionUnknown!==true&&cp.active==null&&!run.activeReservation,'related_checkpoint_unsettled');
  if(cp.schema!=='ohuo-offline-label-run-v1'){need(run.status==='completed','related_run_unfinished');continue;}
  if(!needed.has(cp.selectionRef))continue;
  need(cp.executionUnknown===false&&cp.active===null,'related_label_unsettled');
  need(Array.isArray(cp.rows)&&cp.cursor===cp.rows.length,'related_label_checkpoint');
  for(const row of cp.rows){need(row.requestCount!==null&&Number.isSafeInteger(row.requestCount)&&row.requestCount>=0,'provider_execution_unknown');const id=commonViewRowIdentity(row);need(needed.get(cp.selectionRef).has(id),'terminal_outside_frozen_selection');if(run.labelRole!=='independent-review')done.get(cp.selectionRef).add(id);}
 }
 for(const [ref,rows]of needed)need(done.get(ref).size===rows.size,'prior_selected_rows_unfinished');
 return true;
}

/** Only public pre-label eligibility, never a desired teacher answer. */
export const TRAIN_COVERAGE_POLICY='partner-leading-pair-straight-all-active-next-unused-per-original-source-cell-v1';
export function trainCoveragePublicReason(view){
 const s=view?.state,t=s?.currentTarget,other=s?.otherSeats;
 if(t?.leadingSeat!=='partner')return 'partner_not_leading';
 if(!['pair','straight'].includes(t.kind))return 'target_not_pair_or_straight';
 if(!Array.isArray(s.myHand)||s.myHand.reduce((n,c)=>n+c.count,0)<=0||!['partner','lower','upper'].every(k=>Number.isSafeInteger(other?.[k]?.remainingCards)&&other[k].remainingCards>0))return 'not_all_four_active';
 if(!Array.isArray(view.candidates)||!view.candidates.some(c=>c.action?.pass===true))return 'no_original_pass_candidate';
 if(!view.candidates.some(c=>c.action?.pass===false&&c.action.kind===t.kind))return 'no_same_kind_takeover_candidate';
 return null;
}
export function trainCoveragePublicEligible(view){return trainCoveragePublicReason(view)===null;}

/** Two enumerated scientific policies; these helpers grant no execution authority. */
export const TRAIN_PUBLIC_STRATA_POLICY='partner-leading-pair-straight-natural-resource-relative-hand-next-unused-v2';
export function trainPublicResourceCell(view){
 need(trainCoveragePublicReason(view)===null,'public_strata_base_conditions');
 const target=view.state.currentTarget,own=view.state.myHand.reduce((n,c)=>n+c.count,0),partner=view.state.otherSeats.partner.remainingCards;
 need(Number.isSafeInteger(own)&&own>0&&Number.isSafeInteger(partner)&&partner>0,'public_strata_counts');
 return {hasNaturalNonJokerOption:view.candidates.some(c=>!c.action.pass&&c.action.kind===target.kind&&c.action.wildCount===0&&!c.action.cards.some(p=>p.card==='SJ'||p.card==='BJ')),ownHasFewerCardsThanPartner:own<partner};
}
export function selectReviewedTrainRepresentatives(rows,round,usedRows,strata=null){
 if(strata===null)return selectNextCommonViewRepresentatives(rows,round,usedRows);
 const originals=new Map(rows.map(r=>[commonViewRowIdentity(r),r])),decorated=rows.map(r=>{const cell=strata.get(commonViewRowIdentity(r));need(cell&&Object.keys(cell).sort().join(',')==='hasNaturalNonJokerOption,ownHasFewerCardsThanPartner'&&Object.values(cell).every(v=>typeof v==='boolean'),'public_strata_cell');return {...r,commonViewCell:{...r.commonViewCell,...cell}};});
 const result=selectNextCommonViewRepresentatives(decorated,round,usedRows),original=r=>originals.get(commonViewRowIdentity(r));
 return {...result,selected:result.selected.map(original),deferred:result.deferred.map(original),previouslySelected:result.previouslySelected.map(original),order:result.order.map(o=>({...o,row:original(o.row)}))};
}
