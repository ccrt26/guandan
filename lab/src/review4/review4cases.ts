/**
 * lab/src/review4/review4cases.ts — REVIEW4 D1/D6：30 案例验收集构建器。
 * 生成 lab/review2/review4/cases/：
 *   case-index.json（30 案例：caseId/recordId/provenance/split/覆盖标签/预期断言）
 *   records/*.json（generated=固定种子真实执行局；constructed=手工牌面脚本局）
 *   semantic-index.json（facts 模式目标）/ rollout-pilot.json（sampled 目标）/ llm-acceptance.json
 * 整场隔离：同一 match 只进一个 split（20 dev / 10 holdout）。
 * 两截图原谱 unavailable（用户 localStorage 未导出）→ constructed 同类回归，如实标注。
 * 用法: npx tsx lab/src/review4/review4cases.ts
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMove, bestResponse, beats, buildDeck, createMatch, DEFAULT_RULES, newRecordId, Recorder,
  startGame, type Card, type Combo, type GameRecord, type MoveRecord, type Suit,
} from '@gd/engine';
import { validateRecord } from '@gd/review';
import { createAI, guardMove } from '@gd/ai';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const R2 = join(ROOT, 'lab', 'review2');
const CASES = join(R2, 'review4', 'cases');
mkdirSync(join(CASES, 'records'), { recursive: true });

/** 生成局（真实执行，单副记录）：学生=seat0 指定难度，其余中级；Recorder 逐手记录 */
function generateRecord(seed: number, studentLevel: 0 | 1 | 2): GameRecord {
  const matchSeed = (Math.imul(seed, 0x9e3779b1) ^ 0x51ed270b) >>> 0;
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const state = startGame(match);
  const rec = new Recorder({
    schemaVersion: 2, id: `gen-r4-${seed.toString(36)}`, matchId: `m-r4-${seed.toString(36)}`,
    createdAt: Date.now(), ruleOpts: { ...DEFAULT_RULES }, levelsBefore: state.levelsBefore,
    stageTeam: state.stageTeam, leader: state.leader, humanSeat: 0, difficulties: [null, 1, 1, 1],
    initialHands: state.hands.map((h) => [...h]),
  });
  rec.recordTributes(state.tribute);
  const ais = [0, 1, 2, 3].map((s) => { const a = createAI(s, s === 0 ? studentLevel : 1, (seed * 16 + s) >>> 0); return a; });
  ais.forEach((a) => a.reset(state, match.opts));
  let guard = 0;
  while (!state.over && guard++ < 2000) {
    const toBeat = state.lastCombo;
    const mover = state.turn;
    const raw = ais[mover].decide(state) as never;
    const mv = guardMove(state, raw);
    const events = applyMove(state, mv as never);
    rec.record(mover, mv, state.hands, toBeat); // 出牌后手数（handsAfter 契约）
    ais.forEach((a) => a.observe(events, toBeat));
  }
  const record = rec.finish(state.result!);
  const v = validateRecord(record);
  if (!v.ok) throw new Error(`生成局不完整 seed=${seed}: ${v.reason}`);
  return record;
}

