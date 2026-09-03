// Prop geometry for the Japan build: everything is merged into single
// vertex-coloured meshes so an obstacle or a decoration costs one draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Paint a geometry with one colour (vertex colours) and place it. */
function part(geo, color, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  const c = new THREE.Color(color); const n = g.attributes.position.count; const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const merge = (parts) => mergeGeometries(parts, false);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 10) => new THREE.CylinderGeometry(rt, rb, h, n);
const cone = (r, h, n = 8) => new THREE.ConeGeometry(r, h, n);
const sph = (r, n = 10) => new THREE.SphereGeometry(r, n, Math.max(6, n - 2));

export const PAINT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });

// ---- obstacles ---------------------------------------------------------
/** Stone lantern (ishidōrō) — the mountain "stalk". ~2.3 m tall. */
export function stoneLantern() {
  const stone = '#8d8a80', dark = '#6d6a62', warm = '#f6d8a0';
  return merge([
    part(box(0.8, 0.25, 0.8), dark, { p: [0, 0.12, 0] }),
    part(cyl(0.13, 0.16, 1.0), stone, { p: [0, 0.75, 0] }),
    part(box(0.8, 0.12, 0.8), dark, { p: [0, 1.3, 0] }),
    part(box(0.5, 0.5, 0.5), warm, { p: [0, 1.6, 0] }),
    part(cone(0.62, 0.4, 4), stone, { p: [0, 2.05, 0], r: [0, Math.PI / 4, 0] }),
    part(sph(0.1), stone, { p: [0, 2.3, 0] }),
  ]);
}
/** Vending machine — the Tokyo "stalk". */
export function vendingMachine(tint = '#d23b3b') {
  return merge([
    part(box(0.95, 1.9, 0.7), tint, { p: [0, 0.95, 0] }),
    part(box(0.7, 1.1, 0.06), '#dfe9ff', { p: [0.05, 1.25, -0.36] }),
    part(box(0.2, 0.5, 0.06), '#222', { p: [-0.32, 0.9, -0.36] }),
    part(box(0.95, 0.12, 0.7), '#2a2a2a', { p: [0, 0.06, 0] }),
  ]);
}
/** Small torii — the mountain "arch"; slide under the lower beam. */
export function toriiSmall() {
  const red = '#c9302c', black = '#2b2422';
  return merge([
    part(cyl(0.09, 0.11, 1.3), red, { p: [-1.0, 0.65, 0] }),
    part(cyl(0.09, 0.11, 1.3), red, { p: [1.0, 0.65, 0] }),
    part(box(2.7, 0.14, 0.18), black, { p: [0, 1.36, 0] }),
    part(box(2.3, 0.1, 0.12), red, { p: [0, 1.06, 0] }),
  ]);
}
/** Noren shop curtain on a bar — the Tokyo "arch". */
export function noren(color = '#2f3f8f') {
  return merge([
    part(cyl(0.05, 0.05, 2.6), '#3b2a1a', { p: [0, 1.4, 0], r: [0, 0, Math.PI / 2] }),
    part(box(0.7, 0.55, 0.03), color, { p: [-0.75, 1.1, 0] }),
    part(box(0.7, 0.55, 0.03), color, { p: [0, 1.1, 0] }),
    part(box(0.7, 0.55, 0.03), color, { p: [0.75, 1.1, 0] }),
    part(box(0.3, 0.2, 0.035), '#f4efe4', { p: [0, 1.15, 0] }),
  ]);
}
/** Mossy boulder — the mountain "drusen". */
export function boulder() {
  return merge([
    part(new THREE.DodecahedronGeometry(0.62, 0), '#6e7264', { p: [0, 0.32, 0], s: [1.2, 0.62, 1] }),
    part(new THREE.DodecahedronGeometry(0.35, 0), '#5e7a4a', { p: [0.2, 0.55, 0.1], s: [1.2, 0.5, 1] }),
  ]);
}
/** Striped construction barrier — the Tokyo "drusen". */
export function barrier() {
  return merge([
    part(box(1.7, 0.42, 0.18), '#f2c230', { p: [0, 0.55, 0] }),
    part(box(0.3, 0.44, 0.2), '#1e1e1e', { p: [-0.5, 0.55, 0] }),
    part(box(0.3, 0.44, 0.2), '#1e1e1e', { p: [0.5, 0.55, 0] }),
    part(box(0.12, 0.6, 0.3), '#c9c9c9', { p: [-0.75, 0.3, 0] }),
    part(box(0.12, 0.6, 0.3), '#c9c9c9', { p: [0.75, 0.3, 0] }),
  ]);
}

