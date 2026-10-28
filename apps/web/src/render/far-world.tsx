/**
 * The far world (Phase 07B, environmental storytelling): sky islands out in the storm, carrying
 * the towers of the people who built the Meridian — warm windows lit against the haze — and
 * waterfalls pouring off their edges into the cloud sea. Placed toward the storm break, where the
 * menu's camera and the hero shots look, so the towers stand dark against the bright sky.
 *
 * Three draw calls on every tier (islands, towers, falls: each merged into one geometry). The
 * towers and falls use their own small shaders with the shared aerial-perspective fog; lit
 * windows fog at half rate, so they read as lights through the haze rather than vanishing with
 * the stone around them.
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useFrame } from '@react-three/fiber';
import { FAR_WORLD, LIGHTING } from './art-tokens';
import { rock, type Lod } from './arena/geometry';
import { NOISE_GLSL } from './shaders';
import { SUN_DIR } from './atmosphere';
import { useSettings } from '../game/settings';

/** A tower: a stepped octagonal shaft in three tiers under a tall spire (lathe, unit scale). */
const TOWER_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.0, 0],
  [1.0, 0.06],
  [0.86, 0.09],
  [0.82, 0.44],
  [0.96, 0.46],
  [0.96, 0.49],
  [0.7, 0.51],
  [0.66, 0.77],
  [0.79, 0.79],
  [0.79, 0.81],
  [0.5, 0.83],
  [0.46, 1.0],
  [0.56, 1.02],
  [0.0, 1.38],
];

function tower(radius: number, height: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    TOWER_PROFILE.map(([r, y]) => new THREE.Vector2(r * radius, y * height)),
    8,
  ).toNonIndexed();
  g.computeVertexNormals();
  const n = g.attributes.position!.count;
  // Per-vertex seed (the window pattern differs per tower) and the tower's base (placed with the
  // tower, so the shader can measure windows around the tower's own axis after the merge).
  g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n).fill(seed), 1));
  g.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.deleteAttribute('uv');
  return g;
}

/** A floating island: a rock with a flat, buildable top and a long inverted root. */
function island(seed: number, width: number, depth: number, lod: Lod): THREE.BufferGeometry {
  const g = rock(seed, lod === 'high' ? 3 : 2, 4);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setXYZ(i, p.getX(i) * width, y > 0.3 ? 0 : (y - 0.3) * depth, p.getZ(i) * width);
  }
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return g;
}

/** A waterfall ribbon from (0, 0, 0) downward, its lip curling out over the edge. */
function fall(width: number, height: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height, 1, 24);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const v = (p.getY(i) + height / 2) / height; // 0 bottom … 1 top
    const drop = 1 - v;
    // The lip: water leaves the edge with some speed, then falls straight.
    p.setXYZ(i, p.getX(i), -drop * height, Math.min(drop * height, 6) * 0.55);
  }
  g.computeVertexNormals();
  return g;
}

function createTowerMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 },
      uSun: { value: SUN_DIR.clone() },
      uKey: { value: new THREE.Color(LIGHTING.keyColor) },
      uStone: { value: new THREE.Color(FAR_WORLD.stone) },
      uWindow: { value: new THREE.Color(FAR_WORLD.windowColor) },
      uLit: { value: FAR_WORLD.litShare },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute vec3 aBase;
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying float vSeed;
      #include <fog_pars_vertex>
      void main() {
        vLocal = position - aBase;
        vSeed = aSeed;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSun;
      uniform vec3 uKey;
      uniform vec3 uStone;
      uniform vec3 uWindow;
      uniform float uLit;
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying float vSeed;
      #include <fog_pars_fragment>
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 n = normalize(vNormalW);
        // Far stone: lit by the key, a cool sky from above.
        float sun = max(dot(n, uSun), 0.0);
        vec3 col = uStone * (uKey * sun * 1.8 + vec3(0.18, 0.24, 0.32) * (0.6 + 0.4 * n.y));
        // Windows on the shafts' walls: 24 columns around, a row every 2.6 m.
        float ang = atan(vLocal.z, vLocal.x) / 6.28318 + 0.5;
        float cols = ang * 24.0;
        float rows = vLocal.y / 2.6;
        vec2 cell = vec2(floor(cols), floor(rows));
        vec2 f = vec2(fract(cols), fract(rows));
        float pane = step(0.32, f.x) * step(f.x, 0.68) * step(0.3, f.y) * step(f.y, 0.78);
        float wall = 1.0 - smoothstep(0.25, 0.45, abs(n.y));
        float h = hash(vec3(cell, vSeed));
        float lit = step(h, uLit) * pane * wall;
        // A few windows dim and brighten slowly: people moving inside.
        float life = 0.8 + 0.2 * sin(uTime * (0.3 + h) + h * 40.0);
        vec3 light = uWindow * lit * (0.7 + 0.6 * fract(h * 7.0)) * life;
        col *= 1.0 - 0.6 * pane * wall * (1.0 - lit);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
        #ifdef USE_FOG
          // Lights fog at half rate: they read through the haze.
          gl_FragColor.rgb += light * (1.0 - 0.5 * fogFactor);
        #else
          gl_FragColor.rgb += light;
        #endif
      }
    `,
  });
}

function createIslandMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    vertexColors: true,
    uniforms: {
      ...THREE.UniformsLib.fog,
      uSun: { value: SUN_DIR.clone() },
      uKey: { value: new THREE.Color(LIGHTING.keyColor) },
      uStone: { value: new THREE.Color(FAR_WORLD.stone) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vTint;
      #include <fog_pars_vertex>
      void main() {
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vTint = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform vec3 uKey;
      uniform vec3 uStone;
      varying vec3 vNormalW;
      varying vec3 vTint;
      #include <fog_pars_fragment>
      void main() {
        vec3 n = normalize(vNormalW);
        float sun = max(dot(n, uSun), 0.0);
        vec3 col = uStone * vTint * (uKey * sun * 1.8 + vec3(0.18, 0.24, 0.32) * (0.6 + 0.4 * n.y));
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  });
}

function createFallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 },
      uKey: { value: new THREE.Color(LIGHTING.keyColor) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uKey;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        // Streaks racing down, breaking into spray as they fall.
        float fallen = 1.0 - vUv.y;
        float streak = fbm3(vec3(vUv.x * 9.0, vUv.y * 2.2 + uTime * 1.3, uTime * 0.2));
        float sheet = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float a = sheet * smoothstep(0.35, 0.75, streak) * (1.0 - smoothstep(0.55, 1.0, fallen));
        a = max(a, sheet * 0.18 * (1.0 - fallen));
        vec3 col = mix(vec3(0.42, 0.52, 0.6), vec3(0.85, 0.9, 0.95) + uKey * 0.15, streak);
        gl_FragColor = vec4(col, a * 0.85);
        #include <fog_fragment>
      }
    `,
  });
}

export function FarWorld({ lod }: { lod: Lod }) {
  const reducedMotion = useSettings((s) => s.reducedMotion);
  const built = useMemo(() => {
    const islands: THREE.BufferGeometry[] = [];
    const towers: THREE.BufferGeometry[] = [];
    const falls: THREE.BufferGeometry[] = [];
    FAR_WORLD.islands.forEach((it, i) => {
      const place = (g: THREE.BufferGeometry, dx = 0, dy = 0, dz = 0, yaw = 0) =>
        g.applyMatrix4(
          new THREE.Matrix4().compose(
            new THREE.Vector3(it.x + dx, it.y + dy, it.z + dz),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
            new THREE.Vector3(1, 1, 1),
          ),
        );
      islands.push(place(island(it.seed, it.width, it.depth, lod)));
      it.towers.forEach(([dx, dz, r, h], k) => {
        const t = place(tower(r, h, i * 10 + k), dx, 0, dz);
        const base = t.attributes.aBase as THREE.BufferAttribute;
        for (let v = 0; v < base.count; v++) base.setXYZ(v, it.x + dx, it.y, it.z + dz);
        towers.push(t);
      });
      if (it.fall) {
        const [ax, az, w, h] = it.fall;
        // At the lip, facing out from the island's centre.
        falls.push(place(fall(w, h), ax, 0.2, az, Math.atan2(ax, az)));
      }
    });
    return {
      islands: mergeGeometries(islands),
      towers: mergeGeometries(towers),
      falls: falls.length ? mergeGeometries(falls) : null,
      parts: [...islands, ...towers, ...falls],
    };
  }, [lod]);
  const mats = useMemo(
    () => ({
      islands: createIslandMaterial(),
      towers: createTowerMaterial(),
      falls: createFallMaterial(),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const g of built.parts) g.dispose();
      built.islands.dispose();
      built.towers.dispose();
      built.falls?.dispose();
    },
    [built],
  );
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
  );
  useFrame((_, dt) => {
    const step = reducedMotion ? 0 : dt;
    mats.towers.uniforms.uTime!.value += step;
    mats.falls.uniforms.uTime!.value += step;
  });
  return (
    <group>
      <mesh geometry={built.islands} material={mats.islands} renderOrder={2} />
      <mesh geometry={built.towers} material={mats.towers} renderOrder={2} />
      {built.falls && <mesh geometry={built.falls} material={mats.falls} renderOrder={5} />}
    </group>
  );
}
