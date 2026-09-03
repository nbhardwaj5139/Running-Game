// Runner movement: fixed-tick, buffered inputs, coyote time, variable-height
// jump, eased lane changes, momentum by distance. Pure — no rendering.
import { WINDOW } from './chunks.js';

export const P = {
  LANE_T: 0.18,
  GRAVITY: -32,
  JUMP_V: 11.5,
  JUMP_HOLD_T: 0.18,
  SHORT_HOP_MULT: 0.55,
  FAST_FALL_V: -18,
  SLIDE_T: 0.55,
  SLIDE_H: 0.45,
  STAND_H: 1.6,
  BUFFER_T: 0.15,
  COYOTE_T: 0.08,
  STUMBLE_T: 1.2,
  STUMBLE_MULT: 0.7,
  CHANNEL_MULT: 1.15,
  SPEED_MAX: 24,
  SPEED_BASE: 11,
};

export function speedAt(distance) {
  return Math.min(P.SPEED_MAX, P.SPEED_BASE + 5 * Math.log2(1 + distance / 400));
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export class Player {
  constructor() {
    this.viewLane = 1;          // 0..2 within the visible window
    this.laneFromX = 0;         // x where the current lane change started (view space, lane units)
    this.laneT = 1;             // 0..1 progress of lane change
    this.xLane = 1;             // continuous lane position (view space) for rendering and stalk proximity
    this.y = 0; this.vy = 0; this.grounded = true; this.airTime = 0;
    this.jumpHeld = false; this.jumpHeldT = 0; this.jumpDown = false;
    this.action = 'run'; this.slideT = 0;
    this.stumbleT = 0; this.knockback = 0;
    this.distance = 0; this.z = 0;
    this.speed = speedAt(0);
    this.channelT = 0;
    this.alive = true;
    this.buffered = { jump: null, slide: null, lane: null };
    this.tick = 0;
  }

  /** evt: {kind:'jump'|'slide'|'lane', dir?, down?} — stamped with the current tick. */
  input(evt) {
    if (evt.kind === 'jumpRelease') { this.jumpDown = false; return; }
    if (evt.kind === 'jump') this.jumpDown = true;
    this.buffered[evt.kind] = { ...evt, tick: this.tick };
  }

  _fresh(b) { return b && (this.tick - b.tick) / 60 <= P.BUFFER_T; }

  get height() { return this.action === 'slide' ? P.SLIDE_H : P.STAND_H; }

  step(dt, world) {
    this.tick++;
    if (!this.alive) return;

    let mult = this.stumbleT > 0 ? P.STUMBLE_MULT : 1;
    if (this.channelT > 0) { mult *= P.CHANNEL_MULT; this.channelT -= dt; }
    this.speed = speedAt(this.distance) * mult;
    this.distance += this.speed * dt;
    this.z = this.distance;

    // --- lane change ---
    const bl = this.buffered.lane;
    if (this._fresh(bl) && (this.laneT >= 1 || this.laneT > 0.6)) {
      const target = Math.max(0, Math.min(WINDOW - 1, this.viewLane + bl.dir));
      if (target !== this.viewLane) { this.laneFromX = this.xLane; this.viewLane = target; this.laneT = 0; }
      this.buffered.lane = null;
    } else if (bl && !this._fresh(bl)) this.buffered.lane = null;
    this.laneT = Math.min(1, this.laneT + dt / P.LANE_T);
    this.xLane = this.laneFromX + (this.viewLane - this.laneFromX) * easeOutCubic(this.laneT);

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
      if (!this.grounded) { this.vy = P.FAST_FALL_V; }
      else { this.action = 'slide'; this.slideT = P.SLIDE_T; }
      this.buffered.slide = null;
    } else if (bs && !this._fresh(bs)) this.buffered.slide = null;
    if (this.action === 'slide') { this.slideT -= dt; if (this.slideT <= 0) this.action = 'run'; }

    this.stumbleT = Math.max(0, this.stumbleT - dt);
  }

  stumble() {
    this.stumbleT = P.STUMBLE_T;
    if (this.action === 'slide') this.action = 'run';
  }

  /** Continuous world-lane position (for proximity tests) given the current window offset. */
  worldX(window) { return this.xLane + window; }
}
