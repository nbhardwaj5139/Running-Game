// The simulation: chunk pool + two runners + the typhoon + powers + scoring.
// Deterministic given (seed, ordered inputs). No rendering here.
import { ChunkPool, LANES, LANES_TOTAL, rollerLaneAt, globalLane, biomeOf, seasonOf, kaijuOf, CHUNK_LEN } from './chunks.js';
import { Player, P, speedAt } from './player.js';
import { autopilot } from './autopilot.js';

export const W = {
  TICK: 1 / 60,
  STORM_START: 30,          // metres of margin between the runners and the typhoon
  STORM_MAX: 34,
  STORM_RECOVER: 0.6,       // m/s regained while running clean
  STORM_DRIFT: 0.45,        // m/s lost at full pressure (pressure rises with distance)
  STORM_STUMBLE: 7,
  STORM_STALK: 11,
  STORM_FALL: 14,
  STORM_COIN: 0.25,
  STORM_HEAL: 14,
  SCORE_COIN: 10, SCORE_NEAR_MISS: 25, SCORE_CLEAR: 5, SCORE_PER_M: 1,
  X2_T: 12,
  CELL_DEPTH: 1.2, GAP_DEPTH: 3.0,
  STALK_PROX: 0.42,         // lane units: how close (continuous) counts as hitting a post
  ROLLER_PROX: 0.6,
  BUMP_DIST: 0.85,          // lane units: closer than this and the runners collide
  BUMP_COOL: 0.35,          // s between bumps
  BUMP_STUMBLE: 0.4,        // s of stumble for the one who gets barged
};

export class World {
  /** @param {number} seed uint32  @param {object} opts { onEvent(evt), invincible } */
  constructor(seed, opts = {}) {
    this.seed = seed; this.opts = opts;
    this.runners = [new Player(0), new Player(1)];
    this.pool = new ChunkPool(seed, { ahead: 6, behind: 1, onRecycle: (o, n) => this._emit({ type: 'recycle', old: o, fresh: n }) });
    this.distance = 0; this.speed = speedAt(0);
    this.storm = W.STORM_START;
    this.score = 0; this.coins = 0; this.streak = 0; this.x2T = 0; this.powers = 0;
    this.tick = 0; this.time = 0;
    this.alive = true; this.deathReason = null;
    this.log = [];                // inputs for replay/validation
    this.resolved = new Set();    // cells already evaluated
    this.section = { biome: biomeOf(0), season: seasonOf(0) };
    this.bumpCool = 0; this.kaiju = null;
  }

  /** The kitsune (right track) — kept for HUD/debug convenience. */
  get player() { return this.runners[1]; }
  get chunkIndex() { return Math.floor(this.distance / CHUNK_LEN); }

  _emit(evt) { if (this.opts.onEvent) this.opts.onEvent(evt); }
  /** The auto-piloted companion is a spirit: its mistakes never cost the pair. */
  _isAuto(p) { return !!this.opts.autopilot?.includes(p.id); }

  /** Local input for one runner (by id: 0 tanuki, 1 kitsune); also logged. */
  input(id, evt) { this.log.push({ t: this.tick, i: { ...evt, track: id } }); this.runners[id].input(evt); }

