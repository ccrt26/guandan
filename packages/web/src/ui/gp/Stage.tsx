import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { CardItem, PlayedVM, StageVM } from './viewmodel';
import './gp.css';

/**
 * 2560×1440 固定设计画布 Stage（docs/全元素精确规格.md）。
 * 父容器 scale=min(1, innerWidth/2560)，整体等比缩放，任何 resize 重算，
 * 不允许横纵独立拉伸。所有坐标为画布内绝对 px。
 */

export const CANVAS_W = 2560;
export const CANVAS_H = 1440;
export const CARD_W = 184;
/** 21 张基准手牌行的几何中心 x（由批准图 x=560..2000 反推，推广布局复用） */
const HAND_ROW_CENTER = 1370 + 184 / 2 - 184 / 2 + 2; // = 1372，展开写以便对照批准图
const HAND_STEP = 72;
const HAND_SPAN = 1440; // 2000-560：允许的手牌行横跨

/**
 * 手牌位姿。21 张时精确复刻批准图公式：
 *   x=560+72i；t=(i-10)/10；y=944+18t²；CSS rotate(+2t deg)
 * （原 layout JSON 的 Pillow 角度为 -2t：Pillow 正角逆时针，CSS 正角顺时针，概念相同符号相反。）
 * 推广（0/1/27 张等真实局 faced）：步距=min(72, 1440/(n-1))，行中心固定 1372，
 * 弧线与角度公式同源；不硬缩字、不让牌越界。
 * 返回值即 CSS 角度，调用方不要再取反。
 */
export function handPose(i: number, n: number): { x: number; y: number; angle: number } {
  if (n <= 0) return { x: 0, y: 0, angle: 0 };
  const c = (n - 1) / 2;
  const step = n > 1 ? Math.min(HAND_STEP, HAND_SPAN / (n - 1)) : HAND_STEP;
  const first = HAND_ROW_CENTER - ((n - 1) * step + CARD_W) / 2;
  const t = n > 1 ? (i - c) / c : 0;
  return { x: first + step * i, y: 944 + 18 * t * t, angle: 2 * t };
}

/** 已出牌区几何（批准图精确值；north/west 为真实对局扩展位） */
export function playedPose(index: number, zone: 'east' | 'self' | 'north' | 'west', count: number): { x: number; y: number; w: number } {
  if (zone === 'east') return { x: 1600 + 84 * index, y: 590, w: 174 };
  if (zone === 'self') return { x: 1030 + 88 * index, y: 702, w: 166 };
  // 扩展位：北家牌行在队友牌下方居中；西家牌行在其玩家牌右侧
  if (zone === 'north') {
    const step = 70;
    const total = (count - 1) * step + 150;
    return { x: 1280 - total / 2 + step * index, y: 430, w: 150 };
  }
  return { x: 420 + 70 * index, y: 645, w: 150 };
}

const SUIT_CN: Record<string, string> = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };
const ASSET_BASE = '/cards54/';

function cardName(code: string): string {
  if (code === 'BJ') return '小王';
  if (code === 'RJ') return '大王';
  const rank = code.slice(0, code.length - 1);
  const suit = SUIT_CN[code.slice(-1)] ?? '';
  return `${suit}${rank}`;
}

