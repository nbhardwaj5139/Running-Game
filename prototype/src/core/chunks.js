// Chunk generator + ring-buffer pool. Pure data: no rendering, no Math.random.
// generate(seed, index) is a pure function so any client can build any chunk
// independently and out of order.
//
// The road is two parallel 3-lane tracks (left = tanuki, right = kitsune).
// Every lane of a track is visible and reachable — there are no hidden lanes.
import { mulberry32, mixSeed } from './rng.js';

export const LANES = 3;                              // per track
export const TRACKS = 2;                             // 0 = left, 1 = right
export const LANE_W = 2.2;
export const TRACK_GAP = 2.6;                        // the median between the tracks
export const TRACK_W = LANES * LANE_W;               // 6.6 m
export const ROAD_HALF = TRACK_W + TRACK_GAP / 2;    // 7.9 m: half of the paved width
export const CHUNK_LEN = 36;
export const BEAT_LEN = 6;                           // one hazard "row" per beat
export const BEATS = CHUNK_LEN / BEAT_LEN;

// Sections: the road cycles through biomes; the year turns more slowly.
export const BIOME_LEN = 8;                          // chunks per biome section (288 m)
export const SEASON_LEN = 14;                        // chunks per season (504 m) — a full year every 2 km
export const BIOMES = ['mountain', 'city', 'suburb', 'coast'];
export const SEASONS = ['spring', 'summer', 'fall', 'winter'];
export const biomeOf = (index) => Math.floor(Math.max(0, index) / BIOME_LEN) % BIOMES.length;
export const seasonOf = (index) => Math.floor(Math.max(0, index) / SEASON_LEN) % SEASONS.length;
/** 0..1 progress through the current season section (for blends at the boundary). */
export const seasonBlend = (index) => (Math.max(0, index) % SEASON_LEN) / SEASON_LEN;

export const laneX = (lane) => (lane - (LANES - 1) / 2) * LANE_W;
export const trackX = (track) => (track - (TRACKS - 1) / 2) * (TRACK_W + TRACK_GAP);   // -4.6 / +4.6
export const cellX = (cell) => trackX(cell.track) + laneX(cell.lane);

// Cell types (the verb that clears them):
//   stalk  — a solid post: change lane            arch   — something overhead: slide
//   drusen — something low: jump                  gap    — a hole: jump
//   wide   — blocks two adjacent lanes (lane = left one, span 2): take the third lane
//   roller — sweeps between lane and lane+dir over `period` ticks: take the lane it never visits, or time it
//   photon — a coin (hi: floats above a jump)     power  — a pickup {kind}
export const BLOCKING = new Set(['stalk', 'gap', 'wide', 'roller']);
export const ACTION = { arch: 'slide', drusen: 'jump' };
export const POWERS = ['shield', 'magnet', 'dash', 'x2', 'heal'];
const POWER_WEIGHTS = [0.26, 0.24, 0.2, 0.15, 0.15];
export const VARIANTS = 4;                           // visual variants per obstacle type (renderer picks props)

export const TUNING = {
  hazardsMin: [0, 1],      // [at diff 0, at diff 1]
  hazardsMax: [1, 2],
  blockingShare: [0.2, 0.5],
  comboChance: [0, 0.3],   // arch then drusen next beat in the same lane
  wideChance: [0, 0.22],   // a two-lane block instead of a single hazard
  rollerChance: [0, 0.16],
  wallEvery: 6,            // in chunks, once diff > 0.7: a torii wall with one slide-through lane
  releaseBelow: 0.2,       // wave value under which a chunk is a "release" chunk
  powerChance: 0.3,        // per track per chunk
};

function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

/** Breathing difficulty: a base ramp modulated by a tension/release wave. */
export function difficultyAt(seed, index) {
  const period = 5 + (mixSeed(seed, 0xbeef) % 3); // 5..7, fixed per seed
  const base = Math.min(1, 0.2 + 0.8 * (1 - Math.exp(-index / 32)));
  const phase = (index % period) / period;
  const wave = phase < 0.7 ? smoothstep(0, 0.7, phase) : 1 - smoothstep(0.7, 1, phase);
  return { diff: base * (0.55 + 0.45 * wave), wave, base, period };
}

const passable = (mask, lane) => !BLOCKING.has(mask[lane]);

/** Reach set for a fresh track: every passable lane. */
export function initialReach(mask = null) {
  const r = new Array(LANES).fill(false);
  for (let l = 0; l < LANES; l++) r[l] = !mask || passable(mask, l);
  return r;
}

