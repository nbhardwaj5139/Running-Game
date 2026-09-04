// Bootstrap: sim + renderer + input + HUD + mode select (1P with a spirit companion / 2P shared keyboard).
import { World, W } from './core/world.js';
import { normalizeSeed } from './core/rng.js';
import { CHUNK_LEN, biomeOf, seasonOf, provinceOf, DIFFICULTY, POWER_INFO } from './core/chunks.js';
import { Renderer, nightAt } from './render/renderer.js';
import { SEASON_LABEL, BIOME_LABEL } from './render/theme.js';
import { CHARACTERS, characterById, buildCharacter } from './render/characters.js';
import { GameAudio } from './audio/audio.js';
import { NetClient } from './net/client.js';
import { cleanRoom } from './core/protocol.js';
import * as THREE from 'three';

const q = new URLSearchParams(location.search);
const roomName = q.get('room') ? cleanRoom(q.get('room')) : null;          // ?room=NAME: race friends on other laptops; the room name is the road
const seedParam = roomName || q.get('seed') || new Date().toISOString().slice(0, 10);   // Seed of the Day by default
const seed = normalizeSeed(seedParam);
const reducedMotion = q.get('reduced') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const hud = { dist: $('dist'), score: $('score'), coins: $('coins'), storm: $('storm'), msg: $('msg'), body: $('msgBody'), foot: $('msgFoot'), modes: $('modes'), flash: $('flash'), vig: $('vignette'), hint: $('hint'),
  quit: $('quit'), pause: $('pause'), hit: $('hit'), secJp: $('secJp'), secEn: $('secEn'), toast: $('toast'), toastJp: $('toastJp'), toastEn: $('toastEn'), power: $('power'), pickup: $('pickup'), x2: $('x2'), runners: [$('runner0'), $('runner1')], who: [$('who0'), $('who1')], rival: $('rival') };

// modes: 1 = solo, 2 = two players on one keyboard, 3 = online race (solo sim, rivals drawn as ghosts)
let world, renderer, running = false, mode = 0, difficulty = 'normal', god = false, hitT = 0;
let net = null, countdown = 0, lastCount = -1, myReady = false;
// ---- sound: synthesised in the browser, unlocked by the first key or tap (browser rule), M mutes
const audio = new GameAudio(seed);
const muteBtn = $('mute');
function drawMute() { muteBtn.textContent = audio.muted ? '♪ off · M' : '♪ on · M'; muteBtn.classList.toggle('off', audio.muted); }
muteBtn.addEventListener('click', () => { audio.unlock(); audio.toggleMuted(); drawMute(); });
drawMute();
let acc = 0, last = performance.now(), toastT = 0, powerT = 0, pickupT = 0;
try { mode = Number(localStorage.getItem('kitsune.mode')) || 0; difficulty = localStorage.getItem('kitsune.diff') || 'normal'; } catch { mode = 0; }
if (DIFFICULTY[q.get('diff')]) difficulty = q.get('diff');
try { god = localStorage.getItem('kitsune.god') === '1'; } catch {}
if (q.get('god') === '1') god = true;
const godBox = document.getElementById('god'); godBox.checked = god;
godBox.addEventListener('change', () => { god = godBox.checked; try { localStorage.setItem('kitsune.god', god ? '1' : '0'); } catch {} if (world) world.opts.invincible = god; document.getElementById('godChip').style.display = god ? '' : 'none'; });
document.getElementById('godChip').style.display = god ? '' : 'none';
if (!DIFFICULTY[difficulty]) difficulty = 'normal';
// ---- characters: chars[0] runs the left track (companion / player 2), chars[1] the right (you / player 1)
let chars = ['tanuki', 'kitsune'];
try { const c = JSON.parse(localStorage.getItem('kitsune.chars') || 'null'); if (Array.isArray(c) && c.length === 2) chars = c; } catch {}
if (q.get('p1')) chars[1] = q.get('p1'); if (q.get('p2')) chars[0] = q.get('p2');
chars = chars.map(id => characterById(id).id);
// ---- start-screen previews: a tiny scene per slot with the chosen rig turning slowly
const previews = [0, 1].map(slot => {
  const canvas = document.getElementById('prev' + slot);
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); gl.setPixelRatio(Math.min(devicePixelRatio, 2)); gl.setSize(150, 150, false); gl.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 20); cam.position.set(0, 0.9, 2.6); cam.lookAt(0, 0.45, 0);
  scene.add(new THREE.HemisphereLight(0xfff0e0, 0x6a5a70, 1.2)); const key = new THREE.DirectionalLight(0xffd8b0, 2.2); key.position.set(1.5, 2.5, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc8ff, 1.2); rim.position.set(-2, 1.5, -2); scene.add(rim);
  return { gl, scene, cam, rig: null, id: null };
});
function setPreview(slot, id) {
  const pv = previews[slot]; if (pv.id === id) return; pv.id = id;
  if (pv.rig) pv.scene.remove(pv.rig.group);
  pv.rig = buildCharacter(id, (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6 })); pv.scene.add(pv.rig.group);
}
let previewPhase = 0;
function drawPreviews(dt) {
  previewPhase += dt;
  for (const pv of previews) { if (!pv.rig) continue; pv.rig.group.rotation.y = previewPhase * 0.9; pv.rig.legs.forEach((l, i) => { l.rotation.x = Math.sin(previewPhase * 6 + (i % 2 ? Math.PI : 0)) * 0.5; }); pv.gl.render(pv.scene, pv.cam); }
}
function renderCharacterPickers() {
  setPreview(0, chars[0]); setPreview(1, chars[1]);
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
  renderCharacterPickers(); renderer?.setCharacters(chars); if (slot === 1) net?.rejoin({ character: chars[1] });
});
function setDifficulty(d) {
  difficulty = d; try { localStorage.setItem('kitsune.diff', d); } catch {}
  for (const b of document.querySelectorAll('.dbtn')) b.classList.toggle('on', b.dataset.diff === d);
}
document.getElementById('diff').addEventListener('click', (e) => { const b = e.target.closest('.dbtn'); if (b) { setDifficulty(b.dataset.diff); if (world && !running) newWorld(); } });
setDifficulty(difficulty);

