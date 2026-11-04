/** Original source-owner admission of a completed designer inventory.
 * Original H authorizes the named nonrunner action. No provider, teacher,
 * learner, target action, synthetic record, new runner or new ledger is used.
 * A complete immutable successor preserves every original index family; only
 * proved source registrations/queue refs are appended to the original host. */
import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,existsSync,renameSync,readdirSync,rmSync} from 'node:fs';
import {join,relative,isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {createMatch,startGame} from '@gd/engine';
import {dealtFamilyBeforeExchange} from '../review6/training-ancestry';
import {FixedHostFiles} from './ohuo-host-files';
import {designedFamilyOwnership as ownership,mergeDesignedSourceIndices,reserveDesignedFamilies,validateDesignedFamilyReservationSpec,verifyDesignedFamilyReservationLink} from './designed-family-reservation';
import {acquireSourceWriter} from './writer-lock';
import {canonical,digest,referenceOf,fixedReference,strictObject,validateIdentifier,validateSourceFamily} from './task-schema.mjs';
import {parseDesignedFirstGameSource,createDesignedSourceReader,DESIGNED_FIRST_GAME_V2_SCHEMA,type DesignedSourceRuntime} from './designed-source';
import {isDesignedSourceCheckpoint} from './designed-source-consumer';
import {prepareDesignedSourceRequest,queryDesignedSource,type DesignedRemoteResult} from './designed-source-request';
import {readUsedCommonSelectionRows} from './offline-selection';
import {readOfflineSnapshot,commonDecisionIdentityForSnapshot} from './offline-label-source';
import {commonViewCoverageCell} from './first-round-source-batch.mjs';
import {resolveCandidateReleaseRef} from '../../packages/ai/src/policy/candidate-release';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {resolveNodePolicy} from './policy-loader';
import {resolveFirstRoundParent} from './first-round-parent';
const sha=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const need=(ok:unknown,reason:string)=>{if(!ok)throw Error('designed_acceptance_'+reason);};
type File={path:string;sha256:string};
export interface DesignedSourceAcceptanceSpec {schema:'ohuo-designed-source-acceptance-spec-v1';planRef:string;clauseRef:string;branchRef:string|null;designerTaskRef:string;sourceIndexRef:string;comparisonRef:string;outputId:string}
function shape(s:any):asserts s is DesignedSourceAcceptanceSpec {strictObject(s,'sourceAcceptanceSpec',['schema','planRef','clauseRef','branchRef','designerTaskRef','sourceIndexRef','comparisonRef','outputId']);need(s.schema==='ohuo-designed-source-acceptance-spec-v1','schema');for(const k of ['planRef','clauseRef','designerTaskRef','sourceIndexRef','comparisonRef'])fixedReference(s[k],k);if(s.branchRef!==null)fixedReference(s.branchRef,'branchRef');validateIdentifier(s.outputId,'outputId');}
export {mergeDesignedSourceIndices} from './designed-family-reservation';
/** Original engine computes actual deal-family identity; no natural seed claim. */
export function inspectDesignedCandidateSource(raw:string){const source=parseDesignedFirstGameSource(raw),state=startGame(createMatch(structuredClone(source.rules),source.origin.leaderSeed),[],source.initialIds);return{source,sourceFamilyId:dealtFamilyBeforeExchange(state)};}
/** The original terminal query was revalidated before this file boundary.
 * v1 keeps its canonical candidate contract; v2 binds the exact response bytes. */
export function assertDesignedCandidateResponse(raw:Buffer,result:DesignedRemoteResult){need(equal(JSON.parse(raw.toString('utf8')),result.response),'candidate_response_identity');if(result.response?.schema===DESIGNED_FIRST_GAME_V2_SCHEMA)need(typeof result.privateResponseText==='string'&&raw.equals(Buffer.from(result.privateResponseText,'utf8')),'candidate_raw_response_identity');}
function appendFamily(index:any,source:any,familyId:string){const own=index.families[source.designFamilyId];need(Object.hasOwn(own??{},'rootFamilyId')&&Array.isArray(own.parentFamilyIds),'design_ownership_required');const root=own.rootFamilyId,active=new Set<string>();const visit=(id:string)=>{need(!active.has(id),'family_cycle');active.add(id);const o=ownership(id,index.families[id]);need(o.split==='train'&&o.rootFamilyId===root,'nontrain_or_foreign_root');for(const p of o.parentFamilyIds)visit(p);active.delete(id);};visit(source.designFamilyId);visit(root);if(Object.hasOwn(index.families,familyId)){const old=ownership(familyId,index.families[familyId]);need(old.split==='train'&&old.rootFamilyId===root,'deal_reuses_other_split_or_root');need(Object.hasOwn(index.families[familyId],'rootFamilyId'),'legacy_deal_cannot_be_reassigned');}else index.families[familyId]={split:'train',rootFamilyId:root,parentFamilyIds:[source.designFamilyId]};return root;}
/** Local unregistered candidate graph; no source authority or publication. */
export function isolateDesignedCandidateIndex(base:any,source:any,sourceFamilyId:string){const index=structuredClone(base),rootFamilyId=appendFamily(index,source,sourceFamilyId);return{index,rootFamilyId};}
function coverage(snapshot:any){const v=snapshot.commonView.modelPayload,base=commonViewCoverageCell(v),own=v.state.myHand.reduce((n:number,c:any)=>n+c.count,0),target=v.state.currentTarget;return{...base,hasNaturalNonJokerOption:v.candidates.some((c:any)=>!c.action.pass&&c.action.kind===target.kind&&c.action.wildCount===0&&!c.action.cards.some((p:any)=>p.card==='SJ'||p.card==='BJ')),ownHasFewerCardsThanPartner:own<v.state.otherSeats.partner.remainingCards};}
export function designedCandidateRejectionReason(snapshot:any,requestedCoverage:any,used:ReadonlySet<string>,accepted:ReadonlySet<string>){const identity=snapshot.normalizedDecisionIdentity.sha256;return used.has(identity)?'previously_selected_common_decision':accepted.has(identity)?'duplicate_common_decision':!equal(coverage(snapshot),requestedCoverage)?'requested_public_coverage_not_met':null;}
function regular(root:string,f:File,privateFile=false){strictObject(f,'acceptanceFile',['path','sha256']);need(typeof f.path==='string'&&!isAbsolute(f.path)&&f.path.split(/[\\/]/).every(x=>x&&x!=='.'&&x!=='..')&&/^[a-f0-9]{64}$/.test(f.sha256),'file_shape');const path=join(root,f.path),st=lstatSync(path);need(st.isFile()&&!st.isSymbolicLink()&&realpathSync(path)===path&&st.size<=32*1024*1024&&(!privateFile||(st.mode&0o777)===0o600),'file_type_or_permissions');const bytes=readFileSync(path);need(sha(bytes)===f.sha256,'file_hash');return bytes;}
/** Pins only this acceptance transaction; intermediate checks do not reread bytes. */
export function createNaturalRecordPins(){
 const pins=new Map<string,{names?:string[];sha256?:string;stamp:string}>();
 const identity=(path:string,reason='natural_record_changed')=>{const st=lstatSync(path,{bigint:true});need(!st.isSymbolicLink()&&realpathSync(path)===path,reason);return{st,stamp:[st.dev,st.ino,st.size,st.mtimeNs,st.ctimeNs,st.mode,st.nlink].join(':')};};
 const assertNaturalSignals=()=>{for(const [path,pin]of pins){const current=identity(path);need(current.stamp===pin.stamp,'natural_record_changed');need(pin.names?current.st.isDirectory()&&equal(readdirSync(path).sort(),pin.names):current.st.isFile(),'natural_record_changed');}};
 const checkedHash=(path:string,stamp:string)=>{need(identity(path).stamp===stamp,'natural_record_changed');const hash=sha(readFileSync(path));need(identity(path).stamp===stamp,'natural_record_changed');return hash;};
 const pinNatural=(directory:string)=>{if(pins.has(directory)){assertNaturalSignals();return;}const current=identity(directory,'natural_record_path');need(current.st.isDirectory(),'natural_record_path');const names=readdirSync(directory).sort();pins.set(directory,{names,stamp:current.stamp});for(const name of names){const path=join(directory,name),file=identity(path,'natural_record_file');need(file.st.isFile(),'natural_record_file');pins.set(path,{sha256:checkedHash(path,file.stamp),stamp:file.stamp});}assertNaturalSignals();};
 const assertNaturalUnchanged=()=>{assertNaturalSignals();for(const [path,pin]of pins)if(pin.sha256)need(checkedHash(path,pin.stamp)===pin.sha256,'natural_record_changed');assertNaturalSignals();};
 return{pinNatural,assertNaturalSignals,assertNaturalUnchanged};
}
function catalog(host:FixedHostFiles){const manifest=structuredClone(host.manifest),references=new Map<string,any>(),evidenceFiles=new Map<string,File>(manifest.evidenceFiles.map((r:any)=>[r.id,r.file]));for(const row of manifest.references)references.set(row.ref,host.resolveRef(row.ref));const get=(ref:string)=>{fixedReference(ref,'ref');const value=references.get(ref);need(value!==undefined&&digest(value)===ref.split(':').at(-1),'reference_identity');return value;};const indexPath=(ref:string)=>{const index=get(ref);need(index.schema==='ohuo-source-index-ref-v1','index_reference');const matches=[...manifest.inputBindings.map((b:any)=>b.sourceIndexFile),...evidenceFiles.values()].filter(f=>f.sha256===index.fileSHA256);need(matches.length>0,'index_file_missing');for(const f of matches)regular(host.repositoryRoot,f);return join(host.repositoryRoot,matches.map(f=>f.path).sort()[0]);};return{manifest,references,evidenceFiles,get,indexPath};}
// Exact original replay failures caused by the candidate, never catalog,
// source bytes, credentials, permissions, program or runtime identity failures.
const candidateSourceFailures=new Set([
 'designed_source_physical_conservation','designed_source_prefix_origin',
 'designed_source_target_not_active','designed_source_target_mismatch',
 'designed_source_both_teams_active','designed_source_target_candidates',
 'designed_source_v2_declaration_zero','designed_source_v2_declaration_ambiguous',
 'illegal move outside active play','illegal pass','illegal empty declared move',
 'duplicate physical resource identity','physical resource not owned',
 'selected physical-card identity differs from the actual owned card',
 'invalid declared wildcard identity','declared legal action identity mismatch',
 'Declared initial deal requires four hands of 27 canonical IDs',
 'Declared initial deal must contain every canonical physical card exactly once',
 'ancestry must conserve108/27 cards',
 'designed_acceptance_deal_reuses_other_split_or_root',
 'designed_acceptance_legacy_deal_cannot_be_reassigned',
]);
export const isDesignedCandidateSourceFailure=(error:any)=>candidateSourceFailures.has(error?.message);

/** One acceptance transaction: only legal candidates need historical identities.
 * The lightweight original history snapshot still guards every final commit. */
export function createDesignedCandidateAdmission(usedSnapshot:any,loadUsedIdentities:()=>Promise<ReadonlySet<string>>){
 const initialHistory=structuredClone(usedSnapshot);let usedIdentities:Promise<ReadonlySet<string>>|undefined;
 return{
  async inspect({reader,locator,runtime,requestedCoverage,acceptedIdentities}:{reader:ReturnType<typeof createDesignedSourceReader>;locator:{sourceKind:'designed-synthetic';sourceRef:string};runtime:DesignedSourceRuntime;requestedCoverage:any;acceptedIdentities:ReadonlySet<string>}){
   try{reader.readSource(locator);}catch(error){if(!isDesignedCandidateSourceFailure(error))throw error;return{snapshot:null,reason:String((error as Error).message)};}
   let snapshot;try{snapshot=reader.readSnapshot(locator,runtime);}catch(error){if((error as Error)?.message!=='designed_source_target_candidates')throw error;return{snapshot:null,reason:String((error as Error).message)};}
   // History/scoring/authority errors stay outside candidate-error handling.
   const used=await(usedIdentities??=loadUsedIdentities());return{snapshot,reason:designedCandidateRejectionReason(snapshot,requestedCoverage,used,acceptedIdentities)};
  },
  assertHistory(current:any){need(equal(current,initialHistory),'used_history_changed');},
 };
}

/** Same exact existing host, immutable files and append-only catalog. */
export async function acceptDesignedSources({host,specRef}:{host:FixedHostFiles;specRef:string}){
 need(host instanceof FixedHostFiles,'original_host_required');const h=host as any,root=realpathSync(host.repositoryRoot);need(root===host.repositoryRoot&&typeof h.readDesignedSourceAcceptance==='function','original_H_gate_required');
 const spec=host.resolveRef(specRef);shape(spec);need(digest(spec)===specRef.split(':').at(-1),'spec_identity');
 const initial=await h.readDesignedSourceAcceptance(spec),c=catalog(host),indexPath=c.indexPath(spec.sourceIndexRef),hostPath=join(root,'deliverables/ohuo-runtime/host.json'),statePath=join(host.root,'state.json'),directory=join(root,'lab/out',spec.outputId),baseRelative=relative(root,directory);host.directory('lab/out');
 const releaseSource=acquireSourceWriter(indexPath);let releaseState:(()=>void)|undefined,releaseHost:(()=>void)|undefined,stagingDirectory:string|undefined,committed=false;
 try{
  releaseState=acquireSourceWriter(statePath);releaseHost=acquireSourceWriter(hostPath);
  const gate=await h.readDesignedSourceAcceptance(spec),beforeHostBytes=readFileSync(hostPath),beforeHostSHA256=sha(beforeHostBytes);need(equal(JSON.parse(beforeHostBytes.toString()),c.manifest)&&equal(gate.task,initial.task),'gate_or_catalog_changed');
  if(existsSync(directory)){
   const path=join(directory,'manifest.json'),entry=c.evidenceFiles.get(`designed-source/${spec.outputId}/manifest.json`);need(entry&&entry.path===relative(root,path),'partial_output_or_unregistered_commit');const committed=JSON.parse(regular(root,entry).toString());need(committed.schema==='ohuo-designed-source-acceptance-v1'&&committed.specRef===specRef,'existing_commit_identity');
   for(const row of committed.files){regular(root,row.file);need(equal(c.evidenceFiles.get(row.id),row.file),'existing_commit_catalog');}
   for(const row of committed.references)need(equal(c.get(row.ref),JSON.parse(regular(root,row.file).toString())),'existing_commit_reference');
   return{status:'noop',manifestRef:{id:`designed-source/${spec.outputId}/manifest.json`,sha256:entry.sha256},sourceIndexRef:committed.sourceIndexRef,queueRef:committed.queueRef,acceptedCount:committed.acceptedCount,teacherCalls:0,targetMoves:0};
  }
  need(gate.allowCreate===true,'action_not_open');const {task,run,state}=gate;need(task.sourcePlan.sourceIndexRef===spec.sourceIndexRef&&task.planRef===spec.planRef&&run.status==='completed'&&run.cleanupConfirmed===true&&isDesignedSourceCheckpoint(run.checkpoint)&&run.checkpoint.active===null&&!run.checkpoint.executionUnknown,'completed_designer_required');
  const cp=run.checkpoint,contract=c.get(task.scientificContract.decisionRuleRef),inventory=c.get(task.datasetRefs[0]);need(contract.schema==='ohuo-designed-source-contract-v1'&&inventory.schema==='ohuo-designed-source-inventory-v1'&&cp.cursor===inventory.requests.length&&cp.rows.length===inventory.requests.length,'designer_inventory_complete');
  const runtimeCache=new Map<string,DesignedSourceRuntime>(),runtimeFor=async(ref:string)=>{if(runtimeCache.has(ref))return runtimeCache.get(ref)!;const comp=c.get(ref);strictObject(comp,'comparison',['schema','proposalRef','studentParentRef']);need(comp.schema==='ohuo-first-round-comparison-v1','comparison');const release=resolveCandidateReleaseRef(c.get(comp.proposalRef),c.get,RELEASES),loaded=await resolveNodePolicy(release.release.proposalPolicyRef,root);need(equal(JSON.parse(JSON.stringify(loaded.identity)),release.policyIdentity),'actual_B_identity');const parent=await resolveFirstRoundParent({parentRef:comp.studentParentRef,envelope:c.get(comp.studentParentRef),readEvidence:f=>{const file=c.evidenceFiles.get(f.id);need(file?.sha256===f.sha256,'parent_evidence');return regular(root,file!);},repositoryRoot:root}),value={proposal:{...loaded,candidatePolicy:release.candidatePolicy},parent};runtimeCache.set(ref,value);return value;};
  // Original model files must load and match before any acceptance artifact is
  // written. No caller model/callback/identity token can substitute for them.
  need(c.get(spec.comparisonRef).proposalRef===task.parentPolicyRef,'fixed_proposal_binding');
  const runtime=await runtimeFor(spec.comparisonRef);
  const priorIndices=[...c.references].filter(([,v])=>v?.schema==='ohuo-source-index-ref-v1').map(([ref])=>({ref,index:JSON.parse(readFileSync(c.indexPath(ref),'utf8'))})),successor=mergeDesignedSourceIndices(JSON.parse(readFileSync(indexPath,'utf8')),priorIndices.map(x=>x.index));
  const {pinNatural,assertNaturalSignals,assertNaturalUnchanged}=createNaturalRecordPins();
  const used=await readUsedCommonSelectionRows(root),usedReaders=new Map<string,ReturnType<typeof createDesignedSourceReader>>(),naturalCache=new Map();
  const candidateAdmission=createDesignedCandidateAdmission(used,async()=>{const usedIdentities=new Set<string>();
  for(const entry of used.rows){const row:any=entry.row;let snapshot:any;if(entry.sourceKind==='designed-synthetic'){const registration=c.get(row.sourceRef);if(!usedReaders.has(registration.sourceIndexRef))usedReaders.set(registration.sourceIndexRef,createDesignedSourceReader({repositoryRoot:root,sourceIndexPath:c.indexPath(registration.sourceIndexRef),sourceIndexRef:registration.sourceIndexRef,references:c.references,evidenceFiles:c.evidenceFiles}));snapshot=usedReaders.get(registration.sourceIndexRef)!.readSnapshot(row,await runtimeFor(registration.comparisonRef));}else{pinNatural(row.recordRef.directory);snapshot=readOfflineSnapshot(row,naturalCache,row.split==='confirm'?{purpose:'first-round-new-test'}:undefined);assertNaturalSignals();}usedIdentities.add(commonDecisionIdentityForSnapshot(snapshot).sha256);}
   return usedIdentities;
  });
  const candidates:any[]=[],outcomes:any[]=[];
  for(const [i,row]of cp.rows.entries()){
   const request=prepareDesignedSourceRequest(inventory.requests[i]);need(request.engineSourceRef===task.sourceRevision&&request.rulesRef===task.rulesRef,'fixed_request_source');need(row.questionId===request.questionId&&row.requestSHA256===digest(request),'request_checkpoint_identity');
   const queryFile={path:relative(root,join(task.outputRoot,row.privateRef.relativePath)),sha256:row.privateRef.sha256},q=JSON.parse(regular(root,queryFile,true).toString());
   const reused=await queryDesignedSource({input:request,signal:new AbortController().signal,checkpoint:q,request:async()=>{throw Error('source acceptance cannot send');},onCheckpoint:async()=>{throw Error('source acceptance cannot rewrite query');}});need(reused.reused&&q.phase==='terminal'&&q.result.status===row.status&&q.result.summary.requestCount===row.requestCount,'query_terminal_identity');
   if(row.status!=='response'){outcomes.push({questionId:row.questionId,status:'not_generated',reason:row.reason,sourceRef:null});continue;}
   const sourceFile={path:relative(root,join(task.outputRoot,row.candidateSourceFile.relativePath)),sha256:row.candidateSourceFile.sha256},raw=regular(root,sourceFile,true);assertDesignedCandidateResponse(raw,q.result);
   try{const {source,sourceFamilyId}=inspectDesignedCandidateSource(raw.toString());candidates.push({source,sourceFile,sourceFamilyId,request});}
   catch(error){if(isDesignedCandidateSourceFailure(error))outcomes.push({questionId:row.questionId,status:'rejected',reason:String((error as Error).message),sourceRef:null});else throw error;}
  }
  // Each candidate gets an isolated unregistered graph. A prefix/coverage
  // rejection cannot reserve its deal under a root and poison a later source.
  // Only the already accepted successor constrains subsequent candidates.
  stagingDirectory=directory+'.source-preflight-'+digest(spec).slice(0,12);need(!existsSync(stagingDirectory),'prior_preflight_requires_owner_inspection');mkdirSync(stagingDirectory,{mode:0o700});
  const candidateReaders:ReturnType<typeof createDesignedSourceReader>[]=[],admitted:any[]=[],acceptedIdentities=new Set<string>();
  for(const [i,x]of candidates.entries()){
   let graph;
   try{graph=isolateDesignedCandidateIndex(successor,x.source,x.sourceFamilyId);}catch(error){if(!isDesignedCandidateSourceFailure(error))throw error;outcomes.push({questionId:x.source.questionId,status:'rejected',reason:String((error as Error).message),sourceRef:null});continue;}
   x.rootFamilyId=graph.rootFamilyId;
   const stagePath=join(stagingDirectory,`source-index-${i}.json`),stageBytes=canonical(graph.index)+'\n';writeFileSync(stagePath,stageBytes,{flag:'wx',mode:0o600});const stageValue={schema:'ohuo-source-index-ref-v1',namespace:c.get(spec.sourceIndexRef).namespace,fileSHA256:sha(stageBytes)},stageRef=referenceOf(spec.outputId+'-preflight-index-'+i,stageValue);c.references.set(stageRef,stageValue);
   const reader=createDesignedSourceReader({repositoryRoot:root,sourceIndexPath:stagePath,sourceIndexRef:stageRef,references:c.references,evidenceFiles:c.evidenceFiles});candidateReaders.push(reader);
   const sourceEvidence={id:`designed-source/${spec.outputId}/candidate-${i}.json`,file:x.sourceFile};c.evidenceFiles.set(sourceEvidence.id,sourceEvidence.file);
   const registration={schema:'ohuo-designed-source-registration-v1',sourceIndexRef:stageRef,sourceFile:{id:sourceEvidence.id,sha256:x.sourceFile.sha256},questionId:x.source.questionId,designFamilyId:x.source.designFamilyId,sourceFamilyId:x.sourceFamilyId,rootFamilyId:x.rootFamilyId,engineSourceRef:x.source.engineSourceRef,rulesRef:x.source.rulesRef,comparisonRef:spec.comparisonRef},sourceRef=referenceOf('designed-preflight/'+spec.outputId+'/'+x.source.questionId,registration);c.references.set(sourceRef,registration);
   const locator={sourceKind:'designed-synthetic' as const,sourceRef};
   // Candidate-caused replay failures are handled before invoking B/S0. A same-
   // named error from trusted candidate/scoring execution must not be swallowed.
   const inspected=await candidateAdmission.inspect({reader,locator,runtime,requestedCoverage:x.request.coverage,acceptedIdentities});
   if(inspected.reason){outcomes.push({questionId:x.source.questionId,status:'rejected',reason:inspected.reason,sourceRef:null});continue;}
   const snapshot=inspected.snapshot!,identity=snapshot.normalizedDecisionIdentity.sha256;
   need(appendFamily(successor,x.source,x.sourceFamilyId)===x.rootFamilyId,'accepted_root_changed');
   acceptedIdentities.add(identity);admitted.push({x,sourceEvidence,registration,normalizedDecisionIdentity:snapshot.normalizedDecisionIdentity});
  }
  for(const r of candidateReaders)r.assertUnchanged();for(const r of usedReaders.values())r.assertUnchanged();assertNaturalUnchanged();
  mkdirSync(directory,{mode:0o700});need(realpathSync(directory)===directory,'output_path');const files:any[]=[],references:any[]=[];
  const save=(name:string,value:any)=>{const path=join(directory,name),bytes=canonical(value)+'\n';writeFileSync(path,bytes,{flag:'wx',mode:0o600});const entry={id:`designed-source/${spec.outputId}/${name}`,file:{path:relative(root,path),sha256:sha(bytes)}};files.push(entry);c.evidenceFiles.set(entry.id,entry.file);return entry;};
  const saveRef=(name:string,id:string,value:any)=>{const file=save(name,value),ref=referenceOf(id,value);c.references.set(ref,value);references.push({ref,file:file.file});return ref;};
  const indexFile=save('source-index.json',successor),indexValue={schema:'ohuo-source-index-ref-v1',namespace:c.get(spec.sourceIndexRef).namespace,fileSHA256:indexFile.file.sha256},sourceIndexRef=saveRef('source-index-ref.json',spec.outputId+'-source-index',indexValue),queueRows:any[]=[];
  for(const [i,{x,sourceEvidence,registration,normalizedDecisionIdentity}]of admitted.entries()){
   files.push(sourceEvidence);const finalRegistration={...registration,sourceIndexRef},sourceRef=saveRef(`registration-${i}.json`,'designed-source/'+spec.outputId+'/'+x.source.questionId,finalRegistration);queueRows.push({sourceKind:'designed-synthetic',sourceRef});outcomes.push({questionId:x.source.questionId,status:'source_admitted',reason:null,sourceRef,sourceFamilyId:x.sourceFamilyId,rootFamilyId:x.rootFamilyId,normalizedDecisionIdentity});
  }
  const queue={schema:'ohuo-designed-source-queue-v1',namespace:indexValue.namespace,sourceIndexRef,rows:queueRows},queueRef=saveRef('queue.json',spec.outputId+'-designed-queue',queue);save('outcomes.json',outcomes);
  // Recheck original H/state/catalog under the same owner locks immediately
  // before publishing. New data never creates/changes a grant or run.
  const end=await h.readDesignedSourceAcceptance(spec);need(end.allowCreate&&equal(end.task,task)&&equal(end.run,run)&&equal(end.state,state)&&sha(readFileSync(hostPath))===beforeHostSHA256,'owner_inputs_changed');
  for(const p of priorIndices)need(equal(JSON.parse(readFileSync(c.indexPath(p.ref),'utf8')),p.index),'historical_index_changed');
  const usedNow=await readUsedCommonSelectionRows(root);candidateAdmission.assertHistory(usedNow);assertNaturalUnchanged();for(const r of candidateReaders)r.assertUnchanged();for(const r of usedReaders.values())r.assertUnchanged();
  const manifest={schema:'ohuo-designed-source-acceptance-v1',specRef,designerTaskRef:spec.designerTaskRef,designerRunId:run.runId,designerCheckpointSHA256:run.checkpointSHA256,previousSourceIndexRef:spec.sourceIndexRef,priorIndexRefs:priorIndices.map(p=>p.ref).sort(),sourceIndexRef,comparisonRef:spec.comparisonRef,queueRef,acceptedCount:queueRows.length,rejectedCount:outcomes.filter(x=>x.status==='rejected').length,usedSelectionRefs:used.selectionRefs,usedManifestRefs:used.manifestRefs,references:structuredClone(references),files:structuredClone(files),teacherCalls:0,targetMoves:0,qualification:'source-only-not-teacher-label-or-training'};
  const manifestFile=save('manifest.json',manifest),after=structuredClone(c.manifest);
  for(const entry of references){need(!after.references.some((r:any)=>r.ref===entry.ref),'reference_already_registered');after.references.push(entry);}
  for(const entry of files){const existing=after.evidenceFiles.find((r:any)=>r.id===entry.id);need(!existing||equal(existing,entry),'evidence_conflict');if(!existing)after.evidenceFiles.push(entry);}
  const afterBytes=canonical(after)+'\n',packet={schema:'ohuo-designed-source-catalog-append-v1',specRef,manifestFile:manifestFile.file,beforeSHA256:beforeHostSHA256,afterSHA256:sha(afterBytes),references:references,evidenceFiles:files};
  writeFileSync(join(directory,'catalog-append.json'),canonical(packet)+'\n',{flag:'wx',mode:0o600});
  need(sha(readFileSync(hostPath))===beforeHostSHA256,'host_before_hash_changed');const temporary=hostPath+'.designed-'+digest(packet)+'.pending';writeFileSync(temporary,afterBytes,{flag:'wx',mode:0o600});renameSync(temporary,hostPath);
  const committedHost=new FixedHostFiles(root);need(sha(readFileSync(hostPath))===packet.afterSHA256,'host_commit_identity');for(const entry of references)need(equal(committedHost.resolveRef(entry.ref),c.references.get(entry.ref)),'host_registered_bytes');
  committed=true;return{status:'created',manifestRef:{id:manifestFile.id,sha256:manifestFile.file.sha256},sourceIndexRef,queueRef,acceptedCount:queueRows.length,rejectedCount:manifest.rejectedCount,sourceRegistered:true,selectorInputsReady:queueRows.length>0,teacherCalls:0,targetMoves:0};
 }finally{try{if(committed&&stagingDirectory)rmSync(stagingDirectory,{recursive:true});}finally{try{releaseHost?.();}finally{try{releaseState?.();}finally{releaseSource();}}}}
}

/** First design-family registration, before any designer Task exists. The
 * explicit fixed spec is approved through the original H source action. A new
 * root is never inferred from an absent edge. Natural legacy roots are retained
 * byte-for-byte and may only be ancestors of explicitly planned train nodes. */
export async function prepareDesignedSourceFamilies({host,specRef}:{host:FixedHostFiles;specRef:string}){
 need(host instanceof FixedHostFiles,'original_host_required');const h=host as any,root=realpathSync(host.repositoryRoot);need(root===host.repositoryRoot&&typeof h.readDesignedFamilyReservation==='function','original_family_H_gate_required');const spec=validateDesignedFamilyReservationSpec(host.resolveRef(specRef));need(digest(spec)===specRef.split(':').at(-1),'family_spec_identity');
 await h.readDesignedFamilyReservation(spec);const c=catalog(host),oldPath=c.indexPath(spec.sourceIndexRef),hostPath=join(root,'deliverables/ohuo-runtime/host.json'),directory=join(root,'lab/out',spec.outputId);host.directory('lab/out');
 const releaseSource=acquireSourceWriter(oldPath);let releaseState:(()=>void)|undefined,releaseHost:(()=>void)|undefined;
 try{
  releaseState=acquireSourceWriter(join(host.root,'state.json'));releaseHost=acquireSourceWriter(hostPath);const gate=await h.readDesignedFamilyReservation(spec),before=readFileSync(hostPath),beforeSHA256=sha(before);need(equal(JSON.parse(before.toString()),c.manifest),'family_catalog_changed');
  if(existsSync(directory)){
   const id=`designed-family/${spec.outputId}/manifest.json`,file=c.evidenceFiles.get(id);need(file&&file.path===relative(root,join(directory,'manifest.json')),'family_partial_output');const value=JSON.parse(regular(root,file!).toString());need(value.schema==='ohuo-designed-family-reservation-v1'&&value.specRef===specRef,'family_existing_identity');for(const f of value.files){regular(root,f.file);need(equal(c.evidenceFiles.get(f.id),f.file),'family_existing_catalog');}for(const r of value.references)need(equal(c.get(r.ref),JSON.parse(regular(root,r.file).toString())),'family_existing_reference');const reservationRef=referenceOf('designed-family/'+spec.outputId,value);need(equal(c.get(reservationRef),value),'family_existing_producer');return{status:'noop',sourceIndexRef:value.sourceIndexRef,reservationRef,requestInventoryRef:spec.requestInventoryRef,coverageApprovalRef:spec.coverageApprovalRef,providerRequests:0,modelLoads:0};
  }
  need(gate.allowCreate===true,'family_action_not_open');const inventory=c.get(spec.requestInventoryRef),approval=c.get(spec.coverageApprovalRef);need(approval.schema==='ohuo-designed-public-coverage-approval-v1'&&approval.planRef===spec.planRef&&approval.sourceIndexRef===spec.sourceIndexRef&&Array.isArray(approval.coverageCells),'family_public_scope');
  const requests=inventory.requests.map((r:any)=>prepareDesignedSourceRequest(r));need(requests.every((r:any)=>r.rulesRef===approval.rulesRef&&approval.coverageCells.some((cell:any)=>equal(cell,r.coverage))),'family_inventory_coverage');
  const priorIndices=[...c.references].filter(([,v])=>v?.schema==='ohuo-source-index-ref-v1').map(([ref])=>{const path=c.indexPath(ref),file={path:relative(root,path),sha256:sha(readFileSync(path))};return{ref,file,value:JSON.parse(regular(root,file).toString())};}),previous=JSON.parse(readFileSync(oldPath,'utf8')),next=reserveDesignedFamilies(mergeDesignedSourceIndices(previous,priorIndices.map(p=>p.value)),spec,inventory);
  mkdirSync(directory,{mode:0o700});need(realpathSync(directory)===directory,'family_output_path');const files:any[]=[],references:any[]=[];
  const save=(name:string,value:any)=>{const path=join(directory,name),raw=canonical(value)+'\n';writeFileSync(path,raw,{flag:'wx',mode:0o600});const row={id:`designed-family/${spec.outputId}/${name}`,file:{path:relative(root,path),sha256:sha(raw)}};files.push(row);return row;};
  const indexFile=save('source-index.json',next),value={schema:'ohuo-source-index-ref-v1',namespace:c.get(spec.sourceIndexRef).namespace,fileSHA256:indexFile.file.sha256},sourceIndexRef=referenceOf(spec.outputId+'-source-index',value),indexRefFile=save('source-index-ref.json',value);references.push({ref:sourceIndexRef,file:indexRefFile.file});
  const end=await h.readDesignedFamilyReservation(spec);need(end.allowCreate&&equal(end.state,gate.state)&&sha(readFileSync(hostPath))===beforeSHA256,'family_owner_inputs_changed');for(const p of priorIndices)regular(root,p.file);
  const manifest={schema:'ohuo-designed-family-reservation-v1',specRef,planRef:spec.planRef,previousSourceIndexRef:spec.sourceIndexRef,sourceIndexRef,requestInventoryRef:spec.requestInventoryRef,coverageApprovalRef:spec.coverageApprovalRef,budgetRef:spec.budgetRef,comparisonRef:spec.comparisonRef,families:structuredClone(spec.families),priorIndices:priorIndices.map(({ref,file})=>({ref,file})),sourceIndexFile:indexFile.file,references:structuredClone(references),files:structuredClone(files)},manifestFile=save('manifest.json',manifest),reservationRef=referenceOf('designed-family/'+spec.outputId,manifest);references.push({ref:reservationRef,file:manifestFile.file});
  const after=structuredClone(c.manifest);for(const r of references){need(!after.references.some((v:any)=>v.ref===r.ref),'family_reference_conflict');after.references.push(r);}for(const f of files){need(!after.evidenceFiles.some((v:any)=>v.id===f.id),'family_evidence_conflict');after.evidenceFiles.push(f);}
  const afterBytes=canonical(after)+'\n',packet={schema:'ohuo-designed-family-catalog-append-v1',specRef,beforeSHA256,afterSHA256:sha(afterBytes),manifestFile:manifestFile.file,references,evidenceFiles:files};writeFileSync(join(directory,'catalog-append.json'),canonical(packet)+'\n',{flag:'wx',mode:0o600});need(sha(readFileSync(hostPath))===beforeSHA256,'family_host_before_changed');const temporary=hostPath+'.family-'+digest(packet)+'.pending';writeFileSync(temporary,afterBytes,{flag:'wx',mode:0o600});renameSync(temporary,hostPath);const committedHost=new FixedHostFiles(root);need(equal(committedHost.resolveRef(reservationRef),manifest),'family_committed_producer');
  return{status:'created',sourceIndexRef,reservationRef,requestInventoryRef:spec.requestInventoryRef,coverageApprovalRef:spec.coverageApprovalRef,designFamilyIds:spec.families.map((f:any)=>f.designFamilyId),providerRequests:0,modelLoads:0,sourceDealsAdmitted:0};
 }finally{releaseHost?.();releaseState?.();releaseSource();}
}
