/** Finite synthetic reader regression. No provider, real model, labels or run. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,chmodSync,realpathSync,rmSync} from 'node:fs';
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
import * as owner from '../designed-source-acceptance';
import {commonViewCoverageCell} from '../first-round-source-batch.mjs';
const caseId=process.argv[3];assert.equal(process.argv[2],'--case');assert(['source.designed-candidate-isolation','source.designed-invalid-prefix'].includes(caseId));
assert.equal(typeof owner.createDesignedCandidateAdmission,'function');
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

try{
 if(caseId==='source.designed-invalid-prefix'){
 const cases:[string,(v:any)=>void][]=[
 ['duplicate physical resource identity',v=>v.moves[0].move.combo.cards.push(structuredClone(v.moves[0].move.combo.cards[0]))],
 ['physical resource not owned',v=>v.moves[0].move.combo.cards[0]=structuredClone(deck.find(c=>!initialIds[firstActor].includes(c.id))!)],
 ['selected physical-card identity differs from the actual owned card',v=>v.moves[0].move.combo.cards[0].rank=4],
 ['invalid declared wildcard identity',v=>v.moves[0].move.combo.wildAs=[{cardId:v.moves[0].move.combo.cards[0].id,asRank:4}]]
 ];
 let historyLoads=0;const history={selectionRefs:['fixed-used'],rows:[]},admission=owner.createDesignedCandidateAdmission(history,async()=>{historyLoads++;return new Set<string>();});
 for(const [message,mutate]of cases){const invalid=structuredClone(sourceInput);mutate(invalid);assert.doesNotThrow(()=>reader.parseDesignedFirstGameSource(invalid));const bound=bind(invalid),result=await admission.inspect({reader:reader.createDesignedSourceReader(bound.trusted),locator:bound.row,runtime,requestedCoverage:{},acceptedIdentities:new Set<string>()});assert.equal(result.reason,message);assert.equal(owner.isDesignedCandidateSourceFailure(Error(result.reason!)),true,'ordinary schema-valid illegal prefix must reject only that candidate');}
 assert.equal(historyLoads,0,'invalid causal prefixes must not reconstruct used history');admission.assertHistory(structuredClone(history));assert.throws(()=>admission.assertHistory({...history,selectionRefs:['changed']}),/used_history_changed/,'even rejected-only transactions retain the commit-time history guard');
 for(const message of ['designed_source_program_identity','designed_source_private_source_permissions','designed_source_evidence_hash','designed_acceptance_host_before_hash_changed','designed_source_runtime_identity'])assert.equal(owner.isDesignedCandidateSourceFailure(Error(message)),false,'fixed authority/data/runtime failures must halt batch');
 console.log(JSON.stringify({case:caseId,status:'passed',schemaValidIllegalPrefixes:cases.map(([message])=>message),actualOriginalReplay:true,historyLoads,historyChangeRejected:true,integrityErrorsNotSwallowed:true,providerRequests:0,realModelCalls:0,nativeAdmission:false}));
 }else{
 const base={version:1,families:{rootA:{split:'train'},rootB:{split:'train'},designA:{split:'train',rootFamilyId:'rootA',parentFamilyIds:['rootA']},designB:{split:'train',rootFamilyId:'rootB',parentFamilyIds:['rootB']},oldDev:{split:'dev'}}};
 const a={...structuredClone(sourceInput),questionId:'first-rejected',designFamilyId:'designA'},b={...structuredClone(sourceInput),questionId:'later-valid',designFamilyId:'designB'};
 const before=structuredClone(base),first=owner.isolateDesignedCandidateIndex(base,a,familyId);
 assert.deepEqual(base,before,'provisional A must not reserve its deal/root in the shared source index');
 assert.equal(first.rootFamilyId,'rootA');assert.equal(first.index.families[familyId].rootFamilyId,'rootA');
 const second=owner.isolateDesignedCandidateIndex(base,b,familyId);assert.equal(second.rootFamilyId,'rootB');assert.deepEqual(base,before);
 const bindCandidate=(input:any,graph:any)=>{const id=++ordinal,indexFile=file('isolated-index-'+id,graph.index),sourceIndexPath=join(repositoryRoot,evidenceFiles.get(indexFile.id).path),sourceIndexRef=ref('isolated-index-'+id,{schema:'ohuo-source-index-ref-v1',namespace:'fixture-designed',fileSHA256:indexFile.sha256}),sourceFile=file('isolated-source-'+id,input),registration={schema:'ohuo-designed-source-registration-v1',sourceIndexRef,sourceFile,questionId:input.questionId,designFamilyId:input.designFamilyId,sourceFamilyId:familyId,rootFamilyId:graph.rootFamilyId,engineSourceRef:input.engineSourceRef,rulesRef:input.rulesRef,comparisonRef};return{row:{sourceKind:'designed-synthetic' as const,sourceRef:ref('isolated-source-'+id,registration)},trusted:{repositoryRoot,sourceIndexPath,sourceIndexRef,references,evidenceFiles}};};
 const badPrefix=structuredClone(a);badPrefix.moves[0].move={pass:true};const rejected=bindCandidate(badPrefix,first);assert.throws(()=>reader.readDesignedSnapshot(rejected.row,rejected.trusted,runtime),/illegal pass/);
 const valid=bindCandidate(b,second),validReader=reader.createDesignedSourceReader(valid.trusted),snapshot=validReader.readSnapshot(valid.row,runtime);assert.equal(snapshot.row.blockFamilyId,'rootB');
 const view=snapshot.commonView.modelPayload,cell={...commonViewCoverageCell(view),hasNaturalNonJokerOption:view.candidates.some((c:any)=>!c.action.pass&&c.action.kind===view.state.currentTarget.kind&&c.action.wildCount===0&&!c.action.cards.some((p:any)=>p.card==='SJ'||p.card==='BJ')),ownHasFewerCardsThanPartner:view.state.myHand.reduce((n:number,c:any)=>n+c.count,0)<view.state.otherSeats.partner.remainingCards};
 const validA=bindCandidate(a,first),snapshotA=reader.readDesignedSnapshot(validA.row,validA.trusted,runtime),used=new Set<string>(),accepted=new Set<string>();
 assert.equal(owner.designedCandidateRejectionReason(snapshotA,{...cell,partnerZero:!cell.partnerZero},used,accepted),'requested_public_coverage_not_met');
 assert.equal(owner.designedCandidateRejectionReason(snapshot,cell,used,accepted),null,'coverage-rejected A must not block B');
 assert.equal(snapshotA.normalizedDecisionIdentity.sha256,snapshot.normalizedDecisionIdentity.sha256);used.add(snapshotA.normalizedDecisionIdentity.sha256);assert.equal(owner.designedCandidateRejectionReason(snapshot,cell,used,accepted),'previously_selected_common_decision');used.clear();accepted.add(snapshotA.normalizedDecisionIdentity.sha256);assert.equal(owner.designedCandidateRejectionReason(snapshot,cell,used,accepted),'duplicate_common_decision');
 let historyLoads=0;const history={selectionRefs:['fixed-used'],rows:[]},loaded=new Set<string>(),batch=new Set<string>(),admission=owner.createDesignedCandidateAdmission(history,async()=>{historyLoads++;return loaded;});
 const inspect=()=>admission.inspect({reader:validReader,locator:valid.row,runtime,requestedCoverage:cell,acceptedIdentities:batch});
 assert.equal((await inspect()).reason,null);loaded.add(snapshot.normalizedDecisionIdentity.sha256);assert.equal((await inspect()).reason,'previously_selected_common_decision');loaded.clear();batch.add(snapshot.normalizedDecisionIdentity.sha256);assert.equal((await inspect()).reason,'duplicate_common_decision');assert.equal(historyLoads,1,'legal candidates share one transaction-local history reconstruction');admission.assertHistory(structuredClone(history));assert.throws(()=>admission.assertHistory({...history,selectionRefs:['changed']}),/used_history_changed/);
 assert.throws(()=>owner.isolateDesignedCandidateIndex(first.index,b,familyId),/deal_reuses_other_split_or_root/,'an actually accepted conflicting root still blocks later reparent');
 console.log(JSON.stringify({case:'source.designed-candidate-isolation',status:'passed',rejectedPrefixDoesNotReserveRoot:true,rejectedCoverageDoesNotReserveRoot:true,usedAndBatchDuplicateStillRejected:true,historyLoads,historyChangeRejected:true,actualReaderReplay:true,syntheticScoreCaptures,providerRequests:0,realModelCalls:0,nativeAdmission:false}));
}
}finally{rmSync(repositoryRoot,{recursive:true,force:true});}
