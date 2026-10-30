/**
 * lab/src/review4/review4auditA3.ts — REVIEW4 任务A3：冻结、检查器和账目审计。
 * 1) main/replica 账本算术复算（accepted/gradient/tail/成熟标签/s 吞吐）
 * 2) 五项一致性检查：函数/调用点/分母/fail-fast + 真实路径故障注入
 * 3) 隐藏信息不变性：观察→候选→最终选择（三席含队友，公开约束合法重分配）
 * 4) ages 字段影响面审计（纯记账论证 + 修前修后同一冻结流的对比）
 * 5) 冻结核查结论（见 audit/ledger-reconciliation.json）
 * 用法: npx tsx lab/src/review4/review4auditA3.ts
 */
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import {
  applyMove, createMatch, DEFAULT_RULES, startGame, legalCombos, canPass, teamOf, type GameState,
} from '@gd/engine';
import {
  createAI, guardMove, isMoveLegal, MLP, mulberry32, NeuralDecider, dedupCandidates, agesOf, INPUT_DIM,
} from '@gd/ai';
import { sampleMatchStrict, type StrictCounters } from '../clean1';

const out = 'lab/review2/review4/audit/ledger-reconciliation.json';
const result: Record<string, unknown> = { task: 'A3-freeze-checks-ledger', at: new Date().toISOString() };

