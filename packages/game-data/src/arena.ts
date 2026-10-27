import type { MaterialId } from './materials.js';

/**
 * World coordinate contract: metres, Y up, scoring along X, arena symmetric about the origin.
 * Player slot 0 (amber) defends the goal at -X and attacks +X; slot 1 (cyan) is mirrored.
 */
export interface GoalDef {
  /** Half width of the goal mouth along Z. */
  readonly mouthHalfWidth: number;
  /** Height of the crossbar above the floor. */
  readonly mouthHeight: number;
  /** Depth of the goal cavity behind the goal line. */
  readonly depth: number;
  readonly postRadius: number;
}

export interface PillarObstacle {
  readonly kind: 'pillar';
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
  readonly material: MaterialId;
}

export interface BoulderObstacle {
  readonly kind: 'boulder';
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly mass: number;
  readonly material: MaterialId;
}

export type ObstacleDef = PillarObstacle | BoulderObstacle;

export interface ArenaLayout {
  readonly id: string;
  readonly name: string;
  /** Half extents of the playable floor (goal line at x = ±halfLength). */
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly wallHeight: number;
  /** Size of the 45° chamfer cut into each corner (m along each wall). */
  readonly cornerChamfer: number;
  /** Invisible ceiling that bounds lifted bodies. */
  readonly ceilingHeight: number;
  readonly goal: GoalDef;
  readonly obstacles: readonly ObstacleDef[];
  /** Manipulator start position for slot 0 (slot 1 mirrored in X). */
  readonly spawnX: number;
}

/** "The Shattered Meridian" — starter competitive arena. Collision map strictly mirror symmetric. */
export const MERIDIAN_ARENA: ArenaLayout = {
  id: 'meridian',
  name: 'The Shattered Meridian',
  halfLength: 21,
  halfWidth: 12.5,
  wallHeight: 4,
  cornerChamfer: 3.2,
  ceilingHeight: 9,
  goal: {
    mouthHalfWidth: 3.6,
    mouthHeight: 4.6,
    depth: 3.2,
    postRadius: 0.35,
  },
  obstacles: [
    {
      kind: 'pillar',
      id: 'pillar-nw',
      x: -10.5,
      z: -6.2,
      radius: 0.95,
      height: 4.2,
      material: 'basalt',
    },
    {
      kind: 'pillar',
      id: 'pillar-sw',
      x: -10.5,
      z: 6.2,
      radius: 0.95,
      height: 4.2,
      material: 'basalt',
    },
    {
      kind: 'pillar',
      id: 'pillar-ne',
      x: 10.5,
      z: -6.2,
      radius: 0.95,
      height: 4.2,
      material: 'basalt',
    },
    {
      kind: 'pillar',
      id: 'pillar-se',
      x: 10.5,
      z: 6.2,
      radius: 0.95,
      height: 4.2,
      material: 'basalt',
    },
    {
      kind: 'boulder',
      id: 'boulder-n',
      x: 0,
      z: -8.2,
      radius: 0.75,
      mass: 22,
      material: 'basaltFractured',
    },
    {
      kind: 'boulder',
      id: 'boulder-s',
      x: 0,
      z: 8.2,
      radius: 0.75,
      mass: 22,
      material: 'basaltFractured',
    },
  ],
  spawnX: 15,
};

export const ARENAS: Readonly<Record<string, ArenaLayout>> = {
  [MERIDIAN_ARENA.id]: MERIDIAN_ARENA,
};
