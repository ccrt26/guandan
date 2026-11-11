/** NAV-R16 only: a frozen independent reached-state union and descriptive Y
 * readout. These pure checks do not prove source/ledger/release authenticity;
 * the existing host must join the original files before admitting a Task.
 * Nothing here creates a training sample, teacher truth or release decision. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
const need=(ok:unknown,reason:string)=>{if(!ok)throw Error('first_round_evaluation_'+reason);};
const hash=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const text=(s:unknown)=>typeof s==='string'&&s.trim().length>0;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const order=(a:string,b:string)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
const candidatePolicy={candidateSpec:'first-target-offer12-rules-v543-v1',enumSpec:{id:'full-house-attachment-ranks-v1-rules-v543',enumerationMode:'all_supported_attachment_ranks'}};
const fixed=(s:unknown)=>typeof s==='string'&&/^.+@sha256:[a-f0-9]{64}$/.test(s);
const unique=(xs:unknown)=>Array.isArray(xs)&&xs.every(text)&&new Set(xs).size===xs.length;

/** inventory is the complete 2 policies × 3 partners × 2 sides source queue,
 * including failed/missing rows. sourceSHA256 comes from actual origin bytes;
 * caller also binds every future round family/source before calling this. */
export function selectFirstRoundNewQuestions(plan:any,inventory:any[]){
 const commonView=plan?.schema==='ohuo-common-view-new-test-selection-r2';
 need((commonView&&fixed(plan.protocolRef)||plan?.schema==='ohuo-first-round-new-test-selection-v1')&&['first-round-independent-new-test','engineering_fixture'].includes(plan.purpose),'new_test_purpose');
 need(['sourceIndexRef','comparisonRef','s0Ref','s1Ref'].every(k=>fixed(plan[k]))&&plan.s0Ref!==plan.s1Ref&&text(plan.selectionSalt),'selection_identity');
 need(unique(plan.familyIds)&&plan.familyIds.length>=1&&(commonView?plan.questionRule==='all-eligible-frozen-source-union':plan.familyIds.length<=2&&plan.maxQuestionsPerFamily===8),'fixed_new_family_cap');
 need(unique(plan.excludedFamilyIds)&&Array.isArray(plan.excludedSourceSHA256)&&plan.excludedSourceSHA256.every(hash)&&!plan.familyIds.some((f:string)=>plan.excludedFamilyIds.includes(f)),'source_independence');
 need(Array.isArray(inventory)&&inventory.length<=plan.familyIds.length*12,'source_queue_bound');
 const seen=new Set(),sources=new Map(),familyOwners=new Map(),questions=new Map<string,any>(),exclusions:any[]=[],denominators:any[]=[];
 for(const r of inventory){
  need(plan.familyIds.includes(r?.familyId)&&['S0','S1'].includes(r.reachedBy)&&[0,1,2].includes(r.group)&&[0,1].includes(r.side),'source_queue_layout');
  const layout=JSON.stringify([r.familyId,r.reachedBy,r.group,r.side]);need(!seen.has(layout),'duplicate_source_layout');seen.add(layout);
  need(['completed','incomplete','failed','unknown','missing'].includes(r.status)&&Array.isArray(r.rows),'source_status');
  if(r.sourceSHA256!==null){need(hash(r.sourceSHA256)&&!plan.excludedSourceSHA256.includes(r.sourceSHA256),'source_independence');const prior=sources.get(r.sourceSHA256);need(prior===undefined||prior===r.familyId,'source_independence');sources.set(r.sourceSHA256,r.familyId);}
  else need(r.status!=='completed','source_identity_missing');
  need(Array.isArray(r.sourceFacts)&&(r.status!=='completed'||r.sourceFacts.length>0),'future_source_facts_missing');
  for(const fact of r.sourceFacts){need(text(fact.familyId)&&hash(fact.sourceSHA256)&&!plan.excludedFamilyIds.includes(fact.familyId)&&!plan.excludedSourceSHA256.includes(fact.sourceSHA256),'future_source_independence');const prior=sources.get(fact.sourceSHA256);need(prior===undefined||prior===r.familyId,'future_source_independence');sources.set(fact.sourceSHA256,r.familyId);const familyOwner=familyOwners.get(fact.familyId);need(familyOwner===undefined||familyOwner===r.familyId,'future_source_independence');familyOwners.set(fact.familyId,r.familyId);}
  denominators.push({familyId:r.familyId,sourceFacts:structuredClone(r.sourceFacts),reachedBy:r.reachedBy,group:r.group,side:r.side,status:r.status,sourceSHA256:r.sourceSHA256,enumerated:r.rows.length});
  for(const q of r.rows){
   need(q.familyId===r.familyId&&text(q.questionId)&&hash(q.contextSHA256)&&hash(q.inputSHA256)&&['eligible','excluded'].includes(q.eligibility),'question_identity');
   if(q.eligibility==='excluded'){need(text(q.exclusionReason),'question_exclusion');exclusions.push({familyId:r.familyId,questionId:q.questionId,inputSHA256:q.inputSHA256,reason:q.exclusionReason});continue;}
   need(q.candidateSpec==='first-target-offer12-rules-v543-v1'&&equal(q.candidatePolicy,candidatePolicy)&&unique(q.candidateIds)&&q.candidateIds.length>=1&&q.candidateIds.length<=12&&unique(q.canonicalIds)&&q.canonicalIds.length===q.candidateIds.length,'candidate_identity');
   need(Array.isArray(q.features423)&&q.features423.length===q.candidateIds.length&&Array.isArray(q.proposalFeatures399)&&q.proposalFeatures399.length===q.candidateIds.length&&q.features423.every((f:any,i:number)=>Array.isArray(f)&&f.length===423&&f.every((v:any)=>finite(v)&&Math.fround(v)===v)&&equal(f.slice(0,399),q.proposalFeatures399[i])),'actual423_inputs');
   const id=digest([r.familyId,q.contextSHA256]),identity={candidateSpec:q.candidateSpec,candidatePolicy:q.candidatePolicy,canonicalIds:q.canonicalIds,features423:q.features423};let entry=questions.get(id);
   if(entry)need(equal(entry.identity,identity),'causal_input_conflict');
   else {entry={questionId:'new-test-'+id,familyId:r.familyId,contextSHA256:q.contextSHA256,identity,origins:[],reachedBy:[]};questions.set(id,entry);}
   entry.origins.push({questionId:q.questionId,inputSHA256:q.inputSHA256,reachedBy:r.reachedBy,group:r.group,side:r.side,candidateIds:q.candidateIds});if(!entry.reachedBy.includes(r.reachedBy))entry.reachedBy.push(r.reachedBy);
  }
 }
 for(const familyId of plan.familyIds)for(const reachedBy of ['S0','S1'])for(const group of [0,1,2])for(const side of [0,1])if(!seen.has(JSON.stringify([familyId,reachedBy,group,side])))denominators.push({familyId,reachedBy,group,side,status:'missing',sourceSHA256:null,enumerated:0});
 const complete=denominators.every(r=>r.status==='completed'),selected:any[]=[];
 for(const familyId of [...plan.familyIds].sort(order)){
  const union=[...questions.values()].filter(q=>q.familyId===familyId).sort((a,b)=>order(digest([plan.selectionSalt,a.questionId]),digest([plan.selectionSalt,b.questionId]))||order(a.questionId,b.questionId));
  for(const q of (commonView?union:union.slice(0,8))){q.origins.sort((a:any,b:any)=>order(JSON.stringify(a),JSON.stringify(b)));q.reachedBy.sort(order);const {identity,...metadata}=q;selected.push({...metadata,candidateSpec:identity.candidateSpec,candidatePolicy:identity.candidatePolicy,canonicalIds:identity.canonicalIds,featuresSHA256:digest(identity.features423)});}
  for(const q of (commonView?[]:union.slice(8)))exclusions.push({familyId,questionId:q.questionId,reason:'fixed_hash_cap_not_selected'});
 }
 denominators.sort((a,b)=>order(JSON.stringify([a.familyId,a.reachedBy,a.group,a.side]),JSON.stringify([b.familyId,b.reachedBy,b.group,b.side])));exclusions.sort((a,b)=>order(JSON.stringify(a),JSON.stringify(b)));
 const reasons=[...(!complete?['source_population_incomplete']:[]),...(plan.familyIds.length<2?['single_source_diagnostic_only']:[]),...(plan.purpose==='engineering_fixture'?['engineering_fixture_not_research']:[])];
 return {schema:'ohuo-first-round-new-test-selection-result-v1',plan:structuredClone(plan),questions:selected,denominators,exclusions,verification:complete?'reproduced':'incomplete',qualification:{eligible:reasons.length===0,reasons},trainingEligible:false,returnToTraining:false,researchQualified:null,sourceAuthenticity:'requires_existing_host_verified_files_and_ledger'};
}

