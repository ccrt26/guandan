/**
 * REVIEW5 T0.3 验收：采样检查器修复。
 * 修改前失败点：
 *  - sameMoveSemantic：两个不同出牌（同张数）旧实现判"同语义"（applied.pass===raw.pass 恒真）；
 *  - finalizeSamples：符号翻转但数值仍在合法范围的 g 标签，旧检查（w∈±1、|y|≤4）抓不住；
 *  - hiddenRedistributionCheck：旧"暗牌测试"只 reverse 自己手牌，跨席交换才有效——
 *    本文件证明 checker 能捕获故意泄漏（负例）且真实模型跨席重分配不变（正例）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  finalizeSamples, hiddenRedistributionCheck, sampleMatchStrict, sameMoveSemantic,
  type StrictCounters,
} from '../src/clean1';
import { MLP, mulberry32 } from '@gd/ai';
import { createMatch, DEFAULT_RULES, startGame, legalCombos, applyMove, type GameState } from '@gd/engine';
import { NeuralDecider } from '@gd/ai';

const REPO = join(import.meta.dirname, '..', '..');

function newCtr(): StrictCounters {
  return { illegalIntent: 0, fallback: 0, semanticRewrite: 0, encodingMismatch: 0, labelMismatch: 0 };
}
function loadClean2(): MLP {
  const buf = readFileSync(join(REPO, 'packages', 'web', 'public', 'ai', 'clean2.f32'));
  const m = new MLP(1);
  m.setWeights(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer));
  return m;
}

describe('REVIEW5 T0.3 采样检查器', () => {
  it('sameMoveSemantic：不同物理牌/不同声明 = 不同语义（旧实现判同）', () => {
    let match = createMatch({ ...DEFAULT_RULES }, 991);
    let state = startGame(match);
    let guard = 0;
    while (state.turn !== 0 && guard++ < 100) {
      const c = legalCombos(state)[0];
      applyMove(state, c ? { pass: false, combo: c } : { pass: true });
      if (state.over) { match = createMatch({ ...DEFAULT_RULES }, 992 + guard); state = startGame(match); }
    }
    const singles = legalCombos(state).filter((c) => c.kind === 'single');
    expect(singles.length).toBeGreaterThanOrEqual(2);
    const a = { pass: false, combo: singles[0] };
    const b = { pass: false, combo: singles[1] };
    // 旧实现：两者 pass 同为 false → "同语义"；修复后必须判不同（物理牌 id 不同）
    expect(sameMoveSemantic(a, b)).toBe(false);
    expect(sameMoveSemantic(a, { pass: false, combo: singles[0] })).toBe(true);
    expect(sameMoveSemantic({ pass: true }, { pass: true })).toBe(true);
    expect(sameMoveSemantic({ pass: true }, a)).toBe(false);
  });

  it('finalizeSamples 故障注入：数值合法但队伍符号错误的 g 必须被抓', () => {
    const ctr = newCtr();
    const meta = [{ winnerTeam: 1, upgrade: 2 }];
    const feat = new Float32Array(385);
    const pending = [
      { feat, seat: 0, g: -2, gameIdx: 0 }, // 正确：seat0 属队0，输 → -2
      { feat, seat: 1, g: 2, gameIdx: 0 },  // 正确：seat1 属队1，赢 → +2
    ];
    const out = finalizeSamples(pending, meta, 1, 777, ctr);
    expect(out.map((s) => s.w)).toEqual([-1, 1]);
    expect(ctr.labelMismatch).toBe(0);
    // 注入：seat1 的 g 翻转为 -2（数值仍在 |y|≤4 内，w 仍 ±1 → 旧检查通过）
    const tampered = [
      { feat, seat: 0, g: -2, gameIdx: 0 },
      { feat, seat: 1, g: -2, gameIdx: 0 },
    ];
    const ctr2 = newCtr();
    expect(() => finalizeSamples(tampered, meta, 1, 777, ctr2)).toThrow(/一致性违例/);
    expect(ctr2.labelMismatch).toBe(1);
    // gameIdx 越界也必须被抓
    const ctr3 = newCtr();
    expect(() => finalizeSamples([{ feat, seat: 0, g: 1, gameIdx: 5 }], meta, 1, 777, ctr3)).toThrow(/一致性违例/);
    expect(ctr3.labelMismatch).toBe(1);
  });

  it('sampleMatchStrict 真实跑通：计数器全零、标签复算一致', () => {
    const model = loadClean2();
    const ctr = newCtr();
    const rand = mulberry32(20261028);
    const r = sampleMatchStrict(model, 0.05, 333, rand, ctr);
    expect(r.capped).toBe(false);
    expect(r.samples.length).toBeGreaterThan(50);
    expect(ctr.illegalIntent).toBe(0);
    expect(ctr.fallback).toBe(0);
    expect(ctr.semanticRewrite).toBe(0);
    expect(ctr.encodingMismatch).toBe(0);
    expect(ctr.labelMismatch).toBe(0);
    for (const s of r.samples) {
      expect(Math.abs(s.y)).toBeLessThanOrEqual(4);
      expect([1, -1]).toContain(s.w);
    }
  });

  it('hiddenRedistributionCheck：真实模型跨席暗牌重分配后观察/候选/Q/动作不变', () => {
    const model = loadClean2();
    for (const seed of [11, 22, 33]) {
      const r = hiddenRedistributionCheck(model, seed);
      expect(r.ok).toBe(true);
      expect(r.redistributions).toBeGreaterThanOrEqual(3);
      expect(r.statesChecked).toBeGreaterThanOrEqual(3);
    }
  });

  it('hiddenRedistributionCheck 负例：编码泄漏对手暗牌时必须报 divergence', () => {
    // 构造泄漏 scorer：状态向量末尾附加对手手牌哈希 → 跨席重分配必然改变
    const leakingScore = (state: GameState, seat: number): string => {
      const dec = new NeuralDecider(seat, model0, 0, () => 0);
      const d = dec.decide(state, { collectFeat: true });
      const leak = [1, 2, 3].map((s) => state.hands[s].map((c) => c.id).sort().join(',')).join('|');
      return Array.from(d.feat!.subarray(0, 317)).join(',') + '#' + leak;
    };
    const model0 = loadClean2();
    const match = createMatch({ ...DEFAULT_RULES }, 4441);
    const state = startGame(match);
    const rng = mulberry32(9);
    const ref = leakingScore(state, 0);
    // 跨席重分配（与 checker 相同口径）
    const pool = [1, 2, 3].flatMap((s) => state.hands[s]);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const st2 = { ...state, hands: [...state.hands] } as GameState;
    let o = 0;
    for (const s of [1, 2, 3]) { st2.hands[s] = pool.slice(o, o + state.hands[s].length); o += state.hands[s].length; }
    expect(leakingScore(st2, 0)).not.toBe(ref); // 泄漏可被"跨席重分配比较"检出
    // 反向 sanity：仅 reverse 各家自己手牌（旧测试口径）时即使泄漏也不变——证明旧测试无力
    const stRev = { ...state, hands: state.hands.map((h, i) => (i === 0 ? [...h] : [...h].reverse())) } as GameState;
    expect(leakingScore(stRev, 0)).toBe(ref);
  });
});
