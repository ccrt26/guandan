/** 合理性检查：新链路下神经出牌合法性率与典型行为 */
import { readFileSync } from 'node:fs';
import { applyMove, createMatch, DEFAULT_RULES, startGame } from '@gd/engine';
import { createAI, guardMove, isMoveLegal, MLP, mulberry32 } from '@gd/ai';
import { NeuralSeat } from './seat';
const wbuf = readFileSync('lab/out/deploy_final/weights.f32');
const w = new Float32Array(wbuf.buffer.slice(wbuf.byteOffset, wbuf.byteOffset + wbuf.byteLength));
const mlp = new MLP(1); mlp.setWeights(w);
const matchSeed = 13802710 * 2 + 0;
const match = createMatch({ ...DEFAULT_RULES }, matchSeed);
const rand = mulberry32(matchSeed ^ 0x5f5f);
const neural = [0,1,2,3].map(s => new NeuralSeat(s, mlp, 0, rand));
const heur = [0,1,2,3].map(s => createAI(s, 1, (matchSeed*31+s)>>>0));
let games = 0, nDec = 0, nPass = 0, nIllegal = 0;
const kindCount: Record<string, number> = {};
while (match.winner == null && games < 10) {
  const state = startGame(match);
  heur.forEach(p=>p.reset(state, match.opts));
  neural.forEach(s=>s.newGame());
  let guard = 0;
  while (!state.over && guard++ < 2500) {
    const turn = state.turn;
    const toBeat = state.lastCombo;
    const isNeural = (turn & 1) === 0;
    const raw = isNeural ? neural[turn].decide(state).move : heur[turn].decide(state) as never;
    if (isNeural) {
      nDec++;
      if (raw.pass) nPass++;
      else { if (!isMoveLegal(state, raw as never)) nIllegal++; kindCount[(raw as never).combo.kind] = (kindCount[(raw as never).combo.kind]||0)+1; }
    }
    const mv = guardMove(state, raw as never);
    const events = applyMove(state, mv as never);
    neural.forEach(s=>s.observe(events));
    heur.forEach(p=>p.observe(events, toBeat));
  }
  games++;
}
console.log(`神经决策 ${nDec}：pass ${nPass}（${(nPass/nDec*100).toFixed(0)}%）非法 ${nIllegal}；出牌分布`, JSON.stringify(kindCount));
