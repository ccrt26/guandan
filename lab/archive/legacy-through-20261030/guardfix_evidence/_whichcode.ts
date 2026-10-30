/** 判定昨晚 dev 结果由哪版守卫产生：对首场种子分别用新旧守卫复现 */
import { readFileSync } from 'node:fs';
import { applyMove, canPass, comboKey, createMatch, DEFAULT_RULES, legalCombos, startGame } from '@gd/engine';
import { createAI } from '@gd/ai';
import { MLP, mulberry32 } from '@gd/ai';
import { NeuralSeat } from './seat';

const wbuf = readFileSync('lab/out/deploy_final/weights.f32');
const w = new Float32Array(wbuf.buffer.slice(wbuf.byteOffset, wbuf.byteOffset + wbuf.byteLength));
const mlp = new MLP(1); mlp.setWeights(w);

const stored = JSON.parse(readFileSync('lab/round2_bugregime/dev_final_perseed.jsonl', 'utf8').split('\n')[0]);
console.log('存档首场:', JSON.stringify({ seed: stored.seed, win: stored.win, games: stored.games, moves: stored.moves }));

function run(matchSeed: number, neuralSide: 0 | 1, oldGuard: boolean) {
  const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
  const rand = mulberry32(matchSeed ^ 0x5f5f);
  const neural = [0,1,2,3].map(s => new NeuralSeat(s, mlp, 0, rand));
  const heur = [0,1,2,3].map(s => createAI(s, 1, (matchSeed*31+s)>>>0));
  let games = 0, moves = 0;
  while (match.winner == null && games < 80) {
    const state = startGame(match);
    heur.forEach(p=>p.reset(state, match.opts));
    neural.forEach(s=>s.newGame());
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const turn = state.turn;
      const toBeat = state.lastCombo;
      const isNeural = (turn & 1) === neuralSide;
      const raw = isNeural ? neural[turn].decide(state).move : heur[turn].decide(state) as never;
      let mv = raw;
      if (oldGuard) {
        const legal = legalCombos(state);
        if (mv.pass && !canPass(state)) mv = { pass: false, combo: legal[0] } as never;
        else if (!mv.pass && !legal.some(c => c === (mv as never).combo)) mv = legal.length > 0 ? { pass: false, combo: legal[0] } as never : { pass: true } as never;
      } else {
        const legal = legalCombos(state);
        const ok = mv.pass ? canPass(state) : legal.some(c => comboKey(c) === comboKey((mv as never).combo));
        if (!ok) mv = legal.length > 0 ? { pass: false, combo: legal[0] } as never : { pass: true } as never;
      }
      const events = applyMove(state, mv as never);
      moves++;
      neural.forEach(s=>s.observe(events));
      heur.forEach(p=>p.observe(events, toBeat));
    }
    games++;
  }
  return { win: match.winner === neuralSide ? 1 : 0, games, moves };
}

const s = stored.seed as number;
const side = stored.side as 0 | 1;
const oldR = run(s, side, true);
const newR = run(s, side, false);
console.log('旧守卫复现:', JSON.stringify(oldR), oldR.win === stored.win && oldR.games === stored.games && oldR.moves === stored.moves ? '← 与存档一致' : '');
console.log('新守卫复现:', JSON.stringify(newR), newR.win === stored.win && newR.games === stored.games && newR.moves === stored.moves ? '← 与存档一致' : '');
