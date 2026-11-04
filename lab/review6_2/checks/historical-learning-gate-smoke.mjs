/** Full original H.checkPlan on actual immutable metadata; state variants are
 * explicit in-memory fixtures, never edits to the real ledger. No learner. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const args=process.argv.slice(2),mode=args[0]==='--case'?(assert.equal(args[1],'training.historical-learning-gate'),assert.equal(args.length,2),'green'):args[0];assert.ok(['red','green'].includes(mode));
const root=process.cwd(),hash=b=>createHash('sha256').update(b).digest('hex');
const {FixedHostFiles}=await import(pathToFileURL(path.join(root,'lab/review6_2/ohuo-host-files.ts'))),{verifyCommonViewRoundAdmission}=await import(pathToFileURL(path.join(root,'lab/review6_2/offline-selection.ts')));
const host=new FixedHostFiles(root),state=host.checkExistingRoot(),run=state.runs['r1-training-calibration'];assert.equal(run.status,'failed');assert.equal(run.failureReason,'plan_unverified');assert.equal(run.cleanupConfirmed,true);assert.equal(run.checkpoint.optimizerSteps,0);assert.equal(run.taskSHA256,'d656524beba297401288e47c931e44f765c68fec043ee24dd3e07c7493af9768');
const task=run.task,authority=['lab/out/R11-v530-control/state.json','deliverables/ohuo-runtime/host.json',host.manifest.planCloseoutFile,host.manifest.grantFile.path,JSON.parse(fs.readFileSync(path.join(root,host.manifest.planCloseoutFile),'utf8')).closeout.file.path].map(p=>({p,sha:hash(fs.readFileSync(path.join(root,p)))}));assert.ok(authority.length>=1);
if(mode==='red'){await assert.rejects(()=>host.checkPlan(task),/source_batch_related_run_unfinished/);console.log(JSON.stringify({case:'training.historical-learning-gate',mode,observed:'actual original checkPlan rejects its failed downstream calibration'}));}
else{
 assert.equal((await host.checkPlan(task)).eligible,true);
 const running=structuredClone(state);running.runs[run.runId].status='running';running.runs[run.runId].cleanupConfirmed=false;running.budgets[task.budgetRef].activeRunId=run.runId;
 const activeHost=new FixedHostFiles(root);activeHost.checkExistingRoot=()=>running;assert.equal((await activeHost.checkPlan(task)).eligible,true);
 const refs=new Map([...host.references].map(([ref])=>[ref,host.resolveRef(ref)])),spec=[...refs.values()].find(s=>s?.schema==='ohuo-offline-selection-spec-common-view-round-r2');assert.ok(spec);const index=refs.get(spec.sourceIndexRef),b=[...host.bindings.values()].find(b=>b.sourceIndexFile.sha256===index.fileSHA256);assert.ok(b);
 const trusted={repositoryRoot:root,controlRoot:host.root,references:refs,evidenceFiles:new Map(host.evidence),sourceIndexPath:host.relativePath(b.sourceIndexFile.path),confirmedRecordRoots:[],mode:'research',phase:'freeze'};
 assert.throws(()=>verifyCommonViewRoundAdmission(spec,trusted,running),/source_batch_related_run_unsettled/);
 const prior=structuredClone(state),teacher=Object.values(prior.runs).find(r=>r.task?.taskId==='r1-data-glm-train-retry-1');assert.ok(teacher);teacher.status='running';teacher.cleanupConfirmed=false;prior.budgets[task.budgetRef].activeRunId=teacher.runId;const priorHost=new FixedHostFiles(root);priorHost.checkExistingRoot=()=>prior;await assert.rejects(()=>priorHost.checkPlan(task),/unsettled|unfinished|changed/);
 const badHost=new FixedHostFiles(root),dataset=badHost.resolveRef(task.datasetRefs[0]);for(const [id,f]of badHost.evidence)if(f.sha256===dataset.manifestSHA256)badHost.evidence.delete(id);await assert.rejects(()=>badHost.checkPlan(task),/source_batch_related_run_unfinished/);
 console.log(JSON.stringify({case:'training.historical-learning-gate',mode,actualFailedCheckPlan:'passed',syntheticRunningCheckPlan:'passed',actualNewFreezeWithRunningDownstream:'rejected',actualPriorTeacherRunning:'rejected',unboundDatasetManifest:'rejected',training:false,optimizerUpdates:0}));
}
for(const {p,sha}of authority)assert.equal(hash(fs.readFileSync(path.join(root,p))),sha);
