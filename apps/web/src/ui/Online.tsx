import { useEffect, useState } from 'react';
import { DEFAULT_RULES, type AdvancedAbilityId } from '@ff/game-data';
import { normalizeRoomCode, type LobbySeat, type PlayerSlot } from '@ff/protocol';
import { useHud } from '../game/store';
import { checkRoomService, type RoomServiceHealth } from '../net/room-service';
import { RoomApiError, createRoom, joinRoom } from '../net/room-api';
import { seatFromGrant, saveSeat, type StoredSeat } from '../net/seat-store';
import { Glyph } from './Glyph';
import { LoadoutPicker, loadoutLabel } from './Loadout';
import { teamOf } from './teams';
import { ControlPicker } from './controls/ControlPicker';
import type { Capabilities, ControlMode } from '../input/capabilities';

export function inviteLink(code: string): string {
  return `${window.location.origin}/?room=${encodeURIComponent(code)}`;
}

/** Main-menu dialog: create a room (host) or join one with a code (guest). */
export function OnlinePanel({
  initialCode = '',
  fast = false,
  onSeat,
  onClose,
}: {
  initialCode?: string;
  /** Request short test rules (honoured by development room services only). */
  fast?: boolean;
  onSeat: (seat: StoredSeat) => void;
  onClose: () => void;
}) {
  const [health, setHealth] = useState<RoomServiceHealth | null>(null);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void checkRoomService().then((h) => {
      if (live) setHealth(h);
    });
    return () => {
      live = false;
    };
  }, []);

  const run = async (kind: 'create' | 'join') => {
    setBusy(kind);
    setError(null);
    try {
      const grant = kind === 'create' ? await createRoom({ fast }) : await joinRoom(code);
      const seat = seatFromGrant(grant);
      saveSeat(seat);
      onSeat(seat);
    } catch (e) {
      setError(e instanceof RoomApiError ? e.message : 'Something went wrong. Try again.');
      setBusy(null);
    }
  };

  const normalized = normalizeRoomCode(code);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel online"
        role="dialog"
        aria-label="Online duel"
        data-testid="online-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="me-eyebrow">ONLINE DUEL · TWO DEVICES</div>
        <div className="me-title">Play someone on another device</div>
        <p className="muted">
          The match runs on one authoritative server arena, so both of you see the same physics and
          the same score. Create a room and send the code or link to your rival.
        </p>
        <div
          className={`online-health ${health ? (health.ok ? 'ok' : 'bad') : ''}`}
          data-testid="room-service-health"
        >
          {health ? health.detail : 'Checking room service…'}
        </div>
        <div className="col">
          <button
            className="btn primary big"
            data-testid="create-room"
            disabled={busy !== null}
            onClick={() => void run('create')}
            autoFocus={!initialCode}
          >
            {busy === 'create' ? 'Creating…' : 'Create room'}
          </button>
          <form
            className="join-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (normalized.length === 6) void run('join');
            }}
          >
            <input
              className="code-input"
              aria-label="Room code"
              data-testid="room-code-input"
              placeholder="ROOM CODE"
              value={code}
              maxLength={9}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              autoFocus={!!initialCode}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
              className="btn"
              type="submit"
              data-testid="join-room"
              disabled={busy !== null || normalized.length !== 6}
            >
              {busy === 'join' ? 'Joining…' : 'Join'}
            </button>
          </form>
          {error ? (
            <div className="form-error" role="alert" data-testid="online-error">
              {error}
            </div>
          ) : null}
          <button className="btn" onClick={onClose}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

function SeatRow({ slot, you, seat }: { slot: PlayerSlot; you: boolean; seat: LobbySeat | null }) {
  const status = !seat?.occupied
    ? 'waiting for them to join…'
    : !seat.connected
      ? 'connecting…'
      : seat.ready
        ? 'ready'
        : 'not ready';
  return (
    <div
      className={`seat-row${seat?.ready ? ' ready' : ''}`}
      style={{ ['--team' as string]: teamOf(slot).color }}
      data-testid={`lobby-seat-${slot}`}
    >
      <Glyph slot={slot} size={20} />
      <span className="seat-name">
        {you ? 'You' : 'Rival'} · {teamOf(slot).name}
      </span>
      <span className="seat-status">{status}</span>
      {seat?.occupied && seat.loadout ? (
        <span className="seat-picks" data-testid={`lobby-picks-${slot}`}>
          {loadoutLabel(seat.loadout)}
        </span>
      ) : null}
    </div>
  );
}

