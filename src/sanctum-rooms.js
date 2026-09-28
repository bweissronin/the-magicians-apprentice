import * as THREE from 'three';
import { roomKit } from './interior.js';
import { clay, stoneBlockTexture } from './style.js';
import { runeCircleTexture } from './textures.js';
import { SANCTUMS } from './data.js';

// Walk-in sanctums. Each school's sanctum has one room per raised stage, reached through its
// door in the realm and joined by stairs, using the same interior system as the Arcane tower.
// Every floor has a station:
//   0 mastery    — the school's record (opens the Schools of Magic panel)
//   1 transmute  — turn Mana Essence into the realm's own material
//   2 restore    — refill mana and take a ward against the realm's creatures
//   3 chronicle  — read back the echoes you have heard in this realm
//   4 lookout    — a sweeping view over the realm from the sanctum's crown

const { R, WALL_H, rbox, atWall, shadowAll, staircase, candle, tick, prop } = roomKit;
const TAU = Math.PI * 2;
const STATIONS = ['mastery', 'transmute', 'restore', 'chronicle', 'lookout'];
const M = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const glow = (c, i = 2) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i });
const crystalGeo = (r, h) => new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), new THREE.Vector2(r, h * 0.08), new THREE.Vector2(r, h * 0.7), new THREE.Vector2(0.001, h)], 6);
const tex = (tint, ru, rv) => { const t = stoneBlockTexture(tint).clone(); t.needsUpdate = true; t.repeat.set(ru, rv); return t; };
const STATION = { x: 0, z: -3.4 };        // where you stand to use a floor's station
const CENTER = { x: 0, z: -5.2 };         // where its centerpiece sits

function floorRunes(color, r = 3) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ map: runeCircleTexture(color), transparent: true, depthWrite: false, opacity: 0.8 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.userData.noBlock = true;
  return tick(m, (dt) => { m.rotation.z += dt * 0.1; });
}

// Room shell for a school: floor, back-faced walls (the near wall vanishes so the camera sees
// in), a baseboard, glowing windows and a trim band.
function shellFor(t) {
  return () => {
    const g = new THREE.Group();
    const floor = M(new THREE.CylinderGeometry(R, R, 0.4, 64), clay('#ffffff', { map: tex(t.floor, 5, 5), roughness: t.floorRough ?? 0.7, key: 'sfloor' + t.id }), 0, -0.2, 0);
    floor.receiveShadow = true; g.add(floor);
    const wall = M(new THREE.CylinderGeometry(R, R, WALL_H, 64, 1, true), new THREE.MeshStandardMaterial({ map: tex(t.wall, 10, 1.1), roughness: 0.75, side: THREE.BackSide }), 0, WALL_H / 2, 0);
    wall.receiveShadow = true; g.add(wall);
    g.add(M(new THREE.CylinderGeometry(R - 0.02, R - 0.02, 0.5, 64, 1, true), new THREE.MeshStandardMaterial({ color: t.trim, roughness: 0.6, side: THREE.BackSide }), 0, 0.25, 0));
    g.add(M(new THREE.CylinderGeometry(R - 0.03, R - 0.03, 0.14, 64, 1, true), new THREE.MeshStandardMaterial({ color: t.accent, emissive: t.accent, emissiveIntensity: 0.9, side: THREE.BackSide }), 0, 3.9, 0));
    [-2.2, 2.2, 3.14].forEach((a) => {
      const w = new THREE.Group();
      w.add(M(t.windowGeo(), glow(t.glass, 1.3)));
      w.add(M(rbox(0.1, 1.9, 0.14), clay(t.trim, { key: 'strim' + t.id })));
      g.add(atWall(w, a, 0.08, 3));
    });
    return g;
  };
}
const lancet = () => { const s = new THREE.Shape(); s.moveTo(-0.55, -0.9); s.lineTo(0.55, -0.9); s.lineTo(0.55, 0.4); s.quadraticCurveTo(0.5, 0.85, 0, 1.1); s.quadraticCurveTo(-0.5, 0.85, -0.55, 0.4); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false }); };
const roundWin = () => new THREE.CylinderGeometry(0.75, 0.75, 0.08, 6).rotateX(Math.PI / 2);
const shardWin = () => new THREE.ConeGeometry(0.6, 2.0, 4).rotateY(Math.PI / 4).scale(1, 1, 0.1);

function station(label, sub) { return { x: STATION.x, z: STATION.z, label, sub }; }

// ================================================================ Necromancy: the Titan's Ossuary
const N = { id: 'necromancy', floor: '#4e4a58', wall: '#6d6778', trim: '#3a3644', accent: '#5dff8a', glass: '#5dff8a', windowGeo: lancet };
const bone = () => clay('#e9e0c8', { roughness: 0.72, key: 'titanBone' });
const slateM = () => clay('#4d4659', { roughness: 0.8, key: 'nSlate' });
const soulM = () => glow('#7dff9b', 2.4);

function skullWall(cols, rows, s = 0.26) {
  const g = new THREE.Group();
  g.add(M(rbox(cols * 0.72 + 0.4, rows * 0.72 + 0.4, 0.4, 0.06), clay('#262230', { key: 'nicheDark' }), 0, rows * 0.36 + 0.4, 0));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const sk = prop('skull_small', null);
    if (!sk) continue;
    sk.scale.setScalar(s); sk.position.set((c - (cols - 1) / 2) * 0.72, 0.52 + r * 0.72, 0.22); sk.rotation.y = (Math.random() - 0.5) * 0.4;
    g.add(sk);
  }
  return shadowAll(g);
}
function greenBrazier() {
  const b = new THREE.Group(), iron = clay('#2b2833', { roughness: 0.45, key: 'ironFence' });
  b.add(M(new THREE.CylinderGeometry(0.1, 0.16, 1.2, 8), iron, 0, 0.6, 0));
  b.add(M(new THREE.CylinderGeometry(0.45, 0.25, 0.3, 12), iron, 0, 1.3, 0));
  const f = M(new THREE.ConeGeometry(0.3, 0.8, 8), soulM(), 0, 1.75, 0); f.userData.flicker = true; b.add(f);
  return shadowAll(b);
}
function sarcophagus(bm) {
  const g = new THREE.Group(), st = slateM();
  g.add(M(rbox(1.2, 0.9, 2.4, 0.12), st, 0, 0.45, 0));
  g.add(M(rbox(1.3, 0.2, 2.5, 0.08), clay('#8a8496', { key: 'naveTrim' }), 0, 1.0, 0));
  g.add(M(new THREE.CapsuleGeometry(0.28, 1.2, 4, 10).rotateX(Math.PI / 2), clay('#9a94a6', { key: 'effigy' }), 0, 1.25, 0.05));
  g.add(M(new THREE.SphereGeometry(0.2, 10, 8), clay('#9a94a6', { key: 'effigy' }), 0, 1.3, -0.95));
  return shadowAll(g);
}

