// Three.js view of the sim — KITSUNE. Composes sky/theme, ground, scenery,
// vegetation, particles and props (see docs/RENDER_API.md). Owns pools,
// cameras, lights, the mirror stage, chunk attach/detach and post-processing.
// Never mutates the sim.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LANE_W, LANES, TRACK_W, CHUNK_LEN, BIOMES, SEASON_LEN, KAIJU, roadX, trackX, cellX, biomeOf, seasonOf, rollerLaneAt } from '../core/chunks.js';
import { mulberry32, mixSeed } from '../core/rng.js';
import { W } from '../core/world.js';
import { P } from '../core/player.js';
import { MeshPool, InstancePool, compose, radial, canvasTexture, lerp, clamp01, paint, merge, box, cyl, cone, sph, GLOW, TRACK, placeMesh } from './common.js';
import { Track } from './track.js';
import { buildObstacles, buildPowers, coinGeometry } from './props.js';
import { buildCharacter, characterById } from './characters.js';
import { getTheme } from './theme.js';
import { makeSky } from './sky.js';
import { makeGroundMaterial, GROUND_W, MAX_LIGHTS } from './ground.js';
import { makeGrass, makeFlowers } from './vegetation.js';
import { makeParticles, makeTrail, makeTrain, makeShockRing } from './fx.js';
import { buildScenery } from './scenery.js';

