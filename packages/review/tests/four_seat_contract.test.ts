import {expect,it} from 'vitest';
import {applyMove,createMatch,DEFAULT_RULES,legalCombos,startGame,type GameRecord} from '@gd/engine';
import {buildDecisionReviews,renderFactCards,analyzeGame,runCounterfactual} from '../src/index';
function prefix():GameRecord{
 const m=createMatch({...DEFAULT_RULES},6102801),s=startGame(m);
 const rec:GameRecord={schemaVersion:2,id:'four-seat-contract',matchId:'four-seat-contract',createdAt:0,ruleOpts:m.opts,levelsBefore:[...s.levelsBefore],stageTeam:s.stageTeam,leader:s.leader,humanSeat:0,difficulties:[0,0,0,0],initialHands:s.hands.map(h=>[...h]),moves:[],result:null};
 for(let i=0;i<12;i++){const actor=s.turn,c=legalCombos(s)[0],pass=!c;applyMove(s,pass?{pass:true}:{pass:false,combo:c});rec.moves.push({moveNo:i+1,player:actor,pass,cards:pass?undefined:c.cards,comboKind:pass?undefined:c.kind,mainRank:pass?undefined:c.mainRank,handsAfter:s.hands.map(h=>h.length)});}return rec;
}
it('actual evidence and coach prompts bind relative stage and own-seat labels for every viewer',()=>{
 const rec=prefix();
 for(let viewer=0;viewer<4;viewer++){
  const move=rec.moves.find(m=>m.player===viewer)!;
  const ev=buildDecisionReviews({...rec,humanSeat:viewer},{moves:[move.moveNo],maxPoints:1})[0];
  const relation=viewer%2===rec.stageTeam?'我方':'对方';
  expect(ev.facts[`f${move.moveNo}-rule`]).toContain(`台上=${relation}`);
  const text=(renderFactCards as Function)([ev],viewer);
  expect(text).toContain(`台上=${relation}`);expect(text).toContain(`${['南','东','北','西'][viewer]}(你)出`);
 }
});
it('counterfactual refuses a root whose actor does not match the scoped viewer',async()=>{
 const rec=prefix(),analysis=analyzeGame({...rec,humanSeat:1});const move=analysis.moves[0];
 expect(move).toBeDefined();await expect(runCounterfactual(rec,[{...move,grade:'divergent',scoreGap:100}],{maxDecisions:1})).rejects.toThrow(/actor|viewer|seat/);
});
it('the displayed review preference and counterfactual root identify the same alternative and source',async()=>{
 const rec={...prefix(),humanSeat:1},analysis=analyzeGame(rec),root={...analysis.moves[0],grade:'divergent' as const,scoreGap:100};
 const evidence=buildDecisionReviews(rec,{moves:[root.moveNo],maxPoints:1})[0];
 const result=(await runCounterfactual(rec,[root],{maxDecisions:1}))[0];
 expect(result.sourceId).toBe(evidence.heuristic.sourceId);expect(result.alternativeActionId).toBe(evidence.heuristic.topActionId);
});
import declarationFixture from './fixtures/review6-declaration-rule-context-2.json';
it('the actual branch preserves the recorded wildcard declaration and rejects unverifiable declarations',async()=>{
 const {record:raw}=declarationFixture;
 const rec={...raw,humanSeat:2} as GameRecord,analysis=analyzeGame(rec),move=analysis.moves.find(m=>m.moveNo===4)!;
 expect(move.grade).toBe('divergent');const ev=buildDecisionReviews(rec,{moves:[4],maxPoints:1})[0];
 expect(ev.actual.actionId).toBe('flush:8:5:5#C5,C6,C7,C8,H2');
 const actual=(await runCounterfactual(rec,[move],{maxDecisions:1}))[0];expect(actual.actualActionId).toBe(ev.actual.actionId);
 const bad=structuredClone(rec);bad.moves.find(m=>m.moveNo===4)!.mainRank=7;
 await expect(runCounterfactual(bad,[move],{maxDecisions:1})).rejects.toThrow(/declar|声明/);
});
