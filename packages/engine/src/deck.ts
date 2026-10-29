import { BIG_JOKER, SMALL_JOKER, type Card, type Rank, type Suit } from './types';
import { RNG } from './rng';

/** 两副牌 108 张：每个普通点数 4 花色 ×2 副，大小王各 2 张 */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of suits) {
      for (let rank = 2; rank <= 14; rank++) {
        cards.push({ id: id++, suit, rank });
      }
    }
    cards.push({ id: id++, suit: 'J', rank: SMALL_JOKER });
    cards.push({ id: id++, suit: 'J', rank: BIG_JOKER });
  }
  return cards;
}

/** 洗牌并发牌（4 家各 27 张），按玩家序返回 */
export function deal(rng: RNG): Card[][] {
  const deck = rng.shuffle(buildDeck());
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < 108; i++) hands[i % 4].push(deck[i]);
  for (const h of hands) sortHand(h);
  return hands;
}

/** 手牌排序：按牌点升序（需要级牌上下文时用 sortHandCtx） */
export function sortHand(hand: Card[]): void {
  hand.sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
}

/** 手牌排序：按本局牌力升序，同点按花色 */
export function sortHandCtx(hand: Card[], order: (r: Rank) => number): void {
  const suitOrder: Record<string, number> = { S: 0, H: 1, D: 2, C: 3, J: 4 };
  hand.sort((a, b) => order(a.rank) - order(b.rank) || suitOrder[a.suit] - suitOrder[b.suit]);
}
