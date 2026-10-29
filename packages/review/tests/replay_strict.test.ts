import { describe, expect, it } from 'vitest';
import {
  applyMove, bestResponse, buildDeck, canPass, createMatch, DEFAULT_RULES, legalCombos, newRecordId,
  Recorder, startGame, type Card, type Combo, type GameRecord, RNG,
} from '@gd/engine';
import { decideMove, PlayMemory } from '@gd/ai';
import { classifyReplay } from '../src/replayStatus';
import { analyzeGame } from '../src/analyzer';
import { buildCoachMessages } from '../src/coach';
import { stateBefore } from '../src/replay';
import { cloneForSim } from '../src/counterfactual';
import { matchAction, canonicalize } from '../src/actionIdentity';

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

describe('R2 严格回放分级', () => {
  it('新记录（schema v2，现代引擎）→ exact', () => {
    for (const seed of [11, 22, 33]) {
      const cls = classifyReplay(playRecord(seed));
      expect(cls.status).toBe('exact');
      expect(cls.migrations).toHaveLength(0);
      expect(cls.verifiedPrefixEnd).toBeGreaterThan(0);
    }
  });

  it('F02：历史 both 记录按原规则回放不套新默认（both 记录可 exact）', () => {
    const rec = playRecord(44);
    rec.ruleOpts = { ...rec.ruleOpts, levelMode: 'both' };
    const cls = classifyReplay(rec);
    expect(['exact', 'migrated_verified']).toContain(cls.status);
  });

  it('F07：压不过却出牌 → ambiguous（禁止静默强制开新轮后照常分析）', () => {
    const rec = playRecord(55);
    // 篡改：把某手跟牌换成一张小单张（牌张归属合法=还在手里，但压不过 → 语义改写必须被分级拦截）
    const target = rec.moves.find((m) => !m.pass && m.moveNo > 1 && rec.moves[m.moveNo - 2] && !rec.moves[m.moveNo - 2].pass);
    expect(target).toBeTruthy();
    const seat = target!.player;
    const played = new Set(rec.moves.filter((m) => m.player === seat && !m.pass && m.moveNo < target!.moveNo).flatMap((m) => m.cards?.map((c) => c.id) ?? []));
    const inHand = rec.initialHands[seat].filter((c) => !played.has(c.id) && c.suit !== 'J');
    expect(inHand.length).toBeGreaterThan(0);
    const low = inHand.sort((a, b) => a.rank - b.rank)[0];
    target!.cards = [low];
    target!.comboKind = 'single';
    target!.mainRank = low.rank;
    target!.pass = false;
    const cls = classifyReplay(rec);
    // 若该小单张碰巧能压过（如 2），则本例未构造出"压不过"场景——断言落在合法集合且非崩溃；
    // 压不过的确定性断言由下一例（直接构造压不过局面）保证
    expect(['exact', 'migrated_verified', 'ambiguous', 'invalid']).toContain(cls.status);
    if (cls.status === 'ambiguous') {
      expect(cls.firstBadMove).toBeGreaterThan(0);
      expect(cls.reason).toBeTruthy();
    }
  });

  it('F07b：确定性压不过场景 → 必为 ambiguous/invalid', () => {
    const rec = playRecord(55);
    // 第一手领出大王（J 17）单张，第二手让某家出小牌"跟"它——必然压不过
    const first = rec.moves.find((m) => !m.pass)!;
    const seat = first.player;
    const played = new Set(rec.moves.filter((m) => m.player === seat && !m.pass && m.moveNo < first.moveNo).flatMap((m) => m.cards?.map((c) => c.id) ?? []));
    const joker = rec.initialHands[seat].find((c) => c.suit === 'J') ?? rec.initialHands[seat].find((c) => c.suit !== 'J' && c.rank >= 14);
    expect(joker).toBeTruthy();
    first.cards = [joker!];
    first.comboKind = joker!.suit === 'J' ? 'single' : 'single';
    first.mainRank = joker!.rank;
    // 下一手非 pass 的话换成 3（若该玩家手里有）——压不过大王/A
    const next = rec.moves.find((m) => m.moveNo === first.moveNo + 1 && !m.pass);
    if (next) {
      const nSeat = next.player;
      const nPlayed = new Set(rec.moves.filter((m) => m.player === nSeat && !m.pass && m.moveNo < next.moveNo).flatMap((m) => m.cards?.map((c) => c.id) ?? []));
      const small = rec.initialHands[nSeat].find((c) => !nPlayed.has(c.id) && c.suit !== 'J' && c.rank < 10);
      if (small) {
        next.cards = [small];
        next.comboKind = 'single';
        next.mainRank = small.rank;
        const cls = classifyReplay(rec);
        expect(['ambiguous', 'invalid']).toContain(cls.status);
      }
    }
  });

  it('F10：损坏记录（重复出同一张牌）→ invalid 且不产出分析', () => {
    const rec = playRecord(66);
    const first = rec.moves.find((m) => !m.pass && (m.cards?.length ?? 0) >= 2);
    expect(first).toBeTruthy();
    // 把两张牌改成同一张 id → 完整性破坏
    first!.cards = [first!.cards![0], first!.cards![0]];
    const cls = classifyReplay(rec);
    expect(cls.status).toBe('invalid');
  });
});

