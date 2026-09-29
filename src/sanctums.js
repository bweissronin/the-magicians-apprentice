import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clay, stoneBlockTexture, shingleTexture } from './style.js';
import { runeCircleTexture } from './textures.js';
import { prop } from './assets.js';
import { mergeStatic } from './merge.js';
import { LightBank } from './lightbank.js';
import { mulberry32, fbm } from './util.js';
import { SANCTUMS } from './data.js';

// School sanctums: each realm's answer to the Arcane tower. Five stages per school, raised at
// a cornerstone in the realm with that realm's material plus valley resources. Every stage is
// a procedural build (plus Blender hero pieces from assets/models/sanctums.glb) that adds to
// the ones before it, so the structure visibly grows:
//   Necromancy — a cathedral built inside the ribcage of a fallen titan, its skull the belfry.
//   Pyromancy  — a basalt foundry, a hall of columns, bellows and chimneys, a volcano on its
//                roof and a phoenix on the crater.
//   Cryomancy  — a frozen heart on an ice dais, glacier halls, a walkable spiral ice bridge,
//                a turning snowflake rose window and a crown of aurora-lit needles.
// Stage builders receive a kit `k` to register colliders, camera blockers, walkable surfaces,
// lava, animation ticks and lights; the Sanctum turns those into world-space gameplay data.

export const SANCTUM_SITE = { x: 0, z: -30 };   // realm-space centre of every sanctum
export const PLANS_POS = { x: 0, z: -13 };      // the cornerstone where stages are raised
// Where each sanctum's door is (local z in front of the site): step here to go inside.
export const SANCTUM_DOOR_Z = { necromancy: 9.2, pyromancy: 8.4, cryomancy: 7.4, geomancy: 9.0 };

const rbox = (w, h, d, r = 0.1) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
const TAU = Math.PI * 2;
const U = { uTime: { value: 0 } }; // shared clock for every sanctum shader

// ---------------------------------------------------------------- materials
const matCache = {};
const once = (key, make) => (matCache[key] ||= make());
const glow = (c, i = 2) => once(`glow${c}${i}`, () => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 }));
const additive = (c, o = 0.35) => once(`add${c}${o}`, () => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
function texturedStone(key, tint, ru, rv, rough = 0.75) {
  return once(key, () => {
    const map = stoneBlockTexture(tint).clone(); map.needsUpdate = true; map.repeat.set(ru, rv);
    return clay('#ffffff', { map, roughness: rough, key });
  });
}
function shingles(key, c, d, ru, rv) {
  return once(key, () => {
    const map = shingleTexture(c, d).clone(); map.needsUpdate = true; map.repeat.set(ru, rv);
    return clay('#ffffff', { map, roughness: 0.6, key });
  });
}
const ice = (key = 'ice', color = '#bfe9ff', opacity = 0.86, emissive = 0.3) => once(key, () => new THREE.MeshStandardMaterial({
  color, emissive: '#3fa8e8', emissiveIntensity: emissive, roughness: 0.08, metalness: 0.1, transparent: opacity < 1, opacity, flatShading: true,
}));

// Molten rock: scrolling two-octave noise with a dark cooling crust. `flow` picks world-XZ
// drift (pools, moats) or UV-v flow (streams and falls running along their length).
function lavaMaterial(flow = 'xz') {
  return new THREE.ShaderMaterial({
    uniforms: U, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform float uTime; varying vec3 vW; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 p = ${flow === 'xz' ? 'vW.xz * 0.4 + vec2(uTime * 0.2, uTime * 0.08)' : 'vec2(vUv.x * 3.0, vUv.y * 8.0 + uTime * 1.2)'};
        float v = n(p) * 0.6 + n(p * 2.3 - uTime * 0.3) * 0.4;
        vec3 c = mix(vec3(0.95, 0.2, 0.02), vec3(1.0, 0.8, 0.25), smoothstep(0.45, 0.85, v));
        c = mix(c, vec3(0.22, 0.05, 0.02), smoothstep(0.35, 0.12, v));
        gl_FragColor = vec4(c * 1.15, 1.0);
      }`,
  });
}

// Additive swirl on a cone or disc (soul wells): spiral bands sliding inward over time.
function vortexMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uColor: { value: new THREE.Color(color) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float s = sin(vUv.x * 6.2831 * 3.0 + vUv.y * 14.0 - uTime * 4.0) * 0.5 + 0.5;
        float a = smoothstep(0.0, 0.35, vUv.y) * (0.35 + s * 0.65);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), s * 0.35) * a, a);
      }`,
  });
}

// Rising flame column: noise scrolls upward, fades toward the tip.
function flameMaterial(inner = '#ffe08a', outer = '#ff4a0a') {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uIn: { value: new THREE.Color(inner) }, uOut: { value: new THREE.Color(outer) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform float uTime; uniform vec3 uIn, uOut; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float v = n(vec2(vUv.x * 8.0, vUv.y * 4.0 - uTime * 2.5)) * 0.65 + n(vec2(vUv.x * 17.0, vUv.y * 9.0 - uTime * 4.0)) * 0.35;
        float a = (1.0 - vUv.y) * smoothstep(0.25, 0.75, v + (1.0 - vUv.y) * 0.35);
        gl_FragColor = vec4(mix(uOut, uIn, v) * a * 1.4, a);
      }`,
  });
}

// Aurora curtain: vertical folds drifting sideways, green below shading to violet above.
function auroraMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      void main(){
        float folds = sin(vUv.x * 40.0 + uTime * 0.9) * 0.5 + 0.5;
        folds *= sin(vUv.x * 13.0 - uTime * 0.6) * 0.3 + 0.7;
        float a = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y) * (0.35 + folds * 0.65);
        vec3 c = mix(vec3(0.25, 1.0, 0.65), vec3(0.65, 0.35, 1.0), vUv.y);
        gl_FragColor = vec4(c * a * 0.9, a);
      }`,
  });
}

// ---------------------------------------------------------------- geometry helpers
// A tube whose radius tapers from r0 to r1 along a Catmull-Rom path (bones, horns, pipes, tails).
function taperTube(points, r0, r1, seg = 28, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c);
    const t = i / seg, r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return { geo, curve };
}

// A bone: tapered shaft plus knobbly ends.
function bone(points, r0, r1, mat) {
  const g = new THREE.Group();
  const { geo, curve } = taperTube(points, r0, r1);
  g.add(new THREE.Mesh(geo, mat));
  const a = curve.getPointAt(0), b = curve.getPointAt(1);
  const k1 = new THREE.Mesh(new THREE.SphereGeometry(r0 * 1.35, 14, 10), mat); k1.position.copy(a); g.add(k1);
  const k2 = new THREE.Mesh(new THREE.SphereGeometry(r1 * 1.4, 12, 8), mat); k2.position.copy(b); g.add(k2);
  return g;
}

// Faceted crystal: a hexagonal prism with a pointed tip.
function crystalGeo(r, h) {
  return new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), new THREE.Vector2(r, h * 0.05), new THREE.Vector2(r, h * 0.72), new THREE.Vector2(0.001, h)], 6);
}

// A pointed (lancet) arch outline, for gothic windows and doors.
function lancetShape(w, h) {
  const s = new THREE.Shape(), r = w * 0.95, hw = w / 2, spring = h - Math.sqrt(r * r - (r - hw) * (r - hw));
  s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, spring);
  s.absarc(hw - r, spring, r, 0, Math.acos((r - hw) / r), false);
  s.absarc(-hw + r, spring, r, Math.PI - Math.acos((r - hw) / r), Math.PI, false);
  s.lineTo(-hw, 0);
  return s;
}
const extrude = (shape, depth, bevel = 0.04) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 16 });
  g.translate(0, 0, -depth / 2);
  return g;
};

function gearGeo(r, teeth, depth) {
  const s = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * TAU, a1 = ((i + 0.25) / teeth) * TAU, a2 = ((i + 0.5) / teeth) * TAU, a3 = ((i + 0.75) / teeth) * TAU;
    const ri = r * 0.84;
    const pts = [[ri, a0], [r, a1], [r, a2], [ri, a3]];
    pts.forEach(([rr, a], j) => (i === 0 && j === 0 ? s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)));
  }
  s.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, r * 0.22, 0, TAU, true); s.holes.push(hole);
  for (let i = 0; i < 5; i++) { // spoke windows
    const a = (i / 5) * TAU, c = r * 0.55, w = new THREE.Path();
    w.absarc(Math.cos(a) * c, Math.sin(a) * c, r * 0.17, 0, TAU, true); s.holes.push(w);
  }
  return extrude(s, depth, 0.05);
}

function snowflakeShape(R) {
  // Six arms, each a spine with two pairs of side branches, unioned as one outline by
  // tracing a polygon around the arm silhouettes.
  const s = new THREE.Shape(), pts = [];
  const arm = [[0.06, 0.12], [0.06, 0.42], [0.26, 0.58], [0.3, 0.54], [0.1, 0.4], [0.07, 0.68], [0.2, 0.8], [0.23, 0.76], [0.08, 0.66], [0.05, 0.95], [0, 1.0]];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    const rot = ([x, y]) => [Math.cos(a) * x * R - Math.sin(a) * y * R, Math.sin(a) * x * R + Math.cos(a) * y * R];
    const side = arm.map(rot), mirror = arm.slice(0, -1).reverse().map(([x, y]) => rot([-x, y]));
    pts.push(...side, ...mirror);
  }
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

function heroMesh(name, scale = 1) {
  const p = prop(name);
  if (!p) return null;
  p.scale.setScalar(scale);
  return p;
}

// Instanced copies of one hero mesh (skull niches, skull pyramids): one draw per material.
function instanced(name, transforms, fallbackGeo, fallbackMat) {
  const src = prop(name);
  let geo = fallbackGeo, mat = fallbackMat;
  src?.traverse((o) => { if (o.isMesh && geo === fallbackGeo) { geo = o.geometry; mat = o.material; } });
  const im = new THREE.InstancedMesh(geo, mat, transforms.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  transforms.forEach(({ p, r = [0, 0, 0], s = 1 }, i) => {
    m.compose(new THREE.Vector3(...p), q.setFromEuler(e.set(...r)), new THREE.Vector3(s, s, s));
    im.setMatrixAt(i, m);
  });
  im.castShadow = true; im.receiveShadow = true;
  return im;
}

function flame(size, mat) {
  const f = new THREE.Mesh(new THREE.ConeGeometry(size * 0.45, size * 1.4, 8), mat);
  f.position.y = size * 0.6;
  f.userData.flicker = true; f.userData.dynamic = true;
  return f;
}

function candleCluster(rand, n, spread, flameMat) {
  const g = new THREE.Group();
  const wax = clay('#efe6cc', { key: 'wax' });
  for (let i = 0; i < n; i++) {
    const h = 0.3 + rand() * 0.7, x = (rand() - 0.5) * spread, z = (rand() - 0.5) * spread;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, h, 8), wax); c.position.set(x, h / 2, z);
    const f = flame(0.14, flameMat); f.position.set(x, h + 0.08, z);
    g.add(c, f);
  }
  return g;
}

const shadowAll = (o) => {
  o.traverse((m) => {
    if (!m.isMesh || m.material.blending === THREE.AdditiveBlending || m.material.isShaderMaterial) return;
    m.receiveShadow = true;
    // Light sources (flames, orbs, glowing glass) and tiny fliers don't cast shadows: cheaper, and truer.
    m.castShadow = !(m.material.emissiveIntensity > 1) && !m.userData.noShadow;
  });
  return o;
};

// ---------------------------------------------------------------- the Sanctum
export class Sanctum {
  constructor(realm) {
    this.realm = realm;
    this.id = realm.id;
    this.def = SANCTUMS[realm.id];
    this.builders = BUILDERS[realm.id];
    this.root = new THREE.Group();
    this.root.position.set(SANCTUM_SITE.x, realm.theme.heightAt(SANCTUM_SITE.x, SANCTUM_SITE.z), SANCTUM_SITE.z);
    realm.scene.add(this.root);
    this.stages = [];
    this.anims = [];
    this.ghost = null;
    this.colliders = [];     // world space, fed to the player
    this.blockers = [];      // camera blockers {x, z, r, top}
    this.surfaces = [];      // (lx, lz, ly) => local walkable height or -Infinity
    this.lava = [];          // (lx, lz) => true if molten
  }

  get count() { return this.stages.length; }
  get top() { return this.stages.reduce((m, s) => Math.max(m, s.top), 4); }
  get world() { return this.root.position; }

  kit(real) {
    const o = this.root.position, rand = mulberry32(this.stages.length * 97 + this.id.length);
    const ticks = [], lights = [];
    const k = {
      rand, fx: this.realm.fx, ticks, lights,
      W: (x, y, z) => new THREE.Vector3(o.x + x, o.y + y, o.z + z),
      tick: (fn) => ticks.push(fn),
      dyn: (obj) => { obj.userData.dynamic = true; return obj; },
      // An animated group that moves as one piece: its parts are merged among themselves.
      rigid: (obj) => { obj.userData.dynamic = true; obj.userData.rigid = true; return obj; },
      // Optional extra.top / extra.bottom (local heights) let the player stand on or walk under it.
      collide: (x, z, radius, extra = {}) => real && this.colliders.push({
        x: o.x + x, z: o.z + z, radius,
        ...(extra.top !== undefined ? { top: o.y + extra.top } : {}),
        ...(extra.bottom !== undefined ? { bottom: o.y + extra.bottom } : {}),
      }),
      block: (x, z, r, top) => real && this.blockers.push({ x: o.x + x, z: o.z + z, r, top: o.y + top }),
      surface: (fn) => real && this.surfaces.push(fn),
      lavaZone: (fn) => real && this.lava.push(fn),
      light: (l) => { lights.push(l); return l; },
    };
    return k;
  }

  make(i, real) {
    const k = this.kit(real);
    const out = this.builders[i](k, this);
    return { ...out, ticks: k.ticks, lights: k.lights };
  }

  setStages(n) {
    for (let i = this.stages.length; i < n; i++) this.addStage(i, false);
    this.refreshGhost();
    this.refreshRuin();
    // Room for the lights of the stages still to come (see lightbank.js).
    this.bank ||= new LightBank(this.root);
    let lights = 0;
    for (let i = this.stages.length; i < this.builders.length; i++) lights += this.make(i, false).lights.length;
    this.bank.hold(lights);
  }

  // Build a stage ready to place (so its shaders can be compiled before it appears).
  prepareStage(i) {
    const built = this.make(i, true);
    const g = built.group;
    shadowAll(g);
    const rigid = [];
    g.traverse((o) => { if (o.userData.rigid) rigid.push(o); });
    rigid.forEach((o) => mergeStatic(o));
    mergeStatic(g);
    return built;
  }

  // Before the first stage, the site holds the rubble of Aldric's fallen tower.
  refreshRuin() {
    if (this.stages.length && this.ruin) { this.root.remove(this.ruin); this.ruin = null; this.realm.fx.burst(this.root.position.clone().setY(this.root.position.y + 2), { count: 120, color: '#cfc4b0', speed: 10, size: 0.9, life: 1.4, gravity: 8 }); }
    if (this.stages.length || this.ruin) return;
    const g = new THREE.Group();
    [[-5, -2, 0.3, 1.2], [5, -5, 2.1, 1], [0, -9, 4, 1.3], [-2, 4, 5.5, 0.8]].forEach(([x, z, r, sc]) => {
      const p = prop('rubble_pile');
      if (!p) return;
      p.scale.setScalar(sc); p.position.set(x, 0, z); p.rotation.y = r; g.add(p);
    });
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    this.ruin = g; this.root.add(g);
  }

