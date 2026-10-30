import{createHash}from'node:crypto';
import{readFileSync}from'node:fs';
import{resolve}from'node:path';
import{createMatch,startGame,DEFAULT_RULES,legalCombos,canPass,type GameState}from'@gd/engine';
import{deriveSeed,dedupCandidates,encodeAction}from'@gd/ai';
import{runCompleteMatch,indexedDealSeed,type PolicySpec,type SeatDriver,type PublicStep}from'./match-play';
import{toVisibleRoot}from'./visible-world';
import{necessaryDeclarationKey}from'./action-effect';
import{engineDealFamily}from'./capability-lineage';
import{fileHash,productCaseIds}from'./product-artifacts';
import{validatePolicyRegistry}from'./policy-registry';
import{writeNewJson}from'./runtime.mjs';
export const PILOT_SOURCE_DEAL_NAMESPACE='review6-teacher-pilot-source-deal-v1';
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function pilotSourceRows(){
 const categories=['cooperation_open','cooperation_urgent','resource_structure','context_sensitive_candidate'];
 return Array.from({length:48},(_,i)=>{const sourceSeed=deriveSeed('review6-teacher-pilot-source-v1',2026102804,i,'source-match'),firstDealSeed=indexedDealSeed(PILOT_SOURCE_DEAL_NAMESPACE,sourceSeed,0),familyId=engineDealFamily(startGame(createMatch({...DEFAULT_RULES},firstDealSeed)).hands);return{slot:i+1,rootId:'C3-pilot-source-001:root-'+String(i+1).padStart(2,'0'),sourceMatchId:'C3-pilot-source-001:match-'+String(i+1).padStart(2,'0'),sourceSeed,firstDealSeed,familyId,requestedActor:(Math.floor(i/4)+i%4)%4,category:categories[i%4],sourceKind:i%10>=7?'constructed_legal_trajectory':'student_trajectory',minimumOpponentCount:5+i%3,urgentOpponentMaximum:2+i%3,maxEligiblePositionTrials:64,selection:'first causally eligible represented root for this slot; one root maximum per source family; no replacement seeds'};});
}
export function rootCandidates(state:GameState){return dedupCandidates(legalCombos(state),canPass(state)).map((c,index)=>{const features=new Float32Array(68);encodeAction(c.combo,features,'action64');return{index,actionId:'action-'+String(index).padStart(4,'0'),actionKey:necessaryDeclarationKey(c.combo,state.ctx),move:c.combo?{pass:false,combo:structuredClone(c.combo)}:{pass:true},features68:Array.from(features)};});}
function matchesCategory(state:GameState,row:ReturnType<typeof pilotSourceRows>[number],candidates:ReturnType<typeof rootCandidates>){
 const actor=state.turn,mate=(actor+2)%4,opponents=[(actor+1)%4,(actor+3)%4],min=Math.min(...opponents.map(s=>state.hands[s].length)),controls=state.lastCombo!==null&&state.lastPlayer===mate,nonpass=candidates.filter(c=>!c.move.pass),pass=candidates.some(c=>c.move.pass),bombs=nonpass.filter(c=>['bomb','flush','joker_bomb'].includes(c.move.combo!.kind));
 if(candidates.length<2)return false;
 if(row.category==='resource_structure')return bombs.length>0&&nonpass.some(c=>!['bomb','flush','joker_bomb'].includes(c.move.combo!.kind));
 if(!controls||!pass||!nonpass.length)return false;
 if(row.category==='cooperation_open')return min>=row.minimumOpponentCount&&!opponents.some(s=>state.finished.includes(s))&&state.hands[mate].length<=state.hands[actor].length;
 if(row.category==='cooperation_urgent')return min<=row.urgentOpponentMaximum||nonpass.some(c=>c.move.combo!.size===state.hands[actor].length);
 return min>row.urgentOpponentMaximum&&min<row.minimumOpponentCount+3&&state.hands[mate].length>0;
}
/** Source generation only. It never supplies the actual hidden source layout
 * to the proposer or derives a world seed from the source family/trace. */
