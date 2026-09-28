import * as THREE from 'three';
import { clay } from './style.js';
import { mergeStatic } from './merge.js';
import { prop, hasProp } from './assets.js';

// Collapse each rigid part of a character into one mesh per material while keeping every
// animated "bone" (anything referenced from userData) as its own transform.
function batchRig(root) {
  const bones = new Set();
  const add = (v) => { if (Array.isArray(v)) v.forEach(add); else if (v && v.isObject3D) bones.add(v); };
  Object.values(root.userData).forEach(add);
  bones.forEach((b) => { b.userData.dynamic = true; });
  [root, ...bones].forEach((b) => { if (!b.isMesh && !b.isLight) mergeStatic(b); });
  return root;
}

// Chibi-proportioned, clay-style characters: oversized heads, glossy bead eyes, stubby
// limbs and clean colour blocking. Each builder returns a Group whose userData exposes
// named "bones" the controllers animate (body, armL/R, head, eyes, cape, hatSegs, ...).

// ---------- Blender parts (tools/blender/build_characters.py → characters.glb) ----------
// Sculpted, toy-like replacements for the robe, head, eyes, arms and boots. Each part carries
// its own origin (head centre, shoulder, eye centre...), so it drops into the same rig slots.
function part(name, mirror = false) {
  const p = prop(name);
  if (p && mirror) p.scale.x = -1;
  return p;
}
// Blinkable eyes for a sculpted head: `at` is the right eye's offset from the head centre.
// `mirror`: the eye is modelled for one side (lash flick outward) and mirrored for the other.
function ccEyes(head, name, at, mirror = false) {
  return [-1, 1].map((side) => {
    const e = new THREE.Group(); e.position.set(side * at[0], at[1], at[2]);
    e.add(part(name, mirror && side < 0)); head.add(e);
    return e;
  });
}
function ccArm(name, side, len) {
  const arm = new THREE.Group();
  arm.add(part(name, side < 0));
  const hand = new THREE.Group(); hand.position.y = -len; arm.add(hand);
  return { arm, hand };
}

// ---------- Clean cloth texture: solid colour, a gold hem band and a front placket ----------
const texCache = {};
function robeTexture(key, { base, trim, hem = 0.14, placket = true, motif = null }) {
  if (texCache[key]) return texCache[key];
  const W = 512, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  // A few large, well-spaced motifs rather than noisy scatter.
  if (motif) {
    g.fillStyle = motif;
    for (let i = 0; i < 6; i++) star(g, (i + 0.5) * (W / 6), H * (0.32 + (i % 2) * 0.22), 13, 4);
  }
  const hy = H * (1 - hem);
  g.fillStyle = shade(base, -0.12); g.fillRect(0, hy, W, H - hy);
  g.fillStyle = trim; g.fillRect(0, hy, W, 12); g.fillRect(0, H - 14, W, 8);
  if (placket) { g.fillStyle = trim; g.fillRect(0, 0, 16, H); g.fillRect(W - 16, 0, 16, H); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  texCache[key] = t;
  return t;
}
function shade(hex, amt) { return '#' + new THREE.Color(hex).offsetHSL(0, 0, amt).getHexString(); }
function star(g, x, y, r, n) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.42 : r;
    i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}

const lathe = (profile, segs, mat) => new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs), mat);
function shadows(root) { root.traverse((o) => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; } }); return root; }

