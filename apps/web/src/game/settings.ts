import { create } from 'zustand';
import {
  ADVANCED_ABILITIES,
  DEFAULT_ABILITIES,
  DEFAULT_LOADOUT,
  type AdvancedAbilityId,
} from '@ff/game-data';
import type { Calibration } from '@ff/gestures';
import type { QualityTier } from '../render/art-tokens';
import type { ControlMode } from '../input/capabilities';
import {
  DEFAULT_BINDINGS_OVERRIDE,
  validBindingOverride,
  type BindingOverride,
} from '../input/bindings';

export interface Settings {
  sound: boolean;
  volume: number;
  quality: QualityTier['name'] | 'auto';
  reducedMotion: boolean;
  reducedFlashes: boolean;
  devHud: boolean;
  hints: boolean;
  /** Preferred advanced-move picks (used for every new match until changed). */
  loadout: [AdvancedAbilityId, AdvancedAbilityId];
  /** Player 2's picks in a shared-screen duel. */
  loadoutP2: [AdvancedAbilityId, AdvancedAbilityId];
  /** Camera control preferences (stored on this device only). */
  camera: CameraPrefs;
  /** How this device's player controls their seat (touch, motion, keyboard, simplified). */
  controls: ControlPrefs;
  /** Solo keyboard layout changes (per action; unset actions keep the defaults). */
  bindings: BindingOverride;
}

export interface ControlPrefs {
  /** Chosen control mode; null = the device's recommended default. */
  mode: ControlMode | null;
  /** Which thumb holds the ability buttons (the other aims). */
  hand: 'right' | 'left';
  /** Motion aiming: turn the phone (pointer) or tip it like a tray (tilt). */
  motionStyle: 'pointer' | 'tilt';
  /** 0.5 calm … 2 twitchy. */
  motionSensitivity: number;
  /** Hold moves (LIFT, MAGNET) toggle on tap instead of needing a held finger. */
  sticky: boolean;
  /**
   * Hands-on control (ADR-0009): the input describes a hand — grip to hold, swing and let go to
   * throw, twist to curve, an open hand sweeps and pushes — instead of firing discrete moves.
   */
  handsOn: boolean;
}

export const DEFAULT_CONTROLS: ControlPrefs = {
  mode: null,
  hand: 'right',
  motionStyle: 'pointer',
  motionSensitivity: 1,
  sticky: false,
  handsOn: false,
};

const CONTROL_MODES: readonly ControlMode[] = [
  'desktop',
  'touch',
  'motion',
  'camera',
  'accessible',
];

function validControls(v: unknown): ControlPrefs {
  if (typeof v !== 'object' || v === null) return { ...DEFAULT_CONTROLS };
  const c = v as Partial<ControlPrefs>;
  const sens = c.motionSensitivity;
  return {
    mode: CONTROL_MODES.includes(c.mode as ControlMode) ? (c.mode as ControlMode) : null,
    hand: c.hand === 'left' ? 'left' : 'right',
    motionStyle: c.motionStyle === 'tilt' ? 'tilt' : 'pointer',
    motionSensitivity:
      typeof sens === 'number' && Number.isFinite(sens) ? Math.min(2, Math.max(0.5, sens)) : 1,
    sticky: c.sticky === true,
    handsOn: c.handsOn === true,
  };
}

export interface CameraPrefs {
  /** Camera stand (upper body, device set down) or close-up hands (seated). */
  setup: 'stand' | 'close';
  /** Which physical camera to open. */
  facing: 'user' | 'environment';
  dominant: 'right' | 'left';
  /** 0.5 strict … 1.5 sensitive. */
  sensitivity: number;
  /** Hand-sign hold time before it casts (ms). */
  dwellMs: number;
  /** Small mirrored self-view in a corner during play. */
  preview: boolean;
  /** Last calibration (palm size and working range) — reused until recalibrated. */
  calibration: Calibration | null;
}

