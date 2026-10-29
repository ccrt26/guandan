import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeLevelCtx, RANK_NAME, type GameRecord } from '@gd/engine';
import {
  analyzeGame, classifyReplay, gradeIcon, normalizeRecord, replay, runCounterfactual, validateRecord,
  buildCoachMessages, buildOfflineReport, lintReportCards, buildTeamContext,
  type CounterfactualResult, type MoveAnalysis, type ReplayFrame, type ReviewAnalysis,
} from '@gd/review';
import { KNOWLEDGE, analyzeWithModel, buildDecisionReviews, runInfosetCompare, defaultRoots, type NnReviewSummary, type DecisionReview } from '@gd/review';
import { MLP, NEURAL_MODEL_VERSION, FROZEN_CHAMPION_IDENTITY } from '@gd/ai';
import {buildTeamReview} from '@gd/review';
import {VerifiedReportTab} from './VerifiedReportTab';
import {DecisionFactsPanel,REVIEW_PREVIEW_ID} from './DecisionFactsPanel';
import './review-facts.css';
import { ComboCards, AssetCardMini } from './CardView';
import { Markdown } from './markdown';
import { TrickRecap } from './TrickRecap';
import { listRecords, loadReport, llmHeaders, loadLLMConfig, saveReport, setRecordFavorite, thinkingParams } from '../game/storage';
import type { AppSettings } from '../App';

const ABSOLUTE_SEAT_NAMES = ['南家', '东家', '北家', '西家'];
const SEAT_POS = ['south', 'east', 'north', 'west'] as const;

