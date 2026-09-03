// Chunk generator + ring-buffer pool. Pure data: no rendering, no Math.random.
// generate(seed, index) is a pure function so any client can build any chunk
// independently and out of order.
//
// The road is one six-lane road made of two 3-lane tracks (left = tanuki's
// home, right = kitsune's home). Hazards are generated per track and every
// track is always solvable on its own; runners may cross into the other
// track — and barge each other — but never need to.
import { mulberry32, mixSeed } from './rng.js';

export const LANES = 3;                              // per track
export const TRACKS = 2;                             // 0 = left, 1 = right
export const LANE_W = 2.2;
export const TRACK_GAP = 0;                          // no median: the tracks touch, so runners can cross and collide
export const TRACK_W = LANES * LANE_W;               // 6.6 m
export const LANES_TOTAL = LANES * TRACKS;           // 6 lanes across the whole road (global lane index 0..5)
export const ROAD_HALF = TRACK_W + TRACK_GAP / 2;    // 6.6 m: half of the paved width
export const CHUNK_LEN = 36;
export const BEAT_LEN = 6;                           // one hazard "row" per beat
export const BEATS = CHUNK_LEN / BEAT_LEN;

// Sections: the road cycles through biomes; the year turns more slowly.
export const BIOME_LEN = 12;                         // chunks per biome section (432 m)
export const SEASON_LEN = 22;                        // chunks per season (792 m) — a full year every 3.2 km
export const BIOMES = ['mountain', 'city', 'suburb', 'coast'];
export const SEASONS = ['spring', 'summer', 'fall', 'winter'];
export const biomeOf = (index) => Math.floor(Math.max(0, index) / BIOME_LEN) % BIOMES.length;
/** The journey: one province per biome section, cycling. Province biomes line up with biomeOf. */
export const PROVINCES = [
  { id: 'kyoto',    jp: '京都', en: 'Kyoto',    biome: 0, shrine: true,  fuji: 1.0, water: null,     snow: false, deer: false },
  { id: 'osaka',    jp: '大阪', en: 'Osaka',    biome: 1, shrine: false, fuji: 0.6, water: null,     snow: false, deer: false },
  { id: 'nara',     jp: '奈良', en: 'Nara',     biome: 2, shrine: false, fuji: 0.8, water: null,     snow: false, deer: true },
  { id: 'shonan',   jp: '湘南', en: 'Shōnan',   biome: 3, shrine: false, fuji: 1.6, water: [0.18, 0.55, 0.75], snow: false, deer: false },
  { id: 'hakone',   jp: '箱根', en: 'Hakone',   biome: 0, shrine: true,  fuji: 2.4, water: null,     snow: false, deer: false },
  { id: 'tokyo',    jp: '東京', en: 'Tokyo',    biome: 1, shrine: false, fuji: 1.0, water: null,     snow: false, deer: false },
  { id: 'hokkaido', jp: '北海道', en: 'Hokkaido', biome: 2, shrine: false, fuji: 0.0, water: null,     snow: true,  deer: false },
  { id: 'okinawa',  jp: '沖縄', en: 'Okinawa',  biome: 3, shrine: false, fuji: 0.0, water: [0.25, 0.85, 0.85], snow: false, deer: false },
];
export const provinceOf = (index) => PROVINCES[Math.floor(Math.max(0, index) / BIOME_LEN) % PROVINCES.length];
/** Shrine climb shape within a Kyoto/Hakone section: chunk k of the section → absolute pitch target (deg) or null. */
export function shrineClimbPitch(index) {
  const pv = provinceOf(index); if (!pv.shrine) return null;
  const k = index % BIOME_LEN;
  return [null, null, 13, 13, 13, 0, -13, -13, -13, 0, null, null][k] ?? null;
}
/** Road surface: 0 = the biome's default, 1 = gravel path, 2 = cobblestones (shrine stairs and top). */
export function surfaceOf(seed, index) {
  if (biomeOf(index) !== 0) return 0;
  if (shrineClimbPitch(index) !== null) return 2;
  return mulberry32(mixSeed(seed ^ 0x5a7f, Math.floor(index / BIOME_LEN))).chance(0.5) ? 1 : 0;
}
export const shrineTopAt = (index) => provinceOf(index).shrine && index % BIOME_LEN === 5;

