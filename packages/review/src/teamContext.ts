/**
 * packages/review/src/teamContext.ts — D2（REVIEW4-EXEC §5.2）：队伍教学输入。
 * 用当时玩家可见信息生成 TeamContext：局势（级牌/领牌/轮转/四席张数/已知归属）、
 * 本人可证明资源（保留炸弹/同花顺/接手牌、参考拆分）、有条件的 publicPlan（依据+
 * 公开触发条件）、时间线教学点。事实全部带 observedAtMove/visibility/sourceEventId；
 * 事后信息必须标 retrospective，禁止混入当时应知事实。未知队友手牌不进 publicPlan。
 */
import {
  type Card, type Combo, type GameRecord, type GameState, enumerateCombos,
  makeLevelCtx, type LevelCtx, type Suit, SUIT_GLYPH, RANK_NAME,
} from '@gd/engine';
import { decompose } from '@gd/ai';
import { replay } from './replay';

export type Visibility = 'public' | 'self_private' | 'teammate_private' | 'retrospective';

export interface TeamFact {
  factId: string;
  text: string;
  observedAtMove: number;
  visibility: Visibility;
  sourceEventId: string;
  /** 推导输入（其他 factId 或事件号；直接观测=空） */
  derivedFrom: string[];
}

export interface TeamContext {
  decisionId: string;
  actorSeat: number;
  actorTeam: 0 | 1;
  ruleContext: {
    levelMode: string;
    stageTeam: 0 | 1 | null;
    levelsBefore: [number, number];
    effectiveLevelRank: number | null;
    wildCardLabel: string | null;
  };
  ownHand: string[];
  publicPlayedCounts: Record<string, number>; // 牙牌标签→已出张数（公开累计）
  seatCounts: number[];                       // 四席剩牌
  currentLead: { leader: number; lastPlayer: number; lastComboText: string | null };
  knownVisibleTransfers: Array<{ kind: 'tribute' | 'return'; from: number; to: number; card: string; atMove: number }>;
  visibleHistoryComplete: boolean;
  /** 本人可证明资源（程序提取，参考拆分非最优；共享牌不重复计数） */
  provableResources: {
    referenceSplit: Array<{ text: string; usesWilds: number }>;
    bombs: string[];
    flushes: string[];
    catchers: string[]; // 可接手的高牌力牌（>A 或炸弹）
  };
  /** 有条件的队伍计划（程序模板；每条带依据与公开触发条件） */
  publicPlan: Array<{ planId: string; goal: string; basisFactIds: string[]; triggerConditions: string[] }>;
  /** 一副牌时间线上的 2-3 个关键节点（事前视角） */
  timelinePoints: Array<{ atMove: number; kind: 'control_shift' | 'mate_close' | 'opp_close' | 'resource_spent' | 'user_marked' | 'nn_h_divergence'; note: string; factIds: string[] }>;
  userIntent?: { text: string; note: string };
  facts: Record<string, TeamFact>;
  /** 该决策时刻的 GameState 快照（供 D4 已知约束采样） */
  stateSnapshot: { hands: string[][]; playedIds: number[]; finished: number[] };
}

const cardLabel = (c: Card): string => `${SUIT_GLYPH[c.suit] ?? ''}${RANK_NAME[c.rank] ?? String(c.rank)}`;

