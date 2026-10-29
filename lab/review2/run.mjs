#!/usr/bin/env node
/**
 * lab/review2/run.mjs — REVIEW2-EXEC-1.0 要求的薄入口。
 * 只调用项目现有测试器/训练器/分析代码（见 COMMANDS.txt 的映射），不另造第二套实现。
 * 每次运行写 JSON 摘要到 lab/review2/runs/（真实命令、退出码、产物路径）。
 * 未实现的阶段返回退出码 3（NOT_IMPLEMENTED），绝不以摘要冒充执行。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R2 = join(ROOT, 'lab', 'review2');
const RUNS = join(R2, 'runs');
mkdirSync(RUNS, { recursive: true });

const HELP = `用法: node lab/review2/run.mjs <子命令> [参数]

子命令（映射见 lab/review2/COMMANDS.txt）:
  inventory                                  定位入口/版本/资产 → inventory.json
  check --phase <facts|replay|coach|information-set|training-contract|web-integration|integrated|
              observation|parallel-contract|external-contract|human-data>
                                             运行对应语义回归与相关测试
  review --cases <file> [--mode facts|coach|sampled] [--samples N] [--max-moves N]
        [--max-actions N] [--max-api-calls N]
                                             对 case pack 生成确定性证据/可选 LLM 报告
  parallel-probe --protocol <file> [--max-active-min 30]
                                             并行采样三段短测（确定性/吞吐/短学习对照）
  external-probe --protocol <file> --phase <adapter|dev|confirm>
                                             DanZero 外部参照（适配/开发对战/确认）
  human-probe --protocol <file> --phase <decode|diagnose>
                                             KSCB 解码探针与人类决策诊断
  candidate-profile [--states N] [--small-hand-cases N]
                                             候选 v1/v2 画像与穷举对照
  freeze --protocol <file>                   冻结协议/种子/代码快照（拒绝覆盖）
  train --run <id> --max-active-min N [--protocol F] [--from P]
                                             在冻结目录启动训练
  evaluate --run <id> --split <dev|confirm-attempt1|confirm-attempt2> [--protocol F]
        [--lock-candidate]
                                             仅运行冻结协议定义的评测
  difficulty --phase <dev|confirm> --protocol <file> [--lock-settings]
                                             渐进难度校准
  report --out <file>                        汇总真实输出生成交付报告

退出码: 0=成功 1=执行失败 2=参数错误 3=阶段未实现 4=前置条件不满足`;

/** 命令存在性检查（防虚构脚本） */
const tsxTargets = {
  'parallel-probe': join(ROOT, 'lab', 'src', 'parallel_probe.ts'),
  'external-probe': join(ROOT, 'lab', 'src', 'external_probe.ts'),
  'human-probe': join(ROOT, 'lab', 'src', 'human_probe.ts'),
  'review:cases': join(ROOT, 'lab', 'src', 'review2case.ts'),
  'candidate-profile:v2': join(ROOT, 'lab', 'src', 'cand_profile_v2.ts'),
  'freeze:impl': join(ROOT, 'lab', 'src', 'review2freeze.ts'),
  'train:impl': join(ROOT, 'lab', 'src', 'review2train.ts'),
  'evaluate:impl': join(ROOT, 'lab', 'src', 'review2train.ts'),
  'difficulty:impl': join(ROOT, 'lab', 'src', 'review2difficulty.ts'),
  'report:impl': join(ROOT, 'lab', 'src', 'review2report.ts'),
};

/** 测试文件存在才纳入 phase（不存在=该 phase 尚未具备对应语义测试） */
function testFilesFor(phase) {
  const candidates = {
    facts: [
      'packages/review/tests/review.test.ts',
      'packages/review/tests/nnAdvisor.test.ts',
      'packages/engine/tests/combo.test.ts',
      'packages/engine/tests/game.test.ts',
    ],
    replay: ['packages/review/tests/replay_strict.test.ts', 'packages/review/tests/integrity.test.ts'],
    coach: ['packages/review/tests/coach_contract.test.ts'],
    'information-set': ['packages/review/tests/infoset.test.ts', 'packages/review/tests/r3.test.ts'],
    integrated: [
      'packages/review/tests/review.test.ts', 'packages/review/tests/r1_fixes.test.ts',
      'packages/review/tests/replay_strict.test.ts', 'packages/review/tests/r3.test.ts',
    ],
    observation: ['packages/ai/tests/observation_audit.test.ts'],
    'parallel-contract': ['packages/ai/tests/wave_contract.test.ts'],
    'external-contract': ['lab/tests/external_contract.test.ts'],
    'human-data': ['lab/tests/human_data.test.ts'],
    'training-contract': ['lab/tests/training_contract.test.ts'],
    'web-integration': ['packages/web/tests/neural-policy.test.ts'],
  }[phase] ?? null;
  if (!candidates) return { ok: false, err: `未知 phase: ${phase}` };
  const existing = candidates.filter((f) => existsSync(join(ROOT, f)));
  return { ok: true, existing, missing: candidates.filter((f) => !existsSync(join(ROOT, f))) };
}

