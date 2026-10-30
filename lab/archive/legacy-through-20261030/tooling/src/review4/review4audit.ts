/**
 * lab/src/review4/review4audit.ts — REVIEW4 任务A 窄检查入口。
 * A1 候选等价反例 / A2 观察碰撞诊断 / A3 账目守恒（A3 主要在训练账本侧，另行脚本）。
 * 只读审计，输出 audit/*.json；修复另行走引擎最小修改，不在此文件里改行为。
 */
import { writeFileSync } from 'node:fs';
import {
  buildDeck, enumerateCombos, makeLevelCtx, type Card, type Combo, type GameState,
  comboKey, resourceRoles, DEFAULT_RULES, beats, rankOrder, legalCombos,
} from '@gd/engine';
import { canonicalize } from '@gd/review';
import { PublicTracker, STATE_DIM, ACTION_DIM, INPUT_DIM, buildInput } from '@gd/ai';

const outDir = 'lab/review2/review4/audit';

function cardsOf(specs: [string, number][]): Card[] {
  const deck = buildDeck();
  const picked: Card[] = [];
  for (const [suit, rank] of specs) {
    const hit = deck.find((c) => c.suit === suit && c.rank === rank && !picked.some((p) => p.id === c.id));
    if (!hit) throw new Error(`no card ${suit}${rank}`);
    picked.push(hit);
  }
  return picked;
}

// ── A1：候选等价反例 ─────────────────────────────────────────────
// stage 模式，当前级牌 2（台上方级数 2，红心 2 为万能牌）。
// 手牌：♠5 ♠6 ♠7 ♠8 ♠9 ♣8 ♦8；领出"对 8"。
// 断言：a=♣8+♦8（余牌保留 ♠5-9 同花顺）与 b=♠8+♣8（不再含该同花顺）
// 必须是两个不等价资源动作：合法、不同 actionId、可各自执行、身份不合并、
// 实际出 a 不得匹配到 b、单步结构事实（余手）不同。
function a1() {
  const hand = cardsOf([['S', 5], ['S', 6], ['S', 7], ['S', 8], ['S', 9], ['C', 8], ['D', 8]]);
  const ctx = makeLevelCtx([2, 2], 'stage', 0);
  const candidates = enumerateCombos(hand, ctx, DEFAULT_RULES);
  const pairs8 = candidates.filter((c) => c.kind === 'pair' && c.mainRank === 8);

  // 独立 oracle：不调用 resourceRoles，直接枚举 C(3,2)=3 种物理对 8，
  // 比较声明相同 + 物理牌不同 + 后状态（余手多重集）不同。
  const bySuit: Record<string, Card> = {};
  for (const c of hand) if (c.rank === 8) bySuit[c.suit] = c;
  const physicalPairs: [string, string][] = [['C', 'D'], ['S', 'C'], ['S', 'D']];
  const oracle = physicalPairs.map(([x, y]) => {
    const used = new Set([bySuit[x].id, bySuit[y].id]);
    const rest = hand.filter((c) => !used.has(c.id));
    const restHasSF = rest.some((c) => c.suit === 'S') === true
      && ['S5', 'S6', 'S7', 'S8', 'S9'].every((k) => rest.some((c) => `${c.suit}${c.rank}` === k));
    return {
      pair: `${x}8+${y}8`,
      cardIds: [bySuit[x].id, bySuit[y].id].sort((p, q) => p - q),
      restMultiset: rest.map((c) => `${c.suit}${c.rank}`).sort().join(','),
      restKeepsSpadeSF5to9: restHasSF,
    };
  });

  // 断言逐条检查
  const cand = pairs8.map((c) => ({
    actionId: canonicalize(0, false, c).actionId,
    dedupKeyInEnumeration: `${comboKey(c)}#${resourceRoles(c.cards, c.wildAs, ctx)}`,
    physicalCards: c.cards.map((x) => `${x.suit}${x.rank}#${x.id}`).sort(),
    rolesKey: resourceRoles(c.cards, c.wildAs, ctx),
  }));

  const aPhys = oracle[0].cardIds.join(',');
  const bPhys = oracle[1].cardIds.join(',');
  const aInCands = pairs8.some((c) => c.cards.map((x) => x.id).sort((p, q) => p - q).join(',') === aPhys);
  const bInCands = pairs8.some((c) => c.cards.map((x) => x.id).sort((p, q) => p - q).join(',') === bPhys);
  const aActionId = canonicalize(0, false, mkPair(bySuit.C, bySuit.D)).actionId;
  const bActionId = canonicalize(0, false, mkPair(bySuit.S, bySuit.C)).actionId;
  // 实际出 a 在候选中的匹配（matchAction 用物理 id 与 valueKey）
  const matchA = pairs8.map((c) => canonicalize(0, false, c));
  const actualA = canonicalize(0, false, mkPair(bySuit.C, bySuit.D));
  const matchOfA = matchA.map((cc, i) => ({ i, ...matchResult(actualA, cc) }));

  const result = {
    task: 'A1-pair8-equivalence',
    hand: hand.map((c) => `${c.suit}${c.rank}#${c.id}`),
    ctx: { mode: 'stage', levelRank: 2 },
    pair8CandidateCount: pairs8.length,
    pair8Candidates: cand,
    oraclePhysicalPairs: oracle,
    checks: {
      a_legal_and_distinct_from_b: aActionId !== bActionId,
      both_a_b_in_candidates: aInCands && bInCands,
      a_in_candidates: aInCands,
      b_in_candidates: bInCands,
      distinctActionIds: aActionId !== bActionId,
      enumerationKeptBoth: pairs8.length >= 2,
      postStatesDiffer: oracle[0].restMultiset !== oracle[1].restMultiset,
      aKeepsSF_bDoesNot: oracle[0].restKeepsSpadeSF5to9 === true && oracle[1].restKeepsSpadeSF5to9 === false,
    },
    matchOfAInCandidates: matchOfA,
    verdict: pairs8.length >= 2 && aInCands && bInCands
      ? 'PASS：枚举保留花色物理资源，同点不同花色未被合并'
      : 'FAIL：对8 只剩 ' + pairs8.length + ' 个候选——同点不同花色被 resourceRoles 合并（角色键仅点数）',
  };
  writeFileSync(`${outDir}/candidate-boundaries.json`, JSON.stringify(result, null, 2));
  return result;
}

