import type { HandObservation, LandmarksFrame } from '@ff/gestures';
import type { FromVisionWorker, ToVisionWorker } from './vision-protocol';

export type CameraError =
  | 'denied'
  | 'insecure'
  | 'not-found'
  | 'busy'
  | 'unsupported'
  | 'revoked'
  | 'model-unavailable'
  | 'inference-failed';

export type CameraState = 'idle' | 'requesting' | 'loading' | 'running' | 'paused' | 'error';

export interface CameraStats {
  /** Landmark frames delivered per second (inference rate actually achieved). */
  readonly fps: number;
  /** Model time per frame in the worker (ms, smoothed). */
  readonly inferMs: number;
  /** Capture → landmarks available on the main thread (ms, smoothed). */
  readonly latencyMs: number;
  readonly width: number;
  readonly delegate: 'GPU' | 'CPU' | null;
  readonly pose: boolean;
}

export interface CameraOptions {
  /** 'user' = selfie / desk camera facing the player; 'environment' = rear camera. */
  readonly facingMode: 'user' | 'environment';
  /** The camera looks at the player (true for selfie and for a rear camera on a stand). */
  readonly facingUser: boolean;
  /** Track the upper body too (camera-stand mode): bystander rejection, ego-motion. */
  readonly pose: boolean;
}

export interface CameraCallbacks {
  onFrame(frame: LandmarksFrame): void;
  onState(state: CameraState, error?: CameraError): void;
  onStats?(stats: CameraStats): void;
}

/** Inference input widths, best first; the session steps down when the device can't keep up. */
const WIDTHS = [640, 480, 320] as const;
const BUDGET_MS = 45;

function classify(e: unknown): CameraError {
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure';
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return 'not-found';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'unsupported';
  }
}

export const CAMERA_ERROR_TEXT: Record<CameraError, string> = {
  denied: 'Camera access was not allowed. You can allow it in the browser’s site settings.',
  insecure: 'Camera control needs a secure (https) page.',
  'not-found': 'No camera was found on this device.',
  busy: 'The camera is in use by another app or tab.',
  unsupported: 'This browser cannot provide camera frames to the game.',
  revoked: 'The camera stopped (permission revoked or device unplugged).',
  'model-unavailable': 'The hand-tracking model could not be loaded.',
  'inference-failed': 'Hand tracking stopped working on this device.',
};

/**
 * Local camera → landmark pipeline. The stream stays in a hidden <video> on this device; frames go
 * to the vision worker as transferred bitmaps (one in flight; extras are dropped, never queued),
 * and only landmark coordinates come back. Pauses with the tab, recovers or reports every
 * getUserMedia failure, and stops the camera completely on `stop()`.
 */
export class CameraSession {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private state: CameraState = 'idle';
  private busy = false;
  private stopped = false;
  private widthLevel = 1;
  private lastSent = 0;
  private frameHandle = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private delegate: 'GPU' | 'CPU' | null = null;
  private poseOn = false;
  private inferMs = 0;
  private latencyMs = 0;
  private delivered: number[] = [];
  private targetFps = 30;
  private slowStreak = 0;
  private fastStreak = 0;

