import { describe, expect, it } from 'vitest';
import {
  bestResponse, beats, classify, comboKey, enumerateCombos, isWild, resourceRoles,
} from '../src/combo';
import { makeLevelCtx, rankOrder } from '../src/rank';
import { BIG_JOKER, SMALL_JOKER, type Card, type Rank, type Suit } from '../src/types';

let nextId = 0;
export function C(suit: Suit, rank: Rank): Card {
  return { id: nextId++, suit, rank };
}
/** 快速构造一组牌，如 cds('S5,H5,D5') */
export function cds(spec: string): Card[] {
  return spec.split(',').map((s) => C(s[0] as Suit, Number(s.slice(1)) || (s.includes('小王') ? SMALL_JOKER : BIG_JOKER)));
}
const joker = (big: boolean): Card => C('J', big ? BIG_JOKER : SMALL_JOKER);

const L2 = makeLevelCtx([2, 2], 'both');
const L5 = makeLevelCtx([5, 5], 'both');
const L59 = makeLevelCtx([5, 9], 'both');
const L59H = makeLevelCtx([5, 9], 'high');
const L52S0 = makeLevelCtx([5, 2], 'stage', 0); // 我方 5 在台
const L52S1 = makeLevelCtx([5, 2], 'stage', 1); // 对方 2 在台

describe('rankOrder / 级牌', () => {
  it('普通牌 < 级牌 < 小王 < 大王', () => {
    expect(rankOrder(3, L5)).toBeLessThan(rankOrder(5, L5));
    expect(rankOrder(14, L5)).toBeLessThan(rankOrder(5, L5)); // A < 级牌
    expect(rankOrder(5, L5)).toBeLessThan(rankOrder(SMALL_JOKER, L5));
    expect(rankOrder(SMALL_JOKER, L5)).toBeLessThan(rankOrder(BIG_JOKER, L5));
  });
  it('both 模式：级高者的级牌更大', () => {
    expect(rankOrder(9, L59)).toBeGreaterThan(rankOrder(5, L59));
  });
  it('high 模式：仅级高一方为级牌', () => {
    expect(rankOrder(5, L59H)).toBe(5); // 5 不再是级牌
    expect(rankOrder(9, L59H)).toBeGreaterThan(14);
    expect(isWild(C('H', 5), L59H)).toBe(false);
    expect(isWild(C('H', 9), L59H)).toBe(true);
  });
  it('stage 模式（官方）：全场唯一级牌＝台上那方所打级数', () => {
    // 我方 5 在台、对方停在 2：2 是最小普通牌，红心 2 不是逢人配
    expect(rankOrder(2, L52S0)).toBe(2);
    expect(rankOrder(3, L52S0)).toBeGreaterThan(rankOrder(2, L52S0));
    expect(rankOrder(5, L52S0)).toBeGreaterThan(rankOrder(14, L52S0));
    expect(isWild(C('H', 2), L52S0)).toBe(false);
    expect(isWild(C('H', 5), L52S0)).toBe(true);
    // 对方 2 在台（含首副打 2）：2 是级牌，我方的 5 只是普通牌
    expect(rankOrder(2, L52S1)).toBeGreaterThan(rankOrder(14, L52S1));
    expect(rankOrder(5, L52S1)).toBe(5);
    expect(isWild(C('H', 2), L52S1)).toBe(true);
    expect(isWild(C('H', 5), L52S1)).toBe(false);
  });
  it('红心级牌是万能牌，其他花色级牌不是', () => {
    expect(isWild(C('H', 5), L5)).toBe(true);
    expect(isWild(C('S', 5), L5)).toBe(false);
  });
});

