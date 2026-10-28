/**
 * Gravity wells (7C / D09) where the authority has one, sized and faded by its state:
 *
 * - A dark heart with a violet rim, the depth cue at the centre.
 * - A lensing ring: a camera-facing disc with a thin bright ring just outside the heart and faint
 *   spiral bands turning round it (an approximation; the frame is not distorted, and the camera
 *   never warps).
 * - Field arcs curving in from the floor to the heart, dashes flowing inward.
 * - Shards orbiting the heart, faster closer in, and motes spiralling down into it.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { DEFAULT_RULES } from '@ff/game-data';
import { useRenderFrame } from '../frame-context';
import { mulberry32 } from '../procedural';
import { RegionPoints, createRegionPointsMaterial, softSprite } from './points';
import { RibbonBatch, ribbonMaterial } from './ribbons';
import { createRimMaterial } from './rim-material';

type Tier = 'low' | 'medium' | 'high';

const EL = DEFAULT_RULES.elements;
const MAX_WELLS = 4;
const MOTES = 60;
const ARCS = 8;
const ARC_POINTS = 12;
const ORBITERS: Record<Tier, number> = { low: 3, medium: 5, high: 8 };
/** Radius of the lensing disc (m). */
const LENS_R = 2.6;
const HEART_R = 0.55;

function lensMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      // centre (world), strength 0..1
      attribute vec4 iLens;
      varying vec2 vC;
      varying float vLife;
      void main() {
        vC = position.xy;
        vLife = iLens.w;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 w = iLens.xyz + (right * position.x + up * position.y) * ${LENS_R.toFixed(2)};
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vC;
      varying float vLife;
      void main() {
        float r = length(vC);
        if (r > 1.0) discard;
        float edge = ${(HEART_R / LENS_R).toFixed(3)};
        // The bright ring just outside the heart, and a fainter second image further out.
        float ring = exp(-pow((r - edge * 1.18) / 0.022, 2.0));
        float ring2 = exp(-pow((r - edge * 1.6) / 0.05, 2.0)) * 0.3;
        // Spiral bands turning round it, fading outward.
        float ang = atan(vC.y, vC.x);
        float spiral = 0.5 + 0.5 * sin(ang * 2.0 + log(max(r, 0.02)) * 7.0 - uTime * 2.6);
        float bands = pow(spiral, 3.0) * smoothstep(1.0, edge * 1.3, r) * smoothstep(edge, edge * 1.4, r);
        vec3 col = vec3(0.95, 0.9, 1.0) * ring * 1.8 + vec3(0.62, 0.42, 1.0) * (ring2 + bands * 0.35);
        float a = clamp(ring + ring2 + bands * 0.4, 0.0, 1.0) * vLife;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

export function GravityWells({ tier = 'high' }: { tier?: Tier }) {
  const frame = useRenderFrame();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const parts = useMemo(() => {
    const sprite = softSprite();
    const motes = new RegionPoints(MAX_WELLS * MOTES, createRegionPointsMaterial(true, sprite));
    motes.points.renderOrder = 5;
    const heartGeo = new THREE.SphereGeometry(HEART_R, 24, 16);
    const heartMat = new THREE.MeshBasicMaterial({ color: '#050208' });
    const rim = createRimMaterial('#b48cff');
    const hearts = Array.from({ length: MAX_WELLS }, () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(heartGeo, heartMat), new THREE.Mesh(heartGeo, rim));
      g.visible = false;
      return g;
    });
    // Lensing discs: one instanced quad per well.
    const quad = new THREE.PlaneGeometry(2, 2);
    const lensGeo = new THREE.InstancedBufferGeometry();
    lensGeo.index = quad.index;
    lensGeo.setAttribute('position', quad.getAttribute('position'));
    const iLens = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WELLS * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    lensGeo.setAttribute('iLens', iLens);
    lensGeo.instanceCount = 0;
    const lensMat = lensMaterial();
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.frustumCulled = false;
    lens.renderOrder = 5;
    const arcs = new RibbonBatch(MAX_WELLS * ARCS * ARC_POINTS, ribbonMaterial(true));
    arcs.mesh.renderOrder = 4;
    // Orbiting shards: opaque, flat-shaded stone (the event shards' program).
    const shardGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const shardMat = new THREE.MeshStandardMaterial({
      color: '#3a3446',
      roughness: 0.6,
      flatShading: true,
      emissive: '#2a1648',
      emissiveIntensity: 0.6,
    });
    const shards = new THREE.InstancedMesh(shardGeo, shardMat, MAX_WELLS * ORBITERS.high);
    shards.count = 0;
    shards.frustumCulled = false;
    return {
      sprite,
      motes,
      hearts,
      lens,
      lensGeo,
      iLens,
      lensMat,
      arcs,
      shards,
      pts: new Float32Array(ARC_POINTS * 3),
      dispose: () => {
        [heartGeo, heartMat, rim, quad, lensGeo, lensMat, shardGeo, shardMat, sprite].forEach((d) =>
          d.dispose(),
        );
        motes.dispose();
        arcs.dispose();
      },
    };
  }, []);
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.add(parts.motes.points, parts.lens, parts.arcs.mesh, parts.shards, ...parts.hearts);
    return () => {
      g.remove(parts.motes.points, parts.lens, parts.arcs.mesh, parts.shards, ...parts.hearts);
      parts.dispose();
    };
  }, [parts]);

  const seeds = useMemo(() => {
    const rnd = mulberry32(37);
    return Array.from({ length: MOTES }, () => ({
      a: rnd() * Math.PI * 2,
      r: Math.sqrt(rnd()),
      phase: rnd(),
      speed: 0.6 + rnd() * 0.8,
      size: 0.7 + rnd() * 0.6,
      tilt: (rnd() - 0.5) * 1.2,
    }));
  }, []);
  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      p: new THREE.Vector3(),
      s: new THREE.Vector3(),
      e: new THREE.Euler(),
    }),
    [],
  );
  const shown = useRef(0);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const effects = frame.current?.latest?.effects ?? [];
    parts.motes.mat.uniforms.uScale!.value =
      (size.height * camera.projectionMatrix.elements[5]) / 2;
    parts.lensMat.uniforms.uTime!.value = t;
    (parts.arcs.material.uniforms.uTime as THREE.IUniform).value = t;
    parts.arcs.begin(camera);
    let w = 0;
    let n = 0;
    let ns = 0;
    const y0 = EL.gravity.height;
    for (const fx of effects) {
      if (fx.kind !== 'well' || w >= MAX_WELLS) continue;
      const life = Math.max(0, Math.min(1, fx.ttl / 8, (fx.maxTtl - fx.ttl + 1) / 6));
      const heart = parts.hearts[w]!;
      heart.visible = true;
      heart.position.set(fx.p[0], y0, fx.p[2]);
      heart.scale.setScalar(0.6 + 0.4 * life);
      parts.iLens.setXYZW(w, fx.p[0], y0, fx.p[2], life);
      // Field arcs: from the floor round the well, curving in to the heart.
      const reach = Math.min(fx.r * 0.6, 4.2);
      for (let k = 0; k < ARCS; k++) {
        const a0 = (k / ARCS) * Math.PI * 2 + t * 0.15;
        for (let j = 0; j < ARC_POINTS; j++) {
          const s = j / (ARC_POINTS - 1);
          // In along a spiral (the angle advances as it closes), rising to the heart.
          const rr = reach * (1 - s) + HEART_R * 1.1 * s;
          const ang = a0 + s * 1.1;
          pts(
            parts.pts,
            j,
            fx.p[0] + Math.cos(ang) * rr,
            0.08 + (y0 - 0.08) * Math.sin(s * Math.PI * 0.5),
            fx.p[2] + Math.sin(ang) * rr,
          );
        }
        parts.arcs.add(
          parts.pts,
          0,
          ARC_POINTS,
          0.07,
          0.72,
          0.56,
          1.0,
          0.55 * life,
          (j) => 0.3 + 0.7 * (j / (ARC_POINTS - 1)),
          3.2,
        );
      }
      // Shards on tilted orbits, faster closer in.
      for (let k = 0; k < ORBITERS[tier]; k++) {
        const sd = seeds[k]!;
        const rr = 1.0 + sd.r * 1.3;
        const ang = sd.a + t * (2.2 / Math.pow(rr, 1.5));
        tmp.p.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr);
        tmp.p.applyAxisAngle(AXIS_X, sd.tilt);
        tmp.p.add(heart.position);
        tmp.e.set(t * sd.speed * 2, t * sd.speed, sd.a);
        tmp.q.setFromEuler(tmp.e);
        tmp.s.setScalar(sd.size * life);
        parts.shards.setMatrixAt(ns++, tmp.m.compose(tmp.p, tmp.q, tmp.s));
      }
      // Motes spiralling in: their paths bend round the heart as they fall.
      for (let k = 0; k < MOTES; k++) {
        const sd = seeds[k]!;
        const l = (t * 0.9 * sd.speed + sd.phase) % 1;
        const rr = (1 - l) * fx.r * 0.75 * sd.r + 0.3;
        const ang = sd.a + l * 5.5;
        const x = fx.p[0] + Math.cos(ang) * rr;
        const z = fx.p[2] + Math.sin(ang) * rr;
        const y = y0 + (sd.phase - 0.5) * 0.8 * (1 - l);
        parts.motes.set(n++, x, y, z, 0.3 * sd.size, life * 0.7 * l, 0.7, 0.5, 1.0);
      }
      w++;
    }
    for (let k = w; k < MAX_WELLS; k++) parts.hearts[k]!.visible = false;
    parts.lensGeo.instanceCount = w;
    if (w > 0) parts.iLens.needsUpdate = true;
    parts.shards.count = ns;
    if (ns > 0) parts.shards.instanceMatrix.needsUpdate = true;
    parts.arcs.end();
    if (n > 0 || shown.current > 0) {
      parts.motes.hide(n);
      parts.motes.commit();
    }
    shown.current = n;
  });
  return <group ref={group} />;
}

const AXIS_X = new THREE.Vector3(1, 0, 0);

function pts(out: Float32Array, j: number, x: number, y: number, z: number) {
  out[j * 3] = x;
  out[j * 3 + 1] = y;
  out[j * 3 + 2] = z;
}