/**
 * Solvability grammar. `reach` is the set of lanes the runner can be in after the
 * previous row (a one-step check against the previous mask is not enough — a lane
 * can be passable but unreachable). Returns the new reach set, or null if the row
 * cannot be passed.
 */
export function stepReach(mask, reach, prev = null) {
  let blocking = 0;
  for (let l = 0; l < LANES; l++) if (BLOCKING.has(mask[l])) blocking++;
  if (blocking > LANES - 1) return null;
  const r = new Array(LANES).fill(false);
  let any = false;
  for (let l = 0; l < LANES; l++) {
    if (!passable(mask, l)) continue;
    for (let d = -1; d <= 1; d++) {
      const p = l + d;
      if (p < 0 || p >= LANES || !reach[p]) continue;
      // no forced double-action: arch->drusen (or reverse) in one lane when you can't step aside
      if (d === 0 && prev && ACTION[mask[l]] && ACTION[prev[l]] && ACTION[mask[l]] !== ACTION[prev[l]]) {
        const leftOk = l - 1 >= 0 && reach[l - 1] && passable(mask, l - 1);
        const rightOk = l + 1 < LANES && reach[l + 1] && passable(mask, l + 1);
        if (!leftOk && !rightOk) continue;
      }
      r[l] = true; any = true; break;
    }
  }
  return any ? r : null;
}

export function rowSolvable(mask, prev = null) { return stepReach(mask, initialReach(prev), prev) !== null; }

function weightedPick(rng, items, weights) {
  let t = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { t -= weights[i]; if (t <= 0) return items[i]; }
  return items[items.length - 1];
}

/** One track's worth of rows and cells. Pure in (seed, index, track). */
function generateTrack(seed, index, track, diff, wave, z0) {
  const rng = mulberry32(mixSeed(mixSeed(seed, index), 0x7a + track));
  const cells = [], rows = [];
  const release = wave < TUNING.releaseBelow && index > 2;
  const wall = !release && diff > 0.7 && index % TUNING.wallEvery === 0;
  let reach = initialReach();
  let prev = null;
  const empty = () => new Array(LANES).fill(null);
  const v = () => rng.int(0, VARIANTS - 1);

  const hMin = Math.round(lerp(TUNING.hazardsMin[0], TUNING.hazardsMin[1], diff));
  const hMax = Math.round(lerp(TUNING.hazardsMax[0], TUNING.hazardsMax[1], diff));
  const blockShare = lerp(TUNING.blockingShare[0], TUNING.blockingShare[1], diff);
  const comboChance = lerp(TUNING.comboChance[0], TUNING.comboChance[1], diff);
  const wideChance = lerp(TUNING.wideChance[0], TUNING.wideChance[1], diff);
  const rollerChance = lerp(TUNING.rollerChance[0], TUNING.rollerChance[1], diff);

  const commit = (mask) => {
    for (let l = 0; l < LANES; l++) {
      const t = mask[l]; if (!t) continue;
      if (t === 'wide') { if (mask.wideLeft === l) cells.push({ z: mask.z, lane: l, track, type: 'wide', span: 2, v: v() }); continue; }
      if (t === 'roller') { if (mask.rollerLane === l) cells.push({ z: mask.z, lane: l, track, type: 'roller', dir: mask.rollerDir, period: mask.rollerPeriod, v: v() }); continue; }
      cells.push({ z: mask.z, lane: l, track, type: t, v: v(), wall: !!mask.wall });
    }
    rows.push(mask);
    reach = stepReach(mask, reach, prev) || initialReach(mask);   // never null for committed masks; defensive
    prev = mask;
  };

  for (let b = 0; b < BEATS; b++) {
    const zb = z0 + b * BEAT_LEN + BEAT_LEN * 0.5;
    const breath = b === BEATS - 1;                 // last beat: always clear, so chunks never depend on each other
    const wallTelegraph = wall && b === 2;          // clear beat before the wall
    if (index === 0 || release || breath || wallTelegraph) { const m = empty(); m.z = zb; commit(m); continue; }

    if (wall && b === 3) {
      // Torii wall: posts in two lanes, a gate you must slide under in the third. The beat
      // before is clear, so every lane is reachable and the wall is always fair.
      const open = rng.int(0, LANES - 1);
      const m = empty(); m.z = zb; m.wall = true;
      for (let l = 0; l < LANES; l++) m[l] = l === open ? 'arch' : 'stalk';
      if (stepReach(m, reach, prev)) { commit(m); continue; }
      const e = empty(); e.z = zb; commit(e); continue;
    }

    let mask, tries = 0;
    do {
      mask = empty(); mask.z = zb;
      if (rng.chance(wideChance)) {
        const left = rng.int(0, LANES - 2);
        mask[left] = mask[left + 1] = 'wide'; mask.wideLeft = left;
      } else if (rng.chance(rollerChance)) {
        const l0 = rng.int(0, LANES - 1); const dir = l0 === 0 ? 1 : l0 === LANES - 1 ? -1 : (rng.chance(0.5) ? 1 : -1);
        mask[l0] = mask[l0 + dir] = 'roller'; mask.rollerLane = l0; mask.rollerDir = dir; mask.rollerPeriod = 150 + rng.int(0, 60);
      } else {
        const count = rng.int(hMin, hMax);
        const lanes = [0, 1, 2];
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
      }
      tries++;
    } while (!stepReach(mask, reach, prev) && tries < 12);
    if (!stepReach(mask, reach, prev)) { mask = empty(); mask.z = zb; }   // give up: an empty row is always fair
    commit(mask);
  }

  // ---- pickups -------------------------------------------------------
  const freeLanes = (mask) => { const f = []; for (let l = 0; l < LANES; l++) if (!mask[l]) f.push(l); return f; };
  for (let b = 0; b < BEATS; b++) {
    const mask = rows[b];
    const zb = z0 + b * BEAT_LEN;
    if (release || index === 0) {
      const l = (index + b + track) % LANES;
      for (let i = 0; i < 4; i++) cells.push({ z: zb + 0.75 + i * 1.5, lane: l, track, type: 'photon' });
      continue;
    }
    for (let l = 0; l < LANES; l++) if (mask[l] === 'drusen') {
      for (let i = -1; i <= 1; i++) cells.push({ z: zb + BEAT_LEN * 0.5 + i * 1.0, lane: l, track, type: 'photon', hi: true });
    }
    if (rng.chance(0.55)) {
      const free = freeLanes(mask);
      if (free.length) { const l = rng.pick(free); for (let i = 0; i < 3; i++) cells.push({ z: zb + 1 + i * 1.6, lane: l, track, type: 'photon' }); }
    }
  }
  if (index > 1 && rng.chance(TUNING.powerChance)) {
    const b = rng.int(1, BEATS - 2); const free = freeLanes(rows[b]);
    if (free.length) cells.push({ z: z0 + b * BEAT_LEN + 3, lane: rng.pick(free), track, type: 'power', kind: weightedPick(rng, POWERS, POWER_WEIGHTS), v: v() });
  }
  return { cells, rows, release, wall };
}

