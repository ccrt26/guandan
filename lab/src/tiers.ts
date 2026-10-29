/**
 * lab/src/tiers.ts — 三档能力校准评测台（CLEAN1 方案第五节，2026-10-26）。
 *
 * §5.1 发布配置即评测配置：三档 = packages/ai LEVEL_CAPS[0|1|2]（HeuristicPlayer
 * 同一决策核心 + 能力开关 + 温度噪声），调用路径与真实游戏完全一致
 * （HomePage→MatchController→createAI→LEVEL_CAPS）。难度开关同时改全部 3 个
 * AI 座位（真实产品语义，已记录）。评测使用产品本来的随机失误（噪声），
 * AI 随机流与发牌流分离、各自固定。
 *
 * §5.2 整场配对循环赛：每个 seed 两边 side0=[A,B,A,B]、side1=[B,A,B,A]；
 * 同 seed 两边使用相同 matchSeed（同一初始发牌/先手），编号不作洗牌变换；
 * X_s = 两边 A 队胜负之和 / 2；seed 块为独立单位（§7.1）。
 *
 * §5.4 门槛：上档点估计 ≥60% 且 97.5% 块 bootstrap 区间下界 >50%（两个主
 * 相邻比较）；同时报告普通 95% 区间。全胜/全败零方差时用 Hoeffding 保守界。
 *
 * §5.5 共同搭档代理：P=中级搭档、O=中级对手、D=待测单席；一半 seed 两边
 * [D,O,P,O]/[O,D,O,P]，另一半 [P,O,D,O]/[O,P,O,D]。
 *
 * 模式：prep（事前落盘种子与配置哈希）→ speed（测速，独立种子）→
 *       dev（32 块现状）→ holdout（128 块验收，只在冻结后读一次）→
 *       partner（32 块代理筛查）。评测数量事前锁定；不因结果加跑。
 * 用法: npx tsx lab/src/tiers.ts prep|speed|dev|holdout|partner
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { EOL } from 'node:os';
import { join } from 'node:path';
import { applyMove, createMatch, DEFAULT_RULES, startGame, type Combo, type GameState } from '@gd/engine';
import { createAI, guardMove, LEVEL_CAPS, DIFFICULTY_NAME, type Difficulty, type Move } from '@gd/ai';
import { mulberry32 } from '@gd/ai';

const TDIR = join(import.meta.dirname, '..', 'tiers');
mkdirSync(TDIR, { recursive: true });
const MATCH_GAME_CAP = 80;

// ---------- 种子管理：prep 事前生成并落盘；运行模式只读已落盘文件 ----------
function genSeeds(n: number, seedBase: number): number[] {
  const r = mulberry32(seedBase);
  return Array.from({ length: n }, () => 1_000_000 + Math.floor(r() * 9_000_000));
}
const SEED_SPEC = {
  speed: { n: 10, base: 2026102704 },
  dev: { n: 32, base: 2026102701 },
  holdout: { n: 128, base: 2026102702 },
  partner: { n: 32, base: 2026102703 },
} as const;
const STAT_BOOT_SEED = 20261027;

function loadSeeds(kind: keyof typeof SEED_SPEC): number[] {
  const p = join(TDIR, 'seeds.json');
  if (!existsSync(p)) throw new Error('种子未落盘：先运行 `npx tsx lab/src/tiers.ts prep`（看结果前锁定）');
  const j = JSON.parse(readFileSync(p, 'utf8')) as { created: string; seeds: Record<string, number[]> };
  const arr = j.seeds?.[kind];
  if (!arr || arr.length !== SEED_SPEC[kind].n) throw new Error(`种子文件缺 ${kind} 或数量不符`);
  return arr;
}

// ---------- 配置指纹（policyId）：发布配置与代码版本绑定 ----------
function configHash(): { policyId: string; caps: unknown; files: Record<string, string> } {
  const root = join(import.meta.dirname, '..', '..');
  const files: Record<string, string> = {};
  for (const p of [
    join(root, 'packages/engine/src/combo.ts'), join(root, 'packages/engine/src/game.ts'),
    join(root, 'packages/engine/src/rank.ts'), join(root, 'packages/ai/src/types.ts'),
    join(root, 'packages/ai/src/heuristic.ts'), join(root, 'packages/ai/src/player.ts'),
    join(root, 'packages/ai/src/memory.ts'), join(root, 'packages/ai/src/planner.ts'),
    join(root, 'packages/ai/src/legal.ts'), join(root, 'packages/ai/src/sim.ts'),
  ]) {
    files[p.replace(root + '/', '')] = createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
  }
  const h = createHash('sha256').update(JSON.stringify({ files, caps: LEVEL_CAPS })).digest('hex').slice(0, 12);
  return { policyId: `tiers@${h}`, caps: LEVEL_CAPS, files };
}

// ---------- 整场对局 ----------
export interface TierMatchRec {
  base_seed: number; side: 0 | 1; matchSeed: number;
  seatDiffs: [Difficulty, Difficulty, Difficulty, Difficulty];
  firstLeader: number; initHandsHash: string;
  aTeam: 0 | 1; win: 0 | 1; games: number; moves: number; ms: number; unfinished: boolean;
}
/** 发牌种子：由 base seed 派生（不与 side 耦合——同 seed 两边同一副牌） */
function matchSeedOf(seed: number): number {
  return (Math.imul(seed, 0x9E3779B1) ^ 0xD1B54A35) >>> 0;
}
/** AI 随机流种子：独立派生，不推进发牌流 */
function aiSeedOf(seed: number, side: number, seat: number): number {
  return (Math.imul(seed, 0x85EBCA77) ^ Math.imul(side + 1, 0xC2B2AE35) ^ Math.imul(seat + 1, 0x27D4EB2F)) >>> 0;
}

