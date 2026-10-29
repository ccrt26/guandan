/** 大规模验证：枚举产物（含新变体）全部通过新 isMoveLegal；classify 复认一致 */
import { enumerateCombos, legalCombos, makeLevelCtx, classify, comboKey, buildDeck, createMatch, DEFAULT_RULES, startGame, type Card } from '@gd/engine';
import { isMoveLegal, dedupCandidates } from '@gd/ai';
import { RNG } from '@gd/engine';

let checked = 0, variants = 0, guardRejects = 0, classifyMismatch = 0, dedupCollapses = 0;
const rng = new RNG(20261026);
// 覆盖多种级数（含双级 diverge 局面）+ 随机手牌
for (let trial = 0; trial < 400; trial++) {
  const l0 = 2 + Math.floor(rng.next() * 13), l1 = 2 + Math.floor(rng.next() * 13);
  const ctx = makeLevelCtx([l0, l1], 'both');
  const deck = buildDeck();
  // 随机 20~27 张手牌
  const n = 20 + Math.floor(rng.next() * 8);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const hand = deck.slice(0, n);
  const combos = enumerateCombos(hand, ctx, DEFAULT_RULES);
  const dedup = dedupCandidates(combos, true);
  if (dedup.length !== combos.length + 1) dedupCollapses++; // 去重不应吞掉枚举产物（pass +1）
  for (const c of combos) {
    checked++;
    if (c.wildAs.length > 0 && c.cards.some(x => x.suit === 'H' && ctx.ranks.has(x.rank))) variants++;
    // classify 复认（排除万能单张）
    if (c.cards.length !== 1 || !c.cards.some(x => x.suit === 'H' && ctx.ranks.has(x.rank) && x.rank < 15)) {
      const key = comboKey(c);
      if (!classify(c.cards, ctx, DEFAULT_RULES).some(k => comboKey(k) === key)) classifyMismatch++;
    }
    // isMoveLegal 接受（领出场景）
    const state = { hands: [hand, [], [], []], turn: 0, lastCombo: null, lastPlayer: 0, ctx, match: { opts: DEFAULT_RULES } } as never;
    if (!isMoveLegal(state, { pass: false, combo: c } as never)) guardRejects++;
  }
}
console.log(JSON.stringify({ trials: 400, checked, variants, guardRejects, classifyMismatch, dedupCollapses: dedupCollapses > 0 ? dedupCollapses : 0 }));