function newWorld() {
  world = new World(seed, {
    reducedMotion, difficulty, solo: mode !== 2, autopilot: [], invincible: god && mode !== 3,
    onEvent: (e) => {
      renderer?.onEvent(e); audio.onEvent(e);
      if ((e.type === 'stumble' || e.type === 'fall') && !e.free && e.cell) {
        const VERB = { arch: 'slide under it', drusen: 'jump over it', wave: 'jump the wave', gap: 'jump the gap', stalk: 'change lane', wide: 'take the free lane', roller: 'let it pass' };
        const NAME = { arch: 'a gate', drusen: 'a low block', wave: 'a shockwave', gap: 'a hole', stalk: 'a post', wide: 'a wide block', roller: 'a roller' };
        hud.hit.innerHTML = `−${e.cost ?? 0} m · hit ${NAME[e.cell.type] || e.cell.type}${e.cell.thrown ? ' (thrown)' : ''} — <b>${VERB[e.cell.type] || ''}</b>`; hud.hit.classList.add('on'); hitT = 2.2;
      }
      if (e.type === 'nearmiss') { hud.flash.style.setProperty('--fx', e.runner ? '75%' : '25%'); hud.flash.style.opacity = 1; setTimeout(() => (hud.flash.style.opacity = 0), 120); }
      if (e.type === 'power') {
        const info = POWER_INFO[e.kind] || { jp: '?', en: e.kind, blurb: '', color: [1, 1, 1] };
        const c = info.color.map((v) => Math.round(Math.min(1, v / 2.6) * 255));
        hud.pickup.style.setProperty('--pc', `rgb(${c[0] + 60},${c[1] + 60},${c[2] + 60})`);
        hud.pickup.querySelector('.glyph').textContent = info.jp; hud.pickup.querySelector('.name').textContent = info.en; hud.pickup.querySelector('.what').textContent = info.blurb;
        hud.pickup.querySelector('.who').textContent = mode === 1 ? 'YOU' : (e.runner === 1 ? 'PLAYER 1 · RIGHT ROAD' : 'PLAYER 2 · LEFT ROAD');
        hud.pickup.classList.remove('on'); void hud.pickup.offsetWidth; hud.pickup.classList.add('on'); pickupT = 2.6;
      }
      if (e.type === 'section') showSection(e.season, e.biome, true, e.province);
      if (e.type === 'weather' && running) { hud.power.textContent = `${e.weather.jp} ${e.weather.en.toUpperCase()}`; hud.power.classList.add('on'); powerT = 2; }
      if (e.type === 'setpiece' && e.kind) { hud.toastJp.textContent = e.spec.jp; hud.toastEn.textContent = e.spec.en; hud.toast.classList.add('on'); toastT = 2.6; hud.power.textContent = '⚠ ' + e.spec.en.toUpperCase(); hud.power.classList.add('on'); powerT = 2.5; }
      if (e.type === 'gust.telegraph') { hud.power.textContent = `${e.dir > 0 ? '→' : '←'} 突風 GUST ${e.dir > 0 ? '→' : '←'}`; hud.power.classList.add('on'); powerT = 0.9; }
      if (e.type === 'kaiju' && e.kaiju) { hud.toastJp.textContent = e.kaiju.jp; hud.toastEn.textContent = `KAIJU — ${e.kaiju.en}`; hud.toast.classList.add('on'); toastT = 3; hud.power.textContent = '⚠ ' + e.kaiju.en.split(',')[0].toUpperCase() + ' IS THROWING'; hud.power.classList.add('on'); powerT = 2.5; }
      if (e.type === 'death') onDeath(e);
    },
  });
  if (renderer) renderer.reset(world);
  audio.setSeed(seed);
  showSection(seasonOf(0), biomeOf(0), false, provinceOf(0));
}

