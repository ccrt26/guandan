import {describe, expect, it} from 'vitest';
import {applyMove,buildDeck,classify,createMatch,DEFAULT_RULES,startGame,type Card} from '@gd/engine';
import * as sourceReader from '../review6_2/designed-source';
import {resolveLegalMove,necessaryDeclarationKey} from '../../packages/ai/src/hybrid/legality';
import {digest, referenceOf} from '../review6_2/task-schema.mjs';
import {prepareDesignedSourceRequest, freezeDesignedSourceRequest, parseDesignedSourceResponse} from '../review6_2/designed-source-request';

const spec = {questionId: 'fixture-designed-one', designFamilyId: 'fixture-designed-family', engineSourceRef: referenceOf('fixture-source', {baseCommit: 'a'.repeat(40), files: []}), rulesRef: referenceOf('fixture-rules', DEFAULT_RULES), ruleOptions: structuredClone(DEFAULT_RULES), coverage: {targetKind: 'single', opponentSizeRelation: '>' as const, hasOrdinaryTakeover: true, partnerZero: false, hasNaturalNonJokerOption: true, ownHasFewerCardsThanPartner: false}};
const firstGameOrigin = {leaderSeed: 1, firstLeader: 2, previousPublicPrefixFailure: {gameNo: 1, moveNo: 0, expectedActorSeat: 1, declaredActorSeat: 0}};
const next = () => prepareDesignedSourceRequest({...spec, firstGameOrigin} as any);

describe('explicit designed first-game origin', () => {
  it('keeps the complete old request and default schema byte identity', () => {
    const old = prepareDesignedSourceRequest(spec);
    expect(digest(old)).toBe('ff9c3f3e9d2a0c0ac9f19cd4b2a0bb4dd22fd0e2cfe5547f43ccd5240e112fab');
    expect(freezeDesignedSourceRequest(old)).toEqual(old);
    expect(old.responseSchema.properties.origin.properties.leaderSeed).toEqual({type: 'integer', minimum: 0, maximum: 0xffffffff});
  });

  it('binds the engine-derived first leader, seed and public prior failure in new inputs only', () => {
    const ids = Array.from({length: 4}, (_,i) => buildDeck().slice(i * 27, (i + 1) * 27).map(c => c.id));
    const state = startGame(createMatch(structuredClone(DEFAULT_RULES), firstGameOrigin.leaderSeed), [], ids);
    const request = next();
    expect((request as any).firstGameOrigin.firstLeader).toBe(state.turn);
    expect((request as any).firstGameOrigin.previousPublicPrefixFailure).toEqual(firstGameOrigin.previousPublicPrefixFailure);
    expect(request.responseSchema.properties.origin.properties.leaderSeed).toEqual({const: 1});
    expect(request.requirements.join('\n')).toContain('first actorSeat=2');
    expect(freezeDesignedSourceRequest(request)).toEqual(request);
    expect(() => prepareDesignedSourceRequest({...spec, firstGameOrigin: {...firstGameOrigin, firstLeader: 0}} as any)).toThrow('designer_first_leader_identity');
    expect(() => prepareDesignedSourceRequest({...spec, firstGameOrigin: {...firstGameOrigin, hiddenHands: []}} as any)).toThrow();
    expect(() => freezeDesignedSourceRequest({...request, firstGameOrigin: {...firstGameOrigin, firstLeader: 0}} as any)).toThrow();
  });

  it('enforces the fixed seed as response identity without relaxing source admission', () => {
    const initialIds = Array.from({length: 4}, (_,i) => buildDeck().slice(i * 27, (i + 1) * 27).map(c => c.id));
    const source = {schema: 'ohuo-designed-first-game-source-v1', sourceKind: 'designed-synthetic', questionId: spec.questionId, designFamilyId: spec.designFamilyId, split: 'train', engineSourceRef: spec.engineSourceRef, rulesRef: spec.rulesRef, rules: spec.ruleOptions, origin: {kind: 'first-game', leaderSeed: 1}, initialIds, moves: [], target: {gameNo: 1, moveNo: 0, actorSeat: 2, remainingCards: [27,27,27,27]}};
    expect(parseDesignedSourceResponse(JSON.stringify(source), next())).toEqual(source);
    expect(() => parseDesignedSourceResponse(JSON.stringify({...source, origin: {...source.origin, leaderSeed: 2}}), next())).toThrow('designer_origin_identity');
    // Legacy requests never acquire a new origin constraint retroactively.
    expect(parseDesignedSourceResponse(JSON.stringify({...source, origin: {...source.origin, leaderSeed: 2}}), prepareDesignedSourceRequest(spec)).origin.leaderSeed).toBe(2);
  });
});

