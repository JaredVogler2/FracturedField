import type { PlayerSlot } from '@ff/protocol';

/** Team identity: colour + name + glyph shape (never colour alone, for colour-blind players). */
export const TEAMS = [
  { name: 'EMBER', color: 'var(--amber)', glyph: 'hexagon' as const },
  { name: 'TIDE', color: 'var(--cyan)', glyph: 'diamond' as const },
] as const;

export function teamOf(slot: PlayerSlot) {
  return TEAMS[slot];
}
