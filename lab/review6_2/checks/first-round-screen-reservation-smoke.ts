/** One affected reservation boundary. No branches, weights, provider or matches. */
import assert from 'node:assert/strict';
import {executeChargedFirstRoundBranch} from '../first-round-screen-consumer';
import {FixedHostFiles} from '../ohuo-host-files';
import {digest,referenceOf} from '../task-schema.mjs';
export async function checkScreenReservationKey(){
 const worldId='pilot-r1-g2-s0-B-prime-g1-m51-q51:ohuo-v530-r1-pilot-screen:0000';
 const actionId='a003',rootCursor=4,attemptCount=0;
 const plan={worlds:[{worldId,seed:2271273631}],actions:[{actionId}]},before=structuredClone(plan);
 async function once(executionId:string,world=worldId){
  const cp:any={rootCursor,attempts:[],active:null};let key='',settled=0,saved=0;
  const ctx={executionId,signal:{aborted:true},reserve:async(k:string,c:any)=>{
   assert.match(k,/^[-a-zA-Z0-9_]{1,100}$/,'same original task-control reservation-key contract');
   assert.deepEqual(c,{providerRequests:0,optimizerSteps:0,matchAttempts:1,labelDecisions:0});key=k;return 'synthetic:'+k;
  },settleReservation:async(r:string,outcome:any)=>{assert.equal(r,'synthetic:'+key);assert.deepEqual(outcome,{disposition:'not_sent',evidence:{kind:'confirmed_not_sent'}});settled++;}};
  const row=await executeChargedFirstRoundBranch({ctx,cp,save:async()=>{saved++;},root:{},plan,continuation:{},worldId:world,actionId});
  assert.equal(key,'screen-'+digest({rootCursor,worldId:world,actionId,attemptCount,executionId}));
  assert.equal(key.length,71);assert.equal(row,null);assert.equal(settled,1);assert.equal(saved,0);
  assert.deepEqual(cp,{rootCursor,attempts:[],active:null});assert.deepEqual(plan,before);return key;
 }
 const a=await once('execution-1');assert.equal(a,await once('execution-1'));
 assert.notEqual(a,await once('execution-2'));assert.notEqual(a,await once('execution-1',worldId.replace(':0000',':0001')));
 // The actual H screen-history method distinguishes frozen plans from work.
 // Original upstream Task lineage/authorization/TC science gates are unchanged,
 // not mocked as proof of their execution by this direct boundary fixture.
 const host:any=Object.create(FixedHostFiles.prototype);host.selectionContexts=new WeakSet();
 const selection={rows:[{key:{id:'q4'},split:'train',familyId:'family'}]},selectionRef=referenceOf('selection',selection),comparisonRef=referenceOf('comparison',{}),cap={id:'B07.offline-label.v1',kind:'collect',mode:'research'},capRef=referenceOf('cap',cap);
 const contract={schema:'ohuo-first-round-screen-contract-v1',comparisonRef,selectionRef,registryRef:{id:'registry',sha256:'1'.repeat(64)},reviewerRef:referenceOf('reviewer',{}),roots:[],maxBranchStarts:12},contractRef=referenceOf('screen',contract);
 const old:any={taskId:'screen',runId:'screen',planRef:'plan',budgetRef:'budget',researchBatchId:'batch',authorizationRef:'auth',parentPolicyRef:'parent',datasetRefs:[selectionRef],scientificContract:{decisionRuleRef:contractRef,comparisonRef},operationScope:{apiCalls:false,parameterUpdates:false},limits:{maxProviderRequests:0,maxLabelDecisions:0,maxOptimizerSteps:0,maxMatchAttempts:12},sourcePlan:{split:'train',familyIds:['family']},capabilityRef:capRef};
 const retry={...old,taskId:'screen-retry',runId:'screen-retry',parentTaskId:old.taskId},cp:any={schema:'ohuo-first-round-screen-run-v1',selectionRef,contractRef,plans:[{rootIndex:4,status:'pending',plan,screen:null}],attempts:[],active:null,executionUnknown:false};
 const run:any={runId:old.runId,task:old,taskSHA256:digest(old),taskRef:referenceOf('old-task',old),status:'failed',failureReason:'invalid_reservation',cleanupConfirmed:true,checkpoint:cp};
 const state:any={tasks:{screen:'screen'},runs:{screen:run},budgets:{budget:{activeRunId:null,reservations:{}}}},context={selectionRef,selection,spec:{actingReleaseRef:'parent'},screenContracts:[{ref:contractRef,value:contract}],capabilities:[{ref:capRef,value:cap}]};host.selectionContexts.add(context);
 assert.equal(host.checkFirstRoundScreenAdmission(retry,state,context,contract),true,'frozen plans with zero attempts and occupancy are not executed branches');
 cp.attempts=[{}];assert.throws(()=>host.checkFirstRoundScreenAdmission(retry,state,context,contract),(e:any)=>e.reason==='selection_owned_rows_already_screened');cp.attempts=[];
 state.budgets.budget.reservations.sent={runId:'screen',status:'consumed',cost:{matchAttempts:1}};assert.throws(()=>host.checkFirstRoundScreenAdmission(retry,state,context,contract),(e:any)=>e.reason==='selection_owned_rows_already_screened');delete state.budgets.budget.reservations.sent;
 cp.executionUnknown=true;assert.throws(()=>host.checkFirstRoundScreenAdmission(retry,state,context,contract),(e:any)=>e.reason==='selection_execution_uncertain');cp.executionUnknown=false;
 assert.deepEqual(plan,before);
 return {case:'screen-reservation-key',actualColonWorldIdAccepted:true,stableBoundedKey:true,executionAndWorldIdentityRetained:true,originalPlanUnchanged:true,confirmedNotSent:true,plansOnlyNotExecuted:true,priorAttemptOrOccupancyRejected:true,unknownStillRejected:true,branchAttempts:0,providerRequests:0,matches:0,optimizerSteps:0};
}
if(process.argv[1]?.endsWith('first-round-screen-reservation-smoke.ts'))console.log(JSON.stringify(await checkScreenReservationKey()));