  step() {
    if (!this.alive) return;
    const dt = W.TICK;
    this.tick++; this.time += dt;

    // --- shared forward motion: the pair runs together, a stumble slows both ---
    const mult = this.runners.some(r => r.stumbleT > 0 && !this._isAuto(r)) ? P.STUMBLE_MULT : 1;
    this.speed = speedAt(this.distance) * mult;
    const prevZ = this.distance;
    this.distance += this.speed * dt;
    this.score += (this.distance - prevZ) * W.SCORE_PER_M * (this.x2T > 0 ? 2 : 1);
    this.x2T = Math.max(0, this.x2T - dt);
    for (const r of this.runners) { r.z = this.distance; if (this._isAuto(r)) autopilot(this, r); r.step(dt); }
    this._bump(dt);

    // --- sections ---
    const idx = this.chunkIndex; const biome = biomeOf(idx), season = seasonOf(idx);
    if (biome !== this.section.biome || season !== this.section.season) { this.section = { biome, season }; this._emit({ type: 'section', biome, season, index: idx }); }
    const kj = kaijuOf(idx);
    if ((kj?.id ?? null) !== (this.kaiju?.id ?? null)) { this.kaiju = kj; this._emit({ type: 'kaiju', kaiju: kj, index: idx }); }

    // --- chunks ---
    this.pool.update(this.distance);

    // --- collisions per runner over its own track ---
    for (const p of this.runners) {
      for (const c of this.pool.live) {
        if (c.z0 > p.z + 4 || c.z0 + c.length < prevZ - 4) continue;
        for (const cell of c.cells) {
          if (cell.track !== p.track) continue;                       // only the track the body is on right now
          const key = `${p.id}:${c.index}:${cell.z}:${cell.track}:${cell.lane}:${cell.type}`;
          if (this.resolved.has(key)) continue;
          const zc = cell.z, g = globalLane(cell.track, cell.lane);
          if (cell.type === 'stalk' || cell.type === 'wide' || cell.type === 'roller') {
            // solids are checked continuously while overlapping (you can clip them mid lane-change)
            const front = zc - W.CELL_DEPTH / 2, back = zc + W.CELL_DEPTH / 2;
            if (p.z >= front && prevZ <= back) {
              let hit = false;
              if (cell.type === 'stalk') hit = Math.abs(p.xLane - g) < W.STALK_PROX + (p.laneT < 1 ? 0.15 : 0);
              else if (cell.type === 'wide') hit = p.xLane > g - 0.5 && p.xLane < g + 1.5;
              else hit = Math.abs(p.xLane - (cell.track * LANES + rollerLaneAt(cell, this.tick))) < W.ROLLER_PROX;
              if (hit) { this.resolved.add(key); this._hitSolid(cell, p); }
              else if (p.z >= zc) {
                this.resolved.add(key);
                if (cell.type === 'stalk' && Math.abs(p.lane - g) === 1 && p.stumbleT === 0) this._nearMiss(cell, p);
                else this._clean(cell, p, cell.type !== 'stalk');
              }
            }
            continue;
          }
          if (prevZ < zc && p.z >= zc) {
            this.resolved.add(key);
            const onLane = cell.type === 'wave' || Math.abs(p.xLane - g) < 0.5;   // continuous: where the body actually is; waves span the road
            if (cell.type === 'photon') { if (onLane || p.magnetT > 0) this._coin(cell, p); continue; }
            if (cell.type === 'power') { if (onLane || p.magnetT > 0) this._power(cell, p); continue; }
            if (!onLane) {
              if (cell.type === 'gap' && Math.abs(p.lane - g) === 1 && p.stumbleT === 0 && p.y === 0) this._nearMiss(cell, p);
              continue;
            }
            this._resolveCell(cell, p);
          }
        }
      }
    }

    // --- the typhoon ---
    const pressure = W.STORM_DRIFT * Math.min(1, this.distance / 2500);
    const clean = this.runners.every(r => r.stumbleT === 0);
    this.storm = Math.min(W.STORM_MAX, this.storm + (clean ? W.STORM_RECOVER : 0) * dt - pressure * dt);
    if (this.storm <= 0) this._die('storm');
  }

  /**
   * Runner vs runner. When the two bodies overlap at the same height, the one
   * moving into the other barges it one lane sideways (a shove can put the
   * victim in front of a hazard — that is the sabotage). If the victim is at
   * the road edge, or both are moving into each other, the movers bounce back.
   */
  _bump(dt) {
    this.bumpCool = Math.max(0, this.bumpCool - dt);
    const [a, b] = this.runners;
    if (this.bumpCool > 0 || Math.abs(a.y - b.y) > 0.8) return;          // one is over the other
    const d = b.xLane - a.xLane;
    if (Math.abs(d) >= W.BUMP_DIST) return;
    const sd = Math.sign(d) || 1;
    const towards = (r, dir) => r.laneT < 1 && Math.sign(r.lane - r.laneFromX) === dir;
    const movingA = towards(a, sd), movingB = towards(b, -sd);
    const bounce = (r) => { r.lane = Math.max(0, Math.min(LANES_TOTAL - 1, Math.round(r.laneFromX))); r.laneFromX = r.xLane; r.laneT = 0; r.stumbleT = Math.max(r.stumbleT, W.BUMP_STUMBLE); };
    const shove = (mover, victim, dir) => {
      const target = victim.lane + dir;
      if (target < 0 || target >= LANES_TOTAL) { bounce(mover); this._emit({ type: 'bump', mover: mover.id, victim: -1, dir }); return; }
      victim.laneFromX = victim.xLane; victim.lane = target; victim.laneT = 0; victim.stumbleT = Math.max(victim.stumbleT, W.BUMP_STUMBLE);
      this._emit({ type: 'bump', mover: mover.id, victim: victim.id, dir });
    };
    if (movingA && movingB) { bounce(a); bounce(b); this._emit({ type: 'bump', mover: a.id, victim: b.id, dir: 0 }); }
    else if (movingA) shove(a, b, sd);
    else if (movingB) shove(b, a, -sd);
    else if (a.laneT >= 1 && b.laneT >= 1) { if (b.lane + sd < LANES_TOTAL && b.lane + sd >= 0) shove(a, b, sd); else shove(b, a, -sd); }
    else return;
    this.bumpCool = W.BUMP_COOL;
  }

