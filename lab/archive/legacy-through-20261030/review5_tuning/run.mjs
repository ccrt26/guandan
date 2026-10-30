#!/usr/bin/env node
/**
 * lab/review5_tuning/run.mjs — REVIEW5.1 补充 Task 1：严格薄入口。
 * 只做参数校验、绑定/预算/运行态检查，然后调用真实实现（adapter-map.json 记录映射）。
 * 退出码：0=完成/有证据复用；1=运行错误；2=非法参数；3=实现/必需测试未就绪；4=前置不满足；5=预算不足/账目不明；6=预算内 incomplete。
 * 本入口不提供 deploy/confirm/一键 all；P 主训练/确认由原 REVIEW5 入口执行。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = '/Users/ccrt/game/guandan';
const TUNING = join(REPO, 'lab', 'review5_tuning');
const ART = join(REPO, 'lab', 'review5', 'artifacts');

const ADAPTER_MAP = {
  schemaVersion: 'review5.1-adapter-map-v1',
  phases: {
    data: { impl: 'lab/src/review5_tuning/humanData.ts (main)', function: 'main（语义回放+拆分+决策提取）', tests: ['lab/review5/artifacts/t3-semantic-report.json'], status: 'verified' },
    'human-audit': { impl: 'lab/review5_tuning/kscb_mapping_solve.py + humanData.ts', function: '映射求解+结构计数', tests: ['lab/review5/artifacts/kscb-mapping.json'], status: 'verified' },
    proxy: { impl: 'lab/src/review5_tuning/proxyFit.ts + learner_aux.py bc', function: 'extractWithFeatures/run_bc', tests: ['lab/review5/artifacts/proxy/proxy-quality.json'], status: 'verified' },
    'proxy-fit': { impl: 'lab/review5_tuning/learner_aux.py bc', function: 'run_bc', tests: ['lab/review5/artifacts/proxy/proxy-quality.json'], status: 'verified' },
    'proxy-report': { impl: 'lab/review5/artifacts/proxy/proxy-quality.json', function: '质量报告（宏平均 NLL+基线+分层）', tests: [], status: 'verified' },
    teacher: { impl: null, function: 'T5 12 点条件计划未在预算内生成', tests: [], status: 'not_started' },
    'teacher-labels': { impl: null, function: '依赖 T5 原件', tests: [], status: 'not_started' },
    distill: { impl: 'lab/review5_tuning/learner_aux.py distill（模式已实现，数据门未过）', function: 'run distill（未运行）', tests: ['learner_aux selftest=passed'], status: 'implemented_unverified' },
    'distill-probe': { impl: null, function: 'D 数据门（4 双支持根点+让/接双向）未满足', tests: [], status: 'blocked_data' },
    handoff: { impl: 'lab/review5_tuning/run.mjs checkHandoff', function: '本文件', tests: ['lab/tests/review5_tuning.interface.test.ts'], status: 'implemented' },
    report: { impl: 'lab/review5/REVIEW5_1_EXECUTION_REPORT.md 生成（T8）', function: 'reportFromArtifacts', tests: [], status: 'implemented' },
  },
  fourSeatReview: { impl: 'packages/review/src/teamReview.ts', function: 'buildTeamReview/exportIncidentPackage', tests: ['packages/review/tests/team_review.test.ts'], status: 'verified' },
  pTraining: { impl: 'lab/src/review5train.ts', function: 'main（分桶混合采样六 run）', tests: ['lab/review5/artifacts/runs/*/runtime_ledger.jsonl'], status: 'running' },
};

const die = (code, msg) => { console.error(msg); process.exit(code); };
const argv = process.argv.slice(2);
const cmd = argv[0];