/** Pre-match room screen: invite, seat status, controls choice and READY. */
export function OnlineLobby({
  seat,
  ready,
  caps,
  controlMode,
  onControlMode,
  onReady,
  onLeave,
  cameraReady,
  loadout,
  onLoadout,
}: {
  seat: StoredSeat;
  ready: boolean;
  caps: Capabilities;
  controlMode: ControlMode;
  onControlMode: (m: ControlMode) => void;
  onReady: (ready: boolean) => void;
  onLeave: () => void;
  /** Camera setup finished (READY needs it when the camera is chosen). */
  cameraReady: boolean;
  loadout: readonly [AdvancedAbilityId, AdvancedAbilityId];
  onLoadout: (next: [AdvancedAbilityId, AdvancedAbilityId]) => void;
}) {
  const lobby = useHud((s) => s.lobby);
  const transport = useHud((s) => s.transport);
  const [copied, setCopied] = useState(false);
  const mine = seat.slot;
  const other: PlayerSlot = mine === 0 ? 1 : 0;
  const rival = lobby?.seats[other] ?? null;
  const connected = transport.state === 'connected';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(seat.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const share = () => {
    void navigator
      .share?.({
        title: 'FRACTURE FIELD duel',
        text: `Join my arena: ${seat.code}`,
        url: inviteLink(seat.code),
      })
      .catch(() => undefined);
  };

  const hint = !connected
    ? 'Connecting to the arena…'
    : !rival?.occupied
      ? 'Send the code or link to your rival. The match starts when you are both ready.'
      : !rival.connected
        ? 'Your rival is connecting…'
        : ready && !rival.ready
          ? 'Waiting for your rival to get ready…'
          : !ready
            ? 'Press Ready when you are set.'
            : 'Starting…';

  return (
    <div className="modal-backdrop soft">
      <div className="panel lobby" data-testid="online-lobby">
        <div className="me-eyebrow">ONLINE DUEL · ROOM</div>
        <div className="room-code" data-testid="room-code" aria-label={`Room code ${seat.code}`}>
          {seat.code}
        </div>
        <div className="row">
          <button className="btn" onClick={() => void copy()} data-testid="copy-invite">
            {copied ? 'Link copied' : 'Copy invite link'}
          </button>
          {typeof navigator.share === 'function' ? (
            <button className="btn" onClick={share}>
              Share…
            </button>
          ) : null}
        </div>
        <div className="seats">
          <SeatRow slot={mine} you seat={lobby?.seats[mine] ?? null} />
          <SeatRow slot={other} you={false} seat={rival} />
        </div>
        <ControlPicker
          caps={caps}
          value={controlMode}
          onChange={onControlMode}
          cameraReady={cameraReady}
          disabled={ready}
          compact
        />
        <LoadoutPicker value={loadout} onChange={onLoadout} disabled={ready} />
        <p className="muted" data-testid="lobby-hint" aria-live="polite">
          {hint}
        </p>
        <div className="row">
          <button
            className="btn primary big"
            data-testid="ready"
            disabled={!connected || (!ready && controlMode === 'camera' && !cameraReady)}
            onClick={() => onReady(!ready)}
          >
            {ready ? 'Not ready' : 'Ready'}
          </button>
          <button className="btn" onClick={onLeave} data-testid="leave-room">
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}

/** Connection problems during an online match: own reconnect, rival away, or gave up. */
export function NetStatusOverlay({
  mySlot,
  onRetry,
  onLeave,
}: {
  mySlot: PlayerSlot;
  onRetry: () => void;
  onLeave: () => void;
}) {
  const transport = useHud((s) => s.transport);
  const pause = useHud((s) => s.pause);
  const matchEnd = useHud((s) => s.matchEnd);
  if (transport.kind !== 'remote' || matchEnd) return null;
  if (transport.state === 'error') {
    const replaced = /replaced/i.test(transport.detail ?? '');
    return (
      <div className="modal-backdrop">
        <div className="panel net-status" role="alertdialog" data-testid="net-failed">
          <div className="me-eyebrow">CONNECTION</div>
          <div className="me-title">{replaced ? 'Opened elsewhere' : 'Disconnected'}</div>
          <p className="muted">
            {replaced
              ? 'This seat was opened in another tab or window, which now controls it.'
              : (transport.detail ?? 'The connection to the arena was lost.')}
          </p>
          <div className="row">
            {!replaced ? (
              <button className="btn primary" onClick={onRetry} data-testid="net-retry">
                Try again
              </button>
            ) : null}
            <button className="btn" onClick={onLeave}>
              Main menu
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (transport.state === 'reconnecting') {
    return (
      <div className="net-toast" role="status" data-testid="net-reconnecting">
        <span className="spinner" aria-hidden="true" /> Connection lost — reconnecting…
      </div>
    );
  }
  if (pause && pause.reason === 'disconnect' && pause.slot !== mySlot) {
    const seconds = Math.max(0, Math.ceil(pause.graceTicks / DEFAULT_RULES.match.tickRate));
    return (
      <div className="net-toast" role="status" data-testid="rival-away">
        Rival disconnected — match paused. They have {seconds}s to return.
      </div>
    );
  }
  return null;
}
