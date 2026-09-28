import * as THREE from 'three';
import { heightAt, slopeAt, WATER_LEVEL } from './world.js';
import { mulberry32, fbm } from './util.js';
import { SHRINES, NODE_TYPES } from './data.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clay, leafTexture, PALETTE } from './style.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared geometry/material so ~300 nodes cost very little GPU memory.
const G = {};
const M = {};
function initAssets() {
  if (G.trunk) return;
  // Trunk with flared roots (lathe profile).
  G.trunk = new THREE.LatheGeometry([
    [0.62, 0], [0.5, 0.08], [0.36, 0.3], [0.3, 0.8], [0.27, 1.6], [0.25, 2.2], [0.001, 2.25],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 14);
  // Box-oak canopy tiers: soft rounded cubes, like hand-sculpted clay.
  G.boxA = new RoundedBoxGeometry(3.0, 1.6, 3.0, 3, 0.55);
  G.boxB = new RoundedBoxGeometry(2.3, 1.4, 2.3, 3, 0.5);
  G.boxC = new RoundedBoxGeometry(1.5, 1.1, 1.5, 3, 0.42);
  // Tiered pine as a single smooth lathe with rounded rims.
  const pine = [];
  const tiers = [[1.9, 1.2], [1.5, 2.3], [1.1, 3.3], [0.65, 4.2]];
  pine.push([0.001, 1.0]);
  tiers.forEach(([r, y], i) => {
    pine.push([r * 0.35, y - 0.25], [r, y + 0.05], [r * 1.02, y + 0.22], [r * 0.9, y + 0.38]);
  });
  pine.push([0.25, 4.9], [0.001, 5.15]);
  G.pine = new THREE.LatheGeometry(pine.map(([r, y]) => new THREE.Vector2(r, y)), 20);
  G.puff = new THREE.IcosahedronGeometry(1, 3);
  // Smooth, gently lumpy boulder.
  // Weld the icosphere's duplicated vertices first so recomputed normals stay smooth.
  G.rock = mergeVertices(new THREE.IcosahedronGeometry(1.15, 3).deleteAttribute('normal').deleteAttribute('uv'));
  const rp = G.rock.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(rp, i);
    const k = 1 + fbm(v.x * 1.2 + 3, v.z * 1.2 + v.y, 2) * 0.22;
    rp.setXYZ(i, v.x * k, v.y * k * 0.72, v.z * k);
  }
  G.rock.computeVertexNormals();
  G.crystal = new THREE.OctahedronGeometry(0.5, 0); G.crystal.scale(0.6, 2.2, 0.6);
  G.stem = new THREE.CylinderGeometry(0.035, 0.045, 0.8, 6); G.stem.translate(0, 0.4, 0);
  G.petal = new THREE.SphereGeometry(0.2, 12, 8); G.petal.scale(0.8, 0.3, 1.6);
  G.bulb = new THREE.SphereGeometry(0.15, 14, 10);
  G.leaf = new THREE.SphereGeometry(0.22, 10, 6); G.leaf.scale(1.5, 0.25, 0.7);

  const leafMap = leafTexture();
  leafMap.repeat.set(1, 1);
  const pineMap = leafTexture('#4aa23f', '#2f7a2c', '#7ccf5a').clone();
  pineMap.needsUpdate = true; pineMap.repeat.set(6, 3);
  M.bark = clay(PALETTE.woodDark, { roughness: 0.75, key: 'bark' });
  M.oak = clay('#ffffff', { map: leafMap, roughness: 0.7, rim: 0.3, key: 'oak' });
  M.oakAutumn = clay('#ffc27a', { map: leafMap, roughness: 0.7, rim: 0.3, key: 'oakAutumn' });
  M.pine = clay('#ffffff', { map: pineMap, roughness: 0.7, rim: 0.3, key: 'pine' });
  M.puff = clay('#7fcf52', { roughness: 0.6, rim: 0.35, key: 'puff' });
  M.puffPink = clay('#ffb3cf', { roughness: 0.6, rim: 0.35, key: 'puffPink' });
  M.rock = clay('#d8ccb6', { roughness: 0.6, key: 'rock' });
  M.rockMoss = clay('#b9c18f', { roughness: 0.65, key: 'rockMoss' });
  M.crystal = new THREE.MeshStandardMaterial({ color: '#a58bff', emissive: '#6a3cff', emissiveIntensity: 1.3, roughness: 0.12, metalness: 0.1 });
  M.crystal2 = new THREE.MeshStandardMaterial({ color: '#7fe6ff', emissive: '#1fa8ff', emissiveIntensity: 1.3, roughness: 0.12 });
  M.stem = clay('#3f9a3a', { key: 'stem' });
  M.petal = clay('#6ff5dc', { emissive: '#2fe0c0', emissiveIntensity: 0.9, roughness: 0.4, key: 'petal' });
  M.bulb = clay('#ffffff', { emissive: '#9ffff0', emissiveIntensity: 2.5, key: 'bulb' });
}