  addStage(i, animate = true, prepared = null) {
    const built = prepared || this.prepareStage(i);
    const g = built.group;
    this.root.add(g);
    this.bank?.admit(g);
    this.hideFromAO(g);
    const st = { group: g, top: built.top, ticks: built.ticks, index: i };
    // Its full-size bounds in the world, for the camera to frame.
    g.updateWorldMatrix(true, true);
    st.box = new THREE.Box3().setFromObject(g);
    this.stages.push(st);
    if (animate) {
      g.scale.setScalar(0.001);
      this.anims.push({ st, t: 0 });
      this.realm.fx.ring(this.root.position.clone(), { count: 160, color: this.realm.def.color, speed: 16, size: 0.8, life: 1.8, y: 0.6 });
    }
    this.refreshGhost();
    this.refreshRuin();
    return st;
  }

  // Wireframe hologram of the next stage, so the goal is always visible in the realm.
  refreshGhost() {
    if (this.ghost) { this.root.remove(this.ghost); this.ghost = null; }
    const next = this.stages.length;
    if (next >= this.builders.length) return;
    const { group } = this.make(next, false);
    // On the bright glacier a pale hologram vanishes into the snow, so it's drawn in deep blue.
    const color = this.id === 'cryomancy' ? '#2f78c8' : this.id === 'geomancy' ? '#ffb347' : this.realm.def.color;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, wireframe: true, depthWrite: false });
    const drop = [];
    group.traverse((o) => {
      if (o.isMesh || o.isPoints) { o.material = mat; o.castShadow = false; o.receiveShadow = false; o.userData.dynamic = false; }
      if (o.isLight) drop.push(o);
    });
    drop.forEach((l) => l.parent.remove(l));
    group.traverse((o) => { o.userData.dynamic = false; });
    mergeStatic(group);
    this.hideFromAO(group);
    group.userData.ghostMat = mat;
    this.ghost = group;
    this.root.add(group);
  }

  // Glows, curtains and holograms don't write depth; keep them out of the AO normal pass too,
  // or the ambient-occlusion shader darkens them into black sheets.
  hideFromAO(g) {
    g.traverse((o) => {
      const m = o.material;
      if (o.isMesh && m && (m.blending === THREE.AdditiveBlending || m.depthWrite === false)) this.realm.aoHide?.(o);
    });
  }

  // Highest walkable sanctum surface under (x, z), however high (for ledges: see player.js).
  solidAt(x, z) {
    if (!this.surfaces.length) return -Infinity;
    const o = this.root.position;
    let best = -Infinity;
    for (const fn of this.surfaces) best = Math.max(best, fn(x - o.x, z - o.z));
    return best === -Infinity ? best : best + o.y;
  }

  // Highest walkable sanctum surface under (x, z) that the player can step onto from height y.
  surfaceAt(x, z, y) {
    if (!this.surfaces.length) return -Infinity;
    const o = this.root.position, lx = x - o.x, lz = z - o.z, ly = y - o.y;
    let best = -Infinity;
    for (const fn of this.surfaces) {
      const h = fn(lx, lz);
      if (h > best && h <= ly + 0.75) best = h;
    }
    return best === -Infinity ? best : best + o.y;
  }

  lavaAt(x, z) {
    const o = this.root.position;
    return this.lava.some((fn) => fn(x - o.x, z - o.z));
  }

  update(dt, t, player) {
    U.uTime.value = t;
    for (const a of [...this.anims]) {
      a.t += dt / 2.8;
      const e = Math.min(1, a.t);
      const s = Math.max(0.001, 1 + 2.2 * Math.pow(e - 1, 3) + 1.2 * Math.pow(e - 1, 2));
      a.st.group.scale.setScalar(s);
      if (Math.random() < 0.9) {
        const ang = t * 6 + Math.random() * TAU, r = 8 + Math.random() * 6;
        this.realm.fx.spawn(this.root.position.x + Math.cos(ang) * r, this.root.position.y + Math.random() * a.st.top * s, this.root.position.z + Math.sin(ang) * r,
          -Math.sin(ang) * 4, 3, Math.cos(ang) * 4, new THREE.Color(this.realm.def.color), 0.7, 1.4, 0, 0.8);
      }
      if (e >= 1) { a.st.group.scale.setScalar(1); this.anims.splice(this.anims.indexOf(a), 1); }
    }
    for (const st of this.stages) for (const fn of st.ticks) fn(dt, t, player);
    for (const st of this.stages) st.group.traverse((o) => { if (o.userData.flicker) o.scale.y = 0.8 + Math.random() * 0.4; });
    if (this.ghost) this.ghost.userData.ghostMat.opacity = (this.id === 'cryomancy' ? 0.22 : 0.09) + Math.sin(t * 2) * 0.05;
  }
}

// Builders are appended below per school.
const BUILDERS = {};

// ================================================================ Necromancy: The Titan's Ossuary
// A titan lies prone beneath the crypt: its ribs arch out of the earth and meet at a spine
// that forms the ridge of the nave; the tail sweeps over the approach; its skull becomes the belfry.
const NECRO = {
  ribZ: [5, 2, -1, -4, -7, -10, -13],
  ribS: [0.8, 0.92, 1, 1, 0.98, 0.9, 0.8],
  ridgeY: 12.4,
  belfryZ: -18.5,
};
const boneMat = () => clay('#e9e0c8', { roughness: 0.72, key: 'titanBone' });
const slate = () => texturedStone('necroSlate', '#6d6778', 4, 2.2);
const soulGreen = '#5dff8a';

// Vertebrae (Blender) threaded along a curve, each aligned to the tangent with its spine up.
function vertebraChain(points, n, s0, s1, up = new THREE.Vector3(0, 1, 0)) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const s = s0 + (s1 - s0) * t;
    const v = heroMesh('vertebra', s) || new THREE.Mesh(new THREE.CylinderGeometry(0.4 * s, 0.4 * s, 0.5 * s, 12).rotateX(Math.PI / 2), boneMat());
    v.position.copy(p);
    v.up.copy(up);
    v.lookAt(p.clone().add(tan));
    g.add(v);
  }
  return g;
}

function necroTitan(k) {
  const g = new THREE.Group(), rand = k.rand, bm = boneMat();
  // The excavation: dark turned earth, a spoil berm and soul-light leaking through cracks.
  const pit = new THREE.Mesh(new THREE.CircleGeometry(15.5, 64), clay('#2a2420', { roughness: 0.95, key: 'pitEarth' }));
  pit.rotation.x = -Math.PI / 2; pit.position.y = 0.04; g.add(pit);
  const berm = new THREE.Mesh(new THREE.TorusGeometry(15.6, 1.1, 8, 72), clay('#3b3129', { roughness: 0.95, key: 'berm' }));
  berm.rotation.x = Math.PI / 2; berm.scale.z = 0.35; g.add(berm);
  const crack = glow(soulGreen, 1.8);
  for (let i = 0; i < 18; i++) {
    const a = rand() * TAU, r = 3 + rand() * 11;
    const c = new THREE.Mesh(rbox(0.14, 0.05, 1.5 + rand() * 3, 0.02), crack);
    c.position.set(Math.sin(a) * r, 0.06, Math.cos(a) * r); c.rotation.y = rand() * Math.PI; g.add(c);
  }
  const rubbleM = clay('#4a4452', { roughness: 0.9, key: 'rubble' });
  for (let i = 0; i < 26; i++) {
    const a = rand() * TAU, r = 14 + rand() * 2.5;
    const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rand() * 0.5, 0), rubbleM);
    rk.position.set(Math.sin(a) * r, 0.2, Math.cos(a) * r); rk.rotation.set(rand() * 3, rand() * 3, 0); g.add(rk);
  }
  // Ribs: seven pairs rising from the soil and curving in to meet the spine.
  NECRO.ribZ.forEach((z, i) => {
    const s = NECRO.ribS[i];
    for (const side of [-1, 1]) {
      const pts = [[7.6 * s, 0, 0], [8.8 * s, 4, 0.1], [7.4 * s, 8.4, -0.3], [4.2 * s, 11.4, -0.5], [1.0, NECRO.ridgeY - 0.1, -0.4]]
        .map(([x, y, dz]) => [side * x, y, z + dz]);
      g.add(bone(pts, 0.62 * s, 0.3, bm));
      k.collide(side * 7.6 * s, z, 0.85);
    }
  });
  // The spine forms the ridge; the tail sweeps south over the approach and down to the east.
  // The spine forms the ridge, tapering and dipping where the tail once was.
  g.add(vertebraChain([[0, 12.2, -15], [0, 12.6, -8], [0, 12.6, 0], [0, 12.3, 5.2], [0, 11.4, 7.4]], 28, 1.45, 0.9));
  // A colossal hand claws out of the earth beside the dig.
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1.3, 20, 14), bm); palm.scale.set(1.25, 0.5, 1.05); palm.position.y = 0.5; hand.add(palm);
  [[-1.0, 1.0], [-0.35, 1.18], [0.3, 1.1], [0.9, 0.9]].forEach(([fx, L]) => {
    const pts = [[fx, 0.8, -0.5], [fx * 1.1, 2.4 * L, -1.0 * L], [fx * 1.15, 3.9 * L, -0.4 * L], [fx * 1.1, 4.6 * L, 0.7 * L], [fx, 4.3 * L, 1.4 * L]];
    for (let j = 0; j < pts.length - 1; j++) hand.add(bone([pts[j], pts[j + 1]], 0.3 - j * 0.04, 0.26 - j * 0.04, bm));
  });
  const thumb = [[1.3, 0.6, 0.3], [2.2, 1.7, 0.7], [2.7, 2.7, 1.3], [2.6, 3.3, 1.9]];
  for (let j = 0; j < thumb.length - 1; j++) hand.add(bone([thumb[j], thumb[j + 1]], 0.32 - j * 0.05, 0.27 - j * 0.05, bm));
  hand.position.set(-12, 0, 6.5); hand.rotation.y = 0.9;
  g.add(hand); k.collide(-12, 6.5, 2.0);
  // Excavators' lanterns on crooked poles, and abandoned shovels.
  const iron = clay('#2b2833', { roughness: 0.45, key: 'ironFence' });
  const wood = clay('#5a4636', { key: 'digWood' });
  [-2.4, -1.5, 1.6, 2.5, 3.14].forEach((a) => {
    const lp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.4, 6), wood); pole.position.y = 1.7; pole.rotation.z = (rand() - 0.5) * 0.12;
    const arm = new THREE.Mesh(rbox(0.9, 0.08, 0.08, 0.03), iron); arm.position.set(0.4, 3.3, 0);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 6, 1, true), iron); cage.position.set(0.8, 2.85, 0);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), glow(soulGreen, 2.6)); orb.position.set(0.8, 2.85, 0);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.25, 6), iron); cap.position.set(0.8, 3.2, 0);
    lp.add(pole, arm, cage, orb, cap);
    lp.position.set(Math.sin(a) * 13.6, 0, Math.cos(a) * 13.6); lp.rotation.y = a + Math.PI / 2;
    g.add(lp);
  });
  [[-5, 9, 0.4], [6.5, -15, -0.5]].forEach(([x, z, r]) => {
    const sh = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), wood); handle.position.y = 0.9;
    const blade = new THREE.Mesh(rbox(0.4, 0.5, 0.05, 0.03), iron); blade.position.y = -0.05;
    sh.add(handle, blade); sh.position.set(x, 0.2, z); sh.rotation.set(r, rand() * 3, 0.3); g.add(sh);
  });
  const l = k.light(new THREE.PointLight(soulGreen, 22, 34, 1.6)); l.position.set(0, 3, -4); g.add(l);
  k.tick((dt) => {
    if (Math.random() < dt * 6) {
      const a = Math.random() * TAU, r = 3 + Math.random() * 11, p = k.W(Math.sin(a) * r, 0.1, Math.cos(a) * r);
      k.fx.spawn(p.x, p.y, p.z, 0, 0.8 + Math.random(), 0, new THREE.Color(soulGreen), 0.3, 2.2, 0, 0.2);
    }
  });
  return { group: g, top: 14 };
}

