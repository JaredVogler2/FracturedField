import type { PlayerSlot } from '@ff/protocol';
import { teamOf } from './teams';

/** Team glyph (hexagon = Ember, diamond = Tide) used everywhere team identity appears. */
export function Glyph({ slot, size = 18 }: { slot: PlayerSlot; size?: number }) {
  const t = teamOf(slot);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="glyph">
      {t.glyph === 'hexagon' ? (
        <polygon
          points="12,2 21,7 21,17 12,22 3,17 3,7"
          fill="none"
          stroke={t.color}
          strokeWidth="2.6"
        />
      ) : (
        <polygon points="12,2 22,12 12,22 2,12" fill="none" stroke={t.color} strokeWidth="2.6" />
      )}
      <circle cx="12" cy="12" r="3.2" fill={t.color} />
    </svg>
  );
}
