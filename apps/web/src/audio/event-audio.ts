import { useEffect } from 'react';
import { DEFAULT_RULES, MERIDIAN_ARENA } from '@ff/game-data';
import type { GameEvent, PlayerSlot } from '@ff/protocol';
import type { GameClient } from '../game/client';
import { useSettings } from '../game/settings';
import { sfx } from './sfx';

const panOf = (x: number) => x / MERIDIAN_ARENA.halfLength;

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
