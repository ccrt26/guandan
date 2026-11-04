import {PROJECT_RULES_TEACHER_PROMPT_SCHEMA,validateProjectRulesPrompt,assertProjectRuleOptions} from '../../packages/web/server/llm-project-rules-v541.mjs';
import {COMMON_VIEW_SYSTEM_PROMPT_SHA256} from '../../packages/web/server/llm-selection-wire.mjs';
import {prepareCommonViewWorlds,validateCommonViewWorldBatch} from './first-round-screen-runtime';
import {prepareBlindReviewProjection} from './first-round-blind-review';
import {prepareFirstRoundScreen,runFirstRoundScreen,firstRoundScreenCheckpoint} from './first-round-screen-consumer';
/** Fixed offline teacher producer. Same B06 controller/ledger; no action executor,
 * model load, dynamic plugins, or web control. Inputs must predate all labels. */
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,readdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {createTaskController} from './task-control.mjs';
import {digest,strictObject} from './task-schema.mjs';
import {resolveCandidateReleaseRef} from '../../packages/ai/src/policy/candidate-release';
import {resolveStudentCandidatePolicy} from '../../packages/ai/src/hybrid/student';
import {candidatePolicyForBundle,resolveCandidatePolicy} from '../../packages/ai/src/candidate-spec';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {createProfileSelector} from '../../packages/web/server/llm-select.mjs';
import {createMeteredRemote,validateMatchRules} from './match-consumer';
import {frozenTeacherSnapshot} from './teacher-snapshot';
import {hashJSON} from './match-record';
import {readOfflineSnapshot,readOfflineSnapshots,queryOfflineTeacher,commonViewForSnapshot,type SelectedRecordedDecision,type OfflineSnapshot} from './offline-label-source';
import type {DatasetIdentities} from './distill-data';
import {verifyOfflineSelection,readSelectionSnapshot,DESIGNED_SELECTION_SPEC_SCHEMA,DESIGNED_SELECTION_RULE_SCHEMA,type SelectedDecision,type SelectionSnapshot} from './offline-selection';
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const scope=(apiCalls=false)=>({localExecution:true,apiCalls,parameterUpdates:false,deployment:false});
const plainFile=(path:string)=>{const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink())throw Error('regular immutable file required');return readFileSync(path);};
/** Source-kind bridge only. Designed targets were never executed: they have no
 * recorded actor policy, seat snapshot, action or move. This grants no admission. */
