import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { EntityKind, WorldSnapshot } from '@ff/protocol';
import { useGameClient } from '../render/frame-context';

const MAX_ARROWS = 48;
const RING_SEGMENTS = 48;
const MAX_RINGS = 32;
const MAX_IMPACTS = 24;
const IMPACT_MS = 900;
/** Arrow length per m/s (an arrow shows where the body will be in ~0.25 s). */
const VEL_SCALE = 0.25;

const KIND_COLOR: Partial<Record<EntityKind, string>> = {
  core: '#ffe08a',
  boulder: '#d7c3a8',
  shard: '#ffb38a',
  lodestone: '#9fd4ff',
};

const REGION_COLOR: Record<string, string> = {
  sweep: '#8fe3ff',
  pool: '#3fa9ff',
  steam: '#e6f2ff',
  flame: '#ff7a2e',
  well: '#b28cff',
  magnet: '#7fd0ff',
};

interface Hit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
  readonly born: number;
}

/** Pre-allocated debug geometry (written in place every frame, never reallocated). */
class OverlayGeometry {
  readonly arrows: THREE.LineSegments;
  readonly rings: THREE.LineSegments;
  readonly markers: THREE.InstancedMesh;
  readonly hits: Hit[] = [];
  private readonly color = new THREE.Color();
  private readonly matrix = new THREE.Matrix4();
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    this.arrows = this.lines(MAX_ARROWS * 6, 20, 1);
    this.rings = this.lines(MAX_RINGS * RING_SEGMENTS * 2, 19, 0.9);
    const geo = new THREE.SphereGeometry(1, 12, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: '#ff3d6e',
      wireframe: true,
      transparent: true,
      depthTest: false,
      toneMapped: false,
    });
    this.markers = new THREE.InstancedMesh(geo, mat, MAX_IMPACTS);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 21;
    this.disposables.push(geo, mat);
  }

  private lines(vertices: number, order: number, opacity: number): THREE.LineSegments {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      transparent: true,
      opacity,
      toneMapped: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = order;
    this.disposables.push(geo, mat);
    return lines;
  }

  private vertex(lines: THREE.LineSegments, i: number, x: number, y: number, z: number): number {
    const pos = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = lines.geometry.getAttribute('color') as THREE.BufferAttribute;
    pos.setXYZ(i, x, y, z);
    col.setXYZ(i, this.color.r, this.color.g, this.color.b);
    return i + 1;
  }

  private commit(lines: THREE.LineSegments, count: number): void {
    lines.geometry.setDrawRange(0, count);
    lines.geometry.getAttribute('position').needsUpdate = true;
    lines.geometry.getAttribute('color').needsUpdate = true;
  }

  /** Velocity arrows of dynamic bodies: shaft plus two barbs spread on the ground plane. */
  updateArrows(snap: WorldSnapshot): void {
    const L = this.arrows;
    let v = 0;
    for (const e of snap.entities) {
      const hex = KIND_COLOR[e.kind];
      if (!hex || v >= MAX_ARROWS * 6) continue;
      const [vx, vy, vz] = e.v;
      const speed = Math.hypot(vx, vy, vz);
      if (speed < 0.05) continue;
      const [x, y, z] = e.p;
      const ex = x + vx * VEL_SCALE;
      const ey = y + vy * VEL_SCALE;
      const ez = z + vz * VEL_SCALE;
      const ux = vx / speed;
      const uy = vy / speed;
      const uz = vz / speed;
      const sl = Math.hypot(uz, ux) || 1;
      const sx = -uz / sl;
      const sz = ux / sl;
      const head = Math.min(0.6, 0.15 + speed * VEL_SCALE * 0.2);
      const bx = ex - ux * head;
      const by = ey - uy * head;
      const bz = ez - uz * head;
      this.color.set(hex);
      v = this.vertex(L, v, x, y, z);
      v = this.vertex(L, v, ex, ey, ez);
      v = this.vertex(L, v, ex, ey, ez);
      v = this.vertex(L, v, bx + sx * head * 0.5, by, bz + sz * head * 0.5);
      v = this.vertex(L, v, ex, ey, ez);
      v = this.vertex(L, v, bx - sx * head * 0.5, by, bz - sz * head * 0.5);
    }
    this.commit(L, v);
  }

  /** Outline of every active field / element region at its authoritative radius. */
  updateRings(snap: WorldSnapshot): void {
    const L = this.rings;
    let v = 0;
    for (const fx of snap.effects.slice(0, MAX_RINGS)) {
      this.color.set(REGION_COLOR[fx.kind] ?? '#ffffff');
      const y = fx.kind === 'steam' || fx.kind === 'well' ? Math.max(0.1, fx.p[1]) : 0.08;
      for (let i = 0; i < RING_SEGMENTS; i++) {
        const a0 = (i / RING_SEGMENTS) * Math.PI * 2;
        const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
        v = this.vertex(L, v, fx.p[0] + Math.cos(a0) * fx.r, y, fx.p[2] + Math.sin(a0) * fx.r);
        v = this.vertex(L, v, fx.p[0] + Math.cos(a1) * fx.r, y, fx.p[2] + Math.sin(a1) * fx.r);
      }
    }
    this.commit(L, v);
  }

  addHit(x: number, y: number, z: number, impulse: number, now: number): void {
    this.hits.push({ x, y, z, r: 0.18 + Math.min(1.4, Math.sqrt(impulse) * 0.06), born: now });
    if (this.hits.length > MAX_IMPACTS) this.hits.shift();
  }

  /** Impulse markers: wire spheres sized by √impulse, expanding as they fade. */
  updateHits(now: number): void {
    let n = 0;
    for (const h of this.hits) {
      const age = now - h.born;
      if (age >= IMPACT_MS) continue;
      const s = h.r * (1 + 0.4 * (age / IMPACT_MS));
      this.matrix.makeScale(s, s, s).setPosition(h.x, h.y, h.z);
      this.markers.setMatrixAt(n++, this.matrix);
    }
    this.markers.count = n;
    this.markers.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/**
 * Lab-only debug geometry: velocity vectors of dynamic bodies, outlines of every active field /
 * element region (true authoritative radius), and impulse markers at collision points sized by
 * impulse. Drawn from the published authoritative snapshot, never from render-side guesses.
 */
export function LabOverlays({
  vectors,
  regions,
  impacts,
}: {
  vectors: boolean;
  regions: boolean;
  impacts: boolean;
}) {
  const client = useGameClient();
  const group = useRef<THREE.Group>(null);
  const geo = useRef<OverlayGeometry | null>(null);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    const o = new OverlayGeometry();
    g.add(o.arrows, o.rings, o.markers);
    geo.current = o;
    const off = client.events.on((e) => {
      if (e.type === 'impact' && e.impulse >= 15)
        o.addHit(e.p[0], e.p[1], e.p[2], e.impulse, performance.now());
    });
    return () => {
      off();
      g.remove(o.arrows, o.rings, o.markers);
      o.dispose();
      geo.current = null;
    };
  }, [client]);

  useFrame(() => {
    const o = geo.current;
    if (!o) return;
    o.arrows.visible = vectors;
    o.rings.visible = regions;
    o.markers.visible = impacts;
    const snap = client.buffer.latest;
    if (!snap) return;
    if (vectors) o.updateArrows(snap);
    if (regions) o.updateRings(snap);
    if (impacts) o.updateHits(performance.now());
  });

  return <group ref={group} />;
}
