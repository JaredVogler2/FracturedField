/**
 * The two wielders on their plinths (7D / D10): original masked characters whose moves come only
 * from authoritative state (`wielder-anim.ts`), posed each frame by IK on a skinned skeleton
 * (`wielder-ik.ts`, `wielder-body.ts`). They decide nothing and collide with nothing; the casting
 * never waits for them.
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { MERIDIAN_ARENA } from '@ff/game-data';
import type { HandState, PlayerSlot } from '@ff/protocol';
import { useGameClient, useRenderFrame } from '../frame-context';
import { TEAM_COLORS } from '../art-tokens';
import { localHand } from '../vfx/local-aim';
import {
  BONES,
  buildBody,
  buildSkeleton,
  REST_ARM_ANGLE,
  WIELDER_LOOKS,
  type BoneName,
} from './wielder-body';
import {
  WielderAnimator,
  type Placement,
  type WielderPose,
  type WielderState,
} from './wielder-anim';
import { aimBone, newSolution, solveTwoBone } from './wielder-ik';
import { RIG } from './wielder-rig';
import { layTether, TETHER_MIN_PX, TETHER_SEGMENTS } from './wielder-tether';
import { layFlare, layMotes, moteCorner, MOTES } from './wielder-motes';
import { buildSpectralHand, placeSpectralHand } from './spectral-hand';
import { wielderMaterial } from './wielder-material';

/** How much larger than life the wielders stand (they are read from across the arena). */
export const WIELDER_SCALE = 1.5;
/** The plinths' top, and how far each wielder turns from the field's axis toward its centre. */
const PLINTH_TOP = 1.72;
const TURN_TO_CENTRE = 0.7;
/** Distance from the field's centre line to each goal mouth (world x). */
const GOAL_X = MERIDIAN_ARENA.halfLength;

export function placementFor(slot: PlayerSlot): Placement {
  const x = (slot === 0 ? -1 : 1) * 11.5;
  const z = -(MERIDIAN_ARENA.halfWidth + 2.4);
  return { x, y: PLINTH_TOP, z, yaw: Math.atan2(-x, -z) * TURN_TO_CENTRE, scale: WIELDER_SCALE };
}

const energyVertex = /* glsl */ `
  attribute float aAlong;
  attribute float aSide;
  attribute float aWho;
  attribute float aKind;
  attribute float aGlow;
  attribute float aPx;
  varying float vAlong;
  varying float vSide;
  varying float vWho;
  varying float vKind;
  varying float vGlow;
  varying float vPx;
  void main() {
    vAlong = aAlong;
    vSide = aSide;
    vWho = aWho;
    vKind = aKind;
    vGlow = aGlow;
    vPx = aPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const energyFragment = /* glsl */ `
  uniform vec3 uColor0;
  uniform vec3 uColor1;
  uniform vec2 uStrength;
  uniform float uTime;
  varying float vAlong;
  varying float vSide;
  varying float vWho;
  varying float vKind;
  varying float vGlow;
  varying float vPx;
  void main() {
    vec3 col = vWho < 0.5 ? uColor0 : uColor1;
    if (vKind > 0.5) {
      // A mote: a soft spark, white-hot at its heart.
      float r = length(vec2(vAlong, vSide));
      float a = 1.0 - smoothstep(0.0, 1.0, r);
      a *= a * vGlow;
      gl_FragColor = vec4(col * a * 2.0 + vec3(a * a * 0.6), a);
      return;
    }
    float s = vWho < 0.5 ? uStrength.x : uStrength.y;
    // Laid wider than it is (a few pixels across, on a phone), the arm is flatter across and its
    // light spread over the extra width, though never below 0.6 of it: it reads as a thin line.
    float drawn = max(vPx, ${TETHER_MIN_PX.toFixed(1)});
    float sharp = smoothstep(2.0, 6.0, drawn);
    float core = mix(0.85, pow(1.0 - abs(vSide), 1.6), sharp);
    float cover = max(0.6, vPx / drawn);
    float ends = smoothstep(0.0, 0.08, vAlong) * (1.0 - smoothstep(0.88, 1.0, vAlong));
    // Pulses flowing from the hand out to the field; shallow on a thin arm, which they would
    // otherwise break into dashes.
    float depth = mix(0.12, 0.45, sharp);
    float flow = 1.0 - depth + depth * sin(vAlong * 34.0 - uTime * 9.0);
    float a = s * core * cover * ends * flow;
    gl_FragColor = vec4(col * a, a);
  }
