/**
 * AI 自对弈验收：胜率阶梯 + 性能测量。
 * 用法: npx tsx scripts/selfplay.ts <A队难度0-2> <B队难度0-2> <局数>
 * 座位 0,2 = A 队；1,3 = B 队。
 */
import { applyMove, createMatch, startGame, DEFAULT_RULES, RNG, randomSeed } from '@gd/engine';
import { createAI, guardMove } from '@gd/ai';
import type { Difficulty } from '@gd/ai';

function parseDiff(v: string | undefined, dflt: number): Difficulty {
  const n = Number.parseInt(v ?? '', 10);
  return (Number.isFinite(n) && n >= 0 && n <= 2 ? n : dflt) as Difficulty;
}
const aDiff = parseDiff(process.argv[2], 1);
const bDiff = parseDiff(process.argv[3], 0);
const games = Number.parseInt(process.argv[4] ?? '50', 10) || 50;

const seed = randomSeed();
const rng = new RNG(seed);
let winsA = 0;
let winsB = 0;
let totalMoves = 0;
let totalMs = 0;
const t0 = performance.now();

for (let g = 0; g < games; g++) {
  const match = createMatch({ ...DEFAULT_RULES }, rng.next() * 0xffffffff);
  const state = startGame(match);
  const players = [0, 1, 2, 3].map((s) => createAI(s, ((s % 2 === 0 ? aDiff : bDiff) as Difficulty), (rng.next() * 0xffffffff) | 0));
  players.forEach((p) => p.reset(state, match.opts));
  let moves = 0;
  let guard = 0;
  while (!state.over && guard++ < 2000) {
    const player = players[state.turn];
    // 值校验防御（2026-10-26 修复：旧引用比较对非pass出牌 100% 误判并改写为 legal[0]）
    const move = guardMove(state, player.decide(state));
    const toBeat = state.lastCombo;
    const events = applyMove(state, move);
    moves += 1;
    players.forEach((p) => p.observe(events, toBeat));
  }
  totalMoves += moves;
  if (state.result) {
    if (state.result.winnerTeam === 0) winsA += 1;
    else winsB += 1;
  }
}

totalMs = performance.now() - t0;
console.log(`A队难度${aDiff} vs B队难度${bDiff} · ${games} 局`);
console.log(`A 胜 ${winsA} (${((winsA / games) * 100).toFixed(1)}%) | B 胜 ${winsB} (${((winsB / games) * 100).toFixed(1)}%)`);
console.log(`平均手数 ${(totalMoves / games).toFixed(1)}，总耗时 ${(totalMs / 1000).toFixed(1)}s，平均 ${(totalMs / games).toFixed(0)}ms/局，${((games / (totalMs / 1000)) | 0)} 局/秒`);
