import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_RULES, RANK_NAME, type RuleOptions } from '@gd/engine';
import { loadWebSeats, loadSavedWebSeats, loadSavedWebPolicy, webReleaseChoices, webPolicyDescriptors } from './game/policy';
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
import { AISelectionModal } from './ui/AISelectionModal';
import { resolveNewGameSeats, resolveNewGameAssignments, validateNewGameSettings, newGameSettingsFromLegacy, type NewGameSettings, type AISelection } from './game/ai-selection';
import { createProfileClient, type PublicProfile } from './game/llm-profiles';
import { clearCurrentMatch, loadCurrentMatch, pruneOrphanReports, loadNewGameSettings, saveNewGameSettings } from './game/storage';

export type View = 'home' | 'table' | 'review' | 'history';
const DevAISelectionAudit = import.meta.env.DEV ? lazy(()=>import('./ui/DevAISelectionAudit')) : null;
const DevTableAudit = import.meta.env.DEV ? lazy(()=>import('./ui/gt/DevTableAudit')) : null;

export type AppSettings = NewGameSettings;
const selectionContext={policies:webPolicyDescriptors,choices:webReleaseChoices};
function initialSettings():{value:NewGameSettings|null;error:string|null} {
  try{return {value:loadNewGameSettings(),error:null};}
  catch(error){return {value:null,error:`新局偏好未加载，原值保留：${String(error)}`};}
}

