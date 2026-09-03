// Prop catalogue for KITSUNE: obstacles, power pickups, the two runner rigs
// and the koban coin. Every obstacle is ONE merged vertex-coloured geometry
// (PAINT material); small lit bits (lantern flames, crossing lamps) live in an
// optional `glow` entry so the renderer can add a second bloom mesh.
// Design space: x across, y up, z forward; props sit on y=0 facing -z, centred
// on x=0. Nothing here mirrors anything — the renderer's stage does that.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAINT, GLOW, paint, merge, box, cyl, cone, sph } from './common.js';

// ---- tiny helpers ----------------------------------------------------------
const P = (g, c, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => paint(g, c, { p, r, s });
/** hue/sat/light offset of a hex colour — for slight variation between variants. */
const HS = (hex, h = 0, s = 0, l = 0) => new THREE.Color(hex).offsetHSL(h, s, l);
const tor = (r, t, n = 6, m = 12) => new THREE.TorusGeometry(r, t, n, m);
// polyhedra come non-indexed; index them so they merge with the indexed primitives
const dode = (r) => mergeVertices(new THREE.DodecahedronGeometry(r, 0));
const ico = (r) => mergeVertices(new THREE.IcosahedronGeometry(r, 0));
const HPI = Math.PI / 2;
/** Build a catalogue variant. `glow` (optional) is an array of GLOW-coloured parts. */
const V = (parts, name, glow) => {
  const v = { geo: merge(parts), mat: PAINT, name };
  if (glow && glow.length) v.glow = { geo: merge(glow), mat: GLOW };
  return v;
};
/** A straight cylinder from point a to point b. */
function seg(a, b, r, color, n = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return P(cyl(r, r, L, n), color, [(A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2], [e.x, e.y, e.z]);
}
/** A sagging rope between two points (k straight segments on a parabola). */
function rope(a, b, r, color, sag = 0.15, k = 5) {
  const out = []; let prev = a;
  for (let i = 1; i <= k; i++) {
    const t = i / k, pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
    out.push(seg(prev, pt, r, color, 5)); prev = pt;
  }
  return out;
}
/** Shide: the zigzag paper streamers that hang from a shimenawa. */
function shide(x, y, z, color = '#fbf7ee') {
  return [P(box(0.14, 0.12, 0.01), color, [x, y - 0.06, z]), P(box(0.14, 0.12, 0.01), color, [x + 0.07, y - 0.18, z]),
    P(box(0.14, 0.12, 0.01), color, [x, y - 0.3, z]), P(box(0.14, 0.12, 0.01), color, [x + 0.07, y - 0.42, z])];
}
/** Chōchin paper lantern body (painted) + its glowing panel (returned separately). */
function chochin(x, y, z, color = '#d8342c', r = 0.16) {
  const body = [P(sph(r, 8), color, [x, y, z], [0, 0, 0], [1, 1.35, 1]),
    P(cyl(r * 0.55, r * 0.55, 0.05, 8), '#2b2422', [x, y + r * 1.35, z]), P(cyl(r * 0.55, r * 0.55, 0.05, 8), '#2b2422', [x, y - r * 1.35, z])];
  const glow = [P(sph(r * 0.7, 6), [2.2, 1.1, 0.5], [x, y, z], [0, 0, 0], [1, 1.35, 1])];
  return { body, glow };
}
/** A bicycle lying/standing along +x (wheels in the xy plane). */
function bicycle(x, y, z, frame = '#3a5fa8', ry = 0) {
  const parts = [];
  const rot = (p) => { const c = Math.cos(ry), s = Math.sin(ry); return [x + p[0] * c + p[2] * s, y + p[1], z - p[0] * s + p[2] * c]; };
  const R = [0, ry, 0];
  for (const wx of [-0.5, 0.5]) { parts.push(P(tor(0.3, 0.025, 5, 14), '#2a2a2a', rot([wx, 0.3, 0]), R)); parts.push(P(cyl(0.03, 0.03, 0.03, 6), '#999', rot([wx, 0.3, 0]), [HPI, 0, ry])); }
  parts.push(seg(rot([-0.5, 0.3, 0]), rot([-0.1, 0.72, 0]), 0.02, frame), seg(rot([-0.1, 0.72, 0]), rot([0.45, 0.72, 0]), 0.02, frame),
    seg(rot([0.45, 0.72, 0]), rot([0.5, 0.3, 0]), 0.02, frame), seg(rot([-0.1, 0.72, 0]), rot([0.15, 0.32, 0]), 0.02, frame), seg(rot([0.15, 0.32, 0]), rot([0.42, 0.75, 0]), 0.02, frame),
    P(box(0.22, 0.05, 0.12), '#2b2422', rot([-0.1, 0.8, 0]), R), P(box(0.05, 0.03, 0.42), '#2a2a2a', rot([0.5, 0.92, 0]), R), P(box(0.28, 0.16, 0.3), '#c9b68a', rot([0.62, 0.86, 0]), R));
  return parts;
}
/** Traffic cone. */
const trafficCone = (x, z, c = '#f26a1b') => [P(cone(0.16, 0.55, 8), c, [x, 0.28, z]), P(box(0.36, 0.03, 0.36), '#2a2a2a', [x, 0.015, z]), P(cyl(0.1, 0.13, 0.1, 8), '#fff', [x, 0.3, z])];
/** Snow-free stacked stones used as gap edging. */
function edgeStones(color, dark, n = 6, len = 3, w = 2.1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5, z = t * len;
    for (const x of [-w / 2 - 0.1, w / 2 + 0.1]) out.push(P(box(0.3, 0.12, len / n - 0.06), i % 2 ? color : dark, [x, 0.06, z]));
  }
  for (const z of [-len / 2 - 0.1, len / 2 + 0.1]) out.push(P(box(w + 0.6, 0.1, 0.22), color, [0, 0.05, z]));
  return out;
}
/** The dark recess every gap shares: a pit below y=0 with an inner floor. */
const pit = (w = 2.1, len = 3) => [P(box(w, 0.6, len), '#16161c', [0, -0.32, 0]), P(box(w - 0.1, 0.02, len - 0.1), '#0b0b10', [0, -0.03, 0])];

// ============================================================================
// MOUNTAIN — shrine path
// ============================================================================
function stoneLantern(v) {
  const stone = HS('#8d8a80', 0, 0, v * 0.03), dark = HS('#6d6a62', 0, 0, v * 0.03), moss = '#5e7a4a';
  const parts = [P(box(0.8, 0.25, 0.8), dark, [0, 0.12, 0]), P(cyl(0.13, 0.16, 1.0), stone, [0, 0.75, 0]), P(box(0.8, 0.12, 0.8), dark, [0, 1.3, 0]),
    P(box(0.5, 0.5, 0.5), stone, [0, 1.6, 0]), P(box(0.3, 0.3, 0.52), '#2a2420', [0, 1.6, 0]),
    P(cone(0.62, 0.4, 4), stone, [0, 2.05, 0], [0, Math.PI / 4, 0]), P(sph(0.1, 8), stone, [0, 2.3, 0]), P(box(0.5, 0.06, 0.5), moss, [0, 0.27, 0])];
  if (v % 2) parts.push(P(box(0.82, 0.05, 0.82), moss, [0, 1.38, 0]));
  return V(parts, 'stone lantern', [P(sph(0.11, 6), [2.4, 1.3, 0.5], [0, 1.6, 0])]);
}
function bambooCluster(v) {
  const parts = []; const green = HS('#7fae4a', v * 0.02, 0, 0);
  const stems = [[0, 0, 2.5], [0.28, 0.12, 2.2], [-0.25, 0.18, 2.35], [0.12, -0.28, 2.1], [-0.12, -0.12, 2.45]];
  for (const [x, z, h] of stems) {
    parts.push(P(cyl(0.05, 0.065, h, 7), green, [x, h / 2, z]));
    for (let y = 0.5; y < h; y += 0.55) parts.push(P(cyl(0.062, 0.062, 0.04, 7), '#dfe3a8', [x, y, z]));
    for (let i = 0; i < 3; i++) parts.push(P(box(0.34, 0.02, 0.09), HS('#5f9a3a', 0, 0, i * 0.04), [x + (i % 2 ? 0.2 : -0.2), h - 0.3 - i * 0.35, z], [0, i * 0.9, i % 2 ? 0.3 : -0.3]));
  }
  parts.push(P(cyl(0.45, 0.5, 0.08, 8), '#6a5a42', [0, 0.04, 0]));
  return V(parts, 'bamboo cluster');
}
function jizo(v) {
  const stone = HS('#9a978f', 0, 0, v * 0.03), bib = v % 2 ? '#d8342c' : '#e05a3a';
  return V([P(box(0.9, 0.3, 0.9), '#6f6c64', [0, 0.15, 0]), P(cyl(0.34, 0.4, 1.1, 10), stone, [0, 0.85, 0]),
    P(sph(0.3, 10), stone, [0, 1.65, 0]), P(sph(0.05, 6), '#2a2420', [-0.1, 1.68, -0.27]), P(sph(0.05, 6), '#2a2420', [0.1, 1.68, -0.27]),
    P(box(0.5, 0.45, 0.06), bib, [0, 1.2, -0.36]), P(box(0.55, 0.06, 0.08), bib, [0, 1.42, -0.36]),   // red bib
    P(box(0.5, 0.14, 0.5), '#e04a3c', [0, 2.0, 0]), P(box(0.6, 0.04, 0.6), '#e04a3c', [0, 2.06, 0]),   // red knit hat
    P(cyl(0.02, 0.02, 1.2, 5), '#8b7355', [-0.34, 1.0, -0.2]), P(sph(0.07, 6), '#c9a24a', [-0.34, 1.62, -0.2]),  // staff w/ rings
    P(box(0.28, 0.1, 0.14), '#f3e6c8', [0.25, 0.36, -0.3]), P(cyl(0.05, 0.06, 0.1, 6), '#ffd56b', [0.25, 0.46, -0.3])], // offering (mochi)
  'jizō with red bib');
}
function cedarStump(v) {
  const bark = HS('#6b4b32', 0, 0, v * 0.03);
  const parts = [P(cyl(0.42, 0.55, 2.2, 10), bark, [0, 1.1, 0]), P(cyl(0.4, 0.4, 0.05, 10), '#c9a978', [0, 2.22, 0]), P(cyl(0.2, 0.2, 0.06, 10), '#a7845a', [0, 2.235, 0]),
    P(cyl(0.62, 0.62, 0.1, 10), '#5e7a4a', [0, 0.05, 0]), P(box(0.25, 0.5, 0.3), bark, [0.45, 0.25, 0.1])];
  parts.push(...rope([-0.5, 1.5, -0.46], [0.5, 1.5, -0.46], 0.05, '#d9c79a', 0.1), ...rope([0.5, 1.5, -0.46], [0.5, 1.5, 0.46], 0.05, '#d9c79a', 0.1),
    ...rope([-0.5, 1.5, 0.46], [-0.5, 1.5, -0.46], 0.05, '#d9c79a', 0.1), ...rope([-0.5, 1.5, 0.46], [0.5, 1.5, 0.46], 0.05, '#d9c79a', 0.1),
    ...shide(-0.3, 1.5, -0.5), ...shide(0.2, 1.5, -0.5));
  return V(parts, 'cedar stump with shimenawa');
}
function toriiSmall(v) {
  const red = HS('#c9302c', 0, 0, v * 0.03), black = '#2b2422';
  return V([P(cyl(0.09, 0.11, 1.3, 8), red, [-1.05, 0.65, 0]), P(cyl(0.09, 0.11, 1.3, 8), red, [1.05, 0.65, 0]),
    P(box(2.7, 0.14, 0.18), black, [0, 1.36, 0]), P(box(2.3, 0.1, 0.12), red, [0, 1.1, 0]), P(box(0.16, 0.24, 0.1), black, [0, 1.22, 0]),
    P(box(0.3, 0.06, 0.3), '#8d8a80', [-1.05, 0.03, 0]), P(box(0.3, 0.06, 0.3), '#8d8a80', [1.05, 0.03, 0])], 'small torii');
}
function shimenawaGate(v) {
  const parts = [P(cyl(0.08, 0.1, 1.55, 8), '#6b4b32', [-1.05, 0.77, 0]), P(cyl(0.08, 0.1, 1.55, 8), '#6b4b32', [1.05, 0.77, 0])];
  parts.push(...rope([-1.05, 1.5, 0], [1.05, 1.5, 0], 0.09, HS('#d9c79a', 0, 0, v * 0.03), 0.28, 7));
  for (let i = 0; i < 4; i++) parts.push(...shide(-0.75 + i * 0.5, 1.28 - 0.05 * Math.abs(i - 1.5), 0.02));
  for (let i = 0; i < 3; i++) parts.push(P(cone(0.06, 0.28, 5), '#e6d5a8', [-0.5 + i * 0.5, 1.12 - 0.02, 0.02], [Math.PI, 0, 0]));  // hanging straw tassels
  return V(parts, 'shimenawa with shide');
}
function emaBranch(v) {
  const bark = '#5a4030', parts = [P(cyl(0.12, 0.18, 2.2, 8), bark, [-1.15, 1.1, 0]), seg([-1.15, 1.9, 0], [1.2, 1.3, 0], 0.07, bark, 7),
    seg([0.1, 1.6, 0], [0.5, 2.0, -0.2], 0.04, bark, 5), seg([-0.4, 1.7, 0], [-0.2, 2.1, 0.2], 0.035, bark, 5)];
  const colors = ['#f0dcb0', '#ffb2c0', '#f7e6a0', '#e6d5a8'];
  for (let i = 0; i < 4; i++) { const x = -0.7 + i * 0.45, y = 1.79 - i * 0.115; parts.push(seg([x, y, 0], [x, y - 0.3, 0], 0.012, '#c9302c', 4), P(box(0.26, 0.2, 0.02), colors[(i + v) % 4], [x, y - 0.42, 0]), P(box(0.3, 0.05, 0.03), '#5a4030', [x, y - 0.3, 0])); }
  parts.push(P(sph(0.3, 7), HS('#4f8a3a', v * 0.05, 0, 0), [0.55, 2.15, -0.2], [0, 0, 0], [1.3, 0.6, 1]), P(sph(0.25, 7), HS('#4f8a3a', v * 0.05, 0, 0.05), [-0.2, 2.25, 0.2], [0, 0, 0], [1.3, 0.6, 1]));
  return V(parts, 'branch with ema');
}
function mossBoulder(v) {
  const rock = HS('#6e7264', 0, 0, v * 0.03);
  return V([P(dode(0.62), rock, [0, 0.3, 0], [0, v * 0.7, 0], [1.4, 0.5, 1.1]), P(dode(0.35), '#5e7a4a', [0.25, 0.42, 0.1], [0, 0, 0], [1.2, 0.45, 1]),
    P(dode(0.3), rock, [-0.55, 0.15, -0.2], [0, 1, 0], [1, 0.6, 1]), P(dode(0.22), '#6f8f52', [-0.4, 0.3, 0.25], [0, 0.4, 0], [1.2, 0.5, 1])], 'mossy boulder');
}
function fallenLog(v) {
  const bark = HS('#6b4b32', 0, 0, v * 0.03);
  return V([P(cyl(0.24, 0.27, 2.0, 9), bark, [0, 0.27, 0], [0, 0, HPI]), P(cyl(0.2, 0.2, 0.04, 9), '#c9a978', [1.02, 0.27, 0], [0, 0, HPI]),
    P(cyl(0.2, 0.2, 0.04, 9), '#c9a978', [-1.02, 0.27, 0], [0, 0, HPI]), P(box(1.2, 0.08, 0.35), '#5e7a4a', [0.1, 0.5, 0.05]),
    P(cone(0.09, 0.12, 6), '#c86a3a', [0.5, 0.56, -0.1]), P(cone(0.07, 0.1, 6), '#c86a3a', [0.62, 0.55, -0.16])], 'fallen log');  // mushrooms
}
function saisenBox(v) {
  const wood = HS('#7a5a3a', 0, 0, v * 0.03);
  const parts = [P(box(1.4, 0.5, 0.9), wood, [0, 0.3, 0]), P(box(0.2, 0.55, 0.12), '#3b2a1a', [-0.6, 0.28, -0.46]), P(box(0.2, 0.55, 0.12), '#3b2a1a', [0.6, 0.28, -0.46])];
  for (let i = 0; i < 6; i++) parts.push(P(box(0.05, 0.03, 0.8), '#3b2a1a', [-0.5 + i * 0.2, 0.57, 0]));
  parts.push(P(box(1.6, 0.06, 1.05), '#8d8a80', [0, 0.03, 0]), P(box(0.22, 0.1, 0.02), '#f4efe4', [0.2, 0.3, -0.46]), P(sph(0.04, 6), '#e0b04a', [0.3, 0.58, 0.1]));
  return V(parts, 'saisen box');
}
function gapMountain() {
  const parts = [...pit(), ...edgeStones('#8d8a80', '#6d6a62')];
  parts.push(P(box(0.35, 0.04, 0.5), '#8d8a80', [-0.6, 0.02, -1.4], [0, 0.3, 0]), P(box(0.3, 0.04, 0.4), '#6d6a62', [0.8, 0.02, 1.4], [0, -0.4, 0]), P(box(0.4, 0.05, 0.3), '#5e7a4a', [0.2, 0.02, -1.55]));
  return V(parts, 'broken flagstones');
}
function fallenCedar(v) {
  const bark = HS('#6b4b32', 0, 0, v * 0.03), leaf = HS('#3f6b34', v * 0.03, 0, 0);
  const parts = [P(cyl(0.45, 0.62, 4.4, 10), bark, [0, 0.62, 0], [0, 0, HPI]), P(cyl(0.61, 0.61, 0.06, 10), '#c9a978', [-2.22, 0.62, 0], [0, 0, HPI]),
    P(box(0.5, 0.55, 0.5), bark, [-1.8, 0.25, 0.1]), P(box(0.5, 0.55, 0.5), bark, [1.8, 0.25, 0.1])];
  for (let i = 0; i < 5; i++) { const x = 0.2 + i * 0.4, s = 1 - i * 0.12; parts.push(P(cone(0.55 * s, 1.2 * s, 7), leaf, [x, 1.4 + i * 0.05, i % 2 ? 0.45 : -0.4], [i % 2 ? -0.5 : 0.5, 0, 0.35])); }
  parts.push(P(cone(0.45, 0.9, 7), leaf, [1.9, 1.0, 0], [0, 0, -HPI]), P(cone(0.4, 1.0, 7), leaf, [1.6, 1.7, 0], [0.3, 0, -0.3]));
  return V(parts, 'fallen cedar');
}
function sakeBarrel() {
  const wood = '#c9a978'; const parts = [P(cyl(0.5, 0.5, 1.15, 12), wood, [0, 0.52, 0], [0, 0, HPI])];
  for (const x of [-0.42, 0.42]) parts.push(P(tor(0.51, 0.03, 5, 14), '#8b6a3a', [x, 0.52, 0], [0, HPI, 0]));
  parts.push(P(cyl(0.52, 0.52, 0.05, 12), '#f4efe4', [0.57, 0.52, 0], [0, 0, HPI]), P(cyl(0.52, 0.52, 0.05, 12), '#f4efe4', [-0.57, 0.52, 0], [0, 0, HPI]),
    P(box(0.06, 0.34, 0.34), '#c9302c', [0.61, 0.52, 0]), P(box(0.06, 0.34, 0.34), '#c9302c', [-0.61, 0.52, 0]));
  return V(parts, 'rolling sake barrel');
}

// ============================================================================
// CITY — neon streets
// ============================================================================
function vendingMachine(tint) {
  const parts = [P(box(0.95, 2.05, 0.7), tint, [0, 1.02, 0]), P(box(0.7, 1.1, 0.06), '#dfe9ff', [0.05, 1.3, -0.36]), P(box(0.2, 0.5, 0.06), '#222', [-0.32, 0.9, -0.36]),
    P(box(0.95, 0.12, 0.7), '#2a2a2a', [0, 0.06, 0]), P(box(0.5, 0.18, 0.06), '#2a2a2a', [0.1, 0.35, -0.36]), P(box(0.6, 0.1, 0.05), '#fff', [0.05, 1.95, -0.36])];
  for (let i = 0; i < 6; i++) parts.push(P(cyl(0.05, 0.05, 0.16, 6), ['#e8d24a', '#4aa3e8', '#e84a4a', '#8fd36b', '#f4efe4', '#e89a4a'][i], [-0.2 + (i % 3) * 0.24, 1.55 - Math.floor(i / 3) * 0.4, -0.36]));
  return V(parts, 'vending machine', [P(box(0.62, 0.08, 0.03), [1.6, 1.6, 1.8], [0.05, 1.95, -0.375])]);
}
function pachinkoPillar(v) {
  const parts = [P(box(0.7, 2.4, 0.5), HS('#e3342f', v * 0.02, 0, 0), [0, 1.2, 0]), P(box(0.8, 0.15, 0.6), '#f6d35a', [0, 2.45, 0]), P(box(0.8, 0.1, 0.6), '#2a2a2a', [0, 0.05, 0])];
  for (let i = 0; i < 4; i++) parts.push(P(box(0.34, 0.34, 0.04), i % 2 ? '#f6d35a' : '#fff', [0, 0.55 + i * 0.5, -0.27]), P(box(0.2, 0.2, 0.06), '#e3342f', [0, 0.55 + i * 0.5, -0.27]));
  const glow = [];
  for (let i = 0; i < 6; i++) glow.push(P(sph(0.04, 5), i % 2 ? [2.4, 2.0, 0.4] : [2.4, 0.5, 0.8], [-0.3, 0.4 + i * 0.4, -0.26]), P(sph(0.04, 5), i % 2 ? [2.4, 0.5, 0.8] : [2.4, 2.0, 0.4], [0.3, 0.4 + i * 0.4, -0.26]));
  return V(parts, 'pachinko sign pillar', glow);
}
function manekiNeko(v) {
  const white = '#f7f2ea', spot = v % 2 ? '#e8792c' : '#2b2422';
  return V([P(cyl(0.6, 0.66, 0.5, 12), '#c9302c', [0, 0.25, 0]), P(cyl(0.7, 0.7, 0.05, 12), '#f6d35a', [0, 0.5, 0]),
    P(sph(0.5, 12), white, [0, 1.05, 0], [0, 0, 0], [1, 1.15, 0.9]), P(sph(0.42, 12), white, [0, 1.75, 0], [0, 0, 0], [1.1, 0.95, 1]),
    P(cone(0.12, 0.2, 5), white, [-0.28, 2.15, 0]), P(cone(0.12, 0.2, 5), white, [0.28, 2.15, 0]), P(sph(0.16, 7), spot, [0.22, 1.98, -0.28]),
    P(sph(0.05, 6), '#2a2420', [-0.14, 1.8, -0.4]), P(sph(0.05, 6), '#2a2420', [0.14, 1.8, -0.4]), P(box(0.1, 0.05, 0.04), '#e07a6a', [0, 1.68, -0.42]),
    P(cyl(0.11, 0.13, 0.55, 8), white, [-0.46, 1.6, -0.1], [0, 0, -0.15]), P(sph(0.14, 7), white, [-0.5, 1.9, -0.1]),   // raised paw
    P(box(0.5, 0.1, 0.5), '#c9302c', [0, 1.5, 0]), P(sph(0.06, 6), '#f6d35a', [0, 1.5, -0.42]),                          // collar + bell
    P(box(0.34, 0.24, 0.1), '#f6d35a', [0.2, 0.9, -0.44], [0, 0, 0.3]), P(box(0.2, 0.06, 0.12), '#c9302c', [0.2, 0.9, -0.44], [0, 0, 0.3])], // koban
  'maneki-neko');
}
function taxiPole(v) {
  return V([P(cyl(0.05, 0.06, 2.3, 8), '#8e959c', [0, 1.15, 0]), P(box(0.4, 0.5, 0.06), HS('#2a9d4b', v * 0.05, 0, 0), [0, 2.1, 0]),
    P(box(0.32, 0.12, 0.08), '#fff', [0, 2.2, 0]), P(box(0.5, 0.06, 0.5), '#2a2a2a', [0, 0.03, 0]), P(box(0.36, 0.2, 0.08), '#fff', [0, 1.5, 0]), P(box(0.3, 0.04, 0.1), '#e3342f', [0, 1.5, 0])], 'taxi-stand pole');
}
function noren(v) {
  const color = ['#2f3f8f', '#8a2b2b', '#2b6a5a', '#3a3a3a'][v % 4];
  return V([P(cyl(0.05, 0.05, 2.9, 6), '#3b2a1a', [0, 1.45, 0], [0, 0, HPI]), P(cyl(0.06, 0.08, 1.5, 6), '#3b2a1a', [-1.4, 0.75, 0]), P(cyl(0.06, 0.08, 1.5, 6), '#3b2a1a', [1.4, 0.75, 0]),
    P(box(0.7, 0.5, 0.03), color, [-0.75, 1.15, 0]), P(box(0.7, 0.5, 0.03), color, [0, 1.15, 0], [0, 0, 0], [1, 1, 1]), P(box(0.7, 0.5, 0.03), color, [0.75, 1.15, 0]),
    P(box(0.28, 0.28, 0.04), '#f4efe4', [0, 1.15, 0]), P(box(0.12, 0.12, 0.05), color, [0, 1.15, 0]), P(box(2.3, 0.05, 0.05), '#f4efe4', [0, 1.4, 0])], 'noren curtain');
}
function shopAwning(v) {
  const stripe = v % 2 ? '#c9302c' : '#2f3f8f', parts = [P(cyl(0.05, 0.06, 1.6, 6), '#5a5a5a', [-1.35, 0.8, 0]), P(cyl(0.05, 0.06, 1.6, 6), '#5a5a5a', [1.35, 0.8, 0]), P(box(2.9, 0.06, 0.9), '#f4efe4', [0, 1.6, 0.2], [0.12, 0, 0])];
  for (let i = 0; i < 5; i++) parts.push(P(box(0.29, 0.07, 0.92), i % 2 ? stripe : '#f4efe4', [-1.16 + i * 0.58, 1.62, 0.2], [0.12, 0, 0]));
  const glow = [];
  for (let i = 0; i < 3; i++) { const c = chochin(-0.8 + i * 0.8, 1.3, -0.1, '#d8342c', 0.13); parts.push(...c.body); glow.push(...c.glow); parts.push(seg([-0.8 + i * 0.8, 1.55, -0.1], [-0.8 + i * 0.8, 1.48, -0.1], 0.01, '#2b2422', 4)); }
  parts.push(P(box(2.9, 0.06, 0.08), '#5a5a5a', [0, 1.55, -0.25]));
  return V(parts, 'shop awning with lanterns', glow);
}
function kanjiBanner(v) {
  const cloth = ['#1d1d2a', '#8a2b2b', '#f4efe4', '#2b6a5a'][v % 4], ink = v % 4 === 2 ? '#1d1d2a' : '#f4efe4';
  const parts = [P(cyl(0.05, 0.06, 2.5, 6), '#5a5a5a', [-1.25, 1.25, 0]), P(cyl(0.05, 0.06, 2.5, 6), '#5a5a5a', [1.25, 1.25, 0]), P(cyl(0.04, 0.04, 2.6, 6), '#5a5a5a', [0, 2.45, 0], [0, 0, HPI]),
    P(box(2.2, 1.15, 0.03), cloth, [0, 1.85, 0]), P(box(2.2, 0.04, 0.05), '#5a5a5a', [0, 2.42, 0])];
  // brushy "characters": stacked strokes suggesting kanji without a texture
  for (let i = 0; i < 3; i++) { const x = -0.65 + i * 0.65; parts.push(P(box(0.34, 0.06, 0.04), ink, [x, 2.1, 0]), P(box(0.06, 0.4, 0.04), ink, [x, 1.9, 0]), P(box(0.28, 0.06, 0.04), ink, [x + 0.02, 1.7, 0]), P(box(0.2, 0.05, 0.04), ink, [x - 0.06, 1.97, 0], [0, 0, 0.5])); }
  for (let i = 0; i < 6; i++) parts.push(P(box(0.14, 0.14, 0.04), '#f6d35a', [-0.9 + i * 0.36, 1.32, 0], [0, 0, Math.PI / 4]));   // hem tassels
  return V(parts, 'hanging kanji banner');
}
function constructionBarrier(v) {
  const parts = [P(box(1.7, 0.42, 0.18), HS('#f2c230', 0, 0, v * 0.03), [0, 0.5, 0]), P(box(0.12, 0.6, 0.3), '#c9c9c9', [-0.78, 0.3, 0]), P(box(0.12, 0.6, 0.3), '#c9c9c9', [0.78, 0.3, 0])];
  for (let i = 0; i < 3; i++) parts.push(P(box(0.2, 0.44, 0.2), '#1e1e1e', [-0.55 + i * 0.55, 0.5, 0], [0, 0, 0.3]));
  parts.push(...trafficCone(-1.0, 0.15), P(sph(0.09, 6), '#f4efe4', [0.78, 0.66, 0]));
  return V(parts, 'construction barrier', [P(sph(0.06, 5), [2.6, 0.6, 0.4], [0.78, 0.66, -0.06])]);
}
function bikeRack(v) {
  const parts = [P(box(1.9, 0.05, 0.4), '#8e959c', [0, 0.03, 0])];
  for (let i = 0; i < 3; i++) parts.push(P(tor(0.22, 0.02, 5, 10), '#8e959c', [-0.6 + i * 0.6, 0.18, 0], [HPI, 0, 0]));
  const colors = ['#3a5fa8', '#c9302c', '#f4efe4', '#2b6a5a'];
  parts.push(...bicycle(-0.55, 0, 0, colors[v % 4], HPI), ...bicycle(0.45, 0, 0.1, colors[(v + 1) % 4], HPI + 0.2));
  return V(parts, 'bicycle rack');
}
function cardboardStack(v) {
  const c = HS('#c9a978', 0, 0, v * 0.03);
  return V([P(box(0.8, 0.5, 0.6), c, [-0.4, 0.25, 0]), P(box(0.7, 0.55, 0.5), HS(c, 0, 0, -0.06), [0.4, 0.27, 0.05], [0, 0.2, 0]), P(box(0.6, 0.35, 0.45), c, [0, 0.55, -0.05], [0, -0.15, 0]),
    P(box(0.6, 0.02, 0.05), '#8b6a3a', [0, 0.73, -0.05], [0, -0.15, 0]), P(box(0.8, 0.02, 0.05), '#8b6a3a', [-0.4, 0.5, 0]), P(box(0.25, 0.12, 0.01), '#f4efe4', [-0.4, 0.3, -0.31]),
    P(box(0.4, 0.15, 0.4), HS(c, 0, 0, -0.1), [-0.9, 0.08, 0.2], [0, 0.5, 0])], 'cardboard box stack');
}
function gapCity() {
  const parts = [...pit(), P(box(2.5, 0.06, 3.4), '#3a3a3a', [0, 0.03, 0]), P(box(2.1, 0.02, 3.0), '#0b0b10', [0, 0.065, 0])];   // open manhole strip
  parts.push(P(cyl(0.45, 0.45, 0.06, 12), '#5a5a5a', [-1.35, 0.03, -0.9], [0, 0, 0.25]), ...trafficCone(1.3, -1.7), ...trafficCone(-1.3, 1.7), P(box(0.05, 0.6, 3.2), '#f2c230', [1.2, 0.5, 0]), P(box(0.05, 0.6, 3.2), '#f2c230', [-1.2, 0.5, 0]));
  return V(parts, 'open manhole strip');
}
function truckTail(v) {
  const body = v ? '#f4efe4' : '#2f7a9f', accent = v ? '#2b6a5a' : '#f4efe4';
  const parts = [P(box(4.3, 1.6, 1.6), body, [0.35, 1.3, 0]), P(box(1.0, 1.15, 1.4), '#3a3a3a', [-1.75, 1.05, 0]), P(box(0.9, 0.5, 1.42), '#bfe8ff', [-1.75, 1.35, 0]),
    P(box(4.5, 0.25, 1.5), '#2a2a2a', [0, 0.45, 0]), P(box(4.3, 0.12, 1.5), accent, [0.35, 1.3, 0]), P(box(0.1, 1.3, 1.5), '#4a4a4a', [2.5, 1.2, 0]),
    P(box(0.4, 0.15, 1.5), '#e3342f', [2.4, 0.5, 0]), P(box(0.04, 0.9, 0.05), '#8e959c', [2.53, 1.2, 0])];
  for (const x of [-1.5, 1.6]) for (const z of [-0.75, 0.75]) parts.push(P(cyl(0.4, 0.4, 0.28, 12), '#1e1e1e', [x, 0.4, z], [HPI, 0, 0]), P(cyl(0.2, 0.2, 0.3, 8), '#9a9a9a', [x, 0.4, z], [HPI, 0, 0]));
  parts.push(...trafficCone(-2.3, -1.3), ...trafficCone(2.3, -1.3));
  return V(parts, 'delivery truck tail');
}
function salaryman() {
  const parts = bicycle(0, 0, 0, '#2a2a2a', 0);
  parts.push(P(box(0.34, 0.5, 0.28), '#2b2f4a', [-0.05, 1.12, 0]), P(sph(0.13, 8), '#f1c9a5', [-0.02, 1.5, 0]), P(sph(0.135, 8), '#2a2420', [-0.03, 1.55, 0], [0, 0, 0], [1, 0.7, 1]),
    P(box(0.08, 0.28, 0.06), '#c9302c', [-0.05, 1.17, -0.15]), P(box(0.28, 0.1, 0.24), '#2b2f4a', [-0.18, 0.87, 0]),
    seg([-0.05, 1.28, -0.12], [0.5, 0.95, -0.12], 0.035, '#2b2f4a'), seg([-0.05, 1.28, 0.12], [0.5, 0.95, 0.12], 0.035, '#2b2f4a'),
    seg([-0.15, 0.85, -0.1], [0.15, 0.45, -0.1], 0.04, '#2b2f4a'), seg([-0.15, 0.85, 0.1], [0.15, 0.45, 0.1], 0.04, '#2b2f4a'), P(box(0.3, 0.2, 0.06), '#3b2a1a', [-0.3, 0.9, 0.18]));
  return V(parts, 'salaryman on a bicycle');
}

// ============================================================================
// SUBURB — quiet streets, rice paddies
// ============================================================================
function utilityPole(v) {
  const parts = [P(cyl(0.11, 0.14, 2.6, 8), HS('#8e8e86', 0, 0, v * 0.02), [0, 1.3, 0]), P(box(1.3, 0.08, 0.08), '#5a5a5a', [0, 2.35, 0]), P(box(1.1, 0.06, 0.06), '#5a5a5a', [0, 2.0, 0])];
  for (const x of [-0.5, -0.17, 0.17, 0.5]) parts.push(P(cyl(0.04, 0.04, 0.12, 6), '#f4efe4', [x, 2.45, 0]));
  parts.push(P(cyl(0.16, 0.18, 0.4, 8), '#5a5a5a', [0.35, 1.75, 0]), P(box(0.3, 0.4, 0.04), '#f2c230', [0, 1.2, -0.13]), P(box(0.24, 0.08, 0.05), '#1e1e1e', [0, 1.3, -0.13]), P(box(0.2, 0.06, 0.05), '#1e1e1e', [0, 1.1, -0.13]));
  return V(parts, 'utility pole');
}
function postbox(v) {
  const red = HS('#d73a2f', 0, 0, v * 0.03);
  return V([P(cyl(0.34, 0.34, 1.4, 12), red, [0, 0.9, 0]), P(sph(0.34, 12), red, [0, 1.6, 0], [0, 0, 0], [1, 0.6, 1]), P(cyl(0.36, 0.36, 0.06, 12), '#a02a22', [0, 1.62, 0]),
    P(cyl(0.3, 0.32, 0.25, 12), '#3a3a3a', [0, 0.15, 0]), P(cyl(0.34, 0.34, 0.06, 12), '#a02a22', [0, 0.3, 0]), P(box(0.3, 0.05, 0.05), '#1e1e1e', [0, 1.35, -0.34]),
    P(box(0.36, 0.2, 0.03), '#f4efe4', [0, 1.05, -0.34]), P(box(0.3, 0.03, 0.04), '#1e1e1e', [0, 1.08, -0.35]), P(box(0.2, 0.03, 0.04), '#1e1e1e', [0, 1.02, -0.35]),
    P(cyl(0.1, 0.1, 0.5, 8), '#f4efe4', [0, 2.05, 0]), P(sph(0.12, 8), '#f4efe4', [0, 2.3, 0])], 'red postbox');
}
function shigarakiTanuki(v) {
  const fur = HS('#8a6a48', 0, 0, v * 0.03), belly = '#d9c3a0';
  return V([P(sph(0.55, 12), fur, [0, 0.8, 0], [0, 0, 0], [1, 1.25, 0.9]), P(sph(0.42, 10), belly, [0, 0.7, -0.22], [0, 0, 0], [1, 1.1, 0.6]),
    P(sph(0.36, 10), fur, [0, 1.65, -0.05]), P(box(0.62, 0.14, 0.1), '#3b2a1a', [0, 1.7, -0.36]), P(sph(0.06, 6), '#f4efe4', [-0.15, 1.72, -0.4]), P(sph(0.06, 6), '#f4efe4', [0.15, 1.72, -0.4]),
    P(sph(0.03, 5), '#1e1e1e', [-0.15, 1.72, -0.45]), P(sph(0.03, 5), '#1e1e1e', [0.15, 1.72, -0.45]), P(sph(0.07, 6), '#2a2420', [0, 1.58, -0.42]),
    P(sph(0.1, 6), fur, [-0.25, 1.95, 0]), P(sph(0.1, 6), fur, [0.25, 1.95, 0]),
    P(cone(0.58, 0.28, 10), '#d9c380', [0, 2.15, 0]), P(cyl(0.2, 0.25, 0.08, 10), '#bfa85a', [0, 2.3, 0]),                     // straw hat
    P(cyl(0.12, 0.14, 0.42, 8), '#f4efe4', [0.5, 0.95, -0.2]), P(box(0.18, 0.1, 0.03), '#8a2b2b', [0.5, 1.0, -0.33]),          // sake bottle
    P(box(0.28, 0.32, 0.03), '#f4efe4', [-0.5, 0.95, -0.25], [0, 0.2, 0]), P(box(0.2, 0.05, 0.04), '#3b2a1a', [-0.5, 1.0, -0.26], [0, 0.2, 0]),  // account ledger
    P(sph(0.16, 8), fur, [-0.28, 0.2, -0.32]), P(sph(0.16, 8), fur, [0.28, 0.2, -0.32]), P(cyl(0.6, 0.66, 0.1, 12), '#8d8a80', [0, 0.05, 0])], 'Shigaraki tanuki');
}
function gardenLantern(v) {
  const stone = HS('#a09c92', 0, 0, v * 0.03);
  const parts = [P(cyl(0.3, 0.36, 0.2, 8), stone, [0, 0.1, 0]), P(cyl(0.1, 0.13, 1.1, 8), stone, [0, 0.75, 0]), P(cyl(0.34, 0.2, 0.12, 8), stone, [0, 1.36, 0]),
    P(cyl(0.28, 0.28, 0.42, 6), stone, [0, 1.63, 0]), P(cyl(0.5, 0.2, 0.3, 6), HS(stone, 0, 0, -0.06), [0, 2.0, 0]), P(sph(0.08, 7), stone, [0, 2.2, 0])];
  for (let i = 0; i < 6; i++) parts.push(P(box(0.12, 0.2, 0.03), '#2a2420', [Math.sin(i * Math.PI / 3) * 0.26, 1.63, Math.cos(i * Math.PI / 3) * 0.26], [0, i * Math.PI / 3, 0]));
  parts.push(P(sph(0.34, 7), HS('#4f8a3a', v * 0.05, 0, 0), [-0.45, 0.25, 0.2], [0, 0, 0], [1.3, 0.7, 1.1]));   // trimmed shrub
  return V(parts, 'garden lantern', [P(sph(0.1, 6), [2.4, 1.4, 0.6], [0, 1.63, 0])]);
}
function crossingGate(v) {
  const parts = [P(box(0.3, 1.9, 0.3), '#8e959c', [-1.3, 0.95, 0]), P(box(0.5, 0.1, 0.5), '#3a3a3a', [-1.3, 0.05, 0]), P(box(0.34, 0.18, 0.34), '#2a2a2a', [-1.3, 1.5, 0]),
    P(box(0.3, 0.4, 0.2), '#f2c230', [-1.3, 2.2, 0]), P(cyl(0.06, 0.06, 0.2, 8), '#e3342f', [-1.3, 2.25, -0.15], [HPI, 0, 0])];
  for (let i = 0; i < 6; i++) parts.push(P(box(0.45, 0.11, 0.11), i % 2 ? '#1e1e1e' : HS('#f2c230', 0, 0, v * 0.02), [-1.05 + i * 0.45 + 0.225, 1.2, 0]));
  parts.push(P(box(2.7, 0.03, 0.03), '#8e959c', [0.1, 1.28, 0]), P(box(0.16, 0.16, 0.16), '#e3342f', [1.4, 1.2, 0]), P(box(0.5, 0.2, 0.02), '#f4efe4', [0.4, 1.05, 0]), P(box(0.3, 0.04, 0.03), '#1e1e1e', [0.4, 1.05, 0]));
  return V(parts, 'level-crossing gate arm', [P(sph(0.07, 6), [3.0, 0.4, 0.3], [-1.3, 2.25, -0.26]), P(sph(0.06, 5), [3.0, 0.4, 0.3], [1.4, 1.2, -0.1])]);
}
function laundryPole(v) {
  const parts = [P(cyl(0.05, 0.06, 1.6, 6), '#9aa3ab', [-1.3, 0.8, 0]), P(cyl(0.05, 0.06, 1.6, 6), '#9aa3ab', [1.3, 0.8, 0]), P(box(0.14, 0.1, 0.1), '#9aa3ab', [-1.3, 1.55, 0]), P(box(0.14, 0.1, 0.1), '#9aa3ab', [1.3, 1.55, 0]),
    P(cyl(0.03, 0.03, 2.7, 6), '#c9d0d6', [0, 1.55, 0], [0, 0, HPI])];
  const futons = [['#6b8fd6', '#f4efe4'], ['#e8a1b5', '#f4efe4'], ['#f4efe4', '#8fd36b'], ['#d6c56b', '#f4efe4']];
  for (let i = 0; i < 3; i++) { const [a, b] = futons[(i + v) % 4]; parts.push(P(box(0.75, 0.42, 0.12), a, [-0.85 + i * 0.85, 1.3, 0]), P(box(0.65, 0.12, 0.13), b, [-0.85 + i * 0.85, 1.45, 0]), P(box(0.75, 0.1, 0.04), '#f4efe4', [-0.85 + i * 0.85, 1.55, 0.06])); }
  for (let i = 0; i < 4; i++) parts.push(P(box(0.05, 0.08, 0.06), '#3a5fa8', [-1.1 + i * 0.75 - 0.15, 1.57, 0]));   // pegs
  return V(parts, 'laundry pole with futons');
}
function inariTorii(v) {
  const red = HS('#e0452a', 0, 0, v * 0.03), black = '#2b2422';
  return V([P(cyl(0.08, 0.1, 1.28, 8), red, [-1.05, 0.64, 0]), P(cyl(0.08, 0.1, 1.28, 8), red, [1.05, 0.64, 0]), P(box(2.5, 0.12, 0.16), black, [0, 1.33, 0], [0, 0, 0]),
    P(box(2.2, 0.1, 0.1), red, [0, 1.08, 0]), P(box(0.14, 0.2, 0.08), black, [0, 1.2, 0]), P(box(0.12, 0.7, 0.12), black, [-1.05, 0.35, 0]), P(box(0.12, 0.7, 0.12), black, [1.05, 0.35, 0]),
    P(box(0.24, 0.3, 0.22), '#a09c92', [-1.3, 0.15, -0.25]), P(box(0.24, 0.3, 0.22), '#a09c92', [1.3, 0.15, -0.25]), P(cone(0.05, 0.14, 4), '#a09c92', [-1.3, 0.37, -0.25]), P(cone(0.05, 0.14, 4), '#a09c92', [1.3, 0.37, -0.25]),
    P(box(0.06, 0.06, 0.02), '#e0452a', [-1.3, 0.32, -0.37]), P(box(0.06, 0.06, 0.02), '#e0452a', [1.3, 0.32, -0.37])], 'inari torii with fox guardians');
}
function gardenWall(v) {
  const wall = HS('#c9b99a', 0, 0, v * 0.03), parts = [P(box(2.0, 0.42, 0.24), wall, [0, 0.21, 0]), P(box(2.1, 0.08, 0.34), '#3a4a6a', [0, 0.46, 0])];
  for (let i = 0; i < 4; i++) parts.push(P(box(0.02, 0.32, 0.26), HS(wall, 0, 0, -0.12), [-0.75 + i * 0.5, 0.2, 0]));
  parts.push(P(sph(0.26, 7), HS('#4f8a3a', v * 0.04, 0, 0), [-0.55, 0.55, 0.05], [0, 0, 0], [1.4, 0.55, 1]), P(sph(0.22, 7), HS('#6aa040', 0, 0, 0), [0.45, 0.55, 0.05], [0, 0, 0], [1.4, 0.5, 1]));
  return V(parts, 'low garden wall');
}
function parkedBicycle(v) {
  const parts = bicycle(0.1, 0, 0, ['#c9302c', '#f4efe4', '#3a5fa8', '#e8a1b5'][v % 4], 0.35);
  parts.push(P(box(0.3, 0.02, 0.6), '#6a6a6a', [-0.2, 0.01, 0.2]));
  return V(parts, 'parked bicycle');
}
function flowerPlanter(v) {
  const parts = [P(box(1.7, 0.4, 0.55), HS('#7a6a5a', 0, 0, v * 0.03), [0, 0.2, 0]), P(box(1.6, 0.05, 0.45), '#3b2a1a', [0, 0.42, 0])];
  const petals = [['#ff6f8f', '#ffd23f'], ['#ffb347', '#c77dff'], ['#ff3c5a', '#f4efe4'], ['#7ac8ff', '#ffd23f']][v % 4];
  for (let i = 0; i < 7; i++) { const x = -0.7 + i * 0.23, z = (i % 2 ? 0.14 : -0.12); parts.push(P(cyl(0.015, 0.015, 0.2, 4), '#4f8a3a', [x, 0.52, z]), P(sph(0.06, 6), petals[i % 2], [x, 0.62, z])); }
  parts.push(P(sph(0.3, 7), '#4f8a3a', [0, 0.45, 0], [0, 0, 0], [2.6, 0.35, 1.2]));
  return V(parts, 'flower planter');
}
function gapSuburb() {
  const parts = [...pit(), P(box(2.4, 0.06, 3.3), '#7a7a7a', [0, 0.03, 0]), P(box(2.1, 0.02, 3.0), '#0b0b10', [0, 0.065, 0])];
  for (let i = 0; i < 8; i++) parts.push(P(box(2.1, 0.06, 0.08), '#5a5a5a', [0, 0.07, -1.4 + i * 0.4]));   // storm-drain grate bars
  parts.push(P(box(0.08, 0.06, 3.0), '#5a5a5a', [-0.7, 0.07, 0]), P(box(0.08, 0.06, 3.0), '#5a5a5a', [0.7, 0.07, 0]), P(box(0.6, 0.02, 0.4), '#4a6a8a', [0.9, 0.04, 1.2]));
  return V(parts, 'storm drain');
}
function keiCar(v) {
  const body = v ? '#f4efe4' : '#f6c9d6', parts = [P(box(3.9, 0.7, 1.5), body, [0, 0.65, 0]), P(box(2.8, 0.7, 1.4), body, [0.1, 1.3, 0]), P(box(2.7, 0.55, 1.42), '#bfe8ff', [0.1, 1.32, 0]),
    P(box(0.9, 0.55, 0.1), body, [0.1, 1.32, 0]), P(box(0.5, 0.55, 1.44), body, [0.1, 1.32, 0]), P(box(2.9, 0.1, 1.5), body, [0.1, 1.68, 0]), P(box(4.0, 0.2, 1.4), '#3a3a3a', [0, 0.3, 0])];
  for (const x of [-1.3, 1.3]) for (const z of [-0.72, 0.72]) parts.push(P(cyl(0.3, 0.3, 0.22, 12), '#1e1e1e', [x, 0.3, z], [HPI, 0, 0]), P(cyl(0.15, 0.15, 0.24, 8), '#c9c9c9', [x, 0.3, z], [HPI, 0, 0]));
  parts.push(P(box(0.1, 0.16, 0.5), '#f6d35a', [1.98, 0.75, -0.4]), P(box(0.1, 0.16, 0.5), '#f6d35a', [1.98, 0.75, 0.4]), P(box(0.1, 0.12, 0.5), '#e3342f', [-1.98, 0.75, -0.4]), P(box(0.1, 0.12, 0.5), '#e3342f', [-1.98, 0.75, 0.4]),
    P(box(0.14, 0.12, 0.2), '#3a3a3a', [0.9, 1.15, -0.82]), P(box(0.14, 0.12, 0.2), '#3a3a3a', [0.9, 1.15, 0.82]), P(box(0.5, 0.04, 0.6), '#4f8a3a', [-0.3, 1.75, 0]), ...trafficCone(-2.15, -0.9), ...trafficCone(2.15, -0.9));
  return V(parts, 'parked kei car');
}
function shiba() {
  const fur = '#e8a24a', cream = '#fff3e0', parts = [P(sph(0.26, 9), fur, [0, 0.55, 0], [0, 0, 0], [1.9, 1, 1]), P(sph(0.2, 8), cream, [0, 0.46, 0], [0, 0, 0], [1.9, 0.8, 0.9]),
    P(sph(0.2, 9), fur, [0.5, 0.72, 0]), P(box(0.18, 0.12, 0.14), cream, [0.66, 0.66, 0]), P(sph(0.04, 5), '#1e1e1e', [0.76, 0.68, 0]),
    P(cone(0.07, 0.14, 4), fur, [0.45, 0.92, -0.1]), P(cone(0.07, 0.14, 4), fur, [0.45, 0.92, 0.1]), P(sph(0.03, 5), '#1e1e1e', [0.62, 0.78, -0.09]), P(sph(0.03, 5), '#1e1e1e', [0.62, 0.78, 0.09]),
    P(tor(0.14, 0.06, 6, 10), fur, [-0.5, 0.78, 0], [0, HPI, 0]), P(box(0.36, 0.06, 0.06), '#c9302c', [0.42, 0.62, 0], [0, 0, 0]), P(box(0.06, 0.04, 0.2), '#f6d35a', [0.5, 0.48, 0]),
    P(box(0.06, 0.05, 0.05), '#f4efe4', [0.52, 0.48, 0])];
  for (const [x, z, a] of [[0.28, -0.13, 0.6], [0.28, 0.13, -0.5], [-0.3, -0.13, -0.6], [-0.3, 0.13, 0.5]]) parts.push(P(cyl(0.05, 0.045, 0.4, 6), fur, [x + a * 0.15, 0.3, z], [0, 0, a]), P(sph(0.06, 5), cream, [x + a * 0.32, 0.12, z]));
  return V(parts, 'Shiba running across');
}

// ============================================================================
// COAST — cliff road, harbour
// ============================================================================
function bollard(v) {
  const iron = HS('#3e4448', 0, 0, v * 0.02), parts = [P(cyl(0.3, 0.36, 1.7, 10), iron, [0, 0.85, 0]), P(sph(0.36, 10), iron, [0, 1.75, 0], [0, 0, 0], [1, 0.65, 1]), P(cyl(0.44, 0.48, 0.18, 10), '#8d8a80', [0, 0.09, 0]),
    P(cyl(0.16, 0.16, 0.5, 8), iron, [0, 2.2, 0]), P(sph(0.2, 8), '#e3342f', [0, 2.45, 0])];
  for (let i = 0; i < 4; i++) parts.push(P(tor(0.36, 0.04, 5, 12), '#d9c79a', [0, 1.0 + i * 0.13, 0], [HPI, 0, 0]));
  parts.push(...rope([0.35, 1.05, 0], [0.9, 0.05, 0.4], 0.035, '#d9c79a', 0.05, 3), P(cyl(0.12, 0.12, 0.08, 8), '#d9c79a', [0.9, 0.04, 0.4]), P(sph(0.06, 6), '#f4efe4', [-0.3, 0.55, -0.2], [0, 0, 0], [1, 0.6, 1]));
  return V(parts, 'mooring bollard with rope');
}
function crabPots(v) {
  const parts = [], wire = HS('#6a7a6a', 0, 0, v * 0.03);
  const pot = (x, y, z, ry) => { parts.push(P(cyl(0.42, 0.42, 0.5, 10), wire, [x, y, z], [0, ry, 0]), P(tor(0.42, 0.025, 4, 12), '#2a2a2a', [x, y + 0.25, z], [HPI, 0, 0]), P(tor(0.42, 0.025, 4, 12), '#2a2a2a', [x, y - 0.25, z], [HPI, 0, 0]), P(box(0.3, 0.05, 0.2), '#e07a2a', [x + 0.2, y + 0.28, z], [0, ry, 0])); };
  pot(0, 0.25, 0, 0); pot(0.05, 0.75, 0.05, 0.4); pot(-0.05, 1.25, -0.02, 0.9); pot(0.03, 1.75, 0.03, 0.2);
  parts.push(P(sph(0.14, 7), '#e3342f', [0.35, 2.12, -0.15]), P(sph(0.12, 7), '#f4efe4', [-0.3, 2.08, 0.12]), ...rope([0.35, 2.05, -0.15], [-0.3, 2.0, 0.12], 0.02, '#d9c79a', 0.05, 3));
  return V(parts, 'stacked crab pots');
}
function lighthousePost(v) {
  const parts = [P(cyl(0.34, 0.4, 0.2, 10), '#8d8a80', [0, 0.1, 0])];
  for (let i = 0; i < 6; i++) parts.push(P(cyl(0.18 - i * 0.008, 0.19 - i * 0.008, 0.32, 10), i % 2 ? HS('#e3342f', 0, 0, v * 0.03) : '#f4efe4', [0, 0.36 + i * 0.32, 0]));
  parts.push(P(cyl(0.22, 0.22, 0.06, 10), '#2a2a2a', [0, 2.3, 0]), P(cyl(0.14, 0.14, 0.24, 8), '#dfe9ff', [0, 2.45, 0]), P(cone(0.24, 0.18, 10), '#e3342f', [0, 2.66, 0]), P(box(0.6, 0.05, 0.05), '#2a2a2a', [0, 2.3, 0]));
  return V(parts, 'lighthouse-striped post', [P(cyl(0.11, 0.11, 0.2, 8), [1.8, 1.8, 2.4], [0, 2.45, 0])]);
}
function fishRack(v) {
  const wood = HS('#8b6a3a', 0, 0, v * 0.03), parts = [P(box(0.1, 2.2, 0.1), wood, [-0.55, 1.1, 0]), P(box(0.1, 2.2, 0.1), wood, [0.55, 1.1, 0]), P(box(1.3, 0.06, 0.06), wood, [0, 2.15, 0]), P(box(1.3, 0.06, 0.06), wood, [0, 1.35, 0]),
    P(box(1.3, 0.06, 0.06), wood, [0, 0.6, 0]), P(box(0.3, 0.12, 0.3), '#8d8a80', [-0.55, 0.06, 0]), P(box(0.3, 0.12, 0.3), '#8d8a80', [0.55, 0.06, 0])];
  for (let i = 0; i < 4; i++) for (const y of [2.15, 1.35]) parts.push(P(sph(0.09, 6), '#a9b6c0', [-0.42 + i * 0.28, y - 0.28, 0.02], [0, 0, 0], [1, 2.6, 0.5]), P(cone(0.06, 0.12, 4), '#a9b6c0', [-0.42 + i * 0.28, y - 0.56, 0.02], [Math.PI, 0, 0]));
  parts.push(P(box(0.9, 0.04, 0.5), '#f4efe4', [0, 0.62, 0]), P(sph(0.16, 6), '#d9c79a', [0.1, 0.7, 0], [0, 0, 0], [3, 0.4, 1.5]));   // squid drying on a tray
  return V(parts, 'dried-fish drying rack');
}
function netDrape(v) {
  const net = HS('#4b6a5a', v * 0.03, 0, 0), parts = [P(cyl(0.07, 0.09, 1.7, 7), '#6b4b32', [-1.15, 0.85, 0]), P(cyl(0.07, 0.09, 1.7, 7), '#6b4b32', [1.15, 0.85, 0]), P(cyl(0.035, 0.035, 2.4, 6), '#d9c79a', [0, 1.65, 0], [0, 0, HPI])];
  for (let i = 0; i < 6; i++) parts.push(...rope([-1.15, 1.6, 0], [1.15, 1.6, 0], 0.012, net, 0.35 + i * 0.05, 6).map((g, k) => g.translate(0, -i * 0.05, (k % 2 ? 0.03 : -0.03) * (i % 2 ? 1 : -1))));
  for (let i = 0; i < 4; i++) parts.push(...rope([-0.9 + i * 0.6, 1.62, 0], [-0.9 + i * 0.6, 1.1, 0], 0.012, net, 0.0, 2));
  for (let i = 0; i < 3; i++) parts.push(P(sph(0.09, 7), i ? '#e3342f' : '#f4efe4', [-0.6 + i * 0.6, 1.16 + (i === 1 ? -0.06 : 0), 0.05]));   // floats
  return V(parts, 'fishing-net drape');
}
function driftwoodBeam(v) {
  const wood = HS('#b8a888', 0, 0, v * 0.03), parts = [P(dode(0.4), '#6e7264', [-1.15, 0.35, 0], [0, 0.4, 0], [1.1, 1.0, 1.1]), P(dode(0.5), '#6e7264', [-1.2, 0.95, 0.05], [0, 1.1, 0], [1.0, 1.0, 0.9]),
    P(dode(0.45), '#7a7e72', [1.2, 0.4, 0], [0, 0.7, 0], [1.1, 0.9, 1.1]), P(dode(0.42), '#6e7264', [1.15, 1.0, -0.05], [0, 0.2, 0]),
    P(cyl(0.12, 0.16, 2.9, 8), wood, [0, 1.35, 0], [0, 0, HPI + 0.04]), seg([-0.7, 1.4, 0], [-0.3, 1.9, -0.2], 0.05, wood), seg([0.6, 1.33, 0], [1.0, 1.65, 0.2], 0.045, wood)];
  parts.push(...rope([-0.2, 1.25, 0], [-0.2, 1.05, 0], 0.015, '#d9c79a', 0, 1), P(sph(0.08, 6), '#e3342f', [-0.2, 0.98, 0]), P(sph(0.05, 5), '#f4efe4', [0.3, 1.3, -0.1]));
  return V(parts, 'driftwood beam');
}
function floatLine(v) {
  const parts = [P(cyl(0.08, 0.1, 1.55, 7), '#6b4b32', [-1.1, 0.77, 0]), P(cyl(0.08, 0.1, 1.55, 7), '#6b4b32', [1.1, 0.77, 0]), ...rope([-1.1, 1.52, 0], [1.1, 1.52, 0], 0.03, '#d9c79a', 0.3, 7)];
  const cols = ['#e3342f', '#f6d35a', '#f4efe4', '#3fa0d0'];
  for (let i = 0; i < 5; i++) { const t = (i + 0.5) / 5, x = -1.1 + 2.2 * t, y = 1.52 - 0.3 * 4 * t * (1 - t); parts.push(P(sph(0.12, 7), cols[(i + v) % 4], [x, y - 0.14, 0], [0, 0, 0], [1, 1.25, 1])); }
  for (let i = 0; i < 4; i++) parts.push(P(box(0.1, 0.16, 0.01), '#f4efe4', [-0.88 + i * 0.6, 1.4, 0.05], [0, 0, 0.3]));   // small pennants
  return V(parts, 'float line with pennants');
}
function tidePoolRocks(v) {
  const rock = HS('#5a6266', 0, 0, v * 0.03);
  return V([P(dode(0.5), rock, [-0.5, 0.2, 0], [0, v, 0], [1.3, 0.55, 1.1]), P(dode(0.42), HS(rock, 0, 0, 0.05), [0.55, 0.22, 0.1], [0, 0.6, 0], [1.2, 0.6, 1]), P(dode(0.3), rock, [0.05, 0.3, -0.3], [0, 1.3, 0], [1, 0.7, 1]),
    P(cyl(0.7, 0.7, 0.03, 12), '#3fa0b0', [0, 0.05, 0.1], [0, 0, 0], [1.4, 1, 1]), P(sph(0.06, 6), '#e07a2a', [0.3, 0.12, 0.15]), P(sph(0.05, 6), '#a04a8a', [-0.2, 0.1, 0.3]),
    P(sph(0.3, 6), '#4b6a5a', [-0.7, 0.28, 0.2], [0, 0, 0], [1, 0.4, 1])], 'tide-pool rocks');
}
function ropeCoil(v) {
  const parts = [], c = HS('#d9c79a', 0, 0, v * 0.03);
  for (let i = 0; i < 4; i++) parts.push(P(tor(0.42 - i * 0.03, 0.06, 6, 16), i % 2 ? c : HS(c, 0, 0, -0.06), [0, 0.07 + i * 0.12, 0], [HPI, 0, 0]));
  parts.push(...rope([0.42, 0.45, 0], [0.9, 0.06, 0.3], 0.05, c, 0.05, 3), P(sph(0.08, 6), '#e3342f', [0.95, 0.07, 0.35]));
  return V(parts, 'rope coil');
}
function beachedBuoy(v) {
  const c = v % 2 ? '#e3342f' : '#f6a623';
  return V([P(sph(0.42, 12), c, [0, 0.42, 0], [0, 0, 0], [1, 1.1, 1]), P(cyl(0.42, 0.42, 0.12, 12), '#f4efe4', [0, 0.42, 0]), P(cyl(0.06, 0.06, 0.4, 8), '#2a2a2a', [0, 0.95, 0]), P(sph(0.09, 6), '#2a2a2a', [0, 1.15, 0]),
    P(tor(0.1, 0.02, 4, 10), '#2a2a2a', [0.4, 0.2, 0], [0, 0, HPI]), P(box(0.3, 0.06, 0.02), '#f4efe4', [0, 0.6, -0.42]), P(sph(0.5, 6), '#c9b98a', [0.2, 0.0, 0.1], [0, 0, 0], [1.6, 0.15, 1.3])], 'beached buoy');
}
function gapCoast() {
  const parts = [...pit(2.1, 3), P(box(2.5, 0.04, 3.3), '#c9b98a', [0, 0.02, 0])];
  for (let i = 0; i < 8; i++) parts.push(P(sph(0.16, 6), '#eaf6f8', [(i % 2 ? 1 : -1) * (1.05 + (i % 3) * 0.1), 0.03, -1.4 + i * 0.4], [0, 0, 0], [1.6, 0.4, 1.2]));   // sea foam at the lip
  parts.push(P(box(0.8, 0.06, 0.4), '#5a5a5a', [-0.5, 0.03, -1.55], [0, 0.4, 0]), P(box(0.6, 0.06, 0.5), '#5a5a5a', [0.6, 0.02, 1.55], [0, -0.3, 0]), P(box(2.1, 0.05, 2.9), '#2a5a70', [0, -0.58, 0]));
  return V(parts, 'washed-out road');
}
function overturnedBoat(v) {
  const hull = v ? '#2f5a7a' : '#f4efe4', stripe = v ? '#f4efe4' : '#c9302c';
  const parts = [P(cyl(0.9, 0.55, 4.0, 12), hull, [0, 0.9, 0], [0, 0, HPI], [1, 1, 0.72]), P(cyl(0.95, 0.95, 0.06, 12), '#6b4b32', [0, 0.9, 0], [0, 0, HPI], [1, 1, 0.72]),
    P(box(4.0, 0.16, 1.3), stripe, [0, 0.9, 0]), P(box(3.4, 0.1, 0.16), '#6b4b32', [0, 1.75, 0]), P(cone(0.6, 0.8, 8), hull, [2.15, 0.6, 0], [0, 0, -HPI], [1, 1, 0.75])];
  parts.push(P(box(0.34, 0.5, 1.3), '#6b4b32', [-2.0, 0.3, 0]), P(box(0.5, 0.06, 0.06), '#f4efe4', [-2.05, 0.55, 0]), P(sph(0.18, 7), '#f6a623', [-1.7, 0.18, -0.85]),
    P(cyl(0.05, 0.05, 1.8, 6), '#c9b98a', [0.3, 0.05, -0.9], [0, 0.4, HPI]), ...rope([1.4, 0.05, -0.8], [2.2, 0.05, -1.05], 0.03, '#d9c79a', 0.0, 2));
  return V(parts, 'overturned fishing boat');
}
function rollingBuoy() {
  return V([P(sph(0.52, 12), '#f6a623', [0, 0.55, 0]), P(tor(0.52, 0.05, 5, 16), '#f4efe4', [0, 0.55, 0], [0, 0, HPI]), P(tor(0.52, 0.05, 5, 16), '#e3342f', [0, 0.55, 0], [HPI, 0, 0]),
    P(cyl(0.06, 0.06, 0.4, 8), '#2a2a2a', [0.65, 0.55, 0], [0, 0, HPI]), P(sph(0.1, 6), '#2a2a2a', [0.9, 0.55, 0]), P(tor(0.08, 0.02, 4, 10), '#2a2a2a', [-0.58, 0.55, 0], [0, HPI, 0])], 'rolling buoy');
}

// ============================================================================
// catalogue
// ============================================================================
/** [biome][type] -> variants { geo, mat, name, glow? }. Filled by buildObstacles(). */
export const OBSTACLES = { mountain: {}, city: {}, suburb: {}, coast: {} };
let built = false;
export function buildObstacles() {
  if (built) return OBSTACLES;
  built = true;
  OBSTACLES.mountain = {
    stalk: [stoneLantern(0), bambooCluster(1), jizo(2), cedarStump(3)],
    arch: [toriiSmall(0), shimenawaGate(1), emaBranch(2)],
    drusen: [mossBoulder(0), fallenLog(1), saisenBox(2)],
    gap: [gapMountain()], wide: [fallenCedar(0), fallenCedar(1)], roller: [sakeBarrel()],
  };
  OBSTACLES.city = {
    stalk: [vendingMachine('#d23b3b'), vendingMachine('#2f6fbf'), pachinkoPillar(2), manekiNeko(3)],
    arch: [noren(0), shopAwning(1), kanjiBanner(2)],
    drusen: [constructionBarrier(0), bikeRack(1), cardboardStack(2)],
    gap: [gapCity()], wide: [truckTail(0), truckTail(1)], roller: [salaryman()],
  };
  OBSTACLES.suburb = {
    stalk: [utilityPole(0), postbox(1), shigarakiTanuki(2), gardenLantern(3)],
    arch: [crossingGate(0), laundryPole(1), inariTorii(2)],
    drusen: [gardenWall(0), parkedBicycle(1), flowerPlanter(2)],
    gap: [gapSuburb()], wide: [keiCar(0), keiCar(1)], roller: [shiba()],
  };
  OBSTACLES.coast = {
    stalk: [bollard(0), crabPots(1), lighthousePost(2), fishRack(3)],
    arch: [netDrape(0), driftwoodBeam(1), floatLine(2)],
    drusen: [tidePoolRocks(0), ropeCoil(1), beachedBuoy(2)],
    gap: [gapCoast()], wide: [overturnedBoat(0), overturnedBoat(1)], roller: [rollingBuoy()],
  };
  return OBSTACLES;
}
/** Spare props not in the sim's 4-variant rotation (the taxi-stand pole); scenery may pool them. */
export function buildSpares() { return { taxiPole: taxiPole(0) }; }

// ============================================================================
// power pickups — ~0.9 m tall icons, centred on x/z, y from 0
// ============================================================================
export function buildPowers() {
  // shield: an omamori charm pouch with its braided cord and knot
  const shield = merge([P(box(0.42, 0.62, 0.12), '#c9302c', [0, 0.36, 0]), P(box(0.42, 0.12, 0.13), '#e9c46a', [0, 0.62, 0]), P(box(0.36, 0.08, 0.14), '#e9c46a', [0, 0.18, 0]),
    P(box(0.2, 0.3, 0.14), '#f4efe4', [0, 0.38, 0]), P(box(0.05, 0.18, 0.15), '#c9302c', [0, 0.38, 0]), P(box(0.12, 0.04, 0.15), '#c9302c', [0, 0.32, 0]),
    ...rope([-0.1, 0.68, 0], [0, 0.88, 0], 0.02, '#f2c230', 0, 2), ...rope([0.1, 0.68, 0], [0, 0.88, 0], 0.02, '#f2c230', 0, 2), P(tor(0.05, 0.02, 4, 10), '#f2c230', [0, 0.86, 0]),
    P(sph(0.045, 6), '#f2c230', [-0.06, 0.73, 0]), P(sph(0.045, 6), '#f2c230', [0.06, 0.73, 0])]);
  // magnet: a blue kitsunebi (fox-fire) flame — GLOW so it blooms
  const magnet = merge([P(sph(0.22, 10), [0.3, 1.2, 2.6], [0, 0.32, 0], [0, 0, 0], [1, 1.15, 1]), P(cone(0.2, 0.5, 10), [0.4, 1.4, 2.8], [0, 0.66, 0]), P(cone(0.08, 0.28, 7), [1.4, 2.2, 3.0], [0.14, 0.72, 0], [0, 0, -0.5]),
    P(cone(0.07, 0.22, 7), [1.4, 2.2, 3.0], [-0.13, 0.66, 0], [0, 0, 0.55]), P(sph(0.1, 8), [2.0, 2.6, 3.2], [0, 0.34, -0.12]), P(sph(0.06, 6), [0.6, 1.6, 3.0], [0.26, 0.15, 0.05]), P(sph(0.045, 6), [0.6, 1.6, 3.0], [-0.24, 0.2, -0.05])]);
  // dash: a pair of geta sandals with wind lines
  const geta = (x, c) => [P(box(0.22, 0.05, 0.5), c, [x, 0.06, 0]), P(box(0.2, 0.06, 0.04), HS(c, 0, 0, -0.1), [x, 0.015, -0.14]), P(box(0.2, 0.06, 0.04), HS(c, 0, 0, -0.1), [x, 0.015, 0.14]),
    seg([x, 0.08, 0.14], [x - 0.08, 0.08, -0.1], 0.012, '#c9302c', 4), seg([x, 0.08, 0.14], [x + 0.08, 0.08, -0.1], 0.012, '#c9302c', 4)];
  const dash = merge([...geta(-0.16, '#c9a978'), ...geta(0.16, '#b8925a'), P(tor(0.28, 0.02, 4, 12), '#eaf6f8', [0, 0.45, 0], [HPI, 0, 0.2]).scale(1, 1.2, 1), P(tor(0.22, 0.018, 4, 12), '#eaf6f8', [0.05, 0.68, 0.1], [HPI, 0.2, 0]),
    P(box(0.5, 0.02, 0.02), '#eaf6f8', [-0.35, 0.3, 0.2]), P(box(0.36, 0.02, 0.02), '#eaf6f8', [-0.4, 0.2, -0.15]), P(box(0.28, 0.02, 0.02), '#eaf6f8', [-0.45, 0.4, 0.0]), P(sph(0.05, 6), '#eaf6f8', [0, 0.86, 0])]);
  // x2: a daruma (one eye painted)
  const x2 = merge([P(sph(0.36, 12), '#d8342c', [0, 0.42, 0], [0, 0, 0], [1, 1.2, 1]), P(sph(0.26, 10), '#f7f2ea', [0, 0.5, -0.22], [0, 0, 0], [1, 1.1, 0.5]), P(sph(0.06, 6), '#1e1e1e', [-0.09, 0.56, -0.33]),
    P(tor(0.055, 0.015, 4, 10), '#1e1e1e', [0.09, 0.56, -0.33]), P(box(0.05, 0.06, 0.02), '#1e1e1e', [-0.12, 0.66, -0.34], [0, 0, -0.4]), P(box(0.05, 0.06, 0.02), '#1e1e1e', [0.12, 0.66, -0.34], [0, 0, 0.4]),
    P(box(0.18, 0.05, 0.02), '#1e1e1e', [0, 0.42, -0.35]), P(box(0.3, 0.14, 0.02), '#f2c230', [0, 0.16, -0.32]), P(box(0.08, 0.1, 0.03), '#1e1e1e', [0, 0.16, -0.33]), P(sph(0.16, 8), '#d8342c', [0, 0.82, 0], [0, 0, 0], [1, 0.5, 1])]);
  // heal: a sakura branch in bloom
  const branch = [seg([-0.3, 0.05, 0], [0.25, 0.75, 0], 0.03, '#5a4030'), seg([0, 0.4, 0], [-0.2, 0.7, 0.05], 0.02, '#5a4030'), seg([0.15, 0.6, 0], [0.4, 0.55, -0.05], 0.018, '#5a4030')];
  const bloom = (x, y, z, c = '#ffb7c5') => { const out = [P(sph(0.045, 6), '#f2c230', [x, y, z])]; for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; out.push(P(sph(0.055, 6), c, [x + Math.cos(a) * 0.07, y + Math.sin(a) * 0.07, z], [0, 0, 0], [1, 1, 0.5])); } return out; };
  const heal = merge([...branch, ...bloom(-0.22, 0.78, 0.05), ...bloom(0.1, 0.5, -0.05, '#ffc9d6'), ...bloom(0.28, 0.82, 0), ...bloom(0.42, 0.58, -0.06, '#ff9fb4'), ...bloom(-0.05, 0.3, 0.06),
    P(sph(0.05, 6), '#ffb7c5', [-0.34, 0.22, -0.1], [0, 0, 0], [1, 1, 0.4]), P(sph(0.04, 6), '#ffd6df', [0.25, 0.28, 0.12], [0, 0, 0], [1, 1, 0.4]), P(box(0.12, 0.04, 0.01), '#7fae4a', [0.05, 0.42, 0.02], [0, 0, 0.6])]);
  // jetpack: tengu wings around a twin-rocket pack with flame cones
  const wing = (dir) => [P(box(0.5, 0.1, 0.06), '#2b1d1a', [dir * 0.42, 0.62, 0], [0, 0, dir * 0.35]), P(box(0.36, 0.09, 0.06), '#3d2a24', [dir * 0.6, 0.48, 0.01], [0, 0, dir * 0.2]),
    P(box(0.28, 0.08, 0.06), '#2b1d1a', [dir * 0.66, 0.34, 0.02], [0, 0, dir * 0.05]), P(box(0.2, 0.06, 0.05), '#c9302c', [dir * 0.3, 0.7, 0.03], [0, 0, dir * 0.5])];
  const jetpack = merge([P(cyl(0.11, 0.11, 0.5, 8), '#b8b8c0', [-0.13, 0.42, 0]), P(cyl(0.11, 0.11, 0.5, 8), '#b8b8c0', [0.13, 0.42, 0]), P(sph(0.11, 8), '#d8342c', [-0.13, 0.67, 0]), P(sph(0.11, 8), '#d8342c', [0.13, 0.67, 0]),
    P(box(0.34, 0.2, 0.08), '#8a3a20', [0, 0.4, 0.08]), P(cone(0.09, 0.26, 7), [2.6, 1.2, 0.2], [-0.13, 0.05, 0], [Math.PI, 0, 0]), P(cone(0.09, 0.26, 7), [2.6, 1.2, 0.2], [0.13, 0.05, 0], [Math.PI, 0, 0]),
    P(cone(0.05, 0.16, 6), [3.0, 2.4, 0.8], [-0.13, 0.1, 0], [Math.PI, 0, 0]), P(cone(0.05, 0.16, 6), [3.0, 2.4, 0.8], [0.13, 0.1, 0], [Math.PI, 0, 0]), ...wing(-1), ...wing(1)]);
  // thunder: Raijin's drum ring — a zigzag lightning bolt inside a ring of small taiko drums
  const bolt = [P(box(0.26, 0.09, 0.08), [2.4, 2.2, 3.2], [-0.05, 0.72, 0], [0, 0, -0.6]), P(box(0.3, 0.09, 0.08), [2.4, 2.2, 3.2], [0.06, 0.52, 0], [0, 0, 0.7]),
    P(box(0.3, 0.09, 0.08), [2.4, 2.2, 3.2], [-0.05, 0.32, 0], [0, 0, -0.6]), P(cone(0.08, 0.2, 4), [2.8, 2.6, 3.4], [0.06, 0.1, 0], [Math.PI, 0, 0])];
  const drums = []; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; drums.push(P(cyl(0.07, 0.07, 0.06, 8), '#d8342c', [Math.cos(a) * 0.46, 0.45 + Math.sin(a) * 0.46, 0], [HPI, 0, 0]), P(cyl(0.04, 0.04, 0.07, 6), '#f4efe4', [Math.cos(a) * 0.46, 0.45 + Math.sin(a) * 0.46, 0], [HPI, 0, 0])); }
  const thunder = merge([P(tor(0.46, 0.025, 4, 18), '#6a3a9a', [0, 0.45, 0]), ...drums, ...bolt]);
  // foxfire: a white fox mask wreathed in blue-green flames
  const foxfire = merge([P(cone(0.22, 0.34, 8), '#f7f2ea', [0, 0.36, 0], [-HPI, 0, 0]), P(sph(0.22, 10), '#f7f2ea', [0, 0.5, -0.05], [0, 0, 0], [1, 0.9, 0.8]),
    P(cone(0.08, 0.2, 5), '#f7f2ea', [-0.15, 0.7, -0.05], [0, 0, 0.25]), P(cone(0.08, 0.2, 5), '#f7f2ea', [0.15, 0.7, -0.05], [0, 0, -0.25]),
    P(box(0.07, 0.03, 0.02), '#c9302c', [-0.08, 0.52, 0.16], [0, 0, 0.5]), P(box(0.07, 0.03, 0.02), '#c9302c', [0.08, 0.52, 0.16], [0, 0, -0.5]), P(sph(0.03, 5), '#1e1e1e', [0, 0.36, 0.2]),
    P(cone(0.09, 0.3, 6), [0.4, 2.2, 2.6], [-0.3, 0.42, -0.05], [0, 0, 0.5]), P(cone(0.09, 0.3, 6), [0.4, 2.2, 2.6], [0.3, 0.42, -0.05], [0, 0, -0.5]),
    P(cone(0.1, 0.34, 6), [0.6, 2.4, 2.8], [-0.24, 0.72, -0.1], [0, 0, 0.3]), P(cone(0.1, 0.34, 6), [0.6, 2.4, 2.8], [0.24, 0.72, -0.1], [0, 0, -0.3]), P(cone(0.08, 0.28, 6), [0.8, 2.6, 3.0], [0, 0.82, -0.12])]);
  // dawn: a rising sun disc with rays over a small horizon bar
  const rays = []; for (let i = 0; i < 9; i++) { const a = Math.PI * (0.1 + 0.8 * i / 8); rays.push(P(box(0.3, 0.035, 0.03), [2.6, 2.0, 0.9], [Math.cos(a) * 0.42, 0.28 + Math.sin(a) * 0.42, 0], [0, 0, a])); }
  const dawn = merge([P(cyl(0.26, 0.26, 0.06, 20), [2.8, 1.6, 0.5], [0, 0.32, 0], [HPI, 0, 0]), P(cyl(0.16, 0.16, 0.07, 16), [3.0, 2.4, 1.2], [0, 0.32, 0], [HPI, 0, 0]), ...rays,
    P(box(0.9, 0.05, 0.06), '#2b1d1a', [0, 0.08, 0]), P(box(0.7, 0.035, 0.06), '#5a4030', [0, 0.02, 0])]);
  // susanoo: a katana held point-up, lightning sparking off the blade
  const susanoo = merge([P(box(0.07, 0.62, 0.02), '#e8ecf4', [0, 0.6, 0]), P(cone(0.035, 0.1, 4), '#e8ecf4', [0, 0.96, 0]), P(box(0.05, 0.6, 0.008), '#8ea0c0', [0.012, 0.6, 0.012]),
    P(cyl(0.09, 0.09, 0.03, 8), '#2f2f2f', [0, 0.28, 0]), P(box(0.05, 0.24, 0.05), '#1e1e2a', [0, 0.14, 0]), P(box(0.055, 0.03, 0.055), '#f2c230', [0, 0.02, 0]), P(box(0.055, 0.03, 0.055), '#f2c230', [0, 0.2, 0]),
    P(box(0.18, 0.04, 0.03), [2.2, 2.4, 3.2], [-0.2, 0.78, 0], [0, 0, -0.7]), P(box(0.16, 0.04, 0.03), [2.2, 2.4, 3.2], [-0.32, 0.64, 0], [0, 0, 0.7]), P(box(0.18, 0.04, 0.03), [2.2, 2.4, 3.2], [0.2, 0.5, 0], [0, 0, 0.7]), P(box(0.14, 0.04, 0.03), [2.2, 2.4, 3.2], [0.3, 0.38, 0], [0, 0, -0.6])]);
  // kagura: a suzu bell cluster on a red-corded handle
  const bells = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) { const y = 0.36 + i * 0.2, x = (j - (2 - i) / 2) * 0.22; bells.push(P(sph(0.09, 8), '#f2c230', [x, y, 0]), P(box(0.06, 0.03, 0.05), '#8a5a10', [x, y - 0.06, 0.05]), P(box(0.12, 0.02, 0.02), '#c9302c', [x, y + 0.09, 0])); }
  const kagura = merge([P(cyl(0.035, 0.04, 0.32, 7), '#5a4030', [0, 0.12, 0]), P(cyl(0.05, 0.05, 0.05, 8), '#f2c230', [0, 0.3, 0]), ...bells, P(box(0.04, 0.5, 0.02), '#c9302c', [-0.42, 0.35, 0], [0, 0, 0.2]), P(box(0.04, 0.5, 0.02), '#c9302c', [0.42, 0.35, 0], [0, 0, -0.2])]);
  // guide: yatagarasu, the three-legged crow, wings spread
  const guide = merge([P(sph(0.18, 10), '#151320', [0, 0.5, 0], [0, 0, 0], [1, 0.8, 1.3]), P(sph(0.11, 8), '#151320', [0, 0.66, 0.16]), P(cone(0.035, 0.12, 5), '#f2c230', [0, 0.66, 0.3], [HPI, 0, 0]),
    P(sph(0.025, 5), [3, 0.6, 0.2], [-0.05, 0.69, 0.24]), P(sph(0.025, 5), [3, 0.6, 0.2], [0.05, 0.69, 0.24]),
    P(box(0.5, 0.05, 0.22), '#1e1c2c', [-0.36, 0.58, -0.02], [0, 0, 0.4]), P(box(0.5, 0.05, 0.22), '#1e1c2c', [0.36, 0.58, -0.02], [0, 0, -0.4]), P(box(0.24, 0.04, 0.18), '#1e1c2c', [0, 0.46, -0.26], [0.3, 0, 0]),
    P(cyl(0.015, 0.015, 0.2, 5), '#f2c230', [-0.08, 0.3, 0.02]), P(cyl(0.015, 0.015, 0.2, 5), '#f2c230', [0, 0.3, 0.02]), P(cyl(0.015, 0.015, 0.2, 5), '#f2c230', [0.08, 0.3, 0.02]),
    P(box(0.08, 0.015, 0.015), '#f2c230', [-0.08, 0.2, 0.04]), P(box(0.08, 0.015, 0.015), '#f2c230', [0, 0.2, 0.04]), P(box(0.08, 0.015, 0.015), '#f2c230', [0.08, 0.2, 0.04])]);
  return {
    jetpack: { geo: jetpack, mat: PAINT, ring: new THREE.Color('#ff8a3c') },
    thunder: { geo: thunder, mat: PAINT, ring: new THREE.Color('#b48cff') },
    foxfire: { geo: foxfire, mat: PAINT, ring: new THREE.Color('#3fe0ff') },
    dawn: { geo: dawn, mat: PAINT, ring: new THREE.Color('#ffd23f') },
    susanoo: { geo: susanoo, mat: PAINT, ring: new THREE.Color('#dfe8ff') },
    kagura: { geo: kagura, mat: PAINT, ring: new THREE.Color('#ffc94a') },
    guide: { geo: guide, mat: PAINT, ring: new THREE.Color('#c58cff') },
    shield: { geo: shield, mat: PAINT, ring: new THREE.Color('#ffb347') },
    magnet: { geo: magnet, mat: GLOW, ring: new THREE.Color('#5a8cff') },
    dash: { geo: dash, mat: PAINT, ring: new THREE.Color('#eaf6f8') },
    x2: { geo: x2, mat: PAINT, ring: new THREE.Color('#ff5a3c') },
    heal: { geo: heal, mat: PAINT, ring: new THREE.Color('#ff9fb4') },
  };
}

