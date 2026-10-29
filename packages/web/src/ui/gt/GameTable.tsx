import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CardItem, PlayedVM } from '../gp/viewmodel';
import type { GameTableVM } from './viewmodel';
import { getTableLayout, getPlayedLayout, type Rect, type TableLayout, type TableSeat } from './layout';
import './gt.css';

/**
 * 1800×874 牌桌（01_完整UI规格）：grid 三行 66 / 1fr / 85，桌面内部相对锚点，
 * 不用固定画布整体缩放；窄视口收手牌步长（§七），最低适配 1366×768。
 * 两状态：normal（含还贡选牌 return-pick）与 tribute-result（结果确认门）。
 * 贡还确认页主按钮文案严格为「继续」；确认页无不出/提示/出牌（§五）。
 */

const CARD_ASSET = '/cards54/';
const CARD_W = 135;
const useViewportLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const rectStyle = (r: Rect): React.CSSProperties => ({ left:r.x, top:r.y, width:r.width, height:r.height });

const SUIT_CN: Record<string, string> = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };

function cardName(code: string): string {
  if (code === 'BJ') return '小王';
  if (code === 'RJ') return '大王';
  return `${SUIT_CN[code.slice(-1)] ?? ''}${code.slice(0, -1)}`;
}

function CardImg({ item, w = CARD_W, interactive, selected, disabled, aria, style, onSelect, onImageError }: {
  item: CardItem;
  w?: number;
  interactive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  aria?: string;
  style?: React.CSSProperties;
  onSelect?: () => void;
  onImageError?: (code: string) => void;
}) {
  const h = Math.round(w * 880 / 630);
  const img = (
    <img src={`${CARD_ASSET}${item.code}.png`} alt="" draggable={false} onError={() => onImageError?.(item.code)} />
  );
  const cls = `gt-card${interactive ? ' selectable' : ''}${selected ? ' is-selected' : ''}`;
  const styleAll: React.CSSProperties = { width: w, height: h, ...style };
  if (!interactive) {
    return <span className={cls} style={styleAll} aria-label={aria}>{img}</span>;
  }
  return (
    <button
      type="button"
      className={cls}
      style={styleAll}
      aria-pressed={selected}
      aria-label={`${aria ?? cardName(item.code)}${item.wild ? '，配牌' : ''}${selected ? '，已选中' : ''}`}
      disabled={disabled}
      onClick={onSelect}
    >
      {img}
    </button>
  );
}

function PlayedZone({ vm, seat, layout, onImageError }: { vm: PlayedVM; seat:TableSeat; layout:TableLayout; onImageError?: (code: string) => void }) {
  if (vm.status !== 'cards') return null;
  const pose = getPlayedLayout(seat,vm.cards.length,layout);
  return (
    <div className={`gt-played gt-z-${seat}`} style={rectStyle(pose)} aria-label="已出的牌">
      {vm.cards.map((c, i) => (
        <CardImg key={c.instanceId} item={c} w={pose.cardWidth} style={{ left: i * pose.step, height:pose.height }} onImageError={onImageError} />
      ))}
    </div>
  );
}

function PlayerPill({ name, count, cls, showCount, rect }: { name: string; count: number; cls: string; showCount: boolean; rect:Rect }) {
  return (
    <div className={`gt-player ${cls}`} style={rectStyle(rect)} aria-label={`${name}${showCount ? `，剩余 ${count} 张` : ''}`}>
      <span className="gt-avatar" aria-hidden="true" />
      <span className="gt-player-name">{name}</span>
      {showCount && <span className="gt-player-count">{count} <i>张</i></span>}
    </div>
  );
}

export interface GameTableProps {
  vm: GameTableVM;
  hintInfo?: { heur: string; neural: string | null } | null;
  toast?: string | null;
  overlay?: ReactNode;
  /** fixture 视觉样例：面板标题带「· 示例」（生产不显示，规格§五） */
  demo?: boolean;
  onSelect?: (instanceId: string) => void;
  onPlay?: () => void;
  onPass?: () => void;
  onHint?: () => void;
  /** 贡还结果确认（主按钮「继续」） */
  onAck?: () => void;
  ackBusy?: boolean;
  onBack?: () => void;
  onNav?: (t: 'train' | 'stats' | 'review') => void;
  onSettings?: () => void;
  onEscape?: () => void;
  onImageError?: (code: string) => void;
  onHistory?: () => void;
}

