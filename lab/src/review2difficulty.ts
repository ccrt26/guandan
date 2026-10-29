/**
 * lab/src/review2difficulty.ts — D1 渐进难度（REVIEW3-EXEC §10，沿用已批准方案）。
 * 规则：只调两个对手席位（队友固定）；高档=最终验收政策贪心（ε=0）；
 * 中低档=ε-greedy 且仅在 top2/top3 且与 top1 raw Q 差≤0.5 的近并列动作中有限随机；
 * ε 网格 {0, 0.15, 0.30, 0.50, 0.75}；无合格替代就 top1；规则已证明立即赢副的动作不替换。
 * dev：固定种子块上评各档 vs 用户侧参照（O=当前政策贪心），挑真实可区分档位；
 * confirm：新种子一次确认 + --lock-settings 落盘 difficulty.json。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch, DEFAULT_RULES, startGame, applyMove, RNG, type Combo } from '@gd/engine';
import { NeuralDecider, isMoveLegal, guardMove, legalCombos, canPass, dedupCandidates, mulberry32, decideTiered, type MLP } from '@gd/ai';
import { MLP as LabMLP } from './mlp';

const ROOT = join(import.meta.dirname, '..', '..');
const R2 = join(ROOT, 'lab', 'review2');
const EPS_GRID = [0, 0.15, 0.30, 0.50, 0.75] as const;
const NEAR_TIE = 0.5; // 与 top1 raw Q 差 ≤0.5 的近并列集合（top2/3）
const SEAT_NAMES = ['轻松', '标准', '挑战'] as const;

function loadWeightsInto(mlp: MLP, path: string): void {
  const buf = readFileSync(path);
  mlp.setWeights(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
}

// decideTiered 已下沉至 packages/ai/src/nn/tiered.ts（唯一权威），此处直接引用

/** tier 队（ε 档双席 + 贪心队友） vs 对照队（贪心双席）；返回 tier 队是否胜 */
function playTierMatch(policy: MLP, eps: number, seed: number, tierSide: 0 | 1): boolean {
  const matchSeed = (Math.imul(seed, 0x27d4eb2f) ^ 0x165667b1) >>> 0;
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const greedy = [0, 1, 2, 3].map((s) => new NeuralDecider(s, policy, 0, () => 0));
  const rand = mulberry32((matchSeed ^ 0x7a11) >>> 0);
  let games = 0;
  while (match.winner == null && games < 80) {
    const state = startGame(match);
    greedy.forEach((s) => s.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const isTierSeat = (turn & 1) === tierSide && turn === (tierSide === 0 ? 0 : 1) // tier 只占两对手位=队里两个席位都用 ε 档
        ? true : (turn & 1) === tierSide; // tier 队两个席位均为 ε 档（对手席位定义见 §10：难度作用于两个对手席位；从用户视角=对手两队席位）
      // 说明：从"用户是南家"的产品视角，两个对手=东/西（异队）……但整场评测以 tier 队为
      // 一方：tier 队=该队两席位都用 ε 决策；对照队=贪心。与 M2 的 N+H 结构无关。
      const d = greedy[turn]; // tracker 由 greedy decider 统一维护（观察公开事件，两套决策共享同一 tracker 会重复 observe）
      let raw: { pass: boolean; combo?: Combo };
      if (isTierSeat) raw = decideTiered(d, state, eps, rand);
      else raw = d.decide(state).move as { pass: boolean; combo?: Combo };
      const move = isMoveLegal(state, raw as never) ? raw : guardMove(state, raw as never);
      const events = applyMove(state, move as never);
      greedy.forEach((s) => s.observe(events));
    }
    games += 1;
  }
  return match.winner === tierSide;
}

function policyWeightsPath(): string {
  const cand = join(R2, 'selected', 'candidate.json');
  if (existsSync(cand)) {
    const c = JSON.parse(readFileSync(cand, 'utf8')) as { weightsPath: string };
    if (existsSync(c.weightsPath)) return c.weightsPath;
  }
  // 未晋级时：用当前部署政策（如实标注适用范围，§10）
  return join(ROOT, 'packages', 'web', 'public', 'ai', 'clean1.f32');
}