// ---- weather: one state per biome section, drawn from the season. Each state is a challenge.
export const WEATHER = {
  clear:    { id: 'clear',    jp: '晴れ', en: 'Clear',        laneT: 1.0,  stumble: 1.0, gust: 0,   fog: 0,   rain: 0,   pressure: 1.0 },
  rain:     { id: 'rain',     jp: '雨',   en: 'Rain',         laneT: 1.15, stumble: 1.0, gust: 0,   fog: 0.2, rain: 0.7, pressure: 1.0 },
  thunder:  { id: 'thunder',  jp: '雷雨', en: 'Thunderstorm', laneT: 1.15, stumble: 1.0, gust: 9,   fog: 0.3, rain: 1.0, pressure: 1.3 },
  wind:     { id: 'wind',     jp: '強風', en: 'High wind',    laneT: 1.0,  stumble: 1.0, gust: 6,   fog: 0,   rain: 0,   pressure: 1.0 },
  fog:      { id: 'fog',      jp: '霧',   en: 'Fog',          laneT: 1.0,  stumble: 1.0, gust: 0,   fog: 0.7, rain: 0,   pressure: 1.0 },
  snow:     { id: 'snow',     jp: '雪',   en: 'Snow',         laneT: 1.3,  stumble: 1.3, gust: 0,   fog: 0.3, rain: 0,   pressure: 1.0 },
  blizzard: { id: 'blizzard', jp: '吹雪', en: 'Blizzard',     laneT: 1.3,  stumble: 1.3, gust: 7,   fog: 0.8, rain: 0,   pressure: 1.2 },
};
const WEATHER_BY_SEASON = [['clear', 'clear', 'rain'], ['clear', 'rain', 'thunder'], ['clear', 'wind', 'fog'], ['snow', 'snow', 'blizzard']];
/** Weather for the section containing chunk `index` (pure in seed). The opening section is always clear. */
export function weatherOf(seed, index) {
  const section = Math.floor(Math.max(0, index) / BIOME_LEN); if (section === 0) return WEATHER.clear;
  const r = mulberry32(mixSeed(seed ^ 0x3ea7, section));
  return WEATHER[r.pick(WEATHER_BY_SEASON[seasonOf(index)])];
}
// ---- set pieces
/** A collapsing bridge: chunk 5 of every other coast/mountain section (never a shrine or kaiju chunk). */
export const bridgeAt = (index) => { const b = biomeOf(index); return (b === 3 || (b === 0 && !provinceOf(index).shrine)) && index % BIOME_LEN === 7 && Math.floor(index / BIOME_LEN) % 2 === 1 && !kaijuOf(index); };
/** An avalanche chases the runners down the shrine stairs in winter. */
export const avalancheAt = (index) => seasonOf(index) === 3 && (shrineClimbPitch(index) ?? 0) < 0;
export const SETPIECE = {
  bridge:    { id: 'bridge',    jp: '崩落', en: 'The bridge is giving way', throws: ['gap'], side: 0 },
  avalanche: { id: 'avalanche', jp: '雪崩', en: 'Avalanche',               throws: ['drusen', 'stalk'], side: 0 },
};
export const seasonOf = (index) => Math.floor(Math.max(0, index) / SEASON_LEN) % SEASONS.length;
/** 0..1 progress through the current season section (for blends at the boundary). */
export const seasonBlend = (index) => (Math.max(0, index) % SEASON_LEN) / SEASON_LEN;

