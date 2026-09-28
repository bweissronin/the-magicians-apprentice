import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, passRoadHeight, bleedAt, slopeAt, WATER_LEVEL } from './world.js';
import { SCHOOLS, SHRINES, REALM_PASSES, PASS_LIP, PASS_END, passPoint } from './data.js';
import { clay } from './style.js';
import { mulberry32 } from './util.js';

// The ways to the other realms. Each realm lies beyond the valley's mountain ring in its direction
// on the atlas: a road climbs through a pass to the lip of a chasm full of mist, and a rope bridge
// runs out over it into a bank of fog tinted with the realm's colour. Walk into the fog and you
// are there. A sealed realm's bridge has lost its middle planks, and mends when the gate opens.
//
// Before you reach the pass, the realm is already seeping into the valley (world.js bleedAt):
// snow and pines toward the Hollow, graves and grey grass toward the Crypt, ochre rock and
// crystals toward the Deep, ash, basalt and glowing cracks toward the Caldera.
const DECK_W = 1.7;                        // half-width of the deck
const START = PASS_LIP - 3, STOP = PASS_END + 3;
const MID = (PASS_LIP + PASS_END) / 2, GAP = 4.5;
const SAG = 1.3;
const BLEED_IDS = ['necromancy', 'geomancy', 'cryomancy', 'pyromancy'];

// Height of the deck's walking surface at distance s along the pass.
function deckY(id, s) {
  const t = THREE.MathUtils.clamp((s - START) / (STOP - START), 0, 1);
  return passRoadHeight(id) + 0.2 - SAG * Math.sin(Math.PI * t);
}

