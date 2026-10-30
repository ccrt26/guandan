/** 量化守卫替换的实际影响：触发率 vs 语义改变率 */
import { canPass, createMatch, DEFAULT_RULES, legalCombos, startGame, applyMove, comboKey } from '@gd/engine';
import { createAI, MLP } from '@gd/ai';
import { NeuralSeat } from './seat';
import { mulberry32 } from '@gd/ai';

const wfile = await import('node:fs').then(fs => fs.readFileSync('lab/round2/armA_end/weights.f32'));
const w = new Float32Array(wfile.buffer.slice(wfile.byteOffset, wfile.byteOffset + wfile.byteLength));
const mlp = new MLP(1); mlp.setWeights(w);

// 评测式对局：armA(neat) + 启发式，统计两家的"守卫触发但语义未变"占比
const stats = { neural: { fires: 0, changed: 0, nonPass: 0 }, heur: { fires: 0, changed: 0, nonPass: 0 } };
const match = createMatch({ ...DEFAULT_RULES }, 4242);
const neuralSide = 0;
const rand = mulberry32(7);
const neural = [0,1,2,3].map(s => new NeuralSeat(s, mlp, 0, rand));
const heur = [0,1,2,3].map(s => createAI(s, 1, (4242*31+s)>>>0));
let games = 0;
while (match.winner == null && games < 6) {
  const state = startGame(match);
  heur.forEach(p=>p.reset(state, match.opts));
  neural.forEach(s=>s.newGame());
  let guard = 0;
  while (!state.over && guard++ < 2500) {
    const turn = state.turn;
    const isNeural = (turn & 1) === neuralSide;
    const raw = isNeural ? neural[turn].decide(state).move : heur[turn].decide(state) as never;
    const st = isNeural ? stats.neural : stats.heur;
    const legal = legalCombos(state);
    if (!raw.pass) {
      st.nonPass++;
      if (!legal.some(c => c === raw.combo)) {
        st.fires++;
        if (comboKey(legal[0]) !== comboKey(raw.combo)) st.changed++;
      }
    }
    // 用值守卫推进（新链路）
    const ok1 = raw.pass ? canPass(state) : legal.some(c => comboKey(c) === comboKey(raw.combo));
    let mv = raw;
    if (!ok1) mv = legal.length > 0 ? { pass: false, combo: legal[0] } as never : { pass: true } as never;
    const toBeat = state.lastCombo;
    const events = applyMove(state, mv as never);
    neural.forEach(s=>s.observe(events));
    heur.forEach(p=>p.observe(events, toBeat));
  }
  games++;
}
for (const [k, s] of Object.entries(stats)) {
  console.log(`${k}: 非pass ${s.nonPass} | 旧守卫触发 ${s.fires}（${(s.fires/s.nonPass*100).toFixed(1)}%）| 触发且语义改变 ${s.changed}（${(s.changed/s.nonPass*100).toFixed(1)}%）`);
}
