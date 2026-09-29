import * as THREE from 'three';
import { realmThreshold } from './crossings.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Particles } from './particles.js';
import { clay } from './style.js';
import { fbm, smoothstep, lerp, mulberry32 } from './util.js';
import { TUNNEL_LEN, TUNNEL_HALF } from './world.js';
import { runeCircleTexture } from './textures.js';
import { SCHOOLS, NODE_TYPES, SANCTUMS, THRESHOLDS } from './data.js';
import { Sanctum, SANCTUM_SITE, PLANS_POS, SANCTUM_DOOR_Z } from './sanctums.js';
import { prop } from './assets.js';
import { Land, WORLD_R } from './realmlands.js';
import { mergeStatic } from './merge.js';
import { buildDeep, veinNode } from './deep.js';

// Elemental realms: self-contained worlds reached over the bridges at the valley's edge (crossings.js).
// Each has its own terrain, sky, palette, props, creatures, environmental hazard and two
// puzzle altars. The player, magic and camera systems are shared; a realm supplies a height
// function, bounds and an "arena" description so those systems work unchanged.

const R = WORLD_R;       // playable radius: as large as the valley
// Where you arrive: just inside the cliffs that ring the realm, with the way home cut into them
// behind you (toward the valley's side of the world), so you step out at the land's edge.
const ARRIVE = { x: 0, z: R - 30 };
const MOUTH_Z = ARRIVE.z + 5;
const rbox = (w, h, d, r = 0.1) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
const shadowAll = (o) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
// Every realm keeps a flat, clear site at the north end for its sanctum, and a clear spot for
// the cornerstone in front of it.
const SITE_R = 16;
const siteDist = (x, z) => Math.hypot(x - SANCTUM_SITE.x, z - SANCTUM_SITE.z);
const siteBlend = (x, z) => 1 - smoothstep(SITE_R, SITE_R + 5, siteDist(x, z));
const reserved = (x, z, pad = 0) => siteDist(x, z) < SITE_R + pad || Math.hypot(x - PLANS_POS.x, z - PLANS_POS.z) < 4 + pad;

// ---------------------------------------------------------------- shared scaffolding
function skyDome({ top, horizon, stars = 0, aurora = 0, glow = '#000000' }) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(top) }, uHor: { value: new THREE.Color(horizon) }, uGlow: { value: new THREE.Color(glow) }, uStars: { value: stars }, uAurora: { value: aurora }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `
      uniform vec3 uTop, uHor, uGlow; uniform float uStars, uAurora, uTime; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(uHor, uTop, pow(h, 0.6));
        c += uGlow * pow(1.0 - h, 6.0);
        float s = hash(floor(d * 360.0));
        c += vec3(smoothstep(0.996, 1.0, s)) * uStars * smoothstep(0.0, 0.3, d.y);
        // Aurora: layered sine curtains across the northern sky.
        float a = 0.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          float band = sin(d.x * (3.0 + fi) + uTime * (0.15 + fi * 0.05) + fi * 2.0) * 0.08 + 0.35 + fi * 0.08;
          a += smoothstep(0.06, 0.0, abs(d.y - band)) * (0.6 - fi * 0.15) * (0.6 + 0.4 * sin(d.x * 12.0 + uTime + fi));
        }
        c += mix(vec3(0.2, 1.0, 0.6), vec3(0.6, 0.3, 1.0), clamp(d.x * 0.5 + 0.5, 0.0, 1.0)) * a * uAurora * step(-0.2, -d.z);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  m.frustumCulled = false; m.renderOrder = -1;
  return m;
}

function terrainMesh(heightAt, colorAt) {
  const size = 420, seg = 240;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    colorAt(c, pos.getX(i), pos.getZ(i), pos.getY(i), nrm.getY(i));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  mesh.receiveShadow = true; mesh.userData.noCut = true;
  return mesh;
}

// A glowing swirl disc used for portals.
function swirlMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uPower: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform float uTime, uPower; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
        float swirl = sin(a * 5.0 + r * 10.0 - uTime * 3.0) * 0.5 + 0.5;
        float body = smoothstep(1.0, 0.2, r);
        vec3 c = mix(uColor, vec3(1.0), smoothstep(0.35, 0.0, r) * 0.7) * (0.55 + swirl * 0.6);
        gl_FragColor = vec4(c * uPower, body * (0.7 + swirl * 0.3) * uPower);
      }`,
  });
}

export function portalArch(color, stone = '#8a8096') {
  const g = new THREE.Group();
  const mat = clay(stone, { roughness: 0.6, key: 'arch' + stone });
  [-1.9, 1.9].forEach((x) => {
    const p = new THREE.Mesh(rbox(0.8, 4.2, 0.8, 0.2), mat); p.position.set(x, 2.1, 0); g.add(p);
    const cap = new THREE.Mesh(rbox(1.1, 0.35, 1.1, 0.12), mat); cap.position.set(x, 4.3, 0); g.add(cap);
  });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.38, 12, 32, Math.PI), mat); arch.position.y = 4.3; g.add(arch);
  const key = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 }));
  key.position.y = 6.3; g.add(key);
  shadowAll(g);
  const swirl = new THREE.Mesh(new THREE.CircleGeometry(1.75, 48), swirlMaterial(color));
  swirl.position.y = 2.6; swirl.scale.y = 1.35; g.add(swirl);
  const light = new THREE.PointLight(color, 6, 12, 2); light.position.set(0, 2.5, 1); g.add(light);
  g.userData = { swirl, key, light };
  return g;
}