const NECRO_ROOMS = [
  { name: 'The Ossuary Crypt', station: 'mastery', build(state, rand, fx) {
    const g = new THREE.Group(), bm = bone();
    [0.7, 1.35, -1.35].forEach((a) => g.add(atWall(skullWall(4, 5), a, 0.35)));
    const altar = new THREE.Group();
    altar.add(M(rbox(2.2, 1.0, 1.2, 0.1), slateM(), 0, 0.5, 0));
    const sk = prop('titan_skull'); if (sk) { sk.scale.setScalar(0.45); sk.position.y = 1.5; altar.add(sk); }
    altar.add(M(new THREE.SphereGeometry(0.14, 10, 8), soulM(), -0.2, 1.62, 0.36)); altar.add(M(new THREE.SphereGeometry(0.14, 10, 8), soulM(), 0.2, 1.62, 0.36));
    altar.position.set(CENTER.x, 0, CENTER.z); g.add(shadowAll(altar));
    [[-3.5, -1], [3.5, -1], [-3.5, 3], [3.5, 3]].forEach(([x, z]) => { const s = sarcophagus(bm); s.position.set(x, 0, z); g.add(s); });
    [[-1.7, -4.6], [1.7, -4.6]].forEach(([x, z]) => { const b = greenBrazier(); b.position.set(x, 0, z); g.add(b); });
    g.add(floorRunes('#5dff8a', 2.4));
    return { group: g, station: station('Read the Ossuary Record', 'Your mastery of Necromancy'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.1 }] };
  } },
  { name: 'The Bone Chapel', station: 'transmute', build(state, rand, fx) {
    const g = new THREE.Group(), bm = bone(), wood = clay('#3a2e24', { key: 'pew' });
    for (let r = 0; r < 3; r++) for (const s of [-1, 1]) {
      const pew = new THREE.Group(); pew.add(M(rbox(2.4, 0.15, 0.6), wood, 0, 0.5, 0)); pew.add(M(rbox(2.4, 0.9, 0.12), wood, 0, 0.8, 0.3));
      pew.position.set(s * 2.4, 0, 0.6 + r * 1.6); g.add(shadowAll(pew));
    }
    const font = new THREE.Group();
    font.add(M(new THREE.CylinderGeometry(0.4, 0.6, 1.0, 10), slateM(), 0, 0.5, 0));
    font.add(M(new THREE.CylinderGeometry(0.95, 0.6, 0.35, 16), slateM(), 0, 1.15, 0));
    const pool = M(new THREE.CircleGeometry(0.82, 24), soulM(), 0, 1.33, 0); pool.rotation.x = -Math.PI / 2; font.add(pool);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; const b = M(new THREE.CapsuleGeometry(0.05, 0.9, 3, 6), bm, Math.sin(a) * 0.72, 1.75, Math.cos(a) * 0.72); b.rotation.set(Math.cos(a) * -0.5, 0, Math.sin(a) * 0.5); font.add(b); }
    font.position.set(CENTER.x, 0, CENTER.z); g.add(shadowAll(font));
    for (let i = 0; i < 5; i++) { const c = candle(i === 2); c.position.set(-1.2 + i * 0.6, 0, -6.3 + (i % 2) * 0.3); c.scale.setScalar(1.4); g.add(c); }
    [0.9, 1.6, -1.6].forEach((a) => { const ch = new THREE.Group(); ch.add(M(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4), clay('#2b2833', { key: 'ironFence' }), 0, 0.8, 0)); ch.add(M(new THREE.SphereGeometry(0.22, 10, 8), soulM())); ch.position.y = 3.4; g.add(atWall(ch, a, 1.4, 3.4)); });
    return { group: g, station: station('Transmutation Font', 'Turn 8 Mana Essence into 6 Grave Bone'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.0 }],
      update(dt, t) { pool.material.emissiveIntensity = 2 + Math.sin(t * 3) * 0.6; if (Math.random() < dt * 8) fx.spawn(CENTER.x + (Math.random() - 0.5), 1.4, CENTER.z + (Math.random() - 0.5), 0, 0.8, 0, new THREE.Color('#9dffb8'), 0.2, 1.5, -0.2, 0.3); } };
  } },
  { name: 'The Well of Souls', station: 'restore', build(state, rand, fx) {
    const g = new THREE.Group(), iron = clay('#2b2833', { roughness: 0.45, key: 'ironFence' });
    const well = new THREE.Group();
    well.add(M(new THREE.LatheGeometry([[1.3, 0], [1.45, 0.9], [1.25, 1.0], [1.1, 0.95], [1.1, -0.5]].map(([r, y]) => new THREE.Vector2(r, y)), 24), slateM()));
    const vortexM = new THREE.MeshBasicMaterial({ map: runeCircleTexture('#7dff9b'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const vortex = M(new THREE.CircleGeometry(1.08, 32), vortexM, 0, 0.7, 0); vortex.rotation.x = -Math.PI / 2; well.add(vortex);
    for (const r of [0, Math.PI / 2]) { const arch = M(new THREE.TorusGeometry(1.35, 0.08, 6, 20, Math.PI), bone(), 0, 0.95, 0); arch.rotation.y = r; well.add(arch); }
    well.position.set(CENTER.x, 0, CENTER.z); g.add(shadowAll(well));
    const ghosts = [];
    for (let i = 0; i < 5; i++) {
      const gh = new THREE.Group(), gm = new THREE.MeshBasicMaterial({ color: '#9dffc0', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
      gh.add(M(new THREE.SphereGeometry(0.3, 12, 8), gm)); gh.add(M(new THREE.ConeGeometry(0.28, 1.2, 10, 1, true).rotateX(-Math.PI / 2), gm, 0, 0, -0.7));
      gh.userData.noBlock = true; g.add(gh); ghosts.push({ gh, ph: i * 1.25, r: 3 + rand() * 2.5 });
    }
    for (let i = 0; i < 6; i++) { const ch = M(new THREE.CylinderGeometry(0.04, 0.04, WALL_H, 4), iron); ch.position.y = WALL_H / 2; g.add(atWall(ch, (i / 6) * TAU + 0.3, 0.5, WALL_H / 2)); }
    return { group: g, station: station('Drink from the Well of Souls', 'Full mana and a ward against spirits'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.5 }],
      update(dt, t) {
        vortex.rotation.z += dt * 1.2;
        ghosts.forEach((o) => { const a = t * 0.4 + o.ph; o.gh.position.set(Math.sin(a) * o.r, 2.2 + Math.sin(t * 1.3 + o.ph) * 0.5, Math.cos(a) * o.r - 1); o.gh.rotation.y = a + Math.PI / 2; });
        if (Math.random() < dt * 14) fx.spawn(CENTER.x + (Math.random() - 0.5) * 1.6, 0.8, CENTER.z + (Math.random() - 0.5) * 1.6, 0, 1.8, 0, new THREE.Color('#7dff9b'), 0.3, 1.8, -0.3, 0.2);
      } };
  } },
  { name: 'The Belfry Stair', station: 'chronicle', build(state, rand, fx) {
    const g = new THREE.Group(), wood = clay('#3a2e24', { key: 'pew' });
    const bellG = new THREE.Group(); const bell = prop('bell');
    if (bell) { bell.scale.setScalar(1.2); bellG.add(bell); }
    bellG.position.set(2.6, 4.6, -2.6); g.add(bellG);
    g.add(M(rbox(0.3, 0.3, 4, 0.05), wood, 2.6, 4.7, -2.6));
    const rope = M(new THREE.CylinderGeometry(0.03, 0.03, 3.6, 5), clay('#8a7a5a', { key: 'rope' }), 2.6, 1.8, -2.6); g.add(rope);
    const lect = new THREE.Group();
    lect.add(M(rbox(0.6, 1.1, 0.5, 0.06), wood, 0, 0.55, 0));
    lect.add(M(rbox(0.9, 0.08, 0.7, 0.03), wood, 0, 1.15, 0.05)); lect.children[1].rotation.x = -0.35;
    const book = M(rbox(0.8, 0.08, 0.55, 0.03), clay('#3a1a1a', { key: 'tome' }), 0, 1.24, 0.06); book.rotation.x = -0.35; lect.add(book);
    lect.add(M(new THREE.SphereGeometry(0.1, 8, 6), soulM(), 0, 1.6, 0));
    lect.position.set(CENTER.x, 0, CENTER.z); g.add(shadowAll(lect));
    [0.8, 1.5].forEach((a) => {
      const shelf = new THREE.Group(); shelf.add(M(rbox(2, 3, 0.5, 0.06), wood, 0, 1.5, 0));
      for (let i = 0; i < 9; i++) shelf.add(M(rbox(0.16, 0.5 + rand() * 0.2, 0.34), clay(['#3a1a1a', '#1a2a3a', '#2a3a1a'][i % 3], { key: 'dustyBook' + (i % 3) }), -0.8 + i * 0.2, 0.55 + (i % 3) * 0.9, 0.12));
      g.add(atWall(shadowAll(shelf), a, 0.35));
    });
    for (let i = 0; i < 4; i++) { const web = M(new THREE.CircleGeometry(0.9, 8, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#cfd8d0', transparent: true, opacity: 0.25, side: THREE.DoubleSide, wireframe: true })); web.position.y = WALL_H - 0.9; web.userData.noBlock = true; g.add(atWall(web, i * 1.6 - 2.4, 0.1, WALL_H - 0.9)); }
    return { group: g, station: station('Chronicle of the Dead', 'The echoes you have heard'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 0.5 }],
      update(dt, t) { bellG.rotation.z = Math.sin(t * 1.2) * 0.08; } };
  } },
  { name: "The Lich's Sanctum", station: 'lookout', build(state, rand, fx) {
    const g = new THREE.Group();
    const throne = prop('throne'); if (throne) { throne.position.set(0, 0, -6.8); g.add(throne); }
    const ped = new THREE.Group();
    ped.add(M(new THREE.CylinderGeometry(0.35, 0.5, 1.2, 8), slateM(), 0, 0.6, 0));
    const gem = M(new THREE.OctahedronGeometry(0.4, 0), glow('#7dff9b', 3), 0, 1.8, 0); gem.scale.y = 1.8; ped.add(gem);
    ped.position.set(CENTER.x, 0, CENTER.z + 1.2); g.add(shadowAll(ped));
    g.add(floorRunes('#7dff9b', 3.6));
    const stones = [];
    for (let i = 0; i < 6; i++) { const ts = M(rbox(0.7, 1.0, 0.18, 0.06), clay('#9a94a6', { key: 'crownStone' })); ts.userData.noBlock = true; g.add(ts); stones.push({ ts, ph: (i / 6) * TAU }); }
    return { group: g, station: station("Step onto the Lich's balcony", 'Look out over the Hollow Crypt'), solid: [{ x: CENTER.x, z: CENTER.z + 1.2, radius: 0.6 }],
      update(dt, t) { gem.rotation.y += dt; gem.position.y = 1.8 + Math.sin(t * 1.5) * 0.12; stones.forEach(({ ts, ph }) => { const a = t * 0.3 + ph; ts.position.set(Math.sin(a) * 5.5, 3.6 + Math.sin(t + ph) * 0.3, Math.cos(a) * 5.5); ts.rotation.y = a; }); } };
  } },
];

// ================================================================ Pyromancy: the Forge-Heart
const P = { id: 'pyromancy', floor: '#3a302e', wall: '#54463f', trim: '#2a2220', accent: '#ff8a3c', glass: '#ff8a3c', windowGeo: roundWin };
const basalt = () => clay('#3a302e', { roughness: 0.82, key: 'fBasalt' });
const brass = () => clay('#d19a3e', { metalness: 0.55, roughness: 0.32, key: 'forgeBrass' });
const fire = () => glow('#ff8a2a', 3);
function flameBowl(s = 1) {
  const b = new THREE.Group();
  b.add(M(new THREE.CylinderGeometry(0.5 * s, 0.3 * s, 0.4 * s, 10), basalt(), 0, 0.9 * s, 0));
  b.add(M(new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 0.9 * s, 8), brass(), 0, 0.45 * s, 0));
  const f = M(new THREE.ConeGeometry(0.35 * s, 0.9 * s, 8), fire(), 0, 1.4 * s, 0); f.userData.flicker = true; b.add(f);
  return shadowAll(b);
}
function gear(r, teeth) {
  const g = new THREE.Group(), br = brass();
  g.add(M(new THREE.TorusGeometry(r * 0.85, r * 0.15, 6, 24), br));
  for (let i = 0; i < teeth; i++) { const a = (i / teeth) * TAU; g.add(M(rbox(r * 0.2, r * 0.3, r * 0.15, 0.02), br, Math.cos(a) * r, Math.sin(a) * r, 0)); g.children.at(-1).rotation.z = a; }
  g.add(M(new THREE.CylinderGeometry(r * 0.2, r * 0.2, r * 0.3, 10).rotateX(Math.PI / 2), br));
  return g;
}
const PYRO_ROOMS = [
  { name: 'The Foundry Floor', station: 'mastery', build(state, rand, fx) {
    const g = new THREE.Group();
    const anv = prop('anvil'); if (anv) { anv.scale.setScalar(1.4); anv.position.set(CENTER.x, 0, CENTER.z); g.add(anv); }
    g.add(M(rbox(0.9, 0.12, 0.2, 0.03), glow('#ffb347', 2.4), CENTER.x, 1.45, CENTER.z));
    const rack = new THREE.Group(), wood = clay('#6a4a30', { key: 'stump' });
    rack.add(M(rbox(3, 0.15, 0.3), wood, 0, 2.2, 0)); for (let i = 0; i < 6; i++) { rack.add(M(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 5), clay('#8a8fa0', { metalness: 0.5, key: 'steel' }), -1.2 + i * 0.48, 1.4, 0.1)); rack.add(M(rbox(0.25, 0.4, 0.05, 0.02), clay('#8a8fa0', { metalness: 0.5, key: 'steel' }), -1.2 + i * 0.48, 0.65, 0.1)); }
    g.add(atWall(shadowAll(rack), 0.9, 0.3));
    [[-2.2, -4.4], [2.2, -4.4], [-3.6, 2.6], [3.6, 2.6]].forEach(([x, z]) => { const b = flameBowl(); b.position.set(x, 0, z); g.add(b); });
    g.add(floorRunes('#ff8a3c', 2.2));
    return { group: g, station: station('Read the Forge Ledger', 'Your mastery of Pyromancy'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 0.9 }] };
  } },
  { name: 'The Crucible Hall', station: 'transmute', build(state, rand, fx) {
    const g = new THREE.Group();
    const cr = prop('crucible'); const piv = new THREE.Group(); if (cr) { cr.scale.setScalar(1.3); piv.add(cr); }
    piv.position.set(CENTER.x, 1.6, CENTER.z); g.add(piv);
    for (const s of [-1, 1]) g.add(shadowAll(M(rbox(0.4, 2.2, 0.4, 0.06), basalt(), CENTER.x + s * 1.4, 1.1, CENTER.z)));
    const mould = M(rbox(1.6, 0.4, 1.0, 0.06), clay('#2e2a33', { key: 'fIron' }), CENTER.x, 0.2, CENTER.z + 1.4); g.add(shadowAll(mould));
    const molten = M(new THREE.PlaneGeometry(1.4, 0.8), glow('#ffb347', 2.6), CENTER.x, 0.42, CENTER.z + 1.4); molten.rotation.x = -Math.PI / 2; g.add(molten);
    for (let i = 0; i < 5; i++) { const ig = M(rbox(0.5, 0.18, 0.25, 0.04), glow('#ffc35a', 0.6), 3.2 + (i % 3) * 0.55, 0.1 + Math.floor(i / 3) * 0.19, -2.5); g.add(ig); }
    return { group: g, station: station('Smelt at the Crucible', 'Turn 8 Mana Essence into 6 Ember Core'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.5 }],
      update(dt, t) { piv.rotation.x = Math.max(0, Math.sin(t * 0.6)) * 0.5; if (Math.random() < dt * 12) fx.spawn(CENTER.x + (Math.random() - 0.5), 0.5, CENTER.z + 1.4, (Math.random() - 0.5), 2, (Math.random() - 0.5), new THREE.Color('#ffb347'), 0.2, 0.8, 5, 0.1); } };
  } },
  { name: 'The Bellows Chamber', station: 'restore', build(state, rand, fx) {
    const g = new THREE.Group();
    const hearth = new THREE.Group();
    hearth.add(M(new THREE.CylinderGeometry(1.4, 1.6, 0.8, 6), basalt(), 0, 0.4, 0));
    const coals = M(new THREE.CircleGeometry(1.2, 6), glow('#ff5a14', 2), 0, 0.82, 0); coals.rotation.x = -Math.PI / 2; hearth.add(coals);
    const f = M(new THREE.ConeGeometry(0.8, 2.2, 10), fire(), 0, 1.8, 0); f.userData.flicker = true; hearth.add(f);
    hearth.position.set(CENTER.x, 0, CENTER.z); g.add(shadowAll(hearth));
    const gears = [];
    [[0.9, 1.2, 12], [1.35, 0.8, 9], [-1.5, 1.0, 10]].forEach(([a, r, n], i) => { const gr = gear(r, n); gr.position.y = 3; g.add(atWall(gr, a, 0.25, 3)); gears.push({ gr, sp: (i % 2 ? -1 : 1) * (1.2 / r) }); });
    const bel = prop('bellows'); const belG = new THREE.Group(); if (bel) { bel.scale.setScalar(1.3); belG.add(bel); }
    belG.position.set(-3, 0.6, -3.2); belG.rotation.y = 0.9; g.add(belG);
    for (let i = 0; i < 3; i++) { const pipe = M(new THREE.CylinderGeometry(0.2, 0.2, WALL_H, 10), brass()); pipe.position.y = WALL_H / 2; g.add(atWall(pipe, 2.0 + i * 0.3, 0.3, WALL_H / 2)); }
    return { group: g, station: station('Warm yourself at the Hearth', 'Full mana and a ward against imps'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.7 }],
      update(dt, t) { gears.forEach(({ gr, sp }) => gr.rotateZ(dt * sp * 0.5)); belG.scale.y = 1 - 0.25 * (Math.sin(t * 1.6) * 0.5 + 0.5); if (Math.random() < dt * 16) fx.spawn(CENTER.x + (Math.random() - 0.5) * 2, 1, CENTER.z + (Math.random() - 0.5) * 2, 0, 2.5, 0, new THREE.Color('#ffb347'), 0.25, 1.2, -0.4, 0.1); } };
  } },
  { name: 'The Magma Archive', station: 'chronicle', build(state, rand, fx) {
    const g = new THREE.Group(), obs = new THREE.MeshStandardMaterial({ color: '#1a1022', roughness: 0.12, metalness: 0.35 });
    [-1.5, -0.9, 0.9, 1.5].forEach((a) => {
      const shelf = new THREE.Group(); shelf.add(M(rbox(2.2, 3.4, 0.5, 0.06), basalt(), 0, 1.7, 0));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { const tab = M(rbox(0.35, 0.6, 0.08, 0.03), obs, -0.75 + c * 0.5, 0.6 + r * 1.05, 0.25); tab.rotation.z = (rand() - 0.5) * 0.2; shelf.add(tab); shelf.add(M(rbox(0.2, 0.04, 0.02), glow('#ff8a3c', 1.8), -0.75 + c * 0.5, 0.7 + r * 1.05, 0.3)); }
      g.add(atWall(shadowAll(shelf), a, 0.35));
    });
    const stone = new THREE.Group(); stone.add(M(rbox(1.4, 2.4, 0.4, 0.1), obs, 0, 1.2, 0));
    stone.add(M(new THREE.PlaneGeometry(0.9, 1.6), new THREE.MeshBasicMaterial({ map: runeCircleTexture('#ff8a3c'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 1.3, 0.21));
    stone.position.set(CENTER.x, 0, CENTER.z); g.add(shadowAll(stone));
    [[-2, -4], [2, -4]].forEach(([x, z]) => { const b = flameBowl(0.8); b.position.set(x, 0, z); g.add(b); });
    return { group: g, station: station('Read the Obsidian Tablets', 'The echoes you have heard'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 0.8 }] };
  } },
  { name: 'The Phoenix Roost', station: 'lookout', build(state, rand, fx) {
    const g = new THREE.Group(), wood = clay('#4a3222', { key: 'hilt' });
    const nest = new THREE.Group();
    for (let i = 0; i < 26; i++) { const a = (i / 26) * TAU, st = M(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 4), wood, Math.sin(a) * 1.1, 0.5 + (i % 3) * 0.12, Math.cos(a) * 1.1); st.rotation.set(Math.cos(a) * 1.2, a, Math.sin(a) * 0.4); nest.add(st); }
    const egg = M(new THREE.SphereGeometry(0.5, 20, 14), glow('#ffb347', 2), 0, 0.9, 0); egg.scale.y = 1.3; nest.add(egg);
    nest.position.set(CENTER.x, 0, CENTER.z + 0.6); g.add(shadowAll(nest));
    const feathers = [];
    for (let i = 0; i < 8; i++) { const f = M(new THREE.ConeGeometry(0.12, 1.0, 5).scale(1, 1, 0.3), glow(i % 2 ? '#ff6a1a' : '#ffe07a', 2.2)); f.userData.noBlock = true; g.add(f); feathers.push({ f, ph: i * 0.8, r: 2 + rand() * 3 }); }
    g.add(floorRunes('#ffb347', 3.2));
    return { group: g, station: station('Climb to the crater rim', 'Look out over the Ember Caldera'), solid: [{ x: CENTER.x, z: CENTER.z + 0.6, radius: 1.3 }],
      update(dt, t) { egg.material.emissiveIntensity = 1.6 + Math.sin(t * 2.2) * 0.6; feathers.forEach(({ f, ph, r }) => { const a = t * 0.5 + ph; f.position.set(Math.sin(a) * r, 2.5 + Math.sin(t + ph) * 0.8, Math.cos(a) * r - 1); f.rotation.set(t + ph, a, 0.5); }); } };
  } },
];

// ================================================================ Cryomancy: the Aurora Spire
const C = { id: 'cryomancy', floor: '#d6ecfa', wall: '#bfe0f5', trim: '#8fb4d4', accent: '#8fe3ff', glass: '#bfefff', windowGeo: shardWin, floorRough: 0.12 };
const iceM = () => new THREE.MeshStandardMaterial({ color: '#bfe9ff', emissive: '#3fa8e8', emissiveIntensity: 0.4, roughness: 0.08, transparent: true, opacity: 0.88, flatShading: true });
function crystalCluster(rand, n, s, mat) {
  const c = new THREE.Group();
  for (let i = 0; i < n; i++) { const m = M(crystalGeo((0.15 + rand() * 0.15) * s, (0.8 + rand() * 1.6) * s), mat, (rand() - 0.5) * 0.8 * s, 0, (rand() - 0.5) * 0.8 * s); m.rotation.set((rand() - 0.5) * 0.6, rand() * 3, (rand() - 0.5) * 0.6); c.add(m); }
  return c;
}
const CRYO_ROOMS = [
  { name: 'The Heart Chamber', station: 'mastery', build(state, rand, fx) {
    const g = new THREE.Group(), ice = iceM();
    const heart = prop('ice_heart') || M(new THREE.IcosahedronGeometry(0.8, 0), ice);
    const hg = new THREE.Group(); heart.scale?.setScalar?.(0.9); hg.add(heart); hg.position.set(CENTER.x, 2.1, CENTER.z); g.add(hg);
    g.add(M(new THREE.CylinderGeometry(0.9, 1.1, 0.6, 8), ice, CENTER.x, 0.3, CENTER.z));
    [0.8, 1.4, -1.4, 2.4, -2.4].forEach((a) => g.add(atWall(crystalCluster(rand, 6, 1.4, ice), a, 0.8)));
    g.add(floorRunes('#8fe3ff', 2.6));
    return { group: g, station: station('Listen to the Frozen Heart', 'Your mastery of Cryomancy'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.1 }],
      update(dt, t) { const b = t % 1.4; hg.scale.setScalar(1 + Math.max(0, Math.sin(Math.min(b, 0.3) / 0.3 * Math.PI)) * 0.08); hg.rotation.y += dt * 0.4; } };
  } },
  { name: 'The Frost Gallery', station: 'transmute', build(state, rand, fx) {
    const g = new THREE.Group(), ice = iceM();
    const font = new THREE.Group();
    font.add(M(new THREE.CylinderGeometry(0.5, 0.7, 1.0, 8), ice, 0, 0.5, 0));
    font.add(M(new THREE.CylinderGeometry(1.0, 0.6, 0.3, 8), ice, 0, 1.15, 0));
    const pool = M(new THREE.CircleGeometry(0.85, 8), glow('#bfefff', 1.6), 0, 1.31, 0); pool.rotation.x = -Math.PI / 2; font.add(pool);
    font.position.set(CENTER.x, 0, CENTER.z); g.add(font);
    for (let i = 0; i < 6; i++) { const statue = new THREE.Group(); statue.add(M(new THREE.ConeGeometry(0.4, 1.8, 8), ice, 0, 1.2, 0)); statue.add(M(new THREE.IcosahedronGeometry(0.25, 0), ice, 0, 2.3, 0)); statue.add(M(new THREE.CylinderGeometry(0.45, 0.5, 0.3, 8), clay('#8fb4d4', { key: 'strimcryomancy' }), 0, 0.15, 0)); g.add(atWall(statue, [-2.5, -1.9, 0.7, 1.3, 1.9, 2.5][i], 1.0)); }
    return { group: g, station: station('Crystallize at the Frost Font', 'Turn 8 Mana Essence into 6 Frost Shard'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.0 }],
      update(dt, t) { if (Math.random() < dt * 8) fx.spawn(CENTER.x + (Math.random() - 0.5), 1.4, CENTER.z + (Math.random() - 0.5), 0, 0.7, 0, new THREE.Color('#dff6ff'), 0.2, 1.5, 0, 0.2); } };
  } },
  { name: 'The Icicle Hall', station: 'restore', build(state, rand, fx) {
    const g = new THREE.Group(), ice = iceM();
    const spring = new THREE.Group();
    spring.add(M(new THREE.CylinderGeometry(1.5, 1.6, 0.4, 10), ice, 0, 0.2, 0));
    const water = M(new THREE.CircleGeometry(1.3, 20), new THREE.MeshStandardMaterial({ color: '#5fb4e8', emissive: '#3fa8e8', emissiveIntensity: 0.8, roughness: 0.05 }), 0, 0.41, 0); water.rotation.x = -Math.PI / 2; spring.add(water);
    spring.add(M(crystalGeo(0.3, 2.4), ice, 0, 0.4, 0));
    spring.position.set(CENTER.x, 0, CENTER.z); g.add(spring);
    for (let i = 0; i < 40; i++) { const a = rand() * TAU, r = 1.5 + rand() * (R - 2.5), ic = M(new THREE.ConeGeometry(0.08 + rand() * 0.1, 0.6 + rand() * 1.6, 5).rotateX(Math.PI), ice, Math.sin(a) * r, WALL_H - 0.4, Math.cos(a) * r); ic.userData.noBlock = true; g.add(ic); }
    return { group: g, station: station('Drink from the Wellspring of Winter', 'Full mana and a ward against wraiths'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.6 }] };
  } },
  { name: 'The Rime Library', station: 'chronicle', build(state, rand, fx) {
    const g = new THREE.Group(), ice = iceM();
    [-1.5, -0.9, 0.9, 1.5].forEach((a) => {
      const shelf = new THREE.Group(); shelf.add(M(rbox(2.2, 3.4, 0.5, 0.06), ice, 0, 1.7, 0));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) shelf.add(M(rbox(0.16, 0.55, 0.32), clay(['#4a6a8a', '#8a5a6a', '#5a7a6a'][c % 3], { key: 'frozenBook' + (c % 3) }), -0.85 + c * 0.24, 0.55 + r * 1.05, 0.05));
      g.add(atWall(shelf, a, 0.35));
    });
    const lect = new THREE.Group(); lect.add(M(crystalGeo(0.3, 1.2), ice, 0, 0, 0)); lect.add(M(rbox(0.8, 0.06, 0.6), clay('#eaf6ff', { key: 'page' }), 0, 1.15, 0));
    lect.position.set(CENTER.x, 0, CENTER.z); g.add(lect);
    return { group: g, station: station('Read the Rime Codex', 'The echoes you have heard'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 0.5 }] };
  } },
  { name: 'The Aurora Observatory', station: 'lookout', build(state, rand, fx) {
    const g = new THREE.Group(), ice = iceM();
    const scope = new THREE.Group();
    scope.add(M(new THREE.CylinderGeometry(0.3, 0.5, 1.2, 8), ice, 0, 0.6, 0));
    const tube = M(new THREE.CylinderGeometry(0.2, 0.35, 2.4, 12), clay('#dfe8f4', { metalness: 0.4, roughness: 0.3, key: 'silverScope' }), 0, 1.8, 0.5); tube.rotation.x = -0.9; scope.add(tube);
    scope.add(M(new THREE.CircleGeometry(0.2, 12), glow('#bfefff', 3), 0, 2.55, 1.45));
    scope.position.set(CENTER.x, 0, CENTER.z); g.add(scope);
    const aur = M(new THREE.TorusGeometry(R - 1.5, 0.6, 6, 64), new THREE.MeshBasicMaterial({ color: '#7affd0', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })); aur.rotation.x = Math.PI / 2; aur.position.y = WALL_H - 0.4; aur.userData.noBlock = true; g.add(aur);
    g.add(floorRunes('#9fffe0', 3.4));
    return { group: g, station: station('Gaze through the Aurora Glass', 'Look out over the Glacial Hollow'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 0.7 }],
      update(dt, t) { aur.material.color.setHSL(0.42 + Math.sin(t * 0.5) * 0.1, 0.9, 0.65); aur.rotation.z += dt * 0.1; } };
  } },
];

