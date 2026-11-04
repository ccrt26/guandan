import {createHash} from 'node:crypto';
// Named designed-source provenance; original numeric sample contract is unchanged.
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fixed=value=>typeof value==='string'&&/^.+@sha256:[a-f0-9]{64}$/.test(value)&&!/(^|[/:_-])latest($|[/:@_-])/i.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
export function validateDesignedAugmentation(value){
 if(!exact(value,['schema','previousDatasetRef','selectionRef','ordinarySelectionRef'])||value.schema!=='ohuo-designed-augmentation-v1'||['previousDatasetRef','selectionRef','ordinarySelectionRef'].some(k=>!fixed(value[k]))||value.selectionRef===value.ordinarySelectionRef)throw Error('designed_augmentation');
 return value;
}
export function validateDesignedProvenance(value){
 if(!exact(value,['sourceKind','sourceRef','sourceIndexRef','sourceSHA256','replaySHA256','inputSHA256','samplingRef'])||value.sourceKind!=='designed-synthetic'||['sourceRef','sourceIndexRef','samplingRef'].some(k=>!fixed(value[k]))||['sourceSHA256','replaySHA256','inputSHA256'].some(k=>!hex(value[k])))throw Error('designed_provenance');
 return value;
}
/** Previous natural/dev rows retain their exact JSONL serialization. No stale
 * source receipt is relabelled as evidence for a new design or new input. */
export function assertRetainedSamples(previous,current){
 if(!Array.isArray(previous)||!Array.isArray(current))throw Error('designed_previous_sample_changed');
 const byId=new Map(current.map(row=>[row?.decisionId,row]));
 if(byId.size!==current.length||new Set(previous.map(row=>row?.decisionId)).size!==previous.length)throw Error('designed_previous_sample_changed');
 for(const row of previous)if(typeof row?.decisionId!=='string'||!byId.has(row.decisionId)||JSON.stringify(row)!==JSON.stringify(byId.get(row.decisionId)))throw Error('designed_previous_sample_changed');
}

/** Checks the frozen extension against every retained or newly admitted row.
 * Authority for these bytes remains the original fixed H/selection/ledger join. */
