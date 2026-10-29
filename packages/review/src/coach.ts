import { RANK_NAME, SUIT_GLYPH, type Card, type GameRecord } from '@gd/engine';
import type { CounterfactualResult } from './counterfactual';
import { gradeIcon, type MoveAnalysis, type ReviewAnalysis } from './analyzer';
import type { NnReviewSummary } from './nnAdvisor';
import { KNOWLEDGE, knowledgeOf } from './knowledge';
import { describeAction } from './describeAction';
import { buildTeachPlan } from './teach';

/** 牌张序列化：♠5 ♥8（万能牌标注「♥级牌当5」） */
function cardsText(cards: Card[] | undefined): string {
  if (!cards || cards.length === 0) return '';
  return cards
    .map((c) => (c.suit === 'J' ? (c.rank === 17 ? '大王' : '小王') : `${SUIT_GLYPH[c.suit]}${RANK_NAME[c.rank]}`))
    .join(' ');
}

/** 单个关键手的复现剧本（全部来自引擎记录，LLM 只准引用不准改编） */
function moveScript(mv: MoveAnalysis, seatNames: string[], nn?: NnReviewSummary['moves'][number]): string {
  const lines: string[] = [];
  lines.push(`【第${mv.moveNo}手复现｜${mv.context.isLead ? '你领出' : `${seatNames[mv.context.toBeatPlayer ?? 0]}领出此轮`}】`);
  if (mv.trickBefore.length > 0) {
    lines.push('本轮在你之前的动作：');
    for (const a of mv.trickBefore) {
      lines.push(`- ${seatNames[a.player]}：${a.combo ? describeAction(a.combo) : a.pass ? '不出' : `${cardsText(a.cards)}（声明未恢复）`}`);
    }
  } else if (!mv.context.isLead) {
    lines.push('（你是本轮第一个跟牌者）');
  }
  lines.push(`你打出：${mv.pass ? '不出' : describeAction(mv.playedCombo ?? null) === '不出' ? cardsText(mv.playedCards) + '（声明未恢复）' : describeAction(mv.playedCombo)}（${gradeIcon(mv.grade)} ${mv.grade === 'divergent' ? '启发式分歧较大' : mv.grade === 'uncovered' ? '候选未覆盖，无法比较' : mv.grade === 'forced' ? '无牌可跟' : mv.grade === 'ok' ? '略有分歧' : '与启发式首选一致'}）`);
  lines.push(`引擎建议：${mv.recommendedPass ? '不出' : mv.recCombo ? describeAction(mv.recCombo) : `${cardsText(mv.recCards)}（${mv.recommendedText}）`}`);
  lines.push(`启发式说明（偏好依据，非判错）：${mv.note}`);
  if (nn) {
    lines.push(`模型建议（来源 ck180，建议排名非客观最佳）：${nn.verdictText}${nn.top.length > 0 ? `；模型前三：${nn.top.map((t) => t.text).join('、')}` : ''}`);
  }
  if (mv.nextMove) {
    lines.push(`紧接着下一手：${seatNames[mv.nextMove.player]}${mv.nextMove.pass ? '不出' : `打出 ${cardsText(mv.nextMove.cards)}`}`);
  }
  lines.push(`当时各家剩牌：${mv.context.handsBefore.map((n, i) => `${seatNames[i]}${n}张`).join('、')}`);
  return lines.join('\n');
}

/**
 * LLM 教练：把引擎的结构化分析（量化指标 + 每手标注 + 反事实胜率）
 * 组装成 prompt，让大模型只负责"讲解"，不负责"判断"——
 * 数牌、剩牌、胜负全部以引擎数据为准，避免大模型幻觉。
 */
/** 报告牌张 lint：报告中出现的每张具体牌都必须能在喂给 LLM 的剧本/数据里找到。
 * 返回剧本之外的牌张（LLM 编牌的最后防线；出现即显示告警，防再犯 2026-10-25 的"4A"事故）。 */
const CARD_TOKEN = /[♠♥♦♣](?:10|[2-9JQKA])|小王|大王/g;
export function lintReportCards(report: string, allowedText: string): string[] {
  const allowed = new Set(allowedText.match(CARD_TOKEN) ?? []);
  const used = new Set(report.match(CARD_TOKEN) ?? []);
  return [...used].filter((t) => !allowed.has(t));
}

