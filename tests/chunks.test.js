import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, ChunkPool, LANES, TRACKS, LANES_TOTAL, CHUNK_LEN, BEATS, BLOCKING, POWERS, rollerLaneAt, biomeOf, seasonOf, globalLane, trackOf, roadX, BIOME_LEN, SEASON_LEN, setpieceAt, kaijuOf, provinceOf, climbPitchAt, spawnLane, forkAt, laneGroupsAt, groupOf, FORK_GAP, FORK_LEN } from '../prototype/src/core/chunks.js';

const passable = (mask, l) => !BLOCKING.has(mask[l]);
/** DP: is there a lane path through one road's rows, one lane step per row? */
function pathExists(rows, lanes = LANES) {
  let reach = new Array(lanes).fill(true);
  for (const mask of rows) {
    const next = new Array(lanes).fill(false);
    for (let l = 0; l < lanes; l++) { if (!passable(mask, l)) continue; for (let d = -1; d <= 1; d++) { const p = l + d; if (p >= 0 && p < lanes && reach[p]) next[l] = true; } }
    reach = next; if (!reach.some(Boolean)) return false;
  }
  return true;
}
/** Every road of a chunk: its rows and how many lanes it holds. */
const roads = (c) => c.rows.map((rows, g) => ({ rows, lanes: c.groups[g].length, base: c.groups[g][0] }));

test('generate is pure, deterministic, and differs across seeds and tracks', () => {
  const a = generate(99, 12), b = generate(99, 12);
  assert.deepEqual(a, b);
  assert.notDeepEqual(generate(99, 12).cells, generate(100, 12).cells);
  assert.ok([1, 2, 3, 4, 5].some(i => JSON.stringify(generate(99, i).rows[0]) !== JSON.stringify(generate(99, i).rows[1])), 'tracks differ');
  assert.equal(a.z0, 12 * CHUNK_LEN); assert.equal(a.rows.length, TRACKS); assert.equal(a.rows[0].length, BEATS);
  assert.ok(a.cells.every(c => c.track === 0 || c.track === 1));
});

test('every road of every chunk is solvable on its own (2000 seeds x 60 chunks)', () => {
  let n = 0, split = 0; const kinds = new Set(), widths = new Set();
  for (let s = 1; s <= 2000; s++) for (let i = 0; i < 60; i++) {
    const c = generate(s, i);
    widths.add(c.rows.length); if (c.fork) split++;
    assert.equal(c.rows.length, c.groups.length);
    for (const { rows, lanes } of roads(c)) {
      for (const mask of rows) assert.ok(mask.filter(x => BLOCKING.has(x)).length <= lanes - 1, `seed ${s} chunk ${i}: row fully blocked`);
      assert.ok(rows.at(-1).every(x => x === null), `seed ${s} chunk ${i}: breath beat not clear`);
      assert.ok(pathExists(rows, lanes), `seed ${s} chunk ${i}: no path through one of the roads`);
      n++;
    }
    for (const cell of c.cells) {
      const g = globalLane(cell.track, cell.lane);
      assert.ok(c.groups[cell.grp].includes(g), 'a cell sits on the road it was generated for');
      // wides and rollers are measured across the whole road: a two-lane road may straddle the seam between the tracks
      if (cell.type === 'wide') { assert.equal(cell.span, 2); assert.ok(g + 1 <= LANES_TOTAL - 1); assert.ok(c.groups[cell.grp].includes(g + 1), 'a wide never spills onto the next road'); }
      if (cell.type === 'roller') { assert.ok(c.groups[cell.grp].includes(g + cell.dir), 'a roller sweeps inside its own road'); for (let k = 0; k < cell.period; k += 7) { const l = rollerLaneAt(cell, k); assert.ok(l >= -1e-9 && l <= LANES - 1 + 1e-9); } }
      if (cell.type === 'power') { kinds.add(cell.kind); const row = c.rows[cell.grp].find(r => Math.abs(r.z - cell.z) < 3.1); if (row) assert.equal(row[g - c.groups[cell.grp][0]], null, 'power in a blocked lane'); }
    }
  }
  assert.ok(split > 0, 'forks never happened');
  assert.deepEqual([...widths].sort(), [2, 3], 'both a two-road and a three-road fork were exercised');
  assert.ok(n > 2000 * 60 * TRACKS, 'a fork chunk carries more roads than a plain one');
  for (const k of POWERS) assert.ok(kinds.has(k), `power ${k} never generated`);
});

