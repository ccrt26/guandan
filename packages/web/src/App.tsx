import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { DEFAULT_RULES, RANK_NAME, type RuleOptions } from '@gd/engine';
import type { NeuralTier } from '@gd/ai';
import type { GameRecord } from '@gd/engine';
import { MatchController } from './game/controller';
import { fixtureControllerStub } from './ui/gp/fixture';
import { HomePage } from './ui/HomePage';
import { TablePage } from './ui/TablePage';
import { ReviewPage } from './ui/ReviewPage';
import { StatsPage } from './ui/sp/StatsPage';
import { ReviewPicker } from './ui/ReviewPicker';
import { SettingsModal } from './ui/SettingsModal';
import { AppFrame } from './ui/AppFrame';
import { clearCurrentMatch, loadCurrentMatch, pruneOrphanReports } from './game/storage';

export type View = 'home' | 'table' | 'review' | 'history';
const DevTableAudit = import.meta.env.DEV ? lazy(()=>import('./ui/gt/DevTableAudit')) : null;

export interface AppSettings {
  /** 难度三档（D1 锁定，作用于两个对手；队友固定满血新 AI） */
  tier: NeuralTier;
  passA: RuleOptions['passA'];
}

export function App() {
  const [view, setView] = useState<View>('home');
  const [settings, setSettings] = useState<AppSettings>({ tier: 'standard', passA: 'head3' });
  const [controller, setController] = useState<MatchController | null>(null);
  const [reviewRecord, setReviewRecord] = useState<GameRecord | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [homeTick, setHomeTick] = useState(0);

  const startMatch = useCallback(async (next: AppSettings) => {
    setSettings(next);
    const rules: RuleOptions = { ...DEFAULT_RULES, passA: next.passA };
    // 开发期自动驾驶（?autopilot=1）：生产构建直接忽略
    const autopilot = import.meta.env.DEV && new URLSearchParams(window.location.search).has('autopilot');
    clearCurrentMatch(); // 开新比赛放弃旧进度；继续比赛走恢复入口，不重新发牌。
    // 新 AI 为默认对手（clean2=ck-7051，D1 三档）；加载失败才回退启发式并横幅如实标注
    let neural: ArrayBuffer | undefined;
    let neuralLoadError: string | undefined;
    try {
      const res = await fetch('ai/clean2.f32');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      neural = await res.arrayBuffer();
    } catch (e) {
      neuralLoadError = `权重加载失败：${String(e).slice(0, 120)}`;
      console.warn('[neural] 权重加载失败，本局使用启发式：', e);
    }
    const c = new MatchController({ difficulty: 1, rules, autopilot, neuralOpponents: neural, neuralTier: next.tier, neuralLoadError });
    setController(c);
    c.startGame();
    setView('table');
  }, []);

  const openReview = useCallback((record: GameRecord) => {
    setReviewRecord(record);
    setView('review');
  }, []);

  const resumeMatch = useCallback(async () => {
    controller?.destroy();
    const save = loadCurrentMatch();
    if (!save) return;
    // 继续比赛：按存档时的对手口径恢复（中途不偷换难度）。旧档（无 aiPolicy）=当
    // 时就是启发式对手，按旧难度恢复；新档=新 AI+存档档位。神经加载失败回退启发式。
    let neural: ArrayBuffer | undefined;
    let neuralLoadError: string | undefined;
    if (save.aiPolicy?.startsWith('neural-tier')) {
      try {
        const res = await fetch('ai/clean2.f32');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        neural = await res.arrayBuffer();
      } catch (e) {
        neuralLoadError = `权重加载失败：${String(e).slice(0, 120)}`;
      }
    }
    const latestSave = loadCurrentMatch();
    if (!latestSave) return;
    // Another page may advance the save while weights load. Never resume the
    // stale object captured before the await. A changed AI policy needs a new load.
    if (latestSave.aiPolicy !== save.aiPolicy) {
      setHomeTick(t=>t+1);
      return;
    }
    const tier = latestSave.aiPolicy?.startsWith('neural-tier:')
      ? (latestSave.aiPolicy.split(':')[1] as NeuralTier)
      : 'hard';
    const c = new MatchController({ difficulty: latestSave.difficulty, rules: latestSave.ruleOpts, resumeMatch: latestSave, neuralOpponents: neural, neuralTier: tier, neuralLoadError });
    setController(c);
    c.startGame();
    setView('table');
  }, [controller]);

  const abandonMatch = useCallback(() => {
    clearCurrentMatch();
    setHomeTick((t) => t + 1);
  }, []);

  // 卸载时清理控制器
  useEffect(() => () => controller?.destroy(), [controller]);

  // 启动时清理孤儿报告（对局已删但报告残留）；幂等，只跑一次
  useEffect(() => { pruneOrphanReports(); }, []);

  const settingsModal = showSettings ? <SettingsModal onClose={() => setShowSettings(false)} /> : null;

  if (DevTableAudit && new URLSearchParams(window.location.search).has('gtaudit')) {
    return <Suspense fallback={<p>正在加载本地验收入口…</p>}><DevTableAudit /></Suspense>;
  }

  // DEV 专用整页截图路由：?gpfixture=1 渲染批准图冻结数据（不开始真实对局）
  // 变体：&gphand=N 改手牌张数（0/1/27 边界测试）、&gplock=1 模拟非我方回合
  const gpFixture = import.meta.env.DEV
    && (new URLSearchParams(window.location.search).has('gpfixture') || new URLSearchParams(window.location.search).has('gtfixture'));
  // DEV 专用战绩页截图路由：?spfixture=1 渲染 data.json 冻结快照（不读真实记录）
  const spFixture = import.meta.env.DEV && new URLSearchParams(window.location.search).has('spfixture');
  if (spFixture) {
    return (
      <>
        {settingsModal}
        <StatsPage
          onNav={(v) => setView(v === 'train' ? 'home' : v === 'stats' ? 'history' : 'review')}
          onOpenSettings={() => setShowSettings(true)}
          onOpenReview={() => {}}
        />
      </>
    );
  }
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

  return (
    <>
      {settingsModal}
      <AppFrame active={view==='history'?'stats':view==='review'?'review':'train'}
        onNav={section=>setView(section==='train'?'home':section==='stats'?'history':'review')}
        onSettings={()=>setShowSettings(true)}>
        {view==='history' ? <StatsPage embedded onOpenReview={openReview} /> :
          view==='review' ? (reviewRecord ?
            <ReviewPage record={reviewRecord} settings={settings} onBack={()=>setReviewRecord(null)} /> :
            <ReviewPicker onOpen={openReview} />) :
          <HomePage key={homeTick} settings={settings} onStart={startMatch} onResume={resumeMatch} onAbandon={abandonMatch} />}
      </AppFrame>
    </>
  );
}

export const rankName = RANK_NAME;
