/**
 * packages/review/src/coachJson.ts — R3（REVIEW3-EXEC §3.2）：结构化教练输出与校验。
 * LLM 只允许输出 { summary, lessons[] }；每条 lesson 必须引用存在的 decisionId /
 * actionIds / factIds 并带受限 claimLevel。牌名、张数、万能牌代入、模拟结果等
 * 数值事实由程序按 ID 渲染进提示词；校验层拦：不存在 ID、跨手引用、claim 越界、
 * 事实外牌张/百分比、禁用判罚语。先校验后展示；最多一次有边界重试，之后降级为事实卡。
 */
import type { ClaimLevel, DecisionReview } from './decisionReview';

export interface CoachLesson {
  decisionId: string;
  actionIds: string[];
  factIds: string[];
  /** D3：引用的类型化断言（claimId 必须属于该 decision；方向性/因果表述须有 claim 支撑） */
  claimIds?: string[];
  claimLevel: ClaimLevel;
  title: string;
  text: string;
}

export interface CoachJsonOutput {
  summary: string;
  lessons: CoachLesson[];
}

export const COACH_JSON_PROMPT_VERSION = 'coach-json-v3-viewer-entailed';
export const COACH_VALIDATOR_VERSION = 'coach-validator-v4-entailed-surfaces';

const CLAIM_LEVELS: ClaimLevel[] = ['model_preference', 'conditional_support', 'disagreement', 'provable_fact', 'uncovered'];

/** 校验错误类型（给重试 prompt 与落盘记录用） */
export interface CoachValidationError {
  lessonIndex?: number;
  kind: 'schema' | 'unknown_decision' | 'unknown_action' | 'unknown_fact' | 'unknown_claim' | 'cross_move_ref'
  | 'claim_level_mismatch' | 'card_out_of_fact' | 'percent_out_of_fact' | 'forbidden_judgement' | 'self_correction';
  detail: string;
}

const CARD_TOKEN = /[♠♥♦♣](?:10|[2-9JQKA])|小王|大王/g;
const PCT_TOKEN = /\d+(?:\.\d+)?%/g;
const COUNT_TOKEN = /(\d+)\s*张/g;
const JUDGE_PHRASES = /打错|失误|错了|必输|必赢|正确答案|肯定|明显应该|你怎么不|必败|稳输|胜率\s*\d|99%概率/;
/** D1（第54手事故类）：禁止"成文自纠"——先说压不过又说压得过的现场改口 */
const SELF_CORRECTION = /等等|不对，|再想想|说错了|更正|刚才说|其实不能压|却又|反过来又/;
/** REVIEW5 T2：disagreement 卡上的单边排斥语（丢并列义务） */
const ONE_SIDE_EXCLUSION = /只(采|听|按|信|要)?(模型|启发式)|排除启发式|不要(听|管)启发式|以(模型|启发式)为准/;
/** REVIEW5 T2：否定方向的压牌表述（claim 方向反写检测用） */
const NEG_BEAT = /压不过|压不|不能压|大过|盖不过|比.{0,4}小/;
const POS_BEAT = /压得过|能压|大过它|盖得过|压住|接得住/;