// ---------- Chibi face: glossy bead eyes, tiny nose, smile, blush ----------
function buildFace(head, r, { brow = '#4a2a14', browTilt = 0.1, glasses = false, old = false } = {}) {
  const eyeMat = clay('#1c1626', { roughness: 0.15, rim: 0.1, key: 'eyeBead' });
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const eyes = [];
  const ex = r * 0.36, ey = r * 0.02, ez = r * 0.89;
  [-1, 1].forEach((side) => {
    const eye = new THREE.Group();
    eye.position.set(side * ex, ey, ez);
    eye.rotation.y = side * 0.35;
    const bead = new THREE.Mesh(new THREE.SphereGeometry(r * 0.17, 18, 14), eyeMat);
    bead.scale.set(0.85, old ? 0.75 : 1.2, 0.45);
    const g1 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.055, 8, 6), glint);
    g1.position.set(-r * 0.05, r * 0.07, r * 0.06);
    const g2 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.025, 6, 4), glint);
    g2.position.set(r * 0.05, -r * 0.06, r * 0.06);
    eye.add(bead, g1, g2);
    head.add(eye); eyes.push(eye);
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(r * (old ? 0.06 : 0.035), r * 0.2, 4, 8), clay(brow, { key: 'brow' + brow }));
    b.rotation.z = Math.PI / 2 + side * browTilt;
    b.position.set(side * ex, ey + r * (old ? 0.3 : 0.32), ez * 0.97);
    b.rotation.y = side * 0.35;
    head.add(b);
    const blush = new THREE.Mesh(new THREE.CircleGeometry(r * 0.12, 16), new THREE.MeshBasicMaterial({ color: '#ff7f8a', transparent: true, opacity: 0.35, depthWrite: false }));
    blush.userData.noShadow = true;
    blush.position.set(side * r * 0.56, -r * 0.2, r * 0.8); blush.rotation.y = side * 0.62;
    head.add(blush);
    if (glasses) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.24, r * 0.03, 8, 24), clay('#2b2330', { roughness: 0.3, key: 'glassRim' }));
      rim.position.set(side * ex, ey, ez + r * 0.1); rim.rotation.y = side * 0.3;
      head.add(rim);
    }
  });
  if (glasses) {
    const bridge = new THREE.Mesh(new THREE.TorusGeometry(r * 0.08, r * 0.025, 6, 10, Math.PI), clay('#2b2330', { roughness: 0.3, key: 'glassRim' }));
    bridge.position.set(0, ey + r * 0.04, ez + r * 0.14); head.add(bridge);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(r * (old ? 0.14 : 0.08), 12, 10), clay(old ? '#e7ae88' : '#f3b98f', { key: 'nose' + old }));
  nose.position.set(0, -r * 0.1, r * 0.99);
  head.add(nose);
  if (!old) {
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(r * 0.1, r * 0.022, 6, 14, Math.PI), new THREE.MeshBasicMaterial({ color: '#7a2f2f' }));
    mouth.rotation.z = Math.PI; mouth.position.set(0, -r * 0.27, r * 0.95);
    head.add(mouth);
  }
  return eyes;
}

// ---------- Pointed hat built from base-pivoted segments so the tip droops ----------
function buildHat({ color, bandColor, brimR, baseR, segs, segH, bend }) {
  const mat = clay(color, { roughness: 0.55, rim: 0.3, key: 'hat' + color });
  const hat = new THREE.Group();
  const brim = lathe([[0.001, 0], [brimR, 0.0], [brimR * 1.02, 0.05], [brimR * 0.9, 0.09], [baseR, 0.1], [0.001, 0.1]], 40, mat);
  hat.add(brim);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(baseR * 1.02, baseR * 1.06, 0.13, 32), clay(bandColor, { key: 'band' + bandColor }));
  band.position.y = 0.16; hat.add(band);
  const buckle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 4), clay('#ffd35a', { roughness: 0.3, key: 'buckle' }));
  buckle.rotation.z = Math.PI / 4; buckle.position.set(0, 0.16, baseR * 1.06); hat.add(buckle);
  let parent = hat, r = baseR;
  const list = [];
  for (let i = 0; i < segs; i++) {
    const geo = new THREE.CylinderGeometry(r * 0.78, r, segH, 28);
    geo.translate(0, segH / 2, 0);
    const s = new THREE.Mesh(geo, mat);
    s.position.y = i === 0 ? 0.08 : segH * 0.97;
    if (i > 0) s.rotation.x = -bend;
    parent.add(s); list.push(s);
    parent = s; r *= 0.78;
  }
  const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 1.3, 12, 10), clay('#ffe27a', { emissive: '#ffb830', emissiveIntensity: 1.4, key: 'hatTip' }));
  tip.position.y = segH; parent.add(tip);
  return { hat: shadows(hat), segs: list };
}

