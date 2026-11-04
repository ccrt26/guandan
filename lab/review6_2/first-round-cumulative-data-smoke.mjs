import assert from 'node:assert/strict';
import {cumulativeKeepCandidates,assertCumulativeGrowth,validateCumulativeSampling} from './first-round-cumulative-data.mjs';
const ref=n=>`${n}@sha256:${'a'.repeat(64)}`;
const s={schema:'ohuo-first-round-cumulative-sampling-r2',protocolRef:ref('protocol'),poolRef:ref('pool'),selectionRefs:[ref('s0'),ref('s1')],productionRefs:[ref('p0'),ref('p1')],previousDatasetRef:ref('d0'),keepRule:'same-split-frozen-layout-hash-prefix-equal-cumulative-valid-demo'};
assert.equal(validateCumulativeSampling(s,ref('protocol')),s);
assert.throws(()=>validateCumulativeSampling({...s,selectionRefs:[ref('s0'),ref('s0')]},ref('protocol')));
const layouts=[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]],queue={rows:layouts.flatMap(([group,side],i)=>['train','dev'].map(split=>({matchId:`${split}-${i}`,group,side})))};
const population=['train','dev'].flatMap(split=>Array.from({length:12},(_,i)=>({decisionId:`${split}-keep-${i}`,key:{matchId:`${split}-${i%6}`,moveNo:i},split,sampleClass:'ordinary',eligibility:'eligible',contextSHA256:`${split}-kctx-${i}`,inputSHA256:`${split}-in-${i}`})));
const demos=['train','dev'].flatMap(split=>Array.from({length:6},(_,i)=>({decisionId:`${split}-demo-${i}`,split,contextSHA256:`${split}-dctx-${i}`})));
const keeps=cumulativeKeepCandidates(population,demos,queue,layouts);
assert.equal(keeps.filter(x=>x.split==='train').length,6);assert.equal(keeps.filter(x=>x.split==='dev').length,6);assert.equal(keeps.length,12);assert.equal(new Set(keeps.map(x=>x.decisionId)).size,12);
assert.deepEqual(keeps.filter(x=>x.split==='train').map(x=>x.key.matchId),layouts.map((_,i)=>`train-${i}`));
assert.throws(()=>cumulativeKeepCandidates([...population,population[0]],demos,queue,layouts),/duplicate/);
const old={sampleKind:'demo',decisionId:'old',contextSHA256:'old-context',provenance:{inputSHA256:'old-input'}},fresh={sampleKind:'demo',decisionId:'new',contextSHA256:'new-context',provenance:{inputSHA256:'new-input'}};
assert.deepEqual(assertCumulativeGrowth([old],[old,fresh]).newDemoIds,['new']);
assert.equal(assertCumulativeGrowth([old],[old,{...fresh,sampleKind:'keep'}]).hasNewValidDemo,false);
assert.throws(()=>assertCumulativeGrowth([old],[{...old,provenance:{inputSHA256:'changed'}}]),/previous_demo_identity_changed/);
console.log('PASS cumulative fixed-pool keep extension and genuine new-demo seam; no models/API/matches');