function makeTree(rand) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(G.trunk, M.bark);
  trunk.castShadow = true; g.add(trunk);
  const kind = rand();
  const foliage = [];
  if (kind < 0.45) {
    // Box oak: stacked soft cubes, each slightly twisted.
    const mat = rand() < 0.15 ? M.oakAutumn : M.oak;
    [[G.boxA, 2.6], [G.boxB, 3.85], [G.boxC, 4.9]].forEach(([geo, y], i) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set((rand() - 0.5) * 0.2, y, (rand() - 0.5) * 0.2);
      m.rotation.y = rand() * 0.6;
      m.castShadow = true; m.receiveShadow = true;
      g.add(m); foliage.push(m);
    });
  } else if (kind < 0.8) {
    const m = new THREE.Mesh(G.pine, M.pine);
    m.castShadow = true; m.receiveShadow = true; m.rotation.y = rand() * 6;
    g.add(m); foliage.push(m);
    trunk.scale.set(0.8, 0.6, 0.8);
  } else {
    // Puffball tree.
    const mat = rand() < 0.3 ? M.puffPink : M.puff;
    [[0, 3.3, 0, 1.45], [0.9, 2.8, 0.3, 1.0], [-0.8, 2.9, -0.2, 1.05], [0.1, 4.2, -0.2, 1.0]].forEach(([x, y, z, r]) => {
      const m = new THREE.Mesh(G.puff, mat);
      m.position.set(x, y, z); m.scale.setScalar(r);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m); foliage.push(m);
    });
  }
  const s = 0.8 + rand() * 0.45;
  g.scale.setScalar(s);
  return { group: g, radius: 0.65 * s, sway: foliage };
}

function makeRock(rand) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(G.rock, rand() < 0.3 ? M.rockMoss : M.rock);
  m.castShadow = true; m.receiveShadow = true;
  m.rotation.y = rand() * 6;
  g.add(m);
  for (let i = 0; i < 2; i++) {
    if (rand() < 0.4) continue;
    const m2 = new THREE.Mesh(G.rock, M.rock);
    const a = rand() * 6.28;
    m2.scale.setScalar(0.35 + rand() * 0.2); m2.position.set(Math.cos(a) * 1.2, -0.1, Math.sin(a) * 1.2);
    m2.castShadow = true; m2.receiveShadow = true; g.add(m2);
  }
  const s = 0.85 + rand() * 0.6;
  g.scale.set(s, s * (0.8 + rand() * 0.3), s);
  g.position.y = -0.15;
  return { group: g, radius: 1.3 * s, sway: [] };
}

function makeCrystal(rand) {
  const g = new THREE.Group();
  const mat = rand() < 0.5 ? M.crystal : M.crystal2;
  const n = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(G.crystal, mat);
    const a = rand() * Math.PI * 2, r = i === 0 ? 0 : 0.35 + rand() * 0.25;
    m.position.set(Math.cos(a) * r, 0.6, Math.sin(a) * r);
    m.rotation.set((rand() - 0.5) * 0.9, rand() * 3, (rand() - 0.5) * 0.9);
    m.scale.setScalar(i === 0 ? 1.3 : 0.6 + rand() * 0.4);
    m.castShadow = true; g.add(m);
  }
  const base = new THREE.Mesh(G.rock, M.rock); base.scale.set(0.75, 0.4, 0.75); base.receiveShadow = true; g.add(base);
  return { group: g, radius: 0.9, sway: [], color: mat.emissive };
}

