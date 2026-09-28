import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Particles } from './particles.js';
import { clay, stoneBlockTexture, plankTexture, PALETTE } from './style.js';
import { runeCircleTexture } from './textures.js';
import { ROOMS, SHRINES, TOWER_FLOORS } from './data.js';
import { mulberry32 } from './util.js';
import { prop } from './assets.js';
import { stationKey } from './roomguide.js';

// Tower interiors: a separate cosy scene, one furnished room per raised floor.
// Walls render back-faces only, so the wall nearest the camera vanishes ("dollhouse
// cutaway") and the trailing camera can always see into the room.

const R = 9;          // room radius — the tower is bigger on the inside
const WALL_H = 5.2;
const rbox = (w, h, d, r = 0.08) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));

function shadowAll(o) { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }

// Position an object against the wall at angle a (0 = north / -z), facing the room centre.
function atWall(obj, a, inset = 0.6, y = 0) {
  obj.position.set(Math.sin(a) * (R - inset), y, -Math.cos(a) * (R - inset));
  obj.rotation.y = -a;
  obj.userData.wallA = a;
  return obj;
}

// ---------------- Furniture kit ----------------
const M = {};
function mats() {
  if (M.wood) return M;
  M.wood = clay(PALETTE.wood, { roughness: 0.55, key: 'inWood' });
  M.woodDark = clay(PALETTE.woodDark, { roughness: 0.55, key: 'inWoodDark' });
  M.gold = clay('#ffcf5a', { roughness: 0.35, key: 'gold' });
  M.iron = clay('#4a4458', { roughness: 0.4, key: 'inIron' });
  M.paper = clay('#fff4d6', { key: 'pages' });
  M.flame = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ff9a3c', emissiveIntensity: 3 });
  M.bookColors = ['#c0392b', '#2e6fd8', '#2e9b57', '#8a3fc0', '#d98a2b', '#1f8f9a', '#b8456f'].map((c) => clay(c, { roughness: 0.55, key: 'book' + c }));
  return M;
}

function bookshelf(w = 2.4, h = 3.4, rand = Math.random) {
  const lp = prop('bookshelf', [w / 2.3, h / 3.4, 1]); // Blender model, scaled to fit
  if (lp) return lp;
  const g = new THREE.Group();
  const frame = new THREE.Mesh(rbox(w, h, 0.7, 0.1), M.woodDark); frame.position.y = h / 2; g.add(frame);
  const back = new THREE.Mesh(rbox(w - 0.2, h - 0.2, 0.1), M.wood); back.position.set(0, h / 2, 0.3); g.add(back);
  const rows = Math.floor(h / 0.95);
  for (let r = 0; r < rows; r++) {
    const y = 0.25 + r * 0.95;
    const shelf = new THREE.Mesh(rbox(w - 0.15, 0.08, 0.6), M.wood); shelf.position.set(0, y, 0.38); g.add(shelf);
    let x = -w / 2 + 0.2;
    while (x < w / 2 - 0.3) {
      const bw = 0.12 + rand() * 0.1, bh = 0.5 + rand() * 0.25;
      const b = new THREE.Mesh(rbox(bw, bh, 0.42, 0.03), M.bookColors[Math.floor(rand() * M.bookColors.length)]);
      b.position.set(x + bw / 2, y + 0.04 + bh / 2, 0.42);
      if (rand() < 0.12) b.rotation.z = 0.25;
      g.add(b); x += bw + 0.02;
    }
  }
  return shadowAll(g);
}

function table(w = 2.2, d = 1.2, h = 1.0) {
  const lp = prop('table', [w / 2.2, h / 1.0, d / 1.2]);
  if (lp) return lp;
  const g = new THREE.Group();
  const top = new THREE.Mesh(rbox(w, 0.14, d, 0.06), M.wood); top.position.y = h; g.add(top);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const leg = new THREE.Mesh(rbox(0.14, h, 0.14, 0.05), M.woodDark);
    leg.position.set(sx * (w / 2 - 0.15), h / 2, sz * (d / 2 - 0.15)); g.add(leg);
  });
  return shadowAll(g);
}

function candle(lights) {
  const g = new THREE.Group();
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 10), M.paper); wax.position.y = 0.15;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), M.flame); flame.scale.y = 1.8; flame.position.y = 0.36;
  flame.userData.flicker = true;
  g.add(wax, flame);
  if (lights) {
    const l = new THREE.PointLight('#ffb35c', 3, 6, 2); l.position.y = 0.5; l.userData.flicker = true; g.add(l);
  }
  return g;
}

function proceduralLectern() {
  const lectern = new THREE.Group();
  const post = new THREE.Mesh(rbox(0.5, 1.1, 0.5, 0.1), M.woodDark); post.position.y = 0.55;
  const top = new THREE.Mesh(rbox(0.9, 0.1, 0.7, 0.04), M.wood); top.position.y = 1.15; top.rotation.x = -0.3;
  lectern.add(post, top);
  return shadowAll(lectern);
}

function openBook(glow = '#ffe9a8') {
  const g = new THREE.Group();
  [-1, 1].forEach((s) => {
    const page = new THREE.Mesh(rbox(0.36, 0.04, 0.5, 0.02), clay('#fff4d6', { emissive: glow, emissiveIntensity: 0.25, key: 'glowPage' + glow }));
    page.position.x = s * 0.19; page.rotation.z = s * -0.12; g.add(page);
  });
  const cover = new THREE.Mesh(rbox(0.8, 0.03, 0.56, 0.02), M.bookColors[0]); cover.position.y = -0.03; g.add(cover);
  return g;
}

function potion(color, s = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 14, 10), clay(color, { emissive: color, emissiveIntensity: 0.9, roughness: 0.15, key: 'pot' + color }));
  body.position.y = 0.13 * s;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * s, 0.05 * s, 0.12 * s, 8), clay('#dff6ff', { transparent: true, opacity: 0.7, key: 'glassNeck' }));
  neck.position.y = 0.3 * s;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * s, 0.04 * s, 0.05 * s, 8), M.wood); cork.position.y = 0.38 * s;
  g.add(body, neck, cork);
  return g;
}

function rugTexture(colors) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  colors.forEach((col, i) => {
    g.fillStyle = col; g.beginPath(); g.arc(256, 256, 256 - i * (256 / colors.length), 0, Math.PI * 2); g.fill();
  });
  g.strokeStyle = 'rgba(255,230,160,0.7)'; g.lineWidth = 6;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.beginPath(); g.arc(256 + Math.cos(a) * 200, 256 + Math.sin(a) * 200, 14, 0, Math.PI * 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rug(r, colors) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), clay('#ffffff', { map: rugTexture(colors), roughness: 0.9, key: 'rug' + colors.join() }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.receiveShadow = true;
  return m;
}

function pad(color) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.14, 32), clay('#4b3f6b', { roughness: 0.5, key: 'padDark' }));
  base.position.y = 0.07; base.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.05, 8, 40), clay(color, { emissive: color, emissiveIntensity: 0.8, key: 'padRim' + color }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.14;
  base.add(rim);
  // Normal blending so the rune lines read as solid glowing ink on the dark stone.
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), new THREE.MeshBasicMaterial({
    map: runeCircleTexture(color), transparent: true, depthWrite: false,
  }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.14;
  g.add(base, glow);
  g.userData.glow = glow;
  return g;
}

function staircase(m1 = M.wood, m2 = M.woodDark) {
  // Short spiral of steps climbing along the wall.
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = -0.5 + i * 0.13;
    const s = new THREE.Mesh(rbox(1.6, 0.35 + i * 0.35, 0.9, 0.08), i % 2 ? m1 : m2);
    s.position.set(Math.sin(a) * (R - 1.2), (0.35 + i * 0.35) / 2, -Math.cos(a) * (R - 1.2));
    s.rotation.y = -a;
    g.add(s);
  }
  return shadowAll(g);
}

function archDoor(color = '#8a4f28') {
  const g = new THREE.Group();
  const door = new THREE.Mesh(rbox(1.8, 2.6, 0.2, 0.06), clay(color, { map: plankTexture('#a7652f'), key: 'doorPlank' }));
  door.position.y = 1.3;
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.12, 8, 20, Math.PI), M.woodDark); arch.position.y = 2.6;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), M.gold); knob.position.set(0.6, 1.3, 0.14);
  g.add(door, arch, knob);
  return shadowAll(g);
}

function windowPane(color = '#9fd8ff') {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(rbox(1.1, 1.8, 0.1, 0.05), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 }));
  const frameV = new THREE.Mesh(rbox(0.1, 1.9, 0.16), M.wood);
  const frameH = new THREE.Mesh(rbox(1.2, 0.1, 0.16), M.wood);
  g.add(glass, frameV, frameH);
  return g;
}

// ---------------- Room builders (return { group, station, update }) ----------------
// The Sigil cabinet stands on the west wall: the north wall is taken by the stairs up, which
// would otherwise climb right across its front. Kept below the wall sconce above it.
const TROPHY_A = -1.62;
function buildTrophies(state, rand, fx) {
  const g = new THREE.Group();
  const cabinet = new THREE.Group();
  const back = new THREE.Mesh(rbox(5, 2.4, 0.5, 0.12), M.woodDark); back.position.y = 1.2; cabinet.add(back);
  const shelf = new THREE.Mesh(rbox(5.2, 0.2, 1.2, 0.08), M.wood); shelf.position.set(0, 1.2, 0.4); cabinet.add(shelf);
  const sigils = [];
  SHRINES.forEach((s, i) => {
    const x = -2 + i;
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.3, 16), M.gold); plinth.position.set(x, 1.45, 0.45);
    cabinet.add(plinth);
    const solved = state.shrines.includes(s.id);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({
      color: solved ? s.color : '#554c66', emissive: solved ? s.color : '#000000', emissiveIntensity: solved ? 1.8 : 0, roughness: 0.2,
      transparent: !solved, opacity: solved ? 1 : 0.35,
    }));
    gem.position.set(x, 1.95, 0.45); gem.scale.y = 1.4;
    cabinet.add(gem); if (solved) sigils.push(gem);
  });
  g.add(shadowAll(atWall(cabinet, TROPHY_A, 0.5)));
  // Banners and plants.
  [-0.9, 0.9].forEach((a, i) => {
    const banner = new THREE.Mesh(rbox(1.2, 2.4, 0.06, 0.05), clay(i ? '#3f5fd8' : '#d9425f', { key: 'banner' + i }));
    banner.position.y = 3; g.add(atWall(banner, a, 0.25, 3));
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), M.gold); star.position.y = 3.2;
    g.add(atWall(star, a, 0.18, 3.2));
  });
  return {
    group: g,
    station: { x: Math.sin(TROPHY_A) * (R - 2.4), z: -Math.cos(TROPHY_A) * (R - 2.4), label: `${ROOMS[0].stationLabel}`, sub: `${state.shrines.length} of ${SHRINES.length} awakened` },
    update(dt, t) { sigils.forEach((s, i) => { s.rotation.y += dt; s.position.y = 1.95 + Math.sin(t * 2 + i) * 0.06; }); },
  };
}

