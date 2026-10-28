import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { advance } from '@react-three/fiber';
import type { EntitySnapshot, WorldSnapshot } from '@ff/protocol';
import type { ScenarioFixture, VariantName } from '@ff/sim/scenario';
import { GameClient } from '../game/client';
import { GameClientProvider } from '../render/frame-context';
import { GameScene, type CameraOverride } from '../render/Scene';
import { LabController, LAB_FIXTURES, type LabState } from '../lab/lab-controller';
import { LabOverlays } from '../lab/LabOverlays';
import { renderStats } from '../render/render-stats';

const SPEEDS = [0.1, 0.25, 0.5, 1] as const;
const MATERIAL_KINDS = new Set(['core', 'boulder', 'lodestone', 'shard', 'guard']);

/** Where a fixture's action happens: mean of its scripted points, placements and water patches. */
function focusOf(fx: ScenarioFixture, variant: VariantName): [number, number] {
  const pts: [number, number][] = [];
  for (const s of [...fx.script, ...(fx.variants[variant].script ?? [])])
    pts.push('at' in s ? [s.at[0], s.at[1]] : [s.p[0], s.p[2]]);
  for (const p of fx.variants[variant].pools ?? []) pts.push([p.x, p.z]);
  if (pts.length === 0) return [0, 0];
  const x = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const z = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return [x, z];
}

function closeUp(fx: ScenarioFixture, variant: VariantName): CameraOverride {
  const [x, z] = focusOf(fx, variant);
  return { position: [x, 8.5, z + 12.5], target: [x, 0.8, z], fov: 42 };
}

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/** `view=px,py,pz,tx,ty,tz`: the close camera placed by hand (evidence captures of one spot). */
function viewParam(): CameraOverride | undefined {
  const v = params().get('view')?.split(',').map(Number);
  if (v?.length !== 6 || v.some((n) => !Number.isFinite(n))) return undefined;
  return { position: [v[0]!, v[1]!, v[2]!], target: [v[3]!, v[4]!, v[5]!], fov: 42 };
}

/**
 * Development Physics Lab (`/lab`): replays the D04 reaction fixtures through the real renderer
 * with step / pause / rewind, velocity and field overlays, impulse markers, the event sequence and
 * manual material toggles. A development tool — not a game mode — and it never talks to a room.
 *
 * URL: ?fx=R3&v=control&t=120&cam=close&vectors=0 (reproducible captures); with cam=close,
 * view=px,py,pz,tx,ty,tz places the camera by hand. frames=manual draws nothing on its own:
 * __ffLab.frame(ms) draws one frame ms of render time after the last, so an effect is caught at
 * an exact age however slowly the renderer draws.
 */
