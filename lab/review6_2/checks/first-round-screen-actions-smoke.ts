/** Called only by the planned training.round-contract-smoke. */
import assert from 'node:assert/strict';
import {buildDeck,classify,DEFAULT_RULES,makeLevelCtx,type GameState} from '@gd/engine';
import {canonicalActionId} from '../../../packages/ai/src/hybrid/legality';
import {freezeFirstRoundScreenActions} from '../first-round-screen-actions';
export function checkFirstRoundScreenActions(){
 const deck=buildDeck(),take=(rank:number)=>deck.splice(deck.findIndex(c=>c.rank===rank&&c.suit==='S'),1)[0],a=take(8),b=take(9),target=take(7),ctx=makeLevelCtx([10,10],'stage',0),single=(card:any)=>classify([card],ctx,DEFAULT_RULES).find(c=>c.kind==='single')!;
 const state={match:{opts:DEFAULT_RULES,levels:[10,10],gameNo:1,winner:null,rngState:1,lastHead:null,lastResult:null},ctx,levelsBefore:[10,10],stageTeam:0,hands:[[a,b],deck.splice(0,20),deck.splice(0,20),deck],turn:0,leader:2,lastCombo:single(target),lastPlayer:2,passCount:1,trickPlays:[{player:2,combo:single(target)},{player:3,combo:null}],finished:[],over:false,result:null,moveNo:31,tribute:null,pendingReturns:[]} as GameState;
 const candidates=[{actionId:'1',canonical:null,rawQ:3,originalIndex:0},{actionId:'9',canonical:single(a),rawQ:5,originalIndex:1},{actionId:'12',canonical:single(b),rawQ:4,originalIndex:2}].map(c=>({...c,canonicalId:canonicalActionId(c.canonical,ctx)}));
 const input={state,actorSeat:0,candidates,proposalActionId:'1',baselineActionId:'12'},before=structuredClone(input),plan=freezeFirstRoundScreenActions(input);
 assert.deepEqual(plan.map(x=>x.actionId),['1','12','9']);assert.deepEqual(input,before);
 assert.deepEqual(freezeFirstRoundScreenActions({...input,proposalActionId:'12'}).map(x=>x.actionId),['12','1']);
 assert.throws(()=>freezeFirstRoundScreenActions({...input,proposalActionId:'outside'}),/action_outside_frozen_c/);
 assert.throws(()=>freezeFirstRoundScreenActions({...input,candidates:candidates.slice(0,1)}),/target_not_covered/);
 assert.throws(()=>freezeFirstRoundScreenActions({...input,candidates:[...candidates,{...candidates[1],actionId:'10',originalIndex:3}]}),/canonical_duplicate/);
 assert.throws(()=>freezeFirstRoundScreenActions({...input,candidates:candidates.map((c,i)=>i===1?{...c,canonicalId:'wrong'}:c)}),/canonical_identity/);
 assert.throws(()=>freezeFirstRoundScreenActions({...input,state:{...state,turn:1}}),/target_not_covered/);
 const hidden=structuredClone(state);hidden.hands[1]=[];hidden.hands[2]=[];hidden.hands[3]=[];assert.deepEqual(freezeFirstRoundScreenActions({...input,state:hidden}),plan);
 return{sameFrozenC:true,actionIds9And12:true,maximumThree:true,oppositeFromBRanking:true,noAnswerRewritten:true,hiddenHandsUnused:true};
}
