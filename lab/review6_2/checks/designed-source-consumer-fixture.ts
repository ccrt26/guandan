/** Synthetic public-ref builder only. No grant, provider request or scientific start. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,lstatSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildDeck,DEFAULT_RULES} from '@gd/engine';
import {createDesignedSourceConsumer,verifyDesignedSourceInputs,DESIGNED_SOURCE_CAPABILITY} from '../designed-source-consumer';
import {PROJECT_RULES_DESIGN_PROMPT_ID,PROJECT_RULES_DESIGN_SYSTEM_SHA256,PROJECT_RULES_DESIGN_SYSTEM} from '../../../packages/web/server/llm-project-rules-v541.mjs';
import {digest,referenceOf,validateTask} from '../task-schema.mjs';
export function createDesignedConsumerFixture(directory?:string){
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex'),dir=realpathSync(directory??mkdtempSync(join(tmpdir(),'designed-consumer-'))),refs=new Map<string,any>();
const ref=(id:string,value:any)=>{const key=referenceOf('synthetic/'+id,value);refs.set(key,value);return key;};
const fixed=ref('fixed',{engineeringFixtureOnly:true}),sourceRevision=ref('source',{baseCommit:'a'.repeat(40),files:[]}),rulesRef=ref('rules',DEFAULT_RULES);
const index={version:1,families:{'design-family':{split:'train',rootFamilyId:'train-root',parentFamilyIds:['train-root']},'train-root':{split:'train'},'old-dev':{split:'dev'},'old-sealed':{split:'sealed'}}};
const sourceIndexPath=join(dir,'source-index.json');writeFileSync(sourceIndexPath,JSON.stringify(index));
const sourceIndexRef=ref('source-index',{schema:'ohuo-source-index-ref-v1',namespace:'synthetic-design',fileSHA256:hash(readFileSync(sourceIndexPath))});
const coverage={targetKind:'single',opponentSizeRelation:'>' as const,hasOrdinaryTakeover:true,partnerZero:false,hasNaturalNonJokerOption:true,ownHasFewerCardsThanPartner:false};
const publicFields={profileId:'synthetic-profile',nickname:'Finite no-network fixture',protocol:'openai-chat-completions',baseUrl:'https://fixture.invalid/v1',requestedModel:'synthetic-model',supportedReasoningOptions:['max'],requestOptions:{max_tokens:65536,reasoning_effort:'max',thinking:{type:'enabled'}},revision:1};
const publicProfile={...publicFields,snapshotHash:digest(publicFields)},reference={profileId:publicProfile.profileId,revision:publicProfile.revision,snapshotHash:publicProfile.snapshotHash};
const profileStore={resolve:(r:any)=>{assert.deepEqual(r,reference);return {...structuredClone(publicProfile),secret:'synthetic-not-a-credential',credentialRevision:1};}};
const configRef=ref('configuration',{schema:'ohuo-designed-source-configuration-v1',profileRevisionRef:reference,publicProfileRef:ref('public-profile',publicProfile)});
const promptRef=ref('prompt',{schema:'ohuo-designed-source-prompt-v1',promptId:PROJECT_RULES_DESIGN_PROMPT_ID,systemPromptSHA256:PROJECT_RULES_DESIGN_SYSTEM_SHA256});
const requestSpec={questionId:'synthetic-question',designFamilyId:'design-family',engineSourceRef:sourceRevision,rulesRef,ruleOptions:DEFAULT_RULES,coverage};
const inventoryRef=ref('inventory',{schema:'ohuo-designed-source-inventory-v1',requests:[requestSpec]}),coverageApprovalRef=ref('coverage-approval',{schema:'ohuo-designed-public-coverage-approval-v1',planRef:fixed,sourceIndexRef,rulesRef,coverageCells:[coverage],evidenceRef:fixed});
const contractRef=ref('contract',{schema:'ohuo-designed-source-contract-v1',sourceIndexRef,requestInventoryRef:inventoryRef,configurationRef:configRef,promptRef,rulesRef,sourceRevision,coverageApprovalRef});
const task=validateTask({schemaVersion:1,taskId:'synthetic-designer',experimentId:'synthetic-only',attemptId:'a1',planVersion:1,planRef:fixed,parentTaskId:null,retryReasonRef:null,researchBatchId:'synthetic',budgetRef:fixed,authorizationRef:fixed,taskKind:'collect',capabilityRef:ref('capability',DESIGNED_SOURCE_CAPABILITY),sourceRevision,runtimeRef:fixed,parentPolicyRef:fixed,releaseRefs:[fixed],rulesRef,sourcePlan:{namespace:'synthetic-design',sourceIndexRef,familyIds:['design-family'],split:'train'},splitRefs:[fixed],seatLayoutPlan:fixed,actorSampleRule:'evaluated-seat-only',datasetRefs:[inventoryRef],labelPolicyRef:configRef,promptRef,scientificContract:{question:'Finite cloud-only consumer check',primaryMetricRef:fixed,analysisUnit:'request',analysisMethodRef:fixed,comparisonRef:fixed,selectionRuleRef:fixed,readoutRuleRef:fixed,decisionRuleRef:contractRef},planScope:{clauseRef:fixed,branchRef:null,prerequisiteRefs:[fixed]},learnerRecipe:null,operationScope:{localExecution:true,apiCalls:true,parameterUpdates:false,deployment:false},limits:{mode:'input-derived-workload-v1',maxProviderRequests:1,maxOptimizerSteps:0,maxMatchAttempts:0,maxLabelDecisions:0},allowedBranches:[],stopPolicy:fixed,outputSpec:{artifactKinds:['designed-source-private'],releaseStatus:'development'},outputRoot:join(dir,'success'),runId:'synthetic-designer-run',taskStatus:'ready',unresolved:[]});
const inputs={designerCatalog:refs,designerProfile:{configurationRef:configRef,reference,publicProfile},sourceIdentity:sourceIndexRef,sourceIndexPath,confirmedRecordRoots:[],studentReleasePaths:{},datasetDirectory:null,seed:null};

return {dir,refs,fixed,sourceRevision,rulesRef,index,sourceIndexPath,sourceIndexRef,coverage,requestSpec,inventoryRef,contractRef,task,inputs,profileStore,publicProfile,reference,coverageApprovalRef,configRef,promptRef};
}