/** Consume the unchanged evaluateTeacherBranch result: lowercase y means g+W,
 * never a probability. A missing/incomplete world is retained, not zero-filled. */
export function summarizeFirstRoundNewRoot(plan:any,results:any[]){
 need(plan?.schema==='ohuo-first-round-new-root-v1'&&text(plan.familyId)&&text(plan.questionId)&&hash(plan.inputSHA256),'root_identity');
 need(Array.isArray(plan.actions)&&plan.actions.length>=1&&plan.actions.length<=2&&unique(plan.actions.map((a:any)=>a.actionId))&&unique(plan.actions.map((a:any)=>a.canonicalId))&&plan.actions.every((a:any)=>['pass','takeover'].includes(a.direction))&&plan.actions.some((a:any)=>a.actionId===plan.s0ActionId)&&plan.actions.some((a:any)=>a.actionId===plan.s1ActionId),'actual_paired_root_actions');
 const commonView=plan.comparisonBatch?.schema==='ohuo-common-view-world-batch-r2';
 if(commonView)need(fixed(plan.comparisonBatch.protocolRef)&&equal(plan.comparisonBatch.worlds,plan.worlds)&&text(plan.comparisonBatch.precisionTarget),'frozen_world_batch');
 need(Array.isArray(plan.worlds)&&(commonView?plan.worlds.length>0:plan.worlds.length===4)&&unique(plan.worlds.map((w:any)=>w.worldId))&&plan.worlds.every((w:any)=>count(w.seed))&&new Set(plan.worlds.map((w:any)=>w.seed)).size===plan.worlds.length,'four_new_worlds');
 need(hash(plan.profileSHA256)&&Array.isArray(plan.policyIds)&&plan.policyIds.length===4&&plan.policyIds.every(text)&&Array.isArray(results)&&results.length<=plan.worlds.length*plan.actions.length,'continuation_identity');
 const rows=new Map(),layouts=new Map();
 for(const row of results){
  const w=plan.worlds.find((w:any)=>w.worldId===row?.worldId),a=plan.actions.find((a:any)=>a.actionId===row?.actionId),r=row?.result,key=JSON.stringify([row?.worldId,row?.actionId]);
  need(w&&a&&r&&!rows.has(key),'unexpected_or_duplicate_branch');
  need(r.seed===w.seed&&r.forcedActionId===a.actionId&&r.profileSHA256===plan.profileSHA256&&equal(r.policyIds,plan.policyIds)&&hash(r.initialWorldSHA256)&&r.ownPlanSummary===null,'branch_identity');
  need(!layouts.has(w.worldId)||layouts.get(w.worldId)===r.initialWorldSHA256,'paired_world_identity');layouts.set(w.worldId,r.initialWorldSHA256);
  need(typeof r.complete==='boolean','completion_unknown');
  if(r.complete)need((r.W===-1||r.W===1)&&finite(r.g)&&r.y===r.g+r.W,'complete_metric');
  else need(r.W===null&&r.y===null&&text(r.incompleteReason),'incomplete_metric');rows.set(key,r);
 }
 const values=plan.worlds.map((w:any)=>{const a=rows.get(JSON.stringify([w.worldId,plan.s0ActionId])),b=rows.get(JSON.stringify([w.worldId,plan.s1ActionId]));return{worldId:w.worldId,Y_S0:a?.complete?(a.W+1)/2:null,Y_S1:b?.complete?(b.W+1)/2:null,gPlusW_S0:a?.complete?a.y:null,gPlusW_S1:b?.complete?b.y:null,deltaY:a?.complete&&b?.complete?(b.W-a.W)/2:null};});
 const direction=(id:string)=>plan.actions.find((a:any)=>a.actionId===id).direction,a=direction(plan.s0ActionId),b=direction(plan.s1ActionId),complete=values.every((v:any)=>v.deltaY!==null);
 return{schema:'ohuo-first-round-new-root-summary-v1',familyId:plan.familyId,questionId:plan.questionId,inputSHA256:plan.inputSHA256,status:complete?'complete':'incomplete',s0ActionId:plan.s0ActionId,s1ActionId:plan.s1ActionId,direction:a===b?'unchanged_'+a:a+'_to_'+b,actionChanged:plan.s0ActionId!==plan.s1ActionId,values,meanDeltaY:complete?mean(values.map((v:any)=>v.deltaY)):null,teacherAgreementMeaning:'demonstration_transfer_not_correctness',trainingEligible:false};
}
export function summarizeFirstRoundNewTest(plan:any,roots:any[]){
 const commonView=plan?.schema==='ohuo-common-view-new-test-contract-r2';
 if(commonView)need(fixed(plan.protocolRef),'new_test_protocol');
 need(['first-round-independent-new-test','engineering_fixture'].includes(plan?.purpose)&&unique(plan.familyIds)&&plan.familyIds.length>=1&&(commonView||plan.familyIds.length<=2)&&unique(plan.questionIds)&&(commonView||plan.questionIds.length<=plan.familyIds.length*8)&&Array.isArray(roots),'new_test_readout_identity');
 need(roots.every(r=>plan.familyIds.includes(r.familyId)&&plan.questionIds.includes(r.questionId)&&r.schema==='ohuo-first-round-new-root-summary-v1'&&(r.meanDeltaY===null||finite(r.meanDeltaY)&&r.meanDeltaY>=-1&&r.meanDeltaY<=1))&&new Set(roots.map(r=>r.questionId)).size===roots.length,'new_test_fixed_denominator');
 const families=plan.familyIds.map((familyId:string)=>{const rs=roots.filter(r=>r.familyId===familyId);return{familyId,observedQuestions:rs.length,completeQuestions:rs.filter(r=>r.meanDeltaY!==null).length,meanDeltaY:rs.length&&rs.every(r=>r.meanDeltaY!==null)?mean(rs.map(r=>r.meanDeltaY)):null};});
 const complete=roots.length===plan.questionIds.length&&families.every((f:any)=>f.meanDeltaY!==null),value=complete?mean(families.map((f:any)=>f.meanDeltaY)):null;
 const directionGroups=Object.fromEntries(['pass_to_takeover','takeover_to_pass','unchanged_pass','unchanged_takeover'].map(direction=>{const rows=roots.filter(r=>r.direction===direction),means=plan.familyIds.map((f:string)=>rows.filter(r=>r.familyId===f)).filter((rs:any[])=>rs.length);return[direction,{count:rows.length,complete:rows.filter(r=>r.meanDeltaY!==null).length,meanFamilyDeltaY:rows.length&&rows.every(r=>r.meanDeltaY!==null)?mean(means.map((rs:any[])=>mean(rs.map(r=>r.meanDeltaY)))):null}];}));
 const changes=[directionGroups.pass_to_takeover,directionGroups.takeover_to_pass],negative=changes.some(x=>x.meanFamilyDeltaY!==null&&x.meanFamilyDeltaY<0),missing=changes.some(x=>x.count===0);
 return{schema:'ohuo-first-round-new-test-readout-v1',purpose:plan.purpose,plannedQuestions:plan.questionIds.length,reportedQuestions:roots.length,complete,plannedFamilies:plan.familyIds.length,families,meanFamilyDeltaY:value,directionGroups,counts:{positive:roots.filter(r=>r.meanDeltaY>0).length,negative:roots.filter(r=>r.meanDeltaY!==null&&r.meanDeltaY<0).length,unchanged:roots.filter(r=>r.meanDeltaY===0).length,incomplete:plan.questionIds.length-roots.filter(r=>r.meanDeltaY!==null).length},directionalSupport:!complete?'incomplete':plan.familyIds.length<2?'single_source_only':value!>0&&!negative?(missing?'unverified_direction':'exploratory_directional_support'):'not_supported',claim:'finite_new_questions_under_fixed_continuation_not_unique_correctness_or_full_strength',teacherAgreementMeaning:'demonstration_transfer_not_correctness',trainingEligible:false,returnToTraining:false};
}
/** NAV-R11 fixed precision calculation, used before confirmation outcomes.
 * The caller binds costs/budget and freezes returned N in the approved queue. */