function showSection(season, biome, toast, province) {
  const s = SEASON_LABEL[season], b = BIOME_LABEL[biome]; const pv = province || provinceOf(world.chunkIndex);
  hud.secJp.textContent = `${s.jp}　${pv.jp}`; hud.secEn.textContent = `${s.en} · ${pv.en} · ${b.en}`;
  if (toast) { hud.toastJp.textContent = `${pv.jp}`; hud.toastEn.textContent = `${pv.en} — ${s.en} · ${b.en}`; hud.toast.classList.add('on'); toastT = 2.8; }
}

function onDeath(e) {
  running = false;
  const why = e.reason === 'fall' ? '落ちた — The road gave way and the typhoon closed in.' : '台風 — The typhoon took the pair.';
  hud.body.innerHTML = `${why}<br><b>${Math.floor(e.distance)} m</b> · score <b>${e.score}</b> · ${world.coins} coins · ${world.powers} powers · ${DIFFICULTY[difficulty].en}`;
  if (net) { net.death(world.distance); net.runEnd(world.log, world.summary); hud.foot.textContent = 'run sent for validation · waiting for the others to finish…'; }
  else { hud.modes.style.display = 'flex'; hud.foot.textContent = 'pick a mode, or press R / tap to run again in the same mode'; }
  hud.msg.classList.remove('hidden');
}

// ---- pause / end run
let paused = false;
function pause() { if (!running || paused) return; paused = true; running = false; hud.pause.classList.remove('hidden'); }
function resume() { if (!paused) return; paused = false; running = true; hud.pause.classList.add('hidden'); last = performance.now(); acc = 0; }
document.getElementById('resume').addEventListener('click', resume);
document.getElementById('endrun').addEventListener('click', () => { resume(); abort(); });
/** End the run right now and go back to the start screen (a new run starts fresh). */
function abort() {
  if (!running) return;
  running = false; world.alive = false; countdown = 0;
  hud.body.innerHTML = `Run ended.<br><b>${Math.floor(world.distance)} m</b> · score <b>${Math.floor(world.score)}</b> · ${world.coins} coins · ${DIFFICULTY[difficulty].en}`;
  if (net) { net.death(world.distance); net.runEnd(world.log, world.summary); hud.foot.textContent = 'run sent · waiting for the others to finish…'; }
  else { hud.modes.style.display = 'flex'; hud.foot.textContent = 'pick a mode to run again · Esc ends a run at any time'; }
  hud.msg.classList.remove('hidden'); hud.quit.style.display = 'none';
}
document.getElementById('quit').addEventListener('click', pause);

