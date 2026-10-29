import {
  applyMove, bestResponse, teamOf, type Combo, describeCombo, type GameRecord, RNG,
} from '@gd/engine';
import { simulateToEnd, scoreCandidates, type Move } from '@gd/ai';
import type { MoveAnalysis } from './analyzer';
import { memoryBefore, stateBefore } from './replay';

/** R1-D（REVIEW2-EXEC §4.1）：noise=0 续打对相同局面给出相同动作——
 * "多次模拟"只是同一条对局线重放，胜率只能 0%/100%。
 * 因此每个根动作只做一次确定性推演，呈现为"事后情景演示"，不再给百分比。 */
export interface CounterfactualResult {
  moveNo: number;
  /** 实际打法描述 */
  actualText: string;
  /** 替代打法描述（由下方 sourceId 策略提出） */
  alternativeText: string;
  /** 实际打法分支的本副结果（事后情景，非胜率） */
  actualOutcome: string;
  /** 替代打法分支的本副结果 */
  alternativeOutcome: string;
  /** 提出替代动作的策略（事实来源标注，禁止写成模型名） */
  sourceId: string;
  /** 续打策略（四席） */
  continuationPolicyId: string;
  /** 分支是否在步数上限内未打完（此时结果为折算排名，如实标注） */
  truncated: boolean;
}

export interface CounterfactualOptions {
  /** 最多分析几个分歧较大的决策（默认 4） */
  maxDecisions?: number;
  /** 进度回调（已完成决策数, 总数）；返回 true 表示中止 */
  onProgress?: (done: number, total: number) => boolean;
}

const HEURISTIC_MID = 'heuristic:mid(分析口径)';

/** 本副结果的中文描述（我方视角；finishOrder 为完赛座位顺序） */
function outcomeText(finishOrder: number[], winnerTeam: 0 | 1, myTeam: 0 | 1): string {
  const rankName = (n: number) => ['头游', '二游', '三游', '末游'][n - 1];
  const ours = finishOrder.map((p, i) => (teamOf(p) === myTeam ? i + 1 : 0)).filter((n) => n > 0);
  const theirs = finishOrder.map((p, i) => (teamOf(p) !== myTeam ? i + 1 : 0)).filter((n) => n > 0);
  const win = winnerTeam === myTeam ? '本副我方获胜' : '本副对方获胜';
  return `${win}（我方 ${ours.map(rankName).join('+')}，对方 ${theirs.map(rankName).join('+')}）`;
}

/**
 * 事后情景演示：对启发式分歧较大的手，从该决策点用真实手牌各推演一次
 * "实际打法"与"替代打法"（替代=启发式 top-1，来源见 sourceId）。
 * 单次确定性续打（noise=0 无有效随机入口），结果不是当时信息下的胜率。
 */
export async function runCounterfactual(
  record: GameRecord,
  analyses: MoveAnalysis[],
  opts: CounterfactualOptions = {},
): Promise<CounterfactualResult[]> {
  const targets = analyses
    .filter((a) => a.grade === 'divergent')
    .sort((a, b) => b.scoreGap - a.scoreGap)
    .slice(0, opts.maxDecisions ?? 4);
  const results: CounterfactualResult[] = [];
  const rng = new RNG(0xd5c9a7); // 固定值：noise=0 下无有效随机入口；固定以便复现（B11 一并处置）

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const state = stateBefore(record, target.moveNo);
    const humanSeat = record.humanSeat ?? 0;
    const myTeam = teamOf(humanSeat);

    const actualMove = record.moves.find((m) => m.moveNo === target.moveNo);
    let actualCombo: Combo | null = null;
    if (actualMove && !actualMove.pass && actualMove.cards) {
      actualCombo = bestResponse(actualMove.cards, state.lastCombo, state.ctx, record.ruleOpts);
    }
    const scored = scoreCandidates({
      state,
      seat: humanSeat,
      caps: { memory: true, inference: false, cooperation: true, planning: true, noise: 0, rolloutIters: 0 },
      memory: memoryBefore(record, target.moveNo),
      rand: () => 0,
    });
    const bestMove = scored[0].move;

    const runOnce = (move: Move) => {
      const sim = cloneForSim(state);
      applyMove(sim, move);
      return simulateToEnd(sim, rng);
    };

    const actualRes = runOnce(actualCombo ? { pass: false, combo: actualCombo } : { pass: true });
    const altRes = runOnce(bestMove);

    const truncated = actualRes.moves >= 1200 || altRes.moves >= 1200;
    results.push({
      moveNo: target.moveNo,
      actualText: actualCombo ? describeCombo(actualCombo) : '不要',
      alternativeText: bestMove.pass ? '不要' : bestMove.combo ? describeCombo(bestMove.combo) : '?',
      actualOutcome: outcomeText(actualRes.finishOrder, actualRes.winnerTeam, myTeam),
      alternativeOutcome: outcomeText(altRes.finishOrder, altRes.winnerTeam, myTeam),
      sourceId: HEURISTIC_MID,
      continuationPolicyId: HEURISTIC_MID,
      truncated,
    });

    await new Promise((r) => setTimeout(r, 0)); // 让出主线程
    if (opts.onProgress?.(i + 1, targets.length)) break;
  }
  return results;
}

/** 忠实克隆（F12）：trickPlays 一并复制（原实现清空——查实只影响展示不影响轮次语义，仍按忠实性修正） */
export function cloneForSim(state: ReturnType<typeof stateBefore>) {
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
    pendingReturns: [...(state.pendingReturns ?? [])],
  };
}
