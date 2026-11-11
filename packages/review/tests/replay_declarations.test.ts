import { describe, expect, it } from 'vitest';
import {
  buildDeck, DEFAULT_RULES, Recorder, type Card, type Combo, type GameRecord,
} from '@gd/engine';
import { canonicalize, matchAction } from '../src/actionIdentity';
import { normalizeRecord, replay, resolveDeclaredFirst, buildInitialState } from '../src/replay';
import { classifyReplay } from '../src/replayStatus';

const cards = (suit: Card['suit'], rank: number, count = 1): Card[] =>
  buildDeck().filter((c) => c.suit === suit && c.rank === rank).slice(0, count);

function trioWithWildPair(pairRank: number): Combo {
  const wilds = cards('H', 2, 2);
  return {
    kind: 'trio_pair', cards: [...cards('S', 8), ...cards('D', 8), ...cards('C', 8), ...wilds],
    size: 5, length: 1, mainRank: 8, keyRank: 8, pairRanks: [pairRank],
    wildAs: wilds.map((c) => ({ cardId: c.id, asRank: pairRank, asSuit: 'D' })),
  };
}

function single(suit: Card['suit'], rank: number): Combo {
  return { kind: 'single', cards: cards(suit, rank), size: 1, length: 1,
    mainRank: rank, keyRank: rank, pairRanks: [], wildAs: [] };
}

/** Finite synthetic records only: reserve each action's real physical cards, then
 * fill four 27-card hands. No simulated games, model, teacher or network calls. */
function recordOf(actions: Array<{ player: number; combo: Combo | null }>, leader = 0): GameRecord {
  const hands: Card[][] = [[], [], [], []];
  for (const action of actions) hands[action.player].push(...(action.combo?.cards ?? []));
  const used = new Set(hands.flat().map((c) => c.id));
  const pool = buildDeck().filter((c) => !used.has(c.id));
  for (const hand of hands) while (hand.length < 27) hand.push(pool.shift()!);
  const recorder = new Recorder({
    schemaVersion: 2, id: 'declaration-fixture', matchId: 'finite-fixture', createdAt: 0,
    ruleOpts: { ...DEFAULT_RULES }, levelsBefore: [2, 2], stageTeam: 0,
    leader, humanSeat: 0, difficulties: [null, 0, 0, 0],
    initialHands: hands.map((h) => h.map((c) => ({ ...c }))),
  });
  let last: Combo | null = null;
  for (const { player, combo } of actions) {
    const ids = new Set(combo?.cards.map((c) => c.id) ?? []);
    hands[player] = hands[player].filter((c) => !ids.has(c.id));
    recorder.record(player, { pass: combo === null, combo }, hands, last);
    if (combo) last = combo;
  }
  return { ...recorder.finish({ finishOrder: [0, 1, 2, 3], winnerTeam: 0,
    doubleUp: false, levelsAfter: [3, 2], upgrade: 1, passedA: false }), result: null };
}

function legacy(record: GameRecord): GameRecord {
  const copy: GameRecord = JSON.parse(JSON.stringify(record));
  for (const move of copy.moves) delete move.declaration;
  return copy;
}