// Execute the actual cumulative B09 glue with synthetic already-verified round
// boundaries. Underlying ledger/screen verifiers are unchanged and reviewed
// separately; this is not a substitute real-data admission or model run.
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=x=>createHash('sha256').update(stable(x)).digest('hex');
const text=readFileSync(new URL('./distill-data.ts',import.meta.url),'utf8');
const glue=stripTypeScriptTypes(text.slice(text.indexOf('function cumulativeSelectedRows('),text.indexOf('function originalLabelTerminalIndex(')),{mode:'transform'});
const cumulative={...s,previousDatasetRef:null};
const plan={datasetId:'new-dataset',researchProtocol:{id:'first-round-common-view-r2',revisionRef:s.protocolRef},cumulativeSampling:cumulative,samplingRef:`cumulative@sha256:${digest(cumulative)}`,sourceIndexRef:'index',sourceIndexSHA256:'index-hash',queueRef:'queue',queueSHA256:'queue-hash',families:[],games:[],identities:{teacher:{releaseRef:'GLM'}}};
const references=new Map([['queue',queue]]),proofs=[];let checked=0,verified=0;
for(let r=0;r<2;r++){
 const populationWithDemos=[...population,...['train','dev'].map(split=>({decisionId:`demo-${r}-${split}`,key:{matchId:`${split}-0`,moveNo:100+r},inputSHA256:`d-input-${r}-${split}`,contextSHA256:`d-context-${r}-${split}`,split,sampleClass:'target',eligibility:'eligible'}))];
 const meta=populationWithDemos.filter(x=>x.sampleClass==='target').map((p,rank)=>({...p,sampleKind:'demo',rank}));
 const rows=meta.map(m=>({sampleKind:'demo',sampleClass:'target',record:{key:m.key},privateInput:{observation:{decisionId:m.decisionId}}}));
 const production={specRef:`spec-${r}`,selectionRuleRef:`rule-${r}`,populationRef:{id:`pop-${r}`},selectedMetadataRef:{id:`meta-${r}`},exclusionsRef:{id:`ex-${r}`}};
 const spec={outputId:`selection-${r}`,sourceIndexRef:'index',queueRef:'queue',planRef:'plan'},selection={productionRef:s.productionRefs[r],_ref:s.selectionRefs[r]};
 references.set(production.specRef,spec);references.set(production.selectionRuleRef,{protocolRef:s.protocolRef,representativeRound:r,layoutOrder:layouts});
 const trusted={mode:'research',phase:'dataset',repositoryRoot:'/synthetic',controlRoot:'/synthetic/control',sourceIndexPath:'/synthetic/index',references,labelTerminalRefs:[{id:`terminal-${r}`,sha256:'a'.repeat(64)}]};
 const terminalValues=meta.map((m,i)=>({...m,status:r===1&&i===0?'failed_format':'response',labelKind:r===1&&i===0?null:'offline_suggested'}));
 proofs.push({selection,production,resolvedInputs:trusted,_verified:{selection,production,spec,selectedMetadata:meta,population:populationWithDemos},_checked:{rows,selectedMetadata:meta,missing:new Set(),terminals:new Map(terminalValues.map(v=>[stable(v.key),v])),teacherAttemptDiagnostics:[]}});
}
const sandbox={sha:x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),validateCumulativeSampling,cumulativeKeepCandidates,assertCumulativeGrowth,Map,Set,structuredClone,console,digest,canonical:stable,equal:(a,b)=>stable(a)===stable(b),reject:r=>{throw Error(r);},isFirstRoundR2DatasetPlan:p=>p.researchProtocol?.id==='first-round-common-view-r2',verifyCommonViewRoundAdmission:()=>({poolRef:s.poolRef,pool:{protocolRef:s.protocolRef,planRef:'plan'},priorSelectionRefs:[s.selectionRefs[0]],round:1}),referenceOf:(_,selection)=>selection._ref,verifyOfflineSelection:(selection)=>{verified++;return proofs.find(p=>p.selection===selection)._verified;},materializeFirstRoundOriginalRows:v=>proofs.find(p=>p._verified===v)._checked.rows,selectedRows:(rp,rows,p,alreadyVerified)=>{assert.equal(alreadyVerified,p._verified);checked++;assert.equal(rp.samplingRef,p.selection.productionRef);assert.equal(rp.cumulativeSampling,undefined);return p._checked;},readOfflineSnapshot:p=>({record:{},decision:{key:p.key},input:{observation:{decisionId:p.decisionId}}}),loadFrozenDataset:()=>{throw Error('unexpected previous load');}};
runInNewContext(glue+';this.build=cumulativeSelectedRows;this.summarizeCumulative=cumulativeSummary;',sandbox);
const joined=sandbox.build(plan,{schema:'ohuo-first-round-cumulative-proof-r2',samplingRef:plan.samplingRef,rounds:proofs,previousDataset:null});
assert.equal(checked,2);assert.equal(verified,2);assert.equal(joined.rows.filter(r=>r.sampleKind==='demo').length,4);assert.equal(joined.rows.filter(r=>r.sampleKind==='keep').length,4);
assert.equal(joined.cumulativeEvidence.rounds.length,2);assert.equal(joined.cumulativeEvidence.rounds[1].terminalOutcomes[0].status,'failed_format');
assert.equal(joined.contexts.get(joined.rows[0]).plan.samplingRef,s.productionRefs[0]);
assert.equal(joined.contexts.get(joined.rows[2]).plan.samplingRef,s.productionRefs[1]);
assert.equal(joined.contexts.get(joined.rows.at(-1)).plan.samplingRef,plan.samplingRef);
assert.throws(()=>sandbox.build(plan,{schema:'ohuo-first-round-cumulative-proof-r2',samplingRef:plan.samplingRef,rounds:[proofs[1]],previousDataset:null}),/proof_identity/);
const bad={...plan,cumulativeSampling:{...cumulative,selectionRefs:[s.selectionRefs[1],s.selectionRefs[0]]}};bad.samplingRef=`cumulative@sha256:${digest(bad.cumulativeSampling)}`;
assert.throws(()=>sandbox.build(bad,{schema:'ohuo-first-round-cumulative-proof-r2',samplingRef:bad.samplingRef,rounds:proofs,previousDataset:null}),/complete_round_chain/);
const liveSamples=joined.rows.map(row=>{const cx=joined.contexts.get(row),m=joined.selectedMetadata.find(z=>stable(z.key)===stable(row.record.key));return {sampleKind:row.sampleKind,decisionId:m.decisionId,key:m.key,contextSHA256:m.contextSHA256,provenance:{inputSHA256:m.inputSHA256,samplingRef:cx.plan.samplingRef}};});
const e={...joined.cumulativeEvidence,growth:assertCumulativeGrowth([],liveSamples)};
const summary=sandbox.summarizeCumulative({qualification:{eligible:true,reasons:[]}},e,liveSamples,plan);assert.equal(summary.qualification.eligible,true);
const altered=structuredClone(liveSamples);altered[0].provenance.samplingRef=s.productionRefs[1];assert.throws(()=>sandbox.summarizeCumulative({qualification:{eligible:true,reasons:[]}},e,altered,plan),/demo_provenance/);
const oldSame=liveSamples.filter(x=>x.sampleKind==='demo'),nextPlan={...plan,cumulativeSampling:{...cumulative,previousDatasetRef:s.previousDatasetRef}};nextPlan.samplingRef=`cumulative@sha256:${digest(nextPlan.cumulativeSampling)}`;const sameData=liveSamples.map(x=>x.sampleKind==='keep'?{...x,provenance:{...x.provenance,samplingRef:nextPlan.samplingRef}}:x);const noGrowth={...e,samplingRef:nextPlan.samplingRef,previousDatasetRef:s.previousDatasetRef,previousManifestSHA256:'a'.repeat(64),previousValidDemoIdentities:oldSame,growth:assertCumulativeGrowth(oldSame,sameData)};
const diagnostic=sandbox.summarizeCumulative({qualification:{eligible:true,reasons:[]}},noGrowth,sameData,nextPlan);assert.equal(diagnostic.qualification.eligible,false);assert.deepEqual(diagnostic.qualification.reasons,['cumulative_no_new_valid_demo']);
console.log('PASS actual cumulative B09 glue: both proofs consumed, failed denominator retained, per-round provenance and no-growth diagnostic; synthetic boundaries only');