`;
const TETHER_VERTS = (TETHER_SEGMENTS + 1) * 2;
/** Where the motes start in the energy mesh, and how many vertices each wielder's take. */
const MOTE_BASE = TETHER_VERTS * 2;
const MOTE_VERTS = MOTES * 4;
/** Then each wielder's flare at its acting gauntlet: one quad. */
const FLARE_BASE = MOTE_BASE + MOTE_VERTS * 2;

/**
 * Both wielders' spectral arms, energy motes and gauntlet flares in one mesh: one draw call. The
 * arms are ribbons (`aKind` 0); the motes and flares camera-facing quads (`aKind` 1) whose
 * brightness is per vertex.
 */
function makeEnergy(): {
  mesh: THREE.Mesh;
  pos: Float32Array;
  glow: Float32Array;
  px: Float32Array;
  strength: THREE.Vector2;
  time: { value: number };
  dispose: () => void;
} {
  const geometry = new THREE.BufferGeometry();
  const count = FLARE_BASE + 4 * 2;
  const pos = new Float32Array(count * 3);
  const along = new Float32Array(count);
  const side = new Float32Array(count);
  const who = new Float32Array(count);
  const kind = new Float32Array(count);
  const glow = new Float32Array(count);
  // Each arm vertex's true width on screen (render pixels); wide until the first frame lays it.
  const px = new Float32Array(count).fill(64);
  const index: number[] = [];
  for (let w = 0; w < 2; w++) {
    for (let i = 0; i <= TETHER_SEGMENTS; i++) {
      for (let k = 0; k < 2; k++) {
        const v = w * TETHER_VERTS + i * 2 + k;
        along[v] = i / TETHER_SEGMENTS;
        side[v] = k === 0 ? -1 : 1;
        who[v] = w;
      }
      if (i < TETHER_SEGMENTS) {
        const a = w * TETHER_VERTS + i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    for (let m = 0; m <= MOTES; m++) {
      // The last quad is the wielder's flare.
      const a = m < MOTES ? MOTE_BASE + w * MOTE_VERTS + m * 4 : FLARE_BASE + w * 4;
      for (let c = 0; c < 4; c++) {
        [along[a + c], side[a + c]] = moteCorner(c);
        who[a + c] = w;
        kind[a + c] = 1;
      }
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geometry.setAttribute('aWho', new THREE.BufferAttribute(who, 1));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  geometry.setAttribute(
    'aGlow',
    new THREE.BufferAttribute(glow, 1).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute('aPx', new THREE.BufferAttribute(px, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(index);
  const strength = new THREE.Vector2();
  const time = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor0: { value: new THREE.Color(TEAM_COLORS[0]) },
      uColor1: { value: new THREE.Color(TEAM_COLORS[1]) },
      uStrength: { value: strength },
      uTime: time,
    },
    vertexShader: energyVertex,
    fragmentShader: energyFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  return {
    mesh,
    pos,
    glow,
    px,
    strength,
    time,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

const handVertex = /* glsl */ `
  attribute vec3 aFist;
  attribute vec3 aFistNormal;
  attribute float aHand;
  uniform mat4 uHand[2];
  uniform vec2 uCurl;
  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying float vWho;
  void main() {
    bool second = aHand > 0.5;
    float c = second ? uCurl.y : uCurl.x;
    mat4 m = second ? uHand[1] : uHand[0];
    vec3 p = mix(position, aFist, c);
    vec3 n = mix(normal, aFistNormal, c);
    vec4 mv = viewMatrix * (m * vec4(p, 1.0));
    vNormalV = mat3(viewMatrix) * (mat3(m) * n);
    vViewV = -mv.xyz;
    vWho = aHand;
    gl_Position = projectionMatrix * mv;
  }
