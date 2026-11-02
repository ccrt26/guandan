/** One bounded synthetic metadata/readout fixture, no engine/model/API/game. */
import assert from 'node:assert/strict';
import {screenFirstRoundBranches} from '../first-round-screen.mjs';
const protocolRef='fixture-r2@sha256:'+'1'.repeat(64),worlds=Array.from({length:5},(_,i)=>({worldId:'batch-independent-'+i,seed:i+1}));
const actions=[{actionId:'pass',canonicalId:'pass'},{actionId:'take',canonicalId:'take'}],profileSHA256='2'.repeat(64),policyIds=['actor','partner','left','right'];
const results=worlds.flatMap(w=>actions.map((a,i)=>({worldId:w.worldId,actionId:a.actionId,result:{seed:w.seed,forcedActionId:a.actionId,profileSHA256,policyIds,initialWorldSHA256:String(w.seed).repeat(64),ownPlanSummary:null,complete:true,W:i?-1:1,g:0,y:i?-1:1}})));
const comparisonBatch={schema:'ohuo-common-view-world-batch-r2',protocolRef,batchId:'independent-batch-a',precisionTarget:'Report local paired dispersion; no automatic strong-label qualification.',worlds};
// Old source rejects five worlds solely because four is a hard ceiling.
const evidence=screenFirstRoundBranches({proposalActionId:'pass',actions,worlds,profileSHA256,policyIds,results,comparisonBatch});
assert.equal(evidence.schema,'ohuo-common-view-screen-evidence-r2');
assert.equal(evidence.worldCount,5);
assert.equal(evidence.evidenceGrade,'provisional_screened');
assert.equal(evidence.status,'provisional_screened');
assert.equal(evidence.precisionStatus,'precision_not_established');
assert.equal(evidence.comparisons[0].deltaY,1);
assert.equal(evidence.comparisons[0].paired.length,5);
assert.throws(()=>screenFirstRoundBranches({proposalActionId:'pass',actions,worlds,profileSHA256,policyIds,results}),/fixed_four_worlds/);
const missing=screenFirstRoundBranches({proposalActionId:'pass',actions,worlds,profileSHA256,policyIds,results:results.slice(1),comparisonBatch});
assert.equal(missing.status,'incomplete');
const {sourceStageWorkload,readCommonViewSourceFamilies,commonViewCoverageCell,selectCommonViewRepresentatives}=await import('../first-round-source-batch.mjs');
assert.deepEqual(sourceStageWorkload({schema:'ohuo-first-round-source-spec-common-view-r2',stages:{formal:{reservedCount:9,devCount:3,activeCount:9}}},'formal'),{reservedCount:9,devCount:3});
assert.deepEqual(sourceStageWorkload({schema:'ohuo-first-round-source-spec-v1'},'formal'),{reservedCount:4,devCount:2});
assert.throws(()=>sourceStageWorkload({schema:'ohuo-first-round-source-spec-common-view-r2',stages:{formal:{reservedCount:2,devCount:3,activeCount:2}}},'formal'),/source_batch/);
const families=Array.from({length:21},(_,i)=>({familyId:'first-deal-family:'+String(i).padStart(64,'0'),split:i<3?'dev':'train'}));
assert.equal(readCommonViewSourceFamilies(families).length,21);
assert.throws(()=>readCommonViewSourceFamilies([...families,families[0]]),/source_batch/);
const view={state:{currentTarget:{kind:'pair',size:2},otherSeats:{lower:{remainingCards:1},upper:{remainingCards:0},partner:{remainingCards:0}}},candidates:[{action:{pass:true,kind:null}},{action:{pass:false,kind:'pair'}}]};
const cell=commonViewCoverageCell(view);assert.deepEqual(cell,{targetKind:'pair',opponentSizeRelation:'<',hasOrdinaryTakeover:true,partnerZero:true});
const other=commonViewCoverageCell({...view,state:{...view.state,otherSeats:{lower:{remainingCards:0},upper:{remainingCards:0},partner:{remainingCards:3}}},candidates:[{action:{pass:false,kind:'bomb'}}]});
assert.equal(other.opponentSizeRelation,'none-active');assert.equal(other.hasOrdinaryTakeover,false);assert.equal(other.partnerZero,false);
const ordered=[{id:'hash-first',commonViewCell:cell},{id:'hash-next',commonViewCell:cell},{id:'other-cell',commonViewCell:other}];
const representative=selectCommonViewRepresentatives(ordered,0);assert.deepEqual(representative.selected.map(r=>r.id),['hash-first','other-cell']);assert.deepEqual(representative.deferred.map(r=>r.id),['hash-next']);assert.equal(representative.cells.reduce((n,c)=>n+c.eligible,0),3);
assert.equal(ordered.length,3);assert.deepEqual(representative.order.map(o=>[o.sourceHashRank,o.cellRank,o.selected]),[[0,0,true],[1,1,false],[2,0,true]]);assert.equal(ordered[0].representativeOrder,undefined);
const {planCommonViewConfirmation}=await import('../first-round-evaluation.ts');
const planning=planCommonViewConfirmation({pilotBlocks:5,sPlan:.2,varianceEvidenceRef:protocolRef});
assert.equal(planning.N,62);assert.equal(planning.N_budget,undefined);assert.equal(planning.automaticExpansionAllowed,false);
assert.throws(()=>planCommonViewConfirmation({pilotBlocks:2,sPlan:null,varianceEvidenceRef:protocolRef}),/variance_estimate_required/);
const adverse=screenFirstRoundBranches({proposalActionId:'take',actions,worlds,profileSHA256,policyIds,results,comparisonBatch});
assert.equal(adverse.status,'screen_adverse');assert.equal(adverse.evidenceGrade,null);
// The same narrow case reaches the real current-action helper. Historical
// pilot and not-yet-materialized future source actions cannot block this batch.
const {verifySourceActionInventory}=await import('../first-round-source-action-scope.mjs');
const ref=n=>n+'@sha256:'+'a'.repeat(64),planRef=ref('plan'),ruleRef=ref('selection'),indexRef=ref('index'),queueRef=ref('queue'),clause=ref('formal'),futureClause=ref('future'),originalRule=ref('rule'),capRef=ref('cap');
const stages=['pilot','formal','newTest','variancePilot','confirmation'],oldStages=Object.fromEntries(stages.map(s=>[s,{namespace:'old-'+s}])),newStages=Object.fromEntries(stages.map(s=>[s,{namespace:'new-'+s}]));
const currentAction={clauseRef:clause,branchRef:null,plannedTaskIds:['formal-task'],expectedArtifactKinds:['ohuo-match-summary-v1']},futureAction={clauseRef:futureClause,branchRef:null,plannedTaskIds:['future-task'],expectedArtifactKinds:['ohuo-match-summary-v1']};
const task={schemaVersion:1,planRef,taskId:'formal-task',taskKind:'collect',planScope:{clauseRef:clause,branchRef:null},capabilityRef:capRef,sourcePlan:{namespace:'old-formal',sourceIndexRef:indexRef},seatLayoutPlan:queueRef};
const references=new Map([[protocolRef,{schema:'ohuo-first-round-protocol-revision-v2',protocolId:'first-round-common-view-r2',originalMethods:{sourceSpecRef:ref('old-spec')}}],[ruleRef,{schema:'ohuo-offline-selection-common-view-r2',protocolRef}],[ref('old-spec'),{schema:'ohuo-first-round-source-spec-v1',planRef,reservationRef:null,purpose:'first-round-source-plan',stages:oldStages}],[ref('new-spec'),{schema:'ohuo-first-round-source-spec-common-view-r2',protocolRef,planRef,reservationRef:null,purpose:'first-round-source-plan',stages:newStages}],[indexRef,{schema:'ohuo-source-index-ref-v1',namespace:'old-formal'}],[queueRef,{schema:'ohuo-complete-match-queue-v1',namespace:'old-formal',sourceIndexRef:indexRef}],[originalRule,{}],[clause,{schema:'ohuo-first-round-source-action-scope-v1',originalRuleRef:originalRule,namespace:'old-formal',stageName:'formal'}],[futureClause,{schema:'ohuo-first-round-source-action-scope-v1',originalRuleRef:originalRule,namespace:'old-confirmation',stageName:'confirmation'}],[capRef,{id:'B07.complete-match.v1'}],[ref('task'),task]]);
assert.deepEqual(verifySourceActionInventory({spec:{planRef,selectionRuleRef:ruleRef,sourceIndexRef:indexRef,queueRef},references,actions:[futureAction,currentAction],tasks:[{ref:ref('task'),task}]}),[currentAction]);
console.log('PASS one synthetic r2 source-batch/no-quota + variable-world evidence case; no strong-label or runtime/world-generation claim');
