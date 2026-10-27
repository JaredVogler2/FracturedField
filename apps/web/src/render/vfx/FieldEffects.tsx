import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DEFAULT_ABILITIES, DEFAULT_RULES } from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';
import { useRenderFrame } from '../frame-context';
import { TEAM_COLORS } from '../art-tokens';
import { mulberry32 } from '../procedural';
import { localAim, localHand } from './local-aim';

const MAX_SWEEPS = 6;
const STREAKS = 36;

/**
 * Crosswind fields from authoritative snapshot effects: a faint boundary ring plus streaks that
 * flow along the real wind direction, so players can read and predict the deflection.
 */
export function SweepFields() {
  const frame = useRenderFrame();
  const offsets = useMemo(() => {
    const r = mulberry32(5);
    return Array.from({ length: STREAKS }, () => ({
      lateral: r() * 2 - 1,
      phase: r(),
      speed: 0.7 + r() * 0.6,
      len: 0.5 + r() * 0.9,
    }));
  }, []);
  const pools = useMemo(
    () =>
      Array.from({ length: MAX_SWEEPS }, () => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3).setUsage(
            THREE.DynamicDrawUsage,
          ),
        );
        geo.setAttribute(
          'color',
          new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3).setUsage(
            THREE.DynamicDrawUsage,
          ),
        );
        const mat = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const lines = new THREE.LineSegments(geo, mat);
        lines.frustumCulled = false;
        lines.visible = false;
        const ringMat = new THREE.MeshBasicMaterial({
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 72), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.visible = false;
        return { geo, mat, lines, ringMat, ring };
      }),
    [],
  );
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const p of pools) g.add(p.lines, p.ring);
    return () => {
      for (const p of pools) {
        g.remove(p.lines, p.ring);
        p.geo.dispose();
        p.mat.dispose();
        p.ring.geometry.dispose();
        p.ringMat.dispose();
      }
    };
  }, [pools]);

  const color = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    const effects = (frame.current?.latest?.effects ?? []).filter((e) => e.kind === 'sweep');
    const t = clock.elapsedTime;
    for (let i = 0; i < MAX_SWEEPS; i++) {
      const pool = pools[i]!;
      const fx = effects[i];
      if (!fx) {
        pool.lines.visible = false;
        pool.ring.visible = false;
        continue;
      }
      const life = Math.min(1, fx.ttl / 8, (fx.maxTtl - fx.ttl + 1) / 3);
      color.set(TEAM_COLORS[fx.owner]);
      pool.ring.visible = true;
      pool.ring.position.set(fx.p[0], 0.05, fx.p[2]);
      pool.ring.scale.setScalar(fx.r);
      pool.ringMat.color.copy(color);
      pool.ringMat.opacity = 0.35 * life;
      const [dx, dz] = fx.d;
      const px = -dz;
      const pz = dx;
      const pos = pool.geo.attributes.position!.array as Float32Array;
      const col = pool.geo.attributes.color!.array as Float32Array;
      for (let s = 0; s < STREAKS; s++) {
        const o = offsets[s]!;
        const along = (((t * o.speed * 1.6 + o.phase) % 1) * 2 - 1) * fx.r;
        const lat = o.lateral * fx.r * Math.sqrt(Math.max(0, 1 - (along / fx.r) ** 2));
        const cx = fx.p[0] + dx * along + px * lat;
        const cz = fx.p[2] + dz * along + pz * lat;
        const half = o.len * 0.5;
        const y = 0.35 + (s % 5) * 0.28;
        pos.set([cx - dx * half, y, cz - dz * half, cx + dx * half, y, cz + dz * half], s * 6);
        const edge = 1 - Math.min(1, Math.hypot(cx - fx.p[0], cz - fx.p[2]) / fx.r);
        const a = life * edge * 0.9;
        col.set(
          [
            color.r * a * 0.2,
            color.g * a * 0.2,
            color.b * a * 0.2,
            color.r * a,
            color.g * a,
            color.b * a,
          ],
          s * 6,
        );
      }
      pool.geo.attributes.position!.needsUpdate = true;
      pool.geo.attributes.color!.needsUpdate = true;
      pool.lines.visible = true;
    }
  });
  return <group ref={group} />;
}

