// The score, as pure data: Japanese scales, one theme per province, and a
// deterministic bar generator. No WebAudio here — audio.js turns bars into sound.
// Like the road, music is a pure function of (seed, bar, province, season), so
// everyone running the same road on the same day hears the same tune.
import { mulberry32, mixSeed } from '../core/rng.js';

/** Pentatonic scales as semitone offsets from the root. */
export const SCALES = {
  yo:        [0, 2, 5, 7, 9],     // bright folk pentatonic — spring and summer
  insen:     [0, 1, 5, 7, 10],    // 陰旋: melancholy — autumn
  hirajoshi: [0, 2, 3, 7, 8],     // 平調子: dark and cold — winter
  ryukyu:    [0, 4, 5, 7, 11],    // 琉球音階 — Okinawa, whatever the season
};
export const SEASON_SCALE = ['yo', 'yo', 'insen', 'hirajoshi'];

/**
 * One theme per province. root: MIDI note; bpm at cruising speed; instruments per voice
 * (null = silent); density: how busy the melody is; drums: pattern family.
 */
export const THEMES = {
  kyoto:    { root: 62, bpm: 92,  lead: 'flute',   arp: 'koto',    bass: null,    drums: 'taiko', pad: 'air',   density: 0.45, scale: null },
  osaka:    { root: 57, bpm: 118, lead: 'koto',    arp: 'synth',   bass: 'synth', drums: 'kit',   pad: 'neon',  density: 0.7,  scale: null },
  nara:     { root: 64, bpm: 100, lead: 'koto',    arp: 'koto',    bass: 'soft',  drums: 'hand',  pad: 'air',   density: 0.5,  scale: null },
  shonan:   { root: 60, bpm: 108, lead: 'sanshin', arp: 'koto',    bass: 'soft',  drums: 'hand',  pad: 'air',   density: 0.55, scale: null },
  hakone:   { root: 59, bpm: 96,  lead: 'flute',   arp: 'shamisen', bass: null,   drums: 'taiko', pad: null,    density: 0.5,  scale: null },
  tokyo:    { root: 55, bpm: 124, lead: 'synth',   arp: 'synth',   bass: 'synth', drums: 'kit',   pad: 'neon',  density: 0.75, scale: null },
  hokkaido: { root: 67, bpm: 84,  lead: 'bell',    arp: 'bell',    bass: 'soft',  drums: null,    pad: 'air',   density: 0.35, scale: null },
  okinawa:  { root: 62, bpm: 112, lead: 'sanshin', arp: 'sanshin', bass: 'soft',  drums: 'hand',  pad: null,    density: 0.6,  scale: 'ryukyu' },
};
export const STEPS = 16;                        // sixteenths per bar (4/4)
export const PHRASE = 4;                        // bars per phrase; phrases repeat with variation

/** Drum patterns per family, as [step, kind, velocity]. `drive` variants are for kaiju and set pieces. */
const DRUMS = {
  taiko: [[0, 'taiko', 1], [6, 'taiko', 0.6], [8, 'taiko', 0.9], [14, 'rim', 0.5]],
  kit:   [[0, 'kick', 1], [4, 'snare', 0.7], [8, 'kick', 0.9], [10, 'kick', 0.5], [12, 'snare', 0.8], [2, 'hat', 0.4], [6, 'hat', 0.4], [10, 'hat', 0.4], [14, 'hat', 0.5]],
  hand:  [[0, 'hand', 0.9], [3, 'hand', 0.5], [6, 'hand', 0.6], [8, 'hand', 0.8], [11, 'hand', 0.5], [14, 'rim', 0.4]],
  drive: [[0, 'taiko', 1], [2, 'taiko', 0.5], [4, 'taiko', 0.8], [6, 'taiko', 0.5], [8, 'taiko', 1], [10, 'taiko', 0.5], [12, 'taiko', 0.8], [13, 'rim', 0.4], [14, 'taiko', 0.6], [15, 'rim', 0.4]],
};

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** MIDI note of scale degree `deg` (any integer; octaves wrap) above `root`. */
export function degreeNote(root, scale, deg) {
  const n = scale.length, oct = Math.floor(deg / n), i = ((deg % n) + n) % n;
  return root + oct * 12 + scale[i];
}

