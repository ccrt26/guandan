/**
 * lab/src/clean1.ts — CLEAN1 干净重训主控（方案第六节，2026-10-26 采纳执行）。
 *
 * 干净起点（§6.2）：新 run 目录 lab/clean1/<run_id>/；不读取 lab/out、round2、
 * bugregime 任何旧权重/优化器状态/缓存；随机初始化（固定种子）、空样本池、
 * 独立固定随机流（matchSeed=hash(master,i) 计数器制、shuffle/seat/learner 显式
 * 种子+调用计数，检查点记录可复算状态；中断不自动续跑、如实标 partial/failed）。
 *
 * 配方（§6.3，冻结）：385→256→256→1 tanh；ε=0.05 恒定；每 2048 条完成标签样本
 * 固定流打乱后取前 1024 一步 RMSprop(lr1e-3,α.9,ε1e-5,momentum0,centeredF,wd0)
 * MSE，另一半主动弃样计数；y=g+W；CPU torch threads=2；clip_norm=1e6（事实不
 * 构成常规裁剪，如实保留）；模型整场内冻结、场间换权；无 ε 日程/奖励改写/
 * 优先采样/BC/PPO/新 GPU 路线。
 *
 * 预算（§6.4）：采样+学习 active 硬顶 228 分钟（评测暂停不计入）；必要评测纯
 * 程序另封顶 45 分钟。到点不追批：尾部完成标签只保存计数不训练；未完成整场
 * 丢弃计数（不赋 W、不入训练）。
 *
 * 一致性计数（§3）：illegal_intent / fallback / semantic_rewrite /
 * encoding_mismatch / label_mismatch 任一非零 → 保存最小复现、标记 failed、停止。
 *
 * 检查点（§6.5/6.6）：active 20min=机制诊断存档（只判机制不判胜负）；60/120/180
 * /228 为候选。dev 评测：init+4 候选 × (vs初级64 + vs中级64) = 640 整场。
 * 选模型规则（事前固定）：对中级 dev 胜率最高 → 平手看初级 → 仍平手取更晚。
 *
 * 用法：npx tsx lab/src/clean1.ts prep|train|select|holdout|partner|ablation
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { EOL } from 'node:os';
import { join } from 'node:path';
import {
  applyMove, canPass, createMatch, DEFAULT_RULES, legalCombos, startGame, teamOf,
  type Combo,
} from '@gd/engine';
import {
  createAI, guardMove, isMoveLegal, DIFFICULTY_NAME, INPUT_DIM, MLP, mulberry32,
  NeuralDecider, dedupCandidates, schemaDescriptor, type Difficulty,
} from '@gd/ai';
import { LearnerBridge } from './bridge';
import { blockStats, pairedBlockStats } from './stats';
import { NeuralSeat } from './seat';

// ---------- 协议常量（事前固定） ----------
const CLEAN1_ROOT = join(import.meta.dirname, '..', 'clean1');
const MASTER = {
  initSeed: 2026102705,      // 随机初始化种子（记录公式：MLP(seed) Box-Muller×He）
  matchRand: 2026102706,     // 采样场次流（计数器制 matchSeed=hash32(this, matchIdx)）
  shuffleRand: 2026102707,   // 批内 Fisher-Yates 打乱流（调用计数可复算）
  seatRand: 2026102709,      // 采样 ε 探索流（调用计数可复算）
  stepSeed: 2026102708,      // learner 每步显式种子 = hash32(this, updateIdx)
  nnDevBase: 2026102711,     // 神经 dev 32 块
  nnHoldoutBase: 2026102712, // 神经 holdout 128 块（看结果前锁定，只用一次）
  bootSeed: 20261027,        // 统计 bootstrap 种子（与三档共用口径）
};
/** E1 独立复制（CLEAN1-REVIEW-1.0 指令 E1）：更换训练初始化与全部训练随机流，
 *  网络结构/标签/候选/编码/优化器/利用率/预算全部不变；dev/holdout 用全新种子集。 */
const MASTER_E1 = {
  ...MASTER,
  initSeed: 2026110105, matchRand: 2026110106, shuffleRand: 2026110107,
  seatRand: 2026110109, stepSeed: 2026110108,
  nnDevBase: 2026110111, nnHoldoutBase: 2026110112,
};
/** 当前变体的 master（prep 时按 CLEAN1_VARIANT=e1 切换并写入 protocol；train 从 protocol 读回） */
const MASTER_OF = (): typeof MASTER => (process.env.CLEAN1_VARIANT === 'e1' ? MASTER_E1 : MASTER);
const CFG = {
  eps: 0.05,
  groupSize: 2048, trainSub: 1024,
  optimizer: 'RMSprop(lr=1e-3,alpha=0.9,eps=1e-5,momentum=0,centered=false,weight_decay=0)',
  loss: 'MSE',
  clipNorm: 1e6, clipNote: 'clip_norm=1e6 事实不构成常规裁剪；如实保留沿用已知配置',
  device: 'cpu', torchThreads: 2,
  matchGameCap: 60,
  budgetTrainActiveMin: 228, budgetEvalMin: 45,
  checkpointsActiveMin: [20, 60, 120, 180] as const, finalActiveMin: 228,
  devBlocks: 32, holdoutBlocks: 128, ablationBlocks: 64,
  selectionRule: '对中级dev胜率最高；平手比较对初级dev胜率；仍平手取较晚检查点。init不作候选。',
};