describe('classify 基础牌型', () => {
  it('单张/对子/三张/三带二', () => {
    expect(classify(cds('S7'), L2)[0].kind).toBe('single');
    expect(classify(cds('S7,H7'), L2)[0].kind).toBe('pair');
    expect(classify(cds('S7,H7,D7'), L2)[0].kind).toBe('trio');
    const tp = classify(cds('S7,H7,D7,C8,S8'), L2);
    expect(tp.some((c) => c.kind === 'trio_pair' && c.mainRank === 7 && c.pairRanks[0] === 8)).toBe(true);
  });
  it('顺子固定 5 张（官方规则，不可超长）', () => {
    expect(classify(cds('S3,H4,D5,C6,S7'), L2)[0].kind).toBe('straight');
    expect(classify(cds('S3,H4,D5,C6,S7,H8'), L2)).toHaveLength(0);
    expect(classify(cds('S3,H4,D5,C6,S7,H8,D9,C10,S11'), L2)).toHaveLength(0);
  });
  it('顺子不含 2、不含级牌', () => {
    expect(classify(cds('S2,H3,D4,C5,S6'), L2)).toHaveLength(0);
    // 打 5 时 34567 不成立（5 为级牌）
    expect(classify(cds('S3,H4,D6,C7,S8'), L5)).toHaveLength(0);
    // 打 5 时 45678 也不成立
    expect(classify(cds('S4,H6,D7,C8,S9'), L5)).toHaveLength(0);
  });
  it('三连对', () => {
    expect(classify(cds('S3,H3,S4,H4,S5,H5'), L2)[0].kind).toBe('pair_seq');
    // 两连对不算
    expect(classify(cds('S3,H3,S4,H4'), L2)).toHaveLength(0);
  });
  it('钢板：两个连续三同张（仅光板，6 张）', () => {
    expect(classify(cds('S3,H3,D3,S4,H4,D4'), L2)[0].kind).toBe('trio_seq');
    expect(classify(cds('S3,H3,D3,S4,H4,D4,S8,H8,S9,H9'), L2)).toHaveLength(0); // 带两对不存在
  });
  it('炸弹与天王炸', () => {
    expect(classify(cds('S8,H8,D8,C8'), L2)[0].kind).toBe('bomb');
    expect(classify([joker(false), joker(false), joker(true), joker(true)], L2)[0].kind).toBe('joker_bomb');
    // 王对（两小王）是合法对子（官方）；一大一小不成对
    expect(classify([joker(false), joker(true)], L2)).toHaveLength(0);
  });
  it('同花顺', () => {
    const flush = classify(cds('S9,S10,S11,S12,S13'), L2);
    expect(flush.some((c) => c.kind === 'flush')).toBe(true); // 同花五连既是顺子也是同花顺
    expect(bestResponse(cds('S9,S10,S11,S12,S13'), null, L2)!.kind).toBe('flush'); // 取最强解释
    // 混花不是同花顺，但仍是顺子
    const mixed = classify(cds('S9,H10,S11,S12,S13'), L2);
    expect(mixed.some((c) => c.kind === 'flush')).toBe(false);
    expect(mixed.some((c) => c.kind === 'straight')).toBe(true);
  });
});

describe('classify 逢人配', () => {
  it('红心级牌配对子', () => {
    // 打 5：♥5 万能 → ♥5+♠7 = 77 对子
    const r = classify(cds('H5,S7'), L5);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((c) => c.kind === 'pair')).toBe(true);
  });
  it('红心级牌配顺子（级牌本身不入顺）', () => {
    // 打 5：♥5 万能 → 6,7,8,9 + ♥5 当 10 = 顺子 678910
    const r = classify(cds('S6,H7,D8,C9,H5'), L5);
    expect(r.some((c) => c.kind === 'straight')).toBe(true);
    // 打 5 时 34567 因级牌占位不成立（级牌不入顺）
    expect(classify(cds('S3,H4,D6,C7,H5'), L5)).toHaveLength(0);
  });
  it('双万能牌凑三张（both 双级模式）', () => {
    const r = classify(cds('H5,H9,S7'), L59);
    expect(r.some((c) => c.kind === 'trio' && c.mainRank === 7)).toBe(true);
  });
  it('万能牌配炸弹', () => {
    const r = classify(cds('S8,H8,D8,H5'), L5); // ♥5 配 8
    expect(r.some((c) => c.kind === 'bomb' && c.size === 4)).toBe(true);
  });
  it('万能牌配同花顺', () => {
    const r = classify(cds('S9,S10,S11,S12,H5'), L5);
    expect(r.some((c) => c.kind === 'flush')).toBe(true);
  });
  it('万能牌不能当王', () => {
    const r = classify(cds('H5,C5,C5'), L5);
    expect(r.every((c) => c.kind !== 'joker_bomb')).toBe(true);
  });
  it('多解释并存：3344+万能牌 → 三带二 333+44 与 444+33 共存', () => {
    // 打 2，万能牌 ♥2
    const r = classify(cds('S3,H3,S4,H4,H2'), L2);
    const trios = r.filter((c) => c.kind === 'trio_pair');
    expect(trios.map((t) => t.mainRank).sort()).toEqual([3, 4]);
  });
  it('级牌对大于 A 对', () => {
    const lvlPair = bestResponse(cds('S5,H5'), null, L5)!;
    const aPair = bestResponse(cds('S14,H14'), null, L5)!;
    expect(beats(lvlPair, aPair)).toBe(true);
  });
});

