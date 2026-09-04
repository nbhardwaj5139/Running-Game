// Playable characters from Japanese folklore and everyday Japan. Each rig
// follows the same contract as buildRig: { group, body, head, tail, legs[4],
// ears, mats } — legs are hip pivots the renderer swings (for bipeds, legs[2..3]
// are the arms, which naturally swing opposite the legs).
import * as THREE from 'three';
import { buildRig } from './props.js';

const HPI = Math.PI / 2;
/**
 * Every character carries one signature colour, spread right around the wheel so no two
 * read alike at speed: it is the scarf they run in, the colour of their trail and the
 * ring under their feet. Two white animals are still told apart instantly by their scarf.
 */
export const CHARACTERS = [
  { id: 'kitsune', jp: '狐', en: 'Kitsune', blurb: 'Fox spirit, messenger of Inari', color: '#ff5a3c', trail: [2.4, 0.7, 0.4] },
  { id: 'tanuki', jp: '狸', en: 'Tanuki', blurb: 'Shape-shifting raccoon dog', color: '#ffb02e', trail: [2.4, 1.5, 0.35] },
  { id: 'shiba', jp: '柴犬', en: 'Shiba', blurb: 'The loyal little dog of Japan', color: '#ffe94d', trail: [2.4, 2.1, 0.5] },
  { id: 'neko', jp: '招き猫', en: 'Maneki-neko', blurb: 'The beckoning lucky cat', color: '#3fd96b', trail: [0.4, 2.3, 0.8] },
  { id: 'kappa', jp: '河童', en: 'Kappa', blurb: 'River yōkai with a water dish', color: '#2fd3e0', trail: [0.35, 2.0, 2.4] },
  { id: 'tengu', jp: '天狗', en: 'Tengu', blurb: 'Long-nosed mountain spirit', color: '#5a7cff', trail: [0.6, 1.0, 2.5] },
  { id: 'usagi', jp: '月の兎', en: 'Moon Rabbit', blurb: 'Pounds mochi on the moon', color: '#c96bff', trail: [1.7, 0.7, 2.5] },
];
export const characterById = (id) => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
/** Runners read a little small against a six-lane road; this is the base size of every rig. */
export const CHAR_SCALE = 1.5;

/** The signature scarf: a band at the neck plus a tail streaming behind. Same shape on every rig. */
function addScarf(rig, hex, M) {
  const mat = M(hex); const h = rig.head?.position;
  const y = (h?.y ?? 0.62) - 0.13, z = (h?.z ?? 0.2) - 0.06;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 6, 14), mat);
  band.position.set(0, y, z); band.rotation.set(HPI * 0.86, 0, 0); rig.group.add(band);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.38), mat);
  tail.position.set(0.05, y + 0.02, z - 0.26); tail.rotation.set(0.25, 0.15, 0.2); rig.group.add(tail);
  return mat;
}

