/** Explicit same-input weak→strong upgrade; never an implicit resume override. */
import{join,resolve}from'node:path';import{ROOT,HOME,json,fileHash,codeIdentity}from'./protocol';
export const NUMERICAL_FILES=['lab/review6_2/learner.py','lab/review6_2/evidence.ts','lab/review6/training_core.py','lab/review6/mature-queues.ts','lab/review6/mature-match.ts','lab/review6/training-samples.ts','lab/review6/training-collector.ts','lab/review6/match-play.ts','lab/review6/policy-registry.ts','lab/review6/exact-inference.ts','lab/review6/data-replay.ts','lab/review6/action-effect.ts','lab/review6/training-ancestry.ts','lab/review6/capability-lineage.ts','lab/src/review5_tuning/kscbReplay.ts',...['index','nn/schema','nn/mlp','nn/neuralSeat','nn/wave','player','heuristic','memory','planner','sim','types','legal'].map(p=>'packages/ai/src/'+p+'.ts'),...['index','game','combo','deck','rank','rng','types'].map(p=>'packages/engine/src/'+p+'.ts')];
export function assertBoundContinuationInputs(config:any){
 if(!config.experimentRef){if(config.curriculumUpgradeRef||config.runtimeMigrationRef||config.partnerReplacementRef||config.teacherSchedule||config.anchorUpgradeRef||config.anchorSetRef)throw Error('bound continuation requires reviewed experiment');return;}
 const e=json(config.experimentRef);
 if((e.teacherSchedule||config.teacherSchedule)&&JSON.stringify(e.teacherSchedule)!==JSON.stringify(config.teacherSchedule))throw Error('bound teacher schedule changed');
 if(e.anchorSetRef||e.anchorSetSHA256||config.anchorSetRef||config.anchorSetSHA256)if(!config.anchorSetRef||config.anchorSetRef!==e.anchorSetRef||config.anchorSetSHA256!==e.anchorSetSHA256||fileHash(config.anchorSetRef)!==config.anchorSetSHA256||!config.anchorUpgradeRef)throw Error('bound anchor-set reference changed or missing');
 const fields=['curriculumUpgrade','runtimeMigration','partnerReplacement','anchorUpgrade'].filter(k=>e[k+'Ref']||e[k+'SHA256']||config[k+'Ref']||config[k+'SHA256']);if(!fields.length)return;
 for(const k of fields)if(!e[k+'Ref']||!config[k+'Ref']||!e[k+'SHA256']||!config[k+'SHA256']||e[k+'Ref']!==config[k+'Ref']||e[k+'SHA256']!==config[k+'SHA256']||fileHash(config[k+'Ref'])!==config[k+'SHA256'])throw Error('bound continuation input changed: '+k);
 if(typeof config.fromRun!=='string'||e.fromRun!==config.fromRun)throw Error('bound continuation parent changed');
 if(config.runtimeMigrationRef)assertRuntimeMigration(config,json(config.runtimeMigrationRef).oldCodeIdentity);
}
export function assertTierUpgrade(old:any[],fresh:any[],allowed:string[]){
 if(old.length!==fresh.length||new Set(allowed).size!==allowed.length)throw Error('curriculum roots/allowlist changed');
 const changed=new Set<string>(),mutable=new Set(['evidenceTier','weight','statisticsRef','statisticsSHA256','statisticsRefs','proposalIds','claim']);
 for(let i=0;i<old.length;i++){
  const a=old[i],b=fresh[i];
  for(const k of['labelId','rootKey','sourceFamilyId','rootRef','rootSHA256','split','scope','pairs','plus','minus'])if(JSON.stringify(a[k])!==JSON.stringify(b[k]))throw Error('curriculum input/identity changed: '+k);
  if(JSON.stringify(a)===JSON.stringify(b))continue;
  if(!allowed.includes(a.rootKey))throw Error('unauthorized curriculum root change');
  if(a.evidenceTier!=='weak'||a.weight!==.25||b.evidenceTier!=='strong'||b.weight!==1)throw Error('only weak .25 to strong1 tier upgrade allowed');
  for(const k of new Set([...Object.keys(a),...Object.keys(b)]))if(!mutable.has(k)&&JSON.stringify(a[k])!==JSON.stringify(b[k]))throw Error('curriculum non-tier field changed: '+k);
  changed.add(a.rootKey);
 }
 if(changed.size!==allowed.length||allowed.some(k=>!changed.has(k)))throw Error('every allowed tier upgrade must actually occur');
}
export function continuationUpgrade(config:any,old:any,checkpoint:string,state:any){
 if(!config.curriculumUpgradeRef)return null;
 if(fileHash(config.curriculumUpgradeRef)!==config.curriculumUpgradeSHA256)throw Error('curriculum manifest changed');
 const e=json(config.experimentRef),m=json(config.curriculumUpgradeRef);
 if(e.curriculumUpgradeRef!==config.curriculumUpgradeRef||e.curriculumUpgradeSHA256!==config.curriculumUpgradeSHA256||!['same-pair-weak-to-strong-v1','append-public-midgame-v1','append-declared-conditional-family-v1','append-declared-family-pool-v1'].includes(m.kind)||m.fromRun!==config.fromRun||m.fromUpdate!==state.absoluteUpdate||m.fromCheckpoint!==checkpoint||m.fromCheckpointSHA256!==fileHash(join(checkpoint,'manifest.json'))||m.fromManifestSHA256!==fileHash(join(HOME,'runs',config.fromRun,'manifest.json')))throw Error('reviewed curriculum parent/experiment changed');
 if(config.updateTarget!==state.absoluteUpdate)throw Error('curriculum must first bootstrap at the exact parent update before gradient continuation');
 if(m.oldRef!==old.config.teacherSetRef||m.oldSHA256!==state.teacherSetSHA256||fileHash(m.oldRef)!==m.oldSHA256||m.newRef!==config.teacherSetRef||fileHash(m.newRef)!==m.newSHA256)throw Error('curriculum old/new book binding changed');
 if(m.kind==='same-pair-weak-to-strong-v1')assertTierUpgrade(json(m.oldRef),json(m.newRef),m.allowedRootKeys);
 else if(m.kind==='append-declared-conditional-family-v1'){
  const a=json(m.oldRef),b=json(m.newRef);assertDeclaredConditionalAppend(a,b,m.allowedAddedLabelIds);
  if(m.fromIdentity!==old.identity||JSON.stringify(m.oldLabelIds)!==JSON.stringify(a.map((l:any)=>l.labelId))||fileHash(m.sourceManifestRef)!==m.sourceManifestSHA256)throw Error('declared append source/old ID binding changed');
  const source=json(m.sourceManifestRef),extra=b.slice(a.length);
  if(source.kind!=='fixture'||source.fixtureSplit!=='train'||source.sourceIndexUse!=='train'||source.families?.length!==1||source.families[0].category!=='context_sensitive_candidate'||source.families[0].sourceFamilyId!==extra[0].sourceFamilyId||JSON.stringify(source.families[0].rootKeys)!==JSON.stringify(extra.map((l:any)=>l.rootKey)))throw Error('actual training condition-pair prototype required');
  if(config.teacherSchedule?.kind!=='fixed-strong5-family2-weak5-v1'||config.teacherSchedule.fromUpdate!==1400||config.teacherSchedule.familyId!==extra[0].sourceFamilyId||JSON.stringify(config.teacherSchedule.addedLabelIds)!==JSON.stringify(m.allowedAddedLabelIds))throw Error('declared family append schedule mismatch');
 }
 else if(m.kind==='append-declared-family-pool-v1'){
  const a=json(m.oldRef),b=json(m.newRef);assertDeclaredCoverageAppend(a,b,m.allowedAddedLabelIds,m.familyPool);
  if(m.fromIdentity!==old.identity||m.fromRun!=='r62-p8c-control'||m.fromUpdate!==1400||JSON.stringify(m.oldLabelIds)!==JSON.stringify(a.map((l:any)=>l.labelId))||fileHash(m.sourceManifestRef)!==m.sourceManifestSHA256||fileHash(m.newLabelsRef)!==m.newLabelsSHA256||fileHash(m.originalLabelsRef)!==m.originalLabelsSHA256||fileHash(m.reusedControlManifestRef)!==m.reusedControlManifestSHA256||fileHash(m.reusedControlBookRef)!==m.reusedControlBookSHA256)throw Error('coverage source/original/control identity changed');
  const source=json(m.sourceManifestRef),baseline=json(m.reusedControlManifestRef),original=json(m.originalLabelsRef),added=json(m.newLabelsRef),controlBook=json(m.reusedControlBookRef);
  if(source.status!=='completed'||source.split!=='train'||source.acceptedNewFamilies!==m.familyPool.length-1||source.newStrongRoots!==added.length||source.actuallyNovelRootVectors<1||JSON.stringify(b.slice(a.length))!==JSON.stringify([...original,...added])||JSON.stringify(b.slice(0,12))!==JSON.stringify(controlBook)||baseline.runId!=='r62-p9c-resource'||baseline.upstream.checkpoint!==checkpoint||baseline.config.teacherSetRef!==m.reusedControlBookRef)throw Error('coverage must preserve actual old control and add actual new training families');
  if(config.teacherSchedule?.kind!=='fixed-strong5-family-pool-weak5-v1'||config.teacherSchedule.fromUpdate!==1400||JSON.stringify(config.teacherSchedule.familyPool)!==JSON.stringify(m.familyPool))throw Error('coverage pool/schedule mismatch');
 }
 else{
  const a=json(m.oldRef),b=json(m.newRef);assertAppendBook(a,b,m.allowedAddedLabelIds);
  if(m.fromIdentity!==old.identity||JSON.stringify(m.oldLabelIds)!==JSON.stringify(a.map((l:any)=>l.labelId))||fileHash(m.sourceManifestRef)!==m.sourceManifestSHA256)throw Error('append source/old ID binding changed');
  const source=json(m.sourceManifestRef);
  if(source.split!=='train'||source.sourcePolicyId!=='r62-p6-natural-u400-greedy'||source.sourcePolicy.weightsSHA256!==fileHash(join(checkpoint,'weights.f32'))||JSON.stringify(source.publicStage)!=='{"minOwnCards":8,"maxOwnCards":20,"minMoveNo":20}')throw Error('append requires frozen P6 public midgame sources');
  for(const l of b.slice(a.length)){const r=json(l.rootRef),ref=source.roots.find((s:any)=>s.rootRef===l.rootRef&&s.rootSHA256===l.rootSHA256),o=r.observedBefore;if(!ref||o.counts[o.actor]<8||o.counts[o.actor]>20||o.statePublic.moveNo<20)throw Error('append root outside reviewed public stage');}
 }
 return{oldTeacherSHA256:m.oldSHA256,manifestRef:config.curriculumUpgradeRef,manifestSHA256:config.curriculumUpgradeSHA256,...(m.kind==='same-pair-weak-to-strong-v1'?{upgradedRoots:m.allowedRootKeys}:{addedTeacherIds:m.allowedAddedLabelIds})};
}
export function assertAppendBook(old:any[],fresh:any[],allowed:string[]){
 if(fresh.length<=old.length||fresh.length-old.length!==allowed.length||new Set(allowed).size!==allowed.length||JSON.stringify(fresh.slice(0,old.length))!==JSON.stringify(old)||JSON.stringify(fresh.slice(old.length).map(l=>l.labelId))!==JSON.stringify(allowed))throw Error('only exact appended roots; old book cannot change');
 if(new Set(fresh.map(l=>l.sourceFamilyId)).size!==fresh.length||fresh.slice(old.length).some(l=>l.split!=='train'||l.scope!=='main'||l.evidenceTier!=='weak'||l.weight!==.25))throw Error('append only distinct train weak roots');
}
export function assertPartnerReplacement(old:any,fresh:any){
 if(JSON.stringify({...fresh,trainingOtherPartnerPool:old.trainingOtherPartnerPool})!==JSON.stringify(old)||JSON.stringify(fresh.trainingOtherPartnerPool)!==JSON.stringify([old.cleanStudent,old.oldCompletePolicy])||new Set(fresh.trainingOtherPartnerPool).size!==2||fresh.trainingOtherPartnerPool.some((id:string)=>!old.trainingPool.includes(id)))throw Error('only the two reviewed existing training partners may replace other pool');
 if(old.trainingOtherPartnerPool.length!==2||old.trainingOtherPartnerPool.some((id:string)=>old.policies.find((p:any)=>p.policyId===id)?.kind!=='heuristic'))throw Error('partner replacement requires original two heuristic controls');
}
export function continuationPartnerReplacement(config:any,old:any,checkpoint:string,state:any){
 if(!config.partnerReplacementRef)return null;
 const m=json(config.partnerReplacementRef),e=json(config.experimentRef);
 if(fileHash(config.partnerReplacementRef)!==config.partnerReplacementSHA256||e.partnerReplacementRef!==config.partnerReplacementRef||e.partnerReplacementSHA256!==config.partnerReplacementSHA256||m.kind!=='existing-training-partner-replacement-v1'||m.fromRun!==config.fromRun||m.fromUpdate!==state.absoluteUpdate||m.fromIdentity!==old.identity||m.fromCheckpoint!==checkpoint||m.fromCheckpointSHA256!==fileHash(join(checkpoint,'manifest.json'))||m.fromManifestSHA256!==fileHash(join(HOME,'runs',config.fromRun,'manifest.json')))throw Error('partner replacement parent/experiment changed');
 if(config.updateTarget!==state.absoluteUpdate||m.oldRef!==old.config.registryPath||fileHash(m.oldRef)!==m.oldSHA256||m.newRef!==config.registryPath||fileHash(m.newRef)!==m.newSHA256)throw Error('partner replacement first requires exact-parent bootstrap and registry binding');
 assertPartnerReplacement(json(m.oldRef),json(m.newRef));
 return{oldRegistrySHA256:m.oldSHA256,manifestRef:config.partnerReplacementRef,manifestSHA256:config.partnerReplacementSHA256};
}
export function assertRuntimeMigration(config:any,oldCodeIdentity:string){
 if(!config.runtimeMigrationRef)throw Error('explicit reviewed runtime migration required');
 const e=json(config.experimentRef);if(fileHash(config.runtimeMigrationRef)!==config.runtimeMigrationSHA256||e.runtimeMigrationRef!==config.runtimeMigrationRef||e.runtimeMigrationSHA256!==config.runtimeMigrationSHA256)throw Error('runtime migration manifest changed');
 const m=json(config.runtimeMigrationRef);
 if(m.fromRun!==config.fromRun||m.oldCodeIdentity!==oldCodeIdentity||m.newCodeIdentity!==codeIdentity()||m.unchangedNumericalSemantics.length!==NUMERICAL_FILES.length||new Set(m.unchangedNumericalSemantics.map((r:any)=>r.path)).size!==NUMERICAL_FILES.length||m.unchangedNumericalSemantics.some((r:any)=>!NUMERICAL_FILES.includes(r.path)||fileHash(resolve(ROOT,r.path))!==r.sha256)||fileHash(m.equivalenceRef)!==m.equivalenceSHA256||fileHash(m.planRef)!==m.planSHA256)throw Error('unreviewed runtime or numerical semantics change');
 return{path:config.runtimeMigrationRef,sha256:config.runtimeMigrationSHA256,oldCodeIdentity,newCodeIdentity:m.newCodeIdentity};
}

