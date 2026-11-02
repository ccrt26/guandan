/** NAV-S33 fixed finite checks. Synthetic fixtures are not C1400 evidence. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as schema from '../src/nn/schema';
import * as descriptors from '../src/policy/descriptor';
import * as policies from '../src/policy/resolve';
import { MLP } from '../src/nn/mlp';
import { applyMove,buildDeck,classify,createMatch,DEFAULT_RULES,startGame } from '@gd/engine';
import { buildObservationWithPublicMemory } from '../src/hybrid/observation';
const cases = ['student.migration-map','student.memory-wire','student.load-resume-smoke'] as const;
const caseId = process.argv[process.argv.indexOf('--case')+1];
assert(cases.includes(caseId as typeof cases[number]), 'exact permitted --case required');
function sha(x:Float32Array):string { const b=Buffer.alloc(x.byteLength); x.forEach((v,i)=>b.writeFloatLE(v,i*4)); return createHash('sha256').update(b).digest('hex'); }
if (caseId === 'student.migration-map') {
  assert.equal(typeof schema.remapLegacy399WeightsToStudent423, 'function', '399→423 migration must exist explicitly');
  const source=new MLP(33,399).getWeights(), before=sha(source);
  const migrated=schema.remapLegacy399WeightsToStudent423(source);
  assert.equal(source.length,168449); assert.equal(migrated.length,174593); assert.equal(migrated.byteLength,698372);
  for(let h=0;h<256;h++) {
    for(let i=0;i<399;i++) assert.equal(migrated[h*423+i],source[h*399+i]);
    for(let i=399;i<423;i++) assert.equal(migrated[h*423+i],0);
  }
  assert.deepEqual(migrated.slice(108288),source.slice(102144));
  assert.equal(sha(source),before); assert.notEqual(sha(migrated),before);
  assert.throws(()=>schema.remapLegacy399WeightsToStudent423(new Float32Array(174593)),/length/);
  const bad=source.slice(); bad[1]=NaN; assert.throws(()=>schema.remapLegacy399WeightsToStudent423(bad),/finite/);
  assert.equal(schema.STUDENT_INPUT_DIM,423); assert.equal(schema.STUDENT_PASS_INPUT_IDX,395);
  assert.deepEqual(schema.STUDENT_INPUT_SEGMENTS,[{role:'legacy-state',offset:0,length:331},{role:'legacy-action',offset:331,length:68},{role:'public-memory',offset:399,length:24}]);
  const oldNet=new MLP(33,399), newNet=new MLP(0,423);newNet.setWeights(migrated);
  const oldX=new Float32Array(399*3),newX=new Float32Array(423*3);
  for(let n=0;n<3;n++) {
    for(let i=0;i<399;i++)oldX[n*399+i]=((i*7+n*3)%17)/17;
    newX.set(oldX.subarray(n*399,(n+1)*399),n*423);
    for(let i=399;i<423;i++)newX[n*423+i]=((i+n)%3)/2;
  }
  const oldScores=oldNet.forward(oldX,3),newScores=newNet.forward(newX,3);
  for(let i=0;i<3;i++)assert(Math.abs(oldScores[i]-newScores[i])<=1e-6*(1+Math.max(Math.abs(oldScores[i]),Math.abs(newScores[i]))));
  const pick=(scores:Float32Array)=>{let best=0;for(let i=1;i<scores.length;i++)if(scores[i]>scores[best])best=i;return best;};
  assert.equal(pick(oldScores),pick(newScores));
  console.log(JSON.stringify({caseId,datasetEligible:false,realTraining:false,fixture:'synthetic-MLP-seed33',sourceSHA256:before,targetSHA256:sha(migrated),targetParameters:migrated.length,targetBytes:migrated.byteLength,sourceUnchanged:true,allLegacyColumnsCopied:true,newColumnsZero:6144,remainingElementsCopied:66305,supplementalSyntheticScores:{old:[...oldScores],migrated:[...newScores]},actualC1400:'not run'}));
}
if(caseId === 'student.memory-wire') {
  assert.equal(typeof schema.appendPublicMemory24, 'function','explicit 399+24 append must exist');
  const legacy=new Float32Array(399); legacy[395]=1;
  const counts:number[]=Array.from({length:24},(_,i)=>i%6>=4 ? 2 : 8);
  const X=schema.appendPublicMemory24(legacy,counts);
  assert.equal(X.length,423); assert.deepEqual(X.slice(0,399),legacy); assert(X.slice(399).every(x=>x===1));
  assert.throws(()=>schema.appendPublicMemory24(new Float32Array(385),counts),/399/);
  assert.throws(()=>schema.appendPublicMemory24(legacy,[]),/24/);
  for(const value of [-1,1.5,NaN,Infinity,9]) {const bad=[...counts];bad[0]=value;assert.throws(()=>schema.appendPublicMemory24(legacy,bad),/count/);}
  const bad=[...counts];bad[4]=3;assert.throws(()=>schema.appendPublicMemory24(legacy,bad),/count/);
  const zero=schema.appendPublicMemory24(legacy,new Array(24).fill(0));
  const oneCounts=new Array(24).fill(0);oneCounts[0]=8;const one=schema.appendPublicMemory24(legacy,oneCounts);
  const net=new MLP(1,423),weights=new Float32Array(174593);weights[399]=1;weights[108544]=1;weights[174336]=1;net.setWeights(weights);
  const actual=net.forward(new Float32Array([...zero,...one]),2);
  assert.equal(actual[0],0); assert.equal(actual[1],Math.fround(Math.tanh(Math.fround(Math.tanh(1)))));
  const old=new MLP(1,399); assert.throws(()=>old.setWeights(weights),/length/);assert.throws(()=>net.setWeights(old.getWeights()),/length/);
  assert.equal(typeof schema.encodeStudentInput399Plus24, 'function','real state/action/memory encoder required');
  const deck=buildDeck(), j=deck.find(c=>c.suit==='C'&&c.rank===11)!;
  const ordered=[j,...deck.filter(c=>c.id!==j.id)],hands=Array.from({length:4},(_,i)=>ordered.slice(i*27,(i+1)*27).map(c=>c.id));
  const match=createMatch({...DEFAULT_RULES},33);match.levels=[7,7];match.lastHead=0;
  const state=startGame(match,[],hands),tracker=new schema.PublicTracker();
  const combo=classify([j],state.ctx,state.match.opts)[0];const events=applyMove(state,{pass:false,combo});tracker.observe(events);
  const history={matchId:'s33-synthetic',gameNo:state.match.gameNo,throughMoveNo:state.moveNo,steps:[{events,priorTarget:null}]};
  const envelope=buildObservationWithPublicMemory({state,history,matchId:history.matchId,actorSeat:state.turn,decisionId:'s33-fixed'});
  const key={matchId:history.matchId,gameNo:state.match.gameNo,moveNo:state.moveNo,actorSeat:state.turn};
  const input=schema.encodeStudentInput399Plus24(state,tracker,null,key,envelope.publicHighCardMemory);
  const expectedLegacy=new Float32Array(399);schema.encodeStateV2(state,state.turn,tracker,expectedLegacy.subarray(0,331),'rule-context');schema.encodeAction(null,expectedLegacy.subarray(331),'action64');
  assert.deepEqual(input.slice(0,399),expectedLegacy);assert.equal(input[395],1);assert.equal(input[317+7-2],1);
  // Current actor1 sees seat0 as upper/third relative block (after self and partner).
  assert.equal(input[399+12],1/8);assert.equal(input.slice(399).reduce((a,b)=>a+b,0),1/8);
  for(const keyChange of [{matchId:'foreign'},{gameNo:key.gameNo+1},{moveNo:key.moveNo+1},{actorSeat:(key.actorSeat+1)%4}])assert.throws(()=>schema.encodeStudentInput399Plus24(state,tracker,null,{...key,...keyChange},envelope.publicHighCardMemory),/identity/);
  assert.throws(()=>schema.encodeStudentInput399Plus24(state,tracker,null,key,undefined as any),/memory/);
  assert.throws(()=>schema.encodeStudentInput399Plus24(state,tracker,null,key,{...envelope.publicHighCardMemory,levelRank:11}),/level/);
  console.log(JSON.stringify({caseId,datasetEligible:false,realTraining:false,fixture:'synthetic-sentinel',passInputIndex:395,zeroMemoryScore:actual[0],sentinelScore:actual[1],normalizationDivisors:[8,8,8,8,2,2],backprop:'pending actual learner supplement',C1400Forward:'not run'}));
}

if(caseId === 'student.load-resume-smoke') {
  assert.equal(typeof descriptors.validateStudentScorerDescriptor,'function','strict explicit student423 descriptor required');
  const encoder={schema:'student-input399plus24-v1',encoderVersion:'student-input399plus24-v1',inputLayout:'legacy399_then_publicMemory24',
    baseEncoderRef:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64',encoderVersion:'gd-lab-schema-v4'},
    segments:[{role:'legacy-state',offset:0,length:331},{role:'legacy-action',offset:331,length:68},{role:'public-memory',offset:399,length:24}],
    memorySchemaId:'public-high-card-memory-v1',relativeSeatOrder:['self','partner','upper','lower'],
    slotOrder:['J','Q','K','LEVEL_OTHER','SJ','BJ'],normalizationDivisors:[8,8,8,8,2,2]};
  const weights=schema.remapLegacy399WeightsToStudent423(new MLP(33,399).getWeights());
  const bytes=Buffer.alloc(weights.byteLength);weights.forEach((v,i)=>bytes.writeFloatLE(v,i*4));
  const descriptor={schema:'ohuo-student-scorer-v1',policyId:'s33-synthetic-scorer',modelVersion:'synthetic-not-trained',
    architectureId:'mlp-tanh-256x256-scalar-v1',weightsLayoutVersion:'f32le-layer-w-row-major-then-b-v1',
    parameterCount:174593,inputDim:423,weightsPathOrUrl:{nodePath:'lab/out/S33-fixture/weights.f32'},weightsSHA256:sha(weights),
    tieBreakId:'first-candidate-v1',encoder};
  const accepted=descriptors.validateStudentScorerDescriptor(descriptor);assert.equal(accepted.inputDim,423);
  assert.deepEqual(accepted.encoder,encoder);assert(Object.isFrozen(accepted.encoder.segments[0]));
  assert.throws(()=>descriptors.validatePolicyDescriptor(descriptor),/unsupported/,'423 cannot enter historical proposal registry');
  for(const mutate of [(d:any)=>d.inputDim=399,(d:any)=>d.parameterCount=168449,(d:any)=>d.encoder.segments[1].offset=355,(d:any)=>d.encoder.baseEncoderRef.ctxFill='zero',(d:any)=>d.encoder.normalizationDivisors[0]=27,(d:any)=>d.encoder.unrecognized=true]) {
    const bad=structuredClone(descriptor);mutate(bad);assert.throws(()=>descriptors.validateStudentScorerDescriptor(bad),/student|encoder|parameter/);
  }
  const {writeExactNew}=await import('../../../lab/review6_2/checks/check-student-c1400');
  const {mkdir,mkdtemp,readFile,rm}=await import('node:fs/promises');
  const {resolve,join}=await import('node:path');
  const outputRoot=resolve('lab/out/S33-finite-write');await mkdir(outputRoot,{recursive:true});
  const dir=await mkdtemp(join(outputRoot,'same-bytes-'));
  try {
    const file=join(dir,'descriptor.json'),value=Buffer.from('{"fixture":true}\n');
    await writeExactNew(file,value);await writeExactNew(file,value);
    await assert.rejects(writeExactNew(file,Buffer.from('{"fixture":false}\n')),/existing migration output differs/);
    assert.deepEqual(await readFile(file),value,'mismatched retry must preserve original');
  } finally {await rm(dir,{recursive:true});}
  const runtime={site:'node' as const,readWeights:async()=>bytes,sha256:(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')};
  const loaded=await policies.resolveStudentScorer(descriptor,runtime);
  assert.equal('createDecider' in loaded,false,'student scorer never proposes candidates');
  const X=schema.appendPublicMemory24(new Float32Array(399),new Array(24).fill(1));
  const output=loaded.createNetwork().forward(X,1);
  const reloaded=await policies.resolveStudentScorer(JSON.parse(JSON.stringify(descriptor)),{...runtime,readWeights:async()=>new Uint8Array(bytes)});
  assert.deepEqual(reloaded.createNetwork().forward(X,1),output);
  await assert.rejects(policies.resolveStudentScorer(descriptor,{...runtime,readWeights:async()=>bytes.subarray(4)}),/length/);
  await assert.rejects(policies.resolveStudentScorer({...descriptor,weightsSHA256:'0'.repeat(64)},runtime),/SHA/);
  const nonfinite=Buffer.from(bytes);nonfinite.writeFloatLE(NaN,0);
  await assert.rejects(policies.resolveStudentScorer({...descriptor,weightsSHA256:createHash('sha256').update(nonfinite).digest('hex')},{...runtime,readWeights:async()=>nonfinite}),/finite/);
  const isolated=loaded.createNetwork();isolated.W[0][0]+=1;assert.deepEqual(loaded.createNetwork().getWeights(),weights);
  for(const inputDim of [385,399]) {
    const net=new MLP(33,inputDim),flat=net.getWeights(),b=Buffer.alloc(flat.byteLength);flat.forEach((v,i)=>b.writeFloatLE(v,i*4));
    const old={policyId:'legacy'+inputDim,modelVersion:'synthetic',architectureId:descriptor.architectureId,weightsLayoutVersion:descriptor.weightsLayoutVersion,
      parameterCount:flat.length,inputDim,weightsPathOrUrl:{nodePath:'lab/out/S33-fixture/old.f32'},weightsSHA256:sha(flat),
      encoder:inputDim===399?encoder.baseEncoderRef:{schema:'v1',ctxFill:'none',passEncoding:'legacy-phys10',encoderVersion:'gd-lab-schema-v1'},
      candidateSpecId:inputDim===399?'cand-suit-v3':'cand-dedup-v2',epsilon:0,tierSpecId:'none',tieBreakId:'first-candidate-v1'};
    const resolved=await policies.resolvePolicy(old.policyId,{...runtime,registry:{schemaVersion:'gd-model-index-v1',defaultPolicyRef:old.policyId,policies:[old]},readWeights:async()=>b});
    assert.deepEqual(resolved.createNetwork().getWeights(),flat);assert.equal(typeof resolved.createDecider,'function');
  }
  console.log(JSON.stringify({caseId,fixture:'synthetic-MLP-seed33',datasetEligible:false,realTraining:false,scorerReload:true,old385And399Load:true,dimensionMismatchRejected:true,optimizerResume:'pending Python finite checker',actualC1400:'not run'}));
}