// Soft billboard puffs (one draw call for every bank of mist in the valley).
function mistMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec4 aPuff; attribute vec4 aTint; uniform float uTime;
      varying vec2 vUv; varying vec4 vTint;
      void main() {
        vUv = uv; vTint = aTint;
        vec3 c = aPuff.xyz + vec3(sin(uTime * 0.13 + aPuff.z * 0.3) * 1.6, sin(uTime * 0.21 + aPuff.x) * 0.4, cos(uTime * 0.11 + aPuff.x * 0.3) * 1.6);
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * aPuff.w;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying vec4 vTint;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.15, r) * vTint.a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vTint.rgb, a);
      }`,
  });
}

export class Crossings {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.colliders = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    const wood = clay('#9a6a3e', { roughness: 0.8, key: 'bridgeWood' }), woodDark = clay('#6e4a2a', { roughness: 0.8, key: 'bridgeWoodDark' });
    const rope = clay('#d8bf8a', { roughness: 0.9, key: 'bridgeRope' }), stone = clay('#a39aa8', { roughness: 0.75, key: 'bridgeStone' });
    const puffs = [];
    SCHOOLS.forEach((def) => {
      const id = def.id, road = passRoadHeight(id), a = REALM_PASSES[id].a;
      const facing = Math.atan2(Math.cos(a), Math.sin(a)); // looking out along the pass
      const head = passPoint(id, PASS_LIP - 6);
      const whole = this.buildBridge(id, false, wood, woodDark, rope), broken = this.buildBridge(id, true, wood, woodDark, rope);
      this.group.add(whole, broken);
      // Two carved pillars at the bridgehead, each capped with a stone glowing in the realm's colour.
      const runeMat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.2, roughness: 0.4 });
      const pillars = new THREE.Group();
      for (const side of [-1, 1]) {
        const q = passPoint(id, START - 0.5, side * (DECK_W + 1.1)), y = heightAt(q.x, q.z);
        const p = new THREE.Mesh(new RoundedBoxGeometry(1.0, 3.6, 1.0, 3, 0.18), stone);
        p.position.set(q.x, y + 1.6, q.z); p.rotation.y = facing; p.castShadow = true;
        const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), runeMat);
        cap.position.set(q.x, y + 3.85, q.z);
        pillars.add(p, cap);
        this.colliders.push({ x: q.x, z: q.z, radius: 0.75 });
      }
      this.group.add(pillars);
      // Rope rails keep you on the deck (and you can't step off the lip: the chasm is a wall).
      for (let s = START; s <= STOP; s += 1) for (const side of [-1, 1]) {
        const q = passPoint(id, s, side * (DECK_W + 0.35));
        this.colliders.push({ x: q.x, z: q.z, radius: 0.35 });
      }
      // Mist filling the chasm below, and a bank of fog at the far end in the realm's colour.
      const rnd = mulberry32(id.length * 977 + 5), tint = new THREE.Color(def.color).lerp(new THREE.Color('#ffffff'), 0.3);
      // A thick floor of cloud hides the chasm's depths (and the water far below)...
      for (let i = 0; i < 130; i++) {
        const s = PASS_LIP + 1 + rnd() * 90, cw = 14 + (s - PASS_LIP) * 0.45;
        const q = passPoint(id, s, (rnd() - 0.5) * 2 * cw);
        const shade = 0.86 + rnd() * 0.12; // a little modelling, so the cloud sea has form
        puffs.push({ p: [q.x, Math.max(WATER_LEVEL + 1.2, road - 11) + rnd() * 2.5, q.z], size: 12 + rnd() * 12, c: new THREE.Color(shade, shade, shade * 1.04), a: 0.5 + rnd() * 0.25 });
      }
      for (let i = 0; i < 40; i++) {
        const s = PASS_END - 1 + rnd() * 18, q = passPoint(id, s, (rnd() - 0.5) * 14);
        puffs.push({ p: [q.x, road - 2 + rnd() * 9, q.z], size: 5 + rnd() * 6, c: tint.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.1), a: 0.3 + rnd() * 0.2 });
      }
      this.list.push({ def, id, x: head.x, z: head.z, arch: { position: { y: road } }, front: head, facing, whole, broken, runeMat, road, open: null });
    });
    // The mist mesh: every puff in one instanced draw.
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    geo.instanceCount = puffs.length;
    geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flatMap((q) => [...q.p, q.size])), 4));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flatMap((q) => [q.c.r, q.c.g, q.c.b, q.a])), 4));
    this.mist = new THREE.Mesh(geo, mistMaterial());
    this.mist.frustumCulled = false; this.mist.renderOrder = 5;
    this.group.add(this.mist);
    game.aoHidden?.push(this.mist); // soft quads must stay out of the ambient-occlusion depth pass
    this.group.userData.noCut = true;
    this.buildBleedProps();
  }

  buildBridge(id, broken, wood, woodDark, rope) {
    const g = new THREE.Group(), plank = new THREE.BoxGeometry(DECK_W * 2 + 0.3, 0.14, 0.5);
    const facing = this.facingOf(id), gone = (s) => broken && Math.abs(s - MID) < GAP;
    const planks = [];
    for (let s = START; s <= STOP; s += 0.62) {
      if (gone(s)) continue;
      const q = passPoint(id, s), m = new THREE.Matrix4();
      const jig = mulberry32(Math.round(s * 100))() - 0.5;
      m.compose(new THREE.Vector3(q.x, deckY(id, s) - 0.07, q.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing + jig * 0.06, jig * 0.04)), new THREE.Vector3(1, 1, 1));
      planks.push(m);
    }
    // A few planks hang from the broken ends, swinging over the drop.
    if (broken) for (const e of [MID - GAP, MID + GAP]) {
      const q = passPoint(id, e + (e < MID ? 0.4 : -0.4), 0.4), m = new THREE.Matrix4();
      m.compose(new THREE.Vector3(q.x, deckY(id, e) - 1.1, q.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(1.3, facing, 0.2)), new THREE.Vector3(0.6, 1, 1));
      planks.push(m);
    }
    const im = new THREE.InstancedMesh(plank, wood, planks.length);
    planks.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);
    // Posts every few metres; ropes sagging between their tops, and along the deck's edges.
    const post = new THREE.CylinderGeometry(0.1, 0.12, 1.3, 7), posts = [];
    const tops = { [-1]: [], [1]: [] };
    for (let s = START; s <= STOP + 0.01; s += (STOP - START) / 6) {
      if (gone(s)) continue;
      for (const side of [-1, 1]) {
        const q = passPoint(id, s, side * (DECK_W + 0.1)), y = deckY(id, s);
        posts.push(new THREE.Matrix4().makeTranslation(q.x, y + 0.5, q.z));
        tops[side].push({ s, v: new THREE.Vector3(q.x, y + 1.1, q.z) });
      }
    }
    const pm = new THREE.InstancedMesh(post, woodDark, posts.length);
    posts.forEach((m, i) => pm.setMatrixAt(i, m));
    pm.castShadow = true;
    g.add(pm);
    const tubes = [];
    for (const side of [-1, 1]) {
      const t = tops[side];
      for (let i = 0; i < t.length - 1; i++) {
        if (broken && t[i].s < MID && t[i + 1].s > MID) {
          // Cut rope ends dangle into the gap.
          for (const [from, dir] of [[t[i], 1], [t[i + 1], -1]]) {
            const q = passPoint(id, from.s + dir * 2.2, side * (DECK_W + 0.1));
            tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from.v, new THREE.Vector3(q.x, from.v.y - 1.6, q.z)]), 6, 0.05, 5));
          }
          continue;
        }
        const pts = [];
        for (let k = 0; k <= 8; k++) pts.push(t[i].v.clone().lerp(t[i + 1].v, k / 8).setY(THREE.MathUtils.lerp(t[i].v.y, t[i + 1].v.y, k / 8) - 0.35 * Math.sin(Math.PI * k / 8)));
        tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.05, 5));
      }
    }
    if (tubes.length) { const r = new THREE.Mesh(mergeGeometries(tubes), rope); r.castShadow = true; g.add(r); }
    return g;
  }

  // Yaw that points an object's local +Z out along the pass (so a plank's length lies across it).
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
  // A walkable surface: the bridge decks (with a gap in a broken one).
  surfaceAt(x, z) {
    for (const c of this.list) {
      const a = REALM_PASSES[c.id].a, ux = Math.cos(a), uz = Math.sin(a);
      const s = x * ux + z * uz;
      if (s < START - 0.5 || s > STOP + 0.5) continue;
      if (Math.abs(-x * uz + z * ux) > DECK_W + 0.2) continue;
      if (!c.open && Math.abs(s - MID) < GAP) continue;
      return deckY(c.id, s);
    }
    return -Infinity;
  }

  // How far out along its pass `p` is, for the crossing it's on (or null).
  onBridge(p) {
    for (const c of this.list) {
      const a = REALM_PASSES[c.id].a, ux = Math.cos(a), uz = Math.sin(a), s = p.x * ux + p.z * uz;
      if (s > START - 2 && Math.abs(-p.x * uz + p.z * ux) < DECK_W + 1) return { c, s };
    }
    return null;
  }

  // For prompts: the bridgehead, or the broken end of a sealed bridge.
  nearest(p, range = 4) {
    for (const c of this.list) {
      if (Math.hypot(c.x - p.x, c.z - p.z) < range) return c;
      if (!c.open) { const e = passPoint(c.id, MID - GAP - 1); if (Math.hypot(e.x - p.x, e.z - p.z) < 3) return c; }
    }
    return null;
  }

  // Where to set you down coming home from a realm: out on its bridge, facing the valley.
  arrival(id) {
    const q = passPoint(id, PASS_END - 10), a = REALM_PASSES[id].a;
    return { x: q.x, z: q.z, face: Math.atan2(-Math.cos(a), -Math.sin(a)) };
  }

  update(dt, t, state) {
    this.mist.material.uniforms.uTime.value = t;
    for (const c of this.list) {
      const open = state.schoolUnlocked(c.id);
      if (open !== c.open) { c.open = open; c.whole.visible = open; c.broken.visible = !open; }
      c.runeMat.emissiveIntensity = open ? 1.4 + Math.sin(t * 2 + c.road) * 0.4 : 0.15;
    }
    // Weather and motes in the realms' edges of the valley, round the apprentice.
    const g = this.game;
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

// The realm's end of the bridge: a short run of deck leading back into fog, tinted with the
// valley's green. Stepping into it takes you home.
export function realmBridgehead(color) {
  const g = new THREE.Group(), wood = clay('#9a6a3e', { roughness: 0.8, key: 'bridgeWood' }), dark = clay('#6e4a2a', { roughness: 0.8, key: 'bridgeWoodDark' });
  const stone = clay('#a39aa8', { roughness: 0.75, key: 'bridgeStone' });
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(DECK_W * 2 + 0.3, 0.14, 0.5), wood, 30), m = new THREE.Matrix4();
  for (let i = 0; i < 30; i++) planks.setMatrixAt(i, m.compose(new THREE.Vector3(0, 0.35 - i * 0.02, i * 0.62), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (Math.random() - 0.5) * 0.05, 0)), new THREE.Vector3(1, 1, 1)));
  planks.castShadow = true; planks.receiveShadow = true;
  g.add(planks);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new RoundedBoxGeometry(1.0, 3.6, 1.0, 3, 0.18), stone); p.position.set(side * (DECK_W + 1.1), 1.6, -0.5); p.castShadow = true;
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 }));
    cap.position.set(side * (DECK_W + 1.1), 3.85, -0.5);
    g.add(p, cap);
    for (let z = 0; z < 18; z += 4.5) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 7), dark); post.position.set(side * (DECK_W + 0.1), 0.9 - z * 0.03, z); g.add(post);
    }
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([0, 4.5, 9, 13.5].map((z) => new THREE.Vector3(side * (DECK_W + 0.1), 1.5 - z * 0.03, z))), 16, 0.05, 5), clay('#d8bf8a', { roughness: 0.9, key: 'bridgeRope' }));
    g.add(rope);
  }
  // The fog bank the bridge disappears into.
  const puffs = [], rnd = mulberry32(99), tint = new THREE.Color('#d8f0c8');
  for (let i = 0; i < 40; i++) puffs.push([(rnd() - 0.5) * 16, -2 + rnd() * 9, 9 + rnd() * 14, 5 + rnd() * 7, tint.r, tint.g, tint.b, 0.4 + rnd() * 0.25]);
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geo.instanceCount = puffs.length;
  geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flatMap((q) => q.slice(0, 4))), 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flatMap((q) => q.slice(4))), 4));
  const fog = new THREE.Mesh(geo, mistMaterial());
  fog.frustumCulled = false; fog.renderOrder = 5;
  g.add(fog);
  g.userData = { fog, noCut: true };
  return g;
}
