import{readFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{isDeepStrictEqual}from'node:util';
import{createMatch,startGame,DEFAULT_RULES,applyMove,canPass,classify,beats,RNG,teamOf,buildDeck,makeLevelCtx,stageTeamOf,applyTribute,completeReturn,type Combo,type EngineEvent,type GameState,type GameResult}from'@gd/engine';
import{MLP,NeuralDecider,createAI,mulberry32,deriveSeed,type EncoderOpts,type Difficulty}from'@gd/ai';
import{resourceEffectKey}from'./data-replay';
import{fileHash}from'./product-artifacts';
import{necessaryDeclarationKey}from'./action-effect';
import{PlanRuntime}from'./plan-dsl';

export interface PolicySpec{policyId:string;kind:'neural'|'heuristic';weightsPath?:string;weightsSHA256?:string;inputDim?:number;encoder?:EncoderOpts;epsilon?:number;difficulty?:Difficulty;}
export interface PublicStep{events:EngineEvent[];priorTarget:Combo|null;}
export interface SeatDriver{policyId:string;newGame(state:GameState,history:PublicStep[]):void;observe(events:EngineEvent[],priorTarget:Combo|null):void;decide(state:GameState):{pass:boolean;combo?:Combo;feat?:Float32Array};}
export interface MatchPlayOptions{seed:number;policies:PolicySpec[];dealMode?:'legacy-engine-chain'|'indexed-deal-v1';dealNamespace?:string;rngMode?:'legacy-per-game'|'counter-per-decision';maxGames?:number;maxMovesPerGame?:number;deadlineMonotonicMs?:number;rootState?:GameState;rootHistory?:PublicStep[];actingSeat?:number;forcedRootMove?:{pass:boolean;combo?:Combo};ownPlan?:{program:unknown;rootId:string;actor:number};seatFactory?:(spec:PolicySpec,seat:number)=>SeatDriver;onBeforeDecision?:(value:{state:GameState;seat:number;history:PublicStep[]})=>void;onAfterDecision?:(value:{state:GameState;seat:number;move:{pass:boolean;combo?:Combo};events:EngineEvent[];history:PublicStep[];feat?:Float32Array;control:{source:'forced_root'|'own_plan'|'frozen_policy';planStatus:string|null}})=>void;}
export function indexedDealSeed(namespace:string,worldSeed:number,dealIndex:number){return deriveSeed(namespace,worldSeed,dealIndex,'independent-future-deal');}

export function cloneGameState(state:GameState):GameState{
 const copy=structuredClone(state);return copy;
}
export function assertRootHistory(root:GameState,history:PublicStep[]){
 if(root.over||root.result!==null||root.match.winner!==null)throw new Error('continuation root contains terminal/future winner information');
 if(root.match.lastResult?.passedA)throw new Error('previous round already ended the match; continuation root cannot reopen it');
 const expectedContext=makeLevelCtx(root.levelsBefore,root.match.opts.levelMode as any,root.stageTeam);
 if(root.stageTeam!==stageTeamOf(root.match)||!isDeepStrictEqual(root.match.levels,root.levelsBefore)||!isDeepStrictEqual(root.ctx,expectedContext))throw new Error('root public level/context mismatch');
 if(!Number.isSafeInteger(root.moveNo)||root.moveNo<0||history.length!==root.moveNo)throw new Error('complete causal root history prefix required');
 const initial=root.hands.map(hand=>[...hand]),deck=new Map(buildDeck().map(c=>[c.id,c]));
 for(const row of history){
  if(!row||!Array.isArray(row.events))throw new Error('invalid public history row');
  const actions=row.events.filter(e=>e.type==='play'||e.type==='pass');if(actions.length!==1)throw new Error('history row must contain exactly one action');
  const action=actions[0];if(!Number.isInteger(action.player)||action.player<0||action.player>3)throw new Error('history actor invalid');
  if(action.type==='play')initial[action.player].push(...action.combo.cards);
 }
 const cards=initial.flat();if(initial.some(h=>h.length!==27)||cards.length!==108||new Set(cards.map(c=>c.id)).size!==108||cards.some(c=>!isDeepStrictEqual(c,deck.get(c.id))))throw new Error('history and current physical resources do not conserve the complete deal');
 assertPublicExchange(root,initial);
 const replay=cloneGameState(root),first=history[0]?.events.find(e=>e.type==='play'||e.type==='pass') as {player:number}|undefined;
 replay.hands=initial;replay.turn=first?.player??root.turn;replay.leader=replay.turn;replay.lastPlayer=replay.turn;replay.lastCombo=null;replay.passCount=0;replay.finished=[];replay.over=false;replay.result=null;replay.moveNo=0;replay.trickPlays=[];
 if(root.tribute&&replay.turn!==root.tribute.leader)throw new Error('history initial actor differs from public tribute leader');
 const targetKey=(c:Combo|null)=>resourceEffectKey(c)+'|suit:'+(c?.suit??'');
 for(const row of history){
  if(targetKey(row.priorTarget)!==targetKey(replay.lastCombo))throw new Error('history prior target mismatch');
  const action=row.events.find(e=>e.type==='play'||e.type==='pass')!;if(action.player!==replay.turn)throw new Error('history actor turn mismatch');
  const move=resolveLegalMove(replay,action.type==='pass'?{pass:true}:{pass:false,combo:action.combo}),events=applyMove(replay,move as any);
  if(!isDeepStrictEqual(events,row.events)||replay.over)throw new Error('history event/terminal prefix mismatch');
 }
 for(const key of ['turn','leader','lastPlayer','passCount','finished','moveNo','trickPlays']as const)if(!isDeepStrictEqual(replay[key],root[key]))throw new Error('history does not reconstruct root field '+key);
 if(targetKey(replay.lastCombo)!==targetKey(root.lastCombo)||!isDeepStrictEqual(replay.hands,root.hands))throw new Error('history does not reconstruct root resources/target');
}
/** Reconstruct a legal pre-exchange ownership witness. Hand order is private:
 * put the recorded maximum tribute first among rank ties, then use the frozen
 * engine for tribute/resistance and the recorded legal return choices. */
function assertPublicExchange(root:GameState,postExchangeHands:GameState['hands']){
 const witness=cloneGameState(root);witness.hands=postExchangeHands.map(h=>[...h]);witness.pendingReturns=[];witness.tribute=null;
 const recorded=root.tribute;
 const flows=recorded?[...recorded.tributes,...recorded.returns]:[];
 for(const flow of [...flows].reverse()){
  if(!Number.isInteger(flow.from)||!Number.isInteger(flow.to)||flow.from<0||flow.from>3||flow.to<0||flow.to>3||flow.from===flow.to)throw new Error('public exchange role invalid');
  const index=witness.hands[flow.to].findIndex(c=>c.id===flow.card.id);if(index<0||!isDeepStrictEqual(witness.hands[flow.to][index],flow.card))throw new Error('known public tribute/return ownership violated');
  witness.hands[flow.from].push(witness.hands[flow.to].splice(index,1)[0]);
 }
 if(witness.hands.some(h=>h.length!==27))throw new Error('public exchange does not reconstruct the initial deal');
 for(const flow of recorded?.tributes??[]){const hand=witness.hands[flow.from],index=hand.findIndex(c=>c.id===flow.card.id);if(index<0)throw new Error('public tribute card absent before exchange');hand.unshift(hand.splice(index,1)[0]);}
 const actual=applyTribute(witness,[0,1,2,3]);
 if(actual===null){if(recorded!==null)throw new Error('unexpected public exchange in first round');return;}
 if(!recorded||actual.resist!==recorded.resist||actual.leader!==recorded.leader||!isDeepStrictEqual(actual.tributes,recorded.tributes))throw new Error('public tribute/resist flow differs from frozen rules');
 witness.tribute=actual;witness.leader=actual.leader;witness.lastPlayer=actual.leader;witness.turn=witness.pendingReturns[0]?.from??actual.leader;
 for(const transfer of recorded.returns){const pending=witness.pendingReturns[0];if(!pending||pending.from!==transfer.from||pending.to!==transfer.to)throw new Error('public return role/order invalid');const card=witness.hands[transfer.from].find(c=>c.id===transfer.card.id);if(!card||!isDeepStrictEqual(card,transfer.card))throw new Error('public return card not owned');completeReturn(witness,card);}
 if(witness.pendingReturns.length||!isDeepStrictEqual(actual.returns,recorded.returns)||witness.hands.some((h,seat)=>h.map(c=>c.id).sort((a,b)=>a-b).join(',')!==postExchangeHands[seat].map(c=>c.id).sort((a,b)=>a-b).join(',')))throw new Error('public exchange does not reconstruct recorded ownership');
}
/** applyMove trusts a declared combination. Validate its full owned resources and
 * declaration independently; no guard fallback and no best-response reselection. */
export function resolveLegalMove(state:GameState,move:{pass:boolean;combo?:Combo}):{pass:boolean;combo?:Combo}{
 if(state.over||state.pendingReturns.length)throw new Error('illegal move outside active play');
 if(move.pass){if(!canPass(state)||move.combo)throw new Error('illegal pass');return{pass:true};}
 if(!move.combo?.cards.length)throw new Error('illegal empty declared move');
 const ids=move.combo.cards.map(c=>c.id);if(new Set(ids).size!==ids.length)throw new Error('duplicate physical resource identity');
 const own=state.hands[state.turn],cards=ids.map(id=>own.find(c=>c.id===id));if(cards.some(c=>!c))throw new Error('physical resource not owned');
 if(cards.some((card,index)=>card!.suit!==move.combo!.cards[index].suit||card!.rank!==move.combo!.cards[index].rank))throw new Error('selected physical-card identity differs from the actual owned card');
 const key=necessaryDeclarationKey(move.combo,state.ctx),declared=classify(cards as any,state.ctx,state.match.opts).find(c=>necessaryDeclarationKey(c,state.ctx)===key);
 if(!declared||state.lastCombo&&!beats(declared,state.lastCombo))throw new Error('declared legal action identity mismatch');
 return{pass:false,combo:move.combo};
}

const networks=new Map<string,MLP>();
function loadNetwork(spec:PolicySpec){
 if(!spec.weightsPath||!spec.weightsSHA256||![385,399].includes(spec.inputDim!))throw new Error('incomplete neural policy identity');
 if(!spec.encoder||!['action64','legacy-phys10'].includes(spec.encoder.passEncoding!))throw new Error('explicit frozen pass encoder required');
 if(spec.inputDim===399&&spec.encoder.schema!=='v2'||spec.inputDim===385&&spec.encoder.schema!==undefined&&spec.encoder.schema!=='v1')throw new Error('frozen network dimension/encoder schema mismatch');
 if(spec.inputDim===399&&!['zero','rule-context'].includes(spec.encoder.ctxFill!))throw new Error('399 encoder ctxFill context must be explicit');
 if(spec.inputDim===385&&spec.encoder.ctxFill!==undefined)throw new Error('385 encoder has no context extension');
 if(!Number.isFinite(spec.epsilon)||spec.epsilon!<0||spec.epsilon!>1)throw new Error('explicit finite frozen epsilon required');
 if(fileHash(spec.weightsPath)!==spec.weightsSHA256)throw new Error('policy weights changed');
 const key=spec.weightsSHA256+':'+spec.inputDim;
 if(!networks.has(key)){const raw=readFileSync(spec.weightsPath),flat=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),model=new MLP(1,spec.inputDim);if(model.paramCount!==flat.length||!flat.every(Number.isFinite))throw new Error('malformed frozen policy');model.setWeights(flat);networks.set(key,model);}
 return networks.get(key)!;
}
function driverFor(spec:PolicySpec,seat:number,options:MatchPlayOptions):SeatDriver{
 if(!spec.policyId)throw new Error('policyId required for every seat');
 let history:PublicStep[]=[],gameNo=0,ordinal=0,random=mulberry32(0),heuristic:ReturnType<typeof createAI>|null=null;
 const decider=spec.kind==='neural'?new NeuralDecider(seat,loadNetwork(spec),spec.epsilon??0,()=>random(),spec.encoder):null;
 if(!decider&&(spec.kind!=='heuristic'||![0,1,2].includes(spec.difficulty!)))throw new Error('unknown frozen policy kind');
 const seedFor=(purpose:string)=>deriveSeed(spec.policyId,options.seed,gameNo*4+seat,purpose);
 const legacyHeuristicSeed=()=>{const rng=new RNG((options.seed^(0x5eed+gameNo-1))>>>0);let value=0;for(let k=0;k<=seat;k++)value=rng.next()*0xffffffff;return value;};
 const ownActions=(events:EngineEvent[])=>events.filter(e=>(e.type==='play'||e.type==='pass')&&e.player===seat).length;
 return{policyId:spec.policyId,newGame(state,prefix){history=[...prefix];gameNo=state.match.gameNo;ordinal=prefix.reduce((n,row)=>n+ownActions(row.events),0);random=mulberry32(seedFor('policy-game'));
   if(decider){decider.newGame();for(const row of prefix)decider.observe(row.events);}else{heuristic=createAI(seat,spec.difficulty!,options.rngMode==='legacy-per-game'?legacyHeuristicSeed():seedFor('policy-game'));heuristic.reset(state,state.match.opts);for(const row of prefix)heuristic.observe(row.events,row.priorTarget);}},
  observe(events,priorTarget){history.push({events,priorTarget});ordinal+=ownActions(events);if(decider)decider.observe(events);else heuristic!.observe(events,priorTarget);},
  decide(state){
   if(options.rngMode!=='legacy-per-game'){
    const seed=seedFor('decision-'+(ordinal+1));random=mulberry32(seed);
    if(!decider){if(spec.difficulty===2)throw new Error('advanced heuristic requires its frozen per-game rollout budget');heuristic=createAI(seat,spec.difficulty!,seed);heuristic.reset(state,state.match.opts);for(const row of history)heuristic.observe(row.events,row.priorTarget);}
   }
   if(decider){const result=decider.decide(state,{collectFeat:true});return{...result.move,feat:result.feat};}
   return heuristic!.decide(state);
  }};
}

