import { useMotion } from '../../input/motion-controller';

/**
 * Motion mode overlay: a big RECENTER button, a small tilt gauge (where the phone points relative
 * to its neutral pose), and the prompts for the states where aiming stops — back from the
 * background (recenter to resume) or a sensor that went quiet (recenter or switch to touch).
 */
export function MotionPanel({
  onRecenter,
  onUseTouch,
}: {
  onRecenter: () => void;
  onUseTouch: () => void;
}) {
  const state = useMotion((s) => s.state);
  const aim = useMotion((s) => s.aim);
  const recentered = useMotion((s) => s.recentered);
  const recenterButton = (
    <button className="btn primary" onClick={onRecenter} data-testid="motion-recenter-prompt">
      Recenter
    </button>
  );
  return (
    <>
      <div className="motion-gauge" aria-hidden="true">
        <i
          style={{
            transform: `translate(${(aim[0] * 22).toFixed(1)}px, ${(-aim[1] * 22).toFixed(1)}px)`,
          }}
        />
        {recentered ? <b key={recentered.at} /> : null}
      </div>
      <button
        className="motion-recenter"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRecenter();
        }}
        data-testid="motion-recenter"
      >
        RECENTER
      </button>
      {state === 'needs-recenter' ? (
        <div className="motion-prompt panel" role="alert" data-testid="motion-prompt">
          <p>Hold your phone comfortably, then tap Recenter to aim again.</p>
          <div className="row">{recenterButton}</div>
        </div>
      ) : state === 'stalled' ? (
        <div className="motion-prompt panel" role="alert" data-testid="motion-prompt">
          <p>The motion sensor stopped sending readings.</p>
          <div className="row">
            {recenterButton}
            <button className="btn" onClick={onUseTouch} data-testid="motion-use-touch">
              Use touch
            </button>
          </div>
        </div>
      ) : null}
      {recentered ? (
        <div key={recentered.at} className="motion-toast" role="status">
          {recentered.why === 'rotation'
            ? 'Recentered for the new screen orientation'
            : 'Recentered'}
        </div>
      ) : null}
    </>
  );
}
