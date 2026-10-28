import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { DEFAULT_ABILITIES, DEFAULT_RULES } from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';
import { useRenderFrame } from '../frame-context';
import { TEAM_COLORS } from '../art-tokens';
import { mulberry32 } from '../procedural';
import { localAim, localHand } from './local-aim';
import { RegionPoints, createRegionPointsMaterial, softSprite } from './points';
import { RibbonBatch, ribbonMaterial } from './ribbons';

const MAX_SWEEPS = 6;
const STREAMLINES: Record<'low' | 'medium' | 'high', number> = { low: 10, medium: 16, high: 22 };
const DUST: Record<'low' | 'medium' | 'high', number> = { low: 14, medium: 26, high: 40 };
const LINE_POINTS = 9;
const WISP_POINTS = 14;
const AIR = new THREE.Color(0.82, 0.9, 1.0);

/**
 * Crosswind fields (7C / D09) from authoritative snapshot effects, so players can read and predict
 * the deflection: thin streamlines that flow downwind through the field, brightest where the push
 * is strongest (the authority's own falloff), two dashed wisps tracing its edges, and fine dust
 * carried along. Pale air with only a hint of the caster's colour.
 */
export function SweepFields({ tier = 'high' }: { tier?: 'low' | 'medium' | 'high' }) {
  const frame = useRenderFrame();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const parts = useMemo(() => {
    const lines = new RibbonBatch(
      MAX_SWEEPS * (STREAMLINES.high * LINE_POINTS + 2 * WISP_POINTS),
      ribbonMaterial(true),
    );
    lines.mesh.renderOrder = 4;
    const sprite = softSprite();
    const dust = new RegionPoints(MAX_SWEEPS * DUST.high, createRegionPointsMaterial(true, sprite));
    dust.points.renderOrder = 4;
    return { lines, dust, sprite, pts: new Float32Array(Math.max(LINE_POINTS, WISP_POINTS) * 3) };
  }, []);
  const offsets = useMemo(() => {
    const r = mulberry32(5);
    return Array.from({ length: Math.max(STREAMLINES.high, DUST.high) }, () => ({
      lateral: r() * 2 - 1,
      phase: r(),
      speed: 0.7 + r() * 0.6,
      len: 2.0 + r() * 1.4,
      height: 0.3 + r() * 1.4,
      curl: r() * 6.283,
    }));
  }, []);
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.add(parts.lines.mesh, parts.dust.points);
    return () => {
      g.remove(parts.lines.mesh, parts.dust.points);
      parts.lines.dispose();
      parts.dust.dispose();
      parts.sprite.dispose();
    };
  }, [parts]);

  const tint = useMemo(() => new THREE.Color(), []);
  const shown = useRef(0);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const effects = frame.current?.latest?.effects ?? [];
    const { lines, dust, pts } = parts;
    (lines.material.uniforms.uTime as THREE.IUniform).value = t;
    dust.mat.uniforms.uScale!.value = (size.height * camera.projectionMatrix.elements[5]) / 2;
    lines.begin(camera);
    let nd = 0;
    let count = 0;
    for (const fx of effects) {
      if (fx.kind !== 'sweep' || count++ >= MAX_SWEEPS) continue;
      const life = Math.max(0, Math.min(1, fx.ttl / 8, (fx.maxTtl - fx.ttl + 1) / 3));
      tint.set(TEAM_COLORS[fx.owner]).lerp(AIR, 0.75);
      const [dx, dz] = fx.d;
      const px = -dz;
      const pz = dx;
      const R = fx.r;
      // The authority's falloff at a point: smoothstep of the distance in from the edge.
      const push = (x: number, z: number) => {
        const k = Math.max(0, 1 - Math.hypot(x - fx.p[0], z - fx.p[2]) / R);
        return k * k * (3 - 2 * k);
      };
      for (let s = 0; s < STREAMLINES[tier]; s++) {
        const o = offsets[s]!;
        const head = (((t * o.speed * 0.9 + o.phase) % 1) * 2.2 - 1.1) * R;
        for (let j = 0; j < LINE_POINTS; j++) {
          const along = head - o.len * (1 - j / (LINE_POINTS - 1));
          // Straight and parallel (a sweep is a uniform crosswind); the push fades them at the edge.
          const lat = o.lateral * R * 0.85 + Math.sin(along * 1.1 + o.curl) * 0.07;
          pts[j * 3] = fx.p[0] + dx * along + px * lat;
          pts[j * 3 + 1] = o.height + Math.sin(along * 0.9 + o.curl) * 0.12;
          pts[j * 3 + 2] = fx.p[2] + dz * along + pz * lat;
        }
        lines.add(pts, 0, LINE_POINTS, 0.08, tint.r, tint.g, tint.b, 0.7 * life, (j) => {
          // Bright at the head, fading toward the tail.
          const fromTail = j / (LINE_POINTS - 1);
          return push(pts[j * 3]!, pts[j * 3 + 2]!) * Math.pow(fromTail, 0.7);
        });
      }
      // The two edges of the current: dashed wisps running downwind, parallel to the streamlines
      // (an arc round the field read as a vortex, which a sweep is not).
      for (const side of [-1, 1]) {
        const lat = side * R * 0.72;
        const half = Math.sqrt(1 - 0.72 * 0.72) * R * 0.95;
        for (let j = 0; j < WISP_POINTS; j++) {
          const along = (j / (WISP_POINTS - 1) - 0.5) * 2 * half;
          pts[j * 3] = fx.p[0] + dx * along + px * lat;
          pts[j * 3 + 1] = 0.4 + 0.08 * Math.sin(t * 2 + j);
          pts[j * 3 + 2] = fx.p[2] + dz * along + pz * lat;
        }
        lines.add(pts, 0, WISP_POINTS, 0.06, tint.r, tint.g, tint.b, 0.4 * life, () => 1, 2.2);
      }
      // Dust carried along, faster where the push is stronger.
      for (let k = 0; k < DUST[tier]; k++) {
        const o = offsets[k]!;
        const along = (((t * o.speed * 1.2 + o.phase * 1.7) % 1) * 2 - 1) * R;
        const chord = Math.sqrt(Math.max(0, 1 - (along / R) ** 2));
        const lat = o.lateral * R * chord;
        const x = fx.p[0] + dx * along + px * lat;
        const z = fx.p[2] + dz * along + pz * lat;
        const a = push(x, z) * life * 0.35;
        dust.set(nd++, x, 0.15 + o.height * 0.7, z, 0.07, a, 0.92, 0.9, 0.84);
      }
    }
    lines.end();
    if (nd > 0 || shown.current > 0) {
      dust.hide(nd);
      dust.commit();
    }
    shown.current = nd;
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
