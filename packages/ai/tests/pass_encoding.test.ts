/**
 * REVIEW5 T0.2 验收（自足部分，无 node 依赖）：pass 编码修复 + 迁移数学。
 * 真实权重（clean2 385 / review4 399）× 真实候选批次的 Q 等价测试在
 * lab/tests/t02_pass_encoding_weights.test.ts（vitest include 已扩展）。
 * Python learner 前向等价探针：lab/review5/probe_pass_encoding.ts。
 */
import { describe, expect, it } from 'vitest';
import {
  ACTION_DIM, DEFAULT_PASS_ENCODING, encodeAction, INPUT_DIM, INPUT_DIM_V2,
  migratePassEncoding, PASS_ACTION_IDX, PASS_KIND_IDX, PHYS_DIM,
  STATE_DIM, STATE_DIM_V2, SCHEMA_VERSION_V3, SCHEMA_VERSION_V4,
} from '../src/nn/schema';
import { MLP } from '../src/nn/mlp';

describe('REVIEW5 T0.2 pass 编码修复', () => {
  it('action64：pass 写动作块 64，物理区全 0；legacy 默认保持历史位 10', () => {
    const v = new Float32Array(ACTION_DIM);
    encodeAction(null, v, 'action64');
    expect(v[PASS_ACTION_IDX]).toBe(1);
    expect(v[PASS_KIND_IDX]).toBe(0);
    for (let i = 0; i < PHYS_DIM; i++) expect(v[i]).toBe(0);
    const l = new Float32Array(ACTION_DIM);
    encodeAction(null, l);
    expect(l[PASS_KIND_IDX]).toBe(1);
    expect(DEFAULT_PASS_ENCODING).toBe('legacy-phys10');
  });

  it('迁移数学：只复制首层列 stateDim+10→stateDim+64，其余逐位不变（385/399 两布局）', () => {
    for (const [dim, sdim] of [[INPUT_DIM, STATE_DIM], [INPUT_DIM_V2, STATE_DIM_V2]] as const) {
      const m = new MLP(20261028, dim);
      const w = m.getWeights();
      const mig = migratePassEncoding(w, dim, sdim);
      expect(mig.length).toBe(w.length);
      let diffCols = 0;
      for (let h = 0; h < 256; h++) {
        const row = h * dim;
        expect(mig[row + sdim + PASS_ACTION_IDX]).toBe(w[row + sdim + PASS_KIND_IDX]);
        if (mig[row + sdim + PASS_ACTION_IDX] !== w[row + sdim + PASS_ACTION_IDX]) diffCols += 1;
      }
      expect(diffCols).toBe(256); // 旧列 64（训练中从未写过）与列 10 值不同的隐单元数
      // 其余全部一致
      let others = 0;
      for (let i = 0; i < w.length; i++) {
        const inCol10 = i % dim === sdim + PASS_KIND_IDX;
        const inCol64 = i % dim === sdim + PASS_ACTION_IDX;
        if (!inCol10 && !inCol64 && mig[i] !== w[i]) others += 1;
      }
      expect(others).toBe(0);
    }
  });

  it('未迁移权重 + action64：pass 输入 Q 改变（默认 legacy 防混搭有意义）', () => {
    const m = new MLP(7, INPUT_DIM);
    const w = m.getWeights();
    const mig = migratePassEncoding(w, INPUT_DIM, STATE_DIM);
    const mNew = new MLP(1, INPUT_DIM); mNew.setWeights(mig);
    // 构造仅 pass 不同的两个输入（其余全 0）
    const legacy = new Float32Array(INPUT_DIM);
    encodeAction(null, legacy.subarray(STATE_DIM), 'legacy-phys10');
    const fixed = new Float32Array(INPUT_DIM);
    encodeAction(null, fixed.subarray(STATE_DIM), 'action64');
    const qLegacy = m.forward(legacy, 1);
    const qFixed = m.forward(fixed, 1);
    const qMig = mNew.forward(fixed, 1);
    expect(qMig[0]).toBe(qLegacy[0]);      // 迁移后新编码恢复 Q
    expect(qFixed[0]).not.toBe(qLegacy[0]); // 未迁移权重读新编码 → Q 漂移
  });

  it('版本标识：v3/v4 描述符带 passEncoding=action64；v1/v2 保持 legacy', async () => {
    const { schemaDescriptor, schemaDescriptorV2, schemaDescriptorV3, schemaDescriptorV4 } = await import('../src/nn/schema');
    expect((schemaDescriptor() as { passEncoding: string }).passEncoding).toBe('legacy-phys10');
    expect((schemaDescriptorV2('rule-context') as { passEncoding: string }).passEncoding).toBe('legacy-phys10');
    expect((schemaDescriptorV3() as { passEncoding: string }).passEncoding).toBe('action64');
    expect((schemaDescriptorV4('rule-context') as { passEncoding: string }).passEncoding).toBe('action64');
    expect(SCHEMA_VERSION_V3).toBe('gd-lab-schema-v3');
    expect(SCHEMA_VERSION_V4).toBe('gd-lab-schema-v4');
  });
});
