import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_RULES, RANK_NAME, type RuleOptions } from '@gd/engine';
import type { Difficulty } from '@gd/ai';
import type { GameRecord } from '@gd/engine';
import { MatchController } from './game/controller';
import { fixtureControllerStub } from './ui/gp/fixture';
import { HomePage } from './ui/HomePage';
import { TablePage } from './ui/TablePage';
import { ReviewPage } from './ui/ReviewPage';
import { StatsPage } from './ui/StatsPage';
import { ReviewPicker } from './ui/ReviewPicker';
import { SettingsModal } from './ui/SettingsModal';
import { clearCurrentMatch, loadCurrentMatch, pruneOrphanReports } from './game/storage';

export type View = 'home' | 'table' | 'review' | 'history';

export interface AppSettings {
  difficulty: Difficulty;
  passA: RuleOptions['passA'];
  /** 实验性神经陪练（试用） */
  neuralTrial?: boolean;
}

export function App() {
  const [view, setView] = useState<View>('home');
  const [settings, setSettings] = useState<AppSettings>({ difficulty: 1, passA: 'head3' });
  const [controller, setController] = useState<MatchController | null>(null);
  const [reviewRecord, setReviewRecord] = useState<GameRecord | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [homeTick, setHomeTick] = useState(0);

  const startMatch = useCallback(async (next: AppSettings) => {
    setSettings(next);
    const rules: RuleOptions = { ...DEFAULT_RULES, passA: next.passA };
    // 开发期自动驾驶（?autopilot=1）：生产构建直接忽略
    const autopilot = import.meta.env.DEV && new URLSearchParams(window.location.search).has('autopilot');
    clearCurrentMatch(); // 开新比赛即放弃旧进度（存档点在局末，旧档只到上一局结束）
    let neural: ArrayBuffer | undefined;
    let neuralLoadError: string | undefined;
    if (next.neuralTrial) {
      try {
        const res = await fetch('ai/clean1.f32');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        neural = await res.arrayBuffer();
      } catch (e) {
        neuralLoadError = `权重加载失败：${String(e).slice(0, 120)}`;
        console.warn('[neural] 权重加载失败，本局使用启发式：', e);
      }
    }
    const c = new MatchController({ difficulty: next.difficulty, rules, autopilot, neuralOpponents: neural, neuralLoadError });
    setController(c);
    c.startGame();
    setView('table');
  }, []);

  const openReview = useCallback((record: GameRecord) => {
    setReviewRecord(record);
    setView('review');
  }, []);

  const resumeMatch = useCallback(() => {
    const save = loadCurrentMatch();
    if (!save) return;
    const c = new MatchController({ difficulty: save.difficulty, rules: save.ruleOpts, resumeMatch: save });
    setController(c);
    c.startGame();
    setView('table');
  }, []);

  const abandonMatch = useCallback(() => {
    clearCurrentMatch();
    setHomeTick((t) => t + 1);
  }, []);

  // 卸载时清理控制器
  useEffect(() => () => controller?.destroy(), [controller]);

  // 启动时清理孤儿报告（对局已删但报告残留）；幂等，只跑一次
  useEffect(() => { pruneOrphanReports(); }, []);

  const topNav = useMemo(
    () => (
      <div className="topbar">
        <div className="brand"><span className="tz-logo-s">♠</span><span className="tz-logo-d">♦</span>掼蛋训练场</div>
        <nav>
          <button className={view === 'home' || view === 'table' ? 'active' : ''} onClick={() => setView(controller && view === 'table' ? 'table' : 'home')}>训练</button>
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>战绩</button>
          <button className={view === 'review' ? 'active' : ''} onClick={() => setView('review')}>复盘</button>
          <button className="tz-gear" onClick={() => setShowSettings(true)} title="AI 教练（LLM）设置">⚙️</button>
        </nav>
      </div>
    ),
    [view, controller, reviewRecord, showSettings],
  );

  const settingsModal = showSettings ? <SettingsModal onClose={() => setShowSettings(false)} /> : null;

  // DEV 专用整页截图路由：?gpfixture=1 渲染批准图冻结数据（不开始真实对局）
  // 变体：&gphand=N 改手牌张数（0/1/27 边界测试）、&gplock=1 模拟非我方回合
  const gpFixture = import.meta.env.DEV && new URLSearchParams(window.location.search).has('gpfixture');
  if (gpFixture) {
    return (
      <>
        {settingsModal}
        <TablePage
          controller={fixtureControllerStub}
          onExit={() => setView('home')}
          onReview={() => {}}
          onNavStats={() => setView('history')}
          onNavReview={() => setView('review')}
          onOpenSettings={() => setShowSettings(true)}
        />
      </>
    );
  }

  if (view === 'table' && controller) {
    // 牌桌视图：整页 Stage 自带顶部导航（批准视觉），不再叠全局 topbar
    return (
      <>
        {settingsModal}
        <TablePage
          controller={controller}
          onExit={() => {
            controller.destroy();
            setController(null);
            setView('home');
          }}
          onReview={(record) => openReview(record)}
          onNavStats={() => setView('history')}
          onNavReview={() => setView('review')}
          onOpenSettings={() => setShowSettings(true)}
        />
      </>
    );
  }

  if (view === 'review') {
    return (
      <>
        {topNav}
        {settingsModal}
        {reviewRecord ? (
          <ReviewPage record={reviewRecord} settings={settings} onBack={() => setReviewRecord(null)} />
        ) : (
          <ReviewPicker onOpen={openReview} />
        )}
      </>
    );
  }

  if (view === 'history') {
    return (
      <>
        {topNav}
        {settingsModal}
        <StatsPage />
      </>
    );
  }

  return (
    <>
      {topNav}
      {settingsModal}
      <HomePage key={homeTick} settings={settings} onStart={startMatch} onResume={resumeMatch} onAbandon={abandonMatch} />
    </>
  );
}

export const rankName = RANK_NAME;
