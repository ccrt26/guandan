/**
 * lab/review5/probe_resume.ts — REVIEW5 T0.4 探针：末波尾部账目 + 有限断点恢复。
 * 验收（修改前失败点）：
 *  1) maxUpdates 在波内触发停止时，尾部继承仍执行——state.json 的 tailLen 与账目恒等式
 *     Σwave.mature = updates×2048 + tailLen 成立（旧实现末波尾部沿用旧值，恒等式破裂）；
 *  2) 断点恢复不重放：恢复后的 wave matchId 区间与恢复前无重叠（nextMatchId 续接）；
 *  3) 预算不重置：恢复后 activeMs 继续累计（pausedActiveMs 相加），updates 续接 2→4。
 * 运行：npx tsx lab/review5/probe_resume.ts   （真实 8-worker 波采样，约 2-5 分钟）
 * 产物：lab/review5/artifacts/t04-resume-probe.json
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..');
const ART = join(import.meta.dirname, 'artifacts');
const RUN_DIR = join(REPO, 'lab', 'review2', 'runs', 'r5-resume-probe');
const P1 = join(import.meta.dirname, 'probe-protocol-p1.json');
const P2 = join(import.meta.dirname, 'probe-protocol-p2.json');

function protoOf(maxUpdates: number): string {
  return JSON.stringify({
    protocolVersion: 'review5-t04-probe',
    frozenAt: '2026-10-28T00:00:00.000Z',
    sourceSnapshot: {},
    trainer: { workers: 8, waveSize: 8, maxUpdates, epsilon: 0.05, checkpointUpdates: [], matchGameCap: 60 },
    seeds: { namespaces: { 'main-init': 2026102801, 'main-train': 2026102802 } },
    effectiveRunConfig: { 'r5-resume-probe': { newMaxUpdates: maxUpdates, newMaxActiveMs: 600000 } },
    referenceWeights: { sha256: 'probe-no-ref', policyId: 'probe' },
  }, null, 1);
}

function runTrain(protocol: string): { code: number; stdout: string } {
  const r = spawnSync('npx', ['tsx', 'lab/src/review2train.ts', 'train', '--run', 'r5-resume-probe',
    '--max-active-min', '10', '--protocol', protocol], { cwd: REPO, encoding: 'utf8', timeout: 8 * 60000 });
  return { code: r.status ?? -1, stdout: (r.stdout ?? '') + (r.stderr ?? '') };
}

function readLedger(): Array<Record<string, unknown>> {
  return readFileSync(join(RUN_DIR, 'runtime_ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

function main(): void {
  mkdirSync(ART, { recursive: true });
  rmSync(RUN_DIR, { recursive: true, force: true });
  writeFileSync(P1, protoOf(2));
  writeFileSync(P2, protoOf(4));

  const checks: Record<string, unknown> = {};
  const t1 = runTrain(P1);
  checks.run1 = { code: t1.code, tail: t1.stdout.split('\n').filter((l) => l.includes('训练结束'))[0] ?? t1.stdout.slice(-200) };
  if (t1.code !== 0) throw new Error(`run1 失败: ${t1.stdout.slice(-500)}`);

  const st1 = JSON.parse(readFileSync(join(RUN_DIR, 'state.json'), 'utf8')) as Record<string, number>;
  const ledger1 = readLedger();
  const waves1 = ledger1.filter((l) => l.phase === 'wave') as Array<{ waveId: number; mature: number; tail: number; updatesAfter: number }>;
  const mature1 = waves1.reduce((s, w) => s + w.mature, 0);
  // 恒等式：成熟样本 = 已消费组 × 2048 + 尾部（要求：maxUpdates 停止也写真实尾部）
  checks.accountingRun1 = {
    updates: st1.updates, tailLen: st1.tailLen, matureSum: mature1,
    identity: mature1 === st1.updates * 2048 + st1.tailLen,
    waveTailRecorded: waves1[waves1.length - 1]?.tail === st1.tailLen,
  };
  if (!checks.accountingRun1.identity) throw new Error(`run1 账目恒等式破裂: mature=${mature1} updates=${st1.updates} tail=${st1.tailLen}`);

  // 有限断点恢复：目标 2→4
  const t2 = runTrain(P2);
  checks.run2 = { code: t2.code, tail: t2.stdout.split('\n').filter((l) => l.includes('训练结束') || l.includes('恢复'))[0] ?? t2.stdout.slice(-200) };
  if (t2.code !== 0) throw new Error(`run2 失败: ${t2.stdout.slice(-500)}`);

  const st2 = JSON.parse(readFileSync(join(RUN_DIR, 'state.json'), 'utf8')) as Record<string, number>;
  const ledger2 = readLedger();
  const starts2 = ledger2.filter((l) => l.phase === 'train-start') as Array<{ resume: boolean; atUpdates?: number }>;
  const waves2 = ledger2.filter((l) => l.phase === 'wave') as Array<{ waveId: number; mature: number; tail: number; updatesAfter: number }>;
  const mature2 = waves2.reduce((s, w) => s + w.mature, 0);
  checks.resume = {
    resumedFlag: starts2.length === 2 && starts2[1].resume === true,
    updatesContinued: st2.updates === 4,
    activeMsAccumulated: st2.activeMs >= st1.activeMs,
    waveCountContinued: st2.waveCount > st1.waveCount,
    noMatchReplay: waves2.slice(waves1.length).every((w) => w.waveId > waves1[waves1.length - 1].waveId),
  };
  // 账目恒等式（含恢复继承的 tail：恢复路径把 run1 尾部并入流）
  checks.accountingRun2 = {
    updates: st2.updates, tailLen: st2.tailLen,
    matureSumAllWaves: mature2,
    identity: mature2 === st2.updates * 2048 + st2.tailLen,
  };
  if (!checks.resume.updatesContinued) throw new Error(`恢复后 updates=${st2.updates} != 4`);
  if (!checks.accountingRun2.identity) throw new Error(`run2 账目恒等式破裂: mature=${mature2} updates=${st2.updates} tail=${st2.tailLen}`);

  const report = {
    probe: 'REVIEW5-T0.4-resume', at: new Date().toISOString(),
    checks,
    verdict: {
      tailAccountingAllPaths: checks.accountingRun1.identity && checks.accountingRun2.identity,
      noReplay: checks.resume.noMatchReplay && checks.resume.resumedFlag,
      budgetNotReset: checks.resume.activeMsAccumulated,
    },
  };
  writeFileSync(join(ART, 't04-resume-probe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.verdict, null, 1));
}

main();