export const laneX = (lane) => (lane - (LANES - 1) / 2) * LANE_W;                    // within a track
export const trackX = (track) => (track - (TRACKS - 1) / 2) * (TRACK_W + TRACK_GAP);   // -3.3 / +3.3
/** Global lane (0..5) of a track-local lane. */
export const globalLane = (track, lane) => track * LANES + lane;
/** Which track a continuous global lane position is on. */
export const trackOf = (g) => Math.max(0, Math.min(TRACKS - 1, Math.floor((g + 0.5) / LANES)));
/** x across the road for a (continuous) global lane. */
export const roadX = (g) => (g - (LANES_TOTAL - 1) / 2) * LANE_W;
export const cellX = (cell) => roadX(globalLane(cell.track, cell.lane));

// Cell types (the verb that clears them):
//   stalk  — a solid post: change lane            arch   — something overhead: slide
//   drusen — something low: jump                  gap    — a hole: jump
//   wide   — blocks two adjacent lanes (lane = left one, span 2): take the third lane
//   roller — sweeps between lane and lane+dir over `period` ticks: take the lane it never visits, or time it
//   photon — a coin (hi: floats above a jump)     power  — a pickup {kind}
//   wave   — a full-width shockwave line thrown by a kaiju: jump (every lane)
export const BLOCKING = new Set(['stalk', 'gap', 'wide', 'roller']);
export const ACTION = { arch: 'slide', drusen: 'jump', wave: 'jump' };

// Kaiju: one per season, appears for the last KAIJU_CHUNKS chunks of a season
// section and throws its signature hazards onto the road (still solvable rows).
export const KAIJU_CHUNKS = 2;
export const KAIJU = [
  { id: 'daidarabotchi', jp: '大太法師', en: 'Daidarabotchi, the mountain giant', throws: ['stalk', 'drusen', 'wave'], color: [0.9, 0.6, 0.2] },
  { id: 'umibozu', jp: '海坊主', en: 'Umibōzu, the sea giant', throws: ['wide', 'wave', 'drusen'], color: [0.3, 0.8, 1.0] },
  { id: 'gashadokuro', jp: 'がしゃどくろ', en: 'Gashadokuro, the starving skeleton', throws: ['stalk', 'drusen', 'wide'], color: [1.0, 0.25, 0.2] },
  { id: 'yukioni', jp: '雪鬼', en: 'Yuki-Oni, the snow ogre', throws: ['stalk', 'wave', 'drusen'], color: [0.6, 0.9, 1.0] },
];
/** The kaiju haunting chunk `index`, or null. Its side of the road alternates per season. */
export function kaijuOf(index) {
  const k = index % SEASON_LEN;
  if (index < SEASON_LEN - KAIJU_CHUNKS || k < SEASON_LEN - KAIJU_CHUNKS) return null;
  const season = seasonOf(index);
  return { ...KAIJU[season], season, side: Math.floor(index / SEASON_LEN) % 2 ? 1 : -1, phase: k - (SEASON_LEN - KAIJU_CHUNKS) };
}
export const POWERS = ['shield', 'magnet', 'dash', 'x2', 'heal', 'jetpack', 'thunder', 'foxfire', 'dawn', 'susanoo', 'kagura', 'guide'];
const POWER_WEIGHTS = [0.14, 0.12, 0.1, 0.09, 0.1, 0.1, 0.07, 0.07, 0.05, 0.05, 0.06, 0.05];
export const POWER_INFO = {
  shield:  { jp: '御守', en: 'Spirit Shield', blurb: 'smash through anything for 8 s', color: [0.5, 1.6, 2.2] },
  magnet:  { jp: '磁',   en: 'Tanuki Magnet', blurb: 'coins on your half come to you', color: [0.6, 0.8, 2.0] },
  dash:    { jp: '★',   en: 'Wind Kami Star Run', blurb: 'faster, unstoppable, rainbow', color: [2.2, 1.6, 0.6] },
  x2:      { jp: '達磨', en: 'Daruma ×2', blurb: 'double coins and score', color: [2.0, 0.5, 0.4] },
  heal:    { jp: '桜',   en: 'Sakura Heal', blurb: 'the typhoon falls back 14 m', color: [2.0, 1.0, 1.3] },
  jetpack: { jp: '翼',   en: 'Tengu Jetpack', blurb: 'fly over every ground hazard, faster', color: [2.2, 1.3, 0.4] },
  thunder: { jp: '雷',   en: 'Raijin Slow-time', blurb: 'the world slows to half speed for 6 s', color: [1.4, 1.2, 2.4] },
  foxfire: { jp: '狐火', en: 'Inari Fox-fire', blurb: 'every coin on the whole road flies to you, ×3', color: [0.4, 1.8, 2.4] },
  dawn:    { jp: '天照', en: 'Amaterasu Dawn', blurb: 'the sun rises: typhoon reset, no drain for 10 s', color: [2.5, 2.0, 1.2] },
  susanoo: { jp: '須佐', en: 'Susanoo Storm-break', blurb: 'lightning clears the next 60 m, typhoon pushed back', color: [1.8, 1.9, 2.5] },
  kagura:  { jp: '鈴',   en: 'Kagura Bell', blurb: 'every hazard in the next 40 m turns into coins', color: [2.4, 1.8, 0.5] },
  guide:   { jp: '烏',   en: 'Yatagarasu Guide', blurb: 'the three-legged crow runs for you for 10 s', color: [0.9, 0.5, 2.2] },
};
export const VARIANTS = 4;                           // visual variants per obstacle type (renderer picks props)

