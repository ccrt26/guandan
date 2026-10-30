/**
 * lab/src/review4/review4freeze.ts — REVIEW4 freeze：protocol-v4 冻结 + 不可变源码快照。
 * 1) 17 个训练传递依赖源文件 → lab/review2/frozen/review4-snapshot/（逐文件复制+SHA，
 *    拒绝覆盖已存在快照）；2) 生成 protocol-v4.json（draft 值来自 protocol-v4-draft.json，
 *    sourceSnapshot 用实测 hash、frozenAt 打时间戳）；3) train 启动时校验实时文件与快照
 *    hash 一致并写 loaded-source-manifest（修复 A3 发现的"实时src加载无逐run清单"）。
 * 用法: npx tsx lab/src/review4/review4freeze.ts
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const R2 = join(ROOT, 'lab', 'review2');
const SNAP = join(R2, 'frozen', 'review4-snapshot');

const SRC_FILES = [
  'packages/engine/src/combo.ts', 'packages/engine/src/game.ts', 'packages/engine/src/rank.ts',
  'packages/engine/src/deck.ts', 'packages/engine/src/record.ts',
  'packages/ai/src/heuristic.ts', 'packages/ai/src/legal.ts', 'packages/ai/src/sim.ts',
  'packages/ai/src/nn/schema.ts', 'packages/ai/src/nn/mlp.ts', 'packages/ai/src/nn/neuralSeat.ts',
  'packages/ai/src/nn/nnplayer.ts', 'packages/ai/src/nn/wave.ts',
  'lab/src/clean1.ts', 'lab/src/wave_worker.ts', 'lab/src/review2train.ts', 'lab/learner.py',
];

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

function main(): number {
  const draftPath = join(R2, 'protocol-v4-draft.json');
  if (!existsSync(draftPath)) { console.error('缺少 protocol-v4-draft.json'); return 4; }
  const out = join(R2, 'protocol-v4.json');
  if (existsSync(out)) { console.error('protocol-v4.json 已冻结，拒绝覆盖（改动协议=新文件）'); return 4; }
  if (existsSync(SNAP)) { console.error(`快照目录已存在，拒绝覆盖: ${SNAP}`); return 4; }

  // 1) 不可变快照
  mkdirSync(SNAP, { recursive: true });
  const sourceSnapshot: Record<string, string> = {};
  for (const f of SRC_FILES) {
    const src = join(ROOT, f);
    if (!existsSync(src)) { console.error(`快照源缺失: ${f}`); return 4; }
    const h = sha(src);
    copyFileSync(src, join(SNAP, f.replace(/\//g, '__')));
    sourceSnapshot[f] = h;
  }
  writeFileSync(join(SNAP, 'SHA256SUMS.json'), JSON.stringify(sourceSnapshot, null, 2));

  // 2) 协议冻结（draft 值 + 实测 hash）
  const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
  const proto = {
    ...draft,
    draft: false,
    frozenAt: new Date().toISOString(),
    sourceSnapshot,
    snapshotDir: 'lab/review2/frozen/review4-snapshot',
    loadedSourceContract: 'train(review4-*) 启动时逐文件校验实时 hash 与 sourceSnapshot 一致，不一致即拒绝启动；ledger train-start 记 loadedSources',
  };
  writeFileSync(out, JSON.stringify(proto, null, 2));
  console.log(`protocol-v4.json 已冻结（${Object.keys(sourceSnapshot).length} 文件快照 → ${SNAP}）`);
  console.log('candidateVersion=', proto.candidateVersion ?? proto.rules?.candidateVersion, 'inputDim=', proto.encoder?.dims?.input);
  return 0;
}
process.exit(main());
