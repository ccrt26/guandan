import {
  applyMove, beats, canPass, describeCombo, teamOf, checkRecordIntegrity, legalCombos, type GameRecord, type GameState, type Card,
} from '@gd/engine';
import { encodeState, PublicTracker, STATE_DIM } from '@gd/ai';
import { buildInitialState, lightCloneState, resolveDeclaredFirst } from './replay';
import { canonicalize } from './actionIdentity';
import { fnvId } from './decisionReview';

export const FACTS_SCHEMA_VERSION = 'decision-facts-v3';
export const FACT_ASSERTION_IDS = ['target_and_owner','actor_and_viewer','actual_identity_and_count','remaining_counts','rule_relation','advice_source'] as const;
const visibleCard=(c:Card):Card=>({id:c.id,suit:c.suit,rank:c.rank});
export interface DecisionFactsV3 {
  schemaVersion: typeof FACTS_SCHEMA_VERSION;
  decisionId: string; actorSeat: number; viewerSeat: number; teamId: number;
  eventIndex: number; rulesId: string; stageOwner: number | null; effectiveLevel: number[];
  currentTrickOwner: number | null; beforeCounts: number[]; afterCounts: number[];
  legalActualAction: true; actualActionId: string;
  actual: { pass: boolean; cardCount: number; text: string; physicalCardIds: number[] };
  target: { text: string; kind: string; cardCount: number } | null;
  ruleRelation: { canBeatCurrent: boolean | null; applicabilityReason: string };
  bombComparison: {fourCanBeatCurrent:boolean|null;fiveCanBeatCurrent:boolean|null;fiveBeatsFour:boolean;fourRemaining:number;fiveRemaining:number;strategyPreference:null;fourPhysicalIds:number[];fivePhysicalIds:number[]}|null;
  observationHash: string; observationHashAlgorithm: string;
  revealedFacts: {
    actingSeat: number; ownHand: GameState['hands'][number]; otherHandCounts: number[];
    publicHistory: GameRecord['moves']; knownTransfers: NonNullable<GameRecord['tributes']>;
    actorHandVisibility: string;
  };
  policyIdentity: Record<string, unknown> | null;
  policyAdvice: { nn: null; heuristic: null; search: null };
  passInference: 'choice_only_capacity_unknown' | 'not_a_pass';
  expressionScope: string;
  expectedAssertionIds: string[];
  assertions: Array<{id: string; checked: boolean; applicable: boolean; text: string; applicabilityReason?: string}>;
}

/** Facts use the real transition path and need no weights or strategy labels.
 * Replay only the causal prefix; never use a later result to judge this action.
 * Private cards in revealedFacts belong solely to the actor's legal observation.
 */
