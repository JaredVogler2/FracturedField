import { DEFAULT_ABILITIES } from '@ff/game-data';
import { mulberry32 } from './procedural';

/**
 * The guard's basalt columns: hexagonal prisms packed in two staggered rows inside the collider's
 * box (never past it), each 88–100 % of its height. Unit-height prisms, scaled per instance.
 */
export interface Column {
  x: number;
  z: number;
  radius: number;
  height: number;
  /** Seconds after the cast that this column starts to rise (the middle first). */
  delay: number;
}

export function guardColumns(): Column[] {
  const def = DEFAULT_ABILITIES.guard;
  const rand = mulberry32(4441);
  const radius = def.halfDepth / 2;
  const step = radius * 1.72;
  const out: Column[] = [];
  for (const row of [-1, 1]) {
    const z = (row * def.halfDepth) / 2;
    const shift = row > 0 ? step / 2 : 0;
    for (let x = -def.halfWidth + radius + shift; x <= def.halfWidth - radius + 1e-6; x += step) {
      out.push({
        x,
        z,
        radius,
        height: def.halfHeight * 2 * (0.88 + rand() * 0.12),
        delay: (Math.abs(x) / def.halfWidth) * 0.09 + rand() * 0.03,
      });
    }
  }
  return out;
}
