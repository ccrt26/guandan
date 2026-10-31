import React from 'react';
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createMatch,startGame,DEFAULT_RULES,applyMove,legalCombos,type GameRecord} from '@gd/engine';
import {GameTable} from '../src/ui/gt/GameTable';
import {Stage} from '../src/ui/gp/Stage';
import {gtFixtureVM} from '../src/ui/gt/fixture';
import {fixtureVM} from '../src/ui/gp/fixture';
import {buildGameTableVM} from '../src/ui/gt/viewmodel';
import {DecisionFactsPanel} from '../src/ui/DecisionFactsPanel';
import {RecordedSeats} from '../src/ui/RecordedSeats';
import {ExchangeHistory} from '../src/ui/gt/ExchangeHistory';
// Rendering only: policy loading is an effect and must never execute in this finite fixture.
vi.mock('../src/game/policy',()=>({loadRecordedWebPolicy:()=>{throw Error('UI-MAP must not load weights');}}));
const render=(component:React.ReactElement)=>renderToStaticMarkup(component);
it('UI-MAP gp/gt actual rendered names and ARIA use 2/3/4 without changing CSS geometry',()=>{
 const gt=gtFixtureVM('normal');gt.passes={north:true,west:true,east:true,self:true};
 const html=render(React.createElement(GameTable,{vm:gt}));
 for(const [seat,label] of [['north','2号'],['west','3号'],['east','4号'],['self','1号']])expect(html).toContain(`aria-label="${label}不出"`);
 for(const cls of ['gt-p-north','gt-p-west','gt-p-east'])expect(html).toContain(cls);
 expect(html).not.toMatch(/东家|西家|北家|南家/);
 vi.stubGlobal('window',{innerWidth:2560,innerHeight:1440});
 let gp:string;try{gp=render(React.createElement(Stage,{vm:fixtureVM()}));}finally{vi.unstubAllGlobals();}
 for(const n of [1,2,3,4])expect(gp).toContain(`${n}号已出的牌`);
 expect(gp).not.toMatch(/东家|西家|北家|南家/);
});
it('UI-MAP real view model and exchange/history map transfer endpoints independently of roles',()=>{
 const state=startGame(createMatch({...DEFAULT_RULES},123));
 const pair={tribute:{from:1,to:0,card:state.hands[0][0]},ret:{from:0,to:1,card:state.hands[1][0]}};
 const controller:any={humanTurn:false,humanReturning:false,hasHumanSeat:false,tableCombos:[null,null,null,null],sortedHand:(s:number)=>state.hands[s],exchangeAckPending:true,exchangeResult:()=>({leader:1,version:'fixture',pairs:[pair]}),canAcknowledgeExchange:true,exchangeError:null};
 const vm=buildGameTableVM(controller,state,{selection:new Set(),validCombo:null,returnCard:null});
 expect(vm.players.map(p=>p.name)).toEqual(['2号','3号','4号']);
 expect(vm.exchange?.pairs[0].tribute.fromName).toBe('4号');expect(vm.exchange?.pairs[0].tribute.toName).toBe('1号');
 const html=render(React.createElement(ExchangeHistory,{entries:[{version:'fixture',gameNo:1,confirmedAt:null,pairs:[pair]} as any],onClose:()=>{}}));
 expect(html).toContain('4号 → 1号');expect(html).not.toContain('东家');
});
it('UI-MAP historical all-AI and missing controller records never infer human from display 1',()=>{
 const allAI={humanSeat:null} as GameRecord;
 const html=render(React.createElement(RecordedSeats,{record:allAI}));
 expect(html).toContain('1号');expect(html).toContain('AI');expect(html).not.toContain('真人');
 const missing=render(React.createElement(RecordedSeats,{record:{} as GameRecord}));
 expect(missing).toContain('未记录');expect(missing).not.toContain('真人');
 const different=render(React.createElement(RecordedSeats,{record:{humanSeat:1} as GameRecord}));
 expect(different).toContain('4号');expect(different).toContain('真人');
 const autopilot=render(React.createElement(RecordedSeats,{record:{humanSeat:0,aiPolicies:['autopilot:L1','heuristic','heuristic','heuristic']} as GameRecord}));
 expect(autopilot).not.toContain('真人');
});
it('UI-MAP DecisionFactsPanel maps actor/viewer/owner and individual after-counts, not incident IDs',()=>{
 const match=createMatch({...DEFAULT_RULES},123),state=startGame(match);
 const record:GameRecord={schemaVersion:2,id:'ui-map',matchId:'fixture',createdAt:0,ruleOpts:match.opts,levelsBefore:[...state.levelsBefore],stageTeam:state.stageTeam,leader:state.leader,humanSeat:null,difficulties:[0,0,0,0],initialHands:state.hands.map(h=>[...h]),moves:[],result:null};
 for(let i=0;i<2;i++){const player=state.turn,combo=legalCombos(state)[0];applyMove(state,{pass:false,combo});record.moves.push({moveNo:i+1,player,pass:false,cards:combo.cards,comboKind:combo.kind,mainRank:combo.mainRank,handsAfter:state.hands.map(h=>h.length)});}
 const before=JSON.stringify(record),actor=record.moves[1].player,owner=record.moves[0].player;
 const html=render(React.createElement(DecisionFactsPanel,{record,moveNo:2,viewerSeat:1,identity:{},evidence:null}));
 expect(html).toContain(`行动席 ${[1,4,2,3][actor]}号 / 观察席 4号`);
 expect(html).toContain(`控权席：${[1,4,2,3][owner]}号`);
 for(let seat=0;seat<4;seat++)expect(html).toContain(`${[1,4,2,3][seat]}号 ${record.moves[1].handsAfter[seat]}张`);
 expect(html).toContain(`m2:s${actor}:`);expect(JSON.stringify(record)).toBe(before);
});

