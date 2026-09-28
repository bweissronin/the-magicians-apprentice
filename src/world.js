import * as THREE from 'three';
import { fbm, smoothstep, lerp, clamp, mulberry32 } from './util.js';
import { SHRINES, REALM_PASSES, PASS_LIP, passPoint } from './data.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, grassTexture, dirtTexture, clay } from './style.js';

export const WORLD_SIZE = 460;
export const WORLD_RADIUS = 185; // playable radius
export const WATER_LEVEL = -1.2;
export const PLATEAU_H = 4;

// Raw height before flattening pads (used to pick shrine pad heights).
function baseHeight(x, z) {
  const d = Math.hypot(x, z);
  let h = 4.5 + fbm(x * 0.011, z * 0.011, 5) * 14 + fbm(x * 0.045 + 91, z * 0.045 - 17, 3) * 2.5;
  // Valley bowl: gently rising toward a ring of mountains.
  h += smoothstep(110, 200, d) * (26 + fbm(x * 0.03, z * 0.03, 3) * 14);
  // Carve a lake to the south-west.
  const lake = Math.hypot(x + 40, z - 60);
  h -= (1 - smoothstep(8, 34, lake)) * 14;
  // Soft terraces give the valley a hand-built diorama feel (tiers joined by clay cliffs).
  if (h > 0.5) {
    const step = 2.6, k = h / step, f = Math.floor(k);
    h = (f + smoothstep(0.3, 0.7, k - f)) * step;
  }
  return h;
}

const pads = SHRINES.map((s) => ({ x: s.x, z: s.z, h: Math.max(baseHeight(s.x, s.z), 1.5), r0: 7, r1: 14 }));

// Each realm's pass: a road cut through the mountain ring down to the height of the land at
// s = 135, then a chasm of mist beyond the lip (see crossings.js for the bridge and the mist).
const PASSES = Object.entries(REALM_PASSES).map(([id, P]) => {
  const ux = Math.cos(P.a), uz = Math.sin(P.a), q = passPoint(id, 135);
  return { id, ux, uz, road: Math.max(baseHeight(q.x, q.z), 3) };
});
export const passRoadHeight = (id) => PASSES.find((p) => p.id === id).road;
export const CHASM_FLOOR = -45;

function carvePasses(x, z, h) {
  for (const P of PASSES) {
    const s = x * P.ux + z * P.uz;
    if (s < 100) continue;
    const l = Math.abs(-x * P.uz + z * P.ux);
    // The road: mountains lowered to the road height in a corridor with sloping walls.
    const kr = smoothstep(104, 128, s) * (1 - smoothstep(8, 22, l));
    if (kr > 0) h = lerp(h, Math.min(h, P.road), kr);
    // The chasm, widening as it runs out into the mist.
    const cw = 15 + Math.max(0, s - PASS_LIP) * 0.45;
    const kc = smoothstep(PASS_LIP, PASS_LIP + 3, s) * (1 - smoothstep(cw, cw + 9, l));
    if (kc > 0) h = lerp(h, CHASM_FLOOR, kc);
  }
  return h;
}

export function heightAt(x, z) {
  let h = baseHeight(x, z);
  const d = Math.hypot(x, z);
  h = lerp(h, PLATEAU_H, 1 - smoothstep(18, 38, d));
  for (const p of pads) {
    const ds = Math.hypot(x - p.x, z - p.z);
    if (ds < p.r1) h = lerp(h, p.h, 1 - smoothstep(p.r0, p.r1, ds));
  }
  return d > 95 ? carvePasses(x, z, h) : h;
}

// No grass or flowers where the snow, ash or bare rock has taken the ground.
const barren = (x, z, k = 0.45) => { const b = bleedAt(x, z); return b[1] > k || b[2] > k || b[3] > k; };

