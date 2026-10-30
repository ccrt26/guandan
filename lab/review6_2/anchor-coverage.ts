/** Fixed existing native training prefixes, no new policy simulation. */
import{existsSync,mkdirSync}from'node:fs';import{join}from'node:path';
import{createMatch,startGame,applyMove,DEFAULT_RULES}from'@gd/engine';
import{resolveLegalMove,indexedDealSeed,type PublicStep}from'../review6/match-play';import{dealtFamilyBeforeExchange}from'../review6/training-ancestry';
import{toVisibleRoot}from'../review6/visible-world';import{rootCandidates}from'../review6/teacher-roots';
import{HOME,ROOT,json,fileHash,atomicJson}from'./protocol';

export function anchorRounds(n:number){if(!Number.isSafeInteger(n)||n<4||n>=80)throw Error('four distinct completed native rounds required');return[1,1+Math.floor((n-1)/3),1+Math.floor(2*(n-1)/3),n];}
export function assertAnchorCoverage(anchors:any[],index:any){
 if(anchors.length!==64||new Set(anchors.map(a=>a.rootId)).size!==64||new Set(anchors.map(a=>a.sourceFamilyId)).size!==4||new Set(anchors.map(a=>a.sourceFamilyId+':'+a.gameNo)).size!==16||[0,1,2,3].some(s=>anchors.filter(a=>a.seat===s).length!==16))throw Error('fixed64 anchors/four families/sixteen rounds/seat16 required');
 for(const a of anchors){if(index.families?.[a.sourceFamilyId]?.split!=='train'||index.families?.[a.roundFamilyId]?.split!=='train'||a.sourceBehaviorWeightsSHA256!=='d5ff100135d969591f92435d02f3af0ef3554fb99b3ac959c23d8ee26894ca01'||!a.features399?.length||a.features399.length!==a.candidateActionKeys?.length||a.features399.some((v:any)=>v.length!==399||v.some((x:any)=>!Number.isFinite(x))))throw Error('anchor source/target/features invalid');}
}
export function buildAnchorCoverage(config:any,output:string){
 if(existsSync(output))throw Error('preserve existing anchor data');const begin=performance.now(),cpu=process.cpuUsage(),index=json(config.sourceIndexRef),collection=join(HOME,'data/p10-native-parents-001'),anchors:any[]=[],records:any[]=[];
 const manifest=json(join(collection,'manifest.json'));if(manifest.policy.weightsSHA256!=='d5ff100135d969591f92435d02f3af0ef3554fb99b3ac959c23d8ee26894ca01'||manifest.policy.epsilon!==0)throw Error('fixed native frozen U0 source required');
 for(const ordinal of[5011,5012,5017,5018]){
  const dir=join(collection,'root-'+ordinal),rootRef=join(dir,'root.json'),prefixRef=join(dir,'native-prefix.json'),binding=json(join(dir,'bound.json')),p=json(prefixRef),root=json(rootRef),n=p.rootGameNo-1;
  if(fileHash(rootRef)!==binding.rootSHA256||fileHash(prefixRef)!==binding.nativePrefixSHA256||p.schema!=='native-terminal-prefix-v1'||root.slot!==ordinal||root.sourceFamilyId!==p.sourceFamilyId||index.families?.[p.sourceFamilyId]?.split!=='train')throw Error('fixed native train parent changed');
  const prefixSHA256=fileHash(prefixRef),rootSHA256=fileHash(rootRef),selectedRounds=anchorRounds(n),match=createMatch({...DEFAULT_RULES},p.sourceSeed),families:string[]=[];let at=0;
  for(let gameNo=1;gameNo<=n;gameNo++){
   if(match.winner!==null)throw Error('native prefix continues after match terminal');match.rngState=indexedDealSeed(p.dealNamespace,p.sourceSeed,match.gameNo);const state=startGame(match),history:PublicStep[]=[],seen=new Set<number>(),roundFamilyId=dealtFamilyBeforeExchange(state);families.push(roundFamilyId);
   if(index.families?.[roundFamilyId]?.split!=='train')throw Error('native anchor parent contains foreign family');
   while(at<p.moves.length&&p.moves[at].gameNo===gameNo){
    const row=p.moves[at++];if(state.over||state.turn!==row.actor)throw Error('native anchor actor/round history changed');
    if(selectedRounds.includes(gameNo)&&!seen.has(row.actor)){seen.add(row.actor);const observed=toVisibleRoot(state,history),candidates=rootCandidates(state);
     anchors.push({rootId:'r62-p13-anchor:'+ordinal+':g'+gameNo+':p'+row.actor,matchId:'existing-native-source-'+ordinal,sourceOrdinal:ordinal,sourceFamilyId:p.sourceFamilyId,roundFamilyId,gameNo,seat:row.actor,levelsBefore:[...state.levelsBefore],moveNo:state.moveNo,candidateActionKeys:candidates.map(c=>c.actionKey),features399:candidates.map(c=>[...observed.modelState331,...c.features68]),sourceBehaviorWeightsSHA256:manifest.policy.weightsSHA256,sourcePrefixRef:prefixRef,sourcePrefixSHA256:prefixSHA256});
    }
    const priorTarget=structuredClone(state.lastCombo),events=applyMove(state,resolveLegalMove(state,row.move)as any);history.push({events,priorTarget});
   }
   if(!state.over||selectedRounds.includes(gameNo)&&seen.size!==4)throw Error('native anchor completed round/first-seat coverage missing');
  }
  if(families[0]!==p.sourceFamilyId||at!==p.moves.filter((r:any)=>r.gameNo<=n).length||match.winner!==null)throw Error('native anchor ancestry/parent completion changed');
  records.push({ordinal,sourceFamilyId:p.sourceFamilyId,rootRef,rootSHA256,prefixRef,prefixSHA256,n,selectedRounds,replayedRoundFamilies:families,selectedRoots:anchors.filter(a=>a.sourceOrdinal===ordinal).length});
 }
 assertAnchorCoverage(anchors,index);mkdirSync(output,{recursive:true});const anchorsRef=join(output,'anchors.json');atomicJson(anchorsRef,anchors);
 const used=process.cpuUsage(cpu),planRef=join(ROOT,'docs/superpowers/plans/2026-10-30-guandan-review6-2-p13-anchor-coverage.md'),result={status:'completed',split:'train',anchorCount:64,sourceFamilyCount:4,selectedRoundCount:16,seatCounts:Object.fromEntries([0,1,2,3].map(s=>[s,anchors.filter(a=>a.seat===s).length])),candidateRows:anchors.reduce((n,a)=>n+a.features399.length,0),anchorsRef,anchorsSHA256:fileHash(anchorsRef),planRef,planSHA256:fileHash(planRef),records,replayedNativeRounds:records.reduce((n,r)=>n+r.n,0),newSourceMatches:0,newGradientUpdates:0,wallSeconds:(performance.now()-begin)/1000,measuredProcessCPUSeconds:(used.user+used.system)/1e6,scope:'multi-family/multi-round opening states only; fixed64/U0 target/.01, not full-phase coverage'};atomicJson(join(output,'summary.json'),result);return result;
}

