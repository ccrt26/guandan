import {PROJECT_RULES_TEACHER_WIRE_SCHEMA,PROJECT_RULES_TEACHER_PROMPT_ID,PROJECT_RULES_TEACHER_SYSTEM_SHA256,PROJECT_RULES_TEACHER_RESPONSE_ID,assertProjectRuleOptions} from './llm-project-rules-v541.mjs';
import {createHash} from 'node:crypto';
/** B04 wire boundary for the B02 public projection. No I/O or local GameState. */
export const RESPONSE_CONTRACT_VERSION = 'ohuo-choose-expand-v1';
export const MAX_INPUT_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 16 * 1024;
export class SelectionWireError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const fail = code => { throw new SelectionWireError(code); };
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function object(v, required, optional = {}) {
  if (!plain(v) || Object.keys(v).some(k => !Object.hasOwn(required,k) && !Object.hasOwn(optional,k)) || Object.keys(required).some(k => !Object.hasOwn(v,k))) fail('invalid_request');
  for (const [k,check] of Object.entries({...required,...optional})) if (Object.hasOwn(v,k)) check(v[k]);
}
const text = (max=256) => v => { if(typeof v!=='string'||!v.trim()||v.length>max) fail(v?.length>max?'input_too_large':'invalid_request'); };
const integer = (min=0,max=Number.MAX_SAFE_INTEGER) => v => {if(!Number.isSafeInteger(v)||v<min||v>max)fail('invalid_request');};
const one = values => v => {if(!values.includes(v))fail('invalid_request');};
const array = (check,max=108,min=0) => v => {if(!Array.isArray(v)||v.length<min||v.length>max)fail('invalid_request');for(const x of v)check(x);};
const nullable = check => v => {if(v!==null)check(v);};
const bool=one([true,false]), seat=integer(0,3), rank=one([2,3,4,5,6,7,8,9,10,11,12,13,14,16,17]);
const suit=one(['S','H','D','C','J']);
const face=v=>object(v,{suit,rank});
const faceCount=v=>object(v,{suit,rank,count:integer(1,2)});
const faces=array(faceCount,54);
const kinds=['single','pair','trio','trio_pair','straight','pair_seq','trio_seq','bomb','flush','joker_bomb'];
const combo=v=>object(v,{kind:one(kinds),size:integer(1,27),mainRank:integer(0,100),keyRank:integer(0,100),length:integer(1,27),pairRanks:array(rank,27),resources:faces,wildAs:array(x=>object(x,{card:face,asRank:rank},{asSuit:suit}),4)},{suit});
const transfer=v=>object(v,{from:seat,to:seat,card:face});
const result=v=>object(v,{finishOrder:array(seat,4,4),winnerTeam:one([0,1]),doubleUp:bool,levelsAfter:array(integer(2,14),2,2),upgrade:integer(1,3),passedA:one([false])});
function event(v) {
  if(!plain(v))fail('invalid_request');
  const forms={play:{type:one(['play']),player:seat,combo},pass:{type:one(['pass']),player:seat},finish:{type:one(['finish']),player:seat,order:integer(1,4)},trickEnd:{type:one(['trickEnd']),nextLeader:seat}};
  if(!Object.hasOwn(forms,v.type))fail('invalid_request');object(v,forms[v.type]);
}
function observation(v) {
  object(v,{
    schema:one(['ohuo-public-observation-v1']),decisionId:text(),matchId:text(),actorSeat:seat,partnerSeat:seat,phase:one(['play']),
    ruleOptions:x=>object(x,{levelMode:one(['stage','both','high']),passA:one(['head','head3','double']),pairSeqMin:integer(1),pairSeqMax:integer(1),trioSeqMin:integer(1),trioSeqMax:integer(1),flushLen:integer(1),straightLen:integer(1)}),
    rulesText:text(MAX_INPUT_BYTES),levelsBefore:array(integer(2,14),2,2),stageTeam:one([0,1]),effectiveLevelRanks:array(integer(2,14),2,1),gameNo:integer(1),moveNo:integer(),previousGameResult:nullable(result),ownHand:faces,
    seats:array(x=>object(x,{seat,remaining:integer(0,27),finishOrder:nullable(integer(1,4))}),4,4),target:nullable(combo),leader:seat,lastPlayer:integer(-1,3),passCount:integer(0,3),
    currentTrick:array(x=>object(x,{player:seat,combo:nullable(combo)}),2000),
    publicPrefix:array(x=>object(x,{moveNo:integer(1),priorTarget:nullable(combo),events:array(event,8,1)}),2000),
    tribute:nullable(x=>object(x,{resist:bool,tributes:array(transfer,2),returns:array(transfer,2),leader:seat})),
    knownOtherHands:array(x=>object(x,{seat,cards:faces}),3),playedCards:faces,unseenPool:faces,
    informationBoundary:one(['own-hand-and-public-prefix; pass-does-not-prove-inability']),
  });
  if(v.partnerSeat!==(v.actorSeat+2)%4||new Set(v.seats.map(x=>x.seat)).size!==4||v.publicPrefix.length!==v.moveNo)fail('invalid_request');
}
/** Exact recursive schema validation prevents unknown nested state/secret fields.
 * The trusted producer remains B02; this is a wire boundary, not a second engine. */
