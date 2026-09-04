// Integration: two clients in one room share the seed; the first ready player fixes the
// difficulty; a countdown starts everyone together; hints relay; a genuine run validates
// by replay and a lying one is flagged; standings arrive when every racer is done.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { MSG, COUNTDOWN_MS } from '../prototype/src/core/protocol.js';
import { World } from '../prototype/src/core/world.js';
import { normalizeSeed } from '../prototype/src/core/rng.js';

const PORT = 18080 + Math.floor(Math.random() * 1000);
const url = `http://localhost:${PORT}`;
const waitFor = (sock, ev, pred = () => true) => new Promise((res) => { const h = (m) => { if (pred(m)) { sock.off(ev, h); res(m); } }; sock.on(ev, h); });
const connect = (name, character) => { const s = io(url, { transports: ['websocket'] }); s.emit(MSG.JOIN, { room: 'test-road', name, character }); return s; };

test('a room: shared seed, ready → countdown, hints relayed, runs validated by replay, standings', async (t) => {
  const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('KITSUNE')) res(); }));
  t.after(() => server.kill());

  const a = connect('alpha', 'kitsune');
  const wa = await waitFor(a, MSG.WELCOME);
  assert.equal(wa.seed, normalizeSeed('test-road'), 'the room name is the seed'); assert.equal(wa.state, 'lobby');
  const b = connect('beta', 'tanuki');
  const wb = await waitFor(b, MSG.WELCOME);
  assert.equal(wb.seed, wa.seed); assert.equal(wb.players.length, 2);

  // ready: nothing starts until everyone is ready; the first ready player picks the difficulty
  const startA = waitFor(a, MSG.START), startB = waitFor(b, MSG.START);
  a.emit(MSG.READY, { ready: true, difficulty: 'hard' });
  const ps = await waitFor(b, MSG.PLAYERS, (m) => m.players.find(p => p.name === 'alpha')?.ready); assert.equal(ps.state, 'lobby'); assert.ok(!ps.players.find(p => p.name === 'beta').ready);
  b.emit(MSG.READY, { ready: true, difficulty: 'easy' });
  const [sa, sb] = await Promise.all([startA, startB]);
  assert.equal(sa.seed, sb.seed); assert.equal(sa.difficulty, 'hard'); assert.equal(sa.at, sb.at); assert.equal(sa.inMs, COUNTDOWN_MS);
  assert.ok(sa.players.every(p => p.inRace));

  // hints relay to the other laptop, never back to the sender
  a.emit(MSG.HINT, { z: 300, x: 4.2, y: 0.5, action: 'jump', alive: true, score: 540, storm: 28 });
  const h = await waitFor(b, MSG.HINT);
  assert.equal(h.id, a.id); assert.equal(h.z, 300); assert.equal(h.x, 4.2); assert.equal(h.action, 'jump'); assert.equal(h.score, 540);

  // a genuine run validates: the server replays the log with the room seed and difficulty
  const w = new World(wa.seed, { difficulty: 'hard', solo: true });
  for (let i = 0; i < 60 * 8 && w.alive; i++) { if (i % 40 === 0) w.input(1, { kind: 'jump' }); if (i % 90 === 0) w.input(1, { kind: 'lane', dir: i % 180 ? 1 : -1 }); w.step(); }
  const resA = waitFor(b, MSG.RESULT);
  a.emit(MSG.RUN_END, { log: w.log, summary: w.summary });
  const ra = await resA;
  assert.equal(ra.id, a.id); assert.equal(ra.valid, true, ra.reason); assert.equal(ra.distance, w.summary.distance); assert.equal(ra.score, w.summary.score);

  // a lying client is flagged; when every racer is done the standings arrive and the lobby reopens
  const standings = waitFor(a, MSG.STANDINGS), resB = waitFor(a, MSG.RESULT);
  b.emit(MSG.RUN_END, { log: w.log, summary: { ...w.summary, distance: w.summary.distance + 500 } });
  const rb = await resB; assert.equal(rb.id, b.id); assert.equal(rb.valid, false);
  const st = await standings;
  assert.equal(st.standings.length, 2); assert.equal(st.standings[0].id, a.id, 'sorted by distance');
  const back = await waitFor(b, MSG.PLAYERS, (m) => m.state === 'lobby'); assert.ok(back.players.every(p => !p.ready && !p.inRace));

  // leaving propagates
  b.disconnect();
  const leave = await waitFor(a, 'leave'); assert.equal(leave.id, rb.id);
  a.disconnect();
});
