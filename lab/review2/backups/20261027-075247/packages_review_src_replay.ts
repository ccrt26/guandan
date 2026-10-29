import {
  applyMove, beats, bestResponse, checkRecordIntegrity, createMatch, makeLevelCtx, rankOrder, startGame, teammateOf, teamOf,
  type Combo, type GameState, type GameRecord, type MoveRecord, type EngineEvent,
} from '@gd/engine';
import { PlayMemory } from '@gd/ai';

/**
 * 确定性回放：从对局记录重建任意时刻的完整局面（含四家手牌）。
 * 记录里存的是"实际打出的牌"，跟牌时用 bestResponse 重建牌型解释。
 */
export interface ReplayFrame {
  move: MoveRecord;
  /** 该步之前的局面（含手牌、轮到谁、需要压什么） */
  state: GameState;
  /** 重建出的牌型（pass 为 null） */
  combo: Combo | null;
  events: ReturnType<typeof applyMove>;
}

export function buildInitialState(record: GameRecord): GameState {
  const match = createMatch({ ...record.ruleOpts }, 0);
  match.levels = [...record.levelsBefore] as [number, number];
  const state = startGame(match);
  state.hands = record.initialHands.map((h) => [...h]);
  state.levelsBefore = [...record.levelsBefore] as [number, number];
  // 单局记录不含上一局结果，stage 口径的台上方以记录的 stageTeam 为准
  state.stageTeam = record.stageTeam ?? 0;
  state.ctx = record.ruleOpts.levelMode === 'stage'
    ? makeLevelCtx(state.levelsBefore, 'stage', state.stageTeam)
    : makeLevelCtx(state.levelsBefore, record.ruleOpts.levelMode);
  state.turn = record.leader;
  state.leader = record.leader;
  state.lastPlayer = record.leader;
  state.lastCombo = null;
  state.finished = [];
  state.over = false;
  state.result = null;
  state.moveNo = 0;
  return state;
}

/** 旧版引擎下的对局（含现已删除的"钢板带两对"等牌型）重新判型会失败；
 * 此时信任记录里存的 comboKind/mainRank 直接构造回放用牌型，让旧对局仍可复盘。 */
export function resolveCombo(move: MoveRecord, state: GameState, record: GameRecord): Combo | null {
  if (move.pass || !move.cards?.length) return null;
  const combo = bestResponse(move.cards, state.lastCombo, state.ctx, record.ruleOpts);
  if (combo) return combo;
  if (!move.comboKind || move.mainRank == null) {
    throw new Error(`回放失败：第 ${move.moveNo} 手牌型无法解释`);
  }
  const size = move.cards.length;
  let length = 1;
  if (move.comboKind === 'straight') length = size;
  else if (move.comboKind === 'flush') length = record.ruleOpts.flushLen ?? 5;
  else if (move.comboKind === 'pair_seq') length = size / 2;
  else if (move.comboKind === 'trio_seq') length = size % 3 === 0 ? size / 3 : Math.round((size - 4) / 3);
  return {
    kind: move.comboKind,
    cards: move.cards,
    size,
    keyRank: rankOrder(move.mainRank, state.ctx),
    length,
    pairRanks: [],
    mainRank: move.mainRank,
    wildAs: [],
  };
}

/** 以记录为准应用一手。出牌人由"牌张 id 属于谁的手牌"决定——
 * 历史记录的 player 字段曾错记为下家，旧版轮次规则也会让状态机轮次漂移，
 * 只有牌张归属永远可信（id 全局唯一且与 handsAfter 全程吻合）。 */
function applyRecordedMove(state: GameState, move: MoveRecord, record: GameRecord): EngineEvent[] {
  const combo = resolveCombo(move, state, record);
  if (combo) {
    const ids = new Set(combo.cards.map((c) => c.id));
    const owner = state.hands.findIndex((h) => [...ids].every((id) => h.some((c) => c.id === id)));
    const player = owner >= 0 ? owner : move.player;
    if (state.lastCombo && !beats(combo, state.lastCombo)) {
      // 旧版引擎轮次规则差异：压不过却出了牌 → 当时必是新一轮领出，强制开轮
      state.trickPlays = [];
      state.leader = player;
      state.lastCombo = null;
      state.lastPlayer = player;
      state.passCount = 0;
    }
    state.turn = player;
    return applyMove(state, { pass: false, combo });
  }
  if (move.pass && !state.lastCombo) {
    // 旧记录的轮首 Pass：当前规则下不存在此局面，跳过（仅推进手数）
    state.moveNo += 1;
    return [];
  }
  return applyMove(state, { pass: true });
}

