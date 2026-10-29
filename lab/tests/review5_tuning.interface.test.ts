/**
 * REVIEW5.1 补充 Task 1 interface 验收（lab/tests/review5_tuning.interface.test.ts）。
 * 修改前失败点：本入口不存在（旧 run.mjs 无调优 phase；不得把旧入口改名冒充）。
 * 覆盖：未知 split/flag/空阶段拒绝；缺必需证据退出 3/4；capabilities/--help 不改项目树；
 * bind 拒绝模板/覆盖不同身份/预算非法；重复执行 completed 只读回 reused。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..');
const RUN = join(REPO, 'lab', 'review5_tuning', 'run.mjs');
const node = (args: string[]): { code: number; out: string } => {
  const r = spawnSync('node', [RUN, ...args], { cwd: REPO, encoding: 'utf8', timeout: 30000 });
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
};

const tmp = mkdtempSync(join(tmpdir(), 'r5tune-'));

describe('REVIEW5.1 interface 薄入口', () => {
  it('capabilities --json / --help 只读且不建目录（合成临时环境验证参数层）', () => {
    const r1 = node(['capabilities', '--json']);
    expect(r1.code).toBe(0);
    const caps = JSON.parse(r1.out);
    expect(caps.cycleId).toBe('review5_1-20261028');
    expect(caps.commands).not.toContain('deploy');
    expect(caps.commands).not.toContain('confirm');
    const r2 = node(['capabilities']);
    expect(r2.code).toBe(0);
    expect(r2.out).toContain('bind');
  });

  it('未知命令/未知参数/重复参数/空 → 退出 2', () => {
    expect(node(['frobnicate']).code).toBe(2);
    expect(node([]).code).toBe(2);
    expect(node(['check', '--phase', 'review5-comfirm', '--config', 'x']).code).toBe(2); // 拼写错误拒绝
    expect(node(['check', '--phase', 'data', '--config', 'a', '--config', 'b']).code).toBe(2); // 重复参数
  });

  it('缺 config / config 不存在 → 退出 4', () => {
    expect(node(['check', '--phase', 'data']).code).toBe(4);
    expect(node(['check', '--phase', 'data', '--config', '/nonexistent.json']).code).toBe(4);
  });

  it('bind：模板 handoff 拒绝（退出 4）', () => {
    const h = join(tmp, 'template-handoff.json');
    writeFileSync(h, JSON.stringify({ templateOnly: true, cycleId: 'x' }));
    const t = join(tmp, 'template.json');
    writeFileSync(t, '{}');
    const r = node(['bind', '--handoff', h, '--template', t, '--out', join(tmp, 'b1.json')]);
    expect(r.code).toBe(4);
  });

  it('bind：真实 handoff 成功；重复 bind 同身份 reused；覆盖不同身份拒绝', () => {
    const h = join(tmp, 'real-handoff.json');
    writeFileSync(h, JSON.stringify({
      templateOnly: false, cycleId: 'testcycle1', stage: 'completed', activeRunIds: [],
      parentPolicyHash: 'abc', budgetLedgerPath: 'lab/review5_tuning/budget-ledger.jsonl',
      budgetAccounts: [{ name: 'technical', limitSeconds: 900, consumedSeconds: 10, reservedSeconds: 0 }],
      assets: { kscbLocalPath: 'x', kscbSha256: 'y' },
    }));
    const t = join(tmp, 't.json');
    writeFileSync(t, JSON.stringify({ templateOnly: true }));
    const out = join(tmp, 'binding1.json');
    const r = node(['bind', '--handoff', h, '--template', t, '--out', out]);
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8')).immutable.cycleId).toBe('testcycle1');
    // 同身份重复 → reused（不重写）
    const before = statSync(out).mtimeMs;
    const r2 = node(['bind', '--handoff', h, '--template', t, '--out', out]);
    expect(r2.code).toBe(0);
    expect(r2.out).toContain('reused');
    expect(statSync(out).mtimeMs).toBe(before);
    // 不同身份覆盖 → 拒绝
    writeFileSync(h, JSON.stringify({ templateOnly: false, cycleId: 'othercycle', budgetAccounts: [] }));
    const r3 = node(['bind', '--handoff', h, '--template', t, '--out', out]);
    expect(r3.code).toBe(4);
  });

  it('bind：预算账 NaN/负数/超上限 → 退出 5', () => {
    const t = join(tmp, 't.json');
    writeFileSync(t, '{}');
    for (const accounts of [
      [{ name: 'x', limitSeconds: NaN, consumedSeconds: 0, reservedSeconds: 0 }],
      [{ name: 'x', limitSeconds: 100, consumedSeconds: -1, reservedSeconds: 0 }],
      [{ name: 'x', limitSeconds: 100, consumedSeconds: 90, reservedSeconds: 20 }],
    ]) {
      const h = join(tmp, 'bad-budget.json');
      writeFileSync(h, JSON.stringify({ templateOnly: false, cycleId: 'b', budgetAccounts: accounts }));
      expect(node(['bind', '--handoff', h, '--template', t, '--out', join(tmp, 'bad.json')]).code).toBe(5);
    }
  });

  it('check handoff：真账本通过；teacher（not_started）退出 4 如实报告', () => {
    const out = join(tmp, 'binding1.json');
    expect(node(['check', '--phase', 'handoff', '--config', out]).code).toBe(0);
    const r = node(['check', '--phase', 'teacher', '--config', out]);
    expect(r.code).toBe(4);
    expect(r.out).toContain('not_started');
  });

  it('human-audit / proxy-report 读真实工件', () => {
    const out = join(tmp, 'binding1.json');
    const r = node(['human-audit', '--config', out]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('rounds');
    const p = node(['proxy-report', '--config', out]);
    expect(p.code).toBe(0);
    expect(p.out).toContain('behavior_proxy');
  });

  it('distill-probe：数据门不满足 → 退出 4 blocked_data（不生成假权重）', () => {
    const out = join(tmp, 'binding1.json');
    const r = node(['distill-probe', '--config', out]);
    expect(r.code).toBe(4);
    expect(r.out).toContain('blocked_data');
  });

  it('report 生成汇总（可含 blocked，退出 0 只代表报告生成）', () => {
    const out = join(tmp, 'binding1.json');
    const r = node(['report', '--config', out]);
    expect(r.code).toBe(0);
    expect(existsSync(join(REPO, 'lab', 'review5_tuning', 'artifacts', 'testcycle1', 'report.json'))).toBe(true);
  });
});

process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 尽力 */ } });