export function buildCoachMessages(
  record: GameRecord,
  analysis: ReviewAnalysis,
  counterfactuals: CounterfactualResult[],
  nn?: NnReviewSummary,
): Array<{ role: 'system' | 'user'; content: string }> {
  const seatNames = ['你（南）', '东家', '队友（北）', '西家'];
  const result = record.result;
  const rankNames = ['头游', '二游', '三游', '末游'];

  const system = `你是一位经验丰富的掼蛋教练，正在给学生复盘一局牌。
规则要点：掼蛋是 4 人 2v2（南北一队、东西一队），两副牌 108 张每人 27 张；级牌大于 A 小于王；红心级牌是万能配牌；顺子固定五张（A 可作 1）；三连对恰三对；钢板两连三不带对；炸弹四到八张。

【铁律：禁止编牌】
引擎会为每个关键手提供「复现剧本」，其中每一张牌（含花色点数、万能牌代入）都是真实记录。
1. 你提到任何具体牌张时，必须原样引用剧本里的牌，一个字都不能改（剧本写 ♠8 ♥8 ♦8 ♣8 就是四个8，绝不能说成"四个3"）
2. 剧本没写的细节（如某家暗牌）一律不提，更不许推断"他手里有什么牌"当事实讲
3. 不确定就说不确定，禁止用"你肯定/你明明"编造学生的手牌

【四层信息，分清来源，不许混称】
剧本里有四类信息，讲解时必须分清：①对局事实（当时公开信息与实际出法，可核实）；②引擎建议（启发式中级口径，是偏好不是对错）；③模型建议（ck180 候选排名，是建议不是客观最佳，分数不是胜率）；④事后情景演示（真实牌面、固定续打策略下各推演一次的条件结果——不是胜率，不代表当时信息下的必然走向）。禁止把任何一层说成"客观正确"；禁止把任何一层当成判错的唯一依据；禁止说"你打错了/失误"，只能说"与某层建议分歧较大"。

【输出格式：图文混排】
对每个关键手的讲解，开头单独一行输出标记 [[MOVE:手号]]（如 [[MOVE:17]]），前端会把该标记渲染为这一轮的可视化复现牌面。标记行之后接你的文字讲解。结构：
[[MOVE:17]]
**第17手 · 标题**：当时局面 → 你打了什么 → 问题 → 应该怎么打 → 对后续的影响。
整体结构：总评（3-4句，直接点出本局输赢根因）→ 关键手逐个讲解（每个都带 [[MOVE:N]] 标记）→ 2-3条针对性改进建议。
全文 800-1200 字，口语化像坐旁边的老教练，不写空话。`;

  const lines: string[] = [];
  lines.push(`## 对局信息`);
  lines.push(`- 学生座位：南（0），队友：北（2）；对手：东（1）、西（3）`);
  // R1-B（REVIEW2-EXEC §4.1）：级牌/万能牌说明必须从记录的真实规则上下文生成，禁止按双方级数另拼一套
  const levelMode = record.ruleOpts.levelMode ?? 'both';
  if (levelMode === 'stage') {
    const stageTeam = record.stageTeam ?? 0;
    const stageLevel = record.levelsBefore[stageTeam];
    const otherLevel = record.levelsBefore[1 - stageTeam];
    lines.push(`- 本局级数：${stageTeam === 0 ? '我方' : '对方'}在台，全场打 ${RANK_NAME[stageLevel]}（级牌共 8 张，红心${RANK_NAME[stageLevel]}×2 为万能配牌；${stageTeam === 0 ? '对方' : '我方'}级数 ${RANK_NAME[otherLevel]} 的牌本局不是级牌、其红心不参与配牌）`);
  } else {
    lines.push(`- 本局级数（历史口径 ${levelMode}）：我方打 ${RANK_NAME[record.levelsBefore[0]]}、对方打 ${RANK_NAME[record.levelsBefore[1]]}（红心${[...new Set(record.levelsBefore)].map((l) => RANK_NAME[l]).join('/')}为万能配牌——该局按当时旧规则回放）`);
  }
  if (result) {
    lines.push(`- 结果：${result.finishOrder.map((p, i) => `${rankNames[i]}=${seatNames[p]}`).join('、')}；${result.winnerTeam === 0 ? '我方（学生队）胜' : '对方胜'}${result.doubleUp ? '（双上游）' : ''}；升级 +${result.upgrade}`);
    lines.push(`- 学生名次：${rankNames[analysis.humanRank - 1]}`);
  }
  lines.push(`- 学生总出手 ${analysis.metrics.actualHands} 次（开局手牌启发式参考拆分约 ${analysis.metrics.optimalHands} 组，未证明最少）`);
  lines.push('');
  lines.push(`## 引擎量化分析（描述性统计，非评级）`);
  const m = analysis.metrics;
  const st2 = analysis.stats;
  lines.push(`- 决策：共 ${st2.total} 手，其中无牌可跟 ${st2.forced} 手、启发式候选未覆盖 ${st2.uncovered} 手（无法比较，不判对错）`);
  lines.push(`- 可比较决策中与启发式分歧较大的 ${st2.divergent} 手（占 ${(st2.divergenceRate * 100).toFixed(0)}%，筛选信号，不是失误判罚）`);
  lines.push(`- 配合：让队友 ${m.letMateCount} 次 / 压队友 ${m.beatMateCount} 次${m.beatMateWithBig > 0 ? `（其中 ${m.beatMateWithBig} 次用大牌压队友——启发式视角的偏好）` : ''}`);
  lines.push(`- 炸弹：使用 ${m.bombUsed} 次${m.bombHeldToEnd > 0 ? `，终局仍握有 ${m.bombHeldToEnd} 个炸弹未使用` : ''}`);
  lines.push(`- 配牌：万能牌使用 ${m.wildUsed} 次${m.wildLowValue > 0 ? `，其中 ${m.wildLowValue} 次启发式评分较低` : ''}`);
  lines.push(`- 存在一手出完合法动作却让牌：${m.missedFinish} 次`);
  if (nn) {
    const st = nn.stats;
    lines.push(`- 模型建议（ck180）：覆盖 ${st.aligned}/${st.totalDecisions} 手，未覆盖 ${st.uncovered + st.sameCardsDiffDecl}，唯一候选 ${st.singleCandidate}${st.firstChoiceAgreementDenom > 0 ? `，已对齐多候选中首选一致率 ${Math.round(st.firstChoiceAgreement / st.firstChoiceAgreementDenom * 100)}%` : ''}`);
  }
  if (analysis.divergentMoves.length === 0) {
    lines.push(`- 特别说明：这局没有启发式分歧较大的手。讲解重点放在亮点与值得复制的打法上，剧本里的手就是给你选的素材。`);
  }
  lines.push('');

  lines.push(`## 关键手复现剧本（每张牌均为引擎真实记录，讲解时原样引用）`);
  const keyMoves = [
    ...analysis.divergentMoves,
    ...analysis.moves.filter((m) => m.grade === 'good' && m.tags.length > 0),
  ]
    .sort((a, b) => a.moveNo - b.moveNo)
    .filter((m, i, arr) => i === 0 || m.moveNo !== arr[i - 1].moveNo);
  // 干净局（无失误、无亮点标签）也要给剧本：补上出手分量最大的几手，否则教练无牌可讲
  if (keyMoves.length < 3) {
    const chosen = new Set(keyMoves.map((m) => m.moveNo));
    for (const m of [...analysis.moves]
      .filter((m) => (m.playedCards?.length ?? 0) > 0 && m.grade !== 'forced' && !chosen.has(m.moveNo))
      .sort((a, b) => (b.playedCards?.length ?? 0) - (a.playedCards?.length ?? 0))) {
      if (keyMoves.length >= 3) break;
      keyMoves.push(m);
      chosen.add(m.moveNo);
    }
    keyMoves.sort((a, b) => a.moveNo - b.moveNo);
  }
  const nnByMove = new Map((nn?.moves ?? []).map((m) => [m.moveNo, m]));
  for (const mv of keyMoves.slice(0, 6)) {
    lines.push(moveScript(mv, seatNames, nnByMove.get(mv.moveNo)));
    lines.push('');
  }

  // R3（REVIEW2-EXEC §5.1/5.2）：教学点——程序生成"当时知道什么/可选什么/各保留什么"的可证明事实
  const plan = buildTeachPlan(record, analysis, seatNames);
  lines.push(`## 全局事实（程序生成；总评只许引用这些与剧本，不得自行编整盘因果）`);
  for (const f of plan.overviewFacts) lines.push(`- ${f}`);
  lines.push('');
  if (plan.points.length > 0) {
    lines.push(`## 教学点（值得讨论的决策；"可核实"行为规则验证事实，禁止引申为必赢/必错）`);
    for (const tp of plan.points) {
      lines.push(`【第${tp.moveNo}手｜${tp.claimLevelText}】`);
      lines.push(`- 当时知道：${tp.contextText}`);
      for (const a of [tp.actual, ...tp.alternatives]) {
        const acts = a.combo ? describeAction(a.combo) : '不出';
        const wild = a.wildsSpent > 0 ? `，消耗万能牌 ${a.wildsSpent} 张` : '';
        const facts = a.facts.length > 0 ? `；可核实：${a.facts.map((f) => f.text).join('；')}` : '';
        lines.push(`- ${a.label}：${acts}；打后剩 ${a.remainingCards} 张${wild}${facts}`);
      }
      lines.push('');
    }
  }

  if (counterfactuals.length > 0) {
    // R1-A/R1-D（REVIEW2-EXEC §4.1）：来源如实（启发式，不是模型名）；单次确定性推演，不给百分比
    lines.push(`## 事后情景演示（真实牌面、固定续打策略下的单次条件推演；不是当时信息下的胜率）`);
    for (const cf of counterfactuals) {
      lines.push(`- 第${cf.moveNo}手：实际打「${cf.actualText}」→ ${cf.actualOutcome}；替代「${cf.alternativeText}」（由${cf.sourceId}提出）→ ${cf.alternativeOutcome}。续打策略=${cf.continuationPolicyId}${cf.truncated ? '（有分支超步数上限，结果为折算排名）' : ''}。两分支结果不同不等于实际打法错误——只是同一续打策略下的两种走向`);
    }
    lines.push('');
  }

  const tags = new Set(analysis.divergentMoves.flatMap((mv) => mv.tags));
  if (tags.size > 0) {
    lines.push(`## 涉及的知识点`);
    for (const kp of knowledgeOf([...tags])) {
      lines.push(`- 【${kp.name}】${kp.brief}`);
    }
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: `请根据以下引擎分析给学生复盘讲解：\n\n${lines.join('\n')}` },
  ];
}

