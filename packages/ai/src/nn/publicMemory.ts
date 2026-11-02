/** Deterministic public physical-card memory. No GameState, private hand,
 * proposal, model, I/O, or mutable cross-deal cache enters this module. */
import type { Observation, PublicCombo, PublicEvent } from '../hybrid/protocol';

export const PUBLIC_HIGH_CARD_MEMORY_SCHEMA = 'public-high-card-memory-v1' as const;
export const PUBLIC_HIGH_CARD_SLOTS = ['J','Q','K','LEVEL_OTHER','SJ','BJ'] as const;
export type HighCardCounts = readonly [number,number,number,number,number,number];
export interface PublicMemoryDealId { readonly matchId: string; readonly gameNo: number }
/** This is the already-confirmed, complete projected history from Observation.
 * moveNo is its existing 1-based row position, NOT a newly invented engine ID.
 * The owner must project confirmed actions only (MatchRecorder.history does so).
 * throughMoveNo equals the target DecisionKey.moveNo; its pending action is absent. */
export interface PublicMemoryPrefix extends PublicMemoryDealId {
  readonly throughMoveNo: number;
  readonly steps: readonly Observation['publicPrefix'][number][];
}
export interface PublicHighCardMemory {
  readonly memorySchemaId: typeof PUBLIC_HIGH_CARD_MEMORY_SCHEMA;
  readonly dealId: Readonly<PublicMemoryDealId>;
  readonly throughMoveNo: number;
  /** Position in the public projection (0-based eventIndex), not raw engine events. */
  readonly throughEvent: Readonly<{ moveNo: number; eventIndex: number }> | null;
  readonly levelRank: number;
  readonly countsBySeat: readonly [HighCardCounts,HighCardCounts,HighCardCounts,HighCardCounts];
  /** Display aliases only: never add these again to the six physical slots. */
  readonly levelPlayedBySeat: readonly [number,number,number,number];
}
const invalid = (reason: string): never => { throw Error(`public memory: ${reason}`); };
function seat(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 3) invalid('invalid actor seat');
  return n;
}
function resources(combo: PublicCombo): Array<[string,number,number]> {
  if (!combo || !Array.isArray(combo.resources) || !combo.resources.length) invalid('physical resources required');
  const rows: Array<[string,number,number]> = combo.resources.map(c => {
    const ordinary = Number.isInteger(c.rank) && c.rank >= 2 && c.rank <= 14 && ['S','H','D','C'].includes(c.suit);
    const joker = (c.rank === 16 || c.rank === 17) && c.suit === 'J';
    if ((!ordinary && !joker) || !Number.isSafeInteger(c.count) || c.count < 1) invalid('invalid physical face/count');
    return [c.suit,c.rank,c.count];
  });
  if (rows.reduce((n,c) => n+c[2],0) !== combo.size) invalid('physical resource size mismatch');
  return rows.sort((a,b) => a[1]-b[1] || a[0].localeCompare(b[0]));
}
/** Whitelist public declaration fields too, so the same position with a changed
 * declaration is a conflict even if its physical counts would be identical. */
function comboIdentity(combo: PublicCombo | null): unknown {
  if (combo === null) return null;
  return [combo.kind,combo.size,combo.mainRank,combo.keyRank,combo.length,
    [...combo.pairRanks].sort((a,b)=>a-b),combo.suit ?? null,resources(combo),
    combo.wildAs.map(w=>[w.card.suit,w.card.rank,w.asRank,w.asSuit ?? null]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))];
}
function eventIdentity(event: PublicEvent): unknown {
  switch(event.type) {
    case 'play': return ['play',seat(event.player),comboIdentity(event.combo)];
    case 'pass': return ['pass',seat(event.player)];
    case 'finish': return ['finish',seat(event.player),event.order];
    case 'trickEnd': return ['trickEnd',seat(event.nextLeader)];
    default: return invalid('unknown/nonpublic event in confirmed prefix');
  }
}

/** Re-fold the canonical prefix; duplicate deliveries of an identical row are
 * idempotent. New row positions count even when their face/declaration repeats.
 * Missing, out-of-order or future rows are rejected, never silently zero-filled.
 * Current stage has one effective level. Historic multi-level `both` remains
 * supported by legacy Observation, but cannot be represented by this v1 schema. */