/** 从记录构建指定决策时刻的 TeamContext（只用当时可见信息） */
export function buildTeamContext(record: GameRecord, moveNo: number, opts: { userIntent?: string } = {}): TeamContext | null {
  const seat = record.humanSeat ?? 0;
  const team = (seat & 1) as 0 | 1;
  let stateAt: GameState | null = null;
  let playedBefore: Combo[] = [];

  for (const frame of replay(record)) {
    if (frame.move.moveNo >= moveNo) { stateAt = frame.state; break; }
    if (!frame.move.pass && frame.combo) playedBefore.push(frame.combo);
  }
  if (!stateAt) return null;

  const levelMode = record.ruleOpts.levelMode ?? 'both';
  const stageTeam = record.stageTeam ?? null;
  let effectiveLevelRank: number | null = null;
  if (levelMode === 'stage' && stageTeam != null) effectiveLevelRank = record.levelsBefore[stageTeam];
  else if (levelMode === 'both') effectiveLevelRank = null; // 双方级数都是级牌（历史口径）
  const ctx: LevelCtx = makeLevelCtx(record.levelsBefore, 'stage', (stageTeam ?? 0) as 0 | 1);

  const facts: Record<string, TeamFact> = {};
  const pub: Record<string, number> = {};
  for (const combo of playedBefore) {
    for (const c of combo.cards) pub[cardLabel(c)] = (pub[cardLabel(c)] ?? 0) + 1;
  }
  const ownHand = [...stateAt.hands[seat]].map(cardLabel);

  // 事实表（全部事前可见）
  const f = (id: string, text: string, visibility: Visibility, src = 'replay-prefix'): void => {
    facts[id] = { factId: id, text, observedAtMove: moveNo, visibility, sourceEventId: src, derivedFrom: [] };
  };
  f('tc-rule', `级牌口径=${levelMode}${stageTeam != null ? `，台上=${stageTeam === team ? '我方' : '对方'}` : ''}；双方级数 ${record.levelsBefore.join('/')}`, 'public', 'record.meta');
  if (effectiveLevelRank != null) {
    f('tc-wild', `本局级牌为 ${RANK_NAME[effectiveLevelRank]}，红心${RANK_NAME[effectiveLevelRank]} 为逢人配（万能牌）`, 'public', 'rule:def');
  }
  f('tc-counts', `四席剩牌：${stateAt.hands.map((h, i) => `${['南', '东', '北', '西'][i]}${h.length}`).join('、')}`, 'public');
  f('tc-lead', stateAt.lastCombo
    ? `当前要压的是${['南', '东', '北', '西'][stateAt.lastPlayer]}家的 ${stateAt.lastCombo.cards.map(cardLabel).join(' ')}；本轮领出者${['南', '东', '北', '西'][stateAt.leader]}`
    : `你（${['南', '东', '北', '西'][seat]}）领出此轮`, 'public');
  f('tc-hand', `你的手牌（${ownHand.length} 张）：${ownHand.join(' ')}`, 'self_private');

  // 已知归属（贡还公开流转；旧记录缺字段=缺失，不伪造）
  const tributes = record.tributes ?? [];
  if (tributes.length > 0) {
    f('tc-transfers', `已知公开归属转移：${tributes.map((t) => `${['南', '东', '北', '西'][t.from]}→${['南', '东', '北', '西'][t.to]} ${t.kind === 'tribute' ? '贡' : '还'}${cardLabel(t.card)}`).join('；')}（出牌后从持有下界扣减）`, 'public', 'record.tributes');
  } else {
    f('tc-transfers-missing', record.schemaVersion != null && record.tributes === undefined
      ? '本局记录未存贡还流转（旧记录）：已知归属信息缺失，信息集采样按探索性演示降级'
      : '本局无进贡还贡流转（首局或无交换）', 'public', 'record.tributes');
  }

  // 本人可证明资源：参考拆分（decompose 互不重叠分组）
  const plan = decompose(stateAt.hands[seat], ctx);
  const referenceSplit = plan.combos.map((c) => ({
    text: `${c.kind === 'flush' ? `同花顺(${SUIT_GLYPH[c.suit as Suit]})` : c.kind} ${c.cards.map(cardLabel).join(' ')}${c.wildAs.length ? `（含万能代入 ${c.wildAs.length}）` : ''}`,
    usesWilds: c.wildAs.length,
  }));
  const all = enumerateCombos(stateAt.hands[seat], ctx, record.ruleOpts);
  const bombs = all.filter((c) => c.kind === 'bomb' || c.kind === 'joker_bomb').map((c) => c.cards.map(cardLabel).join(' '));
  const flushes = all.filter((c) => c.kind === 'flush').map((c) => `${SUIT_GLYPH[c.suit as Suit]} ${c.cards.map(cardLabel).join(' ')}`);
  const catchers = all.filter((c) => c.keyRank >= 22 || (c.kind === 'bomb' || c.kind === 'joker_bomb'))
    .slice(0, 8).map((c) => c.cards.map(cardLabel).join(' '));
  f('tc-resource', `可保留结构（参考拆分 ${plan.hands} 手，非最优证明）：${referenceSplit.map((r) => r.text).join('｜')}`, 'self_private', 'derived:decompose');

  // publicPlan：有条件建议（模板化，依据+触发条件；不含未知牌推断）
  const oppMin = Math.min(...[0, 1, 2, 3].filter((p) => (p & 1) !== team).map((p) => stateAt.hands[p].length));
  const mateLen = stateAt.hands[(seat + 2) & 3].length;
  const publicPlan: TeamContext['publicPlan'] = [];
  if (stateAt.lastCombo == null) {
    publicPlan.push({
      planId: 'lead- tempo', goal: '领出时争夺出牌权：优先打出参考拆分中的低牌组，保留炸弹/同花顺整组',
      basisFactIds: ['tc-resource', 'tc-hand'], triggerConditions: ['对手任一家剩牌≤4 → 改为出最高牌力压制收尾', '队友剩牌≤4 且本轮无对手接手 → 可出队友能压的组让队友走'],
    });
  }
  if (oppMin <= 4) {
    publicPlan.push({
      planId: 'block-finish', goal: '对手接近走完：用接手牌（炸弹/大于A）夺回出牌权，阻止对手收尾',
      basisFactIds: ['tc-counts'], triggerConditions: ['对手出完一张即收尾 → 立即接管', '我方无接手牌 → 让队友接手（队友是否有能力属未知）'],
    });
  }
  if (mateLen <= 4) {
    publicPlan.push({
      planId: 'support-mate', goal: '队友接近走完：让队友保留出牌轮，出队友能压过的中小牌组',
      basisFactIds: ['tc-counts'], triggerConditions: ['对手接管 → 转为阻止对手', '队友剩 1 张 → 出单张让队友接'],
    });
  }
  publicPlan.push({
    planId: 'default', goal: '默认：按参考拆分组递进出牌，万能牌整局保留到关键接管点',
    basisFactIds: ['tc-resource'], triggerConditions: ['上述任一触发条件出现 → 改按对应计划执行'],
  });

  // 时间线关键节点（事前可见口径：控制权转移/接近走完/关键资源耗用）
  const timelinePoints: TeamContext['timelinePoints'] = [];
  let lastLeader = -1;
  let played = 0;
  for (const frame of replay(record)) {
    played += 1;
    if (frame.move.moveNo >= moveNo) break;
    if (frame.state.leader !== lastLeader) {
      if (lastLeader >= 0 && ((frame.state.leader & 1) !== team) && (lastLeader & 1) === team) {
        timelinePoints.push({ atMove: frame.move.moveNo, kind: 'control_shift', note: `出牌权从我方转到对方（${['南', '东', '北', '西'][frame.state.leader]}家领出）`, factIds: ['tc-lead'] });
      }
      lastLeader = frame.state.leader;
    }
  }

  return {
    decisionId: `${record.id ?? 'rec'}#m${moveNo}`,
    actorSeat: seat,
    actorTeam: team,
    ruleContext: { levelMode, stageTeam, levelsBefore: [...record.levelsBefore] as [number, number], effectiveLevelRank, wildCardLabel: effectiveLevelRank != null ? `♥${RANK_NAME[effectiveLevelRank]}` : null },
    ownHand,
    publicPlayedCounts: pub,
    seatCounts: stateAt.hands.map((h) => h.length),
    currentLead: {
      leader: stateAt.leader,
      lastPlayer: stateAt.lastPlayer,
      lastComboText: stateAt.lastCombo ? stateAt.lastCombo.cards.map(cardLabel).join(' ') : null,
    },
    knownVisibleTransfers: tributes.map((t) => ({ ...t, card: cardLabel(t.card) })),
    visibleHistoryComplete: true,
    provableResources: { referenceSplit, bombs: [...new Set(bombs)], flushes: [...new Set(flushes)], catchers: [...new Set(catchers)] },
    publicPlan,
    timelinePoints: timelinePoints.slice(0, 3),
    userIntent: opts.userIntent != null ? { text: opts.userIntent, note: '用户自述意图：与当时信息是否相容由分析判定，不自动肯定' } : undefined,
    facts,
    stateSnapshot: {
      hands: stateAt.hands.map((h) => h.map(cardLabel)),
      playedIds: playedBefore.flatMap((c) => c.cards.map((x) => x.id)),
      finished: [...stateAt.finished],
    },
  };
}
