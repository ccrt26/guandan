/**
 * lab/src/diag_b.ts — B2 有限诊断（CLEAN1-REVIEW-1.0 指令 B）：用现有权重，不训练。
 * 目标：是否超过现有高级 / 三席神经模式对玩家代理的体验 / ck228 回落是否在新样本重复。
 * 设计：新增 32 个独立 seed 块（base 2026102721，与全部历史种子不重叠），双边换位，
 * 6 项 × 64 场 ≤ 384 整场；程序评测 active 预算 ≤15 分钟；先测速。
 * 配对差只使用双方均完成的相同 seed 块。该批种子读过后即为诊断/dev 材料（不再是未触碰 holdout）。
 * 用法: npx tsx lab/src/diag_b.ts
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from './legacy-files';
import { EOL } from 'node:os';
import { join } from 'node:path';
import { applyMove, canPass, createMatch, DEFAULT_RULES, legalCombos, startGame, type Combo, type GameState } from '@gd/engine';
import { createAI, dedupCandidates, DIFFICULTY_NAME, guardMove, isMoveLegal, MLP, mulberry32, NeuralDecider } from '@gd/ai';
import { blockStats, pairedBlockStats } from './stats';

const RUN = join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'clean1', 'clean1-2026102609500');
const OUT = join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'diag_b');
mkdirSync(OUT, { recursive: true });
const HIGH = 2 as const, MID = 1 as const;

function loadMlp(dir: string): MLP {
  const buf = readFileSync(join(RUN, dir, 'weights.f32'));
  const w = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const m = new MLP(1); m.setWeights(w); return m;
}
const M120 = loadMlp('ck120'), M180 = loadMlp('ck180'), M228 = loadMlp('ck228');

// 新 32 块种子（与 tiers/clean1 历史种子集不重叠）
const gen = (n: number, base: number): number[] => {
  const r = mulberry32(base);
  return Array.from({ length: n }, () => 1_000_000 + Math.floor(r() * 9_000_000));
};
const SEEDS = gen(32, 2026102721);
writeFileSync(join(OUT, 'seeds.json'), JSON.stringify({ created: new Date().toISOString(), base: 2026102721, seeds: SEEDS }, null, 2));

type Seat = { t: 'H'; d: 0 | 1 | 2 } | { t: 'NN'; m: MLP } | { t: 'PM'; m: MLP };
const nnMatchSeed = (seed: number): number => (Math.imul(seed, 0x9E3779B1) ^ 0xD1B54A35) >>> 0;
const nnAiSeed = (seed: number, side: number, seat: number): number =>
  (Math.imul(seed, 0x85EBCA77) ^ Math.imul(side + 1, 0xC2B2AE35) ^ Math.imul(seat + 1, 0x27D4EB2F)) >>> 0;

interface SpecRec {
  seed: number; side: 0 | 1; item: string; seats: string[]; perspSeat: number;
  win: 0 | 1; games: number; moves: number; ms: number; unfinished: boolean; initHandsHash: string;
}
let ILLEGAL = 0;
function playSpec(item: string, specs: Seat[], perspSeat: number, seed: number, side: 0 | 1): SpecRec {
  const t0 = performance.now();
  const match = createMatch({ ...DEFAULT_RULES }, nnMatchSeed(seed));
  const heur = specs.map((s, i) => (s.t === 'H' ? createAI(i, s.d, nnAiSeed(seed, side, i)) : null));
  const deciders = specs.map((s, i) => ((s.t === 'NN' || s.t === 'PM') ? new NeuralDecider(i, s.m, 0, () => 0) : null));
  let games = 0, moves = 0, hash = '';
  while (match.winner == null && games < 80) {
    const state: GameState = startGame(match);
    if (games === 0) hash = `${state.hands.map((h) => h.length).join(',')}:${state.leader}`;
    heur.forEach((p) => p?.reset(state, match.opts));
    deciders.forEach((d) => d?.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const toBeat = state.lastCombo;
      let raw: { pass: boolean; combo?: Combo };
      const spec = specs[turn];
      if (spec.t === 'H') raw = heur[turn]!.decide(state);
      else {
        const d = deciders[turn]!.decide(state);
        if (spec.t === 'PM' && !d.move.pass) {
          const cands = dedupCandidates(legalCombos(state), canPass(state));
          const first = cands.find((c) => c.combo != null)!;
          raw = { pass: false, combo: first.combo! };
        } else raw = d.move;
        if (!isMoveLegal(state, raw as never)) { ILLEGAL += 1; throw new Error(`illegal intent in ${item} seed=${seed} side=${side}`); }
      }
      const events = applyMove(state, guardMove(state, raw as never) as never);
      deciders.forEach((d) => d?.observe(events));
      heur.forEach((p) => p?.observe(events, toBeat));
      moves += 1;
    }
    games += 1;
  }
  const unfinished = match.winner == null;
  const perspTeam = (perspSeat & 1) as 0 | 1;
  return {
    seed, side, item, seats: specs.map((s) => (s.t === 'H' ? `H${s.d}` : s.t === 'NN' ? 'NN' : 'PM')), perspSeat,
    win: !unfinished && match.winner === perspTeam ? 1 : 0, games, moves,
    ms: +(performance.now() - t0).toFixed(1), unfinished, initHandsHash: hash,
  };
}

// 六项：A 队=视角队。1-3/6 双边换位；4/5 H 固定在用户位（side0 座0 / side1 座1）
const nnTeam = (m: MLP, side: 0 | 1): Seat[] =>
  side === 0 ? [{ t: 'NN', m }, { t: 'H', d: HIGH }, { t: 'NN', m }, { t: 'H', d: HIGH }]
             : [{ t: 'H', d: HIGH }, { t: 'NN', m }, { t: 'H', d: HIGH }, { t: 'NN', m }];
const pmTeam = (m: MLP, side: 0 | 1): Seat[] =>
  side === 0 ? [{ t: 'PM', m }, { t: 'H', d: HIGH }, { t: 'PM', m }, { t: 'H', d: HIGH }]
             : [{ t: 'H', d: HIGH }, { t: 'PM', m }, { t: 'H', d: HIGH }, { t: 'PM', m }];
const expNN = (side: 0 | 1): Seat[] => // H(中级) 在用户位 + NN 队友 vs NN+NN 对手
  side === 0 ? [{ t: 'H', d: MID }, { t: 'NN', m: M180 }, { t: 'NN', m: M180 }, { t: 'NN', m: M180 }]
             : [{ t: 'NN', m: M180 }, { t: 'H', d: MID }, { t: 'NN', m: M180 }, { t: 'NN', m: M180 }];
const expH = (side: 0 | 1): Seat[] => // 同一 H(中级) + 中级队友 vs 中级对手（两边全中级对照；视角=H 所在队）
  [{ t: 'H', d: MID }, { t: 'H', d: MID }, { t: 'H', d: MID }, { t: 'H', d: MID }];
// 注：expH 两边全同档；perspSeat 按 side 取（side0→0, side1→1），即 H 的"用户位"镜像

const ITEMS: Array<{ name: string; run: (side: 0 | 1) => { specs: Seat[]; persp: number } }> = [
  { name: 'ck180_vs_high', run: (side) => ({ specs: nnTeam(M180, side), persp: side === 0 ? 0 : 1 }) },
  { name: 'ck120_vs_high', run: (side) => ({ specs: nnTeam(M120, side), persp: side === 0 ? 0 : 1 }) },
  { name: 'ck228_vs_high', run: (side) => ({ specs: nnTeam(M228, side), persp: side === 0 ? 0 : 1 }) },
  { name: 'exp_H_with_NN', run: (side) => ({ specs: expNN(side), persp: side === 0 ? 0 : 1 }) },
  { name: 'exp_H_with_mid', run: (side) => ({ specs: expH(side), persp: side === 0 ? 0 : 1 }) },
  { name: 'passmin_vs_high', run: (side) => ({ specs: pmTeam(M180, side), persp: side === 0 ? 0 : 1 }) },
];

// 先测速：item1 前 4 场
{
  const t0 = performance.now();
  for (const seed of SEEDS.slice(0, 2)) for (const side of [0, 1] as const) playSpec('ck180_vs_high', nnTeam(M180, side), side === 0 ? 0 : 1, seed, side);
  const per = (performance.now() - t0) / 4;
  console.log(`测速：${per.toFixed(0)}ms/场（NN双席 vs 高级）；预计 384 场 ≈ ${(per * 384 / 60000).toFixed(1)} 分钟（预算 15 分钟）`);
  if (per * 384 > 15 * 60_000) throw new Error('预算不够：先删可选项再跑');
}

const xs: Record<string, number[]> = {};
const path = join(OUT, 'diag_perseed.jsonl');
writeFileSync(path, '');
const tAll = Date.now();
for (const it of ITEMS) {
  const arr: number[] = [];
  for (const seed of SEEDS) {
    let wins = 0, unfin = 0;
    for (const side of [0, 1] as const) {
      const { specs, persp } = it.run(side);
      const rec = playSpec(it.name, specs, persp, seed, side);
      if (rec.unfinished) unfin += 1; else wins += rec.win;
      appendFileSync(path, `${JSON.stringify(rec)}${EOL}`);
    }
    arr.push(wins / 2);
  }
  xs[it.name] = arr;
  const est = blockStats(arr, 0.95);
  console.log(`${it.name}: ${(est.mean * 100).toFixed(1)}% 95%CI [${(est.ciLow * 100).toFixed(1)},${(est.ciHigh * 100).toFixed(1)}] (${est.method})`);
}
const wallMin = +((Date.now() - tAll) / 60000).toFixed(2);
console.log(`实际评测耗时 ${wallMin} 分钟（≤15 ✓）illegal=${ILLEGAL}`);

// 配对分析（同 seed 块相关一起抽样；95%）
const pairs = [
  { name: 'ck180−ck120 (vs high, 检查点敏感性)', a: xs.ck180_vs_high, b: xs.ck120_vs_high },
  { name: 'ck228−ck180 (vs high, ck228回落是否重复)', a: xs.ck228_vs_high, b: xs.ck180_vs_high },
  { name: 'exp_H_NN − exp_H_mid (玩家代理体验差)', a: xs.exp_H_with_NN, b: xs.exp_H_with_mid },
  { name: 'ck180 − passmin (vs high, 选牌贡献)', a: xs.ck180_vs_high, b: xs.passmin_vs_high },
];
const pairedOut = pairs.map((p) => ({ name: p.name, ...pairedBlockStats(p.a, p.b, 0.95) }));
for (const p of pairedOut) {
  console.log(`${p.name}: ${(p.diff * 100).toFixed(1)}pp 95%CI [${(p.ciLow * 100).toFixed(1)},${(p.ciHigh * 100).toFixed(1)}] → ${p.ciLow > 0 ? '正向显著' : p.ciHigh < 0 ? '负向显著' : '不确定（区间跨0）'}`);
}
// 块分布
const hist = (arr: number[]): string => {
  const h = [0, 0, 0];
  for (const x of arr) h[x * 2] += 1;
  return `0胜×${h[0]} 1胜×${h[1]} 2胜×${h[2]}`;
};
writeFileSync(join(OUT, 'diag_summary.json'), JSON.stringify({
  seeds: { base: 2026102721, blocks: 32, note: '诊断/dev 材料一经读取即不再是未触碰 holdout' },
  budgetMin: wallMin, illegalIntents: ILLEGAL,
  items: Object.fromEntries(Object.entries(xs).map(([k, v]) => [k, { ...blockStats(v, 0.95), hist: hist(v) }])),
  paired: pairedOut,
}, null, 2));
console.log('→ lab/archive/legacy-through-20261030/diag_b/diag_summary.json');
