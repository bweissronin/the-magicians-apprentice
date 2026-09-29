import * as THREE from 'three';
import { PLATEAU_H, heightAt } from './world.js';
import { ALTAR_POS, TOWER_FLOORS } from './data.js';
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
  return ringOf(16, r - 0.2, y, () => new THREE.Mesh(rbox(0.9, 0.7, 0.5), mat));
}

function windows(n, r, y, color, w = 0.7, h = 1.3, skip = -1) {
  const glass = glowMat(color, 2.4);
  return ringOf(n, r + 0.02, y, (i) => {
    const g = new THREE.Group();
    if (i === skip) return g;
    const pane = new THREE.Mesh(rbox(w, h, 0.15), glass);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.15, 12, 1, false, 0, Math.PI), glass);
    arch.rotation.x = Math.PI / 2; arch.rotation.z = Math.PI / 2; arch.position.y = h / 2;
    const sill = new THREE.Mesh(rbox(w + 0.3, 0.12, 0.35), trim);
    sill.position.y = -h / 2 - 0.05;
    g.add(pane, arch, sill);
    return g;
  });
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
    g.add(ringOf(8, 5.3, h / 2 - 0.3, () => {
      const b = new THREE.Mesh(rbox(0.6, h - 0.6, 0.9), bm);
      return b;
    }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.3, 0.5, 32), stoneMat('#6c7080', 6, 0.2)); cap.position.y = h;
    g.add(cap, crenellations(5.6, h + 0.55, '#6c7080'));
    // Orbiting enchanted books.
    const books = new THREE.Group();
    const colors = ['#8b2e2e', '#2e4f8b', '#2e8b57', '#6b2e8b', '#8b6b2e'];
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(rbox(0.5, 0.7, 0.18), new THREE.MeshStandardMaterial({ color: colors[i % 5], emissive: colors[i % 5], emissiveIntensity: 0.4 }));
      const a = (i / 10) * Math.PI * 2;
      b.position.set(Math.sin(a) * 7, 2 + (i % 3) * 1.4, Math.cos(a) * 7);
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
    const copper = new THREE.MeshStandardMaterial({ color: '#b87333', metalness: 0.8, roughness: 0.35 });
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
    g.userData.vents = vents;
    return { group: shadowAll(g), height: h + 0.2 };
  },

  observatory() {
    const g = new THREE.Group();
    const h = 3;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, h, 32), stoneMat('#9b92a6', 6, 0.6));
    wall.position.y = h / 2; g.add(wall);
    g.add(windows(10, 5.25, 1.6, '#c9a8ff', 0.5, 1.0));
    const brass = clay('#f2c35c', { metalness: 0.5, roughness: 0.35, key: 'brass' });
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
    const scopePivot = new THREE.Group(); scopePivot.add(scope);
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
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.2, 2.5, 24), stoneMat('#a8a0b4', 4, 0.5)); base.position.y = 1.25;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 12, 32, 12), slate); roof.position.y = 2.5 + 6;
    // Twist the roof for a hand-crafted look.
    const rp = roof.geometry.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const y = rp.getY(i) + 6, a = y * 0.05;
      const x = rp.getX(i), z = rp.getZ(i);
      rp.setX(i, x * Math.cos(a) - z * Math.sin(a)); rp.setZ(i, x * Math.sin(a) + z * Math.cos(a));
    }
    roof.geometry.computeVertexNormals();
    g.add(base, roof);
    g.add(windows(6, 3.9, 1.3, '#ffe08a', 0.5, 0.9));
    const band = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.16, 6, 48), trim); band.rotation.x = Math.PI / 2; band.position.y = 2.5;
    g.add(band);
    // Floating crown crystal.
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffd36b', emissiveIntensity: 3.5, roughness: 0.1 }));
    crystal.scale.set(0.8, 1.6, 0.8); crystal.position.y = 17.5; crystal.userData.spin = 0.8; crystal.userData.bob = true;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.07, 8, 48), glowMat('#ffe9a8', 3)); halo.position.y = 17.5; halo.rotation.x = Math.PI / 2;
    halo.userData.spin = -0.6;
    g.add(crystal, halo);
    const light = new THREE.PointLight('#ffd36b', 30, 60, 1.5); light.position.y = 17.5; g.add(light);
    g.userData.spinners = [crystal, halo];
    return { group: shadowAll(g), height: 19 };
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
        if (s.userData.bob) s.position.y = 17.5 + Math.sin(elapsed * 1.5) * 0.4;
      });
      if (ud.runes) ud.runes.rotation.z += dt * 0.05;
      if (ud.vents && Math.random() < dt * 14) {
        const v = ud.vents[Math.floor(Math.random() * ud.vents.length)];
        const col = new THREE.Color().setHSL(0.35 + Math.random() * 0.15, 0.9, 0.6);
        this.particles.spawn(v.x, this.root.position.y + f.base + v.y, v.z, (Math.random() - 0.5) * 0.6, 1.6, (Math.random() - 0.5) * 0.6, col, 0.9, 3, -0.2, 0.3);
      }
    }
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
