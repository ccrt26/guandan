/** Direct S35 host seams, included by the one frozen round-contract case. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {validateFirstRoundParentEnvelope} from '../first-round-parent';
import {selectDistillCheckpoint,finalizeStudentFromHost,loadStudentRelease,verifyStudentFinalizationFacts} from '../distill-policy';
import {FixedHostFiles} from '../ohuo-host-files';
import {buildCalibrationQualification} from '../numerical-recovery';
import {createDistillConsumer,verifyFirstRoundPythonRuntime} from '../distill-consumer';
import {digest} from '../task-schema.mjs';
import {firstRoundHostFixture} from './fixtures/first-round-host-fixture';
import {FIRST_ROUND_RECIPE} from '../first-round-contract.mjs';
export async function checkFirstRoundHost(){
 const bytes=readFileSync(new URL('./fixtures/s35-migration-metadata.json',import.meta.url)),migration=JSON.parse(bytes.toString());
 const migrationReceiptRef={id:'engineering-fixed-migration',sha256:createHash('sha256').update(bytes).digest('hex')};
 const d=migration.parentRef,basePolicyIdentity={policyId:d.policyId,modelVersion:d.modelVersion,weightsSHA256:d.weightsSHA256,inputDim:d.inputDim,encoderVersion:d.encoder.encoderVersion,candidateVersion:d.candidateSpecId,passEncoding:d.encoder.passEncoding,architectureId:d.architectureId,weightsLayoutVersion:d.weightsLayoutVersion,epsilon:d.epsilon,tieBreakId:d.tieBreakId,tierSpecId:d.tierSpecId};
 const envelope={schema:'ohuo-student-parent-ref-v1',scorer:migration.target,migrationReceiptRef,basePolicyIdentity},parentRef='S0@sha256:'+digest(envelope);
 const parsed=validateFirstRoundParentEnvelope({parentRef,envelope,readEvidence:()=>bytes});assert.deepEqual(parsed.parentIdentity,migration.target);assert.equal(parsed.basePolicyIdentity.inputDim,399);
 assert.throws(()=>validateFirstRoundParentEnvelope({parentRef,envelope:{...envelope,basePolicyIdentity:{...basePolicyIdentity,weightsSHA256:'2'.repeat(64)}},readEvidence:()=>bytes}),/migration/);
 assert.throws(()=>validateFirstRoundParentEnvelope({parentRef,envelope:{...envelope,scorer:{...migration.target,weightsSHA256:'2'.repeat(64)}},readEvidence:()=>bytes}),/migration/);
 assert.throws(()=>validateFirstRoundParentEnvelope({parentRef,envelope,readEvidence:()=>Buffer.from('{}')}),/SHA/);
 const dirs=(ce:number)=>({pass:{demoCE:ce,count:2,greedyAgreementCount:1,sourceFamilyIds:['d1','d2']},takeover:{demoCE:ce,count:2,greedyAgreementCount:1,sourceFamilyIds:['d1','d2']}});
 const ms=[0,16,32,64].map((n,i)=>({checkpoint:{optimizerSteps:n,manifestSHA256:String(i+1).repeat(64)},metrics:{optimizerSteps:n,completedEpochs:n,demoCE:i?.8:1,targetDisagreementCE:i?.8:1,keepKL:i?.1:0,keepDriftRate:i?.9:0,greedyChangedCount:i?2:0,directionMetrics:dirs(i?.8:1)}}));
 const reviews=ms.slice(1).map(m=>({checkpointSHA256:m.checkpoint.manifestSHA256,status:'accepted'}));
 assert.equal(selectDistillCheckpoint(ms,reviews,FIRST_ROUND_RECIPE).selected?.optimizerSteps,16,'new explicit branch must run before old 5% gate');
 assert.equal(selectDistillCheckpoint(ms,reviews).status,'no_candidate','old drift gate remains');
 const wrong=structuredClone(ms);delete (wrong[0].metrics.directionMetrics as any).takeover;assert.equal(selectDistillCheckpoint(wrong,reviews,FIRST_ROUND_RECIPE).status,'no_candidate');
 assert.equal(selectDistillCheckpoint(ms.slice(0,3),reviews,FIRST_ROUND_RECIPE).status,'no_candidate');
 const runtime={executablePath:'/fixture/python',executableSHA256:'a'.repeat(64),version:'3.9.6',numpyVersion:null,torchVersion:'2.8.0'},ready={kind:'ready',python:runtime.executablePath,torch:'2.8.0',version:'3.9.6',numpyVersion:null,torchVersion:'2.8.0'};
 verifyFirstRoundPythonRuntime(runtime,ready,runtime.executablePath);
 assert.throws(()=>verifyFirstRoundPythonRuntime(runtime,{...ready,numpyVersion:'2.0.0'},runtime.executablePath),/runtime/);
 assert.throws(()=>verifyFirstRoundPythonRuntime(runtime,{...ready,torchVersion:'2.7.0'},runtime.executablePath),/runtime/);
 assert.throws(()=>verifyFirstRoundPythonRuntime(runtime,{...ready,python:'/other/python'},runtime.executablePath),/runtime/);
 const c=firstRoundHostFixture({phase:'calibration'}),stateBytes=JSON.stringify(c.state),hash=(v:any)=>createHash('sha256').update(v).digest('hex');
 const calibration:any={task:{ref:c.taskRef,value:c.task},inputBinding:c.binding,dataset:{ref:c.task.datasetRefs[0],value:c.refs.get(c.task.datasetRefs[0])},datasetManifest:{ref:c.manifestRef,bytes:c.evidence.get(c.manifestRef.id)!.toString()},samples:{ref:c.samplesRef,bytes:c.samplesBytes.toString()},controlState:{ref:{id:'control',sha256:hash(stateBytes)},bytes:stateBytes},summary:{ref:c.summaryRef,bytes:c.evidence.get(c.summaryRef.id)!.toString()},checkpoints:c.checkpoints,checks:Object.fromEntries(['input','mask','loss','stableLogSoftmax','totalGradient','parameterChange'].map(k=>[k,{status:'passed',evidence_refs:[c.migrationReceiptRef]}])),evidence:[{ref:c.migrationReceiptRef,bytes:c.evidence.get(c.migrationReceiptRef.id)!.toString()}]};
 assert.deepEqual(buildCalibrationQualification(calibration).issues,[],'explicit qualified first-round calibration1 is admissible');
 const ineligible=structuredClone(calibration),badManifest=JSON.parse(ineligible.datasetManifest.bytes);badManifest.plan.purpose='engineering_fixture';badManifest.qualification.eligible=false;ineligible.datasetManifest.bytes=JSON.stringify(badManifest);ineligible.datasetManifest.ref.sha256=hash(ineligible.datasetManifest.bytes);ineligible.dataset.value.manifestSHA256=ineligible.datasetManifest.ref.sha256;
 // Rebind only fixed dataset object identity; other original facts correctly
 // stay inconsistent as well. No engineering fixture may qualify research.
 ineligible.dataset.ref='dataset@sha256:'+digest(ineligible.dataset.value);assert(buildCalibrationQualification(ineligible).issues.includes('frozen_dataset_not_training_eligible'));
 const weights=join(c.repositoryRoot,c.scorer.weightsPathOrUrl.nodePath);renameSync(weights,weights+'.absent');
 const consumer=createDistillConsumer({pythonPath:process.execPath,policyRepositoryRoot:c.repositoryRoot,mode:'research'});
 const prepared=await consumer.prepare({task:c.task,refs:c.refs,inputs:{trainingPhase:'calibration',seed:17,datasetDirectory:join(c.repositoryRoot,c.binding.datasetDirectory),sourceIndexPath:c.sourceIndexPath,readFirstRoundEvidence:c.host.evidenceBytes}});assert.equal(prepared.maxSteps,1);assert.equal(prepared.parentPath,undefined,'admission does not materialize missing weights');renameSync(weights+'.absent',weights);
 const f=firstRoundHostFixture(),receipt=await finalizeStudentFromHost(f.requestRef,f.host);assert.equal(receipt.status,'selected');assert.deepEqual(await finalizeStudentFromHost(f.requestRef,f.host),receipt,'saved finalization is deterministic');
 const loaded=await loadStudentRelease(join(f.repositoryRoot,receipt.releaseRef!.id),receipt.releaseRef!.sha256,f.repositoryRoot,{readEvidence:f.host.evidenceBytes});assert.equal(loaded.release.schema,'ohuo-student-release-first-round-v3');assert.equal(loaded.studentCapture.scorer.policyId,f.scorer.policyId,'S0 capture scores remain the keep baseline, not S1');
 const release=loaded.release,selection=JSON.parse(readFileSync(join(f.repositoryRoot,receipt.releaseRef!.id)+'.selection.json','utf8'));
 assert.equal(selection.selected.optimizerSteps,16,'full64 source selects predetermined16, drift90% report only');
 const addExisting=(path:string,id?:string)=>{const bytes=readFileSync(path),actual={id:id??relative(f.repositoryRoot,path),sha256:hash(bytes)};f.evidence.set(actual.id,bytes);f.files.push({id:actual.id,file:{path:relative(f.repositoryRoot,path),sha256:actual.sha256}});return actual;};
 const completionRef=addExisting(join(f.out,'student-finalization',f.requestRef.split(':').at(-1)+'.json'));addExisting(join(f.repositoryRoot,receipt.releaseRef!.id));addExisting(join(f.repositoryRoot,receipt.releaseRef!.id)+'.selection.json',receipt.selectionRef!.id);
 Object.setPrototypeOf(f.host,FixedHostFiles.prototype);f.host.bindings=new Map([[f.taskRef,f.binding]]);
 const reread=(FixedHostFiles.prototype as any).studentSelectionCompletion.call(f.host,f.task.planRef,1,{evidence_refs:[completionRef]},{path:receipt.releaseRef!.id,sha256:receipt.releaseRef!.sha256},release,selection);assert.deepEqual(reread,receipt,'actual H completion path rechecks full64 and same selection');
 const original=f.state.runs.formal.committed;f.state.runs.formal.committed=original.slice(0,-1);assert.throws(()=>verifyStudentFinalizationFacts(f.request,f.host,f.task,f.summary,f.state),/consumption|epochs|trajectory|committed/);f.state.runs.formal.committed=original;
 const badExposure=firstRoundHostFixture({wrongExposureIds:true});await assert.rejects(finalizeStudentFromHost(badExposure.requestRef,badExposure.host),/exposure/);
 const no=firstRoundHostFixture({selected:false});assert.equal((await finalizeStudentFromHost(no.requestRef,no.host)).status,'no_candidate');
 const missing=firstRoundHostFixture({missingDirection:true});assert.equal((await finalizeStudentFromHost(missing.requestRef,missing.host)).status,'no_candidate');
 return {parentMigrationIdentity:true,explicitSelectionDispatch:true,legacyUnchanged:true,calibration1Qualified:true,admissionDefersWeights:true,ownedNullableNumpyRuntimeHandshake:true,full64Finalizer:true,savedFinalization:true,actualHCompletionReread:true,releaseReload423:true,noCandidate:true,missingDirectionRejected:true,wrongFrozenExposureRejected:true,optimizerUpdatesExecuted:0,researchAcceptance:false};
}
if(process.argv[1]?.endsWith('first-round-host-smoke.ts'))console.log(JSON.stringify(await checkFirstRoundHost()));
