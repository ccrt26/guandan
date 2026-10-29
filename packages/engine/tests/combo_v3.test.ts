/**
 * packages/engine/tests/combo_v3.test.ts — REVIEW4-A1 有界补例矩阵（cand-suit-v3）。
 * 每格用确实合法的固定牌例断言：同声明的不同花色资源是不同候选（身份不合并、
 * 各自可物理执行、余手后状态不同）；无合法变体格标 N/A 并说明。
 * 不声称全空间完备（穷举对照另见 lab/src/review4/cand_profile_v3.ts Part B）。
 */
import { describe, expect, it } from 'vitest';
import {
  beats, buildDeck, enumerateCombos, makeLevelCtx, resourceRoles, type Card, type Combo, type LevelCtx,
} from '../src';
import { DEFAULT_RULES, type Suit } from '../src/types';

const deck = buildDeck();
const usedIds = new Set<number>();
/** 从两副牌里取指定花色点数的牌（模块级去重：同花色同点数两次调用取两副不同实体） */
function C(s: Suit, r: number): Card {
  const hit = deck.find((c) => c.suit === s && c.rank === r && !usedIds.has(c.id));
  if (!hit) throw new Error(`牌池耗尽: ${s}${r}`);
  usedIds.add(hit.id);
  return hit;
}
function fresh(): void { usedIds.clear(); }

const ctxStage = (lv: number, stageTeam: 0 | 1 = 0): LevelCtx => makeLevelCtx([lv, lv === 5 ? 9 : 5], 'stage', stageTeam);
const ctxBoth = (a: number, b: number): LevelCtx => makeLevelCtx([a, b], 'both');

const roleKey = (c: Combo, ctx: LevelCtx) => `${c.kind}:${c.mainRank}:${c.length}:${c.size}#${resourceRoles(c.cards, c.wildAs, ctx)}`;
const phys = (c: Combo) => c.cards.map((x) => `${x.suit}${x.rank}`).sort().join(',');
const restAfter = (hand: Card[], c: Combo) => {
  const ids = new Set(c.cards.map((x) => x.id));
  return hand.filter((h) => !ids.has(h.id)).map((h) => `${h.suit}${h.rank}`).sort().join(',');
};

interface Cell {
  kind: string; wilds: 0 | 1 | 2; mode: 'stage' | 'both'; lead: boolean;
  hand: () => Card[]; ctx: () => LevelCtx;
  decl: string; // 声明过滤（kind:mainRank）
  expectVariants: number; // 预期同声明变体数（花色多重集数）；-1 = N/A 说明见 na
  na?: string;
  toBeat?: () => Combo | null;
}

function runCell(cell: Cell): void {
  fresh();
  const hand = cell.hand();
  const ctx = cell.ctx();
  const all = enumerateCombos(hand, ctx, DEFAULT_RULES);
  const toBeat = cell.toBeat?.() ?? null;
  const cands = all.filter((c) => `${c.kind}:${c.mainRank}` === cell.decl && (!toBeat || beats(c, toBeat)));
  const keys = new Set(cands.map((c) => roleKey(c, ctx)));
  expect(keys.size).toBe(cands.length); // 身份不合并
  if (cell.expectVariants >= 0) {
    expect(cands.length).toBe(cell.expectVariants);
    // 各自可物理执行（牌都在手）+ 余手后状态两两不同
    const rests = new Set<string>();
    for (const c of cands) {
      for (const card of c.cards) expect(hand.some((h) => h.id === card.id)).toBe(true);
      rests.add(restAfter(hand, c));
    }
    expect(rests.size).toBe(cands.length);
  }
}

