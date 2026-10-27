/**
 * Test-only (?test=1) still-image check: runs the same hand model on a photo in IMAGE mode on the
 * main thread and passes the real landmarks through the gesture classifier. Used by the browser
 * tests to verify hand shapes on genuine model output (not synthetic hands). Never used in play.
 */
import {
  ShapeClassifier,
  handFeatures,
  type Handedness,
  type HandShape,
  type Point3,
} from '@ff/gestures';

interface RawResult {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly hands: readonly { landmarks: Point3[]; label: string; score: number }[];
  readonly error?: string;
}

let worker: Worker | null = null;
let nextId = 0;

function detect(bitmap: ImageBitmap): Promise<RawResult> {
  worker ??= new Worker(new URL('./vision-image.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const id = ++nextId;
  const base = new URL(`${import.meta.env.BASE_URL}vision/`, window.location.href).href;
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<RawResult>) => {
      if (ev.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (ev.data.error) reject(new Error(ev.data.error));
      else resolve(ev.data);
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, base, bitmap }, [bitmap]);
  });
}

export interface ImageHand {
  readonly label: string;
  /** Anatomical hand for a camera facing the hand (MediaPipe's mirrored label swapped). */
  readonly handedness: Handedness;
  readonly score: number;
  readonly shape: HandShape;
  readonly bend: readonly number[];
  readonly thumbReach: number;
  readonly thumbLateral: number;
  readonly pinch: number;
  /** Thumb tip height above the index knuckle in palm widths (thumbs-up check). */
  readonly thumbRise: number;
}

export async function classifyImage(url: string): Promise<ImageHand[]> {
  const blob = await (await fetch(url)).blob();
  const r = await detect(await createImageBitmap(blob));
  const aspect = r.width / r.height;
  return r.hands.map((h) => {
    const label = h.label;
    const handedness: Handedness = label === 'Right' ? 'left' : 'right';
    const pts = h.landmarks;
    const f = handFeatures(pts, aspect, handedness);
    if (!f) throw new Error('invalid landmarks');
    // A still image is one frame: classify it a few times so the smoothing settles.
    const c = new ShapeClassifier();
    let shape: HandShape = 'unknown';
    for (let k = 0; k < 4; k++) shape = c.classify(f);
    return {
      label,
      handedness,
      score: h.score,
      shape,
      bend: f.bend.map((b) => Math.round(b * 100) / 100),
      thumbReach: Math.round(f.thumbReach * 100) / 100,
      thumbLateral: Math.round(f.thumbLateral * 100) / 100,
      pinch: Math.round(f.pinch * 100) / 100,
      thumbRise: Math.round(((pts[4]!.y - pts[5]!.y) / f.scale) * 100) / 100,
    };
  });
}
