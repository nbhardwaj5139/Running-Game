// Shared Nerve room server. Authoritative for: the tick clock, the shared Nerve
// meter, saccade scheduling/ordering, and post-run validation by replay.
// Also serves ../prototype as static files so `npm run dev` is the whole stack.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { MSG, TICK_RATE, SACCADE_LEAD_TICKS, NERVE_COST, NERVE_MAX, BLINK_SURGE_LAST, sanitizeCharge } from '../prototype/src/core/protocol.js';
import { normalizeSeed } from '../prototype/src/core/rng.js';
import { replay } from '../prototype/src/core/world.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(__dirname, '../prototype');
const PORT = process.env.PORT || 8080;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.normalize(path.join(STATIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(STATIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const io = new Server(httpServer, { cors: { origin: '*' } });

/** room name -> Room */
const rooms = new Map();
class Room {
  constructor(name) {
    this.name = name;
    this.seed = normalizeSeed(name);            // the room name *is* the seed: same link, same eye
    this.t0 = Date.now();
    this.nerve = 0;
    this.players = new Map();                   // socket.id -> { id, name, z, alive, lane }
    this.chargeWindow = new Map();              // id -> [timestamps] for rate limiting
  }
  tick() { return Math.floor((Date.now() - this.t0) / 1000 * TICK_RATE); }
  list() { return [...this.players.values()].map(p => ({ id: p.id, name: p.name, alive: p.alive, z: p.z })); }
  broadcast(ev, msg) { io.to(this.name).emit(ev, msg); }
  lastAlive() {
    let last = null;
    for (const p of this.players.values()) if (p.alive && (!last || p.z < last.z)) last = p;
    return last;
  }
}

io.on('connection', (socket) => {
  let room = null, me = null;

  socket.on(MSG.JOIN, ({ room: rn, name } = {}) => {
    rn = String(rn || 'lobby').slice(0, 32).replace(/[^\w-]/g, '') || 'lobby';
    room = rooms.get(rn) || rooms.set(rn, new Room(rn)).get(rn);
    me = { id: socket.id, name: String(name || 'floater').slice(0, 24), z: 0, y: 0, lane: 2, alive: true };
    room.players.set(socket.id, me);
    socket.join(rn);
    socket.emit(MSG.WELCOME, { id: socket.id, seed: room.seed, serverTick: room.tick(), players: room.list(), nerve: room.nerve });
    room.broadcast(MSG.PLAYERS, { players: room.list() });
    console.log(`[${rn}] ${me.name} joined (${room.players.size} in the eye)`);
  });

  socket.on(MSG.PING, (m) => socket.emit(MSG.PONG, { t: m?.t, serverTick: room ? room.tick() : 0 }));

  socket.on(MSG.HINT, (h) => {
    if (!room || !me) return;
    me.z = Number(h.z) || 0; me.lane = h.lane | 0; me.y = Number(h.y) || 0; me.alive = !!h.alive;
    socket.to(room.name).emit(MSG.HINT, { id: me.id, z: me.z, lane: me.lane, y: me.y, action: String(h.action || 'run').slice(0, 8) });
  });

  socket.on(MSG.NERVE_CHARGE, ({ amount } = {}) => {
    if (!room || !me || !me.alive) return;
    // rate limit: <= 20 charges / s per player
    const now = Date.now(); const win = (room.chargeWindow.get(me.id) || []).filter(t => now - t < 1000);
    if (win.length >= 20) return; win.push(now); room.chargeWindow.set(me.id, win);
    const n = sanitizeCharge(amount); if (!n) return;
    room.nerve = Math.min(NERVE_MAX, room.nerve + n);
    room.broadcast(MSG.NERVE, { value: room.nerve });
  });

  socket.on(MSG.SACCADE_REQUEST, ({ dir } = {}) => {
    if (!room || !me || !me.alive) return;
    dir = dir < 0 ? -1 : 1;
    if (room.nerve < NERVE_COST) return socket.emit(MSG.SACCADE_DENIED, { reason: 'nerve' });
    room.nerve -= NERVE_COST;
    const applyTick = room.tick() + SACCADE_LEAD_TICKS;
    room.broadcast(MSG.NERVE, { value: room.nerve });
    room.broadcast(MSG.SACCADE, { dir, applyTick, by: me.id });
    const last = room.lastAlive();
    if (last && last.id !== me.id) room.broadcast(MSG.BLINK_SURGE, { target: last.id, meters: BLINK_SURGE_LAST });
  });

  socket.on(MSG.DEATH, ({ z } = {}) => {
    if (!room || !me) return;
    me.alive = false; me.z = Number(z) || me.z;
    room.broadcast(MSG.DEATH, { id: me.id, z: me.z });
    room.broadcast(MSG.PLAYERS, { players: room.list() });
  });

  socket.on(MSG.RUN_END, ({ log, summary } = {}) => {
    if (!room || !me || !Array.isArray(log) || !summary) return;
    // Validate by replaying the pure sim. In Shared Nerve the saccades came from us, so the log
    // must contain them; a client that lies about distance/score is flagged, not banned (yet).
    try {
      const r = replay(room.seed, log.slice(0, 20000), 60 * 60 * 30, false);
      const ok = Math.abs(r.distance - summary.distance) <= Math.max(2, summary.distance * 0.01);
      console.log(`[${room.name}] ${me.name} run ${summary.distance} m / ${summary.score} pts → ${ok ? 'valid' : 'MISMATCH (' + r.distance + ' m)'}`);
    } catch (e) { console.log(`[${room.name}] replay failed for ${me.name}: ${e.message}`); }
  });

  socket.on('disconnect', () => {
    if (!room || !me) return;
    room.players.delete(me.id);
    room.broadcast('leave', { id: me.id });
    room.broadcast(MSG.PLAYERS, { players: room.list() });
    if (room.players.size === 0) rooms.delete(room.name);
  });
});

httpServer.listen(PORT, () => console.log(`VITREOUS  http://localhost:${PORT}/?room=lobby   (add &seed=… for solo)`));
