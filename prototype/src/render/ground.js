// Per-chunk ground plane for KITSUNE: one six-lane road (|x| <= 6.6) and the
// verges either side, painted procedurally per biome and season. See
// docs/RENDER_API.md "Module: render/ground.js" for the contract.
//
// The fragment shader works in track space: x across the road, z = absolute
// track distance (uZ0 + CHUNK_LEN/2 + localZ), so paint is continuous across
// chunk seams. Colours are authored in sRGB-ish 0..1 terms and linearised with
// pow(2.2) at the end, before fog.
import * as THREE from 'three';
import { LANE_W, ROAD_HALF, CHUNK_LEN } from '../core/chunks.js';
import { NOISE_GLSL } from './common.js';

export const GROUND_W = 110;
export const MAX_LIGHTS = 8;

const vert = /* glsl */`
  #include <fog_pars_vertex>
  uniform float uZ0;
  varying vec2 vP;                                   // (x, absolute track z)
  void main() {
    vP = vec2(position.x, uZ0 + ${(CHUNK_LEN / 2).toFixed(1)} + position.z);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const frag = /* glsl */`
  precision highp float;
  #include <fog_pars_fragment>
  varying vec2 vP;
  uniform float uTime, uBiome, uSeason, uSnow, uNight, uWet, uLightN;
  uniform vec4 uLight[${MAX_LIGHTS}]; uniform vec3 uLightCol[${MAX_LIGHTS}];
  ${NOISE_GLSL}
  // Jittered blob per cell of size s; a fraction dens of cells carry one. h = a per-cell hash for tinting.
  float specks(vec2 p, float s, float dens, out float h) {
    vec2 c = floor(p / s), f = fract(p / s); h = hash(c + 3.7);
    vec2 o = vec2(hash(c + 1.3), hash(c + 7.1)) * 0.6 + 0.2;
    float d = length((f - o) * vec2(1.0, 0.75));
    return step(hash(c), dens) * (1.0 - smoothstep(0.10, 0.17, d));
  }
  void main() {
    vec2 p = vP; float x = p.x, z = p.y, ax = abs(x);
    float road   = 1.0 - smoothstep(${ROAD_HALF.toFixed(2)} - 0.05, ${ROAD_HALF.toFixed(2)} + 0.1, ax);
    float lb     = abs(fract(x / ${LANE_W.toFixed(2)} + 0.5) - 0.5) * ${LANE_W.toFixed(2)};   // distance to nearest lane boundary (x = ±1.1, ±3.3, ±5.5)
    float lc     = abs(fract(x / ${LANE_W.toFixed(2)}) - 0.5) * ${LANE_W.toFixed(2)};         // distance to nearest lane centre
    float guide  = (1.0 - smoothstep(0.035, 0.08, lb)) * step(0.5, ax) * road;             // subtle lane guides
    float centre = 1.0 - smoothstep(0.06, 0.12, ax);                                        // painted centre line at x = 0
    float edge   = 1.0 - smoothstep(0.05, 0.11, abs(ax - ${ROAD_HALF.toFixed(2)}));         // crisp edge line at |x| = 6.6
    float n      = fbm(p * 0.7);
    float dist   = smoothstep(8.0, 40.0, ax);                                               // verge darkening away from the road

    // ---- verge base: season-tinted grass with earth patches
    vec3 gBase = uSeason < 0.5 ? vec3(0.44, 0.64, 0.30) : uSeason < 1.5 ? vec3(0.20, 0.48, 0.17)
               : uSeason < 2.5 ? vec3(0.62, 0.50, 0.24) : vec3(0.52, 0.50, 0.40);
    vec3 grass = gBase * (0.72 + 0.55 * fbm(p * 0.45));
    float earthM = smoothstep(0.55, 0.72, fbm(p * 0.11 + 9.0));
    grass = mix(grass, vec3(0.40, 0.31, 0.20) * (0.8 + 0.4 * n), earthM * 0.6);
    grass *= 1.0 - 0.55 * dist;

    vec3 surf, verge = grass;                 // road surface / off-road surface
    float puddle = 0.12 * uWet * road;        // reflection strength for the light streaks
    float seaM = 0.0;                         // sea mask (coast only): no snow, no leaves

    if (uBiome < 0.5) {
      // ---- mountain: flagstone shrine path, moss in the grout, a row of pebbles as the centre line
      vec2 cs = vec2(1.1, 1.5), cell = floor(p / cs), f = fract(p / cs);
      float h = hash(cell);
      vec3 stone = mix(vec3(0.50, 0.48, 0.44), vec3(0.72, 0.68, 0.60), h) * (0.85 + 0.3 * noise(p * 3.0));
      stone = mix(stone, vec3(0.56, 0.56, 0.62), step(0.8, hash(cell + 2.0)) * 0.5);
      float grout = smoothstep(0.0, 0.08, f.x) * smoothstep(1.0, 0.92, f.x) * smoothstep(0.0, 0.08, f.y) * smoothstep(1.0, 0.92, f.y);
      float moss = smoothstep(0.48, 0.70, fbm(p * 0.35 + 4.0));
      surf = mix(vec3(0.20, 0.18, 0.15), stone, grout);
      surf = mix(surf, vec3(0.27, 0.45, 0.19), moss * (0.35 + 0.4 * (1.0 - grout)));
      surf = mix(surf, surf * 0.82, guide * 0.6);
      float ph = hash(vec2(floor(z / 0.7), 0.0));
      float pebble = 1.0 - smoothstep(0.16, 0.23, length(vec2(x, fract(z / 0.7) * 0.7 - 0.35)));
      surf = mix(surf, mix(vec3(0.62, 0.60, 0.56), vec3(0.78, 0.74, 0.66), ph), pebble);
      surf = mix(surf, vec3(0.40, 0.38, 0.34), edge);                       // kerb stones
      verge = mix(grass, vec3(0.24, 0.36, 0.16) * (0.8 + 0.4 * n), moss * 0.35);
      puddle = 0.2 + 0.3 * uWet;
    } else if (uBiome < 1.5) {
      // ---- city: wet dark asphalt, white dashes, crosswalk, double white centre, puddles
      vec3 asphalt = vec3(0.17, 0.175, 0.20) * (0.75 + 0.5 * n) * (1.0 - 0.35 * uWet);
      float dash = step(0.5, fract(z / 3.0)) * guide;
      float cz = mod(z, ${CHUNK_LEN.toFixed(1)});
      float cross = step(2.0, cz) * step(cz, 5.2) * step(0.5, fract(x / 0.9)) * road;
      float dbl = (1.0 - smoothstep(0.04, 0.08, abs(ax - 0.16))) * (1.0 - cross);
      surf = asphalt + vec3(0.90) * (dash * 0.8 + cross * 0.85 + dbl * 0.9 + edge * 0.7);
      puddle = smoothstep(0.52, 0.66, fbm(p * 0.17 + 3.0)) * (0.55 + 0.45 * uWet);
      vec3 skyRef = mix(vec3(0.56, 0.46, 0.56), vec3(0.08, 0.09, 0.22), uNight);
      surf = mix(surf, surf * 0.4 + skyRef * 0.6, puddle * 0.85 * road);
      vec3 pave = vec3(0.42, 0.42, 0.44) * (0.8 + 0.3 * n); vec2 pc = fract(p / 0.8);
      pave *= 0.75 + 0.25 * smoothstep(0.0, 0.06, pc.x) * smoothstep(0.0, 0.06, pc.y);
      float curb = smoothstep(6.6, 6.75, ax) * (1.0 - smoothstep(7.1, 7.25, ax));
      verge = (pave + curb * vec3(0.25)) * (1.0 - 0.5 * dist);
    } else if (uBiome < 2.5) {
      // ---- suburb: pale asphalt, dashed yellow centre line, concrete gutters, greener verge
      vec3 asphalt = vec3(0.47, 0.47, 0.48) * (0.8 + 0.4 * n) * (1.0 - 0.2 * uWet);
      float ydash = centre * step(0.5, fract(z / 2.0));
      surf = asphalt + vec3(0.95, 0.75, 0.20) * ydash * 0.9 + vec3(0.85) * (guide * 0.3 + edge * 0.7);
      float gutter = smoothstep(6.5, 6.65, ax) * (1.0 - smoothstep(7.4, 7.55, ax));
      vec3 concrete = vec3(0.60, 0.59, 0.56) * (0.9 + 0.2 * n) * (1.0 - 0.5 * (1.0 - smoothstep(0.03, 0.08, abs(ax - 7.0))));
      verge = mix(mix(grass, grass * vec3(0.85, 1.12, 0.80), 0.7), concrete, gutter);
      puddle = 0.15 + 0.35 * uWet;
    } else {
      // ---- coast: sandy road with tyre lines, cliff rock on the left, sand then sea on the right
      vec3 sand = vec3(0.78, 0.70, 0.54) * (0.8 + 0.4 * n);
      float tyre = 1.0 - smoothstep(0.10, 0.22, abs(lc - 0.75));
      surf = mix(sand, sand * 0.72, tyre * 0.7 * road);
      surf = mix(surf, surf * 0.9, guide * 0.5);
      surf += vec3(0.9) * (centre * 0.35 + edge * 0.4) * (0.5 + 0.5 * noise(vec2(z * 1.5, x)));
      float rock = smoothstep(0.35, 0.75, fbm(p * 0.25 + 11.0));
      vec3 cliff = mix(vec3(0.30, 0.30, 0.33), mix(vec3(0.44, 0.44, 0.46), vec3(0.64, 0.62, 0.60), rock), 0.4 + 0.6 * rock) * (0.8 + 0.3 * n);
      vec3 beach = vec3(0.86, 0.80, 0.64) * (0.9 + 0.2 * n);
      float foamX = 20.5 + 1.2 * sin(z * 0.3 + uTime) + 0.6 * sin(z * 0.9 - uTime * 1.7);
      float foam = (1.0 - smoothstep(0.0, 0.9, abs(x - foamX))) * (0.5 + 0.5 * noise(vec2(z * 2.0, uTime * 2.0)));
      vec3 sea = mix(vec3(0.05, 0.36, 0.42), vec3(0.02, 0.20, 0.32), smoothstep(20.0, 50.0, x));
      sea = mix(vec3(0.35, 0.66, 0.62), sea, smoothstep(20.0, 26.0, x));
      sea *= 0.9 + 0.1 * sin(x * 0.8 - uTime * 1.5 + z * 0.2 + n * 3.0);
      sea += foam * vec3(0.6);
      seaM = smoothstep(19.5, 20.5, x);
      vec3 vL = mix(grass, cliff, smoothstep(8.0, 11.0, -x));
      vec3 vR = mix(grass, mix(beach, beach * 0.8, smoothstep(17.0, 20.0, x)), smoothstep(8.0, 10.0, x));
      verge = x < 0.0 ? vL : mix(vR, sea, seaM);
      puddle = 0.1 + 0.3 * uWet;
    }
    vec3 col = mix(verge, surf, road);

    // ---- season scatter: spring petals / autumn leaves (verges; lightly on the road)
    float sh;
    float dens = uSeason < 0.5 ? 0.30 : (uSeason > 1.5 && uSeason < 2.5) ? 0.5 : 0.0;
    float spk = specks(p, 0.5, dens, sh) * mix(1.0, 0.3, road) * (1.0 - seaM);
    vec3 leaf = uSeason < 1.5 ? mix(vec3(0.98, 0.82, 0.88), vec3(0.96, 0.66, 0.78), sh)
              : sh < 0.33 ? vec3(0.85, 0.25, 0.12) : sh < 0.66 ? vec3(0.95, 0.55, 0.15) : vec3(0.95, 0.85, 0.30);
    col = mix(col, leaf, spk * (1.0 - 0.8 * uSnow));

    // ---- snow: white layer everywhere but the packed lane centres; faint blue at night
    vec3 snow = vec3(0.92, 0.94, 0.98) * (0.86 + 0.14 * noise(p * 2.0));
    snow = mix(snow, vec3(0.70, 0.78, 0.98), 0.5 * uNight);
    float track = (1.0 - smoothstep(0.35, 0.75, lc)) * road;
    float cov = uSnow * smoothstep(0.25, 0.65, 0.5 * uSnow + 0.5 * fbm(p * 0.5 + 21.0)) * (1.0 - seaM);
    col = mix(col, snow * 0.6, uSnow * track * 0.3);
    col = mix(col, snow, cov * (1.0 - 0.75 * track));

    // ---- light list reflected as streaks toward the viewer (added after the night dim so they stay strong)
    vec3 glow = vec3(0.0);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (float(i) >= uLightN) break;
      vec4 L = uLight[i]; float dz = L.y - z, dx = x - L.x;
      float s = exp(-dx * dx * (0.5 + 0.02 * dz)) * step(0.0, dz) * exp(-dz * 0.09) * (0.25 + 0.75 * puddle);
      glow += uLightCol[i] * s * L.w;
    }
    glow *= 0.55 * (0.45 + 0.55 * uNight) * (0.7 + 0.5 * uWet) * mix(0.3, 1.0, road);

    col *= mix(1.0, 0.45, uNight);
    col += glow;
    col = pow(max(col, 0.0), vec3(2.2));
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }`;

export function makeGroundMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uZ0: { value: 0 }, uTime: { value: 0 }, uBiome: { value: 0 }, uSeason: { value: 0 },
      uSnow: { value: 0 }, uNight: { value: 0 }, uWet: { value: 0 }, uLightN: { value: 0 },
      uLight: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
      uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color()) },
    }]),
  });
}

/** Flat XZ plane, GROUND_W across by CHUNK_LEN along z, centred on the origin. */
export function groundGeometry() {
  const g = new THREE.PlaneGeometry(GROUND_W, CHUNK_LEN, 1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}