/** 构造局：手工牌面 + 最小脚本（D1 两截图同类回归与覆盖标签定向用例） */
let nid = 900000;
const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });
function padHands(hands: Card[][]): Card[][] {
  const used = new Set(hands.flat().map((c) => c.id));
  const pool = buildDeck().filter((c) => !used.has(c.id));
  let pi = 0;
  return hands.map((h) => { const out = [...h]; while (out.length < 27) out.push(pool[pi++]); return out; });
}
function craftRecord(
  rawHands: Card[][], script: Array<{ seat: number; cards?: Card[]; pass?: boolean }>,
  levels: [number, number], leader: number, stageTeam: 0 | 1, humanSeat: number = 0,
): GameRecord {
  const hands = padHands(rawHands);
  const match = createMatch({ ...DEFAULT_RULES }, 42);
  match.levels = levels;
  const state = startGame(match);
  state.hands = hands.map((h) => [...h]);
  state.turn = leader; state.leader = leader; state.lastPlayer = leader;
  state.lastCombo = null; state.finished = []; state.over = false; state.result = null; state.moveNo = 0;
  const moves: MoveRecord[] = [];
  let n = 0;
  for (const s of script) {
    n += 1;
    if (state.over) break;
    if (state.turn !== s.seat) throw new Error(`剧本座位错位 第${n}手`);
    let combo: Combo | null = null;
    if (!s.pass && s.cards) {
      combo = bestResponse(s.cards, state.lastCombo, state.ctx, DEFAULT_RULES);
      if (!combo) throw new Error(`第${n}手牌不成型`);
      if (state.lastCombo && !beats(combo, state.lastCombo)) throw new Error(`第${n}手压不过`);
    }
    const tb = state.lastCombo;
    applyMove(state, combo ? { pass: false, combo } : { pass: true });
    moves.push({
      moveNo: n, player: s.seat, pass: !combo, cards: combo?.cards, comboKind: combo?.kind,
      mainRank: combo?.mainRank, handsAfter: state.hands.map((h) => h.length),
      toBeatKind: tb?.kind, toBeatRank: tb?.mainRank,
    } as MoveRecord);
  }
  const record: GameRecord = {
    schemaVersion: 2, id: `cst-r4-${nid.toString(36)}`, matchId: 'm-r4-constructed', createdAt: Date.now(),
    ruleOpts: { ...DEFAULT_RULES }, levelsBefore: levels, stageTeam, leader, humanSeat,
    difficulties: [null, 1, 1, 1], initialHands: hands.map((h) => [...h]), moves, result: null,
  };
  const v = validateRecord(record);
  if (!v.ok) throw new Error(`构造局不完整: ${v.reason}`);
  return record;
}

// ── D1 构造回归 ────────────────────────────────────────────────
/** 第22手类：NN top1=4J 炸弹、启发式偏好 PASS、措辞=意见不同；单次续打实际分支我方双上 */
function caseBombVsPass(): GameRecord {
  // 我方(seat0)手：♠J♠J♥J♦J + 杂牌；东家领单 K；我压 4J 炸弹（NN 首选）——启发式或偏好留炸
  const hand = [C('S', 11), C('H', 11), C('D', 11), C('C', 11), C('S', 3), C('H', 5), C('D', 7)];
  const eastK = C('S', 13);
  return craftRecord([hand, [eastK], [C('C', 4)], [C('D', 4)]], [
    { seat: 1, cards: [eastK] },        // 东领 K
    { seat: 2, pass: true }, { seat: 3, pass: true },        // 4 压不过 K：让
    { seat: 0, cards: [hand[0], hand[1], hand[2], hand[3]] }, // 我出 4J 炸弹接管
    { seat: 1, pass: true }, { seat: 2, pass: true }, { seat: 3, pass: true },
  ], [3, 3], 1, 0);
}
/** 第54手类：stage 级 7，♣7 与小王都能压 A；实际=小王、替代=♣7；同终局不判错 */
function caseLevelCardBeat(): GameRecord {
  // 级 7（我方在台）；西家领 A；我手：♣7、小王、杂牌；实际用小王压
  const hand = [C('C', 7), C('J', 16), C('S', 4), C('H', 9), C('D', 11)];
  const westA = C('H', 14);
  return craftRecord([hand, [C('D', 5)], [C('S', 6)], [westA]], [
    { seat: 3, cards: [westA] },        // 西领 A（当前要压的是西家的 A）
    { seat: 0, cards: [hand[1]] },      // 我用小王压（实际）
    { seat: 1, pass: true }, { seat: 2, pass: true }, { seat: 3, pass: true },
  ], [7, 5], 3, 0);
}
/** 同牌不同声明（exact 分支比对）；贡还缺失降级；队友暗牌不泄漏在生成局天然覆盖 */

// ── 主流程：生成 24 个生成局（覆盖各标签）+ 6 个构造局 ─────────────
interface CaseDef { id: string; provenance: 'generated' | 'constructed'; record: GameRecord; split: 'dev' | 'holdout'; labels: string[]; expect: string; faultDrop?: string[]; }

