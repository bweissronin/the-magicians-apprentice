import * as THREE from 'three';
import { heightAt, WATER_LEVEL } from './world.js';
import { SCHOOLS, SANCTUMS, TOWER_FLOORS, SHRINES, PASS_LIP, passPoint } from './data.js';
import { prop } from './assets.js';
import { clay } from './style.js';

// The Fraying Veil: Master Aldric is gone and his five towers have fallen. Each tower the
// apprentice rebuilds pins the Veil back down and steadies part of the world, and the valley
// shows every wound healing. This module owns the chapters, Aldric's letter, the stability
// count, and the visible scars on the valley.

export const ALDRIC_LETTER = [
  'My dear apprentice — if you are reading this, I have gone where I swore I never would: into the Veil itself.',
  'Veyra, my first apprentice, tore it trying to hold every element at once. She is still inside, and she is still tearing. Someone must hold the thread while it can be mended.',
  'My tower and its four sanctums were bound to me. When I step through, they will fall — here, and in the four realms beyond the mist at the valley’s edge.',
  'Rebuild them. Every stone you raise pins the Veil back down and takes weight off the thread I am holding. Quill knows where everything is, and will tell you so at length.',
  'Be brave. Be patient. Mostly be patient. — A.',
];

export const CHAPTERS = [
  { n: 1, title: 'The Empty Tower', blurb: 'Aldric is gone and his tower lies in ruins. Raise it again — and learn Radiance, so the dead can be made to stand in the light.' },
  { n: 2, title: 'The Hollow Calls', blurb: 'In the Crypt the dead will not stay down. Rebuild the Titan\'s Ossuary, and learn to see what hides from the living.' },
  { n: 3, title: 'The Sundered Deep', blurb: 'The mountain is splitting. Spirit Sight shows the safe way through the fallen tunnels — go down and learn the language of stone.' },
  { n: 4, title: 'The White Silence', blurb: 'An endless winter spreads from the Glacier. Stone crosses its crevasses and breaks its wraiths\' armour.' },
  { n: 5, title: 'The Burning Heart', blurb: 'The Caldera is building to burst. Frost cools its imps; Earthen Stair crosses its rivers of fire.' },
  { n: 6, title: 'Return and Reckoning', blurb: 'Each realm\'s old ruler squats in the ruins of Aldric\'s tower. Return with every element and drive them out.' },
  { n: 7, title: 'The Convergence', blurb: 'Raise the Arcane Spire — a tower that holds every element — and face the Unraveller at its peak.' },
];
const roman = (n) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][n];
export const chapterLabel = (n) => `Chapter ${roman(n)}`;

export const GUARDIANS = {
  lich: { name: 'The Lich King', realm: 'necromancy', color: '#7dff9b' },
  king: { name: 'The Mountain King', realm: 'geomancy', color: '#dca468' },
  queen: { name: 'The Winter Queen', realm: 'cryomancy', color: '#8fe3ff' },
  tyrant: { name: 'The Molten Tyrant', realm: 'pyromancy', color: '#ff8a3c' },
};

export function chapterOf(s) {
  if (!s.schoolUnlocked('necromancy')) return 1;
  if (!s.schoolUnlocked('geomancy')) return 2;
  if (!s.schoolUnlocked('cryomancy')) return 3;
  if (!s.schoolUnlocked('pyromancy')) return 4;
  if (!s.knows('fire')) return 5;
  if (s.guardians.length < 4) return 6;
  return 7;
}

// 25 seals: the Arcane tower's first five floors and five stages in each of four realms.
export function stability(s) {
  return Math.min(5, s.floors) + SCHOOLS.reduce((n, d) => n + s.sanctumStage(d.id), 0);
}

