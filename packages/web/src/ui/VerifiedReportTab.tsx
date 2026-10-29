import {useEffect,useMemo,useRef,useState} from 'react';
import type {GameRecord} from '@gd/engine';
import {
  acceptCoachResponse,buildCoachJsonMessages,makeCoachCache,readCoachCache,
  type CoachJsonOutput,type DecisionReview,
} from '@gd/review';
import {loadReport,saveReport,llmHeaders,loadLLMConfig,thinkingParams} from '../game/storage';

/** Unverified streaming text and legacy caches never enter a rendering surface. */
export function VerifiedReportTab({record,evidence,onJump}:{record:GameRecord;evidence:DecisionReview[];onJump:(moveNo:number)=>void}) {
  const context=useMemo(()=>({recordId:record.id,viewerSeat:record.humanSeat??0,factsSchema:'decision-facts-v3',policyIds:evidence.map(e=>e.policy)}),[record,evidence]);
  const cacheKey=record.id,cacheViewer=record.humanSeat??0;
  const scopeKey=JSON.stringify([context,evidence]);
  const activeScope=useRef(scopeKey);activeScope.current=scopeKey;
  const [acceptance,setAcceptance]=useState<{scope:string;output:CoachJsonOutput}|null>(null);
  const accepted=acceptance?.scope===scopeKey?acceptance.output:null;
  const setAccepted=(output:CoachJsonOutput|null)=>setAcceptance(output?{scope:scopeKey,output}:null);
  const [status,setStatus]=useState('事实讲解');
  const [busy,setBusy]=useState(false),[received,setReceived]=useState(0),[issue,setIssue]=useState('');
  useEffect(()=>{
    const cached=readCoachCache(loadReport(cacheKey,cacheViewer),evidence,context);
    setAccepted(cached);setStatus(cached?'已重验缓存':'事实讲解');setIssue('');setBusy(false);setReceived(0);
  },[cacheKey,cacheViewer,evidence,context]);
  function showDeterministic() {
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
    setBusy(true);setReceived(0);setIssue('');setAccepted(null);setStatus('接收后统一核验');
    try {
      const messages=buildCoachJsonMessages(evidence,['策略偏好尚未证明最优，事实与建议来源分别展示。'],record.humanSeat??0);
      const cfg=loadLLMConfig(),thinking=thinkingParams(cfg?.effort??'max');
      const response=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json',...llmHeaders()},body:JSON.stringify({messages,max_tokens:thinking.maxTokens,...(thinking.thinking?{thinking:thinking.thinking}:{}),...(thinking.reasoning_effort?{reasoning_effort:thinking.reasoning_effort}:{})})});
      if (!response.ok||!response.body) throw new Error('讲解服务暂不可用');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',raw='';
      for (;;) {
        const {done,value}=await reader.read();if(activeScope.current!==scopeKey){await reader.cancel();return;}if(done)break;
        buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()??'';
        for(const line of lines){const data=line.replace(/^data:\s*/,'');if(!data||data==='[DONE]')continue;
          try{const delta=JSON.parse(data).choices?.[0]?.delta?.content;if(typeof delta==='string'){raw+=delta;setReceived(raw.length);}}catch{/* incomplete provider event, never rendered */}
        }
      }
      if(activeScope.current!==scopeKey)return;
      const output=acceptCoachResponse(raw,evidence);
      if(!output)throw new Error('讲解未通过事实、来源或引用核验，继续显示下方程序事实。');
      saveReport(cacheKey,makeCoachCache(raw,evidence,context),cacheViewer);setAccepted(output);setStatus('已核验讲解');
    } catch(error){if(activeScope.current===scopeKey){setIssue((error as Error).message);setStatus('事实讲解');}}
    finally{if(activeScope.current===scopeKey)setBusy(false);}
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
    <div className="report-actions">
      <button className="btn-primary" onClick={generate} disabled={busy||!evidence.length}>{busy?`已接收 ${received} 字，待核验`:'生成 AI 讲解'}</button>
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
