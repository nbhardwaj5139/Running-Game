// Wire protocol for Shared Nerve. Transport-agnostic (Socket.io in the prototype,
// Colyseus in production). Kept tiny on purpose: only events and 10 Hz hints.
export const TICK_RATE = 60;
export const SACCADE_LEAD_TICKS = 18;      // 300 ms scheduled into the future
export const HINT_HZ = 10;
export const NERVE_COST = 40;
export const NERVE_MAX = 100;
export const BLINK_SURGE_LAST = 6;         // metres taken from the last-place runner per saccade

export const MSG = {
  JOIN: 'join',                // C→S {room, name}
  WELCOME: 'welcome',          // S→C {id, seed, serverTick, players, nerve}
  PLAYERS: 'players',          // S→C {players:[{id,name}]}
  HINT: 'hint',                // C→S→C {id, z, lane, y, action}
  NERVE_CHARGE: 'nerve.charge',// C→S {amount, reason}
  NERVE: 'nerve',              // S→C {value}
  SACCADE_REQUEST: 'saccade.request', // C→S {dir}
  SACCADE: 'saccade',          // S→C {dir, applyTick, by}
  SACCADE_DENIED: 'saccade.denied',   // S→C {reason}
  BLINK_SURGE: 'blink.surge',  // S→C {target, meters}
  DEATH: 'death',              // C→S→C {id, z}
  RUN_END: 'run.end',          // C→S {log, summary}
  PING: 'ping', PONG: 'pong',  // {t}
};

/** Clamp/validate a client charge so a hacked client can't fill the meter. */
export function sanitizeCharge(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(30, Math.floor(n)));
}
