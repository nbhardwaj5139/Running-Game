import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, ChunkPool, LANES, TRACKS, LANES_TOTAL, CHUNK_LEN, BEATS, BLOCKING, POWERS, rollerLaneAt, biomeOf, seasonOf, globalLane, trackOf, roadX, BIOME_LEN, SEASON_LEN } from '../prototype/src/core/chunks.js';

const passable = (mask, l) => !BLOCKING.has(mask[l]);
/** DP: is there a lane path through a track's rows, one lane step per row? */
function pathExists(rows) {
  let reach = new Array(LANES).fill(true);
  for (const mask of rows) {
    const next = new Array(LANES).fill(false);
    for (let l = 0; l < LANES; l++) { if (!passable(mask, l)) continue; for (let d = -1; d <= 1; d++) { const p = l + d; if (p >= 0 && p < LANES && reach[p]) next[l] = true; } }
    reach = next; if (!reach.some(Boolean)) return false;
  }
  return true;
}

test('generate is pure, deterministic, and differs across seeds and tracks', () => {
  const a = generate(99, 12), b = generate(99, 12);
  assert.deepEqual(a, b);
  assert.notDeepEqual(generate(99, 12).cells, generate(100, 12).cells);
  assert.ok([1, 2, 3, 4, 5].some(i => JSON.stringify(generate(99, i).rows[0]) !== JSON.stringify(generate(99, i).rows[1])), 'tracks differ');
  assert.equal(a.z0, 12 * CHUNK_LEN); assert.equal(a.rows.length, TRACKS); assert.equal(a.rows[0].length, BEATS);
  assert.ok(a.cells.every(c => c.track === 0 || c.track === 1));
});

test('every track of every chunk is solvable (2000 seeds x 60 chunks x 2 tracks)', () => {
  let n = 0; const kinds = new Set();
  for (let s = 1; s <= 2000; s++) for (let i = 0; i < 60; i++) {
    const c = generate(s, i);
    for (let t = 0; t < TRACKS; t++) {
      const rows = c.rows[t];
      for (const mask of rows) assert.ok(mask.filter(x => BLOCKING.has(x)).length <= LANES - 1, `seed ${s} chunk ${i} track ${t}: row fully blocked`);
      assert.ok(rows.at(-1).every(x => x === null), `seed ${s} chunk ${i}: breath beat not clear`);
      assert.ok(pathExists(rows), `seed ${s} chunk ${i} track ${t}: no path`);
      n++;
    }
    for (const cell of c.cells) {
      if (cell.type === 'wide') { assert.equal(cell.span, 2); assert.ok(cell.lane <= LANES - 2); }
      if (cell.type === 'roller') { assert.ok(cell.lane + cell.dir >= 0 && cell.lane + cell.dir < LANES); for (let k = 0; k < cell.period; k += 7) { const l = rollerLaneAt(cell, k); assert.ok(l >= -1e-9 && l <= LANES - 1 + 1e-9); } }
      if (cell.type === 'power') { kinds.add(cell.kind); const row = c.rows[cell.track].find(r => Math.abs(r.z - cell.z) < 3.1); if (row) assert.equal(row[cell.lane], null, 'power in a blocked lane'); }
    }
  }
  assert.equal(n, 240000);
  for (const k of POWERS) assert.ok(kinds.has(k), `power ${k} never generated`);
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
