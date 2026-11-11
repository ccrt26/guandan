/** Actual committed engine actions are the record. Public output never contains
 * deals/state/RNG/other-seat hands; recovery sources are separate local data. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {applyMove,type GameState,type Move,type EngineEvent,type RuleOptions,type Combo} from '@gd/engine';
import {encodeState,encodeStateV2,encodeAction,PublicTracker,STATE_DIM,STATE_DIM_V2,INPUT_DIM,INPUT_DIM_V2,encodeStudentInput399Plus24} from '../../packages/ai/src/nn/schema';
import type {MLP} from '../../packages/ai/src/nn/mlp';
import {captureStudent423InitialCandidates} from '../../packages/ai/src/hybrid/student';
import {buildPublicHighCardMemory,type PublicHighCardMemory} from '../../packages/ai/src/nn/publicMemory';
import {STUDENT_SCORER_ENCODER,validateStudentScorerDescriptor,type StudentScorerDescriptor} from '../../packages/ai/src/policy/descriptor';
import type {EncoderOpts} from '../../packages/ai/src/nn/neuralSeat';
import {candidatePolicyForBundle,resolveCandidatePolicy,FIRST_TARGET_CANDIDATE_SPEC,type CandidatePolicySpec} from '../../packages/ai/src/candidate-spec';
import type {ResolvedPolicy} from '../../packages/ai/src/policy/resolve';
import {resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import {freezeCopy,type DecisionKey,type DecisionBundle,type PublicHistoryPrefix} from '../../packages/ai/src/hybrid/protocol';

export const hashJSON=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type SavedState=Omit<GameState,'ctx'>&{ctx:Omit<GameState['ctx'],'ranks'>&{ranks:number[]}};
export function saveState(state:GameState):SavedState{return structuredClone({...state,ctx:{...state.ctx,ranks:[...state.ctx.ranks]}});}
export function restoreState(state:SavedState):GameState{return {...structuredClone(state),ctx:{...structuredClone(state.ctx),ranks:new Set(state.ctx.ranks)}} as GameState;}
export interface RecordIdentity {runId:string;matchId:string;sourceRef:string;layoutRef:string;policyIds:string[];rules:RuleOptions;seatSnapshots?:unknown[];sourceFamilyId?:string;split?:string;evaluatedActor?:number}
export interface PrivateSources {schema:'ohuo-private-replay-v1';matchId:string;sourceRef:string;games:Array<{gameNo:number;state:SavedState}>}
export interface RecordedDecision {
 key:DecisionKey;policyId:string;initialCandidateIds:string[];offeredIds:string[];requestedActionId:string|null;actualActionId:string|null;
 actualMove:Move|null;actualSource:string|null;status:'pending'|'selected'|'fallback'|'cancelled'|'halted';reason:string|null;
 executionKind:'none'|'confirmed'|'unknown';trainingInputSHA256:string|null;elapsedMs:number|null;requests:Array<{requestCount:number|null;[key:string]:unknown}>;
 priorTarget:Combo|null;events:EngineEvent[];
}
export interface MatchRecord extends RecordIdentity {
 schema:'ohuo-confirmed-match-v1';games:Array<{gameNo:number;sourceSHA256:string;levelsBefore:[number,number];tribute:GameState['tribute'];sourceFamilyId?:string}>;
 decisions:RecordedDecision[];summary:{complete:boolean;winner:0|1|null;incompleteReason:string|null}|null;
}
const keyOf=(k:DecisionKey)=>JSON.stringify(k);
const canonicalCombo=(c:Combo):Combo=>({kind:c.kind,cards:c.cards.map(({id,suit,rank})=>({id,suit,rank})),size:c.size,keyRank:c.keyRank,length:c.length,pairRanks:[...c.pairRanks],mainRank:c.mainRank,...(c.suit===undefined?{}:{suit:c.suit}),wildAs:c.wildAs.map(({cardId,asRank,asSuit})=>({cardId,asRank,asSuit}))});
const publicResult=(r:any)=>({finishOrder:[...r.finishOrder],winnerTeam:r.winnerTeam,doubleUp:r.doubleUp,levelsAfter:[...r.levelsAfter] as [number,number],upgrade:r.upgrade,passedA:r.passedA});
/** Engine events are reconstructed by whitelist; a deal can never cross. */
export function publicEngineEvents(events:EngineEvent[]):EngineEvent[]{return events.map(e=>{
 switch(e.type){
  case 'play':return {type:'play',player:e.player,combo:canonicalCombo(e.combo)};
  case 'pass':return {type:'pass',player:e.player};
  case 'finish':return {type:'finish',player:e.player,order:e.order};
  case 'trickEnd':return {type:'trickEnd',nextLeader:e.nextLeader};
  case 'gameEnd':return {type:'gameEnd',result:publicResult(e.result)};
  default:throw Error('private/unknown engine event forbidden in public record');
 }
});}
function actionFrom(events:EngineEvent[],key:DecisionKey,move:Move){
 const actions=events.filter(e=>e.type==='play'||e.type==='pass');
 if(actions.length!==1||actions[0].player!==key.actorSeat)throw Error('actual action event identity mismatch');
 const actual=actions[0].type==='pass'?{pass:true}:{pass:false,combo:actions[0].combo};
 if(!isDeepStrictEqual(actual,move.pass?{pass:true}:{pass:false,combo:canonicalCombo(move.combo)}))throw Error('requested move is not actual engine action');
}
export class MatchRecorder {
 private record:MatchRecord;private sources:PrivateSources;
 constructor(identity:RecordIdentity,private readonly persist?:(change:{type:'game'|'decision'|'summary';value:any;privateSource?:SavedState;privateDecision?:unknown})=>void){
  if(identity.policyIds.length!==4||!identity.matchId||!identity.sourceRef)throw Error('fixed record identity required');
  this.record={...structuredClone(identity),schema:'ohuo-confirmed-match-v1',games:[],decisions:[],summary:null};
  this.sources={schema:'ohuo-private-replay-v1',matchId:identity.matchId,sourceRef:identity.sourceRef,games:[]};
 }
 static restore(record:MatchRecord,sources:PrivateSources,persist?:ConstructorParameters<typeof MatchRecorder>[1]){
  replayMatchResume({record,privateSources:sources});const recorder=new MatchRecorder(record,persist);recorder.record=structuredClone(record);recorder.sources=structuredClone(sources);return recorder;
 }
 snapshot(){return {record:structuredClone(this.record),privateSources:structuredClone(this.sources)};}
 private flush(type:'game'|'decision'|'summary',value:any,privateSource?:SavedState,privateDecision?:unknown){this.persist?.({type,value:structuredClone(value),...(privateSource?{privateSource}: {}),...(privateDecision?{privateDecision}: {})});}
 beginGame(state:GameState,sourceFamilyId?:string){
  if(state.moveNo!==0||state.over||state.pendingReturns.length||this.record.games.some(g=>g.gameNo===state.match.gameNo)||!isDeepStrictEqual(state.match.opts,this.record.rules))throw Error('new game source/rules identity mismatch');
  const saved=saveState(state);this.sources.games.push({gameNo:state.match.gameNo,state:saved});
  this.record.games.push({gameNo:state.match.gameNo,sourceSHA256:hashJSON(saved),levelsBefore:[...state.levelsBefore],tribute:structuredClone(state.tribute),...(sourceFamilyId?{sourceFamilyId}:{})});this.flush('game',this.record.games.at(-1),saved);
 }
 beginDecision(input:{key:DecisionKey;policyId:string;initialCandidateIds:readonly string[];offeredIds:readonly string[];bundle?:DecisionBundle;candidateInputs?:CandidateInputs;studentInputs?:StudentCandidateInputs}){
  const {key}=input,serializedKey=keyOf(key);if(key.matchId!==this.record.matchId||this.record.decisions.some(d=>keyOf(d.key)===serializedKey)||!this.record.games.some(g=>g.gameNo===key.gameNo))throw Error('decision identity conflict');
  if(this.confirmedRows(key.gameNo).length!==key.moveNo)throw Error('complete public prefix required before decision');
  const candidatePolicy=input.bundle?candidatePolicyForBundle(input.bundle):undefined;
  if(candidatePolicy?.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC&&(!isDeepStrictEqual(input.initialCandidateIds,input.bundle!.initialCandidateIds)||!isDeepStrictEqual(input.offeredIds,input.bundle!.initialCandidateIds)||!input.candidateInputs||resolveCandidatePolicy(input.candidateInputs.candidatePolicy)!==candidatePolicy||!isDeepStrictEqual(input.candidateInputs.candidateIds,input.bundle!.initialCandidateIds)))throw Error('new candidate record set/spec mismatch');
  if(input.studentInputs&&(!input.bundle||!input.candidateInputs||candidatePolicy?.candidateSpec!==FIRST_TARGET_CANDIDATE_SPEC||!isDeepStrictEqual(input.studentInputs.candidateIds,input.bundle.initialCandidateIds)||input.studentInputs.inputDim!==423))throw Error('student capture/record set mismatch');
  const trainingInput=input.bundle?{schema:input.studentInputs?'ohuo-decision-input-first-round-v3':candidatePolicy?.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC?'ohuo-decision-input-candidate-v2':'ohuo-decision-input-v1',key,policyId:input.policyId,observation:input.bundle.observation,candidateSpec:input.bundle.candidateSpec,...(candidatePolicy?.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC?{enumSpec:candidatePolicy.enumSpec}:{}),initialCandidateIds:input.bundle.initialCandidateIds,pool:input.bundle.pool,candidateInputs:input.candidateInputs??null,...(input.studentInputs?{studentInputs:input.studentInputs}:{}),selectionBundle:input.bundle}:null;
  if(trainingInput&&keyOf(input.bundle!.key)!==keyOf(key))throw Error('private decision key mismatch');
  this.record.decisions.push({key:structuredClone(key),policyId:input.policyId,initialCandidateIds:[...input.initialCandidateIds],offeredIds:[...input.offeredIds],requestedActionId:null,actualActionId:null,actualMove:null,actualSource:null,status:'pending',reason:null,executionKind:'none',trainingInputSHA256:trainingInput?hashJSON(trainingInput):null,elapsedMs:null,requests:[],priorTarget:null,events:[]});this.flush('decision',this.record.decisions.at(-1),undefined,trainingInput);
 }
 private decision(key:DecisionKey){const serializedKey=keyOf(key),d=this.record.decisions.find(d=>keyOf(d.key)===serializedKey);if(!d)throw Error('unrecorded decision');return d;}
 confirmAction(input:{key:DecisionKey;move:Move;events:EngineEvent[];priorTarget:Combo|null;actionId:string;requestedActionId:string|null;source:string;status:'selected'|'fallback'}){
  const d=this.decision(input.key);if(d.status!=='pending'||d.executionKind!=='none')throw Error('duplicate action confirmation');
  const events=publicEngineEvents(input.events);actionFrom(events,input.key,input.move);
  Object.assign(d,{actualMove:input.move.pass?{pass:true}:{pass:false,combo:canonicalCombo(input.move.combo)},actualActionId:input.actionId,requestedActionId:input.requestedActionId,actualSource:input.source,status:input.status,executionKind:'confirmed',priorTarget:input.priorTarget?canonicalCombo(input.priorTarget):null,events});this.flush('decision',d);
 }
 finishDecision(input:{key:DecisionKey;status:RecordedDecision['status'];reason:string|null;elapsedMs:number;offeredIds:readonly string[];requests:RecordedDecision['requests']}){
  const d=this.decision(input.key);
  if(!Number.isFinite(input.elapsedMs)||input.elapsedMs<0||input.status==='pending')throw Error('invalid terminal decision');
  if(['selected','fallback'].includes(input.status)&&d.executionKind!=='confirmed')throw Error('selection is not a confirmed action');
  if(input.status==='cancelled'&&d.executionKind!=='none')throw Error('cancel cannot erase a confirmed action');
  if(input.status==='halted'&&input.reason==='execution_uncertain')d.executionKind='unknown';
  Object.assign(d,{status:input.status,reason:input.reason,elapsedMs:input.elapsedMs,offeredIds:[...input.offeredIds],requests:structuredClone(input.requests)});this.flush('decision',d);
 }
 private confirmedRows(gameNo:number){
  const rows=this.record.decisions.filter(d=>d.key.gameNo===gameNo&&d.executionKind==='confirmed');
  if(rows.some((d,i)=>d.key.moveNo!==i))throw Error('non-contiguous confirmed public prefix');
  return rows;
 }
 history(gameNo:number):PublicHistoryPrefix{
  const rows=this.confirmedRows(gameNo);
  return {matchId:this.record.matchId,gameNo,throughMoveNo:rows.length,steps:rows.map(d=>({events:structuredClone(d.events),priorTarget:structuredClone(d.priorTarget)}))};
 }
 finish(summary:NonNullable<MatchRecord['summary']>){
  if(summary.complete&&summary.winner===null||!summary.complete&&summary.winner!==null)throw Error('incomplete match cannot have winner');
  this.record.summary=structuredClone(summary);this.flush('summary',summary);
 }
}
export function replayConfirmedMatch(record:MatchRecord,sources:PrivateSources){
 if(record.schema!=='ohuo-confirmed-match-v1'||sources.schema!=='ohuo-private-replay-v1'||record.matchId!==sources.matchId||record.sourceRef!==sources.sourceRef)throw Error('replay source identity mismatch');
 let confirmedActions=0,providerRequests:number|null=0,last:GameState|null=null,unknown=false;
 const keys=new Set<string>();
 for(const game of record.games){
  const origin=sources.games.find(s=>s.gameNo===game.gameNo);if(!origin||hashJSON(origin.state)!==game.sourceSHA256)throw Error('private source bytes differ');
  const state=restoreState(origin.state);if(state.match.gameNo!==game.gameNo||state.moveNo!==0||state.over||!isDeepStrictEqual(state.match.opts,record.rules)||!isDeepStrictEqual(state.tribute,game.tribute))throw Error('game source identity invalid');
  if(last&&(!last.over||last.match.winner!==null||game.gameNo!==last.match.gameNo+1||!isDeepStrictEqual(state.match.lastResult,last.result)))throw Error('replay game sequence mismatch');
  for(const d of record.decisions.filter(d=>d.key.gameNo===game.gameNo)){
   if(keys.has(keyOf(d.key))||d.key.matchId!==record.matchId||d.key.moveNo!==state.moveNo||d.key.actorSeat!==state.turn)throw Error('replay decision move/prefix identity mismatch');keys.add(keyOf(d.key));
   for(const a of d.requests){if(a.requestCount===null)providerRequests=null;else if(!Number.isSafeInteger(a.requestCount)||a.requestCount<0)throw Error('invalid provider count');else if(providerRequests!==null)providerRequests+=a.requestCount;}
   if(d.executionKind!=='confirmed'){if(d.executionKind==='unknown'||d.status==='pending')unknown=true;continue;}
   if(!d.actualMove||!['selected','fallback'].includes(d.status)||!isDeepStrictEqual(state.lastCombo,d.priorTarget))throw Error('confirmed action record mismatch');
   const move=resolveLegalMove(state,d.actualMove) as Move;actionFrom(d.events,d.key,move);const events=publicEngineEvents(applyMove(state,move));
   if(!isDeepStrictEqual(events,d.events))throw Error('actual replay event mismatch');confirmedActions++;
  }
  last=state;
 }
 if(record.decisions.some(d=>!record.games.some(g=>g.gameNo===d.key.gameNo)))throw Error('decision has no game source');
 const complete=!unknown&&last?.match.winner!==null&&last?.match.winner!==undefined;
 if(record.summary?.complete&&(!complete||record.summary.winner!==last!.match.winner))throw Error('claimed result is not a complete engine match');
 return {confirmedActions,providerRequests,complete:!!complete,winner:complete?last!.match.winner:null,executionUnknown:unknown,state:last};
}
type MatchResume={record:MatchRecord;privateSources:PrivateSources};
const verifiedResumes=new WeakMap<MatchRecord,{sources:PrivateSources;replay:ReturnType<typeof replayConfirmedMatch>}>();
function verifyLoadedResume(snapshot:MatchResume):MatchResume{
 const frozen=freezeCopy(snapshot),replay=replayConfirmedMatch(frozen.record,frozen.privateSources);
 verifiedResumes.set(frozen.record,{sources:frozen.privateSources,replay});return frozen;
}
/** Only the exact immutable snapshot verified by this load can reuse its replay.
 * Independent snapshots still replay fully. No mutable engine state is shared. */
