// Bootstrap: sim + renderer + input + HUD + mode select (1P with a spirit companion / 2P shared keyboard).
import { World, W } from './core/world.js';
import { normalizeSeed } from './core/rng.js';
import { CHUNK_LEN, biomeOf, seasonOf, DIFFICULTY } from './core/chunks.js';
import { Renderer, nightAt } from './render/renderer.js';
import { SEASON_LABEL, BIOME_LABEL } from './render/theme.js';
import { CHARACTERS, characterById } from './render/characters.js';

const q = new URLSearchParams(location.search);
const seedParam = q.get('seed') || new Date().toISOString().slice(0, 10);   // Seed of the Day by default
const seed = normalizeSeed(seedParam);
const reducedMotion = q.get('reduced') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const hud = { dist: $('dist'), score: $('score'), coins: $('coins'), storm: $('storm'), msg: $('msg'), body: $('msgBody'), foot: $('msgFoot'), modes: $('modes'), flash: $('flash'), vig: $('vignette'), hint: $('hint'),
  secJp: $('secJp'), secEn: $('secEn'), toast: $('toast'), toastJp: $('toastJp'), toastEn: $('toastEn'), power: $('power'), x2: $('x2'), runners: [$('runner0'), $('runner1')], who: [$('who0'), $('who1')] };
const POWER_NAMES = { shield: '御守 KITSUNE SHIELD', magnet: '狸の磁力 TANUKI MAGNET', dash: '風神 WIND KAMI DASH', x2: '達磨 DARUMA ×2', heal: '桜 SAKURA HEAL' };

let world, renderer, running = false, mode = 0, difficulty = 'normal';
let acc = 0, last = performance.now(), toastT = 0, powerT = 0;
try { mode = Number(localStorage.getItem('kitsune.mode')) || 0; difficulty = localStorage.getItem('kitsune.diff') || 'normal'; } catch { mode = 0; }
if (DIFFICULTY[q.get('diff')]) difficulty = q.get('diff');
if (!DIFFICULTY[difficulty]) difficulty = 'normal';
// ---- characters: chars[0] runs the left track (companion / player 2), chars[1] the right (you / player 1)
let chars = ['tanuki', 'kitsune'];
try { const c = JSON.parse(localStorage.getItem('kitsune.chars') || 'null'); if (Array.isArray(c) && c.length === 2) chars = c; } catch {}
if (q.get('p1')) chars[1] = q.get('p1'); if (q.get('p2')) chars[0] = q.get('p2');
chars = chars.map(id => characterById(id).id);
function renderCharacterPickers() {
  for (const slot of [0, 1]) {
    const row = document.getElementById('chars' + slot); row.innerHTML = '';
    for (const c of CHARACTERS) {
      const b = document.createElement('button'); b.className = 'cbtn' + (chars[slot] === c.id ? ' on' : ''); b.dataset.id = c.id; b.title = c.blurb;
      b.innerHTML = `<b>${c.jp}</b><span>${c.en}</span>`; row.appendChild(b);
    }
  }
  hud.who[0].parentElement.firstChild.textContent = `${characterById(chars[0]).jp} ${characterById(chars[0]).en.toUpperCase()} `;
  hud.who[1].parentElement.firstChild.textContent = `${characterById(chars[1]).jp} ${characterById(chars[1]).en.toUpperCase()} `;
}
for (const slot of [0, 1]) document.getElementById('chars' + slot).addEventListener('click', (e) => {
  const b = e.target.closest('.cbtn'); if (!b) return;
  chars[slot] = b.dataset.id; try { localStorage.setItem('kitsune.chars', JSON.stringify(chars)); } catch {}
  renderCharacterPickers(); renderer?.setCharacters(chars);
});
function setDifficulty(d) {
  difficulty = d; try { localStorage.setItem('kitsune.diff', d); } catch {}
  for (const b of document.querySelectorAll('.dbtn')) b.classList.toggle('on', b.dataset.diff === d);
}
document.getElementById('diff').addEventListener('click', (e) => { const b = e.target.closest('.dbtn'); if (b) { setDifficulty(b.dataset.diff); if (world && !running) newWorld(); } });
setDifficulty(difficulty);

function newWorld() {
  world = new World(seed, {
    reducedMotion, difficulty, autopilot: mode === 1 ? [0] : [],
    onEvent: (e) => {
      renderer?.onEvent(e);
      if (e.type === 'nearmiss') { hud.flash.style.setProperty('--fx', e.runner ? '75%' : '25%'); hud.flash.style.opacity = 1; setTimeout(() => (hud.flash.style.opacity = 0), 120); }
      if (e.type === 'power') { hud.power.textContent = POWER_NAMES[e.kind] || e.kind; hud.power.classList.add('on'); powerT = 1.4; }
      if (e.type === 'section') showSection(e.season, e.biome, true);
      if (e.type === 'kaiju' && e.kaiju) { hud.toastJp.textContent = e.kaiju.jp; hud.toastEn.textContent = `KAIJU — ${e.kaiju.en}`; hud.toast.classList.add('on'); toastT = 3; hud.power.textContent = '⚠ ' + e.kaiju.en.split(',')[0].toUpperCase() + ' IS THROWING'; hud.power.classList.add('on'); powerT = 2.5; }
      if (e.type === 'death') onDeath(e);
    },
  });
  if (renderer) renderer.reset(world);
  showSection(seasonOf(0), biomeOf(0), false);
}

function showSection(season, biome, toast) {
  const s = SEASON_LABEL[season], b = BIOME_LABEL[biome];
  hud.secJp.textContent = s.jp; hud.secEn.textContent = `${s.en} · ${b.en}`;
  if (toast) { hud.toastJp.textContent = `${s.jp}　${b.jp}`; hud.toastEn.textContent = `${s.en} — ${b.en}`; hud.toast.classList.add('on'); toastT = 2.6; }
}