function altar(color, top) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.4, 10), clay('#6a6474', { key: 'altarBase' })); base.position.y = 0.2;
  const ring = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48), new THREE.MeshBasicMaterial({ map: runeCircleTexture(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.42;
  const ped = new THREE.Mesh(rbox(1.0, 1.1, 1.0, 0.15), clay('#8a8096', { key: 'arch#8a8096' })); ped.position.y = 0.95;
  g.add(base, ring, ped);
  if (top) { top.position.y = 1.5; g.add(top); }
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.6, 30, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beacon.position.y = 15; g.add(beacon);
  const light = new THREE.PointLight(color, 5, 10, 2); light.position.y = 2.5; g.add(light);
  shadowAll(g); ring.castShadow = false; beacon.castShadow = false;
  g.userData = { ring, beacon };
  return g;
}

// ---------------------------------------------------------------- Necromancy: The Hollow Crypt
function buildCrypt(rand, add, api) {
  const heightAt = (x, z) => {
    const d = Math.hypot(x, z);
    let h = fbm(x * 0.04, z * 0.04, 3) * 1.2 + Math.max(0, fbm(x * 0.11 + 5, z * 0.11, 2)) * 0.8; // burial mounds
    h += smoothstep(R - 24, R + 4, d) * 26; // cliffs ring the moors
    return lerp(h, 0, siteBlend(x, z));
  };
  const colorAt = (c, x, z, h, up) => {
    const n = fbm(x * 0.08, z * 0.08, 2) * 0.5 + 0.5;
    c.set('#34463a').lerp(new THREE.Color('#4a3d52'), n * 0.6);
    const path = Math.hypot(x, z) > 58 ? 9 : Math.min(Math.abs(x) - 1.6, Math.hypot(x, z + 36) - 4);
    if (path < 0.6) c.lerp(new THREE.Color('#7a7488'), smoothstep(0.6, -0.4, path));
    c.lerp(new THREE.Color('#2a2630'), smoothstep(0.8, 0.5, up));
  };
  const stone = clay('#8a8599', { roughness: 0.7, key: 'grave' });
  const stoneDark = clay('#5d5868', { roughness: 0.75, key: 'graveDark' });
  const graves = [];
  // Rows of gravestones either side of the central path.
  for (let row = 0; row < 7; row++) {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const x = side * (6 + k * 5.5 + (rand() - 0.5) * 1.5), z = 26 - row * 8 + (rand() - 0.5) * 2;
        if (Math.hypot(x, z) > R - 6 || Math.hypot(x + 22, z + 10) < 6 || Math.hypot(x - 24, z + 18) < 6 || reserved(x, z, 2)) continue;
        const g = new THREE.Group();
        const kind = rand();
        if (kind < 0.55) {
          const slab = new THREE.Mesh(rbox(1.1, 1.3, 0.3, 0.1), rand() < 0.5 ? stone : stoneDark); slab.position.y = 0.6; g.add(slab);
          const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 16, 1, false, 0, Math.PI), slab.material); top.rotation.set(Math.PI / 2, 0, Math.PI / 2); top.position.y = 1.25; g.add(top);
        } else if (kind < 0.85) {
          const v = new THREE.Mesh(rbox(0.3, 1.8, 0.3), stone); v.position.y = 0.9; g.add(v);
          const h = new THREE.Mesh(rbox(1.0, 0.3, 0.3), stone); h.position.y = 1.35; g.add(h);
        } else {
          const obel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.45, 2.4, 4), stoneDark); obel.position.y = 1.2; obel.rotation.y = Math.PI / 4; g.add(obel);
        }
        const mound = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), clay('#2e3a30', { key: 'mound' }));
        mound.scale.set(0.9, 0.35, 1.6); mound.position.z = 1.2; g.add(mound);
        g.position.set(x, heightAt(x, z) - 0.05, z);
        g.rotation.set((rand() - 0.5) * 0.15, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.2);
        add(shadowAll(g), 0.6);
        graves.push({ x, z: z + 1.2, y: g.position.y });
      }
    }
  }
  // Twisted dead trees.
  const bark = clay('#2e2622', { roughness: 0.8, key: 'deadBark' });
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2, r = 20 + rand() * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 4 || reserved(x, z, 3)) continue;
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.45, 4.5, 7), bark); trunk.position.y = 2.2; trunk.rotation.z = (rand() - 0.5) * 0.3; t.add(trunk);
    for (let b = 0; b < 5; b++) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.14, 2 + rand() * 1.5, 6), bark);
      br.position.set(0, 2.8 + b * 0.35, 0); br.rotation.set((rand() - 0.5) * 1.6, rand() * 6, 0.7 + rand() * 0.6); br.translateY(0.9);
      t.add(br);
    }
    t.position.set(x, heightAt(x, z), z); t.rotation.y = rand() * 6;
    add(shadowAll(t), 0.5);
  }
  // Iron fence around the graveyard's inner court.
  const iron = clay('#2b2833', { roughness: 0.4, key: 'ironFence' });
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.18) continue; // gap toward the arrival portal
    if (Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))) < 0.12) continue; // gap to the mausoleum
    const x = Math.cos(a) * 46, z = Math.sin(a) * 46;
    if (reserved(x, z, 1)) continue;
    const post = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2, 6), iron); bar.position.y = 1; post.add(bar);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 4), iron); tip.position.y = 2.1; post.add(tip);
    const rail = new THREE.Mesh(rbox(6.1, 0.08, 0.08, 0.03), iron); rail.position.y = 1.6; rail.rotation.y = -a + Math.PI / 2; post.add(rail);
    post.position.set(x, heightAt(x, z), z);
    add(post, 0);
  }
  // Floating soul lights.
  const souls = [];
  const soulMat = new THREE.MeshStandardMaterial({ color: '#c9ffd8', emissive: '#5dff8a', emissiveIntensity: 1.6 });
  for (let i = 0; i < 18; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), soulMat);
    const a = rand() * Math.PI * 2, r = 8 + rand() * 40;
    s.userData = { x: Math.cos(a) * r, z: Math.sin(a) * r, ph: rand() * 6 };
    api.scene.add(s); souls.push(s);
  }
  // The burial mounds in front of the stones are gentle humps you walk over.
  const mounds = graves.slice();
  const extraAt = (x, z) => {
    let h = -Infinity;
    for (const m of mounds) {
      const u = (x - m.x) / 0.81, v = (z - m.z) / 1.44, q = 1 - u * u - v * v;
      if (q > 0) h = Math.max(h, m.y + 0.315 * Math.sqrt(q));
    }
    return h;
  };
  return {
    heightAt, colorAt, extraAt,
    sky: { top: '#050d10', horizon: '#1e3a30', glow: '#1a5a38', stars: 1 },
    fog: ['#223a32', 0.016],
    light: { hemi: ['#b8f0d8', '#2a2438', 1.0], sun: ['#d0fff0', 2.2], sunDir: [-0.4, 0.8, -0.5] },
    moon: '#dfffe8',
    enemy: { name: 'Restless Spirit', kind: 'specter', emissive: '#3dff7a', particle: '#8dffb0', cap: 5, interval: 3.5 },
    altarTops: [scalesModel(), ossuaryModel()],
    spawnAt: (pp) => {
      const near = graves.filter((g) => Math.hypot(g.x - pp.x, g.z - pp.z) < 45);
      const g = near[Math.floor(Math.random() * near.length)]; return g ? { x: g.x, z: g.z, rise: true } : null;
    },
    graves,
    ambient(dt, t, fx, player) {
      souls.forEach((s) => { const u = s.userData; s.position.set(u.x + Math.sin(t * 0.3 + u.ph) * 2, heightAt(u.x, u.z) + 1.5 + Math.sin(t + u.ph) * 0.5, u.z + Math.cos(t * 0.25 + u.ph) * 2); });
      // Low ground mist drifting through the stones.
      if (Math.random() < dt * 14) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 40;
        const x = player.pos.x + Math.cos(a) * r, z = player.pos.z + Math.sin(a) * r;
        fx.spawn(x, api.height(x, z) + 0.25, z, 0.4, 0.02, 0.1, new THREE.Color('#1c3a30'), 1.3, 4, 0, 0.1);
      }
    },
  };
}

function scalesModel() {
  const g = new THREE.Group();
  const brass = clay('#c9a86a', { roughness: 0.4, key: 'scaleBrass' });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 8), brass); post.position.y = 0.55;
  const beam = new THREE.Mesh(rbox(1.6, 0.06, 0.06), brass); beam.position.y = 1.1; beam.rotation.z = 0.12;
  g.add(post, beam);
  [-0.75, 0.75].forEach((x, i) => { const pan = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), brass); pan.position.set(x, 0.72 + (i ? -0.09 : 0.09), 0); g.add(pan); });
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), clay('#e8e2d0', { key: 'skull' })); skull.position.set(-0.75, 0.9, 0); g.add(skull);
  return shadowAll(g);
}
function ossuaryModel() {
  const g = new THREE.Group();
  const bone = clay('#e8e2d0', { key: 'skull' });
  const slab = new THREE.Mesh(rbox(1.4, 1.4, 0.2, 0.08), clay('#3a4a40', { key: 'ossSlab' })); slab.position.y = 0.7;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), bone); skull.position.set(0, 0.8, 0.12); skull.scale.z = 0.7;
  g.add(slab, skull);
  [-1, 1].forEach((s) => { const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 1.2, 4, 8), bone); b.rotation.z = s * 0.8; b.position.set(0, 0.7, 0.15); g.add(b); });
  return shadowAll(g);
}

