import { describe, expect, it } from 'vitest';
import { MatchController } from '../src/game/controller';
import { DEFAULT_RULES } from '@gd/engine';
import { NEURAL_MODEL_VERSION } from '@gd/ai';
import type { GameRecord } from '@gd/engine';

/** C-4/C-5（CLEAN1-REVIEW-1.0）：神经权重加载失败必须（1）在 UI 层可见（横幅字段），
 *  （2）在牌谱 aiPolicies 里如实记录回退——复盘不得把回退对局标成全程神经模型。 */
describe('神经陪练加载失败的如实标注', () => {
  it('App 层加载失败（neuralLoadError）：横幅字段 + 三席 heuristic:L?(fallback)', () => {
    const c = new MatchController({
      difficulty: 1, rules: { ...DEFAULT_RULES }, autopilot: true,
      neuralLoadError: '权重加载失败：Error: 测试注入',
    });
    c.startGame();
    expect(c.lastNeuralFallbackReason).toContain('权重加载失败');
    expect(c.neuralFallbacks).toBe(1);
    expect(c.currentPolicies).toEqual(['autopilot:L1', 'heuristic:L1(fallback)', 'heuristic:L1(fallback)', 'heuristic:L1(fallback)']);
  });

  it('席位级构造失败（坏权重）：同样落入横幅与 (fallback) 策略', () => {
    const bad = new ArrayBuffer(8); // 长度异常 → createNeuralAI 抛错
    const c = new MatchController({ difficulty: 2, rules: { ...DEFAULT_RULES }, autopilot: true, neuralOpponents: bad });
    c.startGame();
    expect(c.neuralFallbacks).toBeGreaterThanOrEqual(1);
    expect(c.lastNeuralFallbackReason).toBeTruthy();
    expect(c.currentPolicies[1]).toBe('heuristic:L2(fallback)');
  });

  it('正常神经对局：aiPolicies 记录 neural 版本；无回退字段', () => {
    // 32 字节头 + 164865 float32 的合法权重长度（值任意——只测记录链路不测棋力）
    const w = new Float32Array(164865);
    const c = new MatchController({ difficulty: 1, rules: { ...DEFAULT_RULES }, autopilot: true, neuralOpponents: w.buffer });
    c.startGame();
    expect(c.lastNeuralFallbackReason).toBeNull();
    expect(c.currentPolicies).toEqual([
      'autopilot:L1',
      // D1 三档：难度作用于两个对手席（1/3 带 tier 标记）；队友席（2）固定满血贪心
      `neural-tier:hard:${NEURAL_MODEL_VERSION}`,
      `neural:${NEURAL_MODEL_VERSION}`,
      `neural-tier:hard:${NEURAL_MODEL_VERSION}`,
    ]);
  });

  it('记录器把 aiPolicies 写入 GameRecord（复盘可区分回退对局）', async () => {
    const c = new MatchController({
      difficulty: 1, rules: { ...DEFAULT_RULES }, autopilot: true,
      neuralLoadError: '权重加载失败：Error: 测试注入',
    });
    c.startGame();
    // 走一整局：直接驱动到 gameEnd 由计时器完成较慢，这里校验记录元数据构造路径：
    // recorder 在 startGame 时即持有 aiPolicies（finish 展开同一 meta）
    const rec = (c as unknown as { record: GameRecord | null }).record;
    const policiesSnapshot = (c as unknown as { currentPolicies: string[] }).currentPolicies;
    // 未完局 record 为 null——用反射读 recorder meta 验证
    const recorder = (c as unknown as { recorder: { meta: Record<string, unknown> } | null }).recorder;
    expect(rec).toBeNull();
    expect(policiesSnapshot.every((p) => p.includes('fallback') || p.startsWith('autopilot') || p === 'human')).toBe(true);
    expect(recorder?.meta.aiPolicies).toEqual(policiesSnapshot);
  });
});
