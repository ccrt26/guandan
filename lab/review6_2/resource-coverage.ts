/** Finite train-only declared deals; the immutable checker supplies support. */
import{existsSync,mkdirSync,writeFileSync}from'node:fs';
import{join,dirname}from'node:path';
import{buildDeck,createMatch,startGame,applyMove,classify,beats,DEFAULT_RULES,teamOf,type GameState}from'@gd/engine';
import{resolveLegalMove,indexedDealSeed,runCompleteMatch,type PublicStep}from'../review6/match-play';
import{resolveContinuationProfile}from'../review6/policy-registry';import{dealtFamilyBeforeExchange}from'../review6/training-ancestry';
import{toVisibleRoot}from'../review6/visible-world';import{rootCandidates}from'../review6/teacher-roots';
import{deriveDeclaredBound,declaredProofSources,assertDeclaredEvidence,replayDeclaredPrefix}from'./declared-proof';import{normalizeTeachingCards}from'./teacher';
import{HOME,ROOT,json,hash,fileHash,atomicJson,rootKey,bindFamilies}from'./protocol';

const TEMPLATES=[[0,2,6,11,10],[1,3,5,10,11],[0,1,7,11,9],[2,4,6,10,11]];
const vector=(label:any)=>hash(JSON.stringify([label.plus,label.minus]));
const groupVector=(labels:any[])=>hash(JSON.stringify(labels.map(l=>[l.plus,l.minus])));

export function nativeParent(sourceRootRef:string,output:string){
 const source=json(sourceRootRef),prefixRef=join(dirname(sourceRootRef),'native-prefix.json'),p=json(prefixRef),match=createMatch({...DEFAULT_RULES},p.sourceSeed);let at=0;
 const parentOnly=p.schema==='native-a-stage-parent-source-v1',sourceBinding=json(join(dirname(sourceRootRef),parentOnly?'parent-source-binding.json':'bound.json'));if(fileHash(sourceRootRef)!==sourceBinding.rootSHA256||fileHash(prefixRef)!==sourceBinding.nativePrefixSHA256)throw Error('original native source changed');
 if(parentOnly&&(sourceBinding.schema!=='native-a-stage-parent-binding-v1'||sourceBinding.split!=='sealed'||fileHash(sourceBinding.sourceRecordRef)!==sourceBinding.sourceRecordSHA256||fileHash(sourceBinding.sourceManifestRef)!==sourceBinding.sourceManifestSHA256||fileHash(sourceBinding.sourceReceiptRef)!==sourceBinding.sourceReceiptSHA256||json(sourceBinding.sourceRecordRef).receipt.traceSHA256!==sourceBinding.reproducedOriginalTrace||json(sourceBinding.sourceManifestRef).split!=='sealed'))throw Error('new parent-source original replay binding changed');
 if(!['native-terminal-prefix-v1','native-a-stage-parent-source-v1'].includes(p.schema)||p.rootGameNo<2)throw Error('complete native parent source prefix required');
 for(let g=1;g<p.rootGameNo;g++){
  match.rngState=indexedDealSeed(p.dealNamespace,p.sourceSeed,match.gameNo);const state=startGame(match);
  while(at<p.moves.length&&p.moves[at].gameNo===g){const row=p.moves[at++];if(state.over||state.turn!==row.actor)throw Error('native parent actor/round');applyMove(state,resolveLegalMove(state,row.move)as any);}
  if(!state.over||match.winner!==null)throw Error('native parent incomplete or terminal');
 }
 const actor=source.observedBefore.actor;if(match.levels[teamOf(actor)]!==14)throw Error('actual native parent actor team is not atA');
 const parentRef=join(output,'parent.json');atomicJson(parentRef,{schema:'native-parent-prefix-before-declared-deal-v1',sourceSeed:p.sourceSeed,dealNamespace:p.dealNamespace,sourceFamilyId:p.sourceFamilyId,moves:p.moves.filter((r:any)=>r.gameNo<p.rootGameNo),parentMatch:match,sourceRef:prefixRef,sourceSHA256:fileHash(prefixRef)});
 return{match,actor,parentRef,sourceFamilyId:p.sourceFamilyId,ordinal:source.slot,replayedNativeGames:p.rootGameNo-1};
}

