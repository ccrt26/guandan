import {
  type Card, type Combo, describeCombo, legalCombos, powerClass, teammateOf, teamOf,
  type GameRecord, type GameState, type MoveRecord, RANK_NAME, SUIT_GLYPH,
} from '@gd/engine';
import { scoreCandidates, PlayMemory, decompose } from '@gd/ai';
import { canonicalize, matchAction } from './actionIdentity';
import { replay } from './replay';

/** R1-E（REVIEW2-EXEC §4.1）：
 * - 不再自动判"失误"：gap 大只是"启发式分歧较大"的筛选信号（divergent），不是判错；
 * - 实际动作未匹配到候选 → uncovered（无法比较），不罚分（best−20 已删）、不入分歧统计；
 * - 删除 S/A/B/C 评级与"失误率"，改为描述性统计。 */
export type MoveGrade = 'good' | 'ok' | 'divergent' | 'forced' | 'uncovered';

export interface MoveContext {
  moveNo: number;
  trickLeader: number;
  toBeatPlayer: number | null;
  toBeatText: string | null;
  isLead: boolean;
  handsBefore: number[];
  myHandSize: number;
  oppMinCards: number;
}

export interface TrickAction {
  player: number;
  pass: boolean;
  cards?: Card[];
  kind?: Combo['kind'];
  /** R2：完整声明（含 wildAs 代入），供统一描述器与 LLM 剧本 */
  combo?: Combo | null;
}

export interface MoveAnalysis {
  moveNo: number;
  pass: boolean;
  playedText: string;
  recommendedText: string;
  recommendedPass: boolean;
  grade: MoveGrade;
  scoreGap: number;
  tags: string[];
  note: string;
  context: MoveContext;
  /** 本手之前本轮各家动作（完整牌面，供复现与 LLM 剧本） */
  trickBefore: TrickAction[];
  /** 本手实际出的牌（含万能牌） */
  playedCards: Card[];
  /** 本手实际出牌的完整声明（R2：代入描述用；旧记录兜底重建时 wildAs 尽力恢复） */
  playedCombo: Combo | null;
  /** 引擎建议的牌 */
  recCards: Card[];
  /** 引擎建议的完整声明（R2：代入描述用） */
  recCombo: Combo | null;
  /** 本手之后紧接的一手（影响链） */
  nextMove: { player: number; pass: boolean; cards?: Card[] } | null;
}

export interface ReviewMetrics {
  actualHands: number;
  optimalHands: number;
  letMateCount: number;
  beatMateCount: number;
  beatMateWithBig: number;
  bombUsed: number;
  bombHeldToEnd: number;
  wildUsed: number;
  wildLowValue: number;
  missedFinish: number;
}

export interface ReviewAnalysis {
  humanSeat: number;
  humanTeamWon: boolean;
  humanRank: number;
  moves: MoveAnalysis[];
  /** 启发式分歧较大的手（筛选信号，不是判错；原 badMoves 更名） */
  divergentMoves: MoveAnalysis[];
  metrics: ReviewMetrics;
  /** 描述性统计（替代原 S/A/B/C 评级与失误率） */
  stats: {
    total: number;
    forced: number;
    uncovered: number;
    comparable: number;
    divergent: number;
    divergenceRate: number;
  };
}

const ANALYSIS_CAPS = {
  memory: true,
  inference: false,
  cooperation: true,
  planning: true,
  noise: 0,
  rolloutIters: 0,
};

