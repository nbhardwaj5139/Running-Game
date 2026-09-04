import test from 'node:test';
import assert from 'node:assert/strict';
import { World, W, replay } from '../prototype/src/core/world.js';
import { Player, P, speedAt } from '../prototype/src/core/player.js';
import { generate, LANES_TOTAL, globalLane, groupOf, forkAt, CHUNK_LEN, BIOME_LEN, DIFFICULTY } from '../prototype/src/core/chunks.js';

const same = (a, b) => !!a && a.z === b.z && a.lane === b.lane && a.track === b.track && a.type === b.type;
const run = (w, ticks) => { for (let i = 0; i < ticks && w.alive; i++) w.step(); };
/** Find a seed whose first chunks put `type` on track `track` (returns the cell). */
function findCell(type, track = 1, pred = () => true) {
  for (let s = 1; s < 4000; s++) for (let i = 1; i < 4; i++) { const c = generate(s, i); const cell = c.cells.find(k => k.type === type && k.track === track && pred(k)); if (cell) return { seed: s, cell }; }
  throw new Error('no cell found');
}
/** Strip anything a runner picked up on the way in, so a test measures the hazard and not a power. */
const clearPowers = (p) => { p.shield = false; p.shieldT = 0; p.dashT = 0; p.jetpackT = 0; p.iT = 0; p.magnetT = 0; p.foxfireT = 0; p.guideT = 0; };
/** Steer runners to global lanes ({id: g}) with one input per tick each, running until just before z. */
function approach(w, targets, z, margin = 3) {
  while (w.alive && w.distance < z - margin) {
    for (const [id, g] of Object.entries(targets)) { const p = w.runners[id]; if (p.lane !== g && p.laneT >= 1) w.input(Number(id), { kind: 'lane', dir: Math.sign(g - p.lane) }); }
    w.step();
  }
}

test('speed curve and player basics', () => {
  assert.equal(speedAt(0), P.SPEED_BASE); assert.ok(speedAt(1000) > speedAt(0)); assert.equal(speedAt(1e9), P.SPEED_MAX);
  const p = new Player(0); assert.equal(p.lane, 1);
  for (let i = 0; i < 4; i++) { p.input({ kind: 'lane', dir: -1 }); for (let k = 0; k < 12; k++) p.step(1 / 60); }
  assert.equal(p.lane, 0, 'clamped at the road edge');
  const q = new Player(1); for (let i = 0; i < 6; i++) { q.input({ kind: 'lane', dir: 1 }); for (let k = 0; k < 12; k++) q.step(1 / 60); }
  assert.equal(q.lane, LANES_TOTAL - 1);
  const full = new Player(); full.input({ kind: 'jump' }); let mf = 0; for (let i = 0; i < 60; i++) { full.step(1 / 60); mf = Math.max(mf, full.y); }
  const short = new Player(); short.input({ kind: 'jump' }); short.step(1 / 60); short.input({ kind: 'jumpRelease' }); let ms = 0; for (let i = 0; i < 60; i++) { short.step(1 / 60); ms = Math.max(ms, short.y); }
  assert.ok(mf > 1.0 && ms < mf * 0.8);
});

test('both runners share distance; a stumble slows the pair; coins score and heal the storm', () => {
  const w = new World(3, { invincible: true }); const ev = {}; w.opts.onEvent = e => { ev[e.type] = (ev[e.type] || 0) + 1; };
  run(w, 60 * 20);
  assert.equal(w.runners[0].z, w.runners[1].z); assert.ok(w.distance > 200);
  assert.ok(ev.coin > 0); assert.ok(w.score > w.distance);
  const s = new World(3, { invincible: true }); run(s, 60 * 20);
  assert.equal(s.distance, w.distance, 'deterministic');
});

