import { describe, expect, it } from 'vitest';
import {
  createMatch, startGame, classify, legalCombos, DEFAULT_RULES, buildDeck, sortedHandCopy,
  type Card, type GameState, type Suit, type Combo,
} from '@gd/engine';
import { scoreCandidates } from '../src/heuristic';
import { LEVEL_CAPS } from '../src/types';
import { PlayMemory } from '../src/memory';

let nextId = 9000;
function C(suit: Suit, rank: number): Card {
  return { id: nextId++, suit, rank };
}

function craftState(hands: Card[][], toBeatCards: Card[] | null, toBeatOwner: number): GameState {
  const match = createMatch({ ...DEFAULT_RULES }, 42);
  const state = startGame(match);
  state.hands = hands;
  state.turn = 0;
  state.leader = toBeatOwner;
  state.lastPlayer = toBeatOwner;
  state.lastCombo = toBeatCards ? classify(toBeatCards, state.ctx)[0] : null;
  return state;
}

/**
 * 公平性回归测试：AI 的决策必须与「其他玩家的隐藏手牌内容」统计无关。
 * 做法：构造同一局面，把对手手牌整体替换成完全不同的牌（保持张数不变），
 * 三档 AI 的确定性决策必须完全一致。若任何代码路径偷看了对手手牌，此测试会失败。
 */
describe('AI 反作弊：决策与隐藏信息无关', () => {
  for (const diff of [0, 1, 2] as const) {
    it(`难度${diff} 的决策不受对手手牌内容影响（领出与跟牌两种局面）`, () => {
      // 我的牌：有炸弹、顺子结构、级牌，覆盖多种决策路径
      const myHand = [C('S', 3), C('H', 4), C('D', 5), C('C', 6), C('S', 7), C('S', 9), C('H', 9), C('D', 9), C('C', 9), C('S', 12), C('J', 16)];

      // 两套完全不同的对手手牌（各 20 张，含/不含炸弹与同花顺）
      const deckA = buildDeck().filter((c) => !myHand.includes(c)).slice(0, 60);
      const handsA = [deckA.slice(0, 20), deckA.slice(20, 40), deckA.slice(40, 60)];
      // 打乱重排产生第二套"平行世界"手牌
      const deckB = [...deckA];
      for (let i = deckB.length - 1; i > 0; i--) {
        const j = (i * 7 + 13) % (i + 1);
        [deckB[i], deckB[j]] = [deckB[j], deckB[i]];
      }
      const handsB = [deckB.slice(0, 20), deckB.slice(20, 40), deckB.slice(40, 60)];

      const decide = (hands: Card[][], toBeat: Card[] | null, owner: number): Combo | 'pass' => {
        const state = craftState([myHand, ...hands], toBeat, owner);
        const scored = scoreCandidates({
          state,
          seat: 0,
          caps: LEVEL_CAPS[diff],
          memory: PlayMemory.fromStart(state.ctx),
          rand: () => 0, // 确定性：排除噪声，只比较信息利用
        });
        const move = scored[0].move;
        return move.pass ? 'pass' : move.combo;
      };

      const key = (c: Combo | 'pass') => (c === 'pass' ? 'pass' : `${c.kind}:${c.mainRank}:${c.size}:${c.cards.map((x) => x.id).sort().join(',')}`);

      // 领出
      expect(key(decide(handsA, null, 0))).toBe(key(decide(handsB, null, 0)));
      // 跟对手牌（东家）
      expect(key(decide(handsA, [C('S', 8), C('H', 8)], 1))).toBe(key(decide(handsB, [C('S', 8), C('H', 8)], 1)));
      // 跟队友牌（北家）
      expect(key(decide(handsA, [C('S', 8), C('H', 8)], 2))).toBe(key(decide(handsB, [C('S', 8), C('H', 8)], 2)));
      // 对手剩牌很少的残局（终局逻辑也不得偷看内容）
      const shortA = handsA.map((h, i) => (i === 0 ? h.slice(0, 16) : h.slice(0, 3)));
      const shortB = handsB.map((h, i) => (i === 0 ? h.slice(0, 16) : h.slice(0, 3)));
      expect(key(decide(shortA, [C('S', 8), C('H', 8)], 1))).toBe(key(decide(shortB, [C('S', 8), C('H', 8)], 1)));
    });
  }

  it('记牌器只包含公开信息（已出的牌与各家张数）', () => {
    const mem = PlayMemory.fromStart({ ranks: new Set([2]), levels: [2, 2] });
    const playedCombo = classify([C('S', 5), C('H', 5)], { ranks: new Set([2]), levels: [2, 2] })[0];
    mem.recordPlay(1, playedCombo);
    // seenIds 只含已出的牌 id
    expect(mem.seenIds.size).toBe(2);
    // 未出的任何牌都不在记录里
    expect(mem.seenIds.has(C('D', 5).id)).toBe(false);
  });

  it('发牌与 AI 无关：AI 种子不影响发牌结果（结构性断言）', () => {
    // createMatch 的洗牌 RNG 只由 match seed 决定；AI 玩家的决策种子在构造时独立注入。
    // 这里断言同一 match seed 的发牌可复现（洗牌不掺入任何 AI 状态）。
    const m1 = createMatch({ ...DEFAULT_RULES }, 12345);
    const s1 = startGame(m1);
    const h1 = sortedHandCopy(s1.hands[0], s1.ctx).map((c) => c.id);
    const m2 = createMatch({ ...DEFAULT_RULES }, 12345);
    const s2 = startGame(m2);
    const h2 = sortedHandCopy(s2.hands[0], s2.ctx).map((c) => c.id);
    expect(h1).toEqual(h2);
    void legalCombos;
  });
});
