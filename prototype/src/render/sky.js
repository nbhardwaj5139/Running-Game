// Sky dome, sun, stars, drifting clouds, Mount Fuji, ridge lines, a Tokyo-Tower
// silhouette. All scene-space (the camera never moves), so it is free parallax.
import * as THREE from 'three';

const NOISE = /* glsl */`
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }`;

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: new THREE.Vector3(0.25, 0.08, 1) }, uNight: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; varying vec3 vDir; uniform vec3 uSun; uniform float uNight, uTime; ${NOISE}
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 top = mix(vec3(0.09,0.15,0.40), vec3(0.01,0.015,0.06), uNight);
        vec3 mid = mix(vec3(0.58,0.34,0.52), vec3(0.05,0.05,0.14), uNight);
        vec3 hor = mix(vec3(1.00,0.56,0.30), vec3(0.16,0.09,0.20), uNight);
        vec3 col = mix(hor, mid, smoothstep(-0.02, 0.16, h)); col = mix(col, top, smoothstep(0.16, 0.6, h));
        float s = max(0.0, dot(d, normalize(uSun)));
        col += (vec3(1.0,0.75,0.45) * pow(s, 400.0) * 4.0 + vec3(1.0,0.45,0.22) * pow(s, 5.0) * 0.55) * (1.0 - uNight);
        vec2 sp = d.xz / max(0.06, h + 0.25) * 140.0; vec2 sc = floor(sp); float sh = hash(sc);
        float star = step(0.994, sh) * smoothstep(0.03, 0.35, h) * uNight * (0.5 + 0.5 * sin(uTime * 1.5 + sh * 40.0));
        col += star * 0.85;
        vec2 cp = d.xz / max(0.08, h) * 0.55 + vec2(uTime * 0.012, 0.0);
        float c = smoothstep(0.52, 0.78, fbm(cp)) * smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.45, 0.9, h));
        vec3 cloud = mix(mix(vec3(0.98,0.62,0.55), vec3(0.75,0.45,0.60), smoothstep(0.0,0.3,h)), vec3(0.07,0.07,0.13), uNight);
        col = mix(col, cloud, c * 0.7);
        col = pow(max(col, 0.0), vec3(2.2));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  sky.renderOrder = -10;
  return sky;
}

function ridge(width, baseY, amp, z, color, seed) {
  const pts = [new THREE.Vector2(-width, -20)];
  let x = -width, r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  while (x < width) { const y = baseY + amp * (0.35 + 0.65 * rnd()) * (1 - 0.6 * Math.abs(x) / width); pts.push(new THREE.Vector2(x, y)); x += 14 + rnd() * 26; }
  pts.push(new THREE.Vector2(width, -20));
  const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
  m.position.z = z; return m;
}

export function makeHorizon() {
  const g = new THREE.Group();
  // Mount Fuji, straight ahead and a little to the right
  const fuji = new THREE.Mesh(new THREE.ConeGeometry(150, 82, 48), new THREE.MeshBasicMaterial({ color: 0x3b2c4d }));
  fuji.position.set(70, 41, 330); g.add(fuji);
  const snow = new THREE.Mesh(new THREE.ConeGeometry(40, 23, 48), new THREE.MeshBasicMaterial({ color: 0xf3e4ee }));
  snow.position.set(70, 41 + 41 - 11.5 + 0.2, 330); g.add(snow);
  g.add(ridge(420, 6, 44, 280, 0x33264a, 7));
  g.add(ridge(380, 4, 30, 215, 0x281d3a, 19));
  g.add(ridge(340, 2, 18, 165, 0x1f1630, 31));
  // Tokyo Tower silhouette, off to the left
  const tower = new THREE.Group();
  const tm = new THREE.MeshBasicMaterial({ color: 0xd6512b });
  const base = new THREE.Mesh(new THREE.ConeGeometry(16, 70, 4, 1, true), tm); base.position.y = 35; base.rotation.y = Math.PI / 4; tower.add(base);
  const top = new THREE.Mesh(new THREE.ConeGeometry(6, 50, 4, 1, true), tm); top.position.y = 70 + 25; top.rotation.y = Math.PI / 4; tower.add(top);
  for (const [y, r] of [[26, 11], [50, 7], [80, 4]]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(r + 1.5, r + 1.5, 2.5, 8), new THREE.MeshBasicMaterial({ color: 0xf1ede8 })); d.position.y = y; tower.add(d); }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.3) })); beacon.position.y = 121; tower.add(beacon);
  tower.position.set(-120, 0, 240); g.add(tower);
  // sun
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('rgba(255,225,170,1)', 'rgba(255,140,60,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sun.scale.set(90, 90, 1); sun.material.opacity = 0.85; sun.position.set(90, 42, 380); g.add(sun);
  return { group: g, fuji, snow, tower, beacon, sun, ridges: g.children.filter(c => c.geometry?.type === 'ShapeGeometry') };
}

export function radial(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, inner); r.addColorStop(1, outer); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
