import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {DEFAULT_RULES} from '@gd/engine';

// Only the worker initialization glue runs. Policy loading, a complete match,
// worker-thread messaging and record files are replaced at their boundaries.
const f=vi.hoisted(()=>({job:null as any,resolve:vi.fn(),run:vi.fn(),post:vi.fn(),close:vi.fn(),finish:vi.fn(),deciders:[] as any[]}));
vi.mock('node:worker_threads',()=>({isMainThread:false,parentPort:{postMessage:f.post,close:f.close},get workerData(){return f.job;}}));
vi.mock('../review6_2/policy-loader',()=>({resolveNodePolicy:f.resolve}));
vi.mock('../review6/match-play',()=>({runCompleteMatch:f.run}));
vi.mock('../review6_2/match-record',()=>({createMatchStore:()=>({recorder:{finish:f.finish},ref:()=>({directory:'fixture-only',identitySHA256:'fixture',journalBytes:0,journalSHA256:'fixture'})}),captureInitialCandidateInputs:()=>{throw Error('fixture must not capture');},publicMatchOutcome:(value:any)=>value}));
const priorExitCode=process.exitCode;
const importWorker=()=>import('../review6_2/match-local-worker');
function job(){return {row:{seats:[0,1,2,3].map(()=>({mode:'local'})),seed:1,actor:0,dealNamespace:'fixture',maxGames:1,maxMovesPerGame:1},identity:{rules:{...DEFAULT_RULES}},policyRefs:['A','A','B','A'],policyIdentities:['A','A','B','A'].map(policyId=>({policyId})),policyRepositoryRoot:'/fixture-only',outputRoot:'/fixture-only',executionBoundary:{mode:'input-workload-only',resourcePolicyRef:'fixture-resource@sha256:'+'0'.repeat(64)}};}
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();f.deciders.length=0;f.job=job();
 f.resolve.mockImplementation(async(ref:string,root:string)=>{if(root!=='/fixture-only')throw Error('wrong fixture root');return {identity:{policyId:ref},createDecider:(seat:number)=>{const decider={ref,seat};f.deciders.push(decider);return decider;}};});
 f.run.mockImplementation((options:any)=>{options.policies.forEach((spec:any,seat:number)=>options.seatFactory(spec,seat));return {complete:false,winner:null,incompleteReason:'fixture_no_match'};});
});
afterEach(()=>{process.exitCode=priorExitCode;});

describe('one-job local worker policy loading',()=>{
 it('resolves each distinct ref once while constructing all four independent seats',async()=>{
  await importWorker();
  expect(f.resolve.mock.calls).toEqual([['A','/fixture-only'],['B','/fixture-only']]);
  expect(f.deciders.map(d=>[d.ref,d.seat])).toEqual([['A',0],['A',1],['B',2],['A',3]]);
  expect(new Set(f.deciders).size).toBe(4);expect(f.run).toHaveBeenCalledTimes(1);
  expect(f.post).toHaveBeenCalledWith(expect.objectContaining({kind:'result'}));expect(f.close).toHaveBeenCalledTimes(1);
 });
 it('starts a fresh cache for the next worker initialization',async()=>{
  await importWorker();vi.resetModules();await importWorker();
  expect(f.resolve.mock.calls).toEqual([['A','/fixture-only'],['B','/fixture-only'],['A','/fixture-only'],['B','/fixture-only']]);
  expect(f.deciders).toHaveLength(8);
 });
 it('still rejects a mismatched identity in any repeated-ref seat before a match',async()=>{
  f.job.policyIdentities[3]={policyId:'unexpected'};await importWorker();
  expect(f.run).not.toHaveBeenCalled();expect(f.deciders).toHaveLength(0);
  expect(f.post).toHaveBeenCalledWith({kind:'failure',reason:'worker loaded different policy'});
 });
 it('propagates a shared load failure without retries or match execution',async()=>{
  f.resolve.mockImplementation(async(ref:string)=>{throw Error('fixture rejected '+ref);});await importWorker();
  expect(f.resolve.mock.calls).toEqual([['A','/fixture-only'],['B','/fixture-only']]);
  expect(f.run).not.toHaveBeenCalled();expect(f.post).toHaveBeenCalledTimes(1);
  expect(f.post).toHaveBeenCalledWith({kind:'failure',reason:'fixture rejected A'});
 });
});
