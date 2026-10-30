/**
 * lab/src/checks.ts — 基础验证（TS 侧，不依赖 Python）。
 * 用法: npx tsx lab/src/checks.ts
 */
import {
  applyMove, buildDeck, canPass, classify, createMatch, DEFAULT_RULES, legalCombos,
  startGame, type Card, type Combo, type GameState, type Suit,
} from '@gd/engine';
import { createAI, guardMove as guardMoveAi, LEVEL_CAPS, PlayMemory, scoreCandidates } from '@gd/ai';
import { encodeState, INPUT_DIM, schemaDescriptor, STATE_DIM, PublicTracker } from './schema';
import { MLP } from './mlp';
import { NeuralSeat } from './seat';
import { evalModelVsHeuristic, runTrainingMatch } from './sampler';

let pass = 0, fail = 0;
function ok(cond: boolean, name: string, detail = ''): void {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name} ${detail}`); }
}

// 值校验防御（2026-10-26 修复）
function guardMove(state: GameState, move: { pass: boolean; combo?: Combo }): { pass: boolean; combo?: Combo } {
  return guardMoveAi(state, move as never);
}

console.log('== 1. schema 与 MLP ==');
{
  const d = schemaDescriptor();
  ok(STATE_DIM === 317, `STATE_DIM=317 (实际 ${STATE_DIM})`);
  ok(INPUT_DIM === 385, `INPUT_DIM=385 (实际 ${INPUT_DIM})`);
  const m = new MLP(42);
  ok(m.paramCount === 385 * 256 + 256 + 256 * 256 + 256 + 256 + 1, `参数量 164,865 (实际 ${m.paramCount})`);
  const m2 = new MLP(42);
  const w1 = m.getWeights(), w2 = m2.getWeights();
  ok(w1.length === w2.length && w1.every((v, i) => v === w2[i]), 'MLP 初始化确定性（同种子逐位一致）');
  console.log(`  布局: ${JSON.stringify(d.blocks)}`);
}

console.log('== 2. 平行世界一致性（反作弊）==');
{
  let nextId = 9000;
  const C = (s: Suit, r: number): Card => ({ id: nextId++, suit: s, rank: r });
  const myHand = [C('S', 3), C('H', 4), C('D', 5), C('C', 6), C('S', 7), C('S', 9), C('H', 9), C('D', 9), C('C', 9), C('S', 12), C('J', 16)];
  const craft = (oppHands: Card[][], toBeat: Card[] | null): GameState => {
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    const state = startGame(match);
    state.hands = [myHand, ...oppHands];
    state.turn = 0; state.leader = 1; state.lastPlayer = 1;
    state.lastCombo = toBeat ? classify(toBeat, state.ctx)[0] : null;
    return state;
  };
  const deckA = buildDeck().filter((c) => !myHand.includes(c)).slice(0, 60);
  const handsA = [deckA.slice(0, 20), deckA.slice(20, 40), deckA.slice(40, 60)];
  const deckB = [...deckA];
  for (let i = deckB.length - 1; i > 0; i--) {
    const j = (i * 7 + 13) % (i + 1);
    [deckB[i], deckB[j]] = [deckB[j], deckB[i]];
  }
  const handsB = [deckB.slice(0, 20), deckB.slice(20, 40), deckB.slice(40, 60)];

  for (const [name, toBeat] of [['领出', null], ['跟牌', [C('S', 8), C('H', 8)]]] as const) {
    const fA = encodeState(craft(handsA, toBeat), 0, new PublicTracker(), new Float32Array(INPUT_DIM));
    const fB = encodeState(craft(handsB, toBeat), 0, new PublicTracker(), new Float32Array(INPUT_DIM));
    ok(fA.every((v, i) => v === fB[i]), `特征逐位一致（${name}）`);
    const decide = (st: GameState): string => {
      const seat = new NeuralSeat(0, new MLP(7), 0, () => 0);
      const d = seat.decide(st);
      return d.move.pass ? 'pass' : `${d.move.combo!.kind}:${d.move.combo!.cards.map((x) => x.id).sort().join(',')}`;
    };
    const keyA = decide(craft(handsA, toBeat));
    const keyB = decide(craft(handsB, toBeat));
    ok(keyA === keyB, `决策一致（${name}）→ ${keyA}`);
  }
}

console.log('== 3. 引擎整场循环冒烟（启发式 3 场）==');
{
  let tributeSeen = false, winners = 0, totalGames = 0;
  for (let m = 0; m < 3; m++) {
    const match = createMatch({ ...DEFAULT_RULES }, 1000 + m);
    let games = 0;
    while (match.winner == null && games < 100) {
      const state = startGame(match);
      const ais = [0, 1, 2, 3].map((s) => createAI(s, 1, s * 31 + games));
      ais.forEach((p) => p.reset(state, match.opts));
      let guard = 0;
      while (!state.over && guard++ < 2000) {
        const toBeat = state.lastCombo;
        const mv = guardMove(state, ais[state.turn].decide(state) as { pass: boolean; combo?: Combo });
        const events = applyMove(state, mv as never);
        ais.forEach((q) => q.observe(events, toBeat));
      }
      games += 1; totalGames += 1;
      if (state.tribute) tributeSeen = true;
    }
    if (match.winner != null) winners += 1;
  }
  ok(winners === 3, `3 场全部过A（${winners}/3，共 ${totalGames} 副）`);
  ok(tributeSeen, '进贡在第 2 副起出现');
}

console.log('== 4. 随机场采样冒烟 ==');
{
  const mlp = new MLP(1);
  const t0 = performance.now();
  const r = runTrainingMatch(mlp, 0, 123);
  const sec = (performance.now() - t0) / 1000;
  const avgC = r.candCounts.length ? r.candCounts.reduce((a, b) => a + b, 0) / r.candCounts.length : 0;
  console.log(`  games=${r.games} decisions=${r.decisions} 平均候选=${avgC.toFixed(1)} capped=${r.capped} 耗时=${sec.toFixed(1)}s`);
  ok(r.samples !== null && r.samples.length > 0, `带标签样本 ${r.samples?.length ?? 0} 条`);
  if (r.samples) {
    const ys = r.samples.map((s) => s.y);
    ok(Math.min(...ys) >= -4 && Math.max(...ys) <= 4, `y∈[${Math.min(...ys)},${Math.max(...ys)}] ⊆ [-4,4]`);
    const passes = r.kindChosen[r.kindChosen.length - 1];
    console.log(`  动作分布: ${r.kindChosen.map((v, i) => (v > 0 ? `${schemaDescriptor().kinds[i] ?? 'pass'}:${v}` : '')).filter(Boolean).join(' ')}`);
    void passes;
  }
}

console.log('== 5. 启发式中级 vs 高级 首选差异调查 ==');
{
  let total = 0, diff = 0;
  const match = createMatch({ ...DEFAULT_RULES }, 777);
  const state = startGame(match);
  const mems = [0, 1, 2, 3].map(() => PlayMemory.fromStart(state.ctx));
  const ais = [0, 1, 2, 3].map((s) => createAI(s, 1, s * 7));
  ais.forEach((p) => p.reset(state, match.opts));
  let guard = 0;
  while (!state.over && guard++ < 800) {
    const seat = state.turn;
    const toBeat = state.lastCombo;
    mems[seat].syncState(state);
    const key = (x: { move: { pass: boolean }; combo: Combo | null }): string =>
      x.move.pass ? 'pass' : `${x.combo!.keyRank}:${x.combo!.cards.map((c) => c.id).sort().join()}`;
    const a = scoreCandidates({ state, seat, caps: LEVEL_CAPS[1], memory: mems[seat], rand: () => 0 })[0];
    const b = scoreCandidates({ state, seat, caps: LEVEL_CAPS[2], memory: mems[seat], rand: () => 0 })[0];
    total += 1;
    if (key(a) !== key(b)) diff += 1;
    const mv = guardMove(state, ais[seat].decide(state) as { pass: boolean; combo?: Combo });
    const events = applyMove(state, mv as never);
    mems.forEach((mm) => { mm.observeEvents(events, toBeat); });
  }
  console.log(`  ${total} 决策点中，中级/高级（关噪声同记牌器）首选不同 ${diff} 个（${total ? ((diff / total) * 100).toFixed(1) : 0}%）`);
  ok(true, '档位差异调查完成（数字记入报告）');
}

console.log('== 6. 评测跑者冒烟 ==');
{
  const r = evalModelVsHeuristic(new MLP(5), 1, [11, 22], true);
  ok(r.games === 4, `评测 4 副（实际 ${r.games}），随机初始化模型胜 ${r.modelWins}`);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