function main(): void {
  const cases: CaseDef[] = [];
  // 生成局：固定种子（与 REVIEW3 验收集不同的新种子段），20 dev + 4 holdout
  const genSeeds: Array<{ seed: number; level: 0 | 1 | 2; labels: string[]; split: 'dev' | 'holdout' }> = [
    { seed: 42401, level: 0, labels: ['normal', 'wildcard_possible'], split: 'dev' },
    { seed: 42402, level: 0, labels: ['normal', 'disagreement_possible'], split: 'dev' },
    { seed: 42403, level: 1, labels: ['normal', 'teammate_dynamics'], split: 'dev' },
    { seed: 42404, level: 1, labels: ['normal'], split: 'dev' },
    { seed: 42405, level: 0, labels: ['degraded_possible'], split: 'dev' },
    { seed: 42406, level: 2, labels: ['strong_student'], split: 'dev' },
    { seed: 42407, level: 1, labels: ['history_both_legacy'] , split: 'dev' },
    { seed: 42408, level: 0, labels: ['non_default_seat'], split: 'dev' },
    { seed: 42409, level: 1, labels: ['normal'], split: 'dev' },
    { seed: 42410, level: 0, labels: ['normal'], split: 'dev' },
    { seed: 42411, level: 1, labels: ['tribute_info_present'], split: 'dev' },
    { seed: 42412, level: 1, labels: ['tribute_info_present'], split: 'dev' },
    { seed: 42413, level: 0, labels: ['normal'], split: 'dev' },
    { seed: 42414, level: 2, labels: ['strong_student'], split: 'dev' },
    { seed: 42415, level: 1, labels: ['normal'], split: 'dev' },
    { seed: 42416, level: 0, labels: ['normal'], split: 'dev' },
    { seed: 42417, level: 1, labels: ['normal'], split: 'dev' },
    { seed: 42418, level: 0, labels: ['normal'], split: 'dev' },
    { seed: 42419, level: 1, labels: ['mate_darkcard_invariance'], split: 'dev' },
    { seed: 42420, level: 1, labels: ['normal'], split: 'dev' },
    { seed: 52501, level: 0, labels: ['holdout_normal'], split: 'holdout' },
    { seed: 52502, level: 1, labels: ['holdout_wildcard'], split: 'holdout' },
    { seed: 52503, level: 1, labels: ['holdout_disagreement'], split: 'holdout' },
    { seed: 52504, level: 2, labels: ['holdout_strong'], split: 'holdout' },
    { seed: 52505, level: 0, labels: ['holdout_degraded'], split: 'holdout' },
    { seed: 52506, level: 1, labels: ['holdout_normal'], split: 'holdout' },
  ];
  for (const g of genSeeds) {
    const rec = generateRecord(g.seed, g.level);
    if (g.labels.includes('history_both_legacy')) rec.ruleOpts = { ...rec.ruleOpts, levelMode: 'both' };
    if (g.labels.includes('non_default_seat')) rec.humanSeat = 2;
    if (g.labels.includes('tribute_info_present') && rec.tributes === undefined) rec.tributes = []; // 显式无交换≠缺失
    cases.push({ id: `r4-gen-${g.seed}`, provenance: 'generated', record: rec, split: g.split, labels: g.labels, expect: '事实层正确：牌张/声明/claim 边界与证据卡一致' });
  }
  // 构造局
  const wrap = <T,>(name: string, f: () => T): T => { try { const r = f(); console.log('  constructed ok:', name); return r; } catch (e) { console.error('  constructed FAIL:', name, String(e)); throw e; } };
  const bombRec = wrap('bomb-vs-pass', caseBombVsPass);
  cases.push({ id: 'r4-cst-bomb-vs-pass', provenance: 'constructed', record: bombRec, split: 'dev',
    labels: ['screenshot22_regression', 'nn_top1_vs_heuristic_pass', 'single_world_double_up'],
    expect: '措辞=启发式与实际/NN意见不同（不判错）；单次续打实际分支双上只属该固定牌面' });
  const levelRec = wrap('level7-beat', caseLevelCardBeat);
  cases.push({ id: 'r4-cst-level7-beat', provenance: 'constructed', record: levelRec, split: 'dev',
    labels: ['screenshot54_regression', 'level_card_beats_A', 'both_beat_A', 'same_terminal_no_blame'],
    expect: '级7 下 ♣7 与小王都压得过 A（引擎断言）；无成文自纠；实际小王与替代♣7 评分分解各自绑定 actionId；两分支同终局不判错' });
  // 同牌不同声明
  const h3 = [C('S', 8), C('H', 8), C('D', 8)];
  const decl = wrap('same-cards', () => craftRecord([h3, [], [], []], [{ seat: 0, cards: [h3[0], h3[1]] }], [8, 8], 0, 0));
  cases.push({ id: 'r4-cst-same-cards-diff-decl-hook', provenance: 'constructed', record: decl, split: 'dev',
    labels: ['same_cards_diff_decl_hook'], expect: '回放按实际物理牌解释，不与候选强配' });
  // 让队友/接管对照（对手接近走完 vs 队友接近走完）
  const eastK2 = C('S', 13);
  const blockRec = wrap('block', () => craftRecord([[C('S', 3)], [eastK2, C('H', 13)], [C('C', 5)], [C('D', 6)]],
    [{ seat: 1, cards: [eastK2] }], [4, 4], 1, 0));
  cases.push({ id: 'r4-cst-block-finish-context', provenance: 'constructed', record: blockRec, split: 'dev',
    labels: ['must_take_over_context'], expect: '对手接近走完情景：教学给"阻止收尾"条件计划，不硬规则' });
  const mateC9 = C('C', 9);
  const letMate = wrap('let-mate', () => craftRecord([[C('S', 3)], [C('D', 5)], [mateC9], [C('H', 9)]],
    [{ seat: 2, cards: [mateC9] }, { seat: 3, pass: true }], [5, 5], 2, 0));
  cases.push({ id: 'r4-cst-let-mate-continue', provenance: 'constructed', record: letMate, split: 'dev',
    labels: ['let_mate_continue_context'], expect: '队友有理情景：呈现"让队友保留出牌轮"的条件计划' });

  // exact+uncovered（D6 fault-injection）：同 level7 牌面，但模型候选快照显式丢弃"单张16（小王）"
  const uncoveredRec = caseLevelCardBeat();
  cases.push({ id: 'r4-cst-uncovered-faultinjected', provenance: 'constructed', record: uncoveredRec, split: 'dev',
    labels: ['exact_uncovered_fault_injected'],
    expect: '实际动作合法但不在（故障注入的）候选快照：uncovered 不判错、只讲规则层结构；不计生产覆盖率',
    faultDrop: ['single:16'] });

  // 落盘
  const index: Array<Record<string, unknown>> = [];
  for (const c of cases) {
    const file = `records/${c.id}.json`;
    writeFileSync(join(CASES, file), JSON.stringify(c.record));
    index.push({
      caseId: c.id, recordId: c.record.id, recordFile: file,
      provenance: c.provenance, split: c.split, labels: c.labels, expect: c.expect,
      faultDropComboKeyPrefix: c.faultDrop,
      moves: c.record.moves.length, humanSeat: c.record.humanSeat,
    });
  }
  const devN = cases.filter((c) => c.split === 'dev').length;
  writeFileSync(join(CASES, 'case-index.json'), JSON.stringify({
    version: 'review4-cases-1.0', at: new Date().toISOString(),
    total: cases.length, dev: devN, holdout: cases.length - devN,
    matchIsolation: '同一 matchId 只进一个 split（generated 一局一 match；constructed 无跨split）',
    screenshots: '第22/54手原谱 unavailable（用户 localStorage 未导出）→ constructed 同类回归（r4-cst-bomb-vs-pass / r4-cst-level7-beat），不冒充原事故复现',
    cases: index,
  }, null, 1));

  // 子包：semantic-index（facts 目标=每案例分歧最大+亮点手）
  writeFileSync(join(CASES, 'semantic-index.json'), JSON.stringify({
    version: 'review4-semantic-1.0', budget: { maxApiCalls: 0 }, mode: 'facts',
    cases: index.map((c) => ({ id: c.caseId, recordFile: `records/${c.caseId}.json`, expect: c.expect, faultDropComboKeyPrefix: c.faultDropComboKeyPrefix })),
  }, null, 1));
  // rollout-pilot（sampled 目标：dev 子集 3 案例 × 1 决策 × 64 世界）
  const pilot = index.filter((c) => (c.labels as string[]).some((l) => l.startsWith('screenshot') || l.includes('disagreement') || l.includes('must_take_over'))).slice(0, 3);
  writeFileSync(join(CASES, 'rollout-pilot.json'), JSON.stringify({
    version: 'review4-rollout-1.0', mode: 'sampled', samples: 64, maxMoves: 3, maxActions: 3,
    cases: pilot.map((c) => ({ id: c.caseId, recordFile: `records/${c.caseId}.json` })),
  }, null, 1));
  console.log(`case pack: ${cases.length} 案例（dev ${devN} / holdout ${cases.length - devN}）→ ${CASES}`);
}
main();