  constructor(
    private readonly opts: CameraOptions,
    private readonly cb: CameraCallbacks,
  ) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.widthLevel = opts.pose ? 0 : 1;
  }

  get current(): CameraState {
    return this.state;
  }

  private setState(s: CameraState, error?: CameraError): void {
    this.state = s;
    this.cb.onState(s, error);
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setState('error', window.isSecureContext ? 'unsupported' : 'insecure');
      return;
    }
    this.setState('requesting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: this.opts.facingMode,
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (e) {
      this.setState('error', classify(e));
      return;
    }
    if (this.stopped) {
      this.releaseStream();
      return;
    }
    for (const track of this.stream.getVideoTracks()) {
      track.addEventListener('ended', this.onEnded);
    }
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch {
      // Autoplay of a muted inline video is allowed after the user's tap; ignore races.
    }
    this.setState('loading');
    this.startWorker();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private startWorker(): void {
    const worker = new Worker(new URL('./vision.worker.ts', import.meta.url), {
      type: 'module',
      name: 'ff-vision',
    });
    this.worker = worker;
    worker.onmessage = (ev: MessageEvent<FromVisionWorker>) => this.onWorker(ev.data);
    worker.onerror = () => {
      this.fail('model-unavailable');
    };
    const base = `${import.meta.env.BASE_URL}vision/`;
    this.post({
      type: 'init',
      wasmBase: new URL(`${base}wasm`, window.location.href).href,
      handModel: new URL(`${base}models/hand_landmarker.task`, window.location.href).href,
      poseModel: this.opts.pose
        ? new URL(`${base}models/pose_landmarker_lite.task`, window.location.href).href
        : null,
      delegate: 'GPU',
    });
  }

  private post(msg: ToVisionWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private onWorker(msg: FromVisionWorker): void {
    switch (msg.type) {
      case 'ready': {
        const first = this.delegate === null;
        this.delegate = msg.delegate;
        this.poseOn = msg.pose;
        this.busy = false;
        this.inferMs = 0;
        if (!first) break; // delegate switched mid-stream (slow GPU path → CPU)
        this.setState(document.hidden ? 'paused' : 'running');
        this.schedule();
        break;
      }
      case 'result': {
        this.busy = false;
        const now = performance.now();
        this.inferMs = this.inferMs ? this.inferMs * 0.85 + msg.inferMs * 0.15 : msg.inferMs;
        const lat = now - msg.t;
        this.latencyMs = this.latencyMs ? this.latencyMs * 0.85 + lat * 0.15 : lat;
        this.delivered.push(now);
        while (this.delivered.length > 0 && now - this.delivered[0]! > 1000) this.delivered.shift();
        this.adapt();
        if (this.state !== 'running') return;
        this.cb.onFrame(this.toFrame(msg));
        this.cb.onStats?.({
          fps: this.delivered.length,
          inferMs: this.inferMs,
          latencyMs: this.latencyMs,
          width: WIDTHS[this.widthLevel]!,
          delegate: this.delegate,
          pose: this.poseOn,
        });
        break;
      }
      case 'skip':
        this.busy = false;
        break;
      case 'error':
        this.busy = false;
        if (msg.fatal) this.fail(this.delegate ? 'inference-failed' : 'model-unavailable');
        break;
    }
  }

  /** Anatomical handedness: MediaPipe assumes a mirrored image; raw frames of a camera facing the
   *  player are not mirrored, so its labels are swapped. */
  private toFrame(msg: Extract<FromVisionWorker, { type: 'result' }>): LandmarksFrame {
    const swap = this.opts.facingUser;
    const hands: HandObservation[] = msg.hands.map((h) => {
      const right = h.label === 'Right';
      return {
        landmarks: h.landmarks,
        handedness: right !== swap ? 'right' : 'left',
        score: h.score,
      };
    });
    return {
      t: msg.t,
      hands,
      pose: msg.pose ? { landmarks: msg.pose, score: msg.poseScore } : null,
      width: msg.width,
      height: msg.height,
    };
  }

  /** Steps resolution / rate down when inference can't keep up, and back up when it can. */
  private adapt(): void {
    if (this.inferMs > BUDGET_MS) {
      this.fastStreak = 0;
      if (++this.slowStreak > 15) {
        this.slowStreak = 0;
        if (this.widthLevel < WIDTHS.length - 1) this.widthLevel++;
        else this.targetFps = Math.max(12, this.targetFps - 6);
      }
    } else if (this.inferMs < BUDGET_MS * 0.4) {
      this.slowStreak = 0;
      if (++this.fastStreak > 90) {
        this.fastStreak = 0;
        if (this.targetFps < 30) this.targetFps = Math.min(30, this.targetFps + 6);
        else if (this.widthLevel > (this.opts.pose ? 0 : 1)) this.widthLevel--;
      }
    }
  }

  private schedule(): void {
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (typeof v.requestVideoFrameCallback === 'function') {
      const rvfc = v.requestVideoFrameCallback.bind(v);
      const loop = () => {
        if (this.stopped) return;
        this.pump();
        this.frameHandle = rvfc(loop);
      };
      this.frameHandle = rvfc(loop);
    } else {
      this.timer = setInterval(() => this.pump(), 16);
    }
  }

  private pump(): void {
    if (this.state !== 'running' || this.busy || !this.worker) return;
    const now = performance.now();
    if (now - this.lastSent < 1000 / this.targetFps - 2) return;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return;
    const w = Math.min(vw, WIDTHS[this.widthLevel]!);
    const h = Math.round((vh / vw) * w);
    this.busy = true;
    this.lastSent = now;
    createImageBitmap(this.video, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' })
      .then((bitmap) => {
        if (this.stopped || !this.worker) {
          bitmap.close();
          this.busy = false;
          return;
        }
        this.post({ type: 'frame', bitmap, t: now }, [bitmap]);
      })
      .catch(() => {
        this.busy = false;
      });
  }

  private onVisibility = (): void => {
    if (this.state === 'error' || this.state === 'idle') return;
    if (document.hidden && this.state === 'running') this.setState('paused');
    else if (!document.hidden && this.state === 'paused') this.setState('running');
  };

  private onEnded = (): void => {
    if (!this.stopped) this.fail('revoked');
  };

  private fail(error: CameraError): void {
    this.teardown();
    this.setState('error', error);
  }

  private releaseStream(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      track.removeEventListener('ended', this.onEnded);
      track.stop();
    }
    this.stream = null;
    this.video.srcObject = null;
  }

  private teardown(): void {
    this.stopped = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (this.frameHandle) v.cancelVideoFrameCallback?.(this.frameHandle);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.post({ type: 'close' });
    this.worker?.terminate();
    this.worker = null;
    this.releaseStream();
  }

  /** Stops the camera (light goes off) and the worker. */
  stop(): void {
    this.teardown();
    this.setState('idle');
  }
}