  _resolveCell(cell, p) {
    if (p.dashT > 0) { this._clean(cell, p, true); return; }
    switch (cell.type) {
      case 'arch': if (p.action === 'slide' || p.iT > 0) this._clean(cell, p, true); else this._stumble(cell, p, W.STORM_STUMBLE); break;
      case 'drusen': case 'wave': if (p.y > 0.5 || p.iT > 0) this._clean(cell, p, true); else this._stumble(cell, p, W.STORM_STUMBLE); break;
      case 'gap': if (p.y > 0.25 || p.iT > 0) this._clean(cell, p, true); else this._fall(cell, p); break;
    }
  }

  _coin(cell, p) {
    if (cell.hi && p.y <= 0.8 && p.magnetT === 0) return;
    const n = this.x2T > 0 ? 2 : 1;
    this.coins += n; this.streak++;
    this.score += W.SCORE_COIN * n * (1 + Math.floor(this.streak / 10) * 0.5);
    this.storm = Math.min(W.STORM_MAX, this.storm + W.STORM_COIN);
    this._emit({ type: 'coin', cell, runner: p.id, streak: this.streak, n });
  }

  _power(cell, p) {
    this.powers++;
    switch (cell.kind) {
      case 'shield': p.shield = true; break;
      case 'magnet': p.magnetT = P.MAGNET_T; break;
      case 'dash': p.dashT = P.DASH_T; p.stumbleT = 0; break;
      case 'x2': this.x2T = W.X2_T; break;
      case 'heal': this.storm = Math.min(W.STORM_MAX, this.storm + W.STORM_HEAL); break;
    }
    this._emit({ type: 'power', cell, kind: cell.kind, runner: p.id });
  }

  _clean(cell, p, scored) { if (scored) this.score += W.SCORE_CLEAR; this._emit({ type: 'clear', cell, runner: p.id }); }

  _nearMiss(cell, p) {
    this.score += W.SCORE_NEAR_MISS;
    this._emit({ type: 'nearmiss', cell, runner: p.id, side: globalLane(cell.track, cell.lane) > p.lane ? 1 : -1 });
  }

  /** A crash into an arch/drusen: the shield eats it, otherwise a stumble costs storm margin. */
  _stumble(cell, p, cost) {
    if (p.shield) { p.shield = false; this._emit({ type: 'shield', cell, runner: p.id }); return; }
    p.stumble();
    if (this._isAuto(p)) { this._emit({ type: 'stumble', cell, runner: p.id, free: true }); return; }
    this.streak = 0;
    this.storm -= cost;
    this._emit({ type: 'stumble', cell, runner: p.id });
    if (this.storm <= 0) this._die('storm', cell);
  }

  _hitSolid(cell, p) {
    if (p.dashT > 0 || p.iT > 0) { this._clean(cell, p, p.dashT > 0); return; }
    // clipped it mid-change: bounce back to the lane you came from
    if (p.laneT < 1) { p.lane = Math.max(0, Math.min(LANES_TOTAL - 1, Math.round(p.laneFromX))); p.laneFromX = p.xLane; p.laneT = 0; }
    this._stumble(cell, p, W.STORM_STALK);
  }

  _fall(cell, p) {
    if (p.shield) { p.shield = false; this._emit({ type: 'shield', cell, runner: p.id }); return; }
    p.respawn();
    if (this._isAuto(p)) { this._emit({ type: 'fall', cell, runner: p.id, free: true }); return; }
    this.streak = 0;
    this.storm -= W.STORM_FALL;
    this._emit({ type: 'fall', cell, runner: p.id });
    if (this.storm <= 0) this._die('fall', cell);
  }

  _die(reason, cell = null) {
    if (!this.alive) return;
    if (this.opts.invincible) { this.storm = Math.max(this.storm, 1); return; }
    this.alive = false; this.deathReason = reason;
    for (const r of this.runners) r.alive = false;
    this._emit({ type: 'death', reason, cell, distance: this.distance, score: Math.floor(this.score) });
  }

  get summary() {
    return { seed: this.seed, distance: Math.floor(this.distance), score: Math.floor(this.score), coins: this.coins, powers: this.powers, reason: this.deathReason, ticks: this.tick };
  }
}

/** Replay a run headlessly from its input log: used to validate a submitted score. */
export function replay(seed, log, maxTicks = 60 * 60 * 30) {
  const w = new World(seed);
  let i = 0;
  while (w.alive && w.tick < maxTicks) {
    while (i < log.length && log[i].t === w.tick) { const e = log[i++]; if (e.i) w.runners[e.i.track ?? 1].input(e.i); }
    w.step();
  }
  return w.summary;
}
