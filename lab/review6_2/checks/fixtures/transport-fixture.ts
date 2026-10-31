/** A single generated initial position; no applyMove, model, match or network. */
import { createMatch, startGame, DEFAULT_RULES, legalCombos, canPass } from '@gd/engine';
import { createDecisionBundle } from '../../../../packages/ai/src/hybrid/candidates';
import { dedupCandidates } from '../../../../packages/ai/src/nn/neuralSeat';
export function transportBundle() {
  const state = startGame(createMatch({ ...DEFAULT_RULES }, 1234));
  const rows = dedupCandidates(legalCombos(state), canPass(state)).map((r, idx) => ({ ...r, idx, score: 1000 - idx }));
  return createDecisionBundle({ state, actorSeat: state.turn, decisionId: 'B04-synthetic-decision', matchId: 'B04-synthetic-match',
    history: { matchId: 'B04-synthetic-match', gameNo: state.match.gameNo, throughMoveNo: 0, steps: [] },
    key: { controllerOrRunnerGeneration: 'B04-fixture', matchId: 'B04-synthetic-match', gameNo: state.match.gameNo, moveNo: 0, actorSeat: state.turn, requestSeq: 1 },
    decider: { seat: state.turn, decide() { return { move: rows[0].combo === null ? { pass: true } : { pass: false, combo: rows[0].combo }, nCands: rows.length, explored: false, ranking: rows }; } },
  });
}