export function declaredDeal(parent:ReturnType<typeof nativeParent>,template:number[]){
 const actor=parent.actor,mate=(actor+2)%4,enemyHead=(actor+1)%4,enemy=(actor+3)%4;
 const probe=startGame(structuredClone(parent.match));if(probe.ctx.ranks.size!==1)throw Error('default stage context required');const level=[...probe.ctx.ranks][0];
 const ranks=Array.from({length:13},(_,i)=>i+2).filter(r=>r!==level),points=template.map(i=>ranks[i]),[target,low,enemyFive,high,enemyFour]=points;
 if(!(low>target&&enemyFive>low&&high>enemyFive&&enemyFour>low)||new Set(points).size!==5)throw Error('fixed point template invalid');
 const deck=buildDeck(),hands:number[][]=[[],[],[],[]],used=new Set<number>();
 function reserve(seat:number,rank:number,count:number,suit?:string){const found=deck.filter(c=>c.rank===rank&&(!suit||c.suit===suit)&&!used.has(c.id)).slice(0,count);if(found.length!==count)throw Error('insufficient canonical resources');for(const c of found){hands[seat].push(c.id);used.add(c.id);}return found.map(c=>c.id);}
 const lowIds=reserve(actor,low,4),highIds=reserve(actor,high,4),wildIds=reserve(actor,level,1,'H'),targetIds=reserve(enemy,target,4),fiveIds=reserve(enemy,enemyFive,5),lastSingleIds=reserve(enemy,2,1),enemyFourIds=reserve(enemy,enemyFour,4);
 const unused=ranks.filter(r=>!points.includes(r)),mateStarter=reserve(mate,unused[0],4),headStarter=reserve(enemyHead,unused[1],4);
 const order=parent.match.lastResult!.finishOrder,last=order[3],givers=teamOf(order[2])===teamOf(last)?[order[2],last]:[last];reserve(givers[0],17,2);
 for(const c of deck.filter(c=>!used.has(c.id))){const seat=hands.findIndex(h=>h.length<27);if(seat<0)throw Error('complete deal overflow');hands[seat].push(c.id);used.add(c.id);}
 const initial=startGame(structuredClone(parent.match),[],hands);if(!initial.tribute?.resist||initial.pendingReturns.length)throw Error('engine did not perform actual resistance');
 const actorKeep=[...lowIds,...highIds,...wildIds],enemyKeep=[...targetIds,...fiveIds,...lastSingleIds,...enemyFourIds];
 for(const[seat,ids]of[[actor,actorKeep],[enemy,enemyKeep],[mate,mateStarter],[enemyHead,headStarter]]as const)if(ids.some(id=>!initial.hands[seat].some(c=>c.id===id)))throw Error('declared start lost protected resources');
 return{actor,mate,enemyHead,enemy,initial,hands,level,points,low,lowIds,highIds,wildIds,targetIds,fiveIds,lastSingleIds,enemyFourIds,actorKeep,enemyKeep,mateStarter,headStarter,givers};
}

