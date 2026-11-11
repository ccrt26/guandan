import {screenRevalidationStatePath} from './screen-revalidation.mjs';
import {PROJECT_RULES_TEACHER_PROMPT_SCHEMA,assertProjectRulesTerminal,assertProjectRuleOptions} from '../../packages/web/server/llm-project-rules-v543.mjs';
/** R13 second phase inside the existing offline-label host: immutable GLM +
 * independent hard checks first, then metered complete continuation branches. */
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {digest,strictObject,fixedReference} from './task-schema.mjs';
import {verifyOfflineSelection,readSelectionSnapshot} from './offline-selection';
import {readOfflineSnapshot,commonViewForSnapshot} from './offline-label-source';
import {prepareFirstRoundComparison} from './match-consumer';
import {resolveFirstRoundParent} from './first-round-parent';
import {resolveNodePolicy,POLICY_REPOSITORY_ROOT} from './policy-loader';
import {validatePolicyRegistry} from '../review6/policy-registry';
import {verifyFirstRoundRecordedPeer,validateFirstRoundRegistryPolicy} from './first-round-registry-policy';
import {freezeFirstRoundScreenActions} from './first-round-screen-actions';
import {firstRoundContinuation,freezeFirstRoundScreenPlan,executeFirstRoundScreenBranch,summarizeFirstRoundScreen} from './first-round-screen-runtime';
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const zeroCost={providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0};
const scope={localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false};
export function firstRoundScreenCheckpoint(c:any){return !!c&&c.schema==='ohuo-first-round-screen-run-v1'&&typeof c.taskSHA256==='string'&&Number.isSafeInteger(c.rootCursor)&&c.rootCursor>=0&&Array.isArray(c.plans)&&Array.isArray(c.attempts)&&typeof c.executionUnknown==='boolean';}
function evidence(ref:any,read:any){strictObject(ref,'firstRoundEvidence',['id','sha256']);const bytes=Buffer.from(read(ref));if(sha(bytes)!==ref.sha256)throw Error('first-round evidence SHA differs');return JSON.parse(bytes.toString());}
export function verifyFirstRoundHardChecks({hard,terminal,snapshot:s,reviewerRef,commonView}:any){
 if(s.row?.sourceKind==='designed-synthetic'){
  if(!equal(terminal.source,s.row)||terminal.source?.sourceKind!=='designed-synthetic')throw Error('designed_screen_source_kind_binding');
  if(Object.hasOwn(s,'record')||Object.hasOwn(s,'decision')||!equal(terminal.acting,{policyId:null,seatSnapshot:null,actionId:null,move:null}))throw Error('designed_screen_unexecuted_target');
 }
 strictObject(hard,'firstRoundHardChecks',['schema','inputSHA256','labelTerminalRef','reviewerRef','decision','rationale','checks','publicFacts','representationNotes','limitations']);
 if(hard.schema!=='ohuo-first-round-hard-check-v1'||hard.inputSHA256!==s.row.inputSHA256||hard.reviewerRef!==reviewerRef||!['admitted','diagnostic'].includes(hard.decision)||typeof hard.rationale!=='string'||!hard.rationale||typeof hard.representationNotes!=='string'||!hard.representationNotes||!Array.isArray(hard.limitations))throw Error('first-round independent hard-check binding');
 if(hard.decision==='diagnostic')return 'diagnostic';
 const responses=terminal.teacherResponses;if(!Array.isArray(responses)||responses.length!==1||responses[0].kind!=='choose'||responses[0].decisionId!==s.bundle.decisionId||responses[0].actionId!==terminal.remote?.actionId||responses[0].note!==hard.rationale)throw Error('original teacher action/reason missing or changed');
 if(terminal.inputSHA256!==s.row.inputSHA256||!equal(terminal.key,s.row.key)||terminal.purpose!=='b_training_source'||terminal.remote?.status!=='selected'||terminal.offlineLabel?.legality!=='validated'||!s.bundle.initialCandidateIds.includes(terminal.remote.actionId))throw Error('screen original fixed teacher label differs');
 strictObject(hard.checks,'fourHardChecks',['canonicalLegal','publicFacts','student423Expressible','inFrozenC']);
 if(!Array.isArray(hard.publicFacts))throw Error('hard-check public facts required');
 for(const fact of hard.publicFacts){strictObject(fact,'publicFact',['path','value']);if(!Array.isArray(fact.path)||!fact.path.length||fact.path.some((k:any)=>!['string','number'].includes(typeof k)||['__proto__','prototype','constructor'].includes(String(k))))throw Error('public fact path');let value:any=commonView??s.input.observation;for(const k of fact.path){if(value===null||typeof value!=='object'||!Object.hasOwn(value,k))throw Error('public fact absent');value=value[k];}if(!equal(value,fact.value))throw Error('teacher public fact differs');}
 if(hard.decision==='admitted'&&Object.values(hard.checks).some(v=>v!=='passed'))throw Error('all four independent hard checks required');
 return hard.decision;
}
/** One prepare owns this view only. TC still reads live budget/unknown/locks
 * at launch; the relevant label and peer inputs are checked again on return. */