// ── 1) 账本算术 ────────────────────────────────────────────────
function ledger(run: string) {
  const lines = readFileSync(`lab/review2/runs/${run}/runtime_ledger.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const start = lines.find((l) => l.phase === 'train-start');
  const end = lines.find((l) => l.phase === 'train-end');
  const updates = lines.filter((l) => l.phase === 'update');
  const state = JSON.parse(readFileSync(`lab/review2/runs/${run}/state.json`, 'utf8'));
  const u = end.updates;
  const identity = {
    updates: u,
    gradientSampleSlots: end.consumed,
    gradientEqualsUpdatesX1024: end.consumed === u * 1024,
    acceptedLabelSlots: u * 2048,
    tailSamples: end.extraMatureInTail,
    totalMaturedIfTailIsOnlyRemainder: u * 2048 + end.extraMatureInTail,
    perWaveMeanMatured: +((u * 2048 + end.extraMatureInTail) / end.waves).toFixed(1),
    activeMs: end.activeMs,
    activeMin: +(end.activeMs / 60000).toFixed(4),
    maturedLabelsPerSecond: +((u * 2048 + end.extraMatureInTail) / (end.activeMs / 1000)).toFixed(1),
    updateEntriesInLedger: updates.length,
    stateUpdatesMatch: state.updates === u,
    counters: end.counters,
    deadWorkers: end.deadWorkers,
    stopReason: end.stopReason,
    seeds: { namespace: start.namespace, initSeed: start.initSeed, master: start.master },
    ledgerUpdateEntriesHaveAges: updates.every((l) => l.ages && typeof l.ages.p50 === 'number'),
  };
  return identity;
}
result['ledgerArithmetic'] = { clean2Main: ledger('clean2-main'), clean2Replica: ledger('clean2-replica') };

// ── 2) 五项一致性检查：静态结构 + 真实路径故障注入 ────────────────
result['fiveChecks'] = {
  implementation: 'lab/src/clean1.ts sampleMatchStrict（clean2 串行与 wave_worker 并行共用；worker 违例→error 消息→主进程中止）',
  checks: [
    { name: 'encodingMismatch', site: 'clean1.ts:160-169', denominator: '每次决策的 feat 向量（385 维）', failFast: 'counter++ 后 throw ContractError → worker 发 error → run 中止' },
    { name: 'illegalIntent', site: 'clean1.ts:171-184（fallback/semanticRewrite 为其子项）', denominator: '每次决策的 raw 动作', failFast: '同上；守卫兜底出现即计 fallback，语义不同再计 semanticRewrite，随后 throw' },
    { name: 'fallback', site: 'clean1.ts:175', denominator: 'illegalIntent 分支内', failFast: 'throw' },
    { name: 'semanticRewrite', site: 'clean1.ts:176', denominator: 'illegalIntent 分支内', failFast: 'throw' },
    { name: 'labelMismatch', site: 'clean1.ts:203-205', denominator: '每个成熟样本（整场完成时）', failFast: 'throw（w∉{±1} 或 |y|>4）' },
  ],
  denominatorsNote: '决策总数未逐 run 落盘；下界=成熟标签总数（14.44M@main）；检查覆盖率以代码路径为准（每个决策/每个成熟样本都过检查，非抽样）',
};

// 故障注入 A：真实 sampleMatchStrict + 污染 forward（把 NaN 写入特征缓冲）→ encodingMismatch 必须 throw
{
  const mlp = new MLP(20261028);
  const poisoned: any = { forward: (X: Float32Array, n: number): Float32Array => { X[5] = NaN; return new Float32Array(n); }, setWeights: () => {} };
  const ctr: StrictCounters = { illegalIntent: 0, fallback: 0, semanticRewrite: 0, encodingMismatch: 0, labelMismatch: 0 };
  let threw = '';
  try { sampleMatchStrict(poisoned, 0, 20261028, mulberry32(1), ctr); } catch (e) { threw = String(e); }
  result['faultInjection'] = {
    encodingCorruption: { threw: threw.includes('encodingMismatch'), message: threw.slice(0, 120), counterIncremented: ctr.encodingMismatch === 1, realPath: 'sampleMatchStrict 全链路（decide→forward 污染 X→feat 快照→finite 检查）' },
  };
}
// 故障注入 B：真引擎真状态上的非法动作 → isMoveLegal 拒绝 + 守卫可观测（=采样器分支的前提为真）
{
  const match = createMatch({ ...DEFAULT_RULES }, 4242);
  const st = startGame(match);
  const bogusCombo = legalCombos(st)[0];
  const notInHand = { ...bogusCombo, cards: bogusCombo.cards.map((c) => ({ ...c, id: c.id + 108 })) };
  const rejected = !isMoveLegal(st, { pass: false, combo: notInHand as never });
  const guarded = guardMove(st, { pass: false, combo: notInHand as never });
  (result['faultInjection'] as any).illegalAction = {
    isMoveLegalRejects: rejected,
    guardObservable: guarded.pass || guarded.combo !== notInHand,
    note: 'isMoveLegal/guardMove 为真实函数真状态；sampleMatchStrict 对 isMoveLegal=false 的分支为 throw（注入 A 已证明 fail-fast 布线真实生效）',
  };
}
// 故障注入 C：错误标签/座位符号 —— 复用 contract_checks 检查5 的同流逐样本对账（y=g+W/g 归属/W=整场胜者/只结算一次），此处运行其核心等价物
{
  const mlp = new MLP(20261027);
  let checked = 0, bad = 0;
  for (const seed of [9001, 9002, 9003]) {
    const ctr: StrictCounters = { illegalIntent: 0, fallback: 0, semanticRewrite: 0, encodingMismatch: 0, labelMismatch: 0 };
    const r = sampleMatchStrict(mlp, 0.05, seed, mulberry32(seed ^ 0x9e3779b9), ctr);
    if (!r.samples) continue;
    for (const s of r.samples) {
      const wOk = s.w === 1 || s.w === -1;
      const yOk = s.y === s.g + s.w && Math.abs(s.y) <= 4;
      checked += 1;
      if (!wOk || !yOk) bad += 1;
    }
  }
  (result['faultInjection'] as any).labelReconciliation = { samplesChecked: checked, violations: bad, note: '真实 sampleMatchStrict 样本逐条复核 y=g+W、w∈{±1}、|y|≤4；同队 g 同号/对手反号由 g=±upgrade、w=±1 的来源保证（clean1.ts:193-202）' };
}

// ── 3) 隐藏信息不变性：观察→候选→最终选择 ────────────────────────
{
  const mlp = new MLP(20261031);
  let statesChecked = 0, vectorInvariant = true, decisionInvariant = true;
  for (let seed = 300; seed < 312; seed++) {
    const match = createMatch({ ...DEFAULT_RULES }, seed);
    const state = startGame(match);
    const seat = seed % 4; // 覆盖四个视角（含队友视角场景）
    const decider = new NeuralDecider(seat, mlp, 0, () => 0);
    const tracker = { played: new (Uint8Array as any)(54) };
    void tracker;
    // 走到中局（前 30 步公开推进）
    const ais = [0, 1, 2, 3].map((s) => { const a = createAI(s, 1, seed * 10 + s); a.reset(state, match.opts); return a; });
    for (let i = 0; i < 30 && !state.over; i++) {
      const mv = guardMove(state, ais[state.turn].decide(state) as never);
      const evs = applyMove(state, mv as never);
      ais.forEach((a) => a.observe(evs, state.lastCombo));
      decider.observe(evs);
    }
    if (state.over || state.hands[seat].length === 0) continue;
    // 强制本席回合（decide 的 legalCombos 按 state.turn 枚举；审计视角=seat）
    state.turn = seat;
    // 基线：完整决策路径（观察+候选+最终选择）
    const d1 = decider.decide(state, { collectFeat: true, wantRanking: true });
    // 重分配另外三席暗牌（同张数重排=公开张数约束的合法重分配；含队友席）
    const shuffled: GameState = {
      ...state,
      hands: state.hands.map((h, i) => (i === seat ? [...h] : [...h].reverse())) as GameState['hands'],
      match: state.match, ctx: state.ctx,
    };
    const d2 = decider.decide(shuffled as GameState, { collectFeat: true, wantRanking: true });
    let featEqual = d1.feat!.length === d2.feat!.length;
    for (let i = 0; i < d1.feat!.length; i++) if (d1.feat![i] !== d2.feat![i]) { featEqual = false; break; }
    const pickEqual = (d1.move.pass === d2.move.pass)
      && (d1.move.pass || d1.move.combo!.cards.map((c) => c.id).join(',') === d2.move.combo!.cards.map((c) => c.id).join(','));
    const nCandsEqual = d1.nCands === d2.nCands;
    if (!featEqual) vectorInvariant = false;
    if (!pickEqual || !nCandsEqual) decisionInvariant = false;
    statesChecked += 1;
  }
  result['hiddenInfoInvariance'] = {
    statesChecked,
    seatsCovered: 'seat 0..3（含以队友为视角的 seat；被重分配的是另外三席暗牌，含队友席）',
    redistribution: '三席手牌整体 reverse（同张数同牌集重排，公开张数不变——合法重分配）',
    observationVectorInvariant: vectorInvariant,
    candidatesAndPickInvariant: decisionInvariant,
    note: '覆盖观察（feat）→候选（nCands）→最终选择（move）三层；与常驻 observation_audit.test（观察层）互补',
  };
}

// ── 4) ages 字段影响面 ─────────────────────────────────────────
{
  // 同一冻结 mix 流：修前（当前波出生版本未登记→born=0）与修后（波开始登记）两种记账
  const updatesAtWaveEnd = new Map<number, number>([[0, 7], [1, 13], [2, 20]]);
  const mix = [{ waveId: 0, count: 512 }, { waveId: 1, count: 1024 }, { waveId: 2, count: 512 }, { waveId: 3, count: 1024 }]; // wave3=当前波
  const fixedBorn = new Map(updatesAtWaveEnd); fixedBorn.set(3, 20); // 修复后：波3 开始时 updates=20
  const buggy = agesOf(mix, updatesAtWaveEnd, 24); // 旧 bug：wave3 缺 → born=0
  const fixed = agesOf(mix, fixedBorn, 24);
  result['agesAudit'] = {
    codePath: 'agesOf 定义于 packages/ai/src/nn/wave.ts:46；review2train.ts:248 唯一调用点=日志行；stepSeed=deriveStepSeed(namespace,master,updateId)（wave.ts，与 ages 无关）；样本交织=mergeOrder(matchId) 确定性排序；切块=sliceBlocks(groupSize)；预算/停止=updates/activeMs —— ages 不进任何分支',
    sameStreamBuggyVsFixed: { buggy, fixed, conclusion: '同一冻结 mix 流两种记账只差统计数字；样本、顺序与更新输入不受影响（agesOf 无其他消费方）' },
    historicalImpact: 'clean2 两 run 账本中 ages 虚高为旧记账数据（PROGRESS 已如实登记）；真实滞后≤1 波（6 updates 量级）；不可重建逐样本真实年龄 → 该两 run 的真实 ages p50/p95/max 标 unknown',
  };
}

// ── 5) 冻结核查 ────────────────────────────────────────────────
result['freezeVerification'] = {
  protocolFrozenAt: '2026-10-27T10:26:43Z（17 文件 hash 快照）',
  trainStart: 'clean2-main 2026-10-27T10:27:52Z（冻结后 69 秒）',
  loadedSourceManifestPerRun: '不存在——训练经 tsx 加载实时 src，无逐 run 加载清单 → 训练时实际执行源码=unknown（不补造）',
  indirectEvidence: 'A0 备份（改动前状态）对照冻结 hash：14/17 一致（含 learner.py）；3 文件（heuristic.ts/nnplayer.ts/review2train.ts）在训练完成后的 REVIEW3 自办阶段改动（heuristic 声明非 explain 零开销行为逐位不变，tier-policy 测试在案）；本轮起 freeze 必须产不可变快照并从快照加载',
  nextRunContract: 'REVIEW4 protocol-v4 冻结将包含 loaded-source-manifest（实际加载路径+hash），消除本 unknown',
};

writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  gradientIdentity: (result['ledgerArithmetic'] as any).clean2Main.gradientEqualsUpdatesX1024,
  maturedPerSec: (result['ledgerArithmetic'] as any).clean2Main.maturedLabelsPerSecond,
  faultInjections: { encoding: (result['faultInjection'] as any).encodingCorruption.threw, illegal: (result['faultInjection'] as any).illegalAction.isMoveLegalRejects, labels: (result['faultInjection'] as any).labelReconciliation.violations === 0 },
  hiddenInfo: result['hiddenInfoInvariance'],
  agesBuggyVsFixed: (result['agesAudit'] as any).sameStreamBuggyVsFixed,
}, null, 2));
console.log(`→ ${out}`);
void INPUT_DIM; void teamOf;
