import { describe, expect, it } from 'vitest';
import {
  applyMove, createMatch, DEFAULT_RULES, RNG, Recorder, startGame, type GameRecord,
} from '@gd/engine';
import { createAI, guardMove, MLP } from '@gd/ai';
import { analyzeGame } from '../src/analyzer';
import { classifyReplay } from '../src/replayStatus';
import { buildDecisionReviews } from '../src/decisionReview';
import { buildCoachJsonMessages, parseCoachJson, validateCoachJson, COACH_JSON_PROMPT_VERSION } from '../src/coachJson';
import { runInfosetCompare, defaultRoots } from '../src/infoset';

// ---------- 真实对局生成（学生=初级 vs 对手中级，与 lab CLI 同构） ----------
function generateRecord(seed: number, student: 0 | 1 | 2 = 0, opp: 0 | 1 | 2 = 1): GameRecord {
  const rng = new RNG(seed);
  const match = createMatch({ ...DEFAULT_RULES }, rng.next() * 0xffffffff);
  const state = startGame(match);
  const diffs = [student, opp, opp, opp];
  const rec = new Recorder({
    schemaVersion: 2, id: `t-${seed}`, matchId: `tm-${seed}`, createdAt: seed,
    ruleOpts: match.opts, levelsBefore: state.levelsBefore, stageTeam: state.stageTeam,
    leader: state.leader, humanSeat: 0, difficulties: diffs,
    aiPolicies: [0, 1, 2, 3].map((s) => `autopilot:L${diffs[s]}`),
    initialHands: state.hands.map((h) => [...h]),
  });
  const ais = [0, 1, 2, 3].map((s) => {
    const a = createAI(s, diffs[s] as 0 | 1 | 2, rng.next() * 0xffffffff);
    a.reset(state, match.opts);
    return a;
  });
  let guard = 0;
  while (!state.over && guard++ < 2000) {
    const turn = state.turn;
    const toBeat = state.lastCombo;
    const mv = guardMove(state, ais[turn].decide(state) as never);
    const events = applyMove(state, mv as never);
    rec.record(turn, mv, state.hands, toBeat);
    ais.forEach((a) => a.observe(events, toBeat));
  }
  return rec.finish(state.result!);
}

const REC_SEED = 81003; // 探针验证过：exact 回放、含分歧手
const mlp = new MLP(20261025);

describe('R3 统一证据对象（DecisionReview）', () => {
  const record = generateRecord(REC_SEED);
  const analysis = analyzeGame(record);
  const replayClass = classifyReplay(record);

  it('生成记录过完整性/回放分级（前置条件）', () => {
    expect(replayClass.status).toBe('exact');
    expect(analysis.stats.divergent).toBeGreaterThan(0);
  });

  it('证据对象字段完备且稳定', () => {
    const evs = buildDecisionReviews(record, {
      mlp, modelVersion: 'test-mlp', weightHash: 'w-hash', analysis, replayClass,
    });
    expect(evs.length).toBeGreaterThanOrEqual(1);
    for (const e of evs) {
      expect(e.decisionId).toBe(`${e.recordId}#m${e.moveNo}`);
      expect(e.actual.actionId.length).toBeGreaterThan(0);
      expect(e.candidates).not.toBeNull();
      expect(e.candidates!.n).toBeGreaterThan(0);
      expect(e.candidates!.ranking[0].score).toBeGreaterThanOrEqual(e.candidates!.ranking[e.candidates!.ranking.length - 1].score);
      expect(e.heuristic.note).toBeTruthy();
      expect(e.singleStep.actual.remainingCards).toBeGreaterThanOrEqual(0);
      expect(e.expressionScope.length).toBeGreaterThan(4);
      // D1（REVIEW4）：有分解的动作绑定 breakdown（Σ=score 核验），不再全局登记缺失；
      // 无分解才逐动作登记（此处启发式 explain 可用 → 应有 breakdown 且无全局缺失句）
      expect(e.heuristicBreakdowns.length).toBeGreaterThanOrEqual(1);
      for (const hb of e.heuristicBreakdowns) expect(hb.sumEqualsScore).toBe(true);
      expect(e.missing.some((m) => m.includes('逐项分解') && !m.includes('actionId='))).toBe(false);
      // D3：claims 至少含规则关系或资源变化断言（跟牌局）
      expect(e.claims.length).toBeGreaterThanOrEqual(1);
      for (const f of Object.values(e.facts)) expect(f.length).toBeGreaterThan(0);
    }
    // 确定性：同一输入两次构建逐字一致
    const evs2 = buildDecisionReviews(record, {
      mlp, modelVersion: 'test-mlp', weightHash: 'w-hash', analysis, replayClass,
    });
    expect(JSON.stringify(evs2)).toBe(JSON.stringify(evs));
  });

  it('回放降级时模型层禁用（F07 门控）', () => {
    const evs = buildDecisionReviews(record, {
      mlp, analysis, replayClass: { ...replayClass, status: 'ambiguous', reason: '测试注入' },
    });
    for (const e of evs) {
      expect(e.candidates).toBeNull();
      expect(e.claimLevel).toBe('provable_fact');
      expect(e.missing.some((m) => m.includes('模型层禁用'))).toBe(true);
    }
  });
});