describe('REVIEW4-A1 有界补例矩阵（cand-suit-v3）', () => {
  const kinds: Array<{ name: string; declOf: () => string; hand: () => Card[]; variants: number; na?: string }> = [
    {
      name: '单张', declOf: () => 'single:8',
      hand: () => [C('S', 8), C('H', 8), C('S', 3)],
      variants: 2,
    },
    {
      name: '对子', declOf: () => 'pair:8',
      hand: () => [C('S', 8), C('H', 8), C('D', 8), C('S', 3)],
      variants: 3, // {S8,H8} {S8,D8} {H8,D8}
    },
    {
      name: '三张', declOf: () => 'trio:8',
      hand: () => [C('S', 8), C('H', 8), C('D', 8), C('C', 8), C('S', 3)],
      variants: 4, // C(4,3)=4 种花色多重集
    },
    {
      name: '三带二（主体三张变体）', declOf: () => 'trio_pair:8',
      hand: () => [C('S', 8), C('H', 8), C('D', 8), C('C', 8), C('S', 3), C('H', 3)],
      variants: 4, // 主体 8 三张花色选择 C(4,3)；带对 33 唯一
    },
    {
      name: '三带二（带对变体）', declOf: () => 'trio_pair:8',
      hand: () => [C('S', 8), C('H', 8), C('D', 8), C('S', 3), C('H', 3), C('D', 3)],
      variants: 3, // 主体 888 唯一；带对 33 有 {S3,H3}{S3,D3}{H3,D3}
    },
    {
      name: '三连对', declOf: () => 'pair_seq:8',
      hand: () => [C('S', 6), C('H', 6), C('S', 7), C('H', 7), C('S', 8), C('H', 8), C('D', 8)],
      variants: 3, // 66、77 各唯一 × 88 三种花色组合（窗口 6-8 不含级 5，万能格不破坏序列）
    },
    {
      name: '两连三（钢板）', declOf: () => 'trio_seq:4',
      hand: () => [C('S', 3), C('H', 3), C('D', 3), C('S', 4), C('H', 4), C('D', 4), C('C', 4)],
      variants: 4, // 333 唯一 × 444 四种花色三选
    },
    {
      name: '顺子', declOf: () => 'straight:10',
      hand: () => [C('S', 6), C('S', 7), C('S', 8), C('H', 8), C('S', 9), C('S', 10)],
      variants: 2, // 8 位置 S8/H8 两变体，其余位置唯一（级5不在窗口内，万能格不破坏序列）
    },
    {
      name: '同花顺', declOf: () => 'flush:10',
      hand: () => [C('S', 6), C('S', 7), C('S', 8), C('S', 9), C('S', 10), C('H', 10)],
      variants: 1, na: '花色由声明固定、同花色双副本等价 → 无花色变体（固定例证唯一性）',
    },
    {
      name: '炸弹', declOf: () => 'bomb:8',
      hand: () => [C('S', 8), C('H', 8), C('D', 8), C('C', 8), C('S', 3)],
      variants: 1, // 恰 4 张自然 8 → 唯一多重集；多张时见 combo.test 炸弹多尺寸 v3 用例
    },
    {
      name: '四王', declOf: () => 'joker_bomb:17',
      hand: () => [C('J', 16), C('J', 16), C('J', 17), C('J', 17)],
      variants: 1, na: '王无花色（副本等价）→ 无花色变体',
    },
  ];

  const wildSetups: Array<{ wilds: 0 | 1 | 2; ctx: () => LevelCtx; note: string }> = [
    { wilds: 0, ctx: () => ctxStage(2), note: '自然（级2，无红心级牌在手）' },
    { wilds: 1, ctx: () => ctxStage(5), note: '一张万能（stage 级5，手含 ♥5）' },
    { wilds: 2, ctx: () => ctxStage(5), note: '两张万能（stage 级5，手含 ♥5×2）' },
  ];

  // 自然格：三种口径下每种牌型的花色变体保留
  for (const k of kinds) {
    for (const ws of wildSetups) {
      it(`自然/万能(${ws.wilds}) × ${k.name} × stage × 领出：变体保留且身份独立`, () => {
        if (k.name === '三连对' && false) return;
        const base = k.hand();
        const hand = ws.wilds === 0 ? base
          : ws.wilds === 1 ? [C('H', 5), ...base]
            : [C('H', 5), C('H', 5), ...base];
        // N/A 格：同花顺/四王无花色变体（variants=1 即唯一性断言）
        const cell: Cell = {
          kind: k.name, wilds: ws.wilds, mode: 'stage', lead: true,
          hand: () => hand, ctx: ws.ctx, decl: k.declOf(), expectVariants: k.variants, na: k.na,
        };
        // 万能牌在场会新增代入变体（如 ♥5 当 8），expected 只对 wilds=0 格精确锁定；
        // 万能格断言核心性质：≥ 自然格变体数且身份独立、余手互异
        if (ws.wilds > 0) cell.expectVariants = -1;
        runCell(cell);
        if (ws.wilds > 0) {
          fresh();
          const ctx = ws.ctx();
          const all = enumerateCombos(hand, ctx, DEFAULT_RULES).filter((c) => `${c.kind}:${c.mainRank}` === k.declOf());
          const keys = new Set(all.map((c) => roleKey(c, ctx)));
          expect(keys.size).toBe(all.length);
          expect(all.length).toBeGreaterThanOrEqual(k.variants);
          const rests = new Set(all.map((c) => restAfter(hand, c)));
          expect(rests.size).toBe(all.length);
        }
      });
    }
  }

  it('跟牌 × 对子：变体在压牌过滤后仍保留（待压 对6）', () => {
    fresh();
    const hand = [C('S', 8), C('H', 8), C('D', 8), C('S', 3)];
    const ctx = ctxStage(2);
    const toBeatSrc = [C('C', 6), C('D', 6)];
    const toBeat = enumerateCombos(toBeatSrc, ctx, DEFAULT_RULES).find((c) => c.kind === 'pair' && c.mainRank === 6)!;
    const cands = enumerateCombos(hand, ctx, DEFAULT_RULES).filter((c) => c.kind === 'pair' && c.mainRank === 8 && beats(c, toBeat));
    expect(cands.length).toBe(3);
    const keys = new Set(cands.map((c) => roleKey(c, ctx)));
    expect(keys.size).toBe(3);
  });

  it('both 口径 × 对子：双级数下花色变体同样保留', () => {
    fresh();
    const hand = [C('S', 8), C('H', 8), C('D', 8), C('S', 3)];
    const ctx = ctxBoth(8, 3);
    const cands = enumerateCombos(hand, ctx, DEFAULT_RULES).filter((c) => c.kind === 'pair' && c.mainRank === 8);
    expect(cands.length).toBe(3);
  });

  it('A1 命名反例（stage 级2）：♣8♦8 保 ♠5-9 同花顺 vs ♠8♣8 破坏之，两个候选都在', () => {
    fresh();
    const hand = [C('S', 5), C('S', 6), C('S', 7), C('S', 8), C('S', 9), C('C', 8), C('D', 8)];
    const ctx = ctxStage(2);
    const pairs = enumerateCombos(hand, ctx, DEFAULT_RULES).filter((c) => c.kind === 'pair' && c.mainRank === 8);
    expect(pairs.length).toBe(3);
    const a = pairs.find((c) => phys(c) === 'C8,D8')!;
    const b = pairs.find((c) => phys(c) === 'C8,S8')!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(restAfter(hand, a)).toContain('S5'); // a 余手保留黑桃 5-9
    expect(restAfter(hand, b)).not.toContain('S8'); // b 余手失去黑桃 8
  });

  it('已知剪枝边界如实登记（非本轮缺陷）：双万能凑非级牌对子不入候选；顺子保留自然换万能变体不入候选', () => {
    // F1：两张万能（both 级 4/7）不可凑 非级牌 对 5（v2 以来剪枝：双配凑对仅级牌）
    fresh();
    const hand = [C('H', 4), C('H', 7), C('S', 9)];
    const ctx = ctxBoth(4, 7);
    const pairs5 = enumerateCombos(hand, ctx, DEFAULT_RULES).filter((c) => c.kind === 'pair' && c.mainRank === 5);
    expect(pairs5.length).toBe(0); // 已知边界：classify 可解释、枚举不提供（文档 candidate-boundaries.json）
    // F2：顺子有自然 7 时，"留 S7 用万能当 7" 的变体不提供（forceWild 仅对子/三张）
    fresh();
    const hand2 = [C('C', 4), C('C', 5), C('H', 11), C('H', 3), C('H', 6), C('S', 7)];
    const ctx2 = ctxBoth(8, 11); // ♥11 为万能
    const straights = enumerateCombos(hand2, ctx2, DEFAULT_RULES).filter((c) => c.kind === 'straight' && c.mainRank === 7);
    expect(straights.length).toBeGreaterThanOrEqual(1); // 自然 34567 至少在
    expect(straights.some((c) => c.cards.some((x) => x.suit === 'H' && x.rank === 11))).toBe(false); // 万能代 7 变体不在
  });
});
