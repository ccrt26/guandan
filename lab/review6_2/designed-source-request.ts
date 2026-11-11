/** §44.4 designer request over the original profile/SSE transport.
 * No provider start at import/prepare. The H owner supplies its original metered
 * request and private checkpoint writer inside an admitted run. This module
 * neither authorizes that run nor admits a response as a teaching source. */
import {isDeepStrictEqual as equal} from 'node:util';
import {buildDeck,classify,createMatch,rankOrder,startGame,type LevelCtx,type RuleOptions} from '@gd/engine';
import {freezeCopy} from '../../packages/ai/src/hybrid/protocol';
import {createProfileTextTransport} from '../../packages/web/server/llm-select.mjs';
import {SelectionWireError} from '../../packages/web/server/llm-selection-wire.mjs';
import {PROJECT_RULES_DESIGN_PROMPT_ID,PROJECT_RULES_DESIGN_SYSTEM_SHA256,assertProjectRuleOptions,serializeProjectRulesChat} from '../../packages/web/server/llm-project-rules-v543.mjs';
import {DESIGNED_FIRST_GAME_SCHEMA,DESIGNED_FIRST_GAME_V2_SCHEMA,parseDesignedFirstGameSource,type DesignedFirstGameSource} from './designed-source';
import {FIRST_ROUND_TARGET_DEFINITION} from './first-round-target';
import {digest,fixedReference,strictObject,validateIdentifier} from './task-schema.mjs';

export const DESIGNED_REQUEST_SCHEMA='ohuo-designed-source-request-v1' as const;
/** Exactly the existing source parser's JSON byte boundary, not a token/time or
 * request cap. Original SSE frame/stream safety limits also remain unchanged. */