export function replayMatchResume(snapshot:MatchResume){
 const verified=verifiedResumes.get(snapshot.record);
 return verified?.sources===snapshot.privateSources?structuredClone(verified.replay):replayConfirmedMatch(snapshot.record,snapshot.privateSources);
}

// The journal is append-only. Checkpoints bind an exact byte prefix; orphaned
// writes after a control checkpoint are unknown, never silently replayed twice.
import {mkdirSync,writeFileSync,appendFileSync,readFileSync,existsSync,realpathSync,lstatSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
export interface MatchStoreRef {directory:string;identitySHA256:string;journalBytes:number;journalSHA256:string}
function below(root:string,path:string){const rel=relative(resolve(root),resolve(path));if(!rel||rel.startsWith('..')||isAbsolute(rel)||realpathSync(path)!==resolve(path))throw Error('record path outside owned run or symlink');}
export function createMatchStore(outputRoot:string,identity:RecordIdentity){
 if(!/^[-A-Za-z0-9_]{1,100}$/.test(identity.matchId))throw Error('bounded matchId required');
 const parent=join(outputRoot,'matches');if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw Error('record directory symlink');mkdirSync(parent,{recursive:true});
 const directory=join(parent,identity.matchId);if(existsSync(directory))throw Error('match output exists');mkdirSync(directory,{mode:0o700});
 const bytes=JSON.stringify(identity);writeFileSync(join(directory,'identity.json'),bytes,{flag:'wx',mode:0o600});writeFileSync(join(directory,'events.jsonl'),'',{flag:'wx',mode:0o600});
 return attachStore(directory,identity,createHash('sha256').update(bytes).digest('hex'),Buffer.alloc(0));
}
function attachStore(directory:string,identity:RecordIdentity,identitySHA256:string,journal:Buffer,restored?:{record:MatchRecord;privateSources:PrivateSources}){
 let journalBytes=journal.byteLength;const sha=createHash('sha256').update(journal);
 const persist=(change:{type:'game'|'decision'|'summary';value:any;privateSource?:SavedState;privateDecision?:unknown})=>{
  if(change.type==='game')writeFileSync(join(directory,`game-${change.value.gameNo}.private.json`),JSON.stringify(change.privateSource),{flag:'wx',mode:0o600});
  if(change.privateDecision)writeFileSync(join(directory,`decision-${change.value.key.requestSeq}.private.json`),JSON.stringify(change.privateDecision),{flag:'wx',mode:0o600});
  const line=JSON.stringify({type:change.type,value:change.value})+'\n';appendFileSync(join(directory,'events.jsonl'),line);sha.update(line);journalBytes+=Buffer.byteLength(line);
 };
 const resume=restored?verifyLoadedResume(restored):undefined;
 const recorder=resume?MatchRecorder.restore(resume.record,resume.privateSources,persist):new MatchRecorder(identity,persist);
 return {recorder,resume,ref:():MatchStoreRef=>({directory,identitySHA256,journalBytes,journalSHA256:sha.copy().digest('hex')})};
}
export function loadMatchStore(ref:MatchStoreRef,outputRoot:string){
 below(outputRoot,ref.directory);const identityPath=join(ref.directory,'identity.json'),journalPath=join(ref.directory,'events.jsonl');below(ref.directory,identityPath);below(ref.directory,journalPath);
 const bytes=readFileSync(identityPath),journal=readFileSync(journalPath);if(createHash('sha256').update(bytes).digest('hex')!==ref.identitySHA256||journal.byteLength!==ref.journalBytes||createHash('sha256').update(journal).digest('hex')!==ref.journalSHA256)throw Error('execution_uncertain: record/checkpoint bytes differ');
 const identity=JSON.parse(bytes.toString()) as RecordIdentity;
 const record:MatchRecord={...identity,schema:'ohuo-confirmed-match-v1',games:[],decisions:[],summary:null};
 const privateSources:PrivateSources={schema:'ohuo-private-replay-v1',matchId:identity.matchId,sourceRef:identity.sourceRef,games:[]};
 const privateInputHashes=new Map<string,{sha256:string;identity:string}>(); // This journal load only; every event still binds its expected SHA.
 if(journal.length&&!journal.toString().endsWith('\n'))throw Error('execution_uncertain: partial event record');
 for(const line of journal.toString().split('\n').filter(Boolean)){
  const event=JSON.parse(line);if(Object.keys(event).sort().join(',')!=='type,value')throw Error('invalid journal event');
  if(event.type==='game'){
   if(record.games.some(g=>g.gameNo===event.value.gameNo))throw Error('duplicate game source');record.games.push(event.value);
   const path=join(ref.directory,`game-${event.value.gameNo}.private.json`);below(ref.directory,path);if((lstatSync(path).mode&0o777)!==0o600)throw Error('private replay requires 0600');
   privateSources.games.push({gameNo:event.value.gameNo,state:JSON.parse(readFileSync(path,'utf8'))});
  }else if(event.type==='decision'){
   if(event.value.trainingInputSHA256){
    const path=join(ref.directory,`decision-${event.value.key.requestSeq}.private.json`);below(ref.directory,path);const st=lstatSync(path,{bigint:true}),identity=[st.dev,st.ino,st.mode,st.size,st.mtimeNs,st.ctimeNs].join('|');
    if((st.mode&0o777n)!==0o600n)throw Error('private decision input changed');let actual=privateInputHashes.get(path);
    if(actual===undefined){actual={sha256:hashJSON(JSON.parse(readFileSync(path,'utf8'))),identity};privateInputHashes.set(path,actual);}
    if(actual.identity!==identity||actual.sha256!==event.value.trainingInputSHA256)throw Error('private decision input changed');
   }
   const index=record.decisions.findIndex(d=>keyOf(d.key)===keyOf(event.value.key));
   if(index<0){if(event.value.status!=='pending')throw Error('missing decision intent');record.decisions.push(event.value);}
   else{const prior=record.decisions[index];if(['cancelled','halted'].includes(prior.status)||prior.executionKind==='confirmed'&&!isDeepStrictEqual(prior.actualMove,event.value.actualMove))throw Error('terminal action journal conflict');record.decisions[index]=event.value;}
  }else if(event.type==='summary'){record.summary=event.value;}else throw Error('unknown journal event');
 }
 return attachStore(ref.directory,identity,ref.identitySHA256,journal,{record,privateSources});
}

export interface CandidateInputs {candidatePolicy?:CandidatePolicySpec;encoderVersion:string;policyId:string;inputDim:number;candidateIds:string[];candidateFeatures:number[][];rawQ:number[];policyIdentity:ResolvedPolicy['identity'];encoder:Readonly<EncoderOpts>}
/** Same causal state/tracker and original canonical objects as the B ranking;
 * no candidate enumeration, sorting, network forward, or default encoder. */
export function captureInitialCandidateInputs({bundle,state,tracker,encoder,policyIdentity}:{bundle:DecisionBundle;state:GameState;tracker:PublicTracker;encoder:Readonly<EncoderOpts>;policyIdentity:ResolvedPolicy['identity']}):CandidateInputs{
 const candidatePolicy=candidatePolicyForBundle(bundle),newSpec=candidatePolicy.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC;
 if(newSpec&&(!bundle.initialCandidateIds.length||bundle.initialCandidateIds.length>12||new Set(bundle.initialCandidateIds).size!==bundle.initialCandidateIds.length||bundle.expansionCount!==0||!isDeepStrictEqual(bundle.initialCandidateIds,bundle.offeredIds)))throw Error('new candidate capture set mismatch');
 const v2=encoder.schema==='v2',inputDim=v2?INPUT_DIM_V2:INPUT_DIM,stateDim=v2?STATE_DIM_V2:STATE_DIM;
 if(policyIdentity.inputDim!==inputDim||!policyIdentity.encoderVersion||!['action64','legacy-phys10'].includes(encoder.passEncoding??'')||bundle.key.actorSeat!==state.turn||bundle.key.gameNo!==state.match.gameNo||bundle.key.moveNo!==state.moveNo||!(tracker instanceof PublicTracker))throw Error('candidate encoder/provenance mismatch');
 const base=new Float32Array(inputDim);if(v2){if(encoder.ctxFill!=='zero'&&encoder.ctxFill!=='rule-context')throw Error('explicit encoder context required');encodeStateV2(state,state.turn,tracker,base.subarray(0,stateDim),encoder.ctxFill);}else encodeState(state,state.turn,tracker,base.subarray(0,stateDim));
 const candidateIds=[...bundle.initialCandidateIds],candidateFeatures:number[][]=[],rawQ:number[]=[];
 for(const id of candidateIds){const row=bundle.pool.find(c=>c.actionId===id);if(!row||!Number.isFinite(row.rawQ))throw Error('initial candidate mapping mismatch');const features=base.slice();encodeAction(row.canonical,features.subarray(stateDim),encoder.passEncoding);if(!features.every(Number.isFinite))throw Error('non-finite actual candidate input');candidateFeatures.push([...features]);rawQ.push(row.rawQ);}
 return {...(newSpec?{candidatePolicy}:{}),encoderVersion:policyIdentity.encoderVersion,policyId:policyIdentity.policyId,inputDim,candidateIds,candidateFeatures,rawQ,policyIdentity:structuredClone(policyIdentity),encoder:structuredClone(encoder)};
}

/** Only approved outcome fields cross worker/checkpoint/status boundaries.
 * Legacy deals contain reconstructable RNG seeds and are deliberately omitted. */
export function publicMatchOutcome(result:any){
 return {complete:result.complete,winner:result.winner,games:result.games,decisions:result.decisions,incompleteReason:result.incompleteReason,
  rootRoundResult:result.rootRoundResult?publicResult(result.rootRoundResult):null,rootG:result.rootG,finalW:result.finalW,rootTeamTarget:result.rootTeamTarget,
  policyIds:[...result.policyIds],traceSHA256:result.traceSHA256,traceSchema:result.traceSchema,wallSeconds:result.wallSeconds};
}

/** New S0 view sits BESIDE the unchanged B-prime399 capture. Pool rawQ never
 * changes meaning; the keep parent distribution comes from this actual forward. */
export interface StudentCandidateInputs {schema:'ohuo-student-candidate-input-v1';studentParentRef:string;scorer:StudentScorerDescriptor;inputDim:423;inputContract:typeof STUDENT_SCORER_ENCODER;candidatePolicy:CandidatePolicySpec;candidateIds:string[];candidateFeatures:number[][];rawQ:number[];baseActionId:string;publicHighCardMemory:PublicHighCardMemory}
export interface StudentCapture {studentParentRef:string;scorer:StudentScorerDescriptor;network:MLP}
export function captureStudentCandidateInputs({bundle,state,tracker,candidateInputs,student}:{bundle:DecisionBundle;state:GameState;tracker:PublicTracker;candidateInputs:CandidateInputs;student:StudentCapture}):StudentCandidateInputs {
 const candidatePolicy=candidatePolicyForBundle(bundle),scorer=validateStudentScorerDescriptor(student.scorer),obs=bundle.observation;
 if(candidatePolicy.candidateSpec!==FIRST_TARGET_CANDIDATE_SPEC||candidateInputs.inputDim!==399||!isDeepStrictEqual(candidateInputs.candidateIds,bundle.initialCandidateIds)||resolveCandidatePolicy(candidateInputs.candidatePolicy)!==candidatePolicy||student.network.inputDim!==423||typeof student.studentParentRef!=='string'||!/@sha256:[a-f0-9]{64}$/.test(student.studentParentRef))throw Error('student capture identities');
 const memory=buildPublicHighCardMemory({matchId:obs.matchId,gameNo:obs.gameNo,throughMoveNo:obs.moveNo,steps:obs.publicPrefix},{matchId:bundle.key.matchId,gameNo:bundle.key.gameNo},obs.effectiveLevelRanks);
 // One synchronous decision owns this validated state/memory vector. Distinct
 // actions still encode and match their original B399 rows; no witness escapes
 // this call or survives a changed state, key, tracker or public-memory prefix.
 let base:Float32Array|undefined;
 const rows=bundle.initialCandidateIds.map((id,i)=>{const c=bundle.pool.find(c=>c.actionId===id);if(!c)throw Error('student same C mapping');
  let x:Float32Array;
  if(!base){x=encodeStudentInput399Plus24(state,tracker,c.canonical,bundle.key,memory);base=x;}
  else{x=base.slice();const action=x.subarray(STATE_DIM_V2,INPUT_DIM_V2);action.fill(0);encodeAction(c.canonical,action,'action64');}
  if(!isDeepStrictEqual([...x.subarray(0,399)],candidateInputs.candidateFeatures[i]))throw Error('student legacy segment differs from proposal capture');return [...x];});
 return captureStudent423InitialCandidates(bundle,{schema:'ohuo-student-candidate-input-v1' as const,studentParentRef:student.studentParentRef,scorer,inputDim:423 as const,inputContract:STUDENT_SCORER_ENCODER,candidatePolicy,candidateIds:[...bundle.initialCandidateIds],candidateFeatures:rows,publicHighCardMemory:memory},student.network);
}