// Stubby sleeve + mitten hand. Pivot sits at the shoulder.
function buildArm(side, sleeveMat, cuffMat, skinMat, len = 0.42) {
  const arm = new THREE.Group();
  const sleeve = lathe([[0.001, 0], [0.1, -0.02], [0.12, -len * 0.5], [0.15, -len * 0.85], [0.001, -len * 0.86]], 16, sleeveMat);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.03, 8, 20), cuffMat);
  cuff.rotation.x = Math.PI / 2; cuff.position.y = -len * 0.8;
  const hand = new THREE.Group(); hand.position.y = -len;
  const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), skinMat); mitt.scale.set(1, 1.05, 0.9);
  const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skinMat); thumb.position.set(side * -0.07, 0.03, 0.05);
  hand.add(mitt, thumb);
  arm.add(sleeve, cuff, hand);
  return { arm: shadows(arm), hand };
}

function buildCape(mat, width, len, n = 4) {
  const root = new THREE.Group();
  const segs = [];
  let parent = root, w = width;
  for (let i = 0; i < n; i++) {
    const h = len / n;
    const g = new THREE.PlaneGeometry(w, h, 6, 1);
    g.translate(0, -h / 2, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, Math.pow(p.getX(k) / (w / 2), 2) * 0.12);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    const pivot = new THREE.Group();
    pivot.position.y = i === 0 ? 0 : -h;
    pivot.add(m); parent.add(pivot); segs.push(pivot);
    parent = pivot; w *= 1.15;
  }
  return { root: shadows(root), segs };
}

// ================================================================
// The Apprentice (chibi)
// ================================================================
// ================================================================
// The Apprentice — the lavender wizard (tools/blender/build_characters.py: c_wiz_*)
// ================================================================
// Patterned trims: the Blender strips carry UVs (u along the band); these canvases tile along them.
function trimTexture() {
  if (texCache.wizTrim) return texCache.wizTrim;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#efe9f4'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#b3a8d2'; g.fillRect(0, 10, 128, 6); g.fillRect(0, 112, 128, 6);
  g.strokeStyle = '#8f84bd'; g.lineWidth = 8; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-8, 86); g.lineTo(24, 42); g.lineTo(56, 86); g.lineTo(88, 42); g.lineTo(120, 86); g.lineTo(152, 42); g.stroke();
  g.fillStyle = '#9d91c6'; [[24, 88], [88, 88], [56, 40], [120, 40]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  return (texCache.wizTrim = t);
}
function bandTexture() {
  if (texCache.wizBand) return texCache.wizBand;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#cfa478'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#9c6a40'; g.fillRect(0, 8, 256, 6); g.fillRect(0, 114, 256, 6);
  g.strokeStyle = '#8a5a34'; g.lineWidth = 7; g.lineCap = 'round';
  // A running scroll: two spirals joined by an S-curve per tile.
  const spiral = (cx, cy, dir) => { g.beginPath(); for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 3.2, r = 30 - i * 0.62; const x = cx + Math.cos(a * dir) * r, y = cy + Math.sin(a * dir) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); };
  spiral(64, 64, 1); spiral(192, 64, -1);
  g.beginPath(); g.moveTo(94, 64); g.bezierCurveTo(128, 20, 128, 108, 162, 64); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  return (texCache.wizBand = t);
}
function paintWizard(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.userData.wizPainted) return;
    if (m.name === 'WizTrim') { m.map = trimTexture(); m.color.set('#ffffff'); }
    else if (m.name === 'WizBand') { m.map = bandTexture(); m.color.set('#ffffff'); }
    else return;
    m.userData.wizPainted = true; m.needsUpdate = true;
  });
}

