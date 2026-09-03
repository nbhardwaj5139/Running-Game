// Instanced grass and flowers with a wind vertex shader (Ghost of Tsushima
// fields). Colours by season; fills are deterministic per chunk.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { InstancePool, compose } from './common.js';
import { CHUNK_LEN } from '../core/chunks.js';

/** Inject wind bending into a Lambert material (keeps fog, lights, instancing, vertex colours). */
function windify(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uWind; uniform float uStrength;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hh = clamp(uv.y, 0.0, 1.0); hh *= hh;
        #ifdef USE_INSTANCING
          vec4 wp = instanceMatrix * vec4(position, 1.0);
        #else
          vec4 wp = vec4(position, 1.0);
        #endif
        float gust = 0.5 + 0.5 * sin(uTime * 1.6 + wp.z * 0.12 + wp.x * 0.07) * sin(uTime * 0.7 + wp.x * 0.05);
        float sway = (0.3 + 0.7 * gust) * uStrength;
        transformed.x += hh * (uWind.x * 0.7 * sway + sin(uTime * 2.8 + wp.z * 0.9) * 0.06);
        transformed.z += hh * (uWind.z * 0.7 * sway + cos(uTime * 2.3 + wp.x * 0.8) * 0.06);`);
  };
  mat.customProgramCacheKey = () => 'wind';
  return mat;
}

function bladeGeometry() {
  const a = new THREE.PlaneGeometry(0.16, 1, 1, 3); a.translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  return mergeGeometries([a, b], false);
}
function plumeGeometry() {           // susuki: a taller blade with a soft plume on top
  const g = bladeGeometry(); g.scale(1.1, 1.6, 1.1);
  const p = new THREE.SphereGeometry(0.11, 5, 4); p.scale(1, 2.2, 1); p.translate(0, 1.65, 0);
  const uv = p.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1);
  return mergeGeometries([g, p], false);
}

const GRASS = [   // per season: [colour a, colour b, height, density]
  [[0.42, 0.72, 0.28], [0.62, 0.84, 0.36], 0.8, 1.0],
  [[0.22, 0.56, 0.2], [0.36, 0.7, 0.26], 1.0, 1.0],
  [[0.86, 0.66, 0.28], [0.72, 0.5, 0.22], 1.15, 0.9],
  [[0.72, 0.66, 0.5], [0.6, 0.56, 0.46], 0.6, 0.3],
];

export function makeGrass(parent) {
  const uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(0, 0, 1) }, uStrength: { value: 0.7 } };
  const mat = windify(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), uniforms);
  const blades = new InstancePool(parent, bladeGeometry(), mat, 5200);
  const plumes = new InstancePool(parent, plumeGeometry(), mat, 900);
  const chunks = new Map(); const col = new THREE.Color();
  return {
    fill(chunk, rng, season, biome) {
      if (biome === 1) return;
      const [ca, cb, height, dens] = GRASS[season];
      const density = dens * (biome === 2 ? 0.4 : 1);
      const n = Math.floor(560 * density); const list = [];
      for (let i = 0; i < n; i++) {
        const side = biome === 3 ? -1 : (rng() < 0.5 ? -1 : 1);
        const x = side * (8.4 + Math.pow(rng(), 0.8) * 32), z = chunk.z0 + rng() * CHUNK_LEN;
        const h = height * (0.7 + rng() * 0.6), s = 0.8 + rng() * 0.5;
        col.setRGB(ca[0] + (cb[0] - ca[0]) * rng(), ca[1] + (cb[1] - ca[1]) * rng(), ca[2] + (cb[2] - ca[2]) * rng());
        const plume = season === 2 && rng() < 0.22;
        const pool = plume ? plumes : blades;
        const i2 = pool.take(compose(x, 0, z, s, h, s, rng() * Math.PI), col);
        if (i2 >= 0) list.push([pool, i2]);
      }
      chunks.set(chunk.index, list); blades.flush(); plumes.flush();
    },
    release(index) { const l = chunks.get(index); if (!l) return; for (const [pool, i] of l) pool.give(i); chunks.delete(index); blades.flush(); plumes.flush(); },
    update(dt, wind, night, season) { uniforms.uTime.value += dt; uniforms.uWind.value.copy(wind).normalize(); uniforms.uStrength.value = Math.min(2.2, wind.length()); },
  };
}

const FLOWERS = [   // per season: [{colours, size, y, count, biomes, drift}]
  [{ c: [[1, 0.95, 0.97], [1, 0.72, 0.84]], r: 0.12, y: 0.3, n: 90, b: [0, 2, 3] }],
  [{ c: [[1, 0.85, 0.2], [1, 0.7, 0.1]], r: 0.2, y: 0.55, n: 70, b: [2] }, { c: [[0.45, 0.55, 0.95], [0.7, 0.6, 0.95]], r: 0.3, y: 0.4, n: 40, b: [0] }],
  [{ c: [[1, 0.12, 0.1], [0.95, 0.25, 0.15]], r: 0.16, y: 0.5, n: 110, b: [0, 2, 3], drift: true }],
  [{ c: [[0.85, 0.1, 0.15], [0.9, 0.2, 0.25]], r: 0.14, y: 0.35, n: 10, b: [0, 2] }],
];
export function makeFlowers(parent) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 });
  const heads = new InstancePool(parent, new THREE.SphereGeometry(1, 6, 5), mat, 1400);
  const chunks = new Map(); const col = new THREE.Color();
  return {
    fill(chunk, rng, season, biome) {
      if (biome === 1) return;
      const list = [];
      for (const f of FLOWERS[season]) {
        if (!f.b.includes(biome)) continue;
        let cx = 0, cz = 0;
        for (let i = 0; i < f.n; i++) {
          if (f.drift ? i % 12 === 0 : true) { const side = biome === 3 ? -1 : (rng() < 0.5 ? -1 : 1); cx = side * (9 + rng() * 26); cz = chunk.z0 + rng() * CHUNK_LEN; }
          const x = f.drift ? cx + (rng() - 0.5) * 4 : cx, z = f.drift ? cz + (rng() - 0.5) * 4 : cz;
          if (Math.abs(x) < 8.2) continue;
          const t = rng(); col.setRGB(f.c[0][0] + (f.c[1][0] - f.c[0][0]) * t, f.c[0][1] + (f.c[1][1] - f.c[0][1]) * t, f.c[0][2] + (f.c[1][2] - f.c[0][2]) * t);
          const r = f.r * (0.8 + rng() * 0.5);
          const i2 = heads.take(compose(x, f.y + rng() * 0.15, z, r, r * 0.8, r), col);
          if (i2 >= 0) list.push(i2);
        }
      }
      chunks.set(chunk.index, list); heads.flush();
    },
    release(index) { const l = chunks.get(index); if (!l) return; for (const i of l) heads.give(i); chunks.delete(index); heads.flush(); },
    update(dt, wind, night, season) { mat.emissiveIntensity = 0.15 + 0.3 * night; },
  };
}
