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
export const BIOME_LEN = 16;                         // chunks per biome section (576 m)
export const SEASON_LEN = 32;                        // chunks per season (1152 m, two provinces) — a full year every 4.6 km
export const BIOMES = ['mountain', 'city', 'suburb', 'coast'];
export const SEASONS = ['spring', 'summer', 'fall', 'winter'];
export const biomeOf = (index) => Math.floor(Math.max(0, index) / BIOME_LEN) % BIOMES.length;
/** The journey: one province per biome section, cycling. Province biomes line up with biomeOf. */
export const PROVINCES = [
  { id: 'kyoto',    jp: '京都', en: 'Kyoto',    biome: 0, shrine: true,  fuji: 1.0, water: null,     snow: false, deer: false },
  { id: 'osaka',    jp: '大阪', en: 'Osaka',    biome: 1, shrine: false, fuji: 0.6, water: null,     snow: false, deer: false },
  { id: 'nara',     jp: '奈良', en: 'Nara',     biome: 2, shrine: false, fuji: 0.8, water: null,     snow: false, deer: true },
  { id: 'shonan',   jp: '湘南', en: 'Shōnan',   biome: 3, shrine: false, fuji: 1.6, water: [0.18, 0.55, 0.75], snow: false, deer: false },
  { id: 'hakone',   jp: '箱根', en: 'Hakone',   biome: 0, shrine: false, hike: true, fuji: 2.4, water: null, snow: false, deer: false },
  { id: 'tokyo',    jp: '東京', en: 'Tokyo',    biome: 1, shrine: false, fuji: 1.0, water: null,     snow: false, deer: false },
  { id: 'hokkaido', jp: '北海道', en: 'Hokkaido', biome: 2, shrine: false, fuji: 0.0, water: null,     snow: true,  deer: false },
  { id: 'okinawa',  jp: '沖縄', en: 'Okinawa',  biome: 3, shrine: false, fuji: 0.0, water: [0.25, 0.85, 0.85], snow: false, deer: false },
];
export const provinceOf = (index) => PROVINCES[Math.floor(Math.max(0, index) / BIOME_LEN) % PROVINCES.length];
/** Shrine climb shape within a Kyoto section: chunk k of the section → absolute pitch target (deg) or null. */
export function shrineClimbPitch(index) {
  const pv = provinceOf(index); if (!pv.shrine) return null;
  const k = index % BIOME_LEN;
  return [null, null, 13, 13, 13, 0, -13, -13, -13, 0, null, null][k] ?? null;
}
/**
 * The Hakone hike: a mountain trail rather than a staircase. It climbs in two
 * pushes with a saddle between them and a long run-out down the far side, so the
 * whole section reads as a walk over a ridge instead of one flight of steps.
 * Unlike the shrine stairs the trail is allowed to turn while it climbs.
 */
export function hikeClimbPitch(index) {
  const pv = provinceOf(index); if (!pv.hike) return null;
  const k = index % BIOME_LEN;
  return [null, 6, 11, 15, 11, 4, 0, 9, 14, 9, 0, -8, -13, -13, -6, 0][k] ?? null;
}
/** Any climb profile at this chunk (stairs or trail), or null where the road is free to do as it likes. */
export const climbPitchAt = (index) => shrineClimbPitch(index) ?? hikeClimbPitch(index);
/** Road surface: 0 = the biome's default, 1 = gravel path, 2 = cobblestones (shrine stairs and top). */
export function surfaceOf(seed, index) {
  if (biomeOf(index) !== 0) return 0;
  if (shrineClimbPitch(index) !== null) return 2;
  if (provinceOf(index).hike) return 1;                                    // the trail is gravel the whole way over
  return mulberry32(mixSeed(seed ^ 0x5a7f, Math.floor(index / BIOME_LEN))).chance(0.5) ? 1 : 0;
}
export const shrineTopAt = (index) => provinceOf(index).shrine && index % BIOME_LEN === 5;
/** The saddle at the top of the hike: where the trail levels off and the view opens. */
export const hikeTopAt = (index) => !!provinceOf(index).hike && index % BIOME_LEN === 10;

