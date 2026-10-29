import { canPass, isWild, RANK_NAME, cardLabel, type Card, type Combo, type GameState } from '@gd/engine';
import type { MatchController } from '../../game/controller';

/**
 * 整页 Stage 的只读 view model（docs/状态与业务接入.md 的映射建议落地版）。
 * code 只是 54 张牌面的资源标识，instanceId 才是 108 张游戏实体的唯一身份
 * （双副牌重复 8S/9H/2C 各自独立）。牌型合法性 / 能否过牌 / 轮转 / 抗贡
 * 一律沿用引擎判断，这里只做翻译。
 * 选牌属 UI 状态：由 TablePage 持有并通过 ui 参数传入，不写进 controller。
 */

export type CardCode = string; // 54 unique faces: A,2..10,J,Q,K + S/H/C/D, plus BJ/RJ

export interface CardItem {
  instanceId: string;
  code: CardCode;
  wild: boolean;
}

export interface PlayedVM {
  status: 'none' | 'pass' | 'cards';
  cards: CardItem[];
}

export interface PlayerVM {
  seat: 'north' | 'west' | 'east';
  name: string;
  role: 'teammate' | 'opponent';
  remaining: number;
  /** 名次（0=头游…），未完赛为 null */
  rankIdx: number | null;
}

export interface StageUiState {
  /** 人类座位当前选中的卡牌实体 id（引擎 Card.id，非牌面 code） */
  selection: Set<number>;
  /** 选中牌经引擎校验后的可出牌型（null=不可出/非我回合） */
  validCombo: Combo | null;
  /** 还贡阶段已选中的可还牌 */
  returnCard: { card: Card; to: number } | null;
}

export interface StageVM {
  levels: { own: string; other: string };
  wildRule: string;
  status: string;
  notice: { visible: boolean; text: string } | null;
  players: PlayerVM[];
  passes: { north: boolean; west: boolean; east: boolean; self: boolean };
  playedEast: PlayedVM;
  playedSelf: PlayedVM;
  /** 北/西家出牌扩展位（批准图未定义出牌区，真实对局需要） */
  playedNorth: PlayedVM;
  playedWest: PlayedVM;
  hand: CardItem[];
  selectable: boolean;
  selectedIds: string[];
  turnActive: boolean;
  actions: {
    message: string;
    canPass: boolean;
    canHint: boolean;
    canPlay: boolean;
    playLabel: string;
  };
}

/** Card → 54 牌面 code（资源标识，不是实体 ID） */
export function toCode(card: Card): CardCode {
  if (card.suit === 'J') return card.rank === 17 ? 'RJ' : 'BJ';
  return `${RANK_NAME[card.rank]}${card.suit}`;
}

export function cardItem(card: Card, ctx: GameState['ctx']): CardItem {
  return { instanceId: `c${card.id}`, code: toCode(card), wild: isWild(card, ctx) };
}

/** 出牌区展示顺序：万能牌按代入点数、A 作 1 的序列 A 排最前（与既有 ComboCards 同口径） */
export function comboDisplayCards(combo: Combo): Card[] {
  const wilds = new Map(combo.wildAs.map((w) => [w.cardId, w.asRank]));
  const aceLow =
    (combo.kind === 'straight' || combo.kind === 'flush' || combo.kind === 'pair_seq' || combo.kind === 'trio_seq') &&
    combo.cards.some((c) => c.rank === 14) &&
    combo.mainRank < 14;
  return [...combo.cards].sort((a, b) => {
    const ra = wilds.get(a.id) ?? a.rank;
    const rb = wilds.get(b.id) ?? b.rank;
    const ka = aceLow && ra === 14 ? 0 : ra;
    const kb = aceLow && rb === 14 ? 0 : rb;
    return ka - kb || a.suit.localeCompare(b.suit);
  });
}

const SEAT_DISPLAY = { north: '队友', west: '西家', east: '东家', self: '你' } as const;
const HUMAN_SEAT = 0;

/** 引擎座位 → 显示用座位键。0=你(南)，1=东家，2=队友(北)，3=西家；0 不能落进 east。 */
function seatName(seat: number): 'north' | 'west' | 'east' | 'self' {
  return seat === 2 ? 'north' : seat === 3 ? 'west' : seat === 0 ? 'self' : 'east';
}

function played(controller: MatchController, ctx: GameState['ctx'], seat: number): PlayedVM {
  const item = controller.tableCombos[seat];
  if (item === null) return { status: 'none', cards: [] };
  if (item === 'pass') return { status: 'pass', cards: [] };
  return { status: 'cards', cards: comboDisplayCards(item).map((c) => cardItem(c, ctx)) };
}

