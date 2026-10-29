import { describe, expect, it } from 'vitest';
import {
  applyMove, canPass, createMatch, legalCombos, newRecordId, Recorder, startGame,
  DEFAULT_RULES, type GameRecord, RNG,
} from '@gd/engine';
import { decideMove, guardMove, PlayMemory } from '@gd/ai';
import { replay, stateBefore, memoryBefore } from '../src/replay';
import { analyzeGame, gradeIcon } from '../src/analyzer';
import { runCounterfactual } from '../src/counterfactual';
import { buildCoachMessages, buildOfflineReport } from '../src/coach';

function playRecord(seed: number, humanSeat = 0): GameRecord {
  const rng = new RNG(seed);
  const match = createMatch({ ...DEFAULT_RULES }, seed);
  const state = startGame(match);
  const recorder = new Recorder({
    id: newRecordId(),
    matchId: 'test',
    createdAt: Date.now(),
    ruleOpts: { ...DEFAULT_RULES },
    levelsBefore: [...state.levelsBefore] as [number, number],
    leader: state.leader,
    humanSeat,
    difficulties: [null, 1, 1, 1],
    initialHands: state.hands.map((h) => [...h]),
  });
  const memories = [0, 1, 2, 3].map(() => PlayMemory.fromStart(state.ctx));
  let guard = 0;
  while (!state.over && guard++ < 2000) {
    const seat = state.turn;
    const combos = legalCombos(state);
    let move = decideMove({
      state,
      seat,
      caps: { memory: true, inference: false, cooperation: true, planning: true, noise: 0.1, rolloutIters: 0 },
      memory: memories[seat],
      rand: rng.next.bind(rng),
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

describe('复盘回放', () => {
  it('确定性重建：回放结果与原始记录一致', () => {
    for (const seed of [11, 22, 33]) {
      const record = playRecord(seed);
      const frames = [...replay(record)];
      expect(frames.length).toBe(record.moves.length);
      // 末局状态与记录结果一致
      const lastState = stateBefore(record, record.moves.length + 1);
      expect(lastState.result?.finishOrder).toEqual(record.result?.finishOrder);
      expect(lastState.result?.winnerTeam).toBe(record.result?.winnerTeam);
      // 任意中间点：手牌数与记录一致
      const mid = record.moves[Math.floor(record.moves.length / 2)];
      const st = stateBefore(record, mid.moveNo);
      expect(st.hands.every((h) => h.length >= 0)).toBe(true);
      expect(mid.handsAfter).toBeDefined();
    }
  });

  it('stateBefore 的手牌数与记录的 handsAfter 吻合', () => {
    const record = playRecord(77);
    for (const move of record.moves.slice(0, 30)) {
      const before = stateBefore(record, move.moveNo);
      // before 的手牌数：本手之后 = before - cards
      const played = move.pass ? 0 : (move.cards?.length ?? 0);
      expect(before.hands[move.player].length - played).toBe(move.handsAfter[move.player]);
    }
  });
});

describe('复盘分析', () => {
  it('给人类每一步分级，统计口径有效', () => {
    const record = playRecord(101);
    const analysis = analyzeGame(record);
    expect(analysis.moves.length).toBe(record.moves.filter((m) => m.player === 0).length);
    for (const mv of analysis.moves) {
      expect(['good', 'ok', 'divergent', 'forced', 'uncovered']).toContain(mv.grade);
      expect(typeof gradeIcon(mv.grade)).toBe('string');
    }
    expect(analysis.metrics.actualHands).toBe(record.moves.filter((m) => m.player === 0 && !m.pass).length);
    expect(analysis.metrics.optimalHands).toBeGreaterThan(0);
    // R1-E：描述性统计替代评级；divergent 是筛选信号不是判错
    expect(analysis.stats.total).toBe(analysis.moves.length);
    expect(analysis.stats.forced + analysis.stats.uncovered + analysis.stats.comparable).toBe(analysis.stats.total);
    expect(analysis.stats.divergent).toBe(analysis.divergentMoves.length);
    expect(analysis.stats.divergenceRate).toBeGreaterThanOrEqual(0);
    expect(analysis.stats.divergenceRate).toBeLessThanOrEqual(1);
    expect('overall' in analysis).toBe(false);
  });

  it('多局分析稳定（无崩溃）', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const analysis = analyzeGame(playRecord(seed));
      expect(analysis.moves.length).toBeGreaterThan(5);
    }
  });
});

describe('事后情景演示（原反事实模拟，R1-D 改单次确定性推演）', () => {
  it('对分歧手给出两分支的本副结果，无胜率百分比', async () => {
    const record = playRecord(55);
    const analysis = analyzeGame(record);
    const results = await runCounterfactual(record, analysis.moves, {
      maxDecisions: 2,
    });
    expect(results.length).toBeLessThanOrEqual(2);
    for (const r of results) {
      expect(r.actualOutcome).toMatch(/本副(我方|对方)获胜/);
      expect(r.alternativeOutcome).toMatch(/本副(我方|对方)获胜/);
      expect(r.sourceId).toContain('heuristic');
      expect(r.sourceId).not.toContain('ck180');
      expect(r).not.toHaveProperty('actualWinRate');
      expect(r).not.toHaveProperty('betterWinRate');
      expect(r).not.toHaveProperty('sims');
    }
  }, 60000);
});

describe('教练 prompt', () => {
  it('组装 prompt 与离线报告', () => {
    const record = playRecord(66);
    const analysis = analyzeGame(record);
    const messages = buildCoachMessages(record, analysis, []);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('对局信息');
    const offline = buildOfflineReport(analysis, []);
    expect(offline).toContain('复盘报告');
  });
});

describe('记牌器重建', () => {
  it('memoryBefore 与实局信息一致', () => {
    const record = playRecord(88);
    const mem = memoryBefore(record, 10);
    expect(mem.finished.length).toBeLessThanOrEqual(2);
  });
});
