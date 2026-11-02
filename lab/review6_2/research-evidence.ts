import {isFirstRoundRecipe,firstRoundTrainingShape} from './first-round-contract.mjs';
import {validateFirstRoundParentEnvelope,validateFirstRoundDatasetMetadata} from './first-round-parent';
import {resolveCandidateReleaseRef} from '../../packages/ai/src/policy/candidate-release';
import {RELEASES} from '../../packages/ai/src/policy/seats';
import {selectFirstRoundCheckpoint} from './first-round-selection.mjs';
/** Compact local M8 export, not a Library uploader or scientific decision.
 * Export is whitelist-only; source journals/private data are never copied. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import {canonical,digest,referenceOf,fixedReference,strictObject,validateIdentifier,validateTask,COUNTERS,LIMITS,validateLimits,validateCost} from './task-schema.mjs';
import {checkedOutput} from '../../scripts/project-paths.mjs';
import {ROOT,sha256,fixedRef,readFixedJSON,readB07Run,readB07PublicRecord,summarizePaired,runFrozenInterval,type PairedPlan,type FixedRef} from './paired-summary';
import {inspectNumericalRecoveryEvidence} from './numerical-recovery';
const CONTEXT_EVIDENCE=['planContext','priorDecision','acceptedProgram','allTaskRuns','selectionHistory','sourceIndex'];
export const QUESTION_EVIDENCE={
 plan_closeout:[...CONTEXT_EVIDENCE,'stageAccounting','budgetStop'],
 teacher_increment:['conditions','sourceIndex','pairing','screening','failures','waiting','costs','capabilityCases','studentVisibility','initialCandidateCoverage','selectionHistory','branchRules'],
 student_match:['conditions','sourceIndex','pairing','teacherConclusion','dataset','training','selectionHistory','confirmationIsolation','newDistribution','waiting','failures','behaviorRegression','branchRules'],
} as const;
const kinds=['DERIVABLE','RETRIEVABLE','NOT_TRANSFERRED','NOT_YET_EXECUTED','INVALID_OR_CONTAMINATED','LOST_IRRECOVERABLE','UNLOCATED'] as const;
type MissingKind=typeof kinds[number];
export interface EvidenceRequirement {id:string;source:FixedRef|null;mandatory:boolean;status:'received'|MissingKind;checkedLocations:string[];owner:'Sol'|'DOT'|'M8';authorizationRef:string;dependencies:string[];prerequisitesMet:boolean|null}
export interface EvidenceFile {id:string;sha256:string;version:string|number;artifact:string;purpose:string;publicShareable:true;libraryFileId:string|null;localPath:string}
export interface EvidenceFacts {
 packageId:string;question:'teacher_increment'|'student_match'|'plan_closeout';background:{goal:string;stage:string;changes:string[];completed:string[];remaining:string[];forbidden:string[]};
 requiredEvidence:EvidenceRequirement[];files:EvidenceFile[];
}
function strict(x:any,keys:string[]){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))throw Error('unknown or forbidden evidence field');}
function safeText(x:any){if(typeof x!=='string'||x.length>4000||/Bearer\s|\bsk-[a-zA-Z0-9]{10}|-----BEGIN.*PRIVATE KEY|<\/?(?:system|developer)>/i.test(x))throw Error('forbidden or invalid public text');}
function safeStrings(xs:any){if(!Array.isArray(xs))throw Error('public text list required');xs.forEach(safeText);}
function requirementValid(x:EvidenceRequirement){
 strict(x,['id','source','mandatory','status','checkedLocations','owner','authorizationRef','dependencies','prerequisitesMet']);safeText(x.id);if(x.source!==null)fixedRef(x.source);
 if(typeof x.mandatory!=='boolean'||!['received',...kinds].includes(x.status)||!['Sol','DOT','M8'].includes(x.owner)||![true,false,null].includes(x.prerequisitesMet))throw Error('evidence recovery classification required');
 safeStrings(x.checkedLocations);safeStrings(x.dependencies);safeText(x.authorizationRef);
}
const recovery:Record<MissingKind,{action:string;recheck:string}>={
 DERIVABLE:{action:'Rebuild from the same existing SHA-bound raw inputs with frozen metric, grouping and seed; no new observations.',recheck:'Recheck raw SHA, row counts, complete blocks and unchanged analysis identity.'},
 RETRIEVABLE:{action:'Retrieve the same registered ID/version/SHA or registered backup; never substitute latest.',recheck:'Verify fixed ID, version, SHA and readability.'},
 NOT_TRANSFERRED:{action:'Sol locate the fixed original; DOT transfer only the required public projection within existing authorization.',recheck:'Verify original identity, share scope and readable fixed artifact; new private-data authority remains pending.'},
 NOT_YET_EXECUTED:{action:'Check prerequisites, accepted conclusions, original task/run progress, source and remaining shared budget before an already-authorized start/resume. Never execute from this exporter.',recheck:'Reconcile same task chain, committed counts, checkpoints and original stop boundary.'},
 INVALID_OR_CONTAMINATED:{action:'Quarantine inference depending on affected evidence, retaining original failures and impact; no replacement seeds or renamed samples.',recheck:'Verify identity/split/validity repair; unresolved science requires Astra, expanded design requires approval.'},
 LOST_IRRECOVERABLE:{action:'Record exact loss after checking registered original and backups; retain incomplete result. Do not fabricate or present a rerun as the original.',recheck:'Preserve loss impact and limit conclusions; rerun only if original plan explicitly permits it.'},
 UNLOCATED:{action:'Locate and classify the fixed evidence in registered inputs/backups before choosing any recovery; absence alone does not prove unexecuted or lost.',recheck:'Record checked locations and evidence establishing one of the six plan-defined missing kinds.'},
};
interface PackagePlan {question:EvidenceFacts['question'];refs:Record<string,FixedRef|null>;parentPackageRefs?:FixedRef[]}
export function buildEvidencePackage(plan:PackagePlan,summary:any,facts:EvidenceFacts){
 strict(facts,['packageId','question','background','requiredEvidence','files']);safeText(facts.packageId);if(facts.question!==plan.question)throw Error('question differs from frozen plan');
 strict(facts.background,['goal','stage','changes','completed','remaining','forbidden']);nonempty(facts.background.goal);nonempty(facts.background.stage);for(const key of ['changes','completed','remaining','forbidden'])safeStrings(facts.background[key]);
 if(!Array.isArray(facts.requiredEvidence)||!Array.isArray(facts.files))throw Error('evidence inventory required');facts.requiredEvidence.forEach(requirementValid);
 if(new Set(facts.requiredEvidence.map(x=>x.id)).size!==facts.requiredEvidence.length||new Set(facts.files.map(x=>x.id)).size!==facts.files.length)throw Error('duplicate evidence identity');
 const bindings=validateHandoffBindings(plan,summary,facts);
 const required=[...new Set([...CONTEXT_EVIDENCE,...QUESTION_EVIDENCE[plan.question],...facts.requiredEvidence.filter(x=>x.mandatory).map(x=>x.id),...bindings.issues.map(x=>x.evidenceId)])];
 const received:any[]=[],missingItems:any[]=[];
 for(const id of required){
  const item=facts.requiredEvidence.find(x=>x.id===id),file=bindings.files.find(f=>f.id===item?.source?.id),issue=bindings.issues.find(x=>x.evidenceId===id);
  if(!issue&&item?.status==='received'&&item.source&&file?.sha256===item.source.sha256){received.push({evidenceId:id,source:item.source,artifact:file.artifact});continue;}
  const kind:MissingKind=issue?.missingKind??(item?.status==='received'?'INVALID_OR_CONTAMINATED':item?.status??'UNLOCATED');
  missingItems.push({evidenceId:id,issues:bindings.issues.filter(x=>x.evidenceId===id).map(x=>x.reason),fixedSource:item?.source??plan.refs[id]??null,neededForQuestion:plan.question,missingKind:kind,checkedLocations:item?.checkedLocations??[],owner:item?.owner??'DOT',recoveryAction:recovery[kind].action,authorizationRef:item?.authorizationRef??plan.refs.authorization?.id??'original-plan-authorization-unlocated',dependencies:item?.dependencies??[],prerequisitesMet:item?.prerequisitesMet??null,recoveryStatus:kind==='NOT_YET_EXECUTED'&&(item?.prerequisitesMet!==true||id==='acceptedProgram')?'NOT_DUE':'blocked_pending_evidence',recheck:recovery[kind].recheck});
 }
 return {schema:'ohuo-research-evidence-v1',packageId:facts.packageId,parentPackageRefs:plan.parentPackageRefs??(plan.refs.parentPackage?[plan.refs.parentPackage]:[]),planRef:plan.refs.plan,producerRole:'M8-read-only',purpose:plan.question,neededForQuestion:plan.question,
  background:{...facts.background,policyDefinitions:{B:'C1400 frozen complete policy',H:'B plus API',S:'B proposal plus student rerank'}},frozenConditionsRef:plan.refs.conditions,selectionHistoryRef:plan.refs.selectionHistory,
  readOrder:['background.json',...(plan.refs.plan?[plan.refs.plan.id]:[]),...['planContext','priorDecision','acceptedProgram','sourceIndex','conditions','selectionHistory','allTaskRuns'].map(id=>facts.requiredEvidence.find(x=>x.id===id)?.source?.id).filter((id):id is string=>!!id&&bindings.files.some(f=>f.id===id)),'summary.json','evidence-index.json','missing-items.json'],required,received,missingItems,files:bindings.files.map(({localPath,...f})=>f),completeness:missingItems.length?'incomplete':'complete',
  transportStatus:'LOCAL_ONLY',researchQualified:null,scientificStatus:'not_decided_by_exporter',engineeringStatus:summary.engineeringStatus,absorptionStatus:summary.absorptionStatus,
  unresolved:{incompleteBlocks:(summary.blocks??[]).filter((b:any)=>!b.complete).map((b:any)=>({sourceFamilyId:b.sourceFamilyId,issues:b.issues})),deviations:summary.deviations??[],unknownCosts:summary.cost?{requests:summary.cost.upstreamRequests.unknown,waiting:summary.cost.decisionWaitMs.unknown,wall:summary.cost.matchWallMs.unknown}:null,execution:summary.execution??null,numericalRecovery:bindings.numericalRecovery},
  boundaries:['No automatic qualification, training, extra matches, checkpoint selection, deployment, uploads or READY transition.','Public aggregate facts only; no private hands, credentials, prompt contents or internal instructions.','Missing evidence does not authorize later stages or repeated unknown API calls.']};
}
export function writeEvidencePackage(output:string,plan:PackagePlan,summary:any,facts:EvidenceFacts,runFacts:any[]=[],closeout:any=null){
 output=checkedOutput(output);if(existsSync(join(output,'manifest.json')))throw Error('new package output required');
 const pack=buildEvidencePackage(plan,summary,facts);
 // Explicit safe ledger projection; unknown/reserved are never added to confirmed.
 const ledger=runFacts.map(r=>({runId:r.runId,taskId:r.taskId,taskSHA256:r.taskSHA256,queueRef:r.queueRef,executionUnknown:r.executionUnknown,source:r.source,consumption:Object.fromEntries(['confirmed','reserved','reservedUnknown','released'].map(bucket=>[bucket,Object.fromEntries(['providerRequests','optimizerSteps','matchAttempts','labelDecisions'].map(k=>[k,typeof r.consumption?.[bucket]?.[k]==='number'&&Number.isFinite(r.consumption[bucket][k])?r.consumption[bucket][k]:null]))]))}));
 mkdirSync(output,{recursive:true});
 const generated:Record<string,any>={
  'background.json':{schema:pack.schema,packageId:pack.packageId,parentPackageRefs:pack.parentPackageRefs,planRef:pack.planRef,background:pack.background,purpose:pack.purpose,frozenConditionsRef:pack.frozenConditionsRef,selectionHistoryRef:pack.selectionHistoryRef,boundaries:pack.boundaries},
  'summary.json':{...summary,runFacts:ledger},'evidence-index.json':{required:pack.required,received:pack.received,files:pack.files,unresolved:pack.unresolved},'missing-items.json':pack.missingItems,
 };
 if(closeout!==null)generated['plan-closeout.json']=closeout;
 for(const name of Object.keys(generated))if(existsSync(join(output,name)))throw Error('refuse overwrite existing artifact');
 const files=Object.entries(generated).map(([name,value])=>{const bytes=JSON.stringify(value,null,2)+'\n';writeFileSync(join(output,name),bytes,{flag:'wx'});return {id:name,generated:true,artifact:name,sha256:sha256(bytes),bytes:Buffer.byteLength(bytes),purpose:name.replace('.json',''),mandatory:true,libraryFileId:null,version:1};});
 for(const name of ['paired-stats-input.json','paired-stats.json'])if(existsSync(join(output,name))){const bytes=readFileSync(join(output,name));files.push({id:name,generated:true,artifact:name,sha256:sha256(bytes),bytes:bytes.length,purpose:'frozen paired block interval',mandatory:true,libraryFileId:null,version:1});}
 const outputFiles:any[]=[...files,...pack.files.map(f=>({...f,generated:false}))];
 if(new Set(outputFiles.map(f=>f.id)).size!==outputFiles.length)throw Error('generated/source evidence identity collision');
 const trailing=['summary.json','evidence-index.json','missing-items.json'];
 const readOrder=[...new Set([...pack.readOrder.filter(id=>!trailing.includes(id)),...pack.files.map(f=>f.id),...trailing,...(closeout?['plan-closeout.json']:[])])].filter(id=>outputFiles.some(f=>f.id===id));
 const manifest={schema:pack.schema,packageId:pack.packageId,parentPackageRefs:pack.parentPackageRefs,planRef:pack.planRef,producerRole:pack.producerRole,purpose:pack.purpose,neededForQuestion:pack.neededForQuestion,readOrder,mandatory:pack.required,files:outputFiles,sourceFiles:pack.files,completeness:pack.completeness,transportStatus:pack.transportStatus,researchQualified:null,code:Object.fromEntries(['lab/review6_2/paired-summary.ts','lab/review6_2/research-evidence.ts','lab/review6_2/numerical-recovery.ts','lab/review6/paired_stats.py','packages/ai/src/nn/wave.ts'].map(p=>[p,sha256(readFileSync(join(ROOT,p)))])),sourceInputs:summary.sourceInputs??null,runtime:{node:process.version},unverified:['Mac actual event-directory read-only reconstruction','Scientific qualification and conclusions','DOT Library transfer/readback/READY']};
 writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
}
/** Invocation spec supplies only fixed local inputs; no executable code/plugins.
 * Run summaries list ALL attempts. The exporter never enumerates latest. */
