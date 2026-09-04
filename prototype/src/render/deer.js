// Nara deer: low-poly sika deer that graze in the verges, trot along the road
// (in one direction: when they reach the end of their stretch they stop and graze,
// they never turn on the spot), and bow as a runner passes. Track-space kinematics;
// placed through the mapper.
import * as THREE from 'three';
import { placeMesh, paint, merge } from './common.js';
import { CHUNK_LEN } from '../core/chunks.js';

function deerRig() {
  const g = new THREE.Group(); const HPI = Math.PI / 2;
  const fur = '#a9784a', cream = '#f1e3c8', dark = '#3a2a1c';
  const P = (geo, c, p, r = [0, 0, 0]) => paint(geo, c, { p, r });
  const mesh = (parts, parent) => { const m = new THREE.Mesh(merge(parts), DEER_MAT); parent.add(m); return m; };
  const body = [P(new THREE.CapsuleGeometry(0.22, 0.6, 4, 10), fur, [0, 0.72, 0], [HPI, 0, 0]), P(new THREE.CapsuleGeometry(0.15, 0.5, 4, 8), cream, [0, 0.62, 0.02], [HPI, 0, 0]), P(new THREE.SphereGeometry(0.06, 6, 5), cream, [0, 0.8, -0.52])];
  for (let i = 0; i < 12; i++) body.push(P(new THREE.SphereGeometry(0.035, 5, 4), cream, [(i % 2 ? 0.14 : -0.14) + (Math.sin(i * 1.7) * 0.06), 0.9, -0.3 + (i >> 1) * 0.11]));   // spots
  mesh(body, g);
  const neck = new THREE.Group(); neck.position.set(0, 0.85, 0.32); g.add(neck);
  mesh([P(new THREE.CylinderGeometry(0.09, 0.12, 0.42, 8), fur, [0, 0.18, 0.08], [-0.5, 0, 0])], neck);
  const head = new THREE.Group(); head.position.set(0, 0.4, 0.2); neck.add(head);
  const hp = [P(new THREE.SphereGeometry(0.13, 10, 8), fur, [0, 0, 0]), P(new THREE.ConeGeometry(0.07, 0.2, 8), fur, [0, -0.03, 0.17], [HPI, 0, 0]), P(new THREE.SphereGeometry(0.03, 6, 6), dark, [0, -0.02, 0.27])];
  for (const s of [-1, 1]) hp.push(P(new THREE.ConeGeometry(0.04, 0.14, 5), fur, [s * 0.1, 0.11, -0.02], [0, 0, -s * 0.5]), P(new THREE.CylinderGeometry(0.012, 0.02, 0.24, 5), dark, [s * 0.06, 0.24, -0.02], [0.2, 0, -s * 0.35]), P(new THREE.CylinderGeometry(0.01, 0.015, 0.12, 5), dark, [s * 0.11, 0.3, -0.03], [0.2, 0, -s * 1.1]));
  mesh(hp, head);
  const legs = [];
  for (const [x, z] of [[-0.12, 0.28], [0.12, 0.28], [-0.12, -0.26], [0.12, -0.26]]) { const p = new THREE.Group(); p.position.set(x, 0.55, z); g.add(p); mesh([P(new THREE.CylinderGeometry(0.04, 0.03, 0.55, 6), fur, [0, -0.27, 0])], p); legs.push(p); }
  return { group: g, neck, legs };
}
const DEER_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

export function makeDeer(parent) {
  const pool = []; const live = new Map(); let t = 0;
  const take = () => { let d = pool.find(d => !d.used); if (!d) { d = { rig: deerRig(), used: false }; parent.add(d.rig.group); pool.push(d); } d.used = true; d.rig.group.visible = true; return d; };
  return {
    fill(chunk, rng, count = 5) {
      const list = [];
      for (let i = 0; i < count; i++) {
        const d = take(); const side = rng() < 0.5 ? -1 : 1; const run = rng() < 0.4;
        d.st = { x: side * (8 + rng() * 9), s: chunk.z0 + rng() * CHUNK_LEN, s0: chunk.z0, run, speed: run ? 4 + rng() * 4 : 0, dir: rng() < 0.5 ? -1 : 1, bow: 0, ph: rng() * 6.28, yaw: run ? 0 : (rng() - 0.5) * 2.4 };
        list.push(d);
      }
      live.set(chunk.index, list);
    },
    release(index) { const l = live.get(index); if (!l) return; for (const d of l) { d.used = false; d.rig.group.visible = false; } live.delete(index); },
    update(dt, runnerS) {
      t += dt;
      for (const list of live.values()) for (const d of list) {
        const st = d.st, r = d.rig;
        if (st.run) {
          st.s += st.speed * st.dir * dt; st.yaw = st.dir > 0 ? 0 : Math.PI;
          if (st.s < st.s0 + 2 || st.s > st.s0 + CHUNK_LEN - 2) { st.run = false; st.s = Math.max(st.s0 + 2, Math.min(st.s0 + CHUNK_LEN - 2, st.s)); st.yaw += (st.x > 0 ? -1 : 1) * 0.9; }   // pulls up, turns its head to the verge, grazes
        }
        const near = Math.abs(st.s - runnerS) < 7 && !st.run;
        st.bow += ((near ? 1 : 0) - st.bow) * Math.min(1, dt * 3);                       // bows as a runner passes
        r.neck.rotation.x = st.bow * 0.9 + (st.run ? Math.sin(t * 9 + st.ph) * 0.08 : Math.sin(t * 1.5 + st.ph) * 0.05);
        r.legs.forEach((l, i) => { l.rotation.x = st.run ? Math.sin(t * 11 + (i % 2 ? Math.PI : 0) + (i >= 2 ? 1.6 : 0)) * 0.7 : 0; });
        r.group.position.set(st.x, st.run ? Math.abs(Math.sin(t * 11 + st.ph)) * 0.08 : 0, st.s); r.group.rotation.set(0, st.yaw, 0); placeMesh(r.group);
      }
    },
  };
}
