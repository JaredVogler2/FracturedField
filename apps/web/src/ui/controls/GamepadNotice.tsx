import { useGamepad } from '../../input/gamepad';

/** Short connect / disconnect notice for game controllers (keyed, so each event replays it). */
export function GamepadNotice() {
  const notice = useGamepad((s) => s.notice);
  if (!notice) return null;
  return (
    <div key={notice.at} className="pad-toast" role="status" data-testid="gamepad-notice">
      {notice.text}
    </div>
  );
}
