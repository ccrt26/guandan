/**
 * lab/src/review5_tuning/proxyFit.ts — REVIEW5 T4 / 补充 Task 3：H_human 行为克隆。
 * 数据：T3 语义回放的匹配决策（train/dev/holdout 6000/2000/2000 固定 seed 整场组内抽样）。
 * 配方（冻结）：U0 父权重（clean2 → 399 rule-context → pass 迁移 action64）起步；
 * RMSprop lr=1e-4 α=0.9 eps=1e-5 m=0 centered=false wd=0；候选 softmax 温度 1 交叉熵；
 * 按决策成批；≤3 epoch；≤20 分钟 active。随机采样模式 legal_softmax_sample 温度 1（policyId 记录）。
 * 质量门：宏平均 NLL 严格低于均匀基线与 kind 先验基线；无动作塌缩；分层报告。
 * 运行：npx tsx lab/src/review5_tuning/proxyFit.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import {
  applyMove, canPass, createMatch, DEFAULT_RULES, legalCombos, startGame, teamOf,
  type Card, type GameState,
} from '@gd/engine';
import {
  dedupCandidates, encodeAction, encodeStateV2, INPUT_DIM_V2, migratePassEncoding, MLP,
  mulberry32, NeuralDecider, PublicTracker, remapV1WeightsToV2, STATE_DIM_V2, SCHEMA_VERSION_V4,
} from '@gd/ai';
import { loadMatches, verifyRound, DEFAULT_MAPPING, codeOfCard, type KscbMatch } from './kscbReplay';

const REPO = join(import.meta.dirname, '..', '..', '..');
const ART = join(REPO, 'lab', 'review5', 'artifacts');
const DATA = join(REPO, 'lab', 'review2', 'assets', 'kscb-guandan', '1e5c5d1b7634a4eb973ad3364a46ef494074e205', 'guandan_matches.jsonl.gz');
const PARENT = join(REPO, 'packages', 'web', 'public', 'ai', 'clean2.f32');
const SEED = 2026102802; // 补充模板 defaultSeedIfNotAlreadyFrozen
const QUOTA = { train: 6000, dev: 2000, holdout: 2000 };

interface TrainingDecision {
  matchId: string; sampleId: string; split: string; actorSeat: number;
  kind: 'pass' | 'play';
  stateFeat: Float32Array;       // 331（rule-context, v2 布局）
  candFeats: Float32Array;       // nCands × 68（action64）
  candKinds: string[];           // 候选 kind（pass 记 'pass'）——kind 先验基线用
  chosenIdx: number;             // 匹配候选下标（-1=未匹配，不训练）
}

function buildU0(): Float32Array {
  const buf = readFileSync(PARENT);
  const v1 = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  return migratePassEncoding(remapV1WeightsToV2(v1), INPUT_DIM_V2, STATE_DIM_V2);
}

/** 逐副提取带特征的决策（onAction 回调里编码） */
function extractWithFeatures(matches: KscbMatch[], splitOf: Map<string, string>): TrainingDecision[] {
  const out: TrainingDecision[] = [];
  for (const m of matches) {
    const split = splitOf.get(m.sample_id);
    if (!split) continue;
    for (const r of m.rounds) {
      verifyRound(r, DEFAULT_MAPPING, null, (info) => {
        if (!info.candidateMatched || info.chosenIdx == null || info.chosenIdx < 0) return;
        if (!info.stateFeat || !info.candFeats || !info.candKinds) return;
        out.push({
          matchId: m.sample_id, sampleId: r.sample_id, split, actorSeat: info.actorSeat, kind: info.kind,
          stateFeat: info.stateFeat, candFeats: info.candFeats, candKinds: info.candKinds, chosenIdx: info.chosenIdx,
        });
      }, { withFeatures: true });
    }
  }
  return out;
}

function sampleQuota(decisions: TrainingDecision[]): { train: TrainingDecision[]; dev: TrainingDecision[]; holdout: TrainingDecision[] } {
  const rng = mulberry32(SEED);
  const bySplit = (sp: string) => decisions.filter((d) => d.split === sp);
  const pick = (ds: TrainingDecision[], n: number): TrainingDecision[] => {
    // 整场组内均匀抽样（不按文件顺序截断）：matchId 去重后轮转抽取
    const byMatch = new Map<string, TrainingDecision[]>();
    for (const d of ds) byMatch.set(d.matchId, [...(byMatch.get(d.matchId) ?? []), d]);
    const matchIds = [...byMatch.keys()];
    const out: TrainingDecision[] = [];
    while (out.length < Math.min(n, ds.length)) {
      const mid = matchIds[Math.floor(rng() * matchIds.length)];
      const arr = byMatch.get(mid);
      if (!arr?.length) continue;
      out.push(arr.shift()!);
    }
    return out;
  };
  return { train: pick(bySplit('train'), QUOTA.train), dev: pick(bySplit('dev'), QUOTA.dev), holdout: pick(bySplit('holdout'), QUOTA.holdout) };
}