export function buildCharacter(id, matFactory) {
  const ch = characterById(id);
  if (id === 'kitsune' || id === 'tanuki') { const r = buildRig(id, matFactory); r.mats.push(addScarf(r, ch.color, matFactory)); return r; }
  const g = new THREE.Group(); const mats = []; const M = (hex) => { const m = matFactory(hex); mats.push(m); return m; };
  const add = (parent, geo, m, p, r = [0, 0, 0], s = [1, 1, 1]) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(...p); mesh.rotation.set(...r); mesh.scale.set(...s); parent.add(mesh); return mesh; };
  const dark = M('#2b1d1a'); const legs = [], ears = [];
  let body, head, tail = null;
  const eyes = (parent, y, z, dx, r = 0.03) => { add(parent, new THREE.SphereGeometry(r, 6, 6), dark, [-dx, y, z]); add(parent, new THREE.SphereGeometry(r, 6, 6), dark, [dx, y, z]); };
  const quadLegs = (fur, foot, y = 0.34, len = 0.34) => { for (const [x, z] of [[-0.11, 0.18], [0.11, 0.18], [-0.11, -0.16], [0.11, -0.16]]) { const p = new THREE.Group(); p.position.set(x, y, z); g.add(p); add(p, new THREE.CylinderGeometry(0.045, 0.04, len, 6), fur, [0, -len / 2, 0]); if (foot) add(p, new THREE.SphereGeometry(0.05, 6, 5), foot, [0, -len, 0.01]); legs.push(p); } };
  const bipedLimbs = (legMat, armMat, hipY, shoulderY, legLen, armLen) => {
    for (const x of [-0.09, 0.09]) { const p = new THREE.Group(); p.position.set(x, hipY, 0); g.add(p); add(p, new THREE.CylinderGeometry(0.05, 0.045, legLen, 6), legMat, [0, -legLen / 2, 0]); add(p, new THREE.BoxGeometry(0.11, 0.05, 0.16), dark, [0, -legLen, 0.03]); legs.push(p); }
    for (const x of [-0.2, 0.2]) { const p = new THREE.Group(); p.position.set(x, shoulderY, 0); g.add(p); add(p, new THREE.CylinderGeometry(0.04, 0.035, armLen, 6), armMat, [0, -armLen / 2, 0]); legs.push(p); }
  };
  switch (id) {
    case 'shiba': {
      const tan = M('#e0a35c'), cream = M('#fff4e2');
      body = add(g, new THREE.CapsuleGeometry(0.2, 0.36, 4, 10), tan, [0, 0.46, 0], [HPI, 0, 0]);
      add(g, new THREE.CapsuleGeometry(0.15, 0.32, 4, 8), cream, [0, 0.37, 0.02], [HPI, 0, 0]);
      head = add(g, new THREE.SphereGeometry(0.2, 12, 10), tan, [0, 0.66, 0.36]);
      add(head, new THREE.SphereGeometry(0.11, 8, 7), cream, [0, -0.05, 0.16], [0, 0, 0], [1.1, 0.8, 1]);
      add(head, new THREE.SphereGeometry(0.035, 6, 6), dark, [0, -0.02, 0.27]); eyes(head, 0.05, 0.16, 0.08);
      add(head, new THREE.SphereGeometry(0.07, 7, 6), cream, [-0.09, 0.07, 0.15], [0, 0, 0], [1, 0.5, 1]); add(head, new THREE.SphereGeometry(0.07, 7, 6), cream, [0.09, 0.07, 0.15], [0, 0, 0], [1, 0.5, 1]);
      for (const s of [-1, 1]) { const e = add(head, new THREE.ConeGeometry(0.06, 0.16, 5), tan, [s * 0.11, 0.2, -0.03], [0.1, 0, -s * 0.2]); ears.push(e); }
      tail = new THREE.Group(); tail.position.set(0, 0.6, -0.3); g.add(tail);
      add(tail, new THREE.TorusGeometry(0.11, 0.06, 6, 10, Math.PI * 1.4), tan, [0, 0.06, -0.02], [0, HPI, 0]);
      add(tail, new THREE.SphereGeometry(0.05, 6, 5), cream, [0, 0.16, -0.06]);
      quadLegs(tan, cream); break; }
    case 'neko': {
      const white = M('#fbf8f2'), orange = M('#e2843a'), red = M('#c9302c'), gold = M('#f2c230');
      body = add(g, new THREE.SphereGeometry(0.24, 12, 10), white, [0, 0.46, 0], [0, 0, 0], [1, 1.05, 1.3]);
      add(body, new THREE.SphereGeometry(0.1, 8, 6), orange, [0.12, 0.16, -0.02]); add(body, new THREE.SphereGeometry(0.08, 8, 6), orange, [-0.14, 0.1, 0.1]);
      head = add(g, new THREE.SphereGeometry(0.22, 12, 10), white, [0, 0.74, 0.3], [0, 0, 0], [1.1, 0.95, 1]);
      add(head, new THREE.SphereGeometry(0.1, 8, 6), orange, [-0.12, 0.12, -0.04]);
      eyes(head, 0.04, 0.19, 0.08, 0.028); add(head, new THREE.SphereGeometry(0.025, 6, 6), M('#e88a9a'), [0, -0.03, 0.22]);
      for (const s of [-1, 1]) { const e = add(head, new THREE.ConeGeometry(0.07, 0.15, 4), white, [s * 0.12, 0.2, -0.02], [0, 0.4, -s * 0.15]); ears.push(e); }
      add(g, new THREE.TorusGeometry(0.19, 0.03, 6, 16), red, [0, 0.6, 0.28], [HPI + 0.3, 0, 0]);       // collar
      add(g, new THREE.SphereGeometry(0.05, 8, 8), gold, [0, 0.52, 0.46]);                              // bell
      add(g, new THREE.CylinderGeometry(0.045, 0.04, 0.3, 6), white, [0.18, 0.72, 0.36], [0.6, 0, -0.3]); add(g, new THREE.SphereGeometry(0.055, 6, 6), white, [0.24, 0.86, 0.4]);   // beckoning paw
      tail = new THREE.Group(); tail.position.set(0, 0.6, -0.3); g.add(tail);
      add(tail, new THREE.CapsuleGeometry(0.05, 0.36, 4, 8), white, [0, 0.16, -0.05], [-0.25, 0, 0]); add(tail, new THREE.SphereGeometry(0.06, 6, 6), orange, [0, 0.36, -0.1]);
      quadLegs(white, null); break; }
    case 'kappa': {
      const green = M('#5f9e4a'), shell = M('#3d5f2a'), yellow = M('#e9d26b'), beak = M('#d7b04c');
      body = add(g, new THREE.SphereGeometry(0.2, 12, 10), green, [0, 0.5, 0], [0, 0, 0], [1, 1.2, 0.9]);
      add(g, new THREE.SphereGeometry(0.24, 12, 10, 0, Math.PI * 2, 0, HPI), shell, [0, 0.5, -0.1], [-HPI + 0.3, 0, 0]);   // shell
      add(g, new THREE.SphereGeometry(0.16, 10, 8), yellow, [0, 0.42, 0.1], [0, 0, 0], [1, 0.9, 0.6]);                       // belly plate
      head = add(g, new THREE.SphereGeometry(0.17, 12, 10), green, [0, 0.82, 0.08]);
      add(head, new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), yellow, [0, 0.16, 0]);                    // water dish
      add(head, new THREE.CylinderGeometry(0.085, 0.085, 0.02, 12), M('#8fd3f4'), [0, 0.175, 0]);
      add(head, new THREE.ConeGeometry(0.06, 0.14, 6), beak, [0, -0.03, 0.2], [HPI, 0, 0]); eyes(head, 0.04, 0.14, 0.07, 0.032);
      for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.03, 6, 6), dark, [s * 0.13, 0.08, 0.08], [0, 0, 0], [1, 1.6, 1]);   // hair tufts
      bipedLimbs(green, green, 0.32, 0.6, 0.3, 0.26); break; }
    case 'tengu': {
      const red = M('#c8402a'), robe = M('#f4efe6'), black = M('#221b1b'), gold = M('#e0b44c');
      body = add(g, new THREE.ConeGeometry(0.22, 0.5, 10), robe, [0, 0.45, 0]);
      add(g, new THREE.TorusGeometry(0.16, 0.03, 6, 14), black, [0, 0.5, 0], [HPI, 0, 0]);                 // sash
      for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.3, 0.14, 0.02), black, [s * 0.24, 0.66, -0.12], [0, 0, s * 0.6]);   // wings
      head = add(g, new THREE.SphereGeometry(0.17, 12, 10), red, [0, 0.86, 0.04]);
      add(head, new THREE.ConeGeometry(0.04, 0.26, 7), red, [0, -0.01, 0.26], [HPI, 0, 0]);               // the nose
      eyes(head, 0.05, 0.14, 0.07, 0.028); add(head, new THREE.BoxGeometry(0.12, 0.03, 0.02), black, [0, 0.11, 0.16]);
      add(head, new THREE.BoxGeometry(0.09, 0.08, 0.09), black, [0, 0.19, -0.02]);                         // tokin cap
      add(g, new THREE.BoxGeometry(0.02, 0.16, 0.12), gold, [0.26, 0.42, 0.06], [0, 0, 0.3]);            // feather fan
      bipedLimbs(robe, robe, 0.3, 0.62, 0.28, 0.28); break; }
    default: {   // usagi — moon rabbit
      const white = M('#f8f6ff'), pink = M('#f4b3c6');
      body = add(g, new THREE.CapsuleGeometry(0.18, 0.3, 4, 10), white, [0, 0.42, 0], [HPI, 0, 0]);
      head = add(g, new THREE.SphereGeometry(0.17, 12, 10), white, [0, 0.62, 0.3]);
      add(head, new THREE.SphereGeometry(0.025, 6, 6), pink, [0, -0.03, 0.17]); eyes(head, 0.04, 0.13, 0.07, 0.028);
      for (const s of [-1, 1]) { const e = add(head, new THREE.CapsuleGeometry(0.035, 0.24, 4, 6), white, [s * 0.07, 0.26, -0.04], [0.15, 0, -s * 0.18]); add(e, new THREE.CapsuleGeometry(0.018, 0.2, 4, 6), pink, [0, 0, 0.02]); ears.push(e); }
      tail = new THREE.Group(); tail.position.set(0, 0.48, -0.26); g.add(tail); add(tail, new THREE.SphereGeometry(0.07, 7, 6), white, [0, 0, -0.03]);
      add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.22, 5), M('#8b6a48'), [0.2, 0.5, 0.2], [0, 0, 0.9]); add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.09, 8), M('#c9a57a'), [0.29, 0.56, 0.2], [0, 0, 0.9]);   // mochi mallet
      quadLegs(white, pink, 0.3, 0.3); }
  }
  const rig = { group: g, body, head, tail, legs, ears, mats };
  addScarf(rig, ch.color, M);      // M already collects into `mats`
  return rig;
}