export function LabPage() {
  // Exact ticks: a paused lab never shows a moving body run ahead of the state it is at.
  const client = useMemo(() => new GameClient({ delayTicks: 1, extrapolate: false }), []);
  const lab = useMemo(() => new LabController(client), [client]);
  const state = useSyncExternalStore(lab.subscribe, lab.getState);
  const [vectors, setVectors] = useState(() => params().get('vectors') !== '0');
  const [regions, setRegions] = useState(() => params().get('regions') !== '0');
  const [impacts, setImpacts] = useState(() => params().get('impacts') !== '0');
  const [cam, setCam] = useState<'broadcast' | 'close'>(() =>
    params().get('cam') === 'close' ? 'close' : 'broadcast',
  );
  const quality = useMemo(() => {
    const q = params().get('quality');
    return q === 'low' || q === 'medium' || q === 'high' ? q : 'high';
  }, []);
  const frameloop = useMemo(() => (params().get('frames') === 'manual' ? 'never' : 'always'), []);

  useEffect(() => {
    const p = params();
    const fx = LAB_FIXTURES.find((f) => f.id === p.get('fx')) ?? LAB_FIXTURES[0]!;
    const variant: VariantName = p.get('v') === 'control' ? 'control' : 'reaction';
    const t = Number(p.get('t') ?? 0);
    void lab.load(fx, variant).then(async () => {
      if (t > 0) await lab.seek(t);
      if (p.has('play')) lab.play();
    });
    const w = window as unknown as Record<string, unknown>;
    // Render time of the last manual frame (s): frames=manual only.
    let renderAt = 0;
    if (p.has('test'))
      w.__ffLab = {
        state: () => lab.getState(),
        seek: (n: number) => lab.seek(n),
        spin: (v: number) => lab.setCoreSpin(v),
        step: () => lab.stepOnce(),
        frame: (ms: number) => {
          renderAt += ms / 1000;
          advance(renderAt);
        },
        // Totals of the frame before the last one drawn (all passes): draw frame(0) first to
        // read the last frame's own.
        stats: () => ({
          drawCalls: renderStats.drawCalls,
          triangles: renderStats.triangles,
          geometries: renderStats.geometries,
          textures: renderStats.textures,
          programs: renderStats.programs,
        }),
      };
    return () => {
      delete w.__ffLab;
      lab.dispose();
    };
  }, [lab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        lab.toggle();
      } else if (e.code === 'Period' || e.code === 'ArrowRight') lab.stepOnce();
      else if (e.code === 'Comma' || e.code === 'ArrowLeft')
        void lab.seek(Math.max(0, lab.getState().t - 1));
      else if (e.code === 'KeyR') void lab.restart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lab]);

  const view = useMemo(() => viewParam(), []);
  const camera = useMemo(
    () => (cam === 'close' ? (view ?? closeUp(state.fixture, state.variant)) : undefined),
    [cam, view, state.fixture, state.variant],
  );

  return (
    <GameClientProvider client={client}>
      <div className="lab" data-testid="lab">
        <div className="lab-stage">
          <GameScene quality={quality} frameloop={frameloop} {...(camera ? { camera } : {})}>
            <LabOverlays vectors={vectors} regions={regions} impacts={impacts} />
          </GameScene>
          <div className="lab-tick" aria-live="off" data-testid="lab-tick">
            {state.fixture.id} · {state.variant} · t {state.t}/{state.fixture.ticks}
            {state.modifiedAt !== null ? ' · MODIFIED' : ''}
          </div>
        </div>
        <aside className="lab-panel" aria-label="Physics Lab controls">
          <header className="lab-head">
            <div>
              <div className="me-eyebrow">PHYSICS LAB · DEVELOPMENT TOOL</div>
              <div className="lab-title">{state.fixture.title}</div>
            </div>
            <a className="btn" href="/">
              Game
            </a>
          </header>
          <ScenarioPicker lab={lab} state={state} />
          <Transport lab={lab} state={state} />
          <Checks state={state} />
          <section className="lab-section">
            <div className="me-eyebrow">OVERLAYS</div>
            <div className="lab-toggles">
              <Toggle label="Velocity" on={vectors} set={setVectors} />
              <Toggle label="Fields" on={regions} set={setRegions} />
              <Toggle label="Impulses" on={impacts} set={setImpacts} />
              <Toggle
                label="Close-up"
                on={cam === 'close'}
                set={(v) => setCam(v ? 'close' : 'broadcast')}
              />
            </div>
          </section>
          <Bodies lab={lab} snapshot={state.snapshot} />
          <EventLog state={state} />
        </aside>
      </div>
    </GameClientProvider>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`lab-chip${on ? ' on' : ''}`}
      aria-pressed={on}
      onClick={() => set(!on)}
    >
      {label}
    </button>
  );
}

function ScenarioPicker({ lab, state }: { lab: LabController; state: LabState }) {
  return (
    <section className="lab-section">
      <div className="lab-row">
        <select
          className="lab-select"
          aria-label="Reaction fixture"
          value={state.fixture.id}
          onChange={(e) => {
            const fx = LAB_FIXTURES.find((f) => f.id === e.target.value);
            if (fx) void lab.load(fx, state.variant);
          }}
          data-testid="lab-fixture"
        >
          {LAB_FIXTURES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id} — {f.title}
            </option>
          ))}
        </select>
      </div>
      <div className="seg" role="radiogroup" aria-label="Variant">
        {(['control', 'reaction'] as const).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={state.variant === v}
            className={state.variant === v ? 'on' : ''}
            onClick={() => void lab.load(state.fixture, v)}
            data-testid={`lab-variant-${v}`}
          >
            {v === 'control' ? 'Control (no cause)' : 'Reaction'}
          </button>
        ))}
      </div>
    </section>
  );
}