export function collectPilotSourceRoot(row:ReturnType<typeof pilotSourceRows>[number],sourcePolicy:PolicySpec,options:{seatFactory?:(spec:PolicySpec,seat:number)=>SeatDriver;deadlineMonotonicMs?:number;publicStage?:{minOwnCards:number;maxOwnCards:number;minMoveNo:number}}={}){
 let chosen:any=null,trials=0;const rejections:any[]=[],roundFamilies=new Map<number,string>();
 const result=runCompleteMatch({seed:row.sourceSeed,policies:Array.from({length:4},()=>sourcePolicy),dealMode:'indexed-deal-v1',dealNamespace:PILOT_SOURCE_DEAL_NAMESPACE,rngMode:'counter-per-decision',maxGames:80,maxMovesPerGame:2500,deadlineMonotonicMs:options.deadlineMonotonicMs,seatFactory:options.seatFactory,
 onBeforeDecision({state,seat,history}){
  if(!roundFamilies.has(state.match.gameNo)){const raw=startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(PILOT_SOURCE_DEAL_NAMESPACE,row.sourceSeed,state.match.gameNo-1)));roundFamilies.set(state.match.gameNo,engineDealFamily(raw.hands));}
  if(chosen||seat!==row.requestedActor||trials>=row.maxEligiblePositionTrials)return;
  if(options.publicStage&&(state.hands[seat].length<options.publicStage.minOwnCards||state.hands[seat].length>options.publicStage.maxOwnCards||state.moveNo<options.publicStage.minMoveNo))return;
  const candidates=rootCandidates(state);if(!matchesCategory(state,row,candidates))return;trials++;
  const observedBefore=toVisibleRoot(state,history);if(observedBefore.representationGaps.length){rejections.push({gameNo:state.match.gameNo,moveNo:state.moveNo,observationSHA256:observedBefore.observationSHA256,reasons:observedBefore.representationGaps});return;}
  chosen={schemaVersion:'r6-causal-teacher-root-v1',rootId:row.rootId,sourceMatchId:row.sourceMatchId,sourceFamilyId:row.familyId,sourceRootRoundFamilyId:roundFamilies.get(state.match.gameNo),sourceKind:row.sourceKind,actingSeat:seat,sourceState:structuredClone(state),sourceHistory:structuredClone(history),observedBefore,allCandidates:candidates,actualActionId:null,sourceActualAction:null,category:row.category,caseThresholds:{minimumOpponentCount:row.minimumOpponentCount,urgentOpponentMaximum:row.urgentOpponentMaximum},proposerInput:{rootId:row.rootId,observedBefore,allowedFacts:'only current own cards, public context and causal public prefix; source action and completion excluded',candidates:candidates.map(({features68,...c})=>c),category:row.category,caseThresholds:{minimumOpponentCount:row.minimumOpponentCount,urgentOpponentMaximum:row.urgentOpponentMaximum}}};
 },onAfterDecision({state,move}){if(chosen&&chosen.sourceActualAction===null&&state.match.gameNo===chosen.sourceState.match.gameNo&&state.moveNo===chosen.sourceState.moveNo+1){chosen.sourceActualAction=structuredClone(move);const key=necessaryDeclarationKey(move.pass?null:move.combo!,chosen.sourceState.ctx);chosen.actualActionId=chosen.allCandidates.find((c:any)=>c.actionKey===key)?.actionId??null;}}});
 if(chosen&&!chosen.actualActionId)rejections.push({reason:'source_actual_action_not_offered_no_target_injection'});
 const sourceCompletion={complete:result.complete,incompleteReason:result.incompleteReason,games:result.games,decisions:result.decisions,traceSHA256:result.traceSHA256,policyIds:result.policyIds,roundFamilies:[...roundFamilies].map(([gameNo,familyId])=>({gameNo,familyId}))};
 return{slot:row.slot,rootId:row.rootId,sourceFamilyId:row.familyId,sourceCompletion,eligiblePositionTrials:trials,rejections,root:result.complete&&chosen?.actualActionId?chosen:null,resultCode:!result.complete?'source_incomplete':chosen?.actualActionId?'root_materialized':'no_eligible_root_in_bounded_source'};
}
export function preparePilotSourcePlan(config:any,registryPath:string,output:string){
 const registry=validatePolicyRegistry(JSON.parse(readFileSync(registryPath,'utf8')));if(registry.selectedExperiment!=='direct_teacher_no_h')throw new Error('pilot source branch must match prelocked no_h');
 const capPath=resolve('lab/review6_1/capability/c2-draft-001/base-lineage-reservation-001.json'),cap=JSON.parse(readFileSync(capPath,'utf8')),humanLock=JSON.parse(readFileSync(config.data.sourceLockReceipt,'utf8'));
 if(fileHash(config.data.sourceLockReceipt)!==config.data.sourceLockReceiptHash)throw new Error('human source lock changed');for(const f of humanLock.files)if(fileHash(f.path)!==f.sha256)throw new Error('source evidence changed');
 const split=JSON.parse(readFileSync(humanLock.files.find((f:any)=>f.path.endsWith('split.lock.json')).path,'utf8')),excluded=new Set<string>([...split.rows.map((r:any)=>r.familyId),...cap.rows.map((r:any)=>r.familyId)]);
 for(const id of productCaseIds()){const{record}=JSON.parse(readFileSync(resolve(config.product.resultDirectory,'records',id+'.json'),'utf8'));excluded.add(engineDealFamily(record.initialHands));}
 const baseline=JSON.parse(readFileSync(config.data.developmentBaseline.planPath,'utf8'));for(const seed of new Set<number>(baseline.rows.map((r:any)=>r.matchSeed)))excluded.add(engineDealFamily(startGame(createMatch({...DEFAULT_RULES},seed)).hands));
 const rows=pilotSourceRows(),seen=new Set<string>();for(const row of rows){if(excluded.has(row.familyId)||seen.has(row.familyId))throw new Error('pilot source lineage collision; bounded queue cannot substitute a fresh seed');seen.add(row.familyId);}
 const result={schemaVersion:'r6-pilot-source-plan-v1',at:new Date().toISOString(),cycleId:config.cycleId,maxCandidateRoots:48,maxSourceMatches:48,maxRootsPerSourceFamily:1,maxEligiblePositionTrialsPerSource:64,minimumAdjudicatedRoots:12,minimumSupportedRoots:4,minimumSupportedSourceFamilies:3,requiredDirections:['pass_over_takeover','takeover_over_pass'],explorationWorlds:32,maxComparedCandidates:6,validatedPairsPerRoot:1,verificationWorlds:256,secondaryVerificationWorlds:128,bootstrapReplicates:20000,bootstrapProbabilities:[.0125,.9875],primaryLowerStrictlyAbove:.02,secondaryLowerStrictlyAbove:0,sourceDealNamespace:PILOT_SOURCE_DEAL_NAMESPACE,sourceStudentPolicyId:registry.cleanStudent,constructedSourcePolicyId:'review6-train-heuristic0-counter-v1',sourceComposition:{student:35,constructed:13,scope:'bounded pilot only; main no_h intake remains original70/0/30'},registry:{path:resolve(registryPath),sha256:fileHash(registryPath)},capabilityReservation:{path:capPath,sha256:fileHash(capPath)},excludedFamilyIds:[...excluded].sort(),rows,sourceFiles:['lab/review6/teacher-roots.ts','lab/review6/visible-world.ts','lab/review6/visible-schema.ts','lab/review6/plan-dsl.ts','lab/review6/match-play.ts','lab/review6/paired_stats.py'].map(path=>({path:resolve(path),sha256:fileHash(path)})),modelForwardCalls:0,teacherLabels:0,worldSeedRule:'independent purpose+preassigned slot+current own/public observationSHA only; never true hidden layout/source family/trace hash',selection:'root classification by public predecision criteria only; at most one per fixed source. No future action/outcome used for choosing the root.'};writeNewJson(output,result);return{path:resolve(output),sha256:fileHash(output),rows:rows.length,sourcePlanSHA256:hash(result),teacherLabels:0};
}
