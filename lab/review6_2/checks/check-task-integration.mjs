// B06 fixed registry/accepted-parent integration; this case never starts a task consumer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_REGISTRY, commandFor, runChecks } from '../../../scripts/ohuo-delivery/checks.mjs';
import { loadContext, inspect, sourceIdentity, sha256 } from '../../../scripts/ohuo-delivery/core.mjs';
assert.deepEqual(process.argv.slice(2), ['--case', 'registry-contract'], 'one explicit selector required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
for (const caseId of ['task-lifecycle', 'task-conflict', 'unsupported-field', 'shared-budget']) {
  const spec = CHECK_REGISTRY[`B06.${caseId}`];
  assert.equal(spec?.status, 'implemented', `B06.${caseId} must be implemented`);
  assert.equal(spec.entryId, 'task_cases'); assert.equal(spec.caseId, caseId);
  assert.deepEqual(spec.requires, ['offline_synthetic']);
  const c = commandFor({ root }, spec);
  assert.deepEqual(c.argv, ['lab/review6_2/checks/check-task.mjs', '--case', caseId]);
  assert.equal(c.shell, false); assert.equal(c.cwd, root);
}
const local = CHECK_REGISTRY['B06.local-ownership'];
assert.equal(local.status, 'implemented'); assert.deepEqual(local.sites, ['local']);
assert.deepEqual(local.requires, ['offline_synthetic']); assert.equal(local.mode, undefined);
assert.deepEqual(commandFor({ root }, local).argv, ['lab/review6_2/checks/check-task.mjs', '--case', 'task-lifecycle']);
assert.equal(CHECK_REGISTRY['B03.two-profile-roundtrip'].status, 'implemented');
assert.equal(CHECK_REGISTRY['B04.complete-response'].status, 'planned');
assert.equal(CHECK_REGISTRY['B07.record-replay'].status, 'planned');
assert.deepEqual(CHECK_REGISTRY['B01.c1400_parity'].requires, ['private_asset_read', 'real_model_forward']);
const ctx = loadContext(root, path.join(root, 'deliverables/ohuo-batches/B06/engineering-batch.json'));
assert.equal(inspect(ctx).status, 'passed'); sourceIdentity(ctx);
const parent = ctx.m.acceptedParentRef.receiptRef;
assert.equal(parent.path, 'deliverables/ohuo-batches/B03/accepted-code.json');
assert.equal(sha256(fs.readFileSync(path.join(root, parent.path))), parent.sha256);
const row = ctx.m.changedFiles.find(f => f.path === 'scripts/ohuo-delivery/checks.mjs');
assert.equal(row.beforeSHA256, '4245a5faf9c8245c0e9e2cbd78f1e08b2e5d7dbd1ca8ec54bc1d18d1a46d4a85');
assert.notEqual(row.beforeSHA256, row.afterSHA256);
const wrong = structuredClone(ctx.m); wrong.changedFiles.find(f => f.path === row.path).beforeSHA256 = '0'.repeat(64);
assert.throws(() => inspect({ ...ctx, m: wrong }), /before identity/);
const original = JSON.parse(fs.readFileSync(path.join(root, 'deliverables/ohuo-batches/B06/evidence/original-r3-batch.json')));
const exactOwners = [...original.ownerFiles, 'scripts/ohuo-delivery/checks.mjs', 'lab/review6_2/checks/check-task-integration.mjs'].sort();
assert.deepEqual([...ctx.m.ownerFiles].sort(), exactOwners, 'parent-source digest reads do not grant product write ownership');
assert.deepEqual(ctx.m.changedFiles.map(f => f.path).sort(), exactOwners);
assert.deepEqual(ctx.m.cleanupCandidates, [], 'no package/model/index cleanup is authorized');
for (const protectedPath of ['packages/web/public/ai', 'packages/web/dist', '.env', '.env.llm-profiles.json', '.zcode', 'lab/review6_2/runs', 'lab/review6_2/data', 'lab/review6_2/stop-after-p13.json']) assert.ok(ctx.m.protectedPaths.includes(protectedPath), protectedPath);
for (const file of original.changedFiles) assert.equal(sha256(fs.readFileSync(path.join(root, file.path))), file.afterSHA256, `reviewed B06 r3 byte changed: ${file.path}`);
const output = path.join(root, 'lab/out/B06'); fs.mkdirSync(output, { recursive: true });
const fixture = fs.mkdtempSync(path.join(output, 'local-guard-'));
try {
  const m = structuredClone(ctx.m);
  m.batchId = 'B06-local-guard'; m.revision = m.checkPlan.revision = 1; m.checkPlan.planRef = 'B06-local-guard/plan';
  m.checkPlan.checks = [m.checkPlan.checks.find(c => c.checkId === 'B06.local-ownership')];
  m.checkPlan.checks[0].site = 'cloud'; m.checkReceiptRefs = [];
  const probe = { ...ctx, m, dir: path.relative(root, fixture).split(path.sep).join('/'), batchPath: path.join(fixture, 'engineering-batch.json') };
  const r = await runChecks(probe, { site: 'cloud', checkIds: ['B06.local-ownership'] });
  assert.equal(r.status, 'rejected'); assert.deepEqual(r.executed, []);
  assert.match(r.reason, /entry\/case\/site mismatch/);
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
console.log(JSON.stringify({ caseId: 'registry-contract', status: 'passed', actual: ['four fixed B06 synthetic task cases', 'actual B03 parent and registry before/after binding', 'six original B06 r3 files unchanged', 'Mac local-ownership has a real executable and cannot run at cloud site', 'B04/B07 remain planned'], consumerCasesExecutedHere: [], realResearchStarted: false }));