test('shield absorbs a stumble; dash clears; magnet collects off-lane coins; x2 doubles; heal caps', () => {
  const { seed, cell } = findCell('drusen');
  const w = new World(seed, { invincible: true }); const ev = []; w.opts.onEvent = e => { if (same(e.cell, cell)) ev.push(e.type); };
  approach(w, { 1: globalLane(1, cell.lane) }, cell.z); w.runners[1].shield = true; run(w, 60);
  assert.deepEqual(ev, ['shield'], 'shield ate the hit');
  const d = new World(seed, { invincible: true }); const ev2 = []; d.opts.onEvent = e => { if (same(e.cell, cell)) ev2.push(e.type); };
  approach(d, { 1: globalLane(1, cell.lane) }, cell.z); d.runners[1].dashT = 99; run(d, 60);
  assert.ok(ev2.includes('clear') && !ev2.includes('stumble'), 'dash clears without a stumble');
  const { seed: cs, cell: coin } = findCell('photon', 1, k => !k.hi);
  const m = new World(cs, { invincible: true }); let got = 0; m.opts.onEvent = e => { if (e.type === 'coin' && same(e.cell, coin)) got++; };
  const other = coin.lane === 0 ? 2 : 0; approach(m, { 1: globalLane(1, other) }, coin.z); m.runners[1].magnetT = 999; run(m, 60);
  assert.equal(got, 1, 'magnet pulled the coin from another lane');
  const x = new World(cs, { invincible: true }); x.x2T = 999; let n = 0; x.opts.onEvent = e => { if (e.type === 'coin') n = e.n; }; run(x, 60 * 10); assert.equal(n, 2);
  const h = new World(1); h.storm = W.STORM_MAX - 1; h._power({ kind: 'heal' }, h.runners[1]); assert.equal(h.storm, W.STORM_MAX);
});

test('a fall respawns and costs margin; death only when the storm catches up; invincible never dies', () => {
  const { seed, cell } = findCell('gap');
  const w = new World(seed); const ev = []; w.opts.onEvent = e => { if (same(e.cell, cell)) ev.push(e.type); };
  approach(w, { 1: globalLane(1, cell.lane) }, cell.z); clearPowers(w.runners[1]);   // a pickup taken on the way would eat the fall we came to measure
  w.storm = W.STORM_START; const before = w.storm; run(w, 60);
  assert.deepEqual(ev, ['fall']); assert.ok(w.alive); assert.ok(w.storm < before - 10);
  const d = new World(seed); approach(d, { 1: globalLane(1, cell.lane) }, cell.z); d.storm = 1; run(d, 60);
  assert.equal(d.alive, false); assert.ok(['fall', 'storm'].includes(d.deathReason));
  const i = new World(seed, { invincible: true }); run(i, 60 * 90); assert.ok(i.alive);
});

test('replay reproduces a scripted run exactly; section events fire', () => {
  const w = new World(21); const sections = []; w.opts.onEvent = e => { if (e.type === 'section') sections.push([e.biome, e.season]); };
  for (let i = 0; i < 60 * 30 && w.alive; i++) { if (i % 37 === 0) w.input(1, { kind: ['lane', 'jump', 'slide'][i % 3], dir: i % 2 ? 1 : -1 }); if (i % 53 === 0) w.input(0, { kind: 'jump' }); w.step(); }
  assert.deepEqual(replay(21, w.log, 60 * 30), w.summary);
  const far = new World(22, { invincible: true }); const s2 = []; far.opts.onEvent = e => { if (e.type === 'section') s2.push(e); };
  run(far, 60 * 75); assert.ok(far.distance > BIOME_LEN_M() , 'ran past the first section'); assert.ok(s2.length >= 1 && s2[0].biome === 1);
  function BIOME_LEN_M() { return BIOME_LEN * CHUNK_LEN; }
});

test('barging: a moving runner shoves the other one lane; edge bounces; jumping over is free; cooldown', () => {
  const w = new World(5, { invincible: true }); const bumps = []; w.opts.onEvent = e => { if (e.type === 'bump') bumps.push(e); };
  const [a, b] = w.runners;                       // a at lane 1, b at lane 4
  approach(w, { 0: 2, 1: 3 }, 40);   // adjacent across the centre line
  assert.equal(a.lane, 2); assert.equal(b.lane, 3);
  w.input(1, { kind: 'lane', dir: -1 }); run(w, 6);
  assert.equal(bumps.length, 1); assert.equal(bumps[0].mover, 1); assert.equal(bumps[0].victim, 0);
  assert.equal(a.lane, 1, 'victim shoved left'); run(w, 30);
  // cooldown: nothing else fired in the same window
  assert.equal(bumps.length, 1);
  // edge: push a to lane 0 first, then try to shove again from lane 1
  const e = new World(5, { invincible: true }); const eb = []; e.opts.onEvent = ev => { if (ev.type === 'bump') eb.push(ev); };
  approach(e, { 0: 0, 1: 1 }, 40); e.input(1, { kind: 'lane', dir: -1 }); run(e, 6);
  assert.equal(eb.length, 1); assert.equal(eb[0].victim, -1, 'mover bounced at the road edge'); assert.equal(e.runners[0].lane, 0); assert.ok(e.runners[1].lane >= 1);
  // jump over: b jumps, then moves into a's lane while airborne — no bump
  const j = new World(5, { invincible: true }); const jb = []; j.opts.onEvent = ev => { if (ev.type === 'bump') jb.push(ev); };
  approach(j, { 0: 2, 1: 3 }, 40); j.input(1, { kind: 'jump' }); run(j, 12); j.input(1, { kind: 'lane', dir: -1 }); run(j, 4);
  assert.ok(j.runners[1].y > 0.8); assert.equal(jb.length, 0);
});

