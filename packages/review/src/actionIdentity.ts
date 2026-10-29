/**
 * packages/review/src/actionIdentity.ts — R2（REVIEW2-EXEC §4.3）：统一动作身份。
 * 游戏执行用物理 ID；语义比较同时看资源消耗（花色点数多重集）与完整声明（declKey）。
 * - 同点同花仅实体 ID 不同的副本 = 等价副本，可规范化匹配；
 * - 同声明不同物理资源（对8 用 ♠8♥8 还是 ♠8♦8）= 不同动作，不得互借分数；
 * - 同物理牌不同声明 = same_cards_diff_decl，不强配。
 * analyzer 与 nnAdvisor 共用本匹配器（F04/F05/F06）。
 */
import { comboKey, type Card, type Combo } from '@gd/engine';

export interface CanonicalAction {
  /** 稳定标识：声明 + 资源（不含物理 id；用于跨副本等价识别） */
  actionId: string;
  player: number;
  pass: boolean;
  /** 物理牌 id 升序（游戏执行身份） */
  physicalCardIds: string[];
  /** 花色+点数多重集（等价副本规范化键） */
  valueKey: string;
  /** 声明键（kind:mainRank:length:size+pairs） */
  declKey: string;
  combo: Combo | null;
}

const valueKeyOf = (cards: Card[]): string => cards.map((c) => `${c.suit}${c.rank}`).sort().join(',');

export function canonicalize(player: number, pass: boolean, combo: Combo | null): CanonicalAction {
  const cards = combo?.cards ?? [];
  const decl = pass ? 'pass' : comboKey(combo as Combo);
  return {
    actionId: `${decl}#${valueKeyOf(cards)}`,
    player,
    pass,
    physicalCardIds: cards.map((c) => String(c.id)).sort(),
    valueKey: valueKeyOf(cards),
    declKey: decl,
    combo,
  };
}

export type MatchStatus = 'exact' | 'equivalent_copy' | 'same_cards_diff_decl' | 'uncovered';

export interface MatchResult {
  index: number;            // 命中候选下标；未命中 -1
  status: MatchStatus;
}

/** 实际动作在候选中的匹配：物理 id 全等且同声明 > 等价副本（同声明+同资源多重集）> 声明不同/未覆盖。
 * exact 必须同时比对声明——同一组物理牌换声明是不同动作（R2 契约），不得强配。 */
export function matchAction(actual: CanonicalAction, candidates: CanonicalAction[]): MatchResult {
  if (actual.pass) {
    const i = candidates.findIndex((c) => c.pass);
    return { index: i, status: i >= 0 ? 'exact' : 'uncovered' };
  }
  const exact = candidates.findIndex(
    (c) => !c.pass && c.declKey === actual.declKey
      && c.physicalCardIds.join(',') === actual.physicalCardIds.join(','),
  );
  if (exact >= 0) return { index: exact, status: 'exact' };
  const equiv = candidates.findIndex(
    (c) => !c.pass && c.declKey === actual.declKey && c.valueKey === actual.valueKey,
  );
  if (equiv >= 0) return { index: equiv, status: 'equivalent_copy' };
  const sameCards = candidates.findIndex((c) => !c.pass && c.valueKey === actual.valueKey);
  if (sameCards >= 0) return { index: -1, status: 'same_cards_diff_decl' };
  return { index: -1, status: 'uncovered' };
}
