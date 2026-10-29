import { describe, expect, it } from 'vitest';
import {
  applyMove, canPass, createMatch, DEFAULT_RULES, legalCombos, newRecordId, Recorder, startGame,
  type GameRecord, RNG,
} from '@gd/engine';
import { decideMove, PlayMemory } from '@gd/ai';
import { analyzeGame } from '../src/analyzer';
import { buildTeachPlan } from '../src/teach';
import { buildCoachMessages } from '../src/coach';

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

const SEATS = ['你（南）', '东家', '队友（北）', '西家'];

describe('R3 教学点（§5.1/5.2）', () => {
  it('2-3 个教学点，每点带可核实事实，无必赢/必错断言', () => {
    for (const seed of [66, 67]) {
      const rec = playRecord(seed);
      const analysis = analyzeGame(rec);
      const plan = buildTeachPlan(rec, analysis, SEATS);
      expect(plan.points.length).toBeGreaterThanOrEqual(Math.min(2, analysis.divergentMoves.length + 1));
      expect(plan.points.length).toBeLessThanOrEqual(3);
      for (const p of plan.points) {
        expect(p.contextText).toContain('张');
        expect(p.actual.remainingCards).toBeLessThan(27);
        expect(p.actual.remainingCards).toBeGreaterThanOrEqual(0);
        expect(p.claimLevelText.length).toBeGreaterThan(4);
        for (const a of [p.actual, ...p.alternatives]) {
          expect(a.remainingCards).toBeLessThan(27);
        }
      }
      const user = buildCoachMessages(rec, analysis, [])[1].content;
      expect(user).toContain('教学点');
      expect(user).toContain('可核实');
      expect(user).not.toContain('必胜');
      expect(user).not.toContain('一定赢');
      expect(user).not.toContain('你打错了');
    }
  });
});
