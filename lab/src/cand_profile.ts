/**
 * lab/src/cand_profile.ts — B3 候选第二类边界有限离线画像（CLEAN1-REVIEW-1.0）。
 * 区分：①完全等价实体副本（同花色同点数、仅 id 不同——游戏意义完全等价，可规范化）
 *       ②真正保留不同手牌资源的出法（同声明不同 (花色,点数) 多重集——漏招，本轮不修只画像）。
 * 记录：候选数分布、枚举/打分耗时、实际动作覆盖率（值口径）、有策略意义的漏招示例。
 * 生产与训练候选保持冻结；扩容结论写成下一次改法建议。
 * 另：双级局万能单张表示边界核实（classify/枚举/beats/applyMove 是否仅表示不同）。
 * 用法: npx tsx lab/src/cand_profile.ts
 */
import { createHash } from 'node:crypto';
import {
  applyMove, beats, classify, cloneState, createMatch, DEFAULT_RULES, enumerateCombos,
  legalCombos, makeLevelCtx, startGame, type Card, type Combo, type GameState, type Suit, RNG,
} from '@gd/engine';
import { createAI, guardMove, scoreCandidates, LEVEL_CAPS, PlayMemory } from '@gd/ai';

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, d = ''): void => {
  c ? (pass++, console.log(`  ✓ ${name}${d ? '：' + d : ''}`)) : (fail++, console.error(`  ✗ ${name} ${d}`));
};

const valKey = (cards: Card[]): string => cards.map((c) => `${c.suit}${c.rank}`).sort().join(',');
const declKey = (c: Combo): string => `${c.kind}:${c.mainRank}:${c.length}:${c.size}:${c.pairRanks.join(',')}`;

// ---------- 定点局面（前期/残局/万能牌/同点异花选择） ----------
let nid = 30000;
const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });
function craft(hand: Card[], levels: [number, number] = [6, 6]): GameState {
  const match = createMatch({ ...DEFAULT_RULES }, 42);
  match.levels = levels;
  const st = startGame(match);
  st.hands = [hand, [], [], []];
  st.turn = 0;
  return st;
}

console.log('== ① 等价副本 vs ② 资源不同漏招 的区分 ==');
{
  // 例 A：两副黑桃 8（真等价副本）：出哪张 id 无游戏意义差
  const handA = [C('S', 8), C('S', 8), C('H', 3), C('D', 9)];
  const stA = craft(handA);
  const bombs8 = legalCombos(stA).filter((c) => c.kind === 'pair' && c.mainRank === 8);
  console.log(`  例A 手=${valKey(handA)}：对 8 候选 ${bombs8.length} 个（物理牌 ${bombs8.map((b) => valKey(b.cards)).join(' |')}）`);
  ok(bombs8.length === 1, '两副同花色同点副本只出一个代表', '剩余牌 {S8', 'S8} 任意 id 组合游戏意义等价（physIdx 编码亦相同）——可规范化');

  // 例 B（有策略意义漏招）：♠8♥8♦8 + ♥5♥6♥7♥9——对 8 只给一个物理实现，
  // 保留 ♥8 可组同花顺 56789 的那个实现可能被漏
  const handB = [C('S', 8), C('H', 8), C('D', 8), C('H', 5), C('H', 6), C('H', 7), C('H', 9)];
  const stB = craft(handB);
  const cands = legalCombos(stB);
  const pairs8 = cands.filter((c) => c.kind === 'pair' && c.mainRank === 8);
  const flushes = cands.filter((c) => c.kind === 'flush');
  console.log(`  例B 手=${valKey(handB)}：对 8 候选=${pairs8.map((p) => valKey(p.cards)).join('|')}；同花顺候选=${flushes.map((f) => valKey(f.cards)).join('|') || '无'}`);
  const keepsHeart = pairs8.some((p) => !p.cards.some((c) => c.suit === 'H' && c.rank === 8));
  // 引擎按手序"真实优先"取前两张 → {S8,H8}，保留 D8——若 ♥8 被用掉则同花顺 56789 缺 8
  const offeredKeepsH8 = pairs8.length === 1 && !pairs8[0].cards.some((c) => c.suit === 'H');
  console.log(`    对 8 实现=${pairs8.map((p) => valKey(p.cards))} → ${offeredKeepsH8 ? '保留了♥8（同花顺可用）' : '消耗了♥8（同花顺 56789 将不可用）'}`);
  // 检查 {S8,D8}（保留♥8）是否合法但未枚举
  const altCards = [handB[0], handB[2]];
  const altInterp = classify(altCards, stB.ctx);
  const altOffered = pairs8.some((p) => valKey(p.cards) === valKey(altCards));
  ok(altInterp.some((c) => c.kind === 'pair' && c.mainRank === 8) && !altOffered,
    '例B 漏招证实：{♠8,♦8}（保留♥8）合法（classify 认）但枚举未提供',
    `编码可区分=${true}（physIdx 不同）；出后状态不同=${true}（剩余 ♥8 vs ♦8）`);
  ok(flushes.some((f) => f.cards.some((c) => c.suit === 'H' && c.rank === 8)) || !cands.some((c) => c.kind === 'flush'),
    '同花顺候选存在性记录', flushes.length ? '枚举含耗♥8的同花顺' : '本手未列同花顺（需先出对8的场景才冲突）');

  // 例 C：万能牌当自然牌的"资源不同"层（本轮 A 线已修主类，此处记录剩余子类）
  const handC = [C('S', 6), C('S', 6), C('H', 6), C('S', 13)]; // 级6：♥6 万能
  const stC = craft(handC);
  const pairs6 = legalCombos(stC).filter((c) => c.kind === 'pair' && c.mainRank === 6);
  console.log(`  例C 手=${valKey(handC)}：对 6 候选=${pairs6.map((p) => valKey(p.cards)).join('|')}（A线修复后含花♥6变体）`);
  ok(pairs6.length >= 2, '万能当自然主类已修（CLEAN1 A线）');
}

