/** One finite dual-split/multi-cell fixture. No source replay, worlds, providers,
 * or learning. Catalog/Task/disk-byte admission remains integration-reviewed. */
import assert from 'node:assert/strict';
import {selectCommonViewRepresentatives,selectNextCommonViewRepresentatives,validateCommonViewRoundChain,assertCommonViewRoundTerminalsSettled,COMMON_VIEW_ROUND_CONTRACT_SCHEMA} from '../first-round-source-batch.mjs';
const cell=n=>({targetKind:n?'pair':'single',opponentSizeRelation:'=',hasOrdinaryTakeover:true,partnerZero:false});
const row=(split,n,c)=>({key:{matchId:split,decision:n},inputSHA256:String(n).padStart(64,'0'),split,blockFamilyId:split+'-family',commonViewCell:cell(c)});
const train=[row('train',1,0),row('train',2,1),row('train',3,0),row('train',4,0)],dev=[row('dev',5,0),row('dev',6,1),row('dev',7,1)];
const r0=[...selectCommonViewRepresentatives(train,0).selected,...selectCommonViewRepresentatives(dev,0).selected];
assert.deepEqual(r0.map(r=>r.key.decision),[1,2,5,6]);
const first={round:0,parentSelectionRef:null,selectionRef:'selection0',rows:r0};
const contract={schema:COMMON_VIEW_ROUND_CONTRACT_SCHEMA,round:1,parentSelectionRef:'selection0',plannedTasks:[['primary-teacher','train'],['primary-teacher','dev'],['screen','train'],['screen','dev']].map(([role,split])=>({role,split,taskId:role+'-'+split+'-round-1'}))};
assert.throws(()=>validateCommonViewRoundChain({...contract,plannedTasks:[]},[first]),/round_tasks/);
const proof=validateCommonViewRoundChain(contract,[first]);
const t1=selectNextCommonViewRepresentatives(train,1,proof.usedRows),d1=selectNextCommonViewRepresentatives(dev,1,proof.usedRows),r1=[...t1.selected,...d1.selected];
assert.deepEqual(r1.map(r=>[r.split,r.key.decision]),[['train',3],['dev',7]]);
assert.equal(t1.cells.reduce((n,c)=>n+c.eligible,0)+d1.cells.reduce((n,c)=>n+c.eligible,0),7);
assert.equal(t1.cells.reduce((n,c)=>n+c.previouslySelected,0)+d1.cells.reduce((n,c)=>n+c.previouslySelected,0),4);
assert.equal(t1.deferred.length,1);assert.equal(d1.deferred.length,0);
assert.equal(t1.cells.filter(c=>c.exhausted).length,1);assert.equal(d1.cells.filter(c=>c.exhausted).length,1);
const second={round:1,parentSelectionRef:'selection0',selectionRef:'selection1',rows:r1};
const proof2=validateCommonViewRoundChain({...contract,round:2,parentSelectionRef:'selection1'},[second,first]);
assert.deepEqual(selectNextCommonViewRepresentatives(train,2,proof2.usedRows).selected.map(r=>r.key.decision),[4]);
assert.equal(selectNextCommonViewRepresentatives(dev,2,proof2.usedRows).selected.length,0);
const usedAll=[...proof2.usedRows,train[3]];
assert.equal(selectNextCommonViewRepresentatives(train,3,usedAll).selected.length,0);
assert.ok(selectNextCommonViewRepresentatives(train,3,usedAll).cells.every(c=>c.exhausted));
assert.throws(()=>validateCommonViewRoundChain({...contract,round:2,parentSelectionRef:'selection1'},[second]),/predecessor_chain_missing/);
assert.throws(()=>validateCommonViewRoundChain(contract,[first,{...second,round:0}]),/predecessor_chain_gap_or_fork/);
assert.throws(()=>validateCommonViewRoundChain({...contract,parentSelectionRef:'wrong'},[first]),/latest_predecessor/);
assert.throws(()=>validateCommonViewRoundChain(contract,[first,{...second,rows:[r0[0]]}]),/frozen_selection_repeated/);
assert.throws(()=>selectNextCommonViewRepresentatives([{...train[0],inputSHA256:'f'.repeat(64)}],1,r0),/used_input_changed/);
assert.throws(()=>selectCommonViewRepresentatives(train,1),/initial_representative_round_required/);
const terminal=r=>({...r,status:'invalid_response',requestCount:0});
const settled={status:'completed',cleanupConfirmed:true,executionUnknown:false,labelRole:'primary',activeReservation:false,checkpoint:{schema:'ohuo-offline-label-run-v1',selectionRef:'selection0',cursor:r0.length,rows:r0.map(terminal),executionUnknown:false,active:null}};
// Invalid/zero-request terminals remain used; successful-label filtering would
// incorrectly reselect 1/2/5/6 and would fail the assertions above.
assert.equal(assertCommonViewRoundTerminalsSettled([first],[settled]),true);
for(const altered of [
 {...settled,status:'active'}, {...settled,cleanupConfirmed:false}, {...settled,executionUnknown:true},
 {...settled,activeReservation:true}, {...settled,checkpoint:{...settled.checkpoint,active:{index:0}}},
 {...settled,checkpoint:{...settled.checkpoint,executionUnknown:true}},
 {...settled,checkpoint:{...settled.checkpoint,rows:r0.map(r=>({...terminal(r),requestCount:null}))}},
 {...settled,checkpoint:{...settled.checkpoint,rows:r0.slice(1).map(terminal),cursor:r0.length-1}},
 {...settled,labelRole:'independent-review'}
])assert.throws(()=>assertCommonViewRoundTerminalsSettled([first],[altered]),/unsettled|unknown|unfinished/);
assert.throws(()=>assertCommonViewRoundTerminalsSettled([first],[]),/prior_selected_rows_unfinished/);
assert.equal(assertCommonViewRoundTerminalsSettled([first],[settled,{...settled,labelRole:'independent-review'}]),true);
console.log(JSON.stringify({status:'PASS',scope:'one finite dual-split multi-cell unused-round fixture',round0:4,round1:2,round2:1,denominator:7,limits:'Does not execute host/catalog/disk admission, source replay, world preparation, providers or learning.'}));

