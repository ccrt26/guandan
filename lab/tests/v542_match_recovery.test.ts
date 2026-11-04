import {afterEach,expect,it,vi} from 'vitest';
vi.mock('node:fs',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs')>();return {...actual,readFileSync:vi.fn(actual.readFileSync)};});
import * as engine from '@gd/engine';
import * as fs from 'node:fs';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createDecisionBundle} from '../../packages/ai/src/hybrid/candidates';
import {dedupCandidates} from '../../packages/ai/src/nn/neuralSeat';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as records from '../review6_2/match-record';
import {runCompleteMatchAsync} from '../review6_2/match-play-async';
const id={runId:'fixture',matchId:'fixture',sourceRef:'synthetic',layoutRef:'fixture',policyIds:['B0','B1','B2','B3'],rules:engine.DEFAULT_RULES};
function fixture(capture=false){
 const directory=mkdtempSync(join(realpathSync(tmpdir()),'v542-match-recovery-')),store=records.createMatchStore(directory,id),state=engine.startGame(engine.createMatch({...id.rules},72));store.recorder.beginGame(state);
 const key={controllerOrRunnerGeneration:'fixture',matchId:id.matchId,gameNo:1,moveNo:0,actorSeat:state.turn,requestSeq:0},move={pass:false as const,combo:engine.legalCombos(state)[0]},priorTarget=state.lastCombo;
 const bundle=capture?createDecisionBundle({state,actorSeat:state.turn,key,decisionId:'fixture-decision',matchId:id.matchId,history:store.recorder.history(1),decider:{seat:state.turn,decide(){const rows=dedupCandidates(engine.legalCombos(state),engine.canPass(state));return {move,nCands:rows.length,explored:false,ranking:rows.map((r,idx)=>({combo:r.combo,idx,score:rows.length-idx}))};}}}):undefined;
 store.recorder.beginDecision({key,policyId:id.policyIds[state.turn],initialCandidateIds:bundle?.initialCandidateIds??['fixture-action'],offeredIds:bundle?.offeredIds??['fixture-action'],...(bundle?{bundle}:{})});const events=engine.applyMove(state,move);store.recorder.confirmAction({key,move,events,priorTarget,actionId:'fixture-action',requestedActionId:null,source:'B',status:'selected'});store.recorder.finishDecision({key,status:'selected',reason:null,elapsedMs:0,offeredIds:['fixture-action'],requests:[]});return {directory,store,state};
}
function options(recorder:records.MatchRecorder,resume:any){const abort=new AbortController();abort.abort('user_stop');return {...id,recorder,resume,generation:'fixture-resume',seed:72,dealNamespace:'synthetic',maxGames:1,maxMovesPerGame:8,actor:0,signal:abort.signal,deadlineMonotonicMs:performance.now()+5000,seats:id.policyIds.map((policyId,seat)=>({policyId,source:'B' as const,mode:'local' as const,decider:{seat,newGame(){},observe(){},decide(){throw Error('aborted fixture must not decide');}}}))};}
afterEach(()=>vi.restoreAllMocks());
it('transfers one validated load replay through consumer and runner with isolated mutable state',async()=>{
 const f=fixture(),apply=vi.spyOn(engine,'applyMove'),loaded=records.loadMatchStore(f.store.ref(),f.directory) as any;
 expect(loaded.resume).toBeDefined();
 const first=(records as any).replayMatchResume(loaded.resume),before=first.state.hands[0].length;first.state.hands[0].pop();
 const second=(records as any).replayMatchResume(loaded.resume);expect(second.state.hands[0]).toHaveLength(before);expect(Object.isFrozen(loaded.resume.record)).toBe(true);
 await runCompleteMatchAsync(options(loaded.recorder,loaded.resume));expect(apply).toHaveBeenCalledTimes(2); // load replay + unchanged final terminal proof
 const independent=structuredClone(loaded.resume),independentRecorder=records.MatchRecorder.restore(independent.record,independent.privateSources);apply.mockClear();
 await runCompleteMatchAsync(options(independentRecorder,independent));expect(apply).toHaveBeenCalledTimes(2); // independent initial + terminal proof
});
it('retains dynamic action replay and rejects unknown or invalid claimed-complete resumes',async()=>{
 const f=fixture(),snapshot=f.store.recorder.snapshot();snapshot.record.decisions[0].actualMove={pass:true};
 expect(()=>records.MatchRecorder.restore(snapshot.record,snapshot.privateSources)).toThrow();
 const unknown=f.store.recorder.snapshot();unknown.record.decisions[0].executionKind='unknown';unknown.record.decisions[0].status='halted';
 await expect(runCompleteMatchAsync(options(records.MatchRecorder.restore(unknown.record,unknown.privateSources),unknown))).rejects.toThrow(/nonrecoverable/);
 const claimed=f.store.recorder.snapshot();claimed.record.summary={complete:true,winner:0,incompleteReason:null};expect(()=>records.MatchRecorder.restore(claimed.record,claimed.privateSources)).toThrow(/complete engine match/);
});

