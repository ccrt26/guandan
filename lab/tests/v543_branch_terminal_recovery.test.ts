import {expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {digest} from '../review6_2/task-schema.mjs';
vi.mock('../review6_2/first-round-parent',()=>({resolveFirstRoundParent:async()=>({})}));
vi.mock('../review6_2/policy-loader',()=>({POLICY_REPOSITORY_ROOT:'unused',resolveNodePolicy:async()=>({identity:{policyId:'fixture'}})}));
vi.mock('../review6_2/first-round-screen-runtime',async original=>{
 const actual=await original<typeof import('../review6_2/first-round-screen-runtime')>();
 return {...actual,firstRoundContinuation:()=>({}),freezeFirstRoundScreenPlan:({snapshot}:any)=>snapshot.frozen,executeFirstRoundScreenBranch:()=>{throw Error('must not restart an attempted branch');}};
});
import {runFirstRoundScreen} from '../review6_2/first-round-screen-consumer';
import {runFirstRoundNewTest} from '../review6_2/first-round-evaluation-consumer';

function fixture(kind:'screen'|'evaluation',commonView=true){
 const h='a'.repeat(64),fixed='fixture@sha256:'+h,worlds=commonView?[{worldId:'w',seed:1}]:[1,2,3,4].map(seed=>({worldId:seed===1?'w':'w'+seed,seed})),comparisonBatch={schema:'ohuo-common-view-world-batch-r2',protocolRef:fixed,batchId:'batch',precisionTarget:'fixture only',worlds};
 const actions=[{actionId:'a',canonicalId:'pass',direction:'pass'},{actionId:'b',canonicalId:'single',direction:'takeover'}];
 const plan:any={schema:kind==='screen'?'ohuo-first-round-screen-plan-v1':'ohuo-first-round-new-root-v1',questionId:'q0',familyId:'family',inputSHA256:h,featuresSHA256:h,sourceRowSHA256:h,s0Ref:fixed,s1Ref:'s1@sha256:'+h,s0ActionId:'a',s1ActionId:'b',proposalActionId:'a',actions,worlds,...(commonView?{comparisonBatch}:{}),profileSHA256:h,policyIds:['p0','p1','p2','p3']};
 const questions=[0,1].map(i=>({questionId:'q'+i,familyId:'family',inputSHA256:h,featuresSHA256:h,sourceRowSHA256:h}));
 const contract:any={schema:commonView?'ohuo-common-view-new-test-contract-r2':'ohuo-first-round-new-test-contract-v1',maxBranchStarts:8,purpose:'engineering_fixture',protocolRef:fixed,selectionRef:fixed,comparisonRef:fixed,sourceIndexRef:fixed,s0Ref:fixed,s1Ref:plan.s1Ref,familyIds:['family'],questionIds:['q0','q1'],questions};
 const task:any={outputRoot:mkdtempSync(join(tmpdir(),'v543-branch-')),taskKind:'evaluate',operationScope:{localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false},limits:{maxProviderRequests:0,maxOptimizerSteps:0,maxLabelDecisions:0,maxMatchAttempts:8},sourcePlan:{sourceIndexRef:fixed,familyIds:['family'],split:'fixture'},datasetRefs:[fixed],scientificContract:{analysisMethodRef:fixed,decisionRuleRef:fixed,comparisonRef:fixed},parentPolicyRef:fixed,releaseRefs:[fixed,plan.s1Ref]};
 mkdirSync(task.outputRoot,{recursive:true});
 const row={worldId:'w',actionId:'a',result:{complete:false,incompleteReason:'match_game_cap',W:null,y:null,g:null,seed:1,forcedActionId:'a',profileSHA256:h,policyIds:plan.policyIds,initialWorldSHA256:h,ownPlanSummary:null}};
 const frozen={plan,planSHA256:digest(plan)},checkpoint:any={schema:kind==='screen'?'ohuo-first-round-screen-run-v1':'ohuo-first-round-new-test-run-v1',taskSHA256:digest(task),selectionRef:fixed,contractRef:fixed,rootCursor:0,plans:[{rootIndex:0,status:'incomplete',plan,planSHA256:digest(plan),readout:null,screen:null}],attempts:[{rootIndex:0,reservation:'owned-settled-reservation',row}],active:null,executionUnknown:false};
 const root={decision:'admitted',snapshot:{row:{actorSeat:0},frozen},terminal:{remote:{actionId:'a'}},worlds};
 let saved:any=checkpoint,starts=0,prepared=0;const abort=new AbortController();
 const ctx:any={task,checkpoint,checkpointSequence:1,executionId:'fixture',signal:abort.signal,deadlineMonotonicMs:performance.now()+60000,executionBoundary:{mode:'input-workload-only',resourcePolicyRef:fixed},saveCheckpoint:async(c:any)=>{saved=structuredClone(c);},reserve:async()=>{starts++;throw Error('must not reserve again');},getConsumption:()=>({confirmed:{matchAttempts:1}}),executionInputs:kind==='screen'?{commonView,contract,comparison:{proposer:{release:{proposalPolicyRef:fixed},policyIdentity:{policyId:'fixture'}}},roots:[root,{...root}]}:{mode:'offline_synthetic',contract,prepareRoot:async()=>{prepared++;return frozen;}}};
 return {ctx,abort,run:()=>kind==='screen'?runFirstRoundScreen(ctx):runFirstRoundNewTest(ctx),saved:()=>saved,starts:()=>starts,prepared:()=>prepared};
}
// Removing the terminal-failure branch would resolve as run_boundary forever.
it.each(['screen','evaluation'] as const)('%s preserves a known incomplete and terminates repeated recovery without starting the later question',async kind=>{
 const f=fixture(kind);
 for(let i=0;i<2;i++){await expect(f.run()).rejects.toThrow(/known_incomplete/);f.ctx.checkpoint=f.saved();}
 expect(f.saved().rootCursor).toBe(0);expect(f.saved().attempts).toHaveLength(1);expect(f.saved().executionUnknown).toBe(false);expect(f.starts()).toBe(0);expect(f.saved().plans[0].status).toBe('incomplete');
});
it.each(['screen','evaluation'] as const)('%s does not relabel an unknown checkpoint as a known failure',async kind=>{
 const f=fixture(kind);f.ctx.checkpoint.executionUnknown=true;
 await expect(f.run()).rejects.toThrow(/execution_uncertain/);expect(f.saved().executionUnknown).toBe(true);expect(f.starts()).toBe(0);
});
it.each(['screen','evaluation'] as const)('%s preserves user stop instead of excluding the failed question',async kind=>{
 const f=fixture(kind);f.abort.abort('user_stop');const result=await f.run();
 expect(result.completed).toBe(false);expect(result.stopReason).toBe('user_stop');expect(f.saved().rootCursor).toBe(0);expect(f.starts()).toBe(0);
});

it.each(['screen','evaluation'] as const)('%s does not restart a known incomplete legacy branch',async kind=>{
 const f=fixture(kind,false);await expect(f.run()).rejects.toThrow(/known_incomplete/);
 expect(f.saved().rootCursor).toBe(0);expect(f.saved().attempts).toHaveLength(1);expect(f.saved().executionUnknown).toBe(false);expect(f.starts()).toBe(0);
});
