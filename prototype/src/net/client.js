// Room client for KITSUNE: joins a room (the room name is the seed), readies up,
// takes the server's start signal, sends 10 Hz hints, keeps the rivals' last
// positions (extrapolated at their measured speed), and submits the input log
// at the end of a run for validation. Loads socket.io lazily from the dev server.
import { MSG, HINT_HZ, cleanRoom, cleanName } from '../core/protocol.js';

function loadSocketIo() {
  if (globalThis.io) return Promise.resolve(globalThis.io);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';               // served by server/server.js
    s.onload = () => res(globalThis.io); s.onerror = () => rej(new Error('socket.io client not reachable — run `npm run dev`'));
    document.head.appendChild(s);
  });
}

export class NetClient {
  /** on: { status, welcome, players, start, death, result, standings, leave } */
  constructor({ room, name, character, coop = false, on = {} }) {
    this.room = cleanRoom(room); this.name = cleanName(name); this.character = character; this.coop = !!coop; this.on = on;
    this.id = null; this.connected = false; this.offset = 0; this.rtt = 0; this.lastHint = 0;
    this.players = []; this.state = 'lobby'; this.difficulty = 'normal'; this.ghosts = new Map();
    this.slot = null; this.god = false;
  }

  async connect() {
    const io = await loadSocketIo();
    const s = this.socket = io({ transports: ['websocket'] });
    s.on('connect', () => { this.connected = true; s.emit(MSG.JOIN, { room: this.room, name: this.name, character: this.character, coop: this.coop }); this.on.status?.('connected'); });
    s.on('disconnect', () => { this.connected = false; this.on.status?.('offline'); });
    s.on(MSG.WELCOME, (m) => { this.id = m.id; this.state = m.state; this.difficulty = m.difficulty; this.players = m.players; this.slot = m.slot ?? null; if (m.full) this.on.full?.(m); this._syncClock(m.serverNow, performance.now()); this.on.welcome?.(m); this._ping(); clearInterval(this.pingTimer); this.pingTimer = setInterval(() => this._ping(), 4000); });
    s.on(MSG.PLAYERS, (m) => { this.players = m.players; if (m.state) this.state = m.state; this.on.players?.(m); });
    s.on(MSG.START, (m) => { this.state = 'countdown'; this.difficulty = m.difficulty; this.players = m.players; this.god = !!m.god; if (m.slot !== undefined) this.slot = m.slot; this.ghosts.clear(); this.on.start?.({ ...m, inMs: Math.max(0, m.at - this.serverNow()) }); });
    s.on(MSG.COOP, (m) => { if (m && m.from !== this.id) this.on.coop?.(m); });
    s.on(MSG.HINT, (m) => {
      if (m.id === this.id) return;
      const now = performance.now() / 1000, g = this.ghosts.get(m.id) || { id: m.id, z0: 0, v: 0, t: 0 };
      if (g.t) { const dt = now - g.t; if (dt > 0.02) g.v = Math.max(0, Math.min(70, (m.z - g.z0) / dt)); }
      Object.assign(g, { z0: m.z, x: m.x, y: m.y, action: m.action, alive: m.alive, score: m.score, storm: m.storm, t: now });
      this.ghosts.set(m.id, g);
    });
    s.on(MSG.DEATH, (m) => { const g = this.ghosts.get(m.id); if (g) g.alive = false; this.on.death?.(m); });
    s.on(MSG.RESULT, (m) => this.on.result?.(m));
    s.on(MSG.STANDINGS, (m) => { this.state = 'lobby'; this.on.standings?.(m); });
    // `leave` carries the seat that emptied, so co-op can stop waiting on that slot
    s.on('leave', (m) => { this.ghosts.delete(m.id); this.on.leave?.(m); });
    s.on(MSG.PONG, (m) => { const now = performance.now(); this.rtt = now - m.t; this._syncClock(m.serverNow, now - this.rtt / 2); });
  }

  _syncClock(serverNow, localAt) { this.offset = serverNow - localAt; }   // server ms ≈ performance.now() + offset
  serverNow() { return performance.now() + this.offset; }
  _ping() { this.socket?.emit(MSG.PING, { t: performance.now() }); }

  /** Change name or character: joining again with the same socket replaces the room's entry for us. */
  rejoin({ name = this.name, character = this.character } = {}) { this.name = cleanName(name); this.character = character; if (this.connected) this.socket.emit(MSG.JOIN, { room: this.room, name: this.name, character: this.character, coop: this.coop }); }
  /** Co-op: the other laptops. */
  get peer() { return this.players.find(p => p.id !== this.id) || null; }
  get peers() { return this.players.filter(p => p.id !== this.id); }
  /** Who is sitting in a co-op seat. */
  playerBySlot(slot) { return this.players.find(p => p.slot === slot) || null; }
  ready(ready, difficulty, god) { this.socket?.emit(MSG.READY, { ready, difficulty, god }); }
  /** Co-op: send a lockstep batch (inputs + the tick we promise to have covered). */
  coopSend(batch) { this.socket?.emit(MSG.COOP, batch); }
  /** Call every frame while running: sends a hint at HINT_HZ. */
  hint(now, w) {
    if (!this.connected || now - this.lastHint < 1000 / HINT_HZ) return;
    this.lastHint = now; const p = w.player;
    this.socket.emit(MSG.HINT, { z: +w.distance.toFixed(1), x: +p.xLane.toFixed(2), y: +p.y.toFixed(2), action: p.action, alive: w.alive, score: Math.floor(w.score), storm: +w.storm.toFixed(1) });
  }
  death(z) { this.socket?.emit(MSG.DEATH, { z }); }
  runEnd(log, summary) { this.socket?.emit(MSG.RUN_END, { log, summary }); }

  /** Where a rival is right now: its last hint, run forward at its measured speed (for at most half a second). */
  ghostZ(g, nowS) { return g.z0 + (g.alive ? g.v * Math.min(0.5, Math.max(0, nowS - g.t)) : 0); }
  get rivals() { return [...this.ghosts.values()]; }
  playerById(id) { return this.players.find(p => p.id === id); }
  get me() { return this.playerById(this.id); }
}