describe('recorded full declarations', () => {
  it('keeps the selected wild-pair rank and original annotations through JSON and replay', () => {
    const selected = trioWithWildPair(13);
    const record: GameRecord = JSON.parse(JSON.stringify(recordOf([{ player: 0, combo: selected }])));
    const frame = [...replay(record)][0];
    expect(frame.combo).toEqual(selected);
    expect(frame.combo?.pairRanks).toEqual([13]);
    expect(frame.combo?.wildAs.map((w) => w.asRank)).toEqual([13, 13]);
    expect(frame.combo?.wildAs.map((w) => w.asSuit)).toEqual(['D', 'D']);
    expect(matchAction(canonicalize(0, false, frame.combo), [canonicalize(0, false, selected)])).toEqual({ index: 0, status: 'exact' });
    expect(classifyReplay(record)).toMatchObject({ status: 'exact', verifiedPrefixEnd: 1 });
  });

  it('snapshots cards and nested declarations instead of retaining caller-owned arrays', () => {
    const selected = trioWithWildPair(13);
    const record = recordOf([{ player: 0, combo: selected }]);
    selected.pairRanks[0] = 12;
    selected.wildAs[0].asRank = 12;
    selected.cards[0].rank = 7;
    const frame = [...replay(record)][0];
    expect(frame.combo?.pairRanks).toEqual([13]);
    expect(frame.combo?.wildAs.map((w) => w.asRank)).toEqual([13, 13]);
    expect(frame.combo?.cards[0].rank).toBe(8);
    expect(classifyReplay(record).status).toBe('exact');
  });

  it('marks legacy same-kind/mainRank multi-declaration hands ambiguous without rewriting them', () => {
    const record = legacy(recordOf([{ player: 0, combo: trioWithWildPair(13) }]));
    const before = JSON.stringify(record);
    expect(classifyReplay(record)).toMatchObject({ status: 'ambiguous', firstBadMove: 1, verifiedPrefixEnd: 0 });
    // Display-only compatibility remains available; it is not proof of the original declaration.
    expect([...replay(record)]).toHaveLength(1);
    expect(JSON.stringify(record)).toBe(before);
  });

  it('keeps uniquely recoverable legacy wildcard declarations exact', () => {
    const wild = cards('H', 2)[0];
    const pair: Combo = { kind: 'pair', cards: [...cards('S', 8), wild],
      size: 2, length: 1, mainRank: 8, keyRank: 8, pairRanks: [],
      wildAs: [{ cardId: wild.id, asRank: 8, asSuit: 'S' }] };
    const record = legacy(recordOf([{ player: 0, combo: pair }]));
    expect(classifyReplay(record)).toMatchObject({ status: 'exact', verifiedPrefixEnd: 1 });
    expect([...replay(record)][0].combo?.wildAs).toEqual(pair.wildAs);
  });

  it('does not call an undeclared multi-interpretation lead exact', () => {
    const record = legacy(recordOf([{ player: 0, combo: trioWithWildPair(13) }]));
    delete record.moves[0].comboKind;
    delete record.moves[0].mainRank;
    expect(classifyReplay(record)).toMatchObject({ status: 'ambiguous', firstBadMove: 1, verifiedPrefixEnd: 0 });
  });

  it.each(['pairRanks', 'wildAs', 'keyRank', 'mainRank', 'shape'] as const)(
    'rejects a corrupted full declaration (%s) rather than silently choosing another', (field) => {
      const record = recordOf([{ player: 0, combo: trioWithWildPair(13) }]);
      const declaration = record.moves[0].declaration!;
      if (field === 'pairRanks') declaration.pairRanks = [12];
      if (field === 'wildAs') declaration.wildAs[0].asRank = 12;
      if (field === 'keyRank') declaration.keyRank = 99;
      if (field === 'mainRank') record.moves[0].mainRank = 9;
      if (field === 'shape') (declaration as unknown as { wildAs: unknown }).wildAs = null;
      expect(classifyReplay(record)).toMatchObject({ status: 'invalid', firstBadMove: 1, verifiedPrefixEnd: 0 });
      expect(resolveDeclaredFirst(record.moves[0], buildInitialState(record), record).source).toBe('invalidDeclaration');
      expect(() => normalizeRecord(record)).not.toThrow();
    },
  );

  it('preserves flush suit and its wildcard suit declaration', () => {
    const wild = cards('H', 2)[0];
    const flush: Combo = { kind: 'flush', cards: [3, 4, 5, 6].flatMap((r) => cards('D', r)).concat(wild),
      size: 5, length: 5, mainRank: 7, keyRank: 7, pairRanks: [], suit: 'D',
      wildAs: [{ cardId: wild.id, asRank: 7, asSuit: 'D' }] };
    const record = recordOf([{ player: 0, combo: flush }]);
    expect([...replay(record)][0].combo).toEqual(flush);
    expect(classifyReplay(record).status).toBe('exact');
    record.moves[0].declaration!.suit = 'S';
    expect(classifyReplay(record).status).toBe('invalid');
  });

  it('rejects a historical all-wild joker-pair claim without relabelling it exact', () => {
    const wilds = cards('H', 2, 2);
    const bad: Combo = { kind: 'pair', cards: wilds, size: 2, length: 1,
      mainRank: 17, keyRank: 41, pairRanks: [],
      wildAs: wilds.map((c) => ({ cardId: c.id, asRank: 17, asSuit: 'S' })) };
    const record = legacy(recordOf([{ player: 0, combo: bad }]));
    const before = JSON.stringify(record);
    expect(classifyReplay(record)).toMatchObject({ status: 'ambiguous', firstBadMove: 1, verifiedPrefixEnd: 0 });
    expect(JSON.stringify(record)).toBe(before);
    expect(classifyReplay(recordOf([{ player: 0, combo: bad }])).status).toBe('invalid');
  });

  it('keeps a declared natural-level all-wild pair exact', () => {
    const pair: Combo = { kind: 'pair', cards: cards('H', 2, 2), size: 2, length: 1,
      mainRank: 2, keyRank: 22, pairRanks: [], wildAs: [] };
    const record = recordOf([{ player: 0, combo: pair }]);
    expect(classifyReplay(record).status).toBe('exact');
    expect([...replay(record)][0].combo).toEqual(pair);
  });
});