// ---- weather: one state per biome section, drawn from the season. Each state is a challenge.
// Weather colours a stretch; it never takes it over. Fog and rain stay low enough that
// the road ahead is always legible, gusts are occasional rather than relentless, and
// nothing here doubles the pressure on the typhoon bar.
export const WEATHER = {
  clear:    { id: 'clear',    jp: '晴れ', en: 'Clear',        laneT: 1.0,  stumble: 1.0, gust: 0,   fog: 0,    rain: 0,   pressure: 1.0 },
  rain:     { id: 'rain',     jp: '雨',   en: 'Rain',         laneT: 1.08, stumble: 1.0, gust: 0,   fog: 0.04, rain: 0.3, pressure: 1.0 },
  thunder:  { id: 'thunder',  jp: '雷雨', en: 'Thunderstorm', laneT: 1.08, stumble: 1.0, gust: 16,  fog: 0.06, rain: 0.42, pressure: 1.1 },
  wind:     { id: 'wind',     jp: '強風', en: 'High wind',    laneT: 1.0,  stumble: 1.0, gust: 12,  fog: 0,    rain: 0,   pressure: 1.0 },
  fog:      { id: 'fog',      jp: '霧',   en: 'Fog',          laneT: 1.0,  stumble: 1.0, gust: 0,   fog: 0.18, rain: 0,   pressure: 1.0 },
  snow:     { id: 'snow',     jp: '雪',   en: 'Snow',         laneT: 1.15, stumble: 1.15, gust: 0,  fog: 0.06, rain: 0,   pressure: 1.0 },
  blizzard: { id: 'blizzard', jp: '吹雪', en: 'Blizzard',     laneT: 1.15, stumble: 1.15, gust: 14, fog: 0.2,  rain: 0,   pressure: 1.05 },
};
const WEATHER_BY_SEASON = [['clear', 'clear', 'clear', 'rain'], ['clear', 'clear', 'rain', 'thunder'], ['clear', 'clear', 'wind', 'fog'], ['clear', 'snow', 'snow', 'blizzard']];
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
/** A tsunami on the Shōnan coast: chunks 11–13 of every Shōnan section, the sea side of the road. */
export const tsunamiAt = (index) => provinceOf(index).id === 'shonan' && index % BIOME_LEN >= 11 && index % BIOME_LEN <= 13 && !kaijuOf(index);
/** A bamboo forest fire on the Hakone road (never under snow): chunks 11–13 of a Hakone section. */
export const fireAt = (index) => provinceOf(index).id === 'hakone' && index % BIOME_LEN >= 11 && index % BIOME_LEN <= 13 && seasonOf(index) !== 3 && !kaijuOf(index);
/** A level crossing in the suburbs: the chunk where the scenery lays rails (index % 8 === 5), chunk 5 of a suburb section. */
export const crossingAt = (index) => biomeOf(index) === 2 && index % BIOME_LEN === 5;
// ---- forks: the road splits into separate roads, then joins back up ----------
//
// A fork is a run of chunks over which the six lanes are carved into `groups`
// independent roads. Each road pulls away from the line of the main road in its own
// direction — left, right, up or a diagonal — runs on its own for a while, and comes
// back. Runners are locked to whichever road they were on when it split, so two players
// who took different sides genuinely cannot reach each other until the merge.
//
// Which lanes are yours is the whole choice: you take the road you are standing on when
// it splits, and the fork is telegraphed a chunk ahead so the choice is never a surprise.
//
// Six lanes divide evenly into 2 roads of 3 or 3 roads of 2, and no other count; a
// fourth road would need a wider road than this one.
export const FORK_GAP = 13;                    // chunks from one fork to the next
export const FORK_LEN = 4;                     // chunks the roads stay apart (144 m)
/**
 * Where a road can go while it is on its own: across, up, and the two diagonals,
 * plus (0,0) — one road holding the line while the others peel off it, which is
 * often the best-reading fork of all. Nothing goes *down*: the terrain is a solid
 * plane under the whole road, so a road that dropped would run inside the hill.
 */
