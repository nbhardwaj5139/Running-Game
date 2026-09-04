// Sound for KITSUNE. Everything is synthesised with WebAudio — no files, so the
// zero-build / one-file-bundle story holds. Three layers:
//   music     the generative score (score.js), one theme per province, scale per
//             season, tempo following the run speed, a taiko drive under kaiju
//   ambience  a bed per biome (wind, sea, city hum, crickets, cicadas, rain),
//             the typhoon's drone as the bar drains, an avalanche rumble
//   sfx       one-shots for sim events: shamisen stings on pickups, thuds, whooshes,
//             temple bell on a new province, gong on death
// Browsers only start audio after a gesture: call unlock() from the first key/tap.
import { barFor, layersFor, STEPS, THEMES, midiToHz } from './score.js';

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const BIOME_ID = ['mountain', 'city', 'suburb', 'coast'];

export class GameAudio {
  constructor(seed) {
    this.seed = seed >>> 0; this.ctx = null; this.muted = false; this.volume = 1;
    try { this.muted = localStorage.getItem('kitsune.mute') === '1'; const v = parseFloat(localStorage.getItem('kitsune.volume')); if (v >= 0 && v <= 1) this.volume = v; } catch {}
    this.state = { themeId: 'kyoto', season: 0, biome: 0, speed: 14, night: 0, dread: 0, weather: null, drive: false, avalanche: false, running: false, alive: true, jetpack: false, dash: false, dawn: false, thunder: 0 };
    this.bar = 0; this.step = 0; this.nextStep = 0; this.pattern = null; this.lastThunder = -9; this.lastStrike = -9; this.played = 0; this.gongT = 0;
    this.padNote = null;
  }
  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Create (once) and resume the context. Must run inside a user gesture the first time. */
  unlock() {
    if (!this.ctx) this._build();
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }
  setMuted(m) { this.muted = m; try { localStorage.setItem('kitsune.mute', m ? '1' : '0'); } catch {} if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05); }
  toggleMuted() { this.setMuted(!this.muted); return this.muted; }
  /** 0..1, remembered; mute sits on top of it, so un-muting comes back at the level you set. */
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); try { localStorage.setItem('kitsune.volume', String(this.volume)); } catch {} if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05); }
  setSeed(seed) { this.seed = seed >>> 0; this.bar = 0; this.step = 0; }

  // ---------------------------------------------------------------- graph
  _build() {
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = this.muted ? 0 : this.volume; this.master.connect(C.destination);
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25; comp.connect(this.master);
    this.bus = comp;
    this.tone = C.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 9000; this.tone.connect(comp);
    // The lo-fi chain the whole score runs through: roll the top off, take the deep
    // bottom out (the way a sampled record sounds), and open it up as the run speeds up.
    this.lofi = C.createBiquadFilter(); this.lofi.type = 'lowpass'; this.lofi.frequency.value = 1800; this.lofi.Q.value = 0.6; this.lofi.connect(this.tone);
    const rumbleCut = C.createBiquadFilter(); rumbleCut.type = 'highpass'; rumbleCut.frequency.value = 45; rumbleCut.connect(this.lofi);
    this.music = this._gain(0.55, rumbleCut);
    this.sfx = this._gain(0.9, comp);
    this.amb = this._gain(0.7, comp);
    // 2 s of white noise, looped by every noise-based voice
    const n = C.sampleRate * 2, buf = C.createBuffer(1, n, C.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // a short feedback echo gives plucks a room
    this.echo = C.createDelay(0.6); this.echo.delayTime.value = 0.28; const fb = this._gain(0.28, this.echo); this.echo.connect(fb);
    const echoTone = C.createBiquadFilter(); echoTone.type = 'lowpass'; echoTone.frequency.value = 2400; this.echo.connect(echoTone); echoTone.connect(this._gain(0.35, this.tone));
    this._buildAmbience();
    this._buildPad();
    this.nextStep = C.currentTime + 0.1;
  }
  _gain(v, dest) { const g = this.ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  _osc(type, freq, t0, t1, dest, detune = 0) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0); if (detune) o.detune.value = detune; o.connect(dest); o.start(t0); o.stop(t1 + 0.05); return o; }
  _noise(t0, t1, dest) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = Math.random() * 1.5; s.connect(dest); s.start(t0); s.stop(t1 + 0.05); return s; }
  _filter(type, freq, q, dest) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q !== undefined) f.Q.value = q; f.connect(dest); return f; }
  /** Gain envelope: attack to `peak`, optional hold, then exponential decay to silence. Returns the node and the time it ends. */
  _env(t, attack, peak, decay, hold = 0, dest = this.sfx) {
    const g = this.ctx.createGain(); g.connect(dest);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    if (hold > 0) g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
    return { g, end: t + attack + hold + decay };
  }

  // ---------------------------------------------------------------- instruments
  /** One melodic note. voice: koto | shamisen | sanshin | flute | synth | bell | bass:synth | bass:soft */
  _note(voice, t, midi, dur, vel, dest = this.music) {
    const f = midiToHz(midi), C = this.ctx;
    switch (voice) {
      case 'koto': { const { g, end } = this._env(t, 0.004, 0.5 * vel, Math.min(1.2, 0.35 + dur), 0, dest); const lp = this._filter('lowpass', 3200, 0.7, g); lp.frequency.exponentialRampToValueAtTime(700, t + 0.4);
        this._osc('triangle', f, t, end, lp); const s = this._gain(0.25, lp); this._osc('sawtooth', f, t, end, s); this._osc('sine', f * 2, t, end, this._gain(0.12, g)); g.connect(this.echo); break; }
      case 'shamisen': { const { g, end } = this._env(t, 0.003, 0.55 * vel, 0.32 + dur * 0.4, 0, dest); const lp = this._filter('lowpass', 2600, 1.2, g); lp.frequency.exponentialRampToValueAtTime(900, t + 0.25);
        const o = this._osc('sawtooth', f * 1.03, t, end, lp); o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
        const click = this._env(t, 0.001, 0.25 * vel, 0.02, 0, dest); this._noise(t, click.end, this._filter('bandpass', 3000, 1, click.g)); g.connect(this.echo); break; }
      case 'sanshin': { const { g, end } = this._env(t, 0.003, 0.45 * vel, 0.4 + dur * 0.3, 0, dest); const bp = this._filter('bandpass', 1900, 0.9, g);
        this._osc('square', f, t, end, this._gain(0.5, bp)); this._osc('triangle', f, t, end, bp); this._osc('triangle', f * 2.01, t, end, this._gain(0.2, g)); g.connect(this.echo); break; }
      case 'flute': { const len = Math.max(0.25, dur - 0.05); const { g, end } = this._env(t, 0.07, 0.42 * vel, 0.14, len, dest);
        const o = this._osc('sine', f, t, end, g); this._osc('triangle', f, t, end, this._gain(0.22, g));
        const vib = this._osc('sine', 5.5, t, end, this._gain(f * 0.012, o.frequency));                                   // vibrato (the gain scales the LFO into Hz)
        const breath = this._env(t, 0.05, 0.05 * vel, 0.1, len, dest); this._noise(t, breath.end, this._filter('bandpass', f, 8, breath.g)); void vib; break; }
      case 'synth': { const sustain = dur > 0.3 ? dur - 0.1 : 0; const { g, end } = this._env(t, 0.01, 0.3 * vel, 0.22, sustain, dest); const lp = this._filter('lowpass', 4200, 2, g); lp.frequency.exponentialRampToValueAtTime(700, t + 0.3 + sustain);
        this._osc('sawtooth', f, t, end, lp, -7); this._osc('sawtooth', f, t, end, lp, 7); break; }
      case 'bell': { const { g, end } = this._env(t, 0.002, 0.35 * vel, 1.9, 0, dest);
        this._osc('sine', f, t, end, g); this._osc('sine', f * 2.76, t, end, this._gain(0.28, g)); this._osc('sine', f * 5.4, t, end, this._gain(0.08, g)); g.connect(this.echo); break; }
      case 'bass:synth': { const { g, end } = this._env(t, 0.008, 0.45 * vel, 0.35, Math.max(0, dur - 0.2), dest); const lp = this._filter('lowpass', 420, 4, g); lp.frequency.exponentialRampToValueAtTime(140, t + 0.3);
        this._osc('sawtooth', f, t, end, lp); this._osc('square', f / 2, t, end, this._gain(0.3, lp)); break; }
      case 'bass:soft': { const { g, end } = this._env(t, 0.01, 0.4 * vel, 0.5, Math.max(0, dur - 0.3), dest); this._osc('sine', f, t, end, g); this._osc('triangle', f, t, end, this._gain(0.35, g)); break; }
      // --- lo-fi voices: round, short-lived and deliberately dull at the top end ---
      case 'bass:sub': { const { g, end } = this._env(t, 0.02, 0.5 * vel, 0.45, Math.max(0, dur - 0.25), dest);
        const lp = this._filter('lowpass', 220, 0.8, g); const o = this._osc('sine', f, t, end, lp);
        o.frequency.setValueAtTime(f * 1.02, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);   // a touch of pitch drop on the attack
        this._osc('triangle', f, t, end, this._gain(0.18, lp)); break; }
      case 'rhodes': {   // electric piano: a sine carrier with a fast-decaying overtone bell, soft and warm
        const { g, end } = this._env(t, 0.012, 0.34 * vel, Math.min(1.6, 0.5 + dur), 0, dest);
        const lp = this._filter('lowpass', 1500, 0.7, g); lp.frequency.exponentialRampToValueAtTime(520, t + 0.5);
        this._osc('sine', f, t, end, lp); this._osc('triangle', f, t, end, this._gain(0.3, lp));
        const bell = this._env(t, 0.004, 0.1 * vel, 0.16, 0, dest); this._osc('sine', f * 4.02, t, bell.end, bell.g);
        g.connect(this.echo); break; }
      case 'pluck': {    // muted short pluck for the busier city themes
        const { g, end } = this._env(t, 0.004, 0.26 * vel, 0.22, 0, dest);
        const lp = this._filter('lowpass', 1900, 1.4, g); lp.frequency.exponentialRampToValueAtTime(420, t + 0.2);
        this._osc('triangle', f, t, end, lp); this._osc('sawtooth', f, t, end, this._gain(0.12, lp)); g.connect(this.echo); break; }
    }
  }
  _drum(kind, t, vel, dest = this.music) {
    const v = vel;
    switch (kind) {
      case 'taiko': { const { g, end } = this._env(t, 0.002, 0.9 * v, 0.45, 0, dest); const o = this._osc('sine', 95, t, end, g); o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
        const s = this._env(t, 0.001, 0.35 * v, 0.06, 0, dest); this._noise(t, s.end, this._filter('lowpass', 500, 0.7, s.g)); break; }
      // The kit is deliberately soft and dark: a round kick, a brushed snare and a dull
      // hat. Anything crisp up here fights the lo-fi filter and ends up sounding tinny.
      case 'kick': { const { g, end } = this._env(t, 0.004, 0.75 * v, 0.3, 0, dest); const lp = this._filter('lowpass', 260, 0.8, g); const o = this._osc('sine', 130, t, end, lp); o.frequency.exponentialRampToValueAtTime(46, t + 0.09); break; }
      case 'snare': { const { g, end } = this._env(t, 0.004, 0.3 * v, 0.19, 0, dest); this._noise(t, end, this._filter('bandpass', 1250, 0.6, this._filter('lowpass', 3200, 0.7, g))); const b = this._env(t, 0.002, 0.18 * v, 0.08, 0, dest); this._osc('triangle', 190, t, b.end, b.g); break; }
      case 'hat': { const { g, end } = this._env(t, 0.001, 0.11 * v, 0.04, 0, dest); this._noise(t, end, this._filter('bandpass', 5200, 0.9, g)); break; }
      case 'hand': { const { g, end } = this._env(t, 0.001, 0.45 * v, 0.09, 0, dest); this._noise(t, end, this._filter('bandpass', 950, 2.5, g)); const b = this._env(t, 0.001, 0.3 * v, 0.05, 0, dest); const o = this._osc('sine', 330, t, b.end, b.g); o.frequency.exponentialRampToValueAtTime(180, t + 0.05); break; }
      case 'rim': { const { g, end } = this._env(t, 0.001, 0.25 * v, 0.035, 0, dest); this._osc('sine', 820, t, end, g); this._noise(t, end, this._filter('highpass', 3000, 1, this._gain(0.4, g))); break; }
    }
  }

  // ---------------------------------------------------------------- pad + ambience (continuous, targets set per frame)
  _buildPad() {
    const C = this.ctx;
    this.pad = { gain: this._gain(0, this.music), oscs: [], filter: null, kind: null };
    const lp = this.pad.filter = this._filter('lowpass', 520, 0.8, this.pad.gain);
    for (const d of [-9, 6, 1203]) { const o = C.createOscillator(); o.type = 'sawtooth'; o.detune.value = d; o.frequency.value = 110; o.connect(this._gain(d > 1000 ? 0.12 : 0.3, lp)); o.start(); this.pad.oscs.push(o); }
    const lfo = C.createOscillator(); lfo.frequency.value = 0.09; lfo.connect(this._gain(220, lp.frequency)); lfo.start();   // slow filter sweep
  }
  _setPad(midi, kind) {
    if (!this.pad) return; const f = midiToHz(midi), t = this.ctx.currentTime;
    if (this.padNote !== midi) { for (const o of this.pad.oscs) o.frequency.setTargetAtTime(f, t, 0.4); this.padNote = midi; }
    this.pad.filter.frequency.setTargetAtTime(kind === 'neon' ? 900 : 420, t, 0.5);
  }
  _buildAmbience() {
    const C = this.ctx, A = this.layers = {};
    const layer = (name, build) => { const g = this._gain(0, this.amb); build(g); A[name] = { g, target: 0 }; };
    layer('wind', (g) => { const lp = this._filter('lowpass', 380, 0.5, g); this._noise(0, 1e9, lp); const lfo = C.createOscillator(); lfo.frequency.value = 0.13; lfo.connect(this._gain(180, lp.frequency)); lfo.start(); });
    layer('sea', (g) => { const mod = this._gain(0.55, g); const lp = this._filter('lowpass', 750, 0.6, mod); this._noise(0, 1e9, lp); const lfo = C.createOscillator(); lfo.frequency.value = 0.11; lfo.connect(this._gain(0.4, mod.gain)); lfo.start(); });
    layer('rain', (g) => { this._noise(0, 1e9, this._filter('highpass', 2600, 0.6, this._gain(0.5, g))); this._noise(0, 1e9, this._filter('bandpass', 900, 0.5, this._gain(0.25, g))); });
    layer('city', (g) => { const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 52; o.connect(this._filter('lowpass', 120, 1, this._gain(0.5, g))); o.start(); this._noise(0, 1e9, this._filter('bandpass', 1100, 0.6, this._gain(0.18, g))); });
    // Insects used to be pure high sine tones, which is exactly the kind of thing that
    // gets tiring over a long run — they are noise-based and rolled off now.
    layer('crickets', (g) => { const lp = this._filter('lowpass', 3600, 0.7, g); for (const [f, r] of [[3100, 23], [2700, 17]]) { const mod = this._gain(0.5, lp); this._noise(0, 1e9, this._filter('bandpass', f, 9, mod)); const lfo = C.createOscillator(); lfo.type = 'square'; lfo.frequency.value = r; lfo.connect(this._gain(0.5, mod.gain)); lfo.start(); } });
    layer('cicada', (g) => { const mod = this._gain(0.5, this._filter('lowpass', 3800, 0.7, g)); this._noise(0, 1e9, this._filter('bandpass', 3200, 6, mod)); const lfo = C.createOscillator(); lfo.frequency.value = 38; lfo.connect(this._gain(0.5, mod.gain)); lfo.start(); });
    layer('drone', (g) => { const lp = this._filter('lowpass', 170, 1, g); for (const f of [36.7, 37.1, 55.3]) { const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(this._gain(0.4, lp)); o.start(); } const trem = C.createOscillator(); trem.frequency.value = 5.5; trem.connect(this._gain(0.25, g.gain)); trem.start(); });
    layer('rumble', (g) => { this._noise(0, 1e9, this._filter('lowpass', 95, 1.2, g)); });
    layer('fire', (g) => { const mod = this._gain(0.5, g); this._noise(0, 1e9, this._filter('bandpass', 2600, 0.8, mod)); const lfo = C.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 13; lfo.connect(this._gain(0.5, mod.gain)); lfo.start(); this._noise(0, 1e9, this._filter('lowpass', 320, 1, this._gain(0.8, g))); });
    layer('jet', (g) => { this._noise(0, 1e9, this._filter('lowpass', 900, 0.8, g)); const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 70; o.connect(this._filter('lowpass', 200, 1, this._gain(0.3, g))); o.start(); });
    layer('star', (g) => { const mod = this._gain(0.5, g); for (const d of [0, 7, 12]) { const o = C.createOscillator(); o.type = 'triangle'; o.frequency.value = 660 * Math.pow(2, d / 12); o.connect(this._gain(0.25, mod)); o.start(); } const lfo = C.createOscillator(); lfo.frequency.value = 8; lfo.connect(this._gain(0.5, mod.gain)); lfo.start(); });
    // vinyl: a steady bed of surface noise plus the odd pop, sitting under the music
    layer('vinyl', (g) => {
      this._noise(0, 1e9, this._filter('bandpass', 2600, 0.4, this._gain(0.09, g)));
      this._noise(0, 1e9, this._filter('highpass', 5200, 0.5, this._gain(0.05, g)));
    });
  }
  /** A vinyl pop: one short click, scattered in time by the caller. */
  _crackle() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const { g, end } = this._env(t, 0.0005, 0.045 + Math.random() * 0.05, 0.012, 0, this.amb);
    this._noise(t, end, this._filter('bandpass', 1400 + Math.random() * 3600, 2.5, g));
  }
  _target(name, v) { const L = this.layers[name]; if (!L) return; if (Math.abs(L.target - v) < 0.005) return; L.target = v; L.g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.6); }

  // ---------------------------------------------------------------- per frame
  /**
   * s: { themeId, season, biome, speed, night, dread, weather, kaiju, setpiece, running, alive, jetpack, dash, dawn, thunder }
   */
  update(dt, s) {
    Object.assign(this.state, s);
    if (!this.ready) return;
    const C = this.ctx, st = this.state, now = C.currentTime;
    const menu = !st.running ? 0.45 : 1, dead = st.alive ? 1 : 0;
    const wx = st.weather || { id: 'clear', rain: 0, gust: 0, fog: 0 }, winter = st.season === 3, summer = st.season === 1, day = 1 - st.night;
    // ambience targets per biome, season, weather, time of day
    const b = BIOME_ID[st.biome] || 'mountain';
    this._target('wind', menu * ((b === 'mountain' ? 0.3 : b === 'coast' ? 0.22 : 0.1) + (winter ? 0.25 : 0) + (wx.gust ? 0.3 : 0) + (wx.id === 'blizzard' ? 0.3 : 0)));
    this._target('sea', menu * ((b === 'coast' ? 0.55 : 0) + (st.running && st.setpiece === 'tsunami' ? 0.5 : 0)));
    this._target('fire', st.running && st.setpiece === 'fire' ? 0.45 : 0);
    if (st.running && st.setpiece === 'fire' && Math.random() < dt * 7) { const p = this._env(now, 0.001, 0.2, 0.05, 0, this.amb); this._noise(now, p.end, this._filter('bandpass', 1500 + Math.random() * 3500, 3, p.g)); }   // crackles
    this._target('rain', menu * wx.rain * 0.55);
    this._target('city', menu * (b === 'city' ? 0.4 : 0));
    this._target('crickets', menu * (!winter && b !== 'city' && st.night > 0.4 && !wx.rain ? 0.08 * st.night : 0));
    this._target('cicada', menu * (summer && (b === 'suburb' || b === 'mountain') && day > 0.5 && !wx.rain ? 0.07 * day : 0));
    this._target('drone', dead ? (st.running ? clamp01(st.dread - 0.25) * 0.75 + (st.kaiju ? 0.18 : 0) : 0) : 0.5);
    this._target('rumble', st.running ? (st.setpiece === 'avalanche' ? 0.8 : st.setpiece === 'tsunami' ? 0.7 : 0) : 0);
    this._target('jet', st.running && st.jetpack ? 0.45 : 0);
    this._target('star', st.running && st.dash ? 0.12 : 0);
    this.tone.frequency.setTargetAtTime(st.dawn ? 12000 : 9000 - 4500 * st.night * (b === 'city' ? 0.3 : 1) - 3000 * clamp01(st.dread - 0.4), now, 0.5);
    this.music.gain.setTargetAtTime(st.running && st.alive ? 0.55 - 0.15 * clamp01(st.dread - 0.5) : 0, now, st.alive ? 0.4 : 1.5);
    // thunder: the renderer flashes; we crack when a flash starts
    if (st.thunder > 0.85 && now - this.lastThunder > 1.2) { this.lastThunder = now; this.thunder(0.35 + Math.random() * 0.4); }
    // pad follows the theme
    const th = THEMES[st.themeId] || THEMES.kyoto;
    this._setPad(th.root - 12, th.pad); this.pad.gain.gain.setTargetAtTime(th.pad && st.running && st.alive ? (th.pad === 'neon' ? 0.16 : 0.12) * (st.dawn ? 1.6 : 1) : 0, now, 0.8);
    // How much of the arrangement is playing right now, and how open the lo-fi filter is.
    // This is the "music changes when you go faster" knob: same tune, more of it.
    const L = layersFor(st.speed, st.speedBase ?? 14, st.speedMax ?? 27);
    this._target('vinyl', st.running && st.alive ? 0.5 - 0.25 * L.t : st.alive ? 0.35 : 0);
    if (st.alive && Math.random() < dt * (2.2 - L.t)) this._crackle();
    this.lofi.frequency.setTargetAtTime(1250 + 4200 * L.open + (st.dash ? 2500 : 0) + (st.dawn ? 1800 : 0), now, 0.7);
    // sequencer: schedule a little ahead of the clock
    if (!st.running || !st.alive) { this.nextStep = now + 0.05; return; }
    if (this.nextStep < now - 0.5) { this.nextStep = now + 0.05; this.step = 0; }
    while (this.nextStep < now + 0.22) {
      const drive = !!st.kaiju || st.setpiece === 'avalanche';
      if (this.step === 0 || !this.pattern) this.pattern = barFor(this.seed, this.bar, st.themeId, st.season, { drive, tension: st.dread });
      const bpm = this.pattern.bpm * L.tempo * (st.dash ? 1.1 : 1);
      const stepDur = 60 / bpm / 4;
      // swing: the offbeat sixteenth arrives late, which is most of what makes it feel lo-fi
      const t = this.nextStep + (this.step % 2 ? stepDur * (this.pattern.swing ?? 0) : 0);
      for (const n of this.pattern.notes) if (n.step === this.step) {
        if (n.voice === 'lead' && !L.lead && !drive) continue;
        if (n.voice === 'arp' && !L.arp) continue;
        const voice = n.voice === 'lead' ? th.lead : n.voice === 'arp' ? th.arp : th.bass ? `bass:${th.bass}` : null;
        if (!voice) continue;
        this._note(voice, t, n.note, n.len * stepDur, n.vel * (n.voice === 'lead' ? 0.9 : 0.8)); this.played++;
        if (n.voice === 'lead' && L.double) this._note(voice, t, n.note + 12, n.len * stepDur, n.vel * 0.3);
      }
      for (const d of this.pattern.drums) if (d.step === this.step) {
        if (!L.drums && !drive) continue;
        if (d.kind === 'hat' && !L.hats) continue;
        this._drum(d.kind, t, d.vel * (st.kaiju ? 1.15 : 1));
      }
      if (st.dash && this.step % 2 === 1) this._drum('hat', t, 0.35);
      this.nextStep += stepDur; this.step++; if (this.step >= STEPS) { this.step = 0; this.bar++; }
    }
  }

  // ---------------------------------------------------------------- one-shots
  action(kind) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    if (kind === 'jump') { const { g, end } = this._env(t, 0.02, 0.16, 0.14); const bp = this._filter('bandpass', 600, 1.5, g); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.15); this._noise(t, end, bp); const o = this._env(t, 0.005, 0.08, 0.1); const s = this._osc('triangle', 420, t, o.end, o.g); s.frequency.exponentialRampToValueAtTime(760, t + 0.1); }
    else if (kind === 'slide') { const { g, end } = this._env(t, 0.005, 0.2, 0.16); const bp = this._filter('bandpass', 1500, 2, g); bp.frequency.exponentialRampToValueAtTime(400, t + 0.16); this._noise(t, end, bp); }
    else if (kind === 'lane') { const { g, end } = this._env(t, 0.01, 0.07, 0.09); this._noise(t, end, this._filter('bandpass', 1200, 1.2, g)); }
    else if (kind === 'fire') { const { g, end } = this._env(t, 0.005, 0.5, 0.6); const bp = this._filter('bandpass', 500, 1.2, g); bp.frequency.exponentialRampToValueAtTime(3400, t + 0.55); this._noise(t, end, bp); this.thud(0.45); }   // the fuse catches and it screams away
  }
  coin(streak = 0, n = 1) {
    if (!this.ready) return; const t = this.ctx.currentTime, f = 1320 * Math.pow(2, ((streak % 8) + (n > 1 ? 4 : 0)) / 12);
    const { g, end } = this._env(t, 0.002, 0.16, 0.16); this._osc('sine', f, t, end, g); this._osc('sine', f * 2, t, end, this._gain(0.3, g));
  }
  nearMiss() { if (!this.ready) return; const t = this.ctx.currentTime; const { g, end } = this._env(t, 0.03, 0.35, 0.22); const bp = this._filter('bandpass', 700, 1.4, g); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.22); this._noise(t, end, bp); this.coin(4); }
  thud(vel = 1) { if (!this.ready) return; const t = this.ctx.currentTime; const { g, end } = this._env(t, 0.002, 0.7 * vel, 0.3); const o = this._osc('sine', 130, t, end, g); o.frequency.exponentialRampToValueAtTime(38, t + 0.16); const s = this._env(t, 0.001, 0.35 * vel, 0.08); this._noise(t, s.end, this._filter('lowpass', 900, 0.7, s.g)); }
  stumble() { this.thud(0.9); if (!this.ready) return; const t = this.ctx.currentTime + 0.03; const { g, end } = this._env(t, 0.01, 0.25, 0.3); const o = this._osc('sawtooth', 520, t, end, this._filter('lowpass', 1600, 1, g)); o.frequency.exponentialRampToValueAtTime(180, t + 0.3); }
  fall() { this.thud(0.6); if (!this.ready) return; const t = this.ctx.currentTime; const { g, end } = this._env(t, 0.01, 0.3, 0.5, 0.1); const o = this._osc('triangle', 620, t, end, g); o.frequency.exponentialRampToValueAtTime(90, t + 0.55); setTimeout(() => this.thud(1), 520); }
  yip() { if (!this.ready) return; const t = this.ctx.currentTime; const { g, end } = this._env(t, 0.01, 0.22, 0.12); const o = this._osc('triangle', 980, t, end, this._filter('lowpass', 2500, 1, g)); o.frequency.exponentialRampToValueAtTime(620, t + 0.12); }
  /** A shamisen sting: three rising plucks, then a shimmer. Every pickup gets one; some kinds add their own flourish. */
  sting(kind) {
    if (!this.ready) return; const t = this.ctx.currentTime, root = 62;
    for (const [i, d] of [0, 7, 12].entries()) this._note('shamisen', t + i * 0.07, root + d, 0.3, 1, this.sfx);
    this._note('bell', t + 0.24, root + 24, 1, 0.5, this.sfx);
    switch (kind) {
      case 'dawn': for (const [i, d] of [0, 4, 7, 12, 16, 19].entries()) this._note('flute', t + 0.2 + i * 0.12, root + 12 + d, 1.4 - i * 0.1, 0.55, this.sfx); break;
      case 'susanoo': this.thunder(1, 0.1); break;
      case 'kagura': for (let i = 0; i < 8; i++) this._note('bell', t + 0.25 + i * 0.06, root + 24 + [0, 4, 7, 12][i % 4], 0.6, 0.35, this.sfx); break;
      case 'jetpack': { const { g, end } = this._env(t + 0.1, 0.25, 0.5, 0.5); const lp = this._filter('lowpass', 300, 1, g); lp.frequency.exponentialRampToValueAtTime(3000, t + 0.6); this._noise(t + 0.1, end, lp); break; }
      case 'dash': { const { g, end } = this._env(t + 0.05, 0.05, 0.3, 0.6); const o = this._osc('sawtooth', 220, t, end, this._filter('lowpass', 2500, 2, g)); o.frequency.exponentialRampToValueAtTime(1760, t + 0.6); break; }
      case 'guide': for (let i = 0; i < 3; i++) this._note('flute', t + 0.3 + i * 0.16, root + 24 - i * 3, 0.25, 0.4, this.sfx); break;
      case 'foxfire': { const { g, end } = this._env(t + 0.1, 0.2, 0.25, 0.9); this._noise(t, end, this._filter('bandpass', 2200, 6, g)); break; }
      case 'rocket': { const { g, end } = this._env(t + 0.15, 0.002, 0.35, 0.08); this._noise(t + 0.15, end, this._filter('bandpass', 2600, 4, g)); this.thud(0.25); break; }   // loaded: a click and a knock, the launch is yours
    }
  }
  /** The rocket going off: a deep thump and a long tail of rolling noise. */
  boom(n = 1) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    this.thud(1.3); const { g, end } = this._env(t, 0.005, 0.8, 0.9 + Math.min(0.6, n * 0.1));
    const lp = this._filter('lowpass', 2600, 0.6, g); lp.frequency.exponentialRampToValueAtTime(120, t + 0.9); this._noise(t, end, lp);
    const o = this._osc('sine', 70, t, end, g); o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
  }
  /** The road is about to fork: two notes, a question. The roads meeting again answers it. */
  forkCall(joining) {
    if (!this.ready) return; const t = this.ctx.currentTime, root = 74;
    if (joining) { this._note('bell', t, root + 7, 0.8, 0.45, this.sfx); this._note('bell', t + 0.14, root + 12, 1.2, 0.5, this.sfx); }
    else { this._note('flute', t, root, 0.32, 0.5, this.sfx); this._note('flute', t + 0.26, root + 5, 0.5, 0.55, this.sfx); this._note('flute', t + 0.62, root + 5, 0.5, 0.4, this.sfx); }
  }
  shieldHit() { if (!this.ready) return; this._note('bell', this.ctx.currentTime, 86, 0.8, 0.8, this.sfx); this.thud(0.4); }
  smash() { if (!this.ready) return; const t = this.ctx.currentTime; this.thud(0.8); const { g, end } = this._env(t, 0.001, 0.5, 0.25); this._noise(t, end, this._filter('bandpass', 2400, 0.9, g)); }
  strike() { if (!this.ready) return; const now = this.ctx.currentTime; if (now - this.lastStrike < 0.12) return; this.lastStrike = now; const { g, end } = this._env(now, 0.001, 0.4, 0.3); const bp = this._filter('lowpass', 5000, 0.8, g); bp.frequency.exponentialRampToValueAtTime(300, now + 0.3); this._noise(now, end, bp); }
  transmute() { if (!this.ready) return; const t = this.ctx.currentTime; for (let i = 0; i < 3; i++) this._note('bell', t + i * 0.05, 98 + i * 4, 0.5, 0.3, this.sfx); }
  gust(telegraph) { if (!this.ready) return; const t = this.ctx.currentTime; const { g, end } = this._env(t, telegraph ? 0.9 : 0.05, telegraph ? 0.3 : 0.55, telegraph ? 0.4 : 0.5); const bp = this._filter('bandpass', telegraph ? 300 : 900, 0.8, g); bp.frequency.exponentialRampToValueAtTime(telegraph ? 900 : 300, end); this._noise(t, end, bp); }
  thunder(vel = 0.6, delay = 0) {
    if (!this.ready) return; const t = this.ctx.currentTime + delay;
    const crack = this._env(t, 0.002, 0.7 * vel, 0.35); const lp = this._filter('lowpass', 6000, 0.7, crack.g); lp.frequency.exponentialRampToValueAtTime(400, t + 0.35); this._noise(t, crack.end, lp);
    const roll = this._env(t + 0.25, 0.3, 0.55 * vel, 1.8); this._noise(t + 0.25, roll.end, this._filter('lowpass', 140, 1.5, roll.g));
  }
  /** Kaiju entrance: a taiko roll and a roar. */
  kaiju(k = null) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    if (k?.fire) {   // Gojira: a roar on top of the drums — three detuned saws dragged down through a snarling bandpass
      const { g, end } = this._env(t + 0.35, 0.12, 0.75, 1.8, 0.6); const bp = this._filter('bandpass', 460, 2.2, g); bp.frequency.exponentialRampToValueAtTime(150, end);
      for (const f of [92, 97.5, 138]) { const o = this._osc('sawtooth', f, t + 0.35, end, bp); o.frequency.exponentialRampToValueAtTime(f * 0.42, end); }
    }
    for (let i = 0; i < 9; i++) this._drum('taiko', t + i * (0.22 - i * 0.015), 0.5 + i * 0.06, this.sfx);
    const { g, end } = this._env(t + 0.4, 0.3, 0.5, 1.4, 0.4); const lp = this._filter('lowpass', 900, 3, g); lp.frequency.exponentialRampToValueAtTime(160, end);
    const o = this._osc('sawtooth', 58, t + 0.4, end, lp); o.frequency.exponentialRampToValueAtTime(34, end); this._osc('square', 29, t + 0.4, end, this._gain(0.3, lp));
  }
  /** The herd: a patter of hooves across the road and a deer's whistle. */
  herd() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    for (let i = 0; i < 22; i++) { const tt = t + 0.2 + i * 0.09 + (i % 3) * 0.02; const { g, end } = this._env(tt, 0.002, 0.12 + (i % 2) * 0.05, 0.06); this._noise(tt, end, this._filter('lowpass', 500 + (i % 4) * 90, 0.8, g)); }
    const w = this._env(t, 0.03, 0.22, 0.35); const o = this._osc('sine', 1900, t, w.end, w.g); o.frequency.exponentialRampToValueAtTime(1350, t + 0.3);
  }
  /** Bridge: wood creaks. Avalanche: a taiko hit and the rumble layer takes over. */
  setpiece(kind) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    if (kind === 'bridge') for (let i = 0; i < 3; i++) { const { g, end } = this._env(t + i * 0.35, 0.02, 0.3, 0.35); const o = this._osc('sawtooth', 110 + i * 20, t + i * 0.35, end, this._filter('lowpass', 800, 4, g)); o.frequency.exponentialRampToValueAtTime(60, end); }
    else if (kind === 'avalanche') { this._drum('taiko', t, 1, this.sfx); this._drum('taiko', t + 0.3, 1, this.sfx); this.thunder(0.5, 0.1); }
    else if (kind === 'tsunami') { const { g, end } = this._env(t, 0.4, 0.6, 2.4, 0.6); const lp = this._filter('lowpass', 1400, 0.8, g); lp.frequency.exponentialRampToValueAtTime(180, end); this._noise(t, end, lp); this._drum('taiko', t + 0.2, 1, this.sfx); this._drum('taiko', t + 0.7, 0.8, this.sfx); }
    else if (kind === 'fire') { const { g, end } = this._env(t, 0.15, 0.45, 1.2, 0.3); const bp = this._filter('bandpass', 400, 1, g); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.8); this._noise(t, end, bp); }
  }
  /** Level crossing: the warning bell (kan-kan-kan), a two-tone horn, the train's rumble. */
  crossing() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    for (let i = 0; i < 14; i++) { const tt = t + i * 0.42; const { g, end } = this._env(tt, 0.002, 0.28, 0.24, 0, this.sfx); this._osc('sine', 1750, tt, end, g); this._osc('sine', 2350, tt, end, this._gain(0.5, g)); this._osc('triangle', 3400, tt, end, this._gain(0.15, g)); }
    const horn = this._env(t + 0.9, 0.05, 0.3, 0.2, 0.7); const lp = this._filter('lowpass', 1200, 1, horn.g); this._osc('sawtooth', 311, t + 0.9, horn.end, lp); this._osc('sawtooth', 392, t + 0.9, horn.end, lp);
    const roll = this._env(t + 0.5, 1.0, 0.45, 1.5, 2.5); this._noise(t + 0.5, roll.end, this._filter('lowpass', 260, 1, roll.g));
  }
  /** A new province: a temple bell (kane). */
  bell() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const { g, end } = this._env(t, 0.004, 0.55, 3.2); for (const [r, a] of [[1, 1], [2.01, 0.4], [2.76, 0.3], [4.1, 0.12], [5.43, 0.08]]) this._osc('sine', 196 * r, t, end, this._gain(a, g));
    const thump = this._env(t, 0.002, 0.3, 0.2); this._noise(t, thump.end, this._filter('lowpass', 300, 1, thump.g));
  }
  /** Death: a gong, and the music has already faded. */
  gong() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const { g, end } = this._env(t, 0.01, 0.8, 4.5); for (const [r, a] of [[1, 1], [1.5, 0.5], [2.37, 0.35], [3.1, 0.2], [4.7, 0.1]]) { const o = this._osc('sine', 82 * r, t, end, this._gain(a, g)); o.frequency.exponentialRampToValueAtTime(82 * r * 0.97, end); }
    const s = this._env(t, 0.002, 0.5, 0.3); this._noise(t, s.end, this._filter('lowpass', 500, 1, s.g));
  }
  /** Start of a run: a short shamisen flourish. */
  begin() { if (!this.ready) return; const t = this.ctx.currentTime; for (const [i, d] of [0, 5, 7, 12, 7, 12].entries()) this._note('shamisen', t + i * 0.09, 62 + d, 0.3, 0.9, this.sfx); }

  /** Sim events → sounds. */
  onEvent(e) {
    switch (e.type) {
      case 'coin': this.coin(e.streak, e.n); break;
      case 'nearmiss': this.nearMiss(); break;
      case 'stumble': if (!e.free) this.stumble(); break;
      case 'fall': if (!e.free) this.fall(); break;
      case 'power': this.sting(e.kind); break;
      case 'shield': this.shieldHit(); break;
      case 'smash': this.smash(); break;
      case 'bump': this.yip(); this.thud(0.5); break;
      case 'strike': if (e.by !== 'rocket') this.strike(); break;   // a rocket's strikes are one boom, not a crackle each
      case 'rocket.hit': this.boom(e.n); break;
      case 'fork': if (e.at === 'ahead') this.forkCall(false); else if (e.at === 'join') this.forkCall(true); break;
      case 'transmute': this.transmute(); break;
      case 'gust.telegraph': this.gust(true); break;
      case 'gust': this.gust(false); break;
      case 'kaiju': if (e.kaiju) this.kaiju(e.kaiju); break;
      case 'setpiece': if (e.kind) this.setpiece(e.kind); break;
      case 'crossing': this.crossing(); break;
      case 'herd': this.herd(); break;
      case 'section': this.bell(); break;
      case 'death': this.gong(); break;
    }
  }
}
