import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,lstatSync,realpathSync,readdirSync,renameSync,symlinkSync,unlinkSync,chmodSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {isDeepStrictEqual as equal} from 'node:util';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';

// One finite case. It executes the actual selection entry and round live tail,
// with synthetic immutable producers; no private records, H start, or network.
const args=process.argv.slice(2),registered=args[0]==='--case';
if(registered)assert.deepEqual(args,['--case','training.single-run-selection-reuse']);
else assert.equal(args.length,3,'expected source.ts source-batch.mjs accepted197-before.ts');
const source=readFileSync(registered?'lab/review6_2/offline-selection.ts':args[0],'utf8');
const original=readFileSync(registered?'lab/out/v54-minimal-reuse/integration/offline-selection.ts.before':args[2],'utf8');
const batch=await import(pathToFileURL(resolve(registered?'lab/review6_2/first-round-source-batch.mjs':args[1])).href);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),sha=x=>createHash('sha256').update(x).digest('hex');
const slice=(s,start,end)=>{const a=s.indexOf(start),b=s.indexOf(end,a);assert.ok(a>=0&&b>a,`${start} through ${end}`);return s.slice(a,b);};
const roundLive=s=>slice(s,' const state=stateOverride??',' // Publish only after the original live tail succeeds.');
const labelLive=s=>slice(s," if(trustedInputs.phase==='label-start'||trustedInputs.phase==='label-resume'){",' // Cache only after every original artifact comparison and live gate passed.');
assert.equal(roundLive(source),roundLive(original),'original round live predicates remain byte-identical');
assert.equal(labelLive(source),labelLive(original),'original current label predicates remain byte-identical');
assert.equal(slice(source,'export function verifyTrainCoverageRevision','function verifiedPublicStrata'),slice(original,'export function verifyTrainCoverageRevision','function verifiedPublicStrata'),'original scientific parent revision checks remain byte-identical');