export function makeVariant(parent:ReturnType<typeof nativeParent>,deal:ReturnType<typeof declaredDeal>,variant:'A'|'B',id:string){
 const state=structuredClone(deal.initial),moves:any[]=[],history:PublicStep[]=[];
 function step(move:any){const actor=state.turn,priorTarget=structuredClone(state.lastCombo),legal=resolveLegalMove(state,move),events=applyMove(state,legal as any);moves.push({gameNo:state.match.gameNo,actor,move:structuredClone(legal)});history.push({events,priorTarget});}
 function passUntil(seat:number){for(let k=0;state.turn!==seat;k++){if(k>8)throw Error('pass cycle');step({pass:true});}}
 function freeLead(seat:number){for(let k=0;state.turn!==seat||state.lastCombo!==null;k++){if(k>8)throw Error('free lead cycle');step({pass:true});}}
 function single(keep:number[]){const choices=state.hands[state.turn].filter(c=>!keep.includes(c.id)).flatMap(c=>classify([c],state.ctx,state.match.opts)).filter(c=>c.kind==='single'&&(!state.lastCombo||beats(c,state.lastCombo))).sort((a,b)=>a.mainRank-b.mainRank||a.cards[0].id-b.cards[0].id);if(!choices.length)throw Error('no legal burn singleton');step({pass:false,combo:choices[0]});}
 function bomb(ids:number[]){const cards=ids.map(id=>state.hands[state.turn].find(c=>c.id===id)!);if(cards.some(c=>!c))throw Error('scripted bomb resource absent');const combo=classify(cards,state.ctx,state.match.opts).find(c=>c.kind==='bomb'&&c.size===ids.length&&(!state.lastCombo||beats(c,state.lastCombo)));if(!combo)throw Error('scripted bomb illegal');step({pass:false,combo});}
 function burn(seat:number,keep:number[]){for(let k=0;state.hands[seat].some(c=>!keep.includes(c.id));k++){if(k>110||state.turn!==seat||state.lastCombo!==null)throw Error('burn must use real free lead');single(keep);if(state.finished.includes(seat))return;freeLead(seat);}}
 if(state.turn!==deal.mate){const kept=state.turn===deal.actor?deal.actorKeep:state.turn===deal.enemy?deal.enemyKeep:deal.headStarter;single(kept);passUntil(deal.mate);bomb(deal.mateStarter);freeLead(deal.mate);}
 burn(deal.mate,[]);freeLead(deal.actor);
 if(variant==='B'){bomb(deal.highIds);freeLead(deal.actor);}
 const retained=variant==='A'?deal.actorKeep:[...deal.lowIds,...deal.wildIds],filler=state.hands[deal.actor].find(c=>!retained.includes(c.id));if(!filler)throw Error('no legal actor handoff filler');
 burn(deal.actor,[...retained,filler.id]);single(retained);passUntil(deal.enemyHead);bomb(deal.headStarter);freeLead(deal.enemyHead);burn(deal.enemyHead,[]);freeLead(deal.enemy);
 burn(deal.enemy,variant==='A'?[...deal.targetIds,...deal.fiveIds,...deal.lastSingleIds]:[...deal.targetIds,...deal.enemyFourIds]);bomb(deal.targetIds);passUntil(deal.actor);
 if(state.turn!==deal.actor||JSON.stringify(state.finished)!==JSON.stringify([deal.mate,deal.enemyHead])||state.hands[deal.actor].length!==(variant==='A'?9:5)||state.hands[deal.enemy].length!==(variant==='A'?6:4))throw Error('constructed root differs from actual scripted target');
 const observedBefore=toVisibleRoot(state,history),allCandidates=rootCandidates(state),family=dealtFamilyBeforeExchange(deal.initial);
 const root={rootId:id,slot:parent.ordinal,sourceFamilyId:parent.sourceFamilyId,sourceRootRoundFamilyId:family,category:'resource_structure',caseThresholds:{minimumOpponentCount:1,urgentOpponentMaximum:3},sourceKind:'declared-complete-initial-deal',observedBefore,allCandidates};
 const plus=allCandidates.find(c=>!c.move.pass&&c.move.combo?.kind==='bomb'&&c.move.combo.mainRank===deal.low&&c.move.combo.size===(variant==='A'?4:5)),minus=allCandidates.find(c=>!c.move.pass&&c.move.combo?.kind==='bomb'&&c.move.combo.mainRank===deal.low&&c.move.combo.size===(variant==='A'?5:4));if(!plus||!minus)throw Error('fixed shared four/five pair absent');
 return{root,prefix:{schema:'declared-complete-initial-deal-prefix-v1',parentRef:parent.parentRef,parentSHA256:fileHash(parent.parentRef),initialIds:deal.hands,moves,sourceFamilyId:family},pair:{preferredActionId:plus.actionId,otherActionId:minus.actionId}};
}

