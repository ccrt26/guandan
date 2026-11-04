/** NAV-R14's one named first-round contract. Constants/validation only: no
 * execution, policy resolution, budget initialization or implicit authorization. */
import {isDeepStrictEqual} from 'node:util';
export const FIRST_ROUND_RECIPE_ID='first-round-partner-control-fixed64-v1';
export const FIRST_ROUND_RECIPE=Object.freeze({
 recipeId:FIRST_ROUND_RECIPE_ID,optimizer:'RMSprop',alpha:.9,eps:1e-5,momentum:0,centered:false,weightDecay:0,
 learningRate:1e-4,temperature:1,keepWeight:1,demoBatch:32,keepBatch:32,
 maxUpdates:64,calibrationUpdates:1,checkpointUpdates:Object.freeze([0,16,32,64]),maxSharedOptimizerSteps:130,
 initialization:'fixed-parent-new-optimizer',
});
/** Dispatch is not validation: every first-round consumer must validate before
 * reading assets/performing work, and unknown recipe IDs retain old rejection. */
export const isFirstRoundRecipe=value=>value?.recipeId===FIRST_ROUND_RECIPE_ID||isFirstRoundR2Recipe(value);
export function validateFirstRoundRecipe(value){
 if(isFirstRoundR2Recipe(value))return validateFirstRoundR2Recipe(value);
 if(!value||![1e-4,3e-5].includes(value.learningRate)||!isDeepStrictEqual(value,{...FIRST_ROUND_RECIPE,learningRate:value.learningRate}))throw Error('unsupported_first_round_recipe');
 return value;
}
export function firstRoundTrainingShape(recipe,phase,Ndemo,Nkeep){
 validateFirstRoundRecipe(recipe);
 if(isFirstRoundR2Recipe(recipe)){
  if(!Number.isSafeInteger(Ndemo)||Ndemo<1||Nkeep!==Ndemo)throw Error('first_round_r2_sample_count');
  if(!['calibration','formal'].includes(phase))throw Error('first_round_phase');
  const Uepoch=Math.ceil(Ndemo/recipe.demoBatch);
  return {Uepoch,maxOptimizerSteps:phase==='calibration'?1:null,milestoneUpdates:phase==='calibration'?[0,1]:null,observationEveryUpdates:Uepoch,stoppingRule:FIRST_ROUND_R2_STOPPING_RULE};
 }
 if(!Number.isSafeInteger(Ndemo)||Ndemo<1||Ndemo>16||Nkeep!==Ndemo)throw Error('first_round_sample_count');
 if(!['calibration','formal'].includes(phase))throw Error('first_round_phase');
 return{Uepoch:1,maxOptimizerSteps:phase==='calibration'?1:64,milestoneUpdates:phase==='calibration'?[0,1]:[0,16,32,64]};
}

/** The new dose is fixed: a finite midpoint loss increase or poor play never
 * authorizes restart. The unchanged legacy contract retains its old trigger. */
export function firstRoundRecoveryTriggerAllowed(recipe,trigger){
 if(isFirstRoundRecipe(recipe)){validateFirstRoundRecipe(recipe);return trigger==='diagnosed_numerical_divergence';}
 return ['diagnosed_numerical_divergence','first_epoch_demo_and_keep_increase'].includes(trigger);
}

