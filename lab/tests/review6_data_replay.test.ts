import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {startGame,createMatch,DEFAULT_RULES,buildDeck,classify,makeLevelCtx} from '@gd/engine';
import {PublicTracker} from '@gd/ai';
import {codeOfCard,DEFAULT_MAPPING} from '../src/review5_tuning/kscbReplay';
import * as replay from '../review6/data-replay';
import sourceTributeFixture from './fixtures/review6-source-tribute.json';
import {computeResult} from '@gd/engine';
function state(){const s=startGame(createMatch({...DEFAULT_RULES},22)),pool=buildDeck();const take=(rank:number,n:number)=>pool.filter(c=>c.rank===rank).slice(0,n);const chosen=[...take(7,3),...take(5,2),...take(9,2)];const ids=new Set(chosen.map(c=>c.id));const filler=pool.filter(c=>!ids.has(c.id)&&!(c.suit==='H'&&c.rank===2)).slice(0,20);const own=[...chosen,...filler],used=new Set(own.map(c=>c.id)),rest=pool.filter(c=>!used.has(c.id));s.hands=[own,rest.slice(0,27),rest.slice(27,54),rest.slice(54,81)];s.turn=0;s.leader=0;s.lastCombo=null;return {s,chosen:chosen.filter(c=>c.rank!==5)};}
it('independent rule legality is retained when policy enumeration omits a legal resource variant',()=>{
 const api=replay as unknown as {inspectSourceAction:Function};expect(api.inspectSourceAction).toBeTypeOf('function');const {s,chosen}=state();
 expect(classify(chosen,s.ctx,s.match.opts).some(c=>c.kind==='trio_pair')).toBe(true);
 const result=api.inspectSourceAction(s,{event_id:3,uid:'P1',tiles:chosen.map(c=>codeOfCard(c,DEFAULT_MAPPING)),pattern:7},new PublicTracker(),[],[]);
 expect(result.targetRuleLegal).toBe(true);expect(result.candidateCovered).toBe(false);expect(result.reasons).toContain('enumerator_pruned_resource_variants');expect(result.usableForH).toBe(false);
});
it('hidden-card swaps preserve the current observation and proposal support; pass asserts only a choice',()=>{
 const api=replay as unknown as {inspectSourceAction:Function};expect(api.inspectSourceAction).toBeTypeOf('function');const {s}=state();
 const c=s.hands[1].find(c=>c.rank===3)!,combo=classify([c],s.ctx,s.match.opts)[0];s.lastCombo=combo;s.lastPlayer=1;
 const event={event_id:4,uid:'P1'},a=api.inspectSourceAction(s,event,new PublicTracker(),[],[]),other={...s,hands:s.hands.map(h=>[...h])};[other.hands[1][0],other.hands[3][0]]=[other.hands[3][0],other.hands[1][0]];
 const b=api.inspectSourceAction(other,event,new PublicTracker(),[],[]);expect(a.targetRuleLegal).toBe(true);expect(a.capacityInference).toBe('choice_only_capacity_unknown');expect(a.observationHash).toBe(b.observationHash);expect(a.candidateKeys).toEqual(b.candidateKeys);
});
it('a legal shape that cannot beat the target is not mislabeled as a level-rule difference',()=>{
 const api=replay as unknown as {inspectSourceAction:Function};const {s}=state();const owner=s.hands.findIndex((h,i)=>i!==0&&h.some(c=>c.rank===17)),card=s.hands[owner].find(c=>c.rank===17)!;s.hands[owner]=s.hands[owner].filter(c=>c.id!==card.id);s.lastCombo=classify([card],s.ctx,s.match.opts)[0];s.lastPlayer=owner;
 const result=api.inspectSourceAction(s,{event_id:3,uid:'P1',pattern:1,tiles:[codeOfCard(s.hands[0].find(c=>c.rank===5)!,DEFAULT_MAPPING)]},new PublicTracker(),[],[]);
 expect(result.targetRuleLegal).toBe(false);expect(result.reasons).toContain('target_response_does_not_beat');expect(result.reasons).not.toContain('source_rule_difference_level_sequence');
});
it('round reconstruction uses public stage context without reading future finish order or remaining hands',()=>{
 const api=replay as unknown as {buildSourceRound:Function,inspectSourceAction:Function};expect(api.buildSourceRound).toBeTypeOf('function');const {s,chosen}=state();
 const round={events:[{event_id:1,uid:'P1',tiles:[2,2]},...s.hands.map((h,i)=>({event_id:2,uid:`P${i+1}`,tiles:h.map(c=>codeOfCard(c,DEFAULT_MAPPING))})),{event_id:3,uid:'P1',pattern:7,tiles:chosen.map(c=>codeOfCard(c,DEFAULT_MAPPING))}],result:{players:[0,1,2,3].map(i=>({uid:`P${i+1}`,is_banker:i%2===0,win_index:i+1,hand:null}))}};
 const other=structuredClone(round);other.result.players.forEach((p,i)=>{p.win_index=4-i;(p as {hand:unknown}).hand=[94,95];});
 const a=api.buildSourceRound(round),b=api.buildSourceRound(other),event=round.events.at(-1)!;
 expect(api.inspectSourceAction(a.state,event,new PublicTracker(),[],a.knownTransfers).observationHash).toBe(api.inspectSourceAction(b.state,event,new PublicTracker(),[],b.knownTransfers).observationHash);
});
it('source bomb category includes a declared four-joker bomb',()=>{
 const api=replay as unknown as {inspectSourceAction:Function};const s=startGame(createMatch({...DEFAULT_RULES},3)),deck=buildDeck(),kings=deck.filter(c=>c.rank>=16),rest=deck.filter(c=>c.rank<16);s.hands=[[...kings,...rest.slice(0,23)],rest.slice(23,50),rest.slice(50,77),rest.slice(77,104)];s.turn=0;s.leader=0;s.lastCombo=null;
 const result=api.inspectSourceAction(s,{event_id:3,uid:'P1',pattern:8,tiles:kings.map(c=>codeOfCard(c,DEFAULT_MAPPING))},new PublicTracker(),[],[]);
 expect(result.targetRuleLegal).toBe(true);expect(result.declarationCount).toBe(1);expect(result.combo?.kind).toBe('joker_bomb');expect(result.usableForH).toBe(true);
});
it('real source second deals retain tribute state for returns and public resistance context',()=>{
 const api=replay as unknown as {buildSourceRound:Function};
 for(const item of sourceTributeFixture.matches){
  const first=api.buildSourceRound(item.rounds[0]),order=[...item.rounds[0].result.players].sort((a,b)=>(a.win_index||4)-(b.win_index||4)).map(p=>Number(p.uid.slice(1))-1);
  const previous=computeResult(order,first.context.levels,DEFAULT_RULES);
  const second=api.buildSourceRound(item.rounds[1],1,previous);
  expect(second.state.tribute).not.toBeNull();expect(second.state.pendingReturns).toHaveLength(0);
  if(item.matchId==='GD_MATCH_0043'){
   expect(second.state.tribute.resist).toBe(true);
   const firstAction=item.rounds[1].events.find(e=>e.event_id===3||e.event_id===4)!;
   const audit=(api as unknown as {inspectSourceAction:Function}).inspectSourceAction(second.state,firstAction,new PublicTracker(),[],second.knownTransfers);
   expect(audit.stateFeatures[315]).toBe(1);
  }
 }
});
it('a resistance round must verify the source first actor against the engine leader',()=>{
 const api=replay as unknown as {buildSourceRound:Function},item=sourceTributeFixture.matches.find(m=>m.matchId==='GD_MATCH_0043')!;
 const first=api.buildSourceRound(item.rounds[0]),order=[...item.rounds[0].result.players].sort((a,b)=>(a.win_index||4)-(b.win_index||4)).map(p=>Number(p.uid.slice(1))-1),previous=computeResult(order,first.context.levels,DEFAULT_RULES),bad=structuredClone(item.rounds[1]);
 const action=bad.events.find(e=>e.event_id===3||e.event_id===4)!;action.uid=`P${Number(action.uid.slice(1))%4+1}`;
 expect(()=>api.buildSourceRound(bad,1,previous)).toThrow(/actor|target|leader/);
});
it('a raw natural level single matches its necessary-effect candidate despite redundant wildcard annotation',()=>{
 const saved=JSON.parse(readFileSync('lab/review6_1/data/baseline-single-wildcard-incident-001.json','utf8')),state=saved.state;state.ctx=makeLevelCtx(state.levelsBefore,state.match.opts.levelMode,state.stageTeam);
 const result=replay.inspectSourceAction(state,{event_id:3,uid:`P${state.turn+1}`,tiles:[33],pattern:1} as any,new PublicTracker(),[],[]);
 expect(result.targetRuleLegal).toBe(true);expect(result.declarationCount).toBe(1);expect(result.candidateCovered).toBe(true);expect(result.targetIndices.length).toBe(1);expect(result.usableForH).toBe(true);
});
