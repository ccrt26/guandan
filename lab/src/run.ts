/**
 * lab/src/run.ts — 实验主控。
 *   npx tsx lab/src/run.ts bench [e2e分钟=8]     性能窗口（≤60min 预算）
 *   npx tsx lab/src/run.ts train [训练分钟=230]   学习窗口（含评测与收尾，≤4h）
 * 输出落 lab/out/。
 */
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { EOL } from 'node:os';
import { join } from 'node:path';
import { INPUT_DIM, schemaDescriptor } from './schema';
import { MLP, mulberry32 } from './mlp';
import { LearnerBridge } from './bridge';
import { evalModelVsHeuristic, quantile, runTrainingMatch } from './sampler';

const OUT = join(import.meta.dirname, '..', 'out');
mkdirSync(OUT, { recursive: true });

const CFG = {
  seed: 20261025,
  eps: 0.05,
  groupSize: 2048,   // 每凑满 2048 条完成标签样本触发一次训练
  evalSeeds: [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212,
    1313, 1414, 1515, 1616, 1717, 1818, 1919, 2020, 2121, 2222, 2323, 2424],
  evalDiff: 1 as const, // 参考对手：中级启发式
  matchGameCap: 60,
};

function log(path: string, obj: unknown): void {
  appendFileSync(path, `${JSON.stringify(obj)}${EOL}`);
}

function saveDeploy(dir: string, mlp: MLP, extra: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  const w = mlp.getWeights();
  writeFileSync(join(dir, 'weights.f32'), Buffer.from(w.buffer, w.byteOffset, w.length * 4));
  writeFileSync(join(dir, 'schema.json'), JSON.stringify(schemaDescriptor(), null, 2));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    layers: mlp.sizes, paramCount: mlp.paramCount, ...extra,
  }, null, 2));
}

/** 汇总候选数/耗时统计 */
function stats(arr: number[]): Record<string, number> {
  const s = [...arr].sort((a, b) => a - b);
  return { p50: quantile(s, 0.5), p95: quantile(s, 0.95), p99: quantile(s, 0.99), max: s[s.length - 1] ?? 0 };
}

