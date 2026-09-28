import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Static batching: collapse every non-animated mesh under `root` into one mesh per material.
// A tree built from a trunk + three canopy tiers becomes two draw calls instead of four, in
// every pass (shadow, AO normals, colour). Anything flagged userData.dynamic (or under a node
// that is), lights, points and lines are left untouched so their animations keep working.
export function mergeStatic(root, { keepShadowFlags = true } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map(); // material -> { geos, cast, receive, meshes }
  const isDynamic = (o) => { for (let p = o; p && p !== root; p = p.parent) if (p.userData.dynamic) return true; return false; };
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || isDynamic(o)) return;
    const g = o.geometry.index ? o.geometry : mergeVertices(o.geometry); // weld non-indexed shapes (octahedra etc.)
    let b = buckets.get(o.material);
    if (!b) buckets.set(o.material, (b = { geos: [], cast: false, receive: false, meshes: [], order: o.renderOrder }));
    const geo = g.clone();
    // Vertex colours are kept for materials that use them (painted skin); everything else is dropped.
    const keep = o.material.vertexColors ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
    for (const name of Object.keys(geo.attributes)) if (!keep.includes(name)) geo.deleteAttribute(name);
    if (keep.includes('color') && !geo.attributes.color) return;
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    // Mirrored transforms flip winding; skip those rather than render them inside-out.
    if (o.matrixWorld.determinant() < 0) return;
    b.geos.push(geo); b.meshes.push(o);
    b.cast ||= o.castShadow; b.receive ||= o.receiveShadow;
  });
  let saved = 0;
  for (const [material, b] of buckets) {
    if (b.meshes.length < 2) continue;
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, material);
    m.castShadow = keepShadowFlags ? b.cast : true;
    m.receiveShadow = keepShadowFlags ? b.receive : true;
    m.renderOrder = b.order;
    m.userData.merged = b.meshes.length;
    root.add(m);
    for (const o of b.meshes) o.parent?.remove(o);
    saved += b.meshes.length - 1;
  }
  // Drop now-empty groups so traversals stay cheap.
  const prune = (o) => { for (const c of [...o.children]) { prune(c); if (c.type === 'Group' && !c.children.length && !c.userData.dynamic && !Object.keys(c.userData).length) o.remove(c); } };
  prune(root);
  return saved;
}
