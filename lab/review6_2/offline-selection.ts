import {screenRevalidationStatePath} from './screen-revalidation.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {knownUnsentWorldPreparationFailure} from './first-round-prequery-failure.mjs';
import {COMMON_VIEW_SELECTION_SCHEMA,COMMON_VIEW_SOURCE_BASIS_SCHEMA,readCommonViewProtocol,readCommonViewSourceFamilies,commonViewCoverageCell,selectCommonViewRepresentatives,COMMON_VIEW_ROUND_SPEC_SCHEMA,COMMON_VIEW_ROUND_CONTRACT_SCHEMA,COMMON_VIEW_POOL_SCHEMA,commonViewDecisionKey,commonViewRowIdentity,selectNextCommonViewRepresentatives,validateCommonViewRoundChain,validateCommonViewRoundTasks,assertCommonViewRoundTerminalsSettled,TRAIN_COVERAGE_POLICY,TRAIN_PUBLIC_STRATA_POLICY,trainPublicResourceCell,selectReviewedTrainRepresentatives,trainCoveragePublicEligible,trainCoveragePublicReason} from './first-round-source-batch.mjs';
import {verifySourceActionInventory} from './first-round-source-action-scope.mjs';
/** §36D natural pre-query selection preserves original captures. §44.4 adds
 * explicit original-runtime designed capture, never a teacher query,
 * label-dependent selection or target action execution. */
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,readdirSync,writeFileSync,writeSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import {canonical,digest,fixedReference,referenceOf,strictObject,validateIdentifier,validateSourceFamily} from './task-schema.mjs';
import {loadMatchStore as loadOriginalMatchStore,hashJSON} from './match-record';
import {acquireSourceWriter} from './writer-lock';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {resolveCandidateReleaseRef,CANDIDATE_RESEARCH_RELEASE_SCHEMA} from '../../packages/ai/src/policy/candidate-release';
import {resolveCandidatePolicy,FIRST_TARGET_CANDIDATE_SPEC} from '../../packages/ai/src/candidate-spec';
import {classifyFirstRoundTarget,validateFirstRoundTargetDefinition,type FirstRoundTargetSnapshot,type FirstRoundTargetResult} from './first-round-target';
import {validateFirstRoundParentEnvelope} from './first-round-parent';
import {readOfflineSnapshot as readOriginalOfflineSnapshot,commonViewForSnapshot,commonDecisionIdentityForSnapshot,validateCapturedCandidateContract,type SelectedRecordedDecision} from './offline-label-source';

export const DESIGNED_SELECTION_SPEC_SCHEMA='ohuo-offline-selection-spec-designed-v1' as const;
export const DESIGNED_SELECTION_RULE_SCHEMA='ohuo-offline-selection-designed-common-view-v1' as const;
export type FixedFile={path:string;sha256:string};
export type SelectionEvidenceRef={id:string;sha256:string};
type Split='train'|'dev';
type Quota={familyId:string;split:Split;count:number};
export interface OfflineSelectionSpec {schema:'ohuo-offline-selection-spec-v1'|'ohuo-offline-selection-spec-common-view-round-r2'|'ohuo-offline-selection-spec-designed-v1';designedContractRef?:string;roundContractRef?:string;planRef:string;clauseRef:string;branchRef:string|null;sourceIndexRef:string;queueRef:string;sourceRunRefs:SelectionEvidenceRef[];targetDefinitionRef:string;selectionRuleRef:string;quotaBasisRef:SelectionEvidenceRef;purpose:'b_training_source'|'distribution_diagnostic';actingReleaseRef:string;outputId:string}
export interface OfflineSelectionTrustedInputs {repositoryRoot:string;references:ReadonlyMap<string,any>;evidenceFiles:ReadonlyMap<string,FixedFile>;sourceIndexPath:string;confirmedRecordRoots:string[];controlRoot:string;screenRevalidation?:object;mode:'research'|'offline_synthetic';phase:'freeze'|'label-start'|'label-resume'|'dataset';task?:any;outputDir?:string;labelTerminalRefs?:SelectionEvidenceRef[];reproductionSession?:object;roundProofSession?:object;designedSession?:object}
type PopulationRow=SelectedRecordedDecision&{decisionSHA256?:string;representativeOrder?:{round:number;sourceHashRank:number;cellRank:number;selected:boolean};commonViewCell?:ReturnType<typeof commonViewCoverageCell>;blockFamilyId?:string;decisionId:string|null;layoutId:string;sampleClass:'target'|'ordinary'|null;contextSHA256:string|null;eligibility:'eligible'|'excluded';exclusionReason:string|null;targetCoverage?:FirstRoundTargetResult['coverage'];targetReason?:FirstRoundTargetResult['reason'];existenceWitnessCanonicalId?:string|null};
type Metadata={blockFamilyId?:string;decisionId:string;key:SelectedRecordedDecision['key'];inputSHA256:string;sampleKind:'demo'|'keep';sampleClass:'target'|'ordinary';layoutId:string;contextSHA256:string;rank:number};
const sha=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const hex=(x:any)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
// Only this module can associate a cold verified result with an opaque session.
// H owns one session; no JSON flag, serialized proof, or supplied result is trusted.
const reproductionSessions=new WeakMap<object,{catalog:any;results:Map<string,any>}>();
const freezeCopy=(value:any):any=>{const copy=structuredClone(value);const freeze=(v:any):any=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};return freeze(copy);};
const catalogView=(t:Pick<OfflineSelectionTrustedInputs,'references'|'evidenceFiles'>)=>({references:Array.from(t.references.entries()),evidenceFiles:Array.from(t.evidenceFiles.entries())});
export function createOfflineSelectionReproductionSession(catalog:Pick<OfflineSelectionTrustedInputs,'references'|'evidenceFiles'>):object {
 if(!(catalog?.references instanceof Map)||!(catalog?.evidenceFiles instanceof Map))throw Error('selection_session_catalog_required');
 const token=Object.freeze({});reproductionSessions.set(token,{catalog:freezeCopy(catalogView(catalog)),results:new Map()});return token;
}
function reproductionSlot(selection:any,spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs,firstRound:boolean){
 if(!firstRound||t.mode!=='research'||t.phase==='freeze'||!t.task||t.references.get(t.task.capabilityRef)?.id!=='B07.offline-label.v1')return null;
 const session=t.reproductionSession&&reproductionSessions.get(t.reproductionSession);if(!session||!equal(session.catalog,catalogView(t)))return null;
 const identity=digest({selection,spec,task:t.task,phase:t.phase,repositoryRoot:t.repositoryRoot,controlRoot:t.controlRoot,sourceIndexPath:t.sourceIndexPath,confirmedRecordRoots:t.confirmedRecordRoots});return {results:session.results,identity};
}

// BEGIN guarded fixed selection reads
// Process-local, synchronous reads only. A session never stores a live admission
// result. These signals assume the existing sole writer; they are not protection
// against an adversary preserving filesystem metadata while changing bytes.
type FixedReadScope={files:Map<string,string>;records:Set<string>;stores:Map<string,ReturnType<typeof loadOriginalMatchStore>>};
let fixedReadScope:FixedReadScope|null=null;
function fixedFileSignal(path:string){
 const s=lstatSync(path,{bigint:true});
 return [realpathSync(path),s.dev,s.ino,s.mode,s.size,s.mtimeNs,s.ctimeNs].join('|');
}
function noteFixedFile(path:string){
 if(!fixedReadScope)return;
 const signal=fixedFileSignal(path),previous=fixedReadScope.files.get(path);
 if(previous!==undefined&&previous!==signal)fail('selection_fixed_input_changed_during_read');
 fixedReadScope.files.set(path,signal);
}
function fixedFilesUnchanged(files:Map<string,string>){
 try{return [...files].every(([path,signal])=>fixedFileSignal(path)===signal);}catch{return false;}
}
function inheritFixedFiles(files:Map<string,string>){
 if(!fixedReadScope)return;
 for(const [path,signal]of files){const prior=fixedReadScope.files.get(path);if(prior!==undefined&&prior!==signal)fail('selection_fixed_input_changed_during_read');fixedReadScope.files.set(path,signal);}
}
function readFixedProof(slot:{results:Map<string,any>;identity:string}|null,read:()=>any){
 if(!slot)return {value:read(),reused:false,publish:()=>{}};
 const saved=slot.results.get(slot.identity);
 if(saved){if(fixedFilesUnchanged(saved.files)){inheritFixedFiles(saved.files);return {value:structuredClone(saved.value),reused:true,publish:()=>{}};}slot.results.delete(slot.identity);}
 const outer=fixedReadScope,scope:FixedReadScope={files:new Map(),records:new Set(),stores:outer?.stores??new Map()};let value:any;
 fixedReadScope=scope;
 try{value=read();if(!fixedFilesUnchanged(scope.files))fail('selection_fixed_input_changed_during_read');}finally{fixedReadScope=outer;}
 inheritFixedFiles(scope.files);
 return {value,reused:false,publish:()=>{if(!fixedFilesUnchanged(scope.files))fail('selection_fixed_input_changed_during_read');slot.results.set(slot.identity,{files:scope.files,value:freezeCopy(value)});}};
}
function noteFixedRecord(directory:string){
 if(!fixedReadScope||fixedReadScope.records.has(directory))return;
 noteFixedFile(directory);for(const name of readdirSync(directory))if(name==='identity.json'||name==='events.jsonl'||/^(?:game|decision)-[0-9]+\.private\.json$/.test(name))noteFixedFile(join(directory,name));fixedReadScope.records.add(directory);
}
function loadMatchStore(ref:Parameters<typeof loadOriginalMatchStore>[0],root:string){
 if(!fixedReadScope)return loadOriginalMatchStore(ref,root);
 noteFixedRecord(ref.directory);const id=hashJSON([ref,root]);let store=fixedReadScope.stores.get(id);
 if(!store){store=loadOriginalMatchStore(ref,root);fixedReadScope.stores.set(id,store);}return store;
}
function readOfflineSnapshot(row:SelectedRecordedDecision,cache=new Map<string,ReturnType<typeof loadOriginalMatchStore>>(),options?:Parameters<typeof readOriginalOfflineSnapshot>[2]){
 if(fixedReadScope){const id=hashJSON([row.recordRef,row.recordRoot]);noteFixedRecord(row.recordRef.directory);if(!cache.has(id))cache.set(id,loadMatchStore(row.recordRef,row.recordRoot));}
 return readOriginalOfflineSnapshot(row,cache,options);
}
// END guarded fixed selection reads

// BEGIN invocation-local coverage reuse
// Only successful original public predicates are retained, never admission or
// private snapshots. Separate H method invocations never share this scope.
const coverageScopes=new AsyncLocalStorage<{owner:string;closed:boolean;identity:string|null;results:Map<string,{reason:string|null;storeSHA256:string}>;roundProofSession?:object;stage:string;prefixReplays:number}>();
export async function withCoverageEligibilityScope<T>(owner:string,work:()=>Promise<T>,roundProofSession?:object,stage="host-method"):Promise<T>{
 const scope={owner,closed:false,identity:null as string|null,results:new Map<string,{reason:string|null;storeSHA256:string}>(),roundProofSession,stage,prefixReplays:0};
 const started=performance.now();let status="failed";return coverageScopes.run(scope,async()=>{try{const value=await work();status="returned";return value;}finally{scope.closed=true;scope.results.clear();if(roundProofSession)selectionRuntimeTiming({stage,owner,elapsedMs:performance.now()-started,status,prefixReplays:scope.prefixReplays});}});
}
function cachedCoveragePublicReason(row:any,stores:Map<string,ReturnType<typeof loadMatchStore>>,storeHashes:Map<string,string>,identity:string,metrics?:{prefixReplays:number}):string|null{
 const scope=coverageScopes.getStore(),active=scope&&!scope.closed?scope:null;
 if(active&&active.identity!==identity){active.results.clear();active.identity=identity;}
 const key=active?digest({owner:active.owner,identity,row}):null,saved=key?active!.results.get(key):undefined;
 const storeKey=hashJSON([row.recordRef,row.recordRoot]);
 const storeSHA=()=>{if(!storeHashes.has(storeKey)){let store=stores.get(storeKey);if(!store){store=loadMatchStore(row.recordRef,row.recordRoot);stores.set(storeKey,store);}storeHashes.set(storeKey,digest(store.recorder.snapshot()));}return storeHashes.get(storeKey)!;};
 try{
  if(saved){
   // Original loader checks the current record/journal and recorded private
   // input identities once per record in this admission. No prefix replay.
   if(storeSHA()!==saved.storeSHA256)fail('coverage_original_source_changed');
   const path=join(row.recordRef.directory,`decision-${row.key.requestSeq}.private.json`),st=lstatSync(path);
   if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o777)!==0o600)throw Error('private decision requires exact 0600 regular file');
   const input=JSON.parse(readFileSync(path,'utf8'));if(hashJSON(input)!==row.inputSHA256)throw Error('missing original complete selection bundle or input identity');
   return saved.reason;
  }
  if(metrics)metrics.prefixReplays++;if(active)active.prefixReplays++;
  const snapshot=readOfflineSnapshot(row,stores);if(snapshot.bundle.decisionId!==row.decisionId)fail('coverage_original_decision');
  const reason=trainCoveragePublicReason(commonViewForSnapshot(snapshot).modelPayload);
  if(active&&key)active.results.set(key,{reason,storeSHA256:storeSHA()});return reason;
 }catch(error){if(active&&key)active.results.delete(key);throw error;}
}
// END invocation-local coverage reuse

// BEGIN instance-local immutable round proof
// Diagnostics are observational only: original stdout, results and errors are
// untouched, including when the stderr sink cannot accept an observation.
function selectionRuntimeTiming(value:any){try{writeSync(2,JSON.stringify({schema:'ohuo-selection-runtime-timing-v1',...value})+'\n');}catch{}}

// No live admission decision is stored. The token is minted here and retained
// only by one H instance for its first exact Task/run/source identity.
const roundProofSessions=new WeakMap<object,{owner:string;catalog:any;results:Map<string,any>}>();
export function createCommonViewRoundProofSession(task:any,catalog:Pick<OfflineSelectionTrustedInputs,'references'|'evidenceFiles'>):object{
 const token=Object.freeze({});roundProofSessions.set(token,{owner:digest(task),catalog:freezeCopy(catalogView(catalog)),results:new Map()});return token;
}
function roundStaticSlot(t:OfflineSelectionTrustedInputs,immutable:any){
 const scope=coverageScopes.getStore(),token=t.roundProofSession??(scope&&!scope.closed?scope.roundProofSession:undefined),session=token&&roundProofSessions.get(token);
 if(!session||t.mode!=='research'||t.phase==='freeze'||!t.task&&(!scope||scope.closed)||t.task&&digest(t.task)!==session.owner||scope&&!scope.closed&&scope.owner!==session.owner||!equal(session.catalog,catalogView(t)))return null;
 return {results:session.results,identity:digest({owner:session.owner,repositoryRoot:t.repositoryRoot,controlRoot:t.controlRoot,sourceIndexPath:t.sourceIndexPath,phase:t.phase,confirmedRecordRoots:t.confirmedRecordRoots,immutable})};
}
// END instance-local immutable round proof


function fail(reason:string):never {throw Error(reason);}
const key=(x:any)=>canonical(x);
const bytesCompare=(a:string,b:string)=>Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));
const layouts=[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]];
const strict=(x:any,keys:string[],name:string)=>strictObject(x,name,keys);
function pathShape(f:any):asserts f is FixedFile {strict(f,['path','sha256'],'selection_file');if(typeof f.path!=='string'||isAbsolute(f.path)||f.path.split(/[\\/]/).some((s:string)=>!s||s==='.'||s==='..')||!hex(f.sha256))fail('selection_file_identity');}
function fileShape(f:any):asserts f is SelectionEvidenceRef {strict(f,['id','sha256'],'selection_evidence');if(typeof f.id!=='string'||!f.id.trim()||!hex(f.sha256))fail('selection_evidence_identity');}
function regular(path:string){noteFixedFile(path);const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||realpathSync(path)!==path||s.size>32*1024*1024)fail('selection_regular_file_required');return readFileSync(path);}
function fileBytes(f:SelectionEvidenceRef,t:OfflineSelectionTrustedInputs){fileShape(f);const p=t.evidenceFiles.get(f.id);if(!p||p.sha256!==f.sha256)fail('selection_file_not_in_fixed_catalog');pathShape(p);const b=regular(resolve(t.repositoryRoot,p.path));if(sha(b)!==f.sha256)fail('selection_file_identity');return b;}
const jsonFile=(f:SelectionEvidenceRef,t:OfflineSelectionTrustedInputs)=>JSON.parse(fileBytes(f,t).toString('utf8'));
function refValue(ref:string,t:OfflineSelectionTrustedInputs){fixedReference(ref,'selection_reference');const v=t.references.get(ref);if(v===undefined||digest(v)!==ref.split(':').at(-1))fail('selection_reference_identity');return structuredClone(v);}
function validateSpec(spec:any):asserts spec is OfflineSelectionSpec {
 strict(spec,['schema','planRef','clauseRef','branchRef','sourceIndexRef','queueRef','sourceRunRefs','targetDefinitionRef','selectionRuleRef','quotaBasisRef','purpose','actingReleaseRef','outputId',...(spec?.schema===COMMON_VIEW_ROUND_SPEC_SCHEMA?['roundContractRef']:spec?.schema===DESIGNED_SELECTION_SPEC_SCHEMA?['designedContractRef']:[])],'selection_spec');
 if(!['ohuo-offline-selection-spec-v1',COMMON_VIEW_ROUND_SPEC_SCHEMA,DESIGNED_SELECTION_SPEC_SCHEMA].includes(spec.schema)||!['b_training_source','distribution_diagnostic'].includes(spec.purpose))fail('selection_spec_schema');
 for(const k of ['planRef','clauseRef','sourceIndexRef','queueRef','targetDefinitionRef','selectionRuleRef','actingReleaseRef'])fixedReference(spec[k],k);if(spec.branchRef!==null)fixedReference(spec.branchRef,'branchRef');
 if(spec.schema===COMMON_VIEW_ROUND_SPEC_SCHEMA)fixedReference(spec.roundContractRef,'roundContractRef');if(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA)fixedReference(spec.designedContractRef,'designedContractRef');
 validateIdentifier(spec.outputId,'outputId');fileShape(spec.quotaBasisRef);if(!Array.isArray(spec.sourceRunRefs)||spec.sourceRunRefs.length>10000)fail('selection_source_run_refs');spec.sourceRunRefs.forEach(fileShape);if(new Set(spec.sourceRunRefs.map((f:SelectionEvidenceRef)=>f.id)).size!==spec.sourceRunRefs.length)fail('selection_duplicate_source_run');
}
function rootLocation(path:string,repositoryRoot:string){const r=relative(repositoryRoot,path);if(!r||isAbsolute(r)||r.startsWith('..')||resolve(path)!==path)fail('selection_trusted_root');for(let p=path;p!==repositoryRoot;p=dirname(p)){let st;try{st=lstatSync(p);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}if(st.isSymbolicLink()||!st.isDirectory()||realpathSync(p)!==p)fail('selection_trusted_root');}}
function validateTrusted(t:OfflineSelectionTrustedInputs){if(t?.screenRevalidation!==undefined)screenRevalidationStatePath(t);if(!t||!['research','offline_synthetic'].includes(t.mode)||!['freeze','label-start','label-resume','dataset'].includes(t.phase)||!(t.references instanceof Map)||!(t.evidenceFiles instanceof Map)||!Array.isArray(t.confirmedRecordRoots)||realpathSync(t.repositoryRoot)!==t.repositoryRoot)fail('selection_trusted_inputs_required');const sourceRelative=relative(t.repositoryRoot,t.sourceIndexPath);if(!sourceRelative||isAbsolute(sourceRelative)||sourceRelative.startsWith('..')||realpathSync(t.sourceIndexPath)!==t.sourceIndexPath)fail('selection_source_index_path');for(const p of [t.controlRoot,...t.confirmedRecordRoots]){rootLocation(p,t.repositoryRoot);if(p===t.controlRoot&&!existsSync(p))fail('selection_trusted_root');}}
/** A target is an opportunity, never a label. Legacy synthetic classification
 * remains confined to its old definition; only the named first round reads the
 * original replay snapshot and its independently rule-verified witnesses. */
