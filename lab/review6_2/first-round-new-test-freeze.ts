/** R16's one nonrunner union freeze. The original host admits authority/source
 * identities; actual existing source reproduction supplies the union. No fake
 * Task, successful-row list, learner, match runner or teacher can be supplied. */
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {join,relative,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {FixedHostFiles} from './ohuo-host-files';
import {canonical,digest,fixedReference,strictObject,validateIdentifier,referenceOf} from './task-schema.mjs';
import {acquireSourceWriter} from './writer-lock';
import {validateFirstRoundTargetDefinition} from './first-round-target';
import {reproduceFirstRoundNewTestSources,assertFirstRoundNewTestExposure,firstRoundNewTestSelectionReadiness} from './first-round-evaluation-host';
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const need=(ok:any,why:string)=>{if(!ok)throw Error('first_round_new_test_freeze_'+why);};
const names=['spec.json','selection.json'];
function boundedRegular(path:string){const st=lstatSync(path);need(st.isFile()&&!st.isSymbolicLink()&&realpathSync(path)===path&&st.size<=32*1024*1024,'regular_file');return readFileSync(path);}
function originalRef(host:FixedHostFiles,ref:string){fixedReference(ref,'newTestFreezeRef');const value=host.resolveRef(ref);need(digest(value)===ref.split(':').at(-1),'reference_identity');return value;}
function shape(host:FixedHostFiles,spec:any){
 strictObject(spec,'newTestSelectionSpec',['schema','planRef','clauseRef','branchRef','sourceIndexRef','queueRef','sourceRunRefs','targetDefinitionRef','selectionRuleRef','quotaBasisRef','purpose','actingReleaseRef','outputId','sourceSpecRef']);
 need(spec.schema==='ohuo-first-round-new-test-selection-spec-v1'&&spec.purpose==='distribution_diagnostic','named_spec');validateIdentifier(spec.outputId,'outputId');
 for(const k of ['planRef','clauseRef','sourceIndexRef','queueRef','targetDefinitionRef','selectionRuleRef','actingReleaseRef','sourceSpecRef'])fixedReference(spec[k],k);if(spec.branchRef!==null)fixedReference(spec.branchRef,'branchRef');
 validateFirstRoundTargetDefinition(originalRef(host,spec.targetDefinitionRef));const source=originalRef(host,spec.sourceSpecRef),quota=JSON.parse(Buffer.from(host.evidenceBytes(spec.quotaBasisRef)).toString());
 const commonView=source.schema==='ohuo-common-view-new-test-source-r2';
 if(commonView){const protocol=originalRef(host,source.protocolRef),rule=originalRef(host,spec.selectionRuleRef);need(protocol.schema==='ohuo-first-round-protocol-revision-v2'&&protocol.protocolId==='first-round-common-view-r2'&&rule.protocolRef===source.protocolRef&&quota.protocolRef===source.protocolRef,'common_view_source_protocol');}
 need((commonView||source.schema==='ohuo-first-round-new-test-source-v1')&&source.planRef===spec.planRef&&source.queueRef===spec.queueRef&&source.sourceIndexRef===spec.sourceIndexRef&&source.selectionPlanRef===spec.selectionRuleRef&&source.s1Ref===spec.actingReleaseRef&&equal(source.sourceRunRefs,spec.sourceRunRefs)&&quota.schema===(commonView?'ohuo-selection-source-batch-basis-r2':'ohuo-selection-quota-basis-v1')&&quota.planRef===spec.planRef&&quota.budgetRef===source.budgetRef,'original_source_spec');
 return source;
}
function readCommit(host:FixedHostFiles,spec:any,specRef:string,directory:string){
 const manifestPath=join(directory,'manifest.json');if(!existsSync(directory))return null;
 need(lstatSync(directory).isDirectory()&&realpathSync(directory)===directory,'output_directory');
 need(existsSync(manifestPath),'partial_output_no_overwrite');need(equal(readdirSync(directory).sort(),[...names,'manifest.json'].sort()),'unexpected_output_files');
 const bytes=boundedRegular(manifestPath),commit=JSON.parse(bytes.toString());strictObject(commit,'newTestSelectionCommit',['schema','specRef','selectionRef','sourceSpecRef','files']);
 need(commit.schema==='ohuo-first-round-new-test-selection-commit-v1'&&commit.specRef===specRef&&commit.sourceSpecRef===spec.sourceSpecRef&&Array.isArray(commit.files)&&commit.files.length===2,'commit_identity');
 const contents=commit.files.map((file:any,i:number)=>{strictObject(file,'newTestSelectionFile',['path','sha256']);need(file.path===relative(host.repositoryRoot,join(directory,names[i])),'commit_file_identity');return host.readFile(file);});
 const saved=JSON.parse(contents[0].toString()),selection=JSON.parse(contents[1].toString());
 need(equal(saved,spec)&&digest(saved)===specRef.split(':').at(-1)&&commit.selectionRef===referenceOf('first-round-new-test/'+spec.outputId,selection),'commit_canonical_identity');
 firstRoundNewTestSelectionReadiness(selection);const source=originalRef(host,spec.sourceSpecRef);need(equal(selection.plan,originalRef(host,source.selectionPlanRef)),'commit_selection_plan');
 return {commit,selection,manifestFile:{path:relative(host.repositoryRoot,manifestPath),sha256:sha(bytes)}};
}
/** outputDir is constrained to original repository/lab/out/spec.outputId; it is
 * not an arbitrary artifact path. Existing partial directories are retained and
 * fail closed. Exact committed bytes alone can be reread after closeout; that
 * readonly noop does not rerun or newly certify the old source population. */
export async function freezeFirstRoundNewTestSelection({host,specRef,outputDir}: {host:FixedHostFiles;specRef:string;outputDir?:string}){
 need(host instanceof FixedHostFiles,'fixed_host_required');const h=host as any,root=realpathSync(host.repositoryRoot);need(root===host.repositoryRoot,'repository_root');
 const spec=originalRef(host,specRef),source=shape(host,spec);h.currentProducerSource();
 const directory=join(root,'lab/out',spec.outputId);need(outputDir===undefined||resolve(outputDir)===directory,'output_binding');host.directory('lab/out');
 const controlRelative=relative(root,host.root);need(controlRelative!==''&&!controlRelative.startsWith('..')&&!isAbsolute(controlRelative),'control_root');const controlRoot=host.directory(controlRelative);
 need(typeof h.firstRoundNewTestSourceInputs==='function','source_inputs_adapter');const inputs=h.firstRoundNewTestSourceInputs(source),index=originalRef(host,spec.sourceIndexRef);
 need(inputs?.sourceIdentity===spec.sourceIndexRef&&typeof inputs.sourceIndexPath==='string'&&inputs.sourceIndexPath===realpathSync(inputs.sourceIndexPath)&&inputs.sourceIndexFile?.path===relative(root,inputs.sourceIndexPath)&&inputs.sourceIndexFile.sha256===index.fileSHA256,'source_inputs_binding');host.readFile(inputs.sourceIndexFile);
 const releaseSource=acquireSourceWriter(inputs.sourceIndexPath);let releaseState:(()=>void)|undefined,releaseOutput:(()=>void)|undefined;
 try{
  releaseState=acquireSourceWriter(join(controlRoot,'state.json'));const facts=h.readNonrunnerAction(spec,'first-round-new-test-selection'),state=host.checkExistingRoot();
  const observed=facts.closeout.entity.actions.filter((a:any)=>a.clauseRef===spec.clauseRef&&a.branchRef===spec.branchRef),closed=facts.closeout.entity.status!=='incomplete'||['completed','terminated'].includes(facts.priorObservation?.status);need(observed.length===1,'original_action');
  h.assertDiagnosticWriteIntersection(state,directory);
  if(existsSync(directory))releaseOutput=acquireSourceWriter(directory);
  const prior=readCommit(host,spec,specRef,directory);
  if(prior){assertFirstRoundNewTestExposure({state,planRef:spec.planRef,sourceSpec:source,sourceSpecRef:spec.sourceSpecRef,selectionRef:prior.commit.selectionRef,resolveRef:(ref:string)=>originalRef(host,ref)});return {...prior,status:closed?'closed_noop':'noop',sourceReproduced:false,specRef,selectionRef:prior.commit.selectionRef,sourceSpecRef:spec.sourceSpecRef,manifestRef:{id:prior.manifestFile.path,sha256:prior.manifestFile.sha256}};}
  need(!closed,'plan_closed');need(observed[0].status==='not_executed'&&Array.isArray(observed[0].unresolved)&&observed[0].unresolved.length===0,'original_action_unavailable');
  const queue=originalRef(host,spec.queueRef),binding={planRef:spec.planRef,budgetRef:source.budgetRef,comparisonRef:source.comparisonRef,sourceIndexRef:spec.sourceIndexRef,namespace:queue.namespace};
  const proof=await reproduceFirstRoundNewTestSources({host:h.firstRoundEvaluationFacade(null,facts),binding,refs:new Map(),inputs,sourceSpecRef:spec.sourceSpecRef}),selection=proof.selection;firstRoundNewTestSelectionReadiness(selection);
  const selectionRef=referenceOf('first-round-new-test/'+spec.outputId,selection);assertFirstRoundNewTestExposure({state:host.checkExistingRoot(),planRef:spec.planRef,sourceSpec:source,sourceSpecRef:spec.sourceSpecRef,selectionRef,resolveRef:(ref:string)=>originalRef(host,ref)});
  // Source/state ownership spans reproduction through the manifest-last write.
  // mkdir is exclusive; a concurrently appearing partial output is not reused.
  mkdirSync(directory,{mode:0o700});need(realpathSync(directory)===directory,'output_directory');releaseOutput=acquireSourceWriter(directory);
  const values=[spec,selection],files=names.map((name,i)=>{const path=join(directory,name),bytes=canonical(values[i])+'\n';writeFileSync(path,bytes,{flag:'wx',mode:0o600});return{path:relative(root,path),sha256:sha(bytes)};});
  const commit={schema:'ohuo-first-round-new-test-selection-commit-v1',specRef,selectionRef,sourceSpecRef:spec.sourceSpecRef,files},manifestPath=join(directory,'manifest.json'),manifestBytes=canonical(commit)+'\n';writeFileSync(manifestPath,manifestBytes,{flag:'wx',mode:0o600});
  const saved=readCommit(host,spec,specRef,directory)!;need(equal(saved.commit,commit),'committed_bytes');return {...saved,status:'created',sourceReproduced:true,specRef,selectionRef,sourceSpecRef:spec.sourceSpecRef,manifestRef:{id:saved.manifestFile.path,sha256:saved.manifestFile.sha256}};
 }finally{releaseOutput?.();releaseState?.();releaseSource();}
}
