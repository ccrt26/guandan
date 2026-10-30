/**
 * lab/src/bomb_replay.ts — 2026-10-28 用户截图局取证：北(2)用4Q炸南(0)三K，是坑还是深思熟虑。
 *
 * 背景事实（截图细读 + 逻辑推论）：
 *  - 全新比赛第 1 局（顶部"第 1 局 · 第 16 手"）→ 无进贡；打 2（双方 2）；红心级牌=万能牌。
 *  - 南（用户，autopilot-L1）剩 23 张，领出 ♣K♥K♠K 三张 K（花色细读两次不一致，跑双变体）；
 *    东已过牌（轮序南→东→北，轮到北时上家组合仍是南的三K ⇒ 东必已过）；
 *    北（neural-hard，ε=0 满血）剩 15 张（打出 4Q 后 11），打出 ♠Q♥Q♦Q♣Q 炸弹。
 *  - 该局是浏览器内存里的随机种子（新比赛未落盘、中途退出）→ 原局不可整局重放；
 *    南的 23 张手牌全部可读（截图），四家剩牌数已知 → 决策点可按"信息集抽样"重建（R4 方法论）。
 *
 * 两部分：
 *  A. reconstruct —— 对截图决策点做信息集抽样：北的 15 张=4Q 固定+11 张从守恒牌池均匀抽，
 *     东 26/西 24 均匀抽、余 17 张视为已出（暗牌历史），每份用部署权重 clean2 给北的全候选打分。
 *     回答：模型在这种局面下给"炸"和"不出"的定价差多少、有多稳。
 *  B. scan —— 大样本全新对局（席位装配=产品口径：0=L1 启发式、1/3=standard ε0.3、2=hard ε0），
 *     找所有"南的牌东不要、北用炸弹压南"事件，记录 Q 差，并对每个事件做成对反事实
 *     （同一局同种子重放，该手强制改不出）：炸/不炸哪边赢。回答：这是不是习惯性打法、赚不赚。
 *
 * 用法（repo 根目录）：
 *   npx tsx lab/src/bomb_replay.ts reconstruct [--samples 200]
 *   npx tsx lab/src/bomb_replay.ts scan [--games 60]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMove, canPass, completeReturn, createMatch, describeCombo, makeLevelCtx, pickReturnCard,
  RANK_NAME, RNG, startGame, bestResponse,
  type Card, type Combo, type GameState, type Move, type RuleOptions, type Suit,
} from '@gd/engine';
import {
  createAI, createNeuralAI, LEVEL_CAPS, MLP, mulberry32, physIdx, PlayMemory,
  NeuralDecider, scoreCandidates, type AIPlayer, type ScoredMove,
} from '@gd/ai';

const ROOT = join(import.meta.dirname, '..', '..');
const WEIGHTS_PATH = join(ROOT, 'packages/web/public/ai/clean2.f32');

const rawW = readFileSync(WEIGHTS_PATH);
const wBuf = new ArrayBuffer(rawW.byteLength);
new Uint8Array(wBuf).set(rawW);

const RULES: RuleOptions = {
  flushLen: 5, levelMode: 'stage', pairSeqMax: 3, pairSeqMin: 3,
  passA: 'head3', straightLen: 5, trioSeqMax: 2, trioSeqMin: 2,
};

// ---------- 牌张工具 ----------
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
/** 两副牌 108 张（id 唯一；同物理牌两副本 id 不同但 suit/rank 相同） */
function fullDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) cards.push({ id: id++, suit, rank });
    cards.push({ id: id++, suit: 'J', rank: 16 });
    cards.push({ id: id++, suit: 'J', rank: 17 });
  }
  return cards;
}
function cardText(c: Card): string {
  if (c.suit === 'J') return c.rank === 17 ? '大王' : '小王';
  return `${{ S: '♠', H: '♥', D: '♦', C: '♣', J: 'J' }[c.suit]}${RANK_NAME[c.rank]}`;
}
function handText(hand: Card[]): string { return hand.map(cardText).join(' '); }
function moveText(m: Move): string { return m.pass ? '不出' : describeCombo(m.combo!); }
const SEAT = ['南(你/L1)', '东(neural-standard)', '北(队友/neural-hard)', '西(neural-standard)'];