function buildWizard() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // Boots step in time with the walk (the game moves each boot group).
  const boots = [-1, 1].map((side) => { const b = new THREE.Group(); b.add(part('c_wiz_boot', side < 0)); body.add(shadows(b)); return b; });
  // The coat, tunic, belt, pouch and medallion are one piece; the game tilts it with speed.
  const robe = part('c_wiz_body'); body.add(robe);
  const potion = new THREE.Group(); body.add(potion); // (the old potion slot; the pouch is part of the coat)
  // Head with blinkable anime eyes.
  const head = new THREE.Group(); head.position.y = 1.62;
  head.add(part('c_wiz_head'));
  const eyes = ccEyes(head, 'c_wiz_eye', [0.15, -0.08, 0.308]);
  body.add(shadows(head));
  // Hat: brim and crown, plus the hooked tip on its own pivot so it can sway.
  const hat = new THREE.Group(); hat.position.set(0, 1.872, -0.018); hat.add(part('c_wiz_hat'));
  const tip = new THREE.Group(); tip.position.set(0, 0.504, -0.045); tip.add(part('c_wiz_hat_tip')); hat.add(tip);
  body.add(shadows(hat));
  // Bell-sleeved arms; the right hand holds the staff.
  const L = ccArm('c_wiz_arm', -1, 0.52), Rt = ccArm('c_wiz_arm', 1, 0.52);
  shadows(L.arm); shadows(Rt.arm);
  L.arm.position.set(-0.27, 1.19, 0); L.arm.rotation.z = -0.36;
  Rt.arm.position.set(0.27, 1.19, 0); Rt.arm.rotation.z = 0.36;
  body.add(L.arm, Rt.arm);
  // Gnarled staff whose crescent top cradles a glowing lavender orb.
  const staff = new THREE.Group();
  staff.add(shadows(part('c_wiz_staff')));
  const ORB = [-0.015, 1.19, -0.017];
  const orbMat = new THREE.MeshStandardMaterial({ color: '#f1e8ff', emissive: '#b48cff', emissiveIntensity: 3, roughness: 0.1 });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 18), orbMat); orb.position.set(...ORB); staff.add(orb);
  const orbRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.006, 4, 40), new THREE.MeshBasicMaterial({ color: '#e4d6ff', transparent: true, opacity: 0.35 }));
  orbRing.position.set(...ORB); staff.add(orbRing);
  const light = new THREE.PointLight('#c9a8ff', 4, 9, 2); light.position.set(...ORB); staff.add(light);
  Rt.hand.add(staff);
  staff.position.set(0, 0.02, 0.03);
  staff.rotation.z = -0.6; // leans a little outward, so the orb stands clear of the hat brim
  paintWizard(root);
  root.userData = { body, armL: L.arm, armR: Rt.arm, staff, orb, orbMat, orbRing, light, hatSegs: [hat, tip], robe, cape: [], eyes, boots, head, potion };
  return batchRig(root);
}

