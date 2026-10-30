/**
 * lab/src/review5freeze.ts — REVIEW5 T0.5：可运行源码快照（不可变执行来源）。
 * 与 review4freeze（17 文件 hash 清单、训练仍 import 实时目录）不同，本快照是
 * 完整可执行树：训练主进程/worker/learner 均从快照路径加载，node_modules/@gd/*
 * 指向快照内 packages（不绕回实时目录）；.venv/tsx 为解释器与依赖锁，符号链接
 * 指向仓库本体并在 snapshot.json 记录 realpath。
 * 用法: npx tsx lab/src/review5freeze.ts [--id <snapId>] [--protocol-draft <file> --out <file>]
 * 产物: lab/review2/frozen/<snapId>/（拒绝覆盖）+ SHA256SUMS.json + snapshot.json
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..'); // = repo 根
const R2 = join(ROOT, 'lab', 'review2');

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function walkFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const rel = base ? `${base}/${f}` : f;
    if (statSync(p).isDirectory()) out.push(...walkFiles(p, rel));
    else out.push(rel);
  }
  return out;
}

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

function main(): number {
  const snapId = argOf('id') ?? `review5-snapshot-${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}`;
  const SNAP = join(R2, 'frozen', snapId);
  if (existsSync(SNAP)) { console.error(`快照已存在，拒绝覆盖: ${SNAP}`); return 4; }
  mkdirSync(SNAP, { recursive: true });

  const manifest: Record<string, string> = {};
  const addDir = (relDir: string, exts: string[]): void => {
    const src = join(ROOT, relDir);
    if (!existsSync(src)) return;
    for (const f of walkFiles(src)) {
      if (!exts.some((e) => f.endsWith(e))) continue;
      const rel = `${relDir}/${f}`;
      manifest[rel] = sha(join(src, f));
    }
    cpSync(src, join(SNAP, relDir), { recursive: true, filter: (s) => exts.some((e) => s.endsWith(e)) || statSync(s).isDirectory() });
  };

  // 源树（完整传递依赖：lab/src + lab/learner.py + 四包 src）
  addDir('lab/src', ['.ts', '.py']);
  manifest['lab/learner.py'] = sha(join(ROOT, 'lab', 'learner.py'));
  cpSync(join(ROOT, 'lab', 'learner.py'), join(SNAP, 'lab', 'learner.py'));
  for (const pkg of ['engine', 'ai', 'review', 'web']) addDir(`packages/${pkg}/src`, ['.ts', '.tsx']);
  // 配置与依赖锁身份
  for (const f of ['package.json', 'tsconfig.base.json', 'vitest.config.ts',
    'packages/engine/package.json', 'packages/engine/tsconfig.json',
    'packages/ai/package.json', 'packages/ai/tsconfig.json',
    'packages/review/package.json', 'packages/review/tsconfig.json',
    'packages/web/package.json', 'packages/web/tsconfig.json']) {
    if (!existsSync(join(ROOT, f))) { console.error(`快照源缺失: ${f}`); return 4; }
    manifest[f] = sha(join(ROOT, f));
    cpSync(join(ROOT, f), join(SNAP, f));
  }

  // node_modules/@gd/* → 快照内 packages（import 解析不绕回实时目录）
  mkdirSync(join(SNAP, 'node_modules', '@gd'), { recursive: true });
  for (const pkg of ['engine', 'ai', 'review', 'web']) {
    symlinkSync(join('..', '..', 'packages', pkg), join(SNAP, 'node_modules', '@gd', pkg));
  }
  // 解释器/venv：符号链接到仓库本体（依赖身份记录，不复制）
  symlinkSync(join('..', '..', '..', '..', '..', 'lab', '.venv'), join(SNAP, 'lab', '.venv')); // snap/lab→snap→frozen→review2→repoLab→repo 共 5 级

  let gitHead = 'unknown';
  try { gitHead = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch { /* 非 git 环境如实记录 */ }
  const pyVer = (() => { try { return execSync('lab/.venv/bin/python --version', { cwd: ROOT }).toString().trim(); } catch { return 'unknown'; } })();

  writeFileSync(join(SNAP, 'SHA256SUMS.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(SNAP, 'snapshot.json'), JSON.stringify({
    snapshotId: snapId, createdAt: new Date().toISOString(), gitHead,
    files: Object.keys(manifest).length,
    interpreter: { python: pyVer, venvRealpath: `${ROOT}/lab/.venv`, tsx: 'repo node_modules（依赖锁=package.json hash）' },
    contract: 'train/evaluate 从本快照运行（GD_SNAPSHOT_DIR）；运行中重哈希校验，改动即报错；realpath 不得绕回实时目录（node_modules/@gd/* 指快照内 packages）',
  }, null, 2));

  const outProto = argOf('out');
  if (outProto) {
    const draftPath = argOf('protocol-draft');
    if (draftPath && existsSync(join(ROOT, draftPath))) {
      const draft = JSON.parse(readFileSync(join(ROOT, draftPath), 'utf8'));
      writeFileSync(join(ROOT, outProto), JSON.stringify({
        ...draft, draft: false, frozenAt: new Date().toISOString(),
        sourceSnapshot: manifest,
        runnableSnapshot: { dir: `lab/review2/frozen/${snapId}`, snapshotId: snapId },
      }, null, 2));
      console.log(`协议已冻结: ${outProto}（可运行快照 ${snapId}，${Object.keys(manifest).length} 文件）`);
    } else {
      console.error('--protocol-draft 缺失或不存在（仅生成快照，不冻结协议）');
    }
  }
  console.log(`快照完成: ${SNAP}（${Object.keys(manifest).length} 文件）`);
  return 0;
}
process.exit(main());