export function buildDecisionFactsV3(
  record: GameRecord, moveNo: number, viewerSeat: number,
  policyIdentity: Record<string, unknown> | null = null,
): DecisionFactsV3 {
  if (!Number.isInteger(viewerSeat) || viewerSeat<0 || viewerSeat>3) throw new Error('invalid viewer seat');
  const eventIndex=record.moves.findIndex(m=>m.moveNo===moveNo);
  if (eventIndex<0) throw new Error('missing decision');
  const initialIds=record.initialHands.flat().map(c=>c.id);
  if (initialIds.length!==108 || new Set(initialIds).size!==108) throw new Error('invalid initial card ledger');
  const issues=checkRecordIntegrity({...record,moves:record.moves.slice(0,eventIndex+1),result:null});
  if (issues.length) throw new Error(issues[0].message);
  const state=buildInitialState(record), tracker=new PublicTracker();
  let before: GameState | null=null;
  let actualCombo: ReturnType<typeof resolveDeclaredFirst>['combo']=null;
  for (let i=0;i<=eventIndex;i++) {
    const move=record.moves[i];
    if (state.over || state.turn!==move.player) throw new Error('actor/turn mismatch');
    if (i===eventIndex) before=lightCloneState(state);
    const combo=move.pass?null:resolveDeclaredFirst(move,state,record).combo;
    if (!move.pass && (!combo || !combo.cards.every(c=>state.hands[move.player].some(h=>h.id===c.id)))) throw new Error('illegal or undeclared actual action');
    if (move.pass ? !canPass(state) : state.lastCombo && !beats(combo!,state.lastCombo)) throw new Error('illegal actual rule relation');
    const events=applyMove(state,move.pass?{pass:true}:{pass:false,combo:combo!});
    if (JSON.stringify(state.hands.map(h=>h.length))!==JSON.stringify(move.handsAfter)) throw new Error('recorded after-count mismatch');
    if (i<eventIndex) tracker.observe(events);
    else actualCombo=combo;
  }
  const s=before!,move=record.moves[eventIndex],actorSeat=move.player;
  const vec=new Float32Array(STATE_DIM);encodeState(s,actorSeat,tracker,vec);
  const semantic=canonicalize(actorSeat,move.pass,actualCombo);
  const ids=(actualCombo?.cards??[]).map(c=>c.id).sort((a,b)=>a-b);
  const actualActionId=`m${moveNo}:s${actorSeat}:${semantic.actionId}:p${ids.join('.')}`;
  const beforeCounts=s.hands.map(h=>h.length),afterCounts=state.hands.map(h=>h.length);
  const owner=s.lastCombo?s.lastPlayer:null;
  const target=s.lastCombo?{text:describeCombo(s.lastCombo),kind:s.lastCombo.kind,cardCount:s.lastCombo.size}:null;
  const canBeatCurrent=move.pass || !s.lastCombo?null:beats(actualCombo!,s.lastCombo);
  const publicHistory=record.moves.slice(0,eventIndex).map(m=>({moveNo:m.moveNo,player:m.player,pass:m.pass,cards:m.cards?.map(visibleCard),comboKind:m.comboKind,mainRank:m.mainRank,handsAfter:[...m.handsAfter],toBeatKind:m.toBeatKind,toBeatRank:m.toBeatRank}));
  const knownTransfers=(record.tributes??[]).filter(t=>t.atMove<moveNo).map(t=>({kind:t.kind,from:t.from,to:t.to,card:visibleCard(t.card),atMove:t.atMove}));
  const applicable=!!target && !move.pass;
  const bombs=legalCombos(s).filter(c=>c.kind==='bomb'&&(c.size===4||c.size===5));
  const four=bombs.find(c=>c.size===4&&bombs.some(five=>five.size===5&&five.mainRank===c.mainRank&&c.cards.every(card=>five.cards.some(f=>f.id===card.id))))??null;
  const five=four?bombs.find(c=>c.size===5&&c.mainRank===four.mainRank&&four.cards.every(card=>c.cards.some(f=>f.id===card.id)))!:null;
  const bombComparison=four&&five?{fourCanBeatCurrent:s.lastCombo?beats(four,s.lastCombo):null,fiveCanBeatCurrent:s.lastCombo?beats(five,s.lastCombo):null,fiveBeatsFour:beats(five,four),fourRemaining:beforeCounts[actorSeat]-4,fiveRemaining:beforeCounts[actorSeat]-5,strategyPreference:null,fourPhysicalIds:four.cards.map(c=>c.id),fivePhysicalIds:five.cards.map(c=>c.id)}:null;
  return {
    schemaVersion:FACTS_SCHEMA_VERSION,decisionId:`${record.id}#m${moveNo}`,actorSeat,viewerSeat,teamId:teamOf(actorSeat),eventIndex,
    rulesId:fnvId(JSON.stringify(record.ruleOpts)),stageOwner:s.stageTeam??null,effectiveLevel:[...s.ctx.ranks].sort((a,b)=>a-b),
    currentTrickOwner:owner,beforeCounts,afterCounts,legalActualAction:true,actualActionId,
    actual:{pass:move.pass,cardCount:ids.length,text:move.pass?'不要':describeCombo(actualCombo!),physicalCardIds:ids},target,
    ruleRelation:{canBeatCurrent,applicabilityReason:move.pass?'过牌是本次选择，不证明压不动':target?'由引擎比较实际动作与当前目标牌':'领出时没有待压目标'},bombComparison,
    observationHash:fnvId(JSON.stringify([Array.from(vec),publicHistory,knownTransfers])),observationHashAlgorithm:'dual-lane-fnv1a-noncryptographic',
    revealedFacts:{actingSeat:actorSeat,ownHand:s.hands[actorSeat].map(visibleCard),otherHandCounts:beforeCounts,publicHistory,knownTransfers,
      actorHandVisibility:actorSeat===viewerSeat?'行动者即观察者：自家手牌当时可见':'行动者自家可见；观看者事后才知，不进入观看者的事前输入'},
    policyIdentity,policyAdvice:{nn:null,heuristic:null,search:null},
    passInference:move.pass?'choice_only_capacity_unknown':'not_a_pass',
    expressionScope:'只陈述程序核实的事实；启发式与网络属于各自偏好，尚未证明哪种打法更好',
    expectedAssertionIds:FACT_ASSERTION_IDS.map(id=>`${record.id}#m${moveNo}:v${viewerSeat}:${id}`),
    assertions:[
      {id:'target_and_owner',checked:true,applicable:true,text:target?`当前目标：${target.text}；控权席 ${owner}`:'当前领出，无待压目标与控权席'},
      {id:'actor_and_viewer',checked:true,applicable:true,text:`行动席 ${actorSeat}；观察席 ${viewerSeat}；行动队伍 ${teamOf(actorSeat)}`},
      {id:'actual_identity_and_count',checked:true,applicable:true,text:`实际动作 ${actualActionId}；${ids.length} 张；来源为原谱`},
      {id:'remaining_counts',checked:true,applicable:true,text:`行动前 ${beforeCounts.join('/')}；行动后 ${afterCounts.join('/')} 张`},
      {id:'rule_relation',checked:true,applicable,text:applicable?'实际动作经引擎核验可以压当前目标':'无需进行出牌大小比较',...(!applicable?{applicabilityReason:move.pass?'过牌只核合法性，不推断压制能力':'领出没有比较对象'}:{})},
      {id:'advice_source',checked:true,applicable:true,text:'本卡事实来自规则引擎与原谱；未加载的网络或未验证搜索不生成策略真值'},
    ],
  };
}
