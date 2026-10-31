// B05 registry/accepted-parent binding only; no controller scenarios are invoked here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_REGISTRY, commandFor, runChecks } from '../../../scripts/ohuo-delivery/checks.mjs';
import { loadContext, inspect, sourceIdentity, sha256 } from '../../../scripts/ohuo-delivery/core.mjs';
assert.deepEqual(process.argv.slice(2), ['--case', 'registry-contract']);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rows = [['pending_once','pending-once'],['failure_once','failure-once'],['cancel_late','cancel-late'],['execution_uncertain','execution-uncertain'],['seat_config','seat-config'],['proxy_boundary','proxy-boundary'],['restore_refs','restore-refs']];
for (const [id, caseId] of rows) {
  const spec = CHECK_REGISTRY[`B05.${id}`];
  assert.equal(spec.status, 'implemented'); assert.equal(spec.entryId, 'controller_cases'); assert.equal(spec.caseId, caseId);
  assert.deepEqual(spec.requires, ['offline_synthetic']);
  assert.deepEqual(spec.sites, id === 'restore_refs' ? ['local'] : ['cloud', 'local']);
  const cmd = commandFor({ root }, spec);
  assert.deepEqual(cmd.argv, ['lab/review6_2/checks/check-controller.mjs', '--case', caseId]); assert.equal(cmd.shell, false);
}
for (const name of ['ai','web']) {
  const s = CHECK_REGISTRY[`B05.typecheck_${name}`];
  assert.equal(s.runtime, 'tsc-package'); assert.equal(s.packagePath, `packages/${name}`);
  assert.deepEqual(s.requires, ['offline_synthetic']);
}
const local = CHECK_REGISTRY['B05.restore_ui'];
assert.equal(local.mode, 'manual'); assert.deepEqual(local.sites, ['local']);
assert.deepEqual(local.requires, ['local_ui', 'local_service', 'private_asset_read']);
assert.equal(CHECK_REGISTRY['B04.complete-response'].status, 'implemented');
assert.equal(CHECK_REGISTRY['B06.task-lifecycle'].status, 'implemented');
assert.equal(CHECK_REGISTRY['B07.record-replay'].status, 'planned');
const ctx = loadContext(root, 'deliverables/ohuo-batches/B05/engineering-batch.json');
assert.equal(inspect(ctx).status, 'passed'); sourceIdentity(ctx);
const parent = ctx.m.acceptedParentRef.receiptRef;
assert.equal(parent.path, 'deliverables/ohuo-batches/B04/accepted-code.json');
assert.equal(sha256(fs.readFileSync(path.join(root, parent.path))), parent.sha256);
const original = JSON.parse(fs.readFileSync(path.join(root, 'deliverables/ohuo-batches/B05/evidence/original-product-batch.json')));
const adapter = JSON.parse(fs.readFileSync(path.join(root, 'deliverables/ohuo-batches/B05/evidence/controller-dotenv-adapter-identity.json')));
for (const f of original.changedFiles) {
  const expected = f.path === 'lab/review6_2/checks/check-controller.mjs' ? adapter.newEntrySHA256 : f.afterSHA256;
  if (f.path === 'lab/review6_2/checks/check-controller.mjs') assert.equal(f.afterSHA256, adapter.oldEntrySHA256);
  assert.equal(sha256(fs.readFileSync(path.join(root, f.path))), expected, `Original product/approved adapter identity changed: ${f.path}`);
}
const { controllerViteOverrides, controllerChildEnv } = await import('./check-controller.mjs');
assert.deepEqual(controllerViteOverrides, { envFile: false, envPrefix: [] });
assert.deepEqual(Object.keys(controllerChildEnv()).sort(), ['LANG','PATH','TZ']);
const registration = JSON.parse(fs.readFileSync(path.join(root, 'deliverables/ohuo-batches/B05/evidence/helper-registration.json')));
assert.deepEqual(local.observations.map(o => o.key), registration.observations);
for (const p of registration.sourcePaths) assert.ok(local.sourcePaths.includes(p));
const owners = [...original.ownerFiles, ...registration.ownerFiles, 'scripts/ohuo-delivery/checks.mjs', 'lab/review6_2/checks/check-controller-integration.mjs'].sort();
assert.deepEqual([...ctx.m.ownerFiles].sort(), owners); assert.deepEqual(ctx.m.changedFiles.map(f => f.path).sort(), owners);
assert.deepEqual(ctx.m.cleanupCandidates, []);
for (const p of ['packages/web/public/ai', 'packages/web/dist', '.env', '.env.llm-profiles.json', '.zcode', 'lab/review6_2/runs', 'lab/review6_2/data', 'lab/review6_2/stop-after-p13.json']) assert.ok(ctx.m.protectedPaths.includes(p));
const row = ctx.m.changedFiles.find(f => f.path === 'scripts/ohuo-delivery/checks.mjs');
assert.equal(row.beforeSHA256, 'fc6d94a4122922577b32e25d31f161dac5ad82c6ad8b16faedd234747a6b708c');
const wrong = structuredClone(ctx.m); wrong.changedFiles.find(f => f.path === row.path).beforeSHA256 = '0'.repeat(64);
assert.throws(() => inspect({ ...ctx, m: wrong }), /before identity/);
const output = path.join(root, 'lab/out/B05'); fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(output, 'registry-local-only-'));
try {
  const m = structuredClone(ctx.m); m.batchId = 'B05-local-guard'; m.revision = m.checkPlan.revision = 1; m.checkPlan.planRef = 'B05-local-guard/plan'; m.checkReceiptRefs = [];
  m.checkPlan.checks = [m.checkPlan.checks.find(c => c.checkId === 'B05.restore_ui')]; m.checkPlan.checks[0].site = 'cloud';
  const result = await runChecks({ ...ctx, m, dir: path.relative(root, temporary).split(path.sep).join('/'), batchPath: path.join(temporary, 'engineering-batch.json') }, { site: 'cloud', checkIds: ['B05.restore_ui'] });
  assert.equal(result.status, 'rejected'); assert.deepEqual(result.executed, []); assert.match(result.reason, /entry\/case\/site mismatch/);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log(JSON.stringify({ caseId: 'registry-contract', status: 'passed', original29ProductBytesUnchanged: original.changedFiles.length - 1, approvedTestAdapterBound: true, controllerCasesExecutedHere: [], realApiRequests: 0, note: 'Nine bounded cloud mappings; actual local restore-refs/UI remain separate, local UI cannot execute at cloud site.' }));
