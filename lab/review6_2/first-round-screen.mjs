/** NAV-R13 fixed four-world screening of the existing evaluateTeacherBranch
 * results. No simulation, sampling, teacher call or evidence upgrade occurs
 * here. Caller must freeze the GLM proposal and these exact actions/worlds/
 * continuation before any branch starts, and bind all starts to the old ledger.
 * This exclusion rule is NOT the independent new-test R16 readout. */
import {isDeepStrictEqual as equal} from 'node:util';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const text=s=>typeof s==='string'&&s.trim().length>0;
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const need=(ok,reason)=>{if(!ok)throw Error('first_round_screen_'+reason);};
export function screenFirstRoundBranches(input){
 const {proposalActionId,actions,worlds,profileSHA256,policyIds,results,comparisonBatch}=input??{};
 const commonView=comparisonBatch?.schema==='ohuo-common-view-world-batch-r2';
 if(comparisonBatch!==undefined)need(commonView&&typeof comparisonBatch.protocolRef==='string'&&/^[-a-zA-Z0-9._/:]+@sha256:[a-f0-9]{64}$/.test(comparisonBatch.protocolRef)&&text(comparisonBatch.batchId)&&text(comparisonBatch.precisionTarget)&&equal(comparisonBatch.worlds,worlds),'frozen_comparison_batch');
 need(Array.isArray(actions)&&actions.length>=2&&actions.length<=3&&actions.every(a=>text(a?.actionId)&&text(a.canonicalId))&&new Set(actions.map(a=>a.actionId)).size===actions.length&&new Set(actions.map(a=>a.canonicalId)).size===actions.length&&actions.some(a=>a.actionId===proposalActionId),'fixed_actions');
 need(Array.isArray(worlds)&&(commonView?worlds.length>0:worlds.length===4)&&worlds.every(w=>text(w?.worldId)&&Number.isSafeInteger(w.seed)&&w.seed>=0)&&new Set(worlds.map(w=>w.worldId)).size===worlds.length&&new Set(worlds.map(w=>w.seed)).size===worlds.length,'fixed_four_worlds');
 need(hash(profileSHA256)&&Array.isArray(policyIds)&&policyIds.length===4&&policyIds.every(text),'continuation_identity');
 need(Array.isArray(results)&&results.length<=worlds.length*actions.length,'bounded_results');
 const byKey=new Map(),layoutByWorld=new Map();
 for(const row of results){
  const world=worlds.find(w=>w.worldId===row?.worldId),action=actions.find(a=>a.actionId===row?.actionId),r=row?.result;
  need(world&&action&&r,'branch_outside_frozen_plan');
  const key=JSON.stringify([row.worldId,row.actionId]);need(!byKey.has(key),'duplicate_branch');
  need(r.seed===world.seed&&r.forcedActionId===action.actionId&&r.profileSHA256===profileSHA256&&equal(r.policyIds,policyIds)&&hash(r.initialWorldSHA256)&&r.ownPlanSummary===null,'branch_identity');
  const layout=layoutByWorld.get(row.worldId);need(layout===undefined||layout===r.initialWorldSHA256,'paired_world_identity');layoutByWorld.set(row.worldId,r.initialWorldSHA256);
  need(typeof r.complete==='boolean','completion_unknown');
  if(r.complete)need((r.W===-1||r.W===1)&&finite(r.g)&&finite(r.y)&&r.y===r.g+r.W,'complete_metric');
  else need(r.W===null&&r.y===null&&(r.g===null||finite(r.g))&&text(r.incompleteReason),'incomplete_metric');
  byKey.set(key,r);
 }
 const incompleteBranches=[],actionSummaries=actions.map(action=>{
  const values=worlds.map(world=>{
   const r=byKey.get(JSON.stringify([world.worldId,action.actionId]));
   if(!r||!r.complete){incompleteBranches.push({worldId:world.worldId,actionId:action.actionId,reason:r?.incompleteReason??'missing_result'});return{worldId:world.worldId,Y:null,gPlusW:null};}
   // Existing lowercase y is g+W, not normalized full-match victory.
   return{worldId:world.worldId,Y:(r.W+1)/2,gPlusW:r.g+r.W};
  });
  const complete=values.every(v=>v.Y!==null);
  return{actionId:action.actionId,canonicalId:action.canonicalId,values,meanY:complete?values.reduce((s,v)=>s+v.Y,0)/worlds.length:null,meanGPlusW:complete?values.reduce((s,v)=>s+v.gPlusW,0)/worlds.length:null};
 });
 const proposal=actionSummaries.find(a=>a.actionId===proposalActionId),comparisons=[];
 if(!incompleteBranches.length)for(const other of actionSummaries){if(other===proposal)continue;
  const paired=worlds.map((world,i)=>({worldId:world.worldId,deltaY:proposal.values[i].Y-other.values[i].Y,deltaGPlusW:proposal.values[i].gPlusW-other.values[i].gPlusW}));
  const deltaY=proposal.meanY-other.meanY,deltaGPlusW=proposal.meanGPlusW-other.meanGPlusW;
  comparisons.push({comparisonActionId:other.actionId,paired,deltaY,deltaGPlusW,adverse:deltaY<0||(deltaY>=0&&deltaGPlusW<0)});
 }
 // The original non-adverse filter admits noisy provisional demonstrations,
 // never strong labels or a claim that finite-world precision is established.
 const status=incompleteBranches.length?'incomplete':comparisons.some(c=>c.adverse)?'screen_adverse':'provisional_screened';
 if(commonView){
  const sampleVariance=values=>{if(values.length<2)return null;const average=values.reduce((a,b)=>a+b,0)/values.length;return values.reduce((s,x)=>s+(x-average)**2,0)/(values.length-1);};
  return{schema:'ohuo-common-view-screen-evidence-r2',status,evidenceGrade:status==='provisional_screened'?'provisional_screened':null,precisionStatus:'precision_not_established',uncertainty:'Finite frozen-world paired estimates only; not a strong label or precision guarantee.',comparisonBatch:structuredClone(comparisonBatch),worldCount:worlds.length,proposalActionId,profileSHA256,policyIds:[...policyIds],worlds:structuredClone(worlds),actionSummaries,comparisons:comparisons.map(c=>({...c,pairedVarianceY:sampleVariance(c.paired.map(p=>p.deltaY)),pairedVarianceGPlusW:sampleVariance(c.paired.map(p=>p.deltaGPlusW))})),incompleteBranches};
 }
 return{schema:'ohuo-first-round-screening-v1',status,evidenceGrade:status==='provisional_screened'?'provisional_screened':null,proposalActionId,profileSHA256,policyIds:[...policyIds],worlds:structuredClone(worlds),actionSummaries,comparisons,incompleteBranches};
}
