import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, passRoadHeight, bleedAt, slopeAt, WATER_LEVEL, TUNNEL_LEN, TUNNEL_DROP, TUNNEL_HALF } from './world.js';
import { SCHOOLS, SHRINES, REALM_PASSES, PASS_LIP, THRESHOLD_IN, passPoint } from './data.js';
import { clay } from './style.js';
import { mulberry32 } from './util.js';

// The ways to the other realms. Each realm lies beyond the valley's mountain ring in its direction
// on the atlas, and a road climbs to where the mountain stands up in front of it. There the way
// goes in, built for the land beyond:
//   the Deep      — the Old Mine: a timber-shored adit, rails running down into the dark
//   the Caldera   — the Cinder Road: a basalt cleft, braziers and a lava channel, heat ahead
//   the Hollow    — the Glacier Cave: an arch of blue ice under snow
//   the Crypt     — the Barrow Gate: standing stones and an iron gate into a hillside barrow
// Walk a few steps in and you are through. The same mouth stands in the realm, so you step out of
// the very place you went in. A locked way is caved in, walled with lava, frozen or chained.
// Far out past the ring, each realm shows itself on the valley's horizon: a crystal-veined crag, a
// smoking volcano, snow peaks, a ruined cathedral.
//
// Before you reach the road, the realm is already seeping into the valley (world.js bleedAt):
// snow and pines toward the Hollow, graves and grey grass toward the Crypt, ochre rock and
// crystals toward the Deep, ash, basalt and glowing cracks toward the Caldera.
const BLEED_IDS = ['necromancy', 'geomancy', 'cryomancy', 'pyromancy'];
const ARCH_H = 4.6;                                   // clear height of a mouth
const SLOPE = Math.atan2(TUNNEL_DROP, TUNNEL_LEN);    // the way in runs gently downhill

const merge = (...gs) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)));
const glow = (color, k = 1.8) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
const mesh = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; return m; };

