/**
 * packages/review/src/teach.ts — R3（REVIEW2-EXEC §5.1/5.2）：教学点选择与结构事实。
 * - 默认选 2-3 个真正值得讨论的决策（分歧最大者 + 有证据的亮点 + 若有未覆盖/歧义则说明）；
 * - 每个决策对"实际/替代"动作各执行合法单步状态转移，取剩余本人手牌，
 *   用规则验证可证明的结构事实（某炸弹/同花顺/顺子是否仍可组成、万能牌消耗、清牌动作存在性）；
 * - 只输出可核实事实，不跳到"保住必赢/拆弹必错"。
 */
import { applyMove, type Combo, type GameRecord, type GameState } from '@gd/engine';
import { decompose, scoreCandidates, PlayMemory, type ScoreTerm } from '@gd/ai';
import type { MoveAnalysis, ReviewAnalysis } from './analyzer';
import { memoryBefore, stateBefore } from './replay';
import { describeAction } from './describeAction';
import { canonicalize, matchAction } from './actionIdentity';

/** R3 收口：同源动作比较统一走 actionIdentity（物理全等或等价副本=同一动作） */
function sameAction(a: { pass: boolean; combo: Combo | null }, b: { pass: boolean; combo: Combo | null }): boolean {
  if (a.pass !== b.pass) return false;
  if (a.pass) return true;
  if (!a.combo || !b.combo) return false;
  const m = matchAction(canonicalize(0, false, a.combo), [canonicalize(0, false, b.combo)]);
  return m.status === 'exact' || m.status === 'equivalent_copy';
}

export interface StructureFact {
  /** 剩余手牌可组成的显著结构（炸弹/同花顺/天王炸），附一组证据牌 */
  kind: 'bomb' | 'flush' | 'joker_bomb' | 'straight' | 'finish_now';
  text: string;
}

export interface TeachAlternative {
  label: string;              // "实际" / "启发式更偏好" / "模型首选"
  sourceId: string;
  combo: Combo | null;        // null = 让牌
  /** 单步转移后本人剩余手牌的结构事实（可证明层） */
  facts: StructureFact[];
  wildsSpent: number;
  remainingCards: number;
  /** 启发式口径的评分项构成（可验证依据；altOf 本身不打分，由 buildTeachPlan 注入首选项） */
  scoreTerms?: ScoreTerm[];
}

export interface TeachingPoint {
  moveNo: number;
  contextText: string;        // 当时知道什么（公开信息）
  actual: TeachAlternative;
  alternatives: TeachAlternative[]; // 1-2 个
  /** 整合层允许的讲解强度（§4.5）：模型偏好/条件支持/存在分歧/可证明事实 */
  claimLevel: 'model_preference' | 'conditional_support' | 'disagreement' | 'provable_fact';
  claimLevelText: string;
}

export interface TeachPlan {
  points: TeachingPoint[];
  overviewFacts: string[];    // 程序生成的全局事实（进程/名次/规则/重大公开事件），LLM 不得自行编整盘因果
}

const MID = 'heuristic:mid(分析口径)';

/** 剩余手牌的可证明结构事实（规则层验证；不含任何"必赢"断言） */
export function structureFacts(remaining: GameState['hands'][number], ctx: GameState['ctx']): StructureFact[] {
  if (remaining.length === 0) return [{ kind: 'finish_now', text: '此打出后本人手牌清空（直接走人）' }];
  const plan = decompose(remaining, { ranks: ctx.ranks, levels: ctx.levels });
  const out: StructureFact[] = [];
  for (const c of plan.combos) {
    if (c.kind === 'bomb') out.push({ kind: 'bomb', text: `仍持有 ${c.size} 张炸弹 ${c.cards.map((x) => x.suit === 'H' ? `♥${x.rank}` : `${x.suit}${x.rank}`).join('')}` });
    else if (c.kind === 'joker_bomb') out.push({ kind: 'joker_bomb', text: '仍持有天王炸' });
    else if (c.kind === 'flush') out.push({ kind: 'flush', text: '仍可组成同花顺' });
  }
  // 最后一手清牌：剩余牌本身是一个合法整体
  if (out.length === 0 && remaining.length <= 5) {
    out.push({ kind: 'straight', text: `剩 ${remaining.length} 张，接近收官` });
  }
  return out.slice(0, 3);
}

export function altOf(
  label: string, sourceId: string, combo: Combo | null, state: GameState, seat: number,
): TeachAlternative {
  const sim = {
    ...state, hands: state.hands.map((h) => [...h]),
    trickPlays: state.trickPlays.map((p) => ({ ...p })), finished: [...state.finished],
  } as GameState;
  if (combo) applyMove(sim, { pass: false, combo });
  else applyMove(sim, { pass: true });
  return {
    label, sourceId, combo,
    facts: structureFacts(sim.hands[seat], sim.ctx),
    wildsSpent: combo?.wildAs.length ?? 0,
    remainingCards: sim.hands[seat].length,
  };
}