export function rebuildEvidence(spec:any,output:string,pythonPath:string){
 strict(spec,['plan','queue','sourceIndex','runInventory','runs','facts']);for(const key of ['plan','queue','sourceIndex']){strict(spec[key],['path','sha256']);}
 const plan=readFixedJSON(spec.plan.path,spec.plan.sha256) as PairedPlan;
 if(spec.queue.sha256!==plan.refs.queue.sha256||spec.sourceIndex.sha256!==plan.refs.sourceIndex.sha256)throw Error('plan source/queue SHA binding differs');
 const queue=readFixedJSON(spec.queue.path,spec.queue.sha256),index=readFixedJSON(spec.sourceIndex.path,spec.sourceIndex.sha256);
 if(!Array.isArray(spec.runs))throw Error('explicit all-attempts run list required');
 strict(spec.runInventory,['path','sha256']);const inventory=readFixedJSON(spec.runInventory.path,spec.runInventory.sha256);
 if(inventory.schema!=='ohuo-run-inventory-v1'||!Array.isArray(inventory.runs)||new Set(inventory.runs.map((r:any)=>r.runId)).size!==inventory.runs.length||JSON.stringify(inventory.runs.map((r:any)=>r.sha256).sort())!==JSON.stringify(spec.runs.map((r:any)=>r.sha256).sort()))throw Error('all-attempts inventory differs from supplied run snapshots');
 const runs:any[]=[],unavailableRuns:any[]=[];
 for(const r of spec.runs){strict(r,['path','sha256']);try{const observed=readB07Run(r.path,r.sha256);if(!inventory.runs.some((i:any)=>i.runId===observed.run.runId&&i.sha256===observed.run.source.sha256))throw Error('run inventory identity mismatch');runs.push(observed);}catch(error){const expected=inventory.runs.find((i:any)=>i.sha256===r.sha256);unavailableRuns.push({runId:expected.runId,sha256:r.sha256,missingKind:existsSync(r.path)?'INVALID_OR_CONTAMINATED':'UNLOCATED',checkedLocation:basename(r.path)});}}
 const attempts=runs.flatMap(r=>r.attempts);if(unavailableRuns.length)for(const a of attempts)a.issues.push('all_attempts_inventory_incomplete');
 const summary:any=summarizePaired(plan,queue,index,attempts);
 summary.unavailableRuns=unavailableRuns;
 const facts:EvidenceFacts=structuredClone(spec.facts);
 for(const r of unavailableRuns)facts.requiredEvidence.push({id:'run:'+r.runId,source:{id:r.runId+'/summary',sha256:r.sha256},mandatory:true,status:r.missingKind,checkedLocations:[r.checkedLocation],owner:'Sol',authorizationRef:plan.refs.authorization?.id??'original-plan-authorization-unlocated',dependencies:['fixed run summary and existing public record bytes'],prerequisitesMet:null});
 if(unavailableRuns.length){summary.actual.notStartedMatches=null;summary.actual.unobservedPlannedMatches=queue.rows.filter((q:any)=>!attempts.some(a=>a.matchId===q.matchId)).length;for(const b of summary.blocks)for(const m of b.matches)if(m.state==='not_started')m.state='execution_unknown_missing_run';summary.deviations.push('all_attempts_inventory_incomplete');}
 // A missing run can contain waiting, requests and usage not seen anywhere
 // else. Preserve observed subtotals, but never publish them as whole-run totals.
 summary.cost.missingRunCount=unavailableRuns.length;
 summary.cost.countScope=unavailableRuns.length?'observed-records-only':'all-supplied-run-records';
 if(unavailableRuns.length){
  const measures=[summary.cost.decisionWaitMs,summary.cost.matchWallMs,summary.cost.activeMatchLoopMs,summary.cost.upstreamRequests,summary.cost.mainRequests,summary.cost.expansionRequests,...Object.values(summary.cost.usage)];
  for(const measure of measures as any[]){measure.unknown+=unavailableRuns.length;measure.total=null;measure.missingRunCount=unavailableRuns.length;measure.knownScope='observed-records-only';}
 }
 summary.sourceInputs={analysisPlan:{sha256:spec.plan.sha256},queue:plan.refs.queue,sourceIndex:plan.refs.sourceIndex,runInventory:{sha256:spec.runInventory.sha256},runs:inventory.runs.map((r:any)=>({runId:r.runId,sha256:r.sha256}))};
 summary.runFacts=runs.map(r=>r.run);
 const ledgerSum=(buckets:string[])=>{const values=runs.flatMap(r=>buckets.map(k=>r.run.consumption?.[k]?.providerRequests));return values.every(v=>Number.isSafeInteger(v)&&v>=0)?values.reduce((n,v)=>n+v,0):null;};
 const ledgerConfirmed=unavailableRuns.length?null:ledgerSum(['confirmed']),ledgerUnknown=unavailableRuns.length?null:ledgerSum(['reservedUnknown','reserved']);
 summary.cost.requestReconciliation={journalKnown:summary.cost.upstreamRequests.known,ledgerConfirmed,ledgerReservedOrUnknown:ledgerUnknown,status:ledgerConfirmed===null||ledgerUnknown===null||ledgerUnknown>0||summary.cost.upstreamRequests.unknown?'unknown':ledgerConfirmed===summary.cost.upstreamRequests.known?'reconciled':'mismatch'};
 if(unavailableRuns.length||summary.cost.requestReconciliation.status!=='reconciled'||runs.some(r=>r.run.executionUnknown)){summary.cost.upstreamRequests.total=null;summary.deviations.push('unsettled_or_unknown_run_execution');}
 if(summary.cost.requestReconciliation.status==='mismatch')summary.deviations.push('ledger_journal_request_mismatch');
 const inputBindings=validateHandoffBindings(plan,summary,facts),inputConflicts=inputBindings.issues.filter(x=>x.evidenceId==='allTaskRuns');
 if(inputBindings.firstRoundPlanExecution){summary.execution=inputBindings.firstRoundPlanExecution;summary.cost.countScope=unavailableRuns.length?'observed-confirmation-queue-records-only':'all-confirmation-queue-records';}
 if(inputConflicts.length){summary.actual.notStartedMatches=null;summary.deviations.push('handoff_actual_run_binding_conflict');for(const metric of [summary.cost.decisionWaitMs,summary.cost.matchWallMs,summary.cost.activeMatchLoopMs,summary.cost.upstreamRequests,summary.cost.mainRequests,summary.cost.expansionRequests,...Object.values(summary.cost.usage)] as any[]){metric.unknown+=1;metric.total=null;}summary.cost.countScope='observed-records-only';summary.cost.requestReconciliation={...summary.cost.requestReconciliation,ledgerConfirmed:null,ledgerReservedOrUnknown:null,status:'unknown'};}
 if(summary.primary.independentBlocks>=2){summary.primary.interval=runFrozenInterval(summary.primary.input,output,pythonPath);summary.primary.intervalStatus='computed_frozen_kernel';}
 const manifest=writeEvidencePackage(output,plan,summary,facts,runs.map(r=>r.run));return {summary,manifest};
}

// References resolve ONLY through the supplied fixed catalog. No directory scan,
// latest lookup, private label read, implicit acceptance or state mutation.
function nonempty(v:any){safeText(v);if(!v.trim())throw Error('nonempty public fact required');}
const list=(v:any):any[]=>{if(!Array.isArray(v)||v.length>10000)throw Error('bounded explicit list required');return v;};
const unique=(v:any[])=>new Set(v.map(x=>canonical(x))).size===v.length;
const sameSet=(a:any[],b:any[])=>unique(a)&&unique(b)&&equal(a.map(x=>canonical(x)).sort(),b.map(x=>canonical(x)).sort());
const privatePath=(p:string)=>/(^|[\\/])(?:labels|\.env|private)(?:[\\/.]|$)|\.private\.json$|(?:^|[\\/])samples\.jsonl$/i.test(p);
interface BindingIssue {evidenceId:string;missingKind:MissingKind;reason:string}
class EvidenceCatalog {
 files:EvidenceFile[]=[];issues:BindingIssue[]=[];private json=new Map<string,any>();
 constructor(facts:EvidenceFacts){
  for(const f of facts.files){
   strict(f,['id','sha256','version','artifact','purpose','publicShareable','libraryFileId','localPath']);fixedRef({id:f.id,sha256:f.sha256});
   if(f.publicShareable!==true||typeof f.version!=='string'&&typeof f.version!=='number'||f.libraryFileId!==null&&typeof f.libraryFileId!=='string')throw Error('fixed shareable artifact metadata required');
   nonempty(f.artifact);nonempty(f.purpose);nonempty(f.localPath);
   if(f.artifact.startsWith('/')||f.artifact.includes('..')||f.artifact.includes('\\'))throw Error('accessible artifact identity required, not private absolute path');
   if(privatePath(f.artifact)||privatePath(f.localPath)){this.issues.push({evidenceId:'private:'+f.id,missingKind:'INVALID_OR_CONTAMINATED',reason:'private_label_or_original_not_public'});continue;}
   try{const bytes=readFileSync(f.localPath);if(sha256(bytes)!==f.sha256)throw Error('received evidence file SHA mismatch');this.files.push(f);}catch(error:any){this.issues.push({evidenceId:f.id,missingKind:existsSync(f.localPath)?'INVALID_OR_CONTAMINATED':'NOT_TRANSFERRED',reason:existsSync(f.localPath)?'file_bytes_sha_conflict':'fixed_file_not_locally_readable'});}
  }
 }
 file(ref:any):EvidenceFile {
  if(typeof ref==='string'){
   fixedReference(ref,'evidence canonical ref');const id=ref.slice(0,ref.lastIndexOf('@sha256:')),f=this.files.find(f=>f.id===id||f.id===ref);
   if(!f||digest(this.read(f))!==ref.slice(ref.lastIndexOf(':')+1))throw Error('canonical_reference_unavailable_or_conflicting');return f;
  }
  if(ref&&typeof ref.path==='string'){
   if(privatePath(ref.path))throw Error('private_reference_not_public');
   const matches=this.files.filter(f=>(f.artifact===ref.path||f.localPath===ref.path)&&(!ref.sha256||f.sha256===ref.sha256));if(matches.length!==1)throw Error('path_reference_unavailable_or_conflicting');return matches[0];
  }
  fixedRef(ref);const f=this.files.find(f=>f.id===ref.id&&f.sha256===ref.sha256);if(!f)throw Error('bytes_reference_unavailable_or_conflicting');return f;
 }
 read(f:EvidenceFile){if(!this.json.has(f.id))this.json.set(f.id,JSON.parse(readFileSync(f.localPath,'utf8')));return this.json.get(f.id);}
 get(ref:any){return this.read(this.file(ref));}
 ref(ref:any):FixedRef{const f=this.file(ref);return {id:f.id,sha256:f.sha256};}
 byBytes(spec:any){strict(spec,['path','sha256']);const f=this.files.find(f=>f.localPath===resolve(spec.path)&&f.sha256===spec.sha256)||this.files.find(f=>f.localPath===spec.path&&f.sha256===spec.sha256);if(!f)throw Error('fixed_input_missing_from_public_catalog');return f;}
}
function requirement(facts:EvidenceFacts,id:string){return facts.requiredEvidence.find(r=>r.id===id);}
function received(c:EvidenceCatalog,facts:EvidenceFacts,id:string){const r=requirement(facts,id);if(r?.status!=='received'||!r.source)throw Error('required_fixed_evidence_unavailable');return c.get(r.source);}
function matchesRunSnapshot(snapshot:any,r:any,c:EvidenceCatalog,source:FixedRef){
 if(!snapshot||snapshot.runId!==r.runId||snapshot.taskSHA256!==r.taskSHA256)return false;
 const publicProducer=['ohuo-match-summary-v1','ohuo-offline-label-summary-v1','ohuo-supervised-summary-v1'].includes(snapshot.schema);
 if(publicProducer){
  // A matching run header is insufficient: the committed controller snapshot
  // must name these exact producer bytes, not an older/truncated same-run file.
  try{fixedRef(source);if(!list(r.consumerArtifactRefs).some((ref:any)=>c.file(ref).sha256===source.sha256))return false;}catch{return false;}
  if(snapshot.schema==='ohuo-match-summary-v1')return snapshot.taskId===r.task.taskId&&snapshot.queueRef===r.task.seatLayoutPlan&&Array.isArray(snapshot.matches)&&typeof snapshot.executionUnknown==='boolean';
  if(snapshot.schema==='ohuo-offline-label-summary-v1')return snapshot.selectionRef===r.task.datasetRefs[0]&&Array.isArray(snapshot.rows)&&typeof snapshot.executionUnknown==='boolean';
  return snapshot.frozenRefs?.sourceRevision===r.task.sourceRevision&&snapshot.frozenRefs?.runtimeRef===r.task.runtimeRef&&snapshot.frozenRefs?.dataset===r.task.datasetRefs[0]&&snapshot.actual!==null&&typeof snapshot.actual==='object';
 }
 return snapshot.task!==undefined&&equal(snapshot.task,r.task)&&snapshot.status===r.status&&equal(snapshot.committed,r.committed)&&snapshot.checkpointSHA256===r.checkpointSHA256&&equal(snapshot.consumerArtifactRefs??[],r.consumerArtifactRefs??[])&&(snapshot.stopReason??null)===(r.stopReason??null)&&(snapshot.failureReason??null)===(r.failureReason??null);
}
function actionKey(a:any){return canonical([a.clauseRef,a.branchRef]);}
function rootIds(plan:any){return list(plan.controlRoots).map((r:any)=>typeof r==='string'?r:r.rootInstanceId);}
function canonicalPlan(c:EvidenceCatalog,plan:PackagePlan,planRef:string){const f=c.file(plan.refs.plan),original=c.read(f);fixedReference(planRef,'original planRef');if(!Number.isSafeInteger(original.planVersion)||original.planVersion<1)throw Error('approved_plan_version_missing');if(planRef.slice(planRef.lastIndexOf(':')+1)!==digest(original))throw Error('approved_plan_canonical_identity_conflict');return {original,planRef};}
/** Explicit first-round public source projection. Every Task keeps its own
 * fixed namespace/index. A mixed formal train/dev queue is validated in full,
 * then projected by the original Task's split and root allocation. */
function firstRoundSourceIndexes(c:EvidenceCatalog,tasks:any[],endpoint:FixedRef){
 const usage=new Map<string,string>();
 const note=(index:any,family:string,scope:string,split:string)=>{
  const value=index.families[family];if(!value||value.split!==split)throw Error('first_round_source_family_split_conflict');
  for(const ancestor of [family,...(value.ancestors??[])]){const prior=usage.get(ancestor);if(prior&&prior!==scope)throw Error('first_round_source_ancestor_scope_conflict');usage.set(ancestor,scope);}
 };
 for(const t of tasks){
  // B08's endpoint F uses the canonical source ref ID but hashes raw index
  // bytes; the canonical wrapper is a distinct file. Select by BOTH ID and
  // canonical digest rather than accidentally reading the raw F as wrapper.
  const r=t.sourcePlan.sourceIndexRef,id=r.slice(0,r.lastIndexOf('@sha256:')),candidates=c.files.filter(f=>(f.id===id||f.id===r)&&digest(c.read(f))===r.slice(r.lastIndexOf(':')+1));
  if(candidates.length!==1)throw Error('first_round_source_index_canonical_reference');
  const reference=c.read(candidates[0]),comparison=c.get(t.scientificContract.comparisonRef),named=comparison.schema==='ohuo-first-round-comparison-v1';
  if(!named&&reference.fileSHA256!==endpoint.sha256)throw Error('task_source_index_conflict');
  if(reference.schema!=='ohuo-source-index-ref-v1'||reference.namespace!==t.sourcePlan.namespace||! /^[a-f0-9]{64}$/.test(reference.fileSHA256))throw Error('first_round_source_index_reference_conflict');
  const files=c.files.filter(f=>f.sha256===reference.fileSHA256);if(!files.length)throw Error('first_round_source_index_bytes_missing');const index=c.read(files[0]);
  if(index.version!==1||!index.families)throw Error('first_round_source_index_structure_missing');
  const split=t.sourcePlan.split==='confirm'?'sealed':t.sourcePlan.split,scope=canonical([t.sourcePlan.namespace,t.sourcePlan.split]),seen=new Set<string>();
  for(const family of t.sourcePlan.familyIds){note(index,family,scope,split);for(const ancestor of [family,...(index.families[family].ancestors??[])]){if(seen.has(ancestor))throw Error('source_ancestor_overlap');seen.add(ancestor);}}
  const queue=c.get(t.seatLayoutPlan);if(queue.schema!=='ohuo-complete-match-queue-v1')continue;
  if(queue.sourceIndexRef!==t.sourcePlan.sourceIndexRef||named&&queue.namespace!==t.sourcePlan.namespace)throw Error('queue_task_source_reference_conflict');
  const rows=list(queue.rows),owned=rows.filter(r=>r.split===t.sourcePlan.split&&t.sourcePlan.familyIds.includes(r.sourceFamilyId));
  if(!owned.length)throw Error('first_round_source_queue_projection_empty');
  for(const row of rows){
   if(!named&&row.split!==t.sourcePlan.split)throw Error('queue_ancestry_split_conflict');
   if(!['train','dev','confirm','fixture'].includes(row.split)||!Array.isArray(row.roundFamilyIds)||row.roundFamilyIds.length!==row.maxGames||row.roundFamilyIds[0]!==row.sourceFamilyId)throw Error('first_round_source_queue_ancestry');
   for(const family of row.roundFamilyIds)note(index,family,canonical([t.sourcePlan.namespace,row.split]),row.split==='confirm'?'sealed':row.split);
  }
  if(t.sourcePlan.familyIds.some((id:string)=>!owned.some(r=>r.roundFamilyIds.includes(id))))throw Error('first_round_source_task_allocation');
  const cap=c.get(t.capabilityRef),rule=c.get(t.scientificContract.decisionRuleRef);
  if(cap.id==='B07.complete-match.v1'&&rule.schema!=='ohuo-first-round-new-test-contract-v1'&&owned.some(r=>r.roundFamilyIds.some((id:string)=>!t.sourcePlan.familyIds.includes(id))))throw Error('first_round_source_task_future_ancestry');
 }
}

/** SHA is transport identity, not semantic acceptance. Issues stay named and
 * recoverable; unstructured scientific interpretation is never certified. */