export function classifyApprovedTarget(snapshot:{ownHand?:unknown}&Partial<FirstRoundTargetSnapshot>,definition:any,mode:string):{sampleClass:'target'|'ordinary'|null;target?:FirstRoundTargetResult} {
 if(definition?.id==='first-round-partner-control-v1'){
  const target=classifyFirstRoundTarget(snapshot as FirstRoundTargetSnapshot,definition);
  return {sampleClass:target.sampleClass,target};
 }
 if(mode!=='offline_synthetic'||!equal(definition,{schema:'ohuo-approved-public-target-v1',id:'synthetic-own-rank-2-v1',scope:'offline_synthetic',field:'ownHand',rule:'contains-rank-2'}))fail('target_definition_unimplemented');
 if(!Array.isArray(snapshot.ownHand)||snapshot.ownHand.some((c:any)=>!Number.isSafeInteger(c.rank)||!Number.isSafeInteger(c.count)))fail('target_public_observation_unclassifiable');
 return {sampleClass:(snapshot.ownHand as any[]).some((c:any)=>c.rank===2)?'target':'ordinary'};
}
function quotas(value:any,name:string):Quota[]{if(!Array.isArray(value)||!value.length||value.length>20)fail(name);const seen=new Set<string>();for(const q of value){strict(q,['familyId','split','count'],name);validateSourceFamily(q.familyId,'familyId');if(seen.has(q.familyId)||!['train','dev'].includes(q.split)||!Number.isSafeInteger(q.count)||q.count<0||q.count>32)fail(name);seen.add(q.familyId);}return [...value].sort((a,b)=>bytesCompare(a.familyId,b.familyId));}
// The first round has pre-frozen distinct source namespaces, not one global
// label population. Keep every same-namespace exposure check; legacy is unchanged.
export function labelRuns(state:any,spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs){
 const budgetRef=jsonFile(spec.quotaBasisRef,t).budgetRef,rule=refValue(spec.selectionRuleRef,t),firstRound=[COMMON_VIEW_SELECTION_SCHEMA,DESIGNED_SELECTION_RULE_SCHEMA,'ohuo-offline-selection-first-round-rule-v1','ohuo-offline-selection-first-round-pilot-rule-v1'].includes(rule?.schema),namespace=firstRound?refValue(spec.sourceIndexRef,t).namespace:null;
 return Object.values(state.runs??{}).filter((r:any)=>{
  if(r.task?.planRef!==spec.planRef||r.task?.budgetRef!==budgetRef||refValue(r.task.capabilityRef,t)?.id!=='B07.offline-label.v1')return false;
  if(!firstRound||r.task.sourcePlan?.namespace===namespace)return true;
  if(knownUnsentWorldPreparationFailure(r,state,t.controlRoot,(ref:string)=>refValue(ref,t)))return false;
  const cp=r.checkpoint,rs=Object.values(state.budgets?.[budgetRef]?.reservations??{}).filter((x:any)=>x.runId===r.runId) as any[];
  if(typeof namespace!=='string'||!namespace||typeof r.task.sourcePlan?.namespace!=='string'||!r.task.sourcePlan.namespace||!['completed','failed','interrupted'].includes(r.status)||r.cleanupConfirmed!==true||r.executionUnknown===true||r.observationStatus==='unknown'||r.stopReason==='execution_uncertain'||r.failureReason==='execution_uncertain'||cp?.executionUnknown===true||cp?.active!=null||(cp?.rows??[]).some((row:any)=>row.requestCount===null)||rs.some(x=>['reserved','reserved_unknown'].includes(x.status)))fail('selection_execution_uncertain');
  return false;
 }) as any[];
}
function hasExposure(run:any,state:any,t:OfflineSelectionTrustedInputs){if(knownUnsentWorldPreparationFailure(run,state,t.controlRoot,(ref:string)=>refValue(ref,t)))return false;const budget=state.budgets?.[run.task?.budgetRef];return run.checkpoint?.active!==null&&run.checkpoint?.active!==undefined||run.checkpoint?.executionUnknown===true||(run.checkpoint?.rows??[]).some((r:any)=>r.requestCount===null||r.requestCount>0)||Object.values(budget?.reservations??{}).some((r:any)=>r.runId===run.runId&&r.cost?.providerRequests>0&&r.status!=='released');}
function inputs(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs):any{
 if(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA)return designedInputs(spec,t);
 validateSpec(spec);validateTrusted(t);for(const r of [spec.planRef,spec.clauseRef,...(spec.branchRef?[spec.branchRef]:[])])refValue(r,t);
 const rule=refValue(spec.selectionRuleRef,t),commonView=rule?.schema===COMMON_VIEW_SELECTION_SCHEMA,pilot=rule?.schema==='ohuo-offline-selection-first-round-pilot-rule-v1',firstRound=commonView||pilot||rule?.schema==='ohuo-offline-selection-first-round-rule-v1';
 const commonRule={targetDefinitionRef:spec.targetDefinitionRef,layoutOrder:layouts,hashAlgorithm:'sha256',hashInput:'decisionId-utf8-no-normalization',hashTieBreak:'decisionId-utf8-bytes-then-canonical-DecisionKey',keepRule:'same-count-ordinary-disjoint-context'};
 const laterRound=spec.schema===COMMON_VIEW_ROUND_SPEC_SCHEMA,roundContract=laterRound?refValue(spec.roundContractRef!,t):null;
 if(laterRound&&(!commonView||roundContract?.schema!==COMMON_VIEW_ROUND_CONTRACT_SCHEMA||!Number.isSafeInteger(roundContract.round)||roundContract.round<1))fail('selection_later_round_contract');
 const expectedRule=commonView?{schema:COMMON_VIEW_SELECTION_SCHEMA,...commonRule,protocolRef:rule.protocolRef,comparisonRef:rule.comparisonRef,targetQuotaRounding:'one-hash-representative-per-observed-public-cell',representativeRule:roundContract?.coverageRevisionRef&&refValue(roundContract.coverageRevisionRef,t).selectionPolicy===TRAIN_PUBLIC_STRATA_POLICY?'six-public-dimensions-v2':'four-public-dimensions-v1',representativeRound:laterRound?roundContract.round:0,...(roundContract?.coverageRevisionRef?{coverageRevisionRef:roundContract.coverageRevisionRef}:{}),ordinaryShortfall:'not-demo',familySplitRule:'frozen-source-index-split',postValidationKeepRule:'same-split-frozen-rank-prefix-equal-valid-demo'}:pilot?{schema:'ohuo-offline-selection-first-round-pilot-rule-v1',...commonRule,purpose:'cost-pilot-only',pilotNamespace:rule.pilotNamespace,comparisonRef:rule.comparisonRef,targetQuotaRounding:'all-target-up-to-frozen-quota',ordinaryShortfall:'not-demo',keepRule:'none-cost-pilot-only',familySplitRule:'pilot-train-only-no-training-admission',postValidationKeepRule:'none-cost-pilot-only'}:firstRound?{schema:'ohuo-offline-selection-first-round-rule-v1',...commonRule,comparisonRef:rule.comparisonRef,targetQuotaRounding:'all-target-up-to-frozen-quota',ordinaryShortfall:'not-demo',familySplitRule:'sha256-familyId-utf8-first-two-dev',postValidationKeepRule:'same-split-frozen-rank-prefix-equal-valid-demo'}:{schema:'ohuo-offline-selection-rule-v1',...commonRule,targetQuotaRounding:'floor-half',ordinaryShortfall:'report-no-extra-target'};
 if(!equal(rule,expectedRule))fail('selection_rule_unimplemented');
 if(commonView){readCommonViewProtocol(rule.protocolRef,(r:string)=>refValue(r,t));if(t.task&&t.task.scientificContract?.analysisMethodRef!==rule.protocolRef)fail('selection_protocol_task_binding');}
 if(pilot&&(typeof rule.pilotNamespace!=='string'||!rule.pilotNamespace||rule.pilotNamespace.trim()!==rule.pilotNamespace))fail('selection_pilot_namespace');
 const definition=refValue(spec.targetDefinitionRef,t);
 let comparison:any=null,parent:ReturnType<typeof validateFirstRoundParentEnvelope>|null=null;
 if(firstRound){
  validateFirstRoundTargetDefinition(definition);if(spec.purpose!=='b_training_source')fail('selection_first_round_source_purpose');
  comparison=refValue(rule.comparisonRef,t);strict(comparison,['schema','proposalRef','studentParentRef'],'selection_first_round_comparison');
  if(comparison.schema!=='ohuo-first-round-comparison-v1'||comparison.proposalRef!==spec.actingReleaseRef)fail('selection_first_round_comparison_identity');
  parent=validateFirstRoundParentEnvelope({parentRef:comparison.studentParentRef,envelope:refValue(comparison.studentParentRef,t),readEvidence:f=>fileBytes(f,t)});
 }else {if(definition?.id==='first-round-partner-control-v1')fail('selection_rule_unimplemented');classifyApprovedTarget({ownHand:[]},definition,t.mode);}
 const quota=jsonFile(spec.quotaBasisRef,t);strict(quota,['schema','planRef','budgetRef','controlStateRef','stage2Stage3AccountingRefs',...(commonView?['protocolRef','families']:['originalQuotas','frozenQuotas']),'reasonRef','freezeEvidenceRef'],'quota_basis');
 if(quota.schema!==(commonView?COMMON_VIEW_SOURCE_BASIS_SCHEMA:'ohuo-selection-quota-basis-v1')||quota.planRef!==spec.planRef||commonView&&quota.protocolRef!==rule.protocolRef)fail('selection_quota_basis_identity');const budget=refValue(quota.budgetRef,t);if(budget.planRef!==spec.planRef||budget.controlRoot!==t.controlRoot)fail('selection_budget_binding');
 const original:Quota[]=commonView?readCommonViewSourceFamilies(quota.families):quotas(quota.originalQuotas,'selection_original_quotas'),frozen:Quota[]=commonView?structuredClone(original):quotas(quota.frozenQuotas,'selection_frozen_quotas');if(!firstRound&&t.mode==='research'&&spec.purpose==='b_training_source'&&(original.filter(q=>q.split==='train').length!==16||original.filter(q=>q.split==='dev').length!==4))fail('selection_original_family_coverage');if(!equal(original.map(({familyId,split})=>({familyId,split})),frozen.map(({familyId,split})=>({familyId,split})))||frozen.some(q=>q.count>original.find(o=>o.familyId===q.familyId)!.count))fail('selection_quota_coverage');
 if(pilot){
  if(original.length!==2||original.some(q=>q.split!=='train'||q.count>8)||original.reduce((n,q)=>n+q.count,0)>16)fail('selection_first_round_pilot_family_coverage');
 }else if(firstRound&&!commonView){
  if(original.length!==4||original.filter(q=>q.split==='train').length!==2||original.filter(q=>q.split==='dev').length!==2||original.some(q=>q.count>8))fail('selection_first_round_family_coverage');
  const byHash=[...original].sort((a,b)=>bytesCompare(sha(a.familyId),sha(b.familyId))||bytesCompare(a.familyId,b.familyId));
  if(byHash.some((q,i)=>q.split!==(i<2?'dev':'train')))fail('selection_first_round_family_split');
 }
 if(!Array.isArray(quota.stage2Stage3AccountingRefs))fail('selection_accounting_missing');quota.stage2Stage3AccountingRefs.forEach((f:SelectionEvidenceRef)=>fileBytes(f,t));jsonFile(quota.reasonRef,t);if(!equal(original,frozen))fail('selection_quota_reduction_unimplemented'); // No original approved reduction algorithm has been supplied; do not invent one.
 const state=jsonFile(quota.controlStateRef,t);if(state.schemaVersion!==1||!state.runs||!state.tasks||!state.budgets?.[quota.budgetRef]||state.budgets[quota.budgetRef].planRef!==spec.planRef)fail('selection_control_state_missing');
 if(state.batches?.[budget.researchBatchId]?.budgetRef!==quota.budgetRef||state.batches[budget.researchBatchId].planRef!==spec.planRef||state.batches[budget.researchBatchId].authorizationRef!==budget.authorizationRef)fail('selection_original_batch_budget_binding');
 const ledger=state.budgets[quota.budgetRef];if(!equal(ledger.limits,budget.limits)||ledger.authorizationRef!==budget.authorizationRef||ledger.researchBatchId!==budget.researchBatchId||!ledger.used||!ledger.reservations)fail('selection_budget_state_binding');
 for(const k of ['providerRequests','optimizerSteps','matchAttempts','labelDecisions'])if(!Number.isSafeInteger(ledger.used[k])||ledger.used[k]<0)fail('selection_budget_remaining_unknown');
 const reservations=Object.values(ledger.reservations) as any[];if(reservations.some(r=>!['released','reserved','consumed','committed'].includes(r.status)))fail('selection_budget_remaining_unknown');
 if(!commonView){const needed=frozen.reduce((n,q)=>n+q.count,0);for(const [counter,limit] of [['providerRequests','maxProviderRequests'],['labelDecisions','maxLabelDecisions']]){const occupied=reservations.filter(r=>r.status==='reserved').reduce((n,r)=>{if(!Number.isSafeInteger(r.cost?.[counter])||r.cost[counter]<0)fail('selection_budget_remaining_unknown');return n+r.cost[counter];},0);if(!Number.isSafeInteger(budget.limits?.[limit])||budget.limits[limit]-ledger.used[counter]-occupied<needed)fail('selection_budget_cannot_cover_frozen_quotas');}}
 if(ledger.used.providerRequests>0&&!quota.stage2Stage3AccountingRefs.length)fail('selection_previous_accounting_refs_missing');
 const evidence=jsonFile(quota.freezeEvidenceRef,t);strict(evidence,['schema','planRef','clauseRef','branchRef','budgetRef','controlRoot','controlStateRef'],'prequery_evidence');if(!equal(evidence,{schema:'ohuo-selection-prequery-v1',planRef:spec.planRef,clauseRef:spec.clauseRef,branchRef:spec.branchRef,budgetRef:quota.budgetRef,controlRoot:t.controlRoot,controlStateRef:quota.controlStateRef}))fail('selection_prequery_evidence_identity');
 const roundAdmission=laterRound?verifyCommonViewRoundAdmission(spec,t,state):null;
 if(!laterRound&&labelRuns(state,spec,t).some(r=>hasExposure(r,state,t)))fail('selection_label_exposure_before_freeze');
 if(t.phase==='freeze'&&!equal(JSON.parse(regular(screenRevalidationStatePath(t)).toString()),state))fail('selection_prequery_state_changed');
 const indexRef=refValue(spec.sourceIndexRef,t),indexBytes=regular(t.sourceIndexPath),index=JSON.parse(indexBytes.toString());if(indexRef.schema!=='ohuo-source-index-ref-v1'||indexRef.fileSHA256!==sha(indexBytes)||index.version!==1||frozen.some(q=>index.families?.[q.familyId]?.split!==q.split))fail('selection_source_index_binding');
 strict(indexRef,['schema','namespace','fileSHA256'],'selection_source_index_ref');
 if(pilot&&indexRef.namespace!==rule.pilotNamespace)fail('selection_pilot_namespace');
 const queue=refValue(spec.queueRef,t);strict(queue,['schema','namespace','sourceIndexRef','rows'],'selection_queue');if(queue.schema!=='ohuo-complete-match-queue-v1'||queue.sourceIndexRef!==spec.sourceIndexRef||queue.namespace!==indexRef.namespace||!Array.isArray(queue.rows)||!queue.rows.length||queue.rows.length>10000)fail('selection_source_queue_binding');
 const rawActing=refValue(spec.actingReleaseRef,t),acting=spec.purpose==='b_training_source'&&rawActing.schema===CANDIDATE_RESEARCH_RELEASE_SCHEMA?resolveCandidateReleaseRef(rawActing,ref=>refValue(ref,t),RELEASES):rawActing;if(spec.purpose==='b_training_source'&&(!['ohuo-release-ref-v1',CANDIDATE_RESEARCH_RELEASE_SCHEMA].includes(rawActing.schema)||acting.release?.localSelector!=='proposal'||acting.release?.mode!=='local'||acting.release?.tier!=='hard'))fail('selection_acting_B_identity');
 if(spec.purpose==='distribution_diagnostic'&&(acting.schema!=='ohuo-student-task-release-v1'||frozen.length!==4||frozen.some(q=>q.split!=='train'||q.count>16)||frozen.reduce((n,q)=>n+q.count,0)>64))fail('selection_diagnostic_scope');
 if(firstRound&&(rawActing.schema!==CANDIDATE_RESEARCH_RELEASE_SCHEMA||resolveCandidatePolicy(acting.candidatePolicy).candidateSpec!==FIRST_TARGET_CANDIDATE_SPEC||!equal(parent!.basePolicyIdentity,acting.policyIdentity)))fail('selection_first_round_proposer_identity');
 return {quota,original,frozen,state,queue,definition,acting,firstRound,pilot,commonView,comparison,parent,rule,index,roundAdmission};
}
function enumerate(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs,x=inputs(spec,t)){
 if(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA)return enumerateDesignedSelection(spec,t);
 if(x.roundAdmission)return enumerateLaterRound(spec,t,x);
 const inventory:any[]=[],population:PopulationRow[]=[],exclusions:any[]=[],cache=new Map();let incomplete=false;
 const originalPlan=refValue(spec.planRef,t),actions=x.commonView?refValue(x.rule.protocolRef,t).actions:originalPlan.actions??(originalPlan.actionsRef?refValue(originalPlan.actionsRef,t).actions:undefined);if(!Array.isArray(actions))fail('selection_original_plan_actions_missing');
 const plannedTasks:Array<{ref:string;task:any}>=[];
 const sourceActions=x.firstRound?verifySourceActionInventory({spec,references:t.references,actions,tasks:[...t.references].filter(([,v]:any)=>v?.schemaVersion===1&&v.planRef===spec.planRef&&v.seatLayoutPlan===spec.queueRef&&v.sourcePlan?.sourceIndexRef===spec.sourceIndexRef&&['collect','evaluate'].includes(v.taskKind)&&t.references.get(v.capabilityRef)?.id==='B07.complete-match.v1').map(([taskRef,task])=>({taskRef,task}))}):actions;
 for(const action of sourceActions)if(action.expectedArtifactKinds?.includes('ohuo-match-summary-v1')){if(!Array.isArray(action.plannedTaskIds))fail('selection_original_source_action_tasks');for(const id of action.plannedTaskIds){const candidates=[...t.references.values()].filter((v:any)=>v?.schemaVersion===1&&v.planRef===spec.planRef&&v.taskId===id&&v.planScope?.clauseRef===action.clauseRef&&v.planScope?.branchRef===action.branchRef);if(candidates.length>1)fail('selection_ambiguous_planned_source_task');if(!candidates.length){incomplete=true;exclusions.push({decisionId:null,key:null,familyId:null,reason:'planned_source_task_definition_missing:'+id,expected:1,actual:0});}}}
 for(const [ref,value] of t.references){if(value?.schemaVersion!==1||value.planRef!==spec.planRef||value.seatLayoutPlan!==spec.queueRef||value.sourcePlan?.sourceIndexRef!==spec.sourceIndexRef||!['collect','evaluate'].includes(value.taskKind))continue;const task=refValue(ref,t);if(refValue(task.capabilityRef,t)?.id!=='B07.complete-match.v1')continue;const a=actions.filter((a:any)=>a.clauseRef===task.planScope?.clauseRef&&a.branchRef===task.planScope?.branchRef);if(a.length!==1||!Array.isArray(a[0].plannedTaskIds)||!a[0].plannedTaskIds.includes(task.taskId))fail('selection_source_task_not_in_original_plan');if(plannedTasks.some(p=>p.task.taskId===task.taskId))fail('selection_duplicate_planned_source_task');plannedTasks.push({ref,task});}
 for(const {task} of plannedTasks){const action=actions.find((a:any)=>a.clauseRef===task.planScope.clauseRef&&a.branchRef===task.planScope.branchRef);for(const id of action.plannedTaskIds)if(![...t.references.values()].some((v:any)=>v?.schemaVersion===1&&v.planRef===spec.planRef&&v.taskId===id)){incomplete=true;exclusions.push({decisionId:null,key:null,familyId:null,reason:'planned_source_task_definition_missing:'+id,expected:1,actual:0});}}
 if(!plannedTasks.length)incomplete=true;
 const runs=new Map<string,{ref:SelectionEvidenceRef;run:any}>();for(const f of spec.sourceRunRefs){const run=jsonFile(f,t);if(!run?.runId||runs.has(run.runId))fail('selection_source_run_identity');const original=x.state.runs[run.runId];if(!original||['task','taskRef','taskSHA256','checkpoint','checkpointSHA256','checkpointRef','status','cleanupConfirmed'].some(k=>!equal(run[k],original[k]))||run.taskSHA256!==digest(run.task)||run.taskRef?.split(':').at(-1)!==run.taskSHA256||run.task.seatLayoutPlan!==spec.queueRef||run.task.sourcePlan?.sourceIndexRef!==spec.sourceIndexRef||run.checkpoint&&(digest(run.checkpoint)!==run.checkpointSHA256||run.checkpoint.schema!=='ohuo-match-run-v1'||run.checkpoint.taskSHA256!==run.taskSHA256||run.checkpoint.queueRef!==spec.queueRef||!Array.isArray(run.checkpoint.matches)||run.checkpoint.cursor!==run.checkpoint.matches.length))fail('selection_source_run_identity');runs.set(run.runId,{ref:f,run});}
 for(const {run} of runs.values())if((run.checkpoint?.matches??[]).some((m:any)=>!x.queue.rows.some((q:any)=>q.matchId===m.matchId)))fail('selection_source_run_queue_coverage');
 const expectedRuns=Object.values(x.state.runs).filter((r:any)=>plannedTasks.some(p=>p.ref===r.taskRef&&equal(p.task,r.task))) as any[];if(plannedTasks.some(p=>!expectedRuns.some(r=>r.taskRef===p.ref)))incomplete=true;
 if(expectedRuns.some(r=>!runs.has(r.runId)))incomplete=true;
 if([...runs.values()].some(({run})=>!expectedRuns.some(r=>r.runId===run.runId)))fail('selection_non_source_run');
 if(x.firstRound)for(const {task} of plannedTasks)if(task.taskKind!=='collect'||task.parentPolicyRef!==spec.actingReleaseRef||task.scientificContract?.comparisonRef!==x.rule.comparisonRef)fail('selection_first_round_source_task_identity');
 const seenMatches=new Set<string>(),familyLayouts=new Map<string,Set<string>>(),sourceFamilies=new Map<string,string>(),dealBlocks=new Map<string,string>();
 const work=[...x.queue.rows].sort((a:any,b:any)=>bytesCompare(a.matchId,b.matchId)).map(q=>{
  strict(q,['matchId','layoutId','sourceFamilyId','split','seed','dealNamespace','roundFamilyIds','actor','metric','group','side','variant','maxGames','maxMovesPerGame','seats'],'selection_queue_row');validateIdentifier(q.matchId,'matchId');validateIdentifier(q.layoutId,'layoutId');
  if(!['train','dev'].includes(q.split)||!Number.isSafeInteger(q.seed)||!Number.isSafeInteger(q.maxGames)||q.maxGames<1||!Number.isSafeInteger(q.maxMovesPerGame)||q.maxMovesPerGame<1||['dealNamespace','metric','variant'].some(k=>typeof q[k]!=='string'||!q[k])||!Array.isArray(q.roundFamilyIds)||q.roundFamilyIds.length!==q.maxGames||q.roundFamilyIds[0]!==q.sourceFamilyId||!Array.isArray(q.seats)||q.seats.length!==4)fail('selection_queue_metadata');
  for(const seat of q.seats){strict(seat,['releaseRef','mode','profileRevisionRef'],'selection_queue_seat');fixedReference(seat.releaseRef,'seat.releaseRef');if(!['local','hybrid'].includes(seat.mode)||seat.mode==='local'&&seat.profileRevisionRef!==null)fail('selection_queue_seat');if(seat.mode==='hybrid'){strict(seat.profileRevisionRef,['profileId','revision','snapshotHash'],'selection_queue_profile');if(typeof seat.profileRevisionRef.profileId!=='string'||!seat.profileRevisionRef.profileId||!Number.isSafeInteger(seat.profileRevisionRef.revision)||seat.profileRevisionRef.revision<1||!hex(seat.profileRevisionRef.snapshotHash))fail('selection_queue_profile');}}
  if(seenMatches.has(q.matchId)||!layouts.some(([g,s])=>q.group===g&&q.side===s)||!Number.isInteger(q.actor)||q.actor<0||q.actor>3||!Array.isArray(q.roundFamilyIds)||!q.roundFamilyIds.length||typeof q.layoutId!=='string'||!q.layoutId)fail('selection_queue_row_identity');seenMatches.add(q.matchId);
  if(x.firstRound&&q.actor!==q.side)fail('selection_first_round_evaluated_actor');
  // A quota is one independently frozen match-root block, not every future
  // deal in its immutable queue ancestry. Replay still receives the actual deal.
  if(x.firstRound)for(const f of new Set(q.roundFamilyIds) as Set<string>){
   validateSourceFamily(f,'roundFamilyIds');const binding=key([q.sourceFamilyId,q.split]),previous=dealBlocks.get(f);
   if(previous&&previous!==binding)fail('selection_first_round_deal_block_leakage');dealBlocks.set(f,binding);
   if(x.index.families?.[f]?.split!==q.split)fail('selection_first_round_deal_split');
  }
  for(const f of new Set(x.firstRound?[q.sourceFamilyId]:q.roundFamilyIds) as Set<string>){const quota=x.frozen.find(z=>z.familyId===f&&z.split===q.split);if(!quota)fail('selection_queue_family_scope');const set=familyLayouts.get(f)??new Set();set.add(`${q.group}:${q.side}`);familyLayouts.set(f,set);}
  const locations=[...runs.values()].flatMap(({ref,run})=>(run.checkpoint?.matches??[]).filter((m:any)=>m.matchId===q.matchId).map((m:any)=>({ref,run,m})));if(locations.length>1)fail('selection_duplicate_match_source');
  const owners=plannedTasks.filter(r=>r.task.sourcePlan.split===q.split&&r.task.sourcePlan.familyIds.includes(q.sourceFamilyId));if(owners.length!==1)incomplete=true;
  const source=locations[0];if(source&&(owners.length!==1||source.run.taskRef!==owners[0].ref))fail('selection_source_task_projection');const ownerRun=owners.length===1?expectedRuns.find(r=>r.taskRef===owners[0].ref):undefined,ownerRef=ownerRun?runs.get(ownerRun.runId)?.ref:null,base={matchId:q.matchId,queueRowDigest:digest(q),runRef:source?.ref??ownerRef??null,recordRef:source?.m.recordRef??null,recordRoot:source?.run.task.outputRoot??ownerRun?.task.outputRoot??null};
  return {q,source,ownerRun,ownerRef,base};
 });
 for(const {task} of plannedTasks){const owned=work.filter(w=>w.q.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(w.q.sourceFamilyId));if(task.sourcePlan.familyIds.some((id:string)=>!owned.some(w=>w.q.roundFamilyIds.includes(id)))||owned.some(w=>w.q.roundFamilyIds.some((id:string)=>!task.sourcePlan.familyIds.includes(id))))fail('selection_source_task_ancestry');}
 for(const {q,source,ownerRun,ownerRef,base} of work){
  if(!source){const status=!ownerRun?'not_executed':!ownerRef?'missing':ownerRun.cleanupConfirmed!==true?'unknown':ownerRun.status==='failed'?'failed':'incomplete';inventory.push({...base,status,reason:ownerRun?.failureReason??ownerRun?.stopReason??'source_run_or_match_missing'});incomplete=true;continue;}
  const {run,m}=source,native=x.state.runs[run.runId],sourceLedger=x.state.budgets?.[run.task.budgetRef];
  const sourceSettled=['completed','failed','interrupted'].includes(run.status)&&run.cleanupConfirmed===true&&run.checkpoint?.active===null&&run.checkpoint?.executionUnknown===false&&sourceLedger&&sourceLedger.activeRunId!==run.runId&&!Object.values(sourceLedger.reservations??{}).some((r:any)=>r.runId===run.runId&&['reserved','reserved_unknown'].includes(r.status))&&[native,run].every(r=>r.executionUnknown!==true&&r.observationStatus!=='unknown'&&r.failureReason!=='execution_uncertain'&&r.stopReason!=='execution_uncertain');
  if(!sourceSettled){inventory.push({...base,status:'unknown',reason:'source_writer_or_execution_unsettled'});incomplete=true;continue;}
  const sourceRoot=run.task.outputRoot;rootLocation(sourceRoot,t.repositoryRoot);if(!existsSync(sourceRoot)){inventory.push({...base,status:'missing',reason:'source_record_root_missing'});incomplete=true;continue;}
  if(!t.confirmedRecordRoots.includes(sourceRoot)||realpathSync(sourceRoot)!==sourceRoot)fail('selection_record_root_untrusted');
  let record:any;try{const store=loadMatchStore(m.recordRef,run.task.outputRoot);cache.set(hashJSON([m.recordRef,run.task.outputRoot]),store);record=store.resume!.record;}catch(e){inventory.push({...base,status:'missing',reason:'source_record_unavailable:'+String((e as Error).message)});incomplete=true;continue;}
  if(record.matchId!==q.matchId||record.runId!==run.runId||record.sourceRef!==spec.sourceIndexRef||record.layoutRef!==spec.queueRef||record.split!==q.split||record.evaluatedActor!==q.actor||q.seats?.[q.actor]?.releaseRef!==spec.actingReleaseRef)fail('selection_record_queue_identity');
  if(x.firstRound)for(const game of record.games){
   const family=q.roundFamilyIds[game.gameNo-1];if(!family||game.sourceFamilyId!==family)fail('selection_game_family_identity');
   const binding=key([q.sourceFamilyId,q.split]),previous=sourceFamilies.get(game.sourceSHA256);if(previous&&previous!==binding)fail('selection_first_round_source_family_leakage');sourceFamilies.set(game.sourceSHA256,binding);
  }
  let checkpointEvidenceValid=false;try{checkpointEvidenceValid=run.checkpointRef===join(run.task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)&&digest(JSON.parse(regular(run.checkpointRef).toString()))===run.checkpointSHA256;}catch{}
  const ledger=x.state.budgets?.[run.task.budgetRef],clean=checkpointEvidenceValid&&run.cleanupConfirmed===true&&run.checkpoint?.active===null&&run.checkpoint?.executionUnknown===false&&ledger&&ledger.activeRunId!==run.runId&&!Object.values(ledger.reservations??{}).some((r:any)=>r.runId===run.runId&&['reserved','reserved_unknown'].includes(r.status)),complete=run.status==='completed'&&clean&&m.result?.complete===true&&record.summary?.complete===true;
  inventory.push({...base,status:complete?'completed':!clean?'unknown':run.status==='failed'?'failed':'incomplete',reason:complete?null:run.failureReason??run.stopReason??m.result?.incompleteReason??'source_match_incomplete'});if(!complete)incomplete=true;
  for(const d of record.decisions){if(d.key.actorSeat!==q.actor||d.executionKind!=='confirmed')continue;const family=q.roundFamilyIds[d.key.gameNo-1];if(!family||record.games.find((g:any)=>g.gameNo===d.key.gameNo)?.sourceFamilyId!==family)fail('selection_game_family_identity');
   const row:SelectedRecordedDecision&{blockFamilyId?:string}={recordRef:m.recordRef,recordRoot:run.task.outputRoot,key:d.key,inputSHA256:d.trainingInputSHA256,familyId:family,split:q.split,actorSeat:q.actor,...(x.firstRound?{blockFamilyId:q.sourceFamilyId}:{})};let decisionId:string|null=null,sampleClass:PopulationRow['sampleClass']=null,contextSHA256:string|null=null,reason:string|null=null,target:FirstRoundTargetResult|undefined,commonViewCell:ReturnType<typeof commonViewCoverageCell>|undefined;
   try{const s=readOfflineSnapshot(row,cache),p=s.input,c=p.candidateInputs,seat=s.record.seatSnapshots?.[q.actor] as any;decisionId=s.bundle.decisionId;
    if(!c||validateCapturedCandidateContract(p,s.bundle)!==resolveCandidatePolicy(spec.purpose==='b_training_source'?x.acting.candidatePolicy:seat?.studentRelease?.candidatePolicy)||c.inputDim!==399||!equal(d.initialCandidateIds,s.bundle.initialCandidateIds))fail('selection_original_c_identity');
    if(spec.purpose==='b_training_source'&&(p.policyId!==x.acting.policyIdentity.policyId||d.policyId!==p.policyId||!equal(c.policyIdentity,x.acting.policyIdentity)||!equal(seat?.policyIdentity,x.acting.policyIdentity)||seat?.releaseRef!==spec.actingReleaseRef||d.actualSource!=='B'))fail('selection_B_identity');
    if(spec.purpose==='distribution_diagnostic'&&(p.policyId!==x.acting.policyId||d.policyId!==x.acting.policyId||d.actualSource!=='S'||seat?.releaseRef!==spec.actingReleaseRef||seat?.studentReleaseSHA256!==x.acting.releaseSHA256||seat?.studentRelease?.policyId!==x.acting.policyId||!equal(c.policyIdentity,seat?.studentRelease?.proposer?.identity)))fail('selection_S_identity');
    if(x.firstRound){
     const captured=p.studentInputs,expected={studentParentRef:x.comparison.studentParentRef,scorer:x.parent!.parentIdentity,migrationReceiptRef:x.parent!.migrationReceiptRef};
     if(p.schema!=='ohuo-decision-input-first-round-v3'||!captured||captured.studentParentRef!==expected.studentParentRef||!equal(captured.scorer,expected.scorer)||!equal(seat?.firstRoundCapture,expected))fail('selection_first_round_capture_identity');
    }
    const {decisionId:_,matchId:__,...causal}=p.observation;const canonicalIds=c.candidateIds.map(id=>{const a=p.pool.find(a=>a.actionId===id);if(!a)fail('selection_initial_c_missing');return a.canonicalId;});contextSHA256=hashJSON([family,causal,canonicalIds]);
    const result=classifyApprovedTarget(x.firstRound?{state:s.state,actorSeat:q.actor,candidateCombos:c.candidateIds.map(id=>p.pool.find(a=>a.actionId===id)!.canonical),originalWitnessCombos:p.pool.filter(a=>!c.candidateIds.includes(a.actionId)&&a.canonical!==null).map(a=>a.canonical!)}:{ownHand:p.observation.ownHand},x.definition,t.mode);
    sampleClass=result.sampleClass;target=result.target;
    if(target?.coverage==='unknown')reason='candidate_coverage_unknown';else if(target?.coverage==='gap')reason='candidate_coverage_gap';else if(s.bundle.isUniqueLegalAction)reason='unique_legal_action';
    if(x.commonView&&sampleClass==='target'&&!reason)commonViewCell=commonViewCoverageCell(commonViewForSnapshot(s).modelPayload);
   }catch(e){reason=String((e as Error).message);}
   population.push({decisionId,...row,...(x.commonView&&decisionId?{decisionSHA256:sha(decisionId)}:{}),...(commonViewCell?{commonViewCell}:{}),layoutId:q.layoutId,sampleClass,contextSHA256,eligibility:reason?'excluded':'eligible',exclusionReason:reason,...(target?{targetCoverage:target.coverage,targetReason:target.reason,existenceWitnessCanonicalId:target.existenceWitnessCanonicalId}:{})});
  }
 }
 for(const q of x.frozen){if(familyLayouts.get(q.familyId)?.size!==6){incomplete=true;exclusions.push({decisionId:null,key:null,familyId:q.familyId,reason:'six_layout_coverage_missing',expected:6,actual:familyLayouts.get(q.familyId)?.size??0});}if(!x.commonView&&q.count===0){incomplete=true;exclusions.push({decisionId:null,key:null,familyId:q.familyId,reason:'zero_quota_blocked',expected:x.original.find(a=>a.familyId===q.familyId)!.count,actual:0});}}
 const ids=new Map<string,number>(),contexts=new Map<string,number>();for(const p of population){if(p.decisionId!==null)ids.set(p.decisionId,(ids.get(p.decisionId)??0)+1);if(p.contextSHA256)contexts.set(p.contextSHA256,(contexts.get(p.contextSHA256)??0)+1);}for(const p of population)if(p.decisionId!==null&&ids.get(p.decisionId)!>1||p.contextSHA256&&contexts.get(p.contextSHA256)!>1){p.eligibility='excluded';p.exclusionReason='duplicate_causal_context';}
 return selectPopulation(spec,t,x,inventory,population,exclusions,incomplete);
}
function selectPopulation(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs,x:ReturnType<typeof inputs>,inventory:any[],population:PopulationRow[],exclusions:any[],incomplete:boolean){
 population.sort((a,b)=>bytesCompare(a.decisionId??'',b.decisionId??'')||bytesCompare(key(a.key),key(b.key)));for(const p of population)if(p.eligibility==='excluded')exclusions.push({decisionId:p.decisionId,key:p.key,familyId:p.familyId,...(x.firstRound?{blockFamilyId:p.blockFamilyId}:{}),reason:p.exclusionReason,expected:null,actual:null});
 const queueByMatch=new Map<string,any>(x.queue.rows.map((q:any)=>[q.matchId,q]));
 const ordered=(rows:PopulationRow[])=>{const buckets=layouts.map(([g,s])=>rows.filter(r=>{const q=queueByMatch.get(r.key.matchId);return q.group===g&&q.side===s;}).sort((a,b)=>bytesCompare(sha(a.decisionId!),sha(b.decisionId!))||bytesCompare(a.decisionId??'',b.decisionId??'')||bytesCompare(key(a.key),key(b.key))));const result:PopulationRow[]=[];for(let n=0;buckets.some(b=>n<b.length);n++)for(const b of buckets)if(n<b.length)result.push(b[n]);return result;};
 const demo:PopulationRow[]=[],keep:PopulationRow[]=[],bySourceCell:any[]=[];const eligible=population.filter(p=>p.eligibility==='eligible');
 for(const q of x.frozen){
  const pool=eligible.filter(p=>(x.firstRound?p.blockFamilyId:p.familyId)===q.familyId),targetPool=pool.filter(p=>p.sampleClass==='target'&&(!x.roundAdmission?.coverage||x.roundAdmission.coverageEligibleKeys.includes(commonViewRowIdentity(p))));
  const orderedTargets=[...targetPool].sort((a,b)=>bytesCompare(sha(a.decisionId!),sha(b.decisionId!))||bytesCompare(a.decisionId!,b.decisionId!)||bytesCompare(key(a.key),key(b.key)));
  const representatives:any=x.commonView?(x.roundAdmission?selectReviewedTrainRepresentatives(orderedTargets,x.rule.representativeRound,x.roundAdmission.usedRows,x.roundAdmission.publicStrata?new Map(x.roundAdmission.publicStrata):null):selectCommonViewRepresentatives(orderedTargets,x.rule.representativeRound)):null;
  const targetCount=representatives?representatives.selected.length:x.firstRound?q.count:Math.floor(q.count/2),target=representatives?representatives.selected:ordered(targetPool).slice(0,targetCount),ordinary=x.firstRound?[]:ordered(pool.filter(p=>p.sampleClass==='ordinary')).slice(0,q.count-target.length);
  if(representatives){for(const o of representatives.order)o.row.representativeOrder={round:x.rule.representativeRound,sourceHashRank:o.sourceHashRank,cellRank:o.cellRank,selected:o.selected,...(x.roundAdmission?{previouslySelected:o.previouslySelected}:{})};bySourceCell.push(...representatives.cells.map((c:any)=>({familyId:q.familyId,split:q.split,...c})));for(const p of representatives.deferred)exclusions.push({decisionId:p.decisionId,key:p.key,familyId:p.familyId,blockFamilyId:p.blockFamilyId,reason:'public_cell_representative_deferred',decisionSHA256:p.decisionSHA256,representativeOrder:p.representativeOrder,representativeRound:x.rule.representativeRound,retainedEligibleInPopulation:true});}
  if(x.roundAdmission)for(const p of representatives!.previouslySelected)exclusions.push({decisionId:p.decisionId,key:p.key,inputSHA256:p.inputSHA256,familyId:p.familyId,blockFamilyId:p.blockFamilyId,reason:'public_cell_representative_previously_selected',representativeRound:x.rule.representativeRound,retainedEligibleInPopulation:true});
  demo.push(...target,...ordinary);if(target.length<targetCount)exclusions.push({decisionId:null,key:null,familyId:q.familyId,reason:'target_shortfall',expected:targetCount,actual:target.length});
  if(!x.firstRound&&target.length+ordinary.length<q.count)exclusions.push({decisionId:null,key:null,familyId:q.familyId,reason:'ordinary_shortfall_no_extra_target',expected:q.count-target.length,actual:ordinary.length});
 }
 const demoIds=new Set(demo.map(p=>p.decisionId)),demoContexts=new Set(demo.map(p=>p.contextSHA256));
 if(!x.pilot)for(const split of ['train','dev'] as const){const count=demo.filter(p=>p.split===split).length,rows=ordered(eligible.filter(p=>p.split===split&&p.sampleClass==='ordinary'&&!demoIds.has(p.decisionId)&&!demoContexts.has(p.contextSHA256))).slice(0,count);keep.push(...rows);if(rows.length<count)exclusions.push({decisionId:null,key:null,familyId:null,reason:`${split}_keep_shortfall`,expected:count,actual:rows.length});}
 const selectedMetadata:Metadata[]=[...demo.map(p=>({p,sampleKind:'demo' as const})),...keep.map(p=>({p,sampleKind:'keep' as const}))].map(({p,sampleKind},rank)=>({...((x.firstRound)?{blockFamilyId:p.blockFamilyId}:{}),decisionId:p.decisionId!,key:p.key,inputSHA256:p.inputSHA256,sampleKind,sampleClass:p.sampleClass!,layoutId:p.layoutId,contextSHA256:p.contextSHA256!,rank}));
 const byFamilyLayoutClass:any[]=[];for(const p of population){const quotaFamily=x.firstRound?p.blockFamilyId:p.familyId;let c=byFamilyLayoutClass.find(c=>c.familyId===quotaFamily&&c.layoutId===p.layoutId&&c.sampleClass===p.sampleClass);if(!c){c={familyId:quotaFamily,...(x.firstRound?{blockFamilyId:quotaFamily}:{}),split:p.split,layoutId:p.layoutId,sampleClass:p.sampleClass,enumerated:0,eligible:0,selected:0,keep:0};byFamilyLayoutClass.push(c);}c.enumerated++;if(p.eligibility==='eligible')c.eligible++;if(demoIds.has(p.decisionId))c.selected++;if(keep.some(k=>k.decisionId===p.decisionId))c.keep++;}byFamilyLayoutClass.sort((a,b)=>bytesCompare(key([a.familyId,a.layoutId,a.sampleClass]),key([b.familyId,b.layoutId,b.sampleClass])));
 const rows=demo.map(({recordRef,recordRoot,key,inputSHA256,familyId,split,actorSeat,blockFamilyId})=>({recordRef,recordRoot,key,inputSHA256,familyId,split,actorSeat,...(x.firstRound?{blockFamilyId}:{})}));
 return {spec,sourceInventory:inventory,population,selectedMetadata,exclusions,rows,quotas:x.frozen.map(q=>({familyId:q.familyId,count:demo.filter(p=>(x.firstRound?p.blockFamilyId:p.familyId)===q.familyId).length})),counts:{enumerated:population.length,eligible:eligible.length,excluded:population.length-eligible.length,selected:demo.length,keep:keep.length,byFamilyLayoutClass,...(x.commonView?{commonViewCoverage:{representativeRound:x.rule.representativeRound,eligibleTargetPopulation:bySourceCell.reduce((n,c)=>n+c.eligible,0),distinctSourceCells:bySourceCell.length,singletonSourceCells:bySourceCell.filter(c=>c.eligible===1).length,representatives:demo.length,deferred:bySourceCell.reduce((n,c)=>n+c.deferred,0),bySourceCell,...(x.roundAdmission?{previouslySelected:bySourceCell.reduce((n,c)=>n+c.previouslySelected,0),exhaustedSourceCells:bySourceCell.filter(c=>c.exhausted).length}:{}),interpretation:x.roundAdmission?'next unused public-cell representatives; full original denominator retained; not natural-frequency sampling or sufficient teaching proof':'initial public-cell coverage representatives; not natural-frequency sampling or sufficient teaching proof'}}:{})},verification:incomplete?'incomplete' as const:'reproduced' as const,quota:x.quota,selectionRule:x.rule};
}
const artifactNames=(spec:OfflineSelectionSpec)=>['spec.json','source-inventory.jsonl','population.jsonl','selected-metadata.jsonl','exclusions.jsonl',...(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA?['used-catalog.json']:[]),'production.json','selection.json'];
function outputRoot(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs){const expected=join(t.repositoryRoot,'lab/out',spec.outputId),path=resolve(t.outputDir??expected);if(path!==expected)fail('selection_output_not_task_directory');for(const p of [join(t.repositoryRoot,'lab'),dirname(path),path])if(existsSync(p)&&(!lstatSync(p).isDirectory()||realpathSync(p)!==p))fail('selection_output_symlink');if(existsSync(path))noteFixedFile(path);if(existsSync(path)&&readdirSync(path).some(n=>![...artifactNames(spec),'manifest.json'].includes(n)))fail('selection_partial_output_unknown');return path;}
/** Read/restore only an already fixed manifest-last commit. This path never
 * enumerates source records or creates a new selection, including after closeout. */