// ================================================================ Geomancy: the Heartstone Hold
const G = { id: 'geomancy', floor: '#6a5646', wall: '#8a7058', trim: '#4a3a30', accent: '#ffb347', glass: '#ffb347', windowGeo: roundWin };
const heartG = () => glow('#ffb347', 2.4);
const statueM = () => clay('#a89478', { roughness: 0.8, key: 'gStatue' });
const mineWood = () => clay('#7a5230', { key: 'mineWood' });
function amberCluster(rand, n, s) {
  const c = new THREE.Group(), m = heartG();
  for (let i = 0; i < n; i++) { const k = M(crystalGeo((0.12 + rand() * 0.14) * s, (0.6 + rand() * 1.4) * s), m, (rand() - 0.5) * 0.9 * s, 0, (rand() - 0.5) * 0.9 * s); k.rotation.set((rand() - 0.5) * 0.9, rand() * 3, (rand() - 0.5) * 0.9); c.add(k); }
  c.add(M(new THREE.DodecahedronGeometry(0.45 * s, 0), clay('#5a4a44', { key: 'veinRock' }), 0, 0.1, 0));
  return c;
}
const GEO_ROOMS = [
  { name: 'The Gatehall', station: 'mastery', build(state, rand, fx) {
    const g = new THREE.Group();
    // A heartstone the size of a boulder, set in a ring of standing stones.
    const core = new THREE.Group();
    core.add(M(new THREE.CylinderGeometry(1.1, 1.3, 0.7, 8), clay('#4a3a30', { key: 'strimgeomancy' }), 0, 0.35, 0));
    const hs = M(new THREE.DodecahedronGeometry(0.85, 0), heartG(), 0, 1.6, 0); core.add(hs);
    core.position.set(CENTER.x, 0, CENTER.z); g.add(core);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; const st = M(rbox(0.5, 2 + rand(), 0.4, 0.08), statueM(), CENTER.x + Math.sin(a) * 2.2, 1.1, CENTER.z + Math.cos(a) * 2.2); st.rotation.y = a; g.add(st); }
    [1.1, -1.1, 2.3, -2.3].forEach((a) => g.add(atWall(amberCluster(rand, 7, 1.3), a, 0.8)));
    g.add(floorRunes('#ffb347', 3));
    return { group: g, station: station('Lay your hand on the Heartstone', 'Your mastery of Geomancy'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.3 }],
      update(dt, t) { hs.rotation.y += dt * 0.4; hs.position.y = 1.6 + Math.sin(t * 1.3) * 0.08; } };
  } },
  { name: 'The Ancestor Gallery', station: 'transmute', build(state, rand, fx) {
    const g = new THREE.Group();
    // Carved ancestors line the walls; a stone basin in the middle cuts ore from rock.
    [-2.5, -1.6, 1.6, 2.5].forEach((a) => {
      const st = prop('ancestor_statue');
      let s;
      if (st) { st.scale.setScalar(0.52); s = st; }
      else { s = new THREE.Group(); s.add(M(new THREE.ConeGeometry(0.6, 2.8, 8), statueM(), 0, 1.4, 0)); s.add(M(new THREE.SphereGeometry(0.4, 10, 8), statueM(), 0, 3.0, 0)); }
      g.add(atWall(shadowAll(s), a, 1.0));
    });
    const font = new THREE.Group();
    font.add(M(new THREE.CylinderGeometry(0.6, 0.8, 1.0, 8), statueM(), 0, 0.5, 0));
    font.add(M(new THREE.CylinderGeometry(1.1, 0.7, 0.35, 8), statueM(), 0, 1.15, 0));
    const pool = M(new THREE.CircleGeometry(0.95, 8), heartG(), 0, 1.34, 0); pool.rotation.x = -Math.PI / 2; font.add(pool);
    font.position.set(CENTER.x, 0, CENTER.z); g.add(font);
    return { group: g, station: station('Transmute at the Ore Basin', 'Turn 8 Mana Essence into 6 Heartstone'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.1 }],
      update(dt, t) { if (Math.random() < dt * 8) fx.spawn(CENTER.x + (Math.random() - 0.5), 1.45, CENTER.z + (Math.random() - 0.5), 0, 0.7, 0, new THREE.Color('#ffcf8a'), 0.2, 1.3, 0, 0.2); } };
  } },
  { name: 'The Geode Chamber', station: 'restore', build(state, rand, fx) {
    const g = new THREE.Group(), vm = glow('#c9a8ff', 1.4);
    // The room is the inside of a geode: violet crystal points bristle from every wall.
    for (let i = 0; i < 70; i++) {
      const a = rand() * TAU, y = 0.3 + rand() * (WALL_H - 0.8);
      const c = M(crystalGeo(0.1 + rand() * 0.16, 0.5 + rand() * 1.2), vm, Math.sin(a) * (R - 0.4), y, -Math.cos(a) * (R - 0.4));
      c.lookAt(0, y, 0); c.rotateX(Math.PI / 2); c.userData.noBlock = true; g.add(c);
    }
    const spring = new THREE.Group();
    spring.add(M(new THREE.CylinderGeometry(1.5, 1.6, 0.4, 10), statueM(), 0, 0.2, 0));
    const water = M(new THREE.CircleGeometry(1.3, 20), new THREE.MeshStandardMaterial({ color: '#8a6aff', emissive: '#6a4ad8', emissiveIntensity: 0.9, roughness: 0.05 }), 0, 0.41, 0); water.rotation.x = -Math.PI / 2; spring.add(water);
    spring.add(M(crystalGeo(0.35, 2.6), vm, 0, 0.4, 0));
    spring.position.set(CENTER.x, 0, CENTER.z); g.add(spring);
    const l = new THREE.PointLight('#b48cff', 14, 14, 1.6); l.position.set(0, 3, -3); g.add(l);
    return { group: g, station: station('Drink from the Geode Spring', 'Full mana and a ward against golems'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 1.6 }] };
  } },
  { name: 'The Lift Hall', station: 'chronicle', build(state, rand, fx) {
    const g = new THREE.Group(), wood = mineWood(), iron = clay('#4a4650', { metalness: 0.6, roughness: 0.4, key: 'mineIron' });
    // The winding gear of the Deep Lift turns overhead; ledgers of the mine line the walls.
    const wheel = prop('lift_wheel');
    const wg = new THREE.Group();
    if (wheel) { wheel.scale.setScalar(0.55); wg.add(wheel); } else wg.add(M(new THREE.TorusGeometry(1.6, 0.14, 8, 28), iron));
    wg.position.set(0, WALL_H - 1.6, -R + 1.4); wg.userData.noBlock = true; g.add(wg);
    [-1.5, -0.9, 0.9, 1.5].forEach((a) => {
      const shelf = new THREE.Group(); shelf.add(M(rbox(2.2, 3.2, 0.5, 0.06), wood, 0, 1.6, 0));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) shelf.add(M(rbox(0.16, 0.55, 0.32), clay(['#7a4a2c', '#5a6a4a', '#8a6a3a'][c % 3], { key: 'ledger' + (c % 3) }), -0.85 + c * 0.24, 0.55 + r * 1.0, 0.05));
      g.add(atWall(shadowAll(shelf), a, 0.35));
    });
    const desk = new THREE.Group(); desk.add(M(rbox(1.4, 0.9, 0.8, 0.06), wood, 0, 0.45, 0)); desk.add(M(rbox(0.9, 0.04, 0.6), clay('#efe2c4', { key: 'page' }), 0, 0.92, 0));
    const cart = prop('minecart'); if (cart) { cart.position.set(2.6, 0, -2.2); cart.rotation.y = 0.7; g.add(cart); }
    desk.position.set(CENTER.x, 0, CENTER.z); g.add(shadowAll(desk));
    return { group: g, station: station('Read the Miners\' Ledger', 'The echoes you have heard'), solid: [{ x: CENTER.x, z: CENTER.z, radius: 0.8 }, { x: 2.6, z: -2.2, radius: 0.9 }],
      update(dt) { wg.rotation.z += dt * 0.3; } };
  } },
  { name: 'The Throne of Stone', station: 'lookout', build(state, rand, fx) {
    const g = new THREE.Group();
    // A throne cut from the mountain, crowned with the Mountain King's stones.
    const throne = new THREE.Group();
    throne.add(M(rbox(2.2, 0.8, 1.6, 0.1), statueM(), 0, 0.4, 0));
    throne.add(M(rbox(2.2, 3.4, 0.5, 0.1), statueM(), 0, 1.7, -0.6));
    for (const x of [-1, 1]) throne.add(M(rbox(0.4, 1.2, 1.4, 0.08), statueM(), x, 1.2, 0));
    throne.add(M(new THREE.OctahedronGeometry(0.4), heartG(), 0, 3.7, -0.6));
    throne.position.set(CENTER.x, 0, CENTER.z - 0.6); g.add(shadowAll(throne));
    const crown = prop('king_crown');
    const ring = new THREE.Group();
    if (crown) { crown.scale.setScalar(0.8); ring.add(crown); }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ring.add(M(new THREE.DodecahedronGeometry(0.28, 0), clay('#8a7058', { key: 'gRock' }), Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4)); }
    ring.position.set(CENTER.x, 4.4, CENTER.z - 0.6); ring.userData.noBlock = true; g.add(ring);
    g.add(floorRunes('#ffb347', 3.4));
    return { group: g, station: station('Step onto the Colossus\' brow', 'Look out over the Sundered Deep'), solid: [{ x: CENTER.x, z: CENTER.z - 0.6, radius: 1.3 }],
      update(dt, t) { ring.rotation.y += dt * 0.3; ring.position.y = 4.4 + Math.sin(t) * 0.1; } };
  } },
];

