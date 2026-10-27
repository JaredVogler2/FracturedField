/**
 * Local authority worker: runs the shared GameWorld (and any snapshot bots) at a fixed 30 Hz off
 * the render thread, emitting exactly the snapshot/event/ack stream a remote room would.
 */
import { DEFAULT_RULES, FAST_RULES, LAB_RULES, type AbilityId } from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';
import { GameWorld, SnapshotBot, physicsVersion } from '@ff/sim';
import type { FromSimWorker, ToSimWorker } from './sim-protocol';

/** Minimal dedicated-worker scope (avoids mixing the DOM and WebWorker lib typings). */
interface WorkerScope {
  postMessage(message: FromSimWorker): void;
  onmessage: ((ev: MessageEvent<ToSimWorker>) => void) | null;
  close(): void;
}
const scope = self as unknown as WorkerScope;

let world: GameWorld | null = null;
let bots: SnapshotBot[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let acc = 0;
let stepMs = 0;
let seed = 0;
/** Wall-clock speed of the simulation (test runs only; 1 everywhere else). */
let timeScale = 1;
/** The Hands Lab sandbox (task setup allowed). */
let lab = false;
let endAnnounced = false;
const ready: [boolean, boolean] = [false, false];
/** Picks that arrived with READY before physics finished loading. */
const pendingLoadouts: [readonly AbilityId[] | null, readonly AbilityId[] | null] = [null, null];
const rematch: [boolean, boolean] = [false, false];

function post(msg: FromSimWorker): void {
  scope.postMessage(msg);
}

async function init(msg: Extract<ToSimWorker, { type: 'init' }>): Promise<void> {
  seed = msg.seed;
  timeScale = Math.min(1, Math.max(0.25, msg.timeScale ?? 1));
  lab = msg.lab === true;
  world = await GameWorld.create({
    seed,
    autoStart: msg.autoStart,
    ...(lab ? { rules: LAB_RULES } : msg.fast ? { rules: FAST_RULES } : {}),
    ...(msg.loadouts ? { loadouts: msg.loadouts } : {}),
  });
  for (const slot of [0, 1] as const) {
    const picks = pendingLoadouts[slot];
    if (picks) world.setLoadout(slot, picks);
  }
  bots = msg.bots.map((b, i) => new SnapshotBot(b.slot, b.difficulty, seed + i + 1));
  for (const b of msg.bots) ready[b.slot] = true;
  if (lab) ready[1] = true; // the lab's second seat is empty
  endAnnounced = false;
  // READY may have arrived while physics was still loading: start now if everyone is ready.
  if (ready[0] && ready[1]) world.startMatch();
  post({ type: 'ready', seed, rapier: physicsVersion() });
  post({ type: 'frame', snapshot: world.snapshot(), events: [], acks: [], stepMs: 0 });
  last = performance.now();
  timer = setInterval(pump, 4);
}

function pump(): void {
  const w = world;
  if (!w) return;
  const now = performance.now();
  const dt = 1000 / DEFAULT_RULES.match.tickRate / timeScale;
  acc += Math.min(250, now - last);
  last = now;
  let steps = 0;
  while (acc >= dt && steps < 4) {
    acc -= dt;
    steps++;
    if (bots.length > 0) {
      const snap = w.snapshot();
      for (const bot of bots)
        for (const intent of bot.think(snap)) w.applyCommand(bot.slot, intent);
    }
    const t0 = performance.now();
    const r = w.stepFixed();
    stepMs = stepMs * 0.95 + (performance.now() - t0) * 0.05;
    post({ type: 'frame', snapshot: w.snapshot(), events: r.events, acks: r.results, stepMs });
    if (w.phase === 'matchEnd' && !endAnnounced) {
      endAnnounced = true;
      const s = w.matchSummary;
      post({
        type: 'matchEnd',
        end: {
          t: 'matchEnd',
          winner: s.winner ?? -1,
          score: s.score,
          roundWins: s.roundWins,
          seed,
          digest: w.outcomeDigest(),
          reason: 'complete',
        },
      });
      for (const b of bots) rematch[b.slot] = true;
    }
  }
  if (steps === 4 && acc > dt * 4) acc = 0; // throttled: drop backlog rather than fast-forward
}

/**
 * Hands Lab task setup: lets go of whatever the hand holds and puts the core (and the boulder
 * nearest `from`) at rest where the task starts. The lab is this device's own sandbox; matches
 * never accept it.
 */
function labPlace(msg: Extract<ToSimWorker, { type: 'labPlace' }>): void {
  const w = world;
  if (!w || !lab) return;
  w.debugReleaseGrasps();
  w.debugPlaceBody(w.coreEntityId, msg.core[0], LAB_RULES.core.hoverHeight, msg.core[1]);
  if (msg.boulder) {
    let best: { id: number; d: number } | null = null;
    for (const e of w.snapshot().entities) {
      if (e.kind !== 'boulder') continue;
      const d = Math.hypot(e.p[0] - msg.boulder.from[0], e.p[2] - msg.boulder.from[1]);
      if (!best || d < best.d) best = { id: e.id, d };
    }
    if (best) w.debugPlaceBody(best.id, msg.boulder.to[0], 0.75, msg.boulder.to[1]);
  }
}

function setReady(msg: Extract<ToSimWorker, { type: 'ready' }>): void {
  for (const l of msg.loadouts ?? []) {
    if (world) world.setLoadout(l.slot, l.picks);
    else pendingLoadouts[l.slot] = l.picks;
  }
  for (const s of msg.slots) ready[s] = true;
  if (ready[0] && ready[1]) world?.startMatch();
}

function requestRematch(slots: readonly PlayerSlot[]): void {
  for (const s of slots) rematch[s] = true;
  if (world && world.phase === 'matchEnd' && rematch[0] && rematch[1]) {
    rematch[0] = rematch[1] = false;
    endAnnounced = false;
    world.rematch();
  }
}

scope.onmessage = (ev: MessageEvent<ToSimWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      init(msg).catch((e: unknown) => post({ type: 'error', message: String(e) }));
      break;
    case 'intent':
      world?.applyCommand(msg.slot, msg.intent);
      break;
    case 'ready':
      setReady(msg);
      break;
    case 'labPlace':
      labPlace(msg);
      break;
    case 'rematch':
      requestRematch(msg.slots);
      break;
    case 'pause':
      world?.setPaused(msg.paused);
      break;
    case 'dispose':
      if (timer) clearInterval(timer);
      timer = null;
      world?.dispose();
      world = null;
      scope.close();
      break;
  }
};
