import type { Point3 } from '@ff/gestures';

/** Main thread → vision worker. */
export type ToVisionWorker =
  | {
      readonly type: 'init';
      /** Directory holding the ES-module WASM runtime (self-hosted). */
      readonly wasmBase: string;
      readonly handModel: string;
      /** Pose model URL when upper-body tracking is wanted (camera-stand mode), else null. */
      readonly poseModel: string | null;
      readonly delegate: 'GPU' | 'CPU';
    }
  | {
      readonly type: 'frame';
      readonly bitmap: ImageBitmap;
      /** Capture time (ms, performance clock) — also the MediaPipe video timestamp. */
      readonly t: number;
    }
  | { readonly type: 'close' };

export interface RawHand {
  readonly landmarks: readonly Point3[];
  /** MediaPipe's label ('Left' | 'Right'), which assumes a mirrored (selfie) image. */
  readonly label: string;
  readonly score: number;
}

/** Vision worker → main thread. Only landmarks ever leave the worker — never pixels. */
export type FromVisionWorker =
  | { readonly type: 'ready'; readonly delegate: 'GPU' | 'CPU'; readonly pose: boolean }
  | {
      readonly type: 'result';
      readonly t: number;
      readonly width: number;
      readonly height: number;
      readonly hands: readonly RawHand[];
      readonly pose: readonly Point3[] | null;
      readonly poseScore: number;
      readonly inferMs: number;
    }
  /** Frame dropped without inference (model switching); the sender may post the next one. */
  | { readonly type: 'skip' }
  | { readonly type: 'error'; readonly message: string; readonly fatal: boolean };