function validateSurface(text: string, evidences: DecisionReview[], label: string): CoachValidationError[] {
  const errors: CoachValidationError[]=[];
  const allowed=JSON.stringify(evidences.map(e=>[e.facts,e.actionTexts,(e.claims??[]).map(c=>c.text)]));
  for (const [pattern,kind,unit] of [[CARD_TOKEN,'card_out_of_fact','牌张'],[COUNT_TOKEN,'card_out_of_fact','张数'],[PCT_TOKEN,'percent_out_of_fact','百分比']] as const) {
    const permitted=new Set((allowed.match(pattern)??[]).map(x=>x.replace(/\s/g,'')));
    for (const token of text.match(pattern)??[]) if (!permitted.has(token.replace(/\s/g,''))) errors.push({kind,detail:`${label} 引用证据外${unit}: ${token}`});
  }
  if (SELF_CORRECTION.test(text)) errors.push({kind:'self_correction',detail:`${label} 成文自纠`});
  if (/(?:引擎|规则)(?:规定|要求|首选)|启发式.{0,12}(?:规则规定|必须)/.test(text)) errors.push({kind:'claim_level_mismatch',detail:`${label} 把策略偏好冒充规则要求`});
  if (/(不要|不出|过牌|pass).{0,24}(压不动|压不过|不能压|没有大牌)/i.test(text) && !/不等于|不证明|不能说明|不能据此/.test(text)) errors.push({kind:'claim_level_mismatch',detail:`${label} 从 pass 推断压制能力，证据不支持`});
  if ((POS_BEAT.test(text)||NEG_BEAT.test(text)) && !/不等于|尚未证明|不能断定|不作断言/.test(text)) {
    const claims=evidences.flatMap(e=>(e.claims??[]).filter(c=>c.kind==='rule_relation'));
    // Hard rule comparisons must reproduce a program-generated relation. A paraphrase
    // without that witness falls back to deterministic facts rather than guessing entailment.
    const clean=text.replace(/\s/g,'');
    const supported=claims.some(c=>clean.includes(c.text.replace(/\s/g,'')));
    const reversed=claims.some(c=>{
      const m=c.text.match(/^(.+?)(压得过|压不过)(.+)$/);
      if (!m) return false;
      return clean.includes(`${m[1]}${m[2]==='压得过'?'压不过':'压得过'}${m[3]}`.replace(/\s/g,''));
    });
    if (!supported||reversed) errors.push({kind:'claim_level_mismatch',detail:`${label} 规则比较缺少同方向程序断言或写成反方向`});
  }
  return errors;
}

// Unrestricted prose cannot be certified by checking isolated words or an unrelated
// valid action ID. Accept complete attributed program sentences plus a small
// neutral connective vocabulary. Everything else falls back to the fact cards.
function normalizedSentence(text: string): string { return text.replace(/\s/g,'').replace(/[。.!?！？]+$/u,''); }
function entailedSurface(text: string, evidences: DecisionReview[], kind: 'summary'|'title'|'text', lesson?: CoachLesson): boolean {
  const neutral = kind==='title'
    ? ['规则比较','核对事实与来源','取舍看结构','当前事实','建议来源','条件与证据','资源与余牌','双向比较']
    : ['以下仅说明规则事实','以下陈述原谱事实；策略优劣尚未验证','这是原谱事实，策略优劣尚未验证','当前先核对行动者与公开牌权','证据不足时不判断策略最优','本局整体节奏尚可','这局整体节奏平稳','这局有一个规则点值得记住'];
  const allowed=new Set(neutral.map(normalizedSentence));
  for(const ev of evidences){
    const claims=(ev.claims??[]).filter(c=>!lesson||(lesson.claimIds??[]).includes(c.claimId));
    if(kind==='title'){
      allowed.add(`第${ev.moveNo}手事实`);
      for(const c of claims)if(c.kind==='rule_relation'){
        const m=c.text.match(/^(.+?)压得过(.+)$/u);if(m)allowed.add(normalizedSentence(`${m[1]}能接`));
      }
      continue;
    }
    for(const c of claims){
      allowed.add(normalizedSentence(c.text));
      if(c.kind==='rule_relation')allowed.add(normalizedSentence(`按断言，${c.text}，这是程序验证的规则事实`));
    }
    for(const [id,fact] of Object.entries(ev.facts)){
      if(lesson&&!lesson.factIds.includes(id))continue;
      if((POS_BEAT.test(fact)||NEG_BEAT.test(fact))&&!claims.some(c=>c.kind==='rule_relation'&&c.text===fact))continue;
      allowed.add(normalizedSentence(fact));
    }
    if(kind==='text'&&lesson?.actionIds.includes(ev.actual.actionId))allowed.add(normalizedSentence(`本手实际动作记录为${ev.singleStep.actual.text}`));
    if(ev.singleStep.alternatives.length>0){
      allowed.add('这一手的取舍在证据卡里有两边说明，可以对照断言自行判断');
      const actual=ev.singleStep.actual.combo?.cards.map(c=>c.id).sort((a,b)=>a-b).join(',')??'';
      if(ev.singleStep.alternatives.some(alt=>(alt.combo?.cards.map(c=>c.id).sort((a,b)=>a-b).join(',')??'')!==actual))allowed.add('两种打法各保留不同结构，证据卡已列出');
    }
  }
  if(allowed.has(normalizedSentence(text)))return true;
  const sentences=text.split(/[。！？\n]/u).map(normalizedSentence).filter(Boolean);
  return sentences.length>0&&sentences.every(sentence=>allowed.has(sentence));
}

