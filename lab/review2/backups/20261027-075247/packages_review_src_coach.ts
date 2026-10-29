import { RANK_NAME, SUIT_GLYPH, type Card, type GameRecord } from '@gd/engine';
import type { CounterfactualResult } from './counterfactual';
import { gradeIcon, type MoveAnalysis, type ReviewAnalysis } from './analyzer';
import type { NnReviewSummary } from './nnAdvisor';
import { KNOWLEDGE, knowledgeOf } from './knowledge';

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
      lines.push(`- ${seatNames[a.player]}：${a.pass ? '不出' : `${cardsText(a.cards)}`}`);
    }
  } else if (!mv.context.isLead) {
    lines.push('（你是本轮第一个跟牌者）');
  }
  lines.push(`你打出：${mv.pass ? '不出' : cardsText(mv.playedCards)}（引擎判定 ${gradeIcon(mv.grade)}）`);
  lines.push(`引擎建议：${mv.recommendedPass ? '不出' : `${cardsText(mv.recCards)}（${mv.recommendedText}）`}`);
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
剧本里有四类信息，讲解时必须分清：①对局事实（当时公开信息与实际出法，可核实）；②引擎建议（启发式中级口径）；③模型建议（ck180 候选排名，是建议不是客观最佳，分数不是胜率）；④反事实模拟（真实手牌条件下、续打用现有启发式的条件结果，不代表当时必赢/必输）。禁止把任何一层说成"客观正确"；禁止把模型排名或模拟结果当成判错的唯一依据。