export function continuationAnchorReplacement(config:any,old:any,checkpoint:string,state:any){
 if(!config.anchorUpgradeRef){if(config.anchorSetRef||config.anchorSetSHA256)throw Error('anchor-set replacement requires explicit reviewed manifest');return null;}
 const e=json(config.experimentRef),m=json(config.anchorUpgradeRef);
 if(fileHash(config.anchorUpgradeRef)!==config.anchorUpgradeSHA256||e.anchorUpgradeRef!==config.anchorUpgradeRef||e.anchorUpgradeSHA256!==config.anchorUpgradeSHA256||m.kind!=='replace-anchor-inputs-v1'||m.fromRun!==config.fromRun||m.fromUpdate!==state.absoluteUpdate||m.fromIdentity!==old.identity||m.fromCheckpoint!==checkpoint||m.fromCheckpointSHA256!==fileHash(join(checkpoint,'manifest.json'))||m.fromManifestSHA256!==fileHash(join(HOME,'runs',config.fromRun,'manifest.json')))throw Error('anchor replacement parent/experiment changed');
 if(config.updateTarget!==state.absoluteUpdate||m.oldRef!==join(HOME,'runs',config.fromRun,'anchors.json')||fileHash(m.oldRef)!==m.oldSHA256||state.anchorsSHA256!==m.oldSHA256||m.newRef!==config.anchorSetRef||m.newSHA256!==config.anchorSetSHA256||fileHash(m.newRef)!==m.newSHA256||m.targetParentSHA256!==old.parent.weightsSHA256||m.targetParentSHA256!=='d5ff100135d969591f92435d02f3af0ef3554fb99b3ac959c23d8ee26894ca01'||fileHash(m.sourceSummaryRef)!==m.sourceSummarySHA256)throw Error('anchor replacement data/target changed');
 const a=json(m.oldRef),b=json(m.newRef),source=json(m.sourceSummaryRef);if(a.length!==64||source.status!=='completed'||source.split!=='train'||source.anchorsRef!==m.newRef||source.anchorsSHA256!==m.newSHA256||source.anchorCount!==64||source.sourceFamilyCount!==4||source.selectedRoundCount!==16)throw Error('fixed anchor coverage source required');
 const index=json(config.sourceIndexRef);assertAnchorCoverage(b,index);for(const r of source.records)if(fileHash(r.rootRef)!==r.rootSHA256||fileHash(r.prefixRef)!==r.prefixSHA256||r.replayedRoundFamilies.some((f:string)=>index.families?.[f]?.split!=='train'))throw Error('anchor native source/provenance changed');
 return{manifestRef:config.anchorUpgradeRef,manifestSHA256:config.anchorUpgradeSHA256,oldSHA256:m.oldSHA256,newRef:m.newRef,newSHA256:m.newSHA256};
}