/**
 * The bar `bar` of the score for one province and season. Pure in (seed, bar, themeId, season).
 * Returns { notes: [{ step, voice, note, len, vel }], drums: [{ step, kind, vel }], scale, root }.
 * opts.drive adds the kaiju/avalanche drum drive; opts.tension (0..1) darkens the melody.
 */
export function barFor(seed, bar, themeId, season, opts = {}) {
  const th = THEMES[themeId] || THEMES.kyoto;
  const scaleId = th.scale || SEASON_SCALE[season] || 'yo';
  const scale = SCALES[scaleId];
  const phrase = Math.floor(bar / PHRASE), b = ((bar % PHRASE) + PHRASE) % PHRASE;
  const rng = mulberry32(mixSeed(mixSeed(seed ^ 0x5c0e, phrase), themeId.length * 131 + season));
  const notes = [], drums = [];

  // --- melody: a random walk in scale degrees over the whole phrase; we keep only this bar.
  //     Phrases start on the root and land on the root (or the fifth) at the end, so they resolve.
  let deg = 0, step = 0;
  const density = th.density * (1 - 0.25 * (opts.tension || 0));
  for (let pb = 0; pb < PHRASE; pb++) {
    step = 0;
    while (step < STEPS) {
      const rest = rng() > density;
      const len = rng.chance(0.18) ? 4 : rng.chance(0.45) ? 2 : 1;
      if (!rest) {
        if (pb === PHRASE - 1 && step >= STEPS - 4) deg = rng.chance(0.7) ? 0 : 3;   // resolve
        else { const d = rng.pick([-2, -1, -1, 1, 1, 2, 3]); deg = Math.max(-2, Math.min(9, deg + d)); if (rng.chance(0.08)) deg = 0; }
        if (pb === b) notes.push({ step, voice: 'lead', note: degreeNote(th.root + 12, scale, deg), len, vel: 0.55 + rng() * 0.35 });
      }
      step += len;
    }
  }
  // --- arpeggio: root / third-ish / fifth / octave on eighths, a fresh figure per phrase
  if (th.arp) {
    const figure = rng.pick([[0, 2, 4, 5], [0, 4, 2, 4], [0, 2, 4, 2, 5, 4, 2, 0], [4, 2, 0, 2]]);
    const every = th.density > 0.6 ? 2 : 4;
    for (let s = 0, i = 0; s < STEPS; s += every, i++) {
      if (rng.chance(0.15)) continue;
      const shift = b === PHRASE - 1 && s >= 8 ? -1 : 0;                                 // a small turn before the phrase repeats
      notes.push({ step: s, voice: 'arp', note: degreeNote(th.root, scale, figure[i % figure.length] + shift), len: every, vel: 0.35 + rng() * 0.2 });
    }
  }
  // --- bass: root on the one, fifth on the three (or a walk-up at the end of the phrase)
  if (th.bass) {
    notes.push({ step: 0, voice: 'bass', note: th.root - 12, len: 6, vel: 0.9 });
    notes.push({ step: 8, voice: 'bass', note: degreeNote(th.root - 12, scale, b === PHRASE - 1 ? 2 : 3), len: 6, vel: 0.75 });
    if (th.density > 0.6) notes.push({ step: 14, voice: 'bass', note: th.root - 12, len: 2, vel: 0.5 });
  }
  // --- drums
  const family = opts.drive ? 'drive' : th.drums;
  if (family) for (const [s, kind, vel] of DRUMS[family]) { if (!opts.drive && b !== PHRASE - 1 && rng.chance(0.1)) continue; drums.push({ step: s, kind, vel }); }
  if (b === PHRASE - 1 && family && family !== 'kit') for (const s of [12, 13, 14, 15]) drums.push({ step: s, kind: family === 'drive' || family === 'taiko' ? 'taiko' : 'hand', vel: 0.3 + 0.15 * (s - 12) });   // a fill into the next phrase
  return { notes, drums, scale: scaleId, root: th.root, bpm: th.bpm };
}
