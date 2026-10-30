/**
 * lab/src/sampler.ts — 对局采样与评测跑者。
 * 训练局：4 席全为当前模型（ε-greedy），整场（match）为单位完成标签 y = g + W：
 *   g = 本副本队名次分（赢方 +upgrade，输方 −upgrade，恰与引擎升级数一致）
 *   W = 整场最终胜负 ±1（仅完整对局结束才赋值；超时/超长场丢弃并计数）
 * 评测局：模型队（贪心） vs 启发式档（固定种子、换边配对）。
 */
import {
  applyMove, createMatch, DEFAULT_RULES, startGame, teamOf,
  type Combo, type GameState, RNG,
} from '@gd/engine';
import { createAI, guardMove, type Difficulty } from '@gd/ai';
import { NeuralSeat } from './seat';
import { mulberry32, type MLP } from './mlp';

export const MATCH_GAME_CAP = 60; // 场内副数安全上限（超限弃场并计数）

export interface TrainMatchResult {
  samples: Array<{ feat: Float32Array; y: number; g: number; w: number }> | null;
  games: number;
  decisions: number;
  capped: boolean;
  kindChosen: number[];
  candCounts: number[];
}

/** 跑一个完整升级对局（到过A），4 席当前模型。返回带标签样本（若整场完成）。 */
export function runTrainingMatch(mlp: MLP, eps: number, seed: number): TrainMatchResult {
  const rng = new RNG(seed);
  const match = createMatch({ ...DEFAULT_RULES }, rng.next() * 0xffffffff);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const seats = [0, 1, 2, 3].map((s) => new NeuralSeat(s, mlp, eps, rand));
  const pending: Array<{ feat: Float32Array; seat: number; g: number }> = [];
  const kindChosen = new Array(seats[0].kindChosen.length).fill(0);
  const candCounts: number[] = [];
  let decisions = 0;
  let games = 0;
  let capped = false;

  while (match.winner == null && games < MATCH_GAME_CAP) {
    const state = startGame(match);
    seats.forEach((s) => s.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2000) {
      const seat = seats[state.turn];
      const toBeat = state.lastCombo;
      const d = seat.decide(state);
      decisions += 1;
      // 值校验防御（2026-10-26 修复：旧引用比较对非pass出牌 100% 误判）
      const move = guardMove(state, d.move);
      const events = applyMove(state, move);
      seats.forEach((s) => s.observe(events));
      void toBeat;
    }
    games += 1;
    const result = state.result;
    if (!result) break; // guard 触发：异常场
    const up = result.upgrade;
    for (const s of seats) {
      const g = teamOf(s.seat) === result.winnerTeam ? up : -up;
      for (const feat of s.pending) pending.push({ feat, seat: s.seat, g });
      s.pending = [];
      s.kindChosen.forEach((v, i) => (kindChosen[i] += v));
      kindChosen.length = s.kindChosen.length;
      s.kindChosen.fill(0);
      candCounts.push(...s.candCounts);
      s.candCounts = [];
    }
  }
  if (match.winner == null) capped = games >= MATCH_GAME_CAP;

  if (match.winner == null || pending.length === 0) {
    return { samples: null, games, decisions, capped, kindChosen, candCounts };
  }
  const samples = pending.map((p) => {
    const w = teamOf(p.seat) === match.winner ? 1 : -1;
    return { feat: p.feat, y: p.g + w, g: p.g, w };
  });
  return { samples, games, decisions, capped, kindChosen, candCounts };
}

export interface EvalResult {
  games: number;
  modelWins: number;
  modelGSum: number;
  perGame: Array<{ seed: number; modelTeam: 0 | 1; win: boolean; g: number; moves: number }>;
}

/** 单副评测：模型 2 席（贪心） vs 启发式 2 席，固定种子逐副、换边（同种子打两种阵营）。 */
export function evalModelVsHeuristic(
  mlp: MLP, diff: Difficulty, seeds: number[], swapSides: boolean,
): EvalResult {
  const perGame: EvalResult['perGame'] = [];
  for (const seed of seeds) {
    for (const side of swapSides ? [0, 1] : [0]) {
      const rng = new RNG(seed * 2 + side);
      const match = createMatch({ ...DEFAULT_RULES }, rng.next() * 0xffffffff);
      const state = startGame(match);
      const rand = mulberry32(seed ^ (side * 7919));
      const neural = [0, 1, 2, 3].map((s) => new NeuralSeat(s, mlp, 0, rand));
      const heur = [0, 1, 2, 3].map((s) => createAI(s, diff, rng.next() * 0xffffffff));
      heur.forEach((p) => p.reset(state, match.opts));
      let moves = 0;
      let guard = 0;
      while (!state.over && guard++ < 2000) {
        const turn = state.turn;
        const modelSeat = (turn & 1) === side; // side=0: 模型坐 0/2（队0）；side=1: 模型坐 1/3（队1）
        let move: { pass: boolean; combo?: Combo };
        if (modelSeat) move = neural[turn].decide(state).move;
        else move = heur[turn].decide(state);
        const move2 = guardMove(state, move as never);
        const toBeat = state.lastCombo;
        const events = applyMove(state, move2 as never);
        moves += 1;
        neural.forEach((s) => s.observe(events));
        heur.forEach((p) => p.observe(events, toBeat));
      }
      const result = state.result;
      if (result) {
        const modelTeam = side as 0 | 1;
        const win = result.winnerTeam === modelTeam;
        const g = win ? result.upgrade : -result.upgrade;
        perGame.push({ seed, modelTeam, win, g, moves });
      } else perGame.push({ seed, modelTeam: side as 0 | 1, win: false, g: 0, moves });
    }
  }
  return {
    games: perGame.length,
    modelWins: perGame.filter((p) => p.win).length,
    modelGSum: perGame.reduce((s, p) => s + p.g, 0),
    perGame,
  };
}

/** 百分位（线性插值简化版） */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}