export function validateHandoffBindings(plan:PackagePlan,summary:any,facts:EvidenceFacts){
 const c=new EvidenceCatalog(facts),issues:BindingIssue[]=c.issues.flatMap(issue=>{const labels=facts.requiredEvidence.filter(r=>r.source?.id===issue.evidenceId);return labels.length?labels.map(r=>({...issue,evidenceId:r.id})):[issue];});
 const check=(id:string,fn:()=>void)=>{if(requirement(facts,id)?.status!=='received')return;try{fn();}catch(e:any){issues.push({evidenceId:id,missingKind:'INVALID_OR_CONTAMINATED',reason:e.message});}};
 let context:any=null,approved:any=null,planRef:string|null=null,tasks:any[]=[],states:any[]=[],runs:any[]=[],firstRoundPlanExecution:any=null;
 const firstRoundPaired=plan.question==='student_match'&&(()=>{try{return c.get(plan.refs.conditions).schema==='ohuo-first-round-confirmation-rule-v1';}catch{return false;}})();
 check('planContext',()=>{
  context=received(c,facts,'planContext');({original:approved,planRef}=canonicalPlan(c,plan,context.planRef));
  if(context.planRef!==planRef||context.planVersion!==approved.planVersion)throw Error('plan_context_identity_conflict');
  list(context.parentPackageRefs).forEach(fixedRef);if(!sameSet(context.parentPackageRefs,plan.parentPackageRefs??(plan.refs.parentPackage?[plan.refs.parentPackage]:[])))throw Error('parent_package_context_conflict');
  if(context.firstRound===true){if(approved.firstRound!==true||context.priorDecisionRef!==null||!context.firstRoundRuleRef)throw Error('first_round_original_rule_required');c.get(context.firstRoundRuleRef);}
  else if(context.firstRound!==false||!context.parentPackageRefs.length||!context.priorDecisionRef)throw Error('nonfirst_round_parent_and_prior_required');
  tasks=list(context.taskFileRefs).map((r:any)=>{const t=validateTask(c.get(r));if(t.planRef!==planRef||t.planVersion!==context.planVersion)throw Error('task_plan_context_conflict');return t;});
  if(!unique(tasks.map(t=>t.taskId))||!unique(tasks.map(t=>t.runId)))throw Error('duplicate_task_or_run_identity');
 });
 check('priorDecision',()=>{
  if(!context)throw Error('plan_context_unavailable');
  if(context.firstRound){if(!equal(requirement(facts,'priorDecision')?.source,c.ref(context.firstRoundRuleRef)))throw Error('first_round_prior_not_original_rule');return;}
  if(!equal(requirement(facts,'priorDecision')?.source,context.priorDecisionRef))throw Error('prior_reference_conflict');
  const chain:any[]=[],seen=new Set<string>();let ref=context.priorDecisionRef;
  while(ref!==null){const a=c.get(ref),key=canonical(c.ref(ref));if(seen.has(key))throw Error('prior_analysis_cycle');seen.add(key);nonempty(a.analysisId);nonempty(a.decision_id);nonempty(a.disposition);
   if(a.planRef!==planRef||!a.inputPackageRef||a.inputManifestSHA!==a.inputPackageRef.sha256||!chain.length&&!context.parentPackageRefs.some((p:any)=>equal(p,a.inputPackageRef)))throw Error('prior_plan_or_parent_package_conflict');
   c.get(a.inputPackageRef);if(!Object.hasOwn(a,'priorDecisionRef'))throw Error('prior_chain_field_missing');list(a.orderedActions);list(a.taskFileRefs);chain.push(a);ref=a.priorDecisionRef;
  }
  for(const t of tasks){const tr=context.taskFileRefs[tasks.indexOf(t)];if(!chain.some(a=>a.disposition==='CONTINUE_APPROVED_PLAN'&&a.taskFileRefs.includes(tr)&&a.orderedActions.some((x:any)=>x.clauseRef===t.planScope.clauseRef&&x.branchRef===t.planScope.branchRef&&a.allowedPlanClause===x.clauseRef&&a.allowedBranchRef===x.branchRef&&list(x.taskFileRefs).includes(tr))))throw Error('prior_instruction_task_scope_conflict');}
 });
 check('allTaskRuns',()=>{
  const a=received(c,facts,'allTaskRuns');if(!context||a.planRef!==planRef)throw Error('all_task_runs_plan_conflict');
  states=list(a.controlStateRefs).map(r=>c.get(r));if(!unique(states.map(s=>s.rootInstanceId))||!sameSet(states.map(s=>s.rootInstanceId),rootIds(approved)))throw Error('registered_control_root_scope_conflict');
  const inventory=c.get(a.runInventoryRef);if(inventory.schema!=='ohuo-run-inventory-v1')throw Error('run_inventory_schema_conflict');
  const publicRuns=list(a.runRefs).map(r=>c.get(r)),expected=list(inventory.runs);runs=[];
  if(!sameSet(expected.map(r=>[r.runId,r.sha256]),list(a.runRefs).map((r:any,i:number)=>[publicRuns[i].runId,r.sha256])))throw Error('run_inventory_snapshot_set_conflict');
  const observed:any[]=[];
  for(const s of states){if(s.schemaVersion!==1||!s.tasks||!s.runs||!s.budgets||!s.batches)throw Error('committed_control_state_incomplete');
   for(const [id,runId] of Object.entries(s.tasks)){const r=s.runs[runId as string];if(!r)throw Error('missing_run:'+id);if(r.task?.planRef===planRef&&r.task.taskId!==id)throw Error('state_task_run_mapping_conflict');}
   for(const [id,r] of Object.entries(s.runs) as any){if(r.task?.planRef!==planRef)continue;observed.push(id);const t=tasks.find(t=>t.taskId===r.task.taskId),snapshot=publicRuns.find(r=>r.runId===id);runs.push(r);
    if(!t||!equal(t,r.task)||r.taskSHA256!==digest(t)||r.runId!==id||s.tasks[t.taskId]!==id||r.taskRef!==context.taskFileRefs[tasks.indexOf(t)])throw Error('actual_task_run_identity_conflict');
    if(!matchesRunSnapshot(snapshot,r,c,a.runRefs[publicRuns.indexOf(snapshot)]))throw Error('run_snapshot_state_conflict');
   }
  }
  if(!sameSet(observed,publicRuns.map(r=>r.runId)))throw Error('all_attempts_bidirectional_set_conflict');
  if(plan.question!=='plan_closeout'){
   // The first-round paired estimator sees ONLY this frozen confirmation
   // queue's complete all-attempt inventory. Above, the original all-plan
   // control roots/run inventory remain bidirectional and are never filtered.
   let analysisExpected=expected;
   if(firstRoundPaired){
    const queueRef=summary.sourceInputs?.queue?.id,scope=runs.filter(r=>r.task.seatLayoutPlan===queueRef&&c.get(r.task.capabilityRef).id==='B07.complete-match.v1'&&c.get(r.task.scientificContract.decisionRuleRef).schema!=='ohuo-first-round-new-test-contract-v1');
    analysisExpected=expected.filter(r=>scope.some(x=>x.runId===r.runId));
    const files=c.files.filter(f=>f.sha256===summary.sourceInputs?.runInventory?.sha256);if(!files.length)throw Error('first_round_analysis_inventory_unavailable');const projected=c.read(files[0]);
    if(projected.schema!=='ohuo-run-inventory-v1'||!sameSet(list(projected.runs),analysisExpected)||!sameSet(list(summary.sourceInputs?.runs),analysisExpected))throw Error('first_round_analysis_inventory_projection_conflict');
    firstRoundPlanExecution={scope:'all_registered_plan_runs_not_only_paired_confirmation',runInventoryRef:a.runInventoryRef,runs:runs.map(r=>({runId:r.runId,taskId:r.task.taskId,status:r.status,cleanupConfirmed:r.cleanupConfirmed===true,executionUnknown:r.executionUnknown===true||r.observationStatus==='unknown'||r.checkpoint?.executionUnknown===true||r.checkpoint?.active!=null,stopReason:r.stopReason??null,failureReason:r.failureReason??null,consumption:consumptionFromCommittedState(states,r.task)}))};
   }else if(summary.sourceInputs?.runInventory?.sha256!==a.runInventoryRef.sha256||!sameSet(list(summary.sourceInputs?.runs),expected))throw Error('actual_run_inventory_binding_conflict');
   const actual=list(summary.runFacts);if(!sameSet(actual.map(r=>[r.runId,r.source?.sha256]),analysisExpected.map(r=>[r.runId,r.sha256])))throw Error('actual_rebuilt_run_set_conflict');
   for(const r of actual){const stateRun=runs.find(x=>x.runId===r.runId);if(!stateRun||r.taskId!==stateRun.task.taskId||r.taskSHA256!==stateRun.taskSHA256||r.queueRef!==undefined&&(r.queueRef!==stateRun.task.seatLayoutPlan||r.queueRef!==summary.sourceInputs.queue?.id))throw Error('actual_rebuilt_run_task_identity_conflict');}
  }
 });
 check('acceptedProgram',()=>{
  if(!context)throw Error('plan_context_unavailable');const p=received(c,facts,'acceptedProgram'),delivery=c.get(p.deliveryStateRef),batch=c.get(p.engineeringBatchRef);
  if(!delivery.acceptanceRef)throw Error('candidate_has_no_actual_acceptance');const receipt=c.get(delivery.acceptanceRef);
  if(receipt.kind!=='functional-acceptance'||receipt.functionalStatus!=='accepted'||receipt.batchId!==batch.batchId||receipt.revision!==batch.revision||!equal(receipt.acceptedCodeRef,batch.checkPlan?.sourceRef)||!list(receipt.checkReceiptRefs).length)throw Error('actual_functional_acceptance_conflict');
  receipt.checkReceiptRefs.forEach((r:any)=>c.file(r));
  // Later diagnostic production may use a separately accepted descendant.
  // Historical Task bytes must match ONE original accepted source, not an
  // invented union of files or the descendant's new implementation hashes.
  const acceptedSources=[receipt.acceptedCodeRef];
  const historicalSource=(r:any)=>{if(r.kind!=='functional-acceptance'||r.functionalStatus!=='accepted'||!r.acceptedCodeRef||!list(r.acceptedCodeRef.files).length||!list(r.checkReceiptRefs).length)throw Error('historical_source_acceptance_incomplete');r.checkReceiptRefs.forEach((f:any)=>c.file(f));acceptedSources.push(r.acceptedCodeRef);};
  const parent=batch.acceptedParentRef;if(parent?.receiptRef){const r=c.get(parent.receiptRef);if(r.kind!=='functional-acceptance'||r.functionalStatus!=='accepted'||!equal(r.acceptedCodeRef,parent.sourceRef)||r.acceptedCodeRef.baseCommit!==batch.baseCommit)throw Error('accepted_parent_source_conflict');historicalSource(r);}
  else if(parent?.commit!==batch.baseCommit)throw Error('actual_accepted_parent_missing');
  for(const r of list(batch.dependsOn)){const d=c.get(r);if(d.kind!=='functional-acceptance'||d.functionalStatus!=='accepted')throw Error('dependency_not_accepted');historicalSource(d);}
  for(const t of tasks){const source=c.get(t.sourceRevision);c.get(t.runtimeRef);c.get(t.capabilityRef);
   if(!list(source.files).length||!acceptedSources.some(accepted=>source.baseCommit===accepted.baseCommit&&source.files.every((f:any)=>list(accepted.files).some((a:any)=>equal(a,f)))))throw Error('runtime_source_vs_accepted_code_conflict:'+t.taskId);
   const run=runs.find(r=>r.runId===t.runId);if(run&&(!equal(run.task,t)||run.taskSHA256!==digest(t)))throw Error('actual_runtime_task_identity_conflict');
  }
 });
 const numericalRecovery=numericalRecoveryEvidence(c,facts,planRef,approved,tasks,states,issues);
 check('selectionHistory',()=>{
  if(!context)throw Error('plan_context_unavailable');const h=received(c,facts,'selectionHistory');if(h.planRef!==planRef||!list(h.entries).length)throw Error('selection_history_empty_or_wrong_plan');c.get(h.selectionRuleRef);c.get(h.readoutRuleRef);
  if(!unique(h.entries.map((e:any)=>[e.runId,e.checkpointRef,e.kind])))throw Error('selection_history_duplicate');
  for(const e of h.entries){if(!['screening','teacher','development','selection','confirmation','excluded'].includes(e.kind)||typeof e.selected!=='boolean')throw Error('selection_history_entry_incomplete');
   const t=tasks.find(t=>t.runId===e.runId);if(!t||context.taskFileRefs[tasks.indexOf(t)]!==e.taskFileRef||e.selected&&e.kind==='confirmation')throw Error('selection_run_or_confirmation_conflict');
   if(e.selected&&t.retryReasonRef&&c.get(t.retryReasonRef).schema==='ohuo-prerequisite-receipt-v2'&&!numericalRecovery.roles.some((r:any)=>r.taskId===t.taskId&&r.formalComplete))throw Error('numerical_recovery_not_selection_eligible');
   if(t.sourcePlan.split==='confirm'&&(e.kind!=='confirmation'||e.selected)||e.kind==='confirmation'&&t.sourcePlan.split!=='confirm')throw Error('original_confirmation_source_selection_conflict');
   if(t.scientificContract.selectionRuleRef!==(e.selectionRuleRef??h.selectionRuleRef)||t.scientificContract.readoutRuleRef!==(e.readoutRuleRef??h.readoutRuleRef))throw Error('selection_rule_task_conflict');
   if(e.checkpointRef!==null)c.file(typeof e.checkpointRef==='string'&&!e.checkpointRef.includes('@sha256:')?{path:e.checkpointRef}:e.checkpointRef);
   if(!e.selected){if(!e.excludedReasonRef)throw Error('selection_exclusion_reason_missing');c.get(e.excludedReasonRef);}
  }
  for(const r of runs){if(!h.entries.some((e:any)=>e.runId===r.runId&&e.taskFileRef===r.taskRef&&e.checkpointRef===r.checkpointRef))throw Error('selection_history_missing_run_or_checkpoint:'+r.runId);
   // Existing B10 producer lists all allowed dev checkpoints, not only its winner.
   for(const artifact of r.consumerArtifactRefs??[]){const value=c.get(artifact);for(const row of value.selection?.allowedCheckpoints??[]){const cp=row.checkpoint??row;if(!h.entries.some((e:any)=>{if(e.runId!==r.runId||!e.checkpointRef)return false;try{return c.file(typeof e.checkpointRef==='string'&&!e.checkpointRef.includes('@sha256:')?{path:e.checkpointRef}:e.checkpointRef).sha256===cp.manifestSHA256;}catch{return false;}}))throw Error('selection_history_missing_development_checkpoint');}}
  }
  if(h.selectedTeacherRef!==null){c.get(h.selectedTeacherRef);if(!tasks.some(t=>t.labelPolicyRef===h.selectedTeacherRef))throw Error('selected_teacher_task_conflict');}
  if(h.selectedStudentRef!==null){c.get(h.selectedStudentRef);if(!tasks.some(t=>t.releaseRefs.includes(h.selectedStudentRef)))throw Error('selected_student_task_conflict');}
  if(plan.refs.selectionHistory&&!equal(c.ref(plan.refs.selectionHistory),requirement(facts,'selectionHistory')?.source))throw Error('frozen_selection_history_reference_conflict');
 });
 check('sourceIndex',()=>{
  if(!context)throw Error('plan_context_unavailable');const index=received(c,facts,'sourceIndex'),file=c.file(requirement(facts,'sourceIndex')!.source);
  if(index.version!==1||!index.families)throw Error('source_index_structure_missing');
  if(plan.refs.sourceIndex&&!equal(c.ref(plan.refs.sourceIndex),requirement(facts,'sourceIndex')?.source))throw Error('frozen_source_index_reference_conflict');
  // Named first-round Tasks can span pilot/formal/new/confirmation namespaces.
  // Legacy callers retain the original single-index, same-split strict path.
  if(tasks.some(t=>c.get(t.scientificContract.comparisonRef).schema==='ohuo-first-round-comparison-v1')){firstRoundSourceIndexes(c,tasks,{id:file.id,sha256:file.sha256});return;}
  const usage=new Map<string,string>();
  for(const t of tasks){const ref=c.get(t.sourcePlan.sourceIndexRef);if(ref.fileSHA256!==file.sha256||ref.namespace!==t.sourcePlan.namespace)throw Error('task_source_index_conflict');
   const seen=new Set<string>();for(const id of t.sourcePlan.familyIds){const family=index.families[id],split=t.sourcePlan.split==='confirm'?'sealed':t.sourcePlan.split;if(!family||family.split!==split)throw Error('source_family_split_conflict');for(const ancestor of [id,...(family.ancestors??[])]){if(seen.has(ancestor))throw Error('source_ancestor_overlap');seen.add(ancestor);if(usage.has(ancestor)&&usage.get(ancestor)!==split)throw Error('source_ancestor_cross_split_conflict');usage.set(ancestor,split);}}
   const queue=c.get(t.seatLayoutPlan);if(queue.schema==='ohuo-complete-match-queue-v1'){if(queue.sourceIndexRef!==t.sourcePlan.sourceIndexRef)throw Error('queue_task_source_reference_conflict');for(const row of list(queue.rows))for(const family of list(row.roundFamilyIds))if(index.families[family]?.split!==(row.split==='confirm'?'sealed':row.split)||row.split!==t.sourcePlan.split)throw Error('queue_ancestry_split_conflict');}
  }
 });
 check('newDistribution',()=>validateDistribution(c,received(c,facts,'newDistribution'),tasks,received(c,facts,'selectionHistory'),states,c.ref(requirement(facts,'newDistribution')?.source)));
 // Candidate without a receipt is NOT_DUE, not a claimed missing execution file.
 for(const issue of issues)if(issue.evidenceId==='acceptedProgram'&&issue.reason==='candidate_has_no_actual_acceptance')issue.missingKind='NOT_YET_EXECUTED';
 return {issues,files:c.files,context,approved,planRef,tasks,states,runs,numericalRecovery,firstRoundPlanExecution};
}
/** The optional numericalRecovery evidence label names the same fixed host-v2
 * metadata, not a caller-supplied verified boolean or a second bindings store.
 * Every read is resolved through the existing explicitly public catalog. Missing
 * private training facts are never loaded; this exporter never opens host paths. */
