/**
 * packages/ai/src/nn/neuralSeat.ts — 神经决策器：受限观察 + 候选枚举/去重 + ε-greedy。
 * 反作弊红线：只读自家手牌与公开字段（见 schema.ts 白名单与 checks 平行世界测试）。
 * 训练采样（lab）与对局陪练/复盘建议共用本实现——编码唯一权威。
 */
import { canPass, comboKey, legalCombos, type Combo, type EngineEvent, type GameState } from '@gd/engine';
import type { Move } from '../types';
import {
  encodeAction, encodeState, encodeStateV2, INPUT_DIM, INPUT_DIM_V2, KIND_DIM, kindIdx, physIdx,
  PublicTracker, STATE_DIM, STATE_DIM_V2, DEFAULT_PASS_ENCODING, type PassEncoding,
} from './schema';
import type { MLP } from './mlp';

/** 决策器编码方案：
 *  v1（默认）=385 维；v2=399 维（14 维规则上下文：control 恒 0 / treatment 填公开规则信息）
 *  passEncoding（REVIEW5 T0.2）：'action64'=pass 写动作块 64（新默认，schema v3/v4）；
 *  'legacy-phys10'=历史错位编码，仅用于未迁移旧权重的等价验证/历史回放。
 *  加载旧权重（schema v1/v2 训练）时必须先 migratePassEncoding，或显式声明 legacy。 */
export interface EncoderOpts {
  schema?: 'v1' | 'v2';
  ctxFill?: 'zero' | 'rule-context';
  passEncoding?: PassEncoding;
  /** frozenChampion 兼容：把候选列表折叠回 cand-dedup-v2 口径（同声明取首个花色变体；
   *  冠军包的历史候选语义——不改变引擎合法性，只约束该政策可选集合） */
  candidateCompat?: 'v2';
  /** 测试专用故障注入（D6）：按 comboKey 前缀丢弃候选——只用于 exact+uncovered 门验收，
   *  标 constructed/fault_injected，不得用于生产覆盖率统计 */
  faultDropComboKeyPrefix?: string[];
}

export interface NeuralDecision {
  move: Move;
  /** 完整输入向量（决策时刻独立快照）；仅 collectFeat 时返回 */
  feat?: Float32Array;
  nCands: number;
  explored: boolean;
  /** 全候选打分（降序排列 (idx, score)），供复盘排序展示 */
  ranking?: Array<{ idx: number; score: number; combo: Combo | null }>;
}

/** 候选生成器版本（T0 冻结/复盘证据引用；候选语义变更必须 bump）
 * v2（2026-10-27）：enumerateCombos 去重键=声明+资源角色（万能自然 r、代入 r→a、普通 r 分色），
 * 并补齐自然牌充足时的万能替代对子/三张变体（T0 小手牌穷举对照 0 缺失 0 多余）。
 * v3（2026-10-28 REVIEW4-A1）：资源角色含花色——同声明同点不同花色是不同物理资源
 * （对8 反例：♣8♦8 保 ♠5-9 同花顺 vs ♠8♣8 破坏之，v2 合并为 1 个候选坐实缺陷）；
 * 枚举按每 rank 自然牌花色多重集展开全部变体；双副同花色同点副本仍等价合并。
 * 既有 clean2 权重为 v2 动作空间下训练的政策，推理配套切换后候选分布变化如实记录。 */
export const CANDIDATE_VERSION = 'cand-suit-v3';

/** 候选去重：同物理消耗 + 同宣告 = 语义等价；不同宣告保留（含万能牌代入差异） */
export function dedupCandidates(legal: Combo[], passAllowed: boolean): Array<{ combo: Combo | null }> {
  const seen = new Set<string>();
  const out: Array<{ combo: Combo | null }> = [];
  const counts = new Uint8Array(54);
  for (const c of legal) {
    counts.fill(0);
    for (const card of c.cards) counts[physIdx(card)] += 1;
    const key = `${counts.join(',')}|${c.kind}|${c.mainRank}|${c.length}|${c.pairRanks.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ combo: c });
  }
  if (passAllowed) out.push({ combo: null });
  return out;
}

/** frozenChampion 兼容折叠（REVIEW4-F）：v3 花色变体列表 → v2 口径（每声明+资源角色类
 *  的 v2 键只留首个）。冠军政策历史候选语义的忠实复现，不改变合法性判定。 */
export function dedupCandidatesV2Compat(cands: Array<{ combo: Combo | null }>): Array<{ combo: Combo | null }> {
  const seen = new Set<string>();
  const out: Array<{ combo: Combo | null }> = [];
  for (const c of cands) {
    if (c.combo === null) { out.push(c); continue; }
    const k = `${comboKey(c.combo)}|${c.combo.cards.map((x) => x.rank).sort((a, b) => a - b).join(',')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

export class NeuralDecider {
  readonly tracker = new PublicTracker();

  constructor(
    readonly seat: number,
    private mlp: MLP,
    private eps = 0,
    private rand: () => number = () => 0,
    private encoder: EncoderOpts = {},
  ) {}

  newGame(): void { this.tracker.reset(); }
  observe(events: EngineEvent[]): void { this.tracker.observe(events); }

  decide(state: GameState, opts?: { collectFeat?: boolean; wantRanking?: boolean }): NeuralDecision {
    let cands = dedupCandidates(legalCombos(state), canPass(state));
    if (this.encoder.candidateCompat === 'v2') cands = dedupCandidatesV2Compat(cands);
    if (this.encoder.faultDropComboKeyPrefix?.length) {
      cands = cands.filter((c) => !c.combo || !this.encoder.faultDropComboKeyPrefix!.some((p) => comboKey(c.combo!).startsWith(p)));
    }
    const n = cands.length;
    const v2 = this.encoder.schema === 'v2';
    const dim = v2 ? INPUT_DIM_V2 : INPUT_DIM;
    const passAt = this.encoder.passEncoding ?? DEFAULT_PASS_ENCODING;
    const X = new Float32Array(n * dim);
    if (v2) {
      encodeStateV2(state, this.seat, this.tracker, X.subarray(0, STATE_DIM_V2), this.encoder.ctxFill ?? 'zero');
      for (let i = 0; i < n; i++) {
        if (i > 0) X.copyWithin(i * dim, 0, STATE_DIM_V2);
        encodeAction(cands[i].combo, X.subarray(i * dim + STATE_DIM_V2), passAt);
      }
    } else {
      encodeState(state, this.seat, this.tracker, X.subarray(0, STATE_DIM));
      for (let i = 0; i < n; i++) {
        if (i > 0) X.copyWithin(i * INPUT_DIM, 0, STATE_DIM);
        encodeAction(cands[i].combo, X.subarray(i * INPUT_DIM + STATE_DIM), passAt);
      }
    }
    const scores = this.mlp.forward(X, n);

    let pick = 0;
    let explored = false;
    if (this.eps > 0 && this.rand() < this.eps) {
      pick = Math.floor(this.rand() * n) % n;
      explored = true;
    } else {
      let best = -Infinity;
      for (let i = 0; i < n; i++) if (scores[i] > best) { best = scores[i]; pick = i; }
    }
    const chosen = cands[pick];
    const move: Move = chosen.combo ? { pass: false, combo: chosen.combo } : { pass: true };
    const out: NeuralDecision = { move, nCands: n, explored };
    if (opts?.collectFeat) out.feat = X.slice(pick * dim, (pick + 1) * dim);
    if (opts?.wantRanking) {
      out.ranking = cands
        .map((c, idx) => ({ idx, score: scores[idx], combo: c.combo }))
        .sort((a, b) => b.score - a.score);
    }
    return out;
  }
}