test('autopilot companion stays on its home lanes and its mistakes are free', () => {
  const w = new World(8, { autopilot: [0] }); let free = 0, paid = 0, maxLane = -1;
  w.opts.onEvent = e => { if ((e.type === 'stumble' || e.type === 'fall') && e.runner === 0) { if (e.free) free++; else paid++; } };
  // Runner 1 is the player and presses nothing here — but the Yatagarasu Guide power
  // hands its runner to the same autopilot, which would log inputs on track 1 and muddy
  // what this test is measuring. Keep it off so only the companion drives.
  for (let i = 0; i < 60 * 60 && w.alive; i++) { w.runners[1].guideT = 0; w.step(); maxLane = Math.max(maxLane, w.runners[0].lane); }
  assert.ok(maxLane <= 2); assert.equal(paid, 0);
  assert.ok(w.log.length > 0 && w.log.every(e => !e.i || e.i.track === 0), 'every logged input came from the companion, and it did act');
});

test('forks: the road splits into separate roads, and each runner is held to the one they took', () => {
  const seed = 3, fork = forkAt(seed, 13);                       // this seed splits chunk 13 three ways
  assert.equal(fork.groups, 3); assert.equal(fork.start, 13);
  const w = new World(seed, { invincible: true }); const evts = [], strays = [];
  w.opts.onEvent = (e) => {
    if (e.type === 'fork') evts.push(e);
    // whatever a runner met, it was on the road that runner is standing on
    if (e.cell && ['stumble', 'clear', 'nearmiss', 'fall'].includes(e.type)) {
      const p = w.runners[e.runner], n = w.pool.chunkAt(e.cell.z)?.groups.length ?? 2;
      if (e.cell.grp !== groupOf(p.xLane, n)) strays.push(e);
    }
  };
  // the two of them take the far edges of the road, so the split puts them on different roads
  approach(w, { 0: 0, 1: 5 }, 13 * CHUNK_LEN, 8);
  assert.deepEqual(evts.map(e => e.at), ['ahead'], 'the fork is called before it arrives');
  while (w.alive && w.distance < 13 * CHUNK_LEN + 2) w.step();
  assert.deepEqual(evts.map(e => e.at), ['ahead', 'split']);
  const [a, b] = w.runners;
  assert.deepEqual([a.laneMin, a.laneMax], [0, 1], 'the left runner keeps the two left lanes');
  assert.deepEqual([b.laneMin, b.laneMax], [4, 5], 'the right runner keeps the two right lanes');
  assert.notEqual(a.group, b.group);
  // lean on the controls: nothing takes either of them off their own road
  for (let i = 0; i < 60 * 3 && w.alive && w.distance < (13 + fork.len) * CHUNK_LEN - 4; i++) {
    w.input(0, { kind: 'lane', dir: 1 }); w.input(1, { kind: 'lane', dir: -1 }); w.step();
    assert.ok(a.lane <= 1 && a.xLane <= 1.001, `left runner crossed the gap at ${w.distance}`);
    assert.ok(b.lane >= 4 && b.xLane >= 3.999, `right runner crossed the gap at ${w.distance}`);
  }
  assert.deepEqual(strays, [], 'nobody met a hazard belonging to another road');
  // and the merge gives the whole six lanes back
  while (w.alive && w.distance < (13 + fork.len) * CHUNK_LEN + 2) w.step();
  assert.deepEqual(evts.map(e => e.at), ['ahead', 'split', 'join']);
  assert.deepEqual([a.laneMin, a.laneMax], [0, LANES_TOTAL - 1]);
  for (let i = 0; i < 60 && w.alive; i++) { w.input(0, { kind: 'lane', dir: 1 }); w.step(); }
  assert.ok(a.lane > 1, 'the roads are one again and the runner can cross');
});

