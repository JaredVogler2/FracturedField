import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ABILITY_IDS } from '@ff/game-data';
import {
  INPUT_SOURCES,
  INTENT_PHASES,
  PROTOCOL_VERSION,
  SIM_VERSION,
  checkCompatibility,
  decodeClientMessage,
  decodeServerMessage,
  isRoomCode,
  normalizeRoomCode,
  utf8Length,
} from '../src/index.js';

const MAX = 2048;
const intentFrame = (i: Record<string, unknown>) =>
  JSON.stringify({
    t: 'intent',
    i: {
      seq: 1,
      clientTime: 0,
      action: 'pulse',
      phase: 'tap',
      aim: [0.2, -0.4],
      intensity: 1,
      source: 'keyboard',
      ...i,
    },
  });

describe('client message validation', () => {
  it('accepts a well-formed intent', () => {
    const r = decodeClientMessage(intentFrame({}), MAX);
    expect(r.ok).toBe(true);
  });

  it.each([
    [
      'NaN aim',
      '{"t":"intent","i":{"seq":1,"clientTime":0,"action":"pulse","phase":"tap","aim":[NaN,0],"intensity":1,"source":"keyboard"}}',
    ],
    ['aim out of range', intentFrame({ aim: [1.5, 0] })],
    ['intensity above cap', intentFrame({ intensity: 9 })],
    ['negative seq', intentFrame({ seq: -1 })],
    ['fractional seq', intentFrame({ seq: 1.5 })],
    ['unknown ability', intentFrame({ action: 'teleport' })],
    ['unknown phase', intentFrame({ phase: 'charge' })],
    ['unknown input source', intentFrame({ source: 'aimbot' })],
    ['extra trusted field', intentFrame({ energy: 100 })],
    ['client-claimed position', intentFrame({ position: [1, 2, 3] })],
    ['modifier out of range', intentFrame({ modifier: 99 })],
  ])('rejects %s', (_label, frame) => {
    const r = decodeClientMessage(frame, MAX);
    expect(r.ok).toBe(false);
  });

  it('rejects forged server-only message types from clients', () => {
    for (const t of ['events', 'snap', 'welcome', 'matchEnd', 'ack']) {
      expect(decodeClientMessage(JSON.stringify({ t }), MAX).ok).toBe(false);
    }
  });

  it('rejects oversize, binary and malformed frames before parsing', () => {
    expect(decodeClientMessage('x'.repeat(MAX + 1), MAX)).toMatchObject({
      ok: false,
      error: 'too_large',
    });
    expect(decodeClientMessage(new ArrayBuffer(8), MAX)).toMatchObject({
      ok: false,
      error: 'binary',
    });
    expect(decodeClientMessage('{"t":', MAX)).toMatchObject({ ok: false, error: 'json' });
  });

  it('validates HELLO shape (room id, ticket charset, versions)', () => {
    const good = {
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      sim: SIM_VERSION,
      build: 'abc123',
      room: 'a'.repeat(32),
      ticket: 'abc.def',
    };
    expect(decodeClientMessage(JSON.stringify(good), MAX).ok).toBe(true);
    expect(decodeClientMessage(JSON.stringify({ ...good, room: 'not-a-room' }), MAX).ok).toBe(
      false,
    );
    expect(decodeClientMessage(JSON.stringify({ ...good, ticket: '<script>' }), MAX).ok).toBe(
      false,
    );
    expect(decodeClientMessage(JSON.stringify({ ...good, build: 'x'.repeat(100) }), MAX).ok).toBe(
      false,
    );
  });

  it('property: every structurally valid intent decodes', () => {
    const unit = fc.double({ min: -1, max: 1, noNaN: true });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000 }),
        fc.constantFrom(...ABILITY_IDS, 'aim'),
        fc.constantFrom(...INTENT_PHASES),
        unit,
        unit,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom(...INPUT_SOURCES),
        (seq, action, phase, ax, az, intensity, source) => {
          const frame = JSON.stringify({
            t: 'intent',
            i: { seq, clientTime: 1, action, phase, aim: [ax, az], intensity, source },
          });
          return decodeClientMessage(frame, MAX).ok;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('property: arbitrary garbage never throws and never decodes as an intent', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), (s) => {
        const r = decodeClientMessage(s, MAX);
        return !r.ok || r.msg.t !== 'intent' || typeof r.msg.i.seq === 'number';
      }),
      { numRuns: 1000 },
    );
  });
});

describe('versioning', () => {
  it('requires exact protocol and sim versions', () => {
    expect(checkCompatibility({ protocol: PROTOCOL_VERSION, sim: SIM_VERSION }).ok).toBe(true);
    expect(checkCompatibility({ protocol: PROTOCOL_VERSION + 1, sim: SIM_VERSION })).toMatchObject({
      ok: false,
      reason: 'protocol_mismatch',
    });
    expect(checkCompatibility({ protocol: PROTOCOL_VERSION, sim: SIM_VERSION + 1 })).toMatchObject({
      ok: false,
      reason: 'sim_mismatch',
    });
  });
});

describe('helpers', () => {
  it('counts UTF-8 bytes', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('🜂')).toBe(4);
  });

  it('normalizes and validates invite codes', () => {
    expect(normalizeRoomCode(' bcd-fgh ')).toBe('BCDFGH');
    expect(isRoomCode('BCDFGH')).toBe(true);
    expect(isRoomCode('BCDFG0')).toBe(false); // ambiguous characters excluded
    expect(isRoomCode('BCDF')).toBe(false);
  });

  it('client refuses unknown server frames without throwing', () => {
    expect(decodeServerMessage('{"t":"evil"}').ok).toBe(false);
    expect(decodeServerMessage('nope').ok).toBe(false);
    expect(decodeServerMessage('{"t":"pong","seq":1,"t0":0,"t1":1}').ok).toBe(true);
  });
});
