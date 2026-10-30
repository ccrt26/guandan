/**
 * lab/src/verify_neural.ts — 阶段B验证：神经陪练接入检查（外部指导 7.5）。
 * 覆盖：加载一致性（含文件重载）、合法动作、信息边界（平行世界）、时延、整局冒烟。
 * 用法: npx tsx lab/src/verify_neural.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMove, buildDeck, canPass, classify, createMatch, DEFAULT_RULES,
  legalCombos, startGame, type Card, type GameState, type Suit,
} from '@gd/engine';
import { createAI, createNeuralAI, guardMove, isMoveLegal, type NeuralPlayer } from '@gd/ai';

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, d = ''): void => { c ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name} ${d}`)); };

const W_PATH = join(import.meta.dirname, '..', '..', 'packages', 'web', 'public', 'ai', 'armA.f32');
const buf = readFileSync(W_PATH);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

// ---- 1. 部署文件加载 + 决策确定性 + 重载一致 ----
{
  const p1 = createNeuralAI(1, ab);
  const p2 = createNeuralAI(1, ab);
  const p3 = createNeuralAI(1, ab); // 再读一次文件
  const match = createMatch({ ...DEFAULT_RULES }, 77);
  const state = startGame(match);
  state.turn = 1;
  const k = (m: { pass: boolean; combo?: { kind: string; mainRank: number; cards: Card[] } }): string =>
    m.pass ? 'pass' : `${m.combo!.kind}:${m.combo!.mainRank}:${m.combo!.cards.map((c) => c.id).sort().join(',')}`;
  [p1, p2, p3].forEach((p) => p.reset(state, match.opts));
  const m1 = k(p1.decide(state)), m2 = k(p2.decide(state)), m3 = k(p3.decide(state));
  ok(m1 === m2, '同批实例决策一致（确定性）');
  ok(m1 === m3, '重新加载文件后决策一致');
  ok(buf.byteLength === 659_460, `权重文件 659,460 字节（实际 ${buf.byteLength}）`);
}

// ---- 2. 平行世界信息边界（NeuralPlayer 全链路，含 observe 历史） ----
{
  let nid = 9000;
  const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });
  const myHand = [C('S', 3), C('H', 4), C('D', 5), C('C', 6), C('S', 7), C('S', 9), C('H', 9), C('D', 9), C('C', 9), C('S', 12), C('J', 16)];
  const craft = (opp: Card[][]): GameState => {
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    const state = startGame(match);
    state.hands = [myHand, ...opp];
    state.turn = 0; state.leader = 1; state.lastPlayer = 1;
    state.lastCombo = classify([C('S', 8), C('H', 8)], state.ctx)[0];
    return state;
  };
  const deckA = buildDeck().filter((c) => !myHand.includes(c)).slice(0, 60);
  const handsA = [deckA.slice(0, 20), deckA.slice(20, 40), deckA.slice(40, 60)];
  const deckB = [...deckA];
  for (let i = deckB.length - 1; i > 0; i--) { const j = (i * 7 + 13) % (i + 1); [deckB[i], deckB[j]] = [deckB[j], deckB[i]]; }
  const handsB = [deckB.slice(0, 20), deckB.slice(20, 40), deckB.slice(40, 60)];
  const pA = createNeuralAI(0, ab), pB = createNeuralAI(0, ab);
  const k = (m: { pass: boolean; combo?: unknown }) => m.pass ? 'pass' : JSON.stringify((m as { combo: { kind: string; mainRank: number; cards: Card[] } }).combo.cards.map((c) => c.id).sort());
  const sA = craft(handsA), sB = craft(handsB);
  pA.reset(sA, DEFAULT_RULES); pB.reset(sB, DEFAULT_RULES);
  ok(k(pA.decide(sA)) === k(pB.decide(sB)), '平行世界（对手暗牌不同）决策一致——陪练不偷看');
}

// ---- 3. 整局冒烟：神经对手 ×3 + 启发式人类席，合法性/无异常/时延 ----
{
  const match = createMatch({ ...DEFAULT_RULES }, 4242);
  const heurHuman = createAI(0, 1, 7);
  const neural = [1, 2, 3].map((s) => createNeuralAI(s, ab));
  const latencies: number[] = [];
  let games = 0, moves = 0, illegal = 0;
  while (match.winner == null && games < 12) {
    const state = startGame(match);
    heurHuman.reset(state, match.opts);
    neural.forEach((p) => p.reset(state, match.opts));
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const toBeat = state.lastCombo;
      const t0 = performance.now();
      const raw = turn === 0 ? heurHuman.decide(state) : neural[turn - 1].decide(state);
      if (turn !== 0) latencies.push(performance.now() - t0);
      const mv = guardMove(state, raw as never);
      if (turn !== 0 && !isMoveLegal(state, raw as never)) illegal += 1;
      const events = applyMove(state, mv as never);
      moves += 1;
      heurHuman.observe(events, toBeat);
      neural.forEach((p) => p.observe(events, toBeat));
    }
    games += 1;
  }
  const lat = [...latencies].sort((a, b) => a - b);
  const q = (p: number) => lat[Math.min(lat.length - 1, Math.round(p * (lat.length - 1)))];
  ok(illegal === 0, `${games} 副 ${moves} 手，神经决策非法（防御修正）${illegal} 次`);
  ok(lat.length > 500, `神经决策样本 ${lat.length} 个`);
  console.log(`  时延: p50=${q(0.5).toFixed(2)}ms p95=${q(0.95).toFixed(2)}ms p99=${q(0.99).toFixed(2)}ms max=${q(1).toFixed(2)}ms`);
  ok(q(0.95) < 10, 'p95 < 10ms（界面无感）');
}

// ---- 4. 权重与训练产物一致（部署文件=lab/archive/legacy-through-20261030/round2/armA_end） ----
{
  const lab = readFileSync(join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'round2', 'armA_end', 'weights.f32'));
  ok(lab.equals(buf), '部署权重与 lab/archive/legacy-through-20261030/round2/armA_end 逐字节一致');
}

console.log(`\n阶段B验证: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
