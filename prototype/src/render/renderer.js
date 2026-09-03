// Three.js view of the sim — the Japan build. Mountain shrine paths alternate
// with neon Tokyo streets; Fuji on the horizon; dusk falls as you run.
// Owns all pooled meshes and instance pools; never mutates the sim.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANE_W, CHUNK_LEN, laneX } from '../core/chunks.js';
import { mulberry32, mixSeed } from '../core/rng.js';
import { W } from '../core/world.js';
import * as PROPS from './props.js';
import { makeSky, makeHorizon, radial } from './sky.js';
import { makeGroundMaterial, groundGeometry, MAX_NEON } from './ground.js';
import { makePetals, makeFireflies, makeRain, makeTrail, makeTrain } from './fx.js';

/** The camera looks down +z, where +x is screen-left; SX mirrors every x so "right" is right. */
const SX = -1;
/** 0 = mountain shrine path, 1 = Tokyo street. Ten chunks (360 m) each. */
export const biomeOf = (index) => Math.floor(index / 10) % 2;

const NEON_WORDS = [
  ['ラーメン', '#ff3fa4'], ['寿司', '#ffd23f'], ['居酒屋', '#ff5a3c'], ['カラオケ', '#3fe0ff'], ['薬', '#5cff7a'],
  ['電気', '#ffffff'], ['祭', '#ff3c5a'], ['珈琲', '#ffb347'], ['ホテル', '#c77dff'], ['24h', '#3fe0ff'], ['焼肉', '#ff8a3c'], ['本', '#7ac8ff'],
];
function neonTexture(word, color, vertical) {
  const c = document.createElement('canvas'); const W_ = vertical ? 96 : 320, H_ = vertical ? 64 * word.length + 40 : 112;
  c.width = W_; c.height = H_; const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,8,18,0.88)'; g.fillRect(0, 0, W_, H_);
  g.strokeStyle = color; g.lineWidth = 6; g.shadowColor = color; g.shadowBlur = 18; g.strokeRect(6, 6, W_ - 12, H_ - 12);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowBlur = 24;
  g.font = `bold ${vertical ? 52 : 64}px "Noto Sans JP", "IPAGothic", "Hiragino Sans", "Yu Gothic", sans-serif`;
  if (vertical) [...word].forEach((ch, i) => g.fillText(ch, W_ / 2, 42 + i * 64)); else g.fillText(word, W_ / 2, H_ / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { tex: t, w: W_ / 40, h: H_ / 40, color: new THREE.Color(color) };
}

class MeshPool {
  constructor(make) { this.make = make; this.free = []; }
  take() { const m = this.free.pop() || this.make(); m.visible = true; return m; }
  give(m) { m.visible = false; this.free.push(m); }
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
class InstancePool {
  constructor(parent, geo, mat, cap) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap); this.mesh.frustumCulled = false;
    this.free = []; const white = new THREE.Color(1, 1, 1);
    for (let i = cap - 1; i >= 0; i--) { this.mesh.setMatrixAt(i, ZERO); this.mesh.setColorAt(i, white); this.free.push(i); }
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    parent.add(this.mesh);
  }
  take(matrix, color) { const i = this.free.pop(); if (i === undefined) return -1; this.mesh.setMatrixAt(i, matrix); if (color) this.mesh.setColorAt(i, color); this.dirty = true; return i; }
  set(i, matrix) { this.mesh.setMatrixAt(i, matrix); this.dirty = true; }
  give(i) { if (i < 0) return; this.mesh.setMatrixAt(i, ZERO); this.free.push(i); this.dirty = true; }
  flush() { if (!this.dirty) return; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; this.dirty = false; }
}
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();
const compose = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => M.compose(V.set(x, y, z), Q.setFromEuler(E.set(0, ry, 0)), S.set(sx, sy, sz));
const lerpC = (a, b, t, out) => out.copy(a).lerp(b, t);

