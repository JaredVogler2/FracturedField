/** Close codes used on the room WebSocket (4000-4999 are application defined). */
export const CLOSE = {
  NORMAL: 1000,
  PROTOCOL: 4000,
  REPLACED: 4001,
  BAD_TICKET: 4003,
  TIMEOUT: 4008,
  ROOM_CLOSED: 4010,
  RATE: 4029,
} as const;
