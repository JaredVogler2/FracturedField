import * as v from 'valibot';
import { ABILITY_IDS, ADVANCED_ABILITIES } from '@ff/game-data';
import { INPUT_SOURCES, INTENT_PHASES } from './types.js';

/** Finite number within [min, max]; rejects NaN and ±Infinity. */
const bounded = (min: number, max: number) =>
  v.pipe(v.number(), v.finite(), v.minValue(min), v.maxValue(max));

const int = (min: number, max: number) =>
  v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));

export const MAX_SEQ = 2_147_483_647;

const unit = bounded(-1, 1);

export const ActionIntentSchema = v.strictObject({
  seq: int(0, MAX_SEQ),
  clientTime: bounded(-1e15, 1e15),
  action: v.picklist([...ABILITY_IDS, 'aim']),
  phase: v.picklist(INTENT_PHASES),
  aim: v.strictTuple([unit, unit]),
  dir: v.optional(v.strictTuple([unit, unit])),
  intensity: bounded(0, 1),
  modifier: v.optional(int(-8, 8)),
  source: v.picklist(INPUT_SOURCES),
  hand: v.optional(v.strictObject({ grip: bounded(0, 1), push: unit, twist: unit })),
});

const token = v.pipe(v.string(), v.maxLength(600), v.regex(/^[A-Za-z0-9_\-.]+$/));
const roomId = v.pipe(v.string(), v.regex(/^[a-f0-9]{32}$/));
const build = v.pipe(v.string(), v.maxLength(64), v.regex(/^[A-Za-z0-9_\-.+]*$/));

export const HelloSchema = v.strictObject({
  t: v.literal('hello'),
  protocol: int(0, 65535),
  sim: int(0, 65535),
  build,
  room: roomId,
  ticket: token,
});

export const ReadySchema = v.strictObject({
  t: v.literal('ready'),
  ready: v.boolean(),
  inputMode: v.picklist(INPUT_SOURCES),
  /** Advanced-move picks for the coming match (validated again by the authority). */
  loadout: v.optional(
    v.strictTuple([v.picklist(ADVANCED_ABILITIES), v.picklist(ADVANCED_ABILITIES)]),
  ),
});

export const IntentMessageSchema = v.strictObject({
  t: v.literal('intent'),
  i: ActionIntentSchema,
});

export const PingSchema = v.strictObject({
  t: v.literal('ping'),
  seq: int(0, MAX_SEQ),
  t0: bounded(-1e15, 1e15),
});

export const RematchSchema = v.strictObject({
  t: v.literal('rematch'),
  want: v.boolean(),
});

export const LeaveSchema = v.strictObject({
  t: v.literal('leave'),
});

export const ClientMessageSchema = v.variant('t', [
  HelloSchema,
  ReadySchema,
  IntentMessageSchema,
  PingSchema,
  RematchSchema,
  LeaveSchema,
]);

export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;
export type HelloMessage = v.InferOutput<typeof HelloSchema>;
export type ReadyMessage = v.InferOutput<typeof ReadySchema>;
export type IntentMessage = v.InferOutput<typeof IntentMessageSchema>;
export type PingMessage = v.InferOutput<typeof PingSchema>;
export type RematchMessage = v.InferOutput<typeof RematchSchema>;
export type LeaveMessage = v.InferOutput<typeof LeaveSchema>;
