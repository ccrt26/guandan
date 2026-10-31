import {expect,it} from 'vitest';
import {applyMove,createMatch,DEFAULT_RULES,legalCombos,startGame,type GameRecord} from '@gd/engine';
import * as review from '../src/index';

function prefix(takeover=false):GameRecord {
 const match=createMatch({...DEFAULT_RULES},6102801),state=startGame(match);
 const rec:GameRecord={schemaVersion:2,id:'seat-display',matchId:'synthetic',createdAt:0,ruleOpts:match.opts,levelsBefore:[...state.levelsBefore],stageTeam:state.stageTeam,leader:state.leader,humanSeat:null,difficulties:[0,0,0,0],initialHands:state.hands.map(h=>[...h]),moves:[],result:null};
 for(let i=0;i<8;i++) {const player=state.turn,combo=legalCombos(state)[0],pass=state.lastCombo!==null&&(takeover?i%2===1:i%3!==0);applyMove(state,pass?{pass:true}:{pass:false,combo});rec.moves.push({moveNo:i+1,player,pass,cards:pass?undefined:combo.cards,comboKind:pass?undefined:combo.kind,mainRank:pass?undefined:combo.mainRank,handsAfter:state.hands.map(h=>h.length)});}
 return rec;
}
const api=review as typeof review & {displaySeatNumber?:(seat:number)=>number;displaySeatLabel?:(seat:number,viewer?:number|null,controller?:'human'|'ai'|null)=>{number:number;label:string;position:string;relation:string|null;controller:string;text:string}};
it('UI-MAP fixed numbers reject non-engine seats and do not rotate with viewer or invent a human',()=>{
 expect(api.displaySeatNumber).toBeTypeOf('function');expect(api.displaySeatLabel).toBeTypeOf('function');
 expect([0,1,2,3].map(api.displaySeatNumber!)).toEqual([1,4,2,3]);
 for(const invalid of [-1,4,0.5,NaN,Infinity])expect(()=>api.displaySeatNumber!(invalid)).toThrow();
 for(let viewer=0;viewer<4;viewer++) {const label=api.displaySeatLabel!(0,viewer,'ai');expect(label.label).toBe('1号');expect(label.position).toBe('下方');expect(label.controller).toBe('AI');expect(label.text).not.toContain('真人');}
 expect(api.displaySeatLabel!(0,0,null).controller).toBe('未记录');
 expect(api.displaySeatLabel!(2,0,'ai').relation).toBe('队友');
 expect(api.displaySeatLabel!(0,2,'human').controller).toBe('真人');
});
it('UI-MAP maps factual sentences but leaves engine fields, assertion IDs and input record bytes intact',()=>{
 const rec=prefix(),before=JSON.stringify(rec);
 for(let viewer=0;viewer<4;viewer++) {
  const facts=review.buildDecisionFactsV3(rec,2,viewer);
  expect(facts.actorSeat).toBe(rec.moves[1].player);expect(facts.viewerSeat).toBe(viewer);expect(facts.afterCounts).toEqual(rec.moves[1].handsAfter);
  expect(facts.actualActionId).toContain(`s${rec.moves[1].player}:`);
  const assertions=Object.fromEntries(facts.assertions.map(a=>[a.id,a.text]));
  expect(assertions.actor_and_viewer).toContain(`行动席 ${[1,4,2,3][facts.actorSeat]}号`);
  expect(assertions.actor_and_viewer).toContain(`观察席 ${[1,4,2,3][viewer]}号`);
  expect(assertions.target_and_owner).toContain(`控权席 ${[1,4,2,3][facts.currentTrickOwner!]}号`);
  expect(assertions.remaining_counts).toContain(facts.afterCounts.map((n,i)=>`${[1,4,2,3][i]}号 ${n}张`).join('、'));
  expect(facts.expectedAssertionIds).toContain(`seat-display#m2:v${viewer}:actor_and_viewer`);
 }
 expect(JSON.stringify(rec)).toBe(before);
});
it('UI-MAP decision ctx, team transfers, fact cards and strict coach acceptance share generated seat text',()=>{
 const rec=prefix();rec.tributes=[{kind:'tribute',from:1,to:3,card:rec.initialHands[3][0],atMove:0}];
 const before=JSON.stringify(rec),view={...rec,humanSeat:rec.moves[1].player};
 const tc=review.buildTeamContext(view,2)!;
 expect(tc.facts['tc-counts'].text).toContain('4号');expect(tc.facts['tc-transfers'].text).toContain('4号→3号');
 expect(tc.facts['tc-transfers'].sourceEventId).toBe('record.tributes');
 const ev=review.buildDecisionReviews(view,{moves:[2],maxPoints:1})[0];
 expect(ev.facts['f2-ctx']).toContain('1号');expect(ev.facts['f2-ctx']).not.toMatch(/[东南西北]家/);
 const raw=JSON.stringify({summary:'以下陈述原谱事实；策略优劣尚未验证。',lessons:[{decisionId:ev.decisionId,actionIds:[ev.actual.actionId],factIds:['f2-ctx'],claimIds:[],claimLevel:ev.claimLevel,title:'当前事实',text:ev.facts['f2-ctx']}]});
 expect(review.acceptCoachResponse(raw,[ev])).not.toBeNull();
 expect(review.acceptCoachResponse(raw.replace('1号','9号'),[ev])).toBeNull();
 expect(review.renderFactCards([ev],3)).toContain(ev.facts['f2-ctx']);
 expect(review.renderFactCards([ev],ev.seat)).not.toContain('(你)');
 expect(review.buildCoachJsonMessages([ev],[],3)[0].content).toContain('1号');
 const context={viewerSeat:3},cache=review.makeCoachCache(raw,[ev],context),parsed=JSON.parse(cache),witness=JSON.parse(parsed.witness);
 expect(witness.context.seatDisplayVersion).toBe(1);
 delete witness.context.seatDisplayVersion;parsed.witness=JSON.stringify(witness);
 expect(review.readCoachCache(JSON.stringify(parsed),[ev],context)).toBeNull();
 expect(review.readCoachCache(cache,[ev],context)).not.toBeNull();
 expect(JSON.stringify(rec)).toBe(before);
});

it('UI-MAP team takeover and legacy coach scripts share numbers without assuming the observer is human',()=>{
 const rec=prefix(true),before=JSON.stringify(rec);
 const team=review.buildTeamReview(rec,{viewerSeat:1});
 const takeover=team.events.find(event=>event.conditionalNext.startsWith('接管后控制权'));
 expect(takeover).toBeDefined();
 expect(takeover!.conditionalNext).toContain(`${[1,4,2,3][takeover!.actorSeat]}号`);
 const view={...rec,humanSeat:1},messages=review.buildCoachMessages(view,review.analyzeGame(view),[]);
 expect(messages[0].content).toContain('不表明该席由真人操控');
 expect(messages[1].content).toContain('观察席：4号，队友：3号');
 expect(messages[1].content).not.toMatch(/南（0）|东（1）|北（2）|西（3）/);
 expect(JSON.stringify(rec)).toBe(before);
});