describe('strict replay turn ownership', () => {
  it('rejects a modern out-of-turn play even when ownership and hand counts agree', () => {
    const record = recordOf([{ player: 0, combo: single('S', 3) }, { player: 2, combo: single('S', 4) }]);
    expect(classifyReplay(record)).toMatchObject({ status: 'invalid', firstBadMove: 2, verifiedPrefixEnd: 1 });
    expect(classifyReplay(normalizeRecord(record)).status).toBe('invalid');
  });

  it('does not erase a modern out-of-turn pass during normalization', () => {
    const record = recordOf([{ player: 0, combo: single('S', 3) }, { player: 2, combo: null }]);
    const before = JSON.stringify(record);
    expect(normalizeRecord(record).moves[1].player).toBe(2);
    expect(classifyReplay(normalizeRecord(record))).toMatchObject({ status: 'invalid', firstBadMove: 2, verifiedPrefixEnd: 1 });
    expect(JSON.stringify(record)).toBe(before);
  });

  it('keeps legal pass progression exact', () => {
    const record = recordOf([{ player: 0, combo: single('S', 3) }, { player: 1, combo: null },
      { player: 2, combo: null }, { player: 3, combo: null }, { player: 0, combo: single('S', 4) }]);
    expect(classifyReplay(record)).toMatchObject({ status: 'exact', verifiedPrefixEnd: 5 });
  });

  it('retains the ownership-based legacy player migration', () => {
    const record = legacy(recordOf([{ player: 0, combo: single('S', 3) }]));
    delete record.schemaVersion;
    record.moves[0].player = 1;
    expect(classifyReplay(record)).toMatchObject({ status: 'migrated_verified', verifiedPrefixEnd: 1,
      migrations: [{ moveNo: 1, kind: 'player_fixed_by_ownership' }] });
    expect(normalizeRecord(record).moves[0].player).toBe(0);
    expect(classifyReplay(normalizeRecord(record)).status).toBe('exact');
  });

  it('marks historical turn-rule disagreement ambiguous rather than asserting it was legal', () => {
    const record = legacy(recordOf([{ player: 0, combo: single('S', 3) }, { player: 2, combo: single('S', 4) }]));
    delete record.schemaVersion;
    expect(classifyReplay(record)).toMatchObject({ status: 'ambiguous', firstBadMove: 2, verifiedPrefixEnd: 1 });
  });
});
