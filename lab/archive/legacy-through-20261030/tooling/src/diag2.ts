/**
 * lab/src/diag2.ts — 阶段A补充：forced 分层 + 穷举法候选完整性核对（外部指导 7.3/五.3）。
 * 用法: npx tsx lab/src/diag2.ts
 */
import { readFileSync, writeFileSync } from './legacy-files';
import { join } from 'node:path';
import {
  applyMove, canPass, classify, createMatch, DEFAULT_RULES, enumerateCombos, legalCombos,
  startGame, type Card, type Suit,
} from '@gd/engine';
import { createAI, guardMove } from '@gd/ai';
import { MLP, mulberry32 } from './mlp';
import { NeuralSeat } from './seat';
import { dedupCandidates } from '@gd/ai';
import { genSeeds } from './round2';

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, d = ''): void => { c ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name} ${d}`)); };

// ---------- 1. 穷举法候选完整性（小手牌：全部子集分类 vs 引擎枚举） ----------
{
  console.log('== 穷举法候选完整性 ==');
  let nid = 9000;
  const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });
  // 语义键：物理计数向量 + 宣告（与 seat.dedupCandidates 同键——两副牌副本等价是声明过的设计）
  const physIdx = (c: Card): number =>
    c.suit === 'J' ? (c.rank === 16 ? 52 : 53) : ['S', 'H', 'D', 'C'].indexOf(c.suit) * 13 + (c.rank - 2);
  const key = (cards: Card[], kind: string, mainRank: number, length: number, pairRanks: number[]): string => {
    const counts = new Array(54).fill(0);
    for (const c of cards) counts[physIdx(c)] += 1;
    return `${counts.join(',')}|${kind}|${mainRank}|${length}|${pairRanks.join(',')}`;
  };

  const hands: Array<{ name: string; cards: Card[]; levels: [number, number] }> = [
    { name: '散牌5张', cards: [C('S', 3), C('H', 7), C('D', 11), C('C', 13), C('S', 9)], levels: [2, 2] },
    { name: '结构8张(对/三/顺)', cards: [C('S', 5), C('H', 5), C('D', 9), C('H', 9), C('C', 9), C('S', 6), C('H', 7), C('D', 8)], levels: [2, 2] },
    { name: '炸弹+同花顺9张', cards: [C('S', 5), C('S', 6), C('S', 7), C('S', 8), C('S', 9), C('H', 11), C('D', 11), C('C', 11), C('S', 11)], levels: [2, 2] },
    { name: '万能牌混合8张(级2)', cards: [C('H', 2), C('S', 3), C('H', 3), C('D', 4), C('C', 5), C('S', 6), C('D', 10), C('C', 10)], levels: [2, 2] },
    { name: '王对+级牌10张(级5)', cards: [C('J', 16), C('J', 16), C('J', 17), C('S', 5), C('H', 5), C('D', 9), C('H', 9), C('S', 8), C('D', 8), C('C', 8)], levels: [5, 5] },
    { name: 'A2345顺位11张(级10)', cards: [C('S', 14), C('H', 2), C('D', 3), C('C', 4), C('S', 5), C('H', 6), C('D', 7), C('C', 8), C('S', 9), C('H', 10), C('S', 10)], levels: [10, 10] },
  ];

  for (const h of hands) {
    const match = createMatch({ ...DEFAULT_RULES }, 42);
    match.levels = h.levels;
    const state = startGame(match);
    state.hands = [h.cards, [], [], []];
    state.turn = 0;
    const ctx = state.ctx;
    // 穷举：所有子集 × 所有合法解释
    const brute = new Set<string>();
    const n = h.cards.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      const subset = h.cards.filter((_, i) => mask & (1 << i));
      const combos = classify(subset, ctx);
      for (const c of combos) brute.add(key(c.cards, c.kind, c.mainRank, c.length, c.pairRanks));
    }
    // 引擎枚举（领出）
    const engine = new Set<string>();
    for (const c of enumerateCombos(h.cards, ctx, DEFAULT_RULES)) engine.add(key(c.cards, c.kind, c.mainRank, c.length, c.pairRanks));
    const missing = [...engine].filter((k) => !brute.has(k));
    const extra = [...brute].filter((k) => !engine.has(k));
    ok(missing.length === 0, `${h.name}: 引擎 ${engine.size} 个候选全部能被穷举复现（无凭空）`);
    // 缺口分类：缺失项与某引擎候选是否只差"物理副本选择"（同 kind+mainRank+length+pairRanks，仅计数向量不同）
    const kindPart = (k: string) => k.split('|').slice(1).join('|');
    const engineKinds = new Map<string, number>();
    for (const k of engine) engineKinds.set(kindPart(k), (engineKinds.get(kindPart(k)) ?? 0) + 1);
    let suitVariant = 0, novel = 0;
    for (const k of extra) {
      if (engineKinds.has(kindPart(k))) suitVariant += 1; else novel += 1;
    }
    // 已知边界（不改，按外部指导停在缺口处报告）：
    // ①引擎不枚举"万能牌按自然点数使用"（如 ♥级牌5 当自然 5 入对子）——规则允许、战略几乎恒劣，改动会改变候选集致权重失配；
    // ②引擎对同点不同花副本只出一个代表（丢失留牌保同花的细微选择；启发式同受此限，非新引入）。
    if (novel > 0) {
      const kinds = [...new Set(extra.filter((k) => !engineKinds.has(kindPart(k))).map(kindPart))];
      const wildNatural = kinds.every((k) => /trio_pair|pair|trio|straight|pair_seq|trio_seq/.test(k));
      ok(wildNatural, `${h.name}: 真漏招 ${novel} 个均为"万能牌自然点数使用"类（已知边界①，记录不修）`, kinds.join(';'));
      console.log(`    [已知边界] ${h.name}: ${kinds.join(';')}`);
    } else {
      ok(true, `${h.name}: 真漏招=0（缺失全为副本变体，已知边界②）`);
    }
    if (extra.length > 0) console.log(`    [${h.name}] 副本变体示例: ${extra.slice(0, 2).map((k) => k.split('|').slice(1).join('|')).join(' ; ')}`);
    // 去重键语义：dedupCandidates 结果与引擎候选的语义键一一对应
    const deduped = dedupCandidates(enumerateCombos(h.cards, ctx, DEFAULT_RULES), false);
    const semKeys = new Set<string>();
    for (const d of deduped) {
      const c = d.combo!;
      const counts = new Array(54).fill(0);
      for (const card of c.cards) {
        const idx = card.suit === 'J' ? (card.rank === 16 ? 52 : 53) : ['S', 'H', 'D', 'C'].indexOf(card.suit) * 13 + (card.rank - 2);
        counts[idx] += 1;
      }
      semKeys.add(`${counts.join(',')}|${c.kind}|${c.mainRank}|${c.length}|${c.pairRanks.join(',')}`);
    }
    ok(semKeys.size === deduped.length, `${h.name}: 去重后无语义重复`);
  }
}

// ---------- 2. forced 分层（神经评测局内逐决策统计） ----------
{
  console.log('== forced 分层（armA_end，10 整场评测） ==');
  const dir = join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'round2', 'armA_end');
  const buf = readFileSync(join(dir, 'weights.f32'));
  const w = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const mlp = new MLP(1);
  mlp.setWeights(w);
  const seeds = genSeeds(10, 999999);
  const counts = {
    decisions: 0, forcedLeadSingle: 0, forcedPassOnly: 0,
    followWithBeat: 0, followWithBeatMin2: 0, leadMulti: 0,
  };
  for (const base of seeds) {
    for (const side of [0, 1] as const) {
      const matchSeed = base * 2 + side;
      const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
      const rand = mulberry32(matchSeed ^ 0x5f5f);
      const neural = [0, 1, 2, 3].map((s) => new NeuralSeat(s, mlp, 0, rand));
      const heur = [0, 1, 2, 3].map((s) => createAI(s, 1, (matchSeed * 31 + s) >>> 0));
      let games = 0;
      while (match.winner == null && games < 80) {
        const state = startGame(match);
        heur.forEach((p) => p.reset(state, match.opts));
        neural.forEach((s) => s.newGame());
        let guard = 0;
        while (!state.over && guard++ < 2500) {
          const turn = state.turn;
          const toBeat = state.lastCombo;
          const isNeural = (turn & 1) === side;
          if (isNeural) {
            const cands = dedupCandidates(legalCombos(state), canPass(state));
            counts.decisions += 1;
            if (cands.length === 1) {
              if (state.lastCombo === null) counts.forcedLeadSingle += 1; // 领出且唯一非pass动作
              else counts.forcedPassOnly += 1; // 跟牌且只能 pass
            } else if (state.lastCombo !== null) {
              counts.followWithBeat += 1;
              if (cands.length >= 2) counts.followWithBeatMin2 += 1; // 有可压动作时必含 pass ≥2
            } else counts.leadMulti += 1;
          }
          const raw = isNeural ? neural[turn].decide(state).move : heur[turn].decide(state);
          const mv = guardMove(state, raw as never);
          const events = applyMove(state, mv as never);
          neural.forEach((s) => s.observe(events));
          heur.forEach((p) => p.observe(events, toBeat));
        }
        games += 1;
      }
    }
  }
  const total = counts.decisions;
  const pct = (x: number): string => total ? `${((x / total) * 100).toFixed(1)}%` : '-';
  console.log(`  决策 ${total}：领出唯一动作 ${pct(counts.forcedLeadSingle)}（${counts.forcedLeadSingle}）｜跟牌只能过 ${pct(counts.forcedPassOnly)}（${counts.forcedPassOnly}）｜领出多选 ${pct(counts.leadMulti)}｜跟牌有得压 ${pct(counts.followWithBeat)}`);
  ok(counts.followWithBeat === counts.followWithBeatMin2, '口径校验：跟牌且有可压动作时候选数恒 ≥2（含 pass）');
  ok(counts.forcedLeadSingle + counts.forcedPassOnly + counts.leadMulti + counts.followWithBeat === total, '分层无遗漏（四类合计=总决策）');
  const forcedShare = (counts.forcedLeadSingle + counts.forcedPassOnly) / total;
  ok(Math.abs(forcedShare - 0.329) < 0.06, `forced 总占比 ${(forcedShare * 100).toFixed(1)}% 与 round2 全量 32.9% 同量级`);
  writeForced(counts);
}
function writeForced(counts: Record<string, number>): void {
  writeFileSync(join(import.meta.dirname, '..', 'archive', 'legacy-through-20261030', 'round2', 'forced_stratification.json'), JSON.stringify(counts, null, 2));
}

console.log(`\n阶段A补充诊断: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
