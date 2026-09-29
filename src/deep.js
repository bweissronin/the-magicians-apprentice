import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clay } from './style.js';
import { fbm, smoothstep, lerp } from './util.js';
import { prop } from './assets.js';

// ================================================================ Geomancy: The Sundered Deep
// A mountain hollowed into a cavern as wide as the valley. Instead of sky, a vaulted stone roof
// hung with stalactites and threaded with glowing heartstone veins; a skylight shaft over the
// hub; an underground river; light from crystals, fungi and miners' lanterns. Its hazard is the
// tremor: dust trickles from the roof, then a stalactite falls on the marked circle.
//
// This module is self-contained (no imports from realms.js / realmlands.js) so both can use it:
//   buildDeep(rand, add, api) → the realm theme          (realms.js BUILDERS)
//   DEEP                      → the wider land + life     (realmlands.js LANDS)
//   veinNode(rand)            → the Heartstone harvest node

const R = 180;               // = WORLD_R
const TAU = Math.PI * 2;
const rbox = (w, h, d, r = 0.1) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
const M = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const glowM = (c, i = 2) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i });
const shadowAll = (o) => { o.traverse((m) => { if (m.isMesh && !(m.material.emissiveIntensity > 1) && !m.material.transparent) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
const crystalGeo = (r, h, sides = 6) => new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), new THREE.Vector2(r, h * 0.08), new THREE.Vector2(r, h * 0.7), new THREE.Vector2(0.001, h)], sides);
const blender = (name, s = 1) => { const p = prop(name); if (p) p.scale.setScalar(s); return p; };

// The underground river winds down the eastern cavern, north to south.
export const riverX = (z) => 64 + Math.sin(z * 0.028) * 20 + z * 0.12;
export const riverDist = (x, z) => Math.abs(x - riverX(z)) - 3.4;
// The vaulted roof: highest over the hub, lower toward the walls.
export const roofAt = (x, z) => { const d = Math.hypot(x, z); return 46 - Math.pow(d / 190, 2) * 18 + fbm(x * 0.02 + 4, z * 0.02 - 2, 3) * 5; };
const SKY = { x: 16, z: -4 }; // skylight in the roof above the hub

// ---------------------------------------------------------------- cavern roof
function roofMesh() {
  const size = 440, seg = 110, geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(Math.PI / 2); // faces down
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), glow = new Float32Array(pos.count), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = roofAt(x, z);
    // The skylight: a ragged hole over the hub.
    const sd = Math.hypot(x - SKY.x, z - SKY.z);
    if (sd < 9 + fbm(x * 0.3, z * 0.3, 2) * 3) y += 30;
    pos.setY(i, y);
    const n = fbm(x * 0.05, z * 0.05, 3);
    c.set('#2e241e').lerp(new THREE.Color('#4a3a2e'), n * 0.5 + 0.5);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    // Heartstone veins: thin glowing seams across the vault.
    const v = Math.abs(Math.sin(fbm(x * 0.012 + 9, z * 0.012, 3) * 9));
    glow[i] = smoothstep(0.1, 0.0, v) * (0.6 + 0.4 * Math.sin(x * 0.2 + z * 0.13));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * vec3(1.0, 0.55, 0.16) * 2.2;');
  };
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

// Stalactites hang from the vault; one instanced draw for hundreds.
function stalactites(rand) {
  let geo = null, mat = null;
  prop('stalactite')?.traverse((o) => { if (o.isMesh && !geo) { geo = o.geometry; mat = o.material; } });
  geo ||= new THREE.ConeGeometry(0.9, 5, 7, 3).rotateX(Math.PI).translate(0, -2.5, 0);
  mat ||= clay('#b8a48a', { roughness: 0.8, key: 'dripstone' });
  const N = 320, im = new THREE.InstancedMesh(geo, mat, N), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let n = 0;
  for (let i = 0; i < N * 3 && n < N; i++) {
    const a = rand() * TAU, r = Math.sqrt(rand()) * (R - 10), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - SKY.x, z - SKY.z) < 14) continue;
    const s = 0.5 + rand() * rand() * 2.4;
    m4.compose(new THREE.Vector3(x, roofAt(x, z) + 0.5, z), q.setFromEuler(e.set((rand() - 0.5) * 0.15, rand() * TAU, (rand() - 0.5) * 0.15)), new THREE.Vector3(s, s * (0.8 + rand() * 0.8), s));
    im.setMatrixAt(n++, m4);
  }
  im.count = n;
  im.castShadow = false; im.receiveShadow = true;
  return im;
}