function contextTextOf(mv: MoveAnalysis, seatNames: string[]): string {
  const lead = mv.context.isLead ? '你领出' : `${seatNames[mv.context.toBeatPlayer ?? 0]}领出（${mv.context.toBeatText ?? ''}）`;
  return `${lead}；各家剩牌 ${mv.context.handsBefore.map((n, i) => `${seatNames[i]}${n}张`).join('、')}；对手最少 ${mv.context.oppMinCards} 张`;
}

/** 教学点选择：分歧最大的 1-2 手 + 有标签的亮点 1 手；不足 2 则补覆盖度最高的手 */
export function buildTeachPlan(
  record: GameRecord,
  analysis: ReviewAnalysis,
  seatNames: string[],
  nnTopByMove?: Map<number, { combo: Combo | null; sourceId: string }>,
): TeachPlan {
  const humanSeat = record.humanSeat ?? 0;
  const byNo = new Map(analysis.moves.map((m) => [m.moveNo, m]));

  const divergent = [...analysis.divergentMoves].sort((a, b) => b.scoreGap - a.scoreGap);
  const positives = analysis.moves.filter((m) => m.grade === 'good' && m.tags.length > 0);
  const picked: MoveAnalysis[] = [];
  const pick = (m?: MoveAnalysis) => { if (m && !picked.some((p) => p.moveNo === m.moveNo)) picked.push(m); };
  pick(divergent[0]);
  pick(positives[0]);
  pick(divergent[1]);

  const points: TeachingPoint[] = [];
  for (const mv of picked.slice(0, 3)) {
    const state = stateBefore(record, mv.moveNo);
    const memory = memoryBefore(record, mv.moveNo);
    const scored = scoreCandidates({
      state, seat: humanSeat,
      caps: { memory: true, inference: false, cooperation: true, planning: true, noise: 0, rolloutIters: 0 },
      memory, rand: () => 0, explain: true,
    });
    const best = scored[0];
    const nn = nnTopByMove?.get(mv.moveNo);

    const actual = altOf('实际打法', '对局记录', mv.playedCombo ?? null, state, humanSeat);
    const alternatives: TeachAlternative[] = [];
    const bestCombo = best.move.pass ? null : best.combo ?? null;
    const sameAsActual = sameAction({ pass: best.move.pass, combo: bestCombo }, { pass: mv.pass, combo: mv.playedCombo ?? null });
    if (!sameAsActual) {
      const alt = altOf(`启发式更偏好（${MID}）`, MID, bestCombo, state, humanSeat);
      alt.scoreTerms = best.terms; // 启发式偏好依据（Σ=score 可核验）
      alternatives.push(alt);
    }
    if (nn && nn.combo) {
      const nnSame = sameAction({ pass: false, combo: nn.combo }, { pass: mv.pass, combo: mv.playedCombo ?? null });
      if (!nnSame && !alternatives.some((a) => a.combo && sameAction({ pass: false, combo: nn.combo! }, { pass: false, combo: a.combo }))) {
        alternatives.push(altOf('模型首选（建议排名）', nn.sourceId, nn.combo, state, humanSeat));
      }
    }
    alternatives.splice(2);

    const hasDisagreement = alternatives.length >= 2
      || (alternatives.length === 1 && (nn?.combo ?? null) !== null && !sameAsActual);
    const claimLevel: TeachingPoint['claimLevel'] =
      mv.grade === 'uncovered' ? 'provable_fact'
      : alternatives.length === 0 ? 'provable_fact'
      : hasDisagreement ? 'disagreement'
      : 'model_preference';
    const claimLevelText = {
      model_preference: '各来源偏好不同——只能讲取舍，不能讲对错',
      conditional_support: '在指定续打假设下有条件支持某选择',
      disagreement: '启发式与模型的偏好存在分歧——如实呈现分歧，不给唯一正解',
      provable_fact: '仅可证明事实（结构/张数），不足以评价优劣',
    }[claimLevel];

    points.push({
      moveNo: mv.moveNo,
      contextText: contextTextOf(mv, seatNames),
      actual,
      alternatives,
      claimLevel,
      claimLevelText,
    });
  }

  const overviewFacts: string[] = [];
  const result = record.result;
  if (result) {
    overviewFacts.push(`终局名次：${result.finishOrder.map((p, i) => `${['头游', '二游', '三游', '末游'][i]}=${seatNames[p]}`).join('、')}；${result.winnerTeam === (humanSeat % 2) ? '学生队获胜' : '对方获胜'}`);
  }
  overviewFacts.push(`学生共 ${analysis.stats.total} 手决策（无牌可跟 ${analysis.stats.forced}、候选未覆盖 ${analysis.stats.uncovered}、启发式分歧较大 ${analysis.stats.divergent}——均为描述统计）`);
  return { points, overviewFacts };
}

export { describeAction };
