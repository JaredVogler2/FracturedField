import { useEffect, useMemo, useRef, useState } from 'react';
import { isRoomCode, normalizeRoomCode } from '@ff/protocol';
import type { BotDifficulty } from '@ff/sim';
import { MatchView, type MatchMode } from './MatchView';
import { OnlinePanel } from './Online';
import { loadSeat, type StoredSeat } from '../net/seat-store';
import { useHistory } from '../game/history';
import { useSettings } from '../game/settings';
import { sfx } from '../audio/sfx';
import { keyLabel, P1_BINDINGS, P2_BINDINGS, type KeyBindings } from '../input/bindings';
import { Glyph } from './Glyph';
import { HandsSettings, RebindTable, TouchMotionSettings } from './controls/Rebind';

type Panel = null | 'controls' | 'settings' | 'online';

/**
 * Focuses a panel's close button on open without scrolling to it: long panels must open at the
 * top (where the title is), not at the button at the bottom.
 */
function useInitialFocus() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return ref;
}

function initialMode(): { mode: MatchMode; fast: boolean; seed?: number; joinCode?: string } {
  const params = new URLSearchParams(window.location.search);
  const fast = params.get('fast') === '1';
  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
  const seed = Number.isFinite(seedParam) ? seedParam : undefined;
  // ?room=CODE: a refresh resumes this tab's seat; otherwise it is an invite to join.
  const room = normalizeRoomCode(params.get('room') ?? '');
  if (isRoomCode(room)) {
    const seat = loadSeat(room);
    if (seat) return { mode: { kind: 'online', seat }, fast };
    return { mode: { kind: 'attract' }, fast, joinCode: room };
  }
  const m = params.get('mode');
  const extra = seed !== undefined ? { seed } : {};
  // The Hands Lab (ADR-0009): /lab/hands, or ?mode=lab.
  if (m === 'lab' || window.location.pathname.replace(/\/+$/, '') === '/lab/hands')
    return { mode: { kind: 'lab' }, fast: false, ...extra };
  if (m === 'duel') return { mode: { kind: 'duel' }, fast, ...extra };
  if (m === 'bot') {
    const d = params.get('difficulty');
    const difficulty: BotDifficulty = d === 'easy' || d === 'hard' ? d : 'normal';
    return { mode: { kind: 'bot', difficulty }, fast, ...extra };
  }
  return { mode: { kind: 'attract' }, fast };
}