function committedSelection(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs,directory:string,restoreMissing=true){
 const manifestId=`offline-selection/${spec.outputId}/manifest.json`,manifestPath=join(directory,'manifest.json'),catalog=t.evidenceFiles.get(manifestId);
 if(!restoreMissing&&(!catalog||!existsSync(manifestPath)))fail('selection_commit_manifest_missing');
 if(!restoreMissing&&!equal(catalog,{path:relative(t.repositoryRoot,manifestPath),sha256:catalog!.sha256}))fail('selection_commit_file_identity');
 if(!existsSync(manifestPath)&&!catalog)return null;
 const manifestBytes=existsSync(manifestPath)?regular(manifestPath):fileBytes({id:manifestId,sha256:catalog!.sha256},t),manifest=JSON.parse(manifestBytes.toString());
 if(catalog&&sha(manifestBytes)!==catalog.sha256)fail('selection_commit_identity');strict(manifest,['schema','selectionRef','productionRef','specRef','files'],'selection_commit');
 const specRef=referenceOf(`offline-selection-spec/${spec.outputId}`,spec);if(manifest.schema!=='ohuo-offline-selection-commit-v1'||manifest.specRef!==specRef||!Array.isArray(manifest.files)||manifest.files.length!==artifactNames(spec).length)fail('selection_commit_identity');
 const contents=new Map<string,Buffer>(),files:Array<{id:string;file:FixedFile}>=[];
 for(let i=0;i<artifactNames(spec).length;i++){const name=artifactNames(spec)[i],entry=manifest.files[i],path=join(directory,name);strict(entry,['id','file'],'selection_commit_file');pathShape(entry.file);if(entry.id!==`offline-selection/${spec.outputId}/${name}`||entry.file.path!==relative(t.repositoryRoot,path))fail('selection_commit_file_identity');if(!restoreMissing&&(!existsSync(path)||!equal(t.evidenceFiles.get(entry.id),entry.file)))fail('selection_commit_file_missing_or_identity');const bytes=existsSync(path)?regular(path):fileBytes({id:entry.id,sha256:entry.file.sha256},t);if(sha(bytes)!==entry.file.sha256)fail('selection_commit_file_identity');contents.set(name,bytes);files.push(entry);}
 const oldSpec=JSON.parse(contents.get('spec.json')!.toString()),selection=JSON.parse(contents.get('selection.json')!.toString()),production=JSON.parse(contents.get('production.json')!.toString());strict(selection,['schema','sourceIndexRef','queueRef','purpose','selectedCount','quotas','rows','productionRef'],'selection_v2');strict(production,['schema','specRef','sourceInventoryRef','populationRef','selectedMetadataRef','exclusionsRef','quotaBasisRef','selectionRuleRef','targetDefinitionRef','createdBeforeLabelEvidenceRef','counts','verification',...(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA?['usedCatalogRef']:[])],'selection_production');
 if(!equal(oldSpec,spec)||production.schema!=='ohuo-offline-selection-production-v1'||production.specRef!==specRef||!equal(production.quotaBasisRef,spec.quotaBasisRef)||production.selectionRuleRef!==spec.selectionRuleRef||production.targetDefinitionRef!==spec.targetDefinitionRef||selection.schema!=='ohuo-offline-label-selection-v2'||selection.sourceIndexRef!==spec.sourceIndexRef||selection.queueRef!==spec.queueRef||selection.purpose!==spec.purpose||selection.productionRef!==manifest.productionRef||manifest.productionRef!==referenceOf(`offline-selection-production/${spec.outputId}`,production)||manifest.selectionRef!==referenceOf(`offline-label-selection/${spec.outputId}`,selection))fail('selection_commit_identity');
 for(const [field,name] of [['sourceInventoryRef','source-inventory.jsonl'],['populationRef','population.jsonl'],['selectedMetadataRef','selected-metadata.jsonl'],['exclusionsRef','exclusions.jsonl'],...(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA?[['usedCatalogRef','used-catalog.json']]:[])]){const f=files.find(f=>f.id.endsWith('/'+name))!;if(!equal(production[field],{id:f.id,sha256:f.file.sha256}))fail('selection_commit_file_identity');}
 // All original bytes are checked before restoring any missing file. A missing
 // original catalog byte is pending, never a reason to re-enumerate/re-select.
 if(restoreMissing){mkdirSync(directory,{recursive:true,mode:0o700});if(realpathSync(directory)!==directory)fail('selection_output_symlink');for(const [name,bytes] of contents)if(!existsSync(join(directory,name)))writeFileSync(join(directory,name),bytes,{flag:'wx',mode:0o600});if(!existsSync(manifestPath))writeFileSync(manifestPath,manifestBytes,{flag:'wx',mode:0o600});}
 const manifestFile={path:relative(t.repositoryRoot,manifestPath),sha256:sha(manifestBytes)},manifestRef={id:manifestId,sha256:manifestFile.sha256};files.push({id:manifestId,file:manifestFile});return {selection,production,selectionRef:manifest.selectionRef,productionRef:manifest.productionRef,specRef,manifestRef,manifestFile,files};
}
/** Explicit same-pool continuation, built from the host's complete immutable
 * manifest catalog. No supplied prior array, namespace override or success
 * filter can create this proof. It reads committed JSON only, never replays a
 * source match or invokes the teacher/world sampler. */
