import * as THREE from 'three';
import { PLATEAU_H, heightAt } from './world.js';
import { ALTAR_POS, TOWER_FLOORS, SCHOOLS, SANCTUMS } from './data.js';
import { runeCircleTexture } from './textures.js';
import { mergeStatic } from './merge.js';
import { LightBank, lightsIn } from './lightbank.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clay, addRim, stoneBlockTexture, shingleTexture, plankTexture, PALETTE } from './style.js';

// Old grey tints map onto a family of warm creams so each floor still reads distinctly.
const CREAMS = {
  '#8f8a82': '#dccbac', '#7d7870': '#cdb993', '#9a948a': '#efe4cf', '#8a8fa0': '#e6e2da', '#7e8392': '#d9d3c6',
  '#6c7080': '#cfc6b4', '#8e9a86': '#e4e6cf', '#6f7b68': '#cfd3b4', '#9b92a6': '#ece2e4', '#a8a0b4': '#efe4cf',
};
function stoneMat(tint, repeatU, repeatV) {
  const map = stoneBlockTexture(CREAMS[tint] || PALETTE.stone).clone();
  map.needsUpdate = true;
  map.repeat.set(repeatU, Math.max(repeatV, 0.35));
  return addRim(new THREE.MeshStandardMaterial({ map, roughness: 0.7, color: '#ffffff' }), 0.22);
}
function shingleMat(color, dark, ru, rv) {
  const map = shingleTexture(color, dark).clone();
  map.needsUpdate = true; map.repeat.set(ru, rv);
  return addRim(new THREE.MeshStandardMaterial({ map, roughness: 0.55 }), 0.3);
}
// Soft-edged box: every block in the tower gets a bevel so nothing reads as a sharp primitive.
const rbox = (w, h, d) => new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.3);
// Small, repeated ornaments (corbels, stair stones) get a one-step bevel: ~100 triangles, not ~600.
const lbox = (w, h, d) => new RoundedBoxGeometry(w, h, d, 1, Math.min(w, h, d) * 0.22);
const glowMat = (c, i = 2.2) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i });
const trim = clay(PALETTE.wood, { roughness: 0.6, key: 'towerTrim' });
const dark = clay('#8a4f28', { roughness: 0.7, key: 'towerDoor' });
let plankMat;

function shadowAll(g) {
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function ringOf(n, r, y, make) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const m = make(i, a);
    m.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
    m.rotation.y = a;
    g.add(m);
  }
  return g;
}

function crenellations(r, y, color) {
  const mat = stoneMat(color, 1, 0.3);
  return ringOf(16, r - 0.2, y, () => new THREE.Mesh(lbox(0.9, 0.7, 0.5), mat));
}

function windows(n, r, y, color, w = 0.7, h = 1.3, skip = -1) {
  const glass = glowMat(color, 2.4);
  return ringOf(n, r + 0.02, y, (i) => {
    const g = new THREE.Group();
    if (i === skip) return g;
    const pane = new THREE.Mesh(lbox(w, h, 0.15), glass);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.15, 12, 1, false, 0, Math.PI), glass);
    arch.rotation.x = Math.PI / 2; arch.rotation.z = Math.PI / 2; arch.position.y = h / 2;
    const sill = new THREE.Mesh(lbox(w + 0.3, 0.12, 0.35), trim);
    sill.position.y = -h / 2 - 0.05;
    g.add(pane, arch, sill);
    return g;
  });
}

// Shared materials for the flourishes, so the merge folds every floor's ornaments into a few draws.
const MATS = {};
const shared = (k, make) => (MATS[k] ||= make());
const brassMat = () => clay('#f2c35c', { metalness: 0.5, roughness: 0.35, key: 'brass' });
const slateMat = () => shared('slate', () => shingleMat('#7b62d6', '#5343a8', 6, 3));

// A witch-hat roof: a lathe whose radius falls off as (1-t)^p, so it curves in like a wizard's hat,
// with a soffit under an overhanging eave and an optional lean at the tip.
function flaredRoof(r, h, mat, { eave = 0.3, p = 1.6, lean = 0, seg = 24 } = {}) {
  const R = r + eave, pts = [new THREE.Vector2(r * 0.86, 0.32), new THREE.Vector2(R, 0)];
  for (let i = 1; i <= 14; i++) {
    const t = i / 14;
    pts.push(new THREE.Vector2(Math.max(0.001, R * Math.pow(1 - t, p)), h * t));
  }
  const geo = new THREE.LatheGeometry(pts, seg);
  if (lean) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + lean * Math.pow(Math.max(0, pos.getY(i)) / h, 3));
    geo.computeVertexNormals();
  }
  return new THREE.Mesh(geo, mat);
}

