import{readFileSync,existsSync,realpathSync}from'node:fs';
import{deriveSeed}from'@gd/ai';
import{sampleVisibleWorld}from'../review6/visible-world';import{rootCandidates}from'../review6/teacher-roots';
import type{PolicySpec}from'../review6/match-play';
import{assertTeachingEvidence}from'./teaching-evidence';import{scoreRoot}from'./evaluate';
import{json,fileHash,rootKey,atomicJson,hash,readRegistry,PROTOCOL,HOME}from'./protocol';
import{LEDGER_PATH,attemptBinding,assertFrozenExecution}from'./confirmation';
import{resolve}from'node:path';

export const CATEGORIES=['cooperation_open','cooperation_urgent','resource_structure','context_sensitive_candidate'];
const BOMBS=new Set(['bomb','flush','joker_bomb']);
function assertFixtureScope(split:any,indexRef:any){
 if(!['train','dev'].includes(split))throw Error('fixture requires nonsealed train or dev split');
 if(typeof indexRef!=='string'||!existsSync(indexRef)||realpathSync(indexRef)!==realpathSync(resolve(HOME,'data/source-index.json')))throw Error('fixture requires canonical project source index');
}
export function answerPartition(legal:string[],pairs:any[]){
 const edges=new Map<string,string[]>(),all=new Set(legal);
 for(const p of pairs){if(!all.has(p.preferredActionId)||!all.has(p.otherActionId)||p.preferredActionId===p.otherActionId)throw Error('answer pair outside legal actions');edges.set(p.preferredActionId,[...(edges.get(p.preferredActionId)??[]),p.otherActionId]);}
 const done=new Set(),visiting=new Set();
 const visit=(v:string)=>{if(visiting.has(v))throw Error('strong answer preference cycle');if(done.has(v))return;visiting.add(v);for(const w of edges.get(v)??[])visit(w);visiting.delete(v);done.add(v);};
 for(const v of all)visit(v);
 const bad=new Set(pairs.map(p=>p.otherActionId)),good=new Set(pairs.map(p=>p.preferredActionId).filter(v=>!bad.has(v)));
 return{legal:[...legal],supported:[...good]as string[],contradicted:[...bad]as string[],unverified:legal.filter(id=>!good.has(id)&&!bad.has(id))};
}
export function answerChoice(answer:any,id:string){
 if(!answer.legal.includes(id))return'illegal';
 if(answer.supported.includes(id))return'supported';if(answer.contradicted.includes(id))return'contradicted';return'unverified';
}
export function severityChoice(root:any,id:string){
 if(root.severeErrorActionIds.includes(id))return'confirmed_severe';
 if(root.partition.supported.includes(id))return'nonsevere';return'unknown';
}
function actionClass(c:any){return c.move.pass?'pass':JSON.stringify({kind:c.move.combo.kind,size:c.move.combo.size,mainRank:c.move.combo.mainRank,length:c.move.combo.length,resources:c.move.combo.cards.map((v:any)=>v.suit+':'+v.rank).sort(),wildAs:c.move.combo.wildAs.map((v:any)=>[v.asRank,v.asSuit]).sort()});}
function answerRoot(label:any,index:any,split:string,severeErrorActionIds:string[]=[]){
 if(label.evidenceTier!=='strong'||label.split!==split||index.families?.[label.sourceFamilyId]?.split!==split||fileHash(label.rootRef)!==label.rootSHA256)throw Error('exam requires correct source split and strong root identity');
 const root=json(label.rootRef);if(rootKey(root)!==label.rootKey||root.observedBefore.representationGaps.length)throw Error('exam root identity/representation gap');
 assertTeachingEvidence(label,root,label.rootKey,index,split);
 const world=sampleVisibleWorld(root.observedBefore,deriveSeed('review6-2-exam-admission-v1',20261029,0,root.observedBefore.observationSHA256)),candidates=rootCandidates(world.state),partition=answerPartition(candidates.map(c=>c.actionId),label.pairs);
 if(!partition.supported.length||severeErrorActionIds.some(id=>!partition.contradicted.includes(id)))throw Error('exam supported/severe set lacks evidence');
 const remainderStructure=(candidate:any)=>{
  const used=new Set(candidate.move.combo.cards.map((c:any)=>c.id)),hands=world.state.hands.map(h=>[...h]);hands[world.state.turn]=hands[world.state.turn].filter(c=>!used.has(c.id));
  const combinations=rootCandidates({...world.state,hands,lastCombo:null,passCount:0}),counts:any={};for(const c of combinations)if(c.move.combo&&c.move.combo.kind!=='single')counts[c.move.combo.kind]=(counts[c.move.combo.kind]??0)+1;
  return JSON.stringify(Object.entries(counts).sort());
 };
 const pairCoverage=label.pairs.map((p:any)=>{const plus=candidates.find(c=>c.actionId===p.preferredActionId)!,minus=candidates.find(c=>c.actionId===p.otherActionId)!;return{
  four:plus.move.combo?.kind==='bomb'&&plus.move.combo.size===4&&minus.move.combo?.kind==='bomb'&&minus.move.combo.size===5,
  five:plus.move.combo?.kind==='bomb'&&plus.move.combo.size===5&&minus.move.combo?.kind==='bomb'&&minus.move.combo.size===4,
  nonbomb:!!plus.move.combo&&!!minus.move.combo&&!BOMBS.has(plus.move.combo.kind)&&!BOMBS.has(minus.move.combo.kind)&&remainderStructure(plus)!==remainderStructure(minus),
 };});
 return{rootKey:label.rootKey,sourceFamilyId:label.sourceFamilyId,rootRef:label.rootRef,rootSHA256:label.rootSHA256,label,partition,severeErrorActionIds,coverage:{four:pairCoverage.some((p:any)=>p.four),five:pairCoverage.some((p:any)=>p.five),nonbomb:pairCoverage.some((p:any)=>p.nonbomb)},actionClasses:Object.fromEntries(candidates.map(c=>[c.actionId,actionClass(c)])),encodedState:root.observedBefore.modelState331};
}
/** Family counts, unknown actions and release gates stay distinct. */
export function validateFormalShape(manifest:any){
 const reasons:string[]=[],families=manifest.families??[],roots=manifest.roots??[],serious=manifest.kind==='severe24-v2';
 if(!['skills60','severe24-v2'].includes(manifest.kind))reasons.push('fixture is not a formal exam');
 const n=serious?24:60;if(families.length!==n)reasons.push('formal source families must be '+n);
 if(new Set(families.map((f:any)=>f.sourceFamilyId)).size!==families.length)reasons.push('duplicate source family');
 if(new Set(roots.map((r:any)=>r.rootKey)).size!==roots.length)reasons.push('duplicate root');
 const byKey=new Map(roots.map((r:any)=>[r.rootKey,r])),used=new Set<string>();
 for(const f of families){
  if(!Array.isArray(f.rootKeys)||!f.rootKeys.length){reasons.push('every family requires actual question roots');continue;}
  for(const key of f.rootKeys){const r:any=byKey.get(key);if(!r||r.sourceFamilyId!==f.sourceFamilyId||used.has(key))reasons.push('family/root coverage or ancestry mismatch');used.add(key);}
 }
 if(used.size!==roots.length||roots.some((r:any)=>!used.has(r.rootKey)))reasons.push('all roots must be covered exactly once');
 if(!serious){
  if(roots.length!==75)reasons.push('skills exam must contain75 roots');
  for(const c of CATEGORIES)if(families.filter((f:any)=>f.category===c).length!==15)reasons.push(c+' needs15 families');
  if(families.some((f:any)=>f.rootKeys.length!==(f.category==='context_sensitive_candidate'?2:1)))reasons.push('45 singles plus15 condition pairs required');
  const q=manifest.resourceCoverage??{},resource=families.filter((f:any)=>f.category==='resource_structure');
  const actual=Object.fromEntries(['four','five','nonbomb'].map(k=>[k,resource.filter((f:any)=>f.rootKeys?.some((key:string)=>(byKey.get(key)as any)?.coverage?.[k]===true)).length]));
  if(['four','five','nonbomb'].some(k=>!Number.isInteger(q[k])||q[k]!==actual[k]||actual[k]<3))reasons.push('resource coverage needs actual four>=3/five>=3/nonbomb>=3');
 }
 if(serious&&families.some((f:any)=>!f.severityReason||!f.rootKeys.every((key:string)=>roots.find((r:any)=>r.rootKey===key)?.severeErrorActionIds.length)))reasons.push('all24 severe families need explicit evidence-backed severe action sets');
 if(!manifest.sourceQueueRef||!manifest.sourceQueueSHA256||!existsSync(manifest.sourceQueueRef)||fileHash(manifest.sourceQueueRef)!==manifest.sourceQueueSHA256)reasons.push('fixed candidate-independent source queue missing/changed');
 else{const q=json(manifest.sourceQueueRef);if(q.candidateScoresUsed!==false||q.familyIds?.length!==families.length||families.some((f:any)=>!q.familyIds.includes(f.sourceFamilyId)))reasons.push('source queue does not bind all independent families');}
 return{ready:reasons.length===0,reasons};
}
/** Input spec selects pre-existing evidence; it cannot synthesize support. */
export function createAnswerManifest(spec:any,index:any){
 if(spec.kind==='fixture')assertFixtureScope(spec.fixtureSplit,spec.sourceIndexRef);
 if(fileHash(spec.labelsRef)!==spec.labelsSHA256)throw Error('exam label book changed');
 const labels=json(spec.labelsRef),byKey=new Map(labels.map((l:any)=>[l.rootKey,l])),split=spec.kind==='fixture'?spec.fixtureSplit:'sealed';
 const roots:any[]=[],families:any[]=[],used=new Set();
 for(const f of spec.families){
  if(!CATEGORIES.includes(f.category)||!f.rootKeys?.length)throw Error('exam category/root keys required');
  const local=f.rootKeys.map((key:string)=>{
   if(used.has(key)||!byKey.has(key))throw Error('duplicate/missing exam root');used.add(key);
   const r=answerRoot(byKey.get(key),index,split,f.severeErrorActions?.[key]??[]);
   if(r.sourceFamilyId!==f.sourceFamilyId)throw Error('exam variant source ancestry changed');roots.push(r);return r;
  });
  if(f.category==='context_sensitive_candidate'){
   if(local.length!==2||JSON.stringify(local[0].encodedState)===JSON.stringify(local[1].encodedState))throw Error('condition pair needs two encoded public conditions');
   const a=new Set(local[0].partition.supported.map((id:string)=>local[0].actionClasses[id])),b=new Set(local[1].partition.supported.map((id:string)=>local[1].actionClasses[id]));
   if([...a].some(v=>b.has(v)))throw Error('condition pair does not require a changed action');
   const shared=new Set(Object.values(local[0].actionClasses).filter(v=>Object.values(local[1].actionClasses).includes(v)));
   if(![...a].some(v=>shared.has(v))||![...b].some(v=>shared.has(v)))throw Error('condition change is only a legality change');
  }
  families.push({...f});
 }
 const resource=families.filter(f=>f.category==='resource_structure'),coverage=Object.fromEntries(['four','five','nonbomb'].map(k=>[k,resource.filter(f=>f.rootKeys.some((key:string)=>roots.find(r=>r.rootKey===key).coverage[k])).length]));
 const manifest={schema:'r62-exam-v1',kind:spec.kind,fixtureSplit:spec.fixtureSplit??null,families,roots,resourceCoverage:coverage,sourceQueueRef:spec.sourceQueueRef??null,sourceQueueSHA256:spec.sourceQueueSHA256??null,labelsRef:spec.labelsRef,labelsSHA256:spec.labelsSHA256,sourceIndexRef:spec.sourceIndexRef??null,sourceIndexUse:split,scope:spec.kind==='fixture'?'engineering/teaching-source prototype; no heldout exam claim':'candidate-independent fixed questions and explicit partial action evidence'};
 return{...manifest,readiness:validateFormalShape(manifest)};
}
export function scoreExamFixture(policy:PolicySpec,manifest:any){
 if(manifest.kind!=='fixture')throw Error('sealed scores require shared formal-attempt confirmation entry');
 assertFixtureScope(manifest.fixtureSplit,manifest.sourceIndexRef);
 if(manifest.sourceIndexUse!==manifest.fixtureSplit||manifest.roots.some((r:any)=>r.label?.split!==manifest.fixtureSplit))throw Error('fixture label/source split mismatch');
 assertFrozenExamEvidence(manifest);
 return scoreExam(policy,manifest);
}
/** Internal scorer for the future confirmation entry. An explicit live attempt
 * must bind the immutable candidate and exact exam file before sealed use. */
