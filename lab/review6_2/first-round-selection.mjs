/** NAV-R15 dev-only rule. Pure selection, not proof of a completed trajectory:
 * the existing host finalizer must first verify all 64 committed updates and
 * the immutable same-run checkpoint chain. Never reads final match outcomes. */
import {isDeepStrictEqual as equal} from 'node:util';
import {decideFirstRoundR2Learning} from './first-round-contract.mjs';
const directions=['pass','takeover'];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const count=n=>Number.isSafeInteger(n)&&n>=0;
function directionShape(v){
 return v&&finite(v.demoCE)&&v.demoCE>=0&&count(v.count)&&v.count>0&&count(v.greedyAgreementCount)&&v.greedyAgreementCount<=v.count&&
  Array.isArray(v.sourceFamilyIds)&&v.sourceFamilyIds.length>=2&&v.sourceFamilyIds.length<=v.count&&v.sourceFamilyIds.every(x=>typeof x==='string'&&x.length>0)&&new Set(v.sourceFamilyIds).size===v.sourceFamilyIds.length;
}
function metricsShape(v){
 if(!v||!directions.every(d=>directionShape(v.directionMetrics?.[d])))return false;
 const total=directions.reduce((sum,d)=>sum+v.directionMetrics[d].count,0),weighted=directions.reduce((sum,d)=>sum+v.directionMetrics[d].demoCE*v.directionMetrics[d].count,0)/total;
 return finite(v.demoCE)&&Math.abs(v.demoCE-weighted)<=1e-6*Math.max(1,Math.abs(weighted))&& v&&finite(v.demoCE)&&v.demoCE>=0&&finite(v.keepKL)&&finite(v.keepDriftRate)&&v.keepDriftRate>=0&&v.keepDriftRate<=1&&directions.every(d=>directionShape(v.directionMetrics?.[d]))&&
  count(v.greedyChangedCount)&&v.greedyChangedCount<=directions.reduce((sum,d)=>sum+v.directionMetrics[d].count,0);
}
const none=reason=>({status:'no_candidate',selected:null,reason,eligible:[]});
/** Direction metrics explicitly report CE, greedy agreement count/denominator
 * and source families. Equal agreement counts do NOT imply unchanged actions;
 * greedyChangedCount is separately measured against S0 on the same decisions. */
export function selectFirstRoundCheckpoint(milestones,reviews){
 if(!Array.isArray(milestones)||milestones.length!==4||!milestones.every((m,i)=>m?.checkpoint?.optimizerSteps===[0,16,32,64][i]&&/^[a-f0-9]{64}$/.test(m.checkpoint.manifestSHA256))||new Set(milestones.map(m=>m.checkpoint.manifestSHA256)).size!==4)return none('first_round_checkpoint_sequence_incomplete');
 const baseline=milestones[0].metrics;
 if(!metricsShape(baseline)||baseline.greedyChangedCount!==0)return none('first_round_update0_or_directions_unverified');
 if(!Array.isArray(reviews))return {status:'pending_behavior_review',selected:null,reason:'necessary_behavior_review_missing',eligible:[]};
 const eligible=[];let pending=false;
 for(const m of milestones.slice(1)){
  const v=m.metrics,c=m.checkpoint;
  if(!metricsShape(v)||v.demoCE>=baseline.demoCE||directions.some(d=>v.directionMetrics[d].demoCE>baseline.directionMetrics[d].demoCE||v.directionMetrics[d].count!==baseline.directionMetrics[d].count||!equal([...v.directionMetrics[d].sourceFamilyIds].sort(),[...baseline.directionMetrics[d].sourceFamilyIds].sort())))continue;
  const matches=reviews.filter(r=>r?.checkpointSHA256===c.manifestSHA256);
  if(matches.length!==1||matches[0].status==='pending'){pending=true;continue;}
  if(matches[0].status==='accepted')eligible.push(m);
 }
 if(pending)return {status:'pending_behavior_review',selected:null,reason:'necessary_behavior_review_missing',eligible:eligible.map(m=>m.checkpoint)};
 eligible.sort((a,b)=>a.metrics.demoCE-b.metrics.demoCE||a.metrics.keepKL-b.metrics.keepKL||a.checkpoint.optimizerSteps-b.checkpoint.optimizerSteps);
 return {status:eligible.length?'selected':'no_candidate',selected:eligible[0]?.checkpoint??null,reason:eligible.length?'nav-r15-first-round-dev-only':'no_first_round_candidate_established',eligible:eligible.map(m=>m.checkpoint)};
}

/** r2 selects the first dev-only behavioral candidate at a complete epoch.
 * Later observations after a scientific stop are not alternative candidates. */
export function selectFirstRoundR2Checkpoint(milestones,reviews){
 if(!Array.isArray(milestones)||milestones.length<2)return none('r2_complete_epoch_observation_missing');
 const initial=milestones[0],U=milestones[1]?.checkpoint?.optimizerSteps;
 if(initial?.checkpoint?.optimizerSteps!==0||!Number.isSafeInteger(U)||U<1||!milestones.every((m,i)=>m?.checkpoint?.optimizerSteps===i*U&&m.metrics?.completedEpochs===i&&m.metrics?.optimizerSteps===i*U&&/^[a-f0-9]{64}$/.test(m.checkpoint.manifestSHA256)&&/^[a-f0-9]{64}$/.test(m.metrics.weightsSHA256)&&metricsShape(m.metrics)))return none('r2_checkpoint_sequence_unverified');
 if(initial.metrics.greedyChangedCount!==0)return none('r2_update0_unverified');
 let decision;
 for(let i=1;i<milestones.length;i++){
  const m=milestones[i],previous=milestones[i-1];
  decision=decideFirstRoundR2Learning({baseline:initial.metrics,previous:previous.metrics,current:m.metrics,weightsChanged:m.metrics.weightsSHA256!==previous.metrics.weightsSHA256});
  if(decision.decision==='continue')continue;
  if(i!==milestones.length-1)return none('r2_updates_after_scientific_stop');
  if(decision.decision!=='candidate')return none(decision.reason);
  const matches=Array.isArray(reviews)?reviews.filter(r=>r?.checkpointSHA256===m.checkpoint.manifestSHA256):[];
  if(matches.length!==1||matches[0].status==='pending')return{status:'pending_behavior_review',selected:null,reason:'necessary_behavior_review_missing',eligible:[]};
  return matches[0].status==='accepted'?{status:'selected',selected:m.checkpoint,reason:'r2-first-dev-behavioral-candidate',eligible:[m.checkpoint]}:none('r2_necessary_behavior_rejected');
 }
 return none('r2_learning_observation_requires_continuation');
}
