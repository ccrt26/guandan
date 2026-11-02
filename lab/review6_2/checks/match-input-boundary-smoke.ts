/** Finite original-runner boundary check: zero actions, no model/API/full match.
 * Worker/consumer forwarding is independently source-reviewed, not executed here. */
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_RULES} from '@gd/engine';
import {runCompleteMatch} from '../../review6/match-play';
import {runCompleteMatchAsync} from '../match-play-async';
import {createMatchStore} from '../match-record';
import {referenceOf} from '../task-schema.mjs';
const policies=Array.from({length:4},(_,seat)=>({policyId:`fixture-seat-${seat}`,kind:'heuristic' as const}));
let decisions=0;
const driver=(spec:any)=>({policyId:spec.policyId,newGame(){},observe(){},decide(){decisions++;throw Error('fixture must not execute a decision');}});
const sync={seed:1,policies,seatFactory:driver,maxGames:1,maxMovesPerGame:0};
const expired=runCompleteMatch({...sync,deadlineMonotonicMs:-1});
assert.equal(expired.decisions,0);assert.equal(expired.games,0);assert.equal(expired.incompleteReason,'deadline');
const noDeadline=runCompleteMatch(sync);
assert.equal(noDeadline.decisions,0);assert.equal(noDeadline.games,1);assert.equal(noDeadline.incompleteReason,'round_move_cap');
const base=fileURLToPath(new URL('../../out/',import.meta.url));mkdirSync(base,{recursive:true});
const root=mkdtempSync(join(base,'R11-match-boundary-')),fixed=referenceOf('fixture',{}),boundary={mode:'input-workload-only' as const,resourcePolicyRef:fixed};
let entered=0;
function options(id:string,signal:AbortSignal){
 const identity={runId:`fixture-${id}`,matchId:`fixture-${id}`,sourceRef:fixed,layoutRef:fixed,policyIds:policies.map(p=>p.policyId),rules:structuredClone(DEFAULT_RULES),sourceFamilyId:'fixture-family',split:'fixture',evaluatedActor:0};
 const directory=join(root,id);mkdirSync(directory);
 const store=createMatchStore(directory,identity as any);
 return{...identity,generation:`fixture-${id}`,seed:1,dealNamespace:'fixture-input-boundary',maxGames:2,maxMovesPerGame:1,actor:0,signal,recorder:store.recorder,
  seats:policies.map((p,seat)=>({policyId:p.policyId,source:'B' as const,mode:'local' as const,decider:{seat,...driver(p)}})),
  beforeGame:()=>{entered++;throw Error('fixture-before-game-stop');}};
}
// The real async loop reaches its existing beforeGame callback without a timer;
// the sentinel stops before recorder.beginGame/any action, not a research run.
await assert.rejects(runCompleteMatchAsync({...options('input',new AbortController().signal),executionBoundary:boundary}),/fixture-before-game-stop/);
assert.equal(entered,1);
const old=await runCompleteMatchAsync({...options('legacy',new AbortController().signal),deadlineMonotonicMs:-1});
assert.equal(old.decisions,0);assert.equal(entered,1,'legacy expired deadline must stop before a new game');
const abort=new AbortController();abort.abort('fixture-user-stop');
const stopped=await runCompleteMatchAsync({...options('aborted',abort.signal),executionBoundary:boundary});
assert.equal(stopped.decisions,0);assert.equal(entered,1,'explicit revised mode must preserve user abort');
await assert.rejects(runCompleteMatchAsync({...options('conflict',new AbortController().signal),executionBoundary:boundary,deadlineMonotonicMs:NaN}),/artificial deadline/);
assert.equal(decisions,0);
console.log(JSON.stringify({caseId:'training.match-input-boundary',status:'passed',realAPI:false,realModel:false,realTraining:false,actions:0,completeMatches:0,syncOriginalOptionalDeadline:true,asyncExplicitBoundary:true,legacyExpiredBeforeGame:true,abortBeforeGame:true,workerExecuted:false,consumerExecuted:false}));