export function scoreLockedExam(policy:PolicySpec,manifestPath:string,attemptPath:string,oldComparator=false){
 manifestPath=resolve(manifestPath);
 const attempt=json(attemptPath),manifest=json(manifestPath);
 const book=json(LEDGER_PATH),candidate=json(attempt.candidateRef);
 if(book.protocolId!==PROTOCOL||fileHash(attempt.candidateRef)!==attempt.candidateFileSHA256)throw Error('authoritative candidate/ledger changed');
 if(fileHash(candidate.registryPath)!==candidate.registrySHA256)throw Error('frozen comparator registry changed');
 assertFrozenExecution(candidate);
 attemptBinding(attempt,book,attempt.candidateSHA256,attempt.policySHA256,manifestPath,fileHash(manifestPath));
 if(oldComparator){const registry=readRegistry({registryPath:candidate.registryPath}),old=registry.policies.find(p=>p.policyId===registry.oldCompletePolicy);if(hash(JSON.stringify(old))!==hash(JSON.stringify(policy)))throw Error('old comparator policy changed');}
 else if(hash(JSON.stringify(policy))!==attempt.policySHA256||policy.weightsSHA256!==attempt.candidateSHA256)throw Error('full frozen candidate policy changed');
 if(!validateFormalShape(manifest).ready)throw Error('formal exam not ready');assertFrozenExamEvidence(manifest);
 return scoreExam(policy,manifest);
}
export function assertFrozenExamEvidence(manifest:any){
 if(!manifest.sourceIndexRef)throw Error('formal source index ref required');
 const rebuilt=createAnswerManifest({kind:manifest.kind,fixtureSplit:manifest.fixtureSplit,labelsRef:manifest.labelsRef,labelsSHA256:manifest.labelsSHA256,families:manifest.families,sourceQueueRef:manifest.sourceQueueRef,sourceQueueSHA256:manifest.sourceQueueSHA256,sourceIndexRef:manifest.sourceIndexRef},json(manifest.sourceIndexRef));
 if(JSON.stringify(rebuilt.roots)!==JSON.stringify(manifest.roots)||JSON.stringify(rebuilt.resourceCoverage)!==JSON.stringify(manifest.resourceCoverage))throw Error('persisted answers/coverage differ from actual fixed evidence');
 return rebuilt;
}
function scoreExam(policy:PolicySpec,manifest:any){
 const decisions=manifest.roots.map((r:any)=>{
  if(fileHash(r.rootRef)!==r.rootSHA256)throw Error('frozen question root changed');
  const chosen=scoreRoot(policy,json(r.rootRef)),status=answerChoice(r.partition,chosen.actionId);
  const severityStatus=severityChoice(r,chosen.actionId);
  return{rootKey:r.rootKey,actionId:chosen.actionId,status,severityStatus,requiresSeverity:manifest.kind==='severe24-v2'||r.severeErrorActionIds.length>0,severeError:severityStatus==='confirmed_severe'};
 });
 const families=manifest.families.map((f:any)=>{const rows=f.rootKeys.map((k:string)=>decisions.find((r:any)=>r.rootKey===k)),severityRequired=!!f.severityReason||rows.some((r:any)=>r.requiresSeverity);return{sourceFamilyId:f.sourceFamilyId,category:f.category,passed:rows.every((r:any)=>r.status==='supported'),possiblePass:rows.every((r:any)=>['supported','unverified'].includes(r.status)),unknown:rows.some((r:any)=>r.status==='unverified'),severityUnknown:severityRequired&&rows.some((r:any)=>r.severityStatus==='unknown'),illegal:rows.some((r:any)=>r.status==='illegal'),severeError:rows.some((r:any)=>r.severeError)};});
 return{policyId:policy.policyId,weightsSHA256:policy.weightsSHA256,kind:manifest.kind,passedFamilies:families.filter((f:any)=>f.passed).length,possiblePassedFamilies:families.filter((f:any)=>f.possiblePass).length,possibleCategories:Object.fromEntries(CATEGORIES.map(c=>[c,families.filter((f:any)=>f.category===c&&f.possiblePass).length])),unknownFamilies:families.filter((f:any)=>f.unknown).length,severityUnknownFamilies:families.filter((f:any)=>f.severityUnknown).length,illegalDecisions:decisions.filter((r:any)=>r.status==='illegal').length,severeErrors:families.filter((f:any)=>f.severeError).length,categories:Object.fromEntries(CATEGORIES.map(c=>[c,families.filter((f:any)=>f.category===c&&f.passed).length])),fullyAdjudicated:families.every((f:any)=>!f.unknown&&!f.severityUnknown&&!f.illegal),families,decisions,scope:manifest.kind==='fixture'?'prototype only; teaching-source scores are not generalization':'fixed exam score only; all shared attempt gates still required'};
}
