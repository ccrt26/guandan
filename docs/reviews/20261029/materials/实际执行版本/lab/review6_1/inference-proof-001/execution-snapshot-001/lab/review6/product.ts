import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {
  applyMove,beats,classify,createMatch,DEFAULT_RULES,legalCombos,Recorder,RNG,startGame,teamOf,
  describeCombo,type GameRecord,type GameState,type RuleOptions,type Combo,
} from '@gd/engine';
import {createAI,guardMove,PublicTracker,encodeState,STATE_DIM} from '@gd/ai';
import {buildDecisionFactsV3,buildInitialState,classifyReplay,replay,FACT_ASSERTION_IDS,canonicalize,fnvId,type DecisionFactsV3} from '@gd/review';
import {PRODUCT_CATEGORIES,writeProductManifest} from './product-artifacts';
import {measureProductExamples} from './product-examples';

export interface ExpectedCard {record:GameRecord;moveNo:number;viewerSeat:number;expectedAssertionIds:string[];expectedApplicability?:Record<string,{applicable:boolean;reason:string|null}>}
/** Independently compare actual raw move/counts and the existing replay engine to
 * the card. Never accept the card's own checked=true as its factual witness. */
export function verifyProductCard(expected:ExpectedCard,card:DecisionFactsV3) {
  const requiredIds=FACT_ASSERTION_IDS.map(role=>`${expected.record.id}#m${expected.moveNo}:v${expected.viewerSeat}:${role}`);
  const failed={expectedAssertions:6,checkedAssertions:0,missingAssertions:6,errorAssertions:1,passed:false};
  if(JSON.stringify(expected.expectedAssertionIds)!==JSON.stringify(requiredIds)||JSON.stringify(card.expectedAssertionIds)!==JSON.stringify(requiredIds)
    ||!Array.isArray(card.assertions)
    ||card.decisionId!==`${expected.record.id}#m${expected.moveNo}`||card.schemaVersion!=='decision-facts-v3')return failed;
  const move=expected.record.moves.find(m=>m.moveNo===expected.moveNo)!;
  const frames=[...replay(expected.record)],frame=frames.find(f=>f.move.moveNo===expected.moveNo)!;
  const before=frame.state.hands.map(h=>h.length);
  const eventIndex=expected.record.moves.findIndex(m=>m.moveNo===expected.moveNo),actor=move.player;
  const ids=(move.cards??[]).map(c=>c.id).sort((a,b)=>a-b),semantic=canonicalize(actor,move.pass,frame.combo);
  const actionId=`m${move.moveNo}:s${actor}:${semantic.actionId}:p${ids.join('.')}`;
  const owner=frame.state.lastCombo?frame.state.lastPlayer:null;
  const target=frame.state.lastCombo?{text:describeCombo(frame.state.lastCombo),kind:frame.state.lastCombo.kind,cardCount:frame.state.lastCombo.size}:null;
  const visible=(c:{id:number;suit:string;rank:number})=>({id:c.id,suit:c.suit,rank:c.rank});
  const history=expected.record.moves.slice(0,eventIndex).map(m=>({moveNo:m.moveNo,player:m.player,pass:m.pass,cards:m.cards?.map(visible),comboKind:m.comboKind,mainRank:m.mainRank,handsAfter:[...m.handsAfter],toBeatKind:m.toBeatKind,toBeatRank:m.toBeatRank}));
  const transfers=(expected.record.tributes??[]).filter(t=>t.atMove<move.moveNo).map(t=>({kind:t.kind,from:t.from,to:t.to,card:visible(t.card),atMove:t.atMove}));
  const tracker=new PublicTracker();for(const prefix of frames.slice(0,eventIndex))tracker.observe(prefix.events);
  const vector=new Float32Array(STATE_DIM);encodeState(frame.state,actor,tracker,vector);
  const observationHash=fnvId(JSON.stringify([Array.from(vector),history,transfers]));
  const relationApplicable=!!target&&!move.pass;
  const reason=move.pass?'过牌是本次选择，不证明压不动':target?'由引擎比较实际动作与当前目标牌':'领出时没有待压目标';
  const visibility=actor===expected.viewerSeat?'行动者即观察者：自家手牌当时可见':'行动者自家可见；观看者事后才知，不进入观看者的事前输入';
  const causalRecord={...expected.record,moves:expected.record.moves.slice(0,eventIndex+1),result:null};
  if(classifyReplay(causalRecord).status!=='exact')return failed;
  const assertionTexts:Record<string,string>={
    target_and_owner:target?`当前目标：${target.text}；控权席 ${owner}`:'当前领出，无待压目标与控权席',
    actor_and_viewer:`行动席 ${actor}；观察席 ${expected.viewerSeat}；行动队伍 ${teamOf(actor)}`,
    actual_identity_and_count:`实际动作 ${actionId}；${ids.length} 张；来源为原谱`,
    remaining_counts:`行动前 ${before.join('/')}；行动后 ${move.handsAfter.join('/')} 张`,
    rule_relation:relationApplicable?'实际动作经引擎核验可以压当前目标':'无需进行出牌大小比较',
    advice_source:'本卡事实来自规则引擎与原谱；未加载的网络或未验证搜索不生成策略真值',
  };
  const comparison=card.bombComparison;
  const legalBombs=legalCombos(frame.state).filter(c=>c.kind==='bomb');
  const hasPair=legalBombs.some(four=>four.size===4&&legalBombs.some(five=>five.size===5&&five.mainRank===four.mainRank&&four.cards.every(c=>five.cards.some(f=>f.id===c.id))));
  let bombRelationChecked=!!comparison===hasPair;
  if(comparison){
    const own=frame.state.hands[move.player];
    const four=classify(own.filter(c=>comparison.fourPhysicalIds.includes(c.id)),frame.state.ctx,expected.record.ruleOpts).find(c=>c.kind==='bomb'&&c.size===4);
    const five=classify(own.filter(c=>comparison.fivePhysicalIds.includes(c.id)),frame.state.ctx,expected.record.ruleOpts).find(c=>c.kind==='bomb'&&c.size===5);
    bombRelationChecked=!!four&&!!five&&comparison.fourPhysicalIds.length===4&&comparison.fivePhysicalIds.length===5&&new Set(comparison.fourPhysicalIds).size===4&&new Set(comparison.fivePhysicalIds).size===5&&four.mainRank===five.mainRank&&comparison.fourPhysicalIds.every(id=>comparison.fivePhysicalIds.includes(id))&&comparison.fiveBeatsFour===beats(five,four)&&comparison.fourRemaining===before[move.player]-4&&comparison.fiveRemaining===before[move.player]-5&&comparison.strategyPreference===null
      &&comparison.fourCanBeatCurrent===(frame.state.lastCombo?beats(four,frame.state.lastCombo):null)&&comparison.fiveCanBeatCurrent===(frame.state.lastCombo?beats(five,frame.state.lastCombo):null);
  }
  const predicates:Record<string,boolean>={
    target_and_owner:card.currentTrickOwner===owner&&JSON.stringify(card.target)===JSON.stringify(target)&&JSON.stringify(card.beforeCounts)===JSON.stringify(before),
    actor_and_viewer:card.actorSeat===actor&&card.viewerSeat===expected.viewerSeat&&card.teamId===teamOf(actor)&&card.eventIndex===eventIndex&&card.observationHash===observationHash&&card.observationHashAlgorithm==='dual-lane-fnv1a-noncryptographic'&&card.revealedFacts.actingSeat===actor&&card.revealedFacts.actorHandVisibility===visibility&&JSON.stringify(card.revealedFacts.otherHandCounts)===JSON.stringify(before)&&JSON.stringify(card.revealedFacts.ownHand)===JSON.stringify(frame.state.hands[actor].map(visible))&&JSON.stringify(card.revealedFacts.publicHistory)===JSON.stringify(history)&&JSON.stringify(card.revealedFacts.knownTransfers)===JSON.stringify(transfers),
    actual_identity_and_count:card.actual.pass===move.pass&&card.actual.text===(move.pass?'不要':describeCombo(frame.combo!))&&card.actual.cardCount===(move.pass?0:move.cards!.length)&&card.actualActionId===actionId&&JSON.stringify(card.actual.physicalCardIds)===JSON.stringify(ids),
    remaining_counts:JSON.stringify(card.afterCounts)===JSON.stringify(move.handsAfter),
    rule_relation:bombRelationChecked&&card.rulesId===fnvId(JSON.stringify(expected.record.ruleOpts))&&card.stageOwner===(frame.state.stageTeam??null)&&JSON.stringify(card.effectiveLevel)===JSON.stringify([...frame.state.ctx.ranks].sort((a,b)=>a-b))&&card.legalActualAction===true&&card.ruleRelation.applicabilityReason===reason&&card.ruleRelation.canBeatCurrent===(move.pass||!frame.state.lastCombo?null:beats(frame.combo!,frame.state.lastCombo)),
    advice_source:card.policyIdentity===null&&card.passInference===(move.pass?'choice_only_capacity_unknown':'not_a_pass')&&card.policyAdvice.nn===null&&card.policyAdvice.search===null&&card.policyAdvice.heuristic===null&&card.expressionScope==='只陈述程序核实的事实；启发式与网络属于各自偏好，尚未证明哪种打法更好',
  };
  let checkedAssertions=0,missingAssertions=0,errorAssertions=card.assertions.length===6&&new Set(card.assertions.map(a=>a.id)).size===6?0:1;
  for(const id of requiredIds){
    const role=id.slice(id.lastIndexOf(':')+1),matches=card.assertions.filter(a=>a.id===role);
    if(matches.length!==1||!matches[0].checked){missingAssertions++;continue;}
    checkedAssertions++;
    const requiredApplicable=role==='rule_relation'?relationApplicable:true;
    const assertionReason=requiredApplicable?undefined:move.pass?'过牌只核合法性，不推断压制能力':'领出没有比较对象';
    if(matches[0].text!==assertionTexts[role]||!predicates[role]||matches[0].applicable!==requiredApplicable||matches[0].applicabilityReason!==assertionReason||expected.expectedApplicability&&expected.expectedApplicability[role]?.applicable!==matches[0].applicable)errorAssertions++;
  }
  if(JSON.stringify(card.expectedAssertionIds)!==JSON.stringify(expected.expectedAssertionIds))errorAssertions++;
  return {expectedAssertions:expected.expectedAssertionIds.length,checkedAssertions,missingAssertions,errorAssertions,
    passed:requiredIds.length===6&&missingAssertions===0&&errorAssertions===0};
}

