// The sky is the hero of the anime look: a painterly dome (banded gradient,
// towering cumulus with lit edges, sun, stars, a comet with a split tail), god
// rays, a lens flare, and the far landscape (Fuji, ridges, Tokyo Tower, sea).
// Scene space and static; every colour comes from the theme each frame.
import * as THREE from 'three';
import { NOISE_GLSL, radial, canvasTexture } from './common.js';
import { getTheme } from './theme.js';

const SUN_DIR = new THREE.Vector3(0.28, 0.16, 1).normalize();

function domeMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uCloud: { value: new THREE.Color() }, uShadow: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
      uSun: { value: SUN_DIR.clone() }, uNight: { value: 0 }, uCover: { value: 0.5 }, uWisp: { value: 0.3 }, uTime: { value: 0 },
      uComet: { value: new THREE.Vector3(-0.5, 0.45, 0.7).normalize() }, uCometTail: { value: new THREE.Vector3(1, 0.35, 0).normalize() },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `precision highp float; varying vec3 vDir;
      uniform vec3 uTop, uMid, uHor, uCloud, uShadow, uSunCol, uSun, uComet, uCometTail; uniform float uNight, uCover, uWisp, uTime; ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        // painterly bands
        vec3 col = mix(uHor, uMid, smoothstep(-0.03, 0.2, h)); col = mix(col, uTop, smoothstep(0.2, 0.75, h));
        col *= 1.0 + 0.035 * sin(h * 38.0 + noise(d.xz * 3.0) * 2.0);
        // sun
        vec3 sd = normalize(uSun); float s = max(0.0, dot(d, sd)); float day = 1.0 - uNight * 0.92;
        col += uSunCol * (smoothstep(0.9982, 0.9994, s) * 3.0 + pow(s, 90.0) * 0.9 + pow(s, 7.0) * 0.22) * day;
        // cumulus: sample a cloud field on a plane above the viewer; light it by re-sampling toward the sun
        vec2 uv = d.xz / max(0.07, h + 0.06); vec2 cp = uv * 0.42 + vec2(uTime * 0.012, 0.0);
        float n = fbm(cp); float n2 = fbm(cp + sd.xz * 0.11);
        float lo = 0.62 - uCover * 0.24, hi = lo + 0.16;
        float mask = smoothstep(lo, hi, n) * smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.55, 0.95, h));
        float lit = clamp((n - n2) * 7.0 + 0.55, 0.0, 1.0);
        vec3 ccol = mix(uShadow, uCloud, lit) + uSunCol * pow(s, 4.0) * 0.25 * day;
        col = mix(col, ccol, mask * 0.92);
        // cirrus wisps
        float w = fbm(uv * vec2(2.6, 0.5) + vec2(uTime * 0.03, 3.0)); float wm = smoothstep(0.58, 0.72, w) * uWisp * smoothstep(0.08, 0.35, h) * (1.0 - mask);
        col = mix(col, mix(uShadow, uCloud, 0.8), wm * 0.55);
        // stars
        vec2 sp = d.xz / max(0.06, h + 0.25) * 140.0; float sh = hash(floor(sp));
        float star = step(0.994, sh) * smoothstep(0.03, 0.35, h) * uNight * (0.5 + 0.5 * sin(uTime * 1.5 + sh * 40.0)) * (1.0 - mask);
        col += star * 0.9;
        // comet with a split tail (night only)
        vec3 cd = normalize(uComet); vec3 td = normalize(uCometTail - cd * dot(uCometTail, cd));
        vec3 v = d - cd; float along = dot(v, td); float side = length(v - td * along);
        float env = smoothstep(0.0, 0.01, along) * exp(-along * 5.5);
        float tail = (exp(-pow(side - along * 0.045, 2.0) * 9000.0) + exp(-pow(side + along * 0.045, 2.0) * 9000.0)) * env;
        float head = pow(max(0.0, dot(d, cd)), 2500.0) * 4.0;
        col += (vec3(0.75, 0.9, 1.3) * tail * 0.9 + vec3(1.0, 0.95, 0.9) * head) * smoothstep(0.45, 0.8, uNight);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function ridge(width, baseY, amp, z, seed) {
  const pts = [new THREE.Vector2(-width, -30)]; let x = -width, r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  while (x < width) { pts.push(new THREE.Vector2(x, baseY + amp * (0.35 + 0.65 * rnd()) * (1 - 0.6 * Math.abs(x) / width))); x += 14 + rnd() * 26; }
  pts.push(new THREE.Vector2(width, -30));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), new THREE.MeshBasicMaterial({ color: 0x333333 })); m.position.z = z; return m;
}

export function makeSky() {
  const group = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(420, 40, 20), domeMaterial()); dome.renderOrder = -10; group.add(dome);
  const U = dome.material.uniforms;

  // far landscape
  const fuji = new THREE.Mesh(new THREE.ConeGeometry(150, 82, 48), new THREE.MeshBasicMaterial({ color: 0x3b2c4d })); fuji.position.set(70, 41, 330); group.add(fuji);
  const snow = new THREE.Mesh(new THREE.ConeGeometry(40, 23, 48), new THREE.MeshBasicMaterial({ color: 0xf3e4ee })); snow.position.set(70, 70.7, 330); group.add(snow);
  const ridges = [ridge(420, 6, 44, 280, 7), ridge(380, 4, 30, 215, 19), ridge(340, 2, 18, 165, 31)]; ridges.forEach(r => group.add(r));
  const tower = new THREE.Group(); const tm = new THREE.MeshBasicMaterial({ color: 0xd6512b });
  const tb = new THREE.Mesh(new THREE.ConeGeometry(16, 70, 4, 1, true), tm); tb.position.y = 35; tb.rotation.y = Math.PI / 4; tower.add(tb);
  const tt = new THREE.Mesh(new THREE.ConeGeometry(6, 50, 4, 1, true), tm); tt.position.y = 95; tt.rotation.y = Math.PI / 4; tower.add(tt);
  for (const [y, r] of [[26, 11], [50, 7], [80, 4]]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(r + 1.5, r + 1.5, 2.5, 8), new THREE.MeshBasicMaterial({ color: 0xf1ede8 })); d.position.y = y; tower.add(d); }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.3) })); beacon.position.y = 121; tower.add(beacon);
  tower.position.set(-120, 0, 240); group.add(tower);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1200, 900), new THREE.MeshBasicMaterial({ color: 0x1a8db2 })); sea.rotation.x = -Math.PI / 2; sea.position.set(560, -0.4, 200); sea.visible = false; group.add(sea);

  // sun sprite, god rays, flare
  const sunPos = SUN_DIR.clone().multiplyScalar(390);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('rgba(255,240,210,1)', 'rgba(255,170,90,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); sunSprite.scale.set(64, 64, 1); sunSprite.position.copy(sunPos); group.add(sunSprite);
  const rayTex = canvasTexture(64, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,230,180,0.55)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const rays = new THREE.Group(); rays.position.copy(sunPos); rays.lookAt(0, 0, 0);
  for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(38 + i * 6, 520), new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.position.y = -240; m.rotation.z = (i / 7) * Math.PI * 2; const pivot = new THREE.Group(); pivot.rotation.z = (i / 7) * Math.PI * 2; pivot.add(m); m.position.set(0, 0, 0); m.geometry.translate(0, -250, 0); rays.add(pivot); }
  group.add(rays);
  const flares = [[0.32, 8, 'rgba(255,200,150,0.5)'], [0.55, 4, 'rgba(160,220,255,0.5)'], [0.85, 12, 'rgba(255,160,200,0.35)'], [1.25, 6, 'rgba(255,240,200,0.45)'], [1.6, 16, 'rgba(180,255,220,0.25)']].map(([k, size, c]) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial(c, 'rgba(255,255,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true })); s.scale.set(size, size, 1); s.userData.k = k; return s;
  });
  const flareGroup = new THREE.Group(); flares.forEach(f => flareGroup.add(f));

  const cur = { top: new THREE.Color(), mid: new THREE.Color(), hor: new THREE.Color(), cloud: new THREE.Color(), shadow: new THREE.Color(), sun: new THREE.Color() };
  let init = false; const ndc = new THREE.Vector3();
  const COVER = [0.45, 0.7, 0.35, 0.55], WISP = [0.35, 0.15, 0.7, 0.4];

  function update(dt, state, camera) {
    const th = getTheme(state.season, state.night, state.biome);
    const k = init ? Math.min(1, dt * 1.2) : 1; init = true;
    cur.top.lerp(th.skyTop, k); cur.mid.lerp(th.skyMid, k); cur.hor.lerp(th.horizon, k); cur.cloud.lerp(th.cloud, k); cur.shadow.lerp(th.cloudShadow, k); cur.sun.lerp(th.sun, k);
    U.uTop.value.copy(cur.top); U.uMid.value.copy(cur.mid); U.uHor.value.copy(cur.hor); U.uCloud.value.copy(cur.cloud); U.uShadow.value.copy(cur.shadow); U.uSunCol.value.copy(cur.sun);
    U.uNight.value = state.night; U.uTime.value = state.time;
    U.uCover.value += ((COVER[state.season] + state.dread * 0.4) - U.uCover.value) * k; U.uWisp.value += (WISP[state.season] - U.uWisp.value) * k;
    U.uSun.value.set(0.28, 0.16 - 0.32 * state.night, 1).normalize();
    U.uComet.value.set(-0.5 + 0.08 * Math.sin(state.time * 0.02), 0.45, 0.7).normalize();
    const sunVis = 1 - state.night;
    sunSprite.position.copy(U.uSun.value).multiplyScalar(390); sunSprite.material.opacity = sunVis * 0.55;
    rays.position.copy(sunSprite.position); rays.lookAt(0, 0, 0); rays.rotation.z += dt * 0.02;
    rays.children.forEach((p, i) => { p.children[0].material.opacity = sunVis * (0.16 + 0.12 * Math.sin(state.time * 0.3 + i)) * (1 - state.dread * 0.7); });
    fuji.material.color.copy(th.skyMid).lerp(th.horizon, 0.25).multiplyScalar(0.75); snow.material.color.copy(th.cloud).lerp(th.horizon, 0.3);
    snow.scale.setScalar(state.season === 3 ? 1.6 : 1);
    ridges.forEach((r, i) => r.material.color.copy(th.fog).lerp(th.skyMid, 0.3 + i * 0.15).multiplyScalar(0.55 + i * 0.12));
    tm.color.set(0xd6512b).lerp(th.fog, 0.5); beacon.material.color.setRGB(4, 0.4, 0.3).multiplyScalar(Math.round(Math.sin(state.time * 2) * 0.5 + 0.5));
    sea.visible = state.biome === 3; sea.material.color.copy(th.water);
    // lens flare along the sun → screen-centre line, attached to the camera
    if (camera) {
      if (flareGroup.parent !== camera) camera.add(flareGroup);
      ndc.copy(sunSprite.position).project(camera);
      const vis = ndc.z < 1 && Math.abs(ndc.x) < 1.4 && Math.abs(ndc.y) < 1.4 ? sunVis * (1 - state.dread) * (1 - Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) * 0.5) : 0;
      const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), dist = 20;
      for (const f of flares) { const kx = -ndc.x * f.userData.k, ky = -ndc.y * f.userData.k; f.position.set(kx * tanH * camera.aspect * dist, ky * tanH * dist, -dist); f.material.opacity = vis * 0.9; }
    }
  }
  return { group, update };
}
