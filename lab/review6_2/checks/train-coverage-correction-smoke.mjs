/** One actual original selector entry, synthetic registration only. No teacher,
 * optimizer, source generation or authority edits. Test output is temporary. */
import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{createHash,randomUUID}from'node:crypto';import{pathToFileURL}from'node:url';
const args=process.argv.slice(2),mode=args[0]==='--case'?(assert.equal(args[1],'training.train-coverage-correction'),assert.equal(args.length,2),'green'):args[0];assert.ok(['red','green'].includes(mode));
const root=process.cwd(),sha=b=>createHash('sha256').update(b).digest('hex'),read=p=>fs.readFileSync(path.join(root,p)),input=JSON.parse(read('lab/out/R11-train-coverage-fixture-input.json'));assert.equal(input.schema,'ohuo-train-coverage-fixture-input-v1');
const {FixedHostFiles}=await import(pathToFileURL(path.join(root,'lab/review6_2/ohuo-host-files.ts'))),S=await import(pathToFileURL(path.join(root,'lab/review6_2/offline-selection.ts'))),B=await import(pathToFileURL(path.join(root,'lab/review6_2/first-round-source-batch.mjs'))),{referenceOf,digest,canonical}=await import(pathToFileURL(path.join(root,'lab/review6_2/task-schema.mjs')));
const h=new FixedHostFiles(root),state=h.checkExistingRoot(),refs=new Map([...h.references].map(([r])=>[r,h.resolveRef(r)])),evidence=new Map(h.evidence),tmp=fs.mkdtempSync(path.join(root,'lab/out/coverage-fixture-')),cleanup=[tmp];
const guards=['lab/out/R11-v530-control/state.json','deliverables/ohuo-runtime/host.json',h.manifest.planCloseoutFile,h.manifest.grantFile.path].map(p=>[p,sha(read(p))]);
try{
 for(const r of input.references){assert.equal(r.ref.split('@sha256:').at(-1),digest(r.value));if(refs.has(r.ref))assert.deepEqual(refs.get(r.ref),r.value);else refs.set(r.ref,r.value);}
 for(const [i,e]of input.evidence.entries()){assert.equal(sha(e.content),e.file.sha256);if(evidence.has(e.id)){assert.equal(evidence.get(e.id).sha256,e.file.sha256);continue;}const actual=path.join(root,e.file.path);if(fs.existsSync(actual)){assert.equal(sha(fs.readFileSync(actual)),e.file.sha256);evidence.set(e.id,e.file);}else{const p=path.join(tmp,i+'.json');fs.writeFileSync(p,e.content,{flag:'wx'});evidence.set(e.id,{path:path.relative(root,p),sha256:e.file.sha256});}}
 const spec=refs.get(input.specRef);assert.ok(spec);
 const index=refs.get(spec.sourceIndexRef),binding=[...h.bindings.values()].find(b=>b.sourceIndexFile.sha256===index.fileSHA256);assert.ok(binding);
 const trusted={repositoryRoot:root,controlRoot:h.root,references:refs,evidenceFiles:evidence,sourceIndexPath:h.relativePath(binding.sourceIndexFile.path),confirmedRecordRoots:[],mode:'research',phase:'freeze'};
 if(mode==='red'){assert.throws(()=>S.verifyCommonViewRoundAdmission(spec,trusted,state),/coverage|round|unknown|unexpected|keys/);console.log(JSON.stringify({case:'training.train-coverage-correction',mode,observed:'old original entry refuses named train-only revision'}));}
 else{
  const proof=S.verifyCommonViewRoundAdmission(spec,trusted,state);assert.equal(proof.round,2);assert.equal(proof.usedRows.length,126);assert.deepEqual(proof.contract.plannedTasks.map(r=>[r.role,r.split]),[['primary-teacher','train'],['screen','train']]);
  const broken=structuredClone(state);broken.runs['r1-training-formal-stop-correction-1'].cleanupConfirmed=false;assert.throws(()=>S.verifyCommonViewRoundAdmission(spec,trusted,broken),/coverage|unsettled|changed/);
  const cp=structuredClone(proof.contract);cp.plannedTasks[0].split='dev';assert.throws(()=>B.validateCommonViewRoundTasks(cp));
  const publicView={state:{myHand:[{card:'S3',count:1}],currentTarget:{leadingSeat:'partner',kind:'pair'},otherSeats:{partner:{remainingCards:2},lower:{remainingCards:3},upper:{remainingCards:4}}},candidates:[{action:{pass:true}},{action:{pass:false,kind:'pair'}}]};assert.equal(B.trainCoveragePublicEligible(publicView),true);assert.equal(B.trainCoveragePublicEligible({...publicView,state:{...publicView.state,currentTarget:{...publicView.state.currentTarget,leadingSeat:'upper'}}}),false);assert.equal(B.trainCoveragePublicEligible({...publicView,state:{...publicView.state,otherSeats:{...publicView.state.otherSeats,upper:{remainingCards:0}}}}),false);
  const eligibleKeys=new Set(proof.coverageEligibleKeys),used=new Set(proof.usedRows.map(B.commonViewRowIdentity));let selected=0;
  const cmp=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
  for(const family of proof.pool.families){const rows=proof.base.population.filter(r=>r.split==='train'&&r.blockFamilyId===family.familyId&&r.eligibility==='eligible'&&r.sampleClass==='target'&&eligibleKeys.has(B.commonViewRowIdentity(r))).sort((a,b)=>cmp(sha(a.decisionId),sha(b.decisionId))||cmp(a.decisionId,b.decisionId)||cmp(canonical(a.key),canonical(b.key)));
   const result=B.selectNextCommonViewRepresentatives(rows,2,proof.usedRows);assert.ok(result.selected.every(r=>r.split==='train'&&!used.has(B.commonViewRowIdentity(r))));assert.equal(result.selected.length,result.cells.filter(c=>c.selected===1).length);selected+=result.selected.length;
  }

  console.log(JSON.stringify({case:'training.train-coverage-correction',mode,originalAdmission:'passed',actualEligiblePublicRows:proof.coverageEligibleKeys.length,actualUnusedRepresentativeCount:selected,actualOutputReadbackPending:true,priorUsed126:true,devSelection:0,notFullTaskAuthorization:true,training:false,teacherRequests:0,optimizerUpdates:0,authorityModified:false}));
 }
}finally{for(const p of cleanup)if(fs.existsSync(p))fs.rmSync(p,{recursive:true,force:true});for(const[p,s]of guards)assert.equal(sha(read(p)),s);}