function start(m) {
  if (net) return;                            // online: the server starts the race for everyone at once (see startRace)
  if (m) { mode = m; try { localStorage.setItem('kitsune.mode', String(m)); } catch {} }
  if (!mode) return;                          // the start screen waits for a mode
  if (!world || !world.alive || !!world.opts.solo !== (mode !== 2) || world.cfg.id !== difficulty) newWorld();
  hud.who[0].textContent = 'player 2 · WASD'; hud.runners[0].style.display = mode === 2 ? '' : 'none';
  hud.who[1].textContent = mode === 2 ? 'player 1 · arrows' : 'you';
  running = true; hud.msg.classList.add('hidden'); hud.quit.style.display = 'block'; last = performance.now(); acc = 0;
  audio.unlock(); audio.begin();
}
hud.modes.addEventListener('click', (e) => { const b = e.target.closest('.mode'); if (b) start(Number(b.dataset.mode)); });

// ---- online race: ?room=NAME. Every laptop runs its own sim on the room's road; rivals are drawn from 10 Hz hints.
function startRace(m) {
  mode = 3; setDifficulty(m.difficulty); newWorld(); paused = false; running = false; myReady = false; drawReady();
  hud.pause.classList.add('hidden'); hud.msg.classList.add('hidden'); hud.quit.style.display = 'block';
  hud.who[1].textContent = 'you'; hud.runners[0].style.display = 'none';
  countdown = Math.max(0.05, m.inMs / 1000); lastCount = -1; audio.unlock();
}
function drawReady() {
  const b = $('ready'); if (!b) return; b.classList.toggle('on', myReady);
  b.querySelector('b').textContent = myReady ? '✓ READY' : (net?.state === 'lobby' ? '▶ RACE' : '⏳ RACE IN PROGRESS');
  b.querySelector('small').textContent = myReady ? 'waiting for the others · click again to un-ready' : net?.state === 'lobby' ? 'everyone in the room runs the same road · starts when all are ready' : 'you can join the next one';
}
function drawRoom() {
  if (!net) return;
  const list = $('roomPlayers'); list.innerHTML = '';
  for (const p of net.players) { const s = document.createElement('span'); s.textContent = `${characterById(p.character).jp} ${p.name}${p.ready ? ' ✓' : ''}`; s.className = (p.ready ? 'ready' : '') + (p.id === net.id ? ' me' : ''); list.appendChild(s); }
  $('roomStatus').textContent = !net.connected ? 'offline — run `npm run dev` and open this link on both laptops' : `${net.players.length} on the road · ${DIFFICULTY[net.difficulty]?.en || 'Normal'} · ${net.state === 'lobby' ? 'waiting for everyone to hit RACE' : 'race in progress'}`;
  drawReady();
}
function setupRoom() {
  let myName = q.get('name') || ''; try { myName ||= localStorage.getItem('kitsune.name') || ''; } catch {}
  if (!myName) myName = `${characterById(chars[1]).en}-${10 + Math.floor(Math.random() * 90)}`;
  $('room').style.display = ''; $('roomName').textContent = `ROOM ${roomName}`; $('pname').value = myName; hud.modes.style.display = 'none';
  document.querySelector('#msg h1 small').textContent = '狐 · online race';
  hud.body.innerHTML = `Everyone who opens this link runs the same road. Hit <b>RACE</b> when you are ready; the run starts for all of you on the same count.<br>Rivals run beside you as ghosts. Every run is checked by replaying it on the server.`;
  const results = new Map();
  net = new NetClient({ room: roomName, name: myName, character: chars[1], on: {
    status: drawRoom,
    welcome: drawRoom,
    players: () => { const me = net.me; if (me && myReady !== !!me.ready) { myReady = !!me.ready; } drawRoom(); },
    start: (m) => { results.clear(); startRace(m); },
    result: (r) => { results.set(r.id, r); if (r.id !== net.id) { hud.power.textContent = `${r.name.toUpperCase()} — ${r.distance} m${r.valid ? '' : ' · INVALID'}`; hud.power.classList.add('on'); powerT = 2.5; } },
    standings: (m) => {
      const rows = m.standings.map((r, i) => `<tr class="${r.id === net.id ? 'me' : ''}"><td>${i + 1}</td><td>${characterById(r.character).jp} ${r.name}</td><td><b>${r.distance} m</b></td><td>${r.score} pts</td><td class="${r.valid ? '' : 'bad'}">${r.valid ? '✓ replay matched' : '✗ ' + r.reason}</td></tr>`).join('');
      hud.body.innerHTML = `<b>${m.standings[0]?.id === net.id ? 'You won the road.' : (m.standings[0]?.name || '') + ' won the road.'}</b><table class="standings">${rows}</table>`;
      hud.foot.textContent = 'hit RACE for another run on the same road'; hud.msg.classList.remove('hidden'); running = false; countdown = 0; myReady = false; drawRoom();
    },
  } });
  net.connect().catch((e) => { $('roomStatus').textContent = e.message; });
  $('pname').addEventListener('change', () => { const n = $('pname').value.trim(); if (!n) return; try { localStorage.setItem('kitsune.name', n); } catch {} net.rejoin({ name: n }); });
  $('ready').addEventListener('click', toggleReady);
}
function toggleReady() {
  if (!net || !net.connected || net.state !== 'lobby') return;
  myReady = !myReady; net.ready(myReady, difficulty); drawReady(); audio.unlock();
}

