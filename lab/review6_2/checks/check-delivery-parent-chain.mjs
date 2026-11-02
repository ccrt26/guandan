import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parentFiles, intentHash, sha256 } from '../../../scripts/ohuo-delivery/core.mjs';

const cases = ['delivery.parent-chain.ancestor', 'delivery.parent-chain.nearest', 'delivery.parent-chain.bad-hash'];
const argv = process.argv.slice(2);
assert.equal(argv.length, 2);
assert.equal(argv[0], '--case');
assert.ok(cases.includes(argv[1]), 'only the three fixed parent-chain cases are allowed');
const baseCommit = '1'.repeat(40);
const target = 'packages/ai/src/policy/descriptor.ts';
const oldSHA = sha256('older accepted source'), nearSHA = sha256('near accepted source');
const out = path.resolve('lab/out/M9-PARENT-CHAIN-fixtures');
fs.mkdirSync(out, { recursive: true });
const root = fs.mkdtempSync(path.join(out, 'case-'));
function write(rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  return { path: rel, sha256: sha256(fs.readFileSync(file)) };
}
function accepted(batchId, files, parent) {
  const sourceRef = { baseCommit, files };
  const batch = { schemaVersion: 1, batchId, revision: 1, baseCommit,
    acceptedParentRef: parent, changedFiles: [], checkPlan: { sourceRef }, status: 'accepted' };
  const manifestPath = `deliverables/ohuo-batches/${batchId}/engineering-batch.json`;
  write(manifestPath, batch);
  const receiptRef = write(`deliverables/ohuo-batches/${batchId}/accepted-code.json`, {
    schemaVersion: 1, kind: 'functional-acceptance', batchId, revision: 1,
    functionalStatus: 'accepted', acceptedCodeRef: sourceRef, acceptedIntentHash: intentHash(batch),
  });
  return { receiptRef, sourceRef };
}
try {
  const ancestor = accepted('ancestor', [{ path: target, sha256: oldSHA }], { commit: baseCommit });
  const near = accepted('near', argv[1] === cases[1] ? [{ path: target, sha256: nearSHA }] : [], ancestor);
  const ctx = { root, m: { baseCommit, acceptedParentRef: near,
    changedFiles: [{ path: target, beforeSHA256: oldSHA, afterSHA256: sha256('next source') },
      { path: 'new-check.mjs', beforeSHA256: null, afterSHA256: sha256('new') }],
    allowedPaths: ['deliverables/ohuo-batches'], protectedPaths: [] } };
  // The ancestor manifest is unnecessary once the needed identity has been found.
  fs.unlinkSync(path.join(root, 'deliverables/ohuo-batches/ancestor/engineering-batch.json'));
  if (argv[1] === cases[0]) {
    assert.deepEqual(parentFiles(ctx).find(r => r.path === target), { path: target, sha256: oldSHA });
  } else if (argv[1] === cases[1]) {
    // A near mismatch must remain a mismatch; never search older history for a matching before SHA.
    fs.unlinkSync(path.join(root, 'deliverables/ohuo-batches/near/engineering-batch.json'));
    assert.deepEqual(parentFiles(ctx).find(r => r.path === target), { path: target, sha256: nearSHA });
  } else {
    const manifestPath = path.join(root, 'deliverables/ohuo-batches/near/engineering-batch.json');
    const original = fs.readFileSync(manifestPath);
    const changed = JSON.parse(original);
    changed.acceptedParentRef.receiptRef.sha256 = '0'.repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(changed));
    assert.throws(() => parentFiles(ctx), /accepted parent batch intent mismatch/);
    fs.writeFileSync(manifestPath, original);
    fs.appendFileSync(path.join(root, ancestor.receiptRef.path), '\n');
    assert.throws(() => parentFiles(ctx), /reference identity mismatch/);
  }
  console.log(JSON.stringify({ status: 'passed', caseId: argv[1], syntheticOnly: true,
    gitAncestryClaimed: false, actualAcceptanceClaimed: false, runtime: process.version }));
} finally {
  // Only this uniquely-created synthetic fixture directory is removed.
  fs.rmSync(root, { recursive: true, force: true });
}
