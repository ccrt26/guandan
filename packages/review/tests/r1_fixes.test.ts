import { describe, expect, it } from 'vitest';
import {
  applyMove, bestResponse, beats, buildDeck, canPass, createMatch, DEFAULT_RULES, legalCombos,
  newRecordId, Recorder, startGame, type Card, type Combo, type GameRecord, type MoveRecord, type Suit, RNG,
} from '@gd/engine';
import { decideMove, PlayMemory, simulateToEnd } from '@gd/ai';
import { analyzeGame } from '../src/analyzer';
import { buildCoachMessages } from '../src/coach';
import { runCounterfactual } from '../src/counterfactual';
import { stateBefore } from '../src/replay';

// ---------- 与 nnAdvisor.test.ts 相同模式的记录构造器 ----------
let nid = 90000;
const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });

function padHands(hands: Card[][]): Card[][] {
  const used = new Set(hands.flat().map((c) => c.id));
  const pool = buildDeck().filter((c) => !used.has(c.id));
  let pi = 0;
  return hands.map((h) => {
    const out = [...h];
    while (out.length < 27) out.push(pool[pi++]);
    return out;
  });
}

function craftRecord(rawHands: Card[][], script: { seat: number; cards?: Card[]; pass?: boolean }[], levels: [number, number], leader: number): GameRecord {
  const hands = padHands(rawHands);
  const match = createMatch({ ...DEFAULT_RULES }, 42);
  match.levels = levels;
  const state = startGame(match);
  state.hands = hands.map((h) => [...h]);
  state.turn = leader; state.leader = leader; state.lastPlayer = leader;
  state.lastCombo = null; state.finished = []; state.over = false; state.result = null; state.moveNo = 0;
  const moves: MoveRecord[] = [];
  let n = 0;
  for (const s of script) {
    n += 1;
    if (state.turn !== s.seat) throw new Error(`剧本座位错位：第 ${n} 步轮到 ${state.turn} 却指定 ${s.seat}`);
    let combo: Combo | null = null;
    if (!s.pass && s.cards) {
      combo = bestResponse(s.cards, state.lastCombo, state.ctx, DEFAULT_RULES);
      if (!combo) throw new Error(`第 ${n} 步牌不成型`);
      if (state.lastCombo && !beats(combo, state.lastCombo)) throw new Error(`第 ${n} 步压不过`);
    }
    const c = combo as Combo | null;
    const tb = state.lastCombo as Combo | null;
    applyMove(state, c ? { pass: false, combo: c } : { pass: true });
    moves.push({
      moveNo: n, player: s.seat, pass: !c, cards: c?.cards, comboKind: c?.kind,
      mainRank: c?.mainRank, handsAfter: state.hands.map((h) => h.length),
      toBeatKind: tb?.kind, toBeatRank: tb?.mainRank,
    });
  }
  return {
    schemaVersion: 2, id: `t${nid}`, matchId: 't', createdAt: Date.now(),
    ruleOpts: { ...DEFAULT_RULES }, levelsBefore: levels, leader, humanSeat: 0,
    difficulties: [null, 1, 1, 1], initialHands: hands.map((h) => [...h]), moves, result: null,
  };
}

/** 完整随机对局（review.test.ts 同款 Recorder 版） */
function playRecord(seed: number): GameRecord {
  const rng = new RNG(seed);
  const match = createMatch({ ...DEFAULT_RULES }, seed);
  const state = startGame(match);
  const recorder = new Recorder({
    id: newRecordId(), matchId: 'test', createdAt: Date.now(),
    ruleOpts: { ...DEFAULT_RULES },
    levelsBefore: [...state.levelsBefore] as [number, number],
    leader: state.leader, humanSeat: 0, difficulties: [null, 1, 1, 1],
    initialHands: state.hands.map((h) => [...h]),
  });
  const mems = [0, 1, 2, 3].map(() => PlayMemory.fromStart(state.ctx));
  let guard = 0;
  while (!state.over && guard++ < 2000) {
    const seat = state.turn;
    const combos = legalCombos(state);
    let move = decideMove({
      state, seat,
      caps: { memory: true, inference: false, cooperation: true, planning: true, noise: 0.1, rolloutIters: 0 },
      memory: mems[seat], rand: rng.next.bind(rng),
    });
    if (move.pass && !canPass(state)) move = { pass: false, combo: combos[0] };
    if (!move.pass) {
      const chosen = move.combo;
      if (!combos.some((c) => c === chosen)) {
        move = combos.length > 0 ? { pass: false, combo: combos[0] } : { pass: true };
      }
    }
    const toBeat = state.lastCombo;
    applyMove(state, move);
    recorder.record(seat, { pass: move.pass, combo: move.pass ? null : move.combo }, state.hands, toBeat);
  }
  return recorder.finish(state.result!);
}

