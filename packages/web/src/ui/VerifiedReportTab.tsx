import {PROVIDER_PRESETS,resolveProviderBinding,type ProviderId} from '../game/provider-presets';
import {useEffect,useLayoutEffect,useMemo,useState} from 'react';
import type {GameRecord} from '@gd/engine';
import {
  acceptCoachResponse,buildCoachJsonMessages,makeCoachCache,readCoachCache,SEAT_DISPLAY_VERSION,
  type CoachJsonOutput,type DecisionReview,
} from '@gd/review';
import {loadReport,saveReport,loadChatProfileReference,saveChatProfileReference,loadProviderBindings,profileReference,profileReferenceKey,type PublicProfile} from '../game/storage';
import {createChatOperationOwner,operationProfileClient,requestCompletedChat} from './chat-operation';

/** Unverified streaming text and legacy caches never enter a rendering surface. */
export function VerifiedReportTab({record,evidence,onJump,viewerSeat=record.humanSeat??0}:{record:GameRecord;evidence:DecisionReview[];viewerSeat?:number;onJump:(moveNo:number)=>void}) {
  const context=useMemo(()=>({recordId:record.id,viewerSeat,seatDisplayVersion:SEAT_DISPLAY_VERSION,factsSchema:'decision-facts-v3',policyIds:evidence.map(e=>e.policy)}),[record,evidence,viewerSeat]);
  const cacheKey=record.id,cacheViewer=viewerSeat;
  const scopeKey=JSON.stringify([context,evidence]);
  const owner=useMemo(createChatOperationOwner,[]);
  const [profiles,setProfiles]=useState<PublicProfile[]>(()=>operationProfileClient().cached());
  const [choice,setChoice]=useState(loadChatProfileReference),[serviceReady,setServiceReady]=useState(false);
  // Read only public bindings. A saved coach choice stays pinned; binding updates never select it.
  const providerRows: Array<{provider:ProviderId;profile:PublicProfile|null;issue:string}> = [];
  let bindingsIssue='';
  try {
    const bindings=loadProviderBindings();
    for(const provider of ['glm','deepseek'] as const) {
      try { const profile=resolveProviderBinding(provider,bindings,profiles);providerRows.push({provider,profile,issue:profile?'':'尚未保存连接'}); }
      catch(error){providerRows.push({provider,profile:null,issue:(error as Error).message});}
    }
  } catch(error){bindingsIssue=`连接绑定未读取：${(error as Error).message}`;}
  const chosen=providerRows.find(row=>row.profile&&choice&&profileReferenceKey(row.profile)===profileReferenceKey(choice))?.profile??null;
  useEffect(()=>{
    const listOwner=createChatOperationOwner(),operation=listOwner.begin();
    operationProfileClient(operation).refresh().then(rows=>{if(operation.current()){setProfiles(rows);setServiceReady(true);}})
      .catch(()=>{if(operation.current())setServiceReady(false);});
    return ()=>listOwner.invalidate();
  },[]);
  const [acceptance,setAcceptance]=useState<{scope:string;output:CoachJsonOutput}|null>(null);
  const accepted=acceptance?.scope===scopeKey?acceptance.output:null;
  const setAccepted=(output:CoachJsonOutput|null)=>setAcceptance(output?{scope:scopeKey,output}:null);
  const [status,setStatus]=useState('事实讲解');
  const [busy,setBusy]=useState(false),[issue,setIssue]=useState('');
  useLayoutEffect(()=>{
    owner.invalidate();
    const stored=loadReport(cacheKey,cacheViewer);
    const cached=readCoachCache(stored,evidence,context);
    setAccepted(cached);setStatus(cached?'已重验缓存':'事实讲解');setIssue(stored&&!cached?'历史讲解未通过当前座号与事实核验，原文保留；当前仅展示确定性事实，不自动重写。':'');setBusy(false);
    return ()=>owner.invalidate();
  // Parent renders may recreate identical evidence arrays; only semantic scope changes cancel.
  },[owner,scopeKey]);
  function cancel() { owner.invalidate();setBusy(false);setStatus('已取消；供应商处理状态未知');setIssue(''); }
  function choose(value:string) {
    cancel();setAccepted(null);
    const profile=providerRows.find(row=>row.profile&&profileReferenceKey(row.profile)===value)?.profile;
    if(value&&!profile){setIssue('所选连接未按当前公开绑定核验，未更改教练选择。');return;}
    const reference=profile?profileReference(profile):null;
    setChoice(reference);saveChatProfileReference(reference);setStatus('事实讲解');
  }
  function showDeterministic() {
    owner.invalidate();setBusy(false);
    if(!evidence.length)return;
    const output={summary:'以下陈述原谱事实；策略优劣尚未验证。',lessons:evidence.slice(0,3).map(ev=>({
      decisionId:ev.decisionId,actionIds:[ev.actual.actionId],factIds:Object.keys(ev.facts).slice(0,1),claimIds:[],
      claimLevel:ev.claimLevel,title:`第${ev.moveNo}手事实`,
      text:`本手实际动作记录为${ev.singleStep.actual.text}。这是原谱事实，策略优劣尚未验证。`,
    }))};
    const raw=JSON.stringify(output),valid=acceptCoachResponse(raw,evidence);
    if(!valid){setIssue('当前证据不足以形成讲解，保留程序事实。');return;}
    saveReport(cacheKey,makeCoachCache(raw,evidence,context),cacheViewer);setAccepted(valid);setIssue('');setStatus('已核验确定性讲解');
  }
  async function generate() {
    if(!chosen||!serviceReady||!evidence.length)return;
    const operation=owner.begin();
    setBusy(true);setIssue('');setAccepted(null);setStatus('等待完整响应；处理进度未知，可取消');
    try {
      const messages=buildCoachJsonMessages(evidence,['策略偏好尚未证明最优，事实与建议来源分别展示。'],viewerSeat);
      const raw=await requestCompletedChat(chosen,messages,operation);
      if(!operation.current())return;
      const output=acceptCoachResponse(raw,evidence);
      if(!output)throw new Error('讲解未通过事实、来源或引用核验，继续显示下方程序事实。');
      if(!operation.current())return;
      saveReport(cacheKey,makeCoachCache(raw,evidence,context),cacheViewer);setAccepted(output);setStatus('已核验讲解');
    } catch(error){if(operation.current()){setIssue((error as Error).message);setStatus('事实讲解');}}
    finally{if(operation.current())setBusy(false);}
  }
  return <div className="page report-page" data-testid="verified-report">
    <h3>四席事实与建议来源</h3>
    <p className="sub">过牌只表示本次不压。启发式和网络是各自的偏好；未验证的续打不生成策略结论。</p>
    {evidence.map(ev=><section className="ev-card" key={ev.decisionId}>
      <button className="btn-ghost btn-small" onClick={()=>onJump(ev.moveNo)}>查看第 {ev.moveNo} 手</button>
      <p>实际动作：{ev.singleStep.actual.text} · 打后剩 {ev.singleStep.actual.remainingCards} 张</p>
      <p>启发式偏好：{ev.heuristic.topActionId?ev.actionTexts[ev.heuristic.topActionId]:'未提供'}（尚未证明更好）</p>
      <p>网络首选：{ev.candidates?.ranking[0]?.text??'未加载，未测'} · {ev.policy?.proposalPolicyId??'无网络来源'}</p>
      <p>经验证搜索建议：未运行；现有单次情景演示不充当完整比赛教师。</p>
      <details><summary>程序事实、规则断言与证据范围</summary>
        {Object.entries(ev.facts).map(([id,text])=><p key={id}>{text}</p>)}
        {ev.claims.map(claim=><p key={claim.claimId}>{claim.text}</p>)}
        <p>{ev.expressionScope}</p>
        <p>{ev.missing.join('；')}</p>
      </details>
    </section>)}
    <label className="settings-field"><span>明确选用教练连接</span>
      <select aria-label="测试与教练连接" value={chosen?profileReferenceKey(chosen):''} disabled={!serviceReady} onChange={e=>choose(e.target.value)}>
        <option value="">请选择已保存版本，不自动选第一项</option>
        {providerRows.map(({provider,profile,issue})=><option key={provider} value={profile?profileReferenceKey(profile):`unavailable:${provider}`} disabled={!profile} title={issue||undefined}>{PROVIDER_PRESETS[provider].name}</option>)}
      </select>
    </label>
    {bindingsIssue&&<p className="sub" role="alert">{bindingsIssue}</p>}
    {providerRows.filter(row=>row.issue).map(row=><p className="sub" key={row.provider}>{PROVIDER_PRESETS[row.provider].name}：{row.issue}</p>)}
    {!serviceReady&&<p className="sub">连接配置服务未就绪；不会回退到旧 Key 或环境配置。确定性事实仍可查看。</p>}
    {choice&&!chosen&&<p className="sub">已选版本不再匹配；请在设置保存后明确重选，不会自动绑定新版本。</p>}
    <div className="report-actions">
      <button className="btn-primary" onClick={generate} disabled={busy||!evidence.length||!chosen||!serviceReady}>生成 AI 讲解</button>
      {busy&&<button className="btn-ghost" onClick={cancel}>取消讲解</button>}
      <button className="btn-ghost" onClick={showDeterministic} disabled={!evidence.length}>查看确定性事实讲解</button>
      <span role="status">{status}</span>
    </div>
    {issue&&<p className="sub" role="alert">{issue}</p>}
    {accepted&&<section data-testid="accepted-coach-output">
      <p>{accepted.summary}</p>
      {accepted.lessons.map(lesson=><article key={lesson.decisionId}><h4>{lesson.title}</h4><p>{lesson.text}</p></article>)}
    </section>}
  </div>;
}