function necroNave(k) {
  const g = new THREE.Group(), rand = k.rand, bm = boneMat(), wall = slate();
  const L = 17.5, zc = -4.25, front = 4.5, back = -13, floorY = 0.9;
  const dark = clay('#262230', { roughness: 0.8, key: 'nicheDark' });
  const trimM = clay('#8a8496', { roughness: 0.7, key: 'naveTrim' });
  // Walls on a raised plinth.
  const plinth = new THREE.Mesh(rbox(9.8, floorY, L + 1.2, 0.15), trimM); plinth.position.set(0, floorY / 2, zc); g.add(plinth);
  for (const s of [-1, 1]) { const w = new THREE.Mesh(rbox(0.7, 7, L, 0.12), wall); w.position.set(s * 4.2, floorY + 3.5, zc); g.add(w); }
  const rear = new THREE.Mesh(rbox(9.1, 7, 0.7, 0.12), wall); rear.position.set(0, floorY + 3.5, back); g.add(rear);
  const facade = new THREE.Mesh(rbox(9.1, 7, 0.8, 0.12), wall); facade.position.set(0, floorY + 3.5, front); g.add(facade);
  // Gables and a steep slate roof beneath the spine.
  const gable = new THREE.Shape([new THREE.Vector2(-4.8, 0), new THREE.Vector2(4.8, 0), new THREE.Vector2(0, 3.6)]);
  for (const z of [front, back]) { const gb = new THREE.Mesh(extrude(gable, 0.7, 0.05), wall); gb.position.set(0, floorY + 7, z); g.add(gb); }
  const roofM = shingles('naveRoof', '#4d4659', '#2e2a38', 3, 9);
  const slope = Math.atan2(3.6, 4.8), span = Math.hypot(4.8, 3.6) + 0.5;
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(rbox(span, 0.35, L + 1.6, 0.1), roofM);
    r.position.set(s * 2.3, floorY + 8.9, zc); r.rotation.z = -s * slope; g.add(r);
  }
  for (let z = front; z > back; z -= 1.4) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 8), bm); spike.position.set(0, floorY + 10.9, z); g.add(spike);
  }
  // Lancet windows glowing with soul-light, set in dark stone frames.
  const glass = glow(soulGreen, 1.5), frameM = clay('#3a3644', { key: 'lancetFrame' });
  const winGeo = extrude(lancetShape(1.2, 3.3), 0.1, 0), frameGeo = extrude(lancetShape(1.7, 3.8), 0.24, 0.04);
  const windowZ = [2.2, -2.1, -6.4, -10.7];
  for (const s of [-1, 1]) for (const z of windowZ) {
    const f = new THREE.Mesh(frameGeo, frameM); f.position.set(s * 4.55, floorY + 1.6, z); f.rotation.y = s * Math.PI / 2; g.add(f);
    const w = new THREE.Mesh(winGeo, glass); w.position.set(s * 4.7, floorY + 1.85, z); w.rotation.y = s * Math.PI / 2; g.add(w);
    const mull = new THREE.Mesh(rbox(0.1, 3.1, 0.1, 0.03), frameM); mull.position.set(s * 4.78, floorY + 3.4, z); g.add(mull);
  }
  // Skull niches between the windows: recessed panels packed with the watching dead.
  const skulls = [];
  for (const s of [-1, 1]) for (const z of [0.05, -4.25, -8.55]) {
    const panel = new THREE.Mesh(rbox(0.25, 4.6, 2.0, 0.05), dark); panel.position.set(s * 4.5, floorY + 3.4, z); g.add(panel);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) {
      skulls.push({ p: [s * 4.66, floorY + 1.35 + r * 0.86, z + (c - 0.5) * 0.9], r: [0, s * Math.PI / 2 + (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.2], s: 0.27 });
    }
  }
  const frieze = new THREE.Mesh(rbox(7.2, 0.95, 0.3, 0.05), dark); frieze.position.set(0, floorY + 5.9, front + 0.45); g.add(frieze);
  for (let i = 0; i < 8; i++) skulls.push({ p: [-3.15 + i * 0.9, floorY + 5.55, front + 0.55], s: 0.24 });
  // Ossuary pyramids of stacked skulls either side of the steps.
  for (const s of [-1, 1]) {
    for (let lvl = 0; lvl < 4; lvl++) {
      const n = 4 - lvl;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
        skulls.push({ p: [s * 5.7 + (a - (n - 1) / 2) * 0.62, lvl * 0.52, 8.2 + (b - (n - 1) / 2) * 0.62], r: [0, (rand() - 0.5) * 0.5, 0], s: 0.23 });
      }
    }
    k.collide(s * 5.7, 8.2, 1.4);
  }
  g.add(instanced('skull_small', skulls, new THREE.SphereGeometry(1, 10, 8), bm));
  // Rose window: a wheel of bone spokes around a glowing heart.
  const rose = new THREE.Group();
  rose.add(new THREE.Mesh(new THREE.CircleGeometry(1.35, 40), glass));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.17, 10, 40), bm); rose.add(rim);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    rose.add(bone([[Math.cos(a) * 0.25, Math.sin(a) * 0.25, 0.05], [Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0.05]], 0.07, 0.07, bm));
  }
  rose.position.set(0, floorY + 8.4, front + 0.42); g.add(rose);
  // The great door: iron leaves split by a seam of soul-light, framed in bone.
  const door = new THREE.Mesh(extrude(lancetShape(2.3, 4.0), 0.2, 0.03), clay('#1f1b27', { roughness: 0.5, key: 'naveDoor' }));
  door.position.set(0, floorY, front + 0.42); g.add(door);
  const seam = new THREE.Mesh(rbox(0.07, 3.4, 0.08, 0.02), glass); seam.position.set(0, floorY + 1.8, front + 0.56); g.add(seam);
  const outline = lancetShape(2.7, 4.35).getPoints(24).filter((p) => p.y > 0.05).map((p) => [p.x, floorY + p.y, front + 0.55]);
  g.add(bone(outline, 0.17, 0.17, bm));
  // Bone pillars flanking the steps, crowned with candle-lit skulls.
  const flameM = glow('#9dffb8', 3);
  for (const s of [-1, 1]) {
    const col = vertebraChain([[s * 3.6, 0.3, 6.2], [s * 3.6, 3.4, 6.2], [s * 3.6, 5.6, 6.2]], 8, 1.1, 0.95, new THREE.Vector3(0, 0, 1));
    g.add(col);
    const sk = heroMesh('skull_small', 0.38); if (sk) { sk.position.set(s * 3.6, 6.0, 6.2); g.add(sk); }
    const c = candleCluster(rand, 3, 0.4, flameM); c.position.set(s * 3.6, 6.9, 6.1); g.add(c);
    k.collide(s * 3.6, 6.2, 0.7);
  }
  // Worn steps up to the door, with candle clusters on the top step.
  for (let i = 0; i < 3; i++) {
    const st = new THREE.Mesh(rbox(4.2 - i * 0.2, 0.3, 1.0, 0.08), trimM);
    st.position.set(0, floorY - 0.15 - i * 0.3, front + 0.95 + i * 0.95); g.add(st);
  }
  for (const s of [-1, 1]) { const c = candleCluster(rand, 6, 0.8, flameM); c.position.set(s * 1.7, floorY, front + 1.1); g.add(c); }
  // The plinth and the steps are things you stand on (the plinth is a ledge: see player.js).
  k.surface((x, z) => (Math.abs(x) < 4.9 && z > zc - (L + 1.2) / 2 && z < zc + (L + 1.2) / 2 ? floorY : -Infinity));
  k.surface((x, z) => { for (let i = 2; i >= 0; i--) { const cz = front + 0.95 + i * 0.95; if (Math.abs(x) < (4.2 - i * 0.2) / 2 && Math.abs(z - cz) < 0.5) return floorY - i * 0.3; } return -Infinity; });
  [2.5, -1, -4.5, -8, -11.5].forEach((z) => k.collide(0, z, 4.55));
  [1, -4.5, -10].forEach((z) => k.block(0, z, 5, 11));
  return { group: g, top: 13 };
}

function necroWells(k) {
  const g = new THREE.Group(), rand = k.rand, bm = boneMat();
  const iron = clay('#2b2833', { roughness: 0.45, key: 'ironFence' });
  const wellStone = texturedStone('wellStone', '#8a8599', 4, 0.8);
  const spots = [[-11, 3], [11, 3], [-11, -9], [11, -9]];
  const vortexM = vortexMaterial(soulGreen);
  const lanterns = [];
  spots.forEach(([x, z], i) => {
    const w = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(1.55, -1.4), new THREE.Vector2(1.6, 1.0), new THREE.Vector2(2.15, 1.05), new THREE.Vector2(2.2, 1.3),
      new THREE.Vector2(2.05, 1.4), new THREE.Vector2(1.95, 0.2), new THREE.Vector2(2.1, 0.0)].reverse(), 28), wellStone);
    w.add(ring);
    const abyss = new THREE.Mesh(new THREE.CircleGeometry(1.56, 28), new THREE.MeshBasicMaterial({ color: '#050a07' }));
    abyss.rotation.x = -Math.PI / 2; abyss.position.y = -1.2; w.add(abyss);
    const vortex = k.dyn(new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.4, 32, 1, true), vortexM));
    vortex.rotation.x = Math.PI; vortex.position.y = 0.0; w.add(vortex);
    // Crossed bone arches with a chain and a swaying soul lantern.
    for (const r of [0, Math.PI / 2]) {
      const arch = bone([[-2.0, 1.2, 0], [-1.5, 3.4, 0], [0, 4.3, 0], [1.5, 3.4, 0], [2.0, 1.2, 0]], 0.17, 0.17, bm);
      arch.rotation.y = r; w.add(arch);
    }
    const lantern = k.rigid(new THREE.Group());
    for (let c = 0; c < 7; c++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 10), iron);
      link.position.y = -c * 0.17; link.rotation.y = c % 2 ? Math.PI / 2 : 0; lantern.add(link);
    }
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.6, 6, 1, true), iron); cage.position.y = -1.55;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), glow(soulGreen, 3)); orb.position.y = -1.55;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.3, 6), iron); cap.position.y = -1.15;
    lantern.add(cage, orb, cap);
    lantern.position.y = 4.2; w.add(lantern);
    lanterns.push({ o: lantern, ph: i * 1.7 });
    for (let s = 0; s < 3; s++) {
      const sk = heroMesh('skull_small', 0.22);
      if (!sk) break;
      const a = s * 2.1 + 0.5; sk.position.set(Math.sin(a) * 2.05, 1.4, Math.cos(a) * 2.05); sk.rotation.y = a; w.add(sk);
    }
    w.position.set(x, 0, z); g.add(w);
    k.collide(x, z, 2.3);
  });
  // Soul lanterns hung from the ribs along the nave.
  [2, -4, -10].forEach((z, i) => {
    for (const s of [-1, 1]) {
      const h = k.rigid(new THREE.Group());
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), iron); chain.position.y = -1.1;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), glow('#b8ffcc', 2.4)); orb.position.y = -2.4;
      const cage = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ color: '#2b2833', wireframe: true })); cage.position.y = -2.4;
      h.add(chain, orb, cage);
      h.position.set(s * 6.3, 10.3, z); g.add(h);
      lanterns.push({ o: h, ph: i + s });
    }
  });
  // Restless ghosts circling the ossuary.
  const ghosts = [];
  const ghostM = additive('#9dffc0', 0.45);
  for (let i = 0; i < 6; i++) {
    const gh = k.rigid(new THREE.Group());
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), ghostM);
    const tailM = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.8, 12, 1, true), ghostM); tailM.rotation.x = -Math.PI / 2; tailM.position.z = -1.0;
    gh.add(head, tailM); g.add(gh);
    ghosts.push({ o: gh, r: 12 + rand() * 4, y: 3 + rand() * 7, sp: 0.25 + rand() * 0.2, ph: rand() * TAU });
  }
  const l1 = k.light(new THREE.PointLight(soulGreen, 14, 20, 1.8)); l1.position.set(-11, 2.5, -3); g.add(l1);
  const l2 = k.light(new THREE.PointLight(soulGreen, 14, 20, 1.8)); l2.position.set(11, 2.5, -3); g.add(l2);
  k.tick((dt, t) => {
    lanterns.forEach(({ o, ph }) => { o.rotation.z = Math.sin(t * 1.1 + ph) * 0.12; o.rotation.x = Math.cos(t * 0.9 + ph) * 0.08; });
    ghosts.forEach((gh) => {
      const a = t * gh.sp + gh.ph;
      gh.o.position.set(Math.sin(a) * gh.r, gh.y + Math.sin(t * 1.3 + gh.ph) * 0.8, -4 + Math.cos(a) * gh.r * 1.1);
      gh.o.rotation.y = a + Math.PI / 2;
    });
    // Souls spiral up out of each well.
    if (Math.random() < dt * 16) {
      const [x, z] = spots[Math.floor(Math.random() * 4)], a = Math.random() * TAU, p = k.W(x + Math.sin(a) * 0.8, 0.6, z + Math.cos(a) * 0.8);
      k.fx.spawn(p.x, p.y, p.z, Math.cos(a) * 0.5, 2.2 + Math.random() * 1.5, -Math.sin(a) * 0.5, new THREE.Color(Math.random() < 0.5 ? soulGreen : '#d8ffe4'), 0.35, 2.2, -0.4, 0.3);
    }
  });
  return { group: g, top: 13 };
}

function necroBelfry(k) {
  const g = new THREE.Group(), rand = k.rand, bm = boneMat(), wall = texturedStone('belfryWall', '#6d6778', 3, 3.4);
  const Z = NECRO.belfryZ, trimM = clay('#8a8496', { roughness: 0.7, key: 'naveTrim' });
  const tower = new THREE.Mesh(rbox(6.4, 10.4, 6.4, 0.15), wall); tower.position.set(0, 5.2, Z); g.add(tower);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const b = new THREE.Mesh(rbox(1.3, 11, 1.3, 0.12), trimM); b.position.set(x * 3.2, 5.5, Z + z * 3.2); g.add(b);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.6, 4), clay('#4d4659', { key: 'belfryCap' }));
    cap.position.set(x * 3.2, 11.8, Z + z * 3.2); cap.rotation.y = Math.PI / 4; g.add(cap);
  }
  const slits = glow(soulGreen, 1.4), slitGeo = extrude(lancetShape(0.5, 1.6), 0.1, 0);
  [3, 6.5].forEach((y) => [-1.4, 1.4].forEach((x) => { const s = new THREE.Mesh(slitGeo, slits); s.position.set(x, y, Z + 3.25); g.add(s); }));
  const cornice = new THREE.Mesh(rbox(7.6, 0.7, 7.6, 0.12), trimM); cornice.position.set(0, 10.6, Z); g.add(cornice);
  // Open arcade holding the bell.
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const p = new THREE.Mesh(rbox(1.0, 4.4, 1.0, 0.1), wall); p.position.set(x * 2.9, 13.1, Z + z * 2.9); g.add(p);
  }
  for (const [rx, rz, ry] of [[0, 2.9, 0], [0, -2.9, 0], [2.9, 0, Math.PI / 2], [-2.9, 0, Math.PI / 2]]) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.32, 8, 20, Math.PI), trimM);
    arch.position.set(rx, 13.6, Z + rz); arch.rotation.y = ry; g.add(arch);
  }
  const top = new THREE.Mesh(rbox(7.6, 0.8, 7.6, 0.12), trimM); top.position.set(0, 15.6, Z); g.add(top);
  const yoke = new THREE.Mesh(rbox(5.8, 0.4, 0.45, 0.06), clay('#3a2e24', { key: 'yoke' })); yoke.position.set(0, 14.9, Z); g.add(yoke);
  const bellPivot = k.rigid(new THREE.Group()); bellPivot.position.set(0, 14.7, Z); g.add(bellPivot);
  const bellM = heroMesh('bell', 2.1) || new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 20, 1, true), clay('#b98a4c'));
  bellPivot.add(bellM);
  // The titan's skull crowns the belfry, jaw working slowly as if chanting.
  const S = 3.3, skull = k.dyn(new THREE.Group());
  const sk = heroMesh('titan_skull', S) || new THREE.Mesh(new THREE.SphereGeometry(3.3, 24, 18), bm);
  skull.add(sk);
  const jaw = heroMesh('titan_jaw', S);
  if (jaw) { jaw.position.set(0, -0.55 * S, 0.05 * S); skull.add(jaw); }
  skull.position.set(0, 16.0 + 1.25 * S, Z + 0.3); g.add(skull);
  const eyes = k.light(new THREE.PointLight(soulGreen, 30, 26, 1.6)); eyes.position.set(0, skull.position.y, Z + 4.5); g.add(eyes);
  g.add(vertebraChain([[0, NECRO.ridgeY - 0.1, -15], [0, 13.6, -16.4], [0, 15.8, -17]], 4, 1.4, 1.5));
  // Bats wheeling around the skull.
  const bats = [], batM = clay('#1c1822', { roughness: 0.6, key: 'bat' });
  const wingGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.9, 0.1, -0.1), new THREE.Vector3(0.5, 0, 0.35), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.5, 0, 0.35), new THREE.Vector3(0.1, 0, 0.4)]);
  wingGeo.computeVertexNormals();
  const wingM = new THREE.MeshStandardMaterial({ color: '#2a2230', side: THREE.DoubleSide, roughness: 0.7 });
  for (let i = 0; i < 10; i++) {
    const b = k.dyn(new THREE.Group());
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), batM); body.userData.noShadow = true; body.scale.z = 1.5; b.add(body);
    const wl = new THREE.Mesh(wingGeo, wingM), wr = new THREE.Mesh(wingGeo, wingM); wr.scale.x = -1;
    wl.userData.noShadow = wr.userData.noShadow = true;
    b.add(wl, wr); g.add(b);
    bats.push({ o: b, wl, wr, r: 6 + rand() * 5, y: 17 + rand() * 8, sp: 0.6 + rand() * 0.6, ph: rand() * TAU, dir: rand() < 0.5 ? 1 : -1 });
  }
  k.tick((dt, t) => {
    bellPivot.rotation.z = Math.sin(t * 1.3) * 0.22;
    if (jaw) jaw.rotation.x = (Math.sin(t * 0.9) * 0.5 + 0.5) * 0.14;
    skull.rotation.y = Math.sin(t * 0.25) * 0.06;
    eyes.intensity = 26 + Math.sin(t * 2.2) * 8;
    bats.forEach((b) => {
      const a = t * b.sp * b.dir + b.ph;
      b.o.position.set(Math.sin(a) * b.r, b.y + Math.sin(t * 2 + b.ph) * 1.2, Z + Math.cos(a) * b.r);
      b.o.rotation.y = a + (b.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const f = Math.sin(t * 16 + b.ph) * 0.8;
      b.wl.rotation.z = f; b.wr.rotation.z = -f;
    });
  });
  k.collide(0, Z, 4.6);
  k.block(0, Z, 4.8, 24);
  return { group: g, top: 25 };
}

