/**
 * packages/ai/src/nn/nnplayer.ts — 神经陪练玩家（实验入口，不替换正式三档）。
 * 实现 AIPlayer 接口：与 HeuristicPlayer 同插槽；CLEAN1 干净重训后部署 ck180 权重
 * （2026-10-26，lab/clean1/clean1-2026102609500：留出 256 场对初级 100% [88,100]、
 * 对中级 98.4% [96.9,99.6]），贪心（ε=0）、确定性；观察历史随对局事件维护。
 */
import type { Combo, EngineEvent, GameState, RuleOptions } from '@gd/engine';
import type { AIPlayer, Difficulty, Move } from '../types';
import { guardMove } from '../legal';
import { MLP } from './mlp';
import { NeuralDecider } from './neuralSeat';
import { decideTiered, NEURAL_TIERS, type NeuralTier } from './tiered';
import type { EncoderOpts } from './neuralSeat';
import type { PassEncoding } from './schema';

export const NEURAL_MODEL_VERSION = 'clean2-ck7051-20261027'; // 随权重部署记录，复盘/记录保存用

/** 完整政策包身份（REVIEW5 T0.1）：旧完整包必须整体绑定，不能只冻结权重名。
 *  REVIEW4 审计发现：NeuralPlayer 未传 candidateCompat → 默认 cand-suit-v3 候选
 *  配旧 v2 训练权重——若网页用该源码重建即发生"旧 modelVersion + 新候选"混搭。
 *  修复：产品默认 = frozenChampion 全包身份（v2 候选 + legacy pass 编码），显式固定。 */
export interface NeuralPolicyIdentity {
  policyId: string;
  modelVersion: string;      // 权重训练身份
  encoderVersion: string;    // 编码器版本（含 pass 编码语义）
  candidateVersion: string;  // 候选生成器版本
  passEncoding: PassEncoding;
  candidateCompat: 'v2' | undefined;
}

export const FROZEN_CHAMPION_IDENTITY: NeuralPolicyIdentity = {
  policyId: 'frozenChampion-clean2-ck7051-encv1-candv2',
  modelVersion: 'clean2-ck7051-20261027',
  encoderVersion: 'gd-lab-schema-v1',
  candidateVersion: 'cand-dedup-v2',
  passEncoding: 'legacy-phys10',
  candidateCompat: 'v2',
};

export class NeuralPlayer implements AIPlayer {
  readonly difficulty = 2 as Difficulty; // 仅占位（接口要求）；正式档位语义见 tier
  private decider: NeuralDecider;
  private mlp: MLP;
  /** 档位 ε（D1 近并列随机）；0=贪心。rand 默认确定性占位，产品路径注入 mulberry32 */
  private tierRand: () => number;
  /** 本玩家绑定的完整政策包身份（随对局记录保存） */
  readonly identity: NeuralPolicyIdentity;

  constructor(readonly seat: number, weights: Float32Array, tier: NeuralTier | number = 0, rand?: () => number, identity: NeuralPolicyIdentity = FROZEN_CHAMPION_IDENTITY) {
    this.identity = identity;
    this.mlp = new MLP(1);
    this.mlp.setWeights(weights);
    const enc: EncoderOpts = {};
    if (identity.candidateCompat) enc.candidateCompat = identity.candidateCompat;
    enc.passEncoding = identity.passEncoding;
    this.decider = new NeuralDecider(seat, this.mlp, 0, () => 0, enc);
    this.epsilon = typeof tier === 'string' ? NEURAL_TIERS[tier] : tier;
    this.tierRand = rand ?? (() => 0.999); // 无注入时近似贪心（不引入未控随机）
  }
  readonly epsilon: number;

  observe(events: EngineEvent[], _toBeat: Combo | null): void {
    this.decider.observe(events);
  }

  reset(_state: GameState, _rules: RuleOptions): void {
    this.decider.newGame();
  }

  decide(state: GameState): Move {
    // 值校验防御（2026-10-26 修复：旧引用比较会把一切非pass出牌误判为非法）
    const raw = this.epsilon > 0
      ? decideTiered(this.decider, state, this.epsilon, this.tierRand)
      : this.decider.decide(state).move as Move;
    return guardMove(state, raw as Move);
  }
}

/** 从 ArrayBuffer（weights.f32，小端 float32）构造玩家；tier 可选（D1 三档，默认贪心） */
export function createNeuralAI(seat: number, buffer: ArrayBufferLike, tier?: NeuralTier, rand?: () => number, identity?: NeuralPolicyIdentity): NeuralPlayer {
  const w = new Float32Array(buffer);
  if (w.length !== 164_865) throw new Error(`权重长度异常: ${w.length} != 164865`);
  return new NeuralPlayer(seat, w, tier ?? 0, rand, identity);
}
