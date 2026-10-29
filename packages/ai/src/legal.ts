/**
 * packages/ai/src/legal.ts — 出牌合法性值校验（防御守卫用）。
 *
 * 背景（2026-10-26 阶段B验证发现）：legalCombos 每次调用返回全新 Combo 对象，
 * 旧的防御写法 `legal.some(c => c === move.combo)`（引用相等）对一切跨调用的
 * 非pass出牌 100% 误判，把实际出牌静默改写成 legal[0]——曾污染全部离线实验
 * （自对弈/训练采样/评测），真实游戏不受影响（applyMove 按值校验）。
 * 正确防御：不比对对象引用，直接按引擎同款规则做值校验。
 *
 * 2026-10-26 CLEAN1 加固（方案第三节检查 1）：多重集合校验（同一 id 不得重复
 * 消耗）+ 声明可复认（所选牌张能按声明的牌型/主点/长度/配对结构重组，拒绝
 * 错误牌型描述）。万能牌单张按级牌身份放行（classify 对双级局取最强级牌解释，
 * 与枚举的按各自级牌单张不一致，属引擎既有口径，此处不重复判定）。
 */
import { beats, canPass, classify, comboKey, isWild, legalCombos, type GameState } from '@gd/engine';
import type { Move } from './types';

export function isMoveLegal(state: GameState, move: Move): boolean {
  if (move.pass) return canPass(state);
  const combo = move.combo;
  if (!combo) return false;
  const hand = state.hands[state.turn];
  if (!hand) return false;
  // 牌张多重集合 ⊆ 手牌（同 id 不得重复消耗）
  const handCounts = new Map<number, number>();
  for (const c of hand) handCounts.set(c.id, (handCounts.get(c.id) ?? 0) + 1);
  const moveCounts = new Map<number, number>();
  for (const c of combo.cards) moveCounts.set(c.id, (moveCounts.get(c.id) ?? 0) + 1);
  for (const [id, n] of moveCounts) if ((handCounts.get(id) ?? 0) < n) return false;
  // 声明张数与实际牌张一致
  if (combo.cards.length !== combo.size) return false;
  // 声明可复认：classify 能把所出牌张重组为同一声明的牌型
  if (!(combo.cards.length === 1 && isWild(combo.cards[0], state.ctx))) {
    const key = comboKey(combo);
    if (!classify(combo.cards, state.ctx, state.match.opts).some((c) => comboKey(c) === key)) return false;
  }
  return !state.lastCombo || beats(combo, state.lastCombo);
}

/** 守卫：非法时回退到首个合法出牌（或 pass），保证对局不中断 */
export function guardMove(state: GameState, move: Move): Move {
  if (isMoveLegal(state, move)) return move;
  const list = legalCombos(state);
  if (list.length > 0) return { pass: false, combo: list[0] };
  return { pass: true };
}
