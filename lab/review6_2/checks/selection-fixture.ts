/** Explicitly synthetic, finite captured decisions. Not a real source run. */
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMatch,startGame,DEFAULT_RULES,legalCombos,canPass,applyMove} from '@gd/engine';
import {dedupCandidates} from '../../../packages/ai/src/nn/neuralSeat';
import {PublicTracker} from '../../../packages/ai/src/nn/schema';
import {createDecisionBundle} from '../../../packages/ai/src/hybrid/candidates';
import {createMatchStore,captureInitialCandidateInputs,hashJSON} from '../match-record';
import {digest,referenceOf} from '../task-schema.mjs';
import {RELEASES} from '../../../packages/ai/src/policy/seats';
import type {OfflineSelectionTrustedInputs,FixedFile,SelectionEvidenceRef} from '../offline-selection';
export const byteSHA=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
export function fixture(complete=false,missingSourceDefinition=false){
 const repositoryRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url))),out=join(repositoryRoot,'lab/out');mkdirSync(out,{recursive:true});const root=mkdtempSync(join(out,'selection-boundary-')),controlRoot=join(root,'control');mkdirSync(controlRoot);
 const outputId=(name:string)=>basename(root)+'-'+name,output=(name:string)=>join(out,outputId(name));
 const refs=new Map<string,any>(),files=new Map<string,FixedFile>();
 const ref=(id:string,v:any)=>{const r=referenceOf(id,v);refs.set(r,structuredClone(v));return r;};
 const file=(name:string,v:any)=>{const path=join(root,name);mkdirSync(dirname(path),{recursive:true});const bytes=JSON.stringify(v)+'\n';writeFileSync(path,bytes,{mode:0o600});const f={path:relative(repositoryRoot,path),sha256:byteSHA(bytes)};files.set(name,f);return {id:name,sha256:f.sha256};};
 const missingSourceClauseRef=ref('missing-source-clause',{scope:'synthetic-unexecuted-source'});
 const clauseRef=ref('synthetic-clause',{scope:'selection-software-check'}),planRef=ref('synthetic-plan',{schema:'finite-synthetic-only',realResearch:false,actions:[{clauseRef,branchRef:null,plannedTaskIds:['source-train','source-dev'],expectedArtifactKinds:['ohuo-match-summary-v1']},...(missingSourceDefinition?[{clauseRef:missingSourceClauseRef,branchRef:null,plannedTaskIds:['not-yet-defined-source'],expectedArtifactKinds:['ohuo-match-summary-v1']}]:[])]}),capabilityRef=ref('source-capability',{id:'B07.complete-match.v1',kind:'collect',mode:'offline_synthetic'});
 const policyIdentity:any={policyId:'synthetic-B',weightsSHA256:'b'.repeat(64),inputDim:399,encoderVersion:'gd-lab-schema-v4',passEncoding:'action64'},encoder={schema:'v2' as const,ctxFill:'zero' as const,passEncoding:'action64' as const};
 const actingReleaseRef=ref('acting-B',{schema:'ohuo-release-ref-v1',release:RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1'),policyIdentity});
 const sourceIndex={version:1,families:{train0:{split:'train'},dev0:{split:'dev'}}},indexFile=file('source-index.json',sourceIndex),sourceIndexPath=join(root,indexFile.id),sourceIndexRef=ref('index',{schema:'ohuo-source-index-ref-v1',namespace:'synthetic-selection',fileSHA256:indexFile.sha256});
 const states:any[]=[];for(const split of ['train','dev'])for(let g=0;g<3;g++)for(let side=0;side<2;side++)for(let n=0;n<(complete?1:3);n++){const seed=1234+states.length*17,match=createMatch({...DEFAULT_RULES,...(complete?{passA:'head' as const}:{})},seed);if(complete)match.levels=[14,14];const state=startGame(match);states.push({state,split,familyId:split+'0',group:g,side,n,seed,matchId:`m-${split}-${g}-${side}-${n}`});}
 const queue={schema:'ohuo-complete-match-queue-v1',namespace:'synthetic-selection',sourceIndexRef,rows:states.map(x=>({matchId:x.matchId,layoutId:`layout-${x.group}-${x.side}`,sourceFamilyId:x.familyId,split:x.split,seed:x.seed,dealNamespace:'synthetic',roundFamilyIds:[x.familyId],actor:x.state.turn,metric:'synthetic',group:x.group,side:x.side,variant:'synthetic',maxGames:1,maxMovesPerGame:complete?1000:1,seats:Array.from({length:4},()=>({releaseRef:actingReleaseRef,mode:'local',profileRevisionRef:null}))}))},queueRef=ref('queue',queue);
 const budget={researchBatchId:'synthetic',authorizationRef:ref('synthetic-auth',{realResearch:false}),planRef,controlRoot,limits:{maxProviderRequests:64,maxOptimizerSteps:0,maxMatchAttempts:0,maxLabelDecisions:32,maxRunSeconds:60}},budgetRef=ref('budget',budget),runs:any={},sourceRunRefs:SelectionEvidenceRef[]=[],recordRoots:string[]=[];
 for(const split of ['train','dev']){
  const runId='source-'+split,sourceRoot=join(root,runId);mkdirSync(sourceRoot);recordRoots.push(sourceRoot);const matches:any[]=[];
  for(const x of states.filter(x=>x.split===split)){
   const {state}=x,actor=state.turn,key={controllerOrRunnerGeneration:'synthetic',matchId:x.matchId,gameNo:1,moveNo:0,actorSeat:state.turn,requestSeq:0};
   const store=createMatchStore(sourceRoot,{runId,matchId:x.matchId,sourceRef:sourceIndexRef,layoutRef:queueRef,policyIds:Array(4).fill(policyIdentity.policyId),seatSnapshots:Array.from({length:4},()=>({releaseRef:actingReleaseRef,policyIdentity})),rules:{...state.match.opts},sourceFamilyId:x.familyId,split,evaluatedActor:actor});
   store.recorder.beginGame(state,x.familyId);const tracker=new PublicTracker();let steps=0;
   do{
    if(++steps>1000)throw Error('bounded synthetic complete record exceeded 1000 actions');
    const current={...key,moveNo:state.moveNo,actorSeat:state.turn,requestSeq:state.moveNo},ranking=dedupCandidates(legalCombos(state),canPass(state)).map((c,idx)=>({...c,idx,score:(c.combo?.size??0)*1000-idx})).sort((a,b)=>b.score-a.score||a.idx-b.idx),best=ranking.reduce((a,b)=>a.score>=b.score?a:b),move=best.combo===null?{pass:true as const}:{pass:false as const,combo:best.combo};
    const original=state.turn===actor?createDecisionBundle({key:current,state,actorSeat:state.turn,matchId:x.matchId,decisionId:`decision-${x.matchId}-${state.moveNo}`,history:store.recorder.history(1),decider:{seat:state.turn,decide(){return{move,nCands:ranking.length,explored:false,ranking};}}}):null;
    store.recorder.beginDecision({key:current,policyId:policyIdentity.policyId,initialCandidateIds:original?.initialCandidateIds??[],offeredIds:original?.offeredIds??[],...(original?{bundle:original,candidateInputs:captureInitialCandidateInputs({bundle:original,state,tracker,encoder,policyIdentity})}:{})});
    const priorTarget=state.lastCombo,events=applyMove(state,move);store.recorder.confirmAction({key:current,move,events,priorTarget,actionId:original?.fallbackActionId??'uncaptured',requestedActionId:null,source:'B',status:'selected'});store.recorder.finishDecision({key:current,status:'selected',reason:null,elapsedMs:1,offeredIds:original?.offeredIds??[],requests:[]});tracker.observe(events);
   }while(complete&&!state.over);
   if(complete&&state.match.winner===null)throw Error('synthetic fixture did not actually complete');
   store.recorder.finish({complete,winner:complete?state.match.winner:null,incompleteReason:complete?null:'finite_synthetic_one_step_boundary'});matches.push({matchId:x.matchId,recordRef:store.ref(),result:{complete,incompleteReason:complete?null:'finite_synthetic_one_step_boundary'}});
  }
  const task={schemaVersion:1,taskKind:'collect',runId,taskId:runId,planRef,budgetRef,researchBatchId:'synthetic',capabilityRef,sourcePlan:{sourceIndexRef,familyIds:[split+'0'],split},seatLayoutPlan:queueRef,planScope:{clauseRef,branchRef:null},outputRoot:sourceRoot},checkpoint={schema:'ohuo-match-run-v1',taskSHA256:digest(task),queueRef,matches,cursor:matches.length,active:null,executionUnknown:false},checkpointSHA256=digest(checkpoint),checkpointRef=join(sourceRoot,`checkpoint-${checkpointSHA256}.json`);writeFileSync(checkpointRef,JSON.stringify(checkpoint),{mode:0o600});
  const run={runId,task,taskRef:ref(runId+'-task',task),taskSHA256:digest(task),status:'completed',cleanupConfirmed:true,owner:{token:'historical-stopped-owner',pid:1},checkpoint,checkpointSHA256,checkpointRef};runs[runId]=run;sourceRunRefs.push(file(runId+'.json',run));
 }
 const state={schemaVersion:1,tasks:Object.fromEntries(Object.values(runs).map((r:any)=>[r.task.taskId,r.runId])),runs,budgets:{[budgetRef]:{...budget,used:{providerRequests:0,optimizerSteps:0,matchAttempts:0,labelDecisions:0},reservations:{},activeRunId:null,elapsedSeconds:0}},batches:{synthetic:{budgetRef,planRef,authorizationRef:budget.authorizationRef}}};writeFileSync(join(controlRoot,'state.json'),JSON.stringify(state),{mode:0o600});const controlStateRef=file('prequery-state.json',state),freezeEvidenceRef=file('prequery-evidence.json',{schema:'ohuo-selection-prequery-v1',planRef,clauseRef,branchRef:null,budgetRef,controlRoot,controlStateRef});
 const frozenQuotas=[{familyId:'train0',split:'train',count:4},{familyId:'dev0',split:'dev',count:4}],reasonRef=file('quota-reason.json',{reason:'unchanged finite synthetic quotas'}),quotaBasisRef=file('quota-basis.json',{schema:'ohuo-selection-quota-basis-v1',planRef,budgetRef,controlStateRef,stage2Stage3AccountingRefs:[],originalQuotas:frozenQuotas,frozenQuotas,reasonRef,freezeEvidenceRef});
 const targetDefinitionRef=ref('synthetic-target',{schema:'ohuo-approved-public-target-v1',id:'synthetic-own-rank-2-v1',scope:'offline_synthetic',field:'ownHand',rule:'contains-rank-2'}),selectionRuleRef=ref('rule',{schema:'ohuo-offline-selection-rule-v1',targetDefinitionRef,layoutOrder:[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]],hashAlgorithm:'sha256',hashInput:'decisionId-utf8-no-normalization',hashTieBreak:'decisionId-utf8-bytes-then-canonical-DecisionKey',targetQuotaRounding:'floor-half',ordinaryShortfall:'report-no-extra-target',keepRule:'same-count-ordinary-disjoint-context'});
 const spec:any={schema:'ohuo-offline-selection-spec-v1',planRef,clauseRef,branchRef:null,sourceIndexRef,queueRef,sourceRunRefs,targetDefinitionRef,selectionRuleRef,quotaBasisRef,purpose:'b_training_source',actingReleaseRef,outputId:outputId('selection-one')};
 const trusted:OfflineSelectionTrustedInputs={repositoryRoot,references:refs,evidenceFiles:files,sourceIndexPath,confirmedRecordRoots:recordRoots,controlRoot,mode:'offline_synthetic',phase:'freeze',outputDir:output('selection-one')};
 const register=(r:any)=>{for(const f of r.files)files.set(f.id,f.file);refs.set(r.specRef,JSON.parse(readFileSync(join(trusted.repositoryRoot,dirname(r.manifestFile.path),'spec.json'),'utf8')));refs.set(r.productionRef,r.production);refs.set(r.selectionRef,r.selection);};
 return {root,outputId,output,refs,files,ref,file,spec,trusted,register,state,queue,queueRef,policyIdentity,encoder};
}
