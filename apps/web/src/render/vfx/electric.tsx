/**
 * Charge arcs (7C / D09) along the authority's conduction path: every CHARGE event lists the
 * conductors it reached and the links between them, and each link becomes a branching arc between
 * those exact points, seeded from the event so both devices draw the same lightning. Arcs restrike
 * two or three times within a third of a second and fade; each conductor reached flares and throws
 * a few short sparks. Nothing lights the whole screen (reduced flashes halves the restrikes).
 *
 * Each arc is a camera-facing ribbon: a thin white-blue core inside a soft violet glow, all arcs in
 * one draw call, the sparks and flares in a second.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { GameEvent } from '@ff/protocol';
import { useGameClient } from '../frame-context';
import { useSettings } from '../../game/settings';
import { mulberry32 } from '../procedural';
import { BOLT_POINTS, boltPaths, newBoltPaths, type BoltPaths } from './bolt-path';
import { RegionPoints, createRegionPointsMaterial, softSprite } from './points';

const MAX_ARCS = 16;
/** Seconds an arc lives, and how often it restrikes (a new path from the same event seed). */
const ARC_S = 0.35;
const RESTRIKE_S = 0.07;
/** Ribbon width (m): the glow; the core is its middle fifth. */
const WIDTH = 0.75;
const MAX_VERTS = MAX_ARCS * BOLT_POINTS * 2;
const MAX_INDEX = MAX_ARCS * BOLT_POINTS * 6;
const MAX_SPARKS = 96;
const SPARKS_PER_NODE = 6;

interface Arc {
  from: [number, number, number];
  to: [number, number, number];
  /** Charge delivered at the far end (0..1): brighter arcs carry more. */
  q: number;
  seed: number;
  age: number;
  /** The restrike its paths were built for (-1: none yet). */
  strike: number;
  paths: BoltPaths;
}

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  /** A flare stays put and is bigger. */
  flare: boolean;
}

function arcMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aSide;
      attribute float aI;
      varying float vSide;
      varying float vI;
      void main() {
        vSide = aSide;
        vI = aI;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vSide;
      varying float vI;
      void main() {
        float d = abs(vSide);
        float core = smoothstep(0.2, 0.04, d);
        float glow = exp(-d * 4.5) * (1.0 - d);
        // Whiter, brighter and more violet than the water's own surface crackle: the discharge is
        // the event, the crackle only the state it leaves.
        vec3 col = vec3(0.92, 0.94, 1.0) * core * 5.0 + vec3(0.5, 0.36, 1.0) * glow * 1.8;
        float a = (core + glow * 0.8) * vI;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

/** Branching arcs along each CHARGE event's conduction links, with flares and sparks. */
export function ChargeArcs() {
  const client = useGameClient();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const reducedFlashes = useSettings((s) => s.reducedFlashes);
  const parts = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const dyn = THREE.DynamicDrawUsage;
    const pos = new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3).setUsage(dyn);
    const side = new THREE.BufferAttribute(new Float32Array(MAX_VERTS), 1).setUsage(dyn);
    const inten = new THREE.BufferAttribute(new Float32Array(MAX_VERTS), 1).setUsage(dyn);
    const index = new THREE.BufferAttribute(new Uint16Array(MAX_INDEX), 1).setUsage(dyn);
    g.setAttribute('position', pos);
    g.setAttribute('aSide', side);
    g.setAttribute('aI', inten);
    g.setIndex(index);
    g.setDrawRange(0, 0);
    const mat = arcMaterial();
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    const sprite = softSprite();
    const sparks = new RegionPoints(MAX_SPARKS, createRegionPointsMaterial(true, sprite));
    sparks.points.renderOrder = 6;
    return { g, pos, side, inten, index, mat, mesh, sprite, sparks };
  }, []);
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const grp = group.current;
    if (!grp) return;
    grp.add(parts.mesh, parts.sparks.points);
    return () => {
      grp.remove(parts.mesh, parts.sparks.points);
      parts.g.dispose();
      parts.mat.dispose();
      parts.sparks.dispose();
      parts.sprite.dispose();
    };
  }, [parts]);

  const arcs = useRef<Arc[]>([]);
  const sparks = useRef<Spark[]>([]);
  useEffect(
    () =>
      client.events.on((e: GameEvent) => {
        if (e.type !== 'charge') return;
        const node = (i: number): [number, number, number] => {
          const p = i < 0 ? e.p : (e.nodes[i] ?? e.p);
          return [p[0], p[1], p[2]];
        };
        // Seeded from the event, so every device draws the same arcs.
        const rnd = mulberry32((e.tick * 7919) ^ (e.id * 104729) ^ 0x5bd1e995);
        e.links.forEach(([from, to], k) => {
          if (arcs.current.length >= MAX_ARCS) arcs.current.shift();
          arcs.current.push({
            from: node(from),
            to: node(to),
            q: e.q[to] ?? 1,
            seed: (Math.floor(rnd() * 0x7fffffff) + k * 2654435761) >>> 0,
            age: 0,
            strike: -1,
            paths: newBoltPaths(),
          });
        });
        // Each conductor reached flares and throws short sparks.
        e.nodes.forEach((p, i) => {
          const q = e.q[i] ?? 1;
          const add = (s: Spark) => {
            if (sparks.current.length >= MAX_SPARKS) sparks.current.shift();
            sparks.current.push(s);
          };
          add({ x: p[0], y: p[1], z: p[2], vx: 0, vy: 0, vz: 0, age: 0, life: 0.32, flare: true });
          for (let s = 0; s < Math.round(SPARKS_PER_NODE * (0.5 + q * 0.5)); s++) {
            const a = rnd() * Math.PI * 2;
            const v = 3 + rnd() * 5;
            add({
              x: p[0],
              y: p[1],
              z: p[2],
              vx: Math.cos(a) * v,
              vy: 1 + rnd() * 4,
              vz: Math.sin(a) * v,
              age: 0,
              life: 0.18 + rnd() * 0.2,
              flare: false,
            });
          }
        });
      }),
    [client],
  );

  const tmp = useMemo(
    () => ({ cam: new THREE.Vector3(), t: new THREE.Vector3(), s: new THREE.Vector3() }),
    [],
  );
  useFrame((_, rawDt) => {
    // Capped so an arc is seen on a slow page too (it lives ARC_S of frame time, at most 0.05/frame).
    const dt = Math.min(rawDt, 0.05);
    const list = arcs.current;
    for (let i = list.length - 1; i >= 0; i--) {
      list[i]!.age += dt;
      if (list[i]!.age >= ARC_S) list.splice(i, 1);
    }
    const pos = parts.pos.array as Float32Array;
    const side = parts.side.array as Float32Array;
    const inten = parts.inten.array as Float32Array;
    const index = parts.index.array as Uint16Array;
    const cam = tmp.cam.copy(camera.position);
    let v = 0;
    let ix = 0;
    for (const arc of list) {
      const strike = Math.floor(arc.age / RESTRIKE_S);
      if (strike !== arc.strike) {
        boltPaths(arc.from, arc.to, arc.seed + strike * 7, arc.paths);
        arc.strike = strike;
      }
      // Bright at each restrike, dimming between them, the whole arc fading out.
      const within = (arc.age % RESTRIKE_S) / RESTRIKE_S;
      const flicker = reducedFlashes ? 0.75 + 0.25 * (1 - within) : 0.45 + 0.55 * (1 - within);
      const env = (1 - arc.age / ARC_S) * flicker * (0.45 + 0.55 * arc.q);
      const pts = arc.paths.points;
      arc.paths.paths.forEach(([start, count], p) => {
        const w = (p === 0 ? WIDTH : WIDTH * 0.6) * 0.5;
        const bright = env * arc.paths.weight[p]!;
        const first = v;
        for (let i = 0; i < count; i++) {
          const k = (start + i) * 3;
          const a = Math.max(0, i - 1);
          const b = Math.min(count - 1, i + 1);
          // Across the ribbon: perpendicular to the path and to the line of sight.
          tmp.t.set(
            pts[(start + b) * 3]! - pts[(start + a) * 3]!,
            pts[(start + b) * 3 + 1]! - pts[(start + a) * 3 + 1]!,
            pts[(start + b) * 3 + 2]! - pts[(start + a) * 3 + 2]!,
          );
          tmp.s.set(pts[k]! - cam.x, pts[k + 1]! - cam.y, pts[k + 2]! - cam.z);
          tmp.s.cross(tmp.t).normalize().multiplyScalar(w);
          // Forks taper to nothing; the main arc keeps its width.
          const taper = p === 0 ? 1 : 1 - i / count;
          for (let sgn = -1; sgn <= 1; sgn += 2) {
            pos[v * 3] = pts[k]! + tmp.s.x * sgn * taper;
            pos[v * 3 + 1] = pts[k + 1]! + tmp.s.y * sgn * taper;
            pos[v * 3 + 2] = pts[k + 2]! + tmp.s.z * sgn * taper;
            side[v] = sgn;
            inten[v] = bright;
            v++;
          }
        }
        for (let i = 0; i < count - 1; i++) {
          const a0 = first + i * 2;
          index[ix++] = a0;
          index[ix++] = a0 + 1;
          index[ix++] = a0 + 2;
          index[ix++] = a0 + 1;
          index[ix++] = a0 + 3;
          index[ix++] = a0 + 2;
        }
      });
    }
    parts.g.setDrawRange(0, ix);
    if (ix > 0) {
      parts.pos.needsUpdate = true;
      parts.side.needsUpdate = true;
      parts.inten.needsUpdate = true;
      parts.index.needsUpdate = true;
    }

    // Sparks fly and fall; flares swell and fade where the charge landed.
    const sp = sparks.current;
    parts.sparks.mat.uniforms.uScale!.value =
      (size.height * camera.projectionMatrix.elements[5]) / 2;
    let n = 0;
    for (let i = sp.length - 1; i >= 0; i--) {
      const s = sp[i]!;
      s.age += dt;
      if (s.age >= s.life) {
        sp.splice(i, 1);
        continue;
      }
      const k = s.age / s.life;
      if (s.flare) {
        parts.sparks.set(n++, s.x, s.y + 0.15, s.z, 1.5 + 1.0 * k, (1 - k) * 0.9, 0.62, 0.6, 1.0);
      } else {
        s.vy -= 12 * dt;
        s.x += s.vx * dt;
        s.y = Math.max(0.05, s.y + s.vy * dt);
        s.z += s.vz * dt;
        parts.sparks.set(n++, s.x, s.y, s.z, 0.12, (1 - k) * 0.95, 0.8, 0.9, 1.0);
      }
    }
    if (n > 0 || parts.sparks.points.userData.shown) {
      parts.sparks.hide(n);
      parts.sparks.commit();
    }
    parts.sparks.points.userData.shown = n > 0;
  });
  return <group ref={group} />;
}