export function GameTable({
  vm, hintInfo, toast, overlay, demo, onSelect, onPlay, onPass, onHint, onAck, ackBusy, onBack, onNav, onSettings, onEscape, onImageError, onHistory,
}: GameTableProps) {
  const tribute = vm.phase === 'tribute-result';
  const rootRef = useRef<HTMLDivElement>(null);
  const [size,setSize] = useState({width:1800,height:874});
  useViewportLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const compute = () => setSize(prev => prev.width===el.clientWidth && prev.height===el.clientHeight
      ? prev : {width:el.clientWidth,height:el.clientHeight});
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = vm.hand.length;
  const layout = getTableLayout(size.width,size.height,tribute,n,vm.selectedIds.length>0);
  const mid = (n - 1) / 2;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape]);

  const footerMessage = tribute ? (vm.exchangeError ?? (vm.exchange ? '贡还牌已完成' : '正在核对贡还结果')) : vm.actions.message;

  return (
    <div id="gt-root" ref={rootRef} data-phase={vm.phase} data-compact={layout.compact>0.5}
      data-layout-width={size.width} data-layout-height={size.height}
      style={{'--ui-scale':layout.scale,'--compact':layout.compact,
        gridTemplateRows:`${layout.headerHeight}px minmax(0,1fr) ${layout.footerHeight}px`} as React.CSSProperties}>
      <header className="gt-header">
        <div className="gt-left">
        <span className="gt-brand">
          <span className="gt-brand-mark" aria-hidden="true">♠<i>♠</i><b>♦</b></span>
          掼蛋训练场
        </span>
        <i className="gt-vline" aria-hidden="true" />
        <button className="gt-back" onClick={() => onBack?.()}>← 返回</button>
        </div>
        <span className="gt-levels">
          <span className="gt-level-pill">我方 <b>{vm.levels.own}</b></span>
          <span className="gt-level-pill">对方 <b>{vm.levels.other}</b></span>
          <span className="gt-wild" title={vm.wildRule}>配牌 <i className="gt-info" aria-hidden="true">i</i><span className="sp-sr">{vm.wildRule}</span></span>
        </span>
        <span className="gt-right">
          <span className="gt-phase">{vm.phaseLabel}</span>
          {onHistory && <button className="gt-history-button" aria-label="查看贡还历史" onClick={onHistory}>记录</button>}
          <i className="gt-vline" aria-hidden="true" />
          <nav className="gt-nav" aria-label="主导航">
            <button onClick={() => onNav?.('train')}>训练</button>
            <button onClick={() => onNav?.('stats')}>战绩</button>
            <button onClick={() => onNav?.('review')}>复盘</button>
          </nav>
          <button className="gt-sliders" aria-label="设置" onClick={() => onSettings?.()}>
            <span className="gt-slider-line" aria-hidden="true"><i style={{ left: 5 }} /></span>
            <span className="gt-slider-line" aria-hidden="true"><i style={{ left: 13 }} /></span>
          </button>
        </span>
      </header>

      <main className="gt-table">
        <PlayerPill name="队友" count={vm.players[0].remaining} cls="gt-p-north" showCount={!tribute} rect={layout.players.north} />
        <PlayerPill name="西家" count={vm.players[1].remaining} cls="gt-p-west" showCount={!tribute} rect={layout.players.west} />
        <PlayerPill name="东家" count={vm.players[2].remaining} cls="gt-p-east" showCount={!tribute} rect={layout.players.east} />

        {/* 「不出」徽章：各家出牌区中心（过牌时显示，结果确认页隐藏） */}
        {!tribute && (['north','west','east','self'] as const).map(seat => {
          if (!vm.passes[seat]) return null;
          const p=getPlayedLayout(seat,1,layout), width=120*layout.scale;
          const left=seat==='west'?p.x:seat==='east'?p.x+p.width-width:(size.width-width)/2;
          return <div key={seat} className={`gt-passpill gt-pass-${seat}`} role="status"
            aria-label={`${{north:'队友',west:'西家',east:'东家',self:'我方'}[seat]}不出`}
            style={{left,top:p.y+32*layout.scale,width}}>不出</div>;
        })}

        {!tribute && (
          <>
            <PlayedZone vm={vm.playedNorth} seat="north" layout={layout} onImageError={onImageError} />
            <PlayedZone vm={vm.playedWest} seat="west" layout={layout} onImageError={onImageError} />
            <PlayedZone vm={vm.playedEast} seat="east" layout={layout} onImageError={onImageError} />
            <PlayedZone vm={vm.playedSelf} seat="self" layout={layout} onImageError={onImageError} />
          </>
        )}

        {tribute && vm.exchange && (
          <section className="gt-panel" style={rectStyle(layout.panel)} aria-label="贡还结果">
            <h2 className="gt-panel-title"><i aria-hidden="true" />贡还牌{demo ? ' · 示例' : ''}<i aria-hidden="true" /></h2>
            {vm.exchange.pairs.map((p) => (
              <div key={p.id} className="gt-pair">
                <div className="gt-pair-side">
                  <p className="gt-pair-dir">{p.tribute.fromName} → {p.tribute.toName}</p>
                  <span className="gt-tag">贡牌</span>
                </div>
                <CardImg item={p.tribute.card} w={(90-13*layout.compact)*layout.scale} aria={`进贡牌：${cardName(p.tribute.card.code)}`} onImageError={onImageError} />
                <i className="gt-pair-vline" aria-hidden="true" />
                <div className="gt-pair-side">
                  <p className="gt-pair-dir">{p.ret.fromName} → {p.ret.toName}</p>
                  <span className="gt-tag">还牌</span>
                </div>
                <CardImg item={p.ret.card} w={(90-13*layout.compact)*layout.scale} aria={`还贡牌：${cardName(p.ret.card.code)}`} onImageError={onImageError} />
                <span className="gt-done">已完成</span>
              </div>
            ))}
          </section>
        )}
        {tribute && !vm.exchange && <section className="gt-panel gt-exchange-error" style={rectStyle(layout.panel)} role="alert">
          <h2>贡还结果暂不可用</h2><p>{vm.exchangeError ?? '正在核对贡还结果，请稍候。'}</p>
          <p>确认前暂停出牌，请通过返回入口恢复比赛。</p>
        </section>}

        <div className="gt-self-label" style={rectStyle(layout.selfLabel)} aria-label="我的手牌">
          <span className="gt-avatar" aria-hidden="true" />
          <span>我的手牌</span>
          {!tribute && <b>{n} <i>张</i></b>}
        </div>

        <div className="gt-hand" style={rectStyle(layout.hand)} aria-label={tribute ? '我的手牌（只读）' : '我的手牌，可选中'}>
          {vm.hand.map((c, i) => {
            const t = mid ? (i - mid) / mid : 0;
            const style: React.CSSProperties = {
              left: i * layout.hand.step,
              height:layout.hand.height,
              // 旋转走 CSS 变量：与 hover/选中抬升（--lift）在 transform 里组合，互不覆盖
              '--rot': `${(t * 1).toFixed(2)}deg`,
              top: 0,
              zIndex: 20 + i,
            } as React.CSSProperties;
            return (
              <CardImg
                key={c.instanceId}
                item={c}
                w={layout.hand.cardWidth}
                interactive={vm.selectable}
                selected={vm.selectedIds.includes(c.instanceId)}
                disabled={tribute}
                style={style}
                onSelect={() => onSelect?.(c.instanceId)}
                onImageError={onImageError}
              />
            );
          })}
        </div>

        {toast && <div className="gt-toast" role="status">{toast}</div>}
        {overlay}
      </main>

      <footer className="gt-footer">
        <span className="gt-message">
          <i className="gt-info big" aria-hidden="true">i</i>
          {footerMessage}
        </span>
        {tribute ? (
          <span className="gt-footer-actions">
            <button
              className="gt-btn primary gt-continue"
              onClick={() => onAck?.()}
              disabled={ackBusy || !vm.exchange || !vm.canAcknowledgeExchange}
              aria-label="继续"
            >
              继续
            </button>
          </span>
        ) : (
          <span className="gt-footer-actions">
            <button className="gt-btn" onClick={() => onPass?.()} disabled={!vm.actions.canPass}>不出</button>
            <button className="gt-btn" onClick={() => onHint?.()} disabled={!vm.actions.canHint}>提示</button>
            <span className="gt-play-wrap">
              {hintInfo && (
                <span className="gt-hint-src">
                  <span>提示（启发式中级）：{hintInfo.heur}</span>
                  {hintInfo.neural != null && <span>新 AI 首选：{hintInfo.neural}</span>}
                </span>
              )}
              <button className="gt-btn primary" onClick={() => onPlay?.()} disabled={!vm.actions.canPlay}>
                {vm.actions.playLabel}
              </button>
            </span>
          </span>
        )}
      </footer>
    </div>
  );
}