export function planFirstRoundConfirmation(x:any){
 need(count(x?.pilotBlocks)&&x.pilotBlocks<=4,'variance_pilot_cap');
 need((x.sPlan===null||finite(x.sPlan)&&x.sPlan>=0)&&finite(x.reservedSeconds)&&x.reservedSeconds>=0&&finite(x.slowestBlockSeconds)&&x.slowestBlockSeconds>0&&count(x.remainingMatchAttempts),'precision_inputs');
 const sPlan=x.sPlan===null||x.sPlan===0?1:x.sPlan,h=.05,N_precision=Math.ceil((1.96*sPlan/h)**2),N_budget=Math.min(8,Math.floor(x.reservedSeconds/x.slowestBlockSeconds),Math.floor(x.remainingMatchAttempts/12)),N=Math.min(N_precision,N_budget);
 return{schema:'ohuo-first-round-confirmation-planning-v1',sPlan,h,confidence:.95,N_precision,N_budget,N,exploratory:N<N_precision,intervalEligible:N>=2,pilotBlocks:x.pilotBlocks,pilotIncluded:false,gamesPerBlock:12,metric:'mean_over_families_mean_over_six_pairs_Y_S1_minus_Y_S0',outcomePeekingAllowed:false,automaticExpansionAllowed:false};
}

