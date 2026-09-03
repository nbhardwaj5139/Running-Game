// Integration: two clients in one room share the Nerve; a saccade is scheduled
// in the future and the last-place runner eats a Blink surge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { MSG, NERVE_COST, SACCADE_LEAD_TICKS, BLINK_SURGE_LAST } from '../prototype/src/core/protocol.js';

const PORT = 18080 + Math.floor(Math.random() * 1000);
const url = `http://localhost:${PORT}`;
const waitFor = (sock, ev) => new Promise((res) => sock.once(ev, res));
const connect = (name) => { const s = io(url, { transports: ['websocket'] }); s.emit(MSG.JOIN, { room: 'test-eye', name }); return s; };

test('shared nerve room', async (t) => {
  const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('VITREOUS')) res(); }));
  t.after(() => server.kill());

  const a = connect('alpha');
  const wa = await waitFor(a, MSG.WELCOME);
  assert.equal(wa.nerve, 0);
  assert.ok(Number.isInteger(wa.seed));
  const b = connect('beta');
  const wb = await waitFor(b, MSG.WELCOME);
  assert.equal(wb.seed, wa.seed, 'same room => same seed');
  assert.equal(wb.players.length, 2);

  // positions: alpha ahead, beta behind
  a.emit(MSG.HINT, { z: 300, lane: 2, y: 0, action: 'run', alive: true });
  b.emit(MSG.HINT, { z: 120, lane: 1, y: 0, action: 'run', alive: true });
  const hintSeen = await waitFor(a, MSG.HINT);
  assert.equal(hintSeen.id, b.id); assert.equal(hintSeen.z, 120);

  // saccade before nerve is charged is denied
  a.emit(MSG.SACCADE_REQUEST, { dir: 1 });
  const denied = await waitFor(a, MSG.SACCADE_DENIED);
  assert.equal(denied.reason, 'nerve');

  // charge from both players; oversized charges are clamped to 30
  const nerveP = new Promise((res) => { const seen = []; b.on(MSG.NERVE, (m) => { seen.push(m.value); if (m.value >= NERVE_COST) res(seen); }); });
  a.emit(MSG.NERVE_CHARGE, { amount: 500 });
  b.emit(MSG.NERVE_CHARGE, { amount: 25 });
  const seen = await nerveP;
  assert.ok(seen.every(v => v <= 55), `charges clamped: ${seen}`);

  // alpha (leader) fires a saccade: scheduled in the future, beta (last) gets the surge
  const sacB = waitFor(b, MSG.SACCADE); const surgeB = waitFor(b, MSG.BLINK_SURGE);
  a.emit(MSG.SACCADE_REQUEST, { dir: -1 });
  const sac = await sacB;
  assert.equal(sac.dir, -1); assert.equal(sac.by, a.id);
  const pong = await (async () => { b.emit(MSG.PING, { t: 0 }); return waitFor(b, MSG.PONG); })();
  assert.ok(sac.applyTick > pong.serverTick - 5 && sac.applyTick <= pong.serverTick + SACCADE_LEAD_TICKS + 1, 'applyTick is ~300 ms ahead');
  const surge = await surgeB;
  assert.equal(surge.target, b.id); assert.equal(surge.meters, BLINK_SURGE_LAST);

  // death + leave propagate
  b.emit(MSG.DEATH, { z: 130 });
  const d = await waitFor(a, MSG.DEATH); assert.equal(d.id, b.id);
  b.disconnect();
  const leave = await waitFor(a, 'leave'); assert.equal(leave.id, d.id);
  a.disconnect();
});