// ---- input --------------------------------------------------------------
// 1P: arrows and WASD both drive the fox (track 1). 2P: WASD = tanuki (track 0), arrows/space = fox (track 1).
const KEYS = {
  ArrowLeft: [1, 'lane', -1], ArrowRight: [1, 'lane', 1], ArrowUp: [1, 'jump'], Space: [1, 'jump'], ArrowDown: [1, 'slide'],
  KeyA: [0, 'lane', -1], KeyD: [0, 'lane', 1], KeyW: [0, 'jump'], KeyS: [0, 'slide'],
};
function press(track, kind, dir) {
  if (!running) { start(); return; }
  const t = mode === 2 ? track : 1;
  world.input(t, dir === undefined ? { kind } : { kind, dir });
  if (kind !== 'lane' || world.runners[t].laneT >= 1) audio.action(kind);
}
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  audio.unlock();
  if (e.code === 'KeyM') { audio.toggleMuted(); drawMute(); return; }
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.code === 'Digit1' || e.code === 'Digit2') { if (!running && !net) { start(e.code === 'Digit1' ? 1 : 2); } return; }
  if (e.code === 'Escape' || e.code === 'KeyP') { if (paused) resume(); else if (running) pause(); return; }
  if (paused) { if (e.code === 'Enter') resume(); return; }
  if (e.code === 'KeyR') { if (net) { if (!running && countdown <= 0) toggleReady(); } else if (mode) { newWorld(); start(); } return; }
  const k = KEYS[e.code]; if (k) { e.preventDefault(); press(k[0], k[1], k[2]); } else if (!running && mode && !net) start();
});
addEventListener('keyup', (e) => {
  if (!world) return;
  if (['ArrowUp', 'Space'].includes(e.code)) world.input(1, { kind: 'jumpRelease' });
  if (e.code === 'KeyW') world.input(mode === 2 ? 0 : 1, { kind: 'jumpRelease' });
});
let touch = null;
addEventListener('pointerdown', (e) => { audio.unlock(); if (e.target.closest('.mode, #quit, #mute, .dbtn, .cbtn, #room')) return; touch = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', (e) => {
  if (!touch) return; const dx = e.clientX - touch.x, dy = e.clientY - touch.y; const track = mode === 2 && touch.x < innerWidth / 2 ? 0 : 1; touch = null;
  if (!running) { if (mode && !net) start(); return; }
  if (Math.hypot(dx, dy) < 24) press(track, 'jump');
  else if (Math.abs(dx) > Math.abs(dy)) press(track, 'lane', dx > 0 ? 1 : -1); else if (dy < 0) press(track, 'jump'); else press(track, 'slide');
  setTimeout(() => world?.input(track, { kind: 'jumpRelease' }), 160);
});

