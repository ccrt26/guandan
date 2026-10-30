import { describe, expect, it } from 'vitest';
// 测试专用：node 模块类型不在 review 包 tsconfig（vitest node 环境运行时可用）
// @ts-expect-error node:fs 仅测试运行时使用
import { readFileSync } from 'node:fs';
// @ts-expect-error node:path 仅测试运行时使用
import { join } from 'node:path';
import {
  applyMove, beats, bestResponse, buildDeck, createMatch, DEFAULT_RULES, newRecordId, Recorder, RECORD_SCHEMA_VERSION, startGame,
  type Card, type Combo, type GameRecord, type MoveRecord, type Suit,
} from '@gd/engine';
import { createAI, MLP } from '@gd/ai';
import { analyzeWithModel } from '../src/nnAdvisor';
import { validateRecord } from '../src/replay';

// ---------- 记录构造器：手工牌面 + 最小剧本（补足 108 张、过完整性校验） ----------
let nid = 70000;
const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });
const J = (): Card => C('J', 16); // 小王

interface Scripted { seat: number; cards?: Card[]; pass?: boolean }

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

function craftRecord(rawHands: Card[][], script: Scripted[], levels: [number, number], leader: number): GameRecord {
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
    if (state.over) throw new Error(`剧本超出对局：第 ${n} 步`);
    if (state.turn !== s.seat) throw new Error(`剧本座位错位：第 ${n} 步轮到 ${state.turn} 却指定 ${s.seat}`);
    let combo: Combo | null = null;
    if (!s.pass && s.cards) {
      combo = bestResponse(s.cards, state.lastCombo, state.ctx, DEFAULT_RULES);
      if (!combo) throw new Error(`第 ${n} 步牌不成型`);
      if (state.lastCombo && !beats(combo, state.lastCombo)) throw new Error(`第 ${n} 步压不过`);
    }
    const toBeat: Combo | null = state.lastCombo;
    applyMove(state, combo ? { pass: false, combo } : { pass: true });
    const c = combo as Combo | null;
    const tb = toBeat as Combo | null;
    moves.push({
      moveNo: n, player: s.seat, pass: !c, cards: c?.cards, comboKind: c?.kind,
      mainRank: c?.mainRank, handsAfter: state.hands.map((h) => h.length),
      toBeatKind: tb?.kind, toBeatRank: tb?.mainRank,
    });
  }
  const rec: GameRecord = {
    schemaVersion: 2, id: `t${nid}`, matchId: 't', createdAt: Date.now(),
    ruleOpts: { ...DEFAULT_RULES }, levelsBefore: levels, leader, humanSeat: 0,
    difficulties: [null, 1, 1, 1], initialHands: hands.map((h) => [...h]), moves, result: null,
  };
  const v = validateRecord(rec);
  if (!v.ok) throw new Error(`构造记录不完整：${v.reason}`);
  return rec;
}

/** 可控打分器：按动作块特征给分（pass/目标点数×张数定向，与补牌无关） */
function scriptedScorer(scoreOf: (c: { mainRank: number; size: number } | null) => number): { forward: (X: Float32Array, n: number) => Float32Array } {
  return {
    forward(X: Float32Array, n: number): Float32Array {
      const out = new Float32Array(n);
      const A = 317; // STATE_DIM：动作块起点。
      // 注：encodeAction 对 pass 写 out[10]（物理块 ♦2 槽，schema 既有自洽布局），
      // 非出牌的判别 = kind 位（A+54..A+63）全零且 A+10 为 1。
      for (let i = 0; i < n; i++) {
        let kindAny = false;
        for (let k = 0; k < 10; k++) if (X[i * 385 + A + 54 + k] === 1) { kindAny = true; break; }
        if (!kindAny) { out[i] = scoreOf(null); continue; }
        let rankMax = 0, size = 0;
        for (let p = 0; p < 54; p++) {
          const cnt = X[i * 385 + A + p];
          if (cnt > 0) { const r = p % 13 + 2; rankMax = Math.max(rankMax, r); size += cnt; }
        }
        out[i] = scoreOf({ mainRank: rankMax, size });
      }
      return out;
    },
  };
}
const pairOf = (r: number) => (c: { mainRank: number; size: number } | null) => (c === null ? -1 : c.mainRank === r && c.size === 2 ? 10 : 1);

