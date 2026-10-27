import { useEffect } from 'react';
import { DEFAULT_RULES, MERIDIAN_ARENA } from '@ff/game-data';
import type { GameEvent, PlayerSlot, ReactionKind } from '@ff/protocol';
import type { GameClient } from '../game/client';
import { useSettings } from '../game/settings';
import { sfx, type SfxName } from './sfx';

const panOf = (x: number) => x / MERIDIAN_ARENA.halfLength;

/** Reaction → sound. `shock` is covered by the discharge's own zap (one cue per cast). */
const REACTION_SFX: Partial<Record<ReactionKind, SfxName>> = {
  soak: 'soak',
  ignite: 'ignite',
  chill: 'chill',
  freeze: 'freeze',
  melt: 'melt',
  boil: 'boil',
  douse: 'douse',
  shatter: 'shatter',
  fracture: 'fracture',
  quench: 'quench',
  overload: 'overload',
  energize: 'energize',
  well: 'well',
};

function reactionLoudness(kind: ReactionKind, mag: number): number {
  switch (kind) {
    case 'shatter':
    case 'fracture':
      return Math.min(1, 0.4 + mag / 400); // impulse
    case 'soak':
    case 'freeze':
    case 'melt':
      return Math.min(1, 0.45 + mag * 0.6); // depth 0..1
    default:
      return 0.85;
  }
}

/** Maps authoritative events (never raw input) to sounds; denied local actions get a soft cue. */
export function useEventAudio(client: GameClient, localSlots: readonly PlayerSlot[]): void {
  const sound = useSettings((s) => s.sound);
  const volume = useSettings((s) => s.volume);
  useEffect(() => {
    sfx.enabled = sound;
    sfx.setVolume(volume);
  }, [sound, volume]);
  useEffect(() => {
    let lastCountdown = -1;
    const offEvents = client.events.on((e: GameEvent) => {
      switch (e.type) {
        case 'cast':
          if (e.ability === 'pulse') sfx.play('pulse', panOf(e.p[0]), 0.6 + 0.4 * e.mag);
          else if (e.ability === 'sweep') sfx.play('sweep', panOf(e.p[0]));
          else if (e.ability === 'guard') sfx.play('guard', panOf(e.p[0]));
          else if (e.ability === 'lift' && e.phase === 'start')
            sfx.play('liftStart', panOf(e.p[0]), 0.7);
          else if (e.ability === 'magnetize' && e.phase === 'start')
            sfx.play('magnet', panOf(e.p[0]), 0.8);
          // infuse / freeze / gravity are voiced by the reactions they cause.
          break;
        case 'reaction': {
          const name = REACTION_SFX[e.kind];
          if (name) sfx.play(name, panOf(e.p[0]), reactionLoudness(e.kind, e.mag));
          break;
        }
        case 'charge':
          sfx.play('zap', panOf(e.p[0]), Math.min(1, 0.5 + e.nodes.length * 0.08));
          break;
        case 'impact':
          sfx.play('impact', panOf(e.p[0]), Math.min(1, e.impulse / 250));
          break;
        case 'despawn':
          if (e.reason === 'broken') sfx.play('guardBreak', panOf(e.p[0]));
          break;
        case 'goal':
          sfx.play('goal', panOf(e.p[0]));
          break;
        case 'kickoff':
          sfx.play('kickoff');
          break;
        case 'roundEnd':
        case 'matchEnd':
          sfx.play('roundEnd');
          break;
        default:
          break;
      }
    });
    // Countdown beeps derived from the authoritative phase timer.
    const timer = setInterval(() => {
      const snap = client.buffer.latest;
      if (!snap || snap.match.phase !== 'countdown') return;
      const secs = Math.ceil(snap.match.phaseTicks / DEFAULT_RULES.match.tickRate);
      if (secs !== lastCountdown && secs > 0) {
        lastCountdown = secs;
        sfx.play('countdown');
      }
    }, 50);
    const offAcks = client.acks.on(({ slot, result }) => {
      if (
        !result.accepted &&
        localSlots.includes(slot) &&
        result.reason !== 'stale' &&
        result.reason !== 'rate_limited'
      ) {
        sfx.play('deny', 0, 0.6);
      }
    });
    return () => {
      offEvents();
      offAcks();
      clearInterval(timer);
    };
  }, [client, localSlots]);
}