describe('官方规则锁（竞技掼蛋竞赛规则）', () => {
  it('顺子：固定 5 张；同花顺同为 5 张', () => {
    expect(classify(cds('S3,H4,D5,C6,S7'), L2).some((c) => c.kind === 'straight')).toBe(true);
    expect(classify(cds('S3,H4,D5,C6,S7,H8'), L2)).toHaveLength(0);
    expect(classify(cds('S3,H4,D5,C6'), L2)).toHaveLength(0); // 4 张不算
  });
  it('三连对：固定 3 对 6 张，2 对或 4 对都不行', () => {
    expect(classify(cds('S3,H3,S4,H4,S5,H5'), L2)[0].kind).toBe('pair_seq');
    expect(classify(cds('S3,H3,S4,H4'), L2)).toHaveLength(0);
    expect(classify(cds('S3,H3,S4,H4,S5,H5,S6,H6'), L2)).toHaveLength(0);
  });
  it('钢板：固定 2 连三仅光板（官方无带对版本），3 连三不行、带两对非法', () => {
    expect(classify(cds('S3,H3,D3,S4,H4,D4'), L2)[0].kind).toBe('trio_seq');
    expect(classify(cds('S3,H3,D3,S4,H4,D4,S5,H5,D5'), L2)).toHaveLength(0);
    // 10 张"钢板带两对"不存在：官方除三连对(6)与炸弹外一律 ≤5 张
    expect(classify(cds('S3,H3,D3,S4,H4,D4,S8,H8,S9,H9'), L2)).toHaveLength(0);
  });
  it('全局锁：除三连对(6张)与炸弹(4-8张)外，任何牌型一手最多 5 张', () => {
    // 枚举一手丰富手牌，断言所有组合的 (kind,size) 落在合法集合
    const hand = cds('S2,H2,D2,C2,S3,H3,D3,S4,H4,S5,H5,D5,S8,H8,D8,C8,S14,H14,D14,C14,H7,S9,C6,D10');
    for (const c of enumerateCombos(hand, makeLevelCtx([10, 10], 'both'))) {
      const ok =
        (c.kind === 'pair_seq' && c.size === 6) ||
        (c.kind === 'trio_seq' && c.size === 6) ||
        (c.kind === 'bomb' && c.size >= 4 && c.size <= 8) ||
        (c.kind === 'joker_bomb') ||
        c.size <= 5;
      if (!ok) throw new Error(`非法张数: ${c.kind} ${c.size} 张`);
    }
  });
  it('炸弹 4..8 张，八炸封顶', () => {
    const cards: Card[] = [];
    for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) for (let copy = 0; copy < 2; copy++) cards.push(C(suit, 8));
    expect(classify(cards, L2).some((c) => c.kind === 'bomb' && c.size === 8)).toBe(true);
    expect(classify([...cards, C('S', 3)], L2)).toHaveLength(0); // 8 张 + 杂牌不成型
  });
});