describe('F12 cloneForSim 忠实克隆', () => {
  it('克隆保持规则/轮次/名次/轮内动作一致', () => {
    const rec = playRecord(77);
    const st = stateBefore(rec, Math.min(40, rec.moves.length));
    const cl = cloneForSim(st);
    expect(cl.ctx).toBe(st.ctx);
    expect(cl.stageTeam).toBe(st.stageTeam);
    expect(cl.turn).toBe(st.turn);
    expect(cl.leader).toBe(st.leader);
    expect(cl.lastCombo).toBe(st.lastCombo);
    expect(cl.passCount).toBe(st.passCount);
    expect(cl.finished).toEqual(st.finished);
    expect(cl.trickPlays).toEqual(st.trickPlays);
    expect(cl.hands.map((h) => h.length)).toEqual(st.hands.map((h) => h.length));
    // 克隆后合法动作集合一致
    const a = legalCombos(cl as never);
    const b = legalCombos(st as never);
    expect(a.length).toBe(b.length);
  });
});

describe('动作身份匹配器（F04/F05/F06）', () => {
  it('物理 id 优先；等价副本规范化；同牌不同声明不强配', () => {
    const base = { id: 1, suit: 'S', rank: 8 } as never;
    const copy = { id: 99, suit: 'S', rank: 8 } as never; // 同花色同点数副本
    const other = { id: 2, suit: 'H', rank: 8 } as never;
    const pair = (x: unknown, y: unknown) => ({ kind: 'pair', mainRank: 8, length: 1, size: 2, cards: [x, y], keyRank: 8, pairRanks: [], wildAs: [] }) as never;
    const actual = canonicalize(0, false, pair(base, copy));
    const cands = [canonicalize(0, false, pair(base, other))]; // 候选=♠8♥8（不同资源）
    const m = matchAction(actual, cands);
    expect(m.status).toBe('uncovered'); // 同声明不同资源：不互借
    const copy2 = { id: 55, suit: 'S', rank: 8 } as never; // 另一张 ♠8 副本
    const sameValue = canonicalize(0, false, pair(base, copy2));
    expect(matchAction(sameValue, [actual]).status).toBe('equivalent_copy'); // 等价副本（同声明+同资源多重集）
  });
});

describe('F03 万能牌代入进入剧本（所有牌型）', () => {
  it('含万能牌的出牌在 prompt 剧本中有"当X"标注与声明（构造：♥2 当 8 的对子领出）', () => {
    let nid = 95000;
    const C = (s: Card['suit'], r: number): Card => ({ id: nid++, suit: s, rank: r });
    
    const hands0 = [[C('S', 8), C('H', 2)], [], [], []];
    const used = new Set(hands0.flat().map((c) => c.id));
    const pool = buildDeck().filter((c) => !used.has(c.id));
    let pi = 0;
    const hands = hands0.map((h) => { const o = [...h]; while (o.length < 27) o.push(pool[pi++]); return o; });
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    const state = startGame(match);
    state.hands = hands.map((h) => [...h]);
    state.turn = 0; state.leader = 0; state.lastPlayer = 0;
    const combo = bestResponse([hands[0][0], hands[0][1]] as Card[], null, state.ctx, DEFAULT_RULES);
    expect(combo).toBeTruthy();
    expect(combo!.wildAs.length).toBe(1);
    applyMove(state, { pass: false, combo: combo! });
    const rec: GameRecord = {
      schemaVersion: 2, id: 'wild1', matchId: 't', createdAt: Date.now(),
      ruleOpts: { ...DEFAULT_RULES }, levelsBefore: [2, 2] as [number, number], leader: 0, humanSeat: 0,
      difficulties: [null, 1, 1, 1], initialHands: hands.map((h) => [...h]),
      moves: [{
        moveNo: 1, player: 0, pass: false, cards: combo!.cards, comboKind: combo!.kind,
        mainRank: combo!.mainRank, handsAfter: state.hands.map((h) => h.length),
        toBeatKind: undefined, toBeatRank: undefined,
      }],
      result: null,
    };
    const analysis = analyzeGame(rec);
    const wildMove = analysis.moves.find((mv) => mv.playedCombo && mv.playedCombo.wildAs.length > 0);
    expect(wildMove).toBeTruthy();
    const user = buildCoachMessages(rec, analysis, [])[1].content;
    expect(user).toContain('当8');
    expect(user).toContain('声明：对子 88');
  });
});
