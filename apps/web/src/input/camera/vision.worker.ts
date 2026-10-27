/**
 * On-device hand (and optional pose) landmark inference in a dedicated module worker, so the
 * render loop never waits for the model. Receives camera frames as transferred ImageBitmaps,
 * returns landmark coordinates only, and closes every bitmap immediately: no frame is kept,
 * stored or sent anywhere.
 */
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { FromVisionWorker, RawHand, ToVisionWorker } from './vision-protocol';

interface WorkerScope {
  postMessage(message: FromVisionWorker): void;
  onmessage: ((ev: MessageEvent<ToVisionWorker>) => void) | null;
  close(): void;
}
const scope = self as unknown as WorkerScope;

let hands: HandLandmarker | null = null;
let pose: PoseLandmarker | null = null;
let lastT = -1;

async function create(msg: Extract<ToVisionWorker, { type: 'init' }>, delegate: 'GPU' | 'CPU') {
  // `true`: the ES-module WASM loader (importScripts is unavailable in module workers).
  const fileset = await FilesetResolver.forVisionTasks(msg.wasmBase, true);
  const h = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: msg.handModel, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
  let p: PoseLandmarker | null = null;
  if (msg.poseModel) {
    p = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: msg.poseModel, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }
  return { h, p };
}

/** Median time of a few inferences on a synthetic frame (after one warm-up run). */
function benchmark(h: HandLandmarker): number {
  const canvas = new OffscreenCanvas(256, 192);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#806050';
    ctx.fillRect(0, 0, 256, 192);
  }
  const times: number[] = [];
  for (let i = 0; i < 4; i++) {
    const bmp = canvas.transferToImageBitmap();
    const t0 = performance.now();
    h.detectForVideo(bmp, ++lastT);
    if (i > 0) times.push(performance.now() - t0);
    bmp.close();
    if (ctx) ctx.fillRect(0, 0, 256, 192);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1] ?? Infinity;
}

/** True when WebGL in this worker is a software rasteriser (the GPU delegate would crawl). */
function softwareGl(): boolean {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return true;
  }
}

let initMsg: Extract<ToVisionWorker, { type: 'init' }> | null = null;
let current: 'GPU' | 'CPU' = 'CPU';
let slowFrames = 0;
let switching = false;

async function init(msg: Extract<ToVisionWorker, { type: 'init' }>): Promise<void> {
  initMsg = msg;
  let delegate = msg.delegate === 'GPU' && softwareGl() ? 'CPU' : msg.delegate;
  let gpuMs = Infinity;
  try {
    ({ h: hands, p: pose } = await create(msg, delegate));
    gpuMs = delegate === 'GPU' ? benchmark(hands) : Infinity;
  } catch (e) {
    if (delegate !== 'GPU') throw e;
    hands = null;
  }
  // WebGL in workers is missing or emulated in software on some devices: when the GPU path is
  // unavailable or slow, measure the CPU (XNNPACK) path and keep whichever is faster.
  if (delegate === 'GPU' && (hands === null || gpuMs > 40)) {
    try {
      const cpu = await create(msg, 'CPU');
      const cpuMs = benchmark(cpu.h);
      if (hands === null || cpuMs < gpuMs) {
        hands?.close();
        pose?.close();
        hands = cpu.h;
        pose = cpu.p;
        delegate = 'CPU';
      } else {
        cpu.h.close();
        cpu.p?.close();
      }
    } catch (e) {
      if (hands === null) throw e;
    }
  }
  current = delegate;
  scope.postMessage({ type: 'ready', delegate, pose: pose !== null });
}

/** Runtime guard: a GPU path that turns out slow on real frames is replaced by the CPU path. */
async function fallBackToCpu(): Promise<void> {
  if (!initMsg || switching) return;
  switching = true;
  try {
    const cpu = await create(initMsg, 'CPU');
    hands?.close();
    pose?.close();
    hands = cpu.h;
    pose = cpu.p;
    current = 'CPU';
    scope.postMessage({ type: 'ready', delegate: 'CPU', pose: pose !== null });
  } catch {
    // keep the GPU path
  } finally {
    switching = false;
  }
}

function infer(msg: Extract<ToVisionWorker, { type: 'frame' }>): void {
  const bitmap = msg.bitmap;
  try {
    if (!hands || switching) {
      scope.postMessage({ type: 'skip' });
      return;
    }
    // MediaPipe VIDEO mode needs strictly increasing timestamps.
    const t = msg.t > lastT ? msg.t : lastT + 0.001;
    lastT = t;
    const t0 = performance.now();
    const r = hands.detectForVideo(bitmap, t);
    const out: RawHand[] = r.landmarks.map((lm, i) => ({
      landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      label: r.handedness[i]?.[0]?.categoryName ?? 'Right',
      score: r.handedness[i]?.[0]?.score ?? 0,
    }));
    let poseLm: { x: number; y: number; z: number }[] | null = null;
    let poseScore = 0;
    if (pose) {
      const pr = pose.detectForVideo(bitmap, t);
      const first = pr.landmarks[0];
      if (first) {
        poseLm = first.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        // Shoulder visibility as a presence score for the bystander gate.
        poseScore = Math.min(first[11]?.visibility ?? 0, first[12]?.visibility ?? 0);
      }
    }
    const inferMs = performance.now() - t0;
    if (current === 'GPU') {
      slowFrames = inferMs > 150 ? slowFrames + 1 : 0;
      if (slowFrames >= 5) void fallBackToCpu();
    }
    scope.postMessage({
      type: 'result',
      t: msg.t,
      width: bitmap.width,
      height: bitmap.height,
      hands: out,
      pose: poseLm,
      poseScore,
      inferMs,
    });
  } catch (e) {
    scope.postMessage({ type: 'error', message: String(e), fatal: false });
  } finally {
    bitmap.close();
  }
}

scope.onmessage = (ev: MessageEvent<ToVisionWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      init(msg).catch((e: unknown) =>
        scope.postMessage({ type: 'error', message: String(e), fatal: true }),
      );
      break;
    case 'frame':
      infer(msg);
      break;
    case 'close':
      hands?.close();
      pose?.close();
      hands = null;
      pose = null;
      scope.close();
      break;
  }
};
