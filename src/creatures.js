import * as THREE from 'three';
import { mergeStatic } from './merge.js';
import { prop } from './assets.js';

// Enemy creatures, one per theme. Each builder returns a group facing +Z with its origin at
// chest height, plus:
//   flash — the materials that blink white when hit (cloned per creature so only it flashes)
//   tick(dt, t, w) — idle/chase animation (w.chasing, w.vel are provided by Magic)
//   trail — optional particle colour shed while moving
// Rigid parts are merged per material; limbs, wings and tatters stay separate so they animate.

const TAU = Math.PI * 2;

function taper(points, r0, r1, seg = 12, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c);
    const r = r0 + (r1 - r0) * (i / seg);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const scaled = (m, x, y, z) => { m.scale.set(x, y, z); return m; };
const std = (color, emissive, ei = 1, extra = {}) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: 0.5, ...extra });

// A dangling chain of tapered segments (tatters, tendrils, tails) that ripples like cloth.
function strand(len, n, r0, r1, mat, dir = [0, -1, 0], flat = false) {
  const root = new THREE.Group();
  let parent = root;
  const segs = [];
  const d = new THREE.Vector3(...dir).normalize();
  for (let i = 0; i < n; i++) {
    const a = r0 + (r1 - r0) * (i / n), b = r0 + (r1 - r0) * ((i + 1) / n), L = len / n;
    const seg = new THREE.Group();
    // Flat ribbons (cloth, smoke) are tapered quads; round ones are tapered cylinders.
    const geo = flat
      ? new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-a, 0), new THREE.Vector2(a, 0), new THREE.Vector2(b, -L), new THREE.Vector2(-b, -L)]))
      : new THREE.CylinderGeometry(b, a, L, 6, 1).translate(0, -L / 2, 0);
    const cone = new THREE.Mesh(geo, mat);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
    seg.add(cone);
    if (i > 0) seg.position.copy(d).multiplyScalar(len / n);
    parent.add(seg); segs.push(seg); parent = seg;
  }
  root.userData.segs = segs;
  return root;
}
function ripple(str, t, amp, speed, phase, axis = 'x') {
  str.userData.segs.forEach((s, i) => { s.rotation[axis] = Math.sin(t * speed + phase + i * 0.9) * amp * (0.5 + i * 0.35); });
}

