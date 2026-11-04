/** Pure parsed-dataset ancestry. H must supply its COMPLETE original catalog,
 * all same-scope learned refs and loadFrozenDataset-verified immutable bytes.
 * This function neither establishes that completeness nor grants authority. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {digest,fixedReference,strictObject} from './task-schema.mjs';
import {validateCumulativeSampling} from './first-round-cumulative-data.mjs';
import {verifyDesignedProtocolLineage} from './designed-protocol-lineage.mjs';
const need=(condition,reason)=>{if(!condition)throw Error('designed_augmentation_history_'+reason);};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const dataHash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fixed=(x,name)=>fixedReference(x,'augmentationHistory.'+name);
const prefix=(short,long)=>short.length<=long.length&&short.every((x,i)=>x===long[i]);
function sameScope(plan,expected,references){
 if(plan?.schema!=='ohuo-distill-plan-first-round-v3'||plan.purpose!=='first-round-partner-control'||!equal(plan.identities,expected.identities)||plan.researchProtocol?.id!==expected.researchProtocol?.id)return false;
 if(equal(plan.researchProtocol,expected.researchProtocol))return true;
 // Only exact immutable old protocol bytes can cross this one explicit revision.
 // Identities and all old dataset rows remain unchanged; this grants no authority.
 strictObject(plan.researchProtocol,'priorResearchProtocol',['id','revisionRef']);
 strictObject(expected.researchProtocol,'currentResearchProtocol',['id','revisionRef']);
 verifyDesignedProtocolLineage({currentProtocolRef:expected.researchProtocol.revisionRef,previousProtocolRef:plan.researchProtocol.revisionRef,references});return true;
}
function priorDemosRetained(parent,child){
 const now=new Map(child.samples.filter(s=>s.sampleKind==='demo').map(s=>[s.decisionId,s]));
 for(const old of parent.samples.filter(s=>s.sampleKind==='demo')){
  const value=now.get(old.decisionId);need(value&&value.contextSHA256===old.contextSHA256&&value.provenance?.inputSHA256===old.provenance?.inputSHA256,'previous_demo_changed');
 }
}
function retainedSamples(parent,child){
 const evidence=child.manifest.designedEvidence,now=new Map(child.samples.map(s=>[s.decisionId,dataHash(s)]));
 need(evidence?.previousDatasetRef===child.parentRef&&evidence.previousManifestSHA256===parent.descriptor.manifestSHA256&&evidence.previousSamplesSHA256===parent.manifest.samples.sha256,'previous_evidence_changed');
 const retained=parent.samples.map(s=>({decisionId:s.decisionId,sampleSHA256:dataHash(s)}));
 need(equal(evidence.retainedSamples,retained)&&retained.every(s=>now.get(s.decisionId)===s.sampleSHA256),'retained_sample_changed');
}
/** Return the plan's exact registered ref only when it belongs to the sole
 * maximal actual ancestor class. Byte-identical aliases are not new branches.
 * Sample count, eligibility and success status never choose the predecessor. */