describe('官方规则锁：A 作 1 且 2 参与序列（位置域模型）', () => {
  const L8 = makeLevelCtx([8, 8], 'both'); // A,2,3,4,5 均非级牌
  const L2 = makeLevelCtx([2, 2], 'both'); // 2 是级牌
  const L4 = makeLevelCtx([4, 4], 'both');

  it('A2345 / 23456 / 34567 均为合法顺子（级数>5 时）', () => {
    expect(classify(cds('S14,S2,H3,D4,C5'), L8).some((c) => c.kind === 'straight' && c.keyRank === 5)).toBe(true);
    expect(classify(cds('S2,H3,D4,C5,S6'), L8).some((c) => c.kind === 'straight' && c.keyRank === 6)).toBe(true);
    expect(classify(cds('S3,H4,D5,C6,S7'), L8).some((c) => c.kind === 'straight' && c.keyRank === 7)).toBe(true);
  });
  it('打 2 局：2 是级牌，A2345 / 23456 均不可用', () => {
    expect(classify(cds('S14,S2,H3,D4,C5'), L2)).toHaveLength(0);
    expect(classify(cds('S2,H3,D4,C5,S6'), L2)).toHaveLength(0);
  });
  it('级牌在序列中即阻断（打 4 时 A2345 不可用，56789 仍可）', () => {
    expect(classify(cds('S14,S2,H3,D4,C5'), L4)).toHaveLength(0);
    expect(classify(cds('S5,H6,D7,C8,S9'), L4).some((c) => c.kind === 'straight')).toBe(true);
  });
  it('AA2233 / 223344 均为合法三连对；AAA222 / 222333 均为合法钢板（仅光板）', () => {
    expect(classify(cds('S14,H14,S2,H2,S3,H3'), L8).some((c) => c.kind === 'pair_seq' && c.keyRank === 3)).toBe(true);
    expect(classify(cds('S2,H2,S3,H3,S4,H4'), L8).some((c) => c.kind === 'pair_seq' && c.keyRank === 4)).toBe(true);
    expect(classify(cds('S14,H14,D14,S2,H2,D2'), L8).some((c) => c.kind === 'trio_seq' && c.keyRank === 2)).toBe(true);
    expect(classify(cds('S2,H2,D2,S3,H3,D3'), L8).some((c) => c.kind === 'trio_seq' && c.keyRank === 3)).toBe(true);
    expect(classify(cds('S14,H14,D14,S2,H2,D2,S8,H8,S9,H9'), L8)).toHaveLength(0); // 带两对不存在
  });
  it('同花 A2345 / 同花 23456 均为合法同花顺', () => {
    expect(classify(cds('S14,S2,S3,S4,S5'), L8).some((c) => c.kind === 'flush' && c.keyRank === 5)).toBe(true);
    expect(classify(cds('S2,S3,S4,S5,S6'), L8).some((c) => c.kind === 'flush' && c.keyRank === 6)).toBe(true);
  });
  it('大小顺序：A2345 < 23456 < 34567 < 10JQKA；AA2233 < 223344 < 334455', () => {
    const lo = bestResponse(cds('S14,S2,H3,D4,C5'), null, L8)!;
    const lo2 = bestResponse(cds('S2,H3,D4,C5,S6'), null, L8)!;
    const mid = bestResponse(cds('S3,H4,D5,C6,S7'), null, L8)!;
    const hi = bestResponse(cds('S10,H11,D12,C13,S14'), null, L8)!;
    expect(beats(lo2, lo)).toBe(true);
    expect(beats(mid, lo2)).toBe(true);
    expect(beats(hi, lo)).toBe(true);
    const plo = bestResponse(cds('S14,H14,S2,H2,S3,H3'), null, L8)!;
    const plo2 = bestResponse(cds('S2,H2,S3,H3,S4,H4'), null, L8)!;
    expect(beats(plo2, plo)).toBe(true);
  });
  it('万能牌可补 A2345（♥8 当 5）', () => {
    const r = classify(cds('S14,S2,H3,D4,H8'), L8);
    expect(r.some((c) => c.kind === 'straight' && c.keyRank === 5)).toBe(true);
  });
  it('王对：两小王/两大王成对且为最大对子，一大一小不成对', () => {
    expect(classify([joker(false), joker(false)], L2)[0].kind).toBe('pair');
    expect(classify([joker(true), joker(true)], L2)[0].kind).toBe('pair');
    expect(classify([joker(false), joker(true)], L2)).toHaveLength(0);
    const jj = bestResponse([joker(false), joker(false)], null, L2)!;
    const aa = bestResponse(cds('S14,H14'), null, L2)!;
    expect(beats(jj, aa)).toBe(true); // 小王对 > AA
  });
  it('全局张数锁：枚举复杂手牌，除三连对/钢板(各6张)与炸弹外任何组合 ≤5 张', () => {
    const hand = cds('S2,H2,D2,S3,H3,D3,S4,H4,S5,H5,D5,S8,H8,D8,S14,H14,D14,H7,S9,C6,D10,C11,H13');
    for (const c of enumerateCombos(hand, L8)) {
      const ok =
        (c.kind === 'pair_seq' && c.size === 6) ||
        (c.kind === 'trio_seq' && c.size === 6) ||
        (c.kind === 'bomb' && c.size >= 4 && c.size <= 8) ||
        (c.kind === 'joker_bomb') ||
        c.size <= 5;
      if (!ok) throw new Error(`非法张数: ${c.kind} ${c.size} 张`);
    }
  });
});