// ============================================================================
// runner rigs — ~0.9 m tall, built from primitives, materials from matFactory
// ============================================================================
export function buildRig(kind, matFactory) {
  const g = new THREE.Group(); const mats = []; const M = (hex) => { const m = matFactory(hex); mats.push(m); return m; };
  const add = (parent, geo, m, p, r = [0, 0, 0], s = [1, 1, 1]) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(...p); mesh.rotation.set(...r); mesh.scale.set(...s); parent.add(mesh); return mesh; };
  const dark = M('#2b1d1a'), legs = [], ears = [];
  let body, head, tail;
  if (kind === 'tanuki') {
    const fur = M('#7a5a3e'), light = M('#d9c3a0'), mask = M('#2a1c14'), straw = M('#d9c380');
    body = add(g, new THREE.SphereGeometry(0.27, 12, 9), fur, [0, 0.5, 0], [0, 0, 0], [1, 1, 1.35]);
    add(g, new THREE.SphereGeometry(0.2, 10, 8), light, [0, 0.42, 0.05], [0, 0, 0], [1, 0.95, 1.5]);
    head = add(g, new THREE.SphereGeometry(0.21, 12, 10), fur, [0, 0.72, 0.36]);
    add(head, new THREE.SphereGeometry(0.09, 8, 6), light, [0, -0.06, 0.15], [0, 0, 0], [1.5, 1, 1]);         // muzzle
    add(head, new THREE.SphereGeometry(0.035, 6, 6), dark, [0, -0.04, 0.24]);
    add(head, new THREE.BoxGeometry(0.34, 0.09, 0.14), mask, [0, 0.04, 0.14]);                                  // eye mask
    add(head, new THREE.SphereGeometry(0.03, 6, 6), light, [-0.09, 0.05, 0.2]); add(head, new THREE.SphereGeometry(0.03, 6, 6), light, [0.09, 0.05, 0.2]);
    add(head, new THREE.SphereGeometry(0.016, 5, 5), dark, [-0.09, 0.05, 0.225]); add(head, new THREE.SphereGeometry(0.016, 5, 5), dark, [0.09, 0.05, 0.225]);
    ears.push(add(head, new THREE.SphereGeometry(0.06, 7, 6), fur, [-0.15, 0.16, -0.02]), add(head, new THREE.SphereGeometry(0.06, 7, 6), fur, [0.15, 0.16, -0.02]));
    add(head, new THREE.ConeGeometry(0.34, 0.14, 12), straw, [0, 0.22, -0.03], [0.2, 0, 0]); add(head, new THREE.CylinderGeometry(0.1, 0.13, 0.08, 10), straw, [0, 0.3, -0.04], [0.2, 0, 0]);   // straw hat
    tail = new THREE.Group(); tail.position.set(0, 0.52, -0.34); g.add(tail);
    const t = add(tail, new THREE.CapsuleGeometry(0.09, 0.26, 4, 8), fur, [0, 0.05, -0.16], [-1.1, 0, 0]);
    for (const y of [-0.08, 0.06]) add(t, new THREE.CylinderGeometry(0.095, 0.095, 0.05, 8), mask, [0, y, 0]);
    add(t, new THREE.SphereGeometry(0.075, 7, 6), mask, [0, 0.2, 0]);
    for (const [x, z] of [[-0.14, 0.2], [0.14, 0.2], [-0.14, -0.16], [0.14, -0.16]]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.36, z); g.add(pivot);
      add(pivot, new THREE.CylinderGeometry(0.05, 0.045, 0.34, 6), fur, [0, -0.17, 0]); add(pivot, new THREE.SphereGeometry(0.055, 6, 5), mask, [0, -0.34, 0.01]);
      legs.push(pivot);
    }
  } else {
    const orange = M('#e8792c'), cream = M('#fff3e0'), sock = M('#3a2418'), pink = M('#f4a3b5');
    body = add(g, new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), orange, [0, 0.44, 0], [HPI, 0, 0]);
    add(g, new THREE.CapsuleGeometry(0.14, 0.36, 4, 8), cream, [0, 0.36, 0.02], [HPI, 0, 0]);
    head = add(g, new THREE.SphereGeometry(0.19, 12, 10), orange, [0, 0.64, 0.4]);
    add(head, new THREE.ConeGeometry(0.1, 0.24, 8), cream, [0, -0.06, 0.2], [HPI, 0, 0]);                    // snout
    add(head, new THREE.SphereGeometry(0.035, 6, 6), dark, [0, -0.06, 0.32]);
    add(head, new THREE.SphereGeometry(0.03, 6, 6), dark, [-0.08, 0.04, 0.15]); add(head, new THREE.SphereGeometry(0.03, 6, 6), dark, [0.08, 0.04, 0.15]);
    add(head, new THREE.SphereGeometry(0.09, 7, 6), cream, [-0.1, -0.02, 0.1], [0, 0, 0], [1, 0.8, 1]); add(head, new THREE.SphereGeometry(0.09, 7, 6), cream, [0.1, -0.02, 0.1], [0, 0, 0], [1, 0.8, 1]);  // cheeks
    for (const s of [-1, 1]) {
      const ear = add(head, new THREE.ConeGeometry(0.07, 0.22, 6), orange, [s * 0.1, 0.22, -0.04], [0, 0, -s * 0.25]);
      add(ear, new THREE.ConeGeometry(0.04, 0.14, 6), pink, [0, -0.02, 0.02]); add(ear, new THREE.ConeGeometry(0.075, 0.06, 6), dark, [0, 0.1, 0]);
      ears.push(ear);
    }
    tail = new THREE.Group(); tail.position.set(0, 0.5, -0.32); g.add(tail);
    add(tail, new THREE.CapsuleGeometry(0.12, 0.38, 4, 8), orange, [0, 0.12, -0.2], [-0.9, 0, 0]);
    add(tail, new THREE.SphereGeometry(0.11, 8, 8), cream, [0, 0.36, -0.36]);
    for (const [x, z] of [[-0.11, 0.18], [0.11, 0.18], [-0.11, -0.16], [0.11, -0.16]]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.34, z); g.add(pivot);
      add(pivot, new THREE.CylinderGeometry(0.045, 0.04, 0.16, 6), orange, [0, -0.08, 0]); add(pivot, new THREE.CylinderGeometry(0.042, 0.04, 0.2, 6), sock, [0, -0.25, 0]);
      legs.push(pivot);
    }
  }
  return { group: g, body, head, tail, legs, ears, mats };
}

// ============================================================================
// koban coin — oval gold with a square hole, ~0.5 m tall, facing -z
// ============================================================================
export function coinGeometry() {
  const shape = new THREE.Shape(); shape.absellipse(0, 0, 0.17, 0.25, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path(); const h = 0.055; hole.moveTo(-h, -h); hole.lineTo(h, -h); hole.lineTo(h, h); hole.lineTo(-h, h); hole.closePath(); shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 14 });
  g.translate(0, 0.25, -0.025);            // y from 0 (its bottom rests on y=0 before the renderer floats it)
  const gold = paint(g, [1.0, 0.78, 0.22]); // faintly warm; the renderer may swap in a GLOW-ish material
  const rim = paint(new THREE.TorusGeometry(0.2, 0.018, 4, 24), '#7a5a10', { p: [0, 0.25, 0], s: [0.85, 1.25, 1] }).toNonIndexed();   // extrude is non-indexed
  return merge([gold, rim]);
}