function recordMeta(state:GameState,id:string):Omit<GameRecord,'moves'|'result'> {
  return {schemaVersion:2,id,matchId:`development-${id}`,createdAt:0,ruleOpts:{...state.match.opts},levelsBefore:[...state.levelsBefore],stageTeam:state.stageTeam,leader:state.leader,humanSeat:0,difficulties:[0,0,0,0],initialHands:state.hands.map(h=>h.map(c=>({...c})))};
}
function playGame(state:GameState,id:string):GameRecord {
  const recorder=new Recorder(recordMeta(state,id));recorder.recordTributes(state.tribute);
  const players=[0,1,2,3].map(seat=>{const ai=createAI(seat,0,61028+seat);ai.reset(state,state.match.opts);return ai;});
  let steps=0;
  while(!state.over&&steps++<2000){
    const seat=state.turn,target=state.lastCombo,move=guardMove(state,players[seat].decide(state) as never);
    const events=applyMove(state,move as never);recorder.record(seat,move,state.hands,target);players.forEach(ai=>ai.observe(events,target));
  }
  if(!state.result)throw new Error('development record did not complete');
  return recorder.finish(state.result);
}
function natural(seed:number,category:string,index:number):{record:GameRecord;priorRecord?:GameRecord} {
  const opts:RuleOptions={...DEFAULT_RULES,...(category==='rule_context'?{levelMode:index%2===0?'stage':'both'}:{})};
  const match=createMatch(opts,seed);const first=playGame(startGame(match),`r6-dev-${category}-${index}`);
  if(category!=='known_tribute')return {record:first};
  const next=playGame(startGame(match),`r6-dev-${category}-${index}-deal2`);
  return {record:next,priorRecord:first};
}
function constructed(seed:number,category:string,index:number):GameRecord {
  const state=startGame(createMatch({...DEFAULT_RULES},seed));
  const all=new RNG(seed+31).shuffle(state.hands.flat());
  const five=all.filter(c=>c.rank===5).slice(0,5),targetCards=[...all.filter(c=>c.rank===7).slice(0,3),...all.filter(c=>c.rank===8).slice(0,2)];
  const targetIds=new Set(targetCards.map(c=>c.id));
  const straightTail=[6,7,8,9].map(rank=>all.find(c=>c.rank===rank&&!targetIds.has(c.id))!);
  const held=new Set([...five,...targetCards,...straightTail].map(c=>c.id)),rest=all.filter(c=>!held.has(c.id));
  const extraFives=rest.filter(c=>c.rank===5);for(const card of extraFives)rest.splice(rest.indexOf(card),1);
  const hands=[[...targetCards,...extraFives],[],[...five,...straightTail],[]] as GameState['hands'];
  for(const hand of hands)while(hand.length<27)hand.push(rest.shift()!);
  const base:GameRecord={schemaVersion:2,id:`r6-dev-${category}-${index}`,matchId:'r6-dev-constructed-bomb-family',createdAt:0,ruleOpts:{...DEFAULT_RULES},levelsBefore:[2,2],stageTeam:0,leader:0,humanSeat:0,difficulties:[0,0,0,0],initialHands:hands,moves:[],result:null};
  if(category==='bomb_4_5'&&index>=3)base.leader=2;
  const s=buildInitialState(base);
  function step(pass:boolean,combo:Combo|null){const actor=s.turn;applyMove(s,pass?{pass:true}:{pass:false,combo:combo!});base.moves.push({moveNo:base.moves.length+1,player:actor,pass,cards:combo?.cards,comboKind:combo?.kind,mainRank:combo?.mainRank,handsAfter:s.hands.map(h=>h.length)});}
  if(category==='bomb_4_5'&&index>=3){
    const discard=s.hands[2].filter(c=>c.rank!==5);
    for(const card of discard){step(false,classify([card],s.ctx,s.match.opts).find(c=>c.kind==='single')!);for(let i=0;i<3;i++)step(true,null);}
    step(false,classify(five,s.ctx,s.match.opts).find(c=>c.kind==='bomb')!);return base;
  }
  step(false,classify(targetCards,s.ctx,s.match.opts).find(c=>c.kind==='trio_pair')!);step(true,null);
  if(category==='yield')step(true,null);
  else step(false,classify(five,s.ctx,s.match.opts).find(c=>c.kind==='bomb')!);
  return base;
}
const CATEGORIES=PRODUCT_CATEGORIES;
function choose(record:GameRecord,category:string,index:number):number {
  if(category==='bomb_4_5')return record.moves.length;
  if(['yield','takeover'].includes(category))return 3;
  const frames=[...replay(record)];
  const frame=frames.find(f=>{
    const actor=f.move.player,counts=f.state.hands.map(h=>h.length);
    if(category==='remaining_structure')return counts[actor]<=10&&!f.move.pass;
    if(category==='block_finish')return counts.some((n,seat)=>teamOf(seat)!==teamOf(actor)&&n>0&&n<=4);
    if(category==='known_tribute')return (record.tributes?.length??0)>0;
    if(category==='role_rotation')return actor===index%4;
    if(category==='plan_invalidated')return f.state.lastCombo!==null&&teamOf(f.state.lastPlayer)!==teamOf(actor)&&!f.move.pass;
    return true;
  });
  if(!frame)throw new Error(`coverage insufficient: ${category}/${index}`);return frame.move.moveNo;
}
function sha(path:string){return createHash('sha256').update(readFileSync(path)).digest('hex');}
function writeNew(path:string,value:unknown){writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

export function verifyProduct(outDirectory:string) {
  if(existsSync(outDirectory))throw new Error('output exists; refuse overwrite');
  mkdirSync(outDirectory,{recursive:true});mkdirSync(resolve(outDirectory,'records'));
  const plan={schemaVersion:'r6-product-plan-v1',dataUse:'development',notSkillEvidence:true,
    categories:CATEGORIES,perCategory:6,viewerSeats:[0,1,2,3],assertionRoles:FACT_ASSERTION_IDS,
    cases:CATEGORIES.flatMap((category,c)=>Array.from({length:6},(_,i)=>({caseId:`${category}-${i+1}`,category,index:i,seed:61028000+c*100+i,
      sourceFamily:['yield','takeover','bomb_4_5'].includes(category)?'constructed-fullhouse-five5-family':`development-${category}-${i}`,
      strategyLabel:'not_established',selector:category==='plan_invalidated'?'opponent_control_invalidates_team_control_hypothesis':category}))),
    sourceFiles:['lab/review6/product.ts','lab/review6/product-artifacts.ts','lab/review6/product-examples.ts','packages/review/src/decisionReview.ts','packages/review/src/reviewHeuristic.ts','packages/review/src/decisionFacts.ts','packages/review/src/replay.ts','packages/engine/src/game.ts','packages/engine/src/combo.ts'].map(path=>({path:resolve(path),sha256:sha(path)}))};
  writeNew(resolve(outDirectory,'plan.lock.json'),plan);
  const lockedCards=[],rows=[],examples=[];
  for(const item of plan.cases){
    const generated:{record:GameRecord;priorRecord?:GameRecord;localResourceWitness?:unknown}=['yield','takeover','bomb_4_5'].includes(item.category)?{record:constructed(item.seed,item.category,item.index)}:natural(item.seed,item.category,item.index);
    const record=generated.record,classification=classifyReplay(record);
    if(classification.status!=='exact')throw new Error(`reachability failed ${item.caseId}: ${classification.status}`);
    const moveNo=choose(record,item.category,item.index);
    if(item.category==='bomb_4_5'){
      const frame=[...replay(record)].find(f=>f.move.moveNo===moveNo)!;
      const own=frame.state.hands[frame.move.player],fives=own.filter(c=>c.rank===5);
      if(item.index<3){
        const retained=fives[4],cards=[retained,...[6,7,8,9].map(rank=>own.find(c=>c.rank===rank)!)];
        const straight=classify(cards,frame.state.ctx,record.ruleOpts).find(c=>c.kind==='straight');
        if(!straight)throw new Error('retained five has no registered legal use witness');
        generated.localResourceWitness={scope:'legal_resource_use_only_not_team_optimality',retainedCardId:retained.id,legalCombinationWithRetainedFive:straight,fourRemaining:own.length-4,fiveRemaining:own.length-5};
      }else generated.localResourceWitness={scope:'immediate_finish_fact_only_not_a_teacher_label',fiveCardActionFinishes:record.moves.find(m=>m.moveNo===moveNo)!.handsAfter[frame.move.player]===0,fourWouldLeave:1};
    }
    writeNew(resolve(outDirectory,'records',item.caseId+'.json'),generated);
    for(const viewerSeat of plan.viewerSeats){
      const expectedAssertionIds=FACT_ASSERTION_IDS.map(role=>`${record.id}#m${moveNo}:v${viewerSeat}:${role}`);
      const selectedFrame=[...replay(record)].find(f=>f.move.moveNo===moveNo)!;
      const expectedApplicability=Object.fromEntries(FACT_ASSERTION_IDS.map(role=>[role,{applicable:role!=='rule_relation'||!!selectedFrame.state.lastCombo&&!selectedFrame.move.pass,reason:role==='rule_relation'?(selectedFrame.move.pass?'pass_has_no_strength_comparison':selectedFrame.state.lastCombo?null:'lead_has_no_target'):null}]));
      const expected={caseId:item.caseId,moveNo,viewerSeat,recordPath:`records/${item.caseId}.json`,expectedAssertionIds,expectedApplicability};
      lockedCards.push(expected);
    }
    examples.push({...item,moveNo,recordId:record.id,actualAction:record.moves.find(m=>m.moveNo===moveNo),candidateAction:null,evidenceScope:'reachable_development_facts_no_strategy_label',uncertainty:'尚未取得同口径完整比赛教师支持，不认定策略最优'});
  }
  // Fix the full denominator before producing any card or checking its assertions.
  writeNew(resolve(outDirectory,'expected-assertions.lock.json'),lockedCards);
  for(const expected of lockedCards){
    const {record}=JSON.parse(readFileSync(resolve(outDirectory,expected.recordPath),'utf8')) as {record:GameRecord};
    const card=buildDecisionFactsV3(record,expected.moveNo,expected.viewerSeat);
    rows.push({...expected,...verifyProductCard({...expected,record},card),card});
  }
  const result={schemaVersion:'r6-product-results-v1',at:new Date().toISOString(),dataUse:'development',scope:'60 constructed/generated base cases, four viewing seats; not 240 independent tactical samples',
    baseCases:60,expectedCards:240,completedCards:rows.length,passedCards:rows.filter(r=>r.passed).length,
    expectedAssertions:rows.reduce((n,r)=>n+r.expectedAssertions,0),checkedAssertions:rows.reduce((n,r)=>n+r.checkedAssertions,0),missingAssertions:rows.reduce((n,r)=>n+r.missingAssertions,0),errorAssertions:rows.reduce((n,r)=>n+r.errorAssertions,0),
    productFactsPassed:rows.length===240&&rows.every(r=>r.passed),browserAcceptance:'not_yet_verified',strategySkillResult:'not_measured',
    sourceFiles:plan.sourceFiles,oldPolicyUpdated:false};
  writeNew(resolve(outDirectory,'case-results.json'),rows);writeNew(resolve(outDirectory,'product-acceptance.json'),result);writeNew(resolve(outDirectory,'development-examples.json'),examples);
  writeFileSync(resolve(outDirectory,'product-acceptance.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n',{flag:'wx'});
  measureProductExamples(outDirectory);
  return {...result,resultManifestHash:writeProductManifest(outDirectory)};
}
