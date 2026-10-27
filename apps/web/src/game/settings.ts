import { create } from 'zustand';
import type { QualityTier } from '../render/art-tokens';

export interface Settings {
  sound: boolean;
  volume: number;
  quality: QualityTier['name'] | 'auto';
  reducedMotion: boolean;
  reducedFlashes: boolean;
  devHud: boolean;
  hints: boolean;
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
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...defaults, ...parsed };
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
