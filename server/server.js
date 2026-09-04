// KITSUNE room server: starts races, relays 10 Hz hints between laptops, validates
// every finished run by replaying its input log with the pure sim, and publishes
// standings. Also serves ../prototype as static files so `npm run dev` is the whole stack.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { MSG, COUNTDOWN_MS, MAX_LOG, COOP_SLOTS, COOP_MIN, cleanName, cleanRoom } from '../prototype/src/core/protocol.js';
import { normalizeSeed } from '../prototype/src/core/rng.js';
import { replay } from '../prototype/src/core/world.js';
import { DIFFICULTY } from '../prototype/src/core/chunks.js';

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
const io = new Server(httpServer, { cors: { origin: '*' }, maxHttpBufferSize: 4e6 });

/** room name -> Room */
const rooms = new Map();
class Room {
  constructor(name, coop = false) {
    this.name = name;
    this.coop = !!coop;                         // co-op: two laptops share one world (lockstep); race: one world each
    this.seed = normalizeSeed(name);            // the room name *is* the seed: same link, same road
    this.players = new Map();                   // socket.id -> { id, name, character, slot, ready, alive, z, score, done, inRace }
    this.state = 'lobby';                       // lobby | countdown | running
    this.difficulty = 'normal';
    this.god = false;
    this.seats = 2;                             // runners on the road, fixed at START
    this.startAt = 0;
    this.results = new Map();
  }
  list() { return [...this.players.values()].map(p => ({ id: p.id, name: p.name, character: p.character, slot: p.slot, ready: p.ready, alive: p.alive, z: p.z, score: p.score, done: p.done, inRace: p.inRace })); }
  /** Co-op seats are handed out lowest-free-first, so the seating is stable as people come and go. */
  freeSlot() { const taken = new Set([...this.players.values()].map(p => p.slot)); for (let s = 0; s < COOP_SLOTS; s++) if (!taken.has(s)) return s; return null; }
  get full() { return this.coop && this.players.size >= COOP_SLOTS; }
  broadcast(ev, msg) { io.to(this.name).emit(ev, msg); }
  players_() { this.broadcast(MSG.PLAYERS, { players: this.list(), state: this.state }); }
  /** Everyone present is ready → countdown → running. Late joiners spectate until the next race. */
  maybeStart() {
    if (this.state !== 'lobby') return;
    const ps = [...this.players.values()]; if (!ps.length || !ps.every(p => p.ready)) return;
    if (this.coop && ps.length < COOP_MIN) return;        // co-op needs at least two runners before the road can start
    this.state = 'countdown'; this.startAt = Date.now() + COUNTDOWN_MS; this.results.clear();
    // Compact the seating to 0..n-1 so the sim's runner indices and the room's slots agree
    // no matter who has come and gone; this is fixed for the whole run.
    if (this.coop) ps.sort((a, b) => a.slot - b.slot).forEach((p, i) => { p.slot = i; });
    for (const p of ps) Object.assign(p, { alive: true, done: false, inRace: true, z: 0, score: 0 });
    // Everything the shared sim depends on is fixed here and sent to every machine: the same
    // seed, difficulty, god mode AND seat count, or the worlds would not be the same world.
    const seats = this.seats = this.coop ? ps.length : 2;   // remembered: the replay must rebuild the same road
    for (const p of ps) io.to(p.id).emit(MSG.START, { at: this.startAt, inMs: COUNTDOWN_MS, seed: this.seed, difficulty: this.difficulty, god: this.god, coop: this.coop, slot: p.slot, seats, players: this.list() });
    setTimeout(() => { if (this.state === 'countdown') this.state = 'running'; }, COUNTDOWN_MS);
    console.log(`[${this.name}] ${this.coop ? 'co-op' : 'race'}: ${ps.map(p => p.name).join(this.coop ? ' + ' : ' vs ')} · ${this.difficulty}${this.god ? ' · god' : ''}`);
  }
  /** A run ended: publish its (validated) result; when every racer is done, publish standings and reopen the lobby. */
  finish(p, result) { p.done = true; p.ready = false; p.alive = false; this.results.set(p.id, result); this.broadcast(MSG.RESULT, result); this.settle(); }
  settle() {
    if (this.state === 'lobby') return;
    // Co-op is one run by two people: when either machine reports the shared world is over, the run is over.
    if (this.coop) { if (![...this.players.values()].some(p => p.inRace && p.done)) return; for (const p of this.players.values()) p.done = true; }
    else if ([...this.players.values()].some(p => p.inRace && !p.done)) return;
    this.state = 'lobby';
    for (const p of this.players.values()) p.inRace = false;
    this.broadcast(MSG.STANDINGS, { standings: [...this.results.values()].sort((a, b) => b.distance - a.distance || b.score - a.score) });
    this.players_();
  }
}