/** Disk fixture for the REAL admission reader. Task fields model its narrow
 * read contract, not a claim of full TC/engine execution or valid game data. */
export async function buildRoundFixture(directory){
 const fs=await import('node:fs'),path=await import('node:path'),crypto=await import('node:crypto');
 const {canonical,digest,referenceOf}=await import('../task-schema.mjs');
 const repo=fs.realpathSync(directory),controlRoot=path.join(repo,'lab/out/control');fs.mkdirSync(controlRoot,{recursive:true});
 const refs=new Map(),files=new Map(),put=(id,value)=>{const ref=referenceOf(id,value);refs.set(ref,structuredClone(value));return ref;};
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
 const write=(relative,bytes)=>{const full=path.join(repo,relative);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,bytes);return{path:relative,sha256:sha(bytes)};};
 const evidence=(id,value)=>{const file=write('fixture/'+id+'.json',JSON.stringify(value)+'\n');files.set(id,file);return{id,sha256:file.sha256};};
 const planRef=put('fixture-plan',{planVersion:1}),clauseRef=put('fixture-clause',{}),screenClause=put('fixture-screen-clause',{}),budgetRef=put('fixture-budget',{planRef,controlRoot}),authorizationRef=put('fixture-authorization',{});
 const labelCap=put('fixture-label-cap',{id:'B07.offline-label.v1',kind:'collect',mode:'research'}),sourceCap=put('fixture-source-cap',{id:'B07.complete-match.v1',kind:'collect',mode:'research'});
 const action=(clauseRef,purpose,ids)=>({clauseRef,branchRef:null,plannedTaskIds:ids,dependencyRefs:[],expectedArtifactKinds:[],acceptanceRuleRef:put('fixture-action-'+purpose,{purpose}),skipRuleRef:null,stopRuleRef:null});
 const protocolRef=put('fixture-protocol',{schema:'ohuo-first-round-protocol-revision-v2',protocolId:'first-round-common-view-r2',planRef,actions:[action(clauseRef,'data-glm',['primary-teacher-train','primary-teacher-dev']),action(screenClause,'data-screen',['screen-train','screen-dev'])]});
 const targetDefinitionRef=put('fixture-target',{}),actingReleaseRef=put('fixture-acting',{}),comparisonRef=put('fixture-comparison',{});
 const families=['train','dev'].map(split=>({familyId:'first-deal-family:'+sha(split),split})).sort((a,b)=>a.familyId.localeCompare(b.familyId));
 const indexFile=write('lab/out/source-index.json',JSON.stringify({version:1,families:Object.fromEntries(families.map(f=>[f.familyId,{split:f.split}]))}));
 const sourceIndexRef=put('fixture-source-index',{schema:'ohuo-source-index-ref-v1',namespace:'fixture-pool',fileSHA256:indexFile.sha256});
 const queueRef=put('fixture-queue',{schema:'ohuo-complete-match-queue-v1',namespace:'fixture-pool',sourceIndexRef,rows:[]});
 const state={schemaVersion:1,rootInstanceId:'fixture-root',tasks:{},runs:{},budgets:{[budgetRef]:{planRef,activeRunId:null,reservations:{}}}};
 const writeState=()=>write('lab/out/control/state.json',JSON.stringify(state));
 function addRun(id,taskExtra,cpExtra){
  const outputRoot=path.join(controlRoot,'runs',id),task={schemaVersion:1,taskId:id,runId:id,planRef,planVersion:1,budgetRef,authorizationRef,researchBatchId:'fixture-batch',capabilityRef:sourceCap,parentTaskId:null,retryReasonRef:null,allowedBranches:[],learnerRecipe:null,planScope:{clauseRef,branchRef:null},sourcePlan:{namespace:'fixture-pool',sourceIndexRef,split:'train',familyIds:families.map(f=>f.familyId)},seatLayoutPlan:queueRef,outputRoot,...taskExtra};
  const taskSHA256=digest(task),taskRef=put('fixture-task/'+id,task);write(path.relative(repo,path.join(outputRoot,'task.json')),canonical(task));
  const checkpoint={taskSHA256,executionUnknown:false,active:null,...cpExtra},checkpointSHA256=digest(checkpoint),checkpointRef=path.join(outputRoot,`checkpoint-${checkpointSHA256}.json`);write(path.relative(repo,checkpointRef),canonical(checkpoint));
  const run={runId:id,task,taskRef,taskSHA256,checkpoint,checkpointSHA256,checkpointRef,status:'completed',cleanupConfirmed:true,executionUnknown:false};state.tasks[id]=id;state.runs[id]=run;return run;
 }
 const source=addRun('source',{datasetRefs:[]},{schema:'ohuo-match-run-v1',matches:[],cursor:0,queueRef});
 const sourceRunRefs=[evidence('source-run',source)];
 const quota={schema:'ohuo-selection-source-batch-basis-r2',planRef,budgetRef,protocolRef,families};
 const quotaBasisRef=evidence('quota-basis',quota),baseRule={schema:'ohuo-offline-selection-common-view-r2',representativeRound:0,protocolRef,comparisonRef},baseSelectionRuleRef=put('fixture-rule-0',baseRule);
 const baseSpec={schema:'ohuo-offline-selection-spec-v1',planRef,clauseRef,branchRef:null,sourceIndexRef,queueRef,sourceRunRefs,targetDefinitionRef,selectionRuleRef:baseSelectionRuleRef,quotaBasisRef,purpose:'b_training_source',actingReleaseRef,outputId:'fixture-selection-0'};
 const population=[...train,...dev].map(r=>({...structuredClone(r),recordRef:'fixture-record',recordRoot:'lab/out/fixture-record',familyId:families.find(f=>f.split===r.split).familyId,blockFamilyId:families.find(f=>f.split===r.split).familyId,actorSeat:0,decisionId:r.split+'-'+r.key.decision,layoutId:'fixture-layout',sampleClass:'target',contextSHA256:sha(r.split+'-context-'+r.key.decision),eligibility:'eligible',exclusionReason:null}));
 for(const r of population)r.decisionSHA256=sha(r.decisionId);
 const order=rows=>[...rows].sort((a,b)=>Buffer.compare(Buffer.from(a.decisionSHA256),Buffer.from(b.decisionSHA256))||Buffer.compare(Buffer.from(a.decisionId),Buffer.from(b.decisionId)));
 const chosen=families.flatMap(f=>selectCommonViewRepresentatives(order(population.filter(r=>r.blockFamilyId===f.familyId)),0).selected);
 const selectionRows=chosen.map(({recordRef,recordRoot,key,inputSHA256,familyId,split,actorSeat,blockFamilyId})=>({recordRef,recordRoot,key,inputSHA256,familyId,split,actorSeat,blockFamilyId}));
 const metadata=chosen.map((r,rank)=>({blockFamilyId:r.blockFamilyId,decisionId:r.decisionId,key:r.key,inputSHA256:r.inputSHA256,sampleKind:'demo',sampleClass:'target',layoutId:r.layoutId,contextSHA256:r.contextSHA256,rank}));
 const output=baseSpec.outputId,specRef=put('offline-selection-spec/'+output,baseSpec),artifacts=[];
 function artifact(name,value,jsonl=false){const bytes=jsonl?value.map(v=>JSON.stringify(v)+'\n').join(''):JSON.stringify(value)+'\n',file=write(`lab/out/${output}/${name}`,bytes),id=`offline-selection/${output}/${name}`;files.set(id,file);artifacts.push({id,file});return{id,sha256:file.sha256};}
 artifact('spec.json',baseSpec);const sourceInventoryRef=artifact('source-inventory.jsonl',[],true),populationRef=artifact('population.jsonl',population,true),selectedMetadataRef=artifact('selected-metadata.jsonl',metadata,true),exclusionsRef=artifact('exclusions.jsonl',[],true);
 const production={schema:'ohuo-offline-selection-production-v1',specRef,sourceInventoryRef,populationRef,selectedMetadataRef,exclusionsRef,quotaBasisRef,selectionRuleRef:baseSelectionRuleRef,targetDefinitionRef,createdBeforeLabelEvidenceRef:evidence('freeze-proof',{}),counts:{},verification:'reproduced'},productionRef=put('offline-selection-production/'+output,production);artifact('production.json',production);
 const selection={schema:'ohuo-offline-label-selection-v2',sourceIndexRef,queueRef,purpose:'b_training_source',selectedCount:selectionRows.length,quotas:families.map(f=>({familyId:f.familyId,count:selectionRows.filter(r=>r.blockFamilyId===f.familyId).length})),rows:selectionRows,productionRef},selectionRef=put('offline-label-selection/'+output,selection);artifact('selection.json',selection);
 const manifest={schema:'ohuo-offline-selection-commit-v1',selectionRef,productionRef,specRef,files:structuredClone(artifacts)};artifact('manifest.json',manifest);
 const routingRef=put('fixture-routing',{schema:'ohuo-common-view-teacher-routing-r2',role:'primary',selected:[]}),decisionRuleRef=put('fixture-teacher-contract',{schema:'ohuo-common-view-teacher-contract-r2',routingRef});
 for(const split of ['train','dev']){
  const owned=selectionRows.filter(r=>r.split===split),id='teacher-'+split,rows=owned.map((r,index)=>{const terminal={schema:'ohuo-offline-label-result-v1',selectionRef,index,inputSHA256:r.inputSHA256,key:r.key,status:'invalid_response',labelKind:null},file=write(`lab/out/control/runs/${id}/labels/q${index}.json`,JSON.stringify(terminal));return{key:r.key,inputSHA256:r.inputSHA256,status:terminal.status,labelKind:null,requestCount:1,resultRef:{path:path.join(repo,file.path),sha256:file.sha256}};});
  addRun(id,{capabilityRef:labelCap,datasetRefs:[selectionRef],sourcePlan:{namespace:'fixture-pool',sourceIndexRef,split,familyIds:families.filter(f=>f.split===split).map(f=>f.familyId)},scientificContract:{analysisMethodRef:protocolRef,decisionRuleRef}},{schema:'ohuo-offline-label-run-v1',selectionRef,cursor:rows.length,rows});
 }
 const pool={schema:'ohuo-common-view-representative-pool-r2',planRef,budgetRef,sourceIndexRef,queueRef,sourceRunRefs,targetDefinitionRef,actingReleaseRef,protocolRef,comparisonRef,baseSelectionRuleRef,families},poolRef=put('fixture-pool',pool);
 const contract={schema:COMMON_VIEW_ROUND_CONTRACT_SCHEMA,protocolRef,poolRef,round:1,parentSelectionRef:selectionRef,continuationEvidenceRefs:[evidence('continuation',{unresolved:'synthetic coverage gap'})],plannedTasks:[['primary-teacher','train'],['primary-teacher','dev'],['screen','train'],['screen','dev']].map(([role,split])=>({role,split,taskId:role+'-'+split+'-round-1'}))};
 const roundContractRef=put('fixture-round-1',contract),spec={...baseSpec,schema:'ohuo-offline-selection-spec-common-view-round-r2',roundContractRef,selectionRuleRef:put('fixture-rule-1',{...baseRule,representativeRound:1}),outputId:'fixture-selection-1'};writeState();
 const trusted={repositoryRoot:repo,references:refs,evidenceFiles:files,sourceIndexPath:path.join(repo,indexFile.path),confirmedRecordRoots:[],controlRoot,mode:'research',phase:'freeze'};
 return{repo,spec,trusted,state,put,writeState,write,selectionRef,selection,baseSpec,contract,pool,poolRef,families,source,canonical,digest,referenceOf};
}

