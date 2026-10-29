/**
 * packages/review/src/decisionReview.ts — R3（REVIEW3-EXEC §3.1）：统一证据对象。
 * 每个被选中的决策产出一份 DecisionReview，页面/校验层/LLM 三方读同一对象：
 *   回放状态与规则上下文、当时观察哈希、实际动作（物理牌+声明+万能牌代入+合法性）、
 *   候选集哈希与覆盖匹配（actionIdentity 契约）、模型排序与权重身份、启发式偏好说明、
 *   实际/替代单步转移的结构事实（可证明层）、续打证据、claimLevel、冲突与缺失清单。
 * 牌名与数值一律由程序按 factId/actionId 渲染（facts/actionTexts 表），LLM 只能引用。
 * 身份哈希用双 lane FNV-1a（非密码学，仅做确定性标识，不承担防篡改）。
 */
import {
  beats, teamOf, type Combo, type GameRecord, type GameState,
} from '@gd/engine';
import {
  NeuralDecider, SCHEMA_VERSION, CANDIDATE_VERSION, encodeState, STATE_DIM, type MLP, type ScoreTerm, type EncoderOpts,
} from '@gd/ai';
import {scoreReviewCandidates as scoreCandidates,REVIEW_HEURISTIC_ID} from './reviewHeuristic';
import { memoryBefore, stateBefore } from './replay';
import { classifyReplay, type ReplayClass } from './replayStatus';
import { replay } from './replay';
import { analyzeGame, type MoveAnalysis, type ReviewAnalysis } from './analyzer';
import { altOf, type TeachAlternative } from './teach';
import { describeAction, cardsText } from './describeAction';
import { canonicalize, matchAction, type MatchStatus } from './actionIdentity';

export type ClaimLevel = 'model_preference' | 'conditional_support' | 'disagreement' | 'provable_fact' | 'uncovered';

/** D3（REVIEW4-EXEC §5.3）类型化断言：LLM 只能引用 claimId 组织教学，不得自算硬事实。
 * kind 决定允许的结论强度；text 由程序模板渲染（牌名/数值/方向全部来自本对象事实）。 */
export type ClaimKind =
  | 'rule_relation'          // 规则大小关系（beats 引擎判定）：可作硬事实陈述
  | 'resource_change'        // 单步资源变化（余手/耗王/结构事实）
  | 'policy_preference'      // 某策略（模型/启发式）更偏好某动作：仅偏好，非对错
  | 'single_world_outcome'   // 固定真实牌面的一次续打结果：情景演示，不外推
  | 'paired_support'         // 信息集配对续打过实用门后的条件支持
  | 'team_plan_hypothesis';  // 队伍计划假设（D2 TeamContext，带条件与触发器）

export interface Claim {
  claimId: string;
  kind: ClaimKind;
  decisionId: string;
  subjectActionId?: string;
  contrastActionId?: string;
  factIds: string[];
  /** 该 claim 允许的最高结论强度（与 ClaimLevel 同档） */
  scope: ClaimLevel;
  /** 程序渲染的断言文本（校验与展示唯一来源） */
  text: string;
}

export interface CandidateScoreEntry { actionId: string; text: string; score: number }

/** D1（REVIEW4 §5.1）：逐动作启发式评分分解——terms 绑定 actionId，Σ=score 可核验；
 * 某动作无分解才在 missing 里按动作登记，不得全局误报 */
export interface HeuristicBreakdown {
  actionId: string;
  terms: ScoreTerm[];
  score: number;
  sum: number;
  sumEqualsScore: boolean;
}

export interface SingleStepEvidence {
  actionId: string;
  label: string;        // 实际打法 / 启发式更偏好 / 模型首选
  sourceId: string;
  text: string;         // describeAction（程序渲染）
  remainingCards: number;
  wildsSpent: number;
  factIds: string[];
  /** D3：该证据对应的原始 Combo（pass=null）——claims 的规则关系判定用 */
  combo?: Combo | null;
}

export interface RolloutEvidence {
  mode: 'single_deterministic' | 'infoset_sampled';
  rootSourceId: string;
  continuationPolicyId: string;
  samples: number;
  seedsDigest: string;
  actualOutcomeText: string;
  alternativeOutcomeText: string;
  /** infoset 模式下的均值主指标 g（本副名次分）；确定性模式为空 */
  metricActual?: number;
  metricAlternative?: number;
  truncated: boolean;
  assumptionNote?: string;
}

