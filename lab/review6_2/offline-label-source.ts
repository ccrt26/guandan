/** Read an originally captured decision, never re-enumerate/rescore a pool.
 * Replay reconstructs only prior confirmed history; teacher choices never step. */
import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {loadMatchStore,replayConfirmedMatch,hashJSON,type MatchStoreRef,type MatchRecord} from './match-record';
import {buildObservation} from '../../packages/ai/src/hybrid/observation';
import {canonicalActionId,resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import {freezeCopy,type DecisionBundle,type DecisionKey,type PublicHistoryPrefix} from '../../packages/ai/src/hybrid/protocol';
import {selectRemoteDecision,type RemoteRequest} from '../../packages/ai/src/hybrid/remote-selector';
import {prepareOfflineLabel,type DecisionInput,type DatasetIdentities} from './distill-data';
export interface SelectedRecordedDecision {recordRef:MatchStoreRef;recordRoot:string;key:DecisionKey;inputSHA256:string;familyId:string;split:'train'|'dev';actorSeat:number}
export function readOfflineSnapshot(row:SelectedRecordedDecision,cache=new Map<string,ReturnType<typeof loadMatchStore>>()){
 const cacheKey=hashJSON([row.recordRef,row.recordRoot]);let store=cache.get(cacheKey);if(!store){store=loadMatchStore(row.recordRef,row.recordRoot);cache.set(cacheKey,store);}
 const {record,privateSources}=store.recorder.snapshot(),decision=record.decisions.find(d=>isDeepStrictEqual(d.key,row.key)),game=record.games.find(g=>g.gameNo===row.key.gameNo);
 if(!decision||decision.executionKind!=='confirmed'||!['selected','fallback'].includes(decision.status)||!game||game.sourceFamilyId!==row.familyId||record.split!==row.split||record.evaluatedActor!==row.actorSeat||row.key.actorSeat!==row.actorSeat||!['train','dev'].includes(row.split)||decision.trainingInputSHA256!==row.inputSHA256)throw Error('offline source/actor/family/confirmed-decision mismatch');
 const path=join(row.recordRef.directory,`decision-${row.key.requestSeq}.private.json`);if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||(lstatSync(path).mode&0o777)!==0o600)throw Error('private decision requires exact 0600 regular file');
 const input=JSON.parse(readFileSync(path,'utf8')) as DecisionInput&{selectionBundle?:DecisionBundle};
 if(hashJSON(input)!==row.inputSHA256||!isDeepStrictEqual(input.key,row.key)||!input.selectionBundle)throw Error('missing original complete selection bundle or input identity');
 const bundle=freezeCopy(input.selectionBundle);
 if(!isDeepStrictEqual(bundle.key,row.key)||bundle.decisionId!==input.observation.decisionId||bundle.expansionCount!==0||bundle.candidateSpec!==input.candidateSpec||!isDeepStrictEqual(bundle.observation,input.observation)||!isDeepStrictEqual(bundle.pool,input.pool)||!isDeepStrictEqual(bundle.initialCandidateIds,input.initialCandidateIds)||!isDeepStrictEqual(bundle.offeredIds,input.initialCandidateIds)||!bundle.initialCandidateIds.includes(bundle.fallbackActionId)||typeof bundle.isUniqueLegalAction!=='boolean'||!bundle.pool.length)throw Error('original bundle/candidate provenance differs');
 const earlier=record.decisions.filter(d=>d.key.gameNo<row.key.gameNo||d.key.gameNo===row.key.gameNo&&d.key.requestSeq<row.key.requestSeq);
 const prefixRecord:MatchRecord={...record,games:record.games.filter(g=>g.gameNo<=row.key.gameNo),decisions:earlier,summary:null};
 const replay=replayConfirmedMatch(prefixRecord,{...privateSources,games:privateSources.games.filter(g=>g.gameNo<=row.key.gameNo)}),state=replay.state;
 if(replay.executionUnknown||!state||state.over||state.moveNo!==row.key.moveNo||state.turn!==row.actorSeat||state.match.gameNo!==row.key.gameNo)throw Error('offline confirmed causal origin unavailable');
 const history:PublicHistoryPrefix={matchId:row.key.matchId,gameNo:row.key.gameNo,throughMoveNo:row.key.moveNo,steps:earlier.filter(d=>d.key.gameNo===row.key.gameNo&&d.executionKind==='confirmed').map(d=>({priorTarget:d.priorTarget,events:d.events}))};
 if(!isDeepStrictEqual(buildObservation({state,actorSeat:row.actorSeat,matchId:row.key.matchId,decisionId:bundle.decisionId,history}),input.observation))throw Error('offline original observation differs');
 for(const candidate of bundle.pool){resolveLegalMove(state,candidate.canonical===null?{pass:true}:{pass:false,combo:candidate.canonical});if(canonicalActionId(candidate.canonical,state.ctx)!==candidate.canonicalId)throw Error('offline original canonical differs');}
 return {row,record,decision,input,bundle,state,history};
}
export type OfflineSnapshot=ReturnType<typeof readOfflineSnapshot>;
/** Selection only: no PendingDecision, owner.apply, policy forward or fallback.
 * This guard is explicit because B04's pure selector does not skip unique. */
export async function queryOfflineTeacher({snapshot,teacher,request,signal}:{snapshot:OfflineSnapshot;teacher:DatasetIdentities['teacher'];request:RemoteRequest;signal:AbortSignal}){
 if(snapshot.bundle.isUniqueLegalAction)return {status:'excluded_unique' as const,remote:null,offlineLabel:null};
 const remote=await selectRemoteDecision({bundle:snapshot.bundle,request,signal});
 const offlineLabel=prepareOfflineLabel({input:snapshot.input,remote,state:snapshot.state,history:snapshot.history,teacher});
 return {status:remote.status,remote,offlineLabel};
}