function necroCrown(k) {
  const g = new THREE.Group(), bm = boneMat(), Z = NECRO.belfryZ;
  // Four curved bone horns rise from the belfry corners, tipped with ghost-fire.
  const flameM = glow('#9dffb8', 3.2);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    g.add(bone([[x * 3.2, 15.9, Z + z * 3.2], [x * 3.9, 18.5, Z + z * 3.9], [x * 5.0, 21.5, Z + z * 5.0], [x * 5.1, 24.0, Z + z * 5.1]], 0.5, 0.1, bm));
    const f = flame(0.55, flameM); f.position.set(x * 5.1, 24.1, Z + z * 5.1); g.add(f);
  }
  // A crown of tombstones orbiting the skull.
  const crown = k.dyn(new THREE.Group());
  const stoneM = clay('#9a94a6', { roughness: 0.7, key: 'crownStone' }), rune = glow(soulGreen, 2.2);
  const stones = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU, ts = k.rigid(new THREE.Group());
    const slab = new THREE.Mesh(rbox(1.5, 2.0, 0.35, 0.08), stoneM); ts.add(slab);
    const arc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.35, 16, 1, false, 0, Math.PI), stoneM);
    arc.rotation.set(Math.PI / 2, 0, Math.PI / 2); arc.position.y = 1.0; ts.add(arc);
    const cv = new THREE.Mesh(rbox(0.14, 0.9, 0.05, 0.02), rune); cv.position.set(0, 0.35, 0.19); ts.add(cv);
    const ch = new THREE.Mesh(rbox(0.6, 0.14, 0.05, 0.02), rune); ch.position.set(0, 0.5, 0.19); ts.add(ch);
    ts.position.set(Math.sin(a) * 7.5, 0, Math.cos(a) * 7.5); ts.rotation.set(-0.25, a, 0, 'YXZ');
    crown.add(ts); stones.push(ts);
  }
  crown.position.set(0, 27.2, Z); g.add(crown);
  // The phylactery: a soul-gem in a gilded cage, the lich's hidden heart.
  const phyl = k.rigid(new THREE.Group());
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.95, 0), glow('#7dff9b', 3.2)); gem.scale.y = 1.8; phyl.add(gem);
  const gold = clay('#ffcf5a', { metalness: 0.5, roughness: 0.35, key: 'brass' });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 5), gold); bar.position.set(Math.sin(a) * 1.05, 0, Math.cos(a) * 1.05); phyl.add(bar); }
  for (const y of [-1.8, 1.8, 0]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.07, 6, 24), gold); ring.rotation.x = Math.PI / 2; ring.position.y = y; phyl.add(ring); }
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 8), gold); fin.position.y = 2.4; phyl.add(fin);
  const fin2 = fin.clone(); fin2.rotation.x = Math.PI; fin2.position.y = -2.4; phyl.add(fin2);
  phyl.position.set(0, 31.5, Z); g.add(phyl);
  // Rune halo and a spectral beam piercing the sky.
  const halo = k.dyn(new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshBasicMaterial({ map: runeCircleTexture('#7dff9b'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
  halo.rotation.x = -Math.PI / 2; halo.position.set(0, 25.8, Z); g.add(halo);
  const beam = k.dyn(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.5, 160, 16, 1, true), additive(soulGreen, 0.12)));
  beam.position.set(0, 31.5 + 80, Z); g.add(beam);
  const l = k.light(new THREE.PointLight('#7dff9b', 36, 55, 1.4)); l.position.set(0, 31, Z); g.add(l);
  k.tick((dt, t) => {
    crown.rotation.y += dt * 0.18;
    stones.forEach((s, i) => { s.position.y = Math.sin(t * 1.1 + i) * 0.5; });
    phyl.rotation.y += dt * 0.8; phyl.position.y = 31.5 + Math.sin(t * 1.4) * 0.5;
    halo.rotation.z -= dt * 0.12;
    beam.material.opacity = 0.1 + Math.sin(t * 2.4) * 0.04;
    // Soul-light rises from the skull into the phylactery.
    if (Math.random() < dt * 22) {
      const a = Math.random() * TAU, p = k.W(Math.sin(a) * 2.5, 24, Z + Math.cos(a) * 2.5);
      k.fx.spawn(p.x, p.y, p.z, -Math.sin(a) * 0.6, 3.2, -Math.cos(a) * 0.6, new THREE.Color(soulGreen), 0.4, 2.0, 0, 0.2);
    }
  });
  return { group: g, top: 35 };
}

BUILDERS.necromancy = [necroTitan, necroNave, necroWells, necroBelfry, necroCrown];

// ================================================================ Pyromancy: The Forge-Heart
// A causeway of basalt columns ringed by a moat of lava; a hexagonal hall whose column walls
// leak forge-light through every gap; bellows, gears and brass chimneys; then a volcano rising
// from the hall roof, bleeding lava down its flanks; and a phoenix waking on the crater.
const PYRO = { plat: 10.1, platY: 0.62, hallR: 6.6, roofY: 9.4, craterY: 23.8 };
const basalt = () => clay('#3a302e', { roughness: 0.82, key: 'fBasalt' });
const basaltL = () => clay('#56473f', { roughness: 0.78, key: 'fBasaltL' });
const brass = () => clay('#d19a3e', { metalness: 0.55, roughness: 0.32, key: 'forgeBrass' });
const copper = () => clay('#b8703a', { metalness: 0.6, roughness: 0.35, key: 'copper' });
const forgeIron = () => clay('#2e2a33', { metalness: 0.35, roughness: 0.45, key: 'fIron' });
const fireM = () => glow('#ff8a2a', 3.2);
const hexAngle = (i) => Math.PI / 6 + (i * Math.PI) / 3; // hall corners; a flat wall faces +z

function brazier(rand) {
  const b = new THREE.Group(), iron = forgeIron();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 5), iron);
    leg.position.set(Math.sin(a) * 0.3, 0.6, Math.cos(a) * 0.3); leg.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3); b.add(leg);
  }
  const bowl = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.05, 0), new THREE.Vector2(0.5, 0.15), new THREE.Vector2(0.62, 0.45), new THREE.Vector2(0.56, 0.48)], 14), iron);
  bowl.position.y = 1.15; b.add(bowl);
  const coals = new THREE.Mesh(new THREE.CircleGeometry(0.52, 14), glow('#ff5a14', 2)); coals.rotation.x = -Math.PI / 2; coals.position.y = 1.55; b.add(coals);
  const f1 = flame(0.55, fireM()); f1.position.y = 1.5; b.add(f1);
  const f2 = flame(0.35, glow('#ffd27a', 3.5)); f2.position.set(0.12, 1.55, 0.05); b.add(f2);
  return b;
}

function pyroFoundry(k) {
  const g = new THREE.Group(), rand = k.rand, bs = basalt(), bl = basaltL();
  // The causeway: a hex grid of basalt columns, a few rising into a jagged rim at the back.
  const s = 0.74;
  for (let r = -16; r <= 16; r++) for (let q = -16; q <= 16; q++) {
    const x = s * Math.sqrt(3) * (q + r / 2), z = s * 1.5 * r, d = Math.hypot(x, z);
    if (d > PYRO.plat - 0.2) continue;
    const rim = d > PYRO.plat - 1.3 && z < -2 && rand() < 0.45;
    const h = rim ? 1.6 + rand() * 2.2 : 1.1 + PYRO.platY - 0.5 + (rand() - 0.5) * 0.1;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.95, s * 0.98, h, 6), rand() < 0.3 ? bl : bs);
    col.position.set(x, h / 2 - 0.5, z); g.add(col);
    if (rim) k.collide(x, z, 0.6);
  }
  k.surface((x, z) => (Math.hypot(x, z) < PYRO.plat ? PYRO.platY + 0.1 : -Infinity)); // the columns' tops
  // Moat of liquid fire with a basalt curb, crossed by one bridge at the front.
  const moat = new THREE.Mesh(new THREE.RingGeometry(PYRO.plat + 0.1, 12.7, 80, 1), lavaMaterial('xz'));
  moat.rotation.x = -Math.PI / 2; moat.position.y = 0.1; g.add(moat);
  const curb = new THREE.Mesh(new THREE.TorusGeometry(12.85, 0.4, 6, 80), bs); curb.rotation.x = Math.PI / 2; curb.scale.z = 0.6; curb.position.y = 0.15; g.add(curb);
  k.lavaZone((x, z) => { const d = Math.hypot(x, z); return d > PYRO.plat && d < 12.8 && !(Math.abs(x) < 1.7 && z > 0); });
  const bridge = new THREE.Mesh(rbox(3.4, 0.55, 3.6, 0.12), bl); bridge.position.set(0, 0.35, 11.5); g.add(bridge);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(rbox(0.35, 0.6, 3.6, 0.08), bs); p.position.set(sx * 1.75, 0.85, 11.5); g.add(p); }
  k.surface((x, z) => (Math.abs(x) < 1.7 && z > 9.5 && z < 13.4 ? PYRO.platY : -Infinity));
  // The forge-heart at the centre: a stone hearth of glowing coals and a pillar of flame.
  const hearth = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(2.6, 0), new THREE.Vector2(2.7, 0.9), new THREE.Vector2(2.2, 1.1), new THREE.Vector2(2.0, 0.7), new THREE.Vector2(0.01, 0.6)], 6), bl);
  hearth.position.y = PYRO.platY; hearth.rotation.y = Math.PI / 6; g.add(hearth);
  const coals = new THREE.Mesh(new THREE.CircleGeometry(2.0, 6), lavaMaterial('xz')); coals.rotation.x = -Math.PI / 2; coals.position.y = PYRO.platY + 0.66; g.add(coals);
  const pillar = k.dyn(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.6, 5, 20, 1, true), flameMaterial())); pillar.position.y = PYRO.platY + 3.2; g.add(pillar);
  k.collide(0, 0, 2.8);
  // Six braziers at the causeway's corners.
  for (let i = 0; i < 6; i++) {
    const a = hexAngle(i); if (Math.abs(Math.sin(a)) < 0.1 && Math.cos(a) > 0) continue;
    const b = brazier(rand); b.position.set(Math.sin(a) * 9.2, PYRO.platY, Math.cos(a) * 9.2); g.add(b);
    k.collide(Math.sin(a) * 9.2, Math.cos(a) * 9.2, 0.55);
  }
  // Smithing: anvils with hot work and hammers, a quench trough, stacked ingots, a tool rack.
  const wood = clay('#6a4a30', { key: 'stump' }), hot = glow('#ffb347', 2.4);
  [0.72, -0.72, 2.45].forEach((a) => {
    const w = new THREE.Group();
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.7, 12), wood); stump.position.y = 0.35; w.add(stump);
    const anv = heroMesh('anvil', 1.15) || new THREE.Mesh(rbox(1.4, 0.8, 0.6), forgeIron());
    anv.position.y = 0.7; w.add(anv);
    const bar = new THREE.Mesh(rbox(0.9, 0.1, 0.16, 0.03), hot); bar.position.set(0.1, 1.72, 0.05); bar.rotation.y = 0.2; w.add(bar);
    const hammer = new THREE.Group();
    const hh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 6), wood); hh.rotation.z = Math.PI / 2; hammer.add(hh);
    const head = new THREE.Mesh(rbox(0.22, 0.35, 0.22, 0.04), forgeIron()); head.position.x = 0.45; hammer.add(head);
    hammer.position.set(-0.3, 1.75, -0.2); hammer.rotation.y = 0.8; w.add(hammer);
    w.position.set(Math.sin(a) * 8.1, PYRO.platY, Math.cos(a) * 8.1); w.rotation.y = a + Math.PI / 2; g.add(w);
    k.collide(Math.sin(a) * 8.1, Math.cos(a) * 8.1, 0.95);
  });
  const trough = new THREE.Group();
  const tb = new THREE.Mesh(rbox(2.4, 0.8, 1.1, 0.1), wood); tb.position.y = 0.4; trough.add(tb);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.8), new THREE.MeshStandardMaterial({ color: '#1f4a55', roughness: 0.1 })); water.rotation.x = -Math.PI / 2; water.position.y = 0.78; trough.add(water);
  for (const x of [-0.8, 0.8]) { const band = new THREE.Mesh(rbox(0.08, 0.84, 1.16, 0.02), forgeIron()); band.position.set(x, 0.4, 0); trough.add(band); }
  const ta = -2.3; trough.position.set(Math.sin(ta) * 8.2, PYRO.platY, Math.cos(ta) * 8.2); trough.rotation.y = ta; g.add(trough);
  k.collide(Math.sin(ta) * 8.2, Math.cos(ta) * 8.2, 1.2);
  const ingots = new THREE.Group(), ingotM = glow('#ffc35a', 0.55);
  for (let lvl = 0; lvl < 3; lvl++) for (let i = 0; i < 4 - lvl; i++) {
    const ig = new THREE.Mesh(rbox(0.55, 0.2, 0.28, 0.05), ingotM); ig.position.set((i - (3 - lvl) / 2) * 0.3, 0.1 + lvl * 0.21, 0); ig.rotation.y = lvl % 2 ? Math.PI / 2 : 0; ingots.add(ig);
  }
  const ia = 1.15; ingots.position.set(Math.sin(ia) * 8.4, PYRO.platY, Math.cos(ia) * 8.4); g.add(ingots);
  const rack = new THREE.Group();
  for (const x of [-0.9, 0.9]) { const post = new THREE.Mesh(rbox(0.14, 2, 0.14, 0.03), wood); post.position.set(x, 1, 0); rack.add(post); }
  const rail = new THREE.Mesh(rbox(2, 0.12, 0.14, 0.03), wood); rail.position.y = 1.9; rack.add(rail);
  for (let i = 0; i < 4; i++) {
    const tool = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 5), forgeIron()); tool.position.set(-0.6 + i * 0.4, 1.25, 0.1); rack.add(tool);
    const tip = new THREE.Mesh(rbox(0.16, 0.22, 0.08, 0.02), forgeIron()); tip.position.set(-0.6 + i * 0.4, 0.62, 0.1); rack.add(tip);
  }
  const ra = -1.25; rack.position.set(Math.sin(ra) * 8.6, PYRO.platY, Math.cos(ra) * 8.6); rack.rotation.y = ra; g.add(rack);
  k.collide(Math.sin(ra) * 8.6, Math.cos(ra) * 8.6, 0.9);
  const l = k.light(new THREE.PointLight('#ff7a2a', 24, 30, 1.5)); l.position.set(0, 4, 0); g.add(l);
  k.tick((dt, t) => {
    l.intensity = 22 + Math.sin(t * 7) * 2 + Math.random() * 2;
    if (Math.random() < dt * 20) { const p = k.W((Math.random() - 0.5) * 2.4, PYRO.platY + 1.2, (Math.random() - 0.5) * 2.4); k.fx.spawn(p.x, p.y, p.z, (Math.random() - 0.5), 3 + Math.random() * 3, (Math.random() - 0.5), new THREE.Color(Math.random() < 0.5 ? '#ffb347' : '#ff6a1c'), 0.25, 1.4, -0.5, 0.2); }
    if (Math.random() < dt * 5) { const p = k.W(Math.sin(ta) * 8.2 + (Math.random() - 0.5), PYRO.platY + 0.9, Math.cos(ta) * 8.2); k.fx.spawn(p.x, p.y, p.z, 0, 1.2, 0, new THREE.Color('#d8dde0'), 0.7, 2.2, -0.2, 0.4); }
  });
  return { group: g, top: 6 };
}