export const FORK_DIRS = [
  { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
  { x: -1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 },
];
/** How high a road climbing away from the others gets at the widest point, in metres. */
export const FORK_LIFT = 7;
/** Nothing else may be happening across the whole span, or the two features would fight. */
function forkSpanClear(index) {
  for (let i = index; i < index + FORK_LEN; i++) {
    if (i < 4 || kaijuOf(i) || setpieceAt(i) || climbPitchAt(i) !== null) return false;
  }
  return true;
}
/**
 * The fork covering chunk `index`, or null. Pure in (seed, index).
 * `{ start, len, groups, dirs, spread }` — dirs[g] is where road g goes, spread is how
 * far in metres it pulls away at the widest point.
 */
export function forkAt(seed, index) {
  if (index < 4) return null;
  const start = Math.floor(index / FORK_GAP) * FORK_GAP;
  if (index >= start + FORK_LEN || !forkSpanClear(start)) return null;
  const rng = mulberry32(mixSeed(seed ^ 0x40f8, start));
  const groups = rng.chance(0.45) ? 3 : 2;
  const dirs = [], used = new Set();
  for (let g = 0; g < groups; g++) {
    let d, tries = 0;
    do { d = FORK_DIRS[rng.int(0, FORK_DIRS.length - 1)]; tries++; } while (used.has(`${d.x},${d.y}`) && tries < 16);
    used.add(`${d.x},${d.y}`); dirs.push(d);
  }
  // Left-to-right order is kept: the leftmost road takes the leftmost direction. Without
  // this two roads could swap sides and cut straight through each other in the middle.
  dirs.sort((a, b) => a.x - b.x);
  return { start, len: FORK_LEN, groups, dirs, spread: 13 + rng.int(0, 7) };
}
/** The six lanes cut into `n` equal roads: one entry per road, each a list of global lanes. */
export const laneGroups = (n) => Array.from({ length: n }, (_, g) => Array.from({ length: LANES_TOTAL / n }, (_, l) => g * (LANES_TOTAL / n) + l));
/**
 * How the six lanes are carved up on this chunk: one entry per road, each a list of
 * global lanes. Off a fork this is simply the two tracks, which is what it has always been.
 */
export function laneGroupsAt(seed, index) { const f = forkAt(seed, index); return laneGroups(f ? f.groups : TRACKS); }
/** Which road a (continuous) global lane is on, for a chunk with `n` roads. */
export const groupOf = (g, n) => Math.max(0, Math.min(n - 1, Math.floor((g + 0.5) / (LANES_TOTAL / n))));

/** Rockfall on the steep half of the Hakone hike: boulders come down the slope onto the trail. */
export const rockfallAt = (index) => !!provinceOf(index).hike && index % BIOME_LEN >= 2 && index % BIOME_LEN <= 4 && !kaijuOf(index);
/** Which set piece owns chunk `index`, or null. */
export const setpieceAt = (index) => bridgeAt(index) ? 'bridge' : avalancheAt(index) ? 'avalanche' : tsunamiAt(index) ? 'tsunami' : rockfallAt(index) ? 'rockfall' : fireAt(index) ? 'fire' : crossingAt(index) ? 'crossing' : null;
export const SETPIECE = {
  bridge:    { id: 'bridge',    jp: '崩落', en: 'The bridge is giving way',       throws: ['gap'], side: 0 },
  avalanche: { id: 'avalanche', jp: '雪崩', en: 'Avalanche',                     throws: ['drusen', 'stalk'], side: 0 },
  tsunami:   { id: 'tsunami',   jp: '津波', en: 'Tsunami',                       throws: ['wide', 'drusen', 'wave'], side: 1 },
  fire:      { id: 'fire',      jp: '山火事', en: 'The bamboo forest is burning', throws: ['stalk', 'drusen'], side: 0 },
  rockfall:  { id: 'rockfall',  jp: '落石',   en: 'Rockfall — boulders on the trail', throws: ['drusen', 'stalk'], side: -1 },
  crossing:  { id: 'crossing',  jp: '踏切', en: 'Level crossing — slide under the gates', throws: [], side: 0 },
};
/** Chunks per lap of the itinerary (all eight provinces). */
export const LAP_LEN = BIOME_LEN * PROVINCES.length;
/**
 * The year turns every SEASON_LEN chunks, and every lap of the itinerary starts one season
 * later than the last: a lap is exactly one year, so without the offset each province would
 * be frozen in one season forever (Kyoto always spring, and no winter shrine descent — no avalanche).
 */
export const seasonOf = (index) => { const i = Math.max(0, index); return (Math.floor(i / SEASON_LEN) + Math.floor(i / LAP_LEN)) % SEASONS.length; };
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
/**
 * Starting lane of runner `i` of `n`, spread evenly across the six lanes.
 * n = 2 gives the historical pair (lanes 1 and 4, the middle of each track);
 * beyond six runners lanes repeat and the pack barges itself apart.
 */
export const spawnLane = (i, n) => { const k = Math.max(1, n); return Math.min(LANES_TOTAL - 1, Math.floor((i % k) * LANES_TOTAL / k + LANES_TOTAL / (2 * k))); };
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
  { id: 'gojira', jp: '呉爾羅', en: 'Gojira, the king of the monsters', throws: ['stalk', 'drusen', 'wide'], color: [1.7, 0.55, 0.15], fire: true },   // breathes fire: what it throws lands burning
];
/** The kaiju haunting chunk `index`, or null. The roster takes turns, one per season section; its side of the road alternates. */
export function kaijuOf(index) {
  const k = index % SEASON_LEN;
  if (index < SEASON_LEN - KAIJU_CHUNKS || k < SEASON_LEN - KAIJU_CHUNKS) return null;
  const season = seasonOf(index), section = Math.floor(index / SEASON_LEN);
  return { ...KAIJU[section % KAIJU.length], season, side: section % 2 ? 1 : -1, phase: k - (SEASON_LEN - KAIJU_CHUNKS) };
}
export const POWERS = ['shield', 'magnet', 'dash', 'x2', 'heal', 'jetpack', 'foxfire', 'dawn', 'susanoo', 'kagura', 'guide', 'rocket'];
const POWER_WEIGHTS = [0.14, 0.12, 0.12, 0.09, 0.1, 0.12, 0.07, 0.05, 0.06, 0.07, 0.06, 0.08];
export const POWER_INFO = {
  shield:  { jp: '御守', en: 'Spirit Shield', blurb: 'smash through anything for 8 s', color: [0.5, 1.6, 2.2] },
  magnet:  { jp: '磁',   en: 'Tanuki Magnet', blurb: 'coins on your half come to you', color: [0.6, 0.8, 2.0] },
  dash:    { jp: '★',   en: 'Wind Kami Star Run', blurb: 'faster, unstoppable, rainbow', color: [2.2, 1.6, 0.6] },
  x2:      { jp: '達磨', en: 'Daruma ×2', blurb: 'double coins and score', color: [2.0, 0.5, 0.4] },
  heal:    { jp: '桜',   en: 'Sakura Heal', blurb: 'the typhoon falls back 14 m', color: [2.0, 1.0, 1.3] },
  jetpack: { jp: '翼',   en: 'Tengu Jetpack', blurb: 'fly over every ground hazard, much faster', color: [2.2, 1.3, 0.4] },
  foxfire: { jp: '狐火', en: 'Inari Fox-fire', blurb: 'every coin on the whole road flies to you, ×3', color: [0.4, 1.8, 2.4] },
  dawn:    { jp: '天照', en: 'Amaterasu Dawn', blurb: 'the sun rises: typhoon reset, no drain for 10 s', color: [2.5, 2.0, 1.2] },
  susanoo: { jp: '須佐', en: 'Susanoo Storm-break', blurb: 'lightning clears the next 60 m, typhoon pushed back', color: [1.8, 1.9, 2.5] },
  kagura:  { jp: '鈴',   en: 'Kagura Bell', blurb: 'every hazard in the next 40 m turns into coins', color: [2.4, 1.8, 0.5] },
  guide:   { jp: '烏',   en: 'Yatagarasu Guide', blurb: 'the three-legged crow runs for you for 10 s', color: [0.9, 0.5, 2.2] },
  rocket:  { jp: '棒火矢', en: 'Bō-hiya Rocket', blurb: 'loads a rocket — SPACE fires it down your lane, and whatever it hits is blown apart', color: [2.6, 1.2, 0.3] },
};
export const VARIANTS = 4;                           // visual variants per obstacle type (renderer picks props)