io.on('connection', (socket) => {
  let room = null, me = null;

  socket.on(MSG.JOIN, ({ room: rn, name, character, coop } = {}) => {
    rn = cleanRoom(rn);
    room = rooms.get(rn) || rooms.set(rn, new Room(rn, coop)).get(rn);
    const rejoining = room.players.has(socket.id);
    if (room.full && !rejoining) {                                  // a co-op road seats COOP_SLOTS runners
      socket.emit(MSG.WELCOME, { id: socket.id, room: rn, seed: room.seed, state: room.state, difficulty: room.difficulty, players: room.list(), serverNow: Date.now(), full: true, coop: room.coop });
      return console.log(`[${rn}] refused a runner: the co-op road is full (${COOP_SLOTS})`);
    }
    const slot = rejoining ? room.players.get(socket.id).slot : room.freeSlot();
    me = { id: socket.id, name: cleanName(name) || `runner-${socket.id.slice(0, 4)}`, character: String(character || 'kitsune').slice(0, 16), slot, ready: false, alive: false, z: 0, score: 0, done: false, inRace: false };
    room.players.set(socket.id, me);
    socket.join(rn);
    socket.emit(MSG.WELCOME, { id: socket.id, room: rn, seed: room.seed, state: room.state, difficulty: room.difficulty, players: room.list(), serverNow: Date.now(), coop: room.coop, slot });
    room.players_();
    console.log(`[${rn}] ${me.name} (${me.character}) joined${room.coop ? ` in seat ${slot + 1}` : ''} (${room.players.size} on the road)`);
  });

  socket.on(MSG.PING, (m) => socket.emit(MSG.PONG, { t: m?.t, serverNow: Date.now() }));

  socket.on(MSG.READY, ({ ready, difficulty, god } = {}) => {
    if (!room || !me || room.state !== 'lobby') return;
    me.ready = !!ready;
    if (me.ready && ![...room.players.values()].some(p => p.ready && p.id !== me.id)) {   // the first ready player picks, for both
      if (DIFFICULTY[difficulty]) room.difficulty = difficulty;
      room.god = !!god;
    }
    room.players_(); room.maybeStart();
  });

  // Co-op lockstep: relay the peer's input batch untouched and as fast as possible. The server
  // never simulates — it only carries inputs — so it can never be the thing that desyncs a run.
  socket.on(MSG.COOP, (b) => {
    if (!room || !me || !room.coop || !b) return;
    const inputs = Array.isArray(b.inputs) ? b.inputs.slice(0, 256) : [];
    socket.to(room.name).emit(MSG.COOP, { from: me.id, slot: me.slot, inputs, upTo: Number(b.upTo) || 0 });
  });

  socket.on(MSG.HINT, (h) => {
    if (!room || !me || !h) return;
    me.z = Number(h.z) || 0; me.score = Number(h.score) || 0; me.alive = !!h.alive;
    socket.to(room.name).emit(MSG.HINT, { id: me.id, z: me.z, x: Number(h.x) || 0, y: Number(h.y) || 0, action: String(h.action || 'run').slice(0, 8), alive: me.alive, score: me.score, storm: Number(h.storm) || 0 });
  });

  socket.on(MSG.DEATH, ({ z } = {}) => {
    if (!room || !me) return;
    me.alive = false; me.z = Number(z) || me.z;
    room.broadcast(MSG.DEATH, { id: me.id, z: me.z });
  });

  socket.on(MSG.RUN_END, ({ log, summary } = {}) => {
    if (!room || !me || me.done || !me.inRace) return;
    // Validate by replaying the pure sim with the room's seed and difficulty: the log is the run.
    let result = { id: me.id, name: me.name, character: me.character, distance: 0, score: 0, coins: 0, valid: false, reason: 'no log' };
    if (Array.isArray(log) && summary) {
      try {
        const maxTicks = Math.min(60 * 60 * 30, Number(summary.ticks) || 60 * 60 * 30);
        const r = replay(room.seed, log.slice(0, MAX_LOG), maxTicks, room.difficulty, room.coop ? { invincible: room.god, runners: room.seats ?? 2 } : { solo: true });
        const valid = Math.abs(r.distance - Number(summary.distance)) <= Math.max(3, r.distance * 0.01) && Math.abs(r.score - Number(summary.score)) <= Math.max(20, r.score * 0.02);
        result = { id: me.id, name: me.name, character: me.character, distance: r.distance, score: r.score, coins: r.coins, valid, reason: valid ? 'replay matched' : `claimed ${summary.distance} m / ${summary.score} pts, the replay says ${r.distance} m / ${r.score} pts` };
      } catch (e) { result.reason = 'replay failed: ' + e.message; }
    }
    if (room.coop) {   // one shared run: name it for everyone on it, and let any one machine report it
      result.name = [...room.players.values()].map(p => p.name).join(' + ');
      if (room.results.size) return;                                  // another machine already reported this run
    }
    console.log(`[${room.name}] ${result.name} ran ${result.distance} m / ${result.score} pts → ${result.valid ? 'valid' : 'INVALID (' + result.reason + ')'}`);
    room.finish(me, result);
  });

  socket.on('disconnect', () => {
    if (!room || !me) return;
    room.players.delete(me.id);
    // the seat matters: in co-op everyone else has to stop waiting on that slot's inputs
    room.broadcast('leave', { id: me.id, slot: me.slot, name: me.name });
    room.players_(); room.settle();
    if (room.players.size === 0) rooms.delete(room.name);
  });
});

httpServer.listen(PORT, () => {
  console.log(`KITSUNE  http://localhost:${PORT}/`);
  console.log(`  run together (your friend is the 2nd runner on your road):  http://<your-ip>:${PORT}/?coop=NAME`);
  console.log(`  race separately (own road each, rivals as ghosts):          http://<your-ip>:${PORT}/?room=NAME`);
  for (const [nic, addrs] of Object.entries(os.networkInterfaces())) for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`  this machine on the network: http://${a.address}:${PORT}/?coop=NAME   (${nic})`);
});
