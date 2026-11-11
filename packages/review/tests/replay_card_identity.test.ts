import { describe, expect, it } from 'vitest';
import {
  buildDeck, checkRecordIntegrity, DEFAULT_RULES, type Card, type GameRecord,
} from '@gd/engine';
import { normalizeRecord, replay, validateRecord } from '../src/replay';
import { classifyReplay } from '../src/replayStatus';

/** At most two hand-authored actions. No self-play, model, teacher or network. */
function recordOf(pair = false): GameRecord {
  const deck = buildDeck();
  const threes = deck.filter((card) => card.suit === 'S' && card.rank === 3);
  const four = deck.find((card) => card.suit === 'S' && card.rank === 4)!;
  const first = pair ? threes : threes.slice(0, 1);
  const hands: Card[][] = [[...first], [four], [], []];
  const used = new Set(hands.flat().map((card) => card.id));
  const pool = deck.filter((card) => !used.has(card.id));
  for (const hand of hands) while (hand.length < 27) hand.push(pool.shift()!);
  return {
    schemaVersion: 2, id: 'physical-card-fixture', matchId: 'finite-fixture', createdAt: 0,
    ruleOpts: { ...DEFAULT_RULES }, levelsBefore: [2, 2], stageTeam: 0,
    leader: 0, humanSeat: 0, difficulties: [null, 0, 0, 0],
    initialHands: hands.map((hand) => hand.map((card) => ({ ...card }))),
    moves: [{
      moveNo: 1, player: 0, pass: false, cards: first.map((card) => ({ ...card })),
      comboKind: pair ? 'pair' : 'single', mainRank: 3,
      declaration: { kind: pair ? 'pair' : 'single', size: pair ? 2 : 1,
        length: 1, mainRank: 3, keyRank: 3, pairRanks: [], wildAs: [] },
      handsAfter: pair ? [25, 27, 27, 27] : [26, 27, 27, 27],
    }], result: null,
  };
}

function appendFour(record: GameRecord): void {
  const card = record.initialHands[1].find((c) => c.suit === 'S' && c.rank === 4)!;
  record.moves.push({
    moveNo: 2, player: 1, pass: false, cards: [{ ...card }],
    comboKind: 'single', mainRank: 4,
    declaration: { kind: 'single', size: 1, length: 1, mainRank: 4,
      keyRank: 4, pairRanks: [], wildAs: [] },
    handsAfter: [26, 26, 27, 27], toBeatKind: 'single', toBeatRank: 3,
  });
}

