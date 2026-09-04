// The simulation: chunk pool + two runners + the typhoon + powers + scoring.
// Deterministic given (seed, ordered inputs). No rendering here.
import { ChunkPool, LANES, LANES_TOTAL, rollerLaneAt, globalLane, spawnLane, forkAt, groupOf, biomeOf, seasonOf, kaijuOf, provinceOf, weatherOf, setpieceAt, crossingAt, SETPIECE, CHUNK_LEN, DIFFICULTY } from './chunks.js';
import { mulberry32, mixSeed } from './rng.js';
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
  BUMP_COOL: 0.35,          // s between bumps, per pair
  BUMP_STUMBLE: 0.4,        // s of stumble for the one who gets barged
  MAX_RUNNERS: 12,          // bodies one road will hold; the lockstep itself has no limit
  ROCKET_V: 46,             // m/s the rocket pulls ahead of the runners
  ROCKET_RANGE: 80,         // m before it goes off on its own
  ROCKET_BLAST: 5,          // m either side of the impact
  ROCKET_LANES: 1,          // lanes either side of the impact lane
};
/** What a rocket, a lightning strike or a bell can take off the road. */
const HAZARDS = new Set(['stalk', 'arch', 'drusen', 'gap', 'wide', 'roller', 'wave']);

export class World {
  /**
   * @param {number} seed uint32
   * @param {object} opts { onEvent(evt), invincible, runners } — `runners` is how many
   *   bodies share this road (2 by default; co-op seats as many as joined). Every machine
   *   in a co-op run must construct the World with the SAME count, or the sims diverge.
   */
  constructor(seed, opts = {}) {
    this.seed = seed; this.opts = opts;
    const preset = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    // `forks: false` takes the splits out of the road itself — for two players sharing one
    // screen, where a road that pulled apart would carry one of them out of frame. It is a
    // generation flag, so every machine in a co-op run must agree on it (they all send true).
    this.cfg = opts.forks === false ? { ...preset, forks: false } : preset;
    const n = Math.max(1, Math.min(W.MAX_RUNNERS, opts.runners ?? 2));
    this.runners = [];
    for (let i = 0; i < n; i++) this.runners.push(new Player(i, spawnLane(i, n)));
    if (opts.solo && n === 2) this.runners[0].disabled = true;      // single player: the fox runs alone on the same six-lane road
    this.pool = new ChunkPool(seed, { ahead: 6, behind: 1, cfg: this.cfg, onRecycle: (o, n) => this._emit({ type: 'recycle', old: o, fresh: n }) });
    this.distance = 0; this.speed = speedAt(0, this.cfg);
    this.storm = W.STORM_START;
    this.score = 0; this.coins = 0; this.streak = 0; this.x2T = 0; this.powers = 0;
    this.tick = 0; this.time = 0;
    this.alive = true; this.deathReason = null;
    this.log = [];                // inputs for replay/validation
    this.resolved = new Set();    // cells already evaluated
    this.section = { biome: biomeOf(0), season: seasonOf(0) };
    this.kaiju = null; this.setpiece = null; this.dawnT = 0; this.crossingZ = null;
    this.fork = null; this.forkWarned = -1;
    this.rockets = [];            // bō-hiya in flight: {runner, lane, z, z0}
    this.weather = weatherOf(seed, 0); this.gustRng = mulberry32(mixSeed(seed, 0x9057)); this.nextGust = 6; this.gust = null;
  }

  /** The kitsune (right track) — kept for HUD/debug convenience. */
  get player() { return this.runners[Math.min(1, this.runners.length - 1)]; }
  /** Every body still on the road. */
  get live() { return this.runners.filter(r => !r.disabled); }
  get chunkIndex() { return Math.floor(this.distance / CHUNK_LEN); }

  _emit(evt) { if (this.opts.onEvent) this.opts.onEvent(evt); }
  /** The auto-piloted companion is a spirit: its mistakes never cost the pair. */
  _isAuto(p) { return !!this.opts.autopilot?.includes(p.id); }

