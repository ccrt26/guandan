import {classify,beats,canPass,legalCombos,buildDeck,createMatch,startGame,makeLevelCtx,DEFAULT_RULES,applyTribute,completeReturn,type GameState,type Combo,type Card,type GameResult} from '@gd/engine';
import {dedupCandidates,PublicTracker,encodeStateV2,STATE_DIM_V2} from '@gd/ai';
import {createHash} from 'node:crypto';
import {codeOfCard,DEFAULT_MAPPING,type KscbEvent,type KscbRound} from '../src/review5_tuning/kscbReplay';
import {necessaryDeclarationKey} from './action-effect';
export interface SourceActionAudit {targetRuleLegal:boolean;candidateCovered:boolean;targetIndices:number[];reasons:string[];usableForH:boolean;combo:Combo|null;observationHash:string;}
export type SourceReplayState=GameState;
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const seatOf=(uid:string)=>{if(!/^P[1-4]$/.test(uid))throw new Error('source UID is not a known seat alias');return Number(uid.slice(1))-1;};
const rankOf=(value:number)=>{if(!Number.isInteger(value)||value<1||value>13)throw new Error('source level context unresolved');return value===1?14:value;};

/** Only current-round public role fields are read from result. Terminal ranks,
 * rewards and terminal hands are deliberately outside this constructor. */
