// B02-only fixed registry/accepted-parent/manual-receipt integration; no real assets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_REGISTRY, commandFor, runChecks } from '../../../scripts/ohuo-delivery/checks.mjs';
import { loadContext, inspect, sourceIdentity, sha256 } from '../../../scripts/ohuo-delivery/core.mjs';
assert.deepEqual(process.argv.slice(2), ['--case', 'registry-contract'], 'one explicit selector required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cases = ['rules-text', 'public-equivalence', 'canonical-roundtrip', 'expand-stability', 'pool-conflict', 'public-accounting'];
for (const caseId of cases) {
  const spec = CHECK_REGISTRY[`B02.${caseId}`];
  assert.equal(spec?.status, 'implemented', `B02.${caseId} must be implemented`);
  assert.equal(spec.entryId, 'observation_cases'); assert.equal(spec.caseId, caseId);
  const c = commandFor({ root }, spec);
  assert.deepEqual(c.argv, ['--import', 'tsx', 'lab/review6_2/checks/check-observation.ts', '--case', caseId]);
  assert.equal(c.shell, false); assert.equal(c.cwd, root);
}
const typecheck = commandFor({ root }, CHECK_REGISTRY['B02.typecheck-ai']);
assert.deepEqual(typecheck.argv, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'packages/ai']);
assert.equal(typecheck.shell, false);
assert.equal(CHECK_REGISTRY['B03.two-profile-roundtrip'].status, 'planned');
assert.equal(CHECK_REGISTRY['B06.task-lifecycle'].status, 'planned');
const manual = CHECK_REGISTRY['B02.import-local'];
assert.equal(manual.mode, 'manual'); assert.deepEqual(manual.sites, ['local']);
assert.deepEqual(manual.observations, ['nodeImportSucceeded', 'browserGraphNoNodeOrLab', 'consumerSourceIdentityMatches'].map(key => ({ key, expected: true })));
assert.deepEqual(CHECK_REGISTRY['B01.c1400_parity'].requires, ['private_asset_read', 'real_model_forward']);
const ctx = loadContext(root, path.join(root, 'deliverables/ohuo-batches/B02/engineering-batch.json'));
assert.equal(inspect(ctx).status, 'passed'); sourceIdentity(ctx);
const parent = ctx.m.acceptedParentRef.receiptRef;
assert.equal(parent.sha256, 'acaa88f42548c3faff9416a529b57b12904435117f7aa81f1838c803e2bd598c');
assert.equal(sha256(fs.readFileSync(path.join(root, parent.path))), parent.sha256);
const row = ctx.m.changedFiles.find(f => f.path === 'scripts/ohuo-delivery/checks.mjs');
assert.equal(row.beforeSHA256, 'd9e8d55388cc47fcae1afef0bbbf5a8bf1c942ad0a36aaaf19f877c2bc297bca');
assert.notEqual(row.beforeSHA256, row.afterSHA256);
const wrong = structuredClone(ctx.m); wrong.changedFiles.find(f => f.path === row.path).beforeSHA256 = '0'.repeat(64);
assert.throws(() => inspect({ ...ctx, m: wrong }), /before identity/);
const output = path.join(root, 'lab/out/B02'); fs.mkdirSync(output, { recursive: true });
const fixture = fs.mkdtempSync(path.join(output, 'manual-proof-'));
try {
  const m = structuredClone(ctx.m);
  m.batchId = 'B02-manual-proof'; m.revision = m.checkPlan.revision = 1; m.checkPlan.planRef = 'B02-manual-proof/plan';
  m.checkPlan.checks = [m.checkPlan.checks.find(c => c.checkId === 'B02.import-local')];
  m.checkReceiptRefs = []; m.manualEvidenceRefs = {};
  const r = await runChecks({ ...ctx, m, dir: path.relative(root, fixture).split(path.sep).join('/'), batchPath: path.join(fixture, 'engineering-batch.json') }, { site: 'local', checkIds: ['B02.import-local'] });
  assert.equal(r.status, 'pending'); assert.deepEqual(r.executed, []); assert.deepEqual(r.manual, []);
  assert.match(r.reason, /manual evidence pending/, 'cloud code cannot stand in for actual Mac import evidence');
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
console.log(JSON.stringify({ caseId: 'registry-contract', status: 'passed', actual: ['six fixed B02 cases', 'only affected ai typecheck', 'actual immutable B01 parent with registry before/after binding', 'wrong before SHA rejected', 'actual local manual import evidence required', 'other batches remain planned'], realAssetsRead: false }));