  /** Local input for one runner (by index); also logged. Inputs for a seat nobody fills are dropped, not thrown. */
  input(id, evt) { const r = this.runners[id]; if (!r) return; this.log.push({ t: this.tick, i: { ...evt, track: id } }); r.input(evt); }

  step() {
    if (!this.alive) return;
    const dt = W.TICK;
    this.tick++; this.time += dt;

    // --- shared forward motion: the pair runs together, a stumble slows both ---
    let mult = this.runners.some(r => r.stumbleT > 0 && !this._isAuto(r)) ? P.STUMBLE_MULT : 1;
    if (this.runners.some(r => !r.disabled && r.jetpackT > 0)) mult *= 1.8; else if (this.runners.some(r => !r.disabled && r.dashT > 0)) mult *= 1.55;
    this.dawnT = Math.max(0, this.dawnT - dt);
    this.speed = speedAt(this.distance, this.cfg) * mult;
    const prevZ = this.distance;
    this.distance += this.speed * dt;
    const gained = (this.distance - prevZ) * W.SCORE_PER_M * (this.x2T > 0 ? 2 : 1);
    this.score += gained;
    for (const r of this.runners) if (!r.disabled) r.score += gained;   // ground covered counts for everyone still running
    this.x2T = Math.max(0, this.x2T - dt);
    for (const r of this.runners) {
      r.z = this.distance; if (r.disabled) continue; if (this._isAuto(r) || r.guideT > 0) autopilot(this, r); r.step(dt);
      if (r.fire) { r.fire = false; if (r.rocket) { r.rocket = false; this.rockets.push({ runner: r.id, lane: r.lane, z: this.distance + 1.5, z0: this.distance }); this._emit({ type: 'rocket.fire', runner: r.id, lane: r.lane }); } }
    }
    if (this.runners.reduce((n, r) => n + (r.disabled ? 0 : 1), 0) > 1) this._bump(dt);

    // --- sections ---
    const idx = this.chunkIndex; const biome = biomeOf(idx), season = seasonOf(idx);
    if (biome !== this.section.biome || season !== this.section.season) { this.section = { biome, season }; this._emit({ type: 'section', biome, season, province: provinceOf(idx), index: idx }); }
    const kj = kaijuOf(idx);
    if ((kj?.id ?? null) !== (this.kaiju?.id ?? null)) { this.kaiju = kj; this._emit({ type: 'kaiju', kaiju: kj, index: idx }); }
    const sp = setpieceAt(idx);
    if (sp !== this.setpiece) { this.setpiece = sp; this._emit({ type: 'setpiece', kind: sp, spec: sp ? SETPIECE[sp] : null, index: idx }); }
    // a level crossing ahead: the bell starts and the train crosses well before the runners arrive
    for (let k = 0; k < 5; k++) { const i = idx + k; if (!crossingAt(i)) continue; const z = i * CHUNK_LEN + 18; if (this.distance > z - 130 && this.crossingZ !== z) { this.crossingZ = z; this._emit({ type: 'crossing', z, index: i }); } break; }
    this._forks(idx);
    // --- weather: per section; gusts shove every runner a lane (telegraphed), slick roads slow lane changes
    const wx = weatherOf(this.seed, idx);
    if (wx !== this.weather) { this.weather = wx; this._emit({ type: 'weather', weather: wx }); }
    for (const r of this.runners) { r.laneTime = P.LANE_T * wx.laneT; r.stumbleScale = wx.stumble; }
    if (wx.gust > 0) {
      if (!this.gust && this.time >= this.nextGust) { this.gust = { dir: this.gustRng.chance(0.5) ? -1 : 1, at: this.time + 1.3 }; this._emit({ type: 'gust.telegraph', dir: this.gust.dir, inSeconds: 1.3 }); }
      if (this.gust && this.time >= this.gust.at) {
        for (const r of this.runners) if (!r.disabled) { const t = r.lane + this.gust.dir; if (t >= r.laneMin && t <= r.laneMax) { r.laneFromX = r.xLane; r.lane = t; r.laneT = 0; } }
        this._emit({ type: 'gust', dir: this.gust.dir }); this.gust = null; this.nextGust = this.time + wx.gust * (0.7 + 0.6 * this.gustRng());
      }
    } else { this.gust = null; this.nextGust = this.time + 4; }

    // --- chunks ---
    this.pool.update(this.distance);
    if (this.rockets.length) this._rockets(dt);

    // --- collisions per runner over its own track ---
    for (const p of this.runners) {
      if (p.disabled) continue;
      for (const c of this.pool.live) {
        if (c.z0 > p.z + 4 || c.z0 + c.length < prevZ - 4) continue;
        // Only the road the body is on. Off a fork the roads are the two tracks, which is
        // what this has always meant; on a fork chunk they are that chunk's split roads.
        const pg = groupOf(p.xLane, c.groups.length);
        for (const cell of c.cells) {
          if (cell.gone) continue;                                                        // blown apart or struck away: it is not there for anyone
          if (cell.grp !== pg && !(cell.type === 'photon' && p.foxfireT > 0)) continue;   // fox-fire pulls coins from the whole road
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
            if (cell.type === 'photon') { if (onLane || p.magnetT > 0 || p.foxfireT > 0) this._coin(cell, p); continue; }
            if (p.jetpackT > 0 && cell.type !== 'power') { if (onLane) this._clean(cell, p, true); continue; }   // flying: every ground hazard passes beneath
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
    const spPressure = this.setpiece === 'avalanche' ? 2.2 : this.setpiece === 'tsunami' ? 1.8 : this.setpiece === 'fire' ? 1.5 : 1;
    const pressure = this.cfg.drift * Math.min(1, Math.max(0, this.distance - 1200) / 3000) * this.weather.pressure * spPressure;   // no passive drain in the first 1.2 km
    const clean = this.runners.every(r => r.disabled || r.stumbleT === 0);
    this.storm = Math.min(W.STORM_MAX, this.storm + (clean ? this.cfg.recover : 0) * dt - (this.dawnT > 0 ? 0 : pressure) * dt);
    if (this.storm <= 0) this._die('storm');
  }

  /**
   * Forks. While the road is split, every runner is held to the road they were standing
   * on when it split: `laneMin`/`laneMax` become that road's lanes, and nothing — not a
   * lane change, not a gust, not a barge — can take them across the gap until the merge.
   *
   * Pure in (seed, distance): every machine in a co-op run locks the same runners to the
   * same roads on the same tick, so this can never be the thing that splits two sims.
   */
  _forks(idx) {
    const f = this.cfg.forks === false ? null : forkAt(this.seed, idx);
    // telegraphed a chunk ahead: the HUD calls it, so choosing a side is never a surprise
    for (let k = 1; k <= 3; k++) {
      const i = idx + k, g = this.cfg.forks === false ? null : forkAt(this.seed, i);
      if (!g || g.start !== i || this.forkWarned === i || this.distance < i * CHUNK_LEN - 110) continue;
      this.forkWarned = i; this._emit({ type: 'fork', at: 'ahead', groups: g.groups, index: i });
      break;
    }
    if ((f?.start ?? null) === (this.fork?.start ?? null)) return;
    if (f) {
      const w = LANES_TOTAL / f.groups;
      for (const r of this.runners) {
        const g = groupOf(r.xLane, f.groups);
        r.group = g; r.laneMin = g * w; r.laneMax = g * w + w - 1;
        const lane = Math.max(r.laneMin, Math.min(r.laneMax, r.lane));
        if (lane !== r.lane) { r.laneFromX = r.xLane; r.lane = lane; r.laneT = 0; }   // caught mid-change across the split: eased back onto your own road
      }
      this._emit({ type: 'fork', at: 'split', groups: f.groups, index: idx, dirs: f.dirs, spread: f.spread });
    } else {
      for (const r of this.runners) { r.group = 0; r.laneMin = 0; r.laneMax = LANES_TOTAL - 1; }
      this._emit({ type: 'fork', at: 'join', index: idx });
    }
    this.fork = f;
  }

  /**
   * Runner vs runner, over every pair on the road. When two bodies overlap at the
   * same height, the one moving into the other barges it one lane sideways (a shove
   * can put the victim in front of a hazard — that is the sabotage). If the victim is
   * at the road edge, or both are moving into each other, the movers bounce back.
   *
   * Cooldown is per runner rather than global, so in a crowded pack one collision
   * does not swallow everyone else's. Pairs are visited in index order, which is the
   * same on every machine — the resolution is deterministic.
   */
  _bump(dt) {
    for (const r of this.runners) r.bumpCool = Math.max(0, (r.bumpCool ?? 0) - dt);
    const bounce = (r) => { r.lane = Math.max(0, Math.min(LANES_TOTAL - 1, Math.round(r.laneFromX))); r.laneFromX = r.xLane; r.laneT = 0; r.stumbleT = Math.max(r.stumbleT, W.BUMP_STUMBLE); };
    const shove = (mover, victim, dir) => {
      const target = victim.lane + dir;
      if (target < 0 || target >= LANES_TOTAL) { bounce(mover); this._emit({ type: 'bump', mover: mover.id, victim: -1, dir, at: mover.xLane }); return; }
      victim.laneFromX = victim.xLane; victim.lane = target; victim.laneT = 0; victim.stumbleT = Math.max(victim.stumbleT, W.BUMP_STUMBLE);
      this._emit({ type: 'bump', mover: mover.id, victim: victim.id, dir, at: (mover.xLane + victim.xLane) / 2 });
    };
    const towards = (r, dir) => r.laneT < 1 && Math.sign(r.lane - r.laneFromX) === dir;
    for (let i = 0; i < this.runners.length; i++) {
      const a = this.runners[i]; if (a.disabled || a.bumpCool > 0) continue;
      for (let j = i + 1; j < this.runners.length; j++) {
        const b = this.runners[j];
        if (b.disabled || b.bumpCool > 0 || a.bumpCool > 0) continue;
        if (a.group !== b.group) continue;                                // different roads on a fork: metres of air between them
        if (Math.abs(a.y - b.y) > 0.8) continue;                          // one is over the other
        const d = b.xLane - a.xLane;
        if (Math.abs(d) >= W.BUMP_DIST) continue;
        const sd = Math.sign(d) || 1;
        const movingA = towards(a, sd), movingB = towards(b, -sd);
        if (movingA && movingB) { bounce(a); bounce(b); this._emit({ type: 'bump', mover: a.id, victim: b.id, dir: 0, at: (a.xLane + b.xLane) / 2 }); }
        else if (movingA) shove(a, b, sd);
        else if (movingB) shove(b, a, -sd);
        else if (a.laneT >= 1 && b.laneT >= 1) { if (b.lane + sd < LANES_TOTAL && b.lane + sd >= 0) shove(a, b, sd); else shove(b, a, -sd); }
        else continue;
        a.bumpCool = b.bumpCool = W.BUMP_COOL;
      }
    }
  }

  _resolveCell(cell, p) {
    if (p.dashT > 0) { this._clean(cell, p, true); if (cell.type !== 'gap') this._emit({ type: 'smash', cell, runner: p.id }); return; }
    switch (cell.type) {
      case 'arch': if (p.action === 'slide' || p.iT > 0) this._clean(cell, p, true); else this._stumble(cell, p, W.STORM_STUMBLE); break;
      case 'drusen': case 'wave': if (p.y > 0.5 || p.iT > 0) this._clean(cell, p, true); else this._stumble(cell, p, W.STORM_STUMBLE); break;
      case 'gap': if (p.y > 0.25 || p.iT > 0) this._clean(cell, p, true); else this._fall(cell, p); break;
    }
  }

  /**
   * A coin belongs to whoever ran through it: it counts on that runner's own scoreboard
   * as well as the road's shared total, and the streak bonus is theirs to build or drop.
   */
  _coin(cell, p) {
    if (cell.hi && p.y <= 0.8 && p.magnetT === 0 && p.jetpackT === 0 && p.foxfireT === 0) return;
    const n = (this.x2T > 0 ? 2 : 1) * (p.foxfireT > 0 ? 3 : 1);
    this.coins += n; this.streak++; p.coins += n; p.streak++;
    const pts = W.SCORE_COIN * n * (1 + Math.floor(p.streak / 10) * 0.5);
    this.score += pts; p.score += pts;
    this.storm = Math.min(W.STORM_MAX, this.storm + W.STORM_COIN);
    this._emit({ type: 'coin', cell, runner: p.id, streak: p.streak, n, coins: p.coins });
  }

  _power(cell, p) {
    this.powers++;
    switch (cell.kind) {
      case 'shield': p.shield = true; p.shieldT = P.SHIELD_T; break;
      case 'jetpack': p.jetpackT = P.JETPACK_T; p.stumbleT = 0; break;
      case 'foxfire': p.foxfireT = 8; p.magnetT = Math.max(p.magnetT, 8); break;
      case 'dawn': this.storm = W.STORM_MAX; this.dawnT = 10; break;
      case 'susanoo': this.storm = Math.min(W.STORM_MAX, this.storm + 20); this._sweep(p, 60, 'strike'); break;
      case 'kagura': this._sweep(p, 40, 'transmute'); break;
      case 'guide': p.guideT = 10; break;
      case 'rocket': p.rocket = true; break;                                     // loaded; it goes when the runner says so
      case 'magnet': p.magnetT = P.MAGNET_T; break;
      case 'dash': p.dashT = P.DASH_T; p.stumbleT = 0; break;
      case 'x2': this.x2T = W.X2_T; break;
      case 'heal': this.storm = Math.min(W.STORM_MAX, this.storm + W.STORM_HEAL); break;
    }
    this._emit({ type: 'power', cell, kind: cell.kind, runner: p.id });
  }

  /** Susanoo / Kagura: every hazard ahead on this runner's road is struck away or turned into a coin. */
  _sweep(p, metres, how) {
    for (const c of this.pool.live) {
      if (c.z0 > this.distance + metres || c.z0 + c.length < this.distance) continue;
      const pg = groupOf(p.xLane, c.groups.length);
      for (const cell of c.cells) {
        if (cell.gone || cell.grp !== pg || cell.z <= this.distance + 1 || cell.z > this.distance + metres) continue;
        if (!HAZARDS.has(cell.type)) continue;
        if (how === 'transmute') { const old = cell.type; cell.type = 'photon'; cell.hi = false; cell.was = old; this._emit({ type: 'transmute', cell, runner: p.id }); }
        else { cell.gone = true; this._emit({ type: 'strike', cell, runner: p.id }); }
      }
    }
  }

  /**
   * Bō-hiya: the rocket flies down the lane it was fired from, faster than the runners, and
   * goes off on the first hazard in that lane — or at the end of its range. The blast takes
   * out every hazard within a few metres and a lane either side, on that road only: a
   * fork's gap is metres of air, and nothing crosses it.
   */
  _rockets(dt) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i], prev = r.z; r.z += (this.speed + W.ROCKET_V) * dt;
      let hit = null;
      for (const c of this.pool.live) {
        if (hit || c.z0 > r.z + 1 || c.z0 + c.length < prev - 1) continue;
        for (const cell of c.cells) {
          if (cell.gone || !HAZARDS.has(cell.type) || cell.z <= prev || cell.z > r.z + 1) continue;
          if (cell.type !== 'wave' && !this._inLanes(cell, r.lane, 0)) continue;
          hit = cell; break;
        }
      }
      if (!hit && r.z < r.z0 + W.ROCKET_RANGE) continue;
      const z = hit ? hit.z : r.z, cells = [];
      for (const c of this.pool.live) {
        if (c.z0 > z + W.ROCKET_BLAST || c.z0 + c.length < z - W.ROCKET_BLAST) continue;
        const rg = groupOf(r.lane, c.groups.length);
        for (const cell of c.cells) {
          if (cell.gone || !HAZARDS.has(cell.type) || cell.grp !== rg || Math.abs(cell.z - z) > W.ROCKET_BLAST) continue;
          if (cell.type !== 'wave' && !this._inLanes(cell, r.lane, W.ROCKET_LANES)) continue;
          cell.gone = true; cells.push(cell); this._emit({ type: 'strike', cell, runner: r.runner, by: 'rocket' });
        }
      }
      this.rockets.splice(i, 1);
      this._emit({ type: 'rocket.hit', runner: r.runner, lane: r.lane, z, n: cells.length });
    }
  }
  /** Does `cell` (a lane wide, or two for a `wide`) sit within `reach` lanes of global lane `lane`? */
  _inLanes(cell, lane, reach) {
    const g = globalLane(cell.track, cell.lane), span = cell.type === 'wide' ? 2 : 1;
    return lane >= g - reach && lane <= g + span - 1 + reach;
  }

