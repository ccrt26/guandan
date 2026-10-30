/** Shared evidence admission. Original 256/128 rollout branch stays intact. */
import{readFileSync,mkdirSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';import{join}from'node:path';import{isDeepStrictEqual}from'node:util';
import{assertStrongEvidence}from'./evidence';import{deriveTerminalBound,replayNativePrefix}from'./terminal-proof';
import{assertDeclaredEvidence}from'./declared-proof';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const base=fileURLToPath(new URL('../../',import.meta.url));
const FILES=['lab/review6_2/teaching-evidence.ts','lab/review6_2/terminal-proof.ts','lab/review6/visible-world.ts','lab/review6/teacher-roots.ts','lab/review6/match-play.ts','lab/review6/action-effect.ts','packages/ai/src/nn/schema.ts','packages/ai/src/nn/neuralSeat.ts',...['index','game','combo','deck','rank','rng','types'].map(p=>'packages/engine/src/'+p+'.ts')];
const sources=()=>FILES.map(path=>({path,sha256:sha(join(base,path))}));
const keyOf=(r:any)=>createHash('sha256').update(JSON.stringify([r.sourceFamilyId,r.observedBefore.matchPublic.gameNo,r.observedBefore.statePublic.moveNo,r.observedBefore.actor,r.observedBefore.observationSHA256])).digest('hex');

export function assertTeachingEvidence(card:any,root:any,key:string,index:any,split:string){
 if(card.sourceFamilyId!==root.sourceFamilyId)throw Error('teaching evidence source family differs from native root');
 if(card.evidenceKind==='declared-deal-target-bound-v1')return assertDeclaredEvidence(card,root,key,index,split);
 if(card.evidenceKind!=='full-target-interval-bound-v1'){
  if(card.evidenceKind||card.proofRef||card.proofSHA256)throw Error('unknown/mixed teaching evidence kind');
  return assertStrongEvidence(card,root,key);
 }
 const pairs=card.pairs??[{preferredActionId:card.preferredActionId,otherActionId:card.otherActionId}];
 if(pairs.length!==1||card.statisticsRef||card.statisticsRefs||card.evidenceTier!=='strong'||card.split!==split||!['train','dev','sealed'].includes(split)||!card.proofRef||sha(card.proofRef)!==card.proofSHA256)throw Error('single-pair bound proof contract required');
 const c=read(card.proofRef);
 if(c.schema!=='terminal-bound-certificate-v1'||c.evidenceKind!==card.evidenceKind||c.scope!=='root_action_only'||c.split!==split||c.rootKey!==key||key!==keyOf(root)||c.rootSHA256!==sha(card.rootRef)||c.rootRef!==card.rootRef||!isDeepStrictEqual(c.sourceFiles,sources()))throw Error('terminal proof identity/engine/source changed');
 if(sha(c.nativePrefixRef)!==c.nativePrefixSHA256||sha(c.sourceReceiptRef)!==c.sourceReceiptSHA256)throw Error('terminal proof witness changed');
 const prefix=read(c.nativePrefixRef),replay=replayNativePrefix(prefix),bound=deriveTerminalBound(prefix),receipt=read(c.sourceReceiptRef);
 // Saved roots use JSON wire semantics: optional undefined combo fields are omitted.
 if(!isDeepStrictEqual(root.observedBefore,JSON.parse(JSON.stringify(replay.observed)))||!isDeepStrictEqual(root.allCandidates,JSON.parse(JSON.stringify(replay.candidates)))||root.sourceFamilyId!==prefix.sourceFamilyId||root.sourceRootRoundFamilyId!==replay.prefixFamilies.at(-1))throw Error('terminal root public/features/actions differ from native replay');
 if(receipt.complete!==true||!Number.isSafeInteger(receipt.games)||receipt.games<prefix.rootGameNo||receipt.actualRoundFamilies?.length!==receipt.games||!isDeepStrictEqual(receipt.actualRoundFamilies.slice(0,replay.prefixFamilies.length),replay.prefixFamilies))throw Error('terminal source receipt/prefix family mismatch');
 if([...replay.prefixFamilies,...receipt.actualRoundFamilies].some(f=>index.families?.[f]?.split!==split))throw Error('terminal proof prefix/source family split mismatch');
 if(!isDeepStrictEqual(c.bound,bound)||bound.preferredActionId!==pairs[0].preferredActionId||bound.otherActionId!==pairs[0].otherActionId||bound.normalizedDifferenceLowerBound<=.02||bound.plus.y!==3||bound.minus.completeMatch!==false||bound.minus.W!==null)throw Error('terminal complete-target bound/action mismatch');
 return bound;
}

export function certifyTerminalRoot(rootDirectory:string,output:string,indexRef:string){
 const rootRef=join(rootDirectory,'root.json'),nativePrefixRef=join(rootDirectory,'native-prefix.json'),sourceReceiptRef=join(rootDirectory,'source-receipt.json'),root=read(rootRef),bound=deriveTerminalBound(read(nativePrefixRef)),proofRef=join(output,'certificate.json');mkdirSync(output,{recursive:true});
 const certificate={schema:'terminal-bound-certificate-v1',evidenceKind:'full-target-interval-bound-v1',scope:'root_action_only',split:'train',rootRef,rootSHA256:sha(rootRef),rootKey:keyOf(root),nativePrefixRef,nativePrefixSHA256:sha(nativePrefixRef),sourceReceiptRef,sourceReceiptSHA256:sha(sourceReceiptRef),sourceFiles:sources(),bound};
 writeFileSync(proofRef,JSON.stringify(certificate)+'\n');
 const card={labelId:'r62-terminal-proof:'+keyOf(root),split:'train',sourceFamilyId:root.sourceFamilyId,sourceKind:'rule',preference:'prefer',evidenceTier:'strong',evidenceKind:'full-target-interval-bound-v1',rootRef,rootSHA256:sha(rootRef),preferredActionId:bound.preferredActionId,otherActionId:bound.otherActionId,proofRef,proofSHA256:sha(proofRef),rationale:'原生公开前提下，出完立即完整y=3；PASS仅本副g=1，任何已完成整场y∈{0,2}。完整目标域差至少1，不声称PASS已完成或必终止。'};
 assertTeachingEvidence(card,root,keyOf(root),read(indexRef),'train');writeFileSync(join(output,'cards.jsonl'),JSON.stringify(card)+'\n');return{proofRef,cardsRef:join(output,'cards.jsonl'),rootKey:keyOf(root),bound,claim:'certified conditional root preference; no model improvement claim'};
}
