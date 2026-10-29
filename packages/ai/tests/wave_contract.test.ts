import { describe, expect, it } from 'vitest';
import { deriveSeed, deriveStepSeed, waveTasks, mergeOrder, waveUpdateCount, agesOf, sliceBlocks } from '../src/nn/wave';

describe('并行采样契约（REVIEW3-EXEC §5）', () => {
  it('种子派生：同输入同输出；matchId/purpose 变化必变', () => {
    const a = deriveSeed('main', 2026102806, 7, 'deal');
    expect(a).toBe(deriveSeed('main', 2026102806, 7, 'deal'));
    expect(a).not.toBe(deriveSeed('main', 2026102806, 8, 'deal'));
    expect(a).not.toBe(deriveSeed('main', 2026102806, 7, 'explore'));
    expect(a).not.toBe(deriveSeed('probe', 2026102806, 7, 'deal'));
    expect(deriveStepSeed('main', 42, 3)).not.toBe(deriveStepSeed('main', 42, 4));
  });
  it('波任务与 workers 数无关；归并按 matchId 固定序', () => {
    expect(waveTasks(16, 8)).toEqual([16, 17, 18, 19, 20, 21, 22, 23]);
    const done = [{ matchId: 19 }, { matchId: 16 }, { matchId: 23 }];
    expect(mergeOrder(done).map((x) => x.matchId)).toEqual([16, 19, 23]);
  });
  it('波更新数 U_w=floor((尾部+本波)/2048)', () => {
    expect(waveUpdateCount(100, 5000, 2048)).toBe(2);
    expect(waveUpdateCount(2048, 2048, 2048)).toBe(2);
    expect(waveUpdateCount(0, 2047, 2048)).toBe(0);
  });
  it('版本年龄：跨块尾部的旧样本年龄更大', () => {
    const ages = agesOf([{ waveId: 1, count: 500 }, { waveId: 5, count: 1548 }], new Map([[1, 10], [5, 300]]), 300);
    expect(ages.p50).toBe(0);       // 大多数来自本波
    expect(ages.max).toBe(290);     // 尾部旧样本
  });
  it('块切分：2048 边界正确、跨块段拆分', () => {
    const blocks = sliceBlocks([
      { waveId: 1, count: 1500 }, { waveId: 2, count: 2596 },
    ], 2048);
    expect(blocks.length).toBe(2);
    expect(blocks[0].reduce((s, x) => s + x.count, 0)).toBe(2048);
    expect(blocks[1].reduce((s, x) => s + x.count, 0)).toBe(2048);
    expect(blocks[0]).toContainEqual({ waveId: 1, count: 1500 });
    expect(blocks[0]).toContainEqual({ waveId: 2, count: 548 });
    expect(blocks[1]).toEqual([{ waveId: 2, count: 2048 }]);
  });
});
