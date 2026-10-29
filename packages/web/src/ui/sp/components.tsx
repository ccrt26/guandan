import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { StatsRowVM, StatsVM } from './viewmodel';

/**
 * 战绩页七个区块组件（规格执行令第2步的拆分）。
 * 全部真实 DOM 文本/表格/按钮，图标用单色 SVG（public/sp/icons.svg），
 * 不把整页 PNG 当背景。坐标与样式在 sp.css（来源 layout.json + 规格，PNG 优先）。
 */

const ICONS = '/sp/icons.svg';

function Icon({ name, className }: { name: 'spade' | 'check' | 'more' | 'club'; className?: string }) {
  return <svg className={className} aria-hidden="true"><use href={`${ICONS}#${name}`} /></svg>;
}

/* ---------- 1. AppHeader ---------- */
export type AppSection = 'train' | 'stats' | 'review';

export function AppHeader({ active = 'stats', onNav, onSettings }: {
  active?: AppSection;
  onNav: (v: AppSection) => void;
  onSettings: () => void;
}) {
  return (
    <header className="sp-header">
      <a
        className="sp-brand"
        href="#train"
        onClick={(e) => { e.preventDefault(); onNav('train'); }}
      >
        <Icon name="spade" className="sp-brand-mark" />
        <span>掼蛋训练场</span>
      </a>
      <nav className="sp-nav" aria-label="主导航">
        {([{key:'train',label:'训练'},{key:'stats',label:'战绩'},{key:'review',label:'复盘'}] as const).map(item =>
          <button key={item.key} className={`sp-nav-item${active===item.key?' sp-nav-active':''}`}
            aria-current={active===item.key?'page':undefined} onClick={() => onNav(item.key)}>{item.label}</button>)}
        <button className="sp-settings" aria-label="设置" onClick={onSettings}>
          <span className="sp-gear" aria-hidden="true">⚙</span>
        </button>
      </nav>
    </header>
  );
}

/* ---------- 2. PageHeading ---------- */
export function PageHeading() {
  return (
    <section className="sp-heading">
      <h1>我的战绩</h1>
      <p>每一局，都有记录。</p>
    </section>
  );
}

