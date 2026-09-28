import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clay } from './style.js';
import { runeCircleTexture } from './textures.js';
import { prop } from './assets.js';
import { fbm, smoothstep, lerp } from './util.js';
import { LIFE } from './realmlife.js';
import { DEEP } from './deep.js';

// The wider lands of each realm. Every realm is as large as the valley (radius ~180): the hub
// (portal, puzzle altars, sanctum) sits in the middle, and four landmark regions lie out in
// the wilds, joined by paths. This module layers onto a realm's base terrain:
//   height(base, x, z)  rolling hills beyond the hub, plus each landmark's shaping
//   color(c, x, z, …)   paths and landmark ground tints
//   lavaAt / iceAt / slowAt / surfaces   extra hazards and walkable bridges
//   build(ctx)          set pieces, forests, path lanterns, ground scatter, echo stones
// Landmark set pieces are merged into spatial chunks by the realm, so the extra detail costs
// a handful of draw calls per chunk rather than one per prop.

export const WORLD_R = 180;
const TAU = Math.PI * 2;
const rbox = (w, h, d, r = 0.1) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
const M = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const shadowAll = (o) => { o.traverse((m) => { if (m.isMesh && !(m.material.emissiveIntensity > 1) && !m.material.transparent) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
const glowM = (c, i = 2) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i });

function taperGeo(points, r0, r1, seg = 16, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c);
    const r = r0 + (r1 - r0) * (i / seg);
    for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c); pos.setXYZ(k, v.x, v.y, v.z); }
  }
  geo.computeVertexNormals();
  return geo;
}
const crystalGeo = (r, h, sides = 6) => new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), new THREE.Vector2(r, h * 0.08), new THREE.Vector2(r, h * 0.7), new THREE.Vector2(0.001, h)], sides);

// ---------------------------------------------------------------- paths
// Each path leaves the hub toward a landmark along a gently wandering polyline.
function makePath(tx, tz, seed) {
  const a = Math.atan2(tz, tx), L = Math.hypot(tx, tz), pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, r = 32 + (L - 32) * t;
    const wob = Math.sin(t * Math.PI) * Math.sin(t * 7 + seed) * 9;
    pts.push([Math.cos(a) * r - Math.sin(a) * wob, Math.sin(a) * r + Math.cos(a) * wob]);
  }
  return pts;
}
function segDist(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
function pathDist(paths, x, z) {
  let d = Infinity;
  for (const p of paths) for (let i = 0; i < p.length - 1; i++) d = Math.min(d, segDist(x, z, p[i], p[i + 1]));
  return d;
}
// Sample points along every path at a fixed spacing (lanterns, bridges).
function alongPaths(paths, step, fn) {
  paths.forEach((p) => {
    let carry = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1], L = Math.hypot(bx - ax, bz - az);
      for (let s = carry; s < L; s += step) fn(ax + (bx - ax) * (s / L), az + (bz - az) * (s / L), Math.atan2(bx - ax, bz - az));
      carry = (carry + step - (L % step)) % step;
    }
  });
}

