/** S3 engineering-only two-root shared-input smoke. No weights, API or games. */
import assert from 'node:assert/strict';
import fs,{mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import * as screen from '../first-round-screen-consumer';
import {buildFirstRoundRegistryPolicyEnvelope,validateFirstRoundRegistryPolicy,FIRST_ROUND_PEER_PROGRAM_FILES} from '../first-round-registry-policy';
import {digest,referenceOf} from '../task-schema.mjs';
const sha=(v:any)=>createHash('sha256').update(v).digest('hex');
export function checkFirstRoundScreenPrepare(){
 const create=(screen as any).prepareFirstRoundScreenBindings;
 assert.equal(typeof create,'function','shared screen bindings must exist before roots are walked');
 const root=mkdtempSync(join(tmpdir(),'ohuo-screen-prepare-')),cpPath=join(root,'labels.json'),statePath=join(root,'state.json');
 const task={planRef:'plan',budgetRef:'budget',labelPolicyRef:'teacher'},comparison={proposalRef:'proposal'},selectionRef='selection';
 const rows=[0,1].map(i=>({key:{decision:i},inputSHA256:sha('input'+i),resultRef:{path:join(root,'label'+i+'.json'),sha256:sha('terminal'+i)},status:'response',labelKind:'selected'}));
 const checkpoint={schema:'ohuo-offline-label-run-v1',rows},labelTask={...task,parentPolicyRef:comparison.proposalRef,datasetRefs:[selectionRef]};
 const run={task:labelTask,taskSHA256:digest(labelTask),checkpoint,checkpointSHA256:digest(checkpoint),checkpointRef:cpPath},state:any={runs:{labels:run},budgets:{live:{used:0}}};
 writeFileSync(cpPath,JSON.stringify(checkpoint));writeFileSync(statePath,JSON.stringify(state));
 const encoder={schema:'v2',ctxFill:'rule-context',passEncoding:'action64'},peers=Array.from({length:6},(_,i)=>({policyId:'peer'+i,kind:'neural',weightsPath:'peer'+i+'.f32',weightsSHA256:sha('weight'+i),inputDim:399,encoder,epsilon:0}));
 const old={policyId:'old',kind:'neural',weightsPath:'old.f32',weightsSHA256:sha('old'),inputDim:385,encoder:{candidateCompat:'v2',passEncoding:'legacy-phys10'},epsilon:0};
 const registry={schemaVersion:'r6-no-H-policy-registry-v1',selectedExperiment:'direct_teacher_no_h',policies:[old,...peers],trainingPool:['old'],developmentPartners:['peer0','peer1','peer2'],confirmationPartners:['peer3','peer4','peer5'],oldCompletePolicy:'old',profiles:{}};
 let registryBytes=Buffer.from(JSON.stringify(registry));const registryRef={id:'registry',sha256:sha(registryBytes)},readEvidence=(r:any)=>{assert.deepEqual(r,registryRef);return registryBytes;};
 const options={registryRef,policyId:'peer0',readEvidence,repositoryRoot:root,role:'partner' as const},envelope=buildFirstRoundRegistryPolicyEnvelope(options),metadata=validateFirstRoundRegistryPolicy({...options,envelope});
 const peer={seatSnapshot:{releaseRef:referenceOf('peer',envelope),registryPolicy:envelope,policyIdentity:metadata.identity},policySpec:peers[0],role:'partner'};
 const contract={selectionRef,registryRef},inputs={readFirstRoundEvidence:readEvidence,policyRepositoryRoot:root,offlineSelection:{controlRoot:root,repositoryRoot:root,evidenceFiles:new Map(rows.map((r,i)=>['label'+i,{path:'label'+i+'.json'}]))}};
 const originalRead=fs.readFileSync;let checkpointReads=0,programReads=0,corruptProgramRead=false;
 fs.readFileSync=((p:any,...args:any[])=>{if(String(p)===cpPath)checkpointReads++;if(FIRST_ROUND_PEER_PROGRAM_FILES.some(x=>String(p).endsWith('/'+x)))programReads++;const value=(originalRead as any)(p,...args);return corruptProgramRead&&String(p).endsWith('/lab/review6/policy-registry.ts')?Buffer.concat([value,Buffer.from('\n')]):value;}) as any;syncBuiltinESMExports();
 try{
  const bindings=create({task,comparison,contract,inputs});
  for(let i=0;i<2;i++){bindings.verifyLabel({root:{labelTerminalRef:{id:'label'+i,sha256:rows[i].resultRef.sha256}},row:rows[i],terminal:{status:'response',labelKind:'selected'}});bindings.verifyPeer(peer);}
  state.budgets.live.used=1;writeFileSync(statePath,JSON.stringify(state));bindings.assertUnchanged();
  assert.equal(checkpointReads,2,'one checkpoint read at prepare and one at return, independent of root count');
  assert.equal(programReads,14,'one distinct peer verification and one fresh return-boundary verification');
  assert.throws(()=>bindings.verifyPeer({...peer,role:'opponent'}),/role/,'a different seat role cannot hit the cached tuple');
  const changed=create({task,comparison,contract,inputs});writeFileSync(cpPath,JSON.stringify({...checkpoint,rows:rows.slice(0,1)}));assert.throws(()=>changed.assertUnchanged(),/changed|committed/);writeFileSync(cpPath,JSON.stringify(checkpoint));
  const changedState=create({task,comparison,contract,inputs});state.runs.duplicate=structuredClone(run);writeFileSync(statePath,JSON.stringify(state));assert.throws(()=>changedState.assertUnchanged(),/changed/);delete state.runs.duplicate;writeFileSync(statePath,JSON.stringify(state));
  const changedProgram=create({task,comparison,contract,inputs});changedProgram.verifyPeer(peer);corruptProgramRead=true;
  try{assert.throws(()=>changedProgram.assertUnchanged(),/program\/source/);}finally{corruptProgramRead=false;}
  const changedRegistry=create({task,comparison,contract,inputs});changedRegistry.verifyPeer(peer);registryBytes=Buffer.from(JSON.stringify({...registry,selectedExperiment:'changed'}));assert.throws(()=>changedRegistry.assertUnchanged(),/SHA|changed/);
 }finally{fs.readFileSync=originalRead;syncBuiltinESMExports();}
 return {twoRoots:true,checkpointReads:2,peerProgramReads:14,changedCheckpointRejected:true,changedRelatedStateRejected:true,changedRegistryRejected:true,changedProgramRejected:true,roleCannotReuse:true,unrelatedLiveBudgetNotCached:true,providerRequests:0,modelWeightsRead:false,matches:0};
}
if(process.argv[1]?.endsWith('first-round-screen-prepare-smoke.ts'))console.log(JSON.stringify(checkFirstRoundScreenPrepare()));
