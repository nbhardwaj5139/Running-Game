// Scenery: everything that dresses a chunk beyond the road, the obstacles and the
// grass/flower fields — trees, lanterns, buildings, houses, cliffs, sea props —
// per biome, varied by season. Everything repeated is instanced (one draw call per
// pool; an unused pool costs nothing because the instance count tracks the highest
// live index), landmarks are pooled single meshes. Deterministic from ctx.rng.
import * as THREE from 'three';
import { PAINT, paint, merge, box, cyl, cone, sph, radial, canvasTexture, MeshPool, InstancePool, compose, lerp } from './common.js';
import { seasonBlend } from '../core/chunks.js';
import { mulberry32 } from '../core/rng.js';

const MAX_LIGHTS = 8, TAU = Math.PI * 2;
const W = '#ffffff', VERMILION = '#d8371c', KASAGI = '#221a18', STONE = '#8d8a80', STONE_D = '#6d6a62', WOOD = '#4a3628', STEEL = '#5f6670';
const NEON_WORDS = [['ラーメン', '#ff3fa4'], ['寿司', '#ffd23f'], ['居酒屋', '#ff5a3c'], ['カラオケ', '#3fe0ff'], ['薬', '#5cff7a'], ['電気', '#ffffff'],
  ['祭', '#ff3c5a'], ['珈琲', '#ffb347'], ['ホテル', '#c77dff'], ['24h', '#3fe0ff'], ['焼肉', '#ff8a3c'], ['本', '#7ac8ff']];
const GATE = [null, ['東京', '#ff3fa4'], ['郊外', '#ffd23f'], ['海岸', '#3fe0ff']];          // section-entrance gantry signs (mountain gets a torii)
const CITY_TINTS = [[0.62, 0.66, 0.82], [0.78, 0.7, 0.66], [0.55, 0.6, 0.7], [0.82, 0.78, 0.7], [0.5, 0.56, 0.76], [0.7, 0.6, 0.62]];
const HOUSE_TINTS = [[1, 0.97, 0.9], [0.95, 0.9, 0.82], [0.9, 0.92, 0.9], [1, 0.94, 0.86], [0.88, 0.88, 0.84]];
const EARTH = [0.45, 0.38, 0.28];
const RED_ON = new THREE.Color(3.2, 0.25, 0.15), RED_OFF = new THREE.Color(0.14, 0.03, 0.02), GREEN_ON = new THREE.Color(0.3, 2.8, 0.9), GREEN_OFF = new THREE.Color(0.02, 0.1, 0.04);

// ---- materials (instance-tinted pools use plain white materials; merged multi-colour props use PAINT) ----
const LIT = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02 });
const TRUNK = new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: 0.9 });
const SNOW = new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.95 });
const PADDY = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
const GLOWM = new THREE.MeshBasicMaterial({ color: 0xffffff });                          // instance colours > 1 bloom; dimmed by day in update
const CHOCHIN = new THREE.MeshBasicMaterial({ vertexColors: true });
const WIRE = new THREE.LineBasicMaterial({ color: 0x1b1b24 });
const GULLM = new THREE.MeshBasicMaterial({ color: 0xffffff });

// ---- small math helpers ----
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
/** Like compose() but with a full Euler (for wind-bent pines, rocking gulls, tumbled rocks). Shared matrix — copy if kept. */
const composeT = (x, y, z, sx, sy, sz, rx, ry, rz) => _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _qq = new THREE.Quaternion(), _ee = new THREE.Euler();
/** Euler that tilts a y-axis primitive toward direction (x,y,z). */
const towards = (x, y, z) => { _ee.setFromQuaternion(_qq.setFromUnitVectors(_up, _d.set(x, y, z).normalize())); return [_ee.x, _ee.y, _ee.z]; };
const rgb = (css) => { const c = new THREE.Color(css); return [c.r, c.g, c.b]; };
const ri = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const jit = (rng, c, k) => { const v = 1 - k + rng() * 2 * k; return [c[0] * v, c[1] * v, c[2] * v]; };
const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** InstancePool that keeps mesh.count at the highest live index so idle pools cost no draw call. */
class Pool extends InstancePool {
  constructor(parent, geo, mat, cap, shadow = true) { super(parent, geo, mat, cap); this.live = new Set(); this.mesh.count = 0; this.mesh.castShadow = shadow; }
  take(m, c) { const i = super.take(m, c); if (i >= 0) this.live.add(i); return i; }
  give(i) { if (i >= 0) { super.give(i); this.live.delete(i); } }
  flush() { if (!this.dirty) return; let hi = -1; for (const i of this.live) if (i > hi) hi = i; this.mesh.count = hi + 1; super.flush(); }
}

/** One LineSegments for every power line in the world; segments come from a free-list. */
class LinePool {
  constructor(parent, cap) {
    this.cap = cap; this.pos = new Float32Array(cap * 6); this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo = new THREE.BufferGeometry(); this.geo.setAttribute('position', this.attr); this.geo.setDrawRange(0, 0);
    this.line = new THREE.LineSegments(this.geo, WIRE); this.line.frustumCulled = false; parent.add(this.line);
    this.free = []; for (let i = cap - 1; i >= 0; i--) this.free.push(i); this.live = new Set(); this.dirty = false;
  }
  seg(ax, ay, az, bx, by, bz) {
    const i = this.free.pop(); if (i === undefined) return -1; const o = i * 6, p = this.pos;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az; p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz; this.live.add(i); this.dirty = true; return i;
  }
  /** A sagging wire a→b as n straight segments (parabolic sag); indices pushed to `out`. */
  catenary(out, ax, ay, az, bx, by, bz, sag, n = 6) {
    let px = ax, py = ay, pz = az;
    for (let k = 1; k <= n; k++) { const t = k / n, x = lerp(ax, bx, t), y = lerp(ay, by, t) - sag * 4 * t * (1 - t), z = lerp(az, bz, t); out.push(this.seg(px, py, pz, x, y, z)); px = x; py = y; pz = z; }
  }
  give(i) { if (i < 0) return; this.pos.fill(0, i * 6, i * 6 + 6); this.free.push(i); this.live.delete(i); this.dirty = true; }
  flush() { if (!this.dirty) return; let hi = -1; for (const i of this.live) if (i > hi) hi = i; this.geo.setDrawRange(0, (hi + 1) * 2); this.attr.needsUpdate = true; this.dirty = false; }
}

