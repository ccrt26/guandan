// Catches evaluation-data consumption, cross-split reuse and partial commits.
import {describe,it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claimFamily,assertTrainingLabels,commitCheckpoint,readCheckpoint} from '../review6_2/protocol';
import{assertCompleteSamplingWave}from'../review6_2/protocol';
import{runFrozenPool}from'../review6/compute-pool.mjs';

describe('REVIEW6.2 real admission and checkpoint behavior',()=>{
 it('turns the real pool ready-time deadline stop into a resumable window',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'r62-deadline-'));
  try{
   const path=join(directory,'worker.mjs');writeFileSync(path,"import {parentPort,threadId} from 'node:worker_threads'; parentPort.postMessage({kind:'ready',threadId}); parentPort.on('message',m=>{if(m.kind==='stop')process.exit(0);});");
   const deadline=performance.now()+500;
   const result=await runFrozenPool({entryPath:path,workers:1,workerData:{},tasks:[{id:'one'}],deadlineMonotonicMs:deadline,onResult(){throw Error('task must not dispatch');}});
   expect(result.complete).toBe(false);
   expect(()=>assertCompleteSamplingWave(result,deadline)).toThrow(/normal sampling window expiry/);
   expect(()=>assertCompleteSamplingWave(result,performance.now()+60000)).toThrow(/incomplete sampling wave/);
  }finally{rmSync(directory,{recursive:true});}
 });
 it('rejects the same source family crossing train and dev',()=>{
  const index:any={families:{}};claimFamily(index,'family:one','train','source1');
  claimFamily(index,'family:one','train','same source in paired arm');
  expect(()=>claimFamily(index,'family:one','dev','renamed derivative')).toThrow(/split/);
 });
 it('rejects evaluation labels and fixture labels in a main run',()=>{
  const label:any={labelId:'l1',rootKey:'r1',sourceFamilyId:'f1',split:'dev',scope:'main',plus:[Array(399).fill(0)],minus:[Array(399).fill(1)],evidenceTier:'weak',weight:.25};
  expect(()=>assertTrainingLabels([label],false)).toThrow(/split/);
  label.split='train';label.scope='fixture_only';
  expect(()=>assertTrainingLabels([label],false)).toThrow(/fixture/);
  expect(()=>assertTrainingLabels([label],true)).toThrow(/provenance/);
 });
 it('rejects a dev family even when the label itself claims train',()=>{
  const label:any={labelId:'l1',rootKey:'r1',sourceFamilyId:'f1',split:'train',scope:'main',plus:[Array(399).fill(0)],minus:[Array(399).fill(1)],evidenceTier:'weak',weight:.25};
  expect(()=>assertTrainingLabels([label],false,{families:{f1:{split:'dev'}}})).toThrow(/source.*split/);
 });
 it('preserves the last committed state if writing the next checkpoint fails',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'r62-checkpoint-'));
  try{
   await commitCheckpoint(directory,2,{absoluteUpdate:2,cursor:7},async p=>{
    writeFileSync(join(p,'learner.pt'),'valid optimizer');writeFileSync(join(p,'weights.f32'),'valid model');
   });
   await expect(commitCheckpoint(directory,3,{absoluteUpdate:3,cursor:9},async p=>{
    writeFileSync(join(p,'weights.f32'),'partial model');throw Error('interrupted');
   })).rejects.toThrow('interrupted');
   const recovered=readCheckpoint(directory);expect(recovered.state.absoluteUpdate).toBe(2);expect(recovered.state.cursor).toBe(7);
   expect(readFileSync(join(recovered.path,'weights.f32'),'utf8')).toBe('valid model');
  }finally{rmSync(directory,{recursive:true,force:true});}
 });
});