it('UI-MAP frozen model labels use the product name without rewriting recorded identities',async()=>{
 const {RELEASES}=await import('../../ai/src/policy/seats');
 const {MatchController}=await import('../src/game/controller');
 const release=RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1')!;
 const ai:any={controller:'ai',releaseRef:release.releaseRef,release,mode:'local',policyIdentity:{policyId:'r62-p8c-control-u1400-greedy',weightsSHA256:'d05c52bbd28883760da11f042be2d110fd3b3a9affd97edd7aed43c9421eb081'}};
 const record:any={humanSeat:null,seatConfig:{schemaVersion:2,seats:[ai,ai,ai,ai]}};
 const before=JSON.stringify(record),html=render(React.createElement(RecordedSeats,{record}));
 expect(html).toContain('ohuo-v1-1031');expect(html).toContain('技术来源');expect(html).not.toContain('真人');
 const labels=Object.getOwnPropertyDescriptor(MatchController.prototype,'seatLabels')!.get!.call({opts:{seats:{snapshot:record.seatConfig}}});
 expect(labels).toEqual(Array(4).fill('ohuo-v1-1031'));
 expect(JSON.stringify(record)).toBe(before);
});

it('UI-MAP coach choices expose only exact bound GLM/DeepSeek and never auto-follow a changed reference',async()=>{
 const {VerifiedReportTab}=await import('../src/ui/VerifiedReportTab');
 const {providerPresetFields}=await import('../src/game/provider-presets');
 const storage=await import('../src/game/storage');
 const profiles=[{...providerPresetFields('glm',{profileId:'fixture-glm',nickname:'Long GLM private nickname'}),revision:1,snapshotHash:'a'.repeat(64)},
 {...providerPresetFields('deepseek',{profileId:'fixture-ds',nickname:'Long DS nickname'}),revision:2,snapshotHash:'b'.repeat(64)},
 {...providerPresetFields('glm',{profileId:'unbound',nickname:'DO_NOT_OFFER_UNBOUND'}),revision:1,snapshotHash:'c'.repeat(64)}];
 const data=new Map<string,string>([['gd_llm_profiles_public_v1',JSON.stringify(profiles)]]);
 vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)});
 const warn=vi.spyOn(console,'error').mockImplementation(()=>{});
 try {
  storage.saveProviderBindings({schema:'ohuo-provider-bindings-v1',glm:storage.profileReference(profiles[0]),deepseek:storage.profileReference(profiles[1])});
  storage.saveChatProfileReference(storage.profileReference(profiles[0]));
  const props={record:{id:'coach-map',humanSeat:null} as GameRecord,viewerSeat:3,evidence:[],onJump:()=>{}};
  const before=JSON.stringify([...data]),html=render(React.createElement(VerifiedReportTab,props));
  const choices=[...html.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map(m=>m[1]);
  expect(choices).toEqual(['请选择已保存版本，不自动选第一项','GLM','DeepSeek']);
  expect(html).not.toContain('DO_NOT_OFFER_UNBOUND');expect(JSON.stringify([...data])).toBe(before);
  storage.saveProviderBindings({schema:'ohuo-provider-bindings-v1',glm:{...storage.profileReference(profiles[0]),revision:9},deepseek:storage.profileReference(profiles[1])});
  const stale=JSON.stringify([...data]),changed=render(React.createElement(VerifiedReportTab,props));
  expect(changed).toContain('provider_binding_unavailable');expect(changed).toContain('不会自动绑定新版本');
  expect(JSON.stringify([...data])).toBe(stale);expect(storage.loadChatProfileReference()).toEqual(storage.profileReference(profiles[0]));
   expect(warn.mock.calls.every(args=>String(args[0]).includes('useLayoutEffect'))).toBe(true);
 } finally {warn.mockRestore();vi.unstubAllGlobals();}
});

