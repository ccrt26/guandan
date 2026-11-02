import {isFirstRoundR2DatasetPlan} from './first-round-contract.mjs';
/** Narrow first-round S0 identity adapter. Metadata checks are admission-safe;
 * only resolveFirstRoundParent reads model bytes, inside an owned timed run. */
import {readFileSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {validateStudentScorerDescriptor,validatePolicyDescriptor,resolveStudentScorer,STUDENT_SCORER_ENCODER} from '../../packages/ai/src/policy/resolve';
import {fixedReference,strictObject,digest} from './task-schema.mjs';
import {resolveCandidatePolicy,FIRST_TARGET_CANDIDATE_SPEC} from '../../packages/ai/src/candidate-spec';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const json=(v:any)=>JSON.parse(JSON.stringify(v));
export interface FirstRoundParentOptions {parentRef:string;envelope:any;readEvidence:(ref:{id:string;sha256:string})=>Uint8Array}
export function validateFirstRoundParentEnvelope({parentRef,envelope,readEvidence}:FirstRoundParentOptions){
 fixedReference(parentRef,'studentParentRef');strictObject(envelope,'studentParent',['schema','scorer','migrationReceiptRef','basePolicyIdentity']);
 if(digest(envelope)!==parentRef.split(':').at(-1))throw Error('migration parent reference identity mismatch');
 if(envelope.schema!=='ohuo-student-parent-ref-v1')throw Error('first-round student parent envelope required');
 const scorer=validateStudentScorerDescriptor(envelope.scorer),f=envelope.migrationReceiptRef;strictObject(f,'migrationReceiptRef',['id','sha256']);
 if(typeof f.id!=='string'||!f.id||/(^|[/:_-])latest($|[/:@_-])/i.test(f.id)||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('fixed migration receipt required');
 const bytes=Buffer.from(readEvidence(f));if(sha(bytes)!==f.sha256)throw Error('migration receipt SHA mismatch');const receipt=JSON.parse(bytes.toString());
 if(receipt.schema!=='ohuo-student-migration-receipt-v1')throw Error('migration receipt schema');
 const source=validatePolicyDescriptor(receipt.parentRef),migration=receipt.migration;
 const sourceIdentity=json({policyId:source.policyId,modelVersion:source.modelVersion,weightsSHA256:source.weightsSHA256,inputDim:source.inputDim,encoderVersion:source.encoder.encoderVersion,candidateVersion:source.candidateSpecId,passEncoding:source.encoder.passEncoding,...(source.candidateSpecId==='cand-dedup-v2'?{candidateCompat:'v2'}:{}),architectureId:source.architectureId,weightsLayoutVersion:source.weightsLayoutVersion,epsilon:source.epsilon,tieBreakId:source.tieBreakId,tierSpecId:source.tierSpecId});
 if(source.inputDim!==399||!same(sourceIdentity,envelope.basePolicyIdentity)||!same(source.encoder,STUDENT_SCORER_ENCODER.baseEncoderRef)||!same(receipt.target,json(scorer))||migration?.ruleId!=='legacy399-append24-zero-w1-columns-v1'||migration.sourceSHA256!==source.weightsSHA256||migration.targetSHA256!==scorer.weightsSHA256||!same(migration.sourceEncoder,source.encoder)||!same(migration.targetEncoder,json(scorer.encoder))||migration.newColumnsZero!==6144||migration.parameters!==174593||migration.bytes!==698372||migration.initialization!=='cross-input-migration-fresh-optimizer'||migration.strictResume!==false)throw Error('migration source/target/encoder identity mismatch');
 if(typeof receipt.sourceRegistryRef?.path!=='string'||!/^[a-f0-9]{64}$/.test(receipt.sourceRegistryRef?.sha256)||!Array.isArray(migration.codeRefs)||!migration.codeRefs.length||migration.codeRefs.some((x:any)=>typeof x.path!=='string'||!/^[a-f0-9]{64}$/.test(x.sha256)))throw Error('migration original source references missing');
 return {scorer,parentIdentity:json(scorer),basePolicyIdentity:json(envelope.basePolicyIdentity),migrationReceiptRef:json(f),migrationReceipt:receipt};
}
export async function resolveFirstRoundParent(options:FirstRoundParentOptions&{repositoryRoot:string}){
 const metadata=validateFirstRoundParentEnvelope(options),root=realpathSync(options.repositoryRoot);
 const weightPath=realpathSync(resolve(root,metadata.scorer.weightsPathOrUrl.nodePath!));if(relative(root,weightPath).startsWith('..')||isAbsolute(relative(root,weightPath)))throw Error('student parent path escape');
 const resolved=await resolveStudentScorer(metadata.scorer,{site:'node',readWeights:async location=>{const p=realpathSync(resolve(root,location));if(p!==weightPath)throw Error('student parent weights identity changed');return new Uint8Array(readFileSync(p));},sha256:sha}),network=resolved.createNetwork();
 return {...metadata,network,parentPath:weightPath,studentCapture:{studentParentRef:options.parentRef,scorer:resolved.descriptor,network}};
}
/** Exact small-round metadata, never substitutes for the freezer's full proof. */
export function validateFirstRoundDatasetMetadata(manifest:any,mode:'research'|'offline_synthetic'){
 if(manifest?.schema!=='ohuo-distill-dataset-first-round-v4'||manifest.plan?.schema!=='ohuo-distill-plan-first-round-v3'||(mode==='research'?(manifest.plan.purpose!=='first-round-partner-control'||manifest.qualification?.eligible!==true):(manifest.plan.purpose!=='engineering_fixture'||manifest.qualification?.eligible!==false)))throw Error('first-round dataset purpose/qualification mismatch');
 isFirstRoundR2DatasetPlan(manifest.plan);
 const ids=manifest.plan.identities,scorer=validateStudentScorerDescriptor(ids?.studentScorer);fixedReference(ids.studentParentRef,'studentParentRef');
 if(!same(ids.encoderConfig,json(STUDENT_SCORER_ENCODER))||ids.encoderVersion!==STUDENT_SCORER_ENCODER.encoderVersion||!same(ids.proposalEncoderConfig,{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'})||ids.candidateSpecRef!==FIRST_TARGET_CANDIDATE_SPEC||resolveCandidatePolicy(ids.candidatePolicy).candidateSpec!==FIRST_TARGET_CANDIDATE_SPEC||scorer.inputDim!==423||ids.basePolicy?.inputDim!==399)throw Error('first-round dataset scorer/proposal/input identity mismatch');
 return ids;
}