/** Difficulty presets chosen on the start screen. `hazard` scales row density, `power` the pickup rate. */
export const DIFFICULTY = {
  easy:   { id: 'easy',   jp: '易', en: 'Easy',   hazard: 0.6,  speedBase: 9,  speedMax: 17, recover: 0.85, drift: 0.2,  power: 1.4, throws: 0.7 },
  normal: { id: 'normal', jp: '普通', en: 'Normal', hazard: 1.0,  speedBase: 11, speedMax: 22, recover: 0.6,  drift: 0.32, power: 1.0, throws: 1.0 },
  hard:   { id: 'hard',   jp: '難', en: 'Hard',   hazard: 1.25, speedBase: 13, speedMax: 27, recover: 0.45, drift: 0.45, power: 0.7, throws: 1.4 },
};

export const TUNING = {
  hazardsMin: [0, 1],      // [at diff 0, at diff 1]
  hazardsMax: [1, 2],
  blockingShare: [0.2, 0.5],
  comboChance: [0, 0.3],   // arch then drusen next beat in the same lane
  wideChance: [0, 0.22],   // a two-lane block instead of a single hazard
  rollerChance: [0, 0.16],
  wallEvery: 6,            // in chunks, once diff > 0.7: a torii wall with one slide-through lane
  releaseBelow: 0.28,      // wave value under which a chunk is a "release" chunk (breathing room)
  powerChance: 0.3,        // per track per chunk
};

function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

/** Breathing difficulty: a base ramp modulated by a tension/release wave. */
export function difficultyAt(seed, index, cfg = DIFFICULTY.normal) {
  const period = 5 + (mixSeed(seed, 0xbeef) % 3); // 5..7, fixed per seed
  const base = Math.min(1, 0.18 + 0.82 * (1 - Math.exp(-index / 48)));
  const phase = (index % period) / period;
  const wave = phase < 0.7 ? smoothstep(0, 0.7, phase) : 1 - smoothstep(0.7, 1, phase);
  return { diff: Math.min(1, base * (0.55 + 0.45 * wave) * cfg.hazard), wave, base, period };
}

const passable = (mask, lane) => !BLOCKING.has(mask[lane]);

/** Reach set for a fresh track: every passable lane. */
export function initialReach(mask = null) {
  const r = new Array(LANES).fill(false);
  for (let l = 0; l < LANES; l++) r[l] = !mask || passable(mask, l);
  return r;
}

/**
 * Solvability grammar. `reach` is the set of lanes the runner can be in after the
 * previous row (a one-step check against the previous mask is not enough — a lane
 * can be passable but unreachable). Returns the new reach set, or null if the row
 * cannot be passed.
 */
