/**
 * lab/review5/probe_deploy_identity.ts — REVIEW5 T0.1：部署完整身份记录。
 * 缺陷背景（REVIEW4 审计 E07）：NeuralPlayer 不传 candidateCompat → 默认 cand-suit-v3
 * 候选配旧 v2 训练权重；网页一旦用该源码重建即发生"旧 modelVersion + 新候选"混搭。
 * 本探针：
 *  1) 记录产品实际加载链的完整身份（权重 SHA/modelVersion/encoder/candidate/规则/难度/bundle hash）；
 *  2) 验证修复后 createNeuralAI（frozenChampion 绑定=cand-v2+legacy pass）与显式同配
 *     NeuralDecider 决策逐位一致；
 *  3) 负例：v3 候选在真实局面下产生不同决策（证明绑定必要——重建即变行为）；
 *  4) 构建 web bundle 并记录 hash（浏览器实际运行产物身份）。
 * 产物：lab/review5/artifacts/t01-deploy-identity.json + packages/web/public/ai/deployed-identity.json
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createMatch, DEFAULT_RULES, startGame, applyMove, legalCombos, type GameState } from '@gd/engine';
import { MLP, NeuralDecider, createNeuralAI, FROZEN_CHAMPION_IDENTITY, NEURAL_MODEL_VERSION, NEURAL_TIERS, CANDIDATE_VERSION } from '@gd/ai';

const REPO = join(import.meta.dirname, '..', '..');
const ART = join(import.meta.dirname, 'artifacts');
const shaFile = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

function hashDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  const walk = (d: string, base = ''): void => {
    for (const f of readdirSync(d)) {
      if (f === '.DS_Store') continue;
      const p = join(d, f);
      const rel = base ? `${base}/${f}` : f;
      if (statSync(p).isDirectory()) walk(p, rel);
      else out[rel] = shaFile(p);
    }
  };
  walk(dir);
  return out;
}

/** 收集真实局面（用于 2/3 的决策对比） */
function realStates(n: number): Array<{ state: GameState }> {
  const out: Array<{ state: GameState }> = [];
  let match = createMatch({ ...DEFAULT_RULES }, 20261028);
  let state = startGame(match);
  let guard = 0;
  while (out.length < n && guard++ < 3000) {
    if (state.over || match.winner != null) { match = createMatch({ ...DEFAULT_RULES }, 20261028 + out.length); state = startGame(match); continue; }
    if (state.turn === 1) out.push({
      state: {
        ...state,
        hands: state.hands.map((h) => [...h]),
        finished: [...state.finished],
        trickPlays: state.trickPlays.map((p) => ({ ...p })),
      } as GameState,
    });
    const t = state.turn;
    const c = legalCombos(state)[0];
    applyMove(state, c ? { pass: false, combo: c } : { pass: true });
  }
  return out;
}