/** Top-level product shell: live attract arena behind the menu, then matches. */
export function App() {
  const initial = useMemo(() => initialMode(), []);
  const [mode, setMode] = useState<MatchMode>(initial.mode);
  const [matchKey, setMatchKey] = useState(0);
  const [panel, setPanel] = useState<Panel>(initial.joinCode ? 'online' : null);
  const play = (m: MatchMode) => {
    sfx.unlock();
    sfx.play('ui');
    setMode(m);
    setMatchKey((k) => k + 1);
  };
  const toMenu = () => {
    setRoomParam(null);
    setMode({ kind: 'attract' });
    setMatchKey((k) => k + 1);
  };
  const goOnline = (seat: StoredSeat) => {
    setPanel(null);
    setRoomParam(seat.code);
    play({ kind: 'online', seat });
  };
  return (
    <>
      <MatchView
        key={matchKey}
        mode={mode}
        fast={initial.fast}
        {...(initial.seed !== undefined && matchKey === 0 ? { seed: initial.seed } : {})}
        onExit={toMenu}
        onOpenControls={() => setPanel('controls')}
      />
      {mode.kind === 'attract' ? <MainMenu onPlay={play} onPanel={setPanel} /> : null}
      {panel === 'controls' ? <ControlsPanel onClose={() => setPanel(null)} /> : null}
      {panel === 'settings' ? <SettingsPanel onClose={() => setPanel(null)} /> : null}
      {panel === 'online' ? (
        <OnlinePanel
          initialCode={initial.joinCode ?? ''}
          fast={initial.fast}
          onSeat={goOnline}
          onClose={() => {
            setRoomParam(null);
            setPanel(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Keeps `?room=CODE` in the address bar while in a room (refresh resumes the seat). */
function setRoomParam(code: string | null): void {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
}

function MainMenu({
  onPlay,
  onPanel,
}: {
  onPlay: (m: MatchMode) => void;
  onPanel: (p: Panel) => void;
}) {
  const [difficulty, setDifficulty] = useState<BotDifficulty>('normal');
  const records = useHistory((s) => s.records);
  return (
    <div className="menu" data-testid="main-menu">
      <div className="menu-card">
        <h1 className="title">
          FRACTURE <span>FIELD</span>
        </h1>
        <p className="tagline">Bend matter and energy. Drive the Rift Core into the rival gate.</p>
        <div className="col">
          <button
            className="btn primary big"
            data-testid="play-bot"
            onClick={() => onPlay({ kind: 'bot', difficulty })}
          >
            Quick match vs bot
          </button>
          <div className="seg" role="radiogroup" aria-label="Bot difficulty">
            {(['easy', 'normal', 'hard'] as const).map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={difficulty === d}
                className={difficulty === d ? 'on' : ''}
                onClick={() => setDifficulty(d)}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            className="btn big"
            data-testid="play-duel"
            onClick={() => onPlay({ kind: 'duel' })}
          >
            Local duel · 2 players, 1 keyboard
          </button>
          <button className="btn big" data-testid="play-online" onClick={() => onPanel('online')}>
            Online duel · 2 devices
          </button>
          <div className="row">
            <button className="btn" onClick={() => onPanel('controls')}>
              Controls
            </button>
            <button className="btn" onClick={() => onPanel('settings')}>
              Settings
            </button>
          </div>
        </div>
        {records.length > 0 ? (
          <div className="history">
            <div className="me-eyebrow">THIS SESSION</div>
            {records.slice(0, 5).map((r) => (
              <div key={r.id} className="history-row">
                <span>
                  {r.mode === 'duel' ? 'Duel' : r.mode === 'online' ? 'Online' : 'vs Bot'}
                </span>
                <span>
                  {r.winner === -1 ? 'Draw' : <Glyph slot={r.winner} size={14} />} {r.roundWins[0]}–
                  {r.roundWins[1]}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BindingTable({ title, b }: { title: string; b: KeyBindings }) {
  const rows: [string, readonly string[]][] = [
    [
      'Move',
      [...b.up.slice(0, 1), ...b.left.slice(0, 1), ...b.down.slice(0, 1), ...b.right.slice(0, 1)],
    ],
    ['Pulse (tap)', b.pulse],
    ['Lift (hold)', b.lift],
    ['Sweep ↑ / ↓', [...b.sweepUp.slice(0, 1), ...b.sweepDown.slice(0, 1)]],
    ['Guard', b.guard],
    ['Infuse wet / heat', [...b.infuseWet.slice(0, 1), ...b.infuseHeat.slice(0, 1)]],
    ['Pick 1 / Pick 2', [...b.adv1.slice(0, 1), ...b.adv2.slice(0, 1)]],
  ];
  return (
    <div className="binding-table">
      <div className="me-eyebrow">{title}</div>
      {rows.map(([name, keys]) => (
        <div key={name} className="binding-row">
          <span>{name}</span>
          <span>
            {keys.slice(0, 4).map((k) => (
              <kbd key={k}>{keyLabel(k)}</kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function ControlsPanel({ onClose }: { onClose: () => void }) {
  const closeRef = useInitialFocus();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel controls"
        role="dialog"
        aria-label="Controls"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="me-title">Controls</div>
        <p className="muted">
          Every input method produces the same capped actions — no device has a power advantage.
          Your force point moves at the same top speed for everyone.
        </p>
        <div className="binding-grid">
          <RebindTable />
          <BindingTable title="DUEL · PLAYER 1" b={P1_BINDINGS} />
          <BindingTable title="DUEL · PLAYER 2" b={P2_BINDINGS} />
        </div>
        <p className="muted">
          Mouse: point to aim · left click Pulse · right button hold Lift · wheel Sweep · middle
          click Guard. Esc / P pauses, M toggles sound.
        </p>
        <p className="muted">
          Touch: drag (or tap) on the arena to aim; thumb buttons cast; swipe the SWEEP pad in the
          wind’s direction. Motion: tilt the phone to aim, RECENTER re-zeroes. Game controller: left
          stick aims · A / RT Pulse · B Guard · X Wet · Y Heat · LB / RB picks · LT hold Lift ·
          D-pad Sweep · Start pauses.
        </p>
        <div className="me-eyebrow">ELEMENTS</div>
        <ul className="hints element-rules">
          <li>
            <b>Wet</b> soaks the ground into a pool: it slows rolling bodies and conducts charge.
          </li>
          <li>
            <b>Heat</b> sets a flame that drifts with any crosswind; it boils water into steam that
            floats the core.
          </li>
          <li>
            Picks — <b>Freeze</b> turns water into a slick ice ramp and cracks hot stone ·{' '}
            <b>Charge</b> jumps through water, steel and wet stone (overloads a wet guard) ·{' '}
            <b>Gravity</b> bends every flight path for a moment · <b>Magnet</b> (hold) drags the
            steel lodestones.
          </li>
        </ul>
        <button className="btn primary" onClick={onClose} ref={closeRef}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Camera-control preferences (applied live to an active camera seat). */
function CameraSettings() {
  const cam = useSettings((st) => st.camera);
  const patch = (p: Partial<typeof cam>) => {
    const st = useSettings.getState();
    st.set('camera', { ...st.camera, ...p });
  };
  return (
    <fieldset className="settings-group" data-testid="camera-settings">
      <legend>Camera control</legend>
      <label className="setting">
        <span>Playing hand</span>
        <select
          value={cam.dominant}
          onChange={(e) => patch({ dominant: e.target.value === 'left' ? 'left' : 'right' })}
        >
          <option value="right">Right</option>
          <option value="left">Left</option>
        </select>
      </label>
      <label className="setting">
        <span>Gesture sensitivity</span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.05}
          value={cam.sensitivity}
          aria-valuetext={`${Math.round(cam.sensitivity * 100)} %`}
          onChange={(e) => patch({ sensitivity: Number(e.target.value) })}
        />
      </label>
      <label className="setting">
        <span>Hold a sign for ({cam.dwellMs} ms)</span>
        <input
          type="range"
          min={180}
          max={600}
          step={20}
          value={cam.dwellMs}
          onChange={(e) => patch({ dwellMs: Number(e.target.value) })}
        />
      </label>
      <label className="setting">
        <span>Show my camera (stays on this device)</span>
        <input
          type="checkbox"
          checked={cam.preview}
          onChange={(e) => patch({ preview: e.target.checked })}
        />
      </label>
      <div className="setting">
        <span>{cam.calibration ? 'Calibration saved' : 'Not calibrated (default range)'}</span>
        <button
          className="btn small"
          disabled={!cam.calibration}
          onClick={() => patch({ calibration: null })}
        >
          Forget calibration
        </button>
      </div>
    </fieldset>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const doneRef = useInitialFocus();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel settings"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="me-title">Settings</div>
        <label className="setting">
          <span>Sound</span>
          <input
            type="checkbox"
            checked={s.sound}
            onChange={(e) => s.set('sound', e.target.checked)}
          />
        </label>
        <label className="setting">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volume}
            onChange={(e) => s.set('volume', Number(e.target.value))}
          />
        </label>
        <label className="setting">
          <span>Graphics quality</span>
          <select
            value={s.quality}
            onChange={(e) => s.set('quality', e.target.value as typeof s.quality)}
          >
            <option value="auto">Auto</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="setting">
          <span>Reduced motion (no camera shake)</span>
          <input
            type="checkbox"
            checked={s.reducedMotion}
            onChange={(e) => s.set('reducedMotion', e.target.checked)}
          />
        </label>
        <label className="setting">
          <span>Reduced flashes</span>
          <input
            type="checkbox"
            checked={s.reducedFlashes}
            onChange={(e) => s.set('reducedFlashes', e.target.checked)}
          />
        </label>
        <label className="setting">
          <span>Developer HUD</span>
          <input
            type="checkbox"
            checked={s.devHud}
            onChange={(e) => s.set('devHud', e.target.checked)}
          />
        </label>
        <HandsSettings />
        <TouchMotionSettings />
        <CameraSettings />
        <button className="btn primary" onClick={onClose} ref={doneRef}>
          Done
        </button>
      </div>
    </div>
  );
}