export function certify(config:any,directory:string,variant:ReturnType<typeof makeVariant>,split='train',labelPrefix='r62-p10-rule'){
 if(!['train','sealed'].includes(split))throw Error('declared source split must be train or sealed');
 const rootRef=join(directory,'root.json'),prefixRef=join(directory,'prefix.json');atomicJson(rootRef,variant.root);atomicJson(prefixRef,variant.prefix);atomicJson(join(directory,'fixed-hypothesis.json'),variant.pair);
 // Admission compares JSON wire semantics, just like the existing certifier.
 const savedRoot=json(rootRef),savedPrefix=json(prefixRef);
 let bound:any;
 try{bound=deriveDeclaredBound(savedPrefix,savedRoot,variant.pair.preferredActionId,variant.pair.otherActionId);}
 catch(e){
  if(!(e as Error).message.startsWith('declared bound does not support fixed direction'))throw e;
  const r=replayDeclaredPrefix(variant.prefix); // Raw failed leaves, never a label.
  const registry=json(config.registryPath),leaves:any[]=[];for(const name of['primary','secondary']){const profile=resolveContinuationProfile(registry,name,variant.root.observedBefore.actor);for(const id of Object.values(variant.pair)){const c=variant.root.allCandidates.find(c=>c.actionId===id)!;leaves.push({profile:name,actionId:id,...runCompleteMatch({seed:2026103001,policies:profile.seats.map(s=>s.policy),rngMode:'counter-per-decision',inferenceExecution:'exact-prefix-v1',rootState:r.state,rootHistory:r.history,actingSeat:variant.root.observedBefore.actor,forcedRootMove:c.move,maxGames:1,maxMovesPerGame:2500})});}}
  atomicJson(join(directory,'unsupported.json'),{fixedDirection:variant.pair,reason:(e as Error).message,leaves,claim:'unverified fixed direction; no reverse or replacement'});return{accepted:false,rootRef,reason:(e as Error).message};
 }
 const proofRef=join(directory,'certificate.json');atomicJson(proofRef,{schema:'declared-deal-bound-certificate-v1',evidenceKind:'declared-deal-target-bound-v1',scope:'root_action_only',split,rootRef,rootSHA256:fileHash(rootRef),rootKey:rootKey(variant.root),prefixRef,prefixSHA256:fileHash(prefixRef),sourceFiles:declaredProofSources(),bound});
 const card={labelId:labelPrefix+':'+rootKey(variant.root),split,sourceFamilyId:variant.root.sourceFamilyId,sourceKind:'rule',preference:'prefer',evidenceTier:'strong',evidenceKind:'declared-deal-target-bound-v1',rootRef,rootSHA256:fileHash(rootRef),...variant.pair,proofRef,proofSHA256:fileHash(proofRef),rationale:'固定资源条件假设；完整108ID和默认2级原生父历史可达，原两冻结profile本副真续打及所有已完成未来W界支持；全部其他候选保留未知。'};
 assertDeclaredEvidence(card,savedRoot,rootKey(savedRoot),json(config.sourceIndexRef),split);atomicJson(join(directory,'card.json'),card);return{accepted:true,rootRef,card,bound};
}

