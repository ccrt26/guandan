/** Finite synthetic reader regression. No provider, real model, labels or run. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,chmodSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {applyMove,buildDeck,classify,createMatch,DEFAULT_RULES,startGame,legalCombos,canPass,type Move} from '@gd/engine';
import {resolveLegalMove} from '../../../packages/ai/src/hybrid/legality';
import {dedupCandidates} from '../../../packages/ai/src/nn/neuralSeat';
import {PublicTracker} from '../../../packages/ai/src/nn/schema';
import {FIRST_TARGET_CANDIDATE_POLICY} from '../../../packages/ai/src/candidate-spec';
import {RELEASES} from '../../../packages/ai/src/policy/seats';
import {dealtFamilyBeforeExchange} from '../../review6/training-ancestry';
import {referenceOf,digest} from '../task-schema.mjs';
import * as reader from '../designed-source';
import {prepareDesignedDatasetSample,prepareOfflineLabel} from '../distill-data';
import {STUDENT_SCORER_ENCODER} from '../../../packages/ai/src/policy/descriptor';
import {commonViewForSnapshot,commonDecisionIdentityForSnapshot} from '../offline-label-source';
assert.deepEqual(process.argv.slice(2),['--case','dataset.designed-sample']);
assert.equal(typeof reader.readDesignedSnapshot,'function','reader must capture the original B-prime/423 snapshot from authoritative source bytes');
const sha=(v:any)=>createHash('sha256').update(v).digest('hex');
const sourcePath=(path:string)=>fileURLToPath(import.meta.resolve('../../../'+path));
const repositoryRoot=realpathSync(mkdtempSync(join(tmpdir(),'designed-source-'))),references=new Map<string,any>(),evidenceFiles=new Map<string,any>();
const ref=(id:string,value:any)=>{const r=referenceOf(id,value);references.set(r,value);return r;};
const file=(id:string,value:any)=>{const path='fixture/'+id+'.json',raw=JSON.stringify(value)+'\n';mkdirSync(join(repositoryRoot,'fixture'),{recursive:true});writeFileSync(join(repositoryRoot,path),raw,{mode:0o600});const f={id,sha256:sha(raw)};evidenceFiles.set(id,{path,sha256:f.sha256});return f;};
const sourceInventory=[...reader.DESIGNED_SOURCE_PROGRAM_PATHS,'package.json'];
for(const path of sourceInventory){mkdirSync(dirname(join(repositoryRoot,path)),{recursive:true});copyFileSync(sourcePath(path),join(repositoryRoot,path));}
const engineSourceRef=ref('fixture-original-source',{baseCommit:'a'.repeat(40),files:sourceInventory.map(path=>({path,sha256:sha(readFileSync(join(repositoryRoot,path)))}))});
const rulesRef=ref('fixture-rules',DEFAULT_RULES);
const receipt=JSON.parse(readFileSync(sourcePath('lab/review6_2/checks/fixtures/s35-migration-metadata.json'),'utf8'));
const migrationReceiptRef=file('migration-metadata',receipt),source=receipt.parentRef;
const identity={policyId:source.policyId,modelVersion:source.modelVersion,weightsSHA256:source.weightsSHA256,inputDim:399,encoderVersion:source.encoder.encoderVersion,candidateVersion:source.candidateSpecId,passEncoding:source.encoder.passEncoding,architectureId:source.architectureId,weightsLayoutVersion:source.weightsLayoutVersion,epsilon:0,tieBreakId:source.tieBreakId,tierSpecId:source.tierSpecId};
const parentRef=ref('fixture-S0',{schema:'ohuo-student-parent-ref-v1',scorer:receipt.target,migrationReceiptRef,basePolicyIdentity:identity});
const old=RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1')!,baseRef=ref('fixture-B',{schema:'ohuo-release-ref-v1',release:old,policyIdentity:identity});
const proposalRef=ref('fixture-B-prime',{schema:'ohuo-candidate-research-release-ref-v1',parentRef:baseRef,release:{...old,releaseRef:'fixture-source-B-prime',label:'Fixture B prime',status:'development',parentRelease:old.releaseRef,candidateSpecRef:'first-target-offer12-v1',promptRef:'ohuo-engine-rules-v1/choose-only-v2'},policyIdentity:identity,candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY});
const comparisonRef=ref('fixture-comparison',{schema:'ohuo-first-round-comparison-v1',proposalRef,studentParentRef:parentRef});
const deck=buildDeck(),initialIds=Array.from({length:4},(_,seat)=>deck.slice(seat*27,(seat+1)*27).map(c=>c.id));
const leaderSeed=1,state=startGame(createMatch(structuredClone(DEFAULT_RULES),leaderSeed),[],initialIds),familyId=dealtFamilyBeforeExchange(state),designFamilyId='design-family-fixture';
const firstActor=state.turn,card=state.hands[firstActor].find(c=>c.rank===3)!,single=classify([card],state.ctx,state.match.opts)[0];assert(single);
const moves:any[]=[];
for(const move of [{pass:false,combo:single},{pass:true}] as Move[]){const actorSeat=state.turn;moves.push({gameNo:1,actorSeat,move:structuredClone(move)});applyMove(state,resolveLegalMove(state,JSON.parse(JSON.stringify(move))) as Move);}
const sourceInput:any={schema:reader.DESIGNED_FIRST_GAME_SCHEMA,sourceKind:'designed-synthetic',questionId:'design-fixture',designFamilyId,split:'train',engineSourceRef,rulesRef,rules:structuredClone(DEFAULT_RULES),origin:{kind:'first-game',leaderSeed},initialIds,moves,target:{gameNo:1,moveNo:state.moveNo,actorSeat:state.turn,remainingCards:state.hands.map(hand=>hand.length)}};
const index:any={version:1,families:{[familyId]:{split:'train',rootFamilyId:familyId,parentFamilyIds:[]},[designFamilyId]:{split:'train',rootFamilyId:familyId,parentFamilyIds:[familyId]}}};
let ordinal=0;
function bind(input=sourceInput,sourceIndex=index){
 const id=++ordinal,indexFile=file('index-'+id,sourceIndex),sourceIndexPath=join(repositoryRoot,evidenceFiles.get(indexFile.id).path),sourceIndexRef=ref('source-index-'+id,{schema:'ohuo-source-index-ref-v1',namespace:'fixture-designed',fileSHA256:indexFile.sha256}),sourceFile=file('source-'+id,input);
 const registration={schema:'ohuo-designed-source-registration-v1',sourceIndexRef,sourceFile,questionId:input.questionId,designFamilyId:input.designFamilyId,sourceFamilyId:familyId,rootFamilyId:familyId,engineSourceRef:input.engineSourceRef,rulesRef:input.rulesRef,comparisonRef};
 const row={sourceKind:'designed-synthetic' as const,sourceRef:ref('registered-design-'+id,registration)},trusted={repositoryRoot,sourceIndexPath,sourceIndexRef,references,evidenceFiles};return{row,trusted,sourceFile,registration};
}
let proposalCalls=0,syntheticScoreCaptures=0;
const runtime:any={proposal:{identity,encoder:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'},candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY,createDecider:(seat:number)=>{
 const tracker=new PublicTracker();return {seat,tracker,newGame:()=>tracker.reset(),observe:(events:any)=>tracker.observe(events),decide:(s:any,options:any)=>{proposalCalls++;assert.deepEqual(options.candidatePolicy,FIRST_TARGET_CANDIDATE_POLICY);const c=dedupCandidates(legalCombos(s,FIRST_TARGET_CANDIDATE_POLICY.enumSpec.enumerationMode),canPass(s));return {candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY,move:c[0].combo?{pass:false,combo:c[0].combo}:{pass:true},nCands:c.length,explored:false,ranking:c.map(({combo},idx)=>({combo,idx,score:c.length-idx}))};}};
}},parent:{studentCapture:{studentParentRef:parentRef,scorer:receipt.target,network:{inputDim:423,forward:(_x:any,n:number)=>{syntheticScoreCaptures++;return new Float32Array(n);}}}}};
const b=bind(),snapshot=reader.readDesignedSnapshot(b.row,b.trusted,runtime);

const teacher={releaseRef:'fixture-teacher',promptRef:'fixture-prompt',profileSnapshot:{profileId:'fixture',revision:1,snapshotHash:'a'.repeat(64),credentialRevision:1,protocol:'openai',requestedModel:'fixture'}};
const protocolRef=ref('fixture-protocol',{}),productionRef=ref('fixture-production',{}),selectionRef=ref('fixture-selection',{}),ordinarySelectionRef=ref('fixture-ordinary',{}),previousDatasetRef=ref('fixture-previous',{});
const plan:any={schema:'ohuo-distill-plan-first-round-v3',datasetId:'fixture-designed-sample',purpose:'engineering_fixture',sourceIndexRef:b.trusted.sourceIndexRef,sourceIndexSHA256:sha(readFileSync(b.trusted.sourceIndexPath)),queueRef:ref('fixture-queue',{}),queueSHA256:'a'.repeat(64),samplingRef:productionRef,researchProtocol:{id:'first-round-common-view-r2',revisionRef:protocolRef},designedAugmentation:{schema:'ohuo-designed-augmentation-v1',previousDatasetRef,selectionRef,ordinarySelectionRef},identities:{basePolicy:identity,teacher,encoderVersion:'student-input399plus24-v1',encoderConfig:STUDENT_SCORER_ENCODER,proposalEncoderConfig:runtime.proposal.encoder,candidateSpecRef:FIRST_TARGET_CANDIDATE_POLICY.candidateSpec,candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY,promptRef:teacher.promptRef,studentParentRef:parentRef,studentScorer:receipt.target,migrationReceiptRef},families:[{sourceFamily:familyId,split:'train',sourceRefs:[b.row.sourceRef]}],games:[]};
const action=snapshot.bundle.pool.find(c=>c.actionId===snapshot.bundle.initialCandidateIds[0])!;
const remote:any={status:'selected',decisionKey:snapshot.input.key,actionId:action.actionId,offeredIds:snapshot.bundle.initialCandidateIds,inInitialCandidateSet:true,attempts:[{...teacher.profileSnapshot,requestCount:1}]};
const offlineLabel=prepareOfflineLabel({input:snapshot.input as any,remote,state:snapshot.state,history:snapshot.history,teacher});
const row:any={sourceKind:'designed-synthetic',sampleKind:'demo',sampleClass:'target',source:snapshot.row,sourceMetadata:snapshot.designedSource,privateInput:snapshot.input,offlineLabel,firstRoundValidation:{evidenceGrade:'provisional_screened',direction:action.canonical===null?'pass':'takeover',validationRef:{id:'fixture-unproved-screen',sha256:'a'.repeat(64)}}};
const sample=prepareDesignedDatasetSample(row,plan);assert(sample.sampleKind==='demo');assert('sourceKind' in sample.provenance);assert.equal(sample.schema,'ohuo-distill-decision-first-round-v4');assert.equal(sample.provenance.sourceKind,'designed-synthetic');assert.equal(sample.split,'train');assert.equal(sample.executionKind,'offline_suggested');assert.equal(sample.candidateFeatures[0].length,423);assert.equal(sample.provenance.sourceSHA256,b.sourceFile.sha256);assert(!('recordSHA256' in sample.provenance));assert(!('matchSHA256' in sample.provenance));
for(const change of [(r:any)=>r.record={},(r:any)=>r.match={},(r:any)=>r.source.split='dev',(r:any)=>r.sourceMetadata.targetExecuted=true,(r:any)=>r.privateInput.studentInputs.studentParentRef='other',(r:any)=>delete r.offlineLabel]){const bad=structuredClone(row);change(bad);assert.throws(()=>prepareDesignedDatasetSample(bad,plan));}
console.log(JSON.stringify({case:'dataset.designed-sample',status:'passed',originalEngineAndCaptures:true,providerRequests:0,realModelCalls:0,syntheticScoreCaptures,datasetFrozen:false,screenEvidenceProven:false}));
