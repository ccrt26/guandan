/** Public sufficient conditions and a native level2→A reachability witness. */
import{createMatch,startGame,DEFAULT_RULES,applyMove,teamOf,buildDeck,type GameState}from'@gd/engine';
import{toVisibleRoot,type VisibleRoot}from'../review6/visible-world';import{resolveLegalMove,indexedDealSeed,type PublicStep}from'../review6/match-play';
import{dealtFamilyBeforeExchange}from'../review6/training-ancestry';import{rootCandidates}from'../review6/teacher-roots';
import{necessaryDeclarationKey}from'../review6/action-effect';
export function publicTerminalPair(obs:VisibleRoot,candidates:any[]){
 const a=obs.actor,s=obs.statePublic,team=teamOf(a),alive=obs.counts.map((n,i)=>({n,i})).filter(r=>r.n>0);
 if(JSON.stringify(obs.matchPublic.opts)!==JSON.stringify(DEFAULT_RULES)||obs.matchPublic.opts.passA!=='head3'||s.turn!==a||s.levelsBefore[team]!==14||s.finished.length!==2||s.finished[0]!==((a+2)%4)||teamOf(s.finished[1])===team||obs.counts[a]!==1||alive.length!==2||alive.some(r=>r.n!==1)||s.lastCombo?.kind!=='single'||s.lastPlayer===a||obs.counts[s.lastPlayer]!==1||teamOf(s.lastPlayer)===team||obs.representationGaps.length)return null;
 const plus=candidates.find(c=>!c.move.pass&&c.move.combo?.size===1&&c.move.combo.cards[0].id===obs.ownCards[0].id),minus=candidates.find(c=>c.move.pass);
 if(!plus||!minus||candidates.length!==2)return null;
 return{preferredActionId:plus.actionId,otherActionId:minus.actionId,preferredActionKey:plus.actionKey,otherActionKey:minus.actionKey,normalizedDifferenceLowerBound:.125,scope:'all final outcomes in the complete g+W domain; no termination claim for PASS'};
}
export function replayNativePrefix(proof:any){
 if(proof.schema!=='native-terminal-prefix-v1'||!Number.isSafeInteger(proof.sourceSeed)||proof.sourceSeed<0||proof.sourceSeed>4294967295||typeof proof.dealNamespace!=='string'||!proof.dealNamespace||!Number.isSafeInteger(proof.rootGameNo)||proof.rootGameNo<1||proof.rootGameNo>80||!Array.isArray(proof.moves)||proof.moves.length>80*2500)throw Error('native terminal prefix contract missing');
 const match=createMatch({...DEFAULT_RULES},proof.sourceSeed),families:string[]=[];let at=0,final:GameState|null=null,history:PublicStep[]=[];
 for(let g=1;g<=proof.rootGameNo;g++){
  if(match.winner!==null)throw Error('native prefix continues after full terminal');
  match.rngState=indexedDealSeed(proof.dealNamespace,proof.sourceSeed,match.gameNo);const state=startGame(match);history=[];families.push(dealtFamilyBeforeExchange(state));
  while(at<proof.moves.length&&proof.moves[at].gameNo===g){
   const row=proof.moves[at++];if(state.over||state.turn!==row.actor)throw Error('native prefix actor/round already finished');
   const priorTarget=structuredClone(state.lastCombo),move=resolveLegalMove(state,row.move),events=applyMove(state,move.pass?{pass:true}:{pass:false,combo:move.combo!});history.push({events,priorTarget});
  }
  if(g<proof.rootGameNo&&!state.over)throw Error('native prefix skips unfinished round');
  if(g===proof.rootGameNo){if(state.over)throw Error('native question root is already terminal');final=state;}
 }
 if(at!==proof.moves.length||!final||families[0]!==proof.sourceFamilyId)throw Error('native prefix trailing moves/family mismatch');
 const observed=toVisibleRoot(final,history);if(observed.observationSHA256!==proof.rootObservationSHA256)throw Error('native prefix observation mismatch');
 const candidates=rootCandidates(final),pair=publicTerminalPair(observed,candidates);if(!pair)throw Error('native root does not satisfy complete-target bound premises');
 return{state:final,observed,candidates,pair,prefixFamilies:families};
}
/** The PASS leaf ends only this round; W and full completion remain unknown. */
export function deriveTerminalBound(proof:any){
 const replay=replayNativePrefix(proof),{state,pair,candidates,observed}=replay,team=teamOf(observed.actor);
 const publicIds=new Set([...observed.ownCards.map(c=>c.id),...observed.history.flatMap(h=>h.events.flatMap((e:any)=>e.type==='play'?e.combo.cards.map((c:any)=>c.id):[]))]);
 const unseen=buildDeck().filter(c=>!publicIds.has(c.id));if(unseen.length!==1||unseen[0].id!==state.hands[state.lastPlayer][0].id)throw Error('terminal proof does not determine its sole remaining foreign card from public information');
 const plus=structuredClone(state),p=candidates.find(c=>c.actionId===pair.preferredActionId)!;
 applyMove(plus,resolveLegalMove(plus,p.move)as any);
 if(!plus.over||plus.match.winner!==team||plus.result?.winnerTeam!==team||plus.result.upgrade!==2)throw Error('preferred branch fails actual complete g+W leaf');
 const minus=structuredClone(state);applyMove(minus,resolveLegalMove(minus,{pass:true})as any);
 if(minus.turn!==state.lastPlayer||minus.lastCombo!==null||minus.hands[minus.turn].length!==1)throw Error('PASS does not return lead to the living last player');
 const choices=rootCandidates(minus),finish=choices.find(c=>!c.move.pass&&c.move.combo?.size===1);if(!finish||choices.length!==1)throw Error('last opponent continuation is not forced');
 applyMove(minus,resolveLegalMove(minus,finish.move)as any);
 if(!minus.over||minus.result?.winnerTeam!==team||minus.result.upgrade!==1||minus.match.winner!==null)throw Error('PASS round leaf does not establish g=1 with future W unknown');
 return{actor:observed.actor,observationSHA256:observed.observationSHA256,preferredActionId:pair.preferredActionId,otherActionId:pair.otherActionId,preferredActionKey:necessaryDeclarationKey(p.move.combo!,state.ctx),otherActionKey:necessaryDeclarationKey(null,state.ctx),
  plus:{completeMatch:true,g:2,W:1,y:3,finishOrder:plus.result.finishOrder},minus:{completeRound:true,completeMatch:minus.match.winner!==null,g:1,W:null,fullTargetPossibleValues:[0,2],finishOrder:minus.result.finishOrder},differenceLowerBound:1,normalizedDifferenceLowerBound:.125,quantification:'all possible final outcomes of legal completed matches; no PASS termination or80-game guarantee',prefixFamilies:replay.prefixFamilies};
}