function main(): void {
  mkdirSync(ART, { recursive: true });
  const weightsPath = join(REPO, 'packages', 'web', 'public', 'ai', 'clean2.f32');
  const weightsSha = shaFile(weightsPath);
  const buf = readFileSync(weightsPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  // 2) 修复后产品路径 vs 显式同配 NeuralDecider：决策一致
  const states = realStates(40);
  let agreeBound = 0, differV3 = 0;
  for (const { state } of states) {
    const player = createNeuralAI(1, ab);
    player.reset(state, DEFAULT_RULES);
    const mvProduct = player.decide(state);
    const m = new MLP(1);
    m.setWeights(new Float32Array(ab));
    const decExplicit = new NeuralDecider(1, m, 0, () => 0, { candidateCompat: 'v2', passEncoding: 'legacy-phys10' });
    const mvExplicit = decExplicit.decide(state).move;
    const sameBound = mvProduct.pass === mvExplicit.pass
      && (mvProduct.pass || mvProduct.combo!.cards.map((c) => c.id).sort().join() === mvExplicit.combo!.cards.map((c) => c.id).sort().join());
    if (sameBound) agreeBound += 1;
    // 3) 负例：v3 候选（修复前 NeuralPlayer 默认）在同一局面给出不同候选集合 → 不同决策
    const decV3 = new NeuralDecider(1, m, 0, () => 0, { passEncoding: 'legacy-phys10' });
    const mvV3 = decV3.decide(state).move;
    const sameAsV3 = mvProduct.pass === mvV3.pass
      && (mvProduct.pass || mvProduct.combo!.cards.map((c) => c.id).sort().join() === mvV3.combo!.cards.map((c) => c.id).sort().join());
    if (!sameAsV3) differV3 += 1;
  }

  // 4) bundle 构建 + hash
  let bundle: Record<string, unknown> = { built: false };
  try {
    execSync('npm run build', { cwd: REPO, timeout: 180000, stdio: 'pipe' });
    const dist = join(REPO, 'packages', 'web', 'dist');
    const files = hashDir(dist);
    bundle = { built: true, distFiles: Object.keys(files).length, indexHtml: files['index.html'] ?? null,
      largestJs: Object.entries(files).filter(([k]) => k.endsWith('.js')).sort((a, b) => a[1] < b[1] ? 1 : -1).slice(0, 3) };
  } catch (e) {
    bundle = { built: false, error: String(e).slice(0, 200) };
  }

  const identity = {
    recordedAt: new Date().toISOString(),
    productLoads: {
      weights: 'packages/web/public/ai/clean2.f32',
      weightsSHA256: weightsSha,
      paramCount: 164865,
      modelVersion: NEURAL_MODEL_VERSION,
      sourceRun: 'lab/review2/runs/clean2-main/ck-7051（与部署文件逐字节一致，见 lab/src/deploy_check.ts）',
      encoderVersion: FROZEN_CHAMPION_IDENTITY.encoderVersion,
      passEncoding: FROZEN_CHAMPION_IDENTITY.passEncoding,
      candidateVersion: FROZEN_CHAMPION_IDENTITY.candidateVersion,
      policyId: FROZEN_CHAMPION_IDENTITY.policyId,
    },
    rules: { defaults: 'DEFAULT_RULES（stage 官方级牌口径）', webOptions: 'App.tsx 规则选项 → MatchController' },
    difficulty: { neuralTiers: NEURAL_TIERS, difficultySource: 'tiered.ts D1 三档（ε 近并列随机）' },
    runtimeCode: { candidateGenerator: CANDIDATE_VERSION, note: 'NeuralPlayer 默认绑定 frozenChampion 包（cand-v2 兼容折叠 + legacy pass 编码）；REVIEW5 T0.1 修复' },
    namedPackages: {
      frozenChampion: 'clean2-ck7051 权重 + cand-dedup-v2 + gd-lab-schema-v1(legacy pass) —— 当前产品',
      U0: '（T6 冻结时生成）clean2 父 + 399 rule-context + pass 迁移 action64 + cand-suit-v3，零新增训练',
      researchCandidates: '（T6/T7 产生）通过开发门并一次性确认后才可替换产品默认',
    },
    bundle,
    verification: {
      productEqualsExplicitBinding: `${agreeBound}/${states.length}`,
      v3CandidatesDifferOnRealStates: `${differV3}/${states.length}（>0 即证明：不绑定时重建包会改变出牌行为）`,
    },
  };
  writeFileSync(join(REPO, 'packages', 'web', 'public', 'ai', 'deployed-identity.json'), JSON.stringify(identity, null, 2));
  writeFileSync(join(ART, 't01-deploy-identity.json'), JSON.stringify({
    ...identity,
    verdict: {
      identityRecorded: true,
      bindingVerified: agreeBound === states.length,
      mixingRiskProven: differV3 > 0,
      bundleBuilt: bundle.built === true,
    },
  }, null, 2));
  console.log(JSON.stringify({
    bindingVerified: agreeBound === states.length,
    v3Differ: differV3,
    bundleBuilt: bundle.built === true,
    weightsSha: weightsSha.slice(0, 16),
  }, null, 1));
}

main();