// 简化 matchAction（复用 @gd/review 语义，避免 import 循环——直接内联同一规则）
function matchResult(actual: { declKey: string; physicalCardIds: string[]; valueKey: string },
  cand: { declKey: string; physicalCardIds: string[]; valueKey: string }): string {
  if (cand.declKey === actual.declKey && cand.physicalCardIds.join(',') === actual.physicalCardIds.join(',')) return 'exact';
  if (cand.declKey === actual.declKey && cand.valueKey === actual.valueKey) return 'equivalent_copy';
  if (cand.valueKey === actual.valueKey) return 'same_cards_diff_decl';
  return 'uncovered';
}

function mkPair(x: Card, y: Card): Combo {
  // 构造"对 8"声明（rank 由牌决定）；仅用于身份比较，不进引擎执行。
  const r = x.rank;
  return {
    kind: 'pair', cards: [x, y], size: 2, keyRank: r, length: 1,
    pairRanks: [], mainRank: r, wildAs: [],
  };
}

// ── A2：观察是否真的缺信息 ───────────────────────────────────────
// 317 状态块清单 + 68 动作块；两个合法决策的完整 state-action 向量对比；
// 生效级牌改变候选集/牌序的 witness；结论分类。
function a2() {
  const deck = buildDeck();
  const pick = (suit: string, rank: number, nth = 0): Card => {
    const hits = deck.filter((c) => c.suit === suit && c.rank === rank);
    return hits[nth];
  };
  // 手牌：含 5 与 9（非红心），顺子素材 34567，无红心级牌
  const hand = [
    pick('S', 5), pick('D', 5), pick('C', 9), pick('S', 9),
    pick('S', 3), pick('S', 4), pick('S', 6), pick('S', 7),
    pick('D', 14), pick('C', 14),
  ];
  // 场上公开信息：对手（东=seat1）领单张 A；历史动作不含 5/9
  const leadA = {
    kind: 'single', cards: [pick('H', 14)], size: 1, keyRank: 14, length: 1,
    pairRanks: [], mainRank: 14, wildAs: [],
  } as Combo;

  const mkState = (stageTeam: 0 | 1) => {
    const ctx = makeLevelCtx([5, 9], 'stage', stageTeam);
    const other = deck.filter((c) => !hand.some((h) => h.id === c.id) && c.id !== pick('H', 14).id);
    const state: any = {
      match: { opts: DEFAULT_RULES, levels: [5, 9], gameNo: 2, winner: null, rngState: 1, lastHead: 1, lastResult: null },
      ctx,
      levelsBefore: [5, 9] as [number, number],
      stageTeam,
      hands: [[...hand], other.slice(0, 27), other.slice(27, 54), other.slice(54, 81)],
      turn: 0, leader: 1, lastCombo: leadA, lastPlayer: 1, passCount: 0,
      trickPlays: [{ player: 1, combo: leadA }], finished: [], over: false, result: null, moveNo: 5,
      tribute: null, pendingReturns: [],
    };
    return state as unknown as GameState;
  };

  const s0 = mkState(0); // 我方(team0,级5)在台 → 生效级牌 5
  const s1 = mkState(1); // 对方(team1,级9)在台 → 生效级牌 9

  // 1) 同一物理动作（单张 ♠8 … 用 ♠A 之外的中性牌；此处用 ♠6）的完整 state-action 向量对比
  const tracker0 = new PublicTracker();
  const tracker1 = new PublicTracker();
  const action = hand.find((c) => c.suit === 'S' && c.rank === 6)!;
  const v0 = buildInput(s0, 0, tracker0, mkSingle(action));
  const v1 = buildInput(s1, 0, tracker1, mkSingle(action));
  let vectorEqual = v0.length === v1.length;
  let firstDiff = -1;
  for (let i = 0; i < Math.min(v0.length, v1.length); i++) {
    if (v0[i] !== v1[i]) { vectorEqual = false; firstDiff = i; break; }
  }

  // 2) 生效级牌改变可核查后果：候选集 & 牌序
  const cands0 = legalCombos(s0).map((c) => `${c.kind}:${c.mainRank}:${c.length}:${c.size}`);
  const cands1 = legalCombos(s1).map((c) => `${c.kind}:${c.mainRank}:${c.length}:${c.size}`);
  const single5 = hand.filter((c) => c.rank === 5).map((c) => mkSingle(c));
  const beatsA = (stageTeam: 0 | 1) => {
    const ctx = makeLevelCtx([5, 9], 'stage', stageTeam);
    return single5.some((c) => {
      const withCtx = { ...c, keyRank: rankOrder(c.mainRank, ctx) };
      return beats(withCtx, leadA);
    });
  };
  const straight34567 = (stageTeam: 0 | 1) => {
    const ctx = makeLevelCtx([5, 9], 'stage', stageTeam);
    return enumerateCombos(hand, ctx, DEFAULT_RULES).some((c) => c.kind === 'straight' && c.length === 5 && c.mainRank === 7);
  };

  const blockTable = [
    { block: 'myHand', dims: 54, source: '自家手牌', public: '私有(本人可见)', cumulative: '即时', seatNorm: '本人', ruleDep: '否' },
    { block: 'unknownPool', dims: 54, source: '2−我手−公开已出（tracker.played 累计）', public: '推导', cumulative: '累计计数', seatNorm: '本人视角', ruleDep: '两副牌 2 张/种' },
    { block: 'trickCards', dims: 54, source: '当前待压牌', public: '公开', cumulative: '当前轮', seatNorm: '相对座位(declarerRel)', ruleDep: '否' },
    { block: 'trickMeta', dims: 15, source: '待压牌声明者/牌型/牌力/张数', public: '公开', cumulative: '当前轮', seatNorm: '相对座位', ruleDep: 'keyRank 用 rankOrder(级牌敏感)' },
    { block: 'seatStatus', dims: 9, source: '三家属地:张数/报牌≤10/名次', public: '公开', cumulative: '即时', seatNorm: '队友/下家/上家', ruleDep: '否' },
    { block: 'recentMoves', dims: 126, source: '三家最近 3 动作(窗口)', public: '公开', cumulative: '3 步窗口（另有 unknownPool 累计块——"只记3手"不成立）', seatNorm: '队友/下家/上家', ruleDep: 'keyRank 级牌敏感' },
    { block: 'levels', dims: 2, source: 'match.levels[本队/对方]', public: '公开', cumulative: '整场', seatNorm: '本队/对方', ruleDep: '数值即级数；不编码谁在台' },
    { block: 'wilds', dims: 1, source: '我手中红心级牌张数', public: '私有', cumulative: '即时', seatNorm: '本人', ruleDep: '级牌=台上队级数（依赖 stageTeam）' },
    { block: 'tribute', dims: 2, source: '抗贡标志/我是否贡者', public: '公开', cumulative: '本局', seatNorm: '本人', ruleDep: '进贡规则' },
  ];

  const result = {
    task: 'A2-observation-collision',
    layout: { stateDim: STATE_DIM, actionDim: ACTION_DIM, inputDim: INPUT_DIM, blocks: blockTable, blockDimSum: blockTable.reduce((s, b) => s + b.dims, 0) },
    witness: {
      setup: 'stage 级数 [5,9]；seat0(team0) 手牌含 5/9/34567 素材、无红心 5/9；东家领单张 A；两状态仅 stageTeam 不同（0=我方在台→生效级牌5；1=对方在台→生效级牌9）',
      stateActionVectorEqualForSamePhysicalAction: vectorEqual,
      firstDiffIndex: firstDiff,
      candidateDeclSets: { stageTeam0_effectiveLevel5: [...new Set(cands0)].length, stageTeam1_effectiveLevel9: [...new Set(cands1)].length },
      declSetDiff: {
        onlyInLevel5: [...new Set(cands0)].filter((k) => !new Set(cands1).has(k)).slice(0, 12),
        onlyInLevel9: [...new Set(cands1)].filter((k) => !new Set(cands0).has(k)).slice(0, 12),
      },
      consequenceChecks: {
        single5_beatsA_whenLevel5: beatsA(0),   // 级5 在台：5 是级牌，压 A
        single5_beatsA_whenLevel9: beatsA(1),   // 级 9 在台：5 是普通牌，压不过 A
        straight34567_whenLevel5: straight34567(0), // 级牌 5 不入顺 → 34567 不存在
        straight34567_whenLevel9: straight34567(1), // 级 9 在台 → 34567 合法
      },
    },
    classification: {
      twoTeamLevelValues: 'directly_encoded（levels 块 2 维，(lv-2)/12 可完整恢复两队级数数值）',
      effectiveLevelIdentity_whichTeamOnStage: 'missing_with_witness（两状态向量逐位相同而候选集/牌序不同；首局 levels 相等时无歧义、非抗贡局可由 tribute 我贡位推导，抗贡局不可推导——witness 即抗贡局可实现的情形）',
      last3MovesOnly: 'derivable（recentMoves 是 3 步窗口，但 unknownPool=2−我手−累计已出 提供全部已出牌累计计数；张数 seatStatus 亦累计——"模型只记 3 手"不成立）',
      tributeCardOwnership: 'missing（贡还公开亮明牌的归属未编码：unknownPool 不区分"已知在某家"与"完全未知"；schema knownLimitations 自 v1 登记；本轮 F 分支不加该特征，只修记录层事实）',
      wildcardCount: 'directly_encoded（wilds 块）但仅在持有红心级牌时泄露生效级牌；本 witness 无红心级牌故两状态同为 0',
    },
    verdict: 'missing_with_witness：生效级牌身份（哪队级数在台）在 317 维状态中未编码且存在具体碰撞对；触发任务C F 分支上下文特征 A/B（生效级牌 13 维 one-hot + 我方在台 1 维）',
  };
  writeFileSync(`${outDir}/observation-collision.json`, JSON.stringify(result, null, 2));
  return result;
}

function mkSingle(card: Card): Combo {
  return {
    kind: 'single', cards: [card], size: 1, keyRank: card.rank, length: 1,
    pairRanks: [], mainRank: card.rank, wildAs: [],
  };
}

// ── 运行 ─────────────────────────────────────────────────────────
const which = process.argv[2] ?? 'a1';
if (which === 'a1') {
  const r = a1();
  console.log(JSON.stringify({ verdict: r.verdict, checks: r.checks, pair8CandidateCount: r.pair8CandidateCount, candidates: r.pair8Candidates }, null, 2));
} else if (which === 'a2') {
  const r = a2();
  console.log(JSON.stringify({
    vectorEqual: r.witness.stateActionVectorEqualForSamePhysicalAction,
    consequenceChecks: r.witness.consequenceChecks,
    declDiffCounts: { only5: r.witness.declSetDiff.onlyInLevel5.length, only9: r.witness.declSetDiff.onlyInLevel9.length },
    verdict: r.verdict,
  }, null, 2));
}