function numericalRecoveryEvidence(c:EvidenceCatalog,facts:EvidenceFacts,planRef:string|null,approved:any,tasks:any[],states:any[],issues:BindingIssue[]){
 const result:any={branches:[],roles:[],scientificQualification:null};
 const relevant=tasks.filter(t=>t.retryReasonRef&&(()=>{try{return c.get(t.retryReasonRef).schema==='ohuo-prerequisite-receipt-v2';}catch{return false;}})());
 const entry=requirement(facts,'numericalRecovery');if(!entry&&!relevant.length)return result;
 const problem=(reason:string)=>{if(!issues.some(x=>x.evidenceId==='numericalRecovery'&&x.reason===reason))issues.push({evidenceId:'numericalRecovery',missingKind:'INVALID_OR_CONTAMINATED',reason});};
 if(entry?.status!=='received'||!entry.source){problem('numerical_recovery_fixed_host_unavailable');return result;}
 try{
  const host=received(c,facts,'numericalRecovery');strict(host,['schema','controlRoot','rootInstanceId','initialStateRef','references','evidenceFiles','grantFile','planCloseoutFile','inputBindings','profileStorePath','pythonPath','numericalRecoveryAssignments']);
  if(host.schema!=='ohuo-fixed-host-v2'||!planRef||!approved)throw Error('numerical_recovery_fixed_host_v2_required');
  const registrations=list(approved.controlRoots).filter(x=>x.rootInstanceId===host.rootInstanceId),roots=states.filter(s=>s.rootInstanceId===host.rootInstanceId);
  if(registrations.length!==1||roots.length!==1)throw Error('numerical_recovery_control_root_unavailable');
  const controlRoot=registrations[0].controlRoot,state=roots[0];
  const relative=(p:any)=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.split(/[\\/]/).some((s:string)=>!s||s==='.'||s==='..');
  if(!relative(host.controlRoot)||typeof controlRoot!=='string'||!controlRoot.endsWith('/'+host.controlRoot))throw Error('numerical_recovery_control_root_conflict');
  const repository=controlRoot.slice(0,-host.controlRoot.length);
  const logical=(p:string)=>{const value=p.startsWith(repository)?p.slice(repository.length):p;if(!relative(value)||privatePath(value))throw Error('numerical_recovery_nonpublic_source');return value;};
  const file=(p:any)=>{strict(p,['path','sha256']);if(!/^[a-f0-9]{64}$/.test(p.sha256))throw Error('numerical_recovery_file_identity_missing');return c.file({path:logical(p.path),sha256:p.sha256});};
  const raw=(f:EvidenceFile)=>({ref:{id:f.id,sha256:f.sha256},bytes:readFileSync(f.localPath)});
  const refs=list(host.references).map(r=>{strict(r,['ref','file']);fixedReference(r.ref,'host reference');const value=c.read(file(r.file));if(digest(value)!==r.ref.slice(r.ref.lastIndexOf(':')+1))throw Error('numerical_recovery_reference_conflict');return {ref:r.ref,value};});
  if(!unique(refs.map(x=>x.ref)))throw Error('numerical_recovery_duplicate_reference');
  const get=(r:string)=>{const matches=refs.filter(x=>x.ref===r);if(matches.length!==1)throw Error('numerical_recovery_reference_unavailable');return matches[0].value;};
  const evidenceFiles=list(host.evidenceFiles);if(!unique(evidenceFiles.map(x=>x.id)))throw Error('numerical_recovery_duplicate_evidence');
  const evidence=(r:any)=>{fixedRef(r);const matches=evidenceFiles.filter(x=>x.id===r.id&&x.file?.sha256===r.sha256);if(matches.length!==1)throw Error('numerical_recovery_evidence_unavailable:'+r.id);strict(matches[0],['id','file']);const value=raw(file(matches[0].file));if(!equal(value.ref,r))throw Error('numerical_recovery_evidence_identity_conflict');return value;};
  const ibs=list(host.inputBindings),binding=(ref:string)=>{const matches=ibs.filter(x=>x.taskRef===ref);if(matches.length!==1)throw Error('numerical_recovery_input_binding_conflict');return matches[0];};
  const grant=c.read(file(host.grantFile));if(grant.controlRoot!==host.controlRoot||grant.rootInstanceId!==host.rootInstanceId||grant.initialStateRef!==host.initialStateRef||grant.planRef!==planRef)throw Error('numerical_recovery_grant_root_conflict');
  const assignments=list(host.numericalRecoveryAssignments).map(p=>raw(file(p)));
  const actions=approved.actions??get(approved.actionsRef).actions;
  const explicitlyListed=new Map<string,any>();
  for(const row of list(grant.tasks))for(const p of list(row.prerequisiteReceipts)){
   const receipt=get(p.receiptRef);for(const f of list(receipt.evidence_refs??[]))explicitlyListed.set(canonical(f),f);
   if(receipt.numerical){for(const f of [receipt.numerical.inputImplementationReviewRef,receipt.numerical.metricsRef].filter(Boolean))explicitlyListed.set(canonical(f),f);}
  }
  const loaded=[...explicitlyListed.values()].map(evidence);
  const calibrationEvidence:any[]=[];
  const receipts=[...new Set(list(grant.tasks).flatMap(row=>list(row.prerequisiteReceipts).map(p=>p.receiptRef)))];
  for(const receiptRef of receipts){const receipt=get(receiptRef);if(receipt.schema!=='ohuo-prerequisite-receipt-v2'||receipt.kind!=='calibration-qualification'||receipt.decision!=='met')continue;
   try{
    const q=receipt.calibration,t=validateTask(get(q.taskRef)),ib=binding(q.taskRef),dataset=get(t.datasetRefs[0]);
    const datasetManifest=raw(file({path:logical(ib.datasetDirectory)+'/manifest.json',sha256:dataset.manifestSHA256}));
    // Only explicit original receipt evidence may identify the external tool
    // return. Neither a directory scan nor an arbitrary passed flag is proof.
    const executions=list(receipt.evidence_refs).map(evidence).filter(doc=>{try{const e=JSON.parse(doc.bytes.toString()),out=JSON.parse(e.stdout);return Array.isArray(e.command)&&out.taskRef===q.taskRef&&out.runId===q.runId&&equal(out.diagnosticRef,q.diagnosticRef);}catch{return false;}});
    if(executions.length!==1)throw Error('numerical_qualification_tool_evidence_missing_or_ambiguous');
    const producerExecution=executions[0],execution=JSON.parse(producerExecution.bytes.toString()),out=JSON.parse(execution.stdout),production=raw(c.file(out.productionRef)),produced=JSON.parse(production.bytes.toString());
    const request={ref:produced.requestRef,value:get(produced.requestRef)};
    if(requirement(facts,'acceptedProgram')?.status!=='received'||issues.some(x=>x.evidenceId==='acceptedProgram'))throw Error('numerical_qualification_producer_acceptance_unverified');
    const program=received(c,facts,'acceptedProgram'),delivery=c.get(program.deliveryStateRef),producerAcceptance=raw(c.file(delivery.acceptanceRef));
    const controlState=evidence(q.controlStateRef),snapshot=JSON.parse(controlState.bytes.toString()),run=snapshot.runs?.[t.runId],ledger=snapshot.budgets?.[t.budgetRef],diagnostic=JSON.parse(evidence(q.diagnosticRef).bytes.toString());
    const checkpoints:any[]=[];
    for(const factsRef of list(q.checkpointFactsRefs)){
     const facts=evidence(factsRef),n=JSON.parse(facts.bytes.toString()).optimizerSteps;let controlCheckpoint:any=null,pointer:any;
     if(n===0)pointer=run?.checkpoint?.milestones?.find((x:any)=>x.checkpoint?.optimizerSteps===0)?.checkpoint;
     else{
      const candidates=list(run?.committed).map(id=>ledger?.reservations?.[id]).filter(r=>r?.runId===t.runId&&r.status==='committed'&&r.checkpointSHA256).map(r=>raw(c.file({path:logical(t.outputRoot)+'/checkpoint-'+r.checkpointSHA256+'.json'}))).filter(doc=>JSON.parse(doc.bytes.toString()).optimizerSteps===n);
      if(candidates.length!==1)throw Error('numerical_qualification_control_checkpoint_unavailable');controlCheckpoint=candidates[0];pointer=JSON.parse(controlCheckpoint.bytes.toString()).studentCheckpoint;
     }
     if(!pointer||!/^checkpoints\/[a-zA-Z0-9_-]+$/.test(pointer.path))throw Error('numerical_qualification_checkpoint_path_conflict');
     const manifest=raw(file({path:logical(t.outputRoot)+'/'+pointer.path+'/manifest.json',sha256:pointer.manifestSHA256}));
     if(file({path:logical(t.outputRoot)+'/'+pointer.path+'/state.json',sha256:factsRef.sha256}).id!==factsRef.id)throw Error('numerical_qualification_facts_path_conflict');
     checkpoints.push({controlCheckpoint,manifest,facts});
    }
    const semantic=new Map<string,any>();for(const check of Object.values(diagnostic.checks) as any[])for(const ref of list(check.evidence_refs))semantic.set(canonical(ref),evidence(ref));
    const originalTool=raw(c.file(execution.originalToolRef));semantic.set(canonical(originalTool.ref),originalTool);
    calibrationEvidence.push({receiptRef,request,production,diagnostic:evidence(q.diagnosticRef),producerAcceptance,producerExecution,task:{ref:q.taskRef,value:t},inputBinding:ib,dataset:{ref:t.datasetRefs[0],value:dataset},datasetManifest,controlState,summary:evidence(q.summaryRef),checkpoints,evidence:[...semantic.values()]});
   }catch(e:any){problem('numerical_qualification_source_unverified:'+e.message);}
  }
  // A closed global branch is not a time machine: retain an already-produced
  // selection only through its original completion chain. This binds public
  // artifacts; it does not re-run selection, infer thresholds, or grant work.
  const historicalCompletion=(task:any,taskRef:string)=>{
   const candidates=loaded.filter(doc=>{try{const r=JSON.parse(doc.bytes.toString());return r.schema==='ohuo-student-finalization-receipt-v1'&&r.trainingTaskRef===taskRef;}catch{return false;}});
   if(!candidates.length)return null;
   if(candidates.length!==1)throw Error('historical_formal_completion_ambiguous');
   const doc=candidates[0],r=JSON.parse(doc.bytes.toString());strict(r,['schema','requestRef','trainingTaskRef','trainingRunId','summaryRef','reviewRef','status','selectionRef','releaseRef','issues']);
   if(r.status!=='selected'||list(r.issues).length||r.trainingRunId!==task.runId)throw Error('historical_formal_completion_incomplete');
   const request=get(r.requestRef),action=actions.find((a:any)=>a.clauseRef===request.clauseRef&&a.branchRef===request.branchRef),rule=action&&get(action.acceptanceRuleRef),parent=get(task.parentPolicyRef),ib=binding(taskRef),data=get(task.datasetRefs[0]);
   strict(request,['schema','planRef','planVersion','clauseRef','branchRef','trainingTaskRef','trainingRunId','summaryRef','reviewRef','parentPolicyRef','policyId','outputPath']);
   const firstRound=isFirstRoundRecipe(task.learnerRecipe),parent423=firstRound?validateFirstRoundParentEnvelope({parentRef:task.parentPolicyRef,envelope:parent,readEvidence:f=>evidence(f).bytes}):null,proposal=firstRound?resolveCandidateReleaseRef(get(task.outputSpec.proposalPolicyRef),get,RELEASES):null,proposalPolicyRef=firstRound?proposal!.release.proposalPolicyRef:parent.policyRef,proposalIdentity=firstRound?proposal!.policyIdentity:parent.policyIdentity;

   if(request.schema!=='ohuo-student-finalization-request-v1'||request.planRef!==task.planRef||request.planVersion!==task.planVersion||request.trainingTaskRef!==taskRef||request.trainingRunId!==task.runId||!equal(request.summaryRef,r.summaryRef)||!equal(request.reviewRef,r.reviewRef)||!action?.expectedArtifactKinds.includes('ohuo-student-finalization-receipt-v1')||rule.schema!=='ohuo-stage-action-rule-v1'||rule.stage!==5||rule.phase!=='formal'||ib.trainingPhase!=='formal'||(!firstRound&&parent.schema!=='ohuo-parent-policy-ref-v1')||request.parentPolicyRef!==proposalPolicyRef||request.outputPath!==logical(task.outputRoot)+'/student-release.json'||r.releaseRef?.id!==request.outputPath)throw Error('historical_formal_request_conflict');
   // Same versioned structural gate as H.prerequisiteReceipt, with original
   // exact-key parsing and explicit public F resolution; no new receipt kind.
   const prerequisiteShape=(receipt:any)=>{
    const v2=receipt.schema==='ohuo-prerequisite-receipt-v2';
    strictObject(receipt,'historicalPrerequisite',['schema','planRef','planVersion','requirementRef','kind','decision','evidence_refs','analysisRef','numerical',...(v2?['calibration','recoveryRef']:[])]);
    if(!(v2?['calibration-qualification','numerical-restart']:['engineering-acceptance','scientific-decision','dataset-qualification','student-selection','numerical-restart']).includes(receipt.kind))throw Error('historical_formal_prerequisite_kind_conflict');
    const checkFile=(f:any)=>{strictObject(f,'historicalPrerequisite.evidenceRef',['id','sha256']);evidence(f);};
    list(receipt.evidence_refs).forEach(checkFile);
    if(receipt.kind==='scientific-decision'&&receipt.analysisRef===null||v2&&receipt.analysisRef!==null)throw Error('historical_formal_prerequisite_analysis_conflict');
    if(receipt.analysisRef!==null)checkFile(receipt.analysisRef);
    if(receipt.kind==='numerical-restart'){
     strictObject(receipt.numerical,'historicalPrerequisite.numerical',['failedTaskId','failedRunId','datasetRef','parentPolicyRef','seed','trigger','inputImplementationReviewRef','metricsRef']);
     if(v2){if(receipt.calibration!==null)throw Error('historical_formal_prerequisite_numerical_conflict');fixedReference(receipt.recoveryRef,'recoveryRef');get(receipt.recoveryRef);}
    }else if(receipt.numerical!==null)throw Error('historical_formal_prerequisite_numerical_conflict');
    if(v2&&receipt.kind==='calibration-qualification'){
     if(receipt.recoveryRef!==null)throw Error('historical_formal_prerequisite_recovery_conflict');
     strictObject(receipt.calibration,'historicalPrerequisite.calibration',['taskRef','runId','summaryRef','controlStateRef','checkpointFactsRefs','diagnosticRef']);
     fixedReference(receipt.calibration.taskRef,'calibration.taskRef');validateIdentifier(receipt.calibration.runId,'calibration.runId');
     [receipt.calibration.summaryRef,receipt.calibration.controlStateRef,receipt.calibration.diagnosticRef,...list(receipt.calibration.checkpointFactsRefs)].forEach(checkFile);
    }
   };
   // Reconcile the original nonrunner rule and its fixed prerequisite facts;
   // an empty action or a selected receipt alone cannot attest formal completion.
   strict(rule,['schema','stage','phase','purpose','originalRuleRef','requiredKinds']);if(typeof rule.purpose!=='string'||!rule.purpose.trim()||!rule.originalRuleRef||!Array.isArray(rule.requiredKinds))throw Error('historical_formal_rule_incomplete');get(rule.originalRuleRef);
   const requiredKinds=['complete-formal-training','frozen-behavior-review','allowed-checkpoints','budget-scope'],declared=list(rule.requiredKinds),prerequisites:any[]=[];
   if(requiredKinds.some(kind=>!declared.includes(kind))||declared.includes('student-selection'))throw Error('historical_formal_rule_incomplete');
   for(const requirementRef of list(action.dependencyRefs)){
    const requirement=get(requirementRef);strict(requirement,['schema','stage','phase','kind','sourceRuleRef']);get(requirement.sourceRuleRef);
    if(requirement.schema!=='ohuo-stage-prerequisite-v1'||requirement.stage!==5||![null,'formal'].includes(requirement.phase)||requirement.kind==='student-selection'||prerequisites.some(x=>x.kind===requirement.kind))throw Error('historical_formal_dependency_conflict');
    let candidates=[...new Set(list(grant.tasks).flatMap(row=>list(row.prerequisiteReceipts).filter(p=>p.requirementRef===requirementRef).map(p=>p.receiptRef)))];
    if(!candidates.length)candidates=refs.filter(x=>['ohuo-prerequisite-receipt-v1','ohuo-prerequisite-receipt-v2'].includes(x.value?.schema)&&x.value.planRef===task.planRef&&x.value.planVersion===task.planVersion&&x.value.requirementRef===requirementRef).map(x=>x.ref);
    if(candidates.length!==1)throw Error('historical_formal_prerequisite_missing_or_ambiguous');const receipt=get(candidates[0]);
    if(!['ohuo-prerequisite-receipt-v1','ohuo-prerequisite-receipt-v2'].includes(receipt.schema)||receipt.planRef!==task.planRef||receipt.planVersion!==task.planVersion||receipt.requirementRef!==requirementRef||receipt.decision!=='met'||!list(receipt.evidence_refs).length)throw Error('historical_formal_prerequisite_unverified');
    prerequisiteShape(receipt);prerequisites.push({kind:requirement.kind,receiptRef:candidates[0],receipt});
   }
   if([...requiredKinds,...declared].some(kind=>!prerequisites.some(x=>x.kind===kind)))throw Error('historical_formal_dependencies_incomplete');
   const hasFile=(kind:string,ref:any)=>prerequisites.find(x=>x.kind===kind).receipt.evidence_refs.some((f:any)=>equal(f,ref));
   if(!hasFile('complete-formal-training',r.summaryRef)||!hasFile('allowed-checkpoints',r.summaryRef)||!hasFile('frozen-behavior-review',r.reviewRef)||!prerequisites.find(x=>x.kind==='budget-scope').receipt.evidence_refs.some((f:any)=>digest(c.get(f))===task.budgetRef.split(':').at(-1)))throw Error('historical_formal_prerequisite_input_conflict');
   const summary=c.get(r.summaryRef),review=c.get(r.reviewRef),selection=c.get(r.selectionRef),release=c.get(r.releaseRef),manifest=c.read(file({path:logical(ib.datasetDirectory)+'/manifest.json',sha256:data.manifestSHA256})),run=state.runs[task.runId],ledger=state.budgets[task.budgetRef];
   const identities=manifest.plan?.identities;
   if(firstRound){validateFirstRoundDatasetMetadata(manifest,'research');if(identities.studentParentRef!==task.parentPolicyRef||!equal(identities.studentScorer,parent423!.parentIdentity)||!equal(identities.basePolicy,parent423!.basePolicyIdentity)||!equal(identities.migrationReceiptRef,parent423!.migrationReceiptRef)||!equal(identities.candidatePolicy,proposal!.candidatePolicy))throw Error('historical_formal_first_round_parent_conflict');}
   const frozen=firstRound?{dataset:task.datasetRefs[0],manifestSHA256:data.manifestSHA256,teacher:task.labelPolicyRef,B:task.outputSpec.proposalPolicyRef,parent:task.parentPolicyRef,parentIdentity:identities.studentScorer,proposalIdentity:identities.basePolicy,inputContract:identities.encoderConfig,encoder:identities.encoderVersion,candidate:identities.candidateSpecRef,candidatePolicy:identities.candidatePolicy,prompt:task.promptRef,recipe:task.learnerRecipe,sourceRevision:task.sourceRevision,runtimeRef:task.runtimeRef,phase:'formal',seed:ib.seed}:{dataset:task.datasetRefs[0],manifestSHA256:data.manifestSHA256,teacher:task.labelPolicyRef,B:task.parentPolicyRef,parentIdentity:parent.policyIdentity,encoder:manifest.plan?.identities?.encoderVersion,candidate:manifest.plan?.identities?.candidateSpecRef,prompt:task.promptRef,recipe:task.learnerRecipe,sourceRevision:task.sourceRevision,runtimeRef:task.runtimeRef,phase:'formal',seed:ib.seed};
   if(!equal(proposalIdentity,manifest.plan?.identities?.basePolicy)||!run||run.status!=='completed'||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.checkpoint?.executionUnknown===true||run.checkpoint?.active!=null||ledger?.activeRunId===run.runId||!equal(run.task,task)||run.taskRef!==taskRef||run.taskSHA256!==digest(task)||state.tasks[task.taskId]!==run.runId)throw Error('historical_formal_run_incomplete');
   const costs=consumptionFromCommittedState([state],task);if(COUNTERS.some(k=>costs.reserved[k]||costs.reservedUnknown[k]))throw Error('historical_formal_unresolved_consumption');
   // The original §36C boundary is fixed by dataset/Task, not by the
   // summary's self-reported max. This only reconciles completed facts; no
   // qualification, exposure or checkpoint-selection algorithm runs here.
   const Ndemo=manifest.qualification?.Ndemo,recipe=task.learnerRecipe;
   if(!firstRound&&(!Number.isSafeInteger(Ndemo)||Ndemo<1||recipe.demoBatch!==32||recipe.keepBatch!==32||recipe.maxEpochs!==3))throw Error('historical_formal_boundary_unavailable');
   const shape=firstRound?firstRoundTrainingShape(recipe,'formal',Ndemo,manifest.qualification?.Nkeep):null,Uepoch=firstRound?shape!.Uepoch:Math.ceil(Ndemo/recipe.demoBatch),total=firstRound?shape!.maxOptimizerSteps:recipe.maxEpochs*Uepoch;
   if(!Number.isSafeInteger(total)||summary.plan?.Uepoch!==Uepoch||(firstRound?(summary.plan.maxUpdates!==64||Object.hasOwn(summary.plan,'maxEpochs')||!equal(summary.plan.milestoneUpdates,[0,16,32,64])):summary.plan.maxEpochs!==recipe.maxEpochs)||summary.plan.maxOptimizerSteps!==total||summary.plan.effectiveBatch!==(firstRound?2*Ndemo:recipe.demoBatch+recipe.keepBatch)||summary.actual?.optimizerSteps!==total||list(run.committed).length!==total)throw Error('historical_formal_boundary_incomplete');
   const cp=c.read(c.file({path:logical(run.checkpointRef)}));
   if(digest(cp)!==run.checkpointSHA256||!equal(cp,run.checkpoint)||summary.schema!=='ohuo-supervised-summary-v1'||summary.trainingKind!=='supervised_rerank'||summary.runId!==run.runId||summary.taskSHA256!==digest(task)||!equal(summary.frozenRefs,frozen)||summary.plan?.phase!=='formal'||!equal(summary.plan.recipe,task.learnerRecipe)||summary.actual?.realTraining!==true||summary.actual.providerRequests!==0||!Number.isSafeInteger(summary.actual.optimizerSteps)||summary.actual.optimizerSteps<1||summary.actual.optimizerSteps!==summary.plan.maxOptimizerSteps||summary.actual.optimizerSteps!==cp.optimizerSteps||summary.actual.optimizerSteps!==costs.confirmed.optimizerSteps||!equal(summary.actual.latestCompleteCheckpoint,cp.studentCheckpoint)||!list(run.consumerArtifactRefs).some(ref=>equal(c.ref(ref),r.summaryRef)))throw Error('historical_formal_summary_conflict');
   // Follow only original committed digests, never a directory/latest scan.
   for(const [index,id] of list(run.committed).entries()){const reservation=ledger.reservations[id],committed=c.read(c.file({path:logical(task.outputRoot)+'/checkpoint-'+reservation.checkpointSHA256+'.json'}));if(reservation.runId!==run.runId||reservation.status!=='committed'||!equal(reservation.cost,{providerRequests:0,optimizerSteps:1,matchAttempts:0,labelDecisions:0})||digest(committed)!==reservation.checkpointSHA256||committed.taskSHA256!==digest(task)||committed.datasetSHA256!==data.manifestSHA256||committed.optimizerSteps!==index+1||committed.studentCheckpoint?.optimizerSteps!==index+1)throw Error('historical_formal_commit_conflict');}
   const selected=selection.selected;
   if(selection.schema!=='ohuo-student-selection-v1'||selection.rule!==(firstRound?'nav-r15-first-round-unique-checkpoint':'section-15-unique-checkpoint')||selection.status!=='selected'||!equal(selection.summary,r.summaryRef)||!equal(selection.behaviorReview,r.reviewRef)||!list(summary.selection?.allowedCheckpoints).some(m=>equal(m.checkpoint,selected))||!list(cp.milestones).some(m=>equal(m.checkpoint,selected))||review.schema!=='ohuo-distill-behavior-review-v1'||review.taskSHA256!==digest(task)||!list(review.reviews).some(row=>row.checkpointSHA256===selected?.manifestSHA256&&row.status==='accepted')||release.schema!==(firstRound?'ohuo-student-release-first-round-v3':'ohuo-student-release-v1')||release.trainingKind!=='supervised_rerank'||release.policyId!==request.policyId||!equal(release.selection,r.selectionRef)||release.proposer?.policyRef!==proposalPolicyRef||!equal(release.proposer?.identity,proposalIdentity)||release.checkpoint?.sha256!==selected?.manifestSHA256||release.checkpoint?.path!==logical(task.outputRoot)+'/'+selected?.path+'/manifest.json')throw Error('historical_formal_selection_conflict');
   if(firstRound){const actual=selectFirstRoundCheckpoint(summary.selection.allowedCheckpoints,review.reviews);if(!equal(actual,(({status,selected,reason,eligible})=>({status,selected,reason,eligible}))(selection))||!equal(list(cp.milestones).map(m=>m.checkpoint?.optimizerSteps),[0,16,32,64])||release.proposalRef!==task.outputSpec.proposalPolicyRef||release.learningParent?.ref!==task.parentPolicyRef||!equal(release.learningParent.scorer,parent423!.parentIdentity)||!equal(release.learningParent.migrationReceiptRef,parent423!.migrationReceiptRef)||!equal(release.candidatePolicy,proposal!.candidatePolicy)||release.scorer?.inputDim!==423)throw Error('historical_formal_first_round_selection_conflict');}
   for(const row of list(review.reviews))c.file(row.evidence);c.file({path:release.checkpoint.path,sha256:release.checkpoint.sha256});
   return {completionRef:doc.ref,requestRef:r.requestRef,prerequisiteReceiptRefs:prerequisites.map(x=>x.receiptRef),summaryRef:r.summaryRef,reviewRef:r.reviewRef,selectionRef:r.selectionRef,releaseRef:r.releaseRef};
  };
  for(const doc of assignments){
   const assignment=JSON.parse(doc.bytes.toString()),spec=get(assignment.specRef);if(spec.planRef!==planRef)continue;
   const receipt=get(assignment.receiptRef),failed=validateTask(get(spec.failedTaskRef)),ib=binding(spec.failedTaskRef),dataset=get(failed.datasetRefs[0]);
   const datasetManifest=raw(file({path:logical(ib.datasetDirectory)+'/manifest.json',sha256:dataset.manifestSHA256}));
   const actionTaskRefs=list(spec.roles).map(role=>{
    const action=actions.find((a:any)=>a.clauseRef===role.clauseRef&&a.branchRef===role.branchRef),matches=refs.filter(x=>action?.plannedTaskIds.includes(x.value.taskId)&&x.value.planScope?.clauseRef===role.clauseRef&&x.value.planScope?.branchRef===role.branchRef&&ibs.some(b=>b.taskRef===x.ref&&b.trainingPhase===role.phase));
    if(matches.length!==1)throw Error('numerical_recovery_original_action_template_conflict');return {clauseRef:role.clauseRef,branchRef:role.branchRef,taskRef:matches[0].ref};
   });
   const diagnoses:any[]=[{runId:spec.failedRunId,evidenceRef:receipt.numerical.inputImplementationReviewRef,metricsRef:receipt.numerical.metricsRef}];
   for(const role of spec.roles){const diagnostic=loaded.filter(e=>{try{const d=JSON.parse(e.bytes.toString());return d?.failedTaskId===role.taskId&&['diagnosed_numerical_divergence','first_epoch_demo_and_keep_increase'].includes(d.trigger);}catch{return false;}});
    if(diagnostic.length>1)throw Error('numerical_recovery_role_diagnosis_ambiguous');if(!diagnostic.length)continue;
    const d=JSON.parse(diagnostic[0].bytes.toString());let metricsRef=null;
    if(d.trigger==='first_epoch_demo_and_keep_increase'){const matches=loaded.filter(e=>{try{const m=JSON.parse(e.bytes.toString());return m?.failedTaskId===role.taskId&&m.update0&&m.firstEpoch;}catch{return false;}});if(matches.length!==1)throw Error('numerical_recovery_role_metrics_unavailable');metricsRef=matches[0].ref;}
    diagnoses.push({runId:role.runId,evidenceRef:diagnostic[0].ref,metricsRef});
   }
   const bindings={specRef:assignment.specRef,receiptRef:assignment.receiptRef,references:refs,inputBindings:ibs,controlRoot,rootInstanceId:host.rootInstanceId,grant:{...grant,controlRoot},assignmentFiles:assignments,datasetManifest,actionTaskRefs,evidence:loaded,calibrationEvidence,failureDiagnoses:diagnoses};
   const roleTasks=spec.roles.map((role:any)=>{const taskRef=assignment.roles.find((x:any)=>x.role===role.role)?.taskRef,task=validateTask(get(taskRef));if(!tasks.some(t=>equal(t,task))||!tasks.some(t=>equal(t,failed)))throw Error('numerical_recovery_task_inventory_incomplete');return {role,taskRef,task};});
   const view=inspectNumericalRecoveryEvidence({task:roleTasks[0].task,receipt,spec,assignment,approvedActions:actions,state,bindings});
   for(const {role,taskRef,task} of roleTasks){
    const lineage=view.roleLineage.find(x=>x.taskRef===taskRef&&x.role===role.role);if(!lineage)throw Error('numerical_recovery_lineage_missing');
    // Historical lineage comes ONLY from the shared inspector, never from
    // admitted, a global lifecycle string, or the current role's status.
    const lineageVerified=lineage.status==='verified-history',runStatus=state.runs[task.runId]?.status??'not_started';
    let historical:any=null;
    if(lineageVerified&&role.phase==='formal'&&runStatus==='completed'&&['stopped_by_original_rule','stopped_numerical'].includes(view.branch.status)){try{historical=historicalCompletion(task,taskRef);}catch(e:any){problem(e.message);}}
    const phaseComplete=lineageVerified&&runStatus==='completed'&&(role.phase==='calibration'?lineage.qualificationDiagnosticRef!==null:view.branch.status==='completed'||historical!==null);
    result.roles.push({taskId:task.taskId,runId:task.runId,taskRef,parentTaskId:task.parentTaskId,failedTaskId:failed.taskId,failedTaskRef:spec.failedTaskRef,case:spec.case,role:role.role,phase:role.phase,specRef:assignment.specRef,receiptRef:assignment.receiptRef,assignmentRef:doc.ref,assignmentVerified:true,originalTaskRef:actionTaskRefs.find(x=>x.clauseRef===role.clauseRef&&x.branchRef===role.branchRef)!.taskRef,runStatus,phaseComplete,historicalCompletion:historical,lineage,lineageVerified,branchStatus:view.branch.status,formalComplete:role.phase==='formal'&&phaseComplete,scientificQualification:null});
   }
   result.branches.push({specRef:assignment.specRef,receiptRef:assignment.receiptRef,assignmentRef:doc.ref,failedTaskRef:spec.failedTaskRef,...view});
   for(const issue of view.issues)problem('numerical_recovery:'+issue);
   if(['blocked_unknown','blocked_diagnosis'].includes(view.branch.status))problem('numerical_recovery_'+view.branch.status+':'+view.branch.reason);
  }
  for(const t of relevant)if(!result.roles.some((r:any)=>r.taskId===t.taskId))problem('numerical_recovery_assignment_missing:'+t.taskId);
 }catch(e:any){problem(e.message);}
 return result;
}

