// Autopilot for the companion runner in single-player: scores the lanes over the
// next two hazard rows on its track and issues ordinary inputs (which are
// logged, so replays stay pure). Deterministic — decisions derive only from sim state.
import { LANES, LANES_TOTAL, globalLane } from './chunks.js';
import { P } from './player.js';

const LANE_CHANGE_M = (speed) => speed * (P.LANE_T + 0.12);   // metres a lane change needs at this speed, with margin
const ACT_M = (speed) => speed * 0.3;                          // jump/slide this far before the hazard

/** Per-lane verdict for a row: 'free' | 'jump' | 'slide' | 'block'. */
function verdicts(row) {
  const v = new Array(LANES_TOTAL).fill('free');
  for (const c of row) {
    const g = globalLane(c.track, c.lane);
    if (c.type === 'wave') { for (let l = 0; l < LANES; l++) v[c.track * LANES + l] = v[c.track * LANES + l] === 'block' ? 'block' : 'jump'; }
    else if (c.type === 'wide') { v[g] = 'block'; v[g + 1] = 'block'; }
    else if (c.type === 'roller') { v[g] = 'block'; v[g + c.dir] = 'block'; }
    else if (c.type === 'stalk') v[g] = 'block';
    else if (c.type === 'gap' || c.type === 'drusen') v[g] = 'jump';
    else if (c.type === 'arch') v[g] = 'slide';
  }
  return v;
}
const FREE = new Array(LANES_TOTAL).fill('free');

export function autopilot(world, p) {
  const speed = world.speed;
  const ahead = 4 + Math.min(16, speed * 0.7);
  const rows = new Map(); const coins = new Array(LANES_TOTAL).fill(0);
  // The companion keeps to its home track, and — while the road is forked — to the road it
  // was locked onto, which may be narrower than that track or straddle the seam between two.
  const home = p.home;
  let lo = Math.max(p.laneMin, home * LANES), hi = Math.min(p.laneMax, home * LANES + LANES - 1);
  if (lo > hi) { lo = p.laneMin; hi = p.laneMax; }
  const others = world.runners.filter(r => r !== p && !r.disabled);
  for (const c of world.pool.live) {
    if (c.z0 > p.z + ahead || c.z0 + c.length < p.z - 1) continue;
    for (const cell of c.cells) {
      if (cell.track !== home || cell.z < p.z - 0.7 || cell.z > p.z + ahead) continue;
      if (cell.type === 'photon' || cell.type === 'power') { if (cell.z > p.z) coins[globalLane(cell.track, cell.lane)] += cell.type === 'power' ? 5 : 1; continue; }
      const k = Math.round(cell.z); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(cell);
    }
  }
  const keys = [...rows.keys()].sort((a, b) => a - b);
  p.ai ??= { rowZ: -1, acted: false };
  const z0 = keys[0], v0 = z0 !== undefined ? verdicts(rows.get(z0)) : FREE;
  const v1 = keys[1] !== undefined ? verdicts(rows.get(keys[1])) : FREE;
  const dz0 = z0 !== undefined ? z0 - p.z : Infinity;
  if (z0 !== undefined && p.ai.rowZ !== z0) p.ai = { rowZ: z0, acted: false };

  // --- fast-fall once the hazard we jumped is behind us and the next row is close ---
  if (!p.grounded && p.vy < 3 && dz0 < 8 && dz0 > 1.5 && v0[p.lane] !== 'jump') { world.input(p.id, { kind: 'slide' }); return; }

  // --- choose a lane: free now, free next, coins, proximity ---
  if (p.laneT >= 1 && dz0 > LANE_CHANGE_M(speed)) {
    let best = p.lane, bestScore = -Infinity;
    for (let l = lo; l <= hi; l++) {
      if (Math.abs(l - p.lane) > 1) continue;
      let s = v0[l] === 'free' ? 10 : v0[l] === 'block' ? -100 : 4;
      s += v1[l] === 'free' ? 3 : v1[l] === 'block' ? -2 : 0;
      s += coins[l] * 1.5 - Math.abs(l - p.lane) * 1.2;
      if (others.some(o => Math.abs(l - o.xLane) < 1.2)) s -= 40;          // never barge anyone else
      if (s > bestScore) { bestScore = s; best = l; }
    }
    if (best !== p.lane) { world.input(p.id, { kind: 'lane', dir: Math.sign(best - p.lane) }); return; }
  }

  // --- act on the lane we are in / heading to ---
  const need = v0[p.lane];
  if (!p.ai.acted && dz0 <= ACT_M(speed) && dz0 > 0.3 && p.grounded) {
    if (need === 'jump') { world.input(p.id, { kind: 'jump' }); p.ai.acted = true; }
    else if (need === 'slide') { world.input(p.id, { kind: 'slide' }); p.ai.acted = true; }
  }
}
