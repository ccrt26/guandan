/**
 * lab/src/review2train.ts — wave 并行训练 + dev/confirm 评测（REVIEW3-EXEC §5/§6/§11）。
 *   npx tsx lab/src/review2train.ts train --run clean2-main --max-active-min 228 --protocol F [--from P]
 *   npx tsx lab/src/review2train.ts evaluate --run clean2-main --split dev [--lock-candidate] --protocol F
 *   npx tsx lab/src/review2train.ts evaluate --run clean2-main --split confirm-attempt1 --protocol F
 *
 * 训练（§5.2 同步波 DMC）：常驻 worker 池 + 单 Python CPU learner；waveSize=8；
 * 一波共享不可变权重快照；worker 动态领任务（与 worker 数无关的任务列表/随机流）；
 * 整波按 matchId 归并 → 扁平流（tailFeats/tailYs/tailWave 继承）→ 顺序切 2048 块
 * → 每块一次 RMSprop（learner 内 trainSub=1024；stepSeed=deriveStepSeed(namespace,master,updateId)）；
 * 行为版本年龄逐更新记账（含跨波尾部）；检查点 500/1800/3600/5400/7051 精确保存
 * （权重+优化器+可恢复状态）；active 计时含采样/学习/IPC/等待/保存；dev 评测另计预算。
 * 停止：updates≥maxUpdates 或 active≥maxActiveMs−90s 余量。严格契约违例→报错退出
 * （由上层回退 clean1 串行路径），不静默改写。
 */
import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createMatch, DEFAULT_RULES, startGame, applyMove, RNG, type Combo } from '@gd/engine';
import { createAI, NeuralDecider, isMoveLegal, guardMove, INPUT_DIM, INPUT_DIM_V2, remapV1WeightsToV2, deriveSeed, deriveStepSeed, waveTasks, mergeOrder, agesOf, mulberry32 } from '@gd/ai';
import { MLP } from './mlp';
import { LearnerBridge } from './bridge';

/** REVIEW5 T0.5：从可运行快照启动时（run.mjs 设 GD_SNAPSHOT_DIR/GD_R2），
 *  ROOT=快照根（import 解析走快照 node_modules/@gd/*），R2 仍指向真实 runs 目录
 *  （快照树内不写运行产物）；训练来源=快照文件，train-start 记 loadedSources。 */
const ROOT = join(import.meta.dirname, '..', '..');
const SNAPSHOT_DIR = process.env.GD_SNAPSHOT_DIR;
const R2 = process.env.GD_R2 ?? join(ROOT, 'lab', 'review2');
const GROUP = 2048;
const ALLOWED_RUNS = new Set(['clean2-main', 'clean2-replica', 'pool-control', 'pool-mixture', 'bc-control', 'bc-assisted',
  'review4-control', 'review4-treatment', 'r5-resume-probe', 'r5-snapshot-probe']);

interface Protocol {
  protocolVersion: string; frozenAt: string; sourceSnapshot: Record<string, string>;
  trainer: { workers: number; waveSize: number; maxUpdates: number; epsilon: number; checkpointUpdates: number[]; matchGameCap: number;
    /** REVIEW4-F：新检查点/预算/编码（protocol-v4） */
    maxNewUpdatesPerArm?: number; maxActiveMsPerArm?: number; checkpoints?: number[] };
  seeds: { namespaces: Record<string, number> };
  arms?: Record<string, { parents: string; contextFill: string }>;
  encoder?: { version: string; dims: { input: number; state: number; action: number }; controlFill: string; treatmentFill: string };
  effectiveRunConfig: Record<string, Record<string, number | string>>;
  referenceWeights: { sha256: string; policyId: string };
}

interface MatchResult {
  matchId: number; waveId: number; games: number; decisions: number; capped: boolean;
  feats: Float32Array; ys: Float32Array;
}

function loadProtocol(p: string): Protocol {
  if (!existsSync(p)) throw new Error(`协议不存在: ${p}（先 freeze）`);
  const proto = JSON.parse(readFileSync(p, 'utf8')) as Protocol & { draft?: boolean };
  if (proto.draft) throw new Error('协议为 draft——正式 train 拒绝（先以探针 decision 冻结正式协议）');
  if (!proto.frozenAt || !proto.sourceSnapshot) throw new Error('协议非冻结态');
  return proto;
}

