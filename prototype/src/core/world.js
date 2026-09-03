// The simulation: chunk pool + runner + the Blink + saccades + scoring.
// Deterministic given (seed, ordered events). No rendering here.
import { ChunkPool, LANES, WINDOW, BLOCKING } from './chunks.js';
import { Player } from './player.js';
import { mulberry32, mixSeed } from './rng.js';

export const W = {
  TICK: 1 / 60,
  BLINK_START: 30,          // metres of margin behind the runner
  BLINK_MAX: 34,
  BLINK_RECOVER: 0.6,       // m/s regained while running clean
  BLINK_DRIFT: 0.35,        // m/s lost at full difficulty (pressure rises with distance)
  BLINK_STUMBLE: 8,
  BLINK_STALK: 14,
  BLINK_PHOTON: 0.35,
  SACCADE_TELEGRAPH: 0.4,   // s from warning to shift (spender); rivals get 0.25
  SACCADE_TELEGRAPH_RIVAL: 0.25,
  SACCADE_MIN_GAP: 12, SACCADE_MAX_GAP: 25,   // solo auto-saccade interval (s), shrinks with distance
  NERVE_MAX: 100, NERVE_COST: 40,
  NERVE_NEAR_MISS: 5, NERVE_PHOTON: 2, NERVE_LUMEN: 25,
  SCORE_PHOTON: 10, SCORE_NEAR_MISS: 25, SCORE_PER_M: 1,
  CELL_DEPTH: 1.2, GAP_DEPTH: 3.0,
  STALK_PROX: 0.42,         // in lane units: how close (continuous) counts as hitting a stalk
};

export class World {
  /**
   * @param {number} seed uint32
   * @param {object} opts { onEvent(evt), solo: boolean (auto-saccades), reducedMotion }
   */
  constructor(seed, opts = {}) {
    this.seed = seed;
    this.opts = opts;
    this.rng = mulberry32(mixSeed(seed, 0x5acc)); // runtime rng (solo saccade timing only)
    this.player = new Player();
    this.pool = new ChunkPool(seed, { ahead: 6, behind: 1, onRecycle: (o, n) => this._emit({ type: 'recycle', old: o, fresh: n }) });
    this.window = 1;              // world lane of the leftmost visible lane (0..2)
    this.blink = W.BLINK_START;   // metres of margin
    this.nerve = 0;
    this.score = 0; this.photons = 0; this.streak = 0;
    this.tick = 0; this.time = 0;
    this.pending = null;          // { dir, atTick, by }
    this.nextAutoSaccade = opts.solo === false ? Infinity : 8;
    this.saccades = 0;
    this.deathReason = null;
    this.log = [];                // event log for replay/validation
    this.resolved = new Set();    // cells already evaluated (chunkIndex:z:lane)
    this._lastStalkLane = 1;
  }

  _emit(evt) { if (this.opts.onEvent) this.opts.onEvent(evt); }

  /** Local input; also logged. */
  input(evt) { this.log.push({ t: this.tick, i: evt }); this.player.input(evt); }

  /** Schedule a saccade. `atTick` is absolute sim tick; null => now + telegraph. */
  scheduleSaccade(dir, atTick = null, by = 'eye') {
    const lead = by === 'me' ? W.SACCADE_TELEGRAPH : W.SACCADE_TELEGRAPH_RIVAL;
    const t = atTick ?? this.tick + Math.round(lead / W.TICK);
    // clamp the direction so the window stays on the retina
    const clamped = this.window + dir < 0 ? 1 : this.window + dir > LANES - WINDOW ? -1 : dir;
    this.pending = { dir: clamped, atTick: Math.max(t, this.tick + 1), by };
    this.log.push({ t: this.tick, s: { dir: clamped, at: this.pending.atTick, by } });
    this._emit({ type: 'saccade.telegraph', dir: clamped, inTicks: this.pending.atTick - this.tick, by });
  }