// ---------------------------------------------------------------- ground scatter (instanced)
function bladeGeo() {
  const g = new THREE.BufferGeometry(), pos = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, c = Math.cos(a) * 0.12, s = Math.sin(a) * 0.12, lean = 0.08 * (k - 1);
    pos.push(-c, 0, -s, c, 0, s, lean, 0.55 + k * 0.08, 0);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
function scatter(ctx, { geo, mat, count, test, scale = [0.6, 1.2], colors = null, tilt = 0, sink = 0.03 }) {
  const { rand, heightAt } = ctx, spots = [];
  for (let tries = 0; spots.length < count && tries < count * 6; tries++) {
    const r = 20 + Math.sqrt(rand()) * (WORLD_R - 30), a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!ctx.open(x, z) || (test && !test(x, z))) continue;
    spots.push([x, heightAt(x, z), z]);
  }
  const im = new THREE.InstancedMesh(geo, mat, spots.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  spots.forEach(([x, y, z], i) => {
    const k = scale[0] + rand() * (scale[1] - scale[0]);
    im.setMatrixAt(i, m.compose(p.set(x, y - sink, z), q.setFromEuler(e.set((rand() - 0.5) * tilt, rand() * TAU, (rand() - 0.5) * tilt)), s.set(k, k * (0.8 + rand() * 0.4), k)));
    if (colors) im.setColorAt(i, c.set(colors[Math.floor(rand() * colors.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.05));
  });
  im.receiveShadow = true;
  ctx.scene.add(im);
  return im;
}

// ---------------------------------------------------------------- shared props
function echoStone(color) {
  // A tall carved standing stone with glowing runes and a floating glyph: read it for lore.
  const g = new THREE.Group(), stone = clay('#7c7686', { roughness: 0.8, key: 'echoStone' });
  const slab = M(rbox(1.4, 3.6, 0.7, 0.2), stone, 0, 1.8, 0); slab.rotation.y = 0.2; g.add(slab);
  const cap = M(new THREE.ConeGeometry(0.8, 0.8, 4), stone, 0, 3.95, 0); cap.rotation.y = Math.PI / 4 + 0.2; cap.scale.z = 0.5; g.add(cap);
  const runes = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.6), new THREE.MeshBasicMaterial({ map: runeStripTexture(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  runes.position.set(Math.sin(0.2) * 0.37, 1.9, Math.cos(0.2) * 0.37); runes.rotation.y = 0.2; g.add(runes);
  const base = M(new THREE.CylinderGeometry(1.4, 1.6, 0.3, 10), clay('#5d5868', { key: 'echoBase' }), 0, 0.15, 0); g.add(base);
  const glyph = M(new THREE.OctahedronGeometry(0.3, 0), glowM(color, 2.4), 0, 5.0, 0); glyph.userData.dynamic = true; glyph.userData.echoGlyph = true; g.add(glyph);
  const ring = new THREE.Mesh(new THREE.CircleGeometry(2.4, 40), new THREE.MeshBasicMaterial({ map: runeCircleTexture(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.33; ring.userData.dynamic = true; ring.userData.echoRing = true; g.add(ring);
  return shadowAll(g);
}
const stripCache = {};
function runeStripTexture(color) {
  if (stripCache[color]) return stripCache[color];
  const c = document.createElement('canvas'); c.width = 64; c.height = 160;
  const g = c.getContext('2d'); g.strokeStyle = color; g.lineWidth = 3; g.shadowColor = color; g.shadowBlur = 6;
  for (let i = 0; i < 6; i++) {
    const y = 14 + i * 24; g.beginPath();
    const k = (i * 7) % 5;
    g.moveTo(20, y); g.lineTo(44, y + (k % 2 ? 14 : 0)); if (k > 1) { g.moveTo(32, y - 4); g.lineTo(32, y + 16); } if (k % 3 === 0) g.arc(32, y + 6, 6, 0, TAU);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (stripCache[color] = t);
}

function deadTree(rand, s = 1, mat) {
  const g = new THREE.Group();
  const h = (4 + rand() * 3) * s, lean = (rand() - 0.5) * 0.6;
  g.add(new THREE.Mesh(taperGeo([[0, 0, 0], [lean * 0.5, h * 0.4, 0], [lean, h * 0.75, lean * 0.3], [lean * 1.4, h, 0]], 0.42 * s, 0.07 * s, 10, 7), mat));
  for (let b = 0; b < 6; b++) {
    const y = h * (0.45 + b * 0.09), a = rand() * TAU, L = (1.4 + rand() * 1.6) * s * (1 - b * 0.08);
    const x0 = lean * (y / h), p1 = [x0 + Math.cos(a) * L * 0.5, y + L * 0.3, Math.sin(a) * L * 0.5], p2 = [x0 + Math.cos(a) * L, y + L * 0.2 + rand() * 0.8 * s, Math.sin(a) * L];
    g.add(new THREE.Mesh(taperGeo([[x0, y, 0], p1, p2], 0.13 * s * (1 - b * 0.1), 0.02, 6, 5), mat));
  }
  return g;
}
function pine(rand, s = 1, snowy = true) {
  const g = new THREE.Group();
  const dark = clay('#2f5a58', { roughness: 0.7, key: 'pineDark' }), snow = clay('#e8f3fa', { roughness: 0.75, key: 'snowPine' });
  g.add(M(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 1.4 * s, 6), clay('#5a4a40', { key: 'pineTrunk' }), 0, 0.7 * s, 0));
  const tiers = 3 + Math.floor(rand() * 2);
  for (let k = 0; k < tiers; k++) {
    const r = (2.1 - k * 0.42) * s, y = (1.5 + k * 1.05) * s;
    g.add(M(new THREE.ConeGeometry(r, 1.7 * s, 8), dark, 0, y, 0));
    if (snowy) g.add(M(new THREE.ConeGeometry(r * 0.82, 0.7 * s, 8), snow, 0, y + 0.55 * s, 0));
  }
  return g;
}
function gravestone(rand, stone, dark) {
  const g = new THREE.Group(), kind = rand();
  if (kind < 0.5) {
    g.add(M(rbox(1.0, 1.2, 0.28, 0.08), stone, 0, 0.55, 0));
    const top = M(new THREE.CylinderGeometry(0.5, 0.5, 0.28, 14, 1, false, 0, Math.PI), stone, 0, 1.15, 0); top.rotation.set(Math.PI / 2, 0, Math.PI / 2); g.add(top);
  } else if (kind < 0.8) {
    g.add(M(rbox(0.28, 1.7, 0.28), stone, 0, 0.85, 0)); g.add(M(rbox(0.95, 0.28, 0.28), stone, 0, 1.3, 0));
  } else {
    const o = M(new THREE.CylinderGeometry(0.18, 0.42, 2.2, 4), dark, 0, 1.1, 0); o.rotation.y = Math.PI / 4; g.add(o);
  }
  g.rotation.set((rand() - 0.5) * 0.18, (rand() - 0.5) * 0.4, (rand() - 0.5) * 0.2);
  return g;
}

// ================================================================ Necromancy: the moors
const CRYPT = {
  landmarks: [
    { id: 'mausoleums', name: 'The Weeping Mausoleums', x: -118, z: -34, r: 20,
      lore: 'Three noble houses built tombs to outlast the kingdom. The kingdom agreed, and left.' },
    { id: 'chapel', name: 'The Drowned Chapel', x: 106, z: 46, r: 24,
      lore: 'The bog rose one spring and never fell. The bell still rings beneath it on stormy nights.' },
    { id: 'bonefields', name: 'The Bone Fields', x: 42, z: -128, r: 26,
      lore: 'Two armies met here. Neither left. Their swords still stand where they fell.' },
    { id: 'hill', name: "Hangman's Hill", x: -72, z: 116, r: 30,
      lore: 'The old tree bears iron fruit. Every cage once held someone who could not stop talking.' },
  ],
  pathColor: '#7a7488', pathEdge: '#4a4454', patches: ['#3e5a40', '#4a3e54', '#3a3430', '#4e4a58'],
  shape(h, x, z) {
    // Hangman's Hill rises; the bog sinks around the drowned chapel's island.
    const hd = Math.hypot(x + 72, z - 116); h += (1 - smoothstep(4, 34, hd)) * 12;
    const bd = Math.hypot(x - 106, z - 46); h = lerp(h, -1.2, 1 - smoothstep(18, 26, bd)); h = lerp(h, 0.35, 1 - smoothstep(5, 8, bd));
    return h;
  },
  bog: (x, z) => { const d = Math.hypot(x - 106, z - 46); return d < 21 && d > 7.5; },
  tint(c, x, z) {
    if (Math.hypot(x - 106, z - 46) < 23) c.lerp(new THREE.Color('#1c2a1e'), 0.8);
    if (Math.hypot(x + 118, z + 34) < 14) c.lerp(new THREE.Color('#6a6474'), 0.7);
  },
  build(ctx) {
    const { rand, add, heightAt, open } = ctx;
    const bark = clay('#2e2622', { roughness: 0.8, key: 'deadBark' });
    const stone = clay('#8a8599', { roughness: 0.7, key: 'grave' }), dark = clay('#5d5868', { roughness: 0.75, key: 'graveDark' });
    const walls = clay('#7a7486', { key: 'mausWall' }), roofM = clay('#4a4458', { key: 'mausRoof' }), iron = clay('#2b2833', { roughness: 0.4, key: 'ironFence' });
    const soul = glowM('#5dff8a', 1.6), bone = clay('#e9e0c8', { roughness: 0.72, key: 'titanBone' });
    // --- The Weeping Mausoleums: three tombs around a flagstone plaza, weeping angels, a fence.
    { const L = this.landmarks[0];
      const plaza = M(new THREE.CircleGeometry(13, 40), clay('#8a8496', { roughness: 0.85, key: 'plazaDark' }), L.x, heightAt(L.x, L.z) + 0.05, L.z); plaza.rotation.x = -Math.PI / 2; ctx.scene.add(plaza);
      [-0.9, 0, 0.9].forEach((da, i) => {
        const a = Math.PI + da, x = L.x + Math.sin(a) * 10.5, z = L.z + Math.cos(a) * 10.5, m = new THREE.Group();
        m.add(M(rbox(7, 5, 5.5, 0.3), walls, 0, 2.5, 0));
        const roof = M(new THREE.CylinderGeometry(0.01, 5.2, 2.6, 4), roofM, 0, 6.3, 0); roof.rotation.y = Math.PI / 4; roof.scale.z = 0.8; m.add(roof);
        for (const cx of [-2.4, -0.8, 0.8, 2.4]) m.add(M(new THREE.CylinderGeometry(0.3, 0.34, 4.6, 12), clay('#9a94a6', { key: 'mausCol' }), cx, 2.3, 3.0));
        m.add(M(rbox(7.4, 0.4, 1.2), walls, 0, 4.8, 3.0));
        m.add(M(rbox(1.8, 3.0, 0.3), new THREE.MeshStandardMaterial({ color: '#0a1a10', emissive: '#2fd86a', emissiveIntensity: 0.9 }), 0, 1.5, 2.8));
        const sk = prop('skull_small'); if (sk) { sk.scale.setScalar(0.5); sk.position.set(0, 4.4, 3.2); m.add(sk); }
        m.position.set(x, heightAt(x, z), z); m.rotation.y = a + Math.PI;
        add(shadowAll(m), 0); ctx.collide(x, z, 3.6);
        i === 1 && ctx.light('#5dff8a', 10, 18, x + Math.sin(a + Math.PI) * 5, heightAt(x, z) + 2, z + Math.cos(a + Math.PI) * 5);
      });
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2, x = L.x + Math.sin(a) * 8, z = L.z + Math.cos(a) * 8, st = new THREE.Group(), marble = clay('#b8b2c4', { key: 'angel' });
        st.add(M(rbox(1.1, 0.8, 1.1), dark, 0, 0.4, 0));
        st.add(M(new THREE.ConeGeometry(0.55, 1.9, 12), marble, 0, 1.75, 0));
        const head = M(new THREE.SphereGeometry(0.26, 12, 10), marble, 0, 2.85, 0.12); st.add(head);
        for (const s of [-1, 1]) { const w = M(new THREE.SphereGeometry(0.7, 12, 8), marble, s * 0.45, 2.3, -0.3); w.scale.set(0.35, 1.3, 0.6); w.rotation.z = s * 0.4; st.add(w); }
        st.add(M(new THREE.CapsuleGeometry(0.1, 0.6, 4, 8), marble, 0, 2.55, 0.35));
        st.position.set(x, heightAt(x, z), z); st.rotation.y = Math.atan2(L.x - x, L.z - z); st.rotation.x = 0.15;
        add(shadowAll(st), 0.7);
      }
      for (let i = 0; i < 44; i++) {
        const a = (i / 44) * TAU;
        const x = L.x + Math.sin(a) * 17, z = L.z + Math.cos(a) * 17;
        if (Math.abs(Math.atan2(Math.sin(a - Math.atan2(-L.x, -L.z)), Math.cos(a - Math.atan2(-L.x, -L.z)))) < 0.14) continue;
        const post = new THREE.Group();
        post.add(M(new THREE.CylinderGeometry(0.05, 0.05, 2, 6), iron, 0, 1, 0)); post.add(M(new THREE.ConeGeometry(0.1, 0.3, 4), iron, 0, 2.1, 0));
        const rail = M(rbox(2.5, 0.08, 0.08, 0.03), iron, 0, 1.6, 0); rail.rotation.y = a + Math.PI / 2; post.add(rail);
        post.position.set(x, heightAt(x, z), z); add(post, 0);
      }
    }
    // --- The Drowned Chapel: a ruined chapel on an island in a black bog.
    { const L = this.landmarks[1];
      const bogM = new THREE.MeshStandardMaterial({ color: '#16241a', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.88 });
      const bog = M(new THREE.RingGeometry(6.5, 22.5, 48, 1), bogM, L.x, -0.55, L.z); bog.rotation.x = -Math.PI / 2; bog.receiveShadow = true; ctx.scene.add(bog); ctx.aoHide(bog);
      const ch = new THREE.Group(), cw = clay('#6f6a78', { roughness: 0.85, key: 'chapelWall' });
      [[-2.6, 0, 0.5, 5.2, 9], [2.6, 0, 0.5, 3.4, 9], [0, -4.5, 5.6, 4.6, 0.5]].forEach(([x, z, w, h, d]) => ch.add(M(rbox(w, h, d, 0.1), cw, x, h / 2, z)));
      ch.add(M(rbox(1.8, 2.4, 0.5), cw, -1.8, 1.2, 4.5)); ch.add(M(rbox(1.4, 1.6, 0.5), cw, 2.0, 0.8, 4.5));
      const tower = M(rbox(2.2, 7, 2.2, 0.1), cw, 2.4, 3.5, -4.6); tower.rotation.z = 0.12; ch.add(tower);
      const arch = M(new THREE.TorusGeometry(1.2, 0.22, 8, 16, Math.PI), cw, -2.6, 3.4, 1.5); arch.rotation.y = Math.PI / 2; ch.add(arch);
      for (let b = 0; b < 4; b++) { const beam = M(rbox(0.3, 0.3, 5.5, 0.05), clay('#3a2e24', { key: 'yoke' }), -1.5 + b, 0.5 + (b % 2) * 1.2, -1 + b * 0.6); beam.rotation.set(0.5 - b * 0.2, b, 0.7); ch.add(beam); }
      const bell = prop('bell'); if (bell) { bell.scale.setScalar(0.9); bell.position.set(0.8, 1.0, 2.5); bell.rotation.set(1.4, 0.3, 0.2); ch.add(bell); }
      ch.position.set(L.x, heightAt(L.x, L.z), L.z); ch.rotation.y = -0.5;
      add(shadowAll(ch), 0); ctx.collide(L.x - 1, L.z - 2, 3.8);
      for (let i = 0; i < 12; i++) {
        const a = rand() * TAU, r = 10 + rand() * 10, x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r;
        const t = deadTree(rand, 0.7 + rand() * 0.4, bark); t.position.set(x, -0.8, z); t.rotation.set((rand() - 0.5) * 0.3, rand() * 6, (rand() - 0.5) * 0.3); add(shadowAll(t), 0.5);
      }
      const boat = new THREE.Group(), wood = clay('#4a3a2c', { key: 'boatWood' });
      boat.add(M(new THREE.SphereGeometry(1.4, 12, 8, 0, TAU, Math.PI / 2, Math.PI / 2), wood)); boat.children[0].scale.set(0.6, 0.5, 1.6);
      boat.position.set(L.x - 14, -0.4, L.z + 6); boat.rotation.set(0.3, 0.8, 0.25); add(shadowAll(boat), 0);
      for (let i = 0; i < 16; i++) { const a = rand() * TAU, r = 8 + rand() * 13; const w = M(new THREE.SphereGeometry(0.14, 8, 6), soul, L.x + Math.sin(a) * r, 0.4 + rand() * 1.4, L.z + Math.cos(a) * r); w.userData.dynamic = true; w.userData.bob = rand() * 6; ctx.scene.add(w); ctx.bobbers.push(w); }
    }
    // --- The Bone Fields: a battlefield of giant bones, swords and ragged banners.
    { const L = this.landmarks[2];
      const sk = prop('titan_skull');
      if (sk) { sk.scale.setScalar(2.6); sk.position.set(L.x, heightAt(L.x, L.z) + 1.0, L.z); sk.rotation.set(-0.12, Math.atan2(-L.x, -L.z) + 0.35, 0.18); add(shadowAll(sk), 4); }
      for (let i = 0; i < 9; i++) {
        const a = rand() * TAU, r = 7 + rand() * 16, x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r, s = 0.5 + rand() * 0.6, ya = rand() * TAU;
        const rib = new THREE.Mesh(taperGeo([[0, -0.5, 0], [1.5 * s, 3.5 * s, 0], [4.5 * s, 5.5 * s, 0], [7 * s, 4 * s, 0]], 0.4 * s, 0.12 * s), bone);
        const g = new THREE.Group(); g.add(rib); g.position.set(x, heightAt(x, z), z); g.rotation.y = ya; add(shadowAll(g), 0.6);
      }
      const steel = clay('#8a8fa0', { roughness: 0.35, metalness: 0.5, key: 'steel' }), leather = clay('#4a3222', { key: 'hilt' });
      const bannerCols = ['#6a1f2a', '#1f3a6a', '#2d2a3a'];
      for (let i = 0; i < 36; i++) {
        const a = rand() * TAU, r = 3 + rand() * 24, x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r;
        const g = new THREE.Group();
        if (rand() < 0.7) {
          g.add(M(rbox(0.12, 1.4, 0.04, 0.02), steel, 0, 0.5, 0)); g.add(M(rbox(0.5, 0.08, 0.1, 0.02), steel, 0, 1.2, 0));
          g.add(M(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6), leather, 0, 1.42, 0)); g.add(M(new THREE.SphereGeometry(0.06, 8, 6), steel, 0, 1.62, 0));
        } else {
          g.add(M(new THREE.CylinderGeometry(0.04, 0.05, 3.4, 6), leather, 0, 1.6, 0));
          const cloth = M(new THREE.PlaneGeometry(0.9, 1.5, 1, 4), clay(bannerCols[i % 3], { side: THREE.DoubleSide, key: 'banner' + (i % 3) }), 0.46, 2.4, 0);
          const cp = cloth.geometry.attributes.position; for (let v = 0; v < cp.count; v++) cp.setZ(v, Math.sin(cp.getY(v) * 3) * 0.1);
          g.add(cloth);
        }
        g.position.set(x, heightAt(x, z) - 0.1, z); g.rotation.set((rand() - 0.5) * 0.4, rand() * TAU, (rand() - 0.5) * 0.4);
        add(shadowAll(g), 0);
      }
      for (let i = 0; i < 10; i++) {
        const a = rand() * TAU, r = 4 + rand() * 20, x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r;
        const sh = M(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 16), clay(bannerCols[i % 3], { key: 'shield' + (i % 3) }), x, heightAt(x, z) + 0.1, z);
        sh.rotation.set(rand() * 1.2, rand() * 6, 0); add(shadowAll(sh), 0);
      }
    }
    // --- Hangman's Hill: a vast gnarled tree hung with iron cages, and a ring of stones.
    { const L = this.landmarks[3], y0 = heightAt(L.x, L.z), t = new THREE.Group();
      t.add(new THREE.Mesh(taperGeo([[0, -1, 0], [0.6, 5, 0.3], [-0.4, 10, -0.2], [0.8, 15, 0.4]], 1.6, 0.35, 16, 10), bark));
      for (let b = 0; b < 9; b++) {
        const y = 7 + b * 0.9, a = (b / 9) * TAU * 1.3, L2 = 5 + rand() * 3;
        const p2 = [Math.cos(a) * L2 * 0.6, y + 1.5, Math.sin(a) * L2 * 0.6], p3 = [Math.cos(a) * L2, y + 0.8 + rand() * 2, Math.sin(a) * L2];
        t.add(new THREE.Mesh(taperGeo([[0, y, 0], p2, p3], 0.45, 0.06, 10, 6), bark));
        if (b % 2 === 0) {
          const cx = p2[0] * 1.15, cz = p2[2] * 1.15, cy = y - 1.6, cage = new THREE.Group();
          cage.add(M(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4), iron, 0, 1.2, 0));
          for (let k = 0; k < 8; k++) { const ka = (k / 8) * TAU; cage.add(M(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 4), iron, Math.sin(ka) * 0.45, 0, Math.cos(ka) * 0.45)); }
          cage.add(M(new THREE.TorusGeometry(0.45, 0.04, 4, 12).rotateX(Math.PI / 2), iron, 0, 0.65, 0)); cage.add(M(new THREE.CylinderGeometry(0.47, 0.47, 0.06, 12), iron, 0, -0.65, 0));
          cage.add(M(new THREE.SphereGeometry(0.16, 8, 6), soul, 0, -0.2, 0));
          cage.position.set(cx, cy, cz); t.add(cage);
        }
      }
      for (let r = 0; r < 6; r++) { const a = (r / 6) * TAU; t.add(new THREE.Mesh(taperGeo([[0, 0.5, 0], [Math.cos(a) * 2.5, 0.2, Math.sin(a) * 2.5], [Math.cos(a) * 4.5, -0.4, Math.sin(a) * 4.5]], 0.6, 0.1, 8, 6), bark)); }
      t.scale.setScalar(1.45); t.position.set(L.x, y0, L.z); add(shadowAll(t), 3);
      ctx.light('#5dff8a', 16, 30, L.x, y0 + 8, L.z);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU, x = L.x + Math.sin(a) * 15, z = L.z + Math.cos(a) * 15;
        const s = M(rbox(1.3, 3 + rand() * 1.5, 0.8, 0.2), dark, x, heightAt(x, z) + 1.4, z); s.rotation.set((rand() - 0.5) * 0.2, a, (rand() - 0.5) * 0.15);
        add(shadowAll(s), 0.9);
      }
    }
    // --- The moors: dead woods, small forgotten cemeteries, lanterns along the paths.
    // Dead groves: trees gathered in clumps with thorny brambles beneath them.
    const bramble = clay('#2a2a24', { roughness: 0.9, key: 'bramble' });
    for (let gr = 0; gr < 26; gr++) {
      const r = 62 + Math.sqrt(rand()) * 105, a = rand() * TAU, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const n = 5 + Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) {
        const x = cx + (rand() - 0.5) * 20, z = cz + (rand() - 0.5) * 20;
        if (!open(x, z, 1)) continue;
        const tr = deadTree(rand, 0.8 + rand() * 0.7, bark); tr.position.set(x, heightAt(x, z) - 0.2, z); tr.rotation.y = rand() * 6; add(shadowAll(tr), 0.5);
        if (rand() < 0.6) { const b = M(new THREE.IcosahedronGeometry(0.8 + rand() * 0.6, 0), bramble, x + 1.5, heightAt(x + 1.5, z) + 0.3, z); b.scale.y = 0.6; add(b, 0); }
      }
    }
    for (let i = 0; i < 60; i++) {
      const r = 60 + Math.sqrt(rand()) * 110, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 3)) continue;
      const tr = deadTree(rand, 0.8 + rand() * 0.6, bark); tr.position.set(x, heightAt(x, z) - 0.2, z); tr.rotation.y = rand() * 6; add(shadowAll(tr), 0.5);
    }
    // Mossy rock outcrops and tumbled wall fragments of a forgotten estate.
    const moss = clay('#4a5a48', { roughness: 0.9, key: 'mossRock' });
    for (let i = 0; i < 34; i++) {
      const r = 60 + Math.sqrt(rand()) * 110, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 4)) continue;
      const g = new THREE.Group();
      if (rand() < 0.6) for (let k = 0; k < 4; k++) { const rk = M(new THREE.DodecahedronGeometry(1 + rand() * 1.4, 0), k % 2 ? moss : dark, (rand() - 0.5) * 3, 0.3, (rand() - 0.5) * 3); rk.rotation.set(rand() * 3, rand() * 3, 0); rk.scale.y = 0.7; g.add(rk); }
      else for (let k = 0; k < 3; k++) g.add(M(rbox(3 + rand() * 2, 1 + rand() * 1.6, 0.7, 0.1), stone, k * 3.2 - 3, 0.5, (rand() - 0.5) * 0.6));
      g.position.set(x, heightAt(x, z), z); g.rotation.y = rand() * 6; add(shadowAll(g), 2.2);
    }
    for (let c = 0; c < 8; c++) {
      const r = 70 + rand() * 90, a = rand() * TAU, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      if (!open(cx, cz, 8)) continue;
      for (let i = 0; i < 12; i++) {
        const x = cx + (i % 4 - 1.5) * 3.2 + (rand() - 0.5), z = cz + (Math.floor(i / 4) - 1) * 4 + (rand() - 0.5);
        const gs = gravestone(rand, stone, dark); gs.position.set(x, heightAt(x, z) - 0.05, z); add(shadowAll(gs), 0.5);
        ctx.graves.push({ x, z: z + 1 });
      }
    }
    ctx.lanterns((x, z) => {
      const lp = new THREE.Group();
      lp.add(M(new THREE.CylinderGeometry(0.07, 0.1, 2.8, 6), clay('#3a302a', { key: 'lampPole' }), 0, 1.4, 0));
      lp.add(M(new THREE.CylinderGeometry(0.2, 0.25, 0.45, 6, 1, true), iron, 0, 2.95, 0));
      lp.add(M(new THREE.SphereGeometry(0.15, 10, 8), soul, 0, 2.95, 0));
      lp.add(M(new THREE.ConeGeometry(0.28, 0.25, 6), iron, 0, 3.3, 0));
      return lp;
    });
    // Ground detail: withered grass, pale glowing mushrooms, scattered bones and stones.
    scatter(ctx, { geo: bladeGeo(), mat: clay('#ffffff', { roughness: 0.8, side: THREE.DoubleSide, key: 'deadGrass' }), count: 7000, scale: [0.5, 0.95], colors: ['#6a7a5a', '#7a7656', '#5e6e56', '#8a8064'] });
    const mush = new THREE.CylinderGeometry(0.06, 0.04, 0.22, 6).translate(0, 0.11, 0);
    const cap = new THREE.SphereGeometry(0.13, 8, 6, 0, TAU, 0, Math.PI / 2).translate(0, 0.21, 0);
    scatter(ctx, { geo: mergeTwo(mush, cap), mat: glowM('#7dffb0', 1.1), count: 900, scale: [0.6, 1.6] });
    scatter(ctx, { geo: new THREE.CapsuleGeometry(0.05, 0.4, 3, 6).rotateZ(Math.PI / 2), mat: bone, count: 700, scale: [0.6, 1.5], tilt: 0.4 });
    scatter(ctx, { geo: new THREE.DodecahedronGeometry(0.22, 0), mat: clay('#5d5868', { roughness: 0.9, key: 'moorStone' }), count: 1600, scale: [0.4, 1.6], sink: 0.08 });
  },
  tick(dt, t, ctx, player) {
    ctx.bobbers.forEach((w) => { w.position.y = 0.4 + Math.sin(t * 1.3 + w.userData.bob) * 0.5; });
  },
};

