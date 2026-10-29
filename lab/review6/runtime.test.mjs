import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const entry = new URL('./run.mjs', import.meta.url);
const cli = (...args) => spawnSync(process.execPath, [entry.pathname, ...args], { encoding: 'utf8' });
const mod = async () => {
  const result = await import('./runtime.mjs').catch(() => null);
  assert.ok(result, 'C0 budget/identity runtime must be implemented'); return result;
};
test('CLI help describes the actual commands without starting work', () => {
  const r=cli('--help'); assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/handoff-inspect/);
});
test('unknown option fails closed before creating any output', () => {
  const r=cli('inspect','--config','absent.json','--force'); assert.equal(r.status,2); assert.match(r.stderr,/unknown option/);
});
test('production training never falls back when protocol is missing', () => {
  const r=cli('train-window','--round','1','--window-seconds','60'); assert.equal(r.status,2); assert.match(r.stderr,/protocol/);
});
test('NaN window is rejected before any spawn', () => {
  const r=cli('train-window','--protocol','absent','--round','1','--window-seconds','NaN'); assert.equal(r.status,2); assert.match(r.stderr,/finite/);
});
test('unimplemented task exits nonzero with explicit state', () => {
  const r=cli('confirm','--protocol','absent','--candidate','absent','--attempt','1');assert.equal(r.status,2);assert.match(r.stderr,/not_implemented/);
  const implemented=cli('verify-data','--config','absent');assert.equal(implemented.status,2);assert.match(implemented.stderr,/blocked/);assert.doesNotMatch(implemented.stdout,/completed|verified/);
});
test('handoff preserves already spent budget, opened attempts and round', async () => {
  const m=await mod(); const dir=mkdtempSync(join(tmpdir(),'r6-budget-'));const p=join(dir,'ledger.jsonl');
  m.initializeBudget(p,'cycle',100,10);m.reserveBudget(p,'cycle','task',20);m.settleBudget(p,'cycle','task',12);
  const before=readFileSync(p,'utf8');m.initializeBudget(p,'cycle',100,0);
  assert.equal(readFileSync(p,'utf8'),before);assert.equal(m.readBudget(p,'cycle').spentSeconds,22);
  assert.throws(()=>m.initializeBudget(p,'other-cycle',100,0),/cycle/);
  const handoff=m.preserveRunState({ round:2, absoluteUpdate:800, confirmationAttemptsOpened:2, checkpointManifestPath:'/old/checkpoint' });
  assert.equal(handoff.round,2);assert.equal(handoff.absoluteUpdate,800);assert.equal(handoff.confirmationAttemptsOpened,2);
});
test('budget reservations cannot overspend or be reset by restart',async()=>{
  const m=await mod();const dir=mkdtempSync(join(tmpdir(),'r6-budget-'));const p=join(dir,'ledger.jsonl');
  m.initializeBudget(p,'cycle',100,70);m.reserveBudget(p,'cycle','first',25);
  assert.throws(()=>m.reserveBudget(p,'cycle','second',6),/budget/);
  assert.throws(()=>m.settleBudget(p,'cycle','first',26),/reservation/);
  assert.equal(m.readBudget(p,'cycle').availableSeconds,5);
});
test('NaN, corrupt ledger, duplicate settlement and changed cap reject',async()=>{
  const m=await mod();const dir=mkdtempSync(join(tmpdir(),'r6-budget-'));const p=join(dir,'ledger.jsonl');
  assert.throws(()=>m.initializeBudget(p,'cycle',NaN,0),/finite/);assert.equal(existsSync(p),false);
  m.initializeBudget(p,'cycle',100,0); assert.throws(()=>m.initializeBudget(p,'cycle',200,0),/limit/);
  m.reserveBudget(p,'cycle','job',10);m.settleBudget(p,'cycle','job',5);
  assert.throws(()=>m.settleBudget(p,'cycle','job',5),/reservation/);
  writeFileSync(p,readFileSync(p,'utf8').replace('"actualSeconds":5','"actualSeconds":0'));
  assert.throws(()=>m.readBudget(p,'cycle'),/hash/);
});
test('PID reuse rejects checkpoint control without sending a signal',async()=>{
  const m=await mod();assert.throws(()=>m.verifyProcessIdentity({pid:11,startTime:'old',cwd:'/repo',protocolHash:'a'},{pid:11,startTime:'new',cwd:'/repo',protocolHash:'a'}),/identity/);
});
test('snapshot file tampering is rejected',async()=>{
 const m=await mod();const dir=mkdtempSync(join(tmpdir(),'r6-snap-'));const p=join(dir,'worker.mjs');writeFileSync(p,'original');
 const manifest=[{path:p,sha256:m.sha256File(p)}];m.verifyFiles(manifest);writeFileSync(p,'changed');assert.throws(()=>m.verifyFiles(manifest),/hash/);
});
test('reusing a settled task ID rejects before corrupting the ledger',async()=>{
 const m=await mod();const dir=mkdtempSync(join(tmpdir(),'r6-budget-'));const p=join(dir,'ledger.jsonl');
 m.initializeBudget(p,'cycle',100,0);m.reserveBudget(p,'cycle','job',10);m.settleBudget(p,'cycle','job',5);
 const before=readFileSync(p,'utf8');assert.throws(()=>m.reserveBudget(p,'cycle','job',10),/duplicate/);
 assert.equal(readFileSync(p,'utf8'),before);assert.equal(m.readBudget(p,'cycle').spentSeconds,5);
});
// These exercise the real CLI in a copied fixture repo, never the live budget.
import { mkdirSync, cpSync, realpathSync } from 'node:fs';
function replica() {
 const repo=realpathSync(mkdtempSync(join(tmpdir(),'r6-cli-repo-')));mkdirSync(join(repo,'lab/review6'),{recursive:true});
 for(const f of ['run.mjs','runtime.mjs'])cpSync(new URL('./'+f,import.meta.url),join(repo,'lab/review6',f));
 const source=join(repo,'source.txt');writeFileSync(source,'baseline');
 const baseline=join(repo,'baseline.json');writeFileSync(baseline,JSON.stringify({files:[{path:source,sha256:'8ba8496a2525ae171ffd104d632dede6ef418d9b95962a9d88e2fcdbc8d48d24'}]}));
 const absent=join(repo,'absence.json');writeFileSync(absent,JSON.stringify({cycleId:'review6-humanlike-20261028',previousCycleFound:false}));
 writeFileSync(join(repo,'lab/review6/state-index.json'),JSON.stringify({cycleId:'review6-humanlike-20261028',runManifests:[],openedLedger:null}));
 const cfg={repo,cycleId:'review6-humanlike-20261028',budget:{cycleActiveSeconds:259200,windowMaxSeconds:14400},handoff:{baselinePath:baseline,budgetLedgerPath:join(repo,'lab/review6/budget-ledger.jsonl'),cycleAbsenceReceipt:absent,initialConservativeSeconds:10,inheritedRunState:{round:0,absoluteUpdate:0,confirmationAttemptsOpened:0,checkpointManifestPath:null}}};
 const config=join(repo,'draft.json');writeFileSync(config,JSON.stringify(cfg));
 const call=(...args)=>spawnSync(process.execPath,[join(repo,'lab/review6/run.mjs'),...args],{encoding:'utf8'});
 return {repo,cfg,config,call};
}
test('real inspect binds the original cycle to one canonical budget path',()=>{
 const f=replica();assert.equal(f.call('inspect','--config',f.config).status,0);
 f.cfg.handoff.budgetLedgerPath=join(f.repo,'fresh-ledger.jsonl');f.cfg.handoff.initialConservativeSeconds=0;writeFileSync(f.config,JSON.stringify(f.cfg));
 const r=f.call('inspect','--config',f.config);assert.equal(r.status,2,r.stdout);assert.match(r.stderr,/canonical|anchor/);assert.equal(existsSync(f.cfg.handoff.budgetLedgerPath),false);
});
test('real status rejects invented, regressed and invalid run counters',()=>{
 const f=replica();assert.equal(f.call('inspect','--config',f.config).status,0);
 for(const state of [{round:2,absoluteUpdate:800,confirmationAttemptsOpened:2,checkpointManifestPath:'/missing'},{round:-1,absoluteUpdate:-1,confirmationAttemptsOpened:4,checkpointManifestPath:null}]){
  f.cfg.handoff.inheritedRunState=state;writeFileSync(f.config,JSON.stringify(f.cfg));
  const r=f.call('status','--config',f.config);assert.equal(r.status,2,r.stdout);assert.match(r.stderr,/state|round|checkpoint|attempt/);
 }
});
test('real status cannot report completion for a missing ledger',()=>{
 const f=replica();const r=f.call('status','--config',f.config);assert.equal(r.status,2,r.stdout);assert.match(r.stderr,/ledger|budget/);
});
test('real handoff reads round two and two opened attempts and refuses their omission',async()=>{
 const m=await mod(),f=replica();assert.equal(f.call('inspect','--config',f.config).status,0);
 const runDir=join(f.repo,'lab/review6/runs/pair1-B');mkdirSync(runDir,{recursive:true});
 const checkpoint=join(runDir,'checkpoint.json');writeFileSync(checkpoint,JSON.stringify({cycleId:f.cfg.cycleId,runId:'pair1-B',round:2,absoluteUpdate:800}));
 const run=join(runDir,'run-manifest.json');writeFileSync(run,JSON.stringify({cycleId:f.cfg.cycleId,runId:'pair1-B',round:2,absoluteUpdate:800,checkpoint:{path:checkpoint,sha256:m.sha256File(checkpoint)}}));
 const opened=join(f.repo,'lab/review6/confirmation-opened.jsonl');writeFileSync(opened,[1,2].map(attempt=>JSON.stringify({cycleId:f.cfg.cycleId,attempt,kind:'opened'})).join('\n')+'\n');
 const index=join(f.repo,'lab/review6/state-index.json');writeFileSync(index,JSON.stringify({cycleId:f.cfg.cycleId,runManifests:[{path:run,sha256:m.sha256File(run)}],openedLedger:{path:opened,sha256:m.sha256File(opened)}}));
 f.cfg.handoff.inheritedRunState={round:2,absoluteUpdate:800,confirmationAttemptsOpened:2,checkpointManifestPath:index};writeFileSync(f.config,JSON.stringify(f.cfg));
 const r=f.call('status','--config',f.config);assert.equal(r.status,0,r.stderr);const state=JSON.parse(r.stdout).inheritedRunState;assert.equal(state.round,2);assert.equal(state.absoluteUpdate,800);assert.equal(state.confirmationAttemptsOpened,2);
 writeFileSync(index,JSON.stringify({cycleId:f.cfg.cycleId,runManifests:[],openedLedger:null}));
 f.cfg.handoff.inheritedRunState={round:0,absoluteUpdate:0,confirmationAttemptsOpened:0,checkpointManifestPath:null};writeFileSync(f.config,JSON.stringify(f.cfg));
 const regressed=f.call('status','--config',f.config);assert.equal(regressed.status,2,regressed.stdout);assert.match(regressed.stderr,/omitted|manifest|opened/);
});
test('read-only status reports authorized working-source drift without erasing baseline identity',()=>{
 const f=replica();assert.equal(f.call('inspect','--config',f.config).status,0);
 writeFileSync(join(f.repo,'source.txt'),'a later product edit');const r=f.call('status','--config',f.config);
 assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout);
 assert.equal(value.sourceChanges.length,1);assert.equal(value.sourceChanges[0].path,join(f.repo,'source.txt'));
 assert.equal(value.baseline.files[0].sha256,'8ba8496a2525ae171ffd104d632dede6ef418d9b95962a9d88e2fcdbc8d48d24');
});
test('real human-fit entry rejects a missing frozen H contract before any fit or reservation',()=>{
 const f=replica();const r=f.call('train-human-proxy','--config',f.config);
 assert.equal(r.status,2);assert.match(r.stderr,/frozen H fit contract required/);
 assert.equal(existsSync(join(f.repo,'lab/review6/H-fit.anchor.json')),false);
});
