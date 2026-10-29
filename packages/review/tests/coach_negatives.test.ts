/**
 * REVIEW5 T2 验收：讲解校验器六负例（独立审计实测原校验器全部 errors=[]）。
 * 负例清单（源自 REVIEW5 独立核查证据 audit_coaching_probe）：
 *  N1 引用真实 claim（小王压得过♥A）但正文写"小王压不过"；
 *  N2 不提供 claimIds，正文断言"用炸弹接管,随后连续出牌就能获胜"；
 *  N3 虚构"此时我方剩余999张牌"；
 *  N4 summary 写"你打错了,手里有999张♠A,因此必输,失误率99%"；
 *  N5 actionIds/factIds/claimIds 全部空数组，仍写错误大小关系；
 *  N6 disagreement 卡降档 model_preference 且正文要求只采模型、排除启发式。
 * 正例：如实引用 claim 的方向 + 卡内事实 → 通过（防止为拦错完全失去可用教学）。
 * 修改前失败点：本文件 N1-N6 全部 errors 为空（原校验器接受）。
 */
import { describe, expect, it } from 'vitest';
import { validateCoachJson } from '../src/coachJson';
import type { Claim, DecisionReview } from '../src/decisionReview';

function mkEvidence(over: Partial<DecisionReview> = {}): DecisionReview {
  const claims: Claim[] = over.claims ?? [
    {
      claimId: 'c1', kind: 'rule_relation', decisionId: 'rec1#m2', factIds: ['f2-rule'],
      scope: 'provable_fact', text: '小王压得过♥A',
    },
  ];
  return {
    decisionId: 'rec1#m2', moveNo: 2, seat: 1, replayStatus: 'exact',
    ruleContext: { levelMode: 'stage', stageTeam: 0, version: 'v1' },
    actual: { actionId: 'a0', coverage: { status: 'exact', index: 0 }, wildAs: [], declaration: null },
    actionTexts: { a0: '小王', a1: '♥A', a2: '♦炸弹×4' },
    facts: { 'f2-ctx': '当时可见：桌面♥A，你手里有小王和♦炸弹', 'f2-rule': '规则事实见断言' },
    singleStep: { actual: { remainingCards: 5, wildsSpent: 0, factIds: ['f2-ctx'] },
      alternatives: [{ label: 'pass', actionId: 'a1', text: '不要', remainingCards: 5, wildsSpent: 0, factIds: [] }] },
    candidates: null, policy: null, heuristic: { note: null },
    claims, claimLevel: over.claimLevel ?? 'provable_fact',
    expressionScope: '只可陈述程序验证的结构/张数事实',
    conflicts: [], missing: [],
    rollouts: [],
    ...over,
  } as unknown as DecisionReview;
}

const okLesson = {
  decisionId: 'rec1#m2', actionIds: ['a0'], factIds: ['f2-rule'], claimIds: ['c1'],
  claimLevel: 'provable_fact', title: '小王能接', text: '按断言，小王压得过♥A，这是程序验证的规则事实。',
};

describe('REVIEW5 T2 讲解校验器六负例', () => {
  const ev = mkEvidence();

  it('N1 引用真 claim 但正文写反方向 → 拒绝（旧实现 errors=[]）', () => {
    const out = validateCoachJson({
      summary: '本局讲解。', lessons: [{
        ...okLesson, claimLevel: 'provable_fact',
        text: '虽然断言在卡上，但小王压不过当前这手牌，还是别接了。',
      }],
    }, [ev]);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((e) => e.detail.includes('反方向') || e.kind === 'claim_level_mismatch')).toBe(true);
  });

  it('N2 无 claimIds 仍断言接管必胜 → 拒绝', () => {
    const out = validateCoachJson({
      summary: '本局讲解。', lessons: [{
        decisionId: 'rec1#m2', actionIds: [], factIds: [], claimIds: [],
        claimLevel: 'provable_fact', title: '接管', text: '用炸弹接管，随后连续出牌就能获胜。',
      }],
    }, [ev]);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((e) => e.detail.includes('全空') || e.detail.includes('断言必须引用'))).toBe(true);
  });

  it('N3 虚构张数 999 张 → 拒绝', () => {
    const out = validateCoachJson({
      summary: '本局讲解。', lessons: [{ ...okLesson, text: '此时我方剩余999张牌，形势很特别。' }],
    }, [ev]);
    expect(out.some((e) => e.detail.includes('999张') || e.detail.includes('证据卡之外的张数'))).toBe(true);
  });

  it('N4 summary 判罚语+事实外牌张+张数 → 拒绝（旧实现只查非空）', () => {
    const out = validateCoachJson({
      summary: '你打错了，手里有999张♠A，因此必输，失误率99%。',
      lessons: [okLesson],
    }, [ev]);
    expect(out.some((e) => e.kind === 'forbidden_judgement' && e.detail.includes('summary'))).toBe(true);
    expect(out.some((e) => e.detail.includes('♠A') || e.detail.includes('张数') || e.detail.includes('99%'))).toBe(true);
  });

  it('N5 全空引用数组仍写大小关系 → 拒绝', () => {
    const out = validateCoachJson({
      summary: '本局讲解。', lessons: [{
        decisionId: 'rec1#m2', actionIds: [], factIds: [], claimIds: [],
        claimLevel: 'provable_fact', title: '大小', text: '♠K压不过小王，这是规则。',
      }],
    }, [ev]);
    expect(out.some((e) => e.detail.includes('全空'))).toBe(true);
    // ♠K 也是卡外牌张
    expect(out.some((e) => e.detail.includes('♠K'))).toBe(true);
  });

  it('N6 disagreement 降档 model_preference + 单边排斥 → 拒绝', () => {
    const evDis = mkEvidence({ claimLevel: 'disagreement' });
    const out = validateCoachJson({
      summary: '本局讲解。', lessons: [{
        ...okLesson, claimLevel: 'model_preference',
        text: '这一手只采模型的意见就好，排除启发式的偏好，直接按模型来打。',
      }],
    }, [evDis]);
    expect(out.some((e) => e.detail.includes('降档'))).toBe(true);
    expect(out.some((e) => e.detail.includes('单边排斥'))).toBe(true);
  });

  it('正例：如实复述断言方向与卡内事实 → 通过', () => {
    const out = validateCoachJson({
      summary: '这局有一个规则点值得记住。', lessons: [okLesson],
    }, [ev]);
    expect(out).toEqual([]);
  });

  it('正例2：不写方向不写数字的保守讲解 → 通过', () => {
    const out = validateCoachJson({
      summary: '这局整体节奏平稳。', lessons: [{
        ...okLesson, text: '这一手的取舍在证据卡里有两边说明，可以对照断言自行判断。',
      }],
    }, [ev]);
    expect(out).toEqual([]);
  });
});
