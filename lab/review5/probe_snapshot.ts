/**
 * lab/review5/probe_snapshot.ts — REVIEW5 T0.5 探针：不可变快照执行。
 * 验收（修改前失败点）：
 *  1) train 从可运行快照启动：ledger train-start 记 runFrom=runnable-snapshot、
 *     loadedSources 逐文件 hash、entryRealpath 落在快照树内（旧实现无 loadedSources，
 *     worker/learner 走实时目录）；
 *  2) 快照文件被篡改后再启动 → 拒跑（exit 4）；
 *  3) 训练真实完成 2 次更新（Python learner 经快照 bridge 路径正常拉起）。
 * 产物：lab/review5/artifacts/t05-snapshot-probe.json
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..');
const ART = join(import.meta.dirname, 'artifacts');
const SNAP = join(REPO, 'lab', 'review2', 'frozen', 'r5-snapshot-probe-snap');
const RUN = join(REPO, 'lab', 'review2', 'runs', 'r5-snapshot-probe');
const PROTO = 'lab/review5/protocol-p5.json';

function sh(cmd: string, args: string[], opts: { env?: Record<string, string> } = {}): { code: number; out: string } {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', timeout: 6 * 60000, env: { ...process.env, ...opts.env } });
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function main(): void {
  mkdirSync(ART, { recursive: true });
  rmSync(SNAP, { recursive: true, force: true });
  rmSync(RUN, { recursive: true, force: true });

  // 1) 冻结可运行快照
  const fz = sh('npx', ['tsx', 'lab/src/review5freeze.ts', '--id', 'r5-snapshot-probe-snap']);
  if (fz.code !== 0) throw new Error(`冻结失败: ${fz.out.slice(-400)}`);

  // 2) 协议（引用快照）
  writeFileSync(join(REPO, PROTO), JSON.stringify({
    protocolVersion: 'review5-t05-probe',
    frozenAt: new Date().toISOString(),
    sourceSnapshot: JSON.parse(readFileSync(join(SNAP, 'SHA256SUMS.json'), 'utf8')),
    runnableSnapshot: { dir: 'lab/review2/frozen/r5-snapshot-probe-snap', snapshotId: 'r5-snapshot-probe-snap' },
    trainer: { workers: 8, waveSize: 8, maxUpdates: 2, epsilon: 0.05, checkpointUpdates: [], matchGameCap: 60 },
    seeds: { namespaces: { 'main-init': 2026102811, 'main-train': 2026102812 } },
    effectiveRunConfig: { 'r5-snapshot-probe': { newMaxUpdates: 2, newMaxActiveMs: 600000 } },
    referenceWeights: { sha256: 'probe-no-ref', policyId: 'probe' },
  }, null, 1));

  // 3) run.mjs train → 路由到快照
  const t1 = sh('node', ['lab/review2/run.mjs', 'train', '--run', 'r5-snapshot-probe',
    '--max-active-min', '10', '--protocol', PROTO]);
  if (t1.code !== 0) throw new Error(`快照训练失败: ${t1.out.slice(-600)}`);

  const ledger = readFileSync(join(RUN, 'runtime_ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const start = ledger.find((l) => l.phase === 'train-start');
  const end = ledger.find((l) => l.phase === 'train-end');
  const st = JSON.parse(readFileSync(join(RUN, 'state.json'), 'utf8'));
  const checks = {
    runFromSnapshot: start?.runFrom === 'runnable-snapshot',
    loadedSourcesRecorded: Array.isArray(start?.loadedSources) && start.loadedSources.length > 30,
    realpathInside: String(start?.entryRealpath ?? '').includes('r5-snapshot-probe-snap'),
    workerPathInside: String(start?.workerPath ?? '').includes('r5-snapshot-probe-snap'),
    updatesReached: st.updates === 2,
    immutableAtEnd: end?.snapshotImmutable === true,
  };
  if (!checks.runFromSnapshot || !checks.loadedSourcesRecorded) throw new Error(`快照启动账目缺失: ${JSON.stringify(checks)}`);

  // 4) 篡改快照文件 → 拒跑（先备份，测完恢复）
  const victim = join(SNAP, 'lab', 'src', 'clean1.ts');
  const backup = readFileSync(victim, 'utf8');
  writeFileSync(victim, backup + '\n// tampered');
  const t2 = sh('node', ['lab/review2/run.mjs', 'train', '--run', 'r5-snapshot-probe',
    '--max-active-min', '10', '--protocol', PROTO]);
  const tamperRejected = t2.code === 4;
  const now = new Date();
  utimesSync(victim, now, now);
  writeFileSync(victim, backup);

  const report = {
    probe: 'REVIEW5-T0.5-snapshot', at: new Date().toISOString(),
    checks: { ...checks, tamperRejected, tamperExit: t2.code },
    loadedSourcesCount: start.loadedSources.length,
    verdict: {
      runFromImmutableSnapshot: checks.runFromSnapshot && checks.loadedSourcesRecorded && checks.realpathInside && checks.workerPathInside,
      tamperRejected,
      trainingCompletedViaSnapshot: checks.updatesReached && checks.immutableAtEnd,
    },
  };
  writeFileSync(join(ART, 't05-snapshot-probe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.verdict, null, 1));
}

main();
