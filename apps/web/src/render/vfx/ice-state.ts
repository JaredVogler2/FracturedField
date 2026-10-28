/**
 * What a pool's visual shows (7C / D09), stepped once per rendered frame from authoritative state
 * only: whether the pool exists, whether its ICE flag is set, and whether its plate broke (the
 * `shatter` reaction). Pure, so the timing rules are tested without a renderer.
 */

/** Seconds for the freeze front to cross a plate, and for a thaw to finish. */
export const FREEZE_S = 0.35;
export const MELT_S = 0.5;
/** The last part of the front's crossing, over which the water under it fades out. */
const CLOSING = 0.15;

export interface IceState {
  /** The ICE flag as last seen. */
  frozen: boolean;
  /** The plate broke: no thaw to show, the water is back at once. */
  broken: boolean;
  /** Seconds since the pool froze, and since it thawed (< 0: not thawing). */
  freezeT: number;
  meltT: number;
}

export interface IceView {
  water: boolean;
  /** Water opacity 0..1 (it fades under a freeze front and comes back during a thaw). */
  waterFade: number;
  ice: boolean;
  /** 0..1: how far the freeze front has crossed the plate (eased). */
  freeze: number;
  /** 0..1: how far a thaw has gone. */
  melt: number;
  /** Nothing left to draw: the visual can follow another pool. */
  done: boolean;
}

/** A pool first seen frozen shows its plate whole (no front); one first seen as water, water. */
export function newIceState(frozen: boolean): IceState {
  return { frozen, broken: false, freezeT: frozen ? FREEZE_S : 0, meltT: -1 };
}

/** The plate broke (a `shatter` reaction for this pool). */
export function breakIce(s: IceState): void {
  s.broken = true;
  if (!s.frozen) s.meltT = MELT_S;
}

export function stepIce(s: IceState, present: boolean, frozenNow: boolean, rawDt: number): IceView {
  const dt = Number.isFinite(rawDt) ? Math.min(Math.max(rawDt, 0), 0.1) : 0;
  // A pool that is gone cannot be frozen; a frozen one thaws away where it stood.
  const frozen = present && frozenNow;
  if (frozen && !s.frozen) {
    s.freezeT = 0;
    s.meltT = -1;
    s.broken = false;
  } else if (!frozen && s.frozen) s.meltT = s.broken ? MELT_S : 0;
  s.frozen = frozen;
  s.freezeT += dt;
  if (s.meltT >= 0) s.meltT += dt;
  const melt = s.meltT >= 0 ? Math.min(1, s.meltT / MELT_S) : 0;
  const k = Math.min(1, s.freezeT / FREEZE_S);
  const freeze = 1 - (1 - k) * (1 - k);
  const ice = !s.broken && (frozen || (s.meltT >= 0 && s.meltT < MELT_S));
  // While the front crosses, the water still shows where it has not frozen (under the plate it is
  // water beneath ice), fading out only as the front closes.
  const freezing = frozen && k < 1;
  return {
    water: present && (!frozen || freezing || s.meltT >= 0 || s.broken),
    waterFade:
      s.meltT >= 0 && !s.broken ? melt : freezing ? Math.min(1, (1 - freeze) / CLOSING) : 1,
    ice,
    freeze,
    melt,
    done: !present && !ice,
  };
}
