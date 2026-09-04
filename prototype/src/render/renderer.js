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
import { LANE_W, LANES, LANES_TOTAL, TRACK_W, ROAD_HALF, CHUNK_LEN, BEAT_LEN, BIOME_LEN, BIOMES, SEASON_LEN, KAIJU, SETPIECE, POWER_INFO, roadX, trackX, cellX, biomeOf, seasonOf, rollerLaneAt, provinceOf, shrineClimbPitch, shrineTopAt, hikeClimbPitch, hikeTopAt, surfaceOf, fireAt, forkAt, groupOf, FORK_LIFT } from '../core/chunks.js';
import { mulberry32, mixSeed } from '../core/rng.js';
import { W } from '../core/world.js';
import { P } from '../core/player.js';
import { MeshPool, InstancePool, compose, radial, canvasTexture, lerp, clamp01, paint, merge, box, cyl, cone, sph, GLOW, TRACK, placeMesh } from './common.js';
import { Track } from './track.js';
import { buildObstacles, buildPowers, coinGeometry } from './props.js';
import { buildCharacter, characterById, CHAR_SCALE } from './characters.js';
import { getTheme } from './theme.js';
import { makeSky } from './sky.js';
import { makeGroundMaterial, GROUND_W, MAX_LIGHTS } from './ground.js';
import { makeGrass, makeFlowers } from './vegetation.js';
import { makeParticles, makeTrail, makeTrain, makeLocalTrain, makeShockRing, makeBurst } from './fx.js';
import { buildScenery } from './scenery.js';
import { makeDeer, deerStanding, DEER_MAT } from './deer.js';
import { makeLitter, makeSpray } from './litter.js';

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
  uniforms: { tDiffuse: { value: null }, uVibrance: { value: 0.2 }, uLift: { value: new THREE.Vector3(0.006, 0.007, 0.016) }, uVignette: { value: 0.2 } },
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
    case 'gojira': { const hide = mat(0x2f3a30), belly = mat(0x6b7360), plate = mat(0xb9c4a8, 0.12);
      // the classic silhouette: a heavy body leaning forward over thick legs, a long tail, a row of dorsal plates, and a jaw that opens for the breath
      add(new THREE.BoxGeometry(9, 13, 8), hide, [0, 14, 0], [0.18, 0, 0]); add(new THREE.BoxGeometry(6, 10, 2), belly, [0, 13, 4.2], [0.18, 0, 0]);
      add(new THREE.CylinderGeometry(2.6, 3.1, 9, 8), hide, [-3.2, 4.5, 0]); add(new THREE.CylinderGeometry(2.6, 3.1, 9, 8), hide, [3.2, 4.5, 0]);
      for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(2.4 - i * 0.42, 2.8 - i * 0.42, 6, 8), hide, [0, 7 - i * 1.4, -6 - i * 5.2], [1.25 + i * 0.08, 0, 0]);   // the tail, curving down and back
      for (let i = 0; i < 7; i++) add(new THREE.ConeGeometry(1.7 - Math.abs(i - 3) * 0.3, 3.6 - Math.abs(i - 3) * 0.6, 4), plate, [0, 21 - i * 2.1, -4.2 - i * 1.6], [-0.35, 0, 0]);   // dorsal plates
      add(new THREE.CylinderGeometry(1.5, 1.2, 8, 8), hide, [6.2, 16, 1.5], [0.3, 0, -0.4]);
      arm.position.set(-6.2, 18, 1.5); add(new THREE.CylinderGeometry(1.5, 1.2, 8, 8), hide, [0, -4, 0], [0, 0, 0], arm);
      const head = new THREE.Group(); head.position.set(0, 24.5, 2.5); g.add(head);
      add(new THREE.BoxGeometry(5.2, 4.6, 6.5), hide, [0, 1.2, 1.2], [0, 0, 0], head); add(new THREE.BoxGeometry(4.6, 1.6, 6.2), hide, [0, -1.4, 1.8], [0.35, 0, 0], head);   // skull and the lower jaw
      for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) add(new THREE.ConeGeometry(0.28, 0.9, 4), plate, [sx * (1.6 - i * 0.1), -0.7, 2.4 + i * 0.6], [Math.PI, 0, 0], head);   // teeth
      const mouth = new THREE.Group(); mouth.position.set(0, -0.6, 4.6); head.add(mouth); g.userData.mouth = mouth;
      for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.7, 8, 8), eye, [sx * 1.8, 2.4, 4.0], [0, 0, 0], head); break; }
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
  return { group: g, arm, k, mouth: g.userData.mouth || null };
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
  const bamboo = obstacles.mountain?.stalk?.[1], log = obstacles.mountain?.drusen?.[1];
  const cityStalk = obstacles.city?.stalk?.[0], cityLow = obstacles.city?.drusen?.[0], truck = obstacles.city?.wide?.[0];
  const P = (geo, mat, scale = 1) => ({ geo, mat, scale });
  return {
    daidarabotchi: { stalk: boulder && P(boulder.geo, boulder.mat, 2.6), drusen: boulder && P(boulder.geo, boulder.mat, 1.1) },
    umibozu: { wide: boat && P(boat.geo, boat.mat, 1), drusen: buoy && P(buoy.geo, buoy.mat, 1) },
    gashadokuro: { stalk: P(boneSpike, PAINT_REF, 1), drusen: P(skull, PAINT_REF, 1), wide: P(ribs, PAINT_REF, 1) },
    yukioni: { stalk: P(iceBlock, PAINT_REF, 1), drusen: P(snowball, PAINT_REF, 1) },
    gojira: { stalk: cityStalk && P(cityStalk.geo, cityStalk.mat, 1.15), drusen: cityLow && P(cityLow.geo, cityLow.mat, 1), wide: truck && P(truck.geo, truck.mat, 1) },   // city wreckage, and it arrives on fire
    // set pieces that throw: the tsunami washes boats and buoys onto the road, the fire drops
    // burning bamboo and logs, and the Hakone trail takes boulders down the slope
    tsunami: { wide: boat && P(boat.geo, boat.mat, 1), drusen: buoy && P(buoy.geo, buoy.mat, 1) },
    fire: { stalk: bamboo && P(bamboo.geo, bamboo.mat, 1), drusen: log && P(log.geo, log.mat, 1) },
    rockfall: { stalk: boulder && P(boulder.geo, boulder.mat, 1.9), drusen: boulder && P(boulder.geo, boulder.mat, 1.05) },
  };
}
const PAINT_REF = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
const _COL = new THREE.Color();
const _V3 = new THREE.Vector3(), _V3b = new THREE.Vector3(), _V3c = new THREE.Vector3(), _Q1 = new THREE.Quaternion(), _M4 = new THREE.Matrix4(), _UP = new THREE.Vector3(0, 1, 0);
const _OFF = { x: 0, h: 0, yaw: 0 };   // scratch for the fork offset
/** Under a fork the land sits this far below the decks, so a road running level with it never fights it for the same pixels. */
const FORK_DROP = 0.08;

export class Renderer {
  constructor(canvasParent, world, opts = {}) {
    this.world = world; this.opts = opts; this.time = 0; this.phase = 0;
    const gl = this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.basePR = Math.min(devicePixelRatio, opts.hq ? 2 : 1.5); this.scale = 1; this.frameEma = 1 / 60; this.slowFor = 0; this.fastFor = 0;
    gl.setPixelRatio(this.basePR); gl.setSize(innerWidth, innerHeight);
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
    const base = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshBasicMaterial({ color: 0x141020 })); base.rotation.x = -Math.PI / 2; base.position.y = -0.06; base.visible = false; s.add(base); this.base = base;   // the sky's horizon band stands in for distant ground

    // the track spline maps track space (x across, h up, s along) to world space; everything is placed through it
    this.track = new Track(world.seed);
    this.forks = new Map(); TRACK.map = this._mapper();
    this.focus = opts.focus ?? 1;                                              // the runner the camera stays with when the road forks
    this.solo = !!world.opts.solo; TRACK.shift = 0; TRACK.fork = null;         // the road is the same six lanes in 1P and 2P
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
    // one-shot bursts: sparks where runners collide, and the water/snow a set piece throws across the road
    this.sparks = makeBurst(this.root, { n: 300, size: 0.3, gravity: -16, drag: 1.2, life: 0.5 });
    this.splash = makeBurst(this.root, { n: 420, size: 0.5, gravity: -12, drag: 0.5, life: 1.1, additive: false });
    this.splashT = 0;