describe('D5 定点案例：神经复盘建议排名（CLEAN1-REVIEW-1.0 D）', () => {
  const L6: [number, number] = [6, 6];

  it('案例1 正常准确映射：模型首选=实际出牌 → match / actualRank=1', () => {
    const hand = [C('S', 9), C('H', 9), C('S', 3)];
    const hands = [hand, [C('D', 13)], [C('S', 14)], [C('C', 14)]];
    const rec = craftRecord(hands, [
      { seat: 0, cards: [hand[0], hand[1]] }, // 领对 9
      { seat: 1, pass: true },
    ], L6, 0);
    const s = analyzeWithModel(rec, scriptedScorer(pairOf(9)), 'test');
    expect(s.moves[0].verdict).toBe('match');
    expect(s.moves[0].actualRank).toBe(1);
    expect(s.moves[0].top[0].text).toContain('对子');
  });

  it('案例2 模型更推荐另一种：实际非首选 → prefer_other + actualRank>1', () => {
    const hand = [C('S', 9), C('H', 9), C('S', 3)];
    const hands = [hand, [C('D', 13)], [C('S', 14)], [C('C', 14)]];
    const rec = craftRecord(hands, [
      { seat: 0, cards: [hand[2]] }, // 领小单（模型首选对 9）
      { seat: 1, cards: [hands[1][0]] },
    ], L6, 0);
    const s = analyzeWithModel(rec, scriptedScorer(pairOf(9)), 'test');
    expect(s.moves[0].verdict).toBe('prefer_other');
    expect(s.moves[0].actualRank!).toBeGreaterThan(1);
    expect(s.moves[0].verdictText).toBe('模型更推荐另一种出法');
  });

  it('案例3 实际 pass 且模型首选 pass → match（多候选下）', () => {
    const hand = [C('S', 3), C('H', 3), J()];
    const hands = [hand, [C('D', 14)], [C('S', 4)], [C('C', 4)]];
    const rec = craftRecord(hands, [
      { seat: 1, cards: [hands[1][0]] }, // 东领 A
      { seat: 2, pass: true }, { seat: 3, pass: true },
      { seat: 0, pass: true },          // 我让（模型也首选让；手握小王可压→多候选）
    ], L6, 1);
    const s = analyzeWithModel(rec, scriptedScorer((c) => (c === null ? 5 : 1)), 'test');
    expect(s.moves[0].verdict).toBe('match');
    expect(s.moves[0].nCandidates).toBeGreaterThan(1);
  });

  it('案例4 实际非 pass 而模型首选 pass → prefer_other', () => {
    const hand = [C('S', 3), C('H', 3), J()];
    const hands = [hand, [C('D', 14)], [C('S', 4)], [C('C', 4)]];
    const rec = craftRecord(hands, [
      { seat: 1, cards: [hands[1][0]] },
      { seat: 2, pass: true }, { seat: 3, pass: true },
      { seat: 0, cards: [hand[2]] },     // 我用小王压（模型首选让）
    ], L6, 1);
    const s = analyzeWithModel(rec, scriptedScorer((c) => (c === null ? 5 : 1)), 'test');
    expect(s.moves[0].verdict).toBe('prefer_other');
    expect(s.stats.firstChoiceAgreement).toBe(0);
  });

  it('案例5 同声明不同实体副本：两副♠3 出 id 不同 → 值等价规范化对齐', () => {
    const hand = [C('S', 3), C('S', 3), C('H', 9)];
    const hands = [hand, [C('D', 5)], [C('S', 7)], [C('D', 8)]];
    const rec = craftRecord(hands, [
      { seat: 0, cards: [hand[1]] }, // 出第二副的 id（枚举代表取第一副）
      { seat: 1, cards: [hands[1][0]] },
    ], L6, 0);
    const s = analyzeWithModel(rec, scriptedScorer((c) => (c === null ? -1 : c.mainRank === 3 && c.size === 1 ? 10 : 1)), 'test');
    expect(s.moves[0].verdict).toBe('match'); // 值等价 → 对齐
    expect(s.stats.sameCardsDiffDecl).toBe(0);
    expect(s.stats.uncovered).toBe(0);
  });

  it('案例6（v3 重锁）资源变体 {♠8,♦8} 已入候选 → 覆盖对齐，不再 uncovered', () => {
    // v2 缺陷曾坐实：枚举只留手序前两张 {S8,H8}，{S8,D8} 合法却 uncovered。
    // cand-suit-v3（REVIEW4-A1）后花色变体全部入候选——本用例锁定修复语义。
    // uncovered 门本身改由 D6 验收集的 fault-injection 用例覆盖（不在此测）。
    const hand = [C('S', 8), C('H', 8), C('D', 8), C('S', 3)];
    const hands = [hand, [C('D', 13)], [C('S', 14)], [C('C', 14)]];
    const rec = craftRecord(hands, [
      { seat: 0, cards: [hand[0], hand[2]] }, // {S8,D8}
      { seat: 1, pass: true },
    ], L6, 0);
    const s = analyzeWithModel(rec, scriptedScorer(() => 1), 'test');
    expect(s.moves[0].verdict).not.toBe('uncovered');
    expect(s.moves[0].actualRank).not.toBeNull();
    expect(s.stats.uncovered).toBe(0);
  });

  it('案例7 候选唯一：天王炸压顶无牌可跟 → single_candidate（措辞不称规则强制）', () => {
    const hand = [C('S', 3), C('H', 3)];
    const hands = [hand, [C('J', 16), C('J', 16), C('J', 17), C('J', 17)], [C('S', 4)], [C('C', 4)]];
    const rec = craftRecord(hands, [
      { seat: 1, cards: hands[1] }, // 东领天王炸：任何补牌都压不过 → 候选唯一=pass
      { seat: 2, pass: true }, { seat: 3, pass: true },
      { seat: 0, pass: true },
    ], L6, 1);
    const s = analyzeWithModel(rec, scriptedScorer(() => 1), 'test');
    expect(s.moves[0].verdict).toBe('single_candidate');
    expect(s.moves[0].verdictText).toContain('不等于规则强制');
  });

  it('案例8 三方意见不同：引擎建议 / 模型首选 / 玩家实打 三字段共存', async () => {
    const { analyzeGame } = await import('../src/analyzer');
    const hand = [C('S', 9), C('H', 9), C('S', 3)];
    const hands = [hand, [C('D', 13)], [C('S', 14)], [C('C', 14)]];
    const rec = craftRecord(hands, [
      { seat: 0, cards: [hand[2]] },
      { seat: 1, cards: [hands[1][0]] },
    ], L6, 0);
    const heur = analyzeGame(rec);
    const nn = analyzeWithModel(rec, scriptedScorer(pairOf(9)), 'test');
    expect(nn.moves[0].actualText).toContain('单张 3');
    expect(nn.moves[0].top[0].text).toContain('对子');
    expect(heur.moves[0].recommendedText).toBeTruthy(); // 引擎建议字段共存（来源标注由 UI 层负责）
  });

  it('案例9 万能牌：级6 手 S6+♥6(万能) 的级牌对与候选对齐（A线变体已在候选内）', () => {
    const hand = [C('S', 6), C('H', 6), C('S', 3)];
    const hands = [hand, [C('D', 13)], [C('S', 14)], [C('C', 14)]];
    const rec = craftRecord(hands, [
      { seat: 0, cards: [hand[0], hand[1]] }, // S6+♥6当6：对级牌 6（万能牌补足/A线变体）
      { seat: 1, pass: true },
    ], L6, 0);
    // 精确定位：♠6 在物理槽 4、♥6 在槽 17——只给"自然S6+万能H6"这个变体最高分
    const s = analyzeWithModel(rec, {
      forward(X: Float32Array, n: number) {
        const out = new Float32Array(n);
        const A = 317;
        for (let i = 0; i < n; i++) {
          out[i] = X[i * 385 + A + 4] === 1 && X[i * 385 + A + 17] === 1 ? 10 : 1;
        }
        return out;
      },
    }, 'test');
    expect(s.moves[0].verdict).toBe('match');
    expect(s.moves[0].actualRank).toBe(1);
  });

  it('案例10 同牌异型解释：匹配器直接单测——同牌张多重集但声明不同 → 不强配', async () => {
    const { matchMoveToRanking } = await import('../src/nnAdvisor');
    const cards = [C('S', 9), C('H', 9), C('D', 9), C('C', 4), C('S', 4)];
    // 候选 A：三带二 999+44（与实际同牌同声明 → 应命中）
    const trioPair = { combo: { kind: 'trio_pair', cards, size: cards.length, keyRank: 9, length: 1, pairRanks: [4], suit: undefined, wildAs: [] } as unknown as Combo };
    const m1 = matchMoveToRanking({ pass: false, combo: trioPair.combo }, [trioPair]);
    expect(m1.idx).toBe(0);
    expect(m1.sameCardsOnly).toBe(false);
    // 候选 B：同牌张多重集、不同声明（如旧记录口径 trio，pairRanks 语义不同）→ 不强配
    const actualDecl = { kind: 'trio', cards, size: cards.length, keyRank: 9, length: 1, pairRanks: [], suit: undefined, wildAs: [] } as unknown as Combo;
    const m2 = matchMoveToRanking({ pass: false, combo: actualDecl }, [trioPair]);
    expect(m2.idx).toBe(-1);
    expect(m2.sameCardsOnly).toBe(true); // 驱动 same_cards_diff_decl 分支
  });

  it('案例11 近似并列：打分器同分 → nearTie 标注', () => {
    const hand = [C('S', 9), C('H', 9), C('S', 3)];
    const hands = [hand, [C('D', 5)], [C('S', 7)], [C('D', 8)]];
    const rec = craftRecord(hands, [{ seat: 0, cards: [hand[2]] }, { seat: 1, cards: [hands[1][0]] }], L6, 0);
    const s = analyzeWithModel(rec, scriptedScorer(() => 1), 'test'); // 全部同分
    expect(s.moves[0].nearTie).toBe(true);
  });

  it('案例12 未见手牌交换不改变建议（信息边界：只读自家+公开）', () => {
    const hand = [C('S', 9), C('H', 9), C('S', 3)];
    const e = [C('D', 5), C('C', 5)];
    const n = [C('S', 5), C('H', 14)];
    const w = [C('C', 9), C('S', 14)];
    const sc: Scripted[] = [
      { seat: 0, cards: [hand[0], hand[1]] },
      { seat: 1, pass: true }, { seat: 2, pass: true }, { seat: 3, pass: true },
      { seat: 0, cards: [hand[2]] },
      { seat: 1, cards: [e[0]] },
    ];
    const recA = craftRecord([hand, e, n, w], sc, L6, 0);
    // 变体：东/北交换一张从未打出的暗牌（东 ♣5 ↔ 北 ♠5；张数与已出牌不变）
    const recB = craftRecord([hand, [e[0], n[0]], [e[1], n[1]], w], sc, L6, 0);
    const score = scriptedScorer(pairOf(9));
    const a = analyzeWithModel(recA, score, 't');
    const b = analyzeWithModel(recB, score, 't');
    expect(a.moves.map((m) => [m.verdict, m.top[0]?.text, m.actualRank])).toEqual(b.moves.map((m) => [m.verdict, m.top[0]?.text, m.actualRank]));
  });

  it('案例13 回放时点无未来信息：截断记录后，已发生各手建议逐字不变', () => {
    const hand = [C('S', 9), C('H', 9), C('S', 3)];
    const hands = [hand, [C('D', 5)], [C('S', 7)], [C('D', 8)]];
    const sc: Scripted[] = [
      { seat: 0, cards: [hand[0], hand[1]] },
      { seat: 1, pass: true }, { seat: 2, pass: true }, { seat: 3, pass: true },
      { seat: 0, cards: [hand[2]] },
      { seat: 1, cards: [hands[1][0]] },
    ];
    const rec = craftRecord(hands, sc, L6, 0);
    const truncated: GameRecord = { ...rec, moves: rec.moves.slice(0, 4) }; // 只留第 1 个人类决策
    const score = scriptedScorer(pairOf(9));
    const a = analyzeWithModel(rec, score, 't');
    const b = analyzeWithModel(truncated, score, 't');
    expect(b.moves.length).toBe(1);
    expect(JSON.stringify(a.moves[0])).toBe(JSON.stringify(b.moves[0]));
  });

  it('案例14 真实 ck180 权重 + 真实对局：覆盖统计合理、无崩溃、措辞红线', () => {
    const m2 = createMatch({ ...DEFAULT_RULES }, 31337);
    const st2 = startGame(m2);
    const ais2 = [0, 1, 2, 3].map((s) => createAI(s, 1, s * 7));
    ais2.forEach((p) => p.reset(st2, m2.opts));
    const rec2 = new Recorder({
      schemaVersion: RECORD_SCHEMA_VERSION, id: newRecordId(), matchId: 'm', createdAt: Date.now(),
      ruleOpts: { ...m2.opts }, levelsBefore: [...st2.levelsBefore] as [number, number],
      leader: st2.leader, humanSeat: 0, difficulties: [null, 1, 1, 1],
      initialHands: st2.hands.map((h) => [...h]),
    });
    let guard = 0;
    while (!st2.over && guard++ < 2000) {
      const toBeat = st2.lastCombo;
      const mover = st2.turn;
      const mv = ais2[st2.turn].decide(st2);
      applyMove(st2, mv);
      rec2.record(mover, mv, st2.hands, toBeat);
    }
    const game = rec2.finish(st2.result!);
    const here = (import.meta as unknown as { dirname: string }).dirname;
    const w = readFileSync(join(here, '..', '..', '..', 'lab', 'archive', 'legacy-through-20261030', 'clean1', 'clean1-2026102609500', 'ck180', 'weights.f32'));
    const mlp = new MLP(1);
    mlp.setWeights(new Float32Array(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength) as ArrayBuffer));
    const s = analyzeWithModel(game, mlp, 'clean1-ck180-20261026');
    expect(s.stats.totalDecisions).toBeGreaterThan(10);
    expect(s.stats.aligned + s.stats.uncovered + s.stats.sameCardsDiffDecl).toBeLessThanOrEqual(s.stats.totalDecisions);
    expect(s.moves.every((m) => !m.verdictText.includes('客观最佳') && !m.verdictText.includes('必错'))).toBe(true); // D2 措辞红线
    expect(s.modelVersion).toBe('clean1-ck180-20261026');
    const humanMoves = game.moves.filter((m) => m.player === 0).length;
    expect(s.stats.totalDecisions).toBeLessThanOrEqual(humanMoves);
  });
});
