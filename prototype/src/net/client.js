// Shared Nerve client: tick sync, hints, saccade scheduling. Loads socket.io lazily.
import { MSG, SACCADE_LEAD_TICKS, HINT_HZ, TICK_RATE } from '../core/protocol.js';

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
  constructor({ room, name, onWelcome, onPlayers, onHint, onNerve, onSaccade, onDenied, onSurge, onDeath, onLeave, onStatus }) {
    Object.assign(this, { room, name, onWelcome, onPlayers, onHint, onNerve, onSaccade, onDenied, onSurge, onDeath, onLeave, onStatus });
    this.id = null; this.rtt = 0; this.world = null; this.lastHint = 0; this.connected = false;
    this.serverTickBase = 0; this.baseTime = performance.now();   // server tick <-> wall clock (not sim ticks: the sim can pause)
  }

  async connect() {
    const io = await loadSocketIo();
    this.socket = io({ transports: ['websocket'] });
    const s = this.socket;
    s.on('connect', () => { this.connected = true; s.emit(MSG.JOIN, { room: this.room, name: this.name }); this.onStatus?.('connected'); });
    s.on('disconnect', () => { this.connected = false; this.onStatus?.('offline'); });
    s.on(MSG.WELCOME, (m) => { this.id = m.id; this._sync(m.serverTick); this.onWelcome?.(m); this._ping(); setInterval(() => this._ping(), 5000); });
    s.on(MSG.PLAYERS, (m) => this.onPlayers?.(m));
    s.on(MSG.HINT, (m) => { if (m.id !== this.id) this.onHint?.(m); });
    s.on(MSG.NERVE, (m) => this.onNerve?.(m.value));
    s.on(MSG.SACCADE, (m) => this.onSaccade?.(m.dir, this.toLocalTick(m.applyTick), m.by));
    s.on(MSG.SACCADE_DENIED, (m) => this.onDenied?.(m.reason));
    s.on(MSG.BLINK_SURGE, (m) => this.onSurge?.(m));
    s.on(MSG.DEATH, (m) => this.onDeath?.(m));
    s.on('leave', (m) => this.onLeave?.(m));
    s.on(MSG.PONG, (m) => { this.rtt = performance.now() - m.t; this._sync(m.serverTick + Math.round((this.rtt / 2) / 1000 * TICK_RATE)); });
  }

  attach(world) { this.world = world; }
  _sync(serverTick) { this.serverTickBase = serverTick; this.baseTime = performance.now(); }
  /** Best estimate of the server's tick right now. */
  serverTickNow() { return this.serverTickBase + (performance.now() - this.baseTime) / 1000 * TICK_RATE; }
  /** A server tick expressed as a local *sim* tick: "this many ticks from now" — robust to a paused or slow sim. */
  toLocalTick(serverTick) { return this.world ? this.world.tick + Math.round(serverTick - this.serverTickNow()) : 0; }
  _ping() { this.socket.emit(MSG.PING, { t: performance.now() }); }

  /** Called every frame; sends a hint at HINT_HZ. */
  update(now) {
    if (!this.connected || !this.world) return;
    if (now - this.lastHint >= 1000 / HINT_HZ) {
      const p = this.world.player;
      this.socket.emit(MSG.HINT, { z: +p.z.toFixed(1), lane: p.viewLane + this.world.window, y: +p.y.toFixed(2), action: p.action, alive: p.alive });
      this.lastHint = now;
    }
  }
  charge(amount, reason) { this.socket?.emit(MSG.NERVE_CHARGE, { amount, reason }); }
  requestSaccade(dir) { this.socket?.emit(MSG.SACCADE_REQUEST, { dir }); }
  death(z) { this.socket?.emit(MSG.DEATH, { z }); }
  runEnd(log, summary) { this.socket?.emit(MSG.RUN_END, { log, summary }); }
}

export { SACCADE_LEAD_TICKS };
