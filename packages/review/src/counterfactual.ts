import {
  applyMove, legalCombos, teamOf, type Combo, describeCombo, type GameRecord, type GameState, RNG,
} from '@gd/engine';
import { isMoveLegal, simulateToEnd, type Move } from '@gd/ai';
import {scoreReviewCandidates as scoreCandidates,REVIEW_HEURISTIC_ID} from './reviewHeuristic';
import type { MoveAnalysis } from './analyzer';
import { memoryBefore, stateBefore, resolveDeclaredFirst } from './replay';
import { canonicalize } from './actionIdentity';

/** R1-D（REVIEW2-EXEC §4.1）：noise=0 续打对相同局面给出相同动作——
 * "多次模拟"只是同一条对局线重放，胜率只能 0%/100%。
 * 因此每个根动作只做一次确定性推演，呈现为"事后情景演示"，不再给百分比。 */
export interface CounterfactualResult {
  moveNo: number;
  /** R3：统一动作身份（actionIdentity），供 DecisionReview/校验层引用 */
  actualActionId: string;
  alternativeActionId: string;
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
  /** 本副名次分 g（我方视角 ±1/2/3；供与信息集均值做方向比较） */
  gActual?: number;
  gAlternative?: number;
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
    if(!actualMove||actualMove.player!==humanSeat||state.turn!==humanSeat)throw new Error('counterfactual actor/viewer seat mismatch');
    if(!actualMove.pass&&!actualMove.cards?.length)throw new Error('actual declaration missing cards; counterfactual refused');
    let actualCombo: Combo | null = null;
    if (actualMove && !actualMove.pass && actualMove.cards) {
      const resolved=resolveDeclaredFirst(actualMove,state,record);
      if(!actualMove.comboKind||actualMove.mainRank==null||resolved.source!=='declaration'||!resolved.combo)throw new Error('actual declaration unverifiable; counterfactual refused');
      actualCombo=resolved.combo;
    }
    if(!isMoveLegal(state,actualMove.pass?{pass:true}:{pass:false,combo:actualCombo!}))throw new Error('actual declaration illegal; counterfactual refused');
    if(canonicalize(humanSeat,target.pass,target.playedCombo).actionId!==canonicalize(humanSeat,actualMove.pass,actualCombo).actionId)throw new Error('actual declaration differs from analysis; counterfactual refused');
    const scored = scoreCandidates({
      state,
      seat: humanSeat,
      caps: { memory: true, inference: false, cooperation: true, planning: true, noise: 0, rolloutIters: 0 },
      memory: memoryBefore(record, target.moveNo),
      rand: () => 0,
    });
    const bestMove = scored[0].move;

    const gOf = (finishOrder: number[], winnerTeam: 0 | 1): number => {
      const doubleUp = teamOf(finishOrder[0]) === teamOf(finishOrder[1]);
      const thirdIsWinnerTeam = teamOf(finishOrder[2]) === winnerTeam;
      const up = doubleUp ? 3 : thirdIsWinnerTeam ? 2 : 1;
      return winnerTeam === myTeam ? up : -up;
    };
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
      actualActionId: canonicalize(humanSeat, !actualCombo, actualCombo).actionId,
      alternativeActionId: canonicalize(humanSeat, bestMove.pass, bestMove.pass ? null : bestMove.combo).actionId,
      actualText: actualCombo ? describeCombo(actualCombo) : '不要',
      alternativeText: bestMove.pass ? '不要' : bestMove.combo ? describeCombo(bestMove.combo) : '?',
      actualOutcome: outcomeText(actualRes.finishOrder, actualRes.winnerTeam, myTeam),
      alternativeOutcome: outcomeText(altRes.finishOrder, altRes.winnerTeam, myTeam),
      gActual: gOf(actualRes.finishOrder, actualRes.winnerTeam),
      gAlternative: gOf(altRes.finishOrder, altRes.winnerTeam),
      sourceId: REVIEW_HEURISTIC_ID,
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

/**
 * D4（REVIEW4-EXEC §5.4）：注入式续打推演。每个模拟（世界×根分支）由 makePlayers
 * 新建四席玩家——世界/分支间状态严格隔离；玩家自行维护公开记忆（observe 事件流），
 * 只读该模拟世界的合法可见信息。非法返回按规则兜底并计数（不静默改写）。
 */
export interface ContinuationPlayer {
  decide: (state: GameState) => { pass: boolean; combo?: Combo | null };
  observe: (events: import('@gd/engine').EngineEvent[], toBeat: Combo | null) => void;
}
export interface ContinuationSpec {
  policyId: string;
  makePlayers: () => ContinuationPlayer[];
}

export function simulateWithPolicy(
  original: Parameters<typeof cloneForSim>[0],
  spec: ContinuationSpec,
  opts: { maxMoves?: number; rng: RNG } = { rng: new RNG(0) },
): { finishOrder: number[]; winnerTeam: 0 | 1; moves: number; illegalFallbacks: number } {
  const state = cloneForSim(original) as GameState;
  const maxMoves = opts.maxMoves ?? 1200;
  const players = spec.makePlayers();
  let moves = 0;
  let illegalFallbacks = 0;
  while (!state.over && moves < maxMoves) {
    const raw = players[state.turn].decide(state);
    let move: { pass: boolean; combo?: Combo | null } = raw;
    if (!raw.pass && raw.combo && !isMoveLegal(state, raw as never)) {
      illegalFallbacks += 1;
      move = { pass: true };
    }
    if (raw.pass && !state.lastCombo && legalCombos(state).length > 0) {
      illegalFallbacks += 1;
      move = { pass: false, combo: legalCombos(state)[0] };
    }
    const toBeat = state.lastCombo;
    const events = applyMove(state, move as never);
    players.forEach((p) => p.observe(events, toBeat));
    moves += 1;
  }
  let order: number[];
  if (state.finished.length >= 3) {
    order = [...state.finished];
    for (let p = 0; p < 4; p++) if (!order.includes(p)) order.push(p);
  } else {
    order = [...state.finished, ...[0, 1, 2, 3].filter((p) => !state.finished.includes(p))
      .sort((a, b) => state.hands[a].length - state.hands[b].length)];
  }
  return {
    finishOrder: order.slice(0, 4),
    winnerTeam: (order[0] % 2 === 0 ? 0 : 1) as 0 | 1,
    moves, illegalFallbacks,
  };
}
