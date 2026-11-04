import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../review6_2/task-schema.mjs',async original=>{const actual=await original<typeof import('../review6_2/task-schema.mjs')>();return {...actual,strictObject:vi.fn(actual.strictObject)};});
vi.mock('../review6_2/offline-label-source',async original=>{const actual=await original<typeof import('../review6_2/offline-label-source')>();return {...actual,readOfflineSnapshots:vi.fn(),readOfflineSnapshot:vi.fn()};});
import {mkdtempSync,realpathSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DEFAULT_RULES} from '@gd/engine';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {LEGACY_CANDIDATE_SPEC} from '../../packages/ai/src/candidate-spec';
import {strictObject} from '../review6_2/task-schema.mjs';
import {readOfflineSnapshot,readOfflineSnapshots} from '../review6_2/offline-label-source';
import {createOfflineLabelConsumer} from '../review6_2/offline-label-consumer';

// Exercise the real prepare handler and guards. Only its offline source reader
// is a finite fixture; neither a source pool nor an upstream provider is run.
function fixture(){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'v542-prepare-')),sourceIndexPath=join(root,'index.json'),bytes=JSON.stringify({version:1,families:{family:{split:'train'}}});writeFileSync(sourceIndexPath,bytes);
 const identity={policyId:'synthetic-B',inputDim:399},b=RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1')!,h=RELEASES.find(r=>r.releaseRef==='ohuo-1030-h-v1')!,profileRef={profileId:'synthetic',revision:1,snapshotHash:'a'.repeat(64)};
 const rows=[2,0,1].map(moveNo=>({recordRef:{directory:join(root,'matches/m'),identitySHA256:'1'.repeat(64),journalBytes:0,journalSHA256:'2'.repeat(64)},recordRoot:root,key:{controllerOrRunnerGeneration:'fixture',matchId:'m',gameNo:1,moveNo,actorSeat:0,requestSeq:moveNo},inputSHA256:'3'.repeat(64),familyId:'family',split:'train',actorSeat:0}));
 const snapshots=new Map(rows.map(row=>[row,{row,record:{sourceRef:'index',layoutRef:'queue',rules:DEFAULT_RULES,seatSnapshots:[{policyIdentity:identity}]},decision:{policyId:identity.policyId,actualSource:'B'},input:{policyId:identity.policyId,candidateInputs:{policyId:identity.policyId,policyIdentity:identity,candidateIds:['a001','a002']}},bundle:{candidateSpec:LEGACY_CANDIDATE_SPEC,initialCandidateIds:['a001','a002'],isUniqueLegalAction:false}}]));
 const single=vi.mocked(readOfflineSnapshot),batch=vi.mocked(readOfflineSnapshots);single.mockReset();batch.mockReset();single.mockImplementation(row=>snapshots.get(row as any) as any);batch.mockImplementation(items=>items.map(row=>snapshots.get(row as any) as any));
 const selection={schema:'ohuo-offline-label-selection-v1',sourceIndexRef:'index',queueRef:'queue',purpose:'b_training_source',selectedCount:rows.length,quotas:[{familyId:'family',count:rows.length}],rows};
 const refs=new Map<string,any>([['selection',selection],['index',{schema:'ohuo-source-index-ref-v1',namespace:'fixture',fileSHA256:createHash('sha256').update(bytes).digest('hex')}],['queue',{schema:'ohuo-complete-match-queue-v1',namespace:'fixture',sourceIndexRef:'index',rows:[{matchId:'m',actor:0,split:'train',roundFamilyIds:['family']}]}],['base',{schema:'ohuo-release-ref-v1',release:b,policyIdentity:identity}],['teacher-release',{schema:'ohuo-release-ref-v1',release:h,policyIdentity:identity}],['teacher',{schema:'ohuo-offline-teacher-ref-v1',releaseRef:'teacher-release',profileRevisionRef:profileRef}],['prompt',{schema:'ohuo-prompt-ref-v1',promptRef:h.promptRef}],['rules',DEFAULT_RULES]]);
 const task={taskKind:'collect',operationScope:{apiCalls:false},datasetRefs:['selection'],limits:{maxOptimizerSteps:0,maxMatchAttempts:0,maxLabelDecisions:3},scientificContract:{decisionRuleRef:'fixed',analysisMethodRef:'fixed'},sourcePlan:{sourceIndexRef:'index',namespace:'fixture',familyIds:['family'],split:'train'},seatLayoutPlan:'queue',rulesRef:'rules',parentPolicyRef:'base',labelPolicyRef:'teacher',releaseRefs:['base','teacher-release'],promptRef:'prompt'};
 const fetchImpl=vi.fn(async()=>{throw Error('prepare must never fetch');}),profileStore={resolve:()=>({profileId:'synthetic',revision:1,credentialRevision:1,protocol:'openai-chat-completions',requestedModel:'fixture',baseUrl:'https://fixture.invalid/v1',secret:'synthetic-not-a-credential',requestOptions:{}})},consumer=createOfflineLabelConsumer({profileStore,mode:'offline_synthetic',fetchImpl});
 vi.mocked(strictObject).mockClear();const args={task,refs,inputs:{sourceIndexPath,confirmedRecordRoots:[root]}};
 return {root,rows,snapshots,single,batch,fetchImpl,args,prepare:()=>consumer.prepare(args),guards:()=>vi.mocked(strictObject).mock.calls.filter(call=>call[1]==='selected decision').map(call=>call[0])};
}
afterEach(()=>vi.restoreAllMocks());
it('real prepare guards each successful natural row once and preserves the request order',async()=>{
 const f=fixture(),result=await f.prepare();expect(f.guards()).toEqual(f.rows);expect(result.snapshots.map(s=>s.row.key.moveNo)).toEqual([2,0,1]);expect(f.batch).toHaveBeenCalledTimes(1);expect(f.single).not.toHaveBeenCalled();expect(f.fetchImpl).not.toHaveBeenCalled();
 // A later invocation cannot inherit this prepare's successful guard marker.
 f.rows[0].familyId='wrong';await expect(f.prepare()).rejects.toThrow('selection duplicate/root/family/split differs');
});
it.each(['duplicate','root','family','split'] as const)('real prepare retains %s rejection',async kind=>{
 const f=fixture();if(kind==='duplicate')f.rows[1].key={...f.rows[0].key};if(kind==='root')f.rows[0].recordRoot=mkdtempSync(join(realpathSync(tmpdir()),'v542-untrusted-root-'));if(kind==='family')f.rows[0].familyId='wrong';if(kind==='split')f.rows[0].split='dev';
 await expect(f.prepare()).rejects.toThrow('selection duplicate/root/family/split differs');expect(f.batch).not.toHaveBeenCalled();expect(f.fetchImpl).not.toHaveBeenCalled();
});
it('real prepare preserves the first row failure when a later guard also fails',async()=>{
 const f=fixture();f.snapshots.get(f.rows[0])!.input.candidateInputs.policyIdentity={policyId:'wrong',inputDim:399};f.rows[1].familyId='wrong';
 await expect(f.prepare()).rejects.toThrow('original proposal capture identity differs');expect(f.guards()).toEqual([f.rows[0],f.rows[1],f.rows[0]]);expect(f.single).toHaveBeenCalledTimes(1);expect(f.batch).not.toHaveBeenCalled();
});
it('real prepare repeats original row guards after a partially successful batch fails',async()=>{
 const f=fixture(),partial:any[]=[];f.batch.mockImplementation(rows=>{partial.push(f.snapshots.get(rows[0] as any));throw Error('synthetic later batch failure');});
 const result=await f.prepare();expect(partial).toHaveLength(1);expect(f.guards()).toEqual([...f.rows,...f.rows]);expect(f.single.mock.calls.map(call=>call[0])).toEqual(f.rows);expect(result.snapshots.map(s=>s.row.key.moveNo)).toEqual([2,0,1]);expect(f.fetchImpl).not.toHaveBeenCalled();
});
