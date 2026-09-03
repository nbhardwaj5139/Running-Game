// Season/time-of-day palettes for KITSUNE. Every colour the renderer and the sky
// need comes from getTheme(season, night, biome). Palettes are authored as sRGB
// hex (THREE.Color converts to linear); day and night variants are blended by
// `night` with a curve that lets golden hour linger, then a few biome tints.
import * as THREE from 'three';

export const SEASON_LABEL = [{ jp: '春', en: 'Spring' }, { jp: '夏', en: 'Summer' }, { jp: '秋', en: 'Autumn' }, { jp: '冬', en: 'Winter' }];
export const BIOME_LABEL = [{ jp: '山', en: 'Mountain shrine path' }, { jp: '都', en: 'City' }, { jp: '郊外', en: 'Suburbs' }, { jp: '海岸', en: 'Coast road' }];

// Colour keys (lerped) and scalar keys (lerped) of a palette entry.
const COLOR_KEYS = ['skyTop', 'skyMid', 'horizon', 'fog', 'sun', 'hemiSky', 'hemiGround', 'cloud', 'cloudShadow', 'grass', 'foliage', 'water'];
const SCALAR_KEYS = ['sunIntensity', 'hemiIntensity', 'ambient'];

// [season] -> { day, night }. Day = golden hour / afternoon; night is Shinkai blue, never black.
const PALETTES = [
  { // spring — pastel dawn: peach horizon rising into lavender
    day:   { skyTop: '#7d8fd8', skyMid: '#cba8dc', horizon: '#ffd0a4', fog: '#f2c9ba', sun: '#fff1d6', sunIntensity: 1.6, hemiSky: '#d8c8f2', hemiGround: '#7c6c5e', hemiIntensity: 0.55, ambient: 0.18, cloud: '#fff3ec', cloudShadow: '#d6adc6', grass: '#8fc66c', foliage: '#a6d474', water: '#82bad9' },
    night: { skyTop: '#0f1a4c', skyMid: '#253270', horizon: '#5f4b82', fog: '#3a3562', sun: '#8fa6ff', sunIntensity: 0.35, hemiSky: '#3d4b8c', hemiGround: '#1c1a2e', hemiIntensity: 0.35, ambient: 0.12, cloud: '#4d5b92', cloudShadow: '#222a56', grass: '#3f5a55', foliage: '#4a606c', water: '#1f3562' },
  },
  { // summer — deep saturated blue, towering cumulus, a hot white sun
    day:   { skyTop: '#1a45b8', skyMid: '#3f8ce8', horizon: '#c2e6f7', fog: '#b8dcf0', sun: '#fffcf2', sunIntensity: 2.2, hemiSky: '#82b8ff', hemiGround: '#5a6c48', hemiIntensity: 0.6, ambient: 0.2, cloud: '#ffffff', cloudShadow: '#8ea8d8', grass: '#4f9f3a', foliage: '#2f8038', water: '#1a8db2' },
    night: { skyTop: '#061038', skyMid: '#0f2b6c', horizon: '#2d5092', fog: '#1e3662', sun: '#9fb8ff', sunIntensity: 0.35, hemiSky: '#2b4b9c', hemiGround: '#10201a', hemiIntensity: 0.35, ambient: 0.12, cloud: '#2b407e', cloudShadow: '#101c48', grass: '#26483a', foliage: '#1c3a30', water: '#0a2a58' },
  },
  { // autumn — amber and rose gold, long shadows, wispy cirrus
    day:   { skyTop: '#6e80c2', skyMid: '#d48c8e', horizon: '#ffb268', fog: '#e9b593', sun: '#ffd49c', sunIntensity: 1.9, hemiSky: '#e2b2a2', hemiGround: '#6c4a30', hemiIntensity: 0.5, ambient: 0.16, cloud: '#ffe2c6', cloudShadow: '#ba7a8e', grass: '#bb9c4a', foliage: '#dc562b', water: '#6088aa' },
    night: { skyTop: '#0d1242', skyMid: '#2b2b6c', horizon: '#7c4c64', fog: '#46365c', sun: '#9caaff', sunIntensity: 0.35, hemiSky: '#3b4082', hemiGround: '#2a1c18', hemiIntensity: 0.35, ambient: 0.12, cloud: '#4b4378', cloudShadow: '#241f4a', grass: '#4a4030', foliage: '#5c2b22', water: '#1e2a52' },
  },
  { // winter — pale grey-blue, a low white sun, blue shadows on snow
    day:   { skyTop: '#88a6ce', skyMid: '#c4d4e8', horizon: '#f2eee8', fog: '#e0e5ed', sun: '#ffffff', sunIntensity: 1.4, hemiSky: '#d0dcf0', hemiGround: '#7e8ca2', hemiIntensity: 0.6, ambient: 0.22, cloud: '#f7f8fb', cloudShadow: '#aebcd2', grass: '#b4b19b', foliage: '#6f7a88', water: '#7090aa' },
    night: { skyTop: '#0b163a', skyMid: '#1c3062', horizon: '#4c6492', fog: '#2e4064', sun: '#bacaff', sunIntensity: 0.4, hemiSky: '#3b5692', hemiGround: '#202a42', hemiIntensity: 0.4, ambient: 0.14, cloud: '#3d5182', cloudShadow: '#1a284a', grass: '#4c5668', foliage: '#2e3848', water: '#142a4a' },
  },
];
// Parse hex once; keep THREE.Color instances in the tables.
for (const p of PALETTES) for (const k of ['day', 'night']) for (const c of COLOR_KEYS) p[k][c] = new THREE.Color(p[k][c]);

