import {buildDecisionFactsV3,type DecisionReview} from '@gd/review';
import type {GameRecord} from '@gd/engine';

export const REVIEW_PREVIEW_ID='review6-facts-ui-20261028-03';
export function DecisionFactsPanel({record,moveNo,viewerSeat,identity,evidence}:{record:GameRecord;moveNo:number;viewerSeat:number;identity:Record<string,unknown>;evidence:DecisionReview|null}) {
  let facts:ReturnType<typeof buildDecisionFactsV3>;
  try{facts=buildDecisionFactsV3(record,moveNo,viewerSeat,identity);}catch(error){return <p role="alert">该手事实核验不足：{(error as Error).message}</p>;}
  function exportIncident(){
    const bundle={schemaVersion:'review6-incident-v1',createdAt:new Date().toISOString(),previewBuildId:REVIEW_PREVIEW_ID,
      recordId:record.id,actorSeat:facts.actorSeat,viewerSeat:facts.viewerSeat,decisionId:facts.decisionId,
      legalBeforeObservation:facts.revealedFacts,actualActionId:facts.actualActionId,facts,
      advice:evidence?{candidates:evidence.candidates,policy:evidence.policy,heuristic:evidence.heuristic,breakdown:evidence.heuristicBreakdowns,claims:evidence.claims,missing:evidence.missing}:null,
      policyIdentity:identity,posthocDebug:{warning:'事后完整原谱；不进入行动或事前分析输入',record}};
    const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`${record.id}-m${moveNo}-v${viewerSeat}-incident.json`;link.click();URL.revokeObjectURL(url);
  }
  return <section className="ev-card" data-testid="decision-facts-v3">
    <h4>本手事实 · 行动席 {facts.actorSeat} / 观察席 {facts.viewerSeat}</h4>
    <p>当前目标：{facts.target?.text??'领出，无待压目标'}；控权席：{facts.currentTrickOwner??'无'}</p>
    <p>实际：{facts.actual.text} · {facts.actual.cardCount} 张；行动后余牌：{facts.afterCounts.join(' / ')} 张</p>
    <p>{facts.ruleRelation.applicabilityReason}</p>
    {facts.bombComparison&&<p>四炸 / 五炸规则比较：{facts.bombComparison.fourCanBeatCurrent&&facts.bombComparison.fiveCanBeatCurrent?'两者都能压当前目标':'领出时无待压目标'}；{facts.bombComparison.fiveBeatsFour?'五炸强度大于四炸':'按当前规则分别比较'}。行动后分别剩 {facts.bombComparison.fourRemaining} / {facts.bombComparison.fiveRemaining} 张。余手用途尚未验证，不据此判定哪种打法更好。</p>}
    <p>建议范围：{facts.expressionScope}</p>
    <p>启发式偏好：{evidence?.heuristic.topActionId?evidence.actionTexts[evidence.heuristic.topActionId]:'未提供'}（尚未验证优劣）；来源 {evidence?.heuristic.sourceId??'未提供'}</p>
    <p>网络首选：{evidence?.candidates?.ranking[0]?.text??'未加载，未测'}；来源 {evidence?.policy?.proposalPolicyId??'无网络来源'}</p>
    <p>经验证搜索建议：未运行。</p>
    <button className="btn-ghost btn-small" onClick={exportIncident}>导出本手事故包与原谱</button>
    <details><summary>动作身份与可见信息边界</summary><p>{facts.actualActionId}</p><p>{facts.revealedFacts.actorHandVisibility}</p><p>观察指纹：{facts.observationHash}</p><p>六类预登记断言：{facts.assertions.filter(a=>a.checked).length} / {facts.expectedAssertionIds.length} 已核</p></details>
  </section>;
}
