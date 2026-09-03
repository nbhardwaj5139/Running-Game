// Per-chunk ground: a stone shrine path through moss, or wet Tokyo asphalt with
// lane paint, crosswalks, and puddles that reflect the chunk's neon signs.
import * as THREE from 'three';
import { LANES, LANE_W, CHUNK_LEN } from '../core/chunks.js';

export const GROUND_W = 90;
export const MAX_NEON = 8;

const vert = /* glsl */`
  #include <fog_pars_vertex>
  varying vec2 vXZ; varying float vTrack; uniform float uZ0;
  void main() {
    vXZ = vec2(position.x, position.z); vTrack = uZ0 + ${CHUNK_LEN.toFixed(1)} * 0.5 + position.z;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const frag = /* glsl */`
  precision highp float;
  #include <fog_pars_fragment>
  varying vec2 vXZ; varying float vTrack;
  uniform float uTime, uBiome, uNight, uNeonN, uPulse; uniform vec4 uNeon[${MAX_NEON}]; uniform vec3 uNeonCol[${MAX_NEON}];
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
  void main() {
    vec2 p = vec2(vXZ.x, vTrack); float ax = abs(vXZ.x);
    float road = 1.0 - smoothstep(5.45, 5.75, ax);
    vec3 col;
    if (uBiome < 0.5) {
      vec2 cs = vec2(1.1, 1.45); vec2 cell = floor(p / cs); vec2 f = fract(p / cs);
      float h = hash(cell);
      vec3 stone = mix(vec3(0.40,0.38,0.34), vec3(0.58,0.55,0.49), h) * (0.85 + 0.3 * noise(p * 3.0));
      float edge = smoothstep(0.0,0.09,f.x)*smoothstep(0.0,0.09,f.y)*smoothstep(1.0,0.91,f.x)*smoothstep(1.0,0.91,f.y);
      float moss = smoothstep(0.52, 0.72, fbm(p * 0.33));
      vec3 path = mix(vec3(0.14,0.13,0.11), stone, edge); path = mix(path, vec3(0.22,0.36,0.16), moss * 0.55);
      vec3 grass = mix(vec3(0.10,0.20,0.09), vec3(0.20,0.33,0.13), fbm(p * 0.45));
      grass = mix(grass, vec3(0.30,0.24,0.16), smoothstep(0.55,0.7,fbm(p*0.12+9.0)) * 0.5);   // bare earth patches
      grass *= 0.55 + 0.45 * smoothstep(34.0, 7.0, ax);
      float verge = smoothstep(5.5, 6.4, ax) * (1.0 - smoothstep(6.4, 7.2, ax));
      col = mix(grass, path, road) + verge * vec3(0.05,0.08,0.03);
      // lantern glow pooled on the path (uNeon reused for warm lights)
      for (int i = 0; i < ${MAX_NEON}; i++) { if (float(i) >= uNeonN) break; vec4 L = uNeon[i];
        float d = distance(p, L.xy); col += uNeonCol[i] * 0.09 * L.w * exp(-d * d * 0.05) * road; }
    } else {
      float n = fbm(p * 0.8);
      vec3 asphalt = vec3(0.085,0.088,0.105) * (0.75 + 0.5 * n);
      float lb = abs(fract(vXZ.x / ${LANE_W.toFixed(2)} + 0.5) - 0.5) * ${LANE_W.toFixed(2)};
      float dash = smoothstep(0.09, 0.04, lb) * step(0.5, fract(vTrack / 3.0)) * step(1.5, ax) * (1.0 - step(5.0, ax));
      float edgeL = smoothstep(0.14, 0.06, abs(ax - 5.35));
      float cz = mod(vTrack, ${CHUNK_LEN.toFixed(1)}); float cross = step(2.0, cz) * (1.0 - step(5.2, cz)) * step(0.5, fract(vXZ.x / 0.9)) * road;
      vec3 roadCol = asphalt + vec3(0.85) * dash * 0.75 + vec3(0.95,0.85,0.45) * edgeL * 0.6 + vec3(0.85) * cross * 0.75;
      float puddle = smoothstep(0.50, 0.64, fbm(p * 0.17 + 3.0));
      vec3 skyRef = mix(vec3(0.30,0.20,0.34), vec3(0.05,0.05,0.12), uNight);
      roadCol = mix(roadCol, roadCol * 0.35 + skyRef * 0.7, puddle * 0.8);
      vec3 refl = vec3(0.0);
      for (int i = 0; i < ${MAX_NEON}; i++) { if (float(i) >= uNeonN) break; vec4 L = uNeon[i];
        float dz = L.y - vTrack; float dx = vXZ.x - L.x;
        float s = exp(-dx * dx * (0.5 + 0.02 * dz)) * step(0.0, dz) * exp(-dz * 0.09) * (0.25 + 0.75 * puddle);
        refl += uNeonCol[i] * s * L.w; }
      roadCol += refl * 0.55 * (0.6 + 0.4 * uNight);
      vec3 pave = vec3(0.23,0.23,0.25) * (0.8 + 0.3 * n); vec2 pc = fract(p / 0.8);
      pave *= 0.72 + 0.28 * smoothstep(0.0,0.06,pc.x) * smoothstep(0.0,0.06,pc.y);
      float curb = smoothstep(5.75, 5.85, ax) * (1.0 - smoothstep(6.15, 6.25, ax));
      col = mix(pave + curb * vec3(0.35,0.33,0.3), roadCol, road);
    }
    col *= mix(1.0, 0.5, uNight);
    col = pow(max(col, 0.0), vec3(2.2));
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }`;

export function makeGroundMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uZ0: { value: 0 }, uTime: { value: 0 }, uBiome: { value: 0 }, uNight: { value: 0 }, uPulse: { value: 0 }, uNeonN: { value: 0 },
      uNeon: { value: Array.from({ length: MAX_NEON }, () => new THREE.Vector4()) },
      uNeonCol: { value: Array.from({ length: MAX_NEON }, () => new THREE.Color()) },
    }]),
  });
}
export const groundGeometry = () => { const g = new THREE.PlaneGeometry(GROUND_W, CHUNK_LEN, 1, 1); g.rotateX(-Math.PI / 2); return g; };