  /** Try to spend shared/solo nerve on a saccade. Returns true if accepted (solo mode). */
  spendNerve(dir) {
    if (this.nerve < W.NERVE_COST || this.pending) return false;
    this.nerve -= W.NERVE_COST;
    this.scheduleSaccade(dir, null, 'me');
    this.player.channelT = Math.max(this.player.channelT, 2); // the eye "looks toward" the spender
    return true;
  }

  step() {
    if (!this.player.alive) return;
    const dt = W.TICK;
    this.tick++; this.time += dt;
    const p = this.player;
    const prevZ = p.z;
    p.step(dt, this);
    this.score += (p.z - prevZ) * W.SCORE_PER_M;

    // --- saccades ---
    if (this.pending && this.tick >= this.pending.atTick) {
      this.window += this.pending.dir;
      this.saccades++;
      this._emit({ type: 'saccade', dir: this.pending.dir, window: this.window, by: this.pending.by });
      this.pending = null;
    }
    if (this.time >= this.nextAutoSaccade && !this.pending) {
      const dir = this.rng.chance(0.5) ? -1 : 1;
      this.scheduleSaccade(dir, null, 'eye');
      const shrink = Math.min(1, p.distance / 3000);
      const gap = W.SACCADE_MAX_GAP - (W.SACCADE_MAX_GAP - W.SACCADE_MIN_GAP) * shrink;
      this.nextAutoSaccade = this.time + gap * (0.8 + 0.4 * this.rng());
    }

    // --- chunks ---
    this.pool.update(p.z);

    // --- collisions: evaluate every cell whose z we crossed this tick ---
    const worldLane = p.viewLane + this.window;
    const worldX = p.worldX(this.window);
    for (const c of this.pool.live) {
      if (c.z0 > p.z + 4 || c.z0 + c.length < prevZ - 4) continue;
      for (const cell of c.cells) {
        const depth = cell.type === 'gap' ? W.GAP_DEPTH : cell.type === 'channel' ? cell.len : W.CELL_DEPTH;
        const zc = cell.z;
        const front = cell.type === 'channel' ? zc : zc - depth / 2;
        const back = cell.type === 'channel' ? zc + depth : zc + depth / 2;
        // stalks are checked continuously while overlapping; everything else once at the centre
        if (cell.type === 'stalk') {
          const key = `${c.index}:${cell.z}:${cell.lane}`;
          if (this.resolved.has(key)) continue;
          if (p.z >= front && prevZ <= back) {
            // mid-lane-change the hitbox is a little wider: you clip the stalk with your shoulder
            if (Math.abs(worldX - cell.lane) < W.STALK_PROX + (p.laneT < 1 ? 0.15 : 0)) {
              this.resolved.add(key);
              this._hitStalk(cell);
            } else if (p.z >= zc) {
              this.resolved.add(key);
              if (Math.abs(worldLane - cell.lane) === 1 && p.stumbleT === 0) this._nearMiss(cell, worldLane);
            }
          }
          continue;
        }
        const key = `${c.index}:${cell.z}:${cell.lane}`;
        if (this.resolved.has(key)) continue;
        if (cell.type === 'channel') {
          if (p.z >= front && p.z <= back && worldLane === cell.lane && p.grounded && p.y === 0) {
            p.channelT = Math.max(p.channelT, 0.2); // refreshed every tick while riding
            this.score += 1; // x2 distance score while on it
          }
          if (p.z > back) this.resolved.add(key);
          continue;
        }
        if (prevZ < zc && p.z >= zc) {
          this.resolved.add(key);
          if (worldLane !== cell.lane) {
            if (cell.type === 'gap' && Math.abs(worldLane - cell.lane) === 1 && p.stumbleT === 0 && p.y === 0) this._nearMiss(cell, worldLane);
            continue;
          }
          this._resolveCell(cell, p);
        }
      }
    }

    // --- the Blink ---
    const pressure = W.BLINK_DRIFT * Math.min(1, p.distance / 2500);
    this.blink = Math.min(W.BLINK_MAX, this.blink + (p.stumbleT > 0 ? 0 : W.BLINK_RECOVER) * dt - pressure * dt);
    if (this.blink <= 0) this._die('blink');
  }