/**
 * Pure: (seed, index) -> Chunk with both tracks. The last beat of every track is
 * always clear (the "breath beat"), so chunks never depend on each other.
 */
export function generate(seed, index) {
  const { diff, wave } = difficultyAt(seed, index);
  const z0 = index * CHUNK_LEN;
  const tracks = [];
  for (let t = 0; t < TRACKS; t++) tracks.push(generateTrack(seed, index, t, diff, wave, z0));
  const cells = tracks.flatMap(t => t.cells).sort((a, b) => a.z - b.z);
  return { index, z0, length: CHUNK_LEN, difficulty: diff, wave, release: tracks[0].release, wall: tracks.some(t => t.wall),
    biome: biomeOf(index), season: seasonOf(index), cells, rows: tracks.map(t => t.rows) };
}

/**
 * Ring-buffer pool. Keeps AHEAD chunks in front of the runners and BEHIND
 * behind; recycles the oldest into the newest. `onRecycle(old, fresh)` lets a
 * renderer move pooled meshes without allocating.
 */
export class ChunkPool {
  constructor(seed, { ahead = 6, behind = 1, onRecycle = null } = {}) {
    this.seed = seed; this.ahead = ahead; this.behind = behind; this.onRecycle = onRecycle;
    this.live = []; this.nextIndex = 0;
    for (let i = 0; i < ahead + behind + 1; i++) this._spawn();
  }
  _spawn() { const c = generate(this.seed, this.nextIndex++); this.live.push(c); return c; }
  /** Advance the window so `z` sits at slot `behind`. Returns recycled count. */
  update(z) {
    let n = 0;
    while (this.live.length && this.live[0].z0 + this.live[0].length < z - this.behind * CHUNK_LEN) {
      const old = this.live.shift(); const fresh = this._spawn();
      if (this.onRecycle) this.onRecycle(old, fresh);
      n++;
    }
    return n;
  }
  chunkAt(z) { return this.live.find(c => z >= c.z0 && z < c.z0 + c.length) || null; }
}

/** Where a roller is at sim tick t: a continuous sweep between lane and lane+dir. */
export function rollerLaneAt(cell, tick) {
  const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * tick) / cell.period);
  return cell.lane + cell.dir * phase;
}
