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
  object(input,{observation,candidateSpec:one(['ohuo-frozen-c8-expand4-v1']),expansionCount:one([0,1]),
    candidates:array(x=>object(x,{actionId:text(80),action:nullable(combo),remainingHand:faces}),12,1),
    expandableGroups:array(x=>object(x,{groupId:text(80),kind:one([...kinds,'pass']),size:integer(0,27),wildConsumption:integer(0,4),remainingCount:integer(1)}),200),
  });
  if(input.candidates.length>(input.expansionCount===0?8:12)||input.expansionCount===1&&input.expandableGroups.length||new Set(input.candidates.map(x=>x.actionId)).size!==input.candidates.length||new Set(input.expandableGroups.map(x=>x.groupId)).size!==input.expandableGroups.length)fail('invalid_request');
  const bytes=JSON.stringify(input);if(new TextEncoder().encode(bytes).length>MAX_INPUT_BYTES)fail('input_too_large');
  return JSON.parse(bytes);
}
export function responseContract() {
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
    if(view.expansionCount!==0)fail('expansion_already_used');
    if(typeof v.groupId!=='string'||!view.expandableGroups.some(g=>g.groupId===v.groupId))fail('group_id_not_expandable');
  }
  return v;
}
