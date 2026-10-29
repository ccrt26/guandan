/**
 * packages/review/src/teamReview.ts — REVIEW5 T1：复盘单位改成队伍关键事件。
 * 缺陷背景（审计 E04）：analyzer 默认只分析 humanSeat——队友的接管/送牌/炸弹不进入
 * 被分析对象；用户"队友刚才为什么炸我"无法得到该 AI 决策的分析。
 *
 * 本模块：
 *  - actorSeat/viewerSeat 分离（评价 AI 决策用其当时合法可见信息；给用户讲解用 viewer 视角）；
 *  - 四席选点（每副最多 3 个重点）：优先 同队控制权转移/关键资源消耗/接近走完/大分歧；
 *  - 每个重点输出：队伍目标（程序判定）、已知与未知、实际+最多两个替代、资源代价、
 *    条件路线、改计划触发器；
 *  - 一键导出事故包（record + 政策身份 + actor/actionId + 候选排名——追责最小事实）。
 */
import { describeCombo, teamOf, teammateOf, type GameRecord, type GameState } from '@gd/engine';
import { analyzeGame, type MoveAnalysis, type ReviewAnalysis } from './analyzer';
import { replay } from './replay';
import { fnvId } from './decisionReview';

export interface TeamKeyEvent {
  moveNo: number;
  actorSeat: number;
  viewerSeat: number;
  /** 事件类别（选点依据，程序判定） */
  category: 'mate_control_takeover' | 'mate_bomb_over_mate' | 'resource_spend' | 'near_finish' | 'big_divergence';
  /** 当时队伍目标（程序判定，公开信息口径） */
  teamGoal: string;
  /** 已知/未知（viewer 视角声明） */
  knownUnknown: { actorHand: string; mateHand: 'unknown-to-viewer'; note: string };
  actual: { actionId: string; text: string };
  alternatives: Array<{ actionId: string; text: string; resourceCost: string }>;
  actualResourceCost: string;
  /** 条件路线（程序模板：下一步控制权推断） */
  conditionalNext: string;
  /** 什么新信息会改变建议（触发器，程序模板） */
  replanTriggers: string[];
}

export interface TeamReviewResult {
  recordId: string;
  viewerSeat: number;
  events: TeamKeyEvent[];
  /** 四席逐席统计（四席任何一席作为视角都能工作） */
  perSeat: Array<{ seat: number; moves: number; divergent: number }>;
}

/** 选点：四席全部动作中挑最多 maxEvents 个队伍关键事件 */
export function selectTeamKeyEvents(
  record: GameRecord, perSeat: Map<number, MoveAnalysis[]>, maxEvents = 3,
): Array<{ moveNo: number; actorSeat: number; category: TeamKeyEvent['category']; move: MoveAnalysis }> {
  type Cand = { moveNo: number; actorSeat: number; category: TeamKeyEvent['category']; move: MoveAnalysis; score: number };
  const cands: Cand[] = [];
  const viewerSeat = record.humanSeat ?? 0;
  const mate = teammateOf(viewerSeat);
  for (const [seat, moves] of perSeat) {
    for (const m of moves) {
      const ctx = m.context;
      const toBeatIsMate = ctx.toBeatPlayer != null && teamOf(ctx.toBeatPlayer) === teamOf(seat) && ctx.toBeatPlayer !== seat;
      if (m.playedCombo && toBeatIsMate && (m.playedCombo.kind === 'bomb' || m.playedCombo.kind === 'joker_bomb')) {
        cands.push({ moveNo: m.moveNo, actorSeat: seat, category: 'mate_bomb_over_mate', move: m, score: 100 });
        continue;
      }
      if (m.playedCombo && toBeatIsMate && (m.playedCombo.kind === 'bomb' || m.playedCombo.kind === 'joker_bomb' || m.playedCombo.keyRank >= 20)) {
        cands.push({ moveNo: m.moveNo, actorSeat: seat, category: 'mate_control_takeover', move: m, score: 80 });
        continue;
      }
      if (m.playedCombo && (m.playedCombo.kind === 'bomb' || m.playedCombo.kind === 'joker_bomb' || m.playedCombo.kind === 'flush')) {
        cands.push({ moveNo: m.moveNo, actorSeat: seat, category: 'resource_spend', move: m, score: 60 });
        continue;
      }
      if (ctx.handsBefore.filter((_, i) => teamOf(i) !== teamOf(seat)).some((n) => n > 0 && n <= 4)
        || ctx.handsBefore[teammateOf(seat)] <= 4) {
        cands.push({ moveNo: m.moveNo, actorSeat: seat, category: 'near_finish', move: m, score: 40 });
        continue;
      }
      if (m.grade === 'divergent' && m.scoreGap >= 30) {
        cands.push({ moveNo: m.moveNo, actorSeat: seat, category: 'big_divergence', move: m, score: 20 });
      }
    }
  }
  void mate;
  cands.sort((a, b) => b.score - a.score || a.moveNo - b.moveNo);
  const picked: Cand[] = [];
  for (const c of cands) {
    if (picked.length >= maxEvents) break;
    if (picked.some((p) => p.actorSeat === c.actorSeat && p.moveNo === c.moveNo)) continue;
    picked.push(c);
  }
  return picked.map((p) => ({ moveNo: p.moveNo, actorSeat: p.actorSeat, category: p.category, move: p.move }));
}

