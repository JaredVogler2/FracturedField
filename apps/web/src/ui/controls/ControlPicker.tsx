import { useState } from 'react';
import {
  controlModes,
  type Capabilities,
  type ControlMode,
  type ModeOption,
} from '../../input/capabilities';
import { probeOrientation, requestMotionPermission } from '../../input/motion-controller';

/** Modes worth listing on this device: available ones, plus device-relevant ones that are not. */
function listed(caps: Capabilities): ModeOption[] {
  return controlModes(caps).filter(
    (o) =>
      o.available ||
      (o.mode === 'motion' && caps.touch) ||
      (o.mode === 'camera' && caps.camera === 'insecure'),
  );
}

export const MODE_LABEL: Record<ControlMode, string> = {
  desktop: 'Keyboard',
  touch: 'Touch',
  motion: 'Motion',
  camera: 'Camera',
  accessible: 'Simplified',
};

/**
 * Control mode choice for the local player. Motion asks for sensor access inside the tap (iOS
 * only prompts from a user gesture) and is accepted only once real readings arrive; a refusal or
 * a silent sensor keeps the current mode and says why. Never a dead end.
 */
export function ControlPicker({
  caps,
  value,
  onChange,
  cameraReady,
  disabled = false,
  compact = false,
}: {
  caps: Capabilities;
  value: ControlMode;
  onChange: (m: ControlMode) => void;
  cameraReady: boolean;
  disabled?: boolean;
  /** One-line chips (in-match switcher) instead of option cards. */
  compact?: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const choose = (o: ModeOption) => {
    if (!o.available || disabled) return;
    if (o.mode !== 'motion') {
      setNote(null);
      onChange(o.mode);
      return;
    }
    // Synchronously inside this tap: iOS shows its motion prompt only from a user gesture.
    const asked = requestMotionPermission();
    setChecking(true);
    setNote('Checking the motion sensor…');
    void asked.then(async (perm) => {
      if (perm !== 'granted') {
        setChecking(false);
        setNote(
          perm === 'denied'
            ? 'Motion access was not allowed. You can allow it in the browser’s site settings — touch works meanwhile.'
            : perm === 'insecure'
              ? 'Motion needs a secure (HTTPS) page.'
              : 'This browser has no motion sensor support.',
        );
        return;
      }
      const live = await probeOrientation(1500);
      setChecking(false);
      if (!live) {
        setNote('No motion readings from this device — staying on your current controls.');
        return;
      }
      setNote(null);
      onChange('motion');
    });
  };

  return (
    <div className={`control-picker${compact ? ' compact' : ''}`}>
      <div className="cp-options" role="radiogroup" aria-label="Your controls">
        {listed(caps).map((o) => (
          <button
            key={o.mode}
            role="radio"
            aria-checked={value === o.mode}
            className={`cp-option${value === o.mode ? ' on' : ''}`}
            disabled={disabled || !o.available || checking}
            onClick={() => choose(o)}
            data-testid={`controls-${o.mode}`}
            title={o.available ? o.detail : o.unavailable}
          >
            <b>
              {o.label}
              {o.mode === 'camera' && cameraReady ? ' ✓' : ''}
            </b>
            {compact ? null : <small>{o.available ? o.detail : o.unavailable}</small>}
          </button>
        ))}
      </div>
      {note ? (
        <p className="cp-note" role="status" aria-live="polite" data-testid="controls-note">
          {note}
        </p>
      ) : null}
    </div>
  );
}