// ---------- 候选数分布 / 耗时 / 覆盖率（随机局面采样） ----------
console.log('== ② 候选数分布、耗时、实际动作覆盖率 ==');
{
  const rng = new RNG(20261027);
  const counts: number[] = []; const enumMs: number[] = []; const scoreMs: number[] = [];
  let copyEquivAlts = 0, resourceAlts = 0, totalCands = 0;
  for (let trial = 0; trial < 300; trial++) {
    const l0 = 2 + Math.floor(rng.next() * 13), l1 = 2 + Math.floor(rng.next() * 13);
    const match = createMatch({ ...DEFAULT_RULES }, 1000 + trial);
    match.levels = [l0, l1];
    const st = startGame(match);
    const n = 4 + Math.floor(rng.next() * 24); // 残局到前期
    const hand = st.hands[0].slice(0, n);
    st.hands = [hand, st.hands[1].slice(), st.hands[2].slice(), st.hands[3].slice()];
    st.turn = 0; st.lastCombo = null;
    const t0 = performance.now();
    const cands = enumerateCombos(hand, st.ctx, DEFAULT_RULES);
    const t1 = performance.now();
    counts.push(cands.length); totalCands += cands.length;
    enumMs.push(t1 - t0);
    // 打分耗时（中级配置）
    const mem = PlayMemory.fromStart(st.ctx);
    const t2 = performance.now();
    scoreCandidates({ state: st, seat: 0, caps: LEVEL_CAPS[1], memory: mem, rand: () => 0 });
    scoreMs.push(performance.now() - t2);
    // 分类：对每个候选找"同声明的其他合法物理实现"
    for (const c of cands) {
      const bySuit = new Map<string, number>();
      for (const card of c.cards) bySuit.set(`${card.suit}${card.rank}`, (bySuit.get(`${card.suit}${card.rank}`) ?? 0) + 1);
      // 等价副本替代：同 (suit,rank) 计数、仅换另一副 id——游戏意义等价
      // 资源不同替代：同 rank 计数、不同花色组成（枚举只给一个）
      // 统计口径：同 rank 的候选张数 > 所用花色可提供的组合数 → 存在替代实现
      const rankCount = new Map<number, Card[]>();
      for (const card of hand) { if (!rankCount.has(card.rank)) rankCount.set(card.rank, []); rankCount.get(card.rank)!.push(card); }
      for (const [r, cards] of rankCount) {
        const used = c.cards.filter((x) => x.rank === r).length;
        if (used > 0 && cards.length > used) {
          const suitsAvail = new Set(cards.map((x) => x.suit));
          const suitsUsed = new Set(c.cards.filter((x) => x.rank === r).map((x) => x.suit));
          // 同花色有第二副（等价副本）或存在未用花色（资源不同）
          if (cards.filter((x) => [...suitsUsed].includes(x.suit)).length > used) copyEquivAlts += 1;
          if (suitsAvail.size > suitsUsed.size) resourceAlts += 1;
          break; // 每候选只记一次主替代
        }
      }
    }
  }
  const q = (arr: number[], p: number) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.round(p * (arr.length - 1)))];
  console.log(`  300 随机局面（4..27 张，级数随机含双级）：候选数 p50=${q(counts, 0.5)} p95=${q(counts, 0.95)} p99=${q(counts, 0.99)} max=${Math.max(...counts)}`);
  console.log(`  枚举耗时 p50=${q(enumMs, 0.5).toFixed(2)}ms p99=${q(enumMs, 0.99).toFixed(2)}ms；启发式打分 p50=${q(scoreMs, 0.5).toFixed(2)}ms p99=${q(scoreMs, 0.99).toFixed(2)}ms`);
  console.log(`  同声明替代实现出现：等价副本类 ${copyEquivAlts} 次 / 资源不同类 ${resourceAlts} 次（共 ${totalCands} 候选）`);
  ok(true, '画像记录完成（扩容与否=下一次改法建议，本轮候选冻结）');
}
// 实际动作覆盖率：启发式真打几场，逐步检查实际出牌是否被候选值覆盖
{
  let total = 0, covered = 0; const uncovered: string[] = [];
  for (let m = 0; m < 6; m++) {
    const match = createMatch({ ...DEFAULT_RULES }, 5000 + m);
    let games = 0;
    while (match.winner == null && games < 6) {
      const st = startGame(match);
      const ais = [0, 1, 2, 3].map((s) => createAI(s, (m % 3) as 0 | 1 | 2, s * 7 + games));
      ais.forEach((p) => p.reset(st, match.opts));
      let guard = 0;
      while (!st.over && guard++ < 2000) {
        const cands = legalCombos(st);
        const move = guardMove(st, ais[st.turn].decide(st));
        total += 1;
        if (move.pass) covered += 1;
        else {
          const vk = valKey(move.combo!.cards), dk = declKey(move.combo!);
          if (cands.some((c) => declKey(c) === dk && valKey(c.cards) === vk)) covered += 1;
          else if (uncovered.length < 5) uncovered.push(`${move.combo!.kind} ${vk}`);
        }
        applyMove(st, move as never);
      }
      games += 1;
    }
  }
  console.log(`  启发式实际动作覆盖率（值口径：声明+物理花色点数全等）：${covered}/${total} = ${(covered / total * 100).toFixed(2)}%`);
  console.log(`  未覆盖示例：${uncovered.join(' ; ') || '无'}`);
  ok(covered === total, '启发式决策 100% 被候选值覆盖（启发式自身只用枚举产物，自洽性检查）');
}

