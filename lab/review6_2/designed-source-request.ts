/** §44.4 designer request over the original profile/SSE transport.
 * No provider start at import/prepare. The H owner supplies its original metered
 * request and private checkpoint writer inside an admitted run. This module
 * neither authorizes that run nor admits a response as a teaching source. */
import {isDeepStrictEqual as equal} from 'node:util';
import {buildDeck,type RuleOptions} from '@gd/engine';
import {freezeCopy} from '../../packages/ai/src/hybrid/protocol';
import {createProfileTextTransport} from '../../packages/web/server/llm-select.mjs';
import {SelectionWireError} from '../../packages/web/server/llm-selection-wire.mjs';
import {PROJECT_RULES_DESIGN_PROMPT_ID,PROJECT_RULES_DESIGN_SYSTEM_SHA256,assertProjectRuleOptions,serializeProjectRulesChat} from '../../packages/web/server/llm-project-rules-v541.mjs';
import {DESIGNED_FIRST_GAME_SCHEMA,parseDesignedFirstGameSource,type DesignedFirstGameSource} from './designed-source';
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
}
const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const arr=(items:unknown,minItems:number,maxItems:number)=>({type:'array',minItems,maxItems,items});
const int=(minimum:number,maximum:number)=>({type:'integer',minimum,maximum});
function responseSchema(spec:DesignedRequestSpec){
 const card=obj({id:int(0,107),suit:{enum:['S','H','D','C','J']},rank:{enum:[2,3,4,5,6,7,8,9,10,11,12,13,14,16,17]}});
 const wild={...obj({cardId:int(0,107),asRank:int(2,14)}),properties:{cardId:int(0,107),asRank:int(2,14),asSuit:{enum:['S','H','D','C']}}};
 const combo={...obj({kind:{enum:kinds},cards:arr(card,1,27),size:int(1,27),keyRank:int(0,108),length:int(0,108),pairRanks:arr(int(2,17),0,13),mainRank:int(0,108),wildAs:arr(wild,0,2)}),properties:{kind:{enum:kinds},cards:arr(card,1,27),size:int(1,27),keyRank:int(0,108),length:int(0,108),pairRanks:arr(int(2,17),0,13),mainRank:int(0,108),wildAs:arr(wild,0,2),suit:{enum:['S','H','D','C','J']}}};
 const move={oneOf:[obj({pass:{const:true}}),obj({pass:{const:false},combo})]};
 return obj({schema:{const:DESIGNED_FIRST_GAME_SCHEMA},sourceKind:{const:'designed-synthetic'},questionId:{const:spec.questionId},designFamilyId:{const:spec.designFamilyId},split:{const:'train'},engineSourceRef:{const:spec.engineSourceRef},rulesRef:{const:spec.rulesRef},rules:{const:spec.ruleOptions},origin:obj({kind:{const:'first-game'},leaderSeed:int(0,0xffffffff)}),initialIds:arr(arr(int(0,107),27,27),4,4),moves:arr(obj({gameNo:{const:1},actorSeat:int(0,3),move}),0,2500),target:obj({gameNo:{const:1},moveNo:int(0,2500),actorSeat:int(0,3),remainingCards:arr(int(0,27),4,4)})});
}
export function prepareDesignedSourceRequest(spec:DesignedRequestSpec){
 strictObject(spec,'designer.spec',['questionId','designFamilyId','engineSourceRef','rulesRef','ruleOptions','coverage']);
 validateIdentifier(spec.questionId,'designer.questionId');validateIdentifier(spec.designFamilyId,'designer.designFamilyId');fixedReference(spec.engineSourceRef,'designer.engineSourceRef');fixedReference(spec.rulesRef,'designer.rulesRef');
 assertProjectRuleOptions(spec.ruleOptions);need(spec.rulesRef.split(':').at(-1)===digest(spec.ruleOptions),'designer_rules_identity');
 strictObject(spec.coverage,'designer.publicCoverage',coverageKeys);
 need(kinds.includes(spec.coverage.targetKind)&&['<','=','>'].includes(spec.coverage.opponentSizeRelation)&&coverageKeys.slice(2).every(k=>typeof (spec.coverage as any)[k]==='boolean'),'designer_public_coverage');
 const payload={schema:DESIGNED_REQUEST_SCHEMA,promptId:PROJECT_RULES_DESIGN_PROMPT_ID,systemPromptSHA256:PROJECT_RULES_DESIGN_SYSTEM_SHA256,...structuredClone(spec),split:'train' as const,targetDefinition:FIRST_ROUND_TARGET_DEFINITION,physicalDeck:buildDeck(),responseSchema:responseSchema(spec),requirements:[
  'Return only one JSON object matching responseSchema. No markdown, commentary, label, preferred action, score, outcome, candidate list or claim of a natural sampled match.',
  'Construct a complete explicit first-game deal using physicalDeck: every physical ID 0..107 occurs once across four hands of 27. leaderSeed selects only the first leader; it is not a natural deal seed.',
  'The first game starts at level 2 with no tribute. Supply a legal causal move prefix; target.moveNo equals moves.length. Preserve exact card IDs, faces and necessary wildcard declarations.',
  'At target the actor is to move, its partner is currently highest, both teams retain active players, and legal PASS and takeover must exist. Target remainingCards must equal original-engine replay.',
  'coverage describes only an approved public train-coverage gap, not an answer or desired outcome. Do not use dev/holdout examples or prior teacher answers. Original B-prime/423 capture decides the actual available C locally.',
 ]};
 return freezeCopy(payload);
}
export type DesignedSourceRequest=ReturnType<typeof prepareDesignedSourceRequest>;
export function freezeDesignedSourceRequest(input:DesignedSourceRequest){
 need(input?.schema===DESIGNED_REQUEST_SCHEMA,'invalid_designer_request');
 const expected=prepareDesignedSourceRequest({questionId:input.questionId,designFamilyId:input.designFamilyId,engineSourceRef:input.engineSourceRef,rulesRef:input.rulesRef,ruleOptions:input.ruleOptions,coverage:input.coverage});
 need(equal(input,expected),'invalid_designer_request');return expected;
}
export function parseDesignedSourceResponse(text:string,request:DesignedSourceRequest):DesignedFirstGameSource {
 let source:DesignedFirstGameSource;
 try{source=parseDesignedFirstGameSource(text);}catch{throw new SelectionWireError('invalid_designer_response');}
 need(source.questionId===request.questionId&&source.designFamilyId===request.designFamilyId&&source.engineSourceRef===request.engineSourceRef&&source.rulesRef===request.rulesRef&&equal(source.rules,request.ruleOptions)&&source.split==='train','designer_response_identity');
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