/** Fixed-N r2 planning from an independently evidenced variance estimate.
 * No cost/time/number cap substitutes for scientific precision. An absent or
 * degenerate estimate is not silently turned into zero or a success claim. */
export function planCommonViewConfirmation(x:any){
 need(count(x?.pilotBlocks)&&x.pilotBlocks>=2&&finite(x.sPlan)&&x.sPlan>0&&fixed(x.varianceEvidenceRef),'independent_positive_variance_estimate_required');
 const h=.05,confidence=.95,N_precision=Math.max(2,Math.ceil((1.96*x.sPlan/h)**2));need(Number.isSafeInteger(N_precision),'precision_input_range');
 return{schema:'ohuo-common-view-confirmation-planning-r2',sPlan:x.sPlan,varianceEvidenceRef:x.varianceEvidenceRef,h,confidence,N_precision,N:N_precision,exploratory:false,intervalEligible:true,pilotBlocks:x.pilotBlocks,pilotIncluded:false,gamesPerBlock:12,metric:'mean_over_families_mean_over_six_pairs_Y_S1_minus_Y_S0',outcomePeekingAllowed:false,automaticExpansionAllowed:false};
}

/** Explicit first-round envelope around the unchanged B08 projection. B08's
 * Number(winner===side) is exactly normalized Y=(W+1)/2; do not feed ±1 W or
 * g+W into it. The host authenticates original public journals/source facts. */
export async function summarizeFirstRoundMatches(c:any,pairedPlan:any,queue:any,index:any,attempts:any[]){
 const commonView=c?.schema==='ohuo-common-view-confirmation-r2';
 need((commonView&&fixed(c.protocolRef)||c?.schema==='ohuo-first-round-confirmation-v1')&&['first-round-confirmation','engineering_fixture'].includes(c.purpose)&&fixed(c.s0Ref)&&fixed(c.s1Ref)&&c.s0Ref!==c.s1Ref,'confirmation_identity');
 need(unique(c.familyIds)&&c.familyIds.length>=1&&(commonView||c.familyIds.length<=8)&&unique(c.pilotFamilyIds)&&(commonView||c.pilotFamilyIds.length<=4)&&unique(c.excludedFamilyIds)&&Array.isArray(c.excludedSourceSHA256)&&c.excludedSourceSHA256.every(hash),'confirmation_fixed_families');
 need(!c.familyIds.some((f:string)=>c.pilotFamilyIds.includes(f)||c.excludedFamilyIds.includes(f)),'confirmation_source_independence');
 need(unique(c.partnerRefs)&&c.partnerRefs.length===3&&c.partnerRefs.every(fixed),'confirmation_fixed_partners');
 const planning=commonView?planCommonViewConfirmation(c.planningInputs):planFirstRoundConfirmation(c.planningInputs);
 need(equal(c.planning,planning)&&planning.N===c.familyIds.length&&c.planningInputs.pilotBlocks===c.pilotFamilyIds.length,'confirmation_prefrozen_N');
 need(['accepted','pending','rejected'].includes(c.necessaryBehaviorStatus)&&Array.isArray(c.sourceFacts),'confirmation_source_facts');
 const sourceOwners=new Map(),familyOwners=new Map();
 for(const fact of c.sourceFacts){
  need(c.familyIds.includes(fact?.blockFamilyId)&&text(fact.sourceFamilyId)&&hash(fact.sourceSHA256)&&!c.pilotFamilyIds.includes(fact.sourceFamilyId)&&!c.excludedFamilyIds.includes(fact.sourceFamilyId)&&!c.excludedSourceSHA256.includes(fact.sourceSHA256),'confirmation_source_independence');
  need((!sourceOwners.has(fact.sourceSHA256)||sourceOwners.get(fact.sourceSHA256)===fact.blockFamilyId)&&(!familyOwners.has(fact.sourceFamilyId)||familyOwners.get(fact.sourceFamilyId)===fact.blockFamilyId),'confirmation_source_independence');sourceOwners.set(fact.sourceSHA256,fact.blockFamilyId);familyOwners.set(fact.sourceFamilyId,fact.blockFamilyId);
 }
 need(pairedPlan?.schema==='ohuo-paired-plan-v1'&&pairedPlan.comparison==='S-B'&&pairedPlan.question==='student_match'&&pairedPlan.variantB==='S0'&&pairedPlan.variantCandidate==='S1'&&pairedPlan.split==='confirm'&&pairedPlan.metric==='team_complete_match_Y'&&equal(pairedPlan.familyIds,c.familyIds),'confirmation_B08_named_contract');
 need(Array.isArray(queue?.rows)&&queue.rows.length===12*c.familyIds.length&&Array.isArray(attempts),'confirmation_twelve_game_blocks');
 for(const r of queue.rows)need(c.familyIds.includes(r.sourceFamilyId)&&r.maxGames===80&&r.maxMovesPerGame===2500&&[0,1].includes(r.actor)&&r.actor===r.side&&r.seats?.length===4&&r.seats.every((s:any)=>s.mode==='local'&&s.profileRevisionRef===null)&&r.seats[(r.actor+2)%4].releaseRef===c.partnerRefs[r.group]&&r.seats[r.actor].releaseRef===(r.variant==='S0'?c.s0Ref:r.variant==='S1'?c.s1Ref:null),'confirmation_actual_composite_layout');
 const sourceFactGaps:string[]=[];const facts=attempts.map(a=>{const q=queue.rows.find((r:any)=>r.matchId===a.matchId),missing=q&&a.actualRoundFamilies?.some((family:string)=>!c.sourceFacts.some((f:any)=>f.blockFamilyId===q.sourceFamilyId&&f.sourceFamilyId===family));if(missing)sourceFactGaps.push(a.matchId);return missing?{...a,issues:[...a.issues,'actual_source_bytes_unverified']}:a;});
 const {summarizePaired}=await import('./paired-summary');
 const paired=summarizePaired(pairedPlan,queue,index,facts);
 return{schema:'ohuo-first-round-match-readout-v1',purpose:c.purpose,comparison:'S1-S0',s0Ref:c.s0Ref,s1Ref:c.s1Ref,planning,necessaryBehaviorStatus:c.necessaryBehaviorStatus,sourceFactGaps,paired,interval:null,intervalStatus:paired.primary.intervalStatus,metric:'Y=(W+1)/2; d_block=mean_of_six_paired_Y_differences',confidence:0.95,limitedEvidence:true,smallBlockCountReview:'required_at_endpoint',strengthConfirmed:false,adoptionGateSatisfied:null,automaticDeploymentAllowed:false,qualification:c.necessaryBehaviorStatus==='rejected'?'do_not_adopt_necessary_behavior_failure':'pending_interval',trainingEligible:false,automaticExpansionAllowed:false,pilotIncluded:false};
}
/** Only an original, identity-checked B08 20k/type7 result can enter this
 * readout. No statistical kernel is reimplemented or selected after results. */