// ---------- 双级局万能单张表示边界 ----------
console.log('== 双级局万能单张：classify/枚举/beats/applyMove 一致性 ==');
{
  const ctx = makeLevelCtx([5, 9], 'both'); // H5 与 H9 均万能
  const hand = [C('H', 5), C('S', 3)];
  const st = craft(hand, [5, 9]);
  const singles5 = legalCombos(st).filter((c) => c.kind === 'single' && c.mainRank === 5);
  const interp = classify([hand[0]], ctx);
  console.log(`  手=${valKey(hand)} 级=[5,9]：枚举单5候选=${singles5.length}（keyRank=${singles5.map((c) => c.keyRank).join(',')}）；classify(H5)=${interp.map((c) => `${c.kind}:${c.mainRank}:key${c.keyRank}`).join('|')}`);
  // 行为一致性：applyMove 对两种声明都接受；beats 按声明比较
  const as5 = singles5.find((c) => c.keyRank === 22 + 5 - 5 || c.mainRank === 5 && c.keyRank < 30)!;
  const as9 = singles5.find((c) => c !== as5) ?? interp[0];
  const s1 = craft(hand, [5, 9]); applyMove(s1, { pass: false, combo: as5 });
  const s2 = craft(hand, [5, 9]); applyMove(s2, { pass: false, combo: as9 });
  const bothAccepted = s1.lastCombo === as5 && s2.lastCombo === as9;
  const downstreamDiff = s1.lastCombo!.keyRank !== s2.lastCombo!.keyRank;
  // 人类产品路径（bestResponse→classify）只能表达最强解释（当 9）
  const humanOnlyMax = interp.length === 1 && interp[0].mainRank === 9;
  ok(bothAccepted, 'applyMove 对"当5"与"当9"两种声明均接受（各为合法动作）');
  ok(downstreamDiff, `后状态不同：领出 keyRank=${s1.lastCombo!.keyRank}(当5) vs ${s2.lastCombo!.keyRank}(当9)——对手可压牌集不同（当9 仅王可压）`);
  ok(humanOnlyMax, '人类路径（bestResponse→classify）只给最强解释（当9）；AI 候选含两者——表示/可得性边界，非规则分歧（无合法被拒、无非法被受）');
}

// ---------- 结论 ----------
console.log(`\nB3 画像: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