describe('R3 结构化教练校验（coachJson）', () => {
  const record = generateRecord(REC_SEED);
  const evs = buildDecisionReviews(record, { mlp, modelVersion: 'test-mlp', weightHash: 'w' });
  it('先建证据再谈输出（前置条件）', () => expect(evs.length).toBeGreaterThanOrEqual(1));

  it('合法输出通过校验', () => {
    const e = evs[0];
    const good = {
      summary: '本局整体节奏尚可。',
      lessons: [{
        decisionId: e.decisionId,
        actionIds: [e.actual.actionId],
        factIds: Object.keys(e.facts).slice(0, 1),
        claimLevel: e.claimLevel,
        title: '取舍看结构',
        text: '两种打法各保留不同结构，证据卡已列出。',
      }],
    };
    expect(validateCoachJson(good, evs)).toEqual([]);
  });

  it('不存在 ID / 跨手引用 / claim 越界 / 事实外牌张 均被拦', () => {
    const e = evs[0];
    const base = {
      summary: 's',
      lessons: [{
        decisionId: e.decisionId, actionIds: [e.actual.actionId], factIds: [],
        claimLevel: e.claimLevel, title: 't', text: 'x',
      }],
    };
    expect(validateCoachJson({ ...base, lessons: [{ ...base.lessons[0], decisionId: 'ghost#m1' }] }, evs)[0].kind).toBe('unknown_decision');
    expect(validateCoachJson({ ...base, lessons: [{ ...base.lessons[0], actionIds: ['ghost#x'] }] }, evs)[0].kind).toBe('unknown_action');
    expect(validateCoachJson({ ...base, lessons: [{ ...base.lessons[0], claimLevel: 'conditional_support' as never }] }, evs).some((x) => x.kind === 'claim_level_mismatch')).toBe(true);
    // v3 候选按花色展开后，手写"证据卡外"牌可能恰好进入候选/事实——动态挑一张确实不在任何证据文本中的牌
    const usedText = JSON.stringify(e) + JSON.stringify(evs);
    const glyph = ['♠', '♥', '♦', '♣'].find((g) => !usedText.includes(`${g}Q`)) ?? '🃏';
    expect(validateCoachJson({ ...base, lessons: [{ ...base.lessons[0], text: `${glyph}Q 那张牌很关键（证据卡外）` }] }, evs)[0].kind).toBe('card_out_of_fact');
    if (evs.length > 1) {
      const otherFact = Object.keys(evs[1].facts)[0];
      expect(validateCoachJson({ ...base, lessons: [{ ...base.lessons[0], factIds: [otherFact] }] }, evs)[0].kind).toBe('unknown_fact');
    }
  });

  it('provable_fact 档禁止判罚语；parseCoachJson 容忍围栏', () => {
    // 用降级证据保证 claimLevel=provable_fact（候选集变化不影响本测试的语义）
    const degraded = buildDecisionReviews(record, {
      mlp, analysis: analyzeGame(record),
      replayClass: { ...classifyReplay(record), status: 'ambiguous', reason: '测试注入' },
    });
    expect(degraded.length).toBeGreaterThanOrEqual(1);
    const e = degraded[0];
    const bad = {
      summary: 's',
      lessons: [{
        decisionId: e.decisionId, actionIds: [], factIds: [],
        claimLevel: e.claimLevel, title: 't', text: '这手你打错了',
      }],
    };
    expect(validateCoachJson(bad, degraded).some((x) => x.kind === 'forbidden_judgement')).toBe(true);
    const parsed = parseCoachJson('```json\n{"summary":"a","lessons":[]}\n```');
    expect(parsed?.summary).toBe('a');
    expect(parseCoachJson('不是 JSON')).toBeNull();
  });

  it('双来源续打方向相反 → conflicts 标注且并列（自办项 6/P9）', () => {
    const e0 = buildDecisionReviews(record, { mlp, modelVersion: 't', weightHash: 'w' })[0];
    const withBoth = buildDecisionReviews(record, {
      mlp, modelVersion: 't', weightHash: 'w',
      rollouts: new Map([[e0.moveNo, [
        { mode: 'single_deterministic', rootSourceId: 'heuristic:mid', continuationPolicyId: 'heuristic:mid/noise=0', samples: 1, seedsDigest: 'x', actualOutcomeText: 'a', alternativeOutcomeText: 'b', metricActual: 1, metricAlternative: -1, truncated: false },
        { mode: 'infoset_sampled', rootSourceId: 'heuristic:mid', continuationPolicyId: 'heuristic:mid/noise=0', samples: 64, seedsDigest: 'y', actualOutcomeText: 'a', alternativeOutcomeText: 'b', metricActual: -0.5, metricAlternative: 0.5, truncated: false },
      ]]]),
    })[0];
    expect(withBoth.rollouts.length).toBe(2);
    expect(withBoth.conflicts.some((c) => c.includes('方向相反'))).toBe(true);
    expect(withBoth.rollouts[0].mode).toBe('single_deterministic');
    expect(withBoth.rollouts[1].mode).toBe('infoset_sampled');
  });

  it('prompt 版本常量存在（缓存键组成）', () => {
    expect(COACH_JSON_PROMPT_VERSION).toBe('coach-json-v3-viewer-entailed');
    expect(buildCoachJsonMessages(evs, ['全局事实X']).length).toBe(2);
  });
});

