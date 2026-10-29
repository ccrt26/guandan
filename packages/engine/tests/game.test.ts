import { describe, expect, it } from 'vitest';
import {
  applyMove, applyTribute, canPass, completeReturn, computeResult, createMatch, isReturnableCard, legalCombos,
  pickReturnCard, startGame, teamOf,
} from '../src/game';
import { classify, isWild } from '../src/combo';
import { makeLevelCtx, rankOrder } from '../src/rank';
import { RNG } from '../src/rng';
import { DEFAULT_RULES, type Card, type GameState, type Suit } from '../src/types';

let nextId = 10000;
function C(suit: Suit, rank: number): Card {
  return { id: nextId++, suit, rank };
}

function craftState(hands: Card[][], levels: [number, number] = [2, 2], leader = 0): GameState {
  const match = createMatch({ ...DEFAULT_RULES }, 42);
  match.levels = [...levels] as [number, number];
  const state = startGame(match);
  state.hands = hands;
  state.turn = leader;
  state.leader = leader;
  state.lastPlayer = leader;
  return state;
}

describe('computeResult 升级规则', () => {
  const levels: [number, number] = [5, 5];
  it('双上游 +3', () => {
    // 0,2 是一队：头游0 二游2
    const r = computeResult([0, 2, 1, 3], levels, DEFAULT_RULES);
    expect(r.doubleUp).toBe(true);
    expect(r.upgrade).toBe(3);
    expect(r.levelsAfter[0]).toBe(8);
    expect(r.levelsAfter[1]).toBe(5);
  });
  it('头游+三游 +2', () => {
    const r = computeResult([0, 1, 2, 3], levels, DEFAULT_RULES);
    expect(r.upgrade).toBe(2);
  });
  it('头游+末游 +1', () => {
    const r = computeResult([0, 1, 3, 2], levels, DEFAULT_RULES);
    expect(r.upgrade).toBe(1);
  });
  it('级数封顶 A', () => {
    const r = computeResult([0, 2, 1, 3], [13, 5], DEFAULT_RULES);
    expect(r.levelsAfter[0]).toBe(14);
  });
  it('过A：默认（官方竞技口径）头游且同伴非末游才过', () => {
    const r = computeResult([0, 1, 3, 2], [14, 8], DEFAULT_RULES);
    expect(r.passedA).toBe(false); // 同伴末游，未过
    expect(r.levelsAfter[0]).toBe(14);
    const r2 = computeResult([0, 1, 2, 3], [14, 8], DEFAULT_RULES);
    expect(r2.passedA).toBe(true); // 头游+三游，过
  });
  it('过A：double 模式要求双上游', () => {
    const opts = { ...DEFAULT_RULES, passA: 'double' as const };
    expect(computeResult([0, 1, 3, 2], [14, 8], opts).passedA).toBe(false);
    expect(computeResult([0, 2, 1, 3], [14, 8], opts).passedA).toBe(true);
  });
  it('过A：head3 模式头游+三游可过', () => {
    const opts = { ...DEFAULT_RULES, passA: 'head3' as const };
    expect(computeResult([0, 1, 2, 3], [14, 8], opts).passedA).toBe(true);
    expect(computeResult([0, 1, 3, 2], [14, 8], opts).passedA).toBe(false);
  });
});

