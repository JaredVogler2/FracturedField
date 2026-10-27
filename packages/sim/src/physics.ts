import type { ArenaLayout, CoreRules, GameRules, MaterialId, WorldLimits } from '@ff/game-data';
import { MATERIALS } from '@ff/game-data';
import type { EntityId, EntityKind, PlayerSlot } from '@ff/protocol';
import type { Collider, RigidBody, World, EventQueue } from '@dimforge/rapier3d-compat';
import { arenaStaticShapes, type StaticShape } from './arena.js';
import { RAPIER } from './rapier.js';
import { length3, quatFromYaw } from './math.js';

/** Collision membership bits (Rapier interaction groups: membership << 16 | filter). */
export const GROUP = {
  ARENA: 1 << 0,
  CORE: 1 << 1,
  BOULDER: 1 << 2,
  GUARD: 1 << 3,
  SHARD: 1 << 4,
} as const;

const ALL = 0xffff;

function groups(membership: number, filter = ALL): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export interface EntityRecord {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly owner: PlayerSlot | -1;
  readonly bodyHandle: number;
  readonly colliderHandle: number;
  readonly material: MaterialId;
  /** Bounding radius used by field queries (m). */
  readonly radius: number;
  /** Remaining lifetime in ticks, -1 = permanent. */
  ttl: number;
  /** Accumulated damage impulse (N·s) for breakable entities. */
  damage: number;
}

export interface ImpactReport {
  readonly a: EntityId;
  /** -1 when the other collider is static arena geometry. */
  readonly b: EntityId;
  readonly impulse: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Thin, deterministic wrapper around one Rapier world: static arena, entity registry and the
 * fixed-step integration. Contains no game rules (abilities, scoring, rounds) — those live in
 * GameWorld so that physics truth stays separately testable.
 */
export class PhysicsWorld {
  world: World;
  private queue: EventQueue;
  readonly entities = new Map<EntityId, EntityRecord>();
  private readonly colliderToEntity = new Map<number, EntityId>();
  private nextId = 1;
  readonly staticShapes: readonly StaticShape[];
  /** Minimum reported contact impulse (N·s); resting support is filtered per body mass. */
  private readonly impactThreshold = 10;
  /** Last tick an impact was reported per collider pair (persistent contacts are de-duplicated). */
  private readonly lastImpact = new Map<string, { tick: number; impulse: number }>();
  private stepCount = 0;

  constructor(
    readonly rules: GameRules,
    readonly arena: ArenaLayout,
    restored?: { world: World; entities: readonly EntityRecord[]; nextId: number },
  ) {
    this.staticShapes = arenaStaticShapes(arena);
    if (restored) {
      this.world = restored.world;
      for (const e of restored.entities) {
        this.entities.set(e.id, { ...e });
        this.colliderToEntity.set(e.colliderHandle, e.id);
      }
      this.nextId = restored.nextId;
    } else {
      this.world = new RAPIER.World({ x: 0, y: -rules.gravity, z: 0 });
      this.buildStatics();
    }
    this.world.timestep = 1 / rules.match.tickRate;
    this.world.numSolverIterations = 4;
    this.queue = new RAPIER.EventQueue(true);
  }

  get dt(): number {
    return 1 / this.rules.match.tickRate;
  }

  get limits(): WorldLimits {
    return this.rules.limits;
  }

  get nextEntityId(): number {
    return this.nextId;
  }