export function playTierMatch(
  seatDiffs: [Difficulty, Difficulty, Difficulty, Difficulty], seed: number, side: 0 | 1,
): TierMatchRec {
  const t0 = performance.now();
  const matchSeed = matchSeedOf(seed);
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const ais = [0, 1, 2, 3].map((s) => createAI(s, seatDiffs[s], aiSeedOf(seed, side, s)));
  let games = 0, moves = 0, firstLeader = -1;
  let initHandsHash = '';
  while (match.winner == null && games < MATCH_GAME_CAP) {
    const state: GameState = startGame(match);
    if (games === 0) {
      firstLeader = state.leader;
      initHandsHash = createHash('sha256')
        .update(state.hands.map((h) => h.map((c) => c.id).sort().join(',')).join('|')).digest('hex').slice(0, 16);
    }
    ais.forEach((p) => p.reset(state, match.opts));
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const toBeat = state.lastCombo;
      const raw = ais[state.turn].decide(state) as Move;
      const move = guardMove(state, raw) as Move;
      const events = applyMove(state, move as never);
      ais.forEach((p) => p.observe(events, toBeat));
      moves += 1;
    }
    games += 1;
  }
  const unfinished = match.winner == null;
  // A 队 = seat0/2 所在队（side0: A 坐 0/2；side1: A 坐 1/3）
  const aTeam = (side === 0 ? 0 : 1) as 0 | 1;
  const win = !unfinished && match.winner === aTeam ? 1 : 0;
  return {
    base_seed: seed, side, matchSeed, seatDiffs, firstLeader, initHandsHash,
    aTeam, win, games, moves, ms: +(performance.now() - t0).toFixed(1), unfinished,
  };
}

/** 三档对战组合：A=上档（视角），side0=[A,B,A,B] */
const PAIRS = [
  { name: 'mid_vs_easy', a: 1 as Difficulty, b: 0 as Difficulty, main: true },
  { name: 'high_vs_mid', a: 2 as Difficulty, b: 1 as Difficulty, main: true },
  { name: 'high_vs_easy', a: 2 as Difficulty, b: 0 as Difficulty, main: false },
] as const;

