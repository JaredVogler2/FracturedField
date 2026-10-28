/**
 * The Rift Core's trail (7C / D09): a ribbon behind the core, facing the camera, as wide and as
 * bright as the core is fast (its authoritative speed; nothing invented). A hot white line runs
 * down its middle and fades out along its length into the core's seam colour (violet, warmed by
 * heat, whitened by charge). On the high tier its edges carry a slight chromatic fringe. Steam
 * veils it (the server hides the core's path there), a goal fades it, and a teleport (the kickoff
 * reset) never draws a streak across the arena. One draw.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useGameClient, useRenderFrame } from '../frame-context';
import { useDisposable } from '../hooks';

/** Samples along the trail (the newest first). */
const N = 32;
/** A new sample once the core has moved this far (m). */
const STEP = 0.18;
/** Speed (m/s) at which the trail is fully bright. */
const FULL_SPEED = 16;

const SEAM_VIOLET = new THREE.Color('#b394ff');
const HEAT = new THREE.Color('#ff7a2a');
const ARC = new THREE.Color('#bfe6ff');

export function CoreTrail({ tier }: { tier: 'low' | 'medium' | 'high' }) {
  const frame = useRenderFrame();
  const client = useGameClient();
  const camera = useThree((s) => s.camera);
  const history = useMemo(() => Array.from({ length: N }, () => new THREE.Vector3()), []);
  const state = useRef({ count: 0, fade: 1, coreId: -1 });

  const geo = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
    // x: -1 / +1 across the ribbon; y: 0 at the core .. 1 at the tail.
    const along = new Float32Array(N * 2 * 2);
    for (let i = 0; i < N; i++) {
      along.set([-1, i / (N - 1), 1, i / (N - 1)], i * 4);
    }
    g.setAttribute('aAlong', new THREE.BufferAttribute(along, 2));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    return g;
  }, []);
  const mat = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color('#b394ff') },
          uStrength: { value: 0 },
          uFringe: { value: tier === 'high' ? 0.35 : 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec2 aAlong;
          varying vec2 vAlong;
          void main() {
            vAlong = aAlong;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uStrength;
          uniform float uFringe;
          varying vec2 vAlong;
          void main() {
            float across = abs(vAlong.x);
            float t = vAlong.y;
            // Soft cross-section, fading along the length.
            float a = (1.0 - across * across) * pow(1.0 - t, 1.6) * uStrength;
            // A hot line down the middle near the core.
            float hot = pow(1.0 - across, 4.0) * (1.0 - t);
            vec3 col = mix(uColor, vec3(1.0), hot * 0.7);
            // High tier: red leads on one edge, blue on the other (a slight chromatic fringe).
            col *= vec3(1.0 + uFringe * vAlong.x, 1.0, 1.0 - uFringe * vAlong.x);
            gl_FragColor = vec4(col * a, a);
          }`,
      }),
    [tier],
  );

  // A goal: the core collapses into the gate, its trail goes with it.
  useEffect(
    () =>
      client.events.on((e) => {
        if (e.type === 'goal') state.current.fade = Math.min(state.current.fade, 0.999);
      }),
    [client],
  );

  const color = useMemo(() => new THREE.Color(), []);
  const probe = useMemo(() => new THREE.Vector3(), []);
  const tangent = useMemo(() => new THREE.Vector3(), []);
  const view = useMemo(() => new THREE.Vector3(), []);
  const side = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const st = state.current;
    const entities = frame.current?.entities;
    let core = entities?.get(st.coreId);
    if (!core && entities) {
      for (const e of entities.values()) {
        if (e.kind !== 'core') continue;
        st.coreId = e.id;
        core = e;
        break;
      }
    }
    const u = mat.uniforms;
    if (!core) {
      u.uStrength!.value = 0;
      return;
    }
    probe.set(core.px, core.py, core.pz);
    const h = history;
    // A teleport (the kickoff reset): start over where the core is now, at full strength.
    if (st.count === 0 || h[0]!.distanceTo(probe) > 3) {
      for (const v of h) v.copy(probe);
      st.count = 1;
      st.fade = 1;
    } else if (h[0]!.distanceTo(probe) > STEP) {
      for (let i = N - 1; i > 0; i--) h[i]!.copy(h[i - 1]!);
      st.count = Math.min(N, st.count + 1);
    }
    // The head always sits on the core.
    h[0]!.copy(probe);
    if (st.fade < 1) st.fade = Math.max(0, st.fade - dt * 3);

    const speed = Math.hypot(core.vx, core.vy, core.vz);
    const width = Math.min(0.75, 0.1 + speed * 0.03);
    const heat = Math.max(0, Math.min(1, (core.temp - 40) / 120));
    color
      .copy(SEAM_VIOLET)
      .lerp(HEAT, heat)
      .lerp(ARC, core.charge * 0.7);
    (u.uColor!.value as THREE.Color).copy(color);
    // Inside steam the server veils the core: its trail fades so the path is not given away.
    u.uStrength!.value = core.veiled ? 0 : Math.min(1, speed / FULL_SPEED) * st.fade;

    const pos = geo.attributes.position!.array as Float32Array;
    for (let i = 0; i < N; i++) {
      const p = h[Math.min(i, st.count - 1)]!;
      const q = h[Math.min(i + 1, st.count - 1)]!;
      tangent.subVectors(p, q);
      if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
      view.subVectors(p, camera.position);
      // Across the ribbon: perpendicular to its direction and to the line of sight.
      side.crossVectors(tangent, view).normalize();
      if (!Number.isFinite(side.x)) side.set(0, 0, 1);
      const w = width * (1 - i / N) ** 0.8;
      const o = i * 6;
      pos[o] = p.x - side.x * w;
      pos[o + 1] = p.y - side.y * w;
      pos[o + 2] = p.z - side.z * w;
      pos[o + 3] = p.x + side.x * w;
      pos[o + 4] = p.y + side.y * w;
      pos[o + 5] = p.z + side.z * w;
    }
    geo.attributes.position!.needsUpdate = true;
  });
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={4} />;
}