export function attachFirstRoundMatchInterval(readout:any,stats:any){
 const input=readout?.paired?.primary?.input,n=input?.unitIds?.length;
 need(readout?.schema==='ohuo-first-round-match-readout-v1'&&n>=2&&stats?.implementation==='r6-paired-percentile-type7-20k-v1'&&stats.replicates===20000&&stats.independentUnits===n&&stats.seed===input.seed&&equal(stats.probabilities,[.025,.975])&&stats.method==='percentile'&&stats.interpolation==='R_type_7_linear'&&stats.sharedResamplingIndicesAcrossColumns===true&&stats.sourceSHA256==='839cef71e9ebdf527a383098700e29b857134e5545d5094e330dbd258d529049'&&stats.inputSHA256===createHash('sha256').update(JSON.stringify(input)+'\n').digest('hex')&&stats.unitIdsSHA256===digest([...input.unitIds].sort(order))&&finite(stats.columns?.macro?.point)&&Math.abs(stats.columns.macro.point-readout.paired.primary.point)<=16*Number.EPSILON,'frozen_B08_interval_identity');
 const q=stats.columns.macro.quantiles;need(Array.isArray(q)&&q.length===2&&q.every(finite)&&q[0]>=-1&&q[1]<=1&&q[0]<=q[1],'normalized_interval');
 const allComplete=readout.paired.actual.completeBlocks===readout.planning.N,degenerate=q[0]===q[1];
 const qualification=readout.necessaryBehaviorStatus==='rejected'?'do_not_adopt_necessary_behavior_failure':!allComplete?'incomplete_planned_confirmation':q[1]<0?'do_not_adopt_negative_interval':readout.necessaryBehaviorStatus==='pending'?'pending_necessary_behavior_review':q[0]>0?(readout.planning.exploratory||degenerate?'exploratory_signal_strength_unconfirmed':'pending_endpoint_review'):'unresolved_not_equivalent';
 // Predeclared precision shortfall or degenerate bootstrap stays exploratory.
 // Otherwise a positive interval goes to endpoint small-N/evidence review;
 // this module neither invents a numerical adoption threshold nor deploys.
 return{...readout,interval:stats,intervalStatus:'reported',qualification,degenerateBootstrap:degenerate,precisionMet:(q[1]-q[0])/2<=readout.planning.h,limitedEvidence:true,strengthConfirmed:false,adoptionGateSatisfied:null,automaticDeploymentAllowed:false};
}
export async function runFirstRoundMatchInterval(readout:any,output:string,pythonPath:string){
 need(readout?.schema==='ohuo-first-round-match-readout-v1','match_readout_required');
 if(readout.paired.primary.independentBlocks<2)return{...readout,intervalStatus:'insufficient_complete_blocks',qualification:'no_interval_or_adoption_judgment'};
 const {runFrozenInterval}=await import('./paired-summary');
 return attachFirstRoundMatchInterval(readout,runFrozenInterval(readout.paired.primary.input,output,pythonPath));
}

/** Independent GLM provisional labels are descriptive transfer diagnostics.
 * Host authenticates the original label terminal and independent hard-check
 * record; missing/excluded/failed facts retain the frozen planned denominator.
 * This function cannot qualify labels for CE or call either provider. */
export function summarizeFirstRoundTeacherTransfer(plan:any,rows:any[]){
 need(unique(plan?.questionIds)&&(plan.protocolRef&&fixed(plan.protocolRef)||plan.questionIds.length<=16)&&Array.isArray(rows)&&rows.length<=plan.questionIds.length,'teacher_transfer_population');
 const seen=new Set(),valid:any[]=[],counts={excluded:0,failed:0,unknown:0};
 const evidence=(r:any)=>r&&typeof r.id==='string'&&r.id.length&&hash(r.sha256);
 for(const r of rows){
  need(plan.questionIds.includes(r?.questionId)&&!seen.has(r.questionId)&&hash(r.inputSHA256)&&['provisional','excluded','failed','unknown'].includes(r.status),'teacher_transfer_identity');seen.add(r.questionId);
  if(r.status!=='provisional'){counts[r.status as keyof typeof counts]++;continue;}
  need(unique(r.candidateIds)&&r.candidateIds.length>=1&&r.candidateIds.length<=12&&[r.s0ActionId,r.s1ActionId,r.teacherActionId].every(id=>r.candidateIds.includes(id))&&evidence(r.labelTerminalRef)&&evidence(r.hardCheckRef),'teacher_transfer_hard_checks');valid.push(r);
 }
 counts.unknown+=plan.questionIds.length-rows.length;
 const agreement=(key:string)=>({agreements:valid.filter(r=>r[key]===r.teacherActionId).length,denominator:valid.length,rate:valid.length?valid.filter(r=>r[key]===r.teacherActionId).length/valid.length:null});
 return{schema:'ohuo-first-round-teacher-transfer-v1',plannedQuestions:plan.questionIds.length,provisionalQuestions:valid.length,excludedQuestions:counts.excluded,failedQuestions:counts.failed,unknownQuestions:counts.unknown,S0:agreement('s0ActionId'),S1:agreement('s1ActionId'),meaning:'demonstration_transfer_not_correctness',teacherGroundTruth:false,trainingEligible:false,returnToTraining:false};
}

