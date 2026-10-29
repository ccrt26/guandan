import{isDeepStrictEqual}from'node:util';
import type{Card,Combo,EngineEvent,GameResult,GameState,RuleOptions}from'@gd/engine';
import type{PublicStep}from'./match-play';
const fail=()=>{throw new Error('invalid nested visible schema/field');};
function obj(x:any){if(!x||typeof x!=='object'||Array.isArray(x))fail();return x;}
function num(x:any,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isInteger(x)||x<min||x>max)fail();return x as number;}
function bool(x:any){if(typeof x!=='boolean')fail();return x as boolean;}
function choice<T>(x:any,values:readonly T[]):T{if(!values.includes(x))fail();return x;}
function array<T>(x:any,fn:(value:any)=>T,max=100000):T[]{if(!Array.isArray(x)||x.length>max)fail();return x.map(fn);}
const seat=(x:any)=>num(x,0,3),team=(x:any)=>num(x,0,1) as 0|1,rank=(x:any)=>choice(x,[2,3,4,5,6,7,8,9,10,11,12,13,14,16,17]),suit=(x:any)=>choice(x,['S','H','D','C','J'] as const);
const levels=(x:any)=>{const v=array(x,v=>num(v,2,14),2);if(v.length!==2)fail();return v as[number,number];};
export function publicCard(x:any):Card{obj(x);return{id:num(x.id,0,107),suit:suit(x.suit),rank:rank(x.rank)};}
export function publicCombo(x:any):Combo|null{if(x===null)return null;obj(x);return{kind:choice(x.kind,['single','pair','trio','trio_pair','straight','pair_seq','trio_seq','bomb','flush','joker_bomb'] as const),cards:array(x.cards,publicCard,27),size:num(x.size,1,27),keyRank:num(x.keyRank,0,100),length:num(x.length,1,27),pairRanks:array(x.pairRanks,rank,27),mainRank:rank(x.mainRank),...(x.suit===undefined?{}:{suit:suit(x.suit)}),wildAs:array(x.wildAs,w=>{obj(w);return{cardId:num(w.cardId,0,107),asRank:rank(w.asRank),asSuit:suit(w.asSuit)};},8)};}
export function publicRules(x:any):RuleOptions{obj(x);return{levelMode:choice(x.levelMode,['stage','both','high'] as const),passA:choice(x.passA,['head','head3','double'] as const),pairSeqMin:num(x.pairSeqMin,1,13),pairSeqMax:num(x.pairSeqMax,1,13),trioSeqMin:num(x.trioSeqMin,1,13),trioSeqMax:num(x.trioSeqMax,1,13),flushLen:num(x.flushLen,1,13),straightLen:num(x.straightLen,1,13)};}
export function publicResult(x:any):GameResult|null{if(x===null)return null;obj(x);const order=array(x.finishOrder,seat,4);if(order.length!==4||new Set(order).size!==4)fail();return{finishOrder:order,winnerTeam:team(x.winnerTeam),doubleUp:bool(x.doubleUp),levelsAfter:levels(x.levelsAfter),upgrade:num(x.upgrade,1,3),passedA:bool(x.passedA)};}
function transfer(x:any){obj(x);return{from:seat(x.from),to:seat(x.to),card:publicCard(x.card)};}
export function publicTribute(x:any):GameState['tribute']{if(x===null)return null;obj(x);return{resist:bool(x.resist),tributes:array(x.tributes,transfer,2),returns:array(x.returns,transfer,2),leader:seat(x.leader)};}
function publicEvent(x:any):EngineEvent{obj(x);switch(x.type){case'play':{const combo=publicCombo(x.combo);if(combo===null)fail();return{type:'play',player:seat(x.player),combo:combo!};}case'pass':return{type:'pass',player:seat(x.player)};case'finish':return{type:'finish',player:seat(x.player),order:num(x.order,1,4)};case'trickEnd':return{type:'trickEnd',nextLeader:seat(x.nextLeader)};case'gameEnd':{const result=publicResult(x.result);if(!result)fail();return{type:'gameEnd',result:result!};}default:return fail();}}
export function publicHistory(x:any):PublicStep[]{return array(x,row=>{obj(row);return{events:array(row.events,publicEvent,10),priorTarget:publicCombo(row.priorTarget)};},2500);}
export function publicMatch(x:any){obj(x);const lastResult=publicResult(x.lastResult);if(lastResult?.passedA)throw new Error('previous round already ended the match');return{opts:publicRules(x.opts),levels:levels(x.levels),gameNo:num(x.gameNo,1,80),lastHead:x.lastHead===null?null:seat(x.lastHead),lastResult};}
export function publicState(x:any){obj(x);return{levelsBefore:levels(x.levelsBefore),stageTeam:team(x.stageTeam),turn:seat(x.turn),leader:seat(x.leader),lastCombo:publicCombo(x.lastCombo),lastPlayer:seat(x.lastPlayer),passCount:num(x.passCount,0,3),finished:array(x.finished,seat,4),moveNo:num(x.moveNo,0,2500),tribute:publicTribute(x.tribute),trickPlays:array(x.trickPlays,p=>{obj(p);return{player:seat(p.player),combo:publicCombo(p.combo)};},2500)};}
/** Ignore source-only metadata before legality validation and projection. All
 * actual engine fields remain subject to the complete-prefix validator. */
export function cleanSourceState(source:GameState):GameState{
 const state=publicState(source),match=publicMatch(source.match);return{...state,match:{...match,winner:source.match.winner,rngState:0},ctx:{...source.ctx},hands:array(source.hands,h=>array(h,publicCard,27),4),over:bool(source.over),result:publicResult(source.result),pendingReturns:array(source.pendingReturns,p=>({from:seat(p.from),to:seat(p.to)}),2)};
}
/** Unlike source metadata projection, serialized sampler inputs must already
 * be exact public objects. Unknown fields at every depth fail closed. */
export function assertStrictVisibleNested(obs:any){
 const projected={matchPublic:publicMatch(obs.matchPublic),statePublic:publicState(obs.statePublic),ownCards:array(obs.ownCards,publicCard,27),history:publicHistory(obs.history)};
 for(const key of Object.keys(projected) as Array<keyof typeof projected>)if(!isDeepStrictEqual(projected[key],obs[key]))throw new Error('unknown nested visible field');
 if(!Array.isArray(obs.modelState331)||obs.modelState331.length!==331||obs.modelState331.some((n:any)=>typeof n!=='number'||!Number.isFinite(n)))fail();
 const allowed=['known_transfer_owner_not_encoded_in_schema_v4','public_tribute_maximum_constraint_not_encoded_in_schema_v4','public_resistance_giver_constraint_not_fully_encoded_in_schema_v4'];
 if(!Array.isArray(obs.representationGaps)||obs.representationGaps.some((v:any)=>!allowed.includes(v))||new Set(obs.representationGaps).size!==obs.representationGaps.length)fail();
}