function onDeath(e) {
  running = false;
  const why = e.reason === 'fall' ? '落ちた — The road gave way and the typhoon closed in.' : '台風 — The typhoon took the pair.';
  hud.body.innerHTML = `${why}<br><b>${Math.floor(e.distance)} m</b> · score <b>${e.score}</b> · ${world.coins} coins · ${world.powers} powers · ${DIFFICULTY[difficulty].en}`;
  hud.modes.style.display = 'flex';
  hud.foot.textContent = 'pick a mode, or press R / tap to run again in the same mode';
  hud.msg.classList.remove('hidden');
}

function start(m) {
  if (m) { mode = m; try { localStorage.setItem('kitsune.mode', String(m)); } catch {} }
  if (!mode) return;                          // the start screen waits for a mode
  if (!world || !world.alive || world.opts.autopilot.length !== (mode === 1 ? 1 : 0) || world.cfg.id !== difficulty) newWorld();
  hud.who[0].textContent = mode === 1 ? 'spirit companion' : 'player 2 · WASD';
  hud.who[1].textContent = mode === 1 ? 'you' : 'player 1 · arrows';
  running = true; hud.msg.classList.add('hidden'); last = performance.now(); acc = 0;
}
hud.modes.addEventListener('click', (e) => { const b = e.target.closest('.mode'); if (b) start(Number(b.dataset.mode)); });

// ---- input --------------------------------------------------------------
// 1P: arrows and WASD both drive the fox (track 1). 2P: WASD = tanuki (track 0), arrows/space = fox (track 1).
const KEYS = {
  ArrowLeft: [1, 'lane', -1], ArrowRight: [1, 'lane', 1], ArrowUp: [1, 'jump'], Space: [1, 'jump'], ArrowDown: [1, 'slide'],
  KeyA: [0, 'lane', -1], KeyD: [0, 'lane', 1], KeyW: [0, 'jump'], KeyS: [0, 'slide'],
};
function press(track, kind, dir) {
  if (!running) { start(); return; }
  const t = mode === 1 ? 1 : track;
  world.input(t, dir === undefined ? { kind } : { kind, dir });
}
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Digit1' || e.code === 'Digit2') { if (!running) { start(e.code === 'Digit1' ? 1 : 2); } return; }
  if (e.code === 'KeyR') { if (mode) { newWorld(); start(); } return; }
  const k = KEYS[e.code]; if (k) { e.preventDefault(); press(k[0], k[1], k[2]); } else if (!running && mode) start();
});
addEventListener('keyup', (e) => {
  if (!world) return;
  if (['ArrowUp', 'Space'].includes(e.code)) world.input(1, { kind: 'jumpRelease' });
  if (e.code === 'KeyW') world.input(mode === 1 ? 1 : 0, { kind: 'jumpRelease' });
});
let touch = null;
addEventListener('pointerdown', (e) => { if (e.target.closest('.mode')) return; touch = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', (e) => {
  if (!touch) return; const dx = e.clientX - touch.x, dy = e.clientY - touch.y; const track = mode === 2 && touch.x < innerWidth / 2 ? 0 : 1; touch = null;
  if (!running) { if (mode) start(); return; }
  if (Math.hypot(dx, dy) < 24) press(track, 'jump');
  else if (Math.abs(dx) > Math.abs(dy)) press(track, 'lane', dx > 0 ? 1 : -1); else if (dy < 0) press(track, 'jump'); else press(track, 'slide');
  setTimeout(() => world?.input(track, { kind: 'jumpRelease' }), 160);
});

// ---- loop ---------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (running) { acc += dt; while (acc >= W.TICK) { world.step(); acc -= W.TICK; } }
  renderer.render(dt);

  hud.dist.textContent = Math.floor(world.distance) + ' m';
  hud.score.textContent = Math.floor(world.score);
  hud.coins.textContent = world.coins;
  hud.storm.querySelector('i').style.width = Math.max(0, 100 - (world.storm / W.STORM_MAX) * 100) + '%';
  const dread = 1 - Math.max(0, world.storm) / W.STORM_MAX;
  hud.vig.style.boxShadow = `inset 0 0 ${40 + dread * 220}px ${dread * 60}px rgba(5,0,2,${0.15 + dread * 0.7})`;
  hud.x2.classList.toggle('on', world.x2T > 0);
  for (const r of world.runners) {
    const el = hud.runners[r.track];
    el.querySelector('.shield').classList.toggle('on', r.shield);
    el.querySelector('.magnet').classList.toggle('on', r.magnetT > 0);
    el.querySelector('.dash').classList.toggle('on', r.dashT > 0);
  }
  if (toastT > 0 && (toastT -= dt) <= 0) hud.toast.classList.remove('on');
  if (powerT > 0 && (powerT -= dt) <= 0) hud.power.classList.remove('on');
}

newWorld();
renderer = new Renderer(document.body, world, { reducedMotion, bloom: q.get('bloom') !== '0', characters: chars });
renderCharacterPickers();
hud.hint.textContent = `seed ${seedParam} · Seed of the Day — same road for everyone today`;
requestAnimationFrame(() => hud.hint.textContent += ` · ${DIFFICULTY[difficulty].en}`);
if (q.get('mode')) start(Number(q.get('mode')));
requestAnimationFrame(frame);

// expose for debugging / headless smoke tests
globalThis.__kitsune = { get world() { return world; }, renderer, start, press, get running() { return running; }, get mode() { return mode; } };
globalThis.__vitreous = globalThis.__kitsune;
