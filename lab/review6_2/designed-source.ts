/** §44.4: authoritative designed-source reader, not a natural match recorder.
 * Parsing/replay is model-free. Snapshot capture is called only by the existing
 * admitted owner with its original resolved B-prime and S0 runtime. This module
 * neither grants runtime authority nor writes an index/used item or label. */
import {isDeepStrictEqual as equal} from 'node:util';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {applyMove,buildDeck,classify,createMatch,DEFAULT_RULES,startGame,type Card,type Combo,type GameState,type Move,type RuleOptions} from '@gd/engine';
import {canonicalActionId,resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import {necessaryDeclarationKey} from '../review6/action-effect';
import {createDecisionBundle} from '../../packages/ai/src/hybrid/candidates';
import {FIRST_TARGET_CANDIDATE_SPEC,resolveCandidatePolicy,type CandidatePolicySpec} from '../../packages/ai/src/candidate-spec';
import {resolveCandidateReleaseRef} from '../../packages/ai/src/policy/candidate-release';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import type {ResolvedPolicy} from '../../packages/ai/src/policy/resolve';
import {freezeCopy} from '../../packages/ai/src/hybrid/protocol';
import {captureInitialCandidateInputs,captureStudentCandidateInputs,hashJSON,type StudentCapture} from './match-record';
import {validateFirstRoundParentEnvelope} from './first-round-parent';
import {FIRST_ROUND_TARGET_DEFINITION,classifyFirstRoundTarget} from './first-round-target';
import {buildCommonTeacherView,normalizedCommonDecisionIdentity} from './first-round-common-view';
import type {DecisionInput} from './distill-data';
import type {DecisionKey,PublicHistoryPrefix} from '../../packages/ai/src/hybrid/protocol';
import {dealtFamilyBeforeExchange} from '../review6/training-ancestry';
import {digest,fixedReference,strictObject,validateIdentifier,validateSourceFamily} from './task-schema.mjs';

export const DESIGNED_FIRST_GAME_SCHEMA='ohuo-designed-first-game-source-v1' as const;
export const DESIGNED_FIRST_GAME_V2_SCHEMA='ohuo-designed-first-game-source-v2' as const;
export type DesignedSourceMove=Move|{pass:false;combo:Pick<Combo,'kind'|'cards'|'wildAs'>&Partial<Omit<Combo,'kind'|'cards'|'wildAs'>>};
export interface DesignedFirstGameSource {
  schema:typeof DESIGNED_FIRST_GAME_SCHEMA|typeof DESIGNED_FIRST_GAME_V2_SCHEMA;
  sourceKind:'designed-synthetic';
  questionId:string;
  designFamilyId:string;
  split:'train';
  engineSourceRef:string;
  rulesRef:string;
  rules:RuleOptions;
  origin:{kind:'first-game';leaderSeed:number};
  initialIds:number[][];
  moves:Array<{gameNo:1;actorSeat:number;move:DesignedSourceMove}>;
  target:{gameNo:1;moveNo:number;actorSeat:number;remainingCards:number[]};
}
export interface DesignedSourceLocator {sourceKind:'designed-synthetic';sourceRef:string}
export interface DesignedSourceInputs {
  repositoryRoot:string;
  sourceIndexPath:string;
  sourceIndexRef:string;
  references:ReadonlyMap<string,any>;
  evidenceFiles:ReadonlyMap<string,{path:string;sha256:string}>;
}
/** Same already-resolved runtime as first-round-screen-consumer. The admitted
 * owner resolves policy weights/migration with the existing original loaders;
 * task/source JSON cannot provide this runtime or arbitrary scorer callbacks. */
export interface DesignedSourceRuntime {
  proposal:Pick<ResolvedPolicy,'identity'|'encoder'|'createDecider'>&{candidatePolicy:CandidatePolicySpec};
  parent:{studentCapture:StudentCapture};
}
/** Necessary paths inside the ORIGINAL Task.sourceRevision {baseCommit,files}.
 * This is not a second manifest. H remains responsible for the full Task source
 * closure; this reader checks its relevant files once per fixed reader context. */
export const DESIGNED_SOURCE_PROGRAM_PATHS=Object.freeze([
  ...['index','types','rank','rng','deck','combo','game','record'].map(p=>'packages/engine/src/'+p+'.ts'),
  'packages/ai/src/hybrid/legality.ts','packages/ai/src/hybrid/observation.ts',
  'packages/ai/src/hybrid/candidates.ts','packages/ai/src/hybrid/candidateCoverage.ts',
  'packages/ai/src/hybrid/protocol.ts','packages/ai/src/candidate-spec.ts',
  'packages/ai/src/nn/neuralSeat.ts','packages/ai/src/nn/schema.ts','packages/ai/src/nn/publicMemory.ts',
  'lab/review6/training-ancestry.ts','lab/review6/capability-lineage.ts','lab/review6/data-provenance.ts',
  'lab/review6/action-effect.ts','lab/review6_2/match-record.ts',
  'lab/review6_2/first-round-common-view.ts','lab/review6_2/first-round-target.ts',
]);
// One reviewed representation-preserving repair: only joker_bomb gains the
// engine's existing rank=99 decoding. Original Task/source/response stay pinned.
// No third mapper, reverse correction or other program path is compatible.
const JOKER_RANK_PROJECTION_CORRECTION=Object.freeze({
  path:'lab/review6_2/first-round-common-view.ts',
  beforeSHA256:'d06b7dcd518e67f55b3909306ee37f8b9cd8505b00ad89b3ff31b189782d834a',
  afterSHA256:'8c6135254277b94ad6339e619cf6f817772daf65d9851e4970ac762a17c0ed50',
});
const need=(value:unknown,reason:string):void=>{if(!value)throw Error('designed_source_'+reason);};
const integer=(value:unknown,min:number,max:number)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const rulesKeys=['levelMode','passA','pairSeqMin','pairSeqMax','trioSeqMin','trioSeqMax','flushLen','straightLen'];

function moveShape(value:any,v2=false):void {
  need(value&&typeof value.pass==='boolean','move_boolean');
  strictObject(value,'designed.move',value.pass?['pass']:['pass','combo']);
  if(value.pass)return;
  const c=value.combo;
  const required=v2?['kind','cards','wildAs',...(!['single','joker_bomb'].includes(c?.kind)?['mainRank']:[]),...(c?.kind==='trio_pair'?['pairRanks']:[]),...(c?.kind==='flush'?['suit']:[])]:['kind','cards','size','keyRank','length','pairRanks','mainRank','wildAs'];
  strictObject(c,'designed.combo',[...required,...(v2?['size','keyRank','length','pairRanks','mainRank','suit'].filter(k=>!required.includes(k)&&Object.hasOwn(c??{},k)):Object.hasOwn(c??{},'suit')?['suit']:[])]);
  need(['single','pair','trio','trio_pair','straight','pair_seq','trio_seq','bomb','flush','joker_bomb'].includes(c.kind),'combo_kind');
  need(Array.isArray(c.cards)&&c.cards.length>0&&c.cards.length<=27,'combo_cards');
  for(const card of c.cards){strictObject(card,'designed.card',['id','suit','rank']);need(integer(card.id,0,107)&&['S','H','D','C','J'].includes(card.suit)&&integer(card.rank,2,17),'card_shape');}
  need(['size','keyRank','length','mainRank'].every(k=>v2&&!Object.hasOwn(c,k)||integer(c[k],0,108)),'combo_numbers');
  if(!v2||Object.hasOwn(c,'pairRanks'))need(Array.isArray(c.pairRanks)&&c.pairRanks.length<=(v2?1:13)&&(!v2||c.pairRanks.length===(c.kind==='trio_pair'?1:0))&&c.pairRanks.every((r:unknown)=>integer(r,2,17)),'pair_ranks');
  need(v2?!Object.hasOwn(c,'suit')||['S','H','D','C','J'].includes(c.suit):c.suit===undefined||['S','H','D','C','J'].includes(c.suit),'combo_suit');
  need(Array.isArray(c.wildAs)&&c.wildAs.length<=2,'wild_assignments');
  for(const w of c.wildAs){strictObject(w,'designed.wild',['cardId','asRank',...(Object.hasOwn(w??{},'asSuit')?['asSuit']:[])]);need(integer(w.cardId,0,107)&&integer(w.asRank,2,14)&&((v2?!Object.hasOwn(w,'asSuit'):w.asSuit===undefined)||['S','H','D','C'].includes(w.asSuit)),'wild_shape');}
  // Ownership, physical face identity, classification, declared wild effects and
  // beats/pass legality belong exclusively to resolveLegalMove below.
}

export function parseDesignedFirstGameSource(input:unknown):DesignedFirstGameSource {
  let value:any;
  if(typeof input==='string'){
    need(Buffer.byteLength(input,'utf8')<=4*1024*1024,'bounded_json');
    try{value=JSON.parse(input);}catch{throw Error('designed_source_json');}
  }else value=structuredClone(input);
  strictObject(value,'designed.source',['schema','sourceKind','questionId','designFamilyId','split','engineSourceRef','rulesRef','rules','origin','initialIds','moves','target']);
  need([DESIGNED_FIRST_GAME_SCHEMA,DESIGNED_FIRST_GAME_V2_SCHEMA].includes(value.schema)&&value.sourceKind==='designed-synthetic','schema');
  validateIdentifier(value.questionId,'designed.questionId');validateIdentifier(value.designFamilyId,'designed.designFamilyId');
  need(value.split==='train','train_only');
  fixedReference(value.engineSourceRef,'designed.engineSourceRef');fixedReference(value.rulesRef,'designed.rulesRef');
  strictObject(value.rules,'designed.rules',rulesKeys);
  need(equal(value.rules,DEFAULT_RULES),'unsupported_rules');
  need(value.rulesRef.split(':').at(-1)===digest(value.rules),'rules_identity');
  need(value.origin?.kind==='first-game','first_game_only');
  strictObject(value.origin,'designed.origin',['kind','leaderSeed']);
  need(integer(value.origin.leaderSeed,0,0xffffffff),'leader_seed');
  need(Array.isArray(value.initialIds)&&value.initialIds.length===4&&value.initialIds.every((hand:any)=>Array.isArray(hand)&&hand.length===27&&hand.every((id:unknown)=>integer(id,0,107))),'initial_deal_shape');
  need(Array.isArray(value.moves)&&value.moves.length<=2500,'bounded_prefix');
  for(const row of value.moves){strictObject(row,'designed.prefix',['gameNo','actorSeat','move']);need(row.gameNo===1&&integer(row.actorSeat,0,3),'prefix_position');moveShape(row.move,value.schema===DESIGNED_FIRST_GAME_V2_SCHEMA);}
  strictObject(value.target,'designed.target',['gameNo','moveNo','actorSeat','remainingCards']);
  need(value.target.gameNo===1&&value.target.moveNo===value.moves.length&&integer(value.target.actorSeat,0,3),'target_position');
  need(Array.isArray(value.target.remainingCards)&&value.target.remainingCards.length===4&&value.target.remainingCards.every((n:unknown)=>integer(n,0,27)),'target_counts');
  return value;
}

/** v2 only: fill absent derived fields after unique necessary interpretation.
 * Never choose by strength/beats, edit cards/wildAs, or rewrite the raw source. */
export function resolveDesignedSourceMoveV2(state:GameState,move:DesignedSourceMove):Move {
  moveShape(move,true);
  if(state.over||state.pendingReturns.length)throw Error('illegal move outside active play');
  if(move.pass)return resolveLegalMove(state,move) as Move;
  const declared=move.combo,ids=declared.cards.map(c=>c.id);
  if(new Set(ids).size!==ids.length)throw Error('duplicate physical resource identity');
  const cards=ids.map(id=>state.hands[state.turn].find(c=>c.id===id));
  if(cards.some(c=>!c))throw Error('physical resource not owned');
  if(cards.some((c,i)=>!equal(c,declared.cards[i])))throw Error('selected physical-card identity differs from the actual owned card');
  const interpretations=new Map<string,Combo>();
  for(const candidate of classify(cards as Card[],state.ctx,state.match.opts)){
    if(candidate.kind!==declared.kind||(['size','keyRank','length','mainRank','pairRanks'] as const).some(k=>Object.hasOwn(declared,k)&&!equal(declared[k],candidate[k]))||candidate.kind==='flush'&&declared.suit!==candidate.suit)continue;
    const filled={...structuredClone(declared),...Object.fromEntries((['size','keyRank','length','mainRank','pairRanks'] as const).map(k=>[k,Object.hasOwn(declared,k)?declared[k]:candidate[k]]))} as Combo;
    const key=necessaryDeclarationKey(filled,state.ctx);
    if(key===necessaryDeclarationKey(candidate,state.ctx))interpretations.set(key,filled);
  }
  need(interpretations.size===1,interpretations.size?'v2_declaration_ambiguous':'v2_declaration_zero');
  return resolveLegalMove(state,{pass:false,combo:interpretations.values().next().value!}) as Move;
}

function conservation(state:GameState,played:readonly Card[],deck:ReadonlyMap<number,Card>):void {
  const cards=[...state.hands.flat(),...played];
  need(cards.length===108&&new Set(cards.map(c=>c.id)).size===108&&cards.every(c=>equal(c,deck.get(c.id))),'physical_conservation');
}

const bytesSHA256=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
function localFile(root:string,path:string,privateSource=false):Buffer {
  need(typeof path==='string','path_escape');
  const full=isAbsolute(path)?resolve(path):resolve(root,path),rel=relative(root,full);
  need(typeof path==='string'&&rel&&!rel.startsWith('..')&&!isAbsolute(rel),'path_escape');
  need(realpathSync(full)===full,'symlink');
  for(let p=full;p!==root;p=dirname(p))need(!lstatSync(p).isSymbolicLink(),'symlink');
  const st=lstatSync(full);need(st.isFile()&&st.size<=32*1024*1024,'regular_bounded_file');
  if(privateSource)need((st.mode&0o777)===0o600,'private_source_permissions');
  return readFileSync(full);
}
function context(t:DesignedSourceInputs){
  need(t&&typeof t.repositoryRoot==='string'&&isAbsolute(t.repositoryRoot)&&realpathSync(t.repositoryRoot)===t.repositoryRoot&&t.references instanceof Map&&t.evidenceFiles instanceof Map,'trusted_catalog');
  const fixedContext={repositoryRoot:t.repositoryRoot,sourceIndexPath:t.sourceIndexPath,sourceIndexRef:t.sourceIndexRef,references:t.references,evidenceFiles:t.evidenceFiles};
  const values=new Map<string,any>(),evidenceBindings=new Map<string,any>(),files=new Map<string,{bytes:Buffer;stamp:string}>(),verifiedPrograms=new Set<string>();
  const stamp=(path:string)=>{const st=lstatSync(path,{bigint:true});return [st.dev,st.ino,st.size,st.mtimeNs,st.ctimeNs,st.mode].join(':');};
  const readFile=(path:string,privateSource=false)=>{
    need(typeof path==='string','path_escape');const full=isAbsolute(path)?resolve(path):resolve(t.repositoryRoot,path),rel=relative(t.repositoryRoot,full);need(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'path_escape');const prior=files.get(full);
    if(prior){need(stamp(full)===prior.stamp,'fixed_file_changed');if(privateSource)need((lstatSync(full).mode&0o777)===0o600,'private_source_permissions');return prior.bytes;}
    const before=stamp(full),bytes=localFile(t.repositoryRoot,path,privateSource);need(stamp(full)===before,'fixed_file_changed');files.set(full,{bytes,stamp:before});return bytes;
  };
  const get=(ref:string)=>{fixedReference(ref,'designed.reference');if(values.has(ref))return values.get(ref);const value=t.references.get(ref);need(value!==undefined&&digest(value)===ref.split(':').at(-1),'reference_identity');const fixed=freezeCopy(value);values.set(ref,fixed);return fixed;};
  const evidence=(f:any,privateSource=false)=>{strictObject(f,'designed.evidence',['id','sha256']);need(typeof f.id==='string'&&f.id.length>0&&!/(^|[/:_-])latest($|[/:@_-])/i.test(f.id)&&sha(f.sha256),'evidence_identity');const file=t.evidenceFiles.get(f.id);need(file&&file.sha256===f.sha256,'evidence_catalog');strictObject(file,'designed.evidence.file',['path','sha256']);const priorBinding=evidenceBindings.get(f.id);if(priorBinding)need(equal(priorBinding,file),'fixed_reference_changed');else evidenceBindings.set(f.id,structuredClone(file));const raw=readFile(file!.path,privateSource);need(bytesSHA256(raw)===f.sha256,'evidence_hash');return raw;};
  const verifyProgram=(ref:string)=>{
    if(verifiedPrograms.has(ref))return;
    const program=get(ref);strictObject(program,'sourceRevision',['baseCommit','files']);need(typeof program.baseCommit==='string'&&/^[a-f0-9]{40}$/.test(program.baseCommit)&&Array.isArray(program.files),'program_inventory');
    const filesByPath=new Map<string,any>();for(const file of program.files){strictObject(file,'sourceFile',['path','sha256']);need(typeof file.path==='string'&&!isAbsolute(file.path)&&!file.path.split(/[\\/]/).some((p:string)=>!p||p==='.'||p==='..')&&sha(file.sha256)&&!filesByPath.has(file.path),'program_inventory');filesByPath.set(file.path,file);}
    for(const path of DESIGNED_SOURCE_PROGRAM_PATHS){
      const file=filesByPath.get(path);need(file,'program_inventory');const actualSHA256=bytesSHA256(readFile(path)),correction=JOKER_RANK_PROJECTION_CORRECTION;
      need(actualSHA256===file.sha256||(path===correction.path&&file.sha256===correction.beforeSHA256&&actualSHA256===correction.afterSHA256),'program_identity');
    }
    verifiedPrograms.add(ref);
  };
  const assertUnchanged=()=>{need(t.repositoryRoot===fixedContext.repositoryRoot&&t.sourceIndexPath===fixedContext.sourceIndexPath&&t.sourceIndexRef===fixedContext.sourceIndexRef&&t.references===fixedContext.references&&t.evidenceFiles===fixedContext.evidenceFiles,'fixed_context_changed');for(const [ref,value] of values)need(equal(t.references.get(ref),value),'fixed_reference_changed');for(const [id,file] of evidenceBindings)need(equal(t.evidenceFiles.get(id),file),'fixed_reference_changed');for(const [path,file] of files)need(stamp(path)===file.stamp,'fixed_file_changed');};
  return{get,evidence,readFile,verifyProgram,assertUnchanged};
}

function ownership(index:any,designFamilyId:string,sourceFamilyId:string,rootFamilyId:string){
  need(index?.version===1&&index.families&&typeof index.families==='object'&&!Array.isArray(index.families),'source_index_schema');
  for(const id of [designFamilyId,sourceFamilyId,rootFamilyId])validateSourceFamily(id,'designed.family');
  // Generated design/deal nodes may not silently become fresh roots merely
  // because their derivation was omitted. Legacy roots are allowed only as
  // already-registered ancestors, never as a substitute for these two owners.
  for(const id of [designFamilyId,sourceFamilyId])need(Object.hasOwn(index.families[id]??{},'rootFamilyId')&&Object.hasOwn(index.families[id]??{},'parentFamilyIds'),'explicit_family_ownership');
  const visited=new Set<string>(),active=new Set<string>();
  const visit=(id:string)=>{
    need(!active.has(id),'family_cycle');if(visited.has(id))return;
    const row=index.families[id];need(row&&typeof row==='object'&&!Array.isArray(row),'family_unregistered');need(row.split==='train','family_split');
    const explicit=Object.hasOwn(row,'rootFamilyId')||Object.hasOwn(row,'parentFamilyIds');
    if(explicit)need(Object.hasOwn(row,'rootFamilyId')&&Object.hasOwn(row,'parentFamilyIds'),'family_ownership_incomplete');
    const root=explicit?row.rootFamilyId:id,parents=explicit?row.parentFamilyIds:[];
    validateSourceFamily(root,'designed.rootFamily');need(root===rootFamilyId,'family_root');
    need(Array.isArray(parents)&&new Set(parents).size===parents.length,'family_parents');parents.forEach((p:string)=>validateSourceFamily(p,'designed.parentFamily'));
    need(id===root?parents.length===0:parents.length>0,'root_parent');
    active.add(id);for(const parent of parents)visit(parent);active.delete(id);visited.add(id);
  };
  visit(designFamilyId);visit(sourceFamilyId);visit(rootFamilyId);
  return [...visited].sort();
}
function replay(input:DesignedFirstGameSource){
  // The explicit 108 IDs take the original dealInitialHands path inside
  // startGame. leaderSeed initializes the first leader only; no random deal,
  // fabricated previous result, level, tribute or manually supplied state.
  const state=startGame(createMatch(structuredClone(input.rules),input.origin.leaderSeed),[],input.initialIds);
  need(state.match.gameNo===1&&state.match.lastResult===null&&state.tribute===null&&state.pendingReturns.length===0,'first_game_state');
  const sourceFamilyId=dealtFamilyBeforeExchange(state);
  const initialFaces=state.hands.map(hand=>hand.map(({suit,rank})=>({suit,rank})).sort((a,b)=>a.suit.localeCompare(b.suit)||a.rank-b.rank));
  const firstLeader=state.turn,deck=new Map(buildDeck().map(c=>[c.id,c])),played:Card[]=[],steps:PublicHistoryPrefix['steps'][number][]=[],effects:Array<{actorSeat:number;action:string}>=[];
  conservation(state,played,deck);
  for(const [i,row]of input.moves.entries()){
    need(!state.over&&state.match.winner===null&&!state.pendingReturns.length&&state.match.gameNo===row.gameNo&&state.moveNo===i&&state.turn===row.actorSeat,'prefix_origin');
    const move=input.schema===DESIGNED_FIRST_GAME_V2_SCHEMA?resolveDesignedSourceMoveV2(state,row.move):resolveLegalMove(state,row.move as Move) as Move;
    const priorTarget=structuredClone(state.lastCombo);
    effects.push({actorSeat:row.actorSeat,action:necessaryDeclarationKey(move.pass?null:move.combo,state.ctx)});
    if(!move.pass)played.push(...structuredClone(move.combo.cards));
    const events=applyMove(state,move);
    conservation(state,played,deck);steps.push({priorTarget,events:structuredClone(events)});
  }
  need(!state.over&&state.match.winner===null&&state.result===null&&!state.pendingReturns.length&&state.hands[state.turn].length>0,'target_not_active');
  need(state.match.gameNo===input.target.gameNo&&state.moveNo===input.target.moveNo&&state.turn===input.target.actorSeat&&equal(state.hands.map(h=>h.length),input.target.remainingCards),'target_mismatch');
  // Ignore question/design labels, irrelevant seed changes with the same first
  // leader, and interchangeable physical copies when checking exact reuse.
  // This is a local causal replay identity, not an all-equivalences dedup claim.
  const replaySHA256=digest({rules:input.rules,initialFaces,firstLeader,effects,target:{gameNo:state.match.gameNo,moveNo:state.moveNo,actorSeat:state.turn},...(input.schema===DESIGNED_FIRST_GAME_V2_SCHEMA?{sourceRevision:input.engineSourceRef}:{})});
  const inputSHA256=digest(input),matchId='designed:'+replaySHA256;
  const key:DecisionKey={controllerOrRunnerGeneration:'designed-synthetic:'+inputSHA256,matchId,gameNo:1,moveNo:state.moveNo,actorSeat:state.turn,requestSeq:state.moveNo};
  const history:PublicHistoryPrefix={matchId,gameNo:1,throughMoveNo:state.moveNo,steps};
  need([0,1].every(team=>state.hands.some((hand,seat)=>seat%2===team&&hand.length>0)),'both_teams_active');
  return {state,history,key,sourceFamilyId,inputSHA256,replaySHA256};
}

/** Read only the registered exact private source and original index. A new
 * question ID, caller-provided family list, or split assertion is no authority.
 * This method makes no network/scorer call and does not reserve a used item. */
function readDesignedSourceUncached(row:DesignedSourceLocator,t:DesignedSourceInputs,c:ReturnType<typeof context>){
  need(row?.sourceKind==='designed-synthetic','source_kind');
  const {get,evidence}=c,registration=get(row.sourceRef);
  strictObject(registration,'designed.registration',['schema','sourceIndexRef','sourceFile','questionId','designFamilyId','sourceFamilyId','rootFamilyId','engineSourceRef','rulesRef','comparisonRef']);
  need(registration.schema==='ohuo-designed-source-registration-v1'&&registration.sourceIndexRef===t.sourceIndexRef,'registration_identity');
  const indexRef=get(t.sourceIndexRef),indexBytes=c.readFile(t.sourceIndexPath);
  strictObject(indexRef,'designed.sourceIndexRef',['schema','namespace','fileSHA256']);
  need(indexRef.schema==='ohuo-source-index-ref-v1'&&bytesSHA256(indexBytes)===indexRef.fileSHA256,'source_index_identity');
  validateIdentifier(indexRef.namespace,'designed.namespace');
  const input=parseDesignedFirstGameSource(evidence(registration.sourceFile,true).toString('utf8'));
  for(const field of ['questionId','designFamilyId','engineSourceRef','rulesRef'] as const)need(registration[field]===input[field],'registered_source_identity');
  need(equal(get(input.rulesRef),input.rules),'fixed_source_rules');
  c.verifyProgram(input.engineSourceRef);
  const replayed=replay(input);need(replayed.sourceFamilyId===registration.sourceFamilyId,'registered_deal_identity');
  const familyIds=ownership(JSON.parse(indexBytes.toString('utf8')),input.designFamilyId,replayed.sourceFamilyId,registration.rootFamilyId);
  const comparison=get(registration.comparisonRef);strictObject(comparison,'designed.comparison',['schema','proposalRef','studentParentRef']);need(comparison.schema==='ohuo-first-round-comparison-v1','comparison');
  const proposal=resolveCandidateReleaseRef(get(comparison.proposalRef),get,RELEASES),parent=validateFirstRoundParentEnvelope({parentRef:comparison.studentParentRef,envelope:get(comparison.studentParentRef),readEvidence:evidence});
  need(proposal.candidatePolicy?.candidateSpec===FIRST_TARGET_CANDIDATE_SPEC&&proposal.release.mode==='local'&&proposal.release.tier==='hard'&&equal(proposal.policyIdentity,parent.basePolicyIdentity),'actual_Bprime_S0');
  return {source:input,registration,familyIds,comparison,proposal,parent,...replayed};
}

/** Calls the ORIGINAL candidate/capture contracts once at this replayed target.
 * There is no target applyMove, pending/confirmed decision, natural recordRef,
 * natural seed or full-match completion. Scientific qualification is unchanged. */
function captureDesignedSnapshot(locator:DesignedSourceLocator,t:DesignedSourceInputs,loaded:ReturnType<typeof readDesignedSourceUncached>,runtime:DesignedSourceRuntime){
  const {state,history,key,comparison}=loaded;
  need(runtime&&equal(plain(runtime.proposal.identity),loaded.proposal.policyIdentity)&&equal(runtime.proposal.encoder,{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'})&&resolveCandidatePolicy(runtime.proposal.candidatePolicy)===resolveCandidatePolicy(loaded.proposal.candidatePolicy)&&runtime.parent?.studentCapture?.studentParentRef===comparison.studentParentRef&&equal(plain(runtime.parent.studentCapture.scorer),plain(loaded.parent.scorer)),'runtime_identity');
  const decider=runtime.proposal.createDecider(state.turn);decider.newGame();for(const step of history.steps)decider.observe([...step.events]);
  const bundle=createDecisionBundle({key,state,actorSeat:state.turn,decisionId:'designed-'+loaded.inputSHA256,matchId:key.matchId,history,decider,candidatePolicy:loaded.proposal.candidatePolicy});
  const candidates=bundle.initialCandidateIds.map(id=>{const c=bundle.pool.find(c=>c.actionId===id);need(c,'candidate_identity');return c!;});
  const target=classifyFirstRoundTarget({state,actorSeat:state.turn,candidateCombos:candidates.map(c=>c.canonical)},FIRST_ROUND_TARGET_DEFINITION);
  need(target.sampleClass==='target'&&target.coverage==='covered'&&candidates.some(c=>c.canonical===null)&&candidates.some(c=>c.canonical!==null),'target_candidates');
  const candidateInputs=captureInitialCandidateInputs({bundle,state,tracker:decider.tracker,encoder:runtime.proposal.encoder,policyIdentity:runtime.proposal.identity}),studentInputs=captureStudentCandidateInputs({bundle,state,tracker:decider.tracker,candidateInputs,student:runtime.parent.studentCapture});
  const input=freezeCopy(plain({schema:'ohuo-decision-input-first-round-v3',key,policyId:runtime.proposal.identity.policyId,observation:bundle.observation,candidateSpec:bundle.candidateSpec,enumSpec:bundle.enumSpec,initialCandidateIds:bundle.initialCandidateIds,pool:bundle.pool,candidateInputs,studentInputs,selectionBundle:bundle})) as DecisionInput&{selectionBundle:typeof bundle};
  const effects=new Map<string,string>();
  const commonView=buildCommonTeacherView(candidates.map((c,index)=>{const move=resolveLegalMove(state,c.canonical===null?{pass:true}:{pass:false,combo:c.canonical});need(canonicalActionId(move.pass?null:move.combo!,state.ctx)===c.canonicalId,'canonical_identity');const equivalenceKey=necessaryDeclarationKey(move.pass?null:move.combo!,state.ctx);effects.set(c.actionId,equivalenceKey);return{actionId:c.actionId,input423:studentInputs.candidateFeatures[index],equivalenceKey};}),{inputDim:423,passEncoding:'action64'});
  const normalizedDecisionIdentity=normalizedCommonDecisionIdentity(commonView,loaded.source.rules,bundle.candidateSpec,effects);
  const row={sourceKind:'designed-synthetic' as const,sourceRef:locator.sourceRef,questionId:loaded.source.questionId,key,inputSHA256:hashJSON(input),familyId:loaded.sourceFamilyId,blockFamilyId:loaded.registration.rootFamilyId,split:'train' as const,actorSeat:state.turn};
  for(const field of ['questionId','key','inputSHA256','familyId','blockFamilyId','split','actorSeat'] as const)if(Object.hasOwn(locator,field))need(equal((locator as any)[field],row[field]),'selected_identity');
  return {row,input,bundle,state,history,commonView,normalizedDecisionIdentity,designedSource:{schema:'ohuo-designed-source-snapshot-v1' as const,sourceKind:'designed-synthetic' as const,sourceRef:locator.sourceRef,sourceIndexRef:t.sourceIndexRef,sourceFile:loaded.registration.sourceFile,questionId:loaded.source.questionId,designFamilyId:loaded.source.designFamilyId,sourceFamilyId:loaded.sourceFamilyId,rootFamilyId:loaded.registration.rootFamilyId,familyIds:loaded.familyIds,engineSourceRef:loaded.source.engineSourceRef,rulesRef:loaded.source.rulesRef,comparisonRef:loaded.registration.comparisonRef,sourceInputSHA256:loaded.inputSHA256,replaySHA256:loaded.replaySHA256,targetExecuted:false as const,status:'replayed-unlabelled' as const,eligibleForTeaching:false as const}};
}
/** One context per fixed catalog/owned run. Same-source replay and capture are
 * retained locally; callers receive copies so branch state mutations cannot
 * contaminate the next read. Changes invalidate this context instead of being
 * silently accepted under old SHA refs. Like the existing sole-writer S54
 * session, file stat stamps are change signals, not adversarial file integrity
 * proofs. Run/catalog ownership remains with H. This is not a persistent cache. */
function runtimeBinding(runtime:DesignedSourceRuntime){
  const proposal=runtime?.proposal,student=runtime?.parent?.studentCapture,network=student?.network;
  need(proposal&&student&&network,'runtime_identity');
  return {metadata:plain({identity:proposal.identity,encoder:proposal.encoder,candidatePolicy:proposal.candidatePolicy,studentParentRef:student.studentParentRef,scorer:student.scorer,inputDim:network.inputDim}),createDecider:proposal.createDecider,network,forward:network.forward};
}
function sameRuntimeBinding(a:ReturnType<typeof runtimeBinding>,b:ReturnType<typeof runtimeBinding>){return equal(a.metadata,b.metadata)&&a.createDecider===b.createDecider&&a.network===b.network&&a.forward===b.forward;}
export function createDesignedSourceReader(t:DesignedSourceInputs){
  const c=context(t),sources=new Map<string,ReturnType<typeof readDesignedSourceUncached>>(),snapshots=new Map<string,{runtime:DesignedSourceRuntime;binding:ReturnType<typeof runtimeBinding>;snapshot:ReturnType<typeof captureDesignedSnapshot>}>();
  const readSource=(row:DesignedSourceLocator)=>{c.assertUnchanged();need(row?.sourceKind==='designed-synthetic','source_kind');let value=sources.get(row.sourceRef);if(!value){value=readDesignedSourceUncached(row,t,c);c.assertUnchanged();sources.set(row.sourceRef,structuredClone(value));}return structuredClone(value);};
  const readSnapshot=(locator:DesignedSourceLocator,runtime:DesignedSourceRuntime)=>{
    c.assertUnchanged();need(locator?.sourceKind==='designed-synthetic','source_kind');
    const prior=snapshots.get(locator.sourceRef),binding=runtimeBinding(runtime);if(prior?.runtime===runtime)need(sameRuntimeBinding(prior.binding,binding),'fixed_runtime_changed');let snapshot=prior?.runtime===runtime?prior.snapshot:undefined;
    if(!snapshot){snapshot=captureDesignedSnapshot(locator,t,readSource(locator),runtime);c.assertUnchanged();snapshots.set(locator.sourceRef,{runtime,binding,snapshot:structuredClone(snapshot)});}
    for(const field of ['questionId','key','inputSHA256','familyId','blockFamilyId','split','actorSeat'] as const)if(Object.hasOwn(locator,field))need(equal((locator as any)[field],snapshot.row[field]),'selected_identity');
    // Snapshot branch state/history stay isolated and mutable; the original
    // remote selector requires the candidate bundle to remain deeply frozen.
    const copy=structuredClone(snapshot);copy.bundle=freezeCopy(copy.bundle);return copy;
  };
  return {readSource,readSnapshot,assertUnchanged:c.assertUnchanged};
}
/** Cold convenience calls for a single independent input. An admitted consumer
 * processing several questions/branches must retain createDesignedSourceReader. */
export function readDesignedSource(row:DesignedSourceLocator,t:DesignedSourceInputs){return createDesignedSourceReader(t).readSource(row);}
export function readDesignedSnapshot(row:DesignedSourceLocator,t:DesignedSourceInputs,runtime:DesignedSourceRuntime){return createDesignedSourceReader(t).readSnapshot(row,runtime);}
export type DesignedSnapshot=ReturnType<typeof readDesignedSnapshot>;
export type DesignedSourceReader=ReturnType<typeof createDesignedSourceReader>;

