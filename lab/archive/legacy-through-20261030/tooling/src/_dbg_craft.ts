// 最小复现：案例1 剧本在补牌后第 7 步失败的原因
import { bestResponse, buildDeck, createMatch, DEFAULT_RULES, startGame, applyMove, beats, type Card, type Suit } from '@gd/engine';
let nid = 70000;
const C = (s: Suit, r: number): Card => ({ id: nid++, suit: s, rank: r });
const hand = [C('S', 9), C('H', 9), C('S', 3)];
const hands = [hand, [C('D', 5), C('C', 5), C('D', 13)], [C('S', 5), C('H', 13), C('D', 3)], [C('C', 9), C('S', 13), C('C', 3)]];
const used = new Set(hands.flat().map((c) => c.id));
const pool = buildDeck().filter((c) => !used.has(c.id));
let pi = 0;
const padded = hands.map((h) => { const out = [...h]; while (out.length < 27) out.push(pool[pi++]); return out; });
const script = [
  { seat: 0, cards: [hand[0], hand[1]] },
  { seat: 1, pass: true }, { seat: 2, pass: true }, { seat: 3, pass: true },
  { seat: 0, cards: [hand[2]] },
  { seat: 1, cards: [padded[1][2]] }, { seat: 2, cards: [padded[2][1]] }, { seat: 3, cards: [padded[3][1]] },
];
const match = createMatch({ ...DEFAULT_RULES }, 42);
match.levels = [6, 6];
const state = startGame(match);
state.hands = padded.map((h) => [...h]);
state.turn = 0; state.leader = 0; state.lastPlayer = 0;
let n = 0;
for (const s of script) {
  n += 1;
  if (state.over) { console.log(`第 ${n} 步：对局已结束`); break; }
  if (state.turn !== s.seat) { console.log(`第 ${n} 步：轮到 ${state.turn} 指定 ${s.seat}；lastCombo=${state.lastCombo?.kind}:${state.lastCombo?.mainRank}；finished=[${state.finished}]`); break; }
  let combo = null;
  if (!s.pass && s.cards) {
    combo = bestResponse(s.cards, state.lastCombo, state.ctx, DEFAULT_RULES);
    if (!combo) { console.log(`第 ${n} 步牌不成型：${s.cards.map((c) => c.suit + c.rank)}；toBeat=${state.lastCombo ? state.lastCombo.kind + ':' + state.lastCombo.mainRank + ' size' + state.lastCombo.size : '领出'}`); break; }
    if (state.lastCombo && !beats(combo, state.lastCombo)) { console.log(`第 ${n} 步压不过`); break; }
  }
  applyMove(state, combo ? { pass: false, combo } : { pass: true });
  console.log(`第 ${n} 步 ok：seat${s.seat} ${s.pass ? 'pass' : combo ? combo.kind + ':' + combo.mainRank : 'pass'}；turn=${state.turn} over=${state.over} finished=[${state.finished}]`);
}
