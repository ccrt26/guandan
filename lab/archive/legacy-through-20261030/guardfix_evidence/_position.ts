/** 定位：armA vs 初级；真中级 vs 真初级（验证评测台）；启发式侧守卫回退计数 */
import { readFileSync } from 'node:fs';
import { applyMove, createMatch, DEFAULT_RULES, startGame } from '@gd/engine';
import { createAI, guardMove, isMoveLegal, MLP, mulberry32 } from '@gd/ai';
import { NeuralSeat } from './seat';

const wbuf = readFileSync('lab/round2/armA_end/weights.f32');
const w = new Float32Array(wbuf.buffer.slice(wbuf.byteOffset, wbuf.byteOffset + wbuf.byteLength));
const mlp = new MLP(1); mlp.setWeights(w);

function runMatch(config: { matchSeed: number; make: (seat: number, matchSeed: number) => { decide: (s: never) => unknown; reset: (...a: never[]) => void; observe: (...a: never[]) => void } }, sideTeam: 0 | 1): number {
  const match = createMatch({ ...DEFAULT_RULES }, config.matchSeed);
  const ais = [0, 1, 2, 3].map((s) => config.make(s, config.matchSeed));
  let games = 0, heurIllegal = 0;
  while (match.winner == null && games < 80) {
    const state = startGame(match);
    for (const p of ais) {
      if (p && typeof (p as { newGame?: () => void }).newGame === 'function') (p as unknown as { newGame: () => void }).newGame();
      else (p as unknown as { reset: (a: never, b: never) => void }).reset(state as never, match.opts as never);
    }
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const raw = ais[state.turn].decide(state as never);
      if (!(ais[state.turn] as unknown as { isNeural?: boolean }).isNeural && !isMoveLegal(state as never, raw as never)) heurIllegal++;
      const mv = guardMove(state as never, raw as never);
      const toBeat = state.lastCombo;
      const events = applyMove(state, mv as never);
      ais.forEach((p) => p.observe(events, toBeat) as never);
    }
    games++;
  }
  void heurIllegal;
  return match.winner === sideTeam ? 1 : 0;
}

// 1) armA(整队) vs 初级
{
  let wins = 0, n = 0;
  for (let base = 1; base <= 12; base++) for (const side of [0, 1] as const) {
    const ms = base * 2 + side;
    const r = runMatch({
      matchSeed: ms,
      make: (seat, seed) => (seat & 1) === side
        ? new NeuralSeat(seat, mlp, 0, mulberry32(seed ^ 0x5f5f)) as never
        : createAI(seat, 0, (seed * 31 + seat) >>> 0) as never,
    }, side);
    wins += r; n++;
  }
  console.log(`armA 整队 vs 初级启发式: ${wins}/${n}`);
}
// 2) 真中级 vs 真初级（同台，验证测试台区分度）
{
  let wins = 0, n = 0;
  for (let base = 1; base <= 12; base++) for (const side of [0, 1] as const) {
    const ms = base * 2 + side + 500000;
    const r = runMatch({
      matchSeed: ms,
      make: (seat, seed) => (seat & 1) === side
        ? createAI(seat, 1, (seed * 31 + seat) >>> 0) as never
        : createAI(seat, 0, (seed * 31 + seat) >>> 0) as never,
    }, side);
    wins += r; n++;
  }
  console.log(`真中级 vs 真初级（同台修复后）: ${wins}/${n}`);
}