function summary(cmd, { status, code, realCommands = [], outputs = [], note = '' }) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(RUNS, `${ts}-${cmd.replace(/[^a-z0-9-]/gi, '_')}.json`);
  const rec = {
    cmd: process.argv.slice(2),
    status, code,
    realCommands, outputs, note,
    node: process.version,
    cwd: ROOT,
    at: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(rec, null, 1));
  console.error(`[run.mjs] 摘要 → ${file} (${status})`);
  return rec;
}

function runReal(args, opts = {}) {
  console.error(`[run.mjs] 执行: ${args.join(' ')}`);
  const r = spawnSync(args[0], args.slice(1), { cwd: ROOT, stdio: 'inherit', env: process.env, ...opts });
  return { code: r.status ?? 1, args };
}

const [sub, ...rest] = process.argv.slice(2);
if (!sub || sub === '--help' || sub === '-h') { console.log(HELP); process.exit(sub ? 0 : 2); }

/** 简单参数解析：仅白名单键，拒绝未知 */
function parseArgs(spec) {
  const out = {}; const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (!(key in spec)) { console.error(`未知参数: ${a}\n${HELP}`); process.exit(2); }
      if (spec[key] === true) out[key] = true;
      else { out[key] = rest[++i]; if (out[key] === undefined) { console.error(`参数 --${key} 缺值`); process.exit(2); } }
    } else positional.push(a);
  }
  return { out, positional };
}