export const DEFAULT_CAMERA: CameraPrefs = {
  setup: 'close',
  facing: 'user',
  dominant: 'right',
  sensitivity: 1,
  dwellMs: 280,
  preview: false,
  calibration: null,
};

function validCamera(v: unknown): CameraPrefs {
  if (typeof v !== 'object' || v === null) return { ...DEFAULT_CAMERA };
  const c = v as Partial<CameraPrefs>;
  const num = (x: unknown, lo: number, hi: number, d: number) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  const cal = c.calibration;
  const calOk =
    cal &&
    typeof cal === 'object' &&
    typeof cal.range === 'object' &&
    [cal.range.x0, cal.range.x1, cal.range.y0, cal.range.y1].every(Number.isFinite) &&
    cal.range.x1 > cal.range.x0 &&
    cal.range.y1 > cal.range.y0;
  return {
    setup: c.setup === 'stand' ? 'stand' : 'close',
    facing: c.facing === 'environment' ? 'environment' : 'user',
    dominant: c.dominant === 'left' ? 'left' : 'right',
    sensitivity: num(c.sensitivity, 0.5, 1.5, 1),
    dwellMs: num(c.dwellMs, 180, 600, 280),
    preview: c.preview === true,
    calibration: calOk ? cal : null,
  };
}

/** Advanced moves that can currently be picked (implemented and enabled). */
export const PICKABLE: readonly AdvancedAbilityId[] = ADVANCED_ABILITIES.filter(
  (id) => DEFAULT_ABILITIES[id].available,
);

function validLoadout(v: unknown): v is [AdvancedAbilityId, AdvancedAbilityId] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v[0] !== v[1] &&
    v.every((x) => (PICKABLE as readonly unknown[]).includes(x))
  );
}

const KEY = 'ff.settings.v1';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function load(): Settings {
  const defaults: Settings = {
    sound: true,
    volume: 0.7,
    quality: 'auto',
    reducedMotion: prefersReducedMotion(),
    reducedFlashes: false,
    devHud: false,
    hints: true,
    loadout: [...DEFAULT_LOADOUT],
    loadoutP2: [...DEFAULT_LOADOUT],
    camera: { ...DEFAULT_CAMERA },
    controls: { ...DEFAULT_CONTROLS },
    bindings: { ...DEFAULT_BINDINGS_OVERRIDE },
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...defaults, ...parsed };
    if (!validLoadout(merged.loadout)) merged.loadout = [...DEFAULT_LOADOUT];
    if (!validLoadout(merged.loadoutP2)) merged.loadoutP2 = [...DEFAULT_LOADOUT];
    merged.camera = validCamera(merged.camera);
    merged.controls = validControls(merged.controls);
    merged.bindings = validBindingOverride(merged.bindings);
    return merged;
  } catch {
    return defaults;
  }
}

interface SettingsStore extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  set: (key, value) => {
    set({ [key]: value } as Partial<SettingsStore>);
    try {
      const st = get();
      const plain: Settings = {
        sound: st.sound,
        volume: st.volume,
        quality: st.quality,
        reducedMotion: st.reducedMotion,
        reducedFlashes: st.reducedFlashes,
        devHud: st.devHud,
        hints: st.hints,
        loadout: st.loadout,
        loadoutP2: st.loadoutP2,
        camera: st.camera,
        controls: st.controls,
        bindings: st.bindings,
      };
      localStorage.setItem(KEY, JSON.stringify(plain));
    } catch {
      // storage unavailable (private mode) — settings stay in memory for this session
    }
  },
}));

/** Resolves 'auto' to a concrete tier from coarse device signals (refined adaptively in 7B). */
export function resolveQuality(q: Settings['quality']): QualityTier['name'] {
  if (q !== 'auto') return q;
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const small =
    typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  if (coarse && (small || cores <= 4)) return 'low';
  if (coarse) return 'medium';
  return 'high';
}
