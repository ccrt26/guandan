/** Synthetic semantic portion of the one round-contract case; no freeze/label. */
import assert from 'node:assert/strict';
import {balanceFirstRoundFrozenKeep} from '../distill-data.ts';
import {firstRoundCoverage,findFirstRoundLabelConflicts} from '../first-round-qualification.mjs';
export function checkFirstRoundQualification(){
 const families=['train-a','train-b','dev-a','dev-b'].map((sourceFamily,i)=>({sourceFamily,split:i<2?'train':'dev'})),samples=[];
 for(const f of families)for(const [i,direction] of ['pass','takeover'].entries()){
  const base={decisionId:f.sourceFamily+'-'+i,contextSHA256:f.sourceFamily+'-'+i,sourceFamily:f.sourceFamily,split:f.split,sampleClass:'target',candidateSpecRef:'first-target-offer12-v1',candidateIds:['a','b'],candidateCanonicalIds:['pass','takeover-physical'],candidateFeatures:[Array(423).fill(0),Array(423).fill(1)],evidenceGrade:'provisional_screened',targetIds:[i?'b':'a']};
  samples.push({...base,sampleKind:'demo'});samples.push({...base,decisionId:base.decisionId+'-keep',contextSHA256:base.contextSHA256+'-keep',sampleKind:'keep',sampleClass:'ordinary',evidenceGrade:undefined,targetIds:undefined});
 }
 const eligible=firstRoundCoverage(samples,families);assert.equal(eligible.eligible,true);assert.equal(eligible.Ndemo,4);assert.equal(eligible.Nkeep,4);assert.equal(eligible.gradeCounts.provisional_screened,8);
 const extra={...samples.find(s=>s.sampleKind==='keep'&&s.split==='train'),decisionId:'unused-frozen-keep',contextSHA256:'unused-frozen-keep'},afterScreen=[...samples,extra],metadata=afterScreen.map((s,rank)=>({decisionId:s.decisionId,sampleKind:s.sampleKind,rank}));const balanced=balanceFirstRoundFrozenKeep(afterScreen,metadata);assert.deepEqual(balanced.unused.map(s=>s.decisionId),['unused-frozen-keep']);assert.equal(firstRoundCoverage(balanced.samples,families).eligible,true,'screen rejection of one extra demo uses only original frozen keep prefix; coverage remains independently required');assert.deepEqual(balanceFirstRoundFrozenKeep([...afterScreen].reverse(),metadata).unused.map(s=>s.decisionId),['unused-frozen-keep']);
 const missing=structuredClone(samples);missing.find(s=>s.sampleKind==='demo'&&s.sourceFamily==='dev-b'&&s.targetIds[0]==='a').targetIds=['b'];const missingCoverage=firstRoundCoverage(missing,families);assert.equal(missingCoverage.eligible,false);assert(missingCoverage.reasons.includes('dev_pass_two_families_missing'));assert(!missingCoverage.reasons.includes('dev_demo_keep_count'));
 assert(firstRoundCoverage(samples,families.slice(1)).reasons.includes('requires_2_train_2_dev_families'));
 const diagnostic=structuredClone(samples);diagnostic.find(s=>s.sampleKind==='demo').evidenceGrade='diagnostic';assert.equal(firstRoundCoverage(diagnostic,families).eligible,false);
 const dup=structuredClone(samples);dup[1].contextSHA256=dup[0].contextSHA256;assert(firstRoundCoverage(dup,families).reasons.includes('duplicate_causal_context'));
 const conflicts=findFirstRoundLabelConflicts(samples.filter(s=>s.sampleKind==='demo'));assert.equal(conflicts.length,0,'opposing provisional demonstrations are not fabricated strong proof');
 const strong=samples.filter(s=>s.sampleKind==='demo').map(s=>({...s,evidenceGrade:'strong_supported'})),groups=findFirstRoundLabelConflicts(strong);assert.equal(groups.length,1);assert.equal(groups[0].reason,'student_information_gap/label_conflict');assert.equal(groups[0].decisionIds.length,8);
 const differentSpec=structuredClone(strong);for(const s of differentSpec)if(s.targetIds[0]==='b')s.candidateSpecRef='different-frozen-spec';assert.equal(findFirstRoundLabelConflicts(differentSpec).length,0,'different candidate spec is not the same input identity');
 const changed=structuredClone(strong);for(const s of changed)if(s.targetIds[0]==='b')s.candidateFeatures[0][399]=.5;assert.equal(findFirstRoundLabelConflicts(changed).length,0,'different mem24 is not identical actual input');
 const reordered=structuredClone(strong);for(const s of reordered)if(s.targetIds[0]==='b'){s.candidateIds.reverse();s.candidateCanonicalIds.reverse();s.candidateFeatures.reverse();}assert.equal(findFirstRoundLabelConflicts(reordered).length,0,'ordered canonical C matters');
 const bad=structuredClone(strong);bad[0].candidateFeatures[0][0]=NaN;assert.throws(()=>findFirstRoundLabelConflicts(bad),/finite_float32_423/);
 return{fourFixedFamilies:true,twoDirectionsAcrossFamilies:true,equalKeepPerSplit:true,provisionalNotStrong:true,actual423CollisionKey:true};
}