export function constructResourceCoverage(config:any,parentDirectory:string,output:string){
 if(existsSync(output))throw Error('new coverage output directory required');const started=performance.now(),cpu=process.cpuUsage(),collection=json(join(parentDirectory,'summary.json'));
 if(collection.status!=='completed'||collection.roots.length<1||collection.roots.length>4)throw Error('completed finite native parent batch required');mkdirSync(output,{recursive:true});
 const parents=[...collection.roots].sort((a:any,b:any)=>json(a.rootRef).slot-json(b.rootRef).slot),oldBook=json(join(HOME,'data/explicit-resource-book-001/labels.json')),seenGroups=new Set([groupVector(oldBook)]),seenRoots=new Set(oldBook.map(vector)),reports:any[]=[],cards:any[]=[],newLabels:any[]=[];
 atomicJson(join(output,'manifest.json'),{schema:'p10-fixed-resource-coverage-v1',split:'train',planRef:join(ROOT,'docs/superpowers/plans/2026-10-30-guandan-review6-2-p10-coverage.md'),planSHA256:fileHash(join(ROOT,'docs/superpowers/plans/2026-10-30-guandan-review6-2-p10-coverage.md')),sourceSummaryRef:join(parentDirectory,'summary.json'),sourceSummarySHA256:fileHash(join(parentDirectory,'summary.json')),proposerUses:'own/public resource condition only; no student or source-policy rankings',parents:parents.map((p:any,i:number)=>({rootRef:p.rootRef,rootSHA256:fileHash(p.rootRef),templateIndex:i,template:TEMPLATES[i]}))});
 for(let i=0;i<parents.length;i++){
  const directory=join(output,'family-'+(i+1));mkdirSync(directory,{recursive:true});const parent=nativeParent(parents[i].rootRef,directory),deal=declaredDeal(parent,TEMPLATES[i]),family=dealtFamilyBeforeExchange(deal.initial);bindFamilies(config.sourceIndexRef,[parent.sourceFamilyId,family],'train','p10-declared:'+parent.ordinal);
  atomicJson(join(directory,'deal-input.json'),{parentRef:parent.parentRef,parentSHA256:fileHash(parent.parentRef),initialIds:deal.hands,templateIndex:i,points:deal.points,level:deal.level,actor:deal.actor,mate:deal.mate,enemyHead:deal.enemyHead,enemy:deal.enemy,givers:deal.givers,sourceFamilyId:parent.sourceFamilyId,declaredRoundFamilyId:family});
  const variants=['A','B'].map(v=>makeVariant(parent,deal,v as 'A'|'B','r62-p10-family-'+parent.ordinal+'-'+v)),results=variants.map((v,j)=>{const dir=join(directory,j===0?'A':'B');mkdirSync(dir);return certify(config,dir,v);});
  let labels:any[]=[],novelRootVectors=0,duplicateGroup=false;
  if(results.every(r=>r.accepted)){
   const admitted=normalizeTeachingCards(results.map(r=>r.card),json(config.sourceIndexRef),'train');if(admitted.rejected.length||admitted.labels.length!==2)throw Error('actual paired strong admission failed');labels=admitted.labels;duplicateGroup=seenGroups.has(groupVector(labels));novelRootVectors=labels.filter(l=>!seenRoots.has(vector(l))).length;
   if(!duplicateGroup){seenGroups.add(groupVector(labels));labels.forEach(l=>seenRoots.add(vector(l)));newLabels.push(...labels);cards.push(...results.map(r=>r.card));}
  }
  const report={ordinal:parent.ordinal,templateIndex:i,points:deal.points,level:deal.level,actor:deal.actor,sourceFamilyId:parent.sourceFamilyId,declaredRoundFamilyId:family,replayedNativeGames:parent.replayedNativeGames,constructionDistribution:'declared deal with actual engine resistance; scripted legal burn, not natural frequency',givers:deal.givers,initialLeader:deal.initial.turn,results,acceptedForPool:results.every(r=>r.accepted)&&!duplicateGroup,duplicateGroup,novelRootVectors,vectorGroupSHA256:labels.length?groupVector(labels):null,encodedRootPairSHA256:labels.map(vector)};atomicJson(join(directory,'report.json'),report);reports.push(report);
 }
 writeFileSync(join(output,'new-cards.jsonl'),cards.map(c=>JSON.stringify(c)).join('\n')+(cards.length?'\n':''));atomicJson(join(output,'new-labels.json'),newLabels);
 const used=process.cpuUsage(cpu),summary={status:'completed',split:'train',familiesAttempted:reports.length,acceptedNewFamilies:reports.filter(r=>r.acceptedForPool).length,newStrongRoots:newLabels.length,actuallyNovelRootVectors:reports.filter(r=>r.acceptedForPool).reduce((s,r)=>s+r.novelRootVectors,0),reports,newSourceMatches:0,nativeReplayedGames:reports.reduce((s,r)=>s+r.replayedNativeGames,0),windowWallSeconds:(performance.now()-started)/1000,measuredCPUSeconds:(used.user+used.system)/1e6,workerTaskSeconds:0,externalPaidCalls:0,scope:'new train-family evidence only; no gradient updates, heldout scores or formal bank'};atomicJson(join(output,'summary.json'),summary);return summary;
}