// Stepped stone brackets under an overhang, so each floor visibly rests on the one below.
function corbels(n, r, y, mat, depth = 0.6) {
  return ringOf(n, r, y, () => {
    const g = new THREE.Group();
    const a = new THREE.Mesh(lbox(0.42, 0.3, depth), mat);
    const b = new THREE.Mesh(lbox(0.34, 0.28, depth * 0.62), mat); b.position.set(0, -0.28, -depth * 0.19);
    const c = new THREE.Mesh(lbox(0.26, 0.24, depth * 0.3), mat); c.position.set(0, -0.52, -depth * 0.35);
    g.add(a, b, c);
    return g;
  });
}

// A bartizan: a little corbelled turret clinging to the wall, with its own hat and a lit window.
// Its local +z faces out from the tower.
function turret({ r = 1, h = 3, roof = 3, wall, roofMat, glass, lean = 0.25, foot = 1.3 }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 18), wall); body.position.y = h / 2;
  const base = new THREE.Mesh(new THREE.ConeGeometry(r, foot, 18), wall); base.rotation.x = Math.PI; base.position.y = -foot / 2;
  const band = new THREE.Mesh(new THREE.TorusGeometry(r + 0.04, 0.08, 6, 24), trim); band.rotation.x = Math.PI / 2;
  const top = band.clone(); top.position.y = h;
  const pane = new THREE.Mesh(rbox(0.34, 0.62, 0.12), glass); pane.position.set(0, h * 0.55, r - 0.02);
  const hat = flaredRoof(r + 0.02, roof, roofMat, { eave: 0.22, p: 1.5, lean, seg: 18 }); hat.position.y = h;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), brassMat()); knob.position.set(lean, h + roof + 0.05, 0);
  g.add(body, base, band, top, pane, hat, knob);
  return g;
}

// A swallow-tailed banner hanging from a short rod, faintly curled, with a glowing star.
function banner(color, w = 1, h = 2.4, star = '#ffd36b') {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, -h); s.lineTo(0, -h + 0.45); s.lineTo(-w / 2, -h); s.closePath();
  const geo = new THREE.ShapeGeometry(s, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) / w * Math.PI) * 0.06 + Math.pow(-pos.getY(i) / h, 2) * 0.18);
  geo.computeVertexNormals();
  const cloth = new THREE.Mesh(geo, clay(color, { roughness: 0.8, side: THREE.DoubleSide }));
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, w + 0.3, 6), brassMat()); rod.rotation.z = Math.PI / 2;
  const sigil = new THREE.Mesh(new THREE.CircleGeometry(w * 0.2, 4), glowMat(star, 1.6)); sigil.position.set(0, -h * 0.42, 0.12); sigil.rotation.z = Math.PI / 4;
  g.add(cloth, rod, sigil);
  return g;
}