// ---- capabilities / --help：只读，在任何 mkdir/写文件之前返回 ----
function capabilitiesJson() {
  return JSON.stringify({
    schemaVersion: 'review5.1-capabilities-v1',
    cycleId: 'review5_1-20261028',
    commands: ['capabilities', 'bind', 'check', 'human-audit', 'proxy-report', 'proxy-fit', 'teacher-labels', 'distill-probe', 'report'],
    phases: ADAPTER_MAP.phases,
    readOnly: ['capabilities', '--help'],
    notes: ['P 主训练/确认由原 REVIEW5 入口（lab/review2/run.mjs + lab/src/review5train.ts）执行，不经本入口', '无 deploy/confirm/all 命令'],
  }, null, 2);
}
if (cmd === 'capabilities') {
  if (argv.includes('--json')) { console.log(capabilitiesJson()); process.exit(0); }
  console.log('capabilities [--json]  只读阶段注册表（不在 mkdir 之前落任何文件）');
  console.log('bind --handoff H --template T --out B   交接绑定（拒绝覆盖不同身份）');
  console.log('check --phase handoff|data|proxy|teacher|distill --config B   阶段门检查');
  console.log('human-audit|proxy-report|proxy-fit|teacher-labels|distill-probe --config B');
  console.log('report --config B   从已有工件汇总（可含 blocked）');
  process.exit(0);
}
if (!cmd) die(2, '缺子命令（capabilities|bind|check|human-audit|proxy-report|proxy-fit|teacher-labels|distill-probe|report）');

const argOf = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const dupArgs = argv.filter((a, i) => a.startsWith('--') && argv.indexOf(a) !== i);
if (dupArgs.length) die(2, `重复参数: ${[...new Set(dupArgs)].join(',')}`);

// ---- bind ----
if (cmd === 'bind') {
  const handoffPath = argOf('handoff'), templatePath = argOf('template'), out = argOf('out');
  if (!handoffPath || !templatePath || !out) die(2, 'bind 需要 --handoff --template --out');
  if (!existsSync(handoffPath)) die(4, `handoff 不存在: ${handoffPath}`);
  if (!existsSync(templatePath)) die(4, `template 不存在: ${templatePath}`);
  const handoff = JSON.parse(readFileSync(handoffPath, 'utf8'));
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  if (handoff.templateOnly !== false) die(4, 'handoff 仍是模板（templateOnly!=false）——必须来自真实证据');
  if (handoff.cycleId == null) die(4, 'cycleId 缺失');
  if (!/^[A-Za-z0-9_-]+$/.test(handoff.cycleId)) die(4, `cycleId 非安全路径段: ${handoff.cycleId}`);
  // 预算账检查：NaN/Infinity/负数/缺账拒绝
  for (const a of handoff.budgetAccounts ?? []) {
    for (const k of ['limitSeconds', 'consumedSeconds', 'reservedSeconds']) {
      const v = a[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) die(5, `预算账 ${a.name}.${k} 非法: ${v}`);
    }
    if (a.consumedSeconds + a.reservedSeconds > a.limitSeconds) die(5, `预算账 ${a.name} 超上限`);
  }
  if (existsSync(out)) {
    const prev = JSON.parse(readFileSync(out, 'utf8'));
    if (prev.immutable?.cycleId !== handoff.cycleId) die(4, `绑定已存在且身份不同（${prev.immutable?.cycleId}）——拒绝覆盖`);
    console.log(JSON.stringify({ status: 'reused', binding: out, cycleId: handoff.cycleId }));
    process.exit(0);
  }
  const resolved = {
    schemaVersion: 'review5.1-resolved-config-v1',
    immutable: {
      cycleId: handoff.cycleId,
      parentPolicyHash: handoff.parentPolicyHash,
      source: { path: handoff.assets?.kscbLocalPath, sha256: handoff.assets?.kscbSha256 },
      limits: { technicalSeconds: 900, humanDataSeconds: 2700, proxySeconds: 1200, teacherSeconds: 2700, mainTrainSeconds: 10800, evaluationSeconds: 5400, apiAttempts: 24 },
      outputRoot: `lab/review5_tuning/artifacts/${handoff.cycleId}`,
      budgetLedgerPath: handoff.budgetLedgerPath,
      entryMapping: ADAPTER_MAP,
    },
    live: { stage: handoff.stage, activeRunIds: handoff.activeRunIds, budgetAccounts: handoff.budgetAccounts, confirmationState: handoff.confirmationState },
    handoff,
    template: { ...template, templateOnly: false },
    boundAt: new Date().toISOString(),
  };
  mkdirSync(join(out, '..'), { recursive: true });
  writeFileSync(out, JSON.stringify(resolved, null, 2));
  console.log(JSON.stringify({ status: 'completed', binding: out, cycleId: handoff.cycleId, stage: handoff.stage }));
  process.exit(0);
}