// How strongly each realm bleeds into the valley here: [crypt, deep, hollow, caldera], 0..1.
// Full in the pass and along the rim beside it, fading toward the valley floor.
const BLEED_ORDER = ['necromancy', 'geomancy', 'cryomancy', 'pyromancy'];
export function bleedAt(x, z) {
  const d = Math.hypot(x, z), out = [0, 0, 0, 0];
  if (d < 88) return out;
  const a = Math.atan2(z, x), wr = smoothstep(90, 136, d);
  BLEED_ORDER.forEach((id, i) => {
    const da = Math.abs(Math.atan2(Math.sin(a - REALM_PASSES[id].a), Math.cos(a - REALM_PASSES[id].a)));
    out[i] = wr * (1 - smoothstep(0.26, 0.5, da));
  });
  return out;
}

export function slopeAt(x, z) {
  const e = 0.8;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

const terrainTime = { value: 0 };
function buildTerrain() {
  const seg = 260;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const tint = new Float32Array(pos.count * 3);
  const mix = new Float32Array(pos.count * 4); // path, cliff, sand, snow
  const bleed = new Float32Array(pos.count * 4); // crypt, deep, hollow, caldera (see bleedAt)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
    const up = nrm.getY(i);
    // Gentle large-scale tint variation so the lawn isn't a flat colour.
    const n = fbm(x * 0.02, z * 0.02, 3);
    const lum = 1 + n * 0.12;
    tint[i * 3] = lum * (1 + n * 0.05); tint[i * 3 + 1] = lum; tint[i * 3 + 2] = lum * (1 - n * 0.08);
    let path = 0;
    for (const s of [...SHRINES, ...Object.keys(REALM_PASSES).map((id) => ({ ...passPoint(id, PASS_LIP - 2), pass: true }))]) { // shrines + the four passes
      const len = Math.hypot(s.x, s.z);
      const t = clamp((x * s.x + z * s.z) / (len * len), 0, 1);
      const dist = Math.hypot(x - s.x * t, z - s.z * t);
      const wob = fbm(x * 0.08, z * 0.08, 2) * 0.8;
      if (t > 0.1 && t < (s.pass ? 1 : 0.93)) path = Math.max(path, 1 - smoothstep(1.3, 2.4, dist + wob));
    }
    const d = Math.hypot(x, z);
    path = Math.max(path, 1 - smoothstep(16, 19, d)); // courtyard around the tower
    for (const s of SHRINES) path = Math.max(path, 1 - smoothstep(6.5, 8, Math.hypot(x - s.x, z - s.z)));
    const cliff = smoothstep(0.74, 0.55, up);
    // Beach only where real water is within a few metres (dry hollows stay grassy).
    let sand = 0;
    if (h < WATER_LEVEL + 1.3) {
      let wet = h < WATER_LEVEL;
      for (let k = 0; k < 8 && !wet; k++) {
        const aa = (k / 8) * Math.PI * 2;
        if (heightAt(x + Math.cos(aa) * 3.5, z + Math.sin(aa) * 3.5) < WATER_LEVEL) wet = true;
      }
      if (wet) sand = 1 - smoothstep(WATER_LEVEL + 0.3, WATER_LEVEL + 1.3, h);
    }
    const snow = smoothstep(38, 44, h) * smoothstep(0.65, 0.85, up);
    mix[i * 4] = path * (1 - cliff); mix[i * 4 + 1] = cliff; mix[i * 4 + 2] = sand; mix[i * 4 + 3] = snow;
    bleed.set(bleedAt(x, z), i * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(tint, 3));
  geo.setAttribute('aMix', new THREE.BufferAttribute(mix, 4));
  geo.setAttribute('aBleed', new THREE.BufferAttribute(bleed, 4));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const grass = grassTexture(), dirt = dirtTexture();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uGrass: { value: grass }, uDirt: { value: dirt },
      uCliff: { value: new THREE.Color(PALETTE.cliff) }, uCliffDark: { value: new THREE.Color(PALETTE.cliffDark) },
      uSand: { value: new THREE.Color(PALETTE.sand) },
      uTime: terrainTime,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMix, aBleed; varying vec4 vMix, vBleed; varying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMix = aMix; vBleed = aBleed; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGrass, uDirt; uniform vec3 uCliff, uCliffDark, uSand; uniform float uTime;
        float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float cNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(cHash(i), cHash(i + vec2(1, 0)), f.x), mix(cHash(i + vec2(0, 1)), cHash(i + vec2(1, 1)), f.x), f.y); }
        varying vec4 vMix, vBleed; varying vec3 vWPos; float vCrack;`)
      .replace('#include <map_fragment>', `
        vec3 g = texture2D(uGrass, vWPos.xz / 7.0).rgb;
        vec3 dirtC = texture2D(uDirt, vWPos.xz / 4.5).rgb;
        // Layered clay strata on cliff faces.
        float strata = smoothstep(0.42, 0.5, fract(vWPos.y * 0.75 + sin(vWPos.x * 0.3 + vWPos.z * 0.2) * 0.15));
        vec3 cliffC = mix(uCliff, uCliffDark, strata * 0.35);
        vec3 col = g;
        col = mix(col, dirtC, smoothstep(0.42, 0.55, vMix.x));
        col = mix(col, cliffC, smoothstep(0.25, 0.65, vMix.y));
        col = mix(col, uSand, smoothstep(0.35, 0.6, vMix.z));
        col = mix(col, vec3(0.95, 0.97, 1.0), vMix.w);
        // Each realm bleeding into its edge of the valley, in ragged patches.
        float bn = cNoise(vWPos.xz * 0.09) - 0.5;
        vec4 bl = smoothstep(0.15, 0.75, vBleed + bn * 0.45);
        vec3 grey = vec3(dot(col, vec3(0.3, 0.55, 0.15)));
        col = mix(col, grey * vec3(0.72, 0.86, 0.78), bl.x * 0.85);                       // the Crypt: drained, mossy grey
        col = mix(col, mix(vec3(0.55, 0.40, 0.30), vec3(0.42, 0.33, 0.30), strata) * (0.85 + bn * 0.4), bl.y * 0.85); // the Deep: bare russet rock
        col = mix(col, vec3(0.84, 0.88, 0.94) * (0.95 + bn * 0.12), bl.z);                // the Hollow: snow (a touch grey, so it isn't glare)
        col = mix(col, vec3(0.09, 0.075, 0.075) * (0.9 + bn * 0.4), bl.w * 0.97);        // the Caldera: ash
        float ridge = 1.0 - abs(cNoise(vWPos.xz * 0.32) * 2.0 - 1.0);
        vCrack = smoothstep(0.982, 0.997, ridge) * smoothstep(0.35, 0.8, bl.w);
        col = mix(col, vec3(0.2, 0.05, 0.02), vCrack);
        diffuseColor.rgb *= col;
        // Soft cloud shadows drifting across the valley.
        vec2 cp = vWPos.xz * 0.012 + uTime * vec2(0.012, 0.007);
        float cloud = cNoise(cp) * 0.65 + cNoise(cp * 2.3 + 7.1) * 0.35;
        diffuseColor.rgb *= 1.0 - smoothstep(0.52, 0.78, cloud) * 0.2;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * vCrack * (1.3 + 0.5 * sin(uTime * 1.7 + vWPos.x * 0.2));`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildSky() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#2a6fd6') },
      uHorizon: { value: new THREE.Color('#bfe3ff') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff2cc') },
      uNight: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHorizon, uSunColor, uSunDir;
      uniform float uNight, uTime;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
        col = mix(col, uHorizon * 0.7, smoothstep(0.0, -0.3, d.y));
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 12.0) * 0.35) * (1.0 - uNight * 0.5);
        // Moon opposite the sun.
        float md = max(dot(d, -normalize(uSunDir)), 0.0);
        col += vec3(0.8, 0.85, 1.0) * (smoothstep(0.9993, 0.9996, md) * 1.6 + pow(md, 40.0) * 0.12) * uNight;
        // Stars + a faint nebula band.
        vec3 sp = floor(d * 380.0);
        float s = hash(sp);
        float star = smoothstep(0.9965, 1.0, s) * (0.6 + 0.4 * sin(uTime * 3.0 + s * 90.0));
        float band = exp(-pow(d.x * 0.7 + d.y * 0.5 - d.z * 0.3, 2.0) * 9.0);
        vec3 neb = mix(vec3(0.25, 0.1, 0.45), vec3(0.05, 0.3, 0.5), d.z * 0.5 + 0.5) * band * 0.35;
        col += (vec3(star) + neb) * uNight * smoothstep(-0.05, 0.2, d.y);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

// Shore mask baked from the height function: 1 at the waterline, 0 in deep water / on land.
function shoreTexture() {
  const N = 256, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / (N - 1) - 0.5) * WORLD_SIZE * 1.2, z = (j / (N - 1) - 0.5) * WORLD_SIZE * 1.2;
    const h = heightAt(x, z);
    const v = smoothstep(WATER_LEVEL - 3.0, WATER_LEVEL + 0.2, h);
    const k = (j * N + i) * 4;
    data[k] = data[k + 1] = data[k + 2] = v * 255; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function buildWater() {
  const size = WORLD_SIZE * 1.2;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.9 });
  const uniforms = { uTime: { value: 0 } };
  const shore = shoreTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uShore = { value: shore };
    shader.uniforms.uSize = { value: size };
    shader.uniforms.uDeep = { value: new THREE.Color(PALETTE.waterDeep) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uSize; uniform sampler2D uShore; uniform vec3 uDeep; varying vec3 vWPos;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 suv = vWPos.xz / uSize + 0.5;
        float shoreM = texture2D(uShore, suv).r;
        diffuseColor.rgb = mix(uDeep, diffuseColor.rgb * 1.15, smoothstep(0.0, 0.8, shoreM));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 wp = vWPos.xz;
        float w1 = sin(wp.x * 0.35 + uTime * 1.3) * cos(wp.y * 0.28 - uTime * 1.1);
        normal = normalize(normal + vec3(w1 * 0.05, 0.0, w1 * 0.04));`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        // Solid foam lip at the shore plus rings rippling outward.
        float edge = smoothstep(0.84, 0.93, shoreM);
        float rings = smoothstep(0.82, 0.95, sin(shoreM * 26.0 - uTime * 1.6)) * smoothstep(0.35, 0.8, shoreM) * (1.0 - edge);
        float n = sin(wp.x * 1.3 + uTime) * sin(wp.y * 1.1 - uTime * 0.8);
        float foam = max(edge, rings * 0.75) * (0.85 + 0.15 * n);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), foam * 0.85);
        gl_FragColor.a = max(gl_FragColor.a, foam);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.receiveShadow = true;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

