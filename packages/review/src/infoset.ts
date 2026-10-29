/**
 * packages/review/src/infoset.ts — D4（REVIEW4-EXEC §5.4）：有限信息集比较 v2。
 * 对一个决策构造 N 份暗牌分配：自家手牌/全部已出牌/公开张数/已知归属（record.tributes）
 * 为硬约束，其余未知牌均匀分配；同一份世界配对推演实际与最多两个替代。
 * 方向统一：d_i = g_i(替代) − g_i(实际)，正数支持替代、负数支持实际；
 * 实用门：lowerCI(d) > 0.25 才条件支持替代；upperCI(d) < −0.25 才条件支持实际；
 * 一个替代 95% 双侧、两个替代各 97.5%；零方差退化不给方向结论。
 * 种子由「公开/本人可见 informationSetHash + decisionId 稳定部分 + samplerVersion
 * + worldIndex」决定——换掉暗牌或未来事件不改变种子与根建议（模拟结果可不同）。
 * 主续打政策由调用方注入（同规则/配套已验证强 NN；heuristic:mid 仅限敏感性对照）。
 */
import { applyMove, buildDeck, describeCombo, RNG, teamOf, type Card, type Combo, type GameRecord, type GameState } from '@gd/engine';
import { scoreCandidates, mulberry32, PlayMemory } from '@gd/ai';
import { memoryBefore, stateBefore } from './replay';
import { cloneForSim, simulateWithPolicy } from './counterfactual';

export const INFOSET_SAMPLER_VERSION = 'infoset-v2-review4';
export const INFOSET_SENSITIVITY_POLICY = 'heuristic:mid(分析口径)/noise=0';

export interface InfosetRootInput {
  label: 'actual' | 'alt_heuristic' | 'alt_model';
  actionId: string;
  combo: Combo | null; // null = 过牌
  sourceId: string;
}

// 续打政策注入（D4）：每个模拟（世界×根分支）新建四席玩家，世界/分支间状态隔离
import type { ContinuationSpec } from './counterfactual';

export interface WorldOutcome {
  worldIndex: number;
  worldSeed: number;
  worldHash: string;
  knownConstraintOk: boolean;
  gActual: number;
  gAlternatives: number[];
  completed: boolean;
  steps: number;
}

export interface PairedStat {
  vsActionId: string;
  confidence: 0.95 | 0.975;
  n: number;
  meanD: number;             // d=alt−actual
  meanGActual: number;
  meanGAlt: number;
  ciLow: number; ciHigh: number;
  support: 'support_alt' | 'support_actual' | 'no_direction' | 'degenerate';
  favorAlt: number; favorActual: number; tie: number;
  gateThreshold: 0.25;
  bootstrapReplicates: number;
}

export interface InfosetCompare {
  moveNo: number;
  decisionId: string;
  informationSetHash: string;
  samplerVersion: string;
  continuationPolicyId: string;
  roots: Array<{ label: InfosetRootInput['label']; actionId: string; text: string; gMean: number; truncated: number }>;
  samples: number;              // 计划世界数（固定 64，不补抽）
  worldsCompleted: number;
  worlds: WorldOutcome[];
  paired: PairedStat[];
  rejected: number;             // 分配尝试失败数（保留原因，不补抽凑数）
  assumptionNote: string;
  degradation?: 'missing_tribute_info';
}

export interface InfosetOptions {
  samples?: number;             // 默认 64
  maxMoves?: number;            // 单分支推演步数上限（默认 1200）
  continuation: ContinuationSpec;
  decisionIdStable?: string;    // decisionId 稳定公共部分（不含完整 recordHash）
}

/** 双 lane FNV（与 decisionReview.fnvId 同构，避免循环 import 各自实现） */
function fnv(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c + i) & 0xff), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** 本副名次分 g：胜方 +(双上3/三游同队2/否则1)，负方取负 */
function gOf(finishOrder: number[], winnerTeam: 0 | 1, myTeam: 0 | 1): number {
  const doubleUp = teamOf(finishOrder[0]) === teamOf(finishOrder[1]);
  const thirdIsWinnerTeam = teamOf(finishOrder[2]) === winnerTeam;
  const up = doubleUp ? 3 : thirdIsWinnerTeam ? 2 : 1;
  return winnerTeam === myTeam ? up : -up;
}

function pairedBootstrapCI(d: number[], confidence: 0.95 | 0.975, seed: number): { ciLow: number; ciHigh: number } {
  const n = d.length;
  const rand = mulberry32(seed);
  const alpha = confidence === 0.95 ? 0.025 : 0.0125;
  const boots: number[] = [];
  for (let b = 0; b < 2000; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[Math.floor(rand() * n)];
    boots.push(s / n);
  }
  boots.sort((a, b) => a - b);
  const q = (p: number) => boots[Math.min(boots.length - 1, Math.round(p * (boots.length - 1)))];
  return { ciLow: q(alpha), ciHigh: q(1 - alpha) };
}

/**
 * 对单个决策做信息集抽样比较。rootActions[0] 必须是实际动作。
 * 结构性不守恒直接抛错（实现错误非抽样噪声）；分配失败保留原因且不补抽。
 */
