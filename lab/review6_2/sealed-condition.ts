/** One prospective sealed family; reuse the immutable proof and exam consumer. */
import{existsSync,readdirSync,writeFileSync,mkdirSync}from'node:fs';import{join}from'node:path';
import{dealtFamilyBeforeExchange}from'../review6/training-ancestry';
import{HOME,ROOT,json,hash,fileHash,atomicJson,bindFamilies}from'./protocol';
import{nativeParent,declaredDeal,makeVariant,certify}from'./resource-coverage';
import{normalizeTeachingCards}from'./teacher';
import{createAnswerManifest,assertFrozenExamEvidence}from'./exam';
const TEMPLATE=[1,5,7,11,10];
const fingerprint=(v:number[])=>hash(JSON.stringify(Array.from(Float32Array.from(v))));

function knownInputs(){
 const books=new Set<string>(),rootRefs=new Set<string>(),comparisons:any[]=[],seen=new Map<string,string>();
 for(const name of readdirSync(join(HOME,'runs'))){const path=join(HOME,'runs',name,'manifest.json');if(!existsSync(path))continue;const m=json(path);if(m.scope==='main_training'&&m.config?.teacherSetRef)books.add(m.config.teacherSetRef);}
 for(const book of books){comparisons.push({kind:'consumed main teacher book',path:book,sha256:fileHash(book)});for(const l of json(book)){for(const v of[...l.plus,...l.minus]){if(v.length!==399)throw Error('known teacher input must have399 values');seen.set(fingerprint(v),book);}rootRefs.add(l.rootRef);}}
 const dev=join(HOME,'data/dev-roots-001/manifest.json');if(existsSync(dev)){comparisons.push({kind:'registered dev root manifest',path:dev,sha256:fileHash(dev)});for(const r of json(dev).roots)rootRefs.add(r.rootRef);}
 for(const name of readdirSync(join(HOME,'data')).filter(n=>/^sealed-exam-bank-00[123]$/.test(n))){const path=join(HOME,'data',name,'partial-skills-manifest.json');if(existsSync(path)){comparisons.push({kind:'prior partial sealed manifest',path,sha256:fileHash(path)});for(const r of json(path).roots)rootRefs.add(r.rootRef);}}
 for(const path of rootRefs){const r=json(path);comparisons.push({kind:'known teaching/dev/sealed public root',path,sha256:fileHash(path)});for(const c of r.allCandidates){if(!c.features68||c.features68.length!==68)throw Error('known root candidate feature coverage missing');seen.set(fingerprint([...r.observedBefore.modelState331,...c.features68]),path);}}
 return{seen,comparisons,knownRootCount:rootRefs.size,uniqueKnownInputCount:seen.size,scope:'actual main-run teacher books, registered dev-roots and partial banks001..003 only; not exhaustive RL trajectory vector enumeration'};
}

