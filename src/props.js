import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { heightAt } from './world.js';
import { SHRINES, MENTOR_POS, ALTAR_POS, REALM_PASSES } from './data.js';
import { clay, leafTexture, plankTexture, PALETTE } from './style.js';
import { mergeStatic } from './merge.js';

// Set dressing for the tower grounds: lanterns, clipped hedges, a fence, barrels and crates.
// Purely visual apart from a few colliders so the player can't walk through them.

const PATH_ANGLES = [
  ...SHRINES.map((s) => Math.atan2(s.z, s.x)),
  Math.atan2(24, 0), // the player's arrival path
  ...Object.values(REALM_PASSES).map((p) => p.a), // out to the four bridges
];
const onPath = (a, width = 0.26) => PATH_ANGLES.some((p) => Math.abs(Math.atan2(Math.sin(a - p), Math.cos(a - p))) < width);

function lantern() {
  const g = new THREE.Group();
  const wood = clay(PALETTE.wood, { roughness: 0.55, key: 'propWood' });
  const dark = clay(PALETTE.woodDark, { roughness: 0.55, key: 'propWoodDark' });
  const post = new THREE.Mesh(new RoundedBoxGeometry(0.34, 2.2, 0.34, 3, 0.1), wood); post.position.y = 1.1;
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.3, 0.55, 3, 0.1), dark); base.position.y = 0.15;
  const cap = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.18, 0.7, 3, 0.07), dark); cap.position.y = 2.95;
  const glow = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.55, 0.5, 3, 0.12), clay('#ffe7a8', { emissive: '#ffb347', emissiveIntensity: 1.6, roughness: 0.3, key: 'lanternGlow' }));
  glow.position.y = 2.55;
  const frame = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.12, 0.6, 3, 0.05), dark); frame.position.y = 2.25;
  g.add(post, base, glow, frame, cap);
  return g;
}

function hedge(len) {
  const map = leafTexture().clone(); map.needsUpdate = true; map.repeat.set(len / 1.2, 1);
  const m = new THREE.Mesh(new RoundedBoxGeometry(len, 1.1, 1.1, 4, 0.4), clay('#ffffff', { map, roughness: 0.65, rim: 0.3, key: 'hedge' + len.toFixed(1) }));
  m.position.y = 0.5;
  return m;
}

function barrel() {
  const g = new THREE.Group();
  const prof = [[0.001, 0], [0.38, 0], [0.45, 0.4], [0.38, 0.85], [0.001, 0.85]].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), clay('#c7874a', { roughness: 0.55, key: 'barrel' }));
  const band = clay('#6b4a30', { roughness: 0.4, key: 'barrelBand' });
  [0.15, 0.7].forEach((y) => {
    const b = new THREE.Mesh(new THREE.TorusGeometry(y < 0.4 ? 0.42 : 0.41, 0.035, 8, 24), band);
    b.rotation.x = Math.PI / 2; b.position.y = y; g.add(b);
  });
  g.add(body);
  return g;
}

function crate() {
  const map = plankTexture('#d59a5a').clone(); map.needsUpdate = true;
  const m = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.9, 0.9, 3, 0.1), clay('#ffffff', { map, roughness: 0.6, key: 'crate' }));
  m.position.y = 0.45;
  return m;
}

function fence(len) {
  const g = new THREE.Group();
  const wood = clay(PALETTE.wood, { roughness: 0.55, key: 'propWood' });
  const n = Math.max(2, Math.round(len / 1.4) + 1);
  for (let i = 0; i < n; i++) {
    const p = new THREE.Mesh(new RoundedBoxGeometry(0.3, 1.1, 0.3, 3, 0.1), wood);
    p.position.set(-len / 2 + (i / (n - 1)) * len, 0.55, 0); g.add(p);
  }
  [0.4, 0.8].forEach((y) => {
    const r = new THREE.Mesh(new RoundedBoxGeometry(len, 0.16, 0.14, 3, 0.06), wood);
    r.position.y = y; g.add(r);
  });
  return g;
}

export class Props {
  constructor(scene) {
    this.group = new THREE.Group();
    this.colliders = [];
    const place = (obj, x, z, rotY = 0, collide = 0) => {
      obj.position.x = x; obj.position.z = z; obj.position.y += heightAt(x, z) - 0.02;
      obj.rotation.y = rotY;
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      mergeStatic(obj);
      this.group.add(obj);
      if (collide) this.colliders.push({ x, z, radius: collide });
    };

    // Lanterns ringing the courtyard, flanking each path.
    for (const p of PATH_ANGLES) {
      [-0.2, 0.2].forEach((off) => {
        const a = p + off, r = 16.6;
        place(lantern(), Math.cos(a) * r, Math.sin(a) * r, -a, 0.35);
      });
    }
    // Clipped hedges around the plateau edge, broken wherever a path leaves.
    const R = 19.3;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      if (onPath(a, 0.3)) continue;
      const len = (2 * Math.PI * R) / 40 - 0.25;
      place(hedge(len), Math.cos(a) * R, Math.sin(a) * R, -a + Math.PI / 2, 0.9);
    }
    // Mentor's little camp: barrels, crates and a short fence.
    const mx = MENTOR_POS.x, mz = MENTOR_POS.z;
    place(barrel(), mx - 2.4, mz - 1.2, 0.3, 0.5);
    place(barrel(), mx - 3.2, mz - 0.2, 1.1, 0.5);
    place(crate(), mx - 2.6, mz + 1.4, 0.4, 0.6);
    const top = crate(); top.scale.setScalar(0.7); place(top, mx - 2.6, mz + 1.4, 0.9);
    top.position.y += 0.9;
    place(fence(4.2), mx - 1.2, mz - 3.2, 0.25);
    // Planters by the altar.
    [[ALTAR_POS.x + 3.2, ALTAR_POS.z - 1.5], [ALTAR_POS.x - 3.2, ALTAR_POS.z + 1.2]].forEach(([x, z]) => {
      const b = barrel(); b.scale.set(1.1, 0.6, 1.1);
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 3), clay('#6cc24a', { roughness: 0.6, rim: 0.35, key: 'planterBush' }));
      bush.position.y = 0.75; bush.scale.set(1, 0.8, 1); b.add(bush);
      place(b, x, z, 0, 0.5);
    });
    scene.add(this.group);
  }
}
