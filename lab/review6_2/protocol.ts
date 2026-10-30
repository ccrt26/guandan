import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync,rmSync,readdirSync,realpathSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validatePolicyRegistry} from '../review6/policy-registry';
import type {PolicySpec} from '../review6/match-play';
import {deriveSeed} from '@gd/ai';
import {sampleVisibleWorld} from '../review6/visible-world';
import {rootCandidates} from '../review6/teacher-roots';
import{assertTeachingEvidence}from'./teaching-evidence';

export const ROOT=resolve(new URL('../../',import.meta.url).pathname);
export const HOME=resolve(ROOT,'lab/review6_2');
export const PROTOCOL='review6-2-staged-local-training-20261029';
export const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
export const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const fileHash=(path:string)=>hash(readFileSync(path));
export function atomicJson(path:string,value:any){
 mkdirSync(resolve(path,'..'),{recursive:true});const temp=path+'.tmp-'+process.pid+'-'+randomUUID();
 writeFileSync(temp,JSON.stringify(value)+'\n',{flag:'wx'});renameSync(temp,path);
}
export function event(directory:string,value:any){
 const path=join(directory,'events.jsonl');mkdirSync(directory,{recursive:true});
 writeFileSync(path,JSON.stringify({at:new Date().toISOString(),...value})+'\n',{flag:'a'});
}
export function claimFamily(index:any,family:string,split:string,source:string){
 if(!['train','dev','sealed','historical','fixture'].includes(split)||!family)throw Error('invalid family split');
 index.families??={};const old=index.families[family];
 if(old&&old.split!==split)throw Error('source family split collision: '+family);
 index.families[family]=old??{split,firstSource:source};
}
type IndexView={index:any;stamp:string;foreign:Map<string,string[]>};
const indexViews=new Map<string,IndexView>();
function indexStamp(path:string){if(!existsSync(path))return'missing';const s=statSync(path,{bigint:true});return[s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');}
function sourceView(path:string){
 const target=existsSync(path)?realpathSync(path):resolve(path),stamp=indexStamp(target);let view=indexViews.get(target);
 if(!view||view.stamp!==stamp){view={index:stamp==='missing'?{version:1,families:{}}:json(target),stamp,foreign:new Map()};indexViews.set(target,view);}
 return{target,view};
}
export function bindFamilies(path:string,families:string[],split:string,source:string){
 const{target,view}=sourceView(path);
 if(!['train','dev','sealed','historical','fixture'].includes(split)||families.some(id=>!id))throw Error('invalid family split');
 // Validate the whole operation before touching the cached transaction.
 for(const id of families){const old=view.index.families[id];if(old&&old.split!==split)throw Error('source family split collision: '+id);}
 const fresh=[...new Set(families)].filter(id=>!view.index.families[id]);if(!fresh.length)return;
 try{
  for(const id of fresh)claimFamily(view.index,id,split,source);
  atomicJson(target,view.index);view.stamp=indexStamp(target);
  // Appending this split leaves its own foreign list identical. Other views
  // rebuild on demand, preserving Object.entries ordering even for numeric IDs.
  for(const key of view.foreign.keys())if(key!==split)view.foreign.delete(key);
 }catch(e){indexViews.delete(target);throw e;}
}
export function excludedFamilies(path:string,split:string){
 const{view}=sourceView(path);if(!view.foreign.has(split))view.foreign.set(split,Object.entries(view.index.families).filter(([,r]:any)=>r.split!==split).map(([id])=>id));
 return[...view.foreign.get(split)!];
}
export function rootKey(root:any){return hash(JSON.stringify([root.sourceFamilyId,root.observedBefore.matchPublic.gameNo,root.observedBefore.statePublic.moveNo,root.observedBefore.actor,root.observedBefore.observationSHA256]));}
export function assertTrainingLabels(labels:any[],smoke=false,index?:any){
 const ids=new Set(),roots=new Set();
 for(const l of labels){
  if(l.split!=='train')throw Error('teacher split must be train');
  if(l.scope==='fixture_only'&&!smoke)throw Error('fixture cannot enter main run');
  if(!l.labelId||!l.rootKey||!l.sourceFamilyId||ids.has(l.labelId)||roots.has(l.rootKey))throw Error('duplicate/missing root identity');
  ids.add(l.labelId);roots.add(l.rootKey);
  if(!['strong','weak'].includes(l.evidenceTier)||l.weight!==(l.evidenceTier==='strong'?1:.25))throw Error('explicit strong/weak weight required');
  if(!Array.isArray(l.plus)||!l.plus.length||l.plus.length!==l.minus?.length||[...l.plus,...l.minus].some(x=>!Array.isArray(x)||x.length!==399||x.some(v=>!Number.isFinite(v))))throw Error('teacher finite399 pair contract');
  if(l.scope==='fixture_only'){
   if(!l.sourceRef||!l.sourceSHA256)throw Error('fixture provenance required');
   const manifest=json(resolve(ROOT,'lab/review6_1/teacher-pilot-001/pilot-label-manifest-001.json'));
   const ref=manifest.labels.find((r:any)=>r.path===l.sourceRef&&r.sourceFamilyId===l.sourceFamilyId&&r.datasetPurpose==='pilot_training_only_not_main_or_sealed');
   if(!ref||fileHash(ref.path)!==ref.sha256||ref.sha256!==l.sourceSHA256||fileHash(ref.statsPath)!==ref.statsSHA256||json(ref.statsPath).supported!==true)throw Error('fixture provenance/usage mismatch');
   const original=json(ref.path);
   if(JSON.stringify(l.plus)!==JSON.stringify([original.inputPlus399])||JSON.stringify(l.minus)!==JSON.stringify([original.inputMinus399]))throw Error('fixture features changed');
   if(['dev','sealed'].includes(index?.families?.[l.sourceFamilyId]?.split))throw Error('fixture source split conflict');
  }else{
   if(index?.families?.[l.sourceFamilyId]?.split!=='train')throw Error('teacher source split must be train');
   if(!l.rootRef||fileHash(l.rootRef)!==l.rootSHA256)throw Error('engine root provenance required');
   const root=json(l.rootRef),obs=root.observedBefore;
   if(root.sourceFamilyId!==l.sourceFamilyId||rootKey(root)!==l.rootKey||obs.representationGaps.length)throw Error('teacher root identity/representation gap');
   const world=sampleVisibleWorld(obs,deriveSeed('review6-2-label-admission-v1',20261029,0,obs.observationSHA256)),candidates=rootCandidates(world.state);
   if(l.pairs?.length!==l.plus.length)throw Error('teacher pair identity required');
   l.pairs.forEach((p:any,i:number)=>{
    const plus=candidates.find(c=>c.actionId===p.preferredActionId),minus=candidates.find(c=>c.actionId===p.otherActionId);
    if(!plus||!minus||plus.actionId===minus.actionId||JSON.stringify(l.plus[i])!==JSON.stringify([...obs.modelState331,...plus.features68])||JSON.stringify(l.minus[i])!==JSON.stringify([...obs.modelState331,...minus.features68]))throw Error('teacher features do not match legal visible actions');
   });
   if(l.evidenceTier==='strong')assertTeachingEvidence(l,root,l.rootKey,index,'train');
  }
 }
 return labels;
}
export function readRegistry(config:any){
 const r=validatePolicyRegistry(json(config.registryPath));
 for(const p of r.policies)if(p.kind==='neural')validatePolicy(p);
 return r;
}
export function checkExecutionPolicy(config:any){
 const policy=json(resolve(ROOT,'deliverables/review6-2-audit-20261029/execution-policy.json'));
 if(policy.protocolId!==PROTOCOL||policy.execution.hardTotalResourceHours!==null||config.hardTotalResourceHours!==null)throw Error('reviewed execution policy mismatch');
 if(policy.training.allowedGradientSplit!=='train'||policy.training.preferenceCoefficient!==.1||policy.training.anchorCoefficient!==.01||policy.training.weakRootWeight!==.25||policy.training.strongRootWeight!==1)throw Error('unreviewed training policy change');
 if(config.learningRate!==undefined||config.preferenceMode!==undefined){
  if(!config.experimentRef||fileHash(config.experimentRef)!==config.experimentSHA256)throw Error('changed optimizer needs fixed reviewed experiment');
  const e=json(config.experimentRef);
  const marker=e.approvalMarker??'APPROVE_P2';
  const generic=marker==='APPROVE_REVIEW6_2_EXPERIMENT',reviewText=readFileSync(e.reviewRef,'utf8');
  if((!generic&&!['APPROVE_P2','APPROVE_P3','APPROVE_P4','APPROVE_P5','APPROVE_P6','APPROVE_P7','APPROVE_P8','APPROVE_P9','APPROVE_P10'].includes(marker))||e.learningRate!==(config.learningRate??.001)||(e.preferenceMode??'softplus')!==(config.preferenceMode??'softplus')||e.seed!==config.seed||!e.updateTargets.includes(config.updateTarget)||e.teacherSetSHA256!==fileHash(config.teacherSetRef)||e.registrySHA256!==fileHash(config.registryPath)||fileHash(e.planRef)!==e.planSHA256||fileHash(e.reviewRef)!==e.reviewSHA256||!reviewText.includes(marker)||(generic&&!reviewText.includes(e.planSHA256)))throw Error('experiment differs from reviewed single-variable plan');
 }
 return{path:resolve(ROOT,'deliverables/review6-2-audit-20261029/execution-policy.json'),sha256:fileHash(resolve(ROOT,'deliverables/review6-2-audit-20261029/execution-policy.json'))};
}
export function validatePolicy(p:PolicySpec){
 if(p.kind==='heuristic')return;
 if(!p.weightsPath||fileHash(p.weightsPath)!==p.weightsSHA256||![385,399].includes(p.inputDim!))throw Error('policy weights identity mismatch');
 const raw=readFileSync(p.weightsPath),n=256*p.inputDim!+256+256*256+256+256+1;
 if(raw.length!==n*4||!new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)).every(Number.isFinite))throw Error('policy dimension/nonfinite weights');
 if(p.inputDim===399&&(p.encoder?.schema!=='v2'||p.encoder?.ctxFill!=='rule-context'||p.encoder?.passEncoding!=='action64'))throw Error('399 policy encoder mismatch');
}
export function codeIdentity(){
 const paths=['lab/review6_2/train.ts','lab/review6_2/learner.py','lab/review6_2/curriculum_learner.py','lab/review6_2/teacher-schedule.ts','lab/review6_2/protocol.ts','lab/review6_2/curriculum.ts','lab/review6_2/anchor-coverage.ts','lab/review6_2/evidence.ts','lab/review6_2/teaching-evidence.ts','lab/review6_2/terminal-proof.ts','lab/review6_2/declared-proof.ts','lab/review6/training_core.py','lab/review6/mature-queues.ts','lab/review6/mature-match.ts','lab/review6/training-samples.ts','lab/review6/training-collector.ts','lab/review6/match-play.ts','packages/ai/src/nn/schema.ts','packages/ai/src/nn/mlp.ts','packages/engine/src/game.ts'];
 return hash(JSON.stringify(paths.map(p=>[p,fileHash(resolve(ROOT,p))])));
}
export function assertCompleteSamplingWave(resource:any,deadline:number){
 if(resource.complete)return;
 if(performance.now()+1000>=deadline)throw Error('review6-2 normal sampling window expiry');
 throw Error('incomplete sampling wave');
}
export async function commitCheckpoint(directory:string,update:number,state:any,writeLearner:(path:string)=>Promise<void>){
 mkdirSync(join(directory,'checkpoints'),{recursive:true});
 const name='u'+String(update).padStart(6,'0')+'-'+randomUUID().slice(0,8),temp=join(directory,'checkpoints',name+'.tmp');
 mkdirSync(temp);await writeLearner(temp);atomicJson(join(temp,'state.json'),state);
 const files=['learner.pt','weights.f32','state.json'].map(name=>({name,sha256:fileHash(join(temp,name))}));
 atomicJson(join(temp,'manifest.json'),{update,files});const final=join(directory,'checkpoints',name);renameSync(temp,final);
 if(existsSync(join(directory,'latest.json')))atomicJson(join(directory,'previous.json'),json(join(directory,'latest.json')));
 atomicJson(join(directory,'latest.json'),{path:'checkpoints/'+name,update});
 // Keep evaluation milestones plus the latest two complete transactions.
 const keep=new Set([name,existsSync(join(directory,'previous.json'))?json(join(directory,'previous.json')).path.split('/').at(-1):'']);
 for(const entry of readdirSync(join(directory,'checkpoints'))){
  if(keep.has(entry)||entry.endsWith('.tmp'))continue;
  const match=/^u(\d+)-/.exec(entry);if(match&&Number(match[1])%100!==0)rmSync(join(directory,'checkpoints',entry),{recursive:true});
 }
 return final;
}
export function readCheckpoint(directory:string){
 const errors=[];
 for(const pointer of ['latest.json','previous.json'])try{
  const p=json(join(directory,pointer));if(!/^checkpoints\/u\d+-[0-9a-f]+$/.test(p.path))throw Error('checkpoint path invalid');
  const path=join(directory,p.path),m=json(join(path,'manifest.json'));
  if(m.update!==p.update||m.files.length!==3||m.files.some((r:any)=>!['learner.pt','weights.f32','state.json'].includes(r.name)||fileHash(join(path,r.name))!==r.sha256))throw Error('checkpoint incomplete or changed');
  const state=json(join(path,'state.json'));if(state.absoluteUpdate!==p.update)throw Error('checkpoint update mismatch');
  return{path,state,recoveredFrom:pointer==='latest.json'?null:'previous_complete_checkpoint',errors};
 }catch(e){errors.push((e as Error).message);}
 throw Error('no valid checkpoint: '+errors.join('; '));
}
export function runDirectory(id:string){
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,90}$/.test(id))throw Error('invalid runId');return join(HOME,'runs',id);
}
