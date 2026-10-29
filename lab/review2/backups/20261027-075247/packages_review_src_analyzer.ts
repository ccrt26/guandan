import {
  type Card, type Combo, comboKey, describeCombo, legalCombos, powerClass, teammateOf, teamOf,
  type GameRecord, type GameState, type MoveRecord, RANK_NAME, SUIT_GLYPH,
} from '@gd/engine';
import { scoreCandidates, PlayMemory, decompose } from '@gd/ai';
import { replay } from './replay';

export type MoveGrade = 'good' | 'ok' | 'bad' | 'forced';

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
  /** 引擎建议的牌 */
  recCards: Card[];
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
  badMoves: MoveAnalysis[];
  metrics: ReviewMetrics;
  overall: 'S' | 'A' | 'B' | 'C';
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

  const badMoves = moves.filter((m) => m.grade === 'bad');
  const result = record.result;
  const humanRank = result ? result.finishOrder.indexOf(humanSeat) + 1 : 0;
  const humanTeamWon = result ? result.winnerTeam === humanTeam : false;
  const badRate = moves.length ? badMoves.length / moves.length : 0;
  const overall: 'S' | 'A' | 'B' | 'C' =
    badRate < 0.08 && humanTeamWon ? 'S'
    : badRate < 0.15 ? 'A'
    : badRate < 0.28 ? 'B'
    : 'C';

  return {
    humanSeat,
    humanTeamWon,
    humanRank,
    moves,
    badMoves,
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
    overall,
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
  let actualScore = -Infinity;
  if (actualPass) {
    actualScore = scored.find((s) => s.move.pass)?.score ?? 0;
  } else if (actualCombo) {
    const key = comboKey(actualCombo);
    const entry = scored.find((s) => !s.move.pass && s.combo && comboKey(s.combo) === key);
    actualScore = entry?.score ?? best.score - 20;
  }

  const scoreGap = Math.max(0, Math.round(best.score - actualScore));
  const recommendedPass = best.move.pass;
  const sameAsBest = actualPass
    ? recommendedPass
    : !recommendedPass && !!actualCombo && !!best.combo && comboKey(actualCombo) === comboKey(best.combo);

  let grade: MoveGrade;
  if (legal.length === 0 && actualPass && !isLead) grade = 'forced';
  else if (sameAsBest) grade = 'good';
  else if (scoreGap < 8) grade = 'ok';
  else grade = 'bad';

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
      if (grade === 'bad') {
        counters.wildLowValue += 1;
        tags.push('wild_value');
        notes.push('万能牌（红心级牌）花在了低价值的一手上');
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
    if (grade !== 'good' && powerClass(actualCombo) === 0) {
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
    if (finisher && grade === 'bad') {
      counters.missedFinish += 1;
      tags.push('hand_plan');
      notes.push(`这轮可以直接出 ${describeCombo(finisher)} 清牌走人，你却让了`);
    }
  }

  if (grade === 'bad' && !actualPass && actualCombo && isBigCard(actualCombo) && !ownerIsMate && !isLead) {
    tags.push('minimal_beat');
    notes.push('压得过大：小一号的牌就能赢下这轮，大牌力被浪费');
  }
  if (grade === 'bad' && isLead && oppMinCards <= 2 && actualCombo && actualCombo.kind === 'single' && actualCombo.keyRank < 20) {
    tags.push('endgame_lock');
    notes.push('对手报牌了，领小单等于送游；应领大单或改领对子');
  }
  if (grade === 'bad' && !actualPass && actualCombo && actualCombo.kind === 'bomb' && oppMinCards > 6) {
    tags.push('bomb_timing');
    notes.push('对手离走还远，这颗炸弹炸早了');
  }
  if (grade === 'bad' && actualPass && !isLead && toBeatOwner !== null && teamOf(toBeatOwner) !== humanTeam && scored.length > 1 && !best.move.pass) {
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
    recCards: best.combo?.cards ?? [],
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
  if (grade === 'good') return pass ? '让得对' : '打得对';
  if (grade === 'forced') return '无牌可跟，只能让';
  if (grade === 'ok') return '可接受，但有更优选择';
  return pass ? '这轮不该让：建议压一手夺回牌权' : `建议改打 ${best.combo ? describeCombo(best.combo) : '不要'}`;
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
    case 'bad': return '❌';
    case 'forced': return '⏭️';
  }
}

export function levelName(levels: [number, number]): string {
  return `我方打${RANK_NAME[levels[0]]} / 对方打${RANK_NAME[levels[1]]}`;
}