// ---- loop ---------------------------------------------------------------
function frame(now) { requestAnimationFrame(frame); tick(now); }
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (countdown > 0) {                                                       // online: everyone starts on the server's count
    countdown -= dt; const n = Math.max(0, Math.ceil(countdown));
    if (n !== lastCount) { lastCount = n; hud.toastJp.textContent = n > 0 ? String(n) : '走れ'; hud.toastEn.textContent = n > 0 ? 'READY' : 'GO'; hud.toast.classList.add('on'); toastT = 1.1; audio.coin(n > 0 ? 2 : 6); }
    if (countdown <= 0) { running = true; last = now; acc = 0; audio.begin(); }
  }
  if (running) { acc += dt; while (acc >= W.TICK) { world.step(); acc -= W.TICK; } }
  renderer.render(dt);
  if (!running && !paused) drawPreviews(dt);
  if (net) {
    const nowS = now / 1000; if (running) net.hint(now, world);
    let near = null;
    for (const g of net.rivals) {
      const p = net.playerById(g.id); if (!p) continue;
      renderer.setGhost(g.id, p.character, p.name); const z = net.ghostZ(g, nowS);
      renderer.drawGhost(g.id, { x: g.x, y: g.y, z, action: g.action, alive: g.alive }, dt);
      if (!near || Math.abs(z - world.distance) < Math.abs(near.z - world.distance)) near = { z, p, g };
    }
    for (const id of [...(renderer.ghosts?.keys() || [])]) if (!net.ghosts.has(id)) renderer.removeGhost(id);
    if (near && (running || countdown > 0)) { const d = Math.round(near.z - world.distance); hud.rival.innerHTML = `vs <b>${near.p.name}</b> ${d >= 0 ? '+' : '−'}${Math.abs(d)} m <i>${near.g.score ?? 0} pts${near.g.alive === false ? ' · out' : ''}</i>`; hud.rival.classList.add('on'); }
    else hud.rival.classList.remove('on');
  }
  {
    const idx = world.chunkIndex, live = world.runners.filter(r => !r.disabled);
    audio.update(dt, { themeId: provinceOf(idx).id, season: seasonOf(idx), biome: biomeOf(idx), speed: world.speed, night: nightAt(world.distance), dread: 1 - Math.max(0, world.storm) / W.STORM_MAX,
      weather: world.weather, kaiju: !!world.kaiju, setpiece: world.setpiece, running: running && !paused, alive: world.alive, jetpack: live.some(r => r.jetpackT > 0), dash: live.some(r => r.dashT > 0), dawn: world.dawnT > 0, thunder: renderer.thunderT || 0 });
  }

  hud.dist.textContent = Math.floor(world.distance) + ' m';
  hud.score.textContent = Math.floor(world.score);
  hud.coins.textContent = world.coins;
  hud.storm.querySelector('i').style.width = Math.max(0, 100 - (world.storm / W.STORM_MAX) * 100) + '%';
  const dread = 1 - Math.max(0, world.storm) / W.STORM_MAX;
  hud.vig.style.boxShadow = `inset 0 0 ${40 + dread * 220}px ${dread * 60}px rgba(5,0,2,${0.15 + dread * 0.7})`;
  hud.x2.classList.toggle('on', world.x2T > 0 || world.dawnT > 0);
  hud.x2.textContent = world.dawnT > 0 ? '天照 DAWN' : '×2 DARUMA';
  for (const r of world.runners) {
    const el = hud.runners[r.track];
    el.querySelector('.shield').classList.toggle('on', r.shield);
    el.querySelector('.magnet').classList.toggle('on', r.magnetT > 0);
    el.querySelector('.dash').classList.toggle('on', r.dashT > 0);
    el.querySelector('.jetpack').classList.toggle('on', r.jetpackT > 0);
    el.querySelector('.foxfire').classList.toggle('on', r.foxfireT > 0);
    el.querySelector('.guide').classList.toggle('on', r.guideT > 0);
  }
  if (toastT > 0 && (toastT -= dt) <= 0) hud.toast.classList.remove('on');
  if (powerT > 0 && (powerT -= dt) <= 0) hud.power.classList.remove('on');
  if (pickupT > 0 && (pickupT -= dt) <= 0) hud.pickup.classList.remove('on');
  if (hitT > 0 && (hitT -= dt) <= 0) hud.hit.classList.remove('on');
}

newWorld();
renderer = new Renderer(document.body, world, { reducedMotion, bloom: q.get('bloom') !== '0', characters: chars });
renderCharacterPickers();
hud.hint.textContent = roomName ? `room ${roomName} — the room name is the road` : `seed ${seedParam} · Seed of the Day — same road for everyone today`;
requestAnimationFrame(() => hud.hint.textContent += ` · ${DIFFICULTY[difficulty].en}`);
if (roomName) setupRoom();
else if (q.get('mode')) start(Number(q.get('mode')));
requestAnimationFrame(frame);

// expose for debugging / headless smoke tests
globalThis.__kitsune = { get world() { return world; }, renderer, audio, get net() { return net; }, start, press, toggleReady, tick, get running() { return running; }, get mode() { return mode; }, get countdown() { return countdown; } };
globalThis.__vitreous = globalThis.__kitsune;