export function runInfosetCompare(
  record: GameRecord,
  moveNo: number,
  rootActions: InfosetRootInput[],
  opts: InfosetOptions,
): InfosetCompare {
  const samples = opts.samples ?? 64;
  const maxMoves = opts.maxMoves ?? 1200;
  const seat = record.humanSeat ?? 0;
  const state = stateBefore(record, moveNo);
  const myTeam = teamOf(seat);
  const decisionId = opts.decisionIdStable ?? `${record.id ?? 'rec'}#m${moveNo}`;

  // 可见牌：自家手牌 + 本手之前已出牌
  const playedIds = new Set<number>();
  for (const m of record.moves) {
    if (m.moveNo >= moveNo) break;
    for (const c of m.cards ?? []) playedIds.add(c.id);
  }
  const myIds = new Set(state.hands[seat].map((c) => c.id));

  // 已知归属（record.tributes；旧记录无字段=缺失→降级注记，不伪造约束）
  const tributes = record.tributes ?? [];
  const knownOwner = new Map<number, number>(); // cardId → seat（未打出前有效）
  for (const t of tributes) {
    if (!playedIds.has(t.card.id)) knownOwner.set(t.card.id, t.to);
  }
  const missingTributeInfo = record.tributes === undefined
    && (record.ruleOpts.levelMode ?? 'both') === 'stage';

  const pool = buildDeck().filter((c) => !myIds.has(c.id) && !playedIds.has(c.id) && !knownOwner.has(c.id));
  const others = [0, 1, 2, 3].filter((i) => i !== seat);
  // 各家需求 = 剩张 − 已知归属且未出的牌
  const knownBySeat = new Map<number, Card[]>();
  for (const o of others) knownBySeat.set(o, []);
  for (const [cid, own] of knownOwner) {
    const card = buildDeck().find((c) => c.id === cid)!;
    knownBySeat.get(own)!.push(card);
  }
  const needBySeat = new Map<number, number>();
  for (const o of others) needBySeat.set(o, state.hands[o].length - (knownBySeat.get(o)?.length ?? 0));
  const needTotal = [...needBySeat.values()].reduce((a, b) => a + b, 0);
  if (pool.length !== needTotal) {
    throw new Error(`暗牌池不守恒：pool=${pool.length} 需求=${needTotal}（move ${moveNo}）`);
  }

  // informationSetHash：只用当时可见信息（换暗牌/未来事件不变）
  const infoHash = fnv([
    ...state.hands[seat].map((c) => c.id).sort((a, b) => a - b),
    ...[...playedIds].sort((a, b) => a - b),
    others.map((o) => state.hands[o].length).join(','),
    tributes.map((t) => `${t.from}>${t.to}:${t.card.id}`).sort().join(','),
    state.lastCombo ? state.lastCombo.cards.map((c) => c.id).sort().join('.') : 'lead',
  ].join('|'));

  const worldSeed = (i: number): number => {
    let h = 0x811c9dc5;
    const s = `${infoHash}#${decisionId}#${INFOSET_SAMPLER_VERSION}#${i}`;
    for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 0x01000193) >>> 0;
    return h >>> 0;
  };

  const texts = rootActions.map((r) => (r.combo === null ? '不出' : describeCombo(r.combo)));
  const worlds: WorldOutcome[] = [];
  let rejected = 0;

  for (let i = 0; i < samples; i++) {
    const seed = worldSeed(i);
    const rand = mulberry32(seed);
    const p = [...pool];
    for (let k = p.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [p[k], p[j]] = [p[j], p[k]];
    }
    let off = 0;
    const dealt = new Map<number, Card[]>();
    for (const o of others) {
      const n = needBySeat.get(o)!;
      dealt.set(o, [...(knownBySeat.get(o) ?? []), ...p.slice(off, off + n)]);
      off += n;
    }
    if (off !== p.length) { rejected += 1; continue; }

    const gActual = gByRoot(0);
    const gAlts = rootActions.slice(1).map((_, ri) => gByRoot(ri + 1));
    worlds.push({
      worldIndex: i, worldSeed: seed, worldHash: fnv(`${seed}:${[...dealt.entries()].map(([o, cs]) => `${o}:${cs.map((c) => c.id).sort((a, b) => a - b).join('.')}`).join('|')}`),
      knownConstraintOk: true,
      gActual: gActual.g, gAlternatives: gAlts.map((x) => x.g),
      completed: gActual.completed && gAlts.every((x) => x.completed),
      steps: Math.max(gActual.steps, ...gAlts.map((x) => x.steps)),
    });
    continue;

    function gByRoot(ri: number): { g: number; completed: boolean; steps: number } {
      const root = rootActions[ri];
      const sim = cloneForSim(state as GameState);
      for (const [o, cards] of dealt) sim.hands[o] = [...cards];
      applyMove(sim, root.combo === null ? { pass: true } : { pass: false, combo: root.combo });
      // 每个根分支新建四席玩家（世界×分支隔离）
      const res = simulateWithPolicy(sim, opts.continuation, { maxMoves, rng: new RNG(seed ^ 0x5eed) });
      return { g: gOf(res.finishOrder, res.winnerTeam, myTeam), completed: res.moves < maxMoves, steps: res.moves };
    }
  }

  const n = worlds.length;
  const rootsOut = rootActions.map((root, ri) => {
    const gs = worlds.map((w) => (ri === 0 ? w.gActual : w.gAlternatives[ri - 1]));
    return {
      label: root.label, actionId: root.actionId, text: texts[ri],
      gMean: +(gs.reduce((a, b) => a + b, 0) / Math.max(1, n)).toFixed(4),
      truncated: worlds.filter((w) => (ri === 0 ? !w.completed : w.steps >= 1200)).length,
    };
  });

  const paired: PairedStat[] = rootActions.slice(1).map((root, ai) => {
    const confidence: 0.95 | 0.975 = rootActions.length === 2 ? 0.95 : 0.975;
    const d = worlds.map((w) => w.gAlternatives[ai] - w.gActual); // d=alt−actual
    const meanD = d.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const allEqual = d.every((x) => x === d[0]);
    const { ciLow, ciHigh } = allEqual
      ? { ciLow: meanD, ciHigh: meanD }
      : pairedBootstrapCI(d, confidence, worldSeed(samples + ai));
    let support: PairedStat['support'];
    if (allEqual) support = 'degenerate';
    else if (ciLow > 0.25) support = 'support_alt';
    else if (ciHigh < -0.25) support = 'support_actual';
    else support = 'no_direction';
    return {
      vsActionId: root.actionId, confidence, n,
      meanD: +meanD.toFixed(4),
      meanGActual: +(worlds.reduce((a, w) => a + w.gActual, 0) / Math.max(1, n)).toFixed(4),
      meanGAlt: +(worlds.reduce((a, w) => a + w.gAlternatives[ai], 0) / Math.max(1, n)).toFixed(4),
      ciLow: +ciLow.toFixed(4), ciHigh: +ciHigh.toFixed(4),
      support, favorAlt: d.filter((x) => x > 0).length, favorActual: d.filter((x) => x < 0).length, tie: d.filter((x) => x === 0).length,
      gateThreshold: 0.25, bootstrapReplicates: 2000,
    };
  });

  return {
    moveNo, decisionId, informationSetHash: infoHash, samplerVersion: INFOSET_SAMPLER_VERSION,
    continuationPolicyId: opts.continuation.policyId,
    roots: rootsOut,
    samples, worldsCompleted: n, worlds, paired, rejected,
    assumptionNote: `均匀可行分配假设（非真实人类暗牌分布）；硬约束=自家手牌/全部已出牌/各家公开剩张${tributes.length > 0 ? '/贡还已知归属' : ''}；g=本副名次分（±1/2/3），不是整场获胜概率；d=替代−实际，CI 为经验 bootstrap（B=2000）数值敏感性，非精确覆盖率；实用门 lowerCI>0.25 支持替代 / upperCI<−0.25 支持实际`,
    degradation: missingTributeInfo ? 'missing_tribute_info' : undefined,
  };
}

