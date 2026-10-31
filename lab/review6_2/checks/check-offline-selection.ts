/** §36D focused software boundaries only. No network, model forward or training. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const args=process.argv.slice(2);assert.deepEqual(args,['--case','selection-boundaries']);
globalThis.fetch=async()=>{throw Error('real_network_forbidden');};
assert.ok(existsSync(new URL('../offline-selection.ts',import.meta.url)),'§36D fixed producer/verifier implementation required');
const api=await import('../offline-selection');
assert.equal(typeof api.prepareOfflineSelection,'function');
assert.equal(typeof api.verifyOfflineSelection,'function');
assert.throws(()=>api.prepareOfflineSelection({schema:'untrusted',rows:[]} as any,{} as any),/selection_spec|schema|unknown_field/);
console.log(JSON.stringify({caseId:'selection-boundaries',phase:'strict-schema',status:'passed',realNetwork:0,modelForwards:0,parameterUpdates:0}));
const {fixture}=await import('./selection-fixture');
const f=fixture(false,true),first=api.prepareOfflineSelection(f.spec,f.trusted);f.register(first);
const verified=api.verifyOfflineSelection(first.selection,{...f.trusted,phase:'dataset'});
assert.equal(verified.population.length,36,'enumerates all confirmed evaluated-seat decisions, not caller-picked rows');
assert.equal(first.production.counts.enumerated,36);
assert.equal(first.production.verification,'incomplete','one-step fixture is never represented as a completed match');
assert.equal(verified.sourceInventory.length,36);assert.ok(verified.exclusions.some(e=>e.reason==='planned_source_task_definition_missing:not-yet-defined-source'),'whole source action with no existing run or Task definition cannot silently disappear');
assert.ok(verified.sourceInventory.every(r=>r.status==='incomplete'));
const meta=verified.selectedMetadata,demo=meta.filter(m=>m.sampleKind==='demo'),keep=meta.filter(m=>m.sampleKind==='keep');
assert.equal(first.selection.rows.length,demo.length);
assert.ok(keep.every(m=>m.sampleClass==='ordinary'&&!demo.some(d=>d.decisionId===m.decisionId||d.contextSHA256===m.contextSHA256)));
const againSpec={...f.spec,outputId:f.outputId('selection-two'),sourceRunRefs:[...f.spec.sourceRunRefs].reverse()};
const again=api.prepareOfflineSelection(againSpec,{...f.trusted,references:new Map([...f.refs].reverse()),outputDir:f.output('selection-two')});f.register(again);
assert.deepEqual(again.selection.rows,first.selection.rows,'source-run and reference insertion order do not alter selected ID/order');
assert.deepEqual(api.verifyOfflineSelection(again.selection,{...f.trusted,phase:'dataset'}).selectedMetadata,meta);
assert.deepEqual(api.prepareOfflineSelection(f.spec,{...f.trusted,mode:'research',confirmedRecordRoots:[]}),first,'committed same-spec path is read-only and does not enumerate or classify again');
assert.throws(()=>api.prepareOfflineSelection({...f.spec,sourceRunRefs:[]},f.trusted),/commit_identity/);
assert.throws(()=>api.verifyOfflineSelection({...first.selection,rows:first.selection.rows.slice(1)},{...f.trusted,phase:'dataset'}),/commit_identity|reproduction/);
assert.throws(()=>api.prepareOfflineSelection({...f.spec,outputId:f.outputId('research-target')},{...f.trusted,mode:'research',outputDir:f.output('research-target')}),/target_definition_unimplemented/);
const omitted=api.prepareOfflineSelection({...f.spec,outputId:f.outputId('missing-source'),sourceRunRefs:f.spec.sourceRunRefs.slice(1)},{...f.trusted,outputDir:f.output('missing-source')});f.register(omitted);
const missing=api.verifyOfflineSelection(omitted.selection,{...f.trusted,phase:'dataset'});
assert.equal(missing.production.verification,'incomplete');assert.ok(missing.sourceInventory.some(r=>r.status==='missing'));
console.log(JSON.stringify({caseId:'selection-boundaries',phase:'full-finite-population',status:'passed',enumerated:36,selected:demo.length,keep:keep.length,sourceMatches:'36 explicitly incomplete one-step synthetic captures',reorderedSourceRefsSameIDs:true,missingSource:'incomplete',wholeMissingSourceAction:'named incomplete',realTarget:'target_definition_unimplemented',realNetwork:0,modelForwards:0,completeMatchesRun:0,parameterUpdates:0}));
// Independently compute the published per-family target/ordinary ordering.
const {byteSHA}=await import('./selection-fixture');
const compare=(a:any,b:any)=>Buffer.compare(Buffer.from(byteSHA(a.decisionId)),Buffer.from(byteSHA(b.decisionId)))||Buffer.compare(Buffer.from(a.decisionId),Buffer.from(b.decisionId));
function roundRobin(pool:any[]){const groups=[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]].map(([g,s])=>pool.filter(p=>f.queue.rows.find(q=>q.matchId===p.key.matchId)!.group===g&&f.queue.rows.find(q=>q.matchId===p.key.matchId)!.side===s).sort(compare));const list:any[]=[];for(let i=0;groups.some(g=>g.length>i);i++)for(const g of groups)if(g[i])list.push(g[i]);return list;}
for(const family of ['dev0','train0']){const pool=verified.population.filter(p=>p.familyId===family&&p.eligibility==='eligible'),target=roundRobin(pool.filter(p=>p.sampleClass==='target')).slice(0,2),ordinary=roundRobin(pool.filter(p=>p.sampleClass==='ordinary')).slice(0,4-target.length);assert.deepEqual(demo.filter(m=>verified.population.find(p=>p.decisionId===m.decisionId)!.familyId===family).map(m=>m.decisionId),[...target,...ordinary].map(p=>p.decisionId));}
const altered=structuredClone(first.production);altered.counts.selected++;f.refs.set(first.productionRef,altered);assert.throws(()=>api.verifyOfflineSelection(first.selection,{...f.trusted,phase:'dataset'}),/reference_identity/);f.refs.set(first.productionRef,first.production);
const originalRef=[...f.refs].find(([,v])=>v?.taskId==='source-train')![0],originalTask=f.refs.get(originalRef);f.refs.delete(originalRef);assert.throws(()=>api.verifyOfflineSelection(first.selection,{...f.trusted,phase:'dataset'}),/non_source_run|source_task|reference/);f.refs.set(originalRef,originalTask);
const {mkdirSync,writeFileSync}=await import('node:fs');const {join}=await import('node:path');
const partialSpec={...f.spec,outputId:f.outputId('partial-freeze')},partialDir=f.output('partial-freeze');mkdirSync(partialDir);writeFileSync(join(partialDir,'spec.json'),JSON.stringify(partialSpec)+'\n',{mode:0o600});
const recovered=api.prepareOfflineSelection(partialSpec,{...f.trusted,outputDir:partialDir});f.register(recovered);assert.deepEqual(recovered.selection.rows,first.selection.rows);
console.log(JSON.stringify({caseId:'selection-boundaries',phase:'ordering-binding-and-partial-freeze',status:'passed',fixedHashAndLayoutOrder:true,changedProductionRejected:true,missingOriginalTaskRejected:true,sameInputPartialFreezeRecovered:true}));
// Unknown or insufficient original budget is never silently reset to zero or
// converted into a smaller opportunistic sample after seeing labels.
const {readFileSync}=await import('node:fs');
const quota=JSON.parse(readFileSync(join(f.trusted.repositoryRoot,f.files.get(f.spec.quotaBasisRef.id)!.path),'utf8'));
for(const [name,unknown] of [['unknown-budget',true],['insufficient-budget',false]] as const){const state=structuredClone(f.state),ledger:any=state.budgets[quota.budgetRef];if(unknown)ledger.reservations.unknown={runId:'old',status:'reserved_unknown',cost:{providerRequests:1,labelDecisions:1}};else ledger.used.providerRequests=63;writeFileSync(join(f.trusted.controlRoot,'state.json'),JSON.stringify(state));const stateRef=f.file(name+'-state.json',state),freezeRef=f.file(name+'-freeze.json',{schema:'ohuo-selection-prequery-v1',planRef:f.spec.planRef,clauseRef:f.spec.clauseRef,branchRef:null,budgetRef:quota.budgetRef,controlRoot:f.trusted.controlRoot,controlStateRef:stateRef}),basis=f.file(name+'-quota.json',{...quota,controlStateRef:stateRef,freezeEvidenceRef:freezeRef});assert.throws(()=>api.prepareOfflineSelection({...f.spec,outputId:f.outputId(name),quotaBasisRef:basis},{...f.trusted,outputDir:f.output(name)}),unknown?/remaining_unknown/:/cannot_cover_frozen_quotas/);}
writeFileSync(join(f.trusted.controlRoot,'state.json'),JSON.stringify(f.state));
const smaller=f.file('unsupported-reduction.json',{...quota,frozenQuotas:quota.frozenQuotas.map((q:any)=>({...q,count:q.count-1}))});assert.throws(()=>api.prepareOfflineSelection({...f.spec,outputId:f.outputId('unsupported-reduction'),quotaBasisRef:smaller},{...f.trusted,outputDir:f.output('unsupported-reduction')}),/quota_reduction_unimplemented/);
console.log(JSON.stringify({caseId:'selection-boundaries',phase:'budget-fail-closed',status:'passed',unknownBudgetRejected:true,insufficientOriginalBudgetRejected:true,unspecifiedReductionAlgorithm:'unimplemented'}));
const unsettled=structuredClone(f.state);unsettled.runs['source-train'].status='running';unsettled.runs['source-train'].cleanupConfirmed=false;unsettled.runs['source-train'].owner={token:'synthetic-active'};writeFileSync(join(f.trusted.controlRoot,'state.json'),JSON.stringify(unsettled));
const unsettledStateRef=f.file('unsettled-state.json',unsettled),unsettledEvidence=f.file('unsettled-freeze.json',{schema:'ohuo-selection-prequery-v1',planRef:f.spec.planRef,clauseRef:f.spec.clauseRef,branchRef:null,budgetRef:quota.budgetRef,controlRoot:f.trusted.controlRoot,controlStateRef:unsettledStateRef}),unsettledQuota=f.file('unsettled-quota.json',{...quota,controlStateRef:unsettledStateRef,freezeEvidenceRef:unsettledEvidence}),unsettledRun=f.file('unsettled-source-run.json',unsettled.runs['source-train']);
const safeRoots=f.trusted.confirmedRecordRoots.filter(p=>p!==unsettled.runs['source-train'].task.outputRoot),unsettledSpec={...f.spec,outputId:f.outputId('unsettled-source'),quotaBasisRef:unsettledQuota,sourceRunRefs:[unsettledRun,f.spec.sourceRunRefs[1]]};
const inventoryOnly=api.prepareOfflineSelection(unsettledSpec,{...f.trusted,confirmedRecordRoots:safeRoots,outputDir:f.output('unsettled-source')});f.register(inventoryOnly);const checked=api.verifyOfflineSelection(inventoryOnly.selection,{...f.trusted,confirmedRecordRoots:safeRoots,phase:'dataset'});assert.equal(checked.sourceInventory.filter(r=>r.status==='unknown').length,18);assert.equal(checked.population.length,18);assert.equal(checked.production.verification,'incomplete');writeFileSync(join(f.trusted.controlRoot,'state.json'),JSON.stringify(f.state));
console.log(JSON.stringify({caseId:'selection-boundaries',phase:'unsettled-source-reader-gate',status:'passed',unknownInventoryRows:18,unsettledRootNotReadableByTrustedInputs:true,privateSourceReadForUnsettledRun:false}));

const escapedSpec={...f.spec,outputId:f.outputId('nested-output')};assert.throws(()=>api.prepareOfflineSelection(escapedSpec,{...f.trusted,outputDir:join(f.root,escapedSpec.outputId)}),/selection_output_not_task_directory/);assert.ok(!existsSync(join(f.root,escapedSpec.outputId)));console.log(JSON.stringify({caseId:'selection-boundaries',phase:'exact-nonrunner-output-root',status:'passed',nestedOutputRejected:true}));

// Closed/nonrunner recovery uses only exact original commit bytes, never sources.
const {unlinkSync}=await import('node:fs');const missingNames=['population.jsonl','selected-metadata.jsonl'],saved=missingNames.map(name=>{const id=`offline-selection/${f.spec.outputId}/${name}`,entry=f.files.get(id)!,path=join(f.trusted.repositoryRoot,entry.path),bytes=readFileSync(path);unlinkSync(path);return {name,id,entry,path,bytes};});
const originalPopulationCopy=join(f.root,'original-population-copy.jsonl');writeFileSync(originalPopulationCopy,saved[0].bytes);f.files.set(saved[0].id,{path:originalPopulationCopy.slice(f.trusted.repositoryRoot.length+1),sha256:saved[0].entry.sha256});
assert.throws(()=>api.prepareOfflineSelection(f.spec,{...f.trusted,mode:'research',confirmedRecordRoots:[]}),/ENOENT|fixed_catalog/);assert.ok(!existsSync(saved[0].path),'missing required original bytes cannot partially restore or trigger new selection');
const originalMetadataCopy=join(f.root,'original-metadata-copy.jsonl');writeFileSync(originalMetadataCopy,saved[1].bytes);f.files.set(saved[1].id,{path:originalMetadataCopy.slice(f.trusted.repositoryRoot.length+1),sha256:saved[1].entry.sha256});
const restored=api.prepareOfflineSelection(f.spec,{...f.trusted,mode:'research',confirmedRecordRoots:[]});f.register(restored);assert.deepEqual(restored,first);for(const v of saved)assert.deepEqual(readFileSync(v.path),v.bytes);
console.log(JSON.stringify({caseId:'selection-boundaries',phase:'same-commit-read-only-recovery',status:'passed',changedSpecRejected:true,missingOriginalBytesPending:true,exactCatalogBytesRestored:true,sourceReenumeration:false}));

// A convenient status response cannot omit an unknown fact in the actual
// original native state and thereby make the private record root readable.
const nativeUnknown=structuredClone(f.state);nativeUnknown.runs['source-train'].stopReason='execution_uncertain';writeFileSync(join(f.trusted.controlRoot,'state.json'),JSON.stringify(nativeUnknown));const nativeStateRef=f.file('native-unknown-state.json',nativeUnknown),nativeFreeze=f.file('native-unknown-freeze.json',{schema:'ohuo-selection-prequery-v1',planRef:f.spec.planRef,clauseRef:f.spec.clauseRef,branchRef:null,budgetRef:quota.budgetRef,controlRoot:f.trusted.controlRoot,controlStateRef:nativeStateRef}),nativeBasis=f.file('native-unknown-quota.json',{...quota,controlStateRef:nativeStateRef,freezeEvidenceRef:nativeFreeze});const omittedUnknown=structuredClone(nativeUnknown.runs['source-train']);delete omittedUnknown.stopReason;const omittedUnknownRef=f.file('native-unknown-status-omitted.json',omittedUnknown);const nativeGuard=api.prepareOfflineSelection({...f.spec,outputId:f.outputId('native-unknown'),quotaBasisRef:nativeBasis,sourceRunRefs:[omittedUnknownRef,f.spec.sourceRunRefs[1]]},{...f.trusted,confirmedRecordRoots:safeRoots,outputDir:f.output('native-unknown')});assert.equal(nativeGuard.production.counts.enumerated,18);assert.equal(nativeGuard.production.verification,'incomplete');writeFileSync(join(f.trusted.controlRoot,'state.json'),JSON.stringify(f.state));console.log(JSON.stringify({caseId:'selection-boundaries',phase:'native-unknown-cannot-be-omitted',status:'passed',unknownSourceRootNotRead:true}));
