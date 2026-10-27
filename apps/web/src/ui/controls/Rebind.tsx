import { useEffect, useState } from 'react';
import { useSettings } from '../../game/settings';
import {
  BINDING_ACTIONS,
  SOLO_BINDINGS,
  applyOverride,
  isBindableKey,
  keyLabel,
  rebind,
  type BindingAction,
} from '../../input/bindings';

const LABEL: Record<BindingAction, string> = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  pulse: 'Pulse',
  lift: 'Lift (hold)',
  sweepUp: 'Sweep ↑',
  sweepDown: 'Sweep ↓',
  guard: 'Guard',
  infuseWet: 'Infuse wet',
  infuseHeat: 'Infuse heat',
  adv1: 'Pick 1',
  adv2: 'Pick 2',
};

/**
 * Solo keyboard layout editor: pick an action, press a key. A key already in use swaps with the
 * action's old key, so nothing is ever left unbound; changes apply immediately (also mid-match).
 */
export function RebindTable() {
  const override = useSettings((s) => s.bindings);
  const [listening, setListening] = useState<BindingAction | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const current = applyOverride(SOLO_BINDINGS, override);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      // Capture phase: the game, the pause menu and the browser don't see this key.
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setListening(null);
        setNote(null);
        return;
      }
      if (!isBindableKey(e.code)) {
        setNote(`${keyLabel(e.code)} is reserved — choose another key`);
        return;
      }
      const st = useSettings.getState();
      st.set('bindings', rebind(SOLO_BINDINGS, st.bindings, listening, e.code));
      setNote(null);
      setListening(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [listening]);

  return (
    <div className="rebind" data-testid="rebind">
      <div className="me-eyebrow">SOLO KEYBOARD (CHANGEABLE)</div>
      <div className="rebind-rows">
        {BINDING_ACTIONS.map((action) => (
          <div key={action} className="binding-row">
            <span>{LABEL[action]}</span>
            <span className="rebind-keys">
              {listening === action ? (
                <kbd className="listening">press a key…</kbd>
              ) : (
                current[action].slice(0, 3).map((k) => <kbd key={k}>{keyLabel(k)}</kbd>)
              )}
              <button
                className="btn small"
                onClick={() => {
                  setNote(null);
                  setListening(listening === action ? null : action);
                }}
                aria-label={`Change the key for ${LABEL[action]}`}
                data-testid={`rebind-${action}`}
              >
                {listening === action ? 'Cancel' : 'Change'}
              </button>
            </span>
          </div>
        ))}
      </div>
      <p className="muted" aria-live="polite">
        {note ??
          (listening
            ? `Press the new key for ${LABEL[listening]} (Esc cancels).`
            : 'A key that is already used swaps with the old one.')}
      </p>
      <button
        className="btn"
        disabled={Object.keys(override).length === 0}
        onClick={() => useSettings.getState().set('bindings', {})}
        data-testid="rebind-reset"
      >
        Reset keys
      </button>
    </div>
  );
}

/**
 * Hands-on control (ADR-0009): the camera grips, swings and throws by default (its sign scheme
 * stays selectable); the mouse, touch and a controller can play hands-on too.
 */
export function HandsSettings() {
  const c = useSettings((s) => s.controls);
  const patch = (p: Partial<typeof c>) => {
    const st = useSettings.getState();
    st.set('controls', { ...st.controls, ...p });
  };
  return (
    <fieldset className="settings-group" data-testid="hands-settings">
      <legend>Hands</legend>
      <label className="setting">
        <span>Camera control</span>
        <select
          value={c.cameraScheme}
          data-testid="camera-scheme"
          onChange={(e) => patch({ cameraScheme: e.target.value === 'signs' ? 'signs' : 'hands' })}
        >
          <option value="hands">Hands — grip, swing and throw</option>
          <option value="signs">Signs — hand signs cast moves</option>
        </select>
      </label>
      <label className="setting">
        <span>Mouse, touch and controller</span>
        <select
          value={c.handsOn ? 'hands' : 'moves'}
          data-testid="hands-on"
          onChange={(e) => patch({ handsOn: e.target.value === 'hands' })}
        >
          <option value="moves">Moves — click or tap to PULSE and LIFT</option>
          <option value="hands">Hands-on — hold to grip, let go to throw</option>
        </select>
      </label>
    </fieldset>
  );
}

/** Touch and motion preferences: thumb side, motion style and sensitivity, tap-to-toggle holds. */
export function TouchMotionSettings() {
  const c = useSettings((s) => s.controls);
  const patch = (p: Partial<typeof c>) => {
    const st = useSettings.getState();
    st.set('controls', { ...st.controls, ...p });
  };
  return (
    <fieldset className="settings-group" data-testid="touch-settings">
      <legend>Touch &amp; motion</legend>
      <label className="setting">
        <span>Ability buttons on the</span>
        <select
          value={c.hand}
          onChange={(e) => patch({ hand: e.target.value === 'left' ? 'left' : 'right' })}
        >
          <option value="right">Right (aim with the left thumb)</option>
          <option value="left">Left (aim with the right thumb)</option>
        </select>
      </label>
      <label className="setting">
        <span>Hold moves (Lift, Magnet)</span>
        <select
          value={c.sticky ? 'toggle' : 'hold'}
          onChange={(e) => patch({ sticky: e.target.value === 'toggle' })}
        >
          <option value="hold">Keep a finger on the button</option>
          <option value="toggle">Tap to start, tap to stop</option>
        </select>
      </label>
      <label className="setting">
        <span>Motion aiming</span>
        <select
          value={c.motionStyle}
          onChange={(e) => patch({ motionStyle: e.target.value === 'tilt' ? 'tilt' : 'pointer' })}
        >
          <option value="pointer">Turn the phone (point)</option>
          <option value="tilt">Tip the phone (tilt)</option>
        </select>
      </label>
      <label className="setting">
        <span>Motion sensitivity</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={c.motionSensitivity}
          aria-valuetext={`${Math.round(c.motionSensitivity * 100)} %`}
          onChange={(e) => patch({ motionSensitivity: Number(e.target.value) })}
        />
      </label>
    </fieldset>
  );
}