// ============ bench ============
async function bench(e2eMinutes: number): Promise<void> {
  const t0 = Date.now();
  const report: Record<string, unknown> = { mode: 'bench', startedAt: new Date().toISOString() };

  const mlp = new MLP(CFG.seed);
  const initWeights = mlp.getWeights().slice();

  // 1) CPU learner：环境 + 训练步
  const cpu = new LearnerBridge('cpu');
  const env = await cpu.init(INPUT_DIM, initWeights, CFG);
  report.env = env;
  console.log('环境:', env);

  // 2) 造一个真实批次（跑采样场，eps=0.05）
  const ts0 = Date.now();
  const pool: Array<{ feat: Float32Array; y: number }> = [];
  const candTs: number[] = []; const candCounts: number[] = [];
  const rand = mulberry32(CFG.seed ^ 0xabc);
  let matchesForBatch = 0;
  while (pool.length < CFG.groupSize && matchesForBatch < 12) {
    const r = runTrainingMatch(mlp, CFG.eps, (rand() * 0xffffffff) | 0);
    matchesForBatch += 1;
    if (r.samples) pool.push(...r.samples.map((s) => ({ feat: s.feat, y: s.y })));
    candCounts.push(...r.candCounts);
  }
  const batchMs = Date.now() - ts0;
  report.batch = {
    matches: matchesForBatch, samples: pool.length, ms: batchMs,
    samplesPerSec: +(pool.length / (batchMs / 1000)).toFixed(1),
    candidates: stats(candCounts),
  };
  console.log(`真实批次: ${pool.length} 样本 / ${matchesForBatch} 场 / ${batchMs}ms；候选数`, report.batch);

  const feats = new Float32Array(CFG.groupSize * INPUT_DIM);
  const targets = new Float32Array(CFG.groupSize);
  pool.slice(0, CFG.groupSize).forEach((s, i) => {
    feats.set(s.feat, i * INPUT_DIM);
    targets[i] = s.y;
  });

  // 3) CPU 训练步（同批 5 步，观察 loss 与耗时）
  const cpuSteps: unknown[] = [];
  for (let i = 0; i < 5; i++) cpuSteps.push(await cpu.train(feats, targets, CFG.groupSize, INPUT_DIM));
  report.cpuSteps = cpuSteps;
  console.log('CPU 步:', cpuSteps);

  // 4) 权重回传 + 前向一致性（TS vs Python）
  const wAfter = await cpu.getWeights();
  const parityMlp = new MLP(1);
  parityMlp.setWeights(wAfter);
  const nPar = 64;
  const parX = feats.slice(0, nPar * INPUT_DIM);
  const tsScores = parityMlp.forward(parX, nPar);
  const pyScores = await cpu.evalBatch(parX, nPar, INPUT_DIM);
  let maxAbs = 0;
  for (let i = 0; i < nPar; i++) maxAbs = Math.max(maxAbs, Math.abs(tsScores[i] - pyScores[i]));
  report.parity = { n: nPar, maxAbsDiff: maxAbs, pass: maxAbs < 1e-4 };
  console.log(`前向一致性: maxAbsDiff=${maxAbs.toExponential(2)}（容差 1e-4）`);
  if (maxAbs >= 1e-4) { console.error('一致性失败'); process.exit(1); }

  // 5) MPS 对照（同初始权重、同批）
  try {
    const mps = new LearnerBridge('mps');
    const menv = await mps.init(INPUT_DIM, initWeights, CFG);
    const mpsSteps: unknown[] = [];
    for (let i = 0; i < 5; i++) mpsSteps.push(await mps.train(feats, targets, CFG.groupSize, INPUT_DIM));
    report.mps = { env: menv, steps: mpsSteps };
    console.log('MPS 步:', mpsSteps);
    await mps.shutdown();
  } catch (e) {
    report.mps = { error: String(e) };
    console.log('MPS 不可用/失败，继续 CPU:', String(e));
  }

  // 6) 端到端（采样↔训练↔换权）
  const e2eMs = e2eMinutes * 60_000;
  const tE2E = Date.now();
  const deadline = tE2E + e2eMs;
  const trainMlp = new MLP(CFG.seed);
  trainMlp.setWeights(initWeights);
  const e2ePool: typeof pool = [];
  const e2eCands: number[] = [];
  let matches = 0, games = 0, decisions = 0, updates = 0, trainedSamples = 0, collected = 0, capped = 0, nonfiniteSteps = 0;
  const stepMsArr: number[] = [];
  const kindChosen = new Array(11).fill(0);
  let lastSwapAt = 0; let swapLagMs: number[] = [];
  const e2eRand = mulberry32(CFG.seed ^ 0xdef);
  while (Date.now() < deadline) {
    const r = runTrainingMatch(trainMlp, CFG.eps, (e2eRand() * 0xffffffff) | 0);
    matches += 1; games += r.games; decisions += r.decisions; capped += r.capped ? 1 : 0;
    r.kindChosen.forEach((v, i) => (kindChosen[i] += v));
    e2eCands.push(...r.candCounts);
    if (r.samples) { e2ePool.push(...r.samples.map((s) => ({ feat: s.feat, y: s.y }))); collected += r.samples.length; }
    while (e2ePool.length >= CFG.groupSize && Date.now() < deadline) {
      const group = e2ePool.splice(0, CFG.groupSize);
      const gf = new Float32Array(CFG.groupSize * INPUT_DIM);
      const gt = new Float32Array(CFG.groupSize);
      group.forEach((s, i) => { gf.set(s.feat, i * INPUT_DIM); gt[i] = s.y; });
      const rep = await cpu.train(gf, gt, CFG.groupSize, INPUT_DIM);
      updates += 1; stepMsArr.push(rep.stepMs); trainedSamples += rep.nTrain;
      if (rep.nonfinite) nonfiniteSteps += 1;
      else {
        trainMlp.setWeights(await cpu.getWeights());
        swapLagMs.push(Date.now() - lastSwapAt); lastSwapAt = Date.now();
      }
    }
  }
  const e2eElapsed = Date.now() - tE2E;
  report.e2e = {
    minutes: +(e2eElapsed / 60000).toFixed(2), matches, games, decisions, capped,
    samplesCollected: collected, samplesTrained: trainedSamples, updates, nonfiniteSteps,
    samplesPerSec: +(collected / (e2eElapsed / 1000)).toFixed(2),
    gamesPerHour: +(games / (e2eElapsed / 3600000)).toFixed(0),
    matchMsAvg: matches ? +(e2eElapsed / matches).toFixed(0) : 0,
    stepMs: stats(stepMsArr), candidates: stats(e2eCands),
    kindChosen, weightSwapLagMsAvg: swapLagMs.length ? +(swapLagMs.reduce((a, b) => a + b) / swapLagMs.length).toFixed(0) : 0,
    nodeRssMb: +(process.memoryUsage.rss() / 1048576).toFixed(1),
    pyRssKb: (await cpu.train(feats.slice(0, INPUT_DIM * 16), targets.slice(0, 16), 16, INPUT_DIM)).rssKb,
  };
  console.log('E2E:', report.e2e);

  await cpu.shutdown();
  report.totalMinutes = +((Date.now() - t0) / 60000).toFixed(2);
  writeFileSync(join(OUT, 'bench_report.json'), JSON.stringify(report, null, 2));
  console.log(`bench 完成，用时 ${report.totalMinutes} 分钟 → lab/out/bench_report.json`);
}