export function freezeRequestView(input) {
  const newSpec=input?.candidateSpec==='first-target-offer12-v1';
  object(input,{observation,candidateSpec:one([newSpec?'first-target-offer12-v1':'ohuo-frozen-c8-expand4-v1']),expansionCount:one(newSpec?[0]:[0,1]),
    ...(newSpec?{enumSpec:v=>object(v,{id:one(['full-house-attachment-ranks-v1']),enumerationMode:one(['all_supported_attachment_ranks'])})}:{}),
    candidates:array(x=>object(x,{actionId:text(80),action:nullable(combo),remainingHand:faces}),12,1),
    expandableGroups:array(x=>object(x,{groupId:text(80),kind:one([...kinds,'pass']),size:integer(0,27),wildConsumption:integer(0,4),remainingCount:integer(1)}),200),
  });
  if(input.candidates.length>(newSpec?12:input.expansionCount===0?8:12)||(newSpec||input.expansionCount===1)&&input.expandableGroups.length||new Set(input.candidates.map(x=>x.actionId)).size!==input.candidates.length||new Set(input.expandableGroups.map(x=>x.groupId)).size!==input.expandableGroups.length)fail('invalid_request');
  const bytes=JSON.stringify(input);if(new TextEncoder().encode(bytes).length>MAX_INPUT_BYTES)fail('input_too_large');
  return JSON.parse(bytes);
}
export function responseContract(view) {
  if(view?.candidateSpec==='first-target-offer12-v1')return 'ohuo-choose-only-v2\nReturn only a single JSON object. Choose exactly an actionId displayed in this request: {"kind":"choose","decisionId":"...","actionId":"..."}. An optional note must be at most 240 characters. This complete initial candidate specification forbids expansion and out-of-set actions. Do not output markdown, hidden reasoning, or additional fields. Use only the supplied rules and public information; passing does not imply inability.';
  return `${RESPONSE_CONTRACT_VERSION}\nReturn only a single JSON object. Choose exactly an actionId displayed in this request: {"kind":"choose","decisionId":"...","actionId":"..."}. An optional note must be at most 240 characters. Only when expansionCount=0, you may instead request one listed group: {"kind":"expand","decisionId":"...","groupId":"..."}. After expansion you must choose. Do not output markdown, hidden reasoning, or additional fields. Use only the supplied rules and public information; passing does not imply inability.`;
}
export function parseSelection(textValue, view) {
  let v;try {v=JSON.parse(textValue);}catch{fail('invalid_response_json');}
  if(!plain(v))fail('invalid_response_shape');
  const allowed=v.kind==='choose'?['kind','decisionId','actionId','note']:v.kind==='expand'?['kind','decisionId','groupId']:[];
  if(!allowed.length||Object.keys(v).some(k=>!allowed.includes(k))||typeof v.decisionId!=='string')fail('invalid_response_shape');
  if(v.decisionId!==view.observation.decisionId)fail('decision_id_mismatch');
  if(v.kind==='choose') {
    if(typeof v.actionId!=='string'||!view.candidates.some(c=>c.actionId===v.actionId))fail('action_id_not_offered');
    if('note' in v&&(typeof v.note!=='string'||v.note.length>240))fail('invalid_response_shape');
  } else {
    if(view.candidateSpec==='first-target-offer12-v1')fail('expansion_disabled_for_candidate_spec');
    if(view.expansionCount!==0)fail('expansion_already_used');
    if(typeof v.groupId!=='string'||!view.expandableGroups.some(g=>g.groupId===v.groupId))fail('group_id_not_expandable');
  }
  return v;
}

