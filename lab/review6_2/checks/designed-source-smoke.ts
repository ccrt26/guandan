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
import {createProfileDesigner,prepareDesignedSourceRequest,queryDesignedSource} from '../designed-source-request';
import {createDesignedCandidateAdmission,inspectDesignedCandidateSource,isDesignedCandidateSourceFailure} from '../designed-source-acceptance';
import {commonViewCoverageCell} from '../first-round-source-batch.mjs';
import {selectDesignedPublicRepresentatives} from '../offline-selection';
import {commonViewForSnapshot,commonDecisionIdentityForSnapshot,queryOfflineTeacher} from '../offline-label-source';
assert.deepEqual(process.argv.slice(2),['--case','source.designed-first-game']);
assert.equal(typeof reader.readDesignedSnapshot,'function','reader must capture the original B-prime/423 snapshot from authoritative source bytes');
const sha=(v:any)=>createHash('sha256').update(v).digest('hex');
const sourcePath=(path:string)=>fileURLToPath(import.meta.resolve('../../../'+path));
const repositoryRoot=realpathSync(mkdtempSync(join(tmpdir(),'designed-source-'))),references=new Map<string,any>(),evidenceFiles=new Map<string,any>();
const ref=(id:string,value:any)=>{const r=referenceOf(id,value);references.set(r,value);return r;};
const file=(id:string,value:any,rawText?:string)=>{const path='fixture/'+id+'.json',raw=rawText??JSON.stringify(value)+'\n';mkdirSync(join(repositoryRoot,'fixture'),{recursive:true});writeFileSync(join(repositoryRoot,path),raw,{mode:0o600});const f={id,sha256:sha(raw)};evidenceFiles.set(id,{path,sha256:f.sha256});return f;};
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
function bind(input=sourceInput,sourceIndex=index,rawText?:string){
 const id=++ordinal,indexFile=file('index-'+id,sourceIndex),sourceIndexPath=join(repositoryRoot,evidenceFiles.get(indexFile.id).path),sourceIndexRef=ref('source-index-'+id,{schema:'ohuo-source-index-ref-v1',namespace:'fixture-designed',fileSHA256:indexFile.sha256}),sourceFile=file('source-'+id,input,rawText);
 const registration={schema:'ohuo-designed-source-registration-v1',sourceIndexRef,sourceFile,questionId:input.questionId,designFamilyId:input.designFamilyId,sourceFamilyId:familyId,rootFamilyId:familyId,engineSourceRef:input.engineSourceRef,rulesRef:input.rulesRef,comparisonRef};
 const row={sourceKind:'designed-synthetic' as const,sourceRef:ref('registered-design-'+id,registration)},trusted={repositoryRoot,sourceIndexPath,sourceIndexRef,references,evidenceFiles};return{row,trusted,sourceFile,registration};
}
// Fixed, reviewed projection correction only; the original source stays bound.
const mapperPath='lab/review6_2/first-round-common-view.ts',mapperFile=join(repositoryRoot,mapperPath),mapperBytes=readFileSync(mapperFile);
assert.equal(sha(mapperBytes),'8c6135254277b94ad6339e619cf6f817772daf65d9851e4970ac762a17c0ed50');
const beforeProgram=structuredClone(references.get(engineSourceRef));
beforeProgram.files.find((f:any)=>f.path===mapperPath).sha256='d06b7dcd518e67f55b3909306ee37f8b9cd8505b00ad89b3ff31b189782d834a';
const beforeRef=ref('fixture-source-before-joker-rank-correction',beforeProgram),historical=bind({...sourceInput,engineSourceRef:beforeRef});
assert.equal(reader.readDesignedSource(historical.row,historical.trusted).source.engineSourceRef,beforeRef,'exact known mapper correction preserves original source identity');
writeFileSync(mapperFile,Buffer.concat([mapperBytes,Buffer.from('\n')]));
assert.throws(()=>reader.readDesignedSource(historical.row,historical.trusted),/program_identity/,'unknown third mapper must not inherit the correction');
writeFileSync(mapperFile,mapperBytes);
const unknownBefore=structuredClone(beforeProgram);unknownBefore.files.find((f:any)=>f.path===mapperPath).sha256='f'.repeat(64);
const unknownMapperSource=bind({...sourceInput,engineSourceRef:ref('fixture-unknown-before',unknownBefore)});
assert.throws(()=>reader.readDesignedSource(unknownMapperSource.row,unknownMapperSource.trusted),/program_identity/,'the reverse side must be the exact known old mapper');
const coreFile=join(repositoryRoot,'packages/engine/src/types.ts'),coreBytes=readFileSync(coreFile);
writeFileSync(coreFile,Buffer.concat([coreBytes,Buffer.from('\n')]));
assert.throws(()=>reader.readDesignedSource(historical.row,historical.trusted),/program_identity/,'known projection correction cannot relax any engine path');
writeFileSync(coreFile,coreBytes);
assert.equal(sha(readFileSync(join(repositoryRoot,evidenceFiles.get(historical.sourceFile.id).path))),historical.sourceFile.sha256,'original candidate bytes never change');
let proposalCalls=0,syntheticScoreCaptures=0;
const runtime:any={proposal:{identity,encoder:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'},candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY,createDecider:(seat:number)=>{
 const tracker=new PublicTracker();return {seat,tracker,newGame:()=>tracker.reset(),observe:(events:any)=>tracker.observe(events),decide:(s:any,options:any)=>{proposalCalls++;assert.deepEqual(options.candidatePolicy,FIRST_TARGET_CANDIDATE_POLICY);const c=dedupCandidates(legalCombos(s,FIRST_TARGET_CANDIDATE_POLICY.enumSpec.enumerationMode),canPass(s));return {candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY,move:c[0].combo?{pass:false,combo:c[0].combo}:{pass:true},nCands:c.length,explored:false,ranking:c.map(({combo},idx)=>({combo,idx,score:c.length-idx}))};}};
}},parent:{studentCapture:{studentParentRef:parentRef,scorer:receipt.target,network:{inputDim:423,forward:(_x:any,n:number)=>{syntheticScoreCaptures++;return new Float32Array(n);}}}}};
const b=bind(),snapshot=reader.readDesignedSnapshot(b.row,b.trusted,runtime);
assert.deepEqual(snapshot.state,state);assert.equal(snapshot.history.steps.length,2);assert.equal(snapshot.row.familyId,familyId);assert.equal(snapshot.row.blockFamilyId,familyId);assert.equal(snapshot.row.split,'train');assert.equal(snapshot.row.inputSHA256,sha(JSON.stringify(snapshot.input)));
assert.equal(proposalCalls,1);assert.equal(syntheticScoreCaptures,1);assert.equal(snapshot.input.schema,'ohuo-decision-input-first-round-v3');assert.equal(snapshot.input.studentInputs!.inputDim,423);assert.equal(snapshot.bundle.candidateSpec,'first-target-offer12-v1');assert.deepEqual(snapshot.input.initialCandidateIds,snapshot.bundle.initialCandidateIds);assert.equal(snapshot.normalizedDecisionIdentity.schema,'ohuo-normalized-common-decision-v1');assert.equal(snapshot.designedSource.targetExecuted,false);assert.deepEqual(commonViewForSnapshot(snapshot),snapshot.commonView);assert.deepEqual(commonDecisionIdentityForSnapshot(snapshot),snapshot.normalizedDecisionIdentity);
assert(Object.isFrozen(snapshot.bundle)&&Object.isFrozen(snapshot.bundle.pool)&&Object.isFrozen(snapshot.bundle.pool[0]),'consumer bundle must retain original deep freeze after snapshot clone');
// The new explicit source branch consumes the SAME original fake-transport
// response through query/checkpoint, candidate admission, reader/C and selector.
const v2Source=JSON.parse(JSON.stringify({...sourceInput,schema:reader.DESIGNED_FIRST_GAME_V2_SCHEMA,questionId:'design-fixture-v2'}));
for(const row of v2Source.moves)if(!row.move.pass){for(const k of ['size','length','keyRank','mainRank','pairRanks'])delete row.move.combo[k];}
const rawV2=' '+JSON.stringify(v2Source)+'\n',view=snapshot.commonView.modelPayload,requestedCoverage={...commonViewCoverageCell(view),hasNaturalNonJokerOption:view.candidates.some((c:any)=>!c.action.pass&&c.action.kind===view.state.currentTarget.kind&&c.action.wildCount===0&&!c.action.cards.some((p:any)=>p.card==='SJ'||p.card==='BJ')),ownHasFewerCardsThanPartner:view.state.myHand.reduce((n:number,c:any)=>n+c.count,0)<view.state.otherSeats.partner.remainingCards};
const request=prepareDesignedSourceRequest({questionId:v2Source.questionId,designFamilyId,engineSourceRef,rulesRef,ruleOptions:sourceInput.rules,coverage:requestedCoverage,firstGameOrigin:{leaderSeed,firstLeader:firstActor,previousPublicPrefixFailure:{gameNo:1,moveNo:0,expectedActorSeat:1,declaredActorSeat:0}},comboDeclarationContract:'engine-combo-fields-v2'});
const profileRef={profileId:'synthetic-v2',revision:1,snapshotHash:'b'.repeat(64)},profile={...profileRef,protocol:'openai-chat-completions',baseUrl:'https://fixture.invalid/v1',requestedModel:'fixture-only',requestOptions:{},secret:'synthetic-only-not-a-credential',credentialRevision:1};let fakeFetches=0;const checkpoints:any[]=[];
const transport=createProfileDesigner({reference:profileRef,store:{resolve:()=>profile},fetchImpl:(async(_url:any,options:any)=>{fakeFetches++;assert.deepEqual(JSON.parse(options.body).messages.at(-1),{role:'user',content:JSON.stringify(request)});return new Response('data: '+JSON.stringify({model:'fixture-only',choices:[{index:0,delta:{content:rawV2},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}) as any});
const queried=await queryDesignedSource({input:request,signal:new AbortController().signal,request:transport.request,checkpoint:null,onCheckpoint:async cp=>{checkpoints.push(JSON.parse(JSON.stringify(cp)));}});assert.equal(queried.status,'response',JSON.stringify(queried.checkpoint.result));assert.equal(fakeFetches,1);assert.deepEqual(queried.checkpoint.result!.response,v2Source);assert.equal(queried.checkpoint.result!.privateResponseText,rawV2);assert.equal(checkpoints.length,2);
const reused=await queryDesignedSource({input:request,signal:new AbortController().signal,checkpoint:checkpoints[1],request:async()=>{throw Error('must not resend');},onCheckpoint:async()=>{throw Error('must not rewrite');}});assert(reused.reused);assert.equal(fakeFetches,1);assert.deepEqual(inspectDesignedCandidateSource(rawV2).source,v2Source);
const v2Bound=bind(v2Source,index,rawV2),v2Reader=reader.createDesignedSourceReader(v2Bound.trusted),v2Before=sha(readFileSync(join(repositoryRoot,evidenceFiles.get(v2Bound.sourceFile.id).path))),admission=createDesignedCandidateAdmission({selectionRefs:[],rows:[]},async()=>new Set<string>()),admitted=await admission.inspect({reader:v2Reader,locator:v2Bound.row,runtime,requestedCoverage,acceptedIdentities:new Set<string>()});assert.equal(admitted.reason,null);const v2Snapshot=admitted.snapshot!;
assert.deepEqual(v2Snapshot.state,snapshot.state);assert.deepEqual(v2Snapshot.history.steps,snapshot.history.steps);assert.deepEqual(v2Snapshot.bundle.initialCandidateIds,snapshot.bundle.initialCandidateIds);assert.deepEqual(v2Snapshot.normalizedDecisionIdentity,snapshot.normalizedDecisionIdentity);assert.equal(v2Snapshot.designedSource.sourceInputSHA256,digest(v2Source));assert.notEqual(v2Snapshot.designedSource.replaySHA256,snapshot.designedSource.replaySHA256);assert(!Object.hasOwn(v2Reader.readSource(v2Bound.row).source.moves[0].move.combo,'size'));assert.equal(sha(readFileSync(join(repositoryRoot,evidenceFiles.get(v2Bound.sourceFile.id).path))),v2Before);assert.equal(v2Before,sha(rawV2));
const otherProgram=ref('fixture-v2-other-program',{...references.get(engineSourceRef),baseCommit:'b'.repeat(40)}),otherV2=bind({...v2Source,engineSourceRef:otherProgram});assert.notEqual(reader.readDesignedSource(otherV2.row,otherV2.trusted).replaySHA256,v2Snapshot.designedSource.replaySHA256,'v2 actual effects also bind sourceRevision');
const selected=selectDesignedPublicRepresentatives([{...v2Snapshot.row,decisionSHA256:sha(v2Source.questionId),normalizedDecisionIdentity:v2Snapshot.normalizedDecisionIdentity,commonViewCell:commonViewCoverageCell(v2Snapshot.commonView.modelPayload),eligibility:'eligible',exclusionReason:null}],[{familyId,split:'train'}]);assert.equal(selected.selected.length,1);
assert.equal(isDesignedCandidateSourceFailure(Error('designed_source_v2_declaration_zero')),true);assert.equal(isDesignedCandidateSourceFailure(Error('designed_source_v2_declaration_ambiguous')),true);assert.equal(isDesignedCandidateSourceFailure(Error('designed_source_program_identity')),false);
const invalidV2=structuredClone(v2Source);invalidV2.moves[0].move.combo.keyRank=4;const invalidBound=bind(invalidV2),earlyAdmission=createDesignedCandidateAdmission({selectionRefs:[],rows:[]},async()=>{throw Error('invalid v2 must not read history');});assert.equal((await earlyAdmission.inspect({reader:reader.createDesignedSourceReader(invalidBound.trusted),locator:invalidBound.row,runtime,requestedCoverage,acceptedIdentities:new Set<string>()})).reason,'designed_source_v2_declaration_zero');
const teacherSummary={profileId:'fixture-profile',revision:1,snapshotHash:'b'.repeat(64),credentialRevision:1,protocol:'openai-chat-completions',requestedModel:'fixture-only',returnedModel:null,requestCount:1,elapsedMs:0,upstreamChunks:1,upstreamEvents:1,contentEvents:1,keepaliveEvents:0,firstUpstreamMs:0,firstContentMs:0,usage:{}};
let syntheticTeacherCalls=0;const stateBeforeTeacher=sha(JSON.stringify(snapshot.state)),teacherResult=await queryOfflineTeacher({snapshot,teacher:{releaseRef:'fixture-teacher',promptRef:'fixture-prompt',profileSnapshot:{...teacherSummary}},commonView:snapshot.commonView,signal:new AbortController().signal,request:async view=>{syntheticTeacherCalls++;assert.equal(view.schema,'ohuo-common-view-request-r2');return {status:'response',response:{kind:'choose',decisionId:snapshot.bundle.decisionId,actionId:snapshot.bundle.initialCandidateIds.find(id=>snapshot.bundle.pool.find(c=>c.actionId===id)!.canonical===null)!},summary:teacherSummary} as any;}});
assert.equal(teacherResult.status,'selected');assert.equal(teacherResult.offlineLabel?.legality,'validated');assert.equal(syntheticTeacherCalls,1);assert.equal(sha(JSON.stringify(snapshot.state)),stateBeforeTeacher,'teacher selection does not execute target');
for(const field of ['record','decision','recordRef','seed','actualActionId'])assert(!Object.hasOwn(snapshot,field));
assert(snapshot.bundle.initialCandidateIds.some(id=>snapshot.bundle.pool.find(c=>c.actionId===id)!.canonical===null));assert(snapshot.bundle.initialCandidateIds.some(id=>snapshot.bundle.pool.find(c=>c.actionId===id)!.canonical!==null));assert(!snapshot.commonView.modelPayloadBytes.includes('design-fixture'));assert(!snapshot.commonView.modelPayloadBytes.includes('rawQ'));
const session=reader.createDesignedSourceReader(b.trusted),sessionSnapshot=session.readSnapshot(b.row,runtime),callsBeforeReuse=proposalCalls;sessionSnapshot.state.hands[0].pop();const unchanged=session.readSnapshot(snapshot.row,runtime);assert.equal(proposalCalls,callsBeforeReuse,'same fixed source/runtime does not rerun B-prime or S0');assert.deepEqual(unchanged.state,state,'branch mutation cannot change cached source');assert.deepEqual(unchanged.input,snapshot.input);assert.deepEqual(unchanged.normalizedDecisionIdentity,snapshot.normalizedDecisionIdentity);
const encoderBefore=runtime.proposal.encoder;runtime.proposal.encoder={...encoderBefore,ctxFill:'zero'};assert.throws(()=>session.readSnapshot(b.row,runtime),/fixed_runtime_changed/);runtime.proposal.encoder=encoderBefore;
const forwardBefore=runtime.parent.studentCapture.network.forward;runtime.parent.studentCapture.network.forward=()=>new Float32Array(1);assert.throws(()=>session.readSnapshot(b.row,runtime),/fixed_runtime_changed/);runtime.parent.studentCapture.network.forward=forwardBefore;
const indexRefBefore=b.trusted.sourceIndexRef;b.trusted.sourceIndexRef='changed-index@sha256:'+'0'.repeat(64);assert.throws(()=>session.readSnapshot(b.row,runtime),/fixed_context_changed/);b.trusted.sourceIndexRef=indexRefBefore;
const renamed=structuredClone(sourceInput);renamed.questionId='renamed';const ren=bind(renamed),renamedSnapshot=reader.readDesignedSnapshot(ren.row,ren.trusted,runtime);assert.notEqual(renamedSnapshot.row.inputSHA256,snapshot.row.inputSHA256);assert.deepEqual(renamedSnapshot.normalizedDecisionIdentity,snapshot.normalizedDecisionIdentity,'global ID changes cannot avoid normalized identity');
const reject=(change:(v:any)=>void,reason:RegExp)=>{const v=structuredClone(sourceInput);change(v);const x=bind(v);assert.throws(()=>reader.readDesignedSnapshot(x.row,x.trusted,runtime),reason);};
reject(v=>{v.initialIds[0][0]=v.initialIds[1][0];},/every canonical physical card/);
reject(v=>{v.moves[0].actorSeat=(v.moves[0].actorSeat+1)%4;},/prefix_origin/);
reject(v=>{v.moves[0].move={pass:true};},/illegal pass/);
reject(v=>{v.moves[0].move.combo.keyRank++;},/declared legal action identity mismatch/);
reject(v=>{v.target.remainingCards[0]--;},/target_mismatch/);
reject(v=>{v.state={turn:0};},/unknown_field/);
reject(v=>{v.rules.straightLen=6;},/unsupported_rules/);
reject(v=>{v.split='dev';},/train_only/);
for(const family of [familyId,designFamilyId]){const bad=structuredClone(index);bad.families[family].split='dev';const x=bind(sourceInput,bad);assert.throws(()=>reader.readDesignedSnapshot(x.row,x.trusted,runtime),/family_split/);}
for(const family of [familyId,designFamilyId]){const bad=structuredClone(index);delete bad.families[family].rootFamilyId;delete bad.families[family].parentFamilyIds;const x=bind(sourceInput,bad);assert.throws(()=>reader.readDesignedSnapshot(x.row,x.trusted,runtime),/explicit_family_ownership/);}
const cycle=structuredClone(index);cycle.families[familyId].parentFamilyIds=[designFamilyId];const cy=bind(sourceInput,cycle);assert.throws(()=>reader.readDesignedSnapshot(cy.row,cy.trusted,runtime),/family_cycle|root_parent/);
const unknown=structuredClone(index);unknown.families[designFamilyId].parentFamilyIds=['missing-ancestor'];const un=bind(sourceInput,unknown);assert.throws(()=>reader.readDesignedSnapshot(un.row,un.trusted,runtime),/family_unregistered/);
const ancestry=structuredClone(index);ancestry.families['legacy-dev-root']={split:'dev'};ancestry.families[designFamilyId].parentFamilyIds.push('legacy-dev-root');const an=bind(sourceInput,ancestry);assert.throws(()=>reader.readDesignedSnapshot(an.row,an.trusted,runtime),/family_split|family_root/);
assert.throws(()=>reader.readDesignedSnapshot({...b.row,inputSHA256:'0'.repeat(64)} as any,b.trusted,runtime),/selected_identity/);
const stale=bind();writeFileSync(stale.trusted.sourceIndexPath,JSON.stringify(index)+' ');assert.throws(()=>reader.readDesignedSnapshot(stale.row,stale.trusted,runtime),/source_index_identity/);
const changed=bind();writeFileSync(join(repositoryRoot,evidenceFiles.get(changed.sourceFile.id).path),JSON.stringify(renamed));assert.throws(()=>reader.readDesignedSnapshot(changed.row,changed.trusted,runtime),/evidence_hash/);
const invalidRuntime={...runtime,proposal:{...runtime.proposal,identity:{...identity,weightsSHA256:'0'.repeat(64)}}};assert.throws(()=>reader.readDesignedSnapshot(b.row,b.trusted,invalidRuntime),/runtime_identity/);
const noPass={...runtime,proposal:{...runtime.proposal,createDecider:(seat:number)=>{const d=runtime.proposal.createDecider(seat),decide=d.decide;d.decide=(s:any,o:any)=>{const r=decide(s,o),ranking=r.ranking.filter((v:any)=>v.combo!==null).map((v:any,idx:number)=>({...v,idx}));return {...r,nCands:ranking.length,ranking};};return d;}}};assert.throws(()=>reader.readDesignedSnapshot(b.row,b.trusted,noPass),/target_candidates/);
const noCover={...runtime,proposal:{...runtime.proposal,createDecider:(seat:number)=>{const d=runtime.proposal.createDecider(seat);d.decide=()=>({candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY,move:{pass:true},nCands:1,explored:false,ranking:[{combo:null,idx:0,score:1}]});return d;}}};assert.throws(()=>reader.readDesignedSnapshot(b.row,b.trusted,noCover),/target_candidates/);
const privateMode=bind();const privatePath=join(repositoryRoot,evidenceFiles.get(privateMode.sourceFile.id).path);chmodSync(privatePath,0o644);assert.throws(()=>reader.readDesignedSnapshot(privateMode.row,privateMode.trusted,runtime),/private_source_permissions/);
const pathId={...b.registration.sourceFile,id:'offline-selection/source-fixture'};evidenceFiles.set(pathId.id,evidenceFiles.get(b.sourceFile.id));const pathRegistration={...b.registration,sourceFile:pathId},pathRow={sourceKind:'designed-synthetic' as const,sourceRef:ref('path-evidence',pathRegistration)};assert.equal(reader.readDesignedSource(pathRow,b.trusted).source.questionId,sourceInput.questionId);
const refSession=reader.createDesignedSourceReader(b.trusted);refSession.readSource(b.row);const registeredBefore=references.get(b.row.sourceRef);references.set(b.row.sourceRef,{...registeredBefore,questionId:'changed-ref'});assert.throws(()=>refSession.readSource(b.row),/fixed_reference_changed/);references.set(b.row.sourceRef,registeredBefore);
const engineFile=join(repositoryRoot,reader.DESIGNED_SOURCE_PROGRAM_PATHS[0]);writeFileSync(engineFile,readFileSync(engineFile,'utf8')+'\n');assert.throws(()=>reader.readDesignedSnapshot(b.row,b.trusted,runtime),/program_identity/);assert.throws(()=>session.readSnapshot(b.row,runtime),/fixed_file_changed/);
console.log(JSON.stringify({case:'source.designed-first-game',status:'passed',sourceKind:'designed-synthetic',finitePrefixMoves:2,originalEngineAndCaptures:true,authoritativeIndexAndDerivations:true,actualPassTakeoverInC:true,normalizedCommonIdentity:true,v2FakeTransportRequests:fakeFetches,v2RawAndSourceInputPreserved:true,v2CheckpointReused:true,v2CandidateAdmissionAndSelection:true,v2ReplayBindsSourceRevision:true,providerRequests:0,realModelCalls:0,syntheticTeacherCalls,syntheticScoreCaptures,optimizerUpdates:0,scientificRunsCreated:0,productionAdmissionProven:false}));