function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry(), pa = a.toNonIndexed(), pb = b.toNonIndexed();
  const pos = new Float32Array([...pa.attributes.position.array, ...pb.attributes.position.array]);
  const nor = new Float32Array([...pa.attributes.normal.array, ...pb.attributes.normal.array]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

// A small self-contained lava surface for landmark pools (the caldera's rivers use their own).
const lavaU = { uTime: { value: 0 } };
function lavaMat() {
  return new THREE.ShaderMaterial({
    uniforms: lavaU,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){ vec2 p = vW.xz * 0.35 + vec2(uTime * 0.2, uTime * 0.07); float v = n(p) * 0.6 + n(p * 2.3 - uTime * 0.3) * 0.4;
        vec3 c = mix(vec3(0.95, 0.2, 0.02), vec3(1.0, 0.8, 0.25), smoothstep(0.45, 0.85, v)); c = mix(c, vec3(0.22, 0.05, 0.02), smoothstep(0.35, 0.12, v));
        gl_FragColor = vec4(c * 1.1, 1.0); }`,
  });
}

// ================================================================ Pyromancy: the burning wastes
const CALDERA = {
  landmarks: [
    { id: 'obsidian', name: 'The Obsidian Forest', x: -112, z: -64, r: 24, echoR: 0,
      lore: 'Glass trees, grown where a river of fire cooled too fast. They still ring when the wind blows.' },
    { id: 'forge', name: 'The Sunken Forge', x: 116, z: -46, r: 22, echoR: 0,
      lore: 'The fire-smiths carved a face into their gate so the mountain would know who to spare. It did not.' },
    { id: 'vent', name: 'The Great Vent', x: -76, z: 112, r: 34, echoR: 38,
      lore: 'The caldera breathes through this mouth. Pyromancers once came here to learn patience.' },
    { id: 'bridges', name: 'The Salamander Bridges', x: 84, z: 106, r: 24, echoR: 0,
      lore: 'The salamander was a pet, then a guardian, then a legend, then a statue. It prefers the statue.' },
  ],
  pathColor: '#6a5a52', pathEdge: '#3a2e2a', positiveHills: true, patches: ['#5a5250', '#6a3a26', '#261c1a', '#2e2624'],
  shape(h, x, z) {
    const vd = Math.hypot(x + 76, z - 112);
    h += 20 * (1 - smoothstep(8, 34, vd));                     // the vent's cone
    if (vd < 8) h -= (1 - vd / 8) * 7;                          // …and its crater
    const ld = Math.hypot(x - 84, z - 106);
    h = lerp(h, -1.8, 1 - smoothstep(19, 23, ld));              // salamander lava lake
    h = lerp(h, 0.7, 1 - smoothstep(4.5, 6, ld));               // with an island
    return h;
  },
  lava(x, z) {
    const ld = Math.hypot(x - 84, z - 106);
    if (ld < 21 && ld > 5.8 && !(Math.abs(x - 84) < 1.8 || Math.abs(z - 106) < 1.8)) return true;
    return Math.hypot(x + 76, z - 112) < 6.5;
  },
  surface(x, z) {
    // The salamander bridges' decks.
    if ((Math.abs(x - 84) < 1.8 && Math.abs(z - 106) < 23) || (Math.abs(z - 106) < 1.8 && Math.abs(x - 84) < 23)) return 0.75;
    return -Infinity;
  },
  tint(c, x, z, h) {
    const vd = Math.hypot(x + 76, z - 112);
    if (vd < 34) c.lerp(new THREE.Color('#2a2020'), (1 - vd / 34) * 0.6);
    if (vd < 10) c.lerp(new THREE.Color('#7a2a10'), 0.6);
    if (Math.hypot(x + 112, z + 64) < 26) c.lerp(new THREE.Color('#241c26'), 0.55);
  },
  build(ctx) {
    const { rand, add, heightAt, open } = ctx;
    const basalt = clay('#5a4a44', { roughness: 0.7, key: 'basalt' }), basaltD = clay('#3a302e', { roughness: 0.82, key: 'fBasalt' });
    const obsidian = new THREE.MeshStandardMaterial({ color: '#1a1022', roughness: 0.12, metalness: 0.35 });
    const ember = glowM('#ff6a1c', 2.2), brassM = clay('#d19a3e', { metalness: 0.55, roughness: 0.32, key: 'forgeBrass' });
    const bark = clay('#1e1614', { roughness: 0.85, key: 'charBark' });
    // --- The Obsidian Forest.
    { const L = this.landmarks[0];
      for (let i = 0; i < 80; i++) {
        const a = rand() * TAU, r = 3 + Math.sqrt(rand()) * 24, x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r;
        if (r < 4.5) continue;
        const h = 3 + rand() * 9, sp = M(new THREE.ConeGeometry(0.5 + rand() * 0.9, h, 5), obsidian, x, heightAt(x, z) + h / 2 - 0.3, z);
        sp.rotation.set((rand() - 0.5) * 0.25, rand() * 3, (rand() - 0.5) * 0.25); add(shadowAll(sp), h > 6 ? 0.9 : 0.6);
      }
      for (let i = 0; i < 30; i++) {
        const a = rand() * TAU, r = rand() * 22, x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r;
        const f = M(rbox(0.2, 0.06, 2 + rand() * 3, 0.02), ember, x, heightAt(x, z) + 0.04, z); f.rotation.y = rand() * 3; add(f, 0);
      }
      ctx.light('#9a4aff', 10, 26, L.x, heightAt(L.x, L.z) + 3, L.z);
    }
    // --- The Sunken Forge: toppled columns, a giant anvil, a carved gate and a cold furnace.
    { const L = this.landmarks[1], y0 = heightAt(L.x, L.z);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU, x = L.x + Math.sin(a) * 15, z = L.z + Math.cos(a) * 15, broken = rand() < 0.45;
        if (Math.abs(Math.atan2(Math.sin(a - Math.atan2(-L.x, -L.z)), Math.cos(a - Math.atan2(-L.x, -L.z)))) < 0.3) continue;
        if (broken) {
          const c = M(new THREE.CylinderGeometry(0.9, 0.9, 7, 6), basalt, x, heightAt(x, z) + 0.8, z); c.rotation.set(Math.PI / 2, 0, a + rand()); add(shadowAll(c), 1.2);
          add(shadowAll(M(new THREE.CylinderGeometry(0.95, 1.0, 1.5, 6), basalt, x, heightAt(x, z) + 0.75, z)), 1.0);
        } else {
          const h = 6 + rand() * 4, c = M(new THREE.CylinderGeometry(0.9, 1.0, h, 6), basalt, x, heightAt(x, z) + h / 2, z); add(shadowAll(c), 1.1);
          add(shadowAll(M(new THREE.CylinderGeometry(1.3, 1.3, 0.5, 6), basaltD, x, heightAt(x, z) + h + 0.2, z)), 0);
        }
      }
      const anv = prop('anvil'); if (anv) { anv.scale.setScalar(3.6); anv.position.set(L.x, y0 + 0.2, L.z); anv.rotation.y = 0.4; add(shadowAll(anv), 2.6); }
      const gate = new THREE.Group(), gx = L.x + 9, gz = L.z - 8;
      gate.add(M(new THREE.DodecahedronGeometry(7, 1), basaltD, 0, 2.5, -3)); gate.children[0].scale.set(1.4, 1.2, 0.8);
      gate.add(M(rbox(6, 8.5, 1, 0.3), basalt, 0, 4.25, 2.6));
      gate.add(M(rbox(3.4, 0.7, 0.6, 0.2), basaltD, 0, 6.2, 3.2));                // brow
      gate.add(M(new THREE.ConeGeometry(0.6, 1.8, 4), basaltD, 0, 4.9, 3.3));        // nose
      gate.add(M(rbox(3.6, 1.6, 0.5, 0.3), basaltD, 0, 2.8, 3.2));                 // beard
      for (const s of [-1, 1]) gate.add(M(new THREE.SphereGeometry(0.34, 12, 8), ember, s * 1.0, 5.6, 3.2));
      for (let k = 0; k < 5; k++) gate.add(M(rbox(0.12, 0.6, 0.06, 0.02), ember, -1.6 + k * 0.8, 1.2, 3.2));
      gate.position.set(gx, heightAt(gx, gz), gz); gate.rotation.y = -0.7; add(shadowAll(gate), 5);
      const fx = L.x - 7, fz = L.z - 7, furn = new THREE.Group();
      furn.add(M(new THREE.SphereGeometry(3.2, 20, 12, 0, TAU, 0, Math.PI / 2), basalt));
      furn.add(M(new THREE.CircleGeometry(1.2, 20, 0, Math.PI), glowM('#ff8a2a', 1.4), 0, 0, 3.15));
      furn.add(M(new THREE.CylinderGeometry(0.7, 0.9, 5, 10), basaltD, 0.6, 4.5, -0.5));
      furn.position.set(fx, heightAt(fx, fz), fz); furn.rotation.y = Math.atan2(L.x - fx, L.z - fz); add(shadowAll(furn), 3.3);
      for (let i = 0; i < 5; i++) {
        const a = rand() * TAU, r = 5 + rand() * 7, x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r;
        const gear = M(new THREE.TorusGeometry(1 + rand(), 0.25, 6, 14), brassM, x, heightAt(x, z) + 0.2, z); gear.rotation.set(Math.PI / 2 + (rand() - 0.5) * 0.5, 0, rand()); add(shadowAll(gear), 0);
      }
      ctx.light('#ff7a2a', 12, 24, L.x, y0 + 3, L.z);
    }
    // --- The Great Vent: lava fills its crater; it smokes and spits.
    { const L = this.landmarks[2], cy = heightAt(L.x, L.z);
      const pool = M(new THREE.CircleGeometry(7, 40), lavaMat(), L.x, cy + 0.6, L.z); pool.rotation.x = -Math.PI / 2; ctx.scene.add(pool);
      ctx.light('#ff5a14', 40, 60, L.x, cy + 6, L.z);
      for (let i = 0; i < 24; i++) {
        const a = rand() * TAU, r = 9 + rand() * 22, x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r;
        const rk = M(new THREE.DodecahedronGeometry(0.8 + rand() * 1.4, 0), basaltD, x, heightAt(x, z) + 0.3, z); rk.rotation.set(rand() * 3, rand() * 3, 0); add(shadowAll(rk), 0);
      }
      ctx.vents.push({ x: L.x, z: L.z, y: cy + 1.5, big: true, timer: 4 });
    }
    // --- The Salamander Bridges: stone bridges over a lava lake to an island and its statue.
    { const L = this.landmarks[3];
      const lake = M(new THREE.CircleGeometry(22, 48), lavaMat(), L.x, -0.55, L.z); lake.rotation.x = -Math.PI / 2; ctx.scene.add(lake);
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const deck = M(rbox(dx ? 46 : 3.6, 0.6, dz ? 46 : 3.6, 0.15), basalt, L.x, 0.45, L.z); add(shadowAll(deck), 0);
        for (let k = -3; k <= 3; k++) {
          if (k === 0) continue;
          const arch = M(new THREE.TorusGeometry(2.4, 0.5, 6, 14, Math.PI), basaltD, L.x + dx * k * 6, 0.1, L.z + dz * k * 6);
          arch.rotation.y = dx ? 0 : Math.PI / 2; arch.scale.y = 0.35; add(arch, 0);
          for (const s of [-1, 1]) add(shadowAll(M(rbox(0.3, 0.7, 0.3, 0.06), basaltD, L.x + dx * k * 6 + dz * s * 1.7, 1.1, L.z + dz * k * 6 + dx * s * 1.7)), 0);
        }
      }
      const sal = new THREE.Group(), stoneM = clay('#6a5a52', { key: 'salStone' });
      sal.add(M(new THREE.CapsuleGeometry(0.8, 2.6, 6, 12).rotateX(Math.PI / 2), stoneM, 0, 1.6, 0));
      sal.add(M(new THREE.SphereGeometry(0.75, 14, 10), stoneM, 0, 1.9, 2.1)); sal.children[1].scale.set(1, 0.7, 1.3);
      sal.add(new THREE.Mesh(taperGeo([[0, 1.5, -1.6], [1.2, 1.1, -3], [0.4, 0.8, -4.6], [-1, 1.2, -5.2]], 0.55, 0.08), stoneM));
      for (const s of [-1, 1]) for (const z of [0.9, -0.9]) sal.add(new THREE.Mesh(taperGeo([[s * 0.6, 1.4, z], [s * 1.3, 1.0, z + 0.3], [s * 1.4, 0.4, z + 0.6]], 0.22, 0.15), stoneM));
      for (const s of [-1, 1]) sal.add(M(new THREE.SphereGeometry(0.14, 8, 6), ember, s * 0.4, 2.1, 2.9));
      sal.position.set(L.x - 2.5, 0.7, L.z - 2.5); sal.rotation.y = 0.8; sal.scale.setScalar(0.9);
      add(shadowAll(sal), 1.5);
      ctx.light('#ff7a2a', 24, 40, L.x, 4, L.z);
    }
    // --- The wastes: basalt column clusters, charred trees, obsidian spires, extra vents.
    for (let i = 0; i < 150; i++) {
      const r = 60 + Math.sqrt(rand()) * 112, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 3)) continue;
      const g = new THREE.Group(), kind = rand();
      if (kind < 0.5) for (let k = 0; k < 6; k++) { const h = 1 + rand() * 4.5; g.add(M(new THREE.CylinderGeometry(0.5, 0.5, h, 6), rand() < 0.5 ? basalt : basaltD, (rand() - 0.5) * 2.2, h / 2, (rand() - 0.5) * 2.2)); }
      else if (kind < 0.8) g.add(deadTree(rand, 0.8 + rand() * 0.5, bark));
      else { const h = 5 + rand() * 7; g.add(M(new THREE.ConeGeometry(0.9 + rand(), h, 5), obsidian, 0, h / 2 - 0.2, 0)); }
      g.position.set(x, heightAt(x, z), z); g.rotation.y = rand() * 6; add(shadowAll(g), kind < 0.5 ? 1.4 : 0.7);
    }
    // Great broken mesas of layered rock.
    for (let i = 0; i < 16; i++) {
      const r = 70 + Math.sqrt(rand()) * 95, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 8)) continue;
      const g = new THREE.Group(), w = 5 + rand() * 5;
      for (let k = 0; k < 4; k++) g.add(M(new THREE.CylinderGeometry(w * (1 - k * 0.18), w * (1.05 - k * 0.18), 1.6 + rand(), 7), k % 2 ? basalt : clay('#6a3a28', { roughness: 0.8, key: 'rustRock' }), 0, 0.8 + k * 1.6, 0));
      g.position.set(x, heightAt(x, z) - 0.3, z); g.rotation.y = rand() * 6; add(shadowAll(g), w * 0.95);
    }
    for (let i = 0; i < 12; i++) {
      const r = 60 + rand() * 105, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 2)) continue;
      add(shadowAll(M(new THREE.ConeGeometry(1.2, 1.3, 10, 1, true), basalt, x, heightAt(x, z) + 0.3, z)), 0);
      ctx.vents.push({ x, z, y: heightAt(x, z) + 0.9, timer: 3 + rand() * 9 });
    }
    ctx.lanterns((x, z) => {
      const b = new THREE.Group();
      b.add(M(new THREE.CylinderGeometry(0.1, 0.14, 1.6, 6), basaltD, 0, 0.8, 0));
      b.add(M(new THREE.CylinderGeometry(0.4, 0.2, 0.35, 10), basalt, 0, 1.75, 0));
      const f = M(new THREE.ConeGeometry(0.25, 0.7, 8), glowM('#ffb347', 3), 0, 2.2, 0); f.userData.dynamic = true; f.userData.flicker = true; b.add(f);
      return b;
    });
    scatter(ctx, { geo: bladeGeo(), mat: clay('#ffffff', { roughness: 0.8, side: THREE.DoubleSide, key: 'scrub' }), count: 3500, scale: [0.5, 1.1], colors: ['#3a2a22', '#4a3428', '#5a3a26'] });
    scatter(ctx, { geo: new THREE.DodecahedronGeometry(0.25, 0), mat: clay('#2e2624', { roughness: 0.9, key: 'ashStone' }), count: 3500, scale: [0.4, 1.8], sink: 0.08 });
    scatter(ctx, { geo: new THREE.DodecahedronGeometry(0.16, 0), mat: glowM('#ff6a1c', 1.6), count: 900, scale: [0.4, 1.2], sink: 0.06 });
    scatter(ctx, { geo: new THREE.ConeGeometry(0.12, 0.7, 4), mat: obsidian, count: 900, scale: [0.5, 1.6], tilt: 0.7, sink: 0.1 });
  },
  tick(dt, t, ctx, player) {
    lavaU.uTime.value = t;
    for (const v of ctx.vents) {
      const near = Math.abs(v.x - player.pos.x) < 70 && Math.abs(v.z - player.pos.z) < 70;
      if (!near) continue;
      v.timer -= dt;
      if (Math.random() < dt * (v.big ? 14 : 4)) ctx.fx.spawn(v.x + (Math.random() - 0.5) * (v.big ? 6 : 1), v.y, v.z + (Math.random() - 0.5) * (v.big ? 6 : 1), (Math.random() - 0.5), v.big ? 4 + Math.random() * 3 : 2 + Math.random() * 2, (Math.random() - 0.5), new THREE.Color(v.big && Math.random() < 0.5 ? '#3a3230' : '#ffb347'), v.big ? 1.6 : 0.3, v.big ? 4 : 1, v.big ? -0.2 : 3, 0.2);
      if (v.timer <= 0) {
        v.timer = v.big ? 7 + Math.random() * 6 : 6 + Math.random() * 8;
        ctx.fx.burst(new THREE.Vector3(v.x, v.y + 0.5, v.z), { count: v.big ? 160 : 60, color: '#ff6a1c', speed: v.big ? 16 : 9, size: v.big ? 1 : 0.6, life: 1.4, gravity: 6, up: v.big ? 12 : 6 });
        const d = Math.hypot(player.pos.x - v.x, player.pos.z - v.z);
        if (!v.big && d < 4) { player.vel.x += (player.pos.x - v.x) / d * 10; player.vel.z += (player.pos.z - v.z) / d * 10; player.vel.y = 7; player.shake = 0.4; ctx.hazardHit('The vent erupts!'); }
      }
    }
  },
};

// ================================================================ Cryomancy: the white wastes
const GLACIER = {
  landmarks: [
    { id: 'armada', name: 'The Frozen Armada', x: -106, z: 72, r: 30, echoR: 32,
      lore: 'They sailed north to find the edge of winter. They found it, and it kept them.' },
    { id: 'giant', name: "The Giant's Rest", x: 112, z: -84, r: 22, echoR: 11,
      lore: 'A frost giant who swore he would never kneel. The ice took him at his word.' },
    { id: 'stones', name: 'The Aurora Stones', x: 102, z: 88, r: 28, echoR: 0,
      lore: 'On the longest night, the lights come down to stand among the stones and listen.' },
    { id: 'caves', name: 'The Hollow Caves', x: -88, z: -112, r: 26, echoR: 12,
      lore: 'Wind whistles through the caves in chords. Cryomancers tune their spells to them.' },
  ],
  pathColor: '#c8d6ea', pathEdge: '#a8b8d0', patches: ['#9fc4e4', '#f4f8fc', '#8a98b0', '#6a7488'],
  shape(h, x, z) {
    const bd = Math.hypot(x + 106, z - 72); h = lerp(h, 0, 1 - smoothstep(26, 30, bd));        // frozen bay
    const sd = Math.hypot(x - 102, z - 88); h += (1 - smoothstep(6, 30, sd)) * 9;              // stones hill
    const ex = (x + 88) / 42, ez = (z + 124) / 13, e = Math.hypot(ex, ez); h += (1 - smoothstep(0.35, 1, e)) * 18; // cave ridge
    return h;
  },
  ice: (x, z) => Math.hypot(x + 106, z - 72) < 26,
  tint(c, x, z) {
    const bd = Math.hypot(x + 106, z - 72);
    if (bd < 27) c.lerp(new THREE.Color('#7fc4e8'), 1 - smoothstep(23, 27, bd));
    const ex = (x + 88) / 42, ez = (z + 124) / 13; if (Math.hypot(ex, ez) < 0.9) c.lerp(new THREE.Color('#9fb4cc'), 0.4);
  },
  build(ctx) {
    const { rand, add, heightAt, open } = ctx;
    const ice = new THREE.MeshStandardMaterial({ color: '#a8e4ff', emissive: '#3fa8e8', emissiveIntensity: 0.35, roughness: 0.1, transparent: true, opacity: 0.88, flatShading: true });
    const snow = clay('#eef6fc', { roughness: 0.85, key: 'snow' }), rock = clay('#6a7488', { roughness: 0.8, key: 'coldRock' });
    const wood = clay('#4a3a2c', { key: 'boatWood' }), sail = clay('#b8b0a0', { side: THREE.DoubleSide, key: 'sail' });
    // --- The Frozen Armada: longships locked in a frozen bay.
    { const L = this.landmarks[0];
      const sheet = M(new THREE.CircleGeometry(26, 48), new THREE.MeshStandardMaterial({ color: '#bfe8ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55 }), L.x, 0.05, L.z);
      sheet.rotation.x = -Math.PI / 2; sheet.receiveShadow = true; ctx.scene.add(sheet); ctx.aoHide(sheet);
      const shieldCols = ['#8a2a2a', '#2a4a8a', '#c9a33a'];
      [[-6, 4, 0.5], [7, -5, 2.2], [2, 12, -0.9]].forEach(([dx, dz, yaw], si) => {
        const ship = new THREE.Group();
        const hull = M(new THREE.SphereGeometry(1, 16, 10, 0, TAU, Math.PI / 2, Math.PI / 2), wood); hull.scale.set(2, 1.6, 8); ship.add(hull);
        ship.add(M(rbox(3.4, 0.2, 13, 0.05), wood, 0, 0.05, 0));
        ship.add(new THREE.Mesh(taperGeo([[0, 0, 7.4], [0, 1.6, 8.6], [0, 3.4, 8.8], [0, 4.2, 8.0]], 0.35, 0.18), wood));
        ship.add(M(new THREE.SphereGeometry(0.45, 10, 8), wood, 0, 4.3, 7.8));
        ship.add(new THREE.Mesh(taperGeo([[0, 0, -7.4], [0, 1.4, -8.4], [0, 2.8, -8.2]], 0.3, 0.1), wood));
        ship.add(M(new THREE.CylinderGeometry(0.14, 0.18, 8, 8), wood, 0, 4, 0.5));
        const s = M(new THREE.PlaneGeometry(5, 3.6, 4, 4), sail, 0, 5.2, 0.7); const sp = s.geometry.attributes.position;
        for (let v = 0; v < sp.count; v++) sp.setZ(v, Math.sin(sp.getX(v) * 0.6) * 0.5 + (sp.getY(v) < -1.2 && Math.abs(sp.getX(v)) > 1 ? -0.4 : 0));
        s.geometry.computeVertexNormals(); ship.add(s);
        for (let k = -3; k <= 3; k++) for (const side of [-1, 1]) {
          const sh = M(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 14), clay(shieldCols[(k + 3 + si) % 3], { key: 'vshield' + ((k + 3 + si) % 3) }), side * 1.95, 0.35, k * 1.6);
          sh.rotation.z = Math.PI / 2; ship.add(sh);
        }
        const x = L.x + dx, z = L.z + dz; ship.position.set(x, -0.5, z); ship.rotation.set(0.12 * (si - 1), yaw, 0.18 * (si % 2 ? 1 : -1));
        add(shadowAll(ship), 0); ctx.collide(x + Math.sin(yaw) * 3.5, z + Math.cos(yaw) * 3.5, 2.2); ctx.collide(x - Math.sin(yaw) * 3.5, z - Math.cos(yaw) * 3.5, 2.2); ctx.collide(x, z, 2.2);
      });
      for (let i = 0; i < 16; i++) {
        const a = rand() * TAU, r = 6 + rand() * 18, f = M(new THREE.CylinderGeometry(1 + rand() * 1.5, 1.2 + rand() * 1.5, 0.4, 6), ice, L.x + Math.sin(a) * r, 0.1, L.z + Math.cos(a) * r);
        f.rotation.set((rand() - 0.5) * 0.3, rand() * 3, (rand() - 0.5) * 0.3); add(f, 0);
      }
    }
    // --- The Giant's Rest: a frost giant frozen mid-roar inside a block of ice.
    { const L = this.landmarks[1], y0 = heightAt(L.x, L.z), gi = new THREE.Group(), skin = clay('#4a5a74', { roughness: 0.6, key: 'giantSkin' });
      gi.add(M(rbox(4, 5, 2.6, 0.8), skin, 0, 6.5, 0));
      gi.add(M(new THREE.SphereGeometry(1.5, 16, 12), skin, 0, 10.2, 0.2));
      gi.add(M(new THREE.ConeGeometry(1.4, 1.6, 12), clay('#dfe8f0', { key: 'giantBeard' }), 0, 8.8, 1.2)); gi.children[2].rotation.x = Math.PI;
      for (const s of [-1, 1]) {
        gi.add(new THREE.Mesh(taperGeo([[s * 2.2, 8.4, 0], [s * 3.6, 10.4, 0.6], [s * 3.4, 12.6, 1.4]], 0.8, 0.6), skin));
        gi.add(M(new THREE.SphereGeometry(0.8, 10, 8), skin, s * 3.4, 12.9, 1.5));
        gi.add(new THREE.Mesh(taperGeo([[s * 1.1, 4.2, 0], [s * 1.3, 2.2, 0.6], [s * 1.2, 0.3, 0]], 0.9, 0.7), skin));
        gi.add(M(new THREE.SphereGeometry(0.2, 8, 6), glowM('#6fd8ff', 3), s * 0.5, 10.5, 1.5));
      }
      gi.position.set(L.x, y0, L.z); gi.rotation.y = Math.atan2(-L.x, -L.z); add(shadowAll(gi), 0);
      const block = M(rbox(10, 15, 7, 0.8), new THREE.MeshStandardMaterial({ color: '#c9eeff', emissive: '#3fa8e8', emissiveIntensity: 0.25, roughness: 0.05, transparent: true, opacity: 0.42, depthWrite: false }), L.x, y0 + 7.3, L.z);
      block.rotation.y = gi.rotation.y; ctx.scene.add(block); ctx.aoHide(block); ctx.collide(L.x, L.z, 5.6);
      const axe = new THREE.Group(); axe.add(M(new THREE.CylinderGeometry(0.2, 0.2, 9, 8), wood, 0, 4.5, 0));
      axe.add(M(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 16, 1, false, 0, Math.PI), clay('#8a9ab0', { metalness: 0.5, roughness: 0.3, key: 'axeHead' }), 0, 8, 0)); axe.children[1].rotation.set(Math.PI / 2, 0, Math.PI / 2);
      axe.position.set(L.x + 8, heightAt(L.x + 8, L.z + 3), L.z + 3); axe.rotation.set(0.5, 0.4, 1.1); add(shadowAll(axe), 0);
      for (let i = 0; i < 8; i++) { const a = rand() * TAU, r = 7 + rand() * 8, x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r; const d = M(new THREE.SphereGeometry(1.6, 12, 8), snow, x, heightAt(x, z) - 0.3, z); d.scale.set(1.4, 0.45, 1); add(d, 0); }
    }
    // --- The Aurora Stones: a ring of rune monoliths on a hill, with a pillar of northern light.
    { const L = this.landmarks[2], y0 = heightAt(L.x, L.z), stoneM = clay('#5a6478', { roughness: 0.8, key: 'auroraStone' });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU, x = L.x + Math.sin(a) * 11, z = L.z + Math.cos(a) * 11, h = 4.5 + rand() * 2;
        const st = new THREE.Group(); st.add(M(rbox(1.5, h, 0.9, 0.25), stoneM, 0, h / 2, 0));
        const r = new THREE.Mesh(new THREE.PlaneGeometry(0.8, h * 0.7), new THREE.MeshBasicMaterial({ map: runeStripTexture('#9fffe0'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        r.position.set(0, h * 0.5, -0.46); r.rotation.y = Math.PI; st.add(r);
        st.add(M(rbox(1.7, 0.4, 1.1, 0.15), snow, 0, h + 0.1, 0));
        st.position.set(x, heightAt(x, z) - 0.2, z); st.rotation.y = a; add(shadowAll(st), 1.0);
      }
      const beam = M(new THREE.CylinderGeometry(1.2, 3.5, 90, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#7affd0', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), L.x, y0 + 45, L.z);
      ctx.scene.add(beam); ctx.aoHide(beam); ctx.beams.push(beam);
      ctx.light('#7affd0', 26, 40, L.x, y0 + 5, L.z);
    }
    // --- The Hollow Caves: an ice-rimmed cave mouth in a long ridge, with a frozen fall.
    { const L = this.landmarks[3], mx = -88, mz = -110.5, my = heightAt(mx, mz);
      const mouth = new THREE.Group();
      mouth.add(M(new THREE.CircleGeometry(4.2, 32, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#0a1a2e' }), 0, 0, -0.4));
      mouth.add(M(new THREE.CircleGeometry(3.4, 32, 0, Math.PI), glowM('#1f5a98', 0.9), 0, 0, -0.3));
      mouth.add(M(new THREE.TorusGeometry(4.4, 0.8, 8, 24, Math.PI), ice));
      for (let i = 0; i < 16; i++) { const a = (i / 15) * Math.PI, ic = M(new THREE.ConeGeometry(0.18, 0.8 + rand() * 1.6, 5), ice, Math.cos(a) * 4.2, Math.sin(a) * 4.2 - 0.9, 0.3); ic.rotation.x = Math.PI; mouth.add(ic); }
      mouth.position.set(mx, my - 0.3, mz); mouth.rotation.y = 0.1; add(mouth, 0);
      ctx.light('#6fd8ff', 18, 26, mx, my + 2, mz + 3);
      const fall = M(new THREE.PlaneGeometry(4, 12, 4, 8), ice, mx + 11, heightAt(mx + 11, mz - 1) + 5, mz - 1); add(fall, 0);
      for (let i = 0; i < 10; i++) {
        const x = mx + (rand() - 0.5) * 30, z = mz + 2 + rand() * 6, c = new THREE.Group();
        for (let k = 0; k < 5; k++) { const cr = M(crystalGeo(0.3 + rand() * 0.3, 1.5 + rand() * 3), ice, (rand() - 0.5) * 1.6, 0, (rand() - 0.5) * 1.6); cr.rotation.set((rand() - 0.5) * 0.6, rand() * 3, (rand() - 0.5) * 0.6); c.add(cr); }
        c.position.set(x, heightAt(x, z), z); add(c, 0.8);
      }
    }
    // --- The white wastes: pine forests, ice spike fields, snow-capped boulders.
    for (let f = 0; f < 26; f++) {
      const r = 62 + rand() * 100, a = rand() * TAU, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      if (!open(cx, cz, 6)) continue;
      for (let i = 0; i < 14; i++) {
        const x = cx + (rand() - 0.5) * 22, z = cz + (rand() - 0.5) * 22;
        if (!open(x, z, 1)) continue;
        const p = pine(rand, 0.8 + rand() * 0.7); p.position.set(x, heightAt(x, z), z); p.rotation.y = rand() * 6; add(shadowAll(p), 0.9);
      }
    }
    // Wind-scoured rock ridges breaking through the snow.
    for (let i = 0; i < 26; i++) {
      const r = 65 + Math.sqrt(rand()) * 100, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 5)) continue;
      const g = new THREE.Group();
      for (let k = 0; k < 5; k++) { const rk = M(new THREE.DodecahedronGeometry(1.2 + rand() * 1.8, 0), rock, (k - 2) * 2.2, 0.6 + rand(), (rand() - 0.5) * 1.5); rk.rotation.set(rand() * 3, rand() * 3, 0); rk.scale.set(1, 1.3, 0.8); g.add(rk); const cap = M(new THREE.SphereGeometry(1.1, 10, 6, 0, TAU, 0, Math.PI / 2), snow, (k - 2) * 2.2, 1.8 + rand() * 0.8, 0); cap.scale.set(1, 0.4, 0.9); g.add(cap); }
      g.position.set(x, heightAt(x, z), z); g.rotation.y = rand() * 6; add(shadowAll(g), 3.5);
    }
    for (let i = 0; i < 130; i++) {
      const r = 60 + Math.sqrt(rand()) * 110, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 2)) continue;
      const g = new THREE.Group();
      if (rand() < 0.5) for (let k = 0; k < 5; k++) { const s = M(new THREE.ConeGeometry(0.3 + rand() * 0.5, 2 + rand() * 4, 6), ice, (rand() - 0.5) * 2, 1.2, (rand() - 0.5) * 2); s.rotation.set((rand() - 0.5) * 0.6, rand() * 3, (rand() - 0.5) * 0.6); g.add(s); }
      else { g.add(M(new THREE.DodecahedronGeometry(1.2 + rand(), 0), rock, 0, 0.5, 0)); const cap = M(new THREE.SphereGeometry(1.1, 10, 6, 0, TAU, 0, Math.PI / 2), snow, 0, 1.2, 0); cap.scale.y = 0.5; g.add(cap); }
      g.position.set(x, heightAt(x, z), z); add(shadowAll(g), 1.1);
    }
    ctx.lanterns((x, z) => {
      const l = new THREE.Group();
      l.add(M(rbox(0.35, 1.8, 0.35, 0.08), rock, 0, 0.9, 0));
      l.add(M(crystalGeo(0.22, 0.9), glowM('#9fe8ff', 2.2), 0, 1.8, 0));
      l.add(M(new THREE.SphereGeometry(0.3, 8, 6, 0, TAU, 0, Math.PI / 2), snow, 0, 1.78, 0));
      return l;
    });
    scatter(ctx, { geo: bladeGeo(), mat: clay('#ffffff', { roughness: 0.8, side: THREE.DoubleSide, key: 'frostGrass' }), count: 5500, scale: [0.6, 1.2], colors: ['#b8c8d8', '#9fb4c8', '#c8d8e4', '#8aa0b4'] });
    scatter(ctx, { geo: new THREE.SphereGeometry(0.6, 10, 6, 0, TAU, 0, Math.PI / 2), mat: snow, count: 700, scale: [0.5, 1.8], sink: 0.15 });
    scatter(ctx, { geo: new THREE.DodecahedronGeometry(0.2, 0), mat: clay('#8fa4c0', { roughness: 0.6, key: 'icePebble' }), count: 1600, scale: [0.4, 1.5], sink: 0.06 });
    scatter(ctx, { geo: crystalGeo(0.08, 0.5), mat: glowM('#bfefff', 0.8), count: 700, scale: [0.6, 1.6], tilt: 0.6 });
  },
  tick(dt, t, ctx) { ctx.beams.forEach((b) => { b.material.opacity = 0.1 + Math.sin(t * 0.8) * 0.04; b.rotation.y += dt * 0.1; }); },
};

const LANDS = { necromancy: CRYPT, pyromancy: CALDERA, cryomancy: GLACIER, geomancy: DEEP };

// ---------------------------------------------------------------- Land: layers + builder
export class Land {
  constructor(id, theme) {
    this.def = LANDS[id];
    this.theme = theme;
    this.landmarks = this.def.landmarks.map((L) => {
      const er = L.echoR ?? L.r * 0.5, a = Math.atan2(-L.x, -L.z);
      return { ...L, ex: L.x + Math.sin(a) * er, ez: L.z + Math.cos(a) * er };
    });
    this.life = LIFE[id] || this.def.life || {};
    this.paths = [...this.landmarks.map((L, i) => makePath(L.x, L.z, i * 2.3 + id.length)), ...(this.life.roads?.() || [])];
    this.bridges = []; // auto-built where paths cross the realm's own lava
    this.tmp = new THREE.Color();
  }

  pathDist(x, z) { return pathDist(this.paths, x, z); }

  height(base, x, z) {
    const d = Math.hypot(x, z), flat = this.theme.flatAt ? this.theme.flatAt(x, z) : 0;
    const outer = smoothstep(48, 90, d) * (1 - flat);
    let h = base;
    if (outer > 0) {
      const pd = this.pathDist(x, z);
      // Patchy, zero-mean hills (positive-only where a lava sheet lies beneath the ground).
      const n = fbm(x * 0.011 + 3, z * 0.011 - 7, 3) * 9;
      const rolling = this.def.positiveHills ? Math.max(0, n) : n;
      const bumps = fbm(x * 0.035, z * 0.035, 2) * 1.4 * smoothstep(1.5, 5, pd);
      h += outer * (rolling + (this.def.positiveHills ? Math.abs(bumps) : bumps));
    }
    h = this.def.shape(h, x, z);
    return this.life.shape ? this.life.shape(h, x, z) : h;
  }

  color(c, x, z, h, up) {
    // Broad patches of the realm's ground palette (moss & heather, ash & rust, snow & blue ice).
    const pal = this.def.patches;
    if (pal && Math.hypot(x, z) > 30) {
      const n1 = fbm(x * 0.02 + 11, z * 0.02 - 4, 3), n2 = fbm(x * 0.045 - 3, z * 0.045 + 9, 2);
      c.lerp(this.tmp.set(pal[0]), smoothstep(0.05, 0.4, n1) * 0.55);
      c.lerp(this.tmp.set(pal[1]), smoothstep(0.1, 0.45, -n1) * 0.5);
      c.lerp(this.tmp.set(pal[2]), smoothstep(0.2, 0.5, n2) * 0.4);
      c.lerp(this.tmp.set(pal[3]), smoothstep(0.85, 0.6, up) * 0.6); // steep ground shows rock
    }
    this.def.tint?.(c, x, z, h);
    const pd = this.pathDist(x, z);
    if (pd < 2.6) c.lerp(new THREE.Color(pd < 1.6 ? this.def.pathColor : this.def.pathEdge), smoothstep(2.6, 1.3, pd) * 0.85);
  }

  onBridge(x, z) {
    return this.bridges.some((b) => {
      const dx = x - b.x, dz = z - b.z, along = dx * Math.sin(b.a) + dz * Math.cos(b.a), across = dx * Math.cos(b.a) - dz * Math.sin(b.a);
      return Math.abs(along) < b.len / 2 && Math.abs(across) < 1.9;
    });
  }
  surfaceAt(x, z) {
    let h = this.def.surface ? this.def.surface(x, z) : -Infinity;
    if (this.onBridge(x, z)) h = Math.max(h, 0.5);
    return h;
  }
  lavaAt(x, z) { return !!this.def.lava?.(x, z); }
  iceAt(x, z) { return !!this.def.ice?.(x, z); }
  slowAt(x, z) { return !!this.def.bog?.(x, z) || !!this.life.slow?.(x, z); }

  // ctx: { scene, rand, add(obj, r), collide(x, z, r), heightAt, fx, aoHide, reserved(x, z, pad), hazardHit }
  build(ctx) {
    const def = this.def;
    Object.assign(ctx, { vents: [], beams: [], bobbers: [], graves: [] });
    ctx.light = (color, intensity, dist, x, y, z) => { const l = new THREE.PointLight(color, intensity, dist, 1.6); l.position.set(x, y, z); ctx.scene.add(l); return l; };
    // Open ground for props: outside the hub, off the paths, clear of landmarks and hazards.
    ctx.open = (x, z, pad = 0) => Math.hypot(x, z) > 55 + pad && Math.hypot(x, z) < WORLD_R - 12
      && this.pathDist(x, z) > 3.5 + pad && !this.landmarks.some((L) => Math.hypot(x - L.x, z - L.z) < L.r + pad)
      && !this.hazard(x, z);
    // Ground scatter: anywhere except hazards, paths and the hub's key spots.
    const baseOpen = ctx.open;
    ctx.open = (x, z, pad) => (pad === undefined ? this.groundOk(x, z, ctx) : baseOpen(x, z, pad));
    ctx.scatter = (o) => scatter(ctx, o);
    ctx.kit = { bladeGeo };
    // Auto-bridges where paths cross the realm's own lava rivers (or the Deep's underground river).
    const crossing = this.theme.lavaAt || def.bridgeOver;
    if (crossing) {
      const basalt = clay(def.bridgeColor || '#5a4a44', { roughness: 0.7, key: 'bridge' + (def.bridgeColor || 'basalt') });
      this.paths.forEach((p) => {
        let run = null;
        alongPaths([p], 0.5, (x, z, a) => {
          const hot = crossing(x, z);
          if (hot && !run) run = { x0: x, z0: z, a };
          if (!hot && run) {
            const len = Math.hypot(x - run.x0, z - run.z0) + 5, cx = (x + run.x0) / 2, cz = (z + run.z0) / 2;
            this.bridges.push({ x: cx, z: cz, a: run.a, len });
            const deck = M(rbox(3.6, 0.6, len, 0.15), basalt, cx, 0.2, cz); deck.rotation.y = run.a; ctx.add(shadowAll(deck), 0);
            for (const s of [-1, 1]) { const rail = M(rbox(0.3, 0.6, len, 0.08), basalt, cx + Math.cos(run.a) * s * 1.7, 0.7, cz - Math.sin(run.a) * s * 1.7); rail.rotation.y = run.a; ctx.add(rail, 0); }
            run = null;
          }
        });
      });
    }
    // Path lanterns, alternating sides.
    ctx.lanterns = (make) => {
      let side = 1;
      alongPaths(this.paths, 15, (x, z, a) => {
        side = -side;
        const lx = x + Math.cos(a) * side * 2.4, lz = z - Math.sin(a) * side * 2.4;
        if (Math.hypot(lx, lz) < 40 || this.hazard(lx, lz) || this.onBridge(lx, lz)) return;
        const l = make(); l.position.set(lx, ctx.heightAt(lx, lz), lz); ctx.add(shadowAll(l), 0.3);
        (this.lanternSpots ||= []).push({ x: lx, z: lz });
      });
    };
    def.build.call({ ...def, landmarks: this.landmarks }, ctx);
    ctx.landPaths = this.paths;
    this.life.build?.(ctx);
    // Echo stones at every landmark.
    this.echoes = this.landmarks.map((L) => {
      const st = echoStone(ctx.color);
      st.position.set(L.ex, ctx.heightAt(L.ex, L.ez), L.ez);
      st.rotation.y = Math.atan2(-L.ex, -L.ez);
      ctx.scene.add(st);
      ctx.collide(L.ex, L.ez, 0.9);
      const dyn = []; st.traverse((o) => { if (o.userData.echoGlyph || o.userData.echoRing) dyn.push(o); });
      return { L, group: st, dyn };
    });
    this.ctx = ctx;
  }

  hazard(x, z) {
    return (this.theme.lavaAt?.(x, z) && !this.onBridge(x, z)) || this.lavaAt(x, z) || this.theme.iceAt?.(x, z) || this.iceAt(x, z) || this.slowAt(x, z);
  }
  groundOk(x, z, ctx) {
    if (this.hazard(x, z) || this.pathDist(x, z) < 1.4 || ctx.reserved(x, z, 0)) return false;
    return !this.landmarks.some((L) => Math.hypot(x - L.ex, z - L.ez) < 3);
  }

  tick(dt, t, player, fx) {
    if (!this.ctx) return;
    this.def.tick?.(dt, t, this.ctx, player);
    this.life.tick?.(dt, t, this.ctx, player);
    for (const e of this.echoes) {
      if (Math.abs(e.L.ex - player.pos.x) > 80 || Math.abs(e.L.ez - player.pos.z) > 80) continue;
      e.dyn.forEach((o) => { if (o.userData.echoGlyph) { o.rotation.y += dt * 1.2; o.position.y = 5 + Math.sin(t * 1.6) * 0.25; } else o.rotation.z += dt * 0.3; });
    }
  }
}

// Shared building blocks for realmlife.js (the realms' living set pieces).
export const landKit = { M, rbox, taperGeo, deadTree, pine, gravestone, glowM, crystalGeo, shadowAll, scatter, bladeGeo, TAU, lavaMat, pathDist, segDist };