export function stepReach(mask, reach, prev = null) {
  let blocking = 0;
  for (let l = 0; l < LANES; l++) if (BLOCKING.has(mask[l])) blocking++;
  if (blocking > LANES - 1) return null;
  const r = new Array(LANES).fill(false);
  let any = false;
  for (let l = 0; l < LANES; l++) {
    if (!passable(mask, l)) continue;
    for (let d = -1; d <= 1; d++) {
      const p = l + d;
      if (p < 0 || p >= LANES || !reach[p]) continue;
      // no forced double-action: arch->drusen (or reverse) in one lane when you can't step aside
      if (d === 0 && prev && ACTION[mask[l]] && ACTION[prev[l]] && ACTION[mask[l]] !== ACTION[prev[l]]) {
        const leftOk = l - 1 >= 0 && reach[l - 1] && passable(mask, l - 1);
        const rightOk = l + 1 < LANES && reach[l + 1] && passable(mask, l + 1);
        if (!leftOk && !rightOk) continue;
      }
      r[l] = true; any = true; break;
    }
  }
  return any ? r : null;
}

export function rowSolvable(mask, prev = null) { return stepReach(mask, initialReach(prev), prev) !== null; }

function weightedPick(rng, items, weights) {
  let t = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { t -= weights[i]; if (t <= 0) return items[i]; }
  return items[items.length - 1];
}