/** Extra R16 source check over the SAME fixed public bytes accepted by B08.
 * Original B08 retains incomplete/invalid records. Valid records must also
 * bind each actual game-state SHA to its declared block/family fact. No replay,
 * private source, source sampling or statistical reimplementation is involved. */
export async function readFirstRoundPublicSourceFacts(path:string,expectedSHA256:string,queue:any,declared:any[]){
 const [{readFixedJSON,readB07Run},{readFileSync,realpathSync},{dirname,join,resolve}]=await Promise.all([import('./paired-summary'),import('node:fs'),import('node:path')]);
 const original=readB07Run(path,expectedSHA256),run=readFixedJSON(path,expectedSHA256),runRoot=realpathSync(dirname(path)),facts:any[]=[],unknownRecords:any[]=[];
 const entries=[...run.matches,...(run.activeMatch?[{matchId:run.activeMatch.matchId,recordRef:run.activeMatch.recordRef,active:true}]:[])];
 need(entries.length===original.attempts.length,'actual_source_attempt_inventory');
 for(let i=0;i<entries.length;i++){
  const entry=entries[i],attempt=original.attempts[i];
  if(!attempt.recordVerified){unknownRecords.push({runId:run.runId,matchId:entry.matchId,issues:attempt.issues});continue;}
  const q=queue.rows.find((q:any)=>q.matchId===entry.matchId);need(q&&Array.isArray(q.roundFamilyIds),'actual_source_queue');
  const ref=entry.recordRef,dir=resolve(ref.directory);need(dir.startsWith(runRoot+'/matches/')&&realpathSync(dir)===dir,'actual_source_record_path');
  const idPath=join(dir,'identity.json'),eventsPath=join(dir,'events.jsonl');need(realpathSync(idPath)===idPath&&realpathSync(eventsPath)===eventsPath,'actual_source_record_symlink');
  const idBytes=readFileSync(idPath),bytes=readFileSync(eventsPath),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
  need(sha(idBytes)===ref.identitySHA256&&sha(bytes)===ref.journalSHA256&&bytes.length===ref.journalBytes,'actual_source_record_changed');
  const identity=JSON.parse(idBytes.toString());need(identity.runId===run.runId&&identity.matchId===entry.matchId&&identity.sourceFamilyId===q.sourceFamilyId&&identity.layoutRef===run.queueRef,'actual_source_record_identity');
  const games=bytes.toString().split('\n').filter(Boolean).map((line:string)=>JSON.parse(line)).filter((event:any)=>event.type==='game').map((event:any)=>event.value);
  need(equal(games.map((g:any)=>g.sourceFamilyId),attempt.actualRoundFamilies),'actual_source_projection_changed');
  for(let n=0;n<games.length;n++){
   const g=games[n];need(g.gameNo===n+1&&g.sourceFamilyId===q.roundFamilyIds[n]&&hash(g.sourceSHA256),'actual_source_fact_identity');
   need(declared.some((f:any)=>f.blockFamilyId===q.sourceFamilyId&&f.sourceFamilyId===g.sourceFamilyId&&f.sourceSHA256===g.sourceSHA256),'actual_source_fact_mismatch');
   facts.push({runId:run.runId,matchId:entry.matchId,gameNo:g.gameNo,blockFamilyId:q.sourceFamilyId,sourceFamilyId:g.sourceFamilyId,sourceSHA256:g.sourceSHA256,recordRef:attempt.recordRef});
  }
 }
 return{facts,unknownRecords,original};
}

/** The original Task freezes this projection BEFORE confirmation outcomes.
 * Actual journal state hashes and behavior conclusions are separate evidence;
 * neither can be edited into a replacement planning rule after observation. */
export function firstRoundConfirmationRule(c:any,p:any){
 return{schema:'ohuo-first-round-confirmation-rule-v1',...(c.schema==='ohuo-common-view-confirmation-r2'?{protocolRef:c.protocolRef}:{}),confirmation:Object.fromEntries(['purpose','s0Ref','s1Ref','partnerRefs','familyIds','pilotFamilyIds','excludedFamilyIds','excludedSourceSHA256','planningInputs','planning'].map(k=>[k,structuredClone(c[k])])),pairedAnalysis:{...Object.fromEntries(['seed','statisticName','metric','analysisUnit','analysisMethod','variantB','variantCandidate','layoutIdentitySHA256'].map(k=>[k,structuredClone(p[k])])),queueRef:structuredClone(p.refs.queue),sourceIndexRef:structuredClone(p.refs.sourceIndex)}};
}

/** Execution release identity is NOT the migrated scorer parent identity.
 * Likewise Task source allocation includes all future families, not only the
 * root blocks used as independent statistical units. No model is loaded. */
export async function validateFirstRoundConfirmationIdentities(c:any,queue:any,t:any,s0:any,s1:any){
 const {digest:canonicalDigest}=await import('./task-schema.mjs');
 const families=[...new Set(queue.rows.flatMap((r:any)=>r.roundFamilyIds))].sort(order),blocks=[...new Set(queue.rows.map((r:any)=>r.sourceFamilyId))].sort(order);
 need(unique(t.sourcePlan.familyIds)&&equal([...t.sourcePlan.familyIds].sort(order),families)&&equal([...c.familyIds].sort(order),blocks),'readout_original_task_ancestry');
 need(s0?.schema==='ohuo-first-round-s0-release-ref-v1'&&fixed(s0.proposalRef)&&fixed(s0.studentParentRef)&&s0.policyId==='first-round-s0-'+canonicalDigest({proposalRef:s0.proposalRef,studentParentRef:s0.studentParentRef}).slice(0,16)&&s1?.schema==='ohuo-student-release-first-round-v3'&&s1.proposalRef===s0.proposalRef&&s1.learningParent?.ref===s0.studentParentRef,'readout_selected_student_composite');
}

/** Reuse the original evidence catalog and original Task/control bindings.
 * This is not a new receipt or acceptance authority. Invalid/missing original
 * package authority remains explicitly pending, even if descriptive Y exists. */