/** Golden hour ↔ night, one full cycle every 3.6 km (starts at golden hour). */
export const nightAt = (distance) => 0.5 - 0.5 * Math.cos((2 * Math.PI * distance) / 3600);
/** Snow cover for a chunk: full in winter, fading over the first two chunks of spring, building over the first two of winter. */
export function snowAt(index) {
  const s = seasonOf(index), k = index % SEASON_LEN;
  if (s === 3) return Math.min(1, (k + 1) / 2);
  if (s === 0 && index >= SEASON_LEN) return Math.max(0, 1 - k / 2);   // the very first spring has no winter behind it
  return 0;
}

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uVibrance: { value: 0.14 }, uLift: { value: new THREE.Vector3(0.012, 0.014, 0.03) }, uVignette: { value: 0.28 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVibrance, uVignette; uniform vec3 uLift; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
      c.rgb = mix(vec3(l), c.rgb, 1.0 + uVibrance * (1.0 - sat));          // vibrance: push muted colours more than saturated ones
      c.rgb += uLift * (1.0 - l);                                           // lift the shadows toward blue (anime, never black)
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - uVignette * dot(d, d) * 2.0;
      gl_FragColor = c; }`,
};

function neonTexture(word, color, vertical) {
  const W_ = vertical ? 96 : 320, H_ = vertical ? 64 * word.length + 40 : 112;
  return canvasTexture(W_, H_, (g, w, h) => {
    g.fillStyle = 'rgba(8,8,18,0.88)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 6; g.shadowColor = color; g.shadowBlur = 18; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowBlur = 24;
    g.font = `bold ${vertical ? 52 : 64}px "Noto Sans JP", "IPAGothic", "Hiragino Sans", "Yu Gothic", sans-serif`;
    if (vertical) [...word].forEach((ch, i) => g.fillText(ch, w / 2, 42 + i * 64)); else g.fillText(word, w / 2, h / 2 + 2);
  });
}

/** A kaiju built from primitives, ~30 m tall, throwing arm on local -x (toward the road when it stands on the +x side). */
function kaijuRig(k) {
  const g = new THREE.Group(); const mat = (c, e = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, emissive: c, emissiveIntensity: e });
  const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(...k.color).multiplyScalar(3) });
  const add = (geo, m, p, r = [0, 0, 0], parent = g) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(...p); mesh.rotation.set(...r); parent.add(mesh); return mesh; };
  const arm = new THREE.Group(); g.add(arm);
  const eyes = (y, z, r, dx) => { add(new THREE.SphereGeometry(r, 8, 8), eye, [-dx, y, z]); add(new THREE.SphereGeometry(r, 8, 8), eye, [dx, y, z]); };
  switch (k.id) {
    case 'daidarabotchi': { const body = mat(0x4a4030), moss = mat(0x3f5a2e);
      add(new THREE.BoxGeometry(11, 15, 8), body, [0, 17.5, 0]); add(new THREE.SphereGeometry(4.6, 10, 8), body, [0, 28, 0]); add(new THREE.SphereGeometry(4.9, 10, 8), moss, [0, 29.4, 0.6]);
      add(new THREE.CylinderGeometry(2.3, 2.7, 10, 8), body, [-3.3, 5, 0]); add(new THREE.CylinderGeometry(2.3, 2.7, 10, 8), body, [3.3, 5, 0]);
      add(new THREE.CylinderGeometry(1.6, 1.4, 12, 8), body, [7, 16, 0]);
      arm.position.set(-6.8, 23, 0); add(new THREE.CylinderGeometry(1.7, 1.4, 12, 8), body, [0, -6, 0], [0, 0, 0], arm); add(new THREE.DodecahedronGeometry(2.4, 0), mat(0x6e7264), [0, -12.5, 0], [0, 0, 0], arm);
      eyes(28.4, -4.1, 0.7, 1.5); break; }
    case 'umibozu': { const body = mat(0x0b0f1a), rim = mat(0x1a2a44, 0.4);
      add(new THREE.ConeGeometry(10.5, 24, 14), body, [0, 12, 0]); add(new THREE.SphereGeometry(8.5, 14, 12), body, [0, 29, 0]);
      add(new THREE.TorusGeometry(10.5, 0.7, 6, 20), rim, [0, 0.6, 0], [Math.PI / 2, 0, 0]);
      arm.position.set(-9.5, 20, 0); add(new THREE.CylinderGeometry(1.5, 1.2, 14, 8), body, [0, -7, 0], [0, 0, 0], arm);
      eyes(30, -7.4, 1.5, 2.8); break; }
    case 'gashadokuro': { const bone = mat(0xe8e0cc);
      add(new THREE.SphereGeometry(4.6, 10, 8), bone, [0, 29.5, 0]); add(new THREE.BoxGeometry(5, 2.2, 4.2), bone, [0, 25.6, -0.6]);
      add(new THREE.CylinderGeometry(0.9, 0.9, 16, 6), bone, [0, 17, 0]);
      for (let i = 0; i < 4; i++) { add(new THREE.TorusGeometry(4.5 - i * 0.4, 0.5, 6, 14, Math.PI), bone, [0, 22.5 - i * 2.2, 0], [Math.PI / 2, 0, Math.PI]); }
      add(new THREE.BoxGeometry(7, 3, 4), bone, [0, 9, 0]); add(new THREE.CylinderGeometry(1, 1, 9, 6), bone, [-2.6, 4.5, 0]); add(new THREE.CylinderGeometry(1, 1, 9, 6), bone, [2.6, 4.5, 0]);
      add(new THREE.CylinderGeometry(0.8, 0.7, 12, 6), bone, [5.6, 19, 0]);
      arm.position.set(-5.4, 24.5, 0); add(new THREE.CylinderGeometry(0.8, 0.7, 12, 6), bone, [0, -6, 0], [0, 0, 0], arm); add(new THREE.SphereGeometry(1.6, 8, 6), bone, [0, -12.4, 0], [0, 0, 0], arm);
      eyes(30, -4.2, 0.9, 1.6); break; }
    default: { const ice = mat(0xbfe6ff, 0.15), dark = mat(0x5a7ea0);
      add(new THREE.BoxGeometry(10.5, 14, 7.5), ice, [0, 15, 0]); add(new THREE.BoxGeometry(6.5, 6.5, 6.5), ice, [0, 25.5, 0]);
      add(new THREE.ConeGeometry(1.3, 4.5, 6), dark, [-2.2, 31, 0], [0, 0, 0.25]); add(new THREE.ConeGeometry(1.3, 4.5, 6), dark, [2.2, 31, 0], [0, 0, -0.25]);
      for (const x of [-6.5, 6.5]) add(new THREE.ConeGeometry(2.2, 6, 6), ice, [x, 23, 0], [0, 0, x < 0 ? 0.6 : -0.6]);
      add(new THREE.CylinderGeometry(2.2, 2.6, 9, 8), ice, [-3.2, 4.5, 0]); add(new THREE.CylinderGeometry(2.2, 2.6, 9, 8), ice, [3.2, 4.5, 0]);
      add(new THREE.CylinderGeometry(1.6, 1.4, 12, 8), ice, [6.8, 15, 0]);
      arm.position.set(-6.8, 22, 0); add(new THREE.CylinderGeometry(1.7, 1.4, 12, 8), ice, [0, -6, 0], [0, 0, 0], arm); add(new THREE.BoxGeometry(3.4, 3.4, 3.4), mat(0xd8f4ff, 0.5), [0, -12.5, 0], [0, 0, 0], arm);
      eyes(26.2, -3.4, 0.8, 1.6); }
  }
  g.visible = false;
  return { group: g, arm, k };
}
/** What each kaiju throws, as pooled geometry: { type: { geo, mat, scale } }. */
function kaijuProps(obstacles) {
  const bone = [0.91, 0.88, 0.8], ice = [0.75, 0.9, 1.0];
  const boneSpike = merge([paint(cone(0.55, 2.6, 7), bone, { p: [0, 1.3, 0] }), paint(sph(0.5, 8), bone, { p: [0, 0.2, 0] })]);
  const skull = merge([paint(sph(0.42, 10), bone, { p: [0, 0.42, 0] }), paint(box(0.5, 0.2, 0.4), bone, { p: [0, 0.12, 0.1] })]);
  const ribs = merge([0, 1, 2, 3].map(i => paint(new THREE.TorusGeometry(1.6 - i * 0.2, 0.14, 6, 14, Math.PI), bone, { p: [0, 1.9 - i * 0.45, 0], r: [Math.PI / 2, 0, Math.PI] })).concat([paint(box(4.3, 0.3, 0.3), bone, { p: [0, 0.15, 0] })]));
  const iceBlock = merge([paint(box(1.4, 2.2, 1.2), ice, { p: [0, 1.1, 0], r: [0, 0.4, 0] }), paint(box(0.9, 1.2, 0.9), [0.9, 0.97, 1.0], { p: [0.3, 2.3, 0.2], r: [0, 0.9, 0.2] })]);
  const snowball = paint(sph(0.5, 10), [0.96, 0.97, 1.0], { p: [0, 0.5, 0], s: [1.2, 1, 1.2] });
  const boulder = obstacles.mountain?.drusen?.[0], boat = obstacles.coast?.wide?.[0], buoy = obstacles.coast?.drusen?.[2] || obstacles.coast?.drusen?.[0];
  const P = (geo, mat, scale = 1) => ({ geo, mat, scale });
  return {
    daidarabotchi: { stalk: boulder && P(boulder.geo, boulder.mat, 2.6), drusen: boulder && P(boulder.geo, boulder.mat, 1.1) },
    umibozu: { wide: boat && P(boat.geo, boat.mat, 1), drusen: buoy && P(buoy.geo, buoy.mat, 1) },
    gashadokuro: { stalk: P(boneSpike, PAINT_REF, 1), drusen: P(skull, PAINT_REF, 1), wide: P(ribs, PAINT_REF, 1) },
    yukioni: { stalk: P(iceBlock, PAINT_REF, 1), drusen: P(snowball, PAINT_REF, 1) },
  };
}
const PAINT_REF = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
const _V3 = new THREE.Vector3(), _V3b = new THREE.Vector3(), _V3c = new THREE.Vector3(), _Q1 = new THREE.Quaternion(), _M4 = new THREE.Matrix4(), _UP = new THREE.Vector3(0, 1, 0);

export class Renderer {
  constructor(canvasParent, world, opts = {}) {
    this.world = world; this.opts = opts; this.time = 0; this.phase = 0;
    const gl = this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    gl.setPixelRatio(Math.min(devicePixelRatio, 2)); gl.setSize(innerWidth, innerHeight);
    gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.92;
    canvasParent.appendChild(gl.domElement);

    const s = this.scene = new THREE.Scene();
    s.fog = new THREE.Fog(new THREE.Color(0.7, 0.5, 0.5), 40, 260);
    this.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 1200);
    this.camera.position.set(0, 5.2, -8.5); s.add(this.camera);

    // lights (colours from the theme each frame)
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6); s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2); this.sun.position.set(60, 40, 140); s.add(this.sun);
    this.fill = new THREE.DirectionalLight(0x6a80ff, 0.35); this.fill.position.set(-20, 25, -40); s.add(this.fill);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.15); s.add(this.ambient);
    this.flashLight = new THREE.AmbientLight(0xdde6ff, 0); s.add(this.flashLight);

    // sky & horizon (scene space, static)
    this.sky = makeSky(); s.add(this.sky.group);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshBasicMaterial({ color: 0x141020 })); base.rotation.x = -Math.PI / 2; base.position.y = -0.06; s.add(base); this.base = base;

    // the track spline maps track space (x across, h up, s along) to world space; everything is placed through it
    this.track = new Track(world.seed);
    TRACK.map = (x, h, z, ry, outPos, outQuat) => this.track.map(x, h, z, ry, outPos, outQuat);
    this.stage = new THREE.Group(); s.add(this.stage);
    this.root = new THREE.Group(); this.stage.add(this.root);
    this.fxGroup = new THREE.Group(); s.add(this.fxGroup);        // particle fields ride the runners' frame

    this._buildAssets();
    this.views = new Map();
    for (const c of world.pool.live) this._attachChunk(c);

    // runners
    this.rigs = [];
    this.setCharacters(opts.characters || ['tanuki', 'kitsune']);
    this.shock = makeShockRing(this.root);

    // typhoon: a cloud bank descending from the top of the frame + lightning
    this.storm = new THREE.Mesh(new THREE.PlaneGeometry(90, 34), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `precision highp float; varying vec2 vUv; uniform float uTime, uFlash;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
        void main(){ float n = fbm(vUv * vec2(6.0, 3.0) + vec2(uTime * 0.08, 0.0));
          float a = smoothstep(0.05, 0.42, vUv.y + (n - 0.5) * 0.45);
          vec3 col = mix(vec3(0.02,0.02,0.05), vec3(0.09,0.085,0.14), n) + uFlash * vec3(0.45,0.5,0.7);
          gl_FragColor = vec4(col, a * 0.97); }`,
    })); this.storm.renderOrder = 10; this.storm.position.set(0, 34, -18); this.camera.add(this.storm);
    this.flash = 0; this.shake = 0; this.roll = 0;

    // particles (camera-space) + set-dressing
    this.particles = makeParticles(this.fxGroup);
    this.train = makeTrain(); this.root.add(this.train); this.trainTimer = 6;
    this.wind = new THREE.Vector3(0, 0, 1);
    this.themeNow = null;

    // post: bloom for glow, then a light anime grade
    this.composer = new EffectComposer(gl); this.composer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.composer.addPass(new RenderPass(s, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.32, 1.0);
    if (opts.bloom !== false) this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE); if (opts.bloom !== false) this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    addEventListener('resize', () => this.resize());
  }

  /** Build (or rebuild) the two runner rigs: ids[0] runs the left track, ids[1] the right. */
  setCharacters(ids) {
    for (const R of this.rigs) { this.stage.remove(R.rig.group); this.stage.remove(R.shadow); this.root.remove(R.trail.obj); }
    this.rigs = []; this.characters = ids.slice();
    for (const track of [0, 1]) {
      const ch = characterById(ids[track]); const mats = [];
      const rig = buildCharacter(ch.id, (hex) => { const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.65 }); mats.push(m); return m; });
      rig.mats = rig.mats?.length ? rig.mats : mats;
      this.stage.add(rig.group);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.015; this.stage.add(shadow);
      const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.6, 2.0), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      bubble.position.y = 0.55; bubble.visible = false; rig.group.add(bubble);
      const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('rgba(120,200,255,0.9)', 'rgba(60,120,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      aura.scale.set(2.6, 2.6, 1); aura.position.y = 0.5; rig.group.add(aura);
      const tc = new THREE.Color(...ch.trail);
      const light = new THREE.PointLight(tc.clone().multiplyScalar(0.5), 4, 6, 1.6); light.position.set(0, 0.9, -0.3); rig.group.add(light);
      const trail = makeTrail(this.root, tc);
      this.rigs.push({ track, rig, shadow, bubble, aura, trail, hurt: 0, prevX: null, lean: 0, phase: 0 });
    }
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.gl.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); }

  // ---------------------------------------------------------------- assets
  _buildAssets() {
    this.obstacles = buildObstacles();
    this.pools = {};                        // key -> MeshPool
    this.pool = (key, geo, mat) => this.pools[key] ??= new MeshPool(key, geo, mat, this.root);
    this.floorPool = new MeshPool('floor', null, null, this.root);
    this.floorPool.take = () => {
      let m = this.floorPool.free.pop();
      if (!m) {
        const g = new THREE.PlaneGeometry(GROUND_W, CHUNK_LEN, 44, 18); g.rotateX(-Math.PI / 2);
        g.userData.base = g.attributes.position.array.slice();
        g.setAttribute('aTrack', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        m = new THREE.Mesh(g, makeGroundMaterial()); m.material.uniforms.uBent.value = 1; m.frustumCulled = false; m.userData.pool = 'floor'; this.root.add(m);
      }
      m.visible = true; return m;
    };
    this.coinPool = new InstancePool(this.root, coinGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 1.0, 0.32) }), 600);
    this.coins = [];
    this.powers = buildPowers();
    this.ringGeo = new THREE.RingGeometry(0.55, 0.75, 32);
    this.scenery = buildScenery(this.root, (text, color, vertical) => {
      const t = neonTexture(text, color, vertical);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(t.image.width / 40, t.image.height / 40), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.6, 1.6) }));
      m.userData.neon = true; return m;
    });
    this.grass = makeGrass(this.root); this.flowers = makeFlowers(this.root);
    // kaiju: thrown props, wave lines (one per monster colour), rigs
    this.kaijuProps = kaijuProps(this.obstacles);
    const waveGeo = merge([paint(box(TRACK_W, 0.32, 0.6), [1, 1, 1], { p: [0, 0.16, 0] }), paint(box(TRACK_W * 0.9, 0.32, 0.2), [0.8, 0.8, 0.8], { p: [0, 0.45, 0] })]);
    for (const k of KAIJU) this.pool(`wave:${k.id}`, waveGeo, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(...k.color).multiplyScalar(1.15), transparent: true, opacity: 0.85 }));
    this.kaijuRigs = {}; for (const k of KAIJU) { const r = kaijuRig(k); this.stage.add(r.group); this.kaijuRigs[k.id] = r; }
    this.kaijuState = { id: null, y: -42, throwT: 9, stompT: 0, side: 1 };
  }

  /** Bend a floor mesh along the track: vertices go to world space, aTrack keeps (x, s) for the surface patterns. */
  _bendFloor(floor, z0) {
    const g = floor.geometry, base = g.userData.base, pos = g.attributes.position.array, tr = g.attributes.aTrack.array;
    for (let i = 0; i < g.attributes.position.count; i++) {
      const x = base[i * 3], lz = base[i * 3 + 2], sAbs = z0 + CHUNK_LEN / 2 + lz;
      this.track.map(x, 0, sAbs, 0, _V3);
      pos[i * 3] = _V3.x; pos[i * 3 + 1] = _V3.y; pos[i * 3 + 2] = _V3.z; tr[i * 2] = x; tr[i * 2 + 1] = sAbs;
    }
    g.attributes.position.needsUpdate = true; g.attributes.aTrack.needsUpdate = true; g.computeVertexNormals();
  }

  _obstacleVariant(biome, type, v) {
    const list = this.obstacles[BIOMES[biome]]?.[type] || this.obstacles.mountain?.[type];
    if (!list?.length) return null;
    return list[v % list.length];
  }

  // ---------------------------------------------------------------- chunks
  _attachChunk(c) {
    const biome = c.biome, season = c.season; const rng = mulberry32(mixSeed(this.world.seed ^ 0x5eed, c.index));
    const night = nightAt(this.world.distance);
    const floor = this.floorPool.take(); this._bendFloor(floor, c.z0);
    const u = floor.material.uniforms; u.uZ0.value = c.z0; u.uBiome.value = biome; u.uSeason.value = season; u.uSnow.value = snowAt(c.index);
    const v = { floor, meshes: [], coins: [], powers: [], rollers: [], thrown: [], lights: [] };
    const light = (x, z, y, i, col) => { if (v.lights.length < MAX_LIGHTS) v.lights.push({ x, z, y, i, col }); };

    for (const cell of c.cells) {
      const x = cellX(cell);
      if (cell.type === 'photon') {
        const y = cell.hi ? 1.7 : 0.75; const i = this.coinPool.take(compose(x, y, cell.z, 1, 1, 1, 0));
        const coin = { i, x, y, z: cell.z, cell }; v.coins.push(coin); this.coins.push(coin); continue;
      }
      if (cell.type === 'power') {
        const pw = this.powers[cell.kind]; if (!pw) continue;
        const m = this.pool(`power:${cell.kind}`, pw.geo, pw.mat).take(); m.position.set(x, 0.5, cell.z); placeMesh(m); m.userData.cell = cell;
        const ring = this.pool(`ring:${cell.kind}`, this.ringGeo, new THREE.MeshBasicMaterial({ color: pw.ring, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })).take();
        ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.05, cell.z); placeMesh(ring);
        v.meshes.push(m, ring); v.powers.push({ m, ring, cell, z: cell.z, x }); light(x, cell.z, 0.8, 0.5, [pw.ring.r, pw.ring.g, pw.ring.b]);
        continue;
      }
      if (cell.type === 'wave') {
        const m = this.pools[`wave:${cell.by || 'daidarabotchi'}`].take(); m.userData.cell = cell;
        m.position.set(trackX(cell.track), 0, cell.z); placeMesh(m); m.scale.set(1, 0.001, 1); v.meshes.push(m);
        v.thrown.push({ m, cell, x: trackX(cell.track), start: null, landed: false, wave: true }); continue;
      }
      const kp = cell.thrown ? this.kaijuProps[cell.by]?.[cell.type] : null;
      const variant = kp ? { geo: kp.geo, mat: kp.mat, name: 'thrown' } : this._obstacleVariant(biome, cell.type, cell.v ?? 0);
      if (!variant) continue;
      const key = kp ? `kaiju:${cell.by}:${cell.type}` : `${biome}:${cell.type}:${cell.v % 8}:${variant.name}`;
      const m = this.pool(key, variant.geo, variant.mat).take(); m.userData.cell = cell;
      const ox = cell.type === 'wide' ? x + LANE_W / 2 : x;
      m.position.set(ox, cell.type === 'gap' ? 0.02 : 0, cell.z); m.rotation.y = cell.type === 'roller' || cell.type === 'wide' ? 0 : (rng() - 0.5) * 0.25;
      if (kp) m.scale.setScalar(kp.scale);
      v.meshes.push(m);
      if (cell.thrown) { m.visible = false; v.thrown.push({ m, cell, x: ox, start: null, landed: false, scale: kp?.scale ?? 1 }); }
      if (variant.glow) { const g = this.pool(key + ':glow', variant.glow.geo, variant.glow.mat).take(); g.position.copy(m.position); g.rotation.copy(m.rotation); v.meshes.push(g); }
      if (cell.type === 'roller') v.rollers.push({ m, cell });
    }
    this.scenery.dress(c, { rng, z0: c.z0, len: CHUNK_LEN, biome, season, night, light });
    this.grass.fill(c, mulberry32(mixSeed(this.world.seed ^ 0x9a55, c.index)), season, biome);
    this.flowers.fill(c, mulberry32(mixSeed(this.world.seed ^ 0xf10e, c.index)), season, biome);
    for (let i = 0; i < MAX_LIGHTS; i++) { const L = v.lights[i]; if (L) { u.uLight.value[i].set(L.x, L.z, L.y, L.i); u.uLightCol.value[i].setRGB(...L.col); } }
    u.uLightN.value = v.lights.length;
    this.views.set(c.index, v);
    this.coinPool.flush();
  }

  _detachChunk(c) {
    const v = this.views.get(c.index); if (!v) return;
    this.floorPool.give(v.floor);
    for (const m of v.meshes) this.pools[m.userData.pool]?.give(m);
    for (const coin of v.coins) { this.coinPool.give(coin.i); const k = this.coins.indexOf(coin); if (k >= 0) this.coins.splice(k, 1); }
    this.scenery.release(c.index); this.grass.release(c.index); this.flowers.release(c.index);
    this.views.delete(c.index);
    this.coinPool.flush();
  }

  /** Swap to a fresh world (restart) without reallocating anything. */
  reset(world) {
    this.world = world; this.track = new Track(world.seed);
    TRACK.map = (x, h, z, ry, outPos, outQuat) => this.track.map(x, h, z, ry, outPos, outQuat);
    for (const k of [...this.views.keys()]) this._detachChunk({ index: k });
    for (const c of world.pool.live) this._attachChunk(c);
    this.train.visible = false; this.trainTimer = 6;
  }

  /** Sim events → visual reactions. */
  onEvent(e) {
    const R = e.runner !== undefined ? this.rigs[e.runner] : null;
    switch (e.type) {
      case 'recycle': this._detachChunk(e.old); this._attachChunk(e.fresh); break;
      case 'coin': { const coin = this.coins.find(k => k.cell === e.cell); if (coin) { this.coinPool.give(coin.i); coin.i = -1; this.coinPool.flush(); } break; }
      case 'power': {
        for (const v of this.views.values()) for (const pw of v.powers) if (pw.cell === e.cell) { pw.m.visible = false; pw.ring.visible = false; this.shock.burst(pw.x, pw.z, this.powers[e.kind].ring); }
        break;
      }
      case 'shield': this.shock.burst(roadX(this.world.runners[e.runner].xLane), this.world.distance, new THREE.Color(1.5, 2.2, 2.6)); break;
      case 'bump': { const m = this.world.runners[e.mover]; this.shock.burst(roadX(m.xLane), this.world.distance, new THREE.Color(2.2, 1.8, 1.2)); break; }
      case 'stumble': this.shake = Math.max(this.shake, 0.18); if (R) R.hurt = 0.6; break;
      case 'fall': this.shake = Math.max(this.shake, 0.3); if (R) R.hurt = 1.0; break;
      case 'death': this.shake = 0.5; for (const r of this.rigs) r.hurt = 2; break;
    }
  }

  // ---------------------------------------------------------------- frame
  render(dt) {
    const w = this.world; this.time += dt;
    const idx = Math.floor(w.distance / CHUNK_LEN); const biome = biomeOf(idx), season = seasonOf(idx);
    const seasonT = (idx % SEASON_LEN) / SEASON_LEN;
    const night = nightAt(w.distance);
    const dread = 1 - Math.max(0, w.storm) / W.STORM_MAX;
    this.track.ensure(idx + 8);

    // ---- theme → lights, fog, ground
    const th = getTheme(season, night, biome);
    this.sun.color.copy(th.sun); this.sun.intensity = th.sunIntensity; this.sun.position.set(60, 46 - 30 * night, 140);
    this.hemi.color.copy(th.hemiSky); this.hemi.groundColor.copy(th.hemiGround); this.hemi.intensity = th.hemiIntensity;
    this.ambient.intensity = th.ambient; this.scene.fog.color.copy(th.fog); this.base.material.color.copy(th.fog).multiplyScalar(0.55);
    const wet = clamp01((dread - 0.35) / 0.5) + (season === 1 && night > 0.35 && night < 0.65 ? 0.4 : 0);
    for (const v of this.views.values()) { const u = v.floor.material.uniforms; u.uTime.value = this.time; u.uNight.value = night; u.uWet.value = wet; }
    const windStrength = (season === 2 ? 1.3 : season === 3 ? 0.9 : 0.7) + dread * 1.2;
    this.wind.set(0.35 * Math.sin(this.time * 0.13), 0, 1).normalize().multiplyScalar(windStrength);
    this.sky.update(dt, { night, season, seasonT, time: this.time, wind: this.wind, biome, dread }, this.camera);
    this.grass.update(dt, this.wind, night, season); this.flowers.update(dt, this.wind, night, season);
    this.scenery.update(dt, { night, time: this.time, season, biome, dt });
    this.particles.update(dt, { season, biome, night, scroll: w.speed, wind: this.wind, dread });
    this.shock.update(dt);

    // ---- runners
    if (w.alive) this.phase += dt * Math.max(6, w.speed * 1.5);
    let leanSum = 0;
    for (const R of this.rigs) {
      const p = w.runners[R.track]; const g = R.rig.group;
      const px = roadX(p.xLane);
      const slide = p.action === 'slide', air = !p.grounded;
      const laneVel = R.prevX === null ? 0 : (px - R.prevX) / Math.max(dt, 1e-3); R.prevX = px;
      R.lean += ((-laneVel * 0.05) - R.lean) * Math.min(1, dt * 10); leanSum += R.lean;
      g.position.set(px, p.y + (p.grounded && !slide ? 0.035 * Math.abs(Math.sin(this.phase)) : 0), w.distance);
      R.rig.legs.forEach((l, i) => { l.rotation.x = air ? 0.9 : Math.sin(this.phase + (i % 2 ? Math.PI : 0) + (i >= 2 ? Math.PI * 0.5 : 0)) * 0.95; });
      if (R.rig.tail) { R.rig.tail.rotation.z = Math.sin(this.phase * 0.5) * 0.3; R.rig.tail.rotation.x = air ? -0.5 : 0; }
      const dash = p.dashT > 0;
      g.scale.set(1, slide ? 0.55 : 1, slide ? 1.25 : dash ? 1.15 : 1);
      g.rotation.set(slide ? 0.25 : air ? -0.25 : 0, -laneVel * 0.06, -R.lean); placeMesh(g);
      g.visible = !(p.iT > 0 && Math.floor(this.time * 18) % 2 === 0);
      R.hurt = Math.max(0, R.hurt - dt);
      const hurtGlow = R.hurt > 0 ? 0.5 + 0.5 * Math.sin(this.time * 40) : 0;
      for (const m of R.rig.mats) if (m.emissive) m.emissive.setRGB(hurtGlow + (dash ? 0.25 : 0), hurtGlow * 0.1 + (dash ? 0.35 : 0), dash ? 0.6 : 0);
      R.bubble.visible = p.shield; R.bubble.scale.setScalar(1 + 0.05 * Math.sin(this.time * 6));
      R.aura.material.opacity += ((p.magnetT > 0 ? 0.8 : 0) - R.aura.material.opacity) * Math.min(1, dt * 6);
      R.shadow.position.set(px, 0.015, w.distance); R.shadow.rotation.set(-Math.PI / 2, 0, 0); placeMesh(R.shadow); const sh = Math.max(0.3, 1 - p.y * 0.3); R.shadow.scale.set(sh, sh, 1); R.shadow.material.opacity = 0.4 * sh;
      R.trail.emit(px, p.y, w.distance, dt, w.alive && w.speed > 1);
    }

    // ---- camera: follows the road's own frame — behind on the spline, aimed at a point ahead on the spline, up = road normal.
    // Smoothly damped; no roll, no jitter. Turns and crests read because the camera looks *into* them before the runners arrive.
    const cam = this.camera;
    const targetFov = 66 + 10 * clamp01((w.speed - P.SPEED_BASE) / (P.SPEED_MAX - P.SPEED_BASE));
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 1.5); cam.updateProjectionMatrix();
    const fb = this.track.frameAt(Math.max(0, w.distance - 8.5));
    const slope = Math.asin(THREE.MathUtils.clamp(fb.T.y, -1, 1));
    _V3.copy(fb.P).addScaledVector(fb.N, 5.2 + Math.max(0, -slope) * 4);
    const camUp = _V3b.copy(fb.N).lerp(_UP, 0.35).normalize();
    const fa = this.track.frameAt(w.distance + 22);
    const aim = _V3c.copy(fa.P).addScaledVector(fa.N, 1.3);
    if (!this.camInit) { cam.position.copy(_V3); this.camInit = true; }
    cam.position.lerp(_V3, 1 - Math.exp(-dt * 7));
    _M4.lookAt(cam.position, aim, camUp); _Q1.setFromRotationMatrix(_M4);
    cam.quaternion.slerp(_Q1, 1 - Math.exp(-dt * 6));
    this.shake = 0;
    // things that ride with the camera / runners
    this.sky.group.position.set(cam.position.x, 0, cam.position.z);
    const fr = this.track.frameAt(w.distance); this.fxGroup.position.copy(fr.P); this.fxGroup.quaternion.copy(this.track.quatAt(w.distance));

    // ---- typhoon
    this.storm.position.y = 34 - dread * 24 + (w.alive ? 0 : -9);
    this.storm.material.uniforms.uTime.value = this.time;
    if (dread > 0.45 && Math.random() < dt * (0.12 + dread * 0.5)) this.flash = 1;
    this.flash *= Math.exp(-dt * 12); this.storm.material.uniforms.uFlash.value = this.flash; this.flashLight.intensity = this.flash * 2.5;

    // ---- coins, powers, rollers
    const spin = this.time * 3;
    for (const c of this.coins) if (c.i >= 0) this.coinPool.set(c.i, compose(c.x, c.y + 0.08 * Math.sin(this.time * 4 + c.z), c.z, 1, 1, 1, spin + c.z));
    this.coinPool.flush();
    for (const v of this.views.values()) {
      for (const pw of v.powers) { pw.m.position.set(pw.x, 0.55 + 0.12 * Math.sin(this.time * 3 + pw.z), pw.z); pw.m.rotation.set(0, this.time * 1.6, 0); placeMesh(pw.m); const k = 1 + 0.12 * Math.sin(this.time * 5 + pw.z); pw.ring.scale.set(k, k, 1); }
      for (const r of v.rollers) { r.m.position.set(roadX(r.cell.track * LANES + rollerLaneAt(r.cell, w.tick)), 0, r.cell.z); r.m.rotation.set(0, r.cell.dir * this.time * 3, 0); placeMesh(r.m); }
    }
    // ---- kaiju: rises beside the road for the last chunks of a season, stomps, and throws
    const K = this.kaijuState, kj = w.kaiju;
    if (kj && kj.id !== K.id) { K.id = kj.id; K.side = kj.side; K.y = -42; K.throwT = 9; }
    for (const [id, r] of Object.entries(this.kaijuRigs)) {
      const active = id === K.id;
      const targetY = active && kj ? 0 : -42;
      if (active) { K.y += (targetY - K.y) * Math.min(1, dt * 1.1); r.group.visible = K.y > -41; }
      else r.group.visible = false;
      if (!r.group.visible) continue;
      K.stompT += dt; const stomp = Math.abs(Math.sin(K.stompT * 2.8));
      r.group.position.set(K.side * 7, K.y * 1.4 + stomp * 1.4 - 1.4, w.distance + 108); r.group.scale.set(K.side * 1.4, 1.4, 1.4); r.group.rotation.set(0, K.side * 0.5, 0); placeMesh(r.group);
      K.throwT += dt; const swing = K.throwT < 0.55 ? Math.sin((K.throwT / 0.55) * Math.PI) : 0;
      r.arm.rotation.x = -0.35 - swing * 1.7; r.arm.rotation.z = -0.25;
      if (!kj) K.id = K.y <= -41 ? null : K.id;
    }
    for (const v of this.views.values()) for (const t of v.thrown) {
      if (t.landed) continue;
      const lead = w.speed * 1.5 + 8, dz = t.cell.z - w.distance;
      if (dz > lead) continue;
      if (!t.start) { t.start = { x: K.side * 2, y: 30, z: w.distance + 100 }; K.throwT = 0; t.m.visible = true; }
      const p = clamp01(1 - (dz - 4) / (lead - 4));
      if (t.wave) { t.m.scale.set(1, Math.max(0.001, p), 1); }
      else { t.m.position.set(lerp(t.start.x, t.x, p), lerp(t.start.y, 0, p) + Math.sin(p * Math.PI) * 9, lerp(t.start.z, t.cell.z, p)); t.m.rotation.set(p * 6 * (t.cell.v % 2 ? 1 : -1), 0, 0); placeMesh(t.m); }
      if (p >= 1) { t.landed = true; t.m.position.set(t.x, t.cell.type === 'gap' ? 0.02 : 0, t.cell.z); t.m.rotation.set(0, 0, 0); placeMesh(t.m); this.shock.burst(t.x, t.cell.z, new THREE.Color(...(KAIJU.find(k => k.id === t.cell.by)?.color || [1, 1, 1])).multiplyScalar(1.5)); }
    }
    // shinkansen on the city viaduct
    if (this.train.visible) { this.trainS -= 62 * dt; this.train.position.set(16, 6.6, this.trainS); this.train.rotation.set(0, 0, 0); placeMesh(this.train); if (this.trainS < w.distance - 70) this.train.visible = false; }
    else if (biome === 1 && (this.trainTimer -= dt) <= 0) { this.trainTimer = 9 + Math.random() * 8; this.train.visible = true; this.trainS = w.distance + 230; }

    this.composer.render();
  }
}
