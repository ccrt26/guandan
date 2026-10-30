/** Historical inputs stay immutable; explicit new output lives in lab/out/<task>. */
import * as fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const labRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const archiveRoot = join(labRoot, 'archive', 'legacy-through-20261030');
const names = ['round2', 'round2_bugregime', 'diag_b', 'tiers', 'clean1', 'guardfix_evidence'];
const inside = (path: string, root: string): boolean => path === root || path.startsWith(root + '/');
const pathString = (path: fs.PathLike): string => path instanceof URL ? fileURLToPath(path) : path.toString();

function archived(path: string): string {
  const absolute = resolve(path);
  for (const name of names) {
    const oldRoot = join(labRoot, name);
    if (inside(absolute, oldRoot)) return join(archiveRoot, name, relative(oldRoot, absolute));
  }
  return absolute;
}

function outputRoot(): string {
  const configured = process.env.GD_LEGACY_OUTPUT_ROOT;
  if (!configured) throw new Error('历史输入已归档；生成新结果须显式设置 GD_LEGACY_OUTPUT_ROOT=lab/out/<task-id>，不会写入归档。');
  const root = resolve(configured);
  const allowed = join(labRoot, 'out');
  if (root === allowed || !inside(root, allowed)) throw new Error('GD_LEGACY_OUTPUT_ROOT 必须位于 lab/out/<task-id>。');
  // Reject a pre-existing symlink that would redirect output into the archive.
  let existing = root;
  while (!fs.existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  if (!inside(fs.realpathSync(existing), fs.realpathSync(allowed))) throw new Error('输出路径不能通过链接逃离 lab/out。');
  return root;
}

export function legacyWritePath(path: string): string {
  const source = archived(path);
  return inside(source, archiveRoot) ? join(outputRoot(), relative(archiveRoot, source)) : path;
}

export function legacyReadPath(path: string): string {
  const source = archived(path);
  if (inside(source, archiveRoot) && process.env.GD_LEGACY_OUTPUT_ROOT) {
    const generated = join(outputRoot(), relative(archiveRoot, source));
    if (fs.existsSync(generated)) return generated;
  }
  return source;
}

function readPath(path: fs.PathOrFileDescriptor): fs.PathOrFileDescriptor {
  return typeof path === 'number' ? path : legacyReadPath(pathString(path));
}
function writePath(path: fs.PathOrFileDescriptor): fs.PathOrFileDescriptor {
  if (typeof path === 'number') return path;
  const original = pathString(path), target = legacyWritePath(original);
  if (target !== original) fs.mkdirSync(dirname(target), { recursive: true });
  return target;
}

export const readFileSync = ((path: fs.PathOrFileDescriptor, ...args: unknown[]) =>
  Reflect.apply(fs.readFileSync, fs, [readPath(path), ...args])) as typeof fs.readFileSync;
export const writeFileSync = ((path: fs.PathOrFileDescriptor, ...args: unknown[]) =>
  Reflect.apply(fs.writeFileSync, fs, [writePath(path), ...args])) as typeof fs.writeFileSync;
export const appendFileSync = ((path: fs.PathOrFileDescriptor, ...args: unknown[]) =>
  Reflect.apply(fs.appendFileSync, fs, [writePath(path), ...args])) as typeof fs.appendFileSync;
export const mkdirSync = ((path: fs.PathLike, ...args: unknown[]) =>
  Reflect.apply(fs.mkdirSync, fs, [legacyWritePath(pathString(path)), ...args])) as typeof fs.mkdirSync;
export const copyFileSync = ((source: fs.PathLike, target: fs.PathLike, ...args: unknown[]) =>
  Reflect.apply(fs.copyFileSync, fs, [readPath(source), writePath(target), ...args])) as typeof fs.copyFileSync;
export const existsSync = ((path: fs.PathLike) => fs.existsSync(legacyReadPath(pathString(path)))) as typeof fs.existsSync;
export const readdirSync = ((path: fs.PathLike, ...args: unknown[]) =>
  Reflect.apply(fs.readdirSync, fs, [readPath(path), ...args])) as typeof fs.readdirSync;
