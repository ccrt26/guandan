/** Explicit no-H peer metadata bridge for this round only. No product catalog
 * mutation; only the owned-run resolver reads weights. The original strict
 * PolicyDescriptor/resolvePolicy path retains SHA, shape and finite checks. */
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as same} from 'node:util';
import {validatePolicyRegistry} from '../review6/policy-registry';
import {validatePolicyDescriptor,policyParameterCount,policyEncoder,resolvePolicy} from '../../packages/ai/src/policy/resolve';
import {strictObject,fixedReference,digest} from './task-schema.mjs';
import {LEGACY_CANDIDATE_POLICY} from '../../packages/ai/src/candidate-spec';
const sha=(x:Uint8Array)=>createHash('sha256').update(x).digest('hex');
const plain=(x:any)=>JSON.parse(JSON.stringify(x));
const programRoot=fileURLToPath(new URL('../../',import.meta.url));
export const FIRST_ROUND_PEER_PROGRAM_FILES=['lab/review6/policy-registry.ts','lab/review6/match-play.ts','packages/ai/src/nn/neuralSeat.ts','packages/ai/src/candidate-spec.ts','packages/ai/src/legal.ts','packages/engine/src/combo.ts','lab/review6_2/first-round-registry-policy.ts'];
function peerProgram(){return {schema:'ohuo-first-round-no-H-policy-program-v1',decisionRule:'original-neural-greedy-epsilon0',candidatePolicy:plain(LEGACY_CANDIDATE_POLICY),candidateCompatRule:'explicit-registry-encoder-not-policyId-name',sourceFiles:FIRST_ROUND_PEER_PROGRAM_FILES.map(path=>{const full=resolve(programRoot,path);if(realpathSync(full)!==full||!lstatSync(full).isFile())throw Error('no-H policy program source changed');return{path,sha256:sha(readFileSync(full))};})};}
type Role='partner'|'opponent';
interface Options {envelope:any;readEvidence:(ref:{id:string;sha256:string})=>Uint8Array;repositoryRoot:string;role:Role}
function registryPolicy(registryRef:any,policyId:string,readEvidence:Options['readEvidence'],repositoryRoot:string,role:Role){
 strictObject(registryRef,'registryRef',['id','sha256']);
 if(typeof registryRef.id!=='string'||!registryRef.id||/(^|[/:_-])latest($|[/:@_-])/i.test(registryRef.id)||!/^[a-f0-9]{64}$/.test(registryRef.sha256))throw Error('fixed no-H registry reference required');
 const raw=Buffer.from(readEvidence(registryRef));if(sha(raw)!==registryRef.sha256)throw Error('no-H registry SHA mismatch');
 const registry=validatePolicyRegistry(JSON.parse(raw.toString()));
 if(registry.schemaVersion!=='r6-no-H-policy-registry-v1'||registry.selectedExperiment!=='direct_teacher_no_h')throw Error('original no-H registry required');
 if(role==='opponent'?policyId!==registry.oldCompletePolicy:role!=='partner'||![...registry.developmentPartners,...registry.confirmationPartners].includes(policyId))throw Error('no-H peer role mismatch');
 const spec=registry.policies.find(p=>p.policyId===policyId);if(!spec)throw Error('no-H registered policy missing');
 strictObject(spec,'registryPolicy',['policyId','kind','weightsPath','weightsSHA256','inputDim','encoder','epsilon']);
 if(spec.kind!=='neural'||spec.epsilon!==0||![385,399].includes(spec.inputDim!)||typeof spec.weightsPath!=='string')throw Error('unsupported original no-H peer');
 const e=spec.encoder as any,old=spec.inputDim===385;
 if(old?!(e&&e.candidateCompat==='v2'&&e.passEncoding==='legacy-phys10'&&(e.schema===undefined||e.schema==='v1')&&e.ctxFill===undefined):!same(e,{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'}))throw Error('original no-H encoder/candidate mismatch');
 if(old&&Object.keys(e).some(k=>!['schema','candidateCompat','passEncoding'].includes(k)))throw Error('unsupported no-H old encoder field');
 const root=realpathSync(repositoryRoot),path=resolve(root,spec.weightsPath),nodePath=relative(root,path).split('\\').join('/');
 if(!nodePath||nodePath.startsWith('../')||isAbsolute(nodePath))throw Error('no-H registered path escapes repository');
 const descriptor=validatePolicyDescriptor({policyId:spec.policyId,modelVersion:'no-H-registry-'+registryRef.sha256,architectureId:'mlp-tanh-256x256-scalar-v1',weightsLayoutVersion:'f32le-layer-w-row-major-then-b-v1',parameterCount:policyParameterCount(spec.inputDim!),weightsPathOrUrl:{nodePath},weightsSHA256:spec.weightsSHA256,inputDim:spec.inputDim,encoder:old?{schema:'v1',ctxFill:'none',passEncoding:'legacy-phys10',encoderVersion:'gd-lab-schema-v1'}:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64',encoderVersion:'gd-lab-schema-v4'},candidateSpecId:old?'cand-dedup-v2':'cand-suit-v3',epsilon:0,tierSpecId:'none',tieBreakId:'first-candidate-v1'});
 const encoder=policyEncoder(descriptor),identity=plain({policyId:descriptor.policyId,modelVersion:descriptor.modelVersion,weightsSHA256:descriptor.weightsSHA256,inputDim:descriptor.inputDim,encoderVersion:descriptor.encoder.encoderVersion,candidateVersion:descriptor.candidateSpecId,passEncoding:descriptor.encoder.passEncoding,candidateCompat:encoder.candidateCompat,architectureId:descriptor.architectureId,weightsLayoutVersion:descriptor.weightsLayoutVersion,epsilon:descriptor.epsilon,tieBreakId:descriptor.tieBreakId,tierSpecId:descriptor.tierSpecId});
 return {descriptor,identity,encoder,registrySpec:plain(spec),registryRef:plain(registryRef)};
}
export function buildFirstRoundRegistryPolicyEnvelope({registryRef,policyId,readEvidence,repositoryRoot,role}:Omit<Options,'envelope'>&{registryRef:any;policyId:string}){
 const metadata=registryPolicy(registryRef,policyId,readEvidence,repositoryRoot,role);
 return {schema:'ohuo-first-round-registry-policy-ref-v1',registryRef:metadata.registryRef,policyId,descriptor:plain(metadata.descriptor),program:peerProgram()};
}
export function validateFirstRoundRegistryPolicy({envelope,readEvidence,repositoryRoot,role}:Options){
 strictObject(envelope,'firstRoundRegistryPolicy',['schema','registryRef','policyId','descriptor','program']);if(envelope.schema!=='ohuo-first-round-registry-policy-ref-v1'||!same(envelope.program,peerProgram()))throw Error('explicit first-round peer program/source envelope required');
 const metadata=registryPolicy(envelope.registryRef,envelope.policyId,readEvidence,repositoryRoot,role);
 if(!same(plain(metadata.descriptor),envelope.descriptor))throw Error('no-H descriptor differs from original frozen registry');
 return metadata;
}
export function verifyFirstRoundRecordedPeer({seatSnapshot,policySpec,registryRef,readEvidence,repositoryRoot,role}:Omit<Options,'envelope'>&{seatSnapshot:any;policySpec:any;registryRef:any}){
 fixedReference(seatSnapshot?.releaseRef,'peer.releaseRef');
 const envelope=seatSnapshot.registryPolicy;
 if(!envelope||!same(envelope.registryRef,registryRef)||seatSnapshot.releaseRef.split(':').at(-1)!==digest(envelope))throw Error('recorded no-H peer reference differs');
 const metadata=validateFirstRoundRegistryPolicy({envelope,readEvidence,repositoryRoot,role});
 if(!same(metadata.registrySpec,policySpec)||!same(metadata.identity,seatSnapshot.policyIdentity))throw Error('recorded no-H peer full encoder/candidate identity differs');
 return metadata;
}
export async function resolveFirstRoundRegistryPolicy(options:Options){
 const metadata=validateFirstRoundRegistryPolicy(options),root=realpathSync(options.repositoryRoot);
 const resolved=await resolvePolicy(metadata.descriptor.policyId,{registry:{schemaVersion:'gd-model-index-v1',defaultPolicyRef:metadata.descriptor.policyId,policies:[metadata.descriptor]},site:'node',readWeights:async location=>{const p=resolve(root,location),actual=realpathSync(p);if(actual!==p||!lstatSync(p).isFile()||lstatSync(p).isSymbolicLink()||relative(root,p).startsWith('..')||isAbsolute(relative(root,p)))throw Error('no-H peer weights path changed');return new Uint8Array(readFileSync(p));},sha256:sha});
 if(!same(plain(resolved.identity),metadata.identity))throw Error('no-H resolved identity mismatch');return resolved;
}
