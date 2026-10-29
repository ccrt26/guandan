/**
 * packages/review/src/nnAdvisor.ts — 神经复盘第一阶段（CLEAN1-REVIEW-1.0 指令 D）。
 * 只做「建议排名」，不做客观裁判；反事实续打维持现有启发式并另行标注来源。
 *
 * D1 正确接线：确定性回放到出牌前时点（replay frame 的 before 态），从当时玩家
 * 可见信息构造输入（PublicTracker 只由公开事件驱动；encodeState 只读自家手牌与
 * 公开字段），使用冻结的规则/候选/编码/权重版本。玩家实际动作按「牌张多重集 +
 * 声明语义」匹配：同花色同点数的两副副本视为等价可规范化；同一个牌张多重集但
 * 声明不同（如万能牌代入不同）是不同动作，不强配——标 same_cards_diff_decl。
 * 模型候选未覆盖实际动作时显示"当前模型未覆盖此出法，暂不评价"，不当失误。
 *
 * D2 评价口径：四档判语（一致/更推荐另一种/没有可比较候选/暂不可评）；
 * 不使用 gap<8、不称"客观最佳/必错/损失 X% 胜率"——神经输出是混合收益评价，
 * 既不是百分制也不是校准胜率。
 *
 * D3 覆盖统计：总决策数/成功对齐/未覆盖/候选唯一/（已覆盖且多候选中）首选一致率。
 * "候选唯一"指当前候选列表只有一项，不等于规则上绝对只有一种合法选择。
 */
import { describeCombo, type Card, type Combo, type GameRecord } from '@gd/engine';
import { NeuralDecider, type MLP, type EncoderOpts } from '@gd/ai';
import { replay } from './replay';
import { canonicalize, matchAction } from './actionIdentity';

export type NnVerdict = 'match' | 'prefer_other' | 'single_candidate' | 'uncovered' | 'same_cards_diff_decl';

export interface NnRankItem {
  text: string;       // "不出" 或 "♠8 ♥8（对子 88）"
  cards: Card[] | null;
  score: number;
  /** R3：统一动作身份（actionIdentity.canonicalize），供证据对象/校验层引用 */
  actionId: string;
}

export interface NnMoveAdvice {
  moveNo: number;
  verdict: NnVerdict;
  verdictText: string;
  actualText: string;
  top: NnRankItem[];  // 前 3（含并列时的说明见 nearTie）
  nearTie: boolean;   // top1 与 top2 分差 < 1e-4（近似并列，展示用）
  actualRank: number | null; // 实际动作在完整候选中的名次（未覆盖=null）
  nCandidates: number;
}

export interface NnReviewSummary {
  modelVersion: string;
  stats: {
    totalDecisions: number;
    aligned: number;          // 成功对齐（含 pass/出牌）
    uncovered: number;        // 模型候选未覆盖实际出法
    sameCardsDiffDecl: number; // 同牌异型解释
    singleCandidate: number;  // 当前候选唯一
    firstChoiceAgreement: number; // 已对齐且多候选中与模型首选一致
    firstChoiceAgreementDenom: number;
  };
  moves: NnMoveAdvice[];
}

const VERDICT_TEXT: Record<NnVerdict, string> = {
  match: '与模型首选一致',
  prefer_other: '模型更推荐另一种出法',
  single_candidate: '当前没有可比较候选（候选列表只有一项，不等于规则强制）',
  uncovered: '当前模型未覆盖此出法，暂不评价',
  same_cards_diff_decl: '同一手牌存在不同牌型解释，暂不评价（不强行匹配）',
};

/** 实际动作 → 候选排名匹配（导出供定点单测）。
 * R3 收口：统一走 actionIdentity.matchAction（物理全等 > 等价副本 > 同牌异声明/未覆盖），
 * 与 analyzer/teach/DecisionReview 同一契约；返回命中索引与"同牌异型"标记。 */
export function matchMoveToRanking(
  actual: { pass: boolean; combo: Combo | null },
  ranking: Array<{ combo: Combo | null }>,
): { idx: number; sameCardsOnly: boolean } {
  if (actual.pass) {
    const m = matchAction(canonicalize(0, true, null), ranking.map((r) => canonicalize(0, r.combo === null, r.combo)));
    return { idx: m.index, sameCardsOnly: false };
  }
  if (!actual.combo) return { idx: -1, sameCardsOnly: false };
  const cands = ranking.map((r) => canonicalize(0, r.combo === null, r.combo));
  const m = matchAction(canonicalize(0, false, actual.combo), cands);
  return { idx: m.index, sameCardsOnly: m.status === 'same_cards_diff_decl' };
}

function candText(c: Combo | null): string {
  return c === null ? '不出' : describeCombo(c);
}

/** 用冻结权重对整局人类决策给出建议排名与覆盖统计。
 * scorer 只需 forward（便于测试注入固定打分）。 */
