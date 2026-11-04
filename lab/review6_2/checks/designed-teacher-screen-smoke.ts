/** Finite synthetic teacher/screen bridge regression. No provider, real model, research run or branch execution. */
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
import {commonViewForSnapshot,commonDecisionIdentityForSnapshot,queryOfflineTeacher} from '../offline-label-source';
assert.deepEqual(process.argv.slice(2),['--case','source.designed-teacher-screen']);
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

const {commonViewTeacherRoot}=await import('../first-round-screen-runtime');
const {offlineSnapshotActing}=await import('../offline-label-consumer');
const {verifyFirstRoundHardChecks}=await import('../first-round-screen-consumer');
const {readSelectionSnapshot,readDesignedSelectionHistory,selectDesignedPublicRepresentatives}=await import('../offline-selection');
assert.throws(()=>readSelectionSnapshot(snapshot.row,{...b.trusted,designedSession:{}} as any),/designed_selection_owned_runtime_required/);
assert.throws(()=>readDesignedSelectionHistory({}),/designed_selection_owned_runtime_required/);
const before=sha(JSON.stringify(snapshot.state)),common=commonViewForSnapshot(snapshot),root=commonViewTeacherRoot(snapshot);
assert.equal(root.actualActionId,null);assert.equal(root.allCandidates.length,snapshot.bundle.initialCandidateIds.length);
const action=snapshot.bundle.initialCandidateIds.find(id=>snapshot.bundle.pool.find(c=>c.actionId===id)!.canonical===null)!;
const summary={profileId:'fixture-profile',revision:1,snapshotHash:'b'.repeat(64),credentialRevision:1,protocol:'openai-chat-completions',requestedModel:'fixture-only',returnedModel:null,requestCount:1,elapsedMs:0,upstreamChunks:1,upstreamEvents:1,contentEvents:1,keepaliveEvents:0,firstUpstreamMs:0,firstContentMs:0,usage:{}};
const teacher={releaseRef:'fixture-teacher',promptRef:'fixture-prompt',profileSnapshot:{...summary}};let calls=0;
const result=await queryOfflineTeacher({snapshot,teacher,commonView:common,signal:new AbortController().signal,request:async view=>{
 calls++;assert.equal(view.schema,'ohuo-common-view-request-r2');assert(!view.modelPayloadBytes.includes('design-fixture'));assert(!view.modelPayloadBytes.includes('rawQ'));
 return {status:'response',response:{kind:'choose',decisionId:snapshot.bundle.decisionId,actionId:action,note:'Visible partner control.'},summary} as any;
}});
assert.equal(result.status,'selected',JSON.stringify(result));assert.equal(calls,1);assert.equal(result.offlineLabel?.legality,'validated');assert.equal(sha(JSON.stringify(snapshot.state)),before);
const terminal={schema:'ohuo-offline-label-result-v1',source:snapshot.row,inputSHA256:snapshot.row.inputSHA256,key:snapshot.row.key,purpose:'b_training_source',teacherResponses:[{kind:'choose',decisionId:snapshot.bundle.decisionId,actionId:action,note:'Visible partner control.'}],remote:result.remote,offlineLabel:result.offlineLabel,acting:offlineSnapshotActing(snapshot).acting};
const hard={schema:'ohuo-first-round-hard-check-v1',inputSHA256:snapshot.row.inputSHA256,labelTerminalRef:{id:'fixture-label',sha256:sha(JSON.stringify(terminal))},reviewerRef:'fixture-independent-reviewer',decision:'admitted',rationale:'Visible partner control.',checks:{canonicalLegal:'passed',publicFacts:'passed',student423Expressible:'passed',inFrozenC:'passed'},publicFacts:[],representationNotes:'Original shared 423 view only.',limitations:['Synthetic fixture; no strength or learning eligibility.']};
assert.equal(verifyFirstRoundHardChecks({hard,terminal,snapshot,reviewerRef:hard.reviewerRef,commonView:common.modelPayload}),'admitted');
assert.throws(()=>verifyFirstRoundHardChecks({hard,terminal:{...terminal,source:{...snapshot.row,sourceKind:'natural-recorded'}},snapshot,reviewerRef:hard.reviewerRef}),/designed_screen_source_kind_binding/);
const publicCell={targetKind:'single',opponentSizeRelation:'>',hasOrdinaryTakeover:true,partnerZero:false};
const population=[0,1,2].map(i=>({...snapshot.row,questionId:'question-'+i,decisionSHA256:sha('question-'+i),key:{...snapshot.row.key,requestSeq:i},commonViewCell:i===2?{...publicCell,partnerZero:true}:publicCell,eligibility:'eligible',exclusionReason:null}));
const first=selectDesignedPublicRepresentatives(structuredClone(population),[{familyId:snapshot.row.blockFamilyId,split:'train'}]);
assert.equal(first.selected.length,2);assert.deepEqual(first.selected.map(r=>r.questionId),selectDesignedPublicRepresentatives(structuredClone(population).reverse(),[{familyId:snapshot.row.blockFamilyId,split:'train'}]).selected.map(r=>r.questionId));
assert.throws(()=>selectDesignedPublicRepresentatives(structuredClone(population),[{familyId:snapshot.row.blockFamilyId,split:'dev'}]),/designed_selection_train_only/);
assert(first.selected.every(r=>r.sourceKind==='designed-synthetic'&&!Object.hasOwn(r,'recordRef')&&!Object.hasOwn(r,'layoutId')));
console.log('PASS original designed replay/capture → shared teacher query → diagnostic/independent hard checks and null-action screen root; deterministic public-cell selection; zero provider/real-model/branch/learner calls');