export function offlineSnapshotActing(snapshot:OfflineSnapshot|import('./designed-source').DesignedSnapshot){
 const kind=(snapshot.row as {sourceKind?:string}).sourceKind;
 if(kind==='designed-synthetic'){
  if(Object.hasOwn(snapshot,'record')||Object.hasOwn(snapshot,'decision'))throw Error('designed_target_must_be_unexecuted');
  return {sourceKind:'designed-synthetic' as const,acting:{policyId:null,seatSnapshot:null,actionId:null,move:null}};
 }
 if(kind!==undefined&&kind!=='natural-recorded')throw Error('offline_source_kind_unrecognized');
 if(!('record'in snapshot)||!('decision'in snapshot))throw Error('offline_natural_record_required');
 return {sourceKind:'natural-recorded' as const,acting:{policyId:snapshot.decision.policyId,seatSnapshot:snapshot.record.seatSnapshots?.[snapshot.row.actorSeat]??null,actionId:snapshot.decision.actualActionId,move:snapshot.decision.actualMove}};
}
interface Prepared {commonViewTeacher?:any;blindReview?:any;selection:any;snapshots:SelectionSnapshot[];teacher:DatasetIdentities['teacher'];store:any;reference:any;sourceIndexPath:string;sourceIndexSHA256:string}
interface Checkpoint {blindReview?:any;schema:'ohuo-offline-label-run-v1';taskSHA256:string;selectionRef:string;cursor:number;active:null|{index:number;inputSHA256:string};rows:any[];executionUnknown:boolean}
export function createOfflineLabelConsumer({profileStore,mode='research',fetchImpl,screenOnly=false}:{profileStore:any;mode?:'research'|'offline_synthetic';fetchImpl?:typeof fetch;screenOnly?:boolean}){
 if((!profileStore&&!screenOnly)||!['research','offline_synthetic'].includes(mode)||mode==='offline_synthetic'&&typeof fetchImpl!=='function')throw Error('explicit supported profile store/mode/fake transport required');
 const prepare=async({task,refs,inputs}:any):Promise<Prepared>=>{
  if(['ohuo-first-round-screen-contract-v1','ohuo-common-view-screen-contract-r2'].includes(refs.get(task.scientificContract.decisionRuleRef)?.schema))return prepareFirstRoundScreen({task,refs,inputs}) as any;
  if(screenOnly)throw Error('engineering revalidation permits only the fixed screen consumer');
  const protocol=refs.get(task.scientificContract.analysisMethodRef),commonView=protocol?.schema==='ohuo-first-round-protocol-revision-v2'&&protocol.protocolId==='first-round-common-view-r2';
  const commonViewTeacher=commonView?structuredClone(inputs.commonViewTeacher):undefined;
  if(commonView&&(!commonViewTeacher||commonViewTeacher.protocolRef!==task.scientificContract.analysisMethodRef))throw Error('common_view_trusted_inputs_required');
  const routeInput=inputs.commonViewTeacherRouting,routeRef=refs.get(task.scientificContract.decisionRuleRef)?.routingRef;
  const secondaryCommonView=commonView&&['independent-review','model-substitution'].includes(routeInput?.role);
  if(secondaryCommonView&&(!routeRef||!equal(refs.get(routeRef),routeInput)))throw Error('common_view_secondary_route_ref_required');
  if(task.taskKind!=='collect'||task.operationScope.apiCalls!==(mode==='research')||task.datasetRefs.length!==1||task.limits.maxOptimizerSteps!==0||task.limits.maxMatchAttempts!==0)throw Error('offline label scope/limits differ');
  const fullSelection=refs.get(task.datasetRefs[0]);let selection=fullSelection,firstRound=false,designed=false,blindReview:any;const newTest=fullSelection?.schema==='ohuo-first-round-new-test-selection-result-v1';const blind=refs.get(task.scientificContract.decisionRuleRef)?.schema==='ohuo-first-round-blind-review-contract-v1';
  if(newTest){
   const h=inputs.firstRoundNewTestLabel,proof=inputs.firstRoundNewTest;if(!h||!proof||!equal(h.selection,fullSelection)||!equal(proof.selection,fullSelection)||h.contract.selectionRef!==task.datasetRefs[0]||task.sourcePlan.split!=='confirm')throw Error('fixed new-test original union proof required');firstRound=true;blindReview=h.blindReview;const rows=h.rows,quotas=[...new Set(rows.map((r:any)=>r.blockFamilyId))].map(familyId=>({familyId,count:rows.filter((r:any)=>r.blockFamilyId===familyId).length}));selection={...fullSelection,sourceIndexRef:proof.sourceSpec.sourceIndexRef,queueRef:proof.sourceSpec.queueRef,purpose:'distribution_diagnostic',selectedCount:rows.length,rows,quotas};
  }else if(fullSelection?.schema==='ohuo-offline-label-selection-v2'){
   const originalProduction=inputs.offlineSelection?.references.get(fullSelection.productionRef),designedSelection=inputs.offlineSelection?.references.get(originalProduction?.specRef)?.schema===DESIGNED_SELECTION_SPEC_SCHEMA;
   if(!inputs.offlineSelection||inputs.offlineSelection.mode!==mode||!((blind||secondaryCommonView||designedSelection)?['dataset']:['label-start','label-resume']).includes(inputs.offlineSelection.phase))throw Error('fixed offline selection trusted inputs/mode required');
   const proof=verifyOfflineSelection(fullSelection,{...inputs.offlineSelection,...((blind||secondaryCommonView||designedSelection)?{phase:'dataset'}:{}),task});
   if(proof.production.verification!=='reproduced')throw Error('offline selection population incomplete');
   designed=proof.spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA;
   firstRound=[DESIGNED_SELECTION_RULE_SCHEMA,'ohuo-offline-selection-first-round-rule-v1','ohuo-offline-selection-first-round-pilot-rule-v1','ohuo-offline-selection-common-view-r2'].includes(inputs.offlineSelection.references.get(proof.production.selectionRuleRef)?.schema);
   if(commonView!==['ohuo-offline-selection-common-view-r2',DESIGNED_SELECTION_RULE_SCHEMA].includes(inputs.offlineSelection.references.get(proof.production.selectionRuleRef)?.schema))throw Error('common_view_protocol_selection_mismatch');
   const families=[...new Set(proof.population.filter(p=>p.split===task.sourcePlan.split).map(p=>p.blockFamilyId??p.familyId))].sort();
   if(!task.sourcePlan.familyIds.length||task.sourcePlan.familyIds.some((id:string)=>!families.includes(id)))throw Error('offline selection split projection family scope differs');
   const rows=fullSelection.rows.filter((r:any)=>r.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(r.blockFamilyId??r.familyId)),quotas=fullSelection.quotas.filter((q:any)=>task.sourcePlan.familyIds.includes(q.familyId));
   if(blind){blindReview=prepareBlindReviewProjection(task,refs,inputs,proof);selection=blindReview.selection;}else selection={...fullSelection,rows,quotas,selectedCount:rows.length};
  }else if(mode==='research')throw Error('research offline labels require selection v2 production proof');
  if(commonView){
   const prompt=refs.get(protocol.originalMethods?.commonViewPromptRef);
   delete commonViewTeacher.requestPrompt;delete commonViewTeacher.actualPromptRef;
   if(prompt?.schema===PROJECT_RULES_TEACHER_PROMPT_SCHEMA){
    validateProjectRulesPrompt(prompt);
    commonViewTeacher.requestPrompt={schema:prompt.wireSchema,promptId:prompt.promptId,systemPromptSHA256:prompt.systemPromptSHA256,ruleOptions:structuredClone(prompt.ruleOptions)};
    commonViewTeacher.actualPromptRef=protocol.originalMethods.commonViewPromptRef;
   }else if(prompt?.schema!=='ohuo-common-view-prompt-r2'||prompt.systemPromptSHA256!==COMMON_VIEW_SYSTEM_PROMPT_SHA256||prompt.viewSchema!=='first-round-common-view-r2')throw Error('common_view_prompt_provenance');
   const rule=refs.get(task.scientificContract.decisionRuleRef),routing=inputs.commonViewTeacherRouting;
   strictObject(rule,'commonViewTeacherContract',['schema','protocolRef','selectionRef','comparisonRef','routingRef','worldPlansRef','sourceSpecRef']);
   if(rule.schema!=='ohuo-common-view-teacher-contract-r2'||rule.protocolRef!==task.scientificContract.analysisMethodRef||rule.selectionRef!==task.datasetRefs[0]||(!newTest&&rule.sourceSpecRef!==null))throw Error('common_view_teacher_contract');
   if(!routing||!rule?.routingRef||!rule?.worldPlansRef||!equal(refs.get(rule.routingRef),routing)||routing.schema!=='ohuo-common-view-teacher-routing-r2'||routing.protocolRef!==task.scientificContract.analysisMethodRef||!['primary','independent-review','model-substitution'].includes(routing.role)||!Array.isArray(routing.selected)||!equal(refs.get(rule.worldPlansRef),commonViewTeacher.worldPlanDocument))throw Error('common_view_routing_identity');
   if(routing.role==='primary'){
    if(routing.reason!==null||routing.selected.length||task.labelPolicyRef!==routing.primaryLabelPolicyRef)throw Error('common_view_primary_route');
   }else{
    if(typeof routing.reason!=='string'||!routing.reason.trim()||task.labelPolicyRef===routing.primaryLabelPolicyRef||!routing.selected.length)throw Error('common_view_secondary_reason_required');
    const ids=new Set<string>();
    for(const row of routing.selected){
     const id=digest(row.key);if(ids.has(id)||!['strategy_dispute','model_unsuitable'].includes(row.reasonKind)||typeof row.reason!=='string'||!row.reason.trim()||!Array.isArray(row.evidenceRefs)||!row.evidenceRefs.length)throw Error('common_view_secondary_case');ids.add(id);
     if(routing.role==='independent-review'&&row.reasonKind!=='strategy_dispute'||routing.role==='model-substitution'&&row.reasonKind!=='model_unsuitable')throw Error('common_view_secondary_role');
     for(const ref of row.evidenceRefs){const bytes=Buffer.from(inputs.readFirstRoundEvidence(ref));if(sha(bytes)!==ref.sha256)throw Error('common_view_secondary_evidence');}
    }
    const rows=selection.rows.filter((row:any)=>routing.selected.some((r:any)=>equal(r.key,row.key)&&r.inputSHA256===row.inputSHA256));
    if(rows.length!==routing.selected.length)throw Error('common_view_secondary_original_rows');
    const quotas=[...new Set(rows.map((r:any)=>r.blockFamilyId??r.familyId))].map(familyId=>({familyId,count:rows.filter((r:any)=>(r.blockFamilyId??r.familyId)===familyId).length}));
    selection={...selection,rows,quotas,selectedCount:rows.length};
   }
   if(commonViewTeacher.worldPlanDocument?.schema!=='ohuo-common-view-world-plans-r2'||commonViewTeacher.worldPlanDocument.protocolRef!==task.scientificContract.analysisMethodRef||!Array.isArray(commonViewTeacher.worldPlanDocument.rows))throw Error('common_view_world_plans');
   for(const row of selection.rows){const plans=commonViewTeacher.worldPlanDocument.rows.filter((p:any)=>p.inputSHA256===row.inputSHA256);if(plans.length!==1)throw Error('common_view_world_plan_missing');validateCommonViewWorldBatch(plans[0].batchPlan,task.scientificContract.analysisMethodRef);}
   commonViewTeacher.routing=routing;
  }
  if(!newTest)strictObject(selection,'selection',['schema','sourceIndexRef','queueRef','purpose','selectedCount','quotas','rows',...(selection.schema==='ohuo-offline-label-selection-v2'?['productionRef']:[])]);
  if(!['ohuo-offline-label-selection-v1','ohuo-offline-label-selection-v2','ohuo-first-round-new-test-selection-result-v1'].includes(selection.schema)||selection.sourceIndexRef!==task.sourcePlan.sourceIndexRef||selection.queueRef!==task.seatLayoutPlan||!['b_training_source','distribution_diagnostic'].includes(selection.purpose)||!Array.isArray(selection.rows)||!selection.rows.length||!commonView&&selection.rows.length>10000||selection.selectedCount!==selection.rows.length||!Array.isArray(selection.quotas))throw Error('frozen selection list required');
  const indexRef=refs.get(task.sourcePlan.sourceIndexRef),sourceIndexPath=realpathSync(inputs.sourceIndexPath),sourceBytes=plainFile(sourceIndexPath),index=JSON.parse(sourceBytes.toString());
  strictObject(indexRef,'sourceIndexRef',['schema','namespace','fileSHA256']);
  if(indexRef.schema!=='ohuo-source-index-ref-v1'||indexRef.namespace!==task.sourcePlan.namespace||sha(sourceBytes)!==indexRef.fileSHA256||index.version!==1||!(newTest?['confirm']:['train','dev']).includes(task.sourcePlan.split))throw Error('offline source index/split differs');
  const queue=refs.get(task.seatLayoutPlan);if(queue?.schema!==(designed?'ohuo-designed-source-queue-v1':'ohuo-complete-match-queue-v1')||queue.namespace!==task.sourcePlan.namespace||queue.sourceIndexRef!==task.sourcePlan.sourceIndexRef||!Array.isArray(queue.rows))throw Error('original frozen complete-match queue required');
  const rules=validateMatchRules(refs.get(task.rulesRef));if(commonViewTeacher?.requestPrompt)assertProjectRuleOptions(rules);
  const lookup=(r:string)=>refs.has(r)?refs.get(r):(firstRound?inputs.readFirstRoundReference?.(r):undefined),proposer=resolveCandidateReleaseRef(lookup(task.parentPolicyRef),lookup,RELEASES),base=proposer.release;
  if(base.mode!=='local'||base.localSelector!=='proposal'||base.tier!=='hard')throw Error('fixed B proposer identity required');
  const teacherRef=refs.get(task.labelPolicyRef);strictObject(teacherRef,'teacher',['schema','releaseRef','profileRevisionRef']);
  if(teacherRef.schema!=='ohuo-offline-teacher-ref-v1'||!task.releaseRefs.includes(teacherRef.releaseRef))throw Error('frozen teacher reference required');
  const releaseRef=resolveCandidateReleaseRef(lookup(teacherRef.releaseRef),lookup,RELEASES);
  const release=releaseRef.release,prompt=refs.get(task.promptRef);strictObject(prompt,'prompt',['schema','promptRef']);
  if(resolveCandidatePolicy(releaseRef.candidatePolicy)!==resolveCandidatePolicy(proposer.candidatePolicy)||release.mode!=='hybrid'||release.localSelector!=='proposal'||release.tier!=='hard'||release.proposalPolicyRef!==base.proposalPolicyRef||!equal(releaseRef.policyIdentity,proposer.policyIdentity)||prompt.schema!=='ohuo-prompt-ref-v1'||prompt.promptRef!==release.promptRef)throw Error('teacher/proposer/prompt identity differs');
  const reference=structuredClone(teacherRef.profileRevisionRef),privateRecord=structuredClone(profileStore.resolve(reference));
  const store={resolve:(ref:any)=>{if(!equal(ref,reference))throw Error('frozen teacher profile reference differs');return structuredClone(privateRecord);}};
  const selector=createProfileSelector({store,reference,fetchImpl:()=>{throw Error('prepare cannot send');}});
  const teacher={releaseRef:teacherRef.releaseRef,promptRef:prompt.promptRef,profileSnapshot:frozenTeacherSnapshot(selector.profile,privateRecord)};
  const confirmedRoots=newTest?[...new Set(inputs.firstRoundNewTest.questionSources.map((q:any)=>q.row.recordRoot))]:inputs.confirmedRecordRoots;if(!Array.isArray(confirmedRoots)||!designed&&!confirmedRoots.length)throw Error('independently verified original record roots required');
  const roots=confirmedRoots.map((p:any)=>realpathSync(p)),cache=new Map(),seen=new Set<string>(),counts=new Map<string,number>(),snapshots:SelectionSnapshot[]=[];
  const naturalRowGuard=(row:SelectedRecordedDecision,seenRows:Set<string>)=>{
   strictObject(row,'selected decision',['recordRef','recordRoot','key','inputSHA256','familyId','split','actorSeat',...(firstRound?['blockFamilyId']:[])]);
   const id=hashJSON(row.key);if(seenRows.has(id)||!roots.includes(realpathSync(row.recordRoot))||row.split!==task.sourcePlan.split||!task.sourcePlan.familyIds.includes(row.blockFamilyId??row.familyId)||index.families?.[row.familyId]?.split!==(newTest?'sealed':row.split))throw Error('selection duplicate/root/family/split differs');seenRows.add(id);
  };
  let naturalSnapshots:Map<SelectedRecordedDecision,OfflineSnapshot>|undefined;
  if(!designed){try{const rows=selection.rows as SelectedRecordedDecision[],seenRows=new Set<string>();for(const row of rows)naturalRowGuard(row,seenRows);const values=readOfflineSnapshots(rows,cache,newTest?{purpose:'first-round-new-test'}:undefined);naturalSnapshots=new Map(rows.map((row,i)=>[row,values[i]]));}catch{/* The original per-row path below owns the original first error. */}}
  for(const selectedRow of selection.rows as SelectedDecision[]){
   if('sourceKind'in selectedRow&&selectedRow.sourceKind==='designed-synthetic'){
    const row=selectedRow;strictObject(row,'designed selected decision',['sourceKind','sourceRef','questionId','key','inputSHA256','familyId','blockFamilyId','split','actorSeat']);
    if(!designed||!commonView||selection.purpose!=='b_training_source')throw Error('designed_selection_explicit_teacher_path');
    const id=hashJSON(row.key),sources=queue.rows.filter((q:any)=>q.sourceKind===row.sourceKind&&q.sourceRef===row.sourceRef),s=readSelectionSnapshot(row,inputs.offlineSelection),registration=inputs.offlineSelection.references.get(row.sourceRef);
    if(seen.has(id)||sources.length!==1||row.split!=='train'||task.sourcePlan.split!==row.split||!task.sourcePlan.familyIds.includes(row.blockFamilyId)||index.families?.[row.familyId]?.split!==row.split||index.families?.[row.blockFamilyId]?.split!==row.split||registration.rulesRef!==task.rulesRef||registration.comparisonRef!==task.scientificContract.comparisonRef||!equal(s.state.match.opts,rules))throw Error('designed_teacher_registered_source_binding');seen.add(id);
    const x=s.input.candidateInputs;
    if(candidatePolicyForBundle(s.bundle)!==resolveCandidatePolicy(proposer.candidatePolicy)||!x||!equal(x.policyIdentity,proposer.policyIdentity)||x.policyId!==proposer.policyIdentity.policyId||s.input.policyId!==proposer.policyIdentity.policyId||!equal(x.candidateIds,s.bundle.initialCandidateIds))throw Error('designed_original_proposal_capture_identity');
    counts.set(row.blockFamilyId,(counts.get(row.blockFamilyId)??0)+1);snapshots.push(s);continue;
   }
   if(designed)throw Error('designed_teacher_mixed_natural_source');
   const row=selectedRow as SelectedRecordedDecision;
   // The local map exists only after every guard and snapshot succeeded in
   // this synchronous prepare. Failed batches leave the original seen intact.
   if(!naturalSnapshots)naturalRowGuard(row,seen);
   const s=naturalSnapshots?.get(row)??readOfflineSnapshot(row,cache,newTest?{purpose:'first-round-new-test'}:undefined),sourceRows=queue.rows.filter((q:any)=>q.matchId===row.key.matchId),q=sourceRows[0];
   if(sourceRows.length!==1||q.actor!==row.actorSeat||q.split!==row.split||q.roundFamilyIds?.[row.key.gameNo-1]!==row.familyId||firstRound&&q.sourceFamilyId!==row.blockFamilyId||s.record.sourceRef!==selection.sourceIndexRef||s.record.layoutRef!==selection.queueRef||!equal(s.record.rules,rules))throw Error('original queue/record/actor/game binding differs');
   const x=s.input.candidateInputs,seat=s.record.seatSnapshots?.[row.actorSeat] as any;
   if(candidatePolicyForBundle(s.bundle)!==resolveCandidatePolicy(proposer.candidatePolicy)||!x||!equal(x.policyIdentity,proposer.policyIdentity)||x.policyId!==proposer.policyIdentity.policyId||!equal(x.candidateIds,s.bundle.initialCandidateIds))throw Error('original proposal capture identity differs');
   if(selection.purpose==='b_training_source'&&(s.input.policyId!==proposer.policyIdentity.policyId||s.decision.policyId!==proposer.policyIdentity.policyId||!equal(seat?.policyIdentity,proposer.policyIdentity)||s.decision.actualSource!=='B'))throw Error('B training-source selection cannot relabel other acting policies');
   if(selection.purpose==='distribution_diagnostic'){
    if(!commonView&&selection.rows.length>64)throw Error('S diagnostic limit is 64 fixed decisions, not new training data');
    if(newTest){const proof=inputs.firstRoundNewTest,origin=proof.questionSources.filter((o:any)=>equal(o.row,row));if(origin.length!==1||s.decision.actualSource!=='S'||s.input.schema!=='ohuo-decision-input-first-round-v3'||s.input.studentInputs?.studentParentRef!==proof.comparison.studentParentRef||!equal(seat?.firstRoundCapture,{studentParentRef:proof.comparison.studentParentRef,scorer:proof.comparison.envelope.scorer,migrationReceiptRef:proof.comparison.envelope.migrationReceiptRef}))throw Error('new-test original composite423 identity differs');}else assertDiagnosticIdentity({snapshot:s,seat,queueSeat:q.seats?.[row.actorSeat],task,refs,inputs,proposer});
   }
   counts.set(row.blockFamilyId??row.familyId,(counts.get(row.blockFamilyId??row.familyId)??0)+1);snapshots.push(s);
  }
  const quotas=new Map<string,number>();for(const q of selection.quotas){strictObject(q,'quota',['familyId','count']);if(quotas.has(q.familyId)||!Number.isSafeInteger(q.count)||q.count<1)throw Error('frozen family quota invalid');quotas.set(q.familyId,q.count);}
  if(!equal([...counts].sort(),[...quotas].sort()))throw Error('frozen family quota differs');
  if(!commonView&&snapshots.filter(s=>!s.bundle.isUniqueLegalAction).length>task.limits.maxLabelDecisions)throw Error('frozen selection exceeds label quota');
  return {...(commonView?{commonViewTeacher:structuredClone(commonViewTeacher),inputWorkload:{providerRequests:snapshots.length,labelDecisions:snapshots.length,matchAttempts:0,optimizerSteps:0}}:{}),selection:structuredClone(selection),snapshots,teacher,store,reference,sourceIndexPath,sourceIndexSHA256:indexRef.fileSHA256,...(blindReview?{blindReview}:{})};
 };
 const validateCheckpoint=(c:Checkpoint)=>firstRoundScreenCheckpoint(c)||!!c&&c.schema==='ohuo-offline-label-run-v1'&&typeof c.taskSHA256==='string'&&typeof c.selectionRef==='string'&&Number.isSafeInteger(c.cursor)&&c.cursor>=0&&Array.isArray(c.rows)&&c.rows.length===c.cursor&&typeof c.executionUnknown==='boolean'&&(c.active===null||!!c.active&&c.active.index===c.cursor&&typeof c.active.inputSHA256==='string');
 const run=async(ctx:any)=>{
  if(ctx.executionInputs.kind==='first-round-screen')return runFirstRoundScreen(ctx);
  const {task,signal,executionInputs:p}=ctx as {task:any;signal:AbortSignal;executionInputs:Prepared};
  const r2=!!p.commonViewTeacher;
  if(r2&&ctx.executionBoundary?.mode!=='input-workload-only')throw Error('common_view_execution_boundary');
  let cp:Checkpoint=ctx.checkpoint?structuredClone(ctx.checkpoint):{schema:'ohuo-offline-label-run-v1',taskSHA256:digest(task),selectionRef:task.datasetRefs[0],cursor:0,active:null,rows:[],executionUnknown:false,...(p.blindReview?{blindReview:p.blindReview.checkpointBinding}:{})};
  let sequence=ctx.checkpointSequence,apiInvoked=false,worldPreparationEntered=false;const meters:Array<{drain:()=>Promise<void>}>=[],labels=join(task.outputRoot,'labels');mkdirSync(labels,{recursive:true,mode:0o700});
  const save=async()=>ctx.saveCheckpoint(cp,++sequence);
  const summary=()=>{const path=join(task.outputRoot,'offline-summary.json'),value={schema:'ohuo-offline-label-summary-v1',runId:task.runId,taskSHA256:cp.taskSHA256,selectionRef:cp.selectionRef,purpose:p.blindReview?.purpose??p.selection.purpose,...(p.blindReview?{blindReview:p.blindReview.checkpointBinding}:{}),cursor:cp.cursor,total:p.snapshots.length,rows:cp.rows,executionUnknown:cp.executionUnknown,consumption:ctx.getConsumption(),interpretation:'teacher suggestions only, never executed; no strength or training qualification claim'},tmp=`${path}.tmp-${process.pid}-${sequence}`;writeFileSync(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(tmp,path);return{path,sha256:sha(readFileSync(path)),purpose:'fixed offline selection terminals; private labels separately hash-bound'};};
  try{
   if(!equal(cp.blindReview??null,p.blindReview?.checkpointBinding??null))throw Error('offline blind diagnostic checkpoint binding differs');
   if(!validateCheckpoint(cp)||cp.taskSHA256!==digest(task)||cp.selectionRef!==task.datasetRefs[0]||cp.executionUnknown||(cp.active&&!(r2&&(cp.active as any).phase==='world-preparation'&&cp.active.index===cp.cursor&&cp.active.inputSHA256===p.snapshots[cp.cursor]?.row.inputSHA256))||cp.cursor>p.snapshots.length)throw Error('execution_uncertain: no clean offline query boundary');
   const files=readdirSync(labels).sort(),expected=cp.rows.map((_:any,i:number)=>`q${i}.json`).sort();if(!equal(files,expected))throw Error('execution_uncertain: uncheckpointed offline result');
   for(let i=0;i<cp.rows.length;i++){const r=cp.rows[i];if(r.resultRef.path!==join(labels,`q${i}.json`)||sha(plainFile(r.resultRef.path))!==r.resultRef.sha256||!equal(r.key,p.snapshots[i].row.key)||r.inputSHA256!==p.snapshots[i].row.inputSHA256)throw Error('offline terminal checkpoint identity differs');}
   while(cp.cursor<p.snapshots.length){
    if(signal.aborted||!r2&&performance.now()>=ctx.deadlineMonotonicMs)break;
    if(sha(plainFile(p.sourceIndexPath))!==p.sourceIndexSHA256)throw Error('source index changed');
    const s=p.snapshots[cp.cursor],sourceOutcome=offlineSnapshotActing(s);
    let commonView:any=null,commonViewTerminal:any=null,preparationFailure:string|null=null;
    if(r2){
     try{commonView=commonViewForSnapshot(s);}catch(error){if(error instanceof Error&&error.message==='action_representation_ambiguous')preparationFailure=error.message;else throw error;}
     if(commonView){
      const priorRef=(cp.active as any)?.worldPreparation??null;
      worldPreparationEntered=true;
      cp.active={index:cp.cursor,inputSHA256:s.row.inputSHA256,phase:'world-preparation',worldPreparation:priorRef} as any;await save();
      const directory=join(task.outputRoot,'worlds');mkdirSync(directory,{recursive:true,mode:0o700});
      const batchPlan=p.commonViewTeacher.worldPlanDocument.rows.find((r:any)=>r.inputSHA256===s.row.inputSHA256).batchPlan;
      let worldPreparation=priorRef,prior=null;
      if(priorRef){if(priorRef.path!==join(directory,`q${cp.cursor}-${priorRef.sha256}.json`))throw Error('world_cache_path_identity');const bytes=plainFile(priorRef.path);if(sha(bytes)!==priorRef.sha256)throw Error('world_cache_file_changed');prior=JSON.parse(bytes.toString('utf8'));}
      const world=await prepareCommonViewWorlds(s,{ctx,batchPlan,checkpoint:prior,onCheckpoint:async(value:any)=>{
       const bytes=JSON.stringify(value),hash=sha(bytes),path=join(directory,`q${cp.cursor}-${hash}.json`);
       if(existsSync(path)){if(sha(plainFile(path))!==hash)throw Error('world_cache_file_changed');}else writeFileSync(path,bytes,{flag:'wx',mode:0o600});
       worldPreparation={id:'r2-world-'+hash,path,sha256:hash};(cp.active as any).worldPreparation=worldPreparation;await save();
      }});
      if(world.status==='interrupted'){await save();break;}
      if(!worldPreparation)throw Error('world_cache_final_checkpoint_required');
      if(world.status==='unavailable')preparationFailure='legal_world_unavailable';
      commonViewTerminal={schema:'ohuo-common-view-terminal-r2',systemPromptSHA256:p.commonViewTeacher.requestPrompt?.systemPromptSHA256??COMMON_VIEW_SYSTEM_PROMPT_SHA256,...(p.commonViewTeacher.requestPrompt?{requestSchema:p.commonViewTeacher.requestPrompt.schema,promptId:p.commonViewTeacher.requestPrompt.promptId,actualPromptRef:p.commonViewTeacher.actualPromptRef}:{}),legacyTeacherPromptRef:p.teacher.promptRef,protocolRef:task.scientificContract.analysisMethodRef,viewSHA256:commonView.viewSHA256,modelPayloadBytes:commonView.modelPayloadBytes,addressMap:commonView.addressMap,worldPreparation,representationGaps:world.representationGaps,preparationStatus:world.status,routingRole:p.commonViewTeacher.routing.role};
     }else commonViewTerminal={schema:'ohuo-common-view-terminal-r2',systemPromptSHA256:p.commonViewTeacher.requestPrompt?.systemPromptSHA256??COMMON_VIEW_SYSTEM_PROMPT_SHA256,...(p.commonViewTeacher.requestPrompt?{requestSchema:p.commonViewTeacher.requestPrompt.schema,promptId:p.commonViewTeacher.requestPrompt.promptId,actualPromptRef:p.commonViewTeacher.actualPromptRef}:{}),legacyTeacherPromptRef:p.teacher.promptRef,protocolRef:task.scientificContract.analysisMethodRef,viewSHA256:null,modelPayloadBytes:null,addressMap:[],worldPreparation:null,representationGaps:[],preparationStatus:'input-unavailable',routingRole:p.commonViewTeacher.routing.role};
    }
    cp.active={index:cp.cursor,inputSHA256:s.row.inputSHA256,...(r2?{phase:'provider'}:{})} as any;await save();
    const local=new AbortController(),abort=()=>local.abort(signal.reason??'user_stop');signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    const timer=r2?null:setTimeout(()=>local.abort('run_boundary'),Math.max(0,ctx.deadlineMonotonicMs-performance.now()));
    let result:Awaited<ReturnType<typeof queryOfflineTeacher>>|null=null,unknown=false;const teacherResponses:any[]=[];
    const meter=createMeteredRemote({store:p.store,reference:p.reference,reserve:ctx.reserve,settleReservation:ctx.settleReservation,cancel:(r:string)=>local.abort(r),keyPrefix:`l${cp.cursor}-${ctx.executionId}`,ownerSignal:signal,onSent:()=>{if(mode==='research')apiInvoked=true;},...(fetchImpl?{fetchImpl}:{})});meters.push(meter);
    try{result=preparationFailure?{status:preparationFailure,remote:null,offlineLabel:null} as any:await queryOfflineTeacher({snapshot:s,teacher:p.teacher,...(r2?{commonView,...(p.commonViewTeacher.requestPrompt?{projectRulesPrompt:p.commonViewTeacher.requestPrompt}:{})}:{}),request:async(view,signal)=>{const response=await meter.request(view,signal);if(response.status==='response')teacherResponses.push(structuredClone(response.response));return response;},signal:local.signal});await meter.drain();unknown=local.signal.reason==='execution_uncertain'||result.remote?.attempts.some(a=>a.requestCount===null)===true;}
    catch{unknown=true;try{await meter.drain();}catch{}}
    finally{if(timer!==null)clearTimeout(timer);signal.removeEventListener('abort',abort);}
    const terminal={schema:'ohuo-offline-label-result-v1',...(r2?{commonView:commonViewTerminal}:{}),...(p.blindReview?{blindReview:p.blindReview.checkpointBinding}:{}),...(s.input.schema==='ohuo-decision-input-first-round-v3'?{teacherResponses}:{}),purpose:p.blindReview?.purpose??p.selection.purpose,selectionRef:cp.selectionRef,index:cp.cursor,source:s.row,inputSHA256:s.row.inputSHA256,key:s.row.key,decisionId:s.bundle.decisionId,acting:sourceOutcome.acting,proposal:{policyId:s.input.candidateInputs!.policyId,policyIdentity:s.input.candidateInputs!.policyIdentity},teacher:p.teacher,status:unknown?'execution_uncertain':result!.status,labelKind:!p.blindReview&&(!r2||p.commonViewTeacher.routing.role!=='independent-review')&&!unknown&&result?.offlineLabel?.legality==='validated'?'offline_suggested':null,remote:result?.remote??null,offlineLabel:unknown||p.blindReview||r2&&p.commonViewTeacher.routing.role==='independent-review'?null:result?.offlineLabel??null};
    const path=join(labels,`q${cp.cursor}.json`),bytes=JSON.stringify(terminal);writeFileSync(path,bytes,{flag:'wx',mode:0o600});
    const selected=!unknown&&result?.remote?.status==='selected'?result.remote:null,seat=sourceOutcome.acting.seatSnapshot as any;
    cp.rows.push({key:s.row.key,inputSHA256:s.row.inputSHA256,familyId:s.row.familyId,...(s.row.blockFamilyId?{blockFamilyId:s.row.blockFamilyId}:{}),split:s.row.split,actorSeat:s.row.actorSeat,...(sourceOutcome.sourceKind==='designed-synthetic'?{sourceKind:sourceOutcome.sourceKind,source:s.row}:{}),actingPolicyId:sourceOutcome.acting.policyId,proposalPolicyIdentity:s.input.candidateInputs!.policyIdentity,actingReleaseRef:seat?.releaseRef??null,studentReleaseSHA256:seat?.studentReleaseSHA256??null,scorerWeightsSHA256:seat?.studentRelease?.scorer?.weightsSHA256??null,studentCheckpointSHA256:seat?.studentRelease?.checkpoint?.sha256??null,actualActionId:sourceOutcome.acting.actionId,teacherActionId:selected?.actionId??null,teacherReleaseRef:p.teacher.releaseRef,inInitialCandidateSet:selected?.inInitialCandidateSet??null,actionAgreement:selected&&sourceOutcome.acting.actionId!==null?selected.actionId===sourceOutcome.acting.actionId:null,status:terminal.status,reason:unknown?'execution_uncertain':result?.remote&&result.remote.status!=='selected'?result.remote.reason:null,labelKind:terminal.labelKind,requestCount:unknown?null:result?.remote?result.remote.requestCount:0,resultRef:{path,sha256:sha(bytes)}});cp.cursor++;cp.active=null;cp.executionUnknown=unknown;await save();
    if(unknown)throw Error('execution_uncertain: offline request result unknown');
    if(local.signal.aborted||result?.status==='halted')break;
    await new Promise<void>(resolve=>setImmediate(resolve));
   }
   return {completed:cp.cursor===p.snapshots.length,cleanupConfirmed:true,actualScope:scope(apiInvoked),stopReason:signal.aborted?String(signal.reason??'user_stop'):'run_boundary',artifactRefs:[summary()]};
  }catch(error){
   const beforeFirstProvider=worldPreparationEntered&&r2&&!apiInvoked&&meters.length===0&&cp.cursor===0&&cp.rows.length===0&&(cp.active as any)?.phase==='world-preparation';
   cp.executionUnknown=!beforeFirstProvider;await Promise.allSettled(meters.map(m=>m.drain()));try{await save();}catch{}
   Object.assign(error as object,{cleanupConfirmed:true,actualScope:scope(apiInvoked)});throw error;
  }
 };
 return {id:'B07.offline-label.v1',kind:'collect',mode,prepare,validateCheckpoint,run};
}
/** Read-only identity binding, not a second student loader: the trusted source
 * host already produced this confirmed S action. Read only its frozen release
 * JSON, never scorer weights/checkpoints or forward. S stays outside B09 admit. */
export function assertDiagnosticIdentity({snapshot:s,seat,queueSeat,task,refs,inputs,proposer}:any){
 if(!seat||!task.releaseRefs.includes(seat.releaseRef)||queueSeat?.releaseRef!==seat.releaseRef||queueSeat.mode!=='local'||queueSeat.profileRevisionRef!==null)throw Error('diagnostic original acting seat differs');
 const ref=refs.get(seat.releaseRef);strictObject(ref,'studentRef',['schema','policyId','releaseSHA256']);
 const path=inputs.studentReleasePaths?.[seat.releaseRef];if(typeof path!=='string'||realpathSync(path)!==path)throw Error('independently verified fixed student release path required');
 const bytes=plainFile(path),release=JSON.parse(bytes.toString()),candidatePolicy=resolveStudentCandidatePolicy(release);
 if(ref.schema!=='ohuo-student-task-release-v1'||sha(bytes)!==ref.releaseSHA256||seat.studentReleaseSHA256!==ref.releaseSHA256||!equal(release,seat.studentRelease)||candidatePolicy!==resolveCandidatePolicy(proposer.candidatePolicy)||candidatePolicy!==candidatePolicyForBundle(s.bundle)||release.trainingKind!=='supervised_rerank'||release.policyId!==ref.policyId||release.policyId===proposer.policyIdentity.policyId||s.decision.policyId!==release.policyId||s.input.policyId!==release.policyId||s.record.policyIds[s.row.actorSeat]!==release.policyId||s.decision.actualSource!=='S'||!s.bundle.initialCandidateIds.includes(s.decision.actualActionId))throw Error('diagnostic acting S identity differs');
 if(release.proposer?.policyRef!==proposer.release.proposalPolicyRef||!equal(release.proposer.identity,proposer.policyIdentity)||!equal(seat.policyIdentity,proposer.policyIdentity)||release.candidateSpecRef!==s.bundle.candidateSpec||release.tieBreakId!=='first-candidate-v1'||seat.release?.localSelector!=='student'||seat.release?.mode!=='local')throw Error('diagnostic proposer B identity differs');
 const validSHA=(x:any)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 if(!validSHA(release.scorer?.weightsSHA256)||release.scorer.inputDim!==399||release.scorer.policyId===release.policyId||release.scorer.policyId===proposer.policyIdentity.policyId||!validSHA(release.checkpoint?.sha256)||typeof release.checkpoint.path!=='string'||!release.checkpoint.path||[release.dataset,release.recipe,release.selection].some(r=>!r||typeof r.id!=='string'||!r.id||!validSHA(r.sha256)))throw Error('diagnostic scorer/checkpoint/frozen references missing');
}
/** Explicit trusted adapters only; CLI remains capability_planned without one. */
export function createOfflineLabelTaskHost({root,adapter,screenRevalidation=null,...options}:{root:string;adapter:any;screenRevalidation?:any;screenOnly?:boolean;profileStore:any;mode?:'research'|'offline_synthetic';fetchImpl?:typeof fetch}){
 return (createTaskController as any)({root,adapter,screenRevalidation,consumers:[createOfflineLabelConsumer(options)]});
}