/** 分析视角：给人类的每一步决策打分（对照引擎推荐） */
export function analyzeGame(record: GameRecord): ReviewAnalysis {
  const humanSeat = record.humanSeat ?? 0;
  const humanTeam = teamOf(humanSeat);
  const mate = teammateOf(humanSeat);
  const ctx0 = { ranks: new Set(record.levelsBefore), levels: [...record.levelsBefore] as [number, number] };
  let memory: PlayMemory | null = null;

  const moves: MoveAnalysis[] = [];
  const counters = {
    actualHands: 0, bombUsed: 0, wildUsed: 0, wildLowValue: 0,
    letMate: 0, beatMate: 0, beatMateBig: 0, missedFinish: 0,
  };

  const optimalHands = decompose(record.initialHands[humanSeat], ctx0).hands;

  let moveIdx = -1;
  for (const frame of replay(record)) {
    moveIdx += 1;
    if (!memory) memory = PlayMemory.fromStart(frame.state.ctx);
    memory.syncState(frame.state);
    const before = frame.state;

    // 先分析（用「之前」的信息），再把本帧记入记牌器
    if (frame.move.player === humanSeat) {
      const nextRaw = record.moves[moveIdx + 1] ?? null;
      const analysis = analyzeOneMove(
        record, before, frame.move, frame.combo, memory, humanSeat, mate, humanTeam, counters,
        nextRaw ? { player: nextRaw.player, pass: nextRaw.pass, cards: nextRaw.cards } : null,
        before.trickPlays.map((p) => ({
          player: p.player,
          pass: !p.combo,
          cards: p.combo?.cards,
          kind: p.combo?.kind,
          combo: p.combo ?? null,
        })),
      );
      moves.push(analysis);
    }

    for (const ev of frame.events) {
      if (ev.type === 'play') memory.recordPlay(ev.player, ev.combo);
      else if (ev.type === 'pass') memory.recordPass(ev.player, before.lastCombo);
    }
  }

  const lastHand = finalHandOf(record, humanSeat);
  let bombHeldToEnd = 0;
  if (lastHand) {
    const plan = decompose(lastHand, ctx0);
    bombHeldToEnd = plan.combos.filter((c) => c.kind === 'bomb' || c.kind === 'joker_bomb' || c.kind === 'flush').length;
  }

  const divergentMoves = moves.filter((m) => m.grade === 'divergent');
  const forcedCount = moves.filter((m) => m.grade === 'forced').length;
  const uncoveredCount = moves.filter((m) => m.grade === 'uncovered').length;
  const comparable = moves.length - forcedCount - uncoveredCount;
  const result = record.result;
  const humanRank = result ? result.finishOrder.indexOf(humanSeat) + 1 : 0;
  const humanTeamWon = result ? result.winnerTeam === humanTeam : false;

  return {
    humanSeat,
    humanTeamWon,
    humanRank,
    moves,
    divergentMoves,
    metrics: {
      actualHands: counters.actualHands,
      optimalHands,
      letMateCount: counters.letMate,
      beatMateCount: counters.beatMate,
      beatMateWithBig: counters.beatMateBig,
      bombUsed: counters.bombUsed,
      bombHeldToEnd,
      wildUsed: counters.wildUsed,
      wildLowValue: counters.wildLowValue,
      missedFinish: counters.missedFinish,
    },
    stats: {
      total: moves.length,
      forced: forcedCount,
      uncovered: uncoveredCount,
      comparable,
      divergent: divergentMoves.length,
      divergenceRate: comparable > 0 ? divergentMoves.length / comparable : 0,
    },
  };
}