function hash32(...nums: number[]): number {
  return createHash('sha256').update(nums.join(',')).digest().readUInt32LE(0);
}
const matchSeedAt = (i: number): number => hash32(MASTER.matchRand, i);
/** 冒烟用独立流偏移（A4 处置：冒烟不得与正式 run 共享 matchSeed 前缀重放） */
const matchSeedAtSmoke = (i: number): number => hash32(MASTER.matchRand ^ 0x50A1E7, i);
const stepSeedAt = (i: number): number => hash32(MASTER.stepSeed, i);
/** 带调用计数的 RNG：检查点记录计数即可精确复算续点（不自动续跑，如实记录） */
class CountingRng {
  calls = 0;
  private fn: () => number;
  constructor(seed: number) { this.fn = mulberry32(seed); }
  next(): number { this.calls += 1; return this.fn(); }
}

function runDir(): string {
  const idx = join(CLEAN1_ROOT, 'CURRENT');
  if (!existsSync(idx)) throw new Error('未 prep：先运行 `clean1.ts prep`');
  return readFileSync(idx, 'utf8').trim();
}
function loadJson<T>(p: string): T { return JSON.parse(readFileSync(p, 'utf8')) as T; }
function appendJson(p: string, obj: unknown): void { appendFileSync(p, `${JSON.stringify(obj)}${EOL}`); }
function loadMlp(dir: string): MLP {
  const buf = readFileSync(join(dir, 'weights.f32'));
  const w = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  if (w.length !== 164_865) throw new Error(`权重长度异常 ${w.length}（加载失败即停，不回退）`);
  const m = new MLP(1);
  m.setWeights(w);
  return m;
}
function saveCk(dir: string, mlp: MLP, meta: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  const w = mlp.getWeights();
  writeFileSync(join(dir, 'weights.f32'), Buffer.from(w.buffer, w.byteOffset, w.length * 4));
  writeFileSync(join(dir, 'schema.json'), JSON.stringify(schemaDescriptor(), null, 2));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}
function manifest(run: string, tag: string): void {
  const root = join(import.meta.dirname, '..', '..');
  const files: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const f of readdirSync(d)) {
      if (f === '.venv' || f === 'node_modules' || f === 'dist' || f.endsWith('.jsonl')) continue;
      const p = join(d, f);
      if (f.endsWith('.ts') || f.endsWith('.py')) files[p.replace(root + '/', '')] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(join(root, 'lab', 'src')); walk(join(root, 'packages', 'engine', 'src')); walk(join(root, 'packages', 'ai', 'src'));
  writeFileSync(join(run, `manifest_${tag}.json`), JSON.stringify({ tag, at: new Date().toISOString(), files }, null, 2));
}

// ---------- 严格采样：一致性计数器 ----------
export interface StrictCounters {
  illegalIntent: number; fallback: number; semanticRewrite: number;
  encodingMismatch: number; labelMismatch: number;
}
const newCounters = (): StrictCounters => ({
  illegalIntent: 0, fallback: 0, semanticRewrite: 0, encodingMismatch: 0, labelMismatch: 0,
});
class ContractError extends Error {
  constructor(readonly kind: string, readonly repro: unknown) { super(`一致性违例: ${kind}`); }
}

/** 采样一整场（4 席当前模型 ε-greedy），严格一致性检查；违例抛 ContractError（供复用：followup 等脚本 import） */
export function sampleMatchStrict(
  model: MLP, eps: number, matchSeed: number, rand: () => number, ctr: StrictCounters,
): { samples: Array<{ feat: Float32Array; y: number; g: number; w: number }>; games: number; decisions: number; capped: boolean } {
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const seats = [0, 1, 2, 3].map((s) => new NeuralSeat(s, model, eps, rand));
  const pending: Array<{ feat: Float32Array; seat: number; g: number }> = [];
  let games = 0, decisions = 0;
  while (match.winner == null && games < CFG.matchGameCap) {
    const state = startGame(match);
    seats.forEach((s) => s.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2000) {
      const d = seats[state.turn].decide(state);
      decisions += 1;
      const raw = d.move;
      // encoding：385 维、全值有限
      if (d.feat.length !== INPUT_DIM) {
        ctr.encodingMismatch += 1;
        throw new ContractError('encodingMismatch', { at: 'dim', matchSeed, games, decisions, len: d.feat.length });
      }
      for (let i = 0; i < INPUT_DIM; i++) {
        if (!Number.isFinite(d.feat[i])) {
          ctr.encodingMismatch += 1;
          throw new ContractError('encodingMismatch', { at: 'finite', matchSeed, games, decisions, i });
        }
      }
      // intent：决策必须本身合法（实验 strict；守卫兜底出现=失败）
      if (!isMoveLegal(state, raw)) {
        const applied = guardMove(state, raw);
        const sameSemantics = applied.pass === raw.pass
          || (!applied.pass && !raw.pass && applied.combo!.cards.length === raw.combo!.cards.length);
        ctr.fallback += 1;
        if (!sameSemantics) ctr.semanticRewrite += 1;
        throw new ContractError('illegalIntent', {
          matchSeed, games, decisions, seat: state.turn,
          hand: state.hands[state.turn].map((c) => `${c.suit}${c.rank}#${c.id}`),
          lastCombo: state.lastCombo ? `${state.lastCombo.kind}:${state.lastCombo.mainRank}` : null,
          raw: raw.pass ? 'pass' : `${raw.combo!.kind}:${raw.combo!.mainRank}:${raw.combo!.cards.map((c) => c.id).join(',')}`,
          guardApplied: applied.pass ? 'pass' : `${applied.combo!.kind}:${applied.combo!.mainRank}`,
        });
      }
      const events = applyMove(state, raw);
      seats.forEach((s) => s.observe(events));
    }
    games += 1;
    const result = state.result;
    if (!result) break; // guard 截断：异常场，不入样本
    const up = result.upgrade;
    for (const s of seats) {
      const g = teamOf(s.seat) === result.winnerTeam ? up : -up;
      for (const p of s.pending) pending.push({ feat: p, seat: s.seat, g });
      s.pending = [];
    }
  }
  const capped = match.winner == null;
  if (capped) return { samples: [], games, decisions, capped }; // 未完成整场：丢弃计数、不赋 W
  const samples = pending.map((p) => {
    const w = teamOf(p.seat) === match.winner ? 1 : -1;
    const y = p.g + w;
    if (!(w === 1 || w === -1) || Math.abs(y) > 4) {
      ctr.labelMismatch += 1;
      throw new ContractError('labelMismatch', { matchSeed, seat: p.seat, g: p.g, w, y });
    }
    return { feat: p.feat, y, g: p.g, w };
  });
  return { samples, games, decisions, capped };
}

