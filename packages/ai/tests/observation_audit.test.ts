import { describe, expect, it } from 'vitest';
import { runObservationAudit } from '../src/nn/observationAudit';

describe('T0 observation-audit（REVIEW3-EXEC §4）', () => {
  const audit = runObservationAudit();

  it('块表覆盖 317+68 维（位置连续无空洞）', () => {
    expect(audit.stateDim).toBe(317);
    expect(audit.actionDim).toBe(68);
    const stateBlocks = audit.blocks.filter((b) => !b.block.startsWith('action.'));
    const total = stateBlocks.reduce((s, b) => s + b.dim, 0);
    expect(total).toBe(audit.stateDim);
    const actionBlocks = audit.blocks.filter((b) => b.block.startsWith('action.'));
    expect(actionBlocks.reduce((s, b) => s + b.dim, 0)).toBe(audit.actionDim);
  });

  it('暗牌不变性：交换对手暗牌，状态向量逐位一致', () => {
    const c = audit.checks.find((x) => x.name === 'hiddenInfoInvariance');
    expect(c?.pass).toBe(true);
  });

  it('公开历史敏感性：历史变化必须反映进向量', () => {
    const c = audit.checks.find((x) => x.name === 'publicHistorySensitivity');
    expect(c?.pass).toBe(true);
  });

  it('pass 位契约（REVIEW5 T0.2）：action64 写动作块 64，legacy 保留历史位', () => {
    const c = audit.checks.find((x) => x.name === 'passBitContract');
    expect(c?.pass).toBe(true);
    expect(c?.detail).toContain('64');
  });

  it('信息在场清单含 stage 级牌与进还贡的如实缺口标注', () => {
    const stage = audit.infoPresence.find((x) => x.info.includes('级牌点数'));
    expect(stage?.status).toContain('derivable');
    const tribute = audit.infoPresence.find((x) => x.info.includes('进贡'));
    expect(tribute?.status).toContain('absent');
  });
});
