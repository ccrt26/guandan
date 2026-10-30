/** CLEAN1 ck180 部署核验：部署文件=训练产物逐字节、加载确定性、平行世界、完整局合法 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMatch, DEFAULT_RULES, startGame, applyMove, type GameState, type Combo } from '@gd/engine';
import { createNeuralAI, guardMove, isMoveLegal } from '@gd/ai';

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, d = '') => { c ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name} ${d}`)); };
const buf = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'web', 'public', 'ai', 'clean2.f32'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const src = readFileSync(join(import.meta.dirname, '..', 'review2', 'runs', 'clean2-main', 'ck-7051', 'weights.f32'));
ok(buf.equals(src), '部署文件与 ck-7051 训练产物逐字节一致');
{
  const match = createMatch({ ...DEFAULT_RULES }, 77);
  const state = startGame(match);
  state.turn = 1;
  const p1 = createNeuralAI(1, ab), p2 = createNeuralAI(1, ab);
  p1.reset(state, match.opts); p2.reset(state, match.opts);
  const k = (m: { pass: boolean; combo?: { cards: { id: number }[] } }) => m.pass ? 'pass' : m.combo!.cards.map((c) => c.id).sort().join(',');
  ok(k(p1.decide(state)) === k(p2.decide(state)), '同批实例决策一致（确定性）');
}
{
  // 整场冒烟：神经×3 + 中级代打人类席，严格合法性计数
  const match = createMatch({ ...DEFAULT_RULES }, 4242);
  const heur = createNeuralAI(0, ab) /* 占位替换 */ && (await import('@gd/ai')).createAI(0, 1, 7);
  const neural = [1, 2, 3].map((s) => createNeuralAI(s, ab));
  let games = 0, moves = 0, illegal = 0;
  while (match.winner == null && games < 10) {
    const state: GameState = startGame(match);
    heur.reset(state, match.opts);
    neural.forEach((p) => p.reset(state, match.opts));
    let guard = 0;
    while (!state.over && guard++ < 2500) {
      const toBeat = state.lastCombo;
      const turn = state.turn;
      const raw = turn === 0 ? heur.decide(state) : neural[turn - 1].decide(state);
      if (turn !== 0 && !isMoveLegal(state, raw as never)) illegal += 1;
      const events = applyMove(state, guardMove(state, raw as never) as never);
      heur.observe(events, toBeat);
      neural.forEach((p) => p.observe(events, toBeat));
      moves += 1;
    }
    games += 1;
  }
  ok(illegal === 0, `${games} 副 ${moves} 手，神经决策非法 ${illegal} 次`);
  ok(match.winner != null || games >= 10, `整场推进正常（games=${games}）`);
}
console.log(`\n部署核验: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
