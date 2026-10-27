import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdvancedAbilityId } from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';
import type { HandPose, SyntheticCamera, TimelineSpec } from '@ff/gestures/synthetic';
import type { InputManager } from '../../input/manager';
import {
  CAMERA_ERROR_TEXT,
  CameraSession,
  type CameraError,
} from '../../input/camera/camera-session';
import { CameraController } from '../../input/camera/camera-controller';
import { useShallow } from 'zustand/react/shallow';
import { resetCameraUi, useCamera } from '../../input/camera/camera-store';
import { useSettings, type CameraPrefs } from '../../game/settings';
import { ABILITY_INFO } from '../Loadout';

type Step = 'choose' | 'frame' | 'calibrate' | 'practice' | 'active';

const GESTURES: readonly { sign: string; what: string }[] = [
  { sign: 'Move an open hand', what: 'Aim your force point' },
  { sign: 'Push your palm toward the camera', what: 'PULSE' },
  { sign: 'One quick stroke sideways or up/down', what: 'SWEEP (wind in that direction)' },
  { sign: 'Turn your palm up and hold — or bring both palms together', what: 'GUARD' },
  { sign: 'Make a fist and hold; open to let go', what: 'LIFT' },
  { sign: 'Two fingers (V)', what: 'WET' },
  { sign: 'Thumbs up', what: 'HEAT' },
  { sign: 'Point with one finger', what: 'Pick 1' },
  { sign: 'OK sign (thumb meets index)', what: 'Pick 2' },
];

/** Gesture reference with the seat's actual picks filled in. */
export function GestureHelp({
  loadout,
}: {
  loadout: readonly [AdvancedAbilityId, AdvancedAbilityId];
}) {
  return (
    <ul className="gesture-help">
      {GESTURES.map((g) => (
        <li key={g.what}>
          <span className="g-sign">{g.sign}</span>
          <span className="g-what">
            {g.what === 'Pick 1'
              ? `${ABILITY_INFO[loadout[0]].name}`
              : g.what === 'Pick 2'
                ? `${ABILITY_INFO[loadout[1]].name}`
                : g.what}
          </span>
        </li>
      ))}
    </ul>
  );
}

function trackText(state: string | undefined, hands: number, stable: boolean): string {
  switch (state) {
    case 'tracking':
      return stable ? 'Tracking your hand · steady' : 'Tracking your hand';
    case 'coasting':
      return 'Hold on…';
    case 'lost':
      return hands > 0 ? 'Show your playing hand in the play area' : 'Hand lost — show your hand';
    default:
      return hands > 0 ? 'Raise your playing hand' : 'Looking for your hand…';
  }
}

/**
 * Camera control for one local seat: a three-step setup (choose / frame / calibrate + practice),
 * then a small in-match status chip with optional self-view. Camera permission is only requested
 * when the player taps "Start camera"; every failure offers touch/keyboard immediately.
 */