export function analyzeWithModel(
  record: GameRecord,
  mlp: Pick<MLP, 'forward'>,
  modelVersion: string,
  encoder: EncoderOpts = {},
): NnReviewSummary {
  const humanSeat = record.humanSeat ?? 0;
  const decider = new NeuralDecider(humanSeat, mlp as MLP, 0, () => 0, encoder); // 自带公开信息 tracker
  const moves: NnMoveAdvice[] = [];
  const stats = {
    totalDecisions: 0, aligned: 0, uncovered: 0, sameCardsDiffDecl: 0,
    singleCandidate: 0, firstChoiceAgreement: 0, firstChoiceAgreementDenom: 0,
  };

  for (const frame of replay(record)) {
    // 在「之前」的时点给人类席位建议（只用当时公开信息 + 自家手牌）
    if (frame.move.player === humanSeat && !frame.state.over) {
      stats.totalDecisions += 1;
      const d = decider.decide(frame.state, { wantRanking: true });
      const ranking = d.ranking!; // 降序
      const n = ranking.length;
      const actual = frame.move;
      const actualPass = actual.pass;

      if (n <= 1) {
        stats.singleCandidate += 1;
        stats.aligned += 1; // 唯一候选（含 forced pass）可对齐
        moves.push({
          moveNo: actual.moveNo, verdict: 'single_candidate', verdictText: VERDICT_TEXT.single_candidate,
          actualText: actualPass ? '不出' : candText(frame.combo), top: ranking.slice(0, 3).map(itemOf), nearTie: false, actualRank: 0, nCandidates: n,
        });
      } else {
        // R3 收口：匹配统一走 matchMoveToRanking（actionIdentity 契约）
        const m = matchMoveToRanking({ pass: actualPass, combo: frame.combo ?? null }, ranking);
        const actualIdx = m.idx;
        const sameCardsOnly = m.sameCardsOnly;
        if (actualIdx < 0 && sameCardsOnly) {
          stats.sameCardsDiffDecl += 1;
          moves.push({
            moveNo: actual.moveNo, verdict: 'same_cards_diff_decl', verdictText: VERDICT_TEXT.same_cards_diff_decl,
            actualText: actualPass ? '不出' : candText(frame.combo), top: ranking.slice(0, 3).map(itemOf), nearTie: nearTieOf(ranking), actualRank: null, nCandidates: n,
          });
        } else if (actualIdx < 0) {
          stats.uncovered += 1;
          moves.push({
            moveNo: actual.moveNo, verdict: 'uncovered', verdictText: VERDICT_TEXT.uncovered,
            actualText: actualPass ? '不出' : candText(frame.combo), top: ranking.slice(0, 3).map(itemOf), nearTie: nearTieOf(ranking), actualRank: null, nCandidates: n,
          });
        } else {
          stats.aligned += 1;
          stats.firstChoiceAgreementDenom += 1;
          // v3（REVIEW4-A1）：候选按花色展开后，同声明不同花色变体各有独立打分；
          // 实际动作与 top1 分数完全并列时不算"更推荐另一种"（排序先后只是枚举顺序）
          const isTop = actualIdx === 0
            || Math.abs(ranking[actualIdx].score - ranking[0].score) < 1e-9;
          if (isTop) stats.firstChoiceAgreement += 1;
          // 并列时名次=严格更高分的候选数+1（花色变体并列不因枚举顺序靠后而"掉名次"）
          const rank = 1 + ranking.filter((r) => r.score > ranking[actualIdx].score).length;
          moves.push({
            moveNo: actual.moveNo,
            verdict: isTop ? 'match' : 'prefer_other',
            verdictText: VERDICT_TEXT[isTop ? 'match' : 'prefer_other'],
            actualText: actualPass ? '不出' : candText(frame.combo),
            top: ranking.slice(0, 3).map(itemOf),
            nearTie: nearTieOf(ranking),
            actualRank: rank,
            nCandidates: n,
          });
        }
      }
    }
    // 公开事件推进（所有手，不区分席位；decider 的 tracker 只由公开事件驱动）
    decider.observe(frame.events);
  }

  return { modelVersion, stats, moves };
}

function nearTieOf(ranking: Array<{ score: number }>): boolean {
  return ranking.length > 1 && Math.abs(ranking[0].score - ranking[1].score) < 1e-4;
}
function itemOf(r: { score: number; combo: Combo | null }): NnRankItem {
  return {
    text: candText(r.combo), cards: r.combo ? [...r.combo.cards] : null,
    score: +r.score.toFixed(4),
    actionId: canonicalize(0, r.combo === null, r.combo).actionId,
  };
}

/** D4 呈现层次标签（供 UI/剧本统一措辞；不使用"AI判断（硬事实）"统称） */
export const LAYER_LABELS = {
  facts: '对局事实（当时公开信息与实际出法，可核实记录）',
  model: '模型建议（冻结权重 clean1-ck180 的候选排序，非客观最佳）',
  sim: '模拟结果（建议来源=ck180；续打策略=现有启发式版本；条件模拟非必然）',
  coach: '复盘讲解（GLM 依据上述证据的通俗说明，推断会明确标注）',
} as const;

