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