describe('replay physical card integrity', () => {
  it('keeps a valid two-action JSON record exact and does not edit its cards', () => {
    const record = recordOf();
    appendFour(record);
    const copy: GameRecord = JSON.parse(JSON.stringify(record));
    const before = JSON.stringify(copy);
    expect(checkRecordIntegrity(copy)).toEqual([]);
    expect(validateRecord(copy)).toEqual({ ok: true });
    expect(classifyReplay(copy)).toMatchObject({ status: 'exact', verifiedPrefixEnd: 2 });
    expect([...replay(copy)].map((frame) => frame.combo?.cards[0].rank)).toEqual([3, 4]);
    expect(JSON.stringify(copy)).toBe(before);
  });

  it('allows both physical copies of the same face in a legal pair', () => {
    const record = recordOf(true);
    expect(checkRecordIntegrity(record)).toEqual([]);
    expect(classifyReplay(record)).toMatchObject({ status: 'exact', verifiedPrefixEnd: 1 });
  });

  it.each(['seats', 'counts', 'hand-shape', 'duplicate-in-seat', 'duplicate-across-seats', 'id', 'face'] as const)(
    'rejects a corrupt initial physical deck (%s), including records with no moves', (damage) => {
      const record = recordOf();
      record.moves = [];
      if (damage === 'seats') record.initialHands[2].push(...record.initialHands.pop()!);
      if (damage === 'counts') record.initialHands[1].push(record.initialHands[0].pop()!);
      if (damage === 'hand-shape') (record.initialHands as unknown[])[0] = null;
      if (damage === 'duplicate-in-seat') record.initialHands[0][1] = { ...record.initialHands[0][0] };
      if (damage === 'duplicate-across-seats') record.initialHands[1][0] = { ...record.initialHands[0][0] };
      if (damage === 'id') record.initialHands[0][0].id = 108;
      if (damage === 'face') record.initialHands[0][0].rank = 4;
      const before = JSON.stringify(record);
      expect(validateRecord(record).ok).toBe(false);
      expect(classifyReplay(record)).toMatchObject({ status: 'invalid', verifiedPrefixEnd: 0 });
      expect(JSON.stringify(record)).toBe(before);
    },
  );

  it.each(['rank', 'suit'] as const)('rejects forged action %s even with owned id and matching full declaration', (field) => {
    const record = recordOf();
    const move = record.moves[0];
    if (field === 'rank') {
      move.cards![0].rank = 4;
      move.mainRank = 4;
      move.declaration!.mainRank = 4;
      move.declaration!.keyRank = 4;
    } else move.cards![0].suit = 'D';
    expect(checkRecordIntegrity(record)[0]?.moveNo).toBe(1);
    expect(classifyReplay(record)).toMatchObject({ status: 'invalid', firstBadMove: 1, verifiedPrefixEnd: 0 });
  });

  it('rejects spending one physical card twice as a pair even when the count drops by only one', () => {
    const record = recordOf();
    const move = record.moves[0];
    move.cards!.push({ ...move.cards![0] });
    move.comboKind = 'pair';
    move.declaration!.kind = 'pair';
    move.declaration!.size = 2;
    expect(classifyReplay(record)).toMatchObject({ status: 'invalid', firstBadMove: 1, verifiedPrefixEnd: 0 });
  });

  it('rejects a previously spent id on the next action', () => {
    const record = recordOf();
    appendFour(record);
    record.moves[1].cards = record.moves[0].cards!.map((card) => ({ ...card }));
    expect(checkRecordIntegrity(record)[0]?.moveNo).toBe(2);
    expect(classifyReplay(record)).toMatchObject({ status: 'invalid', firstBadMove: 2, verifiedPrefixEnd: 1 });
  });

  it.each(['empty', 'shape'] as const)('rejects an invalid non-pass cards field (%s)', (damage) => {
    const record = recordOf();
    record.moves[0].cards = [];
    if (damage === 'shape') (record.moves[0] as unknown as { cards: unknown }).cards = {};
    record.moves[0].handsAfter = [27, 27, 27, 27];
    expect(classifyReplay(record)).toMatchObject({ status: 'invalid', firstBadMove: 1 });
  });

  it('rejects a pass carrying physical cards without consuming them', () => {
    const record = recordOf();
    appendFour(record);
    record.moves[1].pass = true;
    record.moves[1].handsAfter = [26, 27, 27, 27];
    expect(classifyReplay(record)).toMatchObject({ status: 'invalid', firstBadMove: 2, verifiedPrefixEnd: 1 });
  });

  it.each(['missing', 'short', 'wrong'] as const)('requires a full accurate handsAfter witness (%s)', (damage) => {
    const record = recordOf();
    if (damage === 'missing') delete (record.moves[0] as Partial<GameRecord['moves'][number]>).handsAfter;
    if (damage === 'short') record.moves[0].handsAfter = [26];
    if (damage === 'wrong') record.moves[0].handsAfter = [25, 27, 27, 27];
    expect(classifyReplay(record)).toMatchObject({ status: 'invalid', firstBadMove: 1, verifiedPrefixEnd: 0 });
  });

  it('preserves uniquely recoverable unversioned player migration', () => {
    const record = recordOf();
    delete record.schemaVersion;
    delete record.moves[0].declaration;
    record.moves[0].player = 1;
    const before = JSON.stringify(record);
    expect(checkRecordIntegrity(record)).toEqual([]);
    expect(classifyReplay(record)).toMatchObject({ status: 'migrated_verified', verifiedPrefixEnd: 1 });
    expect(classifyReplay(normalizeRecord(record)).status).toBe('exact');
    expect(JSON.stringify(record)).toBe(before);
  });

  it('leaves a corrupt legacy record available to the existing diagnostic gate without replaying it', () => {
    const record = recordOf();
    delete record.schemaVersion;
    delete record.moves[0].declaration;
    delete record.moves[0].cards;
    record.moves[0].handsAfter = [27, 27, 27, 27];
    const before = JSON.stringify(record);
    expect(() => normalizeRecord(record)).not.toThrow();
    expect(validateRecord(normalizeRecord(record)).ok).toBe(false);
    expect(JSON.stringify(record)).toBe(before);
  });

  it('preserves the existing explicit-v1 normalization without weakening its direct integrity check', () => {
    const record = recordOf();
    record.schemaVersion = 1;
    delete record.moves[0].declaration;
    record.moves[0].player = 1;
    const before = JSON.stringify(record);
    expect(validateRecord(record).ok).toBe(false);
    expect(classifyReplay(record).status).toBe('invalid');
    expect(normalizeRecord(record).moves[0].player).toBe(0);
    expect(classifyReplay(normalizeRecord(record)).status).toBe('exact');
    expect(JSON.stringify(record)).toBe(before);
  });
});