// Many flat ribbons (tatters, mist, smoke) merged into ONE mesh that waves in the vertex
// shader: each vertex carries its distance along the ribbon (aW) and a phase (aPh), so a
// whole cloak of tatters is one draw call with zero CPU animation cost.
function ribbons(specs, baseMat, { amp = 0.25, speed = 3 } = {}) {
  const pos = [], w = [], ph = [], idx = [];
  const up = new THREE.Vector3();
  specs.forEach((r, k) => {
    const d = new THREE.Vector3(...r.dir).normalize(), side = new THREE.Vector3(Math.cos(r.yaw || 0), 0, -Math.sin(r.yaw || 0));
    const n = 5, base = pos.length / 3, phase = r.phase ?? k * 1.7;
    for (let i = 0; i <= n; i++) {
      const t = i / n, half = (r.w0 + (r.w1 - r.w0) * t) / 2;
      up.set(...r.pos).addScaledVector(d, r.len * t);
      pos.push(up.x - side.x * half, up.y - side.y * half, up.z - side.z * half, up.x + side.x * half, up.y + side.y * half, up.z + side.z * half);
      w.push(t, t); ph.push(phase, phase);
      if (i < n) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aW', new THREE.Float32BufferAttribute(w, 1));
  geo.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mat = baseMat.clone(), uT = { value: 0 };
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aW; attribute float aPh; uniform float uT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float wv = aW * aW;
        transformed.x += sin(uT * ${speed.toFixed(2)} + aPh + aW * 2.6) * ${amp.toFixed(3)} * wv;
        transformed.z += cos(uT * ${(speed * 0.8).toFixed(2)} + aPh * 1.3 + aW * 2.1) * ${amp.toFixed(3)} * wv;`);
  };
  mat.customProgramCacheKey = () => `ribbon${amp}${speed}`;
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.userData.uT = uT;
  return m;
}

// Glowing flame tongue.
const tongue = (r, h, mat) => new THREE.Mesh(new THREE.ConeGeometry(r, h, 7).translate(0, h / 2, 0), mat);

function finish(group, rigid, flash, tick, trail, hover = 1.6) {
  mergeStatic(rigid);
  group.add(rigid);
  flash.forEach((m) => { m.userData.baseEmissive = m.emissive.clone(); m.userData.baseI = m.emissiveIntensity; });
  return { group, flash, tick, trail, hover };
}

// ---------------------------------------------------------------- Restless Spirit (Hollow Crypt)
// A hooded specter in a tattered, half-transparent robe, reaching out with skeletal hands.
function specter() {
  const g = new THREE.Group(), body = new THREE.Group();
  const robe = std('#26322f', '#1f8a4c', 0.4, { transparent: true, opacity: 0.82, side: THREE.DoubleSide, roughness: 0.85 });
  const eye = std('#e8fff0', '#7dff9b', 3.2);
  const bone = std('#dfeee2', '#3dff7a', 0.7);
  const iron = std('#2b2833', '#000000', 0, { roughness: 0.4 });
  const voidM = new THREE.MeshBasicMaterial({ color: '#020605' });
  // Hood: a sphere with its front cut open, and a peak drooping backwards.
  const hood = mesh(new THREE.SphereGeometry(0.38, 18, 12, Math.PI / 2 + 0.85, TAU - 1.7, 0, Math.PI * 0.66), robe, 0, 0.56, 0);
  hood.scale.set(1, 1.18, 1.08); body.add(hood);
  const peak = mesh(new THREE.ConeGeometry(0.17, 0.7, 10).translate(0, 0.35, 0), robe, 0, 0.78, -0.2); peak.rotation.x = -2.35; body.add(peak);
  const face = mesh(new THREE.SphereGeometry(0.29, 14, 10), voidM, 0, 0.52, 0.03); face.scale.z = 0.8; body.add(face);
  // Slanted, burning eyes and a faint skeletal jaw deep in the hood.
  for (const x of [-0.1, 0.1]) { const e = mesh(new THREE.SphereGeometry(0.05, 10, 8), eye, x, 0.57, 0.25); e.scale.set(1.5, 0.5, 0.6); e.rotation.z = x * 3.2; body.add(e); }
  const jawM = std('#9dffc0', '#2fbf62', 0.9);
  for (let i = 0; i < 6; i++) { const tth = mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), jawM, -0.06 + i * 0.024, 0.4, 0.24); body.add(tth); }
  const glowIn = mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: '#2fbf62', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.5, 0.12); body.add(glowIn);
  // Robe: a flared lathe with a ragged, pointed hem.
  const prof = [[0.26, 0.34], [0.36, 0.14], [0.42, -0.25], [0.5, -0.75], [0.62, -1.25], [0.68, -1.45]].map(([r, y]) => new THREE.Vector2(r, y));
  const rg = new THREE.LatheGeometry(prof, 22), rp = rg.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const y = rp.getY(i);
    if (y < -1.2) { const a = Math.atan2(rp.getX(i), rp.getZ(i)); rp.setY(i, y - 0.28 * (0.5 + 0.5 * Math.sin(a * 9 + 1.3))); }
  }
  rg.computeVertexNormals();
  body.add(new THREE.Mesh(rg, robe));
  const mantle = mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, TAU, 0, Math.PI / 2), robe, 0, 0.12, 0); mantle.scale.set(1.05, 0.45, 0.95); body.add(mantle);
  g.add(body);
  // Tatters trailing from the hem.
  const tatters = ribbons(Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * TAU + 0.2;
    return { pos: [Math.sin(a) * 0.6, -1.38, Math.cos(a) * 0.6], dir: [Math.sin(a) * 0.15, -1, Math.cos(a) * 0.15], yaw: a + Math.PI / 2, len: 0.6 + (i % 3) * 0.25, w0: 0.28, w1: 0.03 };
  }), robe, { amp: 0.22, speed: 3.2 });
  g.add(tatters);
  // Reaching arms: flared sleeves ending in bony, glowing hands; one drags a broken chain.
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.38, 0.15, 0.02);
    arm.add(new THREE.Mesh(taper([[0, 0, 0], [side * 0.08, -0.3, 0.3], [side * 0.05, -0.32, 0.72]], 0.12, 0.2), robe));
    const hand = new THREE.Group(); hand.position.set(side * 0.05, -0.32, 0.78);
    hand.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), bone));
    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.04;
      hand.add(new THREE.Mesh(taper([[fx, 0, 0.04], [fx * 1.4, -0.06, 0.16], [fx * 1.5, -0.15, 0.22]], 0.018, 0.01, 6, 5), bone));
    }
    arm.add(hand);
    if (side < 0) {
      for (let c = 0; c < 4; c++) {
        const link = mesh(new THREE.TorusGeometry(0.045, 0.012, 5, 10), iron, side * 0.05, -0.38 - c * 0.075, 0.7);
        link.rotation.y = c % 2 ? Math.PI / 2 : 0; arm.add(link);
      }
    }
    mergeStatic(arm);
    g.add(arm); arms.push({ arm, side });
  }
  return finish(g, body, [robe, eye, bone, tatters.material], (dt, t, w) => {
    tatters.userData.uT.value = t;
    const reach = w.chasing ? 1 : 0;
    arms.forEach(({ arm, side }) => {
      arm.rotation.x = -0.15 - reach * 0.55 + Math.sin(t * 2 + side) * 0.12;
      arm.rotation.z = side * (0.1 + Math.sin(t * 1.3 + side) * 0.06);
    });
    body.rotation.x = reach * 0.18;
    body.position.y = Math.sin(t * 1.6) * 0.05;
    eye.emissiveIntensity = w.flash > 0 ? 3 : 2.6 + Math.sin(t * 5) * 0.6;
  }, '#8dffb0', 1.95);
}

// ---------------------------------------------------------------- Fire Imp (Ember Caldera)
// A horned imp of cooling magma with bat wings, a grin of fire and a burning tail.
function imp() {
  const g = new THREE.Group(), body = new THREE.Group();
  const rock = std('#2a1e1c', '#ff4a0a', 0.07, { roughness: 0.85, flatShading: true });
  const magma = std('#ffb347', '#ff6a1c', 2.2);
  const eye = std('#fff3b0', '#ffd23a', 3.5);
  const horn = std('#1c1614', '#000000', 0, { roughness: 0.5 });
  const wingM = std('#4a1610', '#ff4a0a', 0.35, { side: THREE.DoubleSide, roughness: 0.7 });
  body.add(scaled(mesh(new THREE.IcosahedronGeometry(0.34, 1), rock), 1, 1.1, 0.9));
  const belly = mesh(new THREE.SphereGeometry(0.24, 14, 10), magma, 0, -0.06, 0.13); belly.scale.set(1, 1.1, 0.7); body.add(belly);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU, c = mesh(new THREE.BoxGeometry(0.03, 0.26, 0.03), magma, Math.sin(a) * 0.3, 0.02 + (i % 2) * 0.08, Math.cos(a) * 0.28);
    c.rotation.set(0.3, a, 0.5); body.add(c);
  }
  // Head: skull, snout, fiery grin, slit eyes, horns and pointed ears.
  const head = new THREE.Group(); head.position.set(0, 0.46, 0.04);
  head.add(scaled(mesh(new THREE.IcosahedronGeometry(0.25, 1), rock), 1.1, 1, 1));
  const snout = mesh(new THREE.SphereGeometry(0.16, 12, 8), rock, 0, -0.08, 0.14); snout.scale.set(1.2, 0.7, 1); head.add(snout);
  const grin = mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 14, Math.PI), magma, 0, -0.08, 0.26); grin.rotation.z = Math.PI; head.add(grin);
  for (let i = 0; i < 4; i++) head.add(mesh(new THREE.ConeGeometry(0.018, 0.05, 4).rotateX(Math.PI), eye, -0.06 + i * 0.04, -0.07, 0.27));
  for (const x of [-0.09, 0.09]) { const e = mesh(new THREE.SphereGeometry(0.045, 8, 6), eye, x, 0.04, 0.2); e.scale.set(1.3, 0.55, 0.6); e.rotation.z = -x * 3; head.add(e); }
  for (const s of [-1, 1]) {
    head.add(new THREE.Mesh(taper([[s * 0.12, 0.14, -0.02], [s * 0.24, 0.3, -0.06], [s * 0.24, 0.45, -0.18], [s * 0.18, 0.52, -0.3]], 0.06, 0.005), horn));
    const ear = mesh(new THREE.ConeGeometry(0.06, 0.22, 5), rock, s * 0.25, 0.02, -0.02); ear.rotation.z = -s * 1.2; head.add(ear);
  }
  body.add(head);
  // Stubby clawed arms and tucked legs.
  for (const s of [-1, 1]) {
    body.add(new THREE.Mesh(taper([[s * 0.28, 0.12, 0.02], [s * 0.4, -0.08, 0.14], [s * 0.3, -0.18, 0.26]], 0.07, 0.05), rock));
    for (let c = 0; c < 3; c++) body.add(mesh(new THREE.ConeGeometry(0.02, 0.09, 4).rotateX(Math.PI / 2), horn, s * 0.3 + (c - 1) * 0.03, -0.2, 0.31));
    body.add(new THREE.Mesh(taper([[s * 0.14, -0.3, 0], [s * 0.2, -0.46, 0.12], [s * 0.16, -0.56, 0.02]], 0.08, 0.06), rock));
  }
  g.add(body);
  // Flame hair.
  const flames = [];
  for (let i = 0; i < 4; i++) {
    const f = tongue(0.06 + (i % 2) * 0.02, 0.26, magma); f.position.set((i - 1.5) * 0.08, 0.66, -0.04 - Math.abs(i - 1.5) * 0.03); f.rotation.x = -0.4;
    g.add(f); flames.push(f);
  }
  // Bat wings: scalloped membranes stretched over finger bones.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.lineTo(0.55, 0.32); wingShape.lineTo(0.9, 0.18);
  wingShape.quadraticCurveTo(0.72, 0.02, 0.78, -0.2); wingShape.quadraticCurveTo(0.56, -0.12, 0.5, -0.32);
  wingShape.quadraticCurveTo(0.34, -0.14, 0.2, -0.3); wingShape.lineTo(0, -0.1);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(s * 0.14, 0.2, -0.22);
    const mem = new THREE.Mesh(new THREE.ShapeGeometry(wingShape), wingM); mem.scale.x = s; w.add(mem);
    [[0.9, 0.18], [0.78, -0.2], [0.5, -0.32]].forEach(([x, y]) => {
      const len = Math.hypot(x, y), b = mesh(new THREE.CylinderGeometry(0.012, 0.02, len, 4), horn, s * x / 2, y / 2, 0.005);
      b.rotation.z = Math.atan2(s * x, -y) + Math.PI; w.add(b);
    });
    w.rotation.y = s * 0.5;
    g.add(w); wings.push({ w, s });
  }
  // Barbed tail with a flame at the tip.
  const tail = new THREE.Group(); tail.position.set(0, -0.3, -0.22);
  tail.add(new THREE.Mesh(taper([[0, 0, 0], [0, -0.3, -0.25], [0, -0.2, -0.6], [0, 0.05, -0.8]], 0.06, 0.02), rock));
  const tip = tongue(0.07, 0.24, magma); tip.position.set(0, 0.05, -0.8); tip.rotation.x = -0.6; tail.add(tip);
  g.add(tail);
  return finish(g, body, [rock, magma, eye], (dt, t, w) => {
    const beat = Math.sin(t * (w.chasing ? 16 : 10));
    wings.forEach(({ w: wg, s }) => { wg.rotation.y = s * (0.3 + beat * 0.7); });
    flames.forEach((f, i) => { f.scale.y = 0.8 + Math.abs(Math.sin(t * 13 + i * 2)) * 0.6; });
    tail.rotation.y = Math.sin(t * 3) * 0.5; tail.rotation.x = Math.sin(t * 2.2) * 0.2;
    body.position.y = Math.abs(beat) * 0.06;
    body.rotation.x = w.chasing ? 0.25 : 0;
    magma.emissiveIntensity = w.flash > 0 ? 3 : 2 + Math.sin(t * 6) * 0.4;
  }, '#ffb347', 1.8);
}

// ---------------------------------------------------------------- Frost Wraith (Glacial Hollow)
// A tall crystalline wraith: faceted ice mask with a crown of spikes, ice pauldrons, long
// clawed arms and a body that trails away into freezing mist.
function wraith() {
  const g = new THREE.Group(), body = new THREE.Group();
  const iceM = std('#8fc8f0', '#2f8ee0', 0.6, { roughness: 0.1, flatShading: true, transparent: true, opacity: 0.92 });
  const mask = std('#f2faff', '#8fd8ff', 0.3, { roughness: 0.2, flatShading: true });
  const eye = std('#e8fbff', '#6fd8ff', 3.6);
  const mist = std('#a8d8f8', '#3f9ae8', 0.8, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const crystal = (r, h) => new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), new THREE.Vector2(r, h * 0.12), new THREE.Vector2(r, h * 0.7), new THREE.Vector2(0.001, h)], 6);
  // Faceted torso and a mist tail.
  const chest = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0.46], [0.2, 0.44], [0.38, 0.34], [0.36, 0.1], [0.24, -0.15], [0.17, -0.4], [0.001, -0.48]].map(([r, y]) => new THREE.Vector2(r, y)), 7), iceM);
  chest.scale.z = 0.7; body.add(chest);
  for (let r = 0; r < 3; r++) { const rib = mesh(new THREE.TorusGeometry(0.3 - r * 0.04, 0.022, 4, 7, Math.PI), mask, 0, 0.18 - r * 0.13, 0.02); rib.rotation.set(Math.PI / 2 + 0.2, 0, Math.PI); rib.scale.y = 0.7; body.add(rib); }
  const tailM = mesh(new THREE.ConeGeometry(0.3, 1.0, 10, 2, true).rotateX(Math.PI), mist, 0, -0.9, 0); body.add(tailM);
  // Head: mask, glowing slit eyes, crown of ice.
  const head = new THREE.Group(); head.position.set(0, 0.72, 0.02);
  head.add(scaled(mesh(new THREE.IcosahedronGeometry(0.21, 0), mask), 0.9, 1.25, 0.85));
  for (const x of [-0.08, 0.08]) { const e = mesh(new THREE.BoxGeometry(0.1, 0.025, 0.02), eye, x, 0.03, 0.17); e.rotation.z = x * 2.5; head.add(e); }
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.35, c = mesh(crystal(0.04, 0.3 + (2 - Math.abs(i - 2)) * 0.12), iceM, Math.sin(a) * 0.12, 0.18, -0.02);
    c.rotation.set(-0.25, 0, -a * 0.9); head.add(c);
  }
  body.add(head);
  // Ice pauldrons.
  for (const s of [-1, 1]) for (let c = 0; c < 3; c++) {
    const cr = mesh(crystal(0.06, 0.28 + c * 0.06), iceM, s * (0.34 + c * 0.05), 0.36, -0.04 + (c - 1) * 0.07);
    cr.rotation.z = -s * (0.7 + c * 0.2); body.add(cr);
  }
  g.add(body);
  // Long clawed arms.
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.4, 0.28, 0);
    arm.add(new THREE.Mesh(taper([[0, 0, 0], [s * 0.18, -0.4, 0.1], [s * 0.14, -0.72, 0.36], [s * 0.08, -0.82, 0.6]], 0.07, 0.04, 14, 6), mist));
    for (let c = 0; c < 3; c++) {
      const claw = mesh(new THREE.ConeGeometry(0.02, 0.26, 5).rotateX(Math.PI / 2), iceM, s * 0.08 + (c - 1) * 0.04, -0.85, 0.72);
      claw.rotation.set(0.5, (c - 1) * 0.25, 0); arm.add(claw);
    }
    mergeStatic(arm);
    g.add(arm); arms.push({ arm, s });
  }
  // A frost cape of icy streamers, and shards in orbit.
  // A frost cape from the shoulders, and a lower body dissolving into curling ribbons of mist.
  const specs = [];
  for (let i = 0; i < 5; i++) specs.push({ pos: [(i - 2) * 0.13, 0.35, -0.2], dir: [0, -1, -0.3], yaw: 0, len: 0.9 + (i % 2) * 0.3, w0: 0.2, w1: 0.02 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    specs.push({ pos: [Math.sin(a) * 0.18, -0.4, Math.cos(a) * 0.14], dir: [Math.sin(a) * 0.25, -1, Math.cos(a) * 0.25], yaw: a + Math.PI / 2, len: 1.1 + (i % 3) * 0.3, w0: 0.28, w1: 0.02 });
  }
  const streamers = ribbons(specs, mist, { amp: 0.28, speed: 2.6 });
  g.add(streamers);
  const shards = [];
  for (let i = 0; i < 3; i++) { const sh = mesh(new THREE.OctahedronGeometry(0.07, 0), iceM); sh.scale.y = 2; g.add(sh); shards.push(sh); }
  return finish(g, body, [iceM, eye, mask, streamers.material], (dt, t, w) => {
    streamers.userData.uT.value = t;
    arms.forEach(({ arm, s }) => { arm.rotation.x = (w.chasing ? -0.7 : -0.1) + Math.sin(t * 1.7 + s) * 0.15; arm.rotation.z = s * Math.sin(t * 1.1) * 0.1; });
    shards.forEach((sh, i) => { const a = t * 1.6 + (i / 3) * TAU; sh.position.set(Math.sin(a) * 0.7, 0.1 + Math.sin(t * 2 + i) * 0.2, Math.cos(a) * 0.7); sh.rotation.y = a; });
    body.position.y = Math.sin(t * 1.3) * 0.06;
    tailM.rotation.y = t * 0.8;
    eye.emissiveIntensity = w.flash > 0 ? 3 : 3.2 + Math.sin(t * 4) * 0.5;
  }, '#dff6ff', 2.15);
}

// ---------------------------------------------------------------- Shadow Wisp (the valley)
// A shade of living shadow: a violet heart-flame behind a cracked porcelain mask, crowned with
// dark fire and trailing smoky tendrils.
function shade() {
  const g = new THREE.Group(), body = new THREE.Group();
  const core = std('#1a0626', '#8a2be2', 2.2, { roughness: 0.3 });
  const smoke = std('#1c0f28', '#5a1a9a', 0.5, { transparent: true, opacity: 0.8, roughness: 0.9 });
  const mask = std('#efe6f5', '#6a3a8a', 0.12, { roughness: 0.35 });
  const eye = std('#ffe0ff', '#ff6af0', 3);
  const flameM = std('#d9a8ff', '#a040ff', 2.6);
  body.add(mesh(new THREE.IcosahedronGeometry(0.32, 2), core));
  const shroud = mesh(new THREE.SphereGeometry(0.46, 16, 10, 0, TAU, Math.PI * 0.52, Math.PI * 0.48), smoke); shroud.scale.set(1, 1.5, 1); body.add(shroud);
  const m = mesh(new THREE.SphereGeometry(0.28, 16, 12, Math.PI / 2 - 0.9, 1.8, 0.35, 1.9), mask, 0, 0.12, 0.2); m.scale.set(1, 1.2, 0.8); m.material.side = THREE.DoubleSide; body.add(m);
  const crack = mesh(new THREE.BoxGeometry(0.012, 0.16, 0.01), new THREE.MeshBasicMaterial({ color: '#3a1050' }), -0.03, 0.27, 0.41); crack.rotation.z = 0.5; body.add(crack);
  for (const x of [-0.09, 0.09]) {
    const hole = mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({ color: '#0a0010' }), x, 0.17, 0.4); hole.scale.set(1.2, 0.8, 0.4); body.add(hole);
    body.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), eye, x, 0.17, 0.42));
  }
  const tear = mesh(new THREE.BoxGeometry(0.012, 0.14, 0.01), eye, 0.1, 0.06, 0.415); body.add(tear);
  g.add(body);
  const flames = [];
  for (let i = 0; i < 5; i++) {
    const f = tongue(0.07, 0.34 + (2 - Math.abs(i - 2)) * 0.1, flameM); f.position.set((i - 2) * 0.1, 0.38, -0.05); f.rotation.z = -(i - 2) * 0.25;
    g.add(f); flames.push(f);
  }
  const tendrils = [];
  const wisp = std('#2a1040', '#7a2ad0', 0.9, { transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
  const smokeTail = ribbons(Array.from({ length: 7 }, (_, i) => {
    const a = Math.PI + (i - 3) * 0.45;
    return { pos: [Math.sin(a) * 0.25, -0.2, Math.cos(a) * 0.25], dir: [Math.sin(a) * 0.6, -0.7, Math.cos(a) * 0.9], yaw: a + Math.PI / 2, len: 1.1 + (i % 3) * 0.3, w0: 0.24, w1: 0.02 };
  }), wisp, { amp: 0.3, speed: 3 });
  g.add(smokeTail); tendrils.push(smokeTail);
  // Two smoky arms ending in hooked claws, reaching for you when it hunts.
  const arms = [];
  for (const side of [-1, 1]) {
    const a = strand(0.75, 3, 0.07, 0.03, smoke, [side * 0.6, -0.5, 0.75]);
    a.position.set(side * 0.3, 0.02, 0.05);
    const tip = a.userData.segs.at(-1), dir = new THREE.Vector3(side * 0.6, -0.5, 0.75).normalize().multiplyScalar(0.25);
    for (let c = 0; c < 3; c++) {
      const claw = mesh(new THREE.ConeGeometry(0.018, 0.16, 4), eye, dir.x + (c - 1) * 0.035, dir.y, dir.z);
      claw.rotation.set(1.2, 0, -side * 0.3 + (c - 1) * 0.3); tip.add(claw);
    }
    g.add(a); arms.push({ a, side });
  }
  return finish(g, body, [core, eye, flameM], (dt, t, w) => {
    arms.forEach(({ a, side }) => { a.rotation.x = (w.chasing ? -0.5 : 0.1) + Math.sin(t * 2.4 + side) * 0.15; ripple(a, t, 0.2, 3, side, 'z'); });
    smokeTail.userData.uT.value = t;
    flames.forEach((f, i) => { f.scale.y = 0.75 + Math.abs(Math.sin(t * 9 + i * 1.7)) * 0.5; });
    body.scale.setScalar(1 + Math.sin(t * 8) * 0.04);
    body.position.y = Math.sin(t * 2.3) * 0.05;
  }, '#c04dff');
}

// ---------------------------------------------------------------- Crag Golem (Sundered Deep)
// A hunched boulder-giant with a glowing heart behind stone plates and cut-crystal eyes. Uses
// the Blender sculpt (deep.glb: golem_torso/plates/head/arm/leg) when loaded; otherwise a
// procedural stand-in of fused rocks. Origin at the feet; it walks rather than floats.
function blenderPart(name, mats) {
  const p = prop(name);
  if (!p) return null;
  p.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (o.material.emissiveIntensity > 0.05 || /Eye|Core/.test(o.material.name)) mats.push(o.material);
  });
  return p;
}
function golem() {
  const g = new THREE.Group(), flash = [];
  const rock = std('#8a6a4a', '#000000', 0, { roughness: 0.85, flatShading: true });
  const plateM = std('#6d6a72', '#000000', 0, { roughness: 0.8, flatShading: true });
  const core = std('#ffb347', '#ff8a1a', 3.5);
  const eye = std('#fff3b0', '#ffd36b', 4);
  flash.push(core, eye);
  const HIP = 0.86, blend = !!prop('golem_torso');
  // Torso.
  const torso = blenderPart('golem_torso', flash) || (() => {
    const t = new THREE.Group();
    const lump = (r, x, y, z, sx = 1, sy = 1, sz = 1) => t.add(scaled(mesh(new THREE.DodecahedronGeometry(r, 1), rock, x, y, z), sx, sy, sz));
    lump(0.95, 0, 0.75, -0.1, 1.15, 0.95, 0.85); lump(0.55, -0.7, 1.25, -0.1); lump(0.55, 0.7, 1.25, -0.1); lump(0.5, 0, 0.2, 0, 1.2, 0.6, 0.9);
    t.add(mesh(new THREE.IcosahedronGeometry(0.3, 1), core, 0, 0.85, 0.62));
    return t;
  })();
  torso.position.y = HIP; g.add(torso);
  const plates = blenderPart('golem_plates', flash) || (() => {
    const p = new THREE.Group();
    const slab = (w, h, x, y, z, rx = 0, rz = 0) => { const m = mesh(new THREE.BoxGeometry(w, h, 0.22), plateM, x, y, z); m.rotation.set(rx, 0, rz); p.add(m); };
    slab(0.9, 0.8, 0, 0.85, 0.78, -0.12); slab(0.7, 0.5, -0.8, 1.5, 0.1, -1.2, 0.3); slab(0.7, 0.5, 0.8, 1.5, 0.1, -1.2, -0.3);
    return p;
  })();
  plates.position.y = HIP; g.add(plates);
  const head = blenderPart('golem_head', flash) || (() => {
    const h = new THREE.Group();
    h.add(scaled(mesh(new THREE.DodecahedronGeometry(0.36, 0), rock, 0, 0.25, 0), 1.1, 0.8, 1));
    [-0.13, 0.13].forEach((x) => h.add(mesh(new THREE.OctahedronGeometry(0.07), eye, x, 0.28, 0.31)));
    return h;
  })();
  head.position.set(0, HIP + (blend ? 1.5 : 1.45), blend ? 0.16 : 0.25); g.add(head);
  const limb = (name, fallback) => blenderPart(name, flash) || fallback();
  const armFallback = () => {
    const a = new THREE.Group();
    a.add(scaled(mesh(new THREE.DodecahedronGeometry(0.3, 1), rock, 0.05, -0.4, 0), 1, 1.5, 1));
    a.add(scaled(mesh(new THREE.DodecahedronGeometry(0.28, 1), rock, 0.08, -1.05, 0.05), 1, 1.4, 1));
    a.add(mesh(new THREE.DodecahedronGeometry(0.42, 1), rock, 0.1, -1.6, 0.1));
    return a;
  };
  const legFallback = () => { const l = new THREE.Group(); l.add(scaled(mesh(new THREE.DodecahedronGeometry(0.34, 1), rock, 0, -0.45, 0), 1, 1.35, 1)); l.add(scaled(mesh(new THREE.DodecahedronGeometry(0.3, 0), rock, 0, -0.82, 0.12), 1.3, 0.5, 1.5)); return l; };
  const arms = [1, -1].map((side) => {
    const a = limb('golem_arm', armFallback);
    // Blender builds the right arm with its length along -Z (down in Blender = -Y here after export).
    if (side < 0) a.scale.x = -1;
    a.position.set(side * (blend ? 0.72 : 1.02), HIP + (blend ? 1.3 : 1.25), 0); g.add(a);
    return { a, side };
  });
  const legs = [1, -1].map((side) => { const l = limb('golem_leg', legFallback); if (side < 0) l.scale.x = -1; l.position.set(side * (blend ? 0.42 : 0.45), blend ? 0.9 : HIP, blend ? -0.05 : 0); g.add(l); return { l, side }; });
  // Blender glow is strong under ACES; the eyes and core pulse from calmer bases.
  const eyes = flash.filter((m) => m === eye || /Eye/.test(m.name)), cores = flash.filter((m) => m === core || /Core/.test(m.name));
  const body = new THREE.Group(); // nothing rigid left to merge: parts animate individually
  const c = finish(g, body, flash, (dt, t, w) => {
    const speed = Math.hypot(w.vel.x, w.vel.z), stride = Math.min(1, speed / 2) * 0.55;
    const ph = (w.walkPh = (w.walkPh || 0) + dt * (2 + speed * 1.5));
    legs.forEach(({ l, side }) => { l.rotation.x = Math.sin(ph + (side > 0 ? 0 : Math.PI)) * stride; });
    // Arms: swing while walking; raise to slam when close and hunting.
    const slam = w.slam || 0;
    arms.forEach(({ a, side }) => { a.rotation.x = -slam * 2.4 + Math.sin(ph + (side > 0 ? Math.PI : 0)) * stride * 0.8; a.rotation.z = side * (0.12 + slam * 0.2); });
    torso.rotation.x = 0.12 + Math.sin(ph * 2) * 0.03 - slam * 0.15;
    head.rotation.y = Math.sin(t * 0.7) * 0.25;
    const dz = w.dazzled > 0;
    eyes.forEach((m) => { if (!m.userData.flashing) m.emissiveIntensity = dz ? 6 + Math.sin(t * 40) * 3 : 1.8; });
    cores.forEach((m) => { if (!m.userData.flashing) m.emissiveIntensity = plates.visible ? 1.4 : 4 + Math.sin(t * 6) * 1.2; });
  }, '#b89a74', 0);
  c.grounded = true;
  c.setArmour = (on) => { plates.visible = on; };
  c.height = 3.2;
  return c;
}

// ---------------------------------------------------------------- Bone Soldier (Bone Fields haunt)
// A skeleton in a rusted helm behind a round shield. Blender sculpt from bosses.glb when loaded.
function bones() {
  const g = new THREE.Group(), flash = [];
  const bone = std('#e9e0c8', '#000000', 0, { roughness: 0.7 }), rust = std('#6a4a3a', '#000000', 0, { roughness: 0.6, metalness: 0.4 });
  const eye = std('#c9ffd8', '#5dff8a', 2.4); flash.push(eye);
  const src = blenderPart('bone_soldier', flash);
  const body = new THREE.Group();
  let armL = null;
  if (src) { body.add(src); }
  else {
    body.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), bone, 0, 1.05, 0));
    for (let i = 0; i < 4; i++) body.add(scaled(mesh(new THREE.TorusGeometry(0.2 - i * 0.02, 0.025, 5, 14, Math.PI * 1.4), bone, 0, 1.35 - i * 0.12, 0.02), 1, 1, 0.8));
    body.add(scaled(mesh(new THREE.SphereGeometry(0.2, 12, 10), bone, 0, 1.72, 0), 1, 1.05, 1.1));
    body.add(scaled(mesh(new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), rust, 0, 1.78, 0), 1, 0.8, 1));
    [-0.07, 0.07].forEach((x) => body.add(mesh(new THREE.SphereGeometry(0.035, 6, 5), eye, x, 1.72, 0.18)));
    [-0.12, 0.12].forEach((x) => body.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.9, 5), bone, x, 0.45, 0)));
    const shield = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 16), rust, -0.3, 1.1, 0.25); shield.rotation.x = Math.PI / 2; body.add(shield);
    armL = mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05), rust, 0.32, 1.1, 0.15); armL.rotation.x = -0.6; body.add(armL);
  }
  g.add(body);
  const c = finish(g, new THREE.Group(), flash, (dt, t, w) => {
    const speed = Math.hypot(w.vel.x, w.vel.z);
    body.position.y = Math.abs(Math.sin(t * 6)) * 0.05 * Math.min(1, speed);
    body.rotation.z = Math.sin(t * 6) * 0.05 * Math.min(1, speed);
    if (armL) armL.rotation.x = -0.6 - (w.slam || 0) * 1.4;
  }, '#e9e0c8', 0);
  c.grounded = true; c.height = 1.9;
  return c;
}

// ---------------------------------------------------------------- boss targets
function phylactery() {
  const g = new THREE.Group(), flash = [];
  const glass = std('#b8ffcc', '#5dff8a', 2.2, { transparent: true, opacity: 0.8 }); flash.push(glass);
  const src = blenderPart('phylactery', flash);
  if (src) g.add(src);
  else {
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.5, 8), std('#e9e0c8', '#000000', 0), 0, 0.25, 0));
    g.add(scaled(mesh(new THREE.OctahedronGeometry(0.35, 0), glass, 0, 0.9, 0), 1, 1.4, 1));
  }
  const c = finish(g, new THREE.Group(), flash, (dt, t) => { g.children[0].rotation.y += dt; }, '#8dffb0', 0);
  c.grounded = true; c.height = 1.2;
  return c;
}
function orb() {
  const g = new THREE.Group(), core = std('#ffffff', '#ffffff', 2.5);
  const cage = prop('element_orb');
  if (cage) { cage.scale.setScalar(1.6); g.add(cage); }
  g.add(mesh(new THREE.SphereGeometry(0.34, 16, 12), core));
  const c = finish(g, new THREE.Group(), [core], (dt, t) => { g.rotation.y += dt * 1.2; }, '#ffffff', 0);
  c.setColor = (col) => { core.color.set(col); core.emissive.set(col); core.userData.baseEmissive = core.emissive.clone(); };
  c.hover = 2.2;
  return c;
}

// ---------------------------------------------------------------- guardians
// Each guardian has its own Blender body (bosses.glb) with animated arms; until that loads, it
// is its realm's creature, scaled up and crowned.
// The sculpts are authored with strong emission for Blender previews; in game, bloom does the
// rest, so glowing eyes and crystals are brought down to calmer levels.
function tame(mats) { mats.forEach((m) => { m.emissiveIntensity = Math.min(m.emissiveIntensity, /Eye/.test(m.name) ? 2.2 : 1.4); }); }

// `cc` (optional): the toy-troop sculpt from characters.glb — { body, arm, shoulder } — used in
// preference to the older bosses.glb model when it has loaded.
function guardian(bodyName, armName, base, { height, shoulder, grounded = true, hover = 0, cc = null }) {
  return () => {
    const useCC = cc && prop(cc.body) && prop(cc.arm);
    if (useCC) ({ body: bodyName, arm: armName, shoulder } = cc);
    const flash = [], body = blenderPart(bodyName, flash);
    if (!body) { const c = base(); c.bossFallback = true; return c; }
    const g = new THREE.Group(); g.add(body);
    const arms = [1, -1].map((side) => {
      const a = blenderPart(armName, flash) || new THREE.Group();
      if (side < 0) a.scale.x = -1;
      a.position.set(side * shoulder[0], shoulder[1], shoulder[2]); g.add(a);
      return { a, side };
    });
    if (useCC) tame(flash);
    const c = finish(g, new THREE.Group(), flash, (dt, t, w) => {
      const slam = w.slam || 0;
      arms.forEach(({ a, side }) => { a.rotation.x = -slam * 2.2 + Math.sin(t * 1.4 + side) * 0.12; a.rotation.z = side * (0.15 + Math.sin(t * 0.9) * 0.05 + slam * 0.3); });
      body.rotation.y = Math.sin(t * 0.5) * 0.05;
    }, null, hover);
    c.grounded = grounded; c.height = height; c.hover = hover;
    c.setArmour = (on) => { g.traverse((o) => { if (o.userData.plates) o.visible = on; }); };
    return c;
  };
}
const lich = guardian('lich_body', 'lich_arm', specter, { height: 3.4, shoulder: [0.62, 2.34, 0.02], grounded: false, hover: 0.6, cc: { body: 'c_lich_body', arm: 'c_lich_arm', shoulder: [0.66, 2.3, 0] } });
const queen = guardian('queen_body', 'queen_arm', wraith, { height: 3.6, shoulder: [0.32, 2.42, 0], grounded: false, hover: 0.3, cc: { body: 'c_queen_body', arm: 'c_queen_arm', shoulder: [0.4, 2.36, 0] } });
function tyrant() {
  const c = guardian('tyrant_body', 'tyrant_arm', imp, { height: 3.8, shoulder: [1.0, 2.62, 0.05], cc: { body: 'c_tyrant_body', arm: 'c_tyrant_arm', shoulder: [1.0, 2.55, 0] } })();
  if (c.bossFallback) return c;
  const plates = prop(prop('c_tyrant_body') ? 'c_tyrant_plates' : 'tyrant_plates');
  if (plates) { plates.userData.plates = true; c.group.add(plates); }
  return c;
}
function unraveller() {
  const flash = [], body = blenderPart(prop('c_unraveller_body') ? 'c_unraveller_body' : 'unraveller_body', flash);
  if (!body) { const c = wraith(); c.bossFallback = true; return c; }
  const g = new THREE.Group(); g.add(body);
  if (prop('c_unraveller_body')) tame(flash);
  const c = finish(g, new THREE.Group(), flash, (dt, t) => { body.rotation.y = Math.sin(t * 0.4) * 0.15; body.position.y = Math.sin(t * 1.3) * 0.15; }, '#ff9ae8', 1.2);
  c.height = 3.2; c.hover = 1.2;
  return c;
}

// A haunt's ward totem: a chained obelisk whose sockets glow with the element that breaks it.
function totem() {
  const g = new THREE.Group(), glowM = std('#ffffff', '#ffffff', 2.4);
  const src = prop('ward_totem');
  if (src) g.add(src);
  else {
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.8, 3, 4), std('#6a6474', '#000000', 0, { flatShading: true }), 0, 1.5, 0));
    g.children[0].rotation.y = Math.PI / 4;
  }
  for (let i = 0; i < 5; i++) g.add(mesh(new THREE.SphereGeometry(0.11, 10, 8), glowM, 0, 0.7 + i * 0.5, 0.45));
  const l = new THREE.PointLight('#ffffff', 8, 10, 2); l.position.set(0, 2, 1); g.add(l);
  const c = finish(g, new THREE.Group(), [glowM], () => {}, '#b89bff', 0);
  c.setColor = (col) => { glowM.color.set(col); glowM.emissive.set(col); glowM.userData.baseEmissive = glowM.emissive.clone(); l.color.set(col); };
  c.grounded = true; c.height = 3;
  return c;
}

// ================================================================ sculpted foes
// The toy-troop sculpts from tools/blender/build_characters.py (characters.glb): a body plus
// separately animated limbs, each part with its origin on its joint. Joint positions below are
// Blender's (x, y, z) converted to three.js (x, z, −y). Until the library has loaded — or if it
// is missing — each builder returns null and the procedural creature above is used instead.
const J = (x, y, z) => [x, z, -y];
function limbPair(name, joint, flash, parent) {
  return [1, -1].map((side) => {
    const a = blenderPart(name, flash);
    if (side < 0) a.scale.x = -1;
    const [x, y, z] = J(...joint);
    a.position.set(side * x, y, z);
    parent.add(a);
    return { a, side };
  });
}
// Eyes pulse gently unless they are mid hit-flash.
const pulse = (mats, base, t, speed = 5, amp = 0.15) => mats.forEach((m) => { if (!m.userData.flashing) m.emissiveIntensity = base * (1 + Math.sin(t * speed) * amp); });
const byName = (mats, re) => mats.filter((m) => re.test(m.name));

function shadeCC() {
  const flash = [], g = new THREE.Group(), body = new THREE.Group();
  const src = blenderPart('c_shade_body', flash);
  if (!src || !prop('c_shade_arm')) return null;
  body.add(src); g.add(body);
  const flameM = std('#d9a8ff', '#a040ff', 2.6); flash.push(flameM);
  const flames = [];
  for (let i = 0; i < 5; i++) {
    const f = tongue(0.075, 0.3 + (2 - Math.abs(i - 2)) * 0.1, flameM); f.position.set((i - 2) * 0.1, 0.42 - Math.abs(i - 2) * 0.03, 0.02 - Math.abs(i - 2) * 0.03); f.rotation.z = -(i - 2) * 0.28;
    body.add(f); flames.push(f);
  }
  const wisp = std('#2a1040', '#7a2ad0', 0.9, { transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
  const smokeTail = ribbons(Array.from({ length: 7 }, (_, i) => {
    const a = Math.PI + (i - 3) * 0.45;
    return { pos: [Math.sin(a) * 0.2, -0.45, Math.cos(a) * 0.2 - 0.1], dir: [Math.sin(a) * 0.5, -0.8, Math.cos(a) * 0.9], yaw: a + Math.PI / 2, len: 1.0 + (i % 3) * 0.3, w0: 0.22, w1: 0.02 };
  }), wisp, { amp: 0.3, speed: 3 });
  g.add(smokeTail);
  const arms = limbPair('c_shade_arm', [0.36, -0.02, -0.02], flash, body);
  const eyes = byName(flash, /Eye/), eyeI = eyes[0]?.emissiveIntensity || 3;
  return finish(g, new THREE.Group(), flash, (dt, t, w) => {
    const hunt = w.chasing ? 1 : 0;
    arms.forEach(({ a, side }) => { a.rotation.x = -0.15 - hunt * 0.9 + Math.sin(t * 2.4 + side) * 0.15; a.rotation.z = side * (0.3 + Math.sin(t * 1.7 + side) * 0.1); });
    smokeTail.userData.uT.value = t;
    flames.forEach((f, i) => { f.scale.y = 0.75 + Math.abs(Math.sin(t * 9 + i * 1.7)) * 0.5; });
    body.scale.setScalar(1 + Math.sin(t * 6) * 0.03);
    body.position.y = Math.sin(t * 2.3) * 0.06;
    body.rotation.x = hunt * 0.15;
    pulse(eyes, eyeI * 0.5, t, 5);
  }, '#c04dff');
}

function specterCC() {
  const flash = [], g = new THREE.Group(), body = new THREE.Group();
  const src = blenderPart('c_specter_body', flash);
  if (!src || !prop('c_specter_arm')) return null;
  body.add(src); g.add(body);
  const robe = std('#2f7a5e', '#1f8a4c', 0.3, { transparent: true, opacity: 0.75, roughness: 0.6 });
  const tatters = ribbons(Array.from({ length: 11 }, (_, i) => {
    const a = (i / 11) * TAU + 0.2;
    return { pos: [Math.sin(a) * 0.58, -1.45, Math.cos(a) * 0.58], dir: [Math.sin(a) * 0.15, -1, Math.cos(a) * 0.15], yaw: a + Math.PI / 2, len: 0.45 + (i % 3) * 0.2, w0: 0.3, w1: 0.03 };
  }), robe, { amp: 0.2, speed: 3.2 });
  body.add(tatters);
  const arms = limbPair('c_specter_arm', [0.4, -0.02, 0.18], flash, body);
  const eyes = byName(flash, /Eye/), eyeI = eyes[0]?.emissiveIntensity || 3;
  return finish(g, new THREE.Group(), flash, (dt, t, w) => {
    tatters.userData.uT.value = t;
    const reach = w.chasing ? 1 : 0;
    arms.forEach(({ a, side }) => { a.rotation.x = -0.2 - reach * 0.8 + Math.sin(t * 2 + side) * 0.12; a.rotation.z = side * (0.12 + Math.sin(t * 1.3 + side) * 0.06); });
    body.rotation.x = reach * 0.15;
    body.position.y = Math.sin(t * 1.6) * 0.06;
    body.rotation.z = Math.sin(t * 0.9) * 0.04;
    pulse(eyes, eyeI * 0.22, t, 5, 0.25);
  }, '#8dffb0', 1.95);
}

function impCC() {
  const flash = [], g = new THREE.Group(), body = new THREE.Group();
  const src = blenderPart('c_imp_body', flash);
  if (!src || !prop('c_imp_wing') || !prop('c_imp_tail')) return null;
  body.add(src); g.add(body);
  const magma = std('#ffb347', '#ff6a1c', 2.2); flash.push(magma);
  const flames = [];
  for (let i = 0; i < 3; i++) {
    const f = tongue(0.07 + (i % 2) * 0.02, 0.28, magma); f.position.set((i - 1) * 0.09, 0.58, 0.02 - Math.abs(i - 1) * 0.04); f.rotation.x = -0.35;
    body.add(f); flames.push(f);
  }
  const wings = limbPair('c_imp_wing', [0.14, 0.22, 0.2], flash, body);
  const tail = blenderPart('c_imp_tail', flash); tail.position.set(...J(0, 0.22, -0.3)); body.add(tail);
  const core = byName(flash, /Core/), coreI = core[0]?.emissiveIntensity || 2;
  return finish(g, new THREE.Group(), flash, (dt, t, w) => {
    const beat = Math.sin(t * (w.chasing ? 16 : 10));
    wings.forEach(({ a, side }) => { a.rotation.y = side * (0.1 + beat * 0.65); a.rotation.z = side * 0.15; });
    flames.forEach((f, i) => { f.scale.y = 0.8 + Math.abs(Math.sin(t * 13 + i * 2)) * 0.6; });
    tail.rotation.y = Math.sin(t * 3) * 0.45; tail.rotation.x = Math.sin(t * 2.2) * 0.15;
    body.position.y = Math.abs(beat) * 0.06;
    body.rotation.x = w.chasing ? 0.25 : 0;
    pulse(core, coreI * 0.3, t, 6, 0.2);
  }, '#ffb347', 1.8);
}

function wraithCC() {
  const flash = [], g = new THREE.Group(), body = new THREE.Group();
  const src = blenderPart('c_wraith_body', flash);
  if (!src || !prop('c_wraith_arm')) return null;
  body.add(src); g.add(body);
  const arms = limbPair('c_wraith_arm', [0.42, 0, 0.3], flash, body);
  const mist = std('#a8d8f8', '#3f9ae8', 0.8, { transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  const specs = [];
  for (let i = 0; i < 5; i++) specs.push({ pos: [(i - 2) * 0.14, 0.42, -0.24], dir: [0, -1, -0.3], yaw: 0, len: 0.9 + (i % 2) * 0.3, w0: 0.22, w1: 0.02 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    specs.push({ pos: [Math.sin(a) * 0.14, -0.55, Math.cos(a) * 0.12 - 0.08], dir: [Math.sin(a) * 0.25, -1, Math.cos(a) * 0.25], yaw: a + Math.PI / 2, len: 1.0 + (i % 3) * 0.3, w0: 0.26, w1: 0.02 });
  }
  const streamers = ribbons(specs, mist, { amp: 0.28, speed: 2.6 });
  g.add(streamers);
  const iceM = std('#c9ecff', '#4fb8ff', 0.6, { roughness: 0.1, flatShading: true });
  const shards = [];
  for (let i = 0; i < 3; i++) { const sh = mesh(new THREE.OctahedronGeometry(0.08, 0), iceM); sh.scale.y = 2; g.add(sh); shards.push(sh); }
  const eyes = byName(flash, /Eye|Core/), eyeI = eyes.map((m) => m.emissiveIntensity);
  return finish(g, new THREE.Group(), flash, (dt, t, w) => {
    streamers.userData.uT.value = t;
    arms.forEach(({ a, side }) => { a.rotation.x = (w.chasing ? -0.8 : -0.1) + Math.sin(t * 1.7 + side) * 0.15; a.rotation.z = side * (0.15 + Math.sin(t * 1.1) * 0.08); });
    shards.forEach((sh, i) => { const a = t * 1.6 + (i / 3) * TAU; sh.position.set(Math.sin(a) * 0.8, 0.1 + Math.sin(t * 2 + i) * 0.2, Math.cos(a) * 0.8); sh.rotation.y = a; });
    body.position.y = Math.sin(t * 1.3) * 0.07;
    eyes.forEach((m, i) => { if (!m.userData.flashing) m.emissiveIntensity = eyeI[i] * 0.5 * (1 + Math.sin(t * 4 + i) * 0.2); });
  }, '#dff6ff', 2.15);
}

function golemCC() {
  const flash = [];
  if (!prop('c_golem_torso') || !prop('c_golem_arm') || !prop('c_golem_leg') || !prop('c_golem_head')) return null;
  const g = new THREE.Group();
  // The upper body hinges at the hips, so a hunch or a slam bends it rather than the whole golem.
  const HIP = 0.9, upper = new THREE.Group(); upper.position.y = HIP; g.add(upper);
  const at = (o, x, y, z) => { const [a, b, c] = J(x, y, z); o.position.set(a, b - HIP, c); upper.add(o); return o; };
  const torso = at(blenderPart('c_golem_torso', flash), 0, 0, 0);
  const plates = at(blenderPart('c_golem_plates', flash), 0, 0, 0);
  const head = at(blenderPart('c_golem_head', flash), 0, -0.3, 2.3);
  const arms = [1, -1].map((side) => { const a = blenderPart('c_golem_arm', flash); if (side < 0) a.scale.x = -1; at(a, side * 0.95, 0, 2.05); return { a, side }; });
  const legs = limbPair('c_golem_leg', [0.42, 0.05, 0.86], flash, g).map(({ a, side }) => ({ l: a, side }));
  const eyes = byName(flash, /Eye/), cores = byName(flash, /Core|Rune/);
  const c = finish(g, new THREE.Group(), flash, (dt, t, w) => {
    const speed = Math.hypot(w.vel.x, w.vel.z), stride = Math.min(1, speed / 2) * 0.5;
    const ph = (w.walkPh = (w.walkPh || 0) + dt * (2 + speed * 1.5));
    legs.forEach(({ l, side }) => { l.rotation.x = Math.sin(ph + (side > 0 ? 0 : Math.PI)) * stride; });
    const slam = w.slam || 0;
    arms.forEach(({ a, side }) => { a.rotation.x = -slam * 2.4 + Math.sin(ph + (side > 0 ? Math.PI : 0)) * stride * 0.8; a.rotation.z = side * (0.08 + slam * 0.2); });
    upper.rotation.x = 0.08 + Math.sin(ph * 2) * 0.03 * Math.min(1, speed) - slam * 0.12;
    upper.position.y = HIP + Math.abs(Math.sin(ph)) * 0.05 * Math.min(1, speed);
    head.rotation.y = Math.sin(t * 0.7) * 0.25;
    const dz = w.dazzled > 0;
    eyes.forEach((m) => { if (!m.userData.flashing) m.emissiveIntensity = dz ? 6 + Math.sin(t * 40) * 3 : 2; });
    cores.forEach((m) => { if (!m.userData.flashing) m.emissiveIntensity = plates.visible ? 1.2 : 3.5 + Math.sin(t * 6) * 1.2; });
  }, '#b89a74', 0);
  c.grounded = true;
  c.setArmour = (on) => { plates.visible = on; };
  c.height = 3.2;
  return c;
}

function bonesCC() {
  const flash = [];
  const src = blenderPart('c_bones_body', flash);
  if (!src || !prop('c_bones_sword') || !prop('c_bones_shield')) return null;
  const g = new THREE.Group(), body = new THREE.Group(); body.add(src); g.add(body);
  const sword = blenderPart('c_bones_sword', flash); sword.position.set(...J(0.26, 0, 1.08)); body.add(sword);
  const shield = blenderPart('c_bones_shield', flash); shield.scale.x = -1; shield.position.set(...J(-0.26, 0, 1.08)); body.add(shield);
  const eyes = byName(flash, /Eye/), eyeI = eyes[0]?.emissiveIntensity || 3;
  const c = finish(g, new THREE.Group(), flash, (dt, t, w) => {
    const speed = Math.min(1, Math.hypot(w.vel.x, w.vel.z)), slam = w.slam || 0;
    body.position.y = Math.abs(Math.sin(t * 7)) * 0.06 * speed;
    body.rotation.z = Math.sin(t * 7) * 0.06 * speed;
    sword.rotation.x = -0.2 - slam * 1.8 + Math.sin(t * 7) * 0.2 * speed;
    shield.rotation.x = -0.25 + slam * 0.3;
    pulse(eyes, eyeI * 0.5, t, 4);
  }, '#e9e0c8', 0);
  c.grounded = true; c.height = 1.9;
  return c;
}

const or = (cc, fallback) => () => cc() || fallback();
const BUILDERS = {
  specter: or(specterCC, specter), imp: or(impCC, imp), wraith: or(wraithCC, wraith), shade: or(shadeCC, shade),
  golem: or(golemCC, golem), bones: or(bonesCC, bones), phylactery, orb, totem, lich, queen, tyrant, unraveller,
};
export function makeCreature(kind = 'shade') { return (BUILDERS[kind] || shade)(); }

// Hit flash: every flash material glows white for a moment, then returns to its own glow.
export function setFlash(c, on) {
  for (const m of c.flash) {
    if (on) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 3; }
    else if (m.userData.flashing) { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseI; }
    m.userData.flashing = on;
  }
}
