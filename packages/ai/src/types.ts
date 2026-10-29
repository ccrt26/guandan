import type { Combo, EngineEvent, GameState, RuleOptions } from '@gd/engine';

export type Move = { pass: true } | { pass: false; combo: Combo };

/** 0=初级 1=中级 2=高级 */
export type Difficulty = 0 | 1 | 2;

/**
 * 三档强度 = 同一策略框架的能力开关矩阵。
 * 每一档新增 1-2 个能力维度，差距可解释、可教学：
 * - 初级：局部贪心（能压就最小压），不记牌、不配合、15% 失误
 * - 中级：+记牌器 +手牌全局规划 +规则式队友配合，5% 失误
 * - 高级：+行为推断 +关键决策蒙特卡洛模拟（rollout），近乎无误
 */
export interface AICapabilities {
  /** 记牌：统计已出牌、推算关键牌剩余 */
  memory: boolean;
  /** 行为推断：对手让牌 → 推断其缺少的牌型 */
  inference: boolean;
  /** 队友配合：让牌、跟队友发力、避免压队友 */
  cooperation: boolean;
  /** 手牌全局拆解规划（否则局部贪心） */
  planning: boolean;
  /** 随机失误率 0..1 */
  noise: number;
  /** 关键决策 rollout 模拟次数（0=关闭） */
  rolloutIters: number;
}

/**
 * 三档难度 = 同一决策核心 + 能力开关矩阵 + 温度采样。
 * 分级依据（调研结论，2026-10）：
 * - 民间高手体系公认三段位「会打 / 能赢 / 近道」（知乎职业教程体系），
 *   与平台等级制（十级→一级→大师）对应，映射为本矩阵三档。
 * - 难度设计采用 Stockfish/Maia/Suphx 的科学模式：同一强核心，
 *   靠「信息特征遮蔽 + 算力/知识开关 + 随机性」拉档，而非非理性行为。
 * - 失误必须"像人"：降档只降记牌/算牌/配合维度，不降牌理底线（不炸队友等）。
 *
 * 公平性红线（三档通用，有回归测试锁死 tests/fairness.test.ts）：
 * 决策只使用自己手牌 + 公开信息（已出牌、各家张数、让牌历史）；
 * 不读对手手牌、不参与发牌；暗牌采样（PIMC）仅在模拟中使用公共信息可见的牌。
 */
export const LEVEL_CAPS: Record<Difficulty, AICapabilities> = {
  // 初级 =「会打」（平台十级~六级）：懂规则、基础组牌、能压就压、有炸爱炸；
  // 不记牌、不定位、不配合。30% 概率在前三选项随手（温度采样模拟不上心）。
  0: { memory: false, inference: false, cooperation: false, planning: false, noise: 0.3, rolloutIters: 0 },
  // 中级 =「能赢」（平台五级~二级）：记关键牌（王/级牌/炸弹余量）、手牌全局规划、
  // 基础配合（让牌/顶牌/送牌/接力）、首攻口诀、报牌封锁、枪不打四。5% 轻微抖动。
  1: { memory: true, inference: false, cooperation: true, planning: true, noise: 0.05, rolloutIters: 0 },
  // 高级 =「近道」（平台一级/大师）：中级全部 + 读牌（从让牌行为推断手牌）、
  // 算无敌牌、残局决策树（对手剩4/5张提前封锁）、近乎零随手。
  // rollout 设施保留（player.ts/sim.ts）；大样本实测无可测量收益，默认关闭。
  // 更强档位（DanZero 式 DMC 自博弈，对规则 AI 90%+）为长期路线，需训练资源。
  2: { memory: true, inference: true, cooperation: true, planning: true, noise: 0.01, rolloutIters: 0 },
};

export const DIFFICULTY_NAME: Record<Difficulty, string> = {
  0: '初级',
  1: '中级',
  2: '高级',
};

export interface AIPlayer {
  readonly seat: number;
  readonly difficulty: Difficulty;
  /** 感知对局事件（维护记牌器）；toBeat 为该步之前需要压制的牌（推断用） */
  observe(events: EngineEvent[], toBeat: Combo | null): void;
  /** 决策：只允许使用自己手牌 + 公共信息（记牌器） */
  decide(state: GameState): Move;
  /** 一局开始重置 */
  reset(state: GameState, rules: RuleOptions): void;
}
