/**
 * REVIEW5 T0.2 验收（真实权重部分）：迁移后真实候选批次 Q 逐位不变。
 * 真实权重：packages/web/public/ai/clean2.f32（385，部署冠军）与
 * lab/review2/runs/review4-treatment/ck-1800（399，若存在）。
 * 修改前失败：无 migratePassEncoding——旧实现下该文件无从通过。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMove, bestResponse, canPass, createMatch, DEFAULT_RULES, legalCombos, startGame,
} from '@gd/engine';
import {
  encodeAction, encodeState, INPUT_DIM, INPUT_DIM_V2, migratePassEncoding,
  PublicTracker, STATE_DIM, STATE_DIM_V2,
} from '@gd/ai';
import { MLP, NeuralDecider, dedupCandidates } from '@gd/ai';

const REPO = join(import.meta.dirname, '..', '..');

function loadF32(p: string): Float32Array {
  const buf = readFileSync(p);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

function collectRealInputs(nStates: number, dim: number, stateDim: number): {
  featsLegacy: Float32Array; feats64: Float32Array; n: number; nPass: number;
} {
  const legacy: number[] = [], fixed: number[] = [];
  let nPass = 0, n = 0;
  let match = createMatch({ ...DEFAULT_RULES }, 20261028);
  let state = startGame(match);
  let tracker = new PublicTracker();
  let states = 0, guard = 0;
  while (states < nStates && guard++ < 6000 && match.winner == null) {
    if (state.over) { state = startGame(match); tracker = new PublicTracker(); continue; }
    const seat = state.turn;
    const cands = dedupCandidates(legalCombos(state), canPass(state));
    for (const c of cands) {
      const s1 = new Float32Array(dim);
      encodeState(state, seat, tracker, s1.subarray(0, STATE_DIM));
      encodeAction(c.combo, s1.subarray(stateDim), 'legacy-phys10');
      const s2 = new Float32Array(dim);
      encodeState(state, seat, tracker, s2.subarray(0, STATE_DIM));
      encodeAction(c.combo, s2.subarray(stateDim), 'action64');
      legacy.push(...s1); fixed.push(...s2);
      if (c.combo === null) nPass += 1;
      n += 1;
    }
    states += 1;
    const t = state.turn;
    const combo = bestResponse(state.hands[t].slice(0, 1), state.lastCombo, state.ctx, match.opts);
    const ev = applyMove(state, combo ? { pass: false, combo } : { pass: true });
    tracker.observe(ev);
  }
  return { featsLegacy: Float32Array.from(legacy), feats64: Float32Array.from(fixed), n, nPass };
}

describe('REVIEW5 T0.2 真实权重迁移等价', () => {
  it('clean2（385）：真实候选批次 Q 逐位不变；未迁移+action64 会漂移', () => {
    const old = loadF32(join(REPO, 'packages', 'web', 'public', 'ai', 'clean2.f32'));
    expect(old.length).toBe(164_865);
    const migrated = migratePassEncoding(old, INPUT_DIM, STATE_DIM);
    const mOld = new MLP(1); mOld.setWeights(old);
    const mNew = new MLP(1); mNew.setWeights(migrated);
    const b = collectRealInputs(8, INPUT_DIM, STATE_DIM);
    expect(b.nPass).toBeGreaterThan(0);
    expect(b.n).toBeGreaterThan(300);
    const qOld = mOld.forward(b.featsLegacy, b.n);
    const qNew = mNew.forward(b.feats64, b.n);
    for (let i = 0; i < b.n; i++) expect(qNew[i]).toBe(qOld[i]);
    const qWrong = mOld.forward(b.feats64, b.n);
    let changed = 0;
    for (let i = 0; i < b.n; i++) if (qWrong[i] !== qOld[i]) changed += 1;
    expect(changed).toBeGreaterThan(0);
  });

  it('review4-treatment ck-1800（399，若存在）：Q 逐位不变', () => {
    const p = join(REPO, 'lab', 'review2', 'runs', 'review4-treatment', 'ck-1800', 'weights.f32');
    let old: Float32Array;
    try { old = loadF32(p); } catch { return; }
    expect(old.length).toBe(168_449);
    const migrated = migratePassEncoding(old, INPUT_DIM_V2, STATE_DIM_V2);
    const mOld = new MLP(1, INPUT_DIM_V2); mOld.setWeights(old);
    const mNew = new MLP(1, INPUT_DIM_V2); mNew.setWeights(migrated);
    const b = collectRealInputs(8, INPUT_DIM_V2, STATE_DIM_V2);
    const qOld = mOld.forward(b.featsLegacy, b.n);
    const qNew = mNew.forward(b.feats64, b.n);
    for (let i = 0; i < b.n; i++) expect(qNew[i]).toBe(qOld[i]);
  });

  it('NeuralDecider 迁移等价：同一状态 旧权重(legacy) 与 迁移权重(action64) 决策与全候选打分一致', () => {
    const old = loadF32(join(REPO, 'packages', 'web', 'public', 'ai', 'clean2.f32'));
    const migrated = migratePassEncoding(old, INPUT_DIM, STATE_DIM);
    const m1 = new MLP(1); m1.setWeights(old);
    const m2 = new MLP(1); m2.setWeights(migrated);
    let match = createMatch({ ...DEFAULT_RULES }, 51028);
    let state = startGame(match);
    const d1 = new NeuralDecider(0, m1, 0, () => 0, { passEncoding: 'legacy-phys10' });
    const d2 = new NeuralDecider(0, m2, 0, () => 0, { passEncoding: 'action64' });
    let checked = 0, guard = 0;
    while (checked < 30 && guard++ < 3000) {
      if (state.over || match.winner != null) {
        match = createMatch({ ...DEFAULT_RULES }, 51028 + checked + 1);
        state = startGame(match); d1.newGame(); d2.newGame(); continue;
      }
      if (state.turn === 0) {
        const a = d1.decide(state, { wantRanking: true });
        const b = d2.decide(state, { wantRanking: true });
        expect(b.move.pass).toBe(a.move.pass);
        if (!a.move.pass) {
          expect(b.move.combo!.cards.map((c) => c.id).sort().join(',')).toBe(a.move.combo!.cards.map((c) => c.id).sort().join(','));
        }
        for (let i = 0; i < a.ranking!.length; i++) expect(b.ranking![i].score).toBe(a.ranking![i].score);
        checked += 1;
      }
      const t = state.turn;
      const combo = bestResponse(state.hands[t].slice(0, 1), state.lastCombo, state.ctx, match.opts);
      const ev = applyMove(state, combo ? { pass: false, combo } : { pass: true });
      d1.observe(ev); d2.observe(ev);
    }
    expect(checked).toBe(30);
  });
});