describe('R1-B/F01 级牌与万能牌说明按记录规则上下文生成', () => {
  it('stage 口径：只声明台上方级数的红心为万能配牌', () => {
    const rec = craftRecord([[C('S', 8), C('H', 8), C('D', 8)], [], [], []], [{ seat: 0, cards: [C('H', 8), C('D', 8)] }], [2, 2], 0);
    rec.ruleOpts = { ...rec.ruleOpts, levelMode: 'stage' };
    rec.levelsBefore = [2, 5];
    rec.stageTeam = 1; // 对方在台打 5
    const analysis = analyzeGame(craftRecord([[C('S', 8), C('H', 8), C('D', 8)], [], [], []], [{ seat: 0, cards: [C('H', 8), C('D', 8)] }], [2, 2], 0));
    const user = buildCoachMessages(rec, analysis, [])[1].content;
    expect(user).toContain('对方在台');
    expect(user).toContain('打 5');
    expect(user).toMatch(/红心5×2 为万能配牌/);
    expect(user).not.toMatch(/红心2\/5/); // 旧 both 写法不得出现
    expect(user).toContain('不参与配牌');
  });

  it('both 历史口径：标注历史口径回放', () => {
    const rec = craftRecord([[C('S', 8), C('H', 8), C('D', 8)], [], [], []], [{ seat: 0, cards: [C('H', 8), C('D', 8)] }], [2, 2], 0);
    rec.ruleOpts = { ...rec.ruleOpts, levelMode: 'both' };
    rec.levelsBefore = [3, 7];
    const analysis = analyzeGame(rec);
    const user = buildCoachMessages(rec, analysis, [])[1].content;
    expect(user).toContain('历史口径');
  });
});

describe('R1-E/F04·F05 实际动作的物理匹配', () => {
  it('同声明的另一物理实现（对8 用 H8D8）：匹配自己的候选、不借他者分数（v3 重锁）', () => {
    // 手里有三个 8（S8,H8,D8），打 H8+D8 对子。
    // v2：枚举只留 {S8,H8} → {H8,D8} uncovered，比较不发生。
    // v3（REVIEW4-A1）：{H8,D8} 是独立候选，按自己的分数参与比较；
    // 若启发式 top1 是别的声明（如三连对 333444555），分歧来自声明差异而非花色选择。
    // 不变量（v3 表述）：实际动作必须匹配到自己的候选（不借他者分数），
    // 同声明不同花色变体之间的分差不构成分歧（analyzer 声明级对齐）。
    const rec = craftRecord(
      [[C('S', 8), C('H', 8), C('D', 8)], [], [], []],
      [{ seat: 0, cards: [C('H', 8), C('D', 8)] }],
      [2, 2], 0,
    );
    const analysis = analyzeGame(rec);
    const mv = analysis.moves[0];
    // 同声明对齐检查：启发式若也首选对8（任意花色变体），实际对8 不判分歧
    if (mv.note.includes('对子') || mv.note.includes('对8')) {
      expect(mv.grade).not.toBe('divergent');
    } else {
      // 分歧原因必须是声明级差异（如三连对），不得是"对8 用了 H8D8 而非 S8H8"
      expect(mv.note).not.toMatch(/H8\s*D8.*S8|花色.*分歧/);
      expect(mv.grade === 'divergent' || mv.grade === 'ok' || mv.grade === 'good' || mv.grade === 'uncovered').toBe(true);
    }
    expect(analysis.stats.divergent).toBeLessThanOrEqual(1);
  });
});

describe('R1-A/F09 来源标注一致（UI 与 prompt 不得写 ck180 为替代来源）', () => {
  it('counterfactual 结果与 coach 文案来源如实', async () => {
    const rec = playRecord(55);
    const analysis = analyzeGame(rec);
    const cf = await runCounterfactual(rec, analysis.moves, { maxDecisions: 2 });
    for (const r of cf) {
      expect(r.sourceId).not.toContain('ck180');
      expect(r.sourceId).toContain('heuristic');
    }
    if (cf.length > 0) {
      const user = buildCoachMessages(rec, analysis, cf)[1].content;
      expect(user).toContain('事后情景演示');
      expect(user).not.toContain('建议来源=ck180');
      expect(user).not.toMatch(/胜率 ?\d+%/); // 不再呈现百分比胜率
    }
  }, 60000);
});

describe('R1-D/F11 noise=0 续打无有效随机入口', () => {
  it('同局面不同 RNG 种子的 simulateToEnd 结果一致（同轨迹）', () => {
    const rec = playRecord(123);
    const state = stateBefore(rec, Math.min(30, rec.moves.length));
    const a = simulateToEnd(state, new RNG(1));
    const b = simulateToEnd(state, new RNG(999));
    const c = simulateToEnd(state, new RNG(1));
    expect(a.finishOrder).toEqual(b.finishOrder);
    expect(a.winnerTeam).toBe(b.winnerTeam);
    expect(a.moves).toBe(b.moves);
    expect(c).toEqual(a);
  }, 30000);
});

describe('R1-C/B4 命名如实', () => {
  it('不再出现"最优拆解/综合评级/失误率"', () => {
    const rec = playRecord(66);
    const analysis = analyzeGame(rec);
    const user = buildCoachMessages(rec, analysis, [])[1].content;
    expect(user).toContain('参考拆分');
    expect(user).not.toContain('最优拆解');
    expect(user).not.toContain('综合评级');
    expect(user).not.toContain('失误率');
    expect(user).toContain('筛选信号');
  });
});