/** One track's worth of rows and cells. Pure in (seed, index, track). */
function generateTrack(seed, index, track, diff, wave, z0, kaiju = null, waveBeats = new Set(), cfg = DIFFICULTY.normal) {
  const rng = mulberry32(mixSeed(mixSeed(seed, index), 0x7a + track));
  const cells = [], rows = [];
  const release = !kaiju && wave < TUNING.releaseBelow && index > 2;         // a thrower's chunk is never a release chunk
  const wall = !release && !kaiju && diff > 0.7 && index % TUNING.wallEvery === 0;
  let reach = initialReach();
  let prev = null;
  const empty = () => new Array(LANES).fill(null);
  const v = () => rng.int(0, VARIANTS - 1);

  const hMin = Math.round(lerp(TUNING.hazardsMin[0], TUNING.hazardsMin[1], diff));
  const hMax = Math.round(lerp(TUNING.hazardsMax[0], TUNING.hazardsMax[1], diff));
  const blockShare = lerp(TUNING.blockingShare[0], TUNING.blockingShare[1], diff);
  const comboChance = lerp(TUNING.comboChance[0], TUNING.comboChance[1], diff);
  const wideChance = lerp(TUNING.wideChance[0], TUNING.wideChance[1], diff);
  const rollerChance = lerp(TUNING.rollerChance[0], TUNING.rollerChance[1], diff);

  const commit = (mask) => {
    for (let l = 0; l < LANES; l++) {
      const t = mask[l]; if (!t) continue;
      const thrown = mask.thrown ? { thrown: true, side: kaiju.side, by: kaiju.id } : {};
      if (t === 'wave') { if (l === 0) cells.push({ z: mask.z, lane: 0, track, type: 'wave', span: LANES, v: v(), ...thrown }); continue; }
      if (t === 'wide') { if (mask.wideLeft === l) cells.push({ z: mask.z, lane: l, track, type: 'wide', span: 2, v: v(), ...thrown }); continue; }
      if (t === 'roller') { if (mask.rollerLane === l) cells.push({ z: mask.z, lane: l, track, type: 'roller', dir: mask.rollerDir, period: mask.rollerPeriod, v: v() }); continue; }
      cells.push({ z: mask.z, lane: l, track, type: t, v: v(), wall: !!mask.wall, ...thrown });
    }
    rows.push(mask);
    reach = stepReach(mask, reach, prev) || initialReach(mask);   // never null for committed masks; defensive
    prev = mask;
  };

  for (let b = 0; b < BEATS; b++) {
    const zb = z0 + b * BEAT_LEN + BEAT_LEN * 0.5;
    const breath = b === BEATS - 1;                 // last beat: always clear, so chunks never depend on each other
    const wallTelegraph = wall && b === 2;          // clear beat before the wall
    if (index === 0 || release || breath || wallTelegraph) { const m = empty(); m.z = zb; commit(m); continue; }

    if (kaiju) {
      // the kaiju throws: every beat gets one of its hazards (a wave spans the whole road), still through the grammar
      let mask, tries = 0;
      do {
        mask = empty(); mask.z = zb; mask.thrown = true;
        if (waveBeats.has(b)) { for (let l = 0; l < LANES; l++) mask[l] = 'wave'; }
        else {
          const kinds = kaiju.throws.filter(k => k !== 'wave');
          const kind = rng.pick(kinds);
          if (kaiju.id === 'bridge' && rng.chance(0.35)) { /* a beat that holds */ }
          else if (kind === 'wide') { const left = rng.int(0, LANES - 2); mask[left] = mask[left + 1] = 'wide'; mask.wideLeft = left; }
          else { mask[rng.int(0, LANES - 1)] = kind; if (diff > 0.5 && rng.chance(0.22 * cfg.throws)) { const l2 = rng.int(0, LANES - 1); if (!mask[l2]) mask[l2] = rng.pick(kinds.filter(k => k !== 'wide')); } }
        }
        tries++;
      } while (!stepReach(mask, reach, prev) && tries < 12);
      if (!stepReach(mask, reach, prev)) { mask = empty(); mask.z = zb; }
      commit(mask); continue;
    }

    if (wall && b === 3) {
      // Torii wall: posts in two lanes, a gate you must slide under in the third. The beat
      // before is clear, so every lane is reachable and the wall is always fair.
      const open = rng.int(0, LANES - 1);
      const m = empty(); m.z = zb; m.wall = true;
      for (let l = 0; l < LANES; l++) m[l] = l === open ? 'arch' : 'stalk';
      if (stepReach(m, reach, prev)) { commit(m); continue; }
      const e = empty(); e.z = zb; commit(e); continue;
    }

    let mask, tries = 0;
    do {
      mask = empty(); mask.z = zb;
      if (rng.chance(wideChance)) {
        const left = rng.int(0, LANES - 2);
        mask[left] = mask[left + 1] = 'wide'; mask.wideLeft = left;
      } else if (rng.chance(rollerChance)) {
        const l0 = rng.int(0, LANES - 1); const dir = l0 === 0 ? 1 : l0 === LANES - 1 ? -1 : (rng.chance(0.5) ? 1 : -1);
        mask[l0] = mask[l0 + dir] = 'roller'; mask.rollerLane = l0; mask.rollerDir = dir; mask.rollerPeriod = 150 + rng.int(0, 60);
      } else {
        const count = rng.int(hMin, hMax);
        const lanes = [0, 1, 2];
        for (let i = 0; i < count && lanes.length; i++) {
          const l = lanes.splice(Math.floor(rng() * lanes.length), 1)[0];
          const blocking = rng.chance(blockShare);
          mask[l] = blocking ? (rng.chance(0.35) ? 'gap' : 'stalk') : (rng.chance(0.5) ? 'arch' : 'drusen');
        }
        // combo: continue an action lane from the previous row with the *other* action
        if (prev && rng.chance(comboChance)) {
          const l = rng.int(0, LANES - 1);
          if (ACTION[prev[l]] && !mask[l]) mask[l] = prev[l] === 'arch' ? 'drusen' : 'arch';
        }
      }
      tries++;
    } while (!stepReach(mask, reach, prev) && tries < 12);
    if (!stepReach(mask, reach, prev)) { mask = empty(); mask.z = zb; }   // give up: an empty row is always fair
    commit(mask);
  }

  // ---- pickups -------------------------------------------------------
  const freeLanes = (mask) => { const f = []; for (let l = 0; l < LANES; l++) if (!mask[l]) f.push(l); return f; };
  for (let b = 0; b < BEATS; b++) {
    const mask = rows[b];
    const zb = z0 + b * BEAT_LEN;
    if (release || index === 0) {
      const l = (index + b + track) % LANES;
      for (let i = 0; i < 4; i++) cells.push({ z: zb + 0.75 + i * 1.5, lane: l, track, type: 'photon' });
      continue;
    }
    for (let l = 0; l < LANES; l++) if (mask[l] === 'drusen') {
      for (let i = -1; i <= 1; i++) cells.push({ z: zb + BEAT_LEN * 0.5 + i * 1.0, lane: l, track, type: 'photon', hi: true });
    }
    if (rng.chance(0.55)) {
      const free = freeLanes(mask);
      if (free.length) { const l = rng.pick(free); for (let i = 0; i < 3; i++) cells.push({ z: zb + 1 + i * 1.6, lane: l, track, type: 'photon' }); }
    }
  }
  if (index > 1 && rng.chance(Math.min(0.9, TUNING.powerChance * cfg.power))) {
    const b = rng.int(1, BEATS - 2); const free = freeLanes(rows[b]);
    if (free.length) cells.push({ z: z0 + b * BEAT_LEN + 3, lane: rng.pick(free), track, type: 'power', kind: weightedPick(rng, POWERS, POWER_WEIGHTS), v: v() });
  }
  return { cells, rows, release, wall };
}