it('UI-MAP ReviewPage actual historical replay keeps fixed geometry and separates original control from observation',async()=>{
 const {ReviewPage}=await import('../src/ui/ReviewPage');
 const match=createMatch({...DEFAULT_RULES},123),state=startGame(match);
 const record:GameRecord={schemaVersion:2,id:'replay-map',matchId:'fixture',createdAt:0,ruleOpts:match.opts,levelsBefore:[...state.levelsBefore],stageTeam:state.stageTeam,leader:state.leader,humanSeat:null,difficulties:[0,0,0,0],initialHands:state.hands.map(h=>[...h]),moves:[],result:null};
 for(let i=0;i<4;i++){const player=state.turn,combo=legalCombos(state)[0];applyMove(state,{pass:false,combo});record.moves.push({moveNo:i+1,player,pass:false,cards:combo.cards,comboKind:combo.kind,mainRank:combo.mainRank,handsAfter:state.hands.map(h=>h.length)});}
 vi.stubGlobal('localStorage',{getItem:()=>null});
 const warn=vi.spyOn(console,'error').mockImplementation(()=>{});
 try {
  const before=JSON.stringify(record),props={record,settings:{} as any,onBack:()=>{}};
  const html=render(React.createElement(ReviewPage,props));
  expect(html).toContain('1号 · 观察席 · AI');expect(html).not.toContain('真人');
  expect(html).toContain('revealed-seat south');expect(html).toContain('revealed-seat east');
  const other=render(React.createElement(ReviewPage,{...props,record:{...record,humanSeat:1}}));
  expect(other).toContain('4号 · 观察席 · 真人');expect(other).toContain('1号 · 对手 · AI');
  expect(other).not.toMatch(/南家|东家|北家|西家/);expect(JSON.stringify(record)).toBe(before);
  expect(warn.mock.calls.every(args=>String(args[0]).includes('useLayoutEffect'))).toBe(true);
 }finally{warn.mockRestore();vi.unstubAllGlobals();}
});

it('UI-MAP recap ignores legacy cardinal names and honors the explicit viewing seat',async()=>{
 const {TrickRecap}=await import('../src/ui/TrickRecap');
 const {makeLevelCtx}=await import('@gd/engine');
 const mv:any={moveNo:2,grade:'good',pass:true,trickBefore:[{player:0,pass:true},{player:3,pass:true}],playedCards:[],recCards:[]};
 const html=render(React.createElement(TrickRecap,{moveNo:'2',mv,ctx:makeLevelCtx([2,2]),seatNames:['南家','东家','北家','西家'],viewerSeat:1,onJump:()=>{}}));
 expect(html).toContain('4号（观察席）');expect(html).toContain('3号（队友）');expect(html).toContain('1号（对手）');
 expect(html).not.toMatch(/南家|东家|北家|西家/);
});
