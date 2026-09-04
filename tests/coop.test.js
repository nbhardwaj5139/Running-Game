import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../prototype/src/core/world.js';
import { Lockstep, COOP_DELAY } from '../prototype/src/core/lockstep.js';
import { mulberry32 } from '../prototype/src/core/rng.js';

/** Snapshot everything that must match between the two machines. */
const snap = (w) => ({
  tick: w.tick, distance: +w.distance.toFixed(6), storm: +w.storm.toFixed(6), score: Math.floor(w.score),
  coins: w.coins, powers: w.powers, alive: w.alive, chunks: w.pool.live.map(c => c.index).join(','),
  runners: w.runners.map(r => [r.lane, +r.xLane.toFixed(6), +r.y.toFixed(6), +r.vy.toFixed(6), r.action, +r.stumbleT.toFixed(6), r.shield, +r.jetpackT.toFixed(6)].join('|')),
});

/**
 * Two machines, one road. Each owns a runner, exchanges input batches over a
 * (lossless, ordered — as a websocket is) link with `lagFrames` of delay, and
 * drives its own copy of the World. They must stay identical for the whole run.
 */
function race({ seed = 4242, ticks = 60 * 40, lagFrames = 2, sendEvery = 2, difficulty = 'normal' } = {}) {
  const mk = (slot) => { const w = new World(seed, { difficulty, invincible: true }); return { w, ls: new Lockstep(w, slot) }; };
  const A = mk(1), B = mk(0);                       // A is the host (right road), B the guest (left road)
  const wire = [[], []];                            // in-flight batches: wire[to] = [{at, batch}]
  const rngA = mulberry32(1), rngB = mulberry32(2);
  let frame = 0;

  while (A.w.tick < ticks && B.w.tick < ticks) {
    frame++;
    for (const [i, side] of [[0, A], [1, B]]) {      // deliver anything that has arrived
      for (const p of wire[i].filter(p => p.at <= frame)) side.ls.remote(p.batch);
      wire[i] = wire[i].filter(p => p.at > frame);
    }
    // each side presses keys on its own schedule, entirely independently
    for (const [side, rng] of [[A, rngA], [B, rngB]]) {
      if (rng() < 0.25) {
        const r = rng();
        side.ls.local(r < 0.4 ? { kind: 'lane', dir: rng() < 0.5 ? -1 : 1 } : r < 0.7 ? { kind: 'jump' } : r < 0.85 ? { kind: 'slide' } : { kind: 'jumpRelease' });
      }
    }
    A.ls.advance(4); B.ls.advance(4);               // both run at roughly the same rate, gated by each other
    if (frame % sendEvery === 0) { wire[1].push({ at: frame + lagFrames, batch: A.ls.drain() }); wire[0].push({ at: frame + lagFrames, batch: B.ls.drain() }); }
  }
  // let the tail of the wire land and settle both to the same tick
  for (let i = 0; i < 200; i++) {
    for (const [j, side] of [[0, A], [1, B]]) { for (const p of wire[j]) side.ls.remote(p.batch); }
    wire[0] = []; wire[1] = [];
    A.ls.advance(4); B.ls.advance(4);
    wire[1].push({ at: 0, batch: A.ls.drain() }); wire[0].push({ at: 0, batch: B.ls.drain() });
    if (A.w.tick === B.w.tick && A.w.tick >= ticks) break;
  }
  return { A, B };
}

test('co-op lockstep: two machines exchanging only inputs stay byte-identical', () => {
  const { A, B } = race();
  assert.ok(A.w.tick > 60 * 20, `the run advanced (${A.w.tick} ticks)`);
  assert.equal(A.w.tick, B.w.tick, 'both machines ran the same number of ticks');
  assert.deepEqual(snap(A.w), snap(B.w), 'the two worlds are the same simulation');
});

test('co-op lockstep: both runners are live and each machine drives its own', () => {
  const { A, B } = race({ seed: 77, ticks: 60 * 20 });
  assert.equal(A.w.runners.filter(r => !r.disabled).length, 2, 'co-op runs both runners');
  assert.deepEqual(snap(A.w), snap(B.w));
  // the two runners went their own ways: the machines really did drive different slots
  const [r0, r1] = A.w.runners;
  assert.ok(r0.laneFromX !== r1.laneFromX || r0.lane !== r1.lane || r0.y !== r1.y, 'the two runners are independent');
  // and every input landed on the runner that pressed it
  const bySlot = { 0: 0, 1: 0 };
  for (const e of A.w.log) bySlot[e.i.track] = (bySlot[e.i.track] || 0) + 1;
  assert.ok(bySlot[0] > 0 && bySlot[1] > 0, 'both machines contributed inputs');
});

test('co-op lockstep: survives a slow link, and never runs past what the peer has promised', () => {
  const { A, B } = race({ seed: 9, ticks: 60 * 20, lagFrames: 8, sendEvery: 4 });
  assert.equal(A.w.tick, B.w.tick);
  assert.deepEqual(snap(A.w), snap(B.w));
});

test('co-op lockstep: a machine refuses to step past the peer, and an input runs on the tick it was promised for', () => {
  const w = new World(5, { difficulty: 'normal' });
  const ls = new Lockstep(w, 1);
  ls.advance(1000);
  assert.equal(w.tick, COOP_DELAY - 1, 'stops at the peer’s opening promise instead of running ahead');
  assert.equal(ls.ready, false);

  const rec = ls.local({ kind: 'lane', dir: 1 });
  assert.equal(rec.t, w.tick + COOP_DELAY, 'the input is scheduled a full delay ahead');
  const batch = ls.drain();
  assert.equal(batch.upTo, w.tick + COOP_DELAY - 1, 'the promise covers exactly what has been sent');
  assert.deepEqual(batch.inputs, [rec]);

  ls.remote({ inputs: [], upTo: rec.t });            // the peer catches up past our input's tick
  const before = w.runners[1].lane;
  ls.advance(1000);
  assert.equal(w.tick, rec.t, 'ran up to the peer’s new promise, no further');
  assert.notEqual(w.runners[1].lane, before, 'the scheduled input was applied on its tick');
});
