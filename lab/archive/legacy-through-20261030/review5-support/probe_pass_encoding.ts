/**
 * lab/review5/probe_pass_encoding.ts — REVIEW5 T0.2 探针：TS + Python 双路径验证
 * pass 编码迁移 Q 等价（真实权重 × 真实引擎状态 × 全候选批次，含 pass）。
 * 产物：lab/review5/artifacts/t02-pass-encoding.json
 * 运行：npx tsx lab/review5/probe_pass_encoding.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  applyMove, bestResponse, canPass, createMatch, DEFAULT_RULES, legalCombos, startGame,
} from '@gd/engine';
import {
  encodeAction, encodeState, INPUT_DIM, INPUT_DIM_V2, migratePassEncoding,
  PublicTracker, STATE_DIM, STATE_DIM_V2, PASS_ACTION_IDX, PASS_KIND_IDX, ACTION_DIM,
} from '@gd/ai';
import { MLP } from '@gd/ai';
import { dedupCandidates } from '@gd/ai';
import { LearnerBridge } from '../src/bridge';

const REPO = join(import.meta.dirname, '..', '..');
const OUT = join(import.meta.dirname, 'artifacts');

function loadF32(p: string): Float32Array {
  const buf = readFileSync(p);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}
const sha = (f: Float32Array): string => createHash('sha256').update(Buffer.from(f.buffer, f.byteOffset, f.length * 4)).digest('hex');

function collectRealInputs(nStates: number, dim: number, stateDim: number): {
  legacy: Float32Array; fixed: Float32Array; n: number; nPass: number; nNonPass: number;
} {
  const legacy: number[] = [], fixed: number[] = [];
  let nPass = 0, n = 0;
  let match = createMatch({ ...DEFAULT_RULES }, 20261028);
  let state = startGame(match);
  let tracker = new PublicTracker();
  let states = 0, guard = 0;
  while (states < nStates && guard++ < 8000 && match.winner == null) {
    if (state.over) { state = startGame(match); tracker = new PublicTracker(); continue; }
    const seat = state.turn;
    const cands = dedupCandidates(legalCombos(state), canPass(state));
    for (const c of cands) {
      const s1 = new Float32Array(dim);
      encodeState(state, seat, tracker, s1.subarray(0, STATE_DIM));
      encodeAction(c.combo, s1.subarray(stateDim), 'legacy-phys10');
      const s2 = new Float32Array(dim);
      encodeState(state, seat, tracker, s2.subarray(0, STATE_DIM));
      encodeAction(c.combo, s2.subarray(stateDim), 'action64');
      legacy.push(...s1); fixed.push(...s2);
      if (c.combo === null) nPass += 1;
      n += 1;
    }
    states += 1;
    const t = state.turn;
    const combo = bestResponse(state.hands[t].slice(0, 1), state.lastCombo, state.ctx, match.opts);
    const ev = applyMove(state, combo ? { pass: false, combo } : { pass: true });
    tracker.observe(ev);
  }
  return {
    legacy: Float32Array.from(legacy), fixed: Float32Array.from(fixed), n, nPass, nNonPass: n - nPass,
  };
}

function tsMaxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; }
  return m;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = {
    probe: 'REVIEW5-T0.2-pass-encoding', at: new Date().toISOString(),
    inputs: '真实引擎推进 12 状态 × 全部去重候选（含 pass）',
  };

  // 编码层自证：action64 写 64；legacy 写 10
  {
    const v = new Float32Array(ACTION_DIM);
    encodeAction(null, v, 'action64');
    const l = new Float32Array(ACTION_DIM);
    encodeAction(null, l, 'legacy-phys10');
    report.encoding = {
      action64PassIdx: v[PASS_ACTION_IDX] === 1 && v[PASS_KIND_IDX] === 0,
      legacyPassIdx: l[PASS_KIND_IDX] === 1 && l[PASS_ACTION_IDX] === 0,
    };
  }

  const batches385 = collectRealInputs(12, INPUT_DIM, STATE_DIM);
  const batches399 = collectRealInputs(12, INPUT_DIM_V2, STATE_DIM_V2);
  report.batch = {
    v1: { n: batches385.n, pass: batches385.nPass, nonPass: batches385.nNonPass },
    v2: { n: batches399.n, pass: batches399.nPass, nonPass: batches399.nNonPass },
  };

  const old385 = loadF32(join(REPO, 'packages', 'web', 'public', 'ai', 'clean2.f32'));
  const mig385 = migratePassEncoding(old385, INPUT_DIM, STATE_DIM);
  const mOld = new MLP(1); mOld.setWeights(old385);
  const mNew = new MLP(1); mNew.setWeights(mig385);
  const qOld385 = mOld.forward(batches385.legacy, batches385.n);
  const qNew385 = mNew.forward(batches385.fixed, batches385.n);
  const tsV1 = tsMaxDiff(qOld385, qNew385);

  let tsV2: number | null = null;
  const p399 = join(REPO, 'lab', 'review2', 'runs', 'review4-treatment', 'ck-1800', 'weights.f32');
  let old399: Float32Array | null = null;
  if (existsSync(p399)) {
    old399 = loadF32(p399);
    const mig399 = migratePassEncoding(old399, INPUT_DIM_V2, STATE_DIM_V2);
    const o = new MLP(1, INPUT_DIM_V2); o.setWeights(old399);
    const nw = new MLP(1, INPUT_DIM_V2); nw.setWeights(mig399);
    const qA = o.forward(batches399.legacy, batches399.n);
    const qB = nw.forward(batches399.fixed, batches399.n);
    tsV2 = tsMaxDiff(qA, qB);
    report.weights399 = { path: p399, sha256: sha(old399) };
  }
  report.tsPath = {
    clean2: { params: old385.length, sha256Old: sha(old385), maxDiffQ: tsV1, exact: tsV1 === 0 },
    review4_399: tsV2 === null ? 'weights-missing' : { maxDiffQ: tsV2, exact: tsV2 === 0 },
  };

  // Python learner 前向：旧权重+legacy输入 vs 迁移权重+action64输入
  const py = new LearnerBridge('cpu');
  try {
    const env = await py.init(INPUT_DIM, old385, { probe: 'review5-t02' });
    const pyOld = await py.evalBatch(batches385.legacy, batches385.n, INPUT_DIM);
    await py.init(INPUT_DIM, mig385, { probe: 'review5-t02' });
    const pyNew = await py.evalBatch(batches385.fixed, batches385.n, INPUT_DIM);
    const pyDiff = tsMaxDiff(pyOld, pyNew);
    // TS↔Py 同权重同输入基线差（体现后端求和顺序差的量级）
    const cross = tsMaxDiff(pyOld, qOld385);
    report.pythonPath = {
      env: { torch: env.torch, python: env.python, arch: env.arch, device: env.device },
      oldPlusLegacyVsMigratedPlusAction64: { maxDiffQ: pyDiff, withinTol: pyDiff < 1e-6 },
      tsVsPySameWeightsSameInputs: { maxDiffQ: cross, note: '后端求和顺序差的基线量级' },
    };
  } finally {
    await py.shutdown();
  }

  report.verdict = {
    tsExactV1: tsV1 === 0,
    tsExactV2: tsV2 === 0,
    pythonWithinTol: (report.pythonPath as { oldPlusLegacyVsMigratedPlusAction64: { withinTol: boolean } })
      .oldPlusLegacyVsMigratedPlusAction64.withinTol,
  };
  writeFileSync(join(OUT, 't02-pass-encoding.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.verdict, null, 1));
  console.log(`产物: ${join(OUT, 't02-pass-encoding.json')}`);
}

void main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
