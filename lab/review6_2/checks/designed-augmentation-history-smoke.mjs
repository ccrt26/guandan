/** Finite pure parsed-data fixture. No path reads, authority, models or API. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {digest,referenceOf} from '../task-schema.mjs';
import {buildDesignedProtocolLineageFixture} from './designed-protocol-lineage-smoke.mjs';
assert.deepEqual(process.argv.slice(2),['--case','source.designed-augmentation-history']);
let api={};try{api=await import('../designed-augmentation-history.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof api.resolveDesignedAugmentationPredecessor,'function','missing pure augmentation ancestry resolver');
const resolve=api.resolveDesignedAugmentationPredecessor,hash=x=>createHash('sha256').update(x).digest('hex'),ref=id=>referenceOf(id,{id});
const protocol=ref('protocol'),index=ref('natural-index'),queue=ref('natural-queue'),ordinarySelection=ref('ordinary-selection'),productions=[0,1,2].map(i=>ref('production-'+i)),identities={basePolicy:{id:'B'},teacher:{id:'teacher'},student:{id:'S0'}};
const ordinaryPool={selectionRef:ordinarySelection,sourceIndexRef:index,queueRef:queue,productionRefs:productions};
const sample=(id,kind='demo')=>({decisionId:id,sampleKind:kind,split:'train',contextSHA256:hash(id),provenance:{inputSHA256:hash('input-'+id)}});
function dataset(id,{parent=null,kind='base',prefix=1,samples=[sample(id)],eligible=false,overrides={}}={}){
 const plan={schema:'ohuo-distill-plan-first-round-v3',datasetId:id,purpose:'first-round-partner-control',identities,sourceIndexRef:kind==='designed'?ref('design-index'):index,queueRef:kind==='designed'?ref('design-queue'):queue,samplingRef:kind==='base'?productions[0]:ref('sampling-'+id),researchProtocol:{id:'first-round-common-view-r2',revisionRef:protocol},...overrides};
 if(kind==='cumulative')plan.cumulativeSampling={schema:'ohuo-first-round-cumulative-sampling-r2',protocolRef:plan.researchProtocol.revisionRef,poolRef:ref('pool'),selectionRefs:productions.slice(0,prefix).map((_,i)=>ref('selection-'+i)),productionRefs:productions.slice(0,prefix),previousDatasetRef:parent?.reference??null,keepRule:'same-split-frozen-layout-hash-prefix-equal-cumulative-valid-demo'};
 if(kind==='cumulative')plan.samplingRef=referenceOf('sampling-'+id,plan.cumulativeSampling);
 if(kind==='designed')plan.designedAugmentation={schema:'ohuo-designed-augmentation-v1',previousDatasetRef:parent.reference,selectionRef:ref('design-selection-'+id),ordinarySelectionRef:ordinarySelection};
 const sampleBytes=samples.map(s=>JSON.stringify(s)+'\n').join(''),manifest={schema:'ohuo-distill-dataset-first-round-v4',datasetId:id,plan,samples:{path:'samples.jsonl',sha256:hash(sampleBytes),bytes:Buffer.byteLength(sampleBytes),decisions:samples.length},qualification:{eligible}};
 if(kind==='cumulative')manifest.cumulativeEvidence={previousDatasetRef:parent?.reference??null,previousManifestSHA256:parent?.descriptor.manifestSHA256??null};
 if(kind==='designed')manifest.designedEvidence={previousDatasetRef:parent.reference,previousManifestSHA256:parent.descriptor.manifestSHA256,previousSamplesSHA256:parent.manifest.samples.sha256,retainedSamples:parent.samples.map(s=>({decisionId:s.decisionId,sampleSHA256:hash(JSON.stringify(s))}))};
 const descriptor={schema:'ohuo-frozen-dataset-ref-v1',manifestSHA256:hash(JSON.stringify(manifest)+'\n')};return{reference:referenceOf(id,descriptor),descriptor,manifest,samples};
}
const base=dataset('base',{samples:[sample('old'),...Array.from({length:8},(_,i)=>sample('keep-'+i,'keep'))]}),natural=dataset('natural',{kind:'cumulative',parent:base,prefix:2,samples:[sample('old'),sample('new')]}),designed=dataset('designed',{kind:'designed',parent:natural,samples:[...natural.samples,sample('design')]});
const plan={schema:'ohuo-distill-plan-first-round-v3',datasetId:'next',purpose:'first-round-partner-control',identities,researchProtocol:{id:'first-round-common-view-r2',revisionRef:protocol},designedAugmentation:{schema:'ohuo-designed-augmentation-v1',previousDatasetRef:designed.reference,selectionRef:ref('next-selection'),ordinarySelectionRef:ordinarySelection}};
const input={plan,ordinaryPool,candidates:[base,natural,designed],learnedDatasetRefs:[base.reference,natural.reference]},before=structuredClone(input);
assert.equal(resolve(input),designed.reference,'exact designed ancestry wins, not the nine-row older base');assert.deepEqual(input,before);
assert.equal(resolve({...input,plan:{...plan,designedAugmentation:{...plan.designedAugmentation,previousDatasetRef:natural.reference}},candidates:[base,natural]}),natural.reference,'diagnostic/ineligible predecessor is valid for further coverage');
assert.throws(()=>resolve({...input,plan:{...plan,designedAugmentation:{...plan.designedAugmentation,previousDatasetRef:base.reference}}}),/previous_not_tip/);
assert.throws(()=>resolve({...input,candidates:[designed],learnedDatasetRefs:[]}),/previous_missing/);
assert.throws(()=>resolve({...input,learnedDatasetRefs:[...input.learnedDatasetRefs,ref('omitted-learned')]}),/learned_missing/);
const fork=dataset('fork',{kind:'designed',parent:natural,samples:[...natural.samples,sample('fork'),sample('fork-large')]});assert.throws(()=>resolve({...input,candidates:[...input.candidates,fork]}),/forked_history/,'a larger fork is never chosen');
const naturalFork=dataset('natural-fork',{kind:'cumulative',parent:base,prefix:2,samples:[sample('old'),sample('other-new')]});const joined=dataset('joined',{kind:'cumulative',parent:natural,prefix:3,samples:[sample('old'),sample('new'),sample('other-new')]});assert.throws(()=>resolve({...input,plan:{...plan,designedAugmentation:{...plan.designedAugmentation,previousDatasetRef:joined.reference}},candidates:[base,natural,naturalFork,joined]}),/forked_history/,'same production-prefix alternate contents remain a fork even if a larger dataset contains both');
const laterNatural=dataset('later-natural',{kind:'cumulative',parent:natural,prefix:3,samples:[...natural.samples,sample('late')]});assert.throws(()=>resolve({...input,candidates:[...input.candidates,laterNatural]}),/forked_history/,'natural later branch and design branch are not silently merged');
const dropped=dataset('dropped',{kind:'designed',parent:natural,samples:[sample('only-new')]});assert.throws(()=>resolve({...input,candidates:[base,natural,dropped]}),/retained_sample_changed/);
const naturalDrop=dataset('natural-drop',{kind:'cumulative',parent:base,prefix:2,samples:[sample('new-only')]});assert.throws(()=>resolve({...input,candidates:[base,naturalDrop],learnedDatasetRefs:[base.reference]}),/previous_demo_changed/);
const alias={...designed,reference:referenceOf('alias',designed.descriptor)};assert.equal(resolve({...input,candidates:[...input.candidates,alias]}),designed.reference);assert.equal(resolve({...input,candidates:[...input.candidates,alias],plan:{...plan,designedAugmentation:{...plan.designedAugmentation,previousDatasetRef:alias.reference}}}),alias.reference);
assert.throws(()=>resolve({...input,candidates:[...input.candidates,{...alias,samples:[sample('not-same')]}]}),/alias_bytes_differ/);
for(const override of [{purpose:'engineering_fixture'},{identities:{changed:true}},{researchProtocol:{id:'first-round-common-view-r2',revisionRef:ref('other-protocol')}}]){
 const bad=dataset('bad-scope',{overrides:override});assert.throws(()=>resolve({...input,candidates:[...input.candidates,bad]}),/scope_changed|designed_protocol_lineage_conflict/);
}
const unrelated=dataset('unrelated',{overrides:{sourceIndexRef:ref('unrelated-index'),queueRef:ref('unrelated-queue')}});assert.equal(resolve({...input,candidates:[...input.candidates,unrelated]}),designed.reference);assert.throws(()=>resolve({...input,candidates:[...input.candidates,unrelated],learnedDatasetRefs:[unrelated.reference]}),/learned_scope/);
const wrongPrefix=structuredClone(natural);wrongPrefix.manifest.plan.cumulativeSampling.productionRefs[0]=ref('wrong-production');wrongPrefix.manifest.plan.samplingRef=referenceOf('wrong-sampling',wrongPrefix.manifest.plan.cumulativeSampling);assert.throws(()=>resolve({...input,candidates:[base,wrongPrefix,designed]}),/production_prefix/);
console.log('PASS pure augmentation predecessor: actual prefix+explicit retained ancestry, aliases, old-subset/fork/missing-learned/scope rejection; diagnostic predecessor allowed; zero files/models/provider/authority');

// Real old protocol objects and exact allowed revision, without manufacturing
// authority. Candidate samples, identities and original rows stay untouched.
const lineage=buildDesignedProtocolLineageFixture();
const oldProtocol={id:'first-round-common-view-r2',revisionRef:lineage.previousProtocolRef},newProtocol={id:'first-round-common-view-r2',revisionRef:lineage.currentProtocolRef};
const oldBase=dataset('lineage-base',{samples:[sample('lineage-old')],overrides:{researchProtocol:oldProtocol}});
const oldNatural=dataset('lineage-natural',{kind:'cumulative',parent:oldBase,prefix:2,samples:[sample('lineage-old'),sample('lineage-natural')],overrides:{researchProtocol:oldProtocol}});
const newDesign=dataset('lineage-design',{kind:'designed',parent:oldNatural,samples:[...oldNatural.samples,sample('lineage-design')],overrides:{researchProtocol:newProtocol}});
const lineagePlan={...plan,researchProtocol:newProtocol,designedAugmentation:{...plan.designedAugmentation,previousDatasetRef:newDesign.reference}};
const lineageInput={plan:lineagePlan,ordinaryPool,candidates:[oldBase,oldNatural,newDesign],learnedDatasetRefs:[oldBase.reference,oldNatural.reference],references:lineage.references},lineageBefore=structuredClone(lineageInput);
assert.equal(resolve(lineageInput),newDesign.reference,'actual old natural rows survive only the exact current protocol revision');
assert.deepEqual(lineageInput,lineageBefore,'lineage never rewrites old descriptors, samples or identities');
assert.equal(resolve({...lineageInput,plan:{...lineagePlan,designedAugmentation:{...lineagePlan.designedAugmentation,previousDatasetRef:oldNatural.reference}},candidates:[oldBase,oldNatural]}),oldNatural.reference,'first designed freeze can retain actual old cumulative dataset');
assert.throws(()=>resolve({...lineageInput,references:undefined}),/designed_protocol_lineage_conflict/,'no caller boolean or missing references authorizes old scope');
const missingPolicy=new Map(lineage.references);missingPolicy.delete(lineage.previousResourcePolicyRef);
assert.throws(()=>resolve({...lineageInput,references:missingPolicy}),/designed_protocol_lineage_conflict/,'actual previous policy must be present and bound');
const changedIdentity=dataset('lineage-changed-identity',{overrides:{researchProtocol:oldProtocol,identities:{...identities,promptRef:ref('changed-prompt')}}});
assert.throws(()=>resolve({...lineageInput,candidates:[...lineageInput.candidates,changedIdentity]}),/scope_changed/,'protocol lineage cannot relax any dataset identity');
const unrelatedProtocol=dataset('lineage-other-revision',{overrides:{researchProtocol:{...oldProtocol,revisionRef:ref('unrelated-protocol')}}});
assert.throws(()=>resolve({...lineageInput,candidates:[...lineageInput.candidates,unrelatedProtocol]}),/designed_protocol_lineage_conflict/,'only the explicit direct previous protocol is compatible');
const mutatedCumulative=structuredClone(oldNatural);mutatedCumulative.manifest.plan.cumulativeSampling.protocolRef=lineage.currentProtocolRef;mutatedCumulative.manifest.plan.samplingRef=referenceOf('mutated-old-cumulative',mutatedCumulative.manifest.plan.cumulativeSampling);
assert.throws(()=>resolve({...lineageInput,candidates:[oldBase,mutatedCumulative,newDesign]}),/cumulative|protocol/,'old cumulative proof is checked against its own original protocol');
console.log('PASS exact protocol lineage: immutable old natural/cumulative ancestry, current designed tip; absent policy, changed identities, unrelated revision and rewritten old cumulative scope rejected');