export function prepareFirstRoundScreenBindings({task,comparison,contract,inputs}:any){
 const registryRef=structuredClone(contract.registryRef),registryBytes=Buffer.from(inputs.readFirstRoundEvidence(registryRef));
 const readRegistry=(ref:any)=>{if(!equal(ref,registryRef))throw Error('screen peer registry differs');return Buffer.from(registryBytes);};
 const registry=validatePolicyRegistry(evidence(registryRef,readRegistry)),repositoryRoot=inputs.policyRepositoryRoot??POLICY_REPOSITORY_ROOT;
 const readLabelRuns=()=>{
  const state=JSON.parse(readFileSync(screenRevalidationStatePath(inputs.offlineSelection),'utf8')),checkpoints=new Map<string,string>();
  return Object.keys(state.runs??{}).sort().flatMap(id=>{
   const run=state.runs[id];
   if(!(run.taskSHA256===digest(run.task)&&run.checkpointSHA256===digest(run.checkpoint)&&run.checkpoint?.schema==='ohuo-offline-label-run-v1'&&run.task.planRef===task.planRef&&run.task.budgetRef===task.budgetRef&&run.task.parentPolicyRef===comparison.proposalRef&&equal(run.task.datasetRefs,[contract.selectionRef])&&run.task.labelPolicyRef===task.labelPolicyRef&&typeof run.checkpointRef==='string'))return [];
   if(!checkpoints.has(run.checkpointRef))checkpoints.set(run.checkpointRef,digest(JSON.parse(readFileSync(run.checkpointRef,'utf8'))));
   return [{task:run.task,taskSHA256:run.taskSHA256,checkpoint:run.checkpoint,checkpointSHA256:run.checkpointSHA256,checkpointRef:run.checkpointRef,checkpointValid:checkpoints.get(run.checkpointRef)===run.checkpointSHA256}];
  });
 };
 const labelRuns=readLabelRuns(),peers=new Map<string,any>(),declaredPeers=new Map<string,any>();
 return {registry,
  verifyLabel({root:r,row,terminal}:any){
   const file=inputs.offlineSelection.evidenceFiles.get(r.labelTerminalRef.id),committed=labelRuns.flatMap((run:any)=>run.checkpointValid?(run.checkpoint.rows??[]).filter((q:any)=>equal(q.key,row.key)&&q.inputSHA256===row.inputSHA256&&q.resultRef?.sha256===r.labelTerminalRef.sha256&&file&&q.resultRef.path===join(inputs.offlineSelection.repositoryRoot,file.path)):[]);
   if(committed.length!==1||committed[0].status!==terminal.status||committed[0].labelKind!==terminal.labelKind)throw Error('screen terminal not committed in original label ledger');
  },
  verifyPeer({seatSnapshot,policySpec,role}:any){
   const tuple={seatSnapshot,policySpec,registryRef,role},key=digest(tuple);if(peers.has(key))return;
   const first=peers.values().next().value;if(first&&!equal(first.seatSnapshot.registryPolicy.program,seatSnapshot?.registryPolicy?.program))throw Error('screen peer program changed during prepare');
   verifyFirstRoundRecordedPeer({...tuple,readEvidence:readRegistry,repositoryRoot});peers.set(key,structuredClone(tuple));
  },
  verifyDeclaredPeer({releaseRef,policySpec,role}:any){
   fixedReference(releaseRef,'designed.peerReleaseRef');const envelope=inputs.readFirstRoundReference(releaseRef);
   if(digest(envelope)!==releaseRef.split(':').at(-1)||!equal(envelope.registryRef,registryRef))throw Error('designed_screen_peer_reference');
   const metadata=validateFirstRoundRegistryPolicy({envelope,readEvidence:readRegistry,repositoryRoot,role});
   if(!equal(metadata.registrySpec,policySpec))throw Error('designed_screen_peer_registry_identity');
   declaredPeers.set(releaseRef,{envelope,role});
  },
  assertUnchanged(){
   if(!equal(labelRuns,readLabelRuns()))throw Error('screen committed label inputs changed during prepare');
   const first=peers.values().next().value;
   // Deliberately bypass the cached reader/tuple here: original verifier checks
   // the recorded seven-file program and actual registry bytes one final time.
   if(first)verifyFirstRoundRecordedPeer({...first,readEvidence:inputs.readFirstRoundEvidence,repositoryRoot});
   else evidence(registryRef,inputs.readFirstRoundEvidence);
   for(const [ref,peer]of declaredPeers){if(!equal(inputs.readFirstRoundReference(ref),peer.envelope))throw Error('designed_screen_peer_changed');validateFirstRoundRegistryPolicy({...peer,readEvidence:inputs.readFirstRoundEvidence,repositoryRoot});}
  }
 };
}
export function prepareFirstRoundScreen({task,refs,inputs}:any){
 const contract=refs.get(task.scientificContract.decisionRuleRef),commonView=contract?.schema==='ohuo-common-view-screen-contract-r2';strictObject(contract,'firstRoundScreenContract',['schema','comparisonRef','selectionRef','registryRef','reviewerRef','roots',...(commonView?['protocolRef']:['maxBranchStarts'])]);
 if(commonView&&(contract.protocolRef!==task.scientificContract.analysisMethodRef||refs.get(contract.protocolRef)?.schema!=='ohuo-first-round-protocol-revision-v2'||refs.get(contract.protocolRef)?.protocolId!=='first-round-common-view-r2'))throw Error('screen common-view protocol binding');
 if((!commonView&&contract.schema!=='ohuo-first-round-screen-contract-v1')||task.taskKind!=='collect'||task.operationScope.apiCalls||task.operationScope.parameterUpdates||task.limits.maxProviderRequests!==0||task.limits.maxLabelDecisions!==0||task.limits.maxOptimizerSteps!==0||!commonView&&(!Number.isSafeInteger(contract.maxBranchStarts)||contract.maxBranchStarts<1||contract.maxBranchStarts>384||task.limits.maxMatchAttempts>contract.maxBranchStarts)||task.scientificContract.comparisonRef!==contract.comparisonRef||!equal(task.datasetRefs,[contract.selectionRef]))throw Error('first-round screen bounded phase differs');
 if(!inputs.offlineSelection||typeof inputs.readFirstRoundEvidence!=='function')throw Error('verified screen source/evidence adapters required');
 const proof=verifyOfflineSelection(refs.get(contract.selectionRef),{...inputs.offlineSelection,phase:'dataset',task}),comparison=prepareFirstRoundComparison(refs.get(contract.comparisonRef),refs,inputs,task);
 fixedReference(contract.reviewerRef,'independentReviewerRef');const reviewer=refs.get(contract.reviewerRef)??inputs.readFirstRoundReference?.(contract.reviewerRef);strictObject(reviewer,'firstRoundReviewer',['schema','role','planRef']);if(reviewer.schema!=='ohuo-first-round-reviewer-v1'||reviewer.role!=='independent-hard-check-reviewer'||reviewer.planRef!==task.planRef||contract.reviewerRef===task.labelPolicyRef)throw Error('independent reviewer plan binding');
 if(proof.production.verification!=='reproduced')throw Error('screen original selected population incomplete');
 const bindings=prepareFirstRoundScreenBindings({task,comparison,contract,inputs}),registry=bindings.registry,selected=proof.selection.rows.filter((r:any)=>r.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(r.blockFamilyId??r.familyId));
 if(!Array.isArray(contract.roots)||contract.roots.length!==selected.length||!commonView&&contract.roots.length>16)throw Error('complete fixed screen root population required');
 const seen=new Set(),cache=new Map(),roots=contract.roots.map((r:any)=>{
  strictObject(r,'screenRoot',['key','inputSHA256','labelTerminalRef','hardCheckRef','worlds','otherPolicyIds',...(r.continuationLayoutRef!==undefined?['continuationLayoutRef']:[])]);const k=digest(r.key),row=selected.find((s:any)=>equal(s.key,r.key));if(seen.has(k)||!row||row.inputSHA256!==r.inputSHA256)throw Error('screen selected source differs');seen.add(k);
  const snapshot=readSelectionSnapshot(row,inputs.offlineSelection,cache),terminal=evidence(r.labelTerminalRef,inputs.readFirstRoundEvidence),hard=evidence(r.hardCheckRef,inputs.readFirstRoundEvidence);
  const teacher=refs.get(task.labelPolicyRef);if(terminal.schema!=='ohuo-offline-label-result-v1'||terminal.selectionRef!==contract.selectionRef||terminal.inputSHA256!==row.inputSHA256||!equal(terminal.key,row.key)||terminal.teacher?.releaseRef!==teacher?.releaseRef)throw Error('screen original GLM terminal binding differs');
  bindings.verifyLabel({root:r,row,terminal});
  let worldCache:any=null,view:any=undefined;
  if(commonView&&hard.decision!=='diagnostic'){const cv=terminal.commonView;if(cv?.schema!=='ohuo-common-view-terminal-r2'||cv.protocolRef!==contract.protocolRef||cv.preparationStatus!=='prepared'||typeof cv.modelPayloadBytes!=='string'||sha(cv.modelPayloadBytes)!==cv.viewSHA256)throw Error('screen common-view terminal binding');const protocol=refs.get(contract.protocolRef),promptRef=protocol.originalMethods?.commonViewPromptRef,prompt=inputs.offlineSelection.references.get(promptRef);if(prompt?.schema===PROJECT_RULES_TEACHER_PROMPT_SCHEMA){if(digest(prompt)!==promptRef?.split(':').at(-1))throw Error('screen common-view prompt binding');assertProjectRulesTerminal(cv,prompt,promptRef);assertProjectRuleOptions(snapshot.state.match.opts);}else if(prompt?.schema!=='ohuo-common-view-prompt-r2'||prompt.viewSchema!=='first-round-common-view-r2'||digest(prompt)!==promptRef?.split(':').at(-1)||cv.systemPromptSHA256!==prompt.systemPromptSHA256)throw Error('screen common-view prompt binding');const expected=commonViewForSnapshot(snapshot);if(cv.modelPayloadBytes!==expected.modelPayloadBytes||cv.viewSHA256!==expected.viewSHA256||!equal(cv.addressMap,expected.addressMap))throw Error('screen actual423 common view differs');view=JSON.parse(cv.modelPayloadBytes);worldCache=evidence({id:cv.worldPreparation?.id,sha256:cv.worldPreparation?.sha256},inputs.readFirstRoundEvidence);if(worldCache.schema!=='ohuo-common-view-world-cache-r2'||worldCache.inputSHA256!==row.inputSHA256||worldCache.failure!==null||worldCache.cursor!==r.worlds.length||worldCache.worlds.length!==r.worlds.length||worldCache.batchPlan.protocolRef!==contract.protocolRef||!equal(worldCache.batchPlan.worlds,r.worlds))throw Error('screen pre-query actual worlds missing');}
  if(!equal(hard.labelTerminalRef,r.labelTerminalRef))throw Error('hard checks did not bind original teacher bytes');const decision=verifyFirstRoundHardChecks({hard,terminal,snapshot,reviewerRef:contract.reviewerRef,commonView:view});
  if(!equal(snapshot.input.studentInputs?.scorer,comparison.envelope.scorer)||snapshot.input.studentInputs?.studentParentRef!==comparison.studentParentRef)throw Error('original S0 continuation identity differs');
  if(!Array.isArray(r.otherPolicyIds)||r.otherPolicyIds.length!==4||r.otherPolicyIds[row.actorSeat]!==null)throw Error('original four-seat continuation identity required');
  const otherPolicies=r.otherPolicyIds.map((id:any,i:number)=>i===row.actorSeat?null:registry.policies.find(p=>p.policyId===id));if(otherPolicies.some((p:any,i:number)=>i!==row.actorSeat&&!p))throw Error('original frozen no-H other policy absent');
  if('sourceKind'in row&&row.sourceKind==='designed-synthetic'){
   fixedReference(r.continuationLayoutRef,'designed.continuationLayoutRef');const layout=inputs.readFirstRoundReference(r.continuationLayoutRef);
   strictObject(layout,'designed.continuationLayout',['schema','comparisonRef','registryRef','actorSeat','peerReleaseRefs']);
   if(layout.schema!=='ohuo-designed-continuation-layout-v1'||digest(layout)!==r.continuationLayoutRef.split(':').at(-1)||layout.comparisonRef!==contract.comparisonRef||!equal(layout.registryRef,contract.registryRef)||layout.actorSeat!==row.actorSeat||!Array.isArray(layout.peerReleaseRefs)||layout.peerReleaseRefs.length!==4||layout.peerReleaseRefs[row.actorSeat]!==null)throw Error('designed_screen_continuation_layout');
   for(let seat=0;seat<4;seat++)if(seat!==row.actorSeat)bindings.verifyDeclaredPeer({releaseRef:layout.peerReleaseRefs[seat],policySpec:otherPolicies[seat],role:seat===(row.actorSeat+2)%4?'partner':'opponent'});
  }else{
   if(r.continuationLayoutRef!==undefined||!('record'in snapshot)||!equal(r.otherPolicyIds,snapshot.record.policyIds.map((id:string,i:number)=>i===row.actorSeat?null:id)))throw Error('original other-three continuation identity differs');
   for(let seat=0;seat<4;seat++)if(seat!==row.actorSeat)bindings.verifyPeer({seatSnapshot:snapshot.record.seatSnapshots?.[seat],policySpec:otherPolicies[seat],role:seat===(row.actorSeat+2)%4?'partner':'opponent'});
  }
  return {...structuredClone(r),snapshot,terminal,hard,decision,otherPolicies,...(commonView?{worldCache,comparisonBatch:worldCache?.batchPlan??null,frozenWorlds:worldCache?.worlds??null}:{})};
 });
 bindings.assertUnchanged();
 const inputWorkload=commonView?{providerRequests:0,labelDecisions:0,optimizerSteps:0,matchAttempts:roots.filter((r:any)=>r.decision==='admitted').reduce((n:number,r:any)=>n+r.worlds.length*freezeFirstRoundScreenActions({state:r.snapshot.state,actorSeat:r.snapshot.row.actorSeat,candidates:r.snapshot.bundle.initialCandidateIds.map((id:string)=>r.snapshot.bundle.pool.find((c:any)=>c.actionId===id)),proposalActionId:r.terminal.remote.actionId,baselineActionId:r.snapshot.input.studentInputs.baseActionId}).length,0)}:undefined;
 if(commonView&&task.limits.maxMatchAttempts!==inputWorkload!.matchAttempts)throw Error('screen declared canonical branch inputs differ');
 return {...(commonView?{inputWorkload}:{}),kind:'first-round-screen',commonView,contract,comparison,roots,readEvidence:inputs.readFirstRoundEvidence,repositoryRoot:inputs.policyRepositoryRoot??POLICY_REPOSITORY_ROOT};
}
export async function runFirstRoundScreen(ctx:any){
 const {task,executionInputs:p,signal}=ctx,commonView=p.commonView===true;
 if(commonView&&ctx.executionBoundary?.mode!=='input-workload-only')throw Error('screen input-workload boundary required');
 const expired=()=>!commonView&&performance.now()>=ctx.deadlineMonotonicMs;let capExhausted=false;let cp=ctx.checkpoint?structuredClone(ctx.checkpoint):{schema:'ohuo-first-round-screen-run-v1',taskSHA256:digest(task),selectionRef:p.contract.selectionRef,contractRef:task.scientificContract.decisionRuleRef,rootCursor:0,plans:[],attempts:[],active:null,executionUnknown:false},sequence=ctx.checkpointSequence;
 const save=async()=>ctx.saveCheckpoint(cp,++sequence);
 const summary=()=>{const value={schema:'ohuo-first-round-screen-summary-v1',...(ctx.engineeringRevalidation?{engineeringRevalidation:ctx.engineeringRevalidation}:{}),taskSHA256:digest(task),selectionRef:p.contract.selectionRef,contractRef:task.scientificContract.decisionRuleRef,plans:cp.plans,attempts:cp.attempts,rootCursor:cp.rootCursor,total:p.roots.length,active:cp.active,executionUnknown:cp.executionUnknown,consumption:ctx.getConsumption()},path=join(ctx.outputRoot??task.outputRoot,'first-round-screen-summary.json'),temporary=path+'.tmp-'+sequence;writeFileSync(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(temporary,path);return{path,sha256:sha(readFileSync(path))};};
 try{
  if(!firstRoundScreenCheckpoint(cp)||cp.taskSHA256!==digest(task)||cp.selectionRef!==p.contract.selectionRef||cp.contractRef!==task.scientificContract.decisionRuleRef||cp.active||cp.executionUnknown||cp.rootCursor>p.roots.length)throw Error('execution_uncertain: screen boundary not confirmed');
  if(!commonView&&(cp.attempts.length>p.contract.maxBranchStarts||p.roots.some((_:any,i:number)=>cp.attempts.filter((a:any)=>a.rootIndex===i).length>12)))throw Error('screen submitted branch cap exceeded');
  const f=p.comparison,parent=await resolveFirstRoundParent({parentRef:f.studentParentRef,envelope:f.envelope,readEvidence:p.readEvidence,repositoryRoot:p.repositoryRoot}),loaded=await resolveNodePolicy(f.proposer.release.proposalPolicyRef,p.repositoryRoot),proposal={...loaded,candidatePolicy:f.proposer.candidatePolicy};if(!equal(JSON.parse(JSON.stringify(loaded.identity)),f.proposer.policyIdentity))throw Error('screen actual B differs');
  while(cp.rootCursor<p.roots.length){
   if(signal.aborted||expired())break;
   const r=p.roots[cp.rootCursor];if(r.decision==='diagnostic'){cp.plans.push({rootIndex:cp.rootCursor,status:'diagnostic',inputSHA256:r.inputSHA256,hardCheckRef:r.hardCheckRef,labelTerminalRef:r.labelTerminalRef});cp.rootCursor++;await save();continue;}
   const continuation=firstRoundContinuation({actor:r.snapshot.row.actorSeat,proposalRef:f.proposalRef,parentRef:f.studentParentRef,proposal,parent,otherPolicies:r.otherPolicies}),frozen=freezeFirstRoundScreenPlan({snapshot:r.snapshot,proposalActionId:r.terminal.remote.actionId,worlds:r.worlds,continuation,...(commonView?{comparisonBatch:r.comparisonBatch,frozenWorlds:r.frozenWorlds}:{})});
   let record=cp.plans.find((x:any)=>x.rootIndex===cp.rootCursor);if(record){if(!equal(record.plan,frozen.plan)||record.planSHA256!==frozen.planSHA256)throw Error('screen prebranch freeze changed');}else{record={rootIndex:cp.rootCursor,status:'pending',inputSHA256:r.inputSHA256,hardCheckRef:r.hardCheckRef,labelTerminalRef:r.labelTerminalRef,plan:frozen.plan,planSHA256:frozen.planSHA256,screen:null};cp.plans.push(record);await save();}
   let paused=false,knownIncomplete=false;const results:any[]=[];
   for(const world of frozen.plan.worlds)for(const action of frozen.plan.actions){
    const past=cp.attempts.filter((a:any)=>a.rootIndex===cp.rootCursor&&a.row.worldId===world.worldId&&a.row.actionId===action.actionId),complete=past.find((a:any)=>a.row.result.complete);if(complete){results.push(complete.row);continue;}if(past.length){results.push(past.at(-1).row);knownIncomplete=true;paused=true;continue;}
    if(paused||signal.aborted||expired()){paused=true;continue;}
    if(!commonView&&(cp.attempts.length>=p.contract.maxBranchStarts||cp.attempts.filter((a:any)=>a.rootIndex===cp.rootCursor).length>=12)){capExhausted=true;paused=true;break;}
    const row=await executeChargedFirstRoundBranch({ctx,cp,save,root:frozen.root,plan:frozen.plan,continuation,frozenWorlds:frozen.frozenWorlds,worldId:world.worldId,actionId:action.actionId});if(row===null){paused=true;continue;}results.push(row);if(!row.result.complete){knownIncomplete=true;paused=true;}
   }
   record.screen=summarizeFirstRoundScreen(frozen.plan,results);record.status=record.screen.status;await save();
   // No branch-level checkpoint exists here. A settled incomplete attempt is
   // not a resumable boundary or permission to restart/exclude its frozen root.
   if(knownIncomplete&&!signal.aborted)throw Error('screen_known_incomplete: original branch has no resumable checkpoint');
   if(paused||record.status==='incomplete')break;cp.rootCursor++;await save();
  }
  return {completed:cp.rootCursor===p.roots.length,cleanupConfirmed:true,actualScope:scope,stopReason:signal.aborted?String(signal.reason??'user_stop'):capExhausted?'screen_fixed_branch_cap_exhausted':'run_boundary',artifactRefs:[summary()]};
 }catch(error){if(cp.active)cp.executionUnknown=true;try{await save();}catch{};Object.assign(error as object,{cleanupConfirmed:true,actualScope:scope});throw error;}
}

/** Exact existing-controller reserve/persist/start/settle boundary; exported only
 * for the same fixed direct smoke. No injectable executor or alternate ledger. */
export async function executeChargedFirstRoundBranch({ctx,cp,save,root,plan,continuation,frozenWorlds,worldId,actionId}:any){
 if(!plan.comparisonBatch&&cp.attempts.filter((a:any)=>a.rootIndex===cp.rootCursor).length>=12)throw Error('first-round root branch cap exhausted');
 const id='screen-'+digest({rootCursor:cp.rootCursor,worldId,actionId,attemptCount:cp.attempts.length,executionId:ctx.executionId}),reservation=await ctx.reserve(id,{...zeroCost,matchAttempts:1});
 if(ctx.signal.aborted){await ctx.settleReservation(reservation,{disposition:'not_sent',evidence:{kind:'confirmed_not_sent'}});return null;}
 cp.active={rootIndex:cp.rootCursor,worldId,actionId,reservation};await save();await ctx.settleReservation(reservation,{disposition:'consumed',evidence:{kind:'match_started'}});
 const row=executeFirstRoundScreenBranch({root,plan,continuation,worldId,actionId,deadlineMonotonicMs:ctx.deadlineMonotonicMs,executionBoundary:ctx.executionBoundary,frozenWorlds});cp.attempts.push({rootIndex:cp.rootCursor,reservation,row});cp.active=null;await save();return row;
}