  _clean(cell, p, scored) { if (scored) { this.score += W.SCORE_CLEAR; p.score += W.SCORE_CLEAR; } this._emit({ type: 'clear', cell, runner: p.id }); }

  _nearMiss(cell, p) {
    this.score += W.SCORE_NEAR_MISS; p.score += W.SCORE_NEAR_MISS;
    this._emit({ type: 'nearmiss', cell, runner: p.id, side: globalLane(cell.track, cell.lane) > p.lane ? 1 : -1 });
  }

  /** A crash into an arch/drusen: a shield smashes straight through it, otherwise a stumble costs storm margin. */
  _stumble(cell, p, cost) {
    if (p.shield) { this._emit({ type: 'shield', cell, runner: p.id }); return; }
    p.stumble();
    if (this._isAuto(p)) { this._emit({ type: 'stumble', cell, runner: p.id, free: true }); return; }
    this.streak = 0; p.streak = 0;
    this.storm -= cost;
    this._emit({ type: 'stumble', cell, runner: p.id, cost });
    if (this.storm <= 0) this._die('storm', cell);
  }

  _hitSolid(cell, p) {
    if (p.dashT > 0 || p.iT > 0 || p.jetpackT > 0) { this._clean(cell, p, p.dashT > 0 || p.jetpackT > 0); if (p.dashT > 0) this._emit({ type: 'smash', cell, runner: p.id }); return; }
    if (p.shield) { this._emit({ type: 'shield', cell, runner: p.id }); return; }   // shield: punch through the post
    // clipped it mid-change: bounce back to the lane you came from
    if (p.laneT < 1) { p.lane = Math.max(0, Math.min(LANES_TOTAL - 1, Math.round(p.laneFromX))); p.laneFromX = p.xLane; p.laneT = 0; }
    this._stumble(cell, p, W.STORM_STALK);
  }

  _fall(cell, p) {
    if (p.shield) { p.shield = false; this._emit({ type: 'shield', cell, runner: p.id }); return; }
    p.respawn();
    if (this._isAuto(p)) { this._emit({ type: 'fall', cell, runner: p.id, free: true }); return; }
    this.streak = 0; p.streak = 0;
    this.storm -= W.STORM_FALL;
    this._emit({ type: 'fall', cell, runner: p.id, cost: W.STORM_FALL });
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
    return { seed: this.seed, difficulty: this.cfg.id, distance: Math.floor(this.distance), score: Math.floor(this.score), coins: this.coins, powers: this.powers, reason: this.deathReason, ticks: this.tick };
  }
}

/** Replay a run headlessly from its input log: used to validate a submitted score. */
export function replay(seed, log, maxTicks = 60 * 60 * 30, difficulty = 'normal', opts = {}) {
  const w = new World(seed, { ...opts, difficulty });
  let i = 0;
  while (w.alive && w.tick < maxTicks) {
    while (i < log.length && log[i].t === w.tick) { const e = log[i++]; if (e.i) w.runners[e.i.track ?? 1]?.input(e.i); }
    w.step();
  }
  return w.summary;
}