function loadWeightsInto(mlp: MLP, path: string): void {
  const buf = readFileSync(path);
  mlp.setWeights(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
}

// ---------- worker 池（动态领任务） ----------
/** REVIEW5 T0.3：worker 汇报计数改为逐场增量（旧实现取最后一条 worker 的累计值覆盖，
 *  跨 worker 求和缺失——五项全零的审计口径不完整） */
function addCounters(a: WorkerCounters, b: Partial<WorkerCounters>): WorkerCounters {
  return {
    illegalIntent: a.illegalIntent + (b.illegalIntent ?? 0),
    fallback: a.fallback + (b.fallback ?? 0),
    semanticRewrite: a.semanticRewrite + (b.semanticRewrite ?? 0),
    encodingMismatch: a.encodingMismatch + (b.encodingMismatch ?? 0),
    labelMismatch: a.labelMismatch + (b.labelMismatch ?? 0),
  };
}
type WorkerCounters = { illegalIntent: number; fallback: number; semanticRewrite: number; encodingMismatch: number; labelMismatch: number };

class WorkerPool {
  private workers: Array<{ proc: ChildProcess; busy: boolean }> = [];
  private queue: number[] = [];
  private results: MatchResult[] = [];
  private resolveWave: (() => void) | null = null;
  private waveId = -1;
  counters: WorkerCounters = { illegalIntent: 0, fallback: 0, semanticRewrite: 0, encodingMismatch: 0, labelMismatch: 0 };
  deadWorkers = 0;
  constructor(
    readonly n: number,
    private weights: Float32Array,
    private cfg: { eps: number; namespace: string; master: number; matchGameCap: number;
      schema?: 'v1' | 'v2'; ctxFill?: 'zero' | 'rule-context'; inputDim?: number; passEncoding?: 'legacy-phys10' | 'action64' },
  ) {}
  start(): void {
    const workerPath = join(ROOT, 'lab', 'src', 'wave_worker.ts');
    for (let i = 0; i < this.n; i++) {
      const proc = fork(workerPath, [], { cwd: ROOT, execArgv: ['--import', 'tsx'], silent: true, serialization: 'advanced' as never });
      proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[worker] ${String(d).slice(0, 300)}`));
      const w = { proc, busy: false };
      proc.on('message', (msg: Record<string, unknown>) => this.onMsg(w, msg));
      proc.on('exit', () => { this.deadWorkers += 1; });
      this.workers.push(w);
    }
  }
  private onMsg(w: { proc: ChildProcess; busy: boolean }, msg: Record<string, unknown>): void {
    if (msg.type === 'match') {
      this.results.push(msg as unknown as MatchResult);
      this.counters = addCounters(this.counters, msg.counters as Partial<WorkerCounters>);
    } else if (msg.type === 'error') {
      throw new Error(`worker 严格契约违例（matchId=${String(msg.matchId)}）: ${String(msg.message).slice(0, 400)}`);
    }
    if (msg.type === 'match' || msg.type === 'done') {
      w.busy = false;
      this.dispatch(w);
      if (this.queue.length === 0 && this.workers.every((x) => !x.busy) && this.resolveWave) {
        const r = this.resolveWave; this.resolveWave = null; r();
      }
    }
  }
  private dispatch(w: { proc: ChildProcess; busy: boolean }): void {
    const next = this.queue.shift();
    if (next === undefined || w.proc.killed || !w.proc.connected) return;
    w.busy = true;
    w.proc.send({ type: 'wave', waveId: this.waveId, tasks: [next], weights: this.weights.slice(), ...this.cfg });
  }
  async runWave(waveId: number, nextMatchId: number, waveSize: number): Promise<MatchResult[]> {
    this.waveId = waveId; this.results = [];
    this.queue = waveTasks(nextMatchId, waveSize);
    for (const w of this.workers) this.dispatch(w);
    await new Promise<void>((res) => { this.resolveWave = res; });
    return mergeOrder(this.results) as MatchResult[];
  }
  updateWeights(w: Float32Array): void { this.weights = w.slice(); }
  kill(): void { for (const w of this.workers) w.proc.kill(); }
}

// ---------- train ----------
async function train(args: { run: string; maxActiveMin: number; protocolPath: string; from?: string }): Promise<number> {
  if (!ALLOWED_RUNS.has(args.run)) { console.error(`run 名不在允许清单: ${args.run}`); return 2; }
  const proto = loadProtocol(args.protocolPath);
  const isReview4 = args.run.startsWith('review4-');
  // REVIEW5 T0.5：可运行快照契约——启动即校验快照清单全量 hash（快照模式）或实时 hash 门（旧模式）
  let loadedSources: Array<{ file: string; sha256: string; realpathInsideSnapshot: boolean | 'n/a' }> | null = null;
  let snapshotSums: Record<string, string> | null = null;
  if (SNAPSHOT_DIR) {
    const sumsPath = join(SNAPSHOT_DIR, 'SHA256SUMS.json');
    if (!existsSync(sumsPath)) { console.error(`快照清单缺失: ${sumsPath}`); return 4; }
    snapshotSums = JSON.parse(readFileSync(sumsPath, 'utf8')) as Record<string, string>;
    loadedSources = [];
    const snapReal = realpathSync(SNAPSHOT_DIR) + sep;
    for (const [f, h] of Object.entries(snapshotSums)) {
      const fp = join(SNAPSHOT_DIR, f);
      if (!existsSync(fp) || createHash('sha256').update(readFileSync(fp)).digest('hex') !== h) {
        console.error(`快照文件缺失或 hash 不符: ${f}`); return 4;
      }
      // realpath 必须落在快照树内（不得绕回实时目录；node_modules/@gd/* 为快照内相对链接）
      const inside = realpathSync(fp).startsWith(snapReal);
      if (!inside) { console.error(`快照文件 realpath 绕回实时目录: ${f}`); return 4; }
      loadedSources.push({ file: f, sha256: h, realpathInsideSnapshot: inside });
    }
  }
  const eff = (proto.effectiveRunConfig?.[args.run] ?? {}) as Record<string, number | string>;
  const maxUpdates = isReview4
    ? (proto.trainer.maxNewUpdatesPerArm ?? eff.newMaxUpdates ?? 1800)
    : (eff.newMaxUpdates ?? eff.dmcMaxUpdates ?? proto.trainer.maxUpdates);
  const maxActiveMs = isReview4
    ? (proto.trainer.maxActiveMsPerArm ?? Math.round(args.maxActiveMin * 60000))
    : (eff.newMaxActiveMs ?? Math.round(args.maxActiveMin * 60000));
  const eps = proto.trainer.epsilon;
  const waveSize = proto.trainer.waveSize;
  const ns = proto.seeds.namespaces;
  const initSeed = args.run === 'clean2-replica' ? ns['replica-init']
    : args.run === 'review4-control' ? ns['f-control-init']
      : args.run === 'review4-treatment' ? ns['f-treatment-init'] : ns['main-init'];
  const master = args.run === 'clean2-replica' ? ns['replica-train']
    : args.run === 'review4-control' ? ns['f-control-train']
      : args.run === 'review4-treatment' ? ns['f-treatment-train'] : ns['main-train'];
  const namespace = `${args.run}-train`;
  // REVIEW4-F：两臂编码=v2 399；ctxFill 由 arm 决定（control=zero / treatment=rule-context）
  const armSchema: 'v1' | 'v2' = isReview4 ? 'v2' : 'v1';
  const armCtxFill: 'zero' | 'rule-context' = args.run === 'review4-treatment' ? 'rule-context' : 'zero';
  const inputDim = isReview4 ? INPUT_DIM_V2 : INPUT_DIM;
  if (isReview4) {
    // 加载源校验：快照模式=快照清单必须与协议 sourceSnapshot 逐文件一致（实时目录允许漂移）；
    // 旧模式（无快照）=实时文件 hash 必须与协议快照一致
    const mismatch: string[] = [];
    const baseDir = SNAPSHOT_DIR ?? ROOT;
    for (const [f, h] of Object.entries(proto.sourceSnapshot ?? {})) {
      const p2 = join(baseDir, f);
      if (!existsSync(p2) || createHash('sha256').update(readFileSync(p2)).digest('hex') !== h) mismatch.push(f);
    }
    if (mismatch.length > 0) {
      console.error(`${SNAPSHOT_DIR ? '快照清单' : '实时源码'}与冻结协议不一致（拒跑）: ${mismatch.join(', ')}`); return 4;
    }
    // 启动即打印并校验 effectiveRunConfig（REVIEW4 §4.6：不继承旧 7051 默认）
    const effRunConfig = { run: args.run, schema: armSchema, ctxFill: armCtxFill, inputDim, maxNewUpdates: maxUpdates, maxActiveMs, checkpoints: proto.trainer.checkpoints ?? [0, 600, 1200, 1800], parent: proto.arms?.[args.run]?.parents ?? args.from, namespace, initSeed, master, optimizerReset: '两臂 RMSprop 同初始重建（不继承父动量）' };
    console.log('effectiveRunConfig:', JSON.stringify(effRunConfig));
    if (maxUpdates !== 1800 || maxActiveMs !== 3600000) {
      console.error(`effectiveRunConfig 校验失败：期望 1800 更新/60min，实为 ${maxUpdates}/${maxActiveMs}`); return 4;
    }
  }

  const runDir = join(R2, 'runs', args.run);
  mkdirSync(runDir, { recursive: true });
  mkdirSync(join(runDir, 'waves'), { recursive: true });
  const ledgerPath = join(runDir, 'runtime_ledger.jsonl');
  const log = (obj: Record<string, unknown>) => appendFileSync(ledgerPath, `${JSON.stringify(obj)}\n`);

  // REVIEW5 T0.4/T0.5：训练配置声明 passEncoding（旧 run 兼容 legacy；新 run 必须显式）
  const passEncoding = ((): 'legacy-phys10' | 'action64' => {
    const declared = (proto.encoder as { passEncoding?: 'legacy-phys10' | 'action64' } | undefined)?.passEncoding;
    return declared ?? 'legacy-phys10';
  })();

  const learner = new LearnerBridge('cpu');
  const model = new MLP(1, inputDim);
  let updates = 0, consumed = 0, pausedActiveMs = 0, nextMatchId = 0, waveCount = 0, parentCumUpdates = 0;
  let tailFeats = new Float32Array(0), tailYs = new Float32Array(0), tailWave: number[] = [];
  const updatesAtWaveEnd = new Map<number, number>();
  const checkpointsHit = new Set<number>();

  const statePath = join(runDir, 'state.json');
  if (existsSync(statePath)) {
    const st = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    // REVIEW5 T0.2：编码契约——恢复时 passEncoding 必须一致（旧 state 无字段视为 legacy）
    const stEnc = (st.passEncoding as 'legacy-phys10' | 'action64' | undefined) ?? 'legacy-phys10';
    if (stEnc !== passEncoding) {
      console.error(`恢复拒绝：state.passEncoding=${stEnc} 与协议 ${passEncoding} 不一致（不允许中途换编码）`);
      return 4;
    }
    const stInputDim = st.inputDim as number;
    if (stInputDim !== inputDim) {
      console.error(`恢复拒绝：state.inputDim=${stInputDim} != ${inputDim}`);
      return 4;
    }
    loadWeightsInto(model, join(runDir, 'current', 'weights.f32'));
    await learner.init(inputDim, model.getWeights(), {});
    const loaded = await learner.loadOpt(join(runDir, 'current', 'resume.pt'));
    if (!loaded.ok) throw new Error(`恢复优化器失败: ${String(loaded.error)}`);
    const tailLen = st.tailLen as number;
    const tailBin = readFileSync(join(runDir, 'tail.bin'));
    tailFeats = new Float32Array(tailBin.buffer.slice(0, tailLen * inputDim * 4));
    tailYs = new Float32Array(tailBin.buffer.slice(tailLen * inputDim * 4, tailLen * (inputDim + 1) * 4));
    tailWave = st.tailWave as number[];
    updates = st.updates as number; consumed = st.consumed as number;
    pausedActiveMs = st.activeMs as number; nextMatchId = st.nextMatchId as number;
    waveCount = st.waveCount as number; parentCumUpdates = st.parentCumUpdates as number;
    for (const [k, v] of Object.entries(st.updatesAtWaveEnd as Record<string, number>)) updatesAtWaveEnd.set(Number(k), v);
    for (const c of st.checkpointsHit as number[]) checkpointsHit.add(c);
    console.log(`恢复：updates=${updates} nextMatchId=${nextMatchId} active=${(pausedActiveMs / 60000).toFixed(1)}min tail=${tailYs.length}`);
  } else if (isReview4) {
    // REVIEW4-F：父=clean2 ck-7051（v1 385）→ v2 399 列重映射（新 14 列零）；
    // 两臂 RMSprop 同初始重建（learner.init 即新建优化器——不 loadOpt，协议声明与父继续不同）
    const fromPath = args.from ?? proto.arms?.[args.run]?.parents;
    if (!fromPath || !existsSync(fromPath)) throw new Error(`review4 臂需要 --from parent.json（${String(fromPath)}）`);
    const parent = JSON.parse(readFileSync(fromPath, 'utf8')) as { weightsPath: string; optPath?: string; cumUpdates: number; policyId?: string; weightSHA256?: string };
    const v1 = new MLP(1, INPUT_DIM);
    loadWeightsInto(v1, parent.weightsPath);
    const sha = createHash('sha256').update(readFileSync(parent.weightsPath)).digest('hex');
    if (parent.weightSHA256 && parent.weightSHA256 !== sha) throw new Error(`父权重 SHA 不符：${sha}`);
    model.setWeights(remapV1WeightsToV2(v1.getWeights()));
    await learner.init(inputDim, model.getWeights(), { arm: args.run, parentPolicyId: parent.policyId ?? 'unknown', optimizerReset: true });
    parentCumUpdates = parent.cumUpdates ?? 0;
    log({ phase: 'parent-loaded', from: fromPath, parentCumUpdates, parentWeightSHA256: sha, remapTo: inputDim, note: 'v1→v2 列重映射（新 14 列零）；两臂优化器同初始重建' });
  } else if (args.from) {
    const parent = JSON.parse(readFileSync(args.from, 'utf8')) as { weightsPath: string; optPath: string; cumUpdates: number };
    loadWeightsInto(model, parent.weightsPath);
    await learner.init(INPUT_DIM, model.getWeights(), {});
    const loaded = await learner.loadOpt(parent.optPath);
    if (!loaded.ok) throw new Error(`父优化器恢复失败: ${String(loaded.error)}`);
    parentCumUpdates = parent.cumUpdates;
  } else {
    const init = new MLP(initSeed, inputDim);
    model.setWeights(init.getWeights());
    await learner.init(inputDim, model.getWeights(), {});
  }
  log({ phase: 'train-start', at: new Date().toISOString(), run: args.run, protocol: proto.protocolVersion, parentCumUpdates, maxUpdates, maxActiveMs, workers: proto.trainer.workers, waveSize, eps, namespace, initSeed, master, resume: updates > 0, schema: armSchema, ctxFill: armCtxFill, inputDim, passEncoding,
    runFrom: SNAPSHOT_DIR ? 'runnable-snapshot' : 'live-tree',
    entryRealpath: process.argv[1] ? realpathSync(process.argv[1]) : null,
    workerPath: join(ROOT, 'lab', 'src', 'wave_worker.ts'),
    learnerScript: join(ROOT, 'lab', 'learner.py'),
    loadedSources: loadedSources ?? Object.entries(proto.sourceSnapshot ?? {}).map(([f, h]) => ({ file: f, sha256: h, realpathInsideSnapshot: 'live-tree' as const })),
    loadedSourcesCount: loadedSources ? loadedSources.length : Object.keys(proto.sourceSnapshot ?? {}).length });

  const pool = new WorkerPool(proto.trainer.workers, model.getWeights(), { eps, namespace, master, matchGameCap: proto.trainer.matchGameCap, schema: armSchema, ctxFill: armCtxFill, inputDim, passEncoding });
  pool.start();
  const t0 = performance.now();
  const activeMsNow = () => pausedActiveMs + (performance.now() - t0);

  /** REVIEW5 T0.4：波前沿持久化——每波结束写 current（权重+优化器+尾部+游标），
   *  有限断点恢复不重放已学更新、不丢尾部、不重置预算（activeMs 累计）。 */
  const persistCurrent = async (atUpdates: number): Promise<void> => {
    mkdirSync(join(runDir, 'current'), { recursive: true });
    const w = await learner.getWeights();
    writeFileSync(join(runDir, 'current', 'weights.f32'), Buffer.from(w.buffer, w.byteOffset, w.length * 4));
    await learner.save(join(runDir, 'current'));
    writeFileSync(join(runDir, 'tail.bin'), Buffer.concat([
      Buffer.from(tailFeats.buffer, tailFeats.byteOffset, tailFeats.length * 4),
      Buffer.from(tailYs.buffer, tailYs.byteOffset, tailYs.length * 4),
    ]));
    writeFileSync(statePath, JSON.stringify({
      updates: atUpdates, consumed, activeMs: Math.round(activeMsNow()), nextMatchId, waveCount,
      tailLen: tailYs.length, tailWave, updatesAtWaveEnd: Object.fromEntries(updatesAtWaveEnd),
      checkpointsHit: [...checkpointsHit], parentCumUpdates,
      schema: armSchema, ctxFill: armCtxFill, inputDim, passEncoding,
    }, null, 1));
  };

  const saveState = async (tag: string, atUpdates: number) => {
    const dir = join(runDir, tag);
    mkdirSync(dir, { recursive: true });
    const w = await learner.getWeights();
    writeFileSync(join(dir, 'weights.f32'), Buffer.from(w.buffer, w.byteOffset, w.length * 4));
    await learner.save(dir);
    await persistCurrent(atUpdates);
    log({ phase: 'checkpoint', tag, updates: atUpdates, activeMs: Math.round(activeMsNow()), tailLen: tailYs.length });
  };

  const checkpoints = (isReview4 ? (proto.trainer.checkpoints ?? [600, 1200, 1800]) : proto.trainer.checkpointUpdates).filter((c) => c > updates && c <= maxUpdates);
  let stopReason = 'maxUpdates';
  // REVIEW4-F：U0 = ck-0（零新增训练的父重映射包；两臂相同初始化 → 权重应逐字节一致）
  if (isReview4 && updates === 0) { checkpointsHit.add(0); await saveState('ck-0', 0); }

  // REVIEW5 T0.4：异常中断路径也写真实账目（持久化现场后原样上抛）
  try {
    waveLoop: while (true) {
      if (updates >= maxUpdates) break;
      if (activeMsNow() > maxActiveMs - 90000) { stopReason = 'time'; break; }
      const waveId = waveCount;
      const results = await pool.runWave(waveId, nextMatchId, waveSize);
      // 波次临时文件（有界、消费后删；崩溃时可按文件恢复）
      for (const r of results) {
        writeFileSync(join(runDir, 'waves', `w${waveId}-m${r.matchId}.bin`), Buffer.concat([
          Buffer.from(r.feats.buffer, r.feats.byteOffset, r.feats.length * 4),
          Buffer.from(r.ys.buffer, r.ys.byteOffset, r.ys.length * 4),
        ]));
      }
      // 扁平归并流：tail 继承 + 本波（matchId 升序、场内决策序）
      const tailN = tailYs.length;
      const waveN = results.reduce((s, r) => s + r.ys.length, 0);
      const N = tailN + waveN;
      const feats = new Float32Array(N * inputDim);
      const ys = new Float32Array(N);
      const waveOf = new Int32Array(N);
      feats.set(tailFeats, 0); ys.set(tailYs, 0);
      for (let i = 0; i < tailN; i++) waveOf[i] = tailWave[i];
      let o = tailN;
      for (const r of results) {
        feats.set(r.feats, o * inputDim); ys.set(r.ys, o);
        for (let i = 0; i < r.ys.length; i++) waveOf[o + i] = r.waveId;
        o += r.ys.length;
      }
      const uW = Math.floor(N / GROUP);
      // 行为版本出生登记（2026-10-27 记账修复）：本波样本由波开始时的权重快照产生，
      // 出生版本=波开始的 update 数。旧实现在消费完后才登记且当前波缺省 0 →
      // 账面年龄虚高为全部 update 数（真实滞后≤1 波）；纯记账修复，训练语义不变。
      updatesAtWaveEnd.set(waveId, updates);
      let blocksDone = 0;
      let stopped = false;
      for (let bi = 0; bi < uW; bi++) {
        if (activeMsNow() > maxActiveMs - 90000) { stopReason = 'time'; stopped = true; break; }
        const base = bi * GROUP;
        const blockFeats = feats.slice(base * inputDim, (base + GROUP) * inputDim);
        const blockYs = ys.slice(base, base + GROUP);
        const mix = new Map<number, number>();
        for (let i = base; i < base + GROUP; i++) mix.set(waveOf[i], (mix.get(waveOf[i]) ?? 0) + 1);
        const stepSeed = deriveStepSeed(namespace, master, updates);
        const rep = await learner.train(blockFeats, blockYs, GROUP, inputDim, stepSeed);
        if (rep.nonfinite) throw new Error(`非有限值于 update ${updates}`);
        updates += 1; consumed += rep.nTrain;
        blocksDone = bi + 1;
        model.setWeights(await learner.getWeights());
        pool.updateWeights(model.getWeights());
        const ages = agesOf([...mix.entries()].map(([waveId2, count]) => ({ waveId: waveId2, count })), updatesAtWaveEnd, updates);
        log({ phase: 'update', updates, loss: +rep.lossBefore.toFixed(4), gradNorm: +rep.gradNorm.toFixed(3), stepMs: rep.stepMs, stepSeed, waveId, ages });
        for (const c of checkpoints) {
          if (updates === c && !checkpointsHit.has(c)) { checkpointsHit.add(c); await saveState(`ck-${c}`, c); }
        }
        if (updates >= maxUpdates) { stopped = true; break; }
      }
      // REVIEW5 T0.4：尾部继承 + 波账目在【所有】退出路径执行
      //（旧实现在 maxUpdates/time break waveLoop 时跳过本段——末波尾部沿用旧值，train-end 的
      //  extraMatureInTail 与真实成熟样本脱节，updates×2048+tail 不可审计）
      const consumedN = blocksDone * GROUP;
      tailFeats = feats.slice(consumedN * inputDim);
      tailYs = ys.slice(consumedN);
      tailWave = Array.from(waveOf.slice(consumedN));
      nextMatchId += waveSize;
      waveCount += 1;
      for (const r of results) rmSync(join(runDir, 'waves', `w${waveId}-m${r.matchId}.bin`), { force: true });
      log({ phase: 'wave', waveId, matches: results.length, mature: waveN, tail: tailYs.length, updatesAfter: updates, updatesConsumedThisWave: blocksDone, stopPending: stopped, stopReason: stopped ? stopReason : null, capped: results.filter((r) => r.capped).length, counters: pool.counters });
      await persistCurrent(updates); // 每波持久化波前沿：断点恢复不重放、不丢失
      if (stopped) break waveLoop;
    }
  } catch (err) {
    pool.kill();
    try { await persistCurrent(updates); } catch { /* 现场保存尽力而为 */ }
    log({ phase: 'train-aborted', at: new Date().toISOString(), updates, consumed, waveCount, nextMatchId, tailLen: tailYs.length, error: String(err).slice(0, 500) });
    throw err;
  }

  pool.kill();
  if (!checkpointsHit.has(updates)) { checkpointsHit.add(updates); await saveState(`ck-${updates}`, updates); }
  // REVIEW5 T0.5：运行期不可变校验——快照文件在训练期间被改动即报错（exit 1，不静默）
  let snapshotImmutable: boolean | 'n/a' = 'n/a';
  if (SNAPSHOT_DIR && snapshotSums) {
    snapshotImmutable = true;
    for (const [f, h] of Object.entries(snapshotSums)) {
      if (createHash('sha256').update(readFileSync(join(SNAPSHOT_DIR, f))).digest('hex') !== h) { snapshotImmutable = false; break; }
    }
    if (snapshotImmutable === false) throw new Error('运行期间快照文件被修改——违反不可变执行契约');
  }
  log({ phase: 'train-end', stopReason, updates, maxUpdates, activeMs: Math.round(activeMsNow()), consumed, waves: waveCount, counters: pool.counters, deadWorkers: pool.deadWorkers, extraMatureInTail: tailYs.length, tailAccounted: true, snapshotImmutable });
  await learner.shutdown();
  console.log(`训练结束：${stopReason} updates=${updates}/${maxUpdates} active=${(activeMsNow() / 60000).toFixed(1)}min waves=${waveCount} consumed=${consumed} tail=${tailYs.length}`);
  return 0;
}

// ---------- 评测 ----------
/** 块自助 97.5% 双侧区间（固定种子） */
function blockCI(blocks: number[], bootSeed: number): { mean: number; ciLow: number; ciHigh: number } {
  const n = blocks.length;
  const mean = blocks.reduce((a, b) => a + b, 0) / n;
  const rand = mulberry32(bootSeed);
  const boots: number[] = [];
  for (let b = 0; b < 2000; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += blocks[Math.floor(rand() * n)];
    boots.push(s / n);
  }
  boots.sort((a, b) => a - b);
  const q = (p: number) => boots[Math.min(boots.length - 1, Math.round(p * (boots.length - 1)))];
  return { mean, ciLow: q(0.0125), ciHigh: q(0.9875) };
}

/** 整场对战结果（REVIEW5 T0.6）：incomplete=达 cap 未分胜负——记未完成，不记为输 */
interface MatchOutcome { win: boolean; incomplete: boolean; games: number; /** 首局四家手牌 SHA16：同副牌换边的可断言指纹 */ fingerprint: string }

/** N+N vs O+O 整场（REVIEW5 T0.6：同副牌换边——两边 matchSeed 同源于 seed，
 *  只交换席位归属；旧实现 seed*2+side 使两边拿不同发牌，"换边"名不符实） */
function playNNvsNN(nMlp: MLP, oMlp: MLP, seed: number, side: 0 | 1, cap = 80): MatchOutcome {
  const matchSeed = (Math.imul(seed, 0x9e3779b1) ^ 0xd1b54a35) >>> 0;
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const mkNN = (m: MLP) => [0, 1, 2, 3].map((s) => new NeuralDecider(s, m, 0, () => 0));
  const mine = mkNN(nMlp); const other = mkNN(oMlp);
  let games = 0;
  let fingerprint = '';
  while (match.winner == null && games < cap) {
    const state = startGame(match);
    if (games === 0) fingerprint = createHash('sha256')
      .update(state.hands.map((h) => h.map((c) => c.id).sort().join(',')).join('|')).digest('hex').slice(0, 16);
    mine.forEach((s) => s.newGame()); other.forEach((s) => s.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const d = ((turn & 1) === side ? mine[turn] : other[turn]).decide(state);
      const raw = d.move as unknown as { pass: boolean; combo?: Combo };
      const move = isMoveLegal(state, raw as never) ? raw : guardMove(state, raw as never);
      const events = applyMove(state, move as never);
      mine.forEach((s) => s.observe(events)); other.forEach((s) => s.observe(events));
    }
    games += 1;
  }
  if (match.winner == null) return { win: false, incomplete: true, games, fingerprint };
  return { win: match.winner === side, incomplete: false, games, fingerprint };
}

/** N+H vs O+H 整场（同副牌换边）：每队一席模型 + 一席中级 H 搭档。
 *  席位：模型队 = 座位 side（模型）+ side+2（H）；对队 = 座位 1−side（O）+ 3−side（H）。
 *  H 随机流由 matchSeed 派生——两边同副牌时 H 流一致（随机流身份随评测记录落盘）。 */
function playNNwithH(nMlp: MLP, oMlp: MLP, seed: number, side: 0 | 1, cap = 80): MatchOutcome {
  const matchSeed = (Math.imul(seed, 0x85ebca77) ^ 0xc2b2ae35) >>> 0;
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const nn = [0, 1, 2, 3].map((s) => new NeuralDecider(s, nMlp, 0, () => 0));
  const oo = [0, 1, 2, 3].map((s) => new NeuralDecider(s, oMlp, 0, () => 0));
  const policyOf = (seat: number): 'N' | 'O' | 'H' => {
    const team = seat & 1;
    if (team === side) return seat === side ? 'N' : 'H';
    return seat === 1 - side ? 'O' : 'H';
  };
  let games = 0;
  let fingerprint = '';
  while (match.winner == null && games < cap) {
    const state = startGame(match);
    if (games === 0) fingerprint = createHash('sha256')
      .update(state.hands.map((h) => h.map((c) => c.id).sort().join(',')).join('|')).digest('hex').slice(0, 16);
    const rngH = new RNG((matchSeed ^ (0x5eed + games)) >>> 0);
    const heur = [0, 1, 2, 3].map((s) => createAI(s, 1, rngH.next() * 0xffffffff));
    heur.forEach((p) => p.reset(state, match.opts));
    nn.forEach((x) => x.newGame()); oo.forEach((x) => x.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const pol = policyOf(turn);
      let raw: { pass: boolean; combo?: Combo };
      if (pol === 'N') raw = nn[turn].decide(state).move as unknown as { pass: boolean; combo?: Combo };
      else if (pol === 'O') raw = oo[turn].decide(state).move as unknown as { pass: boolean; combo?: Combo };
      else raw = heur[turn].decide(state) as { pass: boolean; combo?: Combo };
      const move = isMoveLegal(state, raw as never) ? raw : guardMove(state, raw as never);
      const toBeat = state.lastCombo;
      const events = applyMove(state, move as never);
      nn.forEach((x) => x.observe(events)); oo.forEach((x) => x.observe(events));
      heur.forEach((p) => p.observe(events, toBeat));
    }
    games += 1;
  }
  if (match.winner == null) return { win: false, incomplete: true, games, fingerprint };
  return { win: match.winner === side, incomplete: false, games, fingerprint };
}


// ---------- REVIEW4-F 评测：review4-dev / review4-confirm ----------
/** 冠军席（v1 385 + v2 候选兼容折叠）；臂席（v2 399 + ctxFill）——同副牌换边（T0.6） */
function playArmVsChampion(
  armMlp: MLP, armCtxFill: 'zero' | 'rule-context', champMlp: MLP, seed: number, side: 0 | 1, cap = 80,
): MatchOutcome {
  const matchSeed = (Math.imul(seed, 0x9e3779b1) ^ 0xd1b54a35) >>> 0;
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const arm = [0, 1, 2, 3].map((s) => new NeuralDecider(s, armMlp, 0, () => 0, { schema: 'v2', ctxFill: armCtxFill }));
  const champ = [0, 1, 2, 3].map((s) => new NeuralDecider(s, champMlp, 0, () => 0, { candidateCompat: 'v2' }));
  let games = 0;
  let fingerprint = '';
  while (match.winner == null && games < cap) {
    const state = startGame(match);
    if (games === 0) fingerprint = createHash('sha256')
      .update(state.hands.map((h) => h.map((c) => c.id).sort().join(',')).join('|')).digest('hex').slice(0, 16);
    arm.forEach((s) => s.newGame()); champ.forEach((s) => s.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const d = ((turn & 1) === side ? arm[turn] : champ[turn]).decide(state);
      const raw = d.move as unknown as { pass: boolean; combo?: Combo };
      const move = isMoveLegal(state, raw as never) ? raw : guardMove(state, raw as never);
      const events = applyMove(state, move as never);
      arm.forEach((s) => s.observe(events)); champ.forEach((s) => s.observe(events));
    }
    games += 1;
  }
  if (match.winner == null) return { win: false, incomplete: true, games, fingerprint };
  return { win: match.winner === side, incomplete: false, games, fingerprint };
}

/** 臂+H vs 冠军+H（M2: H=中级训练搭档；J: H=高级异质搭档，不入训练）——同副牌换边 */
function playArmWithHvsChampH(
  armMlp: MLP, armCtxFill: 'zero' | 'rule-context', champMlp: MLP, hLevel: 0 | 1 | 2, seed: number, side: 0 | 1, cap = 80,
): MatchOutcome {
  const matchSeed = (Math.imul(seed, 0x85ebca77) ^ 0xc2b2ae35) >>> 0;
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const arm = [0, 1, 2, 3].map((s) => new NeuralDecider(s, armMlp, 0, () => 0, { schema: 'v2', ctxFill: armCtxFill }));
  const champ = [0, 1, 2, 3].map((s) => new NeuralDecider(s, champMlp, 0, () => 0, { candidateCompat: 'v2' }));
  const policyOf = (seat: number): 'A' | 'C' | 'H' => {
    const team = seat & 1;
    if (team === side) return seat === side ? 'A' : 'H';
    return seat === 1 - side ? 'C' : 'H';
  };
  let games = 0;
  let fingerprint = '';
  while (match.winner == null && games < cap) {
    const state = startGame(match);
    if (games === 0) fingerprint = createHash('sha256')
      .update(state.hands.map((h) => h.map((c) => c.id).sort().join(',')).join('|')).digest('hex').slice(0, 16);
    const rngH = new RNG((matchSeed ^ (0x5eed + games)) >>> 0);
    const heur = [0, 1, 2, 3].map((s) => createAI(s, hLevel, rngH.next() * 0xffffffff));
    heur.forEach((p) => p.reset(state, match.opts));
    arm.forEach((x) => x.newGame()); champ.forEach((x) => x.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const pol = policyOf(turn);
      let raw: { pass: boolean; combo?: Combo };
      if (pol === 'A') raw = arm[turn].decide(state).move as unknown as { pass: boolean; combo?: Combo };
      else if (pol === 'C') raw = champ[turn].decide(state).move as unknown as { pass: boolean; combo?: Combo };
      else raw = heur[turn].decide(state) as { pass: boolean; combo?: Combo };
      const move = isMoveLegal(state, raw as never) ? raw : guardMove(state, raw as never);
      const toBeat = state.lastCombo;
      const events = applyMove(state, move as never);
      arm.forEach((x) => x.observe(events)); champ.forEach((x) => x.observe(events));
      heur.forEach((p) => p.observe(events, toBeat));
    }
    games += 1;
  }
  if (match.winner == null) return { win: false, incomplete: true, games, fingerprint };
  return { win: match.winner === side, incomplete: false, games, fingerprint };
}

/** 两臂共同检查点（evaluator 只比较双方共同完成的最大约定终点） */
function commonEndpointOf(proto: Protocol): { commonNewUpdates: number; arms: Record<string, { checkpoint: number; weightsPath: string; weightSHA256: string }> } {
  const out: Record<string, { checkpoint: number; weightsPath: string; weightSHA256: string }> = {};
  let common = -1;
  const states: Record<string, Set<number>> = {};
  for (const run of ['review4-control', 'review4-treatment']) {
    const st = JSON.parse(readFileSync(join(R2, 'runs', run, 'state.json'), 'utf8')) as { checkpointsHit: number[] };
    states[run] = new Set(st.checkpointsHit);
  }
  const wanted = proto.trainer.checkpoints ?? [0, 600, 1200, 1800];
  for (const c of wanted) {
    if (states['review4-control'].has(c) && states['review4-treatment'].has(c)) common = Math.max(common, c);
  }
  for (const run of ['review4-control', 'review4-treatment']) {
    const dir = join(R2, 'runs', run, `ck-${common}`);
    out[run] = {
      checkpoint: common,
      weightsPath: join(dir, 'weights.f32'),
      weightSHA256: createHash('sha256').update(readFileSync(join(dir, 'weights.f32'))).digest('hex'),
    };
  }
  return { commonNewUpdates: common, arms: out };
}

async function evaluateReview4(args: { run: string; split: string; protocolPath: string; lockCandidate?: boolean }): Promise<number> {
  const proto = loadProtocol(args.protocolPath);
  const ns = proto.seeds.namespaces;
  const isDev = args.split === 'review4-dev';
  const nsBase = isDev ? ns['review4-dev'] : ns['review4-confirm'];
  const candPath = join(R2, 'review4', 'candidate-lock.json');

  const champMlp = new MLP(1, INPUT_DIM); // frozenChampion：部署 clean2（385 + v2 候选兼容）
  loadWeightsInto(champMlp, join(ROOT, 'packages', 'web', 'public', 'ai', 'clean2.f32'));

  // 候选选择：dev=各臂@共同终点 + U0；confirm=锁定的唯一 runId
  type Arm = { name: string; weightsPath: string; ctxFill: 'zero' | 'rule-context'; sha: string };
  let arms: Arm[]; let commonNewUpdates = -1;
  if (isDev) {
    const ep = commonEndpointOf(proto);
    commonNewUpdates = ep.commonNewUpdates;
    writeFileSync(join(R2, 'review4', 'common-endpoint.json'), JSON.stringify({ ...ep, at: new Date().toISOString(), protocol: proto.protocolVersion }, null, 1));
    if (ep.commonNewUpdates < 0) { console.error('两臂无共同完成的检查点（连 0/U0 都缺）'); return 4; }
    arms = [
      { name: 'review4-control', weightsPath: ep.arms['review4-control'].weightsPath, ctxFill: 'zero', sha: ep.arms['review4-control'].weightSHA256 },
      { name: 'review4-treatment', weightsPath: ep.arms['review4-treatment'].weightsPath, ctxFill: 'rule-context', sha: ep.arms['review4-treatment'].weightSHA256 },
      // U0 = ck-0（两臂初始化应逐字节一致；以 control 的 ck-0 为代表并核对 treatment）
    ];
    const u0a = join(R2, 'runs', 'review4-control', 'ck-0', 'weights.f32');
    const u0b = join(R2, 'runs', 'review4-treatment', 'ck-0', 'weights.f32');
    if (!existsSync(u0a) || !existsSync(u0b)) { console.error('U0 (ck-0) 缺失——两臂须先各自保存零点'); return 4; }
    const shaU0a = createHash('sha256').update(readFileSync(u0a)).digest('hex');
    const shaU0b = createHash('sha256').update(readFileSync(u0b)).digest('hex');
    if (shaU0a !== shaU0b) { console.error('两臂 ck-0 权重不一致（初始化分岔——协议违规）'); return 4; }
    arms.push({ name: 'U0', weightsPath: u0a, ctxFill: 'rule-context', sha: shaU0a }); // U0 语义：同输入方案下的父权重；zero/rule-context 只差 14 列输入而初始新列权重=0 → 打分一致
  } else {
    if (!existsSync(candPath)) { console.error('confirm 需先 dev 过门并写 candidate-lock.json'); return 4; }
    const lock = JSON.parse(readFileSync(candPath, 'utf8')) as {
      run: string; ctxFill: 'zero' | 'rule-context'; lockedAt: string;
      checkpoint?: number; weightsPath?: string; weightSHA256?: string; protocolVersion?: string;
    };
    if (!args.lockCandidate) { console.error('confirm 必须 --lock-candidate（先锁后开数据）'); return 4; }
    // REVIEW5 T0.6：一次性确认账本（未开封→进行中→已完成；不可覆盖；恢复只续同一清单）
    const ledgerPath = join(R2, 'review4', 'confirm-ledger.jsonl');
    const ledger = existsSync(ledgerPath)
      ? readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { phase: string; run: string; at: string; protocol?: string })
      : [];
    const done = ledger.filter((l) => l.phase === 'completed');
    if (done.some((l) => l.run === lock.run)) { console.error(`confirm 已完成（一次性账本 ${ledgerPath}）——不允许重复确认`); return 4; }
    if (done.length > 0) { console.error(`本协议已有其他完成确认（${done[0].run}）——不允许追加 attempt`); return 4; }
    if (!lock.weightsPath || !lock.weightSHA256 || !existsSync(lock.weightsPath)) {
      console.error('candidate-lock.json 缺完整身份（weightsPath/weightSHA256）——旧格式锁，须重新 dev 过门'); return 4;
    }
    const shaNow = createHash('sha256').update(readFileSync(lock.weightsPath)).digest('hex');
    if (shaNow !== lock.weightSHA256) { console.error(`锁定权重 SHA 不符：lock=${lock.weightSHA256} 实=${shaNow}`); return 4; }
    appendFileSync(ledgerPath, `${JSON.stringify({ phase: 'in_progress', run: lock.run, at: new Date().toISOString(), protocol: proto.protocolVersion, weightSHA256: shaNow })}\n`);
    arms = [{ name: lock.run, weightsPath: lock.weightsPath, ctxFill: lock.ctxFill, sha: shaNow }];
  }

  const m1Blocks = isDev ? 32 : 128;
  const m2Blocks = isDev ? 32 : 256;
  const jBlocks = 32;
  const results: Record<string, { m1: ReturnType<typeof blockCI>; m2: ReturnType<typeof blockCI>; j?: ReturnType<typeof blockCI>; S: number; rawM1: number[]; rawM2: number[]; rawJ: number[]; incomplete: { m1: number; m2: number; j: number } }> = {};
  for (const arm of arms) {
    const mlp = new MLP(1, INPUT_DIM_V2);
    loadWeightsInto(mlp, arm.weightsPath);
    const m1: number[] = [], m2: number[] = [], jj: number[] = [];
    const inc = { m1: 0, m2: 0, j: 0 };
    const t0 = performance.now();
    for (let b = 0; b < m1Blocks; b++) {
      const seed = deriveSeed('r4-m1', nsBase, b, 'block');
      let wins = 0;
      for (const side of [0, 1] as const) {
        const r = playArmVsChampion(mlp, arm.ctxFill, champMlp, seed, side);
        if (r.incomplete) inc.m1 += 1; else wins += r.win ? 1 : 0;
      }
      m1.push(wins / 2);
    }
    for (let b = 0; b < m2Blocks; b++) {
      const seed = deriveSeed('r4-m2', nsBase, b, 'block');
      let wins = 0;
      for (const side of [0, 1] as const) {
        const r = playArmWithHvsChampH(mlp, arm.ctxFill, champMlp, 1, seed, side);
        if (r.incomplete) inc.m2 += 1; else wins += r.win ? 1 : 0;
      }
      m2.push(wins / 2);
    }
    if (isDev) {
      for (let b = 0; b < jBlocks; b++) {
        const seed = deriveSeed('r4-j', nsBase, b, 'block');
        let wins = 0;
        for (const side of [0, 1] as const) {
          const r = playArmWithHvsChampH(mlp, arm.ctxFill, champMlp, 2, seed, side);
          if (r.incomplete) inc.j += 1; else wins += r.win ? 1 : 0;
        }
        jj.push(wins / 2);
      }
    }
    const c1 = blockCI(m1, deriveSeed('boot', nsBase, 0, 'r4-m1'));
    const c2 = blockCI(m2, deriveSeed('boot', nsBase, 0, 'r4-m2'));
    const cj = jj.length ? blockCI(jj, deriveSeed('boot', nsBase, 0, 'r4-j')) : undefined;
    results[arm.name] = { m1: c1, m2: c2, j: cj, S: 0.5 * c1.mean + 0.5 * c2.mean, rawM1: m1, rawM2: m2, rawJ: jj, incomplete: inc };
    console.log(`[${arm.name}] M1=${(c1.mean * 100).toFixed(1)}% [${(c1.ciLow * 100).toFixed(1)},${(c1.ciHigh * 100).toFixed(1)}] M2=${(c2.mean * 100).toFixed(1)}% [${(c2.ciLow * 100).toFixed(1)},${(c2.ciHigh * 100).toFixed(1)}]${cj ? ` J=${(cj.mean * 100).toFixed(1)}%` : ''} S=${(results[arm.name].S * 100).toFixed(2)}pp incomplete=${JSON.stringify(inc)} (${((performance.now() - t0) / 60000).toFixed(1)}min)`);
  }

  const out: Record<string, unknown> = {
    split: args.split, at: new Date().toISOString(), protocol: proto.protocolVersion,
    opponent: 'frozenChampion=clean2-ck7051-20261027（385 + cand-dedup-v2 兼容折叠）',
    seatSwap: 'same-deal（REVIEW5 T0.6：两边同 matchSeed 只换席位；旧实现 seed*2+side 为不同发牌）',
    commonNewUpdates, arms: arms.map((a) => ({ name: a.name, sha: a.sha, ctxFill: a.ctxFill })),
    results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { m1: v.m1, m2: v.m2, j: v.j, S: +v.S.toFixed(4), incomplete: v.incomplete }])),
  };

  if (isDev) {
    // 共同门（REVIEW4 §4.6）：S ≥ U0+5pp；仅 treatment 须 S 严格高于 control；J 退化门 ±5pp；同分选 control
    const u0 = results['U0']; const ctl = results['review4-control']; const trt = results['review4-treatment'];
    const gate = (x: { S: number }) => x.S >= u0.S + 0.05;
    const jOk = (a?: ReturnType<typeof blockCI>) => !a || a.mean >= (u0.j?.mean ?? 0) - 0.05;
    const ctlGate = gate(ctl) && jOk(ctl.j);
    const trtGate = gate(trt) && jOk(trt.j) && trt.S > ctl.S;
    let selected: string | null = null;
    if (ctlGate && trtGate) selected = trt.S > ctl.S ? 'review4-treatment' : 'review4-control';
    else if (trtGate) selected = 'review4-treatment';
    else if (ctlGate) selected = 'review4-control';
    out.gates = {
      u0S: u0.S, sGateThreshold: '+5pp vs U0', jGuardThreshold: '−5pp vs U0',
      controlPassed: ctlGate, treatmentPassed: trtGate,
      controlGateDetail: { sGate: gate(ctl), jGuard: jOk(ctl.j) },
      treatmentGateDetail: { sGate: gate(trt), beatsControl: trt.S > ctl.S, jGuard: jOk(trt.j) },
      selected,
      note: '小 dev 工程筛选门，不称统计已证非劣；同分选 control',
    };
    if (selected) {
      // REVIEW5 T0.6：锁完整身份（权重 SHA/检查点/配置哈希）——确认器只读精确值，不读 latest
      const sel = arms.find((a) => a.name === selected)!;
      writeFileSync(candPath, JSON.stringify({
        run: selected, ctxFill: selected === 'review4-treatment' ? 'rule-context' : 'zero',
        lockedAt: new Date().toISOString(), split: 'review4-dev', commonNewUpdates,
        checkpoint: ep.commonNewUpdates,
        weightsPath: sel.weightsPath,
        weightSHA256: sel.sha,
        protocolVersion: proto.protocolVersion,
        inputDim: INPUT_DIM_V2, candidateVersion: 'cand-suit-v3', encoderVersion: 'gd-lab-schema-v2',
      }, null, 1));
      console.log(`候选锁定：${selected}（先锁后开确认集）sha=${sel.sha.slice(0, 16)}…`);
    }
    writeFileSync(join(R2, 'review4', 'review4-dev.json'), JSON.stringify({ ...out, raw: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { m1: v.rawM1, m2: v.rawM2, j: v.rawJ }])) }, null, 1));
    console.log(JSON.stringify(out.gates, null, 1));
    return selected ? 0 : 1;
  }

  // confirm：M1 点≥55% 且下界>50%；M2 下界>45%（对 frozenChampion；本轮只一次确认）
  // REVIEW5 T0.6：任何 incomplete 场次 → 确认记 incomplete，不发布（不把未完成记为输）
  const arm = arms[0];
  const r = results[arm.name];
  const gateM1 = r.m1.mean >= 0.55 && r.m1.ciLow > 0.5;
  const gateM2 = r.m2.ciLow > 0.45;
  const anyIncomplete = (r.incomplete.m1 + r.incomplete.m2) > 0;
  const confirmed = gateM1 && gateM2 && !anyIncomplete;
  out.gates = { m1Point: '≥55% 且下界>50%', m2Lower: '>45%', gateM1, gateM2, incompleteMatches: r.incomplete, status: anyIncomplete ? 'incomplete' : confirmed ? 'confirmed' : 'failed', confirmed };
  writeFileSync(join(R2, 'review4', 'review4-confirm.json'), JSON.stringify({ ...out, raw: { m1: r.rawM1, m2: r.rawM2 } }, null, 1));
  appendFileSync(join(R2, 'review4', 'confirm-ledger.jsonl'), `${JSON.stringify({ phase: 'completed', run: arm.name, at: new Date().toISOString(), confirmed, incomplete: r.incomplete })}\n`);
  console.log(JSON.stringify(out.gates, null, 1));
  return confirmed ? 0 : 1;
}

async function evaluate(args: { run: string; split: string; protocolPath: string; lockCandidate?: boolean }): Promise<number> {
  if (args.split === 'review4-dev' || args.split === 'review4-confirm') {
    return evaluateReview4(args);
  }
  const proto = loadProtocol(args.protocolPath);
  const runDir = join(R2, 'runs', args.run);
  if (!existsSync(join(runDir, 'state.json'))) { console.error('run 无检查点（先 train）'); return 4; }
  const st = JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8')) as { checkpointsHit: number[] };
  const ns = proto.seeds.namespaces;
  const nsBase = args.split === 'confirm-attempt1' ? ns['confirm-attempt1'] : args.split === 'confirm-attempt2' ? ns['confirm-attempt2'] : ns.dev;

  const refMlp = new MLP(1);
  loadWeightsInto(refMlp, join(ROOT, 'packages', 'web', 'public', 'ai', 'clean1.f32'));

  const evalOne = (weightsPath: string): { m1: number[]; m2: number[]; incomplete: { m1: number; m2: number } } => {
    const mlp = new MLP(1);
    loadWeightsInto(mlp, weightsPath);
    const m1Blocks = args.split === 'dev' ? 32 : 128;
    const m2Blocks = args.split === 'dev' ? 32 : 256;
    const m1: number[] = []; const m2: number[] = [];
    const inc = { m1: 0, m2: 0 };
    for (let b = 0; b < m1Blocks; b++) {
      const seed = deriveSeed('eval-m1', nsBase, b, 'block');
      let wins = 0;
      for (const side of [0, 1] as const) {
        const r = playNNvsNN(mlp, refMlp, seed, side); // T0.6 同副牌换边
        if (r.incomplete) inc.m1 += 1; else wins += r.win ? 1 : 0;
      }
      m1.push(wins / 2);
    }
    for (let b = 0; b < m2Blocks; b++) {
      const seed = deriveSeed('eval-m2', nsBase, b, 'block');
      let wins = 0;
      for (const side of [0, 1] as const) {
        const r = playNNwithH(mlp, refMlp, seed, side);
        if (r.incomplete) inc.m2 += 1; else wins += r.win ? 1 : 0;
      }
      m2.push(wins / 2);
    }
    return { m1, m2, incomplete: inc };
  };

  if (args.split === 'dev') {
    const out: Array<{ tag: string; m1: ReturnType<typeof blockCI>; m2: ReturnType<typeof blockCI>; S: number }> = [];
    for (const tag of [...st.checkpointsHit].sort((a, b) => a - b)) {
      const dir = join(runDir, `ck-${tag}`);
      if (!existsSync(join(dir, 'weights.f32'))) continue;
      const t0 = performance.now();
      const { m1, m2, incomplete } = evalOne(join(dir, 'weights.f32'));
      const c1 = blockCI(m1, deriveSeed('boot', nsBase, tag, 'm1'));
      const c2 = blockCI(m2, deriveSeed('boot', nsBase, tag, 'm2'));
      const S = 0.5 * c1.mean + 0.5 * c2.mean;
      out.push({ tag: String(tag), m1: c1, m2: c2, S: +S.toFixed(4) });
      console.log(`ck-${tag}: M1=${(c1.mean * 100).toFixed(1)}% [${(c1.ciLow * 100).toFixed(1)},${(c1.ciHigh * 100).toFixed(1)}] M2=${(c2.mean * 100).toFixed(1)}% [${(c2.ciLow * 100).toFixed(1)},${(c2.ciHigh * 100).toFixed(1)}] S=${S.toFixed(3)} (${((performance.now() - t0) / 60000).toFixed(1)}min)`);
      writeFileSync(join(runDir, 'dev.json'), JSON.stringify({ split: 'dev', at: new Date().toISOString(), seatSwap: 'same-deal', results: out.map((o) => ({ ...o, incomplete: (incomplete as unknown as Record<string, number>) })) }, null, 1));
    }
    if (args.lockCandidate) {
      const candPath = join(R2, 'selected', 'candidate.json');
      if (existsSync(candPath)) { console.error('candidate.json 已锁定，拒绝覆盖'); return 4; }
      const best = [...out].sort((a, b) => (b.S - a.S) || (Number(a.tag) - Number(b.tag)))[0];
      if (!best) { console.error('无可选检查点'); return 4; }
      mkdirSync(join(R2, 'selected'), { recursive: true });
      writeFileSync(candPath, JSON.stringify({
        run: args.run, tag: best.tag, dir: join(runDir, `ck-${best.tag}`),
        weightsPath: join(runDir, `ck-${best.tag}`, 'weights.f32'),
        optPath: join(runDir, `ck-${best.tag}`, 'resume.pt'),
        cumUpdates: Number(best.tag), S: best.S, m1: best.m1, m2: best.m2, lockedAt: new Date().toISOString(),
      }, null, 1));
      console.log(`已锁定 candidate: ck-${best.tag} S=${best.S}`);
    }
    return 0;
  }

  // confirm
  const candPath = join(R2, 'selected', 'candidate.json');
  if (!existsSync(candPath)) { console.error('confirm 需先 dev --lock-candidate'); return 4; }
  const cand = JSON.parse(readFileSync(candPath, 'utf8')) as { weightsPath: string; tag: string };
  const { m1, m2, incomplete } = evalOne(cand.weightsPath);
  const c1 = blockCI(m1, deriveSeed('boot', nsBase, 0, 'm1-confirm'));
  const c2 = blockCI(m2, deriveSeed('boot', nsBase, 0, 'm2-confirm'));
  const gateM1 = c1.mean >= 0.55 && c1.ciLow > 0.5;
  const gateM2 = c2.ciLow > 0.45;
  const anyIncomplete = incomplete.m1 + incomplete.m2 > 0;
  const result = {
    split: args.split, at: new Date().toISOString(), candidate: cand,
    seatSwap: 'same-deal（REVIEW5 T0.6）',
    m1: { ...c1, blocks: m1.length, gate: gateM1 },
    m2: { ...c2, blocks: m2.length, gate: gateM2 },
    incompleteMatches: incomplete,
    confirmed: gateM1 && gateM2 && !anyIncomplete,
    note: '升级判据=对旧产品策略包（O=ck180 部署包）的同世界整场比较；不是人类段位；incomplete>0 不发布',
  };
  writeFileSync(join(runDir, `confirm_${args.split}.json`), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  return result.confirmed ? 0 : 1;
}

// ---------- CLI ----------
const argv = process.argv.slice(2);
const sub = argv[0];
function argOf(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
if (process.argv[1] && process.argv[1].includes('review2train')) {
  if (sub === 'train') {
    train({
      run: argOf('run') ?? '', maxActiveMin: Number(argOf('max-active-min') ?? 228),
      protocolPath: argOf('protocol') ?? join(R2, 'protocol-v3.json'), from: argOf('from'),
    }).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
  } else if (sub === 'evaluate') {
    evaluate({
      run: argOf('run') ?? '', split: argOf('split') ?? 'dev',
      protocolPath: argOf('protocol') ?? join(R2, 'protocol-v3.json'),
      lockCandidate: argv.includes('--lock-candidate'),
    }).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
  } else { console.error('用法: review2train.ts train|evaluate ...'); process.exit(2); }
}
export { train, evaluate, playNNvsNN, playNNwithH, playArmVsChampion, playArmWithHvsChampH, blockCI };
