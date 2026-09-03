// Particles and moving set-dressing: seasonal fields (petals, tumbling leaves,
// snow, fireflies, rain, dust, wind ribbons), spirit-fire trails, the
// shinkansen, and shock rings.
import * as THREE from 'three';
import { radial, canvasTexture } from './common.js';

const petalTex = () => canvasTexture(32, 32, (g) => { g.fillStyle = '#ffd3e3'; g.beginPath(); g.ellipse(16, 16, 12, 7, 0.6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#ffaacb'; g.beginPath(); g.ellipse(16, 16, 6, 3, 0.6, 0, Math.PI * 2); g.fill(); });
const leafTex = () => canvasTexture(32, 32, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(16, 2); g.lineTo(26, 12); g.lineTo(30, 24); g.lineTo(18, 20); g.lineTo(16, 30); g.lineTo(14, 20); g.lineTo(2, 24); g.lineTo(6, 12); g.closePath(); g.fill(); g.strokeStyle = 'rgba(120,40,20,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(16, 4); g.lineTo(16, 28); g.stroke(); });
const flakeTex = () => canvasTexture(32, 32, (g) => { g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.lineCap = 'round'; for (let i = 0; i < 3; i++) { g.save(); g.translate(16, 16); g.rotate(i * Math.PI / 3); g.beginPath(); g.moveTo(-11, 0); g.lineTo(11, 0); g.moveTo(6, -4); g.lineTo(9, 0); g.lineTo(6, 4); g.moveTo(-6, -4); g.lineTo(-9, 0); g.lineTo(-6, 4); g.stroke(); g.restore(); } });

/** Camera-space point field with per-point size/rotation/colour; scrolls with the world. */
class Field {
  constructor(parent, n, box, tex, { additive = false, baseSize = 0.3, tumble = 1 } = {}) {
    this.n = n; this.box = box; this.tumble = tumble;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.rot = new Float32Array(n); this.spin = new Float32Array(n); this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) this.reset(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1)); geo.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTex: { value: tex }, uTime: { value: 0 }, uOpacity: { value: 0 }, uBase: { value: baseSize } },
      vertexShader: `attribute float aSize, aRot, aSpin; varying vec3 vCol; varying float vRot; uniform float uTime, uBase;
        void main(){ vCol = color; vRot = aRot + uTime * aSpin; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = uBase * aSize * 420.0 / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uOpacity; varying vec3 vCol; varying float vRot;
        void main(){ vec2 c = gl_PointCoord - 0.5; float s = sin(vRot), k = cos(vRot); vec2 r = vec2(c.x * k - c.y * s, c.x * s + c.y * k) + 0.5;
          vec4 t = texture2D(uTex, r); if (t.a < 0.05) discard; gl_FragColor = vec4(t.rgb * vCol, t.a * uOpacity); }`,
      vertexColors: true,
    });
    this.obj = new THREE.Points(geo, this.mat); this.obj.frustumCulled = false; this.obj.visible = false; parent.add(this.obj);
    this.target = 0;
  }
  reset(i, anywhere = false) {
    const b = this.box;
    this.pos[i * 3] = b.x[0] + Math.random() * (b.x[1] - b.x[0]);
    this.pos[i * 3 + 1] = anywhere ? b.y[0] + Math.random() * (b.y[1] - b.y[0]) : b.y[1];
    this.pos[i * 3 + 2] = anywhere ? b.z[0] + Math.random() * (b.z[1] - b.z[0]) : b.z[1] - Math.random() * 12;
    this.size[i] = 0.7 + Math.random() * 0.7; this.rot[i] = Math.random() * 6.28; this.spin[i] = (Math.random() - 0.5) * 6 * this.tumble; this.phase[i] = Math.random() * 6.28;
    this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 1;
  }
  paint(fn) { for (let i = 0; i < this.n; i++) { const c = fn(i); this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2]; } this.obj.geometry.attributes.color.needsUpdate = true; }
  step(dt, scroll, time, fn) {
    this.mat.uniforms.uOpacity.value += (this.target - this.mat.uniforms.uOpacity.value) * Math.min(1, dt * 1.2);
    this.mat.uniforms.uTime.value = time;
    if (this.mat.uniforms.uOpacity.value < 0.01) { this.obj.visible = false; return; } this.obj.visible = true;
    const b = this.box, p = this.pos;
    for (let i = 0; i < this.n; i++) {
      fn(i, p, dt, time, this.phase[i]);
      p[i * 3 + 2] -= scroll * dt;
      if (p[i * 3 + 1] < b.y[0] || p[i * 3 + 2] < b.z[0] || p[i * 3 + 2] > b.z[1] + 5) this.reset(i);
      if (p[i * 3] < b.x[0]) p[i * 3] += b.x[1] - b.x[0]; if (p[i * 3] > b.x[1]) p[i * 3] -= b.x[1] - b.x[0];
    }
    this.obj.geometry.attributes.position.needsUpdate = true;
  }
}