export interface DecisionReview {
  decisionId: string;
  recordId: string;
  recordHash: string;
  moveNo: number;
  seat: number;
  replayStatus: ReplayClass['status'];
  verifiedPrefixEnd: number;
  ruleContext: {
    levelMode: string;
    stageTeam: number | null;
    levelsBefore: [number, number];
    version: string;    // ruleOpts 内容哈希
  };
  observation: { hash: string; basis: string };
  actual: {
    actionId: string;
    pass: boolean;
    physicalCards: string[];
    declaration: string | null;
    wildAs: string[];
    /** null=回放降级无法核实 */
    legal: boolean | null;
    coverage: { status: MatchStatus | 'no_candidates'; index: number };
  };
  candidates: {
    setHash: string;
    candidateVersion: string;
    encoderVersion: string;
    n: number;
    ranking: CandidateScoreEntry[];
  } | null;
  policy: { proposalPolicyId: string; weightHash: string | null } | null;
  heuristic: {
    sourceId?: string;
    topActionId: string | null;
    note: string | null;
    perItemBreakdown: boolean; // analyzer 无逐项分解；explain terms 单列
    /** 启发式首选的评分项构成（explain:true 导出，Σ=score 可核验） */
    terms?: ScoreTerm[];
  };
  singleStep: { actual: SingleStepEvidence; alternatives: SingleStepEvidence[] };
  rollouts: RolloutEvidence[]; // 单次确定性+信息集抽样可并存（双来源）
  /** D3：类型化断言清单（程序渲染；LLM/页面只能引用） */
  claims: Claim[];
  /** D1：逐动作启发式评分分解（实际/启发式首选/模型首选；Σ=score 核验） */
  heuristicBreakdowns: HeuristicBreakdown[];
  claimLevel: ClaimLevel;
  conflicts: string[];
  missing: string[];
  expressionScope: string;
  /** factId → 程序渲染文本（校验与展示的唯一事实来源） */
  facts: Record<string, string>;
  /** actionId → 程序渲染文本 */
  actionTexts: Record<string, string>;
}

/** 双 lane FNV-1a：确定性身份哈希（非密码学） */
export function fnvId(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c + i) & 0xff), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

const EXPRESSION_SCOPE: Record<ClaimLevel, string> = {
  provable_fact: '只可陈述程序验证的结构/张数事实，不得评价优劣，不得给出方向性建议',
  model_preference: '可陈述各来源偏好差异与取舍，不得说某选择"更差/错误"',
  conditional_support: '可在注明续打假设的前提下陈述条件性支持，不得升格为无条件结论',
  disagreement: '可陈述启发式与模型偏好分歧与各自理由，必须同屏呈现，不得裁决对错',
  uncovered: '实际动作不在模型候选集：只可陈述事实与规则层结构，不得比较打分',
};

function wildAsText(combo: Combo | null): string[] {
  if (!combo || combo.wildAs.length === 0) return [];
  return combo.wildAs.map((w) => {
    const c = combo.cards.find((x) => x.id === w.cardId);
    const base = c ? cardsText([c]) : `#${w.cardId}`;
    const as = w.asRank === 16 ? '小王' : w.asRank === 17 ? '大王' : `${w.asSuit}${w.asRank}`;
    return `${base}→当 ${as}`;
  });
}

export interface BuildDecisionReviewsOptions {
  /** Explicit full-policy candidate/pass semantics for the independent review scorer. */
  encoder?: EncoderOpts;
  /** 不传则不产出模型层（candidates/policy 为 null） */
  mlp?: Pick<MLP, 'forward'>;
  modelVersion?: string;
  weightHash?: string | null;
  analysis?: ReviewAnalysis;
  replayClass?: ReplayClass;
  /** 决策选择：默认分歧最大 1-2 手 + 有标签亮点 1 手（同 teach 选点） */
  moves?: number[];
  /** D6 测试专用故障注入：按 comboKey 前缀从模型候选丢弃（exact+uncovered 门验收；
   *  provenance 必须 constructed/fault_injected，不计生产覆盖率） */
  faultDropComboKeyPrefix?: string[];
  /** 续打证据（counterfactual / infoset 结果，按 moveNo 挂接；可多条） */
  rollouts?: Map<number, RolloutEvidence[]>;
  maxPoints?: number;
}

