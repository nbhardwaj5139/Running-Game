// One runner: fixed-tick, buffered inputs, coyote time, variable-height jump,
// eased lane changes. Forward motion belongs to the World (both runners share it).
import { LANES, LANES_TOTAL, trackOf, DIFFICULTY } from './chunks.js';

export const P = {
  LANE_T: 0.15,
  GRAVITY: -38,
  JUMP_V: 10.8,
  JUMP_HOLD_T: 0.18,
  SHORT_HOP_MULT: 0.55,
  FAST_FALL_V: -20,
  SLIDE_T: 0.5,
  SLIDE_H: 0.45,
  STAND_H: 1.6,
  BUFFER_T: 0.15,
  COYOTE_T: 0.08,
  STUMBLE_T: 1.0,
  STUMBLE_MULT: 0.72,
  SPEED_MAX: 30,
  SPEED_BASE: 13,
  DASH_T: 3.5,            // Wind Kami dash: invulnerable, clears everything in its path
  MAGNET_T: 10,
  INVULN_T: 1.2,          // grace after a fall
};

/** Shared run speed by distance: fast from the first step, 30 m/s by ~2.5 km. */
export function speedAt(distance, cfg = DIFFICULTY.normal) {
  const base = cfg.speedBase ?? P.SPEED_BASE, max = cfg.speedMax ?? P.SPEED_MAX;
  return Math.min(max, base + (max - base) * 0.38 * Math.log2(1 + distance / 350));
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export class Player {
  constructor(id = 1) {
    this.id = id;               // 0 = tanuki (home track 0, left), 1 = kitsune (home track 1, right)
    this.lane = id * LANES + 1; // global lane 0..5; starts in the middle of the home track
    this.laneFromX = this.lane; // lane position where the current lane change started
    this.laneT = 1;             // 0..1 progress of lane change
    this.xLane = this.lane;     // continuous global lane position for rendering and proximity
    this.y = 0; this.vy = 0; this.grounded = true; this.airTime = 0;
    this.jumpHeld = false; this.jumpHeldT = 0; this.jumpDown = false;
    this.action = 'run'; this.slideT = 0;
    this.stumbleT = 0;
    this.z = 0;
    this.shield = false; this.magnetT = 0; this.dashT = 0; this.iT = 0;
    this.buffered = { jump: null, slide: null, lane: null };
    this.tick = 0;
    this.laneTime = P.LANE_T; this.stumbleScale = 1;   // set by the world from the weather
  }

  /** evt: {kind:'jump'|'slide'|'lane'|'jumpRelease', dir?} — stamped with the current tick. */
  input(evt) {
    if (evt.kind === 'jumpRelease') { this.jumpDown = false; return; }
    if (evt.kind === 'jump') this.jumpDown = true;
    if (evt.kind in this.buffered) this.buffered[evt.kind] = { ...evt, tick: this.tick };
  }

  _fresh(b) { return b && (this.tick - b.tick) / 60 <= P.BUFFER_T; }

  get height() { return this.action === 'slide' ? P.SLIDE_H : P.STAND_H; }
  get invulnerable() { return this.dashT > 0 || this.iT > 0; }
  /** The track this runner is physically on right now (it may have crossed over). */
  get track() { return trackOf(this.xLane); }
  get home() { return this.id; }

  step(dt) {
    this.tick++;

    // --- lane change ---
    const bl = this.buffered.lane;
    if (this._fresh(bl) && (this.laneT >= 1 || this.laneT > 0.6)) {
      const target = Math.max(0, Math.min(LANES_TOTAL - 1, this.lane + bl.dir));
      if (target !== this.lane) { this.laneFromX = this.xLane; this.lane = target; this.laneT = 0; }
      this.buffered.lane = null;
    } else if (bl && !this._fresh(bl)) this.buffered.lane = null;
    this.laneT = Math.min(1, this.laneT + dt / this.laneTime);
    this.xLane = this.laneFromX + (this.lane - this.laneFromX) * easeOutCubic(this.laneT);

    // --- jump ---
    const bj = this.buffered.jump;
    const canJump = this.grounded || this.airTime < P.COYOTE_T;
    if (this._fresh(bj) && canJump && this.action !== 'slide') {
      this.vy = P.JUMP_V; this.grounded = false; this.action = 'jump';
      this.jumpHeld = true; this.jumpHeldT = 0; this.buffered.jump = null;
    } else if (bj && !this._fresh(bj)) this.buffered.jump = null;
    if (this.action === 'jump' && this.jumpHeld) {
      this.jumpHeldT += dt;
      if ((!this.jumpDown || this.jumpHeldT > P.JUMP_HOLD_T) && this.vy > 0) {
        if (!this.jumpDown) this.vy *= P.SHORT_HOP_MULT;
        this.jumpHeld = false;
      }
    }
    this.vy += P.GRAVITY * dt;
    this.y = Math.max(0, this.y + this.vy * dt);
    if (!this.grounded) this.airTime += dt;
    if (this.y === 0 && !this.grounded) { this.grounded = true; this.airTime = 0; this.vy = 0; if (this.action === 'jump') this.action = 'run'; }
    if (this.y === 0 && this.grounded) this.vy = 0;

    // --- slide / fast-fall ---
    const bs = this.buffered.slide;
    if (this._fresh(bs)) {
      if (!this.grounded) this.vy = P.FAST_FALL_V;
      else { this.action = 'slide'; this.slideT = P.SLIDE_T; }
      this.buffered.slide = null;
    } else if (bs && !this._fresh(bs)) this.buffered.slide = null;
    if (this.action === 'slide') { this.slideT -= dt; if (this.slideT <= 0) this.action = 'run'; }

    this.stumbleT = Math.max(0, this.stumbleT - dt);
    this.magnetT = Math.max(0, this.magnetT - dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this.iT = Math.max(0, this.iT - dt);
  }

  stumble() { this.stumbleT = P.STUMBLE_T * this.stumbleScale; if (this.action === 'slide') this.action = 'run'; }

  /** After a fall: back on the road in the same lane, briefly untouchable. */
  respawn() { this.y = 0; this.vy = 0; this.grounded = true; this.action = 'run'; this.iT = P.INVULN_T; this.stumbleT = P.STUMBLE_T; }
}
