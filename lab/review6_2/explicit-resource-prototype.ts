/** One train-only declared deal, with every burn decision checked by the engine. */
import{join}from'node:path';
import{buildDeck,createMatch,startGame,applyMove,legalCombos,classify,beats,DEFAULT_RULES,type GameState}from'@gd/engine';
import{resolveLegalMove,indexedDealSeed,runCompleteMatch,type PublicStep}from'../review6/match-play';
import{resolveContinuationProfile}from'../review6/policy-registry';
import{dealtFamilyBeforeExchange}from'../review6/training-ancestry';
import{toVisibleRoot}from'../review6/visible-world';import{rootCandidates}from'../review6/teacher-roots';
import{HOME,ROOT,json,atomicJson,fileHash,bindFamilies}from'./protocol';

const output=join(HOME,'data/explicit-resource-prototype-001'),parent=json(join(HOME,'data/explicit-parent-before-game15.json'));
const match=createMatch({...DEFAULT_RULES},parent.sourceSeed);let at=0;
for(let g=1;g<=14;g++){
 match.rngState=indexedDealSeed(parent.dealNamespace,parent.sourceSeed,match.gameNo);const s=startGame(match);
 while(at<parent.moves.length&&parent.moves[at].gameNo===g){const r=parent.moves[at++];if(s.turn!==r.actor)throw Error('native prefix actor');applyMove(s,resolveLegalMove(s,r.move)as any);}
 if(!s.over||match.winner!==null)throw Error('native prefix did not reach parent');
}
if(JSON.stringify(match)!==JSON.stringify(parent.parentMatch))throw Error('parent replay drift');
const deck=buildDeck(),hands:number[][]=[[],[],[],[]],used=new Set<number>();
function reserve(seat:number,rank:number,count:number,suit?:string){const cs=deck.filter(c=>c.rank===rank&&(!suit||c.suit===suit)&&!used.has(c.id)).slice(0,count);if(cs.length!==count)throw Error('reserve');for(const c of cs){hands[seat].push(c.id);used.add(c.id);}return cs.map(c=>c.id);}
const four4=reserve(3,4,4),aces=reserve(3,14,4),wild=reserve(3,10,1,'H'),actorKeep=[...four4,...aces,...wild];reserve(3,2,1);
const four3=reserve(2,3,4),five8=reserve(2,8,5),single2=reserve(2,2,1),fourK=reserve(2,13,4),enemyKeep=[...four3,...five8,...single2,...fourK];
reserve(2,17,1);reserve(2,2,1);reserve(1,17,1);reserve(0,16,1);
for(const c of deck.filter(c=>!used.has(c.id))){const seat=hands.findIndex(h=>h.length<27);if(seat<0)throw Error('fill overflow');hands[seat].push(c.id);used.add(c.id);}
const initial=startGame(structuredClone(match),[],hands),family=dealtFamilyBeforeExchange(initial),config=json(join(HOME,'config.json'));
for(const[seat,ids]of [[3,actorKeep],[2,enemyKeep]]as const)if(ids.some(id=>!initial.hands[seat].some(c=>c.id===id)))throw Error('tribute moved protected resource');
bindFamilies(config.sourceIndexRef,[parent.sourceFamilyId,family],'train','explicit-resource-prototype-001');
let state=initial,history:PublicStep[]=[],moves:any[]=[];
function step(move:any){const actor=state.turn,priorTarget=structuredClone(state.lastCombo),legal=resolveLegalMove(state,move),events=applyMove(state,legal as any);moves.push({gameNo:15,actor,move:structuredClone(legal)});history.push({events,priorTarget});}
function passUntil(seat:number){for(let k=0;state.turn!==seat;k++){if(k>8)throw Error('pass cycle');step({pass:true});}}
function freeLead(seat:number){for(let k=0;state.turn!==seat||state.lastCombo!==null;k++){if(k>8)throw Error('free lead cycle');step({pass:true});}}
function single(keep:number[]=[],largest=false){const choices=state.hands[state.turn].filter(c=>!keep.includes(c.id)).flatMap(c=>classify([c],state.ctx,state.match.opts)).filter(c=>c.kind==='single'&&(!state.lastCombo||beats(c,state.lastCombo))).sort((a,b)=>(largest?-1:1)*(a.mainRank-b.mainRank)||a.cards[0].id-b.cards[0].id);if(!choices.length)throw Error('no burn singleton at seat '+state.turn);step({pass:false,combo:choices[0]});}
function burn(seat:number,keep:number[]){for(let k=0;state.hands[seat].some(c=>!keep.includes(c.id));k++){if(k>110||state.turn!==seat||state.lastCombo!==null)throw Error('burn not on free lead');single(keep);if(state.finished.includes(seat))return;passUntil(seat);if(state.lastCombo!==null)throw Error('burn did not clear target');}}
const registry=json(config.registryPath),roots:any[]=[];
for(const path of ['A','B']){
 state=structuredClone(initial);history=[];moves=[];
 // Seat2 opens small, seat1 takes with its joker, then legally finishes head.
 if(state.turn!==2)throw Error('planned tribute leader changed');single(enemyKeep);passUntil(1);single([],true);passUntil(1);burn(1,[]);freeLead(3);
 if(path==='B'){const a=legalCombos(state).find(c=>c.kind==='bomb'&&c.size===4&&c.cards.every(x=>aces.includes(x.id)));if(!a)throw Error('B four A missing');step({pass:false,combo:a});freeLead(3);}
 const retained=path==='A'?actorKeep:[...four4,...wild];
 const filler=state.hands[3].filter(c=>!retained.includes(c.id)).sort((a,b)=>a.rank-b.rank||a.id-b.id)[0];if(!filler)throw Error('missing legal handoff');
 burn(3,[...retained,filler.id]);single(retained);passUntil(0);single([],true);passUntil(0);burn(0,[]);freeLead(2);
 if(path==='A'){
  // Burn K plus all filler, keeping the target and the five-card response.
  burn(2,[...four3,...five8,...single2]);
 }else{
  burn(2,[...four3,...fourK]);
 }
 const target=legalCombos(state).find(c=>c.kind==='bomb'&&c.size===4&&c.mainRank===3&&c.cards.every(x=>four3.includes(x.id)));if(!target)throw Error('four3 target missing');step({pass:false,combo:target});passUntil(3);
 const observedBefore=toVisibleRoot(state,history),allCandidates=rootCandidates(state),root={rootId:'r62-explicit-resource-'+path,sourceFamilyId:parent.sourceFamilyId,sourceRootRoundFamilyId:family,slot:0,category:'resource_structure',caseThresholds:{minimumOpponentCount:1,urgentOpponentMaximum:3},sourceKind:'declared-complete-initial-deal',observedBefore,allCandidates};
 const pairs=[4,5].map(size=>allCandidates.find(c=>!c.move.pass&&c.move.combo?.kind==='bomb'&&c.move.combo.size===size&&c.move.combo.mainRank===4));if(pairs.some(c=>!c))throw Error('shared pair absent');
 const leaves:any[]=[];
 for(const profileName of ['primary','secondary']){const profile=resolveContinuationProfile(registry,profileName,3);for(const c of pairs){const result=runCompleteMatch({seed:2026103001,policies:profile.seats.map(s=>s.policy),rngMode:'counter-per-decision',inferenceExecution:'exact-prefix-v1',rootState:state,rootHistory:history,actingSeat:3,forcedRootMove:c!.move,maxGames:1,maxMovesPerGame:2500});leaves.push({profileName,profileSHA256:profile.profileSHA256,actionId:c!.actionId,...result});}}
 const record={root,prefix:{schema:'declared-complete-initial-deal-prefix-v1',parentRef:join(HOME,'data/explicit-parent-before-game15.json'),parentSHA256:fileHash(join(HOME,'data/explicit-parent-before-game15.json')),initialIds:hands,moves,sourceFamilyId:family},leaves};atomicJson(join(output,'path-'+path+'.json'),record);roots.push({path,counts:observedBefore.counts,candidates:allCandidates.length,leaves:leaves.map(l=>({profile:l.profileName,action:l.actionId,g:l.rootG,W:l.finalW,y:l.rootTeamTarget,finish:l.rootRoundResult?.finishOrder}))});
}
atomicJson(join(output,'summary.json'),{roots,scope:'train-only one-family producer prototype; no admitted strong evidence',sources:['packages/engine/src/game.ts','packages/engine/src/deck.ts','lab/review6_2/explicit-resource-prototype.ts'].map(path=>({path,sha256:fileHash(join(ROOT,path))}))});console.log(JSON.stringify({output,roots}));
