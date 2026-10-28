/**
 * MAGNETIZE holds (7C / D09), from the snapshot's magnet effects and the lodestones' authoritative
 * positions: flux lines bow from the force point to every lodestone in range, dashes flowing toward
 * it, brighter the closer it is; small field loops turn round the force point while the hold lasts.
 * The lodestones' own movement (the authority's physics) does all the bending.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { TEAM_COLORS } from '../art-tokens';
import { useRenderFrame } from '../frame-context';
import { RibbonBatch, ribbonMaterial } from './ribbons';

const MAX_LINKS = 8;
const STRANDS = 3;
const LINK_POINTS = 14;
const LOOPS = 4;
const LOOP_POINTS = 16;
const FLUX = new THREE.Color(0.55, 0.78, 1.0);

export function MagnetFields() {
  const frame = useRenderFrame();
  const camera = useThree((s) => s.camera);
  const parts = useMemo(() => {
    const lines = new RibbonBatch(
      MAX_LINKS * STRANDS * LINK_POINTS + 2 * LOOPS * LOOP_POINTS,
      ribbonMaterial(true),
    );
    lines.mesh.renderOrder = 4;
    return { lines, pts: new Float32Array(Math.max(LINK_POINTS, LOOP_POINTS) * 3) };
  }, []);
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.add(parts.lines.mesh);
    return () => {
      g.remove(parts.lines.mesh);
      parts.lines.dispose();
    };
  }, [parts]);
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = frame.current;
    const { lines, pts } = parts;
    (lines.material.uniforms.uTime as THREE.IUniform).value = t;
    lines.begin(camera);
    const effects = f?.latest?.effects ?? [];
    let links = 0;
    for (const m of effects) {
      if (m.kind !== 'magnet' || !f) continue;
      tint.set(TEAM_COLORS[m.owner]).lerp(FLUX, 0.7);
      const cx = m.p[0];
      const cz = m.p[2];
      // Field loops round the force point (vertical rings, turning slowly).
      for (let k = 0; k < LOOPS; k++) {
        const yaw = (k / LOOPS) * Math.PI + t * 0.6;
        const rad = 0.75 + 0.2 * Math.sin(t * 2 + k);
        for (let j = 0; j < LOOP_POINTS; j++) {
          const a = (j / (LOOP_POINTS - 1)) * Math.PI * 2;
          const h = Math.cos(a) * rad;
          pts[j * 3] = cx + Math.cos(yaw) * h;
          pts[j * 3 + 1] = 0.95 + Math.sin(a) * rad * 0.8;
          pts[j * 3 + 2] = cz + Math.sin(yaw) * h;
        }
        lines.add(pts, 0, LOOP_POINTS, 0.05, tint.r, tint.g, tint.b, 0.35, () => 1, 1.6, false);
      }
      // Flux to each lodestone in range.
      for (const lo of f.entities.values()) {
        if (lo.kind !== 'lodestone' || links >= MAX_LINKS) continue;
        const dx = lo.px - cx;
        const dz = lo.pz - cz;
        const d = Math.hypot(dx, dz);
        if (d > m.r) continue;
        links++;
        const near = 1 - d / m.r;
        const nx = -dz / (d || 1);
        const nz = dx / (d || 1);
        for (let strand = 0; strand < STRANDS; strand++) {
          const bulge = (strand - 1) * 0.9;
          for (let j = 0; j < LINK_POINTS; j++) {
            const s = j / (LINK_POINTS - 1);
            const b = Math.sin(s * Math.PI) * bulge;
            pts[j * 3] = cx + dx * s + nx * b;
            pts[j * 3 + 1] = 0.9 + (lo.py - 0.9) * s + Math.sin(s * Math.PI) * 0.6;
            pts[j * 3 + 2] = cz + dz * s + nz * b;
          }
          lines.add(
            pts,
            0,
            LINK_POINTS,
            strand === 1 ? 0.09 : 0.06,
            tint.r,
            tint.g,
            tint.b,
            0.35 + 0.55 * near,
            () => 1,
            4,
          );
        }
      }
    }
    lines.end();
  });
  return <group ref={group} />;
}
