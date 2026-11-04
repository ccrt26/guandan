import assert from 'node:assert/strict';
let module;
try { module = await import('../screen-revalidation.mjs'); } catch (e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }
assert(module, 'named screen-revalidation implementation must exist');
const {compareScreenRevalidationResults,assertScreenRevalidationTask,screenRevalidationStatePath}=module;
assert.throws(()=>screenRevalidationStatePath({controlRoot:'/original',phase:'dataset',screenRevalidation:{task:{}}}),/revalidation_context/);
assert.throws(()=>screenRevalidationStatePath({controlRoot:'/original',phase:'freeze',screenRevalidation:{}}),/revalidation_scope/);
const task={taskId:'r1-data-screen-train-round-2',runId:'r1-data-screen-train-round-2',taskKind:'collect',operationScope:{localExecution:true,apiCalls:false,parameterUpdates:false,deployment:false},limits:{mode:'input-derived-workload-v1',maxProviderRequests:0,maxLabelDecisions:0,maxOptimizerSteps:0,maxMatchAttempts:24}};
assert.doesNotThrow(()=>assertScreenRevalidationTask(task));
assert.throws(()=>assertScreenRevalidationTask({...task,operationScope:{...task.operationScope,apiCalls:true}}));
assert.throws(()=>assertScreenRevalidationTask({...task,taskId:'another-task'}));
const base={schema:'ohuo-first-round-screen-summary-v1',taskSHA256:'task',selectionRef:'selection',contractRef:'contract',rootCursor:3,total:3,active:null,executionUnknown:false,plans:[{rootIndex:0,status:'provisional_screened',plan:{worlds:[{worldId:'w'}]},screen:{status:'provisional_screened'}}],attempts:Array.from({length:24},(_,i)=>({rootIndex:i%3,reservation:'historical-'+i,row:{worldId:'world-'+i,actionId:'a1',result:{complete:true,Y:i%2,gPlusW:i%3,activeSeconds:2}}}))};
const actual=structuredClone(base);actual.attempts.forEach(a=>{a.reservation='engineering';a.row.result.activeSeconds=1;});
assert.equal(compareScreenRevalidationResults(base,actual).equal,true);
actual.attempts[1].row.result.Y=19;assert.equal(compareScreenRevalidationResults(base,actual).equal,false);
actual.attempts.pop();assert.throws(()=>compareScreenRevalidationResults(base,actual),/24/);
console.log(JSON.stringify({status:'passed',scope:'contract unit smoke only, no full24 execution',cases:['scope restrictions','canonical result equality','mismatch retained','missing branch rejection']}));