export function CameraControl({
  slot,
  manager,
  loadout,
  paused,
  onFallback,
  onReady,
}: {
  slot: PlayerSlot;
  manager: InputManager | null;
  loadout: readonly [AdvancedAbilityId, AdvancedAbilityId];
  /** Pause menu open / match not running: no gestures reach the game. */
  paused: boolean;
  /** Player chose (or was forced) to play without the camera. */
  onFallback: () => void;
  /** Camera setup finished: the player can start / ready up. */
  onReady: (ready: boolean) => void;
}) {
  const prefs = useSettings((s) => s.camera);
  const [rawStep, setStep] = useState<Step>('choose');
  // Where "Cancel" leaves calibration: back to the match when recalibrating from play.
  const [returnTo, setReturnTo] = useState<Step>('frame');
  const [showHelp, setShowHelp] = useState(false);
  // Only what the UI displays: the store's track/stats objects change on every camera frame, and
  // re-rendering this tree at camera rate would cost main-thread time on slow phones.
  const cam = useCamera(
    useShallow((st) => ({
      state: st.state,
      error: st.error,
      fps: st.stats?.fps ?? null,
      calibration: st.calibration,
      practiced: st.practiced,
      trackState: st.track?.state,
      handsVisible: st.track?.handsVisible ?? 0,
      stable: st.track?.stable ?? false,
      longLost: st.track?.state === 'lost' && st.track.lostMs > 2000,
    })),
  );
  const [flash, setFlash] = useState<string | null>(null);
  // Calibration completes inside the controller, which then moves itself on to practice.
  const step: Step =
    rawStep === 'calibrate' && cam.calibration?.phase === 'done' ? 'practice' : rawStep;
  const previewRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const setPrefs = (patch: Partial<CameraPrefs>) => {
    const s = useSettings.getState();
    s.set('camera', { ...s.camera, ...patch });
  };
  // The gesture pipeline outlives re-renders; the controller re-attaches to new input managers.
  const controller = useMemo(
    () =>
      new CameraController(
        {
          dominant: prefs.dominant,
          sensitivity: prefs.sensitivity,
          dwellMs: prefs.dwellMs,
          facingUser: true,
        },
        prefs.calibration,
        (calibration, dominant) => setPrefs({ calibration, dominant }),
      ),
    // Created once per mount; later preference changes are pushed via configure().
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    controller.configure({
      dominant: prefs.dominant,
      sensitivity: prefs.sensitivity,
      dwellMs: prefs.dwellMs,
    });
  }, [controller, prefs.dominant, prefs.sensitivity, prefs.dwellMs]);

  useEffect(() => {
    controller.attach(manager?.seat(slot) ?? null);
  }, [controller, manager, slot]);

  useEffect(() => {
    if (paused) controller.pause();
    else controller.resume();
  }, [controller, paused]);

  useEffect(() => {
    controller.setMode(
      step === 'calibrate' ? 'calibrate' : step === 'active' ? 'play' : 'practice',
    );
    useCamera.setState({
      phase:
        step === 'active'
          ? 'active'
          : step === 'calibrate'
            ? 'calibrating'
            : step === 'practice'
              ? 'practice'
              : 'setup',
    });
    onReady(step === 'active');
  }, [controller, step, onReady]);

  // Briefly echo each recognised gesture in the status chip.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = useCamera.subscribe((s, prev) => {
      if (!s.lastGesture || s.lastGesture === prev.lastGesture) return;
      const action = s.lastGesture.action;
      // Picks echo the player's actual move, not the internal slot name.
      const shown =
        action === 'pick1'
          ? ABILITY_INFO[loadout[0]].name
          : action === 'pick2'
            ? ABILITY_INFO[loadout[1]].name
            : action;
      setFlash(shown.toUpperCase());
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setFlash(null), 900);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [loadout]);

  useEffect(
    () => () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
      controller.dispose();
      resetCameraUi();
    },
    [controller],
  );

  // Test hook (?test=1): feed synthetic landmark timelines through the same controller. Grants no
  // authority — the frames become ordinary intents that the authority validates.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('test')) return;
    const w = window as unknown as Record<string, unknown>;
    let live: SyntheticCamera | null = null;
    w.__ffCamera = {
      status: () => useCamera.getState(),
      setStep: (s: Step) => setStep(s),
      // A live synthetic hand a closed-loop test player can move at any time; 'stop' ends it.
      drive: async (pose: HandPose | null | 'stop') => {
        const { SyntheticCamera } = await import('@ff/gestures/synthetic');
        if (pose === 'stop') {
          live?.stop();
          live = null;
          return;
        }
        live ??= new SyntheticCamera((f) => controller.feed(f), { fps: 15 });
        live.set(pose);
      },
      play: async (spec: TimelineSpec) => {
        const { timeline } = await import('@ff/gestures/synthetic');
        const frames = timeline({ ...spec, t0: performance.now() });
        // Paced in real time; each frame keeps its own capture time, so a busy page delays
        // frames but never squeezes the gesture's motion.
        for (const f of frames) {
          const wait = f.t - performance.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          controller.feed(f);
        }
      },
    };
    return () => {
      live?.stop();
      delete w.__ffCamera;
    };
  }, [controller]);

  // Mount the session's own <video> as the self-view (no second stream is opened).
  useEffect(() => {
    const host = previewRef.current;
    const video = sessionRef.current?.video;
    if (!host || !video) return;
    host.appendChild(video);
    return () => {
      if (video.parentElement === host) host.removeChild(video);
    };
  }, [step, cam.state, prefs.preview]);

  const start = async () => {
    sessionRef.current?.stop();
    const session = new CameraSession(
      { facingMode: prefs.facing, facingUser: true, pose: prefs.setup === 'stand' },
      {
        onFrame: (f) => controller.feed(f),
        onState: (state, error) => useCamera.setState({ state, error: error ?? null }),
        onStats: (stats) => useCamera.setState({ stats }),
      },
    );
    sessionRef.current = session;
    useCamera.setState({ error: null });
    setStep('frame');
    await session.start();
  };

  const giveUp = () => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    onFallback();
  };

  const error: CameraError | null = cam.error;
  const mirrored = prefs.facing === 'user';

  if (step === 'active') {
    return (
      <>
        <div
          className={`cam-chip ${cam.trackState ?? 'searching'}`}
          role="status"
          aria-live="polite"
          data-testid="camera-chip"
        >
          <span className="cam-dot" aria-hidden="true" />
          {error
            ? CAMERA_ERROR_TEXT[error]
            : paused
              ? 'Camera paused'
              : trackText(cam.trackState, cam.handsVisible, cam.stable)}
          {flash ? <b className="cam-last"> · {flash}</b> : null}
          {/* A long loss (S12) suggests the framing changed: offer to recalibrate. */}
          {!error && !paused && cam.longLost ? (
            <button
              className="cam-help-btn"
              onClick={() => {
                setReturnTo('active');
                setStep('calibrate');
              }}
              data-testid="camera-recalibrate"
            >
              Recalibrate
            </button>
          ) : null}
          <button className="cam-help-btn" onClick={() => setShowHelp((v) => !v)}>
            Gestures
          </button>
        </div>
        {prefs.preview ? (
          <div
            className={`cam-pip${mirrored ? ' mirrored' : ''}`}
            ref={previewRef}
            aria-label="Your camera (stays on this device)"
          />
        ) : null}
        {showHelp ? (
          <div className="cam-help panel" role="dialog" aria-label="Camera gestures">
            <div className="me-eyebrow">CAMERA GESTURES</div>
            <GestureHelp loadout={loadout} />
            <button className="btn" onClick={() => setShowHelp(false)}>
              Close
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="cam-fail panel" role="alertdialog" data-testid="camera-error">
            <p>{CAMERA_ERROR_TEXT[error]}</p>
            <div className="row">
              <button className="btn primary" onClick={() => void start()}>
                Retry camera
              </button>
              <button className="btn" onClick={giveUp} data-testid="camera-fallback">
                Use touch / keyboard
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="panel camera-setup" data-testid="camera-setup">
        <div className="me-eyebrow">
          CAMERA CONTROL · STEP {step === 'choose' ? 1 : step === 'frame' ? 2 : 3} OF 3
        </div>
        {error ? (
          <>
            <div className="me-title">Camera unavailable</div>
            <p className="form-error" data-testid="camera-error">
              {CAMERA_ERROR_TEXT[error]}
            </p>
            <div className="row">
              {error !== 'insecure' && error !== 'unsupported' ? (
                <button className="btn primary" onClick={() => void start()}>
                  Try again
                </button>
              ) : null}
              <button className="btn" onClick={giveUp} data-testid="camera-fallback">
                Play with touch / keyboard
              </button>
            </div>
          </>
        ) : step === 'choose' ? (
          <>
            <div className="me-title">Play with your hands</div>
            <p className="muted">
              Your camera stays on this device. Only game controls are shared — no video, images or
              hand data ever leave it.
            </p>
            <div className="cam-modes" role="radiogroup" aria-label="Camera setup">
              <button
                role="radio"
                aria-checked={prefs.setup === 'close'}
                className={`cam-mode${prefs.setup === 'close' ? ' on' : ''}`}
                onClick={() => setPrefs({ setup: 'close', facing: 'user' })}
              >
                <b>Close hands</b>
                <small>Seated, front camera sees one or both hands up close</small>
              </button>
              <button
                role="radio"
                aria-checked={prefs.setup === 'stand'}
                className={`cam-mode${prefs.setup === 'stand' ? ' on' : ''}`}
                onClick={() => setPrefs({ setup: 'stand' })}
              >
                <b>Camera stand</b>
                <small>Set the device down, step back so hands and shoulders are in view</small>
              </button>
            </div>
            {prefs.setup === 'stand' ? (
              <p className="muted cam-warn">
                Put the device down on a stand or table before you start — don’t hold it while
                playing with your hands.
              </p>
            ) : null}
            <div className="cam-opts">
              <label className="setting">
                <span>Playing hand</span>
                <select
                  value={prefs.dominant}
                  onChange={(e) =>
                    setPrefs({ dominant: e.target.value === 'left' ? 'left' : 'right' })
                  }
                >
                  <option value="right">Right</option>
                  <option value="left">Left</option>
                </select>
              </label>
              <label className="setting">
                <span>Camera</span>
                <select
                  value={prefs.facing}
                  onChange={(e) =>
                    setPrefs({ facing: e.target.value === 'environment' ? 'environment' : 'user' })
                  }
                >
                  <option value="user">Front (selfie / webcam)</option>
                  <option value="environment">Rear</option>
                </select>
              </label>
            </div>
            <div className="row">
              <button
                className="btn primary big"
                onClick={() => void start()}
                data-testid="camera-start"
              >
                Start camera
              </button>
              <button className="btn" onClick={giveUp} data-testid="camera-skip">
                Skip — touch / keyboard
              </button>
            </div>
          </>
        ) : step === 'frame' ? (
          <>
            <div className="me-title">Frame yourself</div>
            <div className={`cam-preview${mirrored ? ' mirrored' : ''}`} ref={previewRef}>
              <div className="cam-frame-guide" aria-hidden="true" />
            </div>
            <p className="muted" aria-live="polite" data-testid="camera-status">
              {cam.state === 'requesting'
                ? 'Waiting for camera permission…'
                : cam.state === 'loading'
                  ? 'Loading hand tracking (on this device)…'
                  : trackText(cam.trackState, cam.handsVisible, cam.stable)}
              {cam.fps !== null ? ` · ${cam.fps} fps` : ''}
            </p>
            <div className="row">
              <button
                className="btn primary"
                disabled={cam.state !== 'running'}
                onClick={() => {
                  setReturnTo('frame');
                  setStep('calibrate');
                }}
                data-testid="camera-next"
              >
                {prefs.calibration ? 'Recalibrate' : 'Calibrate'}
              </button>
              {prefs.calibration ? (
                <button
                  className="btn"
                  disabled={cam.state !== 'running'}
                  onClick={() => setStep('practice')}
                >
                  Use saved calibration
                </button>
              ) : null}
              <button className="btn" onClick={giveUp}>
                Use touch / keyboard
              </button>
            </div>
          </>
        ) : step === 'calibrate' ? (
          <>
            <div className="me-title">Calibrate</div>
            <div className={`cam-preview small${mirrored ? ' mirrored' : ''}`} ref={previewRef} />
            <p className="cam-hint" aria-live="polite">
              {cam.calibration?.hint ?? 'Hold an open palm still, where it feels comfortable'}
            </p>
            <div className="cam-progress" aria-hidden="true">
              <i style={{ width: `${Math.round((cam.calibration?.progress ?? 0) * 100)}%` }} />
            </div>
            {cam.calibration?.phase === 'failed' ? (
              <div className="row">
                <button className="btn primary" onClick={() => setStep('frame')}>
                  Check framing
                </button>
                <button className="btn" onClick={giveUp}>
                  Use touch / keyboard
                </button>
              </div>
            ) : (
              <p className="muted">{trackText(cam.trackState, cam.handsVisible, false)}</p>
            )}
            {/* Never a dead end, even if the camera stalls mid-calibration. */}
            <div className="row">
              <button className="btn" onClick={() => setStep(returnTo)} data-testid="camera-cancel">
                {returnTo === 'active' ? 'Back to the match' : 'Back'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="me-title">Practice</div>
            <div className={`cam-preview small${mirrored ? ' mirrored' : ''}`} ref={previewRef} />
            <ul className="cam-practice">
              <li className={cam.practiced.pulse ? 'done' : ''}>
                PULSE — push your open palm toward the camera
              </li>
              <li className={cam.practiced.guard ? 'done' : ''}>
                GUARD — turn your palm up and hold it
              </li>
            </ul>
            <GestureHelp loadout={loadout} />
            <div className="row">
              <button
                className="btn primary big"
                disabled={!(cam.practiced.pulse && cam.practiced.guard)}
                onClick={() => setStep('active')}
                data-testid="camera-play"
              >
                Play with camera
              </button>
              <button className="btn" onClick={() => setStep('active')}>
                Skip practice
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
