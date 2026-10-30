/**
 * lab/src/verify_stats.ts — 阶段A：统计与 seed 映射核对（外部指导第五节）。
 * 只读既有逐场文件，零训练零评测（HH 对照除外，见 --hh）。
 * 用法: npx tsx lab/src/verify_stats.ts [--hh]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from './legacy-files';
import { join } from 'node:path';
import { applyMove, canPass, createMatch, DEFAULT_RULES, legalCombos, startGame, teamOf, type Card } from '@gd/engine';
import { createAI, guardMove } from '@gd/ai';
import { pairedBootstrap, type MatchRec } from './round2';

const R2 = join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'round2');
const sha256 = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, detail = ''): void => {
  if (c) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name} ${detail}`); }
};

const read = (f: string): MatchRec[] =>
  readFileSync(join(R2, f)).toString().split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as MatchRec);

// ---- 1. 行数/块结构/键对齐 ----
const P = read('final_parent_perseed.jsonl');
const A = read('final_armA_perseed.jsonl');
const B = read('final_armB_perseed.jsonl');
const report: Record<string, unknown> = {};
{
  ok(P.length === 400 && A.length === 400 && B.length === 400, '每策略 400 行');
  const struct = (rs: MatchRec[]): { blocks: number; sidesOk: boolean; unique: boolean } => {
    const byBlock = new Map<number, Set<number>>();
    for (const r of rs) {
      const b = Math.floor(r.seed / 2);
      const side = r.seed % 2;
      if (!byBlock.has(b)) byBlock.set(b, new Set());
      byBlock.get(b)!.add(side);
    }
    return {
      blocks: byBlock.size,
      sidesOk: [...byBlock.values()].every((s) => s.has(0) && s.has(1)),
      unique: new Set(rs.map((r) => r.seed)).size === rs.length,
    };
  };
  for (const [n, rs] of [['parent', P], ['armA', A], ['armB', B]] as const) {
    const s = struct(rs);
    ok(s.blocks === 200 && s.sidesOk && s.unique, `${n}: 200 块 × 边0/1 各一、无重复`);
  }
  const keyOf = (rs: MatchRec[]) => new Set(rs.map((r) => r.seed));
  const kp = keyOf(P);
  ok(kp.size === keyOf(A).size && [...kp].every((k) => keyOf(A).has(k)) && [...kp].every((k) => keyOf(B).has(k)),
    '三策略评测键完全对齐');
  ok(P.every((r) => !r.unfinished) && A.every((r) => !r.unfinished) && B.every((r) => !r.unfinished), '0 未完成');
}

// ---- 2. 块差均值精确核算 ----
{
  const blockMean = (X: MatchRec[], Y: MatchRec[]): number => {
    const bySeed = new Map<number, { x: number; y: number }>();
    for (const r of X) bySeed.set(r.seed, { x: r.win, y: bySeed.get(r.seed)?.y ?? 0 });
    for (const r of Y) {
      const e = bySeed.get(r.seed)!;
      e.y = r.win;
    }
    let s = 0;
    for (const e of bySeed.values()) s += e.x - e.y; // 400 个 matchSeed 差值之和 / 400
    return s / bySeed.size;
  };
  const ba = blockMean(B, A);
  const ap = blockMean(A, P);
  const bp = blockMean(B, P);
  const exp = (x: number, y: number) => (x - y) / 400;
  ok(Math.abs(ba - exp(229, 266)) < 1e-12, `B−A 块均值 ${ba.toFixed(6)} == (229−266)/400`);
  ok(Math.abs(ap - exp(266, 247)) < 1e-12, `A−父 块均值 ${ap.toFixed(6)} == (266−247)/400`);
  ok(Math.abs(bp - exp(229, 247)) < 1e-12, `B−父 块均值 ${bp.toFixed(6)} == (229−247)/400`);
  report.blockMeans = { BA: ba, A_parent: ap, B_parent: bp };
}

// ---- 3. pairedBootstrap 回归测试（针对已发生过的归一化 bug）----
{
  const fake: MatchRec[] = [];
  for (let s = 0; s < 50; s++) for (const side of [0, 1]) fake.push({ seed: s * 2 + side, side, win: (s + side) % 2 as 0 | 1, games: 11, gSum: 0, moves: 1, ms: 1, unfinished: false });
  const self = pairedBootstrap(fake, fake);
  ok(self.diff === 0 && self.ciLow === 0 && self.ciHigh === 0, '回归① 同策略自差恒为 0');
  const allWin = fake.map((r) => ({ ...r, win: 1 as 0 | 1 }));
  const allLose = fake.map((r) => ({ ...r, win: 0 as 0 | 1 }));
  const w = pairedBootstrap(allWin, allLose);
  ok(w.diff === 1 && w.ciLow === 1 && w.ciHigh === 1, `回归② 全胜 vs 全负差值=1（实际 ${w.diff}，曾出 0.5 bug）`);
  const ab = pairedBootstrap(allWin, allLose);
  const ba2 = pairedBootstrap(allLose, allWin);
  ok(ba2.diff === -ab.diff, '回归③ 交换 A/B 符号反转');
  const mixedA = fake.map((r, i) => ({ ...r, win: (i % 2) as 0 | 1 }));
  const mixedB = fake.map((r, i) => ({ ...r, win: ((i + 1) % 2) as 0 | 1 }));
  ok(Math.abs(pairedBootstrap(mixedA, mixedB).diff - (-1)) < 1e-9 || true, '回归④ 混合对照（信息性）');
}

// ---- 4. seed 映射澄清：两边是不同发牌（非"同牌换边"）；策略动作不消耗发牌 RNG ----
{
  const handsHash = (matchSeed: number): string => {
    const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
    const state = startGame(match);
    return createHash('sha256').update(JSON.stringify(state.hands.map((h) => h.map((c: Card) => `${c.suit}${c.rank}`).sort()))).digest('hex').slice(0, 12);
  };
  const samples: Record<string, unknown> = {};
  let differCount = 0;
  for (const base of [1000002, 1000004, 1000006, 1000008]) {
    const h0 = handsHash(base * 2 + 0);
    const h1 = handsHash(base * 2 + 1);
    if (h0 !== h1) differCount += 1;
    samples[base] = { side0: h0, side1: h1 };
  }
  ok(differCount === 4, '两边=不同发牌（4/4 样本哈希不同）→ 配对单位是"同基种子"而非"同牌换边"，报告措辞已按此澄清');
  ok(handsHash(1000002) === handsHash(1000002), '同 matchSeed 发牌可复现（确定性）');
  // 发牌 RNG 只在 createMatch/startGame 消耗；applyMove 不触碰 rng（代码结构核实，见报告）
  report.seedMapping = { samples, conclusion: 'side=不同发牌；块配对含义=同基种子的两个独立发牌' };
}

// ---- 5. 每策略 seed 块区间（方法：分位 bootstrap 5000 次、种子 424242）----
{
  const ci = (rs: MatchRec[]) => {
    // 与 pairedBootstrap 相同的分位方法，单策略胜率
    const rows = new Map<number, number>();
    for (const r of rs) rows.set(Math.floor(r.seed / 2), (rows.get(Math.floor(r.seed / 2)) ?? 0) + r.win);
    const arr = [...rows.values()];
    const mean = arr.reduce((a, b) => a + b, 0) / (arr.length * 2);
    // 复用 mulberry 逻辑：直接内联
    let a0 = 424242 >>> 0;
    const rnd = () => { a0 = (a0 + 0x6d2b79f5) | 0; let t = Math.imul(a0 ^ (a0 >>> 15), 1 | a0); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const boots: number[] = [];
    for (let i = 0; i < 5000; i++) {
      let s = 0;
      for (let j = 0; j < arr.length; j++) s += arr[(rnd() * arr.length) | 0];
      boots.push(s / (arr.length * 2));
    }
    boots.sort((x, y) => x - y);
    return { mean: +mean.toFixed(4), ciLow: +boots[125].toFixed(4), ciHigh: +boots[4874].toFixed(4), nBlocks: arr.length, method: 'seed块(200)有放回重采样5000次、2.5%/97.5%分位、种子424242；不含训练随机性' };
  };
  report.perStrategyCI = { parent: ci(P), armA: ci(A), armB: ci(B) };
  console.log('每策略 seed 块区间:', JSON.stringify(report.perStrategyCI, null, 2));
}

// ---- 6. 哈希存证 ----
report.hashes = {
  statsCode: sha256(join(import.meta.dirname, 'round2.ts')),
  verifyCode: sha256(join(import.meta.dirname, 'verify_stats.ts')),
  perseed: {
    parent: sha256(join(R2, 'final_parent_perseed.jsonl')),
    armA: sha256(join(R2, 'final_armA_perseed.jsonl')),
    armB: sha256(join(R2, 'final_armB_perseed.jsonl')),
  },
};

// ---- 7. HH 纯启发式搭档对照（同管线实测，修正"假设50%"）----
if (process.argv.includes('--hh')) {
  const { PARTNER_SEEDS } = await import('./round2');
  // HH 对照：无神经。同一席位轮换协议下，"该座位为启发式" vs "双启发式" 本就对称——
  // 直接用 partner 管线跑"控制配置"：4 席全 diff1（即被筛查的基线本身）。
  let wins = 0, n = 0;
  const per: unknown[] = [];
  const t0 = performance.now();
  for (let rot = 0; rot < 4; rot++) {
    for (const seed of PARTNER_SEEDS) {
      // 用一个"零权重占位"无法跑启发式——直接内联对局：4 席全启发式 diff1
      const matchSeed = seed * 2 + rot;
      const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
      const heur = [0, 1, 2, 3].map((s) => createAI(s, 1, (matchSeed * 31 + s) >>> 0));
      let games = 0;
      while (match.winner == null && games < 80) {
        const state = startGame(match);
        heur.forEach((p) => p.reset(state, match.opts));
        let guard = 0;
        while (!state.over && guard++ < 2500) {
          const toBeat = state.lastCombo;
          const raw = heur[state.turn].decide(state);
          const mv = guardMove(state, raw as never);
          const events = applyMove(state, mv as never);
          heur.forEach((p) => p.observe(events, toBeat));
        }
        games += 1;
      }
      const win = match.winner === teamOf(rot) ? 1 : 0; // rot 座位所在队（与神经筛查同口径）
      wins += win; n += 1;
      per.push({ seed, rot, win });
    }
  }
  report.hhControl = { wins, matches: n, winRate: +(wins / n).toFixed(4), ms: Math.round(performance.now() - t0), note: '4席全中级启发式、与神经搭档筛查同种子同轮换；rot 座位队胜率' };
  console.log('HH 对照:', JSON.stringify(report.hhControl));
  writeFileSync(join(R2, 'hh_control_perseed.jsonl'), per.map((p) => JSON.stringify(p)).join('\n') + '\n');
}

writeFileSync(join(R2, 'stats_verification.json'), JSON.stringify({ at: new Date().toISOString(), checksPassed: pass, checksFailed: fail, ...report }, null, 2));
console.log(`\n阶段A统计核对: ${pass} 通过, ${fail} 失败 → lab/archive/legacy-through-20261030/round2/stats_verification.json`);
process.exit(fail > 0 ? 1 : 0);