/** Energy tether from a player's manipulator to the body they are lifting. */
export function LiftTethers() {
  const frame = useRenderFrame();
  const refs = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)] as const;
  const mats = useMemo(
    () =>
      TEAM_COLORS.map(
        (c) =>
          new THREE.MeshBasicMaterial({
            color: c,
            transparent: true,
            opacity: 0.75,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
      ),
    [],
  );
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  useFrame(({ clock }) => {
    const f = frame.current;
    for (const slot of [0, 1] as const) {
      const mesh = refs[slot].current;
      if (!mesh) continue;
      const p = f?.latest?.players[slot];
      const target = p && p.hold === 'lift' ? f.entities.get(p.holdTarget) : undefined;
      if (!f || !p || !target) {
        mesh.visible = false;
        continue;
      }
      const m = f.manipulators[slot];
      a.set(m.x, DEFAULT_RULES.manipulator.height, m.z);
      b.set(target.px, target.py, target.pz);
      const len = a.distanceTo(b);
      mesh.visible = true;
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      const pulse = 0.85 + 0.15 * Math.sin(clock.elapsedTime * 18);
      mesh.scale.set(pulse, len, pulse);
    }
  });
  return (
    <group>
      {([0, 1] as const).map((slot) => (
        <mesh key={slot} ref={refs[slot]} material={mats[slot]} visible={false}>
          <cylinderGeometry args={[0.07, 0.12, 1, 10, 1, true]} />
        </mesh>
      ))}
    </group>
  );
}

/** Radius (m) of a body a hand can hold, for the clasp drawn around it. */
function heldRadius(kind: string): number {
  switch (kind) {
    case 'core':
      return DEFAULT_RULES.core.radius;
    case 'shard':
      return DEFAULT_RULES.elements.fracture.shardRadius;
    case 'lodestone':
      return 0.55;
    default:
      return 0.75;
  }
}

/** A clasp ring (unit radius) lying flat, and one arc of the spin swirl. */
function flatTorus(): THREE.BufferGeometry {
  return new THREE.TorusGeometry(1, 0.05, 6, 40).rotateX(Math.PI / 2);
}
function swirlArc(): THREE.BufferGeometry {
  return new THREE.RingGeometry(1, 1.1, 20, 1, 0, Math.PI / 2.6).rotateX(-Math.PI / 2);
}

/**
 * Continuous manipulation (ADR-0009), drawn from the authoritative snapshot only: a taut tether
 * from a player's force point to the body their hand holds, a clasp around that body, and a
 * swirl around the core while it carries a deliberate spin — it will curve. Cosmetic; it decides
 * nothing.
 */
export function GripFeedback() {
  const frame = useRenderFrame();
  const tethers = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)] as const;
  const clasps = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)] as const;
  const swirl = useRef<THREE.Group>(null);
  const mats = useMemo(
    () =>
      TEAM_COLORS.map(
        (c) =>
          new THREE.MeshBasicMaterial({
            color: c,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
      ),
    [],
  );
  const swirlMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#d9ccff',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const torus = useMemo(flatTorus, []);
  const arc = useMemo(swirlArc, []);
  useEffect(
    () => () => {
      mats.forEach((m) => m.dispose());
      swirlMat.dispose();
      torus.dispose();
      arc.dispose();
    },
    [mats, swirlMat, torus, arc],
  );
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const spinAngle = useRef(0);
  useFrame(({ clock }, delta) => {
    const f = frame.current;
    const latest = f?.latest ?? null;
    for (const slot of [0, 1] as const) {
      const t = tethers[slot].current;
      const c = clasps[slot].current;
      if (!t || !c) continue;
      const id = latest?.players[slot].grasp ?? -1;
      const body = f && id >= 0 ? f.entities.get(id) : undefined;
      if (!f || !body) {
        t.visible = c.visible = false;
        continue;
      }
      const m = f.manipulators[slot];
      a.set(m.x, DEFAULT_RULES.manipulator.height, m.z);
      b.set(body.px, body.py, body.pz);
      const len = a.distanceTo(b);
      t.visible = len > 0.05;
      t.position.copy(a).add(b).multiplyScalar(0.5);
      t.quaternion.setFromUnitVectors(up, dir.copy(b).sub(a).normalize());
      t.scale.set(1, len, 1);
      c.visible = true;
      c.position.copy(b);
      c.scale.setScalar(
        (heldRadius(body.kind) + 0.22) * (1 + 0.04 * Math.sin(clock.elapsedTime * 6)),
      );
    }
    const g = swirl.current;
    if (!g) return;
    const snap = latest?.entities.find((e) => e.kind === 'core');
    const core = f && snap ? f.entities.get(snap.id) : undefined;
    const spin = snap?.s ?? 0;
    if (!core || core.veiled || Math.abs(spin) < 0.6) {
      g.visible = false;
      return;
    }
    // The swirl turns as the core does (rad/s about +y), so its direction says which way it bends.
    spinAngle.current += spin * delta;
    g.visible = true;
    g.position.set(core.px, core.py, core.pz);
    g.rotation.y = spinAngle.current;
    g.scale.setScalar(DEFAULT_RULES.core.radius + 0.38);
    swirlMat.opacity = Math.min(0.8, Math.abs(spin) / 10);
  });
  return (
    <group>
      {([0, 1] as const).map((slot) => (
        <group key={slot}>
          <mesh ref={tethers[slot]} material={mats[slot]} visible={false} renderOrder={4}>
            <cylinderGeometry args={[0.06, 0.09, 1, 10, 1, true]} />
          </mesh>
          <mesh
            ref={clasps[slot]}
            geometry={torus}
            material={mats[slot]}
            visible={false}
            renderOrder={4}
          />
        </group>
      ))}
      <group ref={swirl} visible={false}>
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            geometry={arc}
            material={swirlMat}
            rotation-y={(i * 2 * Math.PI) / 3}
            renderOrder={4}
          />
        ))}
      </group>
    </group>
  );
}