// ---- geometry ---------------------------------------------------------------------------------------
/** Torii: posts, nuki, shimaki, upswept kasagi, plaque. Frame spans x; walk through along z. */
function toriiGeo(h, w, r, big = false) {
  const parts = [], yTop = h * 0.93 + r * 1.05;
  for (const x of [-w / 2, w / 2]) { parts.push(paint(cyl(r * 0.9, r, h, 10), VERMILION, { p: [x, h / 2, 0] })); if (big) parts.push(paint(cyl(r * 1.5, r * 1.6, r * 1.2, 10), '#3b3a38', { p: [x, r * 0.6, 0] })); }
  parts.push(paint(box(w * 1.06, r * 1.1, r * 0.9), VERMILION, { p: [0, h * 0.78, 0] }));
  parts.push(paint(box(w * 1.16, r * 0.9, r * 1.2), VERMILION, { p: [0, h * 0.93, 0] }));
  parts.push(paint(box(w * 1.3, r * 1.2, r * 1.5), KASAGI, { p: [0, yTop, 0] }));
  for (const s of [-1, 1]) parts.push(paint(box(w * 0.12, r * 1.2, r * 1.5), KASAGI, { p: [s * w * 0.68, yTop + r * 0.3, 0], r: [0, 0, s * 0.28] }));
  parts.push(paint(box(r * 1.6, r * 2.4, r * 0.5), KASAGI, { p: [0, h * 0.86, 0] }));
  return merge(parts);
}
/** Box with UVs scaled so a window tile stays 3 m whatever the size. */
function buildingGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d), arr = g.attributes.uv.array, sc = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = (f * 4 + v) * 2; arr[i] *= sc[f][0] / 3; arr[i + 1] *= sc[f][1] / 3; }
  g.translate(0, h / 2, 0); return g;
}
/** Facade textures: `wall` (daylit concrete + glass) and `win` (emissive lit windows only), same window grid. */
function facadeTextures() {
  const r = mulberry32(0x5ce11e), cols = ['#ffe9b0', '#ffd27a', '#bfe8ff', '#ffffff', '#f7c6ff'], cells = [];
  for (let y = 4; y < 64; y += 12) for (let x = 4; x < 64; x += 12) cells.push({ x, y, lit: r() < 0.6, c: cols[Math.floor(r() * cols.length)], a: 0.55 + r() * 0.45 });
  const mk = (draw) => { const t = canvasTexture(64, 64, draw); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; return t; };
  const wall = mk((g) => { g.fillStyle = '#b8bcc8'; g.fillRect(0, 0, 64, 64); for (const c of cells) { g.fillStyle = '#39415a'; g.fillRect(c.x - 1, c.y - 1, 8, 10); g.fillStyle = '#7f9fc4'; g.fillRect(c.x, c.y, 6, 8); } });
  const win = mk((g) => { g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64); for (const c of cells) if (c.lit) { g.fillStyle = c.c; g.globalAlpha = c.a; g.fillRect(c.x, c.y, 6, 8); g.globalAlpha = 1; } });
  return { wall, win };
}
const G = {
  trunk: () => { const g = cyl(0.18, 0.28, 1, 7); g.translate(0, 0.5, 0); return g; },                       // unit height; scale y = height
  cedar: () => merge([paint(cone(1.05, 1.5, 8), W, { p: [0, 0.65, 0] }), paint(cone(0.85, 1.4, 8), W, { p: [0, 1.5, 0] }), paint(cone(0.6, 1.3, 8), W, { p: [0, 2.35, 0] })]),   // 3 m
  blob: () => merge([paint(sph(1, 8), W), paint(sph(0.75, 8), W, { p: [0.7, 0.35, 0.25] }), paint(sph(0.7, 8), W, { p: [-0.65, 0.4, -0.3] }), paint(sph(0.6, 8), W, { p: [0.1, 0.75, -0.5] })]),
  pine: () => merge([0, 1, 2].map(i => paint(cyl(0.12, 1.05 - i * 0.25, 0.45, 7), W, { p: [i * 0.28, i * 0.75, 0] }))),
  bamboo: () => { const parts = []; for (let i = 0; i < 6; i++) { const a = i * 1.05, r = 0.25 + (i % 3) * 0.2, ox = Math.cos(a) * r, oz = Math.sin(a) * r, h = 4.2 + (i % 2) * 0.9;
    parts.push(paint(cyl(0.05, 0.07, h, 5), '#9ccf6a', { p: [ox, h / 2, oz] }), paint(sph(0.5, 6), '#6fae4a', { p: [ox, h, oz], s: [1, 0.6, 1] })); } return merge(parts); },
  bare: () => { const parts = [paint(cyl(0.11, 0.2, 2.6, 6), WOOD, { p: [0, 1.3, 0] })];
    for (let i = 0; i < 5; i++) { const a = i * 1.26, dx = Math.cos(a), dz = Math.sin(a); parts.push(paint(cyl(0.03, 0.06, 1.5, 4), WOOD, { p: [dx * 0.55, 2.95, dz * 0.55], r: towards(dx * 0.8, 1, dz * 0.8) })); } return merge(parts); },   // ~3.5 m
  snow: () => { const g = sph(1, 8); g.scale(1, 0.35, 1); return g; },
  mist: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  lantern: () => merge([paint(box(0.8, 0.25, 0.8), STONE_D, { p: [0, 0.12, 0] }), paint(cyl(0.13, 0.16, 1.0), STONE, { p: [0, 0.75, 0] }), paint(box(0.8, 0.12, 0.8), STONE_D, { p: [0, 1.3, 0] }),
    ...[-1, 1].flatMap(a => [-1, 1].map(b => paint(box(0.1, 0.5, 0.1), STONE_D, { p: [a * 0.22, 1.6, b * 0.22] }))), paint(box(0.7, 0.08, 0.7), STONE_D, { p: [0, 1.88, 0] }),
    paint(cone(0.62, 0.4, 4), STONE, { p: [0, 2.1, 0], r: [0, Math.PI / 4, 0] }), paint(sph(0.1), STONE, { p: [0, 2.35, 0] })]),
  chochin: () => { const parts = [paint(box(19, 0.04, 0.04), [0.05, 0.04, 0.04], { p: [0, 3.4, 0] })];
    for (const x of [-9.4, 9.4]) parts.push(paint(cyl(0.06, 0.08, 3.5, 6), [0.08, 0.06, 0.05], { p: [x, 1.75, 0] }));
    for (let x = -7.5; x <= 7.5; x += 2.5) parts.push(paint(sph(0.34, 10), [2.6, 1.3, 0.45], { p: [x, 2.85, 0], s: [1, 1.2, 1] }), paint(box(0.02, 0.25, 0.02), [0.05, 0.04, 0.04], { p: [x, 3.28, 0] }));
    return merge(parts); },
  lamp: () => merge([paint(cyl(0.06, 0.09, 5), '#4c525a', { p: [0, 2.5, 0] }), paint(box(1.1, 0.08, 0.08), '#4c525a', { p: [0.5, 5, 0] }), paint(box(0.5, 0.18, 0.28), '#fff1d0', { p: [1.0, 4.95, 0] })]),
  viaduct: (L) => { const parts = [paint(box(4.2, 1.0, L), '#6f747c', { p: [0, 5.6, 0] }), paint(box(4.6, 0.5, L), '#8a9099', { p: [0, 5.1, 0] }), paint(box(2.4, 0.08, L), '#777a80', { p: [0, 6.14, 0] })];
    for (const x of [-2.1, 2.1]) parts.push(paint(box(0.25, 0.9, L), '#9aa0a8', { p: [x, 6.5, 0] }));
    for (const x of [-0.72, 0.72]) parts.push(paint(box(0.08, 0.1, L), '#b8bcc4', { p: [x, 6.2, 0] }));
    for (const z of [-12, 0, 12]) parts.push(paint(box(1.1, 5, 1.1), '#5b6068', { p: [0, 2.5, z] }), paint(box(3.6, 0.5, 1.2), '#5b6068', { p: [0, 4.85, z] }), paint(box(0.1, 3, 0.1), '#555a60', { p: [2.0, 7.5, z] }));
    return merge(parts); },
  signal: () => merge([paint(cyl(0.05, 0.07, 3, 7), '#4c525a', { p: [0, 1.5, 0] }), paint(box(0.4, 0.95, 0.3), '#2a2d33', { p: [0, 2.6, 0] })]),
  awning: () => merge([paint(box(3.2, 0.08, 1.6), W, { p: [0, 0, 0.8], r: [0.3, 0, 0] }), paint(box(3.2, 0.3, 0.05), W, { p: [0, -0.35, 1.5] })]),
  pole: () => merge([paint(cyl(0.09, 0.12, 8, 7), '#6d6862', { p: [0, 4, 0] }), paint(box(1.6, 0.08, 0.1), '#4a4744', { p: [0, 7.5, 0] }), paint(box(1.2, 0.08, 0.1), '#4a4744', { p: [0, 7.0, 0] }),
    paint(cyl(0.22, 0.22, 0.7, 8), '#4a4a4e', { p: [0.35, 6.3, 0] }), ...[[-0.6, 7.58], [0.6, 7.58], [0, 7.08]].map(([x, y]) => paint(sph(0.06, 6), '#e8e8e8', { p: [x, y, 0] }))]),
  house: () => { const w = 7, d = 6, h = 3.2; return merge([paint(box(w, h, d), W, { p: [0, h / 2, 0] }), paint(box(w + 0.9, 0.12, d + 0.9), '#2e3a55', { p: [0, h + 0.02, 0] }),
    paint(cyl(0.9, (w + 1.2) / Math.SQRT2, 1.7, 4), '#33415f', { p: [0, h + 0.85, 0], r: [0, Math.PI / 4, 0], s: [1, 1, (d + 1.2) / (w + 1.2)] }),
    paint(box(1.3, 1.0, 0.1), '#8fb7d9', { p: [-1.8, 1.6, -d / 2 - 0.02] }), paint(box(1.3, 1.0, 0.1), '#8fb7d9', { p: [1.8, 1.6, -d / 2 - 0.02] }), paint(box(0.9, 2.0, 0.1), '#5b4636', { p: [0, 1.0, -d / 2 - 0.02] })]); },
  house2: () => { const w = 6.5, d = 6, h = 5.6; return merge([paint(box(w, h, d), W, { p: [0, h / 2, 0] }), paint(box(w + 0.8, 0.12, d + 0.8), '#4a5058', { p: [0, h + 0.02, 0] }),
    paint(cyl(0.7, (w + 1.0) / Math.SQRT2, 1.5, 4), '#5a6068', { p: [0, h + 0.75, 0], r: [0, Math.PI / 4, 0], s: [1, 1, (d + 1.0) / (w + 1.0)] }),
    paint(box(3.0, 0.9, 1.0), '#9a948a', { p: [0, 3.0, -d / 2 - 0.5] }), ...[-1.6, 1.6].flatMap(x => [1.5, 4.2].map(y => paint(box(1.2, 1.0, 0.1), '#8fb7d9', { p: [x, y, -d / 2 - 0.02] }))),
    paint(box(0.9, 2.0, 0.1), '#5b4636', { p: [0, 1.0, -d / 2 - 0.02] })]); },
  wall: () => { const g = box(1, 1, 1); g.translate(0, 0.5, 0); return g; },
  paddy: () => { const g = box(1, 0.08, 1); g.translate(0, 0.04, 0); return g; },
  bicycle: () => merge([paint(cyl(0.33, 0.33, 0.04, 12), '#2a2a2a', { p: [-0.5, 0.33, 0], r: [Math.PI / 2, 0, 0] }), paint(cyl(0.33, 0.33, 0.04, 12), '#2a2a2a', { p: [0.5, 0.33, 0], r: [Math.PI / 2, 0, 0] }),
    paint(box(0.9, 0.05, 0.05), W, { p: [0, 0.6, 0], r: [0, 0, 0.25] }), paint(box(0.05, 0.5, 0.05), W, { p: [-0.35, 0.65, 0] }), paint(box(0.05, 0.55, 0.05), W, { p: [0.4, 0.62, 0], r: [0, 0, 0.35] }),
    paint(box(0.25, 0.06, 0.12), '#3a2a20', { p: [-0.35, 0.92, 0] }), paint(box(0.06, 0.04, 0.45), '#333333', { p: [0.5, 0.95, 0] }), paint(box(0.3, 0.25, 0.3), '#8a8a80', { p: [0.7, 0.85, 0] })]),
  guardrail: (L) => { const parts = [paint(box(0.08, 0.32, L - 1), '#e6e6e6', { p: [0, 0.75, 0] })]; for (let z = -L / 2 + 1; z < L / 2 - 0.5; z += 3) parts.push(paint(box(0.1, 0.8, 0.1), '#d0d0d0', { p: [0, 0.4, z] })); return merge(parts); },
  boat: () => merge([paint(box(1.7, 0.7, 4.4), W, { p: [0, 0.35, 0] }), paint(cyl(0.01, 0.85, 1.4, 4), W, { p: [0, 0.35, 2.9], r: [Math.PI / 2, Math.PI / 4, 0] }), paint(box(1.75, 0.15, 4.4), '#2f5f9e', { p: [0, 0.55, 0] }),
    paint(box(1.2, 0.8, 1.3), W, { p: [0, 1.1, -0.8] }), paint(box(1.3, 0.08, 1.4), '#2f5f9e', { p: [0, 1.52, -0.8] }), paint(cyl(0.04, 0.05, 2.4, 5), '#6b5a48', { p: [0, 2.2, 0.3] }), paint(box(0.02, 0.3, 0.45), '#e0392b', { p: [0, 3.2, 0.5] })]),
  buoy: () => merge([paint(sph(0.45, 8), W, { p: [0, 0.2, 0] }), paint(box(0.18, 0.6, 0.18), '#e8e8e8', { p: [0, 0.8, 0] })]),
  gull: () => merge([paint(box(0.6, 0.02, 0.12), W, { p: [-0.3, 0.12, 0], r: [0, 0, 0.45] }), paint(box(0.6, 0.02, 0.12), W, { p: [0.3, 0.12, 0], r: [0, 0, -0.45] }), paint(sph(0.09, 6), W, { s: [1, 0.8, 1.6] }),
    paint(box(0.12, 0.025, 0.1), '#333333', { p: [-0.6, 0.25, 0], r: [0, 0, 0.45] }), paint(box(0.12, 0.025, 0.1), '#333333', { p: [0.6, 0.25, 0], r: [0, 0, -0.45] })]),
  tetrapod: () => merge([[0, 1, 0], [0.94, -0.33, 0], [-0.47, -0.33, 0.82], [-0.47, -0.33, -0.82]].map(d => paint(cyl(0.2, 0.45, 1.1, 6), '#9a9c9a', { p: [d[0] * 0.55, 0.45 + d[1] * 0.55, d[2] * 0.55], r: towards(d[0], d[1], d[2]) }))),
  lighthouse: () => merge([paint(cyl(1.6, 1.8, 0.6, 12), '#8a8a86', { p: [0, 0.3, 0] }), paint(cyl(0.9, 1.2, 9, 12), W, { p: [0, 4.5, 0] }), paint(cyl(1.13, 1.16, 1.4, 12), '#c8332a', { p: [0, 3, 0] }),
    paint(cyl(1.4, 1.4, 0.2, 12), '#3a3a3a', { p: [0, 9.1, 0] }), ...[0, 1, 2, 3].map(i => paint(box(0.08, 1.5, 0.08), '#3a3a3a', { p: [Math.cos(i * 1.57) * 0.75, 9.95, Math.sin(i * 1.57) * 0.75] })),
    paint(cone(0.95, 0.9, 8), '#b33a2e', { p: [0, 11.1, 0] })]),
  gantry: () => { const parts = []; for (const x of [-9.6, 9.6]) { parts.push(paint(box(0.5, 6.6, 0.5), STEEL, { p: [x, 3.3, 0] }), paint(box(1.4, 0.3, 1.4), '#4a4f58', { p: [x, 0.15, 0] })); }
    parts.push(paint(box(20.5, 0.6, 0.6), STEEL, { p: [0, 6.6, 0] }), paint(box(20.5, 0.3, 0.3), STEEL, { p: [0, 8.9, 0] }), paint(box(6.8, 2.2, 0.25), '#161a24', { p: [0, 7.75, 0] }));
    for (let x = -9; x < 9; x += 2) parts.push(paint(box(0.15, 2.4, 0.15), STEEL, { p: [x + 1, 7.75, 0], r: [0, 0, 0.72] }));
    for (let x = -8; x <= 8; x += 4) parts.push(paint(box(0.3, 0.2, 0.3), [1.8, 1.5, 1.0], { p: [x, 6.2, -0.3] }));
    return merge(parts); },
  shrine: () => merge([paint(box(6, 0.6, 5), '#6f6a62', { p: [0, 0.3, 0] }), paint(box(4.6, 2.4, 3.6), '#8f6a3f', { p: [0, 1.8, 0.2] }), paint(box(4.2, 1.6, 0.1), '#3a2a1e', { p: [0, 1.9, -1.62] }),
    paint(box(5.2, 0.15, 5.0), '#8f6a3f', { p: [0, 0.75, -0.4] }), ...[-2.6, 2.6].map(x => paint(cyl(0.12, 0.12, 2.8, 8), VERMILION, { p: [x, 1.9, -2.0] })),
    paint(cyl(0.5, 4.6, 1.6, 4), '#2d3542', { p: [0, 3.9, 0.2], r: [0, Math.PI / 4, 0], s: [1.4, 1, 1.15] }), paint(box(4.6, 0.25, 0.3), '#1e232c', { p: [0, 4.8, 0.2] }),
    ...[-2.1, 2.1].flatMap(x => [-0.4, 0.4].map(a => paint(box(0.12, 1.2, 0.08), '#e8d9b0', { p: [x, 5.2, 0.2], r: [0, 0, a] }))),
    paint(cyl(0.08, 0.08, 4.4, 6), '#d9c9a0', { p: [0, 2.6, -1.7], r: [0, 0, Math.PI / 2] }), paint(box(1.4, 0.8, 0.8), '#5b4636', { p: [0, 1.15, -2.4] })]),
  crossing: () => { const parts = [];
    for (const z of [-0.72, 0.72]) parts.push(paint(box(88, 0.05, 0.12), '#7a7e86', { p: [0, 0.025, z] }));
    for (let x = -44; x <= 44; x += 0.9) if (Math.abs(x) > 8.6) parts.push(paint(box(0.25, 0.06, 2.2), '#5c4a3a', { p: [x, 0.03, 0] }));
    for (const s of [-1, 1]) { const px = s * 9.0; parts.push(paint(box(0.28, 3.4, 0.28), '#d9d9d9', { p: [px, 1.7, -2.4] }));
      for (const a of [0.785, -0.785]) parts.push(paint(box(1.4, 0.3, 0.06), '#f2c94c', { p: [px, 3.7, -2.6], r: [0, 0, a] }));
      for (let k = 0; k < 6; k++) parts.push(paint(box(0.6, 0.12, 0.12), k % 2 ? '#1a1a1a' : '#f2c94c', { p: [px + s * Math.cos(1.2) * (0.3 + k * 0.6), 1.5 + Math.sin(1.2) * (0.3 + k * 0.6), -2.4], r: [0, 0, s * 1.2] })); }
    return merge(parts); },
  konbini: () => { const w = 9, h = 3.6, d = 8; return merge([paint(box(w, h, d), '#f4f4f0', { p: [0, h / 2, 0] }), paint(box(w + 0.4, 0.3, d + 0.4), '#b9bcc2', { p: [0, h + 0.1, 0] }),
    paint(box(w - 1, 2.0, 0.1), '#a9dcee', { p: [0, 1.35, -d / 2 - 0.02] }), paint(box(1.3, 2.1, 0.12), '#7bc4e0', { p: [0, 1.05, -d / 2 - 0.05] }), paint(box(w, 0.9, 0.2), '#1a1f2e', { p: [0, 3.1, -d / 2 - 0.1] }),
    paint(box(w + 1, 0.06, 1.0), '#dcdcdc', { p: [0, 2.55, -d / 2 - 0.5] })]); },
  park: () => { const parts = [];
    for (const z of [-1.2, 1.2]) for (const s of [-1, 1]) parts.push(paint(cyl(0.05, 0.05, 2.6, 6), '#3d7ab8', { p: [s * 0.5, 1.25, z], r: [0, 0, s * 0.35] }));
    parts.push(paint(cyl(0.05, 0.05, 2.8, 6), '#3d7ab8', { p: [0, 2.45, 0], r: [Math.PI / 2, 0, 0] }));
    for (const z of [-0.5, 0.5]) parts.push(paint(box(0.03, 1.9, 0.03), '#888888', { p: [-0.2, 1.5, z] }), paint(box(0.03, 1.9, 0.03), '#888888', { p: [0.2, 1.5, z] }), paint(box(0.5, 0.05, 0.2), '#7a4a2a', { p: [0, 0.55, z] }));
    parts.push(paint(box(0.7, 0.08, 3.0), '#e8c33a', { p: [4, 1.0, 0], r: [0.55, 0, 0] }), paint(box(0.7, 0.08, 0.9), '#e8c33a', { p: [4, 1.8, -1.9] }), paint(box(0.06, 1.8, 0.06), '#3d7ab8', { p: [3.7, 0.9, -2.2] }), paint(box(0.06, 1.8, 0.06), '#3d7ab8', { p: [4.3, 0.9, -2.2] }));
    parts.push(paint(box(1.6, 0.08, 0.45), '#8b5a2b', { p: [-4, 0.5, 1.5] }), paint(box(1.6, 0.4, 0.06), '#8b5a2b', { p: [-4, 0.75, 1.7] }), paint(box(0.06, 0.5, 0.4), '#333333', { p: [-4.7, 0.25, 1.5] }), paint(box(0.06, 0.5, 0.4), '#333333', { p: [-3.3, 0.25, 1.5] }));
    parts.push(paint(box(3, 0.06, 3), '#d8c9a3', { p: [-4, 0.03, -2] }));
    return merge(parts); },
  school: () => { const parts = [paint(box(22, 9.5, 8), '#d8d9d4', { p: [0, 4.75, 0] }), paint(box(22.4, 0.3, 8.4), '#8a8e94', { p: [0, 9.6, 0] }), paint(box(2.2, 3, 2.2), '#d8d9d4', { p: [0, 11, 0] }), paint(cyl(0.7, 0.7, 0.1, 12), '#f4f4f0', { p: [0, 11.3, -1.15], r: [Math.PI / 2, 0, 0] })];
    for (let f = 0; f < 3; f++) parts.push(paint(box(20, 1.1, 0.1), '#9fbfd6', { p: [0, 1.9 + f * 3, -4.05] })); return merge(parts); },
};