// ============ train ============
async function train(minutes: number): Promise<void> {
  const t0 = Date.now();
  const hardStop = t0 + minutes * 60_000;
  const progPath = join(OUT, 'train_progress.jsonl');
  const reportPath = join(OUT, 'train_report.json');
  const initModel = new MLP(CFG.seed);
  saveDeploy(join(OUT, 'deploy_init'), initModel, { note: '训练前基线（随机初始化）', cfg: CFG });

  const learner = new LearnerBridge('cpu'); // 设备由 bench 结论决定
  const env = await learner.init(INPUT_DIM, initModel.getWeights(), CFG);
  console.log('环境:', env);

  const model = new MLP(CFG.seed);
  model.setWeights(initModel.getWeights());
  const rand = mulberry32(CFG.seed ^ 0x777);

  let matches = 0, games = 0, decisions = 0, collected = 0, trained = 0, updates = 0,
    capped = 0, nonfiniteSteps = 0, weightsVersion = 1;
  const pool: Array<{ feat: Float32Array; y: number }> = [];
  const cands: number[] = []; const stepMsArr: number[] = []; const losses: number[] = [];
  const kindChosen = new Array(11).fill(0);
  const checkpoints = [60, 120, 180].map((m) => t0 + m * 60_000).filter((t) => t < hardStop - 5 * 60_000);
  let ckIdx = 0;

  interface EvalNow { summary: Record<string, unknown>; perGame: Array<{ win: boolean }> }
  function evalNow(tag: string): EvalNow {
    const r = evalModelVsHeuristic(model, CFG.evalDiff, CFG.evalSeeds, true);
    return {
      summary: {
        tag, at: Date.now() - t0, weightsVersion, matches, games, updates,
        evalGames: r.games, evalWins: r.modelWins,
        evalWinRate: +(r.modelWins / Math.max(1, r.games)).toFixed(3),
        evalGSum: r.modelGSum,
      },
      perGame: r.perGame,
    };
  }
  const evals: Record<string, unknown>[] = [];
  const initEvalObj = evalNow('init');
  evals.push(initEvalObj.summary);
  console.log('初始评测:', initEvalObj.summary);

  outer: while (Date.now() < hardStop - 120_000) {
    const r = runTrainingMatch(model, CFG.eps, (rand() * 0xffffffff) | 0);
    matches += 1; games += r.games; decisions += r.decisions;
    if (r.capped) capped += 1;
    r.kindChosen.forEach((v, i) => (kindChosen[i] += v));
    cands.push(...r.candCounts);
    if (r.samples) { pool.push(...r.samples.map((s) => ({ feat: s.feat, y: s.y }))); collected += r.samples.length; }

    while (pool.length >= CFG.groupSize) {
      if (Date.now() > hardStop - 60_000) break outer;
      const group = pool.splice(0, CFG.groupSize);
      const gf = new Float32Array(CFG.groupSize * INPUT_DIM);
      const gt = new Float32Array(CFG.groupSize);
      group.forEach((s, i) => { gf.set(s.feat, i * INPUT_DIM); gt[i] = s.y; });
      const rep = await learner.train(gf, gt, CFG.groupSize, INPUT_DIM);
      updates += 1; stepMsArr.push(rep.stepMs); losses.push(rep.lossBefore);
      if (!rep.nonfinite) {
        trained += rep.nTrain;
        model.setWeights(await learner.getWeights());
        weightsVersion += 1;
      } else nonfiniteSteps += 1;
      log(progPath, { at: Date.now() - t0, updates, loss: rep.lossBefore, lossSub: rep.lossSub, gradNorm: rep.gradNorm, weightsVersion, collected });
    }

    if (ckIdx < checkpoints.length && Date.now() >= checkpoints[ckIdx]) {
      ckIdx += 1;
      saveDeploy(join(OUT, `deploy_ck${ckIdx}`), model, { at: Date.now() - t0, weightsVersion });
      await learner.save(join(OUT, `deploy_ck${ckIdx}`));
      const ev = evalNow(`ck${ckIdx}`);
      evals.push(ev.summary);
      console.log('检查点:', ev.summary);
      log(progPath, ev.summary);
    }
  }

  // 收尾：保存 + 终评（含训练前基线配对同种子）
  saveDeploy(join(OUT, 'deploy_final'), model, { weightsVersion, at: Date.now() - t0 });
  await learner.save(join(OUT, 'deploy_final'));
  const finalEvalObj = evalNow('final');
  evals.push(finalEvalObj.summary);
  const initPerGame = initEvalObj.perGame;
  const finalPerGame = finalEvalObj.perGame;
  let bothSame = 0, initWinFinalLose = 0, initLoseFinalWin = 0;
  for (let i = 0; i < Math.min(initPerGame.length, finalPerGame.length); i++) {
    if (initPerGame[i].win && !finalPerGame[i].win) initWinFinalLose += 1;
    else if (!initPerGame[i].win && finalPerGame[i].win) initLoseFinalWin += 1;
    else bothSame += 1;
  }
  const evalDiff2 = evalModelVsHeuristic(model, 2 as never, CFG.evalSeeds.slice(0, 8), true);
  const report = {
    mode: 'train', startedAt: new Date(t0).toISOString(), endedAt: new Date().toISOString(),
    runtimeMinutes: +((Date.now() - t0) / 60000).toFixed(1), budgetMinutes: minutes,
    env, cfg: CFG, weightsVersion,
    counts: { matches, games, decisions, samplesCollected: collected, samplesTrained: trained, updates, cappedMatches: capped, nonfiniteSteps },
    throughput: {
      gamesPerHour: +(games / ((Date.now() - t0) / 3600000)).toFixed(0),
      samplesPerHour: +(collected / ((Date.now() - t0) / 3600000)).toFixed(0),
      matchMsAvg: matches ? +((Date.now() - t0) / matches).toFixed(0) : 0,
    },
    stepMs: stats(stepMsArr), candidates: stats(cands), kindChosen,
    lossFirst: losses[0], lossLast: losses[losses.length - 1], lossSeries: losses.filter((_, i) => i % Math.max(1, Math.floor(losses.length / 50)) === 0),
    evals,
    finalVsInitPaired: { bothSame, initWinFinalLose, initLoseFinalWin, initWins: initEvalObj.summary.evalWins, initGames: initEvalObj.summary.evalGames },
    finalVsHighHeuristic: { wins: evalDiff2.modelWins, games: evalDiff2.games },
    nodeRssMb: +(process.memoryUsage.rss() / 1048576).toFixed(1),
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('训练报告:', JSON.stringify(report.counts), 'finalEval:', finalEvalObj.summary, 'initEval:', initEvalObj.summary);
  await learner.shutdown();
}

const mode = process.argv[2] ?? 'bench';
const mins = Number.parseFloat(process.argv[3] ?? '');
if (mode === 'bench') await bench(Number.isFinite(mins) ? mins : 8);
else if (mode === 'train') await train(Number.isFinite(mins) ? mins : 230);
else { console.error('用法: run.ts bench|train [分钟]'); process.exit(1); }
void existsSync; void readFileSync;