it('reads one private decision file once per journal load and still rejects per-event SHA conflicts',()=>{
 const f=fixture(true),path=join(f.store.ref().directory,'decision-0.private.json'),read=vi.mocked(fs.readFileSync);
 read.mockClear();records.loadMatchStore(f.store.ref(),f.directory);expect(read.mock.calls.filter(c=>c[0]===path)).toHaveLength(1);
 read.mockClear();records.loadMatchStore(f.store.ref(),f.directory);expect(read.mock.calls.filter(c=>c[0]===path)).toHaveLength(1);
 const journalPath=join(f.store.ref().directory,'events.jsonl'),events=readFileSync(journalPath,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 const decisions=events.filter(e=>e.type==='decision');expect(decisions).toHaveLength(3);decisions[1].value.trainingInputSHA256='f'.repeat(64);
 const bytes=events.map(e=>JSON.stringify(e)).join('\n')+'\n';writeFileSync(journalPath,bytes);const ref={...f.store.ref(),journalBytes:Buffer.byteLength(bytes),journalSHA256:createHash('sha256').update(bytes).digest('hex')};
 expect(()=>records.loadMatchStore(ref,f.directory)).toThrow(/private decision input changed/);
});

it('keeps journal intent ordering and terminal action conflict checks on every event',()=>{
 const f=fixture(true),path=join(f.store.ref().directory,'events.jsonl'),original=readFileSync(path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 const load=(events:any[])=>{const bytes=events.map(e=>JSON.stringify(e)).join('\n')+'\n';writeFileSync(path,bytes);return records.loadMatchStore({...f.store.ref(),journalBytes:Buffer.byteLength(bytes),journalSHA256:createHash('sha256').update(bytes).digest('hex')},f.directory);};
 expect(()=>load(original.filter((_,i)=>i!==1))).toThrow(/missing decision intent/);
 const conflicting=structuredClone(original);conflicting.at(-1).value.actualMove={pass:true};expect(()=>load(conflicting)).toThrow(/terminal action journal conflict/);
 const terminal=structuredClone(original);terminal[2].value.status='halted';expect(()=>load(terminal)).toThrow(/terminal action journal conflict/);
});

it('rejects a within-load equal-length private input rewrite after the first read',async()=>{
 const f=fixture(true),path=join(f.store.ref().directory,'decision-0.private.json'),actual=await vi.importActual<typeof import('node:fs')>('node:fs'),read=vi.mocked(fs.readFileSync);let changed=false;
 read.mockImplementation(((...args:any[])=>{const bytes=(actual.readFileSync as any)(...args);if(args[0]===path&&!changed){changed=true;const altered=String(bytes).replace('B0','X0');expect(Buffer.byteLength(altered)).toBe(Buffer.byteLength(bytes));writeFileSync(path,altered);}return bytes;}) as typeof readFileSync);
 expect(()=>records.loadMatchStore(f.store.ref(),f.directory)).toThrow(/private decision input changed/);read.mockImplementation(actual.readFileSync);
});