/** r2 local envelope. Only modelPayloadBytes and the constant response contract
 * cross the provider boundary. Local decision IDs/maps never enter messages. */
export const COMMON_VIEW_WIRE_SCHEMA='ohuo-common-view-request-r2';
export const COMMON_VIEW_RESPONSE_ID='common-view-r2';
export const COMMON_VIEW_RESPONSE_CONTRACT='Return only one JSON object: {"kind":"choose","decisionId":"common-view-r2","actionId":"c0","note":"optional short reason"}. Choose an address listed in the supplied candidates; no expansion. A short reason of at most 120 characters is preferred; the accepted maximum remains 240. Do not output markdown or extra fields. Current leadership does not mean the trick is won; do not invent information absent from the supplied view.';
export const COMMON_VIEW_SYSTEM_PROMPT_SHA256=createHash('sha256').update(COMMON_VIEW_RESPONSE_CONTRACT,'utf8').digest('hex');
const commonCard=v=>object(v,{card:x=>{if(typeof x!=='string'||!(/^(?:[SHDC](?:[2-9]|1[0-4])|SJ|BJ)$/.test(x)))fail('invalid_request');},count:integer(1,2)});
const commonCards=array(commonCard,54);
const commonKind=nullable(one(kinds));
const relative=one(['partner','lower','upper']);
// Keep the original rank range; the engine's joker-bomb sentinel is the sole exception.
function commonRankedObject(v,required){
 object(v,{...required,comparisonRank:integer(0,99)});
 if(v.comparisonRank>41&&(v.kind!=='joker_bomb'||v.comparisonRank!==99))fail('invalid_request');
}
const commonAction=v=>commonRankedObject(v,{pass:bool,cards:commonCards,kind:commonKind,size:integer(0,10),wildCount:integer(0,2)});
function commonState(v){
 const other=x=>object(x,{remainingCards:integer(0,27),reportedLow:bool,finishOrder:nullable(integer(1,4))});
 const recent=array(x=>commonRankedObject(x,{unknown:bool,pass:bool,kind:commonKind,size:integer(0,10)}),3,3);
 const memory=x=>object(x,{J:integer(0,8),Q:integer(0,8),K:integer(0,8),LEVEL_OTHER:integer(0,8),SJ:integer(0,2),BJ:integer(0,2)});
 object(v,{myHand:commonCards,unplayedOutsideOwnHand:commonCards,currentTarget:x=>commonRankedObject(x,{cards:commonCards,leadingSeat:nullable(relative),kind:commonKind,size:integer(0,10)}),otherSeats:x=>object(x,{partner:other,lower:other,upper:other}),recentMoves:x=>object(x,{partner:recent,lower:recent,upper:recent}),levels:x=>object(x,{own:integer(2,14),opponent:integer(2,14),effectiveRank:nullable(integer(2,14)),ownTeamOnStage:bool}),ownWildCount:integer(0,2),encodedTributeBits:x=>object(x,{resistance:bool,selfIsTributeGiver:bool}),publicHighCardMemory:x=>object(x,{self:memory,partner:memory,upper:memory,lower:memory})});
}
export function freezeCommonViewRequest(input){
 object(input,{schema:one([COMMON_VIEW_WIRE_SCHEMA]),decisionId:text(),modelPayloadBytes:text(MAX_INPUT_BYTES),addressMap:array(x=>object(x,{address:text(80),actionId:text(80),equivalentActionIds:array(text(80),12,1)}),12,1)});
 if(new TextEncoder().encode(input.modelPayloadBytes).length>MAX_INPUT_BYTES)fail('input_too_large');
 let payload;try{payload=JSON.parse(input.modelPayloadBytes);}catch{fail('invalid_request');}
 object(payload,{schema:one(['first-round-common-view-r2']),rules:array(text(512),6,6),state:commonState,candidates:array(x=>object(x,{address:text(80),action:commonAction}),12,1)});
 if(JSON.stringify(payload)!==input.modelPayloadBytes||payload.candidates.length!==input.addressMap.length||payload.candidates.some((c,i)=>c.address!==`c${i}`||input.addressMap[i].address!==c.address||!input.addressMap[i].equivalentActionIds.includes(input.addressMap[i].actionId))||new Set(input.addressMap.flatMap(x=>x.equivalentActionIds)).size!==input.addressMap.flatMap(x=>x.equivalentActionIds).length)fail('invalid_request');
 const expectedRules=[
 '仅根据本视图从给定候选地址选动作，不补造任何玩家持牌。',
 '当前领先不等于已经赢得本墩；PASS只是选择不出牌，不证明不能压。',
 '三带二比较三张主体的比较点数，不比较带牌。',
 'unplayedOutsideOwnHand仅为尚未公开打出且不在本人手中的总量，不含归属信息。',
 'recentMoves仅保存各相对玩家最近三次动作（新到旧）；缺失历史未知。',
 'publicHighCardMemory为编码已保存的出牌累计，不表示剩余持有者；LEVEL_OTHER保留原编码类别，不补全贡还归属。'];
 if(JSON.stringify(payload.rules)!==JSON.stringify(expectedRules))fail('invalid_request');
 return JSON.parse(JSON.stringify(input));
}
export function parseCommonViewSelection(textValue,view){
 let v;try{v=JSON.parse(textValue);}catch{fail('invalid_response_json');}
 if(!plain(v)||v.kind!=='choose'||Object.keys(v).some(k=>!['kind','decisionId','actionId','note'].includes(k))||typeof v.decisionId!=='string'||typeof v.actionId!=='string'||('note'in v&&(typeof v.note!=='string'||v.note.length>240)))fail('invalid_response_shape');
 if(v.decisionId!==COMMON_VIEW_RESPONSE_ID)fail('decision_id_mismatch');
 const mapped=view.addressMap.find(x=>x.address===v.actionId);if(!mapped)fail('action_id_not_offered');
 return {...v,decisionId:view.decisionId,actionId:mapped.actionId};
}