const jsonCopy=<T>(x:T):T=>JSON.parse(JSON.stringify(x));
function engineFixture(faces:Array<[string,number]>,level=2,other:Record<number,Array<[string,number]>>={}){
 const deck=buildDeck(),used=new Set<number>(),hands:Card[][]=[[],[],[],[]];
 for(const [seat,required]of Object.entries({...other,2:faces}))for(const[suit,rank]of required){const c=deck.find(x=>!used.has(x.id)&&x.suit===suit&&x.rank===rank)!;used.add(c.id);hands[Number(seat)].push(c);}
 for(const hand of hands)for(const c of deck){if(hand.length===27)break;if(!used.has(c.id)){used.add(c.id);hand.push(c);}}
 const match=createMatch(structuredClone(DEFAULT_RULES),1);match.levels=[level,level];return startGame(match,[],hands.map(h=>h.map(c=>c.id)));
}
function partialMove(combo:any){const c=jsonCopy(combo);for(const key of ['size','length','keyRank'])delete c[key];if(['single','joker_bomb'].includes(c.kind))delete c.mainRank;if(c.kind!=='trio_pair')delete c.pairRanks;return{pass:false,combo:c};}
const resolveV2=(state:any,move:any)=>(sourceReader as any).resolveDesignedSourceMoveV2(state,move);
describe('explicit v2 unique derived declaration fields',()=>{
 it('uses a new named request/source branch without changing consumed v1 bytes',()=>{
  const request=prepareDesignedSourceRequest({...spec,firstGameOrigin,comboDeclarationContract:'engine-combo-fields-v2'} as any);
  expect(request.responseSchema.properties.schema.const).toBe('ohuo-designed-first-game-source-v2');
  const combo=request.responseSchema.properties.moves.items.properties.move.oneOf[1].properties.combo;
  expect(combo.required).toEqual(['kind','cards','wildAs']);expect(freezeDesignedSourceRequest(jsonCopy(request))).toEqual(request);expect(digest(request)).toMatch(/^[0-9a-f]{64}$/);
  const consumed=prepareDesignedSourceRequest({...spec,questionId:'v542-designed-straight-wild-not-shorter-fields-1',designFamilyId:'v542-designed-straight-wild-not-shorter-fields-1',engineSourceRef:'v542-designed-straight-wild-not-shorter-fields-1-runtime-source@sha256:aaf7502f9a0f5098a6e7f3df6d8fd7a268b80b69157cea691eea61f0eb50c66e',rulesRef:'v530-original-rules@sha256:948ce419c65fe7f29586503f79c4aa40cffdfecd75d358df9a524f90722c7b64',coverage:{...spec.coverage,targetKind:'straight',hasNaturalNonJokerOption:false},firstGameOrigin,comboDeclarationContract:'engine-combo-fields-v1'} as any);
  expect(digest(consumed)).toBe('52e61360208a967cb30ab28c20316d269e5af40eb31561f90676d1c2ee6828aa');
 });
 const cases:Array<[string,Array<[string,number]>,number?]>=[
  ['single',[['S',3]]],['pair',[['S',3],['H',3]]],['trio',[['S',3],['H',3],['D',3]]],['trio_pair',[['S',3],['H',3],['D',3],['S',4],['H',4]]],
  ['straight',[['S',3],['D',4],['H',5],['C',6],['S',7]]],['pair_seq',[['S',3],['H',3],['S',4],['H',4],['S',5],['H',5]]],
  ['trio_seq',[['S',3],['H',3],['D',3],['S',4],['H',4],['D',4]]],['bomb',[['S',3],['H',3],['D',3],['C',3]]],
  ['flush',[['S',3],['S',4],['S',5],['S',6],['S',7]]],['joker_bomb',[['J',16],['J',16],['J',17],['J',17]]],['straight',[['S',14],['D',2],['H',3],['C',4],['S',5]],9],
 ];
 for(const[kind,faces,level]of cases)it('fills only unique '+kind+' fields at level '+(level??2),()=>{
  const s=engineFixture(faces,level),cards=faces.map(([suit,rank],i)=>s.hands[2].filter(c=>c.suit===suit&&c.rank===rank)[faces.slice(0,i).filter(x=>x[0]===suit&&x[1]===rank).length]),full=jsonCopy(classify(cards,s.ctx,s.match.opts).find(c=>c.kind===kind)!);expect(full).toBeTruthy();
  const partial=partialMove(full),before=JSON.stringify(partial),actual=resolveV2(s,partial);expect(necessaryDeclarationKey(actual.combo,s.ctx)).toBe(necessaryDeclarationKey(full,s.ctx));expect(JSON.stringify(partial)).toBe(before);expect(JSON.stringify(actual)).not.toContain('undefined');
  const a=structuredClone(s),b=structuredClone(s);applyMove(a,resolveLegalMove(a,{pass:false,combo:full}) as any);applyMove(b,actual);expect(b).toEqual(a);
 });
 it('rejects supplied errors, nulls, unknowns, missing required semantics and physical/wild conflicts',()=>{
  const s=engineFixture([['S',3],['H',3]]),full=jsonCopy(classify(s.hands[2].filter(c=>c.rank===3).slice(0,2),s.ctx,s.match.opts).find(c=>c.kind==='pair')!);
  for(const[field,value]of [['size',3],['size',null],['length',null],['keyRank',null],['mainRank',null],['pairRanks',null],['unknown',0]] as any[]){const m=partialMove(full);m.combo[field]=value;expect(()=>resolveV2(s,m)).toThrow();}
  for(const field of ['kind','cards','wildAs','mainRank']){const m=partialMove(full);delete m.combo[field];expect(()=>resolveV2(s,m)).toThrow();}
  const bad=partialMove(full);bad.combo.wildAs=[{cardId:full.cards[0].id,asRank:4}];expect(()=>resolveV2(s,bad)).toThrow();
  const wrongFace=partialMove(full);wrongFace.combo.cards[0].rank=4;expect(()=>resolveV2(s,wrongFace)).toThrow();
  const zero=partialMove(full);zero.combo.cards[1]=jsonCopy(s.hands[2].find(c=>c.rank===4)!);expect(()=>resolveV2(s,zero)).toThrow();
  expect(()=>resolveV2(s,{pass:true})).toThrow('illegal pass');const ended=structuredClone(s);ended.over=true;expect(()=>resolveV2(ended,partialMove(full))).toThrow();
 });
 it('keeps trio_pair pairRanks and flush suit mandatory, and legacy requests reject v2 responses',()=>{
  for(const[kind,faces]of cases.filter(([k])=>['trio_pair','flush'].includes(k))){const s=engineFixture(faces),cards=faces.map(([suit,rank])=>s.hands[2].find(c=>c.suit===suit&&c.rank===rank)!),m=partialMove(classify(cards,s.ctx,s.match.opts).find(c=>c.kind===kind)!);delete m.combo[kind==='flush'?'suit':'pairRanks'];expect(()=>resolveV2(s,m)).toThrow();}
  const ids=Array.from({length:4},(_,i)=>buildDeck().slice(i*27,(i+1)*27).map(c=>c.id)),source={schema:'ohuo-designed-first-game-source-v2',sourceKind:'designed-synthetic',questionId:spec.questionId,designFamilyId:spec.designFamilyId,split:'train',engineSourceRef:spec.engineSourceRef,rulesRef:spec.rulesRef,rules:spec.ruleOptions,origin:{kind:'first-game',leaderSeed:1},initialIds:ids,moves:[],target:{gameNo:1,moveNo:0,actorSeat:2,remainingCards:[27,27,27,27]}};
  expect(()=>parseDesignedSourceResponse(JSON.stringify(source),next())).toThrow('invalid_designer_response');
 });
 it('never replaces a declared low wildcard pair with a stronger interpretation to beat the target',()=>{
  const s=engineFixture([['S',10],['H',10]],2,{3:[['H',2],['H',2]]}),target=classify(s.hands[2].filter(c=>c.rank===10).slice(0,2),s.ctx,s.match.opts).find(c=>c.kind==='pair')!;applyMove(s,resolveLegalMove(s,{pass:false,combo:target}) as any);expect(s.turn).toBe(3);
  const cards=s.hands[3].filter(c=>c.suit==='H'&&c.rank===2),interpretations=classify(cards,s.ctx,s.match.opts),low=interpretations.find(c=>c.kind==='pair'&&c.mainRank===5)!,high=interpretations.find(c=>c.kind==='pair'&&c.mainRank===14)!;
  expect(cards).toHaveLength(2);expect(low).toBeTruthy();expect(high).toBeTruthy();expect(()=>resolveLegalMove(s,{pass:false,combo:jsonCopy(high)})).not.toThrow();
  const declared=partialMove(low),before=JSON.stringify(declared);expect(()=>resolveV2(s,declared)).toThrow();expect(JSON.stringify(declared)).toBe(before);
 });
});