/** 修正历史记录的 player 字段（旧记录器把出牌人记成了下家）：
 * 出牌手取"牌张 id 属于谁的手牌"，Pass 手取状态机轮到的玩家。返回修正后的副本。 */
export function normalizeRecord(record: GameRecord): GameRecord {
  const state = buildInitialState(record);
  const moves = record.moves.map((move) => {
    let player = state.turn;
    if (!move.pass && move.cards?.length) {
      const ids = new Set(move.cards.map((c) => c.id));
      const owner = state.hands.findIndex((h) => [...ids].every((id) => h.some((c) => c.id === id)));
      if (owner >= 0) player = owner;
    }
    applyRecordedMove(state, move, record);
    return { ...move, player };
  });
  return { ...record, moves };
}

/** 逐步回放；state 为该步出手「之前」的局面（已克隆，可安全持有） */
export function* replay(record: GameRecord): Generator<ReplayFrame> {
  const state = buildInitialState(record);
  for (const move of record.moves) {
    if (state.over) break;
    const combo = resolveCombo(move, state, record);
    const before = lightCloneState(state);
    const events = applyRecordedMove(state, move, record);
    yield { move, state: before, combo, events };
  }
}

/** 浅克隆（手牌数组复制，Card 对象只读共享） */
export function lightCloneState(state: GameState): GameState {
  return {
    match: { ...state.match, levels: [...state.match.levels] as [number, number] },
    ctx: state.ctx,
    levelsBefore: [...state.levelsBefore] as [number, number],
    stageTeam: state.stageTeam,
    hands: state.hands.map((h) => [...h]),
    turn: state.turn,
    leader: state.leader,
    lastCombo: state.lastCombo,
    lastPlayer: state.lastPlayer,
    passCount: state.passCount,
    trickPlays: state.trickPlays.map((p) => ({ ...p })),
    finished: [...state.finished],
    over: state.over,
    result: state.result,
    moveNo: state.moveNo,
    tribute: state.tribute,
  };
}

/** 校验记录完整性（引擎铁律的单一实现，见 engine/record.ts checkRecordIntegrity）。
 * 数据损坏的记录绝不进分析——那会产出似是而非的错误建议（2026-10-25 曾出现凭空的 4A 炸弹）。 */
export function validateRecord(record: GameRecord): { ok: boolean; firstBadMove?: number; reason?: string } {
  const issues = checkRecordIntegrity(record);
  if (issues.length === 0) return { ok: true };
  const first = issues[0];
  return { ok: false, firstBadMove: first.moveNo, reason: first.message };
}

/** 重建到第 n 手之前（n 从 1 开始）：应用第 1..n-1 手 */
export function stateBefore(record: GameRecord, moveNo: number): GameState {
  const state = buildInitialState(record);
  for (const move of record.moves) {
    if (state.over || move.moveNo >= moveNo) break;
    applyRecordedMove(state, move, record);
  }
  return state;
}

/** 重建第 n 手之前的公共信息记牌器（推荐/反事实需与实局信息一致） */
export function memoryBefore(record: GameRecord, moveNo: number): PlayMemory {
  const state = buildInitialState(record);
  const memory = new PlayMemory(state.ctx);
  for (const move of record.moves) {
    if (state.over || move.moveNo >= moveNo) break;
    const toBeat = state.lastCombo;
    const events = applyRecordedMove(state, move, record);
    memory.syncState(state);
    for (const ev of events) {
      if (ev.type === 'play') memory.recordPlay(ev.player, ev.combo);
      else if (ev.type === 'pass') memory.recordPass(ev.player, toBeat);
    }
  }
  memory.syncState(state);
  return memory;
}

export { teammateOf, teamOf };
