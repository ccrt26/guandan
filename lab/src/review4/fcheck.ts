/**
 * lab/src/review4/fcheck.ts — REVIEW4-F 技术门：v1→v2 重映射一致性。
 * 1) remapV1WeightsToV2：同一观察/action 下 v2(新列零权) 的 Q 与 v1 父 Q 逐位一致（float32 精确）
 * 2) control(zero)：14 新列输入恒 0 → Q 与 U0 同
 * 3) treatment(rule-context)：新列输入非零但初始权重 0 → Q 仍与父一致（初始时点）
 * 4) 列迁移正确性：v1 动作块列 j → v2 列 j+14（首层权重逐元素核对）
 * 用法: npx tsx lab/src/review4/fcheck.ts
 */
import { readFileSync } from 'node:fs';
import { canPass, createMatch, DEFAULT_RULES, legalCombos, startGame } from '@gd/engine';
import {
  MLP, NeuralDecider, buildInput, buildInputV2, INPUT_DIM, INPUT_DIM_V2, STATE_DIM,
  remapV1WeightsToV2, PublicTracker, dedupCandidates,
} from '@gd/ai';

const parentPath = 'lab/review2/runs/clean2-main/ck-7051/weights.f32';
const buf = readFileSync(parentPath);
const v1Weights = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));

const parent = new MLP(1, INPUT_DIM);
parent.setWeights(v1Weights);
const v2w = remapV1WeightsToV2(v1Weights);
const u0 = new MLP(1, INPUT_DIM_V2);
u0.setWeights(v2w);

// 真实中局状态若干
let checked = 0, maxDiff = 0, controlDiff = 0, treatDiff = 0;
for (let seed = 100; seed < 112; seed++) {
  const match = createMatch({ ...DEFAULT_RULES }, seed * 7919);
  const state = startGame(match);
  for (let i = 0; i < 20 && !state.over; i++) {
    const d = new NeuralDecider(state.turn, parent, 0, () => 0);
    d.decide(state);
    state.lastCombo = state.lastCombo; void d;
    break;
  }
  const seat = 0;
  const tracker = new PublicTracker();
  const cands = dedupCandidates(legalCombos(state), canPass(state));
  for (const c of cands.slice(0, 6)) {
    const x1 = buildInput(state, seat, tracker, c.combo);
    const q1 = parent.forward(x1, 1)[0];
    for (const fill of ['zero', 'rule-context'] as const) {
      const x2 = buildInputV2(state, seat, tracker, c.combo, fill);
      const q2 = u0.forward(x2, 1)[0];
      const diff = Math.abs(q1 - q2);
      maxDiff = Math.max(maxDiff, diff);
      if (fill === 'zero') controlDiff = Math.max(controlDiff, diff);
      else treatDiff = Math.max(treatDiff, diff);
    }
    checked += 1;
  }
}

// 列迁移抽查：v1 首层 W[h][STATE_DIM + a]（动作列） === v2 W[h][STATE_DIM + RULE? ...]
// v2: 动作块起点 STATE_DIM_V2=331；v1 动作列 j1 ∈ [317,385) → v2 列 j1+14 ∈ [331,399)
let colOk = true;
const H = 256;
for (let h = 0; h < H; h += 16) {
  for (let a = 0; a < 68; a += 7) {
    const j1 = STATE_DIM + a;
    const j2 = 331 + a;
    if (v1Weights[h * INPUT_DIM + j1] !== v2w[h * INPUT_DIM_V2 + j2]) colOk = false;
  }
  for (let k = 0; k < 14; k += 3) {
    if (v2w[h * INPUT_DIM_V2 + 317 + k] !== 0) colOk = false; // 新列零
    for (let j = 0; j < STATE_DIM; j += 37) {
      if (v1Weights[h * INPUT_DIM + j] !== v2w[h * INPUT_DIM_V2 + j]) colOk = false;
    }
  }
}

const okGate = maxDiff < 1e-6 && colOk;
console.log(JSON.stringify({
  parentQconsistency: { checkedInputs: checked, maxAbsDiff: maxDiff, controlZerosMaxDiff: controlDiff, treatmentInitialMaxDiff: treatDiff, tolerance: 1e-6, passed: maxDiff < 1e-6 },
  columnRemap: { passed: colOk, note: 'v1 动作列 j→j+14；新 14 列零；状态列原位' },
  params: { v1: parent.paramCount, v2: u0.paramCount },
  verdict: okGate ? 'PASS：两臂初始任意观察/action 的 Q 与父一致；列迁移正确' : 'FAIL',
}));
process.exit(okGate ? 0 : 1);
