/**
 * The Hands Lab panel (ADR-0009, milestone 06M-M3): pick a task, see what the game reads from your
 * hand, and keep your results on this device. Each task is judged only from the authority's
 * frames (hands-tasks.ts). Results hold task metrics only — never images or landmarks — and leave
 * the device only if the player exports them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEvent, HandState, InputSource } from '@ff/protocol';
import type { GameClient } from '../game/client';
import { useCamera } from '../input/camera/camera-store';
import { HANDS_TASKS, TaskJudge, type HandsTask, type TaskResult } from './hands-tasks';
import { setLabTask } from './lab-store';

export interface StoredResult extends TaskResult {
  /** The input that described the hand (camera, pointer, touch, gamepad…). */
  readonly input: InputSource | 'none';
  readonly at: string;
}

const STORE_KEY = 'ff-hands-lab-results';

function loadResults(): StoredResult[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredResult[]).slice(-200) : [];
  } catch {
    return [];
  }
}

function saveResults(list: readonly StoredResult[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    // Private mode or storage blocked: results stay in memory for this visit.
  }
}

/** One-line summary of a hand for the meters ("what the game sees"). */
function bar(v: number, signed: boolean): string {
  const pct = Math.round(Math.abs(v) * 100);
  return signed ? `${v < 0 ? '−' : v > 0 ? '+' : ''}${pct}%` : `${pct}%`;
}

export function HandsLabPanel({
  client,
  place,
  hand,
  source,
}: {
  client: GameClient;
  /** Puts a task's bodies where it starts. */
  place: (task: HandsTask) => void;
  /** The hand the seat describes right now (null: its input describes none). */
  hand: () => HandState | null;
  /** The seat's active input. */
  source: () => InputSource;
}) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<StoredResult[]>(loadResults);
  const [live, setLive] = useState<TaskResult | null>(null);
  const judge = useRef<TaskJudge | null>(null);
  const queue = useRef<GameEvent[]>([]);
  const meters = useRef<HTMLDListElement>(null);
  const task = HANDS_TASKS[index]!;

  const begin = useCallback(
    (t: HandsTask) => {
      setLabTask(t.id);
      place(t);
      queue.current.length = 0;
      judge.current = new TaskJudge(t);
      setLive(judge.current.result());
    },
    [place],
  );

  // Start (and restart) the selected task once the match is running. Placed any earlier, the task
  // was lost: the sim worker drops a placement before its world exists, which on a slow device is
  // still the case when Start is pressed (the first task then never set up).
  useEffect(() => {
    const t = HANDS_TASKS[index]!;
    let id = 0;
    const attempt = () => {
      if (client.buffer.latest?.match.phase === 'playing') begin(t);
      else id = window.setTimeout(attempt, 50);
    };
    id = window.setTimeout(attempt, 50);
    return () => window.clearTimeout(id);
  }, [index, begin, client]);

  useEffect(() => client.events.on((e) => queue.current.push(e)), [client]);
  useEffect(() => () => setLabTask(null), []);

  // Judge every frame; refresh the meters directly (no React render per frame).
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;
      const j = judge.current;
      const snap = client.buffer.latest;
      const tracking = useCamera.getState().track;
      if (j && snap) {
        if (source() === 'camera' && tracking && tracking.state !== 'tracking') j.addLost(dt);
        const events = queue.current.splice(0);
        if (j.update(snap, events)) {
          const r: StoredResult = {
            ...j.result(),
            input: source(),
            at: new Date().toISOString(),
          };
          setResults((list) => {
            const next = [...list, r];
            saveResults(next);
            return next;
          });
        }
      }
      if (now - lastUi > 100) {
        lastUi = now;
        if (j) setLive(j.result());
        const h = hand();
        const held = snap?.players[0].grasp ?? -1;
        const kind = held >= 0 ? (snap?.entities.find((e) => e.id === held)?.kind ?? '—') : '—';
        const el = meters.current;
        if (el) {
          el.dataset.grip = h ? h.grip.toFixed(2) : '';
          el.querySelector('[data-k=grip]')!.textContent = h ? bar(h.grip, false) : 'no hand';
          el.querySelector('[data-k=push]')!.textContent = h ? bar(h.push, true) : '—';
          el.querySelector('[data-k=twist]')!.textContent = h ? bar(h.twist, true) : '—';
          el.querySelector('[data-k=held]')!.textContent = kind;
          el.querySelector('[data-k=input]')!.textContent =
            source() === 'camera' && tracking ? `camera · ${tracking.state}` : source();
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [client, hand, source]);

  const exportResults = () => {
    const blob = new Blob(
      [JSON.stringify({ kind: 'fracture-field-hands-lab', version: 1, results }, null, 2)],
      { type: 'application/json' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hands-lab-results.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <aside className="hands-lab" data-testid="hands-lab" aria-label="Hands Lab">
      <h2>Hands Lab</h2>
      <div className="hands-lab-tasks" role="tablist">
        {HANDS_TASKS.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={i === index}
            data-testid={`lab-task-${t.id}`}
            className={results.some((r) => r.id === t.id && r.seconds !== null) ? 'done' : ''}
            onClick={() => setIndex(i)}
          >
            {t.title}
          </button>
        ))}
      </div>
      <p className="hands-lab-goal" data-testid="lab-goal">
        {task.goal}
      </p>
      <p className="hands-lab-status" data-testid="lab-status" aria-live="polite">
        {live?.seconds !== null && live?.seconds !== undefined
          ? `Done in ${live.seconds.toFixed(1)} s`
          : `Tries ${live?.attempts ?? 0}`}
      </p>
      <dl className="hands-lab-meters" ref={meters} data-testid="lab-meters">
        <dt>Grip</dt>
        <dd data-k="grip">—</dd>
        <dt>Push</dt>
        <dd data-k="push">—</dd>
        <dt>Twist</dt>
        <dd data-k="twist">—</dd>
        <dt>Holding</dt>
        <dd data-k="held">—</dd>
        <dt>Input</dt>
        <dd data-k="input">—</dd>
      </dl>
      <div className="hands-lab-actions">
        <button data-testid="lab-restart" onClick={() => begin(task)}>
          Restart task
        </button>
        <button data-testid="lab-export" onClick={exportResults} disabled={results.length === 0}>
          Export results ({results.length})
        </button>
      </div>
    </aside>
  );
}
