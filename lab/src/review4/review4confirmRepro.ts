/**
 * lab/src/review4/review4confirmRepro.ts — REVIEW4 任务A4：两次确认原数据复现。
 * 评测/统计代码逐字取自 git f9dbe1f 的 lab/src/review2train.ts（= protocol-v3 冻结版，
 * hash 9cc1b92a9684…）；本脚本唯一新增=把 m1/m2 原始每块均值与全精度统计落盘。
 * 运行前提：engine/combo.ts、ai/nn/neuralSeat.ts、ai/heuristic.ts、ai/nn/nnplayer.ts
 * 已切换为冻结版本（见 audit/confirmation-recheck.json 的切换记录）。
 * 用法: npx tsx lab/src/review4/review4confirmRepro.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMove, createMatch, DEFAULT_RULES, startGame, type Combo, RNG,
} from '@gd/engine';
import { createAI, guardMove, isMoveLegal, MLP, mulberry32, NeuralDecider, deriveSeed } from '@gd/ai';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const R2 = join(ROOT, 'lab', 'review2');
const outDir = join(R2, 'review4', 'statistics');
mkdirSync(outDir, { recursive: true });

// ---- 以下三个函数为 f9dbe1f:lab/src/review2train.ts 的逐字拷贝（仅去掉未用分支） ----
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

function playNNvsNN(nMlp: MLP, oMlp: MLP, seed: number, side: 0 | 1): boolean {
  const matchSeed = (Math.imul(seed, 0x9e3779b1) ^ 0xd1b54a35) >>> 0;
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const mkNN = (m: MLP) => [0, 1, 2, 3].map((s) => new NeuralDecider(s, m, 0, () => 0));
  const mine = mkNN(nMlp); const other = mkNN(oMlp);
  let games = 0;
  while (match.winner == null && games < 80) {
    const state = startGame(match);
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
  return match.winner === side;
}

function playNNwithH(nMlp: MLP, oMlp: MLP, seed: number, side: 0 | 1): boolean {
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
  while (match.winner == null && games < 80) {
    const state = startGame(match);
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
  return match.winner === side;
}
// ---- 拷贝结束 ----

function loadWeightsInto(mlp: MLP, path: string): void {
  const buf = readFileSync(path);
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  mlp.setWeights(arr);
}

async function main() {
  const proto = JSON.parse(readFileSync(join(R2, 'protocol-v3.json'), 'utf8'));
  const ns = proto.seeds.namespaces;
  const cand = JSON.parse(readFileSync(join(R2, 'selected', 'candidate.json'), 'utf8'));
  const refMlp = new MLP(1);
  loadWeightsInto(refMlp, join(ROOT, 'packages', 'web', 'public', 'ai', 'clean1.f32'));
  const mlp = new MLP(1);
  loadWeightsInto(mlp, cand.weightsPath);

  for (const split of ['confirm-attempt1', 'confirm-attempt2'] as const) {
    const nsBase = ns[split];
    const t0 = Date.now();
    const m1: number[] = []; const m2: number[] = [];
    const m1Sides: Array<[number, number]> = []; const m2Sides: Array<[number, number]> = [];
    const m1Seeds: number[] = []; const m2Seeds: number[] = [];
    for (let b = 0; b < 128; b++) {
      const seed = deriveSeed('eval-m1', nsBase, b, 'block');
      let w0 = 0, w1 = 0;
      for (const side of [0, 1] as const) {
        const win = playNNvsNN(mlp, refMlp, seed * 2 + side, side) ? 1 : 0;
        if (side === 0) w0 = win; else w1 = win;
      }
      m1Sides.push([w0, w1]);
      m1Seeds.push(seed);
      m1.push((w0 + w1) / 2);
    }
    for (let b = 0; b < 256; b++) {
      const seed = deriveSeed('eval-m2', nsBase, b, 'block');
      let w0 = 0, w1 = 0;
      for (const side of [0, 1] as const) {
        const win = playNNwithH(mlp, refMlp, seed * 2 + side, side) ? 1 : 0;
        if (side === 0) w0 = win; else w1 = win;
      }
      m2Sides.push([w0, w1]);
      m2Seeds.push(seed);
      m2.push((w0 + w1) / 2);
    }
    const c1 = blockCI(m1, deriveSeed('boot', nsBase, 0, 'm1-confirm'));
    const c2 = blockCI(m2, deriveSeed('boot', nsBase, 0, 'm2-confirm'));
    const original = JSON.parse(readFileSync(join(R2, 'runs', 'clean2-main', `confirm_${split}.json`), 'utf8'));
    const repro = {
      split, at: new Date().toISOString(), elapsedMs: Date.now() - t0,
      candidateWeights: cand.weightsPath,
      m1Blocks: m1, m2Blocks: m2,
      m1SideWins: m1Sides, m2SideWins: m2Sides,
      m1BlockSeeds: m1Seeds, m2BlockSeeds: m2Seeds,
      m1: c1, m2: c2,
      compare: {
        m1MeanEqual: c1.mean === original.m1.mean,
        m1CiEqual: c1.ciLow === original.m1.ciLow && c1.ciHigh === original.m1.ciHigh,
        m2MeanEqual: c2.mean === original.m2.mean,
        m2CiEqual: c2.ciLow === original.m2.ciLow && c2.ciHigh === original.m2.ciHigh,
        original: { m1: original.m1, m2: original.m2 },
      },
    };
    writeFileSync(join(outDir, `repro-${split}.json`), JSON.stringify(repro, null, 1));
    console.log(`[${split}] M1=${c1.mean.toFixed(8)} (原 ${original.m1.mean}) CI=[${c1.ciLow},${c1.ciHigh}] (原 [${original.m1.ciLow},${original.m1.ciHigh}]) 匹配=${repro.compare.m1MeanEqual && repro.compare.m1CiEqual}`);
    console.log(`[${split}] M2=${c2.mean.toFixed(8)} (原 ${original.m2.mean}) CI=[${c2.ciLow},${c2.ciHigh}] (原 [${original.m2.ciLow},${original.m2.ciHigh}]) 匹配=${repro.compare.m2MeanEqual && repro.compare.m2CiEqual} (${((Date.now() - t0) / 60000).toFixed(1)}min)`);
  }
}
main();
