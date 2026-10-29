import{createHash}from'node:crypto';
import{isDeepStrictEqual}from'node:util';
import{buildDeck,makeLevelCtx,isWild,rankOrder,RNG,DEFAULT_RULES,teamOf,sortHand,applyTribute,completeReturn,type Card,type GameState}from'@gd/engine';
import{PublicTracker,encodeStateV2,deriveSeed}from'@gd/ai';
import{assertRootHistory,type PublicStep}from'./match-play';
import{cleanSourceState,publicHistory,publicMatch,publicState,assertStrictVisibleNested}from'./visible-schema';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type PublicMatch=Pick<GameState['match'],'opts'|'levels'|'gameNo'|'lastHead'|'lastResult'>;
type PublicState=Pick<GameState,'levelsBefore'|'stageTeam'|'turn'|'leader'|'lastCombo'|'lastPlayer'|'passCount'|'finished'|'moveNo'|'tribute'|'trickPlays'>;
export interface VisibleRoot{schemaVersion:'r6-visible-root-v1';actor:number;ownCards:Card[];counts:number[];matchPublic:PublicMatch;statePublic:PublicState;history:PublicStep[];modelState331:number[];representationGaps:string[];observationSHA256:string;}
function tracker(history:PublicStep[]){const result=new PublicTracker();for(const row of history)result.observe(row.events);return result;}
function playedBy(history:PublicStep[]){const result=new Map<number,number>();for(const row of history)for(const event of row.events)if(event.type==='play')for(const card of event.combo.cards){if(result.has(card.id))throw new Error('public history repeats a physical play');result.set(card.id,event.player);}return result;}
function transferOwners(state:PublicState){const result=new Map<number,number>();for(const t of[...(state.tribute?.tributes??[]),...(state.tribute?.returns??[])])result.set(t.card.id,t.to);return result;}
function exchangeRepresentationGaps(actor:number,own:Card[],counts:number[],match:PublicMatch,state:PublicState,history:PublicStep[]){
 if(!state.tribute)return[];
 const played=playedBy(history),owned=new Set(own.map(c=>c.id)),pool=buildDeck().filter(c=>!owned.has(c.id)&&!played.has(c.id)),others=counts.map((n,s)=>({n,s})).filter(r=>r.s!==actor&&r.n>0),gaps=new Set<string>(),ctx=makeLevelCtx(state.levelsBefore,match.opts.levelMode as any,state.stageTeam);
 const known=transferOwners(state),logicalForeignTypes=new Set(pool.map(c=>c.suit+':'+c.rank));
 for(const[id,owner]of known)if(!played.has(id)&&owner!==actor&&logicalForeignTypes.size>1&&!(others.length===1&&others[0].s===owner))gaps.add('known_transfer_owner_not_encoded_in_schema_v4');
 // Native maximum selection also conditions on the first rank tie in the
 // sorted deal: earlier suits exclude a donor allocation, and an identical
 // physical copy changes the public-gift likelihood through its private tie.
 for(const gift of state.tribute.tributes)if(gift.from!==actor&&counts[gift.from]>0&&others.length>1&&pool.some(c=>!isWild(c,ctx)&&(rankOrder(c.rank,ctx)>rankOrder(gift.card.rank,ctx)||rankOrder(c.rank,ctx)===rankOrder(gift.card.rank,ctx)&&c.suit.localeCompare(gift.card.suit)<=0)))gaps.add('public_tribute_maximum_constraint_not_encoded_in_schema_v4');
 const order=match.lastResult!.finishOrder,givers=teamOf(order[2])===teamOf(order[3])?[order[2],order[3]]:[order[3]],flows=[...state.tribute.tributes,...state.tribute.returns];
 let knownGiverBig=0,unknownBig=0;
 for(const card of buildDeck().filter(c=>c.rank===17)){const flow=flows.find(t=>t.card.id===card.id),owner=flow?.from??played.get(card.id)??(owned.has(card.id)?actor:undefined);if(owner===undefined)unknownBig++;else if(givers.includes(owner))knownGiverBig++;}
 const freeSlots=(seat:number)=>counts[seat]-[...known].filter(([id,owner])=>owner===seat&&!played.has(id)).length;
 const giverCapacity=others.filter(r=>givers.includes(r.s)).reduce((n,r)=>n+freeSlots(r.s),0),nonGiverCapacity=others.filter(r=>!givers.includes(r.s)).reduce((n,r)=>n+freeSlots(r.s),0);
 if(knownGiverBig+Math.max(0,unknownBig-nonGiverCapacity)<2&&knownGiverBig+Math.min(unknownBig,giverCapacity)>=2)gaps.add('public_resistance_giver_constraint_not_fully_encoded_in_schema_v4');
 return[...gaps].sort();
}
/** Extract only current own/public information; the source hidden layout,
 * original RNG, recorded next action and later outcome are never serialized. */