export function validateDesignedEvidence(e,plan,samples,exclusions,hashSample){
 const need=(ok,reason)=>{if(!ok)throw Error('designed_evidence_'+reason);};
 const a=validateDesignedAugmentation(plan.designedAugmentation);
 const fields=['schema','previousDatasetRef','previousManifestSHA256','previousSamplesSHA256','retainedSamples','selectionRef','productionRef','populationRef','selectedMetadataRef','exclusionsRef','preselectedDemoMetadata','ordinarySelectionRef','ordinaryProductionRef','ordinaryPopulationRef','ordinaryCandidateMetadata','newDemoIds','addedKeepIds'];
 need(exact(e,fields)&&e.schema==='ohuo-designed-augmentation-evidence-v1','shape');
 need(e.previousDatasetRef===a.previousDatasetRef&&e.selectionRef===a.selectionRef&&e.ordinarySelectionRef===a.ordinarySelectionRef&&e.productionRef===plan.samplingRef,'plan');
 need(['previousManifestSHA256','previousSamplesSHA256'].every(k=>hex(e[k]))&&fixed(e.ordinaryProductionRef)&&['populationRef','selectedMetadataRef','exclusionsRef','ordinaryPopulationRef'].every(k=>exact(e[k],['id','sha256'])&&typeof e[k].id==='string'&&e[k].id.trim().length>0&&!/(^|[/:_-])latest($|[/:@_-])/i.test(e[k].id)&&hex(e[k].sha256)),'references');
 for(const k of ['retainedSamples','preselectedDemoMetadata','ordinaryCandidateMetadata','newDemoIds','addedKeepIds'])need(Array.isArray(e[k]),'arrays');
 const unique=rows=>new Set(rows.map(r=>r.decisionId)).size===rows.length;
 need(unique(samples)&&unique(e.retainedSamples)&&unique(e.preselectedDemoMetadata)&&unique(e.ordinaryCandidateMetadata)&&new Set(e.newDemoIds).size===e.newDemoIds.length&&new Set(e.addedKeepIds).size===e.addedKeepIds.length,'duplicate');
 const byId=new Map(samples.map(s=>[s.decisionId,s])),retained=new Set();
 for(const r of e.retainedSamples){need(exact(r,['decisionId','sampleSHA256'])&&typeof r.decisionId==='string'&&hex(r.sampleSHA256),'retained_shape');const s=byId.get(r.decisionId);need(s&&hashSample(s)===r.sampleSHA256,'retained_changed');retained.add(r.decisionId);}
 const priorRows=e.retainedSamples.map(r=>byId.get(r.decisionId));need(JSON.stringify(samples.slice(0,priorRows.length).map(s=>s.decisionId))===JSON.stringify(e.retainedSamples.map(r=>r.decisionId)),'retained_order');need(createHash('sha256').update(priorRows.map(s=>JSON.stringify(s)).join('\n')+(priorRows.length?'\n':'')).digest('hex')===e.previousSamplesSHA256,'retained_file_hash');
 const demo=new Map();for(const m of e.preselectedDemoMetadata){need(exact(m,['decisionId','key','inputSHA256','sourceRef','sourceIndexRef','sourceSHA256','replaySHA256','sourceFamily'])&&typeof m.decisionId==='string'&&typeof m.sourceFamily==='string'&&m.key&&typeof m.key==='object'&&['inputSHA256','sourceSHA256','replaySHA256'].every(k=>hex(m[k]))&&['sourceRef','sourceIndexRef'].every(k=>fixed(m[k]))&&m.sourceIndexRef===plan.sourceIndexRef&&!retained.has(m.decisionId),'demo_metadata');demo.set(m.decisionId,m);}
 const ordinary=new Map();for(const [rank,m]of e.ordinaryCandidateMetadata.entries()){need(exact(m,['decisionId','key','inputSHA256','rank','sourceFamily','sourceRef','contextSHA256'])&&m.rank===rank&&m.key&&typeof m.key==='object'&&!Array.isArray(m.key)&&typeof m.decisionId==='string'&&typeof m.sourceFamily==='string'&&fixed(m.sourceRef)&&hex(m.inputSHA256)&&hex(m.contextSHA256),'ordinary_metadata');ordinary.set(m.decisionId,m);}
 const newDemoIds=[],addedKeepIds=[];
 for(const s of samples){if(retained.has(s.decisionId))continue;
  if(s.sampleKind==='demo'){
   const m=demo.get(s.decisionId),p=validateDesignedProvenance(s.provenance);need(m&&s.split==='train'&&s.sampleClass==='target'&&s.sourceFamily===m.sourceFamily&&s.sourceRef===m.sourceRef&&JSON.stringify(s.key)===JSON.stringify(m.key)&&['inputSHA256','sourceRef','sourceIndexRef','sourceSHA256','replaySHA256'].every(k=>p[k]===m[k])&&p.samplingRef===plan.samplingRef,'demo_binding');newDemoIds.push(s.decisionId);
  }else{
   const m=ordinary.get(s.decisionId);need(m&&s.split==='train'&&s.sampleClass==='ordinary'&&s.provenance.sourceKind===undefined&&s.provenance.samplingRef===plan.samplingRef&&s.provenance.inputSHA256===m.inputSHA256&&s.sourceFamily===m.sourceFamily&&s.sourceRef===m.sourceRef&&s.contextSHA256===m.contextSHA256&&JSON.stringify(s.key)===JSON.stringify(m.key),'keep_binding');addedKeepIds.push(s.decisionId);
  }
 }
 need(JSON.stringify(newDemoIds)===JSON.stringify(e.newDemoIds)&&JSON.stringify(addedKeepIds)===JSON.stringify(e.addedKeepIds),'growth');
 for(const m of demo.values()){const valid=newDemoIds.includes(m.decisionId),failed=exclusions.filter(x=>x.sourceKind==='designed-synthetic'&&x.decisionId===m.decisionId&&x.sourceRef===m.sourceRef&&x.sourceSHA256===m.sourceSHA256);need(valid?failed.length===0:failed.length===1,'full_denominator');if(failed.length)need(typeof failed[0].reason==='string'&&failed[0].reason.trim().length>0,'full_denominator');}
 need(addedKeepIds.length<=samples.filter(s=>s.sampleKind==='demo'&&s.split==='train').length-samples.filter(s=>retained.has(s.decisionId)&&s.sampleKind==='keep'&&s.split==='train').length,'keep_count');
 const retainedKeep=new Set(samples.filter(s=>retained.has(s.decisionId)&&s.split==='train'&&s.sampleKind==='keep').map(s=>s.decisionId));
 need(JSON.stringify(e.ordinaryCandidateMetadata.slice(0,retainedKeep.size).map(m=>m.decisionId))===JSON.stringify(samples.filter(s=>retained.has(s.decisionId)&&s.split==='train'&&s.sampleKind==='keep').map(s=>s.decisionId)),'retained_keep_prefix');
 const eligible=e.ordinaryCandidateMetadata.filter(m=>!retainedKeep.has(m.decisionId));
 need(JSON.stringify(addedKeepIds)===JSON.stringify(eligible.slice(0,addedKeepIds.length).map(m=>m.decisionId)),'keep_prefix');
 return {retainedHashes:new Set(e.retainedSamples.map(r=>r.sampleSHA256)),newDemoIds,addedKeepIds};
}
