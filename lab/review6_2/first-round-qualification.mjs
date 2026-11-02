/** NAV-R12/R13's named small-round coverage arithmetic and observed-input
 * conflicts only. The freezer must FIRST reproduce original source selection,
 * legal 423 captures, teacher hard checks and bound screening/strong evidence.
 * A caller-supplied grade or this eligible bit never establishes that proof. */
import {createHash} from 'node:crypto';
import {validateFirstRoundResearchProtocol} from './first-round-contract.mjs';
const text=s=>typeof s==='string'&&s.length>0;
const unique=a=>Array.isArray(a)&&a.length>0&&a.every(text)&&new Set(a).size===a.length;
function targetCanonicalIds(row){
 if(!unique(row.candidateIds)||!unique(row.candidateCanonicalIds)||row.candidateIds.length!==row.candidateCanonicalIds.length||!unique(row.targetIds)||row.targetIds.some(id=>!row.candidateIds.includes(id)))throw Error('first_round_target_mapping');
 return row.targetIds.map(id=>row.candidateCanonicalIds[row.candidateIds.indexOf(id)]).sort();
}
function direction(row){const ids=targetCanonicalIds(row);if(ids.every(id=>id==='pass'))return'pass';if(ids.every(id=>id!=='pass'))return'takeover';throw Error('first_round_mixed_direction_target');}
function inputKey(row){
 if(!text(row.candidateSpecRef))throw Error('first_round_candidate_spec_identity');
 const k=row.candidateIds?.length;
 if(!Number.isSafeInteger(k)||k<1||k>12||!Array.isArray(row.candidateFeatures)||row.candidateFeatures.length!==k||row.candidateFeatures.some(r=>!Array.isArray(r)||r.length!==423||r.some(x=>typeof x!=='number'||!Number.isFinite(x)||Math.fround(x)!==x)))throw Error('first_round_finite_float32_423');
 const bytes=new Uint8Array(k*423*4),view=new DataView(bytes.buffer);let offset=0;for(const features of row.candidateFeatures)for(const n of features){view.setFloat32(offset,n,true);offset+=4;}
 return createHash('sha256').update(JSON.stringify([row.candidateSpecRef,row.candidateCanonicalIds])).update(bytes).digest('hex');
}
/** Exact candidate spec + ordered canonical C + actual float32 423 rows, not a coarse public
 * state hash. Finds only observed conflicts; does not claim a complete search.
 * In a conflicting observed group every label is diagnostic: no auto-relabel. */
export function findFirstRoundLabelConflicts(samples){
 if(!Array.isArray(samples))throw Error('first_round_samples');
 const groups=new Map();
 for(const row of samples){if(row.sampleKind!=='demo')continue;
  const targets=targetCanonicalIds(row),key=inputKey(row),item={decisionId:row.decisionId,targets,grade:row.evidenceGrade};if(!text(item.decisionId))throw Error('first_round_decision_id');
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
 }
 const result=[];
 for(const [inputSHA256,rows] of groups){const strong=rows.filter(r=>r.grade==='strong_supported');let conflict=false;
  for(let i=0;i<strong.length;i++)for(let j=i+1;j<strong.length;j++)if(!strong[i].targets.some(t=>strong[j].targets.includes(t)))conflict=true;
  if(conflict)result.push({reason:'student_information_gap/label_conflict',inputSHA256,decisionIds:rows.map(r=>r.decisionId).sort(),strongTargets:strong.map(r=>({decisionId:r.decisionId,canonicalTargets:r.targets}))});
 }
 return result.sort((a,b)=>a.inputSHA256.localeCompare(b.inputSHA256));
}
export function firstRoundCoverage(samples,families,researchProtocol){
 const r2=researchProtocol!==undefined;if(r2)validateFirstRoundResearchProtocol(researchProtocol);
 if(!Array.isArray(samples)||!Array.isArray(families))throw Error('first_round_coverage_inputs');
 const reasons=[],add=r=>{if(!reasons.includes(r))reasons.push(r);},byFamily=new Map();
 for(const f of families){if(!text(f?.sourceFamily)||!['train','dev'].includes(f.split)||byFamily.has(f.sourceFamily)){add('family_split_conflict');continue;}byFamily.set(f.sourceFamily,{sourceFamily:f.sourceFamily,split:f.split,demo:0,keep:0,pass:0,takeover:0});}
 if(!r2&&(byFamily.size!==4||['train','dev'].some(split=>[...byFamily.values()].filter(f=>f.split===split).length!==2)))add('requires_2_train_2_dev_families');
 const counts={train:{demo:0,keep:0},dev:{demo:0,keep:0}},gradeCounts={provisional_screened:0,strong_supported:0},seenDecision=new Set(),seenContext=new Set();
 for(const row of samples){
  const family=byFamily.get(row?.sourceFamily);if(!family||row.split!==family.split||!['demo','keep'].includes(row.sampleKind)){add('sample_family_or_split_conflict');continue;}
  if(!text(row.decisionId)||seenDecision.has(row.decisionId))add('duplicate_or_missing_decision');seenDecision.add(row.decisionId);
  if(!text(row.contextSHA256)||seenContext.has(row.contextSHA256))add('duplicate_causal_context');seenContext.add(row.contextSHA256);
  counts[row.split][row.sampleKind]++;family[row.sampleKind]++;
  if(row.sampleKind==='keep'){if(row.sampleClass!=='ordinary'||row.targetIds!==undefined||row.evidenceGrade!==undefined)add('keep_not_ordinary_or_has_label');continue;}
  if(row.sampleClass!=='target')add('demo_not_target');
  if(!Object.hasOwn(gradeCounts,row.evidenceGrade)){add('demo_evidence_grade_not_admissible');continue;}gradeCounts[row.evidenceGrade]++;
  try{family[direction(row)]++;}catch{add('demo_direction_unverified');}
 }
 for(const split of ['train','dev']){
  if(counts[split].demo<1||(!r2&&counts[split].demo>16)||counts[split].demo!==counts[split].keep)add(split+'_demo_keep_count');
  for(const dir of ['pass','takeover'])if([...byFamily.values()].filter(f=>f.split===split&&f[dir]>0).length<2)add(split+'_'+dir+'_two_families_missing');
 }
 if(!r2&&[...byFamily.values()].some(f=>f.demo>8))add('family_demo_quota_exceeded');
 if(findFirstRoundLabelConflicts(samples).length)add('student_information_gap/label_conflict');
 return{eligible:reasons.length===0,reasons,Ndemo:counts.train.demo,Nkeep:counts.train.keep,counts,familyCounts:[...byFamily.values()],gradeCounts,scope:(r2?'r2 observed coverage, not statistical sufficiency; ':'')+'first-round small research coverage only; original source/teacher/input evidence and host authorization remain mandatory'};
}