// ---------------------------------------------------------------- definitions
function doorFor(t) {
  return () => {
    const g = new THREE.Group();
    g.add(M(rbox(1.8, 2.7, 0.2, 0.06), clay(t.trim, { key: 'sdoor' + t.id }), 0, 1.35, 0));
    g.add(M(new THREE.TorusGeometry(0.95, 0.12, 8, 20, Math.PI), clay(t.wall, { key: 'sdoorArch' + t.id }), 0, 2.7, 0));
    g.add(M(rbox(0.06, 2.4, 0.22, 0.02), glow(t.accent, 1.6), 0, 1.3, 0.02));
    return shadowAll(g);
  };
}
function decorFor(t, flameColor) {
  return (room, i, state, rand) => {
    // Pillars of the school's stone and sconces with its fire.
    [-2.6, -1.25, 0.6, 1.25, 2.6].forEach((a) => {
      const p = new THREE.Group();
      p.add(M(new THREE.CylinderGeometry(0.3, 0.36, WALL_H - 0.6, t.id === 'cryomancy' ? 6 : 12), t.id === 'cryomancy' ? iceM() : clay(t.trim, { key: 'spil' + t.id }), 0, WALL_H / 2, 0));
      p.add(M(rbox(0.8, 0.3, 0.8, 0.08), clay(t.wall, { key: 'spcap' + t.id }), 0, WALL_H - 0.2, 0));
      room.add(atWall(shadowAll(p), a, 0.35));
    });
    [-1.9, 1.9].forEach((a) => { const s = new THREE.Group(); const f = M(new THREE.ConeGeometry(0.14, 0.4, 8), glow(flameColor, 3), 0, 0.2, 0.3); f.userData.flicker = true; s.add(M(rbox(0.3, 0.5, 0.1), clay(t.trim, { key: 'strim' + t.id })), f); s.position.y = 2.6; room.add(atWall(s, a, 0.12, 2.6)); });
    const l = new THREE.PointLight(flameColor, 10, 14, 1.8); l.position.set(0, 3.2, -4); room.add(l);
  };
}

