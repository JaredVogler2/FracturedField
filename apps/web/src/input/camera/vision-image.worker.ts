/**
 * Test-only (?test=1) still-image hand detection in a module worker (same self-hosted ES-module
 * runtime and model as play). Returns raw landmarks; classification happens on the main thread
 * with the game's own gesture code.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

interface Req {
  readonly id: number;
  readonly base: string;
  readonly bitmap: ImageBitmap;
}

let model: Promise<HandLandmarker> | null = null;

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, base, bitmap } = ev.data;
  try {
    model ??= FilesetResolver.forVisionTasks(`${base}wasm`, true).then((fileset) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numHands: 2,
      }),
    );
    const r = (await model).detect(bitmap);
    self.postMessage({
      id,
      width: bitmap.width,
      height: bitmap.height,
      hands: r.landmarks.map((lm, i) => ({
        landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        label: r.handedness[i]?.[0]?.categoryName ?? 'Right',
        score: r.handedness[i]?.[0]?.score ?? 0,
      })),
    });
  } catch (e) {
    self.postMessage({ id, error: String(e) });
  } finally {
    bitmap.close();
  }
};