// ---- Floor builders. Each returns a group whose origin is the floor's base, plus its height. ----
const BUILDERS = {
  foundation() {
    const g = new THREE.Group();
    const m1 = stoneMat('#8f8a82', 8, 0.5), m2 = stoneMat('#7d7870', 7, 0.6);
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 8.0, 1.4, 32), m1); b1.position.y = 0.7;
    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 7.0, 1.4, 32), m2); b2.position.y = 2.0;
    g.add(b1, b2);
    // Steps leading toward the altar.
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(rbox(3, 0.55, 1.1), m1);
      s.position.set(0, 0.28 + i * 0.55, 8.4 - i * 0.55 - 0.5);
      g.add(s);
    }
    // Rune inlay on top.
    const runes = new THREE.Mesh(new THREE.CircleGeometry(6.5, 48), new THREE.MeshBasicMaterial({
      map: runeCircleTexture('#8fd8ff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    runes.rotation.x = -Math.PI / 2; runes.position.y = 2.72;
    g.add(runes);
    // Braziers around the base.
    const fire = glowMat('#ff9a3c', 4);
    g.add(ringOf(6, 7.2, 1.4, () => {
      const b = new THREE.Group();
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.2, 0.3, 10), trim);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 8), fire); flame.position.y = 0.4;
      flame.userData.flicker = true; flame.userData.dynamic = true;
      b.add(bowl, flame);
      return b;
    }));
    // A ley-line band of light circling the plinth, and corbels where the upper tier overhangs.
    const ley = new THREE.Mesh(new THREE.TorusGeometry(7.02, 0.06, 6, 64), glowMat('#8fd8ff', 1.8)); ley.rotation.x = Math.PI / 2; ley.position.y = 2.05;
    g.add(ley);
    // Four standing stones on the plinth, one per realm. Each crystal wakes as you begin that
    // realm's sanctum and blazes once its guardian falls (see Tower.refreshStandards).
    const menhir = stoneMat('#7d7870', 1, 0.6);
    g.userData.standards = SCHOOLS.map((sc, i) => {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const m = new THREE.Group();
      const stone = new THREE.Mesh(rbox(0.62, 2.4, 0.5), menhir); stone.position.y = 1.2; stone.rotation.y = 0.2;
      const cap = new THREE.Mesh(rbox(0.85, 0.2, 0.7), menhir); cap.position.y = 2.45;
      const mat = new THREE.MeshStandardMaterial({ color: '#6b6670', emissive: sc.color, emissiveIntensity: 0, roughness: 0.25, flatShading: true });
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), mat); gem.scale.y = 1.7; gem.position.y = 3.35;
      gem.userData.dynamic = true; Object.assign(gem.userData, { bob: 3.35, bobAmp: 0.14, phase: i * 1.7 });
      m.add(stone, cap, gem);
      m.position.set(Math.sin(a) * 7.25, 1.4, Math.cos(a) * 7.25); m.rotation.y = a;
      g.add(m);
      return { id: sc.id, color: sc.color, gem, mat, lvl: -1 };
    });
    g.userData.spinners = g.userData.standards.map((st) => st.gem);
    g.userData.runes = runes;
    return { group: shadowAll(g), height: 2.7 };
  },

  study() {
    const g = new THREE.Group();
    const h = 6;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.6, h, 32, 1, true), stoneMat('#9a948a', 6, 1.2));
    wall.position.y = h / 2; wall.material.side = THREE.DoubleSide;
    g.add(wall);
    const door = new THREE.Mesh(rbox(1.6, 2.6, 0.4), dark); door.position.set(0, 1.3, 5.45);
    const doorArch = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.14, 8, 16, Math.PI), trim); doorArch.position.set(0, 2.6, 5.55);
    g.add(door, doorArch);
    g.add(windows(6, 5.4, 3.6, '#ffc873', 0.7, 1.3, 0));
    plankMat ||= clay('#ffffff', { map: plankTexture(), roughness: 0.7, key: 'plank' });
    const balcony = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 0.25, 32), plankMat); balcony.position.y = h - 0.1;
    const rail = new THREE.Mesh(new THREE.TorusGeometry(6.3, 0.07, 6, 48), plankMat); rail.rotation.x = Math.PI / 2; rail.position.y = h + 0.7;
    g.add(balcony, rail);
    g.add(ringOf(24, 6.3, h + 0.35, () => new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5), plankMat)));
    const band = new THREE.Mesh(new THREE.TorusGeometry(5.62, 0.12, 6, 48), trim); band.rotation.x = Math.PI / 2; band.position.y = 0.2;
    g.add(band);
    // The balcony rests on corbels instead of floating on the wall.
    const cm = stoneMat('#9a948a', 1, 0.3);
    g.add(corbels(20, 5.55, h - 0.42, cm, 0.75));
    // An oriel bay: a little corbelled turret with a lit window, tucked under the balcony.
    const oriel = turret({ r: 1.05, h: 2.5, roof: 1.0, wall: stoneMat('#9a948a', 2, 0.6), roofMat: slateMat(), glass: glowMat('#ffc873', 2.4), lean: 0, foot: 1.4 });
    const oa = -Math.PI / 2; // between two windows
    oriel.position.set(Math.sin(oa) * 5.45, 1.9, Math.cos(oa) * 5.45); oriel.rotation.y = oa;
    g.add(oriel);
    // Banners flank the door.
    [-0.42, 0.42].forEach((a) => {
      const b = banner('#5b3fa8', 1.0, 2.6);
      b.position.set(Math.sin(a) * 5.5, h - 0.75, Math.cos(a) * 5.5); b.rotation.y = a;
      g.add(b);
    });
    return { group: shadowAll(g), height: h };
  },

  library() {
    const g = new THREE.Group();
    const h = 6.5;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(5.0, 5.3, h, 32), stoneMat('#8a8fa0', 6, 1.3));
    wall.position.y = h / 2; g.add(wall);
    g.add(windows(8, 5.15, 3.4, '#7fc8ff', 0.6, 2.4));
    // Buttresses.
    const bm = stoneMat('#7e8392', 1, 1);
    // Buttresses sit between the windows (half a bay round), not over them.
    const piers = ringOf(8, 5.3, h / 2 - 0.3, () => new THREE.Mesh(rbox(0.6, h - 0.6, 0.9), bm));
    piers.rotation.y = Math.PI / 8;
    g.add(piers);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.3, 0.5, 32), stoneMat('#6c7080', 6, 0.2)); cap.position.y = h;
    g.add(cap, crenellations(5.6, h + 0.55, '#6c7080'));
    g.add(corbels(24, 5.1, h - 0.38, bm, 0.6));
    // Two bartizans stand on the buttress heads and break the line of the battlements.
    [-Math.PI * 3 / 8, Math.PI * 7 / 8].forEach((a, i) => {
      const t = turret({ r: 1.0, h: 2.4, roof: 2.8 + i * 0.6, wall: stoneMat('#8a8fa0', 2, 0.5), roofMat: slateMat(), glass: glowMat('#7fc8ff', 2.4), lean: i ? -0.35 : 0.3 });
      t.position.set(Math.sin(a) * 5.65, h - 0.3, Math.cos(a) * 5.65); t.rotation.y = a;
      g.add(t);
    });
    // A stair of hovering stones winds up from the Study balcony to the battlements.
    const stair = new THREE.Group();
    const slab = stoneMat('#8a8fa0', 0.5, 0.2), shard = glowMat('#8fd8ff', 2.6);
    const STEPS = 16;
    for (let i = 0; i < STEPS; i++) {
      const k = i / (STEPS - 1), a = 0.35 + k * 3.6, y = 1.1 + k * 5.9;
      const st = new THREE.Group();
      const top = new THREE.Mesh(lbox(1.3, 0.24, 0.85), slab);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), shard); gem.scale.y = 2.2; gem.position.y = -0.36;
      st.add(top, gem);
      st.position.set(Math.sin(a) * 6.45, y, Math.cos(a) * 6.45); st.rotation.y = a;
      stair.add(st);
    }
    g.add(stair);
    // Orbiting enchanted books.
    const books = new THREE.Group();
    const colors = ['#8b2e2e', '#2e4f8b', '#2e8b57', '#6b2e8b', '#8b6b2e'];
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(rbox(0.5, 0.7, 0.18), new THREE.MeshStandardMaterial({ color: colors[i % 5], emissive: colors[i % 5], emissiveIntensity: 0.4 }));
      const a = (i / 10) * Math.PI * 2;
      b.position.set(Math.sin(a) * 7.6, 2 + (i % 3) * 1.4, Math.cos(a) * 7.6);
      b.rotation.set(0.3, a, 0.2);
      books.add(b);
    }
    books.userData.spin = 0.25;
    g.add(books);
    g.userData.spinners = [books];
    return { group: shadowAll(g), height: h + 0.5 };
  },

  alchemy() {
    const g = new THREE.Group();
    const h = 5.5;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5.0, h, 32), stoneMat('#8e9a86', 5, 1.1));
    wall.position.y = h / 2; g.add(wall);
    g.add(windows(6, 4.95, 2.8, '#6dff9a', 0.9, 1.6));
    const band = new THREE.Mesh(new THREE.TorusGeometry(4.95, 0.14, 6, 48), trim); band.rotation.x = Math.PI / 2; band.position.y = h - 0.3;
    g.add(band);
    // Copper chimneys that vent coloured smoke.
    const copper = shared('copper', () => clay('#d0844a', { metalness: 0.35, roughness: 0.4, key: 'towerCopper' }));
    const vents = [];
    [[3.2, 1.2], [-2.6, -2.4]].forEach(([x, z], i) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 4 + i, 12), copper);
      p.position.set(x, h + (4 + i) / 2 - 1.5, z);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 6, 12), copper); lip.rotation.x = Math.PI / 2;
      lip.position.set(x, h + (4 + i) - 1.5, z);
      g.add(p, lip);
      vents.push(new THREE.Vector3(x, h + (4 + i) - 1.3, z));
    });
    const floorCap = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 4.8, 0.4, 32), stoneMat('#6f7b68', 5, 0.2)); floorCap.position.y = h;
    g.add(floorCap);
    // A glass conservatory juts from the wall between two windows, lit by bubbling flasks.
    const glass = shared('conservatory', () => new THREE.MeshStandardMaterial({ color: '#c8ffe0', emissive: '#3dff8a', emissiveIntensity: 0.3, roughness: 0.05, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
    const bay = new THREE.Group();
    const HALF = [-Math.PI / 2, Math.PI];
    const sill = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.25, 18, 1, false, ...HALF), copper);
    const foot = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.2, 18, 1, false, ...HALF), stoneMat('#8e9a86', 2, 0.4)); foot.rotation.x = Math.PI; foot.position.y = -0.72;
    const pane = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 1.9, 18, 1, true, ...HALF), glass); pane.position.y = 1.08;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.45, 18, 8, 0, Math.PI, 0, Math.PI / 2), glass); dome.position.y = 2.03;
    bay.add(sill, foot, pane, dome);
    for (let i = 0; i <= 4; i++) {
      const a = -Math.PI / 2 + (i / 4) * Math.PI;
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 5), copper); rib.position.set(Math.sin(a) * 1.47, 1.08, Math.cos(a) * 1.47);
      bay.add(rib);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.47, 0.05, 5, 16, Math.PI), copper); arch.rotation.y = Math.PI / 2; arch.position.y = 2.03;
    bay.add(arch);
    ['#6dff9a', '#ff7ad9', '#7fd8ff'].forEach((c, i) => {
      const flask = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), glowMat(c, 2.2)); flask.position.set((i - 1) * 0.5, 0.36, 0.7 + (i % 2) * 0.25);
      bay.add(flask);
    });
    const ca = Math.PI * 5 / 6;
    bay.position.set(Math.sin(ca) * 4.85, 0.8, Math.cos(ca) * 4.85); bay.rotation.y = ca;
    g.add(bay);
    // Copper pipework spirals once round the wall, from the conservatory up to the roof.
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const k = i / 40, a = ca + 0.45 + k * (Math.PI * 2 - 0.9);
      pts.push(new THREE.Vector3(Math.sin(a) * 5.12, 0.6 + k * 4.3, Math.cos(a) * 5.12));
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.14, 8), copper));
    for (let i = 2; i < 40; i += 6) {
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 5, 10), copper);
      c.position.copy(pts[i]); c.lookAt(pts[i + 1].clone().add(g.position));
      g.add(c);
    }
    g.userData.vents = vents;
    return { group: shadowAll(g), height: h + 0.2 };
  },

  observatory() {
    const g = new THREE.Group();
    const h = 3;
    // The observatory overhangs the laboratory on a ring of corbels, with a railed walk round the dome.
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.45, h, 32), stoneMat('#9b92a6', 6, 0.6));
    wall.position.y = h / 2; g.add(wall);
    g.add(corbels(26, 5.05, -0.08, stoneMat('#9b92a6', 1, 0.3), 0.7));
    g.add(windows(10, 5.55, 1.6, '#c9a8ff', 0.5, 1.0));
    const brass = brassMat();
    g.add(ringOf(30, 5.4, h + 0.32, () => new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.64, 5), brass)));
    const walkRail = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.06, 6, 64), brass); walkRail.rotation.x = Math.PI / 2; walkRail.position.y = h + 0.66;
    g.add(walkRail);
    const domeMat = shingleMat('#5a8fe0', '#3b64b5', 10, 3);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(5.0, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.y = h; g.add(dome);
    const ribs = ringOf(12, 0, h, (i, a) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(5.02, 0.06, 4, 32, Math.PI), brass);
      r.rotation.y = Math.PI / 2;
      return r;
    });
    g.add(ribs);
    // Telescope poking out.
    const scope = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 5, 16), brass); tube.rotation.z = Math.PI / 2;
    tube.position.x = 2.5;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.36, 16), glowMat('#bfe8ff', 3)); lens.rotation.y = Math.PI / 2; lens.position.x = 5.01;
    scope.add(tube, lens);
    scope.position.y = h + 2.5; scope.rotation.z = 0.6;
    // The dome's shutter stands open where the telescope looks out, and turns with it.
    const slit = new THREE.Mesh(new THREE.TorusGeometry(5.05, 0.2, 6, 24, Math.PI / 2), glowMat('#bfe8ff', 1.6)); slit.position.y = h;
    const scopePivot = new THREE.Group(); scopePivot.add(scope, slit);
    g.add(scopePivot);
    // Armillary rings above.
    const arm = new THREE.Group();
    [0, 1, 2].forEach((i) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2.2 + i * 0.35, 0.05, 6, 48), brass);
      r.rotation.set(i * 0.9, i * 0.5, 0);
      arm.add(r);
    });
    arm.position.y = h + 6.2; arm.userData.spin = 0.5; arm.userData.tumble = true;
    g.add(arm);
    scopePivot.userData.spin = 0.05;
    g.userData.spinners = [arm, scopePivot];
    return { group: shadowAll(g), height: h + 4.8 };
  },

  spire() {
    const g = new THREE.Group();
    const slate = shingleMat('#7b62d6', '#5343a8', 12, 6);
    const stone = stoneMat('#a8a0b4', 4, 0.5);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.2, 2.5, 24), stone); base.position.y = 1.25;
    // The drum is wider than the top of the dome: a corbelled cone carries it down into the dome.
    const neck = new THREE.Mesh(new THREE.ConeGeometry(4.2, 3.2, 24), stone); neck.rotation.x = Math.PI; neck.position.y = -1.6;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.14, 6, 48), trim); lip.rotation.x = Math.PI / 2;
    g.add(base, neck, lip, corbels(18, 3.85, -0.15, stone, 0.6));
    // A tall witch-hat roof, flared at the eaves, instead of a plain cone.
    const ROOF_H = 15, EAVE = 0.6, P = 1.7;
    const roof = flaredRoof(4.2, ROOF_H, slate, { eave: EAVE, p: P, seg: 32 }); roof.position.y = 2.5;
    g.add(roof);
    g.add(windows(4, 3.9, 1.3, '#ffe08a', 0.5, 0.9));
    const band = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.16, 6, 48), trim); band.rotation.x = Math.PI / 2; band.position.y = 2.5;
    g.add(band);
    g.add(corbels(20, 4.05, 2.2, stone, 0.55));
    // Four pinnacle turrets ring the eaves.
    const glass = glowMat('#ffe08a', 2.4);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const t = turret({ r: 0.7, h: 1.9, roof: 3.0, wall: stone, roofMat: slateMat(), glass, lean: (i % 2 ? -1 : 1) * 0.22, foot: 1.0 });
      t.position.set(Math.sin(a) * 4.2, 1.0, Math.cos(a) * 4.2); t.rotation.y = a;
      g.add(t);
    }
    // Dormer windows on the four faces of the roof.
    const roofR = (y) => (4.2 + EAVE) * Math.pow(1 - (y - 2.5) / ROOF_H, P);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2, y = 6.2, r = roofR(y);
      const d = new THREE.Group();
      const box = new THREE.Mesh(rbox(0.95, 1.1, 1.7), stone); box.position.set(0, 0.2, -0.35);
      const gable = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 1.9, 3), slate); gable.rotation.x = -Math.PI / 2; gable.position.set(0, 0.95, -0.3);
      const pane = new THREE.Mesh(rbox(0.5, 0.7, 0.1), glass); pane.position.set(0, 0.2, 0.52);
      d.add(box, gable, pane);
      d.position.set(Math.sin(a) * r, y, Math.cos(a) * r); d.rotation.y = a;
      g.add(d);
    }
    // A gilded finial, then the crown crystal floating in a double halo.
    const tip = 2.5 + ROOF_H;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), brassMat()); ball.position.y = tip;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.6, 8), brassMat()); spike.position.y = tip + 1.0;
    g.add(ball, spike);
    const CROWN = tip + 4;
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffd36b', emissiveIntensity: 3.5, roughness: 0.1 }));
    crystal.scale.set(0.8, 1.6, 0.8); crystal.position.y = CROWN; crystal.userData.spin = 0.8; crystal.userData.bob = CROWN;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.07, 8, 48), glowMat('#ffe9a8', 3)); halo.position.y = CROWN; halo.rotation.x = Math.PI / 2;
    halo.userData.spin = -0.6;
    const halo2 = new THREE.Group(); halo2.position.y = CROWN; halo2.rotation.z = 0.5;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.05, 8, 64), glowMat('#c9a8ff', 2.6)); ring2.rotation.x = Math.PI / 2;
    halo2.add(ring2); halo2.userData.spin = 0.35;
    g.add(crystal, halo, halo2);
    const light = new THREE.PointLight('#ffd36b', 30, 60, 1.5); light.position.y = CROWN; g.add(light);
    g.userData.spinners = [crystal, halo, halo2];
    return { group: shadowAll(g), height: CROWN + 1.5 };
  },
};

