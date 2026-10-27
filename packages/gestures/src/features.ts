import { angle, cross, dist, dot, finite3, norm, sub, type V3 } from './math.js';
import { LM, type Handedness, type Point3 } from './types.js';

/**
 * Per-frame geometric features of one hand, in aspect-corrected units (x scaled by the frame's
 * aspect ratio so distances are isotropic). Nothing here claims metric depth: palm scale is an
 * image-space size used for relative measures (approach toward the camera, normalised speed).
 */
export interface HandFeatures {
  /** Palm centre (mean of wrist and the four finger MCPs), aspect-corrected image units. */
  readonly center: V3;
  /** Apparent palm size: robust to in-plane rotation, partially to tilt. */
  readonly scale: number;
  /** Unit palm normal pointing out of the palm (toward the camera when the palm faces it). */
  readonly normal: V3;
  /** Bend angle (radians) of index, middle, ring, pinky — 0 = straight. */
  readonly bend: readonly [number, number, number, number];
  /** Thumb extension measure: tip distance from the palm centre over palm scale. */
  readonly thumbReach: number;
  /** Thumb straightness: bend at the thumb MCP–IP–TIP chain (radians). */
  readonly thumbBend: number;
  /**
   * Thumb tip offset along the palm's lateral axis (pinky → index side) over palm scale: an
   * abducted thumb sits well outside the index side, a tucked one lies across the palm.
   */
  readonly thumbLateral: number;
  /** Thumb tip to index tip over palm scale (pinch < ~0.3). */
  readonly pinch: number;
}

const FINGERS: readonly (readonly [number, number, number, number])[] = [
  [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
];

/** Converts raw normalised landmarks to aspect-corrected coordinates (x × width / height). */
export function aspectCorrect(lm: readonly Point3[], aspect: number): V3[] {
  return lm.map((p) => ({ x: p.x * aspect, y: p.y, z: p.z * aspect }));
}

export function validHand(lm: readonly Point3[]): boolean {
  return lm.length === 21 && lm.every(finite3);
}

/** Total bend along a finger chain: angle(MCP→PIP, PIP→DIP) + angle(PIP→DIP, DIP→TIP). */
function chainBend(p: readonly V3[], c: readonly [number, number, number, number]): number {
  const a = sub(p[c[1]]!, p[c[0]]!);
  const b = sub(p[c[2]]!, p[c[1]]!);
  const d = sub(p[c[3]]!, p[c[2]]!);
  return angle(a, b) + angle(b, d);
}

export function handFeatures(
  raw: readonly Point3[],
  aspect: number,
  handedness: Handedness,
): HandFeatures | null {
  if (!validHand(raw)) return null;
  const p = aspectCorrect(raw, aspect);
  const w = p[LM.WRIST]!;
  const iM = p[LM.INDEX_MCP]!;
  const mM = p[LM.MIDDLE_MCP]!;
  const rM = p[LM.RING_MCP]!;
  const pM = p[LM.PINKY_MCP]!;
  const center = {
    x: (w.x + iM.x + mM.x + rM.x + pM.x) / 5,
    y: (w.y + iM.y + mM.y + rM.y + pM.y) / 5,
    z: (w.z + iM.z + mM.z + rM.z + pM.z) / 5,
  };
  const scale = Math.max(dist(w, mM), dist(iM, pM) * 1.6, 1e-6);
  // In the raw (unmirrored) frame of a camera facing the user, (index − wrist) × (pinky − wrist)
  // points out of a right palm; a left hand is the mirror image, so its sign flips.
  const n = norm(cross(sub(iM, w), sub(pM, w)));
  const normal = handedness === 'right' ? n : { x: -n.x, y: -n.y, z: -n.z };
  const bend = FINGERS.map((c) => chainBend(p, c)) as unknown as [number, number, number, number];
  const tT = p[LM.THUMB_TIP]!;
  const thumbReach = dist(tT, center) / scale;
  const thumbBend =
    angle(sub(p[LM.THUMB_IP]!, p[LM.THUMB_MCP]!), sub(tT, p[LM.THUMB_IP]!)) +
    angle(sub(p[LM.THUMB_MCP]!, p[LM.THUMB_CMC]!), sub(p[LM.THUMB_IP]!, p[LM.THUMB_MCP]!));
  const lateral = norm(sub(iM, pM));
  const thumbLateral = dot(sub(tT, center), lateral) / scale;
  const pinch = dist(tT, p[LM.INDEX_TIP]!) / scale;
  if (!Number.isFinite(scale + center.x + center.y + thumbReach + thumbLateral + pinch))
    return null;
  return { center, scale, normal, bend, thumbReach, thumbBend, thumbLateral, pinch };
}
