import {describe,it,expect,vi} from 'vitest';
import {createMatch,startGame,DEFAULT_RULES,classify,applyMove} from '@gd/engine';
import {MatchRecorder,publicEngineEvents} from '../review6_2/match-record';
import {resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import type {DecisionKey} from '../../packages/ai/src/hybrid/protocol';

function fixture(){
 const state=startGame(createMatch({...DEFAULT_RULES},543)),changes:any[]=[];
 const recorder=new MatchRecorder({runId:'fixture-run',matchId:'fixture-match',sourceRef:'fixture-source',layoutRef:'fixture-layout',policyIds:['A','A','B','A'],rules:{...DEFAULT_RULES}},change=>changes.push(structuredClone(change)));
 recorder.beginGame(state);
 const key=(requestSeq=state.moveNo):DecisionKey=>({controllerOrRunnerGeneration:'fixture',matchId:'fixture-match',gameNo:state.match.gameNo,moveNo:state.moveNo,actorSeat:state.turn,requestSeq});
 const begin=(k=key())=>recorder.beginDecision({key:k,policyId:'A',initialCandidateIds:['fixture-action'],offeredIds:['fixture-action']});
 const first=key();begin(first);
 const combo=classify([state.hands[state.turn][0]],state.ctx,state.match.opts)[0],move=resolveLegalMove(state,{pass:false,combo}),priorTarget=state.lastCombo,events=applyMove(state,move as any);
 recorder.confirmAction({key:first,move:move as any,events,priorTarget,actionId:'fixture-action',requestedActionId:null,source:'B',status:'selected'});
 recorder.finishDecision({key:first,status:'selected',reason:null,elapsedMs:0,offeredIds:['fixture-action'],requests:[]});
 return {state,recorder,changes,key,begin,first,events};
}

describe('recorder prefix validation without discarded projection',()=>{
 it('validates the next prefix without allocating a public history copy',()=>{
  const f=fixture(),history=vi.spyOn(f.recorder,'history');f.begin();
  expect(history).not.toHaveBeenCalled();
  const snapshot=f.recorder.snapshot();
  expect(snapshot.record.decisions.map(d=>[d.key.moveNo,d.status,d.executionKind])).toEqual([[0,'selected','confirmed'],[1,'pending','none']]);
  expect(f.changes.map(c=>c.type)).toEqual(['game','decision','decision','decision','decision']);
  expect(f.changes.at(-1).value).toEqual(snapshot.record.decisions[1]);
 });
 it('keeps public history detached and excludes an unconfirmed later decision',()=>{
  const f=fixture();f.begin();const history=f.recorder.history(f.state.match.gameNo);
  expect(history).toEqual({matchId:'fixture-match',gameNo:f.state.match.gameNo,throughMoveNo:1,steps:[{events:publicEngineEvents(f.events),priorTarget:null}]});
  (history.steps[0].events as unknown[]).length=0;(history.steps as unknown[]).push({events:[],priorTarget:null});
  expect(f.recorder.history(f.state.match.gameNo).steps).toEqual([{events:publicEngineEvents(f.events),priorTarget:null}]);
  expect(f.recorder.snapshot().record.decisions[0].events).toEqual(publicEngineEvents(f.events));
 });
 it('retains duplicate key, missing move and noncontiguous-prefix rejection',()=>{
  const f=fixture();expect(()=>f.begin(f.first)).toThrow('decision identity conflict');
  expect(()=>f.begin({...f.key(),moveNo:f.state.moveNo+1})).toThrow('complete public prefix required before decision');
  expect(f.recorder.snapshot().record.decisions).toHaveLength(1);
  // Internal corruption is a deliberate negative fixture for the existing guard.
  (f.recorder as any).record.decisions[0].key.moveNo=2;
  expect(()=>f.begin()).toThrow('non-contiguous confirmed public prefix');
  expect(()=>f.recorder.history(f.state.match.gameNo)).toThrow('non-contiguous confirmed public prefix');
 });
 it('keeps unknown actions out of the prefix and preserves snapshot isolation',()=>{
  const f=fixture(),snapshot=f.recorder.snapshot();snapshot.record.decisions[0].events.length=0;
  expect(f.recorder.history(f.state.match.gameNo).throughMoveNo).toBe(1);
  f.recorder.finishDecision({key:f.first,status:'halted',reason:'execution_uncertain',elapsedMs:0,offeredIds:['fixture-action'],requests:[]});
  expect(f.recorder.history(f.state.match.gameNo).throughMoveNo).toBe(0);
  expect(()=>f.begin()).toThrow('complete public prefix required before decision');
  expect(f.recorder.snapshot().record.decisions[0].executionKind).toBe('unknown');
 });
});