// ---------- 神经整场评测（与三档同协议：同 seed 两边同牌；贪心 ε=0） ----------
const nnMatchSeed = (seed: number): number => (Math.imul(seed, 0x9E3779B1) ^ 0xD1B54A35) >>> 0;
const nnAiSeed = (seed: number, side: number, seat: number): number =>
  (Math.imul(seed, 0x85EBCA77) ^ Math.imul(side + 1, 0xC2B2AE35) ^ Math.imul(seat + 1, 0x27D4EB2F)) >>> 0;

export interface NNMatchRec {
  seed: number; side: 0 | 1; matchSeed: number; policyId: string; opponent: Difficulty;
  nnTeam: 0 | 1; win: 0 | 1; games: number; moves: number; ms: number; unfinished: boolean;
  initHandsHash: string;
}
/** NN 双席（ε=0）vs 指定档启发式；policy='pass_min' 为 NN_PASS_MIN 消融 */
export function evalNNMatch(
  mlp: MLP, opponent: Difficulty, seed: number, side: 0 | 1, policyId: string,
  policy: 'full' | 'pass_min' = 'full',
): NNMatchRec {
  const t0 = performance.now();
  const matchSeed = nnMatchSeed(seed);
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const neural = [0, 1, 2, 3].map((s) => new NeuralDecider(s, mlp, 0, () => 0));
  const heur = [0, 1, 2, 3].map((s) => createAI(s, opponent, nnAiSeed(seed, side, s)));
  const CAP = 80;
  let games = 0, moves = 0, initHandsHash = '';
  while (match.winner == null && games < CAP) {
    const state = startGame(match);
    if (games === 0) initHandsHash = createHash('sha256')
      .update(state.hands.map((h) => h.map((c) => c.id).sort().join(',')).join('|')).digest('hex').slice(0, 16);
    heur.forEach((p) => p.reset(state, match.opts));
    neural.forEach((s) => s.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const toBeat = state.lastCombo;
      const isNN = (turn & 1) === side;
      let raw: { pass: boolean; combo?: Combo };
      if (isNN) {
        const d = neural[turn].decide(state);
        if (policy === 'pass_min' && !d.move.pass) {
          // NN_PASS_MIN：网络选非 pass → 显式改选预定的最小合法非 pass 动作（枚举序首个非 pass）
          const cands = dedupCandidates(legalCombos(state), canPass(state));
          const firstNonPass = cands.find((c) => c.combo != null)!;
          raw = { pass: false, combo: firstNonPass.combo! };
        } else raw = d.move;
      } else raw = heur[turn].decide(state) as { pass: boolean; combo?: Combo };
      // 评测一致性：意图必须合法（strict；出现即失败，不出"有效胜率"）
      if (isNN && !isMoveLegal(state, raw as never)) {
        throw new ContractError('illegalIntent', { eval: policyId, seed, side, games, moves });
      }
      const events = applyMove(state, guardMove(state, raw as never) as never);
      neural.forEach((s) => s.observe(events));
      heur.forEach((p) => p.observe(events, toBeat));
      moves += 1;
    }
    games += 1;
  }
  const unfinished = match.winner == null;
  const nnTeam = (side === 0 ? 0 : 1) as 0 | 1;
  return {
    seed, side, matchSeed, policyId, opponent, nnTeam,
    win: !unfinished && match.winner === nnTeam ? 1 : 0,
    games, moves, ms: +(performance.now() - t0).toFixed(1), unfinished, initHandsHash,
  };
}

function evalNNSet(
  run: string, mlp: MLP, opponent: Difficulty, seeds: number[], policyId: string, outName: string,
  policy: 'full' | 'pass_min' = 'full',
): { xs: number[]; summary: Record<string, unknown> } {
  const path = join(run, `${outName}_perseed.jsonl`);
  writeFileSync(path, '');
  const xs: number[] = [];
  let ms = 0, unfinished = 0;
  for (const seed of seeds) {
    const hashes: string[] = [];
    let wins = 0;
    for (const side of [0, 1] as const) {
      const rec = evalNNMatch(mlp, opponent, seed, side, policyId, policy);
      wins += rec.win; ms += rec.ms;
      if (rec.unfinished) unfinished += 1;
      hashes.push(rec.initHandsHash);
      appendJson(path, rec);
    }
    if (hashes[0] !== hashes[1]) throw new Error(`seed=${seed} 两边初始牌面不一致（评测发牌耦合检查失败）`);
    xs.push(wins / 2);
  }
  const est = blockStats(xs, 0.95);
  const summary = {
    policyId, opponent: DIFFICULTY_NAME[opponent], blocks: xs.length, matches: xs.length * 2, unfinished,
    pointEstimate: +est.mean.toFixed(4), ci95: [+est.ciLow.toFixed(4), +est.ciHigh.toFixed(4)], method: est.method,
    msAvg: +(ms / (xs.length * 2)).toFixed(0),
  };
  writeFileSync(join(run, `${outName}_summary.json`), JSON.stringify(summary, null, 2));
  console.log(outName, JSON.stringify(summary));
  return { xs, summary };
}