function runPairSet(kind: 'dev' | 'holdout', pairs: readonly typeof PAIRS): void {
  const seeds = loadSeeds(kind);
  const cfg = configHash();
  const outDir = join(TDIR, kind);
  mkdirSync(outDir, { recursive: true });
  const summary: Record<string, unknown> = { kind, policyId: cfg.policyId, pairs: {} };
  for (const pr of PAIRS) {
    if (!pairs.some((p) => p.name === pr.name)) continue;
    const path = join(outDir, `${pr.name}_perseed.jsonl`);
    writeFileSync(path, '');
    const xs: number[] = [];
    let unfinished = 0, msSum = 0;
    for (const seed of seeds) {
      let aWins = 0;
      const hashes: string[] = [];
      for (const side of [0, 1] as const) {
        const seatDiffs = (side === 0
          ? [pr.a, pr.b, pr.a, pr.b] : [pr.b, pr.a, pr.b, pr.a]) as [Difficulty, Difficulty, Difficulty, Difficulty];
        const rec = playTierMatch(seatDiffs, seed, side);
        if (rec.unfinished) unfinished += 1;
        aWins += rec.win;
        hashes.push(rec.initHandsHash);
        appendFileSync(path, `${JSON.stringify(rec)}${EOL}`);
        msSum += rec.ms;
      }
      if (hashes[0] !== hashes[1]) throw new Error(`seed=${seed} 两边初始牌面校验值不一致（发牌耦合检查失败）`);
      xs.push(aWins / 2);
    }
    const est = blockStats(xs, pr.main ? 0.975 : 0.95);
    summary.pairs = { ...(summary.pairs as object), [pr.name]: {
      A: DIFFICULTY_NAME[pr.a], B: DIFFICULTY_NAME[pr.b], blocks: xs.length,
      pointEstimate: +est.mean.toFixed(4), ci: `${(est.ciLow * 100).toFixed(1)}%..${(est.ciHigh * 100).toFixed(1)}%`,
      ciLevel: pr.main ? '97.5%' : '95%', method: est.method,
      winsRaw: xs.reduce((s, x) => s + x * 2, 0), matches: xs.length * 2, unfinished,
      msAvg: +(msSum / (xs.length * 2)).toFixed(0),
      gate60: est.mean >= 0.6 && est.ciLow > 0.5,
    } };
    console.log(pr.name, JSON.stringify((summary.pairs as Record<string, unknown>)[pr.name]));
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
}

// ---------- §7.1 种子块统计（实现移至 stats.ts；固定统计种子 20261027） ----------
export { blockStats, pairedBlockStats } from './stats';
import { blockStats, pairedBlockStats } from './stats';

// ---------- §5.5 共同搭档代理 ----------
function runPartner(): void {
  const seeds = loadSeeds('partner');
  const cfg = configHash();
  const P = 1 as Difficulty, O = 1 as Difficulty; // 搭档与对手固定中级
  const byTier: Record<Difficulty, number[]> = { 0: [], 1: [], 2: [] };
  const path = join(TDIR, 'partner_perseed.jsonl');
  writeFileSync(path, '');
  let unfinished = 0;
  for (const tier of [0, 1, 2] as Difficulty[]) {
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      let dTeamWins = 0;
      for (const side of [0, 1] as const) {
        // 一半 seed：[D,O,P,O]/[O,D,O,P]；另一半：[P,O,D,O]/[O,P,O,D]（D 绝对座位覆盖 0..3）
        // dSeat 显式追踪（中级 D 时与 O 同档，不能用 indexOf 判位）
        const layout = i < seeds.length / 2
          ? (side === 0
            ? { seats: [tier, O, P, O] as Difficulty[], dSeat: 0 }
            : { seats: [O, tier, O, P] as Difficulty[], dSeat: 1 })
          : (side === 0
            ? { seats: [P, O, tier, O] as Difficulty[], dSeat: 2 }
            : { seats: [O, P, O, tier] as Difficulty[], dSeat: 3 });
        const rec = playTierMatch(layout.seats as [Difficulty, Difficulty, Difficulty, Difficulty], seed, side);
        if (rec.unfinished) unfinished += 1;
        const dTeam = (layout.dSeat & 1) as 0 | 1;
        if (!rec.unfinished && ((rec.aTeam === dTeam) === (rec.win === 1))) dTeamWins += 1;
        appendFileSync(path, `${JSON.stringify({ ...rec, tier, dSeat: layout.dSeat, layout: layout.seats })}${EOL}`);
      }
      byTier[tier].push(dTeamWins / 2);
    }
    const est = blockStats(byTier[tier], 0.95);
    console.log(`partner D=${DIFFICULTY_NAME[tier]}: 点估计 ${(est.mean * 100).toFixed(1)}% 95%CI ${(est.ciLow * 100).toFixed(1)}..${(est.ciHigh * 100).toFixed(1)} (${est.method})`);
  }
  const adj = [
    { name: 'high-mid', a: byTier[2], b: byTier[1] },
    { name: 'mid-easy', a: byTier[1], b: byTier[0] },
  ];
  const stats = {
    policyId: cfg.policyId, unfinished,
    byTier: {
      easy: blockStats(byTier[0], 0.95), mid: blockStats(byTier[1], 0.95), high: blockStats(byTier[2], 0.95),
    },
    adjacent: adj.map((x) => ({ name: x.name, ...pairedBlockStats(x.a, x.b, 0.95) })),
  };
  for (const a of stats.adjacent) {
    const flag = a.diff < -0.10 && a.ciHigh < 0;
    console.log(`代理相邻差 ${a.name}: ${(a.diff * 100).toFixed(1)}pp 95%CI ${(a.ciLow * 100).toFixed(1)}..${(a.ciHigh * 100).toFixed(1)}${flag ? ' ← 明确合作退步线索（先解释/修复再称更强）' : ''}`);
  }
  writeFileSync(join(TDIR, 'partner_summary.json'), JSON.stringify(stats, null, 2));
}