/** Only the reviewed two strong variants may be appended; preserve old book. */
export function assertDeclaredConditionalAppend(old:any[],fresh:any[],allowed:string[]){
 const extra=fresh.slice(old.length);
 if(old.length!==10||fresh.length!==12||allowed.length!==2||new Set(allowed).size!==2||JSON.stringify(fresh.slice(0,old.length))!==JSON.stringify(old)||JSON.stringify(extra.map(l=>l.labelId))!==JSON.stringify(allowed)||new Set(fresh.map(l=>l.labelId)).size!==12)throw Error('only exact old10 plus two declared roots allowed');
 const families=new Set(old.map(l=>l.sourceFamilyId));
 if(families.size!==10||extra[0].sourceFamilyId!==extra[1].sourceFamilyId||families.has(extra[0].sourceFamilyId)||extra.some(l=>l.split!=='train'||l.scope!=='main'||l.evidenceTier!=='strong'||l.weight!==1||l.evidenceKind!=='declared-deal-target-bound-v1'||l.pairs?.length!==1||fileHash(l.rootRef)!==l.rootSHA256))throw Error('new distinct train strong family required');
 const roots=extra.map(l=>json(l.rootRef)),keys=roots.map((r,i)=>{const p=extra[i].pairs[0];return [p.preferredActionId,p.otherActionId].map(id=>r.allCandidates.find((c:any)=>c.actionId===id)?.actionKey);});
 if(roots.some((r,i)=>r.sourceFamilyId!==extra[i].sourceFamilyId)||JSON.stringify(roots[0].observedBefore.modelState331)===JSON.stringify(roots[1].observedBefore.modelState331)||keys.flat().some(k=>!k)||keys[0][0]!==keys[1][1]||keys[0][1]!==keys[1][0]||keys[0][0]===keys[0][1])throw Error('actual shared-action conditional reversal required');
}