`;
const handFragment = /* glsl */ `
  uniform vec3 uColor0;
  uniform vec3 uColor1;
  uniform vec2 uStrength;
  uniform vec2 uSmall;
  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying float vWho;
  void main() {
    float s = vWho < 0.5 ? uStrength.x : uStrength.y;
    vec3 col = vWho < 0.5 ? uColor0 : uColor1;
    // Spectral: a faint body with a bright outline where the surface turns away. Small on screen
    // (a phone), the body fills in: an outline a pixel wide breaks up and the hand's shape is lost.
    float small = vWho < 0.5 ? uSmall.x : uSmall.y;
    float fill = mix(0.22, 0.62, small);
    float edge = 1.0 - abs(dot(normalize(vNormalV), normalize(vViewV)));
    float a = s * (fill + (1.0 - fill) * pow(edge, 1.8));
    // Filled in, less gain: added over the stone at full gain, amber washes out to cream.
    vec3 light = col * a * mix(2.4, 1.3, small) + vec3(a * a * mix(0.25, 0.08, small));
    // Premultiplied: the light is added as before (scaled by a, as additive blending did), and a
    // small hand also dims what lies behind it, so its colour holds its hue over the stone.
    gl_FragColor = vec4(light * a, a * 0.6 * small);
  }