/** One saved, reviewed train-only coverage revision; no generic continuation grant. */
export function verifyTrainCoverageRevision(coverageRef:string,t:OfflineSelectionTrustedInputs,state:any){
 const p=refValue(coverageRef,t);if(p.schema==='ohuo-r2-train-coverage-correction-v2')return verifyPublicStratificationRevision(p,t,state);strict(p,['schema','round','parentSelectionRef','previousDatasetRef','priorFormalTaskRef','priorSummaryRef','priorStateRef','diagnosticRef','scientificReviewRef','planRevisionRef','trainFamilyIds','selectionPolicy','learningTasks'],'coverage_revision');
 if(p.schema!=='ohuo-r2-train-coverage-correction-v1'||p.round!==2||p.selectionPolicy!==TRAIN_COVERAGE_POLICY)fail('coverage_named_revision');
 const parent=refValue(p.priorFormalTaskRef,t),saved=jsonFile(p.priorStateRef,t),run=state.runs?.[parent.runId],budget=state.budgets?.[parent.budgetRef],summary=jsonFile(p.priorSummaryRef,t),diagnostic=jsonFile(p.diagnosticRef,t);
 if(parent.taskId!=='r1-training-formal-stop-correction-1'||parent.runId!==parent.taskId||!equal(parent.datasetRefs,[p.previousDatasetRef])||!run||!equal(run,saved.runs?.[parent.runId])||!equal(run.task,parent)||run.taskRef!==p.priorFormalTaskRef||run.taskSHA256!==digest(parent)||state.tasks?.[parent.taskId]!==parent.runId||run.status!=='completed'||run.cleanupConfirmed!==true||run.executionUnknown===true||run.checkpoint?.executionUnknown===true||run.checkpoint?.optimizerSteps!==127||budget?.activeRunId===parent.runId||Object.values(budget?.reservations??{}).some((r:any)=>r.runId===parent.runId&&['reserved','reserved_unknown'].includes(r.status)))fail('coverage_completed_parent');
 const sf=t.evidenceFiles.get(p.priorSummaryRef.id);if(!sf||!run.consumerArtifactRefs?.some((f:any)=>f.sha256===sf.sha256&&[sf.path,join(t.repositoryRoot,sf.path)].includes(f.path))||summary.runId!==parent.runId||summary.taskSHA256!==run.taskSHA256||summary.actual?.optimizerSteps!==127||summary.actual?.learningObservation?.decision!=='diagnostic_stop'||summary.actual.learningObservation.reason!=='development_deterioration_risk'||summary.metrics?.length!==128)fail('coverage_actual_diagnostic');
 if(diagnostic.schema!=='ohuo-fixed-class-gradient-diagnostic-v1'||diagnostic.taskRef!==p.priorFormalTaskRef||diagnostic.summaryRef?.sha256!==p.priorSummaryRef.sha256||diagnostic.optimizerUpdates!==0||diagnostic.teacherRequests!==0||diagnostic.holdoutRead!==false||!equal(diagnostic.results?.map((r:any)=>r.checkpoint.optimizerSteps),[0,126]))fail('coverage_gradient_evidence');
 const review=jsonFile(p.scientificReviewRef,t);strict(review,['schema','decision','priorSummaryRef','diagnosticRef','planRevisionRef','selectionPolicy','rationale'],'coverage_review');
 if(review.schema!=='ohuo-train-coverage-scientific-review-v1'||review.decision!=='PASS'||!equal(review.priorSummaryRef,p.priorSummaryRef)||!equal(review.diagnosticRef,p.diagnosticRef)||!equal(review.planRevisionRef,p.planRevisionRef)||review.selectionPolicy!==TRAIN_COVERAGE_POLICY||typeof review.rationale!=='string'||!review.rationale.length)fail('coverage_scientific_review');
 const plan=jsonFile(p.planRevisionRef,t);if(p.planRevisionRef.sha256!=='aa0be2dbf77e60c1be3025f8b36a7e0f4ccc5647c1aa6effd53da38233d3c0d5'||plan.status!=='SAVED_AND_READBACK_BYTE_EXACT'||plan.schema!=='guandan-saved-plan-train-coverage-correction-v1'||plan.document?.current_version_number!==30||plan.document.sha256!=='607f85122d22b312c297d17ae7a4bf33a253aedeb763735747745ce8e46f3e38'||plan.document.library_file_id!=='libfile_3f00fde4b97481919c96e65c185d5e4b'||plan.scientific_design_review?.decision!=='PASS_SCIENTIFIC_EXECUTION_PLAN_NOT_IMPLEMENTATION_ACCEPTANCE'||plan.document_delta_review?.decision!=='PASS_SCIENTIFIC_TEXT_DELTA'||plan.document_clarification_review?.decision!=='PASS_SINGLE_CLAUSE_CLARIFICATION')fail('coverage_saved_plan');
 const expected=['calibration','formal'].map(phase=>({phase,taskId:'r1-training-'+phase+'-coverage-1',runId:'r1-training-'+phase+'-coverage-1',experimentId:'v530-r2-'+phase+'-coverage-1'}));if(!equal(p.learningTasks,expected)||!Array.isArray(p.trainFamilyIds)||!p.trainFamilyIds.length||new Set(p.trainFamilyIds).size!==p.trainFamilyIds.length)fail('coverage_roles');
 return p;
}

/** A saved scientific revision authorizes a finite public scope, not arbitrary future rounds. */
function verifyPublicStratificationRevision(p:any,t:OfflineSelectionTrustedInputs,state:any){
 strict(p,['schema','round','parentSelectionRef','previousDatasetRef','priorFormalTaskRef','priorSummaryRef','priorStateRef','diagnosticRef','scientificReviewRef','planRevisionRef','trainFamilyIds','selectionPolicy','learningTasks','basisRevisionRef','publicExportRef','publicExportReviewRef'],'public_stratification_revision');
 if(p.selectionPolicy!==TRAIN_PUBLIC_STRATA_POLICY||!Number.isSafeInteger(p.round)||p.round<3)fail('coverage_named_policy');
 const basisValue=refValue(p.basisRevisionRef,t);if(basisValue.schema!=='ohuo-r2-train-coverage-correction-v1')fail('coverage_original_basis');const basis=verifyTrainCoverageRevision(p.basisRevisionRef,t,state);
 for(const k of ['previousDatasetRef','priorFormalTaskRef','priorSummaryRef','priorStateRef','diagnosticRef','trainFamilyIds'])if(!equal(p[k],basis[k]))fail('coverage_scientific_basis_changed');
 const parent=refValue(p.parentSelectionRef,t),parentSpec=refValue(refValue(parent.productionRef,t).specRef,t),parentContract=refValue(parentSpec.roundContractRef,t);if(parentContract.round+1!==p.round)fail('coverage_actual_parent_round');
 const review=jsonFile(p.scientificReviewRef,t);strict(review,['schema','decision','basisRevisionRef','parentSelectionRef','round','publicExportRef','publicExportReviewRef','planRevisionRef','selectionPolicy','learningTasks','rationale'],'public_stratification_review');
 if(review.schema!=='ohuo-train-public-stratification-scientific-review-v1'||review.decision!=='PASS'||typeof review.rationale!=='string'||!review.rationale.length)fail('coverage_scientific_review');
 for(const k of ['basisRevisionRef','parentSelectionRef','round','publicExportRef','publicExportReviewRef','planRevisionRef','selectionPolicy','learningTasks'])if(!equal(review[k],p[k]))fail('coverage_scientific_review_binding');
 const plan=jsonFile(p.planRevisionRef,t);if(plan.schema!=='guandan-saved-plan-public-resource-strata-v1'||plan.status!=='SAVED_AND_READBACK_BYTE_EXACT'||plan.document?.library_file_id!=='libfile_3f00fde4b97481919c96e65c185d5e4b'||!Number.isSafeInteger(plan.document.version)||plan.document.version<34||plan.document.business_version!=='5.3.0'||!hex(plan.document.sha256)||!hex(plan.scientific_basis?.sha256)||!hex(plan.scientific_review?.sha256)||!hex(plan.document_text_review?.sha256))fail('coverage_saved_plan');
 if(!Array.isArray(p.learningTasks)||p.learningTasks.length!==2||!equal(p.learningTasks.map((r:any)=>r.phase),['calibration','formal'])||new Set(p.learningTasks.map((r:any)=>r.taskId)).size!==2)fail('coverage_roles');
 for(const r of p.learningTasks){strict(r,['phase','taskId','runId','experimentId'],'coverage_learning_role');for(const k of ['taskId','runId','experimentId'])validateIdentifier(r[k],k);if(r.taskId!==r.runId)fail('coverage_roles');}
 return p;
}
function verifiedPublicStrata(coverage:any,t:OfflineSelectionTrustedInputs,chain:any,basePopulation:any[]){
 const exported=jsonFile(coverage.publicExportRef,t),review=jsonFile(coverage.publicExportReviewRef,t),parent=chain.chain.find((e:any)=>e.selectionRef===coverage.parentSelectionRef);
 if(!parent||parent.round+1!==coverage.round||exported.schema!=='ohuo-r2-deferred-train-public-export-v1'||exported.status!=='read_only_public_views_not_selected_not_labeled'||!Array.isArray(exported.rows)||review.schema!=='ohuo-independent-deferred30-actual-readout-review-v1'||review.decision!=='PASS_ACTUAL_READ_ONLY_NOT_NEW_SELECTION'||review.publicExportSHA256!==coverage.publicExportRef.sha256||review.exactInputRowsMatched!==exported.rows.length||exported.counts?.rows!==exported.rows.length)fail('coverage_original_public_export');
 const populationFile=t.evidenceFiles.get(parent.production.populationRef.id);if(!populationFile||exported.population?.sha256!==parent.production.populationRef.sha256||!equal(exported.population,populationFile))fail('coverage_export_population');
 const priorPopulation=lines(parent.production.populationRef,t),expected=priorPopulation.filter((r:any)=>r.coverageFilter?.matches===true&&r.representativeOrder?.selected===false&&r.representativeOrder?.previouslySelected===false);
 const expectedMap=new Map<string,any>(expected.map((r:any)=>[commonViewRowIdentity(r),r])),baseMap=new Map<string,any>(basePopulation.map((r:any)=>[commonViewRowIdentity(r),r]));if(expectedMap.size!==expected.length||exported.rows.length!==expected.length)fail('coverage_export_scope');
 // The exporter used these original mapper/loader bytes; validate unchanged scientific decoding, not a caller's boolean.
 pathShape(exported.acceptedFile);const acceptedBytes=regular(resolve(t.repositoryRoot,exported.acceptedFile.path));if(sha(acceptedBytes)!==exported.acceptedFile.sha256)fail('coverage_export_source_receipt');const accepted=JSON.parse(acceptedBytes.toString());
 if(accepted.functionalStatus!=='accepted'||digest(accepted.acceptedCodeRef)!==exported.sourceRevisionSHA256)fail('coverage_export_source_identity');
 for(const path of ['lab/review6_2/offline-label-source.ts','lab/review6_2/first-round-common-view.ts','lab/review6_2/match-record.ts']){const f=accepted.acceptedCodeRef.files.find((f:any)=>f.path===path);if(!f||sha(regular(resolve(t.repositoryRoot,path)))!==f.sha256)fail('coverage_export_mapper_changed');}
 const used=new Set(chain.chain.filter((e:any)=>e.round<coverage.round).flatMap((e:any)=>e.rows.map((r:any)=>commonViewDecisionKey(r.key)))),cells=new Map<string,any>(),publicSources:any[]=[],stores=new Map<string,any>(),storeHashes=new Map<string,string>();
 for(const r of exported.rows){const identity=commonViewRowIdentity(r),original=expectedMap.get(identity),base=baseMap.get(identity);if(!original||!base||cells.has(identity)||used.has(commonViewDecisionKey(r.key))||r.source?.split!=='train'||r.decisionId!==original.decisionId||!equal(r.source,{recordRef:original.recordRef,recordRoot:original.recordRoot,familyId:original.familyId,blockFamilyId:original.blockFamilyId,split:original.split,actorSeat:original.actorSeat})||typeof r.modelPayloadBytes!=='string'||sha(r.modelPayloadBytes)!==r.modelPayloadSHA256||digest(r.addressMap)!==r.addressMapSHA256)fail('coverage_export_row_identity');
  const view=JSON.parse(r.modelPayloadBytes);if(!equal(commonViewCoverageCell(view),base.commonViewCell))fail('coverage_export_original_cell');const cell=trainPublicResourceCell(view);
  const storeKey=hashJSON([original.recordRef,original.recordRoot]);if(!storeHashes.has(storeKey)){const store=loadMatchStore(original.recordRef,original.recordRoot);stores.set(storeKey,store);storeHashes.set(storeKey,digest(store.recorder.snapshot()));}
  const path=join(original.recordRef.directory,`decision-${original.key.requestSeq}.private.json`),st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||realpathSync(path)!==path||(st.mode&0o777)!==0o600||hashJSON(JSON.parse(readFileSync(path,'utf8')))!==original.inputSHA256)fail('coverage_original_input_changed');
  cells.set(identity,cell);publicSources.push({row:base,storeSHA256:storeHashes.get(storeKey)});
 }
 return {cells,publicSources};
}