// ---------------------------------------------------------------- small models
function crystalCluster(rand, color, n = 6, s = 1) {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.15, flatShading: true });
  for (let k = 0; k < n; k++) {
    const c = M(crystalGeo((0.18 + rand() * 0.22) * s, (0.8 + rand() * 1.8) * s), m, (rand() - 0.5) * 1.1 * s, 0, (rand() - 0.5) * 1.1 * s);
    c.rotation.set((rand() - 0.5) * 0.9, rand() * 3, (rand() - 0.5) * 0.9); g.add(c);
  }
  g.add(M(new THREE.DodecahedronGeometry(0.6 * s, 0), clay('#4a3a30', { roughness: 0.9, key: 'veinRock' }), 0, 0.1, 0));
  return g;
}
function mushroom(rand, s = 1) {
  const big = blender('giant_mushroom', s * 0.34);
  if (big) { big.rotation.y = rand() * TAU; return big; }
  const g = new THREE.Group();
  const stem = M(new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 2.6 * s, 8), clay('#d8d0c0', { key: 'fungusStem' }), 0, 1.3 * s, 0); g.add(stem);
  const cap = M(new THREE.SphereGeometry(1.1 * s, 16, 8, 0, TAU, 0, Math.PI / 2), clay('#3a7a8a', { key: 'fungusCap' }), 0, 2.5 * s, 0); cap.scale.y = 0.5; g.add(cap);
  const gill = M(new THREE.CircleGeometry(1.05 * s, 16), glowM('#2fd8e8', 1.6), 0, 2.49 * s, 0); gill.rotation.x = Math.PI / 2; g.add(gill);
  return g;
}
function rockPile(rand, rock) {
  const g = new THREE.Group();
  for (let k = 0; k < 7; k++) {
    const r = M(new THREE.DodecahedronGeometry(0.35 + rand() * 0.45, 0), rock, (rand() - 0.5) * 1.8, 0.2 + rand() * 0.4, (rand() - 0.5) * 1.8);
    r.rotation.set(rand() * 3, rand() * 3, rand() * 3); g.add(r);
  }
  return g;
}
function minerLantern() {
  const l = new THREE.Group(), wood = clay('#6a4a2c', { key: 'mineWood' });
  l.add(M(rbox(0.22, 2.2, 0.22, 0.05), wood, 0, 1.1, 0));
  l.add(M(rbox(0.9, 0.14, 0.14, 0.04), wood, 0.35, 2.15, 0));
  const lamp = M(new THREE.CylinderGeometry(0.16, 0.2, 0.36, 8), glowM('#ffc46a', 2.4), 0.72, 1.9, 0); l.add(lamp);
  l.add(M(new THREE.ConeGeometry(0.22, 0.18, 8), clay('#3a3640', { metalness: 0.5, key: 'lampTin' }), 0.72, 2.12, 0));
  return l;
}
export function boulderAltarModel() {
  const g = new THREE.Group(), plate = glowM('#ffb347', 1.4), rock = clay('#8a6a4a', { roughness: 0.85, key: 'golemRock' });
  const base = M(rbox(1.3, 0.12, 1.3, 0.04), clay('#5a4a40', { key: 'veinRock2' }), 0, 0.06, 0); g.add(base);
  [[-0.35, -0.35], [0.35, 0.35]].forEach(([x, z]) => g.add(M(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 16), plate, x, 0.14, z)));
  [[0.35, -0.35], [-0.35, 0.3]].forEach(([x, z], i) => g.add(M(new THREE.DodecahedronGeometry(0.2 + i * 0.03, 1), rock, x, 0.34, z)));
  return shadowAll(g);
}
export function strataAltarModel() {
  const g = new THREE.Group(), cols = ['#8a6a4a', '#a88a64', '#6a5a4a', '#9a7a58'];
  cols.forEach((c, i) => { const s = M(rbox(1.2, 0.22, 0.4, 0.04), clay(c, { key: 'strata' + i }), (i % 2 ? 0.12 : -0.1), 0.15 + i * 0.24, 0); g.add(s); });
  const vein = M(rbox(0.07, 0.95, 0.42, 0.02), glowM('#ffb347', 2.4), 0.05, 0.5, 0.01); vein.rotation.z = 0.12; g.add(vein);
  return shadowAll(g);
}

// The Heartstone harvest node: a rock outcrop bursting with amber crystal.
export function veinNode(rand) {
  const b = blender('heartstone_cluster', 0.85 + rand() * 0.3);
  if (b) return b;
  const g = new THREE.Group();
  const geo = new THREE.DodecahedronGeometry(0.9, 1);
  const rock = M(geo, clay('#5a4a44', { roughness: 0.9, key: 'veinRock' }), 0, 0.45, 0); rock.scale.set(1.2, 0.7, 1); g.add(rock);
  const m = new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff8a1a', emissiveIntensity: 2.2, roughness: 0.2, flatShading: true });
  for (let k = 0; k < 7; k++) {
    const c = M(crystalGeo(0.12 + rand() * 0.12, 0.6 + rand() * 0.9), m, (rand() - 0.5) * 1.2, 0.5 + rand() * 0.3, (rand() - 0.5) * 0.9);
    c.rotation.set((rand() - 0.5) * 1.2, rand() * 3, (rand() - 0.5) * 1.2); g.add(c);
  }
  return g;
}