async function firstRoundReadoutBindings(c:any,p:any,e:any,summary:any,observedRuns:any[],inventory:any,queue:any){
 const [{validateHandoffBindings},{readFixedJSON},{digest:canonicalDigest},{readFileSync}]=await Promise.all([import('./research-evidence'),import('./paired-summary'),import('./task-schema.mjs'),import('node:fs')]);
 const originalSummary={...summary,sourceInputs:{analysisPlan:{sha256:e.plan.sha256},queue:p.refs.queue,sourceIndex:p.refs.sourceIndex,runInventory:{sha256:e.runInventory.sha256},runs:inventory.runs.map((r:any)=>({runId:r.runId,sha256:r.sha256}))},runFacts:observedRuns};
 const bindings=validateHandoffBindings(p,originalSummary,e.facts);
 const file=(ref:any)=>{
  let matches:any[];
  if(typeof ref==='string'){
   need(fixed(ref),'readout_original_canonical_reference');const id=ref.slice(0,ref.lastIndexOf('@sha256:')),h=ref.slice(ref.lastIndexOf(':')+1);
   matches=bindings.files.filter((f:any)=>(f.id===id||f.id===ref)&&canonicalDigest(readFixedJSON(f.localPath,f.sha256))===h);
  }else matches=bindings.files.filter((f:any)=>f.id===ref?.id&&f.sha256===ref?.sha256);
  need(matches.length===1,'readout_original_catalog_reference');return matches[0];
 },json=(ref:any)=>{const f=file(ref);return readFixedJSON(f.localPath,f.sha256);};
 const condition=e.facts.requiredEvidence.find((r:any)=>r.id==='conditions');
 need(condition?.status==='received'&&equal(condition.source,p.refs.conditions),'readout_frozen_conditions_reference');
 const rule=json(p.refs.conditions);need(equal(rule,firstRoundConfirmationRule(c,p)),'readout_frozen_conditions_projection');
 // These are actual original Tasks from the B08 catalog, not synthetic Tasks
 // assembled by this adapter. Unknown original context never becomes trusted.
 const tasks=bindings.tasks.filter((t:any)=>t.seatLayoutPlan===p.refs.queue.id);
 for(const t of tasks){
  need(t.taskKind==='evaluate'&&t.sourcePlan.split==='confirm'&&t.releaseRefs.includes(c.s0Ref)&&t.releaseRefs.includes(c.s1Ref)&&equal(json(t.scientificContract.readoutRuleRef),rule),'readout_original_task_frozen_rule');
 }
 const sourceTaskIds=new Set(tasks.map((t:any)=>t.taskId));
 need(observedRuns.every(r=>sourceTaskIds.has(r.taskId)),'readout_original_confirmation_task_missing');
 // The status is from the original R15 review for the EXACT selected S1
 // checkpoint, with its nonempty named evidence. It is not teacher agreement.
 const taskRelease=json(c.s1Ref);need(taskRelease.schema==='ohuo-student-task-release-v1'&&hash(taskRelease.releaseSHA256),'readout_selected_student_reference');
 const releases=bindings.files.filter((f:any)=>f.sha256===taskRelease.releaseSHA256);need(releases.length>=1,'readout_selected_student_bytes');
 const release=readFixedJSON(releases[0].localPath,releases[0].sha256);need(release.schema==='ohuo-student-release-first-round-v3'&&release.policyId===taskRelease.policyId,'readout_selected_student_identity');
 const s0=json(c.s0Ref);for(const t of tasks)await validateFirstRoundConfirmationIdentities(c,queue,t,s0,release);
 const selection=json(release.selection),training=json(selection.summary),review=json(selection.behaviorReview),behavior=e.facts.requiredEvidence.find((r:any)=>r.id==='behaviorRegression');
 need(selection.schema==='ohuo-student-selection-v1'&&selection.rule===(c.schema==='ohuo-common-view-confirmation-r2'?'r2-first-dev-behavioral-candidate':'nav-r15-first-round-unique-checkpoint')&&selection.status==='selected'&&selection.selected?.manifestSHA256===release.checkpoint?.sha256&&training.schema==='ohuo-supervised-summary-v1'&&training.plan?.phase==='formal'&&training.actual?.realTraining===true&&(c.schema==='ohuo-common-view-confirmation-r2'?training.plan.recipe?.recipeId==='first-round-common-view-learning-v2'&&training.plan.stoppingRule==='first-round-common-view-learning-stop-v1'&&training.actual.learningObservation?.decision==='candidate'&&count(training.actual.optimizerSteps)&&training.actual.optimizerSteps>0:training.actual.optimizerSteps===64)&&review.schema==='ohuo-distill-behavior-review-v1'&&review.taskSHA256===training.taskSHA256&&Array.isArray(review.reviews),'readout_original_R15_identity');
 need(behavior?.status==='received'&&equal(behavior.source,selection.behaviorReview),'readout_original_behavior_reference');
 const reviews=review.reviews.filter((r:any)=>r.checkpointSHA256===release.checkpoint.sha256);need(reviews.length===1&&reviews[0].status===c.necessaryBehaviorStatus,'readout_original_behavior_status');
 const behaviorFile=file(reviews[0].evidence);need(readFileSync(behaviorFile.localPath).toString('utf8').trim().length>0,'readout_original_behavior_evidence');
 const required=['planContext','priorDecision','acceptedProgram','allTaskRuns','selectionHistory','sourceIndex'];
 const missing=required.filter(id=>e.facts.requiredEvidence.find((r:any)=>r.id===id)?.status!=='received'),issues=bindings.issues.filter((i:any)=>required.includes(i.evidenceId));
 const originalAuthorityComplete=tasks.length>0&&missing.length===0&&issues.length===0;
 return{schema:'ohuo-first-round-readout-bindings-v1',frozenConditionsRef:p.refs.conditions,originalTaskIds:tasks.map((t:any)=>t.taskId),behaviorReviewRef:selection.behaviorReview,behaviorEvidenceRef:reviews[0].evidence,selectedCheckpointSHA256:release.checkpoint.sha256,originalAuthorityComplete,missingOriginalBindings:missing,originalBindingIssues:issues,scientificAcceptance:'pending_endpoint_review',automaticDeploymentAllowed:false};
}