function towerDef(t, rooms, mood, flameColor, stairsMat) {
  return {
    id: t.id,
    rooms: rooms.map((r, i) => ({ name: r.name, station: STATIONS[i], stationLabel: r.name })),
    builders: rooms.map((r) => r.build),
    floors: (state) => state.sanctumStage(t.id),
    shell: shellFor(t),
    decorate: decorFor(t, flameColor),
    door: doorFor(t),
    stairs: () => staircase(stairsMat(), clay(t.trim, { key: 'sstair' + t.id })),
    exitLabel: `Leave ${SANCTUMS[t.id].name}`, exitSub: 'Back out into the realm',
    padColor: t.accent, padDown: t.accent,
    mood,
  };
}

export const SANCTUM_TOWERS = {
  necromancy: towerDef(N, NECRO_ROOMS, { bg: '#08100c', hemi: ['#b8f0d8', '#1a1420', 0.75], key: '#c8ffe0', warm: '#7dff9b', dust: '#9dffc0' }, '#7dff9b', slateM),
  pyromancy: towerDef(P, PYRO_ROOMS, { bg: '#1a0806', hemi: ['#ffc8a0', '#3a1008', 0.85], key: '#ffd0a0', warm: '#ff8a3c', dust: '#ffb347' }, '#ff8a2a', basalt),
  cryomancy: towerDef(C, CRYO_ROOMS, { bg: '#0a1830', hemi: ['#dff0ff', '#4a5a88', 1.0], key: '#e8f4ff', warm: '#9fe8ff', dust: '#ffffff' }, '#9fe8ff', () => iceM()),
  geomancy: towerDef(G, GEO_ROOMS, { bg: '#140e0a', hemi: ['#ffd9b0', '#2a1e14', 0.9], key: '#ffe0b8', warm: '#ffb347', dust: '#ffd9a0' }, '#ffb347', statueM),
};
