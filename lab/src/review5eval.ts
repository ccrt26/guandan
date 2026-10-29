/**
 * lab/src/review5eval.ts — REVIEW5 T7：P 六 run 开发评测（S 门 vs U0）。
 * 评测对象：三对 control/treatment 的 ck-最终 + U0；对手=frozenChampion（clean2 385+v2 候选+legacy）。
 * 指标：M1=臂四席 vs 冠军四席（32 块×同副换边 2）；M2=臂+中级H vs 冠军+中级H（32 块）。S=(M1+M2)/2。
 * 门：技术门（无非法/泄漏）+ S≥U0+5pp；treatment 另需三对平均 S>control 且 ≥2 对同向（合作门另测）。
 * 用法：npx tsx lab/src/review5eval.ts --blocks 32
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createMatch, DEFAULT_RULES, startGame, applyMove, RNG, type Combo } from '@gd/engine';
import { createAI, MLP, mulberry32, NeuralDecider, deriveSeed, migratePassEncoding, INPUT_DIM, INPUT_DIM_V2, STATE_DIM, STATE_DIM_V2 } from '@gd/ai';

const ROOT = join(import.meta.dirname, '..', '..');
const ART = join(ROOT, 'lab', 'review5', 'artifacts');

function loadF32(p: string): Float32Array {
  const buf = readFileSync(p);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

interface Outcome { win: boolean; incomplete: boolean }
function playArmVsChamp(armMlp: MLP, champMlp: MLP, seed: number, side: 0 | 1, hLevel: 0 | 1 | 2, withH: boolean): Outcome {
  const matchSeed = (Math.imul(seed, withH ? 0x85ebca77 : 0x9e3779b1) ^ (withH ? 0xc2b2ae35 : 0xd1b54a35)) >>> 0;
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const arm = [0, 1, 2, 3].map((s) => new NeuralDecider(s, armMlp, 0, () => 0, { schema: 'v2', ctxFill: 'rule-context', passEncoding: 'action64' }));
  const champ = [0, 1, 2, 3].map((s) => new NeuralDecider(s, champMlp, 0, () => 0, { candidateCompat: 'v2', passEncoding: 'legacy-phys10' }));
  let games = 0;
  while (match.winner == null && games < 80) {
    const state = startGame(match);
    const rngH = new RNG((matchSeed ^ (0x5eed + games)) >>> 0);
    const heur = [0, 1, 2, 3].map((s) => createAI(s, withH ? (hLevel as 0 | 1 | 2) : 0, rngH.next() * 0xffffffff));
    heur.forEach((p) => p.reset(state, match.opts));
    arm.forEach((x) => x.newGame()); champ.forEach((x) => x.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const team = turn & 1;
      const armSeat = team === side && (!withH || turn === (side === 0 ? 0 : 1));
      const champSeat = team !== side && (!withH || turn === (side === 0 ? 1 : 0));
      let raw: { pass: boolean; combo?: Combo } | null;
      if (armSeat) raw = arm[turn].decide(state).move as { pass: boolean; combo?: Combo };
      else if (champSeat) raw = champ[turn].decide(state).move as { pass: boolean; combo?: Combo };
      else raw = heur[turn].decide(state) as { pass: boolean; combo?: Combo };
      const toBeat = state.lastCombo;
      const evs = applyMove(state, raw as never);
      arm.forEach((x) => x.observe(evs)); champ.forEach((x) => x.observe(evs));
      heur.forEach((p) => p.observe(evs, toBeat));
    }
    games += 1;
  }
  if (match.winner == null) return { win: false, incomplete: true };
  return { win: match.winner === side, incomplete: false };
}

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
  return { mean, ciLow: boots[Math.round(0.0125 * (boots.length - 1))], ciHigh: boots[Math.round(0.9875 * (boots.length - 1))] };
}

function main(): number {
  const argv = process.argv.slice(2);
  const blocks = Number(argv.includes('--blocks') ? argv[argv.indexOf('--blocks') + 1] : 32);
  mkdirSync(join(ART, 'eval'), { recursive: true });
  const champ = new MLP(1);
  champ.setWeights(loadF32(join(ROOT, 'packages', 'web', 'public', 'ai', 'clean2.f32')));
  const u0 = loadF32(join(ART, 'proxy', 'U0.f32'));
  const arms: Array<{ name: string; weights: Float32Array }> = [{ name: 'U0', weights: u0 }];
  // 共同终点（方案 §T6：每对只比较两臂实际共同完成的最大约定检查点，不挑单臂更长结果）
  const ckSets: Array<Set<number>> = [];
  for (const p of [1, 2, 3]) {
    for (const arm of ['control', 'treatment'] as const) {
      const runDir = join(ART, 'runs', `r5-p${p}-${arm}`);
      try { ckSets.push(new Set(readdirSync(runDir).filter((d) => d.startsWith('ck-')).map((d) => Number(d.slice(3))))); } catch { /* run 未开始 */ }
    }
  }
  const wanted = [1200, 800, 400, 0];
  let commonCk = 0;
  for (const w of wanted) { if (ckSets.length >= 2 && ckSets.every((set) => set.has(w))) { commonCk = w; break; } }
  console.log(`共同终点检查点: ck-${commonCk}（六 run 中已就绪的 ck 并集交集）`);
  for (const p of [1, 2, 3]) {
    for (const arm of ['control', 'treatment'] as const) {
      const runDir = join(ART, 'runs', `r5-p${p}-${arm}`);
      const w = join(runDir, `ck-${commonCk}`, 'weights.f32');
      if (existsSync(w)) arms.push({ name: `p${p}-${arm}@${commonCk}`, weights: loadF32(w) });
      else console.log(`跳过 p${p}-${arm}@ck-${commonCk}（权重不存在）`);
    }
  }
  console.log(`评测 ${arms.length} 个臂 × ${blocks} 块（M1 四席 + M2 带中级H）`);
  const t0 = performance.now();
  const results: Record<string, { m1: ReturnType<typeof blockCI>; m2: ReturnType<typeof blockCI>; S: number; incomplete: { m1: number; m2: number } }> = {};
  for (const a of arms) {
    const mlp = new MLP(1, INPUT_DIM_V2);
    mlp.setWeights(a.weights);
    const m1: number[] = [], m2: number[] = [];
    const inc = { m1: 0, m2: 0 };
    for (let b = 0; b < blocks; b++) {
      const s1 = deriveSeed('r5-m1', 2026110500, b, 'block');
      let w1 = 0;
      for (const side of [0, 1] as const) { const r = playArmVsChamp(mlp, champ, s1, side, 0, false); if (r.incomplete) inc.m1++; else w1 += r.win ? 1 : 0; }
      m1.push(w1 / 2);
      const s2 = deriveSeed('r5-m2', 2026110500, b, 'block');
      let w2 = 0;
      for (const side of [0, 1] as const) { const r = playArmVsChamp(mlp, champ, s2, side, 1, true); if (r.incomplete) inc.m2++; else w2 += r.win ? 1 : 0; }
      m2.push(w2 / 2);
    }
    const c1 = blockCI(m1, deriveSeed('boot', 2026110500, 0, 'r5-m1'));
    const c2 = blockCI(m2, deriveSeed('boot', 2026110500, 0, 'r5-m2'));
    results[a.name] = { m1: c1, m2: c2, S: 0.5 * c1.mean + 0.5 * c2.mean, incomplete: inc };
    console.log(`[${a.name}] M1=${(c1.mean * 100).toFixed(1)}% [${(c1.ciLow * 100).toFixed(1)},${(c1.ciHigh * 100).toFixed(1)}] M2=${(c2.mean * 100).toFixed(1)}% S=${(results[a.name].S * 100).toFixed(2)}pp inc=${JSON.stringify(inc)} (${((performance.now() - t0) / 60000).toFixed(1)}min)`);
  }
  // 门
  const u0S = results['U0']?.S ?? 0;
  const gates: Record<string, unknown> = { u0S, sGateThreshold: '+5pp vs U0' };
  for (const [k, v] of Object.entries(results)) gates[`${k}.sGate`] = v.S >= u0S + 0.05;
  const ctl = Object.entries(results).filter(([k]) => k.includes('-control@'));
  const trt = Object.entries(results).filter(([k]) => k.includes('-treatment@'));
  if (ctl.length && trt.length) {
    const pairs = ctl.map(([k, v], i) => ({ pair: k.split('-')[0], ctl: v.S, trt: trt[i]?.[1]?.S ?? null }));
    gates.pairs = pairs;
    gates.trtAvgS = trt.reduce((s, [, v]) => s + v.S, 0) / trt.length;
    gates.ctlAvgS = ctl.reduce((s, [, v]) => s + v.S, 0) / ctl.length;
    gates.trtBeatsCtlPairs = pairs.filter((p) => p.trt != null && p.trt > p.ctl).length;
  }
  const out = { at: new Date().toISOString(), blocks, opponent: 'frozenChampion(clean2+cand-v2+legacy)', seatSwap: 'same-deal', results, gates };
  writeFileSync(join(ART, 'eval', 't7-dev.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(gates, null, 1));
  console.log(`→ ${join(ART, 'eval', 't7-dev.json')}`);
  return 0;
}
void migratePassEncoding; void INPUT_DIM; void STATE_DIM; void STATE_DIM_V2;
if (process.argv[1] && process.argv[1].includes('review5eval')) process.exit(main());
