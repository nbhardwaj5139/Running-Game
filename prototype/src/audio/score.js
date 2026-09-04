// The score, as pure data: Japanese scales, one theme per province, and a
// deterministic bar generator. No WebAudio here — audio.js turns bars into sound.
// Like the road, music is a pure function of (seed, bar, province, season), so
// everyone running the same road on the same day hears the same tune.
//
// The feel is lo-fi: a four-chord loop per phrase, swung sixteenths, a melody that
// sits on chord tones and rests more than it plays. Nothing wanders — an endless
// runner's score has to bear an hour of listening, so it repeats on purpose and
// changes by *layer* (see `layersFor`) rather than by restlessness.
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
 * (null = silent); density: how busy the melody is; drums: pattern family; swing: how far
 * the offbeat sixteenths are pushed late (0 = straight, 0.5 = full triplet shuffle).
 */
export const THEMES = {
  kyoto:    { root: 62, bpm: 74, lead: 'flute',   arp: 'rhodes',  bass: 'soft',  drums: 'lofi',  pad: 'air',  density: 0.3,  swing: 0.34, scale: null },
  osaka:    { root: 57, bpm: 82, lead: 'rhodes',  arp: 'rhodes',  bass: 'sub',   drums: 'lofi',  pad: 'neon', density: 0.38, swing: 0.38, scale: null },
  nara:     { root: 64, bpm: 72, lead: 'koto',    arp: 'rhodes',  bass: 'soft',  drums: 'brush', pad: 'air',  density: 0.32, swing: 0.36, scale: null },
  shonan:   { root: 60, bpm: 78, lead: 'sanshin', arp: 'rhodes',  bass: 'soft',  drums: 'brush', pad: 'air',  density: 0.34, swing: 0.36, scale: null },
  hakone:   { root: 59, bpm: 70, lead: 'flute',   arp: 'koto',    bass: 'sub',   drums: 'lofi',  pad: 'air',  density: 0.28, swing: 0.32, scale: null },
  tokyo:    { root: 55, bpm: 86, lead: 'rhodes',  arp: 'pluck',   bass: 'sub',   drums: 'lofi',  pad: 'neon', density: 0.4,  swing: 0.4,  scale: null },
  hokkaido: { root: 67, bpm: 66, lead: 'bell',    arp: 'rhodes',  bass: 'soft',  drums: 'brush', pad: 'air',  density: 0.26, swing: 0.3,  scale: null },
  okinawa:  { root: 62, bpm: 80, lead: 'sanshin', arp: 'rhodes',  bass: 'soft',  drums: 'brush', pad: 'air',  density: 0.36, swing: 0.38, scale: 'ryukyu' },
};
export const STEPS = 16;                        // sixteenths per bar (4/4)
export const PHRASE = 4;                        // bars per phrase; one chord per bar

/** Drum patterns per family, as [step, kind, velocity]. `drive` is for kaiju and set pieces. */
const DRUMS = {
  lofi:  [[0, 'kick', 0.85], [6, 'kick', 0.4], [4, 'snare', 0.5], [12, 'snare', 0.55], [2, 'hat', 0.2], [7, 'hat', 0.16], [10, 'hat', 0.22], [14, 'hat', 0.15]],
  brush: [[0, 'kick', 0.7], [4, 'rim', 0.35], [8, 'kick', 0.5], [10, 'hand', 0.3], [12, 'rim', 0.4], [6, 'hat', 0.14], [14, 'hat', 0.16]],
  taiko: [[0, 'taiko', 1], [6, 'taiko', 0.6], [8, 'taiko', 0.9], [14, 'rim', 0.5]],
  kit:   [[0, 'kick', 1], [4, 'snare', 0.7], [8, 'kick', 0.9], [10, 'kick', 0.5], [12, 'snare', 0.8], [2, 'hat', 0.4], [6, 'hat', 0.4], [10, 'hat', 0.4], [14, 'hat', 0.5]],
  hand:  [[0, 'hand', 0.9], [3, 'hand', 0.5], [6, 'hand', 0.6], [8, 'hand', 0.8], [11, 'hand', 0.5], [14, 'rim', 0.4]],
  drive: [[0, 'taiko', 1], [2, 'taiko', 0.5], [4, 'taiko', 0.8], [6, 'taiko', 0.5], [8, 'taiko', 1], [10, 'taiko', 0.5], [12, 'taiko', 0.8], [13, 'rim', 0.4], [14, 'taiko', 0.6], [15, 'rim', 0.4]],
};

/** Chord loops, as scale degrees for the four bars of a phrase. All resolve home. */
const LOOPS = [[0, 3, 1, 4], [0, 4, 2, 3], [0, 2, 4, 2], [0, 3, 4, 1], [0, 1, 3, 2]];
/** A chord is three pentatonic degrees stacked — the scale does the harmony for us. */
const VOICING = [0, 2, 4];

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** MIDI note of scale degree `deg` (any integer; octaves wrap) above `root`. */
export function degreeNote(root, scale, deg) {
  const n = scale.length, oct = Math.floor(deg / n), i = ((deg % n) + n) % n;
  return root + oct * 12 + scale[i];
}

