import { cardItem, buildStageVM, type CardItem, type StageUiState, type StageVM } from '../gp/viewmodel';
import type { MatchController } from '../../game/controller';
import type { GameState } from '@gd/engine';

/**
 * 1800×874 牌桌（正常 + 贡还确认两状态）的 view model。
 * 基础字段复用 gp/viewmodel（同一权威引擎状态、同一翻译口径），
 * 在此之上增加：阶段（normal / return-pick / tribute-result）、页头阶段文案、
 * 贡还交换配对（来自 controller.exchangeResult()，04 的同一权威版本）。
 * 座位→展示名：0=我方 1=东家 2=队友 3=西家（换座不改事务身份，只改称呼）。
 */

export type GTPhase = 'normal' | 'return-pick' | 'tribute-result';

export interface ExchangePairVM {
  id: string;
  tribute: { fromName: string; toName: string; card: CardItem };
  ret: { fromName: string; toName: string; card: CardItem };
}

export interface GameTableVM extends StageVM {
  phase: GTPhase;
  phaseLabel: string;
  ackPending: boolean;
  exchangeError: string | null;
  canAcknowledgeExchange: boolean;
  exchange: { pairs: ExchangePairVM[]; leader: number; version: string } | null;
}

export const SEAT_DISPLAY: Record<number, string> = { 0: '我方', 1: '东家', 2: '队友', 3: '西家' };

export function buildGameTableVM(controller: MatchController, state: GameState, ui: StageUiState): GameTableVM {
  const base: StageVM = buildStageVM(controller, state, ui);
  const ackPending = controller.exchangeAckPending;
  const phase: GTPhase = ackPending ? 'tribute-result' : controller.humanReturning ? 'return-pick' : 'normal';
  const ex = ackPending ? controller.exchangeResult() : null;
  const exchange = ex
    ? {
        leader: ex.leader,
        version: ex.version,
        pairs: ex.pairs.map((p, i) => ({
          id: `pair-${i}`,
          tribute: { fromName: SEAT_DISPLAY[p.tribute.from] ?? '?', toName: SEAT_DISPLAY[p.tribute.to] ?? '?', card: cardItem(p.tribute.card, state.ctx) },
          ret: { fromName: SEAT_DISPLAY[p.ret.from] ?? '?', toName: SEAT_DISPLAY[p.ret.to] ?? '?', card: cardItem(p.ret.card, state.ctx) },
        })),
      }
    : null;
  return {
    ...base,
    phase,
    ackPending,
    exchangeError: controller.exchangeError,
    canAcknowledgeExchange: controller.canAcknowledgeExchange,
    // 04 §五：结果确认页手牌只读禁选——即使门控期轮次已是我方（humanTurn 为真）
    selectable: base.selectable && phase !== 'tribute-result',
    turnActive: base.turnActive && phase !== 'tribute-result',
    actions: ackPending
      ? { ...base.actions, canPass: false, canHint: false, canPlay: false }
      : base.actions,
    phaseLabel: ackPending ? '贡还牌' : state.over ? '本局已结束' : `第${state.match.gameNo}局·第${state.moveNo}手`,
    exchange,
  };
}