export function buildPublicHighCardMemory(publicPrefix: PublicMemoryPrefix, dealId: PublicMemoryDealId, effectiveLevelRanks: readonly number[]): PublicHighCardMemory {
  if (!dealId || typeof dealId.matchId !== 'string' || !dealId.matchId.trim() || !Number.isSafeInteger(dealId.gameNo) || dealId.gameNo < 1 ||
      !publicPrefix || publicPrefix.matchId !== dealId.matchId || publicPrefix.gameNo !== dealId.gameNo) invalid('deal identity mismatch');
  if (!Array.isArray(effectiveLevelRanks) || effectiveLevelRanks.length !== 1 || !Number.isInteger(effectiveLevelRanks[0]) || effectiveLevelRanks[0] < 2 || effectiveLevelRanks[0] > 14) invalid('single effective level required');
  const levelRank = effectiveLevelRanks[0];
  if (!Number.isSafeInteger(publicPrefix.throughMoveNo) || publicPrefix.throughMoveNo < 0 || !Array.isArray(publicPrefix.steps)) invalid('invalid complete prefix cutoff');
  const counts: [number,number,number,number,number,number][] = Array.from({length:4},()=>[0,0,0,0,0,0]);
  const seen = new Map<number,string>(), faceTotals = new Map<string,number>(), rankTotals = new Map<number,number>();
  let throughEvent: PublicHighCardMemory['throughEvent'] = null;
  for (const row of publicPrefix.steps) {
    if (!row || !Number.isSafeInteger(row.moveNo) || row.moveNo < 1 || row.moveNo > publicPrefix.throughMoveNo) invalid('future/current action beyond prefix cutoff');
    if (!Array.isArray(row.events) || row.events.filter(e=>e.type==='play'||e.type==='pass').length !== 1) invalid('confirmed row requires one play/pass');
    const signature = JSON.stringify([comboIdentity(row.priorTarget),row.events.map(eventIdentity)]);
    if (seen.has(row.moveNo)) {
      if (seen.get(row.moveNo) !== signature) invalid(`identity conflict at move ${row.moveNo}`);
      continue;
    }
    if (row.moveNo !== seen.size+1) invalid('complete contiguous ordered prefix required');
    seen.set(row.moveNo,signature);
    for (const event of row.events) if (event.type === 'play') {
      for (const [suit,rank,count] of resources(event.combo)) {
        const key=`${suit}:${rank}`, faceTotal=(faceTotals.get(key)??0)+count, rankTotal=(rankTotals.get(rank)??0)+count;
        if (faceTotal > 2 || rankTotal > (rank===16||rank===17 ? 2 : 8)) invalid(`physical capacity exceeded for rank ${rank}`);
        faceTotals.set(key,faceTotal); rankTotals.set(rank,rankTotal);
        const slot=rank===11?0:rank===12?1:rank===13?2:rank===levelRank?3:rank===16?4:rank===17?5:null;
        if(slot!==null)counts[event.player][slot]+=count;
      }
    }
    throughEvent=Object.freeze({moveNo:row.moveNo,eventIndex:row.events.length-1});
  }
  if (seen.size !== publicPrefix.throughMoveNo) invalid('complete confirmed prefix missing');
  const levelSlot=levelRank===11?0:levelRank===12?1:levelRank===13?2:3;
  return Object.freeze({memorySchemaId:PUBLIC_HIGH_CARD_MEMORY_SCHEMA,
    dealId:Object.freeze({matchId:dealId.matchId,gameNo:dealId.gameNo}),throughMoveNo:publicPrefix.throughMoveNo,throughEvent,levelRank,
    countsBySeat:Object.freeze(counts.map(c=>Object.freeze(c))) as PublicHighCardMemory['countsBySeat'],
    levelPlayedBySeat:Object.freeze(counts.map(c=>c[levelSlot])) as PublicHighCardMemory['levelPlayedBySeat']});
}

/** Integer-only view; S33 owns the separate 8/2 normalization and 399+24 input.
 * Fixed user display remains engine [0,2,3,1] => labels [1,2,3,4]. */
export function projectPublicHighCardMemory(memory: PublicHighCardMemory, actorSeat: number): readonly number[] {
  const a=seat(actorSeat);
  return Object.freeze([a,(a+2)%4,(a+3)%4,(a+1)%4].flatMap(s=>memory.countsBySeat[s]));
}
