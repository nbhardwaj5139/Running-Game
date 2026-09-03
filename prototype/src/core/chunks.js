// Chunk generator + ring-buffer pool. Pure data: no rendering, no Math.random.
// generate(seed, index) is a pure function so any client can build any chunk
// independently and out of order — which is what makes multiplayer cheap.
import { mulberry32, mixSeed } from './rng.js';

export const LANES = 5;          // world lanes; the runner sees a 3-lane window
export const WINDOW = 3;
export const LANE_W = 2.2;
export const CHUNK_LEN = 36;
export const BEAT_LEN = 6;       // one hazard "row" per beat
export const BEATS = CHUNK_LEN / BEAT_LEN;

export const BLOCKING = new Set(['stalk', 'gap']);   // lethal / forced lane change
export const ACTION = { arch: 'slide', drusen: 'jump' };

export const TUNING = {
  hazardsMin: [0, 1],      // [at diff 0, at diff 1]
  hazardsMax: [1, 2],
  tripleAt: 0.85,          // diff above which a 3rd hazard may appear
  blockingShare: [0.2, 0.55],
  comboChance: [0, 0.3],   // arch then drusen next beat in the same lane
  clotEvery: 6,            // in chunks, once diff > 0.7
  releaseBelow: 0.2,       // wave value under which a chunk is a "release" chunk
};

export function laneX(lane) { return (lane - (LANES - 1) / 2) * LANE_W; }

function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

/** Breathing difficulty: a base ramp modulated by a tension/release wave. */
export function difficultyAt(seed, index) {
  const period = 5 + (mixSeed(seed, 0xbeef) % 3); // 5..7, fixed per seed
  const base = Math.min(1, 0.15 + 0.85 * (1 - Math.exp(-index / 40)));
  const phase = (index % period) / period;
  const wave = phase < 0.7 ? smoothstep(0, 0.7, phase) : 1 - smoothstep(0.7, 1, phase);
  return { diff: base * (0.55 + 0.45 * wave), wave, base, period };
}

function passable(mask, lane) { return !BLOCKING.has(mask[lane]); }

/** All lanes of window w that are passable in `mask` — the reach set for a fresh chunk. */
export function initialReach(mask = null) {
  const reach = [];
  for (let w = 0; w <= LANES - WINDOW; w++) {
    const r = new Array(LANES).fill(false);
    for (let l = w; l < w + WINDOW; l++) r[l] = !mask || passable(mask, l);
    reach.push(r);
  }
  return reach;
}

/**
 * Solvability grammar (see TECHNICAL_BLUEPRINT §1.4). `reach[w]` is the set of
 * lanes the runner can actually be in after the previous row, for each window
 * position w (a one-step check against the previous *mask* is not enough — a
 * lane can be passable but unreachable). Returns the new reach sets, or null
 * if any window has no way through.
 */
export function stepReach(mask, reach, prev = null) {
  let blocking = 0;
  for (let l = 0; l < LANES; l++) if (BLOCKING.has(mask[l])) blocking++;
  if (blocking > 2 && !mask.clot) return null;
  const out = [];
  for (let w = 0; w <= LANES - WINDOW; w++) {
    const r = new Array(LANES).fill(false);
    let any = false;
    for (let l = w; l < w + WINDOW; l++) {
      if (!passable(mask, l)) continue;
      for (let d = -1; d <= 1; d++) {
        const p = l + d;
        if (p < w || p >= w + WINDOW || !reach[w][p]) continue;
        // no forced double-action: arch->drusen (or reverse) in one lane when you can't step aside
        if (d === 0 && prev && ACTION[mask[l]] && ACTION[prev[l]] && ACTION[mask[l]] !== ACTION[prev[l]]) {
          const leftOk = l - 1 >= w && reach[w][l - 1] && passable(mask, l - 1);
          const rightOk = l + 1 < w + WINDOW && reach[w][l + 1] && passable(mask, l + 1);
          if (!leftOk && !rightOk) continue;
        }
        r[l] = true; any = true; break;
      }
    }
    if (!any) return null;
    out.push(r);
  }
  return out;
}

/** Convenience: is `mask` solvable after `prev` (or from a fresh start)? */
export function rowSolvable(mask, prev = null) {
  return stepReach(mask, initialReach(prev), prev) !== null;
}

/**
 * Pure: (seed, index) -> Chunk. The last beat of every chunk is always clear
 * (the "breath beat"), so chunks never depend on each other and any client can
 * generate any chunk in any order.
 */