// Chunky three-leaf grass tufts (clay style) that sway in the wind.
function tuftGeometry() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const leaf = new THREE.SphereGeometry(0.16, 6, 4); // tufts are small on screen; half the triangles
    leaf.scale(0.55, 1.6, 0.35);
    leaf.translate(0, 0.22, 0);
    leaf.rotateZ((k - 1) * 0.55);
    leaf.rotateY(k * 0.9);
    parts.push(leaf);
  }
  return mergeGeometries(parts);
}

function placeScatter(rand, count, test) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 8) {
    const r = Math.sqrt(rand()) * 160, a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (!test(x, z, h)) continue;
    out.push([x, h, z]);
  }
  return out;
}

function buildGrass(rand) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        float sway = sin(uTime * 1.6 + ip.x * 0.21 + ip.z * 0.17);
        transformed.x += sway * 0.08 * position.y;`);
  };
  const spots = placeScatter(rand, 9000, (x, z, h) =>
    Math.hypot(x, z) > 16 && h > WATER_LEVEL + 0.9 && h < 30 && slopeAt(x, z) < 0.5 && fbm(x * 0.05 + 7, z * 0.05, 2) > -0.1 && !barren(x, z));
  const mesh = new THREE.InstancedMesh(tuftGeometry(), mat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const col = new THREE.Color();
  spots.forEach(([x, h, z], i) => {
    p.set(x, h - 0.04, z); e.set(0, rand() * Math.PI * 2, 0); q.setFromEuler(e);
    const s = 0.55 + rand() * 0.55; sc.set(s, s * (0.8 + rand() * 0.4), s);
    mesh.setMatrixAt(i, m.compose(p, q, sc));
    mesh.setColorAt(i, col.set(rand() < 0.5 ? PALETTE.grassDark : '#5aa832').offsetHSL(0, 0, (rand() - 0.5) * 0.06));
  });
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

// Daisies (white petals, golden heart) and smooth cream pebbles.
function daisyGeometry() {
  const parts = [];
  const white = new THREE.Color('#ffffff'), yellow = new THREE.Color('#ffc93c'), stem = new THREE.Color('#4f9a2e');
  const paint = (g, c) => {
    const n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  for (let k = 0; k < 7; k++) {
    const pt = new THREE.SphereGeometry(0.1, 6, 3);
    pt.scale(0.7, 0.28, 1.5); pt.translate(0, 0.42, 0.15); pt.rotateY((k / 7) * Math.PI * 2);
    parts.push(paint(pt, white));
  }
  const center = new THREE.SphereGeometry(0.085, 8, 4); center.scale(1, 0.55, 1); center.translate(0, 0.46, 0);
  parts.push(paint(center, yellow));
  const st = new THREE.CylinderGeometry(0.018, 0.022, 0.42, 5); st.translate(0, 0.21, 0);
  parts.push(paint(st, stem));
  return mergeGeometries(parts);
}

function buildDecor(rand) {
  const group = new THREE.Group();
  const spots = placeScatter(rand, 900, (x, z, h) =>
    Math.hypot(x, z) > 18 && h > WATER_LEVEL + 1 && h < 22 && slopeAt(x, z) < 0.4 && fbm(x * 0.06, z * 0.06 + 33, 2) > 0.12 && !barren(x, z, 0.25));
  const daisies = new THREE.InstancedMesh(daisyGeometry(), clay('#ffffff', { vertexColors: true, roughness: 0.55, rim: 0.2, key: 'daisy' }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const tints = ['#ffffff', '#ffffff', '#ffffff', '#ffd9ec', '#e6dcff'];
  const col = new THREE.Color();
  spots.forEach(([x, h, z], i) => {
    p.set(x, h, z); e.set((rand() - 0.5) * 0.3, rand() * 6.28, (rand() - 0.5) * 0.3); q.setFromEuler(e);
    const sc = 0.9 + rand() * 0.9; s.set(sc, sc, sc);
    daisies.setMatrixAt(i, m.compose(p, q, s));
    daisies.setColorAt(i, col.set(tints[Math.floor(rand() * tints.length)]));
  });
  daisies.castShadow = false; daisies.receiveShadow = true; // tiny on screen; AO grounds them
  group.add(daisies);

  const pebbleGeo = mergeVertices(new THREE.IcosahedronGeometry(0.3, 1).deleteAttribute('normal').deleteAttribute('uv'));
  const pp = pebbleGeo.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pp, i);
    const k = 1 + fbm(v.x * 3 + 1, v.z * 3 + v.y * 2, 2) * 0.18;
    pp.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  pebbleGeo.computeVertexNormals();
  const pspots = placeScatter(rand, 500, (x, z, h) => h > WATER_LEVEL - 0.3 && Math.hypot(x, z) > 18);
  const pebbles = new THREE.InstancedMesh(pebbleGeo, clay(PALETTE.stone, { roughness: 0.55 }), pspots.length);
  pspots.forEach(([x, h, z], i) => {
    const sc = 0.5 + rand() * 1.3;
    p.set(x, h - 0.05, z); e.set(0, rand() * 6.28, 0); q.setFromEuler(e); s.set(sc, sc * 0.55, sc * 0.85);
    pebbles.setMatrixAt(i, m.compose(p, q, s));
    pebbles.setColorAt(i, col.set(PALETTE.stone).offsetHSL(0, 0, (rand() - 0.5) * 0.08));
  });
  pebbles.castShadow = true; pebbles.receiveShadow = true;
  group.add(pebbles);
  return group;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    const rand = mulberry32(1337);
    this.terrain = buildTerrain();
    this.sky = buildSky();
    this.water = buildWater();
    this.grass = buildGrass(rand);
    this.decor = buildDecor(rand);
    scene.add(this.terrain, this.sky, this.water, this.grass, this.decor);

    this.hemi = new THREE.HemisphereLight('#e4f3ff', '#8a6a3a', 1.3);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1d6', 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(3072, 3072);
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 300;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    scene.fog = new THREE.FogExp2('#cfe6f5', 0.0042);
    this.time = 0.3; // 0..1 day fraction; 0.25 sunrise, 0.5 noon, 0.75 sunset
    this.dayLength = 420; // seconds per full cycle
    this.night = 0;

    // Palette keyframes for the day/night cycle.
    this.keys = [
      { t: 0.0,  top: '#0d1433', hor: '#26306a', fog: '#1a2350', sun: '#8aa0ff', hemi: 0.55, sunI: 0.6 },
      { t: 0.22, top: '#39437e', hor: '#ffa36b', fog: '#b58f8f', sun: '#ffb07a', hemi: 0.8, sunI: 1.6 },
      { t: 0.32, top: '#4a9ff0', hor: '#ffe6c2', fog: '#d9e9f2', sun: '#fff0d6', hemi: 1.25, sunI: 3.0 },
      { t: 0.5,  top: '#3d93ea', hor: '#cdeeff', fog: '#cfe6f5', sun: '#fff5e0', hemi: 1.35, sunI: 3.4 },
      { t: 0.68, top: '#4a8ee0', hor: '#ffdcae', fog: '#e8dccd', sun: '#ffe2b4', hemi: 1.2, sunI: 3.0 },
      { t: 0.78, top: '#4a3a8c', hor: '#ff9a62', fog: '#b98a88', sun: '#ff9a5c', hemi: 0.85, sunI: 1.6 },
      { t: 0.86, top: '#141c46', hor: '#303b78', fog: '#1d2656', sun: '#8aa0ff', hemi: 0.55, sunI: 0.6 },
      { t: 1.0,  top: '#0d1433', hor: '#26306a', fog: '#1a2350', sun: '#8aa0ff', hemi: 0.55, sunI: 0.6 },
    ];
    this._c = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  }

  sample(t) {
    const k = this.keys;
    let i = 0;
    while (i < k.length - 2 && t > k[i + 1].t) i++;
    const a = k[i], b = k[i + 1];
    const f = smoothstep(0, 1, (t - a.t) / (b.t - a.t));
    const [c1, c2] = this._c;
    return {
      top: c1.set(a.top).clone().lerp(c2.set(b.top), f),
      hor: c1.set(a.hor).clone().lerp(c2.set(b.hor), f),
      fog: c1.set(a.fog).clone().lerp(c2.set(b.fog), f),
      sun: c1.set(a.sun).clone().lerp(c2.set(b.sun), f),
      hemi: lerp(a.hemi, b.hemi, f),
      sunI: lerp(a.sunI, b.sunI, f),
    };
  }

  update(dt, elapsed, focus) {
    this.time = (this.time + dt / this.dayLength) % 1;
    const t = this.time;
    const s = this.sample(t);
    // Sun arcs east->west; at night the "sun" light becomes moonlight from the opposite side.
    const ang = (t - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    const lightDir = sunDir.y > -0.05 ? sunDir.clone() : sunDir.clone().negate();
    lightDir.y = Math.max(lightDir.y, 0.25);
    lightDir.normalize();
    this.night = 1 - smoothstep(-0.12, 0.12, sunDir.y);

    this.sun.position.copy(focus).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(focus);
    this.sun.color.copy(s.sun);
    this.sun.intensity = s.sunI;
    this.hemi.intensity = s.hemi;
    this.hemi.color.copy(s.top).lerp(new THREE.Color('#ffffff'), 0.6);

    const u = this.sky.material.uniforms;
    u.uTop.value.copy(s.top); u.uHorizon.value.copy(s.hor);
    u.uSunDir.value.copy(sunDir); u.uSunColor.value.copy(s.sun);
    u.uNight.value = this.night; u.uTime.value = elapsed;
    this.sky.position.copy(focus);
    this.scene.fog.color.copy(s.fog);

    this.water.userData.uniforms.uTime.value = elapsed;
    this.grass.userData.uniforms.uTime.value = elapsed;
    terrainTime.value = elapsed;
  }

  clockLabel() {
    const hours = (this.time * 24 + 0) % 24;
    const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
}