export function assertDeclaredCoverageAppend(old:any[],fresh:any[],allowed:string[],pool:any[]){
 if(!Array.isArray(pool)||pool.length<1||pool.length>5||fresh.length!==10+2*pool.length||old.length!==10||allowed.length!==2*pool.length||new Set(allowed).size!==allowed.length||JSON.stringify(fresh.slice(0,10))!==JSON.stringify(old)||JSON.stringify(fresh.slice(10).map(l=>l.labelId))!==JSON.stringify(allowed)||new Set(fresh.map(l=>l.labelId)).size!==fresh.length||new Set(pool.map(g=>g.sourceFamilyId)).size!==pool.length)throw Error('only exact old10 plus reviewed complete-family pool allowed');
 const ids=new Set<string>();
 for(const group of pool){
  if(!Array.isArray(group.labelIds)||group.labelIds.length!==2||group.labelIds.some((id:string)=>ids.has(id)))throw Error('complete distinct family root IDs required');
  const pair=group.labelIds.map((id:string)=>fresh.slice(10).find(l=>l.labelId===id));if(pair.some((l:any)=>!l||l.sourceFamilyId!==group.sourceFamilyId))throw Error('family pool source mismatch');
  assertDeclaredConditionalAppend(old,[...old,...pair],group.labelIds);group.labelIds.forEach((id:string)=>ids.add(id));
 }
 if(ids.size!==allowed.length||allowed.some(id=>!ids.has(id)))throw Error('coverage pool must bind every appended root exactly once');
}
