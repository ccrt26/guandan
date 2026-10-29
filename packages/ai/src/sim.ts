import {
  applyMove, type Card, type Combo, type EngineEvent, type GameResult, type GameState,
  legalCombos, RNG,
} from '@gd/engine';
import { PlayMemory } from './memory';
import { decideMove } from './heuristic';
import { LEVEL_CAPS, type Difficulty, type Move } from './types';

/**
 * 轻量克隆：手牌数组复制（Card 对象只读共享），match 单独浅拷贝，
 * 因为结算会写 match.levels。rollout/反事实每局调用数百次，structuredClone 太慢。
 */
export function lightClone(state: GameState): GameState {
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
    trickPlays: [],
    finished: [...state.finished],
    over: state.over,
    result: state.result,
    moveNo: state.moveNo,
    tribute: state.tribute,
    pendingReturns: [],
  };
}

/** 模拟用中等强度（无 rollout、无推断，保证速度） */
export const SIM_CAPS = {
  ...LEVEL_CAPS[1],
  noise: 0,
  inference: false,
};

export interface SimResult {
  finishOrder: number[];
  winnerTeam: 0 | 1;
  moves: number;
}

/**
 * 从 state 快速自对弈到一局结束。
 * aiSeats: 每个座位使用的难度（模拟中通常全 1=中级）。
 */
export function simulateToEnd(
  original: GameState,
  rng: RNG,
  opts?: { caps?: typeof SIM_CAPS; maxMoves?: number },
): SimResult {
  const state = lightClone(original);
  const caps = opts?.caps ?? SIM_CAPS;
  const maxMoves = opts?.maxMoves ?? 1200;
  const memory = new PlayMemory(state.ctx);
  let moves = 0;

  while (!state.over && moves < maxMoves) {
    const combos = legalCombos(state);
    let move: Move;
    if (combos.length === 0) {
      move = { pass: true };
    } else {
      const picked = decideMove({
        state,
        seat: state.turn,
        caps,
        memory,
        rand: rng.next.bind(rng),
      });
      // 防御：决策返回的 combo 必须仍合法（同引用来自 legalCombos）
      if (!picked.pass) {
        const ok = combos.some((c) => c === picked.combo || comboEq(c, picked.combo));
        if (!ok) move = { pass: true };
        else move = picked;
      } else {
        move = state.lastCombo ? picked : { pass: false, combo: combos[0] };
      }
    }
    const beforeBeat: Combo | null = state.lastCombo;
    const events: EngineEvent[] = applyMove(state, move);
    moves += 1;
    for (const ev of events) {
      if (ev.type === 'play') memory.recordPlay(ev.player, ev.combo);
      else if (ev.type === 'pass') memory.recordPass(ev.player, beforeBeat);
      else if (ev.type === 'finish') memory.finished.push(ev.player);
    }
  }

  const result: GameResult | null = state.result;
  if (!result) {
    // 超步数兜底：以当前手数少者排名
    const order = [0, 1, 2, 3].sort((a, b) => state.hands[a].length - state.hands[b].length);
    return {
      finishOrder: order,
      winnerTeam: (order[0] % 2 === 0 ? 0 : 1) as 0 | 1,
      moves,
    };
  }
  return { finishOrder: result.finishOrder, winnerTeam: result.winnerTeam, moves };
}

function comboEq(a: Combo, b: Combo): boolean {
  if (a.kind !== b.kind || a.size !== b.size || a.keyRank !== b.keyRank) return false;
  const ids = new Set(a.cards.map((c) => c.id));
  return b.cards.every((c) => ids.has(c.id));
}

/** 生成一个随机完整对局（自对弈验收 / 性能测试用） */
export function playFullGame(
  startState: GameState,
  seatDiffs: [Difficulty, Difficulty, Difficulty, Difficulty],
  rng: RNG,
): { state: GameState; moves: number } {
  // 完整对局由调用方用 HeuristicPlayer 驱动；这里仅用于快速混战
  const state = lightClone(startState);
  const memories = [0, 1, 2, 3].map(() => new PlayMemory(state.ctx));
  let moves = 0;
  while (!state.over && moves < 1500) {
    const seat = state.turn;
    const combos = legalCombos(state);
    let move: Move;
    if (combos.length === 0) move = { pass: true };
    else {
      move = decideMove({
        state,
        seat,
        caps: LEVEL_CAPS[seatDiffs[seat]],
        memory: memories[seat],
        rand: rng.next.bind(rng),
      });
      if (move.pass && !state.lastCombo) move = { pass: false, combo: combos[0] };
    }
    const beforeBeat = state.lastCombo;
    for (const ev of applyMove(state, move)) {
      if (ev.type === 'play') memories[ev.player].recordPlay(ev.player, ev.combo);
      else if (ev.type === 'pass') memories[ev.player].recordPass(ev.player, beforeBeat);
    }
    moves += 1;
  }
  return { state, moves };
}

export type { Card };