function makeFlower(rand) {
  const g = new THREE.Group();
  const count = 3 + Math.floor(rand() * 2);
  for (let k = 0; k < count; k++) {
    const f = new THREE.Group();
    f.add(new THREE.Mesh(G.stem, M.stem));
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(G.petal, M.petal);
      const a = (i / 6) * Math.PI * 2;
      p.position.set(Math.sin(a) * 0.2, 0.84, Math.cos(a) * 0.2);
      p.rotation.set(0.35, a, 0);
      f.add(p);
    }
    const b = new THREE.Mesh(G.bulb, M.bulb); b.position.y = 0.88; f.add(b);
    const lf = new THREE.Mesh(G.leaf, M.stem); lf.position.set(0.16, 0.25, 0); lf.rotation.z = 0.3; f.add(lf);
    f.position.set((rand() - 0.5) * 1.2, 0, (rand() - 0.5) * 1.2);
    f.scale.setScalar(1.0 + rand() * 0.5);
    f.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(f);
  }
  return { group: g, radius: 0, sway: g.children };
}

const MAKERS = { tree: makeTree, rock: makeRock, crystal: makeCrystal, flower: makeFlower };

export class ResourceManager {
  constructor(scene, particles) {
    initAssets();
    this.scene = scene;
    this.particles = particles;
    this.nodes = [];
    const rand = mulberry32(4242);
    const avoid = (x, z, pad = 0) => {
      if (Math.hypot(x, z) < 34 + pad) return true;
      for (const s of SHRINES) if (Math.hypot(x - s.x, z - s.z) < 15 + pad) return true;
      return false;
    };
    const tryPlace = (type, count, test) => {
      let placed = 0, guard = 0;
      while (placed < count && guard++ < count * 60) {
        const r = 36 + Math.sqrt(rand()) * 135, a = rand() * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (avoid(x, z)) continue;
        const h = heightAt(x, z);
        if (h < WATER_LEVEL + 0.6) continue;
        if (!test(x, z, h)) continue;
        if (this.nodes.some((n) => Math.hypot(n.x - x, n.z - z) < (type === 'flower' ? 3 : 4.5))) continue;
        this.add(type, x, z, rand);
        placed++;
      }
    };
    // A starter grove + quarry close to the tower so the first goal is quick.
    for (let i = 0; i < 12; i++) {
      const a = 2.7 + (i / 12) * 1.2, r = 38 + rand() * 14;
      this.add('tree', Math.cos(a) * r, Math.sin(a) * r, rand);
    }
    for (let i = 0; i < 8; i++) {
      const a = -0.6 + (i / 8) * 1.2, r = 38 + rand() * 10;
      this.add('rock', Math.cos(a) * r, Math.sin(a) * r, rand);
    }
    tryPlace('tree', 150, (x, z, h) => h < 26 && slopeAt(x, z) < 0.7 && fbm(x * 0.02, z * 0.02 + 9, 2) > -0.2);
    tryPlace('rock', 70, (x, z, h) => h < 32);
    tryPlace('crystal', 38, (x, z, h) => h > 2 && (slopeAt(x, z) > 0.25 || Math.hypot(x, z) > 90));
    tryPlace('flower', 50, (x, z, h) => h < 14 && slopeAt(x, z) < 0.4);
    this.buildBatches();
  }