function findCards(deck: Card[], spec: Array<[Suit, number]>): Card[] {
  const used = new Set<number>();
  return spec.map(([s, r]) => {
    const c = deck.find((x) => x.suit === s && x.rank === r && !used.has(x.id))!;
    used.add(c.id);
    return c;
  });
}

// ---------- 模型 ----------
function newDecider(seat: number): NeuralDecider {
  const mlp = new MLP(1);
  mlp.setWeights(new Float32Array(wBuf));
  return new NeuralDecider(seat, mlp, 0, () => 0);
}
function rankOf(decider: NeuralDecider, state: GameState): Array<{ score: number; text: string; kind: string; combo: Combo | null }> {
  return decider.decide(state, { wantRanking: true }).ranking!
    .map((x) => ({ score: +x.score.toFixed(4), text: x.combo ? describeCombo(x.combo) : '不出', kind: x.combo ? x.combo.kind : 'pass', combo: x.combo }));
}
function heuristicTop(state: GameState, seat: number, mem: PlayMemory): ScoredMove[] {
  mem.syncState(state);
  return scoreCandidates({ state, seat, caps: { ...LEVEL_CAPS[1], noise: 0 }, memory: mem, rand: () => 0, explain: false });
}

// ============================================================
// A. 截图决策点重建（信息集抽样，R4 口径：守恒+均匀分配+只评北的一个决策）
// ============================================================
function cmdReconstruct(nSamples: number): void {
  // 南的 23 张手牌（截图细读；第 4 张 A 花色两读不一致 → 双变体）
  const southSpec: Array<[Suit, number]> = [
    ['S', 3], ['S', 4], ['S', 5],
    ['D', 6], ['D', 6], ['C', 6],
    ['D', 7], ['D', 7], ['H', 7], ['S', 7], ['C', 7],
    ['D', 8], ['C', 9], ['H', 9], ['S', 9],
    ['D', 10], ['D', 10], ['C', 12],
    ['H', 14], ['H', 14], ['S', 14], ['C', 14],
    ['H', 2],
  ];
  const trioVariants: Array<[Suit, number][]> = [
    [['C', 13], ['H', 13], ['S', 13]], // 细读：♣K♥K♠K
    [['C', 13], ['D', 13], ['S', 13]], // 首读：♣K♦K♠K
  ];
  const northQ: Array<[Suit, number]> = [['S', 12], ['H', 12], ['D', 12], ['C', 12]];

  interface VariantResult {
    variant: string;
    bombTop: number; passTop: number; otherTop: number;
    qGap: number[]; // Q(4Q炸) - Q(不出)，正=模型更想炸
    passRankSum: number; heurPassTop: number; heurBombTop: number;
    sampleTop1: Map<string, number>;
  }
  const results: VariantResult[] = [];

  for (let v = 0; v < 2; v++) {
    const trioSpec = trioVariants[v];
    const res: VariantResult = {
      variant: `三K=${trioSpec.map(([s, r]) => cardText({ id: -1, suit: s, rank: r })).join('')}`,
      bombTop: 0, passTop: 0, otherTop: 0, qGap: [], passRankSum: 0,
      heurPassTop: 0, heurBombTop: 0, sampleTop1: new Map(),
    };
    for (let s = 0; s < nSamples; s++) {
      const rng = new RNG(0x5eed_0000 ^ (v * 7919) ^ (s * 104729));
      const deck = fullDeck();
      const south = findCards(deck, southSpec);
      const trio = findCards(deck, trioSpec);
      const bombs = findCards(deck, northQ);
      const taken = new Set([...south, ...trio, ...bombs].map((c) => c.id));
      const pool = deck.filter((c) => !taken.has(c.id)); // 78 张
      // 洗牌：北 11（4Q 之外的暗牌）、东 26、西 24、余 17=已出
      const shuffled = rng.shuffle(pool.slice());
      let p = 0;
      const northRest = shuffled.slice(p, p + 11); p += 11;
      const east = shuffled.slice(p, p + 26); p += 26;
      const west = shuffled.slice(p, p + 24); p += 24;
      const dead = shuffled.slice(p); // 17 张（含北此前打出的 12 张与其他三家早前出牌）

      const match = createMatch(RULES, 1);
      match.levels = [2, 2]; match.gameNo = 1; match.lastHead = null; match.lastResult = null;
      const ctx = makeLevelCtx([2, 2], 'stage', 0);
      const kkCombo = bestResponse(trio, null, ctx, RULES)!;
      const state: GameState = {
        match, ctx, levelsBefore: [2, 2], stageTeam: 0,
        hands: [south.slice(), east.slice(), [...bombs, ...northRest], west.slice()],
        turn: 2, leader: 0, lastCombo: kkCombo, lastPlayer: 0, passCount: 1,
        trickPlays: [
          { player: 0, combo: kkCombo },
          { player: 1, combo: null },
        ],
        finished: [], over: false, result: null, moveNo: 16,
        tribute: null, pendingReturns: [],
      };
      if (state.hands.some((h) => h.length !== [23, 26, 15, 24][state.hands.indexOf(h)])) throw new Error('手牌数守恒失败');

      // 北的观察流：本轮(南三K→东过) + 早前 17 张已出（无历史明细 → 环形记录只含本轮，如实近似）
      const decider = newDecider(2);
      decider.tracker.observe([{ type: 'play', player: 0, combo: kkCombo }, { type: 'pass', player: 1 }]);
      for (const c of [...dead, ...trio]) decider.tracker.played[physIdx(c)] += 1;

      const rank = rankOf(decider, state);
      const top = rank[0];
      const passEntry = rank.find((x) => x.kind === 'pass')!;
      const qBombEntry = rank.find((x) => x.kind === 'bomb' || x.kind === 'joker_bomb')!; // 手里必有 4Q → 必有炸弹候选
      res.qGap.push(qBombEntry.score - passEntry.score);
      res.passRankSum += rank.indexOf(passEntry) + 1;
      if (top.kind === 'bomb' || top.kind === 'joker_bomb') res.bombTop += 1;
      else if (top.kind === 'pass') res.passTop += 1;
      else res.otherTop += 1;
      const key = top.text;
      res.sampleTop1.set(key, (res.sampleTop1.get(key) ?? 0) + 1);

      const mem = PlayMemory.fromStart(ctx);
      const heur = heuristicTop(state, 2, mem);
      const hTop = heur[0];
      if (hTop.move.pass) res.heurPassTop += 1;
      else if (!hTop.move.pass && (hTop.move.combo!.kind === 'bomb' || hTop.move.combo!.kind === 'joker_bomb')) res.heurBombTop += 1;

      if (s === 0) {
        console.log(`\n[样例 0 局面] ${res.variant}`);
        console.log(`  北(15张): ${handText(state.hands[2])}`);
        console.log(`  待压: ${describeCombo(kkCombo)}（南领出，东已过）  剩牌 23/26/15/24`);
        console.log(`  [模型排名前 8]（共 ${rank.length} 候选）`);
        rank.slice(0, 8).forEach((x, i) => console.log(`    ${i + 1}. ${x.text}  Q=${x.score}`));
        console.log(`    ……「不出」排第 ${rank.indexOf(passEntry) + 1} 名 Q=${passEntry.score}；首个炸弹「${qBombEntry.text}」排第 ${rank.indexOf(qBombEntry) + 1} Q=${qBombEntry.score}`);
        console.log(`  [启发式中级口径首选] ${moveText(heur[0].move)}（score=${heur[0].score.toFixed(1)}；不出排第 ${heur.findIndex((x) => x.move.pass) + 1}）`);
      }
    }
    results.push(res);
  }

  console.log(`\n===== 信息集抽样汇总（每变体 ${nSamples} 份暗牌分配）=====`);
  for (const r of results) {
    const gaps = r.qGap.slice().sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)];
    console.log(`${r.variant}:`);
    console.log(`  模型第一名=炸弹 ${r.bombTop}/${nSamples}；=不出 ${r.passTop}/${nSamples}；=其他 ${r.otherTop}/${nSamples}`);
    console.log(`  Q(4Q炸)-Q(不出): 中位 ${med.toFixed(3)}，最小 ${gaps[0].toFixed(3)}，最大 ${gaps[gaps.length - 1].toFixed(3)}，负值 ${(gaps.filter((g) => g < 0).length)}/${nSamples}`);
    console.log(`  「不出」平均排第 ${(r.passRankSum / nSamples).toFixed(1)} 名`);
    console.log(`  启发式中级口径首选: 不出 ${r.heurPassTop}/${nSamples}，炸弹 ${r.heurBombTop}/${nSamples}`);
    const tops = [...r.sampleTop1.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`  模型第一名分布: ${tops.map(([k, n]) => `${k}×${n}`).join('、')}`);
  }
  writeFileSync(join(ROOT, 'lab/review2/bomb_reconstruct.json'), JSON.stringify({
    kind: 'reconstruct', samples: nSamples,
    results: results.map((r) => ({ ...r, sampleTop1: [...r.sampleTop1.entries()], qGap: undefined })),
  }, null, 1));
  console.log(`\n写出 lab/review2/bomb_reconstruct.json`);
}