`;

/**
 * Both seats' spectral hands in one mesh (one draw call): each hand's vertices carry the open pose
 * and the fist, and the shader blends them by that hand's curl and places them by its matrix.
 */
function makeHands(segs: number): {
  mesh: THREE.Mesh;
  matrices: [THREE.Matrix4, THREE.Matrix4];
  curl: THREE.Vector2;
  strength: THREE.Vector2;
  small: THREE.Vector2;
  dispose: () => void;
} {
  const h = buildSpectralHand(segs);
  const n = h.vertices;
  const join = (a: Float32Array) => {
    const out = new Float32Array(a.length * 2);
    out.set(a, 0);
    out.set(a, a.length);
    return out;
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(join(h.open), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(join(h.openNormal), 3));
  geometry.setAttribute('aFist', new THREE.BufferAttribute(join(h.fist), 3));
  geometry.setAttribute('aFistNormal', new THREE.BufferAttribute(join(h.fistNormal), 3));
  const who = new Float32Array(n * 2);
  who.fill(1, n);
  geometry.setAttribute('aHand', new THREE.BufferAttribute(who, 1));
  geometry.setIndex([...h.index, ...h.index.map((i) => i + n)]);
  const matrices: [THREE.Matrix4, THREE.Matrix4] = [new THREE.Matrix4(), new THREE.Matrix4()];
  const curl = new THREE.Vector2();
  const strength = new THREE.Vector2();
  const small = new THREE.Vector2();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uHand: { value: matrices },
      uCurl: { value: curl },
      uStrength: { value: strength },
      uSmall: { value: small },
      uColor0: { value: new THREE.Color(TEAM_COLORS[0]) },
      uColor1: { value: new THREE.Color(TEAM_COLORS[1]) },
    },
    vertexShader: handVertex,
    fragmentShader: handFragment,
    transparent: true,
    depthWrite: false,
    // Light added, the background kept but for the share the shader's alpha takes away.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  return {
    mesh,
    matrices,
    curl,
    strength,
    small,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

interface Rig {
  readonly slot: PlayerSlot;
  readonly group: THREE.Group;
  readonly mesh: THREE.SkinnedMesh;
  readonly bone: Record<BoneName, THREE.Bone>;
  /** The bones parents first, for forward kinematics. */
  readonly ordered: readonly THREE.Bone[];
  readonly animator: WielderAnimator;
  readonly glow: THREE.Vector4;
  readonly dispose: () => void;
}

function makeRig(slot: PlayerSlot, detail: number, shadows: boolean): Rig {
  const place = placementFor(slot);
  const { bones, root, skeleton } = buildSkeleton();
  const geometry = buildBody(WIELDER_LOOKS[slot], detail);
  const toField = new THREE.Vector3(-place.x, 0, -place.z).normalize();
  const { material, glow } = wielderMaterial(TEAM_COLORS[slot], toField, {
    relief: detail > 0,
    scale: place.scale,
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.castShadow = shadows;
  mesh.frustumCulled = false; // the bones move it; its rest bounds would cull it wrongly
  const group = new THREE.Group();
  group.add(mesh);
  group.position.set(place.x, place.y, place.z);
  group.rotation.y = place.yaw;
  group.scale.setScalar(place.scale);
  group.updateMatrixWorld(true); // the tether reads the hand's place through it before a render
  const bone = Object.fromEntries(bones.map((b) => [b.name, b])) as Record<BoneName, THREE.Bone>;
  return {
    slot,
    group,
    mesh,
    bone,
    ordered: BONES.map((n) => bone[n]),
    animator: new WielderAnimator(slot, place),
    glow,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      skeleton.dispose();
    },
  };
}

// Scratch for posing (one wielder at a time).
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
const q = new THREE.Quaternion();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qc = new THREE.Quaternion();
const modelQ = new Map<THREE.Bone, THREE.Quaternion>();
const modelP = new Map<THREE.Bone, THREE.Vector3>();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const fore = new THREE.Vector3();
const bend = new THREE.Vector3();
const curl = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const FWD = new THREE.Vector3(0, 0, 1);
const sol = newSolution();
const tetherStart = new THREE.Vector3();
const tetherEnd = new THREE.Vector3();
const moteCentre = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camUp = new THREE.Vector3();
/** The motes' orbit and size about the hands, at scale 1 (m). */
const MOTE_SPREAD = 0.11;
const MOTE_SIZE = 0.055;
/** The spectral hands: their length (m), how high they hover over the force point, their reach. */
const HAND_SIZE = 1.6;
const HAND_HEIGHT = 2.1;
const HAND_PITCH = 0.35;
/**
 * Small on screen (a phone), a spectral hand grows to keep at least HAND_MIN_PX render pixels of
 * length, up to HAND_MAX_GROW times its size, and its body fills in below HAND_FULL_PX.
 */
const HAND_MIN_PX = 24;
const HAND_MAX_GROW = 1.75;
const HAND_FULL_PX = 64;
/** The flare at the acting gauntlet: its radius at scale 1 (m), and at least (render pixels). */
const FLARE_RADIUS = 0.2;
const FLARE_MIN_PX = 5;
/**
 * The hand channel on the spectral hand (ADR-0009): a full push presses it this far down toward
 * the field and flatter, a full pull lifts it and curls it into a claw, and a full twist turns it
 * this far (seen from above, the way the twist spins a held core). Metres and radians.
 */
const PUSH_DROP = 0.5;
const PULL_LIFT = 0.4;
const PULL_CURL = 0.45;
const TWIST_TURN = 0.7;
const NO_HAND: HandState = { grip: 0, push: 0, twist: 0 };
const handCentre = new THREE.Vector3();
const buffer = new THREE.Vector2();

/** Bone orientations and positions in the wielder's frame, parents first. */
function forward(bones: readonly THREE.Bone[]): void {
  for (const b of bones) {
    const parent = (b.parent as THREE.Bone | null)?.isBone ? (b.parent as THREE.Bone) : null;
    const mq = modelQ.get(b) ?? new THREE.Quaternion();
    const mp = modelP.get(b) ?? new THREE.Vector3();
    if (!parent) {
      mq.copy(b.quaternion);
      mp.copy(b.position);
    } else {
      const pq = modelQ.get(parent)!;
      mq.copy(pq).multiply(b.quaternion);
      mp.copy(b.position).applyQuaternion(pq).add(modelP.get(parent)!);
    }
    modelQ.set(b, mq);
    modelP.set(b, mp);
  }
}

/** Sets `bone`'s local rotation so its orientation in the wielder's frame is `want`. */
function setModel(bone: THREE.Bone, want: THREE.Quaternion): void {
  const parent = bone.parent as THREE.Bone;
  bone.quaternion.copy(modelQ.get(parent)!).invert().multiply(want);
  modelQ.get(bone)!.copy(want);
}

/** Poses the skeleton from the animator's targets. */
function applyPose(rig: Rig, pose: WielderPose): void {
  const b = rig.bone;
  const list = rig.ordered;
  // Torso: the turn and lean spread over hips, spine and chest; the crouch lowers the hips.
  b.hips.position.set(pose.hips.x, RIG.hipY - pose.crouch * 0.16 + pose.hips.y, pose.hips.z);
  b.hips.quaternion.setFromEuler(eul.set(pose.pitch * 0.25, pose.yaw * 0.3, pose.roll * 0.3));
  b.spine.quaternion.setFromEuler(eul.set(pose.pitch * 0.35, pose.yaw * 0.3, pose.roll * 0.35));
  b.chest.quaternion.setFromEuler(eul.set(pose.pitch * 0.4, pose.yaw * 0.4, pose.roll * 0.35));
  for (const n of ['neck', 'head', 'clavicle.L', 'clavicle.R'] as const) b[n].quaternion.identity();
  // The coat's tails hang from the hips: their swing, less the hips' own lean and tilt.
  const hang = pose.coat.x - pose.pitch * 0.25;
  b['coat.L'].quaternion.setFromEuler(
    eul.set(hang + pose.coat.z, 0, pose.coat.y - pose.roll * 0.3),
  );
  b['coat.R'].quaternion.setFromEuler(
    eul.set(hang - pose.coat.z, 0, pose.coat.y - pose.roll * 0.3),
  );
  forward(list);

  // Head: toward what it looks at, within a natural turn and nod of the chest.
  const head = modelP.get(b.head)!;
  v1.copy(pose.look).sub(head);
  if (v1.lengthSq() < 1e-6) v1.copy(FWD);
  v1.applyQuaternion(qa.copy(modelQ.get(b.chest)!).invert()).normalize(); // in the chest's frame
  const yaw = THREE.MathUtils.clamp(Math.atan2(v1.x, v1.z), -1.1, 1.1);
  const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(-v1.y, -1, 1)), -0.5, 0.75);
  b.neck.quaternion.setFromEuler(eul.set(pitch * 0.4, yaw * 0.4, 0));
  b.head.quaternion.setFromEuler(eul.set(pitch * 0.6, yaw * 0.6, 0));
  forward(list);

  // Arms: IK to the hand targets, elbows toward their poles; the forearm carries the palm's turn.
  for (const [i, side] of [
    [0, 'L'],
    [1, 'R'],
  ] as const) {
    const s = side === 'L' ? 1 : -1;
    const restDown = v3.set(s * Math.sin(REST_ARM_ANGLE), -Math.cos(REST_ARM_ANGLE), 0);
    // The palm faces the body at rest: inward, square to the hanging arm.
    const restPalm = v2
      .set(-s, 0, 0)
      .addScaledVector(restDown, Math.sin(REST_ARM_ANGLE))
      .normalize();
    const shoulder = modelP.get(b[`upperArm.${side}`])!;
    solveTwoBone(RIG.arm, shoulder, pose.hand[i], pose.pole[i], sol);
    const upperDir = v1.subVectors(sol.mid, shoulder);
    const foreDir = fore.subVectors(sol.end, sol.mid);
    // The upper arm's front turns toward where the forearm goes (the elbow's bend).
    bend.copy(foreDir).addScaledVector(upperDir, -foreDir.dot(upperDir) / upperDir.lengthSq());
    aimBone(restDown, FWD, upperDir, bend.lengthSq() > 1e-8 ? bend : FWD, qb);
    setModel(b[`upperArm.${side}`], qb);
    aimBone(restDown, restPalm, foreDir, pose.palm[i], qc);
    setModel(b[`foreArm.${side}`], qc);
    // The hand straight on from the forearm, its palm as the pose asks.
    aimBone(restDown, restPalm, foreDir, pose.palm[i], q);
    setModel(b[`hand.${side}`], q);
    // Fingers curl toward the palm with the fist.
    curl.crossVectors(restDown, restPalm).normalize();
    b[`fingers.${side}`].quaternion.setFromAxisAngle(curl, (pose.fist[i] ?? 0) * 1.5);
  }
  forward(list);

  // Legs: the feet stay planted on the plinth; knees bend forward over them.
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const hip = modelP.get(b[`thigh.${side}`])!;
    const ankle = v1.set(s * RIG.hipHalf, RIG.ankleY, 0);
    const pole = v2.set(s * RIG.hipHalf * 1.4, 0.5, 1.2);
    solveTwoBone(RIG.leg, hip, ankle, pole, sol);
    aimBone(DOWN, FWD, v3.subVectors(sol.mid, hip), FWD, qb);
    setModel(b[`thigh.${side}`], qb);
    aimBone(DOWN, FWD, v3.subVectors(sol.end, sol.mid), FWD, qc);
    setModel(b[`shin.${side}`], qc);
    setModel(b[`foot.${side}`], q.identity()); // flat, facing the wielder's forward
  }
}

/** The wielders: mount once in the scene (low: no shadows, fewer rings). */
export function Wielders({ tier, shadows }: { tier: 'low' | 'medium' | 'high'; shadows: boolean }) {
  const client = useGameClient();
  const frame = useRenderFrame();
  const get = useThree((s) => s.get);
  const camera = useThree((s) => s.camera);
  const energy = useMemo(() => makeEnergy(), []);
  useEffect(() => () => energy.dispose(), [energy]);
  const hands = useMemo(() => makeHands(tier === 'low' ? 6 : 8), [tier]);
  useEffect(() => () => hands.dispose(), [hands]);
  // Each hand's smoothed place, curl and strength (render state only).
  const handState = useMemo(
    () =>
      [0, 1].map(() => ({
        at: new THREE.Vector3(),
        curl: 0,
        strength: 0,
        // The turn a spinning core gives a fist round it (rad, accumulated).
        twist: 0,
        // The seat's hand as shown: grip, push and the wrist's twist, smoothed.
        grip: 0,
        push: 0,
        wrist: 0,
        // How much larger than HAND_SIZE it is drawn (small screens).
        grow: 1,
        placed: false,
      })),
    [],
  );
  const rigs = useMemo(
    () => ([0, 1] as const).map((slot) => makeRig(slot, tier === 'low' ? 0 : 1, shadows)),
    [tier, shadows],
  );
  useEffect(() => () => rigs.forEach((r) => r.dispose()), [rigs]);
  // The main thread's time per frame for both wielders (posing, IK, arms and motes), averaged.
  const cost = useMemo(() => ({ ms: 0, frames: 0 }), []);
  // Test runs read what each wielder has played, to match it against the authority's events.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('test')) return;
    const w = window as unknown as Record<string, unknown>;
    w.__ffWielders = () =>
      rigs.map((r) => ({
        slot: r.slot,
        played: { ...r.animator.played },
        hand: r.animator.activeHand,
        reaching: r.animator.reaching,
        frameMs: cost.ms,
        frames: cost.frames,
        // Its spectral hand: 0 open, 1 a fist (closed round what the grip holds, or as closed as
        // the seat's hand); drawn `grow` times its size (a small screen); the push it shows.
        curl: handState[r.slot]!.curl,
        grow: handState[r.slot]!.grow,
        push: handState[r.slot]!.push,
        at: handState[r.slot]!.at.toArray(),
      }));
    return () => {
      delete w.__ffWielders;
    };
  }, [rigs, cost, handState]);
  // Events arrive while the frame samples the authority (before this frame's poses), stamped
  // with this frame's render time, as the effects and sounds they also start.
  useEffect(
    () =>
      client.events.on((e) => rigs.forEach((r) => r.animator.onEvent(e, get().clock.elapsedTime))),
    [client, rigs, get],
  );

  useFrame(({ clock, gl }, delta) => {
    const dt = Math.min(0.1, Math.max(0, delta));
    const f = frame.current;
    const snap = f?.latest;
    if (!snap) return;
    const started = performance.now();
    const coreEntity = snap.entities.find((e) => e.kind === 'core');
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    // The world size of one render pixel per metre from the camera: the arms, hands and flares
    // keep a least size on screen from it (a phone sees the plinths from 50–60 m).
    gl.getDrawingBufferSize(buffer);
    const pixel = 2 / (Math.max(1e-6, camera.projectionMatrix.elements[5]) * Math.max(1, buffer.y));
    let motesLit = false;
    for (const r of rigs) {
      const p = snap.players.find((pl) => pl.slot === r.slot);
      const lifted =
        p && p.holdTarget >= 0 ? snap.entities.find((e) => e.id === p.holdTarget) : undefined;
      // The force point as the frame interpolates it (as the reticles draw it), not the newest
      // snapshot's: the aim and the arm move smoothly at any snapshot rate.
      const fp = f.manipulators[r.slot];
      const state: WielderState = {
        phase: snap.match.phase,
        m: p ? [fp.x, fp.z] : [0, 0],
        hold: p?.hold ?? null,
        holdY: lifted ? lifted.p[1] : null,
        gripping: !!p && p.grasp >= 0,
        connected: p ? p.connected : false,
        core: coreEntity ? coreEntity.p : null,
        coreV: coreEntity?.v ?? null,
        ownGoalX: r.slot === 0 ? -GOAL_X : GOAL_X,
      };
      const pose = r.animator.update(state, clock.elapsedTime);
      applyPose(r, pose);
      r.glow.set(0.35 * pose.aura, pose.glow[0], pose.glow[1], 0.6 + 0.4 * pose.aura);
      // The spectral arm: from the acting hand's knuckles to the force point on the field, faint
      // while aiming, flaring with a cast (the gauntlet's own glow).
      const h = r.animator.activeHand;
      const acting = modelP.get(r.bone[h === 1 ? 'fingers.L' : 'fingers.R'])!;
      tetherStart.copy(acting).applyMatrix4(r.group.matrixWorld);
      const flare = THREE.MathUtils.clamp((pose.glow[h === 1 ? 0 : 1] - 0.5) * 2, 0, 1);
      const reaching = r.animator.reaching;
      // The spectral hand (WP9): over the force point, reaching down onto the field from the
      // wielder's side, the acting hand's own side (a left hand mirrored); closed round the body
      // the grip holds, from the snapshot, so both players see each other's grips.
      const hs = handState[r.slot]!;
      const held = p && p.grasp >= 0 ? f.entities.get(p.grasp) : undefined;
      // What the seat's hand is doing: this device's own seat at once (cosmetic, as its reticle),
      // the rival's as the authority last read it; a seat without a hand shows an open, still one.
      const shown = localHand.get(r.slot) ?? p?.hand ?? NO_HAND;
      const k = hs.placed ? 1 - Math.exp(-dt / 0.06) : 1;
      hs.grip += (shown.grip - hs.grip) * k;
      hs.push += (shown.push - hs.push) * k;
      hs.wrist += (shown.twist - hs.wrist) * k;
      const press = Math.max(0, hs.push);
      const pull = Math.max(0, -hs.push);
      // A grown fist rises with its size, to close round the body as it does at full size.
      if (held) handCentre.set(held.px, held.py + 0.8 * hs.grow, held.pz);
      else
        handCentre.set(fp.x, HAND_HEIGHT + (PULL_LIFT * pull - PUSH_DROP * press) * hs.grow, fp.z);
      hs.at.lerp(handCentre, hs.placed ? 1 - Math.exp(-dt / 0.07) : 1);
      // Closed round what the grip holds; otherwise as closed as the hand (a pull, a claw).
      const close = held ? 1 : Math.max(hs.grip, PULL_CURL * pull);
      hs.curl += (close - hs.curl) * (hs.placed ? 1 - Math.exp(-dt / 0.09) : 1);
      hs.strength = Math.min(
        1,
        reaching * (0.45 + 0.45 * flare + 0.3 * hs.curl + 0.25 * Math.abs(hs.push)),
      );
      // A fist on a spinning core turns with it: the player's twist, as the authority keeps it.
      if (held) hs.twist += held.spin * dt;
      else hs.twist *= Math.exp(-dt / 0.25);
      hs.placed = true;
      // Its length on screen: a phone draws it larger and fuller (render state only).
      const handPx = HAND_SIZE / Math.max(1e-6, camera.position.distanceTo(hs.at) * pixel);
      hs.grow = THREE.MathUtils.clamp(HAND_MIN_PX / handPx, 1, HAND_MAX_GROW);
      hands.small.setComponent(
        r.slot,
        1 - THREE.MathUtils.smoothstep(handPx * hs.grow, HAND_MIN_PX, HAND_FULL_PX),
      );
      // The spectral arm arrives at its wrist. A push flattens the hand onto the field, a pull
      // tips its fingers down to draw in; a twist turns it as it would spin a held core.
      placeSpectralHand(
        hs.at,
        r.group.position,
        h === 1,
        HAND_SIZE * hs.grow,
        HAND_PITCH - 0.25 * press + 0.35 * pull,
        hands.matrices[r.slot],
        tetherEnd,
        hs.twist - TWIST_TURN * hs.wrist,
      );
      layTether(
        tetherStart,
        tetherEnd,
        camera.position,
        energy.pos,
        r.slot * TETHER_VERTS,
        pixel,
        energy.px,
      );
      energy.strength.setComponent(r.slot, reaching * (0.28 + 0.5 * flare));
      // The flare at the acting gauntlet: faint while reaching, bright with a cast, a few pixels
      // across at least, so a phone sees which wielder acts.
      const flareBright = pose.aura * (0.12 * reaching + 0.88 * flare);
      layFlare(
        tetherStart,
        Math.max(
          FLARE_RADIUS * r.group.scale.x,
          FLARE_MIN_PX * camera.position.distanceTo(tetherStart) * pixel,
        ),
        flareBright,
        camRight,
        camUp,
        energy.pos,
        energy.glow,
        FLARE_BASE + r.slot * 4,
      );
      // The motes: between the hands at rest, gathering at the acting hand as it reaches, spread
      // wider by a cast; dim with the wielder's aura.
      moteCentre
        .copy(modelP.get(r.bone['fingers.L'])!)
        .add(modelP.get(r.bone['fingers.R'])!)
        .multiplyScalar(0.5)
        .lerp(acting, Math.min(1, reaching))
        .applyMatrix4(r.group.matrixWorld);
      const scale = r.group.scale.x;
      const bright = pose.aura * (0.55 + 0.45 * flare);
      layMotes(
        moteCentre,
        MOTE_SPREAD * scale * (1 + 1.2 * flare),
        MOTE_SIZE * scale,
        bright,
        clock.elapsedTime + r.slot * 17.3,
        camRight,
        camUp,
        energy.pos,
        energy.glow,
        MOTE_BASE + r.slot * MOTE_VERTS,
      );
      motesLit ||= bright > 0.01 || flareBright > 0.01;
    }
    const attrs = energy.mesh.geometry.attributes;
    attrs.position!.needsUpdate = true;
    attrs.aGlow!.needsUpdate = true;
    attrs.aPx!.needsUpdate = true;
    energy.time.value = clock.elapsedTime;
    energy.mesh.visible = motesLit || energy.strength.x + energy.strength.y > 0.005;
    hands.curl.set(handState[0]!.curl, handState[1]!.curl);
    hands.strength.set(handState[0]!.strength, handState[1]!.strength);
    hands.mesh.visible = hands.strength.x + hands.strength.y > 0.005;
    const spent = performance.now() - started;
    cost.ms =
      cost.frames === 0 ? spent : cost.ms + (spent - cost.ms) / Math.min(120, cost.frames + 1);
    cost.frames++;
  });

  return (
    <group>
      {rigs.map((r) => (
        <primitive key={r.slot} object={r.group} />
      ))}
      <primitive object={energy.mesh} />
      <primitive object={hands.mesh} />
    </group>
  );
}
