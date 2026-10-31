// B01-only registry/parent integration check. No asset read, model, server or broad tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_REGISTRY, commandFor, runChecks } from '../../../scripts/ohuo-delivery/checks.mjs';
import { loadContext, inspect, sourceIdentity, sha256 } from '../../../scripts/ohuo-delivery/core.mjs';
const args = process.argv.slice(2);
assert.deepEqual(args, ['--case', 'registry-contract'], 'one explicit integration selector is required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ids = ['B01.synthetic_load', 'B01.registry_isolation', 'B01.direct_consumers', 'B01.typecheck_ai', 'B01.typecheck_web', 'B01.c1400_parity'];
for (const id of ids) assert.equal(CHECK_REGISTRY[id]?.status, 'implemented', `${id} must map to actual bounded entry`);
for (const name of ['ai', 'web']) {
  const spec = CHECK_REGISTRY[`B01.typecheck_${name}`];
  const command = commandFor({ root }, spec);
  assert.deepEqual(command.argv, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', `packages/${name}`]);
  assert.equal(command.shell, false);
  assert.equal(command.cwd, root);
  assert.equal(command.toolRuntime.name, 'typescript');
  assert.match(command.toolRuntime.entrySHA256, /^[a-f0-9]{64}$/);
}
assert.throws(() => commandFor({ root }, { runtime: 'tsc-package', caseId: 'all', packagePath: '.' }), /unsupported.*package/);
assert.throws(() => commandFor({ root }, { runtime: 'tsc-package', caseId: 'ai', packagePath: '../outside' }), /package/);
assert.equal(CHECK_REGISTRY['B03.two-profile-roundtrip'].status, 'planned', 'B03 is not integrated by this batch');
const c = CHECK_REGISTRY['B01.c1400_parity'];
assert.deepEqual(c.sites, ['local']);
assert.deepEqual(c.requires, ['private_asset_read', 'real_model_forward']);
const ctx = loadContext(root, path.join(root, 'deliverables/ohuo-batches/B01/engineering-batch.json'));
assert.equal(inspect(ctx).status, 'passed');
sourceIdentity(ctx);
const parent = ctx.m.acceptedParentRef.receiptRef;
assert.equal(parent.sha256, '012d4672a2de2fbea819a53c921cde30e9ff7592fd601cb96d052539d5114c97');
assert.equal(sha256(fs.readFileSync(path.join(root, parent.path))), parent.sha256);
const row = ctx.m.changedFiles.find(f => f.path === 'scripts/ohuo-delivery/checks.mjs');
assert.equal(row.beforeSHA256, '075b1596f99ef159af397c0ddfc44785ea935af5145e6d0689ba751752bbb8da');
assert.notEqual(row.beforeSHA256, row.afterSHA256);
const tampered = structuredClone(ctx.m); tampered.changedFiles.find(f => f.path === row.path).beforeSHA256 = '0'.repeat(64);
assert.throws(() => inspect({ ...ctx, m: tampered }), /before identity/);
// A wrong-site request must fail before touching even a declared input.
const output = path.join(root, 'lab/out/B01'); fs.mkdirSync(output, { recursive: true });
const probeDir = fs.mkdtempSync(path.join(output, 'registry-site-probe-'));
try {
  assert.throws(() => commandFor({ root: probeDir }, CHECK_REGISTRY['B01.typecheck_ai']), e => e.status === 'pending', 'missing installed typechecker must be pending, not guessed/installed');
  const probe = structuredClone(ctx.m);
  probe.batchId = 'B01-site-probe'; probe.revision = probe.checkPlan.revision = 1;
  probe.checkPlan.planRef = 'B01-site-probe/plan'; probe.checkReceiptRefs = [];
  probe.checkPlan.checks = [{ ...probe.checkPlan.checks.find(c => c.checkId === 'B01.synthetic_load'), site: 'local', inputRefs: [{ path: 'lab/out/B01/never-read-on-wrong-site.json', sha256: '0'.repeat(64) }] }];
  const receipt = await runChecks({ ...ctx, m: probe, dir: path.relative(root, probeDir).split(path.sep).join('/'), batchPath: path.join(probeDir, 'engineering-batch.json') }, { site: 'cloud', checkIds: ['B01.synthetic_load'] });
  assert.equal(receipt.status, 'rejected'); assert.deepEqual(receipt.executed, []);
  assert.match(receipt.reason, /check site mismatch/, 'site rejection must precede attempted input read');
  const protectedInput = { path: 'lab/out/B01/protected-probe/does-not-exist.f32', sha256: '0'.repeat(64), readOnly: true };
  const localAsset = { ...ctx.m.checkPlan.checks.find(c => c.checkId === 'B01.c1400_parity'), inputRefs: [protectedInput] };
  async function negativeGroup(revision, checks, capabilities) {
    const m = structuredClone(ctx.m); m.batchId = 'B01-site-probe'; m.revision = m.checkPlan.revision = revision;
    m.checkPlan.planRef = 'B01-site-probe/plan'; m.checkPlan.checks = checks; m.checkReceiptRefs = [];
    m.protectedPaths.push('lab/out/B01/protected-probe'); m.authorizedScope.realAssetChecks.capabilities = capabilities;
    return runChecks({ ...ctx, m, dir: path.relative(root, probeDir).split(path.sep).join('/'), batchPath: path.join(probeDir, 'engineering-batch.json') }, { site: 'local', checkIds: checks.map(c => c.checkId) });
  }
  const missingForward = await negativeGroup(2, [localAsset], ['private_asset_read']);
  assert.equal(missingForward.status, 'pending'); assert.deepEqual(missingForward.executed, []);
  assert.match(missingForward.reason, /authorization pending: real_model_forward/, 'all permissions must precede protected input read');
  const laterWrongSite = await negativeGroup(3, [localAsset, ctx.m.checkPlan.checks.find(c => c.checkId === 'B01.synthetic_load')], ['private_asset_read', 'real_model_forward']);
  assert.equal(laterWrongSite.status, 'rejected'); assert.deepEqual(laterWrongSite.executed, []);
  assert.match(laterWrongSite.reason, /check site mismatch: B01.synthetic_load/, 'whole-group metadata must precede any protected input read');

} finally { fs.rmSync(probeDir, { recursive: true, force: true }); }
console.log(JSON.stringify({ caseId: 'registry-contract', status: 'passed', actual: ['fixed B01 selectors', 'only ai/web typecheck targets', 'verified installed TypeScript runtime (symlinks allowed)', 'immutable accepted B00 parent with registry addon before/after SHA', 'wrong parent bytes rejected', 'B03 remains planned', 'real C requires local explicit permissions; not read', 'wrong-site request rejects before input read', 'all requirements and every group site checked before protected input read'], realAssetsRead: false }));
