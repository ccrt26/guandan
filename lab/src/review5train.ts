/**
 * lab/src/review5train.ts — REVIEW5 T6：异质搭档训练（P 实验，3 对种子 × 2 臂）。
 * 配方（冻结，protocol-v5）：父=U0（clean2→399 rule-context→pass action64）；
 * 编码 gd-lab-schema-v4；候选 cand-suit-v3；y=g+W；RMSprop lr1e-3 α.9 ε1e-5；
 * group=2048（self 1024 / frozen双席 512 / H搭档 256 / 启发式搭档 256），
 * 每组各桶不放回抽半 → 梯度槽 512/256/128/128（=1024，learner TRAIN_SUB=1024）；
 * 未抽中半数逐桶记 subsamplingDiscarded。control 仅 self 桶（2048 抽 1024）。
 * 每 run ≤1200 更新或 30 分钟 active；检查点 0/400/800/1200；六 run 合计 ≤180 分钟。
 * 用法：npx tsx lab/src/review5train.ts --pair 1|2|3 --arm control|treatment [--max-updates N] [--max-active-min M]
 */
import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DEFAULT_RULES } from '@gd/engine';
import {
  createAI, INPUT_DIM_V2, MLP, mulberry32, NeuralDecider, deriveSeed, deriveStepSeed, mergeOrder, agesOf,
  migratePassEncoding, remapV1WeightsToV2, STATE_DIM_V2,
} from '@gd/ai';
import { LearnerBridge } from './bridge';
import { sampleMatchMixed, finalizeSamples, newCounters, sameMoveSemantic, type SeatPolicy, type StrictCounters, ContractError } from './clean1';

const ROOT = join(import.meta.dirname, '..', '..');
const R5 = join(ROOT, 'lab', 'review5');
const ART = join(R5, 'artifacts');
const GROUP = 2048;
const SUB = 1024;
const CKPTS = [0, 400, 800, 1200];
/** 三对种子（事前固定；每对两臂共享基础约定，arm 专用流派生记录） */
const PAIR_BASE = { 1: 2026110101, 2: 2026110201, 3: 2026110301 } as const;

function loadF32(p: string): Float32Array {
  const buf = readFileSync(p);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}
const shaOf = (f: Float32Array): string => createHash('sha256').update(Buffer.from(f.buffer, f.byteOffset, f.length * 4)).digest('hex');

interface Bucket {
  name: 'self' | 'frozen2' | 'hpartner' | 'heurpartner';
  quota: number;       // 每 2048 组配额（成熟样本）
  feats: Float32Array[]; ys: number[];
  subsamplingDiscarded: number;
  matches: number;
}
interface MatchSample { bucket: Bucket['name']; feats: Float32Array[]; ys: number[] }