export const DESIGNED_RESPONSE_MAX_BYTES=4*1024*1024;
const need=(ok:unknown,code:string)=>{if(!ok)throw new SelectionWireError(code);};
const kinds=['single','pair','trio','trio_pair','straight','pair_seq','trio_seq','bomb','flush','joker_bomb'];
const coverageKeys=['targetKind','opponentSizeRelation','hasOrdinaryTakeover','partnerZero','hasNaturalNonJokerOption','ownHasFewerCardsThanPartner'];
export interface DesignedPublicCoverage {
 targetKind:string;opponentSizeRelation:'<'|'='|'>';hasOrdinaryTakeover:boolean;partnerZero:boolean;hasNaturalNonJokerOption:boolean;ownHasFewerCardsThanPartner:boolean;
}
export interface DesignedRequestSpec {
 questionId:string;designFamilyId:string;engineSourceRef:string;rulesRef:string;ruleOptions:RuleOptions;coverage:DesignedPublicCoverage;
 firstGameOrigin?:{leaderSeed:number;firstLeader:number;previousPublicPrefixFailure:{gameNo:1;moveNo:0;expectedActorSeat:number;declaredActorSeat:number}};
 comboDeclarationContract?:'engine-combo-fields-v1'|'engine-combo-fields-v2';
}
const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const arr=(items:unknown,minItems:number,maxItems:number)=>({type:'array',minItems,maxItems,items});
const int=(minimum:number,maximum:number)=>({type:'integer',minimum,maximum});
function prepareComboDeclarationContract(spec:DesignedRequestSpec,deck:ReturnType<typeof buildDeck>,ctx:LevelCtx){
 const ordinary=Array.from({length:13},(_,i)=>i+2),faces=[...ordinary,16,17],R=(r:number)=>rankOrder(r,ctx),range=(a:number,b:number)=>a===b?{const:a}:int(a,b),rules=spec.ruleOptions;
 const byKind={single:[1,1,'r','R(r)',[]],pair:[2,1,'r','R(r)',[]],trio:[3,1,'r','R(r)',[]],trio_pair:[5,1,'trio rank r','R(r)',['pair rank s, s != r']],straight:[rules.straightLen,rules.straightLen,'last raw rank','h',[]],pair_seq:['2L','L','last raw rank','h',[]],trio_seq:['3L','L','last raw rank','h',[]],bomb:['4..8',1,'r','R(r)',[]],flush:[rules.flushLen,rules.flushLen,'last raw rank','h',[]],joker_bomb:[4,1,17,99,[]]};
 const sample=(cards:typeof deck,kind:string)=>{const value=classify(cards,ctx,rules).find(c=>c.kind===kind);need(value,'designer_combo_example');const {suit,...rest}=value!;return suit===undefined?rest:{...rest,suit};};
 const guide={schema:'engine-combo-fields-v1',columns:['size','length','mainRank','keyRank','pairRanks'],byKind,
  rankOrder:'R(r): ordinary raw rank; current level rank 20+r; small joker 40; big joker 41. First game level 2 gives R(2)=22, R(3)=3.',
  sequence:'h is the final position in 1=A-low, 2..14=2..A-high. Remove current level positions without compressing or crossing gaps. mainRank is the raw rank at the final position. At level 2, A2345 is not a legal example.',
  groups:{pair_seq:{LMin:rules.pairSeqMin,LMax:rules.pairSeqMax},trio_seq:{LMin:rules.trioSeqMin,LMax:rules.trioSeqMax}},
  ranks:'single/pair may use natural jokers; trio, trio_pair main and kicker pair, and bomb use ordinary ranks 2..14. A trio sequence has no attached pair. A joker_bomb contains exactly two small and two big jokers.',
  physical:'size equals cards.length. Every id/suit/rank must match physicalDeck, be owned by the actor, and be used at most once. suit is required only for flush (S/H/D/C); omit it for all other kinds, never J or null.',
  wildAs:'Each cardId is unique, belongs to cards and is a heart level card. asRank is 2..14, never a joker. Real non-natural substitutions must be declared. For flush, asSuit must equal combo.suit. Otherwise omit asSuit (or use S as the engine annotation). Natural-rank self substitution is an equivalent annotation and need not be declared. With no substitutions use []; joker_bomb always uses [].',
  semantic:'Use one legal interpretation consistently. Derived size/length/keyRank are not placeholders. kind/cards/mainRank/pairRanks/flush.suit/real wildAs express the selected meaning; the engine will not replace it with a stronger or different interpretation.',
  knownDeclarationPitfall:{kind:'single',keyRank:3,declared:{mainRank:0,length:0},engine:{mainRank:3,length:1}},
  engineExamples:[sample([deck.find(c=>c.suit==='S'&&c.rank===3)!],'single'),sample([deck.find(c=>c.suit==='S'&&c.rank===2)!],'single'),sample(deck.filter(c=>c.suit==='J'),'joker_bomb')],
 };
 const conditions=kinds.map(kind=>{const sequence=['straight','flush','pair_seq','trio_seq'].includes(kind),joker=kind==='joker_bomb',length=kind==='straight'?range(rules.straightLen,rules.straightLen):kind==='flush'?range(rules.flushLen,rules.flushLen):kind==='pair_seq'?range(rules.pairSeqMin,rules.pairSeqMax):kind==='trio_seq'?range(rules.trioSeqMin,rules.trioSeqMax):{const:1};
  const bounds=kind==='single'?[1,1]:kind==='pair'?[2,2]:kind==='trio'?[3,3]:kind==='trio_pair'?[5,5]:kind==='straight'?[rules.straightLen,rules.straightLen]:kind==='flush'?[rules.flushLen,rules.flushLen]:kind==='pair_seq'?[2*rules.pairSeqMin,2*rules.pairSeqMax]:kind==='trio_seq'?[3*rules.trioSeqMin,3*rules.trioSeqMax]:kind==='bomb'?[4,8]:[4,4];
  const properties:any={size:range(bounds[0],bounds[1]),cards:{minItems:bounds[0],maxItems:bounds[1]},length,mainRank:joker?{const:17}:{enum:['single','pair'].includes(kind)?faces:ordinary},keyRank:joker?{const:99}:sequence?{enum:Array.from({length:14},(_,i)=>i+1).filter(h=>!ctx.ranks.has(h===1?14:h))}:{enum:[...new Set((['single','pair'].includes(kind)?faces:ordinary).map(R))]},pairRanks:arr({type:'integer',enum:ordinary},kind==='trio_pair'?1:0,kind==='trio_pair'?1:0)};
  if(joker)properties.wildAs={const:[]};return{if:{properties:{kind:{const:kind}}},then:{properties,...(kind==='flush'?{required:['suit']}:{not:{required:['suit']}})}};
 });return{guide,conditions};
}
function responseSchema(spec:DesignedRequestSpec,declaration?:ReturnType<typeof prepareComboDeclarationContract>){
 const card=obj({id:int(0,107),suit:{enum:['S','H','D','C','J']},rank:{enum:[2,3,4,5,6,7,8,9,10,11,12,13,14,16,17]}});
 const wild={...obj({cardId:int(0,107),asRank:int(2,14)}),properties:{cardId:int(0,107),asRank:int(2,14),asSuit:{enum:['S','H','D','C']}}};
 const combo:any={...obj({kind:{enum:kinds},cards:arr(card,1,27),size:int(1,27),keyRank:int(0,108),length:int(0,108),pairRanks:arr(int(2,17),0,13),mainRank:int(0,108),wildAs:arr(wild,0,2)}),properties:{kind:{enum:kinds},cards:arr(card,1,27),size:int(1,27),keyRank:int(0,108),length:int(0,108),pairRanks:arr(int(2,17),0,13),mainRank:int(0,108),wildAs:arr(wild,0,2),suit:{enum:['S','H','D','C','J']}}};
 if(declaration){combo.properties.length=int(1,108);combo.properties.mainRank={type:'integer',enum:[2,3,4,5,6,7,8,9,10,11,12,13,14,16,17]};combo.properties.keyRank=int(1,99);combo.properties.suit={enum:['S','H','D','C']};combo.allOf=declaration.conditions;}
 if(spec.comboDeclarationContract==='engine-combo-fields-v2'){
  combo.required=['kind','cards','wildAs'];combo.properties.suit={enum:['S','H','D','C','J']};
  combo.allOf=declaration!.conditions.map((condition:any)=>{const kind=condition.if.properties.kind.const,{not,...then}=condition.then;return{if:condition.if,then:{...then,...(!['single','joker_bomb'].includes(kind)?{required:[...(then.required??[]),'mainRank',...(kind==='trio_pair'?['pairRanks']:[])]}: {})}};});
 }
 const move={oneOf:[obj({pass:{const:true}}),obj({pass:{const:false},combo})]};
 return obj({schema:{const:spec.comboDeclarationContract==='engine-combo-fields-v2'?DESIGNED_FIRST_GAME_V2_SCHEMA:DESIGNED_FIRST_GAME_SCHEMA},sourceKind:{const:'designed-synthetic'},questionId:{const:spec.questionId},designFamilyId:{const:spec.designFamilyId},split:{const:'train'},engineSourceRef:{const:spec.engineSourceRef},rulesRef:{const:spec.rulesRef},rules:{const:spec.ruleOptions},origin:obj({kind:{const:'first-game'},leaderSeed:spec.firstGameOrigin?{const:spec.firstGameOrigin.leaderSeed}:int(0,0xffffffff)}),initialIds:arr(arr(int(0,107),27,27),4,4),moves:arr(obj({gameNo:{const:1},actorSeat:int(0,3),move}),0,2500),target:obj({gameNo:{const:1},moveNo:int(0,2500),actorSeat:int(0,3),remainingCards:arr(int(0,27),4,4)})});
}
export function prepareDesignedSourceRequest(spec:DesignedRequestSpec){
 strictObject(spec,'designer.spec',['questionId','designFamilyId','engineSourceRef','rulesRef','ruleOptions','coverage',...(Object.hasOwn(spec??{},'firstGameOrigin')?['firstGameOrigin']:[]),...(Object.hasOwn(spec??{},'comboDeclarationContract')?['comboDeclarationContract']:[])]);
 validateIdentifier(spec.questionId,'designer.questionId');validateIdentifier(spec.designFamilyId,'designer.designFamilyId');fixedReference(spec.engineSourceRef,'designer.engineSourceRef');fixedReference(spec.rulesRef,'designer.rulesRef');
 assertProjectRuleOptions(spec.ruleOptions);need(spec.rulesRef.split(':').at(-1)===digest(spec.ruleOptions),'designer_rules_identity');
 strictObject(spec.coverage,'designer.publicCoverage',coverageKeys);
 need(kinds.includes(spec.coverage.targetKind)&&['<','=','>'].includes(spec.coverage.opponentSizeRelation)&&coverageKeys.slice(2).every(k=>typeof (spec.coverage as any)[k]==='boolean'),'designer_public_coverage');
 if(Object.hasOwn(spec,'comboDeclarationContract')){need(['engine-combo-fields-v1','engine-combo-fields-v2'].includes(spec.comboDeclarationContract!),'designer_combo_contract');need(Object.hasOwn(spec,'firstGameOrigin'),'designer_combo_contract_origin_required');}
 const physicalDeck=buildDeck();let firstGameContext:LevelCtx|undefined;
 if(Object.hasOwn(spec,'firstGameOrigin')){
  const origin=spec.firstGameOrigin!;strictObject(origin,'designer.firstGameOrigin',['leaderSeed','firstLeader','previousPublicPrefixFailure']);
  need(Number.isSafeInteger(origin.leaderSeed)&&origin.leaderSeed>=0&&origin.leaderSeed<=0xffffffff&&Number.isSafeInteger(origin.firstLeader)&&origin.firstLeader>=0&&origin.firstLeader<=3,'designer_first_game_origin');
  const failure=origin.previousPublicPrefixFailure;strictObject(failure,'designer.previousPublicPrefixFailure',['gameNo','moveNo','expectedActorSeat','declaredActorSeat']);
  need(failure.gameNo===1&&failure.moveNo===0&&[failure.expectedActorSeat,failure.declaredActorSeat].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=3)&&failure.expectedActorSeat!==failure.declaredActorSeat,'designer_public_origin_failure');
  // Declared deals do not shuffle. Use the original engine, never ask the model
  // to infer the RNG mapping or let a supplied firstLeader override its turn.
  const ids=Array.from({length:4},(_,i)=>physicalDeck.slice(i*27,(i+1)*27).map(c=>c.id)),initial=startGame(createMatch(structuredClone(spec.ruleOptions),origin.leaderSeed),[],ids);firstGameContext=initial.ctx;
  need(initial.match.gameNo===1&&initial.moveNo===0&&!initial.over&&initial.pendingReturns.length===0&&initial.turn===origin.firstLeader,'designer_first_leader_identity');
 }
 const declaration=spec.comboDeclarationContract?prepareComboDeclarationContract(spec,physicalDeck,firstGameContext!):undefined;
 const payload={schema:DESIGNED_REQUEST_SCHEMA,promptId:PROJECT_RULES_DESIGN_PROMPT_ID,systemPromptSHA256:PROJECT_RULES_DESIGN_SYSTEM_SHA256,...structuredClone(spec),split:'train' as const,targetDefinition:FIRST_ROUND_TARGET_DEFINITION,physicalDeck,responseSchema:responseSchema(spec,declaration),...(declaration?{comboDeclarationGuide:declaration.guide}:{}),requirements:[
  'Return only one JSON object matching responseSchema. No markdown, commentary, label, preferred action, score, outcome, candidate list or claim of a natural sampled match.',
  'Construct a complete explicit first-game deal using physicalDeck: every physical ID 0..107 occurs once across four hands of 27. leaderSeed selects only the first leader; it is not a natural deal seed.',
  'The first game starts at level 2 with no tribute. Supply a legal causal move prefix; target.moveNo equals moves.length. Preserve exact card IDs, faces and necessary wildcard declarations.',
  'At target the actor is to move, its partner is currently highest, both teams retain active players, and legal PASS and takeover must exist. Target remainingCards must equal original-engine replay.',
  'coverage describes only an approved public train-coverage gap, not an answer or desired outcome. Do not use dev/holdout examples or prior teacher answers. Original B-prime/423 capture decides the actual available C locally.',
  ...(spec.firstGameOrigin?[
   `Use exactly origin.leaderSeed=${spec.firstGameOrigin.leaderSeed}. The original engine with a declared deal starts gameNo=1, moveNo=0, first actorSeat=${spec.firstGameOrigin.firstLeader}, no tribute or pending returns. Do not assume seat 0 starts.`,
   'previousPublicPrefixFailure is only a prior public origin mismatch, not an action label or a source to copy. Construct a new independent deal and causal prefix. Every later actorSeat must follow the original engine after each move/pass/finish, not an assumed fixed cycle; target actor/counts must match that replay. Include only the prefix needed for the requested public target; do not execute the target.',
  ]:[]),
  ...(declaration?[spec.comboDeclarationContract==='engine-combo-fields-v2'?'Use comboDeclarationGuide for exact engine meanings. v2 requires kind, physical cards and wildAs; mainRank is required except single/joker_bomb; trio_pair requires pairRanks and flush requires suit. Only size/length/keyRank, single/joker_bomb mainRank and non-trio_pair empty pairRanks may be omitted. Supplied values must be exact, never null or 0 placeholders. Only one necessary declaration interpretation permits local filling of these missing derived fields, before checking beats. Cards, wildAs and intended meaning are never repaired or replaced with stronger actions.':'Use comboDeclarationGuide and per-kind responseSchema constants as the actual engine declaration contract. Never use 0 to fill an unknown mainRank/length/keyRank. Preserve one intended legal interpretation; no answer repair or strongest-action substitution will be performed.']:[]),
 ]};
 return freezeCopy(payload);
}
export type DesignedSourceRequest=ReturnType<typeof prepareDesignedSourceRequest>;
export function freezeDesignedSourceRequest(input:DesignedSourceRequest){
 need(input?.schema===DESIGNED_REQUEST_SCHEMA,'invalid_designer_request');
 const expected=prepareDesignedSourceRequest({questionId:input.questionId,designFamilyId:input.designFamilyId,engineSourceRef:input.engineSourceRef,rulesRef:input.rulesRef,ruleOptions:input.ruleOptions,coverage:input.coverage,...(Object.hasOwn(input,'firstGameOrigin')?{firstGameOrigin:input.firstGameOrigin}: {}),...(Object.hasOwn(input,'comboDeclarationContract')?{comboDeclarationContract:input.comboDeclarationContract}: {})});
 need(equal(input,expected),'invalid_designer_request');return expected;
}
export function parseDesignedSourceResponse(text:string,request:DesignedSourceRequest):DesignedFirstGameSource {
 let source:DesignedFirstGameSource;
 try{source=parseDesignedFirstGameSource(text);}catch{throw new SelectionWireError('invalid_designer_response');}
 need(source.schema===request.responseSchema.properties.schema.const,'invalid_designer_response');
 need(source.questionId===request.questionId&&source.designFamilyId===request.designFamilyId&&source.engineSourceRef===request.engineSourceRef&&source.rulesRef===request.rulesRef&&equal(source.rules,request.ruleOptions)&&source.split==='train','designer_response_identity');
 if(request.firstGameOrigin)need(source.origin.leaderSeed===request.firstGameOrigin.leaderSeed,'designer_origin_identity');
 return source;
}
/** Profile is resolved/frozen by the same original transport, not from env. */
export function createProfileDesigner(options:{store:any;reference:any;fetchImpl?:typeof fetch}){
 return createProfileTextTransport(options,{
  maxResponseBytes:DESIGNED_RESPONSE_MAX_BYTES,retainPrivateResponse:true,retainPrivateTransportDiagnostic:true,
  prepare(input:DesignedSourceRequest,profile:any){const view=freezeDesignedSourceRequest(input);return {view,body:serializeProjectRulesChat(profile,{role:'designer',modelPayloadBytes:JSON.stringify(view)})};},
  parse(content:string,view:DesignedSourceRequest){return parseDesignedSourceResponse(content,view);},
 });
}
export interface DesignedRemoteResult {
 privateTransportDiagnostic?:{phase:'fetch_invoke'|'fetch_await';errorClass:string;errorCode:string;causeCodes:string[]};
 status:'response'|'remote_failure'|'cancelled'|'unknown';response?:DesignedFirstGameSource;reason?:string;privateResponseText?:string;summary:{requestCount:0|1|null;[key:string]:unknown};
}
export type DesignedRemoteRequest=(input:DesignedSourceRequest,signal:AbortSignal)=>Promise<DesignedRemoteResult>;
export interface DesignedRequestCheckpoint {
 schema:'ohuo-designed-source-query-v1';questionId:string;requestSHA256:string;phase:'requesting'|'terminal'|'unresolved';result:DesignedRemoteResult|null;
}
function validateCheckpoint(cp:DesignedRequestCheckpoint,input:DesignedSourceRequest){
 strictObject(cp,'designer.checkpoint',['schema','questionId','requestSHA256','phase','result']);
 need(cp.schema==='ohuo-designed-source-query-v1'&&cp.questionId===input.questionId&&cp.requestSHA256===digest(input)&&['requesting','terminal','unresolved'].includes(cp.phase),'designer_checkpoint_identity');
 if(cp.phase==='requesting'){need(cp.result===null,'designer_checkpoint_result');return;}
 const result=cp.result;need(result&&['response','remote_failure','cancelled','unknown'].includes(result.status)&&result.summary&&[0,1,null].includes(result.summary.requestCount),'designer_checkpoint_result');
 need(cp.phase==='unresolved'?(result!.summary.requestCount===null):(result!.summary.requestCount!==null&&result!.status!=='unknown'),'designer_checkpoint_result');
 if(result!.status==='response')need(result!.summary.requestCount===1&&typeof result!.privateResponseText==='string'&&equal(parseDesignedSourceResponse(result!.privateResponseText!,input),result!.response),'designer_checkpoint_response');
 else need(result!.response===undefined,'designer_checkpoint_result');
}
/** Private original-controller checkpoint seam, not a runner or authorization.
 * onCheckpoint must atomically persist in the owned private checkpoint (0600).
 * A previous possibly-sent request is never silently retried or refunded. H
 * reconciles unresolved consumption/ownership; this function grants no cleanup.
 * Known zero-send terminals remain explicit and may be retried only by an
 * owner-authorized subsequent attempt, not automatically here. */
