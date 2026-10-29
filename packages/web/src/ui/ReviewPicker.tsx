import { useMemo, useState } from 'react';
import type { GameRecord } from '@gd/engine';
import { normalizeRecord, validateRecord } from '@gd/review';
import { DIFFICULTY_NAME } from '@gd/ai';
import { listRecords, loadRecord, setRecordFavorite } from '../game/storage';

const teamOf = (seat: number) => (seat % 2 === 0 ? 0 : 1);
type ResultFilter = 'all' | 'win' | 'loss';
type DiffFilter = 'all' | 0 | 1 | 2;

interface Row {
  meta: import('../game/storage').RecordMeta;
  rec: GameRecord | null;
  ok: boolean;
  reason: string;
  fav: boolean;
}

/** 复盘选择页（主从式）：左列表选局，右石墨灰摘要卡；单一 selectedReviewId 状态源 */
export function ReviewPicker({ onOpen }: { onOpen: (r: GameRecord) => void }) {
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<ResultFilter>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [difficulty, setDifficulty] = useState<DiffFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState('');

  const all = useMemo(() => listRecords().map((m) => {
    const rec = loadRecord(m.id);
    let ok = false;
    let reason = '';
    if (rec) {
      const v = validateRecord(normalizeRecord(rec));
      ok = v.ok;
      reason = v.reason ?? '';
    } else {
      reason = '记录数据缺失';
    }
    return { meta: m, rec, ok, reason, fav: m.favorite === true };
  }), [tick]);

  const visible = useMemo(() => {
    const winOf = (m: Row['meta']) => teamOf(m.humanSeat) === m.winnerTeam;
    const list = all.filter((r) => {
      if (result === 'win' && !winOf(r.meta)) return false;
      if (result === 'loss' && winOf(r.meta)) return false;
      if (favOnly && !r.fav) return false;
      if (difficulty !== 'all' && !(r.meta.difficulties.includes(difficulty))) return false;
      return true;
    });
    // 收藏置顶，组内时间倒序；失效记录沉底
    return list.sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      if (a.fav !== b.fav) return a.fav ? -1 : 1;
      return b.meta.createdAt - a.meta.createdAt;
    });
  }, [all, result, favOnly, difficulty]);

  // 单一选择源：所选被筛掉则回退到可见首条；无结果为 null
  const selected = useMemo(() => {
    if (selectedId) {
      const hit = visible.find((r) => r.meta.id === selectedId && r.ok);
      if (hit) return hit;
    }
    return visible.find((r) => r.ok) ?? null;
  }, [visible, selectedId]);

  const toggleFav = (id: string) => {
    const row = all.find((r) => r.meta.id === id);
    if (!row) return;
    setRecordFavorite(id, !row.fav);
    setTick((t) => t + 1);
  };

  const startReview = () => {
    if (!selected?.rec || !selected.ok) return;
    try {
      onOpen(normalizeRecord(selected.rec));
    } catch (e) {
      setOpenErr(`无法打开该局复盘：${(e as Error).message}`);
    }
  };

  const rankText = (rank: number) => `第${['一', '二', '三', '四'][rank - 1]}名`;
  const diffText = (m: Row['meta']) => DIFFICULTY_NAME[(m.difficulties.find((d) => d !== null) ?? 1) as 0 | 1 | 2];

  return (
    <div className="tz rv">
      <header className="tz-head">
        <div className="tz-head-title">
          <h1>复盘</h1>
          <p>回看每一步，理解每次选择。</p>
        </div>
      </header>

      <main className="tz-console rv-console">
        {/* 筛选横条 */}
        <div className="rv-filterbar">
          <div className="rv-fgroup">
            <span className="rv-flab">结果</span>
            <div className="rv-seg" role="radiogroup" aria-label="按结果筛选">
              {([['all', '全部'], ['win', '胜'], ['loss', '负']] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={result === v} className={result === v ? 'on' : ''} onClick={() => setResult(v)}>{label}</button>
              ))}
            </div>
          </div>
          <em className="rv-vsep" aria-hidden />
          <div className="rv-fgroup rv-fav">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
              <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.6Z" />
            </svg>
            <span className="rv-flab">仅收藏</span>
            <button type="button" role="switch" aria-checked={favOnly} aria-label="仅看收藏" className={`tz-switch${favOnly ? ' on' : ''}`} onClick={() => setFavOnly((v) => !v)}>
              <i />
            </button>
          </div>
          <em className="rv-vsep" aria-hidden />
          <div className="rv-fgroup">
            <span className="rv-flab">难度</span>
            <div className="rv-seg" role="radiogroup" aria-label="按对手强度筛选">
              {([['all', '不限'], [0, '初级'], [1, '中级'], [2, '高级']] as const).map(([v, label]) => (
                <button key={String(v)} type="button" role="radio" aria-checked={difficulty === v} className={difficulty === v ? 'on' : ''} onClick={() => setDifficulty(v as DiffFilter)}>{label}</button>
              ))}
            </div>
          </div>
          <span className="rv-count"><b>{visible.filter((r) => r.ok).length}</b> 场</span>
        </div>

        {/* 主体：左列表 + 右摘要 */}
        <div className="rv-body">
          <div className="rv-list">
            <div className="rv-thead" aria-hidden>
              <span>收藏</span><span>对局时间</span><span>结果与排名</span><span>难度与手数</span><span />
            </div>
            {visible.length === 0 && (
              <div className="rv-empty">
                <p>没有符合条件的记录。</p>
                <button type="button" className="rv-clear" onClick={() => { setResult('all'); setFavOnly(false); setDifficulty('all'); }}>清空筛选</button>
              </div>
            )}
            {visible.map((r) => {
              const win = teamOf(r.meta.humanSeat) === r.meta.winnerTeam;
              const isSel = selected?.meta.id === r.meta.id;
              return (
                <button
                  key={r.meta.id}
                  type="button"
                  role="radio"
                  aria-checked={isSel}
                  disabled={!r.ok}
                  className={`rv-row${isSel ? ' sel' : ''}${r.ok ? '' : ' bad'}`}
                  onClick={() => r.ok && setSelectedId(r.meta.id)}
                >
                  <span className="rv-starcell">
                    <span
                      role="button"
                      tabIndex={r.ok ? 0 : -1}
                      aria-pressed={r.fav}
                      aria-label={`${new Date(r.meta.createdAt).toLocaleString('zh-CN', { hour12: false })} · ${r.fav ? '取消收藏' : '收藏'}`}
                      className={`rv-star${r.fav ? ' on' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleFav(r.meta.id); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleFav(r.meta.id); }
                      }}
                    >{r.fav ? '★' : '☆'}</span>
                  </span>
                  <span className="rv-when">{new Date(r.meta.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  <span className="rv-result">
                    <span className={`rv-rchip ${win ? 'w' : 'l'}`}>{win ? '胜' : '负'}</span>
                    <b>{rankText(r.meta.humanRank)}</b>
                    {r.meta.doubleUp && <span className="rv-du">双上游</span>}
                  </span>
                  <span className="rv-meta">
                    {r.ok
                      ? <span className="rv-badge">{diffText(r.meta)} · {r.meta.moves} 手</span>
                      : <span className="rv-badd" title={r.reason}>无法复盘：{r.reason}</span>}
                  </span>
                  <span className="rv-chev" aria-hidden>›</span>
                </button>
              );
            })}
          </div>

          {/* 右：所选记录摘要（深石墨灰） */}
          <aside className="rv-detail" aria-live="polite">
            <span className="rv-dtag">当前对局</span>
            {selected ? (
              <>
                <p className="rv-date">{new Date(selected.meta.createdAt).toLocaleString('zh-CN', { hour12: false })}</p>
                <div className="rv-bigline">
                  <span className={`rv-rchip big ${teamOf(selected.meta.humanSeat) === selected.meta.winnerTeam ? 'w' : 'l'}`}>
                    {teamOf(selected.meta.humanSeat) === selected.meta.winnerTeam ? '胜' : '负'}
                  </span>
                  <b className="rv-bigrank">{rankText(selected.meta.humanRank)}</b>
                </div>
                <div className="rv-metaline">
                  <div><i>难度</i><b>{diffText(selected.meta)}</b></div>
                  <em aria-hidden />
                  <div><i>手数</i><b>{selected.meta.moves} 手</b></div>
                </div>
                {selected.meta.doubleUp && teamOf(selected.meta.humanSeat) === selected.meta.winnerTeam && (
                  <span className="rv-dubadge">双上游</span>
                )}
                <hr />
                <p className="rv-note">回放牌局，查看标注与讲解。</p>
                <button type="button" className="rv-start" onClick={startReview}>
                  开始复盘
                  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 18 18 6M9 6h9v9" />
                  </svg>
                </button>
                {openErr && <p className="rv-err">{openErr}</p>}
              </>
            ) : (
              <>
                <p className="rv-none">从左侧选择一局，这里显示该场摘要。</p>
                <button type="button" className="rv-start" disabled>开始复盘</button>
              </>
            )}
          </aside>
        </div>

        {/* 底部说明 */}
        <div className="rv-bottom">
          <span>☆ 收藏的对局优先显示</span>
          <span>共 {all.length} 场 · 最多保留 40 场</span>
        </div>
      </main>

      <footer className="tz-foot">
        <span>REVIEW / 02</span>
      </footer>
    </div>
  );
}