/**
 * Which layers of the arrangement are playing at this run speed (m/s). The music is
 * always the same tune; going faster brings more of it in, and the whole thing is
 * built so a layer arriving never sounds like a different track starting.
 * Returns { pad, bass, drums, hats, arp, lead, bpm, open } — `open` (0..1) is how far
 * the lo-fi filter lifts off the music bus.
 */
export function layersFor(speed = 14, base = 14, max = 27) {
  const t = Math.min(1, Math.max(0, (speed - base) / Math.max(1, max - base)));
  return {
    pad: true,
    bass: true,
    drums: t > 0.05,
    hats: t > 0.3,
    arp: t > 0.15,
    lead: t > 0.5,
    double: t > 0.8,          // the melody doubles an octave up at full tilt
    tempo: 0.88 + 0.34 * t,   // the loop leans forward as the road speeds up
    open: t,
    t,
  };
}

/**
 * The bar `bar` of the score for one province and season. Pure in (seed, bar, themeId, season).
 * Returns { notes: [{ step, voice, note, len, vel }], drums: [{ step, kind, vel }], scale, root, bpm, swing, chord }.
 * opts.drive adds the kaiju/avalanche drum drive; opts.tension (0..1) thins the melody.
 */
export function barFor(seed, bar, themeId, season, opts = {}) {
  const th = THEMES[themeId] || THEMES.kyoto;
  const scaleId = th.scale || SEASON_SCALE[season] || 'yo';
  const scale = SCALES[scaleId];
  const phrase = Math.floor(bar / PHRASE), b = ((bar % PHRASE) + PHRASE) % PHRASE;
  const rng = mulberry32(mixSeed(mixSeed(seed ^ 0x5c0e, phrase), themeId.length * 131 + season));
  const notes = [], drums = [];

  // --- the chord this bar sits on; the whole arrangement agrees with it
  const loop = LOOPS[rng.int(0, LOOPS.length - 1)];
  const chord = loop[b];
  const tones = VOICING.map(v => chord + v);

  // --- keys: the chord, laid down as a lazy off-beat comp. This is the bed of the track.
  if (th.arp) {
    const comp = rng.pick([[0, 6, 10], [0, 7], [2, 8, 14], [0, 6, 8, 14]]);
    for (const s of comp) for (const [i, deg] of tones.entries()) {
      if (i > 0 && rng.chance(0.15)) continue;
      notes.push({ step: s, voice: 'arp', note: degreeNote(th.root, scale, deg), len: 4, vel: 0.3 + rng() * 0.12 - i * 0.04 });
    }
  }

  // --- bass: the root of the chord, held, with one push into the next bar
  if (th.bass) {
    notes.push({ step: 0, voice: 'bass', note: degreeNote(th.root - 12, scale, chord), len: 8, vel: 0.85 });
    if (rng.chance(0.55)) notes.push({ step: 10, voice: 'bass', note: degreeNote(th.root - 12, scale, chord + (b === PHRASE - 1 ? 2 : 0)), len: 4, vel: 0.55 });
  }

  // --- melody: a handful of chord tones per bar with long gaps. The first bar of a
  //     phrase always states the theme; the others answer it and often say nothing.
  const density = th.density * (1 - 0.3 * (opts.tension || 0)) * (b === 0 ? 1.6 : 1);
  const slots = [0, 3, 6, 8, 11, 14];
  let last = chord + 4;
  for (const s of slots) {
    if (!(b === 0 && s === 0) && rng() > density) continue;
    const step = rng.chance(0.35) ? Math.min(STEPS - 1, s + 1) : s;
    const deg = rng.chance(0.7) ? tones[rng.int(0, tones.length - 1)] : last + rng.pick([-1, 1]);
    last = Math.max(chord - 2, Math.min(chord + 7, deg));
    notes.push({ step, voice: 'lead', note: degreeNote(th.root + 12, scale, last), len: rng.chance(0.4) ? 4 : 2, vel: 0.45 + rng() * 0.25 });
  }

  // --- drums
  const family = opts.drive ? 'drive' : th.drums;
  if (family) for (const [s, kind, vel] of DRUMS[family]) { if (!opts.drive && b !== PHRASE - 1 && rng.chance(0.08)) continue; drums.push({ step: s, kind, vel }); }
  if (b === PHRASE - 1 && family && family !== 'kit') for (const s of [13, 15]) drums.push({ step: s, kind: family === 'drive' || family === 'taiko' ? 'taiko' : 'rim', vel: 0.25 + 0.12 * (s - 13) });   // a small fill into the next phrase
  return { notes, drums, scale: scaleId, root: th.root, bpm: th.bpm, swing: opts.drive ? 0 : (th.swing ?? 0.33), chord };
}