// ---------- 混合采样 worker ----------
interface MixedMsg {
  type: 'wave'; waveId: number; bucket: Bucket['name']; tasks: number[];
  weights: Float32Array; eps: number; namespace: string; master: number;
  hWeights?: Float32Array; frozenWeights?: Float32Array; matchGameCap: number;
}
process.on('message', (msg: MixedMsg) => {
  if (!msg || msg.type !== 'wave') return;
  const model = new MLP(1, INPUT_DIM_V2);
  model.setWeights(msg.weights);
  const hMlp = msg.hWeights ? (() => { const m = new MLP(1, INPUT_DIM_V2); m.setWeights(msg.hWeights!); return m; })() : null;
  const frozenMlp = msg.frozenWeights ? (() => { const m = new MLP(1, INPUT_DIM_V2); m.setWeights(msg.frozenWeights!); return m; })() : null;
  const counters = newCounters();
  const mkTable = (bucket: Bucket['name'], currentSeat: number): [SeatPolicy, SeatPolicy, SeatPolicy, SeatPolicy] => {
    const cur = { kind: 'current' } as SeatPolicy;
    const frozen = () => ({ kind: 'frozen', mlp: frozenMlp! } as SeatPolicy);
    const table: [SeatPolicy, SeatPolicy, SeatPolicy, SeatPolicy] = [
      { kind: 'heuristic', level: 0 }, { kind: 'heuristic', level: 0 },
      { kind: 'heuristic', level: 0 }, { kind: 'heuristic', level: 0 },
    ];
    table[currentSeat] = cur;
    if (bucket === 'self') {
      return [cur, cur, cur, cur];
    }
    // 非 self 桶：current 单席/双席 + 搭档 + 冻结对手（席位安排：current=0，搭档=2(队友)，对手=1,3）
    if (bucket === 'frozen2') {
      table[2] = cur; table[1] = frozen(); table[3] = frozen();
    } else if (bucket === 'hpartner') {
      table[2] = { kind: 'h_human', mlp: hMlp!, temperature: 1 }; table[1] = frozen(); table[3] = frozen();
    } else {
      table[2] = { kind: 'heuristic', level: 2 }; table[1] = frozen(); table[3] = frozen();
    }
    return table;
  };
  for (const matchId of msg.tasks) {
    const matchSeed = deriveSeed(msg.namespace, msg.master, matchId, 'deal');
    const rand = mulberry32(deriveSeed(msg.namespace, msg.master, matchId, 'explore'));
    try {
      const currentSeat = matchId & 3;
      const table = mkTable(msg.bucket, currentSeat);
      const r = sampleMatchMixed(model, msg.eps, matchSeed, rand, counters, table,
        { schema: 'v2', ctxFill: 'rule-context', passEncoding: 'action64' });
      const n = r.samples.length;
      const feats = new Float32Array(n * INPUT_DIM_V2);
      const ys = new Float32Array(n);
      r.samples.forEach((smp, i) => { feats.set(smp.feat, i * INPUT_DIM_V2); ys[i] = smp.y; });
      process.send!({
        type: 'match', waveId: msg.waveId, bucket: msg.bucket, matchId,
        games: r.games, decisions: r.decisions, capped: r.capped, n, feats, ys,
      });
    } catch (e) {
      process.send!({ type: 'error', waveId: msg.waveId, matchId, message: String(e) });
      return;
    }
  }
});