export function buildApprentice() {
  if (hasProp('c_wiz_body') && hasProp('c_wiz_staff')) return buildWizard();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const cc = hasProp('c_app_body'); // the sculpted model, once characters.glb has loaded
  const BLUE = '#3f5fd8', GOLD = '#ffcf5a';
  const robeMat = clay('#ffffff', { map: robeTexture('app', { base: BLUE, trim: GOLD, motif: '#9fb4ff' }), roughness: 0.6, side: THREE.DoubleSide, key: 'appRobe' });
  const sleeveMat = clay(BLUE, { roughness: 0.6, key: 'appSleeve' });
  const goldMat = clay(GOLD, { roughness: 0.35, key: 'gold' });
  const skinMat = clay('#ffd2ac', { roughness: 0.5, rim: 0.2, key: 'skin' });
  const hairMat = clay('#6b3a1e', { roughness: 0.45, rim: 0.25, key: 'hair' });
  const bootMat = clay('#6a3d20', { roughness: 0.45, key: 'boot' });
  const leather = clay('#8a5429', { roughness: 0.55, key: 'leather' });

  // Chunky boots.
  const boots = [-1, 1].map((side) => {
    const boot = new THREE.Group();
    if (cc) boot.add(part('c_app_boot', side < 0));
    else {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.14, 6, 12), bootMat);
      b.rotation.x = Math.PI / 2; b.position.set(side * 0.15, 0.09, 0.08);
      boot.add(b);
    }
    body.add(shadows(boot));
    return boot;
  });

  let robe;
  if (cc) { robe = part('c_app_body'); body.add(robe); }
  else {
    // Short bell-shaped robe.
    const prof = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      prof.push([0.5 - t * 0.24 + Math.sin(t * Math.PI) * 0.035, 0.08 + t * 0.86]);
    }
    prof.push([0.001, 0.94]);
    robe = lathe(prof, 40, robeMat);
    body.add(robe);
    const hemRoll = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 10, 40), goldMat);
    hemRoll.rotation.x = Math.PI / 2; hemRoll.position.y = 0.09; body.add(hemRoll);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 10, 32), leather);
    belt.rotation.x = Math.PI / 2; belt.position.y = 0.62; body.add(belt);
    const buckle = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.05, 4, 8), goldMat);
    buckle.rotation.z = Math.PI / 2; buckle.position.set(0, 0.62, 0.32); body.add(buckle);
    // Rounded collar/mantle with a gem clasp.
    const mantle = lathe([[0.4, 0], [0.38, 0.06], [0.3, 0.14], [0.18, 0.2], [0.001, 0.21]], 32, clay('#2f47b8', { roughness: 0.55, key: 'appMantle' }));
    mantle.position.y = 0.86; body.add(mantle);
    const clasp = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), clay('#9fe8ff', { emissive: '#4fc8ff', emissiveIntensity: 1.3, roughness: 0.2, key: 'clasp' }));
    clasp.position.set(0, 0.96, 0.3); body.add(clasp);
  }
  const potion = new THREE.Group();
  const bottle = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 12), clay('#7dff9b', { emissive: '#35d86a', emissiveIntensity: 1.1, roughness: 0.15, key: 'potion' }));
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.06, 8), leather); cork.position.y = 0.09;
  potion.add(bottle, cork); potion.position.set(cc ? 0.33 : 0.27, 0.5, cc ? 0.22 : 0.17);
  body.add(potion);
  const cape = buildCape(clay('#d9425f', { roughness: 0.6, side: THREE.DoubleSide, key: 'appCape' }), 0.5, 0.78, 4);
  cape.root.position.set(0, 0.98, -0.26); cape.root.rotation.x = 0.35;
  body.add(cape.root);

  // Big round head.
  const R = 0.42;
  const head = new THREE.Group(); head.position.y = 1.38;
  let eyes;
  if (cc) { head.add(part('c_app_head')); eyes = ccEyes(head, 'c_app_eye', [0.14, 0.03, 0.345]); }
  else {
    const skull = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), skinMat);
    skull.scale.set(1, 0.95, 0.95); head.add(skull);
    [-1, 1].forEach((side) => {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(R * 0.2, 12, 10), skinMat);
      ear.scale.set(0.5, 1, 0.8); ear.position.set(side * R * 0.95, -R * 0.05, 0); head.add(ear);
    });
    eyes = buildFace(head, R);
    // Hair: smooth cap with rounded bang locks (clean silhouette, no spikes).
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.56), hairMat);
    hairCap.rotation.x = -0.45; hairCap.position.set(0, R * 0.02, -R * 0.06); head.add(hairCap);
    [[-0.5, 0.2], [-0.15, 0.3], [0.2, 0.26], [0.52, 0.12]].forEach(([x, rot]) => {
      const lock = new THREE.Mesh(new THREE.SphereGeometry(R * 0.28, 16, 12), hairMat);
      lock.scale.set(1, 0.7, 0.55); lock.position.set(x * R, R * 0.55, R * 0.72); lock.rotation.z = rot * Math.sign(x || 1);
      head.add(lock);
    });
    [-1, 1].forEach((side) => {
      const lock = new THREE.Mesh(new THREE.SphereGeometry(R * 0.3, 14, 10), hairMat);
      lock.scale.set(0.6, 1.1, 0.9); lock.position.set(side * R * 0.9, R * 0.1, -R * 0.15); head.add(lock);
    });
  }
  body.add(shadows(head));

  const hatParts = buildHat({ color: '#2f3fa8', bandColor: '#d9425f', brimR: 0.72, baseR: 0.4, segs: 5, segH: 0.26, bend: 0.28 });
  hatParts.hat.position.y = cc ? 1.73 : 1.7; hatParts.hat.rotation.z = -0.08;
  body.add(hatParts.hat);

  const L = cc ? ccArm('c_app_arm', -1, 0.42) : buildArm(-1, sleeveMat, goldMat, skinMat), Rt = cc ? ccArm('c_app_arm', 1, 0.42) : buildArm(1, sleeveMat, goldMat, skinMat);
  shadows(L.arm); shadows(Rt.arm);
  L.arm.position.set(-0.3, 0.9, 0); L.arm.rotation.z = -0.45;
  Rt.arm.position.set(0.3, 0.9, 0); Rt.arm.rotation.z = 0.45;
  body.add(L.arm, Rt.arm);

  // Chunky staff with a big glowing orb.
  const staff = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 1.5, 4, 10), clay('#9a5d2e', { roughness: 0.5, key: 'staffWood' }));
  staff.add(shaft);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.2, 12), leather); grip.position.y = 0.05; staff.add(grip);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.03, 8, 16), goldMat); collar.rotation.x = Math.PI / 2; collar.position.y = 0.8; staff.add(collar);
  [0, 1, 2].forEach((i) => {
    const prong = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 8, 16, Math.PI * 0.85), goldMat);
    prong.position.y = 0.95; prong.rotation.set(0, (i / 3) * Math.PI * 2, Math.PI / 2);
    staff.add(prong);
  });
  const orbMat = new THREE.MeshStandardMaterial({ color: '#c8f6ff', emissive: '#58d0ff', emissiveIntensity: 3, roughness: 0.1 });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 18), orbMat);
  orb.position.y = 0.98; staff.add(orb);
  const orbRing = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.008, 4, 40), new THREE.MeshBasicMaterial({ color: '#9fe8ff', transparent: true, opacity: 0.7 }));
  orbRing.position.y = 0.98; staff.add(orbRing);
  shadows(staff);
  Rt.hand.add(staff);
  staff.position.set(0, 0.05, 0.03);
  staff.rotation.z = -0.45; // stand upright despite the arm's outward tilt
  const light = new THREE.PointLight('#7fdcff', 4, 9, 2);
  light.position.y = 0.98; staff.add(light);

  root.userData = {
    body, armL: L.arm, armR: Rt.arm, staff, orb, orbMat, orbRing, light,
    hatSegs: hatParts.segs, robe, cape: cape.segs, eyes, boots, head, potion,
  };
  return batchRig(root);
}

