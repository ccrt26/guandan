/**
 * lab/src/review2freeze.ts — freeze（REVIEW3-EXEC §11.3）：生成 protocol-v3.json。
 * 字段全部取实测值（源文件 SHA256、权重 SHA256、维度/版本常量、预算、种子命名空间、
 * 按 run 的有效配置）。unknown/空 hash 即视为未冻结——train 侧拒绝 draft。
 * 已冻结文件拒绝覆盖（改动协议=新文件或显式 --force-revision 说明）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INPUT_DIM, STATE_DIM, ACTION_DIM, SCHEMA_VERSION, CANDIDATE_VERSION, NEURAL_MODEL_VERSION } from '@gd/ai';

const ROOT = join(import.meta.dirname, '..', '..');
const R2 = join(ROOT, 'lab', 'review2');

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

const SRC_FILES = [
  'packages/engine/src/combo.ts', 'packages/engine/src/game.ts', 'packages/engine/src/rank.ts',
  'packages/engine/src/deck.ts', 'packages/engine/src/record.ts',
  'packages/ai/src/heuristic.ts', 'packages/ai/src/legal.ts', 'packages/ai/src/sim.ts',
  'packages/ai/src/nn/schema.ts', 'packages/ai/src/nn/mlp.ts', 'packages/ai/src/nn/neuralSeat.ts',
  'packages/ai/src/nn/nnplayer.ts', 'packages/ai/src/nn/wave.ts',
  'lab/src/clean1.ts', 'lab/src/wave_worker.ts', 'lab/src/review2train.ts', 'lab/learner.py',
];

function run(argc: string[]): number {
  const draft = argc.includes('--draft');
  const wi = argc.indexOf('--workers');
  const workersOverride = wi >= 0 ? Number(argc[wi + 1]) : undefined;
  const protocolPath = argc.includes('--protocol') ? argc[argc.indexOf('--protocol') + 1]
    : draft ? join(R2, 'protocol-v3-draft.json') : join(R2, 'protocol-v3.json');
  if (existsSync(protocolPath)) {
    console.error(`已存在协议 ${protocolPath}，拒绝覆盖（改动协议须生成新文件）`);
    return 4;
  }
  const sourceSnapshot: Record<string, string> = {};
  for (const f of SRC_FILES) {
    const p = join(ROOT, f);
    if (!existsSync(p)) { console.error(`冻结失败：源文件缺失 ${f}`); return 4; }
    sourceSnapshot[f] = sha(p);
  }
  const rulesHash = sha(join(ROOT, 'packages/engine/src/game.ts')) + ':' + sha(join(ROOT, 'packages/engine/src/combo.ts'));
  const protocol = {
    protocolVersion: 'REVIEW3-EXEC-1.0',
    draft,
    frozenAt: draft ? null : new Date().toISOString(),
    rules: { levelMode: 'stage', hash: rulesHash },
    candidate: { version: CANDIDATE_VERSION, hash: sha(join(ROOT, 'packages/engine/src/combo.ts')) },
    encoder: { version: SCHEMA_VERSION, dims: { input: INPUT_DIM, state: STATE_DIM, action: ACTION_DIM }, hash: sha(join(ROOT, 'packages/ai/src/nn/schema.ts')) },
    reward: { definition: 'y = g + W；g=本副本队名次分 ±升级数(1/2/3)，W=完整 match 胜负 ±1', hash: sha(join(ROOT, 'lab/src/clean1.ts')) },
    trainer: {
      kind: 'synchronous-wave-dmc',
      workers: workersOverride ?? 4, // 由 parallel-probe decision 决定（--workers 覆盖）
      waveSize: 8,
      groupSize: 2048, trainSub: 1024, epsilon: 0.05,
      maxUpdates: 7051, maxActiveMs: 13680000, shutdownMarginMs: 90000,
      checkpointUpdates: [500, 1800, 3600, 5400, 7051],
      matchGameCap: 60, torchThreads: 2,
      lagAccounting: 'per-update 块内 waveId 构成 → 行为版本年龄 p50/p95/max（含跨波尾部）',
      fallback: 'serial-dmc（正确性优先：并行契约失败时回退 clean1 串行路径完成 T1）',
    },
    network: { arch: '385→256→256→1 tanh×2 线性头', params: 164865, init: 'He/LeCun 1/sqrt(fan_in) + Box-Muller' },
    referenceWeights: {
      deployed: 'packages/web/public/ai/clean1.f32',
      sha256: sha(join(ROOT, 'packages/web/public/ai/clean1.f32')),
      policyId: NEURAL_MODEL_VERSION,
    },
    budgets: {
      parallelProbeActiveMs: 1800000,
      t1EvalMs: 2700000, t2EvalMs: 2700000,
      externalEvalMs: 1800000, humanProbeComputeMs: 1800000,
      maxNewLlmCalls: 6,
    },
    selection: {
      dev: 'M1=N+N vs O+O、M2=N+H vs O+H 各 32 块（块=种子，两场换边）；S=0.5p(M1)+0.5p(M2)；同分先 M2，再较早检查点；init 不参加',
      confirm: 'M1 128 块 + M2 256 块；97.5% 双侧块区间：M1 点估计≥55% 且下界>50%，M2 下界>45%；最多两次晋级尝试（第二次全新种子）',
      stopping: 'T1=7051 updates 或 228 active 分钟先到即停；90s 退出余量；未完成场不赋 W',
    },
    seeds: {
      namespaces: {
        'main-init': 2026102805, 'main-train': 2026102806,
        'replica-init': 2026102905, 'replica-train': 2026102906,
        probe: 2026110001, dev: 2026110002, 'confirm-attempt1': 2026110003,
        'confirm-attempt2': 2026110004, 'external-dev': 2026110005, 'external-confirm': 2026110006,
        'human-split': 2026110007,
      },
      derivation: 'deriveSeed(namespace, master, matchId, purpose)；stepSeed=deriveStepSeed(namespace, master, updateId)；见 packages/ai/src/nn/wave.ts',
    },
    effectiveRunConfig: {
      'clean2-main': { newMaxUpdates: 7051, newMaxActiveMs: 13680000, parents: '随机初始化(main-init)' },
      'clean2-replica': { newMaxUpdates: 7051, newMaxActiveMs: 13680000, parents: '随机初始化(replica-init)' },
      'pool-control': { newMaxUpdates: 1800, newMaxActiveMs: 3600000, parents: 'T1 candidate.json' },
      'pool-mixture': { newMaxUpdates: 1800, newMaxActiveMs: 3600000, parents: 'T1 candidate.json' },
      'bc-control': { newMaxUpdates: 1800, newMaxActiveMs: 3600000, parents: 'T1 candidate.json' },
      'bc-assisted': { dmcMaxUpdates: 1800, newMaxActiveMs: 3600000, maxBcActiveMs: 900000, maxBcStates: 50000, maxBcEpochs: 1, parents: 'T1 candidate.json' },
    },
    sourceSnapshot,
    artifacts: {
      candidateProfile: 'lab/review2/candidate_profile_v2.json',
      observationAudit: 'lab/review2/observation_audit.json',
      parallelProbe: 'lab/review2/parallel_probe/（探针后补 decision）',
    },
  };
  // 完整性自检：任何 unknown/空 hash 阻断
  const bad = Object.entries(sourceSnapshot).filter(([, v]) => !v || v.length !== 64);
  if (bad.length > 0) { console.error(`冻结失败：${bad.map(([k]) => k).join(',')} 哈希异常`); return 4; }
  mkdirSync(R2, { recursive: true });
  writeFileSync(protocolPath, JSON.stringify(protocol, null, 1));
  console.log(`协议已冻结 → ${protocolPath}`);
  console.log(`candidate=${CANDIDATE_VERSION} encoder=${SCHEMA_VERSION} input=${INPUT_DIM} 参照权重=${protocol.referenceWeights.sha256.slice(0, 16)}`);
  return 0;
}

if (process.argv[1] && process.argv[1].includes('review2freeze')) {
  process.exit(run(process.argv.slice(2)));
}
export { run as runFreeze };