// The checklist for the quest log (J). Each item: { text, done, target? }.
export function chapterGoals(s, n = chapterOf(s)) {
  const sch = (id) => SCHOOLS.find((d) => d.id === id);
  const gate = (id) => ({ text: `Open the way to <b>${sch(id).realm}</b> (level ${sch(id).level} · ${sch(id).needs.label})`, done: s.schoolUnlocked(id), target: passPoint(id, PASS_LIP - 6) });
  const initiate = (id, what) => ({ text: `Reach <b>Initiate</b> in ${sch(id).name} — ${what}`, done: s.mastery(id) >= 1 });
  const stage = (id, k = 1) => ({ text: `Raise <b>${SANCTUMS[id].stages[k - 1].name}</b> (${SANCTUMS[id].name})`, done: s.sanctumStage(id) >= k });
  switch (n) {
    case 1: return [
      { text: 'Read <b>Aldric\'s letter</b> — Quill has it', done: s.story.letter },
      { text: `Raise the <b>${TOWER_FLOORS[0].name}</b>`, done: s.floors >= 1 },
      { text: `Raise the <b>${TOWER_FLOORS[1].name}</b>`, done: s.floors >= 2 },
      { text: `Gather <b>Shadow Silk</b> from wisps at night (${Math.min(3, s.inv.silk + (s.up('radiance') ? 3 : 0))}/3)`, done: s.up('radiance') >= 1 || s.inv.silk >= 3 },
      { text: 'Research <b>Radiance</b> at the Spell Tome in your Study', done: s.up('radiance') >= 1 },
      gate('necromancy'),
    ];
    case 2: return [initiate('necromancy', 'learn <b>Spirit Sight</b>'), stage('necromancy'), gate('geomancy')];
    case 3: return [initiate('geomancy', 'learn <b>Earth</b> [3]'), stage('geomancy'), gate('cryomancy')];
    case 4: return [initiate('cryomancy', 'learn <b>Frost</b> [4]'), stage('cryomancy'), gate('pyromancy')];
    case 5: return [initiate('pyromancy', 'learn <b>Fire</b> [5]'), stage('pyromancy')];
    case 6: return Object.entries(GUARDIANS).map(([id, gd]) => ({ text: `Defeat <b>${gd.name}</b> at ${SANCTUMS[gd.realm].name} (raise stage 4, then challenge them at the cornerstone)`, done: s.guardians.includes(id) }));
    default: return [
      { text: `Raise <b>${TOWER_FLOORS[TOWER_FLOORS.length - 1].name}</b>`, done: s.floors >= TOWER_FLOORS.length },
      { text: 'Defeat <b>the Unraveller</b> atop the Spire', done: !!s.finale },
    ];
  }
}