    // typhoon: a cloud bank descending from the top of the frame + lightning
    this.storm = new THREE.Mesh(new THREE.PlaneGeometry(90, 34), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `precision highp float; varying vec2 vUv; uniform float uTime, uFlash;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
        void main(){ float n = fbm(vUv * vec2(6.0, 3.0) + vec2(uTime * 0.08, 0.0));
          float a = smoothstep(0.12, 0.5, vUv.y + (n - 0.5) * 0.4);
          vec3 col = mix(vec3(0.02,0.02,0.05), vec3(0.09,0.085,0.14), n) + uFlash * vec3(0.45,0.5,0.7);
          gl_FragColor = vec4(col, a * 0.85); }`,
    })); this.storm.renderOrder = 10; this.storm.position.set(0, 34, -18); this.camera.add(this.storm);
    this.flash = 0; this.shake = 0; this.roll = 0;

    // particles (camera-space) + set-dressing
    this.particles = makeParticles(this.fxGroup);
    this.train = makeTrain(); this.root.add(this.train); this.trainTimer = 6;
    this.wind = new THREE.Vector3(0, 0, 1);
    this.themeNow = null;

    // post: bloom for glow, then a light anime grade
    this.composer = new EffectComposer(gl); this.composer.setPixelRatio(this.basePR);
    this.composer.addPass(new RenderPass(s, this.camera));
    // Bloom only on things that are genuinely emissive (coins, neon, powers). Lower and
    // tighter than it was: at the old settings the sky and the road bloomed too, and the
    // whole frame went milky.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.3, 0.28, 1.15);
    const bloomSetSize = this.bloom.setSize.bind(this.bloom); this.bloom.setSize = (w, h) => bloomSetSize(w / 2, h / 2);   // bloom at half resolution: the blur hides it, the GPU thanks you
    if (opts.bloom !== false) this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE); if (opts.bloom !== false) this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    addEventListener('resize', () => this.resize());
  }

  /**
   * Build (or rebuild) one rig per runner on the road — `ids[i]` is the character
   * runner `i` picked. Each gets its character's signature colour on its trail, its
   * point light and the ring under its feet, so a pack of four is never ambiguous.
   */
  setCharacters(ids) {
    for (const R of this.rigs) { this.stage.remove(R.rig.group); this.stage.remove(R.shadow); this.stage.remove(R.ring); this.root.remove(R.trail.obj); }
    this.rigs = []; this.characters = ids.slice();
    const n = this.world.runners.length;
    for (let idx = 0; idx < n; idx++) {
      const ch = characterById(ids[idx] ?? ids[idx % Math.max(1, ids.length)]); const mats = [];
      const rig = buildCharacter(ch.id, (hex) => { const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.65 }); mats.push(m); return m; });
      rig.mats = rig.mats?.length ? rig.mats : mats;
      rig.group.scale.setScalar(CHAR_SCALE);
      this.stage.add(rig.group);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.015; this.stage.add(shadow);
      // a ring on the road in this runner's own colour: who is who, at a glance, in a crowd
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.68, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(ch.color), transparent: true, opacity: 0.75, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; this.stage.add(ring);
      const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.6, 2.0), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      bubble.position.y = 0.55; bubble.visible = false; rig.group.add(bubble);
      const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('rgba(120,200,255,0.9)', 'rgba(60,120,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      aura.scale.set(2.6, 2.6, 1); aura.position.y = 0.5; rig.group.add(aura);
      const jet = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('rgba(255,235,160,1)', 'rgba(255,90,20,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      jet.scale.set(1.0, 1.6, 1); jet.position.set(0, 0.35, -0.85); rig.group.add(jet);   // fire out of the back
      const tc = new THREE.Color(...ch.trail);
      const light = new THREE.PointLight(tc.clone().multiplyScalar(0.5), 4, 6, 1.6); light.position.set(0, 0.9, -0.3); rig.group.add(light);
      const trail = makeTrail(this.root, tc);
      this.rigs.push({ idx, rig, shadow, ring, bubble, aura, jet, trail, color: new THREE.Color(ch.color), hurt: 0, prevX: null, lean: 0, phase: 0 });
    }
  }

  /** A rival on another laptop: a translucent runner with a name tag on the same road. Never collides with anything. */
  setGhost(id, character, name) {
    this.ghosts ??= new Map();
    let G = this.ghosts.get(id); if (G && G.character === character && G.name === name) return G;
    if (G) this.removeGhost(id);
    const rig = buildCharacter(characterById(character).id, (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.65, transparent: true, opacity: 0.55, depthWrite: false }));
    this.stage.add(rig.group);
    const tex = canvasTexture(256, 64, (g, w, h) => { g.font = 'bold 34px "Zen Kaku Gothic New", "Noto Sans JP", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 8; g.fillStyle = '#fff'; g.fillText(name || '', w / 2, h / 2); });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); label.scale.set(2.4, 0.6, 1); label.position.y = 1.7; rig.group.add(label);
    G = { id, character, name, rig, label, phase: 0 }; this.ghosts.set(id, G); return G;
  }
  removeGhost(id) { const G = this.ghosts?.get(id); if (!G) return; this.stage.remove(G.rig.group); this.ghosts.delete(id); }
  /** g: { x: continuous global lane, y, z: metres along the road, action, alive } */
  drawGhost(id, g, dt) {
    const G = this.ghosts?.get(id); if (!G) return; const grp = G.rig.group;
    grp.visible = g.alive !== false && Math.abs(g.z - this.world.distance) < 300; if (!grp.visible) return;
    G.phase += dt * 12; const slide = g.action === 'slide';
    grp.position.set(roadX(g.x), g.y, g.z); grp.rotation.set(0, 0, 0); grp.scale.set(1, slide ? 0.55 : 1, slide ? 1.25 : 1); placeMesh(grp);
    G.rig.legs.forEach((l, i) => { l.rotation.x = Math.sin(G.phase + (i % 2 ? Math.PI : 0) + (i >= 2 ? Math.PI * 0.5 : 0)) * 0.95; });
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.gl.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); }
  /** Render scale 0.5..1 of the base pixel ratio (adaptive: drops when frames run long, climbs back when they are quick). */
  setScale(s) {
    s = Math.max(0.5, Math.min(1, s)); if (Math.abs(s - this.scale) < 0.01) return; this.scale = s;
    this.gl.setPixelRatio(this.basePR * s); this.composer.setPixelRatio(this.basePR * s); this.resize();
  }
  _adapt(dt) {
    if (this.opts.fixedScale) return;
    this.frameEma += (dt - this.frameEma) * 0.1;
    if (this.frameEma > 1 / 40) { this.slowFor += dt; this.fastFor = 0; if (this.slowFor > 1.2) { this.setScale(this.scale - 0.15); this.slowFor = 0; } }
    else if (this.frameEma < 1 / 56) { this.fastFor += dt; this.slowFor = 0; if (this.fastFor > 8 && this.scale < 1) { this.setScale(this.scale + 0.1); this.fastFor = 0; } }
    else { this.slowFor = Math.max(0, this.slowFor - dt); }
  }

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
    // fork decks: a slab with a little thickness, so a road pulling away from the others has an edge to read
    this.deckPool = new MeshPool('deck', null, null, this.root);
    this.deckPool.take = () => {
      let m = this.deckPool.free.pop();
      if (!m) {
        const g = new THREE.BoxGeometry(1, 0.6, CHUNK_LEN, 6, 1, 18).translate(0, -0.3, 0);
        g.userData.base = g.attributes.position.array.slice();
        g.setAttribute('aTrack', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        m = new THREE.Mesh(g, makeGroundMaterial()); m.material.uniforms.uBent.value = 1; m.frustumCulled = false; m.userData.pool = 'deck'; this.root.add(m);
      }
      m.visible = true; return m;
    };
    this.coinPool = new InstancePool(this.root, coinGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 1.0, 0.32) }), 600);
    this.coins = [];
    this.powers = buildPowers();
    // pickups without a modelled icon get a glowing kanji disc
    for (const [kind, info] of Object.entries(POWER_INFO)) {
      if (this.powers[kind]) continue;
      const tex = canvasTexture(128, 128, (g, w, h) => { g.translate(w, 0); g.scale(-1, 1); const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = '#1a1020'; g.font = 'bold 60px "Noto Sans JP", "IPAGothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(info.jp.length > 2 ? info.jp.slice(0, 2) : info.jp, 64, 66); });
      const col = new THREE.Color(...info.color);
      this.powers[kind] = { geo: new THREE.PlaneGeometry(1.1, 1.1), mat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, color: col.clone().multiplyScalar(0.8), depthWrite: false }), ring: col, billboard: true };
    }
    this.ringGeo = new THREE.RingGeometry(0.55, 0.75, 32);
    this.haloGeo = new THREE.PlaneGeometry(2.2, 2.2); this.haloTex = radial('rgba(255,255,255,0.75)', 'rgba(255,255,255,0)', 64);
    this.scenery = buildScenery(this.root, (text, color, vertical) => {
      const t = neonTexture(text, color, vertical);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(t.image.width / 40, t.image.height / 40), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.6, 1.6) }));
      m.userData.neon = true; m.userData.mirror = true; return m;
    });
    this.grass = makeGrass(this.root); this.flowers = makeFlowers(this.root);
    // kaiju: thrown props, wave lines (one per monster colour), rigs
    this.kaijuProps = kaijuProps(this.obstacles);
    const waveGeo = merge([paint(box(TRACK_W, 0.32, 0.6), [1, 1, 1], { p: [0, 0.16, 0] }), paint(box(TRACK_W * 0.9, 0.32, 0.2), [0.8, 0.8, 0.8], { p: [0, 0.45, 0] })]);
    for (const k of KAIJU) this.pool(`wave:${k.id}`, waveGeo, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(...k.color).multiplyScalar(1.15), transparent: true, opacity: 0.85 }));
    this.pool('wave:tsunami', waveGeo, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(0.55, 1.5, 1.7), transparent: true, opacity: 0.9 }));   // a surge of water across the road
    this.kaijuRigs = {}; for (const k of KAIJU) { const r = kaijuRig(k); this.stage.add(r.group); this.kaijuRigs[k.id] = r; }
    this.kaijuState = { id: null, y: -42, throwT: 9, stompT: 0, side: 1 };
    // shrine stairs: torii gates spanning the road on the climb, the shrine at the top
    const red = [0.78, 0.19, 0.17], black = [0.16, 0.14, 0.13];
    this.pool('toriiGate', merge([paint(cyl(0.32, 0.38, 7.2), red, { p: [-7.4, 3.6, 0] }), paint(cyl(0.32, 0.38, 7.2), red, { p: [7.4, 3.6, 0] }), paint(box(17.5, 0.5, 0.6), black, { p: [0, 7.45, 0] }), paint(box(15.4, 0.36, 0.45), red, { p: [0, 6.4, 0] })]), PAINT_REF);
    this.pool('shrine', merge([
      paint(box(9, 0.6, 7), [0.55, 0.52, 0.48], { p: [0, 0.3, 0] }), paint(box(7.6, 3.2, 5.6), [0.93, 0.9, 0.84], { p: [0, 2.2, 0] }),
      ...[-3.4, -1.1, 1.1, 3.4].map(x => paint(cyl(0.18, 0.18, 3.4), red, { p: [x, 2.3, 2.9] })),
      paint(box(9.6, 0.35, 7.6), black, { p: [0, 4.05, 0] }), paint(cone(6.8, 2.6, 4), [0.25, 0.28, 0.32], { p: [0, 5.5, 0], r: [0, Math.PI / 4, 0], s: [1.15, 1, 0.9] }),
      paint(box(1.8, 0.5, 0.6), [0.9, 0.75, 0.3], { p: [0, 4.4, 3.2] }), paint(box(2.2, 0.3, 1.4), [0.55, 0.52, 0.48], { p: [0, 0.75, 4.2] }),
    ]), PAINT_REF);
    // the Hakone hike: a weathered waymarker post, and a stone cairn for the saddle at the top
    const timber = [0.36, 0.27, 0.19], signboard = [0.92, 0.9, 0.84], stone = [0.44, 0.43, 0.41];
    this.pool('trailPost', merge([
      paint(cyl(0.09, 0.11, 1.5, 6), timber, { p: [0, 0.75, 0] }),
      paint(box(0.5, 0.3, 0.06), signboard, { p: [0.14, 1.34, 0], r: [0, 0, -0.06] }),
      paint(box(0.26, 0.06, 0.06), [0.85, 0.25, 0.2], { p: [0.12, 1.2, 0] }),
    ]), PAINT_REF);
    this.pool('cairn', merge([0, 1, 2, 3, 4].map(i => paint(sph(0.62 - i * 0.09, 7), stone, { p: [(i % 2 ? 0.08 : -0.06), 0.34 + i * 0.5, (i % 3 ? 0.05 : -0.05)], s: [1.2, 0.72, 1.1] }))), PAINT_REF);
    this.deer = makeDeer(this.root); this.litter = makeLitter(this.root); this.spray = makeSpray(this.scene);
    this.deerVariant = { geo: deerStanding(), mat: DEER_MAT, name: 'deer' };   // the stragglers of a deer crossing, standing in the lanes
    // set pieces: the collapsing bridge (railings, pillars, planks) and the avalanche wall
    const wood = [0.42, 0.3, 0.2], rope = [0.55, 0.45, 0.32];
    this.pool('rail', merge([paint(box(0.18, 1.1, CHUNK_LEN), wood, { p: [0, 0.55, 0] }), paint(box(0.12, 0.1, CHUNK_LEN), rope, { p: [0, 1.1, 0] }), ...[0, 1, 2, 3, 4, 5].map(i => paint(box(0.25, 1.2, 0.25), wood, { p: [0, 0.6, -CHUNK_LEN / 2 + 3 + i * 6] }))]), PAINT_REF);
    this.pool('pillar', merge([paint(box(1.2, 40, 1.2), [0.3, 0.28, 0.26], { p: [-5.5, -20, 0] }), paint(box(1.2, 40, 1.2), [0.3, 0.28, 0.26], { p: [5.5, -20, 0] }), paint(box(14, 0.8, 1.4), wood, { p: [0, -0.5, 0] })]), PAINT_REF);
    this.pool('plank', paint(box(TRACK_W * 2 + 0.8, 0.22, 1.8), wood, { p: [0, -0.11, 0] }), PAINT_REF);
    // a beat of railing for the edge of a fork deck: short, so it can follow the road as it bends away
    this.pool('forkRail', merge([paint(box(0.14, 0.9, BEAT_LEN), wood, { p: [0, 0.5, 0] }), paint(box(0.1, 0.08, BEAT_LEN), rope, { p: [0, 0.96, 0] }), paint(box(0.2, 1.0, 0.2), wood, { p: [0, 0.5, 0] })]), PAINT_REF);
    const lumps = []; for (let i = 0; i < 26; i++) { const x = (i / 25 - 0.5) * 26, r = 2.2 + ((i * 7) % 5) * 0.45; lumps.push(paint(sph(r, 8), [0.96, 0.97, 1.0], { p: [x, r * 0.7 + ((i * 3) % 4) * 0.6, ((i * 5) % 3) * 1.4 - 1.4] })); }
    for (let i = 0; i < 10; i++) lumps.push(paint(sph(1.4 + (i % 3) * 0.5, 7), [0.9, 0.93, 1.0], { p: [(i / 9 - 0.5) * 22, 5.5 + (i % 2) * 1.2, 1.5] }));
    this.avalanche = new THREE.Mesh(merge(lumps), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })); this.avalanche.visible = false; this.root.add(this.avalanche);
    this.avalancheS = null; this.thunderT = 0;
    this.snowballs = new InstancePool(this.root, sph(1, 9), new THREE.MeshStandardMaterial({ color: 0xf4f7ff, roughness: 0.95 }), 24); this.balls = [];
    // the tsunami's water wall (leans over the road from the sea side), flames for the forest fire, the local train at the level crossing
    const water = [0.05, 0.36, 0.46], crest = [0.2, 0.62, 0.7], foam = [0.92, 0.98, 1.0];
    const wall = [paint(box(12, 10, 96), water, { p: [0, 5, 0] }), paint(cyl(5, 5, 96, 14), crest, { p: [0, 10, 0], r: [Math.PI / 2, 0, 0] }), paint(cyl(3.4, 3.4, 96, 12), foam, { p: [-3, 12.2, 0], r: [Math.PI / 2, 0, 0] })];
    for (let i = 0; i < 30; i++) wall.push(paint(sph(1.2 + (i % 4) * 0.5, 7), foam, { p: [-5 - (i % 3) * 1.2, 11 + ((i * 7) % 5) * 0.8, (i / 29 - 0.5) * 92] }));
    this.tsunami = new THREE.Mesh(merge(wall), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.15, transparent: true, opacity: 0.92, emissive: new THREE.Color(0.08, 0.3, 0.36), emissiveIntensity: 0.6 })); this.tsunami.visible = false; this.root.add(this.tsunami); this.tsunamiX = null;   // self-lit a little: it must read at night
    this.flames = new InstancePool(this.root, cone(0.5, 1, 6).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.1, 0.25), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), 200);
    this.localTrain = makeLocalTrain(); this.root.add(this.localTrain); this.trainCrossing = null;
    // bō-hiya in flight: a stubby rocket with a hot cone out of the back; one mesh per rocket, pooled
    this.pool('rocket', merge([paint(cyl(0.11, 0.11, 0.9, 8), [0.16, 0.11, 0.1], { p: [0, 0, 0], r: [Math.PI / 2, 0, 0] }), paint(cyl(0.12, 0.12, 0.28, 8), [0.8, 0.19, 0.17], { p: [0, 0, 0.2], r: [Math.PI / 2, 0, 0] }),
      paint(cone(0.11, 0.3, 8), [0.72, 0.72, 0.76], { p: [0, 0, 0.6], r: [Math.PI / 2, 0, 0] }), paint(cone(0.16, 0.5, 7), [2.8, 1.3, 0.25], { p: [0, 0, -0.65], r: [-Math.PI / 2, 0, 0] }),
      paint(cone(0.08, 0.32, 6), [3.0, 2.4, 0.8], { p: [0, 0, -0.58], r: [-Math.PI / 2, 0, 0] })]), PAINT_REF);
    this.rocketMeshes = new Map();   // sim rocket -> mesh
  }

  // ---------------------------------------------------------------- forks
  //
  // The sim thinks a forked road is still six straight lanes, with runners held to their
  // own group of them (core/chunks.js, `forkAt`). Here each group's road pulls away from
  // the line of the main road and comes back: every placement goes through `_forkOffset`,
  // which adds that road's sideways drift and lift at that distance, so obstacles, coins,
  // runners, and the camera all ride their own road without knowing anything about it.
  // The roads themselves are decks bent the same way; the land underneath stays put.

  /** The mapper every placement goes through: track space -> the fork offset -> the spline. */
  _mapper() {
    return (x, h, z, ry, outPos, outQuat) => {
      const X = x + TRACK.shift; this._forkOffset(X, z, TRACK.fork, _OFF);
      return this.track.map(X + _OFF.x, h + _OFF.h, z, (ry || 0) + _OFF.yaw, outPos, outQuat);
    };
  }
  /** The fork covering distance `s`, or null: the sim's own pure function, memoised per chunk. */
  _fork(s) {
    const i = Math.floor(s / CHUNK_LEN); let f = this.forks.get(i);
    if (f === undefined) { f = this.world.cfg.forks === false ? null : forkAt(this.world.seed, i); this.forks.set(i, f); }
    return f;
  }
  /**
   * Where road `group` has got to at distance `s`: sideways drift, lift, and the angle it
   * is crabbing at (so things standing on it face along it). Out and back over the span
   * on a raised cosine, so nothing kinks at either end. With no group given the road is
   * worked out from x, and anything standing off the road belongs to the land, which
   * does not move: the offset fades to nothing across the verge.
   */
  _forkOffset(x, s, group, out) {
    out.x = 0; out.h = 0; out.yaw = 0;
    const f = this._fork(s); if (!f) return out;
    const L = f.len * CHUNK_LEN, k = (s - f.start * CHUNK_LEN) / L;
    if (k <= 0 || k >= 1) return out;
    let w = 1;
    if (group === null || group === undefined) {
      const ax = Math.abs(x); if (ax > ROAD_HALF + 9) return out;
      w = 1 - clamp01((ax - (ROAD_HALF + 2)) / 7); w = w * w * (3 - 2 * w);
      group = groupOf(x / LANE_W + (LANES_TOTAL - 1) / 2, f.groups);
    }
    const d = f.dirs[group], e = 0.5 - 0.5 * Math.cos(2 * Math.PI * k);
    out.x = d.x * f.spread * e * w; out.h = d.y * FORK_LIFT * e * w;
    out.yaw = Math.atan(d.x * f.spread * (Math.PI / L) * Math.sin(2 * Math.PI * k) * w);
    return out;
  }
  /** 0..1: how far apart the roads are at distance `s` (0 at either end of a fork, 1 in the middle; 0 off a fork). */
  _forkRamp(s) {
    const f = this._fork(s); if (!f) return 0;
    const k = (s - f.start * CHUNK_LEN) / (f.len * CHUNK_LEN);
    return k <= 0 || k >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * k);
  }
  /** Bend a floor mesh along the track: vertices go to world space, aTrack keeps (x, s) for the surface patterns. `drop` sinks it (under a fork's decks). */
  _bendFloor(floor, z0, drop = 0) {
    const g = floor.geometry, base = g.userData.base, pos = g.attributes.position.array, tr = g.attributes.aTrack.array;
    for (let i = 0; i < g.attributes.position.count; i++) {
      const x = base[i * 3], lz = base[i * 3 + 2], sAbs = z0 + CHUNK_LEN / 2 + lz;
      this.track.map(x, -drop, sAbs, 0, _V3);
      pos[i * 3] = _V3.x; pos[i * 3 + 1] = _V3.y; pos[i * 3 + 2] = _V3.z; tr[i * 2] = x; tr[i * 2 + 1] = sAbs;
    }
    g.attributes.position.needsUpdate = true; g.attributes.aTrack.needsUpdate = true; g.computeVertexNormals();
  }
  /**
   * One road of a fork: a deck the width of its lanes plus a verge, bent along the track
   * with that road's own offset, painted by the ground shader as road right up to its
   * edges. Returns the deck's span so the railings can be stood along it.
   */
  _bendDeck(deck, z0, f, g) {
    const lanes = LANES_TOTAL / f.groups, x0 = roadX(g * lanes) - LANE_W / 2, x1 = roadX(g * lanes + lanes - 1) + LANE_W / 2;
    const cx = (x0 + x1) / 2;
    const geo = deck.geometry, base = geo.userData.base, pos = geo.attributes.position.array, tr = geo.attributes.aTrack.array;
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const sAbs = z0 + CHUNK_LEN / 2 + base[i * 3 + 2];
      // Where the roads are still together the decks abut exactly and read as one road; a
      // verge grows on each as they come apart, so the split starts from a single point.
      const width = x1 - x0 + 2 * this._deckVerge(sAbs);
      const x = cx + base[i * 3] * width, h = base[i * 3 + 1];
      this._forkOffset(x, sAbs, g, _OFF); this.track.map(x + _OFF.x, h + _OFF.h, sAbs, 0, _V3);
      pos[i * 3] = _V3.x; pos[i * 3 + 1] = _V3.y; pos[i * 3 + 2] = _V3.z; tr[i * 2] = x; tr[i * 2 + 1] = sAbs;
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.aTrack.needsUpdate = true; geo.computeVertexNormals();
    const u = deck.material.uniforms; u.uRoadMin.value = x0; u.uRoadMax.value = x1;
    return { x0, x1 };
  }
  /** How much verge a fork deck carries at distance `s`: none while the roads are one, most of a metre once they are apart. */
  _deckVerge(s) { return 0.9 * Math.min(1, this._forkRamp(s) * 3); }

  _obstacleVariant(biome, type, v) {
    const list = this.obstacles[BIOMES[biome]]?.[type] || this.obstacles.mountain?.[type];
    if (!list?.length) return null;
    return list[v % list.length];
  }

  // ---------------------------------------------------------------- chunks
  _attachChunk(c) {
    const biome = c.biome, pv = provinceOf(c.index); const rng = mulberry32(mixSeed(this.world.seed ^ 0x5eed, c.index));
    const season = pv.snow ? 3 : c.season;                                    // Hokkaido is always under snow
    const night = nightAt(this.world.distance);
    const fk = this._fork(c.z0 + 1);
    const floor = this.floorPool.take(); this._bendFloor(floor, c.z0, fk ? FORK_DROP : 0);
    const u = floor.material.uniforms; u.uZ0.value = c.z0; u.uBiome.value = biome; u.uSeason.value = season; u.uSnow.value = pv.snow ? 0.9 : snowAt(c.index);
    u.uSurface.value = surfaceOf(this.world.seed, c.index);
    // under a fork the land carries no road of its own: the roads are the decks above it
    u.uRoadMin.value = fk ? -1000 : -ROAD_HALF; u.uRoadMax.value = fk ? -999 : ROAD_HALF;
    const v = { floor, decks: [], meshes: [], coins: [], powers: [], rollers: [], thrown: [], lights: [] };
    if (fk) {
      for (let g = 0; g < fk.groups; g++) {
        const deck = this.deckPool.take(); const { x0, x1 } = this._bendDeck(deck, c.z0, fk, g); v.decks.push(deck);
        const du = deck.material.uniforms; du.uZ0.value = c.z0; du.uBiome.value = biome; du.uSeason.value = season; du.uSnow.value = u.uSnow.value; du.uSurface.value = u.uSurface.value;
        TRACK.fork = g;   // the railings sit on the seam between roads: place them as this road's, not by where they stand
        for (let b = 0; b < CHUNK_LEN / BEAT_LEN; b++) {
          const s = c.z0 + BEAT_LEN * (b + 0.5); if (this._forkRamp(s) < 0.12) continue;      // no railings until the roads are actually apart
          const vg = this._deckVerge(s);
          for (const x of [x0 - vg + 0.12, x1 + vg - 0.12]) { const r = this.pools.forkRail.take(); r.position.set(x, 0, s); r.rotation.set(0, 0, 0); placeMesh(r); v.meshes.push(r); }
        }
        TRACK.fork = null;
      }
    }
    // the corridor the roads swing through on a fork: nothing is dressed there (a house in the middle of a road is a house in the middle of a road)
    const corridor = fk ? [Math.min(0, ...fk.dirs.map(d => d.x * fk.spread)) - ROAD_HALF - 5, Math.max(0, ...fk.dirs.map(d => d.x * fk.spread)) + ROAD_HALF + 5] : null;
    const inCorridor = (x) => corridor && x > corridor[0] && x < corridor[1];
    const light = (x, z, y, i, col) => { if (!inCorridor(x) && v.lights.length < MAX_LIGHTS) v.lights.push({ x, z, y, i, col }); };

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
        const halo = this.pool(`halo:${cell.kind}`, this.haloGeo, new THREE.MeshBasicMaterial({ map: this.haloTex, color: pw.ring.clone().multiplyScalar(0.9), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })).take();
        halo.position.set(x, 0.85, cell.z); placeMesh(halo);
        v.meshes.push(m, ring, halo); v.powers.push({ m, ring, halo, cell, z: cell.z, x }); light(x, cell.z, 0.8, 0.5, [pw.ring.r, pw.ring.g, pw.ring.b]);
        continue;
      }
      if (cell.type === 'wave') {
        const m = this.pools[`wave:${cell.by || 'daidarabotchi'}`].take(); m.userData.cell = cell;
        m.position.set(trackX(cell.track), 0, cell.z); placeMesh(m); m.scale.set(1, 0.001, 1); v.meshes.push(m);
        v.thrown.push({ m, cell, x: trackX(cell.track), start: null, landed: false, wave: true }); continue;
      }
      const kp = cell.thrown ? this.kaijuProps[cell.by]?.[cell.type] : null;
      const variant = kp ? { geo: kp.geo, mat: kp.mat, name: 'thrown' } : cell.herd ? this.deerVariant : this._obstacleVariant(biome, cell.type, cell.v ?? 0);
      if (!variant) continue;
      const key = kp ? `kaiju:${cell.by}:${cell.type}` : cell.herd ? 'herd:deer' : `${biome}:${cell.type}:${cell.v % 8}:${variant.name}`;
      const m = this.pool(key, variant.geo, variant.mat).take(); m.userData.cell = cell;
      const ox = cell.type === 'wide' ? x + LANE_W / 2 : x;
      const oy = cell.type === 'gap' ? 0.02 : 0, ry = cell.herd ? (rng() < 0.5 ? 1 : -1) * Math.PI / 2 + (rng() - 0.5) * 0.5 : cell.type === 'roller' || cell.type === 'wide' ? 0 : (rng() - 0.5) * 0.25;   // a straggler stands across the lane
      m.position.set(ox, oy, cell.z); m.rotation.set(0, ry, 0); placeMesh(m);   // track space → the spline, like everything else on the road
      if (kp) m.scale.setScalar(kp.scale);
      v.meshes.push(m);
      if (cell.thrown) { m.visible = false; v.thrown.push({ m, cell, x: ox, start: null, landed: false, scale: kp?.scale ?? 1 }); }
      if (variant.glow) { const g = this.pool(key + ':glow', variant.glow.geo, variant.glow.mat).take(); g.position.set(ox, oy, cell.z); g.rotation.set(0, ry, 0); placeMesh(g); v.meshes.push(g); }
      // the barrel and the buoy roll across the road; the salaryman and the Shiba run across it, facing the way they go
      if (cell.type === 'roller') { const rolls = biome === 0 || biome === 3; m.rotation.order = rolls ? 'YXZ' : 'XYZ'; v.rollers.push({ m, cell, rolls, x: null, yaw: rolls ? 0 : Math.PI }); }
    }
    // scenery is placed through the mapper: on a fork chunk anything in the corridor is buried instead, and the scenery never knows
    const realMap = TRACK.map; if (corridor) TRACK.map = (x, h, z, ry, p, q) => realMap(x, inCorridor(x) ? h - 400 : h, z, ry, p, q);
    this.scenery.dress(c, { rng, z0: c.z0, len: CHUNK_LEN, biome, season, night, light, shrine: !!pv.shrine });
    TRACK.map = realMap;
    if (!fk) {   // grass would grow up through a deck lying on the land, and litter would lie on a road that is not there any more
      this.grass.fill(c, mulberry32(mixSeed(this.world.seed ^ 0x9a55, c.index)), season, biome);
      this.flowers.fill(c, mulberry32(mixSeed(this.world.seed ^ 0xf10e, c.index)), season, biome);
      this.litter.fill(c, mulberry32(mixSeed(this.world.seed ^ 0x1eaf, c.index)), season);
    }
    if (pv.deer && !fk) this.deer.fill(c, mulberry32(mixSeed(this.world.seed ^ 0xdee4, c.index)), 5);   // not where the roads swing
    if (fireAt(c.index)) {                                                    // the forest fire: flames along both verges, an orange glow on the road
      v.flames = [];
      for (let i = 0; i < 24; i++) { const side = i % 2 ? 1 : -1, x = side * (7.8 + rng() * 9), z = c.z0 + rng() * CHUNK_LEN, s = 1.2 + rng() * 2.4; const k = this.flames.take(compose(x, 0, z, s * 0.8, s, s * 0.8, 0)); if (k >= 0) v.flames.push({ i: k, x, z, s, ph: rng() * 6.28 }); }
      this.flames.flush(); for (const z of [c.z0 + 9, c.z0 + 27]) light(0, z, 2.5, 0.9, [1, 0.45, 0.12]);
    }
    // shrine stairs: a torii tunnel up the climb, the shrine on the flat top
    const stairs = shrineClimbPitch(c.index);
    if (stairs !== null && stairs > 0) for (let i = 0; i < 6; i++) { const g = this.pools.toriiGate.take(); g.position.set(0, 0, c.z0 + 3 + i * 6); placeMesh(g); v.meshes.push(g); light(0, c.z0 + 3 + i * 6, 6.4, 0.5, [1, 0.5, 0.4]); }
    // the Hakone hike: waymarker posts up both verges of the trail, and a summit marker at the saddle
    if (hikeClimbPitch(c.index) !== null) {
      for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
        if (rng() < 0.35) continue;
        const post = this.pools.trailPost.take();
        post.position.set(side * (ROAD_HALF + 1.1), 0, c.z0 + 4 + i * 9); post.rotation.set(0, side > 0 ? 0 : Math.PI, 0); placeMesh(post); v.meshes.push(post);
      }
      if (hikeTopAt(c.index)) { const cairn = this.pools.cairn.take(); cairn.position.set(-(ROAD_HALF + 3.4), 0, c.z0 + 18); placeMesh(cairn); v.meshes.push(cairn); light(-8, c.z0 + 18, 2, 0.4, [1, 0.85, 0.6]); }
    }
    if (c.setpiece === 'bridge') {
      for (const x of [-7.3, 7.3]) { const r = this.pools.rail.take(); r.position.set(x, 0, c.z0 + CHUNK_LEN / 2); placeMesh(r); v.meshes.push(r); }
      for (const z of [c.z0 + 6, c.z0 + 30]) { const pl = this.pools.pillar.take(); pl.position.set(0, 0, z); placeMesh(pl); v.meshes.push(pl); }
      for (let i = 0; i < CHUNK_LEN / 2; i++) { const pk = this.pools.plank.take(); pk.position.set(0, 0.06, c.z0 + 1 + i * 2); pk.rotation.set(0, 0, 0); placeMesh(pk); v.meshes.push(pk); v.planks = v.planks || []; v.planks.push({ m: pk, s: c.z0 + 1 + i * 2, fall: 0, x: (rng() - 0.5) * 0.4 }); }
    }
    if (shrineTopAt(c.index)) { const sh = this.pools.shrine.take(); sh.position.set(-15.5, 0, c.z0 + 20); sh.rotation.set(0, Math.PI / 2, 0); placeMesh(sh); v.meshes.push(sh); light(-9, c.z0 + 20, 3, 0.8, [1, 0.8, 0.5]); }
    for (let i = 0; i < MAX_LIGHTS; i++) { const L = v.lights[i]; if (L) { u.uLight.value[i].set(L.x, L.z, L.y, L.i); u.uLightCol.value[i].setRGB(...L.col); } }
    u.uLightN.value = v.lights.length;
    this.views.set(c.index, v);
    this.coinPool.flush();
  }

  _detachChunk(c) {
    const v = this.views.get(c.index); if (!v) return;
    this.floorPool.give(v.floor); for (const d of v.decks) this.deckPool.give(d);
    for (const m of v.meshes) this.pools[m.userData.pool]?.give(m);
    for (const t of v.thrown) if (t.plank) { this.pools.plank.give(t.plank); t.plank = null; }
    if (v.flames) { for (const f of v.flames) this.flames.give(f.i); this.flames.flush(); }
    for (const t of v.thrown) if (t.flames) { for (const i of t.flames) this.flames.give(i); t.flames = null; if (this.kaijuState.target === t) this.kaijuState.target = null; }
    for (const coin of v.coins) { this.coinPool.give(coin.i); const k = this.coins.indexOf(coin); if (k >= 0) this.coins.splice(k, 1); }
    this.scenery.release(c.index); this.grass.release(c.index); this.flowers.release(c.index); this.litter.release(c.index); this.deer.release(c.index);
    this.views.delete(c.index);
    this.coinPool.flush();
  }

  /** Swap to a fresh world (restart) without reallocating anything. */
  reset(world) {
    const seats = world.runners.length !== this.world?.runners.length;
    this.world = world; this.track = new Track(world.seed);
    this.solo = !!world.opts.solo; TRACK.shift = 0; TRACK.fork = null;
    this.forks.clear(); TRACK.map = this._mapper();
    if (seats) this.setCharacters(this.characters);        // a different number of runners needs a different number of rigs
    for (const k of [...this.views.keys()]) this._detachChunk({ index: k });
    for (const c of world.pool.live) this._attachChunk(c);
    this.train.visible = false; this.trainTimer = 6; this.localTrain.visible = false; this.trainCrossing = null; this.deer.reset(); this.tsunami.visible = false; this.tsunamiX = null;
  }

  /** Sim events → visual reactions. */
  onEvent(e) {
    const R = e.runner !== undefined ? this.rigs[e.runner] : null;
    switch (e.type) {
      case 'recycle': this._detachChunk(e.old); this._attachChunk(e.fresh); break;
      case 'coin': { const coin = this.coins.find(k => k.cell === e.cell); if (coin) { this.coinPool.give(coin.i); coin.i = -1; this.coinPool.flush(); } break; }
      case 'power': {
        for (const v of this.views.values()) for (const pw of v.powers) if (pw.cell === e.cell) { pw.m.visible = false; pw.ring.visible = false; pw.halo.visible = false; this.shock.burst(pw.x, pw.z, this.powers[e.kind].ring); }
        break;
      }
      case 'strike': case 'transmute': {
        for (const v of this.views.values()) for (const m of v.meshes) if (m.userData.cell === e.cell) m.visible = false;
        const x = cellX(e.cell) + (e.cell.type === 'wide' || e.cell.was === 'wide' ? LANE_W / 2 : 0);
        if (e.type === 'strike') { if (e.by !== 'rocket') { this.shock.burst(x, e.cell.z, new THREE.Color(1.8, 1.9, 2.6)); this.flash = 1; } }   // a rocket's strikes share one blast
        else { const i = this.coinPool.take(compose(x, 0.75, e.cell.z, 1, 1, 1, 0)); const coin = { i, x, y: 0.75, z: e.cell.z, cell: e.cell }; for (const v of this.views.values()) if (v.coins.some(c => Math.abs(c.z - e.cell.z) < CHUNK_LEN)) { v.coins.push(coin); break; } this.coins.push(coin); this.coinPool.flush(); this.shock.burst(x, e.cell.z, new THREE.Color(2.4, 1.8, 0.5)); }
        break; }
      case 'shield': case 'smash': {
        this.shock.burst(roadX(this.world.runners[e.runner].xLane), this.world.distance, e.type === 'shield' ? new THREE.Color(1.5, 2.2, 2.6) : new THREE.Color(2.4, 1.6, 0.8));
        if (e.cell) for (const v of this.views.values()) for (const m of v.meshes) if (m.userData.cell === e.cell) m.visible = false;   // punched clean through it
        break; }
      case 'bump': {
        // Two runners hit: a shower of sparks at the point of contact, tinted by the pair
        // that made it, so a barge is unmistakable even in a crowded pack.
        const m = this.world.runners[e.mover];
        const x = roadX(e.at ?? m.xLane), y = Math.max(0.35, m.y + 0.5);
        this.shock.burst(x, this.world.distance, new THREE.Color(2.2, 1.8, 1.2));
        const a = this.rigs[e.mover]?.color, b = e.victim >= 0 ? this.rigs[e.victim]?.color : null;
        this.sparks.burst(x, y, this.world.distance, _COL.setRGB(2.6, 2.1, 1.1), 22, 5.5, 1.1);
        if (a) this.sparks.burst(x, y, this.world.distance, _COL.copy(a).multiplyScalar(2.2), 10, 4.2, 1.2);
        if (b) this.sparks.burst(x, y, this.world.distance, _COL.copy(b).multiplyScalar(2.2), 10, 4.2, 1.2);
        break; }
      case 'crossing': this.trainCrossing = { x: -80, z: e.z }; this.localTrain.visible = true; break;
      case 'herd': this.deer.cross(e.z, 9); break;
      case 'rocket.fire': this.sparks.burst(roadX(e.lane), 0.9, this.world.distance + 1, _COL.setRGB(2.8, 1.6, 0.5), 18, 4, 0.8); break;
      case 'rocket.hit': {
        // the blast: a shock ring on the road, a fireball of sparks, the frame lit for an instant
        const x = roadX(e.lane);
        this.shock.burst(x, e.z, new THREE.Color(2.6, 1.2, 0.3));
        this.sparks.burst(x, 0.8, e.z, _COL.setRGB(2.8, 1.5, 0.35), 70, 9, 1.5);
        this.sparks.burst(x, 0.6, e.z, _COL.setRGB(2.2, 0.6, 0.15), 40, 6.5, 1.6);
        this.sparks.burst(x, 1.2, e.z, _COL.setRGB(1.2, 1.1, 1.0), 26, 4, 1.1);
        this.flash = Math.max(this.flash, 0.6 + Math.min(0.4, e.n * 0.08));
        break; }
      case 'stumble': this.shake = Math.max(this.shake, 0.18); if (R) R.hurt = 0.6; break;
      case 'fall': this.shake = Math.max(this.shake, 0.3); if (R) R.hurt = 1.0; break;
      case 'death': this.shake = 0.5; for (const r of this.rigs) r.hurt = 2; break;
    }
  }

  // ---------------------------------------------------------------- frame
  render(dt) {
    const w = this.world; this.time += dt; this._adapt(dt);
    const idx = Math.floor(w.distance / CHUNK_LEN); const biome = biomeOf(idx), season = seasonOf(idx);
    const seasonT = (idx % SEASON_LEN) / SEASON_LEN; const pv = provinceOf(idx); const vSeason = pv.snow ? 3 : season;
    const night = nightAt(w.distance) * (w.dawnT > 0 ? Math.max(0, 1 - w.dawnT / 2.5) : 1);   // Amaterasu: the sun comes up
    const dread = 1 - Math.max(0, w.storm) / W.STORM_MAX;
    const wx = w.weather || { fog: 0, rain: 0, gust: 0, id: 'clear' };
    this.track.ensure(idx + 8);

    // ---- theme → lights, fog, ground
    const th = getTheme(season, night, biome);
    this.sun.color.copy(th.sun); this.sun.intensity = th.sunIntensity; this.sun.position.set(60, 46 - 30 * night, 140);
    this.hemi.color.copy(th.hemiSky); this.hemi.groundColor.copy(th.hemiGround); this.hemi.intensity = th.hemiIntensity;
    this.ambient.intensity = th.ambient; this.scene.fog.color.copy(th.fog).lerp(new THREE.Color(0.55, 0.58, 0.64), Math.min(1, wx.fog * 0.8 + wx.rain * 0.5)); this.base.material.color.copy(th.fog).multiplyScalar(0.55);
    const fire = w.setpiece === 'fire' || !!w.kaiju?.fire;   // the forest fire, or Gojira on the skyline: smoke, embers, firelight
    const wet = Math.max(clamp01((dread - 0.35) / 0.5) + (season === 1 && night > 0.35 && night < 0.65 ? 0.4 : 0), wx.rain, w.setpiece === 'tsunami' ? 1 : 0);
    if (fire) { this.scene.fog.color.lerp(_COL.setRGB(0.5, 0.27, 0.12), 0.6); this.hemi.color.lerp(_COL.setRGB(1, 0.55, 0.25), 0.5); this.ambient.intensity += 0.2; }   // smoke and firelight
    // weather → visibility, sky mood, lightning
    // Visibility stays generous: fog pulls the far plane in, never the near one, so the
    // road you have to read is always clear even in the worst of it.
    const fogK = Math.min(0.7, wx.fog + dread * 0.12 + (fire ? 0.3 : 0));
    this.scene.fog.near += ((52 - 8 * fogK) - this.scene.fog.near) * Math.min(1, dt * 0.8); this.scene.fog.far += ((300 - 70 * fogK) - this.scene.fog.far) * Math.min(1, dt * 0.8);
    if (wx.id === 'thunder' && Math.random() < dt * 0.12) this.thunderT = 1;
    this.thunderT *= Math.exp(-dt * 10);
    for (const v of this.views.values()) for (const m of [v.floor, ...v.decks]) { const u = m.material.uniforms; u.uTime.value = this.time; u.uNight.value = night; u.uWet.value = wet; }
    const windStrength = (season === 2 ? 1.3 : season === 3 ? 0.9 : 0.7) + dread * 1.2 + (wx.gust ? 0.6 : 0) + (w.gust ? 1.8 : 0);
    this.wind.set(0.35 * Math.sin(this.time * 0.13), 0, 1).normalize().multiplyScalar(windStrength);
    this.sky.update(dt, { night, season: vSeason, seasonT, time: this.time, wind: this.wind, biome, dread: Math.min(1, dread + wx.rain * 0.5 + wx.fog * 0.3), water: pv.water, fujiScale: pv.fuji }, this.camera);
    this.grass.update(dt, this.wind, night, vSeason); this.flowers.update(dt, this.wind, night, vSeason);
    this.scenery.update(dt, { night, time: this.time, season: vSeason, biome, dt, s: w.distance });
    this.particles.update(dt, { season: vSeason, biome, night, scroll: w.speed, wind: this.wind, dread: Math.max(dread * 0.45, wx.rain * 0.45, wx.id === 'blizzard' ? 0.22 : 0), fire });
    const active = w.runners.filter(r => !r.disabled);
    this.deer.update(dt, w.distance);
    this.litter.update(dt, active.map(r => ({ x: roadX(r.xLane), s: w.distance, y: r.y })), this.wind, w.speed);
    const sprayKind = w.setpiece === 'avalanche' || vSeason === 3 ? 'snow' : wet > 0.3 ? 'rain' : biome === 3 ? 'sand' : biome === 0 ? 'dust' : null;
    this.spray.update(dt, active.map(r => ({ x: roadX(r.xLane), s: w.distance, y: r.y, moving: w.alive && w.speed > 1 })), sprayKind, w.speed);
    this.shock.update(dt); this.sparks.update(dt); this.splash.update(dt);

    // ---- runners
    if (w.alive) this.phase += dt * Math.max(6, w.speed * 1.5);
    let leanSum = 0;
    for (const R of this.rigs) {
      const p = w.runners[R.idx]; const g = R.rig.group;
      if (!p || p.disabled) { g.visible = false; R.shadow.visible = false; R.ring.visible = false; continue; }
      R.shadow.visible = true; R.ring.visible = true;
      const px = roadX(p.xLane);
      const slide = p.action === 'slide', air = !p.grounded;
      const laneVel = R.prevX === null ? 0 : (px - R.prevX) / Math.max(dt, 1e-3); R.prevX = px;
      R.lean += ((-laneVel * 0.05) - R.lean) * Math.min(1, dt * 10); leanSum += R.lean;
      g.position.set(px, p.y + (p.grounded && !slide ? 0.035 * Math.abs(Math.sin(this.phase)) : 0), w.distance);
      R.rig.legs.forEach((l, i) => { l.rotation.x = air ? 0.9 : Math.sin(this.phase + (i % 2 ? Math.PI : 0) + (i >= 2 ? Math.PI * 0.5 : 0)) * 0.95; });
      if (R.rig.tail) { R.rig.tail.rotation.z = Math.sin(this.phase * 0.5) * 0.3; R.rig.tail.rotation.x = air ? -0.5 : 0; }
      const dash = p.dashT > 0, fly = p.jetpackT > 0, S = CHAR_SCALE;
      g.scale.set(S * (dash ? 1.1 : 1), S * (slide ? 0.55 : dash ? 1.1 : 1), S * (slide ? 1.25 : dash ? 1.2 : 1));
      g.rotation.set(slide ? 0.25 : fly ? -0.32 : air ? -0.25 : 0, -laneVel * 0.06, -R.lean); placeMesh(g);
      R.jet.material.opacity += ((fly ? 1 : 0) - R.jet.material.opacity) * Math.min(1, dt * 8); R.jet.scale.set(0.9 + 0.3 * Math.sin(this.time * 40), 1.5 + 0.6 * Math.sin(this.time * 33), 1);
      if (fly) { for (let k = 0; k < 3; k++) R.trail.emit(px + (Math.random() - 0.5) * 0.3, p.y - 0.15 + Math.random() * 0.3, w.distance - 0.9 - k * 0.3, dt, true, _COL.setRGB(2.4, 0.9 + Math.random() * 0.6, 0.15)); }
      if (fly) R.rig.legs.forEach(l => { l.rotation.x = 0.9; });
      g.visible = !(p.iT > 0 && Math.floor(this.time * 18) % 2 === 0);
      R.hurt = Math.max(0, R.hurt - dt);
      const hurtGlow = R.hurt > 0 ? 0.5 + 0.5 * Math.sin(this.time * 40) : 0;
      if (dash) { const hue = (this.time * 1.6) % 1; _COL.setHSL(hue, 1, 0.55); for (const m of R.rig.mats) if (m.emissive) m.emissive.copy(_COL).multiplyScalar(0.7); }   // star run: rainbow flicker
      else for (const m of R.rig.mats) if (m.emissive) m.emissive.setRGB(hurtGlow, hurtGlow * 0.1, 0);
      R.bubble.visible = p.shield; R.bubble.scale.setScalar(1 + 0.05 * Math.sin(this.time * 6));
      R.aura.material.opacity += ((p.magnetT > 0 ? 0.8 : 0) - R.aura.material.opacity) * Math.min(1, dt * 6);
      R.shadow.position.set(px, 0.015, w.distance); R.shadow.rotation.set(-Math.PI / 2, 0, 0); placeMesh(R.shadow); const sh = Math.max(0.3, 1 - p.y * 0.3); R.shadow.scale.set(sh * S, sh * S, 1); R.shadow.material.opacity = 0.4 * sh;
      R.ring.position.set(px, 0.02, w.distance); R.ring.rotation.set(-Math.PI / 2, 0, 0); placeMesh(R.ring);
      const rk = S * (1 + 0.06 * Math.sin(this.time * 4 + R.idx)); R.ring.scale.set(rk, rk, 1); R.ring.material.opacity = 0.35 + 0.3 * sh;
      R.trail.emit(px, p.y, w.distance, dt, w.alive && w.speed > 1);
    }

    // ---- camera: follows the road's own frame — behind on the spline, aimed at a point ahead on the spline, up = road normal.
    // Smoothly damped; no roll, no jitter. Turns and crests read because the camera looks *into* them before the runners arrive.
    const cam = this.camera;
    const targetFov = 66 + 10 * clamp01((w.speed - P.SPEED_BASE) / (P.SPEED_MAX - P.SPEED_BASE));
    cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-dt * 0.9)); cam.updateProjectionMatrix();
    const act = w.runners.filter(r => !r.disabled);
    // Through a fork the camera stays with one runner (yours, online) and rides that runner's
    // road; between forks it drifts to where the whole pack is, as it always has.
    const fk = this._fork(w.distance), focus = (w.runners[this.focus] && !w.runners[this.focus].disabled ? w.runners[this.focus] : act[0]) || null;
    const cxRaw = fk && focus ? roadX(focus.xLane) : act.reduce((a, r) => a + roadX(r.xLane), 0) / Math.max(1, act.length);
    TRACK.fork = fk && focus ? groupOf(focus.xLane, fk.groups) : null;
    // Everything the camera does is exponentially damped and deliberately unhurried: it
    // drifts to where the pack is rather than tracking it, so lane changes read as glides.
    this.camX = (this.camX ?? cxRaw) + (cxRaw - (this.camX ?? cxRaw)) * (1 - Math.exp(-dt * 2.4));
    const fb = this.track.frameAt(Math.max(0, w.distance - 8.5));
    const slope = Math.asin(THREE.MathUtils.clamp(fb.T.y, -1, 1));
    TRACK.map(this.camX * 0.75, 5.2 + Math.max(0, -slope) * 4, Math.max(0, w.distance - 8.5), 0, _V3);
    const camUp = _V3b.copy(fb.N).lerp(_UP, 0.35).normalize();
    TRACK.map(this.camX * 0.45, 1.3, w.distance + 22, 0, _V3c); const aim = _V3c;
    TRACK.fork = null;
    if (!this.camInit) { cam.position.copy(_V3); this.camInit = true; }
    cam.position.lerp(_V3, 1 - Math.exp(-dt * 4.2));
    _M4.lookAt(cam.position, aim, camUp); _Q1.setFromRotationMatrix(_M4);
    cam.quaternion.slerp(_Q1, 1 - Math.exp(-dt * 3.6));
    this.shake = 0;
    // things that ride with the camera / runners
    this.sky.group.position.set(cam.position.x, 0, cam.position.z);
    const fr = this.track.frameAt(w.distance); this.fxGroup.position.copy(fr.P); this.fxGroup.quaternion.copy(this.track.quatAt(w.distance));

    // ---- typhoon
    this.storm.position.y = 38 - dread * 14 + (w.alive ? 0 : -9);   // the cloud bank stays higher: less of the frame taken
    this.storm.material.uniforms.uTime.value = this.time;
    if (dread > 0.6 && Math.random() < dt * (0.05 + dread * 0.25)) this.flash = 1;
    this.flash = Math.max(this.flash * Math.exp(-dt * 12), this.thunderT); this.storm.material.uniforms.uFlash.value = this.flash; this.flashLight.intensity = this.flash * 2.5;
    if (fire) { this.flashLight.color.setRGB(1, 0.5, 0.2); this.flashLight.intensity = Math.max(this.flashLight.intensity, 0.45 + 0.3 * Math.sin(this.time * 23) * Math.sin(this.time * 7)); } else this.flashLight.color.setHex(0xdde6ff);   // firelight flickers

    // ---- rockets: each one in flight gets a mesh for as long as the sim says it is flying
    for (const r of w.rockets) {
      let m = this.rocketMeshes.get(r); if (!m) { m = this.pools.rocket.take(); this.rocketMeshes.set(r, m); }
      m.position.set(roadX(r.lane), 0.9 + 0.05 * Math.sin(this.time * 30), r.z); m.rotation.set(0, 0, 0); m.scale.setScalar(1.15); placeMesh(m);
      this.sparks.burst(roadX(r.lane) + (Math.random() - 0.5) * 0.2, 0.85, r.z - 0.8, _COL.setRGB(2.6, 1.3 + Math.random() * 0.6, 0.3), 2, 1.5, 0.35);
    }
    for (const [r, m] of this.rocketMeshes) if (!w.rockets.includes(r)) { this.pools.rocket.give(m); this.rocketMeshes.delete(r); }
    // ---- coins, powers, rollers
    const spin = this.time * 3;
    for (const c of this.coins) if (c.i >= 0) this.coinPool.set(c.i, compose(c.x, c.y + 0.08 * Math.sin(this.time * 4 + c.z), c.z, 1, 1, 1, spin + c.z));
    this.coinPool.flush();
    for (const v of this.views.values()) {
      for (const pw of v.powers) { pw.m.position.set(pw.x, 0.55 + 0.12 * Math.sin(this.time * 3 + pw.z), pw.z); pw.m.rotation.set(0, this.time * 1.6, 0); pw.m.scale.setScalar(1.45); placeMesh(pw.m); if (this.powers[pw.cell.kind]?.billboard) pw.m.quaternion.copy(this.camera.quaternion); const k = 1 + 0.12 * Math.sin(this.time * 5 + pw.z); pw.ring.scale.set(k, k, 1); pw.halo.quaternion.copy(this.camera.quaternion); pw.halo.scale.setScalar(1.1 + 0.15 * Math.sin(this.time * 4 + pw.z)); }
      for (const r of v.rollers) {
        const x = roadX(r.cell.track * LANES + rollerLaneAt(r.cell, w.tick)), vx = r.x === null ? 0 : x - r.x; r.x = x;
        if (r.rolls) { r.m.rotation.set(x / 0.5, Math.PI / 2, 0); r.m.position.set(x, 0, r.cell.z); }                 // axis along the road, turning with the ground it covers
        else {
          // a prop's own +x is the sim's -x once mapped, so running toward +x means facing the other way; turns are eased at the ends of the sweep
          if (Math.abs(vx) > 1e-4) { const want = vx > 0 ? Math.PI : 0; r.yaw += (want - r.yaw) * Math.min(1, dt * 9); }
          r.m.rotation.set(0, r.yaw, 0); r.m.position.set(x, Math.abs(Math.sin(this.time * 14 + r.cell.z)) * 0.05, r.cell.z);
        }
        placeMesh(r.m);
      }
    }
    // ---- kaiju: rises beside the road for the last chunks of a season, stomps, and throws
    const K = this.kaijuState, kj = w.kaiju;
    if (kj && kj.id !== K.id) { K.id = kj.id; K.side = kj.side; K.y = -42; K.throwT = 9; }
    if (!this.breath) { this.breath = []; for (let i = 0; i < 14; i++) this.breath.push(this.flames.take(_M4.makeScale(0, 0, 0))); }
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
      if (r.mouth) {
        // Gojira: the jaw drops and a tongue of flame reaches from the mouth to whatever it just threw, for the first moment of its flight
        const breathing = K.target && !K.target.landed && K.throwT < 1.0 && K.target.m.visible;
        r.mouth.parent.children[1].rotation.x = 0.35 + (breathing ? 0.5 : 0);
        r.mouth.getWorldPosition(_V3b); const to = K.target?.m.position;
        for (let i = 0; i < this.breath.length; i++) {
          const q = (i + 0.5) / this.breath.length;
          if (!breathing || !to) { this.flames.set(this.breath[i], _M4.makeScale(0, 0, 0)); continue; }
          _V3.lerpVectors(_V3b, to, q * Math.min(1, K.throwT * 2.2)); _V3.y += Math.sin(q * Math.PI) * 2;
          const k = (1.2 + 2.8 * Math.sin(q * Math.PI)) * (1 - K.throwT * 0.8) * (0.85 + 0.3 * Math.sin(this.time * 31 + i));
          this.flames.set(this.breath[i], _M4.compose(_V3, _Q1.identity(), _V3c.set(k, k * 1.6, k)));
        }
      }
      if (!kj) K.id = K.y <= -41 ? null : K.id;
    }
    for (const v of this.views.values()) for (const t of v.thrown) {
      if (t.landed) continue;
      const lead = w.speed * 1.5 + 8, dz = t.cell.z - w.distance;
      if (dz > lead) continue;
      if (!t.start) {
        const by = t.cell.by;   // the avalanche throws from behind, the tsunami from the sea, the fire drops from both verges, a kaiju from its arm
        t.start = by === 'avalanche' ? { x: t.x + (Math.random() - 0.5) * 8, y: 9, z: w.distance - 16 }
          : by === 'tsunami' ? { x: 36, y: 8, z: t.cell.z + 18 }
          : by === 'fire' ? { x: ((t.cell.v ?? 0) % 2 ? 1 : -1) * 14, y: 10, z: t.cell.z + 5 }
          : by === 'rockfall' ? { x: -26, y: 16, z: t.cell.z + 12 }        // down the slope on the uphill side of the trail
          : { x: K.side * 2, y: 30, z: w.distance + 100 };
        if (!SETPIECE[by]) { K.throwT = 0; K.target = t; } t.m.visible = true;
        if (by === 'gojira' && !t.flames) { t.flames = []; for (let i = 0; i < 3; i++) t.flames.push(this.flames.take(_M4.makeScale(0, 0, 0))); }   // it arrives burning
      }
      const p = clamp01(1 - (dz - 4) / (lead - 4));
      if (t.cell.by === 'bridge') {
        // the deck gives way: the plank under this gap drops away just before the runners arrive
        t.m.visible = p >= 0.55; if (!t.plank) { t.plank = this.pools.plank.take(); t.plank.scale.set(LANE_W / (TRACK_W * 2 + 0.8), 1, 1.6); }
        const f = clamp01((p - 0.35) / 0.65); t.plank.position.set(t.x, 0.06 - f * f * 24, t.cell.z + 0.6); t.plank.rotation.set(f * 1.8, 0, f * 0.6); placeMesh(t.plank); t.plank.visible = f < 1;
        if (p >= 1) { t.landed = true; this.pools.plank.give(t.plank); t.plank = null; }
        continue;
      }
      if (t.wave) { t.m.scale.set(1, Math.max(0.001, p), 1); }
      else { t.px = lerp(t.start.x, t.x, p); t.py = lerp(t.start.y, 0, p) + Math.sin(p * Math.PI) * 9; t.pz = lerp(t.start.z, t.cell.z, p); t.m.position.set(t.px, t.py, t.pz); t.m.rotation.set(p * 6 * (t.cell.v % 2 ? 1 : -1), 0, 0); placeMesh(t.m); }
      if (p >= 1) {
        t.landed = true; t.px = t.x; t.py = 0; t.pz = t.cell.z; t.m.position.set(t.x, t.cell.type === 'gap' ? 0.02 : 0, t.cell.z); t.m.rotation.set(0, 0, 0); placeMesh(t.m);
        const kc = new THREE.Color(...(KAIJU.find(k => k.id === t.cell.by)?.color || [1, 1, 1])).multiplyScalar(1.5);
        this.shock.burst(t.x, t.cell.z, kc);
        // whatever landed throws something off the road: water, snow, or trail dust
        const by = t.cell.by;
        const spray = by === 'tsunami' ? _COL.setRGB(0.5, 1.3, 1.6) : by === 'avalanche' ? _COL.setRGB(1.5, 1.6, 1.75)
          : by === 'rockfall' ? _COL.setRGB(0.85, 0.72, 0.55) : by === 'fire' ? _COL.setRGB(2.4, 1.0, 0.25) : kc;
        this.splash.burst(t.x, 0.3, t.cell.z, spray, 16, 4.5, 1.3);
      }
    }
    // bridge deck crumbling behind the runners; the avalanche wall chasing them
    for (const v of this.views.values()) if (v.planks) for (const pk of v.planks) {
      if (pk.fall === 0 && pk.s < w.distance - 3) pk.fall = 0.001;
      if (pk.fall > 0 && pk.fall < 1) { pk.fall = Math.min(1, pk.fall + dt * 0.9); const f = pk.fall; pk.m.position.set(pk.x * 3, 0.06 - f * f * 26, pk.s); pk.m.rotation.set(f * 1.2 * (pk.x > 0 ? 1 : -1), 0, f * 0.5); placeMesh(pk.m); pk.m.visible = f < 1; }
    }
    // Set pieces break over the road itself: the tsunami throws water across the lanes,
    // the avalanche throws snow. Bursts land in track space, so they wash along the road.
    this.splashT -= dt;
    if (this.splashT <= 0 && (w.setpiece === 'tsunami' || w.setpiece === 'avalanche')) {
      const sea = w.setpiece === 'tsunami';
      this.splashT = sea ? 0.1 : 0.13;
      const col = sea ? _COL.setRGB(0.55, 1.35, 1.6) : _COL.setRGB(1.5, 1.6, 1.75);
      for (let k = 0; k < 3; k++) {
        const x = (Math.random() - 0.5) * ROAD_HALF * 2.2;
        const s = w.distance + 6 + Math.random() * 46;
        // the water comes over from the sea side, the snow from behind and above
        this.splash.burst(sea ? Math.max(x, 2) : x, sea ? 1.2 + Math.random() * 2.4 : 2.2 + Math.random() * 3, s, col, sea ? 14 : 11, sea ? 7 : 5.5, sea ? 1.5 : 1.2);
      }
    }
    if (w.setpiece === 'avalanche') {
      this.avalancheS = this.avalancheS ?? w.distance - 40; this.avalancheS += (w.distance - 24 - this.avalancheS) * Math.min(1, dt * 0.8);
      this.avalanche.visible = true; this.avalanche.position.set(0, -0.5 + Math.sin(this.time * 7) * 0.3, this.avalancheS); this.avalanche.rotation.set(Math.sin(this.time * 3) * 0.04, 0, 0); placeMesh(this.avalanche);
      // snow boulders overtake on both verges and tumble past
      if (!this.balls.length) for (let i = 0; i < 24; i++) { const side = i % 2 ? 1 : -1; const b = { x: side * (8.5 + Math.random() * 6), s: w.distance - 30 + Math.random() * 60, r: 0.9 + Math.random() * 1.6, v: 6 + Math.random() * 10, rot: Math.random() * 6, i: -1 }; b.i = this.snowballs.take(compose(b.x, b.r, b.s, b.r, b.r, b.r, b.rot)); this.balls.push(b); }
      for (const b of this.balls) { b.s += (w.speed + b.v) * dt; b.rot += dt * b.v / b.r; if (b.s > w.distance + 55) { b.s = w.distance - 30 - Math.random() * 20; b.x = (b.x < 0 ? -1 : 1) * (8.5 + Math.random() * 6); } this.snowballs.set(b.i, compose(b.x, b.r * 0.9 + Math.abs(Math.sin(b.rot * 0.7)) * 0.3, b.s, b.r, b.r, b.r, b.rot)); }
      this.snowballs.flush();
    } else if (this.avalanche.visible) {
      this.avalancheS -= 25 * dt; this.avalanche.position.set(0, -0.5, this.avalancheS); placeMesh(this.avalanche);
      for (const b of this.balls) this.snowballs.give(b.i); this.balls.length = 0; this.snowballs.flush();
      if (this.avalancheS < w.distance - 90) { this.avalanche.visible = false; this.avalancheS = null; }
    }
    // the tsunami: a water wall rolls in from the sea side, leans over the road, then recedes when the stretch is done
    if (w.setpiece === 'tsunami') {
      this.tsunamiX = this.tsunamiX ?? 70; this.tsunamiX += (14 - this.tsunamiX) * Math.min(1, dt * 0.8);
      const m = this.tsunami; m.visible = true; m.position.set(this.tsunamiX, -2 + Math.sin(this.time * 2.3) * 0.7, w.distance + 26); m.rotation.set(0, 0, 0.32 + Math.sin(this.time * 1.6) * 0.06); placeMesh(m);
    } else if (this.tsunami.visible) {
      this.tsunamiX += 22 * dt; this.tsunami.position.set(this.tsunamiX, -2, w.distance + 26); this.tsunami.rotation.set(0, 0, 0.2); placeMesh(this.tsunami);
      if (this.tsunamiX > 90) { this.tsunami.visible = false; this.tsunamiX = null; }
    }
    // whatever Gojira threw keeps burning where it lies, until a runner or a rocket takes it off the road
    for (const v of this.views.values()) for (const t of v.thrown) if (t.flames) {
      const on = t.px !== undefined && t.m.visible;
      t.flames.forEach((fi, i) => {
        if (!on) { this.flames.set(fi, _M4.makeScale(0, 0, 0)); return; }
        const k = 1.1 + 0.5 * Math.sin(this.time * 12 + i * 2.1 + t.cell.z), dx = (i - 1) * 0.55 + Math.sin(this.time * 5 + i) * 0.12;
        this.flames.set(fi, compose(t.px + dx, t.py + 0.15, t.pz + (i % 2 ? 0.3 : -0.3), k * 0.7, k, k * 0.7, 0));
      });
    }
    // the forest fire: flames flicker on the verges
    for (const v of this.views.values()) if (v.flames) for (const f of v.flames) { const k = f.s * (0.8 + 0.35 * Math.sin(this.time * 11 + f.ph) * Math.sin(this.time * 7.3 + f.ph * 2)); this.flames.set(f.i, compose(f.x + Math.sin(this.time * 5 + f.ph) * 0.15, 0, f.z, k * 0.8, k, k * 0.8, 0)); }
    this.flames.flush();
    // the local train at the level crossing: crosses the road on the rails, left to right, before the runners arrive
    if (this.trainCrossing) { const tc = this.trainCrossing; tc.x += 40 * dt; this.localTrain.position.set(tc.x, 0, tc.z); this.localTrain.rotation.set(0, Math.PI / 2, 0); placeMesh(this.localTrain); if (tc.x > 90) { this.localTrain.visible = false; this.trainCrossing = null; } }
    // shinkansen on the city viaduct
    // the elevated city train runs 16 m off the road at 6.6 m up: exactly where a forked road might swing, so it keeps clear of forks altogether
    if (this.train.visible) { this.trainS -= 62 * dt; this.train.position.set(16, 6.6, this.trainS); this.train.rotation.set(0, 0, 0); placeMesh(this.train); if (this.trainS < w.distance - 70 || this._fork(this.trainS)) this.train.visible = false; }
    else if (biome === 1 && !this._fork(w.distance + 230) && !this._fork(w.distance + 120) && (this.trainTimer -= dt) <= 0) { this.trainTimer = 9 + Math.random() * 8; this.train.visible = true; this.trainS = w.distance + 230; }

    this.composer.render();
  }
}