export function verifyCommonViewRoundAdmission(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs,stateOverride?:any):any {
 const timingStart=performance.now(),scope=coverageScopes.getStore(),timingToken=t.roundProofSession??(scope&&!scope.closed?scope.roundProofSession:undefined),timing:any={stage:'round-admission',owner:timingToken?roundProofSessions.get(timingToken)?.owner:undefined,method:scope&&!scope.closed?scope.stage:'outside-host-method',outputId:spec?.outputId,status:'failed',staticMode:'not-reached',prefixReplays:0};let staticStart:number|undefined,liveStart:number|undefined;
 try{
 validateSpec(spec);validateTrusted(t);if(spec.schema!==COMMON_VIEW_ROUND_SPEC_SCHEMA)fail('selection_explicit_round_spec_required');
 const contract=refValue(spec.roundContractRef!,t);strict(contract,['schema','protocolRef','poolRef','round','parentSelectionRef','continuationEvidenceRefs','plannedTasks',...(contract.coverageRevisionRef!==undefined?['coverageRevisionRef']:[])],'representative_round');
 if(contract.schema!==COMMON_VIEW_ROUND_CONTRACT_SCHEMA||!Number.isSafeInteger(contract.round)||contract.round<1||!Array.isArray(contract.continuationEvidenceRefs)||!contract.continuationEvidenceRefs.length)fail('selection_round_contract');
 validateCommonViewRoundTasks(contract).forEach((t:any)=>validateIdentifier(t.taskId,'roundTaskId'));
 fixedReference(contract.parentSelectionRef,'parentSelectionRef');for(const f of contract.continuationEvidenceRefs)fileBytes(f,t);
 const pool=refValue(contract.poolRef,t);strict(pool,['schema','planRef','budgetRef','sourceIndexRef','queueRef','sourceRunRefs','targetDefinitionRef','actingReleaseRef','protocolRef','comparisonRef','baseSelectionRuleRef','families'],'representative_pool');
 if(pool.schema!==COMMON_VIEW_POOL_SCHEMA||pool.protocolRef!==contract.protocolRef)fail('selection_pool_identity');
 const coverage=contract.coverageRevisionRef?verifyTrainCoverageRevision(contract.coverageRevisionRef,t,stateOverride??JSON.parse(regular(screenRevalidationStatePath(t)).toString())):null;
 if(coverage&&(contract.round!==coverage.round||contract.parentSelectionRef!==coverage.parentSelectionRef||!equal(coverage.trainFamilyIds,[...pool.families.filter((f:any)=>f.split==='train').map((f:any)=>f.familyId)].sort())))fail('coverage_pool_binding');
 const staticSlot=roundStaticSlot(t,{kind:'fixed-round-v54',spec,contract,pool,coverage});staticStart=performance.now();
 const fixed=readFixedProof(staticSlot,()=>{
 const families=readCommonViewSourceFamilies(pool.families).map(({familyId,split}:any)=>({familyId,split})),baseRule=refValue(pool.baseSelectionRuleRef,t),currentRule=refValue(spec.selectionRuleRef,t),quota=jsonFile(spec.quotaBasisRef,t);
 if(baseRule.schema!==COMMON_VIEW_SELECTION_SCHEMA||baseRule.representativeRound!==0||baseRule.protocolRef!==pool.protocolRef||baseRule.comparisonRef!==pool.comparisonRef||!equal(currentRule,{...baseRule,representativeRound:contract.round,...(coverage?.selectionPolicy===TRAIN_PUBLIC_STRATA_POLICY?{representativeRule:'six-public-dimensions-v2'}:{}),...(coverage?{coverageRevisionRef:contract.coverageRevisionRef}:{})})||quota.budgetRef!==pool.budgetRef)fail('selection_round_rule_identity');
 function bindPool(s:OfflineSelectionSpec){
  for(const field of ['planRef','sourceIndexRef','queueRef','sourceRunRefs','targetDefinitionRef','actingReleaseRef'] as const)if(!equal(s[field],pool[field]))fail('selection_pool_inputs_changed');
  const q=jsonFile(s.quotaBasisRef,t);if(s.purpose!=='b_training_source'||q.schema!==COMMON_VIEW_SOURCE_BASIS_SCHEMA||q.budgetRef!==pool.budgetRef||q.protocolRef!==pool.protocolRef||!equal(readCommonViewSourceFamilies(q.families).map(({familyId,split}:any)=>({familyId,split})),families))fail('selection_pool_split_changed');
 }
 bindPool(spec);
 const indexRef=refValue(pool.sourceIndexRef,t),indexBytes=regular(t.sourceIndexPath),index=JSON.parse(indexBytes.toString()),queue=refValue(pool.queueRef,t);
 if(indexRef.schema!=='ohuo-source-index-ref-v1'||indexRef.fileSHA256!==sha(indexBytes)||index.version!==1||families.some((q:any)=>index.families?.[q.familyId]?.split!==q.split)||queue.schema!=='ohuo-complete-match-queue-v1'||queue.sourceIndexRef!==pool.sourceIndexRef||queue.namespace!==indexRef.namespace)fail('selection_pool_source_identity');
 const sourceRuns=pool.sourceRunRefs.map((f:SelectionEvidenceRef)=>jsonFile(f,t));
 const entries:any[]=[];
 // This is the complete trusted catalog, not a user-specified predecessor list.
 for(const [id,file]of t.evidenceFiles){
  if(!/^offline-selection\/[^/]+\/manifest\.json$/.test(id))continue;
  const m=jsonFile({id,sha256:file.sha256},t);if(m.schema!=='ohuo-offline-selection-commit-v1')fail('selection_catalog_manifest_schema');
  const previous=refValue(m.specRef,t) as OfflineSelectionSpec;
  if(previous.planRef!==pool.planRef||previous.sourceIndexRef!==pool.sourceIndexRef||previous.queueRef!==pool.queueRef)continue;
  validateSpec(previous);bindPool(previous);
  const c=committedSelection(previous,t,outputRoot(previous,{...t,outputDir:undefined}),false);if(!c||c.selectionRef!==m.selectionRef||!equal(refValue(c.selectionRef,t),c.selection)||!equal(refValue(c.productionRef,t),c.production)||c.production.verification!=='reproduced')fail('selection_prior_commit_identity');
  let round=0,parentSelectionRef=null,previousContract=null;
  if(previous.schema===COMMON_VIEW_ROUND_SPEC_SCHEMA){previousContract=refValue(previous.roundContractRef!,t);strict(previousContract,['schema','protocolRef','poolRef','round','parentSelectionRef','continuationEvidenceRefs','plannedTasks',...(previousContract.coverageRevisionRef!==undefined?['coverageRevisionRef']:[])],'prior_round_contract');if(previousContract.schema!==COMMON_VIEW_ROUND_CONTRACT_SCHEMA||previousContract.poolRef!==contract.poolRef||previousContract.protocolRef!==pool.protocolRef||!Number.isSafeInteger(previousContract.round)||previousContract.round<1)fail('selection_prior_pool_identity');validateCommonViewRoundTasks(previousContract).forEach((t:any)=>validateIdentifier(t.taskId,'roundTaskId'));round=previousContract.round;parentSelectionRef=previousContract.parentSelectionRef;}
  else if(previous.selectionRuleRef!==pool.baseSelectionRuleRef)fail('selection_initial_pool_rule');
  if(!equal(refValue(previous.selectionRuleRef,t),{...baseRule,representativeRound:round,...(previousContract?.coverageRevisionRef&&refValue(previousContract.coverageRevisionRef,t).selectionPolicy===TRAIN_PUBLIC_STRATA_POLICY?{representativeRule:'six-public-dimensions-v2'}:{}),...(previousContract?.coverageRevisionRef?{coverageRevisionRef:previousContract.coverageRevisionRef}:{})}))fail('selection_prior_round_rule');
  if(round===contract.round&&(!equal(previous,spec)||!equal(previousContract,contract)))fail('selection_round_fork');
  entries.push({...c,spec:previous,contract:previousContract,round,parentSelectionRef,rows:c.selection.rows});
 }
 for(const [selectionRef,value]of t.references){if(value?.schema!=='ohuo-offline-label-selection-v2'||value.sourceIndexRef!==pool.sourceIndexRef||value.queueRef!==pool.queueRef)continue;const production=refValue(value.productionRef,t),candidate=refValue(production.specRef,t);if(candidate.planRef===pool.planRef&&!entries.some(e=>e.selectionRef===selectionRef))fail('selection_pool_manifest_omitted');}
 const chain=validateCommonViewRoundChain(contract,entries),base=chain.chain[0];
 const basePopulation=lines(base.production.populationRef,t),baseInventory=lines(base.production.sourceInventoryRef,t),baseExclusions=lines(base.production.exclusionsRef,t);
 const metadataByRound=new Map(chain.chain.map((entry:any)=>[entry.round,lines(entry.production.selectedMetadataRef,t)]));
 const strataByRound=new Map<number,any>();
 if(coverage?.selectionPolicy===TRAIN_PUBLIC_STRATA_POLICY)strataByRound.set(coverage.round,verifiedPublicStrata(coverage,t,chain,basePopulation));
 for(const entry of chain.chain){if(!entry.contract?.coverageRevisionRef||strataByRound.has(entry.round))continue;const revision=refValue(entry.contract.coverageRevisionRef,t);if(revision.selectionPolicy===TRAIN_PUBLIC_STRATA_POLICY)strataByRound.set(entry.round,verifiedPublicStrata(revision,t,chain,basePopulation));}
 const publicStrata=strataByRound.get(contract.round)??null;
 function buildRoundStatic(){
 const poolRows=new Map<string,any>();
 for(const row of basePopulation){if(row.eligibility==='eligible'){const k=commonViewDecisionKey(row.key);if(poolRows.has(k))fail('selection_pool_decision_duplicate');poolRows.set(k,row);if(row.decisionSHA256!==sha(row.decisionId))fail('selection_pool_hash_order');}}
 const coverageCache=new Map(),coverageStoreHashes=new Map<string,string>(),publicEligibility=new Map<string,string|null>(),publicSources:any[]=[],publicMetrics=timing;
 const coverageIdentity=coverage?digest({catalog:catalogView(t),spec,sourceIndexSHA256:sha(indexBytes),populationRef:base.production.populationRef,policy:TRAIN_COVERAGE_POLICY,repositoryRoot:t.repositoryRoot,controlRoot:t.controlRoot,sourceIndexPath:t.sourceIndexPath,phase:t.phase,confirmedRecordRoots:t.confirmedRecordRoots}):'';
 const coverageReason=(row:any)=>{const id=canonical(row.key);if(!publicEligibility.has(id)){let reason:string|null=row.split!=='train'?'not_train':row.eligibility!=='eligible'?'prior_ineligible':row.sampleClass!=='target'?'not_target_context':!['pair','straight'].includes(row.commonViewCell?.targetKind)?'target_not_pair_or_straight':row.commonViewCell?.partnerZero?'not_all_four_active':row.commonViewCell?.hasOrdinaryTakeover!==true?'no_ordinary_takeover_candidate':null;if(reason===null){reason=cachedCoveragePublicReason(row,coverageCache,coverageStoreHashes,coverageIdentity,publicMetrics);const storeKey=hashJSON([row.recordRef,row.recordRoot]);if(!coverageStoreHashes.has(storeKey)){let store=coverageCache.get(storeKey);if(!store){store=loadMatchStore(row.recordRef,row.recordRoot);coverageCache.set(storeKey,store);}coverageStoreHashes.set(storeKey,digest(store.recorder.snapshot()));}publicSources.push({row,storeSHA256:coverageStoreHashes.get(storeKey)});}publicEligibility.set(id,reason);}return publicEligibility.get(id)!;};
 const coverageEligible=(row:any)=>coverageReason(row)===null;
 const used:any[]=[];
 for(const entry of chain.chain){
  const expected:any[]=[];
  for(const family of families){const rows=basePopulation.filter((p:any)=>p.eligibility==='eligible'&&p.sampleClass==='target'&&p.blockFamilyId===family.familyId&&p.split===family.split).sort((a:any,b:any)=>bytesCompare(sha(a.decisionId),sha(b.decisionId))||bytesCompare(a.decisionId,b.decisionId)||bytesCompare(key(a.key),key(b.key)));
   const entryCoverage=entry.contract?.coverageRevisionRef?refValue(entry.contract.coverageRevisionRef,t):null,entryStrata=entryCoverage?.selectionPolicy===TRAIN_PUBLIC_STRATA_POLICY?strataByRound.get(entry.round):null;const selected=entry.round===0?selectCommonViewRepresentatives(rows,0).selected:selectReviewedTrainRepresentatives(entryStrata?rows.filter((r:any)=>entryStrata.cells.has(commonViewRowIdentity(r))):entryCoverage?rows.filter(coverageEligible):rows,entry.round,used,entryStrata?.cells??null).selected;
   expected.push(...selected.map(({recordRef,recordRoot,key,inputSHA256,familyId,split,actorSeat,blockFamilyId}:any)=>({recordRef,recordRoot,key,inputSHA256,familyId,split,actorSeat,blockFamilyId})));
  }
  if(!equal(entry.rows,expected))fail('selection_prior_not_next_unused');
  for(const row of entry.rows){const original=poolRows.get(commonViewDecisionKey(row.key));if(!original||original.inputSHA256!==row.inputSHA256||original.split!==row.split||original.blockFamilyId!==row.blockFamilyId)fail('selection_prior_pool_row_changed');}
  const metadata=metadataByRound.get(entry.round),demo=metadata.filter((r:any)=>r.sampleKind==='demo');if(demo.length!==entry.rows.length||demo.some((r:any,i:number)=>!equal(r.key,entry.rows[i].key)||r.inputSHA256!==entry.rows[i].inputSHA256||r.contextSHA256!==poolRows.get(commonViewDecisionKey(r.key))?.contextSHA256))fail('selection_prior_metadata_changed');
  used.push(...entry.rows);
 }
 for(const value of strataByRound.values())publicSources.push(...value.publicSources);return {coverageEligibleKeys:publicStrata?[...publicStrata.cells.keys()]:coverage?basePopulation.filter(coverageEligible).map((r:any)=>commonViewRowIdentity(r)):null,coverageReadout:publicStrata?basePopulation.map((r:any)=>({key:r.key,inputSHA256:r.inputSHA256,matches:publicStrata.cells.has(commonViewRowIdentity(r)),reason:publicStrata.cells.has(commonViewRowIdentity(r))?null:'outside_reviewed_unused_public_scope',stratum:publicStrata.cells.get(commonViewRowIdentity(r))??null})):coverage?basePopulation.map((r:any)=>({key:r.key,inputSHA256:r.inputSHA256,matches:coverageEligible(r),reason:coverageReason(r)})):null,publicSources,prefixReplays:publicMetrics.prefixReplays};
 }
 const staticProof=buildRoundStatic();
 return {families,entries,chain,base,basePopulation,baseInventory,baseExclusions,sourceRuns,publicStrata:publicStrata?[...publicStrata.cells]:null,staticProof};
 });
 const {entries,chain,base,basePopulation,baseInventory,baseExclusions,sourceRuns,publicStrata,staticProof}=fixed.value;
 timing.immutableReadMs=performance.now()-staticStart;timing.staticMode=fixed.reused?'guarded-reuse':'cold';timing.prefixReplays=fixed.reused?0:staticProof.prefixReplays;liveStart=performance.now();
 // Historical revision parents are live predicates too; no cached result can
 // skip their current state/cleanup/reservation checks.
 for(const entry of chain.chain)if(entry.contract?.coverageRevisionRef&&entry.round!==coverage?.round&&refValue(entry.contract.coverageRevisionRef,t).selectionPolicy===TRAIN_PUBLIC_STRATA_POLICY)verifyTrainCoverageRevision(entry.contract.coverageRevisionRef,t,stateOverride??JSON.parse(regular(screenRevalidationStatePath(t)).toString()));
 const state=stateOverride??JSON.parse(regular(screenRevalidationStatePath(t)).toString()),prior=chain.chain.slice(0,contract.round),priorRefs=new Set(chain.priorSelectionRefs),allRefs=new Set(chain.chain.map((e:any)=>e.selectionRef)),runs:any[]=[];
 const budget=state.budgets?.[pool.budgetRef];if(!budget||!state.runs||!state.tasks)fail('selection_round_state_missing');
 const sourceRunIds=new Set();for(const run of sourceRuns){const original=state.runs[run?.runId];if(!original||sourceRunIds.has(run.runId)||['task','taskRef','taskSHA256','checkpoint','checkpointSHA256','checkpointRef','status','cleanupConfirmed'].some(k=>!equal(run[k],original[k]))||run.task?.seatLayoutPlan!==pool.queueRef||run.task?.sourcePlan?.sourceIndexRef!==pool.sourceIndexRef)fail('selection_pool_source_run_changed');sourceRunIds.add(run.runId);}

 // A committed historical round can be an input to a downstream learner.
 // Its immutable cumulative manifest, not the Task kind alone, proves that it
 // is a descendant rather than a predecessor. Fresh freeze remains strict.
 function committedLearningDescendant(task:any,runId:string){
  if(t.phase!=='dataset'||task.taskKind!=='supervised_training'||sourceRunIds.has(runId)||task.scientificContract?.analysisMethodRef!==pool.protocolRef||task.datasetRefs?.length!==1||!entries.some(e=>e.round===contract.round&&equal(e.spec,spec)))return false;
  const dataset=refValue(task.datasetRefs[0],t);if(dataset?.schema!=='ohuo-frozen-dataset-ref-v1'||!hex(dataset.manifestSHA256))return false;
  const matches=[...t.evidenceFiles].filter(([,f])=>f.sha256===dataset.manifestSHA256);if(!matches.length)return false;
  const paths=new Set(matches.map(([,f])=>f.path));if(paths.size!==1)fail('selection_descendant_manifest_ambiguous');
  const [id,file]=matches[0],manifest=jsonFile({id,sha256:file.sha256},t),plan=manifest.plan,sampling=plan?.cumulativeSampling,evidence=manifest.cumulativeEvidence;
  if(manifest.schema!=='ohuo-distill-dataset-first-round-v4'||manifest.qualification?.eligible!==true||plan?.researchProtocol?.revisionRef!==pool.protocolRef||plan.sourceIndexRef!==pool.sourceIndexRef||plan.queueRef!==pool.queueRef||sampling?.schema!=='ohuo-first-round-cumulative-sampling-r2'||sampling.protocolRef!==pool.protocolRef||sampling.poolRef!==contract.poolRef||evidence?.schema!=='ohuo-first-round-cumulative-evidence-r2'||evidence.samplingRef!==plan.samplingRef)return false;
  if(!equal(refValue(plan.samplingRef,t),sampling)||!Array.isArray(sampling.selectionRefs)||!Array.isArray(sampling.productionRefs)||!Array.isArray(evidence.rounds)||sampling.selectionRefs.length!==sampling.productionRefs.length||evidence.rounds.length!==sampling.selectionRefs.length)return false;
  if(!sampling.selectionRefs.every((r:string,i:number)=>entries.some(e=>e.selectionRef===r&&e.productionRef===sampling.productionRefs[i])&&evidence.rounds[i].selectionRef===r&&evidence.rounds[i].productionRef===sampling.productionRefs[i]))return false;
  return sampling.selectionRefs.some((r:string)=>entries.some(e=>e.selectionRef===r&&e.round>=contract.round));
 }
 for(const run of Object.values(state.runs) as any[]){
  const task=run.task;if(task?.planRef!==pool.planRef||task?.budgetRef!==pool.budgetRef)continue;
  const namesPrior=task.datasetRefs?.some((r:string)=>priorRefs.has(r)),sameSource=task.sourcePlan?.sourceIndexRef===pool.sourceIndexRef&&task.seatLayoutPlan===pool.queueRef;
  if(!namesPrior&&!sameSource)continue;
  // A current/higher frozen round is not a predecessor during historical
  // reproduction; freeze of a new round has no such descendants to omit.
  if(!namesPrior&&task.datasetRefs?.some((r:string)=>allRefs.has(r)))continue;
  if(knownUnsentWorldPreparationFailure(run,state,t.controlRoot,(r:string)=>refValue(r,t)))continue;
  if(run.runId!==task.runId||state.tasks[task.taskId]!==run.runId||run.taskSHA256!==digest(task)||run.taskRef?.split(':').at(-1)!==run.taskSHA256||task.outputRoot!==join(t.controlRoot,'runs',run.runId))fail('selection_related_task_identity');
  const taskBytes=regular(join(task.outputRoot,'task.json'));if(sha(taskBytes)!==run.taskSHA256||!equal(JSON.parse(taskBytes.toString()),task))fail('selection_related_task_file');
  const cp=run.checkpoint;if(!cp||run.checkpointSHA256!==digest(cp)||run.checkpointRef!==join(task.outputRoot,`checkpoint-${run.checkpointSHA256}.json`)||!equal(JSON.parse(regular(run.checkpointRef).toString()),cp))fail('selection_related_checkpoint_identity');
  if(!namesPrior&&sameSource&&committedLearningDescendant(task,run.runId))continue;
  const reservations=Object.values(budget.reservations??{}).filter((r:any)=>r.runId===run.runId) as any[],activeReservation=budget.activeRunId===run.runId||reservations.some(r=>['reserved','reserved_unknown'].includes(r.status));
  if(coverage&&!namesPrior&&sameSource&&task.taskKind==='supervised_training'&&task.scientificContract?.analysisMethodRef===pool.protocolRef&&task.datasetRefs?.length===1&&equal(refValue(task.datasetRefs[0],t),refValue(coverage.previousDatasetRef,t))){
   if(!['completed','failed','interrupted'].includes(run.status)||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.failureReason==='execution_uncertain'||run.stopReason==='execution_uncertain'||cp.executionUnknown===true||cp.active!=null||activeReservation)fail('coverage_prior_learning_unsettled');
   continue; // Already settled earlier learning, retained in the immutable state.
  }
  let labelRole=null;
  if(cp.schema==='ohuo-offline-label-run-v1'&&priorRefs.has(cp.selectionRef)){
   if(!equal(task.datasetRefs,[cp.selectionRef]))fail('selection_prior_task_dataset');
   const labelRule=refValue(task.scientificContract.decisionRuleRef,t),routing=labelRule.routingRef?refValue(labelRule.routingRef,t):null;labelRole=routing?.role??null;
   if(labelRule.schema!=='ohuo-common-view-teacher-contract-r2'||routing?.schema!=='ohuo-common-view-teacher-routing-r2'||!['primary','independent-review','model-substitution'].includes(labelRole))fail('selection_prior_teacher_route');
   const selected=prior.find((e:any)=>e.selectionRef===cp.selectionRef).rows;
   let owned=selected.filter((r:any)=>r.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(r.blockFamilyId??r.familyId));
   if(labelRole!=='primary'){if(!Array.isArray(routing.selected)||!routing.selected.length)fail('selection_prior_teacher_subset');owned=owned.filter((r:any)=>routing.selected.some((v:any)=>equal(v.key,r.key)&&v.inputSHA256===r.inputSHA256));if(owned.length!==routing.selected.length)fail('selection_prior_teacher_subset');}
   if(!owned.length||!Array.isArray(cp.rows)||cp.rows.length!==owned.length||cp.cursor!==owned.length||cp.rows.some((r:any,i:number)=>!equal(r.key,owned[i].key)||r.inputSHA256!==owned[i].inputSHA256))fail('selection_prior_owned_rows_unfinished');
   for(const [i,row]of (cp.rows??[]).entries()){
    const p=join(task.outputRoot,'labels',`q${i}.json`);if(row.resultRef?.path!==p||!hex(row.resultRef.sha256))fail('selection_prior_terminal_ref');const b=regular(p);if(sha(b)!==row.resultRef.sha256)fail('selection_prior_terminal_bytes');const terminal=JSON.parse(b.toString());
    if(terminal.schema!=='ohuo-offline-label-result-v1'||terminal.selectionRef!==cp.selectionRef||terminal.index!==i||terminal.inputSHA256!==row.inputSHA256||!equal(terminal.key,row.key)||terminal.status!==row.status||terminal.labelKind!==row.labelKind)fail('selection_prior_terminal_binding');
   }
  }
  runs.push({...run,activeReservation,labelRole});
 }
 assertCommonViewRoundTerminalsSettled(prior,runs);
 // Publish only after the original live tail succeeds. Reuse never stores its result.
 fixed.publish();
 timing.status="passed";
 return{contract,coverage,publicStrata,coverageEligibleKeys:structuredClone(staticProof.coverageEligibleKeys),coverageReadout:structuredClone(staticProof.coverageReadout),roundContracts:[...chain.chain.filter((e:any)=>e.round>0&&e.round<contract.round).map((e:any)=>({roundContractRef:e.spec.roundContractRef,contract:e.contract})),{roundContractRef:spec.roundContractRef,contract}],poolRef:contract.poolRef,pool,round:contract.round,parentSelectionRef:contract.parentSelectionRef,priorSelectionRefs:chain.priorSelectionRefs,usedRows:chain.usedRows,priorCommitRefs:prior.map((p:any)=>p.manifestRef),base:{...base,population:basePopulation,sourceInventory:baseInventory,exclusions:baseExclusions}};
 }finally{if(timingToken&&roundProofSessions.has(timingToken)){const now=performance.now();timing.elapsedMs=now-timingStart;if(liveStart!==undefined)timing.liveMs=now-liveStart;else if(staticStart!==undefined)timing.publicAndRepresentativeMs=now-staticStart;selectionRuntimeTiming(timing);}}
}
function enumerateLaterRound(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs,x:ReturnType<typeof inputs>){
 const base=x.roundAdmission.base,population=structuredClone(base.population) as PopulationRow[];
 // Original source inventory/eligibility/context/hash ordering are reused from
 // their committed bytes; only round-local representative/keep readout changes.
 const coverageReadout=x.roundAdmission.coverage?new Map(x.roundAdmission.coverageReadout.map((r:any)=>[canonical(r.key),r])):null;
 for(const p of population){delete p.representativeOrder;if(coverageReadout){const row:any=coverageReadout.get(canonical(p.key));if(!row)fail('coverage_readout_missing');(p as any).coverageFilter={matches:row.matches,reason:row.reason,...(row.stratum?{stratum:row.stratum}:{})};}}
 const drop=new Set(['public_cell_representative_deferred','public_cell_representative_previously_selected','target_shortfall','ordinary_shortfall_no_extra_target','train_keep_shortfall','dev_keep_shortfall']);
 const exclusions=structuredClone(base.exclusions).filter((e:any)=>!drop.has(e.reason)&&!population.some(p=>p.eligibility==='excluded'&&equal(p.key,e.key)&&p.exclusionReason===e.reason));
 return selectPopulation(spec,t,x,structuredClone(base.sourceInventory),population,exclusions,false);
}

