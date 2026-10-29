import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {applyMove,teamOf,type GameResult} from '@gd/engine';
import {PublicTracker} from '@gd/ai';
import {codeOfCard,DEFAULT_MAPPING} from '../src/review5_tuning/kscbReplay';
import {buildSourceRound,inspectSourceAction,resourceEffectKey} from './data-replay';
import {streamHumanMatches} from './data-source';
import {fileHash} from './product-artifacts';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const writeNew=(path:string,data:unknown)=>writeFileSync(path,JSON.stringify(data,null,2)+'\n',{flag:'wx'});

export async function auditHumanData(config:any){
 const data=config.data,base=resolve(data.auditDirectory),out=resolve(data.replayDirectory);
 if(existsSync(out))throw new Error('replay output exists; refuse overwrite');
 if(fileHash(data.sourceLockReceipt)!==data.sourceLockReceiptHash||fileHash(data.planLock)!==data.planLockHash||fileHash(data.sourcePath)!==data.sourceSHA256)throw new Error('data source/split/plan anchor changed');
 const source=JSON.parse(readFileSync(data.sourceLockReceipt,'utf8'));
 for(const file of [...source.files,...source.sourceFiles])if(fileHash(file.path)!==file.sha256)throw new Error('mechanical source artifact changed');
 const split=JSON.parse(readFileSync(resolve(base,'split.lock.json'),'utf8')),splitOf=new Map(split.rows.map((r:any)=>[r.sourceMatchId,r]));
 mkdirSync(out,{recursive:false});const ledger=resolve(out,'replay-ledger.jsonl'),groups=resolve(out,'match-results.jsonl');writeFileSync(ledger,'',{flag:'wx'});writeFileSync(groups,'',{flag:'wx'});
 const started=Date.now(),totals={rawActions:0,compatibleActions:0,targetLegalActions:0,coveredCompatibleActions:0,usableBehaviorActions:0,outsidePrefixActions:0,unexplainedCandidateOmissions:0};
 const reasons:Record<string,number>={},overlaps:Record<string,number>={},classes:Record<string,number>={A:0,B:0,C:0},bySplit:Record<string,any>={};let completedMatches=0;
 for await(const item of streamHumanMatches(data.sourcePath)){
  if(Date.now()-started>900000)throw new Error('bounded mechanical audit exceeded 900 seconds; partial evidence retained');
  const record=item.record,identity:any=splitOf.get(record.sample_id);if(!identity)throw new Error('source match absent from split lock');
  let previous:GameResult|null=null,firstProblem:any=null,prefixHash=hash('initial-public-history'),compatible=0,rawCount=0,eligible=0;const roundReports:any[]=[];
  for(let roundIndex=0;roundIndex<record.rounds.length;roundIndex++){
   const round=record.rounds[roundIndex],tracker=new PublicTracker(),rows:any[]=[];let replayState:ReturnType<typeof buildSourceRound>|null=null;
   if(!firstProblem){
    try{if(previous?.passedA)throw new Error('source match continues after target match terminal');replayState=buildSourceRound(round,roundIndex,previous);prefixHash=hash(JSON.stringify([prefixHash,replayState.context,replayState.knownTransfers]));}
    catch(error){firstProblem={roundIndex,eventIndex:0,category:'context_or_exchange',reason:(error as Error).message};}
   }
   let actionIndex=0;
   for(let eventIndex=0;eventIndex<round.events.length;eventIndex++){
    const event=round.events[eventIndex];if(event.event_id!==3&&event.event_id!==4)continue;
    const key=`${record.sample_id}:${round.sample_id}:e${eventIndex}`,baseRow={decisionId:key,sourceMatchId:record.sample_id,familyId:identity.familyId,split:identity.split,sourceRoundId:round.sample_id,roundIndex,eventIndex,actionIndex:actionIndex++,actorUID:event.uid,rawCards:event.tiles??null,sourcePattern:event.pattern??null,mappingVersion:'kscb-rank-v1-SHDC-pattern-v3',actionEquivalenceVersion:'complete-resources-necessary-wild-effects-v1'};
    totals.rawActions++;rawCount++;
    if(firstProblem||!replayState){totals.outsidePrefixActions++;rows.push({...baseRow,targetRuleLegal:null,candidateCovered:null,usableForH:false,scope:'outside_verified_target_prefix',firstIncompatibleEvent:firstProblem});continue;}
    try{
     const state=replayState.state,actor=Number(event.uid.slice(1))-1,owner=state.lastCombo?state.lastPlayer:null;
     const audit=inspectSourceAction(state,event,tracker,[prefixHash],replayState.knownTransfers);
     const blockers=audit.reasons.filter(reason=>reason!=='enumerator_pruned_resource_variants');
     if(blockers.length)firstProblem={roundIndex,eventIndex,decisionId:key,category:audit.targetRuleLegal?'declaration_or_proposal':'rule_or_state',reason:blockers.join('+')};
     if(!firstProblem){
      const events=applyMove(state,event.event_id===4?{pass:true}:{pass:false,combo:audit.combo!});tracker.observe(events);
      prefixHash=hash(JSON.stringify([prefixHash,{actor,pass:event.event_id===4,action:resourceEffectKey(audit.combo)}]));
     }
     if(audit.targetRuleLegal)totals.targetLegalActions++;
     if(audit.reasons.includes('candidate_dedup_omission'))totals.unexplainedCandidateOmissions++;
     for(const reason of audit.reasons)reasons[reason]=(reasons[reason]??0)+1;
     if(audit.reasons.length){const combination=[...audit.reasons].sort().join('+');overlaps[combination]=(overlaps[combination]??0)+1;}
     if(!firstProblem){compatible++;totals.compatibleActions++;if(audit.candidateCovered)totals.coveredCompatibleActions++;}
     const usable=audit.usableForH&&!firstProblem&&identity.split!=='unusable';if(usable){eligible++;totals.usableBehaviorActions++;}
     rows.push({...baseRow,targetRuleLegal:audit.targetRuleLegal,sourceDeclarationCount:audit.declarationCount,targetPhysicalIds:audit.targetPhysicalIds,declaredActionKey:audit.declaredActionKey,rawDeclaredActionKey:audit.rawDeclaredActionKey,candidateCovered:audit.candidateCovered,candidateCount:audit.candidateKeys.length,candidateHash:hash(JSON.stringify(audit.candidateKeys)),targetEquivalentIndices:audit.targetIndices,
      equivalentTargetReason:'complete suit/rank resources and necessary declared effects; natural-rank self substitution/non-flush assignment-suit annotations normalized; nonnatural assigned ranks and flush suit retained',observationHash:audit.observationHash,observationHistoryBasis:'SHA256 chain of prior public moves and known exchanges, plus current legal actor view',context:replayState.context,capacityInference:audit.capacityInference,
      strata:{pass:event.event_id===4,nonpass:event.event_id===3,mateControl:owner!=null&&owner!==actor&&teamOf(owner)===teamOf(actor),bomb:audit.combo?.kind==='bomb',takeover:event.event_id===3&&owner!=null&&owner!==actor&&teamOf(owner)===teamOf(actor)},representationGaps:audit.representationGaps,reasons:audit.reasons,usableForH:usable,scope:'verified_legal_behavior_prefix_no_future_reward',firstIncompatibleEvent:firstProblem});
    }catch(error){
     firstProblem={roundIndex,eventIndex,decisionId:key,category:'strict_replay_exception',reason:(error as Error).message};
     const failed={...baseRow,targetRuleLegal:null,candidateCovered:null,usableForH:false,scope:'unverifiable_current_state',firstIncompatibleEvent:firstProblem};
     if(rows.at(-1)?.decisionId===key)rows[rows.length-1]=failed;else rows.push(failed);
    }
   }
   if(!firstProblem&&replayState){
    const state=replayState.state;
    try{
     if(!state.over||!state.result)throw new Error('source round does not reach target terminal');
     const sourceOrder=round.result.players.map(p=>({seat:Number(p.uid.slice(1))-1,rank:p.win_index===0?4:p.win_index})).sort((a,b)=>a.rank-b.rank).map(p=>p.seat);
     if(state.finished.some((seat,index)=>sourceOrder[index]!==seat))throw new Error('source terminal finishing prefix differs');
     for(const player of round.result.players){
      const seat=Number(player.uid.slice(1))-1,actual=state.hands[seat].map(c=>codeOfCard(c,DEFAULT_MAPPING)).sort((a,b)=>a!-b!);
      if(player.hand===null?actual.length!==0:JSON.stringify([...player.hand].sort((a,b)=>a-b))!==JSON.stringify(actual))throw new Error('source terminal remaining cards differ');
     }
     previous=state.result;
    }catch(error){firstProblem={roundIndex,eventIndex:round.events.length,category:'terminal',reason:(error as Error).message};}
   }
   if(rows.length!==actionIndex||new Set(rows.map(row=>row.decisionId)).size!==rows.length)throw new Error('one raw action must have exactly one ledger row');
   if(rows.length)appendFileSync(ledger,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
   roundReports.push({sourceRoundId:round.sample_id,roundIndex,rawActions:rows.length,verifiedToEvent:firstProblem?.roundIndex===roundIndex?firstProblem.eventIndex:!firstProblem?round.events.length:null,firstProblem});
  }
  if(!firstProblem&&!previous?.passedA)firstProblem={roundIndex:record.rounds.length,eventIndex:0,category:'promotion_match_terminal',reason:'source trace does not reach target promotion-match terminal; behavior prefix only'};
  const category=firstProblem?(compatible>0?'B':'C'):'A';classes[category]++;
  const group={sourceMatchId:record.sample_id,familyId:identity.familyId,split:identity.split,category,rawActions:rawCount,compatiblePrefixActions:compatible,eligibleBehaviorActions:eligible,firstIncompatibleEvent:firstProblem,rounds:roundReports,behaviorOnly:category!=='A',futureOutcomeLabelsConsumed:false};appendFileSync(groups,JSON.stringify(group)+'\n');
  const counts=bySplit[identity.split]??={matches:0,rawActions:0,compatibleActions:0,usableBehaviorActions:0};counts.matches++;counts.rawActions+=rawCount;counts.compatibleActions+=compatible;counts.usableBehaviorActions+=eligible;completedMatches++;
  if(completedMatches%100===0)process.stdout.write(JSON.stringify({progress:'mechanical_only',completedMatches,rawActions:totals.rawActions,compatibleActions:totals.compatibleActions,elapsedSeconds:(Date.now()-started)/1000})+'\n');
 }
 if(completedMatches!==1305||totals.rawActions!==1217604)throw new Error('fixed raw source denominator incomplete');
 if(fileHash(data.sourcePath)!==data.sourceSHA256)throw new Error('source changed during strict audit');
 const files=[ledger,groups].map(path=>({path,sha256:fileHash(path)}));
 const result={schemaVersion:'r6-rule-domain-report-v1',at:new Date().toISOString(),stageStatus:'completed',resultCode:'rule_domain_audit_h_quality_pending',completedMatches,totals,classes,bySplit,reasons,overlappingReasonCombinations:overlaps,sourceLockReceiptHash:data.sourceLockReceiptHash,planLockHash:data.planLockHash,files,
  sourceFiles:['lab/review6/data-replay.ts','lab/review6/data-audit.ts','lab/review6/action-effect.ts'].map(path=>({path:resolve(path),sha256:fileHash(path)})),activeWallSeconds:(Date.now()-started)/1000,modelScoresOpened:false,HQuality:'not_measured_for_this_audit',priorHQualityReceipt:config.data.humanProxyQualityReceipt??null,actionEquivalenceVersion:'complete-resources-necessary-wild-effects-v1',consumptionRule:'Only explicit usableForH rows, joined to locked train/dev/holdout split. B supplies legal behavior prefixes only; no incompatible future outcomes. C never consumed. The prior once-only unqualified H retains its original valid selected subset and is not refitted after this mechanical correction.',fullSourceDenominatorKept:true};
 writeNew(resolve(out,'rule-domain-report.json'),result);writeNew(resolve(out,'candidate-coverage.json'),{schemaVersion:'r6-candidate-coverage-v1',totals,reasons,overlappingReasonCombinations:overlaps,unexplainedOmissions:totals.unexplainedCandidateOmissions,policySupport:'research dedupCandidates v3, without target-dependent injection',sourceLegalityIndependent:true});
 return result;
}
