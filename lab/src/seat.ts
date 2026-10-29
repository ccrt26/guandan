/**
 * lab/src/seat.ts — 采样用神经席位：包装 @gd/ai 的 NeuralDecider，
 * 额外维护训练缓冲（feat 快照/动作分布/候选数）。
 */
import type { EngineEvent, GameState } from '@gd/engine';
import type { Move } from '@gd/ai';
import { KIND_DIM, NeuralDecider, kindIdx, type MLP, type EncoderOpts } from '@gd/ai';

export interface NeuralDecision {
  move: Move;
  feat: Float32Array;
  nCands: number;
  explored: boolean;
}

export class NeuralSeat {
  private decider: NeuralDecider;
  /** 本副的决策快照，由 sampler 在局末取走并清空 */
  pending: Float32Array[] = [];
  /** 动作分布统计（索引同 schema KINDS，末位=pass） */
  kindChosen = new Array(KIND_DIM + 1).fill(0);
  /** 候选数样本（供 p50/p95/p99） */
  candCounts: number[] = [];

  constructor(
    readonly seat: number,
    mlp: MLP,
    eps: number,
    rand: () => number,
    encoder: EncoderOpts = {},
  ) {
    this.decider = new NeuralDecider(seat, mlp, eps, rand, encoder);
  }

  observe(events: EngineEvent[]): void { this.decider.observe(events); }
  newGame(): void { this.decider.newGame(); }

  decide(state: GameState): NeuralDecision {
    const d = this.decider.decide(state, { collectFeat: true });
    const combo = d.move.pass ? null : d.move.combo;
    this.kindChosen[combo ? kindIdx(combo.kind) : KIND_DIM] += 1;
    this.candCounts.push(d.nCands);
    this.pending.push(d.feat!);
    return { move: d.move, feat: d.feat!, nCands: d.nCands, explored: d.explored };
  }
}