function pyroHall(k) {
  const g = new THREE.Group(), rand = k.rand, bs = basalt(), bl = basaltL(), R = PYRO.hallR, y0 = PYRO.platY;
  // A molten core glows through every gap between the wall columns.
  const core = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.75, R - 0.75, 9, 6, 1), glow('#ff5a14', 1.2));
  core.rotation.y = Math.PI / 6; core.position.y = y0 + 4.5; g.add(core);
  for (let e = 0; e < 6; e++) {
    const a0 = hexAngle(e), a1 = hexAngle(e + 1);
    const c0 = new THREE.Vector2(Math.sin(a0) * R, Math.cos(a0) * R), c1 = new THREE.Vector2(Math.sin(a1) * R, Math.cos(a1) * R);
    const front = Math.abs(Math.sin((a0 + a1) / 2)) < 0.1 && Math.cos((a0 + a1) / 2) > 0;
    const n = 10;
    for (let j = 0; j < n; j++) {
      const t = j / (n - 1), p = c0.clone().lerp(c1, t);
      const corner = j === 0 || j === n - 1;
      if (!corner && !front && rand() < 0.14) continue; // a slit of forge-light
      const h = corner ? 10.6 : 8.6 + rand() * 1.9;
      let base = 0;
      if (front && Math.abs(p.x) < 2.0) base = 6.7; // above the doors
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, h - base, 6), rand() < 0.35 ? bl : bs);
      col.position.set(p.x, y0 + base + (h - base) / 2, p.y); col.rotation.y = rand(); g.add(col);
    }
  }
  const lintel = new THREE.Mesh(rbox(4.6, 1.0, 1.3, 0.12), bl); lintel.position.set(0, y0 + 6.2, R * Math.cos(Math.PI / 6)); g.add(lintel);
  // Brass bands bind the columns.
  for (const y of [2.6, 7.6]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(R + 0.72, 0.17, 6, 6), brass()); band.rotation.x = Math.PI / 2; band.position.y = y0 + y; g.add(band);
  }
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.7, 6), bl); roof.rotation.y = Math.PI / 6; roof.position.y = PYRO.roofY; g.add(roof);
  // The forge doors: iron leaves, brass frame, rivets and a seam of fire.
  const apo = R * Math.cos(Math.PI / 6) + 0.35, iron = forgeIron(), br = brass();
  for (const sx of [-1, 1]) {
    const leaf = new THREE.Mesh(rbox(1.78, 5.4, 0.3, 0.06), iron); leaf.position.set(sx * 0.92, y0 + 2.7, apo); g.add(leaf);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) {
      const rv = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), br); rv.position.set(sx * (0.35 + c * 0.55), y0 + 0.5 + r * 0.9, apo + 0.17); g.add(rv);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 16), br); ring.position.set(sx * 0.4, y0 + 2.7, apo + 0.22); g.add(ring);
    const post = new THREE.Mesh(rbox(0.3, 5.8, 0.4, 0.05), br); post.position.set(sx * 1.95, y0 + 2.9, apo + 0.05); g.add(post);
  }
  const doorArch = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.16, 8, 24, Math.PI), br); doorArch.position.set(0, y0 + 5.7, apo + 0.05); g.add(doorArch);
  const seam = new THREE.Mesh(rbox(0.08, 5.2, 0.34, 0.02), glow('#ffb347', 3)); seam.position.set(0, y0 + 2.7, apo); g.add(seam);
  const under = new THREE.Mesh(rbox(3.6, 0.08, 0.5, 0.02), glow('#ff8a2a', 2.5)); under.position.set(0, y0 + 0.05, apo + 0.2); g.add(under);
  // A tipping crucible on a gantry pours molten metal into a mould.
  const gx = 8.6;
  for (const z of [-2.1, 2.1]) { const post = new THREE.Mesh(rbox(0.8, 7.8, 0.8, 0.1), bs); post.position.set(gx, y0 + 3.9, z); g.add(post); k.collide(gx, z, 0.7); }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 5, 10), br); axle.rotation.x = Math.PI / 2; axle.position.set(gx, y0 + 6.4, 0); g.add(axle);
  const piv = k.dyn(new THREE.Group()); piv.position.set(gx, y0 + 6.4, 0); g.add(piv);
  const cr = heroMesh('crucible', 2.1) || new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1, 1.8, 16), iron);
  piv.add(cr);
  const mould = new THREE.Mesh(rbox(2.2, 0.6, 1.5, 0.08), iron); mould.position.set(gx, y0 + 0.3, 2.6); g.add(mould);
  const moltenTop = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), lavaMaterial('xz')); moltenTop.rotation.x = -Math.PI / 2; moltenTop.position.set(gx, y0 + 0.62, 2.6); g.add(moltenTop);
  k.collide(gx, 2.6, 1.0);
  const stream = k.dyn(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1, 10), lavaMaterial('uv'))); g.add(stream);
  const lip = new THREE.Vector3(), e = new THREE.Euler();
  k.tick((dt, t) => {
    const c = t % 12, tip = c < 4 ? 0 : c < 6 ? (c - 4) / 2 : c < 9 ? 1 : c < 11 ? 1 - (c - 9) / 2 : 0;
    const ang = tip * 1.05;
    piv.rotation.x = ang;
    lip.set(0, 0.31 * 2.1, 0.8 * 2.1).applyEuler(e.set(ang, 0, 0)).add(piv.position);
    const pour = tip > 0.7;
    stream.visible = pour;
    if (pour) {
      const bottom = y0 + 0.62, len = lip.y - bottom;
      stream.position.set(gx, bottom + len / 2, lip.z); stream.scale.set(1, len, 1);
      if (Math.random() < dt * 30) { const p = k.W(gx, bottom, lip.z); k.fx.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, new THREE.Color('#ffc35a'), 0.25, 0.7, 9, 0.1); }
    }
  });
  k.collide(0, 0, R + 0.5);
  k.block(0, 0, R + 0.8, 10.5);
  return { group: g, top: 11 };
}

function pyroBellows(k) {
  const g = new THREE.Group(), rand = k.rand, br = brass(), cu = copper(), y0 = PYRO.platY;
  const wood = clay('#6a4a30', { key: 'stump' });
  // Two great bellows on trestles, breathing into the hall's western corner.
  const pumps = [];
  [2.3, -2.3].forEach((z, i) => {
    const tr = new THREE.Group();
    for (const x of [-1.2, 1.2]) for (const zz of [-0.9, 0.9]) { const leg = new THREE.Mesh(rbox(0.2, 1.1, 0.2, 0.04), wood); leg.position.set(x, 0.55, zz); tr.add(leg); }
    const top = new THREE.Mesh(rbox(2.8, 0.2, 2.2, 0.05), wood); top.position.y = 1.15; tr.add(top);
    tr.position.set(-9.0, y0, z); g.add(tr);
    const b = k.dyn(new THREE.Group());
    const m = heroMesh('bellows', 2.5) || new THREE.Mesh(rbox(2, 1.2, 3), clay('#7a4a2c'));
    b.add(m); b.position.set(-9.0, y0 + 1.25, z); b.rotation.y = Math.PI / 2; g.add(b);
    pumps.push({ b, ph: i * Math.PI });
    const pipe = new THREE.Mesh(taperTube([[-6.3, y0 + 2.1, z], [-6.0, y0 + 2.2, z * 0.8], [-5.6, y0 + 2.4, z * 0.4]], 0.24, 0.24, 12, 10).geo, cu); g.add(pipe);
    k.collide(-9.0, z, 1.7);
  });
  // Meshing gears turning on the south-west wall.
  const ea = -Math.PI * 2 / 3 + Math.PI / 3, apo = PYRO.hallR * Math.cos(Math.PI / 6) + 0.75;
  const dir = new THREE.Vector3(Math.sin(ea), 0, Math.cos(ea)), tan = new THREE.Vector3(Math.cos(ea), 0, -Math.sin(ea));
  const gears = [];
  [[2.1, 16, -1.0, 1], [1.25, 10, 2.25, -16 / 10], [0.8, 8, 3.3, 0]].slice(0, 2).forEach(([r, teeth, off, ratio]) => {
    const gr = k.dyn(new THREE.Mesh(gearGeo(r, teeth, 0.35), br));
    gr.position.copy(dir.clone().multiplyScalar(apo)).addScaledVector(tan, off); gr.position.y = y0 + 5.3;
    gr.rotation.y = ea; g.add(gr);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.26, r * 0.26, 0.6, 12), forgeIron()); hub.rotation.x = Math.PI / 2; hub.rotation.y = ea;
    hub.position.copy(gr.position); hub.rotation.order = 'YXZ'; g.add(hub);
    gears.push({ gr, ratio });
  });
  // Brass chimney stacks behind the hall, venting fire and smoke.
  const stacks = [];
  [[2.55, 15.5], [Math.PI, 18.5], [-2.55, 14.5]].forEach(([a, h]) => {
    const x = Math.sin(a) * 8.5, z = Math.cos(a) * 8.5, c = new THREE.Group();
    const plinth = new THREE.Mesh(rbox(2.2, 1.6, 2.2, 0.12), basaltL()); plinth.position.y = 0.8; c.add(plinth);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.95, h, 20), cu); stack.position.y = 1.6 + h / 2; c.add(stack);
    for (let y = 3; y < h; y += 3) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.95 - (y / h) * 0.2, 0.09, 6, 20), br); band.rotation.x = Math.PI / 2; band.position.y = 1.6 + y; c.add(band); }
    const crown = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.72, 0), new THREE.Vector2(0.8, 0.4), new THREE.Vector2(1.2, 0.9), new THREE.Vector2(1.25, 1.1), new THREE.Vector2(0.9, 1.1)], 20), br);
    crown.position.y = 1.6 + h; c.add(crown);
    const soot = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), clay('#140e0c', { key: 'soot' })); soot.rotation.x = -Math.PI / 2; soot.position.y = 1.6 + h + 0.8; c.add(soot);
    const f = flame(1.1, fireM()); f.position.y = 1.6 + h + 0.9; c.add(f);
    const f2 = flame(0.7, glow('#ffd27a', 3.6)); f2.position.y = 1.6 + h + 0.9; c.add(f2);
    c.position.set(x, y0, z); g.add(c);
    const pipe = new THREE.Mesh(taperTube([[x * 0.95, y0 + 7.5, z * 0.95], [x * 0.85, y0 + 8.2, z * 0.85], [x * 0.72, y0 + 8.4, z * 0.72]], 0.3, 0.3, 10, 10).geo, cu); g.add(pipe);
    stacks.push({ x, z, top: y0 + 1.6 + h + 1.2 });
    k.collide(x, z, 1.3);
  });
  const l = k.light(new THREE.PointLight('#ff8a2a', 20, 34, 1.5)); l.position.set(0, 18, -8); g.add(l);
  k.tick((dt, t) => {
    pumps.forEach(({ b, ph }) => { b.scale.y = 1 - 0.32 * (Math.sin(t * 1.8 + ph) * 0.5 + 0.5); });
    gears.forEach(({ gr, ratio }) => { gr.rotateZ(dt * 0.5 * ratio); });
    stacks.forEach((s) => {
      const p = k.W(s.x, s.top, s.z);
      if (Math.random() < dt * 9) k.fx.spawn(p.x + (Math.random() - 0.5) * 0.6, p.y + 0.4, p.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, 2.6, (Math.random() - 0.5) * 0.4, new THREE.Color('#3a3230'), 1.8, 4.5, -0.3, 0.2);
      if (Math.random() < dt * 14) k.fx.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 2, 5 + Math.random() * 3, (Math.random() - 0.5) * 2, new THREE.Color('#ffb347'), 0.25, 1.4, 2, 0.1);
    });
  });
  return { group: g, top: 21 };
}

function pyroMantle(k) {
  const g = new THREE.Group(), rand = k.rand, base = PYRO.roofY;
  // A volcano cone raised on the hall roof, its surface broken by noise and scorched near the crater.
  const prof = [[7.0, -0.3], [6.8, 1.2], [6.1, 4.2], [5.2, 7.8], [4.4, 11], [3.9, 13.4], [3.6, 14.4], [3.1, 14.25], [2.6, 12.6], [2.2, 11.8]];
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 64);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(x, z), r = Math.hypot(x, z);
    const n = fbm(a * 2.2 + 3, y * 0.28, 3), lip = y > 13.5;
    const rr = r * (1 + (lip ? 0.03 : 0.1) * n) + (y < 0.1 ? 0 : 0);
    pos.setX(i, Math.sin(a) * rr); pos.setZ(i, Math.cos(a) * rr);
    c.set('#3a302d').lerp(new THREE.Color('#6a4634'), Math.max(0, n) * 0.9).lerp(new THREE.Color('#9a3a16'), Math.max(0, (y - 9) / 5.4) * 0.7);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const cone = new THREE.Mesh(geo, clay('#ffffff', { vertexColors: true, roughness: 0.9, key: 'mantle', side: THREE.DoubleSide }));
  cone.position.y = base; g.add(cone);
  const magma = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), lavaMaterial('xz')); magma.rotation.x = -Math.PI / 2; magma.position.y = base + 12.4; g.add(magma);
  // Lava rivers down the flanks, spilling over the hall roof as lavafalls into glowing pools.
  const radiusAt = (y) => { for (let i = 0; i < prof.length - 1; i++) { const [r0, y0] = prof[i], [r1, y1] = prof[i + 1]; if (y >= y0 && y <= y1) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0)); } return prof[0][0]; };
  const streamM = lavaMaterial('uv');
  [Math.PI * 0.62, Math.PI, -Math.PI * 0.62, Math.PI * 0.27, -Math.PI * 0.3].forEach((a0, si) => {
    const verts = [], uvs = [], idx = [], N = 40, w = 0.32 + rand() * 0.22;
    for (let i = 0; i <= N; i++) {
      const t = i / N, y = 14.2 - t * 14.2, a = a0 + Math.sin(t * 5 + si) * 0.12, r = radiusAt(y) * 1.06 + 0.12;
      const px = Math.sin(a) * r, pz = Math.cos(a) * r, tx = Math.cos(a) * w, tz = -Math.sin(a) * w;
      verts.push(px - tx, base + y, pz - tz, px + tx, base + y, pz + tz);
      uvs.push(0, t, 1, t);
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); sg.setIndex(idx); sg.computeVertexNormals();
    g.add(new THREE.Mesh(sg, streamM));
    if (si < 3) {
      // Lavafall down the hall wall to a pool on the causeway.
      const apo = PYRO.hallR * Math.cos(Math.PI / 6) + 0.5;
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.8, base - PYRO.platY, 1, 8), streamM);
      fall.position.set(Math.sin(a0) * apo, (base + PYRO.platY) / 2, Math.cos(a0) * apo); fall.rotation.y = a0; g.add(fall);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(1.3, 20), lavaMaterial('xz'));
      pool.rotation.x = -Math.PI / 2; pool.position.set(Math.sin(a0) * (apo + 0.9), PYRO.platY + 0.03, Math.cos(a0) * (apo + 0.9)); g.add(pool);
      const px = Math.sin(a0) * (apo + 0.9), pz = Math.cos(a0) * (apo + 0.9);
      k.lavaZone((x, z) => Math.hypot(x - px, z - pz) < 1.2);
    }
  });
  // A skirt of fallen rock where the mountain meets the hall roof.
  const crag = basalt(), cragL = basaltL();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU + rand() * 0.1, rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7 + rand() * 0.6, 0), i % 3 ? crag : cragL);
    rk.position.set(Math.sin(a) * 6.7, base + 0.2 + rand() * 0.4, Math.cos(a) * 6.7); rk.rotation.set(rand() * 3, rand() * 3, 0); rk.scale.y = 0.7; g.add(rk);
  }
  // Glowing fissures zig-zagging down the flanks.
  const fissure = glow('#ff6a1c', 2.2);
  for (let f = 0; f < 9; f++) {
    let a = rand() * TAU, y = 3 + rand() * 9;
    for (let seg = 0; seg < 4; seg++) {
      const y2 = y - 1 - rand() * 1.4, a2 = a + (rand() - 0.5) * 0.35;
      const p1 = new THREE.Vector3(Math.sin(a) * radiusAt(y) * 1.07, base + y, Math.cos(a) * radiusAt(y) * 1.07);
      const p2 = new THREE.Vector3(Math.sin(a2) * radiusAt(y2) * 1.07, base + y2, Math.cos(a2) * radiusAt(y2) * 1.07);
      const len = p1.distanceTo(p2), m = new THREE.Mesh(new THREE.BoxGeometry(0.16, len, 0.1), fissure);
      m.position.copy(p1).lerp(p2, 0.5); m.lookAt(p2); m.rotateX(Math.PI / 2); g.add(m);
      a = a2; y = y2; if (y < 0.5) break;
    }
  }
  // Craggy outcrops on the flanks.
  for (let i = 0; i < 16; i++) {
    const y = 1 + rand() * 11, a = rand() * TAU, r = radiusAt(y);
    const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + rand() * 0.8, 0), crag);
    rk.position.set(Math.sin(a) * r, base + y, Math.cos(a) * r); rk.rotation.set(rand() * 3, rand() * 3, 0); g.add(rk);
  }
  const l = k.light(new THREE.PointLight('#ff5a14', 34, 44, 1.4)); l.position.set(0, base + 16, 0); g.add(l);
  k.tick((dt, t) => {
    l.intensity = 30 + Math.sin(t * 1.3) * 6;
    const p = k.W(0, base + 14.5, 0);
    if (Math.random() < dt * 12) k.fx.spawn(p.x + (Math.random() - 0.5) * 3, p.y, p.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 0.6, 3 + Math.random(), (Math.random() - 0.5) * 0.6, new THREE.Color('#2e2626'), 2.6, 5, -0.2, 0.2);
    if (Math.random() < dt * 20) k.fx.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 5, 7 + Math.random() * 5, (Math.random() - 0.5) * 5, new THREE.Color('#ffb347'), 0.35, 1.6, 7, 0.05);
  });
  k.block(0, 0, 7.8, base + 14.4);
  return { group: g, top: base + 14.5 };
}

