import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeLevelCtx, RANK_NAME, type GameRecord } from '@gd/engine';
import {
  analyzeGame, classifyReplay, gradeIcon, normalizeRecord, replay, runCounterfactual, validateRecord,
  buildCoachMessages, buildOfflineReport, lintReportCards,
  type CounterfactualResult, type MoveAnalysis, type ReplayFrame, type ReviewAnalysis,
} from '@gd/review';
import { KNOWLEDGE, analyzeWithModel, type NnReviewSummary } from '@gd/review';
import { MLP, NEURAL_MODEL_VERSION } from '@gd/ai';
import { ComboCards, AssetCardMini } from './CardView';
import { Markdown } from './markdown';
import { TrickRecap } from './TrickRecap';
import { listRecords, loadReport, llmHeaders, loadLLMConfig, saveReport, setRecordFavorite, thinkingParams } from '../game/storage';
import type { AppSettings } from '../App';

const SEAT_NAMES = ['你', '东家', '队友', '西家'];
const SEAT_POS = ['south', 'east', 'north', 'west'] as const;

export function ReviewPage({
  record, settings, onBack,
}: {
  record: GameRecord;
  settings: AppSettings;
  onBack: () => void;
}) {
  void settings;
  // 旧版记录的 player 字段把出牌人记成了下家：先按牌张归属修正，再做完整性校验。
  // 数据损坏的记录绝不进分析——那会产出似是而非的错误建议（曾出现凭空的 4A 炸弹）。
  // R2：再按严格回放分级（exact/migrated_verified/ambiguous/invalid）；
  // ambiguous/invalid 禁用分析（评分/模型建议/续打依赖错误局面），只显示原因。
  const fix = useMemo(() => {
    const normalized = normalizeRecord(record);
    const check = validateRecord(normalized);
    if (!check.ok) return { record: normalized, error: check.reason ?? '记录数据损坏' };
    const cls = classifyReplay(normalized);
    if (cls.status === 'ambiguous' || cls.status === 'invalid') {
      return { record: normalized, error: `严格回放判为 ${cls.status}（第 ${cls.firstBadMove} 手：${cls.reason}）。评分与建议依赖被改写的局面，已禁用` };
    }
    return { record: normalized, error: null as string | null };
  }, [record]);
  const badRecord = fix.error;
  const rec = fix.record;

  const frames = useMemo<ReplayFrame[]>(() => {
    if (badRecord) return [];
    try {
      return [...replay(fix.record)];
    } catch (e) {
      console.error('回放失败', e);
      return [];
    }
  }, [fix, badRecord]);

  const analysis = useMemo<ReviewAnalysis | null>(() => {
    if (badRecord) return null;
    try {
      return analyzeGame(fix.record);
    } catch (e) {
      console.error('分析失败', e);
      return null;
    }
  }, [fix, badRecord]);

  const [fav, setFav] = useState(() => listRecords().find((m) => m.id === record.id)?.favorite === true);
  const toggleFav = () => {
    setRecordFavorite(record.id, !fav);
    setFav(!fav);
  };
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<'replay' | 'report'>('replay');
  const [cf, setCf] = useState<CounterfactualResult[] | null>(null);
  const [cfProgress, setCfProgress] = useState<{ done: number; total: number } | null>(null);

  // 播放
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIdx((i) => {
        if (i + 1 >= frames.length) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 900);
    return () => clearInterval(t);
  }, [playing, frames.length]);

  const gradeByMoveNo = useMemo(() => {
    const map = new Map<number, MoveAnalysis>();
    for (const mv of analysis?.moves ?? []) map.set(mv.moveNo, mv);
    return map;
  }, [analysis]);

  // D：神经建议层（冻结 ck180；权重加载失败 → 无该层，页面其余照常，不回退不报错成裁判）
  const [nnAdvice, setNnAdvice] = useState<NnReviewSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('ai/clean1.f32');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const mlp = new MLP(1);
        mlp.setWeights(new Float32Array(buf));
        const summary = analyzeWithModel(rec, mlp, NEURAL_MODEL_VERSION);
        if (!cancelled) setNnAdvice(summary);
      } catch {
        /* 模型不可用：不显示模型建议层（对局事实/引擎建议/模拟/讲解四层中缺此层，如实） */
      }
    })();
    return () => { cancelled = true; };
  }, [rec]);
  const nnByMoveNo = useMemo(() => {
    const m = new Map<number, NnReviewSummary['moves'][number]>();
    for (const mv of nnAdvice?.moves ?? []) m.set(mv.moveNo, mv);
    return m;
  }, [nnAdvice]);

  const runDeep = useCallback(async () => {
    if (!analysis || cfProgress) return;
    setCfProgress({ done: 0, total: Math.min(4, analysis.divergentMoves.length) });
    try {
      const results = await runCounterfactual(record, analysis.moves, {
        maxDecisions: 4,
        onProgress: (done, total) => {
          setCfProgress({ done, total });
          return false;
        },
      });
      setCf(results);
    } finally {
      setCfProgress(null);
    }
  }, [analysis, record, cfProgress]);

  const frame = frames[idx];
  const result = rec.result;
  const human = rec.humanSeat ?? 0;
  const cfOf = (moveNo: number) => cf?.find((c) => c.moveNo === moveNo) ?? null;

  const jumpHuman = (dir: 1 | -1) => {
    const humanMoves = rec.moves.filter((m) => m.player === human);
    const cur = rec.moves[idx];
    const pos = humanMoves.findIndex((m) => m.moveNo === (cur?.moveNo ?? 0));
    const next = dir === 1 ? humanMoves[Math.min(humanMoves.length - 1, pos + 1)] : humanMoves[Math.max(0, pos - 1)];
    if (next) {
      const fi = rec.moves.findIndex((m) => m.moveNo === next.moveNo);
      setIdx(Math.max(0, fi));
    }
  };

  if (!frame || !analysis) {
    return (
      <div className="page">
        <button className="btn-ghost btn-small" onClick={onBack}>← 返回</button>
        <p className="sub">该记录无法复盘：{badRecord}。这是早期版本引擎写出的对局，数据与实际牌局不符（如凭空多出的牌），强行分析会产出错误建议，已在源头拦截。可在「历史与复盘」里删除它。</p>
      </div>
    );
  }

  const state = frame.state;
  const trickBySeat = new Map<number, ReplayFrame['combo'] | 'pass'>();
  for (const p of state.trickPlays) {
    trickBySeat.set(p.player, p.combo ?? 'pass');
  }

  const myGrade = gradeByMoveNo.get(frame.move.moveNo);

  return (
    <div className="review-wrap">
      <div className="review-topbar">
        <button className="btn-ghost btn-small" onClick={onBack}>← 返回复盘列表</button>
        <button
          type="button"
          className={`tz-star${fav ? ' on' : ''}`}
          aria-pressed={fav}
          aria-label={fav ? '取消收藏此局' : '收藏此局复盘'}
          title={fav ? '取消收藏' : '收藏此局'}
          onClick={toggleFav}
        >{fav ? '★ 已收藏' : '☆ 收藏'}</button>
        <div className="review-summary">
          {result && (
            <>
              <span className={`verdict ${analysis.humanTeamWon ? 'win' : 'lose'}`}>
                {analysis.humanTeamWon ? '胜' : '负'}
              </span>
              <span>
                {result.finishOrder.map((p) => SEAT_NAMES[p]).join('→')} · 你是第
                {['一', '二', '三', '四'][analysis.humanRank - 1]}名
              </span>
              <span>决策 {analysis.stats.total} 手 · 分歧较大 {analysis.stats.divergent} · 未覆盖 {analysis.stats.uncovered}</span>
              <span>级数 {RANK_NAME[rec.levelsBefore[0]]} vs {RANK_NAME[rec.levelsBefore[1]]}</span>
            </>
          )}
        </div>
        <div className="review-tabs">
          <button className={tab === 'replay' ? 'active' : ''} onClick={() => setTab('replay')}>回放</button>
          <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>教练报告</button>
        </div>
      </div>

      <div className={`review-body${tab === 'replay' ? '' : ' is-hidden'}`}>

          <div className="replay-board">
            <div className="replay-table">
              {([0, 1, 2, 3] as const).map((seat) => (
                <div key={seat} className={`revealed-seat ${SEAT_POS[seat]} ${seat === human ? 'me' : ''} ${seat === 2 ? 'mate' : ''} ${frame.move.player === seat ? 'acting' : ''}`}>
                  <div className="seat-head">
                    <b>{SEAT_NAMES[seat]}</b>
                    <span className="count">{state.hands[seat].length} 张</span>
                    {state.finished.includes(seat) && (
                      <span className="rank-tag">{['头游', '二游', '三游'][state.finished.indexOf(seat)]}</span>
                    )}
                  </div>
                  <div className="combo-cards" style={{ animation: 'none' }}>
                    {[...state.hands[seat]]
                      .sort((a, b) => {
                        const order = (r: number) => state.ctx.ranks.has(r) && r < 15 ? 20 + r : r;
                        return order(a.rank) - order(b.rank) || a.suit.localeCompare(b.suit);
                      })
                      .map((card) => (
                        <AssetCardMini key={card.id} card={card} ctx={state.ctx} />
                      ))}
                  </div>
                  <div className="trick-play">
                    {trickBySeat.has(seat) ? <ComboCards combo={trickBySeat.get(seat) ?? null} ctx={state.ctx} /> : null}
                  </div>
                </div>
              ))}
            </div>

            {/* 时间轴 */}
            <div className="timeline-box">
              <div className="replay-controls">
                <button className="btn-ghost btn-small" onClick={() => { setPlaying(false); setIdx(0); }}>⏮</button>
                <button className="btn-ghost btn-small" onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }}>上一手</button>
                <button className="btn-primary btn-small" onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ 暂停' : '▶ 自动'}</button>
                <button className="btn-ghost btn-small" onClick={() => { setPlaying(false); setIdx((i) => Math.min(frames.length - 1, i + 1)); }}>下一手</button>
                <button className="btn-ghost btn-small" onClick={() => { setPlaying(false); jumpHuman(1); }}>下一个我的决策 ⏭</button>
                <span className="move-counter">{idx + 1} / {frames.length}</span>
              </div>
              <div className="timeline">
                {rec.moves.map((m, i) => {
                  const g = m.player === human ? gradeByMoveNo.get(m.moveNo) : undefined;
                  const icon = g ? gradeIcon(g.grade) : '·';
                  return (
                    <button
                      key={m.moveNo}
                      className={`tl-dot ${i === idx ? 'cur' : ''} ${m.player === human ? 'human' : ''} ${g?.grade ?? ''}`}
                      title={`第${m.moveNo}手 ${SEAT_NAMES[m.player]} ${m.pass ? '不要' : ''}`}
                      onClick={() => { setPlaying(false); setIdx(i); }}
                    >
                      {icon}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 决策详情 */}
          <div className="detail-panel">
            <h3>第 {frame.move.moveNo} 手 · {SEAT_NAMES[frame.move.player]}</h3>
            {frame.move.player === human && myGrade ? (
              <>
                <div className={`grade-line ${myGrade.grade}`}>
                  <span className="grade-icon">{gradeIcon(myGrade.grade)}</span>
                  <b>{myGrade.grade === 'good' ? '与启发式首选一致' : myGrade.grade === 'forced' ? '无牌可跟' : myGrade.grade === 'ok' ? '略有分歧' : myGrade.grade === 'uncovered' ? '候选未覆盖，无法比较' : '启发式分歧较大'}</b>
                  {myGrade.grade === 'divergent' && <span className="gap">（启发式评分差 {myGrade.scoreGap} 分 · 筛选信号，非判错）</span>}
                </div>
                <div className="compare">
                  <div><span className="lbl">你打了</span><b>{myGrade.playedText}</b></div>
                  {myGrade.grade !== 'good' && (
                    <div><span className="lbl">引擎建议</span><b className="rec">{myGrade.recommendedText}</b></div>
                  )}
                </div>
                {nnByMoveNo.get(frame.move.moveNo) && (
                  <div className="nn-advice">
                    <div className="nn-head">
                      <span className="nn-tag">模型建议</span>
                      <b>{nnByMoveNo.get(frame.move.moveNo)!.verdictText}</b>
                      {nnByMoveNo.get(frame.move.moveNo)!.actualRank != null && (
                        <span className="nn-rank">（你的选择列第 {nnByMoveNo.get(frame.move.moveNo)!.actualRank} / {nnByMoveNo.get(frame.move.moveNo)!.nCandidates}）</span>
                      )}
                    </div>
                    <ol className="nn-top">
                      {nnByMoveNo.get(frame.move.moveNo)!.top.map((t, i) => (
                        <li key={i}><span>#{i + 1}</span> {t.text}</li>
                      ))}
                    </ol>
                    {nnByMoveNo.get(frame.move.moveNo)!.nearTie && (
                      <p className="nn-tie">前两名分数近似并列，排序仅供参考</p>
                    )}
                    <p className="nn-src">来源：冻结权重 {nnAdvice?.modelVersion} 的候选排序——是建议排名，不是客观最佳，分数不是胜率。</p>
                  </div>
                )}
                <p className="note">{myGrade.note}</p>
                <div className="ctx-line">
                  {myGrade.context.isLead ? '领出' : `跟 ${SEAT_NAMES[myGrade.context.toBeatPlayer ?? 0]} 的 ${myGrade.context.toBeatText}`} · 你 {myGrade.context.myHandSize} 张 · 对手最少 {myGrade.context.oppMinCards} 张
                </div>
                {cfOf(frame.move.moveNo) && (
                  <div className="cf-box">
                    <b>事后情景演示（单次确定性推演 · 替代来源={cfOf(frame.move.moveNo)!.sourceId}；续打={cfOf(frame.move.moveNo)!.continuationPolicyId}）</b>
                    <div>你的打法「{cfOf(frame.move.moveNo)!.actualText}」→ {cfOf(frame.move.moveNo)!.actualOutcome}</div>
                    <div>替代打法「{cfOf(frame.move.moveNo)!.alternativeText}」→ {cfOf(frame.move.moveNo)!.alternativeOutcome}</div>
                    <div className="cf-verdict">这是真实牌面+固定续打策略下的单次推演，不是当时信息下的胜率；两分支走向不同≠你打错了。</div>
                  </div>
                )}
                {myGrade.tags.length > 0 && (
                  <div className="kp-list">
                    {myGrade.tags.map((t) =>
                      KNOWLEDGE[t] ? (
                        <div key={t} className="kp-item">
                          <b>【{KNOWLEDGE[t].name}】</b>{KNOWLEDGE[t].brief}
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="note">这是其他玩家的出手。点时间轴上的 ✅🟡❌ 标记查看你自己的决策点评。</p>
            )}

            <div className="metrics-box">
              <h4>量化指标</h4>
              {nnAdvice && (
                <>
                  <div className="metric"><span>模型建议覆盖</span><b>{nnAdvice.stats.aligned}/{nnAdvice.stats.totalDecisions} 手</b></div>
                  <div className="metric"><span>未覆盖 / 唯一候选</span><b>{nnAdvice.stats.uncovered + nnAdvice.stats.sameCardsDiffDecl} / {nnAdvice.stats.singleCandidate}</b></div>
                  {nnAdvice.stats.firstChoiceAgreementDenom > 0 && (
                    <div className="metric"><span>首选一致率（已对齐且多候选）</span><b>{Math.round(nnAdvice.stats.firstChoiceAgreement / nnAdvice.stats.firstChoiceAgreementDenom * 100)}%</b></div>
                  )}
                </>
              )}
              <div className="metric"><span>实际出手</span><b>{analysis.metrics.actualHands} 次</b></div>
              <div className="metric"><span>最优拆解</span><b>{analysis.metrics.optimalHands} 手</b></div>
              <div className="metric"><span>让队友 / 压队友</span><b>{analysis.metrics.letMateCount} / {analysis.metrics.beatMateCount}</b></div>
              {analysis.metrics.beatMateWithBig > 0 && <div className="metric warn"><span>大牌压队友</span><b>{analysis.metrics.beatMateWithBig} 次</b></div>}
              {analysis.metrics.bombHeldToEnd > 0 && <div className="metric warn"><span>终局握炸弹</span><b>{analysis.metrics.bombHeldToEnd} 个</b></div>}
              {analysis.metrics.wildLowValue > 0 && <div className="metric warn"><span>配牌低价值使用</span><b>{analysis.metrics.wildLowValue} 次</b></div>}
            </div>

            <button className="btn-primary" disabled={!!cfProgress || !!cf || analysis.divergentMoves.length === 0} onClick={runDeep}>
              {cfProgress ? `深度分析中 ${cfProgress.done}/${cfProgress.total}…` : cf ? '✓ 已完成深度分析' : '深度分析：反事实胜率模拟'}
            </button>
          </div>
        </div>
      <div className={`report-page-wrap${tab === 'report' ? '' : ' is-hidden'}`}>
        <ReportTab
          record={rec}
          analysis={analysis}
          nnAdvice={nnAdvice}
          cf={cf}
          onRunDeep={runDeep}
          cfProgress={cfProgress}
          onJump={(moveNo) => {
            setPlaying(false);
            setTab('replay');
            const idx = rec.moves.findIndex((m) => m.moveNo === moveNo);
            if (idx >= 0) setIdx(idx);
          }}
        />
      </div>
    </div>
  );
}

function ReportTab({
  record, analysis, nnAdvice, cf, onRunDeep, cfProgress, onJump,
}: {
  record: GameRecord;
  analysis: ReviewAnalysis;
  nnAdvice: NnReviewSummary | null;
  cf: CounterfactualResult[] | null;
  onRunDeep: () => void;
  cfProgress: { done: number; total: number } | null;
  onJump: (moveNo: number) => void;
}) {
  const [report, setReport] = useState(() => {
    try { return (loadReport(record.id) ?? '').replace(/^<!--offline-->\n?/, ''); } catch { return ''; }
  });
  // 持久化读到的报告是否离线版（哨兵标记），用于重进页面时仍显示"离线版"提示
  const [storedOffline] = useState(() => {
    try { return (loadReport(record.id) ?? '').startsWith('<!--offline-->'); } catch { return false; }
  });
  const [thinkingLen, setThinkingLen] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'streaming' | 'error' | 'offline'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [lintIssues, setLintIssues] = useState<string[]>([]);
  const [health, setHealth] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/health', { headers: llmHeaders() })
      .then((r) => r.json())
      .then((d) => setHealth(Boolean(d.configured)))
      .catch(() => setHealth(false));
  }, []);

  const generate = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus('loading');
    setReport('');
    setThinkingLen(0);
    setErrMsg('');
    setLintIssues([]);
    const messages = buildCoachMessages(record, analysis, cf ?? [], nnAdvice ?? undefined);
    try {
      const cfg = loadLLMConfig();
      const think = thinkingParams(cfg?.effort ?? 'max');
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...llmHeaders() },
        body: JSON.stringify({
          messages,
          max_tokens: think.maxTokens,
          ...(think.thinking ? { thinking: think.thinking } : {}),
          ...(think.reasoning_effort ? { reasoning_effort: think.reasoning_effort } : {}),
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      setStatus('streaming');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      let thoughtChars = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const data = line.replace(/^data:\s*/, '');
          if (!data || data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content ?? '';
            if (delta) { full += delta; setReport((r) => r + delta); }
            if (typeof json.gd_thinking === 'string') {
              thoughtChars += json.gd_thinking.length;
              setThinkingLen((n) => n + json.gd_thinking.length);
            }
          } catch {
            // 忽略无法解析的行
          }
        }
      }
      if (full.length === 0) {
        // 流结束但一个正文都没收到：思考把输出额度吃光或服务异常，明确提示而不是静默回到初始态
        setErrMsg(`这次只收到思考（${thoughtChars} 字）、没收到正文（输出额度被思考耗尽或服务异常）。请再点一次重试。`);
        setStatus('error');
        return;
      }
      const allowed = typeof messages[messages.length - 1].content === 'string'
        ? (messages[messages.length - 1].content as string)
        : '';
      setLintIssues(lintReportCards(full, allowed));
      setStatus('idle');
      saveReport(record.id, full);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      // LLM 不可用 → 离线报告
      const offlineText = buildOfflineReport(analysis, cf ?? []);
      setReport(offlineText);
      setStatus('offline');
      saveReport(record.id, `<!--offline-->\n${offlineText}`);
    }
  };

  return (
    <div className="page report-page">
      <div className="report-actions">
        <button className="btn-primary" onClick={generate} disabled={status === 'loading' || status === 'streaming'}>
          {status === 'loading' || status === 'streaming'
            ? report.length > 0
              ? `✍️ 生成中…（已写 ${report.length} 字）`
              : `🧠 深度思考中…（已思考 ${thinkingLen} 字，最高档约 5~7 分钟；期间可切去看回放，不会中断；赶时间可在设置里换「标准」档约 1 分钟）`
            : '🧑‍🏫 生成教练讲解'}
        </button>
        {!cf && analysis.divergentMoves.length > 0 && (
          <button className="btn-ghost" onClick={onRunDeep} disabled={!!cfProgress}>
            {cfProgress ? `反事实模拟 ${cfProgress.done}/${cfProgress.total}` : '先跑反事实模拟（讲解更准）'}
          </button>
        )}
        {health === false && <span className="health-warn">LLM 未配置，将生成离线版报告（.env 配置后可用 AI 讲解）</span>}
      </div>
      {(status === 'offline' || storedOffline) && <p className="sub">（离线版报告：LLM 服务当时不可用，由规则引擎生成；重新点上方按钮可生成 AI 讲解）</p>}
      {status === 'error' && <p className="sub" style={{ color: '#e5484d' }}>⚠️ {errMsg}</p>}
      {lintIssues.length > 0 && (
        <p className="sub" style={{ color: '#e8a33d' }}>
          ⚠️ 牌张核验：报告中出现剧本之外的牌 {lintIssues.join(' ')}——可能是 AI 笔误，涉及句子仅供参考，建议重新生成。
        </p>
      )}
      {report ? (
        <Markdown
          text={report}
          renderSlot={(_, v) => (
            <TrickRecap
              moveNo={v}
              mv={analysis.moves.find((m) => m.moveNo === Number(v))}
              ctx={record.ruleOpts.levelMode === 'stage'
                ? makeLevelCtx(record.levelsBefore, 'stage', record.stageTeam ?? 0)
                : makeLevelCtx(record.levelsBefore, record.ruleOpts.levelMode)}
              seatNames={SEAT_NAMES}
              onJump={onJump}
            />
          )}
        />
      ) : (
        <p className="sub">点击上方按钮生成复盘讲解。建议先跑反事实模拟，教练讲解会引用真实胜率数据。</p>
      )}
    </div>
  );
}