export function buildSourceRound(round:KscbRound,roundIndex=0,previous:GameResult|null=null){
 const start=round.events.find(e=>e.event_id===1),bankers=round.result.players.filter(p=>p.is_banker).map(p=>seatOf(p.uid));
 if(bankers.length!==2||bankers[0]%2!==bankers[1]%2)throw new Error('source public banker partnership unresolved');
 const stageTeam=bankers[0]%2 as 0|1,meta=start?.data as {hostteam?:{level?:number};guestteam?:{level?:number}}|undefined;
 if(previous&&previous.winnerTeam!==stageTeam)throw new Error('stage owner differs from preceding public winner');
 const host=rankOf(start?.tiles?.[0]??round.host_team_level??meta?.hostteam?.level??NaN),guest=rankOf(start?.tiles?.[1]??round.opposite_team_level??meta?.guestteam?.level??NaN);
 const levels:[number,number]=stageTeam===0?[host,guest]:[guest,host];
 if(previous&&JSON.stringify(previous.levelsAfter)!==JSON.stringify(levels))throw new Error('cross-round target level progression differs');
 const match=createMatch({...DEFAULT_RULES},1),state=startGame(match),stock=buildDeck();
 const initial:Card[][]=[];
 for(let seat=0;seat<4;seat++){
  const entries=round.events.filter(e=>e.event_id===2&&seatOf(e.uid)===seat);
  if(entries.length!==1||entries[0].tiles?.length!==27)throw new Error('initial source hand shape invalid');
  initial.push(entries[0].tiles.map(code=>{const index=stock.findIndex(c=>codeOfCard(c,DEFAULT_MAPPING)===code);if(index<0)throw new Error('source deck multiplicity invalid');return stock.splice(index,1)[0];}));
 }
 if(stock.length)throw new Error('source deck incomplete');
 match.levels=[...levels];match.gameNo=roundIndex+1;match.lastResult=previous;match.lastHead=previous?.finishOrder[0]??null;
 state.levelsBefore=[...levels];state.stageTeam=stageTeam;state.ctx=makeLevelCtx(levels,'stage',stageTeam);state.hands=initial.map(h=>[...h]);
 const first=round.events.find(e=>e.event_id===3||e.event_id===4);if(!first)throw new Error('round contains no source actions');
 state.turn=seatOf(first.uid);state.leader=state.turn;state.lastPlayer=state.leader;
 const exchange=round.events.find(e=>e.event_id===8),raw=Array.isArray(exchange?.data)?exchange.data as Array<{from:string;uid:string;tile:number}>:[];
 const knownTransfers=raw.map(move=>({from:seatOf(move.from),to:seatOf(move.uid),code:move.tile,kind:'source_exchange',atAction:0}));
 if(previous){
  const tribute=applyTribute(state,[0,1,2,3]);
  state.tribute=tribute;
  if(tribute){state.leader=tribute.leader;state.turn=state.pendingReturns.length?state.pendingReturns[0].from:tribute.leader;state.lastPlayer=tribute.leader;}
  const gifts=(tribute?.tributes??[]).map(t=>({from:t.from,to:t.to,code:codeOfCard(t.card,DEFAULT_MAPPING)}));
  const remaining=[...knownTransfers];
  for(const gift of gifts){const index=remaining.findIndex(t=>t.from===gift.from&&t.to===gift.to&&t.code===gift.code);if(index<0)throw new Error('source tribute differs from target rule flow');remaining.splice(index,1);}
  while(state.pendingReturns.length){
   const pending=state.pendingReturns[0],index=remaining.findIndex(t=>t.from===pending.from&&t.to===pending.to);if(index<0)throw new Error('source return flow missing');const transfer=remaining.splice(index,1)[0],card=state.hands[pending.from].find(c=>codeOfCard(c,DEFAULT_MAPPING)===transfer.code);if(!card)throw new Error('source return card not owned');completeReturn(state,card);
  }
  if(remaining.length||state.turn!==seatOf(first.uid))throw new Error('source exchange or first actor differs from target');
 }else{
  if(roundIndex!==0)throw new Error('cannot restart target prefix after an incompatible round');
  if(raw.length)throw new Error('first source round has unexpected exchange');
 }
 return {state,knownTransfers,context:{stageTeam,levels,roleProvenance:'source schema current-round banker identity; never terminal finish order',levelProvenance:start?.tiles?'event1.tiles':round.host_team_level!=null?'round pregame levels':'event1 public level data'}};
}
export function resourceEffectKey(combo:Combo|null):string{
 if(!combo)return 'pass';
 return JSON.stringify({kind:combo.kind,mainRank:combo.mainRank,keyRank:combo.keyRank,length:combo.length,size:combo.size,
  resources:combo.cards.map(c=>codeOfCard(c,DEFAULT_MAPPING)).sort((a,b)=>a!-b!),
  wildAs:combo.wildAs.map(w=>({code:codeOfCard(combo.cards.find(c=>c.id===w.cardId)!,DEFAULT_MAPPING),rank:w.asRank,suit:w.asSuit})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),pairRanks:[...combo.pairRanks].sort((a,b)=>a-b)});
}
function allowedKinds(pattern:number|undefined):string[]|null{
 return pattern==null?null:({1:['single'],2:['pair'],3:['pair_seq'],4:['trio'],5:['trio_seq'],6:['straight'],7:['trio_pair'],8:['bomb','flush','joker_bomb']} as Record<number,string[]>)[pattern]??[];
}
export function inspectSourceAction(state:GameState,event:KscbEvent,tracker:PublicTracker,publicPrefix:unknown[],knownTransfers:unknown[]){
 const actor=Number(event.uid.slice(1))-1,reasons:string[]=[],pass=event.event_id===4;
 if(!Number.isInteger(actor)||actor<0||actor>3||state.turn!==actor||state.over)reasons.push('actor_turn_or_terminal_mismatch');
 const own=state.hands[actor]??[],picked:Card[]=[],used=new Set<number>();
 if(!pass)for(const code of event.tiles??[]){const card=own.find(c=>!used.has(c.id)&&codeOfCard(c,DEFAULT_MAPPING)===code);if(!card){reasons.push('raw_card_not_owned');break;}picked.push(card);used.add(card.id);}
 if(!pass&&!picked.length)reasons.push('empty_play');
 const ids=picked.map(c=>c.id).sort((a,b)=>a-b).join(','),sameCards=(c:Combo)=>c.cards.map(c=>c.id).sort((a,b)=>a-b).join(',')===ids;
 const shapes=!pass&&reasons.length===0?classify(picked,state.ctx,state.match.opts).filter(sameCards):[];
 const variants=shapes.filter(c=>!state.lastCombo||beats(c,state.lastCombo));
 const targetRuleLegal=reasons.length===0&&(pass?canPass(state):variants.length>0);
 const allowed=allowedKinds(event.pattern),declared=variants.filter(c=>allowed===null||allowed.includes(c.kind));
 const effectKey=(combo:Combo|null)=>necessaryDeclarationKey(combo,state.ctx);
 const unique=[...new Map(declared.map(c=>[effectKey(c),c])).values()];
 if(!targetRuleLegal){
  if(pass)reasons.push('illegal_lead_pass');
  else if(!reasons.length){
   const withoutLevel={ranks:new Set<number>(),levels:state.ctx.levels};
   const sourceOnly=classify(picked,withoutLevel,state.match.opts).some(sameCards);
   const jokers=picked.filter(c=>c.rank>=16),naturals=picked.filter(c=>c.rank<16);
   reasons.push(shapes.length?'target_response_does_not_beat':sourceOnly?'source_rule_difference_level_sequence':jokers.length===2&&jokers[0].rank===jokers[1].rank&&naturals.length===3&&new Set(naturals.map(c=>c.rank)).size===1?'source_rule_difference_joker_pair_trio':'unresolved_target_rule_illegal');
  }
 }else if(!pass&&unique.length===0)reasons.push('source_declaration_pattern_unresolved');
 else if(!pass&&unique.length>1)reasons.push('ambiguous_declaration');
 const combos=legalCombos(state),candidates=dedupCandidates(combos,canPass(state)),candidateKeys=candidates.map(c=>effectKey(c.combo));
 const wanted=new Set(pass?['pass']:unique.map(effectKey)),targetIndices=candidateKeys.flatMap((key,index)=>wanted.has(key)?[index]:[]);
 const candidateCovered=targetRuleLegal&&targetIndices.length>0;
 const enumeratorCovered=pass?canPass(state):combos.some(c=>wanted.has(effectKey(c)));
 if(targetRuleLegal&&!candidateCovered&&!reasons.includes('source_declaration_pattern_unresolved'))reasons.push(enumeratorCovered?'candidate_dedup_omission':'enumerator_pruned_resource_variants');
 const stateFeatures=new Float32Array(STATE_DIM_V2);encodeStateV2(state,actor,tracker,stateFeatures,'rule-context');
 const visible={actor,own:own.map(c=>({id:c.id,suit:c.suit,rank:c.rank})),counts:state.hands.map(h=>h.length),levels:state.levelsBefore,stageTeam:state.stageTeam,target:effectKey(state.lastCombo),owner:state.lastCombo?state.lastPlayer:null,publicPrefix,knownTransfers,features:Array.from(stateFeatures)};
 return {targetRuleLegal,candidateCovered,enumeratorCovered,targetIndices,reasons,usableForH:targetRuleLegal&&candidateCovered&&reasons.length===0,combo:pass?null:unique.length===1?unique[0]:null,declarationCount:pass?1:unique.length,
  observationHash:hash(JSON.stringify(visible)),capacityInference:pass?'choice_only_capacity_unknown':'not_a_pass',candidateKeys,candidateCombos:candidates.map(c=>c.combo),stateFeatures,
  rawTiles:event.tiles??null,mappingVersion:'kscb-rank-v1-SHDC-pattern-v3',actionEquivalenceVersion:'complete-resources-necessary-wild-effects-v1',targetPhysicalIds:picked.map(c=>c.id),declaredActionKey:pass?'pass':unique.length===1?effectKey(unique[0]):null,rawDeclaredActionKey:pass?'pass':unique.length===1?resourceEffectKey(unique[0]):null,
  representationGaps:knownTransfers.length?['known_transfer_owner_not_encoded_in_schema_v4']:[]};
}
