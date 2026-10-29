import { expect, it } from 'vitest';
import { applyMove, createMatch, DEFAULT_RULES, legalCombos, startGame, type GameRecord } from '@gd/engine';
import * as review from '../src/index';

// Full legal initial deal; each move is applied by the real engine before it is recorded.
function recordPrefix(): GameRecord {
 const match=createMatch({...DEFAULT_RULES},6102801),state=startGame(match);
 const rec:GameRecord={schemaVersion:2,id:'r6-facts',matchId:'r6-dev',createdAt:0,ruleOpts:match.opts,levelsBefore:[...state.levelsBefore],stageTeam:state.stageTeam,leader:state.leader,humanSeat:0,difficulties:[0,0,0,0],initialHands:state.hands.map(h=>[...h]),moves:[],result:null};
 for(let i=0;i<12;i++){
  const actor=state.turn,combo=legalCombos(state)[0],prior=state.lastCombo;
  const pass=prior!==null && i%3!==0;
  applyMove(state,pass?{pass:true}:{pass:false,combo});
  rec.moves.push({moveNo:i+1,player:actor,pass,cards:pass?undefined:combo.cards,comboKind:pass?undefined:combo.kind,mainRank:pass?undefined:combo.mainRank,handsAfter:state.hands.map(h=>h.length)});
 }
 return rec;
}
const getBuilder=()=>{
 const fn=(review as unknown as {buildDecisionFactsV3?:Function}).buildDecisionFactsV3;
 expect(fn,'fact-only build must work without any neural weights').toBeTypeOf('function');return fn!;
};
it('viewer rotation preserves actor, physical action, target and checked counts',()=>{
 const rec=recordPrefix(),build=getBuilder();const actual=rec.moves[1];
 for(let viewer=0;viewer<4;viewer++){
  const card=build(rec,actual.moveNo,viewer);
  expect(card.actorSeat).toBe(actual.player);expect(card.viewerSeat).toBe(viewer);
  expect(card.actualActionId).toContain(`s${actual.player}:`);
  expect(card.actualActionId).toContain(`m${actual.moveNo}:`);
  expect(card.afterCounts).toEqual(actual.handsAfter);
  expect(card.assertions.length).toBeGreaterThanOrEqual(6);
  expect(card.expectedAssertionIds).toHaveLength(card.assertions.length);
  expect(card.assertions.every((a:{checked:boolean})=>a.checked)).toBe(true);
  expect(card.policyAdvice.nn).toBeNull();expect(card.policyAdvice.search).toBeNull();
  expect(card.expressionScope).toContain('尚未证明');
 }
});
it('legal pass cannot turn into a claim that the player had no beating cards',()=>{
 const rec=recordPrefix(),card=getBuilder()(rec,2,3);
 expect(card.actual.pass).toBe(true);expect(card.actual.cardCount).toBe(0);
 expect(card.passInference).toBe('choice_only_capacity_unknown');
 expect(JSON.stringify(card)).not.toMatch(/必定压不动|一定压不过/);
});
it('future events do not affect the pre-action observation',()=>{
 const rec=recordPrefix(),build=getBuilder(),a=build(rec,2,0);
 const other={...rec,moves:rec.moves.slice(0,2),result:null};const b=build(other,2,0);
 expect(a.observationHash).toBe(b.observationHash);expect(a.revealedFacts).toEqual(b.revealedFacts);
});
it('a wrong actor or invented after-count fails instead of becoming a verified card',()=>{
 const rec=recordPrefix(),build=getBuilder();
 const bad=structuredClone(rec);bad.moves[1].player=(bad.moves[1].player+1)%4;
 expect(()=>build(bad,2,0)).toThrow();
 const badCount=structuredClone(rec);badCount.moves[1].handsAfter[0]=999;
 expect(()=>build(badCount,2,0)).toThrow();
});
it('fact card rejects a missing move and an invalid viewing seat',()=>{
 const rec=recordPrefix(),build=getBuilder();
 expect(()=>build(rec,999,0)).toThrow();expect(()=>build(rec,1,4)).toThrow();
});
it('a malformed initial card ledger cannot receive verified fact assertions',()=>{
 const rec=recordPrefix(),build=getBuilder(),bad=structuredClone(rec);bad.initialHands[0][0]=bad.initialHands[1][0];
 expect(()=>build(bad,1,0)).toThrow();
});
it('unrecognized fields attached to raw history cannot enter the legal observation',()=>{
 const rec=recordPrefix(),build=getBuilder(),baseline=build(rec,2,0),tainted=structuredClone(rec);
 Object.assign(tainted.moves[0],{futureWinner:1,opponentHiddenCards:['oracle']});
 const card=build(tainted,2,0);expect(card.revealedFacts).toEqual(baseline.revealedFacts);expect(card.observationHash).toBe(baseline.observationHash);
});
