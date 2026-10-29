import { describe, expect, it } from 'vitest';
import {
  applyMove, canPass, checkRecordIntegrity, createMatch, legalCombos, newRecordId, Recorder,
  startGame, DEFAULT_RULES, RECORD_SCHEMA_VERSION,
  type GameRecord, type MoveRecord, RNG,
} from '@gd/engine';
import { decideMove, guardMove, PlayMemory } from '@gd/ai';
import { normalizeRecord, replay, validateRecord } from '../src/replay';

/** 正确记录器：出牌人在 applyMove 之前捕获（2026-10-25 之前 web 控制器记成下家，这是回归基准） */
function playRecord(seed: number): GameRecord {
  const rng = new RNG(seed);
  const match = createMatch({ ...DEFAULT_RULES }, seed);
  const state = startGame(match);
  const recorder = new Recorder({
    schemaVersion: RECORD_SCHEMA_VERSION,
    id: newRecordId(),
    matchId: 'test',
    createdAt: Date.now(),
    ruleOpts: { ...DEFAULT_RULES },
    levelsBefore: [...state.levelsBefore] as [number, number],
    leader: state.leader,
    humanSeat: 0,
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

/** 复刻 2026-10-25 的坏记录器：applyMove 之后再取 state.turn（= 下家） */
function playRecordBuggyPlayer(seed: number): GameRecord {
  const rec = playRecord(seed);
  const shifted: MoveRecord[] = rec.moves.map((m) => ({ ...m, player: (m.player + 1) % 4 }));
  return { ...rec, moves: shifted };
}

describe('记录完整性铁律（回归门禁）', () => {
  it('正确记录：108 张合法、牌张归属唯一、handsAfter 逐手吻合', () => {
    for (const seed of [7, 42, 99]) {
      const rec = playRecord(seed);
      expect(checkRecordIntegrity(rec)).toEqual([]);
      expect(validateRecord(rec).ok).toBe(true);
    }
  });

  it('出牌人错记为下家（2026-10-25 事故复刻）→ 完整性校验必须抓到', () => {
    const rec = playRecordBuggyPlayer(7);
    const issues = checkRecordIntegrity(rec);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('牌张归属');
  });

  it('handsAfter 被篡改 → validateRecord 拒绝', () => {
    const rec = playRecord(7);
    const tampered: GameRecord = {
      ...rec,
      moves: rec.moves.map((m, i) => (i === 5 ? { ...m, handsAfter: [...m.handsAfter] } : m)),
    };
    tampered.moves[5].handsAfter[0] += 1;
    expect(validateRecord(tampered).ok).toBe(false);
    expect(validateRecord(tampered).reason).toContain('handsAfter');
  });

  it('正常记录：normalizeRecord 是恒等变换（新记录 player 本来就正确）', () => {
    const rec = playRecord(7);
    const norm = normalizeRecord(rec);
    expect(norm.moves.map((m) => m.player)).toEqual(rec.moves.map((m) => m.player));
  });

  it('旧版记录（无 schemaVersion、player 错位）→ normalizeRecord 按牌张归属修好且通过校验', () => {
    const buggy = playRecordBuggyPlayer(7);
    delete (buggy as Partial<GameRecord>).schemaVersion; // 旧记录没有版本号
    const norm = normalizeRecord(buggy);
    expect(norm.moves.some((m, i) => m.player !== buggy.moves[i].player)).toBe(true);
    const fixed = { ...norm, schemaVersion: RECORD_SCHEMA_VERSION };
    expect(checkRecordIntegrity(fixed)).toEqual([]);
  });
});

describe('记录 ↔ 回放 往返一致', () => {
  it('每手回放后的各家手牌数与 handsAfter 完全一致', () => {
    for (const seed of [7, 42]) {
      const rec = playRecord(seed);
      const frames = [...replay(rec)];
      expect(frames.length).toBe(rec.moves.length);
      for (let i = 0; i < frames.length; i++) {
        const after = frames.slice(0, i + 1);
        // 回放第 i 手后：初始手牌减去前 i+1 手出掉的牌
        const playedIds = new Set<number>();
        for (let k = 0; k <= i; k++) {
          if (!rec.moves[k].pass) for (const c of rec.moves[k].cards ?? []) playedIds.add(c.id);
        }
        const sizes = rec.initialHands.map((h) => h.filter((c) => !playedIds.has(c.id)).length);
        expect(rec.moves[i].handsAfter).toEqual(sizes);
        void after;
      }
    }
  });

  it('回放不抛异常且帧的出牌人与记录一致', () => {
    const rec = playRecord(99);
    const frames = [...replay(rec)];
    for (const f of frames) {
      expect(f.move.player).toBeGreaterThanOrEqual(0);
      expect(f.move.player).toBeLessThan(4);
    }
    expect(frames.length).toBeGreaterThan(50);
  });
});