function lines(parent, n, len, color, opacity) {
  const pos = new Float32Array(n * 6); const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const obj = new THREE.LineSegments(geo, mat); obj.frustumCulled = false; obj.visible = false; parent.add(obj);
  return { pos, geo, mat, obj, n, len, target: 0, max: opacity };
}

export function makeParticles(parent) {
  const petals = new Field(parent, 420, { x: [-24, 24], y: [0.2, 12], z: [-8, 70] }, petalTex(), { baseSize: 0.32 });
  const leaves = new Field(parent, 520, { x: [-26, 26], y: [0.1, 12], z: [-8, 70] }, leafTex(), { baseSize: 0.42, tumble: 1.6 });
  leaves.paint(() => { const t = Math.random(); return t < 0.45 ? [0.95, 0.18 + Math.random() * 0.1, 0.08] : t < 0.8 ? [1, 0.5 + Math.random() * 0.2, 0.1] : [1, 0.85, 0.25]; });
  const snow = new Field(parent, 1300, { x: [-26, 26], y: [0, 14], z: [-8, 70] }, flakeTex(), { baseSize: 0.22, tumble: 0.6 });
  const flies = new Field(parent, 160, { x: [-24, 24], y: [0.4, 4], z: [-6, 60] }, radial('rgba(255,255,200,1)', 'rgba(200,255,120,0)'), { additive: true, baseSize: 0.35, tumble: 0 });
  flies.paint(() => [1.4, 1.8, 0.6]);
  const dust = new Field(parent, 200, { x: [-14, 14], y: [0.5, 8], z: [-4, 40] }, radial('rgba(255,240,200,0.8)', 'rgba(255,240,200,0)'), { additive: true, baseSize: 0.12, tumble: 0 });
  const rain = lines(parent, 700, 0.8, 0xbcc8e6, 0.5); const rainBox = { z: [-6, 40] };
  const resetRain = (i, any) => { const x = -16 + Math.random() * 32, y = any ? Math.random() * 14 : 14, z = rainBox.z[0] + Math.random() * 46; rain.pos.set([x, y, z, x + 0.08, y - 0.8, z], i * 6); };
  for (let i = 0; i < rain.n; i++) resetRain(i, true);
  const wind = lines(parent, 90, 6, 0xffffff, 0.35); const windBox = { z: [-10, 60] };
  const windV = new Float32Array(wind.n);
  const resetWind = (i, any) => { const x = -20 + Math.random() * 40, y = 0.3 + Math.random() * 6, z = any ? windBox.z[0] + Math.random() * 70 : windBox.z[0]; const L = 3 + Math.random() * 6; wind.pos.set([x, y, z, x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.3, z + L], i * 6); windV[i] = 14 + Math.random() * 16; };
  for (let i = 0; i < wind.n; i++) resetWind(i, true);
  let phaseT = 0;
  return {
    update(dt, st) {
      phaseT += dt;
      const { season, biome, night, scroll, dread } = st; const wx = st.wind?.x ?? 0, ws = st.wind?.length() ?? 1;
      petals.target = season === 0 && biome !== 1 ? 0.95 : season === 0 ? 0.3 : 0;
      leaves.target = season === 2 && biome !== 1 ? 1 : season === 2 ? 0.45 : 0;
      snow.target = season === 3 ? (biome === 0 ? 1 : 0.8) : 0;
      flies.target = season === 1 && night > 0.4 && biome !== 1 ? 0.9 : 0;
      dust.target = night < 0.3 && dread < 0.4 ? 0.6 : 0;
      rain.target = Math.max(dread > 0.5 ? (dread - 0.5) * 2 : 0, season === 1 && night > 0.3 && night < 0.6 ? 0.55 : 0) * rain.max;
      wind.target = (0.12 + (season === 2 ? 0.25 : 0) + dread * 0.5) * wind.max;
      petals.step(dt, scroll, phaseT, (i, p, dt, t, ph) => { p[i * 3 + 1] -= (0.7 + 0.3 * Math.sin(ph)) * dt; p[i * 3] += (Math.sin(t * 1.3 + ph) * 0.9 + wx * 0.8) * dt; p[i * 3 + 2] += (Math.cos(t * 0.9 + ph) * 0.4 + ws * 1.5) * dt; });
      leaves.step(dt, scroll, phaseT, (i, p, dt, t, ph) => { p[i * 3 + 1] -= (1.1 + 0.6 * Math.sin(ph + t)) * dt; p[i * 3] += (Math.sin(t * 1.1 + ph) * 1.6 + wx * 1.5) * dt; p[i * 3 + 2] += (2.5 + ws * 3.5 + Math.cos(t * 0.8 + ph) * 1.2) * dt; });
      snow.step(dt, scroll, phaseT, (i, p, dt, t, ph) => { p[i * 3 + 1] -= (0.9 + 0.4 * Math.sin(ph)) * dt; p[i * 3] += (Math.sin(t * 0.7 + ph) * 0.5 + wx * 0.6) * dt; p[i * 3 + 2] += (ws * 0.8) * dt; });
      flies.step(dt, scroll, phaseT, (i, p, dt, t, ph) => { p[i * 3] += Math.sin(t * 0.8 + ph) * 0.6 * dt; p[i * 3 + 1] += Math.cos(t * 1.1 + ph * 2) * 0.4 * dt; if (p[i * 3 + 1] < 0.4) p[i * 3 + 1] = 0.4; });
      dust.step(dt, scroll * 0.2, phaseT, (i, p, dt, t, ph) => { p[i * 3] += Math.sin(t * 0.5 + ph) * 0.2 * dt; p[i * 3 + 1] += Math.cos(t * 0.4 + ph) * 0.15 * dt; });
      for (const L of [rain, wind]) { L.mat.opacity += (L.target - L.mat.opacity) * Math.min(1, dt * 2); L.obj.visible = L.mat.opacity > 0.01; }
      if (rain.obj.visible) { for (let i = 0; i < rain.n; i++) { const dy = 22 * dt, dz = scroll * dt; rain.pos[i * 6 + 1] -= dy; rain.pos[i * 6 + 4] -= dy; rain.pos[i * 6 + 2] -= dz; rain.pos[i * 6 + 5] -= dz; if (rain.pos[i * 6 + 4] < 0 || rain.pos[i * 6 + 2] < rainBox.z[0]) resetRain(i, false); } rain.geo.attributes.position.needsUpdate = true; }
      if (wind.obj.visible) { for (let i = 0; i < wind.n; i++) { const dz = (windV[i] * ws - scroll) * dt; wind.pos[i * 6 + 2] += dz; wind.pos[i * 6 + 5] += dz; wind.pos[i * 6] += wx * 2 * dt; wind.pos[i * 6 + 3] += wx * 2 * dt; if (wind.pos[i * 6 + 2] > windBox.z[1] || wind.pos[i * 6 + 5] < windBox.z[0]) resetWind(i, false); } wind.geo.attributes.position.needsUpdate = true; }
    },
  };
}