if(process.argv.includes('--native') || (process.argv.indexOf('--case') >= 0 && process.argv[process.argv.indexOf('--case') + 1] === 'training.common-view-later-representatives')){

 // Regression: exercise the actual CLI, not an imported helper. During this
 // M9 safe point the candidate source is not yet published to the host catalog,
 // so the first real H source-identity gate must reject before any selection.
 const {spawnSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const {resolve}=await import('node:path');
 const {readFileSync}=await import('node:fs');
 const {createHash}=await import('node:crypto');
 const repo=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
 const specPath='deliverables/ohuo-first-round-v530/references/v530-r2-representatives-round-1-spec.json';
 const specSHA='96cea6ab3383b6bbaa9e438e15585b3ae4cd2dd60d5c21a4ae30e5adb8b96df3';
 assert.equal(createHash('sha256').update(readFileSync(resolve(repo,specPath))).digest('hex'),specSHA);
 const cli=spawnSync(process.execPath,['--import','tsx','lab/review6_2/offline-selection.ts','--input',specPath,'--sha256',specSHA,'--output','lab/out/R11-r2-representatives-round-1'],{cwd:repo,encoding:'utf8',timeout:60000});
 assert.equal(cli.error,undefined,'CLI bootstrap smoke must terminate, not time out');
 assert.equal(cli.signal,null);assert.equal(cli.status,1,'real H must reject the not-yet-registered candidate source');
 assert.match(cli.stderr,/input_identity_unverified/);assert.match(cli.stderr,/producerSourceRevision/);
 assert.doesNotMatch(cli.stderr,/Detected unsettled top-level await/);assert.equal(cli.stdout.trim(),'');
 console.log(JSON.stringify({status:'PASS',scope:'actual CLI parsed pinned spec and entered real H; unpublished candidate rejected by producerSourceRevision',exitCode:cli.status,selectionExecuted:false}));

 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {verifyCommonViewRoundAdmission}=await import('../offline-selection.ts');
 const directory=mkdtempSync(join(tmpdir(),'ohuo-round-admission-'));
 try{
  const f=await buildRoundFixture(directory),proof=verifyCommonViewRoundAdmission(f.spec,f.trusted);
  assert.equal(proof.round,1);assert.equal(proof.usedRows.length,4);assert.deepEqual(proof.priorSelectionRefs,[f.selectionRef]);
  const manifestId=`offline-selection/${f.baseSpec.outputId}/manifest.json`,saved=f.trusted.evidenceFiles.get(manifestId);f.trusted.evidenceFiles.delete(manifestId);
  assert.throws(()=>verifyCommonViewRoundAdmission(f.spec,f.trusted),/manifest_omitted|predecessor_chain_missing/);f.trusted.evidenceFiles.set(manifestId,saved);
  const wrongPool={...f.pool,families:f.pool.families.map((r,i)=>i? r:{...r,split:r.split==='train'?'dev':'train'})},poolRef=f.put('wrong-pool',wrongPool),roundContractRef=f.put('wrong-round',{...f.contract,poolRef});
  assert.throws(()=>verifyCommonViewRoundAdmission({...f.spec,roundContractRef},f.trusted),/split_changed|source_identity/);
  f.state.runs['teacher-train'].executionUnknown=true;f.writeState();assert.throws(()=>verifyCommonViewRoundAdmission(f.spec,f.trusted),/unsettled/);f.state.runs['teacher-train'].executionUnknown=false;f.writeState();
  f.state.budgets[f.pool.budgetRef].reservations.pending={runId:'teacher-train',status:'reserved_unknown'};f.writeState();assert.throws(()=>verifyCommonViewRoundAdmission(f.spec,f.trusted),/unsettled/);delete f.state.budgets[f.pool.budgetRef].reservations.pending;f.writeState();
  const run=f.state.runs['teacher-train'],old=structuredClone(run);run.checkpoint.rows.pop();run.checkpoint.cursor--;run.checkpointSHA256=f.digest(run.checkpoint);run.checkpointRef=join(run.task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`);f.write(run.checkpointRef.slice(f.repo.length+1),f.canonical(run.checkpoint));f.writeState();assert.throws(()=>verifyCommonViewRoundAdmission(f.spec,f.trusted),/owned_rows_unfinished/);f.state.runs['teacher-train']=old;f.writeState();
  assert.equal(verifyCommonViewRoundAdmission(f.spec,f.trusted).usedRows.length,4);
  // Actual H constructor/catalog/reader and shared admission methods. The
  // synthetic Tasks exercise these method contracts, not a TC/provider run.
  const {FixedHostFiles}=await import('../ohuo-host-files.ts'),fs=await import('node:fs'),crypto=await import('node:crypto');
  f.put('offline-selection-spec/'+f.spec.outputId,f.spec);
  const initialStateRef=f.put('fixture-initial-state',{}),bindings=[{taskRef:f.source.taskRef,sourceIndexFile:{path:'lab/out/source-index.json',sha256:f.trusted.references.get(f.pool.sourceIndexRef).fileSHA256},confirmedRecordRoots:[],datasetDirectory:null,studentReleaseFiles:[],seed:0,trainingPhase:null,numericalRestartReceiptRef:null}];
  const referenceFiles=[...f.trusted.references].map(([ref,value],i)=>({ref,file:f.write('fixture/host-reference-'+i+'.json',f.canonical(value))}));
  const hostManifest={schema:'ohuo-fixed-host-v1',controlRoot:'lab/out/control',rootInstanceId:'fixture-root',initialStateRef,references:referenceFiles,evidenceFiles:[...f.trusted.evidenceFiles].map(([id,file])=>({id,file})),grantFile:{path:'fixture/unused-grant.json',sha256:'0'.repeat(64)},planCloseoutFile:'fixture/unused-closeout.json',inputBindings:bindings,profileStorePath:null,pythonPath:null};
  const hostPath=join(f.repo,'deliverables/ohuo-runtime/host.json');f.write('deliverables/ohuo-runtime/host.json',JSON.stringify(hostManifest));fs.chmodSync(hostPath,0o600);
  const marker='deliverables/ohuo-runtime/initializations/'+crypto.createHash('sha256').update(hostManifest.controlRoot).digest('hex')+'.json';f.write(marker,JSON.stringify({schema:'ohuo-control-root-genesis-v1',rootInstanceId:'fixture-root',controlRoot:hostManifest.controlRoot,initialStateRef}));fs.chmodSync(join(f.repo,marker),0o600);
  const h=new FixedHostFiles(f.repo),stateBefore=f.canonical(f.state),hProof=h.commonViewRoundProof(f.spec),protocol={ref:f.pool.protocolRef,value:h.resolveRef(f.pool.protocolRef)},actions=h.commonViewRoundActions(protocol);
  const done={status:'completed',unresolved:[]};
  assert.doesNotThrow(()=>h.assertOfflineSelectionFreezeAvailable(f.spec,f.state,done,false,null));
  assert.throws(()=>h.assertOfflineSelectionFreezeAvailable(f.baseSpec,f.state,done,false,null),e=>e.reason==='original_action_conflict');
  assert.throws(()=>h.assertOfflineSelectionFreezeAvailable(f.spec,f.state,{status:'unknown',unresolved:[]},false,null),e=>e.reason==='original_action_conflict');
  assert.throws(()=>h.assertOfflineSelectionFreezeAvailable(f.spec,f.state,done,true,null),e=>e.reason==='plan_closed');
  f.state.runs['teacher-train'].executionUnknown=true;
  assert.throws(()=>h.assertOfflineSelectionFreezeAvailable(f.spec,f.state,done,false,null));f.state.runs['teacher-train'].executionUnknown=false;
  assert.doesNotThrow(()=>h.assertOfflineSelectionFreezeAvailable(f.baseSpec,f.state,done,true,{actualCommittedFixture:true}));
  assert.deepEqual(hProof.priorSelectionRefs,[f.selectionRef]);assert.equal(actions.length,2);assert.deepEqual(actions[0].plannedTaskIds,['primary-teacher-train','primary-teacher-dev','primary-teacher-train-round-1','primary-teacher-dev-round-1']);assert.deepEqual(protocol.value.actions[0].plannedTaskIds,['primary-teacher-train','primary-teacher-dev']);
  const nextRows=proof.base.population.filter(r=>!proof.usedRows.some(u=>f.canonical(u.key)===f.canonical(r.key))).slice(0,1).map(({recordRef,recordRoot,key,inputSHA256,familyId,split,actorSeat,blockFamilyId})=>({recordRef,recordRoot,key,inputSHA256,familyId,split,actorSeat,blockFamilyId}));
  const nextSelection={...f.selection,rows:nextRows,selectedCount:nextRows.length},nextRef=f.referenceOf('fixture-next-selection',nextSelection),split=nextRows[0].split,baseTask=f.state.runs['teacher-'+split].task,task={...baseTask,taskId:'primary-teacher-'+split+'-round-1',runId:'primary-teacher-'+split+'-round-1',datasetRefs:[nextRef]},context=h.selectionAdmissionContext(task,nextSelection,f.spec,f.trusted.references);
  assert.equal(h.checkOfflineSelectionAdmission(task,f.state,context),true,'only proved settled predecessor selections may be passed');
  const priorRun=f.state.runs['teacher-train'];priorRun.checkpoint.executionUnknown=true;assert.throws(()=>h.checkOfflineSelectionAdmission(task,f.state,context),e=>e.reason==='selection_execution_uncertain');priorRun.checkpoint.executionUnknown=false;
  priorRun.checkpoint.active={phase:'provider'};assert.throws(()=>h.checkOfflineSelectionAdmission(task,f.state,context),e=>e.reason==='selection_execution_uncertain');priorRun.checkpoint.active=null;
  f.state.budgets[f.pool.budgetRef].reservations.race={runId:priorRun.runId,status:'reserved'};assert.throws(()=>h.checkOfflineSelectionAdmission(task,f.state,context),e=>e.reason==='selection_execution_uncertain');delete f.state.budgets[f.pool.budgetRef].reservations.race;
  assert.equal(h.checkOfflineSelectionAdmission(task,f.state,context),true);

  const noProof=h.selectionAdmissionContext(task,nextSelection,f.baseSpec,f.trusted.references);assert.throws(()=>h.checkOfflineSelectionAdmission(task,f.state,noProof),e=>e.reason==='selection_changed_after_label_exposure');
  assert.throws(()=>h.checkOfflineSelectionAdmission({...task,taskId:'unplanned-round'},f.state,context),e=>e.reason==='original_action_conflict');
  const overlap={...context,selection:{...nextSelection,rows:[proof.usedRows[0]]}};assert.throws(()=>h.assertCommonViewRoundTask(task,overlap,f.state),e=>e.reason==='selection_owned_rows_already_exposed');
  const parent={runId:task.runId,task,taskRef:f.referenceOf('fixture-round-parent',task),taskSHA256:f.digest(task),status:'failed',cleanupConfirmed:true},retryState=structuredClone(f.state);retryState.tasks[task.taskId]=task.runId;retryState.runs[task.runId]=parent;
  const retry={...task,taskId:task.taskId+'-retry-1',runId:task.runId+'-retry-1',parentTaskId:task.taskId,retryReasonRef:actions[0].acceptanceRuleRef};h.assertCommonViewRoundTask(retry,context,retryState);parent.status='completed';assert.throws(()=>h.assertCommonViewRoundTask(retry,context,retryState),e=>e.reason==='original_action_conflict');
  f.state.runs['teacher-train'].executionUnknown=true;f.writeState();assert.throws(()=>h.commonViewRoundActions(protocol),/unsettled/);f.state.runs['teacher-train'].executionUnknown=false;f.writeState();assert.equal(f.canonical(f.state),stateBefore,'all actual fixture state bytes and history remain unchanged');
  console.log(JSON.stringify({status:'PASS',scope:'actual H constructor, immutable catalog, same reader, effective planned roles and original admission/failed-parent lineage methods',legacyExposureStillRejected:true,noProviderOrTCExecution:true}));
  console.log(JSON.stringify({status:'PASS',scope:'actual exported admission reader + actual synthetic catalog/manifest/Task/CP/terminal disk bytes',missingManifest:true,forgedSplit:true,unknown:true,activeReservation:true,unfinishedOwnedRows:true,notRun:'TC grants, game engine, providers, worlds, learning'}));
 }finally{rmSync(directory,{recursive:true,force:true});}
}
