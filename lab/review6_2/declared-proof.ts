/** Exact current-round continuation plus a bound over completed future W. */
import{readFileSync,mkdirSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';import{join}from'node:path';import{fileURLToPath}from'node:url';import{isDeepStrictEqual}from'node:util';
import{createMatch,startGame,applyMove,buildDeck,DEFAULT_RULES,teamOf}from'@gd/engine';
import{resolveLegalMove,indexedDealSeed,runCompleteMatch}from'../review6/match-play';import{resolveContinuationProfile}from'../review6/policy-registry';
import{dealtFamilyBeforeExchange}from'../review6/training-ancestry';import{toVisibleRoot}from'../review6/visible-world';import{rootCandidates}from'../review6/teacher-roots';
const base=fileURLToPath(new URL('../../',import.meta.url)),read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex'),wire=(v:any)=>JSON.parse(JSON.stringify(v));
const registryRef=join(base,'lab/review6_1/data/no-H-policy-registry-001.json');
const FILES=['lab/review6_2/declared-proof.ts','lab/review6_2/teaching-evidence.ts','lab/review6/policy-registry.ts','lab/review6/match-play.ts','lab/review6/visible-world.ts','lab/review6/teacher-roots.ts','lab/review6/action-effect.ts','lab/review6/exact-inference.ts',...['index','game','combo','deck','rank','rng','types'].map(p=>'packages/engine/src/'+p+'.ts'),...['nn/mlp','nn/schema','nn/neuralSeat','nn/neuralSeat','memory','legal'].map(p=>'packages/ai/src/'+p+'.ts')];
export const declaredProofSources=()=>[...new Set(FILES)].map(path=>({path,sha256:sha(join(base,path))}));
const rootKey=(r:any)=>createHash('sha256').update(JSON.stringify([r.sourceFamilyId,r.observedBefore.matchPublic.gameNo,r.observedBefore.statePublic.moveNo,r.observedBefore.actor,r.observedBefore.observationSHA256])).digest('hex');

export function replayDeclaredPrefix(p:any){
 if(p.schema!=='declared-complete-initial-deal-prefix-v1'||!p.parentRef||sha(p.parentRef)!==p.parentSHA256||!Array.isArray(p.moves)||p.moves.length>2500)throw Error('declared prefix contract changed');
 const parent=read(p.parentRef);
 if(parent.schema!=='native-parent-prefix-before-declared-deal-v1'||!Number.isSafeInteger(parent.sourceSeed)||parent.sourceSeed<0||parent.sourceSeed>4294967295||typeof parent.dealNamespace!=='string'||!parent.dealNamespace||!Array.isArray(parent.moves)||parent.moves.length>80*2500||sha(parent.sourceRef)!==parent.sourceSHA256)throw Error('declared native parent contract');
 const match=createMatch({...DEFAULT_RULES},parent.sourceSeed),families:string[]=[];let at=0;
 const games=parent.parentMatch?.gameNo;if(!Number.isInteger(games)||games<1||games>=80)throw Error('declared parent round count');
 for(let g=1;g<=games;g++){
  if(match.winner!==null)throw Error('declared native parent continues after terminal');
  match.rngState=indexedDealSeed(parent.dealNamespace,parent.sourceSeed,match.gameNo);const s=startGame(match);families.push(dealtFamilyBeforeExchange(s));
  while(at<parent.moves.length&&parent.moves[at].gameNo===g){const row=parent.moves[at++];if(s.over||s.turn!==row.actor)throw Error('declared native parent actor');applyMove(s,resolveLegalMove(s,row.move)as any);}
  if(!s.over)throw Error('declared native parent unfinished round');
 }
 if(at!==parent.moves.length||match.winner!==null||families[0]!==parent.sourceFamilyId||!isDeepStrictEqual(match,parent.parentMatch))throw Error('declared native parent mismatch');
 // The explicit branch consumes no shuffle RNG. The replayed match state and
 // automatic tribute/return rules determine all other starting fields.
 const state=startGame(match,[],p.initialIds),history:any[]=[];families.push(dealtFamilyBeforeExchange(state));
 if(families.at(-1)!==p.sourceFamilyId)throw Error('declared initial family mismatch');
 for(const row of p.moves){if(row.gameNo!==match.gameNo||state.over||state.turn!==row.actor)throw Error('declared prefix actor/round');const priorTarget=structuredClone(state.lastCombo),events=applyMove(state,resolveLegalMove(state,row.move)as any);history.push({events,priorTarget});}
 if(state.over||state.match.winner!==null||state.pendingReturns.length)throw Error('declared root already terminal');
 return{state,history,families,observed:toVisibleRoot(state,history),candidates:rootCandidates(state)};
}

export function deriveDeclaredBound(p:any,root:any,preferredActionId:string,otherActionId:string){
 const r=replayDeclaredPrefix(p),{state,observed,candidates}=r,actor=observed.actor,team=teamOf(actor);
 if(!isDeepStrictEqual(root.observedBefore,wire(observed))||!isDeepStrictEqual(root.allCandidates,wire(candidates))||root.sourceFamilyId!==r.families[0]||root.sourceRootRoundFamilyId!==r.families.at(-1))throw Error('declared root public/candidates differ from replay');
 const alive=observed.counts.flatMap((n,i)=>n>0?[i]:[]),other=alive.find(s=>s!==actor);
 if(alive.length!==2||other===undefined||teamOf(other)===team||state.finished.length!==2||observed.representationGaps.length)throw Error('declared exact bound requires two opposing live seats');
 const known=new Set([...observed.ownCards.map(c=>c.id),...observed.history.flatMap(h=>h.events.flatMap((e:any)=>e.type==='play'?e.combo.cards.map((c:any)=>c.id):[]))]);
 const unseen=buildDeck().filter(c=>!known.has(c.id)).map(c=>c.id).sort((a,b)=>a-b);
 if(!isDeepStrictEqual(unseen,state.hands[other].map(c=>c.id).sort((a,b)=>a-b)))throw Error('remaining foreign hand not determined by public information');
 const plus=candidates.find(c=>c.actionId===preferredActionId),minus=candidates.find(c=>c.actionId===otherActionId);if(!plus||!minus||plus===minus)throw Error('declared bound pair absent');
 const registry=read(registryRef),profiles:any[]=[];
 for(const name of ['primary','secondary']){
  const profile=resolveContinuationProfile(registry,name,actor);
  if(alive.some(s=>profile.seats[s].policy.kind!=='neural'||profile.seats[s].policy.epsilon!==0))throw Error('declared bound requires deterministic frozen neural live seats');
  const leaves=[plus,minus].map(c=>{
   const result=runCompleteMatch({seed:2026103001,policies:profile.seats.map(s=>s.policy),rngMode:'counter-per-decision',inferenceExecution:'exact-prefix-v1',rootState:state,rootHistory:r.history,actingSeat:actor,forcedRootMove:c.move,maxGames:1,maxMovesPerGame:2500});
   if(result.rootG===null||!result.rootRoundResult)throw Error('declared continuation did not finish current round');
   const interval=result.complete?[result.rootTeamTarget!,result.rootTeamTarget!]:[result.rootG-1,result.rootG+1];
   return{actionId:c.actionId,completeRound:true,completeMatch:result.complete,g:result.rootG,W:result.finalW,y:result.rootTeamTarget,fullTargetInterval:interval,finishOrder:result.rootRoundResult.finishOrder,traceSHA256:result.traceSHA256,decisions:result.decisions};
  });
  const lower=(leaves[0].fullTargetInterval[0]-leaves[1].fullTargetInterval[1])/8;if(!(lower>(name==='primary'?.02:0)))throw Error('declared bound does not support fixed direction in '+name);
  profiles.push({profileName:name,profileSHA256:profile.profileSHA256,plus:leaves[0],minus:leaves[1],normalizedDifferenceLowerBound:lower});
 }
 return{preferredActionId,otherActionId,observationSHA256:observed.observationSHA256,prefixFamilies:r.families,knownForeignCards:unseen,registrySHA256:sha(registryRef),profiles,quantification:'these two frozen deterministic current-round profiles and all legal completed future match outcomes; no claim of future termination or other policies'};
}

export function assertDeclaredEvidence(card:any,root:any,key:string,index:any,split:string){
 const pairs=card.pairs??[{preferredActionId:card.preferredActionId,otherActionId:card.otherActionId}];
 if(card.evidenceTier!=='strong'||pairs.length!==1||card.statisticsRef||card.statisticsRefs||card.split!==split||!['train','dev','sealed'].includes(split)||!card.proofRef||sha(card.proofRef)!==card.proofSHA256)throw Error('declared single-pair certificate required');
 const c=read(card.proofRef);if(c.schema!=='declared-deal-bound-certificate-v1'||c.evidenceKind!==card.evidenceKind||c.scope!=='root_action_only'||c.split!==split||c.rootRef!==card.rootRef||c.rootSHA256!==sha(card.rootRef)||c.rootKey!==key||key!==rootKey(root)||!isDeepStrictEqual(c.sourceFiles,declaredProofSources())||sha(c.prefixRef)!==c.prefixSHA256)throw Error('declared proof identity/source changed');
 const bound=deriveDeclaredBound(read(c.prefixRef),root,pairs[0].preferredActionId,pairs[0].otherActionId);
 if(bound.prefixFamilies.some(f=>index.families?.[f]?.split!==split))throw Error('declared prefix source split mismatch');
 if(!isDeepStrictEqual(c.bound,bound))throw Error('declared complete target bound changed');return bound;
}

export function certifyDeclaredResource(source:string,output:string,indexRef:string){
 mkdirSync(output,{recursive:true});const cards:any[]=[];
 for(const path of ['A','B']){
  const record=read(join(source,'path-'+path+'.json')),rootRef=join(output,'root-'+path+'.json'),prefixRef=join(output,'prefix-'+path+'.json');writeFileSync(rootRef,JSON.stringify(record.root)+'\n');writeFileSync(prefixRef,JSON.stringify(record.prefix)+'\n');
  const root=record.root,bySize=(size:number)=>root.allCandidates.find((c:any)=>!c.move.pass&&c.move.combo.kind==='bomb'&&c.move.combo.mainRank===4&&c.move.combo.size===size)?.actionId;
  const preferredActionId=bySize(path==='A'?4:5),otherActionId=bySize(path==='A'?5:4),bound=deriveDeclaredBound(record.prefix,root,preferredActionId,otherActionId),proofRef=join(output,'certificate-'+path+'.json');
  writeFileSync(proofRef,JSON.stringify({schema:'declared-deal-bound-certificate-v1',evidenceKind:'declared-deal-target-bound-v1',scope:'root_action_only',split:'train',rootRef,rootSHA256:sha(rootRef),rootKey:rootKey(root),prefixRef,prefixSHA256:sha(prefixRef),sourceFiles:declaredProofSources(),bound})+'\n');
  const card={labelId:'r62-declared-proof:'+rootKey(root),split:'train',sourceFamilyId:root.sourceFamilyId,sourceKind:'rule',preference:'prefer',evidenceTier:'strong',evidenceKind:'declared-deal-target-bound-v1',rootRef,rootSHA256:sha(rootRef),preferredActionId,otherActionId,proofRef,proofSHA256:sha(proofRef),rationale:'完整初始牌堆及原生历史可达；公开信息唯一确定余牌，两冻结策略本副真实续打，保留全部候选；完整g+W差下界至少1，不假定后续必终止。'};
  assertDeclaredEvidence(card,root,rootKey(root),read(indexRef),'train');cards.push(card);
 }
 writeFileSync(join(output,'cards.jsonl'),cards.map(c=>JSON.stringify(c)).join('\n')+'\n');return{cardsRef:join(output,'cards.jsonl'),cards:cards.length,newWorldSampling:0};
}
