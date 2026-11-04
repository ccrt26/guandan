/** Small original designed selector/reader fixture with fake local networks.
 * The H action gates below are controllable seams, not runtime authorization. */
import {afterEach,describe,expect,it,vi} from 'vitest';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {applyMove,buildDeck,canPass,classify,createMatch,DEFAULT_RULES,legalCombos,startGame} from '@gd/engine';
import {FIRST_TARGET_CANDIDATE_POLICY} from '../../packages/ai/src/candidate-spec';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {dedupCandidates} from '../../packages/ai/src/nn/neuralSeat';
import {PublicTracker} from '../../packages/ai/src/nn/schema';
import {resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import {dealtFamilyBeforeExchange} from '../review6/training-ancestry';
import {canonical,digest,referenceOf} from '../review6_2/task-schema.mjs';
import {FIRST_ROUND_TARGET_DEFINITION} from '../review6_2/first-round-target';
import {DESIGNED_SOURCE_PROGRAM_PATHS} from '../review6_2/designed-source';
import {commonDecisionIdentityForSnapshot} from '../review6_2/offline-label-source';

const fake=vi.hoisted(()=>({runtime:null as any,constructions:0,proposalCalls:0,failLoad:false,modelReads:[] as string[],afterModelRead:null as null|((kind:'proposal'|'student')=>void)}));
// Keep both real Node adapters and their registered-path/file reads. Model
// byte-integrity validation, identity and network construction are fake;
// these tiny files prove change detection, not real model integrity.
vi.mock('../../packages/ai/src/policy/resolve',async importOriginal=>{
 const actual=await importOriginal<any>();return {...actual,
  resolvePolicy:async(ref:string,runtime:any)=>{
   if(fake.failLoad)throw Error('fixture_model_load_failed');
   const descriptor=actual.validatePolicyIndex(runtime.registry).policies.find((p:any)=>p.policyId===ref);
   if(!descriptor)throw Error('fixture_unknown_policy');
   const location=descriptor.weightsPathOrUrl.nodePath;await runtime.readWeights(location);fake.modelReads.push(location);fake.afterModelRead?.('proposal');
   return {...fake.runtime.proposal,descriptor};
  },
  resolveStudentScorer:async(value:any,runtime:any)=>{
   const descriptor=actual.validateStudentScorerDescriptor(value),location=descriptor.weightsPathOrUrl.nodePath;
   await runtime.readWeights(location);fake.modelReads.push(location);fake.afterModelRead?.('student');
   return {descriptor,createNetwork:()=>fake.runtime.parent.studentCapture.network};
  },
 };
});
vi.mock('../review6_2/offline-selection',async importOriginal=>{
 const actual=await importOriginal<any>();return {...actual,createDesignedSelectionSession:async(...args:any[])=>{fake.constructions++;return actual.createDesignedSelectionSession(...args);}};
});
import {FixedHostFiles} from '../review6_2/ohuo-host-files';
import * as selector from '../review6_2/offline-selection';

const repository=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');
const output=join(repository,'lab/out/v542-rev46-local/session');
const sha=(raw:string|Buffer)=>createHash('sha256').update(raw).digest('hex');
afterEach(()=>{vi.restoreAllMocks();fake.failLoad=false;fake.afterModelRead=null;});

async function fixture(){
 mkdirSync(output,{recursive:true});const root=realpathSync(mkdtempSync(join(output,'fixture-'))),controlRoot=join(root,'lab/out/control');mkdirSync(controlRoot,{recursive:true});
 const references=new Map<string,any>(),evidenceFiles=new Map<string,any>();
 const put=(path:string,value:any)=>{const raw=canonical(JSON.parse(JSON.stringify(value))),full=join(root,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,raw,{mode:0o600});return{path,sha256:sha(raw)};};
 const ref=(id:string,value:any)=>{const r=referenceOf('session-fixture/'+id,value);references.set(r,value);return r;};
 const evidence=(id:string,value:any)=>{const file=put('evidence/'+id+'.json',value);evidenceFiles.set(id,file);return{id,sha256:file.sha256};};
 for(const path of DESIGNED_SOURCE_PROGRAM_PATHS){mkdirSync(dirname(join(root,path)),{recursive:true});copyFileSync(join(repository,path),join(root,path));}
 const engineSourceRef=ref('source',{baseCommit:'a'.repeat(40),files:DESIGNED_SOURCE_PROGRAM_PATHS.map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))}),rulesRef=ref('rules',DEFAULT_RULES);
 const receipt=JSON.parse(readFileSync(join(repository,'lab/review6_2/checks/fixtures/s35-migration-metadata.json'),'utf8')),source=receipt.parentRef;
 source.weightsPathOrUrl.nodePath='fixture-models/B-prime.f32';receipt.target.weightsPathOrUrl.nodePath='fixture-models/S0.f32';
 const modelIndexPath=join(root,'lab/model-index.json'),proposalWeightPath=join(root,source.weightsPathOrUrl.nodePath),studentWeightPath=join(root,receipt.target.weightsPathOrUrl.nodePath);
 put('lab/model-index.json',{schemaVersion:'gd-model-index-v1',defaultPolicyRef:source.policyId,policies:[source]});
 for(const path of [proposalWeightPath,studentWeightPath]){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,Buffer.from([1,2,3,4]),{mode:0o600});}
 const migrationReceiptRef=evidence('migration',receipt);
 const identity={policyId:source.policyId,modelVersion:source.modelVersion,weightsSHA256:source.weightsSHA256,inputDim:399,encoderVersion:source.encoder.encoderVersion,candidateVersion:source.candidateSpecId,passEncoding:source.encoder.passEncoding,architectureId:source.architectureId,weightsLayoutVersion:source.weightsLayoutVersion,epsilon:0,tieBreakId:source.tieBreakId,tierSpecId:source.tierSpecId};
 const studentParentRef=ref('S0',{schema:'ohuo-student-parent-ref-v1',scorer:receipt.target,migrationReceiptRef,basePolicyIdentity:identity}),legacy=RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1')!,baseRef=ref('B',{schema:'ohuo-release-ref-v1',release:legacy,policyIdentity:identity});
 const actingReleaseRef=ref('B-prime',{schema:'ohuo-candidate-research-release-ref-v1',parentRef:baseRef,release:{...legacy,releaseRef:'fixture-B-prime',label:'Fixture B prime',status:'development',parentRelease:legacy.releaseRef,candidateSpecRef:'first-target-offer12-v1',promptRef:'ohuo-engine-rules-v1/choose-only-v2'},policyIdentity:identity,candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY});
 const comparisonRef=ref('comparison',{schema:'ohuo-first-round-comparison-v1',proposalRef:actingReleaseRef,studentParentRef});
 fake.runtime={proposal:{identity,encoder:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'},candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY,createDecider:(seat:number)=>{
  const tracker=new PublicTracker();return{seat,tracker,newGame:()=>tracker.reset(),observe:(events:any)=>tracker.observe(events),decide:(state:any)=>{fake.proposalCalls++;const candidates=dedupCandidates(legalCombos(state,FIRST_TARGET_CANDIDATE_POLICY.enumSpec.enumerationMode),canPass(state));return{candidatePolicy:FIRST_TARGET_CANDIDATE_POLICY,move:candidates[0].combo?{pass:false,combo:candidates[0].combo}:{pass:true},nCands:candidates.length,explored:false,ranking:candidates.map(({combo},idx)=>({combo,idx,score:candidates.length-idx}))};}};
 }},parent:{studentCapture:{studentParentRef,scorer:receipt.target,network:{inputDim:423,forward:(_x:any,n:number)=>new Float32Array(n)}}}};
 const deck=buildDeck(),initialIds=Array.from({length:4},(_,seat)=>deck.slice(seat*27,(seat+1)*27).map(c=>c.id)),state=startGame(createMatch(structuredClone(DEFAULT_RULES),1),[],initialIds),familyId=dealtFamilyBeforeExchange(state),designFamilyId='session-design-family',moves:any[]=[];
 const card=state.hands[state.turn].find(c=>c.rank===3)!,single=classify([card],state.ctx,state.match.opts)[0];
 for(const move of [{pass:false,combo:single},{pass:true}] as any[]){moves.push({gameNo:1,actorSeat:state.turn,move:structuredClone(move)});applyMove(state,resolveLegalMove(state,JSON.parse(JSON.stringify(move))));}
 const sourceFile=evidence('designed-source',{schema:'ohuo-designed-first-game-source-v1',sourceKind:'designed-synthetic',questionId:'session-question',designFamilyId,split:'train',engineSourceRef,rulesRef,rules:DEFAULT_RULES,origin:{kind:'first-game',leaderSeed:1},initialIds,moves,target:{gameNo:1,moveNo:state.moveNo,actorSeat:state.turn,remainingCards:state.hands.map(h=>h.length)}});
 const indexFile=evidence('index',{version:1,families:{[familyId]:{split:'train',rootFamilyId:familyId,parentFamilyIds:[]},[designFamilyId]:{split:'train',rootFamilyId:familyId,parentFamilyIds:[familyId]}}}),sourceIndexPath=join(root,evidenceFiles.get(indexFile.id).path),sourceIndexRef=ref('index',{schema:'ohuo-source-index-ref-v1',namespace:'session-fixture',fileSHA256:indexFile.sha256});
 const sourceRef=ref('registered-source',{schema:'ohuo-designed-source-registration-v1',sourceIndexRef,sourceFile,questionId:'session-question',designFamilyId,sourceFamilyId:familyId,rootFamilyId:familyId,engineSourceRef,rulesRef,comparisonRef}),queueRef=ref('queue',{schema:'ohuo-designed-source-queue-v1',namespace:'session-fixture',sourceIndexRef,rows:[{sourceKind:'designed-synthetic',sourceRef}]});
 const planRef=ref('plan',{fixture:true}),clauseRef=ref('clause',{fixture:true}),authorizationRef=ref('authorization',{fixture:true}),limits={maxProviderRequests:0,maxLabelDecisions:0,maxMatchAttempts:0,maxOptimizerSteps:0,maxRunSeconds:60},budgetRef=ref('budget',{planRef,authorizationRef,researchBatchId:'session-fixture',controlRoot,limits});
 const protocolRef=ref('protocol',{schema:'ohuo-first-round-protocol-revision-v2',protocolId:'first-round-common-view-r2'}),targetDefinitionRef=ref('target',FIRST_ROUND_TARGET_DEFINITION),selectionRuleRef=ref('selection-rule',{schema:selector.DESIGNED_SELECTION_RULE_SCHEMA,protocolRef,comparisonRef,targetDefinitionRef,sourceKind:'designed-synthetic',split:'train',representativeRule:'one-hash-representative-per-root-public-cell',usedRule:'all-original-host-committed-selections',ordinaryKeepRule:'existing-natural-train-pool-disjoint-causal-context'});
 const roles=['teacher-a','teacher-b'].map(taskId=>({role:'teacher',taskId,runId:taskId,experimentId:taskId})),designedContractRef=ref('contract',{schema:'ohuo-designed-source-consumer-contract-v1',planRef,clauseRef,branchRef:null,budgetRef,protocolRef,comparisonRef,sourceIndexRef,queueRef,selectionRuleRef,targetDefinitionRef,plannedTasks:roles});
 const liveState:any={schemaVersion:1,tasks:{},runs:{},budgets:{[budgetRef]:{researchBatchId:'session-fixture',authorizationRef,planRef,limits,used:{providerRequests:0,labelDecisions:0,matchAttempts:0,optimizerSteps:0},reservations:{},activeRunId:null,accountingMode:'research'}},batches:{'session-fixture':{budgetRef,authorizationRef,planRef}}};
 const controlStateRef=evidence('frozen-state',liveState),freezeEvidenceRef=evidence('freeze',{schema:'ohuo-selection-prequery-v1',planRef,clauseRef,branchRef:null,budgetRef,controlRoot,controlStateRef}),quotaBasisRef=evidence('quota',{schema:'ohuo-selection-source-batch-basis-r2',planRef,budgetRef,controlStateRef,stage2Stage3AccountingRefs:[],protocolRef,families:[{familyId,split:'train'}],reasonRef:evidence('reason',{fixture:true}),freezeEvidenceRef});
 const spec:any={schema:selector.DESIGNED_SELECTION_SPEC_SCHEMA,planRef,clauseRef,branchRef:null,sourceIndexRef,queueRef,sourceRunRefs:[],targetDefinitionRef,selectionRuleRef,quotaBasisRef,purpose:'b_training_source',actingReleaseRef,outputId:'fixture-selection',designedContractRef},specRef=referenceOf('offline-selection-spec/'+spec.outputId,spec);references.set(specRef,spec);
 const initialStateRef=ref('initial',liveState),grantFile=put('grant.json',{fixture:true}),hostPath='deliverables/ohuo-runtime/host.json';
 const save=()=>put(hostPath,{schema:'ohuo-fixed-host-v1',controlRoot:relative(root,controlRoot),rootInstanceId:'session-fixture-root',initialStateRef,references:[...references].map(([ref,value])=>({ref,file:put('refs/'+sha(ref)+'.json',value)})),evidenceFiles:[...evidenceFiles].map(([id,file])=>({id,file})),grantFile,planCloseoutFile:'closeout.json',inputBindings:[],profileStorePath:null,pythonPath:null});
 const writeState=()=>put('lab/out/control/state.json',liveState);writeState();save();
 const setupSession=await selector.createDesignedSelectionSession(root,specRef),trusted:any={repositoryRoot:root,references,evidenceFiles,sourceIndexPath,confirmedRecordRoots:[],controlRoot,mode:'research',phase:'freeze',designedSession:setupSession};
 const produced=selector.prepareOfflineSelection(spec,trusted);expect(produced.selection.rows).toHaveLength(1);expect(produced.production.verification).toBe('reproduced');
 for(const f of produced.files)evidenceFiles.set(f.id,f.file);references.set(produced.productionRef,produced.production);references.set(produced.selectionRef,produced.selection);
 const capabilityRef=ref('capability',{id:'B07.offline-label.v1',kind:'collect',mode:'research'}),decisionRuleRef=ref('teacher-rule',{schema:'ohuo-common-view-teacher-contract-r2',protocolRef,comparisonRef,selectionRef:produced.selectionRef});
 const tasks=roles.map(role=>({taskId:role.taskId,runId:role.runId,experimentId:role.experimentId,taskKind:'collect',capabilityRef,planRef,budgetRef,authorizationRef,researchBatchId:'session-fixture',sourceRevision:engineSourceRef,runtimeRef:ref('runtime',{fixture:true}),sourcePlan:{namespace:'session-fixture',sourceIndexRef,split:'train',familyIds:[familyId]},seatLayoutPlan:queueRef,parentPolicyRef:actingReleaseRef,releaseRefs:[actingReleaseRef],datasetRefs:[produced.selectionRef],scientificContract:{analysisMethodRef:protocolRef,comparisonRef,decisionRuleRef}}));
 const taskRefs=tasks.map((task,i)=>ref('task-'+i,task)),ruleRef=ref('action-rule',{stage:4,phase:null,purpose:'data-glm'}),action={clauseRef,branchRef:null,plannedTaskIds:roles.map(r=>r.taskId),acceptanceRuleRef:ruleRef};save();
 const gates={authorization:true,action:true,prerequisites:true,lineage:true},calls={authorization:0,action:0,prerequisites:0,lineage:0,source:0};
 const makeHost=()=>{
  const host:any=new FixedHostFiles(root);
  vi.spyOn(host,'currentProducerSource').mockImplementation(()=>{calls.source++;return engineSourceRef;});
  vi.spyOn(host,'readNonrunnerAction').mockImplementation(()=>{calls.action++;if(!gates.action)throw Error('fixture_stop_or_closed');return{grant:{authorizationRef},action,protocol:{ref:protocolRef,value:{actions:[action]}},closeout:{entity:{status:'incomplete',actions:[action]}}};});
  vi.spyOn(host,'checkExistingRoot').mockImplementation(()=>JSON.parse(readFileSync(join(controlRoot,'state.json'),'utf8')));
  vi.spyOn(host,'assertDiagnosticWriteIntersection').mockImplementation(()=>{});
  vi.spyOn(host,'checkAuthorization').mockImplementation(async()=>{calls.authorization++;if(!gates.authorization)throw Error('fixture_authorization_revoked');return{};});
  vi.spyOn(host,'readApprovedAction').mockImplementation(()=>({action}));
  vi.spyOn(host,'prerequisites').mockImplementation(()=>{calls.prerequisites++;if(!gates.prerequisites)throw Error('fixture_prerequisite_revoked');});
  vi.spyOn(host,'assertActionTaskLineage').mockImplementation(()=>{calls.lineage++;if(!gates.lineage)throw Error('fixture_lineage_changed');});
  return host;
 };
 fake.constructions=0;fake.proposalCalls=0;fake.modelReads=[];
 const proof=(inputs:any)=>selector.verifyOfflineSelection(produced.selection,{...inputs,phase:'dataset'});
 return{root,spec,specRef,tasks,taskRefs,liveState,writeState,gates,calls,makeHost,proof,produced,modelIndexPath,proposalWeightPath,studentWeightPath,sourcePath:join(root,evidenceFiles.get(sourceFile.id).path),sourceIndexPath,programPath:join(root,DESIGNED_SOURCE_PROGRAM_PATHS[0]),referencePath:join(root,'refs/'+sha(queueRef)+'.json')};
}