/**
 * Pure: (seed, index) -> Chunk with both tracks. The last beat of every track is
 * always clear (the "breath beat"), so chunks never depend on each other.
 */
export function generate(seed, index, cfg = DIFFICULTY.normal) {
  const { diff, wave } = difficultyAt(seed, index, cfg);
  const z0 = index * CHUNK_LEN;
  const kaiju = kaijuOf(index) || (bridgeAt(index) ? { ...SETPIECE.bridge, setpiece: true } : avalancheAt(index) ? { ...SETPIECE.avalanche, setpiece: true } : null);
  const waveBeats = new Set();
  if (kaiju && kaiju.throws.includes('wave')) { const r = mulberry32(mixSeed(seed, index) ^ 0x3a7e); waveBeats.add(r.int(1, 3)); }
  const tracks = [];
  for (let t = 0; t < TRACKS; t++) tracks.push(generateTrack(seed, index, t, diff, wave, z0, kaiju, waveBeats, cfg));
  const cells = tracks.flatMap(t => t.cells).sort((a, b) => a.z - b.z);
  return { index, z0, length: CHUNK_LEN, difficulty: diff, wave, release: tracks[0].release, wall: tracks.some(t => t.wall),
    biome: biomeOf(index), season: seasonOf(index), kaiju: kaiju && !kaiju.setpiece ? kaiju : null, setpiece: kaiju && kaiju.setpiece ? kaiju.id : null, weather: weatherOf(seed, index), cells, rows: tracks.map(t => t.rows) };
}

/**
 * Ring-buffer pool. Keeps AHEAD chunks in front of the runners and BEHIND
 * behind; recycles the oldest into the newest. `onRecycle(old, fresh)` lets a
 * renderer move pooled meshes without allocating.
 */
export class ChunkPool {
  constructor(seed, { ahead = 6, behind = 1, onRecycle = null, cfg = DIFFICULTY.normal } = {}) {
    this.seed = seed; this.ahead = ahead; this.behind = behind; this.onRecycle = onRecycle; this.cfg = cfg;
    this.live = []; this.nextIndex = 0;
    for (let i = 0; i < ahead + behind + 1; i++) this._spawn();
  }
  _spawn() { const c = generate(this.seed, this.nextIndex++, this.cfg); this.live.push(c); return c; }
  /** Advance the window so `z` sits at slot `behind`. Returns recycled count. */
  update(z) {
    let n = 0;
    while (this.live.length && this.live[0].z0 + this.live[0].length < z - this.behind * CHUNK_LEN) {
      const old = this.live.shift(); const fresh = this._spawn();
      if (this.onRecycle) this.onRecycle(old, fresh);
      n++;
    }
    return n;
  }
  chunkAt(z) { return this.live.find(c => z >= c.z0 && z < c.z0 + c.length) || null; }
}

/** Where a roller is at sim tick t: a continuous sweep between lane and lane+dir. */
export function rollerLaneAt(cell, tick) {
  const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * tick) / cell.period);
  return cell.lane + cell.dir * phase;
}
