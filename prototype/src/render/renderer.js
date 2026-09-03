// Three.js view of the sim. Owns pooled meshes; never mutates the sim.
import * as THREE from 'three';
import { LANES, LANE_W, CHUNK_LEN, laneX } from '../core/chunks.js';
import { W } from '../core/world.js';

const COLORS = {
  bg: 0x12040a, fog: 0x1a0509, floor: 0x2a0a12, vein: 0x7a1b2a,
  stalk: 0xe8d5c4, arch: 0xc4262f, drusen: 0xe3c04c, gap: 0x050203,
  photon: 0xffc86b, lumen: 0x7ef0ff, channel: 0xff9c8a, player: 0xfff2dc, rival: 0x7ef0ff,
};

const floorVert = /* glsl */`
  varying vec2 vXZ; varying float vTrack; uniform float uZ0;
  void main() { vXZ = vec2(position.x, position.z); vTrack = uZ0 + ${CHUNK_LEN.toFixed(1)} * 0.5 + position.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const floorFrag = /* glsl */`
  precision highp float; varying vec2 vXZ; varying float vTrack;
  uniform float uTime; uniform vec3 uBase; uniform vec3 uVein; uniform float uPulse; uniform float uHalfW;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
  void main() {
    vec2 p = vec2(vXZ.x, vTrack);
    float n = fbm(p * 0.13 + vec2(0.0, uTime * 0.02));
    float veins = smoothstep(0.035, 0.0, abs(n - 0.5)) * 0.9;
    float n2 = fbm(p * 0.31 + 7.3);
    veins += smoothstep(0.02, 0.0, abs(n2 - 0.5)) * 0.45;
    // photoreceptor dot grid
    vec2 g = fract(p * vec2(1.6, 1.6)) - 0.5; float dots = smoothstep(0.18, 0.05, length(g)) * 0.12;
    // lane guides pulse to the beat
    float lane = abs(fract(vXZ.x / ${LANE_W.toFixed(2)} + 0.5) - 0.5);
    float guide = smoothstep(0.035, 0.0, lane) * (0.25 + 0.25 * uPulse);
    vec3 col = mix(uBase, uVein, veins) + dots * vec3(1.0, 0.6, 0.5) + guide * vec3(1.0, 0.75, 0.45) * 0.5;
    float edge = smoothstep(uHalfW, uHalfW - 2.5, abs(vXZ.x));
    gl_FragColor = vec4(col * (0.35 + 0.65 * edge), 1.0);
  }`;

const blinkFrag = /* glsl */`
  precision highp float; varying vec2 vUv; uniform float uTime;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    float lash = 0.06 * sin(vUv.x * 40.0 + uTime * 2.0) + 0.03 * hash(vec2(floor(vUv.x * 60.0), floor(uTime * 3.0)));
    float a = smoothstep(0.02 + lash, 0.3, vUv.y);      // soft lower edge = the lash line
    gl_FragColor = vec4(0.03, 0.0, 0.015, a * 0.97);
  }`;

function radialTexture(inner = 'rgba(255,200,120,1)', outer = 'rgba(255,120,60,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, inner); r.addColorStop(1, outer); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class MeshPool {
  constructor(make) { this.make = make; this.free = []; }
  take() { return this.free.pop() || this.make(); }
  give(m) { m.visible = false; this.free.push(m); }
}

export class Renderer {
  constructor(canvasParent, world, opts = {}) {
    this.world = world;
    this.opts = opts;
    this.time = 0;
    const r = this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
    canvasParent.appendChild(r.domElement);

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(COLORS.bg);
    s.fog = new THREE.Fog(COLORS.fog, 40, 120);
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 300);
    this.camera.position.set(0, 3.4, -6.5);

    s.add(new THREE.HemisphereLight(0xffb08a, 0x2a0610, 0.9));
    const key = new THREE.DirectionalLight(0xffd9b0, 1.4); key.position.set(3, 8, 10); s.add(key);
    const horizon = new THREE.PointLight(0xffa060, 60, 120, 1.6); horizon.position.set(0, 6, 60); s.add(horizon);
    this.horizonLight = horizon;

    // world root: x carries the saccade window, z scrolls the track so the runner stays at the origin
    this.root = new THREE.Group(); s.add(this.root);
    this.rootX = this.targetRootX = -(world.window - 1) * LANE_W; this.rootXFrom = this.rootX; this.saccadeT = 1;

    this._buildPools();
    this.views = new Map();   // chunk index -> { floor, meshes[] }
    for (const c of world.pool.live) this._attachChunk(c);

    // runner
    this.player = new THREE.Group(); s.add(this.player);
    const pm = new THREE.MeshStandardMaterial({ color: COLORS.player, emissive: 0xffb070, emissiveIntensity: 0.9, roughness: 0.3 });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), pm); this.body.position.y = 0.55; this.player.add(this.body);
    this.tail = [];
    for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.SphereGeometry(0.3 - i * 0.045, 12, 8), pm); this.player.add(t); this.tail.push(t); }
    const pl = new THREE.PointLight(0xffc080, 18, 12, 1.8); pl.position.y = 1; this.player.add(pl);
    this.tailHist = [];

    // the Blink: the Sleeper's eyelid, closing down from the top of the frame as the margin shrinks
    s.add(this.camera);
    this.lid = new THREE.Mesh(new THREE.PlaneGeometry(60, 26), new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}',
      fragmentShader: blinkFrag, uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, depthTest: false,
    }));
    this.lid.renderOrder = 10; this.lid.position.set(0, 26, -14); this.camera.add(this.lid);

    // saccade telegraph: iris flare on the horizon
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.flare.scale.set(30, 30, 1); this.flare.position.set(0, 8, 95); s.add(this.flare);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,150,90,0.55)', 'rgba(255,90,40,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.glow.scale.set(90, 60, 1); this.glow.position.set(0, 10, 110); s.add(this.glow);

    this.rivals = new Map();  // id -> { mesh, from, to, t }
    this.roll = 0; this.shake = 0;
    addEventListener('resize', () => this.resize());
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.gl.setSize(innerWidth, innerHeight); }

  _buildPools() {
    const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...extra });
    const geo = {
      stalk: new THREE.CapsuleGeometry(0.36, 2.4, 6, 12),
      arch: new THREE.TorusGeometry(1.05, 0.2, 8, 18, Math.PI),
      drusen: new THREE.SphereGeometry(0.95, 18, 10),
      gap: new THREE.BoxGeometry(LANE_W * 0.98, 0.06, W.GAP_DEPTH),
      photon: new THREE.SphereGeometry(0.2, 10, 8),
      lumen: new THREE.IcosahedronGeometry(0.34, 0),
      channel: new THREE.PlaneGeometry(LANE_W * 0.9, 1),
    };
    const mat = {
      stalk: std(COLORS.stalk, { emissive: 0xffe0c0, emissiveIntensity: 0.12, roughness: 0.35 }),
      arch: std(COLORS.arch, { emissive: 0x6a0a12, emissiveIntensity: 0.6, roughness: 0.3 }),
      drusen: std(COLORS.drusen, { emissive: 0x6b5010, emissiveIntensity: 0.35, roughness: 0.25 }),
      gap: new THREE.MeshBasicMaterial({ color: COLORS.gap }),
      photon: new THREE.MeshBasicMaterial({ color: COLORS.photon }),
      lumen: new THREE.MeshBasicMaterial({ color: COLORS.lumen }),
      channel: new THREE.MeshBasicMaterial({ color: COLORS.channel, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    this.pools = {};
    for (const k of Object.keys(geo)) {
      this.pools[k] = new MeshPool(() => { const m = new THREE.Mesh(geo[k], mat[k]); m.visible = false; this.root.add(m); return m; });
    }
    const floorGeo = new THREE.PlaneGeometry(LANES * LANE_W + 6, CHUNK_LEN); floorGeo.rotateX(-Math.PI / 2);
    this.floorPool = new MeshPool(() => {
      const m = new THREE.Mesh(floorGeo, new THREE.ShaderMaterial({ vertexShader: floorVert, fragmentShader: floorFrag, uniforms: {
        uZ0: { value: 0 }, uTime: { value: 0 }, uPulse: { value: 0 }, uHalfW: { value: (LANES * LANE_W + 6) / 2 },
        uBase: { value: new THREE.Color(COLORS.floor) }, uVein: { value: new THREE.Color(COLORS.vein) } } }));
      m.visible = false; this.root.add(m); return m;
    });
  }

  _attachChunk(c) {
    const floor = this.floorPool.take();
    floor.visible = true; floor.position.set(0, 0, c.z0 + CHUNK_LEN / 2); floor.material.uniforms.uZ0.value = c.z0;
    const meshes = [];
    for (const cell of c.cells) {
      const m = this.pools[cell.type].take();
      m.visible = true; m.userData.cell = cell; m.userData.chunk = c.index;
      const x = laneX(cell.lane);
      m.scale.set(1, 1, 1); m.rotation.set(0, 0, 0);
      switch (cell.type) {
        case 'stalk': m.position.set(x, 1.55, cell.z); break;
        case 'arch': m.position.set(x, 0.05, cell.z); m.rotation.y = Math.PI / 2; m.scale.set(1, 0.95, 1); break;
        case 'drusen': m.position.set(x, 0.05, cell.z); m.scale.set(1, 0.42, 1); break;
        case 'gap': m.position.set(x, 0.04, cell.z); break;
        case 'photon': m.position.set(x, cell.hi ? 1.6 : 0.7, cell.z); break;
        case 'lumen': m.position.set(x, 0.9, cell.z); break;
        case 'channel': m.rotation.x = -Math.PI / 2; m.scale.set(1, cell.len, 1); m.position.set(x, 0.03, cell.z + cell.len / 2); break;
      }
      meshes.push(m);
    }
    this.views.set(c.index, { floor, meshes });
  }

  _detachChunk(c) {
    const v = this.views.get(c.index); if (!v) return;
    this.floorPool.give(v.floor);
    for (const m of v.meshes) this.pools[m.userData.cell.type].give(m);
    this.views.delete(c.index);
  }

  /** Sim events → visual reactions. */
  onEvent(e) {
    switch (e.type) {
      case 'recycle': this._detachChunk(e.old); this._attachChunk(e.fresh); break;
      case 'saccade.telegraph': this.flareDir = e.dir; this.flareT = 1; break;
      case 'saccade': this.rootXFrom = this.rootX; this.targetRootX = -(e.window - 1) * LANE_W; this.saccadeT = 0; this.roll = -e.dir * 0.07; this.flareT = 0; break;
      case 'photon': case 'lumen': { const v = this.views.get(this._chunkOf(e.cell)); if (v) for (const m of v.meshes) if (m.userData.cell === e.cell) m.visible = false; break; }
      case 'stumble': this.shake = 0.5; break;
      case 'death': this.shake = 1.2; break;
    }
  }
  _chunkOf(cell) { return Math.floor(cell.z / CHUNK_LEN); }

  /** Rival afterimage from a network hint. */
  rivalHint(id, h) {
    let r = this.rivals.get(id);
    if (!r) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshBasicMaterial({ color: COLORS.rival, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.root.add(m); r = { mesh: m, from: { ...h }, to: { ...h }, t: 1 }; this.rivals.set(id, r);
    }
    r.from = { z: r.mesh.position.z, y: r.mesh.position.y - 0.55, lane: h.lane }; r.to = { ...h }; r.t = 0;
  }
  rivalLeave(id) { const r = this.rivals.get(id); if (r) { this.root.remove(r.mesh); this.rivals.delete(id); } }

  /** alpha = fraction of the next sim tick elapsed (for smooth motion). */
  render(dt, alpha = 0) {
    const w = this.world, p = w.player;
    this.time += dt;

    // saccade: the world slides, the runner doesn't
    if (this.saccadeT < 1) {
      this.saccadeT = Math.min(1, this.saccadeT + dt / (this.opts.reducedMotion ? 0.001 : 0.25));
      const t = this.saccadeT, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.rootX = this.rootXFrom + (this.targetRootX - this.rootXFrom) * e;
    }
    this.root.position.x = this.rootX;
    this.root.position.z = -p.z;

    // runner
    const px = (p.xLane - 1) * LANE_W;
    this.player.position.set(px, p.y, 0);
    const slide = p.action === 'slide';
    this.body.scale.set(slide ? 1.25 : 1, slide ? 0.45 : 1, slide ? 1.25 : 1);
    this.body.position.y = slide ? 0.3 : 0.55;
    this.body.rotation.x += dt * (p.speed * 0.4);
    this.tailHist.unshift({ x: px, y: p.y + (slide ? 0.3 : 0.55) }); if (this.tailHist.length > 40) this.tailHist.pop();
    this.tail.forEach((t, i) => { const h = this.tailHist[Math.min(this.tailHist.length - 1, (i + 1) * 4)]; t.position.set(h.x - px, h.y - p.y, -(i + 1) * 0.55); });
    if (p.stumbleT > 0) this.body.material.emissiveIntensity = 0.3 + 0.7 * Math.abs(Math.sin(this.time * 30)); else this.body.material.emissiveIntensity = 0.9;

    // camera: soft follow, FOV widens with speed, roll/shake on saccade & stumble
    const cam = this.camera;
    const targetFov = 60 + 14 * ((p.speed - 11) / 13);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix();
    cam.position.x += (px * 0.45 - cam.position.x) * Math.min(1, dt * 8);
    cam.position.y += (3.4 + p.y * 0.35 - cam.position.y) * Math.min(1, dt * 6);
    this.roll *= Math.exp(-dt * 6); this.shake *= Math.exp(-dt * 5);
    cam.lookAt(px * 0.3 + this.shake * 0.3 * Math.sin(this.time * 53), 1.1, 14);
    cam.rotateZ(this.roll + this.shake * 0.02 * Math.sin(this.time * 70));   // roll after lookAt or it is overwritten

    // the Blink: the lid descends as the margin shrinks (fully open at BLINK_MAX, covers the frame at 0)
    const dread = 1 - Math.max(0, w.blink) / W.BLINK_MAX;
    this.lid.material.uniforms.uTime.value = this.time;
    this.lid.position.y = 20 - dread * 24 + (w.player.alive ? 0 : -6);

    // telegraph: flare toward the direction the world will move (the eye "looks" that way)
    if (this.flareT > 0) {
      this.flare.material.opacity = 0.9 * this.flareT; this.flare.position.x = this.flareDir * 14; this.flareT = Math.max(0, this.flareT - dt * 0.15);
    } else this.flare.material.opacity = 0;
    this.glow.material.opacity = 0.35 + 0.15 * Math.sin(this.time * 0.8);
    this.horizonLight.intensity = 50 + 30 * (w.blink / W.BLINK_MAX);

    // floors: time + beat pulse
    const pulse = 0.5 + 0.5 * Math.sin((p.z / 6) * Math.PI * 2);
    for (const v of this.views.values()) { v.floor.material.uniforms.uTime.value = this.time; v.floor.material.uniforms.uPulse.value = pulse; }
    // photons bob
    for (const v of this.views.values()) for (const m of v.meshes) {
      const c = m.userData.cell;
      if (c.type === 'photon') m.position.y = (c.hi ? 1.6 : 0.7) + 0.08 * Math.sin(this.time * 4 + c.z);
      else if (c.type === 'lumen') m.rotation.y += dt * 2;
    }
    // rivals: interpolate 100 ms behind the newest hint
    for (const r of this.rivals.values()) {
      r.t = Math.min(1, r.t + dt * 10);
      r.mesh.position.set(laneX(r.to.lane), 0.55 + r.from.y + (r.to.y - r.from.y) * r.t, r.from.z + (r.to.z - r.from.z) * r.t);
    }
    this.gl.render(this.scene, cam);
  }
}
