import test from 'node:test';
import assert from 'node:assert/strict';
import { World, W, replay } from '../prototype/src/core/world.js';
import { Player, P, speedAt } from '../prototype/src/core/player.js';
import { CHUNK_LEN, LANES, WINDOW } from '../prototype/src/core/chunks.js';

const run = (w, ticks) => { for (let i = 0; i < ticks && w.player.alive; i++) w.step(); };

test('speed curve ramps and caps', () => {
  assert.equal(speedAt(0), P.SPEED_BASE);
  assert.ok(speedAt(1000) > speedAt(0));
  assert.equal(speedAt(1e9), P.SPEED_MAX);
});

test('lane changes clamp to the window and ease over LANE_T', () => {
  const p = new Player();
  p.input({ kind: 'lane', dir: -1 }); p.step(1 / 60);
  assert.equal(p.viewLane, 0);
  p.input({ kind: 'lane', dir: -1 }); for (let i = 0; i < 20; i++) p.step(1 / 60);
  assert.equal(p.viewLane, 0);
  assert.ok(Math.abs(p.xLane - 0) < 1e-6, 'eased to lane 0');
  p.input({ kind: 'lane', dir: 1 }); p.step(1 / 60);
  assert.ok(p.xLane > 0 && p.xLane < 1, 'mid-change');
});

test('jump has variable height and a short hop on early release', () => {
  const full = new Player(); full.input({ kind: 'jump' });
  let maxFull = 0; for (let i = 0; i < 60; i++) { full.step(1 / 60); maxFull = Math.max(maxFull, full.y); }
  const short = new Player(); short.input({ kind: 'jump' }); short.step(1 / 60); short.input({ kind: 'jumpRelease' });
  let maxShort = 0; for (let i = 0; i < 60; i++) { short.step(1 / 60); maxShort = Math.max(maxShort, short.y); }
  assert.ok(maxFull > 1.5, `full jump too low: ${maxFull}`);
  assert.ok(maxShort < maxFull * 0.8, `short hop not shorter: ${maxShort} vs ${maxFull}`);
  assert.equal(full.grounded, true);
});

test('input buffering: a jump pressed just before landing fires on landing', () => {
  const p = new Player(); p.input({ kind: 'jump' });
  for (let i = 0; i < 38; i++) p.step(1 / 60);          // airborne, ~5 ticks before landing
  assert.equal(p.grounded, false);
  p.input({ kind: 'jump' });                              // buffered while in the air (past coyote, within BUFFER_T)
  let jumped = 0;
  for (let i = 0; i < 30; i++) { const g = p.grounded; p.step(1 / 60); if (g && !p.grounded) jumped++; }
  assert.equal(jumped, 1, 'buffered jump should fire once on landing');
});

test('slide shrinks the hitbox and ends after SLIDE_T', () => {
  const p = new Player(); p.input({ kind: 'slide' }); p.step(1 / 60);
  assert.equal(p.action, 'slide'); assert.equal(p.height, P.SLIDE_H);
  for (let i = 0; i < 40; i++) p.step(1 / 60);
  assert.equal(p.action, 'run');
});

test('world is deterministic for identical input logs', () => {
  const a = new World(31, { solo: true }), b = new World(31, { solo: true });
  const script = (w, t) => { if (t % 37 === 0) w.input({ kind: 'lane', dir: t % 74 ? 1 : -1 }); if (t % 53 === 0) w.input({ kind: 'jump' }); if (t % 61 === 0) w.input({ kind: 'slide' }); };
  for (let t = 0; t < 3000; t++) { script(a, t); script(b, t); a.step(); b.step(); }
  assert.deepEqual(a.summary, b.summary);
  assert.equal(a.log.length, b.log.length);
});

test('replay reproduces a run from seed + log', () => {
  const w = new World(77, { solo: true });
  for (let t = 0; t < 4000 && w.player.alive; t++) {
    if (t % 41 === 0) w.input({ kind: 'lane', dir: t % 82 ? 1 : -1 });
    if (t % 29 === 0) w.input({ kind: 'jump' });
    w.step();
  }
  const r = replay(77, w.log, w.tick);
  assert.equal(r.distance, w.summary.distance);
  assert.equal(r.score, w.summary.score);
});

test('an idle runner in lane 1 eventually dies (the eye is not empty)', () => {
  let died = 0;
  for (let s = 1; s <= 20; s++) { const w = new World(s, { solo: true }); run(w, 60 * 120); if (!w.player.alive) died++; }
  assert.ok(died >= 15, `only ${died}/20 idle runs died`);
});

test('saccade shifts the window after its telegraph and is clamped to the retina', () => {
  const w = new World(3, { solo: false });
  assert.equal(w.window, 1);
  w.scheduleSaccade(1, null, 'me');
  assert.ok(w.pending && w.pending.atTick - w.tick === Math.round(W.SACCADE_TELEGRAPH * 60));
  run(w, 30); assert.equal(w.window, 2);
  w.scheduleSaccade(1, null, 'rival');           // would leave the retina -> flips
  run(w, 20); assert.equal(w.window, 1);
  assert.ok(w.window >= 0 && w.window <= LANES - WINDOW);
});

test('spending nerve requires NERVE_COST and fires a saccade', () => {
  const w = new World(3, { solo: false });
  assert.equal(w.spendNerve(1), false);
  w.nerve = W.NERVE_COST;
  assert.equal(w.spendNerve(-1), true);
  assert.equal(w.nerve, 0);
  assert.ok(w.pending);
});

test('gap without jumping kills; gap with jump clears', () => {
  // find a seed/chunk where a gap sits in world lane 2 (view lane 1 with window 1) early in the run
  for (let s = 1; s < 400; s++) {
    const w = new World(s, { solo: false });
    const gap = w.pool.live.flatMap(c => c.cells).find(c => c.type === 'gap' && c.lane === 2 && c.z > 40 && c.z < 250);
    if (!gap) continue;
    // Make sure the runner is not killed by something earlier: only proceed if nothing blocks lane 2 before the gap
    const earlier = w.pool.live.flatMap(c => c.cells).filter(c => c.lane === 2 && c.z < gap.z && (c.type === 'gap' || c.type === 'stalk' || c.type === 'arch' || c.type === 'drusen'));
    if (earlier.length) continue;
    run(w, 60 * 60);
    assert.equal(w.player.alive, false);
    assert.equal(w.deathReason, 'fall');
    // now jump right before the gap
    const w2 = new World(s, { solo: false });
    while (w2.player.alive && w2.player.z < gap.z - W.GAP_DEPTH / 2 - 3) w2.step();
    w2.input({ kind: 'jump' });
    run(w2, 90);
    assert.ok(w2.player.z > gap.z, 'ran past the gap');
    assert.equal(w2.player.alive, true, 'jumped the gap');
    return;
  }
  assert.fail('no test seed found');
});

test('photon collection scores, charges nerve and pushes the Blink back', () => {
  const w = new World(1, { solo: false });          // chunk 0 is photons only
  const before = w.blink;
  run(w, 60 * 3);
  assert.ok(w.photons > 0);
  assert.ok(w.nerve > 0);
  assert.ok(w.score > w.player.distance);
  assert.ok(w.blink >= before - 1);
});

test('chunk pool recycles as the runner advances', () => {
  let recycles = 0;
  const w = new World(9, { solo: false, invincible: true, onEvent: (e) => { if (e.type === 'recycle') recycles++; } });
  while (w.player.alive && w.player.z < CHUNK_LEN * 5) w.step();
  assert.ok(recycles >= 3, `recycles=${recycles}`);
  assert.equal(w.pool.live.length, 8);
});
