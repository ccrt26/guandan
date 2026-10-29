import { describe, expect, it } from 'vitest';
import {
  classify, cloneState, createMatch, DEFAULT_RULES, legalCombos, startGame,
  type Card, type Combo, type GameState, type Suit,
} from '@gd/engine';
import { guardMove, isMoveLegal } from '../src/legal';
import type { Move } from '../src/types';

let nid = 9500;
const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });

function craft(hand: Card[], toBeat?: Card[]): GameState {
  const match = createMatch({ ...DEFAULT_RULES }, 42);
  match.levels = [6, 6]; // 级 6：♥6 为万能牌
  const state = startGame(match);
  state.hands = [hand, [], [], []];
  state.turn = 0;
  if (toBeat) {
    state.lastCombo = classify(toBeat, state.ctx)[0];
    state.lastPlayer = 1;
  }
  return state;
}

const idsOf = (m: Move): string => (m.pass ? 'pass' : m.combo!.cards.map((c) => c.id).sort().join(','));

describe('isMoveLegal 值校验契约（方案第三节检查 1）', () => {
  it('跨调用重建/深复制的合法动作必须通过（旧引用守卫在此 100% 误判）', () => {
    const state = craft([C('S', 3), C('S', 9), C('H', 9), C('D', 9), C('C', 9), C('H', 6), C('S', 14)]);
    // 模拟 AI：自己那次 legalCombos 调用产生的 combo（与守卫内的调用不同源）
    const aiLegal = legalCombos(state);
    const nonFirst = aiLegal.find((c) => c !== aiLegal[0])!;
    expect(isMoveLegal(state, { pass: false, combo: nonFirst })).toBe(true);
    // 深复制（对象引用全变，语义不变）
    const deep = structuredClone(nonFirst);
    expect(isMoveLegal(state, { pass: false, combo: deep })).toBe(true);
    // 重建：同牌张、新对象
    const rebuilt = classify(nonFirst.cards, state.ctx)[0];
    expect(isMoveLegal(state, { pass: false, combo: rebuilt })).toBe(true);
  });

  it('非法请求必须拒绝：领出 pass / 牌不在手 / 重复用牌 / 压不过 / 错误牌型描述 / 张数不符', () => {
    const hand = [C('S', 3), C('S', 9), C('H', 9), C('D', 9), C('S', 14)];
    const lead = craft(hand);
    expect(isMoveLegal(lead, { pass: true })).toBe(false); // 领出不能 pass
    const other = craft(hand);
    const mine = legalCombos(other)[0];
    expect(isMoveLegal(other, { pass: false, combo: { ...mine, cards: [C('C', 2), C('D', 2)] } })).toBe(false); // 牌不在手
    expect(isMoveLegal(other, { pass: false, combo: { ...mine, cards: [...mine.cards, ...mine.cards] } })).toBe(false); // 同 id 重复消耗
    const following = craft(hand, [C('S', 13)]);
    const small = legalCombos(following).find((c) => c.kind === 'single' && c.mainRank === 3)!;
    expect(isMoveLegal(following, { pass: false, combo: small })).toBe(false); // 3 压不过 K
    const bogus = { ...legalCombos(craft(hand))[0], kind: 'bomb', mainRank: 9, size: 1 } as Combo;
    expect(isMoveLegal(craft(hand), { pass: false, combo: bogus })).toBe(false); // 声明张数与牌张不符
    const bogus2: Combo = { kind: 'bomb', cards: hand.slice(0, 4), size: 4, keyRank: 30, length: 1, pairRanks: [], mainRank: 9, suit: undefined, wildAs: [] };
    expect(isMoveLegal(craft(hand), { pass: false, combo: bogus2 })).toBe(false); // 4 张杂牌谎报炸弹 → classify 复认失败
  });

  it('验证器不得修改状态', () => {
    const state = craft([C('S', 3), C('S', 9), C('H', 9), C('D', 9)]);
    const before = cloneState(state);
    const move = { pass: false, combo: legalCombos(state)[1] } as Move;
    isMoveLegal(state, move);
    guardMove(state, move);
    expect(state).toEqual(before);
  });

  it('guardMove 不改写合法的非 legal[0] 出牌（守卫缺陷事故的失败模式）', () => {
    const state = craft([C('S', 3), C('S', 9), C('H', 9), C('D', 9), C('C', 9), C('H', 6)]);
    const aiLegal = legalCombos(state); // AI 内部那次调用
    const nonFirst = aiLegal.find((c) => c !== aiLegal[0])!;
    const out = guardMove(state, { pass: false, combo: nonFirst });
    expect(out.pass).toBe(false);
    expect(idsOf(out)).toBe(nonFirst.cards.map((c) => c.id).sort().join(','));
  });

  it('旧引用守卫复现夹具：旧写法会把跨调用非 pass 出牌改写为 legal[0]（守住不得回归）', () => {
    const state = craft([C('S', 3), C('S', 9), C('H', 9), C('D', 9), C('C', 9), C('H', 6)]);
    const aiLegal = legalCombos(state);
    const nonFirst = aiLegal.find((c) => c !== aiLegal[0])!;
    const oldRefGuard = (st: GameState, move: Move): Move => {
      const legal = legalCombos(st); // 每次调用返回全新对象 → 引用比较必 false
      return !move.pass && !legal.some((c) => c === move.combo)
        ? { pass: false, combo: legal[0] }
        : move;
    };
    // 旧守卫：改写发生（事故机制复现，证明本夹具能抓住该类错误）
    const oldOut = oldRefGuard(state, { pass: false, combo: nonFirst });
    expect(oldOut.pass === false && oldOut.combo === nonFirst).toBe(false);
    // 新守卫：原样放行
    const newOut = guardMove(state, { pass: false, combo: nonFirst });
    expect(newOut.pass === false && newOut.combo === nonFirst).toBe(true);
  });

  it('万能牌当自然牌变体通过守卫（2026-10-26 修复的漏招与守卫集成）', () => {
    const hand = [C('S', 6), C('S', 6), C('H', 6)]; // 级 6：♥6 万能
    const state = craft(hand);
    const pairs = legalCombos(state).filter((c) => c.kind === 'pair' && c.mainRank === 6);
    expect(pairs.length).toBe(2);
    for (const p of pairs) {
      expect(isMoveLegal(state, { pass: false, combo: p })).toBe(true);
      const out = guardMove(state, { pass: false, combo: p });
      expect(out.pass === false && out.combo === p).toBe(true);
    }
  });
});