// ---------------------------------------------------------------- Pyromancy: The Ember Caldera
function buildCaldera(rand, add, api) {
  // Lava rivers: winding channels defined analytically so gameplay can query them.
  const rivers = [
    (x) => Math.sin(x * 0.07) * 9 - 6,
    (x) => Math.cos(x * 0.05 + 1) * 12 + 22,
  ];
  const lavaDist = (x, z) => {
    let d = Infinity;
    d = Math.min(d, Math.abs(z - rivers[0](x)) - 2.4);
    if (x < 10) d = Math.min(d, Math.abs(z - rivers[1](x)) - 1.8);
    return d;
  };
  const bridges = [{ x: 0, w: 3.2 }, { x: -24, w: 3 }, { x: 26, w: 3 }];
  const onBridge = (x) => bridges.some((b) => Math.abs(x - b.x) < b.w / 2);
  const lavaAt = (x, z) => lavaDist(x, z) < 0 && !(onBridge(x) && Math.abs(z - rivers[0](x)) < 3);
  const heightAt = (x, z) => {
    const d = Math.hypot(x, z);
    let h = fbm(x * 0.05, z * 0.05, 3) * 1.4;
    const ld = lavaDist(x, z);
    h -= (1 - smoothstep(-2, 1.5, ld)) * 1.2; // channels sink below the rock
    h = lerp(h, -1.5, 1 - smoothstep(-0.6, 0.8, ld)); // …always deep enough for the lava sheet to show
    h = Math.max(h, lerp(-2, -0.3, smoothstep(0.2, 2.2, ld))); // and never dips below it anywhere else
    if (onBridge(x) && Math.abs(z - rivers[0](x)) < 3.2) h = Math.max(h, 0.4);
    h += smoothstep(R - 24, R + 4, d) * 30; // caldera walls
    return lerp(h, 0.2, siteBlend(x, z));
  };
  const colorAt = (c, x, z, h, up) => {
    const n = fbm(x * 0.1, z * 0.1, 2) * 0.5 + 0.5;
    c.set('#4a3a34').lerp(new THREE.Color('#6a4a40'), n * 0.7);
    const ld = lavaDist(x, z);
    c.lerp(new THREE.Color('#7a2e12'), (1 - smoothstep(0, 2.5, ld)) * 0.7); // scorched banks
    c.lerp(new THREE.Color('#1a1414'), smoothstep(0.75, 0.5, up));
  };
  // Lava surface: an animated emissive sheet that shows only in the channels.
  const lavaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 p = vW.xz * 0.35 + vec2(uTime * 0.25, uTime * 0.1);
        float v = n(p) * 0.6 + n(p * 2.3 - uTime * 0.3) * 0.4;
        vec3 c = mix(vec3(0.9, 0.18, 0.02), vec3(1.0, 0.75, 0.2), smoothstep(0.45, 0.85, v));
        c = mix(c, vec3(0.25, 0.05, 0.02), smoothstep(0.35, 0.15, v)); // cooling crust
        gl_FragColor = vec4(c * 1.05, 1.0);
      }`,
  });
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(190, 190), lavaMat);
  lava.rotation.x = -Math.PI / 2; lava.position.y = -0.55;
  api.scene.add(lava);
  // Basalt bridges over the main river.
  const basalt = clay('#5a4a44', { roughness: 0.7, key: 'basalt' });
  bridges.forEach((b) => {
    const z = rivers[0](b.x);
    const br = new THREE.Mesh(rbox(b.w, 0.5, 7, 0.2), basalt); br.position.set(b.x, 0.15, z);
    add(shadowAll(br), 0);
  });
  // Basalt column clusters and obsidian spires.
  const obsidian = new THREE.MeshStandardMaterial({ color: '#1a1022', roughness: 0.15, metalness: 0.3 });
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2, r = 12 + rand() * 38;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (lavaDist(x, z) < 3 || Math.hypot(x - ARRIVE.x, z - ARRIVE.z) < 8 || Math.hypot(x + 22, z + 10) < 7 || Math.hypot(x - 24, z + 18) < 7 || reserved(x, z, 2)) continue;
    const g = new THREE.Group();
    if (rand() < 0.55) {
      for (let k = 0; k < 5; k++) {
        const h = 1 + rand() * 3.5;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, h, 6), basalt);
        col.position.set((rand() - 0.5) * 1.8, h / 2, (rand() - 0.5) * 1.8); g.add(col);
      }
    } else {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.9 + rand(), 5 + rand() * 5, 5), obsidian); sp.position.y = 3; sp.rotation.z = (rand() - 0.5) * 0.3; g.add(sp);
    }
    g.position.set(x, heightAt(x, z), z);
    add(shadowAll(g), 1.3);
  }
  // Ember vents that spit sparks — and occasionally erupt.
  const vents = [];
  for (let i = 0; i < 8; i++) {
    const x = (rand() - 0.5) * 70, z = rivers[0](x) + (rand() < 0.5 ? -1 : 1) * (rand() * 1.5);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 10, 1, true), basalt);
    cone.position.set(x, heightAt(x, z) + 0.2, z);
    add(shadowAll(cone), 0);
    vents.push({ x, z, y: heightAt(x, z) + 0.8, timer: 2 + rand() * 8 });
  }
  const glow = new THREE.PointLight('#ff6a1c', 30, 60, 1.5); glow.position.set(0, 4, -6); api.scene.add(glow);
  return {
    heightAt, colorAt, lavaAt,
    flatAt: (x, z) => 1 - smoothstep(1.5, 12, lavaDist(x, z)),
    sky: { top: '#1a0604', horizon: '#8a2a0a', glow: '#ff5a10', stars: 0.2 },
    fog: ['#4a1c10', 0.016],
    light: { hemi: ['#ffc8a0', '#5a2010', 1.1], sun: ['#ffc890', 2.6], sunDir: [0.5, 0.7, 0.3] },
    enemy: { name: 'Fire Imp', kind: 'imp', emissive: '#ff6a1c', particle: '#ffb347', cap: 6, interval: 2.8 },
    altarTops: [conduitModel(), anvilModel()],
    ambient(dt, t, fx, player) {
      lavaMat.uniforms.uTime.value = t;
      glow.intensity = 26 + Math.sin(t * 1.7) * 6;
      // Embers rising and ash drifting down.
      for (let k = 0; k < 2; k++) if (Math.random() < dt * 25) {
        const x = player.pos.x + (Math.random() - 0.5) * 60, z = player.pos.z + (Math.random() - 0.5) * 60;
        fx.spawn(x, api.height(x, z) + 0.3, z, (Math.random() - 0.5) * 0.4, 1.2 + Math.random(), (Math.random() - 0.5) * 0.4, new THREE.Color(Math.random() < 0.5 ? '#ff8a3c' : '#ffc35a'), 0.2, 3, -0.1, 0.2);
      }
      if (Math.random() < dt * 10) fx.spawn(player.pos.x + (Math.random() - 0.5) * 40, player.pos.y + 12, player.pos.z + (Math.random() - 0.5) * 40, 0.3, -0.8, 0, new THREE.Color('#8a7a74'), 0.25, 8, 0, 0.1);
      // Vent eruptions knock the player back if they stand too close.
      for (const v of vents) {
        v.timer -= dt;
        if (Math.random() < dt * 4) fx.spawn(v.x, v.y, v.z, (Math.random() - 0.5), 2 + Math.random() * 2, (Math.random() - 0.5), new THREE.Color('#ffb347'), 0.3, 1, 3, 0.2);
        if (v.timer <= 0) {
          v.timer = 6 + Math.random() * 8;
          fx.burst(new THREE.Vector3(v.x, v.y + 0.5, v.z), { count: 60, color: '#ff6a1c', speed: 9, size: 0.6, life: 1.2, gravity: 6, up: 6 });
          const d = Math.hypot(player.pos.x - v.x, player.pos.z - v.z);
          if (d < 4) { player.vel.x += (player.pos.x - v.x) / d * 10; player.vel.z += (player.pos.z - v.z) / d * 10; player.vel.y = 7; player.shake = 0.4; api.hazardHit('The vent erupts!'); }
        }
      }
    },
  };
}

function conduitModel() {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.5, 12), clay('#5a4038', { key: 'brazier' })); bowl.position.y = 0.3;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 10), new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ff7a2a', emissiveIntensity: 3 }));
  flame.position.y = 1; flame.userData.flicker = true;
  g.add(bowl, flame);
  return g;
}
function anvilModel() {
  const g = new THREE.Group();
  const iron = clay('#3a3440', { roughness: 0.4, key: 'anvil' });
  const base = new THREE.Mesh(rbox(0.6, 0.5, 0.5), iron); base.position.y = 0.25;
  const top = new THREE.Mesh(rbox(1.2, 0.3, 0.55), iron); top.position.y = 0.6;
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 10), iron); horn.rotation.z = Math.PI / 2; horn.position.set(0.85, 0.62, 0);
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshStandardMaterial({ color: '#ffc35a', emissive: '#ff8a3c', emissiveIntensity: 2.5 })); ember.position.y = 0.9;
  g.add(base, top, horn, ember);
  return shadowAll(g);
}

// ---------------------------------------------------------------- Cryomancy: The Glacial Hollow
function buildGlacier(rand, add, api) {
  const lakes = [{ x: -12, z: 8, r: 16 }, { x: 18, z: -6, r: 11 }, { x: -34, z: -18, r: 8 }];
  const iceAt = (x, z) => lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r);
  const heightAt = (x, z) => {
    const d = Math.hypot(x, z);
    let h = fbm(x * 0.045, z * 0.045, 3) * 2 + 0.6;
    for (const l of lakes) h = lerp(h, 0, 1 - smoothstep(l.r - 1, l.r + 2, Math.hypot(x - l.x, z - l.z)));
    h += smoothstep(R - 24, R + 4, d) * 32;
    return lerp(h, 0.3, siteBlend(x, z));
  };
  const colorAt = (c, x, z, h, up) => {
    const n = fbm(x * 0.08, z * 0.08, 2) * 0.5 + 0.5;
    c.set('#dce8f8').lerp(new THREE.Color('#b4c8e4'), n * 0.7);
    for (const l of lakes) {
      const d = Math.hypot(x - l.x, z - l.z);
      if (d < l.r + 0.5) c.lerp(new THREE.Color('#7fc4e8'), 1 - smoothstep(l.r - 1.5, l.r + 0.5, d)); // clear lake ice
    }
    c.lerp(new THREE.Color('#9fb4cc'), smoothstep(0.8, 0.55, up));
  };
  // Glossy ice overlay on the lakes.
  const iceMat = new THREE.MeshStandardMaterial({ color: '#bfe8ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55 });
  lakes.forEach((l) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(l.r, 48), iceMat);
    m.rotation.x = -Math.PI / 2; m.position.set(l.x, 0.04, l.z); m.receiveShadow = true;
    api.scene.add(m);
  });
  const ice = new THREE.MeshStandardMaterial({ color: '#a8e4ff', emissive: '#3fa8e8', emissiveIntensity: 0.35, roughness: 0.1, transparent: true, opacity: 0.88 });
  const snowPine = clay('#dff0f8', { roughness: 0.7, key: 'snowPine' });
  const pineDark = clay('#2f5a58', { roughness: 0.7, key: 'pineDark' });
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2, r = 14 + rand() * 38;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (iceAt(x, z) || Math.hypot(x - ARRIVE.x, z - ARRIVE.z) < 8 || Math.hypot(x + 22, z + 10) < 7 || Math.hypot(x - 24, z + 18) < 7 || reserved(x, z, 2)) continue;
    const g = new THREE.Group();
    if (rand() < 0.5) {
      // Ice spike cluster.
      for (let k = 0; k < 5; k++) {
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.3 + rand() * 0.5, 2 + rand() * 4, 6), ice);
        s.position.set((rand() - 0.5) * 2, 1.4, (rand() - 0.5) * 2); s.rotation.set((rand() - 0.5) * 0.6, rand() * 3, (rand() - 0.5) * 0.6);
        g.add(s);
      }
    } else {
      // Frosted pine: dark core with snow caps.
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 1.4, 6), clay('#5a4a40', { key: 'pineTrunk' })); trunk.position.y = 0.7; g.add(trunk);
      [[1.9, 1.6], [1.5, 2.7], [1.0, 3.7]].forEach(([rr, y], k) => {
        const tier = new THREE.Mesh(new THREE.ConeGeometry(rr, 1.6, 8), k % 2 ? snowPine : pineDark); tier.position.y = y; g.add(tier);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(rr * 0.8, 0.6, 8), snowPine); cap.position.y = y + 0.55; g.add(cap);
      });
    }
    g.position.set(x, heightAt(x, z), z);
    add(shadowAll(g), 1.1);
  }
  const aurora = new THREE.PointLight('#7affd0', 10, 70, 1.2); aurora.position.set(0, 20, -30); api.scene.add(aurora);
  // Blizzard gusts: every so often a wind front pushes the player sideways.
  let gust = { t: 8, active: 0, dir: new THREE.Vector3() };
  return {
    heightAt, colorAt, iceAt,
    flatAt: (x, z) => Math.max(...lakes.map((l) => 1 - smoothstep(l.r, l.r + 12, Math.hypot(x - l.x, z - l.z)))),
    sky: { top: '#061230', horizon: '#26406e', glow: '#3a7ab0', stars: 1, aurora: 1 },
    fog: ['#8aa4c8', 0.016],
    light: { hemi: ['#cfe8ff', '#4a5a88', 0.8], sun: ['#e8f4ff', 2.2], sunDir: [-0.3, 0.8, 0.6] },
    enemy: { name: 'Frost Wraith', kind: 'wraith', emissive: '#6fd8ff', particle: '#dff6ff', cap: 6, interval: 3 },
    altarTops: [lakeTabletModel(), prismModel()],
    traction: (x, z) => (iceAt(x, z) ? 0.12 : 1),
    blizzard: () => gust.active > 0 || gust.t < 4,
    ambient(dt, t, fx, player) {
      // Snowfall around the player.
      for (let k = 0; k < 3; k++) if (Math.random() < dt * 30) {
        fx.spawn(player.pos.x + (Math.random() - 0.5) * 50, player.pos.y + 14, player.pos.z + (Math.random() - 0.5) * 50, gust.active > 0 ? gust.dir.x * 8 : 0.4, -1.6, gust.active > 0 ? gust.dir.z * 8 : 0.2, new THREE.Color('#ffffff'), 0.22, 8, 0, 0.05);
      }
      gust.t -= dt;
      if (gust.t <= 0 && gust.active <= 0) {
        const a = Math.random() * Math.PI * 2;
        gust.dir.set(Math.cos(a), 0, Math.sin(a)); gust.active = 2.2; gust.t = 10 + Math.random() * 8;
        api.hazardHit('A blizzard gust!', '#dff6ff');
      }
      if (gust.active > 0) {
        gust.active -= dt;
        player.vel.addScaledVector(gust.dir, dt * 16);
        for (let k = 0; k < 4; k++) fx.spawn(player.pos.x - gust.dir.x * 15 + (Math.random() - 0.5) * 20, player.pos.y + Math.random() * 4, player.pos.z - gust.dir.z * 15 + (Math.random() - 0.5) * 20, gust.dir.x * 22, 0, gust.dir.z * 22, new THREE.Color('#ffffff'), 0.3, 1.2, 0, 0);
      }
      aurora.intensity = 8 + Math.sin(t * 0.7) * 4;
    },
  };
}

function lakeTabletModel() {
  const g = new THREE.Group();
  const slab = new THREE.Mesh(rbox(1.3, 1.2, 0.25, 0.08), new THREE.MeshStandardMaterial({ color: '#bfe8ff', emissive: '#3fa8e8', emissiveIntensity: 0.5, roughness: 0.1 }));
  slab.position.y = 0.6; slab.rotation.x = -0.3;
  const stone = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), clay('#3f7fb8', { key: 'runeStone2' })); stone.position.set(0.3, 0.95, 0.2);
  g.add(slab, stone);
  return shadowAll(g);
}
function prismModel() {
  const g = new THREE.Group();
  const prism = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#8fe3ff', emissiveIntensity: 1.2, roughness: 0.05, transparent: true, opacity: 0.85 }));
  prism.scale.y = 1.6; prism.position.y = 1; prism.userData.spin = true;
  g.add(prism);
  return g;
}

// ---------------------------------------------------------------- Realm materials
// Each realm has its own harvestable node, the source of the material its sanctum needs.
const NODE_KIND = { necromancy: 'bones', pyromancy: 'magma', cryomancy: 'rime', geomancy: 'vein' };

function boneNode(rand) {
  const g = new THREE.Group(), bone = clay('#e9e0c8', { roughness: 0.72, key: 'titanBone' });
  const dirt = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), clay('#2a2420', { roughness: 0.95, key: 'pitEarth' }));
  dirt.scale.set(1.1, 0.3, 0.9); g.add(dirt);
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.7 + rand() * 0.5, 4, 8), bone);
    b.position.set((rand() - 0.5) * 1.1, 0.25 + rand() * 0.2, (rand() - 0.5) * 0.9);
    b.rotation.set(Math.PI / 2 + (rand() - 0.5) * 0.6, rand() * 3, (rand() - 0.5) * 0.6); g.add(b);
  }
  const sk = prop('skull_small');
  if (sk) { sk.scale.setScalar(0.24); sk.position.set(0.1, 0.25, 0.1); sk.rotation.set(-0.2, rand() * 6, 0.1); g.add(sk); }
  const wisp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: '#c9ffd8', emissive: '#5dff8a', emissiveIntensity: 2 }));
  wisp.position.y = 1.1; wisp.userData.float = true; wisp.userData.dynamic = true; g.add(wisp);
  return g;
}
function magmaNode(rand) {
  const g = new THREE.Group();
  const geo = new THREE.DodecahedronGeometry(1.0, 1), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const k = 0.85 + ((Math.sin(pos.getX(i) * 5.1) + Math.cos(pos.getZ(i) * 4.3)) * 0.07); pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.8, pos.getZ(i) * k); }
  geo.computeVertexNormals();
  const rock = new THREE.Mesh(geo, clay('#2e2624', { roughness: 0.85, key: 'magmaRock' })); rock.position.y = 0.6; g.add(rock);
  const crack = new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff6a1c', emissiveIntensity: 2.6 });
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2, y = 0.35 + rand() * 0.6;
    const c = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.5 + rand() * 0.4, 0.06, 2, 0.02), crack);
    c.position.set(Math.sin(a) * 0.86, y, Math.cos(a) * 0.86); c.rotation.set(0, a, (rand() - 0.5) * 1.2); g.add(c);
  }
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), crack); top.position.set(0.15, 1.28, 0.1); top.scale.y = 0.4; g.add(top);
  return g;
}
function rimeNode(rand) {
  const g = new THREE.Group();
  const snowM = clay('#f4f9ff', { roughness: 0.85, key: 'snow' });
  const base = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), snowM); base.scale.y = 0.35; g.add(base);
  const m = new THREE.MeshStandardMaterial({ color: '#bfeaff', emissive: '#4fb8ff', emissiveIntensity: 0.7, roughness: 0.08, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const h = 0.8 + rand() * 1.4, r = 0.14 + rand() * 0.14;
    const c = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), new THREE.Vector2(r, h * 0.08), new THREE.Vector2(r, h * 0.72), new THREE.Vector2(0.001, h)], 6), m);
    c.position.set((rand() - 0.5) * 0.8, 0.05, (rand() - 0.5) * 0.8); c.rotation.set((rand() - 0.5) * 0.8, rand() * 3, (rand() - 0.5) * 0.8); g.add(c);
  }
  return g;
}
const NODE_MAKERS = { bones: boneNode, magma: magmaNode, rime: rimeNode, vein: veinNode };
const NODE_FX = { bones: '#e9e0c8', magma: '#ff8a3c', rime: '#bfeaff', vein: '#ffb347' };

// Minimal node manager with the same interface the harvesting code uses in the valley.
class RealmNodes {
  constructor(scene, fx, type, spots, heightAt, rand) {
    this.fx = fx;
    this.nodes = spots.map(({ x, z }) => {
      const group = NODE_MAKERS[type](rand);
      const y = heightAt(x, z);
      group.position.set(x, y, z); group.rotation.y = rand() * Math.PI * 2;
      shadowAll(group);
      mergeStatic(group);
      scene.add(group);
      return { x, z, y, type, def: NODE_TYPES[type], group, alive: true, respawn: 0, grow: 1, shake: 0, radius: 0.7, baseScale: group.scale.clone(), phase: rand() * 6 };
    });
  }
  get colliders() { return this.nodes.filter((n) => n.alive); }
  nearest(p, range) {
    let best = null, bd = range;
    for (const n of this.nodes) {
      if (!n.alive || n.grow < 1) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z) - n.radius * 0.5;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  poke(n) {
    n.shake = 0.35;
    this.fx.burst(new THREE.Vector3(n.x, n.y + 0.8, n.z), { count: 10, color: NODE_FX[n.type], speed: 3, size: 0.28, life: 0.6, gravity: n.type === 'rime' ? 2 : 5 });
  }
  harvest(n) {
    n.alive = false; n.respawn = n.def.respawn;
    this.fx.burst(new THREE.Vector3(n.x, n.y + 1, n.z), { count: 45, color: NODE_FX[n.type], speed: 6, size: 0.45, life: 1.1, gravity: 3, spread: 1.5 });
    const out = {};
    for (const [k, [a, b]] of Object.entries(n.def.yields)) out[k] = a + Math.floor(Math.random() * (b - a + 1));
    return out;
  }
  update(dt, t, pp) {
    for (const n of this.nodes) {
      const g = n.group;
      if (pp && n.alive) { const far = Math.abs(n.x - pp.x) > 95 || Math.abs(n.z - pp.z) > 95; g.visible = !far; if (far) continue; }
      if (!n.alive) {
        if (g.visible) { g.scale.multiplyScalar(Math.exp(-10 * dt)); if (g.scale.x < 0.05) g.visible = false; }
        n.respawn -= dt;
        if (n.respawn <= 0) { n.alive = true; n.grow = 0; g.visible = true; }
        continue;
      }
      if (n.grow < 1) { n.grow = Math.min(1, n.grow + dt * 0.8); g.scale.setScalar(Math.max(0.01, 1 - Math.pow(1 - n.grow, 3))); }
      if (n.shake > 0) { n.shake -= dt; g.rotation.z = Math.sin(t * 60) * n.shake * 0.12; } else g.rotation.z = 0;
      g.children.forEach((c) => { if (c.userData.float) c.position.y = 1.1 + Math.sin(t * 2 + n.phase) * 0.15; });
      if (n.type === 'magma' && Math.random() < dt * 2) this.fx.spawn(n.x, n.y + 1.3, n.z, (Math.random() - 0.5) * 0.3, 1.2, (Math.random() - 0.5) * 0.3, new THREE.Color('#ff8a3c'), 0.2, 1.2, 0, 0.2);
    }
  }
}

// The cornerstone: a lectern bearing the sanctum's glowing blueprint.
function blueprintTexture(color, glyph) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#10243a'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(160,210,255,0.25)'; g.lineWidth = 1;
  for (let i = 0; i <= 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  g.strokeStyle = color; g.lineWidth = 3;
  g.strokeRect(10, 10, 236, 236);
  g.beginPath(); g.moveTo(128, 30); g.lineTo(200, 120); g.lineTo(180, 226); g.lineTo(76, 226); g.lineTo(56, 120); g.closePath(); g.stroke();
  g.beginPath(); g.arc(128, 130, 34, 0, Math.PI * 2); g.stroke();
  g.fillStyle = color; g.font = 'bold 44px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(glyph, 128, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function cornerstoneTop(def) {
  const g = new THREE.Group();
  const plan = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshStandardMaterial({ map: blueprintTexture(def.color, def.glyph), emissive: '#ffffff', emissiveMap: blueprintTexture(def.color, def.glyph), emissiveIntensity: 0.8, side: THREE.DoubleSide }));
  plan.rotation.x = -Math.PI / 2 + 0.5; plan.position.y = 0.15; g.add(plan);
  const holo = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 2 }));
  holo.position.y = 1.1; holo.userData.spin = true; g.add(holo);
  return g;
}

const BUILDERS = { necromancy: buildCrypt, pyromancy: buildCaldera, cryomancy: buildGlacier, geomancy: buildDeep };
const ALTAR_SPOTS = [{ x: -22, z: -10 }, { x: 24, z: -18 }];

// ---------------------------------------------------------------- Realm manager
export class Realms {
  constructor(game) {
    this.game = game;
    this.cache = {};
    this.active = null;
  }

  get(id) { return (this.cache[id] ||= this.build(id)); }

  build(id) {
    const def = SCHOOLS.find((s) => s.id === id);
    const scene = new THREE.Scene();
    const rand = mulberry32(id.length * 131 + 7);
    const colliders = [];
    const api = {
      scene, colliders,
      hazardHit: (msg, color = '#ff8a3c') => this.game.ui.toast(msg, color),
      siteBlend, reserved, game: this.game, aoHide: (o) => this.game.aoHidden.push(o),
    };
    // Static props are gathered into 48 m chunks and merged per material, so a realm the size
    // of the valley costs a few draws per chunk; far chunks are hidden (the fog hides them anyway).
    const chunks = new Map();
    let early = []; // props the realm's own builder places, before the wider land reshapes the ground
    const add = (obj, radius) => {
      if (early) early.push(obj);
      const key = `${Math.floor(obj.position.x / 48)},${Math.floor(obj.position.z / 48)}`;
      let c = chunks.get(key);
      if (!c) { c = new THREE.Group(); c.userData.cx = (Math.floor(obj.position.x / 48) + 0.5) * 48; c.userData.cz = (Math.floor(obj.position.z / 48) + 0.5) * 48; chunks.set(key, c); scene.add(c); }
      c.add(obj);
      if (radius > 0) colliders.push({ x: obj.position.x, z: obj.position.z, radius });
    };
    const before = new Set(scene.children);
    const theme = BUILDERS[id](rand, add, api);
    const direct = scene.children.filter((o) => !before.has(o) && !o.userData.cx);
    // The wider land: hills, landmarks and paths layered over the realm's own terrain.
    const land = new Land(id, theme);
    const baseH = theme.heightAt, baseC = theme.colorAt;
    const landH = (x, z) => land.height(baseH(x, z), x, z);
    // The way home is cut into the ring of cliffs: a level apron in front of it and a slot, as wide
    // as the tunnel, running back into the rock (the tunnel mesh roofs it; see crossings.js).
    const mouthY = landH(ARRIVE.x, ARRIVE.z);
    theme.heightAt = (x, z) => {
      const h = landH(x, z), lx = Math.abs(x - ARRIVE.x), lz = z - MOUTH_Z;
      if (lz < -24 || lz > TUNNEL_LEN + 3 || lx > 16) return h;
      // Level near the mouth, easing back into the land over the last ~14 m.
      const apron = (1 - smoothstep(10, 16, lx)) * smoothstep(-24, -10, lz) * (1 - smoothstep(0.5, 3, lz));
      const slot = lz > -0.5 ? 1 - smoothstep(TUNNEL_HALF, TUNNEL_HALF + 1.4, lx) : 0;
      return lerp(lerp(h, mouthY, apron), mouthY, slot);
    };
    theme.colorAt = (c, x, z, h, up) => { baseC(c, x, z, h, up); land.color(c, x, z, h, up); };
    // The land's hills rise and fall by metres: set the builder's props back down on the ground
    // they now stand on (things standing near the old ground only; roofs, sheets and hanging
    // stalactites stay where they are).
    const box = new THREE.Box3();
    for (const o of [...early, ...direct]) {
      const { x, z } = o.position, b0 = baseH(x, z), dy = theme.heightAt(x, z) - b0;
      if (Math.abs(dy) < 0.02) continue;
      if (o.isLight) { if (o.position.y - b0 < 6) o.position.y += dy; continue; }
      box.setFromObject(o);
      if (box.isEmpty() || box.max.x - box.min.x > 14 || box.max.z - box.min.z > 14) continue;
      if (o.position.y - b0 > -1.2 && o.position.y - b0 < 3.5) o.position.y += dy;
    }
    early = null; // later props are placed on the final ground already
    const baseIce = theme.iceAt, baseTraction = theme.traction;
    if (baseIce || land.def.ice) theme.traction = (x, z) => (baseIce?.(x, z) || land.iceAt(x, z) ? 0.12 : 1);
    api.height = (x, z) => theme.heightAt(x, z);
    const fx = new Particles(scene, 4000);
    scene.add(terrainMesh(theme.heightAt, theme.colorAt));
    const sky = skyDome(theme.sky); sky.userData.noCut = true; scene.add(sky);
    scene.fog = new THREE.FogExp2(theme.fog[0], theme.fog[1]);
    scene.background = new THREE.Color(theme.fog[0]);
    const hemi = new THREE.HemisphereLight(...theme.light.hemi); scene.add(hemi);
    const sun = new THREE.DirectionalLight(...theme.light.sun);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 240 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    const sunDir = new THREE.Vector3(...theme.light.sunDir).normalize();
    if (theme.moon) {
      const moon = new THREE.Mesh(new THREE.CircleGeometry(14, 32), new THREE.MeshBasicMaterial({ color: theme.moon, fog: false }));
      moon.position.copy(sunDir).multiplyScalar(300); moon.lookAt(0, 0, 0); scene.add(moon);
    }
    // The way home: the same mouth you came through in the valley (a mine, a cleft, a cave, a
    // barrow), standing behind where you arrive with its hill around it.
    const exit = realmThreshold(id, def.color, (lx, lz) => theme.heightAt(ARRIVE.x + lx, MOUTH_Z + lz) - mouthY);
    exit.position.set(ARRIVE.x, mouthY, MOUTH_Z);
    scene.add(exit);
    for (const c of exit.userData.cols) colliders.push({ x: ARRIVE.x + c.x, z: ARRIVE.z + 5 + c.z, radius: c.radius });
    // Puzzle altars.
    const stations = [{ kind: 'exit', x: ARRIVE.x, z: ARRIVE.z + 3.5, r: 2.6, label: `${THRESHOLDS[id].title} — back to the valley`, sub: 'Walk on in' }];
    const altars = def.puzzles.map((p, i) => {
      const spot = ALTAR_SPOTS[i];
      const a = altar(def.color, theme.altarTops[i]);
      a.position.set(spot.x, theme.heightAt(spot.x, spot.z), spot.z);
      scene.add(a);
      this.game.aoHidden.push(a.userData.beacon, a.userData.ring);
      colliders.push({ x: spot.x, z: spot.z, radius: 0.9 });
      stations.push({ kind: 'puzzle', puzzle: p, x: spot.x, z: spot.z + 2.2, r: 2.6, label: `Begin — ${p.name}`, sub: def.name + ' trial' });
      return { group: a, puzzle: p };
    });
    land.build({
      scene, rand, add, heightAt: theme.heightAt, fx, color: def.color,
      collide: (x, z, radius) => colliders.push({ x, z, radius }),
      aoHide: (o) => this.game.aoHidden.push(o),
      reserved: (x, z, pad) => reserved(x, z, pad) || (Math.abs(x - ARRIVE.x) < 24 && z > ARRIVE.z - 10) || ALTAR_SPOTS.some((p) => Math.hypot(x - p.x, z - p.z) < 3.5),
      hazardHit: api.hazardHit,
    });
    if (theme.graves) theme.graves.push(...land.ctx.graves);
    for (const c of chunks.values()) mergeStatic(c);
    land.landmarks.forEach((L) => stations.push({ kind: 'echo', landmark: L, x: L.ex, z: L.ez + 0, r: 3.2, label: `Listen to the Echo Stone — ${L.name}`, sub: '' }));
    // The sanctum cornerstone, where this school's "tower" is raised stage by stage.
    const corner = altar(def.color, cornerstoneTop(def));
    corner.position.set(PLANS_POS.x, theme.heightAt(PLANS_POS.x, PLANS_POS.z), PLANS_POS.z);
    scene.add(corner);
    this.game.aoHidden.push(corner.userData.beacon, corner.userData.ring);
    colliders.push({ x: PLANS_POS.x, z: PLANS_POS.z, radius: 0.9 });
    stations.push({ kind: 'sanctum', x: PLANS_POS.x, z: PLANS_POS.z + 2.2, r: 2.8, label: `${SANCTUMS[id].name} — Plans`, sub: '' });
    stations.push({ kind: 'sanctumDoor', x: SANCTUM_SITE.x, z: SANCTUM_SITE.z + SANCTUM_DOOR_Z[id], r: 2.2, label: `Enter ${SANCTUMS[id].name}`, sub: '' });
    const realm = {
      id, def, scene, fx, sky, sun, sunDir, theme, colliders, stations, altars, exit, corner, land, chunks: [...chunks.values()],
      heightAt: null, radius: R, arrive: ARRIVE,
      arena: {
        radius: R - 2,
        height: theme.heightAt,
        safe: (p) => Math.hypot(p.x - ARRIVE.x, p.z - ARRIVE.z) < 9, // the portal is a sanctuary
        spawn: (pp) => {
          const s = theme.spawnAt?.(pp);
          if (s && Math.hypot(s.x - pp.x, s.z - pp.z) > 10) return s;
          const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 20;
          const x = pp.x + Math.cos(a) * r, z = pp.z + Math.sin(a) * r;
          return Math.hypot(x, z) < R - 4 && Math.hypot(x - ARRIVE.x, z - ARRIVE.z) > 12 && siteDist(x, z) > SITE_R - 2 ? { x, z } : null;
        },
        cap: () => theme.enemy.cap, interval: theme.enemy.interval,
        home: ARRIVE,
        // Once the next chapter's gate is open, the Veil frays further here: more Elders.
        movedOn: () => { const i = SCHOOLS.indexOf(def), nx = SCHOOLS[i + 1]; return nx ? this.game.state.schoolUnlocked(nx.id) : this.game.state.sanctumComplete(id); },
        // Soul lanterns along the paths count as light for spirits.
        lightAt: (x, z) => (land.lanternSpots || []).some((l) => Math.abs(l.x - x) < 5 && Math.abs(l.z - z) < 5 && Math.hypot(l.x - x, l.z - z) < 4.5) || this.game.haunts.lightAt(x, z) || !!this.game.boss?.lightAt?.(x, z),
        blizzard: () => !!theme.blizzard?.(),
        lavaNear: (x, z) => {
          let best = null, bd = Infinity;
          for (let r = 2; r <= 30; r += 4) for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
            if (realm.lavaAt(px, pz)) { const d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = { x: px, z: pz }; } }
          }
          return best;
        },
        hauntAt: (x, z) => this.game.haunts?.hauntAt(id, x, z),
      },
    };
    // Walkable sanctum surfaces (causeways, dais tiers, the spiral bridge) raise the ground
    // under the player; they only count if the player could step onto them from their height.
    const baseLava = theme.lavaAt;
    realm.aoHide = (o) => this.game.aoHidden.push(o);
    realm.sanctum = new Sanctum(realm);
    realm.sanctum.setStages(this.game.state.sanctumStage(id));
    // The stone discs under the puzzle altars and the cornerstone are low platforms you step onto.
    const discs = [...altars.map((a) => a.group), corner].map((g) => ({ x: g.position.x, z: g.position.z, y: g.position.y + 0.4 }));
    const discAt = (x, z) => { let h = -Infinity; for (const d of discs) if (Math.hypot(x - d.x, z - d.z) < 2.75) h = Math.max(h, d.y); return h; };
    const exitY = exit.position.y, themeExtra = theme.extraAt || (() => -Infinity);
    const extraAt = (x, z) => Math.max(themeExtra(x, z), exitY + exit.userData.surfaceAt(x - ARRIVE.x, z - ARRIVE.z - 5));
    realm.solidAt = (x, z) => Math.max(land.surfaceAt(x, z), realm.sanctum.solidAt(x, z), discAt(x, z));
    realm.heightAt = (x, z) => Math.max(theme.heightAt(x, z), land.surfaceAt(x, z), discAt(x, z), extraAt(x, z), realm.sanctum.surfaceAt(x, z, this.game.player.pos.y), this.game.magic.pillarAt(x, z, this.game.player.pos.y));
    realm.lavaAt = (x, z) => (!!baseLava?.(x, z) && !land.onBridge(x, z)) || land.lavaAt(x, z) || realm.sanctum.lavaAt(x, z);
    realm.slowAt = (x, z) => land.slowAt(x, z);
    // Harvest nodes scattered clear of the portal, altars, hazards and the sanctum site.
    const spots = [];
    const want = (i) => (i < 16 ? 10 + rand() * 40 : 50 + Math.sqrt(rand()) * (R - 70));
    for (let tries = 0; spots.length < 84 && tries < 6000; tries++) {
      let x, z;
      if (spots.length >= 64) { const L = land.landmarks[spots.length % 4], a = rand() * Math.PI * 2, r = L.r + 3 + rand() * 10; x = L.x + Math.cos(a) * r; z = L.z + Math.sin(a) * r; }
      else { const a = rand() * Math.PI * 2, r = want(spots.length); x = Math.cos(a) * r; z = Math.sin(a) * r; }
      if (Math.hypot(x, z) > R - 26) continue;
      if (reserved(x, z, 3) || (Math.abs(x - ARRIVE.x) < 24 && z > ARRIVE.z - 16) || land.hazard(x, z) || land.pathDist(x, z) < 3) continue;
      if (theme.lavaAt && [0, 1.5, -1.5, 3, -3].some((d) => theme.lavaAt(x + d, z) || theme.lavaAt(x, z + d))) continue;
      if (ALTAR_SPOTS.some((p) => Math.hypot(x - p.x, z - p.z) < 6)) continue;
      if ([...colliders, ...spots].some((c) => Math.hypot(c.x - x, c.z - z) < (c.radius || 2) + 2.2)) continue;
      spots.push({ x, z });
    }
    realm.nodes = new RealmNodes(scene, fx, NODE_KIND[id], spots, theme.heightAt, rand);
    realm.mapBase = this.bakeMap(theme);
    realm.arena.spawnOk = (x, z) => siteDist(x, z) > SITE_R - 2;
    this.game.aoHidden.push(sky);
    return realm;
  }

  // The realm's minimap image, baked once from its own terrain colours with slope shading.
  bakeMap(theme) {
    const N = 200, span = 400, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), col = new THREE.Color();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * span, z = (j / N - 0.5) * span, h = theme.heightAt(x, z);
      theme.colorAt(col, x, z, h, 1);
      if (theme.lavaAt?.(x, z)) col.set('#ff6a1c');
      const shade = Math.max(0.55, Math.min(1.35, 1 + (h - theme.heightAt(x + 2, z - 2)) * 0.12));
      const k = (j * N + i) * 4;
      img.data[k] = Math.min(255, Math.pow(col.r, 1 / 2.2) * 255 * shade); img.data[k + 1] = Math.min(255, Math.pow(col.g, 1 / 2.2) * 255 * shade);
      img.data[k + 2] = Math.min(255, Math.pow(col.b, 1 / 2.2) * 255 * shade); img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  nearest(p) {
    let best = null, bd = Infinity;
    for (const s of this.active.stations) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < s.r && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // indoors: the player is inside the sanctum — the realm keeps living but its weather and
  // hazards (gusts, vents) must not reach them.
  update(dt, t, player, indoors = false) {
    const r = this.active;
    if (!r) return;
    r.sky.material.uniforms.uTime.value = t;
    r.sky.position.copy(player.pos);
    r.sun.position.copy(player.pos).addScaledVector(r.sunDir, 90);
    r.sun.target.position.copy(player.pos);
    const solved = this.game.state.school(r.id).puzzles;
    r.altars.forEach((a) => {
      const done = solved.includes(a.puzzle.id);
      a.group.userData.ring.rotation.z += dt * (done ? 0.6 : 0.2);
      a.group.userData.beacon.material.opacity = done ? 0.05 : 0.12 + Math.sin(t * 2) * 0.05;
      a.group.traverse((o) => { if (o.userData.flicker) o.scale.y = 0.85 + Math.random() * 0.3; if (o.userData.spin) o.rotation.y += dt; });
    });
    r.corner.userData.ring.rotation.z += dt * 0.4;
    r.corner.traverse((o) => { if (o.userData.spin) { o.rotation.y += dt * 1.5; o.position.y = 1.1 + Math.sin(t * 2) * 0.1; } });
    r.sanctum.update(dt, t, player);
    r.nodes.update(dt, t, player.pos);
    if (!indoors) r.land.tick(dt, t, player, r.fx);
    // Distance culling: beyond ~120 m the fog has swallowed everything anyway.
    this.cullT = (this.cullT || 0) - dt;
    if (this.cullT <= 0) {
      this.cullT = 0.25;
      for (const c of r.chunks) c.visible = Math.hypot(c.userData.cx - player.pos.x, c.userData.cz - player.pos.z) < 125;
    }
    if (!indoors) r.theme.ambient(dt, t, r.fx, player);
    r.fx.update(dt);
  }
}

// ---------------------------------------------------------------- Gate circle in the valley
// Portal arches just north of the tower courtyard, one per school, facing the tower.
export class Gates {
  constructor(scene, heightAt, gatePos) {
    this.list = [];
    this.colliders = [];
    // Four arches in a shallow arc, in story order from west to east.
    const offsets = [[-13.5, 3.2], [-4.6, -0.8], [4.6, -0.8], [13.5, 3.2]];
    // A flagstone plaza under the gates.
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(19, 56), clay('#b8ab94', { roughness: 0.8, key: 'plaza' }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(gatePos.x, heightAt(gatePos.x, gatePos.z) + 0.04, gatePos.z + 1);
    plaza.receiveShadow = true;
    scene.add(plaza);
    SCHOOLS.forEach((def, i) => {
      const x = gatePos.x + offsets[i][0], z = gatePos.z + offsets[i][1];
      const arch = portalArch(def.color, '#a89cb4');
      arch.position.set(x, heightAt(x, z), z);
      arch.rotation.y = Math.atan2(-x, -z); // face the tower
      scene.add(arch);
      // Pillar colliders sit either side of the archway.
      const side = new THREE.Vector3(Math.cos(arch.rotation.y), 0, -Math.sin(arch.rotation.y));
      [-1.9, 1.9].forEach((o) => this.colliders.push({ x: x + side.x * o, z: z + side.z * o, radius: 0.6 }));
      const front = new THREE.Vector3(Math.sin(arch.rotation.y), 0, Math.cos(arch.rotation.y));
      this.list.push({ def, arch, x, z, front: { x: x + front.x * 2.2, z: z + front.z * 2.2 }, facing: arch.rotation.y });
    });
  }

  nearest(p, range = 3) {
    let best = null, bd = range;
    for (const g of this.list) {
      const d = Math.hypot(g.front.x - p.x, g.front.z - p.z);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }

  update(dt, t, state) {
    for (const g of this.list) {
      const open = state.schoolUnlocked(g.def.id);
      const u = g.arch.userData;
      u.swirl.material.uniforms.uTime.value = t;
      u.swirl.material.uniforms.uPower.value = open ? 1 : 0.18;
      u.light.intensity = open ? 6 : 0.8;
      u.key.rotation.y += dt * (open ? 1.2 : 0.2);
    }
  }
}