/** Season palette + which archetypes appear; t = progress through the season section (for boundary fades). */
function seasonKit(season, t, rng) {
  const GREEN = [0.14, 0.46, 0.15], CEDAR = [[0.09, 0.27, 0.11], [0.05, 0.2, 0.08], [0.1, 0.21, 0.07], [0.09, 0.17, 0.15]][season];
  return {
    snow: season === 3, bamboo: season <= 1, festival: season === 1,
    cedar: () => jit(rng, CEDAR, 0.25),
    pine: () => jit(rng, [0.1, 0.3, 0.13], 0.2),
    bambooTint: () => { const g = 0.85 + rng() * 0.25; return [g * (season === 0 ? 0.95 : 0.8), g, g * 0.75]; },
    /** The deciduous "season tree": { kind, tint }. Sakura / green maple / momiji+ginkgo / bare. */
    tree: () => {
      if (season === 3) return { kind: 'bare' };
      if (season === 0) return { kind: 'blob', tint: t > 0.6 && rng() < 0.35 ? jit(rng, [0.55, 0.8, 0.32], 0.15) : [1, 0.6 + rng() * 0.14, 0.74 + rng() * 0.1] };
      if (season === 1) return { kind: 'blob', tint: jit(rng, GREEN, 0.3) };
      const c = rng() < 0.3 ? [1, 0.8 + rng() * 0.1, 0.12] : [0.95 + rng() * 0.05, 0.18 + rng() * 0.3, 0.05 + rng() * 0.06];
      return { kind: 'blob', tint: mix3(c, GREEN, Math.max(0, 0.3 - t) * 1.6) };
    },
    ginkgo: () => ({ kind: 'blob', tint: mix3([1, 0.78 + rng() * 0.1, 0.1], GREEN, Math.max(0, 0.3 - t) * 1.6) }),
    paddy: () => jit(rng, [[0.58, 0.7, 0.8], [0.24, 0.55, 0.18], [0.88, 0.66, 0.2], [0.86, 0.85, 0.8]][season], 0.08),
  };
}