// ================================================================
// Master Aldric (chibi)
// ================================================================
export function buildMentor() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const PURPLE = '#7a3fc0', GOLD = '#ffcf5a';
  const robeMat = clay('#ffffff', { map: robeTexture('men', { base: PURPLE, trim: GOLD, motif: '#d9c2ff', hem: 0.16 }), roughness: 0.6, side: THREE.DoubleSide, key: 'menRobe' });
  const sleeveMat = clay(PURPLE, { roughness: 0.6, key: 'menSleeve' });
  const goldMat = clay(GOLD, { roughness: 0.35, key: 'gold' });
  const skinMat = clay('#f6c7a0', { roughness: 0.5, rim: 0.2, key: 'oldSkin' });
  const beardMat = clay('#fbfbff', { roughness: 0.55, rim: 0.35, key: 'beard' });
  const cc = hasProp('c_ald_body');

  if (cc) body.add(part('c_ald_body'));
  const prof = [];
  for (let i = 0; i <= 14 && !cc; i++) {
    const t = i / 14;
    prof.push([0.62 - t * 0.3 + Math.sin(t * Math.PI) * 0.04, t * 1.05]);
  }
  prof.push([0.001, 1.05]);
  if (!cc) {
  const robe = lathe(prof, 40, robeMat);
  body.add(robe);
  const hemRoll = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 10, 40), goldMat);
  hemRoll.rotation.x = Math.PI / 2; hemRoll.position.y = 0.03; body.add(hemRoll);
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.045, 10, 32), clay('#e0b877', { key: 'rope' }));
  rope.rotation.x = Math.PI / 2; rope.position.y = 0.66; body.add(rope);
  const book = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.1), clay('#b4452f', { key: 'bookCover' }));
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.34, 0.08), clay('#fff4d6', { key: 'pages' }));
  pages.position.x = 0.02;
  const sigil = new THREE.Mesh(new THREE.CircleGeometry(0.065, 16), clay('#ffd35a', { emissive: '#ffb030', emissiveIntensity: 0.8, key: 'bookSigil' }));
  sigil.position.z = 0.051;
  book.add(cover, pages, sigil);
  book.position.set(-0.4, 0.5, 0.2); book.rotation.set(0.1, -0.9, 0.08);
  body.add(book);
  const mantle = lathe([[0.48, 0], [0.45, 0.07], [0.35, 0.16], [0.2, 0.22], [0.001, 0.23]], 32, clay('#5b2c96', { roughness: 0.55, key: 'menMantle' }));
  mantle.position.y = 0.98; body.add(mantle);
  }

  const R = 0.44;
  const head = new THREE.Group(); head.position.y = 1.52;
  let eyes;
  const beardSegs = [];
  if (cc) { head.add(part('c_ald_head')); eyes = ccEyes(head, 'c_ald_eye', [0.15, 0.03, 0.37]); }
  else {
  const skull = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), skinMat); skull.scale.set(1, 0.95, 0.95); head.add(skull);
  eyes = buildFace(head, R, { brow: '#ffffff', browTilt: -0.25, glasses: true, old: true });
  // Big fluffy beard: overlapping soft spheres forming a rounded wedge.
  const beard = new THREE.Group();
  beard.position.set(0, -R * 0.35, R * 0.5);
  let parent = beard;
  [[0.36, 0], [0.32, -0.2], [0.25, -0.2], [0.16, -0.17]].forEach(([r, dy], i) => {
    const seg = new THREE.Group(); seg.position.set(0, dy, i ? 0.03 : 0);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), beardMat); puff.scale.set(1.05, 0.75, 0.7);
    seg.add(puff);
    [-1, 1].forEach((side) => {
      const p2 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 14, 10), beardMat);
      p2.position.set(side * r * 0.6, -r * 0.15, 0.02); seg.add(p2);
    });
    parent.add(seg); beardSegs.push(seg); parent = seg;
  });
  head.add(beard);
  [-1, 1].forEach((side) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(R * 0.18, 14, 10), beardMat);
    m.scale.set(1.5, 0.6, 0.7); m.position.set(side * R * 0.2, -R * 0.26, R * 0.9); m.rotation.z = side * -0.3;
    head.add(m);
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(R * 0.28, 14, 10), beardMat);
    tuft.scale.set(0.6, 1, 0.9); tuft.position.set(side * R * 0.9, 0, -R * 0.1); head.add(tuft);
  });
  }
  body.add(shadows(head));

  const hatParts = buildHat({ color: '#5b2c96', bandColor: GOLD, brimR: 0.8, baseR: 0.42, segs: 6, segH: 0.28, bend: 0.22 });
  hatParts.hat.position.y = 1.86; hatParts.hat.rotation.z = 0.1;
  body.add(hatParts.hat);

  const L = cc ? ccArm('c_ald_arm', -1, 0.44) : buildArm(-1, sleeveMat, goldMat, skinMat, 0.44), Rt = cc ? ccArm('c_ald_arm', 1, 0.44) : buildArm(1, sleeveMat, goldMat, skinMat, 0.44);
  shadows(L.arm); shadows(Rt.arm);
  L.arm.position.set(-0.36, 0.98, 0.02); L.arm.rotation.set(-0.3, 0, -0.4);
  Rt.arm.position.set(0.36, 0.98, 0.02); Rt.arm.rotation.set(-0.5, 0, 0.5);
  body.add(L.arm, Rt.arm);

  // Gnarled staff: chunky knobbly shaft with a caged gem.
  const staff = new THREE.Group();
  const wood = clay('#7a4a26', { roughness: 0.55, key: 'oldWood' });
  const shaft = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 2.1, 4, 10), wood); shaft.position.y = 1.1; staff.add(shaft);
  [0.5, 1.1, 1.7].forEach((y) => { const k = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), wood); k.position.y = y; staff.add(k); });
  [0, 1, 2, 3].forEach((i) => {
    const root = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 12, Math.PI * 0.8), wood);
    root.position.y = 2.28; root.rotation.set(0, (i / 4) * Math.PI * 2, Math.PI / 2 + 0.3);
    staff.add(root);
  });
  const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshStandardMaterial({ color: '#ffc4ff', emissive: '#ff5cf0', emissiveIntensity: 2.6, roughness: 0.1, flatShading: true }));
  gem.position.y = 2.36; staff.add(gem);
  const gemLight = new THREE.PointLight('#ff7cf5', 3, 7, 2); gemLight.position.y = 2.36; staff.add(gemLight);
  staff.position.set(0.66, 0, 0.3);
  g.add(shadows(staff));

  g.userData = { gem, gemBaseY: gem.position.y, body, beard: beardSegs, eyes, hatSegs: hatParts.segs, armL: L.arm, head };
  return batchRig(g);
}