// ---------- 模式入口 ----------
function prep(): void {
  const seeds: Record<string, number[]> = {};
  for (const [k, spec] of Object.entries(SEED_SPEC)) seeds[k] = genSeeds(spec.n, spec.base);
  writeFileSync(join(TDIR, 'seeds.json'), JSON.stringify({ created: new Date().toISOString(), seeds }, null, 2));
  const cfg = configHash();
  writeFileSync(join(TDIR, 'config.json'), JSON.stringify(cfg, null, 2));
  console.log('种子与配置指纹已落盘（看结果前锁定）：');
  console.log(JSON.stringify({ policyId: cfg.policyId, caps: cfg.caps, seedCounts: Object.fromEntries(Object.entries(seeds).map(([k, v]) => [k, v.length])) }, null, 2));
}

function speed(): void {
  const seeds = loadSeeds('speed');
  const t0 = Date.now();
  let ms = 0, n = 0, unfinished = 0;
  for (const pr of PAIRS) {
    for (const seed of seeds) {
      for (const side of [0, 1] as const) {
        const seatDiffs = (side === 0 ? [pr.a, pr.b, pr.a, pr.b] : [pr.b, pr.a, pr.b, pr.a]) as [Difficulty, Difficulty, Difficulty, Difficulty];
        const rec = playTierMatch(seatDiffs, seed, side);
        ms += rec.ms; n += 1;
        if (rec.unfinished) unfinished += 1;
      }
    }
  }
  const per = ms / n;
  console.log(JSON.stringify({
    matches: n, unfinished, msAvg: +per.toFixed(0), secPerMatch: +(per / 1000).toFixed(3),
    dev192Min: +((per * 192) / 60000).toFixed(1), holdout768Min: +((per * 768) / 60000).toFixed(1),
    partner192Min: +((per * 192) / 60000).toFixed(1), totalMin: +((per * 1152) / 60000).toFixed(1),
    wallMin: +((Date.now() - t0) / 60000).toFixed(2),
  }, null, 2));
}

const mode = process.argv[2];
if (mode === 'prep') prep();
else if (mode === 'speed') speed();
else if (mode === 'dev') runPairSet('dev', PAIRS);
else if (mode === 'holdout') runPairSet('holdout', PAIRS);
else if (mode === 'partner') runPartner();
else { console.error('用法: tiers.ts prep|speed|dev|holdout|partner'); process.exit(1); }
void readFileSync; void readdirSync; void existsSync;