describe('R4 信息集比较（infoset v2 / REVIEW4-D4）', () => {
  const record = generateRecord(REC_SEED);
  const analysis = analyzeGame(record);
  const divergent = [...analysis.divergentMoves].sort((a, b) => b.scoreGap - a.scoreGap)[0];
  const mv = analysis.moves.find((m) => m.moveNo === divergent.moveNo)!;
  // D4：续打政策注入（测试用启发式中级；每世界每分支新建四席玩家=状态隔离）
  const mkContinuation = (seedBase: number) => ({
    policyId: 'heuristic:mid(test)',
    makePlayers: () => [0, 1, 2, 3].map((s) => {
      const a = createAI(s, 1, seedBase + s);
      let started = false;
      return {
        decide: (state: any) => {
          if (!started) { a.reset(state, record.ruleOpts); started = true; }
          return a.decide(state) as { pass: boolean; combo?: any };
        },
        observe: (events: any, toBeat: any) => a.observe(events, toBeat),
      };
    }),
  });
  const continuation = mkContinuation(9100);

  it('守恒与配对：世界数/根动作/种子确定性/方向与CI门（d=alt−actual）', () => {
    const roots = defaultRoots(record, mv.moveNo, {
      actionId: 'actual#t', combo: mv.pass ? null : mv.playedCombo,
    });
    expect(roots.length).toBeGreaterThanOrEqual(1);
    expect(roots[0].label).toBe('actual');
    const r1 = runInfosetCompare(record, mv.moveNo, roots, { samples: 8, continuation });
    expect(r1.samples).toBe(8);
    expect(r1.worldsCompleted).toBe(8);
    expect(r1.rejected).toBe(0);
    expect(r1.roots.length).toBe(roots.length);
    expect(r1.paired.length).toBe(roots.length - 1);
    for (const root of r1.roots) {
      expect(Math.abs(root.gMean)).toBeLessThanOrEqual(3);
    }
    // 方向统一与门：d=alt−actual；support ∈ 四档；零方差→degenerate
    for (const p of r1.paired) {
      expect(['support_alt', 'support_actual', 'no_direction', 'degenerate']).toContain(p.support);
      expect(p.gateThreshold).toBe(0.25);
      if (p.support === 'support_alt') expect(p.ciLow).toBeGreaterThan(0.25);
      if (p.support === 'support_actual') expect(p.ciHigh).toBeLessThan(-0.25);
    }
    // 信息集哈希种子：只依赖当时可见信息
    expect(r1.informationSetHash.length).toBe(16);
    expect(r1.samplerVersion).toBe('infoset-v2-review4');
    const r2 = runInfosetCompare(record, mv.moveNo, roots, { samples: 8, continuation });
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1)); // 同信息集哈希逐位复现
    expect(r1.assumptionNote).toContain('均匀可行分配');
    // 每世界留档（worldSeed/d/g），失败世界不补抽
    for (const w of r1.worlds) {
      expect(w.worldSeed).toBeGreaterThan(0);
      expect(w.gAlternatives.length).toBe(roots.length - 1);
    }
  });

  it('信息集哈希对暗牌/未来事件不变：改初始暗牌与未来动作不改变哈希与根建议', () => {
    const roots = defaultRoots(record, mv.moveNo, {
      actionId: 'actual#t', combo: mv.pass ? null : mv.playedCombo,
    });
    const base = runInfosetCompare(record, mv.moveNo, roots, { samples: 2, continuation });
    // 换暗牌：对手手牌同张数重排（内容变化、可见信息不变）
    const rec2 = JSON.parse(JSON.stringify(record));
    for (let s = 0; s < 4; s++) {
      if (s !== (record.humanSeat ?? 0)) rec2.initialHands[s] = [...rec2.initialHands[s]].reverse();
    }
    const alt = runInfosetCompare(rec2, mv.moveNo, roots, { samples: 2, continuation });
    expect(alt.informationSetHash).toBe(base.informationSetHash); // 种子选择不变
    expect(alt.worlds.map((w) => w.worldSeed)).toEqual(base.worlds.map((w) => w.worldSeed));
    // 模拟结果可以不同（世界内容不同），但根建议/根动作集合不变
    expect(alt.roots.map((r) => r.actionId)).toEqual(base.roots.map((r) => r.actionId));
  });
});
