import {
  applyMove, type Combo, type EngineEvent, type GameState, legalCombos, type RuleOptions,
  RNG, teamOf,
} from '@gd/engine';
import { PlayMemory } from './memory';
import { isKeyDecision, pickMove, scoreCandidates } from './heuristic';
import { simulateToEnd } from './sim';
import { LEVEL_CAPS, type AIPlayer, type Difficulty, type Move } from './types';

/**
 * 启发式 AI 玩家。三档强度由能力矩阵决定：
 * - 初级：贪心 + 噪声，不记牌不配合
 * - 中级：记牌 + 规划 + 配合
 * - 高级：中级 + 行为推断 + 关键模糊决策蒙特卡洛 rollout
 */
export class HeuristicPlayer implements AIPlayer {
  readonly caps;
  private memory: PlayMemory | null = null;
  private rng: RNG;
  private rolloutUsed = 0;
  private rolloutBudget: number;

  constructor(
    readonly seat: number,
    readonly difficulty: Difficulty,
    seed = (Math.random() * 0xffffffff) >>> 0,
  ) {
    this.caps = LEVEL_CAPS[difficulty];
    this.rng = new RNG(seed);
    this.rolloutBudget = difficulty === 2 ? 8 : 0;
  }

  reset(state: GameState, _rules: RuleOptions): void {
    this.memory = this.caps.memory ? PlayMemory.fromStart(state.ctx) : null;
    this.rolloutUsed = 0;
  }

  observe(events: EngineEvent[], toBeat: Combo | null): void {
    if (!this.memory) return;
    this.memory.observeEvents(events, toBeat);
  }

  decide(state: GameState): Move {
    if (this.memory) this.memory.syncState(state);
    const rand = this.rng.next.bind(this.rng);
    const scored = scoreCandidates({
      state,
      seat: this.seat,
      caps: this.caps,
      memory: this.memory,
      rand,
    });
    const base: Move = pickMove(scored, this.caps.noise, rand);

    // 高级档：仅在「关键且模糊」的决策上用 rollout 校准
    // （启发式分差大说明局势清晰，模拟反而引入噪声；rolloutIters=0 时完全关闭）
    if (
      this.difficulty === 2 &&
      this.caps.rolloutIters > 0 &&
      this.rolloutUsed < this.rolloutBudget &&
      this.memory &&
      !base.pass
    ) {
      const legal = legalCombos(state);
      const gap = scored.length > 1 ? scored[0].score - scored[1].score : Infinity;
      if (legal.length > 1 && gap < 10 && isKeyDecision(state, this.seat, legal)) {
        this.rolloutUsed += 1;
        const branches: Move[] = [scored[0].move, scored[1].move];
        if (state.lastCombo && !scored.some((s) => s.move.pass)) branches.push({ pass: true });
        return this.rolloutChoose(state, branches, base);
      }
    }
    return base;
  }

  /**
   * 对少数分支各模拟 N 局（暗牌蒙特卡洛采样，不偷看），先验平滑后选优。
   */
  private rolloutChoose(state: GameState, branches: Move[], base: Move): Move {
    interface Branch {
      move: Move;
      wins: number;
      sims: number;
      prior: number;
    }
    const bs: Branch[] = branches.map((move, i) => ({
      move,
      wins: 0,
      sims: 0,
      prior: i === 0 ? 0.55 : move.pass ? 0.45 : 0.5,
    }));
    const iters = 14;
    for (const branch of bs) {
      for (let i = 0; i < iters; i++) {
        const simState = sampleStateForRollout(state, this.seat, this.memory!, this.rng);
        applyMove(simState, branch.move);
        const res = simulateToEnd(simState, this.rng);
        if (res.winnerTeam === teamOf(this.seat)) branch.wins += 1;
        branch.sims += 1;
      }
    }
    let best = bs[0];
    let bestVal = -Infinity;
    for (const branch of bs) {
      const val = (branch.wins + 5 * branch.prior) / (branch.sims + 5);
      const isBase = !branch.move.pass && !base.pass && branch.move.combo === base.combo;
      const adj = val + (isBase ? 0.01 : 0); // 轻微偏向启发式首选
      if (adj > bestVal) {
        bestVal = adj;
        best = branch;
      }
    }
    return best.move;
  }
}

/** 采样暗牌构造一个"平行世界"状态（作弊防护：只见公共信息） */
function sampleStateForRollout(
  state: GameState,
  seat: number,
  memory: PlayMemory,
  rng: RNG,
): GameState {
  const hands = memory.sampleHiddenHands(seat, state.hands[seat], rng);
  return {
    match: { ...state.match, levels: [...state.match.levels] as [number, number] },
    ctx: state.ctx,
    levelsBefore: [...state.levelsBefore] as [number, number],
    stageTeam: state.stageTeam,
    hands,
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

export function createAI(seat: number, difficulty: Difficulty, seed?: number): HeuristicPlayer {
  return new HeuristicPlayer(seat, difficulty, seed);
}