export function prepareOfflineSelection(spec:OfflineSelectionSpec,trustedInputs:OfflineSelectionTrustedInputs){
 validateSpec(spec);validateTrusted(trustedInputs);if(trustedInputs.phase!=='freeze')fail('selection_freeze_phase_required');
 const releaseSource=acquireSourceWriter(trustedInputs.sourceIndexPath);let releaseState:(()=>void)|undefined;
 try{releaseState=acquireSourceWriter(join(trustedInputs.controlRoot,'state.json'));return prepareLocked(spec,trustedInputs);}finally{releaseState?.();releaseSource();}
}
function prepareLocked(spec:OfflineSelectionSpec,trustedInputs:OfflineSelectionTrustedInputs){
 validateSpec(spec);if(trustedInputs?.phase!=='freeze')fail('selection_freeze_phase_required');const directory=outputRoot(spec,trustedInputs),committed=committedSelection(spec,trustedInputs,directory);if(committed)return committed;const result=enumerate(spec,trustedInputs);if(spec.schema===COMMON_VIEW_ROUND_SPEC_SCHEMA&&!result.rows.length)fail('selection_representative_pool_exhausted');mkdirSync(dirname(directory),{recursive:true});if(realpathSync(dirname(directory))!==dirname(directory))fail('selection_output_symlink');if(!existsSync(directory))mkdirSync(directory,{mode:0o700});const files:Array<{id:string;file:FixedFile}>=[];
 const write=(name:string,value:any,jsonl=false)=>{const bytes=jsonl?value.map((x:any)=>JSON.stringify(x)+'\n').join(''):JSON.stringify(value)+'\n',path=join(directory,name);if(existsSync(path)){if(regular(path).toString()!==bytes)fail('selection_partial_output_identity');}else writeFileSync(path,bytes,{flag:'wx',mode:0o600});const file={path:relative(trustedInputs.repositoryRoot,path),sha256:sha(bytes)},id=`offline-selection/${spec.outputId}/${name}`;files.push({id,file});return {id,sha256:file.sha256};};
 const specRef=referenceOf(`offline-selection-spec/${spec.outputId}`,spec);write('spec.json',spec);
 const sourceInventoryRef=write('source-inventory.jsonl',result.sourceInventory,true),populationRef=write('population.jsonl',result.population,true),selectedMetadataRef=write('selected-metadata.jsonl',result.selectedMetadata,true),exclusionsRef=write('exclusions.jsonl',result.exclusions,true);
 const usedCatalogRef='usedCatalog'in result?write('used-catalog.json',result.usedCatalog):null;
 const production={schema:'ohuo-offline-selection-production-v1',...(usedCatalogRef?{usedCatalogRef}:{}),specRef,sourceInventoryRef,populationRef,selectedMetadataRef,exclusionsRef,quotaBasisRef:spec.quotaBasisRef,selectionRuleRef:spec.selectionRuleRef,targetDefinitionRef:spec.targetDefinitionRef,createdBeforeLabelEvidenceRef:result.quota.freezeEvidenceRef,counts:result.counts,verification:result.verification},productionRef=referenceOf(`offline-selection-production/${spec.outputId}`,production);write('production.json',production);
 const selection={schema:'ohuo-offline-label-selection-v2',sourceIndexRef:spec.sourceIndexRef,queueRef:spec.queueRef,purpose:spec.purpose,selectedCount:result.rows.length,quotas:result.quotas,rows:result.rows,productionRef},selectionRef=referenceOf(`offline-label-selection/${spec.outputId}`,selection);write('selection.json',selection);
 // Re-read the actual root immediately before the commit marker. A concurrent
 // host owns the same writer lock; this check is not a replacement for that lock.
 inputs(spec,trustedInputs);const manifestRef=write('manifest.json',{schema:'ohuo-offline-selection-commit-v1',selectionRef,productionRef,specRef,files:[...files]});const manifestFile=files.at(-1)!.file;return {selection,production,selectionRef,productionRef,specRef,manifestRef,manifestFile,files};
}
function lines(f:SelectionEvidenceRef,t:OfflineSelectionTrustedInputs){const b=fileBytes(f,t).toString();if(b&&!b.endsWith('\n'))fail('selection_incomplete_jsonl');return b?b.slice(0,-1).split('\n').map(s=>JSON.parse(s)):[];}
export function verifyOfflineSelection(selection:any,trustedInputs:OfflineSelectionTrustedInputs){
 strict(selection,['schema','sourceIndexRef','queueRef','purpose','selectedCount','quotas','rows','productionRef'],'selection_v2');if(selection.schema!=='ohuo-offline-label-selection-v2')fail('selection_v2_required');validateTrusted(trustedInputs);
 const production=refValue(selection.productionRef,trustedInputs),spec=refValue(production.specRef,trustedInputs) as OfflineSelectionSpec;strict(production,['schema','specRef','sourceInventoryRef','populationRef','selectedMetadataRef','exclusionsRef','quotaBasisRef','selectionRuleRef','targetDefinitionRef','createdBeforeLabelEvidenceRef','counts','verification',...(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA?['usedCatalogRef']:[])],'selection_production');if(production.schema!=='ohuo-offline-selection-production-v1')fail('selection_production_schema');
 validateSpec(spec);if(spec.schema===DESIGNED_SELECTION_SPEC_SCHEMA)designedSession(spec,trustedInputs);
 const firstRound=[COMMON_VIEW_SELECTION_SCHEMA,DESIGNED_SELECTION_RULE_SCHEMA,'ohuo-offline-selection-first-round-rule-v1','ohuo-offline-selection-first-round-pilot-rule-v1'].includes(trustedInputs.references.get(spec.selectionRuleRef)?.schema),slot=reproductionSlot(selection,spec,trustedInputs,firstRound);
 const fixed=readFixedProof(slot,()=>{
 const committed=committedSelection(spec,trustedInputs,outputRoot(spec,{...trustedInputs,outputDir:undefined}),false);if(!committed||!equal(committed.selection,selection)||!equal(committed.production,production))fail('selection_commit_identity');
 const fresh=inputs(spec,trustedInputs),result=enumerate(spec,trustedInputs,fresh),expected={schema:'ohuo-offline-label-selection-v2',sourceIndexRef:spec.sourceIndexRef,queueRef:spec.queueRef,purpose:spec.purpose,selectedCount:result.rows.length,quotas:result.quotas,rows:result.rows,productionRef:selection.productionRef};if(!equal(selection,expected)||!equal(production.counts,result.counts)||production.verification!==result.verification||!equal(production.quotaBasisRef,spec.quotaBasisRef)||production.selectionRuleRef!==spec.selectionRuleRef||production.targetDefinitionRef!==spec.targetDefinitionRef||!equal(production.createdBeforeLabelEvidenceRef,result.quota.freezeEvidenceRef))fail('selection_reproduction_mismatch');
 if('usedCatalog'in result&&!equal(jsonFile(production.usedCatalogRef,trustedInputs),result.usedCatalog))fail('designed_used_catalog_reproduction_mismatch');
 for(const [field,value] of [['sourceInventoryRef',result.sourceInventory],['populationRef',result.population],['selectedMetadataRef',result.selectedMetadata],['exclusionsRef',result.exclusions]] as const)if(!equal(lines(production[field],trustedInputs),value))fail('selection_artifact_reproduction_mismatch');
 return {committed,result,fresh:{commonView:fresh.commonView,state:fresh.state,roundAdmission:fresh.roundAdmission}};
 });
 const {committed,result,fresh}=fixed.value;
 // inputs() cold-checks this historical state; warm callers repeat every live
 // round predicate against that same frozen state, then the current label tail.
 if(fixed.reused&&fresh.roundAdmission)verifyCommonViewRoundAdmission(spec,trustedInputs,fresh.state);
 if(trustedInputs.phase==='label-start'||trustedInputs.phase==='label-resume'){
  const task=trustedInputs.task,state=JSON.parse(regular(screenRevalidationStatePath(trustedInputs)).toString()),selectionRef=committed.selectionRef;
  if(!task||task.planRef!==spec.planRef||task.budgetRef!==result.quota.budgetRef||!equal(task.datasetRefs,[selectionRef])||task.sourcePlan.sourceIndexRef!==spec.sourceIndexRef||task.seatLayoutPlan!==spec.queueRef||!task.releaseRefs?.includes(spec.actingReleaseRef)||spec.purpose==='b_training_source'&&task.parentPolicyRef!==spec.actingReleaseRef)fail('selection_task_binding');
  if(fresh.roundAdmission)verifyCommonViewRoundAdmission(spec,trustedInputs,state);
  for(const r of labelRuns(state,spec,trustedInputs))if(hasExposure(r,state,trustedInputs)){if(!equal(r.task.datasetRefs,[selectionRef])){const proof=fresh.roundAdmission;if(proof&&r.task.datasetRefs?.length===1&&proof.priorSelectionRefs.includes(r.task.datasetRefs[0]))continue;fail('selection_changed_after_label_exposure');}const currentKeys=new Set(selection.rows.filter((p:any)=>p.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(p.blockFamilyId??p.familyId)).map((p:any)=>key(p.key))),priorKeys=selection.rows.filter((p:any)=>p.split===r.task.sourcePlan.split&&r.task.sourcePlan.familyIds.includes(p.blockFamilyId??p.familyId)).map((p:any)=>key(p.key));if(r.runId!==task.runId&&priorKeys.some((k:string)=>currentKeys.has(k)))fail('selection_owned_rows_already_exposed');}
  if(trustedInputs.phase==='label-resume'){const r=state.runs?.[task.runId],cp=r?.checkpoint,owned=selection.rows.filter((p:any)=>p.split===task.sourcePlan.split&&task.sourcePlan.familyIds.includes(p.blockFamilyId??p.familyId)),active=cp?.active;const preparing=fresh.commonView&&cp&&r.checkpointSHA256===digest(cp)&&Number.isSafeInteger(cp.cursor)&&cp.cursor>=0&&cp.rows?.length===cp.cursor&&owned[cp.cursor]!==undefined&&['completed','failed','interrupted'].includes(r.status)&&r.cleanupConfirmed===true&&active?.phase==='world-preparation'&&active.index===cp.cursor&&active.inputSHA256===owned[cp.cursor]?.inputSHA256&&r.executionUnknown!==true&&r.observationStatus!=='unknown'&&r.failureReason!=='execution_uncertain'&&r.stopReason!=='execution_uncertain'&&!Object.values(state.budgets?.[task.budgetRef]?.reservations??{}).some((x:any)=>x.runId===task.runId&&['reserved','reserved_unknown'].includes(x.status));if(!r||r.taskSHA256!==digest(task)||cp?.selectionRef!==selectionRef||cp?.executionUnknown||active&&!preparing)fail('selection_resume_binding');}
 }
 // Cache only after every original artifact comparison and live gate passed.
 if(result.verification==='reproduced')fixed.publish();
 return {selection,production,spec,selectionRule:result.selectionRule,budgetRef:result.quota.budgetRef,population:result.population,selectedMetadata:result.selectedMetadata,exclusions:result.exclusions,sourceInventory:result.sourceInventory};
}

