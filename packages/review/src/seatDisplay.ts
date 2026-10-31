/** Product-only labels. Engine seats, record IDs and CSS geometry never change. */
export const SEAT_DISPLAY_VERSION = 1 as const;
const NUMBERS = [1, 4, 2, 3] as const;
const POSITIONS = ['下方', '右侧', '上方', '左侧'] as const;
export type ActualSeatController = 'human' | 'ai' | null;

export function displaySeatNumber(engineSeat: number): 1 | 2 | 3 | 4 {
  if (!Number.isInteger(engineSeat) || engineSeat < 0 || engineSeat > 3) throw new Error('invalid engine seat');
  return NUMBERS[engineSeat];
}

/** Fixed identity, relative perspective and actual control are separate evidence.
 * A viewer is an observation seat, never evidence that its controller is human. */
export function displaySeatLabel(engineSeat: number, viewerSeat: number | null = null, actualController: ActualSeatController = null) {
  const number = displaySeatNumber(engineSeat);
  if (viewerSeat !== null) displaySeatNumber(viewerSeat);
  const label = `${number}号`;
  const position = POSITIONS[engineSeat];
  const relation = viewerSeat === null ? null : engineSeat === viewerSeat ? '观察席' : engineSeat === (viewerSeat + 2) % 4 ? '队友' : '对手';
  const controller = actualController === 'human' ? '真人' : actualController === 'ai' ? 'AI' : '未记录';
  return { number, label, position, relation, controller, text: [label, relation, controller].filter(Boolean).join(' · ') };
}

/** Counts stay in engine order; each element carries its own unambiguous label. */
export function displaySeatCounts(counts: readonly number[]): string {
  if (counts.length !== 4) throw new Error('four engine seat counts required');
  return counts.map((count, seat) => `${displaySeatLabel(seat).label} ${count}张`).join('、');
}