// ---------------------------------------------------------------- the realm theme
// api: { scene, colliders, hazardHit, siteBlend, reserved, game }
export function buildDeep(rand, add, api) {
  const heightAt = (x, z) => {
    const d = Math.hypot(x, z);
    let h = fbm(x * 0.035, z * 0.035, 3) * 1.6 + Math.max(0, fbm(x * 0.09 + 3, z * 0.09, 2)) * 1.2;
    const rd = riverDist(x, z);
    h = lerp(h, -1.6, 1 - smoothstep(-1.2, 2.5, rd));           // the river channel
    h += smoothstep(R - 26, R + 2, d) * 36;                      // cavern walls rise into the vault
    return lerp(h, 0, api.siteBlend(x, z));
  };
  const colorAt = (c, x, z, h, up) => {
    const n = fbm(x * 0.07, z * 0.07, 2) * 0.5 + 0.5;
    c.set('#5a4636').lerp(new THREE.Color('#7a5e44'), n * 0.6);
    const rd = riverDist(x, z);
    c.lerp(new THREE.Color('#2a2622'), (1 - smoothstep(0, 3, rd)) * 0.7);      // wet banks
    c.lerp(new THREE.Color('#2f5a52'), smoothstep(0.35, 0.6, fbm(x * 0.03 - 7, z * 0.03 + 2, 2)) * 0.4); // glow-moss
    c.lerp(new THREE.Color('#332820'), smoothstep(0.78, 0.5, up));
  };
  // River water: a dark, faintly luminous ribbon laid along the channel.
  const wv = [], wi = [];
  for (let i = 0; i <= 160; i++) {
    const z = -200 + i * 2.5, x = riverX(z);
    wv.push(x - 5, -0.75, z, x + 5, -0.75, z);
    if (i < 160) wi.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const wgeo = new THREE.BufferGeometry(); wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wv, 3)); wgeo.setIndex(wi); wgeo.computeVertexNormals();
  const water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: '#1e4a52', emissive: '#0f3a44', emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.82, side: THREE.DoubleSide }));
  api.scene.add(water); api.aoHide?.(water);
  // Roof, stalactites, skylight.
  const roof = roofMesh(); api.scene.add(roof);
  api.scene.add(stalactites(rand));
  // A soft god-ray: brightest where you look straight through it, fading to nothing at its rim and toward the floor.
  // vF is clamped before pow(): at the silhouette it interpolates to a hair below zero, pow() returns NaN on
  // Metal, and bloom smears a single NaN pixel into large black blocks.
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying float vF; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vec3 n = normalize(normalMatrix * normal); vF = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uTime; varying vec2 vUv; varying float vF; void main(){ float a = pow(clamp(vF, 1e-4, 1.0), 2.5) * smoothstep(0.0, 0.35, vUv.y) * (0.8 + 0.2 * sin(vUv.x * 40.0 + uTime * 0.6)); gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * a * 0.22, a * 0.22); }',
  });
  const shaft = M(new THREE.CylinderGeometry(7, 11, 60, 32, 1, true), shaftMat, SKY.x, 28, SKY.z);
  api.scene.add(shaft); api.aoHide?.(shaft);
  const skyDisc = M(new THREE.CircleGeometry(14, 32), new THREE.MeshBasicMaterial({ color: '#fff6dc', fog: false }), SKY.x, roofAt(SKY.x, SKY.z) + 26, SKY.z);
  skyDisc.rotation.x = Math.PI / 2; api.scene.add(skyDisc);
  // Rock piles that golems rise from, and stalagmites.
  const rock = clay('#6e5a48', { roughness: 0.9, key: 'deepRock' });
  const piles = [];
  for (let i = 0; i < 140; i++) {
    const a = rand() * TAU, r = 16 + Math.sqrt(rand()) * (R - 46), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (api.reserved(x, z, 3) || riverDist(x, z) < 3 || Math.hypot(x, z - 45) < 10) continue;
    const p = rockPile(rand, rock); p.position.set(x, heightAt(x, z), z); p.rotation.y = rand() * 6;
    add(shadowAll(p), 0);
    piles.push({ x, z });
  }
  const mite = clay('#b8a48a', { roughness: 0.8, key: 'dripstone' });
  for (let i = 0; i < 110; i++) {
    const a = rand() * TAU, r = 24 + Math.sqrt(rand()) * (R - 50), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (api.reserved(x, z, 4) || riverDist(x, z) < 2) continue;
    const s = 0.5 + rand() * 1.4;
    const st = blender('stalagmite', s) || M(new THREE.ConeGeometry(0.8 * s, 3.5 * s, 7), mite, 0, 1.6 * s, 0);
    const g = new THREE.Group(); g.add(st); g.position.set(x, heightAt(x, z) - 0.2, z); g.rotation.y = rand() * 6;
    add(shadowAll(g), s > 1 ? 0.8 * s : 0);
  }
  // Crystal clusters with a handful of real lights; the rest glow on their own.
  let lights = 0;
  for (let i = 0; i < 46; i++) {
    const a = rand() * TAU, r = 20 + Math.sqrt(rand()) * (R - 50), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (api.reserved(x, z, 3) || riverDist(x, z) < 2) continue;
    const col = rand() < 0.55 ? '#ffb347' : '#b48cff';
    const c = crystalCluster(rand, col, 5 + Math.floor(rand() * 5), 0.8 + rand() * 1.2);
    c.position.set(x, heightAt(x, z), z); add(shadowAll(c), 0.8);
    if (lights < 10 && rand() < 0.35) { const l = new THREE.PointLight(col, 14, 26, 1.6); l.position.set(x, heightAt(x, z) + 2.5, z); api.scene.add(l); lights++; }
  }
  // A few glowing mushrooms around the hub so the heart of the cavern reads warm and teal.
  for (let i = 0; i < 14; i++) {
    const a = rand() * TAU, r = 22 + rand() * 26, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (api.reserved(x, z, 3) || riverDist(x, z) < 3 || Math.abs(x) < 4) continue;
    const m = mushroom(rand, 0.6 + rand() * 0.8); m.position.set(x, heightAt(x, z), z); add(shadowAll(m), 0.5);
  }
  const hubLight = new THREE.PointLight('#ffd9a0', 30, 60, 1.4); hubLight.position.set(SKY.x, 18, SKY.z); api.scene.add(hubLight);

  // ------------------------------------------------------------- tremors
  const warnMat = new THREE.MeshBasicMaterial({ color: '#ff9a3c', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = M(new THREE.RingGeometry(2.6, 3.2, 40), warnMat); ring.rotation.x = -Math.PI / 2; ring.visible = false; api.scene.add(ring); api.aoHide?.(ring);
  const fill = M(new THREE.CircleGeometry(3.2, 40), new THREE.MeshBasicMaterial({ color: '#ff6a1c', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })); fill.rotation.x = -Math.PI / 2; fill.visible = false; api.scene.add(fill); api.aoHide?.(fill);
  const fallGeo = new THREE.ConeGeometry(1.1, 5.5, 7, 2).rotateX(Math.PI);
  const falling = M(fallGeo, mite); falling.visible = false; falling.castShadow = true; api.scene.add(falling);
  const tremor = { t: 14, phase: 'idle', x: 0, z: 0, y: 0, k: 0, told: 0 };
  const TREMOR_R = 3.2;
  const dust = new THREE.Color('#b8a48a');
  function tremorTick(dt, t, fx, player) {
    const game = api.game, s = game.state, stage = s.sanctumStage('geomancy');
    if (stage >= 5) { ring.visible = fill.visible = falling.visible = false; return; } // the Colossus holds the roof
    tremor.t -= dt * (theme.tremorBoost || 1);
    if (tremor.phase === 'idle' && tremor.t <= 0 && !game.cinematic && game.mode === 'play') {
      // Target where the player is heading, so standing still is not safe either.
      const v = player.vel, ahead = Math.min(3, Math.hypot(v.x, v.z) * 0.6);
      const dir = Math.atan2(v.x, v.z);
      tremor.x = player.pos.x + (ahead ? Math.sin(dir) * ahead : (Math.random() - 0.5) * 2);
      tremor.z = player.pos.z + (ahead ? Math.cos(dir) * ahead : (Math.random() - 0.5) * 2);
      tremor.y = heightAt(tremor.x, tremor.z);
      tremor.phase = 'warn'; tremor.k = 0;
      ring.position.set(tremor.x, tremor.y + 0.12, tremor.z); fill.position.copy(ring.position);
      ring.visible = fill.visible = true;
      player.shake = Math.max(player.shake, 0.35);
      game.audio.play('quarry');
      if (tremor.told++ < 3) api.hazardHit('The ground trembles — dust falls from the roof. Move!', '#ffb347');
    }
    if (tremor.phase === 'warn') {
      tremor.k += dt;
      warnMat.opacity = 0.35 + 0.3 * Math.abs(Math.sin(t * 10));
      player.shake = Math.max(player.shake, 0.08);
      const ry = roofAt(tremor.x, tremor.z);
      for (let k = 0; k < 3; k++) if (Math.random() < dt * 40) fx.spawn(tremor.x + (Math.random() - 0.5) * 4, ry - 1, tremor.z + (Math.random() - 0.5) * 4, 0, -6, 0, dust, 0.35, 5, 3, 0.3);
      if (tremor.k > 2.6) { tremor.phase = 'fall'; tremor.k = 0; falling.visible = true; falling.position.set(tremor.x, ry - 3, tremor.z); falling.rotation.y = Math.random() * 6; }
    }
    if (tremor.phase === 'fall') {
      tremor.k += dt;
      const ry = roofAt(tremor.x, tremor.z), e = Math.min(1, tremor.k / 0.55);
      falling.position.y = lerp(ry - 3, tremor.y + 2.2, e * e);
      if (e >= 1) {
        tremor.phase = 'idle'; ring.visible = fill.visible = falling.visible = false;
        fx.burst(new THREE.Vector3(tremor.x, tremor.y + 1, tremor.z), { count: 140, color: '#b8a48a', speed: 11, size: 0.9, life: 1.4, gravity: 10 });
        fx.ring(new THREE.Vector3(tremor.x, tremor.y + 0.3, tremor.z), { count: 80, color: '#8a6e50', speed: 10, size: 0.8, life: 0.8 });
        game.audio.play('impact');
        // Earthen Stair pillars and the Heartstone Hold's arches give cover.
        const covered = game.magic.pillars.some((p) => Math.hypot(p.x - tremor.x, p.z - tremor.z) < TREMOR_R + 0.5);
        const d = Math.hypot(player.pos.x - tremor.x, player.pos.z - tremor.z);
        if (covered) api.hazardHit('The stone pillar shields you!', '#dca468');
        else if (d < TREMOR_R && !game.inside) {
          const dmg = (s.hasBoon('geomancy') ? 0.5 : 1) * 28;
          s.mana = Math.max(0, s.mana - dmg);
          const away = new THREE.Vector3(player.pos.x - tremor.x, 0, player.pos.z - tremor.z);
          if (away.lengthSq() < 0.01) away.set(1, 0, 0);
          away.setLength(10); player.vel.x += away.x; player.vel.z += away.z; player.vel.y = 6;
          player.shake = 0.9;
          api.hazardHit(`A stalactite crashes down! −${Math.round(dmg)} mana`, '#ff9a3c');
        } else player.shake = Math.max(player.shake, 0.45);
        // Creatures caught under it are struck by the mountain itself.
        for (const w of [...game.magic.wisps]) if (!w.dying && Math.hypot(w.mesh.position.x - tremor.x, w.mesh.position.z - tremor.z) < TREMOR_R) game.magic.hitWisp(w, 2, 'earth');
        // The Hold steadies the ground: each stage makes tremors rarer.
        tremor.t = 24 + stage * 12 + Math.random() * 10;
      }
    }
  }

  const spores = new THREE.Color('#7ff5ff'), mote = new THREE.Color('#ffd9a0');
  const theme = {
    heightAt, colorAt,
    flatAt: (x, z) => 1 - smoothstep(0, 6, riverDist(x, z)),
    sky: { top: '#0c0806', horizon: '#1a120c', glow: '#2a1a0c', stars: 0 },
    fog: ['#1c1612', 0.0145],
    light: { hemi: ['#ffd9b0', '#1a2e2c', 0.75], sun: ['#ffe6c0', 1.5], sunDir: [0.22, 1, 0.12] },
    enemy: { name: 'Crag Golem', kind: 'golem', emissive: '#ffb347', particle: '#b89a74', cap: 4, interval: 6 },
    altarTops: [boulderAltarModel(), strataAltarModel()],
    slowMsg: 'The cold river drags at your robes',
    spawnAt: (pp) => {
      const near = piles.filter((p) => { const d = Math.hypot(p.x - pp.x, p.z - pp.z); return d > 12 && d < 45; });
      const p = near[Math.floor(Math.random() * near.length)];
      return p ? { x: p.x, z: p.z, rise: true } : null;
    },
    piles,
    roofAt,
    ambient(dt, t, fx, player) {
      // Dust motes drifting in the skylight; spores near the glow-moss; drips from the vault.
      if (Math.random() < dt * 10) fx.spawn(SKY.x + (Math.random() - 0.5) * 16, 4 + Math.random() * 30, SKY.z + (Math.random() - 0.5) * 16, 0.1, -0.2, 0.05, mote, 0.18, 6, 0, 0.02);
      if (Math.random() < dt * 12) { const a = Math.random() * TAU, r = Math.random() * 30; fx.spawn(player.pos.x + Math.cos(a) * r, heightAt(player.pos.x + Math.cos(a) * r, player.pos.z + Math.sin(a) * r) + 0.5 + Math.random() * 2, player.pos.z + Math.sin(a) * r, 0, 0.25, 0, spores, 0.16, 4, 0, 0.05); }
      if (Math.random() < dt * 6) { const x = player.pos.x + (Math.random() - 0.5) * 40, z = player.pos.z + (Math.random() - 0.5) * 40; fx.spawn(x, roofAt(x, z) - 2, z, 0, -2, 0, spores, 0.12, 4, 10, 0); }
      water.material.emissiveIntensity = 0.5 + Math.sin(t * 0.8) * 0.15;
      shaftMat.uniforms.uTime.value = t;
      tremorTick(dt, t, fx, player);
    },
  };
  return theme;
}

// ================================================================ the wider land
// Four landmarks out in the dark, joined to the hub by miners' roads.
export const DEEP = {
  landmarks: [
    { id: 'geode', name: 'The Great Geode', x: 118, z: -64, r: 20, echoR: 16,
      lore: 'Veyra split the geode to see what the mountain was dreaming. It was dreaming of her, and it has not stopped.' },
    { id: 'mine', name: 'The Flooded Mine', x: -112, z: -58, r: 26, echoR: 30,
      lore: 'The miners dug for heartstone until the river found them. Their lamps still burn below the water, waiting for a shift that never ends.' },
    { id: 'cathedral', name: 'The Fungal Cathedral', x: -86, z: 102, r: 28, echoR: 0,
      lore: 'Aldric came here to think. "The mushrooms," he wrote, "have no opinions about me. It is very restful."' },
    { id: 'colossus', name: 'The Sleeping Colossus', x: 28, z: 146, r: 26, echoR: 30,
      lore: 'Her first binding: a whole mountain given a face and told to sleep. It obeyed. Some nights you can hear it breathing.' },
  ],
  pathColor: '#8a7058', pathEdge: '#6a5442', patches: ['#6a5040', '#4a3a30', '#2f5a52', '#3a2e26'],
  bridgeOver: (x, z) => riverDist(x, z) < 0.5,
  bridgeColor: '#7a5230',
  bog: (x, z) => riverDist(x, z) < 0 || Math.hypot(x + 112, z + 58) < 17,
  shape(h, x, z) {
    const md = Math.hypot(x + 112, z + 58); h = lerp(h, -1.4, 1 - smoothstep(16, 22, md));            // the flooded pit
    const gd = Math.hypot(x - 118, z + 64); h += (1 - smoothstep(10, 22, gd)) * 3;                     // geode mound
    const cd = Math.hypot(x - 28, z - 158); h += (1 - smoothstep(10, 34, cd)) * 18;                    // the Colossus' cliff
    return h;
  },
  tint(c, x, z) {
    const md = Math.hypot(x + 112, z + 58); if (md < 23) c.lerp(new THREE.Color('#2a3a38'), 1 - smoothstep(18, 23, md));
    const fd = Math.hypot(x + 86, z - 102); if (fd < 32) c.lerp(new THREE.Color('#2f5a60'), (1 - smoothstep(10, 32, fd)) * 0.55);
    const gd = Math.hypot(x - 118, z + 64); if (gd < 24) c.lerp(new THREE.Color('#5a4a70'), (1 - smoothstep(6, 24, gd)) * 0.4);
  },
  build(ctx) {
    const { rand, add, heightAt, open } = ctx;
    const wood = clay('#7a5230', { key: 'mineWood' }), iron = clay('#4a4650', { metalness: 0.6, roughness: 0.4, key: 'mineIron' });
    const rock = clay('#6e5a48', { roughness: 0.9, key: 'deepRock' });
    // --- The Great Geode: a colossal split crystal egg you can walk into.
    { const L = this.landmarks[0], y0 = heightAt(L.x, L.z);
      const geo = blender('geode', 1.25);
      if (geo) { geo.position.set(L.x, y0 - 0.4, L.z); geo.rotation.y = Math.atan2(-L.x, -L.z); add(geo, 0); }
      else {
        const shell = M(new THREE.SphereGeometry(8, 24, 16, 0, Math.PI * 1.4), clay('#6a5a54', { side: THREE.DoubleSide, key: 'geodeRock' }), L.x, y0 + 3, L.z);
        shell.rotation.y = Math.atan2(-L.x, -L.z) + Math.PI * 0.8; add(shell, 0);
      }
      for (let i = 0; i < 14; i++) { const a = rand() * TAU, r = 10 + rand() * 9, x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r; const c = crystalCluster(rand, '#c9a8ff', 6, 1 + rand()); c.position.set(x, heightAt(x, z), z); add(shadowAll(c), 1); }
      ctx.light('#b48cff', 40, 44, L.x, y0 + 6, L.z);
      // Colliders ring the shell except its open face.
      const face = Math.atan2(-L.x, -L.z);
      for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; if (Math.abs(Math.atan2(Math.sin(a - face), Math.cos(a - face))) < 0.8) continue; ctx.collide(L.x + Math.sin(a) * 8.5, L.z + Math.cos(a) * 8.5, 2.2); }
    }
    // --- The Flooded Mine: a headframe over a drowned shaft, rails running into black water.
    { const L = this.landmarks[1];
      const pool = M(new THREE.CircleGeometry(20, 48), new THREE.MeshStandardMaterial({ color: '#1a4048', emissive: '#0c3038', emissiveIntensity: 0.6, roughness: 0.08, transparent: true, opacity: 0.85 }), L.x, -0.7, L.z);
      pool.rotation.x = -Math.PI / 2; ctx.scene.add(pool); ctx.aoHide(pool);
      const hf = new THREE.Group();
      [[-3, -3], [3, -3], [-3, 3], [3, 3]].forEach(([x, z]) => { const leg = M(rbox(0.5, 14, 0.5, 0.08), wood, x * 0.7, 7, z * 0.7); leg.rotation.set(z * 0.02, 0, -x * 0.02); hf.add(leg); });
      for (let y = 3; y < 14; y += 3.5) hf.add(M(rbox(5, 0.35, 0.35, 0.06), wood, 0, y, -2.1), M(rbox(5, 0.35, 0.35, 0.06), wood, 0, y, 2.1), M(rbox(0.35, 0.35, 5, 0.06), wood, -2.1, y, 0), M(rbox(0.35, 0.35, 5, 0.06), wood, 2.1, y, 0));
      const wheel = blender('lift_wheel', 0.8) || M(new THREE.TorusGeometry(2.2, 0.2, 8, 24), iron);
      wheel.position.set(0, 14.5, 0); hf.add(wheel); ctx.spinners = [...(ctx.spinners || []), wheel];
      hf.add(M(new THREE.CylinderGeometry(0.05, 0.05, 12, 6), iron, 0, 8.5, 0));
      const cage = M(rbox(2.2, 2.4, 2.2, 0.1), iron, 0, 1.2, 0); cage.material = iron; hf.add(cage);
      hf.position.set(L.x, -0.6, L.z); add(shadowAll(hf), 0);
      ctx.collide(L.x, L.z, 2.8);
      // Half-sunk carts, ore piles and a broken trestle.
      for (let i = 0; i < 6; i++) {
        const a = rand() * TAU, r = 10 + rand() * 12, x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
        const cart = blender('minecart', 1) || M(rbox(1.6, 0.9, 1, 0.1), iron, 0, 0.5, 0);
        const g = new THREE.Group(); g.add(cart); g.position.set(x, Math.max(heightAt(x, z), -0.9) - 0.2, z); g.rotation.set((rand() - 0.5) * 0.4, rand() * 6, (rand() - 0.5) * 0.4); add(shadowAll(g), 0.9);
      }
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, x = L.x + Math.cos(a) * 23, z = L.z + Math.sin(a) * 23; const t = M(rbox(0.4, 4 + rand() * 3, 0.4, 0.08), wood, x, heightAt(x, z) + 2, z); t.rotation.z = (rand() - 0.5) * 0.3; add(t, 0.4); }
      ctx.light('#ffc46a', 22, 34, L.x, 6, L.z);
    }
    // --- The Fungal Cathedral: a nave of towering glowing mushrooms.
    { const L = this.landmarks[2], a0 = Math.atan2(-L.x, -L.z);
      for (let i = 0; i < 2; i++) for (let k = 0; k < 7; k++) {
        const along = (k - 3) * 6.5, side = i ? 1 : -1;
        const x = L.x + Math.sin(a0) * along + Math.cos(a0) * side * 9, z = L.z + Math.cos(a0) * along - Math.sin(a0) * side * 9;
        const m = mushroom(rand, 2.2 + rand() * 1.4 + (3 - Math.abs(k - 3)) * 0.35); m.position.set(x, heightAt(x, z), z); m.rotation.z = side * 0.08; add(shadowAll(m), 1.2);
      }
      for (let i = 0; i < 60; i++) { const a = rand() * TAU, r = rand() * 30, x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r; const m = mushroom(rand, 0.3 + rand() * 0.6); m.position.set(x, heightAt(x, z), z); add(m, 0); }
      ctx.light('#5ff0ff', 36, 50, L.x, 10, L.z);
    }
    // --- The Sleeping Colossus: a giant's face carved into the cavern wall.
    { const L = this.landmarks[3], cx = L.x, cz = L.z + 12, y0 = heightAt(L.x, L.z + 4) + 2;
      const face = blender('colossus_face', 0.85);
      const faceG = new THREE.Group();
      if (face) faceG.add(face);
      else {
        const stone = clay('#9a8266', { roughness: 0.85, key: 'colossusStone' });
        faceG.add(M(new THREE.SphereGeometry(16, 24, 18), stone, 0, 16, -6));
        faceG.children[0].scale.set(1, 1.2, 0.5);
        faceG.add(M(new THREE.ConeGeometry(3, 8, 8), stone, 0, 14, 3));
      }
      const eyes = blender('colossus_eyes', 0.85); if (eyes) { eyes.visible = false; faceG.add(eyes); ctx.colossusEyes = eyes; }
      faceG.position.set(cx, y0 - 4, cz); faceG.rotation.y = Math.PI; add(faceG, 0);
      ctx.collide(cx, cz, 14);
      ctx.light('#ffc23a', 26, 60, cx, y0 + 10, cz - 20);
    }
    // --- The dark between: stalagmite fields, crystal seams, fungus groves and fallen blocks.
    for (let f = 0; f < 30; f++) {
      const r = 60 + rand() * 100, a = rand() * TAU, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      if (!open(cx, cz, 6)) continue;
      const kind = rand();
      for (let i = 0; i < 8; i++) {
        const x = cx + (rand() - 0.5) * 20, z = cz + (rand() - 0.5) * 20;
        if (!open(x, z, 1)) continue;
        let g;
        if (kind < 0.4) { g = mushroom(rand, 0.8 + rand() * 1.4); }
        else if (kind < 0.7) { g = crystalCluster(rand, rand() < 0.6 ? '#ffb347' : '#b48cff', 5, 0.8 + rand()); }
        else { g = new THREE.Group(); const b = M(new THREE.DodecahedronGeometry(1.4 + rand() * 1.6, 0), rock, 0, 0.8, 0); b.rotation.set(rand() * 3, rand() * 3, 0); b.scale.set(1, 0.8, 1.2); g.add(b); }
        g.position.set(x, heightAt(x, z), z); g.rotation.y = rand() * 6; add(shadowAll(g), 1);
      }
    }
    ctx.lanterns(minerLantern);
    ctx.scatter({ geo: ctx.kit.bladeGeo(), mat: clay('#ffffff', { roughness: 0.8, side: THREE.DoubleSide, key: 'caveMoss' }), count: 3200, scale: [0.4, 0.9], colors: ['#2f5a52', '#3a6a5e', '#4a5a40', '#2a4a48'] });
    ctx.scatter({ geo: new THREE.DodecahedronGeometry(0.25, 0), mat: clay('#6e5a48', { roughness: 0.8, key: 'cavePebble' }), count: 2200, scale: [0.4, 1.8], sink: 0.08 });
    ctx.scatter({ geo: crystalGeo(0.07, 0.45), mat: glowM('#ffb347', 1.2), count: 600, scale: [0.6, 1.6], tilt: 0.6 });
    ctx.scatter({ geo: new THREE.SphereGeometry(0.12, 8, 6, 0, TAU, 0, Math.PI / 2), mat: glowM('#5ff0ff', 1.4), count: 900, scale: [0.5, 1.6], sink: 0.02 });
  },
  tick(dt, t, ctx) { (ctx.spinners || []).forEach((w) => { w.rotation.z += dt * 0.4; }); },
  life: {
    // Minecarts trundle along a rail from the hub to the Flooded Mine; bats wheel under the vault.
    build(ctx) {
      const iron = clay('#4a4650', { metalness: 0.6, roughness: 0.4, key: 'mineIron' }), wood = clay('#7a5230', { key: 'mineWood' });
      const pts = [];
      for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(new THREE.Vector3(-30 - t * 70 + Math.sin(t * 6) * 6, 0, -22 - t * 30 + Math.cos(t * 5) * 5)); }
      const curve = new THREE.CatmullRomCurve3(pts);
      for (let i = 0; i <= 120; i++) {
        const p = curve.getPointAt(i / 120), tan = curve.getTangentAt(i / 120), a = Math.atan2(tan.x, tan.z), y = ctx.heightAt(p.x, p.z);
        const tie = M(rbox(1.8, 0.14, 0.3, 0.03), wood, p.x, y, p.z); // bedded halfway into the ground tie.rotation.y = a; ctx.add(tie, 0);
      }
      for (const s of [-0.6, 0.6]) {
        const rail = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curve.getSpacedPoints(160).map((p, i, arr) => {
          const n = arr[Math.min(i + 1, arr.length - 1)], b = arr[Math.max(i - 1, 0)], a = Math.atan2(n.x - b.x, n.z - b.z);
          return new THREE.Vector3(p.x + Math.cos(a) * s, ctx.heightAt(p.x, p.z) + 0.12, p.z - Math.sin(a) * s);
        })), 200, 0.05, 4, false);
        ctx.scene.add(M(rail, iron));
      }
      ctx.cartCurve = curve;
      ctx.carts = [0, 0.5].map((off) => {
        const c = blender('minecart', 1) || M(rbox(1.5, 0.8, 1, 0.1), iron, 0, 0.5, 0);
        const g = new THREE.Group(); g.add(c); ctx.scene.add(shadowAll(g));
        return { g, off };
      });
      // Bats: little dark flappers circling the vault.
      const batGeo = new THREE.BufferGeometry();
      batGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -0.7, 0.1, -0.1, 0, 0, -0.2, 0, 0, 0.3, 0.7, 0.1, -0.1, 0, 0, -0.2], 3)); batGeo.computeVertexNormals();
      const batMat = new THREE.MeshBasicMaterial({ color: '#120c0a', side: THREE.DoubleSide });
      ctx.bats = Array.from({ length: 36 }, (_, i) => { const b = M(batGeo, batMat); ctx.scene.add(b); return { b, a: Math.random() * TAU, r: 20 + Math.random() * 90, y: 22 + Math.random() * 14, s: 0.3 + Math.random() * 0.3, ph: Math.random() * 6, cx: (Math.random() - 0.5) * 120, cz: (Math.random() - 0.5) * 120 }; });
    },
    tick(dt, t, ctx) {
      ctx.carts?.forEach((c) => {
        const u = ((t * 0.02 + c.off) % 2), k = u < 1 ? u : 2 - u;
        const p = ctx.cartCurve.getPointAt(k), tan = ctx.cartCurve.getTangentAt(k);
        c.g.position.set(p.x, ctx.heightAt(p.x, p.z) + 0.25, p.z); c.g.rotation.y = Math.atan2(tan.x, tan.z);
      });
      ctx.bats?.forEach((b) => { b.a += dt * b.s; b.b.position.set(b.cx + Math.cos(b.a) * b.r, b.y + Math.sin(t * 2 + b.ph) * 1.5, b.cz + Math.sin(b.a) * b.r); b.b.rotation.y = -b.a; b.b.scale.x = 0.6 + Math.abs(Math.sin(t * 16 + b.ph)) * 0.8; });
    },
  },
};