async function main(){
 const args=process.argv.slice(2);if(args.length!==6||args[0]!=='--input'||args[2]!=='--sha256'||args[4]!=='--output'||!hex(args[3]))throw Error('usage: offline-selection.ts --input <spec.json> --sha256 <bytesSHA> --output <lab/out/task>');
 const bytes=regular(resolve(args[1]));if(sha(bytes)!==args[3])throw Error('selection_cli_input_identity');const spec=JSON.parse(bytes.toString());validateSpec(spec);
 // This is one fixed source-reviewed resolver, never a module supplied by Task.
 const host=await import('./ohuo-host-files');if(typeof (host as any).createOfflineSelectionHostInputs!=='function')throw Error('capability_planned: fixed offline selection host resolver missing');
 const trusted=await (host as any).createOfflineSelectionHostInputs(spec,{phase:'freeze',outputDir:resolve(args[5])});console.log(JSON.stringify(prepareOfflineSelection(spec,trusted)));
}

// Complete module evaluation before the fixed host imports this module back.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(error=>{console.error(error);process.exitCode=1;});
}

/** §44.4: recover history from the original on-disk host.
 * No supplied row list, digest set, terminal status or zero-send exception may
 * narrow used history. This does not admit a Task or relax the natural gate. */
interface DesignedUsedCatalog {schema:'ohuo-designed-used-catalog-v1';hostManifest:any;hostSHA256:string;controlStateRef:SelectionEvidenceRef}
async function originalUsedCatalog(repositoryRoot:string,historical?:DesignedUsedCatalog){
 const {FixedHostFiles}=await import('./ohuo-host-files');
 const signals=new Map<string,string>(),signal=(path:string)=>{const st=lstatSync(path,{throwIfNoEntry:false});return st?canonical({mode:st.mode,size:st.size,mtimeMs:st.mtimeMs,ctimeMs:st.ctimeMs,ino:st.ino}):'missing';},pin=(path:string)=>{const value=signal(path),prior=signals.get(path);if(prior!==undefined&&prior!==value)fail('designed_used_fixed_input_changed');signals.set(path,value);};
 pin(join(repositoryRoot,'deliverables/ohuo-runtime/host.json'));
 const host=new FixedHostFiles(repositoryRoot),references=new Map<string,any>();
 let manifest=host.manifest;
 if(historical){
  strict(historical,['schema','hostManifest','hostSHA256','controlStateRef'],'designed_used_catalog');
  if(historical.schema!=='ohuo-designed-used-catalog-v1'||digest(historical.hostManifest)!==historical.hostSHA256)fail('designed_used_catalog_identity');
  const old=historical.hostManifest;
  if(old.controlRoot!==host.manifest.controlRoot||old.rootInstanceId!==host.manifest.rootInstanceId||!Array.isArray(old.references)||!Array.isArray(old.evidenceFiles)||!Array.isArray(old.inputBindings))fail('designed_used_catalog_host_identity');
  for(const [field,key]of [['references','ref'],['evidenceFiles','id'],['inputBindings','taskRef']]){
   const keys=new Set<string>();for(const row of old[field]){if(keys.has(row[key])||!host.manifest[field].some((now:any)=>now[key]===row[key]&&equal(now,row)))fail('designed_used_catalog_original_mapping_changed');keys.add(row[key]);}
  }
  manifest=old;
 }
 for(const entry of [...manifest.references,...manifest.evidenceFiles])pin(resolve(repositoryRoot,entry.file.path));
 for(const entry of manifest.inputBindings)pin(resolve(repositoryRoot,entry.sourceIndexFile.path));
 const assertUnchanged=()=>{for(const [path,before]of signals)if(signal(path)!==before)fail('designed_used_fixed_input_changed');};
 for(const entry of manifest.references)references.set(entry.ref,host.resolveRef(entry.ref));
 const evidenceFiles=new Map<string,FixedFile>(manifest.evidenceFiles.map((e:any)=>[e.id,e.file]));
 const requireIndex=(value:any)=>{
  const refs=[value?.sourceIndexRef,value?.sourcePlan?.sourceIndexRef].filter((r:any)=>r!==undefined);
  for(const ref of refs)if(references.get(ref)?.schema!=='ohuo-source-index-ref-v1')fail('used_catalog_bound_source_index_omitted');
 };
 for(const value of references.values())requireIndex(value);
 for(const binding of manifest.inputBindings){
  const task=references.get(binding.taskRef);if(!task)fail('used_catalog_bound_task_omitted');requireIndex(task);
  if(references.get(task.sourcePlan?.sourceIndexRef)?.fileSHA256!==binding.sourceIndexFile.sha256)fail('used_catalog_bound_source_index_mismatch');
 }
 const state=historical?JSON.parse(host.evidenceBytes(historical.controlStateRef).toString()):JSON.parse(regular(join(host.root,'state.json')).toString());
 if(state.schemaVersion!==1||!state.tasks||!state.runs)fail('used_catalog_original_control_state');
 for(const [taskId,runId]of Object.entries(state.tasks)){const run=state.runs[String(runId)];if(!run||run.task?.taskId!==taskId)fail('used_catalog_control_task_omitted');}
 for(const run of Object.values(state.runs) as any[]){
  if(!run.task||run.taskSHA256!==digest(run.task)||!equal(references.get(run.taskRef),run.task)||state.tasks[run.task.taskId]!==run.runId)fail('used_catalog_control_task_identity');requireIndex(run.task);
  for(const ref of run.task.datasetRefs??[])if(!references.has(ref))fail('used_catalog_control_selection_omitted');
 }
 const sourceIndexPath=(sourceIndexRef:string)=>{
  const index=references.get(sourceIndexRef);if(index?.schema!=='ohuo-source-index-ref-v1')fail('used_catalog_source_index_ref');
  const files=[...manifest.inputBindings.map((b:any)=>b.sourceIndexFile),...evidenceFiles.values()].filter((f:any)=>f.sha256===index.fileSHA256);
  const paths=[...new Map(files.map((f:any)=>[f.path,f])).values()] as FixedFile[];
  if(!paths.length)fail('used_catalog_original_index_file_missing');
  for(const file of paths)host.readFile(file);
  return resolve(repositoryRoot,paths.sort((a,b)=>bytesCompare(a.path,b.path))[0].path);
 };
 const trusted=(sourceIndexRef:string):OfflineSelectionTrustedInputs=>({repositoryRoot,references,evidenceFiles,sourceIndexPath:sourceIndexPath(sourceIndexRef),confirmedRecordRoots:[],controlRoot:host.root,mode:'research',phase:'dataset'});
 assertUnchanged();return{host,manifest,references,evidenceFiles,sourceIndexPath,trusted,assertUnchanged,pin};
}

/** A successor cannot hide an earlier dev/confirm family by using a fresh
 * namespace/index hash. Original host ownership is preserved, including the
 * implicit self-root of legacy natural families. No lineage is invented. */
export async function verifyDesignedSourceIndexSuccessor(repositoryRoot:string,sourceIndexRef:string){return verifyDesignedIndexInCatalog(await originalUsedCatalog(repositoryRoot),sourceIndexRef);}
function verifyDesignedIndexInCatalog(catalog:Awaited<ReturnType<typeof originalUsedCatalog>>,sourceIndexRef:string){
 const currentRef=catalog.references.get(sourceIndexRef);
 if(currentRef?.schema!=='ohuo-source-index-ref-v1')fail('designed_successor_index_reference');
 const current=JSON.parse(regular(catalog.sourceIndexPath(sourceIndexRef)).toString());
 if(current?.version!==1||!current.families||typeof current.families!=='object'||Array.isArray(current.families))fail('designed_successor_index_schema');
 const ownership=(id:string,row:any)=>{
  validateSourceFamily(id,'used.family');
  if(!row||!['train','dev','confirm','sealed'].includes(row.split))fail('used_catalog_family_split');
  const explicit=Object.hasOwn(row,'rootFamilyId')||Object.hasOwn(row,'parentFamilyIds');
  if(explicit&&(!Object.hasOwn(row,'rootFamilyId')||!Object.hasOwn(row,'parentFamilyIds')||!Array.isArray(row.parentFamilyIds)||new Set(row.parentFamilyIds).size!==row.parentFamilyIds.length))fail('used_catalog_family_ownership');
  const rootFamilyId=explicit?row.rootFamilyId:id,parentFamilyIds=explicit?[...row.parentFamilyIds].sort():[];
  validateSourceFamily(rootFamilyId,'used.rootFamily');for(const parent of parentFamilyIds)validateSourceFamily(parent,'used.parentFamily');
  return{split:row.split,rootFamilyId,parentFamilyIds};
 };
 const priorIndexRefs:string[]=[],families=new Map<string,any>();
 for(const [ref,value]of catalog.references){
  if(value?.schema!=='ohuo-source-index-ref-v1'||ref===sourceIndexRef)continue;
  const index=JSON.parse(regular(catalog.sourceIndexPath(ref)).toString());
  if(index?.version!==1||!index.families||typeof index.families!=='object'||Array.isArray(index.families))fail('used_catalog_original_index_schema');
  priorIndexRefs.push(ref);
  for(const [id,row]of Object.entries(index.families)){
   const expected=ownership(id,row),previous=families.get(id);
   if(previous&&!equal(previous,expected))fail('used_catalog_conflicting_family_ownership');
   if(!Object.hasOwn(current.families,id)||!equal(ownership(id,current.families[id]),expected))fail('designed_successor_drops_or_changes_original_family');
   families.set(id,expected);
  }
 }
 return{schema:'ohuo-designed-index-successor-preflight-v1' as const,sourceIndexRef,priorIndexRefs:priorIndexRefs.sort(),preservedFamilies:families.size,admission:'not_admitted' as const};
}

async function originalUsedSelections(repositoryRoot:string,historical?:DesignedUsedCatalog){
 const catalog=await originalUsedCatalog(repositoryRoot,historical),entries:any[]=[],selectionRefs=new Set<string>();
 for(const [id,file]of catalog.evidenceFiles){
  if(!/^offline-selection\/[^/]+\/manifest\.json$/.test(id))continue;
  const manifest=JSON.parse(catalog.host.evidenceBytes({id,sha256:file.sha256}).toString()),previous=catalog.references.get(manifest.specRef);
  if(manifest.schema!=='ohuo-offline-selection-commit-v1'||!previous)fail('used_catalog_manifest_identity');
  validateSpec(previous);const t=catalog.trusted(previous.sourceIndexRef),commit=committedSelection(previous,t,outputRoot(previous,{...t,outputDir:undefined}),false);
  if(!commit||commit.selectionRef!==manifest.selectionRef||!equal(catalog.references.get(commit.selectionRef),commit.selection)||!equal(catalog.references.get(commit.productionRef),commit.production)||selectionRefs.has(commit.selectionRef))fail('used_catalog_committed_selection_identity');
  const rule=refValue(previous.selectionRuleRef,t);
  if(![COMMON_VIEW_SELECTION_SCHEMA,DESIGNED_SELECTION_RULE_SCHEMA,'ohuo-offline-selection-first-round-rule-v1','ohuo-offline-selection-first-round-pilot-rule-v1'].includes(rule?.schema))fail('used_catalog_non_common_view_source_requires_reader');
  if(previous.schema===DESIGNED_SELECTION_SPEC_SCHEMA)designedContract(previous,t);
  const population=lines(commit.production.populationRef,t),metadata=lines(commit.production.selectedMetadataRef,t);
  for(const row of commit.selection.rows){
   if(!population.some(p=>equal(p.key,row.key)&&p.inputSHA256===row.inputSHA256)||!metadata.some(m=>m.sampleKind==='demo'&&equal(m.key,row.key)&&m.inputSHA256===row.inputSHA256))fail('used_catalog_selected_row_not_in_original_population');
  }
  const contract=previous.schema===COMMON_VIEW_ROUND_SPEC_SCHEMA?refValue(previous.roundContractRef,t):null;
  if(contract&&contract.schema!==COMMON_VIEW_ROUND_CONTRACT_SCHEMA)fail('used_catalog_round_contract');
  selectionRefs.add(commit.selectionRef);entries.push({...commit,spec:previous,contract,round:contract?.round??0,parentSelectionRef:contract?.parentSelectionRef??null,rows:commit.selection.rows});
 }
 // A registered selection omitted from the manifest catalog cannot disappear,
 // including a future designed/new-test schema that needs its own real reader.
 for(const [ref,value]of catalog.references){
  if(value?.schema==='ohuo-offline-label-selection-v2'&&!selectionRefs.has(ref))fail('used_catalog_selection_manifest_omitted');
  if(typeof value?.schema==='string'&&(/selection-result-v\d+$/.test(value.schema)||/label-selection-v\d+$/.test(value.schema))&&value.schema!=='ohuo-offline-label-selection-v2')fail('used_catalog_selection_requires_source_kind_reader');
 }
 for(const entry of entries.filter(e=>e.contract)){
  const group=entries.filter(e=>e.spec.planRef===entry.spec.planRef&&e.spec.sourceIndexRef===entry.spec.sourceIndexRef&&e.spec.queueRef===entry.spec.queueRef);
  if(group.some(e=>e.contract&&e.contract.poolRef!==entry.contract.poolRef))fail('used_catalog_round_pool_fork');
  validateCommonViewRoundChain(entry.contract,group);
 }
 // Check all key conflicts before replaying one source. Failed, unknown and
 // frozen-but-unasked selections still contribute every original selected row.
 const byKey=new Map<string,string>();
 for(const entry of entries)for(const row of entry.rows){const id=canonical(row.key),prior=byKey.get(id);if(!hex(row.inputSHA256)||prior&&prior!==row.inputSHA256)fail('used_catalog_conflicting_key_input');byKey.set(id,row.inputSHA256);}
 return {catalog,entries,selectionRefs};
}

/** Public metadata readout only, never an authority or normalized-hash proof. */
export async function readUsedCommonSelectionRows(repositoryRoot:string){
 const {entries,selectionRefs}=await originalUsedSelections(repositoryRoot);
 const rows=entries.flatMap(entry=>entry.rows.map((row:any)=>{
  if(row.sourceKind!==undefined&&!['natural-recorded','designed-synthetic'].includes(row.sourceKind))fail('used_catalog_selection_requires_source_kind_reader');
  return {selectionRef:entry.selectionRef,productionRef:entry.productionRef,sourceKind:row.sourceKind??'natural-recorded',row:structuredClone(row)};
 }));
 return {schema:'ohuo-used-selection-catalog-preflight-v1' as const,admission:'not_admitted' as const,rows,selectionRefs:[...selectionRefs].sort(),manifestRefs:entries.map(e=>e.manifestRef)};
}

/** Reproduce only the immutable pre-commit history of a real designed commit.
 * Later catalog additions remain live for new selection but cannot retroactively
 * change this selection's original denominator. */
export async function readUsedCommonSelectionRowsAtCommit(repositoryRoot:string,selectionRef:string){
 const current=await originalUsedCatalog(repositoryRoot),selection=current.references.get(selectionRef);
 if(selection?.schema!=='ohuo-offline-label-selection-v2')fail('designed_used_committed_selection_required');
 const production=current.references.get(selection.productionRef),spec=current.references.get(production?.specRef) as OfflineSelectionSpec;
 if(spec?.schema!==DESIGNED_SELECTION_SPEC_SCHEMA)fail('designed_used_committed_selection_required');
 const t=current.trusted(spec.sourceIndexRef),commit=committedSelection(spec,t,outputRoot(spec,{...t,outputDir:undefined}),false);
 if(!commit||commit.selectionRef!==selectionRef)fail('designed_used_committed_selection_required');
 const historical=jsonFile(commit.production.usedCatalogRef,t),history=await originalUsedSelections(repositoryRoot,historical);
 verifyDesignedIndexInCatalog(history.catalog,spec.sourceIndexRef);
 return {schema:'ohuo-used-selection-catalog-preflight-v1' as const,admission:'not_admitted' as const,rows:history.entries.flatMap(entry=>entry.rows.map((row:any)=>({selectionRef:entry.selectionRef,productionRef:entry.productionRef,sourceKind:row.sourceKind??'natural-recorded',row:structuredClone(row)}))),selectionRefs:[...history.selectionRefs].sort(),manifestRefs:history.entries.map(e=>e.manifestRef)};
}

export async function readUsedCommonDecisionCatalog(repositoryRoot:string){
 const {entries,selectionRefs}=await originalUsedSelections(repositoryRoot);
 const cache=new Map(),rows:any[]=[];
 for(const entry of entries)for(const row of entry.rows){
  if(row.sourceKind!==undefined&&row.sourceKind!=='natural-recorded')fail('used_catalog_selection_requires_source_kind_reader');
  // Explicit natural-recorded is a new row version, not an excuse to strip an
  // arbitrary source tag and feed a designed object into the natural reader.
  const snapshot=readOriginalOfflineSnapshot(row,cache),identity=commonDecisionIdentityForSnapshot(snapshot);
  rows.push({selectionRef:entry.selectionRef,productionRef:entry.productionRef,sourceKind:'natural-recorded' as const,row:structuredClone(row),identity});
 }
 return{schema:'ohuo-used-common-decision-catalog-preflight-v1' as const,admission:'not_admitted' as const,rows,selectionRefs:[...selectionRefs].sort(),manifestRefs:entries.map(e=>e.manifestRef)};
}

export type SelectedDesignedDecision=import('./designed-source').DesignedSnapshot['row'];
export type SelectedDecision=SelectedRecordedDecision|SelectedDesignedDecision;
export type SelectionSnapshot=ReturnType<typeof readOriginalOfflineSnapshot>|import('./designed-source').DesignedSnapshot;
interface DesignedSession {
 repositoryRoot:string;specRef:string;spec:OfflineSelectionSpec;catalog:ReturnType<typeof catalogView>;
 inputs:import('./designed-source').DesignedSourceInputs;
 reader:ReturnType<typeof import('./designed-source').createDesignedSourceReader>;
 runtime:import('./designed-source').DesignedSourceRuntime;
 used:Array<{selectionRef:string;row:SelectedDecision;identity:ReturnType<typeof commonDecisionIdentityForSnapshot>}>;
 assertUnchanged:()=>void;usedSelectionRefs:string[];usedCatalog:DesignedUsedCatalog;indexSuccessor:Awaited<ReturnType<typeof verifyDesignedSourceIndexSuccessor>>;
}
const designedSessions=new WeakMap<object,DesignedSession>();

function designedContract(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs){
 if(spec.schema!==DESIGNED_SELECTION_SPEC_SCHEMA||spec.purpose!=='b_training_source'||spec.sourceRunRefs.length)fail('designed_selection_explicit_source_kind');
 const contract=refValue(spec.designedContractRef!,t),rule=refValue(spec.selectionRuleRef,t);
 strict(contract,['schema','planRef','clauseRef','branchRef','budgetRef','protocolRef','comparisonRef','sourceIndexRef','queueRef','selectionRuleRef','targetDefinitionRef','plannedTasks'],'designed_selection_contract');
 if(contract.schema!=='ohuo-designed-source-consumer-contract-v1')fail('designed_selection_contract_schema');
 for(const field of ['planRef','clauseRef','branchRef','sourceIndexRef','queueRef','selectionRuleRef','targetDefinitionRef'] as const)if(contract[field]!==spec[field])fail('designed_selection_contract_binding');
 for(const field of ['budgetRef','protocolRef','comparisonRef'])fixedReference(contract[field],field);
 if(!equal(rule,{schema:DESIGNED_SELECTION_RULE_SCHEMA,protocolRef:contract.protocolRef,comparisonRef:contract.comparisonRef,targetDefinitionRef:spec.targetDefinitionRef,sourceKind:'designed-synthetic',split:'train',representativeRule:'one-hash-representative-per-root-public-cell',usedRule:'all-original-host-committed-selections',ordinaryKeepRule:'existing-natural-train-pool-disjoint-causal-context'}))fail('designed_selection_rule');
 readCommonViewProtocol(contract.protocolRef,(r:string)=>refValue(r,t));
 if(!Array.isArray(contract.plannedTasks)||!contract.plannedTasks.length)fail('designed_selection_task_roles');
 const tasks=new Set<string>();for(const row of contract.plannedTasks){strict(row,['role','taskId','runId','experimentId'],'designed_selection_task_role');if(!['teacher','screen'].includes(row.role)||tasks.has(row.taskId))fail('designed_selection_task_roles');for(const field of ['taskId','runId','experimentId'])validateIdentifier(row[field],field);if(row.taskId!==row.runId)fail('designed_selection_task_roles');tasks.add(row.taskId);}
 const comparison=refValue(contract.comparisonRef,t);strict(comparison,['schema','proposalRef','studentParentRef'],'designed_selection_comparison');
 if(comparison.schema!=='ohuo-first-round-comparison-v1'||comparison.proposalRef!==spec.actingReleaseRef)fail('designed_selection_comparison_binding');
 validateFirstRoundTargetDefinition(refValue(spec.targetDefinitionRef,t));
 const queue=refValue(spec.queueRef,t),indexRef=refValue(spec.sourceIndexRef,t);
 strict(queue,['schema','namespace','sourceIndexRef','rows'],'designed_selection_queue');
 if(queue.schema!=='ohuo-designed-source-queue-v1'||queue.namespace!==indexRef.namespace||queue.sourceIndexRef!==spec.sourceIndexRef||!Array.isArray(queue.rows)||!queue.rows.length)fail('designed_selection_queue_binding');
 const seen=new Set<string>();for(const row of queue.rows){strict(row,['sourceKind','sourceRef'],'designed_selection_locator');fixedReference(row.sourceRef,'designed_source_ref');if(row.sourceKind!=='designed-synthetic'||seen.has(row.sourceRef))fail('designed_selection_queue_identity');seen.add(row.sourceRef);const registration=refValue(row.sourceRef,t);if(registration.sourceIndexRef!==spec.sourceIndexRef||registration.comparisonRef!==contract.comparisonRef)fail('designed_selection_registered_comparison');}
 return{contract,rule,comparison,queue};
}

