/**
 * lab/src/review4/cand_profile_v3.ts — REVIEW4-A1：候选画像 v3（cand-suit-v3）。
 *   npx tsx lab/src/review4/cand_profile_v3.ts [--states 1000] [--small-hand-cases 200]
 * Part A 满手牌画像：真实决策点候选数分布（v3 花色展开后）+ 枚举耗时。
 * Part B 小手牌独立穷举对照：oracle 键 = 独立计算的
 *   「物理牌 花色+点数 多重集（万能牌带代入标注）| 声明」——
 *   不调用被测 resourceRoles（REVIEW4-A1 要求）；classify 是共享牌型判定器，
 *   与候选生成不同层，其局限如实写明（oracle 的合法性判定依赖 classify 的解释完备性）。
 * 输出 lab/review2/review4/audit/candidate_profile_v3.json。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMove, beats, buildDeck, canPass, classify, createMatch, DEFAULT_RULES, isWild,
  legalCombos, makeLevelCtx, rankOrder, RNG, startGame, type Card, type Combo, type GameState,
} from '@gd/engine';
import { createAI, guardMove, mulberry32 } from '@gd/ai';
import { dedupCandidates, CANDIDATE_VERSION } from '@gd/ai';

const ROOT = join(import.meta.dirname, '..', '..', '..');

function parseArgs(): { states: number; smallHandCases: number } {
  const argv = process.argv.slice(2);
  const out = { states: 1000, smallHandCases: 200 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--states') out.states = Number(argv[++i]);
    else if (argv[i] === '--small-hand-cases') out.smallHandCases = Number(argv[++i]);
    else { console.error(`未知参数 ${argv[i]}`); process.exit(2); }
  }
  return out;
}

/** 独立 oracle 键：不调用被测 resourceRoles。
 * 身份 = 物理牌 花色+点数 多重集 + 声明（kind|mainRank|length|pairRanks）。
 * 万能代入角色由「声明+物理牌」唯一推导（如顺子 C4,C5,H11,H3,H6 声明 3-7 → H11 必为 7），
 * 故不把代入标注放进键——这也消除了 classify 对万能单张不带 wildAs、只回最强解释
 * 的共享层标注差异（同一物理动作两侧键一致）。 */
export function indepKeyV3(cards: Card[], combo: Combo): string {
  const phys = cards.map((c) => `${c.suit}${c.rank}`).sort().join(',');
  return `${phys}|${combo.kind}|${combo.mainRank}|${combo.length}|${combo.pairRanks.join(',')}`;
}

/** 子集枚举（独立于被测 legalCombos）：2^n 子集 × classify 全解释 × beats 过滤 */
function independentEnum(hand: Card[], toBeat: Combo | null, ctx: GameState['ctx'], rules: typeof DEFAULT_RULES): Map<string, Combo> {
  const out = new Map<string, Combo>();
  const n = hand.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset: Card[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(hand[i]);
    for (const c of classify(subset, ctx, rules)) {
      if (toBeat && !beats(c, toBeat)) continue;
      const k = indepKeyV3(subset, c);
      if (!out.has(k)) out.set(k, c);
    }
  }
  return out;
}

function quantiles(sorted: number[]): Record<string, number> {
  if (sorted.length === 0) return { n: 0 };
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))];
  return { n: sorted.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1], mean: +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2) };
}

// ---------- Part A：满手牌画像 ----------
function profileStates(target: number) {
  const rand = mulberry32(20261028);
  const counts: number[] = [];
  const leadCounts: number[] = [];
  const followCounts: number[] = [];
  let sameDeclDiffResource = 0;
  let enumMs = 0;
  let sampled = 0;
  let matches = 0;
  while (sampled < target && matches < 400) {
    matches += 1;
    const rng = new RNG((rand() * 0xffffffff) | 0);
    const match = createMatch({ ...DEFAULT_RULES }, rng.next() * 0xffffffff);
    const state = startGame(match);
    const ais = [0, 1, 2, 3].map((s) => {
      const a = createAI(s, 1, rng.next() * 0xffffffff);
      a.reset(state, match.opts);
      return a;
    });
    let guard = 0;
    while (!state.over && guard++ < 2000 && sampled < target) {
      const turn = state.turn;
      const toBeat = state.lastCombo;
      const t0 = Date.now();
      const cands = dedupCandidates(legalCombos(state), canPass(state));
      enumMs += Date.now() - t0;
      if (cands.length > 0) {
        counts.push(cands.length);
        (toBeat ? followCounts : leadCounts).push(cands.length);
        const byDecl = new Map<string, Set<string>>();
        for (const c of cands) {
          if (!c.combo) continue;
          const decl = `${c.combo.kind}:${c.combo.mainRank}:${c.combo.length}:${c.combo.pairRanks.join(',')}`;
          const vk = c.combo.cards.map((x) => `${x.suit}${x.rank}`).sort().join(',');
          if (!byDecl.has(decl)) byDecl.set(decl, new Set());
          byDecl.get(decl)!.add(vk);
        }
        for (const s of byDecl.values()) if (s.size > 1) sameDeclDiffResource += 1;
        sampled += 1;
      }
      const mv = guardMove(state, ais[turn].decide(state) as never);
      const events = applyMove(state, mv as never);
      ais.forEach((a) => a.observe(events, toBeat));
    }
  }
  return {
    states: sampled, matches,
    candidateCount: quantiles([...counts].sort((a, b) => a - b)),
    leadCandidateCount: quantiles([...leadCounts].sort((a, b) => a - b)),
    followCandidateCount: quantiles([...followCounts].sort((a, b) => a - b)),
    sameDeclDiffResourceGroups: sameDeclDiffResource,
    dedupPlusLegalMsTotal: enumMs,
    perStateMs: +(enumMs / Math.max(1, sampled)).toFixed(3),
    candidateVersion: CANDIDATE_VERSION,
  };
}