function pyroPhoenix(k) {
  const g = new THREE.Group(), cy = PYRO.craterY;
  // A ring of flame tongues around the crater rim.
  const fm = fireM(), fm2 = glow('#ffd27a', 3.6);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU, f = flame(0.9 + (i % 3) * 0.3, i % 2 ? fm : fm2);
    f.position.set(Math.sin(a) * 3.4, cy - 0.2, Math.cos(a) * 3.4); g.add(f);
  }
  const pillar = k.dyn(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.8, 10, 24, 1, true), flameMaterial('#fff0b0', '#ff6a1a')));
  pillar.position.y = cy + 4.5; g.add(pillar);
  // The phoenix: Blender body and wings, perched above the crater, wings beating slowly.
  const S = 3.1, bird = k.dyn(new THREE.Group());
  const body = heroMesh('phoenix_body') || new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), glow('#ffb13b', 2));
  bird.add(body);
  const wings = [];
  for (const side of [1, -1]) {
    const w = heroMesh('phoenix_wing');
    if (!w) continue;
    w.position.set(0.28 * side, 1.2, -0.05); if (side < 0) w.scale.x = -1;
    bird.add(w); wings.push({ w, side });
  }
  bird.scale.setScalar(S); bird.position.set(0, cy + 2.2, 0); g.add(bird);
  // A sun-disc of runes blazing behind the bird.
  const sun = k.dyn(new THREE.Mesh(new THREE.CircleGeometry(7.5, 64), new THREE.MeshBasicMaterial({ map: runeCircleTexture('#ffb347'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85 })));
  sun.position.set(0, cy + 7.5, -2.5); g.add(sun);
  const l = k.light(new THREE.PointLight('#ff9a3c', 48, 70, 1.3)); l.position.set(0, cy + 7, 2); g.add(l);
  const tip = new THREE.Vector3();
  k.tick((dt, t) => {
    const flap = Math.sin(t * 1.7);
    wings.forEach(({ w, side }) => { w.rotation.z = side * (0.15 + flap * 0.42); w.rotation.y = side * 0.2; });
    bird.position.y = cy + 2.2 + Math.sin(t * 1.7 - 0.8) * 0.6;
    bird.rotation.y = Math.sin(t * 0.3) * 0.25;
    sun.rotation.z += dt * 0.25;
    l.intensity = 44 + Math.sin(t * 3) * 6;
    // Embers stream off the wingtips and spiral up the fire column.
    for (const { side } of wings) {
      if (Math.random() > dt * 30) continue;
      tip.set(side * (2.8 + flap * 0.2), 1.7 + flap * 1.3, -0.3).multiplyScalar(S).applyAxisAngle(new THREE.Vector3(0, 1, 0), bird.rotation.y).add(bird.position);
      const p = k.W(tip.x, tip.y, tip.z);
      k.fx.spawn(p.x, p.y, p.z, (Math.random() - 0.5), -0.5 + Math.random(), (Math.random() - 0.5), new THREE.Color(Math.random() < 0.5 ? '#ffc35a' : '#ff5a1a'), 0.5, 1.4, -1, 0.3);
    }
    if (Math.random() < dt * 25) {
      const a = t * 3 + Math.random(), p = k.W(Math.sin(a) * 3, cy, Math.cos(a) * 3);
      k.fx.spawn(p.x, p.y, p.z, Math.cos(a) * 1.5, 6, -Math.sin(a) * 1.5, new THREE.Color('#ffd27a'), 0.4, 1.8, 0, 0.1);
    }
  });
  return { group: g, top: cy + 11 };
}

BUILDERS.pyromancy = [pyroFoundry, pyroHall, pyroBellows, pyroMantle, pyroPhoenix];

// ================================================================ Cryomancy: The Aurora Spire
// A tiered ice dais around a beating frozen heart; octagonal halls of clear ice; a balcony
// reached by a spiral ice bridge you can actually climb; a turning snowflake rose window;
// and a crown of needles with aurora curtains winding through them.
const CRYO = { tiers: [[10, 0.7], [8, 1.4], [6, 2.1]], hallApo: 5.3, roofY: 11.1, balcony: [6.3, 9.25],
  ramp: { R: 10.2, w: 0.85, y0: 0.15, a0: 0.42, span: TAU * 0.9 }, tierTop: 20.1 };
const snow = () => clay('#f4f9ff', { roughness: 0.85, key: 'snow' });
const icicleGeo = (r, h) => new THREE.ConeGeometry(r, h, 5).rotateX(Math.PI).translate(0, -h / 2, 0);

function crystalCluster(rand, n, scale, mat) {
  const c = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const h = (1.4 + rand() * 2.8) * scale, r = (0.25 + rand() * 0.3) * scale;
    const m = new THREE.Mesh(crystalGeo(r, h), mat);
    m.position.set((rand() - 0.5) * 1.2 * scale, 0, (rand() - 0.5) * 1.2 * scale);
    m.rotation.set((rand() - 0.5) * 0.7, rand() * 3, (rand() - 0.5) * 0.7);
    c.add(m);
  }
  return c;
}

// Solid helical band (top, bottom, inner and outer faces), flat-shaded.
function helixBand({ R, w, y0, y1, a0, span, thick = 0.5, N = 150, inset = 0, lift = 0, topOnly = false }) {
  const pos = [], ri = R - w + inset, ro = R + w - inset;
  const at = (i, r, dy) => { const t = i / N, a = a0 + t * span; return [Math.sin(a) * r, y0 + t * (y1 - y0) + dy + lift, Math.cos(a) * r]; };
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < N; i++) {
    const j = i + 1;
    quad(at(i, ri, 0), at(i, ro, 0), at(j, ro, 0), at(j, ri, 0));
    if (topOnly) continue;
    quad(at(i, ro, -thick), at(i, ri, -thick), at(j, ri, -thick), at(j, ro, -thick));
    quad(at(i, ro, 0), at(i, ro, -thick), at(j, ro, -thick), at(j, ro, 0));
    quad(at(i, ri, -thick), at(i, ri, 0), at(j, ri, 0), at(j, ri, -thick));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // Winding varies with the sweep direction; render both sides rather than guess.
  return g;
}

function cryoHeart(k) {
  const g = new THREE.Group(), rand = k.rand;
  const dais = ice('daisIce', '#d6f1ff', 1, 0.16), sn = snow();
  CRYO.tiers.forEach(([r, top], i) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.3, 0.7, 14), dais); t.position.y = top - 0.35; g.add(t);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.25, r - 0.05, 0.1, 14), sn); cap.position.y = top + 0.03; g.add(cap);
    k.surface((x, z) => (Math.hypot(x, z) < r ? top : -Infinity));
    if (i === 0) {
      // Snow drifts piled against the lowest tier.
      for (let d = 0; d < 14; d++) {
        const a = (d / 14) * TAU + rand() * 0.2, dr = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), sn);
        dr.scale.set(1.2 + rand(), 0.35 + rand() * 0.2, 0.8); dr.position.set(Math.sin(a) * (r + 0.4), 0.05, Math.cos(a) * (r + 0.4)); dr.rotation.y = a; g.add(dr);
      }
    }
  });
  const runes = k.dyn(new THREE.Mesh(new THREE.CircleGeometry(5.4, 64), new THREE.MeshBasicMaterial({ map: runeCircleTexture('#8fe3ff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  runes.rotation.x = -Math.PI / 2; runes.position.y = 2.16; g.add(runes);
  // The heart, beating, with ice shards in orbit.
  const heart = k.dyn(new THREE.Group());
  const hm = heroMesh('ice_heart', 2.3) || new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), ice('heartIce', '#c9f0ff', 1, 1.4));
  heart.add(hm);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), glow('#dff6ff', 2.2)); heart.add(core);
  heart.position.y = 6.2; g.add(heart);
  const shards = [], shardM = ice('shard', '#e6f7ff', 0.9, 0.9);
  for (let i = 0; i < 8; i++) {
    const s = k.dyn(new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), shardM)); s.scale.y = 2; g.add(s);
    shards.push({ s, ph: (i / 8) * TAU, tilt: (rand() - 0.5) * 0.8 });
  }
  // Crystal clusters ringing the dais.
  const cm = ice('crystal', '#a8e4ff', 0.9, 0.55);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8, c = crystalCluster(rand, 6, 1, cm);
    c.position.set(Math.sin(a) * 8.6, 0.7, Math.cos(a) * 8.6); g.add(c);
    k.collide(Math.sin(a) * 8.6, Math.cos(a) * 8.6, 0.7, { top: 4.5 });
  }
  const l = k.light(new THREE.PointLight('#8fe3ff', 26, 34, 1.5)); l.position.y = 6.2; g.add(l);
  k.tick((dt, t) => {
    const beat = t % 1.4, pulse = 1 + Math.max(0, Math.sin(Math.min(beat, 0.3) / 0.3 * Math.PI)) * 0.1 + Math.max(0, Math.sin(Math.max(0, Math.min(beat - 0.35, 0.3)) / 0.3 * Math.PI)) * 0.06;
    heart.scale.setScalar(pulse); heart.rotation.y += dt * 0.3; heart.position.y = 6.2 + Math.sin(t * 0.8) * 0.3;
    l.intensity = 22 + (pulse - 1) * 90;
    runes.rotation.z += dt * 0.08;
    shards.forEach(({ s, ph, tilt }) => { const a = t * 0.7 + ph; s.position.set(Math.sin(a) * 3, 6.2 + Math.sin(a * 2) * tilt, Math.cos(a) * 3); s.rotation.y = a; });
    if (Math.random() < dt * 10) { const a = Math.random() * TAU, p = k.W(Math.sin(a) * 4, 2.3, Math.cos(a) * 4); k.fx.spawn(p.x, p.y, p.z, -Math.sin(a) * 0.4, 1.4, -Math.cos(a) * 0.4, new THREE.Color('#dff6ff'), 0.25, 2.4, 0, 0.2); }
  });
  return { group: g, top: 9 };
}

function cryoHalls(k) {
  const g = new THREE.Group(), rand = k.rand, apo = CRYO.hallApo, side = 2 * apo * Math.tan(Math.PI / 8), y0 = 2.1, H = 8.4;
  const wallM = ice('hallIce', '#c2eaff', 0.84, 0.3), pillarM = ice('pillarIce', '#eaf8ff', 1, 0.45), sn = snow();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU, wall = new THREE.Group();
    if (i === 0) {
      // The entrance: narrow jambs and an arch fringed with icicles; the heart shows through.
      for (const sx of [-1, 1]) { const j = new THREE.Mesh(rbox(1.0, H, 0.6, 0.12), wallM); j.position.set(sx * (side / 2 - 0.5), H / 2, 0); wall.add(j); }
      const lin = new THREE.Mesh(rbox(side, H - 5.2, 0.6, 0.12), wallM); lin.position.y = 5.2 + (H - 5.2) / 2; wall.add(lin);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.26, 8, 18, Math.PI), pillarM); arch.position.y = 4.0; wall.add(arch);
      for (let c = 0; c < 9; c++) { const ic = new THREE.Mesh(icicleGeo(0.08, 0.4 + rand() * 0.7), pillarM); const aa = (c / 8) * Math.PI; ic.position.set(Math.cos(aa) * 1.2, 4.0 + Math.sin(aa) * 1.2 - 0.2, 0.1); wall.add(ic); }
    } else {
      const slab = new THREE.Mesh(rbox(side - 0.1, H, 0.6, 0.15), wallM); slab.position.y = H / 2; wall.add(slab);
      for (let c = 0; c < 3; c++) {
        const cr = new THREE.Mesh(crystalGeo(0.3 + rand() * 0.25, 1.2 + rand() * 1.6), pillarM);
        cr.position.set((c - 1) * side * 0.3 + (rand() - 0.5) * 0.4, H - 0.2, 0); cr.rotation.z = (rand() - 0.5) * 0.4; wall.add(cr);
      }
      const glyph = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32), new THREE.MeshBasicMaterial({ map: runeCircleTexture('#bfefff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glyph.position.set(0, 5.6, 0.32); wall.add(glyph);
    }
    wall.position.set(Math.sin(a) * apo, y0, Math.cos(a) * apo);
    wall.rotation.set(-0.04, a, 0, 'YXZ');
    g.add(wall);
    // Corner pillar with a crystal finial and frost capital.
    const ca = a + Math.PI / 8, cr = apo / Math.cos(Math.PI / 8) + 0.1;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 9.6, 6), pillarM); p.position.set(Math.sin(ca) * cr, y0 + 4.8, Math.cos(ca) * cr); g.add(p);
    const tip = new THREE.Mesh(crystalGeo(0.55, 2.4), pillarM); tip.position.set(Math.sin(ca) * cr, y0 + 9.6, Math.cos(ca) * cr); g.add(tip);
    const capT = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.16, 6, 12), sn); capT.rotation.x = Math.PI / 2; capT.position.set(Math.sin(ca) * cr, y0 + 8.4, Math.cos(ca) * cr); g.add(capT);
  }
  // Flat snow roof (it becomes the balcony floor) with an icicle fringe.
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(6.45, 6.2, 0.6, 8), ice('roofIce', '#d6f1ff', 1, 0.2)); roof.rotation.y = Math.PI / 8; roof.position.y = CRYO.roofY - 0.3; g.add(roof);
  const roofSnow = new THREE.Mesh(new THREE.CylinderGeometry(6.35, 6.4, 0.12, 8), sn); roofSnow.rotation.y = Math.PI / 8; roofSnow.position.y = CRYO.roofY + 0.02; g.add(roofSnow);
  const ic = ice('icicle', '#e6f7ff', 0.95, 0.5);
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU, r = 6.25 / Math.cos(((a + Math.PI / 8) % (Math.PI / 4)) - Math.PI / 8) * 0.98, h = 0.4 + rand() * 1.5;
    const m = new THREE.Mesh(icicleGeo(0.09 + rand() * 0.08, h), ic); m.position.set(Math.sin(a) * r, CRYO.roofY - 0.55, Math.cos(a) * r); g.add(m);
  }
  k.surface((x, z) => (Math.hypot(x, z) < 6.3 ? CRYO.roofY : -Infinity));
  k.collide(0, 0, 6.15, { top: CRYO.roofY });
  k.block(0, 0, 6.3, CRYO.roofY);
  return { group: g, top: 13 };
}

