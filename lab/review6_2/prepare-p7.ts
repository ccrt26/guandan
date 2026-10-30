/** Deterministic metadata preparation for the reviewed P7 experiment. */
import{join}from'node:path';import{HOME,ROOT,json,fileHash,atomicJson,codeIdentity,readCheckpoint,assertTrainingLabels}from'./protocol';import{assertAppendBook,NUMERICAL_FILES}from'./curriculum';
const directory=join(HOME,'runs/r62-p6-natural'),old=json(join(directory,'manifest.json')),cp=readCheckpoint(directory),oldBook=json(old.config.teacherSetRef),added=json(join(HOME,'data/p7-new-weak-book-001/labels.json')),book=[...oldBook,...added];
if(cp.state.absoluteUpdate!==400||added.length!==14)throw Error('fixed P6-400 and reviewed14 weak required');
assertAppendBook(oldBook,book,added.map((l:any)=>l.labelId));assertTrainingLabels(book,false,json(old.config.sourceIndexRef));
const teacherSetRef=join(HOME,'data/p7-teacher-set-001/labels.json');atomicJson(teacherSetRef,book);
const planRef=join(ROOT,'docs/superpowers/plans/2026-10-29-guandan-review6-2-p7-midgame.md'),science=join(HOME,'receipts/T4-P7-plan-science-review.txt'),learning=join(HOME,'receipts/T4-P7-plan-learning-review.txt');
const prior=json(old.config.runtimeMigrationRef),semantics=prior.unchangedNumericalSemantics;
if(semantics.length!==NUMERICAL_FILES.length||semantics.some((r:any)=>fileHash(join(ROOT,r.path))!==r.sha256))throw Error('P6 numerical core changed');
const equivalenceRef=join(HOME,'receipts/T4-P7-runtime-preflight.json');
atomicJson(equivalenceRef,{scope:'pre-bootstrap evidence; actual new-run Node/learner equivalence still required',baseNumericalFilesUnchanged:semantics.length,pythonActualP6StateTests:{passed:2,seconds:.593,checks:['model','RMSprop','Torch RNG','Python RNG','old exposures','new zero','default base strict guard']},nodeLocalTests:{passed:7,checks:['control order','absolute rotation95/96 for16 appended','duplicate family','strict append','old curriculum guards']},sources:['curriculum_learner.py','teacher-schedule.ts'].map(p=>({path:join(HOME,p),sha256:fileHash(join(HOME,p))}))});
const runtimeMigrationRef=join(HOME,'data/p7-runtime-migration.json');
atomicJson(runtimeMigrationRef,{fromRun:'r62-p6-natural',oldCodeIdentity:old.codeIdentity,newCodeIdentity:codeIdentity(),unchangedNumericalSemantics:semantics,equivalenceRef,equivalenceSHA256:fileHash(equivalenceRef),planRef,planSHA256:fileHash(planRef)});
const curriculumUpgradeRef=join(HOME,'data/p7-curriculum-append.json'),sourceManifestRef=join(HOME,'data/midgame-source-roots-003/manifest.json');
atomicJson(curriculumUpgradeRef,{kind:'append-public-midgame-v1',fromRun:'r62-p6-natural',fromUpdate:400,fromIdentity:old.identity,fromCheckpoint:cp.path,fromCheckpointSHA256:fileHash(join(cp.path,'manifest.json')),fromManifestSHA256:fileHash(join(directory,'manifest.json')),oldRef:old.config.teacherSetRef,oldSHA256:cp.state.teacherSetSHA256,newRef:teacherSetRef,newSHA256:fileHash(teacherSetRef),oldLabelIds:oldBook.map((l:any)=>l.labelId),allowedAddedLabelIds:added.map((l:any)=>l.labelId),sourceManifestRef,sourceManifestSHA256:fileHash(sourceManifestRef)});
const teacherSchedule={kind:'fixed-strong5-weak5-v1',fromUpdate:400};
for(const treatment of[false,true]){
 const name=treatment?'midgame':'control',runId='r62-p7-'+name,bookRef=treatment?teacherSetRef:old.config.teacherSetRef,experimentRef=join(HOME,'data/p7-'+name+'-experiment.json');
 const e={approvalMarker:'APPROVE_P7',experimentId:'P7-midgame-weak-composition-'+name,learningRate:.0001,preferenceMode:'squared_hinge',seed:old.seed,updateTargets:[400,600,800],bootstrapOnlyUpdate:400,primaryEndpoint:800,teacherSetSHA256:fileHash(bookRef),registrySHA256:fileHash(old.config.registryPath),planRef,planSHA256:fileHash(planRef),reviewRef:science,reviewSHA256:fileHash(science),learningReviewRef:learning,learningReviewSHA256:fileHash(learning),fromRun:'r62-p6-natural',teacherSchedule,runtimeMigrationRef,runtimeMigrationSHA256:fileHash(runtimeMigrationRef),...(treatment?{curriculumUpgradeRef,curriculumUpgradeSHA256:fileHash(curriculumUpgradeRef)}:{})};
 atomicJson(experimentRef,e);
 const config={...old.config,runId,fromRun:'r62-p6-natural',updateTarget:400,teacherSetRef:bookRef,teacherSchedule,experimentRef,experimentSHA256:fileHash(experimentRef),runtimeMigrationRef,runtimeMigrationSHA256:fileHash(runtimeMigrationRef),curriculumUpgradeRef:treatment?curriculumUpgradeRef:null,curriculumUpgradeSHA256:treatment?fileHash(curriculumUpgradeRef):null};
 atomicJson(join(HOME,'p7-'+name+'-config.json'),config);
}
console.log(JSON.stringify({oldRoots:oldBook.length,newWeakRoots:added.length,totalRoots:book.length,teacherSetSHA256:fileHash(teacherSetRef),runtimeCodeIdentity:codeIdentity(),bootstrapOnlyUpdate:400,primaryEndpoint:800}));