// Soft billboard puffs (the volcano's smoke plume).
function puffMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec4 aPuff; attribute vec4 aTint; uniform float uTime;
      varying vec2 vUv; varying vec4 vTint;
      void main() {
        vUv = uv; vTint = aTint;
        float rise = mod(uTime * 2.0 + aPuff.w * 3.0, 40.0);
        vec3 c = aPuff.xyz + vec3(sin(uTime * 0.05 + aPuff.y * 0.02) * 12.0 + rise * 0.8, rise, cos(uTime * 0.04 + aPuff.x) * 8.0);
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * aPuff.w;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying vec4 vTint;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.2, r) * vTint.a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vTint.rgb, a);
      }`,
  });
}

// The top of a low elliptical dome (a snow drift) at local (x, z), or -Infinity off it.
const domeAt = (domes, x, z) => {
  let h = -Infinity;
  for (const d of domes) { const u = (x - d.x) / d.rx, v = (z - d.z) / d.rz, q = 1 - u * u - v * v; if (q > 0) h = Math.max(h, d.h * Math.sqrt(q)); }
  return h;
};

// ------------------------------------------------------------------ the mouths
// Built in local space: the mouth at z = 0 facing -z (where you come from), the way running into
// +z. `flat` (in a realm) keeps the floor level instead of sloping down into the mountain.

// The inside: a half-pipe shaded from `mouth` at the entrance to `deep` at the far end (black
// underground; the lava's glow at the end of the cleft; glacier light in the ice).
function tunnel(mouth, deep, flat, rock) {
  const g = new THREE.Group(), L = TUNNEL_LEN + 2, R = TUNNEL_HALF + 0.15;
  const shade = (geo) => {
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), a = new THREE.Color(mouth), b = new THREE.Color(deep), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { c.copy(a).lerp(b, Math.min(1, Math.max(0, p.getZ(i) / TUNNEL_LEN)) ** 0.6).toArray(col, i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  };
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  const tall = (ARCH_H - 0.1) / R; // as high inside as the mouth
  const pipe = new THREE.CylinderGeometry(R, R, L, 20, 14, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, tall, 1).translate(0, 0, L / 2 + 0.3);
  const floor = new THREE.PlaneGeometry(R * 2, L, 1, 14).rotateX(-Math.PI / 2).translate(0, 0.03, L / 2 + 0.3);
  g.add(new THREE.Mesh(shade(pipe), mat), new THREE.Mesh(shade(floor), new THREE.MeshBasicMaterial({ vertexColors: true })));
  // Seen from above (the camera, high behind you), the tunnel is a ridge of the same rock.
  if (rock) g.add(mesh(new THREE.CylinderGeometry(R + 0.4, R + 0.4, L, 14, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, (ARCH_H + 0.4) / (R + 0.4), 1).translate(0, 0, L / 2 + 0.3), rock));
  const cap = new THREE.Mesh(new THREE.CircleGeometry(R, 20, 0, Math.PI).scale(1, tall, 1), new THREE.MeshBasicMaterial({ color: deep }));
  cap.position.z = L + 0.3; cap.rotation.y = Math.PI;
  g.add(cap);
  if (!flat) g.rotation.x = SLOPE;
  return g;
}

// The rock the way is cut into: a cliff of angular, flat-shaded crags. Jambs of stacked blocks
// frame the mouth under a heavy lintel slab, and stepped rows of tall slabs rise behind and beside
// it, each row set back and higher, banded with strata. A craggy roof runs back over the tunnel
// (in the valley the mountain stands behind it; in a realm it is a hill of its own).
function crag(w, h, d, rnd) {
  const g = new THREE.BoxGeometry(w, h, d, 2, 3, 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), top = y > -h / 2 + 0.01, k = (y + h / 2) / h; // keep the base flat on the ground
    const taper = 1 - k * 0.14;
    p.setXYZ(i, p.getX(i) * taper + (top ? (rnd() - 0.5) * w * 0.22 : 0), y + (top && k > 0.99 ? (rnd() - 0.5) * h * 0.1 : top ? (rnd() - 0.5) * h * 0.06 : 0), p.getZ(i) * taper + (top ? (rnd() - 0.5) * d * 0.22 : 0));
  }
  const out = g.toNonIndexed(); out.computeVertexNormals();
  return out;
}
function rockFace(mat, rnd, { snow = null, hill = false, ground = () => 0, flat = false } = {}) {
  const geos = [], caps = [];
  const base = new THREE.Color(mat.color || '#8a7160');
  const place = (x, y, z, w, h, d, ry = (rnd() - 0.5) * 0.35) => {
    const g = crag(w, h, d, rnd).rotateY(ry).translate(x, y + h / 2, z);
    // Strata: bands of lighter and darker rock by height, and a little variation per block.
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(), shade = 0.9 + rnd() * 0.2;
    for (let i = 0; i < pos.count; i++) { const band = Math.sin(pos.getY(i) * 1.7 + x * 0.1) > 0.35 ? 0.82 : 1; c.copy(base).multiplyScalar(shade * band).toArray(col, i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
    if (snow && y + h > ARCH_H + 1) caps.push(new THREE.BoxGeometry(w * 0.98, 0.32, d * 0.98).rotateY(ry).translate(x, y + h + 0.1, z));
  };
  const J = TUNNEL_HALF;
  // Jambs: stacked blocks either side of the mouth.
  for (const side of [-1, 1]) {
    let y = 0;
    for (let k = 0; k < 3; k++) { const w = 1.7 + rnd() * 0.6, h = 1.6 + rnd() * 0.8; place(side * (J + w / 2 - 0.05), y, 1.1 + rnd() * 0.4, w, h, 2.2 + rnd() * 0.6, (rnd() - 0.5) * 0.12); y += h - 0.05; }
  }
  // The lintel: one heavy slab over the mouth, and a block or two on it.
  place(0, ARCH_H - 0.05, 1.2, J * 2 + 2.8, 1.5, 2.6, (rnd() - 0.5) * 0.06);
  place(-1.2 + rnd(), ARCH_H + 1.4, 2.2, 3.4, 2 + rnd(), 3, undefined);
  place(1.6 + rnd(), ARCH_H + 1.4, 2.6, 3, 1.6 + rnd(), 3, undefined);
  // The cliff: rows of tall slabs rooted in the ground, each row set back and standing taller, so
  // it steps up like a real crag face (nothing floats against the mountain behind).
  const rows = hill ? [[1.8, 3, 5.5]] : [[-1.2, 7, 11], [2.8, 5, 9], [6.4, 6, 11]]; // the first stands in front of the mountain's face
  for (const [z0, hMin, hMax] of rows) {
    for (const side of [-1, 1]) {
      let x = J + 1.9 + rnd() * 0.6;
      while (x < (hill ? 12 : 17)) {
        const w = 2.4 + rnd() * 2.2;
        const px = side * (x + w / 2), pz = z0 + rnd() * 1.6, gy = ground(px, pz);
        place(px, gy - 1.6, pz, w, hMin + rnd() * (hMax - hMin) + Math.max(0, gy) * 0.5, 3 + rnd() * 1.5);
        x += w * 0.8;
      }
    }
  }
  // Over the mouth, blocks rest on the tunnel's roof, climbing back to the cliff's height.
  if (!hill) for (const [z, h] of [[4.5, 4], [7.5, 6.5], [10.5, 9]]) for (let x = -J - 0.8; x <= J + 0.8; x += 2.9) place(x + (rnd() - 0.5) * 0.6, ARCH_H + 0.9 - (flat ? 0 : z * TUNNEL_DROP / TUNNEL_LEN), z + rnd(), 3.1, h * (0.8 + rnd() * 0.4), 3.2);
  // A craggy roof running back over the tunnel.
  for (let z = 3.5; z < TUNNEL_LEN + 3; z += 2.8) {
    const y = ARCH_H + 0.8 - (hill || flat ? 0 : z * TUNNEL_DROP / TUNNEL_LEN);
    place((rnd() - 0.5) * 1.2, y, z, J * 2 + 3 + rnd(), 1.4 + rnd() * 1.2, 3.2);
    if (hill) for (const side of [-1, 1]) place(side * (J + 1.6 + rnd() * 0.5), 0, z, 2.4, y + 0.8, 3.1);
  }
  const g = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: mat.roughness ?? 0.85, flatShading: true });
  g.add(mesh(merge(...geos), rockMat));
  if (caps.length) g.add(mesh(merge(...caps), snow, false));
  return g;
}

// One realm's mouth: the rock, the inside, what's built at the entrance, and how it's barred.
function buildMouth(id, color, rnd, { flat = false, ground, hill = false } = {}) {
  const root = new THREE.Group(), open = new THREE.Group(), locked = new THREE.Group();
  const flames = [], glows = [], cols = [], domes = [];
  root.add(open, locked);
  const col = (x, z, radius) => cols.push({ x, z, radius });
  const inside = (y, z) => y - (flat ? 0 : z * TUNNEL_DROP / TUNNEL_LEN); // floor height inside at depth z
  if (id === 'geomancy') {
    // The Old Mine: rock with crystal seams, a shored adit, rails down into the dark, a cart outside.
    const wood = clay('#8a5f38', { roughness: 0.85, key: 'mineWood' }), iron = clay('#55504f', { roughness: 0.5, key: 'mineIron' });
    const rust = clay('#7a4a30', { roughness: 0.7, key: 'mineRust' }), rock = clay('#8a7160', { roughness: 0.85, key: 'mineRock' });
    root.add(rockFace(rock, rnd, { hill, flat, ground }), tunnel('#3a2c22', '#000000', flat, rock));
    for (const z of [0.3, 5, 10]) { // shoring frames, the first at the mouth
      const y = inside(0, z), f = new THREE.Group();
      for (const side of [-1, 1]) f.add(mesh(new RoundedBoxGeometry(0.42, ARCH_H, 0.42, 2, 0.06).translate(side * (TUNNEL_HALF - 0.25), ARCH_H / 2, 0), wood));
      f.add(mesh(new RoundedBoxGeometry(TUNNEL_HALF * 2 + 0.5, 0.5, 0.5, 2, 0.08).translate(0, ARCH_H, 0), wood));
      f.position.set(0, y, z); root.add(f);
    }
    const lampMat = glow('#ffc46a', 2.2); glows.push({ mat: lampMat, k: 2.2 });
    for (const [x, z] of [[-(TUNNEL_HALF - 0.25), -0.1], [TUNNEL_HALF - 0.25, -0.1], [0, 5]]) {
      const lamp = mesh(new RoundedBoxGeometry(0.34, 0.46, 0.34, 2, 0.06), lampMat, false);
      lamp.position.set(x, inside(ARCH_H - 0.55, z), z); root.add(lamp);
    }
    // Rails: out along the road, then down into the mountain.
    const rails = (z0, z1, y0, y1) => {
      const len = z1 - z0, a = Math.atan2(y0 - y1, len), g = new THREE.Group();
      for (const x of [-0.62, 0.62]) g.add(mesh(new THREE.BoxGeometry(0.1, 0.1, len).translate(x, 0.11, len / 2), iron));
      const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.08, 0.26), wood, Math.floor(len / 0.9)), m = new THREE.Matrix4();
      for (let i = 0; i < sl.count; i++) sl.setMatrixAt(i, m.makeTranslation(0, 0.04, 0.45 + i * 0.9));
      sl.receiveShadow = true; g.add(sl);
      g.position.set(0, y0, z0); g.rotation.x = a; return g;
    };
    root.add(rails(-12, 0, 0, 0), rails(0, TUNNEL_LEN, 0, inside(0, TUNNEL_LEN)));
    // A cart full of crystal, waiting outside.
    const cart = new THREE.Group();
    cart.add(mesh(new RoundedBoxGeometry(1.35, 0.8, 1.9, 2, 0.1).translate(0, 0.78, 0), rust));
    for (const [x, z] of [[-0.62, -0.6], [0.62, -0.6], [-0.62, 0.6], [0.62, 0.6]]) cart.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 12).rotateZ(Math.PI / 2).translate(x, 0.3, z), iron));
    const gem = glow('#b68cff', 1.4); glows.push({ mat: gem, k: 1.4 });
    cart.add(mesh(merge(new THREE.ConeGeometry(0.22, 0.9, 6).translate(-0.25, 1.4, 0.2), new THREE.ConeGeometry(0.18, 0.7, 6).rotateZ(0.4).translate(0.25, 1.3, -0.2), new THREE.ConeGeometry(0.2, 0.8, 6).rotateZ(-0.3).translate(0.1, 1.35, 0.5)), gem, false));
    cart.position.set(0, 0, -7.5); root.add(cart); col(0, -7.5, 1.1);
    // Crystal seams breaking out of the rock round the mouth.
    const seam = glow('#9d7bff', 1.6); glows.push({ mat: seam, k: 1.6 });
    const shards = [];
    for (let k = 0; k < 7; k++) { const side = k % 2 ? 1 : -1, h = 0.8 + rnd() * 1.1; shards.push(new THREE.ConeGeometry(0.2 + rnd() * 0.15, h, 6).rotateZ(side * (0.5 + rnd() * 0.5)).translate(side * (TUNNEL_HALF + 1 + rnd() * 1.5), 1 + rnd() * 4.5, -0.4 + rnd() * 0.5)); }
    root.add(mesh(merge(...shards), seam, false));
    // Caved in: rubble to the lintel, and two boards nailed across.
    const rubble = [];
    for (let k = 0; k < 11; k++) rubble.push(new THREE.DodecahedronGeometry(0.7 + rnd() * 0.6, 0).translate((rnd() - 0.5) * 4, 0.5 + rnd() * 3.2, 0.3 + rnd() * 1.4));
    locked.add(mesh(merge(...rubble), rock));
    for (const r of [-0.45, 0.45]) locked.add(mesh(new THREE.BoxGeometry(TUNNEL_HALF * 2 + 0.6, 0.34, 0.12).rotateZ(r).translate(0, 2.2, -0.2), wood));
  } else if (id === 'pyromancy') {
    // The Cinder Road: a cleft in black basalt, columns either side, braziers, and a channel of lava
    // running beside the road into the mountain. The far end of the cleft glows.
    const basalt = clay('#2e2826', { roughness: 0.7, key: 'cinderBasalt' }), rock = clay('#3c322e', { roughness: 0.8, key: 'cinderRock' });
    const iron = clay('#4a403c', { roughness: 0.5, key: 'cinderIron' });
    root.add(rockFace(rock, rnd, { hill, flat, ground }), tunnel('#2a1a16', '#ff5a1a', flat, rock));
    const cols6 = [];
    for (const side of [-1, 1]) for (let k = 0; k < 5; k++) { const h = 4.5 + rnd() * 4.5; cols6.push(new THREE.CylinderGeometry(0.5, 0.56, h, 6).translate(side * (TUNNEL_HALF + 0.7 + (k % 3) * 0.95), h / 2, -0.8 + Math.floor(k / 3) * 0.9 + rnd() * 0.3)); }
    root.add(mesh(merge(...cols6), basalt));
    const fire = glow('#ff7a1c', 2.6);
    for (const side of [-1, 1]) {
      const x = side * (TUNNEL_HALF + 1.2), z = -3;
      const b = new THREE.Group();
      b.add(mesh(new THREE.CylinderGeometry(0.32, 0.46, 1.2, 6).translate(0, 0.6, 0), basalt), mesh(new THREE.CylinderGeometry(0.7, 0.42, 0.35, 10).translate(0, 1.35, 0), iron));
      const f = mesh(merge(new THREE.ConeGeometry(0.42, 1.1, 7).translate(0, 0.55, 0), new THREE.ConeGeometry(0.26, 0.8, 7).translate(0.18, 0.4, 0.1)), fire, false);
      f.position.y = 1.5; b.add(f); flames.push(f);
      b.position.set(x, 0, z); root.add(b); col(x, z, 0.7);
    }
    // The lava channel beside the road, fed from inside the cleft.
    const lava = glow('#ff6a1c', 2.2); glows.push({ mat: lava, k: 2.2 });
    const ch = new THREE.Group(), x = TUNNEL_HALF + 1.1;
    for (let z = -25.5; z <= -0.5; z += 0.9) col(x, z, 0.55); // the channel's curbs keep you out of it
    ch.add(mesh(new THREE.BoxGeometry(0.7, 0.06, 26).translate(x, 0.04, -13), lava, false));
    for (const dx of [-0.5, 0.5]) ch.add(mesh(new THREE.BoxGeometry(0.28, 0.22, 26).translate(x + dx, 0.1, -13), basalt));
    root.add(ch);
    // Walled: a slab of cooled lava, still cracked with heat.
    locked.add(mesh(new RoundedBoxGeometry(TUNNEL_HALF * 2 + 0.5, ARCH_H + 0.3, 1.4, 3, 0.35).translate(0, (ARCH_H + 0.3) / 2, 0.6), basalt));
    const cracks = [], crack = glow('#ff5a1a', 1.3);
    for (let k = 0; k < 6; k++) cracks.push(new THREE.BoxGeometry(0.07, 0.8 + rnd() * 1.4, 0.05).rotateZ((rnd() - 0.5) * 1.6).translate((rnd() - 0.5) * 3.8, 0.8 + rnd() * 3.2, -0.12));
    locked.add(mesh(merge(...cracks), crack, false));
  } else if (id === 'cryomancy') {
    // The Glacier Cave: an arch of blue ice in snowy rock, icicles, drifts, glacier light within.
    const rock = clay('#8b97a6', { roughness: 0.8, key: 'glacierRock' }), snow = clay('#f6fbff', { roughness: 0.6, key: 'glacierSnow' });
    const ice = new THREE.MeshStandardMaterial({ color: '#bfeaff', emissive: '#5fbfff', emissiveIntensity: 0.3, roughness: 0.1, transparent: true, opacity: 0.85, flatShading: true });
    glows.push({ mat: ice, k: 0.3 });
    root.add(rockFace(rock, rnd, { snow, hill, flat, ground }), tunnel('#bfe4f2', '#3aa6ff', flat, snow));
    const chunks = [];
    for (let k = 0; k <= 12; k++) { const t = (k / 12) * Math.PI, r = 0.62 + rnd() * 0.3; chunks.push(new THREE.OctahedronGeometry(r, 0).scale(1, 1.3, 0.8).rotateY(rnd() * 3).translate(-Math.cos(t) * (TUNNEL_HALF + 0.35), Math.sin(t) * (ARCH_H - 0.1) + 0.3, 0.1 + rnd() * 0.3)); }
    const drips = [];
    for (let k = 0; k < 11; k++) { const h = 0.5 + rnd() * 1.1; drips.push(new THREE.ConeGeometry(0.1 + rnd() * 0.08, h, 5).rotateX(Math.PI).translate(-2 + k * 0.4 + (rnd() - 0.5) * 0.2, ARCH_H - 0.1 - h / 2, -0.15)); }
    root.add(mesh(merge(...chunks, ...drips), ice, false));
    const drifts = [];
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
      const r = 1.2 + rnd() * 0.8, x = side * (TUNNEL_HALF + 1.4 + k * 1.6), z = -1.6 - rnd() * 3;
      drifts.push(new THREE.SphereGeometry(r, 12, 7).scale(1, 0.32, 1.1).translate(x, 0, z));
      domes.push({ x, z, rx: r, rz: r * 1.1, h: r * 0.32 }); // drifts are snow you walk up onto
    }
    root.add(mesh(merge(...drifts), snow));
    // Frozen shut: a wall of thick ice filling the arch.
    const wall = new THREE.MeshStandardMaterial({ color: '#d6f2ff', emissive: '#6fc8ff', emissiveIntensity: 0.2, roughness: 0.05, transparent: true, opacity: 0.93, flatShading: true });
    locked.add(mesh(new THREE.DodecahedronGeometry(1, 1).scale(TUNNEL_HALF + 0.3, ARCH_H / 2 + 0.2, 0.8).translate(0, ARCH_H / 2, 0.5), wall));
  } else {
    // The Barrow Gate: a grassy mound, standing stones and a lintel, an iron gate, green lamps,
    // and steps going down into the dark.
    const earth = clay('#59624f', { roughness: 0.9, key: 'barrowEarth' }), stone = clay('#8f8c98', { roughness: 0.75, key: 'barrowStone' });
    const iron = clay('#2c2a30', { roughness: 0.45, key: 'barrowIron' });
    root.add(rockFace(earth, rnd, { hill, flat, ground }), tunnel('#2c342e', '#050806', flat, earth));
    for (const side of [-1, 1]) root.add(mesh(new RoundedBoxGeometry(1.0, ARCH_H + 0.6, 1.0, 2, 0.14).translate(side * (TUNNEL_HALF + 0.3), (ARCH_H + 0.6) / 2, -0.2), stone));
    root.add(mesh(new RoundedBoxGeometry(TUNNEL_HALF * 2 + 2.4, 0.85, 1.2, 2, 0.16).translate(0, ARCH_H + 0.9, -0.2), stone));
    const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(TUNNEL_HALF * 2 - 0.3, 0.16, 0.9), stone, 10), m = new THREE.Matrix4();
    for (let i = 0; i < 10; i++) steps.setMatrixAt(i, m.makeTranslation(0, inside(flat ? -0.05 : 0.05, 1 + i * 1.4), 1 + i * 1.4)); // flush with a level floor
    steps.receiveShadow = true; root.add(steps);
    // The gate: two leaves of bars. Open, they stand swung back inside; locked, shut and chained.
    const leaf = () => {
      const w = TUNNEL_HALF - 0.1, parts = [];
      for (let k = 0; k < 5; k++) parts.push(new THREE.CylinderGeometry(0.05, 0.05, ARCH_H - 0.3, 6).translate(0.25 + k * (w - 0.3) / 4, (ARCH_H - 0.3) / 2, 0));
      for (const y of [0.5, ARCH_H - 0.6]) parts.push(new THREE.BoxGeometry(w, 0.1, 0.08).translate(w / 2, y, 0));
      return merge(...parts);
    };
    for (const side of [-1, 1]) {
      const geo = leaf(); if (side > 0) geo.scale(-1, 1, 1);
      const pivot = new THREE.Vector3(side * -(TUNNEL_HALF - 0.1), 0, 0.2);
      const shut = mesh(geo.clone(), iron); shut.position.copy(pivot); locked.add(shut);
      const swung = mesh(geo, iron); swung.position.copy(pivot); swung.rotation.y = side * -Math.PI * 0.55; open.add(swung);
    }
    const links = [];
    for (let k = 0; k < 7; k++) links.push(new THREE.TorusGeometry(0.12, 0.035, 5, 10).rotateY(k % 2 ? Math.PI / 2 : 0).translate(-0.72 + k * 0.24, 2.1, 0.08));
    links.push(new RoundedBoxGeometry(0.34, 0.4, 0.14, 2, 0.04).translate(0, 1.82, 0.05));
    locked.add(mesh(merge(...links), clay('#6d6660', { roughness: 0.4, key: 'barrowChain' }), false));
    const lamp = glow('#7dffb0', 1.9); glows.push({ mat: lamp, k: 1.9 });
    for (const side of [-1, 1]) {
      const x = side * (TUNNEL_HALF + 1.7), z = -3.2;
      root.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.3, 6).translate(x, 1.15, z), iron), mesh(new RoundedBoxGeometry(0.36, 0.48, 0.36, 2, 0.06).translate(x, 2.45, z), lamp, false));
      col(x, z, 0.4);
    }
  }
  dressMouth(id, root, rnd, { col, glows, flames, flat });
  return { root, open, locked, flames, glows, cols, domes };
}

// ------------------------------------------------------------------ dressing
// The approach to each mouth, in local space (the road runs along -z to the mouth at z = 0; it
// stays clear for |x| < 2.4). Pieces are merged per material, and the big ones are solid.
function dressMouth(id, root, rnd, { col, glows, flames, flat }) {
  const parts = new Map();
  const put = (mat, geo) => { if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(geo.index ? geo.toNonIndexed() : geo); };
  const R = (lo, hi) => lo + rnd() * (hi - lo);
  const side = () => (rnd() < 0.5 ? -1 : 1);
  if (id === 'geomancy') {
    const wood = clay('#7a5230', { roughness: 0.85, key: 'mineWoodDark' }), plank = clay('#a07448', { roughness: 0.8, key: 'minePlank' });
    const iron = clay('#55504f', { roughness: 0.5, key: 'mineIron' }), sack = clay('#b89a6a', { roughness: 0.95, key: 'oreSack' }), stone = clay('#7a6452', { roughness: 0.9, key: 'spoil' });
    const gold = glow('#ffc24a', 1.2); glows.push({ mat: gold, k: 1.2 });
    const lamp = glow('#ffc46a', 2.2); glows.push({ mat: lamp, k: 2.2 });
    // The sign over the mouth: a board with crossed pickaxes.
    put(plank, new RoundedBoxGeometry(3.4, 0.9, 0.16, 2, 0.05).translate(0, ARCH_H + 0.95, -0.55));
    for (const s of [-1, 1]) {
      put(wood, new THREE.BoxGeometry(0.1, 1.5, 0.08).rotateZ(s * 0.75).translate(0, ARCH_H + 0.95, -0.66));
      put(iron, new THREE.ConeGeometry(0.1, 0.62, 4).rotateZ(Math.PI / 2 + s * 0.75).translate(s * -0.45, ARCH_H + 1.45, -0.68));
    }
    // Barrels and crates by the left jamb; ore sacks glinting with gold on the right.
    for (const [x, z, h] of [[-3.6, -2.2, 0], [-4.5, -3.1, 0], [-3.9, -3.4, 1.05]]) {
      put(wood, new THREE.CylinderGeometry(0.46, 0.4, 1.05, 12).translate(x, h + 0.525, z));
      for (const y of [0.18, 0.87]) put(iron, new THREE.TorusGeometry(0.45, 0.035, 5, 16).rotateX(Math.PI / 2).translate(x, h + y, z));
    }
    col(-4, -2.9, 1.2);
    for (const [x, z, y, s] of [[-5.2, -1.4, 0, 1], [-5.4, -2.5, 0, 0.9], [-5.3, -1.9, 0.95, 0.8]]) put(plank, new RoundedBoxGeometry(s, s, s, 2, 0.05).rotateY(rnd() * 0.4).translate(x, y + s / 2, z));
    for (let k = 0; k < 5; k++) { const x = R(3.4, 4.8), z = R(-4.2, -1.8); put(sack, new THREE.SphereGeometry(0.42, 10, 8).scale(1, 0.8, 0.9).translate(x, 0.32, z)); put(gold, new THREE.OctahedronGeometry(0.12, 0).translate(x + R(-0.2, 0.2), 0.68, z + R(-0.2, 0.2))); }
    col(4.1, -3, 1.2);
    // A pickaxe and a shovel against the right jamb.
    put(wood, new THREE.CylinderGeometry(0.045, 0.045, 1.5, 6).rotateZ(-0.35).translate(TUNNEL_HALF + 0.95, 0.72, -0.9));
    put(iron, new THREE.BoxGeometry(0.8, 0.1, 0.1).rotateZ(-0.35 + Math.PI / 2 * 0.1).translate(TUNNEL_HALF + 0.72, 1.42, -0.9));
    put(wood, new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6).rotateZ(0.25).translate(TUNNEL_HALF + 1.5, 0.7, -1.1));
    put(iron, new RoundedBoxGeometry(0.34, 0.42, 0.05, 1, 0.02).translate(TUNNEL_HALF + 1.65, 0.18, -1.1));
    // A loading platform on stilts to the left, with a ladder.
    const px = -6.4, pz = -5.5, ph = 2.2;
    put(plank, new THREE.BoxGeometry(2.8, 0.16, 2.4).translate(px, ph, pz));
    for (const [dx, dz] of [[-1.25, -1.05], [1.25, -1.05], [-1.25, 1.05], [1.25, 1.05]]) put(wood, new THREE.BoxGeometry(0.2, ph, 0.2).translate(px + dx, ph / 2, pz + dz));
    for (const dx of [-1.3, 1.3]) put(wood, new THREE.BoxGeometry(0.08, 0.08, 2.4).translate(px + dx, ph + 0.7, pz));
    for (const dz of [-1.1, 1.1]) put(wood, new THREE.BoxGeometry(2.7, 0.08, 0.08).translate(px, ph + 0.7, pz + dz));
    for (const s of [-1, 1]) put(wood, new THREE.BoxGeometry(0.07, 2.6, 0.07).rotateX(-0.28).translate(px + 1.6 + s * 0.24, 1.1, pz - 1.2 - 0.36));
    for (let k = 0; k < 6; k++) put(wood, new THREE.BoxGeometry(0.5, 0.05, 0.05).translate(px + 1.6, 0.25 + k * 0.38, pz - 1.2 - 0.62 + k * 0.105));
    col(px, pz, 1.6);
    // A spoil heap beside the rails, a buffer stop at their end, and a lantern post by the road.
    for (let k = 0; k < 14; k++) put(stone, new THREE.DodecahedronGeometry(R(0.25, 0.6), 0).translate(R(2.6, 4.8), R(0.1, 0.5), R(-9.5, -6.5)));
    col(3.7, -8, 1.3);
    put(wood, new THREE.BoxGeometry(1.8, 0.35, 0.3).translate(0, 0.45, -12.1)); for (const s of [-0.7, 0.7]) put(wood, new THREE.BoxGeometry(0.2, 0.6, 0.2).translate(s, 0.3, -12));
    const lx = -2.9, lz = -10;
    put(wood, new THREE.BoxGeometry(0.18, 3, 0.18).translate(lx, 1.5, lz)); put(wood, new THREE.BoxGeometry(0.9, 0.12, 0.12).translate(lx + 0.4, 2.95, lz));
    put(iron, new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4).translate(lx + 0.75, 2.7, lz)); put(lamp, new RoundedBoxGeometry(0.28, 0.38, 0.28, 2, 0.05).translate(lx + 0.75, 2.4, lz));
    col(lx, lz, 0.35);
  } else if (id === 'pyromancy') {
    const obs = new THREE.MeshStandardMaterial({ color: '#1a1420', roughness: 0.18, metalness: 0.35, flatShading: true });
    const basalt = clay('#2e2826', { roughness: 0.7, key: 'cinderBasalt' }), crust = clay('#241c1a', { roughness: 0.6, key: 'lavaCrust' });
    const cloth = clay('#6a1c14', { roughness: 0.9, side: THREE.DoubleSide, key: 'charBanner' }), bone = clay('#d8ccb0', { roughness: 0.75, key: 'cinderBone' }), iron = clay('#4a403c', { roughness: 0.5, key: 'cinderIron' });
    const rune = glow('#ff8a2a', 2.4); glows.push({ mat: rune, k: 2.4 });
    const lava = glow('#ff6a1c', 2.2); glows.push({ mat: lava, k: 2.2 });
    // Obsidian obelisks either side of the approach, banded with glowing runes.
    for (const s of [-1, 1]) for (const z of [-6, -11]) {
      const x = s * 4.1, h = 4.2 + rnd() * 1.2;
      put(obs, new THREE.CylinderGeometry(0.42, 0.62, h, 4).rotateY(Math.PI / 4).translate(x, h / 2, z));
      put(obs, new THREE.ConeGeometry(0.44, 0.9, 4).rotateY(Math.PI / 4).translate(x, h + 0.45, z));
      for (const y of [h * 0.35, h * 0.62]) put(rune, new THREE.CylinderGeometry(0.5, 0.52, 0.12, 4).rotateY(Math.PI / 4).translate(x, y, z));
      col(x, z, 0.6);
    }
    // A fall of lava down the cliff to the left of the mouth, into a pool.
    const fx = -(TUNNEL_HALF + 2.2), fz = -1.1; // against the jamb, in view from the road
    put(lava, new THREE.CylinderGeometry(0.35, 0.7, 7.2, 8, 1, true).translate(fx, 3.6, fz));
    put(lava, new THREE.CircleGeometry(1.5, 20).rotateX(-Math.PI / 2).translate(fx - 0.3, 0.06, fz - 1.3));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; put(basalt, new THREE.DodecahedronGeometry(0.4, 0).translate(fx - 0.3 + Math.cos(a) * 1.6, 0.15, fz - 1.3 + Math.sin(a) * 1.6)); }
    col(fx - 0.3, fz - 1.3, 1.8);
    // Cooled flows across the ground, cracked with heat, and small vents glowing.
    for (const [x, z, w, d, a] of [[-4.5, -4, 3.2, 1.6, 0.4], [5.2, -8.5, 3.6, 1.8, -0.3], [4.6, -3, 2.2, 1.2, 0.9]]) {
      put(crust, new THREE.CylinderGeometry(1, 1, 0.14, 9).scale(w / 2, 1, d / 2).rotateY(a).translate(x, -0.03, z)); // nearly flush: a skin of rock, not a step
      for (let k = 0; k < 3; k++) put(lava, new THREE.BoxGeometry(w * 0.6, 0.03, 0.05).rotateY(a + (k - 1) * 0.5).translate(x, 0.045, z));
    }
    for (const [x, z] of [[-5.8, -8.2], [6.2, -5.6], [5.6, -12]]) { put(basalt, new THREE.ConeGeometry(0.7, 0.55, 8, 1, true).translate(x, 0.27, z)); put(lava, new THREE.CircleGeometry(0.32, 10).rotateX(-Math.PI / 2).translate(x, 0.5, z)); }
    // Obsidian shards breaking out of the ground.
    for (let k = 0; k < 9; k++) { const s = side(), x = s * R(4.2, 7), z = R(-13, -2), h = R(0.8, 2.2); put(obs, new THREE.ConeGeometry(R(0.2, 0.4), h, 5).rotateZ(s * R(0.1, 0.5)).translate(x, h / 2 - 0.1, z)); }
    // Charred banners on iron poles, and a horned skull above the mouth.
    for (const s of [-1, 1]) {
      const x = s * 2.9, z = -2.6;
      put(iron, new THREE.CylinderGeometry(0.06, 0.07, 4.2, 6).translate(x, 2.1, z)); put(iron, new THREE.BoxGeometry(1.1, 0.07, 0.07).translate(x - s * 0.5, 4.1, z));
      const bn = new THREE.PlaneGeometry(0.9, 2.2, 1, 4), bp = bn.attributes.position; for (let i = 0; i < bp.count; i++) { const y = bp.getY(i); bp.setX(i, bp.getX(i) + Math.sin(y * 2.5) * 0.08); if (y < -0.9) bp.setX(i, bp.getX(i) * (Math.abs(bp.getX(i)) > 0.2 ? 1 : 0.4)); }
      put(cloth, bn.translate(x - s * 0.5, 2.95, z));
      col(x, z, 0.25);
    }
    put(bone, new THREE.SphereGeometry(0.55, 12, 9).scale(1, 0.85, 0.9).translate(0, ARCH_H + 1.1, -0.72));
    put(crust, new THREE.BoxGeometry(0.5, 0.18, 0.1).translate(0, ARCH_H + 0.8, -1.16));
    for (const s of [-1, 1]) { put(bone, taperTube([new THREE.Vector3(s * 0.4, ARCH_H + 1.25, -0.7), new THREE.Vector3(s * 1.0, ARCH_H + 1.5, -0.8), new THREE.Vector3(s * 1.2, ARCH_H + 1.05, -1.0)], 0.16, 0.03, 10, 6)); put(rune, new THREE.SphereGeometry(0.09, 6, 5).translate(s * 0.2, ARCH_H + 1.12, -1.18)); }
  } else if (id === 'cryomancy') {
    const pine = clay('#2f5a4c', { roughness: 0.85, key: 'frostPine' }), bark = clay('#4a3a30', { roughness: 0.9, key: 'frostBark' }), snow = clay('#f6fbff', { roughness: 0.6, key: 'glacierSnow' });
    const wood = clay('#8a6a4a', { roughness: 0.85, key: 'sledWood' }), rope = clay('#c8b890', { roughness: 0.95, key: 'frostRope' }), cloth = clay('#3a6aa0', { roughness: 0.9, side: THREE.DoubleSide, key: 'frostBanner' });
    const ice = new THREE.MeshStandardMaterial({ color: '#9fdcff', emissive: '#3aa6ff', emissiveIntensity: 0.55, roughness: 0.08, transparent: true, opacity: 0.88, flatShading: true });
    glows.push({ mat: ice, k: 0.55 });
    const crystal = glow('#8fe8ff', 1.4); glows.push({ mat: crystal, k: 1.4 });
    // Snowy pines either side of the approach.
    for (const [x, z, s] of [[-5.6, -4, 1.1], [-7.2, -8.5, 1.35], [-5.2, -12, 0.95], [6, -5.5, 1.25], [7.4, -10.5, 1.1], [5.4, -13.5, 0.9], [-8.4, -1.8, 0.9], [8.6, -2.6, 1]]) {
      put(bark, new THREE.CylinderGeometry(0.14 * s, 0.2 * s, 1 * s, 6).translate(x, 0.5 * s, z));
      [[1.3, 1.9, 1.5], [1.0, 1.6, 2.5], [0.7, 1.3, 3.4]].forEach(([r, h, y]) => { put(pine, new THREE.ConeGeometry(r * s, h * s, 8).translate(x, y * s, z)); put(snow, new THREE.ConeGeometry(r * s * 0.72, h * s * 0.42, 8).translate(x, (y + h * 0.33) * s, z)); });
      col(x, z, 0.8 * s);
    }
    // A frozen waterfall down the cliff to the right of the mouth, and its spill of ice.
    for (let k = 0; k < 5; k++) put(ice, new THREE.CylinderGeometry(R(0.22, 0.4), R(0.35, 0.6), 7, 7).translate(TUNNEL_HALF + 1.7 + k * 0.34 + R(-0.08, 0.08), 3.5, -1 + R(-0.15, 0.15)));
    for (let k = 0; k < 6; k++) put(ice, new THREE.DodecahedronGeometry(R(0.4, 0.7), 0).scale(1.3, 0.6, 1).translate(R(TUNNEL_HALF + 1.4, TUNNEL_HALF + 3.6), 0.2, R(-2.2, -0.9)));
    col(TUNNEL_HALF + 2.4, -1.6, 1.3);
    // Glowing ice crystals, a sled with a lashed load, snow-capped crates and a banner.
    for (let k = 0; k < 6; k++) { const s = side(), x = s * R(3.4, 5), z = R(-12, -2); for (let j = 0; j < 3; j++) put(crystal, new THREE.OctahedronGeometry(R(0.18, 0.32), 0).scale(0.6, 2.2, 0.6).rotateZ(R(-0.4, 0.4)).translate(x + R(-0.3, 0.3), 0.4, z + R(-0.3, 0.3))); }
    const sx = 3.6, sz = -6.2;
    for (const d of [-0.42, 0.42]) put(wood, taperTube([new THREE.Vector3(sx + d, 0.08, sz - 1.1), new THREE.Vector3(sx + d, 0.08, sz + 0.9), new THREE.Vector3(sx + d, 0.35, sz + 1.25)], 0.05, 0.05, 8, 5));
    put(wood, new THREE.BoxGeometry(1.05, 0.08, 2).translate(sx, 0.3, sz - 0.1));
    put(rope, new RoundedBoxGeometry(0.8, 0.5, 1.2, 2, 0.12).translate(sx, 0.6, sz - 0.2));
    col(sx, sz, 1.1);
    for (const [x, z] of [[-3.8, -2.4], [-4.4, -3.3]]) { put(wood, new RoundedBoxGeometry(0.9, 0.9, 0.9, 2, 0.05).translate(x, 0.45, z)); put(snow, new RoundedBoxGeometry(0.95, 0.18, 0.95, 2, 0.08).translate(x, 0.95, z)); }
    col(-4.1, -2.9, 1);
    put(wood, new THREE.CylinderGeometry(0.06, 0.07, 3.6, 6).translate(-2.9, 1.8, -1.6)); put(cloth, new THREE.PlaneGeometry(0.8, 1.6).translate(-2.9 + 0.42, 2.7, -1.6));
    put(ice, new THREE.OctahedronGeometry(0.22, 0).translate(-2.9 + 0.42, 2.9, -1.63));
    // A rope railing along the approach.
    for (const s of [-1, 1]) {
      const pts = []; for (let z = -13; z <= -2; z += 2.2) { const x = s * 2.7; put(wood, new THREE.CylinderGeometry(0.06, 0.07, 1.1, 6).translate(x, 0.55, z)); put(snow, new THREE.SphereGeometry(0.09, 6, 5).translate(x, 1.12, z)); pts.push(new THREE.Vector3(x, 0.95, z)); col(x, z, 0.12); }
      for (let i = 0; i < pts.length - 1; i++) put(rope, taperTube([pts[i], pts[i].clone().lerp(pts[i + 1], 0.5).setY(0.78), pts[i + 1]], 0.025, 0.025, 8, 4));
    }
    // Icicles hanging from the lintel ledges.
    for (let k = 0; k < 16; k++) { const h = R(0.4, 1.2), x = R(-5.5, 5.5); if (Math.abs(x) < TUNNEL_HALF + 0.3) continue; put(ice, new THREE.ConeGeometry(R(0.06, 0.14), h, 5).rotateX(Math.PI).translate(x, ARCH_H + 0.3 - h / 2, -0.35)); }
  } else {
    const stone = clay('#8f8c98', { roughness: 0.75, key: 'barrowStone' }), moss = clay('#4a6a3a', { roughness: 0.95, side: THREE.DoubleSide, key: 'barrowMoss' });
    const bark = clay('#3a302c', { roughness: 0.9, key: 'barrowBark' }), bone = clay('#d8d0bc', { roughness: 0.75, key: 'barrowBone' }), iron = clay('#2c2a30', { roughness: 0.45, key: 'barrowIron' }), wax = clay('#e8e0c8', { roughness: 0.8, key: 'barrowWax' });
    const rune = glow('#7dffb0', 1.8); glows.push({ mat: rune, k: 1.8 });
    const flame = glow('#b8ffcf', 2.6); glows.push({ mat: flame, k: 2.6 });
    // Standing stones lining the approach, some leaning, cut with glowing runes.
    for (const [x, z, h, lean] of [[-4, -3.5, 3.4, 0.05], [4.2, -4, 3, -0.12], [-4.6, -8, 2.6, 0.18], [4.8, -8.6, 3.2, 0.02], [-5.2, -12.6, 2.2, -0.2], [5.4, -13, 2.8, 0.1]]) {
      put(stone, crag(0.95, h, 0.55, rnd).rotateZ(lean).translate(x, 0, z));
      for (let k = 0; k < 3; k++) { const y = h * 0.62 - 0.3 * k; put(rune, new THREE.BoxGeometry(k === 1 ? 0.3 : 0.07, k === 1 ? 0.07 : 0.24, 0.04).rotateZ(lean).translate(x - Math.sin(lean) * y, y, z - 0.29)); } // carved in the face toward the road
      col(x, z, 0.55);
    }
    // Twisted dead trees with a lantern hanging from a branch.
    for (const [x, z, s] of [[-7.6, -5.5, 1.1], [7.8, -9.5, 1]]) {
      put(bark, taperTube([new THREE.Vector3(x, 0, z), new THREE.Vector3(x + 0.3 * s, 2 * s, z + 0.2), new THREE.Vector3(x - 0.2 * s, 3.8 * s, z - 0.1)], 0.32 * s, 0.1 * s, 12, 6));
      for (const [bx, by, bz] of [[1.6, 3.6, 0.3], [-1.4, 3.2, -0.4], [0.6, 4.6, -0.8], [-0.8, 4.3, 0.9]]) put(bark, taperTube([new THREE.Vector3(x, by * s * 0.72, z), new THREE.Vector3(x + bx * 0.55 * s, by * s * 0.9, z + bz * 0.5), new THREE.Vector3(x + bx * s, by * s, z + bz)], 0.11 * s, 0.025, 8, 5));
      put(iron, new THREE.CylinderGeometry(0.015, 0.015, 0.6, 4).translate(x + 1.45 * s, 3.25 * s, z + 0.28)); put(flame, new RoundedBoxGeometry(0.22, 0.3, 0.22, 2, 0.04).translate(x + 1.45 * s, 2.85 * s, z + 0.28));
      col(x, z, 0.45);
    }
    // Cairns, candle clusters and bones by the gate.
    for (const [x, z] of [[-3.2, -6], [3.3, -11.2]]) { let y = 0; for (let k = 0; k < 4; k++) { const r = 0.5 - k * 0.1; put(stone, new THREE.DodecahedronGeometry(r, 0).scale(1, 0.6, 1).translate(x + R(-0.06, 0.06), y + r * 0.55, z)); y += r * 1.05; } col(x, z, 0.5); }
    for (const [x, z] of [[-TUNNEL_HALF - 0.6, -0.9], [TUNNEL_HALF + 0.6, -0.9], [-2.9, -2.2], [2.9, -2.4]]) for (let k = 0; k < 4; k++) {
      const h = R(0.18, 0.45), cx = x + R(-0.25, 0.25), cz = z + R(-0.2, 0.2);
      put(wax, new THREE.CylinderGeometry(0.05, 0.055, h, 6).translate(cx, h / 2, cz)); put(flame, new THREE.ConeGeometry(0.035, 0.12, 5).translate(cx, h + 0.07, cz));
    }
    for (let k = 0; k < 5; k++) put(bone, new THREE.CylinderGeometry(0.035, 0.03, R(0.35, 0.6), 5).rotateZ(Math.PI / 2).rotateY(rnd() * 3).translate(side() * R(2.8, 4), 0.04, R(-5, -1.5)));
    // Moss hanging from the lintel, and a skull keystone set in it.
    for (let k = 0; k < 10; k++) { const x = R(-TUNNEL_HALF - 1, TUNNEL_HALF + 1), h = R(0.5, 1.4); put(moss, new THREE.PlaneGeometry(R(0.25, 0.5), h).translate(x, ARCH_H + 0.48 - h / 2, -0.84)); }
    put(bone, new THREE.SphereGeometry(0.34, 12, 9).scale(1, 1.05, 0.85).translate(0, ARCH_H + 0.9, -0.86));
    put(bone, new THREE.BoxGeometry(0.34, 0.16, 0.2).translate(0, ARCH_H + 0.6, -0.92));
    for (const s of [-1, 1]) put(rune, new THREE.SphereGeometry(0.07, 6, 5).translate(s * 0.12, ARCH_H + 0.93, -1.14));
  }
  for (const [mat, geos] of parts) root.add(mesh(merge(...geos), mat, !(mat.emissiveIntensity > 1)));
  void flames; void flat;
}

// ------------------------------------------------------------------ the horizon
// Each realm, seen from the valley over the mountain ring. Fog would swallow anything this far
// out, so these do their own: aerial perspective that is thick at the foot (so they rise out of
// the misted ridge in front) and thins toward the summit, in the sky's colour of the moment.
const HAZE = { uFog: { value: new THREE.Color('#cfe6f5') } };
function hazeMaterial(color, { foot = 0.85, top = 0.18, y0 = 10, y1 = 120, lit = true, vcol = false } = {}) {
  return new THREE.ShaderMaterial({
    fog: false, vertexColors: vcol,
    uniforms: { uFog: HAZE.uFog, uCol: { value: new THREE.Color(color) }, uFoot: { value: foot }, uTop: { value: top }, uY: { value: new THREE.Vector2(y0, y1) }, uLit: { value: lit ? 1 : 0 } },
    vertexShader: `
      varying vec3 vW; varying vec3 vC;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        #ifdef USE_COLOR
          vC = color;
        #else
          vC = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uFog, uCol; uniform float uFoot, uTop, uLit; uniform vec2 uY; varying vec3 vW; varying vec3 vC;
      void main() {
        vec3 cr = cross(dFdx(vW), dFdy(vW));
        vec3 n = dot(cr, cr) > 1e-12 ? normalize(cr) : vec3(0.0, 1.0, 0.0); // (a zero normal would be NaN: black)
        float l = mix(1.0, 0.42 + 0.7 * max(dot(n, normalize(vec3(0.45, 0.8, -0.35))), 0.0), uLit);
        float haze = mix(uFoot, uTop, smoothstep(uY.x, uY.y, vW.y));
        gl_FragColor = vec4(mix(uCol * vC * l, uFog, haze), 1.0);
      }`,
  });
}

// A soft radial glow (the crater's light on its own smoke).
let SOOT = null;
function sootGlow() {
  if (SOOT) return SOOT;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  SOOT = new THREE.CanvasTexture(cv); SOOT.colorSpace = THREE.SRGBColorSpace; return SOOT;
}

// A tube whose radius tapers from r0 to r1 along a path (lava streams).
function taperTube(pts, r0, r1, seg = 48, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(pts), geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c); const r = r0 + (r1 - r0) * (i / seg);
    for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c); pos.setXYZ(k, v.x, v.y, v.z); }
  }
  return geo;
}

// The volcano's smoke: a billowing column rising straight out of the crater, lit orange from the
// lava beneath, leaning a little downwind as it climbs, and hazed like the mountain. Plus embers.
function plumeMaterial(additive) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uFog: HAZE.uFog, uRise: { value: additive ? 0.09 : 0.012 }, uH: { value: additive ? 90 : 300 } },
    vertexShader: `
      attribute vec4 aSeed; attribute vec3 aTint; uniform float uTime, uRise, uH;
      varying vec2 vUv; varying float vA; varying vec3 vCol; varying float vT;
      void main() {
        vUv = uv;
        float t = fract(uTime * uRise * (0.8 + aSeed.w * 0.4) + aSeed.x);
        vec3 c = vec3(aSeed.y * (6.0 + t * 55.0) + t * t * 110.0, t * uH, aSeed.z * (6.0 + t * 45.0));
        c.x += sin(uTime * 0.3 + aSeed.x * 20.0) * t * 12.0;
        float size = ${additive ? '(1.6 + aSeed.w * 2.0) * (1.0 - t)' : '(16.0 + t * 110.0) * (0.7 + aSeed.w * 0.6)'};
        vA = smoothstep(0.0, ${additive ? '0.05' : '0.04'}, t) * pow(1.0 - t, ${additive ? '0.8' : '1.3'});
        vT = t; vCol = aTint;
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uFog; varying vec2 vUv; varying float vA; varying vec3 vCol; varying float vT;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, ${additive ? '0.0' : '0.25'}, r) * vA;
        if (a < 0.004) discard;
        ${additive
          ? 'gl_FragColor = vec4(vCol * 1.6, a);'
          : 'vec3 base = mix(vec3(1.0, 0.45, 0.15), vCol, smoothstep(0.0, 0.16, vT)); gl_FragColor = vec4(mix(base, uFog, 0.18 + vT * 0.35), a * 0.92);'}
      }`,
  });
}
function plumeMesh(n, additive, rnd) {
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geo.instanceCount = n;
  const seed = new Float32Array(n * 4), tint = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    seed.set([i / n + rnd() * 0.02, rnd() * 2 - 1, rnd() * 2 - 1, rnd()], i * 4);
    (additive ? c.set(rnd() < 0.5 ? '#ffb347' : '#ff6a1c') : c.set('#3e3836').offsetHSL(0, 0, (rnd() - 0.5) * 0.08)).toArray(tint, i * 3);
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  const m = new THREE.Mesh(geo, plumeMaterial(additive));
  m.frustumCulled = false; m.renderOrder = additive ? 6 : 5;
  return m;
}

function horizonPiece(id, rnd, hazed) {
  const g = new THREE.Group();
  const land = (color, o) => hazeMaterial(color, o);
  const light = (color) => hazeMaterial(color, { foot: 0.6, top: 0.05, lit: false });
  let plume = null, tick = null;
  if (id === 'pyromancy') {
    // A great volcano. Its flanks are cut by gullies and ridges and banded ash-grey to rust; the
    // crater rim is ragged and breached on the side facing the valley, and lava pours out of the
    // breach and the rim, running down the gullies and pooling at the foot. A smaller vent smokes
    // on one shoulder, dark foothills stand in front, and a column of smoke billows from the crater.
    const N = 128, RINGS = 46, RIM = 30, BASE = 205, RIMY = 176, LAKE = 154;
    const front = -Math.PI / 2, breach = front + 0.32;
    const gully = (a, r) => { const t = THREE.MathUtils.clamp((r - RIM) / (BASE - RIM), 0, 1); const ridges = Math.abs(Math.sin(a * 13 + r * 0.035 + Math.sin(a * 3.1) * 1.4)) ** 0.55; return -(1 - ridges) * 11 * Math.sin(Math.PI * Math.min(1, t * 1.15)); };
    const notch = (a) => { const d = Math.atan2(Math.sin(a - breach), Math.cos(a - breach)); return -Math.max(0, 1 - Math.abs(d) / 0.28) * 13; };
    const H = (a, r) => {
      if (r < RIM - 12) return LAKE - 4;
      const rimNoise = Math.sin(a * 9) * 2.2 + Math.sin(a * 23 + 1) * 1.3 + notch(a);
      if (r < RIM) { const k = (r - (RIM - 12)) / 12; return LAKE - 4 + (RIMY + rimNoise - (LAKE - 4)) * k * k; }
      const t = (r - RIM) / (BASE - RIM);
      return -12 + (RIMY + rimNoise * (1 - t) + 12) * (1 - t) ** 1.55 + gully(a, r) + Math.sin(a * 5 + r * 0.05) * 2.4 * t;
    };
    const rad = (i) => { const k = i / RINGS; return k < 0.28 ? (RIM - 12) + (k / 0.28) * 14 : RIM + 2 + ((k - 0.28) / 0.72) ** 1.2 * (BASE - RIM - 2); };
    const pos = [], col = [], cA = new THREE.Color('#6a605c'), cB = new THREE.Color('#9a6a52'), cC = new THREE.Color('#7a5e50'), cash = new THREE.Color('#b8b0aa'), c = new THREE.Color();
    const vtx = (i, j) => { const a = (j / N) * Math.PI * 2, r = rad(i); return [Math.cos(a) * r, H(a, r), Math.sin(a) * r]; };
    const shade = (x, y, z) => {
      const band = Math.sin(y * 0.19 + Math.sin(Math.atan2(z, x) * 7) * 0.8) > 0.35 ? 0.82 : 1;
      c.copy(y > 140 ? cA : y > 70 ? cB : cC); if (y > 150) c.lerp(cash, 0.35);
      // Ridge crests catch the light; gully floors are sooty.
      const r = Math.hypot(x, z), g2 = r > RIM ? gully(Math.atan2(z, x), r) / -11 : 0; c.lerp(g2 > 0.55 ? cC : cash, g2 > 0.55 ? 0.35 : (1 - g2) * 0.22);
      return c.clone().multiplyScalar(band * (0.9 + (Math.sin(x * 0.7 + z * 0.3) * 0.5 + 0.5) * 0.18)).convertLinearToSRGB(); // the haze shader writes colour as-is
    };
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < N; j++) {
      const q = [vtx(i, j), vtx(i + 1, j), vtx(i + 1, j + 1), vtx(i, j + 1)];
      for (const tri of [[0, 2, 1], [0, 3, 2]]) { // outward-facing
        const cy = (q[tri[0]][1] + q[tri[1]][1] + q[tri[2]][1]) / 3, cx = (q[tri[0]][0] + q[tri[1]][0] + q[tri[2]][0]) / 3, cz = (q[tri[0]][2] + q[tri[1]][2] + q[tri[2]][2]) / 3;
        const fc = shade(cx, cy, cz);
        for (const k of tri) { pos.push(...q[k]); col.push(fc.r, fc.g, fc.b); }
      }
    }
    const cone = new THREE.BufferGeometry();
    cone.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cone.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.add(new THREE.Mesh(cone, land('#ffffff', { vcol: true, foot: 0.72, top: 0.1, y0: 0, y1: 150 })));
    // The crater: a lake of lava, glowing up the inside of the rim.
    const lava = light('#ff6a1c'), hot = light('#ffd27a');
    g.add(new THREE.Mesh(new THREE.CircleGeometry(RIM - 11, 40).rotateX(-Math.PI / 2).translate(0, LAKE - 2.5, 0), lava));
    g.add(new THREE.Mesh(new THREE.CircleGeometry(RIM - 20, 32).rotateX(-Math.PI / 2).translate(3, LAKE - 2.3, -2), hot));
    const craterGlow = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ff7a2a', map: sootGlow(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.8 }));
    craterGlow.position.set(0, RIMY + 6, 0); craterGlow.scale.set(120, 70, 1); g.add(craterGlow);
    // Lava streams: out of the breach and over the rim, down the gullies, widening as they go.
    const streams = [[breach, 0.95, 2.4, 5], [breach + 0.14, 0.62, 1.4, 2.6], [front - 0.42, 0.5, 1.2, 2.2], [front + 0.95, 0.42, 1.1, 2], [front - 0.9, 0.36, 1, 1.8], [front + 0.66, 0.7, 1.5, 3]];
    const pools = [], lavaGeos = [], hotGeos = [];
    for (const [a0, reach, w0, w1] of streams) {
      const pts = []; let a = a0;
      const rEnd = RIM + (BASE - RIM) * reach * (0.85 + rnd() * 0.1);
      for (let r = RIM - 2; r <= rEnd; r += 6) {
        a += Math.sin(r * 0.07 + a0 * 7) * 0.02;
        // Settle into the nearest gully floor.
        let best = a, bh = Infinity; for (let da = -0.05; da <= 0.05; da += 0.0125) { const h = H(a + da, r); if (h < bh) { bh = h; best = a + da; } }
        a = a * 0.6 + best * 0.4;
        const surf = Math.max(H(a - 0.02, r), H(a, r), H(a + 0.02, r)); // ride on the gully floor, just proud of it
        pts.push(new THREE.Vector3(Math.cos(a) * r, (H(a, r) * 0.7 + surf * 0.3) + 0.4, Math.sin(a) * r));
      }
      lavaGeos.push(taperTube(pts, w0, w1, pts.length * 3));
      hotGeos.push(taperTube(pts.slice(0, Math.ceil(pts.length * 0.45)), w0 * 0.55, w0 * 0.4, pts.length * 2).translate(0, w0 * 0.35, 0));
      pools.push(pts[pts.length - 1]);
    }
    for (const p of pools) lavaGeos.push(new THREE.CircleGeometry(9 + rnd() * 6, 18).scale(1.4, 1, 1).rotateX(-Math.PI / 2).translate(p.x, p.y - 0.4, p.z));
    g.add(new THREE.Mesh(merge(...lavaGeos), lava), new THREE.Mesh(merge(...hotGeos), hot));
    // A smaller cone on the shoulder, its own vent glowing.
    { const a = front + 1.18, r = 118, bx = Math.cos(a) * r, bz = Math.sin(a) * r, by = H(a, r) - 6;
      const sub = new THREE.ConeGeometry(34, 44, 18, 4, true).toNonIndexed(), sp = sub.attributes.position;
      for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i); const k = (y + 22) / 44, rr = Math.hypot(x, z); if (rr > 0.01) { const f = 1 + Math.sin(Math.atan2(z, x) * 9) * 0.07 * (1 - k); sp.setXYZ(i, x * f, y, z * f); } if (k > 0.97) sp.setY(i, y - 4); }
      sub.translate(bx, by + 22, bz);
      const sc = new Float32Array(sp.count * 3); for (let i = 0; i < sp.count; i++) { const y = sp.getY(i); c.copy(y > by + 34 ? cA : cB).convertLinearToSRGB().toArray(sc, i * 3); }
      sub.setAttribute('color', new THREE.BufferAttribute(sc, 3));
      g.add(new THREE.Mesh(sub, land('#ffffff', { vcol: true, foot: 0.72, top: 0.1, y0: 0, y1: 150 })));
      g.add(new THREE.Mesh(new THREE.CircleGeometry(7, 16).rotateX(-Math.PI / 2).translate(bx, by + 40.5, bz), lava));
      const vg = new THREE.Sprite(craterGlow.material.clone()); vg.material.opacity = 0.6; vg.position.set(bx, by + 44, bz); vg.scale.set(40, 24, 1); g.add(vg);
    }
    // Dark, jagged foothills in front, so the mountain rises from a range rather than a plain.
    const hills = [];
    for (let k = 0; k < 16; k++) {
      const a = front + (k / 15 - 0.5) * 2.3 + (rnd() - 0.5) * 0.08, r = BASE - 14 + rnd() * 26, h = 22 + rnd() * 34, w = 22 + rnd() * 18;
      hills.push(new THREE.ConeGeometry(w, h, 5 + Math.floor(rnd() * 3), 1).rotateY(rnd() * 3).translate(Math.cos(a) * r, h / 2 - 16, Math.sin(a) * r));
    }
    g.add(new THREE.Mesh(merge(...hills), land('#2e2826', { foot: 0.82, top: 0.3, y0: -10, y1: 40 })));
    // Smoke and embers, both animated in the shader (update() drives uTime).
    const smoke = plumeMesh(90, false, rnd), embers = plumeMesh(160, true, rnd);
    for (const m of [smoke, embers]) { m.position.set(0, RIMY - 6, 0); g.add(m); }
    tick = (t) => { smoke.material.uniforms.uTime.value = t; embers.material.uniforms.uTime.value = t; const f = 0.72 + Math.sin(t * 1.7) * 0.08 + Math.sin(t * 5.3) * 0.04; craterGlow.material.opacity = f; };
  } else if (id === 'cryomancy') {
    // Snow peaks, the glacier's source.
    for (const [x, r, h] of [[-70, 70, 150], [15, 88, 182], [100, 62, 128]]) {
      const z = rnd() * 30, capH = h * 0.44;
      g.add(new THREE.Mesh(new THREE.ConeGeometry(r, h, 7, 1).translate(x, h / 2 - 12, z), land('#48596f', { foot: 0.8, top: 0.08 })));
      g.add(new THREE.Mesh(new THREE.ConeGeometry(r * 0.44 + 0.6, capH, 7, 1).translate(x, h - 12 - capH / 2 + 0.4, z), land('#ffffff', { foot: 0.3, top: 0.02 })));
    }
  } else if (id === 'geomancy') {
    // A split crag, seamed with crystal.
    for (const [x, r, h, t] of [[-40, 58, 142, 0.1], [12, 72, 170, -0.06], [62, 46, 122, -0.14], [-88, 40, 96, 0.16]]) {
      g.add(new THREE.Mesh(new THREE.ConeGeometry(r, h, 5, 1).rotateZ(t).translate(x, h / 2 - 14, rnd() * 20), land('#7a5a44')));
    }
    const gem = light('#a37bff'), gem2 = light('#6fd6ff');
    for (let k = 0; k < 9; k++) { const x = -90 + k * 22 + (rnd() - 0.5) * 8, y = 40 + rnd() * 70; g.add(new THREE.Mesh(new THREE.OctahedronGeometry(12 + rnd() * 8, 0).scale(0.45, 2.6, 0.45).rotateZ((rnd() - 0.5) * 0.9).translate(x, y, -34 - (1 - (y - 40) / 110) * 18), k % 2 ? gem : gem2)); }
  } else {
    // A barrow hill crowned with a ruined cathedral, its windows lit green.
    const dark = land('#2f3634', { foot: 0.8, top: 0.12 }), winHi = light('#b0ffd0');
    g.add(new THREE.Mesh(new THREE.SphereGeometry(120, 18, 10).scale(1, 0.42, 0.75).translate(0, -18, 0), land('#3f4a3f')));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(64, 36, 24).translate(0, 50, 0), dark));
    for (const [x, h, spire] of [[-38, 70, 44], [38, 52, 0], [0, 26, 70]]) {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(15, h, 15).translate(x, 32 + h / 2, 0), dark));
      if (spire) g.add(new THREE.Mesh(new THREE.ConeGeometry(10, spire, 4).rotateY(Math.PI / 4).translate(x, 32 + h + spire / 2, 0), dark));
      if (x) g.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 9, 1).translate(x, 32 + h - 14, -7.8), winHi));
    }
    const win = light('#9dffc4');
    for (let k = 0; k < 7; k++) g.add(new THREE.Mesh(new THREE.BoxGeometry(3, 8, 1).translate(-24 + k * 8, 50 + (k % 2) * 4, -12.6), win));
    g.add(new THREE.Mesh(new THREE.CircleGeometry(4.5, 16).rotateY(Math.PI).translate(0, 64, -12.7), win));
  }
  return { group: g, plume, tick };
}

export class Crossings {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.flames = [];
    this.glows = [];
    this.hazed = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    const puffs = [];
    SCHOOLS.forEach((def) => {
      const id = def.id, road = passRoadHeight(id), facing = this.facingOf(id), rnd = mulberry32(id.length * 131 + 7);
      // The cliff's slabs root where the pass walls actually are (local x across, z along).
      const ground = (lx, lz) => { const q = passPoint(id, PASS_LIP + lz, -lx); return heightAt(q.x, q.z) - road; };
      const m = buildMouth(id, def.color, rnd, { ground });
      const at = passPoint(id, PASS_LIP);
      m.root.position.set(at.x, road, at.z); m.root.rotation.y = facing;
      this.group.add(m.root);
      this.flames.push(...m.flames); this.glows.push(...m.glows);
      // Local (x across, z along) to world: local +x is to the left looking out.
      const W = (lx, lz) => passPoint(id, PASS_LIP + lz, -lx);
      const stat = m.cols.map((c) => ({ ...W(c.x, c.z), radius: c.radius }));
      for (let z = -1.5; z <= TUNNEL_LEN; z += 0.9) for (const side of [-1, 1]) stat.push({ ...W(side * (TUNNEL_HALF + 0.35), z), radius: 0.5 }); // the tunnel's walls
      for (let x = TUNNEL_HALF + 0.9; x < 22; x += 1.2) for (const side of [-1, 1]) stat.push({ ...W(side * x, 0.4), radius: 0.7 }); // the face: no climbing over the top
      for (let x = TUNNEL_HALF + 2.6; x < 18; x += 1.4) for (const side of [-1, 1]) stat.push({ ...W(side * x, -2.2), radius: 1.35 }); // the cliff's front row
      const block = [];
      for (let x = -TUNNEL_HALF + 0.3; x <= TUNNEL_HALF - 0.3; x += 0.75) block.push({ ...W(x, -0.8), radius: 0.6 });
      // The realm on the horizon, far out past the ring.
      const hz = horizonPiece(id, mulberry32(id.length * 17 + 3), this.hazed);
      const far = passPoint(id, id === 'pyromancy' ? 430 : 400);
      hz.group.position.set(far.x, -8, far.z); hz.group.rotation.y = facing;
      hz.group.traverse((o) => { o.frustumCulled = false; });
      this.group.add(hz.group);
      if (hz.tick) (this.horizonTicks ||= []).push(hz.tick);
      if (hz.plume) {
        const p = hz.plume.at.clone().applyEuler(hz.group.rotation).add(hz.group.position), r2 = mulberry32(5);
        for (let i = 0; i < hz.plume.n; i++) {
          const up = r2() * 150, c = hz.plume.col.clone().offsetHSL(0, 0, (r2() - 0.5) * 0.08);
          puffs.push({ p: [p.x + (r2() - 0.5) * 20 + up * 0.5, p.y + up, p.z + (r2() - 0.5) * 20], size: 30 + up * 0.45 + r2() * 16, c, a: 0.8 - up / 280 });
        }
      }
      const front = passPoint(id, PASS_LIP - 4);
      this.list.push({ def, id, x: front.x, z: front.z, front, facing, road, open: null, mouth: m, stat, block });
    });
    if (puffs.length) {
      const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
      geo.instanceCount = puffs.length;
      geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flatMap((q) => [...q.p, q.size])), 4));
      geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flatMap((q) => [q.c.r, q.c.g, q.c.b, q.a])), 4));
      this.smoke = new THREE.Mesh(geo, puffMaterial());
      this.smoke.frustumCulled = false; this.smoke.renderOrder = 5;
      this.group.add(this.smoke);
      game.aoHidden?.push(this.smoke);
    }
    this.colliders = [];
    this.buildBleedProps();
  }

  // Yaw that points an object's local +Z out along the pass.
  facingOf(id) { const a = REALM_PASSES[id].a; return Math.atan2(Math.cos(a), Math.sin(a)); }

  // ---------------------------------------------------------------- the realms seeping in
  buildBleedProps() {
    const rnd = mulberry32(4242), nodes = this.game.resources?.nodes || [];
    const spots = (id, n, gap) => {
      const out = [], a0 = REALM_PASSES[id].a;
      for (let k = 0; k < n * 40 && out.length < n; k++) {
        const a = a0 + (rnd() - 0.5) * 0.85, d = 98 + rnd() * 52, x = Math.cos(a) * d, z = Math.sin(a) * d;
        const s = x * Math.cos(a0) + z * Math.sin(a0), l = Math.abs(-x * Math.sin(a0) + z * Math.cos(a0));
        if (s > 96 && l < 12) continue;                       // keep the road clear
        const h = heightAt(x, z);
        if (h < WATER_LEVEL + 0.6 || h < 0 || slopeAt(x, z) > 0.5) continue;
        if (bleedAt(x, z)[BLEED_IDS.indexOf(id)] < 0.35) continue;
        if (SHRINES.some((sh) => Math.hypot(sh.x - x, sh.z - z) < 13) || nodes.some((nd) => Math.hypot(nd.x - x, nd.z - z) < 3)) continue;
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < gap)) continue;
        out.push({ x, z, y: h, r: rnd() * 6.28, k: 0.8 + rnd() * 0.5 });
      }
      return out;
    };
    const place = (geo, mat, list, lift = 0, shadow = true) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length), m = new THREE.Matrix4();
      list.forEach((p, i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y + lift, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(p.tilt || 0, p.r, 0)), new THREE.Vector3(p.k, p.k, p.k))));
      im.castShadow = shadow; im.receiveShadow = true;
      this.group.add(im);
      return im;
    };
    const merge = (...gs) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)));
    // The Crypt: leaning gravestones and dead trees.
    const graves = spots('necromancy', 30, 3.5).map((p) => ({ ...p, tilt: (rnd() - 0.5) * 0.25 }));
    place(merge(new RoundedBoxGeometry(0.8, 1.1, 0.26, 2, 0.08).translate(0, 0.55, 0), new THREE.CylinderGeometry(0.4, 0.4, 0.26, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 1.1, 0)),
      clay('#9a98a8', { roughness: 0.75, key: 'bleedGrave' }), graves);
    const deadTree = merge(new THREE.CylinderGeometry(0.12, 0.3, 3.4, 7).translate(0, 1.7, 0),
      new THREE.CylinderGeometry(0.05, 0.1, 1.5, 5).rotateZ(0.9).translate(0.55, 2.4, 0), new THREE.CylinderGeometry(0.05, 0.1, 1.3, 5).rotateZ(-1.0).translate(-0.5, 2.8, 0.1),
      new THREE.CylinderGeometry(0.04, 0.08, 1.0, 5).rotateX(0.9).translate(0, 3.0, 0.4));
    place(deadTree, clay('#4e423e', { roughness: 0.9, key: 'bleedDeadwood' }), spots('necromancy', 11, 7));
    // The Deep: crystal clusters and bare ochre boulders.
    const cluster = merge(new THREE.ConeGeometry(0.34, 2.2, 6).translate(0, 1.1, 0), new THREE.ConeGeometry(0.26, 1.5, 6).rotateZ(0.4).translate(0.45, 0.7, 0), new THREE.ConeGeometry(0.24, 1.3, 6).rotateZ(-0.45).rotateY(1).translate(-0.4, 0.6, 0.2));
    const crystals = spots('geomancy', 20, 5);
    place(cluster, new THREE.MeshStandardMaterial({ color: '#b98cff', emissive: '#8a5cff', emissiveIntensity: 0.55, roughness: 0.25, flatShading: true }), crystals.filter((_, i) => i % 2));
    place(cluster, new THREE.MeshStandardMaterial({ color: '#7fd8ff', emissive: '#40b0ff', emissiveIntensity: 0.55, roughness: 0.25, flatShading: true }), crystals.filter((_, i) => !(i % 2)));
    place(new THREE.DodecahedronGeometry(1.3, 0).scale(1.2, 0.8, 1), clay('#b9895a', { roughness: 0.85, key: 'bleedOchre' }), spots('geomancy', 14, 6), 0.3);
    // The Hollow: snowy pines and ice shards.
    const pines = spots('cryomancy', 26, 4.5);
    const tiers = [[0.9, 1.7, 1.4], [0.7, 1.4, 2.4], [0.45, 1.1, 3.25]];
    place(merge(new THREE.CylinderGeometry(0.14, 0.18, 0.9, 6).translate(0, 0.45, 0), ...tiers.map(([r, h, y]) => new THREE.ConeGeometry(r, h, 8).translate(0, y, 0))), clay('#2f6f55', { roughness: 0.8, key: 'bleedPine' }), pines);
    place(merge(...tiers.map(([r, h, y]) => new THREE.ConeGeometry(r * 0.66, h * 0.5, 8).translate(0, y + h * 0.22, 0))), clay('#ffffff', { roughness: 0.6, key: 'bleedSnowcap' }), pines, 0.02, false);
    place(merge(new THREE.ConeGeometry(0.35, 2.4, 5).translate(0, 1.2, 0), new THREE.ConeGeometry(0.25, 1.6, 5).rotateZ(0.35).translate(0.4, 0.75, 0)),
      new THREE.MeshStandardMaterial({ color: '#cdf2ff', emissive: '#7fd0ff', emissiveIntensity: 0.25, roughness: 0.15, flatShading: true }), spots('cryomancy', 14, 6));
    // The Caldera: basalt columns, charred stumps and smoking vents.
    const basalt = merge(...[[0, 0, 2.2], [0.55, 0.2, 1.5], [-0.45, 0.35, 1.8], [0.1, -0.55, 1.2]].map(([x, z, h]) => new THREE.CylinderGeometry(0.34, 0.36, h, 6).translate(x, h / 2, z)));
    place(basalt, clay('#3a3230', { roughness: 0.7, key: 'bleedBasalt' }), spots('pyromancy', 18, 5));
    place(new THREE.CylinderGeometry(0.22, 0.35, 1.1, 7).translate(0, 0.55, 0), clay('#1f1816', { roughness: 0.9, key: 'bleedStump' }), spots('pyromancy', 10, 5));
    this.vents = spots('pyromancy', 7, 9);
    place(merge(new THREE.ConeGeometry(0.9, 0.7, 9).translate(0, 0.35, 0)), clay('#2a2220', { roughness: 0.8, key: 'bleedVent' }), this.vents);
    place(new THREE.CircleGeometry(0.38, 12).rotateX(-Math.PI / 2).translate(0, 0.72, 0), new THREE.MeshStandardMaterial({ color: '#ff7a1c', emissive: '#ff5a00', emissiveIntensity: 2.2 }), this.vents, 0, false);
    this.crystals = crystals;
  }

  // Which realm's edge you are standing in, and how deep (for ambience).
  bleedHere(p) {
    const b = bleedAt(p.x, p.z), i = b.indexOf(Math.max(...b));
    return { id: BLEED_IDS[i], k: b[i] };
  }

  // ---------------------------------------------------------------- the player
  // The floor is the terrain (world.js cuts the slot); what stands on it at a mouth (the ice
  // cave's snow drifts) is walked over.
  surfaceAt(x, z) {
    for (const c of this.list) {
      if (!c.mouth.domes.length) continue;
      const a = REALM_PASSES[c.id].a, ux = Math.cos(a), uz = Math.sin(a);
      const lz = x * ux + z * uz - PASS_LIP, lx = -(-x * uz + z * ux);
      if (lz < -10 || lz > 2 || Math.abs(lx) > 14) continue;
      const h = domeAt(c.mouth.domes, lx, lz);
      if (h > -Infinity) return c.road + h;
    }
    return -Infinity;
  }

  // If `p` is on the last stretch of road or inside a way in: which one, and how far along.
  inWay(p) {
    for (const c of this.list) {
      const a = REALM_PASSES[c.id].a, ux = Math.cos(a), uz = Math.sin(a), s = p.x * ux + p.z * uz;
      if (s > PASS_LIP - 6 && Math.abs(-p.x * uz + p.z * ux) < TUNNEL_HALF + 1) return { c, s };
    }
    return null;
  }
  // Far enough inside to be through.
  through(p) { const w = this.inWay(p); return w && w.c.open && w.s > PASS_LIP + THRESHOLD_IN ? w.c : null; }

  // For prompts: standing at a mouth.
  nearest(p, range = 5) {
    for (const c of this.list) if (Math.hypot(c.x - p.x, c.z - p.z) < range) return c;
    return null;
  }

  // Where to set you down coming home from a realm: just out of the mouth, facing the valley.
  arrival(id) {
    const q = passPoint(id, PASS_LIP - 4), a = REALM_PASSES[id].a;
    return { x: q.x, z: q.z, face: Math.atan2(-Math.cos(a), -Math.sin(a)) };
  }

  update(dt, t, state) {
    let changed = false;
    for (const c of this.list) {
      const open = state.schoolUnlocked(c.id);
      if (open !== c.open) { c.open = open; c.mouth.open.visible = open; c.mouth.locked.visible = !open; changed = true; }
    }
    if (changed) this.colliders = this.list.flatMap((c) => (c.open ? c.stat : [...c.stat, ...c.block]));
    const g = this.game, exit = g.realm?.exit?.userData;
    for (const f of [...this.flames, ...(exit?.flames || [])]) { f.scale.y = 1 + Math.sin(t * 11 + f.id) * 0.12 + Math.sin(t * 17.3 + f.id * 2) * 0.08; f.scale.x = f.scale.z = 1 - (f.scale.y - 1) * 0.5; }
    for (const q of [...this.glows, ...(exit?.glows || [])]) q.mat.emissiveIntensity = q.k * (0.85 + Math.sin(t * 1.7 + q.k) * 0.15);
    if (this.smoke) this.smoke.material.uniforms.uTime.value = t;
    for (const f of this.horizonTicks || []) f(t);
    // The far realms take the sky's colour through the day (they ignore the fog, so haze them here).
    if (g.scene.fog) HAZE.uFog.value.copy(g.scene.fog.color);
    // Weather and motes in the realms' edges of the valley, round the apprentice.
    if (g.realm || g.inside || !g.particles) return;
    const p = g.player.pos, { id, k } = this.bleedHere(p), P = g.particles;
    if (k < 0.15) return;
    const rate = dt * k, R = () => (Math.random() - 0.5);
    if (id === 'cryomancy') for (let i = 0; i < 40 * rate; i++) P.spawn(p.x + R() * 40, p.y + 8 + Math.random() * 6, p.z + R() * 40, R() * 0.6, -1.4, R() * 0.6, this.snowCol ||= new THREE.Color('#ffffff'), 0.22, 7, 0.05, 0.1);
    if (id === 'necromancy' && Math.random() < 6 * rate) P.spawn(p.x + R() * 30, p.y + 0.4, p.z + R() * 30, R() * 0.4, 0.05, R() * 0.4, this.mistCol ||= new THREE.Color('#c8d4d0'), 2.2, 5, 0, 0.2);
    if (id === 'pyromancy') for (const v of this.vents) if (Math.hypot(v.x - p.x, v.z - p.z) < 60 && Math.random() < dt * 8) P.spawn(v.x + R(), v.y + 0.9, v.z + R(), R() * 0.5, 2 + Math.random() * 1.5, R() * 0.5, Math.random() < 0.5 ? (this.emberCol ||= new THREE.Color('#ff8a3c')) : (this.smokeCol ||= new THREE.Color('#5a5250')), 0.4, 1.6, -0.2, 0.4);
    if (id === 'geomancy') for (const c of this.crystals) if (Math.hypot(c.x - p.x, c.z - p.z) < 40 && Math.random() < dt * 1.5) P.spawn(c.x + R(), c.y + 1 + Math.random() * 1.5, c.z + R(), 0, 0.4, 0, this.sparkCol ||= new THREE.Color('#c8a8ff'), 0.25, 1.4, 0, 0.2);
  }
}


// The realm's end of the way: the same mouth, cut into the cliffs that ring the realm, level
// inside. `ground(lx, lz)` is the realm's ground height round the mouth (so the cliff's slabs
// root on it). Walking in takes you home.
export function realmThreshold(id, color, ground = () => 0) {
  const m = buildMouth(id, color, mulberry32(id.length * 131 + 7), { flat: true, ground });
  m.open.visible = true; m.locked.visible = false;
  const cols = [...m.cols];
  for (let z = -1.5; z <= TUNNEL_LEN; z += 0.9) for (const side of [-1, 1]) cols.push({ x: side * (TUNNEL_HALF + 0.35), z, radius: 0.5 });
  for (let x = TUNNEL_HALF + 0.9; x < 22; x += 1.2) for (const side of [-1, 1]) cols.push({ x: side * x, z: 0.4, radius: 0.7 });
  for (let x = TUNNEL_HALF + 2.6; x < 18; x += 1.4) for (const side of [-1, 1]) cols.push({ x: side * x, z: -2.2, radius: 1.35 }); // the cliff's front row
  m.root.userData = { flames: m.flames, glows: m.glows, cols, surfaceAt: (lx, lz) => domeAt(m.domes, lx, lz) };
  return m.root;
}
