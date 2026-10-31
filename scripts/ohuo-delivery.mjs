#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContext, withLock, inspect, finish, closeoutStatus, recordCloseout } from './ohuo-delivery/core.mjs';
import { runChecks, CHECK_REGISTRY, validateCheck, validateReceiptResults } from './ohuo-delivery/checks.mjs';

const ACTIONS = ['inspect', 'run-checks', 'finish', 'closeout-status', 'record-closeout', 'resume-closeout'];
export async function delivery(action, { root, batchPath, ...request }) {
  try {
    if (!ACTIONS.includes(action)) throw new Error(`unknown action: ${action}`);
    let ctx = loadContext(root, batchPath);
    if (action !== 'run-checks' && request.invalidReason) throw new Error(request.invalidReason);
    return await withLock(ctx, async () => {
      ctx = loadContext(root, batchPath); // Re-read only after obtaining the writer lock.
      ctx.channelVerifier = request.channelVerifier;
      const registry = request.registry || CHECK_REGISTRY;
      if (action === 'run-checks') return runChecks(ctx, request, registry);
      if (action === 'inspect') return inspect(ctx);
      if (action === 'finish') {
        for (const c of ctx.m.checkPlan.checks) validateCheck(ctx, c, registry);
        validateReceiptResults(ctx, registry);
        return finish(ctx);
      }
      if (action === 'record-closeout') return recordCloseout(ctx);
      return closeoutStatus(ctx);
    });
  } catch (e) { return { status: e.status || 'rejected', reason: e.message, executed: [] }; }
}
export function parseCLI(argv) {
  const action = argv[0], request = { checkIds: [] };
  const seen = new Set();
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i], value = argv[i + 1];
    if (!['--batch', '--site', '--check'].includes(flag) || !value || value.startsWith('--')) { request.invalidReason = `unknown, missing or forbidden argument: ${flag}`; continue; }
    i++;
    if (flag !== '--check' && seen.has(flag)) request.invalidReason = `duplicate argument: ${flag}`;
    seen.add(flag);
    if (flag === '--batch') request.batchPath = value;
    if (flag === '--site') request.site = value;
    if (flag === '--check') request.checkIds.push(value);
  }
  if (action !== 'run-checks' && (request.site || request.checkIds.length)) request.invalidReason = 'only run-checks accepts --site/--check';
  if (!request.batchPath) request.invalidReason = 'explicit --batch is required';
  return { action, request };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { action, request } = parseCLI(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await delivery(action, { root, ...request });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'passed' ? 0 : result.status === 'pending' ? 3 : result.status === 'failed' ? 1 : 2;
}