  private buildStatics(): void {
    for (const s of this.staticShapes) {
      const mat = MATERIALS[s.material];
      const desc =
        s.kind === 'cuboid'
          ? RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2])
          : RAPIER.ColliderDesc.cylinder(s.halfHeight, s.radius);
      desc
        .setTranslation(s.pos[0], s.pos[1], s.pos[2])
        .setRotation(quatFromYaw(s.yaw))
        .setRestitution(mat.restitution)
        .setFriction(mat.friction)
        .setCollisionGroups(groups(GROUP.ARENA));
      this.world.createCollider(desc);
    }
  }

  /** Number of non-static simulated entities (enforces the dynamic body budget). */
  get entityCount(): number {
    return this.entities.size;
  }

  body(id: EntityId): RigidBody | null {
    const e = this.entities.get(id);
    return e ? this.world.getRigidBody(e.bodyHandle) : null;
  }

  createCore(core: CoreRules, x: number, y: number, z: number): EntityId {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(core.linearDamping)
      .setAngularDamping(core.angularDamping)
      .setCcdEnabled(true)
      .setCanSleep(false);
    const body = this.world.createRigidBody(bodyDesc);
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.ball(core.radius)
        .setMass(core.mass)
        .setRestitution(core.restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setFriction(core.friction)
        .setCollisionGroups(groups(GROUP.CORE))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(this.impactThreshold * this.rules.match.tickRate * 0.8),
      body,
    );
    return this.register('core', -1, body, col, 'riftCore', core.radius, -1);
  }

  createBoulder(
    x: number,
    z: number,
    radius: number,
    mass: number,
    material: MaterialId,
  ): EntityId {
    const mat = MATERIALS[material];
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, radius, z)
        .setLinearDamping(0.9)
        .setAngularDamping(1.2),
    );
    // Slightly irregular boulder: a rounded convex-ish hull keeps rolling lively but stable.
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.ball(radius)
        .setMass(mass)
        .setRestitution(mat.restitution)
        .setFriction(mat.friction)
        .setCollisionGroups(groups(GROUP.BOULDER))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(this.impactThreshold * this.rules.match.tickRate * 0.8),
      body,
    );
    return this.register('boulder', -1, body, col, material, radius, -1);
  }

  /** Static barrier collider (GUARD). Fixed bodies never move once placed. */
  createGuard(
    owner: PlayerSlot,
    x: number,
    z: number,
    yaw: number,
    half: readonly [number, number, number],
    restitution: number,
    ttl: number,
  ): EntityId {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, half[1], z).setRotation(quatFromYaw(yaw)),
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2])
        .setRestitution(restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setFriction(MATERIALS.guardStone.friction)
        .setCollisionGroups(groups(GROUP.GUARD))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(this.impactThreshold * this.rules.match.tickRate * 0.8),
      body,
    );
    return this.register('guard', owner, body, col, 'guardStone', Math.max(half[0], half[2]), ttl);
  }

  private register(
    kind: EntityKind,
    owner: PlayerSlot | -1,
    body: RigidBody,
    col: Collider,
    material: MaterialId,
    radius: number,
    ttl: number,
  ): EntityId {
    const id = this.nextId++;
    const rec: EntityRecord = {
      id,
      kind,
      owner,
      bodyHandle: body.handle,
      colliderHandle: col.handle,
      material,
      radius,
      ttl,
      damage: 0,
    };
    this.entities.set(id, rec);
    this.colliderToEntity.set(col.handle, id);
    return id;
  }

  remove(id: EntityId): void {
    const e = this.entities.get(id);
    if (!e) return;
    const body = this.world.getRigidBody(e.bodyHandle);
    this.world.removeRigidBody(body);
    this.colliderToEntity.delete(e.colliderHandle);
    this.entities.delete(id);
  }

  /**
   * Advances exactly one fixed step and returns impacts above the reporting threshold. Speed caps
   * are enforced after integration; a non-finite body state is reported to the caller to reset.
   */
  step(): { impacts: ImpactReport[]; invalid: EntityId[] } {
    this.world.step(this.queue);
    this.stepCount++;
    const impacts: ImpactReport[] = [];
    const seen = new Set<string>();
    const g = this.rules.gravity;
    const dt = this.dt;
    this.queue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
      if (seen.has(key)) return;
      seen.add(key);
      const c1 = this.world.getCollider(h1);
      const c2 = this.world.getCollider(h2);
      let impulse = 0;
      let px = 0;
      let py = 0;
      let pz = 0;
      let points = 0;
      this.world.contactPair(c1, c2, (manifold) => {
        const n = manifold.numContacts();
        for (let i = 0; i < n; i++) impulse += manifold.contactImpulse(i);
        const sn = manifold.numSolverContacts();
        for (let i = 0; i < sn; i++) {
          const p = manifold.solverContactPoint(i);
          if (p) {
            px += p.x;
            py += p.y;
            pz += p.z;
            points++;
          }
        }
      });
      if (!(impulse >= this.impactThreshold) || points === 0) return;
      const ea = this.colliderToEntity.get(h1) ?? -1;
      const eb = this.colliderToEntity.get(h2) ?? -1;
      // Ignore resting support: impulse must clearly exceed what gravity alone produces.
      const lightest = Math.min(this.massOf(ea), this.massOf(eb));
      if (impulse < 2.2 * lightest * g * dt) return;
      // Persistent contacts (pinned against a wall) report at most every 6 ticks unless harder.
      const prev = this.lastImpact.get(key);
      if (prev && this.stepCount - prev.tick < 6 && impulse < prev.impulse * 2) return;
      this.lastImpact.set(key, { tick: this.stepCount, impulse });
      // Order so `a` is always an entity (statics are -1).
      const [a, b] = ea === -1 ? [eb, ea] : [ea, eb];
      if (a === -1) return;
      impacts.push({ a, b, impulse, x: px / points, y: py / points, z: pz / points });
    });
    // Deterministic order regardless of event queue internals.
    impacts.sort((p, q) => p.a - q.a || p.b - q.b);

    const invalid: EntityId[] = [];
    const maxBody = this.limits.maxBodySpeed;
    const maxCore = this.limits.maxCoreSpeed;
    const maxAng = this.limits.maxAngularSpeed;
    for (const e of this.entities.values()) {
      const body = this.world.getRigidBody(e.bodyHandle);
      if (!body.isDynamic()) continue;
      const t = body.translation();
      const v = body.linvel();
      const w = body.angvel();
      if (
        !Number.isFinite(t.x + t.y + t.z) ||
        !Number.isFinite(v.x + v.y + v.z) ||
        !Number.isFinite(w.x + w.y + w.z)
      ) {
        invalid.push(e.id);
        continue;
      }
      const cap = e.kind === 'core' ? maxCore : maxBody;
      const speed = length3(v.x, v.y, v.z);
      if (speed > cap) {
        const s = cap / speed;
        body.setLinvel({ x: v.x * s, y: v.y * s, z: v.z * s }, true);
      }
      const ang = length3(w.x, w.y, w.z);
      if (ang > maxAng) {
        const s = maxAng / ang;
        body.setAngvel({ x: w.x * s, y: w.y * s, z: w.z * s }, true);
      }
    }
    return { impacts, invalid };
  }

  /** Mass of an entity's body (Infinity for statics / unknown, so statics never filter). */
  private massOf(id: EntityId): number {
    if (id < 0) return Number.POSITIVE_INFINITY;
    const e = this.entities.get(id);
    if (!e) return Number.POSITIVE_INFINITY;
    const b = this.world.getRigidBody(e.bodyHandle);
    return b.isDynamic() ? b.mass() : Number.POSITIVE_INFINITY;
  }

  /** Serialises the Rapier world (bodies, colliders, contacts, islands). */
  takeSnapshot(): Uint8Array {
    return this.world.takeSnapshot();
  }

  entityRecords(): EntityRecord[] {
    return [...this.entities.values()].map((e) => ({ ...e }));
  }

  dispose(): void {
    this.queue.free();
    this.world.free();
    this.entities.clear();
    this.colliderToEntity.clear();
  }
}

export function restoreRapierWorld(bytes: Uint8Array): World {
  return RAPIER.World.restoreSnapshot(bytes);
}
