// The score is pure data: same (seed, bar, province, season) → same bar, every note in scale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { barFor, SCALES, SEASON_SCALE, THEMES, STEPS, PHRASE, degreeNote, midiToHz } from '../prototype/src/audio/score.js';
import { PROVINCES } from '../prototype/src/core/chunks.js';

test('every province has a theme; bars are deterministic and differ across seeds and phrases', () => {
  for (const p of PROVINCES) assert.ok(THEMES[p.id], `theme for ${p.id}`);
  const a = barFor(7, 5, 'osaka', 0), b = barFor(7, 5, 'osaka', 0);
  assert.deepEqual(a, b);
  assert.notDeepEqual(barFor(8, 5, 'osaka', 0).notes, a.notes, 'another seed, another tune');
  assert.notDeepEqual(barFor(7, 5 + PHRASE, 'osaka', 0).notes, a.notes, 'the next phrase varies');
  assert.equal(barFor(7, 5, 'osaka', 0).bpm, THEMES.osaka.bpm);
});

test('notes stay in the season scale (Okinawa keeps ryukyu) and inside the bar', () => {
  for (const p of PROVINCES) for (let season = 0; season < 4; season++) for (let bar = 0; bar < 12; bar++) {
    const th = THEMES[p.id], b = barFor(11, bar, p.id, season);
    const scaleId = th.scale || SEASON_SCALE[season]; assert.equal(b.scale, scaleId);
    const scale = SCALES[scaleId];
    for (const n of b.notes) {
      assert.ok(n.step >= 0 && n.step < STEPS && n.len >= 1, 'step within the bar');
      assert.ok(scale.includes((((n.note - th.root) % 12) + 12) % 12), `${p.id} ${n.voice} note ${n.note} in ${scaleId}`);
      assert.ok(n.vel > 0 && n.vel <= 1);
    }
    for (const d of b.drums) assert.ok(d.step >= 0 && d.step < STEPS);
    if (th.drums) assert.ok(b.drums.length > 0, `${p.id} has drums`);
    if (th.bass) assert.ok(b.notes.some(n => n.voice === 'bass'), `${p.id} has a bass line`);
    assert.ok(b.notes.some(n => n.voice === 'lead') || bar % PHRASE !== 0, 'a phrase opens with melody');
  }
  const drive = barFor(11, 3, 'hokkaido', 3, { drive: true });
  assert.ok(drive.drums.length >= 8, 'the kaiju drive adds taiko even where the theme has no drums');
});

test('scale helpers', () => {
  assert.equal(degreeNote(60, SCALES.yo, 0), 60); assert.equal(degreeNote(60, SCALES.yo, 5), 72); assert.equal(degreeNote(60, SCALES.yo, -1), 57);
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
});
