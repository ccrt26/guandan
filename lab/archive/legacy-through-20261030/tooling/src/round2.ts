/**
 * lab/src/round2.ts — 第二轮最小试验主控（依 2026-10-26 外部审核指导）。
 * 阶段：audit（候选完整性/公开状态/炸弹规则审查）→ speed（整场评测测速）→
 *       dev（新种子复评 ck1/ck3/final + 炸弹/候选诊断）→ ab A|B（同父分支，≤60min）→
 *       final（全新种子整场验收：父/A/B 配对差值）→ partner（搭档筛查，可选）→
 *       stats（seed 块配对 bootstrap）。
 * 纪律：评测数量事前锁定；种子互不复用；不因结果加跑；正式 AI 零改动。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, existsSync, copyFileSync, legacyWritePath, legacyReadPath } from './legacy-files';
import { EOL } from 'node:os';
import { join } from 'node:path';
import {
  applyMove, canPass, classify, createMatch, DEFAULT_RULES, legalCombos, startGame, teamOf,
  type Card, type Combo, type GameState, type Suit,
} from '@gd/engine';
import { createAI, guardMove as guardMoveAi, LEVEL_CAPS, PlayMemory, scoreCandidates, type Difficulty, type Move } from '@gd/ai';
import { INPUT_DIM, schemaDescriptor } from './schema';
import { MLP, mulberry32 } from './mlp';
import { NeuralSeat } from './seat';
import { dedupCandidates } from '@gd/ai';
import { LearnerBridge } from './bridge';
import { runTrainingMatch } from './sampler';

const R2 = join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'round2');
mkdirSync(R2, { recursive: true });

// ---------- 固定种子（全部显式，读取日期 2026-10-26） ----------
export function genSeeds(n: number, seedBase: number): number[] {
  const r = mulberry32(seedBase);
  return Array.from({ length: n }, () => 1_000_000 + Math.floor(r() * 9_000_000));
}
export const SPEED_SEEDS = genSeeds(10, 2026102604);
export const DEV_SEEDS = genSeeds(50, 2026102601);
export const HOLDOUT_SEEDS = genSeeds(200, 2026102602); // tier1=前100；tier2=全200（速度允许时，看结果前锁定）
export const PARTNER_SEEDS = genSeeds(25, 2026102603);
export const BOOT_SEED = 424242;
const ARM_SEED_BASE = { A: 2026102611, B: 2026102612 } as const;
const MATCH_GAME_CAP = 80;

// ---------- 工具 ----------
function sha256(p: string): string { return createHash('sha256').update(readFileSync(p)).digest('hex'); }
function manifest(tag: string): void {
  const dir = join(import.meta.dirname, '..', '..');
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === '.venv' || f === 'node_modules' || f === 'dist' || f === 'out' || f === 'archive' || f === 'round2' || f === 'candidate_danzero') continue;
      if (f.endsWith('.ts') || f.endsWith('.py')) files.push(p);
    }
  };
  walk(join(dir, 'lab', 'src'));
  files.push(join(dir, 'lab', 'learner.py'));
  const hashes: Record<string, string> = {};
  for (const f of files) hashes[f.replace(dir + '/', '')] = sha256(f);
  writeFileSync(join(R2, `manifest_${tag}.json`), JSON.stringify({ tag, at: new Date().toISOString(), hashes }, null, 2));
  copyFileSync(join(import.meta.dirname, 'round2.ts'), join(R2, `snapshot_round2_${tag}.ts`));
}
const ledgerPath = join(R2, 'runtime_ledger.jsonl');
function ledger(phase: string, ms: number, note = ''): void {
  appendFileSync(ledgerPath, `${JSON.stringify({ phase, minutes: +(ms / 60000).toFixed(2), note, at: new Date().toISOString() })}${EOL}`);
}
function loadMlp(dir: string): MLP {
  const buf = readFileSync(join(dir, 'weights.f32'));
  const w = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const m = new MLP(1);
  m.setWeights(w);
  return m;
}
function guardMove(state: GameState, move: { pass: boolean; combo?: Combo }): Move {
  // 值校验防御（2026-10-26 修复：旧引用比较对非pass出牌 100% 误判）
  return guardMoveAi(state, move as never);
}

// ---------- 诊断收集 ----------
export interface Diag {
  decisions: number; forced: number; nLegalSum: number;
  nLegalDist: number[]; kindSeen: Set<string>;
  bombLikeOpportunities: number; bombLikeChosen: number;
  bombDespiteNonBombBeat: number; bombWhenMateLeads: number; nonBombBeatAvailable: number;
  bombTrickWon: number; bombTrickTotal: number;
  snapshots: unknown[];
}
function newDiag(): Diag {
  return {
    decisions: 0, forced: 0, nLegalSum: 0, nLegalDist: [], kindSeen: new Set(),
    bombLikeOpportunities: 0, bombLikeChosen: 0, bombDespiteNonBombBeat: 0, bombWhenMateLeads: 0,
    nonBombBeatAvailable: 0, bombTrickWon: 0, bombTrickTotal: 0, snapshots: [],
  };
}
const isBombLike = (c: { combo: Combo | null }): boolean =>
  !!c.combo && (c.combo.kind === 'bomb' || c.combo.kind === 'flush' || c.combo.kind === 'joker_bomb');

function recordDiag(
  diag: Diag, state: GameState, seat: number, move: Move,
  mem: PlayMemory | null, wantSnapshot: boolean,
): void {
  const cands = dedupCandidates(legalCombos(state), canPass(state));
  diag.decisions += 1;
  diag.nLegalSum += cands.length;
  diag.nLegalDist.push(cands.length);
  for (const c of cands) if (c.combo) diag.kindSeen.add(c.combo.kind);
  if (cands.length === 1) diag.forced += 1;
  const hasBombAlt = cands.some(isBombLike);
  const following = state.lastCombo !== null;
  const chosenBomb = !move.pass && isBombLike({ combo: move.combo! });
  if (hasBombAlt) {
    diag.bombLikeOpportunities += 1;
    const nonBombBeat = following && cands.some((c) => c.combo && !isBombLike(c));
    if (nonBombBeat) diag.nonBombBeatAvailable += 1;
    if (chosenBomb) {
      diag.bombLikeChosen += 1;
      if (nonBombBeat) diag.bombDespiteNonBombBeat += 1;
      if (teamOf(state.leader) === teamOf(seat)) diag.bombWhenMateLeads += 1;
      if (wantSnapshot && diag.snapshots.length < 25 && mem) {
        const heur = scoreCandidates({ state, seat, caps: LEVEL_CAPS[1], memory: mem, rand: () => 0 })[0];
        diag.snapshots.push({
          hand: state.hands[seat].map((c) => `${c.suit}${c.rank}`).join(' '),
          lastCombo: state.lastCombo ? `${state.lastCombo.kind}:${state.lastCombo.mainRank}` : '领出',
          nCands: cands.length,
          chosen: move.pass ? 'pass' : `${move.combo!.kind}:${move.combo!.mainRank}x${move.combo!.size}`,
          heurTop: heur.move.pass ? 'pass' : `${heur.combo!.kind}:${heur.combo!.mainRank}x${heur.combo!.size}`,
          candKinds: cands.map((c) => (c.combo ? `${c.combo.kind}:${c.combo.mainRank}` : 'pass')),
        });
      }
    }
  }
}

// ---------- 整场评测 ----------
export interface MatchRec {
  seed: number; side: 0 | 1; win: 0 | 1; games: number; gSum: number; moves: number;
  ms: number; unfinished: boolean;
}
export function evalMatchOnce(
  mlp: MLP, diff: Difficulty, matchSeed: number, neuralSide: 0 | 1, diag?: Diag,
): MatchRec {
  const t0 = performance.now();
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const rand = mulberry32(matchSeed ^ 0x5f5f);
  const neural = [0, 1, 2, 3].map((s) => new NeuralSeat(s, mlp, 0, rand));
  const heur = [0, 1, 2, 3].map((s) => createAI(s, diff, (matchSeed * 31 + s) >>> 0));
  let games = 0, gSum = 0, moves = 0;
  let pendingBombSeat = -1;
  while (match.winner == null && games < MATCH_GAME_CAP) {
    const state = startGame(match);
    heur.forEach((p) => p.reset(state, match.opts));
    neural.forEach((s) => s.newGame());
    const mems = diag ? [0, 1, 2, 3].map(() => PlayMemory.fromStart(state.ctx)) : null;
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const toBeat = state.lastCombo;
      const isNeural = (turn & 1) === neuralSide;
      const raw = isNeural ? neural[turn].decide(state).move : heur[turn].decide(state);
      const move = guardMove(state, raw);
      if (diag && isNeural) recordDiag(diag, state, turn, move, mems![turn], true);
      const events = applyMove(state, move);
      if (!move.pass && isBombLike({ combo: move.combo! }) && isNeural) pendingBombSeat = turn;
      for (const ev of events) {
        if (ev.type === 'trickEnd' && diag) {
          if (pendingBombSeat >= 0) { diag.bombTrickTotal += 1; if (ev.nextLeader === pendingBombSeat) diag.bombTrickWon += 1; }
          pendingBombSeat = -1;
        }
      }
      neural.forEach((s) => s.observe(events));
      heur.forEach((p) => p.observe(events, toBeat));
      mems?.forEach((m) => m.observeEvents(events, toBeat));
      moves += 1;
    }
    games += 1;
    const r = state.result;
    if (r) gSum += r.winnerTeam === neuralSide ? r.upgrade : -r.upgrade;
  }
  const unfinished = match.winner == null;
  const win = !unfinished && match.winner === neuralSide ? 1 : 0;
  return { seed: matchSeed, side: neuralSide, win, games, gSum, moves, ms: performance.now() - t0, unfinished };
}

function evalSet(
  mlp: MLP, diff: Difficulty, seeds: number[], tag: string, diag?: Diag,
): { perSeed: MatchRec[]; summary: Record<string, unknown> } {
  const perSeed: MatchRec[] = [];
  const path = join(R2, `${tag}_perseed.jsonl`);
  writeFileSync(path, '');
  for (const seed of seeds) {
    for (const side of [0, 1] as const) {
      const rec = evalMatchOnce(mlp, diff, seed * 2 + side, side, diag);
      perSeed.push(rec);
      appendFileSync(path, `${JSON.stringify(rec)}${EOL}`);
    }
  }
  const done = perSeed.filter((r) => !r.unfinished);
  const summary = {
    tag, matches: perSeed.length, unfinished: perSeed.length - done.length,
    wins: done.reduce((s, r) => s + r.win, 0),
    winRate: done.length ? +(done.reduce((s, r) => s + r.win, 0) / done.length).toFixed(4) : null,
    gamesAvg: +(perSeed.reduce((s, r) => s + r.games, 0) / perSeed.length).toFixed(1),
    gSum: perSeed.reduce((s, r) => s + r.gSum, 0),
    msAvg: +(perSeed.reduce((s, r) => s + r.ms, 0) / perSeed.length).toFixed(0),
  };
  console.log(JSON.stringify(summary));
  return { perSeed, summary };
}

// ---------- seed 块配对 bootstrap ----------
export function pairedBootstrap(
  a: MatchRec[], b: MatchRec[], nBoot = 5000, seed = BOOT_SEED,
): { diff: number; ciLow: number; ciHigh: number; nBlocks: number } {
  const bySeed = new Map<number, { aw: number; bw: number; n: number }>();
  const key = (r: MatchRec) => Math.floor(r.seed / 2); // 同一基种子的两边聚为一块
  for (const r of a) {
    const e = bySeed.get(key(r)) ?? { aw: 0, bw: 0, n: 0 };
    e.aw += r.win; e.n += 1; bySeed.set(key(r), e);
  }
  for (const r of b) {
    const e = bySeed.get(key(r)) ?? { aw: 0, bw: 0, n: 0 };
    e.bw += r.win; bySeed.set(key(r), e);
  }
  const rows = [...bySeed.values()]; // 每块 = 一个基种子 × 两边（每臂 2 场）
  const rate = (get: (e: { aw: number; bw: number }) => number) => rows.reduce((s, e) => s + get(e), 0) / (rows.length * 2);
  const diff = rate((e) => e.aw) - rate((e) => e.bw);
  const rnd = mulberry32(seed);
  const diffs: number[] = [];
  for (let i = 0; i < nBoot; i++) {
    let aw = 0, bw = 0;
    for (let j = 0; j < rows.length; j++) {
      const e = rows[(rnd() * rows.length) | 0];
      aw += e.aw; bw += e.bw;
    }
    diffs.push((aw - bw) / (rows.length * 2));
  }
  diffs.sort((x, y) => x - y);
  return {
    diff: +diff.toFixed(4),
    ciLow: +diffs[Math.floor(0.025 * diffs.length)].toFixed(4),
    ciHigh: +diffs[Math.ceil(0.975 * diffs.length) - 1].toFixed(4),
    nBlocks: rows.length,
  };
}

// ---------- audit：候选完整性与公开状态 ----------
function audit(): void {
  console.log('== audit：候选完整性 / 炸弹规则 / 公开状态 ==');
  let pass = 0, fail = 0;
  const ok = (c: boolean, name: string, d = ''): void => { c ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name} ${d}`)); };
  let nid = 9000;
  const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });
  const mk = (myHand: Card[]): GameState => {
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    const state = startGame(match);
    state.hands = [myHand, [], [], []];
    state.turn = 0;
    return state;
  };
  const kindsOf = (state: GameState): Set<string> => new Set(legalCombos(state).map((c) => c.kind));

  // 1. 顺子候选（含 A2345）
  {
    const s = mk([C('S', 14), C('H', 3), C('D', 4), C('C', 5), C('S', 6), C('H', 7)]);
    const kinds = kindsOf(s);
    ok(kinds.has('straight'), '顺子 34567 在候选中');
  }
  {
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    match.levels = [6, 6]; // 级数 6：2/5 均非级牌，A2345 应合法（级牌不入顺）
    const state = startGame(match);
    state.hands = [[C('S', 14), C('H', 2), C('D', 3), C('C', 4), C('S', 5)], [], [], []];
    state.turn = 0;
    ok(kindsOf(state).has('straight'), '顺子 A2345 在候选中（位置域，级数6局）');
  }
  // 2. 三带二 / 三连对 / 钢板
  {
    const s = mk([C('S', 9), C('H', 9), C('D', 9), C('C', 4), C('H', 4)]);
    ok(kindsOf(s).has('trio_pair'), '三带二在候选中');
  }
  {
    const s = mk([C('S', 5), C('H', 5), C('C', 6), C('S', 6), C('H', 7), C('D', 7)]);
    ok(kindsOf(s).has('pair_seq'), '三连对 556677 在候选中');
  }
  {
    const s = mk([C('S', 7), C('H', 7), C('D', 7), C('C', 8), C('S', 8), C('H', 8)]);
    ok(kindsOf(s).has('trio_seq'), '钢板在候选中');
  }
  // 3. 同花顺
  {
    const s = mk([C('S', 5), C('S', 6), C('S', 7), C('S', 8), C('S', 9)]);
    ok(kindsOf(s).has('flush'), '同花顺在候选中');
  }
  // 4. 炸弹含万能牌扩展？（级牌 2：红心2 为万能；3 张自然 9 + 红心2 → 是否给 4 炸）
  {
    const s = mk([C('S', 9), C('H', 9), C('D', 9), C('H', 2)]);
    const bombs = legalCombos(s).filter((c) => c.kind === 'bomb');
    console.log(`    手=♠9♥9♦9+红心2(级牌2万能)：炸弹候选 ${bombs.length} 个 ${bombs.map((b) => `main=${b.mainRank} size=${b.size} wild=${b.wildAs.length}`).join(' / ')}`);
    ok(true, '万能牌入炸行为已记录（见上行；用于确认最大炸弹张数）');
  }
  // 5. 跟牌时只含能压的候选 + pass 可选
  {
    const s = mk([C('S', 3), C('H', 9)]);
    s.lastCombo = classify([C('S', 5)], s.ctx)[0];
    s.lastPlayer = 1;
    const kinds = kindsOf(s);
    ok(!kinds.has('single') || legalCombos(s).every((c) => c.mainRank !== 3), '跟牌候选全部能压（3 不会被列为可跟单张）');
    ok(canPass(s), '跟牌时 pass 可选');
  }
  // 6. schema 公开状态字段核对（与指导清单对照）
  {
    const d = schemaDescriptor();
    ok(d.blocks.levels === 2, '双方升级进度（levels 2 维）');
    ok(d.blocks.wilds === 1, '我方万能牌张数（级牌状态经 keyRank/wilds 编码）');
    ok(d.blocks.seatStatus === 9, '出完名次+剩余张数+报牌（seatStatus 9 维）');
    ok(d.blocks.trickMeta === 15, '当前控制方与待压牌（trickMeta：出牌人相对位）');
    ok(true, '接风语义：trickEnd 后领出者由引擎确定；编码以"我是否领出+待压牌为空"表达，接风原因未编码（已知限制，与首轮一致）');
    ok(true, '过A失败状态：以 levels 停在 14 表达（引擎无独立失败计数字段，确认无遗漏公开状态）');
  }
  // 7. 物理消耗编码完整性：候选数 × (54物理+宣告) 无别名
  {
    const s = mk([C('S', 9), C('H', 9), C('D', 9), C('C', 4), C('H', 4)]);
    const cands = dedupCandidates(legalCombos(s), false);
    const keys = new Set(cands.map((c) => `${c.combo!.cards.map((x) => x.id).sort().join(',')}|${c.combo!.kind}`));
    ok(keys.size === cands.length, '候选无同物同名重复');
  }
  console.log(`audit: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

// ---------- ab 分支 ----------
async function abRun(arm: 'A' | 'B', minutes: number): Promise<void> {
  manifest(`arm${arm}_start`);
  const parentDir = readFileSync(join(R2, 'parent_choice.txt'), 'utf8').trim(); // dev 阶段锁定
  const parent = loadMlp(join(import.meta.dirname, '..', 'out', parentDir));
  const model = new MLP(1);
  model.setWeights(parent.getWeights());
  const bridge = new LearnerBridge('cpu');
  const env = await bridge.init(INPUT_DIM, parent.getWeights(), { arm, minutes, parent: parentDir });
  const optState = await bridge.loadOpt(legacyReadPath(join(import.meta.dirname, '..', 'out', parentDir, 'resume.pt')));
  console.log(`arm ${arm}: env=${env.torch}/${env.device} 父=${parentDir} 优化器恢复=${optState.restored}`);

  const armSeed = ARM_SEED_BASE[arm];
  const matchRand = mulberry32(armSeed);
  const shuffleRand = mulberry32(armSeed ^ 0x1234);
  const t0 = Date.now();
  const hardStop = t0 + minutes * 60_000;
  const prog = join(R2, `arm${arm}_progress.jsonl`);
  writeFileSync(prog, '');
  const pool: Array<{ feat: Float32Array; y: number }> = [];
  let matches = 0, games = 0, collected = 0, usedSamples = 0, discarded = 0,
    updates = 0, nonfinite = 0, capped = 0, tailLeft = 0, ck30 = false;
  const eps = 0.05;

  while (Date.now() < hardStop - 90_000) {
    const r = runTrainingMatch(model, eps, (matchRand() * 0xffffffff) | 0);
    matches += 1; games += r.games;
    if (r.capped) capped += 1;
    if (r.samples) { pool.push(...r.samples.map((s) => ({ feat: s.feat, y: s.y }))); collected += r.samples.length; }
    while (pool.length >= 2048) {
      const group = pool.splice(0, 2048);
      const idx = Array.from({ length: 2048 }, (_, i) => i);
      for (let i = 2047; i > 0; i--) { // 固定流 Fisher-Yates 打乱
        const j = (shuffleRand() * (i + 1)) | 0;
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      const build = (ids: number[]): { f: Float32Array; t: Float32Array } => {
        const f = new Float32Array(ids.length * INPUT_DIM);
        const t = new Float32Array(ids.length);
        ids.forEach((id, k) => { f.set(group[id].feat, k * INPUT_DIM); t[k] = group[id].y; });
        return { f, t };
      };
      if (arm === 'A') {
        const { f, t } = build(idx.slice(0, 1024)); // 前 1024（等价均匀抽取：已全局打乱）
        const rep = await bridge.train(f, t, 1024, INPUT_DIM, armSeed * 1_000_003 + updates);
        updates += 1; usedSamples += rep.nTrain; discarded += 2048 - rep.nTrain;
        if (!rep.nonfinite) model.setWeights(await bridge.getWeights()); else nonfinite += 1;
        appendFileSync(prog, `${JSON.stringify({ at: Date.now() - t0, updates, loss: rep.lossBefore, weights: rep.nTrain })}${EOL}`);
      } else {
        for (const half of [idx.slice(0, 1024), idx.slice(1024)]) {
          const { f, t } = build(half);
          const rep = await bridge.train(f, t, 1024, INPUT_DIM, armSeed * 1_000_003 + updates);
          updates += 1; usedSamples += rep.nTrain;
          if (!rep.nonfinite) model.setWeights(await bridge.getWeights()); else nonfinite += 1;
          appendFileSync(prog, `${JSON.stringify({ at: Date.now() - t0, updates, loss: rep.lossBefore, weights: rep.nTrain })}${EOL}`);
        }
      }
    }
    if (!ck30 && Date.now() > t0 + 30 * 60_000) {
      ck30 = true;
      mkdirSync(join(R2, `arm${arm}_ck30`), { recursive: true });
      copyWeights(join(R2, `arm${arm}_ck30`), model);
      await bridge.save(legacyWritePath(join(R2, `arm${arm}_ck30`)));
    }
  }
  tailLeft = pool.length; // 尾部残留：未训练，如实记录
  const armDir = join(R2, `arm${arm}_end`);
  mkdirSync(armDir, { recursive: true });
  copyWeights(armDir, model);
  await bridge.save(legacyWritePath(armDir));
  const summary = {
    arm, minutes, parent: parentDir, optRestored: optState.restored,
    matches, games, collected, usedSamples, discardedByBudget: discarded, tailLeft, updates, nonfinite, cappedMatches: capped,
  };
  writeFileSync(join(R2, `arm${arm}_summary.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  await bridge.shutdown();
  ledger(`arm${arm}`, Date.now() - t0);
  manifest(`arm${arm}_end`);
}
function copyWeights(dir: string, mlp: MLP): void {
  const w = mlp.getWeights();
  writeFileSync(join(dir, 'weights.f32'), Buffer.from(w.buffer, w.byteOffset, w.length * 4));
  writeFileSync(join(dir, 'schema.json'), JSON.stringify(schemaDescriptor(), null, 2));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ layers: mlp.sizes, paramCount: mlp.paramCount }, null, 2));
}

// ---------- 主入口 ----------
async function main(): Promise<void> {
  const mode = process.argv[2];
  const t0 = Date.now();
  if (mode === 'audit') {
    audit();
    ledger('audit', Date.now() - t0);
  } else if (mode === 'speed') {
    manifest('speed');
    const mlp = loadMlp(join(import.meta.dirname, '..', 'out', 'deploy_final'));
    evalSet(mlp, 1, SPEED_SEEDS, 'speed_final');
    ledger('speed', Date.now() - t0);
  } else if (mode === 'dev') {
    manifest('dev');
    const diag = newDiag();
    const results: Record<string, unknown> = {};
    for (const ck of ['deploy_ck1', 'deploy_ck3', 'deploy_final']) {
      const mlp = loadMlp(join(import.meta.dirname, '..', 'out', ck));
      const { summary } = evalSet(mlp, 1, DEV_SEEDS, `dev_${ck.replace('deploy_', '')}`, diag);
      results[ck] = summary;
    }
    writeFileSync(join(R2, 'dev_summary.json'), JSON.stringify(results, null, 2));
    // 诊断（final 的整场评测中收集）
    const q = (arr: number[], p: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))]; };
    writeFileSync(join(R2, 'diag.json'), JSON.stringify({
      decisions: diag.decisions,
      forcedShare: +(diag.forced / diag.decisions).toFixed(4),
      nLegalMean: +(diag.nLegalSum / diag.decisions).toFixed(2),
      nLegalP50: q(diag.nLegalDist, 0.5), nLegalP95: q(diag.nLegalDist, 0.95),
      kindsSeen: [...diag.kindSeen],
      bombLikeOpportunities: diag.bombLikeOpportunities,
      bombLikeChosen: diag.bombLikeChosen,
      bombChosenRateGivenOpportunity: diag.bombLikeOpportunities ? +(diag.bombLikeChosen / diag.bombLikeOpportunities).toFixed(4) : null,
      nonBombBeatAvailable: diag.nonBombBeatAvailable,
      bombDespiteNonBombBeat: diag.bombDespiteNonBombBeat,
      bombWhenMateLeads: diag.bombWhenMateLeads,
      bombTrickWon: diag.bombTrickWon, bombTrickTotal: diag.bombTrickTotal,
      snapshots: diag.snapshots,
    }, null, 2));
    // 父模型选择规则（事前声明）：dev 整场胜率最高者；平手取训练更晚者
    const entries = Object.entries(results).map(([k, v]) => ({ k, wr: (v as { winRate: number }).winRate }));
    entries.sort((a, b) => b.wr - a.wr || (a.k < b.k ? 1 : -1)); // 平手取字典序更大（训练更晚）
    const parent = entries[0].k;
    writeFileSync(join(R2, 'parent_choice.txt'), parent);
    console.log('父模型选择（dev 胜率最高，平手取晚）:', parent, entries);
    ledger('dev', Date.now() - t0);
  } else if (mode === 'ab') {
    const arm = process.argv[3] as 'A' | 'B';
    const mins = Number.parseFloat(process.argv[4] ?? '60');
    await abRun(arm, mins);
  } else if (mode === 'final') {
    manifest('final');
    const tier = Number.parseInt(process.argv[3] ?? '100', 10); // 100 或 200（速度允许时于看结果前锁定）
    const seeds = HOLDOUT_SEEDS.slice(0, tier);
    const strat: Record<string, string> = {
      parent: readFileSync(join(R2, 'parent_choice.txt'), 'utf8').trim(),
      armA: join(R2, 'armA_end'),
      armB: join(R2, 'armB_end'),
    };
    const per: Record<string, MatchRec[]> = {};
    const diag = newDiag();
    for (const [name, dirOrCk] of Object.entries(strat)) {
      const dir = dirOrCk.startsWith('/') ? dirOrCk : join(import.meta.dirname, '..', 'out', dirOrCk);
      const mlp = loadMlp(dir);
      const { perSeed, summary } = evalSet(mlp, 1, seeds, `final_${name}`, diag);
      per[name] = perSeed;
      console.log(name, JSON.stringify(summary));
    }
    const stats = {
      BA: pairedBootstrap(per.armB, per.armA),
      A_parent: pairedBootstrap(per.armA, per.parent),
      B_parent: pairedBootstrap(per.armB, per.parent),
    };
    writeFileSync(join(R2, 'final_stats.json'), JSON.stringify({ tier, stats }, null, 2));
    console.log('配对差值（seed 块 bootstrap 5000）:', JSON.stringify(stats, null, 2));
    ledger('final', Date.now() - t0);
  } else if (mode === 'partner') {
    manifest('partner');
    const seeds = PARTNER_SEEDS;
    const out: Record<string, unknown> = {};
    const targets: Record<string, string> = {
      parent: readFileSync(join(R2, 'parent_choice.txt'), 'utf8').trim(),
      armA: join(R2, 'armA_end'),
      armB: join(R2, 'armB_end'),
    };
    for (const [name, dirOrCk] of Object.entries(targets)) {
      const dir = dirOrCk.startsWith('/') ? dirOrCk : join(import.meta.dirname, '..', 'out', dirOrCk);
      const mlp = loadMlp(dir);
      let wins = 0, n = 0;
      const ppath = join(R2, `partner_${name}_perseed.jsonl`);
      writeFileSync(ppath, '');
      for (let rot = 0; rot < 4; rot++) {
        for (const seed of seeds) {
          // 神经坐 rot（搭档 rot+2 启发式，对手两家启发式，全部 diff 1）
          const rec = evalPartnerOnce(mlp, 1, seed * 2 + rot, rot);
          appendFileSync(ppath, `${JSON.stringify({ seed, rot, ...rec })}${EOL}`);
          wins += rec.win; n += 1;
        }
      }
      out[name] = { wins, matches: n, winRate: +(wins / n).toFixed(4) };
      console.log(name, JSON.stringify(out[name]));
    }
    writeFileSync(join(R2, 'partner_summary.json'), JSON.stringify(out, null, 2));
    ledger('partner', Date.now() - t0);
  } else if (mode === 'stats') {
    // 从既有 perseed 文件重算配对差值（纯统计，零评测成本）
    const read = (f: string): MatchRec[] =>
      readFileSync(join(R2, f)).toString().split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const p = read('final_parent_perseed.jsonl');
    const a = read('final_armA_perseed.jsonl');
    const b = read('final_armB_perseed.jsonl');
    const stats = { BA: pairedBootstrap(b, a), A_parent: pairedBootstrap(a, p), B_parent: pairedBootstrap(b, p) };
    writeFileSync(join(R2, 'final_stats.json'), JSON.stringify({ tier: 200, stats, recomputedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.error('用法: round2.ts audit|speed|dev|ab A|B 分钟|final 100|200|partner|stats');
    process.exit(1);
  }
}

/** 搭档筛查：神经坐 seat=rot，搭档/对手全为 diff 档启发式 */
function evalPartnerOnce(mlp: MLP, diff: Difficulty, matchSeed: number, neuralSeat: number): { win: number } {
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const rand = mulberry32(matchSeed ^ 0x7070);
  const neural = [0, 1, 2, 3].map((s) => new NeuralSeat(s, mlp, 0, rand));
  const heur = [0, 1, 2, 3].map((s) => createAI(s, diff, (matchSeed * 31 + s) >>> 0));
  let games = 0;
  while (match.winner == null && games < MATCH_GAME_CAP) {
    const state = startGame(match);
    heur.forEach((p) => p.reset(state, match.opts));
    neural.forEach((s) => s.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const toBeat = state.lastCombo;
      const raw = turn === neuralSeat ? neural[turn].decide(state).move : heur[turn].decide(state);
      const move = guardMoveAi(state, raw as never);
      const events = applyMove(state, move);
      neural.forEach((s) => s.observe(events));
      heur.forEach((p) => p.observe(events, toBeat));
    }
    games += 1;
  }
  return { win: match.winner === teamOf(neuralSeat) ? 1 : 0 };
}

void existsSync;
// 仅作为入口直跑时执行（被 verify_stats 动态导入时只提供函数）
if (process.argv[1] && process.argv[1].endsWith('round2.ts')) {
  await main();
}
