import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2), selected = [];
for (let i = 0; i < args.length; i += 2) {
  assert.equal(args[i], '--case', 'only explicit --case selectors are allowed');
  assert.ok(['closeout-lifecycle', 'check-scope', 'browser-contract'].includes(args[i + 1]), 'unknown or missing case selector');
  assert.ok(!selected.includes(args[i + 1]), 'duplicate case selector');
  selected.push(args[i + 1]);
}
assert.ok(selected.length, 'missing case selector; no default full suite');
const entry = path.join(sourceRoot, 'scripts/ohuo-delivery.mjs');
assert.ok(fs.existsSync(entry), 'B00 delivery entry must exist');
const { delivery, parseCLI } = await import(entry);
const { runChecks } = await import(path.join(sourceRoot, 'scripts/ohuo-delivery/checks.mjs'));
const { loadContext, sha256, canonical } = await import(path.join(sourceRoot, 'scripts/ohuo-delivery/core.mjs'));
const hash = b => createHash('sha256').update(b).digest('hex');
const outputRoot = path.join(sourceRoot, 'lab/out/b00-checks');
fs.mkdirSync(outputRoot, { recursive: true });
const observations = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(outputRoot, 'fixture-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture baseline']);
  const baseCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const id = `B00-fixture-${randomUUID()}`;
  const dir = `deliverables/ohuo-batches/${id}`;
  function put(rel, value) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
    return ref(rel);
  }
  function ref(rel) { return { path: rel, sha256: hash(fs.readFileSync(path.join(root, rel))) }; }
  const auth = put(`${dir}/authorization.txt`, 'SYNTHETIC TEST FIXTURE ONLY: user permits fixture development, apply, offline synthetic checks and fixture-only trash simulation.');
  put('scripts/demo.mjs', 'export const value = 1;\n');
  put('lab/out/input.json', { kind: 'synthetic', input: 1 });
  put('lab/out/probe.mjs', fs.readFileSync(path.join(sourceRoot, 'lab/review6_2/checks/delivery-fixtures/probe.mjs'), 'utf8'));
  const sourceRef = { baseCommit, files: [ref('scripts/demo.mjs'), ref('lab/out/probe.mjs')] };
  const plan = { planRef: `${id}/check-plan`, revision: 1, sourceRef, checks: [{
    checkId: 'B00.check-scope', site: 'cloud', entryId: 'delivery_cases', caseId: 'pass',
    inputRefs: [ref('lab/out/input.json')], expected: 'only selected fixture runs', requires: ['offline_synthetic'],
    authorizationRefs: [auth], directImpactReason: 'fixture of B00 scoped execution', reuseEvidenceRef: null
  }], notRun: ['all unrelated modules, real assets, APIs, training'] };
  const m = { schemaVersion: 1, batchId: id, revision: 1, status: 'ready_for_local', baseCommit,
    acceptedParentRef: { commit: baseCommit }, dependsOn: [], authorizationRef: auth,
    authorizedScope: { develop: { basisRef: auth }, apply: { basisRef: auth }, syntheticChecks: { basisRef: auth, capabilities: ['offline_synthetic'] }, cleanup: { basisRef: auth, categories: ['temporary-download', 'rebuildable-check-output'], destination: 'trash' } },
    authorTaskRef: 'synthetic-fixture', ownerFiles: ['scripts/demo.mjs'], allowedPaths: ['scripts/demo.mjs', 'lab/out', dir], protectedPaths: ['lab/out/protected'],
    changeSummary: 'B00 synthetic fixture only', artifactRef: null, patchSHA256: null,
    changedFiles: [{ path: 'scripts/demo.mjs', beforeSHA256: null, afterSHA256: ref('scripts/demo.mjs').sha256 }],
    checkPlan: plan, cloudEvidence: [], localEvidence: [], manualEvidenceRefs: {}, checkReceiptRefs: [], acceptedCodeRef: null,
    compatibilityDeltaRef: null, unresolved: [], recoveryRef: null, cleanupCandidates: [], closeoutTaskRef: null, closeoutReceiptRef: null,
    cleanupChannel: null };
  const batchPath = path.join(root, dir, 'engineering-batch.json');
  const save = () => put(`${dir}/engineering-batch.json`, m);
  const read = () => JSON.parse(fs.readFileSync(batchPath, 'utf8'));
  const registry = { 'B00.check-scope': { status: 'implemented', entryId: 'delivery_cases', caseId: 'pass', sites: ['cloud'], requires: ['offline_synthetic'], path: 'lab/out/probe.mjs', sourcePaths: ['lab/out/probe.mjs'], runtime: 'node' } };
  async function run() { save(); return runChecks(loadContext(root, batchPath), { site: 'cloud', checkIds: ['B00.check-scope'] }, registry); }
  async function call(action, options = {}) { return delivery(action, { root, batchPath, registry, channelVerifier: channel => fs.realpathSync(channel.root), ...options }); }
  function sync() { Object.assign(m, read()); }
  function cleanupSetup(count = 2) {
    const recover = put(`${dir}/recovery.json`, { synthetic: true, baseCommit, artifactRefs: [ref('scripts/demo.mjs')], verificationRef: put(`${dir}/restore-proof.txt`, 'Synthetic fixture restore identity verified from known generated bytes.'), verifiedAt: new Date().toISOString(), restore: 'Recreate fixture from fixed test source; no user files.' });
    m.recoveryRef = recover;
    m.cleanupChannel = { kind: 'trash', root: path.join(root, 'lab/out/trash'), evidenceRef: put(`${dir}/channel.txt`, 'Synthetic fixture trash channel, not system Trash.') };
    fs.mkdirSync(m.cleanupChannel.root, { recursive: true });
    for (let i = 0; i < count; i++) {
      const r = put(`lab/out/candidate-${i}.txt`, `temporary ${i}`);
      const dep = put(`${dir}/dependency-${i}.json`, { batchId: id, sourceRef, candidatePath: r.path, candidateSHA256: r.sha256, checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 600000).toISOString(), activeDependencies: [], checkedScopes: ['current-run', 'model', 'save', 'source', 'recovery'], evidenceRefs: [recover], checkedBy: 'synthetic fixture' });
      m.cleanupCandidates.push({ candidateId: `temp-${i}`, path: r.path, category: 'temporary-download', sha256: r.sha256, recoveryRef: recover, activeDependencies: [], dependencyCheckRef: dep, allowedDestination: 'trash' });
    }
  }
  return { root, id, dir, m, put, ref, save, read, sync, batchPath, registry, run, call, cleanupSetup, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

async function closeoutLifecycle() {
  const f = fixture();
  try {
    f.cleanupSetup();
    assert.equal((await f.run()).status, 'passed'); f.sync();
    const first = await f.call('finish');
    assert.equal(first.functionalStatus, 'accepted');
    assert.equal(first.deliveryStatus, 'open');
    assert.equal(first.cleanupStatus, 'cleanup_pending');
    assert.ok(first.acceptanceRef, 'functional acceptance must have stable independent receipt');
    const dependent = structuredClone(f.read()); dependent.batchId = f.id + '-dependent'; dependent.status = 'ready_for_local';
    dependent.checkPlan.planRef = dependent.batchId + '/plan'; dependent.checkReceiptRefs = []; dependent.acceptedCodeRef = null; dependent.closeoutTaskRef = null;
    dependent.acceptedParentRef = { receiptRef: first.acceptanceRef, sourceRef: dependent.checkPlan.sourceRef }; dependent.dependsOn = [first.acceptanceRef];
    dependent.changedFiles.forEach(row => { row.beforeSHA256 = row.afterSHA256; });
    const depDir = `deliverables/ohuo-batches/${dependent.batchId}`; dependent.allowedPaths.push(depDir);
    f.put(`${depDir}/engineering-batch.json`, dependent);
    const inspectDependent = () => delivery('inspect', { root: f.root, batchPath: path.join(f.root, depDir, 'engineering-batch.json') });
    assert.equal((await inspectDependent()).status, 'passed');
    const again = await f.call('finish');
    assert.deepEqual(again.taskRef, first.taskRef, 'same batch must return same immutable task');
    const resume = await f.call('resume-closeout');
    assert.deepEqual(resume.taskRef, first.taskRef);
    const task = JSON.parse(fs.readFileSync(path.join(f.root, first.taskRef.path)));
    assert.equal(task.candidates.length, 2);
    const candidate = f.m.cleanupCandidates[0];
    const destination = path.join(f.m.cleanupChannel.root, 'temp-0.txt');
    fs.renameSync(path.join(f.root, candidate.path), destination);
    const receipt = { batchId: f.id, taskRef: first.taskRef, entries: [{ candidateId: candidate.candidateId, status: 'done', sourcePath: candidate.path, destinationPath: destination, sha256: candidate.sha256, operationRef: f.put(`${f.dir}/move.txt`, 'Actual rename of synthetic fixture into simulated trash directory.') }] };
    f.m.closeoutReceiptRef = f.put(`${f.dir}/incoming-1.json`, receipt); f.sync(); f.m.closeoutReceiptRef = f.ref(`${f.dir}/incoming-1.json`); f.save();
    const partial = await f.call('record-closeout');
    assert.equal(partial.deliveryStatus, 'open');
    assert.equal(partial.confirmed.length, 1);
    assert.equal((await f.call('resume-closeout')).confirmed.length, 1);
    const c2 = f.m.cleanupCandidates[1];
    const receipt2 = { batchId: f.id, taskRef: first.taskRef, entries: [{ candidateId: c2.candidateId, status: 'retained', sourcePath: c2.path, sha256: c2.sha256, reason: 'fixture dependency remains under review', releaseCondition: 'local reviewer confirms no active references' }] };
    f.sync(); f.m.closeoutReceiptRef = f.put(`${f.dir}/incoming-2.json`, receipt2); f.save();
    const closed = await f.call('record-closeout');
    assert.equal(closed.deliveryStatus, 'closed');
    assert.equal(closed.cleanupStatus, 'partial');
    assert.equal((await inspectDependent()).status, 'passed', 'parent cleanup must not invalidate frozen functional acceptance reference');
    assert.equal((await f.call('record-closeout')).confirmed.length, 2, 'receipt replay is idempotent');
    f.sync(); f.m.changeSummary = 'illegal rewrite after acceptance'; f.save();
    assert.equal((await f.call('finish')).status, 'rejected');
    observations.push('finish→accepted/pending; immutable task; partial receipt→resume→retained/closed; accepted manifest conflict rejected');
  } finally { f.dispose(); }
  const noChannel = fixture();
  try { noChannel.cleanupSetup(1); await noChannel.run(); noChannel.sync(); const r = await noChannel.call('finish', { channelVerifier: undefined }); assert.equal(r.items[0].status, 'blocked', 'arbitrary directory must not masquerade as system Trash'); } finally { noChannel.dispose(); }
  const drift = fixture();
  try { drift.cleanupSetup(1); await drift.run(); drift.sync(); await drift.call('finish'); drift.put('scripts/demo.mjs', 'changed after acceptance'); assert.equal((await drift.call('resume-closeout')).status, 'rejected', 'resume must reject current source drift'); } finally { drift.dispose(); }
  const incomplete = fixture();
  try { incomplete.save(); const r = await incomplete.call('finish'); assert.equal(r.status, 'pending'); assert.ok(!fs.existsSync(path.join(incomplete.root, incomplete.dir, 'closeout-task.json'))); } finally { incomplete.dispose(); }
  const noop = fixture();
  try { await noop.run(); noop.sync(); const r = await noop.call('finish'); assert.equal(r.cleanupStatus, 'noop'); assert.equal(r.deliveryStatus, 'closed'); const taskRef = r.taskRef; fs.unlinkSync(path.join(noop.root, noop.dir, 'delivery-state.json')); const recovered = await noop.call('finish'); assert.equal(recovered.cleanupStatus, 'noop', 'interrupted noop must be resumable'); assert.deepEqual(recovered.taskRef, taskRef); } finally { noop.dispose(); }
  for (const variant of ['no-recovery', 'protected', 'changed', 'unknown-source', 'outside', 'stale-dependency']) {
    const g = fixture();
    try {
      g.cleanupSetup(1); if (variant === 'no-recovery') g.m.recoveryRef = null;
      if (variant === 'protected') g.m.protectedPaths.push(g.m.cleanupCandidates[0].path);
      if (variant === 'outside') g.m.cleanupCandidates[0].path = '../escape';
      if (variant === 'stale-dependency') {
        const rel = g.m.cleanupCandidates[0].dependencyCheckRef.path;
        const d = JSON.parse(fs.readFileSync(path.join(g.root, rel))); d.validUntil = '2000-01-01T00:00:00.000Z';
        g.m.cleanupCandidates[0].dependencyCheckRef = g.put(rel, d);
      }
      await g.run(); g.sync();
      if (variant === 'changed') fs.writeFileSync(path.join(g.root, g.m.cleanupCandidates[0].path), 'changed');
      if (variant === 'unknown-source') fs.unlinkSync(path.join(g.root, g.m.cleanupCandidates[0].path));
      const result = await g.call('finish');
      assert.equal(result.functionalStatus, 'accepted', `${variant}: cleanup must not revoke functional acceptance`);
      assert.equal(result.items[0].status, 'blocked');
      observations.push(`${variant}: function accepted, cleanup item blocked`);
    } finally { g.dispose(); }
  }
}

async function checkScope() {
  for (const extra of ['--all', '--cmd', '--script', '--arbitrary']) {
    const f = fixture();
    try { f.save(); const parsed = parseCLI(['run-checks', '--batch', f.batchPath, '--site', 'cloud', '--check', 'B00.check-scope', extra, 'npm test']);
      const r = await runChecks(loadContext(f.root, f.batchPath), parsed.request, f.registry); assert.equal(r.status, 'rejected'); assert.deepEqual(r.executed, []);
    } finally { f.dispose(); }
  }
  for (const ids of [[], ['B00.check-scope', 'unknown'], ['*'], ['npm test'], ['B01.synthetic_load']]) {
    const f = fixture();
    try {
      f.save();
      const r = await runChecks(loadContext(f.root, f.batchPath), { site: 'cloud', checkIds: ids }, f.registry);
      assert.equal(r.status, 'rejected'); assert.deepEqual(r.executed, []);
      assert.ok(!fs.existsSync(path.join(f.root, 'lab/out/probe-executed.txt')));
    } finally { f.dispose(); }
  }
  const f = fixture();
  try {
    const r = await f.run(); assert.equal(r.status, 'passed'); assert.deepEqual(r.executed, ['B00.check-scope']);
    assert.equal(r.results[0].executionMode, 'executed');
    assert.equal(r.results[0].shell, false);
    assert.deepEqual(r.results[0].argv, ['lab/out/probe.mjs', '--case', 'pass']);
    assert.equal(fs.readFileSync(path.join(f.root, 'lab/out/probe-executed.txt'), 'utf8'), 'pass\n');
    f.sync(); f.m.checkPlan.checks[0].reuseEvidenceRef = f.m.checkReceiptRefs[0]; f.m.revision++; f.m.checkPlan.revision++;
    const reused = await f.run();
    assert.equal(reused.status, 'passed'); assert.deepEqual(reused.executed, []); assert.equal(reused.results[0].executionMode, 'reused');
    assert.equal(fs.readFileSync(path.join(f.root, 'lab/out/probe-executed.txt'), 'utf8'), 'pass\n');
    f.sync(); f.put('lab/out/input.json', { changed: true });
    const changed = await f.run(); assert.equal(changed.status, 'rejected'); assert.deepEqual(changed.executed, []);
    observations.push('explicit selector only; aggregate validation rejects all illegal requests before spawn; shell:false argv; reuse is not executed; changed input rejected');
  } finally { f.dispose(); }
  const stop = fixture();
  try {
    const first = stop.m.checkPlan.checks[0]; first.caseId = 'fail'; stop.registry[first.checkId].caseId = 'fail';
    const second = { ...first, checkId: 'B00.closeout-lifecycle', caseId: 'pass', dependsOn: [first.checkId] };
    stop.m.checkPlan.checks.push(second); stop.registry[second.checkId] = { ...stop.registry[first.checkId], caseId: 'pass' };
    stop.save(); const r = await runChecks(loadContext(stop.root, stop.batchPath), { site: 'cloud', checkIds: [first.checkId, second.checkId] }, stop.registry);
    assert.equal(r.status, 'failed'); assert.deepEqual(r.executed, [first.checkId]); assert.equal(r.results[1].status, 'pending');
    assert.equal(fs.readFileSync(path.join(stop.root, 'lab/out/probe-executed.txt'), 'utf8'), 'fail\n');
    observations.push('failed case retains nonzero result and prevents its explicit dependent from starting');
  } finally { stop.dispose(); }
  for (const variant of ['source-change', 'symlink', 'permission']) {
    const q = fixture();
    try {
      if (variant === 'source-change') q.put('scripts/demo.mjs', 'changed');
      if (variant === 'symlink') { fs.renameSync(path.join(q.root, 'lab/out/input.json'), path.join(q.root, 'lab/out/real.json')); fs.symlinkSync('real.json', path.join(q.root, 'lab/out/input.json')); }
      if (variant === 'permission') delete q.m.authorizedScope.syntheticChecks;
      const r = await q.run(); assert.equal(r.status, variant === 'permission' ? 'pending' : 'rejected'); assert.deepEqual(r.executed, []);
    } finally { q.dispose(); }
  }
  const portable = fixture();
  try { await portable.run(); portable.sync(); const rel = portable.m.checkReceiptRefs[0].path; const r = JSON.parse(fs.readFileSync(path.join(portable.root, rel))); r.results[0].executable = '/other-host/bin/node'; portable.m.checkReceiptRefs = [portable.put(rel, r)]; portable.save(); assert.equal((await portable.call('finish')).functionalStatus, 'accepted', 'same-source cloud receipt does not require identical local Node install path'); } finally { portable.dispose(); }
  for (const permission of [false, true]) {
    const ro = fixture();
    try {
      const protectedRef = ro.put('lab/out/protected/read-only.json', { fixture: true }); protectedRef.readOnly = true;
      ro.m.checkPlan.checks[0].inputRefs = [protectedRef];
      ro.m.checkPlan.checks[0].requires.push('private_asset_read'); ro.registry['B00.check-scope'].requires.push('private_asset_read');
      if (permission) ro.m.authorizedScope.realAssetChecks = { basisRef: ro.m.authorizationRef, capabilities: ['private_asset_read'] };
      const r = await ro.run(); assert.equal(r.status, permission ? 'passed' : 'pending');
      if (!permission) assert.deepEqual(r.executed, []);
      ro.sync(); ro.m.changedFiles[0].path = protectedRef.path; ro.m.ownerFiles = [protectedRef.path]; ro.save();
      assert.equal((await ro.call('inspect')).status, 'rejected', 'protected read permission never authorizes changed/cleanup paths');
    } finally { ro.dispose(); }
  }
  const rewrite = fixture();
  try { await rewrite.run(); rewrite.sync(); rewrite.m.checkPlan.checks[0].expected = 'changed without revision'; const r = await rewrite.run(); assert.equal(r.status, 'rejected', 'same revision must retain frozen check plan'); assert.deepEqual(r.executed, []); } finally { rewrite.dispose(); }
  const wrongParent = fixture();
  try { await wrongParent.run(); wrongParent.sync(); wrongParent.m.changedFiles[0].beforeSHA256 = 'a'.repeat(64); wrongParent.save(); assert.equal((await wrongParent.call('finish')).status, 'rejected', 'claimed before identity must match exact accepted parent'); } finally { wrongParent.dispose(); }
  const corrupted = fixture();
  try { await corrupted.run(); corrupted.sync(); const rel = corrupted.m.checkReceiptRefs[0].path; const r = JSON.parse(fs.readFileSync(path.join(corrupted.root, rel))); r.results[0].argv = ['-e', 'arbitrary-code']; corrupted.m.checkReceiptRefs = [corrupted.put(rel, r)]; corrupted.save(); assert.equal((await corrupted.call('finish')).status, 'rejected', 'finish must reject forged command outside fixed registry'); } finally { corrupted.dispose(); }
  const g = fixture();
  try {
    const c = g.m.checkPlan.checks[0]; c.manualEvidenceKey = 'local-observation'; c.site = 'local';
    g.registry[c.checkId] = { ...g.registry[c.checkId], sites: ['local'], mode: 'manual', observations: [{ key: 'sourceAbsent', expected: true }, { key: 'destinationMatches', expected: true }] };
    g.save();
    let r = await runChecks(loadContext(g.root, g.batchPath), { site: 'local', checkIds: [c.checkId] }, g.registry);
    assert.equal(r.status, 'pending'); assert.deepEqual(r.executed, []); g.sync();
    g.m.manualEvidenceRefs['local-observation'] = g.put(`${g.dir}/manual.json`, { batchId: g.id, planRef: g.m.checkPlan.planRef, revision: g.m.revision, sourceRef: g.m.checkPlan.sourceRef, checkId: c.checkId, caseId: c.caseId, inputRefs: c.inputRefs, toolReceiptRefs: [g.put(`${g.dir}/tool.txt`, 'Synthetic actual file-state observation for fixture.')], observations: [{ key: 'sourceAbsent', expected: true, actual: true }, { key: 'destinationMatches', expected: true, actual: true }], incomplete: [] });
    g.save(); r = await runChecks(loadContext(g.root, g.batchPath), { site: 'local', checkIds: [c.checkId] }, g.registry);
    assert.equal(r.status, 'passed'); assert.equal(r.results[0].executionMode, 'manual'); assert.deepEqual(r.executed, []);
    observations.push('manual absent evidence remains pending; bound observations and actual tool references produce manual, never executed');
  } finally { g.dispose(); }
}

async function browserContract() {
  const vectors = [
    ['ui-pre-runtime','rejected',(c,b,g,e)=>{b.observedAt='2026-10-30T00:00:01Z';const v=JSON.parse(fs.readFileSync(path.join(g.root,b.uiEvidenceRef.path)));v.observedAt=b.observedAt;b.uiEvidenceRef=g.put('lab/out/old-ui.json',v);e.toolReceiptRefs.push(b.uiEvidenceRef);} ],
    ['daily-observed-asset-pre-runtime','rejected',(c,b,g,e)=>{const a=b.assetResponseRefs[0],v=JSON.parse(fs.readFileSync(path.join(g.root,a.evidenceRef.path)));v.observedAt='2026-10-30T00:00:01Z';a.evidenceRef=g.put('lab/out/old-observed-asset.json',v);e.toolReceiptRefs.push(a.evidenceRef);} ],
    ['daily-asset-request-url-mismatch','rejected',(c,b,g,e)=>{const a=b.assetResponseRefs[0],v=JSON.parse(fs.readFileSync(path.join(g.root,a.evidenceRef.path)));v.requestURL=c.targetOrigin+'/not-the-declared-asset';a.evidenceRef=g.put('lab/out/wrong-asset-url.json',v);e.toolReceiptRefs.push(a.evidenceRef);} ],
    ['missing-tool-file','pending',(c,b,g)=>{fs.unlinkSync(path.join(g.root,b.actionEvidence[0].toolReceiptRef.path));}],
    ['missing-contract-input', 'pending', ()=>{}],
    ['unknown-loaded-version', 'pending', (c,b,g)=>{b.runtimeSourceRef=g.put('lab/out/unknown-runtime.json',{pid:1,startedAt:'2026-10-31T00:00:00Z',cwd:'/fixture',entry:'fake',diskSourceRef:c.expectedSourceRef,loadedSourceRef:null,evidenceLocations:{disk:'source',loaded:'unknown'}});}],
    ['legacy-manual-unchanged','passed',(c,b,g,e)=>{delete e.browserContext;}],
    ['daily-valid','passed',()=>{}],
    ['daily-wrong-catalog','rejected',(c,b,g,e)=>{const v=JSON.parse(fs.readFileSync(path.join(g.root,b.catalogRef.path)));v.releaseBindings[0].policyId='wrong';b.catalogRef=g.put('lab/out/wrong-catalog.json',v);e.toolReceiptRefs.push(b.catalogRef);} ],
    ['daily-missing-asset','pending',(c,b)=>{b.assetResponseRefs=[];}],
    ['daily-reused-asset','passed',()=>{}],
    ['daily-reuse-root-changed','rejected',(c,b,g,e)=>{const a=b.assetResponseRefs[0],v=JSON.parse(fs.readFileSync(path.join(g.root,a.reuseBasisRef.path)));v.serviceRoot='/other';a.reuseBasisRef=g.put('lab/out/wrong-reuse.json',v);e.toolReceiptRefs.push(a.reuseBasisRef);} ],
    ['empty-actions', 'pending', (c,b)=>{b.actionEvidence=[];}],
    ['valid', 'passed', ()=>{}],
    ['wrong-origin', 'rejected', (c,b)=>{b.origin='http://localhost:5180';}],
    ['missing-tool', 'pending', (c,b)=>{b.actionEvidence[0].toolReceiptRef=null;}],
    ['missing-runtime', 'pending', (c,b)=>{b.runtimeSourceRef=null;}],
    ['wrong-contract', 'rejected', (c,b,g)=>{b.contractRef=g.ref('lab/out/input.json');}],
    ['missing-context', 'pending', (c,b,g,e)=>{delete e.browserContext;}],
    ['prohibited-action', 'rejected', (c,b)=>{b.observedProhibitedActions=[{...b.actionEvidence[0],actionId:'real_api'}];}],
    ['wrong-source', 'rejected', c=>{c.expectedSourceRef={baseCommit:'0'.repeat(40),files:[]};}],
    ['bad-isolation', 'rejected', c=>{c.isolation.protectedOrigin=c.targetOrigin;}],
    ['false-observation', 'failed', (c,b,g,e)=>{e.observations[0].actual=false;}],
    ['undeclared-reuse', 'rejected', (c,b)=>{b.actionEvidence[0].mode='reused';}],
    ['wrong-runtime', 'rejected', (c,b,g)=>{b.runtimeSourceRef=g.put('lab/out/wrong-runtime.json',{pid:1,startedAt:'2026-10-31T00:00:00Z',cwd:'/fixture',entry:'fixed fake helper',diskSourceRef:c.expectedSourceRef,loadedSourceRef:{baseCommit:'0'.repeat(40),files:[]},evidenceLocations:{disk:'source',loaded:'module'}});}]
  ];
  for(const [name,expected,change] of vectors) {
    const g=fixture();
    try {
      const check=g.m.checkPlan.checks[0];Object.assign(check,{checkId:'A.fixture-ui.v1',site:'local',entryId:'browser_manual_fixture',caseId:'fixture-ui',manualEvidenceKey:'browser'});
      const runtime=g.put('lab/out/runtime.json',{pid:1,startedAt:'2026-10-31T00:00:00Z',cwd:'/fixture',entry:'fixed fake helper',diskSourceRef:g.m.checkPlan.sourceRef,loadedSourceRef:g.m.checkPlan.sourceRef,evidenceLocations:{disk:'source',loaded:'module'}});
      const cap=g.put('lab/out/capability.json',{toolName:'fixture-IAB',targetKind:'IAB',targetId:null,isolationModes:['independent-origin'],rawToolEvidence:'synthetic fixture only'});
      const iso=g.put('lab/out/isolation.json',{mode:'independent-origin',targetOrigin:'http://127.0.0.1:15183',protectedOrigin:'http://localhost:5180',writeBoundary:'fixture-only'});
      const tool=g.put('lab/out/tool.json',{synthetic:true,actions:{inspect_settings:{actualUrl:'http://127.0.0.1:15183/',result:'observed fake control'}},origin:'http://127.0.0.1:15183'});
      const ui=g.put('lab/out/ui.json',{origin:'http://127.0.0.1:15183',pageUrl:'http://127.0.0.1:15183/',observedAt:'2026-10-31T00:00:01Z',runtimeSourceRef:runtime,sourceRef:g.m.checkPlan.sourceRef,synthetic:true});
      const c={schema:'ohuo-browser-contract-v1',purpose:'legacy-visible-ui-check',batchId:g.m.batchId,planRef:g.m.checkPlan.planRef,revision:1,checkId:check.checkId,caseId:check.caseId,targetOrigin:'http://127.0.0.1:15183',browserPolicy:'iab-first-no-unjustified-repeat',isolation:{mode:'independent-origin',approvalRef:g.m.authorizationRef,protectedOrigin:'http://localhost:5180'},requiredActionIds:['inspect_settings'],allowedActionIds:['inspect_settings'],reuseAllowedActionIds:[],prohibitedActionIds:['real_api','new_game','forward','clear_storage','default_switch'],expectedSourceRef:g.m.checkPlan.sourceRef,runtimeInputs:[g.ref('lab/out/input.json')],expectedReleaseBindings:'not_applicable',priorEvidenceRefs:[],exceptionRef:null};
      const cref=g.put('lab/out/browser-contract.json',c);check.inputRefs=[cref,g.ref('lab/out/input.json')];
      const b={schema:'ohuo-browser-context-v1',contractRef:cref,browserEntry:{toolName:'fixture-IAB',entryDescription:'synthetic IAB capability, not a real browser observation',targetId:null,targetKind:'IAB',capabilityEvidenceRef:cap},origin:c.targetOrigin,pageUrl:c.targetOrigin+'/',observedAt:'2026-10-31T00:00:01Z',isolation:{mode:'independent-origin',evidenceRef:iso,protectedOrigin:c.isolation.protectedOrigin,writeBoundary:'fixture-only'},runtimeSourceRef:runtime,actionEvidence:[{actionId:'inspect_settings',mode:'observed',toolReceiptRef:tool,evidenceLocation:'actions.inspect_settings',actualUrl:c.targetOrigin+'/'}],catalogRef:'not_applicable',assetResponseRefs:[],uiEvidenceRef:ui,exceptionRef:null,missingEvidence:[],observedProhibitedActions:[]};
      const e={batchId:g.m.batchId,planRef:g.m.checkPlan.planRef,revision:1,sourceRef:g.m.checkPlan.sourceRef,checkId:check.checkId,caseId:check.caseId,inputRefs:check.inputRefs,toolReceiptRefs:[runtime,cap,iso,tool,ui],observations:[{key:'fixtureObserved',expected:true,actual:true}],incomplete:[],browserContext:b};
      const registry={[check.checkId]:{status:'implemented',entryId:check.entryId,caseId:check.caseId,sites:['local'],requires:['offline_synthetic'],mode:'manual',sourcePaths:g.m.checkPlan.sourceRef.files.map(r=>r.path),observations:[{key:'fixtureObserved',expected:true}],browserContractInputIndex:0,browserContractSchema:'ohuo-browser-contract-v1',browserPurpose:'legacy-visible-ui-check',requiredActionIds:['inspect_settings'],allowedActionIds:['inspect_settings']}};
      if(name.startsWith('daily-')) {
        const origin='http://localhost:5180', ids=['inspect_home','read_catalog','verify_asset_identity','verify_release_option'];
        c.purpose='daily-entry-effective';c.targetOrigin=origin;c.isolation={...c.isolation,mode:'none-readonly'};c.requiredActionIds=ids;c.allowedActionIds=ids;c.reuseAllowedActionIds=['verify_asset_identity'];
        c.expectedReleaseBindings=[{releaseRef:'fixture-release',policyId:'fixture-policy',identity:{schema:'synthetic-fixed-policy',encoder:'fixture-only'},assetUrl:'/ai/fixture.f32',bytes:4,sha256:'a'.repeat(64)}];
        Object.assign(registry[check.checkId],{browserPurpose:c.purpose,requiredActionIds:ids,allowedActionIds:ids});
        b.origin=origin;b.pageUrl=origin+'/';b.isolation={mode:'none-readonly',protectedOrigin:origin,writeBoundary:'read-only',evidenceRef:g.put('lab/out/daily-isolation.json',{mode:'none-readonly',targetOrigin:origin,protectedOrigin:origin,writeBoundary:'read-only'})};
        b.browserEntry.capabilityEvidenceRef=g.put('lab/out/daily-capability.json',{toolName:'fixture-IAB',targetKind:'IAB',targetId:null,isolationModes:['none-readonly']});
        const dailyTool=g.put('lab/out/daily-tool.json',{synthetic:true,actions:Object.fromEntries(ids.map(id=>[id,{actualUrl:origin+'/',result:'observed fake result'}]))});
        b.actionEvidence=ids.map(actionId=>({actionId,mode:'observed',toolReceiptRef:dailyTool,evidenceLocation:'actions.'+actionId,actualUrl:origin+'/'}));
        b.uiEvidenceRef=g.put('lab/out/daily-ui.json',{origin,pageUrl:b.pageUrl,observedAt:b.observedAt,runtimeSourceRef:runtime,sourceRef:c.expectedSourceRef,releaseOptions:[{releaseRef:'fixture-release',policyId:'fixture-policy',enabled:true,label:'fixture only'}]});
        b.catalogRef=g.put('lab/out/catalog.json',{requestURL:origin+'/@id/virtual:gd-model-index',origin,observedAt:b.observedAt,runtimeSourceRef:runtime,toolReceiptRef:dailyTool,releaseBindings:c.expectedReleaseBindings});
        const reused=name.includes('reuse');const oldRuntime=g.put('lab/out/old-runtime.json',{pid:2,startedAt:'2026-10-30T00:00:00Z',cwd:'/fixture',entry:'fake previous helper',diskSourceRef:c.expectedSourceRef,loadedSourceRef:c.expectedSourceRef,evidenceLocations:{disk:'source',loaded:'module'}});
        const asset=g.put('lab/out/asset.json',{requestURL:origin+'/ai/fixture.f32',origin,status:200,bytes:4,sha256:'a'.repeat(64),assetUrl:'/ai/fixture.f32',policyId:'fixture-policy',observedAt:reused?'2026-10-30T00:00:01Z':b.observedAt,runtimeSourceRef:reused?oldRuntime:runtime,toolReceiptRef:dailyTool});
        b.assetResponseRefs=[{policyId:'fixture-policy',mode:reused?'reused':'observed',evidenceRef:asset}];
        if(reused){c.priorEvidenceRefs=[asset,oldRuntime];const basis=g.put('lab/out/reuse-basis.json',{originalEvidenceRef:asset,currentRuntimeSourceRef:runtime,priorRuntimeSourceRef:oldRuntime,priorBinding:c.expectedReleaseBindings[0],currentBinding:c.expectedReleaseBindings[0],origin,serviceRoot:'/fixture',assetBindingChanged:false});b.assetResponseRefs[0].reuseBasisRef=basis;e.toolReceiptRefs.push(basis);}
        e.toolReceiptRefs.push(b.isolation.evidenceRef,b.browserEntry.capabilityEvidenceRef,b.uiEvidenceRef,b.catalogRef,dailyTool,asset,oldRuntime);
      }
      if(name==='legacy-manual-unchanged')for(const key of ['browserContractInputIndex','browserContractSchema','browserPurpose','requiredActionIds','allowedActionIds'])delete registry[check.checkId][key];
      change(c,b,g,e);const changedRef=g.put('lab/out/browser-contract.json',c);check.inputRefs[0]=changedRef;e.inputRefs=check.inputRefs;if(name!=='wrong-contract')b.contractRef=changedRef;
      if(['wrong-runtime','unknown-loaded-version'].includes(name))e.toolReceiptRefs.push(b.runtimeSourceRef);
      if(name==='missing-contract-input'){check.inputRefs=[];e.inputRefs=[];}
      g.m.manualEvidenceRefs.browser=g.put('lab/out/manual.json',e);g.save();
      const receipt=await runChecks(loadContext(g.root,g.batchPath),{site:'local',checkIds:[check.checkId]},registry);
      assert.equal(receipt.status,expected,`${name}: ${receipt.reason||JSON.stringify(receipt.results)}`);assert.deepEqual(receipt.executed,[]);
      if(name==='valid'){g.sync();assert.equal((await delivery('finish',{root:g.root,batchPath:g.batchPath,registry})).functionalStatus,'accepted');}
      observations.push(`${name}: ${expected}; synthetic contract only, no browser invoked`);
    } finally {g.dispose();}
  }
}

for (const caseId of selected) {
  const before = observations.length, startedAt = new Date().toISOString();
  await ({ 'closeout-lifecycle': closeoutLifecycle, 'check-scope': checkScope, 'browser-contract': browserContract })[caseId]();
  console.log(JSON.stringify({ caseId, status: 'passed', startedAt, endedAt: new Date().toISOString(), expected: caseId==='browser-contract'?'v5.2.3 A finite synthetic binding contract':'v5.2 B00 finite contract', actual: observations.slice(before), inputIdentity: hash(canonical({ caseId, fixtureSource: hash(fs.readFileSync(fileURLToPath(import.meta.url))), probe: hash(fs.readFileSync(path.join(sourceRoot, 'lab/review6_2/checks/delivery-fixtures/probe.mjs'))) })) }));
}
