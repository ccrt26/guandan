/** Native deals + engine actions only. Private source search never supplies
 * another seat's cards or the source seed to the public proposal function. */
import{mkdirSync,existsSync,writeFileSync}from'node:fs';import{join}from'node:path';
import{createMatch,startGame,DEFAULT_RULES,applyMove,classify,makeLevelCtx,type Card,type GameState}from'@gd/engine';
import{deriveSeed}from'@gd/ai';import{toVisibleRoot,type VisibleRoot}from'../review6/visible-world';
import{resolveLegalMove,type PublicStep}from'../review6/match-play';import{rootCandidates}from'../review6/teacher-roots';
import{engineDealFamily}from'../review6/capability-lineage';import{ROOT,atomicJson,fileHash,rootKey,excludedFamilies,bindFamilies,hash}from'./protocol';

type Kind='takeover'|'four_before_five'|'five_before_four';
function reservations(state:GameState,kind:Kind){
 const pools=state.hands.map(h=>[...h]),keep=state.hands.map(()=>[]as Card[]);
 const take=(seat:number,rank:number,n=1)=>Array.from({length:n},()=>{const i=pools[seat].findIndex(c=>c.rank===rank);if(i<0)throw Error('missing prescribed rank');const[c]=pools[seat].splice(i,1);keep[seat].push(c);return c;});
 if(kind==='takeover'){take(0,17);take(0,3);take(1,14);take(3,16);}
 else{take(0,8,5);if(kind==='four_before_five')for(const r of[6,7,9,10])take(0,r);else take(0,6,2);take(1,14,2);take(3,14,2);}
 take(2,3);const final=kind==='takeover'?take(2,4):[...take(2,13,3),...take(2,12,2)];
 const outgoing=[take(0,3)[0],take(1,5)[0],take(2,7)[0],take(3,9)[0]],incoming=[take(1,4)[0],take(2,6)[0],take(3,8)[0],take(2,10)[0]];
 return{keep,outgoing,incoming,final};
}
function execute(seed:number,kind:Kind){
 const state=startGame(createMatch({...DEFAULT_RULES},seed)),family=engineDealFamily(state.hands);
 if(state.turn!==0)throw Error('native initial leader is not script leader');
 const r=reservations(state,kind),history:PublicStep[]=[],moves:any[]=[];
 const play=(actor:number,move:any)=>{
  if(state.turn!==actor)throw Error('script actor mismatch');const priorTarget=structuredClone(state.lastCombo),legal=resolveLegalMove(state,move);
  moves.push({actor,move:structuredClone(legal)});const events=applyMove(state,legal.pass?{pass:true}:{pass:false,combo:legal.combo!});history.push({events,priorTarget});
  if(state.over||state.finished.length)throw Error('script unexpectedly finished a player');
 };
 const single=(c:Card)=>({pass:false,combo:classify([c],state.ctx,state.match.opts).find(c=>c.kind==='single')!});
 const settle=(leader:number)=>{let guard=0;while(state.turn!==leader||state.lastCombo!==null){if(++guard>4)throw Error('script trick did not settle');play(state.turn,{pass:true});}};
 for(let seat=0;seat<4;seat++){
  const preserve=new Set(r.keep[seat].map(c=>c.id));let discard:Card|undefined;
  while((discard=state.hands[seat].find(c=>!preserve.has(c.id)))){play(seat,single(discard));settle(seat);}
  play(seat,single(r.outgoing[seat]));const to=seat===3?2:seat+1;
  while(state.turn!==to)play(state.turn,{pass:true});play(to,single(r.incoming[seat]));settle(to);
 }
 const combo=classify(r.final,state.ctx,state.match.opts).find(c=>c.kind===(kind==='takeover'?'single':'trio_pair'));
 if(!combo)throw Error('script root declaration missing');play(2,{pass:false,combo});play(3,{pass:true});
 const observed=toVisibleRoot(state,history),proof={schema:'r62-native-script-v1',seed,kind,sourceFamilyId:family,moves,finalObservationSHA256:observed.observationSHA256};
 const root={rootId:'r62-constructed-'+kind+'-'+seed,sourceFamilyId:family,sourceScenarioSeed:seed,slot:seed,category:kind==='takeover'?'cooperation_urgent':'resource_structure',sourceKind:'constructed_legal_trajectory',observedBefore:observed,allCandidates:rootCandidates(state),generationPolicyId:'native-script-v1',sourcePrivateStateExposedToProposal:false};
 return{root,proof};
}
export function replayConstructedProof(proof:any){
 const state=startGame(createMatch({...DEFAULT_RULES},proof.seed));if(engineDealFamily(state.hands)!==proof.sourceFamilyId)throw Error('native source family changed');const history:PublicStep[]=[];
 for(const row of proof.moves){if(state.turn!==row.actor)throw Error('replay actor mismatch');const priorTarget=structuredClone(state.lastCombo),legal=resolveLegalMove(state,row.move),events=applyMove(state,legal.pass?{pass:true}:{pass:false,combo:legal.combo!});history.push({events,priorTarget});}
 const obs=toVisibleRoot(state,history);if(obs.observationSHA256!==proof.finalObservationSHA256)throw Error('replay final public observation mismatch');return obs;
}
export function buildConstructedRoot(kind:Kind,master:number,offset:number,maxSearch:number,foreign:Set<string>){
 if(!['takeover','four_before_five','five_before_four'].includes(kind)||!Number.isSafeInteger(maxSearch)||maxSearch<1||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(offset+maxSearch))throw Error('invalid finite native source search');
 const inspected:string[]=[];let foreignSkipped=0;
 for(let i=offset;i<offset+maxSearch;i++){
  const seed=deriveSeed('review6-2-constructed-native-deal-v1',master,i,kind),state=startGame(createMatch({...DEFAULT_RULES},seed)),family=engineDealFamily(state.hands);
  if(foreign.has(family)){foreignSkipped++;continue;}inspected.push(family);
  if(state.turn!==0)continue;
  try{reservations(state,kind);}catch{continue;}
  const result=execute(seed,kind);replayConstructedProof(result.proof);return{...result,inspected,foreignSkipped,nextOffset:i+1};
 }
 return{root:null,proof:null,inspected,foreignSkipped,nextOffset:offset+maxSearch};
}
/** Its signature deliberately contains no source seed or hidden source state. */
export function proposeFromPublic(obs:VisibleRoot,candidates:ReturnType<typeof rootCandidates>){
 const pass=candidates.find(c=>c.move.pass),big=candidates.find(c=>c.move.combo?.kind==='single'&&c.move.combo.cards[0].rank===17);
 if(obs.ownCards.length===2&&big&&pass&&obs.statePublic.lastPlayer===(obs.actor+2)%4&&[(obs.actor+1)%4,(obs.actor+3)%4].some(s=>obs.counts[s]===1))return{preference:'prefer',preferredActionId:big.actionId,otherActionId:pass.actionId,rationale:'Public weak proposal: use the top joker to prevent a one-card opponent from taking the current small single; full g+W still requires independent validation.'};
 const four=candidates.find(c=>c.move.combo?.kind==='bomb'&&c.move.combo.size===4),five=candidates.find(c=>c.move.combo?.kind==='bomb'&&c.move.combo.size===5&&c.move.combo.mainRank===four?.move.combo?.mainRank);
 if(four&&five){
  const ctx=makeLevelCtx(obs.statePublic.levelsBefore,obs.matchPublic.opts.levelMode as any,obs.statePublic.stageTeam);
  const finish=(c:any)=>{const used=new Set(c.move.combo.cards.map((c:Card)=>c.id)),left=obs.ownCards.filter(c=>!used.has(c.id));return left.length>0&&classify(left,ctx,obs.matchPublic.opts).length>0;};
  if(finish(four)!==finish(five)){const preferred=finish(four)?four:five,other=preferred===four?five:four;return{preference:'prefer',preferredActionId:preferred.actionId,otherActionId:other.actionId,rationale:'Public weak resource proposal: this bomb leaves a remainder playable in one move; the alternative breaks that structure. Independent complete g+W is required.'};}
 }
 return{preference:'abstain',rationale:'No unambiguous public resource proposal.'};
}
export function constructTeaching(config:any,output:string,kind:Kind,maxSearch=10000,offset=0){
 if(existsSync(output))throw Error('constructed output exists');mkdirSync(output,{recursive:true});
 const begin=performance.now(),r=buildConstructedRoot(kind,config.seed,offset,maxSearch,new Set(excludedFamilies(config.sourceIndexRef,'train')));
 bindFamilies(config.sourceIndexRef,r.inspected,'train','constructed-source-screen:'+kind+':'+offset);
 const summary:any={kind,sourceMode:'native deal and engine-legal scripted prefix; deliberately designed training distribution',screenedFamilies:r.inspected.length,foreignSkipped:r.foreignSkipped,nextOffset:r.nextOffset,completeSourceMatches:0,gradientUpdates:0,strongLabels:0,wallSeconds:(performance.now()-begin)/1000};
 if(r.root){
  const rootRef=join(output,'root.json');atomicJson(rootRef,r.root);atomicJson(join(output,'source-private-proof.json'),r.proof);
  const proposal=proposeFromPublic(r.root.observedBefore,r.root.allCandidates),card={labelId:'r62-constructed-rule:'+rootKey(r.root),rootRef,rootSHA256:fileHash(rootRef),sourceFamilyId:r.root.sourceFamilyId,split:'train',sourceKind:'rule',evidenceTier:'weak',simulationWorlds:0,...proposal};
  writeFileSync(join(output,'cards.jsonl'),JSON.stringify(card)+'\n');summary.rootId=r.root.rootId;summary.preference=proposal.preference;summary.observationSHA256=r.root.observedBefore.observationSHA256;
 }
 atomicJson(join(output,'summary.json'),summary);return summary;
}
