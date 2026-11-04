/** Executes the original selectedRows freezer seam with synthetic fixed source
 * proofs. Real filesystem and ledger/terminal checks; no H, replay or research. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,isAbsolute,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {isDeepStrictEqual as equal} from 'node:util';
import {canonical,digest,referenceOf} from '../task-schema.mjs';
import {firstRoundOwnedLabelRows} from '../first-round-contract.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'distill-ledger-reuse-')));
const source=fs.readFileSync(new URL('../distill-data.ts',import.meta.url),'utf8');
const seam=stripTypeScriptTypes(source.slice(source.indexOf('function originalLabelTerminalIndex('),source.indexOf('type FreezeDatasetArgs=')),{mode:'transform'});
try {
 const controlRoot=join(root,'control'),outputRoot=join(root,'labels');
 fs.mkdirSync(controlRoot);fs.mkdirSync(outputRoot);
 const rows=[0,1].map(i=>({sampleKind:'demo',sampleClass:'target',match:{id:'match'},record:{key:{matchId:'match',gameNo:1,moveNo:i,requestSeq:i,actorSeat:0}},privateInput:{observation:{decisionId:`decision-${i}`}},offlineLabel:{label:i}}));
 const population=rows.map(r=>({key:r.record.key,inputSHA256:hash(JSON.stringify(r.privateInput)),familyId:'family',split:'train'}));
 const spec={outputId:'fixture',purpose:'b_training_source',planRef:'plan',sourceIndexRef:'index',queueRef:'queue',actingReleaseRef:'B'};
 const selection={purpose:spec.purpose,productionRef:'production',rows:population};
 const selectionRef=referenceOf('offline-label-selection/fixture',selection),teacher={releaseRef:'teacher'};
 const plan={purpose:'stage4',samplingRef:'production',sourceIndexRef:'index',queueRef:'queue',identities:{teacher}};
 const production={verification:'reproduced'},evidenceFiles=new Map(),labelTerminalRefs=[];
 const terminals=population.map((p,i)=>({schema:'ohuo-offline-label-result-v1',purpose:spec.purpose,selectionRef,source:p,key:p.key,inputSHA256:p.inputSHA256,index:i,decisionId:`decision-${i}`,teacher,status:'selected',labelKind:'offline_suggested',offlineLabel:rows[i].offlineLabel}));
 const terminalPaths=terminals.map((v,i)=>join(root,`terminal-${i}.json`));
 const writeTerminals=()=>{
  evidenceFiles.clear();labelTerminalRefs.length=0;
  terminals.forEach((v,i)=>{const bytes=JSON.stringify(v),id=`terminal-${i}`,sha256=hash(bytes);fs.writeFileSync(terminalPaths[i],bytes);evidenceFiles.set(id,{path:relative(root,terminalPaths[i]),sha256});labelTerminalRefs.push({id,sha256});});
 };
 writeTerminals();
 const task={outputRoot,datasetRefs:[selectionRef],planRef:'plan',budgetRef:'budget',sourcePlan:{sourceIndexRef:'index',split:'train',familyIds:['family']},seatLayoutPlan:'queue',parentPolicyRef:'B',releaseRefs:['B']};
 const checkpoint={schema:'ohuo-offline-label-run-v1',taskSHA256:digest(task),selectionRef,rows:terminals.map((v,i)=>({key:v.key,inputSHA256:v.inputSHA256,status:v.status,labelKind:v.labelKind,resultRef:{path:terminalPaths[i],sha256:labelTerminalRefs[i].sha256}}))};
 const checkpointSHA256=digest(checkpoint),checkpointPath=join(outputRoot,`checkpoint-${checkpointSHA256}.json`),checkpointBytes=JSON.stringify(checkpoint);
 const writeControl=()=>fs.writeFileSync(join(controlRoot,'state.json'),JSON.stringify({schemaVersion:1,runs:{fixture:{task,taskSHA256:digest(task),checkpoint,checkpointSHA256,checkpointRef:checkpointPath}}}));
 fs.writeFileSync(checkpointPath,checkpointBytes);writeControl();
 const trusted={mode:'research',phase:'dataset',repositoryRoot:root,controlRoot,references:new Map(),evidenceFiles,labelTerminalRefs};
 const verified={selection,production,spec,budgetRef:'budget',selectedMetadata:population.map((p,i)=>({...p,decisionId:`decision-${i}`,sampleKind:'demo',sampleClass:'target'})),population};
 let checkpointReads=0,onSecondTerminal=null;
 // All compared fixture values are JSON. Normalize only VM-created array/object
 // prototypes, which otherwise differ from the original module's single realm.
 const jsonEqual=(a,b)=>equal(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
 const context={Map,Set,JSON,structuredClone,Buffer,canonical,digest,referenceOf,equal:jsonEqual,hash,dataHash:v=>hash(JSON.stringify(v)),sha:v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),join,isAbsolute,resolve,realpathSync:fs.realpathSync,lstatSync:fs.lstatSync,
  readFileSync:(path,...args)=>{if(path===checkpointPath)checkpointReads++;if(path===terminalPaths[1])onSecondTerminal?.();return fs.readFileSync(path,...args);},
  reject:reason=>{throw Error(reason);},isFirstRoundR2DatasetPlan:()=>false,firstRoundOwnedLabelRows,
  designedRow:()=>false,exportKey:r=>r.record.key,
  verifyOfflineSelection:()=>{throw Error('unexpected second selection verification');},
  readSelectionSnapshot:p=>{const r=rows.find(r=>equal(r.record.key,p.key));return {record:r.match,decision:r.record,input:r.privateInput};}
 };
 runInNewContext(seam+'\nthis.selectedRows=selectedRows;',context);
 const run=()=>context.selectedRows(plan,rows,{selection,production,resolvedInputs:trusted},verified);
 const result=run();
 assert.deepEqual(JSON.parse(JSON.stringify(result.rows)),rows);
 assert.equal(result.terminals.size,2);assert.equal(result.missing.size,0);
 assert.equal(checkpointReads,1,'same transaction must read/parse/hash each unchanged checkpoint once');
 run();assert.equal(checkpointReads,2,'new transaction must cold-read the checkpoint');

 // Changing a checkpoint after terminal 0 must invalidate the lightweight signal
 // and preserve the original digest rejection at terminal 1.
 onSecondTerminal=()=>fs.writeFileSync(checkpointPath,JSON.stringify({...checkpoint,changed:true}));
 assert.throws(run,/selection_terminal_not_committed_in_label_ledger/);
 assert.equal(checkpointReads,4);onSecondTerminal=null;
 fs.writeFileSync(checkpointPath,checkpointBytes);

 // Even a cache hit cannot bypass the per-terminal status binding. Rebind only
 // the synthetic file references so the failure reaches that original check.
 terminals[1].status='failed_format';writeTerminals();
 checkpoint.rows[1].resultRef.sha256=labelTerminalRefs[1].sha256;
 const changedSHA=digest(checkpoint),changedPath=join(outputRoot,`checkpoint-${changedSHA}.json`);
 fs.writeFileSync(changedPath,JSON.stringify(checkpoint));
 fs.writeFileSync(join(controlRoot,'state.json'),JSON.stringify({schemaVersion:1,runs:{fixture:{task,taskSHA256:digest(task),checkpoint,checkpointSHA256:changedSHA,checkpointRef:changedPath}}}));
 assert.throws(run,/selection_terminal_not_committed_in_label_ledger/);
 console.log(JSON.stringify({status:'passed',entry:'distill-data.selectedRows',terminalCount:2,unchangedCheckpointReads:1,crossTransactionColdRead:true,changedCheckpointRejected:true,terminalStatusMismatchRejected:true,boundary:'synthetic fixed source proof; no H performance, scientific qualification, model, match or training claim'}));
} finally {fs.rmSync(root,{recursive:true,force:true});}
