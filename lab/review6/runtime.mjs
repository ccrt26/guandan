import { createHash } from 'node:crypto';
import { openSync, closeSync, fsyncSync, readFileSync, writeFileSync, unlinkSync, existsSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const sha256File = (path) => sha256(readFileSync(path));
export function finiteSeconds(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Error('seconds must be finite and nonnegative');
  return n;
}
export function writeNewJson(path, object) {
  // All outputs are exclusive; parent symlinks must already resolve to the intended directory.
  const parent = realpathSync(dirname(resolve(path)));
  const out = resolve(parent, resolve(path).split('/').at(-1));
  const fd = openSync(out, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(object, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}
function withLock(path, fn) {
  const lock = path + '.writer-lock';
  const fd = openSync(lock, 'wx', 0o600);
  try { return fn(); } finally { closeSync(fd); unlinkSync(lock); }
}
function append(path, entry) {
  const prior = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const previousHash = prior ? JSON.parse(prior.trimEnd().split('\n').at(-1)).entryHash : null;
  const body = { ...entry, previousHash };
  const value = { ...body, entryHash: sha256(JSON.stringify(body)) };
  const fd = openSync(path, prior ? 'a' : 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}
export function readBudget(path, cycleId) {
  if (lstatSync(path).isSymbolicLink()) throw new Error('ledger must not be a symlink');
  const content = readFileSync(path, 'utf8');
  if (!content.endsWith('\n')) throw new Error('incomplete ledger tail');
  let previousHash = null, limitSeconds = null, spentSeconds = 0;
  const reservations = {}, settled = new Set();
  for (const [index, line] of content.trimEnd().split('\n').entries()) {
    const { entryHash, ...body } = JSON.parse(line);
    if (body.previousHash !== previousHash || sha256(JSON.stringify(body)) !== entryHash) throw new Error('ledger hash mismatch');
    if (body.cycleId !== cycleId) throw new Error('ledger cycle mismatch');
    previousHash = entryHash;
    if (body.kind === 'initialize' && index === 0) {
      limitSeconds = finiteSeconds(body.limitSeconds); spentSeconds = finiteSeconds(body.actualSeconds);
    } else if (body.kind === 'reserve' && limitSeconds !== null) {
      finiteSeconds(body.seconds);
      if (Object.hasOwn(reservations, body.taskId) || settled.has(body.taskId)) throw new Error('duplicate reservation');
      reservations[body.taskId] = body.seconds;
    } else if (body.kind === 'settle' && Object.hasOwn(reservations, body.taskId)) {
      finiteSeconds(body.actualSeconds);
      if (body.actualSeconds > reservations[body.taskId]) throw new Error('cost exceeds reservation');
      spentSeconds += body.actualSeconds; delete reservations[body.taskId]; settled.add(body.taskId);
    } else throw new Error('invalid ledger event');
    if (spentSeconds + Object.values(reservations).reduce((a,b)=>a+b,0) > limitSeconds) throw new Error('budget overspend');
  }
  if (limitSeconds === null) throw new Error('missing ledger initialization');
  const reservedSeconds = Object.values(reservations).reduce((a,b)=>a+b,0);
  return { cycleId, limitSeconds, spentSeconds, reservedSeconds, availableSeconds: limitSeconds-spentSeconds-reservedSeconds, reservations, settledTaskIds:[...settled], headHash: previousHash };
}
export function initializeBudget(path, cycleId, limitSeconds, actualSeconds) {
  finiteSeconds(limitSeconds); finiteSeconds(actualSeconds);
  if (!cycleId || actualSeconds > limitSeconds) throw new Error('invalid cycle budget');
  return withLock(path, () => {
    if (existsSync(path)) {
      const state = readBudget(path, cycleId);
      if (state.limitSeconds !== limitSeconds) throw new Error('cannot change budget limit');
      return state;
    }
    append(path, { kind:'initialize', cycleId, limitSeconds, actualSeconds, at:new Date().toISOString() });
    return readBudget(path, cycleId);
  });
}
export function reserveBudget(path, cycleId, taskId, seconds) {
  finiteSeconds(seconds);
  if (!taskId || ['__proto__','constructor','prototype'].includes(taskId)) throw new Error('invalid task ID');
  return withLock(path, () => {
    const state = readBudget(path, cycleId);
    if (state.availableSeconds < seconds) throw new Error('insufficient budget');
    if (Object.hasOwn(state.reservations, taskId) || state.settledTaskIds.includes(taskId)) throw new Error('duplicate reservation');
    append(path, {kind:'reserve',cycleId,taskId,seconds,at:new Date().toISOString()});
    return readBudget(path, cycleId);
  });
}
export function settleBudget(path, cycleId, taskId, actualSeconds) {
  finiteSeconds(actualSeconds);
  return withLock(path, () => {
    const state = readBudget(path, cycleId);
    if (!Object.hasOwn(state.reservations, taskId) || actualSeconds > state.reservations[taskId]) throw new Error('missing or exceeded reservation');
    append(path, {kind:'settle',cycleId,taskId,actualSeconds,at:new Date().toISOString()});
    return readBudget(path, cycleId);
  });
}
export function preserveRunState(state) {
  for (const key of ['round','absoluteUpdate','confirmationAttemptsOpened']) {
    if (!Number.isSafeInteger(state[key]) || state[key]<0) throw new Error('invalid inherited '+key);
  }
  if (state.round>3 || state.confirmationAttemptsOpened>3) throw new Error('inherited round/attempt exceeds original limit');
  return structuredClone(state);
}
export function deriveRunState(indexPath, cycleId) {
  const index=JSON.parse(readFileSync(indexPath,'utf8'));
  if (index.cycleId!==cycleId || !Array.isArray(index.runManifests)) throw new Error('invalid authoritative state index');
  // Small run sidecars live here; bulk checkpoint data may remain outside the repository.
  // Enumerating sidecars prevents a stale/empty index from erasing a saved run.
  const actualManifests=[];
  function scan(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory,{withFileTypes:true})) {
      const path=resolve(directory,entry.name);
      if (entry.isSymbolicLink()) throw new Error('run manifest directory contains symlink');
      if (entry.isDirectory()) scan(path);
      else if (entry.name==='run-manifest.json') actualManifests.push(realpathSync(path));
    }
  }
  scan(resolve(dirname(indexPath),'runs'));
  const indexed=index.runManifests.map(x=>realpathSync(x.path)).sort();
  if (JSON.stringify(indexed)!==JSON.stringify(actualManifests.sort())) throw new Error('run manifest omitted or unregistered in state index');
  const openedPath=resolve(dirname(indexPath),'confirmation-opened.jsonl');
  if (existsSync(openedPath) && (!index.openedLedger || realpathSync(index.openedLedger.path)!==realpathSync(openedPath))) throw new Error('opened ledger omitted from authoritative state');
  if (index.openedLedger && (!existsSync(openedPath) || realpathSync(index.openedLedger.path)!==realpathSync(openedPath))) throw new Error('opened ledger must use canonical path');
  const runs=[];
  for (const reference of index.runManifests) {
    verifyFiles([reference]);
    const run=JSON.parse(readFileSync(reference.path,'utf8'));
    if (run.cycleId!==cycleId || !run.runId || !run.checkpoint) throw new Error('run state identity mismatch');
    preserveRunState({...run,confirmationAttemptsOpened:0});
    verifyFiles([run.checkpoint]);
    const checkpoint=JSON.parse(readFileSync(run.checkpoint.path,'utf8'));
    if (checkpoint.cycleId!==cycleId || checkpoint.runId!==run.runId || checkpoint.round!==run.round || checkpoint.absoluteUpdate!==run.absoluteUpdate) throw new Error('checkpoint state mismatch');
    runs.push({...run,manifestPath:reference.path});
  }
  const opened=new Set();
  if (index.openedLedger) {
    verifyFiles([index.openedLedger]);
    const text=readFileSync(index.openedLedger.path,'utf8');
    if (!text.endsWith('\n')) throw new Error('incomplete opened ledger');
    for (const line of text.trimEnd().split('\n')) {
      const row=JSON.parse(line);
      if (row.cycleId!==cycleId || !Number.isSafeInteger(row.attempt) || row.attempt<1 || row.attempt>3 || !['opened','completed','invalid','incomplete'].includes(row.kind)) throw new Error('invalid opened attempt state');
      if (row.kind==='opened') {
        if (opened.has(row.attempt)) throw new Error('duplicate opened attempt');
        opened.add(row.attempt);
      } else if (!opened.has(row.attempt)) throw new Error('attempt status before opened');
    }
  }
  return {round:runs.length?Math.max(...runs.map(x=>x.round)):0,
    absoluteUpdate:runs.length?Math.min(...runs.map(x=>x.absoluteUpdate)):0,
    confirmationAttemptsOpened:opened.size,openedAttempts:[...opened],
    checkpointManifestPath:runs.length?indexPath:null,
    status:runs.length?'running_or_saved':'not_started',runs,
    sourceIndexPath:indexPath,sourceIndexHash:sha256File(indexPath)};
}
export function verifyProcessIdentity(expected, observed) {
  for (const key of ['pid','startTime','cwd','protocolHash']) {
    if (expected[key] == null || expected[key] !== observed[key]) throw new Error('process identity mismatch: '+key);
  }
}
export function verifyFiles(files) {
  if (!files.length) throw new Error('empty file manifest');
  for (const item of files) {
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || sha256File(item.path)!==item.sha256) throw new Error('file hash mismatch: '+item.path);
  }
}