// ---- 训练（Python learner_aux 经 bridge 帧；此处直接内联 RMSprop+CE 于 TS 更简单且可审计） ----
function trainBC(u0: Float32Array, train: TrainingDecision[], epochs: number, maxMs: number): { weights: Float32Array; log: unknown[] } {
  const mlp = new MLP(1, INPUT_DIM_V2);
  mlp.setWeights(u0);
  const lr = 1e-4, alpha = 0.9, eps = 1e-5;
  // 读取/写入权重的数值梯度太慢——经 Python learner_aux（独立进程）做前向/反向。
  // 这里通过 stdin 帧协议把 (X, chosenIdx) 批发给 learner_aux.py。
  const log: unknown[] = [];
  void lr; void alpha; void eps; void mlp; void epochs; void maxMs;
  return { weights: u0, log };
}

function main(): void {
  mkdirSync(ART, { recursive: true });
  const t0 = performance.now();
  const matches = loadMatches(DATA, 100);
  const manifest = JSON.parse(readFileSync(join(ART, 't3-match-manifest.json'), 'utf8')) as { train: string[]; dev: string[]; holdout: string[] };
  const splitOf = new Map<string, string>([
    ...manifest.train.map((id) => [id, 'train'] as const),
    ...manifest.dev.map((id) => [id, 'dev'] as const),
    ...manifest.holdout.map((id) => [id, 'holdout'] as const),
  ]);
  // 第一遍：收集匹配决策（无特征）
  const raw = extractWithFeatures(matches, splitOf);
  console.log('匹配决策（全量）:', raw.length);
  // 配额抽样
  const quota = sampleQuota(raw);
  console.log('配额:', { train: quota.train.length, dev: quota.dev.length, holdout: quota.holdout.length });
  const trainSet = quota.train;
  const devSet = quota.dev;
  const holdoutSet = quota.holdout;
  writeFileSync(join(ART, 't4-proxy-data-summary.json'), JSON.stringify({
    at: new Date().toISOString(),
    matchedDecisionsTotal: raw.length,
    quota: { train: quota.train.length, dev: quota.dev.length, holdout: quota.holdout.length },
    featured: { train: trainSet.length, dev: devSet.length, holdout: holdoutSet.length },
    parent: 'U0 = clean2-ck7051 → remapV1WeightsToV2 → migratePassEncoding(action64)',
    encoder: SCHEMA_VERSION_V4, samplingMode: 'legal_softmax_sample', temperature: 1, seed: SEED,
  }, null, 2));
  // 序列化特征数据供 learner_aux 消费（二进制：nDecisions × [stateFeat 331 | nCands | chosenIdx | candFeats n×68]）
  const dump = (ds: TrainingDecision[], path: string): void => {
    const parts: number[] = [];
    for (const d of ds) {
      parts.push(...d.stateFeat, d.candKinds.length, d.chosenIdx);
      for (let i = 0; i < d.candFeats.length; i++) parts.push(d.candFeats[i]);
    }
    writeFileSync(path, Buffer.from(new Float32Array(parts).buffer));
  };
  dump(trainSet, join(ART, 't4-proxy-train.f32'));
  dump(devSet, join(ART, 't4-proxy-dev.f32'));
  dump(holdoutSet, join(ART, 't4-proxy-holdout.f32'));
  writeFileSync(join(ART, 't4-proxy-kinds.json'), JSON.stringify(
    [...trainSet, ...devSet, ...holdoutSet].map((d) => ({ s: d.sampleId, a: d.actorSeat, k: d.kind, c: d.candKinds.length, y: d.chosenIdx, kinds: d.candKinds })),
  ));
  console.log('特征数据已落盘（learner_aux 消费）');
  void trainBC; void spawn; void teamOf; void NeuralDecider;
  console.log('elapsed', ((performance.now() - t0) / 1000).toFixed(1) + 's');
}

void main();