// ============================================================
// B. 大样本扫描：全新对局里"北炸南（东不要）"事件 + 成对反事实
// ============================================================
interface GameRig {
  state: GameState;
  players: Map<number, AIPlayer>;
  decider2: NeuralDecider;
  moveIdx: number;
}

function buildFreshRig(matchSeed: number, seat0Seed: number): GameRig {
  const match = createMatch(RULES, matchSeed); // 第 1 局：lastHead/lastResult=null，无进贡
  const state = startGame(match, []);
  const tierRand = mulberry32((match.rngState ^ (match.gameNo * 0x9e37) ^ 0x71ea) >>> 0);
  const players = new Map<number, AIPlayer>();
  players.set(0, createAI(0, 1, seat0Seed));
  players.set(1, createNeuralAI(1, wBuf, 'standard', tierRand));
  players.set(2, createNeuralAI(2, wBuf, 'hard', tierRand));
  players.set(3, createNeuralAI(3, wBuf, 'standard', tierRand));
  for (const ai of players.values()) ai.reset(state, match.opts);
  return { state, players, decider2: newDecider(2), moveIdx: 0 };
}

interface RunOpts {
  seat2Hook?: (rig: GameRig) => Move | undefined;
}
function runReplay(rig: GameRig, opts: RunOpts = {}): void {
  const { state } = rig;
  let guard = 0;
  while (!state.over && guard++ < 3000) {
    if (state.pendingReturns.length > 0) {
      const p = state.pendingReturns[0];
      completeReturn(state, pickReturnCard(state, p.from));
      continue;
    }
    const toBeat = state.lastCombo;
    const mover = state.turn;
    let move: Move;
    if (mover === 2) {
      const forced = opts.seat2Hook?.(rig);
      move = forced ?? rig.players.get(2)!.decide(state);
    } else {
      move = rig.players.get(mover)!.decide(state);
    }
    const events = applyMove(state, move);
    rig.decider2.observe(events);
    for (const ai of rig.players.values()) ai.observe(events, toBeat);
    rig.moveIdx += 1;
  }
}