describe('状态机', () => {
  it('领出不能 Pass', () => {
    const st = craftState([
      [C('S', 3), C('H', 3)], [C('S', 4), C('H', 4)], [C('S', 5), C('H', 5)], [C('S', 6), C('H', 6)],
    ]);
    expect(canPass(st)).toBe(false);
    expect(() => applyMove(st, { pass: true })).toThrow();
  });

  it('一轮跟牌与让牌：最后出牌者获得牌权', () => {
    const st = craftState([
      [C('S', 3), C('H', 3), C('S', 9), C('H', 9)],
      [C('S', 4), C('H', 4), C('S', 10), C('H', 10)],
      [C('S', 5), C('H', 5), C('S', 11), C('H', 11)],
      [C('S', 6), C('H', 6), C('S', 12), C('H', 12)],
    ]);
    const p33 = classify(st.hands[0].slice(0, 2), st.ctx)[0];
    applyMove(st, { pass: false, combo: p33 }); // 0 出 33
    expect(st.turn).toBe(1);
    const p44 = classify(st.hands[1].slice(0, 2), st.ctx)[0];
    applyMove(st, { pass: false, combo: p44 }); // 1 压 44
    applyMove(st, { pass: true }); // 2 过
    applyMove(st, { pass: true }); // 3 过
    expect(st.turn).toBe(0); // 0 还需表态
    applyMove(st, { pass: true }); // 0 也过 → 轮结束
    expect(st.turn).toBe(1);
    expect(st.lastCombo).toBeNull();
    expect(canPass(st)).toBe(false);
  });

  it('出牌者走完后其余人全让：牌权给出牌者下家', () => {
    const st = craftState([
      [C('S', 3), C('H', 3)],
      [C('S', 4), C('H', 4)],
      [C('S', 5), C('H', 5), C('S', 7), C('H', 7)],
      [C('S', 6), C('H', 6), C('S', 8), C('H', 8)],
    ]);
    const p33 = classify(st.hands[0], st.ctx)[0];
    const evs = applyMove(st, { pass: false, combo: p33 }); // 0 出完 → 头游
    expect(evs.some((e) => e.type === 'finish' && e.player === 0)).toBe(true);
    const p44 = classify(st.hands[1], st.ctx)[0];
    applyMove(st, { pass: false, combo: p44 }); // 1 出完 → 二游
    applyMove(st, { pass: true }); // 2 过
    applyMove(st, { pass: true }); // 3 过 → 本轮结束（出牌者1已走）
    expect(st.turn).toBe(3); // 官方：上游出完无人接，由对家领出（1 的对家是 3）
    expect(st.lastCombo).toBeNull();
  });

  it('三家出完自动结算，末游为剩牌者', () => {
    const st = craftState([
      [C('S', 3), C('H', 3)],
      [C('S', 4), C('H', 4)],
      [C('S', 5), C('H', 5)],
      [C('S', 6), C('H', 6), C('S', 8), C('H', 8)],
    ]);
    applyMove(st, { pass: false, combo: classify(st.hands[0].slice(), st.ctx)[0] });
    applyMove(st, { pass: false, combo: classify(st.hands[1].slice(), st.ctx)[0] });
    applyMove(st, { pass: false, combo: classify(st.hands[2].slice(), st.ctx)[0] });
    expect(st.over).toBe(true);
    expect(st.result!.finishOrder).toEqual([0, 1, 2, 3]);
    expect(st.result!.winnerTeam).toBe(teamOf(0));
    expect(st.match.levels[0]).toBeGreaterThan(2);
  });
});

describe('stage 级牌口径（官方：谁在台上打几，那个几是全场唯一级牌）', () => {
  function lastResultOf(order: number[], levels: [number, number]) {
    return {
      finishOrder: order,
      winnerTeam: teamOf(order[0]) as 0 | 1,
      doubleUp: teamOf(order[1]) === teamOf(order[0]),
      levelsAfter: levels,
      upgrade: 1,
      passedA: false,
    };
  }

  it('首局（无上局结果）：级牌=2', () => {
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    const st = startGame(match);
    expect(st.stageTeam).toBe(0);
    expect([...st.ctx.ranks]).toEqual([2]);
  });

  it('上副上游方在台：只有其级数是级牌，落后方的级数不是', () => {
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    match.levels = [5, 2];
    match.lastResult = lastResultOf([2, 0, 1, 3], [5, 2]);
    const st = startGame(match);
    expect(st.stageTeam).toBe(0);
    expect([...st.ctx.ranks]).toEqual([5]);
    expect(rankOrder(2, st.ctx)).toBe(2); // 2 回落为最小普通牌
    expect(isWild(C('H', 2), st.ctx)).toBe(false); // 红心 2 不是逢人配
    expect(isWild(C('H', 5), st.ctx)).toBe(true);
  });

  it('落后方翻盘上台：本局改打新台上方级数，原级数失效', () => {
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    match.levels = [5, 4]; // 上副对方赢（上游=座位3），升到 4
    match.lastResult = lastResultOf([3, 0, 1, 2], [5, 4]);
    const st = startGame(match);
    expect(st.stageTeam).toBe(1);
    expect([...st.ctx.ranks]).toEqual([4]);
    expect(rankOrder(5, st.ctx)).toBe(5); // 我方 5 不再是级牌
    expect(rankOrder(4, st.ctx)).toBeGreaterThan(rankOrder(14, st.ctx));
  });
});

