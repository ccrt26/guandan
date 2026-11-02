/** One finite synthetic cost-accounting case. No games, model, provider or learner. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {allocationFixture} from './first-round-budget-fixture.mjs';
import {FixedHostFiles} from '../ohuo-host-files.ts';
import {canonical,digest} from '../task-schema.mjs';
import {firstRoundAllocationSeconds,firstRoundAllocationPath} from '../first-round-budget.mjs';

const caseId='training.first-round-budget-cost-terminal';
assert.deepEqual(process.argv.slice(2),['--case',caseId]);
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const write=(path,value)=>writeFileSync(path,canonical(value));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const f=await allocationFixture(),proof=await f.host.readFirstRoundPilotProduction();
const state=structuredClone(f.state),run=state.runs.glm,cp=run.checkpoint;
const first=read(cp.rows[0].resultRef.path);
// A longer completed response fails the wire shape check. Longer cancellation
// and transport failure are still consumed facts, but not completed-cost samples.
const remotes=[
 {status:'selected',requestCount:1,attempts:[{requestCount:1,elapsedMs:4000}]},
 {status:'remote_failure',reason:'invalid_response_shape',requestCount:1,elapsedMs:9001,attempts:[{requestCount:1,httpStatus:200,elapsedMs:9000}]},
 {status:'cancelled',reason:'cancelled',requestCount:1,attempts:[{requestCount:1,httpStatus:200,elapsedMs:100000}]},
 {status:'remote_failure',reason:'transport_failed',requestCount:1,attempts:[{requestCount:1,httpStatus:200,elapsedMs:200000}]},
];
cp.rows=remotes.map((remote,i)=>{
 const terminal={...first,key:{id:'glm-'+i},inputSHA256:String(i+1).repeat(64),status:remote.status,remote};
 const path=join(run.task.outputRoot,'labels','q'+i+'.json');write(path,terminal);
 return {key:terminal.key,inputSHA256:terminal.inputSHA256,status:terminal.status,resultRef:{path,sha256:sha(readFileSync(path))}};
});
cp.cursor=cp.rows.length;run.checkpointSHA256=digest(cp);run.checkpointRef=join(run.task.outputRoot,'checkpoint-'+digest(cp)+'.json');write(run.checkpointRef,cp);
state.budgets[f.budgetRef].elapsedSeconds+=313-run.elapsedSeconds;run.elapsedSeconds=313;
state.budgets[f.budgetRef].reservations.glm.cost.providerRequests=4;state.budgets[f.budgetRef].used.providerRequests+=3;
write(f.statePath,state);
const expected=firstRoundAllocationSeconds({match:2,branch:3,glm:9,ds:5,step:.5});
const request={...f.request,controlStateRef:f.ev('cost-terminal-pre-state',state)},requestRef=f.ref('cost-terminal-request',request);
f.grant.limits={...f.limits,maxRunSeconds:expected.maxRunSeconds};
write(join(f.repo,'grant.json'),f.grant);f.refresh();
const hostPath=join(f.repo,'deliverables/ohuo-runtime/host.json'),manifest=read(hostPath);
manifest.grantFile.sha256=sha(readFileSync(join(f.repo,manifest.grantFile.path)));write(hostPath,manifest);
const host=new FixedHostFiles(f.repo);
// The original fixture's simulated trusted producer proof is reused explicitly;
// this case does not claim to regenerate source selection or research matches.
host.readFirstRoundPilotProduction=async()=>{for(const r of Object.values(state.runs))await host.checkAuthorization(r.task);return structuredClone(proof);};
const before=readFileSync(f.statePath),baseline=canonical(f.refs.get(f.budgetRef));
const unknown=structuredClone(state);unknown.budgets[f.budgetRef].reservations.glm.status='reserved_unknown';write(f.statePath,unknown);
const unknownBytes=readFileSync(f.statePath);
await assert.rejects(host.freezeFirstRoundBudget(requestRef),/occupancy must be reconciled/);
assert.deepEqual(readFileSync(f.statePath),unknownBytes);assert(!existsSync(firstRoundAllocationPath(f.root)));
writeFileSync(f.statePath,before);
const result=await host.freezeFirstRoundBudget(requestRef);
assert.equal(result.status,'allocated');assert.equal(result.receipt.costs.glm,9);
assert.equal(result.receipt.effectiveLimits.maxRunSeconds,expected.maxRunSeconds);
assert.deepEqual(result.receipt.stageSeconds,expected.stages);
assert.equal(result.receipt.evidence.labelTerminals.length,5);
const after=read(f.statePath);delete after.budgets[f.budgetRef].firstRoundAllocation;
assert.deepEqual(after,state);assert.equal(canonical(f.refs.get(f.budgetRef)),baseline);
assert.equal(after.budgets[f.budgetRef].limits.maxRunSeconds,3600);
assert.equal(after.budgets[f.budgetRef].used.providerRequests,5);
assert.equal(after.budgets[f.budgetRef].elapsedSeconds,353);
console.log(JSON.stringify({case:caseId,status:'PASS',completedFailureMaxSeconds:9,selectedSeconds:4,attemptClockPreserved:true,cancelledAndTransportExcluded:true,unknownNoDurableWrite:true,baselineAndAllConsumptionPreserved:true,fullMaxRunSeconds:expected.maxRunSeconds,sourceProductionProof:'simulated trusted output; original fixture unchanged',realAPI:false,actualMatches:0,optimizerSteps:0}));
