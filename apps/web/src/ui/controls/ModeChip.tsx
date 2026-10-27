import { useState } from 'react';
import type { Capabilities, ControlMode } from '../../input/capabilities';
import { ControlPicker, MODE_LABEL } from './ControlPicker';

/**
 * In-match control indicator: always shows the active mode and switches it in one tap (e.g. when
 * a sensor fails). The handover notice is keyed on the mode, so it replays on every change.
 */
export function ModeChip({
  caps,
  mode,
  onChange,
  cameraReady,
}: {
  caps: Capabilities;
  mode: ControlMode;
  onChange: (m: ControlMode) => void;
  cameraReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="mode-chip"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Controls: ${MODE_LABEL[mode]}. Change controls`}
        data-testid="mode-chip"
      >
        {MODE_LABEL[mode]} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="mode-menu panel" role="dialog" aria-label="Switch controls">
          <ControlPicker
            caps={caps}
            value={mode}
            cameraReady={cameraReady}
            compact
            onChange={(m) => {
              onChange(m);
              setOpen(false);
            }}
          />
        </div>
      ) : null}
      <div key={mode} className="handover-toast" role="status" data-testid="handover">
        Controls: {MODE_LABEL[mode]}
      </div>
    </>
  );
}