export class Renderer {
  constructor(canvasParent, world, opts = {}) {
    this.world = world; this.opts = opts; this.time = 0; this.phase = 0;
    const gl = this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    gl.setPixelRatio(Math.min(devicePixelRatio, 2)); gl.setSize(innerWidth, innerHeight);
    gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.9;
    canvasParent.appendChild(gl.domElement);

    const s = this.scene = new THREE.Scene();
    this.fogDay = new THREE.Color(0.74, 0.42, 0.44); this.fogNight = new THREE.Color(0.06, 0.05, 0.11);
    s.fog = new THREE.Fog(this.fogDay.clone(), 40, 250);
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 900);
    this.camera.position.set(0, 3.6, -7.2); s.add(this.camera);

    // lights
    this.hemi = new THREE.HemisphereLight(0xb08ab0, 0x2a2416, 0.55); s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffb070, 1.1); this.sun.position.set(40, 30, 120); s.add(this.sun);
    this.fill = new THREE.DirectionalLight(0x6a80ff, 0.45); this.fill.position.set(-20, 25, -40); s.add(this.fill);
    this.flashLight = new THREE.AmbientLight(0xdde6ff, 0); s.add(this.flashLight);

    // sky & horizon
    this.sky = makeSky(); s.add(this.sky);
    this.horizon = makeHorizon(); s.add(this.horizon.group);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshBasicMaterial({ color: 0x141020 })); base.rotation.x = -Math.PI / 2; base.position.y = -0.05; s.add(base); this.base = base;

    // world root: x carries the window (saccade/tremor), z scrolls so the runner stays at the origin
    this.root = new THREE.Group(); s.add(this.root);
    this.rootX = this.targetRootX = SX * -(world.window - 1) * LANE_W; this.rootXFrom = this.rootX; this.saccadeT = 1;

    this._buildAssets();
    this.views = new Map();
    for (const c of world.pool.live) this._attachChunk(c);

    // runner
    this.foxMats = [];
    this.fox = PROPS.buildFox((hex) => { const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6 }); this.foxMats.push(m); return m; });
    s.add(this.fox.group);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })); this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.015; s.add(this.shadow);
    const foxLight = new THREE.PointLight(0x9fd8ff, 6, 6, 1.6); foxLight.position.set(0, 0.8, -0.4); this.fox.group.add(foxLight);
    this.trail = makeTrail(); this.trail.obj.frustumCulled = false; this.root.add(this.trail.obj);

    // typhoon: cloud bank descending from the top of the frame + lightning
    this.storm = new THREE.Mesh(new THREE.PlaneGeometry(80, 30), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `precision highp float; varying vec2 vUv; uniform float uTime, uFlash;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
        void main(){ float n = fbm(vUv * vec2(6.0, 3.0) + vec2(uTime * 0.08, 0.0));
          float a = smoothstep(0.05, 0.42, vUv.y + (n - 0.5) * 0.45);
          vec3 col = mix(vec3(0.02,0.02,0.045), vec3(0.09,0.085,0.13), n) + uFlash * vec3(0.45,0.5,0.7);
          gl_FragColor = vec4(col, a * 0.97); }`,
    })); this.storm.renderOrder = 10; this.storm.position.set(0, 30, -16); this.camera.add(this.storm);
    this.flash = 0; this.rumble = 0; this.roll = 0; this.shake = 0; this.lean = 0;

    // particles
    this.petals = makePetals(); this.petals.obj.frustumCulled = false; s.add(this.petals.obj);
    this.fireflies = makeFireflies(); this.fireflies.obj.frustumCulled = false; s.add(this.fireflies.obj);
    this.rain = makeRain(); this.rain.obj.frustumCulled = false; s.add(this.rain.obj);
    this.train = makeTrain(); this.root.add(this.train); this.trainTimer = 6;

    // telegraph flare (the tremor's direction) — a warm flare low on that side of the horizon
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('rgba(255,200,120,1)', 'rgba(255,120,60,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.flare.scale.set(40, 40, 1); this.flare.position.set(0, 6, 120); s.add(this.flare); this.flareT = 0; this.flareDir = 1;

    // post: bloom for neon, lanterns, coins, kitsunebi
    this.composer = new EffectComposer(gl); this.composer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.composer.addPass(new RenderPass(s, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.3, 1.0);
    if (opts.bloom !== false) this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.rivals = new Map();
    addEventListener('resize', () => this.resize());
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.gl.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); }

  // ---------------------------------------------------------------- assets
  _buildAssets() {
    const paint = PROPS.PAINT;
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    // every pooled mesh remembers its pool key so recycling is a lookup, not a search
    this.pools = {};
    const pooled = (key, geo, mat) => (this.pools[key] = new MeshPool(() => { const m = new THREE.Mesh(geo, mat); m.visible = false; m.userData.pool = key; this.root.add(m); return m; }));
    pooled('0:stalk', PROPS.stoneLantern(), paint); pooled('1:stalk', PROPS.vendingMachine('#d23b3b'), paint); pooled('1:stalk2', PROPS.vendingMachine('#2f63c9'), paint);
    pooled('0:arch', PROPS.toriiSmall(), paint); pooled('1:arch', PROPS.noren('#2f3f8f'), paint); pooled('1:arch2', PROPS.noren('#8f2f3f'), paint);
    pooled('0:drusen', PROPS.boulder(), paint); pooled('1:drusen', PROPS.barrier(), paint);
    pooled('gap', new THREE.BoxGeometry(LANE_W * 0.98, 0.08, W.GAP_DEPTH), new THREE.MeshBasicMaterial({ color: 0x030206 }));
    pooled('lumen', new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 2.8) }));
    pooled('channel', new THREE.PlaneGeometry(LANE_W * 1.1, 1), new THREE.MeshBasicMaterial({ map: radial('rgba(255,120,255,1)', 'rgba(255,120,255,0)'), color: new THREE.Color(1.0, 0.5, 1.3), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    pooled('toriiBig', PROPS.toriiBig(), paint); pooled('gantry', PROPS.gantry(), paint);
    pooled('viaduct', viaductGeo(), paint); pooled('lanternString', lanternStringGeo(), glow);
    this.mistMat = new THREE.MeshBasicMaterial({ map: radial('rgba(225,205,240,0.5)', 'rgba(225,205,240,0)'), transparent: true, depthWrite: false, opacity: 0.55 });
    pooled('mist', new THREE.PlaneGeometry(1, 1), this.mistMat);
    this.floorPool = new MeshPool(() => { const m = new THREE.Mesh(groundGeometry(), makeGroundMaterial()); m.visible = false; this.root.add(m); return m; });

    // instanced scenery
    const foliage = new THREE.ConeGeometry(1, 1, 7); foliage.translate(0, 0.5, 0);
    const trunk = new THREE.CylinderGeometry(0.13, 0.2, 1, 7); trunk.translate(0, 0.5, 0);
    this.inst = {
      cedar: new InstancePool(this.root, foliage, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), 300),
      trunk: new InstancePool(this.root, trunk, new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: 0.9 }), 340),
      sakura: new InstancePool(this.root, new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, emissive: 0xff9fc4, emissiveIntensity: 0.08 }), 96),
      lantern: new InstancePool(this.root, PROPS.stoneLantern(), paint, 40),
      lamp: new InstancePool(this.root, PROPS.lampPost(), paint, 40),
      lampGlow: new InstancePool(this.root, new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.5, 1.0) }), 40),
      coin: new InstancePool(this.root, coinGeo(), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 0.88, 0.28) }), 420),
    };
    const winTex = PROPS.windowTexture();
    this.buildingMat = new THREE.MeshStandardMaterial({ map: winTex, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: 0.6, color: 0x9aa2b8, roughness: 0.7 });
    this.buildings = [[7, 12, 7], [8, 20, 8], [6, 30, 6], [10, 42, 10]].map(([w, h, d]) => ({ w, h, d, pool: new InstancePool(this.root, PROPS.building(w, h, d), this.buildingMat, 40) }));
    // neon signs: one pool per texture
    this.neon = NEON_WORDS.map(([word, color], i) => { const n = neonTexture(word, color, i % 3 === 1); const mat = new THREE.MeshBasicMaterial({ map: n.tex, transparent: true, side: THREE.DoubleSide, color: new THREE.Color(1.5, 1.5, 1.5) });
      return { ...n, mat, pool: pooled(`neon:${i}`, new THREE.PlaneGeometry(n.w, n.h), mat) }; });
    this.coins = [];   // live coin instances for animation
  }

  // ---------------------------------------------------------------- chunks
  _attachChunk(c) {
    const biome = biomeOf(c.index); const rng = mulberry32(mixSeed(this.world.seed ^ 0x5eed, c.index));
    const floor = this.floorPool.take(); floor.position.set(0, 0, c.z0 + CHUNK_LEN / 2);
    const u = floor.material.uniforms; u.uZ0.value = c.z0; u.uBiome.value = biome;
    const v = { floor, meshes: [], inst: [], coins: [], neon: [] };
    const light = (x, z, y, i, col) => { if (v.neon.length < MAX_NEON) v.neon.push({ x, z, y, i, col }); };

    for (const cell of c.cells) {
      const x = SX * laneX(cell.lane);
      if (cell.type === 'photon') {
        const y = cell.hi ? 1.7 : 0.75; const i = this.inst.coin.take(compose(x, y, cell.z));
        const coin = { i, x, y, z: cell.z, cell }; v.coins.push(coin); this.coins.push(coin); continue;
      }
      let key = cell.type;
      if (['stalk', 'arch', 'drusen'].includes(cell.type)) { key = `${biome}:${cell.type}`; if (biome === 1 && cell.type !== 'drusen' && rng.chance(0.4)) key += '2'; }
      const m = this.pools[key].take(); m.userData.cell = cell; m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
      switch (cell.type) {
        case 'gap': m.position.set(x, 0.05, cell.z); break;
        case 'lumen': m.position.set(x, 0.9, cell.z); light(x, cell.z, 0.9, 0.8, [0.5, 2.0, 2.6]); break;
        case 'channel': m.rotation.x = -Math.PI / 2; m.scale.set(1, cell.len, 1); m.position.set(x, 0.04, cell.z + cell.len / 2); break;
        default: m.position.set(x, 0, cell.z); m.rotation.y = (rng() - 0.5) * 0.3;
      }
      v.meshes.push(m);
    }

    if (biome === 0) this._dressMountain(c, v, rng, light); else this._dressTokyo(c, v, rng, light);
    for (let i = 0; i < MAX_NEON; i++) { const n = v.neon[i]; if (n) { u.uNeon.value[i].set(n.x, n.z, n.y, n.i); u.uNeonCol.value[i].setRGB(...n.col); } }
    u.uNeonN.value = v.neon.length;
    this.views.set(c.index, v);
    for (const p of Object.values(this.inst)) p.flush(); for (const b of this.buildings) b.pool.flush();
  }

  _dressMountain(c, v, rng, light) {
    const take = (pool, mtx, col) => v.inst.push([pool, pool.take(mtx, col)]);
    const col = new THREE.Color();
    for (const s of [-1, 1]) for (let i = 0; i < 13; i++) {
      const x = s * (7.5 + rng() * 26), z = c.z0 + rng() * CHUNK_LEN, h = 7 + rng() * 8, r = 1.5 + rng() * 1.3;
      take(this.inst.cedar, compose(x, 1.2, z, r, h, r), col.setRGB(0.03 + rng() * 0.04, 0.11 + rng() * 0.1, 0.05 + rng() * 0.04));
      take(this.inst.trunk, compose(x, 0, z, 1.6, 1.9, 1.6));
    }
    for (let i = 0; i < 2 + (rng() < 0.5 ? 1 : 0); i++) {
      const s = rng() < 0.5 ? -1 : 1, x = s * (6.9 + rng() * 5), z = c.z0 + 4 + rng() * 28, r = 1.5 + rng() * 0.7;
      take(this.inst.sakura, compose(x, 2.6, z, r, r * 0.9, r), col.setRGB(1.0, 0.62 + rng() * 0.12, 0.78));
      take(this.inst.sakura, compose(x + 0.9, 2.1, z + 0.5, r * 0.7, r * 0.6, r * 0.7), col.setRGB(1.0, 0.68, 0.8));
      take(this.inst.trunk, compose(x, 0, z, 1.2, 2.3, 1.2));
    }
    for (const [x, z] of [[-6.4, c.z0 + 8], [6.4, c.z0 + 26]]) { take(this.inst.lantern, compose(x, 0, z, 1, 1, 1, x < 0 ? 0.3 : -0.3)); light(x, z, 1.6, 0.7, [1.0, 0.8, 0.5]); }
    const ls = this.pools.lanternString.take(); ls.position.set(0, 3.4, c.z0 + 18); v.meshes.push(ls); light(0, c.z0 + 18, 3.4, 1.0, [1.0, 0.75, 0.45]);
    for (let i = 0; i < 2; i++) { const m = this.pools.mist.take(); m.rotation.set(-Math.PI / 2, 0, 0); m.scale.set(50 + rng() * 30, 12 + rng() * 8, 1); m.position.set((rng() - 0.5) * 24, 0.5 + rng() * 0.8, c.z0 + rng() * CHUNK_LEN); v.meshes.push(m); }
    if (c.index % 10 === 0) { const t = this.pools.toriiBig.take(); t.position.set(0, 0, c.z0 + 2); t.rotation.set(0, 0, 0); v.meshes.push(t); }
  }

  _dressTokyo(c, v, rng, light) {
    const take = (pool, mtx, col) => v.inst.push([pool, pool.take(mtx, col)]);
    const col = new THREE.Color(); const tints = [[0.55, 0.6, 0.8], [0.7, 0.62, 0.6], [0.5, 0.55, 0.65], [0.75, 0.7, 0.62], [0.45, 0.5, 0.7]];
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
      const b = this.buildings[Math.floor(rng() * this.buildings.length)];
      const x = s * (9.6 + b.d / 2 + rng() * 4), z = c.z0 + i * 7.4 + rng() * 2;
      take(b.pool, compose(x, 0, z), col.setRGB(...tints[Math.floor(rng() * tints.length)]));
      if (rng() < 0.6) { const b2 = this.buildings[Math.floor(rng() * 3)]; take(b2.pool, compose(x + s * (b.d / 2 + b2.d / 2 + 2 + rng() * 6), 0, z + rng() * 4), col.setRGB(...tints[Math.floor(rng() * tints.length)])); }
    }
    for (let i = 0; i < 6; i++) {
      const s = i % 2 ? 1 : -1, n = this.neon[Math.floor(rng() * this.neon.length)];
      const m = n.pool.take(); const y = 2.6 + rng() * 8.5, z = c.z0 + 2 + rng() * 32;
      m.position.set(s * 9.2, y, z); m.rotation.set(0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0); v.meshes.push(m);
      light(s * 9.2, z, y, 1.0, [n.color.r, n.color.g, n.color.b]);
    }
    for (const [x, z] of [[-6.6, c.z0 + 5], [6.6, c.z0 + 23]]) {
      take(this.inst.lamp, compose(x, 0, z, 1, 1, 1, x < 0 ? 0 : Math.PI));
      take(this.inst.lampGlow, compose(x < 0 ? x + 1 : x - 1, 4.95, z));
      light(x < 0 ? x + 1 : x - 1, z, 4.95, 0.45, [1.0, 0.85, 0.6]);
    }
    const vd = this.pools.viaduct.take(); vd.position.set(SX * 16, 0, c.z0 + CHUNK_LEN / 2); v.meshes.push(vd);
    if (c.index % 10 === 0) { const g = this.pools.gantry.take(); g.position.set(0, 0, c.z0 + 2); v.meshes.push(g); }
  }

  _detachChunk(c) {
    const v = this.views.get(c.index); if (!v) return;
    this.floorPool.give(v.floor);
    for (const m of v.meshes) this.pools[m.userData.pool].give(m);
    for (const [pool, i] of v.inst) pool.give(i);
    for (const coin of v.coins) { this.inst.coin.give(coin.i); const k = this.coins.indexOf(coin); if (k >= 0) this.coins.splice(k, 1); }
    this.views.delete(c.index);
    for (const p of Object.values(this.inst)) p.flush(); for (const b of this.buildings) b.pool.flush();
  }

  /** Swap to a fresh world (restart) without reallocating anything. */
  reset(world) {
    this.world = world;
    for (const k of [...this.views.keys()]) this._detachChunk({ index: k });
    for (const c of world.pool.live) this._attachChunk(c);
    this.rootX = this.targetRootX = SX * -(world.window - 1) * LANE_W; this.saccadeT = 1; this.train.visible = false; this.trainTimer = 6;
  }

  /** Sim events → visual reactions. */
  onEvent(e) {
    switch (e.type) {
      case 'recycle': this._detachChunk(e.old); this._attachChunk(e.fresh); break;
      case 'saccade.telegraph': this.flareDir = e.dir; this.flareT = 1; this.rumble = 1; break;
      case 'saccade': this.rootXFrom = this.rootX; this.targetRootX = SX * -(e.window - 1) * LANE_W; this.saccadeT = 0; this.roll = -e.dir * 0.08; this.flareT = 0; this.rumble = 0; this.shake = Math.max(this.shake, 0.6); break;
      case 'photon': { const coin = this.coins.find(k => k.cell === e.cell); if (coin) { this.inst.coin.give(coin.i); coin.i = -1; } break; }
      case 'lumen': { for (const v of this.views.values()) for (const m of v.meshes) if (m.userData.cell === e.cell) m.visible = false; break; }
      case 'stumble': this.shake = 0.6; this.hurt = 0.6; break;
      case 'death': this.shake = 1.4; this.hurt = 2; break;
    }
  }

  rivalHint(id, h) {
    let r = this.rivals.get(id);
    if (!r) {
      const fox = PROPS.buildFox((hex) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).lerp(new THREE.Color(0.5, 1.6, 2.2), 0.7), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.root.add(fox.group); r = { fox, from: { ...h }, to: { ...h }, t: 1 }; this.rivals.set(id, r);
    }
    r.from = { z: r.fox.group.position.z, y: r.fox.group.position.y, lane: h.lane }; r.to = { ...h }; r.t = 0;
  }
  rivalLeave(id) { const r = this.rivals.get(id); if (r) { this.root.remove(r.fox.group); this.rivals.delete(id); } }

  // ---------------------------------------------------------------- frame
  render(dt) {
    const w = this.world, p = w.player; this.time += dt;
    const dusk = Math.min(1, p.distance / 1500);            // the sun sets over the first 1.5 km
    const biome = biomeOf(Math.floor(p.z / CHUNK_LEN));
    const dread = 1 - Math.max(0, w.blink) / W.BLINK_MAX;

    // window slide (tremor): the world moves, the fox doesn't
    if (this.saccadeT < 1) {
      this.saccadeT = Math.min(1, this.saccadeT + dt / (this.opts.reducedMotion ? 0.001 : 0.25));
      const t = this.saccadeT, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.rootX = this.rootXFrom + (this.targetRootX - this.rootXFrom) * e;
    }
    this.root.position.x = this.rootX; this.root.position.z = -p.z;

    // ---- fox
    const px = SX * (p.xLane - 1) * LANE_W, slide = p.action === 'slide', air = !p.grounded;
    const f = this.fox; f.group.position.set(px, p.y, 0);
    const laneVel = (px - (this.prevPx ?? px)) / Math.max(dt, 1e-3); this.prevPx = px;
    this.lean += ((-laneVel * 0.045) - this.lean) * Math.min(1, dt * 10);
    if (p.alive) this.phase += dt * Math.max(6, p.speed * 1.55);
    f.legs.forEach((l, i) => { l.rotation.x = air ? 0.9 : Math.sin(this.phase + (i % 2 ? Math.PI : 0) + (i >= 2 ? Math.PI * 0.5 : 0)) * 0.95; });
    f.tail.rotation.z = Math.sin(this.phase * 0.5) * 0.3; f.tail.rotation.x = air ? -0.5 : 0;
    f.group.scale.set(1, slide ? 0.55 : 1, slide ? 1.25 : 1);
    f.group.rotation.set(slide ? 0.25 : air ? -0.25 : 0, laneVel * 0.06, this.lean);
    f.group.position.y += p.grounded && !slide ? 0.035 * Math.abs(Math.sin(this.phase)) : 0;
    this.hurt = Math.max(0, (this.hurt || 0) - dt);
    const hurtGlow = this.hurt > 0 ? 0.5 + 0.5 * Math.sin(this.time * 40) : 0;
    for (const m of this.foxMats) m.emissive.setRGB(hurtGlow, hurtGlow * 0.1, 0);
    this.shadow.position.set(px, 0.015, 0); const sh = Math.max(0.3, 1 - p.y * 0.3); this.shadow.scale.set(sh, sh, 1); this.shadow.material.opacity = 0.45 * sh;
    this.trail.emit(px - this.rootX, p.y, p.z, dt, p.alive && (p.speed > 1));

    // ---- camera
    const cam = this.camera;
    const targetFov = 62 + 14 * ((p.speed - 11) / 13);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix();
    cam.position.x += (px * 0.45 - cam.position.x) * Math.min(1, dt * 8);
    cam.position.y += (3.6 + p.y * 0.35 - cam.position.y) * Math.min(1, dt * 6);
    this.roll *= Math.exp(-dt * 6); this.shake *= Math.exp(-dt * 5);
    const rumble = this.rumble > 0 ? (this.rumble = Math.max(0, this.rumble - dt * 2.2), 0.6 * (1 - this.rumble)) : 0;
    const jitter = (this.shake + rumble) * 0.035;
    cam.lookAt(px * 0.3 + jitter * 6 * Math.sin(this.time * 53), 1.0 + jitter * 4 * Math.sin(this.time * 71), 18);
    cam.rotateZ(this.roll + this.lean * 0.6 + jitter * Math.sin(this.time * 67));

    // ---- time of day
    const night = dusk;
    this.sky.material.uniforms.uNight.value = night; this.sky.material.uniforms.uTime.value = this.time;
    this.sky.material.uniforms.uSun.value.set(0.25, 0.14 - 0.3 * night, 1);
    this.horizon.sun.position.y = 44 - 90 * night; this.horizon.sun.material.opacity = 1 - night;
    this.scene.fog.color.copy(this.fogDay).lerp(this.fogNight, night);
    this.horizon.fuji.material.color.setRGB(0.23, 0.17, 0.30).lerp(new THREE.Color(0.05, 0.045, 0.09), night);
    this.horizon.snow.material.color.setRGB(0.95, 0.89, 0.93).lerp(new THREE.Color(0.55, 0.55, 0.7), night);
    this.horizon.ridges.forEach((r, i) => r.material.color.setRGB(0.2 - i * 0.04, 0.15 - i * 0.03, 0.29 - i * 0.05).lerp(new THREE.Color(0.03, 0.03, 0.06), night));
    this.horizon.beacon.material.color.setRGB(4, 0.4, 0.3).multiplyScalar(0.5 + 0.5 * Math.round(Math.sin(this.time * 2) * 0.5 + 0.5));
    this.sun.intensity = 1.1 - 0.9 * night; this.sun.color.setRGB(1.0, 0.69, 0.44).lerp(new THREE.Color(0.42, 0.5, 0.82), night);
    this.hemi.intensity = 0.55 - 0.25 * night; this.hemi.color.setRGB(0.69, 0.54, 0.69).lerp(new THREE.Color(0.16, 0.18, 0.35), night);
    this.buildingMat.emissiveIntensity = 0.5 + 1.1 * night;
    for (const n of this.neon) n.mat.color.setScalar(1.3 + 0.9 * night);
    this.base.material.color.setRGB(0.08, 0.06, 0.12).lerp(new THREE.Color(0.02, 0.02, 0.04), night);
    this.mistMat.opacity = 0.55 - 0.42 * night;
    for (const v of this.views.values()) { const u = v.floor.material.uniforms; u.uTime.value = this.time; u.uNight.value = night; }

    // ---- typhoon
    this.storm.position.y = 30 - dread * 23 + (p.alive ? 0 : -8);
    this.storm.material.uniforms.uTime.value = this.time;
    if (dread > 0.45 && Math.random() < dt * (0.12 + dread * 0.5)) this.flash = 1;
    this.flash *= Math.exp(-dt * 12); this.storm.material.uniforms.uFlash.value = this.flash; this.flashLight.intensity = this.flash * 2.5;
    this.rain.update(dt, p.speed, Math.max(0, (dread - 0.3) / 0.6));

    // ---- particles & set-dressing
    this.petals.update(dt, p.speed, this.time); this.petals.obj.material.opacity += ((biome === 0 ? 0.95 : 0) - this.petals.obj.material.opacity) * Math.min(1, dt * 1.5);
    this.fireflies.update(dt, p.speed, this.time); this.fireflies.obj.material.opacity += ((biome === 0 ? 0.6 + 0.4 * night : 0) - this.fireflies.obj.material.opacity) * Math.min(1, dt * 1.5);
    const spin = this.time * 3;
    for (const c of this.coins) if (c.i >= 0) this.inst.coin.set(c.i, M.compose(V.set(c.x, c.y + 0.08 * Math.sin(this.time * 4 + c.z), c.z), Q.setFromEuler(E.set(0, spin + c.z, 0)), S.set(1, 1, 1)));
    this.inst.coin.flush();
    for (const v of this.views.values()) for (const m of v.meshes) if (m.userData.cell?.type === 'lumen') { m.rotation.y += dt * 2; m.position.y = 0.9 + 0.1 * Math.sin(this.time * 3); }
    // shinkansen
    if (this.train.visible) { this.train.position.z -= 62 * dt; if (this.train.position.z < p.z - 70) this.train.visible = false; }
    else if (biome === 1 && (this.trainTimer -= dt) <= 0) { this.trainTimer = 9 + Math.random() * 8; this.train.visible = true; this.train.position.set(SX * 16, 6.6, p.z + 230); }

    // ---- tremor telegraph flare
    if (this.flareT > 0) { this.flare.material.opacity = 0.8 * this.flareT; this.flare.position.x = SX * this.flareDir * 30; this.flareT = Math.max(0, this.flareT - dt * 0.2); } else this.flare.material.opacity = 0;

    // ---- rivals
    for (const r of this.rivals.values()) {
      r.t = Math.min(1, r.t + dt * 10);
      r.fox.group.position.set(SX * laneX(r.to.lane), r.from.y + (r.to.y - r.from.y) * r.t, r.from.z + (r.to.z - r.from.z) * r.t);
      r.fox.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.time * 18 + (i % 2 ? Math.PI : 0)) * 0.9; });
    }
    this.composer.render();
  }
}

