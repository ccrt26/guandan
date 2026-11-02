/** One finite metadata-only source producer case. No model/teacher/match/update. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createMatch,startGame,DEFAULT_RULES} from '@gd/engine';
import {deriveSeed} from '@gd/ai';
import {indexedDealSeed} from '../../review6/match-play';
import {engineDealFamily} from '../../review6/capability-lineage';
import {dealtFamilyBeforeExchange} from '../../review6/training-ancestry';
import {referenceOf,digest} from '../task-schema.mjs';
import {buildFirstRoundRegistryPolicyEnvelope} from '../first-round-registry-policy';
import {planFirstRoundConfirmation} from '../first-round-evaluation';
import {freezeFirstRoundQueueLayouts} from '../match-consumer';
import {RELEASES} from '../../../packages/ai/src/policy/seats';
import {FIRST_TARGET_CANDIDATE_POLICY} from '../../../packages/ai/src/candidate-spec';
import {LEGACY_O_POLICY_REF,policyParameterCount} from '../../../packages/ai/src/policy/resolve';
const sha=(b:any)=>createHash('sha256').update(b).digest('hex');
export async function checkFirstRoundSources(){
 const moduleURL=new URL('../first-round-source.ts',import.meta.url);
 assert(existsSync(moduleURL),'missing actual first-round frozen-input source producer');
 const {prepareFirstRoundSources,bindFirstRoundSources}=await import(moduleURL.href);
 const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url)).replace(/\/$/,'');
 mkdirSync(join(repositoryRoot,'lab/out'),{recursive:true});const root=mkdtempSync(join(repositoryRoot,'lab/out/S35-source-fixed-'));
 const references=new Map<string,any>(),evidenceFiles=new Map<string,any>();
 const ref=(id:string,value:any)=>{const r=referenceOf(id,value);references.set(r,value);return r;};
 const file=(id:string,value:any)=>{const path=join(root,id+'.json'),bytes=JSON.stringify(value)+'\n';writeFileSync(path,bytes,{flag:'wx'});const f={id,sha256:sha(bytes)};evidenceFiles.set(id,{path:relative(repositoryRoot,path),sha256:f.sha256});return f;};
 // Original migration validator exercises metadata only. No weights are created/read.
 const receipt=JSON.parse(readFileSync(new URL('./fixtures/s35-migration-metadata.json',import.meta.url),'utf8'));
 const migrationReceiptRef=file('migration-metadata',receipt),source=receipt.parentRef;
 const identity={policyId:source.policyId,modelVersion:source.modelVersion,weightsSHA256:source.weightsSHA256,inputDim:399,encoderVersion:source.encoder.encoderVersion,candidateVersion:source.candidateSpecId,passEncoding:source.encoder.passEncoding,architectureId:source.architectureId,weightsLayoutVersion:source.weightsLayoutVersion,epsilon:0,tieBreakId:source.tieBreakId,tierSpecId:source.tierSpecId};
 const parentRef=ref('fixture-S0',{schema:'ohuo-student-parent-ref-v1',scorer:receipt.target,migrationReceiptRef,basePolicyIdentity:identity});
 const old=RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1')!,baseRef=ref('fixture-B',{schema:'ohuo-release-ref-v1',release:old,policyIdentity:identity});
 const proposalRef=ref('fixture-B-prime',{schema:'ohuo-candidate-research-release-ref-v1',parentRef:baseRef,release:{...old,releaseRef:'fixture-source-B-prime',label:'Fixture B prime',status:'development',parentRelease:old.releaseRef,candidateSpecRef:'first-target-offer12-v1',promptRef:'ohuo-engine-rules-v1/choose-only-v2'},policyIdentity:identity,candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY});
 const comparisonRef=ref('fixture-comparison',{schema:'ohuo-first-round-comparison-v1',proposalRef,studentParentRef:parentRef});
 const descriptor=(id:string,dim=399)=>({...source,policyId:id,modelVersion:'engineering-fixture-only',weightsPathOrUrl:{nodePath:'lab/out/never-read-'+id+'.f32'},weightsSHA256:sha(id),inputDim:dim,parameterCount:policyParameterCount(dim),encoder:dim===399?source.encoder:{schema:'v1',ctxFill:'none',passEncoding:'legacy-phys10',encoderVersion:'gd-lab-schema-v1'},candidateSpecId:dim===399?'cand-suit-v3':'cand-dedup-v2',tierSpecId:'none'});
 const partners=[0,1,2].map(i=>descriptor('fixture-partner-'+i)),otherPartners=[0,1,2].map(i=>descriptor('fixture-unused-'+i)),opponent=descriptor(LEGACY_O_POLICY_REF,385),student=descriptor('fixture-clean');
 const policy=(d:any)=>({policyId:d.policyId,kind:'neural',weightsPath:join(repositoryRoot,d.weightsPathOrUrl.nodePath),weightsSHA256:d.weightsSHA256,inputDim:d.inputDim,encoder:d.inputDim===399?{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'}:{candidateCompat:'v2',passEncoding:'legacy-phys10'},epsilon:0});
 const registry={schemaVersion:'r6-no-H-policy-registry-v1',selectedExperiment:'direct_teacher_no_h',oldCompletePolicy:opponent.policyId,cleanStudent:student.policyId,policies:[student,opponent,...partners,...otherPartners].map(policy),trainingPool:[student.policyId,opponent.policyId],developmentPartners:partners.map(d=>d.policyId),confirmationPartners:otherPartners.map(d=>d.policyId),profiles:{primary:{actingPolicyId:student.policyId,partnerPolicyId:student.policyId,opponentPolicyIds:[opponent.policyId,opponent.policyId]}}};
 const registryRef=file('registry-fixture',registry),peer=(d:any)=>ref('fixture-peer-'+d.policyId,buildFirstRoundRegistryPolicyEnvelope({registryRef,policyId:d.policyId,repositoryRoot,role:d.policyId===opponent.policyId?'opponent':'partner',readEvidence:f=>readFileSync(join(repositoryRoot,evidenceFiles.get(f.id).path))}));
 const partnerRefs=partners.map(peer),opponentRef=peer(opponent),s0Ref=ref('fixture-composite-S0',{schema:'ohuo-first-round-s0-release-ref-v1',policyId:'first-round-s0-'+digest({proposalRef,studentParentRef:parentRef}).slice(0,16),proposalRef,studentParentRef:parentRef});
 const excluded=file('prior-source-index',{version:1,families:{'fixture-historical-root':{split:'dev'}}}),names=['pilot','formal','newTest','variancePilot','confirmation'];
 const spec:any={schema:'ohuo-first-round-source-spec-v1',purpose:'engineering_fixture',outputId:root.split('/').at(-1)+'-produced',reservationRef:null,planRef:ref('fixture-plan',{purpose:'engineering_fixture'}),rulesRef:ref('fixture-rules',DEFAULT_RULES),seed:20261101,registryRef,partnerPolicyIds:partners.map(d=>d.policyId),opponentPolicyId:opponent.policyId,comparisonRef,bindings:{partnerRefs,opponentRef,s0Ref,s1Ref:null,s1ReleaseFileRef:null},stages:Object.fromEntries(names.map(name=>[name,{namespace:'fixture-source-'+name,dealNamespace:'fixture-deal-'+name,activeCount:name==='pilot'?2:name==='formal'?4:null}])),confirmationPlanningRef:null,exclusionIndexRefs:[excluded]};
 const run=(s:any)=>prepareFirstRoundSources({specRef:ref('fixture-source-spec',s),repositoryRoot,references,evidenceFiles});
 const result=run(spec),manifest=result.manifest;
 assert.equal(manifest.qualification.eligible,false);assert.equal(manifest.actualMatches,0);assert.equal(manifest.modelForwardCalls,0);
 assert.deepEqual(manifest.stages.map((s:any)=>s.reservedRoots.length),[2,4,2,4,8]);
 assert.deepEqual(manifest.stages.map((s:any)=>s.queue?.rows.length??0),[12,24,0,0,0]);
 assert(manifest.stages.slice(2).every((s:any)=>s.queueRef===null&&s.status==='pending'));
 for(const stage of manifest.stages){if(stage.queue){assert.equal(Object.keys(stage.layoutIdentitySHA256??{}).length,6,'source must invoke original prepared-layout serializer, not leave full identity for manual JSON');assert.equal(stage.layoutIdentityStatus,'frozen_original_prepared_seat_snapshot');assert.deepEqual(stage.layoutIdentitySHA256,freezeFirstRoundQueueLayouts({queue:stage.queue,queueRef:stage.queueRef,comparisonRef,rules:DEFAULT_RULES,readReference:(r:string)=>references.get(r),readEvidence:(f:any)=>readFileSync(join(repositoryRoot,evidenceFiles.get(f.id).path)),repositoryRoot}).layoutIdentitySHA256);}else assert.equal(stage.layoutIdentitySHA256,null);}
 const formal=manifest.stages.find((s:any)=>s.stage==='formal'),pilot=manifest.stages[0];
 assert.equal(formal.reservedRoots.filter((r:any)=>r.split==='train').length,2);assert.equal(formal.reservedRoots.filter((r:any)=>r.split==='dev').length,2);
 const families=manifest.stages.flatMap((s:any)=>s.reservedRoots.flatMap((r:any)=>r.roundFamilyIds));assert.equal(families.length,1600);assert.equal(new Set(families).size,1600);
 for(const stage of [pilot,formal])for(const row of stage.queue.rows){assert.equal(row.roundFamilyIds.length,80);assert.equal(row.actor,row.side);assert.equal(row.seats[row.actor].releaseRef,proposalRef);assert.equal(row.seats[(row.actor+2)%4].releaseRef,partnerRefs[row.group]);assert.equal(row.seats[(row.actor+1)%4].releaseRef,opponentRef);assert.equal(row.seats[(row.actor+3)%4].releaseRef,opponentRef);assert.equal(row.roundFamilyIds[0],row.sourceFamilyId);assert(stage.taskProjections.find((t:any)=>t.sourcePlan.split===row.split).sourcePlan.familyIds.includes(row.roundFamilyIds[79]));}
 const first=pilot.reservedRoots[0],seed=deriveSeed(spec.stages.pilot.namespace,spec.seed,0,'source-match');assert.equal(first.seed,seed);
 const game2=startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(spec.stages.pilot.dealNamespace,seed,1)));assert.equal(engineDealFamily(game2.hands),first.roundFamilyIds[1]);assert.equal(dealtFamilyBeforeExchange(game2),first.roundFamilyIds[1]);assert.notEqual(first.roundFamilyIds[0],first.roundFamilyIds[1]);
 const continuing=createMatch({...DEFAULT_RULES},indexedDealSeed(spec.stages.pilot.dealNamespace,seed,1));continuing.gameNo=1;continuing.levels=[5,2];continuing.lastHead=0;continuing.lastResult={finishOrder:[0,2,1,3],winnerTeam:0,doubleUp:true,levelsAfter:[5,2],upgrade:3,passedA:false};
 const actualSecond=startGame(continuing);assert.equal(actualSecond.match.gameNo,2);assert(actualSecond.tribute);assert.equal(dealtFamilyBeforeExchange(actualSecond),first.roundFamilyIds[1],'actual game2 original tribute reversal maps back to the reserved pre-exchange family');
 assert.equal(engineDealFamily([...game2.hands.slice(1),game2.hands[0]]),first.roundFamilyIds[1],'original canonical family survives seat rotation');
 assert.equal(first.deals[1].canonicalDealSHA256,sha(JSON.stringify(game2.hands.map(h=>h.map(c=>c.id).sort((a,b)=>a-b)))));
 assert.equal(run(spec).status,'unchanged','exact manifest/files noop, not regeneration');
 const changed=structuredClone(spec);changed.outputId+='-namespace';changed.stages.pilot.namespace+='-other';changed.stages.pilot.dealNamespace+='-other';assert.notEqual(run(changed).manifest.stages[0].reservedRoots[0].familyId,first.familyId);
 const collide=structuredClone(spec);collide.outputId+='-collision';collide.exclusionIndexRefs=[file('collision-index',{version:1,families:{[first.roundFamilyIds[1]]:{split:'sealed'}}})];assert.throws(()=>run(collide),/collision/);assert(!existsSync(join(repositoryRoot,'lab/out',collide.outputId)));
 const bad=structuredClone(spec);bad.outputId+='-alias';bad.stages.newTest.namespace=bad.stages.pilot.namespace;assert.throws(()=>run(bad),/namespace/);
 const wrong=structuredClone(spec);wrong.outputId+='-unknown';wrong.bindings.s1Ref='missing@sha256:'+'a'.repeat(64);assert.throws(()=>run(wrong),/reference/);
 // Separate explicit simulated selected-S1 metadata tests paired queue assembly,
 // never claiming an actual selection, match, weights file, or research readiness.
 const selected=structuredClone(spec);selected.outputId+='-paired-fixture';
 const scorer={...receipt.target,policyId:'fixture-selected-scorer',modelVersion:'fixture-selected',weightsSHA256:sha('fixture-never-read-S1'),weightsPathOrUrl:{nodePath:'lab/out/never-read-S1.f32'}};
 const s1File=file('simulated-selected-S1',{schema:'ohuo-student-release-first-round-v3',trainingKind:'supervised_rerank',policyId:'fixture-selected-S1',proposer:{policyRef:source.policyId,identity},proposalRef,learningParent:{ref:parentRef,scorer:receipt.target,migrationReceiptRef},scorer,candidateSpecRef:'first-target-offer12-v1',candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY,tieBreakId:'first-candidate-v1',checkpoint:{path:'lab/out/not-a-real-checkpoint.json',sha256:sha('fixture-checkpoint')},dataset:{id:'fixture-dataset',sha256:sha('fixture-dataset')},recipe:{id:'first-round-partner-control-fixed64-v1',sha256:sha('fixture-recipe')},selection:{id:'fixture-selection',sha256:sha('fixture-selection')}});
 selected.bindings.s1Ref=ref('fixture-selected-S1-ref',{schema:'ohuo-student-task-release-v1',policyId:'fixture-selected-S1',releaseSHA256:s1File.sha256});selected.bindings.s1ReleaseFileRef=s1File;
 selected.stages.newTest.activeCount=2;selected.stages.variancePilot.activeCount=4;selected.stages.confirmation.activeCount=2;
 const planningInputs={pilotBlocks:4,sPlan:1,reservedSeconds:24,slowestBlockSeconds:12,remainingMatchAttempts:24};selected.confirmationPlanningRef=ref('fixture-confirmation-planning',{schema:'ohuo-first-round-source-confirmation-planning-v1',inputs:planningInputs,planning:planFirstRoundConfirmation(planningInputs)});
 evidenceFiles.set(result.manifestRef.id,result.manifestFile);
 const binding={schema:'ohuo-first-round-source-binding-v1',reservationRef:result.manifestRef,outputId:selected.outputId,s0Ref:selected.bindings.s0Ref,s1Ref:selected.bindings.s1Ref,s1ReleaseFileRef:selected.bindings.s1ReleaseFileRef,activeCounts:{newTest:2,variancePilot:4,confirmation:2},confirmationPlanningRef:selected.confirmationPlanningRef};
 const bindingRef=ref('fixture-later-source-binding',binding),bound=bindFirstRoundSources({bindingRef,repositoryRoot,references,evidenceFiles}),paired=bound.manifest;assert.deepEqual(paired.reservationRef,result.manifestRef);assert.equal(paired.planRef,spec.planRef);
 const attemptedReseed=structuredClone(paired.references.find((r:any)=>r.ref===paired.specRef).value);attemptedReseed.seed++;attemptedReseed.outputId+='-forbidden-reseed';assert.throws(()=>run(attemptedReseed),/reservation_identity/);
 const wrongOutput={...binding,outputId:spec.outputId};assert.throws(()=>bindFirstRoundSources({bindingRef:ref('fixture-invalid-output-binding',wrongOutput),repositoryRoot,references,evidenceFiles}),/new_output/);
assert.deepEqual(paired.stages.map((s:any)=>s.queue?.rows.length??0),[12,24,24,48,24]);
 for(const stage of paired.stages.slice(2))assert.deepEqual(stage.layoutIdentitySHA256,freezeFirstRoundQueueLayouts({queue:stage.queue,queueRef:stage.queueRef,comparisonRef,rules:DEFAULT_RULES,readReference:(r:string)=>references.get(r),readEvidence:(f:any)=>readFileSync(join(repositoryRoot,evidenceFiles.get(f.id).path)),repositoryRoot,studentReleaseFileRef:s1File}).layoutIdentitySHA256);
 for(let n=0;n<5;n++){assert.deepEqual(paired.stages[n].reservedRoots,manifest.stages[n].reservedRoots,'policy/count binding must not reseed reserved ancestry');assert.equal(paired.stages[n].sourceIndexRef,manifest.stages[n].sourceIndexRef);}
 for(const stage of paired.stages.slice(2))for(const r of stage.queue.rows.filter((r:any)=>r.variant==='S0')){const s=stage.queue.rows.find((s:any)=>s.sourceFamilyId===r.sourceFamilyId&&s.group===r.group&&s.side===r.side&&s.variant==='S1');assert(s);assert.deepEqual([r.seed,r.dealNamespace,r.roundFamilyIds,r.actor,r.maxGames,r.maxMovesPerGame],[s.seed,s.dealNamespace,s.roundFamilyIds,s.actor,s.maxGames,s.maxMovesPerGame]);assert(r.seats.every((seat:any,i:number)=>i===r.actor||JSON.stringify(seat)===JSON.stringify(s.seats[i])));assert.equal(r.seats[r.actor].releaseRef,s0Ref);assert.equal(s.seats[s.actor].releaseRef,selected.bindings.s1Ref);}
 const invalidS1=structuredClone(selected);invalidS1.outputId+='-wrong-file';invalidS1.bindings.s1ReleaseFileRef=migrationReceiptRef;assert.throws(()=>run(invalidS1),/S1_reference/);
 const invalidN=structuredClone(selected);invalidN.outputId+='-wrong-N';invalidN.stages.confirmation.activeCount=3;assert.throws(()=>run(invalidN),/prefrozen_N/);
 const overwrite=structuredClone(spec);overwrite.seed++;assert.throws(()=>run(overwrite),/existing_output_conflict/);
 const rawIndex=readFileSync(join(repositoryRoot,result.files.find((f:any)=>f.id.endsWith('pilot-source-index')).file.path));assert.equal(sha(rawIndex),pilot.sourceIndexValue.fileSHA256);
 const cliBindingBytes=JSON.stringify({schema:'ohuo-first-round-source-input-v1',specRef:bindingRef,references:[...references].map(([ref,value])=>({ref,value})),evidenceFiles:[...evidenceFiles].map(([id,file])=>({id,file}))})+'\n';writeFileSync(join(root,'cli-binding-input.json'),cliBindingBytes,{flag:'wx'});
 const inputBytes=JSON.stringify({schema:'ohuo-first-round-source-input-v1',specRef:ref('fixture-source-spec',spec),references:[...references].map(([ref,value])=>({ref,value})),evidenceFiles:[...evidenceFiles].map(([id,file])=>({id,file}))})+'\n';writeFileSync(join(root,'cli-input.json'),inputBytes,{flag:'wx'});
 return {status:'PARTIAL_SOURCE_PASS',engineeringFixture:true,eligible:false,outputRoot:result.outputRoot,inputPath:join(root,'cli-input.json'),inputSHA256:sha(inputBytes),bindingInputPath:join(root,'cli-binding-input.json'),bindingInputSHA256:sha(cliBindingBytes),reservedIndependentRoots:20,reservedFutureFamilies:1600,runnableQueueRows:36,laterQueues:'pending-no-S1-no-N',game2OriginalMapping:true,collisionRejected:true,exactNoop:true,pairedPolicyFixture:true,allBoundIdentitiesStable:true,originalReservationLateBinding:true,actualMatches:0,modelForwardCalls:0,optimizerSteps:0,providerRequests:0};
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)console.log(JSON.stringify(await checkFirstRoundSources()));