/** Difficulty presets chosen on the start screen. `hazard` scales row density, `power` the pickup rate. */
export const DIFFICULTY = {
  easy:   { id: 'easy',   jp: '易', en: 'Easy',   hazard: 0.35, speedBase: 15, speedMax: 24, recover: 0.85, drift: 0.2,  power: 1.4, throws: 0.5 },
  normal: { id: 'normal', jp: '普通', en: 'Normal', hazard: 0.6,  speedBase: 18, speedMax: 30, recover: 0.6,  drift: 0.32, power: 1.0, throws: 0.7 },
  hard:   { id: 'hard',   jp: '難', en: 'Hard',   hazard: 0.9,  speedBase: 21, speedMax: 35, recover: 0.45, drift: 0.45, power: 0.7, throws: 1.0 },
};

// Road density. The road is deliberately uncrowded: one thing to read at a time.
// A beat is far more often empty than not, a row holds at most one hazard per track,
// and the fancier verbs (wide, roller, combo) stay rare so they read as events.
export const TUNING = {
  hazardsMin: [0, 0],      // [at diff 0, at diff 1]
  hazardsMax: [1, 1],      // never more than one hazard per track per row
  restChance: [0.7, 0.45], // chance a beat is simply empty — space to breathe between hazards
  blockingShare: [0.2, 0.4],
  comboChance: [0, 0.1],   // arch then drusen next beat in the same lane
  wideChance: [0, 0.09],   // a two-lane block instead of a single hazard
  rollerChance: [0, 0.06],
  kaijuHold: [0.45, 0.3],  // chance a thrower's beat holds its fire, so kaiju stretches still breathe
  wallEvery: 10,           // in chunks, once diff > 0.7: a torii wall with one slide-through lane
  releaseBelow: 0.4,       // wave value under which a chunk is a "release" chunk (breathing room)
  powerChance: 0.4,        // per track per chunk
  coinRunChance: 0.55,     // coins are the reward, not the clutter — these stay generous
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

/** Reach set for a fresh lane group: every passable lane. */
export function initialReach(mask = null, lanes = LANES) {
  const r = new Array(lanes).fill(false);
  for (let l = 0; l < lanes; l++) r[l] = !mask || passable(mask, l);
  return r;
}

/**
 * Solvability grammar. `reach` is the set of lanes the runner can be in after the
 * previous row (a one-step check against the previous mask is not enough — a lane
 * can be passable but unreachable). Returns the new reach set, or null if the row
 * cannot be passed.
 */
export function stepReach(mask, reach, prev = null, lanes = LANES) {
  let blocking = 0;
  for (let l = 0; l < lanes; l++) if (BLOCKING.has(mask[l])) blocking++;
  if (blocking > lanes - 1) return null;
  const r = new Array(lanes).fill(false);
  let any = false;
  for (let l = 0; l < lanes; l++) {
    if (!passable(mask, l)) continue;
    for (let d = -1; d <= 1; d++) {
      const p = l + d;
      if (p < 0 || p >= lanes || !reach[p]) continue;
      // no forced double-action: arch->drusen (or reverse) in one lane when you can't step aside
      if (d === 0 && prev && ACTION[mask[l]] && ACTION[prev[l]] && ACTION[mask[l]] !== ACTION[prev[l]]) {
        const leftOk = l - 1 >= 0 && reach[l - 1] && passable(mask, l - 1);
        const rightOk = l + 1 < lanes && reach[l + 1] && passable(mask, l + 1);
        if (!leftOk && !rightOk) continue;
      }
      r[l] = true; any = true; break;
    }
  }
  return any ? r : null;
}

export function rowSolvable(mask, prev = null, lanes = LANES) { return stepReach(mask, initialReach(prev, lanes), prev, lanes) !== null; }

function weightedPick(rng, items, weights) {
  let t = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { t -= weights[i]; if (t <= 0) return items[i]; }
  return items[items.length - 1];
}

/**
 * One lane group's worth of rows and cells. Pure in (seed, index, group).
 *
 * `base` is the group's first global lane and `LANES_IN` how many lanes it holds — normally
 * a 3-lane track (base 0 or 3), but on a fork chunk the road is carved into narrower roads
 * and each is generated, and proved solvable, entirely on its own.
 */
function generateTrack(seed, index, track, diff, wave, z0, kaiju = null, waveBeats = new Set(), cfg = DIFFICULTY.normal, crossing = false, base = track * LANES, LANES_IN = LANES) {
  const rng = mulberry32(mixSeed(mixSeed(seed, index), 0x7a + track));
  const cells = [], rows = [];
  /** A cell in this group's lane `l` → the global lane as the road's (track, lane), plus the road it is on. */
  const at = (l) => { const g = base + l; return { lane: g % LANES, track: Math.floor(g / LANES), grp: track }; };
  const release = !kaiju && wave < TUNING.releaseBelow && index > 2;         // a thrower's chunk is never a release chunk
  const wall = !release && !kaiju && !crossing && diff > 0.7 && index % TUNING.wallEvery === 0;
  let reach = initialReach(null, LANES_IN);
  let prev = null;
  const empty = () => new Array(LANES_IN).fill(null);
  const v = () => rng.int(0, VARIANTS - 1);

  const hMin = Math.round(lerp(TUNING.hazardsMin[0], TUNING.hazardsMin[1], diff));
  const hMax = Math.round(lerp(TUNING.hazardsMax[0], TUNING.hazardsMax[1], diff));
  const blockShare = lerp(TUNING.blockingShare[0], TUNING.blockingShare[1], diff);
  const comboChance = lerp(TUNING.comboChance[0], TUNING.comboChance[1], diff);
  const wideChance = lerp(TUNING.wideChance[0], TUNING.wideChance[1], diff);
  const rollerChance = lerp(TUNING.rollerChance[0], TUNING.rollerChance[1], diff);
  const restChance = lerp(TUNING.restChance[0], TUNING.restChance[1], diff);
  const kaijuHold = lerp(TUNING.kaijuHold[0], TUNING.kaijuHold[1], diff);

  const commit = (mask) => {
    for (let l = 0; l < LANES_IN; l++) {
      const t = mask[l]; if (!t) continue;
      const thrown = mask.thrown ? { thrown: true, side: kaiju.side, by: kaiju.id } : {};
      if (t === 'wave') { if (l === 0) cells.push({ z: mask.z, ...at(0), type: 'wave', span: LANES_IN, v: v(), ...thrown }); continue; }
      if (t === 'wide') { if (mask.wideLeft === l) cells.push({ z: mask.z, ...at(l), type: 'wide', span: 2, v: v(), ...thrown }); continue; }
      if (t === 'roller') { if (mask.rollerLane === l) cells.push({ z: mask.z, ...at(l), type: 'roller', dir: mask.rollerDir, period: mask.rollerPeriod, v: v() }); continue; }
      cells.push({ z: mask.z, ...at(l), type: t, v: mask.crossing ? 0 : v(), wall: !!mask.wall, ...thrown });   // crossing gates are variant 0 of the suburb arch
    }
    rows.push(mask);
    reach = stepReach(mask, reach, prev, LANES_IN) || initialReach(mask, LANES_IN);   // never null for committed masks; defensive
    prev = mask;
  };

  for (let b = 0; b < BEATS; b++) {
    const zb = z0 + b * BEAT_LEN + BEAT_LEN * 0.5;
    const breath = b === BEATS - 1;                 // last beat: always clear, so chunks never depend on each other
    const wallTelegraph = wall && b === 2;          // clear beat before the wall
    if (crossing && b === 1) { const m = empty(); m.z = zb; commit(m); continue; }                                    // the clear beat before the crossing
    if (crossing && b === 2) { const m = empty(); m.z = zb; m.wall = true; m.crossing = true; for (let l = 0; l < LANES_IN; l++) m[l] = 'arch'; commit(m); continue; }   // gate arms down across every lane: slide
    if (index === 0 || release || breath || wallTelegraph) { const m = empty(); m.z = zb; commit(m); continue; }
    if (!kaiju && !(wall && b === 3) && rng.chance(restChance)) { const m = empty(); m.z = zb; commit(m); continue; }   // a rest beat: nothing to read

    if (kaiju) {
      // the kaiju throws: every beat gets one of its hazards (a wave spans the whole road), still through the grammar
      let mask, tries = 0;
      do {
        mask = empty(); mask.z = zb; mask.thrown = true;
        if (waveBeats.has(b)) { for (let l = 0; l < LANES_IN; l++) mask[l] = 'wave'; }
        else {
          const kinds = kaiju.throws.filter(k => k !== 'wave');
          const kind = rng.pick(kinds);
          if (rng.chance(kaiju.id === 'bridge' ? 0.35 : kaijuHold)) { /* a beat that holds: even a kaiju stretch has to breathe */ }
          else if (kind === 'wide') { const left = rng.int(0, LANES_IN - 2); mask[left] = mask[left + 1] = 'wide'; mask.wideLeft = left; }
          else mask[rng.int(0, LANES_IN - 1)] = kind;
        }
        tries++;
      } while (!stepReach(mask, reach, prev, LANES_IN) && tries < 12);
      if (!stepReach(mask, reach, prev, LANES_IN)) { mask = empty(); mask.z = zb; }
      commit(mask); continue;
    }

    if (wall && b === 3) {
      // Torii wall: posts in two lanes, a gate you must slide under in the third. The beat
      // before is clear, so every lane is reachable and the wall is always fair.
      const open = rng.int(0, LANES_IN - 1);
      const m = empty(); m.z = zb; m.wall = true;
      for (let l = 0; l < LANES_IN; l++) m[l] = l === open ? 'arch' : 'stalk';
      if (stepReach(m, reach, prev, LANES_IN)) { commit(m); continue; }
      const e = empty(); e.z = zb; commit(e); continue;
    }

    let mask, tries = 0;
    do {
      mask = empty(); mask.z = zb;
      if (rng.chance(wideChance)) {
        const left = rng.int(0, LANES_IN - 2);
        mask[left] = mask[left + 1] = 'wide'; mask.wideLeft = left;
      } else if (rng.chance(rollerChance)) {
        const l0 = rng.int(0, LANES_IN - 1); const dir = l0 === 0 ? 1 : l0 === LANES_IN - 1 ? -1 : (rng.chance(0.5) ? 1 : -1);
        mask[l0] = mask[l0 + dir] = 'roller'; mask.rollerLane = l0; mask.rollerDir = dir; mask.rollerPeriod = 150 + rng.int(0, 60);
      } else {
        const count = rng.int(hMin, hMax);
        const lanes = Array.from({ length: LANES_IN }, (_, i) => i);
        for (let i = 0; i < count && lanes.length; i++) {
          const l = lanes.splice(Math.floor(rng() * lanes.length), 1)[0];
          const blocking = rng.chance(blockShare);
          mask[l] = blocking ? (rng.chance(0.35) ? 'gap' : 'stalk') : (rng.chance(0.5) ? 'arch' : 'drusen');
        }
        // combo: continue an action lane from the previous row with the *other* action
        if (prev && rng.chance(comboChance)) {
          const l = rng.int(0, LANES_IN - 1);
          if (ACTION[prev[l]] && !mask[l]) mask[l] = prev[l] === 'arch' ? 'drusen' : 'arch';
        }
      }
      tries++;
    } while (!stepReach(mask, reach, prev, LANES_IN) && tries < 12);
    if (!stepReach(mask, reach, prev, LANES_IN)) { mask = empty(); mask.z = zb; }   // give up: an empty row is always fair
    commit(mask);
  }

  // ---- pickups -------------------------------------------------------
  const freeLanes = (mask) => { const f = []; for (let l = 0; l < LANES_IN; l++) if (!mask[l]) f.push(l); return f; };
  for (let b = 0; b < BEATS; b++) {
    const mask = rows[b];
    const zb = z0 + b * BEAT_LEN;
    if (release || index === 0) {
      const l = (index + b + track) % LANES_IN;
      for (let i = 0; i < 4; i++) cells.push({ z: zb + 0.75 + i * 1.5, ...at(l), type: 'photon' });
      continue;
    }
    for (let l = 0; l < LANES_IN; l++) if (mask[l] === 'drusen') {
      for (let i = -1; i <= 1; i++) cells.push({ z: zb + BEAT_LEN * 0.5 + i * 1.0, ...at(l), type: 'photon', hi: true });
    }
    if (rng.chance(TUNING.coinRunChance)) {
      const free = freeLanes(mask);
      if (free.length) { const l = rng.pick(free); for (let i = 0; i < 3; i++) cells.push({ z: zb + 1 + i * 1.6, ...at(l), type: 'photon' }); }
    }
  }
  if (index > 1 && rng.chance(Math.min(0.9, TUNING.powerChance * cfg.power))) {
    const b = rng.int(1, BEATS - 2); const free = freeLanes(rows[b]);
    if (free.length) cells.push({ z: z0 + b * BEAT_LEN + 3, ...at(rng.pick(free)), type: 'power', kind: weightedPick(rng, POWERS, POWER_WEIGHTS), v: v() });
  }
  return { cells, rows, release, wall: wall || crossing };   // a crossing chunk is straight, like a wall chunk
}

/**
 * Pure: (seed, index) -> Chunk, one lane group at a time. Off a fork the groups are
 * the two 3-lane tracks, exactly as they have always been; on a fork chunk the six
 * lanes are carved into narrower roads and each is generated, and proved solvable,
 * entirely on its own — nobody can be asked to cross a gap that is no longer there.
 *
 * The last beat of every group is always clear (the "breath beat"), so chunks never
 * depend on each other, and a fork can start or end on any chunk boundary.
 */
export function generate(seed, index, cfg = DIFFICULTY.normal) {
  const { diff, wave } = difficultyAt(seed, index, cfg);
  const z0 = index * CHUNK_LEN;
  const sp = setpieceAt(index);
  const kaiju = kaijuOf(index) || (sp && SETPIECE[sp].throws.length ? { ...SETPIECE[sp], setpiece: true } : null);   // set pieces that throw use the kaiju path
  const waveBeats = new Set();
  if (kaiju && kaiju.throws.includes('wave')) { const r = mulberry32(mixSeed(seed, index) ^ 0x3a7e); waveBeats.add(r.int(1, 3)); }
  const fork = cfg.forks === false ? null : forkAt(seed, index);
  const groups = fork ? laneGroups(fork.groups) : laneGroups(TRACKS);
  const tracks = groups.map((lanes, g) => generateTrack(seed, index, g, diff, wave, z0, kaiju, waveBeats, cfg, sp === 'crossing', lanes[0], lanes.length));
  const cells = tracks.flatMap(t => t.cells).sort((a, b) => a.z - b.z);
  return { index, z0, length: CHUNK_LEN, difficulty: diff, wave, release: tracks[0].release, wall: tracks.some(t => t.wall),
    biome: biomeOf(index), season: seasonOf(index), kaiju: kaiju && !kaiju.setpiece ? kaiju : null, setpiece: sp, weather: weatherOf(seed, index),
    fork, groups, cells, rows: tracks.map(t => t.rows) };
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