function consumptionFromCommittedState(states:any[],task:any){
 const matches=states.filter(s=>s.runs?.[task.runId]?.taskSHA256===digest(task));if(matches.length!==1)throw Error('distribution_consumption_state_missing_or_ambiguous');const state=matches[0],ledger=state.budgets?.[task.budgetRef];
 if(!ledger||ledger.planRef!==task.planRef||ledger.authorizationRef!==task.authorizationRef||state.tasks?.[task.taskId]!==task.runId)throw Error('distribution_consumption_budget_binding_conflict');
 validateCost(ledger.used);const zeros=()=>Object.fromEntries(COUNTERS.map(k=>[k,0])),allConfirmed=zeros(),view:any={confirmed:zeros(),reserved:zeros(),reservedUnknown:zeros(),released:zeros()};
 if(!ledger.reservations||Array.isArray(ledger.reservations))throw Error('distribution_consumption_reservations_missing');
 for(const [reservationId,reservation] of Object.entries(ledger.reservations) as any){const owner=state.runs?.[reservation.runId];if(!owner||owner.task?.budgetRef!==task.budgetRef||owner.task?.planRef!==task.planRef)throw Error('distribution_consumption_reservation_owner_conflict');validateCost(reservation.cost);if(!['committed','consumed','reserved','reserved_unknown','released'].includes(reservation.status))throw Error('distribution_consumption_unknown_reservation');const bucket=['committed','consumed'].includes(reservation.status)?'confirmed':reservation.status==='reserved_unknown'?'reservedUnknown':reservation.status==='reserved'?'reserved':'released';
  if((bucket==='confirmed')!==Boolean(owner.committed?.includes(reservationId)))throw Error('distribution_consumption_committed_conflict');
  for(const k of COUNTERS){if(bucket==='confirmed')allConfirmed[k]+=reservation.cost[k];if(reservation.runId===task.runId)view[bucket][k]+=reservation.cost[k];}
 }
 if(!equal(allConfirmed,ledger.used))throw Error('distribution_consumption_used_mismatch');return view;
}
/** Public-only binding for the named R16 union. The trusted source producer
 * performed private 423/replay checks; this exporter binds its immutable union
 * and original source/consumer journals, never rereads private labels/states or
 * certifies teacher agreement as truth. S0 AND S1 may supply the chosen origin. */