// Native H predecessor inventory: actual constructor, catalog, SHA-bound files
// and unmodified production method. This does not claim a full B09 ledger replay.
// Run once with the same original M9 case and --native after source acceptance.
if(process.argv.includes('--native') || (process.argv.indexOf('--case') >= 0 && process.argv[process.argv.indexOf('--case') + 1] === 'training.first-round-cumulative-data')){
 const {FixedHostFiles}=await import('./ohuo-host-files.ts');
 const {canonical:hostCanonical,digest:hostDigest}=await import('./task-schema.mjs');
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const repo=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ohuo-cumulative-host-')));
 try{
  const refs=[],evidence=[];
  const write=(name,value)=>{const full=path.join(repo,name);fs.mkdirSync(path.dirname(full),{recursive:true});const bytes=Buffer.from(JSON.stringify(value)+'\n');fs.writeFileSync(full,bytes,{mode:0o600});return{path:name,sha256:createHash('sha256').update(bytes).digest('hex')};};
  const put=(name,value)=>{const reference=`${name}@sha256:${hostDigest(value)}`;refs.push({ref:reference,file:write(`fixture/${name}.json`,value)});return reference;};
  fs.mkdirSync(path.join(repo,'lab/out/control'),{recursive:true});
  const initialStateRef=put('initial',{}),protocolRef=put('protocol',{schema:'fixture-protocol'}),indexRef=put('index',{}),queueRef=put('queue',{}),p0=put('production0',{round:0}),p1=put('production1',{round:1});
  const plan={sourceIndexRef:indexRef,queueRef,identities:{teacher:{releaseRef:'fixed-teacher'}},researchProtocol:{id:'first-round-common-view-r2',revisionRef:protocolRef}};
  const sampling={protocolRef,previousDatasetRef:null},state={runs:{}},pool={planRef:put('plan',{})};
  const hostManifest=()=>({schema:'ohuo-fixed-host-v1',controlRoot:'lab/out/control',rootInstanceId:'fixture-root',initialStateRef,references:refs,evidenceFiles:evidence,grantFile:{path:'fixture/unused-grant.json',sha256:'0'.repeat(64)},planCloseoutFile:'fixture/unused-closeout.json',inputBindings:[],profileStorePath:null,pythonPath:null});
  const host=()=>{write('deliverables/ohuo-runtime/host.json',hostManifest());return new FixedHostFiles(repo);};
  const previous=(samplingValue=sampling,stateValue=state)=>host().cumulativePreviousDataset(plan,samplingValue,[p0,p1],stateValue,pool);
  assert.equal(previous(),null);
  const register=(name,previousPlan)=>{const file=write(`lab/out/${name}/manifest.json`,{schema:'ohuo-distill-dataset-manifest-v1',plan:previousPlan});evidence.push({id:`${name}/manifest.json`,file});const reference=put(name,{schema:'ohuo-frozen-dataset-ref-v1',manifestSHA256:file.sha256});return{reference,file};};
  const first=register('dataset0',{...plan,samplingRef:p0});
  assert.throws(()=>previous(),/previousDataset/); // null cannot erase a frozen predecessor
  assert.equal(previous({...sampling,previousDatasetRef:first.reference}).reference,first.reference);
  const second=register('dataset1',{...plan,cumulativeSampling:{productionRefs:[p0,p1]}});
  assert.throws(()=>previous({...sampling,previousDatasetRef:first.reference}),/previousDataset/); // cannot omit actual newest complete prefix
  assert.equal(previous({...sampling,previousDatasetRef:second.reference}).frozen.manifestSHA256,second.file.sha256);
  const learned={runs:{learn:{task:{planRef:pool.planRef,taskKind:'supervised_training',scientificContract:{analysisMethodRef:protocolRef},datasetRefs:[second.reference]}}}};
  assert.throws(()=>previous(sampling,learned),/previousDataset/);
  assert.equal(previous({...sampling,previousDatasetRef:second.reference},learned).reference,second.reference);
  const before=fs.readFileSync(path.join(repo,second.file.path));fs.appendFileSync(path.join(repo,second.file.path),' ');
  assert.throws(()=>previous({...sampling,previousDatasetRef:second.reference}),/reference_identity_mismatch/);fs.writeFileSync(path.join(repo,second.file.path),before);
  assert.equal(hostCanonical(state),hostCanonical({runs:{}}));
  console.log('PASS native original H predecessor catalog/null/omitted-prefix/learning-history/tamper assertions; no model, match, or source replay');
 }finally{fs.rmSync(repo,{recursive:true,force:true});}
}