test('set pieces sit where the itinerary says, never on a kaiju chunk, and stay solvable', () => {
  const found = { bridge: [], avalanche: [], tsunami: [], fire: [], rockfall: [], crossing: [], herd: [] };
  for (let i = 0; i < 1024; i++) { const sp = setpieceAt(i); if (sp) { found[sp].push(i); assert.ok(!kaijuOf(i), `${sp} on a kaiju chunk ${i}`); } }
  for (const k of Object.keys(found)) assert.ok(found[k].length > 0, `${k} never happens`);
  assert.ok(found.tsunami.every(i => provinceOf(i).id === 'shonan')); assert.ok(found.fire.every(i => provinceOf(i).id === 'hakone' && seasonOf(i) !== 3)); assert.ok(found.crossing.every(i => biomeOf(i) === 2 && i % 8 === 5));
  assert.ok(found.avalanche.every(i => seasonOf(i) === 3 && provinceOf(i).shrine));
  assert.ok(found.rockfall.every(i => provinceOf(i).hike && climbPitchAt(i) > 0), 'boulders come down on the climb itself');
  assert.ok(found.herd.every(i => provinceOf(i).deer), 'the herd crosses where the deer live');
  for (let s = 1; s <= 300; s++) for (const i of [...found.tsunami.slice(0, 3), ...found.fire.slice(0, 3), ...found.rockfall.slice(0, 3), found.crossing[0], found.crossing[1], found.herd[0], found.herd[1]]) {
    const c = generate(s, i); assert.equal(c.setpiece, setpieceAt(i));
    for (const { rows, lanes } of roads(c)) { assert.ok(pathExists(rows, lanes), `seed ${s} chunk ${i}: no path`); assert.ok(rows.at(-1).every(x => x === null)); }
    if (c.setpiece === 'crossing') {
      for (const { rows } of roads(c)) { assert.ok(rows[1].every(x => x === null), 'a clear beat before the gates'); assert.ok(rows[2].every(x => x === 'arch'), 'gate arms across every lane'); }
      assert.ok(c.cells.filter(k => k.type === 'arch' && k.wall).every(k => k.v === 0), 'gates use the crossing-gate prop'); assert.ok(c.wall, 'a crossing chunk is straight');
    }
    if (c.setpiece === 'herd') {
      for (const { rows, lanes } of roads(c)) { assert.ok(rows[1].every(x => x === null) && rows[2].every(x => x === null), 'room to see the herd'); assert.equal(rows[3].filter(x => x === 'drusen').length, lanes - 1, 'deer in every lane but one'); }
      assert.ok(c.cells.filter(k => k.herd).every(k => k.type === 'drusen'), 'stragglers are jumped'); assert.ok(c.wall, 'a deer crossing is straight');
    }
    if (c.setpiece === 'tsunami') assert.ok(c.cells.some(k => k.thrown && k.by === 'tsunami'));
    if (c.setpiece === 'fire') assert.ok(c.cells.some(k => k.thrown && k.by === 'fire'));
    if (c.setpiece === 'rockfall') assert.ok(c.cells.some(k => k.thrown && k.by === 'rockfall'), 'boulders reach the trail');
  }
});

test('runners are seated across the road, and the classic pair keeps its lanes', () => {
  assert.deepEqual([0, 1].map(i => spawnLane(i, 2)), [1, 4], 'two runners still start in the middle of each track');
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const lanes = [...Array(n).keys()].map(i => spawnLane(i, n));
    assert.equal(new Set(lanes).size, n, `${n} runners get ${n} different lanes`);
    assert.ok(lanes.every(l => l >= 0 && l < LANES_TOTAL), 'every seat is on the road');
    assert.deepEqual(lanes, [...lanes].sort((a, b) => a - b), 'seats are handed out left to right');
  }
});

test('sections and lane helpers', () => {
  assert.equal(biomeOf(0), 0); assert.equal(biomeOf(BIOME_LEN), 1); assert.equal(biomeOf(BIOME_LEN * 4), 0);
  assert.equal(seasonOf(0), 0); assert.equal(seasonOf(SEASON_LEN * 3), 3); assert.equal(seasonOf(SEASON_LEN * 4), 1, 'the second lap starts a season later');
  assert.equal(seasonOf(SEASON_LEN * 8), 2); assert.equal(seasonOf(SEASON_LEN * 16), 0);
  assert.equal(globalLane(1, 0), 3); assert.equal(trackOf(2.4), 0); assert.equal(trackOf(2.6), 1);
  assert.ok(Math.abs(roadX((LANES_TOTAL - 1) / 2)) < 1e-9); assert.ok(roadX(0) < 0 && roadX(5) > 0);
});

test('ChunkPool recycles in order and never drops a chunk', () => {
  const seen = []; const pool = new ChunkPool(5, { ahead: 4, behind: 1, onRecycle: (o, n) => seen.push([o.index, n.index]) });
  for (let z = 0; z < CHUNK_LEN * 30; z += 7) pool.update(z);
  for (let i = 1; i < seen.length; i++) assert.equal(seen[i][0], seen[i - 1][0] + 1);
  assert.equal(pool.live.length, 6); assert.ok(pool.live[0].index <= 28);
});
