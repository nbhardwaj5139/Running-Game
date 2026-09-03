// Shared render helpers: pools, painted (vertex-coloured) geometry, canvas
// textures, and the GLSL noise chunk every shader uses. No scene logic here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const NOISE_GLSL = /* glsl */`
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }`;

/** Standard lit material for painted props; GLOW is unlit and blooms when colours exceed 1. */
export const PAINT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04 });
export const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });

/** Clone `geo`, paint every vertex `color` (hex string, number, THREE.Color, or [r,g,b] which may exceed 1), and place it. */
export function paint(geo, color, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  const c = Array.isArray(color) ? color : (() => { const k = new THREE.Color(color); return [k.r, k.g, k.b]; })();
  const n = g.attributes.position.count; const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
/** Merge painted parts into one geometry (one draw call). */
export const merge = (parts) => mergeGeometries(parts, false);

// primitive shorthands
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, n = 10) => new THREE.CylinderGeometry(rt, rb, h, n);
export const cone = (r, h, n = 8) => new THREE.ConeGeometry(r, h, n);
export const sph = (r, n = 10) => new THREE.SphereGeometry(r, n, Math.max(6, n - 2));

/** Radial gradient canvas texture (sprites, mist, glows). */
export function radial(inner, outer, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, inner); r.addColorStop(1, outer); g.fillStyle = r; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** Any canvas-drawn texture: draw(ctx, w, h). */
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Pool of identical meshes (one geometry + material). take() shows one, give() hides it. */
export class MeshPool {
  constructor(key, geo, mat, parent) { this.key = key; this.geo = geo; this.mat = mat; this.parent = parent; this.free = []; }
  take() {
    let m = this.free.pop();
    if (!m) { m = new THREE.Mesh(this.geo, this.mat); m.userData.pool = this.key; this.parent.add(m); }
    m.visible = true; m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); return m;
  }
  give(m) { m.visible = false; this.free.push(m); }
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
/** InstancedMesh with a free-list. Hidden instances are zero-scaled. Call flush() after a batch of changes. */
export class InstancePool {
  constructor(parent, geo, mat, cap) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap); this.mesh.frustumCulled = false;
    this.free = []; const white = new THREE.Color(1, 1, 1);
    for (let i = cap - 1; i >= 0; i--) { this.mesh.setMatrixAt(i, ZERO); this.mesh.setColorAt(i, white); this.free.push(i); }
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    this.cap = cap; this.dropped = 0;
    parent.add(this.mesh);
  }
  take(matrix, color) { const i = this.free.pop(); if (i === undefined) { this.dropped++; return -1; } this.mesh.setMatrixAt(i, matrix); if (color) this.mesh.setColorAt(i, color); this.dirty = true; return i; }
  set(i, matrix) { if (i >= 0) { this.mesh.setMatrixAt(i, matrix); this.dirty = true; } }
  give(i) { if (i < 0) return; this.mesh.setMatrixAt(i, ZERO); this.free.push(i); this.dirty = true; }
  flush() { if (!this.dirty) return; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; this.dirty = false; }
}

const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _V = new THREE.Vector3(), _S = new THREE.Vector3(), _E = new THREE.Euler(), _Q2 = new THREE.Quaternion();
/** The track mapper: when set (by the renderer), every placement in track space (x across, y up, z along) becomes world space. */
export const TRACK = { map: null, shift: 0 };   // shift: x offset applied by the renderer's mapper (solo centres the fox's three lanes)
/** Compose a (shared, reused) matrix: position, uniform-or-per-axis scale, yaw — in track space, mapped through the track. Copy it if you keep it. */
export function compose(x, y, z, sx = 1, sy = sx, sz = sx, ry = 0) {
  if (TRACK.map) { TRACK.map(x, y, z, ry, _V, _Q); return _M.compose(_V, _Q, _S.set(sx, sy, sz)); }
  return _M.compose(_V.set(x, y, z), _Q.setFromEuler(_E.set(0, ry, 0)), _S.set(sx, sy, sz));
}
/** Map a mesh whose position/rotation were set in track space to world space (call once after placing it). */
export function placeMesh(m) {
  if (!TRACK.map) return m;
  _Q2.setFromEuler(m.rotation);
  TRACK.map(m.position.x, m.position.y, m.position.z, 0, m.position, _Q);
  m.quaternion.copy(_Q).multiply(_Q2);
  if (m.userData.mirror) m.scale.x = -Math.abs(m.scale.x);   // asymmetric art (text) keeps reading correctly
  return m;
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => Math.min(1, Math.max(0, t));