// ---------------------------------------------------------------- the valley's wounds
// Rifts split the night sky (one closes per Arcane floor); ley lines relight toward the bridges;
// cracks cross the paths (closing with the Heartstone Hold); frost creeps over the lake at dusk
// (with the Aurora Spire); ash falls and reddens the sky (with the Forge-Heart); spirits rise
// from the old graves at night (with the Titan's Ossuary). Aldric's ruined tower lies as rubble
// until the foundation is raised.
export class ValleyScars {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.group = new THREE.Group(); scene.add(this.group);
    // --- Rifts in the sky.
    this.rifts = [];
    const riftMat = () => new THREE.MeshBasicMaterial({ color: '#ff4ad8', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4, r = 175, y = 48 + (i % 3) * 12, pts = [];
      let x = Math.cos(a) * r, z = Math.sin(a) * r, yy = y;
      for (let k = 0; k < 10; k++) { pts.push(new THREE.Vector3(x, yy, z)); x += Math.cos(a + Math.PI / 2) * (4 + Math.random() * 4); z += Math.sin(a + Math.PI / 2) * (4 + Math.random() * 4); yy += (Math.random() - 0.35) * 8; }
      const core = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 40, 0.9, 6), riftMat());
      const halo = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 40, 3.2, 6), riftMat());
      halo.material.opacity = 0.18; halo.material.color.set('#a040ff');
      const g = new THREE.Group(); g.add(core, halo); g.userData.pts = pts; g.frustumCulled = false;
      this.group.add(g); this.rifts.push(g);
      game.aoHidden.push(core, halo);
    }
    // --- Ley lines from the tower out to the Deep's bridgehead and the five shrines.
    this.ley = [];
    const ends = [passPoint('geomancy', PASS_LIP - 8), ...SHRINES.map((s) => ({ x: s.x, z: s.z }))];
    ends.forEach((e) => {
      const pts = [], N = 60, L = Math.hypot(e.x, e.z);
      for (let k = 0; k <= N; k++) {
        const t = k / N, x = e.x * t + Math.sin(t * 9) * 1.2 * Math.sin(t * Math.PI), z = e.z * t + Math.cos(t * 7) * 1.2 * Math.sin(t * Math.PI);
        if (Math.hypot(x, z) < 11) continue;
        pts.push([x, z]);
      }
      const verts = [], idx = [];
      pts.forEach(([x, z], k) => {
        const [nx, nz] = pts[Math.min(k + 1, pts.length - 1)], [px, pz] = pts[Math.max(k - 1, 0)], a = Math.atan2(nx - px, nz - pz);
        const y = Math.max(heightAt(x, z), WATER_LEVEL) + 0.08, w = 0.35;
        verts.push(x - Math.cos(a) * w, y, z + Math.sin(a) * w, x + Math.cos(a) * w, y, z - Math.sin(a) * w);
        if (k < pts.length - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
      });
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(idx);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#c9a8ff', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.userData.len = L; this.group.add(m); this.ley.push(m); game.aoHidden.push(m);
    });
    // --- Cracks across the tower grounds (amber-lit fissures).
    this.cracks = [];
    const crackMat = new THREE.MeshBasicMaterial({ color: '#ff9a3c', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const darkMat = new THREE.MeshBasicMaterial({ color: '#140a06', transparent: true, opacity: 0.8, depthWrite: false });
    // A jagged fissure: a tapering ribbon along a zig-zag, with branches; molten light inside.
    const ribbon = (pts, w0, w1, lift) => {
      const v = [], idx = [];
      pts.forEach(([x, z], k) => {
        const [nx, nz] = pts[Math.min(k + 1, pts.length - 1)], [px, pz] = pts[Math.max(k - 1, 0)], a = Math.atan2(nx - px, nz - pz);
        const t = k / (pts.length - 1), w = (w0 + (w1 - w0) * t) * (0.6 + 0.4 * Math.sin(k * 2.3) ** 2), y = heightAt(x, z) + lift;
        v.push(x - Math.cos(a) * w, y, z + Math.sin(a) * w, x + Math.cos(a) * w, y, z - Math.sin(a) * w);
        if (k < pts.length - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
      });
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.setIndex(idx);
      return geo;
    };
    [[18, 20, 0.6], [-22, 16, 2.1], [24, -14, 4.2], [-16, -24, 3.0], [4, 30, 1.2]].forEach(([cx, cz, a]) => {
      const g = new THREE.Group();
      const trunk = [[cx, cz]];
      let x = cx, z = cz;
      for (let k = 0; k < 16; k++) { const ang = a + (k % 2 ? 0.6 : -0.6) + (Math.random() - 0.5) * 0.4; x += Math.sin(ang) * 0.9; z += Math.cos(ang) * 0.9; trunk.push([x, z]); }
      const branches = [trunk];
      for (let b = 0; b < 3; b++) {
        const start = trunk[3 + b * 4], br = [start]; let bx = start[0], bz = start[1]; const ba = a + (b % 2 ? 1.1 : -1.1);
        for (let k = 0; k < 5; k++) { const ang = ba + (k % 2 ? 0.5 : -0.5); bx += Math.sin(ang) * 0.7; bz += Math.cos(ang) * 0.7; br.push([bx, bz]); }
        branches.push(br);
      }
      branches.forEach((pts, i) => {
        const w = i ? 0.22 : 0.42;
        const d = new THREE.Mesh(ribbon(pts, w, 0.03, 0.04), darkMat), c = new THREE.Mesh(ribbon(pts, w * 0.35, 0.01, 0.05), crackMat);
        g.add(d, c); game.aoHidden.push(d, c);
      });
      this.group.add(g); this.cracks.push(g);
    });
    // --- Frost on the lake.
    const frost = new THREE.Mesh(new THREE.RingGeometry(10, 30, 64, 1), new THREE.MeshStandardMaterial({ color: '#eef8ff', roughness: 0.3, transparent: true, opacity: 0, depthWrite: false }));
    frost.rotation.x = -Math.PI / 2; frost.position.set(-40, WATER_LEVEL + 0.05, 60); this.group.add(frost); this.frost = frost; game.aoHidden.push(frost);
    // --- The old graves west of the tower, where spirits rise at night.
    this.graves = { x: -46, z: -30 };
    const stone = clay('#8a8599', { roughness: 0.7, key: 'grave' });
    for (let i = 0; i < 9; i++) {
      const x = this.graves.x + (i % 3) * 3.2 - 3 + (Math.random() - 0.5), z = this.graves.z + Math.floor(i / 3) * 3.4 - 3;
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1 + Math.random() * 0.4, 0.22), stone);
      g.position.set(x, heightAt(x, z) + 0.5, z); g.rotation.set((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.2); g.castShadow = true;
      this.group.add(g);
    }
    // --- Aldric's fallen tower: rubble around the foundation and his staff standing in it.
    this.rubble = new THREE.Group(); this.group.add(this.rubble); this.rubbleColliders = [];
    this.staff = null;
    this.ashT = 0;
    this.built = false;
  }

  // Blender pieces arrive after the loading screen; build the ruins once they have.
  buildRuins() {
    if (this.built) return;
    this.built = true;
    [[-12, -7, 0.4, 1], [11, -9, 2.2, 0.9], [1, -14, 4.1, 1.1], [-13, 3, 5.4, 0.7]].forEach(([x, z, r, s]) => {
      const p = prop('rubble_pile');
      const g = p || (() => {
        const q = new THREE.Group(), m = clay('#cfc4b0', { key: 'ruinStone' });
        for (let k = 0; k < 9; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1 + Math.random(), 0.6 + Math.random() * 0.5, 1 + Math.random()), m); b.position.set((Math.random() - 0.5) * 4, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 4); b.rotation.set(Math.random(), Math.random() * 3, Math.random()); b.castShadow = true; q.add(b); }
        return q;
      })();
      if (p) p.scale.setScalar(s);
      g.position.set(x, heightAt(x, z) - 0.1, z); g.rotation.y = r;
      this.rubble.add(g);
      this.rubbleColliders.push({ x, z, radius: 2.4 * s });
    });
    const st = prop('aldric_staff');
    const staff = st || (() => { const q = new THREE.Group(); const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.1, 6), clay('#4a3222', { key: 'staffWood' })); sh.position.y = 1.05; q.add(sh); const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshStandardMaterial({ color: '#d8c8ff', emissive: '#9b7bff', emissiveIntensity: 4 })); c.position.y = 2.2; q.add(c); return q; })();
    staff.position.set(-4.6, heightAt(-4.6, 12.2) - 0.2, 12.2); staff.rotation.set(0.12, 0.5, -0.1);
    const glowL = new THREE.PointLight('#b89bff', 6, 8, 2); glowL.position.set(0, 2.3, 0); staff.add(glowL);
    this.staff = staff; this.group.add(staff);
  }

  get colliders() { return this.rubble.visible ? this.rubbleColliders : []; }

  update(dt, t, focus) {
    const g = this.game, s = g.state, w = g.world;
    if (!this.built && g.assetsLoaded) this.buildRuins();
    const inValley = !g.realm && !g.inside;
    this.group.visible = inValley;
    if (!inValley) { g.grade.uniforms.uAsh.value = 0; return; }
    const night = w.night;
    const stage = (id) => s.sanctumStage(id) / 5; // 0..1 healed
    // Rifts: one closes per Arcane floor. Faint by day, burning at night; wisps drip from them.
    const open = this.finale ? 6 : Math.max(0, 6 - s.floors);
    this.rifts.forEach((r, i) => {
      r.visible = i < open;
      if (!r.visible) return;
      r.children[0].material.opacity = 0.25 + night * 0.65 + Math.sin(t * 2 + i) * 0.05;
      r.children[1].material.opacity = (0.06 + night * 0.2) * (0.8 + Math.sin(t * 1.3 + i) * 0.2);
      if (night > 0.4 && Math.random() < dt * 3 * night) {
        const p = r.userData.pts[Math.floor(Math.random() * r.userData.pts.length)];
        g.particles.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 2, -3, (Math.random() - 0.5) * 2, this.riftCol ||= new THREE.Color('#e070ff'), 1.4, 6, 0, 0);
      }
    });
    // Ley lines: one relights per floor, pulsing out toward the valley's edge.
    this.ley.forEach((m, i) => {
      const lit = i < s.floors;
      m.material.color.set(lit ? '#c9a8ff' : '#3a3450');
      m.material.opacity = lit ? 0.45 + Math.sin(t * 2 - i) * 0.15 : 0.18;
    });
    // Cracks close as the Heartstone Hold rises.
    const cracks = 5 - s.sanctumStage('geomancy');
    this.cracks.forEach((c, i) => { c.visible = i < cracks; });
    // Frost creeps over the lake at dusk and night until the Aurora Spire stands.
    const dusk = Math.max(night, 1 - Math.min(1, Math.abs(w.time - 0.78) * 12));
    this.frost.material.opacity = 0.55 * dusk * (1 - stage('cryomancy'));
    this.frost.scale.setScalar(0.7 + dusk * 0.3);
    // Ash from the unquenched Caldera: falling flakes and a red cast to the sky.
    const ash = s.schoolUnlocked('pyromancy') || s.floors >= 3 ? 1 - stage('pyromancy') : 0.35 * (1 - stage('pyromancy'));
    g.grade.uniforms.uAsh.value = ash * 0.6;
    if (Math.random() < dt * 20 * ash) g.particles.spawn(focus.x + (Math.random() - 0.5) * 40, focus.y + 8 + Math.random() * 6, focus.z + (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 0.4, -0.7, 0.2, this.ashCol ||= new THREE.Color('#5a5050'), 0.22, 9, 0, 0.1);
    // Spirits rising from the old graves at night.
    const restless = 1 - stage('necromancy');
    if (night > 0.35 && Math.random() < dt * 10 * restless * night) {
      const x = this.graves.x + (Math.random() - 0.5) * 8, z = this.graves.z + (Math.random() - 0.5) * 8;
      g.particles.spawn(x, heightAt(x, z) + 0.3, z, 0, 0.9, 0, this.soulCol ||= new THREE.Color('#8dffb0'), 0.5, 3, -0.2, 0.3);
    }
    // Aldric's ruin clears once the foundation stands.
    this.rubble.visible = s.floors < 1;
    if (this.staff) this.staff.children.forEach((c) => { if (c.isLight) c.intensity = 5 + Math.sin(t * 2) * 1.5; });
  }
}