/** 无 LLM 时的离线模板报告 */
export function buildOfflineReport(
  analysis: ReviewAnalysis,
  counterfactuals: CounterfactualResult[],
): string {
  const parts: string[] = [];
  parts.push(`## 复盘报告（离线版 · 规则引擎生成）`);
  parts.push(`本局你打了 ${analysis.moves.length} 手（无牌可跟 ${analysis.stats.forced}、候选未覆盖 ${analysis.stats.uncovered}），与启发式分歧较大的 ${analysis.stats.divergent} 手。${analysis.humanTeamWon ? '本局你们赢了' : '本局你们输了'}。`);
  if (analysis.metrics.beatMateWithBig > 0) {
    parts.push(`启发式视角提醒：本局你有 ${analysis.metrics.beatMateWithBig} 次用大牌压了正在发力的队友——【牌权让渡】：队友出大牌时让他走，你的大牌留给拦对手（偏好建议）。`);
  }
  if (analysis.metrics.bombHeldToEnd > 0) {
    parts.push(`你终局还握着 ${analysis.metrics.bombHeldToEnd} 个炸弹没打出去。炸弹不是收藏品——对手冲游时该炸就炸（偏好建议）。`);
  }
  if (analysis.metrics.missedFinish > 0) {
    parts.push(`有 ${analysis.metrics.missedFinish} 手存在"一手出完的合法动作"但你选择了让牌。`);
  }
  if (analysis.divergentMoves.length > 0) {
    parts.push(`### 分歧较大的手 Top${Math.min(3, analysis.divergentMoves.length)}`);
    for (const mv of analysis.divergentMoves.slice(0, 3)) {
      parts.push(`- 第${mv.moveNo}手：你打了「${mv.playedText}」，启发式更偏好「${mv.recommendedText}」。${mv.note}`);
      const cf = counterfactuals.find((c) => c.moveNo === mv.moveNo);
      if (cf) {
        parts.push(`  - 事后情景演示：实际打法 → ${cf.actualOutcome}；替代打法（${cf.sourceId} 提出）→ ${cf.alternativeOutcome}。单次确定性推演，不是胜率`);
      }
    }
  }
  const tags = new Set(analysis.divergentMoves.flatMap((mv) => mv.tags));
  if (tags.size > 0) {
    parts.push(`### 本局知识点`);
    for (const kp of knowledgeOf([...tags]).slice(0, 4)) {
      parts.push(`- 【${kp.name}】${kp.brief}`);
    }
  }
  parts.push(`> 配置 .env 中的 LLM_API_KEY 后，可生成更详细的教练语音讲解版报告。`);
  return parts.join('\n\n');
}
