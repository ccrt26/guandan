import {
  applyMove, bestResponse, type Combo, describeCombo, type GameRecord, RNG, teamOf,
} from '@gd/engine';
import { simulateToEnd, scoreCandidates, type Move } from '@gd/ai';
import type { MoveAnalysis } from './analyzer';
import { memoryBefore, stateBefore } from './replay';

export interface CounterfactualResult {
  moveNo: number;
  /** 实际打法的模拟胜率 */
  actualWinRate: number;
  /** 引擎建议打法的模拟胜率 */
  betterWinRate: number;
  sims: number;
  actualText: string;
  betterText: string;
  /** 建议打法胜率 - 实际打法胜率 */
  delta: number;
}

export interface CounterfactualOptions {
  /** 每个分支模拟局数（默认 40） */
  simsPerBranch?: number;
  /** 最多分析几个失误手（默认 4） */
  maxDecisions?: number;
  /** 进度回调（已完成决策数, 总数）；返回 true 表示中止 */
  onProgress?: (done: number, total: number) => boolean;
}

/**
 * 反事实复盘：对关键失误手，从该决策点用真实手牌平行重演 N 局——
 * "如果你当时打引擎建议的牌，本队胜率会差多少"。
 * 事件循环分片执行，避免阻塞 UI。
 */
export async function runCounterfactual(
  record: GameRecord,
  analyses: MoveAnalysis[],
  opts: CounterfactualOptions = {},
): Promise<CounterfactualResult[]> {
  const sims = opts.simsPerBranch ?? 40;
  const targets = analyses
    .filter((a) => a.grade === 'bad')
    .sort((a, b) => b.scoreGap - a.scoreGap)
    .slice(0, opts.maxDecisions ?? 4);
  const results: CounterfactualResult[] = [];
  const rng = new RNG((Date.now() ^ 0x5f3759df) >>> 0);

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const state = stateBefore(record, target.moveNo);
    const humanSeat = record.humanSeat ?? 0;
    const myTeam = teamOf(humanSeat);

    // 实际打法
    const actualMove = record.moves.find((m) => m.moveNo === target.moveNo);
    let actualCombo: Combo | null = null;
    if (actualMove && !actualMove.pass && actualMove.cards) {
      actualCombo = bestResponse(actualMove.cards, state.lastCombo, state.ctx, record.ruleOpts);
    }
    // 推荐打法：与实局相同的信息状态重新决策
    const scored = scoreCandidates({
      state,
      seat: humanSeat,
      caps: { memory: true, inference: false, cooperation: true, planning: true, noise: 0, rolloutIters: 0 },
      memory: memoryBefore(record, target.moveNo),
      rand: () => 0,
    });
    const bestMove = scored[0].move;

    const branchWins = async (move: Move): Promise<number> => {
      let wins = 0;
      for (let s = 0; s < sims; s++) {
        const sim = cloneForSim(state);
        applyMove(sim, move);
        const res = simulateToEnd(sim, rng);
        if (res.winnerTeam === myTeam) wins += 1;
        if (s % 8 === 7) await new Promise((r) => setTimeout(r, 0)); // 让出主线程
      }
      return wins;
    };

    const actualWins = await branchWins(
      actualCombo ? { pass: false, combo: actualCombo } : { pass: true },
    );
    const betterWins = await branchWins(bestMove);

    results.push({
      moveNo: target.moveNo,
      actualWinRate: actualWins / sims,
      betterWinRate: betterWins / sims,
      sims,
      actualText: actualCombo ? describeCombo(actualCombo) : '不要',
      betterText: bestMove.pass ? '不要' : bestMove.combo ? describeCombo(bestMove.combo) : '?',
      delta: (betterWins - actualWins) / sims,
    });

    if (opts.onProgress?.(i + 1, targets.length)) break;
  }
  return results;
}

function cloneForSim(state: ReturnType<typeof stateBefore>) {
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
  };
}
