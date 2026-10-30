/** Combine actual independent strong answers only; never score a policy. */
import{join}from'node:path';import{readFileSync,existsSync}from'node:fs';
import{HOME,json,fileHash,atomicJson}from'./protocol';
import{normalizeTeachingCards}from'./teacher';
import{createAnswerManifest,assertFrozenExamEvidence,CATEGORIES}from'./exam';
const batch=process.argv[2]??'next';if(!['next','remaining'].includes(batch))throw Error('fixed next or remaining batch required');
const remaining=batch==='remaining',config=json(join(HOME,'config.json')),source=join(HOME,'data/sealed-question-source-001'),answers=join(HOME,'data/sealed-'+batch+'-answers-001'),summary=json(join(answers,'summary.json'));
const planRef=join(source,batch+'-answer-batch-plan.json'),plan=json(planRef),old=join(HOME,'data/sealed-exam-bank-'+(remaining?'002':'001')),previous=json(join(old,'partial-skills-manifest.json'));
if(summary.status!=='completed'||summary.completedRoots!==(remaining?8:2)||fileHash(plan.input)!==plan.inputSHA256)throw Error('actual fixed answer batch must be completed unchanged');
assertFrozenExamEvidence(previous);
const cards=readFileSync(join(answers,'strong-cards.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
const admitted=normalizeTeachingCards(cards,json(config.sourceIndexRef),'sealed');
if(admitted.rejected.length||admitted.labels.length!==summary.accepted||admitted.labels.some(l=>l.evidenceTier!=='strong'||l.split!=='sealed'))throw Error('new sealed admission differs from actual producer');
if(!admitted.labels.length){console.log(JSON.stringify({scope:'no new supported answer; preserve previous bank',currentBank:old,newStrong:0,noScores:true}));process.exit(0);}
const labels=[...json(previous.labelsRef),...admitted.labels];
if(new Set(labels.map(l=>l.rootKey)).size!==labels.length||new Set(labels.map(l=>l.sourceFamilyId)).size!==labels.length)throw Error('this single-root batch must add independent families');
const output=join(HOME,'data/sealed-exam-bank-'+(remaining?'003':'002'));if(existsSync(output))throw Error('preserve existing partial bank');
const labelsRef=join(output,'labels.json');atomicJson(labelsRef,labels);
const sourceQueueRef=join(output,'partial-source-queue.json');atomicJson(sourceQueueRef,{schema:'r62-partial-exam-source-queue-v1',candidateScoresUsed:false,familyIds:labels.map(l=>l.sourceFamilyId),previousManifestRef:join(old,'partial-skills-manifest.json'),previousManifestSHA256:fileHash(join(old,'partial-skills-manifest.json')),sourceManifestRef:join(source,'manifest.json'),sourceManifestSHA256:fileHash(join(source,'manifest.json')),fixedProposalRef:plan.input,fixedProposalSHA256:plan.inputSHA256,planRef,planSHA256:fileHash(planRef),allBatchResultsRef:join(answers,'summary.json'),allBatchResultsSHA256:fileHash(join(answers,'summary.json')),selectionRule:'fixed public hypotheses with independent strong support only; no N/O candidate scores; unknown roots remain documented'});
const families=labels.map(l=>({sourceFamilyId:l.sourceFamilyId,category:json(l.rootRef).category,rootKeys:[l.rootKey]}));
const manifest=createAnswerManifest({kind:'skills60',labelsRef,labelsSHA256:fileHash(labelsRef),families,sourceQueueRef,sourceQueueSHA256:fileHash(sourceQueueRef),sourceIndexRef:config.sourceIndexRef},json(config.sourceIndexRef));
if(manifest.readiness.ready)throw Error('partial bank must not become a complete exam');assertFrozenExamEvidence(manifest);atomicJson(join(output,'partial-skills-manifest.json'),manifest);
const report={scope:'partial sealed answers only; no scores, attempt or gradients',newStrong:admitted.labels.length,skillsFamilies:families.length,skillsRoots:labels.length,missingFamiliesByCategory:Object.fromEntries(CATEGORIES.map(c=>[c,15-families.filter(f=>f.category===c).length])),requiredSkillsFamilies:60,requiredSkillsRoots:75,conditionPairs:0,severeFamilies:0,resourceCoverage:manifest.resourceCoverage,readiness:manifest.readiness,unsupportedAnswerRoots:summary.reports.filter((r:any)=>!r.accepted).map((r:any)=>r.rootId)};
atomicJson(join(output,'summary.json'),report);console.log(JSON.stringify({output,...report}));
