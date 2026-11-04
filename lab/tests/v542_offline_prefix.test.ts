import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import {join} from 'node:path';
import * as engine from '@gd/engine';
import * as records from '../review6_2/match-record';
import * as source from '../review6_2/offline-label-source';
import {PublicTracker} from '../../packages/ai/src/nn/schema';
import {dedupCandidates} from '../../packages/ai/src/nn/neuralSeat';
import {createDecisionBundle} from '../../packages/ai/src/hybrid/candidates';
import type {DecisionInput} from '../review6_2/distill-data';
import {freezeCopy,type DecisionBundle,type PublicHistoryPrefix} from '../../packages/ai/src/hybrid/protocol';
import {buildObservation} from '../../packages/ai/src/hybrid/observation';
import {canonicalActionId,resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import {candidatePolicyForBundle,resolveCandidatePolicy,FIRST_TARGET_CANDIDATE_SPEC} from '../../packages/ai/src/candidate-spec';
// Independent test reference: pre-optimization reader from commit
// 7584c159933e67ddad3bbc84743554a5dd2616cc, lab/review6_2/offline-label-source.ts,
// SHA256 76d3852156e6918206ea660c73bd52a8f9489979aa4ff2004b2230eda940e505.
// Only the original candidate validator and single-question algorithm are kept;
// expected values never call the current optimized reader or require lab/out.
const {loadMatchStore,replayConfirmedMatch,hashJSON,captureStudentCandidateInputs}=records;
function referenceCapturedCandidateContract(input:DecisionInput,bundle:DecisionBundle){
 const student=input.schema==='ohuo-decision-input-first-round-v3',policy=candidatePolicyForBundle(bundle),fresh=policy.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC,c=input.candidateInputs;
 if(input.schema!==(student?'ohuo-decision-input-first-round-v3':fresh?'ohuo-decision-input-candidate-v2':'ohuo-decision-input-v1')||input.candidateSpec!==policy.candidateSpec||!c||!isDeepStrictEqual(c.candidateIds,bundle.initialCandidateIds)||!isDeepStrictEqual(input.initialCandidateIds,bundle.initialCandidateIds)||c.candidateIds.length<1||c.candidateIds.length>(fresh?12:8)||new Set(c.candidateIds).size!==c.candidateIds.length)throw Error('captured candidate schema/order/limit mismatch');
 if(fresh&&(!isDeepStrictEqual(input.enumSpec,policy.enumSpec)||resolveCandidatePolicy(c.candidatePolicy as any)!==policy||bundle.expansionCount!==0||!isDeepStrictEqual(bundle.offeredIds,bundle.initialCandidateIds)))throw Error('captured candidate complete policy mismatch');
 if(student&&(!fresh||!input.studentInputs||input.studentInputs.inputDim!==423||!isDeepStrictEqual(input.studentInputs.candidateIds,bundle.initialCandidateIds)))throw Error('captured student schema/order mismatch');
 if(!fresh&&(input.enumSpec!==undefined||c.candidatePolicy!==undefined))throw Error('legacy captured candidate metadata changed');
 return policy;
}
function referenceOfflineSnapshot(row:source.SelectedRecordedDecision,cache=new Map<string,ReturnType<typeof loadMatchStore>>(),options?:{purpose:'first-round-new-test'}){
 const cacheKey=hashJSON([row.recordRef,row.recordRoot]);let store=cache.get(cacheKey);if(!store){store=loadMatchStore(row.recordRef,row.recordRoot);cache.set(cacheKey,store);}
 const {record,privateSources}=store.recorder.snapshot(),decision=record.decisions.find(d=>isDeepStrictEqual(d.key,row.key)),game=record.games.find(g=>g.gameNo===row.key.gameNo);
 if(!decision||decision.executionKind!=='confirmed'||!['selected','fallback'].includes(decision.status)||!game||game.sourceFamilyId!==row.familyId||record.split!==row.split||record.evaluatedActor!==row.actorSeat||row.key.actorSeat!==row.actorSeat||!(options?.purpose==='first-round-new-test'?row.split==='confirm':['train','dev'].includes(row.split))||decision.trainingInputSHA256!==row.inputSHA256)throw Error('offline source/actor/family/confirmed-decision mismatch');
 const path=join(row.recordRef.directory,`decision-${row.key.requestSeq}.private.json`);if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||(lstatSync(path).mode&0o777)!==0o600)throw Error('private decision requires exact 0600 regular file');
 const input=JSON.parse(readFileSync(path,'utf8')) as DecisionInput&{selectionBundle?:DecisionBundle};
 if(hashJSON(input)!==row.inputSHA256||!isDeepStrictEqual(input.key,row.key)||!input.selectionBundle)throw Error('missing original complete selection bundle or input identity');
 const bundle=freezeCopy(input.selectionBundle);
 referenceCapturedCandidateContract(input,bundle);
 if(!isDeepStrictEqual(bundle.key,row.key)||bundle.decisionId!==input.observation.decisionId||bundle.expansionCount!==0||bundle.candidateSpec!==input.candidateSpec||!isDeepStrictEqual(bundle.observation,input.observation)||!isDeepStrictEqual(bundle.pool,input.pool)||!isDeepStrictEqual(bundle.initialCandidateIds,input.initialCandidateIds)||!isDeepStrictEqual(bundle.offeredIds,input.initialCandidateIds)||!bundle.initialCandidateIds.includes(bundle.fallbackActionId)||typeof bundle.isUniqueLegalAction!=='boolean'||!bundle.pool.length)throw Error('original bundle/candidate provenance differs');
 const earlier=record.decisions.filter(d=>d.key.gameNo<row.key.gameNo||d.key.gameNo===row.key.gameNo&&d.key.requestSeq<row.key.requestSeq);
 const prefixRecord:records.MatchRecord={...record,games:record.games.filter(g=>g.gameNo<=row.key.gameNo),decisions:earlier,summary:null};
 const replay=replayConfirmedMatch(prefixRecord,{...privateSources,games:privateSources.games.filter(g=>g.gameNo<=row.key.gameNo)}),state=replay.state;
 if(replay.executionUnknown||!state||state.over||state.moveNo!==row.key.moveNo||state.turn!==row.actorSeat||state.match.gameNo!==row.key.gameNo)throw Error('offline confirmed causal origin unavailable');
 const history:PublicHistoryPrefix={matchId:row.key.matchId,gameNo:row.key.gameNo,throughMoveNo:row.key.moveNo,steps:earlier.filter(d=>d.key.gameNo===row.key.gameNo&&d.executionKind==='confirmed').map(d=>({priorTarget:d.priorTarget,events:d.events}))};
 if(!isDeepStrictEqual(buildObservation({state,actorSeat:row.actorSeat,matchId:row.key.matchId,decisionId:bundle.decisionId,history}),input.observation))throw Error('offline original observation differs');
 for(const candidate of bundle.pool){resolveLegalMove(state,candidate.canonical===null?{pass:true}:{pass:false,combo:candidate.canonical});if(canonicalActionId(candidate.canonical,state.ctx)!==candidate.canonicalId)throw Error('offline original canonical differs');}
 if(input.schema==='ohuo-decision-input-first-round-v3'){
  const captured=input.studentInputs!;if(!Array.isArray(captured.rawQ)||captured.rawQ.length!==bundle.initialCandidateIds.length||captured.rawQ.some(q=>!Number.isFinite(q)))throw Error('offline student scores malformed');
  const tracker=new PublicTracker();for(const step of history.steps)tracker.observe([...step.events]);
  // This reconstructs only capture/features/memory and S0 top from the stored
  // scores. Actual scorer weights/forward provenance is separately bound by
  // the fixed source producer and host S0 migration resolver, never inferred here.
  const reconstructed=captureStudentCandidateInputs({bundle,state,tracker,candidateInputs:input.candidateInputs as any,student:{studentParentRef:captured.studentParentRef,scorer:captured.scorer,network:{inputDim:423,forward:()=>Float32Array.from(captured.rawQ)} as any}});
  if(!isDeepStrictEqual(reconstructed,captured))throw Error('offline student capture/memory replay differs');
 }
 return {row,record,decision,input,bundle,state,history};
}
const encoder={schema:'v2',ctxFill:'rule-context',passEncoding:'action64'} as const,identity={policyId:'synthetic-B',encoderVersion:'gd-lab-schema-v4',inputDim:399} as any;
function fixture({unknown=false,nonmonotonic=false}={}){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'v542-offline-prefix-')),id={runId:'fixture',matchId:'fixture',sourceRef:'synthetic',layoutRef:'fixture',policyIds:['B','B','B','B'],rules:engine.DEFAULT_RULES,split:'train',evaluatedActor:0},store=records.createMatchStore(root,id),state=engine.startGame(engine.createMatch({...id.rules},75)),tracker=new PublicTracker();state.turn=0;state.leader=0;state.lastPlayer=0;store.recorder.beginGame(state,'family');let seq=0;
 for(let n=0;n<9;n++){
  if(unknown&&n===5){const key={controllerOrRunnerGeneration:'fixture',matchId:id.matchId,gameNo:1,moveNo:state.moveNo,actorSeat:state.turn,requestSeq:seq++};store.recorder.beginDecision({key,policyId:'B',initialCandidateIds:['unknown'],offeredIds:['unknown']});store.recorder.finishDecision({key,status:'halted',reason:'execution_uncertain',elapsedMs:0,offeredIds:['unknown'],requests:[]});}
  const requestSeq=nonmonotonic?(n===0?4:n===4?0:n):seq++,key={controllerOrRunnerGeneration:'fixture',matchId:id.matchId,gameNo:1,moveNo:state.moveNo,actorSeat:state.turn,requestSeq},rows=dedupCandidates(engine.legalCombos(state),engine.canPass(state));
  const bundle=createDecisionBundle({state,actorSeat:state.turn,key,decisionId:'fixture-'+n,matchId:id.matchId,history:store.recorder.history(1),decider:{seat:state.turn,decide:()=>({move:rows[0].combo?{pass:false,combo:rows[0].combo}:{pass:true},nCands:rows.length,explored:false,ranking:rows.map((r,idx)=>({combo:r.combo,idx,score:rows.length-idx}))})}}),candidateInputs=records.captureInitialCandidateInputs({bundle,state,tracker,encoder,policyIdentity:identity});
  store.recorder.beginDecision({key,policyId:identity.policyId,initialCandidateIds:bundle.initialCandidateIds,offeredIds:bundle.offeredIds,bundle,candidateInputs});const action=bundle.pool[0],move=action.canonical?{pass:false as const,combo:action.canonical}:{pass:true as const},priorTarget=structuredClone(state.lastCombo),events=engine.applyMove(state,move);tracker.observe(events);store.recorder.confirmAction({key,move,events,priorTarget,actionId:action.actionId,requestedActionId:null,source:'B',status:'selected'});store.recorder.finishDecision({key,status:'selected',reason:null,elapsedMs:0,offeredIds:bundle.offeredIds,requests:[]});
 }
 const loaded=records.loadMatchStore(store.ref(),root),cache=()=>new Map([[records.hashJSON([store.ref(),root]),loaded]]),rows=loaded.resume!.record.decisions.filter(d=>d.key.actorSeat===0&&d.executionKind==='confirmed').map(d=>({recordRef:store.ref(),recordRoot:root,key:d.key,inputSHA256:d.trainingInputSHA256!,familyId:'family',split:'train' as const,actorSeat:0}));expect(rows.length).toBeGreaterThan(1);return {root,store,loaded,cache,rows};
}
function comparable(s:any){return records.hashJSON({...s,state:records.saveState(s.state)});}
function outcome(fn:()=>any){try{return {value:comparable(fn())};}catch(e){return {error:(e as Error).message};}}
afterEach(()=>vi.restoreAllMocks());
it('reconstructs a monotone causal prefix once and reads the same verified record without whole-match clones',()=>{
 const f=fixture(),expected=f.rows.map(row=>comparable(referenceOfflineSnapshot(row,f.cache()))),cache=f.cache(),snapshot=vi.spyOn(records.MatchRecorder.prototype,'snapshot'),apply=vi.spyOn(engine,'applyMove'),actual=f.rows.map(row=>source.readOfflineSnapshot(row,cache));
 expect(actual.map(comparable)).toEqual(expected);expect(snapshot).not.toHaveBeenCalled();expect(actual.every(s=>s.record===f.loaded.resume!.record)).toBe(true);expect(apply).toHaveBeenCalledTimes(Math.max(...f.rows.map(r=>r.key.moveNo)));
 actual[0].state.hands[0].pop();expect(comparable(source.readOfflineSnapshot(f.rows.at(-1)!,cache))).toBe(expected.at(-1));
});
it('batch sorts only internal work, preserves requested order and reports the original first error',()=>{
 const f=fixture(),rows=[f.rows.at(-1)!,f.rows[0],f.rows[1]],expected=rows.map(row=>comparable(referenceOfflineSnapshot(row,f.cache())));expect(typeof (source as any).readOfflineSnapshots).toBe('function');
 const apply=vi.spyOn(engine,'applyMove'),actual=(source as any).readOfflineSnapshots(rows,f.cache());expect(actual.map(comparable)).toEqual(expected);expect(apply).toHaveBeenCalledTimes(Math.max(...rows.map(r=>r.key.moveNo)));expect(actual[0].state).not.toBe(actual[1].state);
 const bad=rows[0],path=join(bad.recordRef.directory,`decision-${bad.key.requestSeq}.private.json`),input=JSON.parse(readFileSync(path,'utf8'));input.selectionBundle=null;writeFileSync(path,JSON.stringify(input));const first=outcome(()=>referenceOfflineSnapshot(bad,f.cache())).error;
 expect(()=> (source as any).readOfflineSnapshots([bad,{...f.rows[0],familyId:'wrong'}],f.cache())).toThrow(first);
});
it('retains row-local unknown, missing/game binding and nonmonotone-prefix results from the before reader',()=>{
 for(const options of [{unknown:true},{nonmonotonic:true},{}]){const f=fixture(options),cache=f.cache();for(const row of [...f.rows,{...f.rows[0],key:{...f.rows[0].key,gameNo:2}}])expect(outcome(()=>source.readOfflineSnapshot(row,cache))).toEqual(outcome(()=>referenceOfflineSnapshot(row,f.cache())));}
});
it('does not lend a verified prefix after its recorder changes or a different recordRef is supplied',()=>{
 const f=fixture(),cache=f.cache();source.readOfflineSnapshot(f.rows[0],cache);f.loaded.recorder.finish({complete:false,winner:null,incompleteReason:'synthetic-change'});
 expect(()=>source.readOfflineSnapshot(f.rows[0],cache)).toThrow(/record\/checkpoint bytes differ/);
 const changed={...f.rows[0],recordRef:{...f.rows[0].recordRef,journalSHA256:'f'.repeat(64)}};expect(()=>source.readOfflineSnapshot(changed,cache)).toThrow(/record\/checkpoint bytes differ/);
});