/** One explicit read-only R16 entry around the ORIGINAL B08 six-field input.
 * Preflight uses the exact same journal projection; original rebuildEvidence
 * performs the only bootstrap and package write. No runner/model/API imported. */
export async function rebuildFirstRoundEvidence(spec:any,output:string,pythonPath:string){
 need(spec?.schema==='ohuo-first-round-readout-input-v1'&&spec.contract&&spec.evidence&&Object.keys(spec).sort().join(',')==='contract,evidence,schema'&&typeof output==='string'&&typeof pythonPath==='string'&&pythonPath.length>0,'readout_input');
 const file=(f:any)=>need(f&&Object.keys(f).sort().join(',')==='path,sha256'&&text(f.path)&&hash(f.sha256),'readout_input_file');
 file(spec.contract);const e=spec.evidence;need(Object.keys(e).sort().join(',')==='facts,plan,queue,runInventory,runs,sourceIndex'&&Array.isArray(e.runs),'readout_input_original_B08');
 for(const f of [e.plan,e.queue,e.sourceIndex,e.runInventory,...e.runs])file(f);
 const [{readFixedJSON,readB07Run},{checkedOutput},{existsSync,readFileSync,writeFileSync},{join}]=await Promise.all([import('./paired-summary'),import('../../scripts/project-paths.mjs'),import('node:fs'),import('node:path')]);
 output=checkedOutput(output);need(!existsSync(output),'readout_fresh_output_required');
 const contract=readFixedJSON(spec.contract.path,spec.contract.sha256),plan=readFixedJSON(e.plan.path,e.plan.sha256),queue=readFixedJSON(e.queue.path,e.queue.sha256),index=readFixedJSON(e.sourceIndex.path,e.sourceIndex.sha256),inventory=readFixedJSON(e.runInventory.path,e.runInventory.sha256);
 need(e.queue.sha256===plan.refs?.queue?.sha256&&e.sourceIndex.sha256===plan.refs?.sourceIndex?.sha256&&inventory.schema==='ohuo-run-inventory-v1'&&Array.isArray(inventory.runs)&&new Set(inventory.runs.map((r:any)=>r.runId)).size===inventory.runs.length&&equal(inventory.runs.map((r:any)=>r.sha256).sort(),e.runs.map((r:any)=>r.sha256).sort()),'readout_original_inventory');
 const attempts:any[]=[],unavailable:any[]=[],publicSourceFacts:any[]=[],unknownSourceRecords:any[]=[],observedRuns:any[]=[];
 for(const f of e.runs){
  let r:any;try{r=readB07Run(f.path,f.sha256);need(inventory.runs.some((i:any)=>i.runId===r.run.runId&&i.sha256===f.sha256),'readout_original_run_identity');}catch{unavailable.push(f.sha256);continue;}
  // Source mismatch must not be caught and relabeled as an unavailable run.
  const sources=await readFirstRoundPublicSourceFacts(f.path,f.sha256,queue,contract.sourceFacts);need(equal(sources.original,r),'readout_original_public_bytes_changed');
  attempts.push(...r.attempts);observedRuns.push(r.run);publicSourceFacts.push(...sources.facts);unknownSourceRecords.push(...sources.unknownRecords);
 }
 if(unavailable.length)for(const a of attempts)a.issues.push('all_attempts_inventory_incomplete');
 let readout=await summarizeFirstRoundMatches(contract,plan,queue,index,attempts);
 // A supplied future-source fact gap is not licensed by a valid old B08 plan.
 // Stop before its kernel rather than compute a stronger different population.
 need(readout.sourceFactGaps.length===0,'readout_source_fact_gap');
 const originalBindings=await firstRoundReadoutBindings(contract,plan,e,readout.paired,observedRuns,inventory,queue);
 const {rebuildEvidence}=await import('./research-evidence');
 const original=rebuildEvidence(e,output,pythonPath);
 need(equal(readout.paired.primary.input,original.summary.primary.input)&&equal(readout.paired.blocks,original.summary.blocks)&&original.summary.actual.completeBlocks===readout.paired.actual.completeBlocks,'readout_original_B08_projection_changed');
 readout=original.summary.primary.interval?attachFirstRoundMatchInterval(readout,original.summary.primary.interval):{...readout,intervalStatus:'insufficient_complete_blocks',qualification:'no_interval_or_adoption_judgment'};
 const summaryBytes=readFileSync(join(output,'summary.json'));
 const final={...readout,paired:original.summary,publicSourceFacts,unknownSourceRecords,originalBindings,sourceInputs:{contract:spec.contract,pairedPlan:e.plan,queue:e.queue,sourceIndex:e.sourceIndex,runInventory:e.runInventory},originalEvidence:{summarySHA256:createHash('sha256').update(summaryBytes).digest('hex'),manifest:original.manifest},...(original.manifest.completeness!=='complete'?{qualification:'incomplete_original_evidence_package'}:{}),...(!originalBindings.originalAuthorityComplete?{qualification:'pending_original_authority_bindings'}:{}),automaticDeploymentAllowed:false};
 const path=join(output,'first-round-readout.json'),bytes=JSON.stringify(final)+'\n';writeFileSync(path,bytes,{flag:'wx',mode:0o600});
 return{readout:final,manifest:original.manifest,readoutRef:{path,sha256:createHash('sha256').update(bytes).digest('hex')}};
}

// Named opt-in entry only. Legacy B08 CLI and every default remain untouched.
if(process.argv[1]&&new URL(import.meta.url).pathname===(await import('node:path')).resolve(process.argv[1])){
 const a=process.argv.slice(2);need(a.length===6&&a[0]==='--input'&&a[2]==='--output'&&a[4]==='--python','readout_usage_input_output_existing_python');
 const {readFileSync}=await import('node:fs'),result=await rebuildFirstRoundEvidence(JSON.parse(readFileSync(a[1],'utf8')),a[3],a[5]);
 console.log(JSON.stringify({schema:result.readout.schema,readoutRef:result.readoutRef,completeBlocks:result.readout.paired.actual.completeBlocks,qualification:result.readout.qualification,engineeringStatus:'readout_only_not_release'}));
}
