import { useEffect, useState } from 'react';
import type { GameRecord } from '@gd/engine';
import { listRecords, loadRecord, type RecordMeta } from '../../game/storage';
import { DecorCorner, DifficultySummary, PageFooter, PageHeading, RecordsTable, SummaryStrip } from './components';
import { AppFrame } from '../AppFrame';
import { buildStatsVM } from './viewmodel';
import { fixtureStatsVM } from './fixture';
import './sp.css';

/**
 * 「我的战绩」整页 Stage：1672×941 固定设计画布，uniform contain 缩放
 * s=min(W/1672, H/941)，内容居中，禁止横纵独立拉伸（规格§1）。
 * 数据：live=listRecords()（40 条口径，浏览器本地）；DEV+?spfixture=1=data.json 冻结快照。
 * 「查看复盘」复用现有 openReview 路由，不新造路由体系；无删除入口（规格§8边界）。
 */

export function StatsPage({
  onNav, onOpenSettings, onOpenReview, embedded = false,
}: {
  embedded?: boolean;
  onNav?: (v: 'train' | 'stats' | 'review') => void;
  onOpenSettings?: () => void;
  onOpenReview?: (record: GameRecord) => void;
}) {
  const isFixture = import.meta.env.DEV && new URLSearchParams(window.location.search).has('spfixture');
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // 记录列表在挂载时读取一次（40 条口径，新→旧）
  const [records] = useState<RecordMeta[]>(() => listRecords());

  const vm = isFixture ? fixtureStatsVM() : buildStatsVM(records);

  const handleNav = (v: 'train' | 'stats' | 'review') => {
    if (isFixture && v !== 'stats') { setToast('演示：fixture 快照未连接现有路由'); return; }
    onNav?.(v);
  };
  const handleReview = (id: string) => {
    if (isFixture) { setToast('演示：fixture 快照未连接现有记录'); return; }
    const record = loadRecord(id);
    if (!record) { setToast('记录正文缺失，无法打开复盘'); return; }
    onOpenReview?.(record);
  };

  const content = (
      <div className="sp-content">
        <DecorCorner />
        <PageHeading />
        <SummaryStrip vm={vm} />
        <div className="sp-record-heading">
          <h2>对局记录</h2>
          <span>共 {vm.games} 场</span>
        </div>
        <RecordsTable rows={vm.rows} demo={isFixture} onOpenReview={handleReview} onDemoReview={() => setToast('演示：fixture 快照未连接现有记录')} />
        <DifficultySummary difficulty={vm.difficulty} />
        <PageFooter />
        {toast && <div className="sp-toast" role="status">{toast}</div>}
      </div>
  );
  return embedded ? content : <AppFrame active="stats" onNav={handleNav}
    onSettings={() => (isFixture ? setToast('演示：设置未连接') : onOpenSettings?.())}>{content}</AppFrame>;
}