interface EventRecord {
  game: number; moveIdx: number; toBeat: string; bomb: string;
  qGap: number; passRank: number; nCands: number;
  heurTop: string;
  bombWin: boolean; passWin: boolean;
  bombRanks: number[]; passRanks: number[];
}

function cmdScan(nGames: number): void {
  const events: EventRecord[] = [];
  let gamesWithEvent = 0;
  for (let g = 1; g <= nGames; g++) {
    const matchSeed = g * 1_000_003;
    const seat0Seed = g * 7_613_951;
    // 实际分支：检测事件（北用炸弹压"南的、东已不要"的牌）
    let firstEvent: { moveIdx: number; toBeat: string; bomb: string; qGap: number; passRank: number; nCands: number; heurTop: string } | null = null;
    const rigA = buildFreshRig(matchSeed, seat0Seed);
    runReplay(rigA, {
      seat2Hook: (r) => {
        if (firstEvent) return undefined;
        const s = r.state;
        if (s.lastPlayer === 0 && s.lastCombo && s.turn === 2) {
          const rank = rankOf(r.decider2, s);
          const top = rank[0];
          if (top.kind === 'bomb' || top.kind === 'joker_bomb') {
            const passEntry = rank.find((x) => x.kind === 'pass');
            firstEvent = {
              moveIdx: r.moveIdx,
              toBeat: describeCombo(s.lastCombo),
              bomb: top.text,
              qGap: +(passEntry ? top.score - passEntry.score : NaN).toFixed(4),
              passRank: passEntry ? rank.indexOf(passEntry) + 1 : -1,
              nCands: rank.length,
              heurTop: '',
            };
          }
        }
        return undefined;
      },
    });
    if (!firstEvent) continue;
    gamesWithEvent += 1;
    // 反事实分支：同一局重放，该手强制"不出"
    const rigB = buildFreshRig(matchSeed, seat0Seed);
    runReplay(rigB, {
      seat2Hook: (r) => (r.moveIdx === firstEvent!.moveIdx ? { pass: true } : undefined),
    });
    const ra = rigA.state.result!, rb = rigB.state.result!;
    events.push({
      game: g, ...firstEvent, heurTop: '',
      bombWin: ra.winnerTeam === 0, passWin: rb.winnerTeam === 0,
      bombRanks: ra.finishOrder, passRanks: rb.finishOrder,
    });
  }

  console.log(`\n===== ${nGames} 局全新对局扫描（第 1 局、产品席位口径）=====`);
  console.log(`发生"北用炸弹压南（东已不要）"的局数: ${gamesWithEvent}/${nGames}`);
  for (const e of events) {
    console.log(`  局${e.game} 手#${e.moveIdx} 南出${e.toBeat} → 北炸${e.bomb}  Q差=${e.qGap} 不出排第${e.passRank}/${e.nCands}  炸→南北${e.bombWin ? '胜' : '负'}(${e.bombRanks.join(',')}) 改不出→南北${e.passWin ? '胜' : '负'}(${e.passRanks.join(',')})`);
  }
  const both = events.filter((e) => e.bombWin && e.passWin).length;
  const onlyBomb = events.filter((e) => e.bombWin && !e.passWin).length;
  const onlyPass = events.filter((e) => !e.bombWin && e.passWin).length;
  const neither = events.filter((e) => !e.bombWin && !e.passWin).length;
  const gaps = events.map((e) => e.qGap).filter((x) => !Number.isNaN(x));
  if (gaps.length > 0) {
    const s = gaps.slice().sort((a, b) => a - b);
    console.log(`\nQ差(炸-不出): 中位 ${s[Math.floor(s.length / 2)].toFixed(3)} 最小 ${s[0].toFixed(3)} 最大 ${s[s.length - 1].toFixed(3)}`);
  }
  console.log(`成对反事实: 两打都胜 ${both}；只有炸胜 ${onlyBomb}；只有不炸胜 ${onlyPass}；两打都负 ${neither}`);
  writeFileSync(join(ROOT, 'lab/review2/bomb_scan.json'), JSON.stringify({ kind: 'scan', nGames, gamesWithEvent, events, paired: { both, onlyBomb, onlyPass, neither } }, null, 1));
  console.log(`写出 lab/review2/bomb_scan.json`);
}

// ---------------- main ----------------
const [cmd, ...args] = process.argv.slice(2);
function opt(name: string, dflt: number): number {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
}
if (cmd === 'reconstruct') cmdReconstruct(opt('samples', 200));
else if (cmd === 'scan') cmdScan(opt('games', 60));
else { console.error('用法: reconstruct [--samples N] | scan [--games N]'); process.exit(2); }
