// Ground that reacts to the runners: a carpet of leaves/petals on the road that
// scatters when a runner ploughs through it, and step sprays (snow puffs, rain
// splashes, sand and dust) at the feet. Track-space physics; mapped at draw time.
import * as THREE from 'three';
import { InstancePool, compose, radial, canvasTexture, TRACK } from './common.js';
import { CHUNK_LEN, ROAD_HALF } from '../core/chunks.js';

const leafTex = () => canvasTexture(32, 32, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(16, 2); g.lineTo(26, 12); g.lineTo(30, 24); g.lineTo(18, 20); g.lineTo(16, 30); g.lineTo(14, 20); g.lineTo(2, 24); g.lineTo(6, 12); g.closePath(); g.fill(); });
const petalTex = () => canvasTexture(32, 32, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(16, 16, 13, 8, 0.5, 0, Math.PI * 2); g.fill(); });

/** Leaves (autumn) or petals (spring) lying on the road; each is a tiny quad with rest/flight state. */
export function makeLitter(parent) {
  const geo = new THREE.PlaneGeometry(0.36, 0.36); geo.rotateX(-Math.PI / 2);
  const mats = { leaf: new THREE.MeshLambertMaterial({ map: leafTex(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }), petal: new THREE.MeshLambertMaterial({ map: petalTex(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }) };
  const pools = { leaf: new InstancePool(parent, geo, mats.leaf, 2600), petal: new InstancePool(parent, geo, mats.petal, 2600) };
  const items = []; const byChunk = new Map(); const col = new THREE.Color();
  const LEAF = [[0.95, 0.2, 0.08], [1, 0.52, 0.1], [0.98, 0.82, 0.22], [0.75, 0.15, 0.1]], PETAL = [[1, 0.8, 0.88], [1, 0.68, 0.8], [1, 0.9, 0.94]];
  return {
    fill(chunk, rng, season) {
      const kind = season === 2 ? 'leaf' : season === 0 ? 'petal' : null; if (!kind) return;
      const pool = pools[kind], pal = kind === 'leaf' ? LEAF : PETAL; const list = [];
      const n = kind === 'leaf' ? 130 : 100;   // enough to kick up and notice; not a carpet over the road
      for (let i = 0; i < n; i++) {
        const onRoad = rng() < 0.75; const x = onRoad ? (rng() * 2 - 1) * ROAD_HALF : (rng() < 0.5 ? -1 : 1) * (ROAD_HALF + rng() * 6);
        const it = { x, s: chunk.z0 + rng() * CHUNK_LEN, y: 0.02, vx: 0, vy: 0, vs: 0, rot: rng() * 6.28, spin: 0, air: false, sc: 0.7 + rng() * 0.6, pool, i: -1 };
        const c = pal[Math.floor(rng() * pal.length)]; col.setRGB(c[0] * (0.85 + rng() * 0.3), c[1] * (0.85 + rng() * 0.3), c[2]);
        it.i = pool.take(compose(it.x, it.y, it.s, it.sc, it.sc, it.sc, it.rot), col);
        if (it.i >= 0) { list.push(it); items.push(it); }
      }
      pool.flush(); byChunk.set(chunk.index, list);
    },
    release(index) { const l = byChunk.get(index); if (!l) return; for (const it of l) { it.pool.give(it.i); const k = items.indexOf(it); if (k >= 0) items.splice(k, 1); } byChunk.delete(index); for (const p of Object.values(pools)) p.flush(); },
    update(dt, runners, wind, speed) {
      let dirty = false;
      const s0 = runners.length ? runners[0].s : 0;
      for (const it of items) {
        if (!it.air) {
          if (Math.abs(it.s - s0) > 6) continue;                 // far items cannot be touched this frame
          for (const r of runners) {
            if (r.y > 0.4 || Math.abs(r.s - it.s) > 1.1 || Math.abs(r.x - it.x) > 1.0) continue;
            const side = Math.sign(it.x - r.x) || (Math.random() < 0.5 ? -1 : 1);
            it.air = true; it.vy = 1.6 + Math.random() * 2.2; it.vx = side * (1.5 + Math.random() * 2.5); it.vs = 3 + Math.random() * 5 + speed * 0.15; it.spin = (Math.random() - 0.5) * 14; break;
          }
          if (!it.air) continue;
        }
        it.vy -= 7 * dt; it.vx += wind.x * 0.8 * dt; it.vs += wind.z * 0.5 * dt;
        it.vx *= 1 - 1.2 * dt; it.vs *= 1 - 1.2 * dt;
        it.x += it.vx * dt; it.s += it.vs * dt; it.y += it.vy * dt; it.rot += it.spin * dt;
        if (it.y <= 0.02) { it.y = 0.02; it.air = false; it.vx = it.vy = it.vs = 0; it.spin = 0; }
        it.pool.set(it.i, compose(it.x, it.y, it.s, it.sc, it.sc, it.sc, it.rot)); dirty = true;
      }
      if (dirty) for (const p of Object.values(pools)) p.flush();
    },
  };
}

/** Step sprays: snow puffs, rain splashes, sand and dust at the runners' feet. World-space points. */
export function makeSpray(parent) {
  const n = 500; const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = new Float32Array(n * 3), age = new Float32Array(n).fill(9), life = new Float32Array(n).fill(1);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ map: radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), size: 0.3, vertexColors: true, transparent: true, depthWrite: false });
  const obj = new THREE.Points(geo, mat); obj.frustumCulled = false; parent.add(obj);
  let head = 0; const P = new THREE.Vector3(), acc = [0, 0];
  const KINDS = { snow: { c: [1, 1, 1], up: 2.2, out: 1.6, size: 0.28, rate: 40, g: 3 }, rain: { c: [0.75, 0.85, 1.0], up: 1.8, out: 2.2, size: 0.16, rate: 50, g: 9 }, sand: { c: [0.9, 0.82, 0.62], up: 1.2, out: 1.4, size: 0.22, rate: 26, g: 5 }, dust: { c: [0.8, 0.75, 0.65], up: 0.8, out: 0.8, size: 0.2, rate: 10, g: 2 } };
  let g = 3;
  return {
    obj,
    /** runners: [{x, s, y, moving}], kind: 'snow'|'rain'|'sand'|'dust'|null */
    update(dt, runners, kind, speed) {
      const K = KINDS[kind];
      if (K) {
        mat.size = K.size; g = K.g;
        runners.forEach((r, ri) => {
          if (!r.moving || r.y > 0.05) return;
          acc[ri] += dt * K.rate * (0.5 + speed / 30);
          while (acc[ri] >= 1) {
            acc[ri] -= 1; TRACK.map(r.x + (Math.random() - 0.5) * 0.4, 0.05, r.s - 0.2, 0, P);
            pos.set([P.x, P.y, P.z], head * 3); col.set(K.c, head * 3);
            const side = (Math.random() - 0.5) * 2;
            // velocities are in world space: up along world y is close enough for spray
            vel.set([side * K.out * (0.4 + Math.random()), K.up * (0.5 + Math.random()), (Math.random() - 0.5) * K.out], head * 3);
            age[head] = 0; life[head] = 0.35 + Math.random() * 0.5; head = (head + 1) % n;
          }
        });
      }
      for (let i = 0; i < n; i++) {
        if (age[i] > life[i]) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
        age[i] += dt; vel[i * 3 + 1] -= g * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const a = 1 - age[i] / life[i]; const base = KINDS[kind] ? KINDS[kind].c : [1, 1, 1];
        col[i * 3] = base[0] * a; col[i * 3 + 1] = base[1] * a; col[i * 3 + 2] = base[2] * a;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
}