export function ReviewPage({
  record, settings, onBack,
}: {
  record: GameRecord;
  settings: AppSettings;
  onBack: () => void;
}) {
  void settings;
  const [viewerSeat,setViewerSeat]=useState(record.humanSeat??0);
  const [productStatus,setProductStatus]=useState<{facts:{passedCards:number;expectedAssertions:number;checkedAssertions:number;missingAssertions:number;errorAssertions:number};developmentExamples:Array<{id:string;category:string;actualAction:string;baselineAction:string|null;candidateAction:null;teamGoal:string;resourceImpact:string;changeCondition:string;kind:string}>}|null>(null);
  useEffect(()=>{let active=true;fetch('review6-product-status-003.json').then(r=>r.ok?r.json():null).then(d=>{
    if(active&&d?.schemaVersion==='r61-product-display-v1'&&d.actualPolicyId===FROZEN_CHAMPION_IDENTITY.policyId&&d.facts?.expectedCards===240&&Number.isInteger(d.facts.passedCards)&&d.facts.passedCards>=0&&d.facts.passedCards<=240&&Array.isArray(d.developmentExamples))setProductStatus(d);
  }).catch(()=>{});return()=>{active=false;};},[]);
  const SEAT_NAMES=ABSOLUTE_SEAT_NAMES.map((name,seat)=>seat===viewerSeat?`你（${name}）`:seat===(viewerSeat+2)%4?`队友（${name}）`:name);
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
  const rec = useMemo(()=>({...fix.record,humanSeat:viewerSeat}),[fix.record,viewerSeat]);

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
      return analyzeGame(rec);
    } catch (e) {
      console.error('分析失败', e);
      return null;
    }
  }, [rec, badRecord]);

  const [fav, setFav] = useState(() => listRecords().find((m) => m.id === record.id)?.favorite === true);
  const toggleFav = () => {
    setRecordFavorite(record.id, !fav);
    setFav(!fav);
  };
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<'replay' | 'report'>('replay');
  const [cfResult, setCfResult] = useState<{scope:GameRecord;rows:CounterfactualResult[]}|null>(null);
  const cf=cfResult?.scope===rec?cfResult.rows:null;
  const [cfProgress, setCfProgress] = useState<{ done: number; total: number } | null>(null);
  const [cfError,setCfError]=useState('');
  const cfScope=useRef(rec);cfScope.current=rec;
  useEffect(()=>{setCfResult(null);setCfProgress(null);setCfError('');},[rec]);

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

  const [sharedMlp, setSharedMlp] = useState<MLP | null>(null);
  const [weightHash,setWeightHash]=useState<string|null>(null);
  const frozenEncoder={candidateCompat:'v2' as const,passEncoding:FROZEN_CHAMPION_IDENTITY.passEncoding};
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try {
        const [weightsResponse,identityResponse]=await Promise.all([fetch('ai/clean2.f32'),fetch('ai/deployed-identity.json')]);
        if(!weightsResponse.ok||!identityResponse.ok)throw new Error('policy unavailable');
        const [bytes,identity]=await Promise.all([weightsResponse.arrayBuffer(),identityResponse.json()]);
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
        if(hash!==identity.productLoads.weightsSHA256||identity.productLoads.policyId!==FROZEN_CHAMPION_IDENTITY.policyId)throw new Error('policy identity mismatch');
        const mlp=new MLP(1);mlp.setWeights(new Float32Array(bytes));
        if(!cancelled){setSharedMlp(mlp);setWeightHash(hash);}
      }catch{if(!cancelled){setSharedMlp(null);setWeightHash(null);}}
    })();
    return ()=>{cancelled=true;};
  },[]);
  const nnAdvice=useMemo<NnReviewSummary|null>(()=>{
    if(!sharedMlp||badRecord)return null;
    try{return analyzeWithModel(rec,sharedMlp,FROZEN_CHAMPION_IDENTITY.policyId,frozenEncoder);}catch{return null;}
  },[rec,sharedMlp,badRecord]);

  // R3 证据卡（自办项 1/5/6）：统一证据对象（含双来源续打方向冲突检测）；单次确定性推演挂接 cf 结果
  const evidence=useMemo<DecisionReview[]|null>(() => {
    if (!analysis)return null;
    try {
      const rollouts = new Map<number, import('@gd/review').RolloutEvidence[]>();
      for (const c of cf ?? []) {
        rollouts.set(c.moveNo, [{
          mode: 'single_deterministic', rootSourceId: c.sourceId, continuationPolicyId: c.continuationPolicyId,
          samples: 1, seedsDigest: 'rng:0xd5c9a7(noise=0)',
          actualOutcomeText: c.actualOutcome, alternativeOutcomeText: c.alternativeOutcome,
          metricActual: c.gActual, metricAlternative: c.gAlternative, truncated: c.truncated,
        }]);
      }
      return buildDecisionReviews(rec, {
        mlp: sharedMlp??undefined, modelVersion: FROZEN_CHAMPION_IDENTITY.policyId, weightHash, encoder:frozenEncoder, analysis, rollouts,
      });
    } catch { return null; }
  }, [sharedMlp, weightHash, analysis, rec, cf]);
  const nnByMoveNo = useMemo(() => {
    const m = new Map<number, NnReviewSummary['moves'][number]>();
    for (const mv of nnAdvice?.moves ?? []) m.set(mv.moveNo, mv);
    return m;
  }, [nnAdvice]);

  const runDeep = useCallback(async () => {
    if (!analysis || cfProgress) return;
    setCfError('');
    setCfProgress({ done: 0, total: Math.min(4, analysis.divergentMoves.length) });
    try {
      const results = await runCounterfactual(rec, analysis.moves, {
        maxDecisions: 4,
        onProgress: (done, total) => {
          if(cfScope.current!==rec)return true;
          setCfProgress({ done, total });
          return false;
        },
      });
      if(cfScope.current===rec)setCfResult({scope:rec,rows:results});
    } catch{
      if(cfScope.current===rec)setCfError('原谱动作或观察席无法核验，暂不生成情景结果。');
    } finally {
      if(cfScope.current===rec)setCfProgress(null);
    }
  }, [analysis, rec, cfProgress]);

  const teamEvents=useMemo(()=>badRecord?null:buildTeamReview(fix.record,{viewerSeat}),[fix.record,viewerSeat,badRecord]);
  const actorEvidence=useMemo(()=>{
    const frame=frames[idx];if(!frame)return null;
    try{return buildDecisionReviews({...fix.record,humanSeat:frame.move.player},{moves:[frame.move.moveNo],maxPoints:1,mlp:sharedMlp??undefined,modelVersion:FROZEN_CHAMPION_IDENTITY.policyId,weightHash,encoder:frozenEncoder})[0]??null;}catch{return null;}
  },[fix.record,frames,idx,sharedMlp,weightHash]);
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
        <label>观察席位 <select aria-label="复盘观察席位" value={viewerSeat} onChange={e=>setViewerSeat(Number(e.target.value))}>
          {ABSOLUTE_SEAT_NAMES.map((name,seat)=><option key={seat} value={seat}>{name}</option>)}
        </select></label>
        <div className="review-tabs">
          <button className={tab === 'replay' ? 'active' : ''} onClick={() => setTab('replay')}>回放</button>
          <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>教练报告</button>
        </div>
      </div>

      <section className="ev-card" data-testid="capability-card">
        <b>复盘预览 {REVIEW_PREVIEW_ID}</b>
        <p>复盘事实已接入，出牌能力尚未更新。当前仍使用旧政策 {FROZEN_CHAMPION_IDENTITY.policyId}。</p>
        <p>240 张事实卡：{productStatus?`${productStatus.facts.passedCards}/240（有限开发回归）`:'未测'}；60 家族协作与正式比赛：未测；候选政策：无。</p>
        {productStatus&&<p>预期断言 {productStatus.facts.expectedAssertions}；已核 {productStatus.facts.checkedAssertions}；未核 {productStatus.facts.missingAssertions}；错误 {productStatus.facts.errorAssertions}。</p>}
        {productStatus&&<details><summary>开放开发例：四类各三个，另列证据不足例</summary>{productStatus.developmentExamples.map(example=><article key={example.id} className="ev-card">
          <b>{example.id} · {example.kind==='evidence_insufficient'?'证据不足例':'开发例，非封存成绩'}</b>
          <p>原谱实际：{example.actualAction}；旧网单步建议：{example.baselineAction??'未测'}；新候选：未测。</p>
          <p>队伍目标假设：{example.teamGoal}</p><p>{example.resourceImpact}</p><p>重新比较条件：{example.changeCondition}</p>
          <p>策略正确性尚未由完整比赛教师验证。</p>
        </article>)}</details>}
        <details><summary>当前加载的政策身份</summary><p>权重 SHA-256：{weightHash??'未加载或身份核验不足'}</p><p>候选 cand-dedup-v2 · 编码 gd-lab-schema-v1 · pass legacy-phys10</p></details>
        <div>{teamEvents?.events.map(event=><button className="btn-ghost btn-small" key={event.moveNo} onClick={()=>{setPlaying(false);setIdx(rec.moves.findIndex(m=>m.moveNo===event.moveNo));setTab('replay');}}>第 {event.moveNo} 手 · {ABSOLUTE_SEAT_NAMES[event.actorSeat]} · 队伍事件</button>)}</div>
      </section>
      <div className={`review-body${tab === 'replay' ? '' : ' is-hidden'}`}>

          <div className="replay-board">
            <p className="sub">事后牌谱回放：四家手牌仅供事后查看。行动者评价只使用其当时合法可见信息。</p>
            <div className="replay-table">
              {([0, 1, 2, 3] as const).map((seat) => (
                <div key={seat} className={`revealed-seat ${SEAT_POS[seat]} ${seat === human ? 'me' : ''} ${seat === (human+2)%4 ? 'mate' : ''} ${frame.move.player === seat ? 'acting' : ''}`}>
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
            <DecisionFactsPanel record={fix.record} moveNo={frame.move.moveNo} viewerSeat={viewerSeat} identity={{...FROZEN_CHAMPION_IDENTITY,weightHash,previewBuildId:REVIEW_PREVIEW_ID}} evidence={actorEvidence}/>
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
                    <div><span className="lbl">启发式偏好</span><b className="rec">{myGrade.recommendedText}</b></div>
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
                <p className="note">以上为启发式偏好与独立网络排序；没有完整团队策略证据时，不将分歧判为错误。</p>
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
                    <p className="sub">通用牌理提示：不构成本手策略优劣的证据。</p>
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
              <p className="note">该手属于其他行动席，事实与三种建议来源见上方。可切换观察席位查看该席的整体复盘。</p>
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
              <div className="metric"><span>参考拆解（非最优证明）</span><b>{analysis.metrics.optimalHands} 手</b></div>
              <div className="metric"><span>让队友 / 压队友</span><b>{analysis.metrics.letMateCount} / {analysis.metrics.beatMateCount}</b></div>
              {analysis.metrics.beatMateWithBig > 0 && <div className="metric warn"><span>大牌压队友</span><b>{analysis.metrics.beatMateWithBig} 次</b></div>}
              {analysis.metrics.bombHeldToEnd > 0 && <div className="metric warn"><span>终局握炸弹</span><b>{analysis.metrics.bombHeldToEnd} 个</b></div>}
              {analysis.metrics.wildLowValue > 0 && <div className="metric warn"><span>配牌低价值使用</span><b>{analysis.metrics.wildLowValue} 次</b></div>}
            </div>

            <button className="btn-primary" disabled={!!cfProgress || !!cf || analysis.divergentMoves.length === 0} onClick={runDeep}>
              {cfProgress ? `深度分析中 ${cfProgress.done}/${cfProgress.total}…` : cf ? '✓ 已完成深度分析' : '事后情景演示（非胜率）'}
            </button>
            {cfError&&<p role="alert">{cfError}</p>}
          </div>
        </div>
      {(rec.ruleOpts.levelMode ?? 'both') !== 'stage' && (
        <div className="rule-mode-banner">
          本局为旧口径（levelMode={String(rec.ruleOpts.levelMode ?? 'both')}）记录，按当时规则回放。
          与现行官方口径（stage：台上队级数为唯一级牌）差异：级牌集合与万能牌数量不同；讲解与建议均按当时口径。
        </div>
      )}
      <div className={`report-page-wrap${tab === 'report' ? '' : ' is-hidden'}`}>
        <VerifiedReportTab key={`${rec.id}:v${viewerSeat}`} record={rec} evidence={(evidence??[]).filter(e=>e.seat===viewerSeat)} onJump={moveNo=>{setPlaying(false);setTab('replay');const i=rec.moves.findIndex(m=>m.moveNo===moveNo);if(i>=0)setIdx(i);}}/>
      </div>
    </div>
  );
}

