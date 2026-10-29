import{describe,it,expect}from'vitest';
import{createMatch,startGame,DEFAULT_RULES,legalCombos,canPass,makeLevelCtx,classify,applyMove}from'@gd/engine';
import{readFileSync}from'node:fs';
import{runCompleteMatch,indexedDealSeed,resolveLegalMove,type SeatDriver}from'../review6/match-play';
const specs=[0,1,2,3].map(seat=>({policyId:'test-seat-'+seat,kind:'test' as any}));
const firstFactory=(seen:number[])=>((_spec:any,seat:number):SeatDriver=>({policyId:'test-seat-'+seat,newGame(){},observe(){},decide(state){seen.push(seat);const combos=legalCombos(state);return combos.length?{pass:false,combo:combos[0]}:{pass:true};}}));
describe('REVIEW6 complete-match foundation',()=>{
 it('incomplete cap remains unmeasured, not a loss or a fabricated g+W',()=>{const r=runCompleteMatch({seed:17,policies:specs,maxGames:0,seatFactory:firstFactory([])});expect(r.complete).toBe(false);expect(r.winner).toBeNull();expect(r.games).toBe(0);expect(r.rootTeamTarget).toBeNull();});
 it('indexed future deals do not consume any policy or trajectory RNG',()=>{expect(indexedDealSeed('paired-world',71,3)).toBe(indexedDealSeed('paired-world',71,3));expect(indexedDealSeed('paired-world',71,3)).not.toBe(indexedDealSeed('paired-world',71,4));});
 it('four seats retain distinct policies and illegal output cannot silently fall back',()=>{
  const seen:number[]=[],r=runCompleteMatch({seed:31,policies:specs,maxMovesPerGame:16,maxGames:1,seatFactory:firstFactory(seen)});expect(new Set(seen).size).toBe(4);expect(r.complete).toBe(false);expect(r.policyIds).toEqual(specs.map(s=>s.policyId));
  expect(()=>runCompleteMatch({seed:31,policies:specs,seatFactory:(_s,seat)=>({policyId:'bad-'+seat,newGame(){},observe(){},decide(){return{pass:true};}})})).toThrow(/illegal|领出|pass/i);
 });
 it('declared effects and physical ownership are checked independently before applyMove',()=>{
  const state=startGame(createMatch({...DEFAULT_RULES},19)),combo=legalCombos(state)[0];
  expect(resolveLegalMove(state,{pass:false,combo}).pass).toBe(false);
  expect(()=>resolveLegalMove(state,{pass:false,combo:{...combo,mainRank:combo.mainRank+1,keyRank:combo.keyRank+1}})).toThrow(/declared|legal|identity/);
  expect(()=>resolveLegalMove(state,{pass:true})).toThrow(/pass|领出/i);
 });
 it('root continuation runs through actual match winner and uses root-round g plus final W only',()=>{
  const match=createMatch({...DEFAULT_RULES},331);match.levels=[14,14];const root=startGame(match);
  const r=runCompleteMatch({seed:331,policies:specs,rootState:root,actingSeat:0,maxGames:80,seatFactory:firstFactory([])});
  expect(r.complete).toBe(true);expect(r.rootRoundResult).not.toBeNull();const g=r.rootRoundResult!.winnerTeam===0?r.rootRoundResult!.upgrade:-r.rootRoundResult!.upgrade;
  expect(r.rootTeamTarget).toBe(g+(r.winner===0?1:-1));expect(r.rootTeamTarget).toBeGreaterThanOrEqual(-4);expect(r.rootTeamTarget).toBeLessThanOrEqual(4);
  expect(root.over).toBe(false);expect(root.match.winner).toBeNull();
 });
});
it('forced root requires explicit matching actor even before any compute',()=>{
 const root=startGame(createMatch({...DEFAULT_RULES},190)),combo=legalCombos(root)[0];
 expect(()=>runCompleteMatch({seed:190,policies:specs,rootState:root,forcedRootMove:{pass:false,combo},maxGames:0,seatFactory:firstFactory([])})).toThrow(/actor/);
});
it('counter-based policies reproduce the same suffix from a causal prefix including forced root',()=>{
 const policies=[0,1,2,3].map(seat=>({policyId:'counter-heur0-'+seat,kind:'heuristic' as const,difficulty:0 as const}));
 let root:any=null,prefix:any=null,forcedMove:any=null;const full:string[]=[],suffix:string[]=[];
 runCompleteMatch({seed:88,policies,maxGames:1,onAfterDecision({state,history,move}){if(state.moveNo===12){root=structuredClone(state);prefix=structuredClone(history);}if(state.moveNo===13)forcedMove=structuredClone(move);if(state.moveNo>12)full.push(JSON.stringify({actor:history.at(-1)?.events[0],move}));}});
 expect(root).not.toBeNull();
 runCompleteMatch({seed:88,policies,maxGames:1,rootState:root,rootHistory:prefix,actingSeat:root.turn,forcedRootMove:forcedMove,onAfterDecision({history,move}){suffix.push(JSON.stringify({actor:history.at(-1)?.events[0],move}));}});
 expect(suffix).toEqual(full);
});
it('real old policy natural level single remains legal despite redundant wildcard annotation',()=>{
 const saved=JSON.parse(readFileSync('lab/review6_1/data/baseline-single-wildcard-incident-001.json','utf8')),state=saved.state;state.ctx=makeLevelCtx(state.levelsBefore,state.match.opts.levelMode,state.stageTeam);
 const before=JSON.stringify(saved.selected);expect(resolveLegalMove(state,saved.selected)).toEqual(saved.selected);expect(JSON.stringify(saved.selected)).toBe(before);
 const falseRank=structuredClone(saved.selected);falseRank.combo.wildAs[0].asRank=13;expect(()=>resolveLegalMove(state,falseRank)).toThrow(/declared|wild|legal/);
});
it('a frozen 399 policy cannot silently use the default 385 encoder or missing public context mode',()=>{
 const path='lab/review6_1/data/H-features-001/clean-parent.f32',spec={policyId:'dimension-negative-only',kind:'neural' as const,weightsPath:path,weightsSHA256:'d5ff100135d969591f92435d02f3af0ef3554fb99b3ac959c23d8ee26894ca01',inputDim:399,epsilon:0,encoder:{passEncoding:'action64' as const}};
 expect(()=>runCompleteMatch({seed:3,policies:[spec,spec,spec,spec],maxGames:0})).toThrow(/encoder|schema|dimension/);
 expect(()=>runCompleteMatch({seed:3,policies:Array.from({length:4},()=>({...spec,encoder:{...spec.encoder,schema:'v2' as const}})),maxGames:0})).toThrow(/context|ctxFill/);
});
it('flush declaration must retain its actual suit and necessary wildcard rank/suit',()=>{
 const state=startGame(createMatch({...DEFAULT_RULES},130)),all=state.hands.flat(),cards=[...Array.from({length:4},(_,i)=>all.find(c=>c.suit==='S'&&c.rank===i+5)!),all.find(c=>c.suit==='H'&&c.rank===2)!],wanted=new Set(cards.map(c=>c.id));state.turn=0;state.leader=0;state.lastPlayer=0;
 for(const card of cards)if(!state.hands[0].some(c=>c.id===card.id)){const owner=state.hands.findIndex(h=>h.some(c=>c.id===card.id)),index=state.hands[owner].findIndex(c=>c.id===card.id),replace=state.hands[0].findIndex(c=>!wanted.has(c.id));[state.hands[owner][index],state.hands[0][replace]]=[state.hands[0][replace],state.hands[owner][index]];}
 const combo=classify(cards,state.ctx,state.match.opts).find(c=>c.kind==='flush'&&c.mainRank===8)!;expect(combo).toBeTruthy();expect(resolveLegalMove(state,{pass:false,combo}).combo).toBe(combo);
 expect(()=>resolveLegalMove(state,{pass:false,combo:{...combo,suit:'D'}})).toThrow(/declared|legal|suit/);
 const wrongRank=structuredClone(combo);wrongRank.wildAs[0].asRank=13;expect(()=>resolveLegalMove(state,{pass:false,combo:wrongRank})).toThrow(/declared|legal/);
 const wrongSuit=structuredClone(combo);wrongSuit.wildAs[0].asSuit='D';expect(()=>resolveLegalMove(state,{pass:false,combo:wrongSuit})).toThrow(/declared|legal/);
});
it('mid-round continuation requires the full causal public history and rejects truncated or forged prefixes',()=>{
 let root:any=null,history:any=null;runCompleteMatch({seed:88,policies:specs,maxGames:1,seatFactory:firstFactory([]),onAfterDecision(value){if(value.state.moveNo===12){root=structuredClone(value.state);history=structuredClone(value.history);}}});expect(root).not.toBeNull();
 const options={seed:88,policies:specs,rootState:root,actingSeat:root.turn,maxGames:0,seatFactory:firstFactory([])};
 expect(()=>runCompleteMatch(options)).toThrow(/history|prefix/);
 expect(()=>runCompleteMatch({...options,rootHistory:history.slice(1)})).toThrow(/history|prefix/);
 const forged=structuredClone(history);forged[0].priorTarget={kind:'single',cards:[],size:1,keyRank:99,length:1,pairRanks:[],mainRank:99,wildAs:[]};expect(()=>runCompleteMatch({...options,rootHistory:forged})).toThrow(/history|prefix|target/);
 expect(()=>runCompleteMatch({...options,rootHistory:history})).not.toThrow();
});
it('a round-move stop reports its actual reason even when the game-count limit is also reached',()=>{const r=runCompleteMatch({seed:17,policies:specs,maxGames:1,maxMovesPerGame:0,seatFactory:firstFactory([])});expect(r.incompleteReason).toBe('round_move_cap');expect(r.winner).toBeNull();expect(r.rootTeamTarget).toBeNull();});
it('an expired monotonic execution deadline stops before any game and leaves the result unmeasured',()=>{const r=runCompleteMatch({seed:17,policies:specs,deadlineMonotonicMs:0,seatFactory:firstFactory([])});expect(r.incompleteReason).toBe('deadline');expect(r.games).toBe(0);expect(r.decisions).toBe(0);expect(r.winner).toBeNull();expect(r.rootTeamTarget).toBeNull();});
it('root target cannot default to another team or accept an out-of-range evaluation actor',()=>{
 const root=startGame(createMatch({...DEFAULT_RULES},17));
 expect(()=>runCompleteMatch({seed:17,policies:specs,rootState:root,maxGames:0,seatFactory:firstFactory([])})).toThrow(/actor/);
 expect(()=>runCompleteMatch({seed:17,policies:specs,actingSeat:4,maxGames:0,seatFactory:firstFactory([])})).toThrow(/actor/);
 expect(()=>runCompleteMatch({seed:17,policies:specs,rootState:root,actingSeat:(root.turn+1)%4,maxGames:0,seatFactory:firstFactory([])})).toThrow(/actor/);
});
it('same resource multiset cannot hide swapped physical-card IDs in the selected event',()=>{
 const state=startGame(createMatch({...DEFAULT_RULES},130));state.turn=0;state.leader=0;state.lastPlayer=0;const all=state.hands.flat(),cards=[all.find(c=>c.id===7)!,all.find(c=>c.id===67)!],wanted=new Set([7,67]);
 for(const card of cards)if(!state.hands[0].some(c=>c.id===card.id)){const owner=state.hands.findIndex(h=>h.some(c=>c.id===card.id)),index=state.hands[owner].findIndex(c=>c.id===card.id),replace=state.hands[0].findIndex(c=>!wanted.has(c.id));[state.hands[owner][index],state.hands[0][replace]]=[state.hands[0][replace],state.hands[owner][index]];}
 const good=classify(cards,state.ctx,state.match.opts).find(c=>c.kind==='pair'&&c.mainRank===9)!;expect(resolveLegalMove(state,{pass:false,combo:good}).combo).toBe(good);
 const bad=structuredClone(good);bad.cards=bad.cards.map(c=>({...c,id:c.id===7?67:7}));bad.wildAs=bad.wildAs.map(w=>({...w,cardId:w.cardId===67?7:67}));expect(()=>resolveLegalMove(state,{pass:false,combo:bad})).toThrow(/physical|identity|owned/);
});
it('a full conserved second-round deal still must preserve public tribute and return ownership',()=>{
 const match=createMatch({...DEFAULT_RULES},713);let root=startGame(match);while(!root.over){const combo=legalCombos(root)[0];applyMove(root,combo?{pass:false,combo}:{pass:true});}root=startGame(match);
 const options={seed:713,policies:specs,rootState:root,rootHistory:[],actingSeat:root.turn,maxGames:0,seatFactory:firstFactory([])};expect(()=>runCompleteMatch(options)).not.toThrow();
 const gift=root.tribute!.tributes.find(t=>root.hands[t.to].some(c=>c.id===t.card.id))!,bad=structuredClone(root),other=[0,1,2,3].find(s=>s!==gift.to&&s!==root.turn)!,i=bad.hands[gift.to].findIndex(c=>c.id===gift.card.id);[bad.hands[gift.to][i],bad.hands[other][0]]=[bad.hands[other][0],bad.hands[gift.to][i]];
 expect(()=>runCompleteMatch({...options,rootState:bad})).toThrow(/tribute|return|exchange|known/i);
 const falseResist=structuredClone(root);falseResist.tribute={resist:true,tributes:[],returns:[],leader:root.tribute!.leader};expect(()=>runCompleteMatch({...options,rootState:falseResist})).toThrow(/tribute|resist|exchange/i);
});
it('continuation root rejects future terminal fields and inconsistent public level context',()=>{
 const root=startGame(createMatch({...DEFAULT_RULES},17)),base={seed:17,policies:specs,rootState:root,actingSeat:root.turn,maxGames:0,seatFactory:firstFactory([])};
 expect(()=>runCompleteMatch({...base,rootState:{...root,match:{...root.match,winner:0}}})).toThrow(/terminal|winner/);
 expect(()=>runCompleteMatch({...base,rootState:{...root,ctx:makeLevelCtx([14,14],'stage',0)}})).toThrow(/context|level/);
});
it('own-only DSL controls the requested legal root action and cannot redirect a partner',async()=>{const{necessaryDeclarationKey}=await import('../review6/action-effect'),root=startGame(createMatch({...DEFAULT_RULES},190)),actor=root.turn,combo=legalCombos(root).at(-1)!,yes={op:'eq',field:'myTurn',value:true},no={op:'eq',field:'myTurn',value:false},program={schemaVersion:'r6-plan-dsl-v1',planId:'test-plan',rootId:'test-root',goal:'preserve_structure',condition:yes,trigger:yes,invalidateWhen:no,fallback:'frozen_continuation',maxOwnActions:1,steps:[{trigger:yes,invalidateWhen:no,select:{kind:'exact_action',actionKey:necessaryDeclarationKey(combo,root.ctx)}}]},moves:any[]=[];
 const options:any={seed:190,policies:specs,rootState:root,actingSeat:actor,maxGames:1,maxMovesPerGame:8,seatFactory:firstFactory([]),ownPlan:{program,rootId:'test-root',actor},onAfterDecision:(v:any)=>moves.push({seat:v.seat,move:v.move,control:v.control})};const result:any=runCompleteMatch(options);expect(moves[0].move.combo).toEqual(combo);expect(moves[0].control.source).toBe('own_plan');expect(result.ownPlanSummary.controlledDecisions).toBe(1);expect(moves.filter(v=>v.control.source==='own_plan').every(v=>v.seat===actor)).toBe(true);expect(()=>runCompleteMatch({...options,ownPlan:{...options.ownPlan,actor:(actor+2)%4},maxGames:0})).toThrow(/own|actor|seat/);
});
