/** Logical controls shared by every keyboard binding set (remappable, KeyboardEvent.code values). */
export interface KeyBindings {
  readonly up: readonly string[];
  readonly down: readonly string[];
  readonly left: readonly string[];
  readonly right: readonly string[];
  readonly pulse: readonly string[];
  readonly lift: readonly string[];
  readonly sweepUp: readonly string[];
  readonly sweepDown: readonly string[];
  readonly guard: readonly string[];
  /** INFUSE wet / heat. */
  readonly infuseWet: readonly string[];
  readonly infuseHeat: readonly string[];
  /** The two advanced moves of the seat's loadout (first and second pick). */
  readonly adv1: readonly string[];
  readonly adv2: readonly string[];
}

export type BindingAction = keyof KeyBindings;

/** Player 1 on a shared keyboard (left hand). */
export const P1_BINDINGS: KeyBindings = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  pulse: ['Space'],
  lift: ['ShiftLeft'],
  sweepUp: ['KeyQ'],
  sweepDown: ['KeyE'],
  guard: ['KeyF'],
  infuseWet: ['Digit1', 'KeyR'],
  infuseHeat: ['Digit2', 'KeyT'],
  adv1: ['Digit3', 'KeyC'],
  adv2: ['Digit4', 'KeyV'],
};

/** Player 2 on a shared keyboard (right hand): arrows or IJKL, abilities on the right cluster. */
export const P2_BINDINGS: KeyBindings = {
  up: ['ArrowUp', 'KeyI'],
  down: ['ArrowDown', 'KeyK'],
  left: ['ArrowLeft', 'KeyJ'],
  right: ['ArrowRight', 'KeyL'],
  pulse: ['Enter', 'NumpadEnter', 'Numpad0'],
  lift: ['ShiftRight', 'Numpad1'],
  sweepUp: ['Comma', 'Numpad4'],
  sweepDown: ['Period', 'Numpad6'],
  guard: ['Slash', 'Numpad5'],
  infuseWet: ['Digit7', 'Numpad7'],
  infuseHeat: ['Digit8', 'Numpad8'],
  adv1: ['Digit9', 'Numpad9'],
  adv2: ['Digit0', 'NumpadAdd'],
};

/** Solo play: both hands' layouts drive the single seat. */
export const SOLO_BINDINGS: KeyBindings = {
  up: [...P1_BINDINGS.up, 'ArrowUp'],
  down: [...P1_BINDINGS.down, 'ArrowDown'],
  left: [...P1_BINDINGS.left, 'ArrowLeft'],
  right: [...P1_BINDINGS.right, 'ArrowRight'],
  pulse: [...P1_BINDINGS.pulse, 'Enter', 'KeyJ'],
  lift: [...P1_BINDINGS.lift, 'ShiftRight', 'KeyK'],
  sweepUp: [...P1_BINDINGS.sweepUp, 'KeyU'],
  sweepDown: [...P1_BINDINGS.sweepDown, 'KeyO'],
  guard: [...P1_BINDINGS.guard, 'KeyL'],
  infuseWet: [...P1_BINDINGS.infuseWet, 'Digit7'],
  infuseHeat: [...P1_BINDINGS.infuseHeat, 'Digit8'],
  adv1: [...P1_BINDINGS.adv1, 'Digit9'],
  adv2: [...P1_BINDINGS.adv2, 'Digit0'],
};

/** Human-readable key label for the controls panel. */
export function keyLabel(code: string): string {
  const special: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    Enter: 'Enter',
    NumpadEnter: 'Num Enter',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  if (special[code]) return special[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** Player changes to the solo layout: per action, the full replacement key list. */
export type BindingOverride = Partial<Record<BindingAction, readonly string[]>>;

export const DEFAULT_BINDINGS_OVERRIDE: BindingOverride = {};

export const BINDING_ACTIONS: readonly BindingAction[] = [
  'up',
  'down',
  'left',
  'right',
  'pulse',
  'lift',
  'sweepUp',
  'sweepDown',
  'guard',
  'infuseWet',
  'infuseHeat',
  'adv1',
  'adv2',
];

/** Keys the player may not take over (menus and the browser need them). */
const RESERVED = new Set([
  'Escape',
  'KeyP',
  'KeyM',
  'Tab',
  'F5',
  'F11',
  'F12',
  'MetaLeft',
  'MetaRight',
]);

export const isBindableKey = (code: string): boolean =>
  /^[A-Za-z0-9]{2,24}$/.test(code) && !RESERVED.has(code);

/** Keeps only known actions with 1–3 valid key codes (stored data is never trusted). */
export function validBindingOverride(v: unknown): BindingOverride {
  if (typeof v !== 'object' || v === null) return {};
  const out: Partial<Record<BindingAction, readonly string[]>> = {};
  for (const action of BINDING_ACTIONS) {
    const codes = (v as Record<string, unknown>)[action];
    if (!Array.isArray(codes)) continue;
    const ok = codes.filter((c): c is string => typeof c === 'string' && isBindableKey(c));
    if (ok.length > 0) out[action] = [...new Set(ok)].slice(0, 3);
  }
  return out;
}

export function applyOverride(base: KeyBindings, o: BindingOverride): KeyBindings {
  const out = { ...base } as Record<BindingAction, readonly string[]>;
  for (const action of BINDING_ACTIONS) {
    const codes = o[action];
    if (codes && codes.length > 0) out[action] = codes;
  }
  // A key moved to another action must not keep firing its old one.
  for (const action of BINDING_ACTIONS) {
    if (o[action]) continue;
    out[action] = out[action].filter(
      (code) => !BINDING_ACTIONS.some((a) => a !== action && o[a]?.includes(code)),
    );
  }
  return out;
}

/**
 * Makes `code` the key for `action`. If another action used it, that action takes over this
 * action's previous primary key instead (a swap), so nothing is left unbound.
 */
export function rebind(
  base: KeyBindings,
  o: BindingOverride,
  action: BindingAction,
  code: string,
): BindingOverride {
  if (!isBindableKey(code)) return o;
  const current = applyOverride(base, o);
  const previous = current[action][0];
  const next: Partial<Record<BindingAction, readonly string[]>> = { ...o, [action]: [code] };
  for (const other of BINDING_ACTIONS) {
    if (other === action || !current[other].includes(code)) continue;
    const kept = current[other].filter((c) => c !== code);
    next[other] = kept.length > 0 ? kept : previous && previous !== code ? [previous] : [];
  }
  return next;
}
