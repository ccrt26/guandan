/** Output locations only; importing this module performs no writes. */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const within = (p, base) => p !== base && !relative(base, p).startsWith('..' + sep) && relative(base, p) !== '..' && !isAbsolute(relative(base, p));
export function checkedOutput(value, base = resolve(projectRoot, 'lab/out')) {
  const p = resolve(projectRoot, value);
  if (!within(p, base)) throw new Error('Output must be a task directory under ' + base);
  let ancestor = p;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (ancestor !== base && !within(realpathSync(ancestor), realpathSync(base))) throw new Error('Output symlink escapes its allowed root');
  return p;
}
export function taskOutput(prefix = 'task', defaultTask) {
  const task = process.env.GD_TASK_ID || defaultTask || `${prefix}-${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(task)) throw new Error('GD_TASK_ID must be one path segment');
  return checkedOutput(process.env.GD_TASK_OUTPUT_ROOT || `lab/out/${task}`);
}

/** Check the final Vite config after CLI overrides, without building anything. */
export function assertBuildOutput(configRoot, build, workingDirectory = process.cwd()) {
  checkedOutput(resolve(configRoot, build.outDir));
  const output = build.rollupOptions?.output;
  for (const item of output ? (Array.isArray(output) ? output : [output]) : []) {
    if (item.dir) checkedOutput(resolve(workingDirectory, item.dir));
    if (item.file) checkedOutput(dirname(resolve(workingDirectory, item.file)));
  }
}