/** Original H calls this after its existing source/action/authorization gates.
 * Runtime and used identity are reconstructed here, never accepted from JSON,
 * caller callbacks, serialized proofs or an untrusted supplied hash list. */
export async function createDesignedSelectionSession(repositoryRoot:string,specRef:string){
 const catalog=await originalUsedCatalog(repositoryRoot),spec=catalog.references.get(specRef) as OfflineSelectionSpec;
 if(!spec||referenceOf(`offline-selection-spec/${spec.outputId}`,spec)!==specRef)fail('designed_selection_fixed_spec');validateSpec(spec);
 const t=catalog.trusted(spec.sourceIndexRef),{contract}=designedContract(spec,t);
 const {createDesignedSourceReader}=await import('./designed-source'),{resolveNodePolicy}=await import('./policy-loader'),{resolveFirstRoundParent}=await import('./first-round-parent');
 const runtimeCache=new Map<string,import('./designed-source').DesignedSourceRuntime>();
 const runtimeFor=async(comparisonRef:string)=>{
  if(runtimeCache.has(comparisonRef))return runtimeCache.get(comparisonRef)!;
  const c=refValue(comparisonRef,t);if(c.schema!=='ohuo-first-round-comparison-v1')fail('designed_selection_comparison_binding');
  const proposalRef=resolveCandidateReleaseRef(refValue(c.proposalRef,t),(ref:string)=>refValue(ref,t),RELEASES),loaded=await resolveNodePolicy(proposalRef.release.proposalPolicyRef,repositoryRoot);
  if(!equal(JSON.parse(JSON.stringify(loaded.identity)),proposalRef.policyIdentity))fail('designed_selection_actual_B_identity');
  const parent=await resolveFirstRoundParent({parentRef:c.studentParentRef,envelope:refValue(c.studentParentRef,t),readEvidence:f=>fileBytes(f,t),repositoryRoot}),runtime={proposal:{...loaded,candidatePolicy:proposalRef.candidatePolicy},parent};runtimeCache.set(comparisonRef,runtime);return runtime;
 };
 const readerCache=new Map<string,ReturnType<typeof createDesignedSourceReader>>(),readerFor=(indexRef:string)=>{
  if(!readerCache.has(indexRef))readerCache.set(indexRef,createDesignedSourceReader({...t,sourceIndexRef:indexRef,sourceIndexPath:catalog.sourceIndexPath(indexRef)}));return readerCache.get(indexRef)!;
 };
 const manifestId=`offline-selection/${spec.outputId}/manifest.json`,existing=catalog.evidenceFiles.has(manifestId)?committedSelection(spec,t,outputRoot(spec,{...t,outputDir:undefined}),false):null;
 const quota=jsonFile(spec.quotaBasisRef,t),usedCatalog:DesignedUsedCatalog=existing?jsonFile(existing.production.usedCatalogRef,t):{schema:'ohuo-designed-used-catalog-v1',hostManifest:structuredClone(catalog.host.manifest),hostSHA256:digest(catalog.host.manifest),controlStateRef:structuredClone(quota.controlStateRef)};
 const history=await originalUsedSelections(repositoryRoot,usedCatalog),indexSuccessor=verifyDesignedIndexInCatalog(history.catalog,spec.sourceIndexRef),used:DesignedSession['used']=[],cache=new Map(),usedSelectionRefs:string[]=[];
 for(const entry of history.entries){
  if(entry.production.specRef===specRef)continue;usedSelectionRefs.push(entry.selectionRef);
  for(const row of entry.rows){let snapshot:SelectionSnapshot;
   if(row.sourceKind==='designed-synthetic'){const old=designedContract(entry.spec,catalog.trusted(entry.spec.sourceIndexRef));snapshot=readerFor(entry.spec.sourceIndexRef).readSnapshot(row,await runtimeFor(old.contract.comparisonRef));if(!equal(snapshot.row,row))fail('designed_used_row_reproduction');}
   else if(row.sourceKind===undefined||row.sourceKind==='natural-recorded'){
    rootLocation(row.recordRoot,repositoryRoot);rootLocation(row.recordRef.directory,repositoryRoot);
    const paths=[row.recordRef.directory,...readdirSync(row.recordRef.directory).map(name=>join(row.recordRef.directory,name))];paths.forEach(history.catalog.pin);snapshot=readOriginalOfflineSnapshot(row,cache);history.catalog.assertUnchanged();
   }
   else fail('used_catalog_selection_requires_source_kind_reader');
   used.push({selectionRef:entry.selectionRef,row:structuredClone(row),identity:commonDecisionIdentityForSnapshot(snapshot)});
  }
 }
 const inputs={repositoryRoot,sourceIndexPath:t.sourceIndexPath,sourceIndexRef:spec.sourceIndexRef,references:t.references,evidenceFiles:t.evidenceFiles},reader=readerFor(spec.sourceIndexRef),runtime=await runtimeFor(contract.comparisonRef),token=Object.freeze({});
 const assertUnchanged=()=>{catalog.assertUnchanged();history.catalog.assertUnchanged();for(const reader of readerCache.values())reader.assertUnchanged();};assertUnchanged();
 designedSessions.set(token,{assertUnchanged,repositoryRoot,specRef,spec:structuredClone(spec),catalog:freezeCopy(catalogView(t)),inputs,reader,runtime,used,usedSelectionRefs:usedSelectionRefs.sort(),usedCatalog,indexSuccessor});return token;
}
/** Opaque original-history readout for H's live run/unknown/ledger gates. */
export function readDesignedSelectionHistory(token:object,expected?:Pick<OfflineSelectionTrustedInputs,'repositoryRoot'|'sourceIndexPath'|'references'|'evidenceFiles'>&{specRef:string}){
 const value=designedSessions.get(token);if(!value)fail('designed_selection_owned_runtime_required');
 if(expected&&(value.repositoryRoot!==expected.repositoryRoot||value.specRef!==expected.specRef||value.inputs.sourceIndexPath!==expected.sourceIndexPath||!equal(value.catalog,catalogView(expected))))fail('designed_selection_owned_runtime_required');
 value.assertUnchanged();
 return {specRef:value.specRef,sourceIndexRef:value.spec.sourceIndexRef,usedSelectionRefs:structuredClone(value.usedSelectionRefs),indexSuccessor:structuredClone(value.indexSuccessor)};
}
function designedSession(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs){
 const value=t.designedSession&&designedSessions.get(t.designedSession);
 if(!value||value.repositoryRoot!==t.repositoryRoot||!equal(value.spec,spec)||value.inputs.sourceIndexPath!==t.sourceIndexPath||!equal(value.catalog,catalogView(t)))fail('designed_selection_owned_runtime_required');
 value.assertUnchanged();return value;
}
export function readSelectionSnapshot(row:SelectedDecision,t:OfflineSelectionTrustedInputs,cache=new Map<string,ReturnType<typeof loadOriginalMatchStore>>(),options?:{purpose:'first-round-new-test'}):SelectionSnapshot{
 if((row as SelectedDesignedDecision).sourceKind==='designed-synthetic'){
  const value=t.designedSession&&designedSessions.get(t.designedSession);if(!value)fail('designed_selection_owned_runtime_required');designedSession(value.spec,t);
  const snapshot=value.reader.readSnapshot(row as SelectedDesignedDecision,value.runtime);if(!equal(snapshot.row,row))fail('designed_selection_row_identity');return snapshot;
 }
 if((row as {sourceKind?:string}).sourceKind!==undefined&&(row as {sourceKind?:string}).sourceKind!=='natural-recorded')fail('offline_source_kind_unrecognized');
 return readOriginalOfflineSnapshot(row as SelectedRecordedDecision,cache,options);
}
/** Pure consistency check, never a used-history or admission proof. The
 * production caller separately requires original opaque-session membership;
 * H also verifies actual Task/checkpoint files and rechecks the live ledger. */
export function isSettledDesignedPriorRun(run:any,state:any):boolean {
 const task=run?.task,ledger=state?.budgets?.[task?.budgetRef],cp=run?.checkpoint;
 if(!task||!ledger||run.runId!==task.runId||run.taskSHA256!==digest(task)||state.tasks?.[task.taskId]!==run.runId)return false;
 return ['completed','failed','interrupted'].includes(run.status)&&run.cleanupConfirmed===true&&run.executionUnknown!==true&&run.observationStatus!=='unknown'&&run.failureReason!=='execution_uncertain'&&run.stopReason!=='execution_uncertain'&&cp?.executionUnknown!==true&&cp?.active==null&&!(cp?.rows??[]).some((row:any)=>row.requestCount===null)&&ledger.activeRunId!==run.runId&&!Object.values(ledger.reservations??{}).some((reservation:any)=>reservation.runId===run.runId&&['reserved','reserved_unknown'].includes(reservation.status));
}
function designedInputs(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs){
 validateTrusted(t);if(t.mode!=='research')fail('designed_selection_original_research_host_required');
 const session=designedSession(spec,t),facts=designedContract(spec,t),quota=jsonFile(spec.quotaBasisRef,t);
 strict(quota,['schema','planRef','budgetRef','controlStateRef','stage2Stage3AccountingRefs','protocolRef','families','reasonRef','freezeEvidenceRef'],'designed_selection_quota');
 if(quota.schema!==COMMON_VIEW_SOURCE_BASIS_SCHEMA||quota.planRef!==spec.planRef||quota.budgetRef!==facts.contract.budgetRef||quota.protocolRef!==facts.contract.protocolRef||!Array.isArray(quota.families)||!quota.families.length)fail('designed_selection_quota_binding');
 const frozen=quota.families.map((row:any)=>{strict(row,['familyId','split'],'designed_selection_family');validateSourceFamily(row.familyId,'familyId');if(row.split!=='train')fail('designed_selection_train_only');return{...row,count:null};});
 if(new Set(frozen.map((r:any)=>r.familyId)).size!==frozen.length)fail('designed_selection_family_duplicate');
 const budget=refValue(quota.budgetRef,t),state=jsonFile(quota.controlStateRef,t),ledger=state.budgets?.[quota.budgetRef];
 if(budget.planRef!==spec.planRef||budget.controlRoot!==t.controlRoot||state.schemaVersion!==1||!state.runs||!state.tasks||!ledger||ledger.planRef!==spec.planRef||!equal(ledger.limits,budget.limits)||ledger.authorizationRef!==budget.authorizationRef||ledger.researchBatchId!==budget.researchBatchId||state.batches?.[budget.researchBatchId]?.budgetRef!==quota.budgetRef||state.batches[budget.researchBatchId].authorizationRef!==budget.authorizationRef||!ledger.used||!ledger.reservations)fail('designed_selection_original_budget_state');
 for(const k of ['providerRequests','optimizerSteps','matchAttempts','labelDecisions'])if(!Number.isSafeInteger(ledger.used[k])||ledger.used[k]<0)fail('selection_budget_remaining_unknown');
 if(Object.values(ledger.reservations).some((r:any)=>!['released','reserved','consumed','committed'].includes(r.status)))fail('selection_budget_remaining_unknown');
 if(!Array.isArray(quota.stage2Stage3AccountingRefs)||ledger.used.providerRequests>0&&!quota.stage2Stage3AccountingRefs.length)fail('selection_previous_accounting_refs_missing');quota.stage2Stage3AccountingRefs.forEach((f:SelectionEvidenceRef)=>fileBytes(f,t));jsonFile(quota.reasonRef,t);
 if(!equal(jsonFile(quota.freezeEvidenceRef,t),{schema:'ohuo-selection-prequery-v1',planRef:spec.planRef,clauseRef:spec.clauseRef,branchRef:spec.branchRef,budgetRef:quota.budgetRef,controlRoot:t.controlRoot,controlStateRef:quota.controlStateRef}))fail('selection_prequery_evidence_identity');
 const usedSelections=new Set(session.usedSelectionRefs);
 for(const run of labelRuns(state,spec,t))if(hasExposure(run,state,t)){
  if(run.task.datasetRefs?.length!==1||!usedSelections.has(run.task.datasetRefs[0]))fail('selection_label_exposure_before_freeze');
  if(!isSettledDesignedPriorRun(run,state))fail('designed_selection_prior_execution_uncertain');
 }
 if(t.phase==='freeze'&&!equal(JSON.parse(regular(screenRevalidationStatePath(t)).toString()),state))fail('selection_prequery_state_changed');
 const indexBytes=regular(t.sourceIndexPath),indexRef=refValue(spec.sourceIndexRef,t),index=JSON.parse(indexBytes.toString());if(sha(indexBytes)!==indexRef.fileSHA256||index.version!==1||frozen.some((r:any)=>index.families?.[r.familyId]?.split!=='train'))fail('selection_source_index_binding');
 if(t.task){const role=facts.contract.plannedTasks.find((r:any)=>r.taskId===t.task.taskId);if(!role||role.runId!==t.task.runId||role.experimentId!==t.task.experimentId||t.task.planRef!==spec.planRef||t.task.budgetRef!==quota.budgetRef||t.task.sourcePlan.sourceIndexRef!==spec.sourceIndexRef||t.task.seatLayoutPlan!==spec.queueRef||t.task.scientificContract.analysisMethodRef!==facts.contract.protocolRef||t.task.scientificContract.comparisonRef!==facts.contract.comparisonRef)fail('designed_selection_task_binding');}
 return{...facts,session,quota,frozen,state,index,commonView:true,firstRound:true,roundAdmission:null};
}
function enumerateDesignedSelection(spec:OfflineSelectionSpec,t:OfflineSelectionTrustedInputs){
 const x=designedInputs(spec,t),population:any[]=[],inventory:any[]=[],exclusions:any[]=[],used=new Set(x.session.used.map(r=>r.identity.sha256)),identities=new Set<string>();
 for(const locator of x.queue.rows){
  try{
   const snapshot=x.session.reader.readSnapshot(locator,x.session.runtime),row=snapshot.row,registration=refValue(locator.sourceRef,t),identity=commonDecisionIdentityForSnapshot(snapshot);
   if(!x.frozen.some((f:any)=>f.familyId===row.blockFamilyId))fail('designed_selection_root_outside_frozen_scope');
   const target=classifyFirstRoundTarget({state:snapshot.state,actorSeat:row.actorSeat,candidateCombos:snapshot.bundle.initialCandidateIds.map(id=>snapshot.bundle.pool.find(c=>c.actionId===id)!.canonical),originalWitnessCombos:snapshot.bundle.pool.filter(c=>!snapshot.bundle.initialCandidateIds.includes(c.actionId)&&c.canonical!==null).map(c=>c.canonical!)},refValue(spec.targetDefinitionRef,t));
   const reason=used.has(identity.sha256)?'previously_selected_common_decision':identities.has(identity.sha256)?'duplicate_common_decision':target.sampleClass!=='target'?'not_target':target.coverage!=='covered'?'candidate_coverage_'+target.coverage:snapshot.bundle.isUniqueLegalAction?'unique_legal_action':null;identities.add(identity.sha256);
   inventory.push({sourceKind:'designed-synthetic',sourceRef:row.sourceRef,questionId:row.questionId,sourceFile:registration.sourceFile,status:'replayed',reason:null});
   population.push({...row,decisionId:snapshot.bundle.decisionId,decisionSHA256:sha(row.questionId),sampleClass:target.sampleClass,contextSHA256:identity.sha256,normalizedDecisionIdentity:identity,commonViewCell:reason?null:commonViewCoverageCell(commonViewForSnapshot(snapshot).modelPayload),eligibility:reason?'excluded':'eligible',exclusionReason:reason,targetCoverage:target.coverage,targetReason:target.reason});
  }catch(error){const reason=String((error as Error).message);inventory.push({...locator,status:'rejected',reason});exclusions.push({...locator,decisionId:null,key:null,familyId:null,reason,expected:null,actual:null});}
 }
 x.session.assertUnchanged();
 const {selected,byRoot}=selectDesignedPublicRepresentatives(population,x.frozen);
 for(const p of population)if(p.exclusionReason)exclusions.push({sourceKind:'designed-synthetic',sourceRef:p.sourceRef,decisionId:p.decisionId,key:p.key,familyId:p.familyId,blockFamilyId:p.blockFamilyId,reason:p.exclusionReason,expected:null,actual:null});
 const rowFields=['sourceKind','sourceRef','questionId','key','inputSHA256','familyId','blockFamilyId','split','actorSeat'],rows=selected.map(p=>Object.fromEntries(rowFields.map(k=>[k,p[k]]))),selectedMetadata=selected.map((p,rank)=>({sourceKind:'designed-synthetic',sourceRef:p.sourceRef,decisionId:p.decisionId,key:p.key,inputSHA256:p.inputSHA256,blockFamilyId:p.blockFamilyId,sampleKind:'demo',sampleClass:'target',contextSHA256:p.contextSHA256,rank}));
 return {spec,usedCatalog:structuredClone(x.session.usedCatalog),sourceInventory:inventory,population,selectedMetadata,exclusions,rows,quotas:x.frozen.map((f:any)=>({familyId:f.familyId,count:selected.filter(r=>r.blockFamilyId===f.familyId).length})).filter((q:any)=>q.count>0),counts:{sourceKind:'designed-synthetic',enumerated:x.queue.rows.length,replayed:population.length,rejected:inventory.filter(r=>r.status==='rejected').length,eligible:population.filter(r=>r.eligibility==='eligible').length,selected:rows.length,keep:0,keepRequired:rows.length,byRoot,usedSelectionRefs:x.session.usedSelectionRefs},verification:'reproduced' as const,quota:x.quota,selectionRule:x.rule};
}

/** Pure answer-independent ordering, not a source/used/Task proof. The only
 * production caller first reconstructs every row through the owned session. */
export function selectDesignedPublicRepresentatives(population:any[],families:ReadonlyArray<{familyId:string;split:string}>){
 const selected:any[]=[],byRoot:any[]=[];
 for(const family of families){
  if(family.split!=='train')fail('designed_selection_train_only');
  const candidates=population.filter(r=>r.blockFamilyId===family.familyId&&r.eligibility==='eligible');
  if(candidates.some(r=>r.sourceKind!=='designed-synthetic'||r.split!=='train'||!hex(r.decisionSHA256)||typeof r.questionId!=='string'))fail('designed_selection_public_population');
  candidates.sort((a,b)=>bytesCompare(a.decisionSHA256,b.decisionSHA256)||bytesCompare(a.questionId,b.questionId)||bytesCompare(canonical(a.key),canonical(b.key)));
  const chosen=selectCommonViewRepresentatives(candidates,0);selected.push(...chosen.selected);byRoot.push({familyId:family.familyId,split:'train',sourceKind:'designed-synthetic',eligible:candidates.length,selected:chosen.selected.length,cells:chosen.cells});
  for(const p of chosen.deferred){p.eligibility='excluded';p.exclusionReason='public_cell_representative_deferred';}
 }
 return{selected,byRoot};
}