export function constructSealedCondition(config:any,parentDirectory:string,output:string){
 const started=performance.now(),cpu=process.cpuUsage(),collectionRef=join(parentDirectory,'summary.json'),collection=json(collectionRef);
 if(collection.status!=='completed'||collection.split!=='sealed'||collection.roots.length>1)throw Error('one completed new sealed native parent collection required');
 if(existsSync(output)||existsSync(join(HOME,'data/sealed-exam-bank-004')))throw Error('preserve previous sealed production');
 mkdirSync(output,{recursive:true});
 const planRef=join(ROOT,'docs/superpowers/plans/2026-10-30-guandan-review6-2-t5-sealed-condition.md');
 atomicJson(join(output,'manifest.json'),{split:'sealed',category:'context_sensitive_candidate',template:TEMPLATE,planRef,planSHA256:fileHash(planRef),sourceSummaryRef:collectionRef,sourceSummarySHA256:fileHash(collectionRef),candidateScoresUsed:false,fixedDirectionBeforeContinuation:true});
 const finish=(extra:any)=>{const used=process.cpuUsage(cpu),result={status:'completed',split:'sealed',...extra,wallSeconds:(performance.now()-started)/1000,measuredProcessCPUSeconds:(used.user+used.system)/1e6,newGradientUpdates:0,candidateScoresUsed:false,formalAttempt:0};atomicJson(join(output,'summary.json'),result);return result;};
 if(collection.roots.length===0)return finish({acceptedFamily:false,reason:'bounded native collection had no eligible parent',newStrongRoots:0});
 const parent=nativeParent(collection.roots[0].rootRef,output),deal=declaredDeal(parent,TEMPLATE),family=dealtFamilyBeforeExchange(deal.initial);
 bindFamilies(config.sourceIndexRef,[parent.sourceFamilyId,family],'sealed','sealed-conditional:'+parent.ordinal);
 atomicJson(join(output,'deal-input.json'),{parentRef:parent.parentRef,parentSHA256:fileHash(parent.parentRef),initialIds:deal.hands,template:TEMPLATE,points:deal.points,level:deal.level,actor:deal.actor,mate:deal.mate,enemyHead:deal.enemyHead,enemy:deal.enemy,givers:deal.givers,sourceFamilyId:parent.sourceFamilyId,declaredRoundFamilyId:family,distribution:'constructed actual resistance and legal burn, not natural frequency'});
 const variants=['A','B'].map(v=>{const r=makeVariant(parent,deal,v as'A'|'B','r62-sealed-condition-'+parent.ordinal+'-'+v);r.root.category='context_sensitive_candidate';return r;});
 const known=knownInputs(),overlaps:any[]=[],inputRows:any[]=[];
 for(const v of variants){const root=v.root,ids=Object.values(v.pair);for(const id of ids){const a=root.allCandidates.find(c=>c.actionId===id)!;const key=fingerprint([...root.observedBefore.modelState331,...a.features68]);inputRows.push({rootId:root.rootId,actionId:id,featureSHA256:key});if(known.seen.has(key))overlaps.push({rootId:root.rootId,actionId:id,featureSHA256:key,priorRef:known.seen.get(key)});}}
 atomicJson(join(output,'input-novelty.json'),{comparisons:known.comparisons,knownRootCount:known.knownRootCount,uniqueKnownInputCount:known.uniqueKnownInputCount,scope:known.scope,inputRows,overlaps});
 // Persist both fixed hypotheses before any continuation, including duplicate failures.
 for(const v of variants){const dir=join(output,v.root.rootId.endsWith('-A')?'A':'B');mkdirSync(dir);atomicJson(join(dir,'root.json'),v.root);atomicJson(join(dir,'prefix.json'),v.prefix);atomicJson(join(dir,'fixed-hypothesis.json'),v.pair);}
 if(overlaps.length)return finish({acceptedFamily:false,reason:'known teaching/dev/sealed input copy; no replacement',newStrongRoots:0,overlaps});
 const results=variants.map((v,i)=>certify(config,join(output,i===0?'A':'B'),v,'sealed','r62-sealed-condition'));
 atomicJson(join(output,'pair-results.json'),results);
 if(!results.every(r=>r.accepted))return finish({acceptedFamily:false,reason:'one or both fixed directions unsupported; no flip/replacement',newStrongRoots:results.filter(r=>r.accepted).length,results});
 const cards=results.map(r=>r.card),admitted=normalizeTeachingCards(cards,json(config.sourceIndexRef),'sealed');
 if(admitted.rejected.length||admitted.labels.length!==2||new Set(admitted.labels.map(l=>l.sourceFamilyId)).size!==1)throw Error('sealed conditional admission mismatch');
 writeFileSync(join(output,'cards.jsonl'),cards.map(c=>JSON.stringify(c)).join('\n')+'\n');atomicJson(join(output,'labels.json'),admitted.labels);
 const previousRef=join(HOME,'data/sealed-exam-bank-003/partial-skills-manifest.json'),previous=json(previousRef);assertFrozenExamEvidence(previous);
 const labels=[...json(previous.labelsRef),...admitted.labels],bank=join(HOME,'data/sealed-exam-bank-004'),labelsRef=join(bank,'labels.json');atomicJson(labelsRef,labels);
 const families=[...previous.families,{sourceFamilyId:parent.sourceFamilyId,category:'context_sensitive_candidate',rootKeys:admitted.labels.map(l=>l.rootKey)}];
 const sourceQueueRef=join(bank,'partial-source-queue.json');atomicJson(sourceQueueRef,{schema:'r62-partial-exam-source-queue-v1',candidateScoresUsed:false,familyIds:families.map(f=>f.sourceFamilyId),previousManifestRef:previousRef,previousManifestSHA256:fileHash(previousRef),constructionManifestRef:join(output,'manifest.json'),constructionManifestSHA256:fileHash(join(output,'manifest.json')),pairResultsRef:join(output,'pair-results.json'),pairResultsSHA256:fileHash(join(output,'pair-results.json')),noveltyRef:join(output,'input-novelty.json'),noveltySHA256:fileHash(join(output,'input-novelty.json'))});
 const manifest=createAnswerManifest({kind:'skills60',labelsRef,labelsSHA256:fileHash(labelsRef),families,sourceQueueRef,sourceQueueSHA256:fileHash(sourceQueueRef),sourceIndexRef:config.sourceIndexRef},json(config.sourceIndexRef));
 if(manifest.readiness.ready||families.length!==5||manifest.roots.length!==6)throw Error('only one partial conditional family may be added');assertFrozenExamEvidence(manifest);atomicJson(join(bank,'partial-skills-manifest.json'),manifest);
 const summary={scope:'partial sealed answers only; no scores or candidate selection',skillsFamilies:5,skillsRoots:6,conditionPairs:1,severeFamilies:0,resourceCoverage:manifest.resourceCoverage,readiness:manifest.readiness};atomicJson(join(bank,'summary.json'),summary);
 return finish({acceptedFamily:true,newStrongRoots:2,bank,skillsFamilies:5,skillsRoots:6,conditionPairs:1,level:deal.level,points:deal.points,actor:deal.actor,nativeParentGames:parent.replayedNativeGames,results});
}