// A cork board of parchment sketches, one per creature the apprentice has met.
function sketchBoard(state) {
  const g = new THREE.Group();
  const c = document.createElement('canvas'); c.width = 512; c.height = 320;
  const x = c.getContext('2d');
  x.fillStyle = '#7a5a3a'; x.fillRect(0, 0, 512, 320);
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(${40 + Math.random() * 40},${25 + Math.random() * 20},10,0.25)`; x.fillRect(Math.random() * 512, Math.random() * 320, 3, 3); }
  const kinds = ['shade', 'specter', 'golem', 'wraith', 'imp'];
  kinds.forEach((k, i) => {
    const px = 24 + (i % 3) * 164 + (i >= 3 ? 82 : 0), py = i < 3 ? 18 : 166, seen = state.bestiary?.[k]?.seen;
    x.save(); x.translate(px + 66, py + 66); x.rotate((i % 2 ? 1 : -1) * 0.05); x.translate(-66, -66);
    x.fillStyle = seen ? '#efe2c4' : '#cdbf9e'; x.fillRect(0, 0, 132, 136);
    x.strokeStyle = seen ? '#4a3520' : 'rgba(74,53,32,0.35)'; x.lineWidth = 3; x.beginPath();
    if (k === 'golem') { x.rect(40, 20, 52, 26); x.rect(28, 50, 76, 46); x.rect(38, 96, 18, 30); x.rect(76, 96, 18, 30); }
    else if (k === 'imp') { x.arc(66, 56, 26, 0, Math.PI * 2); x.moveTo(46, 36); x.lineTo(38, 14); x.moveTo(86, 36); x.lineTo(94, 14); x.moveTo(50, 84); x.lineTo(56, 122); x.lineTo(76, 122); x.lineTo(82, 84); }
    else { x.moveTo(66, 16); x.bezierCurveTo(100, 18, 104, 60, 100, 110); x.lineTo(84, 98); x.lineTo(66, 124); x.lineTo(48, 98); x.lineTo(32, 110); x.bezierCurveTo(28, 60, 32, 18, 66, 16); }
    x.stroke();
    x.fillStyle = seen ? '#4a3520' : 'rgba(74,53,32,0.4)'; x.font = 'italic 15px serif'; x.textAlign = 'center';
    x.fillText(seen ? { shade: 'wisp', specter: 'spirit', golem: 'golem', wraith: 'wraith', imp: 'imp' }[k] : '?', 66, 130);
    x.fillStyle = '#c0392b'; x.beginPath(); x.arc(66, 8, 6, 0, Math.PI * 2); x.fill();
    x.restore();
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  board.position.z = 0.03; g.add(board);
  const frame = new THREE.Mesh(rbox(2.56, 1.66, 0.06, 0.02), M.woodDark); g.add(frame);
  shadowAll(g);
  return g;
}

function buildStudy(state, rand, fx) {
  const g = new THREE.Group();
  const desk = prop('desk') || table(2.6, 1.3); g.add(atWall(desk, -0.22, 2.4)); // north wall, clear of the stairs
  const book = openBook(); book.position.set(0.2, 1.1, 0); desk.add(book);
  const c1 = candle(true); c1.position.set(-0.9, 1.07, -0.3); desk.add(c1);
  let chair = prop('chair');
  if (!chair) {
    chair = new THREE.Group();
    const seat = new THREE.Mesh(rbox(0.8, 0.12, 0.8), M.wood); seat.position.y = 0.6; chair.add(seat);
    const backr = new THREE.Mesh(rbox(0.8, 1.0, 0.12), M.wood); backr.position.set(0, 1.1, -0.35); chair.add(backr);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => { const l = new THREE.Mesh(rbox(0.1, 0.6, 0.1), M.woodDark); l.position.set(x * 0.33, 0.3, z * 0.33); chair.add(l); });
    shadowAll(chair);
  }
  chair.position.set(-1.1, 0, -4.6); chair.rotation.y = Math.PI + 0.2; g.add(chair); // tucked in at the desk
  [0.5, 1.0].forEach((a) => g.add(atWall(bookshelf(2.2, 3.4, rand), a, 0.45)));
  // Globe.
  const globe = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.3, 1.0, 10), M.woodDark); stand.position.y = 0.5;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), clay('#4aa3df', { key: 'globe' })); ball.position.y = 1.4;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 6, 32), M.gold); ring.position.y = 1.4; ring.rotation.x = 1.2;
  globe.add(stand, ball, ring); shadowAll(globe);
  globe.position.set(4.2, 0, -3.5); g.add(globe);
  // Station: a lectern with the floating Spell Tome.
  // The bestiary: Aldric's creature journal on a second lectern, with sketches pinned beside it.
  const beastL = prop('lectern') || proceduralLectern();
  const bb = openBook('#ffd9a0'); bb.position.set(0, 1.24, 0.02); bb.rotation.x = -0.31; beastL.add(bb);
  beastL.position.set(-4.3, 0, -1.2); beastL.rotation.y = 0.9; g.add(beastL);
  g.add(atWall(sketchBoard(state), -1.05, 0.12, 2.1));
  const lectern = prop('lectern') || proceduralLectern();
  const tome = openBook('#9fe8ff'); tome.position.y = 1.75; lectern.add(tome);
  const tl = new THREE.PointLight('#8fd8ff', 6, 7, 2); tl.position.y = 1.9; lectern.add(tl);
  lectern.position.set(0, 0, -3.5); g.add(lectern);
  return {
    group: g,
    station: { x: 0, z: -2.6, label: ROOMS[1].stationLabel, sub: 'Upgrade your spells and learn attunements' },
    stations: [{ x: -3.4, z: -0.5, label: 'Read the Bestiary', sub: "Aldric's journal of creatures", station: 'bestiary' }],
    solid: [{ x: 0, z: -3.5, radius: 0.5 }, { x: 4.2, z: -3.5, radius: 0.5 }, { x: -4.3, z: -1.2, radius: 0.5 }],
    update(dt, t) {
      tome.position.y = 1.75 + Math.sin(t * 1.8) * 0.12; tome.rotation.y += dt * 0.6;
      globe.children[1].rotation.y += dt * 0.4;
      if (Math.random() < dt * 6) fx.spawn(tome.getWorldPosition(new THREE.Vector3()).x + (Math.random() - 0.5) * 0.6, 1.9, -3.5 + (Math.random() - 0.5) * 0.6, 0, 0.6, 0, new THREE.Color('#9fe8ff'), 0.2, 1.2, 0, 0.3);
    },
  };
}

function buildLibrary(state, rand, fx) {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = -1.4 + i * 0.47;
    g.add(atWall(bookshelf(2.3, 4.2, rand), a, 0.45));
  }
  const ladder = new THREE.Group();
  [-0.3, 0.3].forEach((x) => { const r = new THREE.Mesh(rbox(0.08, 4, 0.08), M.wood); r.position.set(x, 2, 0); ladder.add(r); });
  for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(rbox(0.6, 0.06, 0.08), M.wood); s.position.y = 0.4 + i * 0.52; ladder.add(s); }
  shadowAll(ladder); ladder.rotation.x = -0.2; g.add(atWall(ladder, 0.25, 1.5));
  // Armchair.
  let arm = prop('armchair');
  if (!arm) {
    arm = new THREE.Group();
    const base = new THREE.Mesh(rbox(1.4, 0.6, 1.2, 0.25), clay('#b8456f', { key: 'velvet' })); base.position.y = 0.4;
    const backr = new THREE.Mesh(rbox(1.4, 1.2, 0.35, 0.2), clay('#b8456f', { key: 'velvet' })); backr.position.set(0, 1.0, -0.45);
    arm.add(base, backr); shadowAll(arm);
  } arm.position.set(-3.8, 0, -0.9); arm.rotation.y = 0.8; g.add(arm);
  // Floating books circling the lectern.
  const orbit = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(rbox(0.35, 0.5, 0.12, 0.03), M.bookColors[i % M.bookColors.length]);
    const a = (i / 6) * Math.PI * 2; b.position.set(Math.cos(a) * 1.6, 2.6 + (i % 2) * 0.4, Math.sin(a) * 1.6); b.rotation.y = -a;
    b.castShadow = true; orbit.add(b);
  }
  orbit.position.set(0, 0, -2.5); g.add(orbit);
  const lectern = prop('lectern') || proceduralLectern();
  const book = openBook('#ffd36b'); book.position.set(0, 1.24, 0.02); book.rotation.x = -0.31;
  lectern.add(book); lectern.position.set(0, 0, -2.5); g.add(lectern);
  const c = candle(true); c.position.set(0.5, 1.2, -2.3); g.add(c);
  return {
    group: g,
    station: { x: 0, z: -1.6, label: ROOMS[2].stationLabel, sub: 'Puzzle hints and lore' },
    solid: [{ x: 0, z: -2.5, radius: 0.5 }],
    update(dt, t) { orbit.rotation.y += dt * 0.35; orbit.children.forEach((b, i) => { b.position.y = 2.6 + (i % 2) * 0.4 + Math.sin(t * 1.5 + i) * 0.15; }); },
  };
}

function buildAlchemy(state, rand, fx) {
  const g = new THREE.Group();
  // Cauldron.
  const cauldron = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0.2], [0.9, 0.3], [1.15, 0.8], [1.0, 1.35], [0.95, 1.4], [0.85, 1.3]].map(([r, y]) => new THREE.Vector2(r, y)), 32), M.iron);
  const brew = new THREE.Mesh(new THREE.CircleGeometry(0.92, 32), new THREE.MeshStandardMaterial({ color: '#5fd87e', emissive: '#2fb85a', emissiveIntensity: 0.8, roughness: 0.2 }));
  brew.rotation.x = -Math.PI / 2; brew.position.y = 1.25;
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 8), M.flame); fire.position.y = 0.2; fire.userData.flicker = true;
  const potModel = prop('cauldron');
  if (potModel) cauldron.add(potModel);
  else {
    [0, 1, 2].forEach((i) => { const leg = new THREE.Mesh(rbox(0.15, 0.4, 0.15), M.iron); const a = (i / 3) * Math.PI * 2; leg.position.set(Math.cos(a) * 0.8, 0.15, Math.sin(a) * 0.8); cauldron.add(leg); });
    cauldron.add(pot);
  }
  cauldron.add(brew, fire); shadowAll(cauldron);
  const glow = new THREE.PointLight('#5dff8a', 5, 9, 2); glow.position.y = 2; cauldron.add(glow);
  cauldron.position.set(0, 0, -2.2); g.add(cauldron);
  // Potion shelves.
  const colors = ['#7fe3ff', '#ffd36b', '#7dff9b', '#c58bff', '#ff7f8a'];
  [-0.6, 0.6].forEach((a) => {
    const model = prop('potionShelf');
    const shelf = model || new THREE.Group();
    if (!model) { const back = new THREE.Mesh(rbox(2.6, 2.6, 0.4, 0.1), M.woodDark); back.position.y = 1.3; shelf.add(back); }
    [0.7, 1.6].forEach((y) => {
      if (!model) { const board = new THREE.Mesh(rbox(2.6, 0.08, 0.6), M.wood); board.position.set(0, y, 0.3); shelf.add(board); }
      for (let i = 0; i < 5; i++) { const p = potion(colors[(i + (y > 1 ? 2 : 0)) % 5], 0.9 + rand() * 0.4); p.position.set(-1 + i * 0.5, y + 0.04, 0.35); shelf.add(p); }
    });
    g.add(shadowAll(atWall(shelf, a, 0.35)));
  });
  const bench = table(2.2, 1.0); bench.position.set(4, 0, 2); bench.rotation.y = -1.2; g.add(bench);
  for (let i = 0; i < 3; i++) { const p = potion(colors[i + 1], 1.1); p.position.set(-0.6 + i * 0.6, 1.07, 0); bench.add(p); }
  return {
    group: g,
    station: { x: 0, z: -0.6, label: ROOMS[3].stationLabel, sub: 'Brew potions from essence' },
    solid: [{ x: 0, z: -2.2, radius: 1.3 }],
    update(dt, t) {
      brew.material.emissiveIntensity = 0.75 + Math.sin(t * 3) * 0.15;
      glow.intensity = 4.5 + Math.sin(t * 5) * 1;
      if (Math.random() < dt * 25) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.7;
        fx.spawn(Math.cos(a) * r, 1.3, -2.2 + Math.sin(a) * r, 0, 0.8 + Math.random(), 0, new THREE.Color('#7dff9b'), 0.25 + Math.random() * 0.2, 1.2, -0.2, 0.3);
      }
    },
  };
}

function buildObservatory(state, rand, fx) {
  const g = new THREE.Group();
  const starRug = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
    x.fillStyle = '#1b2350'; x.beginPath(); x.arc(256, 256, 256, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffe9a8';
    for (let i = 0; i < 90; i++) { const r = Math.random() * 230, a = Math.random() * 6.28; x.beginPath(); x.arc(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 1 + Math.random() * 3, 0, 6.28); x.fill(); }
    x.strokeStyle = 'rgba(255,211,107,0.6)'; x.lineWidth = 3; x.beginPath(); x.arc(256, 256, 200, 0, 6.28); x.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const r = new THREE.Mesh(new THREE.CircleGeometry(4, 48), clay('#ffffff', { map: starRug, roughness: 0.8, key: 'starRug' }));
  r.rotation.x = -Math.PI / 2; r.position.y = 0.025; g.add(r);
  // Telescope on a tripod.
  const scopeModel = prop('telescope');
  const scope = scopeModel || new THREE.Group();
  if (scopeModel) scope.rotation.y = Math.PI; // aim the tube up and away, toward the far windows
  if (!scopeModel) [0, 1, 2].forEach((i) => { const leg = new THREE.Mesh(rbox(0.12, 2.2, 0.12), M.woodDark); const a = (i / 3) * Math.PI * 2; leg.position.set(Math.cos(a) * 0.5, 1.0, Math.sin(a) * 0.5); leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); scope.add(leg); });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 3.2, 20), M.gold); tube.position.y = 2.6; tube.rotation.x = -0.9;
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.29, 20), new THREE.MeshStandardMaterial({ color: '#bfe8ff', emissive: '#8fd8ff', emissiveIntensity: 2 }));
  lens.position.set(0, 3.55, -1.25); lens.rotation.x = -0.9 - Math.PI / 2;
  if (!scopeModel) scope.add(tube, lens);
  shadowAll(scope); scope.position.set(0, 0, -2.3); g.add(scope);
  // Orrery.
  const orrery = new THREE.Group();
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshStandardMaterial({ color: '#ffd36b', emissive: '#ffb030', emissiveIntensity: 2 }));
  orrery.add(sun);
  const planets = [];
  [0.8, 1.2, 1.6].forEach((rad, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.02, 4, 48), M.gold); ring.rotation.x = Math.PI / 2; orrery.add(ring);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.1 + i * 0.03, 12, 8), clay(['#7fe3ff', '#ff7f8a', '#7dff9b'][i], { key: 'planet' + i }));
    p.userData = { rad, speed: 1.2 - i * 0.3 }; orrery.add(p); planets.push(p);
  });
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.35, 1.2, 10), M.woodDark); stand.position.y = -0.7; orrery.add(stand);
  orrery.position.set(4.5, 1.3, 2.5); g.add(shadowAll(orrery));
  [0.6, -0.6].forEach((a) => g.add(atWall(bookshelf(2.2, 3.0, rand), a, 0.45)));
  return {
    group: g,
    station: { x: 0, z: 0.2, label: ROOMS[4].stationLabel, sub: 'Fast travel to awakened shrines' },
    solid: [{ x: 0, z: -2.3, radius: 0.8 }, { x: 4.5, z: 2.5, radius: 0.6 }],
    update(dt, t) { planets.forEach((p) => { const a = t * p.userData.speed; p.position.set(Math.cos(a) * p.userData.rad, 0, Math.sin(a) * p.userData.rad); }); },
  };
}

function buildSpire(state, rand, fx) {
  const g = new THREE.Group();
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 1.0, 32), clay('#c9a86a', { roughness: 0.45, key: 'spirePlinth' })); plinth.position.y = 0.5;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffd36b', emissiveIntensity: 1.6, roughness: 0.1 }));
  crystal.scale.set(0.8, 1.6, 0.8); crystal.position.y = 2.8;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 8, 48), new THREE.MeshStandardMaterial({ color: '#ffe9a8', emissive: '#ffe9a8', emissiveIntensity: 2 }));
  halo.position.y = 2.8; halo.rotation.x = Math.PI / 2;
  const light = new THREE.PointLight('#ffd36b', 6, 12, 2); light.position.y = 2.8;
  g.add(shadowAll(plinth), crystal, halo, light);
  const balcony = archDoor('#6b3fc0'); g.add(atWall(balcony, 0, 0.2));
  return {
    group: g,
    station: { x: 0, z: -(R - 2), label: ROOMS[5].stationLabel, sub: 'Take in the view' },
    solid: [{ x: 0, z: 0, radius: 1.6 }],
    update(dt, t) {
      crystal.rotation.y += dt * 0.8; crystal.position.y = 2.8 + Math.sin(t * 1.5) * 0.2;
      halo.rotation.z += dt * 0.5;
      if (Math.random() < dt * 10) fx.spawn((Math.random() - 0.5) * 3, 1.2, (Math.random() - 0.5) * 3, 0, 1.2, 0, new THREE.Color('#ffe9a8'), 0.3, 2, 0, 0.2);
    },
  };
}


// =====================================================================
// Decor kit: shared atmosphere + signature details for each room.
// Objects may carry userData.tick(dt, t) for animation; Interior.update calls them.
// =====================================================================
const tick = (obj, fn) => { obj.userData.tick = fn; return obj; };

// A four-pointed sparkle hung over stations the apprentice hasn't tried yet.
function sparkleTexture() {
  if (M.sparkTex) return M.sparkTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const halo = g.createRadialGradient(64, 64, 0, 64, 64, 60);
  halo.addColorStop(0, 'rgba(255,230,150,0.55)'); halo.addColorStop(1, 'rgba(255,200,90,0)');
  g.fillStyle = halo; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff6d8';
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 9 : 50; g.lineTo(64 + Math.sin(a) * r, 64 - Math.cos(a) * r); }
  g.fill();
  M.sparkTex = new THREE.CanvasTexture(c); M.sparkTex.colorSpace = THREE.SRGBColorSpace;
  return M.sparkTex;
}
function sparkle() {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkleTexture(), transparent: true, depthWrite: false, fog: false }));
  sp.scale.setScalar(0.7);
  return sp;
}

function glowTexture() {
  if (M.glowTex) return M.glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,240,200,0.9)'); grd.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  M.glowTex = new THREE.CanvasTexture(c);
  return M.glowTex;
}

function sconce() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(rbox(0.35, 0.6, 0.1, 0.05), M.woodDark);
  const arm = new THREE.Mesh(rbox(0.08, 0.08, 0.45, 0.03), M.gold); arm.position.set(0, -0.1, 0.22);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.07, 0.1, 12), M.gold); cup.position.set(0, -0.05, 0.42);
  const c = candle(false); c.position.set(0, 0, 0.42); c.scale.setScalar(0.9);
  g.add(plate, arm, cup, c);
  return shadowAll(g);
}

// Candles hovering in mid-air, bobbing gently (the room has no ceiling to hang from).
function floatingCandles(n, radius, height, rand) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const c = candle(false);
    const a = rand() * Math.PI * 2, r = radius * (0.35 + rand() * 0.65);
    c.position.set(Math.cos(a) * r, height + rand() * 1.2, Math.sin(a) * r);
    const ph = rand() * 6;
    tick(c, (dt, t) => { c.position.y += Math.sin(t * 1.3 + ph) * 0.002; c.rotation.z = Math.sin(t + ph) * 0.05; });
    g.add(c);
  }
  return g;
}

// A soft beam of daylight slanting in from a window onto the floor.
function lightShaft(color = '#fff2cc') {
  const mat = new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 5.2), mat);
  m.position.set(0, 2.2, 1.6); m.rotation.x = -0.62;
  const g = new THREE.Group(); g.add(m);
  g.userData.noBlock = true; // light has no body
  return g;
}

function pillar() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, WALL_H - 0.6, 16), clay('#e8dcc4', { key: 'pillar' }));
  shaft.position.y = WALL_H / 2;
  const base = new THREE.Mesh(rbox(0.9, 0.35, 0.9, 0.1), clay('#d6c7aa', { key: 'pillarCap' })); base.position.y = 0.17;
  const cap = base.clone(); cap.position.y = WALL_H - 0.2;
  g.add(shaft, base, cap);
  return shadowAll(g);
}

function plant(rand, big = false) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0], [0.28, 0], [0.36, 0.45], [0.4, 0.5], [0.001, 0.5]].map(([r, y]) => new THREE.Vector2(r, y)), 18), clay('#c9683f', { key: 'potClay' }));
  g.add(pot);
  const leaf = clay('#5fb33b', { rim: 0.35, key: 'plantLeaf' });
  const n = big ? 7 : 5;
  for (let i = 0; i < n; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), leaf);
    const a = (i / n) * Math.PI * 2;
    l.scale.set(0.55, big ? 2.2 : 1.4, 0.35);
    l.position.set(Math.cos(a) * 0.15, 0.7 + (big ? 0.3 : 0), Math.sin(a) * 0.15);
    l.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
    g.add(l);
  }
  const ph = rand() * 6;
  tick(g, (dt, t) => { g.rotation.z = Math.sin(t * 0.8 + ph) * 0.02; });
  return shadowAll(g);
}

function bookPile(rand, n = 4) {
  const g = new THREE.Group();
  let y = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.12 + rand() * 0.08;
    const b = new THREE.Mesh(rbox(0.6 + rand() * 0.2, h, 0.45, 0.03), M.bookColors[Math.floor(rand() * M.bookColors.length)]);
    b.position.y = y + h / 2; b.rotation.y = (rand() - 0.5) * 0.6; y += h; g.add(b);
  }
  return shadowAll(g);
}

function scroll(rand) {
  const g = new THREE.Group();
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.55, 12), M.paper); roll.rotation.z = Math.PI / 2;
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.015, 6, 12), clay('#c0392b', { key: 'ribbon' })); tie.rotation.y = Math.PI / 2;
  g.add(roll, tie); g.position.y = 0.07; g.rotation.y = rand() * 6;
  return shadowAll(g);
}

function chest() {
  const lp = prop('chest'); if (lp) return lp;
  const g = new THREE.Group();
  const box = new THREE.Mesh(rbox(1.2, 0.6, 0.75, 0.08), clay('#a7652f', { map: plankTexture('#a7652f'), key: 'chestWood' })); box.position.y = 0.3;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.375, 0.375, 1.2, 16, 1, false, 0, Math.PI), clay('#8a4f28', { key: 'chestLid' }));
  lid.rotation.z = Math.PI / 2; lid.position.y = 0.6;
  [-0.4, 0.4].forEach((x) => { const band = new THREE.Mesh(rbox(0.1, 0.62, 0.78, 0.03), M.gold); band.position.set(x, 0.31, 0); g.add(band); });
  const lock = new THREE.Mesh(rbox(0.16, 0.2, 0.06, 0.03), M.gold); lock.position.set(0, 0.5, 0.39);
  g.add(box, lid, lock);
  return shadowAll(g);
}

// Framed portrait: painted canvas of a little wizard silhouette and a starry backdrop.
function portrait(bg, robe) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 128, 160);
  x.fillStyle = 'rgba(255,240,180,0.8)';
  for (let i = 0; i < 14; i++) { x.beginPath(); x.arc(Math.random() * 128, Math.random() * 70, 1.5, 0, 6.3); x.fill(); }
  x.fillStyle = robe; x.beginPath(); x.moveTo(34, 160); x.lineTo(64, 70); x.lineTo(94, 160); x.fill();
  x.fillStyle = '#f6c7a0'; x.beginPath(); x.arc(64, 78, 14, 0, 6.3); x.fill();
  x.fillStyle = robe; x.beginPath(); x.moveTo(44, 70); x.lineTo(64, 18); x.lineTo(84, 70); x.fill();
  x.fillStyle = '#fbfbff'; x.beginPath(); x.moveTo(54, 86); x.lineTo(64, 116); x.lineTo(74, 86); x.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group();
  const frame = new THREE.Mesh(rbox(1.25, 1.55, 0.1, 0.05), M.gold);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  art.position.z = 0.06;
  g.add(frame, art);
  return g;
}

function fireplace(fx) {
  const model = prop('fireplace');
  const g = model || new THREE.Group();
  const fz = model ? 0.12 : 0.55; // flames sit inside the Blender firebox
  if (!model) {
    const stone = clay('#cdbd9f', { key: 'hearthStone' });
    const body = new THREE.Mesh(rbox(3.0, 2.4, 1.0, 0.15), stone); body.position.y = 1.2;
    const mantel = new THREE.Mesh(rbox(3.4, 0.25, 1.2, 0.08), M.woodDark); mantel.position.y = 2.45;
    const mouth = new THREE.Mesh(rbox(1.8, 1.3, 0.3, 0.1), clay('#2a1d1a', { key: 'soot' })); mouth.position.set(0, 0.75, 0.4);
    g.add(body, mantel, mouth);
  }
  const logs = new THREE.Group();
  [-0.3, 0.3].forEach((x, i) => { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), M.woodDark); l.rotation.z = Math.PI / 2; l.rotation.y = i ? 0.4 : -0.4; l.position.set(x * 0.3, 0.25, fz); logs.add(l); });
  const flames = [];
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.2 - i * 0.03, 0.7 - i * 0.1, 8), new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: ['#ff7a2a', '#ffa23c', '#ffd36b'][i], emissiveIntensity: 2.5 }));
    f.position.set((i - 1) * 0.22, 0.6, fz); flames.push(f); g.add(f);
  }
  const light = new THREE.PointLight('#ff8a3c', 8, 9, 2); light.position.set(0, 1, 1.2);
  // Mantel ornaments.
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), M.paper); clockFace.position.set(0, 2.85, 0.35);
  const clockBody = new THREE.Mesh(rbox(0.6, 0.6, 0.3, 0.1), M.wood); clockBody.position.set(0, 2.85, 0.18);
  g.add(logs, light, clockBody, clockFace);
  [-1.2, 1.2].forEach((x) => { const c = candle(false); c.position.set(x, 2.58, 0.2); g.add(c); });
  shadowAll(g);
  return tick(g, (dt, t) => {
    flames.forEach((f, i) => { f.scale.y = 0.85 + Math.sin(t * 9 + i * 2) * 0.12 + Math.random() * 0.1; f.scale.x = 0.9 + Math.random() * 0.15; });
    light.intensity = 7 + Math.random() * 2;
    if (Math.random() < dt * 12) {
      const wp = g.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.9, fz));
      fx.spawn(wp.x, wp.y, wp.z, (Math.random() - 0.5) * 0.3, 1.2 + Math.random(), (Math.random() - 0.5) * 0.3, new THREE.Color('#ffb347'), 0.18, 1.1, -0.5, 0.4);
    }
  });
}

function grandfatherClock() {
  const model = prop('clock');
  const g = model || new THREE.Group();
  // Hands and pendulum stay live meshes so they can move; they sit on the model's face and window.
  const faceY = model ? 2.85 : 2.7, faceZ = model ? 0.37 : 0.33;
  const hand1 = new THREE.Mesh(rbox(0.03, 0.24, 0.02), M.iron); hand1.geometry.translate(0, 0.1, 0); hand1.position.set(0, faceY, faceZ);
  const hand2 = new THREE.Mesh(rbox(0.03, 0.17, 0.02), M.iron); hand2.geometry.translate(0, 0.07, 0); hand2.position.set(0, faceY, faceZ); hand2.rotation.z = -1;
  if (!model) {
    const body = new THREE.Mesh(rbox(0.9, 3.2, 0.6, 0.1), M.woodDark); body.position.y = 1.6;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), M.paper); face.position.set(0, 2.7, 0.31);
    const window_ = new THREE.Mesh(rbox(0.55, 1.2, 0.05, 0.03), clay('#3b2a1a', { key: 'clockGlass' })); window_.position.set(0, 1.35, 0.3);
    g.add(body, face, window_);
  }
  const pend = new THREE.Group(); pend.position.set(0, 1.95, model ? 0.35 : 0.34);
  const rod = new THREE.Mesh(rbox(0.03, 0.8, 0.02), M.gold); rod.position.y = -0.4;
  const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 20), M.gold); bob.rotation.x = Math.PI / 2; bob.position.y = -0.85;
  pend.add(rod, bob);
  g.add(hand1, hand2, pend);
  shadowAll(g);
  return tick(g, (dt, t) => { pend.rotation.z = Math.sin(t * 2.2) * 0.3; hand1.rotation.z = -t * 0.05; });
}

function bed() {
  const lp = prop('bed'); if (lp) return lp;
  const g = new THREE.Group();
  const frame = new THREE.Mesh(rbox(2.0, 0.5, 3.0, 0.1), M.wood); frame.position.y = 0.35;
  const quilt = new THREE.Mesh(rbox(1.9, 0.3, 2.2, 0.14), clay('#3f5fd8', { key: 'quilt' })); quilt.position.set(0, 0.7, 0.35);
  const stripe = new THREE.Mesh(rbox(1.92, 0.31, 0.3, 0.1), clay('#ffcf5a', { key: 'quiltStripe' })); stripe.position.set(0, 0.71, -0.3);
  const pillow = new THREE.Mesh(rbox(1.3, 0.3, 0.6, 0.14), M.paper); pillow.position.set(0, 0.75, -1.1);
  const head = new THREE.Mesh(rbox(2.0, 1.4, 0.2, 0.1), M.woodDark); head.position.set(0, 0.8, -1.45);
  g.add(frame, quilt, stripe, pillow, head);
  return shadowAll(g);
}

// A sleeping cat curled on the rug; its body rises and falls, tail swishes.
function cat() {
  const g = new THREE.Group();
  const fur = clay('#e89a4a', { roughness: 0.6, rim: 0.3, key: 'catFur' });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), fur); body.scale.set(1.2, 0.6, 0.9); body.position.y = 0.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), fur); head.position.set(0.35, 0.22, 0.12);
  [-1, 1].forEach((s) => {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 8), fur); ear.position.set(0.38, 0.4, 0.12 + s * 0.09); head.parent; g.add(ear);
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 4, 8, Math.PI), new THREE.MeshBasicMaterial({ color: '#3a2a1a' }));
    eye.position.set(0.53, 0.24, 0.12 + s * 0.07); eye.rotation.y = Math.PI / 2; eye.rotation.z = Math.PI; g.add(eye);
  });
  const tail = new THREE.Group(); tail.position.set(-0.38, 0.15, 0);
  const tailM = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.45, 4, 8), fur); tailM.rotation.z = Math.PI / 2; tailM.position.x = -0.1; tailM.rotation.y = 0.9;
  tail.add(tailM);
  g.add(body, head, tail);
  shadowAll(g);
  return tick(g, (dt, t) => { body.scale.y = 0.6 + Math.sin(t * 1.6) * 0.03; tail.rotation.y = Math.sin(t * 0.9) * 0.4; });
}

// A round owl on a perch that turns its head and blinks.
function owl() {
  const g = new THREE.Group();
  const perch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.2, 8), M.woodDark); perch.position.y = 1.1;
  const bar = new THREE.Mesh(rbox(0.9, 0.08, 0.08), M.wood); bar.position.y = 2.2;
  const feathers = clay('#9a7a5a', { roughness: 0.6, rim: 0.3, key: 'owl' });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), feathers); body.scale.set(1, 1.2, 0.9); body.position.y = 2.55;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), clay('#e8d6b4', { key: 'owlBelly' })); belly.position.set(0, 2.5, 0.12); belly.scale.set(1, 1.2, 0.6);
  const head = new THREE.Group(); head.position.y = 2.95;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), feathers); skull.scale.set(1.1, 0.9, 1);
  head.add(skull);
  const eyes = [];
  [-1, 1].forEach((s) => {
    const ring = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), clay('#fff4d6', { key: 'owlFace' })); ring.position.set(s * 0.1, 0.02, 0.24);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), clay('#1c1626', { roughness: 0.15, key: 'eyeBead' })); eye.position.set(s * 0.1, 0.02, 0.27);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 6), feathers); tuft.position.set(s * 0.17, 0.25, 0); tuft.rotation.z = -s * 0.4;
    head.add(ring, eye, tuft); eyes.push(eye);
  });
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 6), clay('#ffcf5a', { key: 'gold' })); beak.position.set(0, -0.04, 0.28); beak.rotation.x = Math.PI / 2 + 0.4;
  head.add(beak);
  g.add(perch, bar, body, belly, head);
  shadowAll(g);
  let blink = 3;
  return tick(g, (dt, t) => {
    head.rotation.y = Math.sin(t * 0.4) * 0.9 + Math.sin(t * 2.3) * 0.05;
    blink -= dt; if (blink < 0) blink = 2 + Math.random() * 4;
    eyes.forEach((e) => { e.scale.y = blink < 0.12 ? 0.15 : 1; });
  });
}

function hangingHerbs(rand) {
  const g = new THREE.Group();
  const rod = new THREE.Mesh(rbox(2.4, 0.08, 0.08), M.woodDark); rod.position.y = 3.6; g.add(rod);
  const cols = ['#5a9a3a', '#8aa34a', '#a8743a', '#6b8f4a', '#9a5aa0'];
  for (let i = 0; i < 6; i++) {
    const bunch = new THREE.Group();
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 4), M.paper); string.position.y = -0.15; bunch.add(string);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 8), clay(cols[i % 5], { key: 'herb' + i % 5 }));
    leaves.position.y = -0.55; leaves.rotation.x = Math.PI; bunch.add(leaves);
    bunch.position.set(-1.0 + i * 0.4, 3.55, 0.05);
    const ph = rand() * 6;
    tick(bunch, (dt, t) => { bunch.rotation.z = Math.sin(t * 1.2 + ph) * 0.06; });
    g.add(bunch);
  }
  return shadowAll(g);
}

// Two flasks joined by a glass coil, liquid bubbling across.
function distillery(fx) {
  const g = new THREE.Group();
  const bench = table(2.4, 1.1); g.add(bench);
  const glass = clay('#dff6ff', { transparent: true, opacity: 0.45, roughness: 0.05, key: 'glass' });
  const f1 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), glass); f1.position.set(-0.7, 1.4, 0);
  const l1 = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: '#c58bff', emissive: '#9a5aff', emissiveIntensity: 1.2 }));
  l1.position.copy(f1.position);
  const f2 = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), glass); f2.position.set(0.7, 1.3, 0.1);
  const l2 = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: '#7fe3ff', emissive: '#3fb8ff', emissiveIntensity: 1.2 }));
  l2.position.copy(f2.position);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 8, 24, Math.PI), glass); coil.position.set(0, 1.55, 0.05);
  const burner = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 8), M.flame); burner.position.set(-0.7, 1.12, 0);
  g.add(f1, l1, f2, l2, coil, burner);
  const mortar = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0], [0.2, 0.02], [0.24, 0.2], [0.2, 0.22]].map(([r, y]) => new THREE.Vector2(r, y)), 16), clay('#9a9aa8', { key: 'mortar' }));
  mortar.position.set(0.1, 1.08, -0.3); g.add(mortar);
  const pestle = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.3, 4, 8), clay('#9a9aa8', { key: 'mortar' })); pestle.position.set(0.15, 1.3, -0.3); pestle.rotation.z = 0.5; g.add(pestle);
  shadowAll(g);
  return tick(g, (dt, t) => {
    if (Math.random() < dt * 8) { const wp = g.localToWorld(f1.position.clone()); fx.spawn(wp.x, wp.y + 0.2, wp.z, 0, 0.5, 0, new THREE.Color('#c58bff'), 0.12, 0.8, -0.2, 0.5); }
    if (Math.random() < dt * 6) { const wp = g.localToWorld(f2.position.clone()); fx.spawn(wp.x, wp.y + 0.15, wp.z, 0, 0.4, 0, new THREE.Color('#7fe3ff'), 0.1, 0.8, -0.2, 0.5); }
  });
}

function mushrooms(rand) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.25, 8), M.paper);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), clay(i % 2 ? '#ff7f8a' : '#7fe3ff', { emissive: i % 2 ? '#ff5a7a' : '#3fb8ff', emissiveIntensity: 0.6, key: 'shroom' + (i % 2) }));
    const x = (rand() - 0.5) * 0.8, z = (rand() - 0.5) * 0.5, sc = 0.7 + rand() * 0.8;
    stem.position.set(x, 0.12 * sc, z); stem.scale.setScalar(sc);
    cap.position.set(x, 0.24 * sc, z); cap.scale.setScalar(sc);
    g.add(stem, cap);
  }
  return g;
}

// A glowing hologram of constellations turning slowly overhead.
function constellation(rand) {
  const g = new THREE.Group();
  const starMat = new THREE.MeshBasicMaterial({ color: '#ffe9a8' });
  const pts = [];
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2, r = 1 + rand() * 5, y = (rand() - 0.5) * 1.2;
    const p = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.07 + rand() * 0.06), starMat); st.position.copy(p);
    g.add(st); pts.push(p);
  }
  const linePts = [];
  for (let i = 0; i < pts.length - 1; i += 1) if (rand() < 0.6) linePts.push(pts[i], pts[i + 1]);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePts),
    new THREE.LineBasicMaterial({ color: '#8fd8ff', transparent: true, opacity: 0.45 }));
  g.add(lines);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 16), new THREE.MeshStandardMaterial({ color: '#f4f0e0', emissive: '#bfc8ff', emissiveIntensity: 0.5 }));
  moon.position.set(3.2, 0.4, -2); g.add(moon);
  g.position.y = 4.4;
  return tick(g, (dt, t) => { g.rotation.y += dt * 0.08; lines.material.opacity = 0.35 + Math.sin(t * 1.5) * 0.15; });
}

function armillary() {
  const g = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.3, 1.1, 10), M.woodDark); stand.position.y = 0.55;
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), clay('#7fe3ff', { emissive: '#3fb8ff', emissiveIntensity: 0.8, key: 'armCore' })); core.position.y = 1.55;
  const rings = [];
  [0.45, 0.4, 0.35].forEach((r, i) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 32), M.gold); ring.position.y = 1.55; ring.rotation.set(i * 1.1, i * 0.7, 0); rings.push(ring); g.add(ring); });
  g.add(stand, core);
  shadowAll(g);
  return tick(g, (dt) => { rings.forEach((r, i) => { r.rotation.x += dt * (0.3 + i * 0.2); r.rotation.y += dt * 0.25; }); });
}

// Glowing ley lines etched into the floor converging on the spire's crystal.
function leyLines() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, R - 2.2), mat);
    line.rotation.x = -Math.PI / 2; line.rotation.z = -a;
    line.position.set(Math.sin(a) * (R / 2 + 0.3), 0.03, -Math.cos(a) * (R / 2 + 0.3));
    g.add(line);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.15, 64), mat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  return tick(g, (dt, t) => { mat.opacity = 0.55 + Math.sin(t * 2) * 0.25; });
}

function orbitingRunes(rand) {
  const g = new THREE.Group();
  const stones = [];
  for (let i = 0; i < 6; i++) {
    const st = new THREE.Mesh(rbox(0.35, 0.5, 0.15, 0.06), clay('#d8ccb6', { key: 'runeStone' }));
    const glyph = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.3), new THREE.MeshBasicMaterial({ color: '#ffd36b' }));
    glyph.position.z = 0.08; st.add(glyph);
    st.castShadow = true; g.add(st); stones.push(st);
  }
  return tick(g, (dt, t) => {
    stones.forEach((st, i) => {
      const a = t * 0.5 + (i / stones.length) * Math.PI * 2;
      st.position.set(Math.cos(a) * 3.2, 2.2 + Math.sin(t * 1.3 + i) * 0.3, Math.sin(a) * 3.2);
      st.rotation.y = -a + Math.PI / 2;
    });
  });
}

function throne() {
  const lp = prop('throne'); if (lp) return lp;
  const g = new THREE.Group();
  const velvet = clay('#7a3fc0', { key: 'throneVelvet' });
  const seat = new THREE.Mesh(rbox(1.4, 0.5, 1.2, 0.15), velvet); seat.position.y = 0.6;
  const back = new THREE.Mesh(rbox(1.4, 2.2, 0.3, 0.15), velvet); back.position.set(0, 1.7, -0.5);
  const frame = new THREE.Mesh(rbox(1.6, 2.5, 0.2, 0.1), M.gold); frame.position.set(0, 1.6, -0.66);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), M.gold); star.position.set(0, 3.05, -0.6);
  [-1, 1].forEach((s) => { const arm = new THREE.Mesh(rbox(0.25, 0.4, 1.1, 0.1), M.gold); arm.position.set(s * 0.7, 0.95, 0); g.add(arm); });
  g.add(seat, back, frame, star);
  return shadowAll(g);
}

function goldPile(rand) {
  const g = new THREE.Group();
  const coin = new THREE.CylinderGeometry(0.1, 0.1, 0.025, 12);
  for (let i = 0; i < 40; i++) {
    const c = new THREE.Mesh(coin, M.gold);
    const a = rand() * Math.PI * 2, r = rand() * 0.6;
    c.position.set(Math.cos(a) * r, 0.02 + (0.6 - r) * 0.35 * rand(), Math.sin(a) * r);
    c.rotation.set(rand() - 0.5, 0, rand() - 0.5);
    g.add(c);
  }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), new THREE.MeshStandardMaterial({ color: '#ff7f8a', emissive: '#ff3f6a', emissiveIntensity: 0.8 }));
  gem.position.y = 0.3; g.add(gem);
  return g;
}

// Shared atmosphere: pillars, sconces, window sunbeams, floating candles.
function decorateShell(room, i, rand) {
  [-2.6, -1.25, -0.6, 0.6, 1.25, 2.6].forEach((a) => room.add(atWall(pillar(), a, 0.35))); // clear of the exit door and stair pads
  [-1.4, 1.4, -2.3, 2.3].forEach((a) => { const s = sconce(); s.position.y = 2.6; room.add(atWall(s, a, 0.12, 2.6)); });
  [-2.2, 2.2, 3.14].forEach((a) => room.add(atWall(lightShaft(['#fff2cc', '#dff1ff', '#cfe8ff', '#e6ffd9', '#efe0ff', '#fff2cc'][i]), a, 0.1)));
  room.add(floatingCandles(i === 4 ? 4 : 9, R - 3, 3.6, rand));
}

// ---------------- Per-room signature decor ----------------
const DECOR = [
  // Entrance Hall: hearth, clock, portraits, a statue of your mentor, welcome mat, plants.
  (room, state, rand, fx) => {
    room.add(atWall(fireplace(fx), 1.25, 0.6));
    room.add(atWall(grandfatherClock(), 0.75, 0.55)); // the west wall holds the Sigil cabinet
    [[-0.5, '#1b2350', '#7a3fc0'], [0.5, '#2a1b40', '#3f5fd8']].forEach(([a, bg, robe]) => { const p = portrait(bg, robe); p.position.y = 3.6; room.add(atWall(p, a, 0.12, 3.6)); });
    let statue = prop('statue');
    if (!statue) {
    statue = new THREE.Group();
    const plinth = new THREE.Mesh(rbox(1.1, 0.8, 1.1, 0.12), clay('#cdbd9f', { key: 'hearthStone' })); plinth.position.y = 0.4;
    const stone = clay('#e8e2d6', { rim: 0.35, key: 'statue' });
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 20), stone); robe.position.y = 1.4;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), stone); head.position.y = 2.15;
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.8, 20), stone); hat.position.y = 2.7; hat.rotation.z = 0.15;
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), stone); beard.scale.set(1, 1.3, 0.7); beard.position.set(0, 1.9, 0.2);
    statue.add(plinth, robe, head, hat, beard); shadowAll(statue);
    }
    statue.position.set(-4.2, 0, 3.2); statue.rotation.y = 2.2; room.add(statue);
    const mat = new THREE.Mesh(rbox(2.2, 0.04, 1.2, 0.02), clay('#c9973a', { key: 'doormat' })); mat.position.set(0, 0.02, R - 3.6); room.add(mat);
    [[3.6, 5.2], [-3.6, -6.2], [5.8, -2.4]].forEach(([x, z]) => { const p = plant(rand, true); p.position.set(x, 0, z); room.add(p); });
    const hatStand = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.2, 8), M.woodDark); pole.position.y = 1.1;
    const feet = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.08, 12), M.woodDark); feet.position.y = 0.04;
    const spareHat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 16), clay('#d9425f', { key: 'spareHat' })); spareHat.position.set(0.2, 2.2, 0); spareHat.rotation.z = -0.4;
    hatStand.add(pole, feet, spareHat); shadowAll(hatStand); hatStand.position.set(3.2, 0, 6.2); room.add(hatStand);
  },
  // Study: the apprentice's own bed, a trunk, a sleeping cat, scrolls, and an ink-stained floor.
  (room, state, rand, fx) => {
    const b = bed(); b.position.set(4.4, 0, 3.4); b.rotation.y = -Math.PI / 2 + 0.25; room.add(b);
    const c = chest(); c.position.set(2.6, 0, 5.8); c.rotation.y = -0.6; room.add(c);
    const kitty = cat(); kitty.position.set(0.8, 0.02, 1.2); kitty.rotation.y = 0.6; room.add(kitty);
    [[-3.2, 2.6], [-2.4, 3.6], [1.8, -1.2]].forEach(([x, z]) => { const s = scroll(rand); s.position.x = x; s.position.z = z; room.add(s); });
    const pile = bookPile(rand, 5); pile.position.set(-4.5, 0, 4.2); room.add(pile);
    const map = portrait('#e8d7a8', '#6b3a1e'); map.scale.set(1.8, 1.3, 1); map.position.y = 3.3; room.add(atWall(map, -0.2, 0.12, 3.3));
    const p = plant(rand); p.position.set(-5.8, 0, -1.8); room.add(p);
  },
  // Library: an owl, book piles, a giant grimoire with turning pages, reading desk.
  (room, state, rand, fx) => {
    const o = owl(); o.position.set(4.6, 0, 2.4); o.rotation.y = -1.9; room.add(o);
    [[-2.8, 3.4, 5], [3.2, -3.8, 4], [-1.4, 5.2, 3], [2.2, 4.8, 6]].forEach(([x, z, n]) => { const p = bookPile(rand, n); p.position.set(x, 0, z); room.add(p); });
    const desk = table(2.0, 1.1); desk.position.set(-3.7, 0, 1.8); desk.rotation.y = 1.2; room.add(desk);
    const bp = bookPile(rand, 3); bp.position.set(0.4, 1.07, 0); desk.add(bp);
    const c = candle(true); c.position.set(-0.5, 1.07, 0.2); desk.add(c);
    // Grimoire on a pedestal with a page that keeps turning.
    const grim = new THREE.Group();
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.0, 12), clay('#cdbd9f', { key: 'hearthStone' })); ped.position.y = 0.5;
    const book = openBook('#c58bff'); book.scale.setScalar(1.6); book.position.y = 1.08;
    const page = new THREE.Group(); page.position.y = 1.12;
    const leaf = new THREE.Mesh(rbox(0.56, 0.02, 0.78, 0.01), M.paper); leaf.position.x = 0.29; page.add(leaf);
    grim.add(ped, book, page); shadowAll(grim);
    grim.position.set(3.8, 0, -1.2); grim.rotation.y = -1.1; room.add(grim);
    tick(grim, (dt, t) => {
      const ph = (t * 0.35) % 1;
      page.rotation.z = ph < 0.5 ? ph * 2 * Math.PI : Math.PI;
      if (Math.random() < dt * 5) { const wp = grim.localToWorld(new THREE.Vector3(0, 1.4, 0)); fx.spawn(wp.x, wp.y, wp.z, (Math.random() - 0.5) * 0.4, 0.6, (Math.random() - 0.5) * 0.4, new THREE.Color('#c58bff'), 0.18, 1.4, 0, 0.3); }
    });
    const p = plant(rand, true); p.position.set(-5.9, 0, -3.5); room.add(p);
  },
  // Alchemy: hanging herbs, a bubbling distillery, ingredient barrels, glowing mushrooms, spilled potion.
  (room, state, rand, fx) => {
    room.add(atWall(hangingHerbs(rand), 0.05, 0.3));
    const d = distillery(fx); d.position.set(-3.9, 0, 2.4); d.rotation.y = 1.3; room.add(d);
    [[4.8, -3.6], [5.6, -2.4], [-5.4, -2.0]].forEach(([x, z], i) => {
      const barrel = new THREE.Group();
      const body = prop('barrel') || new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0], [0.42, 0], [0.5, 0.45], [0.42, 0.9], [0.001, 0.9]].map(([r, y]) => new THREE.Vector2(r, y)), 20), clay('#b8763a', { key: 'barrel' }));
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), clay(['#7dff9b', '#c58bff', '#ffd36b'][i], { emissive: ['#35d86a', '#9a5aff', '#ffb030'][i], emissiveIntensity: 0.5, key: 'barrelTop' + i }));
      top.rotation.x = -Math.PI / 2; top.position.y = 0.905;
      barrel.add(body, top); shadowAll(barrel); barrel.position.set(x, 0, z); room.add(barrel);
    });
    const shrooms = mushrooms(rand); shrooms.position.set(2.8, 0, 4.6); room.add(shrooms);
    const shrooms2 = mushrooms(rand); shrooms2.position.set(-2.4, 0, 5.4); room.add(shrooms2);
    const spill = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), new THREE.MeshStandardMaterial({ color: '#c58bff', emissive: '#9a5aff', emissiveIntensity: 0.6, transparent: true, opacity: 0.8 }));
    spill.rotation.x = -Math.PI / 2; spill.position.set(1.6, 0.04, 1.6); // above the rug to avoid z-fighting spill.scale.set(1.4, 0.8, 1); room.add(spill);
    const tipped = potion('#c58bff', 1.2); tipped.rotation.z = Math.PI / 2; tipped.position.set(2.2, 0.15, 1.5); room.add(tipped);
    // Steam curling off the cauldron.
    room.add(tick(new THREE.Group(), (dt) => {
      if (Math.random() < dt * 8) fx.spawn((Math.random() - 0.5) * 0.8, 1.6, -2.2 + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3, new THREE.Color('#dff6e8'), 0.7, 2.2, -0.1, 0.4);
    }));
  },
  // Observatory: constellation hologram overhead, armillary sphere, star-chart table, moon globe.
  (room, state, rand, fx) => {
    room.add(constellation(rand));
    const arm = armillary(); arm.position.set(-4.3, 0, 1.6); room.add(arm);
    const chartTable = table(2.2, 1.3); chartTable.position.set(3.9, 0, -3.4); chartTable.rotation.y = -0.8; room.add(chartTable);
    const chart = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshStandardMaterial({ color: '#1b2350', emissive: '#2a3a8a', emissiveIntensity: 0.4 }));
    chart.rotation.x = -Math.PI / 2; chart.position.y = 1.08; chartTable.add(chart);
    const s = scroll(rand); s.position.set(0.5, 1.07, 0.4); chartTable.add(s);
    const c = candle(true); c.position.set(-0.8, 1.07, -0.4); chartTable.add(c);
    const p = bookPile(rand, 4); p.position.set(3.6, 0, 5.0); room.add(p);
    const tele2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.2, 12), M.gold); tele2.position.set(5.6, 0.6, -1.6); tele2.rotation.z = 1.2; room.add(tele2);
  },
  // Spire: ley lines converging on the crystal, orbiting rune stones, a throne, treasure chests.
  (room, state, rand, fx) => {
    room.add(leyLines());
    const runes = orbitingRunes(rand); room.add(runes);
    const t = throne(); t.position.set(5.9, 0, 0.6); t.rotation.y = -Math.PI / 2; room.add(t); // east side, facing the crystal
    [[-4.6, 3.8, 0.6], [4.6, 3.8, -0.6]].forEach(([x, z, r]) => { const c = chest(); c.position.set(x, 0, z); c.rotation.y = r; room.add(c); const gp = goldPile(rand); gp.position.set(x * 0.8, 0, z - 1.2); room.add(gp); });
    [-0.8, 0.8].forEach((a) => { const banner = new THREE.Mesh(rbox(1.2, 2.8, 0.06, 0.05), clay('#7a3fc0', { key: 'spireBanner' })); banner.position.y = 3; room.add(atWall(banner, a, 0.25, 3)); });
    room.add(tick(new THREE.Group(), (dt) => {
      if (Math.random() < dt * 14) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
        fx.spawn(Math.sin(a) * r, 0.1, -Math.cos(a) * r, -Math.sin(a) * 1.2, 0.4, Math.cos(a) * 1.2, new THREE.Color('#ffd36b'), 0.2, 1.8, -0.4, 0.2);
      }
    }));
  },
];

const BUILDERS = [buildTrophies, buildStudy, buildLibrary, buildAlchemy, buildObservatory, buildSpire];
const WALL_TINTS = ['#efe4cf', '#efe4cf', '#e6e2da', '#e4e6cf', '#ece2e4', '#efe4cf'];
const RUG_COLORS = [['#b8456f', '#8a2f55', '#d9607f'], ['#2f47b8', '#3f5fd8', '#1f2f86'], ['#8a3fc0', '#6b2fa0', '#a45fd8'], ['#2e7a4a', '#3f9a5a', '#1f5a3a'], null, ['#c9973a', '#ffcf5a', '#a87a25']];

export class Interior {
  constructor(game) {
    this.game = game;
    mats();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#171327');
    this.scene = scene;
    this.fx = new Particles(scene, 1500);
    scene.add(new THREE.HemisphereLight('#fff1dc', '#5a4030', 1.0));
    const key = new THREE.DirectionalLight('#fff0d8', 1.6);
    key.position.set(6, 16, 10); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
    key.shadow.bias = -0.0005;
    scene.add(key, key.target);
    const warm = new THREE.PointLight('#ffc98a', 20, 22, 1.6); warm.position.set(0, 4.5, 2); scene.add(warm);
    this.lights = { hemi: scene.children.find((o) => o.isHemisphereLight), key, warm };
    this.def = ARCANE_TOWER;
    this.room = null;
    this.floor = -1;
    this.interactables = [];
  }

  get active() { return this.floor >= 0; }

  buildShell(i) {
    const g = new THREE.Group();
    const floorMat = clay('#ffffff', { map: (() => { const t = plankTexture('#c98a4b').clone(); t.needsUpdate = true; t.repeat.set(4, 4); return t; })(), roughness: 0.6, key: 'roomFloor' });
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.4, 64), floorMat);
    floor.position.y = -0.2; floor.receiveShadow = true; g.add(floor);
    const wallMap = stoneBlockTexture(WALL_TINTS[i]).clone(); wallMap.needsUpdate = true; wallMap.repeat.set(10, 1.1);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, WALL_H, 64, 1, true),
      new THREE.MeshStandardMaterial({ map: wallMap, roughness: 0.7, side: THREE.BackSide }));
    wall.position.y = WALL_H / 2; wall.receiveShadow = true; g.add(wall);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.02, 0.5, 64, 1, true),
      new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, roughness: 0.6, side: THREE.BackSide }));
    base.position.y = 0.25; g.add(base);
    // Windows spaced around the far walls.
    const glass = ['#ffd27a', '#9fd8ff', '#7fc8ff', '#7dff9b', '#c9a8ff', '#ffe08a'][i];
    [-2.2, 2.2, 3.14].forEach((a) => { const w = windowPane(glass); w.position.y = 3; g.add(atWall(w, a, 0.08, 3)); });
    if (RUG_COLORS[i]) g.add(rug(3.2, RUG_COLORS[i]));
    return g;
  }

  // Build the room for `floorIndex`; `arrive` is 'door' | 'up' | 'down' (how the player got here).
  // `def` selects which tower: the Arcane tower (default) or a school sanctum (sanctum-rooms.js).
  enter(floorIndex, arrive, def = this.def) {
    const state = this.game.state;
    if (this.room) { this.scene.remove(this.room); this.room.traverse((o) => o.geometry?.dispose()); }
    this.def = def;
    this.floor = floorIndex;
    const mood = def.mood;
    this.scene.background = new THREE.Color(mood.bg);
    this.lights.hemi.color.set(mood.hemi[0]); this.lights.hemi.groundColor.set(mood.hemi[1]); this.lights.hemi.intensity = mood.hemi[2];
    this.lights.key.color.set(mood.key); this.lights.warm.color.set(mood.warm);
    this.dust = mood.dust;
    const room = new THREE.Group();
    this.shell = def.shell ? def.shell(floorIndex) : this.buildShell(floorIndex);
    room.add(this.shell);
    const rand = mulberry32(floorIndex + 1 + def.id.length * 17);
    const built = def.builders[floorIndex](state, rand, this.fx);
    room.add(built.group);
    def.decorate(room, floorIndex, state, rand, this.fx);
    this.updateRoom = built.update;
    this.pads = [];
    this.interactables = [];
    const addPad = (x, z, color, kind, label, sub) => {
      const p = pad(color); p.position.set(x, 0, z); room.add(p);
      this.pads.push(p);
      this.interactables.push({ x, z, r: 1.6, kind, label, sub });
    };
    // Exit door (ground floor) or stairs down.
    const rooms = def.rooms;
    if (floorIndex === 0) {
      const door = (def.door || archDoor)(); door.userData.noBlock = true;
      room.add(atWall(door, Math.PI, 0.2));
      addPad(0, R - 2.2, def.padColor || '#ffd36b', 'exit', def.exitLabel, def.exitSub);
    } else {
      addPad(-(R - 2.4), 1.5, def.padDown || '#9fd8ff', 'down', `Stairs down`, rooms[floorIndex - 1].name);
    }
    // Stairs up to the next built floor.
    if (floorIndex + 1 < def.floors(state)) {
      const stairs = (def.stairs || staircase)(); stairs.userData.wallA = -0.1; stairs.userData.noBlock = true; // structure, not furniture
      room.add(stairs);
      const a = -0.5 - 0.13; // just before the first step
      addPad(Math.sin(a) * (R - 2.6) + 0.2, -Math.cos(a) * (R - 2.6) + 1.4, def.padColor || '#ffd36b', 'up', 'Stairs up', rooms[floorIndex + 1].name);
    }
    this.interactables.push({ ...built.station, r: 2.0, kind: 'station', station: rooms[floorIndex].station });
    (built.stations || []).forEach((st) => this.interactables.push({ ...st, r: 1.6, kind: 'station' }));
    // Stations never used yet get a sparkle overhead, so nothing in the room is missed.
    const aoHidden = this.game.aoHidden;
    for (const m of this.markers || []) { const k = aoHidden.indexOf(m); if (k >= 0) aoHidden.splice(k, 1); }
    this.markers = [];
    for (const it of this.interactables) {
      if (it.kind !== 'station' || state.guide.used.includes(stationKey(def, it.station))) continue;
      const sp = sparkle(), ph = this.markers.length * 1.7;
      sp.position.set(it.x, 2.9, it.z);
      tick(sp, (dt, t) => { sp.position.y = 2.9 + Math.sin(t * 2.2 + ph) * 0.15; sp.material.rotation = Math.sin(t * 1.3 + ph) * 0.3; sp.material.opacity = 0.75 + Math.sin(t * 3.1 + ph) * 0.25; });
      room.add(sp); aoHidden.push(sp); this.markers.push(sp);
      it.marker = sp;
    }
    this.room = room;
    this.scene.add(room);
    // Cache animated and wall-mounted pieces once, rather than traversing every frame.
    this.ticks = []; this.wallObjs = [];
    room.traverse((o) => {
      if (o.userData.tick) this.ticks.push(o);
      if (o.userData.wallA !== undefined) this.wallObjs.push(o);
    });

    // Colliders: furniture is decorative; keep a few solid pieces so the room feels physical.
    this.colliders = [...(built.solid || [])];
    this.enforceClearance(room, built.group);

    // Place the player by the pad they arrived through.
    const target = arrive === 'door' ? this.interactables.find((i) => i.kind === 'exit')
      : arrive === 'up' ? this.interactables.find((i) => i.kind === 'down')
      : this.interactables.find((i) => i.kind === 'up');
    const spot = target ? { x: target.x * 0.8, z: target.z * 0.8 } : { x: 0, z: 4 };
    return { ...spot, radius: R, floorY: 0, name: rooms[floorIndex].name, floorDef: def.floorDef?.(floorIndex) };
  }

  // ---------------- Keeping stairs, exits and stations clear ----------------
  // Reserved space: a circle around every pad, a standing spot at the station, and a
  // walkway from each of them to the middle of the room.
  reservedZones() {
    const circles = [], paths = [];
    // Pads keep a generous clear ring; the station keeps its standing spot. Routes between them
    // are verified separately with a grid path-finder (walkable()), so furniture may sit
    // anywhere as long as you can still walk around it.
    for (const it of this.interactables) circles.push({ x: it.x, z: it.z, r: it.kind === 'station' ? 0.35 : 1.8 });
    return { circles, paths };
  }

  // Does an XZ rectangle intersect the reserved space?
  blocks(box, zones, pad = 0) {
    const hit = (x, z, r) => {
      const cx = Math.max(box.min.x, Math.min(x, box.max.x)), cz = Math.max(box.min.z, Math.min(z, box.max.z));
      return Math.hypot(cx - x, cz - z) < r + pad;
    };
    if (zones.circles.some((c) => hit(c.x, c.z, c.r))) return true;
    for (const p of zones.paths) {
      const L = Math.hypot(p.bx - p.ax, p.bz - p.az), n = Math.max(2, Math.ceil(L / 0.3));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (hit(p.ax + (p.bx - p.ax) * t, p.az + (p.bz - p.az) * t, p.w)) return true;
      }
    }
    return false;
  }

  // Floor-standing furniture that could get in the way (not rugs, not overhead, not light).
  obstacles(room, group) {
    const list = [];
    const consider = (o) => {
      if (o === this.shell || this.pads.includes(o) || o.userData.noBlock) return;
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty() || box.min.y > 2.1 || box.max.y < 0.15) return;
      list.push({ o, box });
    };
    room.children.forEach((c) => { if (c !== group) consider(c); });
    group.children.forEach(consider);
    return list;
  }

  // Grid flood-fill: can a player-sized body walk between every pad and the station?
  walkable(playerR = 0.45, cell = 0.2) {
    const N = Math.ceil((2 * R) / cell);
    const idx = (i, j) => j * N + i, pos = (i) => -R + (i + 0.5) * cell;
    const free = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = pos(i), z = pos(j);
      if (Math.hypot(x, z) > R - 0.6) continue;
      if (this.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.radius + playerR)) continue;
      free[idx(i, j)] = 1;
    }
    const cellOf = (x, z) => [Math.floor((x + R) / cell), Math.floor((z + R) / cell)];
    // A target is reached if any free cell within its interaction radius is reachable.
    const targets = this.interactables.map((it) => ({ it, reach: Math.min(it.r, 1.6) - 0.1 }));
    const seen = new Uint8Array(N * N), queue = [];
    const t0 = targets[0].it;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (free[idx(i, j)] && Math.hypot(pos(i) - t0.x, pos(j) - t0.z) < targets[0].reach) { seen[idx(i, j)] = 1; queue.push(i, j); }
    }
    while (queue.length) {
      const j = queue.pop(), i = queue.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= N || b >= N) continue;
        const k = idx(a, b);
        if (free[k] && !seen[k]) { seen[k] = 1; queue.push(a, b); }
      }
    }
    return targets.map(({ it, reach }) => {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        if (seen[idx(i, j)] && Math.hypot(pos(i) - it.x, pos(j) - it.z) < reach) return { kind: it.kind, reachable: true };
      }
      return { kind: it.kind, reachable: false };
    });
  }

  enforceClearance(room, group) {
    const zones = this.reservedZones();
    this.clearanceLog = [];
    const inside = (box) => Math.max(Math.hypot(box.min.x, box.min.z), Math.hypot(box.max.x, box.min.z), Math.hypot(box.min.x, box.max.z), Math.hypot(box.max.x, box.max.z)) < R - 0.2;
    for (const { o, box } of this.obstacles(room, group)) {
      if (!this.blocks(box, zones)) continue;
      const start = o.position.clone(), startRot = o.rotation.y;
      let fixed = false;
      if (o.userData.wallA !== undefined) {
        // Wall pieces slide along the wall to the nearest clear spot.
        const a0 = o.userData.wallA, inset = R - Math.hypot(start.x, start.z);
        for (let k = 1; k <= 40 && !fixed; k++) {
          const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.06;
          o.position.set(Math.sin(a) * (R - inset), start.y, -Math.cos(a) * (R - inset));
          o.rotation.y = -a;
          o.updateMatrixWorld(true);
          const b = new THREE.Box3().setFromObject(o);
          if (!this.blocks(b, zones)) { o.userData.wallA = a; fixed = true; }
        }
      } else {
        // Free-standing pieces search outward in a spiral for a clear, in-room spot.
        for (let d = 0.3; d <= 5 && !fixed; d += 0.3) {
          for (let i = 0; i < 16 && !fixed; i++) {
            const a = (i / 16) * Math.PI * 2;
            o.position.set(start.x + Math.cos(a) * d, start.y, start.z + Math.sin(a) * d);
            o.updateMatrixWorld(true);
            const b = new THREE.Box3().setFromObject(o);
            if (!this.blocks(b, zones) && inside(b)) fixed = true;
          }
        }
      }
      if (fixed) this.clearanceLog.push({ name: o.userData.prop || o.name || 'decor', action: 'moved', from: [start.x, start.z].map((v) => +v.toFixed(2)), to: [o.position.x, o.position.z].map((v) => +v.toFixed(2)) });
      else { o.position.copy(start); o.rotation.y = startRot; o.visible = false; this.clearanceLog.push({ name: o.userData.prop || 'decor', action: 'removed' }); }
    }
    // Solid furniture gets a collider, trimmed so it never intrudes on a walkway.
    for (const { o, box } of this.obstacles(room, group)) {
      if (!o.visible) continue;
      box.setFromObject(o);
      const h = box.max.y - box.min.y;
      if (h < 0.4) continue; // scrolls, book piles, mushrooms: step over them
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      let r = Math.min(1.5, Math.max(0.3, 0.42 * Math.max(box.max.x - box.min.x, box.max.z - box.min.z)));
      const circleBox = (rad) => ({ min: { x: cx - rad, z: cz - rad }, max: { x: cx + rad, z: cz + rad } });
      while (r > 0.2 && this.blocks(circleBox(r), zones)) r -= 0.05;
      if (r > 0.2) this.colliders.push({ x: cx, z: cz, radius: r });
    }
  }

  clearMarker(it) {
    if (!it.marker) return;
    it.marker.removeFromParent();
    const k = this.game.aoHidden.indexOf(it.marker); if (k >= 0) this.game.aoHidden.splice(k, 1);
    it.marker = null;
  }

  exit() {
    if (this.room) { this.scene.remove(this.room); this.room = null; }
    this.floor = -1;
    this.interactables = [];
  }

  nearest(p) {
    let best = null, bd = Infinity;
    for (const it of this.interactables) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < it.r && d < bd) { bd = d; best = it; }
    }
    return best;
  }

  update(dt, elapsed) {
    if (!this.active) return;
    this.updateRoom?.(dt, elapsed);
    for (const o of this.ticks) o.userData.tick(dt, elapsed);
    // Dollhouse cutaway: the wall nearest the camera is culled, so hide anything mounted on it too.
    const cam = this.game.camera.position;
    const camA = Math.atan2(cam.x, -cam.z), outside = Math.hypot(cam.x, cam.z) > R * 0.55;
    for (const o of this.wallObjs) {
      const d = Math.abs(Math.atan2(Math.sin(o.userData.wallA - camA), Math.cos(o.userData.wallA - camA)));
      o.visible = !outside || d > 1.15;
    }
    // Dust motes (or souls, embers, snow) drifting through the room.
    if (Math.random() < dt * 10) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (R - 1.5);
      this.fx.spawn(Math.sin(a) * r, 0.5 + Math.random() * 3.5, -Math.cos(a) * r, (Math.random() - 0.5) * 0.15, 0.05, (Math.random() - 0.5) * 0.15, this.dustColor ||= new THREE.Color(), 0.1, 5, 0, 0.05);
      this.dustColor.set(this.dust || '#fff2cc');
    }
    this.pads.forEach((p, i) => { p.userData.glow.rotation.z += dt * 0.4; p.userData.glow.material.opacity = 0.7 + Math.sin(elapsed * 2 + i) * 0.25; });
    this.room.traverse((o) => {
      if (!o.userData.flicker) return;
      if (o.isLight) o.intensity = 2.6 + Math.random() * 0.8; else o.scale.y = 1.6 + Math.random() * 0.4;
    });
    this.fx.update(dt);
  }
}


// The Arcane tower: the default interior definition. School sanctums supply their own
// (sanctum-rooms.js) with the same shape.
const ARCANE_TOWER = {
  id: 'arcane',
  rooms: ROOMS,
  builders: BUILDERS,
  floors: (state) => state.floors,
  floorDef: (i) => TOWER_FLOORS[i],
  decorate(room, i, state, rand, fx) { decorateShell(room, i, rand); DECOR[i](room, state, rand, fx); },
  exitLabel: 'Leave the tower', exitSub: 'Back out to the valley',
  mood: { bg: '#171327', hemi: ['#fff1dc', '#5a4030', 1.0], key: '#fff0d8', warm: '#ffc98a', dust: '#fff2cc' },
};
export { ARCANE_TOWER };

// Shared building blocks for other interiors.
export const roomKit = { R, WALL_H, rbox, atWall, shadowAll, pad, staircase, candle, floatingCandles, lightShaft, tick, mats, prop };