/** 队伍目标（程序判定，只用当时公开信息：各家剩牌/名次/控制权） */
function teamGoalOf(state: GameState, actorSeat: number): string {
  const mate = teammateOf(actorSeat);
  const mateLeft = state.hands[mate].length;
  const meLeft = state.hands[actorSeat].length;
  const oppMin = Math.min(...[0, 1, 2, 3].filter((s) => teamOf(s) !== teamOf(actorSeat)).map((s) => state.hands[s].length));
  if (state.finished.includes(mate)) return '队友已走完：保自己名次与拦截对手';
  if (mateLeft <= 4 && mateLeft < meLeft) return `队友剩 ${mateLeft} 张更接近走完：优先为队友让出控制权/送牌`;
  if (oppMin <= 4) return `对手只剩 ${oppMin} 张：优先拦截对手收尾`;
  if (meLeft <= 6) return '自己接近走完：寻找连续出牌路线';
  return '常规局面：控制权与资源管理';
}

/** 四席复盘主入口：任何 viewerSeat 可用；选点含四席（含队友动作） */
export function buildTeamReview(record: GameRecord, opts: { viewerSeat?: number; maxEvents?: number } = {}): TeamReviewResult {
  const viewerSeat = opts.viewerSeat ?? record.humanSeat ?? 0;
  const maxEvents = opts.maxEvents ?? 3;
  // 四席逐席分析（analyzer 的单席分析推广到全部席位）
  const perSeat = new Map<number, MoveAnalysis[]>();
  const perSeatStats: TeamReviewResult['perSeat'] = [];
  for (let seat = 0; seat < 4; seat++) {
    const rec: GameRecord = { ...record, humanSeat: seat };
    const a: ReviewAnalysis = analyzeGame(rec);
    perSeat.set(seat, a.moves);
    perSeatStats.push({ seat, moves: a.moves.length, divergent: a.divergentMoves.length });
  }
  const picked = selectTeamKeyEvents(record, perSeat, maxEvents);

  // 回放定位每个选中事件的决策前状态（actor 视角）
  const frames = [...replay(record)];
  const events: TeamKeyEvent[] = [];
  for (const p of picked) {
    const frame = frames.find((f) => f.move.moveNo === p.moveNo && f.move.player === p.actorSeat);
    if (!frame) continue;
    const state = frame.state;
    const move = p.move;
    const actualCombo = move.playedCombo;
    const toBeat = state.lastCombo;
    const isTakeover = toBeat != null && state.lastPlayer != null && teamOf(state.lastPlayer) === teamOf(p.actorSeat) && state.lastPlayer !== p.actorSeat;
    const alts: TeamKeyEvent['alternatives'] = [];
    if (move.pass) alts.push({ actionId: `m${p.moveNo}:pass`, text: '不要（让牌）', resourceCost: '不消耗资源' });
    if (move.recCombo && (actualCombo == null || move.recCombo.cards.length !== (move.playedCards?.length ?? 0) || move.recCombo.keyRank !== actualCombo.keyRank)) {
      alts.push({ actionId: `m${p.moveNo}:rec`, text: describeCombo(move.recCombo), resourceCost: `消耗 ${move.recCombo.cards.length} 张${move.recCombo.kind === 'bomb' ? '（炸弹）' : ''}` });
    }
    if (!move.pass) alts.push({ actionId: `m${p.moveNo}:pass`, text: '不要（让牌）', resourceCost: '不消耗资源' });
    events.push({
      moveNo: p.moveNo,
      actorSeat: p.actorSeat,
      viewerSeat,
      category: p.category,
      teamGoal: teamGoalOf(state, p.actorSeat),
      knownUnknown: {
        actorHand: p.actorSeat === viewerSeat ? 'actor-visible' : 'actor-visible（行动者自己可见；观看者事后才知道）',
        mateHand: 'unknown-to-viewer',
        note: `评价该 AI 决策使用其当时合法可见信息（自家手牌+公开历史）；给用户讲解仅用用户当时可见信息，展示队友余手须注明用户当时不知道`,
      },
      actual: {
        actionId: `m${p.moveNo}:${move.pass ? 'pass' : (actualCombo ? `${actualCombo.kind}:${actualCombo.mainRank}:${(move.playedCards ?? []).map((c) => c.id).sort((a, b) => a - b).join('.')}` : '?')}`,
        text: move.playedText,
      },
      alternatives: alts.slice(0, 2),
      actualResourceCost: move.pass ? '不消耗资源' : `消耗 ${(move.playedCards ?? []).length} 张${actualCombo?.kind === 'bomb' || actualCombo?.kind === 'joker_bomb' ? '（炸弹）' : ''}`,
      conditionalNext: isTakeover
        ? `接管后控制权转移到 ${p.actorSeat} 号位（${teamOf(p.actorSeat) === teamOf(viewerSeat) ? '我方' : '对方'}）；若让牌，控制权留在原出牌方`
        : state.lastCombo == null ? '领出方决定下一轮方向' : '压过后进入下一家响应',
      replanTriggers: [
        '对手剩牌 ≤ 4（公开信息）→ 拦截优先级上升',
        '队友剩牌 ≤ 4 → 让牌/送牌优先级上升',
        '关键炸弹/同花顺资源被消耗 → 后续接管能力下降',
      ],
    });
  }
  return {
    recordId: record.id ?? `rec-${fnvId(JSON.stringify(record.moves)).slice(0, 12)}`,
    viewerSeat,
    events,
    perSeat: perSeatStats,
  };
}

/** 一键导出事故包（追责最小事实；不要求上传训练向量） */
export function exportIncidentPackage(
  record: GameRecord, event: TeamKeyEvent, policyIdentity: Record<string, unknown>,
): Record<string, unknown> {
  return {
    packageType: 'review5-incident-v1',
    at: new Date().toISOString(),
    record: {
      id: record.id, moves: record.moves, initialHands: record.initialHands,
      levelsBefore: record.levelsBefore, ruleOpts: record.ruleOpts, result: record.result,
      humanSeat: record.humanSeat,
    },
    policyIdentity,
    event: {
      moveNo: event.moveNo, actorSeat: event.actorSeat, viewerSeat: event.viewerSeat,
      category: event.category, actionId: event.actual.actionId,
      teamGoal: event.teamGoal, alternatives: event.alternatives,
    },
    note: '后续可追责的最小事实：完整记录+政策身份+actor/actionId+目标与替代；出牌政策与事前建议的输入须另经可见性过滤',
  };
}
