import type { ArenaLayout, MaterialId } from '@ff/game-data';

/**
 * Pure-data description of every static collider in an arena. The same list builds the Rapier
 * colliders on the authority and the /sim-debug overlay in the browser, so the debug view can
 * never drift from the real collision map.
 */
export type StaticShape =
  | {
      readonly kind: 'cuboid';
      readonly id: string;
      readonly half: readonly [number, number, number];
      readonly pos: readonly [number, number, number];
      readonly yaw: number;
      readonly material: MaterialId;
      readonly role: StaticRole;
    }
  | {
      readonly kind: 'cylinder';
      readonly id: string;
      readonly radius: number;
      readonly halfHeight: number;
      readonly pos: readonly [number, number, number];
      readonly yaw: number;
      readonly material: MaterialId;
      readonly role: StaticRole;
    };

export type StaticRole = 'floor' | 'wall' | 'containment' | 'goal' | 'post' | 'ceiling' | 'pillar';

const WALL_T = 1; // collision wall thickness

export function arenaStaticShapes(a: ArenaLayout): StaticShape[] {
  const shapes: StaticShape[] = [];
  const L = a.halfLength;
  const W = a.halfWidth;
  const C = a.cornerChamfer;
  const H = a.ceilingHeight;
  const g = a.goal;

  // Floor slab (top surface at y = 0), extends under the goal cavities.
  shapes.push({
    kind: 'cuboid',
    id: 'floor',
    half: [L + g.depth + 3, 0.5, W + 3],
    pos: [0, -0.5, 0],
    yaw: 0,
    material: 'basalt',
    role: 'floor',
  });

  // Ceiling bounds lifted bodies.
  shapes.push({
    kind: 'cuboid',
    id: 'ceiling',
    half: [L + g.depth + 3, 0.5, W + 3],
    pos: [0, H + 0.5, 0],
    yaw: 0,
    material: 'basalt',
    role: 'ceiling',
  });

  // Side walls (z = ±W), shortened by the corner chamfers; full containment height.
  for (const side of [-1, 1] as const) {
    shapes.push({
      kind: 'cuboid',
      id: `wall-side-${side > 0 ? 's' : 'n'}`,
      half: [L - C, H / 2, WALL_T / 2],
      pos: [0, H / 2, side * (W + WALL_T / 2)],
      yaw: 0,
      material: 'basalt',
      role: 'wall',
    });
  }

  // End walls (x = ±L) either side of the goal mouth, plus the lintel above the mouth.
  const endSegHalf = (W - C - g.mouthHalfWidth) / 2;
  for (const end of [-1, 1] as const) {
    for (const side of [-1, 1] as const) {
      shapes.push({
        kind: 'cuboid',
        id: `wall-end-${end > 0 ? 'e' : 'w'}-${side > 0 ? 's' : 'n'}`,
        half: [WALL_T / 2, H / 2, endSegHalf],
        pos: [end * (L + WALL_T / 2), H / 2, side * (g.mouthHalfWidth + endSegHalf)],
        yaw: 0,
        material: 'basalt',
        role: 'wall',
      });
    }
    const lintelHalfH = (H - g.mouthHeight) / 2;
    shapes.push({
      kind: 'cuboid',
      id: `lintel-${end > 0 ? 'e' : 'w'}`,
      half: [WALL_T / 2, lintelHalfH, g.mouthHalfWidth + g.postRadius],
      pos: [end * (L + WALL_T / 2), g.mouthHeight + lintelHalfH, 0],
      yaw: 0,
      material: 'brass',
      role: 'goal',
    });

    // Goal cavity: two side walls, back wall and roof. The cavity is closed so the core can only
    // enter through the mouth (wrong-direction entry is physically impossible).
    const cx = end * (L + g.depth / 2);
    for (const side of [-1, 1] as const) {
      shapes.push({
        kind: 'cuboid',
        id: `goal-${end > 0 ? 'e' : 'w'}-side-${side > 0 ? 's' : 'n'}`,
        half: [g.depth / 2, g.mouthHeight / 2, 0.25],
        pos: [cx, g.mouthHeight / 2, side * (g.mouthHalfWidth + 0.25)],
        yaw: 0,
        material: 'brass',
        role: 'goal',
      });
    }
    shapes.push({
      kind: 'cuboid',
      id: `goal-${end > 0 ? 'e' : 'w'}-back`,
      half: [0.25, g.mouthHeight / 2, g.mouthHalfWidth + 0.5],
      pos: [end * (L + g.depth + 0.25), g.mouthHeight / 2, 0],
      yaw: 0,
      material: 'brass',
      role: 'goal',
    });
    shapes.push({
      kind: 'cuboid',
      id: `goal-${end > 0 ? 'e' : 'w'}-roof`,
      half: [g.depth / 2 + 0.25, 0.25, g.mouthHalfWidth + 0.5],
      pos: [cx, g.mouthHeight + 0.25, 0],
      yaw: 0,
      material: 'brass',
      role: 'goal',
    });

    // Rounded posts produce readable, interesting deflections.
    for (const side of [-1, 1] as const) {
      shapes.push({
        kind: 'cylinder',
        id: `post-${end > 0 ? 'e' : 'w'}-${side > 0 ? 's' : 'n'}`,
        radius: g.postRadius,
        halfHeight: g.mouthHeight / 2,
        pos: [end * L, g.mouthHeight / 2, side * g.mouthHalfWidth],
        yaw: 0,
        material: 'brass',
        role: 'post',
      });
    }
  }

  // 45° corner chamfers remove corner traps.
  const chamferHalf = (C * Math.SQRT2) / 2;
  for (const ex of [-1, 1] as const) {
    for (const ez of [-1, 1] as const) {
      // Inner face passes through (ex*(L-C), ez*W) and (ex*L, ez*(W-C)); push centre outward.
      const nx = ex / Math.SQRT2;
      const nz = ez / Math.SQRT2;
      const mx = ex * (L - C / 2);
      const mz = ez * (W - C / 2);
      shapes.push({
        kind: 'cuboid',
        id: `chamfer-${ex > 0 ? 'e' : 'w'}-${ez > 0 ? 's' : 'n'}`,
        half: [chamferHalf, H / 2, WALL_T / 2],
        pos: [mx + (nx * WALL_T) / 2, H / 2, mz + (nz * WALL_T) / 2],
        // Long axis must run along (ex, -ez). A yaw θ maps local +X to (cos θ, -sin θ),
        // so θ = atan2(ez, ex); local +Z (thickness) then points along ±(ex, ez).
        yaw: Math.atan2(ez, ex),
        material: 'basalt',
        role: 'wall',
      });
    }
  }

  for (const o of a.obstacles) {
    if (o.kind !== 'pillar') continue;
    shapes.push({
      kind: 'cylinder',
      id: o.id,
      radius: o.radius,
      halfHeight: o.height / 2,
      pos: [o.x, o.height / 2, o.z],
      yaw: 0,
      material: o.material,
      role: 'pillar',
    });
  }

  return shapes;
}
