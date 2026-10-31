/** Explicit local-only, two-match engineering parity. No default input/assets.
 * The B00 caller must separately verify the real authorization evidence; a JSON
 * file is not a grant. This harness checks that the exact approved payload is used. */
import {existsSync,readFileSync,realpathSync,mkdirSync,writeFileSync,lstatSync} from 'node:fs';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {DEFAULT_RULES} from '@gd/engine';
import {runCompleteMatch,type PolicySpec} from '../../review6/match-play';
import {resolveNodePolicy} from '../policy-loader';
import {runCompleteMatchAsync} from '../match-play-async';
import {createMatchStore,publicEngineEvents,publicMatchOutcome} from '../match-record';
import {assertFrozenRound,assertFrozenRoundPlan,validateMatchRules} from '../match-consumer';
import {strictObject,digest,validateIdentifier,validateSourceFamily} from '../task-schema.mjs';
import {LEGACY_O_POLICY_REF} from '../../../packages/ai/src/policy/resolve';
export const PARITY_INPUT_PATH='deliverables/ohuo-batches/B07/parity-input.json';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function bounded(n:any,name:string){if(!Number.isSafeInteger(n)||n<1)throw Error(`finite ${name} required`);}
function below(root:string,path:string){if(typeof path!=='string'||isAbsolute(path))throw Error('repository-relative input required');const full=realpathSync(resolve(root,path)),rel=relative(realpathSync(root),full);if(rel.startsWith('..')||isAbsolute(rel)||!lstatSync(full).isFile())throw Error('input escapes repository');return full;}
function readRef(root:string,ref:any){strictObject(ref,'fileRef',['path','sha256']);const bytes=readFileSync(below(root,ref.path));if(hash(bytes)!==ref.sha256)throw Error('fixed input bytes differ');return bytes;}
export function validateParityPayload(p:any){
 strictObject(p,'parityPayload',['runId','sourceRef','sourceNamespace','familyIds','row','policies','rules','maxRunSeconds']);validateIdentifier(p.runId,'runId');bounded(p.maxRunSeconds,'maxRunSeconds');
 if(!isDeepStrictEqual(validateMatchRules(p.rules),DEFAULT_RULES))throw Error('parity baseline requires exact DEFAULT_RULES');
 const row=p.row;strictObject(row,'parityRow',['matchId','layoutId','sourceFamilyId','split','seed','dealNamespace','roundFamilyIds','actor','maxGames','maxMovesPerGame']);
 validateIdentifier(row.matchId,'matchId');validateIdentifier(row.layoutId,'layoutId');bounded(row.maxGames,'maxGames');bounded(row.maxMovesPerGame,'maxMovesPerGame');
 if(!Number.isSafeInteger(row.seed)||!Number.isInteger(row.actor)||row.actor<0||row.actor>3||typeof row.dealNamespace!=='string'||!row.dealNamespace||typeof p.sourceNamespace!=='string'||!p.sourceNamespace||!['train','dev','fixture'].includes(row.split)||!Array.isArray(p.familyIds)||!p.familyIds.length||new Set(p.familyIds).size!==p.familyIds.length)throw Error('explicit parity source identity required');
 p.familyIds.forEach((id:string)=>validateSourceFamily(id,'familyId'));
 if(!Array.isArray(p.policies)||p.policies.length!==4)throw Error('four explicit policies required');
 for(const policy of p.policies){strictObject(policy,'parityPolicy',['policyRef','identity']);if(!policy.policyRef||policy.identity?.policyId!==policy.policyRef||policy.identity?.epsilon!==0||!['weightsSHA256','encoderVersion','candidateVersion','architectureId','weightsLayoutVersion','tieBreakId','tierSpecId','modelVersion','passEncoding'].every(k=>typeof policy.identity[k]==='string'&&policy.identity[k])||![385,399].includes(policy.identity.inputDim))throw Error('complete deterministic policy identity required');}
 return p;
}
export function readParityInput(root:string){
 const inputPath=resolve(root,PARITY_INPUT_PATH);if(!existsSync(inputPath))throw Error(`pending: explicit authorized local parity input missing: ${PARITY_INPUT_PATH}`);
 const bytes=readFileSync(below(root,PARITY_INPUT_PATH)),input=JSON.parse(bytes.toString());strictObject(input,'parityInput',['schema','payload','authorizationRef']);if(input.schema!=='ohuo-fixed-local-parity-v1')throw Error('unsupported parity input');
 const p=validateParityPayload(input.payload),authorization=JSON.parse(readRef(root,input.authorizationRef).toString());strictObject(authorization,'parityAuthorization',['schema','payloadSHA256','scope','evidenceRef']);
 if(authorization.schema!=='ohuo-engineering-parity-authorization-v1'||authorization.payloadSHA256!==digest(p)||!isDeepStrictEqual(authorization.scope,{syncMatches:1,asyncMatches:1,apiCalls:0,optimizerSteps:0}))throw Error('parity authorization/input binding differs');
 const evidence=readRef(root,authorization.evidenceRef);if(!evidence.toString().trim())throw Error('real authorization evidence missing');
 const sourceBytes=readRef(root,p.sourceRef),index=JSON.parse(sourceBytes.toString());if(index.version!==1||!index.families)throw Error('fixed source index required');assertFrozenRoundPlan(p.row,p.familyIds,index,p.row.split);
 return {p,index,sourcePath:below(root,p.sourceRef.path),inputSHA256:hash(bytes),authorizationRef:input.authorizationRef};
}
export async function runFixedLocalParity(root=fileURLToPath(new URL('../../../',import.meta.url))){
 // No policy access or match starts before all explicit refs/permission binding.
 const {p,index,sourcePath,inputSHA256,authorizationRef}=readParityInput(root),outputRoot=resolve(root,'lab/out/B07-parity',p.runId);
 if(existsSync(outputRoot))throw Error('parity output already exists; do not silently rerun two matches');
 const policies=await Promise.all(p.policies.map((q:any)=>resolveNodePolicy(q.policyRef,root)));
 if(policies.some((q:any,i:number)=>!isDeepStrictEqual(q.identity,p.policies[i].identity)))throw Error('actual parity policy identity differs');
 const specs:PolicySpec[]=policies.map((q:any)=>({policyId:q.identity.policyId,kind:'neural',weightsPath:below(root,q.descriptor.weightsPathOrUrl.nodePath),weightsSHA256:q.identity.weightsSHA256,inputDim:q.identity.inputDim,encoder:q.encoder,epsilon:q.identity.epsilon}));
 mkdirSync(outputRoot,{recursive:true,mode:0o700});
 const identity={runId:p.runId,matchId:p.row.matchId,sourceRef:`${p.sourceNamespace}@sha256:${p.sourceRef.sha256}`,layoutRef:`${p.row.layoutId}@sha256:${digest(p.row)}`,policyIds:policies.map((q:any)=>q.identity.policyId),rules:p.rules,sourceFamilyId:p.row.sourceFamilyId,split:p.row.split,evaluatedActor:p.row.actor,seatSnapshots:policies.map((q:any)=>({policyIdentity:q.identity}))};
 const sync=createMatchStore(join(outputRoot,'sync'),identity),asyncStore=createMatchStore(join(outputRoot,'async'),identity),deadline=performance.now()+p.maxRunSeconds*1000;
 const assertSource=(state:any)=>assertFrozenRound(p.row,state,index,sourcePath,p.sourceRef.sha256);let sequence=0,current:any,decisionStartedAt=0;
 const started=performance.now();const syncResult=runCompleteMatch({seed:p.row.seed,policies:specs,actingSeat:p.row.actor,dealMode:'indexed-deal-v1',dealNamespace:p.row.dealNamespace,rngMode:'counter-per-decision',maxGames:p.row.maxGames,maxMovesPerGame:p.row.maxMovesPerGame,deadlineMonotonicMs:deadline,
  onBeforeDecision({state,seat}){decisionStartedAt=performance.now();if(state.moveNo===0)sync.recorder.beginGame(state,assertSource(state));current={controllerOrRunnerGeneration:p.runId,matchId:p.row.matchId,gameNo:state.match.gameNo,moveNo:state.moveNo,actorSeat:seat,requestSeq:sequence++};sync.recorder.beginDecision({key:current,policyId:identity.policyIds[seat],initialCandidateIds:['baseline'],offeredIds:['baseline']});},
  onAfterDecision({move,events,history}){sync.recorder.confirmAction({key:current,move:move as any,events,priorTarget:history.at(-1)!.priorTarget,actionId:'baseline',requestedActionId:null,source:'baseline-sync',status:'selected'});sync.recorder.finishDecision({key:current,status:'selected',reason:null,elapsedMs:performance.now()-decisionStartedAt,offeredIds:['baseline'],requests:[]});}
 });sync.recorder.finish({complete:syncResult.complete,winner:syncResult.winner,incompleteReason:syncResult.incompleteReason});
 const syncPublic=publicMatchOutcome({...syncResult,traceSchema:'review6-engine-move-count-events-v1',wallSeconds:(performance.now()-started)/1000});
 const asyncResult=await runCompleteMatchAsync({...identity,generation:p.runId,seed:p.row.seed,dealNamespace:p.row.dealNamespace,maxGames:p.row.maxGames,maxMovesPerGame:p.row.maxMovesPerGame,actor:p.row.actor,signal:new AbortController().signal,deadlineMonotonicMs:deadline,recorder:asyncStore.recorder,beforeGame:assertSource,seats:policies.map((q:any,i:number)=>({policyId:q.identity.policyId,mode:'local',source:q.identity.policyId===LEGACY_O_POLICY_REF?'O':'B',decider:q.createDecider(i),encoder:q.encoder,policyIdentity:q.identity}))});
 const projection=(store:any)=>{const snapshot=store.recorder.snapshot(),r=snapshot.record;return{games:r.games.map((g:any)=>({gameNo:g.gameNo,source:snapshot.privateSources.games.find((s:any)=>s.gameNo===g.gameNo).state,tribute:g.tribute,levelsBefore:g.levelsBefore})),actions:r.decisions.filter((d:any)=>d.executionKind==='confirmed').map((d:any)=>({gameNo:d.key.gameNo,moveNo:d.key.moveNo,seat:d.key.actorSeat,events:publicEngineEvents(d.events)})),summary:r.summary};};
 const a=projection(sync),b=projection(asyncStore),same=isDeepStrictEqual(a,b),passed=syncResult.complete&&asyncResult.complete&&same;
 const report={caseId:'sync-async-parity',status:passed?'passed':'failed',inputRef:{path:PARITY_INPUT_PATH,sha256:inputSHA256},authorizationRef,actual:{sync:syncPublic,async:asyncResult,canonicalSequenceAndTerminalEqual:same,invokedPaths:['sync','async']},recordRefs:[sync.ref(),asyncStore.ref()]};
 writeFileSync(join(outputRoot,'parity-result.json'),JSON.stringify(report),{flag:'wx',mode:0o600});
 if(!passed)throw Error(`parity failed or incomplete; inspect ${join(outputRoot,'parity-result.json')}`);return report;
}