/** 默认根动作集合：实际 + 启发式首选 +（可选）模型首选；同动作去重（物理 id 级） */
export function defaultRoots(
  record: GameRecord,
  moveNo: number,
  actual: { actionId: string; combo: Combo | null },
  modelTop?: { actionId: string; combo: Combo | null } | null,
): InfosetRootInput[] {
  const state = stateBefore(record, moveNo);
  const seat = record.humanSeat ?? 0;
  const memory: PlayMemory = memoryBefore(record, moveNo);
  const scored = scoreCandidates({
    state, seat,
    caps: { memory: true, inference: false, cooperation: true, planning: true, noise: 0, rolloutIters: 0 },
    memory, rand: () => 0,
  });
  const heur = scored[0].move;
  const heurPass = heur.pass;
  const heurCombo: Combo | null = heurPass ? null : heur.combo;
  const roots: InfosetRootInput[] = [
    { label: 'actual', actionId: actual.actionId, combo: actual.combo, sourceId: '对局记录' },
  ];
  const heurId = heurPass || !heurCombo ? 'pass#' : comboIdentity(heurCombo);
  const actualId = actual.combo === null ? 'pass#' : comboIdentity(actual.combo);
  if (heurId !== actualId && roots.length < 3) {
    roots.push({ label: 'alt_heuristic', actionId: heurId, combo: heurCombo, sourceId: 'heuristic:mid(分析口径)' });
  }
  if (modelTop && modelTop.combo !== undefined) {
    const mId = modelTop.combo === null ? 'pass#' : comboIdentity(modelTop.combo);
    if (mId !== actualId && !roots.some((r) => r.actionId === mId) && roots.length < 3) {
      roots.push({ label: 'alt_model', actionId: mId, combo: modelTop.combo, sourceId: 'model' });
    }
  }
  return roots;
}

function comboIdentity(c: Combo): string {
  return `${c.kind}:${c.mainRank}:${c.length}:${c.size}:${c.pairRanks.join(',')}`;
}
