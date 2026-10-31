/** Finite synthetic B09 checks: no API, matches, weights or updates. */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonicalActionId} from '../../../packages/ai/src/hybrid/legality';
const args=process.argv.slice(2);assert.equal(args.length,2);assert.equal(args[0],'--case');
const which=args[1];assert.ok(['align-and-admit','reject-and-freeze'].includes(which),'unknown B09 case');
globalThis.fetch=async()=>{throw Error('B09 network forbidden');};
assert.ok(existsSync(new URL('../distill-data.ts',import.meta.url)),'B09 exporter implementation required');
const api=await import('../distill-data');
const sha=(v:any)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const base=fileURLToPath(new URL('../../../',import.meta.url));mkdirSync(join(base,'lab/out'),{recursive:true});
const root=mkdtempSync(join(base,'lab/out/B09-'));
const basePolicy={policyId:'synthetic-B',weightsSHA256:'b'.repeat(64),inputDim:399,encoderVersion:'synthetic-399-v1',passEncoding:'action64',epsilon:0};
const profile={profileId:'synthetic-teacher',revision:1,snapshotHash:'c'.repeat(64),credentialRevision:1,protocol:'openai-chat-completions',requestedModel:'synthetic-no-model'};
const teacher={releaseRef:'synthetic-H',promptRef:'synthetic-prompt',profileSnapshot:profile};
const sourceIndex={version:1,families:{train0:{split:'train',firstSource:'synthetic'},dev0:{split:'dev',firstSource:'synthetic'}}};
const sourceIndexPath=join(root,'source-index.json');writeFileSync(sourceIndexPath,JSON.stringify(sourceIndex));
const encoder={schema:'v2',ctxFill:'rule-context',passEncoding:'action64'};
const identities={basePolicy,teacher,encoderConfig:encoder,encoderVersion:basePolicy.encoderVersion,candidateSpecRef:'ohuo-frozen-c8-expand4-v1',promptRef:teacher.promptRef};
const plan:any={schema:'ohuo-distill-plan-v1',datasetId:'B09-synthetic',purpose:'engineering_fixture',sourceIndexRef:'synthetic-index',sourceIndexSHA256:sha(sourceIndex),queueRef:'synthetic-layout',queueSHA256:'0'.repeat(64),samplingRef:'synthetic-prequery-selection',identities,families:[{sourceFamily:'train0',split:'train',sourceRefs:['synthetic-source-train0']},{sourceFamily:'dev0',split:'dev',sourceRefs:['synthetic-source-dev0']}],games:[]};
const normal:any={kind:'single',cards:[{id:1,suit:'S',rank:9}],size:1,keyRank:9,length:1,pairRanks:[],mainRank:9,wildAs:[]};
const wild:any={kind:'pair',cards:[{id:2,suit:'S',rank:10},{id:3,suit:'H',rank:2}],size:2,keyRank:10,length:1,pairRanks:[],mainRank:10,wildAs:[{cardId:3,asRank:10}]};
const candidates=[{id:'a003',combo:wild,marker:31,q:-0.5,originalIndex:2},{id:'a001',combo:normal,marker:11,q:3.25,originalIndex:1},{id:'a002',combo:null,marker:21,q:1.5,originalIndex:0}];
function make(id:string,kind:'demo'|'keep',options:any={}){
 const family=options.family??'train0',matchId='match-'+id;
 const key={controllerOrRunnerGeneration:'synthetic',matchId,gameNo:1,moveNo:7,actorSeat:0,requestSeq:0};
 const actionRows=(options.small?candidates.slice(1):candidates).map((c,i)=>({actionId:c.id,canonicalId:canonicalActionId(c.combo),canonical:c.combo,originalIndex:c.originalIndex,rank:i,rawQ:c.q,groupId:'g'+i,groupKey:'synthetic',remainingHand:[]}));
 const ids=actionRows.map(c=>c.actionId),features=actionRows.map(c=>Array.from({length:399},(_,j)=>candidates.find(x=>x.id===c.actionId)!.marker+j/1000));
 const input:any={schema:'ohuo-decision-input-v1',key,policyId:basePolicy.policyId,observation:{decisionId:id,matchId,gameNo:1,moveNo:7,actorSeat:0,syntheticObservation:id},candidateSpec:identities.candidateSpecRef,initialCandidateIds:ids,pool:actionRows,candidateInputs:{policyIdentity:basePolicy,encoder,encoderVersion:basePolicy.encoderVersion,policyId:basePolicy.policyId,inputDim:399,candidateIds:[...ids],candidateFeatures:features,rawQ:actionRows.map(c=>c.rawQ)}};
 const target=options.target??'a002',candidate=actionRows.find(c=>c.actionId===target);
 const record:any={key,policyId:basePolicy.policyId,initialCandidateIds:[...ids],offeredIds:[...ids],requestedActionId:target,actualActionId:target,actualMove:candidate?(candidate.canonical?{pass:false,combo:candidate.canonical}:{pass:true}):null,actualSource:kind==='demo'?'remote':'B',status:'selected',reason:null,executionKind:'confirmed',trainingInputSHA256:sha(input),elapsedMs:1,requests:kind==='demo'?[{...profile,requestCount:1}]:[],priorTarget:normal,events:[]};
 const match:any={schema:'ohuo-confirmed-match-v1',runId:'synthetic-run',matchId,sourceRef:'synthetic-index',layoutRef:'synthetic-layout',evaluatedActor:0,split:family==='dev0'?'dev':'train',policyIds:[basePolicy.policyId],rules:{},games:[{gameNo:1,sourceSHA256:sha(matchId),sourceFamilyId:family}],seatSnapshots:[{releaseRef:kind==='demo'?teacher.releaseRef:'synthetic-B-release',release:{promptRef:teacher.promptRef},policyIdentity:basePolicy,profileSnapshot:kind==='demo'?profile:undefined}],decisions:[record]};
 plan.games.push({matchId,gameNo:1,sourceFamily:family,split:family==='dev0'?'dev':'train',sourceRef:'synthetic-source-'+family,sourceSHA256:sha(matchId),actorSeat:0});
 return {sampleKind:kind,sampleClass:options.sampleClass??'target',match,record,privateInput:input};
}
const rows:any[]=[make('demo-pass','demo'),make('keep-normal','keep',{small:true,sampleClass:'ordinary'}),make('demo-wild','demo',{family:'dev0',target:'a003'})];
for(const status of ['fallback','cancelled','halted','pending']){const r=make(status,'demo');r.record.status=status;r.record.executionKind=status==='fallback'?'confirmed':status==='halted'?'unknown':'none';r.record.actualSource=status==='fallback'?'fallback':null;rows.push(r);}
const outside=make('expanded','demo',{small:true,target:'a003'});outside.privateInput.pool.push({...rows[0].privateInput.pool[0]});outside.record.actualMove={pass:false,combo:wild};outside.record.offeredIds.push('a003');outside.record.trainingInputSHA256=sha(outside.privateInput);rows.push(outside);
if(which==='reject-and-freeze'){
 const unknown=make('unknown-target','demo',{target:'not-present'});rows.push(unknown);
 const raw=make('bad-rawq','keep',{sampleClass:'ordinary'});raw.privateInput.candidateInputs.rawQ.pop();raw.record.trainingInputSHA256=sha(raw.privateInput);rows.push(raw);
}
const sourceQueue={schema:'ohuo-complete-match-queue-v1',sourceIndexRef:plan.sourceIndexRef,rows:plan.games.map((g:any)=>({matchId:g.matchId,roundFamilyIds:[g.sourceFamily],split:g.split,actor:g.actorSeat}))};plan.queueSHA256=sha(sourceQueue);
const frozen=api.freezeDataset({plan,sourceIndexPath,sourceQueue,rows,outputDir:join(root,'dataset')});
const loaded=api.loadFrozenDataset(frozen);
assert.equal(loaded.samples.length,3);assert.equal(loaded.manifest.counts.valid.demo,2);assert.equal(loaded.manifest.counts.valid.keep,1);
assert.deepEqual(loaded.samples.map((x:any)=>x.candidateIds.length),[3,2,3]);
for(const row of loaded.samples)for(let i=0;i<row.candidateIds.length;i++){
 const source=candidates.find(c=>c.id===row.candidateIds[i])!;assert.equal(row.candidateFeatures[i][0],source.marker);assert.equal(row.candidateFeatures[i][398],source.marker+0.398);assert.equal(row.rawQ[i],source.q);assert.equal(row.candidateOriginalIndices?.[i],source.originalIndex,'original index must come from the same action, not C/rank');
}
// Identical synthetic S scores: original-enumeration tie wins, not C/rank order.
const tied=loaded.samples[0],tieScores=tied.candidateIds.map(()=>7);
const tiePick=tieScores.reduce((best,score,i)=>score>tieScores[best]||score===tieScores[best]&&tied.candidateOriginalIndices[i]<tied.candidateOriginalIndices[best]?i:best,0);
assert.equal(tied.candidateIds[tiePick],'a002');assert.notEqual(tiePick,0);
if(loaded.samples[0].sampleKind!=='demo'||loaded.samples[2].sampleKind!=='demo')throw Error('fixture demos missing');
assert.deepEqual(loaded.samples[0].targetIds,['a002']);assert.deepEqual(loaded.samples[2].targetIds,['a003']);assert.equal(loaded.samples[0].candidateCanonicalIds[2],'pass');
for(const field of ['targetIds','teacherPolicyRef','labelKind'])assert.equal(field in loaded.samples[1],false);
assert.equal(loaded.manifest.qualification.eligible,false);assert.equal(loaded.manifest.counts.excluded,which==='reject-and-freeze'?7:5);
assert.equal(loaded.manifest.exclusions.filter((x:any)=>x.reason==='target_outside_initial_c').length,1);
if(which==='reject-and-freeze'){
 for(const reason of ['unknown_target','rawq_length'])assert.equal(loaded.manifest.exclusions.filter((x:any)=>x.reason===reason).length,1);
 const path=join(frozen.directory,'samples.jsonl'),original=readFileSync(path);
 writeFileSync(path,Buffer.concat([original,Buffer.from('\n')]));assert.throws(()=>api.loadFrozenDataset(frozen),/sample_file_identity/);
 writeFileSync(path,original);unlinkSync(path);assert.throws(()=>api.loadFrozenDataset(frozen),/sample_file_missing/);writeFileSync(path,original);
 assert.throws(()=>api.loadFrozenDataset({...frozen,manifestSHA256:'0'.repeat(64)}),/manifest_identity/);
 for(const corrupt of [(s:any)=>s[0].candidateFeatures[0].pop(),(s:any)=>{s[0].candidateOriginalIndices[0]=s[0].candidateOriginalIndices[1];},(s:any)=>{s[0].candidateOriginalIndices[0]=0.5;}]){
  const malformed=structuredClone(loaded.samples);corrupt(malformed);const bytes=malformed.map((r:any)=>JSON.stringify(r)).join('\n')+'\n';writeFileSync(path,bytes);
  const manifest=structuredClone(loaded.manifest);manifest.samples.sha256=sha(bytes);manifest.samples.bytes=Buffer.byteLength(bytes);writeFileSync(join(frozen.directory,'manifest.json'),JSON.stringify(manifest)+'\n');
  assert.throws(()=>api.loadFrozenDataset({...frozen,manifestSHA256:sha(JSON.stringify(manifest)+'\n')}),/frozen_bad_row/);
 }
}
writeFileSync(join(root,'fixture-reference.json'),JSON.stringify(frozen,null,2)+'\n');
if(which==='align-and-admit')writeFileSync(join(root,'expected-readback.json'),JSON.stringify({datasetId:plan.datasetId,manifestSHA256:frozen.manifestSHA256,groups:loaded.samples.map((r:any)=>({decisionId:r.decisionId,sampleKind:r.sampleKind,split:r.split,candidateIds:r.candidateIds,candidateOriginalIndices:r.candidateOriginalIndices,candidateFeatures:r.candidateFeatures,rawQ:r.rawQ,...(r.sampleKind==='demo'?{targetIds:r.targetIds}:{})}))})+'\n');
console.log(JSON.stringify({checkId:which==='align-and-admit'?'B09.align_and_admit':'B09.reject_and_freeze',mode:'direct-development',scope:'finite synthetic decisions; no API/weights/matches/training',passed:true,root,reference:frozen,counts:loaded.manifest.counts,exclusions:loaded.manifest.exclusions.map((e:any)=>({decisionId:e.decisionId,reason:e.reason})),macPythonReadback:'pending'}));
