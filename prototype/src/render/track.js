// The track spline: simulate in track space (s, x, h), render in world space.
// World(s, x, h) = P(s) − R(s)·x + N(s)·h with a parallel-transported right-handed
// frame (R = N × T). The sim's x axis is left-handed (x grows to the runner's
// right while looking down +z), so x is negated here — once, for everything. Shapes are chosen per chunk
// from the seed with a readability grammar (no back-to-back sharp turns, a
// bounded turn window so the live road never folds over itself, a pitch budget).
import * as THREE from 'three';
import { mulberry32, mixSeed } from '../core/rng.js';
import { CHUNK_LEN, BEAT_LEN, kaijuOf, generate, shrineClimbPitch } from '../core/chunks.js';

const SEG = BEAT_LEN;                       // one control point per beat (6 m)
const TURNS = [0, 0, 0, 0, 18, -18, 32, -32, 45, -45];
const PITCH = [0, 0, 0, 8, -8, 13, -13];

export class Track {
  constructor(seed) {
    this.seed = seed;
    this.pts = [new THREE.Vector3(0, 0, -SEG), new THREE.Vector3(0, 0, 0)];   // one leading point for Catmull-Rom
    this.ns = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)];
    this.yaw = 0; this.pitch = 0; this.built = 0; this.recent = []; this.shapes = [];
    this._f = { P: new THREE.Vector3(), T: new THREE.Vector3(), N: new THREE.Vector3(), R: new THREE.Vector3() };
    this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4(); this._yaw = new THREE.Quaternion();
  }

  /** Shape of chunk `index`: [turnDeg, pitchDeg]. Straight for the opening, walls and kaiju; grammar-limited otherwise. */
  _shape(index) {
    if (index < 2 || kaijuOf(index)) return [0, 0];
    const stairs = shrineClimbPitch(index); if (stairs !== null) return [0, stairs];   // the shrine stairs: straight up, flat top, straight down
    const rng = mulberry32(mixSeed(this.seed ^ 0x7ac, index));
    const c = generate(this.seed, index); if (c.wall) return [0, 0];
    const lastSharp = this.recent.length && Math.abs(this.recent[this.recent.length - 1]) >= 32;
    let turn = TURNS[rng.int(0, TURNS.length - 1)];
    if (lastSharp && Math.abs(turn) >= 32) turn = 0;
    const window = this.recent.slice(-4).reduce((a, b) => a + b, 0);
    if (Math.abs(window + turn) > 120) turn = 0;                            // the live road (8 chunks) never folds over itself
    // pitch is an absolute target for the end of the chunk; the road never goes below its start height (drops follow climbs)
    let pitch = PITCH[rng.int(0, PITCH.length - 1)];
    const y = this.pts[this.pts.length - 1].y;
    if (y < 14 && pitch < 0) pitch = 0;                                      // not enough height to descend safely
    if (y > 48 && pitch > 0) pitch = -8;
    if (Math.abs(turn) >= 32 && Math.abs(pitch) > 8) pitch = 0;             // never a sharp turn on a steep slope
    return [turn, pitch];
  }

  /** Build control points for chunks up to `index` (inclusive). */
  ensure(index) {
    while (this.built <= index) {
      const [turn, pitchTarget] = this._shape(this.built);
      this.shapes[this.built] = { turn, pitch: pitchTarget };
      const yaw0 = this.yaw, pitch0 = this.pitch, pitchD = pitchTarget - pitch0, steps = CHUNK_LEN / SEG;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps, e = k * k * (3 - 2 * k);
        this.yaw = yaw0 + turn * e; this.pitch = pitch0 + pitchD * e;
        const yr = THREE.MathUtils.degToRad(this.yaw), pr = THREE.MathUtils.degToRad(this.pitch);
        const dir = new THREE.Vector3(Math.sin(yr) * Math.cos(pr), Math.sin(pr), Math.cos(yr) * Math.cos(pr));
        const prev = this.pts[this.pts.length - 1];
        this.pts.push(prev.clone().addScaledVector(dir, SEG));
        // parallel transport the normal, gently re-levelling toward world up
        const n = this.ns[this.ns.length - 1].clone().projectOnPlane(dir).normalize();
        const upP = new THREE.Vector3(0, 1, 0).projectOnPlane(dir).normalize();
        this.ns.push(n.lerp(upP, 0.12).normalize());
      }
      this.recent.push(turn); if (this.recent.length > 8) this.recent.shift();
      this.built++;
    }
  }

  /** Frame at arc length s (shared object — copy what you keep). Right-handed: T forward, N up, R = N × T (screen LEFT). */
  frameAt(s) {
    const idx = Math.floor(s / SEG); this.ensure(Math.floor(s / CHUNK_LEN) + 1);
    const i = Math.max(1, Math.min(this.pts.length - 3, idx + 1)); const t = Math.max(0, Math.min(1, s / SEG - idx));
    const p0 = this.pts[i - 1], p1 = this.pts[i], p2 = this.pts[i + 1], p3 = this.pts[i + 2];
    const f = this._f, t2 = t * t, t3 = t2 * t;
    f.P.set(
      0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3));
    f.T.set(
      0.5 * ((-p0.x + p2.x) + 2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t + 3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t2),
      0.5 * ((-p0.y + p2.y) + 2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t + 3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t2),
      0.5 * ((-p0.z + p2.z) + 2 * (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t + 3 * (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t2)).normalize();
    f.N.copy(this.ns[i]).lerp(this.ns[i + 1], t).projectOnPlane(f.T).normalize();
    f.R.crossVectors(f.N, f.T).normalize();
    return f;
  }

  /** Track (x across — sim right, h up, s along) + yaw → world position and quaternion (written into out). */
  map(x, h, s, ry, outPos, outQuat) {
    const f = this.frameAt(s);
    outPos.copy(f.P).addScaledVector(f.R, -x).addScaledVector(f.N, h);
    if (outQuat) { this._m.makeBasis(f.R, f.N, f.T); outQuat.setFromRotationMatrix(this._m); if (ry) outQuat.multiply(this._yaw.setFromAxisAngle(_Y, -ry)); }
    return outPos;
  }
  /** Quaternion of the frame at s (shared object). */
  quatAt(s) { const f = this.frameAt(s); this._m.makeBasis(f.R, f.N, f.T); return this._q.setFromRotationMatrix(this._m); }
}
const _Y = new THREE.Vector3(0, 1, 0);