// ---------- prep ----------
/** 一次性冒烟（工程预检，方案§3.8"短全链路"）：CLEAN1_SMOKE_MIN=2 时 run 目录
 *  加 -smoke 后缀、预算缩短、单一 ck_smoke 检查点；跑完即删，不触碰正式 run。 */
const SMOKE_MIN = process.env.CLEAN1_SMOKE_MIN ? Number.parseFloat(process.env.CLEAN1_SMOKE_MIN) : null;
const VARIANT = process.env.CLEAN1_VARIANT === 'e1' ? 'e1' : 'orig';
function prep(): void {
  const M = MASTER_OF();
  const runId = `clean1-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13)}${SMOKE_MIN ? '-smoke' : ''}${VARIANT === 'e1' ? '-e1' : ''}`;
  const run = join(CLEAN1_ROOT, runId);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(CLEAN1_ROOT, 'CURRENT'), run);
  const tiersSeeds = loadJson<{ seeds: Record<string, number[]> }>(join(import.meta.dirname, '..', 'tiers', 'seeds.json'));
  const gen = (n: number, base: number): number[] => {
    const r = mulberry32(base);
    return Array.from({ length: n }, () => 1_000_000 + Math.floor(r() * 9_000_000));
  };
  const seeds = {
    nnDev: gen(CFG.devBlocks, M.nnDevBase),
    nnHoldout: gen(CFG.holdoutBlocks, M.nnHoldoutBase), // 看结果前锁定；最终验收只用一次
    partner: tiersSeeds.seeds.partner, // §6.7 复用三档代理固定 32 块
  };
  writeFileSync(join(run, 'seeds.json'), JSON.stringify({ created: new Date().toISOString(), seeds }, null, 2));
  writeFileSync(join(run, 'protocol.json'), JSON.stringify({
    runId, variant: VARIANT, createdAt: new Date().toISOString(), cfg: CFG, master: M,
    variantNote: VARIANT === 'e1'
      ? 'E1 独立复制（CLEAN1-REVIEW-1.0）：更换初始化与全部训练随机流；网络/标签/候选/编码/优化器/利用率/预算全部与原 run 相同。本 run 不是修正基线。'
      : '原 CLEAN1 run',
    baseRun: VARIANT === 'e1' ? 'lab/clean1/clean1-2026102609500' : undefined,
    labelSpec: 'y = g + W；g=±1/±2/±3 本副本队名次分；W=±1 完整整场胜负，仅整场结束赋值',
    archSpec: 'tanh 隐层×2、线性输出头（A1 复核）；train_y = raw_y = g+W，无归一化/缩放/裁剪',
    cleanStart: '新 MLP(固定种子) 随机初始化；不读取 lab/out、round2、bugregime 及原 CLEAN1 run；空样本池；计数器制随机流（matchSeed=hash(master,i)，shuffle/seat 记调用数，learner 显式 stepSeed）',
    stopConditions: 'illegal_intent/fallback/semantic_rewrite/encoding_mismatch/label_mismatch 任一非零 → 保存最小复现并标记 failed 停止；非有限梯度/参数/输出立即停止',
    budgetLedger: 'trainActiveMs=采样+学习墙钟（评测暂停不计）；evalMs 计入 45 分钟（E1：含训练中 dev 与训练后新模型+ck180 共同 holdout）；active 硬顶 228 分钟，到点不追批、尾部完成标签只计数不训练',
    interruption: '检查点记录权重/优化器/步数/RNG调用计数；中断不自动续跑，如实标 partial',
  }, null, 2));
  const init = new MLP(M.initSeed);
  saveCk(join(run, 'init'), init, { note: `CLEAN1${VARIANT === 'e1' ? ' E1 复制' : ''}随机初始化`, seed: M.initSeed, init: 'MLP(seed): Box-Muller 正态 × He(std=1/sqrt(fan_in))，偏置 0', createdAt: new Date().toISOString() });
  manifest(run, 'prep');
  writeFileSync(join(run, 'status.json'), JSON.stringify({ phase: 'prep', failed: false, variant: VARIANT, at: new Date().toISOString() }, null, 2));
  console.log(`CLEAN1 prep 完成（variant=${VARIANT}）: ${run}`);
  console.log(JSON.stringify({ seedBlocks: { nnDev: seeds.nnDev.length, nnHoldout: seeds.nnHoldout.length, partner: seeds.partner.length }, initSeed: M.initSeed }, null, 2));
}