// ---------- 主进程（直接执行时） ----------
async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const argOf = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (!argv.length || !argOf('pair')) {
    console.error('用法: review5train.ts --pair 1|2|3 --arm control|treatment [--max-updates 1200] [--max-active-min 30]');
    return 2;
  }
  const pair = Number(argOf('pair'));
  const arm = (argOf('arm') ?? 'control') as 'control' | 'treatment';
  const maxUpdates = Number(argOf('max-updates') ?? 1200);
  const maxActiveMs = Number(argOf('max-active-min') ?? 30) * 60000;
  const base = PAIR_BASE[pair as 1 | 2 | 3];
  const armSeed = arm === 'control' ? base : base ^ 0xA11CE; // 同对基础约定，arm 专用流
  const namespace = `r5-p${pair}-${arm}`;
  const runId = `r5-p${pair}-${arm}`;
  const runDir = join(ART, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const ledger = join(runDir, 'runtime_ledger.jsonl');
  const log = (o: Record<string, unknown>): void => appendFileSync(ledger, `${JSON.stringify(o)}\n`);

  // 父/冻结/H 权重
  const u0 = loadF32(join(ART, 'proxy', 'U0.f32'));
  const hWeights = loadF32(join(ART, 'proxy', 'weights.f32'));
  const learner = new LearnerBridge('cpu');
  const model = new MLP(1, INPUT_DIM_V2);
  model.setWeights(u0);
  await learner.init(INPUT_DIM_V2, u0, { run: runId, parentPolicyId: 'U0-clean2-encv4', optimizerReset: true });
  log({ phase: 'train-start', at: new Date().toISOString(), run: runId, pair, arm, parentPolicyId: 'U0(clean2→v2→action64)', weightSHA256: shaOf(u0),
    hPolicyId: 'h_human-bc1(kscb-train60,softmax-t1)', hWeightSHA256: shaOf(hWeights), frozenPoolPolicyId: 'U0',
    encoder: 'gd-lab-schema-v4(rule-context,action64)', candidate: 'cand-suit-v3', maxUpdates, maxActiveMs,
    buckets: arm === 'treatment' ? { self: 1024, frozen2: 512, hpartner: 256, heurpartner: 256 } : { self: 2048 } });

  // 桶
  const mkBucket = (name: Bucket['name'], quota: number): Bucket => ({ name, quota, feats: [], ys: [], subsamplingDiscarded: 0, matches: 0 });
  const buckets: Bucket[] = arm === 'treatment'
    ? [mkBucket('self', 1024), mkBucket('frozen2', 512), mkBucket('hpartner', 256), mkBucket('heurpartner', 256)]
    : [mkBucket('self', 2048)];

  // worker 池（复用 review2train 的动态领任务语义，简化为每桶一波）
  const workers: Array<{ proc: ChildProcess; busy: boolean }> = [];
  const N_WORKERS = 8;
  let waveId = 0, nextMatchId = 0;
  let waveDone: (() => void) | null = null;
  const waveResults = new Map<string, { feats: Float32Array; ys: number }>();
  const counters: StrictCounters = newCounters();
  for (let i = 0; i < N_WORKERS; i++) {
    const proc = fork(new URL(import.meta.url).pathname, [], { cwd: ROOT, execArgv: ['--import', 'tsx'], silent: true, serialization: 'advanced' as never });
    proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[w] ${String(d).slice(0, 200)}`));
    const w = { proc, busy: false };
    proc.on('message', (m: Record<string, unknown>) => {
      if (m.type === 'match') {
        counters.illegalIntent += 0; // 混合采样器内部计数已校验（违例即 throw）
        const bkt = buckets.find((b) => b.name === m.bucket)!;
        const n = m.n as number;
        const feats = new Float32Array(n * INPUT_DIM_V2);
        feats.set(m.feats as Float32Array);
        const ys = new Float32Array(m.ys as Float32Array);
        bkt.feats.push(...Array.from({ length: n }, (_, i) => feats.slice(i * INPUT_DIM_V2, (i + 1) * INPUT_DIM_V2)));
        bkt.ys.push(...Array.from(ys));
        bkt.matches += 1;
      } else if (m.type === 'error') {
        console.error(`worker 违例: ${String(m.message).slice(0, 300)}`);
        process.exit(1);
      }
      w.busy = false;
      if (waveDone && workers.every((x) => !x.busy)) { const f = waveDone; waveDone = null; f(); }
    });
    workers.push(w);
  }
  const runSamplingWave = async (bucketName: Bucket['name'], nMatches: number): Promise<void> => {
    const wid = waveId++;
    const tasks = Array.from({ length: nMatches }, (_, i) => nextMatchId++);
    const queue = [...tasks];
    const dispatch = (w: { proc: ChildProcess; busy: boolean }): void => {
      const t = queue.shift();
      if (t === undefined) return;
      w.busy = true;
      w.proc.send({
        type: 'wave', waveId: wid, bucket: bucketName, tasks: [t], weights: model.getWeights(), eps: 0.05,
        namespace: `${namespace}-sample`, master: armSeed, hWeights, frozenWeights: u0, matchGameCap: 60,
      });
    };
    await new Promise<void>((res) => { waveDone = res; workers.forEach(dispatch); });
  };

  let updates = 0, consumed = 0;
  const t0 = performance.now();
  const activeMs = () => performance.now() - t0;
  const persist = async (tag: string): Promise<void> => {
    const dir = join(runDir, tag);
    mkdirSync(dir, { recursive: true });
    const w = await learner.getWeights();
    writeFileSync(join(dir, 'weights.f32'), Buffer.from(w.buffer, w.byteOffset, w.length * 4));
    await learner.save(dir);
    log({ phase: 'checkpoint', tag, updates, activeMs: Math.round(activeMs()) });
  };
  await persist('ck-0');

  const rng = mulberry32(armSeed ^ 0x5EED);
  let stopReason = 'maxUpdates';
  while (updates < maxUpdates && activeMs() < maxActiveMs - 60000) {
    // 1) 补桶：任何桶不足配额 → 采样该桶直到够
    for (const b of buckets) {
      while (b.ys.length < b.quota) {
        const need = Math.max(8, Math.ceil((b.quota - b.ys.length) / 100));
        await runSamplingWave(b.name, Math.min(need, 32));
        if (activeMs() > maxActiveMs - 60000) { stopReason = 'time'; break; }
      }
      if (stopReason === 'time') break;
    }
    if (stopReason === 'time' || buckets.some((b) => b.ys.length < b.quota)) break;
    // 2) 组装 2048 组：各桶取配额 FIFO
    const feats: Float32Array[] = [], ys: number[] = [];
    for (const b of buckets) {
      for (let i = 0; i < b.quota; i++) { feats.push(b.feats[i]!); ys.push(b.ys[i]!); }
      b.feats.splice(0, b.quota); b.ys.splice(0, b.quota);
    }
    // 3) 各桶不放回抽半（固定 rng；未抽中计数 subsamplingDiscarded）
    const gradFeats: Float32Array[] = [], gradYs: number[] = [];
    const idxBase = feats.length; // 桶顺序已知：按桶段抽取
    let off = 0;
    for (const b of buckets) {
      const half = b.quota / 2;
      const idxs = Array.from({ length: b.quota }, (_, i) => off + i);
      for (let i = idxs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idxs[i], idxs[j]] = [idxs[j], idxs[i]]; }
      for (let i = 0; i < half; i++) { gradFeats.push(feats[idxs[i]]); gradYs.push(ys[idxs[i]]); }
      b.subsamplingDiscarded += half;
      off += b.quota;
    }
    void idxBase;
    // 4) learner 一步（1024 子样本；stepSeed 显式）
    const X = new Float32Array(SUB * INPUT_DIM_V2);
    gradFeats.slice(0, SUB).forEach((f, i) => X.set(f, i * INPUT_DIM_V2));
    const Y = new Float32Array(gradYs.slice(0, SUB));
    const stepSeed = deriveStepSeed(namespace, armSeed, updates);
    const rep = await learner.train(X, Y, Math.min(SUB, gradFeats.length), INPUT_DIM_V2, stepSeed);
    if (rep.nonfinite) throw new Error(`非有限值 @${updates}`);
    updates += 1; consumed += rep.nTrain;
    model.setWeights(await learner.getWeights());
    log({ phase: 'update', updates, loss: +rep.lossBefore.toFixed(4), gradNorm: +rep.gradNorm.toFixed(3), stepSeed });
    for (const c of CKPTS) if (updates === c) await persist(`ck-${c}`);
  }
  workers.forEach((w) => w.proc.kill());
  if (!CKPTS.includes(updates)) await persist(`ck-${updates}`);
  const w = await learner.getWeights();
  log({ phase: 'train-end', stopReason, updates, activeMs: Math.round(activeMs()), consumed,
    buckets: Object.fromEntries(buckets.map((b) => [b.name, { matches: b.matches, subsamplingDiscarded: b.subsamplingDiscarded, remain: b.ys.length }])),
    finalWeightSHA256: shaOf(w) });
  await learner.shutdown();
  console.log(`${runId} 完成: ${stopReason} updates=${updates}/${maxUpdates} active=${(activeMs() / 60000).toFixed(1)}min`);
  return 0;
}

if (process.argv[1] && process.argv[1].includes('review5train') && !process.send) {
  // 主进程模式（worker 被 fork 时不进 main，仅响应 IPC 消息）
  main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
void createAI; void NeuralDecider; void mergeOrder; void agesOf; void finalizeSamples; void sameMoveSemantic; void DEFAULT_RULES; void existsSync;
export { main };
