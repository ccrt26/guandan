/** Replay one existing source; extract its first real A-stage parent. */
import{existsSync,mkdirSync}from'node:fs';import{join}from'node:path';
import{teamOf}from'@gd/engine';import{runCompleteMatch,type PublicStep}from'../review6/match-play';
import{toVisibleRoot}from'../review6/visible-world';import{rootCandidates}from'../review6/teacher-roots';
import{dealtFamilyBeforeExchange}from'../review6/training-ancestry';
import{HOME,json,fileHash,atomicJson,readRegistry,validatePolicy}from'./protocol';import{assertTerminalSourceScope,terminalSourceSpec}from'./terminal-source';

export function extractSealedAParent(config:any,sourceDirectory:string,output:string){
 assertTerminalSourceScope(config,'sealed');if(existsSync(output))throw Error('preserve old extracted parent output');
 const begin=performance.now(),cpu=process.cpuUsage(),manifestRef=join(sourceDirectory,'manifest.json'),sourceRecordRef=join(sourceDirectory,'source-6001.json'),m=json(manifestRef),source=json(sourceRecordRef),original=source.receipt;
 const registry=readRegistry(config),policy=registry.policies.find(p=>p.policyId===registry.cleanStudent)!;validatePolicy(policy);
 if(m.split!=='sealed'||m.offset!==6000||m.limit!==1||m.maxSources!==16||source.ordinal!==6001||source.identity!==m.identity||JSON.stringify(m.policy)!==JSON.stringify(policy)||original.complete!==true||original.winner!==0||original.games!==8||original.decisions!==695||original.traceSHA256!=='0124c562f769c54d5f5c23be4eccf9c1fc0c59ecfb1a49a61114086d50422bd0')throw Error('fixed original source6001 identity changed');
 const spec=terminalSourceSpec(config,6001,'sealed'),index=json(config.sourceIndexRef);if(spec.potentialFamilies.some(f=>index.families?.[f]?.split!=='sealed'))throw Error('existing sealed source ancestry changed');
 mkdirSync(output,{recursive:true});const moves:any[]=[],familySequence:string[]=[],seen=new Set<number>();let captured:any=null;
 const replay=runCompleteMatch({seed:spec.seed,dealNamespace:spec.dealNamespace,dealMode:'indexed-deal-v1',rngMode:'counter-per-decision',policies:[policy,policy,policy,policy],inferenceExecution:'exact-prefix-v1',maxGames:80,maxMovesPerGame:2500,deadlineMonotonicMs:performance.now()+config.windowSeconds*1000,
  onBeforeDecision({state,seat,history}){if(!seen.has(state.match.gameNo)){seen.add(state.match.gameNo);const family=dealtFamilyBeforeExchange(state);if(family!==spec.potentialFamilies[state.match.gameNo-1])throw Error('source replay actual family differs from fixed deal');familySequence.push(family);}if(captured||state.match.gameNo<2||state.match.winner!==null||state.levelsBefore[teamOf(seat)]!==14)return;
   const observedBefore=toVisibleRoot(state,history),root={rootId:'r62-sealed-a-parent-6001',slot:6001,sourceFamilyId:original.actualRoundFamilies[0],sourceRootRoundFamilyId:original.actualRoundFamilies[state.match.gameNo-1],category:'parent_source_only',observedBefore,allCandidates:rootCandidates(state),sourceKind:'existing_sealed_complete_source_replay'};
   captured={root,prefix:{schema:'native-a-stage-parent-source-v1',sourceSeed:spec.seed,dealNamespace:spec.dealNamespace,sourceFamilyId:original.actualRoundFamilies[0],rootGameNo:state.match.gameNo,moves:structuredClone(moves),rootObservationSHA256:observedBefore.observationSHA256}};
  },onAfterDecision({state,seat,move}){moves.push({gameNo:state.match.gameNo,actor:seat,move:structuredClone(move)});}});
 const reproduced=replay.complete&&replay.winner===original.winner&&replay.games===original.games&&replay.decisions===original.decisions&&replay.traceSHA256===original.traceSHA256&&JSON.stringify(familySequence)===JSON.stringify(original.actualRoundFamilies);
 atomicJson(join(output,'replay-result.json'),{replay,familySequence,reproduced,sourceRecordRef,sourceRecordSHA256:fileHash(sourceRecordRef),sourceManifestRef:manifestRef,sourceManifestSHA256:fileHash(manifestRef)});
 if(!reproduced)throw Error('original source6001 replay mismatch; keep evidence, no replacement');
 const roots:any[]=[];
 if(captured){const rootRef=join(output,'root.json'),prefixRef=join(output,'native-prefix.json'),receiptRef=join(output,'source-receipt.json');atomicJson(rootRef,captured.root);atomicJson(prefixRef,captured.prefix);atomicJson(receiptRef,original);
  atomicJson(join(output,'parent-source-binding.json'),{schema:'native-a-stage-parent-binding-v1',split:'sealed',rootSHA256:fileHash(rootRef),nativePrefixSHA256:fileHash(prefixRef),sourceRecordRef,sourceRecordSHA256:fileHash(sourceRecordRef),sourceManifestRef:manifestRef,sourceManifestSHA256:fileHash(manifestRef),sourceReceiptRef:receiptRef,sourceReceiptSHA256:fileHash(receiptRef),reproducedOriginalTrace:replay.traceSHA256,claim:'reachable A-stage parent source only; no terminal preference theorem or candidate score'});
  roots.push({rootRef,sourceFamilyId:captured.root.sourceFamilyId,rootGameNo:captured.prefix.rootGameNo,actor:captured.root.observedBefore.actor});
 }
 const used=process.cpuUsage(cpu),result={status:'completed',split:'sealed',roots,sources:[{ordinal:6001,complete:true,replayedExistingSource:true,actualGames:replay.games}],completeSourceMatches:0,replayedCompleteMatches:1,newIndependentSourceMatches:0,originalSourceBatchRef:join(sourceDirectory,'summary.json'),originalSourceBatchSHA256:fileHash(join(sourceDirectory,'summary.json')),wallSeconds:(performance.now()-begin)/1000,measuredProcessCPUSeconds:(used.user+used.system)/1e6,candidateScoresUsed:false,newGradientUpdates:0};atomicJson(join(output,'summary.json'),result);return result;
}