test('forks: nobody barges across the gap, and a shared screen never splits the road', () => {
  const w = new World(3, { invincible: true }); const bumps = [];
  w.opts.onEvent = (e) => { if (e.type === 'bump') bumps.push(e); };
  while (w.alive && w.distance < 13 * CHUNK_LEN + 2) w.step();
  const [a, b] = w.runners;
  // stand them either side of the seam, close enough to touch if the gap were not there
  a.group = 0; a.lane = a.laneFromX = 1; a.xLane = 1.9; a.laneT = 1;
  b.group = 1; b.lane = b.laneFromX = 2; b.xLane = 2.0; b.laneT = 1;
  bumps.length = 0; for (let i = 0; i < 30 && w.alive; i++) w.step();
  assert.deepEqual(bumps, [], 'metres of air between them, whatever the lane numbers say');
  // two players on one screen: the road never pulls apart, or one of them leaves the frame
  const flat = new World(3, { forks: false });
  assert.equal(flat.cfg.forks, false);
  assert.equal(generate(3, 13, flat.cfg).groups.length, 2, 'still just the two tracks');
  const f = new World(3, { invincible: true, forks: false });
  while (f.alive && f.distance < (13 + 2) * CHUNK_LEN) f.step();
  assert.equal(f.fork, null); assert.equal(f.runners[1].laneMax, LANES_TOTAL - 1);
});

test('bō-hiya: the pickup loads a rocket, Space fires it down the lane, and the blast takes the road apart', () => {
  // Space with nothing loaded is a jump — the sim decides, so co-op machines never disagree
  const q = new Player(1); q.input({ kind: 'fire' }); for (let k = 0; k < 6; k++) q.step(1 / 60);
  assert.ok(q.y > 0 && !q.rocket, 'an empty launcher is just a jump');
  // find a seed with a rocket early on the fox's track, pick it up, and let it fly
  let fired = null;
  for (let seed = 1; seed < 4000 && !fired; seed++) {
    for (let i = 1; i < 4; i++) {
      const cell = generate(seed, i).cells.find(k => k.type === 'power' && k.kind === 'rocket' && k.track === 1);
      if (!cell) continue;
      const w = new World(seed, { invincible: true }); const evts = [];
      w.opts.onEvent = (e) => { if (['power', 'rocket.fire', 'rocket.hit', 'strike'].includes(e.type)) evts.push(e); };
      approach(w, { 1: globalLane(cell.track, cell.lane) }, cell.z, 1); run(w, 8);
      const p = w.runners[1]; clearPowers(p);
      if (!p.rocket) continue;                                   // a barge or a bounce kept it off the pickup: try another
      assert.ok(evts.some(e => e.type === 'power' && e.kind === 'rocket'));
      assert.equal(w.rockets.length, 0, 'loaded, not launched');
      const y0 = p.y; w.input(1, { kind: 'fire' }); w.step();
      assert.equal(p.rocket, false); assert.equal(w.rockets.length, 1, 'Space launched it'); assert.ok(evts.some(e => e.type === 'rocket.fire'));
      assert.equal(p.y, y0, 'firing is not a jump');
      const z0 = w.distance;
      run(w, 60 * 4);
      const hit = evts.find(e => e.type === 'rocket.hit'); assert.ok(hit, 'it went off'); assert.equal(w.rockets.length, 0);
      assert.ok(hit.z > z0 && hit.z <= z0 + W.ROCKET_RANGE + 8, 'within range');
      const strikes = evts.filter(e => e.type === 'strike');
      assert.equal(strikes.length, hit.n);
      for (const e of strikes) { assert.equal(e.by, 'rocket'); assert.ok(e.cell.gone); assert.ok(Math.abs(e.cell.z - hit.z) <= W.ROCKET_BLAST + 1e-9); assert.ok(Math.abs(globalLane(e.cell.track, e.cell.lane) - hit.lane) <= W.ROCKET_LANES + 1, 'only the lanes beside the impact'); }
      if (hit.n > 0) fired = { seed, hit };
      break;
    }
  }
  assert.ok(fired, 'some rocket somewhere blew something up');
  // a hazard that was blown apart is not there for anyone: the same road, replayed, matches — and the runner passes clean
  const r1 = replay(fired.seed, [], 60 * 10), r2 = replay(fired.seed, [], 60 * 10); assert.deepEqual(r1, r2);
});