/** Spirit-fire trail in root (world) space. */
export function makeTrail(parent, color = new THREE.Color(0.5, 1.2, 2.4), n = 90) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), age = new Float32Array(n).fill(9);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const obj = new THREE.Points(geo, new THREE.PointsMaterial({ map: radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), size: 0.36, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  obj.frustumCulled = false; parent.add(obj);
  let head = 0, acc = 0;
  return { obj, emit(x, y, z, dt, moving) {
    acc += dt; if (moving && acc > 0.025) { acc = 0; pos[head * 3] = x + (Math.random() - 0.5) * 0.25; pos[head * 3 + 1] = y + 0.35 + Math.random() * 0.25; pos[head * 3 + 2] = z - 0.3; age[head] = 0; head = (head + 1) % n; }
    for (let i = 0; i < n; i++) { age[i] += dt; const a = Math.max(0, 1 - age[i] / 0.9); pos[i * 3 + 1] += dt * 0.8; col[i * 3] = color.r * a * 0.7; col[i * 3 + 1] = color.g * a * 0.7; col[i * 3 + 2] = color.b * a * 0.7; }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  } };
}

/** Shinkansen: white body, blue stripe, glowing windows. Root-space, moves toward the runners. */
export function makeTrain() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 44), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.35, metalness: 0.2 })); body.position.y = 1.3; g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.3, 7, 4), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.35 })); nose.rotation.x = -Math.PI / 2; nose.rotation.z = Math.PI / 4; nose.position.set(0, 1.3, -25.5); g.add(nose);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.35, 44), new THREE.MeshBasicMaterial({ color: 0x2457c5 })); stripe.position.y = 1.7; g.add(stripe);
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.5, 42), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.5) })); win.position.y = 2.15; g.add(win);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 3) })); head.position.set(0, 1.0, -28.8); g.add(head);
  g.visible = false; return g;
}

/** Expanding ground rings for pickups, shield breaks, and barges. Root space. */
export function makeShockRing(parent) {
  const rings = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.visible = false; parent.add(m); rings.push({ m, life: 9 });
  }
  return {
    burst(x, z, color) { const r = rings.reduce((a, b) => (a.life > b.life ? a : b)); r.life = 0; r.m.position.set(x, 0.05, z); r.m.material.color.copy(color); r.m.visible = true; },
    update(dt) { for (const r of rings) { if (r.life > 1) { r.m.visible = false; continue; } r.life += dt * 1.8; const k = 1 + r.life * 6; r.m.scale.set(k, k, 1); r.m.material.opacity = (1 - r.life) * 0.9; } },
  };
}
