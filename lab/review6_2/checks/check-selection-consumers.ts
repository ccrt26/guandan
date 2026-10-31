/** Newly introduced guards only; historical mathematics checks are not rerun. */
import assert from 'node:assert/strict';
import {freezeDataset} from '../distill-data';
import {createOfflineLabelConsumer} from '../offline-label-consumer';
assert.deepEqual(process.argv.slice(2),['--case','selection-consumers']);
globalThis.fetch=async()=>{throw Error('real_network_forbidden');};
const c=createOfflineLabelConsumer({profileStore:{resolve(){throw Error('profile read before guard');}},mode:'research'});
const task:any={taskKind:'collect',operationScope:{apiCalls:true},datasetRefs:['old'],limits:{maxOptimizerSteps:0,maxMatchAttempts:0}};
await assert.rejects(c.prepare({task,refs:new Map([['old',{schema:'ohuo-offline-label-selection-v1'}]]),inputs:{}}),/require selection v2/);
assert.throws(()=>freezeDataset({plan:{purpose:'stage4'},rows:[],sourceIndexPath:'/never-read',outputDir:'/never-write'} as any),/stage4_selection_proof_required/);
console.log(JSON.stringify({caseId:'selection-consumers',phase:'new-guards',status:'passed',realNetwork:0,modelForwards:0,parameterUpdates:0}));
const {fixture,byteSHA}=await import('./selection-fixture');
const {prepareOfflineSelection,verifyOfflineSelection}=await import('../offline-selection');
const {readOfflineSnapshot}=await import('../offline-label-source');
const {loadFrozenDataset,dataHash}=await import('../distill-data');
const {RELEASES}=await import('../../../packages/ai/src/policy/seats');
const {readFileSync,writeFileSync}=await import('node:fs');
const {canonical,digest}=await import('../task-schema.mjs');
const {join,relative}=await import('node:path');
const f=fixture(true),prepared=prepareOfflineSelection(f.spec,f.trusted);f.register(prepared);
const t={...f.trusted,phase:'dataset' as const},verified=verifyOfflineSelection(prepared.selection,t);
assert.equal(verified.sourceInventory.length,12);assert.ok(verified.sourceInventory.every(r=>r.status==='completed'));
assert.equal(verified.production.verification,'reproduced');
assert.ok(verified.selectedMetadata.some(m=>m.sampleKind==='keep'));
const actualProfile:any={profileId:'mock-profile',revision:3,credentialRevision:7,protocol:'openai-chat-completions',requestedModel:'mock-only',baseUrl:'https://mock.invalid/v1',secret:'synthetic-not-a-credential',requestOptions:{max_tokens:128}},profileRef={profileId:actualProfile.profileId,revision:actualProfile.revision,snapshotHash:'c'.repeat(64)},profileStore={resolve:(r:any)=>{assert.deepEqual(r,profileRef);return structuredClone(actualProfile);}};
const h=RELEASES.find(r=>r.releaseRef==='ohuo-1030-h-v1')!,teacherReleaseRef=f.ref('teacher-release',{schema:'ohuo-release-ref-v1',release:h,policyIdentity:f.policyIdentity}),labelPolicyRef=f.ref('teacher',{schema:'ohuo-offline-teacher-ref-v1',releaseRef:teacherReleaseRef,profileRevisionRef:profileRef}),promptRef=f.ref('prompt',{schema:'ohuo-prompt-ref-v1',promptRef:h.promptRef});
const labelClauseRef=f.ref('synthetic-label-clause',{scope:'selection-label-software-check'});assert.notEqual(labelClauseRef,f.spec.clauseRef);
const labelCap=f.ref('label-cap',{id:'B07.offline-label.v1',kind:'collect',mode:'offline_synthetic'});
const rulesRef=f.ref('rules',{...readOfflineSnapshot(prepared.selection.rows[0]).record.rules});
let count=0;const consumer=createOfflineLabelConsumer({profileStore,mode:'offline_synthetic',fetchImpl:async()=>{count++;throw Error('prepare cannot query');}}),both:any[]=[];
for(const split of ['train','dev']){
 const task:any={taskKind:'collect',runId:'label-'+split,taskId:'label-'+split,researchBatchId:'synthetic',capabilityRef:labelCap,outputRoot:join(f.root,'label-'+split),planRef:f.spec.planRef,budgetRef:(JSON.parse(readFileSync(join(f.trusted.repositoryRoot,f.files.get(f.spec.quotaBasisRef.id)!.path),'utf8'))).budgetRef,planScope:{clauseRef:labelClauseRef,branchRef:null},operationScope:{apiCalls:false},datasetRefs:[prepared.selectionRef],limits:{maxOptimizerSteps:0,maxMatchAttempts:0,maxLabelDecisions:8},sourcePlan:{namespace:'synthetic-selection',sourceIndexRef:f.spec.sourceIndexRef,familyIds:[split+'0'],split},seatLayoutPlan:f.spec.queueRef,rulesRef,parentPolicyRef:f.spec.actingReleaseRef,labelPolicyRef,releaseRefs:[f.spec.actingReleaseRef,teacherReleaseRef],promptRef};
 const p=await consumer.prepare({task,refs:f.refs,inputs:{sourceIndexPath:f.trusted.sourceIndexPath,confirmedRecordRoots:f.trusted.confirmedRecordRoots,offlineSelection:{...t,phase:'label-start',task}}});
 assert.ok(p.snapshots.every(s=>s.row.split===split));assert.equal(p.selection.productionRef,prepared.productionRef);both.push({...p,task});
}
assert.equal(count,0);assert.equal(both.reduce((n,p)=>n+p.snapshots.length,0),prepared.selection.selectedCount);
const teacher=both[0].teacher,rows:any[]=verified.selectedMetadata.map(m=>{const source=verified.population.find(p=>p.decisionId===m.decisionId)!,s=readOfflineSnapshot(source);return{sampleKind:m.sampleKind,sampleClass:m.sampleClass,match:s.record,record:s.decision,privateInput:s.input};});
const plan:any={schema:'ohuo-distill-plan-v1',datasetId:'selection-proof-synthetic',purpose:'engineering_fixture',sourceIndexRef:f.spec.sourceIndexRef,sourceIndexSHA256:byteSHA(readFileSync(f.trusted.sourceIndexPath)),queueRef:f.spec.queueRef,queueSHA256:dataHash(f.queue),samplingRef:prepared.productionRef,identities:{basePolicy:f.policyIdentity,teacher,encoderVersion:f.policyIdentity.encoderVersion,encoderConfig:f.encoder,candidateSpecRef:rows[0].privateInput.candidateSpec,promptRef:teacher.promptRef},families:['train','dev'].map(split=>({sourceFamily:split+'0',split,sourceRefs:['source-'+split]})),games:verified.sourceInventory.flatMap(i=>{const p=verified.population.find(p=>p.key.matchId===i.matchId)!,s=readOfflineSnapshot(p);return s.record.games.map(g=>({matchId:i.matchId,gameNo:g.gameNo,sourceFamily:g.sourceFamilyId,split:s.record.split,sourceRef:'source-'+s.record.split,sourceSHA256:g.sourceSHA256,actorSeat:s.record.evaluatedActor}));})};
const proof={selection:prepared.selection,production:prepared.production,resolvedInputs:t};
const frozen=freezeDataset({plan,sourceIndexPath:f.trusted.sourceIndexPath,sourceQueue:f.queue,rows,outputDir:join(f.root,'proof-dataset'),selectionProof:proof}),loaded=loadFrozenDataset(frozen);
assert.equal(loaded.manifest.qualification.eligible,false);assert.ok(loaded.manifest.qualification.reasons.includes('engineering_fixture_not_training'));
assert.equal(loaded.manifest.exclusions.filter((e:any)=>e.reason==='preselected_label_missing').length,prepared.selection.selectedCount);
assert.equal(loaded.samples.length,verified.selectedMetadata.filter(m=>m.sampleKind==='keep').length);
assert.throws(()=>freezeDataset({plan,sourceIndexPath:f.trusted.sourceIndexPath,sourceQueue:f.queue,rows:rows.slice(1),outputDir:join(f.root,'subset'),selectionProof:proof}),/full_preselected_rows/);
const wrong=structuredClone(rows);wrong[0].sampleClass=wrong[0].sampleClass==='target'?'ordinary':'target';assert.throws(()=>freezeDataset({plan,sourceIndexPath:f.trusted.sourceIndexPath,sourceQueue:f.queue,rows:wrong,outputDir:join(f.root,'wrong-class'),selectionProof:proof}),/role_mismatch/);
assert.throws(()=>freezeDataset({plan:{...plan,purpose:'stage4'},sourceIndexPath:f.trusted.sourceIndexPath,sourceQueue:f.queue,rows,outputDir:join(f.root,'synthetic-stage4'),selectionProof:proof}),/synthetic_selection_not_stage4/);
console.log(JSON.stringify({caseId:'selection-consumers',phase:'full-proof-positive-engineering-fixture',status:'passed',finiteSyntheticCompleteRecords:12,realMatches:0,LPreparedSplits:2,distinctFreezeAndLabelActions:true,labelQueries:0,selected:prepared.selection.selectedCount,missingLabelsExplicit:prepared.selection.selectedCount,keep:loaded.samples.length,trainingEligible:false,realTarget:'target_definition_unimplemented',realNetwork:0,modelForwards:0,parameterUpdates:0}));