function validateFirstRoundDistribution(c:EvidenceCatalog,s:any,t:any,tasks:any[],history:any,states:any[],selection:any){
 const rule=c.get(t.scientificContract.decisionRuleRef);strict(rule,['schema','sourceSpecRef','selectionRef','comparisonRef','primaryLabelPolicyRef']);
 if(rule.schema!=='ohuo-first-round-new-test-label-contract-v1'||rule.selectionRef!==s.selectionRef||rule.comparisonRef!==t.scientificContract.comparisonRef||rule.primaryLabelPolicyRef!==t.labelPolicyRef||t.taskKind!=='collect'||t.sourcePlan.split!=='confirm'||t.operationScope.apiCalls!==true||t.operationScope.parameterUpdates||t.operationScope.deployment||t.limits.maxMatchAttempts!==0||t.limits.maxOptimizerSteps!==0)throw Error('first_round_distribution_task_contract');
 const spec=c.get(rule.sourceSpecRef),plan=c.get(spec.selectionPlanRef),queue=c.get(spec.queueRef),comparison=c.get(spec.comparisonRef);
 if(spec.schema!=='ohuo-first-round-new-test-source-v1'||spec.planRef!==t.planRef||spec.budgetRef!==t.budgetRef||spec.queueRef!==t.seatLayoutPlan||spec.sourceIndexRef!==t.sourcePlan.sourceIndexRef||spec.comparisonRef!==rule.comparisonRef||comparison.schema!=='ohuo-first-round-comparison-v1'||comparison.proposalRef!==t.parentPolicyRef||queue.schema!=='ohuo-complete-match-queue-v1'||queue.sourceIndexRef!==spec.sourceIndexRef||queue.namespace!==t.sourcePlan.namespace)throw Error('first_round_distribution_source_contract');
 if(selection.schema!=='ohuo-first-round-new-test-selection-result-v1'||!equal(selection.plan,plan)||plan.schema!=='ohuo-first-round-new-test-selection-v1'||plan.purpose!=='first-round-independent-new-test'||plan.sourceIndexRef!==spec.sourceIndexRef||plan.comparisonRef!==spec.comparisonRef||plan.s0Ref!==spec.s0Ref||plan.s1Ref!==spec.s1Ref||plan.maxQuestionsPerFamily!==8||selection.verification!=='reproduced'||selection.trainingEligible!==false||selection.returnToTraining!==false||list(plan.familyIds).length<1||plan.familyIds.length>2||!unique(plan.familyIds))throw Error('first_round_distribution_union_identity');
 if(!(selection.qualification?.eligible===true&&equal(selection.qualification.reasons,[])||plan.familyIds.length===1&&selection.qualification?.eligible===false&&equal(selection.qualification.reasons,['single_source_diagnostic_only'])))throw Error('first_round_distribution_union_qualification');
 const commits=c.files.flatMap(f=>{try{const v=c.read(f);return v.schema==='ohuo-first-round-new-test-selection-commit-v1'&&v.selectionRef===s.selectionRef&&v.sourceSpecRef===rule.sourceSpecRef?[v]:[];}catch{return [];}});
 if(commits.length!==1)throw Error('first_round_distribution_union_commit_missing');const commit=commits[0],request=c.get(commit.specRef);strict(commit,['schema','specRef','selectionRef','sourceSpecRef','files']);strict(request,['schema','planRef','clauseRef','branchRef','sourceIndexRef','queueRef','sourceRunRefs','targetDefinitionRef','selectionRuleRef','quotaBasisRef','purpose','actingReleaseRef','outputId','sourceSpecRef']);
 if(request.schema!=='ohuo-first-round-new-test-selection-spec-v1'||request.purpose!=='distribution_diagnostic'||request.sourceSpecRef!==rule.sourceSpecRef||request.planRef!==t.planRef||request.queueRef!==spec.queueRef||request.sourceIndexRef!==spec.sourceIndexRef||request.actingReleaseRef!==spec.s1Ref||request.selectionRuleRef!==spec.selectionPlanRef||!equal(request.sourceRunRefs,spec.sourceRunRefs)||list(commit.files).length!==2)throw Error('first_round_distribution_union_producer');
 const target='lab/out/'+request.outputId;if(!sameSet(commit.files.map((f:any)=>f.path),[target+'/selection.json',target+'/spec.json']))throw Error('first_round_distribution_union_files');
 for(const f of commit.files)if(!equal(c.get(f),f.path.endsWith('/selection.json')?selection:request))throw Error('first_round_distribution_union_committed_bytes');
 const sourceTasks=list(spec.sourceTaskRefs).map(r=>({ref:r,task:c.get(r)}));if(!sourceTasks.length||!unique(sourceTasks.map(x=>x.ref)))throw Error('first_round_distribution_source_tasks');
 for(const x of sourceTasks)if(!tasks.some(o=>equal(o,x.task))||x.task.planRef!==t.planRef||x.task.budgetRef!==t.budgetRef||x.task.taskKind!=='evaluate'||x.task.seatLayoutPlan!==spec.queueRef||x.task.sourcePlan.sourceIndexRef!==spec.sourceIndexRef||x.task.sourcePlan.split!=='confirm'||x.task.scientificContract.comparisonRef!==spec.comparisonRef||c.get(x.task.capabilityRef).id!=='B07.complete-match.v1')throw Error('first_round_distribution_original_source_task');
 const runs=states.flatMap(state=>Object.values(state.runs??{})).filter((r:any)=>spec.sourceTaskRefs.includes(r.taskRef)) as any[];
 const snapshots=list(spec.sourceRunRefs).map(r=>c.get(r));if(!sameSet(runs.map(r=>r.runId),snapshots.map(r=>r.runId))||sourceTasks.some(x=>!runs.some(r=>r.taskRef===x.ref)))throw Error('first_round_distribution_source_run_inventory');
 for(const run of runs){const saved=snapshots.find(s=>s.runId===run.runId);if(!['task','taskRef','taskSHA256','checkpoint','checkpointSHA256','checkpointRef','status','cleanupConfirmed'].every(k=>equal(run[k],saved[k]))||run.taskSHA256!==digest(run.task)||run.status!=='completed'||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.checkpoint?.schema!=='ohuo-match-run-v1'||run.checkpoint.active!==null||run.checkpoint.executionUnknown!==false||run.checkpoint.queueRef!==spec.queueRef||run.checkpointSHA256!==digest(run.checkpoint)||run.checkpoint.cursor!==list(run.checkpoint.matches).length)throw Error('first_round_distribution_source_run_binding');
  const consumption=consumptionFromCommittedState(states,run.task),state=states.find(state=>state.runs?.[run.runId]?.taskSHA256===run.taskSHA256);if(COUNTERS.some(k=>consumption.reserved[k]||consumption.reservedUnknown[k])||consumption.confirmed.matchAttempts<run.checkpoint.matches.length||state.budgets[run.task.budgetRef].activeRunId===run.runId||!equal(c.get({path:run.checkpointRef}),run.checkpoint))throw Error('first_round_distribution_source_execution_unknown');}
 const s0=c.get(spec.s0Ref),student=c.get(spec.s1Ref),releases=c.files.filter(f=>f.sha256===student.releaseSHA256),proposer=c.get(comparison.proposalRef),teacher=c.get(t.labelPolicyRef);
 if(s0.schema!=='ohuo-first-round-s0-release-ref-v1'||s0.proposalRef!==comparison.proposalRef||s0.studentParentRef!==comparison.studentParentRef||s0.policyId!=='first-round-s0-'+digest({proposalRef:s0.proposalRef,studentParentRef:s0.studentParentRef}).slice(0,16)||student.schema!=='ohuo-student-task-release-v1'||!releases.length||history.selectedStudentRef!==spec.s1Ref)throw Error('first_round_distribution_composite_identity');
 const release=c.read(releases[0]),selected=c.get(release.selection);
 if(release.schema!=='ohuo-student-release-first-round-v3'||release.trainingKind!=='supervised_rerank'||release.policyId!==student.policyId||release.proposalRef!==comparison.proposalRef||release.learningParent?.ref!==comparison.studentParentRef||release.scorer?.inputDim!==423||!equal(release.proposer?.identity,proposer.policyIdentity)||selected.schema!=='ohuo-student-selection-v1'||selected.rule!=='nav-r15-first-round-unique-checkpoint'||selected.status!=='selected'||selected.selected?.manifestSHA256!==release.checkpoint?.sha256)throw Error('first_round_distribution_selected_S1');
 const decisions:any[]=[],denominators=list(selection.denominators),sourceOwners=new Map<string,string>(),familyOwners=new Map<string,string>(),layouts=new Set<string>();
 if(list(queue.rows).length!==plan.familyIds.length*12||denominators.length!==queue.rows.length)throw Error('first_round_distribution_source_population');
 for(const q of queue.rows){
  const layout=canonical([q.sourceFamilyId,q.variant,q.group,q.side]);if(layouts.has(layout)||!plan.familyIds.includes(q.sourceFamilyId)||!['S0','S1'].includes(q.variant)||![0,1,2].includes(q.group)||![0,1].includes(q.side)||q.actor!==q.side||q.split!=='confirm'||q.maxGames!==80||q.maxMovesPerGame!==2500||q.roundFamilyIds.length!==80||q.roundFamilyIds[0]!==q.sourceFamilyId||q.seats[q.actor]?.releaseRef!==(q.variant==='S0'?spec.s0Ref:spec.s1Ref))throw Error('first_round_distribution_original_layout');layouts.add(layout);
  const matches=runs.flatMap(run=>run.checkpoint.matches.filter((m:any)=>m.matchId===q.matchId).map((m:any)=>({run,m})));if(matches.length!==1)throw Error('first_round_distribution_source_attempt_ambiguity');const {run,m}=matches[0];
  if(!run.task.sourcePlan.familyIds.includes(q.sourceFamilyId)||q.roundFamilyIds.some((f:string)=>!run.task.sourcePlan.familyIds.includes(f)))throw Error('first_round_distribution_source_task_ancestry');
  const id=c.get({path:join(m.recordRef.directory,'identity.json'),sha256:m.recordRef.identitySHA256}),eventFile=c.file({path:join(m.recordRef.directory,'events.jsonl'),sha256:m.recordRef.journalSHA256}),bytes=readFileSync(eventFile.localPath);
  const original=readB07PublicRecord(run.task.outputRoot,{runId:run.runId,queueRef:spec.queueRef},m);
  if(!original.recordVerified||!original.complete||original.issues.length||bytes.length!==m.recordRef.journalBytes||id.sourceFamilyId!==q.sourceFamilyId||id.sourceRef!==spec.sourceIndexRef||id.layoutRef!==spec.queueRef||id.runId!==run.runId||id.matchId!==q.matchId||id.split!=='confirm'||id.evaluatedActor!==q.actor)throw Error('first_round_distribution_public_source_record');
  const events=bytes.toString().split('\n').filter(Boolean).map(line=>JSON.parse(line)),games=events.filter(e=>e.type==='game').map(e=>e.value),terminal=new Map<string,any>();for(const e of events)if(e.type==='decision')terminal.set(canonical(e.value.key),e.value);
  const denom=denominators.filter(d=>d.familyId===q.sourceFamilyId&&d.reachedBy===q.variant&&d.group===q.group&&d.side===q.side);if(denom.length!==1||denom[0].status!=='completed'||denom[0].sourceSHA256!==games[0]?.sourceSHA256||!equal(denom[0].sourceFacts,games.map(g=>({familyId:g.sourceFamilyId,sourceSHA256:g.sourceSHA256}))))throw Error('first_round_distribution_source_facts');
  for(const [i,g] of games.entries()){if(g.gameNo!==i+1||g.sourceFamilyId!==q.roundFamilyIds[i]||! /^[a-f0-9]{64}$/.test(g.sourceSHA256)||plan.excludedFamilyIds.includes(g.sourceFamilyId)||plan.excludedSourceSHA256.includes(g.sourceSHA256)||sourceOwners.has(g.sourceSHA256)&&sourceOwners.get(g.sourceSHA256)!==q.sourceFamilyId||familyOwners.has(g.sourceFamilyId)&&familyOwners.get(g.sourceFamilyId)!==q.sourceFamilyId)throw Error('first_round_distribution_actual_source_independence');sourceOwners.set(g.sourceSHA256,q.sourceFamilyId);familyOwners.set(g.sourceFamilyId,q.sourceFamilyId);}
  const seat=id.seatSnapshots?.[q.actor];if(seat?.releaseRef!==q.seats[q.actor].releaseRef||id.policyIds[q.actor]!==(q.variant==='S0'?s0.policyId:student.policyId)||seat.firstRoundCapture?.studentParentRef!==comparison.studentParentRef||seat.firstRoundCapture?.scorer?.inputDim!==423||!equal(seat.policyIdentity,proposer.policyIdentity)||(q.variant==='S0'?!equal(seat.s0Release,s0):seat.studentReleaseSHA256!==student.releaseSHA256||!equal(seat.studentRelease,release)))throw Error('first_round_distribution_public_composite_capture');
  for(const d of terminal.values())if(d.key.actorSeat===q.actor&&d.executionKind==='confirmed'){
   if(d.policyId!==id.policyIds[q.actor]||d.actualSource!=='S')throw Error('first_round_distribution_actual_composite_action');
   decisions.push({q,seat,d,decisionId:`${q.matchId}-g${d.key.gameNo}-m${d.key.moveNo}-q${d.key.requestSeq}`});
  }
 }
 const questions=list(selection.questions);if(!unique(questions.map(q=>q.questionId))||questions.some(q=>!plan.familyIds.includes(q.familyId))||plan.familyIds.some((f:string)=>questions.filter(q=>q.familyId===f).length>8))throw Error('first_round_distribution_union_question_scope');
 for(const q of questions){if(!list(q.origins).length||q.candidateSpec!=='first-target-offer12-v1'||! /^[a-f0-9]{64}$/.test(q.featuresSHA256))throw Error('first_round_distribution_union_candidate_identity');for(const o of q.origins){const matches=decisions.filter(d=>d.q.sourceFamilyId===q.familyId&&d.decisionId===o.questionId&&d.d.trainingInputSHA256===o.inputSHA256&&d.q.variant===o.reachedBy&&d.q.group===o.group&&d.q.side===o.side&&equal(d.d.initialCandidateIds,o.candidateIds));if(matches.length!==1)throw Error('first_round_distribution_union_original_origin');}}
 const owned=questions.filter(q=>t.sourcePlan.familyIds.includes(q.familyId));if(owned.length!==s.total||s.total>16||t.limits.maxLabelDecisions!==s.total||t.limits.maxProviderRequests<1||t.limits.maxProviderRequests>s.total||t.sourcePlan.familyIds.some((f:string)=>!owned.some(q=>q.familyId===f))||!unique(s.rows.map((r:any)=>r.key)))throw Error('first_round_distribution_owned_union');
 for(const [i,r] of s.rows.entries()){
  strict(r,['key','inputSHA256','familyId','blockFamilyId','split','actorSeat','actingPolicyId','proposalPolicyIdentity','actingReleaseRef','studentReleaseSHA256','scorerWeightsSHA256','studentCheckpointSHA256','actualActionId','teacherActionId','teacherReleaseRef','inInitialCandidateSet','actionAgreement','status','reason','labelKind','requestCount','resultRef']);
  const question=owned[i],origin=question.origins[0],source=decisions.find(d=>d.q.sourceFamilyId===question.familyId&&d.decisionId===origin.questionId&&d.d.trainingInputSHA256===origin.inputSHA256)!;const {q,seat,d}=source;
  if(!equal(r.key,d.key)||r.inputSHA256!==d.trainingInputSHA256||r.blockFamilyId!==q.sourceFamilyId||r.familyId!==q.roundFamilyIds[d.key.gameNo-1]||r.split!=='confirm'||r.actorSeat!==q.actor||r.actingPolicyId!==d.policyId||r.actingReleaseRef!==seat.releaseRef||!t.releaseRefs.includes(r.actingReleaseRef)||r.actualActionId!==d.actualActionId||!equal(r.proposalPolicyIdentity,proposer.policyIdentity)||r.teacherReleaseRef!==teacher.releaseRef)throw Error('first_round_distribution_original_row');
  if(r.studentReleaseSHA256!==(seat.studentReleaseSHA256??null)||r.scorerWeightsSHA256!==(seat.studentRelease?.scorer?.weightsSHA256??null)||r.studentCheckpointSHA256!==(seat.studentRelease?.checkpoint?.sha256??null))throw Error('first_round_distribution_actual_scorer_identity');
  for(const k of ['actualActionId','status'])nonempty(r[k]);if(r.requestCount!==null&&(!Number.isSafeInteger(r.requestCount)||r.requestCount<0)||![null,true,false].includes(r.inInitialCandidateSet)||!['offline_suggested',null].includes(r.labelKind)||![null,true,false].includes(r.actionAgreement)||r.teacherActionId!==null&&r.actionAgreement!==(r.actualActionId===r.teacherActionId))throw Error('first_round_distribution_transfer_fact');
  strict(r.resultRef,['path','sha256']);if(!r.resultRef||! /^[a-f0-9]{64}$/.test(r.resultRef.sha256)||typeof r.resultRef.path!=='string')throw Error('distribution_private_result_index_missing');
  // Provenance only: never read or export r.resultRef private teacher labels.
 }
}

function validateDistribution(c:EvidenceCatalog,s:any,tasks:any[],history:any,states:any[],source:FixedRef){
 strict(s,['schema','runId','taskSHA256','selectionRef','purpose','cursor','total','rows','executionUnknown','consumption','interpretation']);
 const t=tasks.find(t=>t.runId===s.runId&&digest(t)===s.taskSHA256);if(!t||s.schema!=='ohuo-offline-label-summary-v1'||s.purpose!=='distribution_diagnostic'||!t.datasetRefs.includes(s.selectionRef))throw Error('distribution_summary_task_identity_conflict');
 nonempty(s.interpretation);if(s.executionUnknown===true||s.cursor!==s.total)throw Error('distribution_execution_incomplete');if(!Number.isSafeInteger(s.cursor)||s.cursor<0||!Number.isSafeInteger(s.total)||s.total<1||s.total>64||list(s.rows).length!==s.cursor||s.cursor>s.total||typeof s.executionUnknown!=='boolean')throw Error('distribution_summary_cursor_or_scope_conflict');
 for(const bucket of ['confirmed','reserved','reservedUnknown','released'])validateCost(s.consumption?.[bucket]);
 if(!equal(s.consumption,consumptionFromCommittedState(states,t)))throw Error('distribution_consumption_fixed_run_conflict');
 // This evidence may be separate from allTaskRuns' M0 projection: bind its
 // own exact public bytes to the same frozen run, not just matching headers.
 const committedRun=states.find(state=>state.runs?.[t.runId]?.taskSHA256===digest(t)).runs[t.runId];
 if(!list(committedRun.consumerArtifactRefs).some((ref:any)=>{try{return c.file(ref).sha256===source.sha256;}catch{return false;}}))throw Error('distribution_summary_state_artifact_conflict');
 const selection=c.get(s.selectionRef);if(selection.schema==='ohuo-first-round-new-test-selection-result-v1'){validateFirstRoundDistribution(c,s,t,tasks,history,states,selection);return;}
 const queue=c.get(t.seatLayoutPlan),proposer=c.get(t.parentPolicyRef),teacher=c.get(t.labelPolicyRef);
 if(selection.schema!=='ohuo-offline-label-selection-v1'||selection.purpose!==s.purpose||selection.selectedCount!==s.total||list(selection.rows).length!==s.total||selection.queueRef!==t.seatLayoutPlan||selection.sourceIndexRef!==t.sourcePlan.sourceIndexRef||queue.sourceIndexRef!==selection.sourceIndexRef)throw Error('distribution_frozen_selection_conflict');
 if(!unique(s.rows.map((r:any)=>r.key)))throw Error('distribution_duplicate_decision');
 for(const [i,r] of s.rows.entries()){
  strict(r,['key','inputSHA256','familyId','split','actorSeat','actingPolicyId','proposalPolicyIdentity','actingReleaseRef','studentReleaseSHA256','scorerWeightsSHA256','studentCheckpointSHA256','actualActionId','teacherActionId','teacherReleaseRef','inInitialCandidateSet','actionAgreement','status','reason','labelKind','requestCount','resultRef']);
  const frozen=selection.rows[i],q=list(queue.rows).find(q=>q.matchId===r.key?.matchId),seat=q?.seats?.[r.actorSeat];
  if(!['key','inputSHA256','familyId','split','actorSeat'].every(k=>equal(r[k],frozen[k]))||!['train','dev'].includes(r.split)||r.split!==t.sourcePlan.split||!t.sourcePlan.familyIds.includes(r.familyId)||q?.actor!==r.actorSeat||q?.roundFamilyIds?.[r.key.gameNo-1]!==r.familyId||q?.split!==r.split||seat?.releaseRef!==r.actingReleaseRef||seat.mode!=='local'||seat.profileRevisionRef!==null)throw Error('distribution_queue_source_actor_conflict');
  if(history.selectedStudentRef!==r.actingReleaseRef||!t.releaseRefs.includes(r.actingReleaseRef)||!equal(r.proposalPolicyIdentity,proposer.policyIdentity)||r.teacherReleaseRef!==teacher.releaseRef)throw Error('distribution_B_or_teacher_identity_conflict');
  const student=c.get(r.actingReleaseRef),matches=c.files.filter(f=>f.sha256===student.releaseSHA256);if(student.schema!=='ohuo-student-task-release-v1'||matches.length!==1)throw Error('distribution_student_release_unavailable');const release=c.read(matches[0]);
  if(release.schema!=='ohuo-student-release-v1'||release.trainingKind!=='supervised_rerank'||student.policyId!==r.actingPolicyId||release.policyId!==r.actingPolicyId||student.releaseSHA256!==r.studentReleaseSHA256||release.scorer?.weightsSHA256!==r.scorerWeightsSHA256||release.checkpoint?.sha256!==r.studentCheckpointSHA256||!equal(release.proposer?.identity,r.proposalPolicyIdentity))throw Error('distribution_S_checkpoint_identity_conflict');
  const selected=c.get(release.selection);if(selected.schema!=='ohuo-student-selection-v1'||selected.rule!=='section-15-unique-checkpoint'||selected.status!=='selected'||selected.selected?.manifestSHA256!==r.studentCheckpointSHA256)throw Error('distribution_unique_S_selection_conflict');
  for(const k of ['actualActionId','status'])nonempty(r[k]);if(r.requestCount!==null&&(!Number.isSafeInteger(r.requestCount)||r.requestCount<0))throw Error('distribution_request_count_invalid');
  if(![null,true,false].includes(r.inInitialCandidateSet)||!['offline_suggested',null].includes(r.labelKind)||![null,true,false].includes(r.actionAgreement)||r.teacherActionId!==null&&(r.actionAgreement!==(r.actualActionId===r.teacherActionId)))throw Error('distribution_candidate_agreement_conflict');
  strict(r.resultRef,['path','sha256']);if(!r.resultRef||!/^[a-f0-9]{64}$/.test(r.resultRef.sha256)||typeof r.resultRef.path!=='string')throw Error('distribution_private_result_index_missing');
  // resultRef is provenance ONLY. Never resolve/read/export private labels.
 }
}