  _resolveCell(cell, p) {
    switch (cell.type) {
      case 'arch':
        if (p.action === 'slide') this._clean(cell); else this._stumble(cell, W.BLINK_STUMBLE);
        break;
      case 'drusen':
        if (p.y > 0.5) this._clean(cell); else this._stumble(cell, W.BLINK_STUMBLE);
        break;
      case 'gap':
        if (p.y > 0.25) this._clean(cell); else this._die('fall', cell);
        break;
      case 'photon':
        if (cell.hi && p.y <= 0.8) break;
        this.photons++; this.streak++;
        this.score += W.SCORE_PHOTON * (1 + Math.floor(this.streak / 10) * 0.5);
        this._addNerve(W.NERVE_PHOTON, 'photon');
        this.blink = Math.min(W.BLINK_MAX, this.blink + W.BLINK_PHOTON);
        this._emit({ type: 'photon', cell, streak: this.streak });
        break;
      case 'lumen':
        this._addNerve(W.NERVE_LUMEN, 'lumen');
        this._emit({ type: 'lumen', cell });
        break;
    }
  }

  /** All nerve gains go through here; in Shared Nerve the host forwards the delta to the server. */
  _addNerve(n, reason) {
    if (this.opts.sharedNerve) { this._emit({ type: 'nerve.charge', amount: n, reason }); return; }
    this.nerve = Math.min(W.NERVE_MAX, this.nerve + n);
  }

  _clean(cell) { this.score += 5; this._emit({ type: 'clear', cell }); }

  _nearMiss(cell, lane) {
    this._addNerve(W.NERVE_NEAR_MISS, 'nearmiss');
    this.score += W.SCORE_NEAR_MISS;
    this._emit({ type: 'nearmiss', cell, side: cell.lane > lane ? 1 : -1 });
  }

  _stumble(cell, blinkCost) {
    this.streak = 0;
    this.player.stumble();
    this.blink -= blinkCost;
    this._emit({ type: 'stumble', cell });
    if (this.blink <= 0) this._die('blink', cell);
  }

  _hitStalk(cell) {
    const p = this.player;
    // clipped it mid-change: bounce back to the lane you came from. Head-on: just stumble.
    if (p.laneT < 1) {
      p.viewLane = Math.max(0, Math.min(WINDOW - 1, Math.round(p.laneFromX)));
      p.laneFromX = p.xLane; p.laneT = 0;
    }
    this._stumble(cell, W.BLINK_STALK);
  }

  _die(reason, cell = null) {
    if (!this.player.alive) return;
    if (this.opts.invincible) { this.blink = Math.max(this.blink, 1); return; }
    this.player.alive = false;
    this.deathReason = reason;
    this._emit({ type: 'death', reason, cell, distance: this.player.distance, score: Math.floor(this.score) });
  }

  /** Blink surge from multiplayer ("the eye reflexes toward the last runner"). */
  surgeBlink(m) { this.blink -= m; if (this.blink <= 0) this._die('blink'); }

  get summary() {
    return { seed: this.seed, distance: Math.floor(this.player.distance), score: Math.floor(this.score), photons: this.photons, saccades: this.saccades, reason: this.deathReason, ticks: this.tick };
  }
}

/** Replay a run headlessly: used by the server to validate a submitted score. */
export function replay(seed, log, maxTicks = 60 * 60 * 30, solo = true) {
  const w = new World(seed, { solo });
  let i = 0;
  while (w.player.alive && w.tick < maxTicks) {
    while (i < log.length && log[i].t === w.tick) {
      const e = log[i++];
      if (e.i) w.player.input(e.i);
      else if (e.s) { w.pending = { dir: e.s.dir, atTick: e.s.at, by: e.s.by }; w.nextAutoSaccade = Infinity; }
    }
    w.step();
    if (i >= log.length && !w.pending && w.nextAutoSaccade === Infinity) { /* keep running to death */ }
  }
  return w.summary;
}
