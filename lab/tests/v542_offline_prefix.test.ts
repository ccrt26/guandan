import {beforeAll,afterEach,expect,it,vi} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as engine from '@gd/engine';
import * as records from '../review6_2/match-record';
import * as source from '../review6_2/offline-label-source';
import {PublicTracker} from '../../packages/ai/src/nn/schema';
import {dedupCandidates} from '../../packages/ai/src/nn/neuralSeat';
import {createDecisionBundle} from '../../packages/ai/src/hybrid/candidates';
const output=fileURLToPath(new URL('../out/v542-runtime-reduction-m2d3nt4l/offline-prefix/',import.meta.url));
let legacy:typeof source;
beforeAll(async()=>{
 mkdirSync(output,{recursive:true});const original=readFileSync(join(output,'../before/lab/review6_2/offline-label-source.ts'),'utf8'),origin=fileURLToPath(new URL('../review6_2/offline-label-source.ts',import.meta.url)),path=join(output,'baseline-offline-label-source.ts');
 // Preserve original code; only relocate relative imports for this exact before-byte comparison.
 writeFileSync(path,original.replace(/from '(\.[^']+)'/g,(_all,ref)=>"from '"+resolve(dirname(origin),ref)+"'"));legacy=await import(/* @vite-ignore */path);
});
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
 const f=fixture(),expected=f.rows.map(row=>comparable(legacy.readOfflineSnapshot(row,f.cache()))),cache=f.cache(),snapshot=vi.spyOn(records.MatchRecorder.prototype,'snapshot'),apply=vi.spyOn(engine,'applyMove'),actual=f.rows.map(row=>source.readOfflineSnapshot(row,cache));
 expect(actual.map(comparable)).toEqual(expected);expect(snapshot).not.toHaveBeenCalled();expect(actual.every(s=>s.record===f.loaded.resume!.record)).toBe(true);expect(apply).toHaveBeenCalledTimes(Math.max(...f.rows.map(r=>r.key.moveNo)));
 actual[0].state.hands[0].pop();expect(comparable(source.readOfflineSnapshot(f.rows.at(-1)!,cache))).toBe(expected.at(-1));
});
it('batch sorts only internal work, preserves requested order and reports the original first error',()=>{
 const f=fixture(),rows=[f.rows.at(-1)!,f.rows[0],f.rows[1]],expected=rows.map(row=>comparable(legacy.readOfflineSnapshot(row,f.cache())));expect(typeof (source as any).readOfflineSnapshots).toBe('function');
 const apply=vi.spyOn(engine,'applyMove'),actual=(source as any).readOfflineSnapshots(rows,f.cache());expect(actual.map(comparable)).toEqual(expected);expect(apply).toHaveBeenCalledTimes(Math.max(...rows.map(r=>r.key.moveNo)));expect(actual[0].state).not.toBe(actual[1].state);
 const bad=rows[0],path=join(bad.recordRef.directory,`decision-${bad.key.requestSeq}.private.json`),input=JSON.parse(readFileSync(path,'utf8'));input.selectionBundle=null;writeFileSync(path,JSON.stringify(input));const first=outcome(()=>legacy.readOfflineSnapshot(bad,f.cache())).error;
 expect(()=> (source as any).readOfflineSnapshots([bad,{...f.rows[0],familyId:'wrong'}],f.cache())).toThrow(first);
});
it('retains row-local unknown, missing/game binding and nonmonotone-prefix results from the before reader',()=>{
 for(const options of [{unknown:true},{nonmonotonic:true},{}]){const f=fixture(options),cache=f.cache();for(const row of [...f.rows,{...f.rows[0],key:{...f.rows[0].key,gameNo:2}}])expect(outcome(()=>source.readOfflineSnapshot(row,cache))).toEqual(outcome(()=>legacy.readOfflineSnapshot(row,f.cache())));}
});
it('does not lend a verified prefix after its recorder changes or a different recordRef is supplied',()=>{
 const f=fixture(),cache=f.cache();source.readOfflineSnapshot(f.rows[0],cache);f.loaded.recorder.finish({complete:false,winner:null,incompleteReason:'synthetic-change'});
 expect(()=>source.readOfflineSnapshot(f.rows[0],cache)).toThrow(/record\/checkpoint bytes differ/);
 const changed={...f.rows[0],recordRef:{...f.rows[0].recordRef,journalSHA256:'f'.repeat(64)}};expect(()=>source.readOfflineSnapshot(changed,cache)).toThrow(/record\/checkpoint bytes differ/);
});