export function toVisibleRoot(state:GameState,history:PublicStep[]):VisibleRoot{
 state=cleanSourceState(state);history=publicHistory(history);
 if(!isDeepStrictEqual(state.match.opts,DEFAULT_RULES))throw new Error('visible teacher requires frozen DEFAULT_RULES; alternate rules are not fully encoded');
 assertRootHistory(state,history);const actor=state.turn,ownCards=structuredClone(state.hands[actor]),counts=state.hands.map(h=>h.length),m=state.match;
 const matchPublic:PublicMatch=publicMatch(m),statePublic:PublicState=publicState(state);
 const encoded=new Float32Array(331);encodeStateV2(state,actor,tracker(history),encoded,'rule-context');if(!encoded.every(Number.isFinite))throw new Error('visible root encoding nonfinite');
 const content={schemaVersion:'r6-visible-root-v1' as const,actor,ownCards,counts,matchPublic,statePublic,history:structuredClone(history),modelState331:Array.from(encoded),representationGaps:exchangeRepresentationGaps(actor,ownCards,counts,matchPublic,statePublic,history)};
 return{...content,observationSHA256:digest(content)};
}
const visibleKeys=['schemaVersion','actor','ownCards','counts','matchPublic','statePublic','history','modelState331','representationGaps','observationSHA256'].sort();
function checkVisible(obs:VisibleRoot){
 if(JSON.stringify(Object.keys(obs).sort())!==JSON.stringify(visibleKeys)||obs.schemaVersion!=='r6-visible-root-v1')throw new Error('unexpected non-visible root field');
 assertStrictVisibleNested(obs);
 if(!isDeepStrictEqual(obs.matchPublic.opts,DEFAULT_RULES))throw new Error('visible teacher requires frozen DEFAULT_RULES');
 const{observationSHA256,...content}=obs;if(digest(content)!==observationSHA256)throw new Error('visible observation hash mismatch');
 if(!Number.isInteger(obs.actor)||obs.actor<0||obs.actor>3||obs.statePublic.turn!==obs.actor||obs.counts.length!==4||obs.counts.some(n=>!Number.isInteger(n)||n<0||n>27)||obs.ownCards.length!==obs.counts[obs.actor])throw new Error('visible observation actor/count mismatch');
 if(Object.keys(obs.matchPublic).some(key=>!['opts','levels','gameNo','lastHead','lastResult'].includes(key))||Object.keys(obs.statePublic).some(key=>!['levelsBefore','stageTeam','turn','leader','lastCombo','lastPlayer','passCount','finished','moveNo','tribute','trickPlays'].includes(key)))throw new Error('hidden/future field in visible state');
}
function shuffle<T>(items:T[],rng:RNG){for(let i=items.length-1;i>0;i--){const j=rng.int(i+1);[items[i],items[j]]=[items[j],items[i]];}return items;}
/** Ownership is random; engine hand representation is not. Reconstruct a
 * sorted initial deal, execute recorded public exchanges (including append
 * order), then remove the observed plays. Native rank/suit ordering is fixed;
 * identical-copy ties are sampled as in a uniformly shuffled initial deal.
 * Only the actor's already observed order/gift is conditioned directly. */
