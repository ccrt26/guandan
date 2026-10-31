// B03 fixed registry/accepted-parent/manual integration only. No profile case, server or UI is launched here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_REGISTRY, commandFor, runChecks } from '../../../scripts/ohuo-delivery/checks.mjs';
import { loadContext, inspect, sourceIdentity, sha256 } from '../../../scripts/ohuo-delivery/core.mjs';
assert.deepEqual(process.argv.slice(2), ['--case', 'registry-contract'], 'one explicit selector required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cases = ['two-profile-roundtrip', 'secret-redaction', 'unsupported-option', 'legacy-explicit-import', 'local-only-route'];
for (const caseId of cases) {
  const spec = CHECK_REGISTRY[`B03.${caseId}`];
  assert.equal(spec?.status, 'implemented', `B03.${caseId} must be implemented`);
  assert.equal(spec.entryId, 'profiles_cases'); assert.equal(spec.caseId, caseId);
  assert.deepEqual(spec.requires, ['offline_synthetic']);
  const c = commandFor({ root }, spec);
  assert.deepEqual(c.argv, ['--import', 'tsx', 'lab/review6_2/checks/check-profiles.mjs', '--case', caseId]);
  assert.equal(c.shell, false); assert.equal(c.cwd, root);
}
const env = commandFor({ root }, CHECK_REGISTRY['B03.dotenv-isolation']);
assert.deepEqual(env.argv, ['--import', 'tsx', 'lab/review6_2/checks/check-profiles-manual-env.mjs', '--case', 'dotenv-isolation']);
const typecheck = commandFor({ root }, CHECK_REGISTRY['B03.web-typecheck']);
assert.deepEqual(typecheck.argv, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'packages/web']);
assert.equal(typecheck.shell, false);
const manual = CHECK_REGISTRY['B03.ui-save-reload'];
assert.equal(manual.mode, 'manual'); assert.deepEqual(manual.sites, ['local']);
assert.deepEqual(manual.requires, ['local_ui', 'local_service']);
assert.deepEqual(manual.observations, ['twoProfilesSurviveReload', 'editingOnePreservesOther', 'noSecretInPublicView', 'nodeAndServiceRevisionMatch', 'legacyCoachConfigUnchanged', 'noRealApiRequest'].map(key => ({ key, expected: true })));
assert.deepEqual(commandFor({ root }, manual).argv, []);
assert.equal(CHECK_REGISTRY['B04.complete-response'].status, 'planned');
assert.equal(CHECK_REGISTRY['B06.task-lifecycle'].status, 'planned');
assert.deepEqual(CHECK_REGISTRY['B01.c1400_parity'].requires, ['private_asset_read', 'real_model_forward']);
const ctx = loadContext(root, path.join(root, 'deliverables/ohuo-batches/B03/engineering-batch.json'));
assert.equal(inspect(ctx).status, 'passed'); sourceIdentity(ctx);
const parent = ctx.m.acceptedParentRef.receiptRef;
assert.equal(parent.sha256, 'e83850207e3af62380a57d0823acfd9ecb13efd30a9896017ac0d8b43de84abe');
assert.equal(sha256(fs.readFileSync(path.join(root, parent.path))), parent.sha256);
const row = ctx.m.changedFiles.find(f => f.path === 'scripts/ohuo-delivery/checks.mjs');
assert.equal(row.beforeSHA256, '06feb2080383786f8dadd108d8b16cea9be142d1231507c0dde839d045de152e');
assert.notEqual(row.beforeSHA256, row.afterSHA256);
const wrong = structuredClone(ctx.m); wrong.changedFiles.find(f => f.path === row.path).beforeSHA256 = '0'.repeat(64);
assert.throws(() => inspect({ ...ctx, m: wrong }), /before identity/);
const original = JSON.parse(fs.readFileSync(path.join(root, 'deliverables/ohuo-batches/B03/evidence/original-r4-batch.json')));
for (const file of original.changedFiles) assert.equal(sha256(fs.readFileSync(path.join(root, file.path))), file.afterSHA256, `reviewed r4 byte changed: ${file.path}`);
const output = path.join(root, 'lab/out/B03'); fs.mkdirSync(output, { recursive: true });
const fixture = fs.mkdtempSync(path.join(output, 'manual-proof-'));
try {
  const m = structuredClone(ctx.m);
  m.batchId = 'B03-manual-proof'; m.revision = m.checkPlan.revision = 1; m.checkPlan.planRef = 'B03-manual-proof/plan';
  m.checkPlan.checks = [m.checkPlan.checks.find(c => c.checkId === 'B03.ui-save-reload')];
  m.checkReceiptRefs = []; m.manualEvidenceRefs = {};
  // Synthetic permission-shape fixture only: no UI/service execution is possible for this manual entry.
  m.authorizedScope.realAssetChecks = { basisRef: m.authorizationRef, capabilities: ['local_ui', 'local_service'] };
  m.checkPlan.checks[0].authorizationRefs = [m.authorizationRef];
  const probe = { ...ctx, m, dir: path.relative(root, fixture).split(path.sep).join('/'), batchPath: path.join(fixture, 'engineering-batch.json') };
  const r = await runChecks(probe, { site: 'local', checkIds: ['B03.ui-save-reload'] });
  assert.equal(r.status, 'pending'); assert.deepEqual(r.executed, []); assert.deepEqual(r.manual, []);
  assert.match(r.reason, /manual evidence pending/);
  m.checkPlan.checks[0].site = 'cloud'; m.revision = m.checkPlan.revision = 2;
  const cloud = await runChecks(probe, { site: 'cloud', checkIds: ['B03.ui-save-reload'] });
  assert.equal(cloud.status, 'rejected'); assert.deepEqual(cloud.executed, []);
  assert.match(cloud.reason, /entry\/case\/site mismatch/);
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
console.log(JSON.stringify({ caseId: 'registry-contract', status: 'passed', actual: ['five fixed profile cases plus dotenv boundary', 'web-only typecheck', 'actual immutable B02 parent and before/after binding', 'original r4 13 files unchanged', 'manual six observations mandatory and local-only', 'other batches remain planned'], productCasesExecutedHere: [], serverOrUiStarted: false }));
