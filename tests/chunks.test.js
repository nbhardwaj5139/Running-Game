import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, ChunkPool, rowSolvable, initialReach, stepReach, LANES, WINDOW, CHUNK_LEN, BLOCKING, BEATS, difficultyAt } from '../prototype/src/core/chunks.js';

const passable = (mask, l) => !BLOCKING.has(mask[l]);

/** DP: is there a lane path through `rows` starting from any lane in window w, one lane step per row? */
function pathExists(rows, w, startRow = null) {
  let reach = new Array(LANES).fill(false);
  for (let l = w; l < w + WINDOW; l++) reach[l] = startRow ? passable(startRow, l) : true;
  for (const mask of rows) {
    const next = new Array(LANES).fill(false);
    for (let l = w; l < w + WINDOW; l++) {
      if (!passable(mask, l)) continue;
      for (let d = -1; d <= 1; d++) { const p = l + d; if (p >= w && p < w + WINDOW && reach[p]) next[l] = true; }
    }
    reach = next;
    if (!reach.some(Boolean)) return false;
  }
  return true;
}

test('generate is pure and deterministic', () => {
  const a = generate(99, 12), b = generate(99, 12);
  assert.deepEqual(a, b);
  assert.notDeepEqual(generate(99, 12).cells, generate(100, 12).cells);
  assert.equal(a.z0, 12 * CHUNK_LEN);
  assert.equal(a.rows.length, BEATS);
});

test('every chunk is solvable from every window position (2000 seeds x 60 chunks)', () => {
  let chunks = 0;
  for (let s = 1; s <= 2000; s++) {
    for (let i = 0; i < 60; i++) {
      const c = generate(s, i);
      for (const mask of c.rows) {
        assert.ok(mask.filter(t => BLOCKING.has(t)).length <= 2 || mask.clot, `seed ${s} chunk ${i}: >2 blocking`);
      }
      assert.ok(c.rows.at(-1).every(t => t === null), `seed ${s} chunk ${i}: breath beat not clear`);
      for (let w = 0; w <= LANES - WINDOW; w++) {
        assert.ok(pathExists(c.rows, w, null), `seed ${s} chunk ${i} window ${w}: no path`);
      }
      chunks++;
    }
  }
  assert.equal(chunks, 120000);
});

test('rowSolvable rejects an unwinnable row', () => {
  assert.equal(rowSolvable(['stalk', 'stalk', 'stalk', null, null], null), false);
  assert.equal(rowSolvable(['stalk', 'gap', null, null, null], null), true);
  // forced double action: arch after drusen in lane 1 with neighbours blocked
  const prev = ['stalk', 'drusen', 'stalk', null, null];
  assert.equal(rowSolvable(['stalk', 'arch', 'stalk', null, null], prev), false);
  // passable-but-unreachable: lane 0 is passable in both rows but only lane 2 was reachable
  const reach = initialReach(); reach[0] = [false, false, true, false, false];
  assert.equal(stepReach(['gap', 'stalk', 'stalk', null, null], reach, null), null);
});

test('difficulty breathes: has release beats and ramps toward 1', () => {
  const ds = Array.from({ length: 200 }, (_, i) => difficultyAt(5, i).diff);
  assert.ok(ds[199] > 0.5 && ds[199] <= 1);
  assert.ok(Math.max(...ds.slice(150)) > Math.min(...ds.slice(150)) + 0.2, 'no tension/release swing late in the run');
  const releases = Array.from({ length: 60 }, (_, i) => generate(5, i)).filter(c => c.release).length;
  assert.ok(releases >= 4, `expected release chunks, got ${releases}`);
});

test('pool recycles in order, never allocates beyond ring size, calls onRecycle', () => {
  const events = [];
  const pool = new ChunkPool(7, { ahead: 4, behind: 1, onRecycle: (o, n) => events.push([o.index, n.index]) });
  assert.equal(pool.live.length, 6);
  assert.deepEqual(pool.live.map(c => c.index), [0, 1, 2, 3, 4, 5]);
  pool.update(CHUNK_LEN * 2.5);      // runner in chunk 2 -> chunk 0 is > 1 chunk behind
  assert.deepEqual(pool.live.map(c => c.index), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(events, [[0, 6]]);
  pool.update(CHUNK_LEN * 10);
  assert.equal(pool.live.length, 6);
  assert.equal(pool.live[0].index, 8);
  assert.equal(pool.chunkAt(CHUNK_LEN * 10).index, 10);
  // chunks generated via the pool are identical to standalone generation (no seam state)
  assert.deepEqual(pool.chunkAt(CHUNK_LEN * 10), generate(7, 10));
});