export function generate(seed, index) {
  const rng = mulberry32(mixSeed(seed, index));
  const { diff, wave } = difficultyAt(seed, index);
  const z0 = index * CHUNK_LEN;
  const cells = [];
  const rows = [];
  const release = wave < TUNING.releaseBelow && index > 2;
  const clot = !release && diff > 0.7 && index % TUNING.clotEvery === 0;
  let reach = initialReach();
  let prev = null;
  const empty = () => new Array(LANES).fill(null);

  const hMin = Math.round(lerp(TUNING.hazardsMin[0], TUNING.hazardsMin[1], diff));
  const hMax = Math.round(lerp(TUNING.hazardsMax[0], TUNING.hazardsMax[1], diff));
  const blockShare = lerp(TUNING.blockingShare[0], TUNING.blockingShare[1], diff);
  const comboChance = lerp(TUNING.comboChance[0], TUNING.comboChance[1], diff);

  const commit = (mask) => {
    for (let l = 0; l < LANES; l++) if (mask[l]) cells.push({ z: mask.z, lane: l, type: mask[l], clot: !!mask.clot });
    rows.push(mask);
    const next = stepReach(mask, reach, prev);
    reach = next || initialReach(mask); // never null for masks we commit; defensive
    prev = mask;
  };

  for (let b = 0; b < BEATS; b++) {
    const zb = z0 + b * BEAT_LEN + BEAT_LEN * 0.5;
    const breath = b === BEATS - 1;                 // last beat: always clear
    const clotTelegraph = clot && b === 2;          // clear beat before the wall

    if (index === 0 || release || breath || clotTelegraph) { const m = empty(); m.z = zb; commit(m); continue; }

    if (clot && b === 3) {
      // Macular clot: a wall of stalks with one open lane (1..3) whose neighbours are
      // slide-able arches, so every 3-lane window keeps an escape. The beat before it is
      // clear, so every lane is reachable and the wall is always fair.
      const open = rng.int(1, LANES - 2);
      const m = empty(); m.z = zb; m.clot = true;
      for (let l = 0; l < LANES; l++) m[l] = l === open ? null : Math.abs(l - open) === 1 ? 'arch' : 'stalk';
      if (stepReach(m, reach, prev)) { commit(m); continue; }
      const e = empty(); e.z = zb; commit(e); continue;
    }

    let count = rng.int(hMin, hMax);
    if (diff > TUNING.tripleAt && rng.chance(0.25)) count = 3;

    let mask, tries = 0;
    do {
      mask = empty(); mask.z = zb;
      const lanes = [0, 1, 2, 3, 4];
      for (let i = 0; i < count && lanes.length; i++) {
        const l = lanes.splice(Math.floor(rng() * lanes.length), 1)[0];
        const blocking = rng.chance(blockShare);
        mask[l] = blocking ? (rng.chance(0.35) ? 'gap' : 'stalk') : (rng.chance(0.5) ? 'arch' : 'drusen');
      }
      // combo: continue an action lane from the previous row with the *other* action
      if (prev && rng.chance(comboChance)) {
        const l = rng.int(0, LANES - 1);
        if (ACTION[prev[l]] && !mask[l]) mask[l] = prev[l] === 'arch' ? 'drusen' : 'arch';
      }
      tries++;
    } while (!stepReach(mask, reach, prev) && tries < 12);
    if (!stepReach(mask, reach, prev)) { mask = empty(); mask.z = zb; } // give up: an empty row is always fair
    commit(mask);
  }

  // ---- pickups -------------------------------------------------------
  // photon lines in a passable lane per row; over-jump arcs above drusen; lumen (nerve) rarely
  for (let b = 0; b < BEATS; b++) {
    const mask = rows[b];
    const zb = z0 + b * BEAT_LEN;
    if (release || index === 0) {
      const l = 1 + ((index + b) % 3);
      for (let i = 0; i < 4; i++) cells.push({ z: zb + 0.75 + i * 1.5, lane: l, type: 'photon' });
      if (release && b === 1) cells.push({ z: zb, lane: 2, type: 'channel', len: CHUNK_LEN - BEAT_LEN * 2 });
      continue;
    }
    for (let l = 0; l < LANES; l++) {
      if (mask[l] === 'drusen') {
        for (let i = -1; i <= 1; i++) cells.push({ z: zb + BEAT_LEN * 0.5 + i * 1.0, lane: l, type: 'photon', hi: true });
      }
    }
    if (rng.chance(0.55)) {
      const free = [];
      for (let l = 0; l < LANES; l++) if (!mask[l]) free.push(l);
      if (free.length) {
        const l = rng.pick(free);
        for (let i = 0; i < 3; i++) cells.push({ z: zb + 1 + i * 1.6, lane: l, type: 'photon' });
      }
    }
    if (rng.chance(0.06)) {
      const free = [];
      for (let l = 0; l < LANES; l++) if (!mask[l]) free.push(l);
      if (free.length) cells.push({ z: zb + 3, lane: rng.pick(free), type: 'lumen' });
    }
  }

  cells.sort((a, b) => a.z - b.z);
  return { index, z0, length: CHUNK_LEN, difficulty: diff, wave, release, clot, cells, rows };
}

/**
 * Ring-buffer pool. Keeps AHEAD chunks in front of the runner and BEHIND
 * behind; recycles the oldest into the newest. `onRecycle(old, fresh)` lets a
 * renderer move pooled meshes without allocating.
 */
export class ChunkPool {
  constructor(seed, { ahead = 6, behind = 1, onRecycle = null } = {}) {
    this.seed = seed;
    this.ahead = ahead;
    this.behind = behind;
    this.onRecycle = onRecycle;
    this.live = [];
    this.nextIndex = 0;
    for (let i = 0; i < ahead + behind + 1; i++) this._spawn();
  }
  _spawn() {
    const c = generate(this.seed, this.nextIndex++);
    this.live.push(c);
    return c;
  }
  /** Advance the window so `playerZ` sits at slot `behind`. Returns recycled count. */
  update(playerZ) {
    let n = 0;
    while (this.live.length && this.live[0].z0 + this.live[0].length < playerZ - this.behind * CHUNK_LEN) {
      const old = this.live.shift();
      const fresh = this._spawn();
      if (this.onRecycle) this.onRecycle(old, fresh);
      n++;
    }
    return n;
  }
  chunkAt(z) { return this.live.find(c => z >= c.z0 && z < c.z0 + c.length) || null; }
}
