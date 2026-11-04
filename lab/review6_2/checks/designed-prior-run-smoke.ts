/** Pure settlement predicate only; no caller result is an admission proof. */
import assert from 'node:assert/strict';
import {digest} from '../task-schema.mjs';
import * as selector from '../offline-selection';
assert.deepEqual(process.argv.slice(2),['--case','source.designed-prior-run']);
assert.equal(typeof selector.isSettledDesignedPriorRun,'function');
const task={taskId:'old-label',runId:'old-label',budgetRef:'budget'},run:any={runId:task.runId,task,taskSHA256:digest(task),status:'failed',cleanupConfirmed:true,checkpoint:{active:null,executionUnknown:false,rows:[{requestCount:1}]}},state:any={tasks:{[task.taskId]:task.runId},budgets:{budget:{activeRunId:null,reservations:{used:{runId:task.runId,status:'consumed'}}}}};
assert.equal(selector.isSettledDesignedPriorRun(run,state),true,'known settled failed label still occupies used identity');
for(const change of [{status:'running'},{cleanupConfirmed:false},{executionUnknown:true},{observationStatus:'unknown'},{failureReason:'execution_uncertain'},{stopReason:'execution_uncertain'},{taskSHA256:'0'.repeat(64)},{checkpoint:{...run.checkpoint,active:{index:0}}},{checkpoint:{...run.checkpoint,executionUnknown:true}},{checkpoint:{...run.checkpoint,rows:[{requestCount:null}]}}])assert.equal(selector.isSettledDesignedPriorRun({...run,...change},state),false,JSON.stringify(change));
for(const status of ['reserved','reserved_unknown'])assert.equal(selector.isSettledDesignedPriorRun(run,{...state,budgets:{budget:{...state.budgets.budget,reservations:{busy:{runId:task.runId,status}}}}}),false);
assert.equal(selector.isSettledDesignedPriorRun(run,{...state,budgets:{budget:{...state.budgets.budget,activeRunId:task.runId}}}),false);
assert.equal(selector.isSettledDesignedPriorRun(run,{...state,tasks:{}}),false);
assert.equal(selector.isSettledDesignedPriorRun(run,{...state,budgets:{}}),false);
console.log('PASS designed prior-run pure settled predicate: known failed retained, active/unknown/unconfirmed/missing ledger rejected; no session, runtime or authority granted');
