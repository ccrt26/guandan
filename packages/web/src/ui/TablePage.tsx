import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { canPass, legalReturnCards, type GameRecord , describeCombo } from '@gd/engine';
import './seat-config.css';
import { HUMAN_SEAT, type MatchController } from '../game/controller';
import { GameTable } from './gt/GameTable';
import { ExchangeHistory } from './gt/ExchangeHistory';
import { buildGameTableVM } from './gt/viewmodel';
import { gtFixtureVM } from './gt/fixture';
import type { GTPhase } from './gt/viewmodel';

/**
 * 打牌页：1800×874 牌桌（正常 + 贡还确认两状态）+ 真实对局状态。
 * 选牌是 UI 状态（本组件持有），牌型合法性/能否过牌/轮转一律问引擎（controller）。
 * DEV + ?gtfixture=1 渲染视觉 fixture（&gtstate=tribute 切贡还确认态），
 * 供确定性截图对比；gpfixture 作为旧参数别名仍可用。生产构建无此分支。
 */
export function TablePage({
  controller, onExit, onReview, onNavStats, onNavReview, onOpenSettings,
}: {
  controller: MatchController;
  onExit: () => void;
  onReview: (record: GameRecord) => void;
  onNavStats: () => void;
  onNavReview: () => void;
  onOpenSettings: () => void;
}) {
  const version = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const state = controller.state;

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fxSelected, setFxSelected] = useState<Set<string>>(new Set());
  const [hintIdx, setHintIdx] = useState(-1);
  // 自办项 4：提示来源如实标注 + 新 AI 首选行（两行各自标明来源）
  const [hintInfo, setHintInfo] = useState<{ heur: string; neural: string | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [historyOpen,setHistoryOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  const toastScope = useRef({ controller, gameNo: state?.match.gameNo });
  const seenDecision = useRef<MatchController['lastDecision']>(null);
  useEffect(() => {
    toastScope.current = { controller, gameNo: state?.match.gameNo };
    seenDecision.current = null;
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = null; };
  }, [controller, state?.match.gameNo]);

  const params = new URLSearchParams(window.location.search);
  const isFixture = import.meta.env.DEV && (params.has('gtfixture') || params.has('gpfixture'));
  const fixturePhase: GTPhase = isFixture && params.get('gtstate') === 'tribute' ? 'tribute-result'
    : isFixture && params.get('gtstate') === 'return-pick' ? 'return-pick' : 'normal';
  const fixtureCounts = isFixture && params.get('gtcounts') === 'boundary';
  const gpHandRaw = isFixture ? params.get('gthand') : null;
  const gpHandN = gpHandRaw === null ? null : Number(gpHandRaw);

  useEffect(() => {
    const outcome = controller.lastDecision;
    if (isFixture || !outcome || seenDecision.current === outcome) return;
    seenDecision.current = outcome;
    if (outcome.decisionKey.gameNo !== state?.match.gameNo || outcome.status !== 'fallback') return;
    if (outcome.source === 'remote_failure') showToast('外部模型本次未能完成决定，已由本地AI接手。');
    else if (outcome.source === 'local_override') showToast('上一手由本地AI接手（历史记录）');
  }, [controller, controller.lastDecision, state?.match.gameNo, isFixture, showToast]);
  const decisionError = isFixture ? null : controller.decisionError;
  const configurationError = decisionError && new Set(['revision_conflict','profile_not_found','invalid_profile_reference',
    'private_store_unavailable','private_store_requires_0600_regular_file','invalid_private_store','unsupported_protocol',
    'local_same_origin_required','configured_ai_missing']).has(decisionError);
  const scopedToast = toastScope.current.controller === controller && toastScope.current.gameNo === state?.match.gameNo ? toast : null;
  const runtimeToast = decisionError
    ? decisionError === 'execution_uncertain' ? '牌局已暂停，出牌结果尚未确认，请勿重复出牌。'
      : configurationError ? '牌局已暂停，请检查设置后再继续。'
      : '牌局已暂停，暂时无法完成本手决定，请返回检查。'
    : scopedToast ?? (!isFixture && controller.waitingRemote ? '正在等待外部模型决定…' : null);
  const runtimeToastRole = decisionError ? 'alert' : 'status';
  const saveError = isFixture ? null : controller.saveError;
  const canAdvanceAfterGame = !isFixture && controller.canAdvanceAfterGame;

  const ctx = state?.ctx ?? null;
  const toBeat = state?.lastCombo ?? null;
  const hand = useMemo(
    () => (state ? controller.sortedHand(HUMAN_SEAT) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, controller, state],
  );

  // 轮换后清空提示指针
  useEffect(() => {
    setHintIdx(-1);
  }, [version]);
  useEffect(() => {
    setHintInfo(null);
  }, [state?.moveNo, state?.match.gameNo]);

  // 局末保存成功后停留约1秒看清末手，再换局/退首页；写失败保留本页待重试。
  useEffect(() => {
    if (!canAdvanceAfterGame || !state?.over || state.result === null) return;
    const timer = setTimeout(() => {
      const s = controller.state;
      if (!s || !s.over || !controller.canAdvanceAfterGame) return;
      if (s.match.winner === null) controller.startGame();
      else onExit();
    }, 1000);
    return () => clearTimeout(timer);
  }, [state?.over, state?.result, controller, onExit, canAdvanceAfterGame]);

  const selectedCards = useMemo(() => hand.filter((c) => selected.has(c.id)), [hand, selected]);
  const validCombo = !isFixture && controller.humanTurn && selectedCards.length > 0 && ctx
    ? controller.validateSelection(selectedCards)
    : null;
  const canPassNow = !isFixture && state ? canPass(state) : false;

  // 人类选牌、点击过滤和引擎提交使用同一个手牌感知合法集合。
  const pendingReturn = state?.pendingReturns[0] ?? null;
  const myReturn = !isFixture && controller.humanReturning;
  const returnableIds = new Set(ctx ? legalReturnCards(hand, ctx).map(card => card.id) : []);
  const returnCard = myReturn && selectedCards.length === 1 && returnableIds.has(selectedCards[0].id)
    ? { card: selectedCards[0], to: pendingReturn!.to }
    : null;

  const play = useCallback(() => {
    if (isFixture) {
      showToast('演示：未判牌型，也未实际出牌。真实对局由引擎判定合法性。');
      return;
    }
    if (myReturn) {
      if (!returnCard) return;
      controller.submitReturn(returnCard.card);
      setSelected(new Set());
      setHintIdx(-1);
      return;
    }
    if (!validCombo) return;
    try {
      controller.humanPlay(validCombo);
    } catch (e) {
      // 引擎拒绝（理论上 validateSelection 已拦截）：保留选牌、提示错误、恢复可交互
      showToast(`出牌被拒绝：${String(e).slice(0, 80)}`);
      return;
    }
    setSelected(new Set());
    setHintIdx(-1);
  }, [validCombo, controller, myReturn, returnCard, showToast, isFixture]);

  const pass = useCallback(() => {
    if (isFixture) {
      showToast('演示：不出请求。真实对局是否允许过牌由规则引擎给出。');
      return;
    }
    controller.humanPass();
    setSelected(new Set());
    setHintIdx(-1);
  }, [controller, showToast, isFixture]);

  const doHint = useCallback(() => {
    if (isFixture) {
      showToast('演示：未调用 AI，也不生成出牌建议。');
      return;
    }
    if (myReturn) {
      const c = controller.returnHint();
      if (c) setSelected(new Set([c.id]));
      return;
    }
    const list = controller.hintCandidates();
    if (list.length === 0) return;
    const next = (hintIdx + 1) % list.length;
    setHintIdx(next);
    const item = list[next];
    if (item.combo) setSelected(new Set(item.combo.cards.map((c) => c.id)));
    else setSelected(new Set());
    const nh = controller.neuralHint();
    setHintInfo({
      heur: `${item.combo ? describeCombo(item.combo) : '不出'}（第 ${next + 1}/${list.length} 项，可再点轮换）`,
      neural: nh ? `本地提案（不调用API）：${nh.pass ? '不出' : nh.combo ? describeCombo(nh.combo) : '?'}` : null,
    });
  }, [controller, hintIdx, myReturn, showToast, isFixture]);

  // 键盘快捷键：空格出牌/还牌 / P 不要 / H 提示（Esc 清选牌由 Stage 接管）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isFixture || historyOpen) return;
      // Focused controls own Space/Enter. Table shortcuts apply to the table
      // itself, never turn a focused “提示”/“返回” into an accidental play.
      if (e.target instanceof HTMLElement && e.target.closest('button,input,textarea,select,[contenteditable]')) return;
      if (myReturn) {
        if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); play(); }
        else if (e.key === 'h' || e.key === 'H') doHint();
        return;
      }
      if (!controller.humanTurn) return;
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); play(); }
      else if (e.key === 'p' || e.key === 'P') pass();
      else if (e.key === 'h' || e.key === 'H') doHint();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, play, pass, doHint, myReturn, isFixture, historyOpen]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setFxSelected(new Set());
    setToast(null);
    setHistoryOpen(false);
  }, []);

  const onImageError = useCallback((code: string) => {
    showToast(`缺少牌面文件：${code}.png —— 请确认 public/cards54/ 部署完整。`);
  }, [showToast]);

  // ---- VM ----
  // version 必须在依赖里：引擎原地复用同一个 GameState 对象（引用不变），
  // store 通知驱动的重渲染只有靠 version 才能重建 vm，否则 UI 冻结在旧快照。
  const vm = useMemo(() => {
    if (isFixture) {
      const base = gtFixtureVM(fixturePhase, params.has('gtpass'));
      // &gthand=N：手牌张数边界测试（27/28…；仅在 fixture 生效）
      const hand = gpHandN === null || Number.isNaN(gpHandN)
        ? base.hand
        : Array.from({ length: Math.max(0, gpHandN) }, (_, i) => base.hand[i % base.hand.length]).map((c, i) => ({ ...c, instanceId: `gtn-${i}` }));
      const players = fixtureCounts ? base.players.map(player => ({ ...player, remaining: player.seat === 'north' ? 0
        : player.seat === 'west' ? 9 : player.seat === 'east' ? 27 : player.remaining })) : base.players;
      return { ...base, players, hand, selectedIds: [...fxSelected] };
    }
    if (!state) return null;
    return buildGameTableVM(controller, state, { selection: selected, validCombo, returnCard });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, isFixture, fixturePhase, fixtureCounts, gpHandN, fxSelected, controller, state, selected, validCombo, returnCard]);

  if (!vm) return controller.exchangeError ? <main className="gt-recovery" role="alert">
    <h1>暂时无法恢复牌局</h1><p>{controller.exchangeError}</p>
    <button onClick={onExit}>返回</button>
  </main> : null;

  return (
    <>
    <GameTable
      vm={vm}
      overlay={saveError ? <section className="gt-history" role="alert" aria-label="本局保存未完成">
        <header><h2>本局保存未完成</h2></header>
        <p>{saveError}。已暂停后续出牌和自动换局，请保持本页，不要刷新或离开。</p>
        <p>恢复浏览器存储后可以重试保存，不会重新出牌或重复计算已保存的战绩。</p>
        <button onClick={() => controller.retryGameSave()}>重试保存</button>
      </section> : historyOpen && !isFixture ? <ExchangeHistory entries={controller.exchangeHistory} onClose={()=>setHistoryOpen(false)} /> : null}
      toast={runtimeToast}
      toastRole={runtimeToastRole}
      demo={isFixture}
      onSelect={(instanceId) => {
        setHintIdx(-1);
        if (isFixture) {
          // fixture：选择是纯 UI 演示（与参考包 demo 同语义），不触碰真实对局
          setFxSelected((prev) => {
            const next = new Set(prev);
            if (next.has(instanceId)) next.delete(instanceId);
            else next.add(instanceId);
            return next;
          });
          return;
        }
        const id = instanceId.startsWith('c') ? Number(instanceId.slice(1)) : null;
        if (id === null || Number.isNaN(id)) return;
        if (myReturn) {
          const card = hand.find((c) => c.id === id);
          if (!card || !returnableIds.has(card.id)) return;
          setSelected(new Set([id]));
          return;
        }
        setSelected((prev) => {
          const nextSet = new Set(prev);
          if (nextSet.has(id)) nextSet.delete(id);
          else nextSet.add(id);
          return nextSet;
        });
      }}
      onPlay={play}
      onPass={pass}
      onHint={doHint}
      onAck={() => {
        if (isFixture) {
          showToast('演示：确认只解除门控，不换牌、不推进 AI（真实对局由控制器处理）。');
          return;
        }
        if (!vm.exchange) return;
        const ok=controller.acknowledgeExchange(vm.exchange.version);
        if (!ok && controller.exchangeAckPending) showToast(controller.exchangeError ?? '结果已更新，请重新查看后点击继续。');
      }}
      onHistory={!isFixture && controller.exchangeHistory.length>0 ? ()=>setHistoryOpen(true) : undefined}
      hintInfo={hintInfo}
      onBack={onExit}
      onNav={(t) => {
        if (t === 'stats') onNavStats();
        else if (t === 'review') onNavReview();
        // train：当前已在训练页，保持原行为（停留在牌桌）
      }}
      onSettings={onOpenSettings}
      onEscape={clearSelection}
      onImageError={onImageError}
    />
    </>
  );
}