export function App() {
  if(DevAISelectionAudit&&new URLSearchParams(window.location.search).has('aiselectionaudit'))return <Suspense fallback={<p>正在加载隔离验收夹具…</p>}><DevAISelectionAudit/></Suspense>;
  return <PlayerApp/>;
}
function PlayerApp() {
  const [view, setView] = useState<View>('home');
  const [settingsState,setSettingsState]=useState(initialSettings);
  const settings=settingsState.value;
  const [showAISelection,setShowAISelection]=useState(false);
  const [publicProfiles,setPublicProfiles]=useState<PublicProfile[]>(()=>createProfileClient({storage:localStorage,fetchImpl:fetch}).cached());
  const [controller, setController] = useState<MatchController | null>(null);
  const [reviewRecord, setReviewRecord] = useState<GameRecord | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [homeTick, setHomeTick] = useState(0);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const startMatch = useCallback(async () => {
    if(!settings){setPolicyError(settingsState.error);return;}
    const next=settings;
    const operation = ++loadGeneration.current;
    const rules: RuleOptions = { ...DEFAULT_RULES, passA: next.passA };
    // 开发期自动驾驶（?autopilot=1）：生产构建直接忽略
    setPolicyError(null);
    let c: MatchController;
    try {
      const seats = await resolveNewGameSeats(next,selectionContext,loadWebSeats);
      if (operation !== loadGeneration.current) return;
      c = new MatchController({ difficulty: 1, rules, seats });
    } catch (error) { if(operation === loadGeneration.current)setPolicyError(`政策加载失败，未开始比赛：${String(error)}`); return; }
    // Failed loading/tier binding must not discard a saved game or substitute policy.
    clearCurrentMatch();
    setController(c);
    c.startGame();
    setView('table');
  }, [settings,settingsState.error]);

  const commitSettings=(value:NewGameSettings)=>{
    const next=validateNewGameSettings(value);saveNewGameSettings(next);setSettingsState({value:next,error:null});setPolicyError(null);
  };
  const changePassA=(passA:RuleOptions['passA'])=>{
    if(!settings)return;
    try{commitSettings({...settings,passA});}catch(error){setPolicyError(`规则未保存，原选择保留：${String(error)}`);}
  };
  const commitAI=(aiSelection:AISelection,profiles:readonly PublicProfile[])=>{
    const next=validateNewGameSettings({...(settings??newGameSettingsFromLegacy()),aiSelection});
    resolveNewGameAssignments(next,{...selectionContext,profiles});commitSettings(next);setPublicProfiles([...profiles]);
  };
  useEffect(()=>{
    if(!settings||settings.aiSelection.kind!=='explicit'||!settings.aiSelection.seats.some(s=>s.controller==='ai'&&s.mode==='hybrid'))return;
    let current=true;
    createProfileClient({storage:localStorage,fetchImpl:fetch}).refresh().then(profiles=>{if(current)setPublicProfiles(profiles);},()=>{if(current)setPublicProfiles([]);});
    return()=>{current=false;};
  },[settings]);

  const openReview = useCallback((record: GameRecord) => {
    loadGeneration.current++;
    controller?.destroy();
    setReviewRecord(record);
    setView('review');
  }, [controller]);

  const resumeMatch = useCallback(async () => {
    const operation = ++loadGeneration.current;
    controller?.destroy();
    const save = loadCurrentMatch();
    if (!save) return;
    setPolicyError(null);
    let c: MatchController;
    try {
      const seats = save.seatConfig ? await loadSavedWebSeats(save.seatConfig) : undefined;
      const loaded = seats ? undefined : await loadSavedWebPolicy(save.aiPolicy);
      if (operation !== loadGeneration.current) return;
      const latestSave = loadCurrentMatch();
      if (!latestSave || latestSave.snapshotRevision !== save.snapshotRevision || latestSave.savedAt !== save.savedAt) {
        setHomeTick(t=>t+1); return;
      }
      c = new MatchController({difficulty:save.difficulty,rules:save.ruleOpts,resumeMatch:save,
        ...(seats ? {seats} : {neuralPolicy:loaded!.policy,neuralTier:loaded!.tier})});
    } catch (error) { if(operation === loadGeneration.current)setPolicyError(`引用缺失或恢复被暂停：${String(error)}`); return; }
    setController(c);
    c.startGame();
    setView('table');
  }, [controller]);

  const abandonMatch = useCallback(() => {
    loadGeneration.current++;
    clearCurrentMatch();
    setHomeTick((t) => t + 1);
  }, []);

  // 卸载时清理控制器
  useEffect(() => () => controller?.destroy(), [controller]);

  // 启动时清理孤儿报告（对局已删但报告残留）；幂等，只跑一次
  useEffect(() => { pruneOrphanReports(); }, []);

  const navigate = (next: View) => { loadGeneration.current++; controller?.destroy(); setController(null); setView(next); };

  const settingsModal = <>{showSettings&&<SettingsModal onClose={() => setShowSettings(false)} />}{showAISelection&&<AISelectionModal value={settings} context={selectionContext} onConfirm={commitAI} onClose={()=>setShowAISelection(false)}/>}</>;

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
          onNavStats={() => navigate('history')}
          onNavReview={() => navigate('review')}
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
            navigate('home');
          }}
          onReview={(record) => openReview(record)}
          onNavStats={() => navigate('history')}
          onNavReview={() => navigate('review')}
          onOpenSettings={() => setShowSettings(true)}
        />
      </>
    );
  }

  return (
    <>
      {settingsModal}
      <AppFrame active={view==='history'?'stats':view==='review'?'review':'train'}
        onNav={section=>navigate(section==='train'?'home':section==='stats'?'history':'review')}
        onSettings={()=>setShowSettings(true)}>
        {view==='history' ? <StatsPage embedded onOpenReview={openReview} /> :
          view==='review' ? (reviewRecord ?
            <ReviewPage record={reviewRecord} settings={settings??newGameSettingsFromLegacy()} onBack={()=>setReviewRecord(null)} /> :
            <ReviewPicker onOpen={openReview} />) :
          <HomePage key={homeTick} settings={settings} profiles={publicProfiles} context={selectionContext} error={policyError??settingsState.error} onPassA={changePassA} onAISelection={()=>setShowAISelection(true)} onStart={startMatch} onResume={resumeMatch} onAbandon={abandonMatch} />}
      </AppFrame>
    </>
  );
}

export const rankName = RANK_NAME;