try {
  switch (sub) {
    case 'inventory': {
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
      const inv = {
        generatedAt: new Date().toISOString(),
        root: ROOT,
        scripts: pkg.scripts,
        keyFiles: {},
        weights: {},
      };
      const files = [
        'packages/review/src/coach.ts', 'packages/review/src/analyzer.ts', 'packages/review/src/counterfactual.ts',
        'packages/review/src/replay.ts', 'packages/review/src/nnAdvisor.ts', 'packages/ai/src/sim.ts',
        'packages/ai/src/heuristic.ts', 'packages/engine/src/combo.ts', 'packages/engine/src/record.ts',
        'lab/src/clean1.ts', 'lab/learner.py', 'lab/src/stats.ts', 'packages/web/src/ui/ReviewPage.tsx',
      ];
      for (const f of files) {
        const p = join(ROOT, f);
        inv.keyFiles[f] = existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null;
      }
      for (const w of ['packages/web/public/ai/clean1.f32', 'lab/clean1/clean1-2026102609500/ck180/weights.f32', 'lab/clean1/clean1-2026102615172-e1/ck180/weights.f32']) {
        const p = join(ROOT, w);
        inv.weights[w] = existsSync(p) ? statSync(p).size : null;
      }
      inv.review2Dirs = readdirSync(R2);
      writeFileSync(join(R2, 'inventory.json'), JSON.stringify(inv, null, 1));
      summary('inventory', { status: 'ok', code: 0, outputs: [join(R2, 'inventory.json')] });
      process.exit(0);
    }

    case 'check': {
      const { out } = parseArgs({ phase: '' });
      if (!out.phase) { console.error('check 需要 --phase'); process.exit(2); }
      const tf = testFilesFor(out.phase);
      if (!tf.ok) { summary(`check-${out.phase}`, { status: 'arg_error', code: 2, note: tf.err }); process.exit(2); }
      if (tf.existing.length === 0) {
        summary(`check-${out.phase}`, { status: 'not_implemented', code: 3, note: `尚无该 phase 的语义测试文件（缺失: ${tf.missing.join(', ')}）` });
        process.exit(3);
      }
      const r = runReal(['npx', 'vitest', 'run', ...tf.existing]);
      summary(`check-${out.phase}`, {
        status: r.code === 0 ? 'ok' : 'fail', code: r.code,
        realCommands: [r.args.join(' ')],
        note: tf.missing.length ? `尚未存在的测试（未运行）: ${tf.missing.join(', ')}` : '',
      });
      process.exit(r.code === 0 ? 0 : 1);
    }

    case 'review': {
      const { out } = parseArgs({ cases: '', mode: '', samples: '', 'max-moves': '', 'max-actions': '', 'max-api-calls': '' });
      if (!out.cases) { console.error('review 需要 --cases'); process.exit(2); }
      const impl = tsxTargets['review:cases'];
      if (!existsSync(impl)) { summary('review', { status: 'not_implemented', code: 3, note: `实现文件不存在: lab/src/review2case.ts` }); process.exit(3); }
      const args = ['npx', 'tsx', 'lab/src/review2case.ts', '--cases', out.cases];
      if (out.mode) args.push('--mode', out.mode);
      if (out.samples) args.push('--samples', out.samples);
      if (out['max-moves']) args.push('--max-moves', out['max-moves']);
      if (out['max-actions']) args.push('--max-actions', out['max-actions']);
      if (out['max-api-calls']) args.push('--max-api-calls', out['max-api-calls']);
      const r = runReal(args);
      summary('review', { status: r.code === 0 ? 'ok' : 'fail', code: r.code, realCommands: [r.args.join(' ')] });
      process.exit(r.code === 0 ? 0 : 1);
    }

    case 'candidate-profile': {
      const { out } = parseArgs({ states: '', 'small-hand-cases': '' });
      const impl = tsxTargets['candidate-profile:v2'];
      if (!existsSync(impl)) {
        // v2 画像未实现前，明确回落到既有 v1 画像并如实标注
        const v1 = join(ROOT, 'lab', 'src', 'cand_profile.ts');
        if (!existsSync(v1)) { summary('candidate-profile', { status: 'not_implemented', code: 3 }); process.exit(3); }
        const r = runReal(['npx', 'tsx', 'lab/src/cand_profile.ts']);
        summary('candidate-profile', { status: r.code === 0 ? 'ok_v1_fallback' : 'fail', code: r.code, realCommands: [r.args.join(' ')], note: 'v2 画像 (cand_profile_v2.ts) 未实现，此为既有 v1 画像，非 v1/v2 对照' });
        process.exit(r.code === 0 ? 0 : 1);
      }
      const args = ['npx', 'tsx', 'lab/src/cand_profile_v2.ts'];
      if (out.states) args.push('--states', out.states);
      if (out['small-hand-cases']) args.push('--small-hand-cases', out['small-hand-cases']);
      const r = runReal(args);
      summary('candidate-profile', { status: r.code === 0 ? 'ok' : 'fail', code: r.code, realCommands: [r.args.join(' ')] });
      process.exit(r.code === 0 ? 0 : 1);
    }

    case 'parallel-probe': case 'external-probe': case 'human-probe': {
      const impl = tsxTargets[sub];
      if (!impl || !existsSync(impl)) {
        summary(sub, { status: 'not_implemented', code: 3, note: `lab/src/${sub.replace(/-/g, '_')}.ts 尚未实现（REVIEW3-EXEC §11.4）` });
        process.exit(3);
      }
      const r = runReal(['npx', 'tsx', impl, ...rest]);
      summary(sub, { status: r.code === 0 ? 'ok' : 'fail', code: r.code, realCommands: [r.args.join(' ')] });
      process.exit(r.code === 0 ? 0 : 1);
    }

    case 'freeze': case 'train': case 'evaluate': case 'difficulty': case 'report': {
      const impl = tsxTargets[`${sub === 'report' ? 'report' : sub}:impl`] ?? tsxTargets[`${sub}:impl`];
      const implFile = sub === 'report' ? tsxTargets['report:impl'] : impl;
      if (!implFile || !existsSync(implFile)) {
        summary(sub, { status: 'not_implemented', code: 3, note: `${sub} 阶段实现文件尚未创建（REVIEW2-EXEC 对应阶段未开始）` });
        process.exit(3);
      }
      const implName = sub === 'freeze' ? 'review2freeze' : sub === 'evaluate' ? 'review2train' : sub === 'report' ? 'review2report' : `review2${sub}`;
      let args = ['npx', 'tsx', `lab/src/${implName}.ts`, sub === 'freeze' || sub === 'report' ? '' : sub, ...rest].filter(Boolean);
      // REVIEW5 T0.5：协议声明可运行快照时，train/evaluate 从快照树启动（真实 runs 目录经 GD_R2 传回）
      let envNote = null;
      if (sub === 'train' || sub === 'evaluate') {
        const pi = rest.indexOf('--protocol');
        const protoPath = pi >= 0 ? rest[pi + 1] : 'lab/review2/protocol-v3.json';
        try {
          const proto = JSON.parse(readFileSync(join(ROOT, protoPath), 'utf8'));
          if (proto?.runnableSnapshot?.dir) {
            const snapAbs = join(ROOT, proto.runnableSnapshot.dir);
            if (existsSync(join(snapAbs, 'lab', 'src', `${implName}.ts`))) {
              // 只替换实现入口为快照内文件；--protocol 等参数原样保留（协议是数据，
              // 由 GD_R2 指向真实 lab/review2 解析；此前误删 --protocol 会落到默认 protocol-v3）
              args = ['npx', 'tsx', join(proto.runnableSnapshot.dir, 'lab', 'src', `${implName}.ts`),
                sub, ...rest].filter(Boolean);
              process.env.GD_SNAPSHOT_DIR = snapAbs;
              process.env.GD_R2 = join(ROOT, 'lab', 'review2');
              envNote = { runFrom: 'runnable-snapshot', snapshot: proto.runnableSnapshot.dir };
            }
          }
        } catch { /* 协议不存在/损坏时由 impl 自行报错 */ }
      }
      const r = runReal(args);
      summary(sub, { status: r.code === 0 ? 'ok' : 'fail', code: r.code, realCommands: [r.args.join(' ')], ...(envNote ?? {}) });
      process.exit(r.code ?? 1); // REVIEW5 T0.5：退出码原样透传（4=前置不满足不得映射为 1）
    }

    default:
      console.error(`未知子命令: ${sub}\n${HELP}`);
      process.exit(2);
  }
} catch (e) {
  summary(sub ?? 'unknown', { status: 'error', code: 1, note: String(e) });
  process.exit(1);
}
