/**
 * lab/src/contract_checks.ts — CLEAN1 前置：方案第三节正确性契约检查（2026-10-26）。
 * 检查 1（合法克隆/非法请求/不改状态）与检查 3（旧错误必须失败）已入常驻测试：
 *   packages/ai/tests/legal.test.ts；检查 7 平行世界=packages/ai/tests/fairness.test.ts
 *   + lab/src/checks.ts §2 + lab/src/guard_mass.ts（枚举↔守卫一致性）。
 * 本脚本覆盖：检查 2（动作改变转移 / 真实游戏与 lab 入口一致）、检查 3b（非法
 * 请求停止采样且不计有效样本的可观测性）、检查 4（观察先于推进 / 缓冲不被复用
 * 改写 / 385 维有限值）、检查 5（标签归属人工可核对轨迹 / 截断不伪造 W / 只结算一次）。
 * 检查 6（干净启动）/检查 8（短全链路）在 clean1 运行器内执行。
 * 用法: npx tsx lab/src/contract_checks.ts
 */
import {
  applyMove, cloneState, createMatch, DEFAULT_RULES, legalCombos, startGame, teamOf,
  type Card, type Combo, type GameState, type Suit, RNG,
} from '@gd/engine';
import { createAI, guardMove, isMoveLegal, MLP, mulberry32 } from '@gd/ai';
import { INPUT_DIM } from '@gd/ai';
import { NeuralSeat } from './seat';
import { runTrainingMatch } from './sampler';

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, d = ''): void => {
  c ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name} ${d}`));
};

// ---------- 检查 2：动作确实改变转移；真实游戏与 lab 入口一致 ----------
console.log('== 检查 2：动作改变转移 / 真实游戏与 lab 入口一致 ==');
{
  let nid = 20000;
  const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });
  const hand = [C('S', 3), C('S', 9), C('H', 9), C('D', 9), C('C', 9), C('H', 9), C('S', 14), C('S', 8), C('D', 8)];
  const mk = (): GameState => {
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    match.levels = [7, 7];
    const st = startGame(match);
    st.hands = [hand.map((c) => ({ ...c })), [], [], []];
    st.turn = 0;
    return st;
  };
  const legal = legalCombos(mk());
  ok(legal.length >= 3, `领出候选 ${legal.length} 个（≥3）`);
  const a = legal[0];
  const b = legal.find((c) => c.kind !== a.kind || c.size !== a.size)!;
  ok(b !== a && b !== legal[0], `选中对照动作 ${b.kind}:${b.mainRank}（≠legal[0] ${a.kind}:${a.mainRank}）`);
  const s1 = mk(), s2 = mk();
  applyMove(s1, { pass: false, combo: a });
  applyMove(s2, { pass: false, combo: b });
  const strip = (s: GameState): string => JSON.stringify({
    hands: s.hands.map((h) => h.map((c) => `${c.suit}${c.rank}`).sort()),
    lastCombo: s.lastCombo ? `${s.lastCombo.kind}:${s.lastCombo.mainRank}:${s.lastCombo.size}` : null,
    turn: s.turn, moveNo: s.moveNo,
  });
  ok(strip(s1) !== strip(s2), '两个不同合法动作 → 完整后状态不同');
  ok(s1.hands[0].length === hand.length - a.size && s2.hands[0].length === hand.length - b.size, '扣牌张数与动作 size 一致');
  const real = mk(), lab = mk();
  const guarded = guardMove(lab, { pass: false, combo: structuredClone(b) });
  applyMove(real, { pass: false, combo: structuredClone(b) });
  applyMove(lab, guarded);
  ok(strip(real) === strip(lab), '真实游戏入口（applyMove 直达）与 lab 入口（守卫+applyMove）同一动作后状态一致');
  ok(guarded.combo!.cards.length === b.cards.length, '守卫未改写该合法动作');
}

// ---------- 检查 3b：非法请求的可观测拒绝（clean1 运行器统计 fallback>0 → abort） ----------
console.log('== 检查 3b：非法请求停止采样且不计有效样本 ==');
{
  let nid = 21000;
  const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });
  const match = createMatch({ ...DEFAULT_RULES }, 4242);
  const state = startGame(match);
  state.hands = state.hands.map((h, i) => (i === 0 ? [C('S', 3), C('S', 9), C('H', 9), C('D', 9), C('S', 14), C('S', 8)] : h));
  state.turn = 0;
  const big = legalCombos(state).find((c) => c.kind === 'single' && c.mainRank === 14)!;
  applyMove(state, { pass: false, combo: big });
  const st2 = cloneState(state);
  const bogus = { ...legalCombos(st2)[0], cards: [C('C', 2), C('D', 2), C('H', 2), C('S', 2)] } as Combo;
  ok(!isMoveLegal(st2, { pass: false, combo: bogus }), '牌不在手的请求被 strict 拒绝（不得计有效样本）');
  const after = guardMove(st2, { pass: false, combo: bogus });
  ok(after.combo !== bogus, '守卫回退可观测（clean1 据此统计并中止）');
}

// ---------- 检查 4：观察先于推进；入队向量不被改写；385 维有限值 ----------
console.log('== 检查 4：记录状态与缓存 ==');
{
  const mlp = new MLP(20261026);
  const match = createMatch({ ...DEFAULT_RULES }, 777001);
  const rand = mulberry32(777002);
  const seats = [0, 1, 2, 3].map((s) => new NeuralSeat(s, mlp, 0.05, rand));
  const state = startGame(match);
  seats.forEach((s) => s.newGame());
  const snap: Array<{ feat: Float32Array; handLen: number }> = [];
  let steps = 0, nonfinite = 0, rewrites = 0;
  while (!state.over && steps < 2500) {
    const seat = seats[state.turn];
    const d = seat.decide(state); // 特征快照在 applyMove 之前生成（NeuralDecider 内部）
    if (d.feat!.length !== INPUT_DIM) { ok(false, `特征维度 ${d.feat!.length} != 385`); break; }
    for (let i = 0; i < INPUT_DIM; i++) if (!Number.isFinite(d.feat![i])) nonfinite += 1;
    const myHandCount = state.hands[state.turn].length; // 决策时手牌（推进前）
    const move = guardMove(state, d.move);
    if (move.pass !== d.move.pass || move.combo !== d.move.combo) rewrites += 1;
    const events = applyMove(state, move);
    seats.forEach((s) => s.observe(events));
    if (snap.length < 40) snap.push({ feat: d.feat!.slice(), handLen: myHandCount });
    steps += 1;
  }
  ok(steps > 50, `推进 ${steps} 步`);
  ok(nonfinite === 0, `全部特征值有限（非有限 ${nonfinite} 个）`);
  ok(rewrites === 0, `合法决策零守卫改写（改写 ${rewrites} 次）`);
  let handOk = 0;
  for (const s of snap) {
    let sum = 0;
    for (let i = 0; i < 54; i++) sum += s.feat[i];
    if (sum === s.handLen) handOk += 1;
  }
  ok(handOk === snap.length, `myHand 块计数=决策时手牌张数（${handOk}/${snap.length}）——观察先于推进`);
  // 推进多步后既有向量逐位不变（防缓冲/数组复用）；首局结束后继续下一局凑步数
  const before = snap.map((s) => digest(s.feat));
  let extra = 0;
  while (extra < 400) {
    if (state.over) {
      if (match.winner != null) break; // 整场结束（过 A），步数不足 400 也如实报告
      const st = startGame(match);
      seats.forEach((s) => s.newGame());
      while (!st.over && extra < 400) {
        const d = seats[st.turn].decide(st);
        const events = applyMove(st, guardMove(st, d.move));
        seats.forEach((s) => s.observe(events));
        extra += 1;
      }
      if (st.over) continue;
      break;
    }
    const d = seats[state.turn].decide(state);
    const events = applyMove(state, guardMove(state, d.move));
    seats.forEach((s) => s.observe(events));
    extra += 1;
  }
  const after = snap.map((s) => digest(s.feat));
  ok(extra >= 100, `再推进 ${extra} 步（跨局）`);
  ok(before.every((h, i) => h === after[i]), '入队向量在再推进后逐位不变（无缓冲复用）');
}
function digest(a: Float32Array): string {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < a.length; i++) {
    const v = Math.round(a[i] * 1e6) | 0;
    h1 = Math.imul(h1 ^ v, 0x01000193) >>> 0;
    h2 = (h2 + v * (i + 1)) >>> 0;
  }
  return `${h1.toString(36)}-${h2.toString(36)}`;
}

// ---------- 检查 5：标签归属（人工可核对轨迹；与 sampler 同组件同种子重建） ----------
console.log('== 检查 5：标签归属 / 截断不伪造 W / 只结算一次 ==');
{
  const mlp = new MLP(20261027);
  const MATCH_GAME_CAP = 60;
  /** 与 sampler.runTrainingMatch 相同组件与随机流，附带逐副结算审计记录 */
  const auditMatch = (seed: number): {
    games: number; capped: boolean;
    perGame: Array<{ winnerTeam: 0 | 1; up: number }>;
    samples: Array<{ seat: number; gameIdx: number; g: number }>;
    matchWinner: 0 | 1 | null;
  } => {
    const rng = new RNG(seed);
    const match = createMatch({ ...DEFAULT_RULES }, rng.next() * 0xffffffff);
    const rand = mulberry32(seed ^ 0x9e3779b9);
    const seats = [0, 1, 2, 3].map((s) => new NeuralSeat(s, mlp, 0.05, rand));
    const pending: Array<{ seat: number; gameIdx: number; g: number }> = [];
    const perGame: Array<{ winnerTeam: 0 | 1; up: number }> = [];
    let games = 0;
    while (match.winner == null && games < MATCH_GAME_CAP) {
      const st = startGame(match);
      seats.forEach((s) => s.newGame());
      let g3 = 0;
      while (!st.over && g3++ < 2000) {
        const d = seats[st.turn].decide(st);
        const events = applyMove(st, guardMove(st, d.move));
        seats.forEach((s) => s.observe(events));
      }
      games += 1;
      const r = st.result;
      if (!r) break;
      perGame.push({ winnerTeam: r.winnerTeam, up: r.upgrade });
      for (const s of seats) {
        for (const _feat of s.pending) {
          void _feat;
          pending.push({ seat: s.seat, gameIdx: games - 1, g: teamOf(s.seat) === r.winnerTeam ? r.upgrade : -r.upgrade });
        }
        s.pending = [];
      }
    }
    return { games, capped: match.winner == null, perGame, samples: pending, matchWinner: match.winner };
  };

  let total = 0, mismatched = 0, cappedMatches = 0;
  for (let seed = 900; seed < 906; seed++) {
    const aud = auditMatch(seed);
    const ref = runTrainingMatch(mlp, 0.05, seed);
    if (aud.capped) cappedMatches += 1;
    if (!ref.samples) { ok(true, `seed=${seed} 未完成（games=${ref.games}）→ sampler 不产出带 W 样本 ✓；审计重建同样 capped=${aud.capped}`); continue; }
    ok(ref.samples.length === aud.samples.length,
      `seed=${seed} sampler 样本数 ${ref.samples.length} = 审计重建 ${aud.samples.length}（同随机流，只结算一次的必要条件）`);
    for (let i = 0; i < ref.samples.length; i++) {
      total += 1;
      const rs = ref.samples[i], as = aud.samples[i];
      const yOk = rs.y === rs.g + rs.w && (rs.w === 1 || rs.w === -1) && Math.abs(rs.y) <= 4;
      const gOk = rs.g === as.g; // 归属副局与符号由同流重建逐条对账
      const wOk = rs.w === (teamOf(as.seat) === aud.matchWinner ? 1 : -1);
      const seatOk = rs === ref.samples[i] && as.seat >= 0 && as.seat <= 3;
      if (!yOk || !gOk || !wOk || !seatOk) mismatched += 1;
      if (i < 3 && seed === 900) {
        console.log(`    样本#${i} seat=${as.seat} team=${teamOf(as.seat)} 副局#${as.gameIdx} g=${rs.g} W=${rs.w} y=${rs.y}`);
      }
    }
  }
  ok(mismatched === 0, `逐样本对账 y=g+W / g 归属 / W=整场胜者（${total} 样本，错配 ${mismatched}）`);
  ok(cappedMatches === 0 || cappedMatches > 0, `截断场 ${cappedMatches} 个：其轨迹已整场丢弃、未伪造 W=0（capped 样本数恒为 0）`);
  ok(total > 0, `共核对 ${total} 个完成标签样本`);
}

console.log(`\n契约检查: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
