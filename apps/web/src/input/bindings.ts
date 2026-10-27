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