/** Explicit v5.4.1 envelope; the existing 423 payload/addresses remain strict. */
export function freezeProjectRulesRequest(input){
 object(input,{schema:one([PROJECT_RULES_TEACHER_WIRE_SCHEMA]),promptId:one([PROJECT_RULES_TEACHER_PROMPT_ID]),systemPromptSHA256:one([PROJECT_RULES_TEACHER_SYSTEM_SHA256]),ruleOptions:value=>{try{assertProjectRuleOptions(value);}catch{fail('invalid_request');}},decisionId:text(),modelPayloadBytes:text(MAX_INPUT_BYTES),addressMap:array(x=>object(x,{address:text(80),actionId:text(80),equivalentActionIds:array(text(80),12,1)}),12,1)});
 freezeCommonViewRequest({schema:COMMON_VIEW_WIRE_SCHEMA,decisionId:input.decisionId,modelPayloadBytes:input.modelPayloadBytes,addressMap:input.addressMap});
 return JSON.parse(JSON.stringify(input));
}
export function parseProjectRulesSelection(textValue,view){
 let v;try{v=JSON.parse(textValue);}catch{fail('invalid_response_json');}
 if(!plain(v)||Object.keys(v).length!==4||Object.keys(v).some(k=>!['kind','decisionId','actionId','note'].includes(k))||v.kind!=='choose'||typeof v.decisionId!=='string'||typeof v.actionId!=='string'||typeof v.note!=='string'||!v.note.trim())fail('invalid_response_shape');
 if(v.decisionId!==PROJECT_RULES_TEACHER_RESPONSE_ID)fail('decision_id_mismatch');
 const mapped=view.addressMap.find(x=>x.address===v.actionId);if(!mapped)fail('action_id_not_offered');
 return {...v,decisionId:view.decisionId,actionId:mapped.actionId};
}