describe('斗地主牌型在掼蛋中一律非法（反混染锁）', () => {
  it('三带一（三张+单张）不可出', () => {
    expect(classify(cds('S7,H7,D7,C3'), L2)).toHaveLength(0);
  });
  it('四带二（炸弹+两张单 / 炸弹+一对）不可出', () => {
    expect(classify(cds('S8,H8,D8,C8,S3,H4'), L2)).toHaveLength(0); // 炸弹带两单 → 6 张
    expect(classify(cds('S8,H8,D8,C8,S3,H3'), L2)).toHaveLength(0); // 炸弹带一对 → 6 张
  });
  it('两连对（4 张）与四连对（8 张）不可出', () => {
    expect(classify(cds('S3,H3,S4,H4'), L2)).toHaveLength(0);
    expect(classify(cds('S3,H3,S4,H4,S5,H5,S6,H6'), L2)).toHaveLength(0);
  });
  it('王只能单张、王对（两大或两小）或天王炸；一大一小/三王非法', () => {
    expect(classify([joker(false), joker(true)], L2)).toHaveLength(0); // 一大一小
    expect(classify([joker(false), joker(false), joker(true)], L2)).toHaveLength(0); // 三王
    expect(classify([joker(false), joker(false)], L2)[0].kind).toBe('pair'); // 两小王对（官方）
    expect(classify([joker(false), joker(false), joker(true), joker(true)], L2)[0].kind).toBe('joker_bomb');
  });
  it('飞机（连续三带翅膀）不可出：只有钢板（恰 2 连三）', () => {
    expect(classify(cds('S3,H3,D3,S4,H4,D4,S5,H5,D5'), L2)).toHaveLength(0); // 3 连三 9 张
  });
});

describe('压牌层级', () => {
  const mk = (spec: string, ctx = L2) => bestResponse(cds(spec), null, ctx)!;

  it('天王炸压一切', () => {
    const jb = bestResponse([joker(false), joker(false), joker(true), joker(true)], null, L2)!;
    expect(beats(jb, mk('S8,H8,D8,C8,S8,H8'))).toBe(true); // 6 炸
    expect(beats(jb, mk('S9,S10,S11,S12,S13'))).toBe(true); // 同花顺
    expect(beats(mk('S8,H8,D8,C8,S8,H8'), jb)).toBe(false);
  });
  it('同花顺压 4/5 张炸弹，6 张炸弹压同花顺', () => {
    const flush = bestResponse(cds('S9,S10,S11,S12,S13'), null, L2)!;
    const b4 = bestResponse(cds('S8,H8,D8,C8'), null, L2)!;
    const b5 = bestResponse(cds('S8,H8,D8,C8,S8'), null, L2)!;
    const six = bestResponse(cds('S8,H8,D8,C8,S8,H8'), null, L2)!;
    expect(beats(flush, b4)).toBe(true);
    expect(beats(flush, b5)).toBe(true);
    expect(beats(b5, b4)).toBe(true);
    expect(beats(six, flush)).toBe(true);
    expect(beats(flush, six)).toBe(false);
  });
  it('同牌型比主牌，不同张数/长度不可比', () => {
    const p9 = mk('S9,H9');
    const p10 = mk('S10,H10');
    expect(beats(p10, p9)).toBe(true);
    const st5 = mk('S3,H4,D5,C6,S7');
    const st5b = mk('S4,H5,D6,C7,H8');
    expect(beats(st5b, st5)).toBe(true); // 45678 > 34567
    const tp = mk('S7,H7,D7,C8,S8');
    expect(beats(st5, tp)).toBe(false); // 顺子压不了三带二
  });
  it('炸弹压一切普通牌型', () => {
    const b4 = mk('S3,H3,D3,C3');
    expect(beats(b4, mk('S14,H14'))).toBe(true);
    expect(beats(b4, mk('S3,H4,D5,C6,S7'))).toBe(true);
    expect(beats(b4, mk('S3,H3,S4,H4,S5,H5'))).toBe(true);
  });
});

