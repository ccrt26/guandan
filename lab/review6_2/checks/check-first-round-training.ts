/** S35 fixed target-selector case only. Synthetic states, no research qualification. */
import assert from 'node:assert/strict';
import { buildDeck, classify, DEFAULT_RULES, makeLevelCtx, type Combo, type GameState } from '@gd/engine';
import { classifyFirstRoundTarget, FIRST_ROUND_TARGET_DEFINITION, validateFirstRoundTargetDefinition } from '../first-round-target';

const args=process.argv.slice(2);
assert.deepEqual(args,['--case','training.target-selector'],'only the frozen case is executable');
function fixture(moveNo:number,ownCount:number) {
 const deck=buildDeck(),take=(rank:number)=>deck.splice(deck.findIndex(c=>c.rank===rank&&c.suit==='S'),1)[0];
 const ownHigh=take(8),targetCard=take(7),ctx=makeLevelCtx([10,10],'stage',0);
 const target=classify([targetCard],ctx,DEFAULT_RULES).find(c=>c.kind==='single')!;
 const own=[ownHigh,...deck.splice(0,ownCount-1)];
 const state:GameState={match:{opts:DEFAULT_RULES,levels:[10,10],gameNo:1,winner:null,rngState:1,lastHead:null,lastResult:null},ctx,levelsBefore:[10,10],stageTeam:0,hands:[own,deck.splice(0,20),deck.splice(0,20),deck],turn:0,leader:2,lastCombo:target,lastPlayer:2,passCount:1,trickPlays:[{player:2,combo:target},{player:3,combo:null}],finished:[],over:false,result:null,moveNo,tribute:null,pendingReturns:[]};
 const cover=classify([ownHigh],ctx,DEFAULT_RULES).find(c=>c.kind==='single')!;
 return {state,cover};
}
const observations:unknown[]=[];
for(const [name,moveNo,count] of [['early',2,27],['middle',31,13],['late',78,2]] as const){
 const {state,cover}=fixture(moveNo,count),before=structuredClone(state);
 const result=classifyFirstRoundTarget({state,actorSeat:0,candidateCombos:[null,cover]},FIRST_ROUND_TARGET_DEFINITION);
 assert.equal(result.sampleClass,'target');assert.equal(result.coverage,'covered');assert.equal(result.reason,'partner_control_opportunity');
 assert.deepEqual(state,before);assert(!('targetAction' in result));assert(!('recommendedAction' in result));
 observations.push({name,moveNo,ownCount:count,result});
}
const {state,cover}=fixture(31,13);
for(const [name,patch,reason] of [
 ['opponent-highest',{lastPlayer:1},'partner_not_current_highest'],
 ['no-legal-pass',{lastCombo:null},'no_legal_pass'],
 ['actor-not-turn',{turn:1},'not_actor_turn'],
] as const){
 const result=classifyFirstRoundTarget({state:{...state,...patch} as GameState,actorSeat:0,candidateCombos:[null,cover]},FIRST_ROUND_TARGET_DEFINITION);
 assert.equal(result.sampleClass,'ordinary');assert.equal(result.reason,reason);observations.push({name,result});
}
const unknown=classifyFirstRoundTarget({state,actorSeat:0,candidateCombos:[null]},FIRST_ROUND_TARGET_DEFINITION);
assert.equal(unknown.sampleClass,null);assert.equal(unknown.reason,'candidate_coverage_unknown');assert.equal(unknown.coverage,'unknown');
const gap=classifyFirstRoundTarget({state,actorSeat:0,candidateCombos:[null],originalWitnessCombos:[cover]},FIRST_ROUND_TARGET_DEFINITION);
assert.equal(gap.sampleClass,'target');assert.equal(gap.coverage,'gap');
const hidden=structuredClone(state);hidden.hands[1]=[];hidden.hands[2]=[];hidden.hands[3]=[];
assert.deepEqual(classifyFirstRoundTarget({state:hidden,actorSeat:0,candidateCombos:[null,cover]},FIRST_ROUND_TARGET_DEFINITION),classifyFirstRoundTarget({state,actorSeat:0,candidateCombos:[null,cover]},FIRST_ROUND_TARGET_DEFINITION));
assert.throws(()=>classifyFirstRoundTarget({state,actorSeat:0,candidateCombos:[{...cover,cards:[{...cover.cards[0],id:1000}]}]},FIRST_ROUND_TARGET_DEFINITION),/target_cover_witness_invalid/);
assert.throws(()=>validateFirstRoundTargetDefinition({...FIRST_ROUND_TARGET_DEFINITION,teacherAnswer:'pass'}),/target_definition_unimplemented/);
assert.throws(()=>validateFirstRoundTargetDefinition(Object.assign(Object.create(FIRST_ROUND_TARGET_DEFINITION),{a:1,b:2,c:3,d:4})),/target_definition_unimplemented/);
assert.throws(()=>validateFirstRoundTargetDefinition({schema:'ohuo-approved-public-target-v1',id:'synthetic-own-rank-2-v1',scope:'offline_synthetic',field:'ownHand',rule:'contains-rank-2'}),/target_definition_unimplemented/);
observations.push({name:'pool-missing',unknown,independentWitness:gap});
console.log(JSON.stringify({case:'training.target-selector',status:'PASS',scope:'supplemental cloud source check; not Mac M9 or research execution',observations,checks:{threePositiveThreeNegative:true,poolMissIsUnknown:true,independentOriginalWitnessIsCoverageGap:true,noAnswerGenerated:true,hiddenHandsUnused:true,stateUnchanged:true,malformedWitnessRejected:true,definitionStrict:true},providerRequests:0,optimizerSteps:0}));