const TRAIL = 28;

/** Velocity-driven ribbon trail behind the Rift Core (narrates real motion, never invents it). */
export function CoreTrail() {
  const frame = useRenderFrame();
  const history = useRef<THREE.Vector3[]>(Array.from({ length: TRAIL }, () => new THREE.Vector3()));
  const count = useRef(0);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(TRAIL * 2 * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    g.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(TRAIL * 2 * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const idx: number[] = [];
    for (let i = 0; i < TRAIL - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  const mesh = useRef<THREE.Mesh>(null);
  const violet = useMemo(() => new THREE.Color('#b9a8ff'), []);
  const probe = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const f = frame.current;
    let core = null;
    if (f) for (const e of f.entities.values()) if (e.kind === 'core') core = e;
    const m = mesh.current;
    if (!core || !m) return;
    const h = history.current;
    const head = h[0]!;
    const speed = Math.hypot(core.vx, core.vy, core.vz);
    probe.set(core.px, core.py, core.pz);
    if (count.current === 0 || head.distanceToSquared(probe) > 0.04 || speed < 0.5) {
      for (let i = TRAIL - 1; i > 0; i--) h[i]!.copy(h[i - 1]!);
      head.set(core.px, core.py, core.pz);
      count.current = Math.min(TRAIL, count.current + 1);
    }
    // Teleports (kickoff reset) must not draw a streak across the arena.
    if (h[1] && head.distanceTo(h[1]) > 3) {
      for (const v of h) v.copy(head);
    }
    const pos = geo.attributes.position!.array as Float32Array;
    const col = geo.attributes.color!.array as Float32Array;
    const width = Math.min(0.9, 0.15 + speed * 0.035);
    // Inside steam the server veils the core: its trail fades so the path is not given away.
    const strength = core.veiled ? 0 : Math.min(1, speed / 14);
    for (let i = 0; i < TRAIL; i++) {
      const p = h[Math.min(i, count.current - 1)]!;
      const q = h[Math.min(i + 1, count.current - 1)]!;
      let dx = p.x - q.x;
      let dz = p.z - q.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const w = width * (1 - i / TRAIL);
      pos.set([p.x - dz * w, p.y, p.z + dx * w, p.x + dz * w, p.y, p.z - dx * w], i * 6);
      const a = strength * (1 - i / TRAIL) ** 1.5;
      col.set(
        [violet.r * a, violet.g * a, violet.b * a, violet.r * a, violet.g * a, violet.b * a],
        i * 6,
      );
    }
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.color!.needsUpdate = true;
    geo.computeBoundingSphere();
  });
  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={4} />;
}

/**
 * Approximate pulse aim preview for local seats: where a pulse would push the core right now.
 * Deliberately approximate (no rebound prediction) so it aids reading without aim-botting.
 */
export function AimPreview({ slots }: { slots: readonly PlayerSlot[] }) {
  const frame = useRenderFrame();
  const refs = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)] as const;
  const mats = useMemo(
    () =>
      TEAM_COLORS.map(
        (c) =>
          new THREE.MeshBasicMaterial({
            color: c,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
      ),
    [],
  );
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  const geo = useMemo(() => {
    // Chevron strip pointing along +X, length 1, width 1.
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.08);
    shape.lineTo(0.82, -0.08);
    shape.lineTo(0.82, -0.32);
    shape.lineTo(1, 0);
    shape.lineTo(0.82, 0.32);
    shape.lineTo(0.82, 0.08);
    shape.lineTo(0, 0.08);
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const def = DEFAULT_ABILITIES.pulse;
  useFrame(() => {
    const f = frame.current;
    let core = null;
    if (f) for (const e of f.entities.values()) if (e.kind === 'core') core = e;
    for (const slot of [0, 1] as const) {
      const mesh = refs[slot].current;
      if (!mesh) continue;
      const active = slots.includes(slot) && f?.latest?.match.phase === 'playing';
      // A veiled core (inside steam) gets no aim preview: the server withholds that read.
      if (!active || !core || !f || core.veiled) {
        mesh.visible = false;
        continue;
      }
      // The authoritative manipulator is where the pulse will originate (not the local reticle).
      const m = f.manipulators[slot];
      const dx = core.px - m.x;
      const dz = core.pz - m.z;
      const d = Math.hypot(dx, dz);
      const strength =
        d <= def.fullStrengthRadius
          ? 1
          : d >= def.radius
            ? 0
            : 1 - (d - def.fullStrengthRadius) / (def.radius - def.fullStrengthRadius);
      if (strength <= 0.05 || d < 1e-3) {
        mesh.visible = false;
        continue;
      }
      const len = 1.5 + 5.5 * strength;
      mesh.visible = true;
      mesh.position.set(core.px + (dx / d) * 1.0, 0.09, core.pz + (dz / d) * 1.0);
      mesh.rotation.set(0, -Math.atan2(dz, dx), 0);
      mesh.scale.set(len, 1, 1.4);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.45 * strength;
    }
  });
  return (
    <group>
      {([0, 1] as const).map((slot) => (
        <mesh
          key={slot}
          ref={refs[slot]}
          geometry={geo}
          material={mats[slot]}
          visible={false}
          renderOrder={3}
        />
      ))}
    </group>
  );
}

/** Local-only aim reticles (instant cosmetic feedback for this device's seats). */
export function Reticles({ slots }: { slots: readonly PlayerSlot[] }) {
  const refs = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)] as const;
  const mats = useMemo(
    () =>
      TEAM_COLORS.map(
        (c) =>
          new THREE.MeshBasicMaterial({
            color: c,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
      ),
    [],
  );
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  useFrame(({ clock }) => {
    for (const slot of [0, 1] as const) {
      const mesh = refs[slot].current;
      if (!mesh) continue;
      const aim = slots.includes(slot) ? localAim.get(slot) : undefined;
      mesh.visible = Boolean(aim);
      if (!aim) continue;
      mesh.position.set(aim.x, 0.07, aim.z);
      mesh.rotation.set(-Math.PI / 2, 0, clock.elapsedTime * 1.5);
      // Hands-on: the reticle is the hand — closing it tightens and brightens the ring, a push
      // widens it, a pull draws it in.
      const h = localHand.get(slot);
      const grip = h?.grip ?? 0;
      const push = h?.push ?? 0;
      mesh.scale.setScalar(
        (1 - 0.4 * grip) * (1 + 0.6 * Math.max(0, push) - 0.3 * Math.max(0, -push)),
      );
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * grip;
    }
  });
  return (
    <group>
      {([0, 1] as const).map((slot) => (
        <mesh key={slot} ref={refs[slot]} material={mats[slot]} visible={false} renderOrder={3}>
          <ringGeometry args={[0.28, 0.36, 4, 1]} />
        </mesh>
      ))}
    </group>
  );
}