export function resolveDesignedAugmentationPredecessor({plan,ordinaryPool,candidates,learnedDatasetRefs,references}){
 need(sameScope(plan,plan)&&plan.researchProtocol?.id==='first-round-common-view-r2'&&typeof plan.datasetId==='string','scope_changed');
 fixed(plan.researchProtocol.revisionRef,'protocolRef');
 const augmentation=plan.designedAugmentation;
 strictObject(augmentation,'designedAugmentation',['schema','previousDatasetRef','selectionRef','ordinarySelectionRef']);
 need(augmentation.schema==='ohuo-designed-augmentation-v1'&&!Object.hasOwn(plan,'cumulativeSampling'),'current_plan');
 for(const key of ['previousDatasetRef','selectionRef','ordinarySelectionRef'])fixed(augmentation[key],key);
 strictObject(ordinaryPool,'ordinaryPool',['selectionRef','sourceIndexRef','queueRef','productionRefs']);
 for(const key of ['selectionRef','sourceIndexRef','queueRef'])fixed(ordinaryPool[key],key);
 need(ordinaryPool.selectionRef===augmentation.ordinarySelectionRef&&Array.isArray(ordinaryPool.productionRefs)&&ordinaryPool.productionRefs.length>0&&new Set(ordinaryPool.productionRefs).size===ordinaryPool.productionRefs.length,'ordinary_pool');
 ordinaryPool.productionRefs.forEach(x=>fixed(x,'productionRef'));
 need(Array.isArray(candidates)&&Array.isArray(learnedDatasetRefs),'catalog_shape');
 const byRef=new Map(),classes=new Map();
 for(const candidate of candidates){
  strictObject(candidate,'datasetCandidate',['reference','descriptor','manifest','samples']);
  const {reference,descriptor,manifest,samples}=candidate;fixed(reference,'datasetRef');
  need(!byRef.has(reference)&&descriptor?.schema==='ohuo-frozen-dataset-ref-v1'&&hex(descriptor.manifestSHA256)&&digest(descriptor)===reference.split(':').at(-1),'dataset_reference');
  need(manifest&&Array.isArray(samples),'dataset_shape');byRef.set(reference,null);
  let group=classes.get(descriptor.manifestSHA256);
  if(group){need(equal(group.descriptor,descriptor)&&equal(group.manifest,manifest)&&JSON.stringify(group.samples)===JSON.stringify(samples),'alias_bytes_differ');group.refs.push(reference);byRef.set(reference,group);continue;}
  group={...candidate,refs:[reference],id:descriptor.manifestSHA256,edges:new Set(),relevant:false};classes.set(group.id,group);byRef.set(reference,group);
 }
 const relevant=[];
 for(const group of classes.values()){
  const pp=group.manifest.plan,design=pp?.designedAugmentation;
  const inPool=design?design.ordinarySelectionRef===ordinaryPool.selectionRef:pp?.sourceIndexRef===ordinaryPool.sourceIndexRef&&pp?.queueRef===ordinaryPool.queueRef;
  if(!inPool)continue;
  need(sameScope(pp,plan,references)&&group.manifest.schema==='ohuo-distill-dataset-first-round-v4'&&group.manifest.datasetId===pp.datasetId,'scope_changed');
  need(pp.datasetId!==plan.datasetId,'current_dataset_already_registered');
  need(group.manifest.samples?.decisions===group.samples.length&&hex(group.manifest.samples.sha256)&&new Set(group.samples.map(s=>s.decisionId)).size===group.samples.length,'sample_identity');
  group.relevant=true;group.kind=design?'designed':'natural';group.parentRef=null;
  if(design){
   strictObject(design,'priorDesignedAugmentation',['schema','previousDatasetRef','selectionRef','ordinarySelectionRef']);
   need(design.schema==='ohuo-designed-augmentation-v1'&&!Object.hasOwn(pp,'cumulativeSampling'),'prior_design_shape');
   for(const key of ['previousDatasetRef','selectionRef','ordinarySelectionRef'])fixed(design[key],key);
   group.parentRef=design.previousDatasetRef;
  }else{
   const cumulative=pp.cumulativeSampling;
   if(cumulative){validateCumulativeSampling(cumulative,pp.researchProtocol.revisionRef);need(pp.samplingRef.split(':').at(-1)===digest(cumulative),'cumulative_sampling_reference');group.parentRef=cumulative.previousDatasetRef;}
   group.productions=cumulative?.productionRefs??[pp.samplingRef];group.productions.forEach(x=>fixed(x,'priorProductionRef'));
   need(group.productions.length>0&&prefix(group.productions,ordinaryPool.productionRefs),'production_prefix');
  }
  relevant.push(group);
 }
 for(const ref of learnedDatasetRefs){fixed(ref,'learnedDatasetRef');need(byRef.has(ref),'learned_missing');need(byRef.get(ref).relevant,'learned_scope');}
 // Explicit previous refs must remain present even if a larger candidate exists.
 for(const child of relevant)if(child.parentRef!==null){
  const parent=byRef.get(child.parentRef);need(parent?.relevant,'previous_missing');need(parent!==child,'ancestry_cycle');
  if(child.kind==='designed')retainedSamples(parent,child);
  else{
   need(parent.kind==='natural'&&parent.productions.length<child.productions.length&&prefix(parent.productions,child.productions),'production_prefix');
   const evidence=child.manifest.cumulativeEvidence;need(evidence?.previousDatasetRef===child.parentRef&&evidence.previousManifestSHA256===parent.descriptor.manifestSHA256,'previous_evidence_changed');priorDemosRetained(parent,child);
  }
  parent.edges.add(child);
 }
 // Natural datasets can also prove ancestry through the original full round
 // production prefix. Designed datasets cannot acquire ancestry this way.
 const natural=relevant.filter(g=>g.kind==='natural');
 for(let i=0;i<natural.length;i++)for(let j=i+1;j<natural.length;j++)need(!equal(natural[i].productions,natural[j].productions),'forked_history');
 for(const earlier of natural)for(const later of natural)if(earlier.productions.length<later.productions.length){
  need(prefix(earlier.productions,later.productions),'production_prefix');priorDemosRetained(earlier,later);earlier.edges.add(later);
 }
 const visiting=new Set(),visited=new Set();
 const visit=node=>{need(!visiting.has(node),'ancestry_cycle');if(visited.has(node))return;visiting.add(node);for(const next of node.edges)visit(next);visiting.delete(node);visited.add(node);};
 relevant.forEach(visit);
 const tips=relevant.filter(node=>node.edges.size===0);need(tips.length===1,'forked_history');const tip=tips[0];
 need(tip.refs.includes(augmentation.previousDatasetRef),'previous_not_tip');
 const reaches=(node,target,seen=new Set())=>{if(node===target)return true;if(seen.has(node))return false;seen.add(node);return [...node.edges].some(next=>reaches(next,target,seen));};
 for(const ref of learnedDatasetRefs)need(reaches(byRef.get(ref),tip),'learned_not_ancestor');
 return augmentation.previousDatasetRef;
}