/* ---------- 3. RecentResults（最近6场，位于摘要条内） ---------- */
export function RecentResults({ recent }: { recent: boolean[] }) {
  return (
    <div className="sp-recent">
      <p>最近 {recent.length} 场</p>
      {recent.length === 0 ? (
        <p className="sp-recent-empty">暂无记录</p>
      ) : (
        <div className="sp-recent-dots" role="img" aria-label={`最近${recent.length}场全部获胜`}>
          {recent.map((win, i) => (
            <span key={i} className={`sp-check${win ? '' : ' sp-check-loss'}`} aria-label={win ? '胜' : '负'}>
              {win ? <Icon name="check" className="sp-check-mark" /> : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- 4. SummaryStrip ---------- */
export function SummaryStrip({ vm }: { vm: StatsVM }) {
  return (
    <section className="sp-summary" aria-label="战绩总览">
      <div className="sp-hero">
        <div className="sp-hero-rate">
          <strong>{vm.winRate === null ? '—' : `${Math.round(vm.winRate * 100)}%`}</strong>
          <span>总胜率</span>
        </div>
        <p className="sp-hero-wl">{vm.wins} 胜 · {vm.losses} 负</p>
        <Icon name="spade" className="sp-hero-watermark" />
      </div>
      <div className="sp-metric sp-m1"><b>{vm.games}</b><span>总场次</span></div>
      <div className="sp-metric sp-m2"><b>{vm.firstPlace}</b><span>头游次数</span></div>
      <div className="sp-metric sp-m3"><b>{vm.doubleUpper}</b><span>双上游取胜</span></div>
      <i className="sp-divider sp-d1" aria-hidden="true" />
      <i className="sp-divider sp-d2" aria-hidden="true" />
      <i className="sp-divider sp-d3" aria-hidden="true" />
      <RecentResults recent={vm.recent} />
    </section>
  );
}

/* ---------- 5. RecordsTable ---------- */
export function RecordsTable({ rows, onOpenReview, onDemoReview, demo }: {
  rows: StatsRowVM[];
  /** 查看复盘：live=接现有路由；fixture=演示提示 */
  onOpenReview?: (id: string) => void;
  onDemoReview?: () => void;
  demo?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [menuRow, setMenuRow] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuRow) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuRow(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuRow(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menuRow]);

  return (
    <div className="sp-records" ref={rootRef}>
      <table className="sp-table">
        <colgroup>
          <col style={{ width: 268 }} /><col style={{ width: 128 }} /><col style={{ width: 137 }} />
          <col style={{ width: 172 }} /><col style={{ width: 148 }} /><col style={{ width: 180 }} />
          <col style={{ width: 79 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="sp-th sp-th-time">对局时间</th>
            <th className="sp-th">结果</th>
            <th className="sp-th">排名</th>
            <th className="sp-th">特殊结果</th>
            <th className="sp-th">难度</th>
            <th className="sp-th">手数</th>
            <th className="sp-th"><span className="sp-sr">更多操作</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="sp-row sp-empty-row"><td colSpan={7}>暂无对局记录</td></tr>
          ) : rows.map((r) => {
            const selected = r.id === selectedId;
            return (
              <tr
                key={r.id}
                tabIndex={0}
                className={`sp-row${selected ? ' sp-row-selected' : ''}`}
                aria-selected={selected}
                onClick={() => setSelectedId(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(r.id); }
                }}
              >
                <td className="sp-td sp-td-time">{r.time}</td>
                <td className="sp-td"><span className={`sp-win${r.win ? '' : ' sp-win-loss'}`}>{r.result}</span></td>
                <td className="sp-td">{r.rank}</td>
                <td className="sp-td">
                  {r.special ? <span className="sp-special">{r.special}</span> : <span className="sp-missing">—</span>}
                </td>
                <td className="sp-td"><span className="sp-diff-pill">{r.difficulty}</span></td>
                <td className="sp-td">{r.hands === null ? <span className="sp-missing">—</span> : `${r.hands} 手`}</td>
                <td className="sp-td sp-td-more">
                  <button
                    className="sp-more"
                    aria-label={`${r.time} 更多操作`}
                    aria-expanded={menuRow === r.id}
                    onClick={(e) => { e.stopPropagation(); setMenuRow(menuRow === r.id ? null : r.id); }}
                  >
                    <Icon name="more" className="sp-more-icon" />
                  </button>
                  {menuRow === r.id && (
                    <div className="sp-menu" role="menu">
                      <button
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuRow(null);
                          if (demo) { onDemoReview?.(); return; }
                          onOpenReview?.(r.id);
                        }}
                      >
                        查看复盘
                      </button>
                      <button role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuRow(null); }}>关闭</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- 6. DifficultySummary ---------- */
export function DifficultySummary({ difficulty }: { difficulty: StatsVM['difficulty'] }) {
  return (
    <aside className="sp-aside">
      <h2 className="sp-aside-title">对手强度</h2>
      {difficulty.map((d) => (
        <section key={d.name} className="sp-diff-card">
          <header className="sp-diff-head">
            <span>{d.name}</span>
            <span className="sp-diff-games">{d.games} 场</span>
          </header>
          <p className="sp-diff-rate">胜率 {d.winRate === null ? '—' : `${Math.round(d.winRate * 100)}%`}</p>
          <div
            className="sp-track"
            role="img"
            aria-label={d.winRate === null ? `${d.name}暂无对局` : `${d.name}胜率${Math.round(d.winRate * 100)}%`}
          >
            <div
              className="sp-track-fill"
              style={{ width: d.winRate === null ? 0 : `${d.winRate * 100}%` }}
            />
          </div>
          <p className="sp-diff-wl">胜 {d.wins} · 负 {d.losses}</p>
          {d.name === '高级' && (
            <span className="sp-aside-watermark" aria-hidden="true">
              <Icon name="spade" className="sp-wm-a" />
              <Icon name="club" className="sp-wm-b" />
            </span>
          )}
        </section>
      ))}
    </aside>
  );
}

/* ---------- 7. PageFooter ---------- */
export function PageFooter() {
  return (
    <footer className="sp-footer">
      <span>本地记录 · 最多保留 40 场</span>
      <span>仅统计已记录对局</span>
    </footer>
  );
}

/* ---------- 右上斜压纹（低对比装饰，规格§2：保守实现） ---------- */
export function DecorCorner() {
  return (
    <div className="sp-decor" aria-hidden="true">
      <i /><i />
    </div>
  );
}

export const spStageStyle = (scale: number): CSSProperties => ({
  transform: `scale(${scale})`,
});