function analyzeOneMove(
  record: GameRecord,
  before: GameState,
  move: MoveRecord,
  actualCombo: Combo | null,
  memory: PlayMemory,
  humanSeat: number,
  mate: number,
  humanTeam: 0 | 1,
  counters: {
    actualHands: number; bombUsed: number; wildUsed: number; wildLowValue: number;
    letMate: number; beatMate: number; beatMateBig: number; missedFinish: number;
  },
  nextMove: { player: number; pass: boolean; cards?: Card[] } | null,
  trickBefore: TrickAction[],
): MoveAnalysis {
  const hand = before.hands[humanSeat];
  const toBeat = before.lastCombo;
  const isLead = toBeat === null;
  const toBeatOwner = toBeat ? before.lastPlayer : null;
  const ownerIsMate = toBeatOwner === mate;
  const oppMinCards = Math.min(
    ...[0, 1, 2, 3]
      .filter((p) => teamOf(p) !== humanTeam && !before.finished.includes(p))
      .map((p) => before.hands[p].length),
  );

  const legal = legalCombos(before);
  const scored = scoreCandidates({
    state: before,
    seat: humanSeat,
    caps: ANALYSIS_CAPS,
    memory,
    rand: () => 0,
  });
  const best = scored[0];

  const actualPass = move.pass;
  // R2（§4.3）：与 nnAdvisor 共用的动作身份匹配器（F04/F05/F06）
  const actualAction = canonicalize(humanSeat, actualPass, actualCombo);
  const candidateActions = scored.map((s) => canonicalize(humanSeat, s.move.pass, s.combo ?? null));
  const match = matchAction(actualAction, candidateActions);
  const matched = match.index >= 0 ? scored[match.index] : null;
  const actualScore = matched?.score ?? null;
  const uncovered = match.index < 0;

  const scoreGap = actualScore === null ? 0 : Math.max(0, Math.round(best.score - actualScore));
  const recommendedPass = best.move.pass;
  const sameAsBest = match.status === 'exact' && match.index === 0
    || match.status === 'equivalent_copy' && match.index === 0;

  let grade: MoveGrade;
  if (legal.length === 0 && actualPass && !isLead) grade = 'forced';
  else if (uncovered) grade = 'uncovered';
  else if (sameAsBest) grade = 'good';
  else if (scoreGap < 8) grade = 'ok';
  else grade = 'divergent';

  // ---- 标签与说明 ----
  const tags: string[] = [];
  const notes: string[] = [];
  const isBigCard = (c: Combo | null): boolean => {
    if (!c) return false;
    return powerClass(c) >= 1 || c.keyRank >= 20;
  };

  if (!actualPass && actualCombo) {
    counters.actualHands += 1;
    if (actualCombo.kind === 'bomb') counters.bombUsed += 1;
    if (actualCombo.wildAs.length > 0) {
      counters.wildUsed += 1;
      if (grade === 'divergent') {
        counters.wildLowValue += 1;
        tags.push('wild_value');
        notes.push('万能牌（红心级牌）花在了启发式评分较低的一手上（偏好依据，非判错）');
      }
    }
    if (ownerIsMate) {
      counters.beatMate += 1;
      if (isBigCard(actualCombo)) {
        counters.beatMateBig += 1;
        tags.push('yield_to_mate', 'keep_big_for_opp');
        notes.push('这轮是队友在发力，你的大牌应该留给拦对手');
      }
    }
    if (grade !== 'good' && grade !== 'uncovered' && powerClass(actualCombo) === 0) {
      const plan = decompose(hand, before.ctx);
      const bombInPlan = plan.combos.find((pc) => pc.kind === 'bomb' || pc.kind === 'joker_bomb');
      if (bombInPlan) {
        const shared = actualCombo.cards.some((c) => bombInPlan.cards.some((b) => b.id === c.id));
        if (shared) {
          tags.push('no_break_bomb');
          notes.push(`从炸弹里拆牌跟牌，破坏了 ${describeCombo(bombInPlan)}`);
        }
      }
    }
  } else if (actualPass) {
    if (ownerIsMate) counters.letMate += 1;
    const finisher = legal.find((c) => c.size === hand.length);
    if (finisher && grade === 'divergent') {
      counters.missedFinish += 1;
      tags.push('hand_plan');
      notes.push(`这轮存在一手出完的合法动作（${describeCombo(finisher)}），本手选择了让牌`);
    }
  }

  if (grade === 'divergent' && !actualPass && actualCombo && isBigCard(actualCombo) && !ownerIsMate && !isLead) {
    tags.push('minimal_beat');
    notes.push('压得过大（启发式偏好）：小一号的牌就能赢下这轮，大牌力被浪费');
  }
  if (grade === 'divergent' && isLead && oppMinCards <= 2 && actualCombo && actualCombo.kind === 'single' && actualCombo.keyRank < 20) {
    tags.push('endgame_lock');
    notes.push('对手报牌了，领小单等于送游；应领大单或改领对子');
  }
  if (grade === 'divergent' && !actualPass && actualCombo && actualCombo.kind === 'bomb' && oppMinCards > 6) {
    tags.push('bomb_timing');
    notes.push('对手离走还远，这颗炸弹炸早了');
  }
  if (grade === 'divergent' && actualPass && !isLead && toBeatOwner !== null && teamOf(toBeatOwner) !== humanTeam && scored.length > 1 && !best.move.pass) {
    tags.push('card_power');
  }

  return {
    moveNo: move.moveNo,
    pass: actualPass,
    playedText: actualPass ? '不要' : actualCombo ? describeCombo(actualCombo) : '?',
    recommendedText: best.combo ? describeCombo(best.combo) : '不要',
    recommendedPass,
    grade,
    scoreGap,
    tags: [...new Set(tags)],
    note: notes.join('；') || defaultNote(grade, actualPass, best),
    trickBefore,
    playedCards: move.cards ?? [],
    playedCombo: actualCombo,
    recCards: best.combo?.cards ?? [],
    recCombo: best.combo ?? null,
    nextMove,
    context: {
      moveNo: move.moveNo,
      trickLeader: before.leader,
      toBeatPlayer: toBeatOwner,
      toBeatText: toBeat ? describeCombo(toBeat) : null,
      isLead,
      handsBefore: before.hands.map((h) => h.length),
      myHandSize: hand.length,
      oppMinCards,
    },
  };
}

function defaultNote(grade: MoveGrade, pass: boolean, best: { move: { pass: boolean }; combo: Combo | null }): string {
  if (grade === 'good') return pass ? '与启发式首选一致（让牌）' : '与启发式首选一致';
  if (grade === 'forced') return '无牌可跟，只能让';
  if (grade === 'uncovered') return '实际出法不在启发式候选中，无法比较（不判对错）';
  if (grade === 'ok') return '与启发式首选略有分歧，差距不大';
  return pass
    ? '与启发式分歧较大（让牌 vs 建议压一手）——筛选信号，非判错'
    : `与启发式分歧较大（启发式更偏好 ${best.combo ? describeCombo(best.combo) : '不要'}）——筛选信号，非判错`;
}

/** 若该玩家是末游（未出完），返回终局剩牌 */
function finalHandOf(record: GameRecord, seat: number) {
  if (!record.result) return null;
  if (record.result.finishOrder[3] !== seat) return null;
  const playedIds = new Set(
    record.moves.filter((m) => m.player === seat && !m.pass).flatMap((m) => m.cards?.map((c) => c.id) ?? []),
  );
  return record.initialHands[seat].filter((c) => !playedIds.has(c.id));
}

export function gradeIcon(grade: MoveGrade): string {
  switch (grade) {
    case 'good': return '✅';
    case 'ok': return '🟡';
    case 'divergent': return '🟠';
    case 'forced': return '⏭️';
    case 'uncovered': return '❓';
  }
}

export function levelName(levels: [number, number]): string {
  return `我方打${RANK_NAME[levels[0]]} / 对方打${RANK_NAME[levels[1]]}`;
}