// ---------- train ----------
async function train(): Promise<void> {
  const run = runDir();
  const status = loadJson<{ phase: string; failed: boolean }>(join(run, 'status.json'));
  if (status.failed) throw new Error('run 已标记 failed，不得续跑');
  const seeds = loadJson<{ seeds: { nnDev: number[] } }>(join(run, 'seeds.json')).seeds;
  // 变体 master 从本 run 协议读回（E1 复制：全部随机流与原 run 不同）
  const protocol = loadJson<{ variant?: string; master: typeof MASTER }>(join(run, 'protocol.json'));
  const M = protocol.master;
  const matchSeedAtV = (i: number): number => hash32(M.matchRand, i);
  const matchSeedAtSmokeV = (i: number): number => hash32(M.matchRand ^ 0x50A1E7, i);
  const stepSeedAtV = (i: number): number => hash32(M.stepSeed, i);
  const counters = newCounters();
  const capMs = SMOKE_MIN ? SMOKE_MIN * 60_000 : CFG.budgetTrainActiveMin * 60_000;
  const ckPlan: number[] = SMOKE_MIN ? [SMOKE_MIN * 0.5] : [...CFG.checkpointsActiveMin];
  const ckTagOf = (min: number): string => (SMOKE_MIN ? 'ck_smoke' : `ck${min}`);
  const wall0 = Date.now();
  const ledgerPath = join(run, 'runtime_ledger.jsonl');
  const progPath = join(run, 'train_progress.jsonl');
  writeFileSync(ledgerPath, ''); writeFileSync(progPath, '');

  // 干净起点：加载 prep 落盘的随机初始化（不读任何旧资产）
  const model = loadMlp(join(run, 'init'));
  const initWeights = model.getWeights().slice();
  const bridge = new LearnerBridge('cpu');
  const env = await bridge.init(INPUT_DIM, model.getWeights(), { run: 'CLEAN1', ...CFG });
  console.log('learner env:', JSON.stringify(env));

  const shuffleRand = new CountingRng(M.shuffleRand);
  const seatRand = new CountingRng(M.seatRand);
  const pool: Array<{ feat: Float32Array; y: number }> = [];
  let matches = 0, games = 0, decisions = 0, collected = 0, used = 0, discarded = 0,
    updates = 0, nonfinite = 0, capped = 0, matchIdx = 0, tailLeft = 0;
  const losses: number[] = []; const stepMsArr: number[] = [];
  let ckIdx = 0, loopDone = false, failed = false;
  const devResults: Record<string, { vs0: number[]; vs1: number[] }> = {};

  const markFailed = async (kind: string, repro: unknown): Promise<never> => {
    failed = true;
    writeFileSync(join(run, 'failure_repro.json'), JSON.stringify({ kind, at: new Date().toISOString(), counters, updates, matches, repro }, null, 2));
    writeFileSync(join(run, 'status.json'), JSON.stringify({ phase: 'train', failed: true, kind, at: new Date().toISOString() }, null, 2));
    console.error(`一致性违例 ${kind}：已保存最小复现并标记 failed`);
    try { await bridge.shutdown(); } catch { /* 已退出 */ }
    throw new Error(`CLEAN1 failed: ${kind}`);
  };

  // active 时钟：eval 期间暂停
  let activeAccum = 0; let activeMark = Date.now();
  const pauseActive = (): number => { activeAccum += Date.now() - activeMark; return activeAccum; };
  const resumeActive = (): void => { activeMark = Date.now(); };
  const activeMs = (): number => activeAccum + (Date.now() - activeMark);

  // init dev 评测（训练前基线；计入 eval 预算）
  {
    const tEval = Date.now();
    pauseActive();
    devResults.init = {
      vs0: evalNNSet(run, model, 0, seeds.nnDev, 'init', 'dev_init_vs0').xs,
      vs1: evalNNSet(run, model, 1, seeds.nnDev, 'init', 'dev_init_vs1').xs,
    };
    appendJson(ledgerPath, { phase: 'dev_init', evalMs: Date.now() - tEval });
    resumeActive();
  }

  outer: while (activeMs() < capMs - Math.min(90_000, capMs * 0.1)) {
    // —— 采样一整场 ——
    let r: ReturnType<typeof sampleMatchStrict>;
    try {
      const seedFn = SMOKE_MIN ? matchSeedAtSmokeV : matchSeedAtV;
      r = sampleMatchStrict(model, CFG.eps, seedFn(matchIdx++), () => seatRand.next(), counters);
    } catch (e) {
      if (e instanceof ContractError) await markFailed(e.kind, e.repro);
      throw e;
    }
    matches += 1; games += r.games; decisions += r.decisions;
    if (r.capped) capped += 1;
    if (r.samples.length) { pool.push(...r.samples.map((s) => ({ feat: s.feat, y: s.y }))); collected += r.samples.length; }

    // —— 学习（每 2048 完成 → 固定流打乱 → 前 1024 一步，余弃样计数）——
    while (pool.length >= CFG.groupSize) {
      if (activeMs() > capMs - Math.min(30_000, capMs * 0.05)) break outer; // 到点不追批
      const group = pool.splice(0, CFG.groupSize);
      const idx = Array.from({ length: CFG.groupSize }, (_, i) => i);
      for (let i = CFG.groupSize - 1; i > 0; i--) {
        const j = (shuffleRand.next() * (i + 1)) | 0;
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      const ids = idx.slice(0, CFG.trainSub);
      const f = new Float32Array(ids.length * INPUT_DIM);
      const t = new Float32Array(ids.length);
      ids.forEach((id, k) => { f.set(group[id].feat, k * INPUT_DIM); t[k] = group[id].y; });
      const rep = await bridge.train(f, t, ids.length, INPUT_DIM, stepSeedAtV(updates));
      updates += 1; used += rep.nTrain; discarded += CFG.groupSize - rep.nTrain;
      losses.push(rep.lossBefore); stepMsArr.push(rep.stepMs);
      if (rep.nonfinite) await markFailed('nonfinite_step', { updates, lossBefore: rep.lossBefore, gradNorm: rep.gradNorm });
      model.setWeights(await bridge.getWeights()); // 场间换权：下一场生效
      appendJson(progPath, { atActiveMs: Math.round(activeMs()), updates, loss: rep.lossBefore, lossSub: rep.lossSub, gradNorm: rep.gradNorm, nTrain: rep.nTrain });
    }

    // —— active 检查点（20/60/120/180：存档+机制检查+dev 评测）——
    if (ckIdx < ckPlan.length && activeMs() >= ckPlan[ckIdx] * 60_000) {
      ckIdx += 1;
      const tag = ckTagOf(ckPlan[ckIdx - 1]);
      const atActiveMin = +(activeMs() / 60000).toFixed(2);
      const tEval = Date.now();
      pauseActive();
      saveCk(join(run, tag), model, {
        atActiveMin, updates, matches, matchIdx, collected,
        shuffleCalls: shuffleRand.calls, seatCalls: seatRand.calls,
        counters: { ...counters }, rngState: '计数器制：matchSeed=hash(master,matchIdx)；shuffle/seat 调用数如上可复算',
      });
      await bridge.save(join(run, tag));
      // 机制检查（20 分钟门=只判机制不判胜负）
      const wNow = model.getWeights();
      let maxDelta = 0;
      for (let i = 0; i < wNow.length; i++) { const dd = Math.abs(wNow[i] - initWeights[i]); if (dd > maxDelta) maxDelta = dd; }
      const reload = loadMlp(join(run, tag));
      let reloadOk = reload.getWeights().length === wNow.length;
      if (reloadOk) { const rw = reload.getWeights(); for (let i = 0; i < wNow.length; i++) if (rw[i] !== wNow[i]) { reloadOk = false; break; } }
      const mech = {
        tag, atActiveMin, paramsChangedVsInit: maxDelta > 0, maxDelta: +maxDelta.toExponential(3),
        saveLoadBitwise: reloadOk, countersZero: Object.values(counters).every((v) => v === 0),
        lossesFinite: losses.every(Number.isFinite),
      };
      appendJson(join(run, 'mechanism_checks.jsonl'), mech);
      console.log(tag, '机制检查:', JSON.stringify(mech));
      if (!mech.paramsChangedVsInit) await markFailed('params_not_updating', { tag, updates });
      if (!mech.saveLoadBitwise) await markFailed('save_load_mismatch', { tag });
      if (!mech.countersZero) await markFailed('contract_counters_nonzero', { tag, counters });
      devResults[tag] = {
        vs0: evalNNSet(run, model, 0, seeds.nnDev, tag, `dev_${tag}_vs0`).xs,
        vs1: evalNNSet(run, model, 1, seeds.nnDev, tag, `dev_${tag}_vs1`).xs,
      };
      appendJson(ledgerPath, { phase: `ck_${tag}`, evalMs: Date.now() - tEval, atActiveMin });
      resumeActive();
    }
  }
  loopDone = true;
  tailLeft = pool.length; // 尾部完成标签：只计数保存，不追批

  // —— 终点：ck228 存档 + 终评（不计 active；计入 eval 预算）——
  // A4 账目修复：atActiveMin 在 pauseActive() 之后读取（旧版读到未含 ck180 后
  // 采样段的过期 activeAccum，少报 46 分钟）；evalMsTotal 改为 ledger 全程评测累计。
  const tEval = Date.now();
  const finalActiveMs = pauseActive(); // 先暂停并取真实累计
  const atActiveMin = +(finalActiveMs / 60000).toFixed(2);
  saveCk(join(run, 'ck228'), model, {
    atActiveMin, updates, matches, matchIdx, collected,
    shuffleCalls: shuffleRand.calls, seatCalls: seatRand.calls, counters: { ...counters },
  });
  await bridge.save(join(run, 'ck228'));
  devResults.ck228 = {
    vs0: evalNNSet(run, model, 0, seeds.nnDev, 'ck228', 'dev_ck228_vs0').xs,
    vs1: evalNNSet(run, model, 1, seeds.nnDev, 'ck228', 'dev_ck228_vs1').xs,
  };
  appendJson(ledgerPath, { phase: 'ck_228', evalMs: Date.now() - tEval });
  // 全程评测累计（dev_init + 各检查点 + ck228），从 ledger 汇总
  const evalMsTotal = readFileSync(ledgerPath, 'utf8').toString().split('\n')
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as { evalMs?: number })
    .reduce((s, e) => s + (e.evalMs ?? 0), 0);

  const summary = {
    env, cfg: CFG, counters, matches, games, decisions, collectedSamples: collected,
    trainedSamples: used, discardedByBudget: discarded, tailLeft, updates, nonfiniteSteps: nonfinite, cappedMatches: capped,
    trainActiveMin: atActiveMin, evalMinTotal: +(evalMsTotal / 60000).toFixed(2),
    wallMin: +((Date.now() - wall0) / 60000).toFixed(2), loopDone,
    lossFirst: losses[0], lossLast: losses[losses.length - 1],
    stepMsAvg: stepMsArr.length ? +(stepMsArr.reduce((a, b) => a + b, 0) / stepMsArr.length).toFixed(2) : 0,
    dev: Object.fromEntries(Object.entries(devResults).map(([k, v]) => [k, {
      vsEasy: blockStats(v.vs0, 0.95), vsMid: blockStats(v.vs1, 0.95),
    }])),
  };
  writeFileSync(join(run, 'train_summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(run, 'status.json'), JSON.stringify({ phase: 'train-done', failed: false, at: new Date().toISOString() }, null, 2));
  manifest(run, 'train_end');
  appendJson(ledgerPath, { phase: 'train', trainActiveMs: Math.round(activeAccum), wallMs: Date.now() - wall0 });
  console.log('CLEAN1 训练完成:', JSON.stringify({
    counters, updates, collected, used, discarded, tailLeft, capped,
    trainActiveMin: summary.trainActiveMin, wallMin: summary.wallMin,
  }));
  await bridge.shutdown();
}

// ---------- select（事前固定规则，机械执行） ----------
function select(): void {
  const run = runDir();
  const s = loadJson<{ dev: Record<string, { vsEasy: { mean: number }; vsMid: { mean: number } }> }>(join(run, 'train_summary.json'));
  const cands = ['ck60', 'ck120', 'ck180', 'ck228'];
  const rows = cands.map((c) => ({ c, mid: s.dev[c]?.vsMid.mean ?? -1, easy: s.dev[c]?.vsEasy.mean ?? -1 }));
  rows.sort((a, b) => b.mid - a.mid || b.easy - a.easy || cands.indexOf(b.c) - cands.indexOf(a.c)); // 仍平手取更晚
  const chosen = rows[0].c;
  writeFileSync(join(run, 'selection.json'), JSON.stringify({ rule: CFG.selectionRule, rows, chosen, at: new Date().toISOString() }, null, 2));
  console.log('候选选择（事前固定规则）:', JSON.stringify({ rows, chosen }));
}

// ---------- holdout（最终只评选定候选；init 配对） ----------
function holdout(): void {
  const run = runDir();
  const sel = loadJson<{ chosen: string }>(join(run, 'selection.json'));
  const protocol = loadJson<{ variant?: string; baseRun?: string }>(join(run, 'protocol.json'));
  const seeds = loadJson<{ seeds: { nnHoldout: number[] } }>(join(run, 'seeds.json')).seeds;
  const final = loadMlp(join(run, sel.chosen));
  const init = loadMlp(join(run, 'init'));
  const tEval = Date.now();
  const finE = evalNNSet(run, final, 0, seeds.nnHoldout, sel.chosen, 'holdout_final_vs0');
  const finM = evalNNSet(run, final, 1, seeds.nnHoldout, sel.chosen, 'holdout_final_vs1');
  const initE = evalNNSet(run, init, 0, seeds.nnHoldout, 'init', 'holdout_init_vs0');
  const evalMin = +((Date.now() - tEval) / 60000).toFixed(2);
  const paired = pairedBlockStats(finE.xs, initE.xs, 0.95);
  const sE = finE.summary as { pointEstimate: number; ci95: number[] };
  const sM = finM.summary as { pointEstimate: number; ci95: number[] };
  const out: Record<string, unknown> = {
    chosen: sel.chosen, holdoutBlocks: seeds.nnHoldout.length, evalMin,
    finalVsEasy: finE.summary, finalVsMid: finM.summary, initVsEasy: initE.summary,
    pairedFinalMinusInitVsEasy: paired,
    layer2_effectiveLearning: { diff: +paired.diff.toFixed(4), ci95: [+paired.ciLow.toFixed(4), +paired.ciHigh.toFixed(4)], pass: paired.diff > 0 && paired.ciLow > 0 },
    layer3_trialVsEasy: { pass: sE.pointEstimate >= 0.6 && sE.ci95[0] > 0.5 },
    layer3_trialVsMid: { pass: sM.pointEstimate >= 0.6 && sM.ci95[0] > 0.5 },
  };
  // E1：原 ck180 在同一批新 holdout 上配对评估（区分训练差异与评测样本差异；原 run 的旧 holdout 不重读）
  if (protocol.variant === 'e1' && protocol.baseRun) {
    const baseSel = loadJson<{ chosen: string }>(join(import.meta.dirname, '..', '..', protocol.baseRun, 'selection.json'));
    const ck180 = loadMlp(join(import.meta.dirname, '..', '..', protocol.baseRun, baseSel.chosen));
    const bE = evalNNSet(run, ck180, 0, seeds.nnHoldout, `base_${baseSel.chosen}`, 'holdout_base_vs0');
    const bM = evalNNSet(run, ck180, 1, seeds.nnHoldout, `base_${baseSel.chosen}`, 'holdout_base_vs1');
    out.e1Comparison = {
      note: `原 ${baseSel.chosen} 与新选定模型在同一批新 holdout（128 块）按 seed 配对；不重读原 run 旧 holdout`,
      baseVsEasy: bE.summary, baseVsMid: bM.summary,
      newMinusBase_vsEasy: pairedBlockStats(finE.xs, bE.xs, 0.95),
      newMinusBase_vsMid: pairedBlockStats(finM.xs, bM.xs, 0.95),
      evalMinTotal: +((Date.now() - tEval) / 60000).toFixed(2),
    };
  }
  writeFileSync(join(run, 'holdout_summary.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  appendJson(join(run, 'runtime_ledger.jsonl'), { phase: 'holdout', evalMs: Date.now() - tEval });
}

// ---------- partner（§6.7：选定模型 64 整场；与三档代理同 32 块配对） ----------
function partner(): void {
  const run = runDir();
  const sel = loadJson<{ chosen: string }>(join(run, 'selection.json'));
  const seeds = loadJson<{ seeds: { partner: number[] } }>(join(run, 'seeds.json')).seeds;
  const mlp = loadMlp(join(run, sel.chosen));
  const MID = 1 as Difficulty;
  const path = join(run, 'partner_nn_perseed.jsonl');
  writeFileSync(path, '');
  const xs: number[] = [];
  let unfinished = 0;
  for (let i = 0; i < seeds.partner.length; i++) {
    const seed = seeds.partner[i];
    let wins = 0;
    for (const side of [0, 1] as const) {
      // 与三档代理同布局规则：一半 [D,O,P,O]/[O,D,O,P]；一半 [P,O,D,O]/[O,P,O,D]
      const dSeat = i < seeds.partner.length / 2 ? (side === 0 ? 0 : 1) : (side === 0 ? 2 : 3);
      const t0 = performance.now();
      const match = createMatch({ ...DEFAULT_RULES }, nnMatchSeed(seed));
      const decider = new NeuralDecider(dSeat, mlp, 0, () => 0);
      const ais = [0, 1, 2, 3].map((s) =>
        (s === dSeat ? null : createAI(s, MID, nnAiSeed(seed, side, s)))); // P/O 全中级
      let games = 0;
      while (match.winner == null && games < 80) {
        const state = startGame(match);
        ais.forEach((p) => p?.reset(state, match.opts));
        decider.newGame();
        let guard = 0;
        while (!state.over && guard++ < 2500) {
          const turn = state.turn;
          const toBeat = state.lastCombo;
          let move: { pass: boolean; combo?: Combo };
          if (turn === dSeat) {
            move = decider.decide(state).move;
            if (!isMoveLegal(state, move as never)) throw new ContractError('illegalIntent', { eval: 'partner_nn', seed, side, games });
          } else move = ais[turn]!.decide(state) as { pass: boolean; combo?: Combo };
          const events = applyMove(state, guardMove(state, move as never) as never);
          decider.observe(events);
          ais.forEach((p) => p?.observe(events, toBeat));
        }
        games += 1;
      }
      const un = match.winner == null;
      if (un) unfinished += 1;
      const nnTeam = (dSeat & 1) as 0 | 1;
      const win = !un && match.winner === nnTeam ? 1 : 0;
      wins += win;
      appendJson(path, { seed, side, dSeat, ms: +(performance.now() - t0).toFixed(1), unfinished: un, win });
    }
    xs.push(wins / 2);
  }
  const est = blockStats(xs, 0.95);
  // 三档代理同种子逐块 X_s（初级 D / 中级 D），配对比较
  // 注意：tiers 侧记录字段为 base_seed（TierMatchRec），NN 侧为 seed（NNMatchRec）
  const tierRecs = readFileSync(join(import.meta.dirname, '..', 'tiers', 'partner_perseed.jsonl'))
    .toString().split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as {
      base_seed: number; tier: number; win: number; dSeat: number; unfinished: boolean; aTeam: number;
    });
  const tierXs = (tier: number): number[] => {
    const bySeed = new Map<number, number>();
    for (const r of tierRecs) {
      if (r.tier !== tier || r.unfinished) continue;
      const dTeam = r.dSeat & 1;
      const dWin = (r.win === 1 && r.aTeam === dTeam) || (r.win === 0 && r.aTeam !== dTeam) ? 1 : 0;
      bySeed.set(r.base_seed, (bySeed.get(r.base_seed) ?? 0) + dWin);
    }
    return seeds.partner.map((sd) => (bySeed.get(sd) ?? 0) / 2);
  };
  const vsEasy = pairedBlockStats(xs, tierXs(0), 0.95);
  const vsMid = pairedBlockStats(xs, tierXs(1), 0.95);
  const out = {
    policyId: `${sel.chosen}+中级P`, blocks: xs.length, unfinished,
    nnPlusP: est,
    paired_vs_easyPlusP: { ...vsEasy, flag: vsEasy.diff < -0.10 && vsEasy.ciHigh < 0 },
    paired_vs_midPlusP: { ...vsMid, flag: vsMid.diff < -0.10 && vsMid.ciHigh < 0 },
  };
  writeFileSync(join(run, 'partner_summary.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

// ---------- ablation（NN_PASS_MIN；holdout 前 64 块 × 2 边 = 128 场，仅对初级） ----------
function ablation(): void {
  const run = runDir();
  const sel = loadJson<{ chosen: string }>(join(run, 'selection.json'));
  const seedsAll = loadJson<{ seeds: { nnHoldout: number[] } }>(join(run, 'seeds.json')).seeds;
  const blocks = seedsAll.nnHoldout.slice(0, CFG.ablationBlocks); // 事前固定前 64 块
  const mlp = loadMlp(join(run, sel.chosen));
  const t0 = Date.now();
  const abl = evalNNSet(run, mlp, 0, blocks, 'NN_PASS_MIN', 'ablation_passmin_vs0', 'pass_min');
  // 完整模型对初级同种子 128 场：直接复用 holdout_final_vs0（不重跑）
  const fullRecs = readFileSync(join(run, 'holdout_final_vs0_perseed.jsonl'))
    .toString().split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { seed: number; win: number; unfinished: boolean });
  const bySeed = new Map<number, number>();
  for (const r of fullRecs) if (!r.unfinished) bySeed.set(r.seed, (bySeed.get(r.seed) ?? 0) + r.win);
  const fullXs = blocks.map((sd) => (bySeed.get(sd) ?? 0) / 2);
  const d = pairedBlockStats(fullXs, abl.xs, 0.95);
  const out = {
    policy: 'NN_PASS_MIN：网络选pass→pass；选非pass→显式选预定的最小合法非pass动作（枚举序首个非pass），作为意图过 strict 守卫，不产生训练样本',
    blocks: blocks.length, full: blockStats(fullXs, 0.95), passMin: abl.summary,
    D_s_full_minus_passmin: d,
    conclusion: d.ciLow > 0 ? '非pass排序有正贡献证据' : '整体学习有/无证据，非pass排序贡献尚未分清（区间跨0）',
    evalMin: +((Date.now() - t0) / 60000).toFixed(2),
  };
  writeFileSync(join(run, 'ablation_summary.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

const mode = process.argv[2];
// 仅作为入口直跑时执行（被其他模块 import 时只提供函数，参照 round2.ts 守卫）
if (process.argv[1] && process.argv[1].endsWith('clean1.ts')) {
  if (mode === 'prep') prep();
  else if (mode === 'train') await train().catch((e: unknown) => { console.error(e); process.exit(1); });
  else if (mode === 'select') select();
  else if (mode === 'holdout') holdout();
  else if (mode === 'partner') partner();
  else if (mode === 'ablation') ablation();
  else { console.error('用法: clean1.ts prep|train|select|holdout|partner|ablation'); process.exit(1); }
}
