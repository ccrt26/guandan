/**
 * lab/src/followup_a.ts — A1/A2 定点验证（CLEAN1-REVIEW-1.0 指令 A）。
 * A1：真实输出层/标签尺度/四端口径——引用代码位置 + ck180 固定批次预测分布留证。
 * A2：同一权重、同一真实编码向量，TS 前向（采样与浏览器共用 packages/ai/src/nn/mlp.ts）
 *     与 PyTorch learner（训练端）数值一致；覆盖输出激活/矩阵布局/dtype/并列处置。
 *     事前容差：绝对误差 < 1e-4（沿用 round1 bench 口径）；记录实际最大误差与并列数。
 * 用法: npx tsx lab/src/followup_a.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyMove, canPass, createMatch, DEFAULT_RULES, legalCombos, startGame, type GameState } from '@gd/engine';
import { createAI, createNeuralAI, guardMove, INPUT_DIM, MLP, mulberry32, NeuralDecider, dedupCandidates, encodeState, encodeAction, STATE_DIM, PublicTracker } from '@gd/ai';
import { LearnerBridge } from './bridge';

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, d = ''): void => {
  c ? (pass++, console.log(`  ✓ ${name}${d ? ' ' + d : ''}`)) : (fail++, console.error(`  ✗ ${name} ${d}`));
};

const RUN = join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'clean1', 'clean1-2026102609500');
const buf = readFileSync(join(RUN, 'ck180', 'weights.f32'));
const W = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);

// ---------- A1：四端口径（代码位置断言，防"文档说了算"） ----------
console.log('== A1：输出层 / 标签尺度 / 四端口径 ==');
{
  const learnerSrc = readFileSync(join(import.meta.dirname, '..', 'learner.py'), 'utf8');
  const mlpSrc = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ai', 'src', 'nn', 'mlp.ts'), 'utf8');
  const samplerSrc = readFileSync(join(import.meta.dirname, 'sampler.ts'), 'utf8');
  const nnplayerSrc = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ai', 'src', 'nn', 'nnplayer.ts'), 'utf8');
  // 训练端网络：Linear-Tanh-Linear-Tanh-Linear（输出头线性，无缩放）——源码为多行，按组件断言；
  // 输出无缩放：pred 直接 squeeze 进 MSE（learner.py:133-134），文件其他 *4 属帧协议字节计算
  ok(learnerSrc.includes('nn.Linear(d, HIDDEN), nn.Tanh(),') &&
     learnerSrc.includes('nn.Linear(HIDDEN, HIDDEN), nn.Tanh(),') &&
     learnerSrc.includes('nn.Linear(HIDDEN, 1))') &&
     /pred = model\(xb\)\.squeeze\(-1\)\s*\n\s*loss = torch\.mean\(\(pred - yb\) \*\* 2\)/.test(learnerSrc),
    'learner.py Net = Linear385-256 ×Tanh ×Linear256 ×Tanh ×Linear→1（输出头线性，pred 无缩放直接进 MSE；learner.py:57-59,133-134）');
  // 训练端 loss：对 y 直接 MSE（无归一化/变换）
  ok(learnerSrc.includes('loss = torch.mean((pred - yb) ** 2)'),
    'learner.py train：MSE 直接作用于传入 y（train_y = raw_y，无 /4、无 clip）');
  // 采样端标签：y = g + w 原始值
  ok(samplerSrc.includes('const w = teamOf(p.seat) === match.winner ? 1 : -1;') && samplerSrc.includes('return { feat: p.feat, y: p.g + w, g: p.g, w };'),
    'sampler.ts：raw_y = g + W（g=±1/2/3，W=±1 → y∈[−4,4]），未缩放送 learner');
  // TS 前向（采样+浏览器共用）：两隐层 tanh，输出线性
  ok(mlpSrc.includes('h1[j] = Math.tanh(acc);') && mlpSrc.includes('h2[j] = Math.tanh(acc);') && mlpSrc.includes('out[s] = acc;'),
    'packages/ai/src/nn/mlp.ts：h1/h2 tanh，输出 out=线性 acc（无激活无缩放）');
  // 浏览器端：同一 MLP 类
  ok(nnplayerSrc.includes('this.decider = new NeuralDecider(seat, this.mlp, 0, () => 0);') && nnplayerSrc.includes('new MLP(1)'),
    '浏览器 NeuralPlayer → NeuralDecider → 同一 TS MLP（与采样端同一实现）');
  // meta：确认现存元数据未声明激活（记录为缺口，E 轮 protocol 补）
  const meta = JSON.parse(readFileSync(join(RUN, 'ck180', 'meta.json'), 'utf8')) as Record<string, unknown>;
  console.log(`  [记录] ck180/meta.json 字段=${Object.keys(meta).join(',')}——无激活函数/标签尺度字段（layers 见 packages/ai/src/nn/mlp.ts LAYER_SIZES）。E 轮 protocol 将显式写入 hidden=tanh×2/output=linear/train_y=raw_y`);
  ok(true, '口径结论=分支(a)：隐藏层 tanh×2、线性输出头、raw_y 不变换——简报"→1 tanh"为表述歧义，无值域矛盾，保持配方');
}

// ---------- 固定编码批次：真实局面 × 候选向量（确定性） ----------
async function buildBatchReal(limitVecs: number): Promise<{ X: Float32Array; groups: Array<{ off: number; n: number; seat: number; moveNo: number }> }> {
  const mlp = new MLP(1); mlp.setWeights(W);
  const match = createMatch({ ...DEFAULT_RULES }, 20261027);
  const ais = [0, 1, 2, 3].map((s) => createAI(s, 1, s * 31));
  const rand = mulberry32(20261028);
  const parts: Float32Array[] = [];
  const groups: Array<{ off: number; n: number; seat: number; moveNo: number }> = [];
  let games = 0;
  while (parts.reduce((s, p) => s + p.length / INPUT_DIM, 0) < limitVecs && games < 60) {
    const state: GameState = startGame(match);
    ais.forEach((p) => p.reset(state, match.opts));
    const deciders = [0, 1, 2, 3].map((s) => new NeuralDecider(s, mlp, 0, rand));
    deciders.forEach((d) => d.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const d = deciders[turn].decide(state, { wantRanking: true });
      const off = parts.reduce((s, p) => s + p.length / INPUT_DIM, 0);
      groups.push({ off, n: d.ranking!.length, seat: turn, moveNo: state.moveNo });
      // ranking 含全部候选的 (idx,score)；向量按 NeuralDecider 同构重建
      const rebuilt = rebuildVectors(state, turn, deciders[turn]);
      for (let i = 0; i < d.ranking!.length; i++) parts.push(rebuilt[d.ranking![i].idx]);
      const toBeat = state.lastCombo;
      const events = applyMove(state, guardMove(state, ais[turn].decide(state)) as never);
      deciders.forEach((dd) => dd.observe(events));
      ais.forEach((p) => p.observe(events, toBeat));
    }
    games += 1;
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const X = new Float32Array(total);
  let o = 0; for (const p of parts) { X.set(p, o); o += p.length; }
  return { X, groups };
}
// 重建某决策的全部候选向量（与 NeuralDecider.decide 同构：encodeState + encodeAction）
function rebuildVectors(state: GameState, seat: number, decider: NeuralDecider): Float32Array[] {
  const cands = dedupCandidates(legalCombos(state), canPass(state));
  const out: Float32Array[] = [];
  const base = new Float32Array(INPUT_DIM);
  const tracker = (decider as unknown as { tracker: PublicTracker }).tracker;
  encodeState(state, seat, tracker, base);
  for (const c of cands) {
    const v = new Float32Array(INPUT_DIM);
    v.set(base.subarray(0, STATE_DIM));
    encodeAction(c.combo, v.subarray(STATE_DIM));
    out.push(v);
  }
  return out;
}

// ---------- A1 留证：ck180 预测分布 + A2：TS↔PyTorch 一致 ----------
const { X, groups } = await buildBatchReal(2048);
console.log(`\n== 固定批次：${groups.length} 个决策点 / ${X.length / INPUT_DIM} 条候选向量 ==`);
{
  const mlp = new MLP(1); mlp.setWeights(W);
  const n = X.length / INPUT_DIM;
  const ts = mlp.forward(X, n);
  // A1 分布统计
  let mn = Infinity, mx = -Infinity, sum = 0, sum2 = 0, absBig = 0;
  for (let i = 0; i < n; i++) {
    const v = ts[i];
    mn = Math.min(mn, v); mx = Math.max(mx, v);
    sum += v; sum2 += v * v;
    if (Math.abs(v) > 0.99) absBig += 1;
  }
  const mean = sum / n, std = Math.sqrt(sum2 / n - mean * mean);
  console.log(`  A1 预测分布: min=${mn.toFixed(3)} max=${mx.toFixed(3)} mean=${mean.toFixed(3)} std=${std.toFixed(3)} |pred|>0.99 占比=${(absBig / n * 100).toFixed(2)}%（线性头不受 ±1 限界，诊断值）`);
  // 候选分差（组内 top1-top2）
  const gaps: number[] = [];
  for (const g of groups) {
    if (g.n < 2) continue;
    let best = -Infinity, second = -Infinity;
    for (let i = 0; i < g.n; i++) {
      const v = ts[g.off + i];
      if (v > best) { second = best; best = v; } else if (v > second) second = v;
    }
    gaps.push(best - second);
  }
  gaps.sort((a, b) => a - b);
  const q = (p: number) => gaps[Math.min(gaps.length - 1, Math.round(p * (gaps.length - 1)))];
  console.log(`  A1 候选分差(top1−top2): p50=${q(0.5).toFixed(4)} p90=${q(0.9).toFixed(4)} 近似并列(|gap|<1e-6) 占比=${(gaps.filter((v) => v < 1e-6).length / gaps.length * 100).toFixed(1)}%`);
  ok(true, 'A1 留证完成（分布+分差为诊断值，不设新验收门槛）');

  // A2：PyTorch 同权重同批次
  const bridge = new LearnerBridge('cpu');
  await bridge.init(INPUT_DIM, W, { check: 'a2-parity-ck180' });
  const py = await bridge.evalBatch(X, n, INPUT_DIM);
  let maxAbs = 0;
  for (let i = 0; i < n; i++) maxAbs = Math.max(maxAbs, Math.abs(ts[i] - py[i]));
  ok(maxAbs < 1e-4, `A2 TS↔PyTorch 逐值一致（实际最大绝对误差 ${maxAbs.toExponential(2)}，事前容差 1e-4）`);
  // argmax 排序一致（每组 top1 索引相同；分数跨运行时必有微小差，比索引不比全等）
  let agree = 0, ties = 0, tieAgree = 0;
  for (const g of groups) {
    let tBest = -Infinity, tIdx = -1, pBest = -Infinity, pIdx = -1, tMax = 0;
    for (let i = 0; i < g.n; i++) {
      if (ts[g.off + i] > tBest) { tBest = ts[g.off + i]; tIdx = i; }
      if (py[g.off + i] > pBest) { pBest = py[g.off + i]; pIdx = i; }
    }
    for (let i = 0; i < g.n; i++) if (Math.abs(ts[g.off + i] - tBest) < 1e-6) tMax += 1;
    if (tMax > 1) { ties += 1; if (tIdx === pIdx) tieAgree += 1; }
    if (tIdx === pIdx) agree += 1;
  }
  const multi = groups.filter((g) => g.n > 1).length;
  ok(agree === groups.length,
    `A2 候选排序一致：${agree}/${groups.length} 组 top1 索引相同（多候选组 ${multi}；近似并列组 ${ties} 个，并列内两端各自取首个最大值——并列组按索引一致 ${tieAgree}/${ties}）`);
  await bridge.shutdown();
}

// ---------- A2 补充：浏览器端加载链（与采样端同权重字节） ----------
{
  const deploy = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'web', 'public', 'ai', 'clean1.f32'));
  ok(deploy.equals(buf), 'A2 浏览器部署文件与 ck180 逐字节一致（加载链：fetch→createNeuralAI→NeuralPlayer→同一 TS MLP）');
  const p = createNeuralAI(1, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  ok(p.decide.name === 'decide', 'A2 createNeuralAI 构造成功（长度校验 164,865 内建）');
}

console.log(`\nA1/A2 定点验证: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