// ---- decoration ---------------------------------------------------------
/** Big torii spanning the road: the gate into the mountains. */
export function toriiBig() {
  const red = '#c9302c', black = '#2b2422';
  return merge([
    part(cyl(0.35, 0.42, 7.5), red, { p: [-6.2, 3.75, 0] }),
    part(cyl(0.35, 0.42, 7.5), red, { p: [6.2, 3.75, 0] }),
    part(box(15.5, 0.55, 0.7), black, { p: [0, 7.7, 0] }),
    part(box(13.5, 0.4, 0.5), red, { p: [0, 6.6, 0] }),
    part(box(0.6, 0.8, 0.55), black, { p: [0, 7.1, 0] }),
  ]);
}
/** Highway sign gantry: the gate into the city. */
export function gantry() {
  return merge([
    part(box(0.35, 7, 0.35), '#8e959c', { p: [-7, 3.5, 0] }),
    part(box(0.35, 7, 0.35), '#8e959c', { p: [7, 3.5, 0] }),
    part(box(14.5, 0.4, 0.4), '#8e959c', { p: [0, 7, 0] }),
    part(box(4.5, 1.8, 0.1), '#1d5fb8', { p: [-2, 5.7, 0] }),
    part(box(2.5, 1.2, 0.1), '#2a9d4b', { p: [3.5, 5.9, 0] }),
  ]);
}
/** Street lamp (Tokyo roadside). */
export function lampPost() {
  return merge([
    part(cyl(0.06, 0.09, 5), '#4c525a', { p: [0, 2.5, 0] }),
    part(box(1.1, 0.08, 0.08), '#4c525a', { p: [0.5, 5, 0] }),
    part(box(0.5, 0.18, 0.28), '#fff1d0', { p: [1.0, 4.95, 0] }),
  ]);
}
/** Building box with UVs scaled so windows keep their size regardless of height. */
export function building(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv; const arr = uv.array;
  // faces order: +x, -x, +y, -y, +z, -z ; 4 verts each
  const scale = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = (f * 4 + v) * 2; arr[i] *= scale[f][0] / 3; arr[i + 1] *= scale[f][1] / 3; }
  uv.needsUpdate = true;
  g.translate(0, h / 2, 0);
  return g;
}
export function windowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#0b0d16'; g.fillRect(0, 0, 64, 64);
  const cols = ['#ffe9b0', '#ffd27a', '#bfe8ff', '#ffffff', '#f7c6ff'];
  for (let y = 4; y < 64; y += 12) for (let x = 4; x < 64; x += 12) {
    if (Math.random() < 0.55) { g.fillStyle = cols[Math.floor(Math.random() * cols.length)]; g.globalAlpha = 0.6 + Math.random() * 0.4; g.fillRect(x, y, 6, 8); g.globalAlpha = 1; }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}

// ---- the runner ------------------------------------------------------------
/** A low-poly kitsune. `mat(colorHex)` builds materials so ghosts can reuse the rig. */
export function buildFox(mat) {
  const g = new THREE.Group();
  const orange = mat('#e8792c'), cream = mat('#fff3e0'), dark = mat('#2b1d1a'), sock = mat('#3a2418');
  const add = (geo, m, p, r = [0, 0, 0]) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(...p); mesh.rotation.set(...r); g.add(mesh); return mesh; };
  const body = add(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), orange, [0, 0.44, 0], [Math.PI / 2, 0, 0]);
  add(new THREE.CapsuleGeometry(0.14, 0.36, 4, 8), cream, [0, 0.36, 0.02], [Math.PI / 2, 0, 0]);
  const head = add(new THREE.SphereGeometry(0.19, 12, 10), orange, [0, 0.64, 0.4]);
  add(new THREE.ConeGeometry(0.1, 0.24, 8), cream, [0, 0.58, 0.6], [Math.PI / 2, 0, 0]);
  add(new THREE.SphereGeometry(0.035, 6, 6), dark, [0, 0.58, 0.72]);
  add(new THREE.ConeGeometry(0.07, 0.2, 6), orange, [-0.1, 0.86, 0.36], [0, 0, 0.25]);
  add(new THREE.ConeGeometry(0.07, 0.2, 6), orange, [0.1, 0.86, 0.36], [0, 0, -0.25]);
  add(new THREE.SphereGeometry(0.03, 6, 6), dark, [-0.08, 0.68, 0.55]);
  add(new THREE.SphereGeometry(0.03, 6, 6), dark, [0.08, 0.68, 0.55]);
  const tail = new THREE.Group(); tail.position.set(0, 0.5, -0.32); g.add(tail);
  const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.38, 4, 8), orange); t1.position.set(0, 0.12, -0.2); t1.rotation.x = -0.9; tail.add(t1);
  const t2 = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), cream); t2.position.set(0, 0.36, -0.36); tail.add(t2);
  const legs = [];
  for (const [x, z] of [[-0.11, 0.18], [0.11, 0.18], [-0.11, -0.16], [0.11, -0.16]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.34, z); g.add(pivot);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.34, 6), sock); leg.position.y = -0.17; pivot.add(leg);
    legs.push(pivot);
  }
  return { group: g, body, head, tail, legs };
}