/**
 * 一次回放循环产出选中决策的完整证据对象。
 * 模型层（候选/排序/观察哈希）只在回放 status 非 ambiguous/invalid 且该手在
 * verifiedPrefixEnd 内时计算（F07：降级局面禁用评分与模型建议）。
 */
export function buildDecisionReviews(
  record: GameRecord,
  opts: BuildDecisionReviewsOptions = {},
): DecisionReview[] {
  const analysis = opts.analysis ?? analyzeGame(record);
  const replayClass = opts.replayClass ?? classifyReplay(record);
  const humanSeat = record.humanSeat ?? 0;

  const divergent = [...analysis.divergentMoves].sort((a, b) => b.scoreGap - a.scoreGap);
  const positives = analysis.moves.filter((m) => m.grade === 'good' && m.tags.length > 0);
  const maxPoints = opts.maxPoints ?? 3;
  const picked: number[] = opts.moves ?? (() => {
    const sel: number[] = [];
    const add = (m?: MoveAnalysis) => { if (m && !sel.includes(m.moveNo)) sel.push(m.moveNo); };
    add(divergent[0]); add(positives[0]); add(divergent[1]);
    // 干净局兜底（同 coach keyMoves 口径）：无分歧无亮点时补出手分量最大的非 forced 手，
    // 否则干净局证据卡为空
    if (sel.length < 2) {
      const chosen = new Set(sel);
      for (const m of [...analysis.moves]
        .filter((m) => (m.playedCards?.length ?? 0) > 0 && m.grade !== 'forced' && !chosen.has(m.moveNo))
        .sort((a, b) => (b.playedCards?.length ?? 0) - (a.playedCards?.length ?? 0))) {
        if (sel.length >= Math.min(3, maxPoints)) break;
        sel.push(m.moveNo); chosen.add(m.moveNo);
      }
    }
    return sel;
  })();
  const wanted = new Map(analysis.moves.filter((m) => picked.includes(m.moveNo)).map((m) => [m.moveNo, m]));

  const recordHash = fnvId(JSON.stringify(record.moves));
  const recordId = record.id ?? `rec-${recordHash.slice(0, 12)}`;
  const ruleVersion = fnvId(JSON.stringify({ o: record.ruleOpts, s: record.stageTeam ?? null, l: record.levelsBefore }));

  // 需要模型层才建 decider（tracker 由全部公开事件推进）
  const needModel = !!opts.mlp && picked.length > 0;
  const decider = needModel ? new NeuralDecider(humanSeat, opts.mlp as MLP, 0, () => 0,
    {...opts.encoder,...(opts.faultDropComboKeyPrefix ? { faultDropComboKeyPrefix: opts.faultDropComboKeyPrefix } : {})}) : null;
  const out: DecisionReview[] = [];

  for (const frame of replay(record)) {
    const moveNo = frame.move.moveNo;
    const isTarget = wanted.has(moveNo) && frame.move.player === humanSeat
      && out.filter((d) => wanted.has(d.moveNo)).length < maxPoints
      && !out.some((d) => d.moveNo === moveNo);
    if (isTarget) {
      out.push(buildOne(frame.state, frame.combo ?? null, wanted.get(moveNo)!, {
        record, recordId, recordHash, ruleVersion, replayClass, humanSeat,
        analysis, opts,
      }));
    }
    if (decider) decider.observe(frame.events);
    if (out.length >= Math.min(maxPoints, picked.length) && !needModel) break;
  }
  return out.sort((a, b) => a.moveNo - b.moveNo);

  function buildOne(
    state: GameState, actualCombo: Combo | null, mv: MoveAnalysis,
    ctx: {
      record: GameRecord; recordId: string; recordHash: string; ruleVersion: string;
      replayClass: ReplayClass; humanSeat: number; analysis: ReviewAnalysis;
      opts: BuildDecisionReviewsOptions;
    },
  ): DecisionReview {
    const { record, recordId, recordHash, ruleVersion, replayClass: rc, humanSeat: seat } = ctx;
    const decisionId = `${recordId}#m${mv.moveNo}`;
    const facts: Record<string, string> = {};
    const actionTexts: Record<string, string> = {};

    const degraded = rc.status === 'ambiguous' || rc.status === 'invalid' || mv.moveNo > rc.verifiedPrefixEnd;
    const missing: string[] = [];
    if (degraded) missing.push(`回放降级（${rc.status}${rc.reason ? '：' + rc.reason : ''}，核实前缀至第 ${rc.verifiedPrefixEnd} 手）——评分/模型建议/续打在本手禁用`);

    // ---- 实际动作 ----
    const actualPass = mv.pass;
    const actualCanonical = canonicalize(seat, actualPass, actualCombo);
    const actualText = actualPass ? '不出' : (actualCombo ? describeAction(actualCombo) : `${cardsText(mv.playedCards)}（声明未恢复）`);
    actionTexts[actualCanonical.actionId] = `实际打法：${actualText}`;

    // ---- 模型层（候选+排序+观察哈希）----
    let candidates: DecisionReview['candidates'] = null;
    let policy: DecisionReview['policy'] = null;
    let coverage: DecisionReview['actual']['coverage'] = { status: 'no_candidates', index: -1 };
    let modelTopCombo: Combo | null | undefined; // ranking[0] 的原始 Combo（单步转移用；undefined=无模型层）
    if (degraded) {
      missing.push('模型层禁用（回放降级）');
    } else if (decider) {
      const d = decider.decide(state, { wantRanking: true });
      const ranking = d.ranking!;
      modelTopCombo = ranking[0]?.combo ?? null;
      const rankingEntries: CandidateScoreEntry[] = ranking.map((r) => ({
        actionId: canonicalize(seat, r.combo === null, r.combo).actionId,
        text: r.combo === null ? '不出' : describeAction(r.combo),
        score: +r.score.toFixed(4),
      }));
      const candCanonicals = ranking.map((r) => canonicalize(seat, r.combo === null, r.combo));
      const m = matchAction(actualCanonical, candCanonicals);
      coverage = { status: m.status, index: m.index };
      const setHash = fnvId(rankingEntries.map((e) => e.actionId).sort().join('|'));
      candidates = {
        setHash,
        candidateVersion: opts.encoder?.candidateCompat==='v2'?'cand-dedup-v2':CANDIDATE_VERSION,
        encoderVersion: SCHEMA_VERSION,
        n: ranking.length,
        ranking: rankingEntries,
      };
      policy = {
        proposalPolicyId: opts.modelVersion ?? 'unknown-model',
        weightHash: opts.weightHash ?? null,
      };
      for (const e of rankingEntries) if (!(e.actionId in actionTexts)) actionTexts[e.actionId] = e.text;
    } else {
      missing.push('未提供模型权重——模型层 unavailable（不虚构排序）');
    }

    // 观察哈希：当时可见信息编码（自家手牌 + 公开事件 tracker）——模型层可用才有意义
    let observationHash = '';
    if (decider && !degraded) {
      const vec = new Float32Array(STATE_DIM);
      encodeState(state, seat, decider.tracker, vec);
      observationHash = fnvId(Array.from(vec, (v) => v.toFixed(3)).join(','));
    } else {
      observationHash = 'unavailable';
      missing.push('观察哈希 unavailable（回放降级或无模型）');
    }

    // ---- 启发式层 ----
    const recCombo = mv.recCombo;
    const heurTopActionId = mv.recommendedPass
      ? canonicalize(seat, true, null).actionId
      : recCombo ? canonicalize(seat, false, recCombo).actionId : null;
    if (heurTopActionId && !(heurTopActionId in actionTexts)) {
      actionTexts[heurTopActionId] = `启发式偏好：${mv.recommendedPass ? '不出' : recCombo ? describeAction(recCombo) : mv.recommendedText}`;
    }

    // ---- 单步转移结构事实（teach 同源）----
    const actualAlt = altOf('实际打法', '对局记录', actualCombo, state, seat);
    const toSingle = (a: TeachAlternative, prefix: string): SingleStepEvidence => {
      const ids: string[] = [];
      a.facts.forEach((f, k) => {
        const id = `f${mv.moveNo}-${prefix}${k}`;
        facts[id] = f.text;
        ids.push(id);
      });
      const aid = canonicalize(seat, a.combo === null, a.combo).actionId;
      return {
        actionId: aid, label: a.label, sourceId: a.sourceId,
        text: a.combo === null ? '不出' : describeAction(a.combo),
        remainingCards: a.remainingCards, wildsSpent: a.wildsSpent, factIds: ids,
        combo: a.combo,
      };
    };
    const singleActual = toSingle(actualAlt, 'a');
    actionTexts[singleActual.actionId] = `实际打法：${singleActual.text}`;

    const alternatives: SingleStepEvidence[] = [];
    if (!degraded) {
      const heurCombo = mv.recommendedPass ? null : recCombo;
      if (heurTopActionId !== actualCanonical.actionId) {
        const alt = toSingle(altOf(`启发式更偏好（${REVIEW_HEURISTIC_ID}）`, REVIEW_HEURISTIC_ID, heurCombo, state, seat), 'h');
        alternatives.push(alt);
        actionTexts[alt.actionId] = `启发式更偏好：${alt.text}`;
      }
      // 模型首选作为替代（若与实际动作、启发式替代都不同）
      const nnTopId = candidates?.ranking[0]?.actionId;
      if (nnTopId && modelTopCombo !== undefined && nnTopId !== actualCanonical.actionId
        && !alternatives.some((x) => x.actionId === nnTopId)) {
        const alt = toSingle(altOf('模型首选（建议排名）', opts.modelVersion ?? 'model', modelTopCombo, state, seat), 'n');
        alternatives.push(alt);
        actionTexts[alt.actionId] = `模型首选：${alt.text}`;
      }
      alternatives.splice(2);
    }

    // 上下文事实
    const ctxId = `f${mv.moveNo}-ctx`;
    facts[ctxId] = mv.context.isLead
      ? '你领出此轮'
      : `当前要压的是${['南', '东', '北', '西'][mv.context.toBeatPlayer ?? 0]}家的${state.lastCombo ? describeAction(state.lastCombo) : '牌'}；本轮领出者${['南', '东', '北', '西'][state.leader]}；各家剩牌 ${mv.context.handsBefore.map((n, i) => `${['南', '东', '北', '西'][i]}${n}张`).join('、')}`;
    facts[`f${mv.moveNo}-rule`] = `级牌口径=${record.ruleOpts.levelMode ?? 'both'}${record.stageTeam != null ? `（台上=${record.stageTeam === teamOf(seat) ? '我方' : '对方'}）` : ''}；双方级数 ${record.levelsBefore.join('/')}`;

    // ---- 冲突与 claimLevel ----
    const conflicts: string[] = [];
    const nnTopId = candidates && candidates.ranking.length > 0 ? candidates.ranking[0].actionId : null;
    if (heurTopActionId && nnTopId && heurTopActionId !== nnTopId) {
      conflicts.push('启发式首选与模型首选不同（分歧如实呈现，不裁决）');
    }
    if (coverage.status === 'uncovered' || coverage.status === 'same_cards_diff_decl') {
      conflicts.push(`实际动作未被模型候选覆盖（${coverage.status}）——不比较打分`);
    }
    const rollouts = opts.rollouts?.get(mv.moveNo) ?? [];
    const info = rollouts.find((r) => r.mode === 'infoset_sampled');
    const det = rollouts.find((r) => r.mode === 'single_deterministic');
    if (info && info.metricActual != null && info.metricAlternative != null && info.metricAlternative < info.metricActual) {
      conflicts.push('在均匀暗牌分配假设的抽样续打中，替代分支均值更差（条件结果，非判罚依据）');
    }
    if (info && det && info.metricActual != null && info.metricAlternative != null
      && det.metricActual != null && det.metricAlternative != null) {
      const infoAltBetter = info.metricAlternative > info.metricActual;
      const detAltBetter = det.metricAlternative > det.metricActual;
      if (infoAltBetter !== detAltBetter) {
        conflicts.push('单次确定性推演与信息集抽样均值方向相反——结果依赖续打策略与暗牌分布，两来源并列呈现，不构成判罚');
      }
    }

    const claimLevel: ClaimLevel = degraded ? 'provable_fact'
      : coverage.status === 'uncovered' || coverage.status === 'same_cards_diff_decl' ? 'uncovered'
        : conflicts.some((c) => c.includes('首选与模型首选不同')) ? 'disagreement'
          : rollouts.length > 0 ? 'conditional_support'
            : 'model_preference';
    // D1 修正：不再无条件登记"启发式无逐项分解"——逐动作登记见下方 heuristicBreakdowns 段

    // ---- D1：逐动作启发式评分分解（实际/启发式首选/模型首选各自的 terms，Σ=score 核验）----
    const breakdownTargets: Array<{ combo: Combo | null; actionId: string }> = [];
    if (!degraded) {
      breakdownTargets.push({ combo: actualCombo, actionId: actualCanonical.actionId });
      if (heurTopActionId && heurTopActionId !== actualCanonical.actionId) {
        breakdownTargets.push({ combo: mv.recommendedPass ? null : recCombo, actionId: heurTopActionId });
      }
      const nnTopId = candidates?.ranking[0]?.actionId;
      if (modelTopCombo != null && nnTopId && nnTopId !== actualCanonical.actionId
        && !breakdownTargets.some((t) => t.actionId === nnTopId)) {
        breakdownTargets.push({ combo: modelTopCombo, actionId: nnTopId });
      }
    }
    const heuristicBreakdowns: HeuristicBreakdown[] = [];
    if (!degraded) {
      const scoredExplain = scoreCandidates({
        state, seat, caps: { memory: true, inference: false, cooperation: true, planning: true, noise: 0, rolloutIters: 0 },
        memory: memoryBefore(record, mv.moveNo), rand: () => 0, explain: true,
      });
      const byAction = new Map<string, { terms?: ScoreTerm[]; score: number }>();
      for (const s of scoredExplain) {
        const aid = canonicalize(seat, s.move.pass, s.combo ?? null).actionId;
        if (!byAction.has(aid)) byAction.set(aid, { terms: s.terms, score: s.score });
      }
      for (const t of breakdownTargets) {
        const hit = byAction.get(t.actionId);
        if (hit && hit.terms && hit.terms.length > 0) {
          const sum = +hit.terms.reduce((a, x) => a + x.value, 0).toFixed(4);
          heuristicBreakdowns.push({
            actionId: t.actionId, terms: hit.terms, score: +hit.score.toFixed(4),
            sum, sumEqualsScore: Math.abs(sum - +hit.score.toFixed(4)) < 1e-3,
          });
        } else {
          // D1：某动作无分解才按动作登记缺失；不得全局误报 heuristic_breakdown_unavailable
          missing.push(`启发式评分未提供逐项分解（actionId=${t.actionId}，仅偏好说明，不让 LLM 反推原因）`);
        }
      }
    }

    // ---- D3：类型化断言（程序渲染；LLM 只能引用 claimId）----
    const claims: Claim[] = [];
    const toBeatCombo = state.lastCombo;
    const claimText = (prefix: string): string => `${prefix}（第${mv.moveNo}手，${recordId}）`;
    // rule_relation：跟牌时各动作与待压牌的大小关系（引擎 beats 判定）
    if (toBeatCombo) {
      const tbText = describeAction(toBeatCombo);
      const relOf = (combo: Combo | null, actionId: string, label: string): void => {
        if (!combo) {
          claims.push({
            claimId: fnvId(`rr-${decisionId}-pass`), kind: 'rule_relation', decisionId,
            subjectActionId: actionId, factIds: [ctxId],
            scope: 'provable_fact',
            text: claimText(`${label}选择不出（pass 只表示不压，不等于压不过）`),
          });
          return;
        }
        const can = beats(combo, toBeatCombo);
        claims.push({
          claimId: fnvId(`rr-${decisionId}-${actionId}`), kind: 'rule_relation', decisionId,
          subjectActionId: actionId, factIds: [ctxId, `f${mv.moveNo}-rule`],
          scope: 'provable_fact',
          text: claimText(`${label}${describeAction(combo)}${can ? '压得过' : '压不过'}当前要压的${tbText}（引擎规则判定）`),
        });
      };
      if (actualCombo) relOf(actualCombo, actualCanonical.actionId, '实际动作');
      for (const a of alternatives) relOf(a.combo ?? null, a.actionId, a.label);
    }
    // resource_change：单步结构事实（余手/耗王）
    for (const [label, ev] of [['实际', singleActual], ...alternatives.map((a) => [a.label, a] as const)] as const) {
      if (ev.factIds.length === 0) continue;
      claims.push({
        claimId: fnvId(`rc-${decisionId}-${ev.actionId}`), kind: 'resource_change', decisionId,
        subjectActionId: ev.actionId, factIds: ev.factIds,
        scope: 'provable_fact',
        text: claimText(`${label}${ev.text}后剩 ${ev.remainingCards} 张${ev.wildsSpent > 0 ? `、耗万能牌 ${ev.wildsSpent} 张` : ''}`),
      });
    }
    // policy_preference：模型/启发式偏好（不裁决）
    if (candidates && candidates.ranking.length > 0 && !degraded) {
      const top = candidates.ranking[0];
      claims.push({
        claimId: fnvId(`pp-${decisionId}-model`), kind: 'policy_preference', decisionId,
        subjectActionId: top.actionId, contrastActionId: actualCanonical.actionId,
        factIds: [ctxId], scope: 'model_preference',
        text: claimText(`模型（${opts.modelVersion ?? 'unknown'}）首选 ${top.text}（评分 ${top.score}），这是偏好排序不是对错判定`),
      });
    }
    if (heurTopActionId && !degraded) {
      claims.push({
        claimId: fnvId(`pp-${decisionId}-heuristic`), kind: 'policy_preference', decisionId,
        subjectActionId: heurTopActionId, contrastActionId: actualCanonical.actionId,
        factIds: [ctxId], scope: 'model_preference',
        text: claimText(`启发式（${REVIEW_HEURISTIC_ID} 分析口径）更偏好 ${actionTexts[heurTopActionId] ?? heurTopActionId}，与实际/模型的意见可能不同——同屏呈现不裁决`),
      });
    }
    // single_world_outcome / paired_support：续打证据（方向与样本数程序渲染）
    for (const r of rollouts) {
      if (r.mode === 'single_deterministic') {
        claims.push({
          claimId: fnvId(`sw-${decisionId}-${r.rootSourceId}`), kind: 'single_world_outcome', decisionId,
          factIds: [ctxId], scope: 'conditional_support',
          text: claimText(`在本次固定真实牌面的一次续打演示中：实际=${r.actualOutcomeText}；替代=${r.alternativeOutcomeText}——只属于该情景，不外推为信息集最优`),
        });
      } else if (r.mode === 'infoset_sampled') {
        claims.push({
          claimId: fnvId(`ps-${decisionId}-${r.rootSourceId}`), kind: 'paired_support', decisionId,
          factIds: [ctxId], scope: 'conditional_support',
          text: claimText(`均匀暗牌分配假设下抽样 ${r.samples} 份配对续打：实际均值 g=${r.metricActual ?? '?'}，替代均值 g=${r.metricAlternative ?? '?'}（续打政策 ${r.continuationPolicyId}；条件结果）`),
        });
      }
    }

    return {
      decisionId, recordId, recordHash,
      moveNo: mv.moveNo, seat,
      replayStatus: rc.status,
      verifiedPrefixEnd: rc.verifiedPrefixEnd,
      ruleContext: {
        levelMode: record.ruleOpts.levelMode ?? 'both',
        stageTeam: record.stageTeam ?? null,
        levelsBefore: [...record.levelsBefore] as [number, number],
        version: ruleVersion,
      },
      observation: { hash: observationHash, basis: 'encodeState(317维：自家手牌+公开事件+轮次/级数等公开字段)' },
      actual: {
        actionId: actualCanonical.actionId,
        pass: actualPass,
        physicalCards: actualCombo ? actualCombo.cards.map((c) => `${c.suit}${c.rank}#${c.id}`) : [],
        declaration: actualPass ? 'pass' : actualCanonical.declKey,
        wildAs: wildAsText(actualCombo),
        legal: degraded ? null : true,
        coverage,
      },
      candidates, policy,
      heuristic: {
        sourceId: REVIEW_HEURISTIC_ID,
        topActionId: heurTopActionId,
        note: degraded ? null : mv.note,
        perItemBreakdown: heuristicBreakdowns.length > 0,
        terms: heuristicBreakdowns.find(h=>h.actionId===heurTopActionId)?.terms,
      },
      singleStep: { actual: singleActual, alternatives },
      rollouts,
      claims,
      heuristicBreakdowns,
      claimLevel,
      conflicts, missing,
      expressionScope: EXPRESSION_SCOPE[claimLevel],
      facts, actionTexts,
    };
  }
}
