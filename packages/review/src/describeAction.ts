/**
 * packages/review/src/describeAction.ts — R2（REVIEW2-EXEC §4.3 展示例）：
 * "实际出牌：♠8、♥5；声明：8 的对子；♥5 在本动作中代作 8。"
 * 所有牌型都显示代入（F03），不只顺子/同花。展示例的适用前提=该局确实以该点数为万能牌
 * 且声明来自已核实的回放/记录，不得套用到其它局。
 */
import { RANK_NAME, SUIT_GLYPH, type Card, type Combo } from '@gd/engine';

export function cardText(c: Card): string {
  return c.suit === 'J' ? (c.rank === 17 ? '大王' : '小王') : `${SUIT_GLYPH[c.suit]}${RANK_NAME[c.rank]}`;
}

export function cardsText(cards: Card[]): string {
  return cards.map(cardText).join(' ');
}

/** 代入标注：♥5(当8)。前提：combo.wildAs 已由回放/记录核实 */
function wildMark(combo: Combo): (c: Card) => string {
  return (c: Card) => {
    const w = combo.wildAs.find((x) => x.cardId === c.id);
    return w ? `${cardText(c)}(当${RANK_NAME[w.asRank]})` : cardText(c);
  };
}

/** 完整动作描述：物理牌（含代入）+ 声明牌型 */
export function describeAction(combo: Combo | null): string {
  if (!combo) return '不出';
  const cards = combo.cards.map(wildMark(combo)).join('、');
  return `${cards}；声明：${kindText(combo)}`;
}

export function kindText(combo: Combo): string {
  const r = (n: number) => RANK_NAME[n];
  switch (combo.kind) {
    case 'single': return `单张 ${r(combo.mainRank)}`;
    case 'pair': return `对子 ${r(combo.mainRank)}${r(combo.mainRank)}`;
    case 'trio': return `三张 ${r(combo.mainRank)}${r(combo.mainRank)}${r(combo.mainRank)}`;
    case 'trio_pair': return `三带二 ${r(combo.mainRank)}³+${combo.pairRanks.map((x) => r(x) + r(x)).join('')}`;
    case 'straight': return `顺子（${combo.length}张连）`;
    case 'pair_seq': return `三连对（${combo.length}对连）`;
    case 'trio_seq': return `钢板（${combo.length}连三）`;
    case 'bomb': return `${combo.size}张炸弹 ${r(combo.mainRank).repeat(combo.size)}`;
    case 'flush': return `同花顺 ${SUIT_GLYPH[combo.suit ?? 'S']}`;
    case 'joker_bomb': return `天王炸`;
  }
}