/** Read-only C01: a mechanical candidate, never a host closure authorization. */
export function rebuildPlanCloseout(spec:any,output:string){
 strict(spec,['plan','controlStates','taskFiles','packageManifests','analyses','facts']);output=checkedOutput(output);
 if(existsSync(join(output,'manifest.json')))throw Error('new package output required');
 const facts=structuredClone(spec.facts) as EvidenceFacts;if(facts.question!=='plan_closeout')throw Error('closeout requires fixed plan_closeout question');
 const c=new EvidenceCatalog(facts),planFile=c.byBytes(spec.plan),original=c.read(planFile);
 const originalContext=received(c,facts,'planContext');fixedReference(originalContext.planRef,'original planRef');
 const planRef=originalContext.planRef;if(planRef.slice(planRef.lastIndexOf(':')+1)!==digest(original))throw Error('approved_plan_canonical_identity_conflict');
 if(!Number.isSafeInteger(original.planVersion)||original.planVersion<1)throw Error('original planVersion required');
 const problems:string[]=[],completionProblems:string[]=[],deviations:any[]=[],add=(s:string)=>{if(!problems.includes(s))problems.push(s);};
 const tryRead=(label:string,fn:()=>any)=>{try{return fn();}catch(e:any){add(label+':'+e.message);return null;}};
 const getRequired=(id:string)=>tryRead(id,()=>received(c,facts,id));
 const context=getRequired('planContext'),accounting=getRequired('stageAccounting'),budgetStop=getRequired('budgetStop');
 const parentPackageRefs=context?.parentPackageRefs??[];
 const packagePlan:PackagePlan={question:'plan_closeout',refs:{plan:{id:planFile.id,sha256:planFile.sha256},authorization:null,selectionHistory:requirement(facts,'selectionHistory')?.source??null,sourceIndex:requirement(facts,'sourceIndex')?.source??null,conditions:requirement(facts,'conditions')?.source??null},parentPackageRefs};
 const bindings=validateHandoffBindings(packagePlan,{},facts);
 for(const id of ['planContext','priorDecision','acceptedProgram','allTaskRuns'])if(requirement(facts,id)?.status!=='received')add('execution_evidence_unavailable:'+id);
 // Missing scientific records are retained outside the strict execution entity.
 // Its unresolved arrays have the same execution meaning as M0-H 4980b88d.
 const scienceOnly=new Set(['selectionHistory','sourceIndex','conditions','pairing','confirmationIsolation','newDistribution','teacherConclusion','dataset','training','waiting','behaviorRegression','screening']);
 for(const issue of bindings.issues){
  // A known failed recovery calibration has no qualified formal parent. That
  // scientific absence blocks completion, but cannot fabricate unknown costs
  // when all actual runs/ledgers and the original stop are independently known.
  if(issue.evidenceId==='numericalRecovery'&&issue.reason==='numerical_recovery:qualification:public_qualification_missing')completionProblems.push(issue.evidenceId+':'+issue.reason);
  else if(!scienceOnly.has(issue.evidenceId)&&!issue.evidenceId.startsWith('private:'))add(issue.evidenceId+':'+issue.reason);
 }
 if(bindings.issues.some(x=>x.evidenceId==='numericalRecovery'))scienceOnly.add('numericalRecovery');
 const manifestFiles=list(spec.packageManifests).map((x:any)=>tryRead('package_manifest',()=>c.byBytes(x))).filter(Boolean) as EvidenceFile[];
 for(const f of manifestFiles){const m=c.read(f);if(m.packageId!==f.id||!(m.planRef===planRef||equal(m.planRef,packagePlan.refs.plan)))add('package_manifest_plan_or_id_conflict:'+f.id);
  for(const p of m.parentPackageRefs??[])if(!manifestFiles.some(f=>f.id===p.id&&f.sha256===p.sha256))add('package_parent_unavailable:'+f.id);
  for(const e of m.files??[])tryRead('package_file:'+f.id,()=>c.file({id:e.id??e.artifact,sha256:e.sha256}));
 }
 for(const p of parentPackageRefs)if(!manifestFiles.some(f=>f.id===p.id&&f.sha256===p.sha256))add('context_parent_manifest_missing:'+p.id);
 const analysisIds=new Set<string>(),decisionIds=new Set<string>(),analyses:any[]=[];
 for(const specRef of list(spec.analyses)){tryRead('analysis',()=>{const f=c.byBytes(specRef),a=c.read(f);nonempty(a.analysisId);nonempty(a.decision_id);
   if(analysisIds.has(a.analysisId)||decisionIds.has(a.decision_id))throw Error('duplicate_analysis_or_decision_id');analysisIds.add(a.analysisId);decisionIds.add(a.decision_id);
   if(a.planRef!==planRef||!a.inputPackageRef||a.inputManifestSHA!==a.inputPackageRef.sha256||!manifestFiles.some(f=>f.id===a.inputPackageRef.id&&f.sha256===a.inputManifestSHA)||!['CONTINUE_APPROVED_PLAN','BLOCKED','INCOMPLETE','PROPOSE_CHANGE_ONLY','STOP_AND_DISCUSS_NEW_PLAN'].includes(a.disposition))throw Error('analysis_plan_input_or_disposition_conflict');
   for(const tr of list(a.taskFileRefs)){const t=validateTask(c.get(tr));if(t.planRef!==planRef)throw Error('analysis_task_plan_conflict');}
   for(const action of list(a.orderedActions))for(const tr of list(action.taskFileRefs)){const t=validateTask(c.get(tr));if(!a.taskFileRefs.includes(tr)||t.planScope.clauseRef!==action.clauseRef||t.planScope.branchRef!==action.branchRef||a.allowedPlanClause!==action.clauseRef||a.allowedBranchRef!==action.branchRef)throw Error('analysis_ordered_action_task_conflict');}
   analyses.push({ref:{id:f.id,sha256:f.sha256},analysisId:a.analysisId,decision_id:a.decision_id,disposition:a.disposition});
   if(a.priorDecisionRef!==null)c.get(a.priorDecisionRef);
  });}
 if(context?.priorDecisionRef&&!list(spec.analyses).some((r:any)=>r.sha256===context.priorDecisionRef.sha256))add('prior_analysis_not_in_all_analyses');
 const indexedActions=original.actions??(original.actionsRef?tryRead('plan_actions_attachment',()=>c.get(original.actionsRef))?.actions:null);
 const actions:any[]=[];if(!Array.isArray(indexedActions)||!indexedActions.length)add('plan_actions_missing');
 const actionKeys=new Set<string>(),plannedIds=new Set<string>();
 for(const a of indexedActions??[]){tryRead('plan_action',()=>{
   strict(a,['clauseRef','branchRef','plannedTaskIds','dependencyRefs','expectedArtifactKinds','acceptanceRuleRef','skipRuleRef','stopRuleRef']);fixedReference(a.clauseRef,'action.clauseRef');if(a.branchRef!==null)fixedReference(a.branchRef,'action.branchRef');
   if(actionKeys.has(actionKey(a)))throw Error('duplicate_original_action');actionKeys.add(actionKey(a));
   for(const id of list(a.plannedTaskIds)){nonempty(id);if(plannedIds.has(id))throw Error('task_planned_twice');plannedIds.add(id);}
   list(a.expectedArtifactKinds).forEach(nonempty);if(!a.expectedArtifactKinds.length)throw Error('expected_artifact_kinds_missing');
   for(const r of [...list(a.dependencyRefs),a.acceptanceRuleRef,...(a.skipRuleRef?[a.skipRuleRef]:[]),...(a.stopRuleRef?[a.stopRuleRef]:[])])c.get(r);
   actions.push(a);
  });}
 if(accounting?.planRef!==planRef)add('stage_accounting_plan_conflict');if(budgetStop?.planRef!==planRef)add('budget_stop_plan_conflict');
 if(accounting){const keys=list(accounting.actions).map(actionKey);if(!unique(keys))add('duplicate_stage_accounting_action');for(const key of keys)if(!actionKeys.has(key))add('extra_stage_accounting_action');}
 const tasks=new Map<string,{task:any;ref:string;file:EvidenceFile}>();
 for(const tRef of list(spec.taskFiles))tryRead('task_file',()=>{const f=c.byBytes(tRef),task=validateTask(c.read(f)),ref=referenceOf(f.id,task);if(task.planRef!==planRef||task.planVersion!==original.planVersion)throw Error('task_plan_version_conflict');if(tasks.has(task.taskId))throw Error('duplicate_task_file');tasks.set(task.taskId,{task,ref,file:f});});
 if(context&&!sameSet([...tasks.values()].map(x=>x.ref),list(context.taskFileRefs)))add('context_task_file_set_conflict');
 const stateFiles:EvidenceFile[]=[],roots=new Map<string,any>();
 for(const stateSpec of list(spec.controlStates))tryRead('control_state',()=>{
  const f=c.byBytes(stateSpec),s=c.read(f);if(stateFiles.some(x=>x.id===f.id&&x.sha256===f.sha256))return;
  if(s.schemaVersion!==1||!s.tasks||!s.runs||!s.budgets||!s.batches)throw Error('committed_state_incomplete');nonempty(s.rootInstanceId);
  if(roots.has(s.rootInstanceId))throw Error('conflicting_snapshot_same_control_root');roots.set(s.rootInstanceId,s);stateFiles.push(f);
 });
 if(!Array.isArray(original.controlRoots)||!sameSet([...roots.keys()],rootIds(original)))add('registered_control_root_scope_incomplete');
 const allRuns=getRequired('allTaskRuns');if(allRuns&&!sameSet(list(allRuns.controlStateRefs),stateFiles.map(f=>({id:f.id,sha256:f.sha256}))))add('all_task_runs_control_state_set_conflict');
 const snapshots=new Map<string,{ref:FixedRef;run:any}>();for(const r of allRuns?.runRefs??[])tryRead('run_snapshot',()=>{const run=c.get(r);if(snapshots.has(run.runId))throw Error('duplicate_run_snapshot');snapshots.set(run.runId,{ref:c.ref(r),run});});
 const attempts:any[]=[],attemptByRun=new Map<string,any>(),ledgers=new Map<string,any>(),taskRunIds=new Map<string,string>();
 const zero=()=>Object.fromEntries(COUNTERS.map(k=>[k,0]));
 for(const f of stateFiles){const s=c.read(f),stateRef={id:f.id,sha256:f.sha256};
  for(const [id,runId] of Object.entries(s.tasks)){
   if(!s.runs[runId as string]){add('missing_run:'+id+':'+runId);if(tasks.has(id)){const t=tasks.get(id)!;const a={taskId:id,runId,attemptId:t.task.attemptId,parentTaskId:t.task.parentTaskId,taskFileRef:t.ref,runRef:null,stateRef,status:'unknown',stopReason:null,failureReason:null,committed:null,checkpointRef:null,artifactRefs:[],executionUnknown:true,consumption:null};attempts.push(a);attemptByRun.set(runId as string,a);}}
   if(tasks.has(id)){if(taskRunIds.has(id)&&taskRunIds.get(id)!==runId)add('task_registered_in_multiple_roots:'+id);taskRunIds.set(id,runId as string);}
  }
  for(const [runId,r] of Object.entries(s.runs) as any){if(r.task?.planRef!==planRef)continue;const own:string[]=[],problem=(v:string)=>{own.push(v);add(v+':'+runId);};
   let t:any;try{t=validateTask(r.task);}catch{problem('invalid_persisted_task');t=r.task;}
   const fixed=tasks.get(t.taskId),snapshot=snapshots.get(runId);
   if(!fixed||!equal(fixed.task,t)||r.taskSHA256!==digest(t)||r.taskRef!==fixed.ref||r.runId!==runId||s.tasks[t.taskId]!==runId)problem('run_task_identity_conflict');
   if(attemptByRun.has(runId))problem('duplicate_run_registration');
   if(!snapshot||!matchesRunSnapshot(snapshot.run,r,c,snapshot.ref))problem('missing_or_conflicting_run_snapshot');
   if(!['completed','failed','interrupted'].includes(r.status)||r.cleanupConfirmed!==true||r.executionUnknown===true||snapshot?.run.executionUnknown===true||snapshot?.run.observationStatus==='unknown')problem('active_or_unknown_execution');
   if(!Array.isArray(r.committed)||!unique(r.committed))problem('committed_reservation_index_invalid');
   const artifactRefs:FixedRef[]=[];
   for(const ref of r.consumerArtifactRefs??[])try{artifactRefs.push(c.ref(ref));}catch{problem('run_product_unavailable');}
   let checkpointRef:FixedRef|null=null;
   if(r.checkpointRef!==null){try{const cf=c.file({path:r.checkpointRef}),cp=c.read(cf);if(digest(cp)!==r.checkpointSHA256||!equal(cp,r.checkpoint))throw Error('checkpoint_conflict');checkpointRef=c.ref({id:cf.id,sha256:cf.sha256});}catch{problem('checkpoint_identity_conflict');}}
   else if(r.committed?.length)problem('committed_progress_without_checkpoint');
   const a={taskId:t.taskId,runId,attemptId:t.attemptId,parentTaskId:t.parentTaskId,retryReasonRef:t.retryReasonRef,taskFileRef:fixed?.ref??r.taskRef,runRef:snapshot?.ref??null,stateRef,status:r.status,stopReason:r.stopReason??null,failureReason:r.failureReason??null,committed:r.committed??null,checkpointRef,artifactRefs,executionUnknown:own.length>0,consumption:null,issues:own};attempts.push(a);attemptByRun.set(runId,a);
   const batch=s.batches[t.researchBatchId],ledger=s.budgets[t.budgetRef];if(!batch||batch.budgetRef!==t.budgetRef||batch.planRef!==planRef||batch.authorizationRef!==t.authorizationRef||!ledger||ledger.researchBatchId!==t.researchBatchId||ledger.authorizationRef!==t.authorizationRef)problem('run_original_budget_binding_conflict');
  }
  for(const [ref,l] of Object.entries(s.budgets) as any){if(l.planRef!==planRef)continue;
   if(ledgers.has(ref)){if(!equal(ledgers.get(ref).raw,l)||ledgers.get(ref).rootInstanceId!==s.rootInstanceId)add('budget_conflicting_snapshot_or_root_owner:'+ref);continue;}
   const b:any={budgetRef:ref,rootInstanceId:s.rootInstanceId,raw:l,source:stateRef,issues:[],buckets:{confirmed:zero(),reserved:zero(),reservedUnknown:zero(),released:zero()},runViews:new Map<string,any>()};ledgers.set(ref,b);
   const problem=(v:string)=>{b.issues.push(v);add(v+':'+ref);};
   try{const declared=c.get(ref),rootRegistration=original.controlRoots.find((x:any)=>(typeof x==='string'?x:x.rootInstanceId)===s.rootInstanceId),controlRoot=typeof rootRegistration==='string'?rootRegistration:rootRegistration?.controlRoot;
    if(declared.planRef!==planRef||declared.authorizationRef!==l.authorizationRef||declared.researchBatchId!==l.researchBatchId||declared.controlRoot!==controlRoot||!equal(declared.limits,l.limits))throw Error('original_budget_binding_conflict');validateLimits(l.limits);validateCost(l.used);if(!l.reservations||Array.isArray(l.reservations)||!Object.hasOwn(l,'activeRunId')||!Number.isFinite(l.elapsedSeconds)||l.elapsedSeconds<0)throw Error('incomplete_ledger');}catch{problem('budget_state_incomplete');continue;}
   if(l.activeRunId!==null){problem('budget_active_run');if(!s.runs[l.activeRunId]||s.runs[l.activeRunId].task?.budgetRef!==ref)problem('budget_active_owner_conflict');}
   for(const [reservationId,res] of Object.entries(l.reservations) as any){
    try{validateCost(res.cost);if(!['committed','consumed','reserved','reserved_unknown','released'].includes(res.status))throw Error('status');}catch{problem('reservation_cost_or_status_unknown');continue;}
    const bucket=['committed','consumed'].includes(res.status)?'confirmed':res.status==='reserved_unknown'?'reservedUnknown':res.status==='reserved'?'reserved':'released';
    let view=b.runViews.get(res.runId);if(!view){view={confirmed:zero(),reserved:zero(),reservedUnknown:zero(),released:zero()};b.runViews.set(res.runId,view);}for(const k of COUNTERS){b.buckets[bucket][k]+=res.cost[k];view[bucket][k]+=res.cost[k];}
    const r=s.runs[res.runId];if(!r||r.task?.planRef!==planRef||r.task?.budgetRef!==ref)problem('reservation_run_missing_or_wrong_owner');
    if(bucket==='confirmed'&&!r?.committed?.includes(reservationId)||bucket!=='confirmed'&&r?.committed?.includes(reservationId))problem('run_committed_reservation_mismatch');
    if(bucket==='reserved'||bucket==='reservedUnknown')problem('unsettled_reservation');
   }
   for(const [runId,r] of Object.entries(s.runs) as any){if(r.task?.budgetRef!==ref)continue;for(const id of r.committed??[])if(!l.reservations[id]||l.reservations[id].runId!==runId||!['committed','consumed'].includes(l.reservations[id].status))problem('committed_reservation_missing');}
   for(const k of COUNTERS){if(b.buckets.confirmed[k]!==l.used[k])problem('ledger_used_confirmed_mismatch');if(l.used[k]+b.buckets.reserved[k]+b.buckets.reservedUnknown[k]>l.limits[LIMITS[k]])problem('budget_allocation_conflict');}
  }
 }
 for(const [id,s] of snapshots)if(!attemptByRun.has(id))add('extra_unregistered_run_snapshot:'+id);
 for(const a of attempts){const t=tasks.get(a.taskId)?.task,b=t&&ledgers.get(t.budgetRef);if(!b){add('run_budget_missing:'+a.runId);a.executionUnknown=true;continue;}a.consumption=b.runViews.get(a.runId)??{confirmed:zero(),reserved:zero(),reservedUnknown:zero(),released:zero()};
  const observed=snapshots.get(a.runId)?.run.consumption;if(observed&&!equal(observed,a.consumption)){add('snapshot_run_consumption_mismatch:'+a.runId);a.executionUnknown=true;}
 }
 const belongs=(t:any,a:any)=>t.planScope.clauseRef===a.clauseRef&&t.planScope.branchRef===a.branchRef;
 for(const {task:t} of tasks.values()){
  const a=actions.find(a=>belongs(t,a));if(!a){deviations.push({taskId:t.taskId,runId:t.runId,reason:'extra_task_outside_original_actions'});add('extra_task:'+t.taskId);continue;}
  if(!sameSet(t.planScope.prerequisiteRefs,a.dependencyRefs))add('task_original_dependency_conflict:'+t.taskId);
  if(t.stopPolicy!==original.stopPolicy&&t.stopPolicy!==a.stopRuleRef)add('task_original_stop_rule_conflict:'+t.taskId);
  const numerical=bindings.numericalRecovery.roles.find((r:any)=>r.taskId===t.taskId);
  if(t.retryReasonRef&&tryRead('retry_rule',()=>c.get(t.retryReasonRef))?.schema==='ohuo-prerequisite-receipt-v2'){
   // Assignment proves the fixed future role, not permission or completion.
   // Current admission is not historical validity; only the
   // common helper may prove the completed calibration cross-action parent.
   if(!numerical?.assignmentVerified||attemptByRun.has(t.runId)&&!numerical.lineageVerified)add('numerical_recovery_lineage_unverified:'+t.taskId);
   continue;
  }
  const visited=new Set<string>();let current=t;
  while(!a.plannedTaskIds.includes(current.taskId)){
   if(!current.parentTaskId||visited.has(current.taskId)){add('unplanned_or_cyclic_retry:'+t.taskId);break;}visited.add(current.taskId);
   const parent=tasks.get(current.parentTaskId)?.task,prior=parent&&attemptByRun.get(parent.runId);
   if(!parent||!belongs(parent,a)||parent.budgetRef!==t.budgetRef||!prior||!['failed','interrupted'].includes(prior.status)||current.retryReasonRef!==a.acceptanceRuleRef&&!current.allowedBranches.some((b:any)=>b.evidenceRef===current.retryReasonRef)){add('retry_parent_or_rule_conflict:'+t.taskId);break;}
   tryRead('retry_rule',()=>c.get(current.retryReasonRef));current=parent;
  }
 }
 for(const attempt of attempts){const role=bindings.numericalRecovery.roles.find((r:any)=>r.taskId===attempt.taskId);if(role)attempt.numericalRecovery={role:role.role,specRef:role.specRef,receiptRef:role.receiptRef,assignmentRef:role.assignmentRef,branchStatus:role.branchStatus,lineageVerified:role.lineageVerified};}
 const resultActions=actions.map(a=>{
  const matched=[...tasks.values()].filter(x=>belongs(x.task,a)),actual=attempts.filter(r=>matched.some(x=>x.task.taskId===r.taskId)),record=accounting?.actions?.find((x:any)=>actionKey(x)===actionKey(a)),unresolved:string[]=[],evidenceRefs:FixedRef[]=[];
  let status='blocked',ruleRef:string|null=null;const fail=(s:string,executionUnknown=true)=>{unresolved.push(s);const named=s+':'+actionKey(a);if(executionUnknown)add(named);else completionProblems.push(named);};
  if(record?.skipRef){try{const skip=c.get(record.skipRef);if(!a.skipRuleRef||actual.length||skip.planRef!==planRef||skip.clauseRef!==a.clauseRef||skip.branchRef!==a.branchRef||skip.ruleRef!==a.skipRuleRef||skip.outcome!=='skipped_with_rule'||!list(skip.triggerEvidenceRefs).length)throw Error('skip_without_original_rule_or_trigger');skip.triggerEvidenceRefs.forEach((r:any)=>evidenceRefs.push(c.ref(r)));evidenceRefs.push(c.ref(record.skipRef));ruleRef=a.skipRuleRef;status='skipped_with_rule';}catch(e:any){fail(e.message);}}
  else if(!actual.length&&a.plannedTaskIds.length){status=problems.some(p=>p.includes('missing_run')||p.includes('control_root')||p.includes('control_state'))?'blocked':'not_executed';if(status==='blocked')fail('execution_presence_unknown');}
  else if(record?.acceptanceRef){try{const receipt=c.get(record.acceptanceRef);if(receipt.planRef!==planRef||receipt.clauseRef!==a.clauseRef||receipt.branchRef!==a.branchRef||receipt.ruleRef!==a.acceptanceRuleRef||!['completed','failed_readout'].includes(receipt.outcome)||!sameSet(list(receipt.taskFileRefs),matched.map(x=>x.ref))||!sameSet(list(receipt.runIds),actual.map(x=>x.runId))||!list(receipt.evidence_refs).length||actual.some(r=>r.executionUnknown))throw Error('action_execution_or_acceptance_incomplete');
    if(actual.some(r=>{const role=bindings.numericalRecovery.roles.find((x:any)=>x.taskId===r.taskId);return role&&!role.phaseComplete;}))throw Error('numerical_recovery_stage_incomplete');
    if(a.plannedTaskIds.some((id:string)=>!actual.some(r=>r.taskId===id)&&!actual.some(r=>{const role=bindings.numericalRecovery.roles.find((x:any)=>x.taskId===r.taskId);return role?.phaseComplete&&role.lineageVerified&&tasks.get(id)?.ref===role.originalTaskRef;})))throw Error('planned_task_not_executed');
    for(const r of receipt.evidence_refs)evidenceRefs.push(c.ref(r));for(const r of actual)if(!r.artifactRefs.length||r.artifactRefs.some((ref:FixedRef)=>!evidenceRefs.some(e=>equal(e,ref))))throw Error('attempt_product_missing_from_readout');
    for(const kind of a.expectedArtifactKinds)if(!evidenceRefs.some(r=>{const value=c.get(r);return value.kind===kind||value.schema===kind;}))throw Error('expected_original_artifact_kind_missing');
    evidenceRefs.push(c.ref(record.acceptanceRef));status='completed';ruleRef=a.acceptanceRuleRef;
   }catch(e:any){
    // A reconciled failed readout is known execution even when the required
    // numerical phase never completed. Do not turn confirmed cost into unknown.
    fail(e.message,e.message!=='numerical_recovery_stage_incomplete');
   }}
  else fail('original_action_acceptance_missing',false);
  return {clauseRef:a.clauseRef,branchRef:a.branchRef,plannedTaskIds:a.plannedTaskIds,taskFileRefs:matched.map(x=>x.ref),runRefs:actual.map(r=>r.runRef).filter(Boolean),status,evidence_refs:[...new Map(evidenceRefs.map(r=>[r.id,r])).values()],ruleRef,unresolved};
 });
 let termination:any=null;
 if(budgetStop?.stopRef){try{const stop=c.get(budgetStop.stopRef),rules=[original.stopPolicy,...actions.map(a=>a.stopRuleRef)].filter(Boolean);
   if(stop.planRef!==planRef||!rules.includes(stop.ruleRef)||!list(stop.evidence_refs).length)throw Error('termination_original_rule_or_actual_trigger_missing');
   const stopRuns=list(stop.runIds);
   if(stopRuns.length){if(!stopRuns.every((id:string)=>{const r=attemptByRun.get(id);return r&&!r.executionUnknown&&r.stopReason===stop.trigger;}))throw Error('termination_actual_run_trigger_missing');}
   else {
    // Original non-runner terminal branch: consume an already-fixed section 3
    // stopping analysis, not a stopRef that merely repeats its own trigger.
    const verified=stop.evidence_refs.some((ref:any)=>{if(!analyses.some(a=>equal(a.ref,ref)))return false;const a=c.get(ref),action=actions.find(x=>x.clauseRef===a.allowedPlanClause&&x.branchRef===a.allowedBranchRef&&x.plannedTaskIds.length===0&&(x.stopRuleRef===stop.ruleRef||original.stopPolicy===stop.ruleRef));
     return !!action&&a.planRef===planRef&&a.disposition==='STOP_AND_DISCUSS_NEW_PLAN'&&['支持继续有限探索','未决','拒绝本候选','可建议进入采用程序'].includes(a.scientific_status)&&typeof a.finding==='string'&&a.finding.trim().length>0&&list(a.orderedActions).length===0&&list(a.stop_conditions).includes(stop.ruleRef);
    });if(!verified)throw Error('termination_nonrunner_analysis_trigger_missing');
   }
   const rule=c.get(stop.ruleRef);if(rule.reason!==stop.trigger&&!rule.stopReasons?.includes(stop.trigger))throw Error('termination_trigger_not_in_original_rule');
   if(stop.trigger==='budget_exhausted'&&!stop.runIds.some((id:string)=>{const task=tasks.get(attemptByRun.get(id)?.taskId)?.task,b=task&&ledgers.get(task.budgetRef);return b&&COUNTERS.some(k=>b.raw.limits[LIMITS[k]]>0&&b.raw.used[k]>=b.raw.limits[LIMITS[k]]);}))throw Error('termination_budget_not_exhausted');
   stop.evidence_refs.forEach((r:any)=>c.file(r));termination={ruleRef:stop.ruleRef,trigger:stop.trigger,runIds:stop.runIds,evidenceRef:c.ref(budgetStop.stopRef)};
  }catch(e:any){add(e.message);}}
 // Stage meaning comes from the original scientific question, actual producer
 // purpose/schema and fixed stage manifests, never from evaluate => student.
 const stageRequired=new Set<string>();
 const requireQuestion=(question:any)=>{if(question==='teacher_increment'||question==='student_match')for(const id of QUESTION_EVIDENCE[question])stageRequired.add(id);};
 for(const file of manifestFiles)requireQuestion(c.read(file).purpose);
 for(const {task:t} of tasks.values())if(attemptByRun.has(t.runId)){
  requireQuestion(t.scientificContract.question);
  if(t.taskKind==='supervised_training')for(const id of ['teacherConclusion','dataset','training','selectionHistory'])stageRequired.add(id);
  if(t.taskKind==='evaluate'&&!['teacher_increment','student_match'].includes(t.scientificContract.question)&&!manifestFiles.some(f=>['teacher_increment','student_match'].includes(c.read(f).purpose)))stageRequired.add('stageQuestion:'+t.taskId);
  if(t.taskKind==='collect'){const selection=t.datasetRefs[0]&&tryRead('stage_selection',()=>c.get(t.datasetRefs[0]));if(selection?.purpose==='distribution_diagnostic')stageRequired.add('newDistribution');else if(selection?.purpose==='b_training_source')for(const id of ['teacherConclusion','dataset'])stageRequired.add(id);else stageRequired.add('stageQuestion:'+t.taskId);}
 }
 for(const id of stageRequired){scienceOnly.add(id);const existing=requirement(facts,id);if(existing)existing.mandatory=true;else facts.requiredEvidence.push({id,source:null,mandatory:true,status:'UNLOCATED',checkedLocations:[],owner:'DOT',authorizationRef:'original-plan',dependencies:[],prerequisitesMet:null});}
 const knownEnded=problems.length===0&&attempts.every(a=>!a.executionUnknown)&&[...ledgers.values()].every(b=>!b.issues.length);
 const status=termination&&knownEnded?'terminated':knownEnded&&!completionProblems.length&&resultActions.length>0&&resultActions.every(a=>['completed','skipped_with_rule'].includes(a.status))?'completed':'incomplete';
 const unknownCount=problems.length;
 const budgets=[...ledgers.values()].map(b=>({budgetRef:b.budgetRef,source:b.source,...Object.fromEntries(Object.entries(b.buckets).map(([bucket,values]:any)=>[bucket,Object.fromEntries(COUNTERS.map(k=>[k,{known:values[k],unknown:unknownCount,total:unknownCount?null:values[k]}]))])),used:b.raw.used,activeRunId:b.raw.activeRunId,elapsedSeconds:b.raw.elapsedSeconds,issues:b.issues}));
 const closeout={schema:'ohuo-plan-closeout-v1',planRef,planVersion:original.planVersion,status,inputPackageRef:null,inputManifestSHA:null,analysisRef:null,actions:resultActions,evidence_refs:[{id:planFile.id,sha256:planFile.sha256},...stateFiles.map(f=>({id:f.id,sha256:f.sha256})),...(termination?[termination.evidenceRef]:[])],unresolved:[...problems,...completionProblems]};
 const summary:any={schema:'ohuo-plan-accounting-summary-v1',planRef,planVersion:original.planVersion,mechanicalCandidate:true,hostClosureEligible:false,actions:resultActions,analyses,packageManifestRefs:manifestFiles.map(f=>({id:f.id,sha256:f.sha256})),attempts,budgets,numericalRecovery:bindings.numericalRecovery,independentBlocks:{known:null,unknown:1,total:null,reason:'not recomputed or additively combined across stage packages'},deviations,termination,execution:{status,unknownCount,unresolved:problems,completionUnresolved:completionProblems,scope:'all supplied registered control roots; no discovery of unregistered external execution'},scientificUnresolved:[],engineeringStatus:'mechanical-accounting-only',absorptionStatus:null,sourceInputs:{approvedPlan:{id:planFile.id,sha256:planFile.sha256},controlStates:stateFiles.map(f=>({id:f.id,sha256:f.sha256}))}};
 const pack=buildEvidencePackage(packagePlan,summary,facts);summary.scientificUnresolved=pack.missingItems.filter((m:any)=>scienceOnly.has(m.evidenceId)||m.evidenceId.startsWith('private:'));
 const manifest=writeEvidencePackage(output,packagePlan,summary,facts,[],closeout);return {summary,closeout,manifest};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args[0]==='--mode'){
  if(args.length!==6||args[1]!=='closeout'||args[2]!=='--input'||args[4]!=='--output')throw Error('usage: --mode closeout --input fixed-closeout-inputs.json --output lab/out/<new-id>');
  const r=rebuildPlanCloseout(JSON.parse(readFileSync(args[3],'utf8')),args[5]);console.log(JSON.stringify({packageId:r.manifest.packageId,status:r.closeout.status,completeness:r.manifest.completeness,transportStatus:r.manifest.transportStatus}));
 }else{
  if(args.length!==6||args[0]!=='--input'||args[2]!=='--output'||args[4]!=='--python')throw Error('usage: --input fixed-inputs.json --output lab/out/<new-id> --python <existing-python>');
  const r=rebuildEvidence(JSON.parse(readFileSync(args[1],'utf8')),args[3],args[5]);console.log(JSON.stringify({packageId:r.manifest.packageId,completeBlocks:r.summary.actual.completeBlocks,completeness:r.manifest.completeness,transportStatus:r.manifest.transportStatus}));
 }
}
