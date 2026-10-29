import { isWild } from '@gd/engine';
import type { Card, Combo, LevelCtx, Suit } from '@gd/engine';
import { RANK_NAME } from '@gd/engine';

/**
 * 卡牌视觉：MIT 开源矢量扑克（hayeah/playing-cards-assets，
 * 见 public/cards/LICENSE.txt）+ 掼蛋专属角标（级牌/逢人配/代入提示）。
 */

const SUIT_DIR: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const FACE: Record<number, string> = { 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };

export function cardAssetUrl(card: Card): string {
  if (card.suit === 'J') {
    return `/cards/${card.rank === 17 ? 'red' : 'black'}_joker.svg`;
  }
  const r = FACE[card.rank] ?? String(card.rank);
  return `/cards/${r}_of_${SUIT_DIR[card.suit]}.svg`;
}

interface CardBadges {
  wild: boolean;
  level: boolean;
}

export function cardBadges(card: Card, ctx: LevelCtx): CardBadges {
  const wild = isWild(card, ctx);
  const level = !wild && card.suit !== 'J' && ctx.ranks.has(card.rank);
  return { wild, level };
}

/** 手牌大卡（资产牌面 + 角标层） */
export function AssetCard({
  card, ctx, width, selected, ghost, onClick, style,
}: {
  card: Card;
  ctx: LevelCtx;
  width: number;
  selected?: boolean;
  /** 万能牌被代入成的点数（如 "Q"） */
  ghost?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const { wild, level } = cardBadges(card, ctx);
  const h = Math.round(width * 1.454);
  return (
    <div
      className={[
        'acard',
        selected ? 'is-selected' : '',
        wild ? 'is-wild' : '',
        level ? 'is-level' : '',
      ].join(' ')}
      style={{ width, height: h, ...style }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={ariaLabel(card, ctx)}
    >
      <img src={cardAssetUrl(card)} alt="" draggable={false} />
      {level && <span className="badge badge-level">级</span>}
      {wild && <span className="badge badge-wild" title="逢人配：可当任意牌（王除外）">配</span>}
      {ghost && <span className="badge badge-ghost">当{ghost}</span>}
    </div>
  );
}

/** 桌面小卡（出牌区 / 复盘），width 固定由 CSS 控制 */
export function AssetCardMini({
  card, ctx, ghost, attach,
}: {
  card: Card;
  ctx: LevelCtx;
  ghost?: string;
  /** 是否为三带二/钢板附带的对子 */
  attach?: boolean;
}) {
  const { wild, level } = cardBadges(card, ctx);
  return (
    <div className={`mcard${wild ? ' is-wild' : ''}${level ? ' is-level' : ''}${attach ? ' is-attach' : ''}`}>
      <img src={cardAssetUrl(card)} alt={ariaLabel(card, ctx)} draggable={false} />
      {wild && !ghost && <span className="mbadge">配</span>}
      {ghost && <span className="mbadge mghost">当{ghost}</span>}
    </div>
  );
}

/** 出牌区组合展示（含万能牌代入排序）；large 用于中央大展示。
 *  三带二/钢板所带的对子以小一号、错位下移呈现，与主体区分。 */
export function ComboCards({
  combo, ctx, ghost, large,
}: {
  combo: Combo | null | 'pass';
  ctx: LevelCtx;
  ghost?: boolean;
  large?: boolean;
}) {
  if (combo === null) return null;
  if (combo === 'pass') return <span className="pass-pill">不出</span>;
  const wilds = new Map(combo.wildAs.map((w) => [w.cardId, w.asRank]));
  const attachRanks = new Set(combo.pairRanks);
  // A 作 1 的序列牌型按 A2345 顺序展示（A 排最前）：序列型 + 含 A + mainRank < A（A 在低端）
  const aceLow =
    (combo.kind === 'straight' || combo.kind === 'flush' || combo.kind === 'pair_seq' || combo.kind === 'trio_seq') &&
    combo.cards.some((c) => c.rank === 14) &&
    combo.mainRank < 14;
  const cards = [...combo.cards].sort((a, b) => {
    const ra = wilds.get(a.id) ?? a.rank;
    const rb = wilds.get(b.id) ?? b.rank;
    const ka = aceLow && ra === 14 ? 0 : ra;
    const kb = aceLow && rb === 14 ? 0 : rb;
    const aa = attachRanks.has(ra) ? 1 : 0;
    const ab = attachRanks.has(rb) ? 1 : 0;
    return ka - kb || aa - ab || a.suit.localeCompare(b.suit);
  });
  return (
    <div className={`combo-cards${large ? ' combo-lg' : ''}`}>
      {cards.map((card) => {
        const ra = wilds.get(card.id) ?? card.rank;
        return (
          <AssetCardMini
            key={card.id}
            card={card}
            ctx={ctx}
            ghost={ghost && wilds.has(card.id) ? shortRank(wilds.get(card.id)!) : undefined}
            attach={attachRanks.has(ra)}
          />
        );
      })}
    </div>
  );
}

/** 状态条上的迷你牌图标（级牌/配牌指示） */
export function TinyCard({ card, ctx, label }: { card: Card; ctx: LevelCtx; label?: string }) {
  return (
    <span className="tiny-card" title={label}>
      <img src={cardAssetUrl(card)} alt="" draggable={false} />
      {label && <b>{label}</b>}
    </span>
  );
}

function shortRank(rank: number): string {
  return RANK_NAME[rank];
}

function ariaLabel(card: Card, ctx: LevelCtx): string {
  const suitName: Record<Suit, string> = { S: '黑桃', H: '红桃', D: '方块', C: '梅花', J: '' };
  if (card.suit === 'J') return card.rank === 17 ? '大王' : '小王';
  const b = cardBadges(card, ctx);
  return `${suitName[card.suit]}${RANK_NAME[card.rank]}${b.wild ? '（逢人配）' : b.level ? '（级牌）' : ''}`;
}
