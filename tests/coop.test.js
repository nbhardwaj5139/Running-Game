import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../prototype/src/core/world.js';
import { Lockstep, COOP_DELAY } from '../prototype/src/core/lockstep.js';
import { mulberry32 } from '../prototype/src/core/rng.js';

/** Snapshot everything that must match between the two machines. */
const snap = (w) => ({
  tick: w.tick, distance: +w.distance.toFixed(6), storm: +w.storm.toFixed(6), score: Math.floor(w.score),
  coins: w.coins, powers: w.powers, alive: w.alive, chunks: w.pool.live.map(c => c.index).join(','),
  runners: w.runners.map(r => [r.lane, +r.xLane.toFixed(6), +r.y.toFixed(6), +r.vy.toFixed(6), r.action, +r.stumbleT.toFixed(6), r.shield, +r.jetpackT.toFixed(6), r.coins, Math.floor(r.score)].join('|')),
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

/**
 * The same idea with `n` machines instead of two: everyone owns a slot, everyone
 * relays to everyone, and a tick may only run once EVERY peer has covered it.
 */
function party({ n = 4, seed = 4242, ticks = 60 * 25, lagFrames = 2, sendEvery = 2 } = {}) {
  const slots = [...Array(n).keys()];
  const sides = slots.map(slot => {
    const w = new World(seed, { difficulty: 'normal', invincible: true, runners: n });
    return { slot, w, ls: new Lockstep(w, slot, COOP_DELAY, slots), rng: mulberry32(slot + 1) };
  });
  const wire = slots.map(() => []);                  // wire[to] = [{at, batch}]
  let frame = 0;
  const deliver = (upToFrame) => {
    for (const s of sides) { for (const p of wire[s.slot].filter(p => p.at <= upToFrame)) s.ls.remote(p.batch); wire[s.slot] = wire[s.slot].filter(p => p.at > upToFrame); }
  };
  while (sides.every(s => s.w.tick < ticks)) {
    frame++;
    deliver(frame);
    for (const s of sides) if (s.rng() < 0.25) {
      const r = s.rng();
      s.ls.local(r < 0.4 ? { kind: 'lane', dir: s.rng() < 0.5 ? -1 : 1 } : r < 0.7 ? { kind: 'jump' } : r < 0.85 ? { kind: 'slide' } : { kind: 'jumpRelease' });
    }
    for (const s of sides) s.ls.advance(4);
    if (frame % sendEvery === 0) for (const s of sides) { const batch = s.ls.drain(); for (const o of sides) if (o !== s) wire[o.slot].push({ at: frame + lagFrames, batch }); }
  }
  for (let i = 0; i < 300; i++) {                    // drain the wire and settle everyone on the same tick
    deliver(Infinity);
    for (const s of sides) s.ls.advance(4);
    for (const s of sides) { const batch = s.ls.drain(); for (const o of sides) if (o !== s) wire[o.slot].push({ at: 0, batch }); }
    if (sides.every(s => s.w.tick === sides[0].w.tick && s.w.tick >= ticks)) break;
  }
  return sides;
}

test('co-op lockstep: four machines on one road stay byte-identical', () => {
  const sides = party({ n: 4 });
  assert.ok(sides[0].w.tick > 60 * 12, `the run advanced (${sides[0].w.tick} ticks)`);
  for (const s of sides.slice(1)) {
    assert.equal(s.w.tick, sides[0].w.tick, 'every machine ran the same number of ticks');
    assert.deepEqual(snap(s.w), snap(sides[0].w), 'all four worlds are the same simulation');
  }
  // four bodies, each on its own starting lane, each driven by its own machine
  const w = sides[0].w;
  assert.equal(w.runners.length, 4);
  assert.equal(new Set(w.runners.map(r => r.homeLane)).size, 4, 'the four runners start in different lanes');
  const bySlot = {};
  for (const e of w.log) bySlot[e.i.track] = (bySlot[e.i.track] || 0) + 1;
  assert.equal(Object.keys(bySlot).length, 4, 'all four machines contributed inputs');
});

test('co-op lockstep: waits for the slowest peer, and a machine that leaves stops blocking the rest', () => {
  const slots = [0, 1, 2, 3];
  const w = new World(5, { runners: 4 });
  const ls = new Lockstep(w, 0, COOP_DELAY, slots);
  ls.remote({ slot: 1, inputs: [], upTo: 900 });
  ls.remote({ slot: 2, inputs: [], upTo: 900 });
  ls.advance(2000);
  assert.equal(w.tick, COOP_DELAY - 1, 'slot 3 has promised nothing past the opening, so nobody moves');
  ls.remote({ slot: 3, inputs: [], upTo: 40 });
  ls.advance(2000);
  assert.equal(w.tick, 40, 'ran to the slowest promise and no further');
  ls.drop(3);                                        // that machine closed its tab
  ls.advance(2000);
  assert.equal(w.tick, 900, 'with the leaver gone the road runs on to the remaining promises');
});

test('every runner keeps their own coin tally, and the road keeps the total', () => {
  const w = new World(31, { invincible: true, runners: 4 });
  for (let i = 0; i < 60 * 90 && w.alive; i++) { if (i % 23 === 0) w.input(i % 4, { kind: 'lane', dir: i % 8 < 4 ? 1 : -1 }); w.step(); }
  const tallies = w.runners.map(r => r.coins);
  assert.ok(tallies.reduce((a, b) => a + b, 0) === w.coins, 'the runners’ coins add up to the road’s total');
  assert.ok(tallies.some(c => c > 0), 'somebody collected something');
  assert.ok(new Set(tallies).size > 1, 'the scoreboards are genuinely per player, not a shared number');
  assert.ok(w.runners.every(r => r.score > 0), 'everyone scores the ground they covered');
});