describe('进贡还贡（官方规则）', () => {
  function craftMatchWithLast(lastOrder: number[], levels: [number, number] = [3, 3]) {
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    match.levels = levels;
    match.lastHead = lastOrder[0];
    match.lastResult = {
      finishOrder: lastOrder as number[],
      winnerTeam: teamOf(lastOrder[0]),
      doubleUp: teamOf(lastOrder[1]) === teamOf(lastOrder[0]),
      levelsAfter: levels,
      upgrade: 1,
      passedA: false,
    };
    return match;
  }

  it('首局无进贡', () => {
    const match = createMatch({ ...DEFAULT_RULES }, 7);
    const st = startGame(match);
    expect(st.tribute).toBeNull();
  });

  it('单贡：末游贡最大牌给上游，上游还 2..10，末游先出', () => {
    // 上局：0 头游（队0 胜）1 二游（队1）2 三游（队0）3 末游（队1）→ 末游 3 单贡给上游 0
    const match = craftMatchWithLast([0, 1, 2, 3]);
    const st = startGame(match);
    expect(st.tribute).not.toBeNull();
    expect(st.tribute!.resist).toBe(false);
    expect(st.tribute!.tributes).toHaveLength(1);
    const t = st.tribute!.tributes[0];
    expect(t.from).toBe(3);
    expect(t.to).toBe(0);
    // 贡的是手中最大牌（王 > 级牌 > A；且红心级牌不贡）——转移后手中不应再有更大的牌
    const ord = (r: number) => rankOrder(r, st.ctx);
    const maxOther = Math.max(...st.hands[3].filter((c) => !(c.suit === 'H' && st.ctx.ranks.has(c.rank) && c.rank < 15)).map((c) => ord(c.rank)));
    expect(ord(t.card.rank)).toBeGreaterThanOrEqual(maxOther);
    expect(st.hands[0].some((c) => c.id === t.card.id)).toBe(true); // 已转移
    const back = st.tribute!.returns[0];
    expect(back.from).toBe(0);
    expect(back.card.rank).toBeGreaterThanOrEqual(2);
    expect(back.card.rank).toBeLessThanOrEqual(10);
    expect(st.leader).toBe(3); // 末游先出
  });

  it('双贡：三游/末游各贡，较大者给上游，贡大者先出', () => {
    // 上局队0 双上游：0 头游 2 二游 1 三游 3 末游 → 队1 双人进贡
    const match = craftMatchWithLast([0, 2, 1, 3]);
    const st = startGame(match);
    expect(st.tribute!.tributes).toHaveLength(2);
    const ord = (r: number) => rankOrder(r, st.ctx);
    const toHead = st.tribute!.tributes.find((t) => t.to === 0);
    const toSecond = st.tribute!.tributes.find((t) => t.to === 2); // 二游是 2
    expect(toHead).toBeDefined();
    expect(toSecond).toBeDefined();
    expect(ord(toHead!.card.rank)).toBeGreaterThanOrEqual(ord(toSecond!.card.rank));
    expect(st.leader).toBe(toHead!.from); // 贡大牌者先出
  });

  it('抗贡：下游方抓两大王 → 免贡，上游先出', () => {
    const match = craftMatchWithLast([0, 2, 1, 3]);
    // 手工把两个大王塞给下游方（1 和 3）
    const rngState = match.rngState;
    void rngState;
    const st = startGame(match);
    // 由于发牌随机，这里用确定性手段：直接构造 state 后再跑 applyTribute
    const match2 = craftMatchWithLast([0, 2, 1, 3]);
    const st2 = startGame(match2);
    // 把两个大王换到队1 手里
    const bigs = st2.hands.flat().filter((c) => c.rank === 17);
    if (bigs.length === 2) {
      for (const b of bigs) {
        const owner = st2.hands.findIndex((h) => h.some((c) => c.id === b.id));
        if (teamOf(owner) === 0) {
          st2.hands[owner].splice(st2.hands[owner].findIndex((c) => c.id === b.id), 1);
          st2.hands[3].push(b);
        }
      }
      const tribute = applyTribute(st2);
      expect(tribute!.resist).toBe(true);
      expect(tribute!.leader).toBe(0); // 上游先出
    }
  });

  it('交互还贡：收贡方挂起待还，还贡合法牌落牌、非法牌拒绝，首出权不变', () => {
    // 上局：0 头游 1 二游 2 三游 3 末游 → 3 单贡给 0，0 须还贡
    const match = craftMatchWithLast([0, 1, 2, 3]);
    const st = startGame(match, [0]);
    expect(st.tribute!.tributes).toHaveLength(1);
    expect(st.tribute!.returns).toHaveLength(0); // 还贡挂起，未自动还
    expect(st.pendingReturns).toEqual([{ from: 0, to: 3 }]);
    expect(st.turn).toBe(0); // 轮到还贡方
    expect(st.leader).toBe(3); // 首出权仍是末游
    // 非法一：>10（含级牌王）
    const big = st.hands[0].find((c) => !isReturnableCard(c, st.ctx))!;
    expect(big).toBeDefined();
    expect(() => completeReturn(st, big)).toThrow();
    // 非法二：不在手中
    expect(() => completeReturn(st, C('S', 3))).toThrow();
    // 挂起阶段不能出牌/领出逻辑不推进
    expect(st.lastCombo).toBeNull();
    // 合法还贡
    const back = pickReturnCard(st, 0);
    expect(isReturnableCard(back, st.ctx)).toBe(true);
    // 自动还口径：可还牌里按本局牌力序最小（避开级牌）
    const better = st.hands[0].filter((c) => isReturnableCard(c, st.ctx))
      .every((c) => rankOrder(c.rank, st.ctx) >= rankOrder(back.rank, st.ctx));
    expect(better).toBe(true);
    const count3 = st.hands[3].length;
    completeReturn(st, back);
    expect(st.hands[3].length).toBe(count3 + 1);
    expect(st.tribute!.returns).toEqual([{ from: 0, to: 3, card: back }]);
    expect(st.pendingReturns).toHaveLength(0);
    expect(st.turn).toBe(3); // 归位首出者
  });

  it('交互席位只影响还方：挂起贡者/非参与席位无效果', () => {
    const match = craftMatchWithLast([0, 1, 2, 3]); // 还方是 0
    const st = startGame(match, [3]); // 3 是贡者，不是还方
    expect(st.pendingReturns).toHaveLength(0);
    expect(st.tribute!.returns).toHaveLength(1);
  });

  it('双贡：两位收贡方只挂起交互席位，另一位照常自动还', () => {
    // 上局队0 双上游：0 上游 2 二游 → 各还一张给 1/3
    const match = craftMatchWithLast([0, 2, 1, 3]);
    const st = startGame(match, [2]);
    expect(st.tribute!.tributes).toHaveLength(2);
    expect(st.tribute!.returns).toHaveLength(1); // 0 已自动还
    expect(st.pendingReturns).toHaveLength(1);
    expect(st.pendingReturns[0].from).toBe(2);
    const to = st.pendingReturns[0].to;
    expect([1, 3]).toContain(to);
    completeReturn(st, pickReturnCard(st, 2));
    expect(st.pendingReturns).toHaveLength(0);
    expect(st.tribute!.returns).toHaveLength(2);
    expect(st.turn).toBe(st.tribute!.leader); // 归位首出者（贡大牌者）
  });
});