/** controller 快照 + UI 选牌状态 → StageVM（还贡 / 神经回退等真实业务状态一并翻译） */
export function buildStageVM(controller: MatchController, state: GameState, ui: StageUiState): StageVM {
  const ctx = state.ctx;
  const humanTurn = controller.humanTurn;
  const pendingReturn = state.pendingReturns[0] ?? null;
  const myReturn = pendingReturn !== null && pendingReturn.from === HUMAN_SEAT;
  const toBeat = state.lastCombo;

  const rawHand = controller.sortedHand(HUMAN_SEAT);
  const hand = rawHand.map((c) => cardItem(c, ctx));
  const selectedIds = rawHand.filter((c) => ui.selection.has(c.id)).map((c) => `c${c.id}`);
  const selectedCount = ui.selection.size;

  let message: string;
  if (state.over) {
    message = '本局已结束';
  } else if (myReturn) {
    message = ui.returnCard
      ? `把 ${cardLabel(ui.returnCard.card)} 还给${SEAT_DISPLAY[seatName(pendingReturn!.to)]}（空格确认）`
      : selectedCount === 0
        ? `收到贡牌——选一张不大于 10 的牌，还给${SEAT_DISPLAY[seatName(pendingReturn!.to)]}`
        : '这张不能还：需为不大于 10 的牌（红心级牌除外）';
  } else if (humanTurn) {
    message =
      selectedCount === 0
        ? toBeat
          ? '选牌跟牌，或点「不出」'
          : '轮到你领出（空格 = 出牌）'
        : ui.validCombo
          ? controller.describe(ui.validCombo) + (toBeat ? '' : '（领出）')
          : '所选的牌无法构成可出的牌型';
  } else {
    message = '等待其他玩家…';
  }

  let notice: StageVM['notice'] = null;
  if (controller.lastNeuralFallbackReason) {
    notice = { visible: true, text: '⚠ 神经模型加载失败，本局回退启发式对手' };
  } else if (state.tribute) {
    notice = state.tribute.resist
      ? { visible: true, text: `抗贡 · 下游方抓有两大王，免进贡——上游 ${SEAT_DISPLAY[seatName(state.tribute.leader)]} 先出` }
      : {
          visible: true,
          text:
            state.tribute.tributes.map((t) => `${SEAT_DISPLAY[seatName(t.from)]} 贡 ${cardLabel(t.card)}→ ${SEAT_DISPLAY[seatName(t.to)]}`).join('，') +
            (state.tribute.returns.length > 0
              ? `｜${state.tribute.returns.map((t) => `${SEAT_DISPLAY[seatName(t.from)]} 还 ${cardLabel(t.card)}→ ${SEAT_DISPLAY[seatName(t.to)]}`).join('，')}`
              : '') +
            (state.pendingReturns.length > 0
              ? `｜轮到 ${state.pendingReturns.map((p) => SEAT_DISPLAY[seatName(p.from)]).join('、')} 选牌还贡…`
              : `｜${SEAT_DISPLAY[seatName(state.tribute.leader)]} 先出`),
        };
  }

  const finished = (seat: number): number | null => {
    const i = state.finished.indexOf(seat);
    return i >= 0 ? i : null;
  };

  return {
    levels: { own: RANK_NAME[state.match.levels[0]], other: RANK_NAME[state.match.levels[1]] },
    wildRule: '配牌 · 红心级牌可当任意牌',
    status: state.over ? '本局已结束' : `第 ${state.match.gameNo} 局 · 第 ${state.moveNo} 手`,
    notice,
    players: [
      { seat: 'north', name: SEAT_DISPLAY.north, role: 'teammate', remaining: state.hands[2].length, rankIdx: finished(2) },
      { seat: 'west', name: SEAT_DISPLAY.west, role: 'opponent', remaining: state.hands[3].length, rankIdx: finished(3) },
      { seat: 'east', name: SEAT_DISPLAY.east, role: 'opponent', remaining: state.hands[1].length, rankIdx: finished(1) },
    ],
    passes: {
      north: controller.tableCombos[2] === 'pass',
      west: controller.tableCombos[3] === 'pass',
      east: controller.tableCombos[1] === 'pass',
      self: controller.tableCombos[0] === 'pass',
    },
    playedEast: played(controller, ctx, 1),
    playedSelf: played(controller, ctx, 0),
    playedNorth: played(controller, ctx, 2),
    playedWest: played(controller, ctx, 3),
    hand,
    selectable: (humanTurn || myReturn) && !state.over,
    selectedIds,
    turnActive: humanTurn,
    actions: {
      message,
      canPass: humanTurn && canPass(state),
      canHint: humanTurn || myReturn,
      canPlay: (myReturn ? ui.returnCard !== null : ui.validCombo !== null) && (humanTurn || myReturn),
      playLabel: myReturn ? '还牌' : '出牌',
    },
  };
}
