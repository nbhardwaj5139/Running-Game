// Bootstrap: sim + renderer + input + HUD + optional Shared Nerve room.
import { World, W } from './core/world.js';
import { normalizeSeed } from './core/rng.js';
import { Renderer } from './render/renderer.js';
import { NetClient } from './net/client.js';

const q = new URLSearchParams(location.search);
const seedParam = q.get('seed') || new Date().toISOString().slice(0, 10);   // Seed of the Day by default
const seed = normalizeSeed(seedParam);
const room = q.get('room');
const name = q.get('name') || 'floater-' + Math.floor(Math.random() * 900 + 100);
const reducedMotion = q.get('reduced') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const hud = { dist: $('dist'), score: $('score'), photons: $('photons'), nerve: $('nerve'), blink: $('blink'), msg: $('msg'), body: $('msgBody'), foot: $('msgFoot'), room: $('room'), tele: $('tele'), flash: $('flash'), vig: $('vignette'), hint: $('hint') };

let world, renderer, net = null, running = false, sharedNerve = 0, players = [];
let acc = 0, last = performance.now();

function newWorld() {
  world = new World(seed, {
    solo: !room, sharedNerve: !!room, reducedMotion,
    onEvent: (e) => {
      renderer?.onEvent(e);
      if (e.type === 'nerve.charge') net?.charge(e.amount, e.reason);
      if (e.type === 'nearmiss') { hud.flash.style.setProperty('--fx', e.side > 0 ? '92%' : '8%'); hud.flash.style.opacity = 1; setTimeout(() => (hud.flash.style.opacity = 0), 120); }
      if (e.type === 'saccade.telegraph') { hud.tele.className = (e.dir > 0 ? 'right' : 'left') + ' on'; }
      if (e.type === 'saccade') { hud.tele.className = ''; }
      if (e.type === 'death') onDeath(e);
    },
  });
  net?.attach(world);
  if (renderer) renderer.reset(world);
}

function onDeath(e) {
  running = false;
  const why = e.reason === 'fall' ? '落ちた — You fell through the road.' : '台風 — The typhoon took you.';
  hud.body.innerHTML = `${why}<br><b>${Math.floor(e.distance)} m</b> · score <b>${e.score}</b> · ${world.photons} coins · ${world.saccades} tremors survived`;
  hud.foot.textContent = 'press R / tap to run again';
  hud.msg.classList.remove('hidden');
  net?.death(e.distance); net?.runEnd(world.log, world.summary);
}

function start() {
  if (!world.player.alive) newWorld();
  running = true; hud.msg.classList.add('hidden'); last = performance.now(); acc = 0;
}

// ---- input --------------------------------------------------------------
function press(kind, dir) {
  if (!running) { if (kind !== 'nerve') start(); return; }
  if (kind === 'nerve') {
    if (room) { net?.requestSaccade(dir); return; }
    if (!world.spendNerve(dir)) hud.nerve.animate([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], 120);
    return;
  }
  world.input(dir === undefined ? { kind } : { kind, dir });
}
const KEYS = { ArrowLeft: ['lane', -1], KeyA: ['lane', -1], ArrowRight: ['lane', 1], KeyD: ['lane', 1], ArrowUp: ['jump'], KeyW: ['jump'], Space: ['jump'], ArrowDown: ['slide'], KeyS: ['slide'], KeyQ: ['nerve', -1], KeyE: ['nerve', 1] };
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyR') { newWorld(); start(); return; }
  const k = KEYS[e.code]; if (k) { e.preventDefault(); press(k[0], k[1]); } else if (!running) start();
});
addEventListener('keyup', (e) => { if (['ArrowUp', 'KeyW', 'Space'].includes(e.code)) world?.input({ kind: 'jumpRelease' }); });
let touch = null;
addEventListener('pointerdown', (e) => { touch = { x: e.clientX, y: e.clientY, t: performance.now() }; });
addEventListener('pointerup', (e) => {
  if (!touch) return; const dx = e.clientX - touch.x, dy = e.clientY - touch.y; touch = null;
  if (Math.hypot(dx, dy) < 24) { if (!running) start(); else if (e.clientY < innerHeight * 0.25) press('nerve', e.clientX < innerWidth / 2 ? -1 : 1); else press('jump'); return; }
  if (Math.abs(dx) > Math.abs(dy)) press('lane', dx > 0 ? 1 : -1); else if (dy < 0) press('jump'); else press('slide');
  setTimeout(() => world?.input({ kind: 'jumpRelease' }), 160);
});

// ---- multiplayer --------------------------------------------------------
async function joinRoom() {
  net = new NetClient({
    room, name,
    onWelcome: (m) => { sharedNerve = m.nerve; players = m.players; hud.hint.textContent = `room ${room} · seed ${m.seed} · you are ${name}`; },
    onPlayers: (m) => { players = m.players; },
    onHint: (m) => renderer.rivalHint(m.id, m),
    onLeave: (m) => renderer.rivalLeave(m.id),
    onNerve: (v) => { sharedNerve = v; },
    onSaccade: (dir, atTick, by) => { const mine = by === net.id; world.scheduleSaccade(dir, Math.max(atTick, world.tick + (mine ? 24 : 8)), mine ? 'me' : 'rival'); if (mine) world.player.channelT = 2; },
    onDenied: () => hud.nerve.animate([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], 120),
    onSurge: (m) => { if (m.target === net.id) world.surgeBlink(m.meters); },
    onStatus: (s) => { hud.room.innerHTML = `<span class="p">${s}</span>`; },
  });
  net.attach(world);
  try { await net.connect(); } catch (err) { hud.room.textContent = err.message; }
}

// ---- loop ---------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (running) {
    acc += dt;
    while (acc >= W.TICK) { world.step(); acc -= W.TICK; }
  }
  net?.update(now);
  renderer.render(dt, acc / W.TICK);

  const p = world.player;
  hud.dist.textContent = Math.floor(p.distance) + ' m';
  hud.score.textContent = Math.floor(world.score);
  hud.photons.textContent = world.photons;
  const nerve = room ? sharedNerve : world.nerve;
  hud.nerve.querySelector('i').style.width = nerve + '%';
  hud.nerve.classList.toggle('ready', nerve >= W.NERVE_COST);
  hud.blink.querySelector('i').style.width = Math.max(0, 100 - (world.blink / W.BLINK_MAX) * 100) + '%';
  const dread = 1 - Math.max(0, world.blink) / W.BLINK_MAX;
  hud.vig.style.boxShadow = `inset 0 0 ${40 + dread * 220}px ${dread * 60}px rgba(5,0,2,${0.15 + dread * 0.7})`;
  if (room) hud.room.innerHTML = `<span class="p">${players.length} on the road</span> · ${net?.connected ? Math.round(net.rtt) + ' ms' : 'offline'}`;
}

newWorld();
renderer = new Renderer(document.body, world, { reducedMotion, bloom: q.get('bloom') !== '0' });
hud.hint.textContent = `seed ${seedParam}` + (room ? '' : ' · add ?room=NAME to run this road together');
if (room) joinRoom();
requestAnimationFrame(frame);

// expose for debugging / headless smoke tests
globalThis.__vitreous = { get world() { return world; }, get net() { return net; }, renderer, start, press, get running() { return running; } };
