import { describe, expect, it } from 'vitest';
import {
  createMatch, startGame, classify, legalCombos, DEFAULT_RULES,
  type Card, type GameState, type Suit,
} from '@gd/engine';
import { scoreCandidates } from '../src/heuristic';
import { LEVEL_CAPS } from '../src/types';

let nextId = 5000;
function C(suit: Suit, rank: number): Card {
  return { id: nextId++, suit, rank };
}

/** 构造指定手牌与被压局面的状态 */
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

const EASY = LEVEL_CAPS[0];

function easyPick(state: GameState) {
  const move = scoreCandidates({
    state,
    seat: 0,
    caps: EASY,
    memory: null,
    rand: () => 0,
  })[0].move;
  if (move.pass) throw new Error('期望出牌，实际让牌');
  return move.combo;
}

describe('初级 AI 的常识底线', () => {
  it('队友的牌绝不炸弹（哪怕是能压的炸弹）', () => {
    // 队友（座位2）出了对 5，我手里有 8888 炸弹和 99 对
    const state = craftState(
      [[C('S', 8), C('H', 8), C('D', 8), C('C', 8), C('S', 3), C('S', 9), C('H', 9)], [], [], []],
      [C('S', 5), C('H', 5)],
      2,
    );
    const combo = easyPick(state);
    expect(combo.kind).not.toBe('bomb'); // 不会炸队友，用对子应
  });

  it('对手的牌照样见炸就炸（新手特征保留）', () => {
    const state = craftState(
      [[C('S', 8), C('H', 8), C('D', 8), C('C', 8), C('S', 3), C('S', 9), C('H', 9)], [], [], []],
      [C('S', 5), C('H', 5)],
      1, // 东家（对手）
    );
    const combo = easyPick(state);
    expect(combo.kind).toBe('bomb'); // 对手小对子也炸，炸得毫无必要——这就是初级
  });

  it('队友出级牌大牌时会让，不拿大王去顶', () => {
    // 打 2：队友出单张 2（级牌），我手里只有大王能压
    const state = craftState(
      [[C('J', 17), C('S', 3), C('S', 4)], [], [], []],
      [C('S', 2)],
      2,
    );
    let passed = false;
    try { easyPick(state); } catch { passed = true; }
    expect(passed).toBe(true);
  });

  it('对手出牌时最小压（贪心）不变', () => {
    const state = craftState(
      [[C('S', 4), C('H', 4), C('S', 9), C('H', 9), C('S', 3)], [], [], []],
      [C('S', 5), C('H', 5)],
      1,
    );
    const combo = easyPick(state);
    expect(combo.kind).toBe('pair');
    expect(combo.mainRank).toBe(9);
  });
});

describe('三档共有底线：中级/高级同样不炸队友', () => {
  for (const diff of [1, 2] as const) {
    it(`难度${diff} 不会用炸弹压队友`, () => {
      const state = craftState(
        [[C('S', 8), C('H', 8), C('D', 8), C('C', 8), C('S', 3), C('S', 9), C('H', 9)], [], [], []],
        [C('S', 5), C('H', 5)],
        2,
      );
      const move = scoreCandidates({
        state, seat: 0, caps: LEVEL_CAPS[diff], memory: null, rand: () => 0,
      })[0].move;
      expect(move.pass ? 'pass' : move.combo.kind).not.toBe('bomb');
    });
  }
});