/** 把证据对象渲染成"程序事实卡"文本（LLM 输入与页面展示共用） */
export function renderFactCards(evidences: DecisionReview[], viewerSeat = evidences[0]?.seat): string {
  if (!Number.isInteger(viewerSeat) || viewerSeat! < 0 || viewerSeat! > 3) throw new Error('valid viewer seat required');
  const seatNames = ['南', '东', '北', '西'].map((name,seat)=>name+(seat===viewerSeat?'(你)':seat===(viewerSeat!+2)%4?'(队友)':''));
  const blocks: string[] = [];
  for (const e of evidences) {
    const lines: string[] = [];
    lines.push(`### 决策 ${e.decisionId}（第${e.moveNo}手，${seatNames[e.seat]}出）`);
    lines.push(`- 回放状态=${e.replayStatus}；规则上下文=${e.ruleContext.levelMode}${e.ruleContext.stageTeam != null ? ` 台上=${e.ruleContext.stageTeam === viewerSeat!%2 ? '我方' : '对方'}` : ''}（版本 ${e.ruleContext.version}）`);
    lines.push(`- 实际动作[${e.actual.actionId}]：${e.actionTexts[e.actual.actionId] ?? '?'}${e.actual.wildAs.length > 0 ? `；万能牌代入：${e.actual.wildAs.join('、')}` : ''}${e.actual.declaration ? `；声明=${e.actual.declaration}` : ''}`);
    lines.push(`- 当时可见[f${e.moveNo}-ctx]：${e.facts[`f${e.moveNo}-ctx`] ?? ''}`);
    lines.push(`- 规则事实[f${e.moveNo}-rule]：${e.facts[`f${e.moveNo}-rule`] ?? ''}`);
    lines.push(`- 实际打法单步后：剩 ${e.singleStep.actual.remainingCards} 张${e.singleStep.actual.wildsSpent > 0 ? `、消耗万能牌 ${e.singleStep.actual.wildsSpent} 张` : ''}${e.singleStep.actual.factIds.length > 0 ? `；结构事实：${e.singleStep.actual.factIds.map((id) => `[${id}] ${e.facts[id]}`).join('；')}` : ''}`);
    for (const a of e.singleStep.alternatives) {
      lines.push(`- 替代(${a.label})[${a.actionId}]：${a.text}；打后剩 ${a.remainingCards} 张${a.wildsSpent > 0 ? `、消耗万能牌 ${a.wildsSpent} 张` : ''}${a.factIds.length > 0 ? `；结构事实：${a.factIds.map((id) => `[${id}] ${e.facts[id]}`).join('；')}` : ''}`);
    }
    if (e.candidates && e.candidates.n > 1) {
      const top3 = e.candidates.ranking.slice(0, 3);
      lines.push(`- 模型排序（${e.policy?.proposalPolicyId}，权重 ${e.policy?.weightHash ?? '?'}，建议非事实）：${top3.map((r) => `[${r.actionId}] ${r.text}(${r.score})`).join('、')}${e.actual.coverage.index >= 0 ? `；实际动作排第 ${e.actual.coverage.index + 1}` : `；实际动作${e.actual.coverage.status === 'same_cards_diff_decl' ? '同牌异声明' : '未覆盖'}`}`);
    } else {
      lines.push(`- 模型层：${e.candidates ? '候选唯一（含被迫让牌），无排序意义' : 'unavailable'}`);
    }
    if (e.heuristic.note) lines.push(`- 启发式偏好说明：${e.heuristic.note}`);
    for (const hb of e.heuristicBreakdowns ?? []) {
      lines.push(`- 启发式评分构成[${hb.actionId}]（Σ=${hb.sum}${hb.sumEqualsScore ? '=总分✓' : '≠总分⚠'}）：${hb.terms.map((t) => `${t.label}${t.value >= 0 ? '+' : ''}${t.value}`).join('、')}`);
    }
    for (const c of e.claims ?? []) {
      lines.push(`- 断言[${c.claimId}]（${c.kind}，${c.scope}）：${c.text}`);
    }
    if (e.rollouts.length > 0) {
      for (const r of e.rollouts) {
        lines.push(`- 续打证据·${r.mode === 'infoset_sampled' ? `信息集抽样（${r.samples} 份暗牌分配）` : '单次确定性推演'}（续打=${r.continuationPolicyId}，根动作来源=${r.rootSourceId}）：实际→${r.actualOutcomeText}；替代→${r.alternativeOutcomeText}${r.metricActual != null && r.metricAlternative != null ? `（g 均值 实际 ${r.metricActual.toFixed(3)} vs 替代 ${r.metricAlternative.toFixed(3)}）` : ''}`);
      }
      if (e.conflicts.some((c) => c.includes('方向相反'))) lines.push('- ⚠ 两来源方向相反：结果依赖续打策略与暗牌分布假设，必须并列引用，禁止只引一边当结论');
    }
    lines.push(`- claimLevel=${e.claimLevel}；允许表达：${e.expressionScope}`);
    if (e.conflicts.length > 0) lines.push(`- 证据冲突（如实呈现，不裁决）：${e.conflicts.join('；')}`);
    if (e.missing.length > 0) lines.push(`- 缺失（不得当作已验证事实讲）：${e.missing.join('；')}`);
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

export function buildCoachJsonMessages(
  evidences: DecisionReview[],
  overview: string[],
  viewerSeat = evidences[0]?.seat,
): Array<{ role: 'system' | 'user'; content: string }> {
  const system = `你是一位掼蛋教练，根据程序生成的证据卡给学生做短篇复盘讲解。

【输出契约（必须严格遵守）】
只输出一个 JSON 对象，不要 markdown 代码块、不要多余文字。结构：
{"summary": "3句以内总评", "lessons": [{"decisionId": "...", "actionIds": ["..."], "factIds": ["..."], "claimIds": ["..."], "claimLevel": "...", "title": "≤12字标题", "text": "2-4句讲解"}]}

【铁律】
1. lessons 2-3 条，每条必须对应一张证据卡（decisionId 必须原样来自证据卡）。
2. actionIds/factIds/claimIds 只能引用该 decisionId 自己证据卡里出现过的 ID；禁止跨决策引用。
3. claimLevel 必须原样填写该证据卡标注的 claimLevel 值（${CLAIM_LEVELS.join(' / ')}）。
4. 讲解里的具体牌张、张数、百分比、模拟结果只能来自该证据卡的文字；禁止引入证据卡之外任何牌名或数字。不确定就不写具体牌。
5. 规则大小关系（谁压得过谁）只能复述断言行[claimId]的结论，不得自行推理，更不得改口（禁止"等等/不对/再想想"式自纠）。
6. 遵守每张卡的"允许表达"范围：${'provable_fact/uncovered'} 档不得评价优劣或给方向建议；disagreement 档必须同屏呈现两种偏好、不裁决对错；禁止"打错/失误/必赢/必输/正确答案"式判罚语。
7. 不虚构因果：方向、机制、规则、身份与数字句只能逐字复述所引用 factId/claimId 的完整程序句，不得靠无关 actionId 授权新结论，不能用“可能”补写未验证机制。
8. summary 使用“以下陈述原谱事实；策略优劣尚未验证。”；title 从“规则比较 / 核对事实与来源 / 取舍看结构 / 当前事实 / 建议来源 / 条件与证据 / 资源与余牌 / 双向比较”中选择。
9. text 只组合所引用 factId/claimId 的完整原句与“这是原谱事实，策略优劣尚未验证。”“当前先核对行动者与公开牌权。”“证据不足时不判断策略最优。”等保守连接句。不要改写原句或省去适用条件；证据不足则少写。`;

  const user = `请基于以下证据卡输出 JSON 复盘讲解。

## 全局事实（程序生成，summary 只许引用这些）
${overview.map((o) => `- ${o}`).join('\n')}

## 证据卡（每张卡对应一条 lesson）
${renderFactCards(evidences,viewerSeat)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** 校验 LLM 的 JSON 输出；返回错误清单（空=通过）。
 *  REVIEW5 T2 强化（对应独立审计六负例）：
 *  - rule_relation claim 方向反写检测（引用真 claim 但正文写反方向）；
 *  - 空引用仍作规则断言拒绝（claimIds 为空时 text 不得出现压牌/胜负方向表述）；
 *  - 张数事实外数值拒绝（"还剩 999 张"类）；
 *  - summary 与 lessons 同一契约（card/percent/count/判罚语全查）；
 *  - disagreement 卡不得降档（降档丢并列义务）且不得单边排斥另一来源。 */
export function validateCoachJson(
  parsed: unknown,
  evidences: DecisionReview[],
): CoachValidationError[] {
  const errors: CoachValidationError[] = [];
  if (typeof parsed !== 'object' || parsed === null) return [{ kind: 'schema', detail: '输出不是 JSON 对象' }];
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.summary !== 'string' || obj.summary.length === 0) errors.push({ kind: 'schema', detail: 'summary 缺失或为空' });
  if (!Array.isArray(obj.lessons) || obj.lessons.length < 1 || obj.lessons.length > 4) {
    errors.push({ kind: 'schema', detail: 'lessons 应为 1-4 条' });
    return errors;
  }
  // summary 同一契约：允许集合=全局 overview 渲染文本之外的全部证据卡文本（保守并集）
  const summaryText = typeof obj.summary === 'string' ? obj.summary : '';
  errors.push(...validateSurface(summaryText,evidences,'summary'));
  const allAllowedText = JSON.stringify(evidences.map((e) => [e.facts, e.actionTexts, (e.claims ?? []).map((c) => c.text)]));
  const allAllowedCards = new Set(allAllowedText.match(CARD_TOKEN) ?? []);
  for (const t of summaryText.match(CARD_TOKEN) ?? []) if (!allAllowedCards.has(t)) errors.push({ kind: 'card_out_of_fact', detail: `summary 引用证据外牌张: ${t}` });
  const allAllowedPct = new Set(allAllowedText.match(PCT_TOKEN) ?? []);
  for (const t of summaryText.match(PCT_TOKEN) ?? []) if (!allAllowedPct.has(t)) errors.push({ kind: 'percent_out_of_fact', detail: `summary 引用证据外百分比: ${t}` });
  const allAllowedCounts = new Set((allAllowedText.match(COUNT_TOKEN) ?? []).map((m) => m.trim()));
  for (const t of summaryText.match(COUNT_TOKEN) ?? []) if (!allAllowedCounts.has(t.trim())) errors.push({ kind: 'card_out_of_fact', detail: `summary 引用证据外张数: ${t.trim()}` });
  if (evidences.some((e) => e.claimLevel === 'provable_fact' || e.claimLevel === 'uncovered' || e.claimLevel === 'disagreement') && JUDGE_PHRASES.test(summaryText)) {
    errors.push({ kind: 'forbidden_judgement', detail: 'summary 出现判罚/胜负断言语（summary 与 lesson 同一契约）' });
  }
  if (SELF_CORRECTION.test(summaryText)) errors.push({ kind: 'self_correction', detail: 'summary 出现成文自纠' });

  const byDecision = new Map(evidences.map((e) => [e.decisionId, e]));
  (obj.lessons as Record<string, unknown>[]).forEach((l, i) => {
    if (typeof l!=='object'||l===null) {errors.push({kind:'schema',lessonIndex:i,detail:'lesson 必须是对象'});return;}
    const ev = typeof l.decisionId === 'string' ? byDecision.get(l.decisionId) : undefined;
    if (!ev) { errors.push({ lessonIndex: i, kind: 'unknown_decision', detail: `decisionId 不存在或不在本次证据集: ${String(l.decisionId)}` }); return; }
    const validActions = new Set([ev.actual.actionId, ...Object.keys(ev.actionTexts), ...(ev.candidates?.ranking.map((r) => r.actionId) ?? [])]);
    const validFacts = new Set([...Object.keys(ev.facts), ...ev.singleStep.actual.factIds, ...ev.singleStep.alternatives.flatMap((a) => a.factIds)]);
    if (!Array.isArray(l.actionIds)) errors.push({ lessonIndex: i, kind: 'schema', detail: 'actionIds 缺失' });
    else for (const a of l.actionIds) if (!validActions.has(a)) errors.push({ lessonIndex: i, kind: 'unknown_action', detail: `actionId 不属于 ${ev.decisionId}: ${a}` });
    if (!Array.isArray(l.factIds)) errors.push({ lessonIndex: i, kind: 'schema', detail: 'factIds 缺失' });
    else for (const f of l.factIds) if (!validFacts.has(f)) errors.push({ lessonIndex: i, kind: 'unknown_fact', detail: `factId 不属于 ${ev.decisionId}: ${f}` });
    // D3：LLM 允许更保守（不得加强）——lesson 可用该卡的 claimLevel 或任何更受限档
    // REVIEW5 T2：disagreement 例外——降档会丢失"必须并列呈现"义务，禁止降档
    const RANK: Record<ClaimLevel, number> = { provable_fact: 1, uncovered: 1, model_preference: 2, disagreement: 3, conditional_support: 4 };
    const given = String(l.claimLevel) as ClaimLevel;
    if (!(given in RANK) || RANK[given] > RANK[ev.claimLevel]) {
      errors.push({ lessonIndex: i, kind: 'claim_level_mismatch', detail: `claimLevel 实为 ${String(l.claimLevel)}，超出该证据卡允许的最高档 ${ev.claimLevel}（可以说得更保守，不能加强）` });
    }
    if (ev.claimLevel === 'disagreement' && given === 'model_preference') {
      errors.push({ lessonIndex: i, kind: 'claim_level_mismatch', detail: 'disagreement 卡不得降档为 model_preference：降档丢失双方并列义务' });
    }
    // D3：claimIds 必须属于该决策；方向/因果表述须有对应 kind 的断言支撑
    const validClaims = new Map((ev.claims ?? []).map((c) => [c.claimId, c]));
    if (Array.isArray(l.claimIds)) {
      for (const cid of l.claimIds) {
        if (!validClaims.has(cid)) errors.push({ lessonIndex: i, kind: 'unknown_claim', detail: `claimId 不属于 ${ev.decisionId}: ${cid}` });
      }
    }
    const text = typeof l.text === 'string' ? l.text : '';
    for (const [name,surface] of [['title',l.title],['text',l.text]] as const) {
      if (typeof surface==='string') errors.push(...validateSurface(surface,[ev],name).map(e=>({...e,lessonIndex:i})));
    }
    if (SELF_CORRECTION.test(text)) errors.push({ lessonIndex: i, kind: 'self_correction', detail: '出现成文自纠（现场改口）：讲解须一次说清，规则比较以断言为准' });
    if (typeof l.title !== 'string' || !l.title.length || l.title.length > 16) errors.push({ lessonIndex: i, kind: 'schema', detail: 'title 缺失或超过 16 字' });
    if (text.length === 0 || text.length > 400) errors.push({ lessonIndex: i, kind: 'schema', detail: 'text 应为 1-400 字' });
    // 事实外牌张：允许集合=该证据卡全部渲染文本（含断言文本——断言中的牌也是卡内事实）
    const allowedText = JSON.stringify([ev.facts, ev.actionTexts, (ev.claims ?? []).map((c) => c.text)]);
    const allowedCards = new Set(allowedText.match(CARD_TOKEN) ?? []);
    for (const t of text.match(CARD_TOKEN) ?? []) if (!allowedCards.has(t)) errors.push({ lessonIndex: i, kind: 'card_out_of_fact', detail: `证据卡之外的牌张: ${t}` });
    const allowedPct = new Set(allowedText.match(PCT_TOKEN) ?? []);
    for (const t of text.match(PCT_TOKEN) ?? []) if (!allowedPct.has(t)) errors.push({ lessonIndex: i, kind: 'percent_out_of_fact', detail: `证据卡之外的百分比: ${t}` });
    // REVIEW5 T2：张数事实外数值（"还剩 999 张牌"）
    const allowedCounts = new Set((allowedText.match(COUNT_TOKEN) ?? []).map((m) => m.trim()));
    for (const t of text.match(COUNT_TOKEN) ?? []) if (!allowedCounts.has(t.trim())) errors.push({ lessonIndex: i, kind: 'card_out_of_fact', detail: `证据卡之外的张数: ${t.trim()}（张数只能复述卡内事实）` });
    if ((ev.claimLevel === 'provable_fact' || ev.claimLevel === 'uncovered' || ev.claimLevel === 'disagreement') && JUDGE_PHRASES.test(text)) {
      errors.push({ lessonIndex: i, kind: 'forbidden_judgement', detail: `${ev.claimLevel} 档出现判罚语` });
    }
    // REVIEW5 T2：rule_relation 方向反写——引用真 claim 但正文方向相反
    const refClaimIds = Array.isArray(l.claimIds) ? (l.claimIds as string[]) : [];
    for (const cid of refClaimIds) {
      const c = validClaims.get(cid);
      if (!c || c.kind !== 'rule_relation') continue;
      const m = c.text.match(/^(.+?)(压得过|压不过)(.+)$/);
      if (!m) continue;
      const [, a, dir, b] = m;
      const aTok = [...a.matchAll(CARD_TOKEN)].map((x) => x[0]);
      const bTok = [...b.matchAll(CARD_TOKEN)].map((x) => x[0]);
      const mentionsA = aTok.some((t) => text.includes(t)) || text.includes(a.trim());
      const mentionsB = bTok.some((t) => text.includes(t)) || text.includes(b.trim());
      // 引用了该断言：主语出现时，正文不得出现无正向词对冲的反向表述
      //（审计负例形态："小王压不过当前这手牌"——只提主语不提对象也算反写）
      if (mentionsA || mentionsB) {
        if (dir === '压得过' && NEG_BEAT.test(text) && !POS_BEAT.test(text)) {
          errors.push({ lessonIndex: i, kind: 'claim_level_mismatch', detail: `断言[${cid}]为"${a}压得过${b}"，正文写成反方向（压不过）——方向只能复述断言` });
        }
        if (dir === '压不过' && POS_BEAT.test(text) && !NEG_BEAT.test(text)) {
          errors.push({ lessonIndex: i, kind: 'claim_level_mismatch', detail: `断言[${cid}]为"${a}压不过${b}"，正文写成反方向（压得过）` });
        }
      }
    }
    // REVIEW5 T2：空引用不得作规则/胜负断言
    const hasAnyRef = (Array.isArray(l.actionIds) && l.actionIds.length > 0)
      || (Array.isArray(l.factIds) && l.factIds.length > 0)
      || refClaimIds.length > 0;
    if (!hasAnyRef && (POS_BEAT.test(text) || NEG_BEAT.test(text) || /赢了|输了|获胜|落败/.test(text))) {
      errors.push({ lessonIndex: i, kind: 'unknown_claim', detail: 'actionIds/factIds/claimIds 全空，但正文作出规则/胜负断言——断言必须引用 claimId' });
    }
    // REVIEW5 T2：disagreement 卡单边排斥
    if (ev.claimLevel === 'disagreement' && ONE_SIDE_EXCLUSION.test(text)) {
      errors.push({ lessonIndex: i, kind: 'claim_level_mismatch', detail: 'disagreement 卡禁止单边排斥（"只采模型/排除启发式"丢失并列义务）' });
    }
  });
  if(typeof obj.summary==='string'&&!entailedSurface(obj.summary,evidences,'summary'))errors.push({kind:'claim_level_mismatch',detail:'summary 含未由完整程序句或保守连接句支持的表述'});
  (obj.lessons as CoachLesson[]).forEach((lesson,i)=>{
    const ev=evidences.find(e=>e.decisionId===lesson?.decisionId);if(!ev||!Array.isArray(lesson.actionIds)||!Array.isArray(lesson.factIds))return;
    for(const key of ['title','text'] as const)if(typeof lesson[key]==='string'&&!entailedSurface(lesson[key],[ev],key,lesson))errors.push({lessonIndex:i,kind:'claim_level_mismatch',detail:`${key} 含未由所引用完整程序句支持的表述；无关动作引用不授权结论`});
  });
  return errors;
}

/** 从 LLM 原文提取 JSON（容忍 ```json 围栏）；失败返回 null */
export function parseCoachJson(raw: string): CoachJsonOutput | null {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(stripped.slice(start, end + 1));
    if (typeof obj !== 'object' || obj === null) return null;
    return obj as CoachJsonOutput;
  } catch {
    return null;
  }
}

/** Live, end-of-stream, and cached content share exactly the same gate. */
export function acceptCoachResponse(raw: string, evidences: DecisionReview[]): CoachJsonOutput | null {
  try {
    const parsed=parseCoachJson(raw);
    return parsed && validateCoachJson(parsed,evidences).length===0 ? parsed : null;
  } catch { return null; }
}
function cacheWitness(evidences: DecisionReview[], context: Record<string,unknown>): string {
  return JSON.stringify({schema:'coach-cache-v3',context,prompt:COACH_JSON_PROMPT_VERSION,
    validator:COACH_VALIDATOR_VERSION,validatorSource:validateCoachJson.toString()+validateSurface.toString()+entailedSurface.toString()+normalizedSentence.toString(),evidences});
}
export function makeCoachCache(raw: string, evidences: DecisionReview[], context: Record<string,unknown>): string {
  const payload=acceptCoachResponse(raw,evidences);
  if (!payload) throw new Error('unverified coach output');
  return JSON.stringify({schema:'coach-cache-v3',witness:cacheWitness(evidences,context),payload});
}
export function readCoachCache(raw: string|null, evidences: DecisionReview[], context: Record<string,unknown>): CoachJsonOutput|null {
  if (!raw) return null;
  try {
    const value=JSON.parse(raw);
    if (value.schema!=='coach-cache-v3'||value.witness!==cacheWitness(evidences,context)) return null;
    return acceptCoachResponse(JSON.stringify(value.payload),evidences);
  } catch { return null; }
}

/** 重试 prompt：附上具体错误清单 */
export function buildRetryMessages(
  base: Array<{ role: 'system' | 'user'; content: string }>,
  rawResponse: string,
  errors: CoachValidationError[],
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    ...base,
    { role: 'user', content: `你上一版输出违反了输出契约，被校验层拒绝，原文如下：\n${rawResponse.slice(0, 4000)}\n\n具体错误：\n${errors.map((e, i) => `${i + 1}. ${e.kind}${e.lessonIndex != null ? `（第${e.lessonIndex + 1}条 lesson）` : ''}: ${e.detail}`).join('\n')}\n\n请重新输出完整 JSON（同样的契约），修正所有错误。只输出 JSON。` },
  ];
}