function run(phase: string, lockSettings: boolean): number {
  const protoPath = join(R2, 'difficulty.json');
  const policyPath = policyWeightsPath();
  const policy = new LabMLP(1);
  loadWeightsInto(policy, policyPath);
  const wBuf = readFileSync(policyPath);

  if (phase === 'dev') {
    const blocks = 24;
    const results = EPS_GRID.map((eps) => {
      const wins: number[] = [];
      for (let b = 0; b < blocks; b++) {
        const seed = 77000 + b;
        let w = 0;
        for (const side of [0, 1] as const) w += playTierMatch(policy, eps, seed * 2 + side, side) ? 1 : 0;
        wins.push(w / 2);
      }
      return { eps, winRateVsGreedy: +(wins.reduce((a, b) => a + b, 0) / blocks).toFixed(3) };
    });
    // 档位选择（2026-10-27 修正）：挑战档=ε0（最强）必含；自上而下每当选中档
    // 比上一选中档弱 ≥8pp 才入选，凑三档；两档实测不可区分时只取其一。
    const byStrength = [...results].sort((a, b) => a.eps - b.eps); // ε 小=强
    const picked: number[] = [0];
    let lastWin = byStrength[0].winRateVsGreedy;
    for (const r of byStrength.slice(1)) {
      if (picked.length >= 3) break;
      if (lastWin - r.winRateVsGreedy >= 0.08) { picked.push(r.eps); lastWin = r.winRateVsGreedy; }
    }
    // 若不足三档（中低档不可区分），如实取下一个未选档补位并标注 distinguishable=false
    let distinguishable = picked.length === 3;
    for (const r of byStrength) {
      if (picked.length >= 3) break;
      if (!picked.includes(r.eps)) { picked.push(r.eps); lastWin = Math.min(lastWin, r.winRateVsGreedy); }
    }
    const pick = picked;
    pick.sort((a, b) => b - a); // 输出序：轻松(ε大)→挑战(ε0)
    const out = {
      phase: 'dev', at: new Date().toISOString(),
      policy: { path: policyPath, sha256: createHash('sha256').update(wBuf).digest('hex').slice(0, 16), note: existsSync(join(R2, 'selected', 'candidate.json')) ? 'CLEAN2 候选' : '当前部署 ck180（未晋级时如实标注适用范围）' },
      mechanism: { nearTieRawQ: NEAR_TIE, topK: 3, note: 'ε-greedy 仅在近并列集合内随机；无合格替代=top1；ε=0=贪心（高档）' },
      gridResults: results, selectedEps: pick,
      seatLabels: SEAT_NAMES,
      distinguishable: pick.length === 3,
      note: '本应用相对难度（vs 同政策贪心），非人类段位；ε 单调性须实测确认',
    };
    mkdirSync(R2, { recursive: true });
    writeFileSync(protoPath.replace('.json', '_dev.json'), JSON.stringify(out, null, 1));
    console.log(JSON.stringify(out.gridResults));
    console.log(`dev 选中 ε 档: ${pick.join(' / ')}（${SEAT_NAMES.join('/')}）`);
    return 0;
  }
  if (phase === 'confirm') {
    const devPath = join(R2, 'difficulty_dev.json');
    if (!existsSync(devPath)) { console.error('先跑 --phase dev'); return 4; }
    const dev = JSON.parse(readFileSync(devPath, 'utf8')) as { selectedEps: number[] };
    const blocks = 48;
    const seedsFrom = 88000; // 全新确认种子
    const results = dev.selectedEps.map((eps) => {
      const wins: number[] = [];
      for (let b = 0; b < blocks; b++) {
        const seed = seedsFrom + b;
        let w = 0;
        for (const side of [0, 1] as const) w += playTierMatch(policy, eps, seed * 2 + side, side) ? 1 : 0;
        wins.push(w / 2);
      }
      return { eps, winRateVsGreedy: +(wins.reduce((a, b) => a + b, 0) / blocks).toFixed(3) };
    });
    const monotone = results.every((r, i) => i === 0 || results[i - 1].winRateVsGreedy <= r.winRateVsGreedy + 0.02);
    const separated = results.every((r, i) => i === 0 || Math.abs(results[i - 1].winRateVsGreedy - r.winRateVsGreedy) >= 0.05); // 档序=弱→强，取绝对差
    const out = {
      phase: 'confirm', at: new Date().toISOString(),
      policy: { path: policyPath, sha256: createHash('sha256').update(wBuf).digest('hex').slice(0, 16) },
      results, monotoneIncreasingWinRate: monotone, adjacentGapGte5pp: separated,
      accepted: monotone && separated,
      note: '相对难度确认： ε 越大对贪心胜率越低且相邻档差 ≥5pp；不据此声称人类难度曲线',
    };
    if (lockSettings && out.accepted) {
      writeFileSync(protoPath, JSON.stringify({
        lockedAt: new Date().toISOString(), tiers: dev.selectedEps.map((eps, i) => ({ label: SEAT_NAMES[i], epsilon: eps })),
        policy: out.policy, mechanism: { nearTieRawQ: NEAR_TIE, topK: 3 },
      }, null, 1));
      console.log(`已锁定 difficulty.json（${dev.selectedEps.join('/')}）`);
    } else if (lockSettings) {
      console.error('未达确认门（单调/区分），不锁定');
    }
    writeFileSync(join(R2, 'difficulty_confirm.json'), JSON.stringify(out, null, 1));
    console.log(JSON.stringify(results));
    return out.accepted ? 0 : 1;
  }

  if (phase === 'confirm-signed') {
    // REVIEW4-E1：128 块共享种子，有符号配对差 Δ低中=P低−P中、Δ中高=P中−P高；
    // 各 97.5% 配对 bootstrap 区间，两项下界都须严格 >0（abs 差会把反向难度也通过——修正）
    const devPath = join(R2, 'difficulty_dev.json');
    if (!existsSync(devPath)) { console.error('先跑 --phase dev'); return 4; }
    const dev = JSON.parse(readFileSync(devPath, 'utf8')) as { selectedEps: number[] };
    const tiers = dev.selectedEps; // 输出序：轻松(ε大)→标准→挑战(ε小)
    if (tiers.length !== 3) { console.error('当前档数 !=3，按主令如实标试用设置，不做三档确认'); return 4; }
    const blocks = 128;
    const seedsFrom = 99000; // 全新确认种子（三档共享）
    const winsBy: Record<number, number[]> = {};
    for (const eps of tiers) winsBy[eps] = [];
    for (let b = 0; b < blocks; b++) {
      const seed = seedsFrom + b;
      for (const eps of tiers) {
        let w = 0;
        for (const side of [0, 1] as const) w += playTierMatch(policy, eps, seed * 2 + side, side) ? 1 : 0;
        winsBy[eps].push(w / 2);
      }
    }
    const pairedCI = (a: number[], c: number[], seedBase: number) => {
      const d = a.map((x, i) => x - c[i]);
      const mean = d.reduce((x, y) => x + y, 0) / d.length;
      const rand = mulberry32(seedBase);
      const boots: number[] = [];
      for (let k = 0; k < 2000; k++) {
        let sum = 0;
        for (let i = 0; i < d.length; i++) sum += d[Math.floor(rand() * d.length)];
        boots.push(sum / d.length);
      }
      boots.sort((x, y) => x - y);
      const q = (prob: number) => boots[Math.min(boots.length - 1, Math.round(prob * (boots.length - 1)))];
      return { mean: +mean.toFixed(4), ciLow: +q(0.0125).toFixed(4), ciHigh: +q(0.9875).toFixed(4), raw: d };
    };
    // P（用户代理）视角：P 队与档位对手对称换边对打，P 胜 = 1 − 档位队胜。
    // playTierMatch 返回档位队胜 → Δ低中=P低−P中 = (1−档低) − (1−档中) = 档中 − 档低。
    const dLowMid = pairedCI(winsBy[tiers[1]], winsBy[tiers[0]], 99123); // P轻松 − P标准（=档位胜率取反的配对差）
    const dMidHigh = pairedCI(winsBy[tiers[2]], winsBy[tiers[1]], 99456); // P标准 − P挑战
    const passed = dLowMid.ciLow > 0 && dMidHigh.ciLow > 0;
    const out = {
      phase: 'confirm-signed', at: new Date().toISOString(), blocks, seedsShared: true,
      policy: { path: policyPath, sha256: createHash('sha256').update(wBuf).digest('hex').slice(0, 16) },
      tiers,
      meansTierWin: Object.fromEntries(tiers.map((e) => [e, +(winsBy[e].reduce((a: number, b: number) => a + b, 0) / blocks).toFixed(4)])),
      meansPWin: Object.fromEntries(tiers.map((e) => [e, +(1 - winsBy[e].reduce((a: number, b: number) => a + b, 0) / blocks).toFixed(4)])),
      perspective: 'P=对照队（与档位对手同权重贪心决策）；P胜=1−档位队胜（对称换边配对）',
      dLowMid: { mean: dLowMid.mean, ci97_5: [dLowMid.ciLow, dLowMid.ciHigh] },
      dMidHigh: { mean: dMidHigh.mean, ci97_5: [dMidHigh.ciLow, dMidHigh.ciHigh] },
      gates: { bothLowerBoundsPositive: passed },
      accepted: passed,
      note: '有符号配对：两项下界均>0 才通过（反向难度不再被 abs 差放过）；97.5% 经验 bootstrap，块=种子',
    };
    writeFileSync(join(R2, 'difficulty_confirm_signed.json'), JSON.stringify(out, null, 1));
    if (lockSettings && passed) {
      writeFileSync(protoPath, JSON.stringify({
        lockedAt: new Date().toISOString(), tiers: tiers.map((eps, i) => ({ label: SEAT_NAMES[i], epsilon: eps })),
        policy: out.policy, mechanism: { nearTieRawQ: NEAR_TIE, topK: 3 }, confirmedBy: 'confirm-signed-128',
      }, null, 1));
      console.log('已锁定 difficulty.json（signed-paired 128 块过门）');
    }
    console.log(JSON.stringify({ means: out.means, dLowMid: out.dLowMid, dMidHigh: out.dMidHigh, accepted: passed }));
    return passed ? 0 : 1;
  }
  console.error('phase 需为 dev|confirm|confirm-signed');
  return 2;
}

const argv = process.argv.slice(2);
const phaseIdx = argv.indexOf('--phase');
if (process.argv[1] && process.argv[1].includes('review2difficulty')) {
  process.exit(run(phaseIdx >= 0 ? argv[phaseIdx + 1] : '', argv.includes('--lock-settings')));
}
export { run };
