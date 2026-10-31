/** S is frozen B proposal + independent scorer, never a new proposal decider. */
import type {MLP} from '../nn/mlp';
import type {PolicyDescriptor,ResolvedPolicy} from '../policy/resolve';
import type {DecisionBundle} from './protocol';
export interface FixedStudentRef {id:string;sha256:string}
export interface StudentRelease {
 schema:'ohuo-student-release-v1';trainingKind:'supervised_rerank';policyId:string;
 proposer:{policyRef:string;identity:ResolvedPolicy['identity']};scorer:PolicyDescriptor;
 candidateSpecRef:'ohuo-frozen-c8-expand4-v1';tieBreakId:'first-candidate-v1';
 checkpoint:{path:string;sha256:string};dataset:FixedStudentRef;recipe:FixedStudentRef;selection:FixedStudentRef;
}
export function rerankInitialCandidates(bundle:DecisionBundle,inputs:{candidateIds:readonly string[];candidateFeatures:readonly (readonly number[])[]},scorer:MLP):{actionId:string;scores:readonly number[]}{
 const ids=bundle.initialCandidateIds;
 if(bundle.candidateSpec!=='ohuo-frozen-c8-expand4-v1'||!ids.length||ids.length>8||new Set(ids).size!==ids.length||JSON.stringify(inputs.candidateIds)!==JSON.stringify(ids))throw Error('student initial C/order mismatch');
 if(scorer.inputDim!==399||inputs.candidateFeatures.length!==ids.length||inputs.candidateFeatures.some(r=>r.length!==399||r.some(v=>!Number.isFinite(v))))throw Error('student finite 399 inputs required');
 const rows=ids.map(id=>{const r=bundle.pool.find(c=>c.actionId===id);if(!r||!Number.isSafeInteger(r.originalIndex)||r.originalIndex<0)throw Error('student B mapping mismatch');return r;});
 if(new Set(rows.map(r=>r.originalIndex)).size!==ids.length)throw Error('student B original indices conflict');
 const flat=new Float32Array(inputs.candidateFeatures.flat());if(!flat.every(Number.isFinite))throw Error('student float32 inputs overflow');
 const scores=[...scorer.forward(flat,ids.length)];if(scores.some(v=>!Number.isFinite(v)))throw Error('nonfinite student score');
 let pick=0;for(let i=1;i<scores.length;i++)if(scores[i]>scores[pick]||scores[i]===scores[pick]&&rows[i].originalIndex<rows[pick].originalIndex)pick=i;
 return {actionId:ids[pick],scores:Object.freeze(scores)};
}
