// Particles and moving set-dressing: sakura petals, fireflies, typhoon rain,
// the kitsunebi trail behind the fox, and the shinkansen that passes on the viaduct.
import * as THREE from 'three';
import { radial } from './sky.js';

function petalTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  g.fillStyle = '#ffc6dc'; g.beginPath(); g.ellipse(16, 16, 12, 7, 0.6, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff9fc4'; g.beginPath(); g.ellipse(16, 16, 6, 3, 0.6, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Camera-space particle field that scrolls with the world so it reads as static in it. */
class Field {
  constructor(n, box, make) {
    this.n = n; this.box = box;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.reset(i, true); }
    this.geo = new THREE.BufferGeometry(); this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.obj = make(this.geo);
  }
  reset(i, anywhere = false) {
    const b = this.box;
    this.pos[i * 3] = b.x[0] + Math.random() * (b.x[1] - b.x[0]);
    this.pos[i * 3 + 1] = anywhere ? b.y[0] + Math.random() * (b.y[1] - b.y[0]) : b.y[1];
    this.pos[i * 3 + 2] = anywhere ? b.z[0] + Math.random() * (b.z[1] - b.z[0]) : b.z[1] - Math.random() * 10;
    this.phase[i] = Math.random() * Math.PI * 2;
  }
  step(dt, scroll, time, fn) {
    const b = this.box, p = this.pos;
    for (let i = 0; i < this.n; i++) {
      fn(i, p, dt, time, this.phase[i]);
      p[i * 3 + 2] -= scroll * dt;
      if (p[i * 3 + 1] < b.y[0] || p[i * 3 + 2] < b.z[0]) this.reset(i);
      if (p[i * 3] < b.x[0]) p[i * 3] += b.x[1] - b.x[0]; if (p[i * 3] > b.x[1]) p[i * 3] -= b.x[1] - b.x[0];
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

export function makePetals() {
  const f = new Field(420, { x: [-22, 22], y: [0.2, 12], z: [-8, 70] }, (geo) => new THREE.Points(geo, new THREE.PointsMaterial({
    map: petalTexture(), size: 0.32, transparent: true, depthWrite: false, opacity: 0.9, color: 0xffd0e4, alphaTest: 0.1 })));
  f.update = (dt, scroll, time) => f.step(dt, scroll, time, (i, p, dt, t, ph) => {
    p[i * 3 + 1] -= (0.7 + 0.3 * Math.sin(ph)) * dt; p[i * 3] += Math.sin(t * 1.3 + ph) * 0.9 * dt; p[i * 3 + 2] += Math.cos(t * 0.9 + ph) * 0.4 * dt; });
  return f;
}
export function makeFireflies() {
  const f = new Field(140, { x: [-24, 24], y: [0.4, 4], z: [-6, 60] }, (geo) => new THREE.Points(geo, new THREE.PointsMaterial({
    map: radial('rgba(255,255,200,1)', 'rgba(200,255,120,0)'), size: 0.3, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.2, 1.6, 0.5) })));
  f.update = (dt, scroll, time) => f.step(dt, scroll, time, (i, p, dt, t, ph) => {
    p[i * 3] += Math.sin(t * 0.8 + ph) * 0.6 * dt; p[i * 3 + 1] += Math.cos(t * 1.1 + ph * 2.0) * 0.4 * dt; if (p[i * 3 + 1] < 0.4) p[i * 3 + 1] = 0.4; });
  return f;
}
export function makeRain() {
  const n = 700; const pos = new Float32Array(n * 6);
  const box = { x: [-16, 16], y: [0, 14], z: [-6, 40] };
  const reset = (i, any) => { const x = box.x[0] + Math.random() * 32, y = any ? Math.random() * 14 : 14, z = box.z[0] + Math.random() * 46;
    pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z; pos[i * 6 + 3] = x + 0.08; pos[i * 6 + 4] = y - 0.8; pos[i * 6 + 5] = z; };
  for (let i = 0; i < n; i++) reset(i, true);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xbcc8e6, transparent: true, opacity: 0, depthWrite: false });
  const obj = new THREE.LineSegments(geo, mat);
  return { obj, update(dt, scroll, intensity) {
    mat.opacity += (intensity * 0.5 - mat.opacity) * Math.min(1, dt * 2);
    if (mat.opacity < 0.01) { obj.visible = false; return; } obj.visible = true;
    for (let i = 0; i < n; i++) { const dy = 22 * dt, dz = scroll * dt; pos[i * 6 + 1] -= dy; pos[i * 6 + 4] -= dy; pos[i * 6 + 2] -= dz; pos[i * 6 + 5] -= dz;
      if (pos[i * 6 + 4] < 0 || pos[i * 6 + 2] < box.z[0]) reset(i, false); }
    geo.attributes.position.needsUpdate = true;
  } };
}

/** Kitsunebi: fox-fire trail in root (world) space. */
export function makeTrail(n = 90) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), age = new Float32Array(n).fill(9);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const obj = new THREE.Points(geo, new THREE.PointsMaterial({ map: radial('rgba(200,240,255,1)', 'rgba(80,160,255,0)'), size: 0.34, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  let head = 0, acc = 0;
  return { obj, emit(x, y, z, dt, moving) {
    acc += dt; if (moving && acc > 0.025) { acc = 0; pos[head * 3] = x + (Math.random() - 0.5) * 0.25; pos[head * 3 + 1] = y + 0.35 + Math.random() * 0.25; pos[head * 3 + 2] = z - 0.3; age[head] = 0; head = (head + 1) % n; }
    for (let i = 0; i < n; i++) { age[i] += dt; const a = Math.max(0, 1 - age[i] / 0.9); pos[i * 3 + 1] += dt * 0.8; col[i * 3] = 0.35 * a; col[i * 3 + 1] = 0.8 * a; col[i * 3 + 2] = 1.5 * a; }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  } };
}

/** Shinkansen: white body, blue stripe, glowing windows. Root-space, moves toward the runner. */
export function makeTrain() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 44), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.35, metalness: 0.2 })); body.position.y = 1.3; g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.3, 7, 4), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.35 })); nose.rotation.x = -Math.PI / 2; nose.rotation.z = Math.PI / 4; nose.scale.set(1, 1, 1); nose.position.set(0, 1.3, -25.5); g.add(nose);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.35, 44), new THREE.MeshBasicMaterial({ color: 0x2457c5 })); stripe.position.y = 1.7; g.add(stripe);
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.5, 42), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.5) })); win.position.y = 2.15; g.add(win);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 3) })); head.position.set(0, 1.0, -28.8); g.add(head);
  g.visible = false;
  return g;
}