const temp=realpathSync(mkdtempSync(join(tmpdir(),'single-run-proof-v54-')));
const counters={fixedReads:0,inputs:0,enumerations:0,loads:0,prefixReplays:0,roundBuilds:0,parentChecks:0},timings=[];
let failLoader=false,failStatic=false,failSink=false;
const f={temp,counters,timings,exposures:[]};
const put=(path,value)=>{writeFileSync(path,JSON.stringify(value),{mode:0o600});return path;};
try{
 mkdirSync(join(temp,'record'));mkdirSync(join(temp,'runs'));mkdirSync(join(temp,'runs','related'));
 f.dataFile=put(join(temp,'population.json'),{fixed:'original'});f.continuationFile=put(join(temp,'continuation.json'),{fixed:'continuation'});
 f.record=join(temp,'record');f.input={key:{matchId:'m',gameNo:1,moveNo:1,requestSeq:1,actorSeat:0},payload:'fixed'};
 f.privateFile=put(join(f.record,'decision-1.private.json'),f.input);f.gameFile=put(join(f.record,'game-1.private.json'),{fixed:'game'});
 put(join(f.record,'identity.json'),{fixed:'identity'});put(join(f.record,'events.jsonl'),{fixed:'journal'});
 f.row={recordRef:{directory:f.record,identitySHA256:'fixture',journalSHA256:'fixture',journalBytes:1},recordRoot:temp,key:f.input.key,inputSHA256:hash(f.input),decisionId:'d',split:'train',familyId:'family',actorSeat:0};
 f.spec={schema:batch.COMMON_VIEW_ROUND_SPEC_SCHEMA,roundContractRef:'contract',planRef:'plan',sourceIndexRef:'index',queueRef:'queue',selectionRuleRef:'rule',quotaBasisRef:{id:'quota'},targetDefinitionRef:'target',actingReleaseRef:'acting',purpose:'b_training_source'};
 f.contract={schema:batch.COMMON_VIEW_ROUND_CONTRACT_SCHEMA,protocolRef:'protocol',poolRef:'pool',round:1,parentSelectionRef:'prior-selection',continuationEvidenceRefs:[{id:'continuation'}],plannedTasks:[],coverageRevisionRef:'coverage'};
 f.pool={schema:batch.COMMON_VIEW_POOL_SCHEMA,protocolRef:'protocol',planRef:'plan',budgetRef:'budget',sourceIndexRef:'index',queueRef:'queue',families:[]};
 f.coverage={round:1,parentSelectionRef:'prior-selection',trainFamilyIds:[],selectionPolicy:batch.TRAIN_PUBLIC_STRATA_POLICY};
 f.production={schema:'ohuo-offline-selection-production-v1',specRef:'spec',sourceInventoryRef:{id:'inventory'},populationRef:{id:'population'},selectedMetadataRef:{id:'metadata'},exclusionsRef:{id:'exclusions'},quotaBasisRef:f.spec.quotaBasisRef,selectionRuleRef:'rule',targetDefinitionRef:'target',createdBeforeLabelEvidenceRef:{id:'freeze'},counts:{fixture:1},verification:'reproduced'};
 f.selection={schema:'ohuo-offline-label-selection-v2',sourceIndexRef:'index',queueRef:'queue',purpose:'b_training_source',selectedCount:0,quotas:[],rows:[],productionRef:'production'};
 f.result={rows:[],quotas:[],counts:f.production.counts,verification:'reproduced',quota:{budgetRef:'budget',freezeEvidenceRef:{id:'freeze'}},selectionRule:{fixture:true},sourceInventory:[],population:[{fixture:true}],selectedMetadata:[],exclusions:[]};
 f.roundValue={entries:[],chain:{chain:[],priorSelectionRefs:['prior-selection'],usedRows:[]},base:{},basePopulation:[],baseInventory:[],baseExclusions:[],sourceRuns:[],publicStrata:[],staticProof:{coverageEligibleKeys:[],coverageReadout:[],prefixReplays:1}};
 f.task={taskId:'owner',runId:'owner',sourceRevision:'source197',capabilityRef:'cap',planRef:'plan',budgetRef:'budget',datasetRefs:['selection'],sourcePlan:{sourceIndexRef:'index',split:'train',familyIds:['family']},seatLayoutPlan:'queue',releaseRefs:['acting'],parentPolicyRef:'acting'};
 const related={taskId:'related',runId:'related',taskKind:'collect',planRef:'plan',budgetRef:'budget',datasetRefs:['unrelated-selection'],sourcePlan:{sourceIndexRef:'index'},seatLayoutPlan:'queue',scientificContract:{analysisMethodRef:'other'},outputRoot:join(temp,'runs','related')};
 const cp={schema:'fixture-diagnostic',executionUnknown:false,active:null},cpSHA=hash(cp);put(join(related.outputRoot,'task.json'),related);put(join(related.outputRoot,`checkpoint-${cpSHA}.json`),cp);
 f.state={budgets:{budget:{reservations:{},activeRunId:null}},tasks:{related:'related'},runs:{related:{runId:'related',task:related,taskRef:'task@sha256:'+hash(related),taskSHA256:hash(related),status:'completed',cleanupConfirmed:true,executionUnknown:false,checkpoint:cp,checkpointSHA256:cpSHA,checkpointRef:join(related.outputRoot,`checkpoint-${cpSHA}.json`)}}};
 f.frozenState=structuredClone(f.state);put(join(temp,'state.json'),f.state);
 const refs=new Map([['cap',{id:'B07.offline-label.v1'}],['rule',{schema:batch.COMMON_VIEW_SELECTION_SCHEMA}],['production',f.production],['spec',f.spec],['contract',f.contract],['pool',f.pool]]),catalog={references:refs,evidenceFiles:new Map()};
 const helper=slice(source,'const reproductionSessions=','// END instance-local immutable round proof');
 const regular=slice(source,'function regular(path:string)','function fileBytes');
 let round=slice(source,'export function verifyCommonViewRoundAdmission','function enumerateLaterRound');
 // Keep the candidate's early cache boundary and complete live tail. The fixed
 // scientific producer is a finite substitute; full native admission is separate.
 const a=round.indexOf(' const families=readCommonViewSourceFamilies'),b=round.indexOf(' });\n const {entries',a);assert.ok(a>0&&b>a);
 round=round.slice(0,a)+' return fixtureRoundStatic(t);\n'+round.slice(b);
 const verify=slice(source,'export function verifyOfflineSelection','async function main()');
 const fixtureCode=`
function fixtureRead(){f.counters.fixedReads++;const value=JSON.parse(regular(f.dataFile).toString());if(value.fixed!=='original')fail('fixture_fixed_bytes_changed');return value;}
function fixtureRoundStatic(t){f.counters.roundBuilds++;fixtureRead();loadMatchStore(f.row.recordRef,f.row.recordRoot);loadMatchStore(f.row.recordRef,f.row.recordRoot);readOfflineSnapshot(f.row,new Map());if(failStatic())fail('fixture_static_failure');return structuredClone(f.roundValue);}
function committedSelection(){fixtureRead();return {selection:structuredClone(f.selection),production:structuredClone(f.production),selectionRef:'selection'};}
function inputs(spec,t){f.counters.inputs++;fixtureRead();return {firstRound:true,commonView:true,state:structuredClone(f.frozenState),roundAdmission:verifyCommonViewRoundAdmission(spec,t,f.frozenState)};}
function enumerate(){f.counters.enumerations++;fixtureRead();return structuredClone(f.result);}
function lines(ref){fixtureRead();return structuredClone(({inventory:f.result.sourceInventory,population:f.result.population,metadata:f.result.selectedMetadata,exclusions:f.result.exclusions})[ref.id]);}
function fileBytes(){return regular(f.continuationFile);}
function verifyTrainCoverageRevision(ref,t,state){f.counters.parentChecks++;if(state.parentUnknown)fail('coverage_completed_parent');return structuredClone(f.coverage);}
`;
 const deps={AsyncLocalStorage,digest:hash,hashJSON:hash,sha,canonical:JSON.stringify,equal,structuredClone,lstatSync,realpathSync,readdirSync,readFileSync,join,writeSync:(_fd,text)=>{if(failSink)throw Error('closed timing sink');timings.push(JSON.parse(text));},f,
  fail:reason=>{throw Error(reason);},strict:()=>{},validateTrusted:()=>{},validateSpec:()=>{},fixedReference:()=>{},validateIdentifier:()=>{},validateCommonViewRoundTasks:()=>[],
  refValue:(ref,t)=>structuredClone(t.references.get(ref)),outputRoot:()=>temp,labelRuns:()=>f.exposures,hasExposure:r=>r.exposed,knownUnsentWorldPreparationFailure:()=>false,
  loadOriginalMatchStore:()=>{counters.loads++;if(failLoader)throw Error('fixture_original_loader_failure');assert.deepEqual(JSON.parse(readFileSync(f.privateFile,'utf8')),f.input,'private input unchanged');assert.deepEqual(JSON.parse(readFileSync(f.gameFile,'utf8')),{fixed:'game'},'private game unchanged');return {recorder:{snapshot:()=>({record:{fixture:true}})}};},
  readOriginalOfflineSnapshot:()=>{counters.prefixReplays++;return {bundle:{decisionId:'d'},payload:{}};},commonViewForSnapshot:s=>({modelPayload:s.payload}),trainCoveragePublicReason:()=>null,
  assertCommonViewRoundTerminalsSettled:batch.assertCommonViewRoundTerminalsSettled,COMMON_VIEW_SELECTION_SCHEMA:batch.COMMON_VIEW_SELECTION_SCHEMA,COMMON_VIEW_ROUND_SPEC_SCHEMA:batch.COMMON_VIEW_ROUND_SPEC_SCHEMA,COMMON_VIEW_ROUND_CONTRACT_SCHEMA:batch.COMMON_VIEW_ROUND_CONTRACT_SCHEMA,COMMON_VIEW_POOL_SCHEMA:batch.COMMON_VIEW_POOL_SCHEMA,TRAIN_PUBLIC_STRATA_POLICY:batch.TRAIN_PUBLIC_STRATA_POLICY,
  hex:x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),key:JSON.stringify,failStatic:()=>failStatic};
 const code=stripTypeScriptTypes(helper+regular+fixtureCode+round+verify,{mode:'strip'}).replaceAll('export ','')+';return {verifyOfflineSelection,verifyCommonViewRoundAdmission,createOfflineSelectionReproductionSession,createCommonViewRoundProofSession,withCoverageEligibilityScope};';
 const api=new Function(...Object.keys(deps),code)(...Object.values(deps));
 const t={...catalog,repositoryRoot:temp,controlRoot:temp,sourceIndexPath:join(temp,'index'),confirmedRecordRoots:[temp],mode:'research',phase:'label-start',task:f.task,reproductionSession:api.createOfflineSelectionReproductionSession(catalog),roundProofSession:api.createCommonViewRoundProofSession(f.task,catalog)};
 const call=(trusted=t)=>api.verifyOfflineSelection(f.selection,trusted),roundCall=(state=f.state,trusted=t)=>api.verifyCommonViewRoundAdmission(f.spec,trusted,state);
 const baseline=call(),cold={...counters};assert.equal(cold.loads,1,'one loader per cold fixed scope');
 const warm=call();assert.deepEqual(warm,baseline);for(const k of ['fixedReads','inputs','enumerations','loads','prefixReplays','roundBuilds'])assert.equal(counters[k],cold[k],`${k} not repeated on warm selection/round`);assert.ok(counters.parentChecks>cold.parentChecks,'parent check remains live');
 warm.population.push({callerMutation:true});assert.deepEqual(call(),baseline,'returned copies cannot mutate the cached proof');
 const old={runId:'old',exposed:true,task:{datasetRefs:['prior-selection'],sourcePlan:{split:'train',familyIds:['family']}}};f.exposures=[old];assert.deepEqual(call(),baseline,'legitimate predecessor exposure remains admitted');
 f.exposures=[{...old,task:{...old.task,datasetRefs:['other-selection']}}];assert.throws(()=>call(),/selection_changed_after_label_exposure/);f.exposures=[];
 assert.throws(()=>roundCall({...f.state,budgets:{}}),/selection_round_state_missing/);
 assert.throws(()=>roundCall({...f.state,parentUnknown:true}),/coverage_completed_parent/);
 const unknown=structuredClone(f.state);unknown.runs.related.executionUnknown=true;assert.throws(()=>roundCall(unknown),/related_run_unsettled/);
 const occupied=structuredClone(f.state);occupied.budgets.budget.reservations.x={runId:'related',status:'reserved_unknown'};assert.throws(()=>roundCall(occupied),/related_checkpoint_unsettled/);
 const stopped=structuredClone(f.state);stopped.runs.related.stopReason='execution_uncertain';assert.throws(()=>roundCall(stopped),/related_run_unsettled/);
 const incomplete=structuredClone(f.state);incomplete.runs.related.cleanupConfirmed=false;assert.throws(()=>roundCall(incomplete),/related_run_unsettled/);
 const fresh=()=>({...t,reproductionSession:api.createOfflineSelectionReproductionSession(catalog),roundProofSession:api.createCommonViewRoundProofSession(f.task,catalog)});
 const failed=fresh(),beforeFailure=counters.roundBuilds;assert.throws(()=>roundCall({...f.state,budgets:{}},failed),/selection_round_state_missing/);roundCall(f.state,failed);assert.equal(counters.roundBuilds-beforeFailure,2,'failed first live gate does not publish static proof');
 const coldFailure=fresh(),beforeLoaderFailure=counters.roundBuilds;failLoader=true;assert.throws(()=>call(coldFailure),/fixture_original_loader_failure/);failLoader=false;call(coldFailure);assert.equal(counters.roundBuilds-beforeLoaderFailure,2,'failed loader does not publish');
 const staticFailure=fresh(),beforeStaticFailure=counters.roundBuilds;failStatic=true;assert.throws(()=>call(staticFailure),/fixture_static_failure/);failStatic=false;call(staticFailure);assert.equal(counters.roundBuilds-beforeStaticFailure,2,'failed static predicate does not publish');
 for(const changed of [{task:{...f.task,runId:'other'}},{task:{...f.task,sourceRevision:'other'}},{phase:'dataset'},{phase:'freeze'},fresh(),{reproductionSession:{},roundProofSession:{}}]){const before=counters.roundBuilds;call({...t,...changed});assert.ok(counters.roundBuilds>before,'run/source/phase/new-session/fake-token cannot use old proof');}
 const coldResume={...t,phase:'label-resume'};assert.throws(()=>call(coldResume),/selection_resume_binding/,'current missing checkpoint is rejected');
 // Same length and restored mtime still changes ctime. Only synthetic files change.
 const st=lstatSync(f.dataFile),bytes=readFileSync(f.dataFile);writeFileSync(f.dataFile,bytes.toString().replace('original','modified'));utimesSync(f.dataFile,st.atime,st.mtime);assert.throws(()=>call(),/fixture_fixed_bytes_changed/);writeFileSync(f.dataFile,bytes);const beforeRepair=counters.roundBuilds;call();assert.ok(counters.roundBuilds>beforeRepair,'changed file evicts related nested proofs');
 put(f.privateFile,{...f.input,payload:'wrong'});assert.throws(()=>call(),/private input unchanged/);put(f.privateFile,f.input);call();
 put(f.gameFile,{fixed:'wrong'});assert.throws(()=>call(),/private game unchanged/);put(f.gameFile,{fixed:'game'});call();
 const beforeInode=counters.roundBuilds;writeFileSync(f.dataFile+'.replacement',bytes,{mode:0o600});renameSync(f.dataFile+'.replacement',f.dataFile);call();assert.ok(counters.roundBuilds>beforeInode,'inode replacement cold-checks identical bytes');
 const beforeMode=counters.roundBuilds;chmodSync(f.dataFile,0o640);call();assert.ok(counters.roundBuilds>beforeMode,'mode is part of dependency identity');chmodSync(f.dataFile,0o600);call();
 const beforeDirectory=counters.roundBuilds;put(join(f.record,'extra.json'),{extra:true});call();assert.ok(counters.roundBuilds>beforeDirectory,'directory membership invalidates');
 renameSync(f.dataFile,f.dataFile+'.original');symlinkSync(f.dataFile+'.original',f.dataFile);assert.throws(()=>call(),/selection_regular_file_required/);unlinkSync(f.dataFile);renameSync(f.dataFile+'.original',f.dataFile);call();
 failSink=true;assert.deepEqual(call(),baseline);assert.throws(()=>roundCall({...f.state,budgets:{}}),/selection_round_state_missing/);failSink=false;
 assert.ok(timings.some(x=>x.stage==='round-admission'&&x.staticMode==='guarded-reuse'));
 console.log(JSON.stringify({status:'PASS_FIXED_PROOF_REUSE_FINITE_ENTRY',checkId:'S35-R11-SINGLE-RUN-SELECTION-REUSE.single-run-selection-reuse',coldAndWarmEquivalent:true,warmFixedBuilderReadsLoadsAndReplays:0,legitimatePredecessorExposurePreserved:true,nonPredecessorExposureRejected:true,currentUnknownReservationStopAndCleanupRejected:true,failedFirstProofNotPublished:true,changedFileInputGameDirectoryModeAndSymlinkInvalidated:true,runSourcePhaseAndSessionIsolation:true,originalDynamicTailByteIdentical:true,notFullNativeAdmission:true,actualHPerformancePending:true,providerRequests:0,optimizerUpdates:0}));
}finally{rmSync(temp,{recursive:true,force:true});}