function CardFace({ item, pose, z, interactive, selected, disabled, onSelect, onImageError }: {
  item: CardItem;
  pose: { x: number; y: number; w: number; angle: number };
  z: number;
  interactive: boolean;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: (instanceId: string) => void;
  onImageError?: (code: string) => void;
}) {
  const style = {
    left: pose.x,
    top: pose.y,
    '--w': `${pose.w}px`,
    '--a': `${pose.angle}deg`,
    '--z': z,
  } as CSSProperties;
  const face = (
    <span className="card-pose">
      <img
        src={`${ASSET_BASE}${item.code}.png`}
        alt=""
        draggable={false}
        onError={() => onImageError?.(item.code)}
      />
      {item.wild && <span className="wild-badge">配</span>}
    </span>
  );
  const cls = `card${item.wild ? ' wild' : ''}${interactive ? ' selectable' : ''}`;
  if (!interactive) {
    return (
      <div className={cls} style={style} aria-label={cardName(item.code) + (item.wild ? '，配牌标记' : '')}>
        {face}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      style={style}
      aria-pressed={selected}
      aria-label={cardName(item.code) + (item.wild ? '，配牌标记' : '')}
      disabled={disabled}
      onClick={() => onSelect?.(item.instanceId)}
    >
      {face}
    </button>
  );
}

function PlayedZone({ vm, zone, onImageError }: { vm: PlayedVM; zone: 'east' | 'self' | 'north' | 'west'; onImageError?: (code: string) => void }) {
  if (vm.status !== 'cards') return null;
  return (
    <>
      {vm.cards.map((item, i) => (
        <CardFace
          key={item.instanceId}
          item={item}
          pose={{ ...playedPose(i, zone, vm.cards.length), angle: 0 }}
          z={20 + i}
          interactive={false}
          onImageError={onImageError}
        />
      ))}
    </>
  );
}

function useStageScale(): number {
  const [scale, setScale] = useState(() => Math.min(1, window.innerWidth / CANVAS_W));
  useEffect(() => {
    const onResize = () => setScale(Math.min(1, window.innerWidth / CANVAS_W));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

export interface StageProps {
  vm: StageVM;
  overlay?: ReactNode;
  toast?: string | null;
  onSelect?: (instanceId: string) => void;
  onPlay?: () => void;
  onPass?: () => void;
  onHint?: () => void;
  /** 提示来源标注（启发式轮换项 + 新 AI 首选） */
  hintInfo?: { heur: string; neural: string | null } | null;
  onBack?: () => void;
  onNav?: (target: 'train' | 'stats' | 'review') => void;
  onSettings?: () => void;
  onEscape?: () => void;
  onImageError?: (code: string) => void;
}

export function Stage({
  vm, overlay, toast, onSelect, onPlay, onPass, onHint, onBack, onNav, onSettings, onEscape, onImageError, hintInfo,
}: StageProps) {
  const scale = useStageScale();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape]);

  return (
    <div id="gp-root">
      <div
        id="gp-viewport"
        style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}
      >
        <main id="gp-stage" style={{ transform: `scale(${scale})` }} aria-label="掼蛋打牌界面">
          <header className="topbar">
            <a
              className="brand"
              href="#train"
              onClick={(e) => { e.preventDefault(); onNav?.('train'); }}
            >
              <span className="brand-mark" aria-hidden="true">♠<i>♠</i><b>♦</b></span>
              <span>掼蛋训练场</span>
            </a>
            <nav aria-label="主导航">
              <button className="nav active" onClick={() => onNav?.('train')}>训练</button>
              <button className="nav" onClick={() => onNav?.('stats')}>战绩</button>
              <button className="nav" onClick={() => onNav?.('review')}>复盘</button>
              <button className="settings" aria-label="设置" onClick={() => onSettings?.()}>⚙</button>
            </nav>
          </header>

          <section className="toolbar">
            <button className="back" onClick={() => onBack?.()}>← 返回</button>
            <div className="levels">
              <span className="level">我方 <strong>{vm.levels.own}</strong></span>
              <i aria-hidden="true" />
              <span className="level">对方 <strong>{vm.levels.other}</strong></span>
              <span className="wild-rule">{vm.wildRule}</span>
            </div>
            <span className="game-status">{vm.status}</span>
          </section>

          {vm.notice?.visible && (
            <div className="notice" role="status">
              <span className="info" aria-hidden="true">i</span>
              <span>{vm.notice.text}</span>
            </div>
          )}

          <section className="table" aria-label="牌桌" />

          {vm.players.map((p) => (
            <section key={p.seat} className={`player ${p.seat}`} aria-label={`${p.seat === 'north' ? '队友' : `${p.seat === 'west' ? '西家' : '东家'} 对手`}`}>
              <span className="avatar" aria-hidden="true" />
              <div>
                <span className="player-name">
                  {p.name}
                  {p.role === 'opponent' && <small>对手</small>}
                </span>
                <p>
                  <strong>{p.remaining}</strong> 张
                </p>
              </div>
              {p.rankIdx !== null && <span className="sp-rank">{['🏆 头游', '🥈 二游', '🥉 三游', '📌 末游'][p.rankIdx]}</span>}
            </section>
          ))}

          {vm.passes.north && <div className="pass north-pass">不出</div>}
          {vm.passes.west && <div className="pass west-pass">不出</div>}
          {vm.passes.east && <div className="pass east-pass">不出</div>}
          {vm.passes.self && <div className="pass self-pass">不出</div>}

          <div className="zone-label east-label">东家出牌</div>
          <div className="zone-label own-label">我方出牌</div>

          <div className="cards-layer" aria-label="东家已出的牌">
            <PlayedZone vm={vm.playedEast} zone="east" onImageError={onImageError} />
          </div>
          <div className="cards-layer" aria-label="我方已出的牌">
            <PlayedZone vm={vm.playedSelf} zone="self" onImageError={onImageError} />
          </div>
          <div className="cards-layer" aria-label="北家已出的牌">
            <PlayedZone vm={vm.playedNorth} zone="north" onImageError={onImageError} />
          </div>
          <div className="cards-layer" aria-label="西家已出的牌">
            <PlayedZone vm={vm.playedWest} zone="west" onImageError={onImageError} />
          </div>

          <div className="cards-layer" aria-label="我的手牌，可选中">
            {vm.hand.map((item, i) => (
              <CardFace
                key={item.instanceId}
                item={item}
                pose={{ ...handPose(i, vm.hand.length), w: CARD_W }}
                z={20 + i}
                interactive={vm.selectable}
                selected={vm.selectedIds.includes(item.instanceId)}
                onSelect={onSelect}
                onImageError={onImageError}
              />
            ))}
          </div>

          <div className="hand-tag">
            <span className="avatar" aria-hidden="true" />
            <span>我的手牌</span>
          </div>
          <span className="hand-count">{vm.hand.length} 张</span>

          <footer className="actions">
            <span className="action-message">
              <span className="info" aria-hidden="true">i</span>
              <span>{vm.actions.message}</span>
            </span>
            <div className="action-buttons">
              <button onClick={() => onPass?.()} disabled={!vm.actions.canPass}>不出</button>
              <button onClick={() => onHint?.()} disabled={!vm.actions.canHint}>提示</button>
              {hintInfo && (
                <div className="hint-src">
                  <div>提示（启发式中级）：{hintInfo.heur}</div>
                  {hintInfo.neural != null && <div>新 AI 首选：{hintInfo.neural}</div>}
                </div>
              )}
              <button className="primary" onClick={() => onPlay?.()} disabled={!vm.actions.canPlay}>
                {vm.actions.playLabel}
              </button>
            </div>
          </footer>

          {toast && (
            <div className="toast" role="status">
              {toast}
            </div>
          )}
          {overlay}
        </main>
      </div>
    </div>
  );
}