// ---------- Part B：小手牌独立穷举对照 ----------
function smallHandCompare(cases: number) {
  const rand = mulberry32(0xc0ffee);
  const deck = buildDeck();
  const results: Array<{
    case: number; handSize: number; mode: 'lead' | 'follow'; levelMode: string;
    indep: number; engine: number; missing: string[]; extra: string[]; applyVerified: boolean;
  }> = [];
  let totalMissing = 0, totalExtra = 0, applyFail = 0;

  for (let ci = 0; ci < cases; ci++) {
    const levels: [number, number] = [2 + Math.floor(rand() * 13), 2 + Math.floor(rand() * 13)];
    const rng = new RNG((rand() * 0xffffffff) | 0);
    const useBoth = ci % 5 === 4; // 1/5 用历史 both 口径对照
    const match = createMatch({ ...DEFAULT_RULES, levelMode: useBoth ? 'both' : 'stage' } as never, rng.next() * 0xffffffff);
    match.levels = levels;
    const state = startGame(match);
    const pool = [...deck];
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    const handSize = 3 + Math.floor(rand() * 6);
    const hand = pool.slice(0, handSize).sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
    const rest = pool.slice(handSize);
    let toBeat: Combo | null = null;
    if (ci % 2 === 1) {
      for (let tries = 0; tries < 20 && !toBeat; tries++) {
        const size = 1 + Math.floor(rand() * 5);
        const subset = rest.slice(tries * 3, tries * 3 + size);
        if (subset.length < size) break;
        const variants = classify(subset, state.ctx, match.opts);
        if (variants.length > 0) toBeat = variants[Math.floor(rand() * variants.length)];
      }
    }
    state.hands = [hand, [], [], []];
    state.turn = 0; state.leader = 0;
    state.lastCombo = toBeat;
    state.lastPlayer = toBeat ? 1 : 0;
    state.passCount = 0;
    state.finished = []; state.over = false; state.result = null;
    state.trickPlays = [];

    const indep = independentEnum(hand, toBeat, state.ctx, match.opts);
    const engineCands = dedupCandidates(legalCombos(state), canPass(state));
    const engineKeys = new Set<string>();
    for (const c of engineCands) {
      if (!c.combo) continue;
      engineKeys.add(indepKeyV3(c.combo.cards, c.combo));
    }
    const missing: string[] = [];
    for (const [k] of indep) if (!engineKeys.has(k)) missing.push(k);
    const extra: string[] = [];
    for (const k of engineKeys) if (!indep.has(k)) extra.push(k);
    totalMissing += missing.length; totalExtra += extra.length;

    let applyVerified = true;
    for (const c of engineCands) {
      if (!c.combo) continue;
      const sim = {
        ...state, hands: state.hands.map((h) => [...h]), trickPlays: [], finished: [...state.finished],
      } as GameState;
      try {
        applyMove(sim, { pass: false, combo: c.combo });
        if (sim.hands[0].length !== hand.length - c.combo.cards.length) applyVerified = false;
      } catch { applyVerified = false; }
    }
    if (!applyVerified) applyFail += 1;

    results.push({
      case: ci, handSize, mode: toBeat ? 'follow' : 'lead', levelMode: useBoth ? 'both' : 'stage',
      levels, stageTeam: state.stageTeam,
      handCards: hand.map((c) => `${c.suit}${c.rank}#${c.id}`),
      indep: indep.size + (canPass(state) ? 1 : 0), engine: engineCands.length,
      missing, extra, applyVerified,
    });
  }
  return {
    cases: results.length,
    casesWithMissing: results.filter((r) => r.missing.length > 0).length,
    casesWithExtra: results.filter((r) => r.extra.length > 0).length,
    totalMissingKeys: totalMissing, totalExtraKeys: totalExtra,
    applyVerifiedFailCases: applyFail,
    oracleKey: '独立物理多重集（万能代入标注）+声明；不调用被测 resourceRoles',
    classifySharedLimitation: 'oracle 合法性判定依赖共享 classify 的解释完备性；候选生成层错误会被抓到，classify 自身的解释盲区两层共有',
    details: [...results].sort((a, b) => (b.missing.length + b.extra.length) - (a.missing.length + a.extra.length)).slice(0, 10),
  };
}

const args = parseArgs();
if (process.argv[1] && process.argv[1].includes('cand_profile_v3')) {
  const partA = profileStates(args.states);
  console.log('Part A 满手牌画像:', JSON.stringify(partA.candidateCount), 'lead p95', partA.leadCandidateCount.p95, 'follow p95', partA.followCandidateCount.p95, 'perStateMs', partA.perStateMs);
  const partB = smallHandCompare(args.smallHandCases);
  console.log('Part B 小手牌对照:', JSON.stringify({ cases: partB.cases, casesWithMissing: partB.casesWithMissing, casesWithExtra: partB.casesWithExtra, totalMissingKeys: partB.totalMissingKeys, totalExtraKeys: partB.totalExtraKeys, applyVerifiedFailCases: partB.applyVerifiedFailCases }));
  const outDir = join(ROOT, 'lab', 'review2', 'review4', 'audit');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'candidate_profile_v3.json'), JSON.stringify({
    at: new Date().toISOString(), candidateVersion: CANDIDATE_VERSION, partA, partB,
  }, null, 1));
  console.log(`→ lab/review2/review4/audit/candidate_profile_v3.json`);
}
void isWild; void makeLevelCtx; void rankOrder;