function cryoGalleries(k) {
  const g = new THREE.Group(), rand = k.rand, sn = snow(), rp = CRYO.ramp, [b0, b1] = CRYO.balcony, y = CRYO.roofY;
  const deck = ice('deckIce', '#d6f1ff', 1, 0.2), ic = ice('icicle', '#e6f7ff', 0.95, 0.5), pil = ice('pillarIce', '#eaf8ff', 1, 0.45);
  // The balcony ring around the roof.
  const ring = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(b0, y - 0.5), new THREE.Vector2(b1, y - 0.5), new THREE.Vector2(b1 + 0.1, y - 0.2), new THREE.Vector2(b1, y), new THREE.Vector2(b0, y)], 64), deck);
  g.add(ring);
  const ringSnow = new THREE.Mesh(new THREE.RingGeometry(b0, b1 - 0.1, 64), sn); ringSnow.rotation.x = -Math.PI / 2; ringSnow.position.y = y + 0.03; g.add(ringSnow);
  k.surface((x, z) => { const d = Math.hypot(x, z); return d >= b0 - 0.2 && d <= b1 + 0.1 ? y : -Infinity; });
  const arriveA = rp.a0 + rp.span;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * TAU, d = Math.atan2(Math.sin(a - arriveA), Math.cos(a - arriveA));
    const m = new THREE.Mesh(icicleGeo(0.1 + rand() * 0.08, 0.5 + rand() * 1.6), ic); m.position.set(Math.sin(a) * (b1 - 0.1), y - 0.5, Math.cos(a) * (b1 - 0.1)); g.add(m);
    if (Math.abs(d) > 0.35 && i % 2 === 0) { const post = new THREE.Mesh(crystalGeo(0.14, 1.1), pil); post.position.set(Math.sin(a) * (b1 - 0.2), y, Math.cos(a) * (b1 - 0.2)); g.add(post); }
  }
  // The gallery tier: an octagonal ice tower with lit slit windows.
  const tier = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.95, CRYO.tierTop - y - 0.6, 8), ice('galleryIce', '#c2eaff', 0.9, 0.35));
  tier.rotation.y = Math.PI / 8; tier.position.y = y + (CRYO.tierTop - y - 0.6) / 2; g.add(tier);
  const slitM = glow('#cff4ff', 1.4);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU, ca = a + Math.PI / 8;
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, CRYO.tierTop - y, 6), pil); rib.position.set(Math.sin(ca) * 3.95, y + (CRYO.tierTop - y) / 2, Math.cos(ca) * 3.95); g.add(rib);
    if (i === 0) continue; // the rose window goes here
    const slit = new THREE.Mesh(rbox(0.55, 3.4, 0.1, 0.04), slitM); slit.position.set(Math.sin(a) * 3.72, y + 4.4, Math.cos(a) * 3.72); slit.rotation.y = a; g.add(slit);
  }
  const cornice = new THREE.Mesh(new THREE.CylinderGeometry(4.45, 4.0, 0.6, 8), deck); cornice.rotation.y = Math.PI / 8; cornice.position.y = CRYO.tierTop - 0.3; g.add(cornice);
  const corniceSnow = new THREE.Mesh(new THREE.CylinderGeometry(4.35, 4.45, 0.12, 8), sn); corniceSnow.rotation.y = Math.PI / 8; corniceSnow.position.y = CRYO.tierTop + 0.02; g.add(corniceSnow);
  k.collide(0, 0, 4.15, { bottom: y + 0.1, top: CRYO.tierTop });
  // The spiral ice bridge: climbable from the dais to the balcony.
  const band = new THREE.Mesh(helixBand({ ...rp, y1: y, thick: 0.55 }), new THREE.MeshStandardMaterial({ color: '#d6f1ff', emissive: '#3fa8e8', emissiveIntensity: 0.18, roughness: 0.1, flatShading: true, side: THREE.DoubleSide }));
  g.add(band);
  const bandSnow = new THREE.Mesh(helixBand({ ...rp, y1: y, inset: 0.12, lift: 0.04, topOnly: true }), new THREE.MeshStandardMaterial({ color: '#f4f9ff', roughness: 0.85, side: THREE.DoubleSide }));
  g.add(bandSnow);
  const rampY = (t) => rp.y0 + t * (y - rp.y0);
  k.surface((x, z) => {
    const d = Math.hypot(x, z);
    if (d < rp.R - rp.w - 0.15 || d > rp.R + rp.w + 0.15) return -Infinity;
    const rel = ((Math.atan2(x, z) - rp.a0) % TAU + TAU) % TAU, t = rel / rp.span;
    return t <= 1 ? rampY(t) : -Infinity;
  });
  // Railing posts, icicles under the span, and crystal pillars holding it up.
  const railPts = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, a = rp.a0 + t * rp.span, yy = rampY(t);
    railPts.push([Math.sin(a) * (rp.R + rp.w - 0.1), yy + 0.85, Math.cos(a) * (rp.R + rp.w - 0.1)]);
    if (i % 2 === 0) { const post = new THREE.Mesh(crystalGeo(0.1, 1.0), pil); post.position.set(Math.sin(a) * (rp.R + rp.w - 0.1), yy, Math.cos(a) * (rp.R + rp.w - 0.1)); g.add(post); }
    if (yy > 1.2) for (let q = 0; q < 2; q++) {
      const off = (rand() - 0.5) * 1.4, m = new THREE.Mesh(icicleGeo(0.08 + rand() * 0.06, 0.3 + rand() * 1.1), ic);
      m.position.set(Math.sin(a) * (rp.R + off), yy - 0.55, Math.cos(a) * (rp.R + off)); g.add(m);
    }
    if (i % 8 === 4 && yy > 2.5) {
      const h = yy - 0.55, col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, h, 6), pil); col.position.set(Math.sin(a) * rp.R, h / 2, Math.cos(a) * rp.R); g.add(col);
      k.collide(Math.sin(a) * rp.R, Math.cos(a) * rp.R, 0.45, { top: h });
    }
  }
  g.add(new THREE.Mesh(taperTube(railPts, 0.06, 0.06, 180, 6).geo, pil));
  // A frozen waterfall spilling from the balcony down the back of the halls.
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(3.6, y - 0.7, 6, 12), ice('fallIce', '#bfe9ff', 0.8, 0.6));
  const fp = fall.geometry.attributes.position;
  for (let i = 0; i < fp.count; i++) { const v = (fp.getY(i) / (y - 0.7)) + 0.5; fp.setZ(i, Math.pow(1 - v, 2) * 1.2 + Math.sin(fp.getX(i) * 3 + v * 6) * 0.12); }
  fall.geometry.computeVertexNormals();
  fall.position.set(0, (y + 0.7) / 2, -8.85); fall.rotation.y = Math.PI; g.add(fall);
  for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + rand() * 0.5, 0), ice('shard', '#e6f7ff', 0.9, 0.9)); m.position.set((rand() - 0.5) * 3.4, 0.9, -9.6 - rand() * 0.8); g.add(m); }
  const l = k.light(new THREE.PointLight('#bfefff', 18, 32, 1.5)); l.position.set(0, 15, 0); g.add(l);
  k.tick((dt) => {
    if (Math.random() < dt * 8) { const a = Math.random() * TAU, p = k.W(Math.sin(a) * 9, 11.4, Math.cos(a) * 9); k.fx.spawn(p.x, p.y, p.z, 0, -0.4, 0, new THREE.Color('#ffffff'), 0.2, 3, 0.4, 0.1); }
  });
  return { group: g, top: 21 };
}

function cryoRose(k) {
  const g = new THREE.Group(), rand = k.rand, y = CRYO.roofY, pil = ice('pillarIce', '#eaf8ff', 1, 0.45);
  // The rose window: a slowly turning snowflake set in a frosted ring on the gallery's face.
  const rose = k.dyn(new THREE.Group());
  rose.add(new THREE.Mesh(extrude(snowflakeShape(2.3), 0.22, 0.04), glow('#e6f8ff', 1.6)));
  rose.position.set(0, y + 4.6, 3.95); g.add(rose);
  const back = new THREE.Mesh(new THREE.CircleGeometry(2.55, 48), glow('#1f5a98', 0.9)); back.position.set(0, y + 4.6, 3.83); g.add(back);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.24, 8, 48), pil); frame.position.set(0, y + 4.6, 3.9); g.add(frame);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), glow('#cff4ff', 2)); b.position.set(Math.cos(a) * 2.6, y + 4.6 + Math.sin(a) * 2.6, 4.12); g.add(b); }
  // Ice fins rising from the balcony like the ribs of a frozen flower.
  const arriveA = CRYO.ramp.a0 + CRYO.ramp.span;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.2;
    if (Math.abs(Math.atan2(Math.sin(a - arriveA), Math.cos(a - arriveA))) < 0.45) continue;
    const fin = new THREE.Mesh(crystalGeo(0.45, 5.5 + rand() * 2), pil);
    fin.scale.z = 0.4; fin.position.set(Math.sin(a) * 8.6, y, Math.cos(a) * 8.6); fin.rotation.set(0.28, a, 0, 'YXZ'); g.add(fin);
    k.collide(Math.sin(a) * 8.6, Math.cos(a) * 8.6, 0.5, { bottom: y });
  }
  // Snowflakes drifting in orbit around the spire.
  const flakes = [], flakeM = glow('#e6f8ff', 1.3), fgeo = extrude(snowflakeShape(0.85), 0.08, 0.02);
  for (let i = 0; i < 7; i++) {
    const f = k.dyn(new THREE.Mesh(fgeo, flakeM)); g.add(f);
    flakes.push({ f, r: 11.5 + rand() * 2.5, y: 5 + rand() * 14, sp: 0.12 + rand() * 0.1, ph: rand() * TAU });
  }
  const l = k.light(new THREE.PointLight('#bfefff', 16, 22, 1.6)); l.position.set(0, y + 4.6, 6.5); g.add(l);
  k.tick((dt, t) => {
    rose.rotation.z += dt * 0.12;
    flakes.forEach((o) => { const a = t * o.sp + o.ph; o.f.position.set(Math.sin(a) * o.r, o.y + Math.sin(t * 0.6 + o.ph) * 1.2, Math.cos(a) * o.r); o.f.rotation.set(t * 0.3 + o.ph, a, t * 0.5); });
  });
  return { group: g, top: 22 };
}

function cryoCrown(k) {
  const g = new THREE.Group(), rand = k.rand, base = CRYO.tierTop;
  const crownM = ice('crownIce', '#e8f8ff', 0.93, 0.7);
  const main = new THREE.Mesh(crystalGeo(1.15, 14.5), crownM); main.position.y = base; g.add(main);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU, n = new THREE.Mesh(crystalGeo(0.6, 6 + rand() * 4), crownM);
    n.position.set(Math.sin(a) * 2.3, base, Math.cos(a) * 2.3); n.rotation.set(0.2, a, 0, 'YXZ'); g.add(n);
    const s = new THREE.Mesh(crystalGeo(0.35, 2.5 + rand() * 2.5), crownM);
    s.position.set(Math.sin(a + 0.5) * 3.7, base, Math.cos(a + 0.5) * 3.7); s.rotation.set(0.45, a + 0.5, 0, 'YXZ'); g.add(s);
  }
  const star = k.dyn(new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), glow('#f0fdff', 4)));
  star.position.y = base + 15.3; g.add(star);
  const halo = k.dyn(new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), new THREE.MeshBasicMaterial({ map: runeCircleTexture('#bfffe8'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
  halo.position.y = base + 15.3; g.add(halo);
  // Aurora curtains winding up through the needles.
  const auroraM = auroraMaterial(), ribbons = [];
  [[6.2, 0], [8.2, Math.PI]].forEach(([R, a0]) => {
    const verts = [], uvs = [], idx = [], N = 120, turns = 1.4, h = 5.5;
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = a0 + t * turns * TAU, yy = base - 3 + t * 12;
      verts.push(Math.sin(a) * R, yy, Math.cos(a) * R, Math.sin(a) * R, yy + h, Math.cos(a) * R);
      uvs.push(t * 4, 0, t * 4, 1);
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = k.dyn(new THREE.Mesh(geo, auroraM)); g.add(m); ribbons.push(m);
  });
  const l = k.light(new THREE.PointLight('#9fffe0', 34, 56, 1.3)); l.position.y = base + 10; g.add(l);
  k.tick((dt, t) => {
    star.rotation.y += dt * 1.2; star.scale.setScalar(1 + Math.sin(t * 3) * 0.15);
    halo.lookAt(halo.position.clone().add(new THREE.Vector3(0, 0, 1)));
    halo.rotation.z = t * 0.3;
    ribbons.forEach((r, i) => { r.rotation.y += dt * (i ? -0.08 : 0.1); });
    l.color.setHSL(0.42 + Math.sin(t * 0.4) * 0.08, 0.9, 0.7);
    if (Math.random() < dt * 14) { const a = Math.random() * TAU, rr = 1 + Math.random() * 4, p = k.W(Math.sin(a) * rr, base + Math.random() * 14, Math.cos(a) * rr); k.fx.spawn(p.x, p.y, p.z, 0, 0.3, 0, new THREE.Color(Math.random() < 0.5 ? '#bfffe8' : '#d8c8ff'), 0.3, 2.5, 0, 0.1); }
  });
  return { group: g, top: base + 17 };
}

BUILDERS.cryomancy = [cryoHeart, cryoHalls, cryoGalleries, cryoRose, cryoCrown];


// ================================================================ Geomancy: The Heartstone Hold
// Aldric's tower in the Deep was carved into the mountain itself. It grows from a carved cave
// mouth in a crag into a whole mountain face: ancestor colossi flank the gate, a split geode
// bursts from its flank, a great lift climbs it, and at last the mountain's own face opens its
// eyes beneath a crown of floating stones. The front faces +z, toward the cornerstone.
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
const GEO = { faceZ: 3.4, stairTop: 1.4, doorW: 3.4, doorH: 4.8 };
const geoRock = () => texturedStone('geoRock', '#8a7058', 5, 3, 0.85);
const geoDressed = () => texturedStone('geoDressed', '#b39a7a', 2, 2, 0.7);
const heartM = () => glow('#ffb347', 2.6);

// A craggy massif: a displaced icosphere whose front is sheared into a cliff at z = face.
function crag(rx, ry, rz, cx, cy, cz, face, seed, mat) {
  const geo = new THREE.IcosahedronGeometry(1, 5), pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + 0.16 * Math.sin(v.x * 5.1 + seed) * Math.cos(v.y * 4.3 - seed) + 0.1 * Math.sin(v.z * 7.7 + v.y * 3 + seed * 2) + 0.05 * Math.sin(v.x * 17 + v.z * 13);
    v.multiplyScalar(n);
    v.set(v.x * rx + cx, Math.max(v.y * ry + cy, -0.6), v.z * rz + cz);
    if (face !== null && v.z > face) v.z = face + (v.z - face) * 0.12 + Math.sin(v.y * 1.3 + v.x * 0.7) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
// Glowing heartstone seams drawn over a crag.
function seams(g, rand, n, box, mat) {
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(rbox(0.16, 1.2 + rand() * 2.6, 0.2, 0.05), mat);
    s.position.set(box.x0 + rand() * (box.x1 - box.x0), box.y0 + rand() * (box.y1 - box.y0), box.z);
    s.rotation.z = (rand() - 0.5) * 1.4; g.add(s);
  }
}
function geoBrazier(k) {
  const b = new THREE.Group(), stone = geoDressed();
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.2, 8), stone); ped.position.y = 0.6; b.add(ped);
  const bowl = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.1, 0), new THREE.Vector2(0.7, 0.2), new THREE.Vector2(0.8, 0.5)], 10), stone); bowl.position.y = 1.2; b.add(bowl);
  const coals = new THREE.Mesh(new THREE.CircleGeometry(0.72, 10), glow('#ff8a1a', 2.4)); coals.rotation.x = -Math.PI / 2; coals.position.y = 1.62; b.add(coals);
  const f = flame(0.7, glow('#ffb347', 3.2)); f.position.y = 1.6; b.add(f);
  return b;
}