function Transport({ lab, state }: { lab: LabController; state: LabState }) {
  const disabled = state.loading;
  return (
    <section className="lab-section">
      <div className="lab-row lab-transport">
        <button
          className="btn"
          onClick={() => void lab.restart()}
          disabled={disabled}
          title="Restart (R)"
        >
          ⏮
        </button>
        <button
          className="btn"
          onClick={() => void lab.seek(Math.max(0, state.t - 30))}
          disabled={disabled}
          title="Back one second"
        >
          −1s
        </button>
        <button
          className="btn"
          onClick={() => void lab.seek(Math.max(0, state.t - 1))}
          disabled={disabled}
          title="Back one tick (,)"
          data-testid="lab-back"
        >
          ◀︎
        </button>
        <button
          className="btn primary"
          onClick={() => lab.toggle()}
          disabled={disabled || (state.done && !state.playing)}
          title="Play / pause (Space)"
          data-testid="lab-play"
        >
          {state.playing ? '❚❚' : '▶︎'}
        </button>
        <button
          className="btn"
          onClick={() => lab.stepOnce()}
          disabled={disabled || state.done}
          title="Step one tick (.)"
          data-testid="lab-step"
        >
          ▶︎|
        </button>
        <select
          className="lab-select small"
          aria-label="Playback speed"
          value={state.speed}
          onChange={(e) => lab.setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
      <input
        className="lab-scrub"
        type="range"
        min={0}
        max={state.fixture.ticks}
        value={state.t}
        disabled={disabled}
        aria-label="Timeline (ticks)"
        onChange={(e) => void lab.seek(Number(e.target.value))}
        data-testid="lab-scrub"
      />
      <div className="lab-meta">
        <span>
          tick {state.t} / {state.fixture.ticks} · {(state.t / 30).toFixed(2)} s
        </span>
        <span>
          P1 {Math.floor(state.energy[0])} · P2 {Math.floor(state.energy[1])} energy
        </span>
      </div>
    </section>
  );
}

function Checks({ state }: { state: LabState }) {
  const o = state.outcome;
  return (
    <section className="lab-section" data-testid="lab-checks">
      <div className="me-eyebrow">EXPECTED ({state.variant.toUpperCase()})</div>
      <ul className="lab-checks">
        {state.checks.map((c) => (
          <li key={c.label} className={c.pass === null ? 'pending' : c.pass ? 'pass' : 'fail'}>
            <span aria-hidden="true">{c.pass === null ? '…' : c.pass ? '✓' : '✗'}</span> {c.label}
          </li>
        ))}
      </ul>
      <div className="lab-meta">
        <span>
          {o.goal === null ? 'no goal yet' : `GOAL P${o.goal + 1} @ t ${o.goalTick}`} · core peak{' '}
          {o.maxCoreHeight.toFixed(2)} m{o.coreVeiled ? ' · veiled' : ''}
        </span>
      </div>
      {state.modifiedAt !== null ? (
        <p className="lab-warn">
          Material changed by hand at t {state.modifiedAt}: this timeline no longer matches the
          fixture. Rewind before t {state.modifiedAt} to restore it.
        </p>
      ) : null}
    </section>
  );
}

function fmtElement(e: EntitySnapshot): string {
  const parts: string[] = [];
  if (e.w !== undefined) parts.push(`wet ${e.w.toFixed(2)}`);
  if (e.h !== undefined) parts.push(`${e.h} °C`);
  if (e.c !== undefined) parts.push(`charge ${e.c.toFixed(2)}`);
  if (e.sh) parts.push('shocked');
  if (e.en) parts.push('energized');
  if (e.veil) parts.push('veiled');
  return parts.length > 0 ? parts.join(' · ') : 'neutral';
}

function Bodies({ lab, snapshot }: { lab: LabController; snapshot: WorldSnapshot | null }) {
  const bodies = (snapshot?.entities ?? []).filter((e) => MATERIAL_KINDS.has(e.kind));
  return (
    <section className="lab-section">
      <div className="me-eyebrow">MATERIAL STATE · TOGGLES</div>
      <ul className="lab-bodies">
        {bodies.map((e) => (
          <li key={e.id}>
            <div className="lab-body-head">
              <b>
                {e.kind} {e.id}
              </b>
              <span>{fmtElement(e)}</span>
            </div>
            <div className="lab-body-actions">
              <button className="lab-chip" onClick={() => lab.setMaterial(e.id, { wet: 1 })}>
                Soak
              </button>
              <button className="lab-chip" onClick={() => lab.setMaterial(e.id, { wet: 0 })}>
                Dry
              </button>
              <button className="lab-chip" onClick={() => lab.setMaterial(e.id, { temp: 160 })}>
                Heat
              </button>
              <button className="lab-chip" onClick={() => lab.setMaterial(e.id, { temp: -20 })}>
                Chill
              </button>
              <button
                className="lab-chip"
                onClick={() => lab.setMaterial(e.id, { shocked: !e.sh })}
              >
                {e.sh ? 'Unshock' : 'Shock'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventLog({ state }: { state: LabState }) {
  const recent = state.log.slice(-60);
  return (
    <section className="lab-section">
      <div className="me-eyebrow">EVENT SEQUENCE</div>
      <ol className="lab-log" data-testid="lab-log">
        {recent.map((l) => (
          <li key={`${l.id}-${l.t}`} className={`k-${l.kind}`}>
            <span className="lab-log-t">{l.t}</span> {l.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
