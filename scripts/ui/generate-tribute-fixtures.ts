import { mkdirSync, writeFileSync } from 'node:fs';
import { taskOutput } from '../project-paths.mjs';
import { applyMove, createMatch, DEFAULT_RULES, legalCombos, pickReturnCard, startGame } from '@gd/engine';
import { MatchController } from '../../packages/web/src/game/controller';
import { loadCurrentMatch, type MatchSave } from '../../packages/web/src/game/storage';

// QA only. Cards, finish order and exchange flows all come from the real engine.
// Run: node --import tsx scripts/ui/generate-tribute-fixtures.ts
const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
} });
const out = taskOutput('tribute-fixtures') + '/fixtures/';
mkdirSync(out, { recursive: true });
const found = new Set<number>();
const provenance: { file: string; seed: number; firstFinishOrder: number[]; [key: string]: unknown }[] = [];
for (let seed = 1; seed <= 100 && found.size < 2; seed++) {
  const match = createMatch(DEFAULT_RULES, seed);
  const first = startGame(match);
  for (let guard = 0; !first.over && guard < 500; guard++) {
    const combos = legalCombos(first);
    applyMove(first, combos.length ? { pass: false, combo: combos[0] } : { pass: true });
  }
  if (!first.over) throw new Error(`seed ${seed}: first game did not finish`);
  const completed: MatchSave = {
    levels: [...match.levels], gameNo: match.gameNo, lastResult: match.lastResult,
    lastHead: match.lastHead, rngState: match.rngState, ruleOpts: { ...match.opts },
    difficulty: 1, aiPolicy: 'heuristic:L1', savedAt: Date.now(),
  };
  values.clear();
  const controller = new MatchController({ difficulty: 1, rules: DEFAULT_RULES, resumeMatch: completed, aiDelayMs: 60000 });
  controller.startGame();
  while (controller.state!.pendingReturns.length) {
    controller.submitReturn(pickReturnCard(controller.state!, controller.state!.pendingReturns[0].from));
  }
  const result = controller.exchangeResult();
  if (result && controller.exchangeAckPending && !found.has(result.pairs.length)) {
    const kind = result.pairs.length === 1 ? 'single' : 'double';
    const save = loadCurrentMatch();
    if (!save?.activeGame || save.activeGame.moves.length || save.activeGame.acknowledgedVersion) throw new Error('fixture not pending');
    writeFileSync(`${out}${kind}-pending.json`, `${JSON.stringify(save, null, 2)}\n`);
    found.add(result.pairs.length);
    provenance.push({ file: `${kind}-pending.json`, seed, rules: DEFAULT_RULES,
      firstGamePolicy: 'At each turn: legalCombos(state)[0], otherwise pass',
      firstGameMoves: first.moveNo, firstFinishOrder: first.result!.finishOrder,
      returnPolicy: 'Engine automatic returns; pending human return uses pickReturnCard',
      currentGameNo: save.gameNo, leader: result.leader, pairs: result.pairs,
      source: 'Real engine completed first game, then MatchController.startGame and submitReturn. No hands invented.',
    });
  }
  controller.destroy();
}
if (found.size !== 2) throw new Error('Did not find both exchange fixture types');
writeFileSync(`${out}provenance.json`, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify(provenance.map(({ file, seed, firstFinishOrder }) => ({ file, seed, firstFinishOrder })), null, 2));