function geoMouth(k) {
  const g = new THREE.Group(), rand = k.rand, rock = geoRock(), dressed = geoDressed();
  // The crag, with the cliff face sheared flat around the gate.
  g.add(crag(14, 12, 10.5, 0, 1, -6.5, GEO.faceZ, 1.3, rock));
  g.add(crag(7, 7, 6, -10, 0, -3, 1.8, 2.1, rock), crag(6.5, 8, 6, 10.5, 0, -4, 1.4, 3.7, rock));
  seams(g, rand, 16, { x0: -11, x1: 11, y0: 1.5, y1: 10, z: GEO.faceZ + 0.3 }, heartM());
  // The carved gate: dark recess, voussoirs, lintel glyph.
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(GEO.doorW, GEO.doorH), new THREE.MeshBasicMaterial({ color: '#0a0604' }));
  dark.position.set(0, GEO.stairTop + GEO.doorH / 2, GEO.faceZ + 0.25); g.add(dark);
  const archTop = new THREE.Mesh(new THREE.CircleGeometry(GEO.doorW / 2, 24, 0, Math.PI), dark.material); archTop.position.set(0, GEO.stairTop + GEO.doorH, GEO.faceZ + 0.25); g.add(archTop);
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI, r = GEO.doorW / 2 + 0.5;
    const b = new THREE.Mesh(rbox(0.9, 0.7, 1.2, 0.08), dressed);
    b.position.set(Math.cos(a) * r, GEO.stairTop + GEO.doorH + Math.sin(a) * r, GEO.faceZ + 0.5); b.rotation.z = a - Math.PI / 2; g.add(b);
  }
  for (const sx of [-1, 1]) for (let j = 0; j < 5; j++) {
    const b = new THREE.Mesh(rbox(0.9, 0.9, 1.2, 0.08), dressed); b.position.set(sx * (GEO.doorW / 2 + 0.5), GEO.stairTop + 0.45 + j * 0.95, GEO.faceZ + 0.5); g.add(b);
  }
  const glyph = new THREE.Mesh(new THREE.CircleGeometry(0.55, 6), heartM()); glyph.position.set(0, GEO.stairTop + GEO.doorH + GEO.doorW / 2 + 0.55, GEO.faceZ + 1.12); g.add(glyph);
  // The stair: four wide steps up to the threshold.
  const steps = [[8.6, 0.35], [7.6, 0.7], [6.6, 1.05], [5.2, GEO.stairTop]];
  steps.forEach(([z, h], i) => { const st = new THREE.Mesh(rbox(5.6 - i * 0.3, h, i === 3 ? 2.4 : 1.1, 0.06), dressed); st.position.set(0, h / 2, z - (i === 3 ? 0.4 : 0)); g.add(st); });
  k.surface((x, z) => {
    if (Math.abs(x) > 2.6 || z < 3.4 || z > 9.2) return -Infinity;
    return z > 8.1 ? 0.35 : z > 7.1 ? 0.7 : z > 6.1 ? 1.05 : GEO.stairTop;
  });
  // Braziers either side of the stair.
  for (const sx of [-1, 1]) { const b = geoBrazier(k); b.position.set(sx * 3.9, 0, 7.4); g.add(b); k.collide(sx * 3.9, 7.4, 0.7); }
  // Rubble of Aldric's old tower, not yet cleared from the approach.
  for (let i = 0; i < 12; i++) { const a = rand() * TAU, r = 9 + rand() * 5; const b = new THREE.Mesh(rbox(0.8 + rand(), 0.5 + rand() * 0.5, 0.8 + rand(), 0.1), dressed); b.position.set(Math.sin(a) * r, 0.25, -Math.abs(Math.cos(a)) * r - 2); b.rotation.set(rand(), rand() * 3, rand()); g.add(b); }
  // The crag is solid; the gate stays open.
  [[0, -7, 9.8], [-9.5, -4, 5.6], [9.8, -4.5, 5.4], [-5.6, -1.5, 3.8], [5.6, -1.5, 3.8]].forEach(([x, z, r]) => k.collide(x, z, r));
  k.block(0, -6, 13, 13);
  const l = k.light(new THREE.PointLight('#ffb347', 20, 26, 1.5)); l.position.set(0, 4, 7); g.add(l);
  k.tick((dt, t) => { l.intensity = 18 + Math.sin(t * 6) * 2 + Math.random() * 2; glyph.material.emissiveIntensity = 2.2 + Math.sin(t * 1.5) * 0.8; });
  return { group: g, top: 13 };
}

function ancestor(k, rand) {
  const s = heroMesh('ancestor_statue', 1.3);
  if (s) return s;
  const g = new THREE.Group(), st = texturedStone('geoStatue', '#a89478', 1, 3, 0.8);
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 1, 8), st), 0, 0.5, 0));
  const robe = new THREE.Mesh(new THREE.ConeGeometry(1.6, 6.5, 10), st); robe.position.y = 4.2; g.add(robe);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), st); hood.position.y = 7.8; hood.scale.set(1, 1.15, 1); g.add(hood);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), new THREE.MeshBasicMaterial({ color: '#140c08' })); face.position.set(0, 7.7, 0.82); g.add(face);
  for (const x of [-0.18, 0.18]) g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), heartM()), x, 7.75, 0.85));
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 7, 8), st); staff.position.set(0, 3.8, 1.5); g.add(staff);
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), heartM()); head.position.set(0, 7.5, 1.5); g.add(head);
  return g;
}
function geoAncestors(k) {
  const g = new THREE.Group(), rand = k.rand, dressed = geoDressed();
  for (const sx of [-1, 1]) {
    const plinth = new THREE.Mesh(rbox(3.4, 1.4, 3.4, 0.12), dressed); plinth.position.set(sx * 7, 0.7, 5.4); g.add(plinth);
    const a = ancestor(k, rand); a.position.set(sx * 7, 1.4, 5.4); a.rotation.y = -sx * 0.18; g.add(a);
    k.collide(sx * 7, 5.4, 2.1);
    // Carved pilasters framing the gate.
    const pil = new THREE.Mesh(rbox(1.1, 8.5, 0.9, 0.1), dressed); pil.position.set(sx * 3.4, 4.25, GEO.faceZ + 0.6); g.add(pil);
    const cap = new THREE.Mesh(rbox(1.6, 0.6, 1.3, 0.1), dressed); cap.position.set(sx * 3.4, 8.7, GEO.faceZ + 0.7); g.add(cap);
  }
  // A frieze of heartstone runes across the face.
  const frieze = new THREE.Mesh(rbox(8.6, 0.9, 0.5, 0.08), dressed); frieze.position.set(0, 9.3, GEO.faceZ + 0.8); g.add(frieze);
  for (let i = 0; i < 9; i++) { const r = new THREE.Mesh(new THREE.CircleGeometry(0.22, i % 2 ? 3 : 6), heartM()); r.position.set(-3.6 + i * 0.9, 9.3, GEO.faceZ + 1.07); g.add(r); }
  // Spirit-lamps: ectoplasm woke the carved dead; their lamps burn green-gold.
  const lamps = [];
  for (const sx of [-1, 1]) { const lamp = k.dyn(new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), glow('#b8ffcc', 2.6))); lamp.position.set(sx * 7, 10.8, 6.6); g.add(lamp); lamps.push(lamp); }
  const l = k.light(new THREE.PointLight('#d8ffc0', 14, 22, 1.6)); l.position.set(0, 9, 8); g.add(l);
  k.tick((dt, t) => { lamps.forEach((m, i) => { m.position.y = 10.8 + Math.sin(t * 1.3 + i * 2) * 0.25; }); });
  return { group: g, top: 13 };
}

function geoGeode(k) {
  const g = new THREE.Group(), rand = k.rand, rock = geoRock();
  // A shoulder of rock on the east flank, and the split geode bursting out of it.
  g.add(crag(6, 6.5, 5, 9, 6, -3, 1.2, 5.3, rock));
  const geode = heroMesh('geode', 0.62);
  const gg = new THREE.Group();
  if (geode) gg.add(geode);
  else {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(3.6, 20, 14, 0, Math.PI * 1.3), new THREE.MeshStandardMaterial({ color: '#6a5a54', side: THREE.DoubleSide, roughness: 0.9 }));
    shell.rotation.y = Math.PI * 0.85; gg.add(shell);
  }
  gg.position.set(9.5, 7.5, 0.2); gg.rotation.set(-0.2, -0.5, 0.15); g.add(gg);
  const cm = glow('#c9a8ff', 1.5);
  for (let i = 0; i < 26; i++) {
    const x = 5 + rand() * 9, y = 1 + rand() * 9, z = 0.5 + rand() * 3;
    const c = new THREE.Mesh(crystalGeo(0.18 + rand() * 0.3, 0.8 + rand() * 2.2), cm); c.position.set(x, y, z); c.rotation.set((rand() - 0.5) * 1.4, rand() * 3, (rand() - 0.5) * 1.4); g.add(c);
  }
  const l = k.light(new THREE.PointLight('#b48cff', 26, 30, 1.4)); l.position.set(9.5, 8.5, 3.5); g.add(l);
  k.collide(9, -1.5, 4.6);
  k.tick((dt, t) => { l.intensity = 22 + Math.sin(t * 1.1) * 5; if (Math.random() < dt * 8) { const p = k.W(8 + Math.random() * 4, 6 + Math.random() * 4, 1 + Math.random() * 2); k.fx.spawn(p.x, p.y, p.z, 0, 0.4, 0, new THREE.Color('#d8c8ff'), 0.25, 2, 0, 0.1); } });
  return { group: g, top: 16 };
}

function geoLift(k) {
  const g = new THREE.Group(), rand = k.rand, wood = clay('#7a5230', { key: 'mineWood' }), iron = clay('#4a4650', { metalness: 0.6, roughness: 0.4, key: 'mineIron' });
  // A timber headframe on the crag's western shoulder, carrying the great winch wheel.
  const hx = -8.5, hz = -1.5, base = 8;
  const frame = new THREE.Group();
  [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]].forEach(([x, z]) => { const leg = new THREE.Mesh(rbox(0.4, 9, 0.4, 0.06), wood); leg.position.set(x, 4.5, z); leg.rotation.set(z * 0.03, 0, -x * 0.03); frame.add(leg); });
  for (let y = 2; y < 9; y += 3) { for (const z of [-1.6, 1.6]) frame.add(at(new THREE.Mesh(rbox(3.6, 0.3, 0.3, 0.05), wood), 0, y, z)); }
  frame.position.set(hx, base, hz); g.add(frame);
  const wheel = k.rigid(heroMesh('lift_wheel', 1) || new THREE.Mesh(new THREE.TorusGeometry(3, 0.25, 8, 32), iron));
  const wheelG = k.dyn(new THREE.Group()); wheelG.add(wheel); wheelG.position.set(hx, base + 9.6, hz + 0.3); g.add(wheelG);
  // Chains down the cliff to a hanging cage that rises and falls.
  const chain = k.dyn(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), iron)); g.add(chain);
  const cage = k.rigid(new THREE.Group());
  cage.add(new THREE.Mesh(rbox(2.2, 0.2, 2.2, 0.04), wood));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cage.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5), iron), x, 1.1, z));
  cage.add(at(new THREE.Mesh(rbox(2.2, 0.15, 2.2, 0.04), iron), 0, 2.2, 0));
  const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), heartM()); ore.position.y = 0.5; cage.add(ore);
  g.add(cage);
  // Rails zig-zagging up the face, with carts.
  const railM = iron;
  [[-6, 0.5, 4.5, -2, 6, 3.6], [-2, 6, 3.6, 4, 11, 2.2]].forEach(([x0, y0, z0, x1, y1, z1]) => {
    for (const off of [-0.5, 0.5]) {
      const a = new THREE.Vector3(x0, y0, z0 + off), b = new THREE.Vector3(x1, y1, z1 + off), len = a.distanceTo(b);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 5), railM); r.position.copy(a).add(b).multiplyScalar(0.5);
      r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(r);
    }
    for (let i = 0; i <= 8; i++) { const t = i / 8, tie = new THREE.Mesh(rbox(0.25, 0.12, 1.5, 0.03), wood); tie.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - 0.1, z0 + (z1 - z0) * t); g.add(tie); }
  });
  for (const [x, y, z] of [[-4, 2.4, 4.2], [2, 9.3, 2.7]]) { const c = heroMesh('minecart', 1) || new THREE.Mesh(rbox(1.5, 0.8, 1, 0.1), iron); c.position.set(x, y, z); c.rotation.set(0, Math.PI / 2, 0.4); g.add(c); }
  k.collide(hx, hz, 2.4);
  const lamp = k.light(new THREE.PointLight('#ffc46a', 16, 22, 1.5)); lamp.position.set(hx, base + 4, hz + 3); g.add(lamp);
  const top = base + 12.6, bottom = 1.2;
  k.tick((dt, t) => {
    wheelG.rotation.z = t * 0.5;
    const y = bottom + (Math.sin(t * 0.25) * 0.5 + 0.5) * (base - bottom);
    cage.position.set(hx, y, hz + 3.6);
    chain.position.set(hx, (y + 2.2 + base + 9.6) / 2, hz + 3.6); chain.scale.y = base + 9.6 - y - 2.2;
  });
  return { group: g, top };
}

function geoCrown(k) {
  const g = new THREE.Group(), rand = k.rand, rock = geoRock();
  // The peak rises; the mountain's own face is carved into it — and now its eyes are open.
  g.add(crag(10, 9, 8, 0, 13, -8, -1.2, 7.9, rock));
  const face = heroMesh('colossus_face', 0.4);
  const fg = new THREE.Group();
  if (face) fg.add(face);
  else {
    const st = texturedStone('geoStatue', '#a89478', 1, 3, 0.8);
    const f = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 16), st); f.scale.set(1, 1.2, 0.45); f.position.y = 6; fg.add(f);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1, 2.8, 6), st); nose.position.set(0, 5.6, 2); nose.rotation.x = 0.2; fg.add(nose);
  }
  const eyes = heroMesh('colossus_eyes', 0.4);
  if (eyes) fg.add(eyes);
  else for (const x of [-1.8, 1.8]) fg.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), glow('#ffe9a8', 4)), x, 7.2, 2.2));
  fg.position.set(0, 11.5, -1.5); g.add(fg);
  // The crown of floating stones circling its brow.
  const ring = k.dyn(new THREE.Group()), stones = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU, st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 + rand() * 0.6, 0), rock);
    st.position.set(Math.cos(a) * 8, 0, Math.sin(a) * 8); st.rotation.set(rand() * 3, rand() * 3, 0);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), heartM()); gem.position.y = 0.9; st.add(gem);
    ring.add(st); stones.push(st);
  }
  const crown = heroMesh('king_crown', 2.2); if (crown) { crown.position.y = 1.5; ring.add(crown); }
  ring.position.set(0, 25, -5); g.add(ring);
  const l = k.light(new THREE.PointLight('#ffc23a', 30, 40, 1.3)); l.position.set(0, 20, 4); g.add(l);
  k.tick((dt, t) => {
    ring.rotation.y += dt * 0.25;
    stones.forEach((s, i) => { s.position.y = Math.sin(t * 1.2 + i) * 0.6; s.rotation.y += dt * 0.5; });
    l.intensity = 26 + Math.sin(t * 0.9) * 6;
  });
  return { group: g, top: 28 };
}

BUILDERS.geomancy = [geoMouth, geoAncestors, geoGeode, geoLift, geoCrown];
