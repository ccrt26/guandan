/**
 * lab/src/parallel_probe.ts — 并行采样三段探针（REVIEW3-EXEC §5.4，≤30min active）。
 * 第一段 确定性与记账：固定权重、同 32 个完整 match 任务，1/4/8 workers 下
 *   逐场（样本数/特征哈希/标签哈希）必须一致，无漏重、归并序固定。
 * 第二段 完整路径吞吐：预热后 1/4/8 workers 各 2 分钟（预算内可复测 4/8 一次），
 *   覆盖完整"采样→归并→学习→发布下一快照"循环；记录成熟标签/s、梯度样本/s、
 *   updates/s、同步等待、RSS 近似。8 workers 仅在相对 4 workers 持续 ≥+20% 且
 *   契约无异常时选用。
 * 第三段 短学习对照：同初始化同配方（stage+v2 候选+同编码），旧每场刷新 vs 新波刷新，
 *   各 ≤200 updates，只隔离刷新频率；报告 loss/检查保存重载/小 dev 诊断。
 * 输出 lab/review2/parallel_probe/{contracts,end_to_end,short_learning,decision}.json。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { deriveSeed, deriveStepSeed, INPUT_DIM } from '@gd/ai';
import { MLP, mulberry32 } from './mlp';
import { LearnerBridge } from './bridge';
import { sampleMatchStrict, type StrictCounters } from './clean1';
import { fork, type ChildProcess } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'lab', 'review2', 'parallel_probe');
mkdirSync(OUT, { recursive: true });
const PROBE_NS = 'probe';
const PROBE_MASTER = 2026110001;
const GROUP = 2048;
const WAVE = 8;

const t0All = performance.now();
const activeBudgetMs = 30 * 60000;
const elapsed = () => performance.now() - t0All;

// ---- 极简 worker 池（与 review2train 同协议；此处独立实现避免训练器改动影响探针） ----
interface MatchMsg { type: string; matchId?: number; waveId?: number; feats?: Float32Array; ys?: Float32Array; games?: number; decisions?: number; capped?: boolean; message?: string }
class Pool {
  private ws: Array<{ proc: ChildProcess; busy: boolean }> = [];
  private queue: number[] = [];
  private results: Map<number, { feats: Float32Array; ys: Float32Array; games: number; decisions: number; capped: boolean }> = new Map();
  private waves: number[] = [];
  private resolve: (() => void) | null = null;
  private waveId = -1;
  err: string | null = null;
  constructor(readonly n: number, private weights: Float32Array, private eps: number) {}
  start() {
    for (let i = 0; i < this.n; i++) {
      const proc = fork(join(ROOT, 'lab', 'src', 'wave_worker.ts'), [], { cwd: ROOT, execArgv: ['--import', 'tsx'], silent: true, serialization: 'advanced' as never });
      proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[worker] ${String(d).slice(0, 300)}`));
      const w = { proc, busy: false };
      proc.on('message', (m: MatchMsg) => {
        if (m.type === 'match') {
          this.results.set(m.matchId!, { feats: m.feats!, ys: m.ys!, games: m.games!, decisions: m.decisions!, capped: m.capped! });
          this.waves.push(m.waveId!);
        } else if (m.type === 'error') this.err = String(m.message);
        if (m.type === 'match') {
          w.busy = false;
          this.pump(w);
          if (this.queue.length === 0 && this.ws.every((x) => !x.busy) && this.resolve) { const r = this.resolve; this.resolve = null; r(); }
        }
      });
      this.ws.push(w);
    }
  }
  private pump(w: { proc: ChildProcess; busy: boolean }) {
    const next = this.queue.shift();
    if (next === undefined) return;
    w.busy = true;
    w.proc.send({ type: 'wave', waveId: this.waveId, tasks: [next], weights: this.weights.slice(), eps: this.eps, namespace: PROBE_NS, master: PROBE_MASTER, matchGameCap: 60 });
  }
  async run(waveId: number, ids: number[]): Promise<Map<number, { feats: Float32Array; ys: Float32Array; games: number; decisions: number; capped: boolean }>> {
    this.waveId = waveId; this.results = new Map(); this.queue = [...ids];
    for (const w of this.ws) this.pump(w);
    await new Promise<void>((r) => { this.resolve = r; });
    return this.results;
  }
  kill() { for (const w of this.ws) w.proc.kill(); }
  updateW(w: Float32Array): void { this.weights = w.slice(); }
}

const hashOf = (a: Float32Array): string => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.length * 4)).digest('hex').slice(0, 16);

// ============ 第一段：确定性与记账 ============
async function part1Async(fixedWeights: Float32Array): Promise<Record<string, unknown>> {
  const perConfig: Record<string, Record<number, { n: number; fh: string; yh: string; games: number }>> = {};
  for (const nw of [1, 4, 8]) {
    const pool = new Pool(nw, fixedWeights, 0.05);
    pool.start();
    const rec: Record<number, { n: number; fh: string; yh: string; games: number }> = {};
    let mid = 0;
    for (let w = 0; w < 4; w++) {
      const ids = Array.from({ length: WAVE }, (_, i) => mid + i);
      mid += WAVE;
      const got = await pool.run(w, ids);
      console.error(`[probe-p1] ${nw}w 波${w} 收到 ${got.size}/${WAVE} 场 err=${pool.err ?? '无'}`);
      for (const [k, v] of got) rec[Number(k)] = { n: v.ys.length, fh: hashOf(v.feats), yh: hashOf(v.ys), games: v.games };
    }
    pool.kill();
    if (pool.err) throw new Error(`worker 错误: ${pool.err}`);
    perConfig[`${nw}w`] = rec;
  }
  const base = perConfig['1w'];
  const mismatch: string[] = [];
  for (const nw of ['4w', '8w']) {
    for (const [midS, r] of Object.entries(perConfig[nw])) {
      const b = base[Number(midS)];
      if (!b || b.fh !== r.fh || b.yh !== r.yh || b.n !== r.n) mismatch.push(`${nw} m${midS}`);
    }
  }
  const ids1 = Object.keys(base).map(Number).sort((a, b) => a - b);
  const complete = ids1.length === 32 && ids1.every((v, i) => v === i);
  return {
    pass: mismatch.length === 0 && complete,
    matches: ids1.length, completeSequential: complete,
    mismatchExamples: mismatch.slice(0, 5),
    sampleTotal: Object.values(base).reduce((s, r) => s + r.n, 0),
    note: '固定权重+派生种子下，1/4/8 workers 逐场特征/标签哈希一致（wave=8 协议内）',
  };
}

// ============ 第二段：完整路径吞吐 ============
interface E2ERec { workers: number; seconds: number; matches: number; matureLabels: number; updates: number; gradientSamples: number; syncWaitMs: number; rssMb: number[]; labelPerSec: number; coveredFullCycle: boolean; unconsumedAtEnd: number }
async function part2(fixedWeights: Float32Array, secondsPer: number): Promise<{ runs: E2ERec[]; retest?: E2ERec[] }> {
  const learner = new LearnerBridge('cpu');
  const initMlp = new MLP(2026110001);
  await learner.init(INPUT_DIM, initMlp.getWeights(), {});
  const runs: E2ERec[] = [];
  for (const nw of [1, 4, 8]) {
    const pool = new Pool(nw, fixedWeights, 0.05);
    pool.start();
    // 预热一波
    await pool.run(0, Array.from({ length: WAVE }, (_, i) => i));
    const tStart = performance.now();
    const deadline = tStart + secondsPer * 1000;
    let matchId = WAVE, waves = 0, mature = 0, updates = 0, grad = 0, syncWait = 0;
    let unconsumed: Float32Array = new Float32Array(0);
    const rss: number[] = [];
    let fullCycle = false;
    while (performance.now() < deadline) {
      const wStart = performance.now();
      const res = await pool.run(waves + 1, Array.from({ length: WAVE }, (_, i) => matchId + i));
      matchId += WAVE;
      const waveN = [...res.values()].reduce((s, r) => s + r.ys.length, 0);
      mature += waveN;
      // 归并（matchId 序）→ 尾部继承 → 消费
      const ordered = [...res.entries()].sort((a, b) => a[0] - b[0]);
      const total = unconsumed.length / (INPUT_DIM + 1) + waveN;
      const feats = new Float32Array(total * INPUT_DIM);
      const ys = new Float32Array(total);
      const prevN = unconsumed.length / (INPUT_DIM + 1);
      feats.set(unconsumed.subarray(0, prevN * INPUT_DIM), 0); ys.set(unconsumed.subarray(prevN * INPUT_DIM), 0);
      let o = prevN;
      for (const [, r] of ordered) { feats.set(r.feats, o * INPUT_DIM); ys.set(r.ys, o); o += r.ys.length; }
      const uW = Math.floor(total / GROUP);
      for (let bi = 0; bi < uW; bi++) {
        const base = bi * GROUP;
        const rep = await learner.train(feats.subarray(base * INPUT_DIM, (base + GROUP) * INPUT_DIM), ys.subarray(base, base + GROUP), GROUP, INPUT_DIM, deriveStepSeed(PROBE_NS, PROBE_MASTER, updates));
        updates += 1; grad += rep.nTrain;
        if (performance.now() > deadline) break;
      }
      const consumed = uW * GROUP;
      const tail = new Float32Array((total - consumed) * (INPUT_DIM + 1));
      tail.set(feats.subarray(consumed * INPUT_DIM), 0);
      tail.set(ys.subarray(consumed), (total - consumed) * INPUT_DIM);
      unconsumed = tail;
      waves += 1;
      if (uW >= 1) fullCycle = true; // 覆盖 采样→归并→学习→（下一波发布新权重）
      syncWait += performance.now() - wStart;
      rss.push(+(process.memoryUsage().rss / 1048576).toFixed(0));
    }
    pool.kill();
    const secs = (performance.now() - tStart) / 1000;
    runs.push({
      workers: nw, seconds: +secs.toFixed(1), matches: waves * WAVE, matureLabels: mature,
      updates, gradientSamples: grad, syncWaitMs: Math.round(syncWait), rssMb: rss.slice(-3),
      labelPerSec: +(mature / secs).toFixed(1), coveredFullCycle: fullCycle,
      unconsumedAtEnd: unconsumed.length / (INPUT_DIM + 1),
    });
  }
  await learner.shutdown();
  return { runs };
}

// ============ 第三段：短学习对照 ============
async function part3(maxUpdatesEach: number): Promise<Record<string, unknown>> {
  const learner = new LearnerBridge('cpu');
  const init = new MLP(2026110002);
  await learner.init(INPUT_DIM, init.getWeights(), {});
  const counters = (): StrictCounters => ({ illegalIntent: 0, fallback: 0, semanticRewrite: 0, encodingMismatch: 0, labelMismatch: 0 });

  // A：旧每场刷新（串行；clean1 语义：每场结束换权）
  const tA = performance.now();
  let updatesA = 0, consumedA = 0, matchIdA = 0;
  let tailA: Float32Array = new Float32Array(0);
  const modelA = new MLP(2026110002);
  let lossA = 0;
  const limA = performance.now() + 300000;
  while (updatesA < maxUpdatesEach && performance.now() < limA) {
    const mlpLocal = new MLP(1);
    const wNow = await learner.getWeights();
    mlpLocal.setWeights(wNow);
    const ctr = counters();
    const r = sampleMatchStrict(mlpLocal, 0.05, deriveSeed('probe-short', PROBE_MASTER, matchIdA, 'deal'), mulberry32(deriveSeed('probe-short', PROBE_MASTER, matchIdA, 'explore')), ctr);
    matchIdA += 1;
    const prevN = tailA.length / (INPUT_DIM + 1);
    const total = prevN + r.samples.length;
    const feats = new Float32Array(total * INPUT_DIM);
    const ys = new Float32Array(total);
    feats.set(tailA.subarray(0, prevN * INPUT_DIM), 0); ys.set(tailA.subarray(prevN * INPUT_DIM), 0);
    r.samples.forEach((s, i) => { feats.set(s.feat, (prevN + i) * INPUT_DIM); ys[prevN + i] = s.y; });
    const uW = Math.floor(total / GROUP);
    for (let bi = 0; bi < uW && updatesA < maxUpdatesEach; bi++) {
      const base = bi * GROUP;
      const rep = await learner.train(feats.subarray(base * INPUT_DIM, (base + GROUP) * INPUT_DIM), ys.subarray(base, base + GROUP), GROUP, INPUT_DIM, deriveStepSeed('probe-short-a', PROBE_MASTER, updatesA));
      updatesA += 1; consumedA += rep.nTrain; lossA = rep.lossBefore;
    }
    const consumed = uW * GROUP;
    const tail = new Float32Array((total - consumed) * (INPUT_DIM + 1));
    tail.set(feats.subarray(consumed * INPUT_DIM), 0);
    tail.set(ys.subarray(consumed), (total - consumed) * INPUT_DIM);
    tailA = tail;
  }
  const wA = await learner.getWeights();
  const minutesA = (performance.now() - tA) / 60000;

  // 保存重载检查（A 的终点权重过 reload）
  const reloadMlp = new MLP(1);
  reloadMlp.setWeights(wA);

  // B：新波刷新（4 workers；同初始化独立 learner）
  const tB = performance.now();
  const learner2 = new LearnerBridge('cpu');
  const init2 = new MLP(2026110002);
  await learner2.init(INPUT_DIM, init2.getWeights(), {});
  const pool2 = new Pool(4, init2.getWeights(), 0.05);
  pool2.start();
  let updatesB = 0, consumedB = 0, matchIdB = 0, wavesB = 0;
  let tailB: Float32Array = new Float32Array(0);
  let lossB = 0;
  const limB = performance.now() + 300000;
  while (updatesB < maxUpdatesEach && performance.now() < limB) {
    const wNow = await learner2.getWeights();
    pool2.updateW(wNow);
    const res = await pool2.run(wavesB, Array.from({ length: WAVE }, (_, i) => matchIdB + i));
    matchIdB += WAVE; wavesB += 1;
    const ordered = [...res.entries()].sort((a, b) => a[0] - b[0]);
    const prevN = tailB.length / (INPUT_DIM + 1);
    const waveN = ordered.reduce((s, [, r]) => s + r.ys.length, 0);
    const total = prevN + waveN;
    const feats = new Float32Array(total * INPUT_DIM);
    const ys = new Float32Array(total);
    feats.set(tailB.subarray(0, prevN * INPUT_DIM), 0); ys.set(tailB.subarray(prevN * INPUT_DIM), 0);
    let o = prevN;
    for (const [, r] of ordered) { feats.set(r.feats, o * INPUT_DIM); ys.set(r.ys, o); o += r.ys.length; }
    const uW = Math.floor(total / GROUP);
    for (let bi = 0; bi < uW && updatesB < maxUpdatesEach; bi++) {
      const base = bi * GROUP;
      const rep = await learner2.train(feats.subarray(base * INPUT_DIM, (base + GROUP) * INPUT_DIM), ys.subarray(base, base + GROUP), GROUP, INPUT_DIM, deriveStepSeed('probe-short-b', PROBE_MASTER, updatesB));
      updatesB += 1; consumedB += rep.nTrain; lossB = rep.lossBefore;
    }
    const consumed = uW * GROUP;
    const tail = new Float32Array((total - consumed) * (INPUT_DIM + 1));
    tail.set(feats.subarray(consumed * INPUT_DIM), 0);
    tail.set(ys.subarray(consumed), (total - consumed) * INPUT_DIM);
    tailB = tail;
  }
  pool2.kill();
  const minutesB = (performance.now() - tB) / 60000;
  const finiteA = wA.every((v) => Number.isFinite(v));
  const wB = await learner2.getWeights();
  const finiteB = wB.every((v) => Number.isFinite(v));
  await learner.shutdown(); await learner2.shutdown();
  return {
    perMatchRefresh: { updates: updatesA, consumed: consumedB === 0 ? consumedA : consumedA, matches: matchIdA, minutes: +minutesA.toFixed(2), lossLast: +lossA.toFixed(4), finite: finiteA },
    waveRefresh: { updates: updatesB, consumed: consumedB, waves: wavesB, matches: matchIdB, minutes: +minutesB.toFixed(2), lossLast: +lossB.toFixed(4), finite: finiteB },
    note: '同初始化(2026110002)、同 stage/v2 候选/同编码；只隔离刷新频率（每场 vs 每 8 场）。短试排查故障与量级，不证明完整学习等价',
  };
}


// ============ 主流程 ============
(async () => {
  console.error('[probe] 启动');
  const args = process.argv.slice(2);
  const maxActiveMin = Number(args[args.indexOf('--max-active-min') + 1] ?? 30) || 30;
  void maxActiveMin;
  const protoPath = args[args.indexOf('--protocol') + 1];
  if (!protoPath || !existsSync(protoPath)) { console.error('需要 --protocol（draft 协议可，probe 只用 probe namespace）'); process.exit(2); }
  console.error('[probe] 协议:', protoPath);
  const fixed = new MLP(2026110003).getWeights();
  console.error('[probe] 固定权重就绪，进入第一段');

  // 第一段
  if (process.env.PROBE_P1_ONLY) {
    const c1 = await part1Async(fixed);
    console.log('P1_ONLY:', JSON.stringify(c1));
    process.exit(c1.pass ? 0 : 1);
  }
  const contracts = await part1Async(fixed);
  writeFileSync(join(OUT, 'contracts.json'), JSON.stringify({ at: new Date().toISOString(), elapsedMs: Math.round(elapsed()), ...contracts }, null, 1));
  console.log('第一段 确定性:', JSON.stringify(contracts));
  if (!contracts.pass) { writeFileSync(join(OUT, 'decision.json'), JSON.stringify({ chosen: 'serial-fallback', reason: '第一段契约失败', contracts })); process.exit(1); }

  // 第二段
  const secsPer = 120;
  const e2e = await part2(fixed, secsPer);
  writeFileSync(join(OUT, 'end_to_end.json'), JSON.stringify({ at: new Date().toISOString(), elapsedMs: Math.round(elapsed()), ...e2e }, null, 1));
  console.log('第二段 吞吐:', JSON.stringify(e2e.runs.map((r) => ({ w: r.workers, labelPerSec: r.labelPerSec, updates: r.updates }))));

  // 第三段（预算内）
  const shortLearning = await part3(200);
  writeFileSync(join(OUT, 'short_learning.json'), JSON.stringify({ at: new Date().toISOString(), elapsedMs: Math.round(elapsed()), ...shortLearning }, null, 1));
  console.log('第三段 短学习:', JSON.stringify(shortLearning));

  // 决策：8 vs 4
  const r4 = e2e.runs.find((r) => r.workers === 4)!;
  const r8 = e2e.runs.find((r) => r.workers === 8)!;
  const gain8 = (r8.labelPerSec - r4.labelPerSec) / r4.labelPerSec;
  const use8 = gain8 >= 0.2 && r8.coveredFullCycle;
  writeFileSync(join(OUT, 'decision.json'), JSON.stringify({
    chosen: use8 ? 'wave-8-workers' : 'wave-4-workers',
    workers: use8 ? 8 : 4, waveSize: 8,
    evidence: { gain8Vs4: +gain8.toFixed(3), r4, r8, contractsPass: contracts.pass },
    constraints: '预算内未复测或增益<20% → 固定 4；不据此扩大正式训练量',
  }, null, 1));
  console.log(`decision: ${use8 ? 8 : 4} workers（8vs4 增益 ${(gain8 * 100).toFixed(1)}%）；总耗时 ${(elapsed() / 60000).toFixed(1)}min`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