function restoreEngineHandOrder(state:GameState,history:PublicStep[],rng:RNG,actor:number){
 const recorded=state.tribute,flows=recorded?[...recorded.tributes,...recorded.returns]:[],initial=state.hands.map(h=>[...h]),played=new Set<number>();
 for(const row of history)for(const e of row.events)if(e.type==='play')for(const card of e.combo.cards){initial[e.player].push(card);played.add(card.id);}
 for(const t of [...flows].reverse()){const index=initial[t.to].findIndex(c=>c.id===t.card.id);if(index<0)throw new Error('ordered public exchange ownership mismatch');initial[t.from].push(initial[t.to].splice(index,1)[0]);}
 initial.forEach(sortHand);
 for(let seat=0;seat<4;seat++){const hand=initial[seat];for(let first=0;first<hand.length;){let end=first+1;while(end<hand.length&&hand[end].rank===hand[first].rank&&hand[end].suit===hand[first].suit)end++;const group=shuffle(hand.slice(first,end),rng);if(seat===actor&&group.every(c=>state.hands[actor].some(a=>a.id===c.id)))group.sort((a,b)=>state.hands[actor].findIndex(c=>c.id===a.id)-state.hands[actor].findIndex(c=>c.id===b.id));hand.splice(first,end-first,...group);first=end;}}
 for(const t of recorded?.tributes??[])if(t.from===actor){const hand=initial[t.from],index=hand.findIndex(c=>c.id===t.card.id),first=hand.findIndex(c=>c.rank===t.card.rank&&c.suit===t.card.suit);if(index<0||first<0)throw new Error('ordered own tribute card absent');hand.splice(first,0,hand.splice(index,1)[0]);}
 const witness=structuredClone(state);witness.hands=initial;witness.tribute=null;witness.pendingReturns=[];
 const actual=applyTribute(witness,[0,1,2,3]);
 if(actual===null){if(recorded!==null)throw new Error('unexpected ordered first-round exchange');}
 else{if(!recorded||actual.resist!==recorded.resist||actual.leader!==recorded.leader||!isDeepStrictEqual(actual.tributes,recorded.tributes))throw new Error('recorded tribute incompatible with canonical engine hand order');witness.tribute=actual;witness.turn=witness.pendingReturns[0]?.from??actual.leader;for(const t of recorded.returns){const pending=witness.pendingReturns[0],card=witness.hands[t.from].find(c=>c.id===t.card.id);if(!pending||pending.from!==t.from||pending.to!==t.to||!card)throw new Error('ordered return mismatch');completeReturn(witness,card);}if(witness.pendingReturns.length||!isDeepStrictEqual(actual.returns,recorded.returns))throw new Error('ordered exchange incomplete');}
 state.hands=witness.hands.map(h=>h.filter(c=>!played.has(c.id)));
}
/** Uniform hidden card allocations conditional on own/public cards and fixed
 * known owners, with rejection for frozen-rule legal public history/exchange
 * and the actual engine hand ordering seen by frozen policies.
 * A pass never imposes an inability-to-beat restriction. */
export function sampleVisibleWorld(obs:VisibleRoot,seed:number,maxAttempts=4096){
 checkVisible(obs);if(!Number.isSafeInteger(seed)||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>4096)throw new Error('bounded visible-world seed/attempt count required (1..4096)');
 const deck=buildDeck(),byId=new Map(deck.map(c=>[c.id,c])),played=playedBy(obs.history),own=new Set(obs.ownCards.map(c=>c.id)),known=transferOwners(obs.statePublic),fixed:Card[][]=Array.from({length:4},()=>[]);fixed[obs.actor]=structuredClone(obs.ownCards);
 for(const[id,owner]of known){if(played.has(id))continue;if(owner===obs.actor){if(!own.has(id))throw new Error('known own transfer missing');continue;}if(own.has(id))throw new Error('known public owner conflicts with own hand');const card=byId.get(id);if(!card)throw new Error('unknown public transfer card');fixed[owner].push(card);}
 const fixedIds=new Set(fixed.flat().map(c=>c.id)),pool=deck.filter(c=>!fixedIds.has(c.id)&&!played.has(c.id));if(fixed.some((h,s)=>h.length>obs.counts[s])||pool.length!==obs.counts.reduce((n,c)=>n+c,0)-fixedIds.size)throw new Error('visible-world resource denominator mismatch');
 let lastReason='no_world_attempted';
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const rng=new RNG(deriveSeed('review6-visible-world-rejection-v1',seed,attempt,obs.observationSHA256)),available=shuffle([...pool],rng),hands=fixed.map(h=>[...h]);let offset=0;
  for(let seat=0;seat<4;seat++)if(seat!==obs.actor){const needed=obs.counts[seat]-hands[seat].length;hands[seat].push(...available.slice(offset,offset+needed));offset+=needed;}
  const s=obs.statePublic,state:GameState={...structuredClone(s),match:{...structuredClone(obs.matchPublic),winner:null,rngState:0},ctx:makeLevelCtx(s.levelsBefore,obs.matchPublic.opts.levelMode as any,s.stageTeam),hands,over:false,result:null,pendingReturns:[]};
  try{restoreEngineHandOrder(state,obs.history,rng,obs.actor);assertRootHistory(state,obs.history);const repeated=toVisibleRoot(state,obs.history);if(repeated.observationSHA256!==obs.observationSHA256)throw new Error('sampled world changed own/public observation or encoding');return{state,attempts:attempt+1,seed,observationSHA256:obs.observationSHA256,hiddenLayoutSHA256:digest(state.hands.filter((_,seat)=>seat!==obs.actor))};}
  catch(error){lastReason=(error as Error).message;}
 }
 throw new Error('bounded legal-world sampler exhausted without substituting true hidden cards: '+lastReason);
}