const LIGHTS = {}; // lights each floor carries (by index), counted once

export class Tower {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.root = new THREE.Group();
    this.root.position.set(0, PLATEAU_H - 0.4, 0);
    scene.add(this.root);
    this.floors = [];
    this.top = 0;
    this.anims = [];
    this.buildAltar();
    this.buildEntrance();
    this.ghost = null;
    this.holdLights();
  }

  buildAltar() {
    const g = new THREE.Group();
    const y = heightAt(ALTAR_POS.x, ALTAR_POS.z);
    g.position.set(ALTAR_POS.x, y, ALTAR_POS.z);
    const stone = stoneMat('#9a948a', 1, 0.4);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 0.5, 8), stone); base.position.y = 0.25;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.0, 8), stone); col.position.y = 1.0;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 0.25, 8), stone); top.position.y = 1.6;
    const book = new THREE.Mesh(rbox(0.9, 0.12, 0.65), new THREE.MeshStandardMaterial({ color: '#5b2a1a' }));
    book.position.y = 1.8; book.rotation.x = -0.25;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), glowMat('#8fd8ff', 3));
    gem.position.y = 2.7;
    const circle = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.MeshBasicMaterial({
      map: runeCircleTexture('#8fd8ff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8,
    }));
    circle.rotation.x = -Math.PI / 2; circle.position.y = 0.06;
    g.add(base, col, top, book, gem, circle);
    shadowAll(g);
    circle.castShadow = false;
    this.altar = { group: g, gem, circle, x: ALTAR_POS.x, z: ALTAR_POS.z };
    this.scene.add(g);
  }

  // Portal pad at the foot of the steps: stepping on it takes you inside the tower.
  buildEntrance() {
    const g = new THREE.Group();
    const x = 0, z = 9.6;
    g.position.set(x, heightAt(x, z) + 0.02, z);
    this.padTop = { x, z, r: 1.3, y: heightAt(x, z) + 0.16 }; // you step onto the pad (see surfaceAt)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.14, 32), clay('#d8ccb6', { key: 'padStone' }));
    base.position.y = 0.07; base.receiveShadow = true;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.15, 40), new THREE.MeshBasicMaterial({
      map: runeCircleTexture('#ffd36b'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.16;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.1, 10, 32, Math.PI), clay(PALETTE.wood, { key: 'towerTrim' }));
    arch.position.y = 0.05; arch.rotation.y = 0;
    const shimmer = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32, 0, Math.PI), new THREE.MeshBasicMaterial({
      color: '#ffe9a8', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    shimmer.position.y = 0.05;
    g.add(base, glow, arch, shimmer);
    g.visible = false;
    this.entrance = { group: g, glow, shimmer };
    this.scene.add(g);
  }

  get colliders() {
    const list = [{ x: ALTAR_POS.x, z: ALTAR_POS.z, radius: 1.2 }];
    if (this.floors.length) list.push({ x: 0, z: 0, radius: 7.9 });
    return list;
  }

  makeFloor(index) {
    const def = TOWER_FLOORS[index];
    return BUILDERS[def.id]();
  }

  // Instantly place floors (used on load), and hold room for the lights of the floors to come.
  setFloors(n) {
    for (let i = this.floors.length; i < n; i++) this.addFloor(i, false);
    this.refreshGhost();
    this.holdLights();
  }

  // Room for the lights of the floors still to come (see lightbank.js).
  holdLights() {
    this.bank ||= new LightBank(this.root);
    let lights = 0;
    for (let i = this.floors.length; i < TOWER_FLOORS.length; i++) lights += (LIGHTS[i] ??= lightsIn(this.makeFloor(i).group));
    this.bank.hold(lights);
  }

  // Build a floor ready to place (so its shaders can be compiled before it appears).
  prepareFloor(index) {
    const { group, height } = this.makeFloor(index);
    const ud = group.userData;
    [...(ud.spinners || []), ud.runes].forEach((o) => { if (o) o.userData.dynamic = true; });
    mergeStatic(group);
    return { group, height };
  }

  get hasEntrance() { return this.floors.length > 0; }

  // Walkable tops: the portal pad at the foot of the steps.
  surfaceAt(x, z) { const p = this.padTop; return p && Math.hypot(x - p.x, z - p.z) < p.r ? p.y : -Infinity; }

  addFloor(index, animate = true, prepared = null) {
    const { group, height } = prepared || this.prepareFloor(index);
    group.position.y = this.top;
    this.root.add(group);
    this.bank?.admit(group);
    const f = { group, height, base: this.top, index };
    // Its full-size bounds in the world, for the camera to frame.
    group.updateWorldMatrix(true, true);
    f.box = new THREE.Box3().setFromObject(group);
    this.floors.push(f);
    this.top += height;
    if (animate) {
      group.scale.set(0.001, 0.001, 0.001);
      this.anims.push({ f, t: 0 });
      const c = new THREE.Vector3(0, this.root.position.y + f.base, 0);
      this.particles.ring(c, { count: 140, color: '#ffe08a', speed: 14, size: 0.7, life: 1.6, y: 0.5 });
    }
    this.refreshGhost();
    return f;
  }

  // Translucent hologram of the next floor so the goal is always visible.
  refreshGhost() {
    if (this.ghost) { this.root.remove(this.ghost); this.ghost = null; }
    const next = this.floors.length;
    if (next >= TOWER_FLOORS.length) return;
    const { group } = this.makeFloor(next);
    const mat = new THREE.MeshBasicMaterial({ color: '#7fd8ff', transparent: true, opacity: 0.12, wireframe: true, depthWrite: false });
    group.traverse((o) => {
      if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; }
      if (o.isLight) o.visible = false;
    });
    mergeStatic(group); // one wireframe draw instead of dozens
    group.position.y = this.top;
    group.userData.ghostMat = mat;
    this.ghost = group;
    this.root.add(group);
  }

  get topWorld() { return this.root.position.y + this.top; }

  // Light the plinth's standing stones from the save: dark, waking (sanctum begun), or won.
  refreshStandards(state) {
    const list = this.floors[0]?.group.userData.standards;
    if (!list || !state) return;
    for (const st of list) {
      const guardian = SANCTUMS[st.id]?.stages.find((x) => x.guardian)?.guardian;
      const lvl = guardian && state.guardians?.includes(guardian) ? 2 : (state.sanctums?.[st.id] || 0) > 0 ? 1 : 0;
      if (lvl === st.lvl) continue;
      st.lvl = lvl;
      st.mat.color.set(lvl ? st.color : '#6b6670');
      st.mat.emissiveIntensity = [0, 0.5, 2.6][lvl];
      st.gem.userData.spin = [0, 0.4, 1.2][lvl];
    }
  }

  update(dt, elapsed) {
    for (const a of [...this.anims]) {
      a.t += dt / 2.6;
      const t = Math.min(1, a.t);
      // Overshoot ease for a magical "pop" into place.
      const e = 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
      const s = Math.max(0.001, e);
      a.f.group.scale.set(s, s, s);
      if (Math.random() < 0.8) {
        const ang = elapsed * 6 + Math.random() * 6.28, r = 6 + Math.random() * 2;
        this.particles.spawn(Math.cos(ang) * r, this.root.position.y + a.f.base + Math.random() * a.f.height * s, Math.sin(ang) * r,
          -Math.sin(ang) * 4, 3, Math.cos(ang) * 4, new THREE.Color('#ffe9a8'), 0.6, 1.4, 0, 0.8);
      }
      if (t >= 1) { a.f.group.scale.set(1, 1, 1); this.anims.splice(this.anims.indexOf(a), 1); }
    }
    for (const f of this.floors) {
      const ud = f.group.userData;
      ud.spinners?.forEach((s) => {
        s.rotation.y += (s.userData.spin || 0) * dt;
        if (s.userData.tumble) s.rotation.x += dt * 0.2;
        if (s.userData.bob) s.position.y = s.userData.bob + Math.sin(elapsed * 1.5 + (s.userData.phase || 0)) * (s.userData.bobAmp ?? 0.4);
      });
      if (ud.runes) ud.runes.rotation.z += dt * 0.05;
      if (ud.vents && Math.random() < dt * 14) {
        const v = ud.vents[Math.floor(Math.random() * ud.vents.length)];
        const col = new THREE.Color().setHSL(0.35 + Math.random() * 0.15, 0.9, 0.6);
        this.particles.spawn(v.x, this.root.position.y + f.base + v.y, v.z, (Math.random() - 0.5) * 0.6, 1.6, (Math.random() - 0.5) * 0.6, col, 0.9, 3, -0.2, 0.3);
      }
    }
    this.refreshStandards(this.getState?.());
    // Flicker brazier flames.
    this.floors[0]?.group.traverse((o) => { if (o.userData.flicker) o.scale.y = 0.85 + Math.random() * 0.3; });
    if (this.ghost) {
      this.ghost.userData.ghostMat.opacity = 0.1 + Math.sin(elapsed * 2) * 0.05;
      this.ghost.rotation.y = Math.sin(elapsed * 0.3) * 0.05;
    }
    if (this.entrance) {
      const e = this.entrance;
      e.group.visible = this.floors.length > 0;
      e.glow.rotation.z += dt * 0.5;
      e.shimmer.material.opacity = 0.18 + Math.sin(elapsed * 2.5) * 0.1;
    }
    const al = this.altar;
    al.gem.rotation.y += dt * 1.5;
    al.gem.position.y = 2.7 + Math.sin(elapsed * 2) * 0.15;
    al.circle.rotation.z -= dt * 0.2;
  }
}