/** A natural full-data pass is an observation unit, never a total run quota. */
export const FIRST_ROUND_R2_RECIPE_ID='first-round-common-view-learning-v2';
export const FIRST_ROUND_R2_STOPPING_RULE='first-round-common-view-learning-stop-v1';
export const FIRST_ROUND_R2_RECIPE=Object.freeze({
 recipeId:FIRST_ROUND_R2_RECIPE_ID,optimizer:'RMSprop',alpha:.9,eps:1e-5,momentum:0,centered:false,weightDecay:0,
 learningRate:1e-4,temperature:1,keepWeight:1,demoBatch:32,keepBatch:32,calibrationUpdates:1,
 observationUnit:'complete-dataset-epoch',stoppingRule:FIRST_ROUND_R2_STOPPING_RULE,initialization:'fixed-parent-new-optimizer',
});
export const isFirstRoundR2Recipe=value=>value?.recipeId===FIRST_ROUND_R2_RECIPE_ID;
export function validateFirstRoundR2Recipe(value){
 if(!value||![1e-4,3e-5].includes(value.learningRate)||!isDeepStrictEqual(value,{...FIRST_ROUND_R2_RECIPE,learningRate:value.learningRate}))throw Error('unsupported_first_round_r2_recipe');
 return value;
}
const r2Directions=['pass','takeover'];
function learningMetricValid(m){
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 return m&&finite(m.demoCE)&&m.demoCE>=0&&finite(m.keepKL)&&Number.isSafeInteger(m.greedyChangedCount)&&m.greedyChangedCount>=0&&
  m.train&&finite(m.train.demoCE)&&m.train.demoCE>=0&&finite(m.train.totalObjective)&&r2Directions.every(d=>{
   const v=m.directionMetrics?.[d];return v&&finite(v.demoCE)&&v.demoCE>=0&&Number.isSafeInteger(v.count)&&v.count>0&&Array.isArray(v.sourceFamilyIds)&&new Set(v.sourceFamilyIds).size>1;
  });
}
/** Frozen scientific observation rule. No holdout/whole-match outcomes enter.
 * A stop reports this run's evidence, not proof that learning is impossible. */
export function decideFirstRoundR2Learning({baseline,previous,current,weightsChanged}){
 const stop=reason=>({schema:FIRST_ROUND_R2_STOPPING_RULE,decision:'diagnostic_stop',reason});
 if(![baseline,previous,current].every(learningMetricValid))return stop('invalid_or_nonfinite_learning_observation');
 if(r2Directions.some(d=>[previous,current].some(m=>m.directionMetrics[d].count!==baseline.directionMetrics[d].count||!isDeepStrictEqual([...m.directionMetrics[d].sourceFamilyIds].sort(),[...baseline.directionMetrics[d].sourceFamilyIds].sort()))))return stop('learning_observation_population_changed');
 if(weightsChanged!==true)return stop('weights_unchanged');
 if(current.train.demoCE>=previous.train.demoCE)return stop('no_training_progress');
 const eligible=current.demoCE<baseline.demoCE&&r2Directions.every(d=>current.directionMetrics[d].demoCE<=baseline.directionMetrics[d].demoCE);
 if(current.demoCE>previous.demoCE)return stop('development_deterioration_risk');
 if(eligible&&current.greedyChangedCount>0)return{schema:FIRST_ROUND_R2_STOPPING_RULE,decision:'candidate',reason:'first_behavioral_absorption_candidate_requires_behavior_review'};
 return{schema:FIRST_ROUND_R2_STOPPING_RULE,decision:'continue',reason:'finite_training_progress_without_behavioral_candidate'};
}

/** Explicit manifest identity, never a caller-supplied permission boolean. */
export function validateFirstRoundResearchProtocol(value){
 if(!value||!isDeepStrictEqual(Object.keys(value).sort(),['id','revisionRef'])||value.id!=='first-round-common-view-r2'||typeof value.revisionRef!=='string'||!/^.+@sha256:[a-f0-9]{64}$/.test(value.revisionRef))throw Error('unsupported_first_round_research_protocol');
 return value;
}
export function isFirstRoundR2DatasetPlan(plan){
 if(plan?.researchProtocol===undefined)return false;
 validateFirstRoundResearchProtocol(plan.researchProtocol);return true;
}
/** Identity routing only; success/label quality never selects the teacher. */
export function isFirstRoundTeachingTerminalFor(terminal,teacher){
 return !!terminal&&!!teacher&&typeof teacher==='object'&&terminal.commonView?.routingRole!=='independent-review'&&isDeepStrictEqual(terminal.teacher,teacher);
}
/** Original selection order is retained for a routed secondary Task subset. */
export function firstRoundOwnedLabelRows(rows,sourcePlan,routing){
 const owned=rows.filter(r=>r.split===sourcePlan.split&&sourcePlan.familyIds.includes(r.blockFamilyId??r.familyId));
 if(routing===undefined||routing.role==='primary')return owned;
 if(!['independent-review','model-substitution'].includes(routing.role)||!Array.isArray(routing.selected))throw Error('r2_label_routing_subset');
 return owned.filter(r=>routing.selected.some(x=>isDeepStrictEqual(x.key,r.key)&&x.inputSHA256===r.inputSHA256));
}