【输出格式：图文混排】
对每个关键手的讲解，开头单独一行输出标记 [[MOVE:手号]]（如 [[MOVE:17]]），前端会把该标记渲染为这一轮的可视化复现牌面。标记行之后接你的文字讲解。结构：
[[MOVE:17]]
**第17手 · 标题**：当时局面 → 你打了什么 → 问题 → 应该怎么打 → 对后续的影响。
整体结构：总评（3-4句，直接点出本局输赢根因）→ 关键手逐个讲解（每个都带 [[MOVE:N]] 标记）→ 2-3条针对性改进建议。
全文 800-1200 字，口语化像坐旁边的老教练，不写空话。`;

  const lines: string[] = [];
  lines.push(`## 对局信息`);
  lines.push(`- 学生座位：南（0），队友：北（2）；对手：东（1）、西（3）`);
  lines.push(`- 本局级数：我方打 ${RANK_NAME[record.levelsBefore[0]]}、对方打 ${RANK_NAME[record.levelsBefore[1]]}（红心${[...new Set(record.levelsBefore)].map((l) => RANK_NAME[l]).join('/')}为万能配牌）`);
  if (result) {
    lines.push(`- 结果：${result.finishOrder.map((p, i) => `${rankNames[i]}=${seatNames[p]}`).join('、')}；${result.winnerTeam === 0 ? '我方（学生队）胜' : '对方胜'}${result.doubleUp ? '（双上游）' : ''}；升级 +${result.upgrade}`);
    lines.push(`- 学生名次：${rankNames[analysis.humanRank - 1]}`);
  }
  lines.push(`- 学生总出手 ${analysis.metrics.actualHands} 次（开局手牌最优拆解约 ${analysis.metrics.optimalHands} 手）`);
  lines.push('');
  lines.push(`## 引擎量化分析`);
  const m = analysis.metrics;
  lines.push(`- 配合：让队友 ${m.letMateCount} 次 / 压队友 ${m.beatMateCount} 次${m.beatMateWithBig > 0 ? `（其中 ${m.beatMateWithBig} 次用大牌压队友，属于明显失误）` : ''}`);
  lines.push(`- 炸弹：使用 ${m.bombUsed} 次${m.bombHeldToEnd > 0 ? `，终局仍握有 ${m.bombHeldToEnd} 个炸弹未使用` : ''}`);
  lines.push(`- 配牌：万能牌使用 ${m.wildUsed} 次${m.wildLowValue > 0 ? `，其中 ${m.wildLowValue} 次属于低价值使用` : ''}`);
  lines.push(`- 错失清牌走人：${m.missedFinish} 次`);
  lines.push(`- 综合评级：${analysis.overall}（失误率 ${((analysis.badMoves.length / Math.max(1, analysis.moves.length)) * 100).toFixed(0)}%）`);
  if (nn) {
    const st = nn.stats;
    lines.push(`- 模型建议（ck180）：覆盖 ${st.aligned}/${st.totalDecisions} 手，未覆盖 ${st.uncovered + st.sameCardsDiffDecl}，唯一候选 ${st.singleCandidate}${st.firstChoiceAgreementDenom > 0 ? `，已对齐多候选中首选一致率 ${Math.round(st.firstChoiceAgreement / st.firstChoiceAgreementDenom * 100)}%` : ''}`);
  }
  if (analysis.badMoves.length === 0) {
    lines.push(`- 特别说明：这局引擎没有判定出明显失误。讲解重点放在亮点与值得复制的打法上，剧本里的手就是给你选的素材。`);
  }
  lines.push('');

  lines.push(`## 关键手复现剧本（每张牌均为引擎真实记录，讲解时原样引用）`);
  const keyMoves = [
    ...analysis.badMoves,
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

  if (counterfactuals.length > 0) {
    lines.push(`## 反事实模拟（真实手牌平行重演；建议来源=ck180，续打策略=现有启发式版本——条件结果，不代表当时信息下必然`);
    for (const cf of counterfactuals) {
      lines.push(`- 第${cf.moveNo}手：打「${cf.actualText}」胜率 ${(cf.actualWinRate * 100).toFixed(0)}% vs 打「${cf.betterText}」胜率 ${(cf.betterWinRate * 100).toFixed(0)}%（各模拟 ${cf.sims} 局）`);
    }
    lines.push('');
  }

  const tags = new Set(analysis.badMoves.flatMap((mv) => mv.tags));
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
  parts.push(`本局你打了 ${analysis.moves.length} 手，其中 ${analysis.badMoves.length} 手被引擎判定为失误，综合评级 **${analysis.overall}**。${analysis.humanTeamWon ? '本局你们赢了' : '本局你们输了'}。`);
  if (analysis.metrics.beatMateWithBig > 0) {
    parts.push(`**最大问题：大牌压队友。** 本局你有 ${analysis.metrics.beatMateWithBig} 次用大牌压了正在发力的队友——记住【牌权让渡】：队友出大牌时让他走，你的大牌留给拦对手。`);
  }
  if (analysis.metrics.bombHeldToEnd > 0) {
    parts.push(`你终局还握着 ${analysis.metrics.bombHeldToEnd} 个炸弹没打出去。炸弹不是收藏品——对手冲游时该炸就炸。`);
  }
  if (analysis.metrics.missedFinish > 0) {
    parts.push(`有 ${analysis.metrics.missedFinish} 次你可以直接清牌走人却选择了让牌，白白错过名次。`);
  }
  if (analysis.badMoves.length > 0) {
    parts.push(`### 失误手 Top${Math.min(3, analysis.badMoves.length)}`);
    for (const mv of analysis.badMoves.slice(0, 3)) {
      parts.push(`- 第${mv.moveNo}手：你打了「${mv.playedText}」，建议「${mv.recommendedText}」。${mv.note}`);
      const cf = counterfactuals.find((c) => c.moveNo === mv.moveNo);
      if (cf) {
        parts.push(`  - 反事实模拟：按建议打胜率 ${(cf.betterWinRate * 100).toFixed(0)}%，你实际打法 ${(cf.actualWinRate * 100).toFixed(0)}%（各 ${cf.sims} 局）`);
      }
    }
  }
  const tags = new Set(analysis.badMoves.flatMap((mv) => mv.tags));
  if (tags.size > 0) {
    parts.push(`### 本局知识点`);
    for (const kp of knowledgeOf([...tags]).slice(0, 4)) {
      parts.push(`- 【${kp.name}】${kp.brief}`);
    }
  }
  parts.push(`> 配置 .env 中的 LLM_API_KEY 后，可生成更详细的教练语音讲解版报告。`);
  return parts.join('\n\n');
}