// ---- local geometry helpers ------------------------------------------------
function coinGeo() { const g = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 14); g.rotateX(Math.PI / 2); return g; }
function viaductGeo() {
  const parts = []; const paintPart = (geo, color, p) => { geo.translate(...p); const c = new THREE.Color(color); const n = geo.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(geo); };
  paintPart(new THREE.BoxGeometry(4.2, 1.0, CHUNK_LEN), '#6f747c', [0, 5.6, 0]);
  paintPart(new THREE.BoxGeometry(4.6, 0.5, CHUNK_LEN), '#8a9099', [0, 5.1, 0]);
  for (const z of [-12, 0, 12]) paintPart(new THREE.BoxGeometry(1.1, 5, 1.1), '#5b6068', [0, 2.5, z]);
  return mergeVC(parts);
}
function lanternStringGeo() {
  const parts = []; const paintPart = (geo, color, p) => { geo.translate(...p); const n = geo.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = color[0]; a[i * 3 + 1] = color[1]; a[i * 3 + 2] = color[2]; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(geo); };
  paintPart(new THREE.BoxGeometry(14, 0.04, 0.04), [0.05, 0.04, 0.04], [0, 0, 0]);
  for (let x = -5; x <= 5; x += 2) { paintPart(new THREE.SphereGeometry(0.34, 10, 8), [2.6, 1.3, 0.45], [x, -0.55, 0]); paintPart(new THREE.BoxGeometry(0.02, 0.3, 0.02), [0.05, 0.04, 0.04], [x, -0.2, 0]); }
  return mergeVC(parts);
}
function mergeVC(parts) { for (const g of parts) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k); return mergeGeometries(parts, false); }
