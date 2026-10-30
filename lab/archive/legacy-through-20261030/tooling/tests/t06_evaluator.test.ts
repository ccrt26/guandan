/**
 * REVIEW5 T0.6 验收：评测器修复。
 * 修改前失败点：
 *  - 同副牌换边：旧实现 seed*2+side → 两边不同发牌；(A,B,s,0) 与 (B,A,s,1) 是同一配置
 *    （A 队0、B 队1、同副牌）→ 结果必须一致；旧实现因发牌不同而可能不一致；
 *  - cap 未完成：旧实现 match.winner==null 时 return match.winner===side = false（记为输）；
 *    修复后返回 incomplete=true，聚合时跳过并计数（cap=0 直接触发）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MLP } from '@gd/ai';
import { playNNvsNN, playNNwithH } from '../src/review2train';

const REPO = join(import.meta.dirname, '..', '..');

function loadMlp(p: string, dim = 385): MLP {
  const buf = readFileSync(p);
  const m = new MLP(1, dim);
  m.setWeights(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer));
  return m;
}

describe('REVIEW5 T0.6 评测器', () => {
  it('同副牌换边：同一 seed 的所有边/模型排列共享同一首局牌（指纹一致）', () => {
    const a = loadMlp(join(REPO, 'packages', 'web', 'public', 'ai', 'clean2.f32'));
    const b = loadMlp(join(REPO, 'packages', 'web', 'public', 'ai', 'clean1.f32'));
    for (const seed of [101, 202]) {
      const f00 = playNNvsNN(a, b, seed, 0).fingerprint;
      const f01 = playNNvsNN(a, b, seed, 1).fingerprint;
      const f10 = playNNvsNN(b, a, seed, 0).fingerprint;
      expect(f00).toBeTruthy();
      expect(f00).toBe(f01); // 同 seed 两边（换座）→ 同副牌（旧实现 seed*2+side 为不同发牌）
      expect(f00).toBe(f10); // 模型排列不影响发牌
      // 同配置同副牌 → 同一场比赛：games 一致、胜负互补
      const rA = playNNvsNN(a, b, seed, 0); // A 在队0
      const rB = playNNvsNN(b, a, seed, 1); // B 在队1（同一场比赛）
      expect(rB.games).toBe(rA.games);
      expect(rB.win).toBe(!rA.win);
    }
  });

  it('cap 未完成：incomplete=true 且不记胜负（旧实现记 false=输）', () => {
    const a = loadMlp(join(REPO, 'packages', 'web', 'public', 'ai', 'clean2.f32'));
    const b = loadMlp(join(REPO, 'packages', 'web', 'public', 'ai', 'clean1.f32'));
    const r = playNNvsNN(a, b, 7, 0, 0); // cap=0：第一局都未打
    expect(r.incomplete).toBe(true);
    expect(r.games).toBe(0);
    const rH = playNNwithH(a, b, 7, 1, 0);
    expect(rH.incomplete).toBe(true);
  });

  it('正常 cap=80：clean2 vs clean1 完整对局返回完整结果', () => {
    const a = loadMlp(join(REPO, 'packages', 'web', 'public', 'ai', 'clean2.f32'));
    const b = loadMlp(join(REPO, 'packages', 'web', 'public', 'ai', 'clean1.f32'));
    const r = playNNvsNN(a, b, 555, 0);
    expect(r.incomplete).toBe(false);
    expect(typeof r.win).toBe('boolean');
  });
});