// Biome tints applied after the day/night blend: [horizonTint, tintAmount(night), fogTint, fogAmount]
const CITY_GLOW = new THREE.Color('#9a5c72');     // sodium/neon light pollution on the city horizon at night
const COAST_CYAN = new THREE.Color('#a9dfe0');
const MIST = new THREE.Color('#ffffff');
const TURQUOISE = new THREE.Color('#2fb8b0');

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Theme for a season (0..3), night (0 = golden hour .. 1 = deep night) and biome (0..3).
 * Returns fresh THREE.Color objects each call; the renderer caches/lerps them.
 */
export function getTheme(season, night, biome) {
  const p = PALETTES[((season | 0) % 4 + 4) % 4];
  const n = Math.min(1, Math.max(0, night || 0));
  const tc = smooth(0.05, 0.78, n);          // colours: golden hour lingers, full night by ~0.78
  const ts = smooth(0.1, 0.62, n);           // light intensities fall a little sooner
  const th = {};
  for (const k of COLOR_KEYS) th[k] = p.day[k].clone().lerp(p.night[k], tc);
  for (const k of SCALAR_KEYS) th[k] = p.day[k] + (p.night[k] - p.day[k]) * ts;
  th.snow = season === 3 ? 1 : 0;
  th.label = SEASON_LABEL[((season | 0) % 4 + 4) % 4];

  switch (biome) {
    case 0: // mountain: misty, greener bounce light
      th.fog.lerp(MIST, 0.12 * (1 - tc)); th.hemiGround.lerp(new THREE.Color('#4d6a44'), 0.25); break;
    case 1: // city: warm light pollution at night, greyer fog by day
      th.horizon.lerp(CITY_GLOW, 0.55 * tc); th.fog.lerp(CITY_GLOW, 0.4 * tc); th.skyMid.lerp(CITY_GLOW, 0.18 * tc);
      th.hemiGround.lerp(new THREE.Color('#6a5a58'), 0.3); th.ambient += 0.04 * tc; break;
    case 2: // suburb: a touch warmer ground bounce
      th.hemiGround.lerp(new THREE.Color('#6e6448'), 0.2); break;
    case 3: // coast: cyan haze and turquoise water
      th.horizon.lerp(COAST_CYAN, 0.2 * (1 - tc)); th.fog.lerp(COAST_CYAN, 0.25 * (1 - tc)); th.water.lerp(TURQUOISE, 0.35 * (1 - tc)); break;
  }
  return th;
}