describe('enumerateCombos', () => {
  it('基础去重枚举（v3：去重键=声明+资源角色含花色）', () => {
    const hand = cds('S3,H4,D5,C6,S7,H7,D7,S10,H10,C10');
    const combos = enumerateCombos(hand, L2);
    // v2 仅按 comboKey 去重；v3 同声明不同花色资源共存（REVIEW4-A1）
    const keys = new Set(combos.map((c) => `${comboKey(c)}#${resourceRoles(c.cards, c.wildAs, L2)}`));
    expect(keys.size).toBe(combos.length);
    expect(combos.some((c) => c.kind === 'straight')).toBe(true);
    expect(combos.some((c) => c.kind === 'pair' && c.mainRank === 7)).toBe(true);
    expect(combos.some((c) => c.kind === 'trio' && c.mainRank === 10)).toBe(true);
  });
  it('万能牌扩展出的组合', () => {
    // 打 5，♥5 万能
    const hand = cds('H5,S6,D7,C8,S9');
    const combos = enumerateCombos(hand, L5);
    expect(combos.some((c) => c.kind === 'straight')).toBe(true); // ♥5 补 5 或 10
    expect(combos.some((c) => c.kind === 'flush' && c.suit === 'S')).toBe(false); // 黑桃缺一张(10)且万能牌已是♥5 → S 9,6,8 只有3张
    const hand2 = cds('H5,S6,S7,S8,S9');
    const combos2 = enumerateCombos(hand2, L5);
    expect(combos2.some((c) => c.kind === 'flush' && c.suit === 'S')).toBe(true); // ♥5 当 S10
  });
  it('炸弹枚举多尺寸（v3：同尺寸不同花色资源共存）', () => {
    const hand = cds('S8,H8,D8,C8,S8,H8');
    const bombs = enumerateCombos(hand, L2).filter((c) => c.kind === 'bomb' && c.mainRank === 8);
    // v2 每尺寸恰 1 个；v3 同尺寸按花色多重集展开（6 张里选 4/5 的不同花色组合）
    expect([...new Set(bombs.map((b) => b.size))].sort()).toEqual([4, 5, 6]);
    const keys = new Set(bombs.map((b) => `${comboKey(b)}#${resourceRoles(b.cards, b.wildAs, L2)}`));
    expect(keys.size).toBe(bombs.length);
  });
  it('枚举出的组合牌都在手牌中且可由 classify 复认', () => {
    const hand = cds('H5,S6,D7,C8,S9,S10,H10,D10,C4,S4,H4,D4,C11,H11,D11,C11,S12,H12,D12,C12,S3,H3,D3,C3,S13,H13,D13,C13');
    for (const c of enumerateCombos(hand, L5)) {
      expect(c.cards.length).toBe(c.size);
      const again = classify(c.cards, L5);
      expect(again.length).toBeGreaterThan(0);
    }
  });
});

