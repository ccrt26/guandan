/** S is frozen B proposal + independent scorer, never a new proposal decider. */
import type {MLP} from '../nn/mlp';
import type {PolicyDescriptor,ResolvedPolicy} from '../policy/resolve';
import {STUDENT_SCORER_ENCODER,validateStudentScorerDescriptor,type StudentScorerDescriptor} from '../policy/descriptor';
import {freezeCopy,type DecisionBundle} from './protocol';
import {candidatePolicyForBundle,resolveCandidatePolicy,FIRST_TARGET_CANDIDATE_SPEC,type CandidatePolicySpec} from '../candidate-spec';
export interface FixedStudentRef {id:string;sha256:string}
interface StudentReleaseCommon {
 trainingKind:'supervised_rerank';policyId:string;
 proposer:{policyRef:string;identity:ResolvedPolicy['identity']};scorer:PolicyDescriptor;
 tieBreakId:'first-candidate-v1';
 checkpoint:{path:string;sha256:string};dataset:FixedStudentRef;recipe:FixedStudentRef;selection:FixedStudentRef;
}
export type StudentRelease = (StudentReleaseCommon & (
 | {schema:'ohuo-student-release-v1';candidateSpecRef:'ohuo-frozen-c8-expand4-v1';candidatePolicy?:never}
 | {schema:'ohuo-student-release-candidate-v2';candidateSpecRef:'first-target-offer12-v1';candidatePolicy:CandidatePolicySpec}
)) | (Omit<StudentReleaseCommon,'scorer'>&{schema:'ohuo-student-release-first-round-v3';candidateSpecRef:'first-target-offer12-v1';candidatePolicy:CandidatePolicySpec;scorer:StudentScorerDescriptor;proposalRef:string;learningParent:{ref:string;scorer:StudentScorerDescriptor;migrationReceiptRef:FixedStudentRef}});
/** Candidate contract only; full scorer/checkpoint identities are still checked by the loader. */
export function resolveStudentCandidatePolicy(release:Pick<StudentRelease,'schema'|'candidateSpecRef'|'candidatePolicy'>):CandidatePolicySpec {
 if(release.schema==='ohuo-student-release-v1'&&release.candidateSpecRef==='ohuo-frozen-c8-expand4-v1'&&release.candidatePolicy===undefined)return resolveCandidatePolicy();
 if((release.schema==='ohuo-student-release-candidate-v2'||release.schema==='ohuo-student-release-first-round-v3')&&release.candidateSpecRef===FIRST_TARGET_CANDIDATE_SPEC){
  const policy=resolveCandidatePolicy(release.candidatePolicy);
  if(policy.candidateSpec===release.candidateSpecRef)return policy;
 }
 throw Error('student release candidate schema/spec mismatch');
}
type CandidateRows={candidateIds:readonly string[];candidateFeatures:readonly (readonly number[])[];candidatePolicy?:CandidatePolicySpec};
type Student423Rows=CandidateRows&{schema:string;inputDim:number;inputContract:unknown;scorer:StudentScorerDescriptor};
const capturedScores=new WeakMap<object,{bundle:DecisionBundle;scorer:MLP;scores:readonly number[]}>();
/** The frozen object is an in-process witness for this decision and network.
 * Serialized scores and another scorer never qualify for reuse. */
export function captureStudent423InitialCandidates<T extends Student423Rows>(bundle:DecisionBundle,inputs:T,scorer:MLP):T&{rawQ:number[];baseActionId:string}{
 const choice=rerankStudent423InitialCandidates(bundle,inputs,scorer),captured=freezeCopy({...inputs,rawQ:[...choice.scores],baseActionId:choice.actionId});
 capturedScores.set(captured,{bundle,scorer,scores:choice.scores});return captured;
}
export function rerankInitialCandidates(bundle:DecisionBundle,inputs:CandidateRows,scorer:MLP){return rerankCandidateRows(bundle,inputs,scorer,399);}
export function rerankStudent423InitialCandidates(bundle:DecisionBundle,inputs:Student423Rows,scorer:MLP){
 if(inputs.schema!=='ohuo-student-candidate-input-v1'||inputs.inputDim!==423||candidatePolicyForBundle(bundle).candidateSpec!==FIRST_TARGET_CANDIDATE_SPEC||JSON.stringify(inputs.inputContract)!==JSON.stringify(STUDENT_SCORER_ENCODER))throw Error('student explicit423 input contract required');validateStudentScorerDescriptor(inputs.scorer);
 const captured=capturedScores.get(inputs),sameCapture=captured?.bundle===bundle&&captured.scorer===scorer;
 if(sameCapture)capturedScores.delete(inputs);return rerankCandidateRows(bundle,inputs,scorer,423,sameCapture?captured.scores:undefined);
}
function rerankCandidateRows(bundle:DecisionBundle,inputs:CandidateRows,scorer:MLP,inputDim:399|423,captured?:readonly number[]):{actionId:string;scores:readonly number[]}{
 const ids=bundle.initialCandidateIds,policy=candidatePolicyForBundle(bundle),newSpec=policy.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC;
 if(newSpec&&(resolveCandidatePolicy(inputs.candidatePolicy)!==policy||bundle.expansionCount!==0||JSON.stringify(bundle.offeredIds)!==JSON.stringify(ids)))throw Error('student complete candidate specification/set mismatch');
 if(!ids.length||ids.length>(newSpec?12:8)||new Set(ids).size!==ids.length||JSON.stringify(inputs.candidateIds)!==JSON.stringify(ids))throw Error('student initial C/order mismatch');
 if(scorer.inputDim!==inputDim||inputs.candidateFeatures.length!==ids.length||inputs.candidateFeatures.some(r=>r.length!==inputDim||r.some(v=>!Number.isFinite(v))))throw Error(`student finite ${inputDim} inputs required`);
 const rows=ids.map(id=>{const r=bundle.pool.find(c=>c.actionId===id);if(!r||!Number.isSafeInteger(r.originalIndex)||r.originalIndex<0)throw Error('student B mapping mismatch');return r;});
 if(new Set(rows.map(r=>r.originalIndex)).size!==ids.length)throw Error('student B original indices conflict');
 const flat=new Float32Array(inputs.candidateFeatures.flat());if(!flat.every(Number.isFinite))throw Error('student float32 inputs overflow');
 const scores=captured?[...captured]:[...scorer.forward(flat,ids.length)];if(scores.length!==ids.length||scores.some(v=>!Number.isFinite(v)))throw Error('nonfinite student score');
 let pick=0;for(let i=1;i<scores.length;i++)if(scores[i]>scores[pick]||scores[i]===scores[pick]&&rows[i].originalIndex<rows[pick].originalIndex)pick=i;
 return {actionId:ids[pick],scores:Object.freeze(scores)};
}
