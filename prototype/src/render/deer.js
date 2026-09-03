// Nara deer: low-poly sika deer that graze in the verges, trot along the road,
// and bow as a runner passes. Track-space kinematics; placed through the mapper.
import * as THREE from 'three';
import { placeMesh } from './common.js';
import { CHUNK_LEN } from '../core/chunks.js';

function deerRig() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0xa9784a, roughness: 0.9 }), cream = new THREE.MeshStandardMaterial({ color: 0xf1e3c8, roughness: 0.9 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a2a1c });
  const add = (parent, geo, m, p, r = [0, 0, 0]) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(...p); mesh.rotation.set(...r); parent.add(mesh); return mesh; };
  add(g, new THREE.CapsuleGeometry(0.22, 0.6, 4, 10), fur, [0, 0.72, 0], [Math.PI / 2, 0, 0]);
  add(g, new THREE.CapsuleGeometry(0.15, 0.5, 4, 8), cream, [0, 0.62, 0.02], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 12; i++) add(g, new THREE.SphereGeometry(0.035, 5, 4), cream, [(i % 2 ? 0.14 : -0.14) + (Math.sin(i * 1.7) * 0.06), 0.9, -0.3 + (i >> 1) * 0.11]);   // spots
  const neck = new THREE.Group(); neck.position.set(0, 0.85, 0.32); g.add(neck);
  add(neck, new THREE.CylinderGeometry(0.09, 0.12, 0.42, 8), fur, [0, 0.18, 0.08], [-0.5, 0, 0]);
  const head = new THREE.Group(); head.position.set(0, 0.4, 0.2); neck.add(head);
  add(head, new THREE.SphereGeometry(0.13, 10, 8), fur, [0, 0, 0]); add(head, new THREE.ConeGeometry(0.07, 0.2, 8), fur, [0, -0.03, 0.17], [Math.PI / 2, 0, 0]); add(head, new THREE.SphereGeometry(0.03, 6, 6), dark, [0, -0.02, 0.27]);
  for (const s of [-1, 1]) { add(head, new THREE.ConeGeometry(0.04, 0.14, 5), fur, [s * 0.1, 0.11, -0.02], [0, 0, -s * 0.5]); add(head, new THREE.CylinderGeometry(0.012, 0.02, 0.24, 5), dark, [s * 0.06, 0.24, -0.02], [0.2, 0, -s * 0.35]); add(head, new THREE.CylinderGeometry(0.01, 0.015, 0.12, 5), dark, [s * 0.11, 0.3, -0.03], [0.2, 0, -s * 1.1]); }
  const legs = [];
  for (const [x, z] of [[-0.12, 0.28], [0.12, 0.28], [-0.12, -0.26], [0.12, -0.26]]) { const p = new THREE.Group(); p.position.set(x, 0.55, z); g.add(p); add(p, new THREE.CylinderGeometry(0.04, 0.03, 0.55, 6), fur, [0, -0.27, 0]); legs.push(p); }
  add(g, new THREE.SphereGeometry(0.06, 6, 5), cream, [0, 0.8, -0.52]);
  return { group: g, neck, legs };
}

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
        if (st.run) { st.s += st.speed * st.dir * dt; if (st.s < st.s0 + 2 || st.s > st.s0 + CHUNK_LEN - 2) st.dir *= -1; st.yaw = st.dir > 0 ? 0 : Math.PI; }
        const near = Math.abs(st.s - runnerS) < 7 && !st.run;
        st.bow += ((near ? 1 : 0) - st.bow) * Math.min(1, dt * 3);                       // bows as a runner passes
        r.neck.rotation.x = st.bow * 0.9 + (st.run ? Math.sin(t * 9 + st.ph) * 0.08 : Math.sin(t * 1.5 + st.ph) * 0.05);
        r.legs.forEach((l, i) => { l.rotation.x = st.run ? Math.sin(t * 11 + (i % 2 ? Math.PI : 0) + (i >= 2 ? 1.6 : 0)) * 0.7 : 0; });
        r.group.position.set(st.x, st.run ? Math.abs(Math.sin(t * 11 + st.ph)) * 0.08 : 0, st.s); r.group.rotation.set(0, st.yaw, 0); placeMesh(r.group);
      }
    },
  };
}
