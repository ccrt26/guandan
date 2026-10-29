import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeHumanFit} from './human-fit.mjs';
import {sha256File} from './runtime.mjs';
function fixture(){
 const repo=mkdtempSync(join(tmpdir(),'r6-h-approval-')),put=(name,value)=>{const path=join(repo,name);writeFileSync(path,JSON.stringify(value));return path;};
 const source=put('source.json',{}),contractPath=put('contract.json',{schemaVersion:'r6-H-fit-contract-v1',fitId:'same-fit',epochs:3,fits:1,trainerSHA256:sha256File(source),networkSourceSHA256:sha256File(source),manifestSHA256:sha256File(source)}),contractSHA256=sha256File(contractPath);
 const requestPath=put('request.json',{evidence:[{path:contractPath,sha256:contractSHA256}]}),requestSHA256=sha256File(requestPath);
 const reportPath=put('review.json',{reviewId:'same-review',role:'engineering',overallDecision:'APPROVE_H_FIT',requestSHA256,reviewedContractSHA256:'0'.repeat(64)});
 const preflightPath=put('preflight.json',{stageStatus:'preflight_passed',trainingUpdates:0,parametersUnchanged:true,heldoutModelScoresOpened:false,contractSHA256});
 const reviewAuthorizationPath=put('authorization.json',{contractSHA256,requestPath,requestSHA256,allP1P2Closed:true,reviews:[{path:reportPath,sha256:sha256File(reportPath),role:'engineering'},{path:reportPath,sha256:sha256File(reportPath),role:'method'}]});
 const config={repo,cycleId:'review6-humanlike-20261028',budget:{cycleActiveSeconds:259200,windowMaxSeconds:14400},handoff:{budgetLedgerPath:join(repo,'lab/review6/budget-ledger.jsonl')},runtime:{device:'intentionally-invalid',torchThreads:2,pythonAbsolutePath:'/invalid'},data:{humanFit:{contractPath,contractSHA256,preflightPath,preflightSHA256:sha256File(preflightPath),reviewAuthorizationPath,reviewAuthorizationSHA256:sha256File(reviewAuthorizationPath),frozenTrainer:source,frozenNetwork:source,featureManifest:source}}};
 return{config,put,reportPath,requestPath,requestSHA256,contractSHA256,reviewAuthorizationPath};
}
test('one stale report cannot authorize two independent H review roles',()=>{const f=fixture();assert.throws(()=>executeHumanFit(f.config),/distinct|duplicate/);});
test('distinct reports must bind their own role, request and actual fit contract',()=>{
 const f=fixture(),method=f.put('method.json',{reviewId:'method-review',role:'method',overallDecision:'APPROVE_H_FIT',requestSHA256:f.requestSHA256,reviewedContractSHA256:'0'.repeat(64)});
 const auth={contractSHA256:f.contractSHA256,requestPath:f.requestPath,requestSHA256:f.requestSHA256,allP1P2Closed:true,reviews:[{path:f.reportPath,sha256:sha256File(f.reportPath),role:'engineering'},{path:method,sha256:sha256File(method),role:'method'}]};
 const path=f.put('authorization2.json',auth);f.config.data.humanFit.reviewAuthorizationPath=path;f.config.data.humanFit.reviewAuthorizationSHA256=sha256File(path);
 assert.throws(()=>executeHumanFit(f.config),/review.*identity|review.*contract/);
});
import {mkdirSync} from 'node:fs';
import {initializeBudget,reserveBudget,settleBudget,writeNewJson} from './runtime.mjs';
import {verifyWorkerLaunch} from './human-fit.mjs';
function validSyntheticLaunch(){
 const f=fixture(),h=f.config.data.humanFit,out=join(f.config.repo,'lab/review6_1/data/H-fit-001'),source=h.frozenTrainer;
 mkdirSync(out,{recursive:true});mkdirSync(join(f.config.repo,'lab/review6'),{recursive:true});
 const contractPath=f.put('current-contract.json',{fitId:'synthetic-fit',outputDirectory:out,pythonAbsolutePath:process.execPath,trainerSHA256:sha256File(source),networkSourceSHA256:sha256File(source),manifestSHA256:sha256File(source),guardPath:source,guardSHA256:sha256File(source)}),contractSHA256=sha256File(contractPath);
 const requestPath=f.put('current-request.json',{evidence:[{path:contractPath,sha256:contractSHA256}]}),requestSHA256=sha256File(requestPath);
 const reviews=['engineering','method'].map(role=>{const path=f.put(role+'-current.json',{reviewId:role+'-review',role,overallDecision:'APPROVE_H_FIT',requestSHA256,reviewedContractSHA256:contractSHA256});return{role,path,sha256:sha256File(path)};});
 const reviewAuthorizationPath=f.put('current-auth.json',{contractSHA256,requestPath,requestSHA256,allP1P2Closed:true,reviews}),preflightPath=f.put('current-preflight.json',{stageStatus:'preflight_passed',trainingUpdates:0,parametersUnchanged:true,heldoutModelScoresOpened:false,contractSHA256,requiredReservationSeconds:300});
 Object.assign(h,{contractPath,contractSHA256,preflightPath,preflightSHA256:sha256File(preflightPath),reviewAuthorizationPath,reviewAuthorizationSHA256:sha256File(reviewAuthorizationPath),outputDirectory:out,frozenGuard:source});
 f.config.runtime={device:'cpu',torchThreads:2,pythonAbsolutePath:process.execPath};const configPath=f.put('current-config.json',f.config);
 const identity={cycleId:f.config.cycleId,fitId:'synthetic-fit',contractSHA256,outputDirectory:out};writeNewJson(join(f.config.repo,'lab/review6/H-fit.anchor.json'),identity);
 initializeBudget(f.config.handoff.budgetLedgerPath,f.config.cycleId,259200,0);reserveBudget(f.config.handoff.budgetLedgerPath,f.config.cycleId,'synthetic-job',300);
 const launchPath=join(out,'launch-1.json');writeNewJson(launchPath,{...identity,taskId:'synthetic-job',startedAt:new Date().toISOString(),parentPid:process.pid,configPath,configSHA256:sha256File(configPath)});
 return{...f,launchPath};
}
test('synthetic current distinct approvals and live original reservation authorize the fixed worker identity',()=>{const f=validSyntheticLaunch();const r=verifyWorkerLaunch(f.launchPath);assert.equal(r.stageStatus,'H_worker_launch_authorized');assert.equal(r.parentPid,process.pid);});
test('settled reservation cannot authorize a replay of a worker launch',()=>{const f=validSyntheticLaunch();settleBudget(f.config.handoff.budgetLedgerPath,f.config.cycleId,'synthetic-job',0);assert.throws(()=>verifyWorkerLaunch(f.launchPath),/live original budget/);});
