/**
 * lab/src/wildcard_repro.ts — 「万能牌当自然牌」已知漏招最小反例（2026-10-26，CLEAN1 前置）。
 * 方案第四节要求：预期合法动作、枚举实际遗漏、引擎是否接受、现有编码能否区分。
 * 用法: npx tsx lab/src/wildcard_repro.ts   （修复前=暴露漏招；修复后=全部 ✓）
 */
import {
  classify, enumerateCombos, makeLevelCtx, type Card, type Suit,
} from '@gd/engine';
import { dedupCandidates, INPUT_DIM, encodeAction, STATE_DIM } from '@gd/ai';

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, d = ''): void => {
  c ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name} ${d}`));
};

let nid = 9000;
const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });
const L5 = makeLevelCtx([5, 5], 'both');
const ids = (cs: Card[]): string => cs.map((c) => `${c.suit}${c.rank}#${c.id}`).sort().join(' ');

// ---------- 场景 1（报告原例）：级 5，手 ♠5 ♠5 ♥5(万能)。对子声明 "pair:5" ----------
// 预期合法动作：{♠5,♥5} 对子（♥5 按自然点数 5 编入，保留一张 ♠5）。
// 现行枚举"真实牌优先"只产出 {♠5,♠5}，{♠5,♥5} 变体缺失。
{
  const hand = [C('S', 5), C('S', 5), C('H', 5)];
  const combos = enumerateCombos(hand, L5);
  const pairs = combos.filter((c) => c.kind === 'pair' && c.mainRank === 5);
  console.log(`场景1 手=${ids(hand)} → 对子候选: ${pairs.map((p) => ids(p.cards)).join(' | ') || '无'}`);
  const want = pairs.some((p) => p.cards.some((c) => c.suit === 'H'));
  ok(want, '枚举含 {♠5,♥5} 对子（万能牌当自然 5，保 ♠5）');
  ok(pairs.some((p) => p.cards.every((c) => c.suit === 'S')), '枚举仍含 {♠5,♠5} 自然对子（原有行为保留）');
  // 引擎是否接受：classify({♠5,♥5}) 必须能解释为对 5（人类真选中这两张时的判定路径）
  const interp = classify([hand[0], hand[2]], L5);
  ok(interp.some((c) => c.kind === 'pair' && c.mainRank === 5), `classify 接受 {♠5,♥5}（解释数 ${interp.length}）`);
  // 现有编码能否区分：两个对子候选的动作向量必须不同（物理牌面 54 维）
  const a = new Float32Array(INPUT_DIM); const b = new Float32Array(INPUT_DIM);
  encodeAction(pairs.find((p) => p.cards.some((c) => c.suit === 'H')) ?? pairs[0], a.subarray(STATE_DIM) as never);
  encodeAction(pairs.find((p) => p.cards.every((c) => c.suit === 'S')) ?? pairs[0], b.subarray(STATE_DIM) as never);
  ok([...a].some((v, i) => v !== b[i]), '动作编码区分两个物理变体');
  // 神经候选去重后两变体共存
  const dedup = dedupCandidates(combos, false);
  const dp = dedup.filter((c) => c.combo && c.combo.kind === 'pair' && c.combo.mainRank === 5);
  ok(dp.length >= 2, `dedupCandidates 保留 ${dp.length} 个对 5 变体（≥2）`);
}

// ---------- 场景 2：单张。级 5，手 ♠5 ♥5。预期 {♥5} 单张（保 ♠5）缺 ----------
{
  const hand = [C('S', 5), C('H', 5)];
  const combos = enumerateCombos(hand, L5);
  const singles5 = combos.filter((c) => c.kind === 'single' && c.mainRank === 5);
  console.log(`场景2 手=${ids(hand)} → 5 的单张候选: ${singles5.map((p) => ids(p.cards)).join(' | ') || '无'}`);
  ok(singles5.some((p) => p.cards[0].suit === 'H'), '枚举含 {♥5} 单张（保 ♠5）');
  ok(singles5.some((p) => p.cards[0].suit === 'S'), '枚举仍含 {♠5} 单张');
}

// ---------- 场景 3：炸弹。级 5，手 ♠5 ♠5 ♦5 ♣5 ♥5。预期 4 炸 {♠♠♦♥}(花万能保♣5) 缺 ----------
{
  const hand = [C('S', 5), C('S', 5), C('D', 5), C('C', 5), C('H', 5)];
  const combos = enumerateCombos(hand, L5);
  const bombs4 = combos.filter((c) => c.kind === 'bomb' && c.size === 4);
  const variants = bombs4.filter((b) => b.cards.some((c) => c.suit === 'H'));
  console.log(`场景3 → 4炸候选 ${bombs4.length} 个: ${bombs4.map((b) => ids(b.cards)).join(' | ')}`);
  ok(variants.length >= 1, '枚举含花 ♥5 的 4 炸变体');
  ok(bombs4.some((b) => b.cards.every((c) => c.suit !== 'H')), '枚举仍含全自然 4 炸');
  // 引擎接受花万能 4 炸
  const interp = classify([hand[0], hand[1], hand[2], hand[4]], L5);
  ok(interp.some((c) => c.kind === 'bomb' && c.size === 4), 'classify 接受 {♠♠♦♥} 4 炸');
}

// ---------- 场景 4：三张。级 5，手 ♠5 ♠5 ♦5 ♥5。预期三张 {♠♠♥} 变体缺 ----------
{
  const hand = [C('S', 5), C('S', 5), C('D', 5), C('H', 5)];
  const combos = enumerateCombos(hand, L5);
  const trios = combos.filter((c) => c.kind === 'trio' && c.mainRank === 5);
  console.log(`场景4 → 三张候选: ${trios.map((p) => ids(p.cards)).join(' | ') || '无'}`);
  ok(trios.some((p) => p.cards.some((c) => c.suit === 'H')), '枚举含花 ♥5 的三张变体');
}

// ---------- 场景 5（对照）：自然牌不足时万能牌已参与（原有行为，不得回归） ----------
{
  const hand = [C('S', 5), C('H', 5)];
  const combos = enumerateCombos(hand, L5);
  ok(combos.some((c) => c.kind === 'pair' && c.mainRank === 5
    && c.cards.some((x) => x.suit === 'H')), '对照：1 自然 + 1 万能 = 对 5（原有）');
}

console.log(`\n万能牌当自然牌反例: ${pass} 通过, ${fail} 失败${fail > 0 ? '（漏招未修复）' : ''}`);
process.exit(fail > 0 ? 1 : 0);
