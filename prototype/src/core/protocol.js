// Wire protocol for KITSUNE rooms. Transport-agnostic (Socket.io in the prototype).
// A room is a seed: everyone in it runs the same road. Two shapes of room:
//
//   race (?room=NAME) — every laptop runs its own sim; 10 Hz position hints draw the
//     rivals as ghosts, and each finished run is validated by replaying its input log.
//   co-op (?coop=NAME) — every laptop in the room shares ONE world: each player really is
//     another runner on the same road, same typhoon, able to barge. Only inputs cross the
//     wire (see core/lockstep.js); the sim is deterministic, so every machine runs it
//     identically. A machine may not step a tick until EVERY peer has covered it.
export const TICK_RATE = 60;
export const HINT_HZ = 10;
export const COUNTDOWN_MS = 3000;
export const MAX_LOG = 40000;              // inputs per run the server will replay

export const MSG = {
  JOIN: 'join',                // C→S {room, name, character}
  WELCOME: 'welcome',          // S→C {id, room, seed, state, difficulty, players, serverNow}
  PLAYERS: 'players',          // S→C {players:[{id, name, character, ready, alive, z, score, done, inRace}], state}
  READY: 'ready',              // C→S {ready, difficulty}   — the first ready player fixes the room's difficulty
  START: 'start',              // S→C {at (server ms), inMs, seed, difficulty, players}
  HINT: 'hint',                // C→S→C {id, z, x, y, action, alive, score, storm}
  DEATH: 'death',              // C→S→C {id, z}
  RUN_END: 'run.end',          // C→S {log, summary}
  RESULT: 'result',            // S→C {id, name, character, distance, score, coins, valid, reason}
  STANDINGS: 'standings',      // S→C {standings:[result…]}  — when every racer is done; the lobby reopens
  PING: 'ping', PONG: 'pong',  // {t} / {t, serverNow}
  COOP: 'coop.input',          // C→S→C {inputs:[{t, slot, seq, evt}], upTo, slot} — co-op lockstep batches
};

/**
 * How many runners a co-op road seats. Slots are handed out in join order and every
 * machine drives the slot the server gave it; the sim spreads the seats evenly across
 * the six lanes. Two is the classic pair; the lockstep itself has no upper bound, so
 * this is only the point at which the road stops having room to run.
 */
export const COOP_SLOTS = 8;
/** A road needs at least this many runners before it will start. */
export const COOP_MIN = 2;

export const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
export const cleanRoom = (s) => String(s || 'lobby').slice(0, 32).replace(/[^\w-]/g, '') || 'lobby';