/** Complete engine match only. A cap preserves an incomplete record and null
 * outcome; the root target is this round's signed upgrade plus final team win. */
export function runCompleteMatch(options:MatchPlayOptions){
 if(!Number.isSafeInteger(options.seed)||options.policies.length!==4||options.policies.some(p=>!p.policyId))throw new Error('four fixed seat identities and integer seed required');
 if(options.actingSeat!==undefined&&(!Number.isInteger(options.actingSeat)||options.actingSeat<0||options.actingSeat>3))throw new Error('evaluation actor must be a physical seat0-3');
 if(options.rootState&&(options.actingSeat===undefined||options.actingSeat!==options.rootState.turn))throw new Error('continuation root actor identity must match the current turn');
 const maxGames=options.maxGames??80,maxMoves=options.maxMovesPerGame??2500;
 if(!Number.isSafeInteger(maxGames)||maxGames<0||!Number.isSafeInteger(maxMoves)||maxMoves<0)throw new Error('invalid complete-match guards');
 if(options.deadlineMonotonicMs!==undefined&&!Number.isFinite(options.deadlineMonotonicMs))throw new Error('invalid monotonic match deadline');
 const expired=()=>options.deadlineMonotonicMs!==undefined&&performance.now()>=options.deadlineMonotonicMs;
 let state=options.rootState?cloneGameState(options.rootState):null,match=state?.match??createMatch({...DEFAULT_RULES},options.seed),history:PublicStep[]=[...(options.rootHistory??[])],games=0,decisions=0,rootRoundResult:GameResult|null=null,forced=!!options.forcedRootMove,stopReason:string|null=null;
 if(state&&(state.over||state.pendingReturns.length))throw new Error('invalid continuation root');
 if(forced&&(!state||!Number.isInteger(options.actingSeat)||options.actingSeat!==state.turn))throw new Error('forced root actor identity required and must match current turn');
 if(state)assertRootHistory(state,history);
 if(options.ownPlan&&(!state||options.ownPlan.actor!==options.actingSeat||options.ownPlan.actor!==state.turn))throw new Error('own plan must control only the continuation root actor seat');
 const plan=options.ownPlan?new PlanRuntime(options.ownPlan.program,options.ownPlan.actor,options.ownPlan.rootId):null;let planControlledDecisions=0;const planStatusCounts:Record<string,number>={};
 const seats=options.policies.map((spec,seat)=>options.seatFactory?options.seatFactory(spec,seat):driverFor(spec,seat,options)),trace=createHash('sha256'),deals:Array<{gameNo:number;dealSeed:number|null;fingerprint:string;levels:[number,number]}>=[];
 while(match.winner===null&&games<maxGames){
  if(expired()){stopReason='deadline';break;}
  if(!state){if(options.dealMode!=='legacy-engine-chain')match.rngState=indexedDealSeed(options.dealNamespace??'review6-indexed-deal-v1',options.seed,match.gameNo);const dealSeed=match.rngState;state=startGame(match);history=[];deals.push({gameNo:match.gameNo,dealSeed,fingerprint:createHash('sha256').update(JSON.stringify(state.hands.map(h=>h.map(c=>c.id).sort((a,b)=>a-b)))).digest('hex'),levels:[...state.levelsBefore]});}
  else deals.push({gameNo:match.gameNo,dealSeed:null,fingerprint:createHash('sha256').update(JSON.stringify(state.hands.map(h=>h.map(c=>c.id).sort((a,b)=>a-b)))).digest('hex'),levels:[...state.levelsBefore]});
  seats.forEach(s=>s.newGame(state!,history));let moves=0;
  while(!state.over&&moves<maxMoves){
   if(expired()){stopReason='deadline';break;}
   const seat=state.turn;options.onBeforeDecision?.({state,seat,history});
   if(forced&&options.actingSeat!==undefined&&seat!==options.actingSeat)throw new Error('forced action actor identity mismatch');
   const planned=plan&&seat===plan.actor?plan.consider(state,history):null,wasForced=forced;
   if(forced&&plan&&(!planned?.move||necessaryDeclarationKey(planned.move.pass?null:planned.move.combo!,state.ctx)!==necessaryDeclarationKey(options.forcedRootMove!.pass?null:options.forcedRootMove!.combo!,state.ctx)))throw new Error('forced root and explicit plan first action differ');
   if(planned){planStatusCounts[planned.status]=(planStatusCounts[planned.status]??0)+1;if(planned.move)planControlledDecisions++;}
   const selected=forced?options.forcedRootMove!:planned?.move??seats[seat].decide(state);forced=false;
   const control={source:(wasForced?'forced_root':planned?.move?'own_plan':'frozen_policy') as 'forced_root'|'own_plan'|'frozen_policy',planStatus:planned?.status??null};
   const move=resolveLegalMove(state,selected),priorTarget=state.lastCombo,events=applyMove(state,move as any);moves++;decisions++;
   seats.forEach(s=>s.observe(events,priorTarget));history.push({events,priorTarget});
   trace.update(JSON.stringify({gameNo:match.gameNo,seat,move:resourceEffectKey(move.pass?null:move.combo!),counts:state.hands.map(h=>h.length),events}));
   options.onAfterDecision?.({state,seat,move,events,history,feat:'feat'in selected?selected.feat:undefined,control});
  }
  games++;
  if(!state.result){stopReason??='round_move_cap';break;}
  if(!rootRoundResult)rootRoundResult=state.result;
  state=null;
 }
 const complete=match.winner!==null,team=teamOf(options.actingSeat??0),g=rootRoundResult?(rootRoundResult.winnerTeam===team?rootRoundResult.upgrade:-rootRoundResult.upgrade):null;
 return{complete,winner:complete?match.winner:null,games,decisions,incompleteReason:complete?null:stopReason??'match_game_cap',rootRoundResult,rootTeamTarget:complete&&g!==null?g+(match.winner===team?1:-1):null,rootG:g,finalW:complete?(match.winner===team?1:-1):null,policyIds:seats.map(s=>s.policyId),traceSHA256:trace.digest('hex'),deals,ownPlanSummary:plan?{...plan.snapshot(),controlledDecisions:planControlledDecisions,statusCounts:planStatusCounts}:null};
}