describe('FixedHostFiles owned designed selection session',()=>{
 it('constructs once for two boundaries while preserving the original selection, C and decision identity',async()=>{
  const f=await fixture(),host=f.makeHost(),first=await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]}),firstProof=f.proof(first),snapshot=selector.readSelectionSnapshot(f.produced.selection.rows[0],first),captures=fake.proposalCalls;
  const second=await host.offlineSelectionHostInputs(f.spec,{phase:'label-resume',task:structuredClone(f.tasks[0])}),secondProof=f.proof(second),again=selector.readSelectionSnapshot(f.produced.selection.rows[0],second);
  expect(second).not.toBe(first);expect(second.phase).toBe('label-resume');expect(secondProof).toEqual(firstProof);
  expect(again.bundle.initialCandidateIds).toEqual(snapshot.bundle.initialCandidateIds);expect(commonDecisionIdentityForSnapshot(again)).toEqual(commonDecisionIdentityForSnapshot(snapshot));
  expect(fake.constructions).toBe(1);expect(fake.proposalCalls).toBe(captures);expect(second.designedSession).toBe(first.designedSession);
  expect(fake.modelReads).toEqual(['fixture-models/B-prime.f32','fixture-models/S0.f32']);
  expect(f.calls).toEqual({authorization:2,action:2,prerequisites:2,lineage:2,source:2});
 });
 it('keeps different Tasks, instances and non-Task consumers cold',async()=>{
  const f=await fixture(),host=f.makeHost();
  const first=await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]});f.proof(first);
  for(const task of [f.tasks[1],{...f.tasks[1],sourceRevision:referenceOf('changed-source',{fixture:true})}]){const next=await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task});expect(next.designedSession).not.toBe(first.designedSession);f.proof(next);}
  const other=await f.makeHost().offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]});expect(other.designedSession).not.toBe(first.designedSession);
  for(let i=0;i<2;i++)await host.offlineSelectionHostInputs(f.spec,{phase:'label-start'});
  expect(fake.constructions).toBe(6);
 });
 it('rejects a session rebound to another spec, index path or catalog',async()=>{
  const f=await fixture(),host=f.makeHost(),inputs=await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]});f.proof(inputs);
  const expected={repositoryRoot:f.root,specRef:f.specRef,sourceIndexPath:inputs.sourceIndexPath,references:inputs.references,evidenceFiles:inputs.evidenceFiles};
  for(const patch of [{specRef:referenceOf('other-spec',{fixture:true})},{sourceIndexPath:inputs.sourceIndexPath+'.other'},{references:new Map([...inputs.references,['other-ref',{fixture:true}]])},{evidenceFiles:new Map([...inputs.evidenceFiles,['other-file',{path:'other.json',sha256:'a'.repeat(64)}]])}]){
   expect(()=>selector.readDesignedSelectionHistory(inputs.designedSession,{...expected,...patch})).toThrow(/designed_selection_owned_runtime_required/);
  }
  await expect(host.offlineSelectionHostInputs({...f.spec,outputId:'another-spec'},{phase:'label-start',task:f.tasks[0]})).rejects.toThrow(/selection_task_binding/);expect(fake.constructions).toBe(1);
 });
 it('rechecks revoked authorization, stop/closed action, prerequisites, lineage, ledger and unknown on the second boundary',async()=>{
  const f=await fixture(),host=f.makeHost();f.proof(await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]}));
  for(const gate of ['authorization','action','prerequisites','lineage'] as const){f.gates[gate]=false;await expect(host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]})).rejects.toThrow(/fixture_/);f.gates[gate]=true;}
  const budgetRef=f.tasks[0].budgetRef,ledger=f.liveState.budgets[budgetRef];delete f.liveState.budgets[budgetRef];f.writeState();await expect(host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]})).rejects.toThrow(/budget_identity_unverified/);f.liveState.budgets[budgetRef]=ledger;
  f.liveState.tasks[f.tasks[0].taskId]=f.tasks[0].runId;f.liveState.runs[f.tasks[0].runId]={runId:f.tasks[0].runId,task:f.tasks[0],taskRef:f.taskRefs[0],taskSHA256:digest(f.tasks[0]),executionUnknown:true};f.writeState();
  await expect(host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]})).rejects.toThrow(/selection_execution_uncertain/);expect(fake.constructions).toBe(1);
 });
 it.each(['sourcePath','sourceIndexPath','programPath','referencePath'] as const)('rejects a changed original %s before reusing its reader',async pathKey=>{
  const f=await fixture(),host=f.makeHost();f.proof(await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]}));
  writeFileSync(f[pathKey],readFileSync(f[pathKey],'utf8')+'\n');
  let failure:any;try{await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]});}catch(error){failure=error;}
  expect(failure?.message).toMatch(/changed|identity_mismatch/);expect(fake.constructions).toBe(1);
 });
 it('does not retain a failed or partially constructed session',async()=>{
  const f=await fixture(),host=f.makeHost();fake.failLoad=true;
  await expect(host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]})).rejects.toThrow('fixture_model_load_failed');fake.failLoad=false;
  const inputs=await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]});f.proof(inputs);expect(fake.constructions).toBe(2);
 });
 it.each([
  ['proposalWeightPath','replace'],['proposalWeightPath','missing'],
  ['studentWeightPath','replace'],['studentWeightPath','missing'],
 ] as const)('rejects %s %s before hot reader reuse',async(pathKey,change)=>{
  const f=await fixture(),host=f.makeHost(),first=await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]});f.proof(first);
  const path=f[pathKey];
  if(change==='missing')unlinkSync(path);
  else{writeFileSync(path+'.replacement',Buffer.from([4,3,2,1]),{mode:0o600});renameSync(path+'.replacement',path);}
  await expect(host.offlineSelectionHostInputs(f.spec,{phase:'label-resume',task:structuredClone(f.tasks[0])})).rejects.toThrow(/designed_selection_model_input_changed/);
  expect(()=>selector.readSelectionSnapshot(f.produced.selection.rows[0],first)).toThrow(/designed_selection_model_input_changed/);
  expect(fake.constructions).toBe(1);expect(fake.modelReads).toHaveLength(2);
 });
 it.each(['proposal','student'] as const)('rejects model changes during the real %s loader and does not retain the session',async kind=>{
  const f=await fixture(),host=f.makeHost();
  fake.afterModelRead=loaded=>{if(loaded===kind)writeFileSync(kind==='proposal'?f.proposalWeightPath:f.studentWeightPath,Buffer.from([4,3,2,1]));};
  await expect(host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]})).rejects.toThrow(/designed_selection_model_input_changed/);
  fake.afterModelRead=null;
  writeFileSync(kind==='proposal'?f.proposalWeightPath:f.studentWeightPath,Buffer.from([1,2,3,4]));
  const inputs=await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]});f.proof(inputs);expect(fake.constructions).toBe(2);
 });
 it('rejects registry rebinding before hot reader reuse',async()=>{
  const f=await fixture(),host=f.makeHost();f.proof(await host.offlineSelectionHostInputs(f.spec,{phase:'label-start',task:f.tasks[0]}));
  const index=JSON.parse(readFileSync(f.modelIndexPath,'utf8'));index.policies[0].weightsPathOrUrl.nodePath='fixture-models/other.f32';writeFileSync(f.modelIndexPath,JSON.stringify(index));
  await expect(host.offlineSelectionHostInputs(f.spec,{phase:'label-resume',task:f.tasks[0]})).rejects.toThrow(/designed_selection_model_input_changed/);
  expect(fake.constructions).toBe(1);expect(fake.modelReads).toHaveLength(2);
 });
});