export function buildScenery(parent, neonFactory) {
  const L = 36;                                                                         // geometry length of per-chunk items (chunks are 36 m)
  const tex = facadeTextures();
  const BLD = new THREE.MeshStandardMaterial({ map: tex.wall, emissiveMap: tex.win, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.8 });
  const MIST = new THREE.MeshBasicMaterial({ map: radial('rgba(255,255,255,0.55)', 'rgba(255,255,255,0)'), transparent: true, depthWrite: false, opacity: 0.9 });
  const P = {
    trunk: new Pool(parent, G.trunk(), TRUNK, 360), cedar: new Pool(parent, G.cedar(), LIT, 220), blob: new Pool(parent, G.blob(), LIT, 140), pine: new Pool(parent, G.pine(), LIT, 60),
    bamboo: new Pool(parent, G.bamboo(), PAINT, 70), bare: new Pool(parent, G.bare(), PAINT, 70), snowCap: new Pool(parent, G.snow(), SNOW, 560, false),
    glowSph: new Pool(parent, sph(1, 8), GLOWM, 100, false), glowBox: new Pool(parent, box(1, 1, 1), GLOWM, 60, false),
    lantern: new Pool(parent, G.lantern(), PAINT, 40), torii: new Pool(parent, toriiGeo(2.8, 2.2, 0.13), PAINT, 16), chochin: new Pool(parent, G.chochin(), CHOCHIN, 12, false),
    mist: new Pool(parent, G.mist(), MIST, 24, false), rock: new Pool(parent, new THREE.IcosahedronGeometry(1, 0), LIT, 460),
    lamp: new Pool(parent, G.lamp(), PAINT, 40), viaduct: new Pool(parent, G.viaduct(L), PAINT, 10), signal: new Pool(parent, G.signal(), PAINT, 20), awning: new Pool(parent, G.awning(), LIT, 30),
    pole: new Pool(parent, G.pole(), PAINT, 50), house: new Pool(parent, G.house(), PAINT, 40), house2: new Pool(parent, G.house2(), PAINT, 30), wall: new Pool(parent, G.wall(), LIT, 200),
    paddy: new Pool(parent, G.paddy(), PADDY, 100, false), bicycle: new Pool(parent, G.bicycle(), PAINT, 40),
    guardrail: new Pool(parent, G.guardrail(L), PAINT, 20), boat: new Pool(parent, G.boat(), PAINT, 30), buoy: new Pool(parent, G.buoy(), PAINT, 50), gull: new Pool(parent, G.gull(), GULLM, 60, false), tetrapod: new Pool(parent, G.tetrapod(), PAINT, 110),
  };
  P.bld = [[7, 12], [8, 20], [6, 30], [10, 42]].map(([w, h]) => ({ w, h, pool: new Pool(parent, buildingGeo(w, h, w), BLD, 48) }));
  const M = { shrine: G.shrine(), bigTorii: toriiGeo(8.5, 18.6, 0.5, true), seaTorii: toriiGeo(9, 7, 0.45, true), gantry: G.gantry(), crossing: G.crossing(), konbini: G.konbini(), park: G.park(), school: G.school(), lighthouse: G.lighthouse() };
  const P1 = {}; for (const k of Object.keys(M)) P1[k] = new MeshPool(`scenery:${k}`, M[k], PAINT, parent);
  const wires = new LinePool(parent, 1200);                                              // 8 city/suburb chunks ≈ 870 segments
  const allPools = [...Object.values(P).filter(p => p instanceof Pool), ...P.bld.map(b => b.pool), wires];
  const flushAll = () => { for (const p of allPools) p.flush(); };
  const S = { time: 0, night: 0, season: 0, views: new Map(), blink: [], signals: [], gulls: [], beacons: [], blinkPhase: -1, sigPhase: -1 };

  // ---- neon signs: the renderer's factory makes them; we cache by text so a word never costs a second texture ----
  const neonFree = new Map();
  function neonTake(text, color, vertical) {
    const key = `${text}|${color}|${vertical ? 1 : 0}`, list = neonFree.get(key); let m = list && list.pop();
    if (!m) { m = neonFactory(text, color, vertical); m.userData.neonKey = key; m.geometry.computeBoundingBox(); const n = m.geometry.attributes.normal; m.userData.flip = n && n.getZ(0) < 0 ? Math.PI : 0; }
    parent.add(m); m.visible = true; return m;
  }
  function neonGive(m) { m.visible = false; const list = neonFree.get(m.userData.neonKey) || []; list.push(m); neonFree.set(m.userData.neonKey, list); }
  /** Point a sign so its face normal is (sin ry, 0, cos ry): π = toward the runner, ∓π/2 = flush on a right/left facade. */
  const aim = (m, ry) => m.rotation.set(0, ry + m.userData.flip, 0);

  // ---- per-chunk view: what was placed, so release() can free it ----
  function newView(chunk, ctx) {
    const V = { index: chunk.index, z0: ctx.z0, len: ctx.len, rng: ctx.rng, season: ctx.season, snow: ctx.season === 3, col: new THREE.Color(), inst: [], meshes: [], neons: [], wires: [], nLights: 0 };
    V.kit = seasonKit(ctx.season, seasonBlend(chunk.index), ctx.rng);
    V.take = (pool, m, c) => { const i = pool.take(m, c); if (i >= 0) V.inst.push(pool, i); return i; };
    V.single = (mp, x, y, z, ry = 0) => { const m = mp.take(); m.position.set(x, y, z); m.rotation.y = ry; V.meshes.push(mp, m); return m; };
    V.light = (x, z, y, i, c) => { if (V.nLights < MAX_LIGHTS) { V.nLights++; ctx.light(x, z, y, i, c); } };
    V.neon = (text, color, vertical) => { const m = neonTake(text, color, vertical); V.neons.push(m); return m; };
    V.tint = (list) => { const t = list[Math.floor(V.rng() * list.length)]; return V.col.setRGB(t[0], t[1], t[2]); };
    return V;
  }

  // ---- shared placers ----
  /** Tree archetypes: trunk + instanced foliage with a per-instance tint; snow caps in winter. `tilt` bends pines. */
  function tree(V, kind, x, z, h, ry, tint, y0 = 0, tilt = 0) {
    const c = tint ? V.col.setRGB(tint[0], tint[1], tint[2]) : undefined;
    if (kind === 'cedar') { const th = h * 0.3; V.take(P.trunk, compose(x, y0, z, h * 0.1, th, h * 0.1, ry)); V.take(P.cedar, compose(x, y0 + th * 0.5, z, h * 0.17, (h - th * 0.5) / 3, h * 0.17, ry), c);
      if (V.snow) { V.take(P.snowCap, compose(x, y0 + h * 0.98, z, h * 0.06, h * 0.03, h * 0.06)); V.take(P.snowCap, compose(x, y0 + h * 0.72, z, h * 0.14, h * 0.035, h * 0.14)); } }
    else if (kind === 'blob') { const th = h * 0.42, r = h * 0.3; V.take(P.trunk, compose(x, y0, z, h * 0.14, th, h * 0.14, ry)); V.take(P.blob, compose(x, y0 + th + r * 0.7, z, r, r * 0.9, r, ry), c);
      if (V.snow) V.take(P.snowCap, compose(x, y0 + th + r * 1.5, z, r * 1.05, r * 0.3, r * 1.05)); }
    else if (kind === 'bare') { const s = h / 3.5; V.take(P.bare, compose(x, y0, z, s, s, s, ry)); if (V.snow) V.take(P.snowCap, compose(x, y0 + h * 0.92, z, h * 0.16, h * 0.035, h * 0.16)); }
    else if (kind === 'pine') { const th = h * 0.45, s = h * 0.32, tx = x - Math.sin(tilt) * th, ty = y0 + Math.cos(tilt) * th;
      V.take(P.trunk, composeT(x, y0, z, h * 0.1, th, h * 0.1, 0, ry, tilt)); V.take(P.pine, composeT(tx, ty, z, s, s, s, 0, ry, tilt), c);
      if (V.snow) V.take(P.snowCap, compose(tx - Math.sin(tilt) * s * 1.2, ty + s * 1.55, z, s * 0.6, s * 0.2, s * 0.6)); }
  }
  /** Stone lantern with a warm flame (a glow box in the fire chamber), registered as a road light. */
  function lantern(V, x, z, ry) {
    V.take(P.lantern, compose(x, 0, z, 1, 1, 1, ry)); V.take(P.glowBox, compose(x, 1.6, z, 0.42), V.col.setRGB(2.2, 1.5, 0.8)); V.light(x, z, 1.6, 0.7, [1.0, 0.8, 0.5]);
    if (V.snow) V.take(P.snowCap, compose(x, 2.2, z, 0.6, 0.35, 0.6));
  }
  /** Utility poles on both verges every `spacing` m, three catenary wires per span (skips the span into a new biome). */
  function poleLine(V, px, spacing) {
    const { z0, len } = V, zs = []; for (let z = z0 + spacing / 2; z < z0 + len; z += spacing) zs.push(z);
    const last = (V.index + 1) % 8 === 0;
    for (const s of [-1, 1]) {
      const x = s * px;
      for (let k = 0; k < zs.length; k++) {
        V.take(P.pole, compose(x, 0, zs[k], 1, 1, 1, s < 0 ? 0 : Math.PI));
        const zn = k + 1 < zs.length ? zs[k + 1] : (last ? null : zs[k] + spacing);
        if (zn === null) continue;
        for (const [ox, oy] of [[-0.6, 7.58], [0.6, 7.58], [0, 7.08]]) wires.catenary(V.wires, x + ox, oy, zs[k], x + ox, oy, zn, 0.45);
      }
    }
  }
  const mistPlane = (V) => V.take(P.mist, compose((V.rng() - 0.5) * 30, 0.4 + V.rng() * 0.8, V.z0 + V.rng() * V.len, 40 + V.rng() * 30, 1, 14 + V.rng() * 10));

  // ---- biomes -----------------------------------------------------------------------------------
  function dressMountain(V) {
    const { rng, z0, len, kit } = V;
    for (const s of [-1, 1]) for (let i = 0; i < 12; i++) tree(V, 'cedar', s * (9.5 + rng() * 26), z0 + rng() * len, 7 + rng() * 8, rng() * TAU, kit.cedar());   // cedar slopes
    for (let i = 0; i < 4; i++) { const s = rng() < 0.5 ? -1 : 1, st = kit.tree(); tree(V, st.kind, s * (9.6 + rng() * 5), z0 + 2 + rng() * (len - 4), 4.5 + rng() * 2.5, rng() * TAU, st.tint); }
    if (kit.bamboo && rng() < 0.75) {                                                                   // a Kyoto bamboo grove
      const s = rng() < 0.5 ? -1 : 1, cx = s * (11.5 + rng() * 5), cz = z0 + 4 + rng() * (len - 8);
      for (let i = 0; i < 7; i++) { const t = kit.bambooTint(); V.take(P.bamboo, compose(cx + (rng() - 0.5) * 5, 0, cz + (rng() - 0.5) * 7, 1, 0.8 + rng() * 0.5, 1, rng() * TAU), V.col.setRGB(t[0], t[1], t[2])); }
    }
    for (let i = 0; i < 2; i++) { const s = i ? 1 : -1; lantern(V, s * 9.0, z0 + 5 + i * 18 + rng() * 6, s < 0 ? 0.3 : -0.3); }
    if (V.index % 2 === 0) { const z = z0 + 18; V.take(P.chochin, compose(0, 0, z), V.col.setRGB(1, 1, 1)); V.light(0, z, 3.0, 1.0, [1.0, 0.75, 0.45]); }
    if (V.index % 4 === 2) {                                                                            // a small shrine up a side path
      const z = z0 + 20; V.single(P1.shrine, -15.5, 0, z, -Math.PI / 2);
      lantern(V, -11.5, z - 2.6, 0); lantern(V, -11.5, z + 2.6, 0);
      V.take(P.torii, compose(-10.2, 0, z, 1, 1, 1, Math.PI / 2)); if (V.snow) V.take(P.snowCap, compose(-10.2, 2.85, z, 0.3, 0.1, 1.5));
    } else if (V.index % 4 === 0 && V.index % 8 !== 0) { const s = rng() < 0.5 ? -1 : 1, z = z0 + 10 + rng() * 16; V.take(P.torii, compose(s * 10.4, 0, z, 1, 1, 1, Math.PI / 2)); if (V.snow) V.take(P.snowCap, compose(s * 10.4, 2.85, z, 0.3, 0.1, 1.5)); }
    for (let i = 0; i < 7; i++) {                                                                       // moss rocks
      const s = rng() < 0.5 ? -1 : 1, x = s * (9.2 + rng() * 10), z = z0 + rng() * len, r = 0.5 + rng() * 0.9;
      V.take(P.rock, composeT(x, r * 0.35, z, r, r * 0.7, r, rng() * 0.5, rng() * TAU, 0), V.col.setRGB(0.3, 0.38 + rng() * 0.12, 0.24));
      if (V.snow) V.take(P.snowCap, compose(x, r * 0.95, z, r * 0.9, r * 0.3, r * 0.9));
    }
    mistPlane(V); mistPlane(V);
  }

  function dressCity(V) {
    const { rng, z0, len, kit } = V, faces = [];
    for (const s of [-1, 1]) {                                                                          // buildings: left close to the pavement, right behind the viaduct
      let z = z0 + 0.5 + rng() * 2;
      while (z < z0 + len - 5) {
        const b = P.bld[ri(rng, 0, 3)], front = s < 0 ? 9.8 + rng() * 2 : 20.5 + rng() * 2.5, zc = z + b.w / 2;
        V.take(b.pool, compose(s * (front + b.w / 2), 0, zc), V.tint(CITY_TINTS)); faces.push({ s, x: s * front, z: zc, h: b.h });
        if (rng() < 0.55) { const b2 = P.bld[ri(rng, 1, 3)]; V.take(b2.pool, compose(s * (front + b.w + 2 + rng() * 5 + b2.w / 2), 0, zc + (rng() - 0.5) * 4), V.tint(CITY_TINTS)); }
        z += b.w + 0.5 + rng() * 1.5;
      }
    }
    const nNeon = V.index % 2 ? 1 : 2;                                                                  // kanji neon (each sign is its own draw call)
    for (let i = 0; i < nNeon && faces.length; i++) {
      const f = faces.splice(ri(rng, 0, faces.length - 1), 1)[0], [word, css] = NEON_WORDS[ri(rng, 0, NEON_WORDS.length - 1)], vertical = rng() < 0.5;
      const m = V.neon(word, css, vertical), bb = m.geometry.boundingBox, w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, y = Math.max(2.5, Math.min(f.h - h - 0.5, 2.8 + rng() * 6));
      if (vertical) { const x = f.s * Math.max(8.7 + w / 2, Math.abs(f.x) - w / 2 - 0.3); m.position.set(x, y + h / 2, f.z); aim(m, Math.PI); V.light(x, f.z, y, 1.0, rgb(css)); }
      else { m.position.set(f.x - f.s * 0.15, y + h / 2, f.z); aim(m, f.s > 0 ? -Math.PI / 2 : Math.PI / 2); V.light(f.x - f.s * 0.6, f.z, y, 1.0, rgb(css)); }
    }
    for (const [s, z] of [[-1, z0 + 5], [1, z0 + 14], [-1, z0 + 23], [1, z0 + 32]]) {                  // street lamps
      V.take(P.lamp, compose(s * 8.8, 0, z, 1, 1, 1, s < 0 ? 0 : Math.PI)); const gx = s * 7.8;
      V.take(P.glowSph, compose(gx, 4.9, z, 0.2), V.col.setRGB(2.4, 2.0, 1.4)); V.light(gx, z, 4.9, 0.5, [1, 0.85, 0.6]);
    }
    poleLine(V, 9.4, 12);
    V.take(P.viaduct, compose(16, 0, z0 + len / 2));                                                   // shinkansen viaduct on the right
    for (const s of [-1, 1]) {                                                                          // crosswalk signals near the chunk's crosswalk
      const z = z0 + 31, x = s * 8.8; V.take(P.signal, compose(x, 0, z, 1, 1, 1, s < 0 ? 0 : Math.PI));
      const r = V.take(P.glowBox, compose(x - s * 0.25, 2.8, z, 0.22), S.sigPhase === 1 ? RED_ON : RED_OFF), g = V.take(P.glowBox, compose(x - s * 0.25, 2.42, z, 0.22), S.sigPhase === 1 ? GREEN_OFF : GREEN_ON);
      S.signals.push({ chunk: V.index, r, g });
    }
    if (V.season === 2) for (let z = z0 + 3; z < z0 + len; z += 9) for (const s of [-1, 1]) { const g = kit.ginkgo(); tree(V, g.kind, s * 9.0, z + rng(), 4.5 + rng(), rng() * TAU, g.tint); }   // ginkgo avenue
    if (V.season === 0) for (let i = 0; i < 2; i++) { const st = kit.tree(); tree(V, st.kind, (i ? 1 : -1) * 9.0, z0 + 6 + i * 18 + rng() * 6, 4 + rng(), rng() * TAU, st.tint); }
    if (kit.festival) {                                                                                 // summer: awnings + a festival lantern row
      const tints = [[0.85, 0.2, 0.2], [0.2, 0.55, 0.3], [0.2, 0.35, 0.8]];
      for (const f of faces) if (f.s < 0 && rng() < 0.6) V.take(P.awning, compose(f.x + 0.1, 3.3, f.z, 1, 1, 1, Math.PI / 2), V.tint(tints));
      const z = z0 + 9; V.take(P.chochin, compose(0, 0, z), V.col.setRGB(1, 0.45, 0.35)); V.light(0, z, 3.0, 0.9, [1.0, 0.4, 0.3]);
    }
    if (V.snow) for (const f of faces) if (f.h <= 12 && rng() < 0.5) V.take(P.snowCap, compose(f.x + f.s * 3.5, f.h + 0.1, f.z, 3.6, 0.5, 3.6));
  }

  function dressSuburb(V) {
    const { rng, z0, len, kit, index } = V, konbiniHere = index % 4 === 1, parkHere = index % 8 === 3, crossingHere = index % 8 === 5, schoolHere = index % 8 === 6;
    const house = (s, z) => {
      const two = rng() < 0.4, sc = 0.9 + rng() * 0.2, x = s * (13.6 + rng() * 1.2), ry = s < 0 ? -Math.PI / 2 : Math.PI / 2;
      V.take(two ? P.house2 : P.house, compose(x, 0, z, sc, sc, sc, ry), V.tint(HOUSE_TINTS));
      if (V.snow) V.take(P.snowCap, compose(x, (two ? 6.4 : 4.4) * sc, z, 3.6 * sc, 0.5, 4.2 * sc, ry));
      V.take(P.wall, compose(s * 9.5, 0, z + 0.5, 0.25, 1.1, 8.5), V.col.setRGB(0.62, 0.6, 0.54));
      const st = kit.tree(); tree(V, st.kind, s * (10.2 + rng() * 0.6), z + (rng() < 0.5 ? -4 : 4), 3.5 + rng() * 1.5, rng() * TAU, st.tint);
      if (rng() < 0.5) V.take(P.bicycle, compose(s * 9.0, 0, z + (rng() - 0.5) * 6, 1, 1, 1, rng() * 0.4), V.tint([[0.85, 0.25, 0.25], [0.3, 0.5, 0.85], [0.9, 0.9, 0.9]]));
    };
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const z = z0 + 6 + i * 12 + (rng() - 0.5) * 2;
      if (i === 1) {
        if (crossingHere) continue;
        if (s > 0 && konbiniHere) {                                                                     // konbini with a glowing sign band
          V.single(P1.konbini, 14.6, 0, z, Math.PI / 2); V.take(P.glowBox, compose(10.3, 3.1, z, 0.22, 0.8, 7), V.col.setRGB(0.35, 1.5, 2.3)); V.light(10.3, z, 3.1, 1.3, [0.45, 0.9, 1.0]);
          for (let k = 0; k < 2; k++) V.take(P.bicycle, compose(9.4, 0, z + 2 + k * 1.2, 1, 1, 1, Math.PI / 2), V.tint([[0.85, 0.25, 0.25], [0.3, 0.5, 0.85]]));
          continue;
        }
        if (s < 0 && parkHere) { V.single(P1.park, -15, 0, z); const st = kit.tree(); tree(V, st.kind, -13, z - 6, 5, rng() * TAU, st.tint); continue; }
      }
      house(s, z);
    }
    if (crossingHere) {                                                                                 // level crossing: rails, striped gates, wig-wag lamps
      const z = z0 + 18; V.single(P1.crossing, 0, 0, z);
      for (const s of [-1, 1]) {
        const a = V.take(P.glowSph, compose(s * 8.75, 3.1, z - 2.75, 0.16), RED_ON), b = V.take(P.glowSph, compose(s * 8.75, 3.1, z - 2.05, 0.16), RED_OFF);
        S.blink.push({ chunk: V.index, a, b }); V.light(s * 8.9, z - 2.4, 3.1, 0.7, [1, 0.25, 0.12]);
      }
    }
    if (schoolHere) V.single(P1.school, -36, 0, z0 + 18, -Math.PI / 2);
    for (const [side, x0, cols] of [[-1, 18, 2], [1, 24, 1]]) for (let c = 0; c < cols; c++) for (let r = 0; r < 3; r++) {   // rice paddies on the far verges
      const fx = side * (x0 + c * 9.5 + 4.6), fz = z0 + 6 + r * 12, t = kit.paddy();
      V.take(P.paddy, compose(fx, 0, fz, 9.0, 1, 11.4), V.col.setRGB(t[0], t[1], t[2]));
      V.take(P.wall, compose(side * (x0 + c * 9.5), 0, fz, 0.35, 0.22, 12), V.col.setRGB(...EARTH)); V.take(P.wall, compose(fx, 0, fz - 6, 9.5, 0.22, 0.35), V.col.setRGB(...EARTH));
    }
    poleLine(V, 9.2, 12);
    for (let i = 0; i < 6; i++) { const s = rng() < 0.5 ? -1 : 1; tree(V, 'cedar', s * (40 + rng() * 10), z0 + rng() * len, 8 + rng() * 6, rng() * TAU, kit.cedar()); }
  }

  function dressCoast(V) {
    const { rng, z0, len, kit } = V;
    for (let r = 0; r < 4; r++) for (let z = z0 + rng() * 1.5; z < z0 + len; z += 3.0 + rng()) {         // the cliff: stacked sandstone boulders on the left
      const x = -(9.6 + r * 2.3 + rng() * 1.2), sc = 1.4 + rng() * 1.2, v = rng() * 0.1;
      V.take(P.rock, composeT(x, r * 2.2 + sc * 0.4, z, sc, sc * 0.75, sc, rng() * 0.4, rng() * TAU, rng() * 0.4), V.col.setRGB(0.42 + v, 0.36 + v, 0.3 + v));
      if (V.snow && r === 3 && rng() < 0.6) V.take(P.snowCap, compose(x, r * 2.2 + sc * 0.95, z, sc * 0.8, sc * 0.25, sc * 0.8));
    }
    for (let i = 0; i < 4; i++) tree(V, 'pine', -(15 + rng() * 6), z0 + rng() * len, 4 + rng() * 3, rng() * TAU, kit.pine(), 8.2, 0.3 + rng() * 0.15);   // wind-bent pines on the cliff top
    if (V.season !== 1) for (let i = 0; i < 2; i++) { const st = kit.tree(); tree(V, st.kind, -(15 + rng() * 5), z0 + rng() * len, 3.5 + rng(), rng() * TAU, st.tint, 8.2); }
    for (const x of [-8.9, 8.9]) V.take(P.guardrail, compose(x, 0, z0 + len / 2));
    for (let z = z0 + 1; z < z0 + len; z += 3) V.take(P.tetrapod, compose(12.5 + rng() * 5, 0, z + rng(), 1, 1, 1, rng() * TAU));
    for (let i = 0; i < 3; i++) V.take(P.boat, compose(26 + rng() * 16, -0.3, z0 + rng() * len, 1, 1, 1, (rng() - 0.5) * 0.6), V.tint([[1, 1, 1], [0.95, 0.9, 0.8], [0.8, 0.9, 1]]));
    for (let i = 0; i < 5; i++) V.take(P.buoy, compose(21 + rng() * 20, -0.2, z0 + rng() * len, 1, 1, 1, rng() * TAU), V.tint([[0.9, 0.2, 0.15], [1, 0.6, 0.1], [0.95, 0.95, 0.95]]));
    for (let i = 0; i < 5; i++) { const g = { chunk: V.index, x: 12 + rng() * 18, y: 5 + rng() * 6, z: z0 + rng() * len, ry: rng() * TAU, ph: rng() * TAU }; g.i = V.take(P.gull, compose(g.x, g.y, g.z, 1, 1, 1, g.ry)); if (g.i >= 0) S.gulls.push(g); }
    if (V.index % 8 === 6) {                                                                            // lighthouse on the cliff, beacon sweeps in update
      const z = z0 + 20; V.single(P1.lighthouse, -17, 8.0, z);
      const i = V.take(P.glowSph, compose(-17, 17.9, z, 0.65), V.col.setRGB(3, 2.8, 2.2)); S.beacons.push({ chunk: V.index, i, ph: rng() * TAU }); V.light(-17, z, 17.9, 0.6, [1, 0.95, 0.8]);
    }
    if (V.index % 8 === 3) { const z = z0 + 18; V.single(P1.seaTorii, 27, -0.6, z, Math.PI / 2); if (V.snow) V.take(P.snowCap, compose(27, 8.45, z, 0.7, 0.15, 5)); }   // the torii in the water
  }

  /** Section entrance: the big torii (mountain) or a steel gantry with a neon name (everywhere else). */
  function entrance(V, biome) {
    const z = V.z0 + 2.5;
    if (biome === 0) { V.single(P1.bigTorii, 0, 0, z); if (V.snow) V.take(P.snowCap, compose(0, 8.5, z, 12, 0.18, 0.55)); return; }
    V.single(P1.gantry, 0, 0, z); const [text, css] = GATE[biome];
    const m = V.neon(text, css, false); m.position.set(0, 7.75, z - 0.2); aim(m, Math.PI); V.light(0, z, 7.75, 1.1, rgb(css));
  }

  // ---- public API --------------------------------------------------------------------------------
  function dress(chunk, ctx) {
    if (S.views.has(chunk.index)) release(chunk.index);
    const V = newView(chunk, ctx); S.season = ctx.season;
    [dressMountain, dressCity, dressSuburb, dressCoast][ctx.biome](V);
    if (chunk.index % 8 === 0) entrance(V, ctx.biome);
    S.views.set(chunk.index, V); flushAll();
  }
  function release(index) {
    const V = S.views.get(index); if (!V) return; S.views.delete(index);
    for (let k = 0; k < V.inst.length; k += 2) V.inst[k].give(V.inst[k + 1]);
    for (let k = 0; k < V.meshes.length; k += 2) V.meshes[k].give(V.meshes[k + 1]);
    for (const m of V.neons) neonGive(m);
    for (const i of V.wires) wires.give(i);
    for (const key of ['blink', 'signals', 'gulls', 'beacons']) S[key] = S[key].filter(e => e.chunk !== index);
    flushAll();
  }
  const _c = new THREE.Color();
  function update(dt, state = {}) {
    S.time += dt; if (state.night !== undefined) S.night = state.night; if (state.season !== undefined) S.season = state.season;
    const n = S.night, winter = S.season === 3;
    BLD.emissiveIntensity = 0.12 + 1.3 * n; BLD.emissive.setRGB(1, winter ? 0.82 : 0.95, winter ? 0.6 : 0.9);              // windows warm up in winter
    GLOWM.color.setScalar(0.55 + 0.75 * n); CHOCHIN.color.setScalar(0.5 + 0.7 * n);
    const bl = Math.floor(S.time * 2.2) % 2;                                                              // level-crossing wig-wag
    if (bl !== S.blinkPhase) { S.blinkPhase = bl; for (const c of S.blink) { P.glowSph.mesh.setColorAt(c.a, bl ? RED_ON : RED_OFF); P.glowSph.mesh.setColorAt(c.b, bl ? RED_OFF : RED_ON); P.glowSph.dirty = true; } }
    const sp = Math.floor(S.time / 5) % 2;                                                                // crosswalk signals: 5 s walk / 5 s stop
    if (sp !== S.sigPhase) { S.sigPhase = sp; for (const s of S.signals) { P.glowBox.mesh.setColorAt(s.r, sp ? RED_ON : RED_OFF); P.glowBox.mesh.setColorAt(s.g, sp ? GREEN_OFF : GREEN_ON); P.glowBox.dirty = true; } }
    for (const g of S.gulls) P.gull.set(g.i, composeT(g.x + Math.sin(S.time * 0.3 + g.ph) * 1.5, g.y + Math.sin(S.time * 1.7 + g.ph) * 0.4, g.z, 1, 1, 1, 0, g.ry, Math.sin(S.time * 7 + g.ph) * 0.35));
    for (const b of S.beacons) { const k = 0.6 + 2.6 * Math.pow(Math.max(0, Math.cos(S.time * 1.4 + b.ph)), 3); P.glowSph.mesh.setColorAt(b.i, _c.setRGB(k, k * 0.95, k * 0.8)); P.glowSph.dirty = true; }
    P.glowSph.flush(); P.glowBox.flush(); P.gull.flush();
  }
  return { dress, release, update };
}