// Legacy v1 remains finite-synthetic only, never new research evidence.
const old={schema:'ohuo-offline-label-selection-v1',sourceIndexRef:f.spec.sourceIndexRef,queueRef:f.spec.queueRef,purpose:'b_training_source',selectedCount:both[0].selection.rows.length,quotas:both[0].selection.quotas,rows:both[0].selection.rows};
const oldRef=f.ref('legacy-synthetic-selection',old),oldPrepared=await consumer.prepare({task:{...both[0].task,datasetRefs:[oldRef]},refs:f.refs,inputs:{sourceIndexPath:f.trusted.sourceIndexPath,confirmedRecordRoots:f.trusted.confirmedRecordRoots}});
assert.equal(oldPrepared.snapshots.length,old.rows.length);
const historical=loadFrozenDataset({directory:new URL('./fixtures/legacy-dataset/',import.meta.url).pathname,manifestSHA256:'d10099ff80b33a613357410dfd768f0a1f77332a439e927eb686fe14c2b868e1'});assert.equal(historical.samples.length,3);
// Existing exposure does not invalidate original proof on a legitimate resume,
// but cannot authorize re-freeze, altered selection or repeated same-split task.
const originalTask=both[0].task,abort=new AbortController();let cp:any,requests=0;
const queryConsumer=createOfflineLabelConsumer({profileStore,mode:'offline_synthetic',fetchImpl:async(_url,init)=>{requests++;const view=JSON.parse(JSON.parse(String(init!.body)).messages[1].content),value={kind:'choose',decisionId:view.observation.decisionId,actionId:view.candidates[0].actionId};return new Response(`data: ${JSON.stringify({model:'mock-only',choices:[{index:0,delta:{content:JSON.stringify(value)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});}});
await queryConsumer.run({task:originalTask,signal:abort.signal,executionInputs:both[0],checkpoint:null,checkpointSequence:0,executionId:'synthetic-one',reserve:async()=> 'synthetic-reservation',settleReservation:async()=>{},saveCheckpoint:async(c:any)=>{cp=structuredClone(c);if(cp.cursor===1)abort.abort('finite_synthetic_one_label_boundary');},getConsumption:()=>({synthetic:true}),deadlineMonotonicMs:performance.now()+10000});
assert.equal(requests,1);assert.equal(cp.cursor,1);assert.equal(cp.rows[0].labelKind,'offline_suggested');
const checkpointSHA256=digest(cp),checkpointRef=join(originalTask.outputRoot,`checkpoint-${checkpointSHA256}.json`);writeFileSync(checkpointRef,canonical(cp));
const exposed=structuredClone(f.state);exposed.runs[originalTask.runId]={runId:originalTask.runId,task:originalTask,taskSHA256:digest(originalTask),checkpoint:cp,checkpointSHA256,checkpointRef};writeFileSync(join(f.trusted.controlRoot,'state.json'),JSON.stringify(exposed));
const terminal=JSON.parse(readFileSync(cp.rows[0].resultRef.path,'utf8')),terminalF={id:'synthetic-label-terminal',sha256:cp.rows[0].resultRef.sha256};f.files.set(terminalF.id,{path:relative(f.trusted.repositoryRoot,cp.rows[0].resultRef.path),sha256:terminalF.sha256});
const labelledRows=rows.map(r=>canonical(r.record.key)===canonical(terminal.key)?{...r,offlineLabel:terminal.offlineLabel}:r),labelledProof={...proof,resolvedInputs:{...t,labelTerminalRefs:[terminalF]}};
const withTerminal=loadFrozenDataset(freezeDataset({plan,sourceIndexPath:f.trusted.sourceIndexPath,sourceQueue:f.queue,rows:labelledRows,outputDir:join(f.root,'one-terminal'),selectionProof:labelledProof}));
assert.equal(withTerminal.samples.filter((s:any)=>s.sampleKind==='demo').length,1);assert.equal(withTerminal.manifest.exclusions.filter((e:any)=>e.reason==='preselected_label_missing').length,prepared.selection.selectedCount-1);
assert.throws(()=>freezeDataset({plan,sourceIndexPath:f.trusted.sourceIndexPath,sourceQueue:f.queue,rows,outputDir:join(f.root,'omit-committed'),selectionProof:proof}),/committed_terminal_omitted/);
assert.equal(verifyOfflineSelection(prepared.selection,{...t,phase:'label-resume',task:originalTask}).production.verification,'reproduced');
assert.throws(()=>verifyOfflineSelection(prepared.selection,{...t,phase:'label-start',task:{...originalTask,runId:'repeat-train'}}),/owned_rows_already_exposed/);
assert.equal(verifyOfflineSelection(prepared.selection,{...t,phase:'label-start',task:both[1].task}).production.verification,'reproduced');
assert.throws(()=>prepareOfflineSelection({...f.spec,outputId:f.outputId('after-label')},{...f.trusted,outputDir:f.output('after-label')}),/prequery_state_changed/);
const duplicate=[...rows.slice(0,-1),rows[0]];assert.throws(()=>freezeDataset({plan,sourceIndexPath:f.trusted.sourceIndexPath,sourceQueue:f.queue,rows:duplicate,outputDir:join(f.root,'duplicate'),selectionProof:proof}),/duplicate_export_row/);
console.log(JSON.stringify({caseId:'selection-consumers',phase:'prequery-resume-and-legacy',status:'passed',originalResumeWithExposure:true,secondSplitUsesSameSelection:true,sameSplitReplayRejected:true,reFreezeAfterExposureRejected:true,oldSyntheticV1Readable:true,historicalDatasetRows:historical.samples.length,actualSyntheticTeacherTerminal:1,committedTerminalOmissionRejected:true,realNetwork:0,modelForwards:0,parameterUpdates:0}));
