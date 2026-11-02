import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export class DeliveryError extends Error {
  constructor(message, status = 'rejected') { super(message); this.status = status; }
}
export const fail = (message, status = 'rejected') => { throw new DeliveryError(message, status); };
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const same = (a, b) => canonical(a) === canonical(b);
export const now = () => new Date().toISOString();
export const validSHA = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export const inside = (child, parent) => child === parent || child.startsWith(`${parent}/`);
export function relativePath(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || path.posix.isAbsolute(p) || p.split('/').some(s => !s || s === '.' || s === '..')) fail(`invalid relative path: ${String(p)}`);
  return p;
}
export function safePath(root, p, { missing = false } = {}) {
  relativePath(p);
  const base = fs.realpathSync(root);
  let current = base;
  for (const part of p.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail(`symlink path refused: ${p}`); }
    catch (e) { if (e.code === 'ENOENT' && missing) continue; throw e; }
  }
  if (!inside(current, base)) fail(`outside project: ${p}`);
  return current;
}
export function inScope(m, p, { readOnlyProtected = false } = {}) {
  relativePath(p);
  if (!m.allowedPaths.some(a => inside(p, a))) fail(`path is not in allowedPaths: ${p}`);
  if (!readOnlyProtected && m.protectedPaths.some(a => inside(p, a) || inside(a, p))) fail(`protected path: ${p}`);
  if (p.split('/').some(s => ['.git', 'node_modules', '.venv', '.env', '.zcode'].includes(s))) fail(`protected engineering/private path: ${p}`);
}
export function reference(ctx, ref, { scoped = true, readOnlyProtected = false } = {}) {
  if (!ref || typeof ref !== 'object' || !validSHA(ref.sha256)) fail('reference requires path and sha256');
  if (scoped) inScope(ctx.m, ref.path, { readOnlyProtected });
  const full = safePath(ctx.root, ref.path);
  if (!fs.statSync(full).isFile()) fail(`reference must name one regular file: ${ref.path}`);
  const bytes = fs.readFileSync(full);
  if (sha256(bytes) !== ref.sha256) fail(`reference identity mismatch: ${ref.path}`);
  return bytes;
}
export function jsonReference(ctx, ref, options) {
  try { return JSON.parse(reference(ctx, ref, options)); }
  catch (e) { if (e instanceof DeliveryError) throw e; fail(`invalid JSON reference: ${ref?.path}: ${e.message}`); }
}
export function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function saveManifest(ctx) { atomicJSON(ctx.batchPath, ctx.m); }
export function saveArtifact(ctx, name, value) {
  const rel = `${ctx.dir}/${name}`;
  const full = safePath(ctx.root, rel, { missing: true });
  if (fs.existsSync(full)) fail(`artifact already exists: ${rel}`);
  atomicJSON(full, value);
  return { path: rel, sha256: sha256(fs.readFileSync(full)) };
}
const RESULT_KEYS = new Set(['status', 'cloudEvidence', 'localEvidence', 'manualEvidenceRefs', 'checkReceiptRefs', 'acceptedCodeRef', 'compatibilityDeltaRef', 'unresolved', 'recoveryRef', 'closeoutTaskRef', 'closeoutReceiptRef', 'closeoutEvidence']);
export const intentHash = m => sha256(canonical(Object.fromEntries(Object.entries(m).filter(([key]) => !RESULT_KEYS.has(key)))));
const requiredFields = ['batchId', 'revision', 'status', 'baseCommit', 'acceptedParentRef', 'dependsOn', 'authorizationRef', 'authorizedScope', 'authorTaskRef', 'ownerFiles', 'allowedPaths', 'protectedPaths', 'changeSummary', 'artifactRef', 'patchSHA256', 'changedFiles', 'checkPlan', 'cloudEvidence', 'localEvidence', 'manualEvidenceRefs', 'checkReceiptRefs', 'acceptedCodeRef', 'compatibilityDeltaRef', 'unresolved', 'recoveryRef', 'cleanupCandidates', 'closeoutTaskRef', 'closeoutReceiptRef'];
const OPTIONAL_FIELDS = ['schemaVersion', 'cleanupChannel', 'closeoutEvidence', 'executionRoute', 'blockerKind', 'blockerEvidenceRefs', 'remainingLocalActions', 'returnCondition'];
export function loadContext(root, batchPath) {
  root = fs.realpathSync(root); batchPath = path.resolve(batchPath);
  const rel = path.relative(root, batchPath).split(path.sep).join('/');
  if (!/^deliverables\/ohuo-batches\/[A-Za-z0-9][A-Za-z0-9._-]*\/engineering-batch\.json$/.test(rel)) fail('batch must be registered at deliverables/ohuo-batches/<batchId>/engineering-batch.json');
  safePath(root, rel);
  const m = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
  for (const key of requiredFields) if (!(key in m)) fail(`missing batch field: ${key}`);
  for (const key of Object.keys(m)) if (![...requiredFields, ...OPTIONAL_FIELDS].includes(key)) fail(`unknown batch field: ${key}`);
  if (m.schemaVersion !== 1 || m.batchId !== rel.split('/')[2] || !Number.isInteger(m.revision) || m.revision < 1) fail('invalid batch identity/version');
  for (const key of ['dependsOn', 'ownerFiles', 'allowedPaths', 'protectedPaths', 'changedFiles', 'checkReceiptRefs', 'cleanupCandidates']) if (!Array.isArray(m[key])) fail(`invalid array: ${key}`);
  for (const p of [...m.ownerFiles, ...m.allowedPaths, ...m.protectedPaths]) relativePath(p);
  if (!m.allowedPaths.length) fail('allowedPaths must be explicit and nonempty');
  if (!m.checkPlan || m.checkPlan.revision !== m.revision || typeof m.checkPlan.planRef !== 'string' || !m.checkPlan.planRef || !Array.isArray(m.checkPlan.checks) || !m.checkPlan.checks.length || !Array.isArray(m.checkPlan.notRun)) fail('invalid checkPlan identity/checks/notRun');
  if (!['draft', 'ready_for_local', 'accepted', 'blocked'].includes(m.status)) fail('invalid batch status');
  const ctx = { root, batchPath, rel, dir: path.posix.dirname(rel), m };
  ctx.statePath = safePath(root, `${ctx.dir}/delivery-state.json`, { missing: true });
  ctx.state = fs.existsSync(ctx.statePath) ? JSON.parse(fs.readFileSync(ctx.statePath)) : null;
  if (ctx.state?.acceptedIntentHash && ctx.state.acceptedIntentHash !== intentHash(m)) fail('accepted batch content conflict; use a new batchId');
  return ctx;
}
export function withLock(ctx, fn) {
  const lock = safePath(ctx.root, `${ctx.dir}/.delivery.lock`, { missing: true });
  try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: now() }), { flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') fail('batch has an active or interrupted writer; inspect lock owner before manual recovery', 'pending'); throw e; }
  const clean = () => fs.unlinkSync(lock);
  try {
    const result = fn();
    if (result?.then) return result.finally(clean);
    clean(); return result;
  } catch (e) { clean(); throw e; }
}
export function currentCommit(ctx) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { fail('cannot resolve local Git HEAD'); }
}
export function sourceIdentity(ctx, source = ctx.m.checkPlan.sourceRef) {
  if (!source || source.baseCommit !== ctx.m.baseCommit || !Array.isArray(source.files) || !source.files.length) fail('sourceRef must bind baseCommit and affected file digests');
  // HEAD may be the accepted content commit; the fixed parent must exist in its ancestry.
  try { execFileSync('git', ['merge-base', '--is-ancestor', ctx.m.baseCommit, 'HEAD'], { cwd: ctx.root, stdio: 'ignore' }); }
  catch { fail('fixed baseCommit is not an ancestor of current HEAD'); }
  const seen = new Set();
  for (const ref of source.files) {
    if (seen.has(ref.path)) fail(`duplicate source file: ${ref.path}`); seen.add(ref.path);
    reference(ctx, ref);
  }
  for (const f of ctx.m.changedFiles) {
    inScope(ctx.m, f.path);
    if (!ctx.m.ownerFiles.includes(f.path)) fail(`changed file has no owner: ${f.path}`);
    if (f.afterSHA256 !== null && !source.files.some(r => r.path === f.path && r.sha256 === f.afterSHA256)) fail(`changed file absent from source identity: ${f.path}`);
    if (f.afterSHA256 === null && fs.existsSync(safePath(ctx.root, f.path, { missing: true }))) fail(`deleted file still exists: ${f.path}`);
  }
  return source;
}
export function authorize(ctx, capability, refs = [], scopeOverride = null) {
  const scopeName = capability === 'offline_synthetic' ? 'syntheticChecks' : 'realAssetChecks';
  const scope = scopeOverride || ctx.m.authorizedScope?.[scopeName];
  if (!scope || !scope.basisRef || !Array.isArray(scope.capabilities) || !scope.capabilities.includes(capability)) fail(`authorization pending: ${capability}`, 'pending');
  reference(ctx, ctx.m.authorizationRef);
  reference(ctx, scope.basisRef);
  if (!refs.length || !refs.some(r => same(r, scope.basisRef))) fail(`check does not cite verified scope basis: ${capability}`, 'pending');
  refs.forEach(r => reference(ctx, r));
}
export function sealPlan(ctx) {
  const file = safePath(ctx.root, `${ctx.dir}/check-plan-revisions.json`, { missing: true });
  const revisions = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  const digest = sha256(canonical(ctx.m.checkPlan));
  if (revisions[ctx.m.revision] && revisions[ctx.m.revision] !== digest) fail('checkPlan changed within frozen revision; increment an unaccepted revision');
  if (!revisions[ctx.m.revision]) { revisions[ctx.m.revision] = digest; atomicJSON(file, revisions); }
}
export function checkSignature(check) {
  return sha256(canonical(Object.fromEntries(Object.entries(check).filter(([k]) => !['reuseEvidenceRef', 'authorizationRefs', 'directImpactReason'].includes(k)))));
}
export function parentFiles(ctx) {
  // Resolve only existing-file before identities omitted by a narrow parent receipt.
  // New-file (null before) checks retain the original direct-parent/Git absence rule;
  // this is not a reconstruction of a complete historical source snapshot.
  const needed = new Set(ctx.m.changedFiles.filter(f => f.beforeSHA256 !== null).map(f => f.path));
  const files = new Map(), visited = new Set();
  let parent = ctx.m.acceptedParentRef;
  while (parent?.commit !== ctx.m.baseCommit) {
    if (!parent?.receiptRef) fail('acceptedParentRef must identify fixed base commit or accepted parent receipt');
    if (visited.has(parent.receiptRef.path)) fail('accepted parent receipt cycle');
    visited.add(parent.receiptRef.path);
    const evidence = jsonReference(ctx, parent.receiptRef);
    if (evidence.kind !== 'functional-acceptance' || evidence.functionalStatus !== 'accepted' || !Array.isArray(evidence.acceptedCodeRef?.files) || evidence.acceptedCodeRef.baseCommit !== ctx.m.baseCommit) fail('parent receipt is not an accepted source identity');
    if (!same(parent.sourceRef, evidence.acceptedCodeRef)) fail('accepted parent source reference mismatch');
    const seen = new Set();
    for (const ref of evidence.acceptedCodeRef.files) {
      relativePath(ref.path);
      if (!validSHA(ref.sha256) || seen.has(ref.path)) fail('invalid or duplicate accepted parent source identity');
      seen.add(ref.path);
      // Keep the closest accepted identity, even if it disagrees with this batch's before.
      if (!files.has(ref.path) && (visited.size === 1 || needed.has(ref.path))) files.set(ref.path, ref);
      needed.delete(ref.path);
    }
    if (!needed.size) break;
    // A receipt commits to the batch intent, not its mutable result fields. Only
    // authenticate/read a prior manifest when another parent edge is necessary.
    const dir = `deliverables/ohuo-batches/${evidence.batchId}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(evidence.batchId) || path.posix.dirname(parent.receiptRef.path) !== dir) fail('accepted parent receipt batch path mismatch');
    const batchPath = `${dir}/engineering-batch.json`;
    inScope(ctx.m, batchPath);
    const full = safePath(ctx.root, batchPath);
    if (!fs.statSync(full).isFile()) fail('accepted parent batch must be a regular file');
    let batch;
    try { batch = JSON.parse(fs.readFileSync(full, 'utf8')); }
    catch { fail('invalid accepted parent batch JSON'); }
    if (!validSHA(evidence.acceptedIntentHash) || intentHash(batch) !== evidence.acceptedIntentHash) fail('accepted parent batch intent mismatch');
    if (batch.schemaVersion !== 1 || batch.batchId !== evidence.batchId || batch.revision !== evidence.revision || batch.baseCommit !== ctx.m.baseCommit || !same(batch.checkPlan?.sourceRef, evidence.acceptedCodeRef) || !Array.isArray(batch.changedFiles)) fail('accepted parent batch source identity mismatch');
    // A nearer accepted deletion must not resurrect an older source identity.
    for (const f of batch.changedFiles) if (f.afterSHA256 === null && needed.has(f.path)) {
      files.set(f.path, { path: f.path, sha256: null });
      needed.delete(f.path);
    }
    if (!needed.size) break;
    parent = batch.acceptedParentRef;
  }
  return [...files.values()];
}
function verifyBeforeIdentity(ctx, f, parents) {
  if (f.beforeSHA256 !== null && !validSHA(f.beforeSHA256)) fail('beforeSHA256 must be null or digest');
  if (f.afterSHA256 !== null && !validSHA(f.afterSHA256)) fail('afterSHA256 must be null or digest');
  const prior = parents.find(r => r.path === f.path);
  let expected = prior?.sha256 ?? null;
  if (!prior) {
    try { expected = sha256(execFileSync('git', ['show', `${ctx.m.baseCommit}:${f.path}`], { cwd: ctx.root, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch (e) { if (e.status !== 128) fail(`cannot verify parent blob: ${f.path}`); }
  }
  if (f.beforeSHA256 !== expected) fail(`before identity does not match accepted parent: ${f.path}`);
}
export function inspect(ctx) {
  const head = currentCommit(ctx), files = [];
  if (!/^[a-f0-9]{40}$/.test(ctx.m.baseCommit)) fail('baseCommit must be exact Git SHA');
  try { execFileSync('git', ['merge-base', '--is-ancestor', ctx.m.baseCommit, head], { cwd: ctx.root, stdio: 'ignore' }); } catch { fail('baseCommit mismatch'); }
  reference(ctx, ctx.m.authorizationRef);
  const parents = parentFiles(ctx);
  for (const f of ctx.m.changedFiles) {
    inScope(ctx.m, f.path);
    if (!ctx.m.ownerFiles.includes(f.path)) fail(`changed file outside ownerFiles: ${f.path}`);
    verifyBeforeIdentity(ctx, f, parents);
    const p = safePath(ctx.root, f.path, { missing: true });
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    const phase = actual === f.afterSHA256 ? 'after' : actual === f.beforeSHA256 ? 'before' : 'conflict';
    if (phase === 'conflict') fail(`affected file conflict: ${f.path}`);
    files.push({ path: f.path, actual, phase });
  }
  if (ctx.m.artifactRef) {
    reference(ctx, ctx.m.artifactRef);
    if (ctx.m.patchSHA256 !== ctx.m.artifactRef.sha256) fail('patchSHA256 does not match artifact');
  }
  for (const ref of ctx.m.dependsOn) {
    const parent = jsonReference(ctx, ref);
    if (parent.kind !== 'functional-acceptance' || parent.functionalStatus !== 'accepted') fail(`dependency not accepted: ${ref.path}`, 'pending');
  }
  return { status: 'passed', batchId: ctx.m.batchId, currentCommit: head, baseCommit: ctx.m.baseCommit, files, capabilities: 'inspect only; no apply or checks executed' };
}
function acceptance(ctx) {
  inspect(ctx); sourceIdentity(ctx); sealPlan(ctx);
  const scope = ctx.m.authorizedScope?.apply;
  if (!scope?.basisRef) fail('apply authorization pending', 'pending'); reference(ctx, scope.basisRef);
  const checks = ctx.m.checkPlan.checks;
  if (new Set(checks.map(c => c.checkId)).size !== checks.length) fail('duplicate planned check IDs');
  const valid = new Set(), issues = [];
  for (const ref of ctx.m.checkReceiptRefs) {
    const receipt = jsonReference(ctx, ref);
    if (receipt.batchId !== ctx.m.batchId) fail('receipt batch mismatch');
    if (receipt.revision !== ctx.m.revision || receipt.planRef !== ctx.m.checkPlan.planRef || !same(receipt.sourceRef, ctx.m.checkPlan.sourceRef)) continue;
    if (!Array.isArray(receipt.results) || !Array.isArray(receipt.executed) || !Array.isArray(receipt.requestedCheckIds)) fail('malformed check receipt');
    const declared = new Set(checks.map(c => c.checkId));
    if (receipt.executed.some(id => !declared.has(id)) || receipt.results.some(r => !declared.has(r.checkId))) fail('receipt executed outside current plan');
    for (const r of receipt.results) {
      const c = checks.find(c => c.checkId === r.checkId);
      if (r.checkSignature !== checkSignature(c) || !same(r.inputRefs, c.inputRefs) || r.expected !== c.expected) fail(`receipt case binding mismatch: ${r.checkId}`);
      if (r.status === 'passed') {
        if (!['executed', 'reused', 'manual'].includes(r.executionMode) || !r.startedAt || !r.endedAt || !r.actual) fail('incomplete successful check receipt');
        if (r.executionMode === 'executed' && (r.exitCode !== 0 || r.shell !== false || !r.executable || !Array.isArray(r.argv) || !receipt.executed.includes(r.checkId))) fail('invalid executed evidence');
        if (r.executionMode !== 'executed' && (!r.evidenceRef || receipt.executed.includes(r.checkId))) fail('invalid reused/manual evidence');
        if (r.evidenceRef) reference(ctx, r.evidenceRef);
        valid.add(r.checkId);
      } else if (r.status === 'failed') { valid.delete(r.checkId); issues.push(r.checkId); }
    }
  }
  const missing = checks.filter(c => !valid.has(c.checkId)).map(c => c.checkId);
  if (missing.length) fail(`required checks pending/failed: ${missing.join(', ')}`, 'pending');
}
export function dependencyEvidence(ctx, c) {
  const ref = ctx.m.closeoutEvidence?.dependencyEvidenceRefs?.[c.candidateId] || c.dependencyCheckRef;
  if (!ref) fail('dependency evidence absent', 'pending');
  const d = jsonReference(ctx, ref);
  if (d.batchId !== ctx.m.batchId || !same(d.sourceRef, ctx.m.checkPlan.sourceRef) || d.candidatePath !== c.path || d.candidateSHA256 !== c.sha256) fail('dependency evidence identity mismatch');
  if (!Number.isFinite(Date.parse(d.checkedAt)) || Date.parse(d.checkedAt) > Date.now() || !Number.isFinite(Date.parse(d.validUntil)) || Date.parse(d.validUntil) <= Date.now()) fail('dependency evidence expired or invalid', 'pending');
  if (!Array.isArray(d.activeDependencies) || d.activeDependencies.length || !Array.isArray(c.activeDependencies) || c.activeDependencies.length) fail('active dependencies remain', 'pending');
  if (!['current-run', 'model', 'save', 'source', 'recovery'].every(s => d.checkedScopes?.includes(s)) || !d.checkedBy || !d.evidenceRefs?.length) fail('empty dependency list is not verified no-dependency evidence', 'pending');
  d.evidenceRefs.forEach(r => reference(ctx, r));
  return ref;
}
export function verifySystemTrash(channel) {
  if (process.platform !== 'darwin') fail('system Trash verification requires the authorized Mac executor', 'pending');
  const expected = path.join(os.homedir(), '.Trash');
  if (path.resolve(channel.root) !== expected || fs.realpathSync(channel.root) !== expected) fail('only the current Mac user system .Trash is supported', 'pending');
  return expected;
}
function verifyRecovery(ctx, ref) {
  const r = jsonReference(ctx, ref);
  if (r.baseCommit !== ctx.m.baseCommit || !r.restore?.trim() || !Array.isArray(r.artifactRefs) || !r.artifactRefs.length || !r.verificationRef || !Number.isFinite(Date.parse(r.verifiedAt))) fail('recovery lacks fixed artifacts and actual verification evidence', 'pending');
  r.artifactRefs.forEach(a => reference(ctx, a)); reference(ctx, r.verificationRef);
}
export function cleanupPreflight(ctx, c, { sourceRequired = true } = {}) {
  inScope(ctx.m, c.path);
  if (!['temporary-download', 'temporary-unpack', 'rebuildable-check-output', 'superseded-copy'].includes(c.category)) fail('cleanup category is not supported');
  if (!validSHA(c.sha256) || c.allowedDestination !== 'trash') fail('cleanup requires fixed file identity and trash destination');
  if (ctx.m.checkPlan.sourceRef.files.some(r => r.path === c.path) || ctx.m.ownerFiles.some(p => inside(c.path, p) || inside(p, c.path))) fail('current source is not a cleanup candidate');
  const p = safePath(ctx.root, c.path, { missing: true });
  if (sourceRequired) {
    if (!fs.existsSync(p)) fail('source absent without confirmed task receipt: unknown', 'pending');
    if (!fs.statSync(p).isFile() || sha256(fs.readFileSync(p)) !== c.sha256) fail('cleanup source identity changed');
  }
  const recovery = ctx.m.closeoutEvidence?.recoveryRef || ctx.m.recoveryRef;
  if (!recovery || !c.recoveryRef) fail('recovery reference unavailable', 'pending');
  verifyRecovery(ctx, recovery); verifyRecovery(ctx, c.recoveryRef);
  const authorization = ctx.m.closeoutEvidence?.cleanupAuthorization || ctx.m.authorizedScope?.cleanup;
  if (!authorization?.basisRef || !authorization.categories?.includes(c.category) || authorization.destination !== 'trash') fail('cleanup authorization pending', 'pending');
  reference(ctx, authorization.basisRef);
  const channel = ctx.m.closeoutEvidence?.channel || ctx.m.cleanupChannel;
  if (channel?.kind !== 'trash' || !path.isAbsolute(channel.root) || !channel.evidenceRef) fail('trash channel unavailable', 'pending');
  reference(ctx, channel.evidenceRef);
  if (!fs.existsSync(channel.root) || !fs.statSync(channel.root).isDirectory() || fs.lstatSync(channel.root).isSymbolicLink()) fail('trash channel unavailable', 'pending');
  const channelRoot = (ctx.channelVerifier || verifySystemTrash)(channel);
  dependencyEvidence(ctx, c);
  return { path: c.path, channelRoot };
}
function status(ctx) {
  if (!ctx.state?.taskRef) return { status: 'pending', batchId: ctx.m.batchId, functionalStatus: 'pending', deliveryStatus: 'open', cleanupStatus: 'cleanup_pending', reason: 'finish has not accepted this batch' };
  sourceIdentity(ctx);
  const task = jsonReference(ctx, ctx.state.taskRef);
  const confirmed = ctx.state.confirmed || [];
  const items = task.candidates.map(c => {
    const done = confirmed.find(r => r.candidateId === c.candidateId);
    if (done) return done;
    try { cleanupPreflight(ctx, c); return { candidateId: c.candidateId, path: c.path, status: 'ready', action: 'Sol: move exact source to verified system Trash, then record-closeout; do not empty Trash' }; }
    catch (e) { return { candidateId: c.candidateId, path: c.path, status: 'blocked', reason: e.message }; }
  });
  return { status: 'passed', batchId: ctx.m.batchId, functionalStatus: 'accepted', deliveryStatus: ctx.state.deliveryStatus, cleanupStatus: ctx.state.cleanupStatus, taskRef: ctx.state.taskRef, acceptanceRef: ctx.state.acceptanceRef, confirmed, items, nextAction: ctx.state.deliveryStatus === 'closed' ? null : 'Sol must consume this same task or leave explicitly pending; this CLI never wakes AI or deletes files' };
}
export function finish(ctx) {
  acceptance(ctx);
  if (!ctx.state?.taskRef) {
    if (new Set(ctx.m.cleanupCandidates.map(c => c.candidateId)).size !== ctx.m.cleanupCandidates.length || ctx.m.cleanupCandidates.some(c => !/^[A-Za-z0-9._-]+$/.test(c.candidateId || ''))) fail('invalid/duplicate cleanup candidate IDs');
    const task = { schemaVersion: 1, taskId: `${ctx.m.batchId}:closeout`, batchId: ctx.m.batchId, revision: ctx.m.revision, sourceRef: ctx.m.checkPlan.sourceRef, intentHash: intentHash(ctx.m), createdAt: now(), candidates: ctx.m.cleanupCandidates, executor: 'local Codex Sol 6.1 xhigh', destructiveActionsPerformed: [] };
    const taskRel = `${ctx.dir}/closeout-task.json`, full = safePath(ctx.root, taskRel, { missing: true });
    let taskRef;
    // Resume an interrupted task write only when its full immutable content is the same.
    if (fs.existsSync(full)) {
      const existing = JSON.parse(fs.readFileSync(full));
      if (existing.intentHash !== task.intentHash || !same(existing.candidates, task.candidates)) fail('existing closeout task conflict');
      taskRef = { path: taskRel, sha256: sha256(fs.readFileSync(full)) };
    } else taskRef = saveArtifact(ctx, 'closeout-task.json', task);
    const acceptance = { schemaVersion: 1, kind: 'functional-acceptance', batchId: ctx.m.batchId, revision: ctx.m.revision, functionalStatus: 'accepted', acceptedCodeRef: ctx.m.checkPlan.sourceRef, acceptedIntentHash: intentHash(ctx.m), checkReceiptRefs: ctx.m.checkReceiptRefs, acceptedAt: jsonReference(ctx, taskRef).createdAt };
    const acceptedFile = safePath(ctx.root, `${ctx.dir}/accepted-code.json`, { missing: true });
    let acceptanceRef;
    if (fs.existsSync(acceptedFile)) {
      const existing = JSON.parse(fs.readFileSync(acceptedFile));
      if (existing.kind !== acceptance.kind || existing.batchId !== acceptance.batchId || existing.acceptedIntentHash !== acceptance.acceptedIntentHash || !same(existing.acceptedCodeRef, acceptance.acceptedCodeRef)) fail('functional acceptance receipt conflict');
      acceptanceRef = { path: `${ctx.dir}/accepted-code.json`, sha256: sha256(fs.readFileSync(acceptedFile)) };
    } else acceptanceRef = saveArtifact(ctx, 'accepted-code.json', acceptance);
    ctx.state = { schemaVersion: 1, batchId: ctx.m.batchId, acceptedIntentHash: intentHash(ctx.m), functionalStatus: 'accepted', acceptedCodeRef: ctx.m.checkPlan.sourceRef, taskRef, acceptanceRef, deliveryStatus: 'open', cleanupStatus: 'cleanup_pending', confirmed: [], receiptRefs: [] };
    if (!task.candidates.length) {
      const noopFile = safePath(ctx.root, `${ctx.dir}/closeout-noop.json`, { missing: true });
      let receiptRef;
      if (fs.existsSync(noopFile)) {
        const existing = JSON.parse(fs.readFileSync(noopFile));
        if (existing.batchId !== ctx.m.batchId || !same(existing.taskRef, taskRef) || existing.status !== 'noop' || !same(existing.entries, [])) fail('existing noop receipt conflict');
        receiptRef = { path: `${ctx.dir}/closeout-noop.json`, sha256: sha256(fs.readFileSync(noopFile)) };
      } else receiptRef = saveArtifact(ctx, 'closeout-noop.json', { batchId: ctx.m.batchId, taskRef, status: 'noop', entries: [], recordedAt: now(), reason: 'no manifest cleanup candidates; no scan performed' });
      ctx.state.deliveryStatus = 'closed'; ctx.state.cleanupStatus = 'noop'; ctx.state.receiptRefs.push(receiptRef);
    }
    atomicJSON(ctx.statePath, ctx.state);
  }
  ctx.m.status = 'accepted'; ctx.m.acceptedCodeRef = ctx.state.acceptedCodeRef; ctx.m.closeoutTaskRef = ctx.state.taskRef; saveManifest(ctx);
  return status(ctx);
}
export function verifyDestination(channelRoot, destination, sha) {
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) fail('destination must be an absolute path');
  const rel = path.relative(channelRoot, destination).split(path.sep).join('/');
  const actual = safePath(channelRoot, rel);
  if (!fs.statSync(actual).isFile() || sha256(fs.readFileSync(actual)) !== sha) fail('trash destination identity mismatch');
}
export function recordCloseout(ctx) {
  if (!ctx.state?.taskRef) fail('batch has not been accepted', 'pending');
  sourceIdentity(ctx);
  const incoming = ctx.m.closeoutReceiptRef;
  if (!incoming) fail('closeout receipt absent', 'pending');
  const r = jsonReference(ctx, incoming);
  if (r.batchId !== ctx.m.batchId || !same(r.taskRef, ctx.state.taskRef) || !Array.isArray(r.entries)) fail('closeout receipt identity mismatch');
  const task = jsonReference(ctx, ctx.state.taskRef), additions = [];
  const ids = new Set();
  for (const item of r.entries) {
    if (ids.has(item.candidateId)) fail('duplicate receipt candidate'); ids.add(item.candidateId);
    const c = task.candidates.find(c => c.candidateId === item.candidateId);
    if (!c || item.sourcePath !== c.path || item.sha256 !== c.sha256) fail('unknown or mismatched receipt candidate');
    const existing = ctx.state.confirmed.find(x => x.candidateId === c.candidateId);
    if (existing && !same(existing, item)) fail('closeout result conflict');
    if (item.status === 'done') {
      let channelRoot;
      if (existing) {
        const channel = ctx.m.closeoutEvidence?.channel || ctx.m.cleanupChannel;
        channelRoot = (ctx.channelVerifier || verifySystemTrash)(channel);
      } else ({ channelRoot } = cleanupPreflight(ctx, c, { sourceRequired: false }));
      if (fs.existsSync(safePath(ctx.root, c.path, { missing: true }))) fail('source still exists; not moved');
      verifyDestination(channelRoot, item.destinationPath, c.sha256);
      reference(ctx, item.operationRef);
    } else if (item.status === 'retained') {
      inScope(ctx.m, c.path);
      if (!item.reason?.trim() || !item.releaseCondition?.trim()) fail('retained candidate requires reason and release condition');
      const p = safePath(ctx.root, c.path, { missing: true });
      if (!fs.existsSync(p) || sha256(fs.readFileSync(p)) !== c.sha256) fail('retained source missing or changed');
    } else fail('only confirmed done/retained entries may be submitted');
    if (!existing) additions.push(item);
  }
  ctx.state.confirmed.push(...additions);
  if (!ctx.state.receiptRefs.some(x => same(x, incoming))) ctx.state.receiptRefs.push(incoming);
  const complete = ctx.state.confirmed.length === task.candidates.length;
  ctx.state.deliveryStatus = complete ? 'closed' : 'open';
  ctx.state.cleanupStatus = complete ? (ctx.state.confirmed.some(r => r.status === 'retained') ? 'partial' : task.candidates.length ? 'done' : 'noop') : 'cleanup_pending';
  atomicJSON(ctx.statePath, ctx.state);
  return status(ctx);
}
export const closeoutStatus = status;
