/** R-D01 only: full commit bytes before consumer source reads; no label query. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,unlinkSync,renameSync,symlinkSync,lstatSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fixture,byteSHA} from './selection-fixture';
import {prepareOfflineSelection,verifyOfflineSelection} from '../offline-selection';
import {digest} from '../task-schema.mjs';
assert.deepEqual(process.argv.slice(2),['--case','selection-commit']);globalThis.fetch=async()=>{throw Error('real_network_forbidden');};
const f=fixture(true),prepared=prepareOfflineSelection(f.spec,f.trusted);f.register(prepared);
const t={...f.trusted,phase:'dataset' as const},positive=verifyOfflineSelection(prepared.selection,t);assert.equal(positive.production.verification,'reproduced');
const directory=f.output('selection-one'),manifestPath=join(directory,'manifest.json'),saved=new Map(prepared.files.map(e=>[e.id,{entry:e,bytes:readFileSync(join(t.repositoryRoot,e.file.path))}])),manifestOriginal=JSON.parse(readFileSync(manifestPath,'utf8'));
const reset=()=>{for(const {entry,bytes} of saved.values()){writeFileSync(join(t.repositoryRoot,entry.file.path),bytes);f.files.set(entry.id,entry.file);}};
const bindManifest=(value:any)=>{const bytes=JSON.stringify(value)+'\n';writeFileSync(manifestPath,bytes);f.files.set(prepared.manifestRef.id,{path:prepared.manifestFile.path,sha256:byteSHA(bytes)});};
console.log(JSON.stringify({caseId:'selection-commit',phase:'complete-original-proof',status:'passed',sourceInventory:12,demo:8,keep:8,fixtureRoot:f.root}));
// Exact non-author counterexample: a rehashed empty manifest cannot promise
// absent spec/production/selection bytes, even if all catalog R objects remain.
const empty=structuredClone(manifestOriginal);empty.files=[];bindManifest(empty);for(const name of ['spec.json','production.json','selection.json'])unlinkSync(join(directory,name));
assert.throws(()=>verifyOfflineSelection(prepared.selection,t),/selection_commit/,'R-D01: empty manifest cannot reproduce absent commit objects');
reset();
for(const name of ['short','extra','duplicate','wrong-path','wrong-hash','object-mismatch']){
 const m=structuredClone(manifestOriginal);
 if(name==='short')m.files.pop();
 if(name==='extra')m.files.push(structuredClone(m.files[0]));
 if(name==='duplicate')m.files[1]=structuredClone(m.files[0]);
 if(name==='wrong-path')m.files[0].file.path='lab/out/other/spec.json';
 if(name==='wrong-hash')m.files[0].file.sha256='0'.repeat(64);
 if(name==='object-mismatch'){const entry=m.files.find((e:any)=>e.id.endsWith('/selection.json')),value={...prepared.selection,selectedCount:prepared.selection.selectedCount+1},bytes=JSON.stringify(value)+'\n';writeFileSync(join(directory,'selection.json'),bytes);entry.file.sha256=byteSHA(bytes);f.files.set(entry.id,entry.file);}
 bindManifest(m);assert.throws(()=>verifyOfflineSelection(prepared.selection,{...t,mode:'research',confirmedRecordRoots:[]}),/selection_commit/,'must reject '+name+' before target classifier or private reader');reset();
}
// Consumers never restore: a correct original catalog copy is producer-only.
const missing=saved.get(`offline-selection/${f.spec.outputId}/production.json`)!;const archive=join(f.root,'original-production.json');writeFileSync(archive,missing.bytes);unlinkSync(join(directory,'production.json'));f.files.set(missing.entry.id,{path:relative(t.repositoryRoot,archive),sha256:missing.entry.file.sha256});
assert.throws(()=>verifyOfflineSelection(prepared.selection,t),/selection_commit/);assert.equal(existsSync(join(directory,'production.json')),false);
const recovered=prepareOfflineSelection(f.spec,{...f.trusted,mode:'research',confirmedRecordRoots:[]});assert.deepEqual(recovered,prepared);assert.deepEqual(readFileSync(join(directory,'production.json')),missing.bytes);f.register(recovered);
assert.equal(verifyOfflineSelection(prepared.selection,t).production.verification,'reproduced');
console.log(JSON.stringify({caseId:'selection-commit',phase:'manifest-negative-and-original-byte-recovery',status:'passed',negativeCases:8,consumerNeverRestores:true,producerSameCommitRestores:true,privateReenumerationForRecovery:false,realNetwork:0,modelForwards:0,parameterUpdates:0}));
// Entire queue metadata is rejected before any source record-root lookup.
const originalRefs=new Map(f.refs);const badQueue=structuredClone(f.queue);badQueue.rows.at(-1)!.seats.pop();const badQueueRef=f.ref('bad-tail-queue',badQueue),state=structuredClone(f.state),runRefs:any[]=[];
for(const run of Object.values(state.runs) as any[]){f.refs.delete(run.taskRef);run.task.seatLayoutPlan=badQueueRef;run.taskRef=f.ref(run.runId+'-bad-tail-task',run.task);run.taskSHA256=digest(run.task);run.checkpoint.taskSHA256=run.taskSHA256;run.checkpoint.queueRef=badQueueRef;run.checkpointSHA256=digest(run.checkpoint);run.checkpointRef=join(run.task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`);runRefs.push(f.file(run.runId+'-bad-tail.json',run));}
const quota=JSON.parse(readFileSync(join(t.repositoryRoot,f.files.get(f.spec.quotaBasisRef.id)!.path),'utf8')),stateRef=f.file('bad-tail-state.json',state),freezeRef=f.file('bad-tail-freeze.json',{schema:'ohuo-selection-prequery-v1',planRef:f.spec.planRef,clauseRef:f.spec.clauseRef,branchRef:null,budgetRef:quota.budgetRef,controlRoot:t.controlRoot,controlStateRef:stateRef}),basisRef=f.file('bad-tail-quota.json',{...quota,controlStateRef:stateRef,freezeEvidenceRef:freezeRef});writeFileSync(join(t.controlRoot,'state.json'),JSON.stringify(state));
assert.throws(()=>prepareOfflineSelection({...f.spec,queueRef:badQueueRef,sourceRunRefs:runRefs,quotaBasisRef:basisRef,outputId:f.outputId('bad-tail')},{...f.trusted,confirmedRecordRoots:[],outputDir:f.output('bad-tail')}),/selection_queue_metadata|selection_queue_seat/);writeFileSync(join(t.controlRoot,'state.json'),JSON.stringify(f.state));f.refs.clear();for(const [r,v] of originalRefs)f.refs.set(r,v);
console.log(JSON.stringify({caseId:'selection-commit',phase:'all-queue-preflight-before-record-root',status:'passed',sourceRecordRootsReadable:0}));

// R-D02: a vanished fixed source root stays missing/incomplete, not permission
// to inspect any replacement root. Existing symlink ancestors still reject.
const absentRoot=f.state.runs['source-train'].task.outputRoot,parkedRoot=absentRoot+'-parked';renameSync(absentRoot,parkedRoot);
try{for(const declared of [false,true]){const name=declared?'missing-declared':'missing-omitted',roots=declared?f.trusted.confirmedRecordRoots:f.trusted.confirmedRecordRoots.filter(r=>r!==absentRoot),missingResult=prepareOfflineSelection({...f.spec,outputId:f.outputId(name)},{...f.trusted,confirmedRecordRoots:roots,outputDir:f.output(name)});f.register(missingResult);const v=verifyOfflineSelection(missingResult.selection,{...t,confirmedRecordRoots:roots,outputDir:f.output(name)});assert.equal(v.production.verification,'incomplete');assert.equal(v.sourceInventory.filter(r=>r.reason==='source_record_root_missing').length,6);assert.ok(v.population.every(p=>p.recordRoot!==absentRoot));}
 symlinkSync(join(f.root,'absent-symlink-target'),absentRoot,'dir');assert.throws(()=>prepareOfflineSelection({...f.spec,outputId:f.outputId('symlink-missing')},{...f.trusted,confirmedRecordRoots:f.trusted.confirmedRecordRoots,outputDir:f.output('symlink-missing')}),/selection_trusted_root/);unlinkSync(absentRoot);
}finally{try{if(lstatSync(absentRoot).isSymbolicLink())unlinkSync(absentRoot);else throw Error('unexpected missing-root replacement before restore');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}renameSync(parkedRoot,absentRoot);}
console.log(JSON.stringify({caseId:'selection-commit',phase:'missing-root-inventory',status:'passed',missingInventoryPerCase:6,declaredAndOmittedRoot:true,missingRootPopulationRows:0,danglingSymlinkRejected:true}));

// Queue-v1.2 reverse scope: later-round families cannot exceed the owning Task.
const sourceBytes=readFileSync(f.trusted.sourceIndexPath),scopeRefs=new Map(f.refs),scopeIndex=JSON.parse(sourceBytes.toString());scopeIndex.families.trainExtra={split:'train'};const scopeIndexBytes=JSON.stringify(scopeIndex);writeFileSync(f.trusted.sourceIndexPath,scopeIndexBytes);
try{const scopeIndexRef=f.ref('scope-index',{schema:'ohuo-source-index-ref-v1',namespace:'synthetic-selection',fileSHA256:byteSHA(scopeIndexBytes)}),scopeQueue=structuredClone(f.queue);scopeQueue.sourceIndexRef=scopeIndexRef;scopeQueue.rows[0].maxGames=2;scopeQueue.rows[0].roundFamilyIds=['train0','trainExtra'];const scopeQueueRef=f.ref('scope-queue',scopeQueue),scopeState=structuredClone(f.state),scopeRuns:any[]=[];
 for(const run of Object.values(scopeState.runs) as any[]){f.refs.delete(run.taskRef);run.task.sourcePlan.sourceIndexRef=scopeIndexRef;run.task.seatLayoutPlan=scopeQueueRef;run.taskRef=f.ref(run.runId+'-scope-task',run.task);run.taskSHA256=digest(run.task);run.checkpoint.taskSHA256=run.taskSHA256;run.checkpoint.queueRef=scopeQueueRef;run.checkpointSHA256=digest(run.checkpoint);run.checkpointRef=join(run.task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`);scopeRuns.push(f.file(run.runId+'-scope.json',run));}
 const scopeStateRef=f.file('scope-state.json',scopeState),scopeFreeze=f.file('scope-freeze.json',{schema:'ohuo-selection-prequery-v1',planRef:f.spec.planRef,clauseRef:f.spec.clauseRef,branchRef:null,budgetRef:quota.budgetRef,controlRoot:t.controlRoot,controlStateRef:scopeStateRef}),scopeQuotas=[...quota.originalQuotas,{familyId:'trainExtra',split:'train',count:0}],scopeBasis=f.file('scope-basis.json',{...quota,controlStateRef:scopeStateRef,freezeEvidenceRef:scopeFreeze,originalQuotas:scopeQuotas,frozenQuotas:scopeQuotas});writeFileSync(join(t.controlRoot,'state.json'),JSON.stringify(scopeState));
 assert.throws(()=>prepareOfflineSelection({...f.spec,sourceIndexRef:scopeIndexRef,queueRef:scopeQueueRef,sourceRunRefs:scopeRuns,quotaBasisRef:scopeBasis,outputId:f.outputId('scope-round')},{...f.trusted,confirmedRecordRoots:[],outputDir:f.output('scope-round')}),/selection_source_task_ancestry/);
}finally{writeFileSync(f.trusted.sourceIndexPath,sourceBytes);writeFileSync(join(t.controlRoot,'state.json'),JSON.stringify(f.state));f.refs.clear();for(const [r,v] of scopeRefs)f.refs.set(r,v);}
console.log(JSON.stringify({caseId:'selection-commit',phase:'later-round-task-scope',status:'passed',sourceRecordRootsReadable:0}));