export async function queryDesignedSource({request,input,signal,checkpoint=null,onCheckpoint}:{request:DesignedRemoteRequest;input:DesignedSourceRequest;signal:AbortSignal;checkpoint?:DesignedRequestCheckpoint|null;onCheckpoint:(value:DesignedRequestCheckpoint)=>Promise<void>}){
 const fixed=freezeDesignedSourceRequest(input);need(typeof request==='function'&&typeof onCheckpoint==='function'&&signal&&typeof signal.addEventListener==='function','designer_owned_request');
 if(checkpoint){validateCheckpoint(checkpoint,fixed);return {status:checkpoint.phase==='terminal'?checkpoint.result!.status:'execution_uncertain',checkpoint:structuredClone(checkpoint),reused:true,sourceAccepted:false as const};}
 let cp:DesignedRequestCheckpoint={schema:'ohuo-designed-source-query-v1',questionId:fixed.questionId,requestSHA256:digest(fixed),phase:'requesting',result:null};
 try{await onCheckpoint(structuredClone(cp));}catch(error){throw Object.assign(error instanceof Error?error:Error('designer_checkpoint_write_failed'),{requestCount:0,executionUnknown:false});}
 let result:DesignedRemoteResult;
 try{result=await request(fixed,signal);need(result&&['response','remote_failure','cancelled'].includes(result.status)&&result.summary&&[0,1,null].includes(result.summary.requestCount),'designer_request_result');}
 catch{result={status:'unknown',reason:'execution_uncertain',summary:{requestCount:null}};}
 if(result.status==='response'){
  try{need(result.summary.requestCount===1&&typeof result.privateResponseText==='string'&&equal(parseDesignedSourceResponse(result.privateResponseText!,fixed),result.response),'designer_response_identity');}
  catch{const {response,...rest}=result;result={...rest,status:'remote_failure',reason:'invalid_designer_response'};}
 }
 cp={...cp,phase:result.summary.requestCount===null?'unresolved':'terminal',result:structuredClone(result)};
 // A failed terminal write leaves the earlier requesting checkpoint intact.
 // Throw with actual consumption; never turn that persistence loss into resend.
 try{await onCheckpoint(structuredClone(cp));}catch(error){throw Object.assign(error instanceof Error?error:Error('designer_checkpoint_write_failed'),{requestCount:result.summary.requestCount,executionUnknown:true});}
 return {status:cp.phase==='unresolved'?'execution_uncertain':result.status,checkpoint:cp,reused:false,sourceAccepted:false as const};
}
