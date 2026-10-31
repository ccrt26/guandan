/** Pure prepare boundary: standard Node test mocks only the existing policy
 * loader and controller constructor. No model file, match, profile or query. */
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {referenceOf} from '../task-schema.mjs';
import {RELEASES} from '../../../packages/ai/src/policy/seats';
import {DEFAULT_RULES} from '@gd/engine';
assert.deepEqual(process.argv.slice(2),['--case','queue-projection']);globalThis.fetch=async()=>{throw Error('real_network_forbidden');};
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));mkdirSync(join(root,'lab/out'),{recursive:true});const out=mkdtempSync(join(root,'lab/out/queue-projection-'));
let loads=0;const identity={policyId:'synthetic-B'};
mock.module(new URL('../policy-loader.ts',import.meta.url).href,{namedExports:{POLICY_REPOSITORY_ROOT:root,resolveNodePolicy:async()=>{loads++;return{identity,descriptor:{},encoder:{}};}}});
mock.module(new URL('../task-control.mjs',import.meta.url).href,{namedExports:{createTaskController:(args:any)=>args}});
const {createMatchTaskHost}=await import('../match-consumer');
const consumer=(createMatchTaskHost({root:out,adapter:{},policyRepositoryRoot:root}) as any).consumers[0];
const refs=new Map<string,any>(),ref=(id:string,v:any)=>{const r=referenceOf(id,v);refs.set(r,v);return r;};
const index={version:1,families:{A:{split:'train'},B:{split:'train'},D:{split:'dev'},C:{split:'sealed'}}},indexPath=join(out,'index.json'),indexBytes=JSON.stringify(index);writeFileSync(indexPath,indexBytes);
const sourceIndexRef=ref('index',{schema:'ohuo-source-index-ref-v1',namespace:'synthetic',fileSHA256:createHash('sha256').update(indexBytes).digest('hex')}),b=RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1')!,releaseRef=ref('B',{schema:'ohuo-release-ref-v1',release:b,policyIdentity:identity}),rulesRef=ref('rules',DEFAULT_RULES),promptRef=ref('prompt',{schema:'ohuo-prompt-ref-v1',promptRef:b.promptRef});
function row(matchId:string,split:string,family:string,rounds=[family]){return{matchId,layoutId:'layout-'+matchId,sourceFamilyId:family,split,seed:12,dealNamespace:'synthetic',roundFamilyIds:rounds,actor:0,metric:'synthetic',group:0,side:0,variant:'synthetic',maxGames:rounds.length,maxMovesPerGame:10,seats:Array.from({length:4},()=>({releaseRef,mode:'local',profileRevisionRef:null}))};}
async function prepare(rows:any[],split='train',familyIds=['A'],max=1){const queue={schema:'ohuo-complete-match-queue-v1',namespace:'synthetic',sourceIndexRef,rows},queueRef=ref('queue',queue),task={taskKind:'collect',sourcePlan:{namespace:'synthetic',sourceIndexRef,split,familyIds},seatLayoutPlan:queueRef,limits:{maxMatchAttempts:max},releaseRefs:[releaseRef],rulesRef,promptRef,operationScope:{apiCalls:false}};return consumer.prepare({task,refs,inputs:{sourceIndexPath:indexPath}});}
const train=row('train','train','A',['A','B']),dev=row('dev','dev','D');
const legacy=await prepare([train],'train',['A','B']);assert.deepEqual(legacy.rows.map((r:any)=>r.matchId),['train']);
const all=[dev,train],p=await prepare(all,'train',['A','B']),d=await prepare(all,'dev',['D']);assert.deepEqual(p.rows.map((r:any)=>r.matchId),['train']);assert.deepEqual(d.rows.map((r:any)=>r.matchId),['dev']);assert.deepEqual(p.queue,d.queue);assert.equal(p.queue.rows.length,2);
for(const bad of [{...dev,split:'unknown'},{...dev,sourceFamilyId:'C'},{...dev,roundFamilyIds:['A']},{...dev,seats:[...dev.seats.slice(1)]},{...dev,unexpected:1},train]){const before=loads;await assert.rejects(prepare([train,bad],'train',['A','B']));assert.equal(loads,before,'entire queue metadata rejected before any policy read');}
await assert.rejects(prepare([train,dev],'train',['A','B','D']),/family|split/);await assert.rejects(prepare([train,dev],'dev',['A']),/projection|family/);await assert.rejects(prepare([train,row('second','train','A',['A','B'])],'train',['A','B'],1),/limit/);await assert.rejects(prepare([train,row('confirm','confirm','C')],'train',['A','B']),/split|mixed/);
console.log(JSON.stringify({caseId:'queue-projection',status:'passed',singleSplitCrossRoundFamilies:true,fullQueueSplitProjection:true,nonownedMetadataRejectedBeforeAssets:true,policyLoads:'explicit mock only',realNetwork:0,modelReads:0,modelForwards:0,matches:0,parameterUpdates:0}));