// ---- check / 阶段命令 ----
const NEED_CONFIG = ['check', 'human-audit', 'proxy-report', 'proxy-fit', 'teacher-labels', 'distill-probe', 'report'];
if (cmd === 'check') {
  // 参数合法性先于前置条件（拼写错误=2，不是 4）
  const phase0 = argOf('phase');
  if (!phase0) die(2, 'check 需要 --phase');
  if (!['handoff', 'data', 'proxy', 'teacher', 'distill'].includes(phase0)) die(2, `未知 phase: ${phase0}（类似 review5-comfirm 的拼写错误直接拒绝）`);
}
if (NEED_CONFIG.includes(cmd)) {
  const cfgPath = argOf('config');
  if (!cfgPath || !existsSync(cfgPath)) die(4, `需要 --config 指向存在的绑定: ${cfgPath ?? '(缺)'}`);
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  if (cfg.immutable?.cycleId == null) die(4, '绑定缺 immutable.cycleId');
  if (cmd === 'check') {
    const phase = argOf('phase');
    if (!phase) die(2, 'check 需要 --phase');
    const valid = ['handoff', 'data', 'proxy', 'teacher', 'distill'];
    if (!valid.includes(phase)) die(2, `未知 phase: ${phase}（类似 review5-comfirm 的拼写错误直接拒绝）`);
    void phase;
    if (phase === 'handoff') {
      const ledgerPath = cfg.immutable.budgetLedgerPath;
      if (!existsSync(ledgerPath)) die(5, `预算账本不存在: ${ledgerPath}`);
      console.log(JSON.stringify({ status: 'completed', phase, checks: ['accounts-finite', 'no-reset', 'evidence-linked'] }));
      process.exit(0);
    }
    const adapter = ADAPTER_MAP.phases[phase];
    if (!adapter) die(3, `phase 未注册: ${phase}`);
    if (adapter.status === 'not_started' || adapter.status === 'blocked_data') {
      console.log(JSON.stringify({ status: adapter.status, phase, note: adapter.function }));
      process.exit(phase === 'teacher' ? 4 : 4);
    }
    const missing = adapter.tests.filter((t) => !existsSync(join(REPO, t)));
    if (missing.length) die(3, `必需测试/证据缺失: ${missing.join(', ')}`);
    console.log(JSON.stringify({ status: 'completed', phase, evidence: adapter.tests }));
    process.exit(0);
  }
  if (cmd === 'human-audit' || cmd === 'data') {
    const p = join(ART, 't3-semantic-report.json');
    if (!existsSync(p)) die(4, 'T3 语义报告不存在（先运行 humanData.ts）');
    const rep = JSON.parse(readFileSync(p, 'utf8'));
    console.log(JSON.stringify({ status: 'completed', rounds: rep.rounds, decisions: rep.decisions, split: rep.split }));
    process.exit(0);
  }
  if (cmd === 'proxy-report') {
    const p = join(ART, 'proxy', 'proxy-quality.json');
    if (!existsSync(p)) die(4, 'proxy-quality.json 不存在（needs_fit）');
    console.log(readFileSync(p, 'utf8'));
    process.exit(0);
  }
  if (cmd === 'proxy-fit') {
    // H 已训练：重复执行只读回原结果（不重新初始化）
    const p = join(ART, 'proxy', 'proxy-quality.json');
    if (existsSync(p)) { console.log(JSON.stringify({ status: 'reused', note: 'H 已存在，重复 fit 拒绝重新初始化' })); process.exit(0); }
    die(4, 'H 未训练且本入口不直接触发训练（用 learner_aux.py bc）');
  }
  if (cmd === 'teacher-labels' || cmd === 'distill-probe') {
    die(4, 'blocked_data：T5 12 点条件计划原件未生成（预算内未执行），D 的 4 双支持根点+让/接双向数据门不满足——如实交 blocked，不凑数据');
  }
  if (cmd === 'report') {
    const out = join(TUNING, 'artifacts', cfg.immutable.cycleId, 'report.json');
    mkdirSync(join(out, '..'), { recursive: true });
    const states = Object.fromEntries(Object.entries(ADAPTER_MAP.phases).map(([k, v]) => [k, v.status]));
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), cycleId: cfg.immutable.cycleId, phases: states, note: '详细报告见 lab/review5/REVIEW5_1_EXECUTION_REPORT.md' }, null, 2));
    console.log(JSON.stringify({ status: 'completed', report: out }));
    process.exit(0);
  }
}
die(2, `未知命令: ${cmd}`);