  // ---------------- GPU batching ----------------
  // Every node's meshes are baked into one world-space mesh per material (≈15 draw calls for
  // the whole valley instead of ~1,400). Each node owns a slice of the vertex buffer; when it
  // grows, shrinks, shakes or sways, only that slice is re-transformed and re-uploaded.
  buildBatches() {
    const buckets = new Map();
    this.nodes.forEach((n) => {
      n.group.updateMatrixWorld(true);
      n.bakeInv = n.group.matrixWorld.clone().invert();
      n.slices = [];
      n.group.traverse((o) => {
        if (!o.isMesh) return;
        let g = o.geometry.index ? o.geometry.clone() : mergeVertices(o.geometry.clone());
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.applyMatrix4(o.matrixWorld);
        // Bucket by material *and* 70 m world chunk, so off-screen chunks are frustum-culled
        // (and skipped by the shadow camera) while each chunk is still a single draw.
        const key = o.material.uuid + ':' + Math.floor(n.x / 70) + ',' + Math.floor(n.z / 70);
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { geos: [], count: 0, cast: false, material: o.material }));
        n.slices.push({ bucket: b, start: b.count, count: g.attributes.position.count, base: g.attributes.position.array.slice(), baseN: g.attributes.normal.array.slice() });
        b.count += g.attributes.position.count;
        b.cast ||= o.castShadow;
        b.geos.push(g);
      });
      n.group.clear(); // the group stays as an invisible transform proxy
      n.synced = { sx: 1, rz: 0, vis: true };
    });
    this.batches = [];
    for (const b of buckets.values()) {
      const material = b.material;
      const geo = mergeGeometries(b.geos, false);
      geo.computeBoundingSphere();
      geo.boundingSphere.radius += 3; // headroom for shake/grow
      geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
      geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = b.cast; mesh.receiveShadow = true;

      b.mesh = mesh;
      this.scene.add(mesh);
      this.batches.push(mesh);
    }
  }

  // Re-transform one node's slices from its bake pose to its current proxy transform.
  syncNode(n) {
    const g = n.group;
    const vis = g.visible;
    if (n.synced.vis === vis && Math.abs(n.synced.sx - g.scale.x) < 1e-4 && Math.abs(n.synced.rz - g.rotation.z) < 1e-4) return;
    n.synced = { sx: g.scale.x, rz: g.rotation.z, vis };
    g.updateMatrixWorld(true);
    const m = vis ? new THREE.Matrix4().multiplyMatrices(g.matrixWorld, n.bakeInv) : new THREE.Matrix4().makeScale(0, 0, 0).premultiply(new THREE.Matrix4().makeTranslation(n.x, n.y, n.z));
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const e = m.elements, ne = nm.elements;
    for (const sl of n.slices) {
      const pos = sl.bucket.mesh.geometry.attributes.position, nor = sl.bucket.mesh.geometry.attributes.normal;
      const P = pos.array, N = nor.array, o = sl.start * 3;
      for (let i = 0; i < sl.count * 3; i += 3) {
        const x = sl.base[i], y = sl.base[i + 1], z = sl.base[i + 2];
        P[o + i] = e[0] * x + e[4] * y + e[8] * z + e[12];
        P[o + i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        P[o + i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const a = sl.baseN[i], b = sl.baseN[i + 1], c = sl.baseN[i + 2];
        let nx = ne[0] * a + ne[3] * b + ne[6] * c, ny = ne[1] * a + ne[4] * b + ne[7] * c, nz = ne[2] * a + ne[5] * b + ne[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        N[o + i] = nx / l; N[o + i + 1] = ny / l; N[o + i + 2] = nz / l;
      }
      pos.addUpdateRange(o, sl.count * 3); nor.addUpdateRange(o, sl.count * 3);
      pos.needsUpdate = true; nor.needsUpdate = true;
    }
  }

  add(type, x, z, rand) {
    const made = MAKERS[type](rand);
    const y = heightAt(x, z);
    made.group.position.set(x, y + made.group.position.y, z);
    made.group.rotation.y = rand() * Math.PI * 2;
    this.scene.add(made.group);
    const def = NODE_TYPES[type];
    this.nodes.push({
      type, def, x, z, y, group: made.group, sway: made.sway, radius: made.radius,
      baseScale: made.group.scale.clone(), alive: true, respawn: 0, grow: 1, shake: 0,
      phase: rand() * 10, emissive: made.color,
    });
  }

  // Colliders only for solid nodes that are currently standing.
  get colliders() {
    return this.nodes.filter((n) => n.alive && n.radius > 0);
  }

  nearest(p, range) {
    let best = null, bd = range;
    for (const n of this.nodes) {
      if (!n.alive || n.grow < 1) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z) - n.radius * 0.5;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  poke(node) {
    node.shake = 0.35;
    const p = new THREE.Vector3(node.x, node.y + (node.type === 'tree' ? 1.2 : 0.8), node.z);
    const colors = { tree: '#c8894a', rock: '#cfd4da', crystal: '#b59bff', flower: '#6ff5dc' };
    this.particles.burst(p, { count: 8, color: colors[node.type], speed: 3, size: 0.25, life: 0.6, gravity: node.type === 'flower' ? -1 : 6 });
  }

  harvest(node) {
    node.alive = false;
    node.respawn = node.def.respawn;
    const p = new THREE.Vector3(node.x, node.y + 1, node.z);
    const colors = { tree: '#e0b070', rock: '#d6d6d6', crystal: '#a98bff', flower: '#5ff2d2' };
    this.particles.burst(p, { count: 40, color: colors[node.type], speed: 6, size: 0.45, life: 1.1, gravity: 3, spread: 1.5 });
    const out = {};
    for (const [k, [a, b]] of Object.entries(node.def.yields)) out[k] = a + Math.floor(Math.random() * (b - a + 1));
    return out;
  }

  update(dt, elapsed, playerPos, night) {
    this.animate(dt, elapsed, playerPos, night);
    // Only nodes whose transform changed re-upload their vertex slice.
    if (this.batches) for (const n of this.nodes) this.syncNode(n);
  }

  animate(dt, elapsed, playerPos, night) {
    for (const n of this.nodes) {
      const g = n.group;
      if (!n.alive) {
        // Shrink away, then wait for respawn.
        if (g.visible) {
          g.scale.multiplyScalar(Math.exp(-10 * dt));
          if (g.scale.x < n.baseScale.x * 0.05) g.visible = false;
        }
        n.respawn -= dt;
        if (n.respawn <= 0) { n.alive = true; n.grow = 0; g.visible = true; }
        continue;
      }
      if (n.grow < 1) {
        n.grow = Math.min(1, n.grow + dt * 0.8);
        const e = 1 - Math.pow(1 - n.grow, 3);
        g.scale.copy(n.baseScale).multiplyScalar(Math.max(0.01, e));
      }
      const near = Math.abs(n.x - playerPos.x) < 60 && Math.abs(n.z - playerPos.z) < 60;
      if (n.shake > 0) {
        n.shake -= dt;
        g.rotation.z = Math.sin(elapsed * 60) * n.shake * 0.12;
      } else if (n.type === 'tree' && g.rotation.z !== 0) {
        g.rotation.z = 0; // settle after a shake (idle sway removed: it forced per-frame re-uploads)
      }
      if (n.type === 'flower' && near) {
        if (n.shake <= 0) g.rotation.z = Math.sin(elapsed * 2 + n.phase) * 0.08;
        if (Math.random() < dt * (1 + night * 3)) {
          this.particles.spawn(n.x + (Math.random() - 0.5) * 1.5, n.y + 0.9, n.z + (Math.random() - 0.5) * 1.5,
            0, 0.5 + Math.random() * 0.4, 0, new THREE.Color('#6ff5dc'), 0.2, 2.2, 0, 0.2);
        }
      }
      if (n.type === 'crystal' && near && Math.random() < dt * 2.5) {
        this.particles.spawn(n.x + (Math.random() - 0.5) * 1.2, n.y + 0.5 + Math.random() * 1.5, n.z + (Math.random() - 0.5) * 1.2,
          0, 0.35, 0, n.emissive, 0.22, 1.6, 0, 0.1);
      }
    }
  }
}