describe('随机整局 / 整场回归', () => {
  it('随机策略完整打完一局：牌数守恒、名次合法', () => {
    const rng = new RNG(7);
    for (let g = 0; g < 30; g++) {
      const match = createMatch({ ...DEFAULT_RULES }, rng.state);
      const st = startGame(match);
      let guard = 0;
      while (!st.over && guard++ < 3000) {
        const combos = legalCombos(st);
        if (combos.length === 0) {
          if (!canPass(st)) throw new Error('无牌可出且不能过');
          applyMove(st, { pass: true });
          continue;
        }
        // 70% 出牌 30% 让牌（若可让），保证收敛
        if (canPass(st) && rng.next() < 0.3) {
          applyMove(st, { pass: true });
        } else {
          applyMove(st, { pass: false, combo: combos[rng.int(combos.length)] });
        }
      }
      expect(st.over).toBe(true);
      expect(new Set(st.result!.finishOrder).size).toBe(4);
      const total = st.hands.reduce((s, h) => s + h.length, 0);
      expect(total).toBe(st.result!.finishOrder.slice(0, 3).length === 3 ? st.hands[st.result!.finishOrder[3]].length : total);
      // 前三名手牌为空
      for (const p of st.result!.finishOrder.slice(0, 3)) {
        expect(st.hands[p].length).toBe(0);
      }
      // 赢方 = 头游所在队，且升级正确
      const win = st.result!.winnerTeam;
      expect(teamOf(st.result!.finishOrder[0])).toBe(win);
      const expectUp = st.result!.doubleUp ? 3 : teamOf(st.result!.finishOrder[2]) === win ? 2 : 1;
      expect(st.result!.upgrade).toBe(expectUp);
    }
  });

  it('整场随机打到过A 一定终止', () => {
    const rng = new RNG(99);
    const match = createMatch({ ...DEFAULT_RULES }, rng.state);
    let games = 0;
    while (match.winner === null && games < 500) {
      games += 1;
      const st = startGame(match);
      let guard = 0;
      while (!st.over && guard++ < 3000) {
        const combos = legalCombos(st);
        if (combos.length === 0) {
          applyMove(st, { pass: true });
          continue;
        }
        if (canPass(st) && rng.next() < 0.25) applyMove(st, { pass: true });
        else applyMove(st, { pass: false, combo: combos[rng.int(combos.length)] });
      }
      expect(st.over).toBe(true);
    }
    expect(match.winner).not.toBeNull();
    expect(games).toBeLessThan(500);
  });

  it('双级模式（两队级数不同）整场也能跑通', () => {
    const rng = new RNG(1234);
    const match = createMatch({ ...DEFAULT_RULES, levelMode: 'both' }, rng.state);
    let games = 0;
    while (match.winner === null && games < 500) {
      games += 1;
      const st = startGame(match);
      let guard = 0;
      while (!st.over && guard++ < 3000) {
        const combos = legalCombos(st);
        if (combos.length === 0) {
          applyMove(st, { pass: true });
          continue;
        }
        if (canPass(st) && rng.next() < 0.25) applyMove(st, { pass: true });
        else applyMove(st, { pass: false, combo: combos[rng.int(combos.length)] });
      }
    }
    expect(match.winner).not.toBeNull();
  });

  it('枚举性能：27 张手牌枚举 < 8ms', () => {
    const match = createMatch({ ...DEFAULT_RULES }, 5);
    const st = startGame(match);
    const hand = st.hands[0];
    const ctx = st.ctx;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) legalCombos(st);
    const avg = (performance.now() - t0) / 20;
    expect(avg).toBeLessThan(8);
    void hand; void ctx;
  });
});