describe('万能牌当自然牌变体（2026-10-26 修复的已知漏招）', () => {
  const idSet = (cs: Card[]) => cs.map((c) => c.id).sort().join(',');
  it('对子：级 5 手 ♠5♠5♥5 → {♠5,♠5} 与 {♠5,♥5} 变体共存', () => {
    const hand = cds('S5,S5,H5');
    const pairs = enumerateCombos(hand, L5).filter((c) => c.kind === 'pair' && c.mainRank === 5);
    expect(pairs.map((p) => idSet(p.cards)).sort()).toEqual([
      idSet([hand[0], hand[1]]),
      idSet([hand[0], hand[2]]),
    ].sort());
    // 变体可由 classify 按同声明复认（引擎接受该出牌）
    const interp = classify([hand[0], hand[2]], L5);
    expect(interp.some((c) => c.kind === 'pair' && c.mainRank === 5)).toBe(true);
  });
  it('单张：级 5 手 ♠5♥5 → {♠5} 与 {♥5} 共存', () => {
    const hand = cds('S5,H5');
    const singles = enumerateCombos(hand, L5).filter((c) => c.kind === 'single' && c.mainRank === 5);
    expect(singles.map((s) => idSet(s.cards)).sort()).toEqual([`${hand[0].id}`, `${hand[1].id}`].sort());
  });
  it('三张/炸弹：花 ♥5 的变体与全自然实现共存', () => {
    const hand = cds('S5,S5,D5,H5');
    const trios = enumerateCombos(hand, L5).filter((c) => c.kind === 'trio' && c.mainRank === 5);
    expect(trios.some((t) => t.cards.some((c) => c.suit === 'H'))).toBe(true);
    expect(trios.some((t) => t.cards.every((c) => c.suit !== 'H'))).toBe(true);
    const hand2 = cds('S5,S5,D5,C5,H5');
    const bombs = enumerateCombos(hand2, L5).filter((c) => c.kind === 'bomb' && c.size === 4);
    expect(bombs.some((b) => b.cards.some((c) => c.suit === 'H'))).toBe(true);
    expect(bombs.some((b) => b.cards.every((c) => c.suit !== 'H'))).toBe(true);
  });
  it('三带二级牌主体：花 ♥5 的变体（全自然带对）', () => {
    const hand = cds('S5,S5,S5,H5,S8,D8');
    const tps = enumerateCombos(hand, L5).filter((c) => c.kind === 'trio_pair' && c.mainRank === 5);
    expect(tps.some((t) => t.cards.some((c) => c.suit === 'H' && c.rank === 5))).toBe(true);
    expect(tps.some((t) => t.cards.every((c) => !(c.suit === 'H' && c.rank === 5)))).toBe(true);
  });
  it('自然牌不足时万能牌补足的原有行为不回归', () => {
    const hand = cds('S5,H5');
    expect(enumerateCombos(hand, L5).some((c) => c.kind === 'pair' && c.mainRank === 5)).toBe(true);
  });
  it('候选 v2（2026-10-27）：双级局对9 的"自然/同点万能/跨点代入"变体并存，各自合法', () => {
    const hand = cds('S9,S9,H5'); // 级 [5,9]：H5 是 5 的万能牌，非 9
    const pairs9 = enumerateCombos(hand, makeLevelCtx([5, 9], 'both'))
      .filter((c) => c.kind === 'pair' && c.mainRank === 9);
    // 自然变体（两张 S9）仍在，且不耗 H5
    expect(pairs9.some((p) => p.cards.every((c) => c.suit !== 'H') && p.wildAs.length === 0)).toBe(true);
    // 候选 v2 语义变更：H5 代入 9 与 S9 组对（资源消耗不同）是合法动作，应作为独立变体保留
    // （旧锁"对9 绝不出现 H5"是 2026-10-26 窄修复时代的语义，被 T0 小手牌穷举对照推翻）
    expect(pairs9.some((p) => p.cards.some((c) => c.suit === 'H') && p.wildAs.length === 1)).toBe(true);
    for (const p of pairs9) {
      expect(classify(p.cards, makeLevelCtx([5, 9], 'both')).some((k) => comboKey(k) === comboKey(p))).toBe(true);
    }
  });
  it('所有变体可由 classify 按同声明复认且张数一致', () => {
    const hand = cds('S5,S5,D5,C5,H5,S8,H8,D8');
    for (const c of enumerateCombos(hand, L5)) {
      expect(c.cards.length).toBe(c.size);
      if (c.cards.length === 1 && c.cards[0].suit === 'H' && c.cards[0].rank === 5) continue; // 万能单张（引擎按最强级牌解释，另测）
      const key = comboKey(c);
      expect(classify(c.cards, L5).some((k) => comboKey(k) === key)).toBe(true);
    }
  });
});
